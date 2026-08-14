/*
 * Minimal PNG reader for the test suite, so the tests have zero
 * dependencies. Supports non-interlaced PNGs with grayscale, RGB, palette,
 * grayscale+alpha and RGBA color at bit depths 1/2/4/8, which covers
 * everything the fixture generator produces.
 *
 * decodePNG(buffer) -> { width, height, data } with data as RGBA Uint8ClampedArray,
 * the same shape jsQR expects.
 */
'use strict';
const zlib = require('zlib');

function decodePNG(buf) {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIG[i]) throw new Error('not a PNG');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  let palette = null;
  let trns = null;
  const idat = [];

  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }

  if (interlace !== 0) throw new Error('interlaced PNG not supported');
  if (![1, 2, 4, 8].includes(bitDepth)) throw new Error('bit depth ' + bitDepth + ' not supported');

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (channels == null) throw new Error('color type ' + colorType + ' not supported');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = Math.max(1, (channels * bitDepth) / 8); // bytes per pixel, for filters
  const stride = Math.ceil((width * channels * bitDepth) / 8);

  // Undo scanline filters in place.
  const lines = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = lines.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? lines.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) {
        throw new Error('unknown filter ' + filter);
      }
      out[x] = v & 0xff;
    }
  }

  // Expand to RGBA.
  const data = new Uint8ClampedArray(width * height * 4);
  const maxVal = (1 << bitDepth) - 1;

  function sample(row, i) {
    if (bitDepth === 8) return row[i];
    const bit = i * bitDepth;
    const byte = row[bit >> 3];
    const shift = 8 - bitDepth - (bit & 7);
    return (byte >> shift) & maxVal;
  }

  for (let y = 0; y < height; y++) {
    const row = lines.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 3) {
        const idx = sample(row, x);
        data[o] = palette[idx * 3];
        data[o + 1] = palette[idx * 3 + 1];
        data[o + 2] = palette[idx * 3 + 2];
        data[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (colorType === 0) {
        const g = Math.round((sample(row, x) / maxVal) * 255);
        data[o] = data[o + 1] = data[o + 2] = g;
        data[o + 3] = 255;
      } else if (colorType === 4) {
        data[o] = data[o + 1] = data[o + 2] = row[x * 2];
        data[o + 3] = row[x * 2 + 1];
      } else if (colorType === 2) {
        data[o] = row[x * 3];
        data[o + 1] = row[x * 3 + 1];
        data[o + 2] = row[x * 3 + 2];
        data[o + 3] = 255;
      } else {
        data[o] = row[x * 4];
        data[o + 1] = row[x * 4 + 1];
        data[o + 2] = row[x * 4 + 2];
        data[o + 3] = row[x * 4 + 3];
      }
    }
  }

  return { width, height, data };
}

module.exports = { decodePNG };
