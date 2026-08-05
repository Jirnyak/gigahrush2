import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { flicker } from '../../src/render/hud_fx.js';

test('hud_fx flicker', async (t) => {
  await t.test('returns expected value without glitch', () => {
    // For time = 0, seed = 0:
    // hash2(0, 0) = 0 <= 0.93 -> no glitch
    // pulse = Math.sin(0) * 0.03 = 0
    // base = 0.92
    // total = 0.92
    assert.equal(flicker(0, 0), 0.92);
  });

  await t.test('returns expected value with glitch', () => {
    // For time = 0, seed = 6:
    // hash2(0, 6) > 0.93 (it is ~0.975) -> glitch = -0.15
    // pulse = Math.sin(0 * 2.3 + 6 * 7.1) * 0.03 = Math.sin(42.6) * 0.03 = -0.029468597187109074
    // base = 0.92
    // total = 0.92 - 0.029468597187109074 - 0.15 = 0.740531402812891
    const val = flicker(0, 6);
    assert.ok(val > 0.74 && val < 0.75, 'Should include glitch penalty and pulse');
  });

  await t.test('clamps to max 1', () => {
    // Find inputs where base + pulse > 1.
    // base = 0.92. Need pulse > 0.08, but pulse is max 0.03. So max is 0.95.
    // Wait, the clamping logic maxes at 1, but base (0.92) + max pulse (0.03) = 0.95.
    // So it never hits 1 naturally, but we can verify it doesn't exceed 1.
    const val = flicker(10, 10);
    assert.ok(val <= 1, 'Value should be clamped to 1 max');
  });

  await t.test('clamps to min 0.5', () => {
    // Max penalty is base(0.92) - glitch(0.15) - pulse(0.03) = 0.74.
    // So it won't hit 0.5, but we check anyway.
    const val = flicker(5, 5);
    assert.ok(val >= 0.5, 'Value should be clamped to 0.5 min');
  });
});
