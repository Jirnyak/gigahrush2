import test from 'node:test';
import assert from 'node:assert/strict';

import { Faction, FloorLevel, Occupation, QuestType, RoomType, type WorldEvent } from '../src/core/types';
import type { ContractDef } from '../src/data/contracts';
import { contractToQuest } from '../src/data/contracts';
import { DEMOS_QUEST_NOTICE_CAP } from '../src/data/demos_quest_notices';
import {
  ensureDemosQuestNoticeForProfile,
  getDemosQuestBoardView,
  getDemosQuestNoticesForProfile,
  recordDemosNoticeQuestCreated,
  recordDemosNoticeQuestCreatedForGiver,
  refreshDemosQuestNoticesFromSnapshots,
  renderDemosQuestNoticeSpeech,
  selectDemosProceduralQuestNotice,
  upsertDemosQuestNotice,
} from '../src/systems/demos_quest_notices';
import { createPrefilledAlifeState, type AlifeNpcSnapshot } from '../src/systems/alife';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { floorKeyForFloorInstance, floorKeyForStory } from '../src/systems/floor_keys';
import { findDemosCursor, getDemosSnapshot } from '../src/systems/demos';
import { makeGameState } from './helpers';

const livingKey = floorKeyForStory(FloorLevel.LIVING);

const supplyContract: ContractDef = {
  id: 'test_demos_supply_water',
  title: 'Вода в общий список',
  issuer: 'Дежурный по кухне',
  faction: Faction.CITIZEN,
  rank: 1,
  type: QuestType.FETCH,
  desc: 'Нужна вода для общего списка у кухни.',
  targetItem: 'water',
  targetCount: 2,
  target: {
    floor: FloorLevel.LIVING,
    roomType: RoomType.KITCHEN,
    zoneTag: 'ration_queue',
    hint: 'Жилая зона: кухня у общего списка.',
  },
  moneyReward: 40,
  xpReward: 20,
  relationDelta: 5,
  tags: ['supply', 'food', 'fetch'],
};

const repairContract: ContractDef = {
  id: 'test_demos_repair_pipe',
  title: 'Труба у гермы',
  issuer: 'Слесарь смены',
  faction: Faction.CITIZEN,
  rank: 2,
  type: QuestType.VISIT,
  desc: 'Нужно проверить трубу у гермы до обхода.',
  target: {
    floor: FloorLevel.MAINTENANCE,
    route: { z: -12, label: 'служебный стояк', risk: 3, tags: ['maintenance'] },
    roomType: RoomType.PRODUCTION,
    zoneTag: 'pipe',
    hint: 'Коллекторы: служебный стояк и мокрый щиток.',
  },
  moneyReward: 80,
  xpReward: 40,
  relationDelta: 6,
  tags: ['maintenance', 'repair', 'route'],
};

function snapshot(overrides: Partial<AlifeNpcSnapshot> = {}): AlifeNpcSnapshot {
  return {
    id: 1,
    floorKey: livingKey,
    floor: FloorLevel.LIVING,
    faction: Faction.CITIZEN,
    occupation: Occupation.COOK,
    name: 'Анна Заявкина',
    female: true,
    level: 4,
    hp: 20,
    maxHp: 20,
    money: 30,
    accountRubles: 100,
    familyId: 10,
    canGiveQuest: true,
    karma: 0,
    dead: false,
    ...overrides,
  };
}

function event(overrides: Partial<WorldEvent> = {}): WorldEvent {
  return {
    id: 55,
    type: 'room_lacked_resources',
    time: 10,
    day: 0,
    hour: 8,
    minute: 10,
    floor: FloorLevel.LIVING,
    severity: 3,
    privacy: 'local',
    truth: 'fact',
    tags: ['supply', 'resource_shortage'],
    ...overrides,
  };
}

test('can build a Demos notice from a canGiveQuest A-Life snapshot', () => {
  const state = makeGameState();
  const notice = selectDemosProceduralQuestNotice(state, snapshot(), {
    nowMinutes: 120,
    seed: 17,
    sourceEvent: event(),
    contracts: [supplyContract],
  });

  assert.equal(notice?.giverAlifeId, 1);
  assert.equal(notice?.contractId, 'test_demos_supply_water');
  assert.equal(notice?.floorKey, livingKey);
  assert.equal(notice?.tags.includes('requires_visit'), true);
  assert.equal(state.quests.length, 0);
});

test('dead giver does not create a fresh accept-ready notice', () => {
  const state = makeGameState();
  const notice = selectDemosProceduralQuestNotice(state, snapshot({ dead: true, hp: 0 }), {
    contracts: [supplyContract],
  });

  assert.equal(notice, undefined);
});

test('Demos notices are capped and social ticks create at most two notices', () => {
  const state = makeGameState();
  for (let id = 1; id <= DEMOS_QUEST_NOTICE_CAP + 12; id++) {
    upsertDemosQuestNotice(state, {
      id,
      giverAlifeId: id,
      createdAt: id,
      floorKey: livingKey,
      templateId: `test:${id}`,
      tags: ['quest_notice'],
      urgency: 1,
    });
  }

  const board = getDemosQuestBoardView(state, { limit: DEMOS_QUEST_NOTICE_CAP });
  assert.equal(board.total, DEMOS_QUEST_NOTICE_CAP);

  const tickState = makeGameState();
  const created = refreshDemosQuestNoticesFromSnapshots(tickState, [
    snapshot({ id: 101 }),
    snapshot({ id: 102 }),
    snapshot({ id: 103 }),
  ], {
    seed: 33,
    contracts: [supplyContract],
  });
  assert.equal(created.length, 2);
  assert.equal(getDemosQuestBoardView(tickState, { limit: 10 }).total, 2);
});

test('Demos notice floor labels never expose raw floor keys', () => {
  const state = makeGameState();
  upsertDemosQuestNotice(state, {
    id: 1,
    giverAlifeId: 1,
    createdAt: 1,
    floorKey: floorKeyForFloorInstance('test_debug'),
    templateId: 'test:floor-instance',
    tags: ['quest_notice'],
    urgency: 1,
  });
  upsertDemosQuestNotice(state, {
    id: 2,
    giverAlifeId: 2,
    createdAt: 2,
    floorKey: 'unknown:raw_debug_key',
    templateId: 'test:unknown-floor',
    tags: ['quest_notice'],
    urgency: 1,
  });

  const labels = getDemosQuestBoardView(state, { limit: 10 }).notices.map(notice => notice.floorLabel);
  assert.deepEqual(labels, ['неуточненный этаж', 'маршрут без номера']);
  assert.equal(labels.some(label => label.includes(':') || label.includes('floor_instance') || label.includes('raw_debug_key')), false);
});

test('same seed and context selects the same notice deterministically', () => {
  const context = {
    nowMinutes: 480,
    seed: 'notice-seed',
    sourceEventId: 44,
    contracts: [repairContract],
  };
  const first = selectDemosProceduralQuestNotice(makeGameState(), snapshot({
    occupation: Occupation.LOCKSMITH,
    level: 20,
  }), context);
  const second = selectDemosProceduralQuestNotice(makeGameState(), snapshot({
    occupation: Occupation.LOCKSMITH,
    level: 20,
  }), context);

  assert.deepEqual(first, second);
});

test('notice profile view requires a face-to-face visit and does not accept from Demos', () => {
  const state = makeGameState();
  const notice = ensureDemosQuestNoticeForProfile(state, snapshot(), {
    seed: 10,
    contracts: [supplyContract],
  });

  assert.ok(notice);
  const views = getDemosQuestNoticesForProfile(state, 1);
  assert.equal(views.length, 1);
  assert.equal(views[0].requiresVisit, true);
  assert.equal(views[0].canAcceptHere, true);
  assert.match(views[0].detail, /поговорить/);
  assert.equal(state.quests.length, 0);
});

test('Demos profile exposes a quest notice section view model', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  createPrefilledAlifeState(state, 12345, 1, {
    buckets: [{
      floorKey: livingKey,
      floor: FloorLevel.LIVING,
      targetCount: 1,
      reserved: [{
        name: 'Анна Демосова',
        female: true,
        faction: Faction.CITIZEN,
        occupation: Occupation.COOK,
        canGiveQuest: true,
      }],
    }],
  });

  state.demosSearch = 'Анна';
  state.demosCursor = findDemosCursor(state, state.demosSearch, 0, 1);
  const cleanDemos = getDemosSnapshot(state, []);
  assert.equal(cleanDemos.profile?.questNotices.length ?? 0, 0);

  const notice = ensureDemosQuestNoticeForProfile(state, snapshot({
    name: 'Анна Демосова',
  }), {
    seed: 44,
    contracts: [supplyContract],
  });
  assert.ok(notice);
  const demos = getDemosSnapshot(state, []);

  assert.equal(demos.profile?.questSectionLabel, 'Квесты');
  assert.equal((demos.profile?.questNotices.length ?? 0) > 0, true);
  assert.equal(demos.profile?.questNotices[0].requiresVisit, true);
});

test('Demos notice speech keeps locked authored text exact', () => {
  const state = makeGameState();
  const notice = ensureDemosQuestNoticeForProfile(state, snapshot(), {
    seed: 9,
    contracts: [supplyContract],
  });
  assert.ok(notice);

  const locked = 'Вот Макаров. Стреляй. Следы от пуль видно.';
  const result = renderDemosQuestNoticeSpeech({ notice, lockedText: locked });

  assert.equal(result.text, locked);
  assert.equal(result.source, 'locked_author_text');
});

test('notice handoff event data carries compact A-Life and source ids', () => {
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const notice = ensureDemosQuestNoticeForProfile(state, snapshot(), {
    seed: 12,
    sourceEvent: event({ id: 77 }),
    sourcePostId: 5,
    contracts: [supplyContract],
  });
  assert.ok(notice);

  const quest = contractToQuest(supplyContract, 9, { id: 42, name: 'Анна Заявкина' });
  const created = recordDemosNoticeQuestCreated(state, notice.id, quest);

  assert.equal(created?.data?.giverAlifeId, 1);
  assert.equal(created?.data?.noticeId, notice.id);
  assert.equal(created?.data?.contractId, 'test_demos_supply_water');
  assert.equal(created?.data?.sourcePostId, 5);
  assert.equal(created?.data?.sourceEventId, 77);
  assert.equal(getRecentEvents(state, { type: 'contract_created', limit: 1 })[0]?.data?.giverAlifeId, 1);
  assert.equal(state.quests.length, 0);
});

test('notice handoff can resolve the active Demos notice from a face-to-face giver id', () => {
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const notice = ensureDemosQuestNoticeForProfile(state, snapshot(), {
    seed: 13,
    contracts: [supplyContract],
  });
  assert.ok(notice);

  const quest = contractToQuest(supplyContract, 11, { id: 42, name: 'Анна Заявкина' });
  const event = recordDemosNoticeQuestCreatedForGiver(state, 1, quest, {
    actorId: 42,
    actorName: 'Анна Заявкина',
  });

  assert.equal(event?.data?.giverAlifeId, 1);
  assert.equal(event?.data?.noticeId, notice.id);
  assert.equal(getDemosQuestNoticesForProfile(state, 1).length, 0);
});

test('notice selection does not access inactive floor geometry', () => {
  const state = makeGameState();
  Object.defineProperty(state, 'floorMemory', {
    get() {
      throw new Error('inactive geometry touched');
    },
  });

  assert.doesNotThrow(() => {
    selectDemosProceduralQuestNotice(state, snapshot(), {
      seed: 2,
      contracts: [supplyContract],
    });
  });
});
