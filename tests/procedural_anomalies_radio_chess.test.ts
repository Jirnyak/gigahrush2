import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, Feature } from '../src/core/types';
import { World } from '../src/core/world';
import {
  getRadioChessStatus,
  radioChessPhaseDanger,
  tryUseRadioChessAnomaly,
  updateRadioChessAnomaly,
} from '../src/systems/procedural_anomalies/radio_chess';
import { addTestRoom, makeGameState, makeTestPlayer } from './helpers';

function makeRadioChessArena(): {
  world: World;
  state: ReturnType<typeof makeGameState>;
  player: ReturnType<typeof makeTestPlayer>;
  beaconIdx: number;
  beaconX: number;
  beaconY: number;
  dangerX: number;
  dangerY: number;
} {
  const world = new World();
  const state = makeGameState({ time: 0 });
  const player = makeTestPlayer({ hp: 50 });
  const room = addTestRoom(world, {
    id: 0,
    x: 20,
    y: 20,
    w: 9,
    h: 9,
    name: 'Радио-шахматы: тест',
  });
  const beaconX = room.x + 4;
  const beaconY = room.y + 4;
  const beaconIdx = world.idx(beaconX, beaconY);
  world.setFeatureAt(beaconIdx, Feature.APPARATUS);

  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      const ci = world.idx(x, y);
      if (world.cells[ci] !== Cell.FLOOR) continue;
      player.x = x + 0.5;
      player.y = y + 0.5;
      const status = getRadioChessStatus(world, player, state);
      if (status.active && status.inArena && status.dangerous) {
        return { world, state, player, beaconIdx, beaconX, beaconY, dangerX: x, dangerY: y };
      }
    }
  }
  assert.fail('test arena should expose a dangerous radio-chess cell at phase 0');
}

test('radio chess phase danger is deterministic for color phases', () => {
  const seed = 11;

  assert.equal(radioChessPhaseDanger(10, 10, 0, seed, 8, 8), true);
  assert.equal(radioChessPhaseDanger(11, 10, 0, seed, 8, 8), false);
  assert.equal(radioChessPhaseDanger(10, 10, 1, seed, 8, 8), false);
  assert.equal(radioChessPhaseDanger(11, 10, 1, seed, 8, 8), true);
});

test('radio chess phase danger supports file, rank, and knight patterns', () => {
  const seed = 8;

  assert.equal(radioChessPhaseDanger(8, 13, 2, seed, 8, 8), false);
  assert.equal(radioChessPhaseDanger(9, 13, 2, seed, 8, 8), true);
  assert.equal(radioChessPhaseDanger(13, 7, 3, seed, 8, 8), false);
  assert.equal(radioChessPhaseDanger(13, 8, 3, seed, 8, 8), true);
  assert.equal(radioChessPhaseDanger(9, 10, 4, seed, 8, 8), false);
  assert.equal(radioChessPhaseDanger(10, 10, 4, seed, 8, 8), true);
});

test('radio chess applies pressure on fixed cadence with visible phase cue', () => {
  const { world, state, player } = makeRadioChessArena();
  const hp = player.hp!;

  updateRadioChessAnomaly(world, player, state, 0.79);
  assert.equal(player.hp, hp);
  assert.equal(state.msgs.some(entry => entry.text.includes('Радио: безопасны')), true);

  state.time += 0.79;
  updateRadioChessAnomaly(world, player, state, 0.02);
  assert.equal(player.hp, hp - 3);
  assert.equal(getRadioChessStatus(world, player, state).prompt.includes('безопасны'), true);
});

test('radio chess beacon control freezes and restores the local arena', () => {
  const { world, state, player, beaconIdx, beaconX, beaconY, dangerX, dangerY } = makeRadioChessArena();

  player.x = beaconX + 0.5;
  player.y = beaconY + 0.5;
  assert.equal(tryUseRadioChessAnomaly(world, player, state, beaconX + 0.5, beaconY + 0.5), true);
  assert.equal(world.features[beaconIdx], Feature.MACHINE);

  player.x = dangerX + 0.5;
  player.y = dangerY + 0.5;
  let status = getRadioChessStatus(world, player, state);
  assert.equal(status.active, false);
  assert.equal(status.disabledBeacons, 1);
  const hp = player.hp!;
  updateRadioChessAnomaly(world, player, state, 10);
  assert.equal(player.hp, hp);

  const restoredState = makeGameState({ time: state.time });
  status = getRadioChessStatus(world, player, restoredState);
  assert.equal(status.active, false);
  assert.equal(status.disabledBeacons, 1);

  player.x = beaconX + 0.5;
  player.y = beaconY + 0.5;
  assert.equal(tryUseRadioChessAnomaly(world, player, restoredState, beaconX + 0.5, beaconY + 0.5), true);
  assert.equal(world.features[beaconIdx], Feature.APPARATUS);
  player.x = dangerX + 0.5;
  player.y = dangerY + 0.5;
  status = getRadioChessStatus(world, player, restoredState);
  assert.equal(status.active, true);
  assert.equal(status.disabledBeacons, 0);
});
