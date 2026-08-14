/*
 * Preprocessing retry ladder for stylized QR codes. jsQR wants flat, solid,
 * contiguous modules; QRGenie's own product sells dot styles, rounded modules
 * and 3D-rendered codes, so the decoder must not give up after one plain
 * pass. Loaded with importScripts() in the service worker and with require()
 * in the Node test suite, hence the UMD-ish wrapper.
 *
 * decodeLadder(imageData, jsQRFn, opts) runs a bounded sequence of attempts
 * over one already-rasterized image:
 *   0. plain jsQR (inversion is jsQR's own attemptBoth on every rung);
 *      skipped with opts.skipPlain for callers that already tried it
 *   1-2. dark dilation (grayscale min filter) at two radii — turns gapped
 *        dot/rounded modules into solid ones without lightening them
 *   3-4. box blur + Otsu binarization at two radii — merges gaps and
 *        flattens lighting/gradients that defeat jsQR's local binarizer
 *   5. Otsu binarization alone — low-contrast but geometrically clean codes
 * It returns the decoded string or null. Transform work is O(pixels) per
 * rung and every rung is skipped once one decodes, so clean codes pay only
 * for rung 0.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.QRGeniePreprocess = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // RGBA -> single-channel luma (Uint8ClampedArray, w*h).
  function toGray(data, w, h) {
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      gray[i] = data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114;
    }
    return gray;
  }

  // Single channel back to the RGBA layout jsQR expects.
  function grayToRGBA(gray, w, h) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      data[o] = data[o + 1] = data[o + 2] = gray[i];
      data[o + 3] = 255;
    }
    return data;
  }

  // Separable box blur with a (2r+1) window, running-sum per row/column.
  function boxBlur(gray, w, h, r) {
    const tmp = new Uint8ClampedArray(w * h);
    const out = new Uint8ClampedArray(w * h);
    const win = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += gray[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum / win;
        sum += gray[row + Math.min(w - 1, x + r + 1)] - gray[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = sum / win;
        sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }

  /*
   * Separable min filter (dark dilation) with a (2r+1) square window,
   * clamped at the edges. Sliding minimum via a monotonic deque of indices,
   * so the cost is O(1) amortized per pixel regardless of radius — the radius
   * scales with image size, and a windowed scan was seconds on large captures.
   */
  function minFilter(gray, w, h, r) {
    const tmp = new Uint8ClampedArray(w * h);
    const out = new Uint8ClampedArray(w * h);
    const deque = new Int32Array(Math.max(w, h));
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let head = 0;
      let tail = 0;
      for (let i = 0; i < w + r; i++) {
        if (i < w) {
          const v = gray[row + i];
          while (tail > head && gray[row + deque[tail - 1]] >= v) tail--;
          deque[tail++] = i;
        }
        const x = i - r;
        if (x >= 0) {
          while (deque[head] < x - r) head++;
          tmp[row + x] = gray[row + deque[head]];
        }
      }
    }
    for (let x = 0; x < w; x++) {
      let head = 0;
      let tail = 0;
      for (let i = 0; i < h + r; i++) {
        if (i < h) {
          const v = tmp[i * w + x];
          while (tail > head && tmp[deque[tail - 1] * w + x] >= v) tail--;
          deque[tail++] = i;
        }
        const y = i - r;
        if (y >= 0) {
          while (deque[head] < y - r) head++;
          out[y * w + x] = tmp[deque[head] * w + x];
        }
      }
    }
    return out;
  }

  // Otsu's threshold over the gray histogram.
  function otsu(gray) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    const total = gray.length;
    let sumAll = 0;
    for (let t = 0; t < 256; t++) sumAll += t * hist[t];
    let sumBg = 0;
    let weightBg = 0;
    let best = 0;
    let threshold = 127;
    for (let t = 0; t < 256; t++) {
      weightBg += hist[t];
      if (weightBg === 0) continue;
      const weightFg = total - weightBg;
      if (weightFg === 0) break;
      sumBg += t * hist[t];
      const meanBg = sumBg / weightBg;
      const meanFg = (sumAll - sumBg) / weightFg;
      const between = weightBg * weightFg * (meanBg - meanFg) * (meanBg - meanFg);
      if (between > best) {
        best = between;
        threshold = t;
      }
    }
    return threshold;
  }

  function binarize(gray, threshold) {
    const out = new Uint8ClampedArray(gray.length);
    for (let i = 0; i < gray.length; i++) out[i] = gray[i] <= threshold ? 0 : 255;
    return out;
  }

  /*
   * The preprocessed variants for one image, as thunks so a rung is only
   * computed when every rung before it failed to decode. Radii scale with
   * the image so the same ladder works on a small crop and on a full-tab
   * capture (the caller already normalizes extreme sizes).
   */
  function variants(imageData) {
    const w = imageData.width;
    const h = imageData.height;
    const base = Math.max(1, Math.round(Math.min(w, h) / 200));
    let gray = null;
    const grayOf = () => (gray = gray || toGray(imageData.data, w, h));
    const wrap = (g) => ({ data: grayToRGBA(g, w, h), width: w, height: h });
    return [
      () => wrap(minFilter(grayOf(), w, h, base)),
      () => wrap(minFilter(grayOf(), w, h, base * 2 + 1)),
      () => {
        const blurred = boxBlur(grayOf(), w, h, base);
        return wrap(binarize(blurred, otsu(blurred)));
      },
      () => {
        const blurred = boxBlur(grayOf(), w, h, base * 2 + 1);
        return wrap(binarize(blurred, otsu(blurred)));
      },
      () => wrap(binarize(grayOf(), otsu(grayOf())))
    ];
  }

  // opts.skipPlain drops rung 0 for callers that already ran plain jsQR on
  // these exact pixels (background.js decodeBitmap); direct/test use keeps it.
  function decodeLadder(imageData, jsQRFn, opts) {
    const jsqrOpts = { inversionAttempts: 'attemptBoth' };
    if (!opts || !opts.skipPlain) {
      const plain = jsQRFn(imageData.data, imageData.width, imageData.height, jsqrOpts);
      if (plain && plain.data) return plain.data;
    }
    for (const make of variants(imageData)) {
      const v = make();
      const code = jsQRFn(v.data, v.width, v.height, jsqrOpts);
      if (code && code.data) return code.data;
    }
    return null;
  }

  return { toGray, grayToRGBA, boxBlur, minFilter, otsu, binarize, variants, decodeLadder };
});
