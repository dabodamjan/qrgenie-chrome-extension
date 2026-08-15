/*
 * Regenerates icons/icon{16,32,48,128}.png. No dependencies:
 *   node scripts/make-icons.js
 *
 * Design: rounded square with a gradient over QRGenie's brand teals (main
 * #19b0b3 into darker #003C3D) and a white QR motif (three finder patterns
 * plus an alignment pattern). Drawn 4x supersampled and box-downsampled for
 * clean edges at small sizes.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// --- minimal PNG encoder (8-bit RGBA, no interlace) ------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- icon drawing ----------------------------------------------------------

const TEAL = [25, 176, 179]; // brand main #19b0b3
const TEAL_DARK = [0, 60, 61]; // brand darker #003C3D

function drawIcon(size) {
  const ss = 4;
  const S = size * ss;
  const px = new Float64Array(S * S * 4);

  const radius = S * 0.22;
  const m = S * 0.15; // margin around the QR motif
  const fs = S * 0.26; // finder pattern size
  const finders = [
    [m, m],
    [S - m - fs, m],
    [m, S - m - fs]
  ];
  // Alignment pattern in the bottom-right quadrant: white ring, gradient
  // gap, white center, like a small finder.
  const as = fs * 0.62;
  const ax = S - m - as;
  const ay = ax;

  function insideRounded(x, y) {
    const cx = Math.max(radius - x, x - (S - radius), 0);
    const cy = Math.max(radius - y, y - (S - radius), 0);
    return cx * cx + cy * cy <= radius * radius;
  }

  function finderWhite(x, y) {
    for (const [ox, oy] of finders) {
      if (x >= ox && x < ox + fs && y >= oy && y < oy + fs) {
        const u = (x - ox) / fs;
        const v = (y - oy) / fs;
        const band = (t) => (t < 1 / 7 || t > 6 / 7 ? 0 : t < 2 / 7 || t > 5 / 7 ? 1 : 2);
        const bu = band(u);
        const bv = band(v);
        // border ring or solid center is white; the gap ring shows gradient
        return bu === 0 || bv === 0 || (bu === 2 && bv === 2);
      }
    }
    return false;
  }

  function alignWhite(x, y) {
    if (x < ax || y < ay || x >= ax + as || y >= ay + as) return false;
    const band = (t) => (t < 1 / 5 || t > 4 / 5 ? 0 : t < 2 / 5 || t > 3 / 5 ? 1 : 2);
    const bu = band((x - ax) / as);
    const bv = band((y - ay) / as);
    return bu === 0 || bv === 0 || (bu === 2 && bv === 2);
  }

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const o = (y * S + x) * 4;
      if (!insideRounded(x + 0.5, y + 0.5)) continue; // transparent
      let r, g, b;
      if (finderWhite(x, y) || alignWhite(x, y)) {
        r = g = b = 255;
      } else {
        const t = (x + y) / (2 * S);
        r = TEAL[0] + (TEAL_DARK[0] - TEAL[0]) * t;
        g = TEAL[1] + (TEAL_DARK[1] - TEAL[1]) * t;
        b = TEAL[2] + (TEAL_DARK[2] - TEAL[2]) * t;
      }
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = 255;
    }
  }

  // Box-downsample ss*ss blocks, alpha-weighted.
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < ss; dy++) {
        for (let dx = 0; dx < ss; dx++) {
          const o = ((y * ss + dy) * S + x * ss + dx) * 4;
          const al = px[o + 3];
          r += px[o] * al;
          g += px[o + 1] * al;
          b += px[o + 2] * al;
          a += al;
        }
      }
      const o = (y * size + x) * 4;
      out[o] = a ? Math.round(r / a) : 0;
      out[o + 1] = a ? Math.round(g / a) : 0;
      out[o + 2] = a ? Math.round(b / a) : 0;
      out[o + 3] = Math.round(a / (ss * ss));
    }
  }
  return encodePNG(out, size, size);
}

if (require.main === module) {
  const dir = path.join(__dirname, '..', 'icons');
  fs.mkdirSync(dir, { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    const file = path.join(dir, `icon${size}.png`);
    fs.writeFileSync(file, drawIcon(size));
    console.log('wrote', file);
  }
}

module.exports = { encodePNG };
