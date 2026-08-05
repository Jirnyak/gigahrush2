import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isNetTerminalGenFleshItem,
  ensureNetTerminalGenState,
  getNetTerminalGenState,
  setNetTerminalGenState,
  isNetTerminalGenFleshDrop,
  hasNetTerminalGen
} from '../src/systems/net_terminal_gen';
import { NET_TERMINAL_GEN_ITEM_ID } from '../src/data/net_terminal_gen';
import { EntityType } from '../src/core/types';

test('isNetTerminalGenFleshItem correctly identifies net terminal flesh items', () => {
  assert.equal(isNetTerminalGenFleshItem(undefined), false);
  assert.equal(isNetTerminalGenFleshItem({ id: 'some-other-item', defId: 'other', name: 'Other', spr: 0 }), false);
  assert.equal(isNetTerminalGenFleshItem({ id: NET_TERMINAL_GEN_ITEM_ID, defId: NET_TERMINAL_GEN_ITEM_ID, name: 'Flesh', spr: 0 }), false);
  assert.equal(isNetTerminalGenFleshItem({ id: NET_TERMINAL_GEN_ITEM_ID, defId: NET_TERMINAL_GEN_ITEM_ID, name: 'Flesh', spr: 0, data: { netTerminalGen: true } }), true);
});

test('ensureNetTerminalGenState generates state and applies it to GameState', () => {
  const state: any = {
    time: 0,
    runSeed: 123,
    netTerminalGen: undefined,
    history: { floors: [] },
  };
  const result = ensureNetTerminalGenState(state);
  assert.equal(typeof result, 'object');
  assert.equal(state.netTerminalGen, result);
});

test('getNetTerminalGenState retrieves state if defined', () => {
  const state: any = {
    time: 0,
    runSeed: 123,
    netTerminalGen: undefined,
    history: { floors: [] },
  };
  assert.equal(getNetTerminalGenState(state), undefined);

  const generated = ensureNetTerminalGenState(state);
  assert.notEqual(getNetTerminalGenState(state), undefined);
  assert.equal(getNetTerminalGenState(state)?.runSeed, generated.runSeed);
});

test('setNetTerminalGenState normalizes input and stores it on state', () => {
  const state: any = {
    time: 0,
    runSeed: 123,
    netTerminalGen: undefined,
    history: { floors: [] },
  };

  const partialInput: any = {
    found: true,
    pickupClaimed: true,
  };

  const result = setNetTerminalGenState(state, partialInput);
  // `found` resolves to false because `partialInput.runSeed` does not match derived target runSeed
  assert.equal(result.found, false);
  assert.equal(state.netTerminalGen, result);
});

test('isNetTerminalGenFleshDrop correctly identifies drop entities', () => {
  assert.equal(isNetTerminalGenFleshDrop({ type: EntityType.NPC, id: 1, x: 0, y: 0, alive: true } as any), false);

  const notFleshDrop = {
    type: EntityType.ITEM_DROP,
    id: 1, x: 0, y: 0, alive: true,
    inventory: [{ defId: 'other', id: 'other', name: 'Other', spr: 0 }]
  } as any;
  assert.equal(isNetTerminalGenFleshDrop(notFleshDrop), false);

  const fleshDrop = {
    type: EntityType.ITEM_DROP,
    id: 1, x: 0, y: 0, alive: true,
    inventory: [{
      defId: NET_TERMINAL_GEN_ITEM_ID,
      id: NET_TERMINAL_GEN_ITEM_ID,
      name: 'Flesh',
      spr: 0,
      data: { netTerminalGen: true }
    }]
  } as any;
  assert.equal(isNetTerminalGenFleshDrop(fleshDrop), true);
});

test('hasNetTerminalGen checks player inventory for flesh item', () => {
  const state: any = {
    time: 0,
    history: { floors: [] }
  };

  // No player provided
  assert.equal(hasNetTerminalGen(state), false);

  const playerWithoutItem: any = {
    type: EntityType.NPC,
    inventory: [
      { defId: 'other', id: 'other', name: 'Other', spr: 0 }
    ]
  };
  assert.equal(hasNetTerminalGen(state, playerWithoutItem), false);

  const playerWithItem: any = {
    type: EntityType.NPC,
    inventory: [
      {
        defId: NET_TERMINAL_GEN_ITEM_ID,
        id: NET_TERMINAL_GEN_ITEM_ID,
        name: 'Flesh',
        spr: 0,
        data: { netTerminalGen: true }
      }
    ]
  };
  assert.equal(hasNetTerminalGen(state, playerWithItem), true);
});
