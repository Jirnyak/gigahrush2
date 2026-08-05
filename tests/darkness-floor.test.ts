import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, EntityType, Feature, RoomType, W, ZoneFaction } from '../src/core/types';
import { HUMAN_TERRITORY_OWNERS } from '../src/data/factions';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import { generateDarknessDesignFloor, getDarknessState } from '../src/gen/design_floors/darkness';
import { countTerritoryCells, territoryHqAnchors } from '../src/systems/territory';

function countReachableCells(gen: ReturnType<typeof generateDesignFloor>): number {
  const world = gen.world;
  const start = world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY));
  const passable = (idx: number): boolean => {
    const cell = world.cells[idx];
    return cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.WATER || cell === Cell.LIFT;
  };
  const seen = new Uint8Array(W * W);
  const queue = new Int32Array(W * W);
  let head = 0;
  let tail = 0;
  if (passable(start)) {
    seen[start] = 1;
    queue[tail++] = start;
  }
  while (head < tail) {
    const idx = queue[head++];
    const x = idx % W;
    const y = (idx / W) | 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
      const next = world.idx(x + dx, y + dy);
      if (seen[next] || !passable(next)) continue;
      seen[next] = 1;
      queue[tail++] = next;
    }
  }
  return tail;
}

test('darkness floor exposes light, reveal, sound and radon topology state', () => {
  const gen = generateDarknessDesignFloor();
  const state = getDarknessState(gen.world);

  assert.equal(state, gen.darknessState);
  assert.equal(gen.darknessState.lightBudget, 8);
  assert.equal(gen.darknessState.roomLabels.length >= 10, true);
  assert.equal(gen.darknessState.lightGraphNodes.length, gen.darknessState.roomLabels.length);
  assert.equal(gen.darknessState.lightGraphEdges.length >= 10, true);
  assert.equal(gen.darknessState.revealShells.length, gen.darknessState.roomLabels.length);
  assert.equal(gen.darknessState.soundPaths.length >= 3, true);
  assert.equal(gen.darknessState.radonSightCorridors.length >= 2, true);

  const entryNode = gen.darknessState.lightGraphNodes.find(node => node.roomKey === 'entry');
  assert.ok(entryNode);
  assert.equal(entryNode.budgetAfterReveal, 8);
  assert.equal(entryNode.tags.includes('revealed_start'), true);

  for (const shell of gen.darknessState.revealShells) {
    assert.equal(shell.cellCount > 0, true, `${shell.id} should reveal walkable cells`);
    assert.equal(shell.maxFog >= shell.minFog, true, `${shell.id} fog range should be ordered`);
  }

  for (const path of gen.darknessState.soundPaths) {
    assert.equal(path.cellCount > 0, true, `${path.id} should have a routed sound path`);
    assert.equal(path.tags.includes('sound_path'), true, `${path.id} should be tagged as a sound path`);
  }

  for (const corridor of gen.darknessState.radonSightCorridors) {
    assert.equal(corridor.cellCount > 0, true, `${corridor.id} should cross floor cells`);
    assert.equal(corridor.tags.includes('sight_corridor'), true, `${corridor.id} should be a sight corridor`);
    assert.equal(corridor.maxFog >= corridor.minFog, true, `${corridor.id} fog range should be ordered`);
  }

  assert.equal(gen.world.features.some(feature => feature === Feature.LAMP || feature === Feature.CANDLE), false);
  assert.equal(gen.world.light.some(value => value > 0), false);
});

test('darkness full route has mid/micro structure and named cell-first HQ territory', () => {
  const gen = generateDesignFloor('darkness', 61061);
  const reachableCells = countReachableCells(gen);
  const microRooms = gen.world.rooms.filter(room => room.name.includes('микрокомната'));
  const stationRooms = gen.world.rooms.filter(room =>
    room.name.includes('станция') ||
    room.name.includes('линза') ||
    room.name.includes('архив') ||
    room.name.includes('двор') ||
    room.name.includes('карман')
  );
  const hqByOwner = new Map(territoryHqAnchors(gen.world).map(anchor => [anchor.owner, gen.world.rooms[anchor.roomId]]));
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const targetShares = new Map<ZoneFaction, number>([
    [ZoneFaction.CITIZEN, 0.06],
    [ZoneFaction.LIQUIDATOR, 0.08],
    [ZoneFaction.CULTIST, 0.24],
    [ZoneFaction.SCIENTIST, 0.08],
    [ZoneFaction.WILD, 0.36],
    [ZoneFaction.SAMOSBOR, 0.18],
  ]);
  const expectedHqs = new Map<ZoneFaction, string>([
    [ZoneFaction.CITIZEN, 'Гражданский штаб последней лампы'],
    [ZoneFaction.LIQUIDATOR, 'Пост ликвидаторов черного сектора'],
    [ZoneFaction.CULTIST, 'Скрытый культовый штаб черного имени'],
    [ZoneFaction.SCIENTIST, 'НИИ остаточного фотона'],
    [ZoneFaction.WILD, 'Дикий штаб слепого привала'],
  ]);

  assert.equal(gen.world.rooms.length >= 190, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 260, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachableCells >= 100_000, true, `reachable ${reachableCells}`);
  assert.equal(microRooms.length >= 80, true, `micro rooms ${microRooms.length}`);
  assert.equal(stationRooms.length >= 70, true, `station rooms ${stationRooms.length}`);
  assert.equal(gen.entities.some(entity => entity.type === EntityType.NPC), false);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    const room = hqByOwner.get(owner);
    assert.equal(room?.type, RoomType.HQ, `missing HQ ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ should be sealed ${ZoneFaction[owner]}`);
    assert.equal(room?.name, expectedHqs.get(owner));
  }
  for (const [owner, targetShare] of targetShares) {
    const share = (counts.get(owner) ?? 0) / (W * W);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `owner ${ZoneFaction[owner]} cells`);
    assert.equal(Math.abs(share - targetShare) <= 0.012, true, `owner ${ZoneFaction[owner]} share ${share}`);
  }
  assert.equal((counts.get(ZoneFaction.WILD) ?? 0) > (counts.get(ZoneFaction.CULTIST) ?? 0), true);
});
