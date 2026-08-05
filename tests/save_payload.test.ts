import test from 'node:test';
import assert from 'node:assert/strict';

import { compactSaveData } from '../src/systems/save_payload';

test('compactSaveData handles primitives correctly', () => {
  assert.equal(compactSaveData(undefined), undefined);
  assert.equal(compactSaveData(null), null);
  assert.equal(compactSaveData(true), true);
  assert.equal(compactSaveData(false), false);
});

test('compactSaveData handles numbers correctly', () => {
  assert.equal(compactSaveData(42), 42);
  assert.equal(compactSaveData(0), 0);
  assert.equal(compactSaveData(-1.5), -1.5);

  // Non-finite numbers should be undefined
  assert.equal(compactSaveData(NaN), undefined);
  assert.equal(compactSaveData(Infinity), undefined);
  assert.equal(compactSaveData(-Infinity), undefined);
});

test('compactSaveData handles strings correctly', () => {
  assert.equal(compactSaveData('hello'), 'hello');
  assert.equal(compactSaveData(''), '');

  // Strings exceeding SAVE_DATA_STRING_CAP (512) should be truncated
  const longString = 'a'.repeat(600);
  const result = compactSaveData(longString) as string;
  assert.equal(typeof result, 'string');
  assert.equal(result.length, 512);
  assert.equal(result, 'a'.repeat(512));
});

test('compactSaveData handles arrays correctly', () => {
  assert.deepEqual(compactSaveData([1, 2, 'three']), [1, 2, 'three']);

  // Undefined items should be filtered out
  assert.deepEqual(compactSaveData([1, undefined, 2, null]), [1, 2, null]);
  assert.deepEqual(compactSaveData([NaN, Infinity, 1]), [1]);

  // Arrays exceeding SAVE_DATA_ARRAY_CAP (16) should be truncated
  const longArray = Array.from({ length: 20 }, (_, i) => i);
  const arrayResult = compactSaveData(longArray) as unknown[];
  assert.ok(Array.isArray(arrayResult));
  assert.equal(arrayResult.length, 16);
  assert.deepEqual(arrayResult, Array.from({ length: 16 }, (_, i) => i));

  // Depth capping (SAVE_DATA_DEPTH_CAP = 2)
  // Depth 0: original call. Depth 1: first level array. Depth 2: second level array -> should return undefined
  assert.deepEqual(compactSaveData([[1]]), [[1]]);
  assert.deepEqual(compactSaveData([[[1]]]), [[]]); // [[1]] at depth 1 evaluates its items. [1] at depth 2 evaluates to undefined, so it's filtered out of the depth 1 array. Wait, let's trace this carefully.
  // compactSaveData([[[1]]], 0)
  // value is [[1]]. depth 0
  // iterates over items. item 0 is [[1]]. calls compactSaveData([[1]], 1)
  // value is [[1]]. depth 1.
  // iterates over items. item 0 is [1]. calls compactSaveData([1], 2)
  // value is [1]. depth 2.
  // depth >= SAVE_DATA_DEPTH_CAP (2 >= 2). returns undefined.
  // So clean is undefined, doesn't push to out. returns [].
  // So [[]] should be the result.
});

test('compactSaveData handles objects correctly', () => {
  assert.deepEqual(compactSaveData({ a: 1, b: 'two' }), { a: 1, b: 'two' });

  // Undefined values should be filtered out
  assert.deepEqual(compactSaveData({ a: 1, b: undefined, c: null, d: NaN }), { a: 1, c: null });

  // Keys exceeding SAVE_DATA_KEY_CAP (16) should be truncated
  const objWithManyKeys: Record<string, number> = {};
  for (let i = 0; i < 20; i++) {
    objWithManyKeys[`key${i}`] = i;
  }
  const objResult = compactSaveData(objWithManyKeys) as Record<string, unknown>;
  assert.equal(Object.keys(objResult).length, 16);

  // Key length exceeding SAVE_DATA_KEY_LEN_CAP (48) should be truncated
  const longKey = 'a'.repeat(50);
  assert.deepEqual(compactSaveData({ [longKey]: 1 }), { ['a'.repeat(48)]: 1 });

  // Depth capping
  assert.deepEqual(compactSaveData({ a: { b: 1 } }), { a: { b: 1 } });
  assert.deepEqual(compactSaveData({ a: { b: { c: 1 } } }), { a: {} });
});

test('compactSaveData handles unsupported types', () => {
  assert.equal(compactSaveData(() => {}), undefined);
  assert.equal(compactSaveData(Symbol('test')), undefined);
});
