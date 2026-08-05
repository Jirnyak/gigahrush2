import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Faction, FloorLevel, Occupation, type WorldEvent } from '../src/core/types';
import { DEMOS_AUTHOR_FALLBACK_CAP } from '../src/data/demos_posts';
import {
  buildDemosFeedView,
  createDemosPostQueue,
  demosPostAuthorFactFromSnapshot,
  enqueueDemosPostFromEvent,
  enqueueDemosPostsFromEvents,
  renderDemosMarkovPostText,
  renderDemosReactionsForPost,
  validateDemosPostData,
  type DemosMarkovPost,
  type DemosSpeechRouter,
} from '../src/systems/demos_posts';
import type { AlifeNpcSnapshot } from '../src/systems/alife';

function currentSaveShapeVersion(): number {
  const source = readFileSync(new URL('../src/systems/save_runtime.ts', import.meta.url), 'utf8');
  const match = source.match(/export\s+const\s+SAVE_SHAPE_VERSION\s*=\s*(\d+)/);
  return match ? Number(match[1]) : NaN;
}

function worldEvent(overrides: Partial<WorldEvent> = {}): WorldEvent {
  return {
    id: 1,
    type: 'npc_kill_npc',
    time: 10,
    day: 0,
    hour: 8,
    minute: 10,
    floor: FloorLevel.LIVING,
    severity: 3,
    privacy: 'public',
    truth: 'fact',
    tags: [],
    ...overrides,
  };
}

function snapshot(id: number, name = `Житель ${id}`, dead = false): AlifeNpcSnapshot {
  return {
    id,
    floorKey: 'story:living',
    floor: FloorLevel.LIVING,
    faction: Faction.CITIZEN,
    occupation: Occupation.SECRETARY,
    name,
    female: false,
    level: 1,
    hp: dead ? 0 : 10,
    maxHp: 10,
    money: 0,
    accountRubles: 0,
    familyId: id,
    canGiveQuest: false,
    karma: 0,
    dead,
  };
}

test('Demos post data validates as a bounded template registry', () => {
  assert.deepEqual(validateDemosPostData(), []);
});

test('Demos posts require real event types and compact A-Life author facts', () => {
  const queue = createDemosPostQueue();
  const ignoredType = enqueueDemosPostFromEvent(queue, worldEvent({
    id: 1,
    type: 'player_pick_item',
    data: { actorAlifeId: 1 },
  }));
  assert.equal(ignoredType, undefined);

  const missingAuthor = enqueueDemosPostFromEvent(queue, worldEvent({ id: 2, type: 'samosbor_warning' }));
  assert.equal(missingAuthor, undefined);

  const post = enqueueDemosPostFromEvent(queue, worldEvent({
    id: 3,
    type: 'samosbor_warning',
    data: { actorAlifeId: 2 },
  }));
  assert.equal(post?.authorAlifeId, 2);
  assert.equal(post?.sourceEventId, 3);
  assert.equal(queue.posts.length, 1);
});

test('Demos post ring cap drops old transient entries', () => {
  const queue = createDemosPostQueue(3);
  for (let id = 1; id <= 5; id++) {
    enqueueDemosPostFromEvent(queue, worldEvent({
      id,
      type: 'room_lacked_resources',
      itemName: `вода ${id}`,
      data: { actorAlifeId: 1, resourceName: `вода ${id}` },
    }));
  }

  assert.deepEqual(queue.posts.map(post => post.sourceEventId), [3, 4, 5]);
  assert.deepEqual(queue.posts.map(post => post.id), [3, 4, 5]);
  assert.equal(queue.posts.length, 3);
});

test('Demos posts can resolve live entity ids to A-Life authors', () => {
  const queue = createDemosPostQueue();
  const post = enqueueDemosPostFromEvent(queue, worldEvent({
    id: 6,
    type: 'npc_kill_monster',
    actorId: 101,
    actorName: 'Смена у гермы',
    targetId: 202,
    targetName: 'тварь у лифта',
  }), {
    alifeIdForEntityId: entityId => entityId === 101 ? 11 : entityId === 202 ? 22 : undefined,
    snapshotForAlifeId: alifeId => demosPostAuthorFactFromSnapshot(snapshot(alifeId, `Житель ${alifeId}`)),
  });

  assert.equal(post?.authorAlifeId, 11);
  assert.equal(post?.args.some(arg => arg.includes('Житель 11')), true);
  assert.equal(post?.args.some(arg => arg.includes('Житель 22')), true);
});

test('Demos fallback authors are sampled from the full supplied window', () => {
  const fallbackAuthorAlifeIds = Array.from({ length: 64 }, (_unused, index) => index + 1);
  let authorAlifeId: number | undefined;
  for (let id = 20; id < 120 && authorAlifeId === undefined; id++) {
    const queue = createDemosPostQueue();
    const post = enqueueDemosPostFromEvent(queue, worldEvent({
      id,
      type: 'samosbor_warning',
    }), {
      fallbackAuthorAlifeIds,
      snapshotForAlifeId: alifeId => demosPostAuthorFactFromSnapshot(snapshot(
        alifeId,
        `Житель ${alifeId}`,
        alifeId <= DEMOS_AUTHOR_FALLBACK_CAP,
      )),
    });
    authorAlifeId = post?.authorAlifeId;
  }

  assert.equal(typeof authorAlifeId, 'number');
  assert.ok((authorAlifeId ?? 0) > DEMOS_AUTHOR_FALLBACK_CAP);
});

test('Demos post text reconstructs deterministically from compact post fields', () => {
  const queue = createDemosPostQueue();
  const post = enqueueDemosPostFromEvent(queue, worldEvent({
    id: 7,
    type: 'item_stolen',
    actorName: 'Слесарь Ромка',
    itemName: 'чайник',
    roomId: 12,
    data: { actorAlifeId: 4 },
  }));
  assert.ok(post);
  assert.equal(Object.prototype.hasOwnProperty.call(post, 'text'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(post, 'content'), false);

  const compactOnly: DemosMarkovPost = {
    id: post.id,
    authorAlifeId: post.authorAlifeId,
    createdAt: post.createdAt,
    sourceEventId: post.sourceEventId,
    templateId: post.templateId,
    seed: post.seed,
    args: [...post.args],
    tags: [...post.tags],
  };
  const first = renderDemosMarkovPostText(compactOnly).text;
  const second = renderDemosMarkovPostText(compactOnly).text;
  assert.equal(first, second);
  assert.equal(first.length > 0, true);
  assert.equal(first.includes('чайник') || first.includes('комната 12'), true);
});

test('Demos post renderer calls the router-compatible text path', () => {
  const queue = createDemosPostQueue();
  const post = enqueueDemosPostFromEvent(queue, worldEvent({
    id: 8,
    type: 'contract_created',
    targetName: 'ремонт гермы',
    data: { actorAlifeId: 5 },
  }));
  assert.ok(post);
  let calls = 0;
  const routeSpeech: DemosSpeechRouter = request => {
    calls++;
    assert.equal(request.intent, 'demos_post');
    assert.equal(request.context.actorAlifeId, 5);
    assert.equal(request.seed, post.seed);
    assert.equal(typeof request.exactFallback, 'string');
    return {
      text: `router:${request.exactFallback}`,
      source: 'generated_markov',
      intent: request.intent,
      tags: request.context.tags,
      fallbackUsed: false,
    };
  };

  const rendered = renderDemosMarkovPostText(post, { routeSpeech });
  assert.equal(calls, 1);
  assert.equal(rendered.source, 'generated_markov');
  assert.equal(rendered.fallbackUsed, false);
  assert.equal(rendered.text.startsWith('router:'), true);
});

test('Demos reaction rendering scans only supplied outgoing edges', () => {
  const queue = createDemosPostQueue();
  const post = enqueueDemosPostFromEvent(queue, worldEvent({
    id: 9,
    type: 'npc_kill_npc',
    targetName: 'Петр из душевой',
    data: { actorAlifeId: 1, targetAlifeId: 2 },
  }));
  assert.ok(post);
  const scanned: number[] = [];
  const reactions = renderDemosReactionsForPost(post, [
    { targetAlifeId: 2, relation: 90, flags: 1 },
    { targetAlifeId: 3, relation: -100, flags: 4 },
    { targetAlifeId: 4, relation: 20 },
    { targetAlifeId: 5, relation: 70 },
  ], {
    maxEdgesScanned: 2,
    onEdgeScanned: edge => scanned.push(edge.targetAlifeId),
  });

  assert.deepEqual(scanned, [2, 3]);
  assert.deepEqual(reactions.map(reaction => reaction.reactorAlifeId), [2, 3]);
  assert.equal(reactions.some(reaction => reaction.reactorAlifeId === 4), false);
});

test('Demos post creation uses supplied snapshots only and does not load inactive floors', () => {
  const queue = createDemosPostQueue();
  const touched = new Set<number>();
  const post = enqueueDemosPostFromEvent(queue, worldEvent({
    id: 10,
    type: 'alife_migration',
    data: {
      actorAlifeId: 1,
      targetAlifeId: 2,
      floorKey: 'procedural:z99',
    },
  }), {
    snapshotForAlifeId: alifeId => {
      touched.add(alifeId);
      assert.ok(alifeId === 1 || alifeId === 2);
      return demosPostAuthorFactFromSnapshot(snapshot(alifeId, alifeId === 1 ? 'Мария Маршрут' : 'Петр Адрес'));
    },
  });

  assert.ok(post);
  assert.deepEqual([...touched].sort((a, b) => a - b), [1, 2]);
  assert.equal(post.args.some(arg => arg.includes('procedural:z99')), true);
});

test('Demos enqueue can consume supplied recent events without a state scan', () => {
  const queue = createDemosPostQueue();
  const posts = enqueueDemosPostsFromEvents(queue, [
    worldEvent({ id: 4, type: 'samosbor_warning', data: { actorAlifeId: 1 } }),
    worldEvent({ id: 2, type: 'room_produced_items', itemName: 'бинты', data: { actorAlifeId: 1 } }),
    worldEvent({ id: 3, type: 'player_pick_item', data: { actorAlifeId: 1 } }),
  ]);

  assert.deepEqual(posts.map(post => post.sourceEventId), [2, 4]);
  assert.equal(queue.lastSourceEventId, 4);
});

test('Demos feed view stores rendered rows outside the transient queue only', () => {
  const queue = createDemosPostQueue();
  enqueueDemosPostFromEvent(queue, worldEvent({
    id: 11,
    type: 'room_produced_items',
    itemName: 'бинты',
    data: { actorAlifeId: 1 },
  }));
  const view = buildDemosFeedView(queue);

  assert.equal(view.posts.length, 1);
  assert.equal(view.posts[0].text.length > 0, true);
  assert.equal(Object.prototype.hasOwnProperty.call(queue.posts[0], 'text'), false);
});

test('Demos persistent social batch owns the current save shape', () => {
  assert.equal(currentSaveShapeVersion(), 22);
});
