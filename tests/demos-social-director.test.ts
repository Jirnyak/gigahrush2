import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMOS_EDGE_ENEMY, DEMOS_EDGE_FRIEND } from '../src/data/demos_posts';
import { FloorLevel, type GameState, type WorldEvent } from '../src/core/types';
import { chooseDemosReactionKind, type DemosMarkovPost } from '../src/systems/demos_posts';
import { createEmptyDemosSocialSaveState } from '../src/systems/demos_save';
import {
  runDemosSocialDirector,
  type DemosRelationDeltaMeta,
  type DemosRelationDeltaTarget,
} from '../src/systems/demos_social_director';

function event(id: number, overrides: Partial<WorldEvent> = {}): WorldEvent {
  return {
    id,
    type: 'npc_kill_npc',
    time: id,
    day: 0,
    hour: 8,
    minute: id,
    floor: FloorLevel.LIVING,
    severity: 3,
    privacy: 'public',
    truth: 'fact',
    tags: [],
    data: { actorAlifeId: 1, targetAlifeId: 2 },
    ...overrides,
  };
}

function markovPost(overrides: Partial<DemosMarkovPost> = {}): DemosMarkovPost {
  return {
    id: 1,
    authorAlifeId: 1,
    createdAt: 1,
    templateId: 'demos_post_death_corridor',
    seed: 77,
    args: [],
    tags: ['death'],
    ...overrides,
  };
}

test('Demos social director creates one reply and does not recurse replies', () => {
  const social = createEmptyDemosSocialSaveState();
  const result = runDemosSocialDirector(social, [event(1)], {
    maxPosts: 4,
    outgoingEdgesForAlifeId: () => [
      { targetAlifeId: 2, relation: 90, flags: DEMOS_EDGE_FRIEND },
      { targetAlifeId: 3, relation: 20 },
    ],
  });

  assert.equal(result.postsCreated, 1);
  assert.equal(result.repliesCreated, 1);
  assert.equal(social.posts.length, 2);
  assert.equal(social.posts[1].parentPostId, social.posts[0].id);
  assert.equal(social.posts.some(post => post.parentPostId === social.posts[1].id), false);
});

test('Demos social director caps mentions from event facts', () => {
  const social = createEmptyDemosSocialSaveState();
  runDemosSocialDirector(social, [
    event(1, {
      data: {
        actorAlifeId: 1,
        targetAlifeId: 2,
        victimAlifeId: 2,
        killerAlifeId: 3,
        giverAlifeId: 4,
        questTargetAlifeId: 5,
        targetNpcAlifeId: 6,
      },
    }),
  ]);

  assert.deepEqual(social.posts[0].mentionedAlifeIds, [2, 3, 4, 5]);
});

test('Demos social director consumes bounded event slices without floor scans', () => {
  const social = createEmptyDemosSocialSaveState();
  const seenSnapshots: number[] = [];
  const result = runDemosSocialDirector(social, [
    event(1),
    event(2),
    event(3),
  ], {
    maxEvents: 2,
    maxPosts: 8,
    snapshotForAlifeId: alifeId => {
      seenSnapshots.push(alifeId);
      assert.ok(alifeId === 1 || alifeId === 2);
      return { alifeId, dead: false, name: `alife:${alifeId}` };
    },
  });

  assert.equal(result.eventsConsumed, 2);
  assert.equal(result.eventCursor, 2);
  assert.deepEqual([...new Set(seenSnapshots)].sort((a, b) => a - b), [1, 2]);
});

test('Demos friend and enemy reactions differ for the same post', () => {
  const post = markovPost();
  const friendKind = chooseDemosReactionKind(post, { targetAlifeId: 2, relation: 90, flags: DEMOS_EDGE_FRIEND }, 1);
  const enemyKind = chooseDemosReactionKind(post, { targetAlifeId: 3, relation: -100, flags: DEMOS_EDGE_ENEMY }, 1);

  assert.equal(friendKind, 'grief');
  assert.notEqual(enemyKind, friendKind);
  assert.ok(enemyKind === 'anger' || enemyKind === 'threat');
});

test('Demos social director routes capped relation deltas through adapter', () => {
  const social = createEmptyDemosSocialSaveState();
  const calls: Array<{
    fromAlifeId: number;
    target: DemosRelationDeltaTarget;
    delta: number;
    meta: DemosRelationDeltaMeta;
  }> = [];
  const result = runDemosSocialDirector(social, [event(1)], {
    gameState: {} as GameState,
    outgoingEdgesForAlifeId: () => [
      { targetAlifeId: 2, relation: -100, flags: DEMOS_EDGE_ENEMY },
    ],
    applyRelationDelta: (_state, fromAlifeId, target, delta, meta) => {
      calls.push({ fromAlifeId, target, delta, meta });
    },
  });

  assert.equal(result.reactionsCreated, 1);
  assert.equal(result.relationDeltas, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fromAlifeId, 2);
  assert.deepEqual(calls[0].target, { targetKind: 'alife', targetAlifeId: 1 });
  assert.ok(calls[0].delta >= -8 && calls[0].delta <= 8);
  assert.equal(calls[0].meta.reasonTag, 'demos_reaction');
  assert.deepEqual(social.relationOverrides.map(override => [override.fromAlifeId, override.targetAlifeId]), [[2, 1]]);
});
