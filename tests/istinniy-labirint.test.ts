import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, DoorState, EntityType, FloorLevel, LiftDirection, RoomType, W, ZoneFaction, type Room } from '../src/core/types';
import { auditReachability } from '../src/core/world';
import { designFloorAtZ, designFloorById } from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import { getSideQuestRegistrySnapshot } from '../src/data/plot';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import { countTerritoryCells, territoryHqAnchors, territoryOwnerAt, territoryRoomOwner } from '../src/systems/territory';
import {
  ISTINNIY_LABIRINT_CHORD_KEY,
  ISTINNIY_LABIRINT_ROUTE_ID,
  ISTINNIY_LABIRINT_Z,
  measureIstinniyLabirintMetrics,
} from '../src/gen/design_floors/istinniy_labirint';

type LabyrinthGeneration = ReturnType<typeof generateDesignFloor>;

let cached: LabyrinthGeneration | undefined;

function labyrinth(): LabyrinthGeneration {
  cached ??= generateDesignFloor(ISTINNIY_LABIRINT_ROUTE_ID);
  return cached;
}

function hermeticShellCells(gen: LabyrinthGeneration, room: Room): number {
  let count = 0;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      if (gen.world.hermoWall[gen.world.idx(room.x + dx, room.y + dy)]) count++;
    }
  }
  return count;
}

test('istinniy_labirint is registered as a Ministry route floor', () => {
  const route = designFloorById(ISTINNIY_LABIRINT_ROUTE_ID);
  assert.equal(route?.z, ISTINNIY_LABIRINT_Z);
  assert.equal(route?.baseFloor, FloorLevel.MINISTRY);
  assert.equal(route?.displayName, 'Истинный лабиринт');
  assert.equal(route?.danger, 4);
  assert.equal(designFloorAtZ(ISTINNIY_LABIRINT_Z)?.id, ISTINNIY_LABIRINT_ROUTE_ID);

  assert.ok(route);
  const profile = designFloorPopulationProfile(route);
  assert.equal(profile.npcTarget, 900);
  assert.equal(profile.monsterTarget, 1300);
  assert.equal(profile.npcNoun, 'потерявшийся');
  assert.equal(profile.monsterTags.includes('wayfinding'), true);
});

test('istinniy_labirint generates maze landmarks, cues, chords, and ungated lift backbone', () => {
  const gen = labyrinth();
  const metrics = measureIstinniyLabirintMetrics(gen);
  const roomNames = new Set(gen.world.rooms.map(room => room.name));
  const spawnCell = gen.world.cells[gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))];
  const lockedChordDoors = [...gen.world.doors.values()].filter(door =>
    door.state === DoorState.LOCKED && door.keyId === ISTINNIY_LABIRINT_CHORD_KEY);

  assert.equal(spawnCell, Cell.FLOOR);
  assert.equal(metrics.ungatedUpLiftReachable, true);
  assert.equal(metrics.ungatedDownLiftReachable, true);
  assert.equal(metrics.landmarkCount >= 7, true, `landmarks ${metrics.landmarkCount}`);
  assert.equal(metrics.rewardDeadEnds >= 6, true, `reward dead ends ${metrics.rewardDeadEnds}`);
  assert.equal(metrics.lockedChords >= 6, true, `locked chords ${metrics.lockedChords}`);
  assert.equal(lockedChordDoors.length, metrics.lockedChords);
  assert.equal(metrics.ariadneCueCells >= 30, true, `cue cells ${metrics.ariadneCueCells}`);
  assert.equal(metrics.safeWallCells >= 900, true, `safe wall cells ${metrics.safeWallCells}`);
  assert.equal(metrics.mainPathLength >= 90, true, `main path ${metrics.mainPathLength}`);
  assert.equal(metrics.pathEntropy >= 1.0, true, `path entropy ${metrics.pathEntropy}`);
  assert.equal(metrics.minLandmarkSpacing >= 24, true, `landmark spacing ${metrics.minLandmarkSpacing}`);

  for (const name of [
    'Лабиринт: нулевая катушка Ариадны',
    'Лабиринт: белая стена обратного пути',
    'Лабиринт: комната шести стрелок',
    'Лабиринт: узел короткой красной хорды',
    'Лабиринт: узел потерянного Паши',
    'Лабиринт: тупик документного ящика',
    'Лабиринт: дальняя лифтовая спина',
  ]) {
    assert.equal(roomNames.has(name), true, name);
  }
});

test('istinniy_labirint exposes rescue and document-stash decisions', () => {
  const gen = labyrinth();
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const quests = new Set(getSideQuestRegistrySnapshot().map(quest => quest.id));

  assert.equal(npcs.some(entity => entity.plotNpcId === 'labyrinth_ariadna_zina'), true);
  assert.equal(npcs.some(entity => entity.plotNpcId === 'labyrinth_lost_pavel'), true);
  assert.equal(quests.has('labyrinth_rechalk_safe_wall'), true);
  assert.equal(quests.has('labyrinth_rescue_lost_pavel'), true);
  assert.equal(gen.world.rooms.some(room => room.type === RoomType.STORAGE && room.name === 'Лабиринт: тупик документного ящика'), true);
  assert.equal(gen.world.containers.some(container =>
    container.tags.includes('document_stash') &&
    container.inventory.some(item => item.defId === 'elevator_access_order')), true);
  assert.equal(gen.world.containers.some(container =>
    container.tags.includes('chord_key') &&
    container.inventory.some(item => item.defId === ISTINNIY_LABIRINT_CHORD_KEY)), true);
  assert.equal(gen.world.cells.some((cell, idx) => cell === Cell.LIFT && gen.world.liftDir[idx] === LiftDirection.UP), true);
  assert.equal(gen.world.cells.some((cell, idx) => cell === Cell.LIFT && gen.world.liftDir[idx] === LiftDirection.DOWN), true);
});

test('istinniy_labirint full route adds mid/micro rooms and cell-first territory HQs', () => {
  const gen = labyrinth();
  const metrics = measureIstinniyLabirintMetrics(gen);
  const reachable = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))).reachable;
  const reachableCells = reachable.reduce((sum, value) => sum + value, 0);
  const anchors = territoryHqAnchors(gen.world);
  const anchorOwners = new Set(anchors.map(anchor => anchor.owner));
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / (W * W);
  const targetShares = new Map<ZoneFaction, number>([
    [ZoneFaction.CITIZEN, 0.24],
    [ZoneFaction.LIQUIDATOR, 0.16],
    [ZoneFaction.CULTIST, 0.16],
    [ZoneFaction.SCIENTIST, 0.10],
    [ZoneFaction.WILD, 0.34],
  ]);

  assert.equal(gen.world.rooms.length >= 190, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 200, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachableCells >= 250_000, true, `reachable ${reachableCells}`);
  assert.equal(metrics.midRooms >= 16, true, `mid rooms ${metrics.midRooms}`);
  assert.equal(metrics.microRooms >= 120, true, `micro rooms ${metrics.microRooms}`);

  for (const [owner, targetShare] of targetShares) {
    const anchor = anchors.find(candidate => candidate.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(anchorOwners.has(owner), true, `missing HQ anchor for ${owner}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `owned cells ${owner}`);
    assert.equal(Math.abs(share(owner) - targetShare) <= 0.02, true, `owner ${owner} share ${share(owner)}`);
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${owner}`);
    assert.equal(room?.sealed, true, `sealed HQ ${owner}`);
    if (room) {
      assert.equal(territoryRoomOwner(gen.world, room.id), owner, `room owner ${owner}`);
      assert.equal(territoryOwnerAt(gen.world, anchor!.x, anchor!.y), owner, `anchor cell owner ${owner}`);
      assert.equal(hermeticShellCells(gen, room) > 0, true, `hermetic shell ${owner}`);
    }
  }

  let dominant = ZoneFaction.CITIZEN;
  for (const [owner, cells] of counts) {
    if (owner === ZoneFaction.SAMOSBOR) continue;
    if (cells > (counts.get(dominant) ?? 0)) dominant = owner;
  }
  assert.equal(dominant, ZoneFaction.WILD);
});
