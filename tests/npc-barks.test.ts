import test from 'node:test';
import assert from 'node:assert/strict';

import { World } from '../src/core/world';
import { emitMarkovBark, pushNpcBarkMessage, setNpcBarkLogContext } from '../src/systems/ai/barks';
import { offerQuest } from '../src/systems/quests';
import { makeGameState, makeTestNpc, makeTestPlayer } from './helpers';
import type { Msg } from '../src/core/types';

test('NPC barks only enter the log inside the configured player radius', () => {
  const world = new World();
  const player = makeTestPlayer({ id: 1, x: 10, y: 10 });
  const msgs: Msg[] = [];

  setNpcBarkLogContext({
    listener: player,
    radiusMeters: 100,
    dist2: (x1, y1, x2, y2) => world.dist2(x1, y1, x2, y2),
  });

  pushNpcBarkMessage(makeTestNpc({ id: 9101, name: 'Нина', x: 70, y: 10 }), msgs, 1, 'слышу', '#cca');
  pushNpcBarkMessage(makeTestNpc({ id: 9102, name: 'Пётр', x: 111.5, y: 10 }), msgs, 2, 'далеко', '#cca');

  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].text, 'Нина: слышу');
  assert.equal(msgs[0].distanceMeters, 60);
  setNpcBarkLogContext();
});

test('NPC bark radius is context controlled and reusable by authored warning barks', () => {
  const world = new World();
  const player = makeTestPlayer({ id: 1, x: 100, y: 100 });
  const npc = makeTestNpc({ id: 9103, name: 'Сосед', x: 155, y: 100 });
  const msgs: Msg[] = [];
  const ctx = {
    listener: player,
    radiusMeters: 50,
    dist2: (x1: number, y1: number, x2: number, y2: number) => world.dist2(x1, y1, x2, y2),
  };

  assert.equal(pushNpcBarkMessage(npc, msgs, 1, 'за стеной не слышно', '#fc4', ctx), false);
  assert.equal(msgs.length, 0);
  assert.equal(pushNpcBarkMessage(npc, msgs, 2, 'теперь слышно', '#fc4', { ...ctx, radiusMeters: 60 }), true);
  assert.equal(msgs[0].text, 'Сосед: теперь слышно');
  assert.equal(msgs[0].distanceMeters, 55);
});

test('out-of-radius bark attempts do not consume heard cooldown', () => {
  const world = new World();
  const player = makeTestPlayer({ id: 1, x: 10, y: 10 });
  const npc = makeTestNpc({ id: 9105, name: 'Слесарь', x: 90, y: 10 });
  const msgs: Msg[] = [];
  const savedRandom = Math.random;

  setNpcBarkLogContext({
    listener: player,
    radiusMeters: 50,
    dist2: (x1, y1, x2, y2) => world.dist2(x1, y1, x2, y2),
  });

  try {
    Math.random = () => 0;
    emitMarkovBark(npc, msgs, 1, 'ambient', 'Шов держит.', 1);
    assert.equal(msgs.length, 0);

    npc.x = 30;
    emitMarkovBark(npc, msgs, 2, 'ambient', 'Шов держит.', 1);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].text, 'Слесарь: Ведро у двери пустое. Значит, хозяин рядом.');
    assert.equal(msgs[0].distanceMeters, 20);
  } finally {
    Math.random = savedRandom;
    setNpcBarkLogContext();
  }
});

test('ambient NPC barks are log-only and alert barks remain HUD-eligible', () => {
  const npc = makeTestNpc({ id: 9106, name: 'Дежурная', x: 10, y: 10 });
  const msgs: Msg[] = [];

  assert.equal(pushNpcBarkMessage(npc, msgs, 1, 'чайник опять без воды', '#cca'), true);
  assert.equal(msgs[0].hud, false);

  assert.equal(pushNpcBarkMessage(npc, msgs, 2, 'К герме, быстро!', '#fc4', { signal: 'alert' }), true);
  assert.equal(msgs[1].hud, true);
  assert.equal(msgs[1].hudPriority, 80);
});

test('direct NPC quest messages carry the same distance metadata', () => {
  const world = new World();
  const player = makeTestPlayer({ id: 1, x: 10, y: 10 });
  const npc = makeTestNpc({ id: 9104, name: 'Квестодатель', x: 34, y: 10, canGiveQuest: false });
  const state = makeGameState({ time: 5 });

  offerQuest(npc, player, world, [player, npc], state, state.msgs);

  assert.equal(state.msgs.length, 1);
  assert.equal(state.msgs[0].text, 'Квестодатель: «Мне нечего тебе поручить.»');
  assert.equal(state.msgs[0].distanceMeters, 24);
});
