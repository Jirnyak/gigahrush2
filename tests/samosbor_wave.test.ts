import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  classifySamosborWaveCellForTests,
  getSamosborWaveDebugLines,
  cancelSamosborWave
} from '../src/systems/samosbor_wave';

test('classifySamosborWaveCellForTests returns floor for ring <= 1', () => {
  assert.equal(classifySamosborWaveCellForTests(12345, 0, 10, 0), 'floor');
  assert.equal(classifySamosborWaveCellForTests(12345, 0, 10, 1), 'floor');
});

test('classifySamosborWaveCellForTests returns deterministic roles based on seed for ring > 1', () => {
  // Test determinism
  const role1 = classifySamosborWaveCellForTests(12345, 0, 10, 2);
  const role2 = classifySamosborWaveCellForTests(12345, 0, 10, 2);
  assert.equal(role1, role2);

  // Test across many seeds/indices to ensure we get a variety of roles
  const roles = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    roles.add(classifySamosborWaveCellForTests(12345, i, i * 2, 5));
  }
  assert.ok(roles.has('floor'));
  assert.ok(roles.has('residue'));
  assert.ok(roles.has('wall'));
  assert.ok(roles.has('abyss'));
  assert.ok(roles.has('door'));
});

test('getSamosborWaveDebugLines returns default when no active wave snapshot', () => {
  cancelSamosborWave();
  const lines = getSamosborWaveDebugLines();
  assert.equal(lines.length, 1);
  assert.equal(lines[0], 'Волна самосбора: -');
});
