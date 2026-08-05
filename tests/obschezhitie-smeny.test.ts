import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  Cell,
  DoorState,
  EntityType,
  Feature,
  FloorLevel,
  LiftDirection,
  NpcState,
  RoomType,
  W,
  ZoneFaction,
} from '../src/core/types';
import { auditReachability } from '../src/core/world';
import {
  designFloorAtZ,
  designFloorById,
} from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import { ACTIVE_ACTOR_SOFT_LIMIT } from '../src/data/entity_limits';
import { getSideQuestRegistrySnapshot } from '../src/data/plot';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import {
  OBSCHEZHITIE_SMENY_DESIGN_FLOOR_ID,
  OBSCHEZHITIE_SMENY_ROUTE_Z,
} from '../src/gen/design_floors/obschezhitie_smeny';
import { countTerritoryCells, territoryHqAnchors } from '../src/systems/territory';

let cachedGeneration: ReturnType<typeof generateDesignFloor> | undefined;

function generatedObschezhitieSmeny(): ReturnType<typeof generateDesignFloor> {
  cachedGeneration ??= generateDesignFloor(OBSCHEZHITIE_SMENY_DESIGN_FLOOR_ID);
  return cachedGeneration;
}

test('obschezhitie_smeny is the authored shift dormitory route floor', () => {
  const route = designFloorById(OBSCHEZHITIE_SMENY_DESIGN_FLOOR_ID);
  assert.equal(route?.z, OBSCHEZHITIE_SMENY_ROUTE_Z);
  assert.equal(route?.baseFloor, FloorLevel.LIVING);
  assert.equal(route?.displayName, 'Общежитие смены');
  assert.equal(designFloorAtZ(OBSCHEZHITIE_SMENY_ROUTE_Z)?.id, OBSCHEZHITIE_SMENY_DESIGN_FLOOR_ID);
});

test('obschezhitie_smeny generator creates bunks, witnesses, patrol and shelter pressure', () => {
  const gen = generatedObschezhitieSmeny();
  const spawnCell = gen.world.cells[gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))];
  const bunkRooms = gen.world.rooms.filter(room => room.name.includes('спальная секция'));
  const shelter = gen.world.rooms.find(room => room.name.includes('Гермоубежище'));
  const bedCells = countRoomFeatures(gen, bunkRooms, Feature.BED);
  const sleepingTemplates = gen.entities.filter(entity => entity.type === EntityType.NPC && entity.ai?.npcState === NpcState.SLEEPING);

  assert.equal(spawnCell, Cell.FLOOR);
  assert.equal(gen.world.liftDir.some((dir, idx) => dir === LiftDirection.UP && gen.world.cells[idx] === Cell.LIFT), true);
  assert.equal(gen.world.liftDir.some((dir, idx) => dir === LiftDirection.DOWN && gen.world.cells[idx] === Cell.LIFT), true);
  assert.equal(bunkRooms.length >= 16, true);
  assert.equal(bedCells >= 64, true);
  assert.equal(shelter?.type, RoomType.COMMON);
  assert.equal(shelter?.sealed, true);
  assert.equal(shelter?.doors.some(idx => gen.world.doors.get(idx)?.state === DoorState.HERMETIC_OPEN), true);
  assert.equal(sleepingTemplates.length >= 24, true);
  assert.equal(gen.entities.some(entity => entity.plotNpcId === 'obschezhitie_rita_starshaya'), true);
  assert.equal(gen.entities.some(entity => entity.plotNpcId === 'obschezhitie_gleb_obhod'), true);
  assert.equal(gen.entities.some(entity => entity.plotNpcId === 'obschezhitie_senya_tikhiy'), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('quiet_loot') && container.tags.includes('theft')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('resident_relief') && container.tags.includes('shelter')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('patrol') && container.tags.includes('witness')), true);
});

test('obschezhitie_smeny scale exposes dorm rings, room stacks and reachable micro rooms', () => {
  const gen = generatedObschezhitieSmeny();
  const ringRooms = gen.world.rooms.filter(room => room.name.startsWith('Кольцо'));
  const hqRooms = gen.world.rooms.filter(room => room.type === RoomType.HQ);

  assert.equal(gen.world.rooms.length >= 240, true);
  assert.equal(gen.world.doors.size >= 250, true);
  assert.equal(countPlayableCells(gen) >= 120_000, true);
  assert.equal(countReachableCells(gen) >= 120_000, true);
  assert.equal(ringRooms.length >= 160, true);
  assert.equal(hqRooms.length >= 5, true);
});

test('obschezhitie_smeny territory starts from every human faction HQ and matches control brief', () => {
  const gen = generatedObschezhitieSmeny();
  const anchors = territoryHqAnchors(gen.world);
  const anchorByOwner = new Map(anchors.map(anchor => [anchor.owner, anchor]));
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const targetShares = new Map([
    [ZoneFaction.CITIZEN, 0.56],
    [ZoneFaction.LIQUIDATOR, 0.16],
    [ZoneFaction.CULTIST, 0.07],
    [ZoneFaction.SCIENTIST, 0.08],
    [ZoneFaction.WILD, 0.13],
  ]);

  for (const [owner, targetShare] of targetShares) {
    const anchor = anchorByOwner.get(owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    const share = (counts.get(owner) ?? 0) / (W * W);
    assert.equal(room?.type, RoomType.HQ, `owner ${owner} should have an HQ anchor`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `owner ${owner} cells`);
    assert.equal(Math.abs(share - targetShare) <= 0.015, true, `owner ${owner} share ${share}`);
  }

  let dominant = ZoneFaction.CITIZEN;
  for (const [owner, cells] of counts) {
    if (owner === ZoneFaction.SAMOSBOR) continue;
    if (cells > (counts.get(dominant) ?? 0)) dominant = owner;
  }
  assert.equal(dominant, ZoneFaction.CITIZEN);
});

test('obschezhitie_smeny uses a bounded A-Life-compatible dorm population profile', () => {
  const route = designFloorById(OBSCHEZHITIE_SMENY_DESIGN_FLOOR_ID);
  assert.ok(route);
  const profile = designFloorPopulationProfile(route);
  const gen = generatedObschezhitieSmeny();
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const monsters = gen.entities.filter(entity => entity.type === EntityType.MONSTER);

  assert.equal(profile.npcTarget, 2100);
  assert.equal(profile.monsterTarget, 360);
  assert.equal(profile.npcTarget + profile.monsterTarget <= ACTIVE_ACTOR_SOFT_LIMIT, true);
  assert.equal((profile.npcPlacement.anchors?.length ?? 0) >= 4, true);
  assert.equal((profile.monsterPlacement.anchors?.length ?? 0) >= 3, true);
  assert.equal(npcs.length >= profile.npcTarget && npcs.length <= ACTIVE_ACTOR_SOFT_LIMIT, true);
  assert.equal(monsters.length >= 180 && monsters.length <= profile.monsterTarget, true);
});

test('obschezhitie_smeny registers shelter, patrol and quiet-locker choices', () => {
  const ids = new Set(getSideQuestRegistrySnapshot().map(q => q.id));
  for (const id of [
    'obschezhitie_shelter_rollcall',
    'obschezhitie_patrol_silence',
    'obschezhitie_quiet_lockers',
  ]) {
    assert.equal(ids.has(id), true, id);
  }
});

function countRoomFeatures(gen: ReturnType<typeof generateDesignFloor>, rooms: readonly { id: number }[], feature: number): number {
  const roomIds = new Set(rooms.map(room => room.id));
  let count = 0;
  for (let i = 0; i < W * W; i++) {
    if (!roomIds.has(gen.world.roomMap[i])) continue;
    if (gen.world.features[i] === feature) count++;
  }
  return count;
}

function countPlayableCells(gen: ReturnType<typeof generateDesignFloor>): number {
  let count = 0;
  for (const cell of gen.world.cells) {
    if (cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR || cell === Cell.LIFT) count++;
  }
  return count;
}

function countReachableCells(gen: ReturnType<typeof generateDesignFloor>): number {
  const start = gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY));
  const reachable = auditReachability(gen.world, start).reachable;
  let count = 0;
  for (const value of reachable) count += value;
  return count;
}
