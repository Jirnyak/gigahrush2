import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGamepadAdapter } from '../src/input_gamepad.js';

describe('createGamepadAdapter', () => {
  it('returns a GamepadAdapter object with the expected shape', () => {
    const adapter = createGamepadAdapter();
    assert.strictEqual(typeof adapter.poll, 'function');
    assert.strictEqual(typeof adapter.detach, 'function');
    assert.strictEqual(typeof adapter.isConnected, 'function');
    assert.strictEqual(typeof adapter.hadAnyInput, 'function');
    assert.strictEqual(typeof adapter.settings, 'function');
  });

  it('has initial state where isConnected and hadAnyInput are false', () => {
    const adapter = createGamepadAdapter();
    assert.strictEqual(adapter.isConnected(), false);
    assert.strictEqual(adapter.hadAnyInput(), false);
  });
});
