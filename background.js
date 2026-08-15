/*
 * Background script: owns the context menus, all decoding, and result routing.
 * Runs as a service worker in Chrome and Edge, and as a non-persistent event
 * page in Firefox (see PORTS.md).
 *
 * Decoding strategy, in order of image quality:
 *   1. data: image URLs decode directly from the URL (no page access needed).
 *   2. A locate script asks the page for the image at its natural resolution
 *      via an untainted canvas (works for same-origin and CORS-enabled
 *      images; no network request, the image is already loaded).
 *   3. Screenshot of the visible tab, cropped to the image's on-screen rect.
 * The area scan always uses the screenshot path.
 *
 * Both flows show a decoding indicator on the page while they work (it lives
 * in content/overlay.js, next to the result card that replaces it), and take
 * it off screen around captures so it never lands in a decoded image. Every
 * scan carries an id, and the overlay ignores anything from a scan a newer one
 * has replaced, so two scans racing in one tab cannot undo each other's work.
 *
 * Nothing here talks to the network: captureVisibleTab and data: URLs are
 * local, and the vendored jsQR runs in this worker.
 */

// In the Chrome/Edge service worker the dependencies load here; in Firefox
// there is no importScripts (the background is an event page) and the same
// files come first in the manifest's background.scripts list instead.
if (typeof importScripts === 'function') {
  importScripts('vendor/jsQR.js', 'common/payload.js', 'common/crop.js', 'common/preprocess.js');
}

// Firefox only guarantees promise-style calls on browser.*; Chrome and Edge
// provide them on chrome.*. Everything below awaits through this alias.
const api = globalThis.browser ?? globalThis.chrome;

const MENU_IMAGE = 'qrgenie-decode-image';
const MENU_AREA = 'qrgenie-scan-area';

/*
 * Results waiting to be picked up by fallback viewer pages, keyed by a random
 * nonce. Kept in worker memory (never in a URL or storage) so decoded secrets
 * such as Wi-Fi passwords do not end up in tab URLs or session state; each
 * viewer collects its own entry with a read-once message right after it loads.
 *
 * Only the nonce travels in the viewer URL. It carries no payload, and binding
 * on it keeps two concurrent scans from crossing results and stops a reloaded
 * older viewer from consuming a newer scan's result.
 */
const pendingViewerResults = new Map();
const MAX_PENDING_RESULTS = 8;

/*
 * Every scan gets an id, stamped on every message to the overlay. The overlay
 * keeps the highest id it has seen and drops messages from older scans, so a
 * slow scan can neither restore its indicator into a newer scan's capture nor
 * clear a newer scan's indicator with its own late result.
 *
 * Ids must keep rising across service worker restarts, because the overlay in
 * the page outlives the worker: seeding from the clock does that, and the
 * max() keeps ids unique when several scans start inside the same millisecond.
 */
let lastOpId = Date.now();

function nextOp() {
  lastOpId = Math.max(lastOpId + 1, Date.now());
  return lastOpId;
}

api.runtime.onInstalled.addListener(() => {
  // Promise-chained (not the callback form): browser.* APIs in Firefox take
  // no callbacks. Both browsers persist menus created here across restarts
  // for non-persistent backgrounds.
  api.contextMenus.removeAll().then(() => {
    api.contextMenus.create({
      id: MENU_IMAGE,
      title: 'Decode QR code in this image',
      contexts: ['image']
    });
    api.contextMenus.create({
      id: MENU_AREA,
      title: 'Scan area for QR code',
      contexts: ['page', 'image']
    });
  });
});

api.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || tab.id == null) return;
  if (info.menuItemId === MENU_IMAGE) {
    const op = nextOp();
    decodeImageFlow(info, tab, op).catch((err) => reportFailure(tab.id, 'image', err, op));
  } else if (info.menuItemId === MENU_AREA) {
    // If the selection overlay cannot be injected, the page blocked us
    // (chrome:// and about: pages, extension stores, PDF viewer) — not a
    // failed decode.
    startAreaSelect(tab.id).catch((err) => {
      console.warn('QRGenie area select blocked:', err);
      showResult(tab.id, failure('area', 'blocked'), nextOp());
    });
  }
});

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;

  if (msg.type === 'qrgenie:start-area') {
    // From the popup. The popup click granted activeTab for this tab.
    startAreaSelect(msg.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true;
  }

  if (msg.type === 'qrgenie:area-selected' && sender.tab && sender.tab.id != null) {
    const op = nextOp();
    decodeAreaFlow(msg, sender.tab.id, op).catch((err) =>
      reportFailure(sender.tab.id, 'area', err, op)
    );
    return false;
  }

  if (msg.type === 'qrgenie:get-result') {
    // Read-once pickup by the fallback viewer page. Only our own extension
    // pages qualify — content scripts run inside web pages and never need it.
    const fromExtensionPage =
      sender && typeof sender.url === 'string' &&
      sender.url.startsWith(api.runtime.getURL(''));
    const nonce = typeof msg.nonce === 'string' ? msg.nonce : '';
    if (fromExtensionPage && pendingViewerResults.has(nonce)) {
      sendResponse({ result: pendingViewerResults.get(nonce) });
      pendingViewerResults.delete(nonce);
    } else {
      sendResponse({ result: null });
    }
    return false;
  }

  if (msg.type === 'qrgenie:open-url') {
    // Only plain web links ever get here (classify() vets them), but check
    // again since content scripts are less trusted than this worker.
    if (typeof msg.url === 'string' && /^https?:\/\//i.test(msg.url)) {
      api.tabs.create({ url: msg.url });
    }
    return false;
  }

  return false;
});

// ---------------------------------------------------------------------------
// Flows

async function decodeImageFlow(info, tab, op) {
  const frameId = info.frameId || 0;
  let located = null;

  // Every attempt below can run the preprocessing ladder, which takes a second
  // or two on a stylized code, so the page says so from the start.
  await showBusy(tab.id, 'image', op);

  if (info.srcUrl && info.srcUrl.startsWith('data:')) {
    const result = await decodeFromDataUrl(info.srcUrl);
    if (result) return showResult(tab.id, success(result, 'image'), op);
  }

  try {
    located = await locateImage(tab.id, frameId, info.srcUrl || '');
  } catch (_) {
    // Page did not let us inject (restricted page); fall through.
  }

  // Best quality: the image itself, exported by the page at natural size.
  if (located && located.dataUrl) {
    const result = await decodeFromDataUrl(located.dataUrl);
    if (result) return showResult(tab.id, success(result, 'image'), op);
  }

  // Screenshot fallback. Rects from cross-origin iframes are relative to the
  // iframe viewport, so only crop for the top frame; otherwise scan the whole
  // visible tab. Full-tab results are flagged so the card can say the code
  // was found on the visible tab, not read from the image itself.
  const capture = await captureTabForDecode(tab.id, tab.windowId, op);
  if (capture.dataUrl) {
    const rect = frameId === 0 && located ? located : null;
    if (rect) {
      const result = await decodeFromCapture(capture.dataUrl, rect);
      if (result) return showResult(tab.id, success(result, 'image'), op);
    }
    const full = await decodeFromCapture(capture.dataUrl, null);
    if (full) return showResult(tab.id, success(full, 'image', true), op);
  }

  if (capture.held) {
    // We never took the screenshot, so this is not "no code in the image".
    return showResult(tab.id, failure('image', 'page-busy'), op);
  }
  if (!capture.dataUrl && !located) {
    // Neither injecting nor capturing worked: the page blocked us.
    return showResult(tab.id, failure('image', 'blocked'), op);
  }
  return showResult(tab.id, failure('image'), op);
}

async function startAreaSelect(tabId) {
  await api.scripting.executeScript({
    target: { tabId },
    files: ['content/area-select.js']
  });
}

async function decodeAreaFlow(msg, tabId, op) {
  // The user selected a region: decode that region only. No full-capture
  // fallback here — it could surface an unrelated QR code from elsewhere on
  // the page, outside the box the user drew.
  const tab = await api.tabs.get(tabId);
  // Capture first, then raise the indicator: the capture is what the user just
  // framed, and taking it before anything is drawn keeps this scan's own
  // indicator out of it for free.
  const capture = await captureTabForDecode(tabId, tab.windowId, op);
  // No capture means nothing to decode: say that straight away rather than
  // spinning an indicator over work that will not happen.
  if (capture.held) return showResult(tabId, failure('area', 'page-busy'), op);
  await showBusy(tabId, 'area', op);
  if (capture.dataUrl) {
    const result = await decodeFromCapture(capture.dataUrl, msg);
    if (result) return showResult(tabId, success(result, 'area'), op);
  }
  return showResult(tabId, failure('area'), op);
}

// ---------------------------------------------------------------------------
// Page helpers

/*
 * Finds the right-clicked image in the page and returns its viewport rect
 * plus, when the canvas is not tainted, the image itself as a PNG data URL
 * at natural resolution.
 */
function locateImage(tabId, frameId, srcUrl) {
  return api.scripting
    .executeScript({
      target: { tabId, frameIds: [frameId] },
      func: (src) => {
        const imgs = Array.from(document.images).filter(
          (i) => i.currentSrc === src || i.src === src
        );
        let img = null;
        for (const candidate of imgs) {
          const r = candidate.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            img = candidate;
            break;
          }
        }
        if (!img) return null;

        const rect = img.getBoundingClientRect();
        const out = {
          x: rect.x,
          y: rect.y,
          w: rect.width,
          h: rect.height,
          vw: window.innerWidth,
          vh: window.innerHeight,
          dataUrl: null
        };

        try {
          const MAX = 1200; // enough detail for any on-screen QR
          const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight, 1));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          out.dataUrl = canvas.toDataURL('image/png');
        } catch (_) {
          // Cross-origin image without CORS headers taints the canvas.
        }
        return out;
      },
      args: [srcUrl]
    })
    .then((results) => (results && results[0] ? results[0].result : null));
}

/*
 * Puts the decoding indicator on the page. Best effort: a page that blocks
 * injection also blocks the result card, and that path opens the viewer tab
 * instead, so a failure here needs no handling. Every flow ends in showResult,
 * which clears the indicator, and the overlay drops it on its own if this
 * script dies mid-decode.
 */
async function showBusy(tabId, source, op) {
  try {
    await api.scripting.executeScript({
      target: { tabId },
      files: ['content/overlay.js']
    });
    await api.tabs.sendMessage(tabId, { type: 'qrgenie:show-busy', source, op });
  } catch (_) {
    // Restricted page, or the tab went away. Decoding carries on regardless.
  }
}

// How long the overlay gets to confirm it is off screen. Its own answer takes
// two frames plus a beat; this leaves room for a page that is briefly busy.
const HIDE_ACK_MS = 1500;
// A forced hide is one synchronous DOM change, so it either lands quickly or
// the page is not running our code at all.
const FORCE_HIDE_MS = 1000;
// executeScript returns as soon as the hide has run, which is before the page
// has painted without us. Two frames at 30fps, the same beat the overlay uses.
const FORCE_HIDE_REPAINT_MS = 70;

const DEADLINE = Symbol('deadline');

function withDeadline(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(DEADLINE), ms))
  ]);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/*
 * Captures the visible tab with our own UI hidden, so neither the indicator
 * nor a card left over from an earlier scan ends up in the pixels we decode.
 *
 * Returns the capture as a data URL, or nothing with `held` set when we would
 * not have known whether our own UI was on screen. A held capture is not a
 * failed decode and must not be reported as one.
 */
async function captureTabForDecode(tabId, windowId, op) {
  if (!(await hideForCapture(tabId, op))) return { dataUrl: null, held: true };
  try {
    return { dataUrl: await captureTab(windowId), held: false };
  } finally {
    await sendToPage(tabId, { type: 'qrgenie:restore-after-capture', op });
  }
}

/*
 * Gets our own UI off screen and returns whether we know it is off screen.
 *
 * Three outcomes, and the difference between them is the whole point:
 *   - the message is rejected: nothing of ours is injected in the tab, so
 *     nothing of ours can be in the capture;
 *   - the overlay answers: it has hidden itself and the page has painted;
 *   - no answer in time: we do not know, so we hide it ourselves from a script
 *     we inject, and only a confirmed hide clears the capture. Everything else
 *     returns false and the caller drops the capture rather than risk taking a
 *     photograph of our own indicator and decoding it.
 */
async function hideForCapture(tabId, op) {
  try {
    const acked = await withDeadline(
      api.tabs.sendMessage(tabId, { type: 'qrgenie:hide-for-capture', op }),
      HIDE_ACK_MS
    );
    if (acked !== DEADLINE) return true;
  } catch (_) {
    // No receiving end: no overlay of ours in this tab.
    return true;
  }
  return forceHide(tabId, op);
}

/*
 * Last resort when the overlay did not answer: hide it from the outside. The
 * hook is the one the overlay publishes in its own isolated world, so a page
 * cannot fake it and we do not have to find our host elements from the page.
 */
async function forceHide(tabId, op) {
  let results;
  try {
    results = await withDeadline(
      api.scripting.executeScript({
        target: { tabId },
        func: (opId) => {
          const hide = window.__qrgenieHideNow;
          // No hook means the overlay never ran here (the tab navigated, the
          // injection failed): nothing of ours is on screen.
          if (typeof hide !== 'function') return true;
          return hide(opId) === true;
        },
        args: [op]
      }),
      FORCE_HIDE_MS
    );
  } catch (_) {
    return false;
  }
  if (results === DEADLINE) return false;
  const first = Array.isArray(results) ? results[0] : null;
  if (!first || first.result !== true) return false;
  await sleep(FORCE_HIDE_REPAINT_MS);
  return true;
}

/*
 * Best-effort message to the overlay, for the messages where no answer costs
 * us nothing. It rejects when nothing is injected (restricted page, tab
 * closed) and can hang when a page is wedged, and neither may stall a decode,
 * so both resolve to nothing. Never use this where the answer authorizes
 * something: see hideForCapture.
 */
function sendToPage(tabId, msg) {
  return Promise.race([
    api.tabs.sendMessage(tabId, msg).catch(() => null),
    new Promise((resolve) => setTimeout(resolve, 500))
  ]);
}

async function showResult(tabId, result, op) {
  try {
    await api.scripting.executeScript({
      target: { tabId },
      files: ['content/overlay.js']
    });
    await api.tabs.sendMessage(tabId, { type: 'qrgenie:show-result', result, op });
  } catch (_) {
    // Restricted page (chrome:// and about: pages, extension stores, the
    // PDF viewer): use our own page.
    // The payload stays in worker memory; the viewer asks for it on load,
    // quoting the nonce it was opened with.
    const nonce = crypto.randomUUID();
    pendingViewerResults.set(nonce, result);
    // Bound the map in case viewers never load (a blocked tabs.create, a tab
    // closed before it asks). Oldest entry goes first — Map keeps insertion
    // order — so a fresh scan is never the one dropped.
    while (pendingViewerResults.size > MAX_PENDING_RESULTS) {
      pendingViewerResults.delete(pendingViewerResults.keys().next().value);
    }
    await api.tabs.create({
      url: api.runtime.getURL('viewer/viewer.html') + '#' + nonce
    });
  }
}

function reportFailure(tabId, source, err, op) {
  console.warn('QRGenie decode failed:', err);
  return showResult(tabId, failure(source), op);
}

// ---------------------------------------------------------------------------
// Decoding

function success(text, source, fromVisibleTab) {
  const payload = QRGeniePayload.classify(text);
  return { ok: true, source, payload, fromVisibleTab: !!fromVisibleTab };
}

function failure(source, reason) {
  return { ok: false, source, reason: reason || null };
}

async function captureTab(windowId) {
  try {
    return await api.tabs.captureVisibleTab(windowId, { format: 'png' });
  } catch (_) {
    return null;
  }
}

async function decodeFromDataUrl(dataUrl) {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    return decodeBitmap(bitmap);
  } catch (_) {
    return null;
  }
}

/*
 * Decodes a full-tab capture, optionally cropped to a CSS-pixel rect (the
 * rect-to-pixel mapping lives in common/crop.js, where it is unit-tested).
 * With a rect, only the cropped region is decoded — never the rest of the
 * capture; callers that want a full-tab scan pass rect = null explicitly.
 */
async function decodeFromCapture(captureDataUrl, rect) {
  try {
    const blob = await (await fetch(captureDataUrl)).blob();
    const bitmap = await createImageBitmap(blob);

    if (!rect) return decodeBitmap(bitmap);

    const crop = QRGenieCrop.mapCaptureRect(bitmap.width, bitmap.height, rect);
    if (!crop) return null;

    const cropped = await createImageBitmap(bitmap, crop.x, crop.y, crop.w, crop.h);
    return decodeBitmap(cropped);
  } catch (_) {
    return null;
  }
}

/*
 * Runs jsQR over the bitmap, retrying at a different scale when the first
 * pass fails: small crops get upscaled (tiny modules), huge captures get
 * downscaled (jsQR's binarizer prefers moderate sizes). When plain decoding
 * fails at every scale, the preprocessing ladder in common/preprocess.js
 * gets one run on the size-normalized image — it recovers stylized codes
 * (dot/gapped modules, rounded modules, mild perspective) that QRGenie's own
 * product generates and phone cameras read. Clean codes never reach it.
 */
function decodeBitmap(bitmap) {
  const attempts = [1];
  const size = Math.max(bitmap.width, bitmap.height);
  if (size < 300) attempts.push(3);
  else if (size > 1400) attempts.push(900 / size);

  // Only the most recent attempt's pixels are kept for the ladder; holding
  // every scale would pin tens of MiB for a 4K capture.
  let last = null;
  for (const scale of attempts) {
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.drawImage(bitmap, 0, 0, w, h);
    last = ctx.getImageData(0, 0, w, h);
    const code = jsQR(last.data, w, h, { inversionAttempts: 'attemptBoth' });
    if (code && code.data) return code.data;
  }

  // `last` is the normalized image whenever a second scale was tried, and
  // plain jsQR just failed on those exact pixels — skip the ladder's rung 0.
  return QRGeniePreprocess.decodeLadder(last, jsQR, { skipPlain: true });
}
