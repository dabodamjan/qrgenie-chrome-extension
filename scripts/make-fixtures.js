/*
 * Regenerates test/fixtures/*.png. One-off; the fixtures are committed and
 * the test suite has no dependencies. To rerun you need the qrcode package
 * on the module path:
 *   npm install --no-save qrcode && node scripts/make-fixtures.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { encodePNG } = require('./make-icons');

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
  for (const f of FIXTURES) {
    await QRCode.toFile(path.join(DIR, f.file), f.text, f.opts);
    console.log('wrote', f.file);
  }
  fs.writeFileSync(path.join(DIR, 'no-qr.png'), makeNoQr());
  console.log('wrote no-qr.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
