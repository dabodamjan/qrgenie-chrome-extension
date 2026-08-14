/*
 * Service worker: owns the context menus, all decoding, and result routing.
 *
 * Decoding strategy, in order of image quality:
 *   1. data: image URLs decode directly from the URL (no page access needed).
 *   2. A locate script asks the page for the image at its natural resolution
 *      via an untainted canvas (works for same-origin and CORS-enabled
 *      images; no network request, the image is already loaded).
 *   3. Screenshot of the visible tab, cropped to the image's on-screen rect.
 * The area scan always uses the screenshot path.
 *
 * Nothing here talks to the network: captureVisibleTab and data: URLs are
 * local, and the vendored jsQR runs in this worker.
 */
importScripts('vendor/jsQR.js', 'common/payload.js');

const MENU_IMAGE = 'qrgenie-decode-image';
const MENU_AREA = 'qrgenie-scan-area';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_IMAGE,
      title: 'Decode QR code in this image',
      contexts: ['image']
    });
    chrome.contextMenus.create({
      id: MENU_AREA,
      title: 'Scan area for QR code',
      contexts: ['page', 'image']
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || tab.id == null) return;
  if (info.menuItemId === MENU_IMAGE) {
    decodeImageFlow(info, tab).catch((err) => reportFailure(tab.id, 'image', err));
  } else if (info.menuItemId === MENU_AREA) {
    startAreaSelect(tab.id).catch((err) => reportFailure(tab.id, 'area', err));
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;

  if (msg.type === 'qrgenie:start-area') {
    // From the popup. The popup click granted activeTab for this tab.
    startAreaSelect(msg.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true;
  }

  if (msg.type === 'qrgenie:area-selected' && sender.tab && sender.tab.id != null) {
    decodeAreaFlow(msg, sender.tab.id).catch((err) =>
      reportFailure(sender.tab.id, 'area', err)
    );
    return false;
  }

  if (msg.type === 'qrgenie:open-url') {
    // Only plain web links ever get here (classify() vets them), but check
    // again since content scripts are less trusted than this worker.
    if (typeof msg.url === 'string' && /^https?:\/\//i.test(msg.url)) {
      chrome.tabs.create({ url: msg.url });
    }
    return false;
  }

  return false;
});

// ---------------------------------------------------------------------------
// Flows

async function decodeImageFlow(info, tab) {
  const frameId = info.frameId || 0;
  let located = null;

  if (info.srcUrl && info.srcUrl.startsWith('data:')) {
    const result = await decodeFromDataUrl(info.srcUrl);
    if (result) return showResult(tab.id, success(result, 'image'));
  }

  try {
    located = await locateImage(tab.id, frameId, info.srcUrl || '');
  } catch (_) {
    // Page did not let us inject (restricted page); fall through.
  }

  // Best quality: the image itself, exported by the page at natural size.
  if (located && located.dataUrl) {
    const result = await decodeFromDataUrl(located.dataUrl);
    if (result) return showResult(tab.id, success(result, 'image'));
  }

  // Screenshot fallback. Rects from cross-origin iframes are relative to the
  // iframe viewport, so only crop for the top frame; otherwise scan it all.
  const shot = await captureTab(tab.windowId);
  if (shot) {
    const rect = frameId === 0 && located ? located : null;
    const result = await decodeFromCapture(shot, rect);
    if (result) return showResult(tab.id, success(result, 'image'));
  }

  return showResult(tab.id, failure('image'));
}

async function startAreaSelect(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/area-select.js']
  });
}

async function decodeAreaFlow(msg, tabId) {
  const tab = await chrome.tabs.get(tabId);
  const shot = await captureTab(tab.windowId);
  if (shot) {
    const result = await decodeFromCapture(shot, msg);
    if (result) return showResult(tabId, success(result, 'area'));
  }
  return showResult(tabId, failure('area'));
}

// ---------------------------------------------------------------------------
// Page helpers

/*
 * Finds the right-clicked image in the page and returns its viewport rect
 * plus, when the canvas is not tainted, the image itself as a PNG data URL
 * at natural resolution.
 */
function locateImage(tabId, frameId, srcUrl) {
  return chrome.scripting
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

async function showResult(tabId, result) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/overlay.js']
    });
    await chrome.tabs.sendMessage(tabId, { type: 'qrgenie:show-result', result });
  } catch (_) {
    // Restricted page (chrome://, Web Store, PDF viewer): use our own page.
    const hash = encodeURIComponent(JSON.stringify(result));
    await chrome.tabs.create({
      url: chrome.runtime.getURL('viewer/viewer.html') + '#' + hash
    });
  }
}

function reportFailure(tabId, source, err) {
  console.warn('QRGenie decode failed:', err);
  return showResult(tabId, failure(source));
}

// ---------------------------------------------------------------------------
// Decoding

function success(text, source) {
  const payload = QRGeniePayload.classify(text);
  return { ok: true, source, payload };
}

function failure(source) {
  return { ok: false, source };
}

async function captureTab(windowId) {
  try {
    return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
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
 * Decodes a full-tab capture, optionally cropped to a CSS-pixel rect. The
 * capture is in device pixels; the page reports its CSS viewport size, so
 * the scale factor is derived from the two rather than trusting
 * devicePixelRatio (page zoom changes it).
 */
async function decodeFromCapture(captureDataUrl, rect) {
  try {
    const blob = await (await fetch(captureDataUrl)).blob();
    const bitmap = await createImageBitmap(blob);

    if (!rect || !(rect.w > 0) || !(rect.h > 0)) {
      return decodeBitmap(bitmap);
    }

    const scale = rect.vw > 0 ? bitmap.width / rect.vw : 1;
    let x = Math.max(0, Math.floor(rect.x * scale));
    let y = Math.max(0, Math.floor(rect.y * scale));
    let w = Math.min(bitmap.width - x, Math.ceil(rect.w * scale));
    let h = Math.min(bitmap.height - y, Math.ceil(rect.h * scale));
    if (w < 4 || h < 4) return decodeBitmap(bitmap);

    // A little margin helps jsQR find the quiet zone around the code.
    const pad = Math.round(Math.min(w, h) * 0.05) + 4;
    x = Math.max(0, x - pad);
    y = Math.max(0, y - pad);
    w = Math.min(bitmap.width - x, w + pad * 2);
    h = Math.min(bitmap.height - y, h + pad * 2);

    const cropped = await createImageBitmap(bitmap, x, y, w, h);
    return decodeBitmap(cropped) || decodeBitmap(bitmap);
  } catch (_) {
    return null;
  }
}

/*
 * Runs jsQR over the bitmap, retrying at a different scale when the first
 * pass fails: small crops get upscaled (tiny modules), huge captures get
 * downscaled (jsQR's binarizer prefers moderate sizes).
 */
function decodeBitmap(bitmap) {
  const attempts = [1];
  const size = Math.max(bitmap.width, bitmap.height);
  if (size < 300) attempts.push(3);
  else if (size > 1400) attempts.push(900 / size);

  for (const scale of attempts) {
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const code = jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });
    if (code && code.data) return code.data;
  }
  return null;
}
