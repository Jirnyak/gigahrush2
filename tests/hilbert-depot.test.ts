import { test } from 'node:test';
import * as assert from 'node:assert/strict';

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
  type Entity,
  type TerritoryOwner,
} from '../src/core/types';
import { designFloorAtZ, designFloorById } from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import { HUMAN_TERRITORY_OWNERS, factionToTerritoryOwner, territoryOwnerName } from '../src/data/factions';
import { territorySharesForDesignFloor } from '../src/data/floor_territory';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import {
  DESIGN_FLOOR_ID,
  HILBERT_DEPOT_BASE_FLOOR,
  HILBERT_DEPOT_CARGO_TAG,
  HILBERT_DEPOT_CHORD_TAG,
  HILBERT_DEPOT_ROUTE_Z,
  generateHilbertDepotDesignFloor,
  type HilbertDepotGeneration,
} from '../src/gen/design_floors/hilbert_depot';
import { getRouteCueMarkers, routeCueCount } from '../src/systems/route_cues';
import { countTerritoryCells, territoryHqAnchors, territoryOwnerAt, territoryRoomOwner } from '../src/systems/territory';
import { assertFullFootprint, assertReachableRouteLifts, reachableCells } from './generator_helpers';

function weightOf<T>(items: readonly { value: T; weight: number }[], value: T): number {
  return items.find(item => item.value === value)?.weight ?? 0;
}

let cachedAuthoredGeneration: ReturnType<typeof generateHilbertDepotDesignFloor> | undefined;

function authoredHilbertDepotForRead(): ReturnType<typeof generateHilbertDepotDesignFloor> {
  cachedAuthoredGeneration ??= generateHilbertDepotDesignFloor();
  return cachedAuthoredGeneration;
}

function playableCellCount(gen: HilbertDepotGeneration): number {
  let count = 0;
  for (let i = 0; i < W * W; i++) {
    const cell = gen.world.cells[i];
    if (cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR || cell === Cell.LIFT) count++;
  }
  return count;
}

function reachableCount(reachable: Uint8Array): number {
  let count = 0;
  for (const value of reachable) count += value;
  return count;
}

function hermeticShellCells(gen: HilbertDepotGeneration, roomId: number): number {
  const room = gen.world.rooms[roomId];
  let count = 0;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      if (gen.world.hermoWall[gen.world.idx(room.x + dx, room.y + dy)]) count++;
    }
  }
  return count;
}

function nearbySupportRooms(gen: HilbertDepotGeneration, roomId: number): number {
  const supportTypes = new Set([RoomType.BATHROOM, RoomType.KITCHEN, RoomType.STORAGE, RoomType.MEDICAL, RoomType.OFFICE, RoomType.COMMON, RoomType.SMOKING]);
  const hq = gen.world.rooms[roomId];
  const hx = hq.x + hq.w / 2;
  const hy = hq.y + hq.h / 2;
  return gen.world.rooms.filter(room => (
    room.id !== hq.id &&
    room.type !== RoomType.HQ &&
    supportTypes.has(room.type) &&
    gen.world.dist2(hx, hy, room.x + room.w / 2, room.y + room.h / 2) <= 95 * 95
  )).length;
}

function isAmbientHilbertNpc(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    entity.alive &&
    entity.name?.startsWith('Склад Гильберта:') === true &&
    entity.plotNpcId === undefined &&
    entity.persistentNpcId === undefined &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    entity.faction !== undefined &&
    entity.faction !== Faction.PLAYER;
}

test('hilbert_depot is a maintenance authored route floor with indexed industrial pressure', () => {
  const route = designFloorById(DESIGN_FLOOR_ID);
  assert.ok(route);
  assert.equal(route.z, HILBERT_DEPOT_ROUTE_Z);
  assert.equal(route.baseFloor, HILBERT_DEPOT_BASE_FLOOR);
  assert.equal(route.baseFloor, FloorLevel.MAINTENANCE);
  assert.equal(route.displayName, 'Склад Гильберта');
  assert.equal(route.danger, 4);
  assert.equal(designFloorAtZ(HILBERT_DEPOT_ROUTE_Z)?.id, DESIGN_FLOOR_ID);

  const profile = designFloorPopulationProfile(route);
  assert.equal(profile.npcTarget >= 450 && profile.npcTarget <= 700, true, `npc target ${profile.npcTarget}`);
  assert.equal(profile.monsterTarget >= 1600 && profile.monsterTarget <= 2100, true, `monster target ${profile.monsterTarget}`);
  assert.equal(weightOf(profile.npcFactions, Faction.LIQUIDATOR) > weightOf(profile.npcFactions, Faction.WILD), true);
  assert.equal(weightOf(profile.npcOccupations, Occupation.STOREKEEPER) > weightOf(profile.npcOccupations, Occupation.SCIENTIST), true);
  assert.equal(profile.monsterBiasKinds.includes(MonsterKind.ROBOT), true);
  assert.equal(profile.monsterBiasKinds.includes(MonsterKind.PSEUDOLIFT), true);
  assert.equal(profile.monsterTags.includes('index'), true);
  assert.equal((profile.monsterPlacement.anchors?.length ?? 0) >= 5, true);
});

test('hilbert_depot keeps the Hilbert curve compact and exposes ordered cargo decisions', () => {
  const gen = authoredHilbertDepotForRead();
  const state = gen.hilbertState;
  const cargo = gen.world.containers.filter(container => container.tags.includes(HILBERT_DEPOT_CARGO_TAG));
  const uniqueOrders = new Set(state.cargoOrders);

  assert.equal(state.routeId, DESIGN_FLOOR_ID);
  assert.equal(state.curvePointCount, 256);
  assert.equal(state.cargoContainerIds.length >= 24, true, `cargo count ${state.cargoContainerIds.length}`);
  assert.equal(cargo.length, state.cargoContainerIds.length);
  assert.equal(uniqueOrders.size, state.cargoOrders.length);
  assert.deepEqual([...state.cargoOrders].sort((a, b) => a - b), state.cargoOrders);
  assert.equal(cargo.every(container => container.inventory.length > 0), true);
  assert.equal(cargo.some(container => container.access === 'locked'), true);
  assert.equal(cargo.some(container => container.access === 'owner'), true);
  assert.equal(cargo.every(container => container.tags.some(tag => tag.startsWith('hilbert_order_'))), true);
  assert.equal(gen.world.rooms.some(room => room.type === RoomType.STORAGE && room.name.includes('Индексная секция Г-')), true);
});

test('hilbert_depot locked chords are optional key-gated shortcuts, not saved curve state', () => {
  const gen = authoredHilbertDepotForRead();
  const state = gen.hilbertState;
  const reachable = reachableCells(gen);

  assert.equal(state.chords.length >= 4, true, `chord count ${state.chords.length}`);
  assert.equal(state.lockedChordDoorCells.length >= state.chords.length, true, `door count ${state.lockedChordDoorCells.length}`);
  for (const doorCell of state.lockedChordDoorCells) {
    const door = gen.world.doors.get(doorCell);
    assert.ok(door, `missing door at ${doorCell}`);
    assert.equal(door.state, DoorState.LOCKED);
    assert.equal(door.keyId, 'key');
    assert.equal(reachable[doorCell], 1, `locked chord door ${doorCell} should sit on reachable route`);
  }

  const cueTags = new Set(getRouteCueMarkers(gen.world).flatMap(cue => cue.tags));
  assert.equal(cueTags.has(HILBERT_DEPOT_CHORD_TAG), true);
  assert.equal(cueTags.has('hilbert_order'), true);
});

test('hilbert_depot full route generation keeps lifts, cues and pressure actors reachable', () => {
  const gen = generateDesignFloor(DESIGN_FLOOR_ID) as HilbertDepotGeneration;
  assertReachableRouteLifts(gen, 'hilbert_depot');

  const cues = getRouteCueMarkers(gen.world);
  const cueTags = new Set(cues.flatMap(cue => cue.tags));
  assert.equal(routeCueCount(gen.world) >= 3, true);
  assert.equal(cueTags.has('hilbert_order'), true);
  assert.equal(cueTags.has(HILBERT_DEPOT_CHORD_TAG), true);
  assert.equal(cueTags.has('exit'), true);
  assert.equal(gen.world.liftDir.some((dir, idx) => dir === LiftDirection.UP && gen.world.cells[idx] === Cell.LIFT), true);
  assert.equal(gen.world.liftDir.some((dir, idx) => dir === LiftDirection.DOWN && gen.world.cells[idx] === Cell.LIFT), true);
  assert.equal(gen.entities.some(entity => entity.type === EntityType.MONSTER && entity.monsterKind === MonsterKind.ROBOT), true);
  assert.equal(gen.entities.some(entity => entity.type === EntityType.MONSTER && entity.monsterKind === MonsterKind.SAFEGUARD), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes(HILBERT_DEPOT_CARGO_TAG)), true);
});

test('hilbert_depot expands into route-scale index shelves with cell-first faction territory', () => {
  const gen = generateDesignFloor(DESIGN_FLOOR_ID, 61_061) as HilbertDepotGeneration;
  const reachable = assertReachableRouteLifts(gen, 'hilbert_depot genfix_081');
  const blockRooms = gen.world.rooms.filter(room => room.name.startsWith('Склад Гильберта:') && room.name.includes('Г-'));
  const hqNames = new Map<TerritoryOwner, string>([
    [ZoneFaction.CITIZEN, 'Склад Гильберта: гражданская приемка паек'],
    [ZoneFaction.LIQUIDATOR, 'Склад Гильберта: главный гермопост ликвидаторов'],
    [ZoneFaction.CULTIST, 'Склад Гильберта: скрытая культовая ячейка'],
    [ZoneFaction.SCIENTIST, 'Склад Гильберта: НИИ узла нумерации'],
    [ZoneFaction.WILD, 'Склад Гильберта: разбитый гермокор диких'],
  ]);
  const anchors = territoryHqAnchors(gen.world);
  const anchorOwners = new Set(anchors.map(anchor => anchor.owner));
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const targetRows = territorySharesForDesignFloor(DESIGN_FLOOR_ID);
  const targetTotal = targetRows.reduce((sum, row) => sum + row.share, 0);
  const share = (owner: TerritoryOwner): number => (counts.get(owner) ?? 0) / (W * W);
  const dominant = [...counts.entries()]
    .filter(([owner]) => owner !== ZoneFaction.SAMOSBOR)
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  assertFullFootprint(gen.world, 'hilbert_depot genfix_081');
  assert.equal(gen.world.rooms.length >= 340, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 260, true, `doors ${gen.world.doors.size}`);
  assert.equal(playableCellCount(gen) >= 480_000, true, `playable ${playableCellCount(gen)}`);
  assert.equal(reachableCount(reachable) >= 480_000, true, `reachable ${reachableCount(reachable)}`);
  assert.equal(blockRooms.length >= 280, true, `block rooms ${blockRooms.length}`);
  assert.equal(dominant, ZoneFaction.LIQUIDATOR);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(anchorOwners.has(owner), true, `missing HQ anchor for ${territoryOwnerName(owner)}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `owned cells for ${territoryOwnerName(owner)}`);
  }
  for (const target of targetRows) {
    const actual = share(target.owner);
    assert.equal(Math.abs(actual - target.share / targetTotal) <= 0.03, true, `${territoryOwnerName(target.owner)} share ${actual.toFixed(3)}`);
  }

  for (const [owner, name] of hqNames) {
    const room = gen.world.rooms.find(candidate => candidate.name === name);
    assert.ok(room, name);
    assert.equal(room.type, RoomType.HQ, name);
    assert.equal(room.sealed, true, name);
    assert.equal(territoryRoomOwner(gen.world, room.id), owner, name);
    assert.equal(territoryOwnerAt(gen.world, room.x + (room.w >> 1), room.y + (room.h >> 1)), owner, name);
    assert.equal(room.doors.some(idx => gen.world.doors.get(idx)?.state === DoorState.HERMETIC_OPEN), true, name);
    assert.equal(hermeticShellCells(gen, room.id) > 0, true, `hermetic shell ${name}`);
    assert.equal(nearbySupportRooms(gen, room.id) >= 4, true, `support rooms ${name}`);
  }
});

test('hilbert_depot ambient depot staff spawn on their own territory', () => {
  const gen = generateDesignFloor(DESIGN_FLOOR_ID, 61_061) as HilbertDepotGeneration;
  let ambient = 0;
  let own = 0;
  for (const entity of gen.entities) {
    if (!isAmbientHilbertNpc(entity) || entity.faction === undefined) continue;
    ambient++;
    if (territoryOwnerAt(gen.world, entity.x, entity.y) === factionToTerritoryOwner(entity.faction)) own++;
  }

  assert.equal(ambient >= 500, true, `ambient ${ambient}`);
  assert.equal(own / ambient >= 0.95, true, `own territory ${own}/${ambient}`);
});
