import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createInput } from '../src/input';

test('createInput returns an initial InputState with correct default values', () => {
  const input = createInput();

  assert.deepEqual(input, {
    fwd: false, back: false, left: false, right: false,
    strafeL: false, strafeR: false, sprint: false,
    attack: false, interact: false, interactHeld: false, pickup: false,
    reload: false,
    map: false, mapLegend: false, inv: false, invUp: false, invDn: false, invLeft: false, invRight: false,
    use: false, escape: false,
    questLog: false,
    mouseAttack: false, mouseUse: false,
    menuAccept: false, menuClose: false, menuWheel: 0, textInput: '',
    attrStr: false, attrAgi: false, attrInt: false,
    debugScreen: false,
    pee: false,
    drop: false,
    factionMenu: false,
    logMenu: false,
    help: false,
    sleep: false,
    controls: false,
    uiSettings: false,
    controlEdit: false,
    controlReset: false,
    controlClose: false,
    mouse: { dx: 0, dy: 0, locked: false },
    touch: { moveX: 0, moveY: 0, lookX: 0, lookY: 0, active: false },
  });
});

test('createInput returns a fresh instance each time', () => {
  const input1 = createInput();
  const input2 = createInput();

  assert.notEqual(input1, input2);
  assert.notEqual(input1.mouse, input2.mouse);
  assert.notEqual(input1.touch, input2.touch);
});
