import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = join(__dirname, 'public');

const svg = readFileSync(join(pub, 'icon.svg'));

const pngSizes = [16, 32, 48, 64, 96, 180, 192, 512];
const buffers = {};
for (const s of pngSizes) {
  const buf = await sharp(svg, { density: 384 })
    .resize(s, s, { fit: 'inside' })
    .png()
    .toBuffer();
  buffers[s] = buf;
  writeFileSync(join(pub, `icon-${s}.png`), buf);
}

writeFileSync(join(pub, 'apple-touch-icon.png'), buffers[180]);

const icoSizes = [16, 32, 48];
const entries = icoSizes.map((s) => ({ s, data: buffers[s] }));
const headerSize = 6;
const dirSize = entries.length * 16;
let offset = headerSize + dirSize;
const dir = Buffer.alloc(dirSize);
let i = 0;
for (const e of entries) {
  dir.writeUInt8(e.s >= 256 ? 0 : e.s, i);
  dir.writeUInt8(e.s >= 256 ? 0 : e.s, i + 1);
  dir.writeUInt8(0, i + 2);
  dir.writeUInt8(0, i + 3);
  dir.writeUInt16LE(1, i + 4);
  dir.writeUInt16LE(32, i + 6);
  dir.writeUInt32LE(e.data.length, i + 8);
  dir.writeUInt32LE(offset, i + 12);
  offset += e.data.length;
  i += 16;
}
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);
writeFileSync(join(pub, 'favicon.ico'), Buffer.concat([header, dir, ...entries.map((e) => e.data)]));

console.log('Generated icons in public/');
