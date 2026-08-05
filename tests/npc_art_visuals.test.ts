import test from 'node:test';
import assert from 'node:assert/strict';

import { categorizeNpcAge } from '../src/data/npc_art_visuals';

test('categorizeNpcAge returns adult when age is undefined', () => {
  assert.equal(categorizeNpcAge(undefined), 'adult');
  assert.equal(categorizeNpcAge(), 'adult');
});

test('categorizeNpcAge categorizes children (age <= 14)', () => {
  assert.equal(categorizeNpcAge(0), 'child');
  assert.equal(categorizeNpcAge(5), 'child');
  assert.equal(categorizeNpcAge(14), 'child');
  assert.equal(categorizeNpcAge(-5), 'child'); // edge case
});

test('categorizeNpcAge categorizes young (14 < age <= 25)', () => {
  assert.equal(categorizeNpcAge(14.5), 'young');
  assert.equal(categorizeNpcAge(15), 'young');
  assert.equal(categorizeNpcAge(20), 'young');
  assert.equal(categorizeNpcAge(25), 'young');
});

test('categorizeNpcAge categorizes adult (25 < age < 60)', () => {
  assert.equal(categorizeNpcAge(25.1), 'adult');
  assert.equal(categorizeNpcAge(26), 'adult');
  assert.equal(categorizeNpcAge(40), 'adult');
  assert.equal(categorizeNpcAge(59), 'adult');
});

test('categorizeNpcAge categorizes old (age >= 60)', () => {
  assert.equal(categorizeNpcAge(60), 'old');
  assert.equal(categorizeNpcAge(65), 'old');
  assert.equal(categorizeNpcAge(100), 'old');
});
