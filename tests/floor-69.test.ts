import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  Cell,
  DoorState,
  EntityType,
  Faction,
  FloorLevel,
  LiftDirection,
  Occupation,
  RoomType,
  W,
  ZoneFaction,
} from '../src/core/types';
import { designFloorAtZ, designFloorById } from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import { HUMAN_TERRITORY_OWNERS } from '../src/data/factions';
import { getSideQuestRegistrySnapshot } from '../src/data/plot';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import {
  DESIGN_FLOOR_ID,
  DESIGN_FLOOR_Z,
  FLOOR_69_RAID_SHUTTER_GATES,
  FLOOR_69_RAID_SHUTTER_KEY,
} from '../src/gen/design_floors/floor_69';
import {
  countTerritoryCells,
  territoryHqAnchors,
  territoryOwnerAt,
  territoryRoomOwner,
} from '../src/systems/territory';

type Floor69Generation = ReturnType<typeof generateDesignFloor>;

let cachedGeneration: Floor69Generation | undefined;

function floor69(): Floor69Generation {
  cachedGeneration ??= generateDesignFloor(DESIGN_FLOOR_ID);
  return cachedGeneration;
}

function strictPassableWithRaidShuttersClosed(gen: Floor69Generation, idx: number): boolean {
  const cell = gen.world.cells[idx];
  if (cell === Cell.FLOOR || cell === Cell.WATER) return true;
  if (cell !== Cell.DOOR) return false;
  const door = gen.world.doors.get(idx);
  if (door?.keyId === FLOOR_69_RAID_SHUTTER_KEY) return false;
  return door?.state === DoorState.OPEN || door?.state === DoorState.HERMETIC_OPEN;
}

function strictReachableWithRaidShuttersClosed(gen: Floor69Generation): Uint8Array {
  const seen = new Uint8Array(W * W);
  const queue = new Int32Array(W * W);
  let head = 0;
  let tail = 0;
  const start = gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY));
  seen[start] = 1;
  queue[tail++] = start;

  while (head < tail) {
    const ci = queue[head++];
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = gen.world.idx(x + dx, y + dy);
      if (seen[ni] || !strictPassableWithRaidShuttersClosed(gen, ni)) continue;
      seen[ni] = 1;
      queue[tail++] = ni;
    }
  }

  return seen;
}

function hasReachableNear(gen: Floor69Generation, reachable: Uint8Array, x: number, y: number, radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      if (reachable[gen.world.idx(x + dx, y + dy)]) return true;
    }
  }
  return false;
}

function roomCountMatching(gen: Floor69Generation, pattern: RegExp): number {
  return gen.world.rooms.filter(room => pattern.test(room.name)).length;
}

function floorCellCount(gen: Floor69Generation): number {
  let count = 0;
  for (let i = 0; i < W * W; i++) {
    if (gen.world.cells[i] === Cell.FLOOR) count++;
  }
  return count;
}

test('floor_69 is registered as an authored Maintenance-band route', () => {
  const route = designFloorById(DESIGN_FLOOR_ID);
  assert.equal(route?.z, DESIGN_FLOOR_Z);
  assert.equal(route?.baseFloor, FloorLevel.MAINTENANCE);
  assert.equal(route?.displayName, 'Этаж 69');
  assert.equal(designFloorAtZ(DESIGN_FLOOR_Z)?.id, DESIGN_FLOOR_ID);
});

test('floor_69 population profile keeps adult social density bounded', () => {
  const route = designFloorById(DESIGN_FLOOR_ID);
  assert.ok(route);
  const profile = designFloorPopulationProfile(route);

  assert.equal(profile.npcTarget, 2200);
  assert.equal(profile.monsterTarget, 380);
  assert.equal(profile.npcNoun, 'посетитель');
  assert.equal(profile.npcOccupations.some(item => item.value === Occupation.CHILD), false);
  assert.equal(profile.npcFactions.some(item => item.value === Faction.LIQUIDATOR && item.weight >= 10), true);
  assert.equal((profile.npcPlacement.roomWeights?.[RoomType.MEDICAL] ?? 0) > 1, true);
  assert.equal((profile.npcPlacement.roomWeights?.[RoomType.OFFICE] ?? 0) > 1, true);
  assert.equal((profile.npcPlacement.anchors?.length ?? 0) >= 4, true);
});

test('floor_69 exposes public, backstage, debt and refuge loops with decision actors', () => {
  const gen = floor69();
  const names = new Set(gen.world.rooms.map(room => room.name));
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const spawnCell = gen.world.cells[gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))];

  assert.equal(spawnCell, Cell.FLOOR);
  assert.equal(gen.world.liftDir.some((dir, idx) => dir === LiftDirection.UP && gen.world.cells[idx] === Cell.LIFT), true);
  assert.equal(gen.world.liftDir.some((dir, idx) => dir === LiftDirection.DOWN && gen.world.cells[idx] === Cell.LIFT), true);

  for (const roomName of [
    'Пост досмотра 69',
    'Зал ламп и сцены 69',
    'Клиника Сима: тихий прием',
    'Долговая контора 69',
    'Тихая комната 69',
    'Картотека долгов 69',
    'Служебный ход 69',
    'Черная лестница 69',
    'Второй пост досмотра 69',
    'Пост служебного обхода 69',
    'Скрытая комната свидетеля 69',
  ]) {
    assert.equal(names.has(roomName), true, roomName);
  }

  assert.equal(roomCountMatching(gen, /^(Гостиничный|Красный|Тихий номер|Часовой|Поздний)/) >= 18, true);
  assert.equal(roomCountMatching(gen, /^(Гримерная|Костюмерная)/) >= 8, true);
  assert.equal(roomCountMatching(gen, /^(Долговой кабинет|Архив расписок)/) >= 10, true);
  assert.equal(roomCountMatching(gen, /^(Верхний тихий шкаф|Служебное укрытие|Нижний тихий шкаф|Скрытая комната)/) >= 10, true);
  assert.equal(gen.world.rooms.length >= 200, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 180, true, `doors ${gen.world.doors.size}`);
  assert.equal(floorCellCount(gen) >= 100_000, true, `floor cells ${floorCellCount(gen)}`);

  for (const npcId of [
    'f69_madam_roza',
    'f69_guard_venya',
    'f69_performer_ira',
    'f69_doctor_sima',
    'f69_accountant_nil',
  ]) {
    assert.equal(npcs.some(entity => entity.plotNpcId === npcId), true, npcId);
  }

  assert.equal(npcs.some(entity => entity.occupation === Occupation.CHILD), false);
  assert.equal(gen.world.containers.some(container => container.tags.includes('blackmail')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('debt') && container.tags.includes('ledger')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('raid') && container.tags.includes('choice')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('refuge') && container.tags.includes('aid')), true);

  const questIds = new Set(getSideQuestRegistrySnapshot().map(quest => quest.id));
  for (const questId of [
    'f69_blackmail_profit',
    'f69_raid_choice',
    'f69_blackmail_protect',
    'f69_hide_worker',
    'f69_clinic_supply',
    'f69_debt_ledger',
    'f69_debt_forgery_kit',
    'f69_blackmail_expose',
  ]) {
    assert.equal(questIds.has(questId), true, questId);
  }
});

test('floor_69 uses cell-first wild-dominant territory with mini HQ anchors', () => {
  const gen = floor69();
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const total = W * W;
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / total;
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const anchors = territoryHqAnchors(gen.world);

  assert.equal(territoryOwnerAt(gen.world, 482, 502), ZoneFaction.LIQUIDATOR);
  assert.equal(territoryOwnerAt(gen.world, 504, 520), ZoneFaction.CITIZEN);
  assert.equal(dominant, ZoneFaction.WILD);
  assert.equal(share(ZoneFaction.CITIZEN) >= 0.16 && share(ZoneFaction.CITIZEN) <= 0.20, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(share(ZoneFaction.LIQUIDATOR) >= 0.08 && share(ZoneFaction.LIQUIDATOR) <= 0.11, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(share(ZoneFaction.CULTIST) >= 0.07 && share(ZoneFaction.CULTIST) <= 0.10, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(share(ZoneFaction.SCIENTIST) >= 0.06 && share(ZoneFaction.SCIENTIST) <= 0.09, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(share(ZoneFaction.WILD) >= 0.55 && share(ZoneFaction.WILD) <= 0.60, true, `wild share ${share(ZoneFaction.WILD)}`);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal((counts.get(owner) ?? 0) > 0, true, `owned cells ${owner}`);
    assert.equal(anchors.some(anchor => anchor.owner === owner), true, `hq anchor ${owner}`);
  }

  for (const [name, owner] of [
    ['Гражданский общак 69: гермокор', ZoneFaction.CITIZEN],
    ['Пост досмотра 69', ZoneFaction.LIQUIDATOR],
    ['Свечная исповедальня 69: гермокор', ZoneFaction.CULTIST],
    ['Санитарный НИИ 69: гермокор', ZoneFaction.SCIENTIST],
    ['Дикий развал должников 69: гермокор', ZoneFaction.WILD],
  ] as const) {
    const room = gen.world.rooms.find(candidate => candidate.name === name);
    assert.ok(room, name);
    assert.equal(room.type, RoomType.HQ, name);
    assert.equal(room.sealed, true, name);
    assert.equal(territoryRoomOwner(gen.world, room.id), owner, name);
  }
});

test('floor_69 raid shutters have bypass min-cuts that do not softlock', () => {
  const gen = floor69();
  const reachable = strictReachableWithRaidShuttersClosed(gen);
  const strictCount = reachable.reduce((sum, value) => sum + value, 0);

  assert.equal(strictCount >= 25_000, true, `strict reachable cells ${strictCount}`);
  assert.equal(hasReachableNear(gen, reachable, 512, 512, 3), true, 'public loop');
  assert.equal(hasReachableNear(gen, reachable, 512, 456, 3), true, 'backstage loop');
  assert.equal(hasReachableNear(gen, reachable, 904, 552, 3), true, 'debt loop');
  assert.equal(hasReachableNear(gen, reachable, 504, 520, 3), true, 'refuge loop');

  for (const gate of FLOOR_69_RAID_SHUTTER_GATES) {
    const idx = gen.world.idx(gate.x, gate.doorY);
    const door = gen.world.doors.get(idx);
    assert.equal(gen.world.cells[idx] === Cell.DOOR || gen.world.cells[idx] === Cell.FLOOR, true, `gate ${gate.x},${gate.doorY} cell`);
    if (gen.world.cells[idx] === Cell.DOOR) {
      assert.equal(door?.state, DoorState.HERMETIC_OPEN, `gate ${gate.x},${gate.doorY} state`);
      assert.equal(door?.keyId, FLOOR_69_RAID_SHUTTER_KEY, `gate ${gate.x},${gate.doorY} key`);
    }
    for (let y = gate.y1; y <= gate.y2; y++) {
      if (y === gate.doorY) continue;
      const cell = gen.world.cells[gen.world.idx(gate.x, y)];
      assert.equal(cell === Cell.WALL || cell === Cell.FLOOR, true, `gate wall ${gate.x},${y}`);
    }
    assert.equal(hasReachableNear(gen, reachable, gate.bypass.ax, gate.bypass.ay, 2), true, `bypass A ${gate.x},${gate.doorY}`);
    assert.equal(hasReachableNear(gen, reachable, gate.bypass.bx, gate.bypass.by, 2), true, `bypass B ${gate.x},${gate.doorY}`);
  }
});
