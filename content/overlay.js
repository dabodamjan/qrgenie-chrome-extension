/*
 * Result card and decoding indicator, injected on demand into the top frame.
 * Both live in closed shadow roots so page CSS cannot restyle them.
 * Re-injection is a no-op; the worker drives them with messages:
 *   qrgenie:show-busy              a decode started, spin the indicator
 *   qrgenie:hide-for-capture       take what we drew off screen for a capture
 *   qrgenie:restore-after-capture  put it back
 *   qrgenie:show-result            the decode finished, card replaces indicator
 *
 * Every message carries the id of the scan that sent it. Two scans can be in
 * flight in one tab (a right-click decode while an area scan is still working),
 * and without ids the older one gets to undo the newer one's work: restoring
 * the indicator into the newer scan's screenshot, or replacing its indicator
 * with a stale result. So the newest id wins and older ones are dropped.
 *
 * The answers carry the newest id this page has seen, which is how a worker
 * whose ids fell behind the page finds out (see the listener at the bottom).
 */
(() => {
  if (window.__qrgenieOverlay) return;

  // Firefox only guarantees promises on browser.*; Chrome and Edge on chrome.*.
  const api = globalThis.browser ?? globalThis.chrome;

  const state = {
    host: null,
    root: null,
    busyHost: null,
    busyFade: 0,
    busyMax: 0,
    // Highest scan id seen; one lease per capture in flight (see hideNow); and
    // everything those leases took off screen.
    op: 0,
    leases: new Map(),
    hidden: new Set()
  };

  // Messages with no id at all come from a worker that predates them. They
  // count as current only until an id-carrying scan has spoken: after that,
  // an id-less message can only be older than what we have already applied,
  // and treating it as current would let it undo a live scan's work forever.
  function opOf(msg) {
    if (typeof msg.op === 'number' && Number.isFinite(msg.op)) return msg.op;
    return state.op > 0 ? null : Infinity;
  }

  // True when a newer scan has already announced itself.
  function superseded(op) {
    return op < state.op;
  }

  function claim(op) {
    if (op > state.op && op !== Infinity) state.op = op;
  }

  const CSS = `
    :host { all: initial; }
    .card {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      width: 340px;
      max-width: calc(100vw - 32px);
      box-sizing: border-box;
      background: #ffffff;
      color: #003c3d;
      border-radius: 14px;
      box-shadow: 0 8px 30px rgba(0, 45, 46, 0.25), 0 0 0 1px rgba(0, 45, 46, 0.06);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.45;
      overflow: hidden;
    }
    .top {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: linear-gradient(120deg, #007173, #15803d);
      color: #fff;
    }
    .top .name { font-weight: 600; font-size: 13px; letter-spacing: 0.2px; flex: 1; }
    .glyph { width: 16px; height: 16px; flex: none; }
    .close {
      all: unset;
      cursor: pointer;
      width: 22px;
      height: 22px;
      border-radius: 6px;
      text-align: center;
      line-height: 22px;
      font-size: 15px;
      color: #fff;
    }
    .close:hover { background: rgba(255, 255, 255, 0.22); }
    .body { padding: 12px; }
    .chip {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.3px;
      text-transform: uppercase;
      color: #15803d;
      background: rgba(34, 197, 94, 0.14);
      border-radius: 999px;
      padding: 2px 9px;
      margin-bottom: 8px;
    }
    .raw {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12.5px;
      background: #eef7f7;
      border-radius: 8px;
      padding: 8px 10px;
      max-height: 130px;
      overflow: auto;
      word-break: break-all;
      white-space: pre-wrap;
      user-select: all;
    }
    .fields { margin: 8px 0 0; padding: 0; list-style: none; }
    .fields li { display: flex; gap: 8px; margin-top: 4px; font-size: 12.5px; }
    .fields .k { color: #527273; flex: none; min-width: 70px; }
    .fields .v { word-break: break-all; }
    .actions { display: flex; gap: 8px; margin-top: 12px; }
    .btn {
      all: unset;
      cursor: pointer;
      flex: 1;
      text-align: center;
      padding: 7px 10px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 13px;
      background: #e3f2f2;
      color: #003c3d;
      box-sizing: border-box;
    }
    .btn:hover { background: #d2eaea; }
    .btn.primary { background: linear-gradient(120deg, #007173, #15803d); color: #fff; }
    .btn.primary:hover { filter: brightness(1.06); }
    .error { color: #003c3d; }
    .hint { color: #527273; font-size: 12.5px; margin-top: 6px; }
    .foot {
      padding: 8px 12px;
      border-top: 1px solid #dff0f0;
      font-size: 11.5px;
      color: #527273;
      display: flex;
      justify-content: space-between;
    }
    .foot a { color: #007173; text-decoration: none; }
    .foot a:hover { text-decoration: underline; }
    @media (prefers-color-scheme: dark) {
      .card { background: #003c3d; color: #e6f7f7; box-shadow: 0 8px 30px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08); }
      .raw { background: #002021; }
      .btn { background: #0b4f50; color: #e6f7f7; }
      .btn:hover { background: #116162; }
      .fields .k, .hint, .foot { color: #8fc0c0; }
      .foot { border-top-color: #0b4f50; }
      .chip { color: #86efac; background: rgba(34, 197, 94, 0.18); }
      .foot a { color: #4ce3e6; }
      .error { color: #e6f7f7; }
    }
  `;

  /*
   * The indicator borrows the card's surface, shadow and corner so the two
   * read as one thing, and sits where the card will appear.
   */
  const BUSY_CSS = `
    :host { all: initial; }
    .pill {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 10px;
      box-sizing: border-box;
      max-width: calc(100vw - 32px);
      padding: 9px 15px 9px 12px;
      border-radius: 999px;
      background: #ffffff;
      color: #003c3d;
      box-shadow: 0 8px 30px rgba(0, 45, 46, 0.25), 0 0 0 1px rgba(0, 45, 46, 0.06);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.3;
      overflow: hidden;
      opacity: 0;
      transition: opacity 140ms ease-out;
      /* Nothing to click: a page button under it stays reachable. */
      pointer-events: none;
    }
    .pill.in { opacity: 1; }
    .label { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .spinner {
      width: 15px;
      height: 15px;
      flex: none;
      border-radius: 50%;
      border: 2px solid rgba(0, 113, 115, 0.22);
      border-top-color: #007173;
      animation: qrgenie-spin 0.7s linear infinite;
    }
    @keyframes qrgenie-spin { to { transform: rotate(360deg); } }
    @keyframes qrgenie-pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .spinner { animation: qrgenie-pulse 1.4s ease-in-out infinite; }
    }
    @media (prefers-color-scheme: dark) {
      .pill {
        background: #003c3d;
        color: #e6f7f7;
        box-shadow: 0 8px 30px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08);
      }
      .spinner { border-color: rgba(76, 227, 230, 0.25); border-top-color: #4ce3e6; }
    }
  `;

  const BUSY_LABELS = {
    image: 'Looking for a QR code',
    area: 'Scanning the selected area'
  };

  // The indicator only ever goes away because the worker reported back. If the
  // worker dies mid-decode (a terminated service worker, a crashed decode) no
  // message ever arrives, so it also gives up on its own.
  const BUSY_MAX_MS = 20000;

  // Long enough for the page to paint a frame without the indicator before a
  // capture: two frames plus a beat, the same wait area-select.js uses.
  const REPAINT_MS = 50;

  // requestAnimationFrame does not fire in an occluded window, and the worker
  // now treats a missing answer as a reason not to capture at all, so the
  // answer also goes out on a plain timer.
  const REPAINT_FALLBACK_MS = 300;

  // A capture leaves everything of ours hidden until the worker says the
  // screenshot is taken. If that word never comes (the worker was terminated
  // mid-decode) the page must not keep an invisible indicator forever, so each
  // capture's lease expires on its own. The worker knows this number too and
  // throws away a screenshot that could have landed after the lease lapsed.
  const CAPTURE_MAX_MS = 5000;

  const GLYPH =
    '<svg class="glyph" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path fill="#fff" d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm8-2h3v3h-3v-3zm5 0h3v3h-3v-3zm-5 5h3v3h-3v-3zm5 0h3v3h-3v-3z"/></svg>';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function remove() {
    if (state.host) {
      untrack(state.host);
      state.host.remove();
      state.host = null;
      state.root = null;
      document.removeEventListener('keydown', onKey, true);
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      remove();
      e.stopPropagation();
    }
  }

  // Original button labels, so repeated clicks never leave a flash label
  // ('Copied', 'Copy failed') as the button's resting text.
  const labels = new WeakMap();
  const flashTimers = new WeakMap();

  function flash(btn, label) {
    if (!labels.has(btn)) labels.set(btn, btn.textContent);
    btn.textContent = label;
    clearTimeout(flashTimers.get(btn));
    flashTimers.set(
      btn,
      setTimeout(() => { btn.textContent = labels.get(btn); }, 1200)
    );
  }

  function copyText(text, btn) {
    const fallback = () => {
      // The textarea stays inside our closed shadow root: putting it in the
      // page's light DOM would let a hostile page's MutationObserver read
      // the payload (Wi-Fi password, OTP secret) before it is removed.
      if (!state.root) return flash(btn, 'Copy failed');
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      state.root.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) {}
      ta.remove();
      // execCommand returns false when the page or the browser refuses the
      // copy; saying "Copied" then would be a lie. The raw payload above the
      // button stays selectable either way.
      flash(btn, ok ? 'Copied' : 'Copy failed');
    };

    // navigator.clipboard is absent outside secure contexts and in some
    // embedders, so it cannot be dereferenced before the fallback is reachable.
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') return fallback();
    let pending;
    try {
      pending = clipboard.writeText(text);
    } catch (_) {
      return fallback();
    }
    Promise.resolve(pending).then(() => flash(btn, 'Copied'), fallback);
  }

  function showBusy(source) {
    // A new scan supersedes whatever the last one put on screen; the card and
    // the indicator share the same corner.
    remove();
    removeBusy();

    const host = document.createElement('div');
    host.style.all = 'initial';
    const root = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = BUSY_CSS;
    root.appendChild(style);

    const pill = document.createElement('div');
    pill.className = 'pill';
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = BUSY_LABELS[source] || BUSY_LABELS.image;
    pill.append(spinner, label);
    root.appendChild(pill);

    trackDuringCapture(host);
    (document.body || document.documentElement).appendChild(host);
    state.busyHost = host;

    // Fading in on a delay keeps a quick decode from flashing the indicator:
    // a clean code is done and the card is up before this fires.
    state.busyFade = setTimeout(() => pill.classList.add('in'), 200);
    state.busyMax = setTimeout(removeBusy, BUSY_MAX_MS);
  }

  function removeBusy() {
    clearTimeout(state.busyFade);
    clearTimeout(state.busyMax);
    if (state.busyHost) {
      untrack(state.busyHost);
      state.busyHost.remove();
      state.busyHost = null;
    }
  }

  /*
   * The screenshot decode path photographs the visible tab, and everything we
   * put on the page is in that photograph: the indicator, and a card left over
   * from an earlier scan, both sitting in the top right corner where a QR code
   * can just as well be. So they step aside for the capture, and we only
   * answer once the page has painted without them.
   *
   * What gets restored afterwards is exactly what was hidden: restoring
   * "whatever is on screen now" would put an older scan's indicator back into
   * a newer scan's screenshot.
   *
   * Each capture takes its own lease, keyed by the scan that asked for it, and
   * the page stays clear until every outstanding lease is released. Ordering
   * between two scans is not something the page can rely on: scan 2 can hide,
   * scan 1 can hide, and scan 2 can be photographed and restore while scan 1's
   * screenshot is still to come. Counting leases holds through all of them;
   * remembering only the newest capture does not.
   */
  function hideNow(op) {
    const lease = state.leases.get(op);
    if (lease) clearTimeout(lease.timer);
    state.leases.set(op, { timer: setTimeout(() => release(op), CAPTURE_MAX_MS) });
    for (const host of [state.host, state.busyHost]) {
      if (host) hide(host);
    }
    return true;
  }

  function hide(host) {
    host.style.display = 'none';
    state.hidden.add(host);
  }

  function hideForCapture(op, done) {
    hideNow(op);
    // Nothing of ours was on screen, so there is no repaint to wait for. The
    // lease is held regardless: anything drawn before the worker restores
    // still has to keep out of the screenshot.
    if (!state.hidden.size) return done();

    let answered = false;
    const answer = () => {
      if (answered) return;
      answered = true;
      done();
    };
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setTimeout(answer, REPAINT_MS))
    );
    setTimeout(answer, REPAINT_FALLBACK_MS);
  }

  /*
   * Gives one capture's lease back, whether because the worker said so or
   * because the lease ran out. The page is uncovered only by the last one:
   * releasing early is what would drop an older scan's indicator into a newer
   * scan's screenshot.
   */
  function release(op) {
    const lease = state.leases.get(op);
    if (!lease) return;
    clearTimeout(lease.timer);
    state.leases.delete(op);
    if (state.leases.size) return;
    for (const host of state.hidden) host.style.display = '';
    state.hidden.clear();
  }

  function restoreAfterCapture(op) {
    release(op);
  }

  // Anything drawn while a capture is in flight joins the hiding: a newer
  // scan raising its indicator must not walk into an older scan's screenshot.
  function trackDuringCapture(host) {
    if (state.leases.size) hide(host);
  }

  function untrack(host) {
    state.hidden.delete(host);
  }

  function show(result) {
    remove();
    removeBusy();

    const host = document.createElement('div');
    host.style.all = 'initial';
    const root = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    const card = document.createElement('div');
    card.className = 'card';

    let bodyHtml;
    if (result.ok) {
      const p = result.payload;
      const fields = (p.fields || [])
        .map((f) => `<li><span class="k">${esc(f.name)}</span><span class="v">${esc(f.value)}</span></li>`)
        .join('');
      const origin = result.fromVisibleTab
        ? '<div class="hint">The image itself could not be read, so this code was found on the visible part of the tab.</div>'
        : '';
      bodyHtml = `
        <span class="chip">${esc(p.label)}</span>
        <div class="raw">${esc(p.raw)}</div>
        ${fields ? `<ul class="fields">${fields}</ul>` : ''}
        ${origin}
        <div class="actions">
          <button class="btn" data-act="copy">Copy</button>
          ${p.url ? '<button class="btn primary" data-act="open">Open link</button>' : ''}
        </div>`;
    } else if (result.reason === 'blocked') {
      bodyHtml = `
        <div class="error">Your browser does not let extensions scan this page.</div>
        <div class="hint">Browser pages, extension stores and the built-in PDF viewer are off limits. Try the scan on a regular website.</div>`;
    } else if (result.reason === 'page-busy') {
      // Either the screenshot was never taken or it was thrown away, rather
      // than risk decoding a photograph of this card. Saying "no QR code
      // found" here would be a decode we never ran.
      bodyHtml = `
        <div class="error">The page took too long, so no screenshot was decoded.</div>
        <div class="hint">Nothing was scanned. Try again in a moment.</div>`;
    } else {
      const what = result.source === 'area' ? 'in that area' : 'in this image';
      bodyHtml = `
        <div class="error">We could not find a QR code ${what}.</div>
        <div class="hint">Try zooming the page so the code appears larger, then scan again.</div>`;
    }

    card.innerHTML = `
      <div class="top">${GLYPH}<span class="name">QR code result</span>
        <button class="close" title="Close">&#10005;</button></div>
      <div class="body">${bodyHtml}</div>
      <div class="foot"><span>Decoded on your device</span>
        <a href="https://qrgenie.app" target="_blank" rel="noopener">Made by QRGenie</a></div>`;

    card.querySelector('.close').addEventListener('click', remove);
    const copyBtn = card.querySelector('[data-act="copy"]');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => copyText(result.payload.raw, copyBtn));
    }
    const openBtn = card.querySelector('[data-act="open"]');
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        api.runtime.sendMessage({ type: 'qrgenie:open-url', url: result.payload.url });
      });
    }

    root.appendChild(card);
    trackDuringCapture(host);
    (document.body || document.documentElement).appendChild(host);
    state.host = host;
    state.root = root;
    document.addEventListener('keydown', onKey, true);
  }

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return false;
    const op = opOf(msg);
    // An id-less message from a worker that has already been outlived (see
    // opOf). Answering it would be answering for a scan that no longer exists.
    if (op === null) return false;

    if (msg.type === 'qrgenie:hide-for-capture') {
      // The one message we honour even from a superseded scan: hiding is
      // always safe, and the worker treats anything but a plain yes here as a
      // reason not to capture at all.
      claim(op);
      hideForCapture(op, () => sendResponse({ hidden: true, op: state.op }));
      return true;
    }

    if (msg.type === 'qrgenie:restore-after-capture') {
      // Gated on the capture's own lease, not on the newest scan: a scan that
      // raised its indicator without capturing must not strand it off screen.
      restoreAfterCapture(op);
      return false;
    }

    // What is left draws on screen, and a scan that a newer one has replaced
    // no longer owns that corner: its late result would clear a live
    // indicator, its late indicator would clear a fresh result.
    //
    // Either way the answer names the newest id we have seen. The worker seeds
    // its ids from the clock, so a clock set backwards plus a worker restart
    // can put it behind this page and every message it sends would be dropped
    // here in silence; the id in this answer is how it finds that out.
    if (superseded(op)) {
      sendResponse({ applied: false, op: state.op });
      return false;
    }
    claim(op);

    if (msg.type === 'qrgenie:show-result') show(msg.result);
    else if (msg.type === 'qrgenie:show-busy') showBusy(msg.source);
    else return false;

    sendResponse({ applied: true, op: state.op });
    return false;
  });

  // The worker's fallback when this listener does not answer in time: same
  // hiding, without the wait for a repaint (the worker waits instead). It
  // lives on the content script's own window, which the page cannot reach.
  window.__qrgenieHideNow = hideNow;

  window.__qrgenieOverlay = true;
})();
