import { QuestType, type Quest } from '../core/types';

export interface QuestDeadlineContext {
  samosborDanger?: boolean;
  nearbyMonster?: boolean;
  crossFloor?: boolean;
  distance?: number;
}

const MIN_URGENT_MINUTES = 60;
const NORMAL_QUEST_MINUTES = 24 * 60;
const MAX_QUEST_MINUTES = 5 * 24 * 60;

const URGENT_FETCH_ITEMS = new Set([
  'antibiotic', 'bandage', 'pills', 'antidep',
  'water', 'bread', 'canned', 'ammo_9mm', 'ammo_762', 'ammo_shells',
]);
const MEDICAL_FETCH_ITEMS = new Set(['antibiotic', 'bandage', 'pills', 'antidep', 'morphine_ampoule', 'sanitary_kit']);
const WATER_FETCH_ITEMS = new Set(['water', 'filtered_water', 'water_coupon']);
const FOOD_FETCH_ITEMS = new Set(['bread', 'canned', 'kasha', 'grey_briquette', 'liquidator_ration']);
const REPAIR_FETCH_ITEMS = new Set([
  'sealant_tube', 'fuse', 'manometer', 'pipe', 'valve_tag', 'gear',
  'filter_layer', 'block_kit', 'door_kit', 'hermo_gasket', 'ammo_energy',
  'pressure_logbook',
]);
const DOCUMENT_FETCH_ITEMS = new Set([
  'blank_form', 'official_permit_slip', 'fake_pass', 'temp_pass', 'permanent_pass',
  'denunciation', 'sealed_complaint', 'missing_record_file', 'emergency_roster',
]);

export function isHandAuthoredQuest(q: Quest): boolean {
  return q.contractId === undefined
    && (q.plotStepIndex !== undefined || q.sideQuestId !== undefined)
    && q.timeLimitMinutes === undefined;
}

export function assignProceduralQuestDeadline(
  q: Quest,
  nowMinutes: number,
  ctx: QuestDeadlineContext = {},
): Quest {
  if (isHandAuthoredQuest(q)) return q;
  const limit = proceduralQuestTimeLimitMinutes(q, ctx);
  q.timeLimitMinutes = limit;
  q.expiresAtMinutes = Math.ceil(safeMinutes(nowMinutes) + limit);
  return q;
}

export function ensureQuestDeadline(
  q: Quest,
  nowMinutes: number,
  ctx: QuestDeadlineContext = {},
): Quest {
  if (q.done) return q;
  if (isHandAuthoredQuest(q)) {
    if (q.expiresAtMinutes !== undefined) q.expiresAtMinutes = undefined;
    return q;
  }

  const expiresAt = validPositiveMinutes(q.expiresAtMinutes);
  if (expiresAt !== undefined) {
    q.expiresAtMinutes = expiresAt;
    const limit = validPositiveMinutes(q.timeLimitMinutes);
    if (limit !== undefined) q.timeLimitMinutes = limit;
    return q;
  }

  const explicitLimit = validPositiveMinutes(q.timeLimitMinutes);
  if (explicitLimit !== undefined) {
    q.timeLimitMinutes = explicitLimit;
    q.expiresAtMinutes = Math.ceil(safeMinutes(nowMinutes) + explicitLimit);
    return q;
  }

  return assignProceduralQuestDeadline(q, nowMinutes, ctx);
}

export function questHasDeadline(q: Quest): boolean {
  return !isHandAuthoredQuest(q)
    && (validPositiveMinutes(q.expiresAtMinutes) !== undefined || validPositiveMinutes(q.timeLimitMinutes) !== undefined);
}

export function questDeadlineExpired(q: Quest, nowMinutes: number): boolean {
  const remaining = questRemainingMinutes(q, nowMinutes);
  return remaining !== undefined && remaining <= 0;
}

export function questDeadlineEventData(q: Quest, nowMinutes: number): Record<string, unknown> {
  const remaining = questRemainingMinutes(q, nowMinutes);
  if (remaining === undefined) return {};
  return {
    timeLimitMinutes: q.timeLimitMinutes,
    expiresAtMinutes: q.expiresAtMinutes,
    remainingMinutes: remaining,
  };
}

export function questDeadlineText(q: Quest, nowMinutes: number): string {
  const remaining = questRemainingMinutes(q, nowMinutes);
  if (remaining === undefined) return '';
  const compact = formatQuestMinutes(remaining);
  const label = deadlineWindowLabel(q, remaining);
  return label ? `${label} (${compact})` : compact;
}

export function deadlineMessageSuffix(q: Quest, nowMinutes: number): string {
  const text = questDeadlineText(q, nowMinutes);
  return text ? ` Срок: ${text}.` : '';
}

export function questRemainingMinutes(q: Quest, nowMinutes: number): number | undefined {
  if (isHandAuthoredQuest(q)) return undefined;
  const expiresAt = validPositiveMinutes(q.expiresAtMinutes);
  if (expiresAt !== undefined) return Math.max(0, Math.ceil(expiresAt - safeMinutes(nowMinutes)));
  return validPositiveMinutes(q.timeLimitMinutes);
}

export function formatQuestMinutes(minutes: number): string {
  const mins = Math.max(0, Math.ceil(minutes));
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const rem = mins % 60;
  if (days > 0) return `${days}д ${hours}ч`;
  if (hours > 0) return `${hours}ч ${rem}м`;
  return `${rem}м`;
}

function deadlineWindowLabel(q: Quest, minutes: number): string {
  if (minutes <= 60) {
    if (q.type === QuestType.KILL) return 'до сдачи поста';
    if (q.type === QuestType.TALK) return 'пока адресат на месте';
    return fetchDeadlineLabel(q) ?? 'до обхода';
  }
  if (minutes <= 6 * 60) {
    if (q.type === QuestType.KILL) return 'до смены патруля';
    if (q.type === QuestType.TALK) return 'до смены у поста';
    return fetchDeadlineLabel(q) ?? 'до смены';
  }
  if (minutes <= 18 * 60) {
    if (q.type === QuestType.KILL) return 'до вечерней зачистки';
    if (q.type === QuestType.TALK) return 'до вечерней переклички';
    return fetchDeadlineLabel(q) ?? 'до отбоя';
  }
  if (minutes <= 24 * 60) return 'до отбоя';
  if (minutes <= 48 * 60) return 'до следующей смены';
  if (minutes <= 72 * 60) return 'до сверки';
  return 'несколько смен';
}

function fetchDeadlineLabel(q: Quest): string | undefined {
  if (q.type !== QuestType.FETCH || !q.targetItem) return undefined;
  if (q.targetItem === 'gasmask_filter') return 'до намокания фильтра';
  if (MEDICAL_FETCH_ITEMS.has(q.targetItem)) return 'до закрытия медпоста';
  if (WATER_FETCH_ITEMS.has(q.targetItem)) return 'до конца очереди';
  if (FOOD_FETCH_ITEMS.has(q.targetItem)) return 'до раздачи';
  if (REPAIR_FETCH_ITEMS.has(q.targetItem)) return 'до аварийной смены';
  if (DOCUMENT_FETCH_ITEMS.has(q.targetItem)) return 'до сверки окна';
  return undefined;
}

function safeMinutes(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function validPositiveMinutes(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.ceil(value);
}

function proceduralQuestTimeLimitMinutes(q: Quest, ctx: QuestDeadlineContext): number {
  let base = NORMAL_QUEST_MINUTES;
  if (q.type === QuestType.KILL) base = 18 * 60;
  if (q.type === QuestType.TALK) base = 20 * 60;

  const urgent = ctx.samosborDanger || ctx.nearbyMonster;
  if (urgent) {
    if (ctx.nearbyMonster && q.type === QuestType.KILL && (q.killNeeded ?? 1) <= 1) {
      base = MIN_URGENT_MINUTES;
    } else if (q.type === QuestType.KILL) {
      base = 3 * 60;
    } else if (q.type === QuestType.FETCH && q.targetItem && URGENT_FETCH_ITEMS.has(q.targetItem)) {
      base = 6 * 60;
    } else {
      base = Math.min(base, 12 * 60);
    }
  }

  let extra = 0;
  const targetCount = q.targetCount ?? 1;
  if (targetCount > 1) extra += Math.min(24 * 60, (targetCount - 1) * 30);

  const killNeeded = q.killNeeded ?? 1;
  if (q.type === QuestType.KILL && killNeeded > 1) extra += (killNeeded - 1) * 3 * 60;

  const distance = ctx.distance ?? 0;
  if (distance > 120) extra += 12 * 60;
  else if (distance > 60) extra += 6 * 60;

  if (q.difficulty !== undefined) {
    if (q.difficulty >= 4) extra += 24 * 60;
    else if (q.difficulty >= 2) extra += 12 * 60;
  }

  if (q.contractRank !== undefined) extra += Math.max(0, q.contractRank) * 6 * 60;

  let total = base + extra;
  if (q.visitFloor !== undefined || ctx.crossFloor) total = Math.max(total, 2 * 24 * 60);
  return Math.max(MIN_URGENT_MINUTES, Math.min(MAX_QUEST_MINUTES, Math.round(total)));
}
