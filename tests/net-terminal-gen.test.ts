import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  Cell,
  FloorLevel,
  RoomType,
} from '../src/core/types';
import { World } from '../src/core/world';
import {
  currentNetTerminalGenFloorKey,
  deriveNetTerminalGenTarget,
  normalizeNetTerminalGenState,
  getNetTerminalGenState,
  ensureNetTerminalGenState,
  setNetTerminalGenState,
  netTerminalGenStateForSave,
  isCurrentNetTerminalGenTargetFloor,
  resolveNetTerminalGenTargetForCurrentFloor,
  isNetTerminalGenFleshItem,
  isNetTerminalGenFleshDrop,
  ensureNetTerminalGenFleshDrop,
  claimNetTerminalGenFleshDrop,
  grantNetTerminalGenAccess,
  hasNetTerminalGen,
  clearNetTerminalGenTerminals,
  getNetTerminalGenTerminals,
  getNetTerminalGenTerminalAt,
  isNetTerminalGenTarget,
  registerNetTerminalGenTerminal,
  placeNetTerminalGenTerminal,
  placeNetTerminalGenTerminalsForCurrentFloor,
  markNetTerminalGenDenied,
  openNetTerminalGenDenied,
  openNetTerminalGenEditor,
  openNetTerminalBank,
  closeNetTerminalGen,
  isNetTerminalGenOpen,
  isNetTerminalGenDeniedOpen,
  isNetTerminalGenEditorOpen,
  isNetTerminalBankOpen,
  getNetTerminalGenRuntimeSnapshot,
  moveNetTerminalBankAction,
  moveNetTerminalBankPreset,
  activateNetTerminalBank,
  getNetTerminalBankSnapshot,
  tryUseNetTerminalGen,
  summarizeNetTerminalGen,
} from '../src/systems/net_terminal_gen';
import { NET_TERMINAL_GEN_ITEM_ID } from '../src/data/net_terminal_gen';
import { addTestRoom, makeGameState, makeTestPlayer } from './helpers';

const DIRS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

test('net terminal gen flesh item is identified correctly', () => {
  assert.equal(isNetTerminalGenFleshItem({ id: NET_TERMINAL_GEN_ITEM_ID, count: 1, defId: NET_TERMINAL_GEN_ITEM_ID, data: { netTerminalGen: true } }), true);
  assert.equal(isNetTerminalGenFleshItem({ id: 'some_other_item', count: 1, defId: 'some_other_item' }), false);
});

test('hasNetTerminalGen returns false if player does not have item and state does not have access', () => {
  const state = makeGameState();
  const player = makeTestPlayer();
  assert.equal(hasNetTerminalGen(state, player), false);
});

test('hasNetTerminalGen returns true if player has item', () => {
  const state = makeGameState();
  const player = makeTestPlayer({
    inventory: [{ id: NET_TERMINAL_GEN_ITEM_ID, count: 1, defId: NET_TERMINAL_GEN_ITEM_ID, data: { netTerminalGen: true } }]
  });
  assert.equal(hasNetTerminalGen(state, player), true);
});

test('hasNetTerminalGen returns true if state grants access', () => {
  const state = makeGameState();
  const player = makeTestPlayer();
  grantNetTerminalGenAccess(state);
  assert.equal(hasNetTerminalGen(state, player), true);
});

test('netTerminalGenStateForSave copies state without mutating original', () => {
  const state = makeGameState();
  ensureNetTerminalGenState(state);

  const saved = netTerminalGenStateForSave(state);
  assert.ok(saved);

  saved.found = true;
  const current = ensureNetTerminalGenState(state);
  assert.equal(current.found, false);
});

test('summarizeNetTerminalGen returns an array of strings', () => {
  const state = makeGameState();
  const summary = summarizeNetTerminalGen(state);
  assert.ok(Array.isArray(summary));
  assert.ok(summary.length > 0);
  assert.ok(summary[0].includes('seed='));
});
