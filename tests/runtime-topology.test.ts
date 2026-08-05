import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { W, Cell, DoorState, EntityType, Faction, Feature, LiftDirection, Tex, type Entity, type RailTrainTrack } from '../src/core/types';
import { World } from '../src/core/world';
import { RUNTIME_TOPOLOGY_CONTRACTS, runtimeTopologyContractById } from '../src/data/runtime_topology';
import { updateConwayLifeAnomaly } from '../src/systems/procedural_anomalies/conway_life';
import {
  livingTunnelsInteractionTargetId,
  tryUseLivingTunnelsAnomaly,
  updateLivingTunnelsAnomaly,
} from '../src/systems/procedural_anomalies/living_tunnels';
import { tryUseSandpilePerekrytieAnomaly, updateSandpilePerekrytieAnomaly } from '../src/systems/procedural_anomalies/sandpile_perekrytie';
import { tryUseSectionShiftAnomaly, updateSectionShiftAnomaly } from '../src/systems/procedural_anomalies/section_shift';
import { tryUseWallSnakeAnomaly, updateWallSnakeAnomaly } from '../src/systems/procedural_anomalies/wall_snake';
import { addRailTrainRoute, updateRailTrains } from '../src/systems/rail_trains';
import { addTestRoom, countInventoryItem, makeGameState, makeTestContainer, makeTestPlayer } from './helpers';

const EXPECTED_RUNTIME_TOPOLOGY_IDS = [
  'wall_snake',
  'living_tunnels',
  'section_shift',
  'sandpile_perekrytie',
  'conway_life',
  'rail_trains',
  'bad_apple_world',
] as const;

function topologyVersions(world: World): {
  cells: number;
  wallTex: number;
  floorTex: number;
  fog: number;
} {
  return {
    cells: world.cellVersion,
    wallTex: world.wallTexVersion,
    floorTex: world.floorTexVersion,
    fog: world.fogVersion,
  };
}

function makeRailWorld(): { world: World; track: RailTrainTrack } {
  const world = new World();
  const cells: number[] = [];
  for (let x = 10; x < 54; x++) {
    const ci = world.idx(x, 20);
    world.cells[ci] = Cell.WATER;
    cells.push(ci);
  }
  const platformCells: number[] = [];
  for (let x = 18; x <= 24; x++) {
    const ci = world.idx(x, 18);
    world.cells[ci] = Cell.FLOOR;
    platformCells.push(ci);
  }
  return {
    world,
    track: {
      id: 'test_line',
      label: 'Тестовая линия',
      cells,
      stationOffsets: [10, 32],
      platformCells,
      loop: true,
    },
  };
}

function wallSnakePathCells(world: World, x0: number, y0: number, w: number, h: number): number[] {
  const len = Math.max(1, (w + h) * 2 - 4);
  const cells: number[] = [];
  for (let step = 0; step < len; step++) {
    let t = step;
    if (t < w) {
      cells.push(world.idx(x0 + t, y0));
      continue;
    }
    t -= w;
    if (t < h - 1) {
      cells.push(world.idx(x0 + w - 1, y0 + 1 + t));
      continue;
    }
    t -= h - 1;
    if (t < w - 1) {
      cells.push(world.idx(x0 + w - 2 - t, y0 + h - 1));
      continue;
    }
    t -= w - 1;
    cells.push(world.idx(x0, y0 + h - 2 - t));
  }
  return cells;
}

function wallSnakeWallSnapshot(world: World, path: readonly number[]): string {
  return path.map(ci => world.cells[ci] === Cell.WALL ? '1' : '0').join('');
}

function wallSnakeLarvaTextureSnapshot(world: World, path: readonly number[]): string {
  return path.map(ci => {
    if (world.cells[ci] !== Cell.WALL) return '.';
    if (world.wallTex[ci] === Tex.DARK) return 'H';
    if (world.wallTex[ci] === Tex.LARVA_BODY) return 'B';
    if (world.wallTex[ci] === Tex.MEAT || world.wallTex[ci] === Tex.GUT) return 'M';
    return '?';
  }).join('');
}

test('runtime topology features publish safety contracts', () => {
  assert.deepEqual(
    RUNTIME_TOPOLOGY_CONTRACTS.map(row => row.id).sort(),
    [...EXPECTED_RUNTIME_TOPOLOGY_IDS].sort(),
  );
  for (const id of EXPECTED_RUNTIME_TOPOLOGY_IDS) {
    const contract = runtimeTopologyContractById(id);
    assert.equal(contract.cadence.length > 0, true, `${id}: cadence`);
    assert.equal(contract.maxArenaCells > 0, true, `${id}: maxArenaCells`);
    assert.equal(contract.maxArenaCount > 0, true, `${id}: maxArenaCount`);
    assert.equal(contract.cacheKey.length > 0, true, `${id}: cacheKey`);
    assert.equal(contract.invalidatesOn.length > 0, true, `${id}: invalidatesOn`);
    assert.equal(contract.dirtyFlags.length > 0, true, `${id}: dirtyFlags`);
    assert.equal(contract.routeCriticalProtections.length > 0, true, `${id}: routeCriticalProtections`);
    assert.equal(contract.counterplay.length > 0, true, `${id}: counterplay`);
    assert.equal(contract.saveBehavior.length > 0, true, `${id}: saveBehavior`);
  }
});

test('conway life runtime mutation bumps topology dirty versions and skips protected cells', () => {
  const world = new World();
  addTestRoom(world, { id: 0, x: 40, y: 40, w: 16, h: 16, name: 'Игра жизнь: тестовый зал' });
  const protectedIdx = world.idx(42, 42);
  world.cells[protectedIdx] = Cell.WALL;
  world.aptMask[protectedIdx] = 1;
  const liftIdx = world.idx(45, 48);
  world.cells[liftIdx] = Cell.LIFT;
  world.features[liftIdx] = Feature.LIFT_BUTTON;
  const doorIdx = world.idx(47, 48);
  world.cells[doorIdx] = Cell.FLOOR;
  world.doors.set(doorIdx, { idx: doorIdx, state: DoorState.OPEN, roomA: 0, roomB: -1, keyId: '', timer: 0 });
  const nearDoorIdx = world.idx(47, 49);
  world.cells[nearDoorIdx] = Cell.FLOOR;
  const containerIdx = world.idx(49, 48);
  world.cells[containerIdx] = Cell.FLOOR;
  world.addContainer(makeTestContainer({ id: 77, x: 49, y: 48, roomId: 0 }));

  for (const [x, y] of [[53, 47], [53, 48], [53, 49]] as const) {
    world.cells[world.idx(x, y)] = Cell.WALL;
  }

  const before = topologyVersions(world);
  updateConwayLifeAnomaly(world, makeTestPlayer({ x: 80.5, y: 80.5 }), makeGameState(), 1);

  assert.ok(world.cellVersion > before.cells);
  assert.ok(world.wallTexVersion > before.wallTex);
  assert.ok(world.floorTexVersion > before.floorTex);
  assert.ok(world.fogVersion > before.fog);
  assert.equal(world.cells[protectedIdx], Cell.WALL);
  assert.equal(world.aptMask[protectedIdx], 1);
  assert.equal(world.cells[liftIdx], Cell.LIFT);
  assert.equal(world.features[liftIdx], Feature.LIFT_BUTTON);
  assert.equal(world.cells[doorIdx], Cell.FLOOR);
  assert.equal(world.doors.has(doorIdx), true);
  assert.equal(world.cells[nearDoorIdx], Cell.FLOOR);
  assert.equal(world.cells[containerIdx], Cell.FLOOR);
  assert.deepEqual(world.containerMap.get(containerIdx), [77]);
});

test('living tunnels runtime mutation bumps topology dirty versions', () => {
  const world = new World();
  addTestRoom(world, { id: 0, x: 70, y: 70, w: 16, h: 16, name: 'Тестовые ходы [living_tunnel:76,76,12345,32]' });
  const before = topologyVersions(world);

  updateLivingTunnelsAnomaly(world, makeTestPlayer({ x: 100.5, y: 100.5, hp: 100 }), makeGameState(), 0.5);

  assert.ok(world.cellVersion > before.cells);
  assert.ok(world.wallTexVersion > before.wallTex);
  assert.ok(world.floorTexVersion > before.floorTex);
  assert.ok(world.fogVersion > before.fog);
});

test('living tunnels preserve route lift anchor buffers during runtime growth', () => {
  const world = new World();
  addTestRoom(world, { id: 0, x: 20, y: 20, w: 16, h: 16, name: 'Тестовые ходы [living_tunnel:25,25,12345,64]' });
  const liftIdx = world.idx(26, 25);
  const buttonIdx = world.idx(27, 25);
  world.cells[liftIdx] = Cell.LIFT;
  world.roomMap[liftIdx] = -1;
  world.liftDir[liftIdx] = LiftDirection.DOWN;
  world.features[buttonIdx] = Feature.LIFT_BUTTON;
  world.liftDir[buttonIdx] = LiftDirection.DOWN;

  const watched: {
    idx: number;
    cell: Cell;
    feature: Feature;
    floorTex: number;
    wallTex: number;
    roomMap: number;
    fog: number;
  }[] = [];
  for (let y = 23; y <= 27; y++) {
    for (let x = 24; x <= 29; x++) {
      const idx = world.idx(x, y);
      watched.push({
        idx,
        cell: world.cells[idx] as Cell,
        feature: world.features[idx] as Feature,
        floorTex: world.floorTex[idx],
        wallTex: world.wallTex[idx],
        roomMap: world.roomMap[idx],
        fog: world.fog[idx],
      });
    }
  }

  updateLivingTunnelsAnomaly(world, makeTestPlayer({ x: 80.5, y: 80.5, hp: 100 }), makeGameState(), 4);

  for (const beforeCell of watched) {
    assert.equal(world.cells[beforeCell.idx], beforeCell.cell, `cell changed at ${beforeCell.idx}`);
    assert.equal(world.features[beforeCell.idx], beforeCell.feature, `feature changed at ${beforeCell.idx}`);
    assert.equal(world.floorTex[beforeCell.idx], beforeCell.floorTex, `floor texture changed at ${beforeCell.idx}`);
    assert.equal(world.wallTex[beforeCell.idx], beforeCell.wallTex, `wall texture changed at ${beforeCell.idx}`);
    assert.equal(world.roomMap[beforeCell.idx], beforeCell.roomMap, `room map changed at ${beforeCell.idx}`);
    assert.equal(world.fog[beforeCell.idx], beforeCell.fog, `fog changed at ${beforeCell.idx}`);
  }
});

test('living tunnel active cuts can be sealed away from the root apparatus', () => {
  const world = new World();
  addTestRoom(world, { id: 0, x: 70, y: 70, w: 16, h: 16, name: 'Тестовые ходы [living_tunnel:76,76,12345,64]' });
  const state = makeGameState({ time: 10 });
  const player = makeTestPlayer({ x: 100.5, y: 100.5, hp: 100, inventory: [{ defId: 'sealant_tube', count: 1 }] });

  updateLivingTunnelsAnomaly(world, player, state, 2);
  let cutIdx = -1;
  const rootIdx = world.idx(76, 76);
  for (let i = 0; i < world.cells.length; i++) {
    if (i !== rootIdx && world.cells[i] === Cell.FLOOR && world.floorTex[i] === Tex.F_GUT) {
      cutIdx = i;
      break;
    }
  }
  assert.notEqual(cutIdx, -1);

  player.x = (cutIdx % W) + 0.5;
  player.y = ((cutIdx / W) | 0) + 0.5;
  assert.notEqual(livingTunnelsInteractionTargetId(world, player.x, player.y), null);
  assert.equal(tryUseLivingTunnelsAnomaly(world, player, state, player.x, player.y), true);
  assert.equal(countInventoryItem(player, 'sealant_tube'), 0);
});

test('wall snake runtime path preserves route-critical cells and marks solidity dirty', () => {
  const world = new World();
  addTestRoom(world, { id: 0, x: 20, y: 20, w: 16, h: 16, name: 'Тестовая змейка [wall_snake:21,21,12,12]' });
  const protectedIdx = world.idx(21, 21);
  world.cells[protectedIdx] = Cell.LIFT;
  world.features[protectedIdx] = Feature.LIFT_BUTTON;
  const before = topologyVersions(world);

  updateWallSnakeAnomaly(world, makeTestPlayer({ x: 80.5, y: 80.5, hp: 100 }), makeGameState(), 1);

  assert.ok(world.cellVersion > before.cells);
  assert.ok(world.wallTexVersion > before.wallTex);
  assert.ok(world.floorTexVersion > before.floorTex);
  assert.equal(world.cells[protectedIdx], Cell.LIFT);
  assert.equal(world.features[protectedIdx], Feature.LIFT_BUTTON);
});

test('wall snake topology dirtying is batched instead of every frame', () => {
  const world = new World();
  addTestRoom(world, { id: 0, x: 20, y: 20, w: 16, h: 16, name: 'Тестовая змейка [wall_snake:21,21,12,12]' });
  const state = makeGameState();
  const player = makeTestPlayer({ x: 80.5, y: 80.5, hp: 100 });

  updateWallSnakeAnomaly(world, player, state, 0);
  const afterInit = topologyVersions(world);
  updateWallSnakeAnomaly(world, player, state, 0.2);
  assert.deepEqual(topologyVersions(world), afterInit);

  state.time += 0.8;
  updateWallSnakeAnomaly(world, player, state, 0.8);
  assert.ok(world.cellVersion > afterInit.cells);
  assert.ok(world.wallTexVersion > afterInit.wallTex);
  assert.ok(world.floorTexVersion > afterInit.floorTex);
});

test('wall snake field runs multiple independent phased snakes', () => {
  const world = new World();
  addTestRoom(world, { id: 0, x: 20, y: 20, w: 96, h: 40, name: 'Тестовое поле [wall_snake:21,21,12,12] [wall_snake:61,21,16,12]' });
  const firstPath = wallSnakePathCells(world, 21, 21, 12, 12);
  const secondPath = wallSnakePathCells(world, 61, 21, 16, 12);
  const state = makeGameState();
  const player = makeTestPlayer({ x: 120.5, y: 120.5, hp: 100 });

  updateWallSnakeAnomaly(world, player, state, 0);
  const firstStart = wallSnakeWallSnapshot(world, firstPath);
  const secondStart = wallSnakeWallSnapshot(world, secondPath);
  assert.notEqual(firstStart, secondStart);

  for (let i = 0; i < 5; i++) {
    state.time += 0.2;
    updateWallSnakeAnomaly(world, player, state, 0.2);
  }

  assert.notEqual(wallSnakeWallSnapshot(world, firstPath), firstStart);
  assert.notEqual(wallSnakeWallSnapshot(world, secondPath), secondStart);
  assert.notEqual(wallSnakeWallSnapshot(world, firstPath), wallSnakeWallSnapshot(world, secondPath));
});

test('wall snake larvae are white blocks with black heads and eat meat into cavities', () => {
  const world = new World();
  addTestRoom(world, { id: 0, x: 20, y: 20, w: 22, h: 18, name: 'Тестовая мясная змейка [wall_snake:22,22,18,14]' });
  const path = wallSnakePathCells(world, 22, 22, 18, 14);
  for (const ci of path) {
    world.cells[ci] = Cell.WALL;
    world.wallTex[ci] = Tex.MEAT;
    world.floorTex[ci] = Tex.F_MEAT;
  }
  const state = makeGameState();
  const player = makeTestPlayer({ x: 90.5, y: 90.5, hp: 100 });

  updateWallSnakeAnomaly(world, player, state, 0);
  const initial = wallSnakeLarvaTextureSnapshot(world, path);
  assert.equal((initial.match(/H/g) ?? []).length, 1);
  assert.equal((initial.match(/B/g) ?? []).length >= 8, true);
  assert.equal((initial.match(/M/g) ?? []).length >= 12, true);

  state.time += 0.9;
  updateWallSnakeAnomaly(world, player, state, 0.9);

  const after = wallSnakeLarvaTextureSnapshot(world, path);
  assert.equal((after.match(/H/g) ?? []).length, 1);
  assert.equal(path.some(ci => world.cells[ci] === Cell.FLOOR && world.floorTex[ci] === Tex.F_GUT), true);
});

test('wall snake control bait shortens and pauses the moving wall', () => {
  const world = new World();
  addTestRoom(world, { id: 0, x: 20, y: 20, w: 16, h: 16, name: 'Тестовая змейка [wall_snake:21,21,12,12]' });
  world.features[world.idx(21, 21)] = Feature.SCREEN;
  const state = makeGameState();
  const player = makeTestPlayer({ x: 22.5, y: 22.5, hp: 100, inventory: [{ defId: 'gear', count: 1 }] });
  const path = wallSnakePathCells(world, 21, 21, 12, 12);

  updateWallSnakeAnomaly(world, player, state, 0);
  const beforeWalls = path.filter(ci => world.cells[ci] === Cell.WALL).length;

  assert.equal(tryUseWallSnakeAnomaly(world, player, state, 21, 21), true);
  assert.equal(countInventoryItem(player, 'gear'), 0);
  assert.equal(path.filter(ci => world.cells[ci] === Cell.WALL).length, beforeWalls - 2);

  const paused = wallSnakeWallSnapshot(world, path);
  updateWallSnakeAnomaly(world, player, state, 2);
  assert.equal(wallSnakeWallSnapshot(world, path), paused);
});

test('wall snake bait is only consumed at snake body or control screen', () => {
  const world = new World();
  addTestRoom(world, { id: 0, x: 20, y: 20, w: 16, h: 16, name: 'Тестовая змейка [wall_snake:21,21,12,12]' });
  world.features[world.idx(21, 21)] = Feature.SCREEN;
  const state = makeGameState();
  const player = makeTestPlayer({ x: 25.5, y: 25.5, hp: 100, inventory: [{ defId: 'gear', count: 1 }] });

  updateWallSnakeAnomaly(world, player, state, 0);

  assert.equal(tryUseWallSnakeAnomaly(world, player, state, 25, 25), false);
  assert.equal(countInventoryItem(player, 'gear'), 1);
});

test('section shift warns before moving bounded topology and keeps player escapable', () => {
  const world = new World();
  addTestRoom(world, { id: 0, x: 30, y: 30, w: 16, h: 16, name: 'Тестовый сдвиг [section_shift:31,31,12,12,1]' });
  world.features[world.idx(37, 37)] = Feature.APPARATUS;
  const player = makeTestPlayer({ x: 34.5, y: 34.5, hp: 100 });
  const state = makeGameState();

  updateSectionShiftAnomaly(world, player, state, 0.1);
  assert.equal(state.msgs.some(item => item.text.includes('Через несколько секунд')), true);

  const beforeShift = topologyVersions(world);
  updateSectionShiftAnomaly(world, player, state, 6);

  assert.ok(world.cellVersion > beforeShift.cells);
  assert.ok(world.wallTexVersion > beforeShift.wallTex);
  assert.ok(world.floorTexVersion > beforeShift.floorTex);
  assert.ok(world.fogVersion > beforeShift.fog);

  let shiftedWalls = 0;
  for (let y = 31; y < 43; y++) {
    for (let x = 31; x < 43; x++) {
      const idx = world.idx(x, y);
      if (world.cells[idx] === Cell.WALL && world.wallTex[idx] === Tex.METAL) shiftedWalls++;
    }
  }
  const px = Math.floor(player.x);
  const py = Math.floor(player.y);
  const playerIdx = world.idx(px, py);
  assert.ok(shiftedWalls > 0);
  assert.equal(world.cells[playerIdx], Cell.FLOOR);
  assert.equal(
    world.cells[world.idx(px + 1, py)] === Cell.FLOOR ||
      world.cells[world.idx(px - 1, py)] === Cell.FLOOR ||
      world.cells[world.idx(px, py + 1)] === Cell.FLOOR ||
      world.cells[world.idx(px, py - 1)] === Cell.FLOOR,
    true,
  );
});

test('section shift control freeze has a cooldown instead of refreshing forever', () => {
  const world = new World();
  addTestRoom(world, { id: 0, x: 50, y: 50, w: 16, h: 16, name: 'Тестовый пульт [section_shift:51,51,12,12,1]' });
  world.features[world.idx(57, 57)] = Feature.APPARATUS;
  const player = makeTestPlayer({ x: 54.5, y: 54.5, hp: 100 });
  const state = makeGameState();

  assert.equal(tryUseSectionShiftAnomaly(world, player, state, 57, 57), true);
  state.time = 10;
  assert.equal(tryUseSectionShiftAnomaly(world, player, state, 57, 57), true);
  assert.equal(state.msgs[state.msgs.length - 1]?.text.includes('Повторный замороз'), true);

  state.time = 46;
  updateSectionShiftAnomaly(world, player, state, 0.1);
  assert.equal(state.msgs[state.msgs.length - 1]?.text.includes('Через несколько секунд'), true);
});

test('sandpile perekrytie collapse opens a seam, preserves lift buffers and marks topology dirty', () => {
  const world = new World();
  addTestRoom(world, { id: 0, x: 20, y: 20, w: 20, h: 18, name: 'Тестовое перекрытие [sandpile_perekrytie:22,22,14,12,12345,0,1,6]' });
  const seamX = 22 + Math.floor(14 / 2);
  for (let y = 24; y <= 31; y++) {
    const idx = world.idx(seamX, y);
    world.cells[idx] = Cell.WALL;
    world.wallTex[idx] = Tex.CONCRETE;
  }
  const controlIdx = world.idx(23, 28);
  world.features[controlIdx] = Feature.APPARATUS;
  const liftIdx = world.idx(25, 25);
  const buttonIdx = world.idx(25, 26);
  world.cells[liftIdx] = Cell.LIFT;
  world.features[buttonIdx] = Feature.LIFT_BUTTON;

  const state = makeGameState({ time: 0 });
  const player = makeTestPlayer({ x: 23.5, y: 28.5, hp: 100 });

  assert.equal(tryUseSandpilePerekrytieAnomaly(world, player, state, seamX, 28), true);
  const before = topologyVersions(world);
  state.time = 5;
  updateSandpilePerekrytieAnomaly(world, player, state, 5);

  assert.ok(world.cellVersion > before.cells);
  assert.ok(world.wallTexVersion > before.wallTex);
  assert.ok(world.floorTexVersion > before.floorTex);
  assert.ok(world.fogVersion > before.fog);
  assert.equal(world.cells[world.idx(seamX, 28)], Cell.FLOOR);
  assert.equal(world.cells[liftIdx], Cell.LIFT);
  assert.equal(world.features[buttonIdx], Feature.LIFT_BUTTON);

  let abyss = 0;
  for (let y = 22; y < 34; y++) {
    for (let x = 22; x < 36; x++) {
      if (world.cells[world.idx(x, y)] === Cell.ABYSS) abyss++;
    }
  }
  assert.equal(abyss > 0, true);
});

test('rail train runtime cell map is rebuilt from live train positions each update', () => {
  const { world, track } = makeRailWorld();
  const entities: Entity[] = [];
  const nextId = { v: 1 };
  const train = addRailTrainRoute(world, entities, nextId, track, {
    id: 'test_train',
    label: 'Тестовый состав',
    speed: 8,
    length: 5,
    initialOffset: 10,
    stopSeconds: 2,
  });
  assert.ok(train);

  const player: Entity = {
    id: nextId.v++,
    type: EntityType.NPC,
    persistentNpcId: 'player',
    x: 21.5,
    y: 18.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    hp: 100,
    maxHp: 100,
    faction: Faction.PLAYER,
  };
  entities.push(player);

  const staleIdx = world.idx(900, 900);
  world.railTrainCells.set(staleIdx, 99);
  updateRailTrains(world, entities, player, makeGameState(), 0.1);

  assert.equal(world.railTrainCells.has(staleIdx), false);
  assert.equal(world.railTrainCells.size > 0, true);
  assert.equal([...world.railTrainCells.values()].every(index => index === 0), true);
});
