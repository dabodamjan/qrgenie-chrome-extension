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
  const crop = mapCaptureRect(1250, 1000, { x: 100.4, y: 50.6, w: 200, h: 100, vw: 1000 });
  assert.deepStrictEqual(crop, { x: 115, y: 53, w: 270, h: 145 });
  assertContains(crop, 1250, 1000, 125, 63, 250, 125);
});

test('handles an uneven fractional zoom (scale 1.1)', () => {
  // 50 * 1.1 is 55.000000000000007 in floats; ceil rounds it up to 56.
  const crop = mapCaptureRect(1100, 900, { x: 10, y: 20, w: 50, h: 60, vw: 1000 });
  assert.deepStrictEqual(crop, { x: 4, y: 15, w: 70, h: 80 });
  assertContains(crop, 1100, 900, 11, 22, 55, 66);
});

test('clamps a rect that reaches past the capture edge', () => {
  const crop = mapCaptureRect(1000, 800, { x: 950, y: 750, w: 100, h: 100, vw: 1000 });
  assert.deepStrictEqual(crop, { x: 943, y: 743, w: 57, h: 57 });
  assert.ok(crop.x + crop.w <= 1000);
  assert.ok(crop.y + crop.h <= 800);
});

test('clamps a rect that starts off screen', () => {
  const crop = mapCaptureRect(1000, 800, { x: -30, y: -10, w: 100, h: 100, vw: 1000 });
  assert.deepStrictEqual(crop, { x: 0, y: 0, w: 118, h: 118 });
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
