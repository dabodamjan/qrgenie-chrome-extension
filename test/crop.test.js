'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { mapCaptureRect } = require('../common/crop.js');

// Sanity for every crop: stays inside the bitmap and still contains the
// region the caller asked for.
function assertContains(crop, bitmapW, bitmapH, px, py, pw, ph) {
  assert.ok(crop.x >= 0 && crop.y >= 0);
  assert.ok(crop.x + crop.w <= bitmapW);
  assert.ok(crop.y + crop.h <= bitmapH);
  assert.ok(crop.x <= px, 'crop starts at or before the region');
  assert.ok(crop.y <= py);
  assert.ok(crop.x + crop.w >= Math.min(bitmapW, px + pw), 'crop covers the region');
  assert.ok(crop.y + crop.h >= Math.min(bitmapH, py + ph));
}

test('maps 1:1 when capture and viewport agree (scale 1)', () => {
  const crop = mapCaptureRect(1000, 800, { x: 100, y: 50, w: 200, h: 100, vw: 1000 });
  assert.deepStrictEqual(crop, { x: 91, y: 41, w: 218, h: 118 });
  assertContains(crop, 1000, 800, 100, 50, 200, 100);
});

test('doubles coordinates on a 2x display', () => {
  const crop = mapCaptureRect(2000, 1600, { x: 100, y: 50, w: 200, h: 100, vw: 1000 });
  assert.deepStrictEqual(crop, { x: 186, y: 86, w: 428, h: 228 });
  assertContains(crop, 2000, 1600, 200, 100, 400, 200);
});

test('handles a fractional zoom (scale 1.25) with fractional CSS coords', () => {
  // Far edge lands on 375.5 device px; the crop has to reach 376, not 375.
  const crop = mapCaptureRect(1250, 1000, { x: 100.4, y: 50.6, w: 200, h: 100, vw: 1000 });
  assert.deepStrictEqual(crop, { x: 115, y: 53, w: 271, h: 146 });
  assertContains(crop, 1250, 1000, 125, 63, 250, 125);
});

test('handles an uneven fractional zoom (scale 1.1)', () => {
  // Both edges are scaled and rounded outward, so float noise in the
  // multiplication can only ever grow the crop, never clip the region.
  const crop = mapCaptureRect(1100, 900, { x: 10, y: 20, w: 50, h: 60, vw: 1000 });
  assert.deepStrictEqual(crop, { x: 4, y: 15, w: 69, h: 80 });
  assertContains(crop, 1100, 900, 11, 22, 55, 66);
});

test('clamps a rect that reaches past the capture edge', () => {
  const crop = mapCaptureRect(1000, 800, { x: 950, y: 750, w: 100, h: 100, vw: 1000 });
  assert.deepStrictEqual(crop, { x: 943, y: 743, w: 57, h: 57 });
  assert.ok(crop.x + crop.w <= 1000);
  assert.ok(crop.y + crop.h <= 800);
});

test('keeps only the visible part of a rect that starts off screen', () => {
  // Visible region is x 0..70, y 0..90. Clamping the near edge to 0 and then
  // applying the full width would stretch the crop to 100x100 plus padding.
  const crop = mapCaptureRect(1000, 800, { x: -30, y: -10, w: 100, h: 100, vw: 1000 });
  assert.deepStrictEqual(crop, { x: 0, y: 0, w: 86, h: 106 });
});

test('does not expand a rect hanging off the left past its far edge', () => {
  const crop = mapCaptureRect(1000, 800, { x: -30, y: 100, w: 100, h: 100, vw: 1000 });
  // On screen the rect ends at x = 70; only the quiet-zone padding goes beyond.
  assert.deepStrictEqual(crop, { x: 0, y: 92, w: 86, h: 116 });
  assert.ok(crop.x + crop.w < 100, 'crop stops near the visible far edge');
  assertContains(crop, 1000, 800, 0, 100, 70, 100);
});

test('falls back to scale 1 when the viewport width is missing', () => {
  const crop = mapCaptureRect(1000, 800, { x: 10, y: 10, w: 50, h: 50 });
  assert.deepStrictEqual(crop, { x: 3, y: 3, w: 64, h: 64 });
});

test('returns null for missing or degenerate rects', () => {
  assert.strictEqual(mapCaptureRect(1000, 800, null), null);
  assert.strictEqual(mapCaptureRect(1000, 800, { x: 0, y: 0, w: 0, h: 50, vw: 1000 }), null);
  assert.strictEqual(mapCaptureRect(1000, 800, { x: 0, y: 0, w: 50, h: -1, vw: 1000 }), null);
  assert.strictEqual(mapCaptureRect(0, 0, { x: 0, y: 0, w: 50, h: 50, vw: 1000 }), null);
});

test('returns null for crops too small to hold a QR code', () => {
  assert.strictEqual(mapCaptureRect(1000, 800, { x: 10, y: 10, w: 1, h: 1, vw: 1000 }), null);
  assert.strictEqual(mapCaptureRect(1000, 800, { x: 10, y: 10, w: 3, h: 3, vw: 1000 }), null);
  // Rect hangs so far off the edge that almost nothing is left on screen.
  assert.strictEqual(mapCaptureRect(1000, 800, { x: 998, y: 10, w: 50, h: 50, vw: 1000 }), null);
});
