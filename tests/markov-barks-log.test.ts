import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateAmbientBark,
  generateMarkovBark,
  generateWitnessBark,
  type MarkovSpeechRouterRequest,
  type MarkovSpeechRouterResult,
} from '../src/systems/markov_barks';
import { generateMarkovLogSpeech } from '../src/systems/markov_log_speech';

function routedText(request: MarkovSpeechRouterRequest, text: string): MarkovSpeechRouterResult {
  return {
    text,
    source: 'generated_markov',
    intent: request.intent,
    tags: request.context.tags,
    fallbackUsed: false,
  };
}

test('alert and combat bark signals are exact fallback or rejection only', () => {
  const rejected = generateMarkovBark({
    signal: 'combat',
    actor: { id: 7, name: 'Нина' },
  });
  assert.equal(rejected, undefined);

  const fallback = generateMarkovBark({
    signal: 'alert',
    actor: { id: 7, name: 'Нина' },
    exactFallback: 'К герме, быстро!',
    routeSpeech: request => routedText(request, 'не должно появиться'),
  });
  assert.equal(fallback?.text, 'К герме, быстро!');
  assert.equal(fallback?.fallbackUsed, true);
  assert.equal(fallback?.source, 'locked_author_text');
  assert.equal(fallback?.rejected, true);
});

test('ambient bark uses bark intent and respects the supplied character cap', () => {
  let seen: MarkovSpeechRouterRequest | undefined;
  const result = generateAmbientBark({
    actor: { id: 8, name: 'Слесарь' },
    exactFallback: 'Трубу слушай.',
    context: { roomName: 'Кухня' },
    maxChars: 32,
    routeSpeech: request => {
      seen = request;
      return routedText(request, 'Кухня: сначала проверь, потом спорь и не спорь ещё раз.');
    },
  });

  assert.equal(seen?.intent, 'bark_ambient');
  assert.equal(seen?.maxChars, 32);
  assert.ok((result?.text.length ?? 999) <= 32);
});

test('generated bark receives actor context and event anchors', () => {
  const result = generateAmbientBark({
    actor: { id: 9, name: 'Дежурная' },
    exactFallback: 'Очередь ждёт.',
    event: { type: 'container_opened', itemName: 'пайковая карточка', tags: ['supply'] },
    context: { roomName: 'Кладовая' },
    seed: 12,
    routeSpeech: request => routedText(request, request.context.anchors.join('|')),
  });

  assert.equal(result?.source, 'generated_markov');
  assert.match(result?.text ?? '', /Дежурная/);
  assert.match(result?.text ?? '', /Кладовая/);
  assert.match(result?.text ?? '', /пайковая карточка|container_opened/);
});

test('witness bark routes as log speech and stays deterministic for the same seed/context', () => {
  const request = {
    actor: { id: 10, name: 'Свидетель' },
    exactFallback: 'Видел кражу.',
    event: { type: 'item_stolen', itemName: 'пайковая карточка', tags: ['theft'] },
    seed: 'same',
    repeatIndex: 2,
    routeSpeech: (routerRequest: MarkovSpeechRouterRequest) => routedText(
      routerRequest,
      `${routerRequest.intent}:${routerRequest.seed}:${routerRequest.repeatIndex}:${routerRequest.context.anchors.join(',')}`,
    ),
  };

  const first = generateWitnessBark(request);
  const second = generateWitnessBark(request);

  assert.equal(first?.intent, 'log_speech');
  assert.equal(first?.text, second?.text);
  assert.match(first?.text ?? '', /пайковая карточка|item_stolen/);
});

test('explicit NPC log speech uses only supplied actor target and event facts', () => {
  const result = generateMarkovLogSpeech({
    isSpeech: true,
    event: {
      id: 42,
      type: 'rumor_spread',
      actorId: 11,
      actorName: 'Нина',
      targetId: 12,
      targetName: 'Антон',
      tags: ['rumor'],
    },
    exactFallback: 'Нина: слух пошёл.',
    seed: 77,
    routeSpeech: request => routedText(
      request,
      `${request.context.actorName ?? ''}:${request.context.targetName ?? ''}:${request.context.eventType ?? ''}`,
    ),
  });

  assert.equal(result?.intent, 'log_speech');
  assert.match(result?.text ?? '', /Нина/);
  assert.match(result?.text ?? '', /Антон/);
  assert.match(result?.text ?? '', /rumor_spread/);
  assert.doesNotMatch(result?.text ?? '', /Ольга|Яков|Павел|патроны|гермодверь/);
});

test('structural world log event types do not become Markov text by accident', () => {
  const result = generateMarkovLogSpeech({
    event: {
      id: 43,
      type: 'door_opened',
      zoneId: 3,
      tags: [],
    },
    exactFallback: 'Дверь открылась.',
    routeSpeech: request => routedText(request, 'не должно появиться'),
  });

  assert.equal(result, undefined);
});

test('log speech rejects combat and samosbor critical facts by exact fallback', () => {
  const combat = generateMarkovLogSpeech({
    isSpeech: true,
    event: {
      id: 44,
      type: 'npc_kill_npc',
      actorName: 'Нина',
      targetName: 'Антон',
      tags: ['combat', 'kill'],
    },
    exactFallback: 'Нина ударила Антона.',
    routeSpeech: request => routedText(request, 'не должно появиться'),
  });
  assert.equal(combat?.text, 'Нина ударила Антона.');
  assert.equal(combat?.rejected, true);

  const samosbor = generateMarkovLogSpeech({
    isSpeech: true,
    event: {
      id: 45,
      type: 'samosbor_warning',
      actorName: 'Дежурная',
      tags: ['samosbor_critical'],
    },
    exactFallback: 'Ищите гермодверь.',
    routeSpeech: request => routedText(request, 'не должно появиться'),
  });
  assert.equal(samosbor?.text, 'Ищите гермодверь.');
  assert.equal(samosbor?.rejected, true);
});

test('lightweight bark path does not require a full ContextSnapshot', () => {
  const result = generateAmbientBark({
    actor: { id: 46, name: 'Повар' },
    exactFallback: 'Суп остыл.',
    routeSpeech: request => routedText(request, request.context.actorName ?? ''),
  });

  assert.equal(result?.text, 'Повар');
});

test('generateMarkovLogSpeech returns missing_speaker exact fallback when actor info is omitted', () => {
  const result = generateMarkovLogSpeech({
    isSpeech: true,
    event: {
      id: 50,
      type: 'rumor_spread',
      tags: [],
    },
    exactFallback: 'Кто-то что-то сказал.',
    routeSpeech: request => routedText(request, 'не должно появиться'),
  });

  assert.equal(result?.text, 'Кто-то что-то сказал.');
  assert.equal(result?.rejected, true);
  assert.equal(result?.source, 'locked_author_text');
});

test('generateMarkovLogSpeech returns missing_router exact fallback when routeSpeech is missing', () => {
  const result = generateMarkovLogSpeech({
    isSpeech: true,
    event: {
      id: 51,
      type: 'rumor_spread',
      actorId: 99,
      actorName: 'Скрытный',
      tags: [],
    },
    exactFallback: 'Тишина.',
  });

  assert.equal(result?.text, 'Тишина.');
  assert.equal(result?.rejected, true);
  assert.equal(result?.source, 'locked_author_text');
});

test('generateMarkovLogSpeech returns valid result when event data has npcSpeech flag', () => {
  const result = generateMarkovLogSpeech({
    isSpeech: false,
    event: {
      id: 60,
      type: 'rumor_spread',
      actorId: 99,
      actorName: 'Скрытный',
      tags: [],
      data: { npcSpeech: true },
    },
    exactFallback: 'Слух.',
    routeSpeech: request => routedText(request, 'Слух прошел.'),
  });

  assert.equal(result?.intent, 'log_speech');
  assert.equal(result?.text, 'Слух прошел.');
});

test('generateMarkovLogSpeech returns valid result when event data has speech flag', () => {
  const result = generateMarkovLogSpeech({
    isSpeech: false,
    event: {
      id: 61,
      type: 'rumor_spread',
      actorId: 99,
      actorName: 'Скрытный',
      tags: [],
      data: { speech: true },
    },
    exactFallback: 'Слух.',
    routeSpeech: request => routedText(request, 'Слух прошел 2.'),
  });

  assert.equal(result?.intent, 'log_speech');
  assert.equal(result?.text, 'Слух прошел 2.');
});

test('generateMarkovLogSpeech returns valid result when event tags contain npc_speech', () => {
  const result = generateMarkovLogSpeech({
    isSpeech: false,
    event: {
      id: 62,
      type: 'rumor_spread',
      actorId: 99,
      actorName: 'Скрытный',
      tags: ['npc_speech'],
    },
    exactFallback: 'Слух.',
    routeSpeech: request => routedText(request, 'Слух прошел 3.'),
  });

  assert.equal(result?.intent, 'log_speech');
  assert.equal(result?.text, 'Слух прошел 3.');
});

test('normalizeLogMaxChars returns default if not finite', () => {
  const result = generateMarkovLogSpeech({
    isSpeech: true,
    event: {
      id: 70,
      type: 'rumor_spread',
      actorId: 99,
      actorName: 'Скрытный',
      tags: [],
    },
    exactFallback: 'Слух.',
    maxChars: NaN,
    routeSpeech: request => {
      assert.equal(request.maxChars, 128);
      return routedText(request, 'Слух прошел.');
    },
  });

  assert.equal(result?.intent, 'log_speech');
});

test('normalizeLogMaxChars returns max if over max', () => {
  const result = generateMarkovLogSpeech({
    isSpeech: true,
    event: {
      id: 71,
      type: 'rumor_spread',
      actorId: 99,
      actorName: 'Скрытный',
      tags: [],
    },
    exactFallback: 'Слух.',
    maxChars: 500,
    routeSpeech: request => {
      assert.equal(request.maxChars, 180);
      return routedText(request, 'Слух прошел.');
    },
  });

  assert.equal(result?.intent, 'log_speech');
});

test('logSpeechEventIsUnsafe correctly handles various unsafe events', () => {
  // Samosbor critical
  const samosbor = generateMarkovLogSpeech({
    isSpeech: true,
    event: {
      id: 80,
      type: 'samosbor_started',
      actorName: 'Нина',
      tags: [],
    },
    exactFallback: 'Самосбор!',
    routeSpeech: request => routedText(request, 'не должно появиться'),
  });
  assert.equal(samosbor?.rejected, true);

  // Player kills
  const playerKillMonster = generateMarkovLogSpeech({
    isSpeech: true,
    event: {
      id: 81,
      type: 'player_kill_monster',
      actorName: 'Нина',
      tags: [],
    },
    exactFallback: 'Смерть!',
    routeSpeech: request => routedText(request, 'не должно появиться'),
  });
  assert.equal(playerKillMonster?.rejected, true);

  const playerKillNpc = generateMarkovLogSpeech({
    isSpeech: true,
    event: {
      id: 82,
      type: 'player_kill_npc',
      actorName: 'Нина',
      tags: [],
    },
    exactFallback: 'Смерть!',
    routeSpeech: request => routedText(request, 'не должно появиться'),
  });
  assert.equal(playerKillNpc?.rejected, true);

  // NPC kills with combat tag
  const npcKillMonster = generateMarkovLogSpeech({
    isSpeech: true,
    event: {
      id: 83,
      type: 'npc_kill_monster',
      actorName: 'Нина',
      tags: ['combat'],
    },
    exactFallback: 'Смерть!',
    routeSpeech: request => routedText(request, 'не должно появиться'),
  });
  assert.equal(npcKillMonster?.rejected, true);

  // NPC kills without combat tag are not inherently unsafe by themselves according to the function
  // (though the tags might make it unsafe in isUnsafeMarkovBarkSignal)
  const npcKillMonsterSafe = generateMarkovLogSpeech({
    isSpeech: true,
    event: {
      id: 84,
      type: 'npc_kill_monster',
      actorName: 'Нина',
      tags: [],
    },
    exactFallback: 'Смерть!',
    routeSpeech: request => routedText(request, 'Слух прошел.'),
  });
  assert.equal(npcKillMonsterSafe?.rejected, undefined);

  // witness + combat tags is unsafe
  const witnessCombat = generateMarkovLogSpeech({
    isSpeech: true,
    event: {
      id: 85,
      type: 'door_opened',
      actorName: 'Нина',
      tags: ['combat'],
    },
    exactFallback: 'Смерть!',
    routeSpeech: request => routedText(request, 'не должно появиться'),
  });
  assert.equal(witnessCombat?.rejected, true);
});

test('buildMarkovLogSpeechContext uses request overrides for actor and target', () => {
  const result = generateMarkovLogSpeech({
    isSpeech: true,
    event: {
      id: 90,
      type: 'rumor_spread',
      actorId: 99,
      actorName: 'Скрытный',
      actorFaction: 'mutant',
      targetId: 100,
      targetName: 'Жертва',
      targetFaction: 'stalker',
      tags: [],
    },
    actor: {
      id: 1,
      name: 'Герой',
      faction: 'player',
      occupation: 1,
      isFemale: true,
      hpRatio: 0.5,
    },
    target: {
      id: 2,
      name: 'Враг',
      faction: 'bandit',
    },
    exactFallback: 'Слух.',
    routeSpeech: request => {
      assert.equal(request.context.actorId, 1);
      assert.equal(request.context.actorName, 'Герой');
      assert.equal(request.context.actorFaction, 'player');
      assert.equal(request.context.targetId, 2);
      assert.equal(request.context.targetName, 'Враг');
      assert.equal(request.context.targetFaction, 'bandit');
      // check other overridden properties directly from the generated context
      // context is accessible inside the router
      return routedText(request, 'Слух прошел.');
    },
  });

  assert.equal(result?.intent, 'log_speech');
});
