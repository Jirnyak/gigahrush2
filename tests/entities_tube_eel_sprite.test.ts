import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { generateSprite } from '../src/entities/tube_eel';
import { S, CLEAR, rgba } from '../src/render/pixutil';

test('generateSprite creates a Uint32Array of expected size', () => {
  const sprite = generateSprite();
  assert.ok(sprite instanceof Uint32Array);
  assert.equal(sprite.length, S * S);
});

test('generateSprite produces a deterministically generated sprite', () => {
  const sprite1 = generateSprite();
  const sprite2 = generateSprite();

  assert.deepEqual(sprite1, sprite2, 'sprite generation should be deterministic');
});

test('generateSprite draws the eel body', () => {
  const sprite = generateSprite();
  let bodyPixels = 0;

  for (let i = 0; i < sprite.length; i++) {
    // Expected roughly blueish/greyish body color based on source: rgba(clamp(35+n), clamp(95+n), clamp(105+n))
    if (sprite[i] !== CLEAR) {
      bodyPixels++;
    }
  }

  assert.ok(bodyPixels > 100, 'should draw a substantial eel body');
});

test('generateSprite draws the glowing eyes', () => {
  const sprite = generateSprite();
  const cx = S / 2;

  const leftEyeColor = sprite[11 * S + (cx - 2)];
  const rightEyeColor = sprite[12 * S + (cx + 2)];

  const expectedEyeColor = rgba(240, 240, 180);

  assert.equal(leftEyeColor, expectedEyeColor, 'left eye should be drawn');
  assert.equal(rightEyeColor, expectedEyeColor, 'right eye should be drawn');
});
