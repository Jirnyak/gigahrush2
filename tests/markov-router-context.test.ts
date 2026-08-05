import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Faction,
  FloorLevel,
  RoomType,
  ZoneFaction,
  type WorldEvent,
} from '../src/core/types';
import type { ContextSnapshot } from '../src/systems/context';
import {
  finalizeMarkovContext,
  lowerContextSnapshot,
  lowerWorldEventContext,
} from '../src/systems/markov_context';
import {
  routeSpeech,
  setSpeechRouterGenerator,
} from '../src/systems/speech_router';

function contextSnapshot(overrides: Partial<ContextSnapshot> = {}): ContextSnapshot {
  return {
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
    isSafeOwnZone: false,
    isHungry: false,
    isThirsty: false,
    isTired: false,
    isWounded: false,
    isCritical: false,
    ...overrides,
  };
}

test('context lowering derives need, wound, samosbor, faction, relation and room tags', () => {
  const ctx = lowerContextSnapshot(contextSnapshot({
    floor: FloorLevel.LIVING,
    roomType: RoomType.KITCHEN,
    roomName: 'Кухня с мокрым щитком',
    npcFaction: Faction.LIQUIDATOR,
    zoneFaction: ZoneFaction.CITIZEN,
    npcNeeds: { food: 18, water: 5, sleep: 70, pee: 10, poo: 10 },
    npcHpRatio: 0.4,
    hasRecentSamosborWarning: true,
  }), {
    actorId: 77,
    floorKey: 'story:living',
    relationToPlayer: 70,
  });

  assert.equal(ctx.floorKey, 'story:living');
  assert.equal(ctx.needBand, 'urgent');
  assert.equal(ctx.dangerBand, 'threat');
  assert.equal(ctx.relationBand, 'friend');
  assert.ok(ctx.tags.includes('room.kitchen'));
  assert.ok(ctx.tags.includes('need.food.low'));
  assert.ok(ctx.tags.includes('need.water.urgent'));
  assert.ok(ctx.tags.includes('need.wound.low'));
  assert.ok(ctx.tags.includes('danger.samosbor.warning'));
  assert.ok(ctx.tags.includes('faction.liquidator'));
  assert.ok(ctx.tags.includes('relation.friend'));
});

test('locked author text returns exact text and locked source', () => {
  const context = finalizeMarkovContext({ tags: [] });
  const lockedText = 'Вот Макаров. Стреляй. Следы от пуль видно.';

  const result = routeSpeech({
    intent: 'talk_context',
    source: 'locked_author_text',
    context,
    lockedText,
    exactFallback: 'не это',
    maxChars: 8,
  });

  assert.equal(result.text, lockedText);
  assert.equal(result.source, 'locked_author_text');
  assert.equal(result.fallbackUsed, false);
});

test('locked_author_text intent routes to locked author text directly without explicit source', () => {
  const context = finalizeMarkovContext({ tags: [] });
  const lockedText = 'Locked by intent.';

  const result = routeSpeech({
    intent: 'locked_author_text',
    context,
    lockedText,
  });

  assert.equal(result.text, lockedText);
  assert.equal(result.source, 'locked_author_text');
  assert.equal(result.fallbackUsed, false);
});

test('blocked tags prevent generated template usage', () => {
  const context = finalizeMarkovContext({ tags: ['markov.blocked', 'room.kitchen'] });
  let calls = 0;
  setSpeechRouterGenerator(request => {
    calls++;
    return {
      text: 'сгенерированная строка',
      source: 'generated_markov',
      intent: request.intent,
      tags: request.context.tags,
      fallbackUsed: false,
    };
  });

  try {
    const result = routeSpeech({
      intent: 'talk_context',
      source: 'generated_markov',
      context,
    });

    assert.equal(calls, 0);
    assert.equal(result.source, 'curated_pool');
    assert.ok(result.text.length > 0);
  } finally {
    setSpeechRouterGenerator(undefined);
  }
});

test('exact fallback takes priority over generated and curated sources', () => {
  const context = finalizeMarkovContext({ tags: ['room.kitchen'] });

  for (const source of ['generated_markov', 'curated_pool'] as const) {
    const result = routeSpeech({
      intent: 'talk_context',
      source,
      context,
      exactFallback: 'Точный игровой fallback.',
    });

    assert.equal(result.text, 'Точный игровой fallback.');
    assert.equal(result.source, 'curated_pool');
    assert.equal(result.fallbackUsed, true);
  }
});

test('missing optional world data does not crash context lowering', () => {
  const ctx = lowerContextSnapshot(contextSnapshot());

  assert.equal(ctx.needBand, 'ok');
  assert.equal(ctx.dangerBand, 'quiet');
  assert.deepEqual(ctx.tags, []);
});

test('context hash is stable for the same ids, bands and tags', () => {
  const a = finalizeMarkovContext({
    actorId: 12,
    faction: Faction.CITIZEN,
    dangerBand: 'uneasy',
    tags: ['room.office', 'need.food.low'],
  });
  const b = finalizeMarkovContext({
    actorId: 12,
    faction: Faction.CITIZEN,
    dangerBand: 'uneasy',
    tags: ['need.food.low', 'room.office'],
  });

  assert.equal(a.contextHash, b.contextHash);
});

test('context hash does not include long raw room text', () => {
  const a = lowerContextSnapshot(contextSnapshot({
    roomType: RoomType.OFFICE,
    roomName: 'Кабинет с очень длинной табличкой, которую нельзя использовать как ключ идентичности',
  }));
  const b = lowerContextSnapshot(contextSnapshot({
    roomType: RoomType.OFFICE,
    roomName: 'Другой кабинет с другой длинной табличкой и тем же игровым смыслом комнаты',
  }));

  assert.notEqual(a.roomName, b.roomName);
  assert.equal(a.contextHash, b.contextHash);
});

test('event context preserves ids but does not invent item, NPC or route names', () => {
  const event: WorldEvent = {
    id: 44,
    type: 'item_stolen',
    time: 120,
    day: 0,
    hour: 12,
    minute: 0,
    floor: FloorLevel.LIVING,
    actorId: 9,
    targetId: 10,
    itemId: 'stolen_filter_pack',
    severity: 2,
    privacy: 'local',
    truth: 'fact',
    tags: ['theft'],
  };
  const ctx = lowerWorldEventContext(event);

  assert.equal(ctx.itemId, 'stolen_filter_pack');
  assert.equal(ctx.itemName, undefined);
  assert.equal(ctx.floorKey, undefined);
  assert.equal(ctx.roomName, undefined);
  assert.ok(ctx.tags.includes('event.item_stolen'));
  assert.ok(ctx.tags.includes('item.stolen_filter_pack'));
});

test('router returns exact fallback when generation is unavailable', () => {
  setSpeechRouterGenerator(undefined);
  const context = finalizeMarkovContext({ tags: ['room.common'] });

  const result = routeSpeech({
    intent: 'talk_context',
    source: 'generated_markov',
    context,
    exactFallback: 'Пока скажу так, без украшений.',
  });

  assert.equal(result.text, 'Пока скажу так, без украшений.');
  assert.equal(result.source, 'curated_pool');
  assert.equal(result.fallbackUsed, true);
});

test('curated_pool source routes to curated pool result directly', () => {
  const context = finalizeMarkovContext({ tags: ['room.common'] });

  const result = routeSpeech({
    intent: 'talk_ambient',
    source: 'curated_pool',
    context,
  });

  assert.equal(result.source, 'curated_pool');
  assert.equal(result.intent, 'talk_ambient');
  // It either falls back to curated fallback or gives curated pool result, both with source 'curated_pool'
});

test('routeSpeech without source uses generateMarkovText and generator when available', () => {
  const context = finalizeMarkovContext({ tags: ['room.common'] });
  let generatorCalled = false;

  setSpeechRouterGenerator(request => {
    generatorCalled = true;
    return {
      text: 'Generator says hi.',
      source: 'generated_markov',
      intent: request.intent,
      tags: request.context.tags,
      fallbackUsed: false,
    };
  });

  try {
    const result = routeSpeech({
      intent: 'talk_ambient',
      context,
    });

    assert.equal(generatorCalled, true);
    assert.equal(result.text, 'Generator says hi.');
    assert.equal(result.source, 'generated_markov');
    assert.equal(result.fallbackUsed, false);
  } finally {
    setSpeechRouterGenerator(undefined);
  }
});
