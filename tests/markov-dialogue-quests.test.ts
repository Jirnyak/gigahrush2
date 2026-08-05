import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, Faction, FloorLevel, MonsterKind, Occupation, QuestType, RoomType, type Entity } from '../src/core/types';
import { type RumorDef } from '../src/data/rumors';
import { renderMarkovDialogueTalk, type MarkovAdapterSpeechRequest } from '../src/systems/markov_dialogue';
import { renderProceduralQuestSpeech } from '../src/systems/markov_procedural_quests';
import { renderMarkovRumorFlavor } from '../src/systems/markov_rumor';
import { type ContextSnapshot } from '../src/systems/context';

function npc(partial: Partial<Entity> = {}): Entity {
  return {
    id: 7,
    type: EntityType.NPC,
    x: 10,
    y: 10,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    name: 'Сосед',
    faction: Faction.CITIZEN,
    occupation: Occupation.HOUSEWIFE,
    ...partial,
  };
}

function snapshot(partial: Partial<ContextSnapshot> = {}): ContextSnapshot {
  return {
    floor: FloorLevel.LIVING,
    zoneId: 2,
    zoneFaction: undefined,
    zoneLevel: 1,
    roomType: RoomType.KITCHEN,
    roomName: 'Кухня у гермы',
    npcFaction: Faction.CITIZEN,
    npcOccupation: Occupation.HOUSEWIFE,
    npcNeeds: undefined,
    npcHpRatio: 1,
    playerDistance: 5,
    samosborActive: false,
    hasActiveContract: false,
    hasRecentPlayerTheft: false,
    hasRecentSamosborWarning: false,
    hasRecentMetroEvent: false,
    hasRecentLiftAnomaly: false,
    hasRecentFactionClash: false,
    hasRecentMonsterKill: false,
    hasRecentContainerOpen: false,
    roomMemoryBits: 0,
    roomMemorySeverity: 0,
    hasRoomMemoryTheft: false,
    hasRoomMemoryHelp: false,
    hasRoomMemoryInform: false,
    hasRoomMemoryCombat: false,
    hasRoomMemoryRepair: false,
    hasRoomMemorySamosbor: false,
    hasRecentSamosborAftermath: false,
    hasRecentProductionOutput: false,
    hasRecentProductionShortage: false,
    nearbyContainer: false,
    nearbyScreenRumorIds: [],
    nearbyProduction: false,
    isDangerousZone: false,
    isSafeOwnZone: true,
    isHungry: false,
    isThirsty: false,
    isTired: false,
    isWounded: false,
    isCritical: false,
    ...partial,
  };
}

test('authored plot lines pass through unchanged when locked', () => {
  const locked = 'Вот Макаров. Стреляй. Следы от пуль видно.';
  const result = renderMarkovDialogueTalk(npc({ plotNpcId: 'barni' }), snapshot(), {
    lockedText: locked,
    seed: 11,
  });

  assert.equal(result.text, locked);
  assert.equal(result.source, 'locked_author_text');
});

test('ordinary generated talk contains a context anchor', () => {
  const result = renderMarkovDialogueTalk(npc(), snapshot({ isHungry: true }), {
    seed: 12,
    repeatIndex: 0,
  });

  assert.equal(result.source, 'generated_markov');
  assert.match(result.text, /Кухня/);
});

test('rumor output preserves rumor id and selected facts', () => {
  const rumor: RumorDef = {
    id: 'test_bandage_lead',
    topic: 'rare_item',
    minTrust: 0,
    floors: [FloorLevel.LIVING],
    text: ['Бинт ищи там, где журнал чище рук.'],
    lead: {
      floor: FloorLevel.LIVING,
      roomType: RoomType.MEDICAL,
      itemId: 'bandage',
      action: 'спроси у медпункта и держи бинт сухим',
    },
  };

  const result = renderMarkovRumorFlavor({ rumor, snapshot: snapshot(), seed: 5 });

  assert.equal(result.rumorId, 'test_bandage_lead');
  assert.match(result.text, /бинт|Бинт/);
  assert.match(result.text, /Жилая зона/);
});

test('rumor output does not invent a different target, floor, or item', () => {
  const rumor: RumorDef = {
    id: 'test_water_living',
    topic: 'rare_item',
    minTrust: 0,
    floors: [FloorLevel.LIVING],
    text: ['Воду спрашивают у кухни, не у окна с печатью.'],
    lead: {
      floor: FloorLevel.LIVING,
      roomType: RoomType.KITCHEN,
      itemId: 'water',
      action: 'проверь кран и общий список',
    },
  };

  const result = renderMarkovRumorFlavor({ rumor, snapshot: snapshot(), seed: 6 });

  assert.doesNotMatch(result.text, /Министерство/);
  assert.doesNotMatch(result.text, /Макаров/);
  assert.doesNotMatch(result.text, /бетонник/i);
});

test('rumor routed output is rejected when it invents a different fact', () => {
  const rumor: RumorDef = {
    id: 'test_water_living_routed',
    topic: 'rare_item',
    minTrust: 0,
    floors: [FloorLevel.LIVING],
    text: ['Воду спрашивают у кухни, не у окна с печатью.'],
    lead: {
      floor: FloorLevel.LIVING,
      roomType: RoomType.KITCHEN,
      itemId: 'water',
      action: 'проверь кран и общий список',
    },
  };

  const result = renderMarkovRumorFlavor({
    rumor,
    snapshot: snapshot(),
    seed: 6,
    routeSpeech: generatedText('Макаров ждёт в Министерстве.'),
  });

  assert.equal(result.source, 'curated_pool');
  assert.doesNotMatch(result.text, /Макаров|Министерство/);
  assert.match(result.text, /воду|Воду|Жилая зона/);
});

test('procedural quest speech does not mention absent reward or deadline', () => {
  const result = renderProceduralQuestSpeech({
    quest: {
      id: 1,
      type: QuestType.FETCH,
      giverId: 7,
      giverName: 'Сосед',
      desc: 'Сосед: «Принеси воду.»',
      targetItem: 'water',
      targetCount: 2,
      done: false,
    },
    seed: 10,
  });

  assert.doesNotMatch(result.text, /плата|наград|₽|руб/i);
  assert.doesNotMatch(result.text, /срок|минут|час|до отбоя|до сирены/i);
});

test('procedural quest speech does not invent target npc, item, monster, or route', () => {
  const result = renderProceduralQuestSpeech({
    quest: {
      id: 2,
      type: QuestType.TALK,
      giverId: 7,
      giverName: 'Сосед',
      desc: 'Сосед: «Передай Нине сообщение.»',
      targetNpcName: 'Нина',
      done: false,
    },
    seed: 11,
  });

  assert.match(result.text, /Нина/);
  assert.doesNotMatch(result.text, /вода|Макаров|бетонник|маршрут|z=/i);
});

test('procedural quest routed output must keep the real target', () => {
  const result = renderProceduralQuestSpeech({
    quest: {
      id: 22,
      type: QuestType.FETCH,
      giverId: 7,
      giverName: 'Сосед',
      desc: 'Сосед: «Принеси воду.»',
      targetItem: 'water',
      targetCount: 2,
      done: false,
    },
    seed: 11,
    routeSpeech: generatedText('Работа есть, детали потом.'),
  });

  assert.equal(result.source, 'generated_markov');
  assert.doesNotMatch(result.text, /детали потом/i);
  assert.match(result.text, /Вода|вода/);
});

test('procedural quest speech uses real monster and deadline only when present', () => {
  const result = renderProceduralQuestSpeech({
    quest: {
      id: 3,
      type: QuestType.KILL,
      giverId: 7,
      giverName: 'Сосед',
      desc: 'Сосед: «Убей сборку.»',
      targetMonsterKind: MonsterKind.SBORKA,
      killNeeded: 1,
      timeLimitMinutes: 90,
      done: false,
    },
    seed: 12,
  });

  assert.match(result.text, /сборк/i);
  assert.match(result.text, /Срок: 90 мин/);
});

test('same seed and context produce deterministic output', () => {
  const first = renderMarkovDialogueTalk(npc(), snapshot({ nearbyContainer: true }), {
    seed: 'same-seed',
    repeatIndex: 2,
  });
  const second = renderMarkovDialogueTalk(npc(), snapshot({ nearbyContainer: true }), {
    seed: 'same-seed',
    repeatIndex: 2,
  });

  assert.equal(second.text, first.text);
  assert.equal(second.source, first.source);
});

function generatedText(text: string) {
  return (request: MarkovAdapterSpeechRequest) => ({
    text,
    source: 'generated_markov' as const,
    intent: request.intent,
    tags: request.context.tags,
    fallbackUsed: false,
  });
}
