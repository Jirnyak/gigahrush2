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
  type Room,
  type TerritoryOwner,
} from '../src/core/types';
import { auditReachability } from '../src/core/world';
import { designFloorAtZ, designFloorById } from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import { ACTIVE_ACTOR_SOFT_LIMIT } from '../src/data/entity_limits';
import { HUMAN_TERRITORY_OWNERS, factionToTerritoryOwner, territoryOwnerName } from '../src/data/factions';
import { territorySharesForDesignFloor } from '../src/data/floor_territory';
import { PROCEDURAL_FLOOR_ZS } from '../src/data/procedural_floors';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import {
  MOEBIUS_PODEZD_BASE_FLOOR,
  MOEBIUS_PODEZD_ROOM_NAMES,
  MOEBIUS_PODEZD_ROUTE_ID,
  MOEBIUS_PODEZD_Z,
  moebiusPodezdDecisionMetrics,
} from '../src/gen/design_floors/moebius_podezd';
import type { FloorGeneration } from '../src/gen/floor_manifest';
import { countTerritoryCells, territoryHqAnchors, territoryOwnerAt, territoryRoomOwner } from '../src/systems/territory';

const ORTHO_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
let cachedGeneration: FloorGeneration | undefined;

function generatedMoebiusPodezd(): FloorGeneration {
  cachedGeneration ??= generateDesignFloor(MOEBIUS_PODEZD_ROUTE_ID);
  return cachedGeneration;
}

function passableCells(gen: FloorGeneration): number {
  let count = 0;
  for (let i = 0; i < W * W; i++) {
    const cell = gen.world.cells[i];
    if (cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR || cell === Cell.LIFT) count++;
  }
  return count;
}

function reachableCellCount(gen: FloorGeneration): number {
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  let count = 0;
  for (const value of audit.reachable) count += value;
  return count;
}

function hermeticShellCells(gen: FloorGeneration, room: Room): number {
  let count = 0;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      if (gen.world.hermoWall[gen.world.idx(room.x + dx, room.y + dy)]) count++;
    }
  }
  return count;
}

function supportRoomsForHq(gen: FloorGeneration, hq: Room): number {
  return gen.world.rooms.filter(room => room.name.startsWith(`${hq.name}:`)).length;
}

function isAmbientNpcTemplate(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    entity.alive &&
    entity.name?.startsWith('Мёбиус-подъезд:') === true &&
    entity.plotNpcId === undefined &&
    entity.persistentNpcId === undefined &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    entity.faction !== Faction.PLAYER &&
    entity.occupation !== Occupation.CHILD;
}

function reachableWithoutLockedDoors(gen: FloorGeneration): Uint8Array {
  const world = gen.world;
  const out = new Uint8Array(W * W);
  const queue = new Int32Array(W * W);
  let head = 0;
  let tail = 0;
  const start = world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY));
  out[start] = 1;
  queue[tail++] = start;

  while (head < tail) {
    const ci = queue[head++];
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const [dx, dy] of ORTHO_DIRS) {
      const ni = world.idx(x + dx, y + dy);
      if (out[ni]) continue;
      const cell = world.cells[ni];
      if (cell === Cell.FLOOR || cell === Cell.WATER) {
        out[ni] = 1;
        queue[tail++] = ni;
        continue;
      }
      if (cell !== Cell.DOOR) continue;
      const door = world.doors.get(ni);
      if (!door || door.state === DoorState.LOCKED || door.state === DoorState.HERMETIC_CLOSED) continue;
      out[ni] = 1;
      queue[tail++] = ni;
    }
  }

  return out;
}

function hasReachableLift(gen: FloorGeneration, reachable: Uint8Array, direction: LiftDirection): boolean {
  const world = gen.world;
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of ORTHO_DIRS) {
      if (reachable[world.idx(x + dx, y + dy)]) return true;
    }
  }
  return false;
}

test('moebius_podezd is registered as the z +2 residential orientation route', () => {
  const route = designFloorById(MOEBIUS_PODEZD_ROUTE_ID);
  assert.equal(route?.z, MOEBIUS_PODEZD_Z);
  assert.equal(route?.baseFloor, MOEBIUS_PODEZD_BASE_FLOOR);
  assert.equal(route?.baseFloor, FloorLevel.KVARTIRY);
  assert.equal(route?.displayName, 'Мёбиус-подъезд');
  assert.equal(designFloorAtZ(MOEBIUS_PODEZD_Z)?.id, MOEBIUS_PODEZD_ROUTE_ID);
  assert.equal(PROCEDURAL_FLOOR_ZS.includes(MOEBIUS_PODEZD_Z), false);
});

test('moebius_podezd generator creates mirrored strips, landmarks and route-marker decisions', () => {
  const gen = generatedMoebiusPodezd();
  const metrics = moebiusPodezdDecisionMetrics(gen);
  const profile = designFloorPopulationProfile(designFloorById(MOEBIUS_PODEZD_ROUTE_ID)!);

  assert.equal(metrics.residentialStrips, 2);
  assert.equal(metrics.mirroredFlatRooms >= 16, true);
  assert.equal(metrics.seamLandmarks, 2);
  assert.equal(metrics.seamLockedDoors, 2);
  assert.equal(metrics.mirrorTellContainers >= 4, true);
  assert.equal(metrics.routeMarkerContainers, 1);
  assert.equal(metrics.reversedPatrolNpcs >= 4, true);
  assert.equal(metrics.seamHunterMonsters >= 1, true);
  assert.equal(gen.world.rooms.some(room => room.name === MOEBIUS_PODEZD_ROOM_NAMES.shortcut), true);
  assert.equal(gen.world.rooms.some(room => room.type === RoomType.STORAGE && room.name === MOEBIUS_PODEZD_ROOM_NAMES.lostMarker), true);
  assert.equal(gen.world.screenCells.length >= 2, true);
  assert.equal(profile.npcTarget, 3400);
  assert.equal(profile.monsterTarget, 520);
  assert.equal(profile.npcTarget + profile.monsterTarget <= ACTIVE_ACTOR_SOFT_LIMIT, true);
});

test('moebius_podezd expands into a route-scale mirrored floor with cell-first faction control', () => {
  const gen = generateDesignFloor(MOEBIUS_PODEZD_ROUTE_ID, 61061);
  const world = gen.world;
  const routeBlocks = world.rooms.filter(room => room.name.endsWith('средний коридор ленты'));
  const microRooms = world.rooms.filter(room => room.name.includes(': прямая ') || room.name.includes(': обратная '));
  const anchors = territoryHqAnchors(world);
  const anchorOwners = new Set(anchors.map(anchor => anchor.owner));
  const counts = new Map(countTerritoryCells(world).map(row => [row.owner, row.cells]));
  const targetRows = territorySharesForDesignFloor(MOEBIUS_PODEZD_ROUTE_ID);
  const targetTotal = targetRows.reduce((sum, row) => sum + row.share, 0);
  const share = (owner: TerritoryOwner): number => (counts.get(owner) ?? 0) / (W * W);
  const dominant = [...counts.entries()]
    .filter(([owner]) => owner !== ZoneFaction.SAMOSBOR)
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  assert.equal(world.rooms.length >= 520, true, `rooms ${world.rooms.length}`);
  assert.equal(world.doors.size >= 200, true, `doors ${world.doors.size}`);
  assert.equal(passableCells(gen) >= 190_000, true, `passable ${passableCells(gen)}`);
  assert.equal(reachableCellCount(gen) >= 180_000, true, `reachable ${reachableCellCount(gen)}`);
  assert.equal(routeBlocks.length >= 8, true, `route blocks ${routeBlocks.length}`);
  assert.equal(microRooms.length >= 450, true, `micro rooms ${microRooms.length}`);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(anchorOwners.has(owner), true, `missing HQ anchor for ${territoryOwnerName(owner)}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `owned cells for ${territoryOwnerName(owner)}`);
  }
  assert.equal(dominant, ZoneFaction.CITIZEN);

  for (const target of targetRows) {
    const actual = share(target.owner);
    assert.equal(Math.abs(actual - target.share / targetTotal) <= 0.03, true, `${territoryOwnerName(target.owner)} share ${actual.toFixed(3)}`);
  }

  for (const anchor of anchors) {
    const room = world.rooms[anchor.roomId];
    assert.equal(room.type, RoomType.HQ, `HQ type for ${territoryOwnerName(anchor.owner)}`);
    assert.equal(room.sealed, true, `sealed HQ for ${territoryOwnerName(anchor.owner)}`);
    assert.equal(territoryRoomOwner(world, room.id), anchor.owner, `HQ owner for ${territoryOwnerName(anchor.owner)}`);
    assert.equal(territoryOwnerAt(world, room.x + (room.w >> 1), room.y + (room.h >> 1)), anchor.owner, `HQ cell owner for ${territoryOwnerName(anchor.owner)}`);
    assert.equal(hermeticShellCells(gen, room) > 0, true, `hermetic shell for ${territoryOwnerName(anchor.owner)}`);
    assert.equal(supportRoomsForHq(gen, room) >= 3, true, `support rooms for ${territoryOwnerName(anchor.owner)}`);
  }

  let ambientTotal = 0;
  let ambientOwned = 0;
  for (const entity of gen.entities) {
    if (!isAmbientNpcTemplate(entity) || entity.faction === undefined) continue;
    ambientTotal++;
    if (territoryOwnerAt(world, entity.x, entity.y) === factionToTerritoryOwner(entity.faction)) ambientOwned++;
  }
  assert.equal(ambientTotal >= 2000, true, `ambient NPC templates ${ambientTotal}`);
  assert.equal(ambientOwned / ambientTotal >= 0.95, true, `own-territory NPC ratio ${ambientOwned / ambientTotal}`);
});

test('moebius_podezd keeps the public loop usable without opening the parity shortcut', () => {
  const gen = generatedMoebiusPodezd();
  const reachable = reachableWithoutLockedDoors(gen);
  let reachableWalkable = 0;
  let totalUnlockedWalkable = 0;

  for (let i = 0; i < W * W; i++) {
    const cell = gen.world.cells[i];
    const door = cell === Cell.DOOR ? gen.world.doors.get(i) : undefined;
    const unlockedWalkable = cell === Cell.FLOOR || cell === Cell.WATER ||
      (cell === Cell.DOOR && door?.state !== DoorState.LOCKED && door?.state !== DoorState.HERMETIC_CLOSED);
    if (!unlockedWalkable) continue;
    totalUnlockedWalkable++;
    if (reachable[i]) reachableWalkable++;
  }

  assert.equal(gen.world.cells[gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))], Cell.FLOOR);
  assert.equal(hasReachableLift(gen, reachable, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, reachable, LiftDirection.DOWN), true);
  assert.equal(reachableWalkable > 18_000, true);
  assert.equal(reachableWalkable / totalUnlockedWalkable > 0.92, true);
});

test('moebius_podezd exposes the optional shortcut, mirror tells and reversed patrol route', () => {
  const gen = generatedMoebiusPodezd();
  const seamDoors = [...gen.world.doors.values()].filter(door => door.state === DoorState.LOCKED && door.keyId === 'rubber_door_wedge');
  const shortcut = gen.world.rooms.find(room => room.name === MOEBIUS_PODEZD_ROOM_NAMES.shortcut);
  const northPatrol = gen.entities.find(entity => entity.name === 'Ликвидатор обратного обхода север');
  const southPatrol = gen.entities.find(entity => entity.name === 'Ликвидатор обратного обхода юг');

  assert.equal(seamDoors.length, 2);
  assert.ok(shortcut);
  assert.equal(seamDoors.every(door => door.roomA === shortcut.id || door.roomB === shortcut.id), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('seam_lock') && container.inventory.some(item => item.defId === 'rubber_door_wedge')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('route_marker') && container.inventory.some(item => item.defId === 'chalk')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('mirror_tell') && container.inventory.some(item => item.defId === 'sealed_complaint')), true);
  assert.ok(northPatrol?.ai);
  assert.ok(southPatrol?.ai);
  assert.equal(northPatrol.type, EntityType.NPC);
  assert.equal(southPatrol.type, EntityType.NPC);
  assert.equal((northPatrol.ai.tx ?? northPatrol.x) < northPatrol.x, true);
  assert.equal((southPatrol.ai.tx ?? southPatrol.x) > southPatrol.x, true);
  assert.equal(gen.entities.some(entity => entity.type === EntityType.MONSTER && entity.monsterKind === MonsterKind.SHOVNIK), true);
});
