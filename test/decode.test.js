'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const jsQR = require('../vendor/jsQR.js');
const QRGeniePreprocess = require('../common/preprocess.js');
const { decodePNG } = require('./helpers/png.js');

function readFixture(name) {
  const buf = fs.readFileSync(path.join(__dirname, 'fixtures', name));
  return decodePNG(buf);
}

// Same decode options the service worker uses on its first rung.
function decodeFixture(name) {
  const { width, height, data } = readFixture(name);
  return jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
}

// The full preprocessing ladder the service worker falls back to.
function decodeLadderFixture(name) {
  return QRGeniePreprocess.decodeLadder(readFixture(name), jsQR);
}

test('decodes a URL QR code', () => {
  const code = decodeFixture('url.png');
  assert.ok(code, 'expected a decode result');
  assert.strictEqual(code.data, 'https://qrgenie.app');
});

test('decodes a plain text QR code', () => {
  const code = decodeFixture('text.png');
  assert.ok(code);
  assert.strictEqual(code.data, 'Hello from QRGenie');
});

test('decodes a Wi-Fi QR code', () => {
  const code = decodeFixture('wifi.png');
  assert.ok(code);
  assert.strictEqual(code.data, 'WIFI:T:WPA;S:QRGenie Guest;P:decode1234;;');
});

test('decodes a small low-resolution QR code', () => {
  const code = decodeFixture('small.png');
  assert.ok(code);
  assert.strictEqual(code.data, 'https://example.com/qr-small');
});

test('decodes an inverted (light-on-dark) QR code', () => {
  const code = decodeFixture('inverted.png');
  assert.ok(code);
  assert.strictEqual(code.data, 'inverted colors still decode');
});

test('returns null for an image without a QR code', () => {
  const code = decodeFixture('no-qr.png');
  assert.strictEqual(code, null);
});

// --- stylized codes: the preprocessing ladder ------------------------------

test('clean fixtures decode on the first rung, before any preprocessing', () => {
  for (const name of ['url.png', 'text.png', 'wifi.png', 'small.png', 'inverted.png']) {
    assert.ok(decodeFixture(name), `${name} should not need the ladder`);
  }
});

// Every stylized fixture must defeat a plain jsQR pass — otherwise it only
// re-tests rung 0 and says nothing about the ladder.

test('dot-style (gapped module) QR: plain jsQR fails, the ladder decodes', () => {
  assert.strictEqual(decodeFixture('dots.png'), null, 'dots.png must defeat plain jsQR');
  assert.strictEqual(decodeLadderFixture('dots.png'), 'https://qrgenie.app');
});

test('rounded-module QR: plain jsQR fails, the ladder decodes', () => {
  assert.strictEqual(decodeFixture('rounded.png'), null, 'rounded.png must defeat plain jsQR');
  assert.strictEqual(decodeLadderFixture('rounded.png'), 'Hello from QRGenie');
});

test('skewed low-contrast QR: plain jsQR fails, the ladder decodes', () => {
  assert.strictEqual(decodeFixture('skewed.png'), null, 'skewed.png must defeat plain jsQR');
  assert.strictEqual(
    decodeLadderFixture('skewed.png'),
    'WIFI:T:WPA;S:QRGenie Guest;P:decode1234;;'
  );
});

test('the ladder still returns null when there is no QR code', () => {
  assert.strictEqual(decodeLadderFixture('no-qr.png'), null);
});

test('skipPlain skips exactly the initial plain jsQR attempt', () => {
  const img = readFixture('no-qr.png');
  let calls = 0;
  const countingJsQR = () => {
    calls++;
    return null;
  };
  QRGeniePreprocess.decodeLadder(img, countingJsQR);
  const withPlain = calls;
  calls = 0;
  QRGeniePreprocess.decodeLadder(img, countingJsQR, { skipPlain: true });
  assert.strictEqual(calls, withPlain - 1);
});
