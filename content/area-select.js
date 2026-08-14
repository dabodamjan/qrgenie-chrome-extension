/*
 * Drag-to-select overlay for the area scan. Injected on demand into the top
 * frame. On selection it removes itself, waits for the page to repaint (so
 * the dimmed backdrop is not in the screenshot), then reports the CSS-pixel
 * rect to the service worker, which captures and decodes.
 */
(() => {
  if (window.__qrgenieAreaActive) return;
  window.__qrgenieAreaActive = true;

  const host = document.createElement('div');
  host.style.all = 'initial';
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .layer {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      cursor: crosshair;
      background: rgba(10, 14, 28, 0.35);
    }
    .hint {
      position: fixed;
      top: 18px;
      left: 50%;
      transform: translateX(-50%);
      background: #1d2230;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      padding: 7px 14px;
      border-radius: 999px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
      pointer-events: none;
      white-space: nowrap;
    }
    .box {
      position: fixed;
      border: 2px solid #0fb5ba;
      background: rgba(15, 181, 186, 0.12);
      box-shadow: 0 0 0 4000px rgba(10, 14, 28, 0.35);
      display: none;
      pointer-events: none;
    }
  `;
  root.appendChild(style);

  const layer = document.createElement('div');
  layer.className = 'layer';
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'Drag to select the QR code. Press Esc to cancel.';
  const box = document.createElement('div');
  box.className = 'box';
  root.append(layer, hint, box);
  document.documentElement.appendChild(host);

  let startX = 0;
  let startY = 0;
  let dragging = false;

  function cleanup() {
    host.remove();
    document.removeEventListener('keydown', onKey, true);
    window.__qrgenieAreaActive = false;
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      cleanup();
    }
  }

  function currentRect(e) {
    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    return { x, y, w: Math.abs(e.clientX - startX), h: Math.abs(e.clientY - startY) };
  }

  layer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) {
      cleanup();
      return;
    }
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    hint.style.display = 'none';
    // The spotlight box's own shadow now provides the dimming.
    layer.style.background = 'transparent';
  });

  layer.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const r = currentRect(e);
    box.style.display = 'block';
    box.style.left = r.x + 'px';
    box.style.top = r.y + 'px';
    box.style.width = r.w + 'px';
    box.style.height = r.h + 'px';
  });

  layer.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    const r = currentRect(e);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    cleanup();
    if (r.w < 8 || r.h < 8) return;
    // Two frames so the overlay is gone before the tab is captured.
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        setTimeout(() => {
          chrome.runtime.sendMessage({
            type: 'qrgenie:area-selected',
            x: r.x,
            y: r.y,
            w: r.w,
            h: r.h,
            vw,
            vh
          });
        }, 50)
      )
    );
  });

  document.addEventListener('keydown', onKey, true);
})();
