/**
 * Regenerates apps/desktop/assets/icons/icon.png with a real alpha channel,
 * then rebuilds icon.icns and icon.ico from it.
 *
 * Why this exists: the previous icon.png was exported flattened — every one
 * of its 1024x1024 pixels was opaque, so the 100px margin the icon grid
 * requires had become solid white instead of transparent. macOS does not
 * treat white as empty: it drew the whole square, which is why the app
 * showed up in the Dock as a white plate with the squircle floating inside
 * it. The .icns built from that PNG carried only one small size on top of
 * that, so the Dock was upscaling a 64px image.
 *
 * The artwork itself was never wrong, so this does not redraw it. It takes
 * the existing pixels and reconstructs the alpha channel analytically from
 * the same rounded-rect geometry icon.svg declares (an 824x824 tile at
 * (100,100) with a 185px corner radius). Nothing outside that tile survives;
 * the tile's antialiased edge is rebuilt at 4x supersampling rather than
 * inherited from the white-blended original, so no light fringe remains.
 *
 * Run with: node scripts/build-app-icons.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.join(HERE, '..', 'apps', 'desktop', 'assets', 'icons');
const SOURCE_PNG = path.join(ICONS_DIR, 'icon.png');

// Must match icon.svg exactly.
const CANVAS = 1024;
const TILE_X = 100;
const TILE_Y = 100;
const TILE_SIZE = 824;
const CORNER_RADIUS = 185;
/** The tile fill from icon.svg — used to rebuild the antialiased edge cleanly. */
const TILE_FILL = [0x0d, 0x0f, 0x14];
const SUPERSAMPLE = 4;

// --- minimal PNG read/write (RGBA, 8-bit, no interlacing) -------------------

function readPng(file) {
  const buf = fs.readFileSync(file);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (buf[24] !== 8 || buf[25] !== 6) {
    throw new Error(`${file}: expected 8-bit RGBA (colour type 6), got depth ${buf[24]} type ${buf[25]}`);
  }
  const chunks = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') chunks.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const out = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= 4 ? cur[x - 4] : 0;
      const b = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
  }
  return { width, height, data: out };
}

function chunk(type, payload) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

function writePng(file, width, height, data) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

// --- geometry ---------------------------------------------------------------

/** True when (x, y) lies inside the rounded rect icon.svg describes. */
function insideTile(x, y) {
  const minX = TILE_X;
  const minY = TILE_Y;
  const maxX = TILE_X + TILE_SIZE;
  const maxY = TILE_Y + TILE_SIZE;
  if (x < minX || y < minY || x > maxX || y > maxY) return false;
  const r = CORNER_RADIUS;
  // Corner circles: only the four corner squares need a radius test.
  const cx = x < minX + r ? minX + r : x > maxX - r ? maxX - r : null;
  const cy = y < minY + r ? minY + r : y > maxY - r ? maxY - r : null;
  if (cx === null || cy === null) return true;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Fractional coverage of the tile over one pixel, by supersampling. */
function tileCoverage(px, py) {
  let hits = 0;
  for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
    for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
      const x = px + (sx + 0.5) / SUPERSAMPLE;
      const y = py + (sy + 0.5) / SUPERSAMPLE;
      if (insideTile(x, y)) hits += 1;
    }
  }
  return hits / (SUPERSAMPLE * SUPERSAMPLE);
}

// --- ICO container ----------------------------------------------------------

/** Vista-era ICO: each entry is a whole PNG file, not a BMP bitmap. */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((entry, i) => {
    const at = i * 16;
    dir[at] = entry.size >= 256 ? 0 : entry.size;
    dir[at + 1] = entry.size >= 256 ? 0 : entry.size;
    dir[at + 2] = 0; // palette
    dir[at + 3] = 0; // reserved
    dir.writeUInt16LE(1, at + 4); // colour planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32LE(entry.png.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += entry.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// --- main -------------------------------------------------------------------

function resizePng(source, destination, size) {
  execFileSync('sips', ['-z', String(size), String(size), source, '--out', destination], { stdio: 'ignore' });
}

function main() {
  const { width, height, data } = readPng(SOURCE_PNG);
  if (width !== CANVAS || height !== CANVAS) {
    throw new Error(`expected a ${CANVAS}x${CANVAS} source, got ${width}x${height}`);
  }

  let rewritten = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const coverage = tileCoverage(x, y);
      if (coverage <= 0) {
        // Outside the tile: fully transparent, and zero the colour too so no
        // stray white survives in the premultiplied compositing some
        // rasterizers do.
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 0;
        rewritten += 1;
        continue;
      }
      if (coverage < 1) {
        // Edge pixel: rebuild from the tile fill rather than keeping the
        // original's white-blended value, which would read as a pale rim.
        data[i] = TILE_FILL[0];
        data[i + 1] = TILE_FILL[1];
        data[i + 2] = TILE_FILL[2];
        data[i + 3] = Math.round(coverage * 255);
        rewritten += 1;
        continue;
      }
      data[i + 3] = 255;
    }
  }

  writePng(SOURCE_PNG, width, height, data);
  console.log(`icon.png: rebuilt alpha (${rewritten} pixels outside/on the tile edge)`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'space-icons-'));
  try {
    // macOS .icns — the full ladder Finder/Dock expects, so nothing upscales.
    const iconset = path.join(tmp, 'icon.iconset');
    fs.mkdirSync(iconset);
    const icnsSizes = [16, 32, 64, 128, 256, 512, 1024];
    for (const size of icnsSizes) {
      resizePng(SOURCE_PNG, path.join(iconset, `icon_${size}x${size}.png`), size);
      if (size <= 512) {
        // Retina variant of the next size down.
        resizePng(SOURCE_PNG, path.join(iconset, `icon_${size / 2}x${size / 2}@2x.png`), size);
      }
    }
    // iconutil rejects the stray 1024x1024 name; only @2x of 512 is valid.
    fs.rmSync(path.join(iconset, 'icon_1024x1024.png'), { force: true });
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(ICONS_DIR, 'icon.icns')], { stdio: 'inherit' });
    console.log(`icon.icns: rebuilt with ${icnsSizes.length * 2 - 2} representations`);

    // Windows .ico
    const icoSizes = [16, 24, 32, 48, 64, 128, 256];
    const entries = icoSizes.map((size) => {
      const out = path.join(tmp, `ico-${size}.png`);
      resizePng(SOURCE_PNG, out, size);
      return { size, png: fs.readFileSync(out) };
    });
    fs.writeFileSync(path.join(ICONS_DIR, 'icon.ico'), buildIco(entries));
    console.log(`icon.ico: rebuilt with ${icoSizes.length} sizes`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
