import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { SeedRng } from '../src/core/rand';

import {
  Cell,
  ContainerKind,
  DoorState,
  EntityType,
  Faction,
  FloorLevel,
  Occupation,
  QuestType,
  RoomType,
  Tex,
  WORLD_EVENT_TYPES,
  WORLD_EVENT_IMPORTANT_CAPACITY,
  WORLD_EVENT_RECENT_CAPACITY,
  WORLD_EVENT_ZONE_CAPACITY,
  ZoneFaction,
  type WorldEvent,
  type WorldEventSeverity,
} from '../src/core/types';
import { World } from '../src/core/world';
import { ITEMS } from '../src/data/catalog';
import { ECONOMY_ROUTE_STATE_CAP, createEconomyFloorState, normalizeEconomyState } from '../src/data/economy';
import { MAX_INVENTORY_SLOTS } from '../src/data/inventory_limits';
import { getStack } from '../src/data/items';
import { SIDE_QUESTS } from '../src/data/plot';
import { getFactionRel, initFactionRelations } from '../src/data/relations';
import { RESOURCES } from '../src/data/resources';
import { getSamosborBeatDefs, registerSamosborBeat } from '../src/data/samosbor_director';
import { SAMOSBOR_VARIANTS, type ActiveSamosborVariant } from '../src/data/samosbor_variants';
import { spawnContract } from '../src/systems/contracts';
import { putIntoContainer, restoreValidContainers, takeFromContainer, tickContainerAudits } from '../src/systems/containers';
import {
  changeResourceStock,
  economyForSave,
  ensureEconomyState,
  getAdjustedItemPrice,
  getEconomyQuote,
  getResourceScarcity,
  getScarcityAdjustedReward,
  normalizeGameEconomy,
  spendResources,
  summarizeEconomy,
} from '../src/systems/economy';
import {
  createWorldEventState,
  getImportantEvents,
  getRecentEvents,
  getZoneEvents,
  normalizeWorldEventState,
  publishEvent,
  registerWorldEventObserver,
  trimEventHistoryForSave,
  unregisterWorldEventObserver,
} from '../src/systems/events';
import '../src/systems/caravans';
import { getNpcMemory } from '../src/systems/npc_memory';
import { ensureProductionRooms, tickProduction, type ProductionState } from '../src/systems/production';
import { questRemainingMinutes } from '../src/systems/quest_deadlines';
import { checkQuests, offerQuest } from '../src/systems/quests';
import { getSamosborDirectorTrace, tickSamosborDirector } from '../src/systems/samosbor_director';
import { addTestRoom, makeGameState, makeTestContainer, makeTestEntity } from './helpers';

test('world event taxonomy is runtime-auditable and keeps generic faction events typed', () => {
  const unique = new Set(WORLD_EVENT_TYPES);
  assert.equal(unique.size, WORLD_EVENT_TYPES.length);
  assert.ok(unique.has('faction_event'));
  assert.ok(unique.has('faction_patrol_clash'));
  assert.ok(unique.has('faction_relation_changed'));
  assert.ok(WORLD_EVENT_TYPES.every(t => t === t.toLowerCase() && !t.includes(' ')));
});

test('world event buffers cap, order newest first, and filter by zone/severity', () => {
  const state = makeGameState({ worldEvents: createWorldEventState() });

  for (let i = 0; i < WORLD_EVENT_RECENT_CAPACITY + 8; i++) {
    state.time = i * 5;
    publishEvent(state, {
      type: 'npc_enter_zone',
      zoneId: i % 2 === 0 ? 7 : 8,
      severity: i % 4 === 0 ? 4 : 1,
      privacy: 'local',
      tags: ['test', i % 2 === 0 ? 'even' : 'odd'],
    });
  }

  const recent = getRecentEvents(state);
  assert.equal(recent.length, WORLD_EVENT_RECENT_CAPACITY);
  assert.equal(recent[0].id, WORLD_EVENT_RECENT_CAPACITY + 8);
  assert.equal(recent.at(-1)?.id, 9);

  const zoneEvents = getZoneEvents(state, 7);
  assert.equal(zoneEvents.length, WORLD_EVENT_ZONE_CAPACITY);
  assert.equal(zoneEvents[0].zoneId, 7);
  assert.ok(zoneEvents.every(e => e.tags.includes('even')));

  const important = getImportantEvents(state, WORLD_EVENT_IMPORTANT_CAPACITY + 10);
  assert.equal(important.length, WORLD_EVENT_IMPORTANT_CAPACITY);
  assert.ok(important.every(e => e.severity >= 4));
});

test('world event normalization trims old save payloads to fixed capacities', () => {
  const state = makeGameState({ worldEvents: createWorldEventState() });

  for (let i = 0; i < WORLD_EVENT_RECENT_CAPACITY + 20; i++) {
    publishEvent(state, {
      type: 'samosbor_warning',
      zoneId: 3,
      severity: 3,
      privacy: 'public',
      tags: ['samosbor'],
    });
  }

  const saved = trimEventHistoryForSave(state);
  assert.equal(saved.recentEvents.capacity, WORLD_EVENT_RECENT_CAPACITY);
  assert.equal(saved.recentEvents.count, WORLD_EVENT_RECENT_CAPACITY);
  assert.equal(saved.zoneEvents[3].capacity, WORLD_EVENT_ZONE_CAPACITY);
  assert.equal(saved.zoneEvents[3].count, WORLD_EVENT_ZONE_CAPACITY);
});

test('world event normalization preserves order and advances next id beyond restored events', () => {
  const state = makeGameState({ worldEvents: createWorldEventState() });

  for (let i = 0; i < 4; i++) {
    publishEvent(state, {
      type: 'samosbor_warning',
      zoneId: 2,
      severity: 3,
      privacy: 'public',
      tags: ['order_test', `step_${i}`],
    });
  }

  const saved = normalizeWorldEventState({
    nextId: 1,
    recentEvents: state.worldEvents?.recentEvents,
    importantEvents: state.worldEvents?.importantEvents,
    zoneEvents: state.worldEvents?.zoneEvents,
  });
  const restored = makeGameState({ worldEvents: saved });
  const recent = getRecentEvents(restored, { limit: 4 });

  assert.deepEqual(recent.map(e => e.id), [4, 3, 2, 1]);
  assert.equal(saved.nextId, 5);
  assert.equal(publishEvent(restored, {
    type: 'samosbor_warning',
    severity: 3,
    privacy: 'public',
    tags: ['order_test'],
  }).id, 5);
});

test('world event publication clamps payloads before notifying observers', () => {
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const longTag = `tag_${'x'.repeat(48)}`;
  const longKey = 'k'.repeat(48);
  let observed: WorldEvent | undefined;
  let observedState = false;
  let observedCount = 0;
  const observer = (game: typeof state, event: WorldEvent): void => {
    if (event.type !== 'faction_event') return;
    observed = event;
    observedState = game === state;
    observedCount++;
  };

  registerWorldEventObserver(observer);
  const event = publishEvent(state, {
    type: 'faction_event',
    zoneId: 1,
    severity: 99 as WorldEventSeverity,
    privacy: 'public',
    tags: ['alpha', 'alpha', '', longTag, 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q'],
    data: {
      [longKey]: 'v'.repeat(140),
      nested: { child: { tooDeep: true } },
      arr: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      bad: Number.POSITIVE_INFINITY,
      keep: true,
      undef: undefined,
      k6: 6,
      k7: 7,
      k8: 8,
      k9: 9,
      k10: 10,
      k11: 11,
      k12: 12,
      k13: 13,
    },
  });
  assert.equal(unregisterWorldEventObserver(observer), true);

  publishEvent(state, {
    type: 'faction_event',
    severity: 3,
    privacy: 'public',
    tags: ['after_unregister'],
  });

  assert.equal(observed, event);
  assert.equal(observedState, true);
  assert.equal(observedCount, 1);
  assert.equal(unregisterWorldEventObserver(observer), false);
  assert.equal(event.severity, 5);
  assert.deepEqual(event.tags, ['alpha', longTag.slice(0, 32), 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o']);
  assert.equal(Object.keys(event.data ?? {}).length, 12);
  assert.equal(event.data?.[longKey.slice(0, 32)], 'v'.repeat(96));
  assert.deepEqual(event.data?.nested, { child: '[object]' });
  assert.deepEqual(event.data?.arr, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(event.data?.bad, 0);
  assert.equal(event.data?.undef, undefined);
});

test('world event observers dispatch from a snapshot and isolate failures', () => {
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const calls: string[] = [];
  const originalWarn = console.warn;
  let warnCount = 0;
  console.warn = (): void => {
    warnCount++;
  };

  const selfRemoving = (): void => {
    calls.push('self');
    unregisterWorldEventObserver(selfRemoving);
  };
  const throwing = (): void => {
    calls.push('throwing');
    throw new Error('observer failed');
  };
  const afterThrow = (): void => {
    calls.push('after');
  };

  try {
    registerWorldEventObserver(selfRemoving);
    registerWorldEventObserver(throwing);
    registerWorldEventObserver(afterThrow);

    publishEvent(state, {
      type: 'faction_event',
      severity: 3,
      privacy: 'public',
      tags: ['observer_test'],
    });
  } finally {
    unregisterWorldEventObserver(selfRemoving);
    unregisterWorldEventObserver(throwing);
    unregisterWorldEventObserver(afterThrow);
    console.warn = originalWarn;
  }

  assert.deepEqual(calls, ['self', 'throwing', 'after']);
  assert.equal(warnCount, 1);
});

test('world event observers gracefully handle missing console.warn', () => {
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const originalWarn = console.warn;
  let observedCount = 0;

  // @ts-expect-error Mocking console.warn as undefined for testing fallback
  console.warn = undefined;

  const throwingObserver = (): void => {
    throw new Error('observer failed');
  };
  const healthyObserver = (): void => {
    observedCount++;
  };

  try {
    registerWorldEventObserver(throwingObserver);
    registerWorldEventObserver(healthyObserver);

    publishEvent(state, {
      type: 'faction_event',
      severity: 3,
      privacy: 'public',
      tags: ['fallback_test'],
    });
  } finally {
    unregisterWorldEventObserver(throwingObserver);
    unregisterWorldEventObserver(healthyObserver);
    console.warn = originalWarn;
  }

  assert.equal(observedCount, 1);
});

test('world event observer error logging is bounded per publication', () => {
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const originalWarn = console.warn;
  let warnCount = 0;
  console.warn = (): void => {
    warnCount++;
  };
  const observers: (() => void)[] = [];
  for (let i = 0; i < 12; i++) {
    const observer = (): void => {
      throw new Error(`observer ${i} failed`);
    };
    observers.push(observer);
    registerWorldEventObserver(observer);
  }

  try {
    publishEvent(state, {
      type: 'faction_event',
      severity: 3,
      privacy: 'public',
      tags: ['observer_bound_test'],
    });
  } finally {
    for (const observer of observers) unregisterWorldEventObserver(observer);
    console.warn = originalWarn;
  }

  assert.equal(warnCount, 8);
});

test('AG82 idol branch completion returns the idol and publishes branch context', () => {
  initFactionRelations();
  const branch = SIDE_QUESTS.find(q => q.id === 'idol_ministry_registration');
  assert.ok(branch);

  const state = makeGameState({
    currentFloor: FloorLevel.MINISTRY,
    worldEvents: createWorldEventState(),
  });
  const player = makeTestEntity({ inventory: [{ defId: 'idol_chernobog', count: 1 }] });
  const giver = makeTestEntity({
    id: 2,
    type: EntityType.NPC,
    name: 'Вера Пропускова',
    faction: Faction.CITIZEN,
    occupation: Occupation.SECRETARY,
  });
  state.quests.push({
    id: 1,
    type: QuestType.FETCH,
    giverId: giver.id,
    giverName: giver.name ?? '???',
    desc: branch.desc,
    targetItem: branch.targetItem,
    targetCount: branch.targetCount,
    rewardItem: branch.rewardItem,
    rewardCount: branch.rewardCount,
    extraRewards: branch.extraRewards,
    relationDelta: branch.relationDelta,
    xpReward: branch.xpReward,
    moneyReward: branch.moneyReward,
    sideQuestId: branch.id,
    eventTags: branch.eventTags ? [...branch.eventTags] : undefined,
    eventData: branch.eventData ? { ...branch.eventData } : undefined,
    eventPrivacy: branch.eventPrivacy,
    eventSeverity: branch.eventSeverity,
    eventTargetName: branch.eventTargetName,
    done: false,
  });

  checkQuests(player, new World(), [player, giver], state, state.msgs);

  assert.equal(state.quests[0].done, true);
  assert.equal(player.inventory?.find(i => i.defId === 'idol_chernobog')?.count, 1);
  const event = getRecentEvents(state, { tags: ['idol_branch'], limit: 1 })[0];
  assert.ok(event);
  assert.equal(event.data?.mainPlotItemReturned, true);
  assert.equal(event.tags.includes('ministry'), true);
  assert.equal(event.tags.includes('report'), true);
});

test('economy state normalizes invalid resources and preserves valid saved values', () => {
  const normalized = normalizeEconomyState({
    priceVersion: 3,
    floors: {
      [FloorLevel.LIVING]: {
        floor: FloorLevel.LIVING,
        resources: {
          drink_water: { stock: Number.NaN, target: 50, lastDelta: Number.POSITIVE_INFINITY },
        },
        lastTickAt: 42,
      },
    },
  });

  const floor = normalized.floors[FloorLevel.LIVING]!;
  const base = RESOURCES.find(r => r.id === 'drink_water')!.baseStock;
  const target = 50;
  assert.equal(normalized.priceVersion, 3);
  assert.equal(floor.resources.drink_water.stock, Math.min(base, target * 2));
  assert.equal(floor.resources.drink_water.target, target);
  assert.equal(floor.resources.drink_water.lastDelta, 0);
  assert.equal(floor.lastTickAt, 42);
});

test('economy state restore drops invalid floor keys and caps route maps', () => {
  const normalized = normalizeEconomyState({
    floors: {
      [FloorLevel.LIVING]: { floor: FloorLevel.LIVING, resources: {}, lastTickAt: 12 },
      99: { floor: 99, resources: {}, lastTickAt: 99 },
      bad: { floor: FloorLevel.HELL, resources: {}, lastTickAt: 77 },
    },
    routes: Object.fromEntries(Array.from({ length: ECONOMY_ROUTE_STATE_CAP + 5 }, (_, i) => [
      `route_${i}`,
      { routeId: `spoof_${i}`, heat: 200, trust: 99, debt: 999 },
    ])),
  });

  assert.equal(normalized.floors[FloorLevel.LIVING]?.lastTickAt, 12);
  assert.equal((normalized.floors as Record<string, unknown>)['99'], undefined);
  assert.equal((normalized.floors as Record<string, unknown>).bad, undefined);
  assert.equal(Object.keys(normalized.routes).length, ECONOMY_ROUTE_STATE_CAP);
  assert.equal(normalized.routes.route_0.routeId, 'route_0');
  assert.equal(normalized.routes.route_0.heat, 100);
  assert.equal(normalized.routes.route_0.trust, 5);
  assert.equal(normalized.routes.route_0.debt, 300);
});

test('economy save normalization fills missing floors and drops unknown resources', () => {
  const state = makeGameState({ currentFloor: FloorLevel.KVARTIRY });

  normalizeGameEconomy(state, {
    priceVersion: 9,
    floors: {
      [FloorLevel.LIVING]: {
        floor: FloorLevel.LIVING,
        resources: {
          unknown_resource: { stock: 999, target: 999, lastDelta: 0 },
          food: { stock: 20, target: 140, lastDelta: -4 },
        },
        lastTickAt: 77,
      },
    },
  });

  const saved = economyForSave(state);
  const living = saved.floors[FloorLevel.LIVING]!;
  const current = saved.floors[FloorLevel.KVARTIRY]!;
  assert.equal(saved.priceVersion, 9);
  assert.ok(living, 'saved living economy should exist');
  assert.ok(current, 'current floor economy should be created lazily');
  assert.equal('unknown_resource' in living.resources, false);
  assert.equal(living.resources.food.stock, 20);
  assert.equal(current.floor, FloorLevel.KVARTIRY);
});

test('economy resource spending clamps stock and affects item prices', () => {
  const state = makeGameState({ time: 100, currentFloor: FloorLevel.LIVING });
  const economy = ensureEconomyState(state);
  economy.floors[FloorLevel.LIVING] = createEconomyFloorState(FloorLevel.LIVING);

  assert.equal(changeResourceStock(state, 'drink_water', -119), true);
  assert.equal(getResourceScarcity(state, 'drink_water'), 2.7);
  assert.equal(getAdjustedItemPrice(state, 'water'), 6);
  assert.equal(spendResources(state, [{ id: 'drink_water', count: 2 }]), false);
  assert.equal(spendResources(state, [{ id: 'drink_water', count: 1 }]), true);
  assert.equal(getResourceScarcity(state, 'drink_water'), 2.7);
});

test('critical survival scarcity caps price pressure and contract rewards', () => {
  const state = makeGameState({ time: 300, currentFloor: FloorLevel.KVARTIRY });
  const economy = ensureEconomyState(state);
  economy.floors[FloorLevel.KVARTIRY] = createEconomyFloorState(FloorLevel.KVARTIRY);

  assert.equal(changeResourceStock(state, 'drink_water', -119), true);
  const quote = getEconomyQuote(state, 'water', { tariffMultiplier: 6, reason: 'test_tariff_spike' });

  assert.equal(quote.scarcityMultiplier, 2.7);
  assert.equal(quote.buyPrice, 7);
  assert.equal(quote.tags.includes('price_cap'), true);
  assert.equal(quote.reason.includes('price_pressure_cap'), true);
  assert.equal(getScarcityAdjustedReward(
    state,
    'drink_water',
    100,
    FloorLevel.KVARTIRY,
    3,
    { level: 1, xp: 0, attrPoints: 0, str: 0, agi: 0, int: 99, psi: 0, maxPsi: 0 },
  ), 280);
});

test('economy price cache invalidates when stock changes and debug summary stays bounded', () => {
  const state = makeGameState({ time: 200, currentFloor: FloorLevel.LIVING });
  const economy = ensureEconomyState(state);
  economy.floors[FloorLevel.LIVING] = createEconomyFloorState(FloorLevel.LIVING);

  const baseWaterPrice = getAdjustedItemPrice(state, 'water');
  assert.equal(changeResourceStock(state, 'drink_water', -60), true);
  assert.ok(getAdjustedItemPrice(state, 'water') > baseWaterPrice);

  const lines = summarizeEconomy(state, 3);
  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes('Питьевая вода'));
  assert.ok(lines.every(line => line.includes(' x')));
});

test('samosbor director registry ignores duplicate beat ids', () => {
  const before = getSamosborBeatDefs().length;
  const duplicate = getSamosborBeatDefs()[0];
  assert.ok(duplicate);
  const originalWarn = console.warn;
  let warning = '';

  try {
    console.warn = (message?: unknown): void => { warning = String(message); };
    registerSamosborBeat({ ...duplicate });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(getSamosborBeatDefs().length, before);
  assert.ok(warning.includes('duplicate beat id'));
});

test('samosbor director cadence, beat cooldowns, and events stay bounded', () => {
  const state = makeGameState({
    time: 100,
    currentFloor: FloorLevel.LIVING,
    samosborActive: true,
    samosborCount: 2,
    worldEvents: createWorldEventState(),
  });
  const world = testDirectorWorld();
  const player = makeTestEntity({ id: 0, x: 10.5, y: 10.5 });
  const entities = [player];
  const nextId = { v: 100 };
  const variant = testClassicSamosborVariant();
  const originalRandom = SeedRng.prototype.random;

  try {
    SeedRng.prototype.random = () => 0;
    const first = tickSamosborDirector(world, entities, state, nextId, variant, 'active_cadence');
    assert.equal(first.fired, true);
    assert.equal(first.beatId, 'active_floor_fog_residue');

    const firstEvent = getRecentEvents(state, { tags: ['samosbor', 'director'], limit: 1 })[0];
    assert.ok(firstEvent);
    assert.equal(firstEvent.data?.beatId, 'active_floor_fog_residue');
    assert.equal(firstEvent.data?.phase, 'active');
    assert.equal(firstEvent.data?.cycle, 2);
    assert.equal(firstEvent.data?.dangerBudget, 2);

    const duplicate = tickSamosborDirector(world, entities, state, nextId, variant, 'active_cadence');
    assert.equal(duplicate.fired, false);
    assert.equal(duplicate.reasonCode, 'cadence_cooldown');
    assert.equal(getRecentEvents(state, { tags: ['samosbor', 'director'] }).length, 1);

    state.time = 112;
    const second = tickSamosborDirector(world, entities, state, nextId, variant, 'active_cadence');
    assert.equal(second.fired, true);
    assert.equal(second.beatId, 'active_liquidator_patrol');

    const trace = getSamosborDirectorTrace(state, 1)[0];
    assert.equal(trace.chosenBeatId, 'active_liquidator_patrol');
    assert.equal(trace.rejectedTopBeatId, 'active_floor_fog_residue');
    assert.equal(trace.rejectedReason, 'cooldown');
    assert.ok(trace.legalCount >= 1);
  } finally {
    SeedRng.prototype.random = originalRandom;
  }
});

test('active maronary door malfunction ignores protected hermetic doors', () => {
  const state = makeGameState({
    time: 100,
    currentFloor: FloorLevel.LIVING,
    samosborActive: true,
    samosborCount: 3,
    worldEvents: createWorldEventState(),
  });
  const world = testDirectorWorld();
  const doorIdx = world.idx(10, 10);
  world.cells[doorIdx] = Cell.DOOR;
  world.aptMask[doorIdx] = 1;
  world.hermoWall[doorIdx] = 1;
  world.doors.set(doorIdx, { idx: doorIdx, state: DoorState.HERMETIC_OPEN, roomA: 0, roomB: -1, keyId: '', timer: 0 });
  const player = makeTestEntity({ id: 0, x: 10.5, y: 10.5 });
  const nextId = { v: 100 };
  const originalRandom = Math.random;

  try {
    Math.random = () => 0;
    const result = tickSamosborDirector(world, [player], state, nextId, testMaronarySamosborVariant(), 'active_cadence');

    assert.equal(result.fired, true);
    assert.equal(result.beatId, 'active_maronary_wrong_door');
    assert.equal(world.doors.get(doorIdx)?.state, DoorState.HERMETIC_OPEN);
    const event = getRecentEvents(state, { tags: ['samosbor', 'director'], limit: 1 })[0];
    assert.ok(event);
    assert.equal(event.data?.doors, 0);
  } finally {
    Math.random = originalRandom;
  }
});

test('container take/put refuses full targets without changing source counts', () => {
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const fullPlayer = makeTestEntity({
    inventory: Array.from({ length: MAX_INVENTORY_SLOTS }, () => ({ defId: 'bread', count: getStack(ITEMS.bread) })),
  });
  const waterBox = makeTestContainer({ inventory: [{ defId: 'water', count: 1 }] });

  assert.equal(takeFromContainer(waterBox, fullPlayer, 0, 1, state), false);
  assert.equal(waterBox.inventory[0].count, 1);
  assert.equal(fullPlayer.inventory?.length, MAX_INVENTORY_SLOTS);

  const donor = makeTestEntity({ inventory: [{ defId: 'water', count: 1 }] });
  const fullBox = makeTestContainer({ inventory: Array.from({ length: MAX_INVENTORY_SLOTS }, () => ({ defId: 'bread', count: getStack(ITEMS.bread) })) });

  assert.equal(putIntoContainer(fullBox, donor, 0, 1), false);
  assert.deepEqual(donor.inventory, [{ defId: 'water', count: 1 }]);
  assert.deepEqual(fullBox.inventory, Array.from({ length: MAX_INVENTORY_SLOTS }, () => ({ defId: 'bread', count: getStack(ITEMS.bread) })));
});

test('container put moves exactly one selected stack unit', () => {
  const actor = makeTestEntity({ inventory: [{ defId: 'water', count: 2 }] });
  const box = makeTestContainer({ inventory: [{ defId: 'water', count: 1 }] });

  assert.equal(putIntoContainer(box, actor, 0, 1), true);
  assert.deepEqual(actor.inventory, [{ defId: 'water', count: 1 }]);
  assert.deepEqual(box.inventory, [{ defId: 'water', count: 2 }]);
});

test('witnessed container theft marks audit, memory, event context, and faction pressure once', () => {
  initFactionRelations();
  const state = makeGameState({
    time: 345,
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  });
  const world = new World();
  addTestRoom(world, {
    type: RoomType.STORAGE,
    x: 10, y: 10, w: 6, h: 6,
    name: 'Тестовый склад',
  });

  const player = makeTestEntity({ id: 0, x: 11, y: 11, faction: Faction.PLAYER });
  const witness = makeTestEntity({
    id: 77,
    type: EntityType.NPC,
    x: 12.5,
    y: 12.5,
    name: 'Свидетель',
    faction: Faction.CITIZEN,
    inventory: [],
  });
  const box = makeTestContainer({
    id: 22,
    x: 12,
    y: 12,
    roomId: 0,
    zoneId: 0,
    access: 'faction',
    faction: Faction.CITIZEN,
    inventory: [{ defId: 'water', count: 2 }],
    capacitySlots: 4,
    tags: ['food'],
  });
  world.addContainer(box);

  assert.equal(takeFromContainer(box, player, 0, 1, { state, world, entities: [player, witness] }), true);

  const event = getRecentEvents(state, { type: 'item_stolen', limit: 1 })[0];
  assert.equal(event.privacy, 'witnessed');
  assert.equal(event.severity, 5);
  assert.equal(event.data?.witnessCount, 1);
  assert.deepEqual(event.data?.witnessIds, [77]);
  assert.equal(box.lastAuditAt, 345);
  assert.deepEqual(box.stolenItemIds, ['water']);
  assert.equal(getNpcMemory(witness, state.time).hurtByPlayer, 1);
  assert.equal(getNpcMemory(witness, state.time).trustPlayer, -14);
  assert.equal(getFactionRel(Faction.CITIZEN, Faction.PLAYER), 46);
  assert.equal(player.karma, -3);
});

test('unseen container theft stays private until a nearby owner faction audit', () => {
  initFactionRelations();
  const state = makeGameState({
    time: 10,
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  });
  const world = new World();
  addTestRoom(world, {
    type: RoomType.STORAGE,
    x: 10, y: 10, w: 6, h: 6,
    name: 'Тестовый склад',
  });

  const player = makeTestEntity({
    id: 0,
    x: 11,
    y: 11,
    faction: Faction.PLAYER,
    inventory: [{ defId: 'bread', count: 1 }],
  });
  const auditor = makeTestEntity({
    id: 88,
    type: EntityType.NPC,
    x: 13.5,
    y: 12.5,
    name: 'Ревизор',
    faction: Faction.CITIZEN,
    inventory: [],
  });
  const box = makeTestContainer({
    id: 23,
    x: 12,
    y: 12,
    roomId: 0,
    zoneId: 0,
    access: 'faction',
    faction: Faction.CITIZEN,
    inventory: [{ defId: 'water', count: 2 }],
    capacitySlots: 4,
    tags: ['food'],
  });
  world.addContainer(box);

  assert.equal(takeFromContainer(box, player, 0, 1, { state, world, entities: [player] }), true);

  const unseen = getRecentEvents(state, { type: 'item_stolen', limit: 1 })[0];
  assert.equal(unseen.privacy, 'private');
  assert.equal(unseen.severity, 2);
  assert.equal(unseen.data?.theftOutcome, 'unseen');
  assert.equal(box.lastAuditAt, undefined);
  assert.deepEqual(box.stolenItemIds, ['water']);
  assert.equal(getFactionRel(Faction.CITIZEN, Faction.PLAYER), 50);
  assert.equal(player.karma, -2);

  state.time += 121;
  assert.equal(putIntoContainer(box, player, 0, 1, { state, world, entities: [player, auditor] }), true);

  const audit = getRecentEvents(state, { type: 'item_stolen', tags: ['audit'], limit: 1 })[0];
  assert.ok(audit);
  assert.equal(audit.privacy, 'local');
  assert.equal(audit.severity, 4);
  assert.equal(audit.data?.auditOnly, true);
  assert.equal(audit.data?.auditorCount, 1);
  assert.deepEqual(audit.data?.auditorIds, [88]);
  assert.equal(box.lastAuditAt, 131);
  assert.equal(getNpcMemory(auditor, state.time).hurtByPlayer, 1);
  assert.equal(getNpcMemory(auditor, state.time).trustPlayer, -8);
  assert.equal(getFactionRel(Faction.CITIZEN, Faction.PLAYER), 48);
});

test('container audit tick surfaces unseen owner theft without reopening the box', () => {
  initFactionRelations();
  const state = makeGameState({
    time: 20,
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  });
  const world = new World();
  addTestRoom(world, {
    type: RoomType.STORAGE,
    x: 10, y: 10, w: 6, h: 6,
    name: 'Чужая кладовка',
  });

  const player = makeTestEntity({ id: 0, x: 11, y: 11, faction: Faction.PLAYER });
  const owner = makeTestEntity({
    id: 66,
    type: EntityType.NPC,
    x: 13.5,
    y: 12.5,
    name: 'Хозяин ящика',
    faction: Faction.CITIZEN,
    inventory: [],
  });
  const box = makeTestContainer({
    id: 24,
    x: 12,
    y: 12,
    roomId: 0,
    zoneId: 0,
    access: 'owner',
    ownerNpcId: owner.id,
    ownerName: owner.name,
    faction: Faction.CITIZEN,
    inventory: [{ defId: 'water', count: 1 }],
    capacitySlots: 4,
    tags: ['food'],
  });
  world.addContainer(box);

  assert.equal(takeFromContainer(box, player, 0, 1, { state, world, entities: [player] }), true);
  assert.equal(getRecentEvents(state, { type: 'item_stolen', tags: ['audit'], limit: 1 }).length, 0);

  state.time += 121;
  assert.equal(tickContainerAudits(state, world, player, [player, owner], 1), 1);
  assert.equal(tickContainerAudits(state, world, player, [player, owner], 1), 0);

  const audit = getRecentEvents(state, { type: 'item_stolen', tags: ['audit'], limit: 1 })[0];
  assert.ok(audit);
  assert.equal(audit.targetId, owner.id);
  assert.equal(audit.privacy, 'local');
  assert.equal(audit.data?.auditOnly, true);
  assert.deepEqual(audit.data?.auditorIds, [66]);
  assert.equal(box.lastAuditAt, 141);
  assert.equal(getNpcMemory(owner, state.time).trustPlayer, -8);
  assert.equal(getFactionRel(Faction.CITIZEN, Faction.PLAYER), 48);
  assert.match(state.msgLog.at(-1)?.text ?? '', /Ревизия выявила кражу/);
});

test('saved containers outside regenerated topology are dropped on restore', () => {
  const world = new World();
  addTestRoom(world, {
    type: RoomType.STORAGE,
    x: 10, y: 10, w: 5, h: 5,
    name: 'Тестовый склад',
  });

  const restored = restoreValidContainers(world, FloorLevel.LIVING, [
    {
      ...makeTestContainer({ id: 11, x: 11, y: 11, roomId: 0, zoneId: 0, capacitySlots: 0, inventory: [{ defId: 'water', count: 2 }] }),
      access: 'invalid',
    },
    makeTestContainer({ id: 12, x: 50, y: 50, roomId: 0, zoneId: 0, capacitySlots: 4, inventory: [{ defId: 'bread', count: 1 }] }),
  ]);

  assert.equal(restored, 1);
  assert.equal(world.containers.length, 1);
  assert.equal(world.containers[0].id, 11);
  assert.equal(world.containers[0].capacitySlots, 8);
  assert.equal(world.containers[0].access, 'public');
  assert.equal(world.containerById.has(11), true);
  assert.equal(world.containerById.has(12), false);
});

test('production state cannot write output into another floor container id', () => {
  const state = makeGameState({
    currentFloor: FloorLevel.KVARTIRY,
    time: 1000,
    worldEvents: createWorldEventState(),
  });
  (state as typeof state & { production: ProductionState[] }).production = [{
    floor: FloorLevel.LIVING,
    roomId: 7,
    factoryId: 'metal_shop',
    recipeId: 'cut_pipe',
    progressSec: 0,
    nextTickAt: 0,
    outputContainerId: 1,
  }];

  const world = new World();
  addTestRoom(world, {
    id: 7,
    type: RoomType.COMMON,
    x: 8, y: 8, w: 6, h: 6,
    name: 'Тестовая комната другого этажа',
  });
  const box = makeTestContainer({
    id: 1,
    floor: FloorLevel.KVARTIRY,
    roomId: 7,
    zoneId: 0,
    inventory: [],
    capacitySlots: 4,
    tags: ['tools'],
  });
  world.addContainer(box);

  assert.equal(tickProduction(state, world, true), 0);
  assert.deepEqual(box.inventory, []);
});

test('production room registration replaces stale current-floor output containers', () => {
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    time: 1000,
    worldEvents: createWorldEventState(),
  });
  (state as typeof state & { production: ProductionState[] }).production = [{
    floor: FloorLevel.LIVING,
    roomId: 0,
    factoryId: 'metal_shop',
    recipeId: 'cut_pipe',
    progressSec: 0,
    nextTickAt: 0,
    outputContainerId: 999,
  }];

  const world = new World();
  addTestRoom(world, {
    type: RoomType.PRODUCTION,
    x: 10, y: 10, w: 7, h: 7,
    name: 'Цех металла',
    wallTex: Tex.METAL,
  });

  ensureProductionRooms(state, world);

  const production = (state as typeof state & { production: ProductionState[] }).production;
  assert.equal(production.length, 1);
  assert.notEqual(production[0].outputContainerId, 999);
  assert.equal(world.containerById.has(production[0].outputContainerId), true);
  assert.equal(world.containerById.get(production[0].outputContainerId)?.roomId, 0);
});

test('nearby production output marks container and reaches world log', () => {
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    time: 1000,
    worldEvents: createWorldEventState(),
  });
  const world = new World();
  addTestRoom(world, {
    type: RoomType.PRODUCTION,
    x: 10, y: 10, w: 7, h: 7,
    name: 'Цех металла',
    wallTex: Tex.METAL,
  });
  const player = makeTestEntity({ id: 0, x: 13, y: 13 });

  assert.equal(tickProduction(state, world, true, player), 1);
  const output = world.containers.find(c => c.tags.includes('production_output'));
  assert.ok(output);
  assert.equal(output.factoryId, 'metal_shop');
  assert.equal(output.lastProducedItemId, 'pipe');
  assert.equal(getRecentEvents(state, { type: 'room_produced_items', limit: 1 })[0]?.severity, 3);
  assert.ok(state.msgLog.some(entry => entry.text.includes('Цех выдал')));
});

test('slime furnace consumes a sample and alkali before producing cleanup output', () => {
  const state = makeGameState({
    currentFloor: FloorLevel.MAINTENANCE,
    time: 1000,
    worldEvents: createWorldEventState(),
  });
  const world = new World();
  addTestRoom(world, {
    type: RoomType.PRODUCTION,
    x: 10, y: 10, w: 7, h: 7,
    name: 'Печь деактивации слизи',
    wallTex: Tex.PIPE,
    zoneFaction: ZoneFaction.LIQUIDATOR,
  });
  world.addContainer(makeTestContainer({
    id: 1,
    x: 12,
    y: 12,
    floor: FloorLevel.MAINTENANCE,
    roomId: 0,
    zoneId: 0,
    inventory: [{ defId: 'slime_sample_brown', count: 1 }, { defId: 'alkali_powder', count: 1 }],
    capacitySlots: 4,
    tags: ['cleanup', 'slime'],
  }));

  assert.equal(tickProduction(state, world, true), 1);
  const output = world.containerById.get(1);
  assert.ok(output);
  assert.equal(output.inventory.some(item => item.defId === 'slime_sample_brown'), false);
  assert.equal(output.inventory.some(item => item.defId === 'alkali_powder'), false);
  assert.equal(output.inventory.find(item => item.defId === 'deactivated_residue')?.count, 2);
  assert.equal(output.inventory.find(item => item.defId === 'gasmask_filter')?.count, 1);
  assert.equal(output.inventory.find(item => item.defId === 'sealant_tube')?.count, 1);
  const event = getRecentEvents(state, { type: 'room_produced_items', limit: 1 })[0];
  assert.ok(event.tags.includes('furnace_used'));
  assert.ok(event.tags.includes('deactivation_completed'));
  assert.ok(event.tags.includes('sealant_issue'));
  assert.ok(event.tags.includes('alkali'));
  assert.deepEqual(event.data?.inputItemIds, ['slime_sample_brown', 'alkali_powder']);
});

test('illegal ammo smelter consumes contested metal input before producing 9mm', () => {
  const state = makeGameState({
    currentFloor: FloorLevel.KVARTIRY,
    time: 1000,
    worldEvents: createWorldEventState(),
  });
  const world = new World();
  addTestRoom(world, {
    type: RoomType.PRODUCTION,
    x: 10, y: 10, w: 7, h: 7,
    name: 'Гильзоплавка тестовая',
    wallTex: Tex.METAL,
    zoneFaction: ZoneFaction.WILD,
  });
  world.addContainer(makeTestContainer({
    id: 1,
    x: 12,
    y: 12,
    floor: FloorLevel.KVARTIRY,
    roomId: 0,
    zoneId: 0,
    kind: ContainerKind.WEAPON_CRATE,
    name: 'Горячий ящик гильзоплавки',
    inventory: [{ defId: 'ammo_9mm', count: 4 }],
    capacitySlots: 5,
    access: 'owner',
    faction: Faction.WILD,
    tags: ['kv_ammo_smelter', 'ammo', 'weapon', 'illegal', 'production_output', 'contested_output', 'repair_input'],
  }));

  assert.equal(tickProduction(state, world, true), 0);
  const shortage = getRecentEvents(state, { type: 'room_lacked_resources', limit: 1 })[0];
  assert.ok(shortage);
  assert.ok(shortage.tags.includes('metal_sheet_missing'));
  assert.ok(shortage.tags.includes('repair_input'));
  assert.deepEqual(shortage.data?.missingItems, ['metal_sheet', 'homemade_ammo_instruction']);

  const hotBox = world.containerById.get(1);
  assert.ok(hotBox);
  hotBox.inventory.push({ defId: 'metal_sheet', count: 1 });
  hotBox.inventory.push({ defId: 'homemade_ammo_instruction', count: 1 });

  assert.equal(tickProduction(state, world, true), 1);
  assert.equal(hotBox.inventory.some(item => item.defId === 'metal_sheet'), false);
  assert.equal(hotBox.inventory.find(item => item.defId === 'homemade_ammo_instruction')?.count, 1);
  assert.equal(hotBox.inventory.find(item => item.defId === 'ammo_9mm')?.count, 10);
  const output = getRecentEvents(state, { type: 'room_produced_items', limit: 1 })[0];
  assert.ok(output);
  assert.ok(output.tags.includes('illegal_ammo_smelter'));
  assert.ok(output.tags.includes('homemade'));
  assert.ok(output.tags.includes('contested_output'));
  assert.deepEqual(output.data?.inputItemIds, ['metal_sheet', 'homemade_ammo_instruction']);
});

test('contract spawn creates a normal quest and contract event', () => {
  const state = makeGameState({ clock: { hour: 10, minute: 0, totalMinutes: 120 }, worldEvents: createWorldEventState() });

  assert.equal(spawnContract(state), true);
  assert.equal(state.quests.length, 1);
  assert.ok(state.quests[0].contractId);
  assert.ok((state.quests[0].timeLimitMinutes ?? 0) >= 60);
  assert.ok((state.quests[0].expiresAtMinutes ?? 0) > state.clock.totalMinutes);
  assert.equal(getRecentEvents(state, { type: 'contract_created', limit: 1 })[0]?.data?.contractId, state.quests[0].contractId);
});

test('NPC assignment offer can use contract templates as timed contract quests', () => {
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const world = new World();
  addTestRoom(world, {
    type: RoomType.OFFICE,
    x: 8, y: 8, w: 6, h: 6,
    name: 'Тестовая контора',
  });
  const npc = makeTestEntity({
    id: 42,
    type: EntityType.NPC,
    x: 10,
    y: 10,
    name: 'Кладовщик Тестов',
    faction: Faction.CITIZEN,
    occupation: Occupation.STOREKEEPER,
    canGiveQuest: true,
  });
  const player = makeTestEntity({ id: 0, x: 11, y: 10 });
  const originalRandom = Math.random;

  try {
    Math.random = () => 0;
    offerQuest(npc, player, world, [player, npc], state, state.msgs);
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(state.quests.length, 1);
  assert.ok(state.quests[0].contractId);
  assert.ok((state.quests[0].timeLimitMinutes ?? 0) >= 60);
  assert.ok((state.quests[0].expiresAtMinutes ?? 0) > state.clock.totalMinutes);
  assert.equal(npc.questId, state.quests[0].id);
  assert.equal(getRecentEvents(state, { type: 'contract_created', limit: 1 })[0]?.data?.contractId, state.quests[0].contractId);
});

test('procedural quest offers have no global active quest cap', () => {
  const state = makeGameState({ worldEvents: createWorldEventState() });
  state.quests = Array.from({ length: 12 }, (_, i) => ({
    id: 100 + i,
    type: QuestType.FETCH,
    giverId: 100 + i,
    giverName: `NPC ${i}`,
    desc: 'Старое процедурное задание',
    targetItem: 'bread',
    targetCount: 1,
    done: false,
  }));
  const world = new World();
  addTestRoom(world, {
    type: RoomType.OFFICE,
    x: 8, y: 8, w: 6, h: 6,
    name: 'Тестовая контора',
  });
  const npc = makeTestEntity({
    id: 42,
    type: EntityType.NPC,
    x: 10,
    y: 10,
    name: 'Безлимитный диспетчер',
    faction: Faction.CITIZEN,
    occupation: Occupation.STOREKEEPER,
    canGiveQuest: true,
  });
  const player = makeTestEntity({ id: 0, x: 11, y: 10 });
  const originalRandom = Math.random;

  try {
    Math.random = () => 0;
    offerQuest(npc, player, world, [player, npc], state, state.msgs);
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(state.quests.length, 13);
  assert.equal(npc.questId, state.quests[12].id);
});

test('procedural fetch quests do not target story-critical main plot items', () => {
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const world = new World();
  const npc = makeTestEntity({
    id: 42,
    type: EntityType.NPC,
    x: 10,
    y: 10,
    name: 'Культист заявочный',
    faction: Faction.CULTIST,
    canGiveQuest: true,
  });
  const player = makeTestEntity({ id: 0, x: 11, y: 10 });
  const randoms = [0.99, 0, 0];
  const originalRandom = Math.random;

  try {
    Math.random = () => randoms.shift() ?? 0;
    offerQuest(npc, player, world, [player, npc], state, state.msgs);
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(state.quests.length, 1);
  assert.equal(state.quests[0].type, QuestType.FETCH);
  assert.notEqual(state.quests[0].targetItem, 'idol_chernobog');
  assert.notEqual(state.quests[0].targetItem, 'strange_clot');
  assert.equal(state.quests[0].targetItem, 'cigs');
});

test('timed procedural quests fail when their deadline passes', () => {
  const state = makeGameState({ clock: { hour: 8, minute: 0, totalMinutes: 0 }, worldEvents: createWorldEventState() });
  const player = makeTestEntity({ id: 0 });
  const world = new World();

  assert.equal(spawnContract(state), true);
  const q = state.quests[0];
  q.expiresAtMinutes = 1;
  state.clock.totalMinutes = 2;

  checkQuests(player, world, [player], state, state.msgs);

  assert.equal(q.done, true);
  assert.equal(q.failed, true);
  assert.equal(getRecentEvents(state, { type: 'contract_failed', limit: 1 })[0]?.data?.reason, 'deadline');
});

test('hand-authored quests without explicit deadlines ignore stale expiry payloads', () => {
  const state = makeGameState({ clock: { hour: 8, minute: 0, totalMinutes: 120 }, worldEvents: createWorldEventState() });
  const player = makeTestEntity({ id: 0 });
  const world = new World();
  state.quests.push({
    id: 77,
    type: QuestType.FETCH,
    giverId: 10,
    giverName: 'Сюжетный тест',
    desc: 'Старый сюжетный срок из save не должен провалить квест',
    targetItem: 'unobtainium_test_item',
    targetCount: 1,
    plotStepIndex: 0,
    expiresAtMinutes: 1,
    done: false,
  });

  checkQuests(player, world, [player], state, state.msgs);

  assert.equal(state.quests[0].done, false);
  assert.equal(state.quests[0].expiresAtMinutes, undefined);
  assert.equal(getRecentEvents(state, { type: 'quest_failed', limit: 1 }).length, 0);
});

test('timed authored quests missing absolute expiry are repaired and can expire later', () => {
  const state = makeGameState({ clock: { hour: 9, minute: 0, totalMinutes: 100 }, worldEvents: createWorldEventState() });
  const player = makeTestEntity({ id: 0 });
  const world = new World();
  state.quests.push({
    id: 78,
    type: QuestType.FETCH,
    giverId: 11,
    giverName: 'Срочный тест',
    desc: 'Явно срочный side quest из старого save получает абсолютный срок',
    targetItem: 'unobtainium_test_item',
    targetCount: 1,
    sideQuestId: 'timed_authored_test',
    timeLimitMinutes: 30,
    done: false,
  });

  checkQuests(player, world, [player], state, state.msgs);

  const q = state.quests[0];
  assert.equal(q.done, false);
  assert.equal(q.expiresAtMinutes, 130);
  assert.equal(questRemainingMinutes(q, state.clock.totalMinutes), 30);

  state.clock.totalMinutes = 131;
  checkQuests(player, world, [player], state, state.msgs);

  assert.equal(q.done, true);
  assert.equal(q.failed, true);
  assert.equal(getRecentEvents(state, { type: 'quest_failed', limit: 1 })[0]?.data?.reason, 'deadline');
});

test('saved procedural quests without deadlines get a fair visible deadline on quest tick', () => {
  const state = makeGameState({ clock: { hour: 12, minute: 0, totalMinutes: 500 }, worldEvents: createWorldEventState() });
  const player = makeTestEntity({ id: 0 });
  const world = new World();
  state.quests.push({
    id: 79,
    type: QuestType.FETCH,
    giverId: 12,
    giverName: 'Процедурный тест',
    desc: 'Старое процедурное поручение без срока',
    targetItem: 'unobtainium_test_item',
    targetCount: 1,
    done: false,
  });

  checkQuests(player, world, [player], state, state.msgs);

  const q = state.quests[0];
  assert.equal(q.done, false);
  assert.ok((q.timeLimitMinutes ?? 0) >= 60);
  assert.ok((q.expiresAtMinutes ?? 0) > state.clock.totalMinutes);
  assert.equal(getRecentEvents(state, { type: 'quest_failed', limit: 1 }).length, 0);
});

function testDirectorWorld(): World {
  const world = new World();
  addTestRoom(world, {
    type: RoomType.COMMON,
    x: 0, y: 0, w: 32, h: 32,
    name: 'Тестовый коридор директора',
  });
  world.zones[0].cx = 10;
  world.zones[0].cy = 10;
  return world;
}

function testSamosborVariant(id: 'classic' | 'maronary'): ActiveSamosborVariant {
  const def = SAMOSBOR_VARIANTS.find(v => v.id === id);
  assert.ok(def);
  return {
    def,
    modifiers: [],
    durationMult: def.durationMult,
    spawnMult: def.spawnMult,
    fogSeedMult: 1,
    fogSpawnIntervalMult: 1,
    sealTimingDelta: def.sealTimingDelta,
    noSiren: false,
    extraEyes: 0,
    shelterRoomCount: 0,
    fogColor: def.fogColor,
  };
}

function testClassicSamosborVariant(): ActiveSamosborVariant {
  return testSamosborVariant('classic');
}

function testMaronarySamosborVariant(): ActiveSamosborVariant {
  return testSamosborVariant('maronary');
}
