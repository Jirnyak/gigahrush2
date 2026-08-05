import { afterEach, beforeEach, test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  CONTROL_ACTIONS,
  applyControlCode,
  clearControlBinding,
  controlActionLocked,
  controlBindings,
  consumeControlCaptureCode,
  beginControlCapture,
  isControlResetCode,
  isMenuCloseCode,
  menuCloseHint,
  matchesControlAction,
  resetAllControlBindings,
  setControlPrimaryBinding,
} from '../src/systems/controls';
import { createInput } from '../src/input';

beforeEach(() => {
  resetAllControlBindings();
});

afterEach(() => {
  resetAllControlBindings();
});

test('keyboard rebinding appends keys without stealing them from other actions', () => {
  assert.equal(matchesControlAction('quests', 'KeyQ'), true);

  assert.equal(setControlPrimaryBinding('moveBackward', 'KeyQ'), true);

  assert.deepEqual([...controlBindings('moveBackward')], ['KeyS', 'ArrowDown', 'KeyQ']);
  assert.equal(matchesControlAction('moveBackward', 'KeyQ'), true);
  assert.equal(matchesControlAction('quests', 'KeyQ'), true);
});

test('main gameplay keys are rebindable and can share one physical key', () => {
  assert.equal(controlActionLocked('interact'), false);
  assert.equal(controlActionLocked('gameMenu'), false);

  assert.equal(setControlPrimaryBinding('moveBackward', 'KeyE'), true);
  assert.equal(setControlPrimaryBinding('quests', 'Enter'), true);
  assert.equal(setControlPrimaryBinding('moveForward', 'KeyB'), true);
  assert.equal(setControlPrimaryBinding('attack', 'Space'), true);
  assert.equal(setControlPrimaryBinding('quests', 'Escape'), true);

  assert.deepEqual([...controlBindings('interact')], ['KeyE']);
  assert.deepEqual([...controlBindings('gameMenu')], ['Enter']);
  assert.deepEqual([...controlBindings('attack')], ['MouseLeft', 'Space']);
  assert.deepEqual([...controlBindings('useTool')], ['MouseRight']);
  assert.equal(matchesControlAction('moveBackward', 'KeyE'), true);
  assert.equal(matchesControlAction('interact', 'KeyE'), true);
  assert.equal(matchesControlAction('quests', 'Enter'), true);
  assert.equal(matchesControlAction('gameMenu', 'Enter'), true);
  assert.equal(matchesControlAction('attack', 'Space'), true);
  assert.equal(matchesControlAction('useTool', 'KeyG'), false);
  assert.equal(matchesControlAction('mapLegend', 'KeyG'), true);
  assert.equal(matchesControlAction('useTool', 'KeyR'), false);
  assert.equal(matchesControlAction('reload', 'KeyR'), true);
  assert.equal(matchesControlAction('moveForward', 'KeyB'), true);
  assert.equal(matchesControlAction('quests', 'Escape'), true);
});

test('menu accept, close, clear and mouse buttons are ordinary bindings', () => {
  assert.deepEqual([...controlBindings('gameMenu')], ['Enter']);
  assert.deepEqual([...controlBindings('menuClose')], []);
  assert.deepEqual([...controlBindings('controlClear')], ['Backspace']);
  assert.deepEqual([...controlBindings('attack')], ['MouseLeft']);
  assert.deepEqual([...controlBindings('useTool')], ['MouseRight']);
  assert.deepEqual([...controlBindings('netSubmit')], ['Enter']);
  assert.deepEqual([...controlBindings('netClose')], ['Delete']);
  assert.deepEqual([...controlBindings('netErase')], ['Backspace']);
  assert.equal(isMenuCloseCode('Space'), false);
  assert.equal(isMenuCloseCode('Backspace'), false);
  assert.equal(isMenuCloseCode('Delete'), false);
  assert.equal(isMenuCloseCode('Enter'), false);
  assert.equal(isControlResetCode('Backspace'), true);
  assert.equal(menuCloseHint(), '[ПКМ]');
});

test('Space and Backspace can be shared with gameplay actions', () => {
  const input = createInput();

  assert.equal(setControlPrimaryBinding('moveBackward', 'Space'), true);
  assert.equal(setControlPrimaryBinding('moveBackward', 'Backspace'), true);
  assert.equal(setControlPrimaryBinding('moveBackward', 'Delete'), true);
  assert.equal(matchesControlAction('moveBackward', 'Space'), true);
  assert.equal(matchesControlAction('moveBackward', 'Backspace'), true);
  assert.equal(matchesControlAction('moveBackward', 'Delete'), true);
  assert.equal(applyControlCode(input, 'Space', true), true);
  assert.equal(input.back, true);
  assert.equal(input.controlClose, false);
  assert.equal(applyControlCode(input, 'Backspace', true), true);
  assert.equal(input.controlReset, true);
});

test('sprint is a held Shift movement binding', () => {
  const input = createInput();

  assert.deepEqual([...controlBindings('sprint')], ['ShiftLeft', 'ShiftRight']);
  assert.equal(applyControlCode(input, 'ShiftLeft', true), true);
  assert.equal(input.sprint, true);
  assert.equal(applyControlCode(input, 'ShiftLeft', false), true);
  assert.equal(input.sprint, false);
});

test('listed actions can be cleared and the Backspace command is listed like other bindings', () => {
  assert.equal(clearControlBinding('quests'), true);
  assert.deepEqual([...controlBindings('quests')], []);

  assert.equal(CONTROL_ACTIONS.some((action: { id: string }) => action.id === 'controlClear'), true);
});

test('capture assigns Enter, Space, Backspace, Escape and modifier keys', () => {
  beginControlCapture('quests');
  assert.equal(consumeControlCaptureCode('Enter'), true);
  assert.equal(matchesControlAction('quests', 'Enter'), true);

  beginControlCapture('quests');
  assert.equal(consumeControlCaptureCode('Space'), true);
  assert.equal(matchesControlAction('quests', 'Space'), true);

  beginControlCapture('quests');
  assert.equal(consumeControlCaptureCode('Backspace'), true);
  assert.equal(matchesControlAction('quests', 'Backspace'), true);

  beginControlCapture('quests');
  assert.equal(consumeControlCaptureCode('Escape'), true);
  assert.equal(matchesControlAction('quests', 'Escape'), true);

  beginControlCapture('quests');
  assert.equal(consumeControlCaptureCode('ControlLeft'), true);
  assert.equal(matchesControlAction('quests', 'ControlLeft'), true);
});
