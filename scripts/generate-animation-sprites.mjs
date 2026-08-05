import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.join(ROOT, 'anims');
const CYRILLIC_SOURCE_DIR = path.join(ROOT, '\u0430nims');
const OUT_PATH = path.join(ROOT, 'src/render/animations/generated_frames.ts');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SIZE = 64;
const CLEAR = 0x00000000;

function rel(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function fail(message) {
  throw new Error(message);
}

function assertAsciiSourcePath() {
  if (existsSync(CYRILLIC_SOURCE_DIR)) {
    fail('Found Cyrillic ./\u0430nims/. Normalize source media to ASCII ./anims/ before generating animation frames.');
  }
  if (!existsSync(SOURCE_DIR)) fail('Missing animation source directory: anims/');
}

function assertNoDsStore(dir) {
  for (const name of readdirSync(dir)) {
    const filePath = path.join(dir, name);
    if (name === '.DS_Store') fail(`Source media must not contain .DS_Store: ${rel(filePath)}`);
    if (statSync(filePath).isDirectory()) assertNoDsStore(filePath);
  }
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
  if (!file.subarray(0, 8).equals(PNG_SIGNATURE)) fail(`${rel(filePath)}: not a PNG`);

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
    if (offset + 12 > file.length) fail(`${rel(filePath)}: truncated PNG chunk header`);
    const length = file.readUInt32BE(offset);
    const type = file.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > file.length) fail(`${rel(filePath)}: truncated PNG chunk ${type}`);
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

  if (width <= 0 || height <= 0) fail(`${rel(filePath)}: invalid PNG size ${width}x${height}`);
  if (bitDepth !== 8 || colorType !== 6) fail(`${rel(filePath)}: expected 8-bit RGBA PNG`);
  if (compression !== 0 || filterMethod !== 0 || interlace !== 0) {
    fail(`${rel(filePath)}: expected non-interlaced PNG with standard filters`);
  }
  if (idat.length === 0) fail(`${rel(filePath)}: missing IDAT payload`);

  const raw = inflateSync(Buffer.concat(idat));
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const expectedRawLength = height * (stride + 1);
  if (raw.length !== expectedRawLength) fail(`${rel(filePath)}: unexpected PNG payload length`);
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
      else if (filter !== 0) fail(`${rel(filePath)}: unsupported PNG filter ${filter}`);
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
  if (opaque === 0) fail(`${rel(filePath)}: blank transparent frame`);
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

function normalizeToRuntimeFrame(decoded) {
  const trimmed = trimVerticalTransparency(decoded);
  if (trimmed.width === SIZE && trimmed.height === SIZE) return { width: SIZE, height: SIZE, pixels: trimmed.pixels };
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
  return { width: SIZE, height: SIZE, pixels: out };
}

function encodeRle(pixels) {
  const out = [];
  let value = pixels[0] >>> 0;
  let count = 1;
  for (let i = 1; i < pixels.length; i++) {
    const next = pixels[i] >>> 0;
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
    lines.push(`        ${chunk.join(', ')},`);
  }
  return lines.join('\n');
}

function collectClip(clipDir) {
  const clipId = path.basename(clipDir);
  if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(clipId)) fail(`Invalid animation clip id: ${clipId}`);

  const entries = readdirSync(clipDir).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const frames = [];
  for (const name of entries) {
    const filePath = path.join(clipDir, name);
    if (!statSync(filePath).isFile()) fail(`${rel(filePath)}: animation clip entries must be PNG files`);
    const match = /^(\d+)\.png$/.exec(name);
    if (!match) fail(`${rel(filePath)}: frame names must be numeric PNG files`);
    frames.push({ index: Number(match[1]), filePath });
  }
  if (frames.length === 0) fail(`${rel(clipDir)}: empty animation clip`);
  frames.sort((a, b) => a.index - b.index);
  frames.forEach((frame, expected) => {
    if (frame.index !== expected) fail(`${rel(clipDir)}: expected contiguous frames 0.png..N.png`);
  });

  let width = 0;
  let height = 0;
  const encodedFrames = [];
  const clipHash = createHash('sha256');

  for (const frame of frames) {
    const file = readFileSync(frame.filePath);
    const sha256 = createHash('sha256').update(file).digest('hex');
    const decoded = normalizeToRuntimeFrame(decodePng(frame.filePath));
    if (width === 0 && height === 0) {
      width = decoded.width;
      height = decoded.height;
    } else if (decoded.width !== width || decoded.height !== height) {
      fail(`${rel(frame.filePath)}: all frames in ${clipId} must share dimensions ${width}x${height}`);
    }
    clipHash.update(String(frame.index));
    clipHash.update('\0');
    clipHash.update(sha256);
    clipHash.update('\0');
    clipHash.update(`${decoded.width}x${decoded.height}`);
    clipHash.update('\0');
    const rle = encodeRle(decoded.pixels);
    for (const value of rle) clipHash.update(`${value >>> 0},`);
    encodedFrames.push({
      index: frame.index,
      sourcePath: rel(frame.filePath),
      sha256,
      rle,
    });
  }

  return {
    id: clipId,
    sourceDirectory: rel(clipDir),
    width,
    height,
    frameCount: encodedFrames.length,
    sha256: clipHash.digest('hex'),
    frames: encodedFrames,
  };
}

function collectClips() {
  assertAsciiSourcePath();
  assertNoDsStore(SOURCE_DIR);
  const clipDirs = readdirSync(SOURCE_DIR)
    .map(name => path.join(SOURCE_DIR, name))
    .filter(filePath => statSync(filePath).isDirectory())
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  if (clipDirs.length === 0) fail('No animation clip folders found under anims/');
  return clipDirs.map(collectClip);
}

function emit(clips) {
  const ids = clips.map(clip => clip.id);
  const idUnion = ids.map(id => JSON.stringify(id)).join(', ');
  const body = clips.map(clip => {
    const frames = clip.frames.map(frame => {
      return `      {\n` +
        `        index: ${frame.index},\n` +
        `        sourcePath: ${JSON.stringify(frame.sourcePath)},\n` +
        `        sha256: ${JSON.stringify(frame.sha256)},\n` +
        `        rle: [\n${formatRle(frame.rle)}\n        ],\n` +
        `      },`;
    }).join('\n');
    return `  ${JSON.stringify(clip.id)}: {\n` +
      `    id: ${JSON.stringify(clip.id)},\n` +
      `    sourceDirectory: ${JSON.stringify(clip.sourceDirectory)},\n` +
      `    width: ${clip.width},\n` +
      `    height: ${clip.height},\n` +
      `    frameCount: ${clip.frameCount},\n` +
      `    sha256: ${JSON.stringify(clip.sha256)},\n` +
      `    frames: [\n${frames}\n    ],\n` +
      `  },`;
  }).join('\n');

  return `/* Generated by scripts/generate-animation-sprites.mjs. Do not edit manually. */\n\n` +
    `const IDS = [${idUnion}] as const;\n\n` +
    `export type GeneratedAnimationClipId = typeof IDS[number];\n` +
    `export const GENERATED_ANIMATION_CLIP_IDS: readonly GeneratedAnimationClipId[] = IDS;\n\n` +
    `export interface GeneratedAnimationFrame {\n` +
    `  readonly index: number;\n` +
    `  readonly sourcePath: string;\n` +
    `  readonly sha256: string;\n` +
    `  readonly rle: readonly number[];\n` +
    `}\n\n` +
    `export interface GeneratedAnimationFramePack {\n` +
    `  readonly id: GeneratedAnimationClipId;\n` +
    `  readonly sourceDirectory: string;\n` +
    `  readonly width: number;\n` +
    `  readonly height: number;\n` +
    `  readonly frameCount: number;\n` +
    `  readonly sha256: string;\n` +
    `  readonly frames: readonly GeneratedAnimationFrame[];\n` +
    `}\n\n` +
    `export const GENERATED_ANIMATION_FRAME_PACKS: Readonly<Record<GeneratedAnimationClipId, GeneratedAnimationFramePack>> = {\n${body}\n};\n\n` +
    `export function getGeneratedAnimationFramePack(id: string | undefined): GeneratedAnimationFramePack | undefined {\n` +
    `  if (!id) return undefined;\n` +
    `  return GENERATED_ANIMATION_FRAME_PACKS[id as GeneratedAnimationClipId];\n` +
    `}\n\n` +
    `export function decodeGeneratedAnimationFrame(clipId: string | undefined, frameIndex: number): Uint32Array | undefined {\n` +
    `  const pack = getGeneratedAnimationFramePack(clipId);\n` +
    `  if (!pack || frameIndex < 0 || frameIndex >= pack.frames.length) return undefined;\n` +
    `  const frame = pack.frames[frameIndex];\n` +
    `  const out = new Uint32Array(pack.width * pack.height);\n` +
    `  let cursor = 0;\n` +
    `  for (let i = 0; i < frame.rle.length; i += 2) {\n` +
    `    const count = frame.rle[i] | 0;\n` +
    `    const value = frame.rle[i + 1] >>> 0;\n` +
    `    out.fill(value, cursor, cursor + count);\n` +
    `    cursor += count;\n` +
    `  }\n` +
    `  return cursor === out.length ? out : undefined;\n` +
    `}\n`;
}

const clips = collectClips();
mkdirSync(path.dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, emit(clips));
console.log(`Generated ${rel(OUT_PATH)} from ${clips.length} animation clips`);
