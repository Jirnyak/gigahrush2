import {
  DEMOS_EDGE_HIDDEN,
  DEMOS_PERSISTENT_POST_CAP,
  DEMOS_PERSISTENT_REACTION_CAP,
  DEMOS_REACTIONS_PER_POST_CAP,
  DEMOS_RELATION_OVERRIDE_CAP,
  type DemosReactionKind,
} from '../data/demos_posts';
import type { GameState, WorldEvent } from '../core/types';
import {
  chooseDemosReactionKind,
  createDemosPostQueue,
  enqueueDemosPostFromEvent,
  type DemosOutgoingSocialEdge,
  type DemosPostAuthorFact,
} from './demos_posts';
import {
  DEMOS_REACTION_DELTA_MAX,
  DEMOS_REACTION_DELTA_MIN,
  DEMOS_RELATION_MAX,
  DEMOS_RELATION_MIN,
  type DemosPersistentPost,
  type DemosPersistentReaction,
  type DemosRelationOverride,
  type DemosSocialSaveState,
} from './demos_save';

export const DEMOS_EVENT_SCAN_PER_TICK_CAP = 32;
export const DEMOS_POSTS_PER_TICK_CAP = 8;
export const DEMOS_REACTIONS_PER_TICK_CAP = 32;

export interface DemosRelationDeltaTarget {
  targetKind: 'alife';
  targetAlifeId: number;
}

export interface DemosRelationDeltaMeta {
  reasonTag: string;
  postId?: number;
  reactionId?: number;
}

export type ApplyDemosRelationDelta = (
  state: GameState,
  fromAlifeId: number,
  target: DemosRelationDeltaTarget,
  delta: number,
  meta: DemosRelationDeltaMeta,
) => void;

export interface DemosSocialDirectorOptions {
  now?: number;
  seedSalt?: number;
  maxEvents?: number;
  maxPosts?: number;
  maxReactions?: number;
  allowPrivateEvents?: boolean;
  fallbackAuthorAlifeIds?: readonly number[];
  alifeIdForEntityId?: (entityId: number) => number | undefined;
  snapshotForAlifeId?: (alifeId: number) => DemosPostAuthorFact | undefined;
  outgoingEdgesForAlifeId?: (authorAlifeId: number) => readonly DemosOutgoingSocialEdge[];
  relationForPair?: (fromAlifeId: number, targetAlifeId: number) => number | undefined;
  applyRelationDelta?: ApplyDemosRelationDelta;
  gameState?: GameState;
}

export interface DemosSocialDirectorResult {
  eventsConsumed: number;
  postsCreated: number;
  reactionsCreated: number;
  repliesCreated: number;
  relationDeltas: number;
  eventCursor: number;
}

function intIn(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function positiveId(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const id = Math.trunc(value);
  return id > 0 ? Math.min(id, 0x7fffffff) : undefined;
}

function hash32(a: number, b: number, c = 0): number {
  let x = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(b ^ 0xc2b2ae35, 0x27d4eb2d) + c) | 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  x = Math.imul(x, 0x297a2d39);
  x ^= x >>> 15;
  return x >>> 0;
}

function clampRelation(value: number): number {
  return Math.max(DEMOS_RELATION_MIN, Math.min(DEMOS_RELATION_MAX, Math.trunc(value)));
}

function clampDelta(value: number): number {
  return Math.max(DEMOS_REACTION_DELTA_MIN, Math.min(DEMOS_REACTION_DELTA_MAX, Math.trunc(value)));
}

export function demosReactionRelationDelta(kind: DemosReactionKind): number {
  switch (kind) {
    case 'like': return 2;
    case 'help': return 3;
    case 'grief': return 1;
    case 'joke': return 1;
    case 'rumor': return 0;
    case 'fear': return -1;
    case 'dislike': return -2;
    case 'anger': return -4;
    case 'threat': return -6;
  }
}

function pushPost(state: DemosSocialSaveState, post: DemosPersistentPost): void {
  state.posts.push(post);
  while (state.posts.length > DEMOS_PERSISTENT_POST_CAP) state.posts.shift();
  const validPostIds = new Set(state.posts.map(saved => saved.id));
  state.reactions = state.reactions.filter(reaction => validPostIds.has(reaction.postId));
}

function pushReaction(state: DemosSocialSaveState, reaction: DemosPersistentReaction): void {
  state.reactions.push(reaction);
  while (state.reactions.length > DEMOS_PERSISTENT_REACTION_CAP) state.reactions.shift();
}

function relationOverrideIndex(
  overrides: readonly DemosRelationOverride[],
  fromAlifeId: number,
  targetAlifeId: number,
): number {
  return overrides.findIndex(override =>
    override.fromAlifeId === fromAlifeId
    && override.targetKind === 'alife'
    && override.targetAlifeId === targetAlifeId);
}

function applyRelationDelta(
  social: DemosSocialSaveState,
  fromAlifeId: number,
  targetAlifeId: number,
  deltaInput: number,
  reaction: DemosPersistentReaction,
  opts: DemosSocialDirectorOptions,
): boolean {
  const delta = clampDelta(deltaInput);
  if (delta === 0) return false;
  const existingIndex = relationOverrideIndex(social.relationOverrides, fromAlifeId, targetAlifeId);
  const existing = existingIndex >= 0 ? social.relationOverrides[existingIndex] : undefined;
  const base = existing?.value ?? opts.relationForPair?.(fromAlifeId, targetAlifeId) ?? 0;
  const value = clampRelation(base + delta);
  const next: DemosRelationOverride = {
    fromAlifeId,
    targetKind: 'alife',
    targetAlifeId,
    value,
    updatedAt: reaction.createdAt,
    reasonTag: 'demos_reaction',
    postId: reaction.postId,
    reactionId: reaction.id,
  };
  if (existingIndex >= 0) social.relationOverrides[existingIndex] = next;
  else social.relationOverrides.push(next);
  while (social.relationOverrides.length > DEMOS_RELATION_OVERRIDE_CAP) social.relationOverrides.shift();

  opts.applyRelationDelta?.(
    opts.gameState ?? ({} as GameState),
    fromAlifeId,
    { targetKind: 'alife', targetAlifeId },
    delta,
    { reasonTag: 'demos_reaction', postId: reaction.postId, reactionId: reaction.id },
  );
  return true;
}

function canReplyToPost(post: DemosPersistentPost, kind: DemosReactionKind): boolean {
  if (post.parentPostId !== undefined) return false;
  return kind === 'help' || kind === 'grief' || kind === 'anger' || kind === 'threat';
}

function createReplyPost(
  social: DemosSocialSaveState,
  post: DemosPersistentPost,
  reactorAlifeId: number,
  kind: DemosReactionKind,
  seed: number,
  now: number,
): DemosPersistentPost {
  return {
    id: social.nextPostId++,
    authorAlifeId: reactorAlifeId,
    createdAt: now,
    floorKey: post.floorKey,
    sourceEventId: post.sourceEventId,
    parentPostId: post.id,
    templateId: post.templateId,
    seed: hash32(post.seed, reactorAlifeId, seed),
    args: post.args.slice(0),
    mentionedAlifeIds: [post.authorAlifeId, ...(post.mentionedAlifeIds ?? [])]
      .filter((id, index, ids) => id !== reactorAlifeId && ids.indexOf(id) === index)
      .slice(0, 4),
    privacy: post.privacy,
    tags: [...post.tags, 'reply', `reaction.${kind}`].slice(0, 8),
    score: 0,
  };
}

function persistentPostFromTransient(post: ReturnType<typeof enqueueDemosPostFromEvent>): DemosPersistentPost | undefined {
  if (!post) return undefined;
  return {
    id: post.id,
    authorAlifeId: post.authorAlifeId,
    createdAt: post.createdAt,
    floorKey: post.floorKey,
    sourceEventId: post.sourceEventId,
    parentPostId: post.parentPostId,
    templateId: post.templateId,
    seed: post.seed,
    args: post.args.slice(0),
    mentionedAlifeIds: post.mentionedAlifeIds?.slice(0, 4),
    privacy: post.privacy ?? 'public',
    tags: post.tags.slice(0, 8),
    score: post.score ?? 0,
  };
}

function eventAllowed(event: WorldEvent, allowPrivateEvents: boolean): boolean {
  return allowPrivateEvents || (event.privacy !== 'private' && event.privacy !== 'secret');
}

export function runDemosSocialDirector(
  social: DemosSocialSaveState,
  events: readonly WorldEvent[],
  opts: DemosSocialDirectorOptions = {},
): DemosSocialDirectorResult {
  const maxEvents = intIn(opts.maxEvents, DEMOS_EVENT_SCAN_PER_TICK_CAP, 0, DEMOS_EVENT_SCAN_PER_TICK_CAP);
  const maxPosts = intIn(opts.maxPosts, DEMOS_POSTS_PER_TICK_CAP, 0, DEMOS_POSTS_PER_TICK_CAP);
  const maxReactions = intIn(opts.maxReactions, DEMOS_REACTIONS_PER_TICK_CAP, 0, DEMOS_REACTIONS_PER_TICK_CAP);
  const result: DemosSocialDirectorResult = {
    eventsConsumed: 0,
    postsCreated: 0,
    reactionsCreated: 0,
    repliesCreated: 0,
    relationDeltas: 0,
    eventCursor: social.eventCursor,
  };
  if (maxEvents <= 0 || maxPosts <= 0) return result;

  const fresh = events
    .filter(event => event.id > social.eventCursor)
    .slice()
    .sort((a, b) => a.id - b.id)
    .slice(0, maxEvents);

  for (const event of fresh) {
    if (result.postsCreated + result.repliesCreated >= maxPosts) break;
    result.eventsConsumed++;
    social.eventCursor = Math.max(social.eventCursor, event.id);
    result.eventCursor = social.eventCursor;
    if (!eventAllowed(event, opts.allowPrivateEvents === true)) continue;

    const queue = createDemosPostQueue(1);
    queue.lastSourceEventId = event.id - 1;
    queue.nextId = social.nextPostId;
    const transient = enqueueDemosPostFromEvent(queue, event, {
      now: opts.now,
      seedSalt: opts.seedSalt,
      allowPrivateEvents: opts.allowPrivateEvents,
      fallbackAuthorAlifeIds: opts.fallbackAuthorAlifeIds,
      alifeIdForEntityId: opts.alifeIdForEntityId,
      snapshotForAlifeId: opts.snapshotForAlifeId,
    });
    const post = persistentPostFromTransient(transient);
    if (!post) continue;
    social.nextPostId = Math.max(social.nextPostId, queue.nextId);
    pushPost(social, post);
    result.postsCreated++;

    const edges = opts.outgoingEdgesForAlifeId?.(post.authorAlifeId) ?? [];
    const seenReactors = new Set<number>();
    let repliesForPost = 0;
    for (
      let i = 0;
      i < edges.length
      && i < DEMOS_REACTIONS_PER_POST_CAP * 2
      && result.reactionsCreated < maxReactions;
      i++
    ) {
      const edge = edges[i];
      const reactorAlifeId = positiveId(edge.targetAlifeId);
      if (reactorAlifeId === undefined || reactorAlifeId === post.authorAlifeId || seenReactors.has(reactorAlifeId)) continue;
      if (((edge.flags ?? 0) & DEMOS_EDGE_HIDDEN) !== 0) continue;
      seenReactors.add(reactorAlifeId);
      const seed = hash32(post.seed, reactorAlifeId, edge.flags ?? 0);
      const kind = chooseDemosReactionKind(post, edge, seed);
      const relationDelta = clampDelta(demosReactionRelationDelta(kind));
      const reaction: DemosPersistentReaction = {
        id: social.nextReactionId++,
        postId: post.id,
        reactorAlifeId,
        createdAt: opts.now ?? post.createdAt,
        kind,
        relationDelta,
        flags: edge.flags,
      };
      pushReaction(social, reaction);
      result.reactionsCreated++;
      if (applyRelationDelta(social, reactorAlifeId, post.authorAlifeId, relationDelta, reaction, opts)) {
        result.relationDeltas++;
      }
      if (
        repliesForPost === 0
        && result.postsCreated + result.repliesCreated < maxPosts
        && canReplyToPost(post, kind)
      ) {
        pushPost(social, createReplyPost(social, post, reactorAlifeId, kind, seed, opts.now ?? post.createdAt));
        result.repliesCreated++;
        repliesForPost++;
      }
    }
  }
  return result;
}
