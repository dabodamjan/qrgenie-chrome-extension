/*
 * Maps a CSS-pixel rect (from the page) onto a captured bitmap in device
 * pixels. The capture is in device pixels; the page reports its CSS viewport
 * width, so the scale factor is derived from the two rather than trusting
 * devicePixelRatio (page zoom changes it). Loaded with importScripts() in the
 * service worker and with require() in the Node test suite.
 *
 * mapCaptureRect(bitmapWidth, bitmapHeight, rect) returns {x, y, w, h} in
 * bitmap pixels (with a small padding so jsQR sees the quiet zone), or null
 * when the rect is missing, degenerate, or maps to an unusably small crop.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.QRGenieCrop = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function mapCaptureRect(bitmapWidth, bitmapHeight, rect) {
    if (!rect || !(rect.w > 0) || !(rect.h > 0)) return null;
    if (!(bitmapWidth > 0) || !(bitmapHeight > 0)) return null;

    const scale = rect.vw > 0 ? bitmapWidth / rect.vw : 1;
    let x = Math.max(0, Math.floor(rect.x * scale));
    let y = Math.max(0, Math.floor(rect.y * scale));
    let w = Math.min(bitmapWidth - x, Math.ceil(rect.w * scale));
    let h = Math.min(bitmapHeight - y, Math.ceil(rect.h * scale));
    if (w < 4 || h < 4) return null;

    // A little margin helps jsQR find the quiet zone around the code.
    const pad = Math.round(Math.min(w, h) * 0.05) + 4;
    x = Math.max(0, x - pad);
    y = Math.max(0, y - pad);
    w = Math.min(bitmapWidth - x, w + pad * 2);
    h = Math.min(bitmapHeight - y, h + pad * 2);
    return { x, y, w, h };
  }

  return { mapCaptureRect };
});
