/* ── Markov procedural quest speech adapter ───────────────────── */

import { FloorLevel, MonsterKind, QuestType, RoomType, type Quest } from '../core/types';
import { ITEMS } from '../data/items';
import type { ContractDef } from '../data/contracts';
import { monsterTypeName } from '../entities/monster';
import type { ContextSnapshot } from './context';
import {
  cleanLine,
  type MarkovAdapterSpeechRequest,
  type MarkovAdapterSpeechResult,
  type MarkovRouteSpeech,
} from './markov_dialogue';
import { markovContextFromSnapshot } from './markov_context';

export type ProceduralQuestSpeechPhase = 'offer' | 'reminder' | 'completion' | 'failure';

export type ProceduralQuestSpeechClass =
  | 'fetch'
  | 'visit'
  | 'kill'
  | 'talk'
  | 'repair'
  | 'steal'
  | 'expose'
  | 'escort'
  | 'hold'
  | 'route';

export interface ProceduralQuestSpeechOptions {
  quest: Quest;
  contractDef?: ContractDef;
  phase?: ProceduralQuestSpeechPhase;
  lockedText?: string;
  exactFallback?: string;
  seed?: number | string;
  repeatIndex?: number;
  nowMinutes?: number;
  maxChars?: number;
  routeSpeech?: MarkovRouteSpeech;
  snapshot?: ContextSnapshot;
}

export interface ProceduralQuestFactSummary {
  questId: number;
  contractId?: string;
  questClass: ProceduralQuestSpeechClass;
  targetText?: string;
  targetItem?: string;
  targetNpcName?: string;
  targetMonsterKind?: MonsterKind;
  routeText?: string;
  rewardText?: string;
  deadlineText?: string;
}

export interface ProceduralQuestSpeechResult extends MarkovAdapterSpeechResult {
  phase: ProceduralQuestSpeechPhase;
  questClass: ProceduralQuestSpeechClass;
  questId: number;
  contractId?: string;
  facts: ProceduralQuestFactSummary;
}

const DEFAULT_MAX_QUEST_CHARS = 180;

type LooseQuestRouteTarget = NonNullable<Quest['targetRoute']> | NonNullable<ContractDef['target']['route']>;

export function renderProceduralQuestSpeech(options: ProceduralQuestSpeechOptions): ProceduralQuestSpeechResult {
  const q = options.quest;
  const locked = cleanLine(options.lockedText);
  const phase = options.phase ?? 'offer';
  const facts = summarizeQuestFacts(q, options.contractDef);
  if (locked || q.plotStepIndex !== undefined || q.sideQuestId !== undefined) {
    const text = locked ?? cleanLine(options.exactFallback) ?? q.desc;
    return result(text, 'locked_author_text', false, phase, facts, ['locked_author_text', 'quest']);
  }

  const fallback = cleanLine(options.exactFallback) ?? options.contractDef?.desc ?? q.desc;
  const maxChars = options.maxChars ?? DEFAULT_MAX_QUEST_CHARS;
  const snapshotContext = options.snapshot ? markovContextFromSnapshot(options.snapshot, { timeMinutes: options.nowMinutes }) : undefined;

  const request: MarkovAdapterSpeechRequest = {
    intent: 'procedural_quest',
    source: 'generated_markov',
    context: {
      ...snapshotContext,
      targetId: q.targetNpcId,
      floor: q.targetFloor ?? q.visitFloor ?? options.contractDef?.target.floor ?? snapshotContext?.floor,
      roomName: q.targetRoomName ?? options.contractDef?.target.roomName ?? snapshotContext?.roomName,
      roomType: q.targetRoomType ?? options.contractDef?.target.roomType ?? snapshotContext?.roomType,
      itemId: q.targetItem,
      itemName: q.targetItem ? itemName(q.targetItem) : undefined,
      monsterKind: q.targetMonsterKind,
      questId: q.id,
      questType: q.type,
      contractId: q.contractId,
      tags: [
        'quest',
        'procedural_quest',
        facts.questClass,
        ...(q.contractId ? [`contract.${q.contractId}`] : []),
        ...(options.contractDef?.tags ?? []),
        ...(q.eventTags ?? []),
        ...(snapshotContext?.tags ?? []),
      ],
    },
    exactFallback: fallback,
    seed: options.seed ?? q.contractId ?? q.id,
    repeatIndex: options.repeatIndex,
    maxChars,
  };

  const routed = options.routeSpeech?.(request);
  if (routed && validQuestSpeech(routed.text, facts, maxChars)) {
    return {
      ...routed,
      intent: 'procedural_quest',
      tags: routed.tags.length ? routed.tags : request.context.tags,
      fallbackUsed: false,
      phase,
      questClass: facts.questClass,
      questId: q.id,
      contractId: q.contractId,
      facts,
    };
  }

  const generated = generateQuestSpeech(facts, q.giverName, phase, maxChars);
  if (generated && validQuestSpeech(generated, facts, maxChars)) {
    return result(generated, 'generated_markov', false, phase, facts, request.context.tags, 'procedural_quest_facts');
  }

  return result(fallback, 'curated_pool', true, phase, facts, ['quest', 'procedural_quest', 'fallback']);
}

export function renderProceduralQuestSpeechText(options: ProceduralQuestSpeechOptions): string {
  return renderProceduralQuestSpeech(options).text;
}

export function summarizeQuestFacts(q: Quest, contractDef?: ContractDef): ProceduralQuestFactSummary {
  const questClass = inferQuestClass(q, contractDef);
  return {
    questId: q.id,
    contractId: q.contractId,
    questClass,
    targetText: questTargetText(q, contractDef, questClass),
    targetItem: q.targetItem,
    targetNpcName: q.targetNpcName,
    targetMonsterKind: q.targetMonsterKind,
    routeText: routeText(q.targetRoute ?? contractDef?.target.route),
    rewardText: rewardText(q),
    deadlineText: deadlineText(q),
  };
}

function generateQuestSpeech(
  facts: ProceduralQuestFactSummary,
  giverName: string,
  phase: ProceduralQuestSpeechPhase,
  maxChars: number,
): string | undefined {
  const target = facts.targetText;
  const reward = facts.rewardText ? ` Плата: ${facts.rewardText}.` : '';
  const deadline = facts.deadlineText ? ` ${facts.deadlineText}.` : '';
  const contract = facts.contractId ? ` [${facts.contractId}]` : '';
  let body: string;

  if (phase === 'completion') {
    body = target ? `Принял: ${target}.` : 'Принял, запись закрыта.';
  } else if (phase === 'failure') {
    body = target ? `Сорвано: ${target}.` : 'Сорвано, запись закрыли без отметки.';
  } else if (phase === 'reminder') {
    body = target ? `По заданию: ${target}.` : 'По заданию: держи журнал открытым и не теряй отметку.';
  } else {
    body = target ? offerVerb(facts.questClass, target) : 'Есть поручение по журналу, без лишних слов.';
  }

  const text = `${giverName}: «${body}${reward}${deadline}»${contract}`;
  return text.length <= maxChars ? text : undefined;
}

function offerVerb(questClass: ProceduralQuestSpeechClass, target: string): string {
  switch (questClass) {
    case 'fetch': return `Принеси ${target}.`;
    case 'visit': return `Проверь ${target}.`;
    case 'kill': return `Убей ${target}.`;
    case 'talk': return `Поговори с ${target}.`;
    case 'repair': return `Почини ${target}.`;
    case 'steal': return `Достань ${target} тихо.`;
    case 'expose': return `Разберись с ${target} и принеси отметку.`;
    case 'escort': return `Доведи ${target} без лишнего шума.`;
    case 'hold': return `Удержи ${target}.`;
    case 'route': return `Пройди маршрут: ${target}.`;
  }
}

function validQuestSpeech(text: string, facts: ProceduralQuestFactSummary, maxChars: number): boolean {
  const clean = cleanLine(text);
  if (!clean || clean.length > maxChars || clean.includes('{')) return false;
  const lower = clean.toLowerCase();
  if (!facts.rewardText && /\b(плата|наград|оплат|руб|₽|платят|заплатят)\b/i.test(clean)) return false;
  if (!facts.deadlineText && /\b(срок|дедлайн|дед-лайн|минут|час|до отбоя|до сирены)\b/i.test(clean)) return false;
  if (facts.targetText && !mentionsFact(clean, facts.targetText)) return false;
  if (facts.targetNpcName && !mentionsFact(clean, facts.targetNpcName)) return false;
  if (facts.rewardText && !mentionsAnyFactToken(clean, facts.rewardText)) return false;
  if (facts.deadlineText && !mentionsAnyFactToken(clean, facts.deadlineText)) return false;
  return !mentionsAbsentQuestFact(lower, facts);
}

function mentionsAbsentQuestFact(lower: string, facts: ProceduralQuestFactSummary): boolean {
  if (!facts.targetItem) {
    for (const item of Object.values(ITEMS)) {
      const name = item.name.toLowerCase();
      if (name.length >= 4 && lower.includes(name)) return true;
    }
  }
  if (facts.targetMonsterKind === undefined) {
    for (const kind of Object.values(MonsterKind).filter((value): value is MonsterKind => typeof value === 'number')) {
      const name = monsterTypeName(kind).toLowerCase();
      if (name.length >= 4 && lower.includes(name)) return true;
    }
  }
  if (!facts.routeText && /\b(маршрут|лифт|этаж z=|z=|route)\b/i.test(lower)) return true;
  return false;
}

function mentionsFact(text: string, fact: string): boolean {
  const textNorm = normalizeFactText(text);
  const factNorm = normalizeFactText(fact);
  if (!factNorm) return true;
  if (textNorm.includes(factNorm)) return true;
  return importantFactTokens(factNorm).some(token => textNorm.includes(token));
}

function mentionsAnyFactToken(text: string, fact: string): boolean {
  const textNorm = normalizeFactText(text);
  const tokens = importantFactTokens(normalizeFactText(fact));
  return tokens.length === 0 || tokens.some(token => textNorm.includes(token));
}

function normalizeFactText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[«»"'()[\]{}:;,.!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function importantFactTokens(text: string): string[] {
  const out: string[] = [];
  for (const token of text.split(/\s+/)) {
    if (token.length < 2) continue;
    if (token === 'x' || token === 'xp' || token === 'мин' || token === 'срок') continue;
    if (!out.includes(token)) out.push(token);
  }
  return out;
}

function inferQuestClass(q: Quest, contractDef?: ContractDef): ProceduralQuestSpeechClass {
  const tags = new Set([...(contractDef?.tags ?? []), ...(q.eventTags ?? []), ...(q.targetRoute?.tags ?? [])]);
  if (q.holdSeconds !== undefined) return 'hold';
  if (tags.has('escort') || tags.has('deliver') || tags.has('courier')) return 'escort';
  if (tags.has('repair') || tags.has('maintenance') || tags.has('tools')) return 'repair';
  if (tags.has('steal') || tags.has('theft') || tags.has('contraband')) return 'steal';
  if (tags.has('expose') || tags.has('audit') || tags.has('report') || tags.has('documents')) return 'expose';
  if (q.targetRoute || contractDef?.target.route) return 'route';
  switch (q.type) {
    case QuestType.FETCH: return 'fetch';
    case QuestType.VISIT: return 'visit';
    case QuestType.KILL: return 'kill';
    case QuestType.TALK: return 'talk';
  }
}

function questTargetText(q: Quest, contractDef: ContractDef | undefined, questClass: ProceduralQuestSpeechClass): string | undefined {
  if (q.type === QuestType.FETCH && q.targetItem) {
    const count = q.targetCount ?? 1;
    if (q.targetItem === 'money') return `${count}₽`;
    return `${itemName(q.targetItem)} ×${count}`;
  }
  if (q.type === QuestType.KILL) {
    if (q.targetMonsterKind !== undefined) return monsterTypeName(q.targetMonsterKind).toLowerCase();
    if (q.targetNpcName) return q.targetNpcName;
  }
  if (q.type === QuestType.TALK && q.targetNpcName) return q.targetNpcName;
  if (questClass === 'hold') return roomOrRouteText(q, contractDef) ?? 'точку задания';
  if (questClass === 'route') return roomOrRouteText(q, contractDef);
  if (q.type === QuestType.VISIT) return roomOrRouteText(q, contractDef);
  return roomOrRouteText(q, contractDef);
}

function roomOrRouteText(q: Quest, contractDef?: ContractDef): string | undefined {
  const route = routeText(q.targetRoute ?? contractDef?.target.route);
  if (route) return route;
  if (q.targetRoomName) return q.targetRoomName;
  if (contractDef?.target.roomName) return contractDef.target.roomName;
  if (q.targetRoomType !== undefined) return roomTypeName(q.targetRoomType);
  if (contractDef?.target.roomType !== undefined) return roomTypeName(contractDef.target.roomType);
  if (q.targetHint) return q.targetHint;
  if (contractDef?.target.hint) return contractDef.target.hint;
  if (q.targetFloor !== undefined) return floorName(q.targetFloor);
  if (q.visitFloor !== undefined) return floorName(q.visitFloor);
  if (contractDef?.target.floor !== undefined) return floorName(contractDef.target.floor);
  return undefined;
}

function routeText(route: LooseQuestRouteTarget | undefined): string | undefined {
  if (!route) return undefined;
  if (route.label) return route.label;
  if (route.designFloorId) return route.designFloorId;
  if (route.proceduralTag) return route.proceduralTag;
  if (route.anomalyId) return route.anomalyId;
  if (route.z !== undefined) return `этаж z=${route.z}`;
  return undefined;
}

function rewardText(q: Quest): string | undefined {
  const parts: string[] = [];
  if (q.rewardItem) parts.push(`${itemName(q.rewardItem)} ×${q.rewardCount ?? 1}`);
  for (const reward of q.extraRewards ?? []) parts.push(`${itemName(reward.defId)} ×${reward.count}`);
  if (q.moneyReward && q.moneyReward > 0) parts.push(`${q.moneyReward}₽`);
  if (q.xpReward && q.xpReward > 0) parts.push(`${q.xpReward} XP`);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function deadlineText(q: Quest): string | undefined {
  if (q.timeLimitMinutes !== undefined) return `Срок: ${Math.max(1, Math.round(q.timeLimitMinutes))} мин.`;
  if (q.expiresAtMinutes !== undefined) return `Срок в журнале до минуты ${Math.max(0, Math.round(q.expiresAtMinutes))}`;
  return undefined;
}

function itemName(itemId: string): string {
  return ITEMS[itemId]?.name ?? itemId;
}

function result(
  text: string,
  source: MarkovAdapterSpeechResult['source'],
  fallbackUsed: boolean,
  phase: ProceduralQuestSpeechPhase,
  facts: ProceduralQuestFactSummary,
  tags: readonly string[],
  templateId?: string,
): ProceduralQuestSpeechResult {
  return {
    text,
    source,
    intent: source === 'locked_author_text' ? 'locked_author_text' : 'procedural_quest',
    templateId,
    domainId: 'procedural_quest',
    tags,
    fallbackUsed,
    phase,
    questClass: facts.questClass,
    questId: facts.questId,
    contractId: facts.contractId,
    facts,
  };
}

function floorName(floor: FloorLevel): string {
  switch (floor) {
    case FloorLevel.MINISTRY: return 'Министерство';
    case FloorLevel.KVARTIRY: return 'Квартиры';
    case FloorLevel.LIVING: return 'Жилая зона';
    case FloorLevel.MAINTENANCE: return 'Коллекторы';
    case FloorLevel.HELL: return 'Ад';
    case FloorLevel.VOID: return 'Пустота';
  }
}

function roomTypeName(roomType: RoomType): string {
  switch (roomType) {
    case RoomType.LIVING: return 'жилая комната';
    case RoomType.KITCHEN: return 'кухня';
    case RoomType.BATHROOM: return 'санузел';
    case RoomType.STORAGE: return 'кладовая';
    case RoomType.MEDICAL: return 'медпункт';
    case RoomType.COMMON: return 'общая комната';
    case RoomType.PRODUCTION: return 'производственная';
    case RoomType.CORRIDOR: return 'коридор';
    case RoomType.SMOKING: return 'курилка';
    case RoomType.OFFICE: return 'кабинет';
    case RoomType.HQ: return 'штаб';
    case RoomType.CLASSROOM: return 'класс';
  }
}
