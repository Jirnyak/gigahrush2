import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import '../src/gen/living/caravan_exchange';

import { AIGoal, Cell, Faction, Feature, FloorLevel, Occupation, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { CARAVAN_LANES, SMALL_CARAVAN_TEMPLATES } from '../src/data/caravans';
import { createEconomyFloorState } from '../src/data/economy';
import { getSideQuestRegistrySnapshot } from '../src/data/plot';
import { alifeForSave, sampleAlifeFloorRecordIds, setAlifeState } from '../src/systems/alife';
import {
  CARAVAN_TICK_SECONDS,
  ensureCaravanState,
  getCaravanResourceTariffMultiplier,
  getNearestSmallCaravan,
  payCaravanTariff,
  robCaravanCargo,
  spawnSmallCaravanNear,
  tickCaravans,
} from '../src/systems/caravans';
import { ensureEconomyState, getAdjustedItemPrice, getEconomyQuote } from '../src/systems/economy';
import { createWorldEventState, getRecentEvents, publishEvent } from '../src/systems/events';
import { addTestRoom, makeGameState, makeTestNpc, makeTestPlayer } from './helpers';

const LANE_QUEUE = 'kvartiry_living_food_water';
const LANE_NET = 'net_exchange_data';
const LANE_MARKET = 'production_black_market_88';

function addCaravanSpawnRoom(world: World): void {
  addTestRoom(world, {
    id: 2,
    x: 20,
    y: 20,
    w: 18,
    h: 10,
    type: RoomType.OFFICE,
    name: 'Караванный тестовый узел',
  });
  world.cells[world.idx(23, 19)] = Cell.LIFT;
  world.features[world.idx(24, 20)] = Feature.LIFT_BUTTON;
}

function caravanNpc(overrides: Partial<Entity> = {}): Entity {
  return makeTestNpc({
    id: 2,
    x: 25.5,
    y: 24.5,
    faction: Faction.CITIZEN,
    occupation: Occupation.STOREKEEPER,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    questId: -1,
    ...overrides,
  });
}

test('caravan lane definitions validate and cover required supply lanes', () => {
  assert.equal(CARAVAN_LANES.length >= 6, true);
  assert.equal(SMALL_CARAVAN_TEMPLATES.length >= 5, true);
  assert.equal(CARAVAN_LANES.some(lane => lane.id === LANE_QUEUE), true);
  assert.equal(CARAVAN_LANES.some(lane => lane.id === LANE_NET), true);
  assert.equal(CARAVAN_LANES.some(lane => lane.id === LANE_MARKET), true);
});

test('forced caravan tick moves stock between two floors and publishes visible events', () => {
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    time: 100,
    worldEvents: createWorldEventState(),
  });
  const economy = ensureEconomyState(state);
  economy.floors[FloorLevel.KVARTIRY] = createEconomyFloorState(FloorLevel.KVARTIRY);
  economy.floors[FloorLevel.LIVING] = createEconomyFloorState(FloorLevel.LIVING);

  const beforeKvFood = economy.floors[FloorLevel.KVARTIRY]!.resources.food.stock;
  const beforeLivingFood = economy.floors[FloorLevel.LIVING]!.resources.food.stock;

  assert.equal(tickCaravans(state, CARAVAN_TICK_SECONDS, true, 1), 1);

  assert.ok(economy.floors[FloorLevel.KVARTIRY]!.resources.food.stock < beforeKvFood);
  assert.ok(economy.floors[FloorLevel.LIVING]!.resources.food.stock > beforeLivingFood);
  assert.equal(
    getRecentEvents(state, { tags: ['caravan', 'tariff', 'supply_lane', LANE_QUEUE], limit: 1 }).length,
    1,
  );
  assert.equal(state.msgLog.some(entry => entry.text.includes('Квартиры -> Жилая: еда и вода')), true);
});

test('caravan tariff getter reflects robbery pressure and paid stabilization', () => {
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    time: 200,
    worldEvents: createWorldEventState(),
  });

  const before = getCaravanResourceTariffMultiplier(state, 'drink_water', FloorLevel.LIVING);
  assert.equal(robCaravanCargo(state, LANE_QUEUE), true);
  const pressured = getCaravanResourceTariffMultiplier(state, 'drink_water', FloorLevel.LIVING);
  assert.ok(pressured > before);

  assert.equal(payCaravanTariff(state, LANE_QUEUE), true);
  const stabilized = getCaravanResourceTariffMultiplier(state, 'drink_water', FloorLevel.LIVING);
  assert.ok(stabilized < pressured);
});

test('caravan tariffs feed item economy quotes and invalidate cached prices', () => {
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    time: 220,
    worldEvents: createWorldEventState(),
  });
  ensureEconomyState(state).floors[FloorLevel.LIVING] = createEconomyFloorState(FloorLevel.LIVING);

  const beforeTariff = getCaravanResourceTariffMultiplier(state, 'drink_water', FloorLevel.LIVING);
  const beforeQuote = getEconomyQuote(state, 'filtered_water');
  const cachedBefore = getAdjustedItemPrice(state, 'filtered_water');

  assert.equal(beforeQuote.tariffMultiplier, beforeTariff);
  assert.equal(beforeQuote.tags.includes('caravan_tariff'), true);
  assert.equal(robCaravanCargo(state, LANE_QUEUE), true);

  const pressuredTariff = getCaravanResourceTariffMultiplier(state, 'drink_water', FloorLevel.LIVING);
  const pressuredQuote = getEconomyQuote(state, 'filtered_water');

  assert.ok(pressuredTariff > beforeTariff);
  assert.equal(pressuredQuote.tariffMultiplier, pressuredTariff);
  assert.ok(pressuredQuote.buyPrice > beforeQuote.buyPrice);
  assert.ok(getAdjustedItemPrice(state, 'filtered_water') > cachedBefore);
});

test('caravan exchange registers route choices and quest events open or close lanes', () => {
  const questIds = new Set(
    getSideQuestRegistrySnapshot()
      .filter(quest => quest.id.startsWith('ag108_'))
      .map(quest => quest.id),
  );
  assert.deepEqual(
    [...questIds].sort(),
    ['ag108_close_market_lane', 'ag108_open_net_lane', 'ag108_pay_queue_tariff'],
  );

  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    time: 300,
    worldEvents: createWorldEventState(),
  });
  assert.equal(ensureCaravanState(state).lanes[LANE_NET].open, false);

  publishEvent(state, {
    type: 'quest_completed',
    severity: 4,
    privacy: 'public',
    targetName: 'НЕТ-линия обменных данных открыта',
    tags: ['quest', 'completed', 'caravan', 'tariff', 'supply_lane', LANE_NET],
    data: { caravanAction: 'open_lane', laneId: LANE_NET },
  });
  assert.equal(ensureCaravanState(state).lanes[LANE_NET].open, true);

  assert.equal(ensureCaravanState(state).lanes[LANE_MARKET].open, true);
  publishEvent(state, {
    type: 'quest_completed',
    severity: 4,
    privacy: 'public',
    targetName: 'Маршрут рынка 88 сдан ревизору',
    tags: ['quest', 'completed', 'caravan', 'tariff', 'supply_lane', LANE_MARKET],
    data: { caravanAction: 'close_lane', laneId: LANE_MARKET },
  });
  assert.equal(ensureCaravanState(state).lanes[LANE_MARKET].open, false);
  assert.equal(getRecentEvents(state, { tags: ['caravan', 'supply_lane', LANE_NET], limit: 1 }).length, 1);
});

test('caravan contract completions apply escort, raid, reroute, report, and seat outcomes', () => {
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    time: 420,
    worldEvents: createWorldEventState(),
  });
  const caravans = ensureCaravanState(state);
  const queueStability = caravans.lanes[LANE_QUEUE].stability;
  const repairPressure = caravans.lanes.maintenance_living_tools.tariffPressure;

  publishEvent(state, {
    type: 'contract_completed',
    severity: 4,
    privacy: 'public',
    targetName: 'Довести малую очередь',
    tags: ['quest', 'contract', 'completed', 'caravan'],
    data: { contractId: 'caravan_escort_queue_porters' },
  });
  assert.ok(ensureCaravanState(state).lanes[LANE_QUEUE].stability > queueStability);

  publishEvent(state, {
    type: 'contract_completed',
    severity: 4,
    privacy: 'public',
    targetName: 'Снять мешок с очереди',
    tags: ['quest', 'contract', 'completed', 'caravan'],
    data: { contractId: 'caravan_raid_queue_cargo' },
  });
  assert.equal(ensureCaravanState(state).lanes[LANE_QUEUE].raids, 1);

  publishEvent(state, {
    type: 'contract_completed',
    severity: 4,
    privacy: 'public',
    targetName: 'Рискованный обход ремонтников',
    tags: ['quest', 'contract', 'completed', 'caravan'],
    data: { contractId: 'caravan_reroute_repair_crew' },
  });
  assert.ok(ensureCaravanState(state).lanes.maintenance_living_tools.tariffPressure > repairPressure);

  publishEvent(state, {
    type: 'contract_completed',
    severity: 4,
    privacy: 'public',
    targetName: 'Сдать серый маршрут',
    tags: ['quest', 'contract', 'completed', 'caravan'],
    data: { contractId: 'caravan_report_market88_smugglers' },
  });
  assert.equal(ensureCaravanState(state).lanes[LANE_MARKET].open, false);

  publishEvent(state, {
    type: 'contract_completed',
    severity: 3,
    privacy: 'local',
    targetName: 'Место в водном караване',
    tags: ['quest', 'contract', 'completed', 'caravan'],
    data: { contractId: 'caravan_buy_queue_seat' },
  });
  assert.equal(state.msgs.some(entry => entry.text.includes('Место в малом караване')), true);
});

test('small caravan runs open near service cells without appending new people', () => {
  const world = new World();
  addCaravanSpawnRoom(world);

  const player = makeTestPlayer({ id: 1, x: 26.5, y: 25.5 });
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    time: 600,
    worldEvents: createWorldEventState(),
  });
  setAlifeState(state, { seed: 12345, total: 100_000 });
  const npc = caravanNpc({ id: 2, alifeId: 1, persistentNpcId: 'alife:1' });
  const entities = [player, npc];
  const nextId = { v: 2 };

  const run = spawnSmallCaravanNear(state, world, entities, nextId, player, 'queue_lift_porters');
  assert.ok(run);
  assert.equal(entities.length, 2);
  assert.deepEqual(run.memberIds, [2]);
  assert.deepEqual(run.memberAlifeIds, [1]);

  const nearest = getNearestSmallCaravan(state, world, player, 80);
  assert.equal(nearest?.id, run?.id);
  assert.equal(nearest?.laneId, LANE_QUEUE);
  assert.equal(nearest?.statusText, 'в пути');
});

test('small caravan claims existing persistent A-Life members', () => {
  const world = new World();
  addCaravanSpawnRoom(world);
  const player = makeTestPlayer({ id: 1, x: 26.5, y: 25.5 });
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    time: 700,
    worldEvents: createWorldEventState(),
  });
  setAlifeState(state, { seed: 12345, total: 100_000 });
  const npc = caravanNpc({ id: 2, alifeId: 1, persistentNpcId: 'alife:1' });
  const entities = [player, npc];

  const run = spawnSmallCaravanNear(state, world, entities, { v: 3 }, player, 'queue_lift_porters');

  assert.ok(run);
  assert.deepEqual(run.memberIds, [2]);
  assert.deepEqual(run.memberAlifeIds, [1]);
});

test('small caravan assigns identity only to eligible ordinary members', () => {
  const world = new World();
  addCaravanSpawnRoom(world);
  const player = makeTestPlayer({ id: 1, x: 26.5, y: 25.5 });
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    time: 720,
    worldEvents: createWorldEventState(),
  });
  setAlifeState(state, { seed: 12345, total: 100_000 });
  const npc = caravanNpc({ id: 2 });
  const entities = [player, npc];

  const run = spawnSmallCaravanNear(state, world, entities, { v: 3 }, player, 'queue_lift_porters');

  assert.ok(run);
  assert.equal(typeof npc.alifeId, 'number');
  assert.deepEqual(run.memberIds, [2]);
  assert.deepEqual(run.memberAlifeIds, [npc.alifeId]);
  assert.equal(alifeForSave(state).overrides.some(item => item.id === npc.alifeId), true);
});

test('small caravan rejects player, plot, quest, and menu-target NPCs without creating a ghost run', () => {
  const world = new World();
  addCaravanSpawnRoom(world);
  const player = makeTestPlayer({ id: 1, x: 26.5, y: 25.5 });
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    time: 740,
    showNpcMenu: true,
    npcMenuTarget: 5,
    worldEvents: createWorldEventState(),
  });
  setAlifeState(state, { seed: 12345, total: 100_000 });
  const entities = [
    player,
    caravanNpc({ id: 3, plotNpcId: 'plot_guard' }),
    caravanNpc({ id: 4, canGiveQuest: true }),
    caravanNpc({ id: 5 }),
  ];

  const run = spawnSmallCaravanNear(state, world, entities, { v: 6 }, player, 'queue_lift_porters');

  assert.equal(run, undefined);
  assert.deepEqual(Object.keys(ensureCaravanState(state).active), []);
});

test('small caravan arrival moves surviving member A-Life records to destination key', () => {
  const world = new World();
  addCaravanSpawnRoom(world);
  const player = makeTestPlayer({ id: 1, x: 26.5, y: 25.5 });
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    time: 760,
    worldEvents: createWorldEventState(),
  });
  setAlifeState(state, { seed: 12345, total: 100_000 });
  const npc = caravanNpc({ id: 2 });
  const entities = [player, npc];
  const run = spawnSmallCaravanNear(state, world, entities, { v: 3 }, player, 'queue_lift_porters');
  assert.ok(run);
  assert.ok(npc.alifeId);
  run.toFloorKey = 'story:kvartiry';
  run.progress = 0.99;

  tickCaravans(state, CARAVAN_TICK_SECONDS, true, 0, world, entities, player, { v: 3 });

  assert.equal(run.status, 'arrived');
  const moved = alifeForSave(state).overrides.find(item => item.id === npc.alifeId);
  assert.equal(moved?.floorKey, 'story:kvartiry');
  assert.equal(moved?.floor, FloorLevel.KVARTIRY);
  assert.equal(alifeForSave(state).deadIds.includes(npc.alifeId), false);
});

test('caravan raids do not kill every persistent member by default', () => {
  const world = new World();
  addCaravanSpawnRoom(world);
  const player = makeTestPlayer({ id: 1, x: 26.5, y: 25.5 });
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    time: 780,
    worldEvents: createWorldEventState(),
  });
  setAlifeState(state, { seed: 12345, total: 100_000 });
  const npc = caravanNpc({ id: 2 });
  const entities = [player, npc];
  const run = spawnSmallCaravanNear(state, world, entities, { v: 3 }, player, 'queue_lift_porters');
  assert.ok(run);
  assert.ok(npc.alifeId);

  assert.equal(robCaravanCargo(state, LANE_QUEUE), true);

  assert.equal(run.status, 'raided');
  assert.equal(alifeForSave(state).deadIds.includes(npc.alifeId), false);
});

test('off-floor caravan lane migration moves a bounded prefilled A-Life record', () => {
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    time: 800,
    worldEvents: createWorldEventState(),
  });
  const alife = setAlifeState(state, { seed: 12345, total: 100_000 }) as {
    total: number;
    npcs: Array<{ id: number; floorKey: string; faction: Faction }>;
    floorIndex: Record<string, number[]>;
  };
  const caravans = ensureCaravanState(state);
  caravans.lanes[LANE_QUEUE].runs = 3;
  const expectedSample = sampleAlifeFloorRecordIds(state, 'story:kvartiry', 1, 4 + LANE_QUEUE.length, {
    faction: Faction.CITIZEN,
    maxAttempts: 96,
  });
  assert.equal(expectedSample.length, 1);
  const sourceBefore = alife.floorIndex['story:kvartiry'].length;
  const targetBefore = alife.floorIndex['story:living'].length;

  assert.equal(tickCaravans(state, CARAVAN_TICK_SECONDS, true, 1), 1);

  assert.equal(alife.total, 100_000);
  assert.equal(alife.floorIndex['story:kvartiry'].length, sourceBefore - 1);
  assert.equal(alife.floorIndex['story:living'].length, targetBefore + 1);
  assert.equal(alifeForSave(state).overrides.some(item => item.id === expectedSample[0] && item.floorKey === 'story:living'), true);
});
