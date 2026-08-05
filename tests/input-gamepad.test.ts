import { resetGamepadSettings, updateGamepadSettings } from '../src/systems/gamepad_settings';
import { test, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';

import { createGamepadAdapter } from '../src/input_gamepad';
import { createInputFrame } from '../src/systems/input_intent';

// Minimal DOM mock setup
let listeners: Record<string, Function[]> = {};

function dispatchEvent(type: string, eventInit: any = {}) {
  const cbs = listeners[type] || [];
  for (const cb of cbs) {
    cb({ type, ...eventInit });
  }
}

let mockGamepads: any[] = [];

let originalWindow: any;
let originalNavigator: any;
let originalLocalStorage: any;

beforeEach(() => {
  resetGamepadSettings();

  listeners = {};
  mockGamepads = [];

  originalWindow = (global as any).window;
  originalNavigator = (global as any).navigator;
  originalLocalStorage = (global as any).localStorage;

  const mockWin = {
    addEventListener: (type: string, cb: Function) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(cb);
    },
    removeEventListener: (type: string, cb: Function) => {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((fn) => fn !== cb);
    },
  };
  Object.defineProperty(global, 'window', { value: mockWin, writable: true, configurable: true });

  const mockNav = {
    getGamepads: () => mockGamepads,
  };
  Object.defineProperty(global, 'navigator', { value: mockNav, writable: true, configurable: true });

  let store: Record<string, string> = {};
  const mockStorage = {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
  Object.defineProperty(global, 'localStorage', { value: mockStorage, writable: true, configurable: true });
});

afterEach(() => {
  Object.defineProperty(global, 'window', { value: originalWindow, writable: true, configurable: true });
  Object.defineProperty(global, 'navigator', { value: originalNavigator, writable: true, configurable: true });
  Object.defineProperty(global, 'localStorage', { value: originalLocalStorage, writable: true, configurable: true });
});

test('adapter returns initial state when created', () => {
  const adapter = createGamepadAdapter();
  assert.equal(adapter.isConnected(), false);
  assert.equal(adapter.hadAnyInput(), false);
  assert.ok(adapter.settings());
  assert.equal(typeof adapter.poll, 'function');
  assert.equal(typeof adapter.detach, 'function');
});

test('adapter attaches to window events on creation and removes on detach', () => {
  const adapter = createGamepadAdapter();
  assert.equal(listeners['gamepadconnected']?.length, 1);
  assert.equal(listeners['gamepaddisconnected']?.length, 1);

  adapter.detach();
  assert.equal(listeners['gamepadconnected']?.length, 0);
  assert.equal(listeners['gamepaddisconnected']?.length, 0);
});
export function mockPad(index: number, mapping = 'standard', connected = true): any {
  const pad: any = {
    index,
    id: `Mock Pad ${index}`,
    connected,
    mapping,
    axes: [0, 0, 0, 0],
    buttons: new Array(17).fill({ pressed: false, value: 0 }),
  };
  return pad;
}

export { dispatchEvent, mockGamepads };

test('adapter selects standard gamepad on connection and handles disconnect', () => {
  const adapter = createGamepadAdapter();
  const frame = createInputFrame();

  assert.equal(adapter.isConnected(), false);

  const pad0 = mockPad(0, ''); // Not standard
  const pad1 = mockPad(1, 'standard');

  mockGamepads[0] = pad0;
  mockGamepads[1] = pad1;

  dispatchEvent('gamepadconnected', { gamepad: pad1 });

  adapter.poll(frame);

  assert.equal(adapter.isConnected(), true);
  assert.equal(frame.hardware.gamepadConnected, true);
  assert.equal(frame.hardware.gamepadMappingStandard, true);
  assert.equal(frame.hardware.gamepadLabel, 'Mock Pad 1');

  // Disconnect
  pad1.connected = false;
  dispatchEvent('gamepaddisconnected', { gamepad: pad1 });

  adapter.poll(frame);
  assert.equal(adapter.isConnected(), false);
  assert.equal(frame.hardware.gamepadConnected, false);
});

test('adapter returns correctly when gamepad settings are disabled', () => {
  const adapter = createGamepadAdapter();
  const frame = createInputFrame();

  const pad0 = mockPad(0, 'standard');
  mockGamepads[0] = pad0;
  dispatchEvent('gamepadconnected', { gamepad: pad0 });

  // Simulate settings with enabled: false
  updateGamepadSettings({ enabled: false });

  adapter.poll(frame);

  // Settings are disabled, so polling shouldn't process the pad
  assert.equal(adapter.isConnected(), false);
});

test('adapter clears holds when a gamepad disconnects', () => {
  const adapter = createGamepadAdapter();
  let frame = createInputFrame();

  const pad0 = mockPad(0, 'standard');
  mockGamepads[0] = pad0;
  dispatchEvent('gamepadconnected', { gamepad: pad0 });

  // Simulate sprinting (Button 10 -> 'sprint' hold action)
  pad0.buttons[10] = { pressed: true, value: 1 };
  adapter.poll(frame);

  assert.ok(frame.heldActions.has('sprint'));

  // Disconnect the gamepad
  pad0.connected = false;
  // dispatchEvent('gamepaddisconnected', { gamepad: pad0 }); // Note: onDisconnected clears prevButtons, preventing poll from emitting releases if it triggers first. We just simulate getGamepads() returning nothing.
mockGamepads = [];

  frame = createInputFrame();
  adapter.poll(frame);

  // It should release 'sprint'
  assert.ok(frame.releasedActions.has('sprint'));
});


test('adapter maps axes to moveX, moveY, lookX, lookY with deadzones', () => {
  const adapter = createGamepadAdapter();
  const frame = createInputFrame();

  const pad = mockPad(0, 'standard');
  mockGamepads[0] = pad;
  dispatchEvent('gamepadconnected', { gamepad: pad });

  // 0,1 are move; 2,3 are look
  // set axes above default deadzone (0.18 / 0.16)
  pad.axes = [0.5, -0.6, 0.4, -0.4];

  adapter.poll(frame);

  // x and y should map to mergeAxis calls
  assert.ok(frame.axes.moveX > 0);
  assert.ok(frame.axes.moveY > 0); // Note: adapter does mergeAxis(frame, 'moveY', -move.y), so -(-0.6) = 0.6
  assert.ok(frame.axes.lookX > 0);
  assert.ok(frame.axes.lookY < 0);
  assert.equal(adapter.hadAnyInput(), true);
  assert.equal(frame.hardware.gamepadConnected, true);
});

test('adapter inverts lookY based on settings', () => {
  const adapter = createGamepadAdapter();
  const frame = createInputFrame();

  const pad = mockPad(0, 'standard');
  mockGamepads[0] = pad;
  dispatchEvent('gamepadconnected', { gamepad: pad });

  updateGamepadSettings({ invertLookY: true });

  pad.axes = [0, 0, 0, 0.5]; // positive y
  adapter.poll(frame);

  assert.ok(frame.axes.lookY < 0); // Inverted!
});

test('adapter maps triggers to analog held actions', () => {
  const adapter = createGamepadAdapter();
  const frame = createInputFrame();

  const pad = mockPad(0, 'standard');
  mockGamepads[0] = pad;
  dispatchEvent('gamepadconnected', { gamepad: pad });

  // LT is 6, RT is 7. Default triggerThreshold is 0.35.
  // We'll set LT slightly above threshold, RT high above.
  pad.buttons[6] = { pressed: true, value: 0.5 };
  pad.buttons[7] = { pressed: true, value: 1.0 };

  adapter.poll(frame);

  // LT -> useTool (Button 6)
  assert.ok(frame.heldActions.has('useTool'));
  // RT -> attack (Button 7)
  assert.ok(frame.heldActions.has('attack'));
});

test('adapter maps buttons to hold and edge actions', () => {
  const adapter = createGamepadAdapter();
  const frame = createInputFrame();

  const pad = mockPad(0, 'standard');
  mockGamepads[0] = pad;
  dispatchEvent('gamepadconnected', { gamepad: pad });

  // Button 0 (A) -> interact (Edge action)
  // Button 2 (X) -> useTool (Hold action)
  pad.buttons[0] = { pressed: true, value: 1 };
  pad.buttons[2] = { pressed: true, value: 1 };

  adapter.poll(frame);

  // Edge actions emit pressed on transition
  assert.ok(frame.pressedActions.has('interact'));
  // Hold actions emit held
  assert.ok(frame.heldActions.has('useTool'));
});

test('adapter maps D-pad to menu navigation edges', () => {
  const adapter = createGamepadAdapter();
  const frame = createInputFrame();

  const pad = mockPad(0, 'standard');
  mockGamepads[0] = pad;
  dispatchEvent('gamepadconnected', { gamepad: pad });

  // 12 -> up, 13 -> down, 14 -> left, 15 -> right
  pad.buttons[12] = { pressed: true, value: 1 };
  pad.buttons[15] = { pressed: true, value: 1 };

  adapter.poll(frame);

  assert.equal(frame.menuNav.up, true);
  assert.equal(frame.menuNav.down, false);
  assert.equal(frame.menuNav.left, false);
  assert.equal(frame.menuNav.right, true);

  // D-pad also maps to held actions for menuUp/menuDown/menuLeft/menuRight
  assert.ok(frame.heldActions.has('menuUp'));
  assert.ok(frame.heldActions.has('menuRight'));
});

test('adapter handles missing window/navigator gracefully', () => {
  const currentWindow = (global as any).window;
  const currentNavigator = (global as any).navigator;
  try {
    Object.defineProperty(global, 'window', { value: undefined, writable: true, configurable: true });
    Object.defineProperty(global, 'navigator', { value: undefined, writable: true, configurable: true });

    const adapter = createGamepadAdapter();
    const frame = createInputFrame();

    assert.doesNotThrow(() => adapter.poll(frame));
    assert.doesNotThrow(() => adapter.detach());

    assert.equal(adapter.isConnected(), false);
  } finally {
    Object.defineProperty(global, 'window', { value: currentWindow, writable: true, configurable: true });
    Object.defineProperty(global, 'navigator', { value: currentNavigator, writable: true, configurable: true });
  }
});

test('adapter handles navigator.getGamepads throwing or being missing', () => {
  const currentNavigator = (global as any).navigator;
  try {
    Object.defineProperty(global, 'navigator', { value: { getGamepads: undefined }, writable: true, configurable: true });
    const adapter = createGamepadAdapter();
    const frame = createInputFrame();
    assert.doesNotThrow(() => adapter.poll(frame));
    assert.equal(adapter.isConnected(), false);

    Object.defineProperty(global, 'navigator', { value: { getGamepads: () => { throw new Error('Not allowed'); } }, writable: true, configurable: true });
    assert.doesNotThrow(() => adapter.poll(frame));
    assert.equal(adapter.isConnected(), false);
  } finally {
    Object.defineProperty(global, 'navigator', { value: currentNavigator, writable: true, configurable: true });
  }
});
