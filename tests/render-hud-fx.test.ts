import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { flicker } from '../src/render/hud_fx';

describe('render/hud_fx', () => {
  describe('flicker()', () => {
    test('returns values within expected opacity bounds', () => {
      // Test over a large time span and various seeds
      for (let time = 0; time < 100; time += 0.1) {
        const seed = Math.floor(time * 13.37);
        const value = flicker(time, seed);
        assert.ok(value >= 0.5 && value <= 1.0, `flicker value ${value} out of bounds at time=${time}, seed=${seed}`);
      }
    });

    test('is deterministic', () => {
      const v1 = flicker(1.23, 42);
      const v2 = flicker(1.23, 42);
      assert.equal(v1, v2);
    });

    test('incorporates pulse and glitch over time', () => {
      // Test different times to ensure the value changes (proving pulse/glitch effects)
      const v1 = flicker(0, 10);
      const v2 = flicker(1, 10);
      const v3 = flicker(2, 10);

      assert.ok(v1 !== v2 || v2 !== v3, 'flicker should vary over time');
    });

    test('applies glitch effect when hash is high enough', () => {
      // The glitch triggers when hash2(Math.floor(time * 6), seed) > 0.93
      // We will search for a combination of time and seed that triggers the glitch,
      // and a combination that does not trigger it.
      //
      // base is 0.92, pulse is around [-0.03, 0.03].
      // So without glitch, value is around [0.89, 0.95].
      // With glitch (-0.15), value is around [0.74, 0.80].
      // Let's just find values that drop below 0.85, which must be a glitch.

      let foundGlitch = false;
      let foundNoGlitch = false;

      for (let t = 0; t < 1000; t += 0.5) {
        const val = flicker(t, 100);
        if (val < 0.85) {
          foundGlitch = true;
        } else {
          foundNoGlitch = true;
        }

        if (foundGlitch && foundNoGlitch) break;
      }

      assert.ok(foundGlitch, 'Should occasionally produce glitch values (< 0.85)');
      assert.ok(foundNoGlitch, 'Should occasionally produce normal values (>= 0.85)');
    });
  });
});
