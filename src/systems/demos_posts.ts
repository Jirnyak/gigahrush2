import {
  DEMOS_AUTHOR_FALLBACK_CAP,
  DEMOS_EDGE_ENEMY,
  DEMOS_EDGE_FAMILY,
  DEMOS_EDGE_FRIEND,
  DEMOS_EDGE_HIDDEN,
  DEMOS_POST_MENTIONS_CAP,
  DEMOS_POST_ARG_MAX_CHARS,
  DEMOS_POST_ARGS_CAP,
  DEMOS_POST_RING_CAP,
  DEMOS_POST_TAG_MAX_CHARS,
  DEMOS_POST_TAGS_CAP,
  DEMOS_POST_TEMPLATES,
  DEMOS_POST_TEXT_MAX_CHARS,
  DEMOS_REACTIONS_PER_POST_CAP,
  DEMOS_REACTION_TEMPLATES,
  type DemosPostPrivacy,
  type DemosPostArgName,
  type DemosPostTemplateDef,
  type DemosReactionKind,
  type DemosReactionTemplateDef,
} from '../data/demos_posts';
import { Faction, FloorLevel, type WorldEvent, type WorldEventType } from '../core/types';
import type { AlifeNpcSnapshot } from './alife';
import {
  npcPackageSpeechContextTags,
  resolveNpcPackageForAlifeSnapshot,
} from './npc_package_speech';

export type DemosMarkovIntent = 'demos_post' | 'demos_reaction';
export type DemosMarkovSource = 'generated_markov' | 'curated_pool' | 'locked_author_text';

export interface DemosMarkovTextContext {
  actorAlifeId?: number;
  targetAlifeId?: number;
  floorKey?: string;
  floor?: FloorLevel;
  faction?: Faction;
  relationBand?: 'hostile' | 'cold' | 'neutral' | 'warm' | 'friend';
  socialEdgeFlags?: number;
  eventType?: string;
  eventId?: number;
  itemId?: string;
  itemName?: string;
  tags: readonly string[];
}

export interface DemosSpeechRouterRequest {
  intent: DemosMarkovIntent;
  source?: DemosMarkovSource;
  context: DemosMarkovTextContext;
  lockedText?: string;
  exactFallback?: string;
  repeatIndex?: number;
  maxChars?: number;
  seed?: number;
}

export interface DemosSpeechRouterResult {
  text: string;
  source: DemosMarkovSource;
  intent?: DemosMarkovIntent;
  templateId?: string;
  domainId?: string;
  tags: readonly string[];
  fallbackUsed: boolean;
}

export type DemosSpeechRouter = (request: DemosSpeechRouterRequest) => DemosSpeechRouterResult;

export interface DemosMarkovPost {
  id: number;
  authorAlifeId: number;
  createdAt: number;
  sourceEventId?: number;
  floorKey?: string;
  parentPostId?: number;
  templateId: string;
  seed: number;
  args: readonly string[];
  mentionedAlifeIds?: readonly number[];
  privacy?: DemosPostPrivacy;
  tags: readonly string[];
  score?: number;
}

export interface DemosPostQueue {
  nextId: number;
  lastSourceEventId: number;
  capacity: number;
  posts: DemosMarkovPost[];
}

export interface DemosPostAuthorFact {
  alifeId: number;
  name?: string;
  faction?: Faction;
  floorKey?: string;
  dead?: boolean;
  packageTags?: readonly string[];
}

export interface DemosPostCandidateOptions {
  now?: number;
  seedSalt?: number;
  allowPrivateEvents?: boolean;
  fallbackAuthorAlifeIds?: readonly number[];
  alifeIdForEntityId?: (entityId: number) => number | undefined;
  snapshotForAlifeId?: (alifeId: number) => DemosPostAuthorFact | undefined;
}

export interface DemosRenderTextOptions {
  routeSpeech?: DemosSpeechRouter;
  repeatIndex?: number;
}

export interface DemosRenderedText {
  text: string;
  source: DemosMarkovSource;
  templateId: string;
  domainId?: string;
  tags: readonly string[];
  fallbackUsed: boolean;
}

export interface DemosOutgoingSocialEdge {
  targetAlifeId: number;
  relation: number;
  flags?: number;
  tags?: readonly string[];
}

export interface DemosRenderReactionOptions extends DemosRenderTextOptions {
  maxReactions?: number;
  maxEdgesScanned?: number;
  onEdgeScanned?: (edge: DemosOutgoingSocialEdge, index: number) => void;
}

export interface DemosRenderedReaction extends DemosRenderedText {
  postId: number;
  reactorAlifeId: number;
  kind: DemosReactionKind;
  relation: number;
}

export interface DemosFeedPostView extends DemosRenderedText {
  id: number;
  authorAlifeId: number;
  createdAt: number;
  sourceEventId?: number;
}

export interface DemosFeedView {
  posts: readonly DemosFeedPostView[];
  total: number;
  capacity: number;
  emptyLabel: string;
}

const FLOOR_LABELS: Record<FloorLevel, string> = {
  [FloorLevel.MINISTRY]: 'Министерство',
  [FloorLevel.KVARTIRY]: 'Квартиры',
  [FloorLevel.LIVING]: 'Жилая зона',
  [FloorLevel.MAINTENANCE]: 'Коллекторы',
  [FloorLevel.HELL]: 'Нижний этаж',
  [FloorLevel.VOID]: '[ДАННЫЕ УДАЛЕНЫ]',
};

const EVENT_DETAIL_LABELS: Partial<Record<WorldEventType, string>> = {
  npc_kill_npc: 'Свидетели есть, шуток нет.',
  player_kill_npc: 'Запись уходит старшему по сектору.',
  death_seen: 'Проверьте своих по списку.',
  npc_kill_monster: 'Не подходите к остаткам без перчаток.',
  player_kill_monster: 'Следы от боя еще свежие.',
  fog_boss_killed: 'Дым не нюхать, проход не трогать.',
  item_stolen: 'Хозяин уже ищет свидетелей.',
  container_looted: 'Кладовщик ругается и считает полки.',
  ration_coupon_stolen: 'Без талона пайку не выдают.',
  room_lacked_resources: 'Работа стоит до пополнения.',
  room_blocked_production: 'Смена не может закрыть норму.',
  room_produced_items: 'Журнал поставки обновлен.',
  item_deposited: 'Поставку внесли в учет.',
  samosbor_warning: 'Укрытие ближе разговоров.',
  samosbor_started: 'Двери закрыть, воду держать рядом.',
  samosbor_zone_captured: 'Чужую зону не проверять одному.',
  samosbor_ended: 'После сирены считайте людей, не банки.',
  alife_migration: 'Маршрут отмечен без лишних разговоров.',
  floor_transition: 'Лифт записан, очередь видела.',
  quest_created: 'Нужны руки и трезвая голова.',
  quest_completed: 'Дело закрыто, награду не теряйте.',
  quest_failed: 'Дело сорвалось, последствия будут.',
  contract_created: 'Заявка висит до смены.',
  contract_completed: 'Контракт закрыт по журналу.',
  contract_failed: 'Контракт сорван, долг остался.',
  faction_event: 'Посторонним лучше обойти.',
  faction_patrol_clash: 'Патрули на взводе.',
  faction_relation_changed: 'Старые пропуска могут не сработать.',
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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

function hashString(seed: number, value: string): number {
  let h = seed >>> 0;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function cleanTag(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, DEMOS_POST_TAG_MAX_CHARS) : '';
}

function cleanTags(tags: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    if (out.length >= DEMOS_POST_TAGS_CAP) break;
    const tag = cleanTag(raw);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

function cleanArg(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  return String(raw).replace(/\s+/g, ' ').trim().slice(0, DEMOS_POST_ARG_MAX_CHARS);
}

function cleanText(raw: unknown, maxChars = DEMOS_POST_TEXT_MAX_CHARS): string {
  if (raw === undefined || raw === null) return '';
  return String(raw).replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function positiveId(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const id = Math.trunc(value);
  return id > 0 ? Math.min(id, 0x7fffffff) : undefined;
}

function dataAlifeId(data: Record<string, unknown> | undefined, key: string): number | undefined {
  return positiveId(data?.[key]);
}

function pushUniqueId(out: number[], id: number | undefined): void {
  if (id !== undefined && !out.includes(id)) out.push(id);
}

function entityAlifeId(opts: DemosPostCandidateOptions, entityId: number | undefined): number | undefined {
  if (entityId === undefined) return undefined;
  return positiveId(opts.alifeIdForEntityId?.(entityId));
}

function explicitAuthorIds(event: WorldEvent, opts: DemosPostCandidateOptions): number[] {
  const data = event.data;
  const out: number[] = [];
  pushUniqueId(out, dataAlifeId(data, 'authorAlifeId'));
  pushUniqueId(out, dataAlifeId(data, 'actorAlifeId'));
  pushUniqueId(out, entityAlifeId(opts, event.actorId));
  pushUniqueId(out, dataAlifeId(data, 'targetAlifeId'));
  pushUniqueId(out, entityAlifeId(opts, event.targetId));
  pushUniqueId(out, dataAlifeId(data, 'alifeId'));
  return out;
}

function targetAlifeId(event: WorldEvent, opts: DemosPostCandidateOptions): number | undefined {
  const data = event.data;
  return dataAlifeId(data, 'targetAlifeId')
    ?? dataAlifeId(data, 'victimAlifeId')
    ?? dataAlifeId(data, 'reactorAlifeId')
    ?? entityAlifeId(opts, event.targetId);
}

function eventFloorKey(event: WorldEvent): string | undefined {
  const key = cleanArg(isRecord(event.data) ? event.data.floorKey : undefined);
  return key || undefined;
}

function privacyForEvent(event: WorldEvent): DemosPostPrivacy {
  if (event.privacy === 'private' || event.privacy === 'secret') return 'private';
  if (event.privacy === 'local' || event.privacy === 'witnessed') return 'local';
  return 'public';
}

function mentionedAlifeIdsForEvent(
  event: WorldEvent,
  opts: DemosPostCandidateOptions,
  authorAlifeId: number,
  primaryTargetAlifeId: number | undefined,
): number[] | undefined {
  const data = event.data;
  const out: number[] = [];
  const pushMention = (id: number | undefined) => {
    if (out.length >= DEMOS_POST_MENTIONS_CAP) return;
    if (id !== undefined && id !== authorAlifeId && !out.includes(id)) out.push(id);
  };
  pushMention(primaryTargetAlifeId);
  pushMention(dataAlifeId(data, 'targetAlifeId'));
  pushMention(dataAlifeId(data, 'victimAlifeId'));
  pushMention(dataAlifeId(data, 'killerAlifeId'));
  pushMention(dataAlifeId(data, 'giverAlifeId'));
  pushMention(dataAlifeId(data, 'questTargetAlifeId'));
  pushMention(dataAlifeId(data, 'targetNpcAlifeId'));
  pushMention(entityAlifeId(opts, event.targetId));
  return out.length > 0 ? out : undefined;
}

function snapshotDead(snapshot: DemosPostAuthorFact | undefined): boolean {
  return snapshot?.dead === true;
}

function chooseAuthorAlifeId(event: WorldEvent, opts: DemosPostCandidateOptions): number | undefined {
  const explicit = explicitAuthorIds(event, opts);
  for (const id of explicit) {
    if (!snapshotDead(opts.snapshotForAlifeId?.(id))) return id;
  }
  const fallback = (opts.fallbackAuthorAlifeIds ?? [])
    .map(positiveId)
    .filter((id): id is number => id !== undefined);
  if (fallback.length === 0) return undefined;
  const start = hash32(event.id, event.time | 0, opts.seedSalt ?? 0) % fallback.length;
  const checked = Math.min(fallback.length, DEMOS_AUTHOR_FALLBACK_CAP);
  for (let i = 0; i < checked; i++) {
    const id = fallback[(start + i) % fallback.length];
    if (!snapshotDead(opts.snapshotForAlifeId?.(id))) return id;
  }
  return undefined;
}

function templateForEvent(event: WorldEvent): DemosPostTemplateDef | undefined {
  const matches = DEMOS_POST_TEMPLATES.filter(template => template.eventTypes.includes(event.type));
  if (matches.length === 0) return undefined;
  return matches[hash32(event.id, event.time | 0, event.severity) % matches.length];
}

function eventPlace(event: WorldEvent): string {
  const dataFloorKey = cleanArg(isRecord(event.data) ? event.data.floorKey : undefined);
  if (event.roomId !== undefined) return `комната ${Math.floor(event.roomId)}`;
  if (event.zoneId !== undefined) return `зона ${Math.floor(event.zoneId)}`;
  if (dataFloorKey) return dataFloorKey;
  return FLOOR_LABELS[event.floor] ?? 'этот этаж';
}

function dataString(event: WorldEvent, key: string): string {
  const value = isRecord(event.data) ? event.data[key] : undefined;
  return typeof value === 'string' ? value : '';
}

function eventItem(event: WorldEvent): string {
  return cleanArg(event.itemName || dataString(event, 'resourceName') || dataString(event, 'itemName') || event.targetName || 'учетная позиция');
}

function eventDetail(event: WorldEvent): string {
  return cleanArg(dataString(event, 'reason') || dataString(event, 'status') || EVENT_DETAIL_LABELS[event.type] || event.type);
}

function actorName(authorAlifeId: number, event: WorldEvent, author: DemosPostAuthorFact | undefined): string {
  return cleanArg(author?.name || event.actorName || `alife:${authorAlifeId}`);
}

function targetName(event: WorldEvent, target: DemosPostAuthorFact | undefined): string {
  return cleanArg(target?.name || event.targetName || event.itemName || dataString(event, 'targetName') || 'цель по журналу');
}

function argValue(
  name: DemosPostArgName,
  event: WorldEvent,
  authorAlifeId: number,
  author: DemosPostAuthorFact | undefined,
  target: DemosPostAuthorFact | undefined,
): string {
  switch (name) {
    case 'actor': return actorName(authorAlifeId, event, author);
    case 'target': return targetName(event, target);
    case 'item': return eventItem(event);
    case 'place': return eventPlace(event);
    case 'event': return event.type;
    case 'detail': return eventDetail(event);
  }
}

function buildArgs(
  template: DemosPostTemplateDef,
  event: WorldEvent,
  authorAlifeId: number,
  author: DemosPostAuthorFact | undefined,
  target: DemosPostAuthorFact | undefined,
): string[] {
  return template.argNames
    .slice(0, DEMOS_POST_ARGS_CAP)
    .map(name => argValue(name, event, authorAlifeId, author, target));
}

function postSeed(event: WorldEvent, templateId: string, authorAlifeId: number, seedSalt = 0): number {
  return hashString(hash32(event.id, authorAlifeId, seedSalt), `${event.type}:${templateId}`) || 1;
}

function pushPost(queue: DemosPostQueue, post: DemosMarkovPost): void {
  queue.posts.push(post);
  while (queue.posts.length > queue.capacity) queue.posts.shift();
}

function finiteTime(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function demosPostAuthorFactFromSnapshot(snapshot: AlifeNpcSnapshot): DemosPostAuthorFact {
  const pack = resolveNpcPackageForAlifeSnapshot(snapshot);
  return {
    alifeId: snapshot.id,
    name: snapshot.name,
    faction: snapshot.faction,
    floorKey: snapshot.floorKey,
    dead: snapshot.dead,
    packageTags: pack ? npcPackageSpeechContextTags(pack, snapshot, 'demos_post') : undefined,
  };
}

export function createDemosPostQueue(capacity = DEMOS_POST_RING_CAP): DemosPostQueue {
  return {
    nextId: 1,
    lastSourceEventId: 0,
    capacity: clampInt(capacity, DEMOS_POST_RING_CAP, 1, DEMOS_POST_RING_CAP),
    posts: [],
  };
}

export function enqueueDemosPostFromEvent(
  queue: DemosPostQueue,
  event: WorldEvent,
  opts: DemosPostCandidateOptions = {},
): DemosMarkovPost | undefined {
  if (event.id <= queue.lastSourceEventId) return undefined;
  if (!opts.allowPrivateEvents && (event.privacy === 'private' || event.privacy === 'secret')) {
    queue.lastSourceEventId = Math.max(queue.lastSourceEventId, event.id);
    return undefined;
  }
  const template = templateForEvent(event);
  if (!template) {
    queue.lastSourceEventId = Math.max(queue.lastSourceEventId, event.id);
    return undefined;
  }
  const authorAlifeId = chooseAuthorAlifeId(event, opts);
  if (authorAlifeId === undefined) {
    queue.lastSourceEventId = Math.max(queue.lastSourceEventId, event.id);
    return undefined;
  }
  const author = opts.snapshotForAlifeId?.(authorAlifeId);
  if (snapshotDead(author)) {
    queue.lastSourceEventId = Math.max(queue.lastSourceEventId, event.id);
    return undefined;
  }
  const targetId = targetAlifeId(event, opts);
  const target = targetId !== undefined ? opts.snapshotForAlifeId?.(targetId) : undefined;
  const packageTags = [
    ...(author?.packageTags ?? []),
    ...(target?.packageTags ?? []),
  ];
  const seed = postSeed(event, template.id, authorAlifeId, opts.seedSalt);
  const post: DemosMarkovPost = {
    id: queue.nextId++,
    authorAlifeId,
    createdAt: finiteTime(event.time, opts.now ?? 0),
    sourceEventId: event.id,
    floorKey: eventFloorKey(event),
    templateId: template.id,
    seed,
    args: buildArgs(template, event, authorAlifeId, author, target),
    mentionedAlifeIds: mentionedAlifeIdsForEvent(event, opts, authorAlifeId, targetId),
    privacy: privacyForEvent(event),
    tags: cleanTags([template.domain, event.type, ...template.tags, ...event.tags, ...packageTags]),
    score: 0,
  };
  pushPost(queue, post);
  queue.lastSourceEventId = Math.max(queue.lastSourceEventId, event.id);
  return post;
}

export function enqueueDemosPostsFromEvents(
  queue: DemosPostQueue,
  events: readonly WorldEvent[],
  opts: DemosPostCandidateOptions = {},
): DemosMarkovPost[] {
  const fresh = events
    .filter(event => event.id > queue.lastSourceEventId)
    .slice()
    .sort((a, b) => a.id - b.id);
  const out: DemosMarkovPost[] = [];
  for (const event of fresh) {
    const post = enqueueDemosPostFromEvent(queue, event, opts);
    if (post) out.push(post);
  }
  return out;
}

function templateById(templateId: string): DemosPostTemplateDef | undefined {
  return DEMOS_POST_TEMPLATES.find(template => template.id === templateId);
}

function reactionTemplateByKind(kind: DemosReactionKind): DemosReactionTemplateDef {
  return DEMOS_REACTION_TEMPLATES.find(template => template.kind === kind) ?? DEMOS_REACTION_TEMPLATES[0];
}

function templateArgs(template: DemosPostTemplateDef, args: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < template.argNames.length && i < args.length; i++) {
    out[template.argNames[i]] = cleanArg(args[i]);
  }
  return out;
}

function fillTemplate(pattern: string, values: Record<string, string>): string {
  return pattern.replace(/\{([a-z_]+)\}/g, (_match, key: string) => values[key] || '...');
}

function postFallback(post: DemosMarkovPost): string {
  const template = templateById(post.templateId);
  if (!template) return 'Пост Демоса поврежден: есть событие, но нет шаблона.';
  const variants = template.fallbacks.length > 0 ? template.fallbacks : ['{detail}'];
  const pattern = variants[post.seed % variants.length];
  return cleanText(fillTemplate(pattern, templateArgs(template, post.args)));
}

function postContext(post: DemosMarkovPost): DemosMarkovTextContext {
  const template = templateById(post.templateId);
  const values = template ? templateArgs(template, post.args) : {};
  const mentionTags = (post.mentionedAlifeIds ?? []).map(id => `mention.alife.${id}`);
  return {
    actorAlifeId: post.authorAlifeId,
    targetAlifeId: post.mentionedAlifeIds?.[0],
    floorKey: post.floorKey,
    eventId: post.sourceEventId,
    eventType: post.tags.find(tag => tag.includes('_')),
    itemName: values.item,
    tags: cleanTags([
      ...post.tags,
      ...mentionTags,
      ...(post.parentPostId !== undefined ? [`parent_post.${post.parentPostId}`, 'reply'] : []),
      ...(post.privacy ? [`privacy.${post.privacy}`] : []),
    ]),
  };
}

function defaultRouteSpeech(request: DemosSpeechRouterRequest): DemosSpeechRouterResult {
  const text = cleanText(request.lockedText ?? request.exactFallback ?? '', request.maxChars ?? DEMOS_POST_TEXT_MAX_CHARS);
  return {
    text,
    source: request.lockedText ? 'locked_author_text' : 'curated_pool',
    intent: request.intent,
    tags: request.context.tags,
    fallbackUsed: request.lockedText === undefined,
  };
}

function boundedResult(
  result: DemosSpeechRouterResult,
  fallback: string,
  templateId: string,
  tags: readonly string[],
  maxChars: number,
  domainId?: string,
): DemosRenderedText {
  const text = cleanText(result.text || fallback, maxChars);
  return {
    text,
    source: result.source,
    templateId: result.templateId ?? templateId,
    domainId: result.domainId ?? domainId,
    tags: result.tags.length > 0 ? cleanTags(result.tags) : tags,
    fallbackUsed: result.fallbackUsed,
  };
}

export function renderDemosMarkovPostText(
  post: DemosMarkovPost,
  opts: DemosRenderTextOptions = {},
): DemosRenderedText {
  const template = templateById(post.templateId);
  const fallback = postFallback(post);
  const routeSpeech = opts.routeSpeech ?? defaultRouteSpeech;
  const result = routeSpeech({
    intent: 'demos_post',
    source: 'generated_markov',
    context: postContext(post),
    exactFallback: fallback,
    repeatIndex: opts.repeatIndex ?? (post.seed & 7),
    maxChars: DEMOS_POST_TEXT_MAX_CHARS,
    seed: post.seed,
  });
  return boundedResult(result, fallback, post.templateId, post.tags, DEMOS_POST_TEXT_MAX_CHARS, template?.domain);
}

function relationBand(relation: number): DemosMarkovTextContext['relationBand'] {
  const r = clampInt(relation, 0, -127, 127);
  if (r <= -64) return 'hostile';
  if (r < 0) return 'cold';
  if (r < 32) return 'neutral';
  if (r < 64) return 'warm';
  return 'friend';
}

export function chooseDemosReactionKind(post: DemosMarkovPost, edge: DemosOutgoingSocialEdge, seed: number): DemosReactionKind {
  const flags = edge.flags ?? 0;
  const relation = clampInt(edge.relation, 0, -127, 127);
  if (post.tags.includes('death') && (flags & (DEMOS_EDGE_FAMILY | DEMOS_EDGE_FRIEND)) !== 0) return 'grief';
  if ((flags & DEMOS_EDGE_ENEMY) !== 0 || relation <= -96) return seed & 1 ? 'threat' : 'anger';
  if (relation <= -64) return 'anger';
  if (post.tags.includes('shortage') && relation >= 32) return 'help';
  if (relation >= 64) return 'like';
  if (relation < 0) return 'dislike';
  return seed % 3 === 0 ? 'joke' : 'rumor';
}

function reactionFallback(template: DemosReactionTemplateDef, seed: number): string {
  const variants = template.fallbacks.length > 0 ? template.fallbacks : ['Отмечено.'];
  return variants[seed % variants.length];
}

export function renderDemosReactionsForPost(
  post: DemosMarkovPost,
  outgoingEdges: readonly DemosOutgoingSocialEdge[],
  opts: DemosRenderReactionOptions = {},
): DemosRenderedReaction[] {
  const maxReactions = clampInt(opts.maxReactions, DEMOS_REACTIONS_PER_POST_CAP, 0, DEMOS_REACTIONS_PER_POST_CAP);
  const maxEdgesScanned = clampInt(opts.maxEdgesScanned, DEMOS_REACTIONS_PER_POST_CAP * 2, 0, DEMOS_REACTIONS_PER_POST_CAP * 2);
  if (maxReactions <= 0 || maxEdgesScanned <= 0) return [];
  const routeSpeech = opts.routeSpeech ?? defaultRouteSpeech;
  const out: DemosRenderedReaction[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < outgoingEdges.length && i < maxEdgesScanned && out.length < maxReactions; i++) {
    const edge = outgoingEdges[i];
    opts.onEdgeScanned?.(edge, i);
    const reactorAlifeId = positiveId(edge.targetAlifeId);
    if (reactorAlifeId === undefined || reactorAlifeId === post.authorAlifeId || seen.has(reactorAlifeId)) continue;
    if (((edge.flags ?? 0) & DEMOS_EDGE_HIDDEN) !== 0) continue;
    seen.add(reactorAlifeId);
    const seed = hash32(post.seed, reactorAlifeId, edge.flags ?? 0);
    const kind = chooseDemosReactionKind(post, edge, seed);
    const template = reactionTemplateByKind(kind);
    const tags = cleanTags([...post.tags, ...template.tags, ...(edge.tags ?? [])]);
    const fallback = reactionFallback(template, seed);
    const result = routeSpeech({
      intent: 'demos_reaction',
      source: 'generated_markov',
      context: {
        actorAlifeId: reactorAlifeId,
        targetAlifeId: post.authorAlifeId,
        eventId: post.sourceEventId,
        relationBand: relationBand(edge.relation),
        socialEdgeFlags: edge.flags ?? 0,
        tags,
      },
      exactFallback: fallback,
      repeatIndex: opts.repeatIndex ?? (seed & 7),
      maxChars: DEMOS_POST_TEXT_MAX_CHARS,
      seed,
    });
    out.push({
      ...boundedResult(result, fallback, template.id, tags, DEMOS_POST_TEXT_MAX_CHARS, kind),
      postId: post.id,
      reactorAlifeId,
      kind,
      relation: clampInt(edge.relation, 0, -127, 127),
    });
  }
  return out;
}

export function buildDemosFeedView(
  queue: DemosPostQueue,
  opts: DemosRenderTextOptions = {},
): DemosFeedView {
  const posts = queue.posts
    .slice()
    .reverse()
    .map(post => ({
      ...renderDemosMarkovPostText(post, opts),
      id: post.id,
      authorAlifeId: post.authorAlifeId,
      createdAt: post.createdAt,
      sourceEventId: post.sourceEventId,
    }));
  return {
    posts,
    total: queue.posts.length,
    capacity: queue.capacity,
    emptyLabel: 'В ленте Демоса пока нет событий с реальным автором.',
  };
}

export function validateDemosPostData(): readonly string[] {
  const errors: string[] = [];
  const postIds = new Set<string>();
  for (const template of DEMOS_POST_TEMPLATES) {
    if (postIds.has(template.id)) errors.push(`duplicate demos post template id ${template.id}`);
    postIds.add(template.id);
    if (template.eventTypes.length === 0) errors.push(`demos post template ${template.id} has no event types`);
    if (template.fallbacks.length === 0) errors.push(`demos post template ${template.id} has no fallback`);
    if (template.argNames.length > DEMOS_POST_ARGS_CAP) errors.push(`demos post template ${template.id} exceeds arg cap`);
  }
  const reactionIds = new Set<string>();
  for (const template of DEMOS_REACTION_TEMPLATES) {
    if (reactionIds.has(template.id)) errors.push(`duplicate demos reaction template id ${template.id}`);
    reactionIds.add(template.id);
    if (template.fallbacks.length === 0) errors.push(`demos reaction template ${template.id} has no fallback`);
  }
  return errors;
}
