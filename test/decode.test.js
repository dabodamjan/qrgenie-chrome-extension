'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const jsQR = require('../vendor/jsQR.js');
const { decodePNG } = require('./helpers/png.js');

// Same decode options the service worker uses.
function decodeFixture(name) {
  const buf = fs.readFileSync(path.join(__dirname, 'fixtures', name));
  const { width, height, data } = decodePNG(buf);
  return jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
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
