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
} from '../src/core/types';
import { designFloorAtZ, designFloorById } from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import { ACTIVE_ACTOR_SOFT_LIMIT } from '../src/data/entity_limits';
import { HUMAN_TERRITORY_OWNERS, territoryOwnerToFaction } from '../src/data/factions';
import { getSideQuestRegistrySnapshot } from '../src/data/plot';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import {
  BLACK_MARKET_88_DEBTS,
  BLACK_MARKET_88_FUTURE_Z,
  BLACK_MARKET_88_ROUTE_ID,
  BLACK_MARKET_88_STOCK,
  MARKET88_GEOMETRY_HUBS,
  MARKET88_HUB_DEGREE_CAP,
  MARKET88_HQ_ROOM_NAMES,
  MARKET88_RAID_SHUTTER_GATES,
  MARKET88_SMALL_WORLD_CHORDS,
  applyBlackMarket88Purchase,
  applyBlackMarket88SamosborDemand,
  createBlackMarket88Debt,
  createBlackMarket88DesignState,
  matureBlackMarket88Debts,
  quoteBlackMarket88Purchase,
} from '../src/gen/design_floors/black_market_88';
import {
  countTerritoryCells,
  territoryHqAnchors,
  territoryOwnerAtIndex,
  territoryRoomOwner,
} from '../src/systems/territory';

type BlackMarketGeneration = ReturnType<typeof generateDesignFloor>;
type HubId = typeof MARKET88_GEOMETRY_HUBS[number]['id'];

let cachedGeneration: BlackMarketGeneration | undefined;

function blackMarket(): BlackMarketGeneration {
  cachedGeneration ??= generateDesignFloor(BLACK_MARKET_88_ROUTE_ID);
  return cachedGeneration;
}

function weightOf<T>(items: readonly { value: T; weight: number }[], value: T): number {
  return items.find(item => item.value === value)?.weight ?? 0;
}

function hub(id: HubId): typeof MARKET88_GEOMETRY_HUBS[number] {
  const out = MARKET88_GEOMETRY_HUBS.find(item => item.id === id);
  assert.ok(out, id);
  return out;
}

function strictReachable(gen: BlackMarketGeneration): Uint8Array {
  const world = gen.world;
  const seen = new Uint8Array(W * W);
  const queue = new Int32Array(W * W);
  let head = 0;
  let tail = 0;
  const start = world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY));
  seen[start] = 1;
  queue[tail++] = start;

  while (head < tail) {
    const ci = queue[head++];
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = world.idx(x + dx, y + dy);
      if (seen[ni] || !strictPassable(gen, ni)) continue;
      seen[ni] = 1;
      queue[tail++] = ni;
    }
  }

  return seen;
}

function strictPassable(gen: BlackMarketGeneration, idx: number): boolean {
  const cell = gen.world.cells[idx];
  if (cell === Cell.FLOOR || cell === Cell.WATER) return true;
  if (cell !== Cell.DOOR) return false;
  const door = gen.world.doors.get(idx);
  return door?.state === DoorState.OPEN || door?.state === DoorState.HERMETIC_OPEN;
}

function hasReachableNear(gen: BlackMarketGeneration, reachable: Uint8Array, x: number, y: number, radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      if (reachable[gen.world.idx(x + dx, y + dy)]) return true;
    }
  }
  return false;
}

test('black_market_88 is the z -10 authored Living-band route floor', () => {
  const route = designFloorById(BLACK_MARKET_88_ROUTE_ID);
  assert.equal(route?.z, BLACK_MARKET_88_FUTURE_Z);
  assert.equal(route?.baseFloor, FloorLevel.LIVING);
  assert.equal(route?.displayName, 'Черный рынок 88');
  assert.equal(designFloorAtZ(BLACK_MARKET_88_FUTURE_Z)?.id, BLACK_MARKET_88_ROUTE_ID);
});

test('black_market_88 population profile keeps market crowd and service-gut monster pressure bounded', () => {
  const route = designFloorById(BLACK_MARKET_88_ROUTE_ID);
  assert.ok(route);
  const profile = designFloorPopulationProfile(route);

  assert.equal(profile.npcTarget, 2200);
  assert.equal(profile.monsterTarget, 700);
  assert.equal(profile.npcTarget + profile.monsterTarget <= ACTIVE_ACTOR_SOFT_LIMIT, true);
  assert.equal(weightOf(profile.npcFactions, Faction.CITIZEN) > weightOf(profile.npcFactions, Faction.LIQUIDATOR), true);
  assert.equal(weightOf(profile.npcFactions, Faction.WILD) > weightOf(profile.npcFactions, Faction.LIQUIDATOR), true);
  assert.equal(weightOf(profile.npcOccupations, Occupation.STOREKEEPER) > 0, true);
  assert.equal(weightOf(profile.npcOccupations, Occupation.TRAVELER) > 0, true);
  assert.equal(profile.monsterBiasKinds.includes(MonsterKind.SLIMEVIK), true);
  assert.equal(profile.monsterPlacement.anchors?.some(anchor => anchor.x === 168 && anchor.y === 626 && anchor.weight > 2), true);
  assert.equal(profile.npcPlacement.anchors?.some(anchor => anchor.x === 512 && anchor.y === 500 && anchor.weight > 1), true);
});

test('black_market_88 generator exposes bazaar, auction, service guts, containers and decision NPCs', () => {
  const gen = blackMarket();
  const names = new Set(gen.world.rooms.map(room => room.name));
  const spawnCell = gen.world.cells[gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))];
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const monsters = gen.entities.filter(entity => entity.type === EntityType.MONSTER);

  assert.equal(spawnCell, Cell.FLOOR);
  assert.equal(gen.world.liftDir.some((dir, idx) => dir === LiftDirection.UP && gen.world.cells[idx] === Cell.LIFT), true);
  assert.equal(gen.world.liftDir.some((dir, idx) => dir === LiftDirection.DOWN && gen.world.cells[idx] === Cell.LIFT), true);

  for (const roomName of [
    'Парольный вход 88',
    'Рыночные ряды 88',
    'Долговая контора 88',
    'Оружейный ряд 88',
    'Лекарственный шкаф 88',
    'Аукционная яма 88',
    'Долговой суд 88',
    'Документальный кордон 88',
    'Западный тайник контрабанды 88',
    'Восточный тайник контрабанды 88',
    'Холодный склад без накладной 88',
  ]) {
    assert.equal(names.has(roomName), true, roomName);
  }

  const stallRooms = gen.world.rooms.filter(room => /^(Прилавок|Лоток|Палатка|Стол|Занавес|Склад без вывески)/.test(room.name));
  const serviceGutRooms = gen.world.rooms.filter(room => room.name.includes('служеб') || room.name.includes('Сервис') || room.name.includes('сервис') || room.name.includes('кишка'));
  const microRooms = gen.world.rooms.filter(room => room.w * room.h <= 54);
  assert.equal(stallRooms.length >= 80, true, `stall rooms ${stallRooms.length}`);
  assert.equal(serviceGutRooms.length >= 6, true, `service gut rooms ${serviceGutRooms.length}`);
  assert.equal(gen.world.rooms.length >= 340, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 340, true, `doors ${gen.world.doors.size}`);
  assert.equal(microRooms.length >= 140, true, `micro rooms ${microRooms.length}`);
  assert.equal(npcs.length >= 1900 && npcs.length <= 2600, true, `npc count ${npcs.length}`);
  assert.equal(monsters.length >= 600 && monsters.length <= 800, true, `monster count ${monsters.length}`);

  for (const npcId of [
    'market88_marta_broker',
    'market88_mikhail_debt',
    'market88_zlata_silence',
    'market88_zhoka_knife',
    'market88_courier_sasha',
  ]) {
    assert.equal(npcs.some(entity => entity.plotNpcId === npcId), true, npcId);
  }

  assert.equal(gen.world.containers.some(container => container.tags.includes('entry_toll')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('black_route_papers')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('raid_shutter')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('maintenance_hatch') && container.discovered === false), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('hq_support') && container.tags.includes('wild')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('mid_block') && container.tags.includes('documents')), true);

  const questIds = new Set(getSideQuestRegistrySnapshot().map(quest => quest.id));
  for (const questId of ['market88_deliver_night_stock', 'market88_hide_courier', 'market88_steal_stamp', 'market88_settle_bad_debt']) {
    assert.equal(questIds.has(questId), true, questId);
  }
});

test('black_market_88 uses wild-dominant cell territory with authored mini HQ compounds', () => {
  const gen = blackMarket();
  const names = new Set(gen.world.rooms.map(room => room.name));
  const anchors = territoryHqAnchors(gen.world);
  const anchorByOwner = new Map(anchors.map(anchor => [anchor.owner, anchor]));
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / (W * W);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const expectedHqs = new Map([
    [ZoneFaction.CITIZEN, MARKET88_HQ_ROOM_NAMES.citizen],
    [ZoneFaction.LIQUIDATOR, MARKET88_HQ_ROOM_NAMES.liquidator],
    [ZoneFaction.CULTIST, MARKET88_HQ_ROOM_NAMES.cultist],
    [ZoneFaction.SCIENTIST, MARKET88_HQ_ROOM_NAMES.scientist],
    [ZoneFaction.WILD, MARKET88_HQ_ROOM_NAMES.wild],
  ]);

  for (const supportRoom of [
    'Кухня гражданской очереди 88',
    'Санузел поста досмотра 88',
    'Склад копченых расписок 88',
    'Лаборатория серого спроса 88',
    'Кухня диких поставщиков 88',
    'Западный герморазвал диких 88',
    'Восточный герморазвал диких 88',
  ]) {
    assert.equal(names.has(supportRoom), true, supportRoom);
  }

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal((counts.get(owner) ?? 0) > 0, true, `owned cells ${ZoneFaction[owner]}`);
    const anchor = anchorByOwner.get(owner);
    assert.ok(anchor, `hq anchor ${ZoneFaction[owner]}`);
    const room = gen.world.rooms[anchor.roomId];
    assert.equal(room?.name, expectedHqs.get(owner), `hq room ${ZoneFaction[owner]}`);
    assert.equal(room?.type, RoomType.HQ, `hq type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `hq sealed ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => gen.world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN), true, `hq hermetic door ${ZoneFaction[owner]}`);
    assert.equal(room ? territoryRoomOwner(gen.world, room.id) : undefined, owner, `hq owner ${ZoneFaction[owner]}`);
  }

  assert.equal(dominant, ZoneFaction.WILD);
  assert.equal(Math.abs(share(ZoneFaction.CITIZEN) - 0.16) <= 0.025, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(Math.abs(share(ZoneFaction.LIQUIDATOR) - 0.09) <= 0.02, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(Math.abs(share(ZoneFaction.CULTIST) - 0.08) <= 0.02, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.SCIENTIST) - 0.07) <= 0.02, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.WILD) - 0.60) <= 0.025, true, `wild share ${share(ZoneFaction.WILD)}`);

  const ambientNpcs = gen.entities.filter(entity =>
    entity.type === EntityType.NPC &&
    !entity.plotNpcId &&
    !entity.persistentNpcId &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    entity.faction !== undefined);
  const ownTerritoryNpcs = ambientNpcs.filter(entity => {
    const idx = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, idx)) === entity.faction;
  });
  assert.equal(ambientNpcs.length > 0, true);
  assert.equal(ownTerritoryNpcs.length / ambientNpcs.length >= 0.85, true, `own territory NPC share ${ownTerritoryNpcs.length / ambientNpcs.length}`);
});

test('black_market_88 hub graph is scale-free enough without uncapped hub degree', () => {
  const degrees = new Map<HubId, number>();
  for (const node of MARKET88_GEOMETRY_HUBS) degrees.set(node.id, 0);

  for (const chord of MARKET88_SMALL_WORLD_CHORDS) {
    degrees.set(chord.from, (degrees.get(chord.from) ?? 0) + 1);
    degrees.set(chord.to, (degrees.get(chord.to) ?? 0) + 1);
  }

  for (const [id, degree] of degrees) {
    assert.equal(degree <= MARKET88_HUB_DEGREE_CAP, true, `${id} degree ${degree}`);
  }
  assert.equal(degrees.get('auction_pit'), MARKET88_HUB_DEGREE_CAP);
  assert.equal((degrees.get('document_choke') ?? 0) >= 3, true);
  assert.equal(MARKET88_SMALL_WORLD_CHORDS.filter(chord => chord.hidden).length >= 6, true);
});

test('black_market_88 small-world alleys and raid shutters leave survivable bypasses', () => {
  const gen = blackMarket();
  const reachable = strictReachable(gen);
  const strictCount = reachable.reduce((sum, value) => sum + value, 0);

  assert.equal(strictCount >= 80_000, true, `strict reachable cells ${strictCount}`);

  for (const chord of MARKET88_SMALL_WORLD_CHORDS) {
    const from = hub(chord.from);
    const to = hub(chord.to);
    assert.equal(hasReachableNear(gen, reachable, from.x, from.y, 5), true, chord.from);
    assert.equal(hasReachableNear(gen, reachable, to.x, to.y, 5), true, chord.to);
  }

  for (const gate of MARKET88_RAID_SHUTTER_GATES) {
    const idx = gen.world.idx(gate.x, gate.y);
    const door = gen.world.doors.get(idx);
    assert.equal(gen.world.cells[idx], Cell.DOOR, `gate ${gate.x},${gate.y} cell`);
    assert.equal(door?.state, DoorState.HERMETIC_CLOSED, `gate ${gate.x},${gate.y} state`);
    assert.equal(hasReachableNear(gen, reachable, gate.bypass.ax, gate.bypass.ay, 2), true, `bypass A ${gate.x},${gate.y}`);
    assert.equal(hasReachableNear(gen, reachable, gate.bypass.bx, gate.bypass.by, 2), true, `bypass B ${gate.x},${gate.y}`);
  }
});

test('black_market_88 state covers purchase, debt, raid and samosbor demand without live simulation', () => {
  const state = createBlackMarket88DesignState();
  const offerId = BLACK_MARKET_88_STOCK[0].id;
  const quote = quoteBlackMarket88Purchase(state, offerId, 1.25, 10);
  assert.ok(quote);
  assert.equal(quote.sellPrice < quote.buyPrice, true);

  const beforeStock = state.stock[offerId];
  const purchase = applyBlackMarket88Purchase(state, offerId, 10);
  assert.equal(purchase.ok, true);
  assert.equal(state.stock[offerId], beforeStock - 1);
  assert.equal(state.heat > 18, true);

  const debtTemplate = BLACK_MARKET_88_DEBTS[0];
  const debt = createBlackMarket88Debt(state, debtTemplate.id, 20);
  assert.equal(debt.ok, true);
  assert.equal(state.debts.length, 1);
  assert.equal(state.debts[0].ownerId, debtTemplate.ownerId);

  const matured = matureBlackMarket88Debts(state, 20 + debtTemplate.dueHours * 60 + 1);
  assert.equal(matured.ok, true);
  assert.equal(state.debts[0].overdue, true);
  assert.equal((state.traderLocks.medicine ?? 0) > 20, true);

  const accessBefore = state.demand.access;
  const samosbor = applyBlackMarket88SamosborDemand(state, 'wet');
  assert.equal(samosbor.ok, true);
  assert.equal(state.demand.access > accessBefore, true);
});
