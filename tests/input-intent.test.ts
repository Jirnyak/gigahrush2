import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  applyStickDeadzone,
  applyTriggerCurve,
  beginInputFrame,
  createInputFrame,
  mergeAxis,
  pressAction,
  releaseAction,
  resolveInputFrameToInputState,
  setActionHeld,
  setMenuNav,
} from '../src/systems/input_intent';
import { createInput } from '../src/input';

test('radial deadzone returns zero inside dead radius and scales outside', () => {
  const inner = applyStickDeadzone(0.1, 0, 0.18, 1.15);
  assert.equal(inner.x, 0);
  assert.equal(inner.y, 0);

  const outer = applyStickDeadzone(1, 0, 0.18, 1);
  assert.ok(Math.abs(outer.x - 1) < 1e-6);
  assert.equal(outer.y, 0);

  const mid = applyStickDeadzone(0.5, 0, 0.18, 1);
  assert.ok(mid.x > 0 && mid.x < 1);

  const clamped = applyStickDeadzone(2, 0, 0, 1);
  assert.ok(Math.abs(clamped.x - 1) < 1e-6);
});

test('trigger curve respects held vs edge thresholds', () => {
  const idle = applyTriggerCurve(0.1, 0.35, 0.55);
  assert.equal(idle.held, false);
  assert.equal(idle.pressed, false);
  assert.equal(idle.analog, 0);

  const partial = applyTriggerCurve(0.4, 0.35, 0.55);
  assert.equal(partial.held, true);
  assert.equal(partial.pressed, false);
  assert.ok(partial.analog > 0);

  const full = applyTriggerCurve(0.9, 0.35, 0.55);
  assert.equal(full.held, true);
  assert.equal(full.pressed, true);
  assert.ok(full.analog > 0 && full.analog <= 1);
});

test('mergeAxis clamps to [-1, 1] across multiple contributions', () => {
  const frame = createInputFrame();
  mergeAxis(frame, 'moveX', 0.4);
  mergeAxis(frame, 'moveX', 0.4);
  assert.ok(Math.abs(frame.axes.moveX - 0.8) < 1e-9);
  mergeAxis(frame, 'moveX', 0.6);
  assert.equal(frame.axes.moveX, 1);
  mergeAxis(frame, 'moveX', -3);
  assert.equal(frame.axes.moveX, -1);
});

test('beginInputFrame clears axes, action sets and menu nav but keeps hardware status', () => {
  const frame = createInputFrame();
  mergeAxis(frame, 'lookX', 0.5);
  setActionHeld(frame, 'sprint', true);
  pressAction(frame, 'gameMenu');
  releaseAction(frame, 'attack');
  setMenuNav(frame, 'up', true);
  frame.hardware.gamepadConnected = true;
  frame.hardware.gamepadLabel = 'Pad';

  beginInputFrame(frame);

  assert.equal(frame.axes.lookX, 0);
  assert.equal(frame.heldActions.size, 0);
  assert.equal(frame.pressedActions.size, 0);
  assert.equal(frame.releasedActions.size, 0);
  assert.equal(frame.menuNav.up, false);
  assert.equal(frame.hardware.gamepadConnected, true);
  assert.equal(frame.hardware.gamepadLabel, 'Pad');
});

test('resolver mirrors held actions into InputState booleans', () => {
  const frame = createInputFrame();
  const input = createInput();
  setActionHeld(frame, 'sprint', true);
  setActionHeld(frame, 'attack', true);

  resolveInputFrameToInputState(frame, input, { writeMenuEdgesFromActions: false });

  assert.equal(input.sprint, true);
  assert.equal(input.attack, true);
});

test('resolver clears held boolean when adapter reports release without re-hold', () => {
  const frame = createInputFrame();
  const input = createInput();
  setActionHeld(frame, 'sprint', true);
  resolveInputFrameToInputState(frame, input, { writeMenuEdgesFromActions: false });
  assert.equal(input.sprint, true);

  beginInputFrame(frame);
  releaseAction(frame, 'sprint');
  resolveInputFrameToInputState(frame, input, { writeMenuEdgesFromActions: false });
  assert.equal(input.sprint, false);
});

test('resolver gives interact one-frame edge and persistent held flag', () => {
  const frame = createInputFrame();
  const input = createInput();
  pressAction(frame, 'interact');

  resolveInputFrameToInputState(frame, input, { writeMenuEdgesFromActions: false });
  assert.equal(input.interact, true);
  assert.equal(input.interactHeld, true);

  beginInputFrame(frame);
  setActionHeld(frame, 'interact', true);
  resolveInputFrameToInputState(frame, input, { writeMenuEdgesFromActions: false });
  assert.equal(input.interactHeld, true);

  beginInputFrame(frame);
  releaseAction(frame, 'interact');
  resolveInputFrameToInputState(frame, input, { writeMenuEdgesFromActions: false });
  assert.equal(input.interactHeld, false);
});

test('resolver writes menu accept/close latches only when context allows it', () => {
  const frame = createInputFrame();
  const input = createInput();
  pressAction(frame, 'gameMenu');
  pressAction(frame, 'menuClose');

  resolveInputFrameToInputState(frame, input, { writeMenuEdgesFromActions: false });
  assert.equal(input.menuAccept, false);
  assert.equal(input.menuClose, false);

  beginInputFrame(frame);
  pressAction(frame, 'gameMenu');
  pressAction(frame, 'menuClose');
  resolveInputFrameToInputState(frame, input, { writeMenuEdgesFromActions: true });
  assert.equal(input.menuAccept, true);
  assert.equal(input.menuClose, true);
});

test('resolver routes menu navigation edges into invUp/Dn/Left/Right', () => {
  const frame = createInputFrame();
  const input = createInput();
  setMenuNav(frame, 'up', true);
  setMenuNav(frame, 'right', true);

  resolveInputFrameToInputState(frame, input, { writeMenuEdgesFromActions: false });
  assert.equal(input.invUp, true);
  assert.equal(input.invDn, false);
  assert.equal(input.invLeft, false);
  assert.equal(input.invRight, true);
});

test('resolver clears invDn when a held menuDown action releases', () => {
  // Regression: D-pad press would set `input.invDn = true` but the boolean
  // was never cleared, causing menus to auto-scroll forever. The adapter
  // now routes D-pad through `setActionHeld('menuDown')`, so the release
  // edge must mirror back into `input.invDn = false`.
  const frame = createInputFrame();
  const input = createInput();
  setActionHeld(frame, 'menuDown', true);
  resolveInputFrameToInputState(frame, input, { writeMenuEdgesFromActions: false });
  assert.equal(input.invDn, true);

  beginInputFrame(frame);
  setActionHeld(frame, 'menuDown', true);
  resolveInputFrameToInputState(frame, input, { writeMenuEdgesFromActions: false });
  assert.equal(input.invDn, true);

  beginInputFrame(frame);
  releaseAction(frame, 'menuDown');
  resolveInputFrameToInputState(frame, input, { writeMenuEdgesFromActions: false });
  assert.equal(input.invDn, false);
});
