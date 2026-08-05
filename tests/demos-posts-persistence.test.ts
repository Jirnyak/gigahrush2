import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMOS_PERSISTENT_POST_ARG_MAX_CHARS,
  DEMOS_PERSISTENT_POST_CAP,
  DEMOS_PERSISTENT_REACTION_CAP,
} from '../src/data/demos_posts';
import {
  createEmptyDemosSocialSaveState,
  demosSocialForSave,
  restoreDemosSocialFromSave,
  sanitizeDemosSocialSave,
  type DemosPersistentPost,
  type DemosPersistentReaction,
} from '../src/systems/demos_save';
import type { GameState } from '../src/core/types';

function post(id: number, overrides: Partial<DemosPersistentPost> = {}): DemosPersistentPost {
  return {
    id,
    authorAlifeId: 1,
    createdAt: id,
    templateId: 'demos_post_samosbor',
    seed: id,
    args: [],
    privacy: 'public',
    tags: ['samosbor'],
    score: 0,
    ...overrides,
  };
}

function reaction(id: number, overrides: Partial<DemosPersistentReaction> = {}): DemosPersistentReaction {
  return {
    id,
    postId: 1,
    reactorAlifeId: 2,
    createdAt: id,
    kind: 'like',
    ...overrides,
  };
}

test('Demos persistent post ring cap 512 drops oldest entries', () => {
  const posts = Array.from({ length: DEMOS_PERSISTENT_POST_CAP + 2 }, (_unused, index) => post(index + 1));
  const saved = sanitizeDemosSocialSave({
    version: 1,
    posts,
  });

  assert.equal(saved.posts.length, DEMOS_PERSISTENT_POST_CAP);
  assert.equal(saved.posts[0].id, 3);
  assert.equal(saved.posts.at(-1)?.id, DEMOS_PERSISTENT_POST_CAP + 2);
});

test('Demos persistent reaction ring cap 2048 drops oldest entries', () => {
  const reactions = Array.from({ length: DEMOS_PERSISTENT_REACTION_CAP + 2 }, (_unused, index) => reaction(index + 1));
  const saved = sanitizeDemosSocialSave({
    version: 1,
    posts: [post(1)],
    reactions,
  });

  assert.equal(saved.reactions.length, DEMOS_PERSISTENT_REACTION_CAP);
  assert.equal(saved.reactions[0].id, 3);
  assert.equal(saved.reactions.at(-1)?.id, DEMOS_PERSISTENT_REACTION_CAP + 2);
});

test('Demos persistent mentions are capped and deduped', () => {
  const saved = sanitizeDemosSocialSave({
    version: 1,
    posts: [post(1, { mentionedAlifeIds: [2, 2, 3, 4, 5, 6] })],
  });

  assert.deepEqual(saved.posts[0].mentionedAlifeIds, [2, 3, 4, 5]);
});

test('Demos persistent posts never store rendered text', () => {
  const saved = sanitizeDemosSocialSave({
    version: 1,
    posts: [{
      ...post(1),
      text: 'rendered text must not persist',
      content: 'rendered content must not persist',
    }],
  });

  assert.equal(Object.prototype.hasOwnProperty.call(saved.posts[0], 'text'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(saved.posts[0], 'content'), false);
});

test('Demos social sanitizer clamps relation values and drops invalid posts or reactions', () => {
  const saved = sanitizeDemosSocialSave({
    version: 1,
    posts: [
      post(0),
      post(2, { authorAlifeId: 0 }),
      post(3, {
        parentPostId: 99,
        privacy: 'unknown' as never,
        args: ['x'.repeat(DEMOS_PERSISTENT_POST_ARG_MAX_CHARS + 20)],
      }),
    ],
    reactions: [
      reaction(1, { postId: 3, relationDelta: 99 }),
      reaction(2, { postId: 99 }),
      reaction(3, { postId: 3, reactorAlifeId: 0 }),
    ],
    relationOverrides: [
      { fromAlifeId: 1, targetKind: 'alife', targetAlifeId: 2, value: -128 },
      { fromAlifeId: 1, targetKind: 'alife', targetAlifeId: 3, value: 500 },
      { fromAlifeId: 1, targetKind: 'alife', targetAlifeId: 4, value: -200 },
    ],
  });

  assert.deepEqual(saved.posts.map(savedPost => savedPost.id), [3]);
  assert.equal(saved.posts[0].parentPostId, undefined);
  assert.equal(saved.posts[0].privacy, 'public');
  assert.equal(saved.posts[0].args[0].length, DEMOS_PERSISTENT_POST_ARG_MAX_CHARS);
  assert.deepEqual(saved.reactions.map(savedReaction => savedReaction.id), [1]);
  assert.equal(saved.reactions[0].relationDelta, 8);
  assert.deepEqual(saved.relationOverrides.map(override => [override.targetAlifeId, override.value]), [[3, 127]]);
});

test('Demos social save module does not migrate old or missing save shapes', () => {
  assert.deepEqual(sanitizeDemosSocialSave({ posts: [post(1)] }), createEmptyDemosSocialSaveState());
  assert.deepEqual(sanitizeDemosSocialSave({ version: 0, posts: [post(1)] }), createEmptyDemosSocialSaveState());
});

test('Demos social save helpers restore and export only sanitized current state', () => {
  const state = {} as GameState;
  restoreDemosSocialFromSave(state, {
    version: 1,
    posts: [post(4)],
    nextPostId: 1,
  });
  const saved = demosSocialForSave(state);

  assert.equal(saved?.posts.length, 1);
  assert.equal(saved?.nextPostId, 5);
});
