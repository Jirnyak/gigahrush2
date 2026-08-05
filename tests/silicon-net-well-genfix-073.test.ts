import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Cell, DoorState, EntityType, Faction, Occupation, RoomType, W, ZoneFaction, type Entity, type Room } from '../src/core/types';
import { auditReachability } from '../src/core/world';
import { territorySharesForDesignFloor } from '../src/data/floor_territory';
import { HUMAN_TERRITORY_OWNERS, factionToTerritoryOwner } from '../src/data/factions';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import { countTerritoryCells, territoryHqAnchors, territoryOwnerAt, territoryRoomOwner } from '../src/systems/territory';

function passableCells(world: ReturnType<typeof generateDesignFloor>['world']): number {
  let count = 0;
  for (let i = 0; i < W * W; i++) {
    const cell = world.cells[i];
    if (cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR || cell === Cell.LIFT) count++;
  }
  return count;
}

function reachableCells(reachable: Uint8Array): number {
  let count = 0;
  for (const value of reachable) count += value;
  return count;
}

function hermeticShellCells(world: ReturnType<typeof generateDesignFloor>['world'], room: Room): number {
  let count = 0;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      if (world.hermoWall[world.idx(room.x + dx, room.y + dy)]) count++;
    }
  }
  return count;
}

function nearbySupportRooms(world: ReturnType<typeof generateDesignFloor>['world'], hq: Room): number {
  const cx = hq.x + (hq.w >> 1);
  const cy = hq.y + (hq.h >> 1);
  let count = 0;
  for (const room of world.rooms) {
    if (room.id === hq.id) continue;
    if (
      room.type !== RoomType.KITCHEN &&
      room.type !== RoomType.BATHROOM &&
      room.type !== RoomType.STORAGE &&
      room.type !== RoomType.MEDICAL &&
      room.type !== RoomType.OFFICE &&
      room.type !== RoomType.COMMON &&
      room.type !== RoomType.SMOKING
    ) continue;
    if (world.dist2(cx, cy, room.x + (room.w >> 1), room.y + (room.h >> 1)) <= 118 * 118) count++;
  }
  return count;
}

function isAmbientNpcTemplate(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    entity.alive &&
    entity.plotNpcId === undefined &&
    entity.persistentNpcId === undefined &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    entity.faction !== undefined &&
    entity.faction !== Faction.PLAYER &&
    entity.occupation !== Occupation.CHILD;
}

test('genfix 073 silicon_net_well ships graph-scale geometry and cell-first scientist territory', () => {
  const gen = generateDesignFloor('silicon_net_well', 61061);
  const world = gen.world;
  const audit = auditReachability(world, world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  const graphNodes = world.rooms.filter(room => /^НЕТ-граф Брёйна: узел [01]{6}$/.test(room.name));
  const nodeMicroRooms = world.rooms.filter(room =>
    room.name.includes('шкаф патч-кабелей') ||
    room.name.includes('будка обходчика узла') ||
    room.name.includes('камера живого кремния') ||
    room.name.includes('кассета сухих ячеек'));
  const edgeArchiveCells = world.rooms.filter(room => room.name.startsWith('НЕТ-регистр Брёйна: боковая ячейка'));
  const hermeticHqs = world.rooms.filter(room =>
    room.type === RoomType.HQ &&
    room.sealed &&
    room.doors.some(doorIdx => {
      const door = world.doors.get(doorIdx);
      return door?.state === DoorState.HERMETIC_OPEN || door?.state === DoorState.HERMETIC_CLOSED;
    }));

  assert.equal(world.rooms.length >= 430, true, `rooms ${world.rooms.length}`);
  assert.equal(world.doors.size >= 720, true, `doors ${world.doors.size}`);
  assert.equal(passableCells(world) >= 220_000, true, `passable ${passableCells(world)}`);
  assert.equal(reachableCells(audit.reachable) >= 220_000, true, `reachable ${reachableCells(audit.reachable)}`);
  assert.equal(graphNodes.length >= 48, true, `graph nodes ${graphNodes.length}`);
  assert.equal(nodeMicroRooms.length >= 170, true, `node micro rooms ${nodeMicroRooms.length}`);
  assert.equal(edgeArchiveCells.length >= 90, true, `edge archive cells ${edgeArchiveCells.length}`);
  assert.equal(hermeticHqs.length >= 5, true, `hermetic HQs ${hermeticHqs.length}`);
  assert.equal(world.containers.some(container => container.tags.includes('gbe')), true, 'GBE decision container remains present');

  const anchors = territoryHqAnchors(world);
  const anchorOwners = new Set(anchors.map(anchor => anchor.owner));
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(anchorOwners.has(owner), true, `missing HQ anchor for ${ZoneFaction[owner]}`);
  }
  assert.equal(anchors.some(anchor => world.rooms[anchor.roomId].name === 'Главный НИИ-штаб кремниевого колодца'), true);

  const counts = new Map(countTerritoryCells(world).map(row => [row.owner, row.cells]));
  const targetRows = territorySharesForDesignFloor('silicon_net_well');
  const targetTotal = targetRows.reduce((sum, row) => sum + row.share, 0);
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / (W * W);
  const dominant = [...counts.entries()]
    .filter(([owner]) => owner !== ZoneFaction.SAMOSBOR)
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal((counts.get(owner) ?? 0) > 40_000, true, `owned cells for ${ZoneFaction[owner]}`);
  }
  assert.equal(dominant, ZoneFaction.SCIENTIST);
  for (const target of targetRows) {
    if (target.owner === ZoneFaction.SAMOSBOR) continue;
    assert.equal(Math.abs(share(target.owner) - target.share / targetTotal) <= 0.04, true, `${ZoneFaction[target.owner]} share ${share(target.owner).toFixed(3)}`);
  }

  for (const anchor of anchors) {
    const room = world.rooms[anchor.roomId];
    assert.equal(room.type, RoomType.HQ, `HQ type for ${ZoneFaction[anchor.owner]}`);
    assert.equal(territoryRoomOwner(world, room.id), anchor.owner, `HQ owner for ${ZoneFaction[anchor.owner]}`);
    assert.equal(room.sealed, true, `sealed HQ for ${ZoneFaction[anchor.owner]}`);
    assert.equal(hermeticShellCells(world, room) > 0, true, `hermetic shell for ${ZoneFaction[anchor.owner]}`);
    assert.equal(nearbySupportRooms(world, room) >= 2, true, `support rooms for ${ZoneFaction[anchor.owner]}`);
  }

  let ambientTotal = 0;
  let ambientOwned = 0;
  for (const entity of gen.entities) {
    if (!isAmbientNpcTemplate(entity) || entity.faction === undefined) continue;
    ambientTotal++;
    if (territoryOwnerAt(world, entity.x, entity.y) === factionToTerritoryOwner(entity.faction)) ambientOwned++;
  }
  assert.equal(ambientTotal >= 500, true, `ambient NPC templates ${ambientTotal}`);
  assert.equal(ambientOwned / ambientTotal >= 0.95, true, `own-territory NPC ratio ${ambientOwned / ambientTotal}`);
});
