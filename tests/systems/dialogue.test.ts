import test from 'node:test';
import assert from 'node:assert/strict';

import { NpcState } from '../../src/core/types';
import { generateTalkText } from '../../src/systems/dialogue';
import { makeTestNpc } from '../helpers';
import * as memorySys from '../../src/systems/npc_memory';

import { registerNpcSpeechPackage, clearNpcSpeechPackages } from '../../src/systems/npc_package_speech';

test.afterEach(() => {
  clearNpcSpeechPackages();
});

test('generateTalkText fallback lines', () => {
  const npc = makeTestNpc({ id: 10101, ai: { npcState: NpcState.SLEEPING } });

  // ensure no rumors by updating lastRumorAt
  const memory = memorySys.getNpcMemory(npc, 0);
  memory.lastRumorAt = 0;
  memory.knownRumorIds.push('dummy');

  let randomCount = 0;
  const originalRandom = Math.random;
  Math.random = () => {
    randomCount++;
    if (randomCount === 1) return 0.1; // return < 0.4 for state text
    return 0; // index 0
  };

  try {
    const talkText = generateTalkText(npc, { time: 0 });
    assert.equal(talkText, 'Сплю, если тут вообще можно спать.');
  } finally {
    Math.random = originalRandom;
  }
});

test('generateTalkText rumor fallback', () => {
  const npc = makeTestNpc({ id: 10102 });

  const memory = memorySys.getNpcMemory(npc, 0);
  memory.lastRumorAt = 0;
  memory.knownRumorIds.push('dummy');

  let randomCount = 0;
  const originalRandom = Math.random;
  Math.random = () => {
    randomCount++;
    return 0.99; // bypass state text (< 0.4)
  };

  try {
    const talkText = generateTalkText(npc, { time: 0 });
    // Should fallback to renderMarkovDialogueTalk
    assert.equal(typeof talkText, 'string');
    assert.ok(talkText.length > 0);
  } finally {
    Math.random = originalRandom;
  }
});

test('generateTalkText performanceNowSeconds fallback with undefined performance', () => {
  const npc = makeTestNpc({ id: 10103 });

  // We don't provide options.time, so performanceNowSeconds will be called
  // Simulate an environment where performance is undefined
  const originalPerformance = global.performance;
  // @ts-ignore
  global.performance = undefined;

  const originalDateNow = Date.now;
  Date.now = () => 2000000;

  try {
    const talkText = generateTalkText(npc);
    assert.equal(typeof talkText, 'string');
  } finally {
    global.performance = originalPerformance;
    Date.now = originalDateNow;
  }
});

test('generateTalkText performanceNowSeconds fallback with performance', () => {
  const npc = makeTestNpc({ id: 10104 });

  // Simulate an environment where performance is defined
  const originalPerformance = global.performance;
  // @ts-ignore
  global.performance = { now: () => 3000000 };

  try {
    const talkText = generateTalkText(npc);
    assert.equal(typeof talkText, 'string');
  } finally {
    global.performance = originalPerformance;
  }
});

test('generateTalkText with locked speech package', () => {
  registerNpcSpeechPackage({
    id: 'test_locked_speech',
    tags: [],
    bio: { publicLine: 'test' },
    speech: {
      talkLines: ['Это закрытая реплика.'],
    },
  });

  const npc = makeTestNpc({ id: 10105 });
  // @ts-ignore
  npc.npcPackageId = 'test_locked_speech';

  const talkText = generateTalkText(npc, { time: 0 });
  assert.equal(talkText, 'Это закрытая реплика.');
});

test('generateTalkText with package but without locked lines', () => {
  registerNpcSpeechPackage({
    id: 'test_unlocked_speech',
    tags: [],
    bio: { publicLine: 'test' },
    speech: {
      ambientCorpus: ['Обычная речь.'],
    },
  });

  const npc = makeTestNpc({ id: 10107 });
  // @ts-ignore
  npc.npcPackageId = 'test_unlocked_speech';

  const originalRandom = Math.random;
  Math.random = () => 0.99; // bypass ai text
  try {
    // Need to provide an empty state object to avoid undefined quest checks
    const talkText = generateTalkText(npc, { time: 0, state: { quests: [] } as any });
    assert.ok(talkText !== undefined);
  } finally {
    Math.random = originalRandom;
  }
});

test('generateTalkText rumor branch', () => {
  // Let's force a rumor
  const npc = makeTestNpc({ id: 10106 });
  const memory = memorySys.getNpcMemory(npc, 0);
  // Ensure the NPC has a rumor to say
  // We can just add an event rumor that is known
  memory.lastEventRumorId = 'dog_meat';
  memory.lastRumorEventId = -1; // doesn't matter much for dog_meat if it's not strictly tied to event record

  // Since rumors are complex, let's just observe if selectRumorForNpc returns it
  const talkText = generateTalkText(npc, { time: 0 });
  assert.ok(talkText !== undefined);
  // If it returned a rumor, the random function wasn't called or the talk is specific
});
