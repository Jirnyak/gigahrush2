import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { xorshift32, pickFrom } from '../src/core/rand';

test('xorshift32 produces deterministic sequence for a given seed', () => {
  const rng1 = xorshift32(12345);
  const rng2 = xorshift32(12345);

  for (let i = 0; i < 10; i++) {
    assert.equal(rng1(), rng2());
  }
});

test('xorshift32 handles zero seed by falling back to 1', () => {
  const rngZero = xorshift32(0);
  const rngOne = xorshift32(1);

  for (let i = 0; i < 10; i++) {
    assert.equal(rngZero(), rngOne());
  }
});

test('xorshift32 handles negative and fractional seeds with bitwise truncation', () => {
  const rngNegative = xorshift32(-1.5);
  const expectedSeed = (-1.5) | 0; // -1
  const rngExpected = xorshift32(expectedSeed);

  for (let i = 0; i < 10; i++) {
    assert.equal(rngNegative(), rngExpected());
  }
});

test('xorshift32 generated values are exclusively within [0, 1)', () => {
  const rng = xorshift32(9999);
  for (let i = 0; i < 1000; i++) {
    const val = rng();
    assert.ok(val >= 0);
    assert.ok(val < 1);
  }
});

test('xorshift32 produces the known exact sequence for seed 1', () => {
  const rng = xorshift32(1);

  // The first 5 integer values generated before division
  const expectedInts = [
    270369,
    67634689,
    2647435461,
    307599695,
    2398689233,
  ];

  for (let i = 0; i < expectedInts.length; i++) {
    const val = rng();
    const intVal = Math.round(val * 4294967296); // Reverse the division
    assert.equal(intVal, expectedInts[i]);
  }
});

test('pickFrom returns the first item when random source evaluates to 0', () => {
  const items = ['a', 'b', 'c'];
  const rand0 = () => 0;
  assert.equal(pickFrom(rand0, items), 'a');
});

test('pickFrom returns the last item when random source evaluates to just under 1', () => {
  const items = ['a', 'b', 'c'];
  const randAlmost1 = () => 0.999999;
  assert.equal(pickFrom(randAlmost1, items), 'c');
});

test('pickFrom returns the correct middle item', () => {
  const items = ['a', 'b', 'c'];
  const randHalf = () => 0.5; // Math.floor(0.5 * 3) = Math.floor(1.5) = 1 ('b')
  assert.equal(pickFrom(randHalf, items), 'b');
});

test('pickFrom returns undefined when array is empty', () => {
  const items: string[] = [];
  const randHalf = () => 0.5;
  assert.equal(pickFrom(randHalf, items), undefined);
});
