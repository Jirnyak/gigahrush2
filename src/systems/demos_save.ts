import {
  DEMOS_PERSISTENT_POST_ARG_MAX_CHARS,
  DEMOS_PERSISTENT_POST_CAP,
  DEMOS_PERSISTENT_REACTION_CAP,
  DEMOS_POST_ARGS_CAP,
  DEMOS_POST_MENTIONS_CAP,
  DEMOS_POST_TAG_MAX_CHARS,
  DEMOS_POST_TAGS_CAP,
  DEMOS_RELATION_OVERRIDE_CAP,
  type DemosPostPrivacy,
  type DemosReactionKind,
} from '../data/demos_posts';
import type { GameState } from '../core/types';

export const DEMOS_SOCIAL_SAVE_VERSION = 1;
export const DEMOS_RELATION_EMPTY = -128;
export const DEMOS_RELATION_MIN = -127;
export const DEMOS_RELATION_MAX = 127;
export const DEMOS_REACTION_DELTA_MIN = -8;
export const DEMOS_REACTION_DELTA_MAX = 8;

export interface DemosRelationOverride {
  fromAlifeId: number;
  targetKind: 'alife' | 'player';
  targetAlifeId?: number;
  value: number;
  updatedAt?: number;
  reasonTag?: string;
  postId?: number;
  reactionId?: number;
}

export interface DemosPersistentPost {
  id: number;
  authorAlifeId: number;
  createdAt: number;
  floorKey?: string;
  sourceEventId?: number;
  parentPostId?: number;
  templateId: string;
  seed: number;
  args: readonly string[];
  mentionedAlifeIds?: readonly number[];
  privacy: DemosPostPrivacy;
  tags: readonly string[];
  score: number;
}

export interface DemosPersistentReaction {
  id: number;
  postId: number;
  reactorAlifeId: number;
  createdAt: number;
  kind: DemosReactionKind;
  relationDelta?: number;
  flags?: number;
}

export interface DemosSocialSaveState {
  version: 1;
  cursor: number;
  eventCursor: number;
  nextPostId: number;
  nextReactionId: number;
  relationOverrides: DemosRelationOverride[];
  posts: DemosPersistentPost[];
  reactions: DemosPersistentReaction[];
}

const PRIVACIES = new Set<DemosPostPrivacy>(['public', 'local', 'friends', 'faction', 'private']);
const REACTION_KINDS = new Set<DemosReactionKind>([
  'like',
  'dislike',
  'fear',
  'anger',
  'grief',
  'joke',
  'help',
  'threat',
  'rumor',
]);

type DemosSocialStateHost = GameState & { demosSocial?: DemosSocialSaveState };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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

function cleanText(value: unknown, maxChars: number): string {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function cleanOptionalText(value: unknown, maxChars: number): string | undefined {
  const text = cleanText(value, maxChars);
  return text.length > 0 ? text : undefined;
}

function cleanStringArray(input: unknown, cap: number, maxChars: number): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (out.length >= cap) break;
    const value = cleanText(raw, maxChars);
    if (value.length > 0) out.push(value);
  }
  return out;
}

function cleanTagArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (out.length >= DEMOS_POST_TAGS_CAP) break;
    const tag = cleanText(raw, DEMOS_POST_TAG_MAX_CHARS);
    if (tag.length > 0 && !out.includes(tag)) out.push(tag);
  }
  return out;
}

function cleanIdArray(input: unknown): number[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: number[] = [];
  for (const raw of input) {
    if (out.length >= DEMOS_POST_MENTIONS_CAP) break;
    const id = positiveId(raw);
    if (id !== undefined && !out.includes(id)) out.push(id);
  }
  return out.length > 0 ? out : undefined;
}

function privacy(input: unknown): DemosPostPrivacy {
  return typeof input === 'string' && PRIVACIES.has(input as DemosPostPrivacy)
    ? input as DemosPostPrivacy
    : 'public';
}

function reactionKind(input: unknown): DemosReactionKind | undefined {
  return typeof input === 'string' && REACTION_KINDS.has(input as DemosReactionKind)
    ? input as DemosReactionKind
    : undefined;
}

function sanitizeRelationOverride(raw: unknown): DemosRelationOverride | undefined {
  if (!isRecord(raw) || (raw.targetKind !== 'alife' && raw.targetKind !== 'player')) return undefined;
  const fromAlifeId = positiveId(raw.fromAlifeId);
  const targetAlifeId = raw.targetKind === 'alife' ? positiveId(raw.targetAlifeId) : undefined;
  if (fromAlifeId === undefined) return undefined;
  if (raw.targetKind === 'alife' && (targetAlifeId === undefined || fromAlifeId === targetAlifeId)) return undefined;
  const value = intIn(raw.value, DEMOS_RELATION_EMPTY, DEMOS_RELATION_EMPTY, DEMOS_RELATION_MAX);
  if (value === DEMOS_RELATION_EMPTY) return undefined;
  const postId = positiveId(raw.postId);
  const reactionId = positiveId(raw.reactionId);
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : undefined;
  return {
    fromAlifeId,
    targetKind: raw.targetKind,
    targetAlifeId,
    value,
    updatedAt,
    reasonTag: cleanOptionalText(raw.reasonTag, 48),
    postId,
    reactionId,
  };
}

function sanitizePost(raw: unknown): DemosPersistentPost | undefined {
  if (!isRecord(raw)) return undefined;
  const id = positiveId(raw.id);
  const authorAlifeId = positiveId(raw.authorAlifeId);
  const templateId = cleanOptionalText(raw.templateId, 96);
  if (id === undefined || authorAlifeId === undefined || templateId === undefined) return undefined;
  const mentionedAlifeIds = cleanIdArray(raw.mentionedAlifeIds);
  return {
    id,
    authorAlifeId,
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
    floorKey: cleanOptionalText(raw.floorKey, 96),
    sourceEventId: positiveId(raw.sourceEventId),
    parentPostId: positiveId(raw.parentPostId),
    templateId,
    seed: intIn(raw.seed, id, 1, 0x7fffffff),
    args: cleanStringArray(raw.args, DEMOS_POST_ARGS_CAP, DEMOS_PERSISTENT_POST_ARG_MAX_CHARS),
    mentionedAlifeIds,
    privacy: privacy(raw.privacy),
    tags: cleanTagArray(raw.tags),
    score: intIn(raw.score, 0, -9999, 9999),
  };
}

function sanitizeReaction(raw: unknown, validPostIds: Set<number>): DemosPersistentReaction | undefined {
  if (!isRecord(raw)) return undefined;
  const id = positiveId(raw.id);
  const postId = positiveId(raw.postId);
  const reactorAlifeId = positiveId(raw.reactorAlifeId);
  const kind = reactionKind(raw.kind);
  if (id === undefined || postId === undefined || reactorAlifeId === undefined || kind === undefined) return undefined;
  if (!validPostIds.has(postId)) return undefined;
  const rawDelta = raw.relationDelta;
  const relationDelta = rawDelta === undefined
    ? undefined
    : intIn(rawDelta, 0, DEMOS_REACTION_DELTA_MIN, DEMOS_REACTION_DELTA_MAX);
  return {
    id,
    postId,
    reactorAlifeId,
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
    kind,
    relationDelta,
    flags: raw.flags === undefined ? undefined : intIn(raw.flags, 0, 0, 0xffff),
  };
}

export function createEmptyDemosSocialSaveState(): DemosSocialSaveState {
  return {
    version: DEMOS_SOCIAL_SAVE_VERSION,
    cursor: 0,
    eventCursor: 0,
    nextPostId: 1,
    nextReactionId: 1,
    relationOverrides: [],
    posts: [],
    reactions: [],
  };
}

export function sanitizeDemosSocialSave(input: unknown): DemosSocialSaveState {
  if (!isRecord(input) || input.version !== DEMOS_SOCIAL_SAVE_VERSION) return createEmptyDemosSocialSaveState();
  const posts: DemosPersistentPost[] = [];
  const postIds = new Set<number>();
  for (const raw of Array.isArray(input.posts) ? input.posts.slice(-DEMOS_PERSISTENT_POST_CAP) : []) {
    const post = sanitizePost(raw);
    if (!post || postIds.has(post.id)) continue;
    postIds.add(post.id);
    posts.push(post);
  }
  const validPostIds = new Set(posts.map(post => post.id));
  for (const post of posts) {
    if (post.parentPostId !== undefined && !validPostIds.has(post.parentPostId)) {
      delete (post as { parentPostId?: number }).parentPostId;
    }
  }

  const reactions: DemosPersistentReaction[] = [];
  const reactionIds = new Set<number>();
  for (const raw of Array.isArray(input.reactions) ? input.reactions.slice(-DEMOS_PERSISTENT_REACTION_CAP) : []) {
    const reaction = sanitizeReaction(raw, validPostIds);
    if (!reaction || reactionIds.has(reaction.id)) continue;
    reactionIds.add(reaction.id);
    reactions.push(reaction);
  }

  const relationOverrides: DemosRelationOverride[] = [];
  for (const raw of Array.isArray(input.relationOverrides) ? input.relationOverrides.slice(-DEMOS_RELATION_OVERRIDE_CAP) : []) {
    const override = sanitizeRelationOverride(raw);
    if (override) relationOverrides.push(override);
  }

  const maxPostId = posts.reduce((max, post) => Math.max(max, post.id), 0);
  const maxReactionId = reactions.reduce((max, reaction) => Math.max(max, reaction.id), 0);
  return {
    version: DEMOS_SOCIAL_SAVE_VERSION,
    cursor: intIn(input.cursor, 0, 0, 0x7fffffff),
    eventCursor: intIn(input.eventCursor, 0, 0, 0x7fffffff),
    nextPostId: Math.max(intIn(input.nextPostId, 1, 1, 0x7fffffff), maxPostId + 1),
    nextReactionId: Math.max(intIn(input.nextReactionId, 1, 1, 0x7fffffff), maxReactionId + 1),
    relationOverrides,
    posts,
    reactions,
  };
}

export function demosSocialForSave(state: GameState): DemosSocialSaveState | undefined {
  const demosSocial = (state as DemosSocialStateHost).demosSocial;
  return demosSocial ? sanitizeDemosSocialSave(demosSocial) : undefined;
}

export function restoreDemosSocialFromSave(state: GameState, input: unknown): void {
  (state as DemosSocialStateHost).demosSocial = sanitizeDemosSocialSave(input);
}
