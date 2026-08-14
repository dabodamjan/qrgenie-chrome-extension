/*
 * Regenerates test/fixtures/*.png. One-off; the fixtures are committed and
 * the test suite has no dependencies. To rerun the clean base fixtures you
 * need the qrcode package on the module path:
 *   npm install --no-save qrcode && node scripts/make-fixtures.js
 *
 * The stylized fixtures (dots, rounded, skewed) are re-rendered from the
 * committed clean PNGs — the module matrix is sampled back out of the image —
 * so they regenerate without qrcode installed; with it absent the clean
 * fixtures are just kept as committed.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { encodePNG } = require('./make-icons');
const { decodePNG } = require('../test/helpers/png.js');

let QRCode = null;
try {
  QRCode = require('qrcode');
} catch (_) {
  // Offline / not installed: keep the committed clean fixtures.
}

const DIR = path.join(__dirname, '..', 'test', 'fixtures');

const FIXTURES = [
  { file: 'url.png', text: 'https://qrgenie.app', opts: { scale: 8, margin: 4 } },
  { file: 'text.png', text: 'Hello from QRGenie', opts: { scale: 6, margin: 4 } },
  {
    file: 'wifi.png',
    text: 'WIFI:T:WPA;S:QRGenie Guest;P:decode1234;;',
    opts: { scale: 6, margin: 4 }
  },
  {
    file: 'small.png',
    text: 'https://example.com/qr-small',
    opts: { scale: 2, margin: 2 }
  },
  {
    file: 'inverted.png',
    text: 'inverted colors still decode',
    opts: {
      scale: 6,
      margin: 4,
      color: { dark: '#ffffffff', light: '#000000ff' }
    }
  }
];

/*
 * Stylized variants, rendered from the module matrix of a clean fixture:
 *   dots.png    modules as circles at ~70% of the cell (gapped, "dot style")
 *   rounded.png modules as rounded squares at ~90% of the cell
 *   skewed.png  a clean render pushed through a mild perspective warp
 * These defeat a plain jsQR pass and are the regression set for the
 * preprocessing ladder in common/preprocess.js.
 */
const STYLIZED = [
  { file: 'dots.png', from: 'url.png', scale: 8, style: 'dots' },
  { file: 'rounded.png', from: 'text.png', scale: 6, style: 'rounded' },
  { file: 'skewed.png', from: 'wifi.png', scale: 6, style: 'skew' }
];

// Samples the module matrix back out of a committed clean fixture. The clean
// fixtures are rendered by qrcode at a known integer scale with a quiet zone,
// so the cell centers land on exact pixels; the quiet zone is trimmed off by
// the dark-cell bounding box.
function matrixFromPng(file, scale) {
  const { width, data } = decodePNG(fs.readFileSync(path.join(DIR, file)));
  const cells = Math.round(width / scale);
  const dark = (cx, cy) => {
    const px = cx * scale + Math.floor(scale / 2);
    const py = cy * scale + Math.floor(scale / 2);
    return data[(py * width + px) * 4] < 128;
  };
  let minX = cells, minY = cells, maxX = -1, maxY = -1;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      if (dark(x, y)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const n = maxX - minX + 1;
  const m = [];
  for (let y = 0; y < n; y++) {
    m.push([]);
    for (let x = 0; x < n; x++) m[y].push(dark(minX + x, minY + y));
  }
  return m;
}

function grayToPng(gray, w, h) {
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = gray[i];
    rgba[i * 4 + 3] = 255;
  }
  return encodePNG(rgba, w, h);
}

// Renders the matrix with a per-module shape test, 4x supersampled.
// inShape(u, v) gets module-local coordinates in [0, 1).
function renderShaped(matrix, cell, margin, inShape) {
  const n = matrix.length;
  const size = (n + 2 * margin) * cell;
  const ss = 4;
  const gray = Buffer.alloc(size * size, 255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;
          const mx = Math.floor(px / cell) - margin;
          const my = Math.floor(py / cell) - margin;
          if (mx < 0 || my < 0 || mx >= n || my >= n || !matrix[my][mx]) continue;
          const u = px / cell - Math.floor(px / cell);
          const v = py / cell - Math.floor(py / cell);
          if (inShape(u, v)) hits++;
        }
      }
      gray[y * size + x] = Math.round(255 * (1 - hits / (ss * ss)));
    }
  }
  return { gray, size };
}

function inDot(u, v) {
  // Circle at 70% of the cell.
  return Math.hypot(u - 0.5, v - 0.5) <= 0.35;
}

function inRounded(u, v) {
  // Rounded square at 90% of the cell, corner radius 30%.
  const half = 0.45;
  const r = 0.3;
  const dx = Math.abs(u - 0.5);
  const dy = Math.abs(v - 0.5);
  if (dx > half || dy > half) return false;
  const cx = Math.max(0, dx - (half - r));
  const cy = Math.max(0, dy - (half - r));
  return cx * cx + cy * cy <= r * r;
}

// Homography sending the unit square's corners (TL, TR, BR, BL order) to a quad.
function squareToQuad(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dy1 = y1 - y2;
  const dx2 = x3 - x2, dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - sy * dx2) / den;
  const h = (dx1 * sy - dy1 * sx) / den;
  return [
    x1 - x0 + g * x1, x3 - x0 + h * x3, x0,
    y1 - y0 + g * y1, y3 - y0 + h * y3, y0,
    g, h, 1
  ];
}

function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = c * h - b * i, C = b * f - c * e;
  const D = f * g - d * i, E = a * i - c * g, F = c * d - a * f;
  const G = d * h - e * g, H = b * g - a * h, I = a * e - b * d;
  const det = a * A + b * D + c * G;
  return [A, B, C, D, E, F, G, H, I].map((v) => v / det);
}

// Warps a clean render through a mild perspective, bilinear-sampled.
function warpPerspective(gray, size) {
  const W = size;
  // Destination quad, mildly tilted (the kind a 3D-rendered hero code has).
  const quad = [
    [0.06 * W, 0.045 * W],
    [0.955 * W, 0.005 * W],
    [0.93 * W, 0.95 * W],
    [0.02 * W, 0.985 * W]
  ];
  const toUnit = invert3(squareToQuad(quad));
  const out = Buffer.alloc(W * W, 255);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const px = x + 0.5, py = y + 0.5;
      const wq = toUnit[6] * px + toUnit[7] * py + toUnit[8];
      const u = (toUnit[0] * px + toUnit[1] * py + toUnit[2]) / wq;
      const v = (toUnit[3] * px + toUnit[4] * py + toUnit[5]) / wq;
      if (u < 0 || v < 0 || u >= 1 || v >= 1) continue;
      const sx = Math.min(size - 1.001, Math.max(0, u * size - 0.5));
      const sy = Math.min(size - 1.001, Math.max(0, v * size - 0.5));
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;
      const g00 = gray[y0 * size + x0];
      const g10 = gray[y0 * size + x0 + 1];
      const g01 = gray[(y0 + 1) * size + x0];
      const g11 = gray[(y0 + 1) * size + x0 + 1];
      out[y * W + x] = Math.round(
        g00 * (1 - fx) * (1 - fy) + g10 * fx * (1 - fy) +
        g01 * (1 - fx) * fy + g11 * fx * fy
      );
    }
  }
  return out;
}

function makeStylized(spec) {
  const matrix = matrixFromPng(spec.from, spec.scale);
  const cell = 10;
  const margin = 4;
  if (spec.style === 'dots') {
    const { gray, size } = renderShaped(matrix, cell, margin, inDot);
    return grayToPng(gray, size, size);
  }
  if (spec.style === 'rounded') {
    const { gray, size } = renderShaped(matrix, cell, margin, inRounded);
    return grayToPng(gray, size, size);
  }
  // skew: clean square modules, then the perspective warp.
  const { gray, size } = renderShaped(matrix, cell, margin, () => true);
  return grayToPng(warpPerspective(gray, size), size, size);
}

// A gradient with circles and no QR code, for the negative test.
function makeNoQr() {
  const size = 200;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      let r = 40 + (x / size) * 160;
      let g = 80 + (y / size) * 120;
      let b = 160;
      for (const [cx, cy, rad] of [[60, 60, 30], [140, 110, 40], [80, 160, 25]]) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < rad) { r = 255 - r; g = 255 - g; b = 90; }
      }
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
    }
  }
  return encodePNG(rgba, size, size);
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  if (QRCode) {
    for (const f of FIXTURES) {
      await QRCode.toFile(path.join(DIR, f.file), f.text, f.opts);
      console.log('wrote', f.file);
    }
  } else {
    console.log('qrcode package not installed; keeping committed clean fixtures');
  }
  for (const s of STYLIZED) {
    fs.writeFileSync(path.join(DIR, s.file), makeStylized(s));
    console.log('wrote', s.file);
  }
  fs.writeFileSync(path.join(DIR, 'no-qr.png'), makeNoQr());
  console.log('wrote no-qr.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
