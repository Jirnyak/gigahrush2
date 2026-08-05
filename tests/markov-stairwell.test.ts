import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, DoorState, EntityType, Faction, FloorLevel, LiftDirection, RoomType, W, ZoneFaction, type Room } from '../src/core/types';
import { auditReachability } from '../src/core/world';
import { designFloorAtZ, designFloorById } from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import { getSideQuestRegistrySnapshot } from '../src/data/plot';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import { countTerritoryCells, territoryHqAnchors, territoryOwnerAt, territoryRoomOwner } from '../src/systems/territory';
import {
  MARKOV_STAIRWELL_BYPASS_KEY,
  MARKOV_STAIRWELL_ROUTE_ID,
  MARKOV_STAIRWELL_Z,
  measureMarkovStairwellMetrics,
} from '../src/gen/design_floors/markov_stairwell';

type MarkovGeneration = ReturnType<typeof generateDesignFloor>;

let cached: MarkovGeneration | undefined;
let cachedSeed61061: MarkovGeneration | undefined;

function markov(): MarkovGeneration {
  cached ??= generateDesignFloor(MARKOV_STAIRWELL_ROUTE_ID);
  return cached;
}

function markovSeed61061(): MarkovGeneration {
  cachedSeed61061 ??= generateDesignFloor(MARKOV_STAIRWELL_ROUTE_ID, 61_061);
  return cachedSeed61061;
}

const TARGET_SHARES = new Map<ZoneFaction, number>([
  [ZoneFaction.CITIZEN, 0.34],
  [ZoneFaction.LIQUIDATOR, 0.24],
  [ZoneFaction.CULTIST, 0.10],
  [ZoneFaction.SCIENTIST, 0.14],
  [ZoneFaction.WILD, 0.18],
]);

function hermeticShellCells(world: MarkovGeneration['world'], room: Room): number {
  let count = 0;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      if (world.hermoWall[world.idx(room.x + dx, room.y + dy)]) count++;
    }
  }
  return count;
}

test('markov_stairwell is registered as a Ministry route floor', () => {
  const route = designFloorById(MARKOV_STAIRWELL_ROUTE_ID);
  assert.equal(route?.z, MARKOV_STAIRWELL_Z);
  assert.equal(route?.baseFloor, FloorLevel.MINISTRY);
  assert.equal(route?.displayName, 'Марковская лестница');
  assert.equal(route?.danger, 3);
  assert.equal(designFloorAtZ(MARKOV_STAIRWELL_Z)?.id, MARKOV_STAIRWELL_ROUTE_ID);

  assert.ok(route);
  const profile = designFloorPopulationProfile(route);
  assert.equal(profile.npcTarget, 820);
  assert.equal(profile.monsterTarget, 980);
  assert.equal(profile.npcNoun, 'счётчик маршей');
  assert.equal(profile.npcFactions.some(row => row.value === Faction.CULTIST && row.weight >= 10), true);
  assert.equal((profile.npcPlacement.anchors?.length ?? 0) >= 5, true);
  assert.equal(profile.monsterTags.includes('sequence'), true);
});

test('markov_stairwell generates a deterministic chain with tells, rare state, and service bypass', () => {
  const gen = markov();
  const metrics = measureMarkovStairwellMetrics(gen);
  const roomNames = new Set(gen.world.rooms.map(room => room.name));
  const spawnCell = gen.world.cells[gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))];
  const serviceDoors = [...gen.world.doors.values()].filter(door => door.state === DoorState.LOCKED && door.keyId === MARKOV_STAIRWELL_BYPASS_KEY);

  assert.equal(spawnCell, Cell.FLOOR);
  assert.equal(metrics.sequenceLength, 18);
  assert.equal(metrics.motifChanges >= 8, true, `motif changes ${metrics.motifChanges}`);
  assert.equal(metrics.watchedRooms + metrics.huntingRooms + metrics.rareRooms >= 4, true);
  assert.equal(metrics.rareRooms >= 1, true);
  assert.equal(metrics.patternTellCells >= 40, true, `tell cells ${metrics.patternTellCells}`);
  assert.equal(metrics.serviceBypassCells >= 2_000, true, `service cells ${metrics.serviceBypassCells}`);
  assert.equal(metrics.lockedServiceDoors, 1);
  assert.equal(serviceDoors.length, 1);
  assert.equal(metrics.ungatedUpLiftReachable, true);
  assert.equal(metrics.ungatedDownLiftReachable, true);
  assert.equal(roomNames.has('Марковская лестница: основной марш'), true);
  assert.equal(roomNames.has('Марковская лестница: стол учёта переходов'), true);
  assert.equal(roomNames.has('Марковская лестница: редкое состояние М'), true);
  assert.equal(gen.world.rooms.some(room => room.type === RoomType.PRODUCTION && room.name.includes('служебка')), true);
});

test('markov_stairwell exposes pattern-stash and rare-state decisions', () => {
  const gen = markov();
  const metrics = measureMarkovStairwellMetrics(gen);
  const quests = new Set(getSideQuestRegistrySnapshot().map(quest => quest.id));

  assert.equal(metrics.patternStashes, 1);
  assert.equal(metrics.rareStateStashes, 1);
  assert.equal(gen.entities.some(entity => entity.type === EntityType.NPC && entity.plotNpcId === 'markov_stairwell_watcher'), true);
  assert.equal(quests.has('markov_stairwell_pattern_stash'), true);
  assert.equal(gen.world.containers.some(container =>
    container.tags.includes('pattern_stash') &&
    container.inventory.some(item => item.defId === 'lift_scheme')), true);
  assert.equal(gen.world.containers.some(container =>
    container.tags.includes('rare_state') &&
    container.inventory.some(item => item.defId === 'elevator_access_order')), true);
  assert.equal(gen.world.cells.some((cell, idx) => cell === Cell.LIFT && gen.world.liftDir[idx] === LiftDirection.UP), true);
  assert.equal(gen.world.cells.some((cell, idx) => cell === Cell.LIFT && gen.world.liftDir[idx] === LiftDirection.DOWN), true);
});

test('markov_stairwell full route has macro, mid, micro, and cell-first faction territory', () => {
  const gen = markovSeed61061();
  const world = gen.world;
  const audit = world.cells[world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))] === Cell.FLOOR
    ? measureReachability(gen)
    : { reachableCells: 0, passableCells: 0 };
  const graphRooms = world.rooms.filter(room => room.name.includes('Марковская лестница: граф'));
  const terraceRooms = world.rooms.filter(room => room.name.includes('Марковская лестница: терраса'));
  const microRooms = world.rooms.filter(room => room.name.includes('Марковская лестница: микро'));
  const anchors = territoryHqAnchors(world);
  const byOwner = new Map(anchors.map(anchor => [anchor.owner, anchor]));
  const counts = countTerritoryCells(world);
  const total = counts.reduce((sum, row) => sum + row.cells, 0);
  const cellsByOwner = new Map(counts.map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction) => (cellsByOwner.get(owner) ?? 0) / total;

  assert.equal(world.rooms.length >= 270, true, `rooms ${world.rooms.length}`);
  assert.equal(world.doors.size >= 300, true, `doors ${world.doors.size}`);
  assert.equal(graphRooms.length >= 30, true, `graph rooms ${graphRooms.length}`);
  assert.equal(terraceRooms.length >= 24, true, `terraces ${terraceRooms.length}`);
  assert.equal(microRooms.length >= 160, true, `micro rooms ${microRooms.length}`);
  assert.equal(audit.passableCells >= 230_000, true, `passable ${audit.passableCells}`);
  assert.equal(audit.reachableCells >= audit.passableCells - 8, true, `reachable ${audit.reachableCells}/${audit.passableCells}`);

  for (const owner of [
    ZoneFaction.CITIZEN,
    ZoneFaction.LIQUIDATOR,
    ZoneFaction.CULTIST,
    ZoneFaction.SCIENTIST,
    ZoneFaction.WILD,
  ] as const) {
    const anchor = byOwner.get(owner);
    assert.ok(anchor, `missing HQ anchor for ${owner}`);
    assert.equal((cellsByOwner.get(owner) ?? 0) > 0, true, `missing owned cells for ${owner}`);
    assert.equal(Math.abs(share(owner) - (TARGET_SHARES.get(owner) ?? 0)) <= 0.025, true, `share ${owner}: ${share(owner)}`);
    assert.equal(territoryOwnerAt(world, anchor.x, anchor.y), owner, `anchor owner ${owner}`);
    assert.equal(territoryRoomOwner(world, anchor.roomId), owner, `room owner ${owner}`);
    const room = world.rooms[anchor.roomId];
    assert.equal(room.type, RoomType.HQ, `HQ room type ${owner}`);
    assert.equal(room.sealed, true, `HQ sealed ${owner}`);
    assert.equal(hermeticShellCells(world, room) > 0, true, `HQ hermetic shell ${owner}`);
    const title = room.name.replace('Марковская лестница: штаб ', '');
    const supportRooms = world.rooms.filter(candidate => candidate.id !== room.id && candidate.name.includes(title));
    assert.equal(supportRooms.length >= 4, true, `support rooms ${owner}: ${supportRooms.length}`);
  }

  assert.equal(share(ZoneFaction.CITIZEN) > share(ZoneFaction.LIQUIDATOR), true);
  assert.equal(share(ZoneFaction.LIQUIDATOR) > share(ZoneFaction.SCIENTIST), true);
});

function measureReachability(gen: MarkovGeneration): { reachableCells: number; passableCells: number } {
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  let reachableCells = 0;
  let passableCells = 0;
  for (let i = 0; i < W * W; i++) {
    const cell = gen.world.cells[i];
    if (cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.LIFT || cell === Cell.WATER) passableCells++;
    if (audit.reachable[i]) reachableCells++;
  }
  return { reachableCells, passableCells };
}
