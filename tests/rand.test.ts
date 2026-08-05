import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { seededRandom, withSeededRandom } from '../src/core/rand';

test('seededRandom produces deterministic values when overriding Math.random', () => {
  const originalRandom = Math.random;

  try {
    const seed = 12345;
    const rng = seededRandom(seed);

    // Assign to Math.random to verify deterministic values can be consumed from Math.random
    Math.random = rng;

    const val1_1 = Math.random();
    const val1_2 = Math.random();

    assert.notEqual(val1_1, val1_2, 'Successive values should differ');

    const rng2 = seededRandom(seed);
    Math.random = rng2;

    const val2_1 = Math.random();
    const val2_2 = Math.random();

    assert.equal(val1_1, val2_1, 'First random value should match for same seed');
    assert.equal(val1_2, val2_2, 'Second random value should match for same seed');

  } finally {
    Math.random = originalRandom;
  }
});

test('withSeededRandom overwrites and restores Math.random', () => {
  const originalRandom = Math.random;

  const seed = 54321;
  const values1: number[] = [];

  withSeededRandom(seed, () => {
    assert.notEqual(Math.random, originalRandom, 'Math.random should be overridden');
    values1.push(Math.random());
    values1.push(Math.random());
  });

  assert.equal(Math.random, originalRandom, 'Math.random should be restored after execution');

  const values2: number[] = [];
  withSeededRandom(seed, () => {
    values2.push(Math.random());
    values2.push(Math.random());
  });

  assert.deepEqual(values1, values2, 'Math.random should produce deterministic values under the same seed');
});

test('withSeededRandom restores Math.random even if an error is thrown', () => {
  const originalRandom = Math.random;
  const seed = 999;

  assert.throws(() => {
    withSeededRandom(seed, () => {
      assert.notEqual(Math.random, originalRandom, 'Math.random should be overridden');
      throw new Error('Test error');
    });
  }, /Test error/);

  assert.equal(Math.random, originalRandom, 'Math.random should be restored even after error');
});
