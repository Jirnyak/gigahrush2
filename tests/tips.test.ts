import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomTip, TIP_COUNT } from '../src/data/tips';

test('randomTip returns a correctly formatted string', () => {
  const tip = randomTip();
  assert.equal(typeof tip, 'string');

  const match = tip.match(/^Совет (\d+): (.+)$/);
  assert.ok(match, `Tip "${tip}" does not match the expected format`);

  const num = parseInt(match[1] as string, 10);
  assert.ok(num >= 1 && num <= TIP_COUNT, `Tip number ${num} is out of bounds (1-${TIP_COUNT})`);
  assert.ok((match[2] as string).length > 0, 'Tip text should not be empty');
});

test('randomTip covers bounds with Math.random mock', () => {
  const originalRandom = Math.random;

  try {
    // Test lower bound
    Math.random = () => 0;
    const lowerTip = randomTip();
    const lowerMatch = lowerTip.match(/^Совет (\d+): (.+)$/);
    assert.ok(lowerMatch);
    assert.equal(parseInt(lowerMatch[1] as string, 10), 1);

    // Test upper bound
    Math.random = () => 0.9999999999999999;
    const upperTip = randomTip();
    const upperMatch = upperTip.match(/^Совет (\d+): (.+)$/);
    assert.ok(upperMatch);
    assert.equal(parseInt(upperMatch[1] as string, 10), TIP_COUNT);
  } finally {
    Math.random = originalRandom;
  }
});
