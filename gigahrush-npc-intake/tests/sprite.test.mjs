import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeRleIndexes,
  findOpaqueBounds,
  quantizeRgbaToSpritePayload,
  validateSpritePayload,
} from '../src/sprite_lab/sprite.js';

function testSpriteRgba() {
  const width = 64;
  const height = 64;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 10; y < 58; y++) {
    for (let x = 24; x < 40; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = y < 24 ? 210 : 110;
      rgba[i + 1] = y < 24 ? 190 : 120;
      rgba[i + 2] = y < 24 ? 150 : 105;
      rgba[i + 3] = 255;
    }
  }
  return { rgba, width, height };
}

test('quantized sprite payload validates and decodes to expected size', () => {
  const { rgba, width, height } = testSpriteRgba();
  const payload = quantizeRgbaToSpritePayload(rgba, width, height, { maxColors: 8 });
  const validation = validateSpritePayload(payload, { maxSize: 64, maxPalette: 8 });
  assert.equal(validation.valid, true, validation.errors.join('\n'));
  assert.ok(payload.palette.length <= 8);
  const indexes = decodeRleIndexes(payload.rle, width * height);
  assert.equal(indexes.length, width * height);
  assert.ok(indexes.some(index => index > 0));
});

test('blank sprite is blocked', () => {
  const rgba = new Uint8Array(64 * 64 * 4);
  const payload = quantizeRgbaToSpritePayload(rgba, 64, 64);
  const validation = validateSpritePayload(payload);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join('\n'), /no opaque pixels/);
});

test('opaque bounds crop transparent border', () => {
  const { rgba, width, height } = testSpriteRgba();
  const bounds = findOpaqueBounds({ data: rgba, width, height });
  assert.deepEqual(bounds, { x: 24, y: 10, w: 16, h: 48, empty: false });
});
