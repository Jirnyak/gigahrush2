/* -- Demos quest notice adapters: cold affordance, face-to-face handoff -- */

import {
  Faction,
  FloorLevel,
  type GameState,
  type Quest,
  type WorldEvent,
  type WorldEventPrivacy,
  type WorldEventSeverity,
} from '../core/types';
import {
  CONTRACTS,
  questTargetEventData,
  type ContractDef,
  type QuestRouteTarget,
} from '../data/contracts';
import { occupationHasProfileTag } from '../data/occupation_profiles';
import {
  DEMOS_QUEST_NOTICE_CAP,
  DEMOS_QUEST_NOTICES_PER_PROFILE,
  DEMOS_QUEST_NOTICES_PER_SOCIAL_TICK,
  type DemosQuestBoardView,
  type DemosQuestNotice,
  type DemosQuestNoticeView,
} from '../data/demos_quest_notices';
import type { AlifeNpcSnapshot } from './alife';
import { publishEvent } from './events';
import {
  cleanFloorKey,
  floorKeyBaseFloor,
  floorKeyForStory,
  floorKeyKind,
  floorKeyZ,
} from './floor_keys';
import { lowerDemosCandidateContext } from './markov_context';
import {
  generateMarkovText,
  routeSpeech,
  type MarkovSource,
  type SpeechRouterResult,
} from './speech_router';
import { currentFloorRunEntry, floorRunEntryFloorKey } from './procedural_floors';

export interface DemosQuestNoticeContext {
  nowMinutes?: number;
  seed?: number | string;
  floorKey?: string;
  floor?: FloorLevel;
  routeZ?: number;
  sourcePostId?: number;
  sourceEventId?: number;
  sourceEvent?: WorldEvent;
  sourceTags?: readonly string[];
  traitTags?: readonly string[];
  relationToPlayer?: number;
  socialRelationToTarget?: number;
  itemId?: string;
  itemName?: string;
  monsterKind?: number;
  shortageResourceId?: string;
  urgencyBias?: number;
  contracts?: readonly ContractDef[];
}

export interface DemosQuestNoticeRefreshOptions extends DemosQuestNoticeContext {
  limit?: number;
}

export interface DemosQuestBoardOptions {
  alifeId?: number;
  floorKey?: string;
  includeAccepted?: boolean;
  includeFailed?: boolean;
  limit?: number;
}

export interface DemosQuestNoticeSpeechOptions {
  notice: DemosQuestNotice;
  giverSnapshot?: AlifeNpcSnapshot;
  lockedText?: string;
  exactFallback?: string;
  repeatIndex?: number;
  maxChars?: number;
  seed?: number | string;
  source?: MarkovSource;
  relationToPlayer?: number;
  socialEdgeFlags?: number;
  traitTags?: readonly string[];
}

export interface DemosQuestNoticeHandoffOptions {
  actorId?: number;
  actorName?: string;
  actorFaction?: Faction;
  targetName?: string;
  severity?: WorldEventSeverity;
  privacy?: WorldEventPrivacy;
  tags?: readonly string[];
  data?: Record<string, unknown>;
}

type DemosQuestNoticeHost = GameState & {
  demosQuestNotices?: DemosQuestNotice[] | { notices?: DemosQuestNotice[] };
  floorRun?: { specs?: Record<string, unknown> };
};

const CONTRACT_BY_ID = new Map<string, ContractDef>(CONTRACTS.map(def => [def.id, def]));
const MAX_NOTICE_TAGS = 16;
const MAX_NOTICE_TAG_LEN = 32;
const MAX_NOTICE_DETAIL = 132;
const MAX_FAILED_REASON = 48;

const FLOOR_LABELS: Record<FloorLevel, string> = {
  [FloorLevel.MINISTRY]: 'Министерство',
  [FloorLevel.KVARTIRY]: 'Квартиры',
  [FloorLevel.LIVING]: 'Жилая зона',
  [FloorLevel.MAINTENANCE]: 'Коллекторы',
  [FloorLevel.HELL]: 'Ад',
  [FloorLevel.VOID]: 'Пустота',
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

function cleanTag(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[^a-zA-Z0-9_.:-]/g, '_')
    .slice(0, MAX_NOTICE_TAG_LEN);
}

function cleanTags(tags: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    if (out.length >= MAX_NOTICE_TAGS) break;
    const tag = cleanTag(raw);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

function hashNoticeId(parts: readonly unknown[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const text = String(part ?? '');
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x1f;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h & 0x7fffffff) || 1;
}

function nowMinutes(state: GameState, context: DemosQuestNoticeContext): number {
  return clampInt(context.nowMinutes, 0, 10_000_000, state.clock?.totalMinutes ?? 0);
}

type LooseQuestRouteTarget = QuestRouteTarget | NonNullable<Quest['targetRoute']>;

function cloneRouteTarget(route: LooseQuestRouteTarget | undefined): QuestRouteTarget | undefined {
  if (!route) return undefined;
  const out: QuestRouteTarget = {};
  if (route.designFloorId) out.designFloorId = route.designFloorId as QuestRouteTarget['designFloorId'];
  if (typeof route.z === 'number' && Number.isFinite(route.z)) out.z = Math.trunc(route.z);
  if (route.anomalyId) out.anomalyId = route.anomalyId as QuestRouteTarget['anomalyId'];
  if (route.proceduralTag) out.proceduralTag = route.proceduralTag;
  if (route.tags?.length) out.tags = [...route.tags];
  if (route.label) out.label = route.label;
  if (route.risk !== undefined) out.risk = clampInt(route.risk, 1, 5, 1);
  return Object.keys(out).length > 0 ? out : undefined;
}

function noticeStore(state: GameState): DemosQuestNotice[] {
  const host = state as DemosQuestNoticeHost;
  if (Array.isArray(host.demosQuestNotices)) return host.demosQuestNotices;
  if (host.demosQuestNotices?.notices) return host.demosQuestNotices.notices;
  const store: { notices: DemosQuestNotice[] } = { notices: [] };
  host.demosQuestNotices = store;
  return store.notices;
}

function sortNotices(a: DemosQuestNotice, b: DemosQuestNotice): number {
  if (b.urgency !== a.urgency) return b.urgency - a.urgency;
  if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
  return a.id - b.id;
}

function trimNoticeStore(notices: DemosQuestNotice[]): void {
  if (notices.length <= DEMOS_QUEST_NOTICE_CAP) return;
  notices.sort((a, b) => {
    const aClosed = a.acceptedQuestId !== undefined || a.failedReason !== undefined ? 1 : 0;
    const bClosed = b.acceptedQuestId !== undefined || b.failedReason !== undefined ? 1 : 0;
    if (bClosed !== aClosed) return bClosed - aClosed;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id - b.id;
  });
  notices.splice(0, notices.length - DEMOS_QUEST_NOTICE_CAP);
  notices.sort(sortNotices);
}

function currentRouteFloorKey(state: GameState): string {
  try {
    return floorRunEntryFloorKey(currentFloorRunEntry(state));
  } catch {
    return floorKeyForStory(state.currentFloor);
  }
}

function contextFloorKey(snapshot: AlifeNpcSnapshot, context: DemosQuestNoticeContext): string {
  const explicit = cleanFloorKey(context.floorKey);
  if (explicit) return explicit;
  const source = cleanFloorKey(snapshot.floorKey);
  return source || floorKeyForStory(context.floor ?? snapshot.floor);
}

function floorLabel(state: GameState, floorKey: string): string {
  const host = state as DemosQuestNoticeHost;
  const context = { proceduralSpecs: host.floorRun?.specs as Record<string, never> | undefined };
  const z = floorKeyZ(floorKey, context);
  const base = floorKeyBaseFloor(floorKey, context);
  const baseLabel = base !== undefined ? FLOOR_LABELS[base] : undefined;
  if (z !== undefined && baseLabel) return `Этаж ${Math.trunc(z)}, ${baseLabel}`;
  if (z !== undefined) return `Этаж ${Math.trunc(z)}`;
  if (baseLabel) return `${baseLabel}, маршрут без номера`;
  return floorKeyKind(floorKey) === 'floor_instance' ? 'маршрут без номера' : 'неуточненный этаж';
}

function urgencyLabel(urgency: number): string {
  if (urgency >= 5) return 'горит';
  if (urgency >= 4) return 'срочно';
  if (urgency >= 3) return 'важно';
  if (urgency >= 2) return 'обычно';
  return 'терпит';
}

function activeNotice(notice: DemosQuestNotice, now: number): boolean {
  if (notice.acceptedQuestId !== undefined || notice.failedReason !== undefined) return false;
  return notice.expiresAtMinutes === undefined || notice.expiresAtMinutes > now;
}

function contractOccupationScore(def: ContractDef, snapshot: AlifeNpcSnapshot): number {
  const tags = new Set(def.tags);
  let score = 0;
  if (tags.has('maintenance') && occupationHasProfileTag(snapshot.occupation, 'maintenance')) score += 5;
  if (tags.has('medicine') && occupationHasProfileTag(snapshot.occupation, 'medicine')) score += 5;
  if (tags.has('science') && (occupationHasProfileTag(snapshot.occupation, 'science') || snapshot.faction === Faction.SCIENTIST)) score += 5;
  if ((tags.has('paper') || tags.has('documents') || tags.has('admin')) && occupationHasProfileTag(snapshot.occupation, 'paper')) score += 4;
  if ((tags.has('food') || tags.has('kitchen')) && occupationHasProfileTag(snapshot.occupation, 'food')) score += 4;
  if ((tags.has('combat') || tags.has('monster')) && (occupationHasProfileTag(snapshot.occupation, 'combat') || snapshot.faction === Faction.LIQUIDATOR)) score += 4;
  if (tags.has('black_market') && occupationHasProfileTag(snapshot.occupation, 'black_market')) score += 4;
  if (tags.has('cult') && occupationHasProfileTag(snapshot.occupation, 'cult')) score += 4;
  return score;
}

function contractContextScore(def: ContractDef, snapshot: AlifeNpcSnapshot, context: DemosQuestNoticeContext): number {
  if (def.tags.includes('debug_only')) return -Infinity;
  let score = 1;
  if (def.faction === snapshot.faction) score += 8;
  else if (def.faction === Faction.CITIZEN || snapshot.faction === Faction.CITIZEN) score += 1;
  if (def.target.floor === snapshot.floor) score += 2;
  score += contractOccupationScore(def, snapshot);
  const rankBand = Math.max(1, Math.ceil(snapshot.level / 10));
  if (def.rank <= rankBand + 1) score += 2;
  else score -= Math.min(4, def.rank - rankBand);
  const sourceTags = new Set([...(context.sourceTags ?? []), ...(context.sourceEvent?.tags ?? [])]);
  for (const tag of def.tags) if (sourceTags.has(tag)) score += 3;
  if (context.shortageResourceId && def.rewardResourceId === context.shortageResourceId) score += 5;
  if (context.itemId && def.targetItem === context.itemId) score += 5;
  if (context.monsterKind !== undefined && def.targetMonsterKind === context.monsterKind) score += 5;
  if (context.sourceEvent?.type === 'room_lacked_resources' && (def.tags.includes('scarcity') || def.tags.includes('supply'))) score += 4;
  if (context.sourceEvent?.type === 'faction_event' && def.faction === snapshot.faction) score += 3;
  if (context.sourceEvent?.type === 'samosbor_ended' && (def.tags.includes('repair') || def.tags.includes('supply') || def.tags.includes('medicine'))) score += 3;
  return score;
}

function selectedContract(
  state: GameState,
  snapshot: AlifeNpcSnapshot,
  context: DemosQuestNoticeContext,
): ContractDef | undefined {
  const existingContracts = new Set(state.quests.map(q => q.contractId).filter((id): id is string => !!id));
  const pool = context.contracts ?? CONTRACTS;
  return pool
    .filter(def => !existingContracts.has(def.id))
    .map(def => ({
      def,
      score: contractContextScore(def, snapshot, context),
      tie: hashNoticeId([context.seed ?? 0, snapshot.id, def.id, snapshot.floorKey]),
    }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || a.tie - b.tie)[0]?.def;
}

function noticeUrgency(def: ContractDef, context: DemosQuestNoticeContext): number {
  const routeRisk = def.target.route?.risk ?? (def.tags.includes('combat') ? 3 : undefined);
  const eventSeverity = context.sourceEvent?.severity;
  const raw = Math.max(def.rank, routeRisk ?? 1, eventSeverity ?? 1) + (context.urgencyBias ?? 0);
  return clampInt(raw, 1, 5, 2);
}

function noticeTags(snapshot: AlifeNpcSnapshot, def: ContractDef, context: DemosQuestNoticeContext): string[] {
  return cleanTags([
    'quest_notice',
    'requires_visit',
    'contract',
    `giver_faction.${snapshot.faction}`,
    `occupation.${snapshot.occupation}`,
    ...def.tags,
    ...(def.target.route?.tags ?? []),
    ...(context.sourceTags ?? []),
    ...(context.sourceEvent?.tags ?? []),
    ...(context.traitTags ?? []),
  ]);
}

export function selectDemosProceduralQuestNotice(
  state: GameState,
  giverSnapshot: AlifeNpcSnapshot,
  context: DemosQuestNoticeContext = {},
): DemosQuestNotice | undefined {
  if (giverSnapshot.dead || !giverSnapshot.canGiveQuest) return undefined;
  const existing = noticeStore(state).find(notice =>
    notice.giverAlifeId === giverSnapshot.id && activeNotice(notice, nowMinutes(state, context)));
  if (existing) return { ...existing, tags: [...existing.tags], targetRoute: cloneRouteTarget(existing.targetRoute) };

  const def = selectedContract(state, giverSnapshot, context);
  if (!def) return undefined;
  const createdAt = nowMinutes(state, context);
  const floorKey = contextFloorKey(giverSnapshot, context);
  const sourceEventId = context.sourceEventId ?? context.sourceEvent?.id;
  const sourcePostId = context.sourcePostId;
  const urgency = noticeUrgency(def, context);
  const id = hashNoticeId([
    context.seed ?? 'demos_notice',
    giverSnapshot.id,
    floorKey,
    def.id,
    sourceEventId ?? 0,
    sourcePostId ?? 0,
    Math.floor(createdAt / (24 * 60)),
  ]);
  return {
    id,
    giverAlifeId: giverSnapshot.id,
    createdAt,
    floorKey,
    templateId: `contract:${def.id}`,
    contractId: def.id,
    targetRoute: cloneRouteTarget(def.target.route),
    tags: noticeTags(giverSnapshot, def, context),
    urgency,
    expiresAtMinutes: createdAt + 180 + urgency * 60,
    sourcePostId,
    sourceEventId,
  };
}

export function upsertDemosQuestNotice(state: GameState, notice: DemosQuestNotice): DemosQuestNotice {
  const notices = noticeStore(state);
  const existing = notices.findIndex(item => item.id === notice.id);
  const stored: DemosQuestNotice = {
    ...notice,
    tags: cleanTags(notice.tags),
    targetRoute: cloneRouteTarget(notice.targetRoute),
  };
  if (existing >= 0) notices[existing] = { ...notices[existing], ...stored };
  else notices.push(stored);
  trimNoticeStore(notices);
  return stored;
}

export function ensureDemosQuestNoticeForProfile(
  state: GameState,
  snapshot: AlifeNpcSnapshot,
  context: DemosQuestNoticeContext = {},
): DemosQuestNotice | undefined {
  const notice = selectDemosProceduralQuestNotice(state, snapshot, context);
  return notice ? upsertDemosQuestNotice(state, notice) : undefined;
}

export function refreshDemosQuestNoticesFromSnapshots(
  state: GameState,
  snapshots: readonly AlifeNpcSnapshot[],
  options: DemosQuestNoticeRefreshOptions = {},
): readonly DemosQuestNotice[] {
  const maxCreated = Math.min(
    DEMOS_QUEST_NOTICES_PER_SOCIAL_TICK,
    clampInt(options.limit, 0, DEMOS_QUEST_NOTICES_PER_SOCIAL_TICK, DEMOS_QUEST_NOTICES_PER_SOCIAL_TICK),
  );
  const created: DemosQuestNotice[] = [];
  for (const snapshot of snapshots) {
    if (created.length >= maxCreated) break;
    const before = noticeStore(state).length;
    const notice = ensureDemosQuestNoticeForProfile(state, snapshot, options);
    if (notice && (noticeStore(state).length > before || !created.some(item => item.id === notice.id))) {
      created.push(notice);
    }
  }
  return created;
}

function contractForNotice(notice: DemosQuestNotice): ContractDef | undefined {
  return notice.contractId ? CONTRACT_BY_ID.get(notice.contractId) : undefined;
}

function compactText(text: string, max = MAX_NOTICE_DETAIL): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function noticeView(state: GameState, notice: DemosQuestNotice, acceptFloorKey: string): DemosQuestNoticeView {
  const def = contractForNotice(notice);
  const label = compactText(def?.title ?? notice.templateId, 54);
  const hint = def?.target.hint ?? def?.desc ?? 'Заявка видна, но принять её можно только у человека.';
  return {
    id: notice.id,
    giverAlifeId: notice.giverAlifeId,
    label,
    detail: compactText(`${hint} Нужно прийти на этаж и поговорить.`),
    floorLabel: floorLabel(state, notice.floorKey),
    urgencyLabel: urgencyLabel(notice.urgency),
    canAcceptHere: cleanFloorKey(notice.floorKey) === cleanFloorKey(acceptFloorKey),
    requiresVisit: true,
  };
}

export function getDemosQuestNoticesForProfile(
  state: GameState,
  alifeId: number,
): readonly DemosQuestNoticeView[] {
  const now = nowMinutes(state, {});
  const acceptFloorKey = currentRouteFloorKey(state);
  return noticeStore(state)
    .filter(notice => notice.giverAlifeId === alifeId && activeNotice(notice, now))
    .sort(sortNotices)
    .slice(0, DEMOS_QUEST_NOTICES_PER_PROFILE)
    .map(notice => noticeView(state, notice, acceptFloorKey));
}

export function getDemosQuestBoardView(
  state: GameState,
  opts: DemosQuestBoardOptions = {},
): DemosQuestBoardView {
  const now = nowMinutes(state, {});
  const acceptFloorKey = opts.floorKey ? cleanFloorKey(opts.floorKey) : currentRouteFloorKey(state);
  const limit = clampInt(opts.limit, 1, DEMOS_QUEST_NOTICE_CAP, DEMOS_QUEST_NOTICES_PER_PROFILE);
  const notices = noticeStore(state)
    .filter(notice =>
      (opts.alifeId === undefined || notice.giverAlifeId === opts.alifeId) &&
      (opts.includeAccepted || notice.acceptedQuestId === undefined) &&
      (opts.includeFailed || notice.failedReason === undefined) &&
      (notice.expiresAtMinutes === undefined || notice.expiresAtMinutes > now)
    )
    .sort(sortNotices);
  return {
    notices: notices.slice(0, limit).map(notice => noticeView(state, notice, acceptFloorKey)),
    total: notices.length,
    capped: notices.length > limit,
    requiresVisitHint: 'Заявка видна, но принять её можно только у человека.',
  };
}

function findNotice(state: GameState, noticeId: number): DemosQuestNotice | undefined {
  return noticeStore(state).find(notice => notice.id === noticeId);
}

export function activeDemosQuestNoticeForGiver(
  state: GameState,
  giverAlifeId: number | undefined,
): DemosQuestNotice | undefined {
  if (giverAlifeId === undefined || !Number.isFinite(giverAlifeId) || giverAlifeId <= 0) return undefined;
  const now = nowMinutes(state, {});
  const notice = noticeStore(state)
    .filter(item => item.giverAlifeId === Math.floor(giverAlifeId) && activeNotice(item, now))
    .sort(sortNotices)[0];
  return notice
    ? { ...notice, tags: [...notice.tags], targetRoute: cloneRouteTarget(notice.targetRoute) }
    : undefined;
}

export function markDemosNoticeAccepted(state: GameState, noticeId: number, questId: number): void {
  const notice = findNotice(state, noticeId);
  if (!notice) return;
  notice.acceptedQuestId = clampInt(questId, 1, 1_000_000_000, questId);
  notice.acceptedAtMinutes = nowMinutes(state, {});
  delete notice.failedReason;
  delete notice.failedAtMinutes;
}

export function markDemosNoticeFailed(state: GameState, noticeId: number, reason: string): void {
  const notice = findNotice(state, noticeId);
  if (!notice) return;
  notice.failedReason = reason.replace(/\s+/g, ' ').trim().slice(0, MAX_FAILED_REASON) || 'failed';
  notice.failedAtMinutes = nowMinutes(state, {});
}

export function demosNoticeQuestEventData(
  notice: DemosQuestNotice,
  quest?: Pick<Quest, 'id' | 'type' | 'contractId' | 'targetRoute'>,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    giverAlifeId: notice.giverAlifeId,
    noticeId: notice.id,
    floorKey: notice.floorKey,
  };
  if (quest?.id !== undefined) data.questId = quest.id;
  if (quest?.type !== undefined) data.questType = quest.type;
  if (notice.contractId ?? quest?.contractId) data.contractId = notice.contractId ?? quest?.contractId;
  else data.questTemplateId = notice.templateId;
  const targetRoute = cloneRouteTarget(quest?.targetRoute ?? notice.targetRoute);
  if (targetRoute) data.targetRoute = targetRoute;
  if (notice.sourcePostId !== undefined) data.sourcePostId = notice.sourcePostId;
  if (notice.sourceEventId !== undefined) data.sourceEventId = notice.sourceEventId;
  return data;
}

export function recordDemosNoticeQuestCreated(
  state: GameState,
  noticeId: number,
  quest: Quest,
  opts: DemosQuestNoticeHandoffOptions = {},
): WorldEvent | undefined {
  const notice = findNotice(state, noticeId);
  if (!notice) return undefined;
  markDemosNoticeAccepted(state, noticeId, quest.id);
  const def = quest.contractId ? CONTRACT_BY_ID.get(quest.contractId) : undefined;
  return publishEvent(state, {
    type: quest.contractId ? 'contract_created' : 'quest_created',
    actorId: opts.actorId ?? quest.giverId,
    actorName: opts.actorName ?? quest.giverName,
    actorFaction: opts.actorFaction ?? def?.faction,
    targetName: opts.targetName ?? def?.title ?? quest.desc,
    severity: opts.severity ?? 3,
    privacy: opts.privacy ?? 'local',
    tags: cleanTags(['quest', 'created', 'demos_notice', ...notice.tags, ...(opts.tags ?? [])]),
    data: {
      ...demosNoticeQuestEventData(notice, quest),
      ...questTargetEventData(quest),
      ...opts.data,
    },
  });
}

export function recordDemosNoticeQuestCreatedForGiver(
  state: GameState,
  giverAlifeId: number | undefined,
  quest: Quest,
  opts: DemosQuestNoticeHandoffOptions = {},
): WorldEvent | undefined {
  if (giverAlifeId === undefined || !Number.isFinite(giverAlifeId) || giverAlifeId <= 0) return undefined;
  const notice = activeDemosQuestNoticeForGiver(state, giverAlifeId);
  if (notice && notice.contractId !== undefined && notice.contractId !== quest.contractId) return undefined;
  return notice ? recordDemosNoticeQuestCreated(state, notice.id, quest, opts) : undefined;
}

export function renderDemosQuestNoticeSpeech(options: DemosQuestNoticeSpeechOptions): SpeechRouterResult {
  const notice = options.notice;
  const def = contractForNotice(notice);
  const context = lowerDemosCandidateContext({
    actorAlifeId: notice.giverAlifeId,
    floorKey: notice.floorKey,
    floor: options.giverSnapshot?.floor ?? def?.target.floor,
    routeZ: notice.targetRoute?.z,
    faction: options.giverSnapshot?.faction ?? def?.faction,
    relationToPlayer: options.relationToPlayer ?? options.giverSnapshot?.playerRelation,
    socialEdgeFlags: options.socialEdgeFlags,
    wealth: options.giverSnapshot?.accountRubles ?? options.giverSnapshot?.money,
    itemId: def?.targetItem,
    itemName: options.exactFallback,
    monsterKind: def?.targetMonsterKind,
    tags: cleanTags([
      'quest_notice',
      'requires_visit',
      notice.contractId ? `contract.${notice.contractId}` : '',
      ...notice.tags,
      ...(options.traitTags ?? []),
    ]),
  });
  if (options.lockedText) {
    return routeSpeech({
      intent: 'locked_author_text',
      source: 'locked_author_text',
      context,
      lockedText: options.lockedText,
      exactFallback: options.lockedText,
      seed: options.seed ?? notice.id,
      repeatIndex: options.repeatIndex,
      maxChars: options.maxChars,
    });
  }
  const generated = generateMarkovText({
    intent: 'procedural_quest',
    source: options.source ?? 'generated_markov',
    context,
    exactFallback: undefined,
    seed: options.seed ?? notice.id,
    repeatIndex: options.repeatIndex,
    maxChars: options.maxChars ?? 180,
  });
  if (generated.source === 'generated_markov' && generated.text.trim().length > 0) return generated;
  return routeSpeech({
    intent: 'procedural_quest',
    source: 'curated_pool',
    context,
    exactFallback: options.exactFallback ?? 'Заявка есть. Приходи на этаж и говори лично.',
    seed: options.seed ?? notice.id,
    repeatIndex: options.repeatIndex,
    maxChars: options.maxChars ?? 180,
  });
}
