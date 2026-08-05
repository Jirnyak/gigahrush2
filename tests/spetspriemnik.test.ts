import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { auditReachability, hasReachableAdjacentCell } from '../src/core/world';
import {
  Cell,
  DoorState,
  EntityType,
  Faction,
  FloorLevel,
  LiftDirection,
  MonsterKind,
  Occupation,
  RoomType,
  W,
  ZoneFaction,
} from '../src/core/types';
import { designFloorAtZ, designFloorById } from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import { PROCEDURAL_FLOOR_ZS } from '../src/data/procedural_floors';
import { SIDE_QUESTS } from '../src/data/plot';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import {
  measureSpetspriemnikMetrics,
  SPETSPRIEMNIK_BASE_FLOOR,
  SPETSPRIEMNIK_CELL_KEY,
  SPETSPRIEMNIK_GUARD_KEY,
  SPETSPRIEMNIK_PERMIT_KEY,
  SPETSPRIEMNIK_ROOM_NAMES,
  SPETSPRIEMNIK_ROUTE_ID,
  SPETSPRIEMNIK_Z,
} from '../src/gen/design_floors/spetspriemnik';
import { countTerritoryCells, territoryHqAnchors } from '../src/systems/territory';

let cachedGeneration: ReturnType<typeof generateDesignFloor> | undefined;

function generatedSpetspriemnik(): ReturnType<typeof generateDesignFloor> {
  cachedGeneration ??= generateDesignFloor(SPETSPRIEMNIK_ROUTE_ID);
  return cachedGeneration;
}

function hasReachableLift(gen: ReturnType<typeof generateDesignFloor>, direction: LiftDirection): boolean {
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  for (let i = 0; i < W * W; i++) {
    if (gen.world.cells[i] !== Cell.LIFT || gen.world.liftDir[i] !== direction) continue;
    if (hasReachableAdjacentCell(gen.world, audit, i)) return true;
  }
  return false;
}

test('spetspriemnik is registered as a Ministry detention route at z+40', () => {
  const route = designFloorById(SPETSPRIEMNIK_ROUTE_ID);
  assert.equal(route?.z, SPETSPRIEMNIK_Z);
  assert.equal(route?.baseFloor, SPETSPRIEMNIK_BASE_FLOOR);
  assert.equal(route?.baseFloor, FloorLevel.MINISTRY);
  assert.equal(route?.displayName, 'Спецприёмник');
  assert.equal(designFloorAtZ(SPETSPRIEMNIK_Z)?.id, SPETSPRIEMNIK_ROUTE_ID);
  assert.equal(PROCEDURAL_FLOOR_ZS.includes(SPETSPRIEMNIK_Z), false);
});

test('spetspriemnik profile favors liquidator control, prisoners and protocol monsters', () => {
  const route = designFloorById(SPETSPRIEMNIK_ROUTE_ID);
  assert.ok(route);
  const profile = designFloorPopulationProfile(route);

  assert.equal(profile.npcTarget, 920);
  assert.equal(profile.monsterTarget, 760);
  assert.equal(profile.npcNoun, 'конвоир');
  assert.equal(profile.npcFactions.some(entry => entry.value === Faction.LIQUIDATOR && entry.weight >= 50), true);
  assert.equal(profile.npcFactions.some(entry => entry.value === Faction.CITIZEN && entry.weight >= 25), true);
  assert.equal(profile.npcOccupations.some(entry => entry.value === Occupation.HUNTER && entry.weight >= 30), true);
  assert.equal(profile.npcOccupations.some(entry => entry.value === Occupation.SECRETARY && entry.weight >= 20), true);
  assert.equal(profile.monsterBiasKinds.includes(MonsterKind.PROTOKOLNIK), true);
  assert.equal(profile.monsterBiasKinds.includes(MonsterKind.NELYUD), true);
  assert.equal(profile.monsterTags.includes('detention'), true);
  assert.equal((profile.npcPlacement.anchors?.length ?? 0) >= 4, true);
  assert.equal((profile.monsterPlacement.roomWeights?.[RoomType.LIVING] ?? 0) > 1.5, true);
});

test('spetspriemnik builds cellblock BSP, guard loops, bars and permit gates', () => {
  const gen = generatedSpetspriemnik();
  const metrics = measureSpetspriemnikMetrics(gen);
  const spawnCell = gen.world.cells[gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))];
  const lockedDoors = [...gen.world.doors.values()].filter(door => door.state === DoorState.LOCKED);
  const zoneFactions = new Set(gen.world.zones.map(zone => zone.faction));

  assert.equal(spawnCell, Cell.FLOOR);
  assert.equal(hasReachableLift(gen, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, LiftDirection.DOWN), true);
  assert.equal(metrics.cellRooms >= 20, true, `cell rooms ${metrics.cellRooms}`);
  assert.equal(metrics.shelterCellRooms >= 4, true, `shelter cells ${metrics.shelterCellRooms}`);
  assert.equal(metrics.lockedCellDoors >= 8, true, `locked cell doors ${metrics.lockedCellDoors}`);
  assert.equal(metrics.lockedPermitDoors >= 2, true, `locked permit doors ${metrics.lockedPermitDoors}`);
  assert.equal(metrics.guardLoopCells >= 2500, true, `guard loop cells ${metrics.guardLoopCells}`);
  assert.equal(metrics.barredSightlineCells >= 250, true, `barred cells ${metrics.barredSightlineCells}`);
  assert.equal(lockedDoors.some(door => door.keyId === SPETSPRIEMNIK_CELL_KEY), true);
  assert.equal(lockedDoors.some(door => door.keyId === SPETSPRIEMNIK_PERMIT_KEY), true);
  assert.equal(lockedDoors.some(door => door.keyId === SPETSPRIEMNIK_GUARD_KEY), true);
  assert.equal(zoneFactions.has(ZoneFaction.LIQUIDATOR), true);
  assert.equal(zoneFactions.has(ZoneFaction.WILD), true);
});

test('spetspriemnik expands into route-scale mid and micro detention geometry', () => {
  const gen = generatedSpetspriemnik();
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  let passable = 0;
  let reachable = 0;
  let smallRooms = 0;
  for (let i = 0; i < W * W; i++) {
    const cell = gen.world.cells[i];
    if (cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR || cell === Cell.LIFT) passable++;
    if (audit.reachable[i]) reachable++;
  }
  for (const room of gen.world.rooms) {
    if (room.w <= 32 && room.h <= 22) smallRooms++;
  }

  assert.equal(gen.world.rooms.length >= 190, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(smallRooms >= 150, true, `small rooms ${smallRooms}`);
  assert.equal(gen.world.doors.size >= 200, true, `doors ${gen.world.doors.size}`);
  assert.equal(passable >= 275_000, true, `passable ${passable}`);
  assert.equal(reachable >= passable - 8, true, `reachable ${reachable}/${passable}`);
});

test('spetspriemnik cell territory starts from five human HQ anchors and target shares', () => {
  const gen = generatedSpetspriemnik();
  const anchors = territoryHqAnchors(gen.world);
  const byOwner = new Map(anchors.map(anchor => [anchor.owner, anchor]));
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const total = W * W;

  for (const owner of [
    ZoneFaction.CITIZEN,
    ZoneFaction.LIQUIDATOR,
    ZoneFaction.CULTIST,
    ZoneFaction.SCIENTIST,
    ZoneFaction.WILD,
  ] as const) {
    assert.ok(byOwner.get(owner), `missing HQ owner ${owner}`);
    assert.ok((counts.get(owner) ?? 0) > 0, `missing territory cells ${owner}`);
  }

  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      assert.equal(gen.world.dist2(anchors[i].x, anchors[i].y, anchors[j].x, anchors[j].y) > 96 * 96, true);
    }
  }

  const share = (owner: ZoneFaction) => (counts.get(owner) ?? 0) / total;
  assert.equal(share(ZoneFaction.LIQUIDATOR) > share(ZoneFaction.CITIZEN), true);
  assert.equal(share(ZoneFaction.LIQUIDATOR) > share(ZoneFaction.WILD), true);
  assert.ok(share(ZoneFaction.CITIZEN) >= 0.22 && share(ZoneFaction.CITIZEN) <= 0.26, `citizen ${share(ZoneFaction.CITIZEN)}`);
  assert.ok(share(ZoneFaction.LIQUIDATOR) >= 0.41 && share(ZoneFaction.LIQUIDATOR) <= 0.47, `liquidator ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.ok(share(ZoneFaction.CULTIST) >= 0.08 && share(ZoneFaction.CULTIST) <= 0.12, `cultist ${share(ZoneFaction.CULTIST)}`);
  assert.ok(share(ZoneFaction.SCIENTIST) >= 0.06 && share(ZoneFaction.SCIENTIST) <= 0.10, `scientist ${share(ZoneFaction.SCIENTIST)}`);
  assert.ok(share(ZoneFaction.WILD) >= 0.12 && share(ZoneFaction.WILD) <= 0.16, `wild ${share(ZoneFaction.WILD)}`);
});

test('spetspriemnik exposes release, names, bribe, riot and shelter decisions', () => {
  const gen = generatedSpetspriemnik();
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const questById = new Map(SIDE_QUESTS.map(quest => [quest.id, quest]));

  for (const name of Object.values(SPETSPRIEMNIK_ROOM_NAMES)) {
    assert.equal(gen.world.rooms.some(room => room.name === name), true, name);
  }
  for (const plotNpcId of [
    'spetspriemnik_nachalnik_krivda',
    'spetspriemnik_guard_savva',
    'spetspriemnik_prisoner_mira',
    'spetspriemnik_informant_tolya',
    'spetspriemnik_clerk_alla',
  ]) {
    assert.equal(npcs.some(entity => entity.plotNpcId === plotNpcId), true, plotNpcId);
  }

  assert.equal(gen.world.containers.some(container => container.tags.includes('release_prisoners') && container.tags.includes('key_gate')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('trade_names') && container.tags.includes('hostage_list')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('bribe_guard')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('riot') && container.tags.includes('bounded_event')), true);

  assert.equal(questById.has('spetspriemnik_release_cell_row'), true);
  assert.equal(questById.has('spetspriemnik_trade_names'), true);
  assert.equal(questById.has('spetspriemnik_bribe_guard'), true);
  assert.equal(questById.has('spetspriemnik_shelter_cell_check'), true);

  const riot = questById.get('spetspriemnik_trigger_riot');
  assert.ok(riot);
  assert.equal(riot.holdSpawnMonsters, 3);
  assert.equal(riot.holdSpawnMaxAlive, 9);
  assert.equal(riot.eventTags?.includes('not_refill'), true);
});
