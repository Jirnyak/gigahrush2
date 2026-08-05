import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(ROOT, 'src/data/art_sprite_manifest.ts');
const OUT_PATH = path.join(ROOT, 'src/render/generated_art_sprites.ts');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SIZE = 128;
const CLEAR = 0x00000000;

function parseManifestRows() {
  const src = readFileSync(MANIFEST_PATH, 'utf8');
  const rowRe = /\{\s*id: '([^']+)'[\s\S]*?sourcePath: '([^']+)'[\s\S]*?sha256: '([0-9a-f]{0,64})'[\s\S]*?width: (\d+),\s*height: (\d+),/g;
  const rows = [];
  let match;
  while ((match = rowRe.exec(src)) !== null) {
    rows.push({
      id: match[1],
      sourcePath: match[2],
      sha256: match[3],
      width: Number(match[4]),
      height: Number(match[5]),
    });
  }
  if (rows.length === 0) throw new Error('No art sprite manifest rows found');
  return rows;
}

function resolveSourcePath(sourcePath) {
  const direct = path.join(ROOT, sourcePath);
  if (existsSync(direct)) return direct;
  const dir = path.join(ROOT, path.dirname(sourcePath));
  const wanted = path.basename(sourcePath).normalize('NFC');
  for (const name of readdirSync(dir)) {
    if (name.normalize('NFC') === wanted) return path.join(dir, name);
  }
  throw new Error(`Missing art sprite source: ${sourcePath}`);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(filePath) {
  const file = readFileSync(filePath);
  if (!file.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`${filePath}: not a PNG`);

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = -1;
  let colorType = -1;
  let compression = -1;
  let filterMethod = -1;
  let interlace = -1;
  const idat = [];

  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = file.subarray(dataStart, dataEnd);
    offset = dataEnd + 4;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      compression = data[10];
      filterMethod = data[11];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (width <= 0 || height <= 0) throw new Error(`${filePath}: invalid PNG size ${width}x${height}`);
  if (bitDepth !== 8 || colorType !== 6) throw new Error(`${filePath}: expected 8-bit RGBA PNG`);
  if (compression !== 0 || filterMethod !== 0 || interlace !== 0) throw new Error(`${filePath}: expected non-interlaced PNG with standard filters`);

  const raw = inflateSync(Buffer.concat(idat));
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const expectedRawLength = height * (stride + 1);
  if (raw.length < expectedRawLength) throw new Error(`${filePath}: truncated PNG payload`);
  const pixels = new Uint8Array(height * stride);
  let src = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const rowStart = y * stride;
    const prevStart = rowStart - stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= bytesPerPixel ? pixels[rowStart + x - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[prevStart + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? pixels[prevStart + x - bytesPerPixel] : 0;
      let value = raw[src++];
      if (filter === 1) value = (value + left) & 0xff;
      else if (filter === 2) value = (value + up) & 0xff;
      else if (filter === 3) value = (value + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) value = (value + paeth(left, up, upLeft)) & 0xff;
      else if (filter !== 0) throw new Error(`${filePath}: unsupported PNG filter ${filter}`);
      pixels[rowStart + x] = value;
    }
  }

  const out = new Uint32Array(width * height);
  let opaque = 0;
  for (let i = 0; i < out.length; i++) {
    const j = i * 4;
    const r = pixels[j];
    const g = pixels[j + 1];
    const b = pixels[j + 2];
    const a = pixels[j + 3];
    if (a !== 0) opaque++;
    out[i] = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  if (opaque === 0) throw new Error(`${filePath}: blank transparent sprite`);
  return { width, height, pixels: out };
}

function rowHasOpaquePixel(decoded, y) {
  const row = y * decoded.width;
  for (let x = 0; x < decoded.width; x++) {
    if ((decoded.pixels[row + x] >>> 24) !== 0) return true;
  }
  return false;
}

function trimVerticalTransparency(decoded) {
  let top = 0;
  while (top < decoded.height && !rowHasOpaquePixel(decoded, top)) top++;
  let bottom = decoded.height - 1;
  while (bottom >= top && !rowHasOpaquePixel(decoded, bottom)) bottom--;
  if (top === 0 && bottom === decoded.height - 1) return decoded;

  const height = bottom - top + 1;
  const pixels = new Uint32Array(decoded.width * height);
  for (let y = 0; y < height; y++) {
    const srcStart = (top + y) * decoded.width;
    pixels.set(decoded.pixels.subarray(srcStart, srcStart + decoded.width), y * decoded.width);
  }
  return { width: decoded.width, height, pixels };
}

function normalizeToRuntimeSprite(decoded) {
  const trimmed = trimVerticalTransparency(decoded);
  if (trimmed.width === SIZE && trimmed.height === SIZE) return trimmed.pixels;
  const scale = Math.min(SIZE / trimmed.width, SIZE / trimmed.height);
  const outW = Math.max(1, Math.min(SIZE, Math.round(trimmed.width * scale)));
  const outH = Math.max(1, Math.min(SIZE, Math.round(trimmed.height * scale)));
  const offX = Math.floor((SIZE - outW) / 2);
  const offY = SIZE - outH;
  const out = new Uint32Array(SIZE * SIZE).fill(CLEAR);

  for (let y = 0; y < outH; y++) {
    const srcY = Math.min(trimmed.height - 1, Math.floor((y + 0.5) * trimmed.height / outH));
    for (let x = 0; x < outW; x++) {
      const srcX = Math.min(trimmed.width - 1, Math.floor((x + 0.5) * trimmed.width / outW));
      out[(offY + y) * SIZE + offX + x] = trimmed.pixels[srcY * trimmed.width + srcX] >>> 0;
    }
  }
  return out;
}

function encodeRle(sprite) {
  const out = [];
  let value = sprite[0] >>> 0;
  let count = 1;
  for (let i = 1; i < sprite.length; i++) {
    const next = sprite[i] >>> 0;
    if (next === value && count < 0xffff) {
      count++;
      continue;
    }
    out.push(count, value);
    value = next;
    count = 1;
  }
  out.push(count, value);
  return out;
}

function hex32(value) {
  return `0x${(value >>> 0).toString(16).padStart(8, '0')}`;
}

function formatRle(values) {
  const lines = [];
  for (let i = 0; i < values.length; i += 16) {
    const chunk = values.slice(i, i + 16).map((value, index) => index % 2 === 0 ? String(value) : hex32(value));
    lines.push(`    ${chunk.join(', ')},`);
  }
  return lines.join('\n');
}

function emit(rows, encoded) {
  const ids = rows.map(row => row.id);
  const idUnion = ids.map(id => JSON.stringify(id)).join(', ');
  const body = rows.map(row => {
    const rle = encoded.get(row.id);
    return `  ${JSON.stringify(row.id)}: [\n${formatRle(rle)}\n  ],`;
  }).join('\n');

  return `/* Generated by scripts/generate-art-sprites.mjs. Do not edit manually. */\n\n` +
    `const IDS = [${idUnion}] as const;\n\n` +
    `export type GeneratedArtSpriteId = typeof IDS[number];\n` +
    `export const GENERATED_ART_SPRITE_IDS: readonly GeneratedArtSpriteId[] = IDS;\n\n` +
    `const GENERATED_ART_SPRITE_RLE: Record<GeneratedArtSpriteId, readonly number[]> = {\n${body}\n};\n\n` +
    `export function getGeneratedArtSprite(id: string | undefined): Uint32Array | undefined {\n` +
    `  if (!id) return undefined;\n` +
    `  const rle = GENERATED_ART_SPRITE_RLE[id as GeneratedArtSpriteId];\n` +
    `  if (!rle) return undefined;\n` +
    `  const out = new Uint32Array(128 * 128);\n` +
    `  let cursor = 0;\n` +
    `  for (let i = 0; i < rle.length; i += 2) {\n` +
    `    const count = rle[i] | 0;\n` +
    `    const value = rle[i + 1] >>> 0;\n` +
    `    out.fill(value, cursor, cursor + count);\n` +
    `    cursor += count;\n` +
    `  }\n` +
    `  return cursor === out.length ? out : undefined;\n` +
    `}\n`;
}

function syncManifestSourceFacts(rows, facts) {
  let src = readFileSync(MANIFEST_PATH, 'utf8');
  for (const row of rows) {
    const fact = facts.get(row.id);
    if (!fact) continue;
    const needle = `sourcePath: '${row.sourcePath}',`;
    const sourceIndex = src.indexOf(needle);
    if (sourceIndex < 0) throw new Error(`Cannot find manifest row for ${row.id}`);
    const rowStart = src.lastIndexOf('\n  {', sourceIndex);
    const nextRow = src.indexOf('\n  {', sourceIndex + needle.length);
    const manifestEnd = src.indexOf('\n] as const', sourceIndex + needle.length);
    const rowEnd = nextRow >= 0 ? nextRow : manifestEnd;
    if (rowStart < 0 || rowEnd < 0) throw new Error(`Cannot isolate manifest row for ${row.id}`);
    const before = src.slice(0, rowStart);
    const rowBlock = src.slice(rowStart, rowEnd)
      .replace(/sha256: '[0-9a-f]{0,64}'/, `sha256: '${fact.sha256}'`)
      .replace(/width: \d+,\s*\n\s*height: \d+,/, `width: ${fact.width},\n    height: ${fact.height},`);
    const after = src.slice(rowEnd);
    src = `${before}${rowBlock}${after}`;
  }
  writeFileSync(MANIFEST_PATH, src);
}

const rows = parseManifestRows();
const seen = new Set();
const encoded = new Map();
const facts = new Map();
for (const row of rows) {
  if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(row.id)) throw new Error(`Invalid art sprite id: ${row.id}`);
  if (seen.has(row.id)) throw new Error(`Duplicate art sprite id: ${row.id}`);
  seen.add(row.id);
  const filePath = resolveSourcePath(row.sourcePath);
  const sha = createHash('sha256').update(readFileSync(filePath)).digest('hex');
  const decoded = decodePng(filePath);
  facts.set(row.id, { sha256: sha, width: decoded.width, height: decoded.height });
  encoded.set(row.id, encodeRle(normalizeToRuntimeSprite(decoded)));
}

syncManifestSourceFacts(rows, facts);
mkdirSync(path.dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, emit(rows, encoded));
console.log(`Generated ${path.relative(ROOT, OUT_PATH)} from ${rows.length} art sprites normalized to ${SIZE}x${SIZE}`);
