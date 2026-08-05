import { afterEach, beforeEach, test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  defaultGamepadSettings,
  loadGamepadSettings,
  resetGamepadSettings,
  sanitizeGamepadSettings,
  saveGamepadSettings,
  updateGamepadSettings,
} from '../src/systems/gamepad_settings';

beforeEach(() => {
  resetGamepadSettings();
});

afterEach(() => {
  resetGamepadSettings();
});

test('default settings have safe radial deadzones and standard profile', () => {
  const d = defaultGamepadSettings();
  assert.equal(d.version, 1);
  assert.equal(d.profile, 'standard_xinput');
  assert.equal(d.enabled, true);
  assert.ok(d.moveDeadzone > 0 && d.moveDeadzone < 0.5);
  assert.ok(d.lookDeadzone > 0 && d.lookDeadzone < 0.5);
  assert.ok(d.triggerThreshold > 0 && d.triggerThreshold < 1);
  assert.equal(d.virtualGamepad.layout, 'compact');
});

test('sanitize rejects unknown version and falls back to defaults', () => {
  const sane = sanitizeGamepadSettings({ version: 999, enabled: false });
  assert.deepEqual(sane, defaultGamepadSettings());
});

test('sanitize rejects unknown enum values for profile and layout', () => {
  const sane = sanitizeGamepadSettings({
    version: 1,
    profile: 'mystery_layout',
    virtualGamepad: { layout: 'fancy' },
  });
  assert.equal(sane.profile, 'standard_xinput');
  assert.equal(sane.virtualGamepad.layout, 'compact');
});

test('sanitize clamps numeric ranges and ignores non-finite values', () => {
  const sane = sanitizeGamepadSettings({
    version: 1,
    moveDeadzone: 10,
    lookDeadzone: -5,
    triggerThreshold: 0.7,
    moveCurve: NaN,
    lookCurve: Infinity,
    lookSensitivity: 0.05,
    virtualGamepad: { opacity: 5 },
  });
  assert.equal(sane.moveDeadzone, 0.6);
  assert.equal(sane.lookDeadzone, 0);
  assert.ok(Math.abs(sane.triggerThreshold - 0.7) < 1e-9);
  assert.equal(sane.moveCurve, defaultGamepadSettings().moveCurve);
  assert.equal(sane.lookCurve, defaultGamepadSettings().lookCurve);
  assert.equal(sane.lookSensitivity, 0.1);
  assert.equal(sane.virtualGamepad.opacity, 1);
});

test('saveGamepadSettings + loadGamepadSettings round-trip survives reload', () => {
  saveGamepadSettings({ ...defaultGamepadSettings(), invertLookY: true, lookSensitivity: 2.5 });
  resetGamepadSettings(); // clear in-memory cache too
  const loaded = loadGamepadSettings();
  assert.equal(loaded.invertLookY, false); // resetGamepadSettings clears storage
  assert.equal(loaded.lookSensitivity, defaultGamepadSettings().lookSensitivity);

  saveGamepadSettings({ ...defaultGamepadSettings(), invertLookY: true, lookSensitivity: 2.5 });
  const second = loadGamepadSettings();
  assert.equal(second.invertLookY, true);
  assert.equal(second.lookSensitivity, 2.5);
});

test('updateGamepadSettings patches single fields without losing nested defaults', () => {
  const patched = updateGamepadSettings({ invertLookY: true });
  assert.equal(patched.invertLookY, true);
  assert.equal(patched.virtualGamepad.layout, defaultGamepadSettings().virtualGamepad.layout);

  const nested = updateGamepadSettings({ virtualGamepad: { enabled: true } });
  assert.equal(nested.virtualGamepad.enabled, true);
  assert.equal(nested.invertLookY, true);
});
