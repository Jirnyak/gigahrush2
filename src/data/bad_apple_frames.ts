import { BAD_APPLE_FRAME_PACK_B64 } from './bad_apple_frame_pack';

/* Generated from raw Bad Apple PNG frames, then repacked as keyframes + XOR delta runs. */

export const BAD_APPLE_WIDTH = 144;
export const BAD_APPLE_HEIGHT = 108;
export const BAD_APPLE_FRAME_COUNT = 6470;
export const BAD_APPLE_SOURCE_FRAME_FIRST = 40;
export const BAD_APPLE_SOURCE_FRAME_LAST = 6510;
export const BAD_APPLE_SOURCE_FRAME_STEP = 1;
export const BAD_APPLE_KEYFRAME_INTERVAL = 4;
export const BAD_APPLE_RLE_TOTAL_RUNS = 1074065;
export const BAD_APPLE_RLE_MAX_RUNS = 722;

let decodedPack: Uint8Array | null = null;
let decodedOffsets: Uint32Array | null = null;

function decodeBase64(input: string): Uint8Array {
  const raw = atob(input.trim());
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function ensureDecoded(): { bytes: Uint8Array; offsets: Uint32Array } {
  if (decodedPack && decodedOffsets) return { bytes: decodedPack, offsets: decodedOffsets };
  const bytes = decodeBase64(BAD_APPLE_FRAME_PACK_B64);
  const offsets = new Uint32Array(BAD_APPLE_FRAME_COUNT);
  let p = 0;
  for (let frame = 0; frame < BAD_APPLE_FRAME_COUNT; frame++) {
    if (p + 2 > bytes.length) throw new Error('Bad Apple RLE pack truncated');
    offsets[frame] = p;
    const runCount = readU16LE(bytes, p);
    p += 2 + runCount * 3;
  }
  if (p !== bytes.length) throw new Error('Bad Apple RLE pack has trailing data');
  decodedPack = bytes;
  decodedOffsets = offsets;
  return { bytes, offsets };
}

function applySetRuns(target: Uint8Array, bytes: Uint8Array, offset: number): void {
  let p = offset;
  const runCount = readU16LE(bytes, p);
  p += 2;
  target.fill(0);
  for (let i = 0; i < runCount; i++) {
    const start = readU16LE(bytes, p);
    const len = bytes[p + 2];
    target.fill(1, start, start + len);
    p += 3;
  }
}

function applyToggleRuns(target: Uint8Array, bytes: Uint8Array, offset: number): void {
  let p = offset;
  const runCount = readU16LE(bytes, p);
  p += 2;
  for (let i = 0; i < runCount; i++) {
    const start = readU16LE(bytes, p);
    const end = start + bytes[p + 2];
    for (let j = start; j < end; j++) target[j] ^= 1;
    p += 3;
  }
}

export function drawBadAppleFrame(target: Uint8Array, frameIndex: number): void {
  if (target.length !== BAD_APPLE_WIDTH * BAD_APPLE_HEIGHT) {
    throw new Error('Bad Apple frame buffer has wrong size');
  }
  const { bytes, offsets } = ensureDecoded();
  const frame = ((Math.floor(frameIndex) % BAD_APPLE_FRAME_COUNT) + BAD_APPLE_FRAME_COUNT) % BAD_APPLE_FRAME_COUNT;
  const keyFrame = frame - (frame % BAD_APPLE_KEYFRAME_INTERVAL);
  applySetRuns(target, bytes, offsets[keyFrame]);
  for (let deltaFrame = keyFrame + 1; deltaFrame <= frame; deltaFrame++) {
    applyToggleRuns(target, bytes, offsets[deltaFrame]);
  }
}
