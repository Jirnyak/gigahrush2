import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  Cell,
  DoorState,
  EntityType,
  FloorLevel,
  RoomType,
  W,
  ZoneFaction,
} from '../src/core/types';
import { designFloorAtZ, designFloorById } from '../src/data/design_floors';
import { factionToTerritoryOwner, HUMAN_TERRITORY_OWNERS } from '../src/data/factions';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import {
  DESIGN_FLOOR_ID,
  SERVICE_FLOOR_Z,
} from '../src/gen/design_floors/service_floor';
import {
  countTerritoryCells,
  territoryHqAnchors,
  territoryOwnerAt,
  territoryRoomOwner,
} from '../src/systems/territory';
import {
  assertFullFootprint,
  assertReachableRouteLifts,
} from './generator_helpers';

type ServiceFloorGeneration = ReturnType<typeof generateDesignFloor>;

let cachedGeneration: ServiceFloorGeneration | undefined;

function serviceFloor(): ServiceFloorGeneration {
  cachedGeneration ??= generateDesignFloor(DESIGN_FLOOR_ID, 61_061);
  return cachedGeneration;
}

function playableCellCount(gen: ServiceFloorGeneration): number {
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

function roomCount(gen: ServiceFloorGeneration, pattern: RegExp): number {
  return gen.world.rooms.filter(room => pattern.test(room.name)).length;
}

test('service_floor is registered as the z-18 Maintenance route stop', () => {
  const route = designFloorById(DESIGN_FLOOR_ID);
  assert.equal(route?.z, SERVICE_FLOOR_Z);
  assert.equal(route?.baseFloor, FloorLevel.MAINTENANCE);
  assert.equal(route?.displayName, 'Служебный этаж');
  assert.equal(designFloorAtZ(SERVICE_FLOOR_Z)?.id, DESIGN_FLOOR_ID);
});

test('service_floor has macro, mid and micro service geometry at route scale', () => {
  const gen = serviceFloor();
  const reachable = assertReachableRouteLifts(gen, 'service_floor genfix_069');

  assertFullFootprint(gen.world, 'service_floor genfix_069');
  assert.equal(gen.world.rooms.length >= 230, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 250, true, `doors ${gen.world.doors.size}`);
  assert.equal(playableCellCount(gen) >= 160_000, true, `playable ${playableCellCount(gen)}`);
  assert.equal(reachableCount(reachable) >= 150_000, true, `reachable ${reachableCount(reachable)}`);

  assert.equal(roomCount(gen, /^Северная кабельная кассета/) >= 4, true);
  assert.equal(roomCount(gen, /^Центральная левая полка/) >= 8, true);
  assert.equal(roomCount(gen, /^Восточный вертикальный обход/) >= 8, true);
  assert.equal(roomCount(gen, /^Будка обхода .* стены С-15$/), 4);
});

test('service_floor has authored mini-HQ anchors and target cell control shares', () => {
  const gen = serviceFloor();
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const total = W * W;
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / total;
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const anchors = territoryHqAnchors(gen.world);

  assert.equal(dominant, ZoneFaction.LIQUIDATOR);
  assert.equal(share(ZoneFaction.CITIZEN) >= 0.155 && share(ZoneFaction.CITIZEN) <= 0.165, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(share(ZoneFaction.LIQUIDATOR) >= 0.515 && share(ZoneFaction.LIQUIDATOR) <= 0.525, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(share(ZoneFaction.CULTIST) >= 0.055 && share(ZoneFaction.CULTIST) <= 0.065, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(share(ZoneFaction.SCIENTIST) >= 0.115 && share(ZoneFaction.SCIENTIST) <= 0.125, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(share(ZoneFaction.WILD) >= 0.135 && share(ZoneFaction.WILD) <= 0.145, true, `wild share ${share(ZoneFaction.WILD)}`);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal((counts.get(owner) ?? 0) > 0, true, `owned cells ${owner}`);
    assert.equal(anchors.some(anchor => anchor.owner === owner), true, `hq anchor ${owner}`);
  }

  for (const [name, owner] of [
    ['Гражданский гермокор бытового обхода С-15', ZoneFaction.CITIZEN],
    ['Гермопост ликвидаторов С-15', ZoneFaction.LIQUIDATOR],
    ['Скрытый культовый гермолаз С-15', ZoneFaction.CULTIST],
    ['Гермолаборатория шахт С-15', ZoneFaction.SCIENTIST],
    ['Разбитый гермокор диких С-15', ZoneFaction.WILD],
  ] as const) {
    const room = gen.world.rooms.find(candidate => candidate.name === name);
    assert.ok(room, name);
    assert.equal(room.type, RoomType.HQ, name);
    assert.equal(room.sealed, true, name);
    assert.equal(territoryRoomOwner(gen.world, room.id), owner, name);
    assert.equal(room.doors.some(idx => gen.world.doors.get(idx)?.state === DoorState.HERMETIC_OPEN), true, name);
  }
});

test('service_floor ambient repair NPCs spawn on their own territory', () => {
  const gen = serviceFloor();
  let ambient = 0;
  let own = 0;
  for (const entity of gen.entities) {
    if (
      entity.type !== EntityType.NPC ||
      entity.plotNpcId ||
      entity.persistentNpcId ||
      entity.alifeId !== undefined ||
      entity.questId !== -1 ||
      entity.faction === undefined
    ) continue;
    ambient++;
    if (territoryOwnerAt(gen.world, entity.x, entity.y) === factionToTerritoryOwner(entity.faction)) own++;
  }

  assert.equal(ambient >= 700, true, `ambient ${ambient}`);
  assert.equal(own, ambient, `own territory ${own}/${ambient}`);
});
