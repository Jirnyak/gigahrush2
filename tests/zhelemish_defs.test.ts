import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { getZhelemishDef } from '../src/data/zhelemish_defs';

test('getZhelemishDef returns definition for valid ID', () => {
  const def = getZhelemishDef('zhelemish_raw');
  assert.ok(def, 'Should return definition for valid ID');
  assert.equal(def.itemId, 'zhelemish_raw');
  assert.equal(def.form, 'raw');
});

test('getZhelemishDef returns undefined for invalid ID', () => {
  const def = getZhelemishDef('not_a_zhelemish');
  assert.equal(def, undefined, 'Should return undefined for invalid ID');
});
