/* ── Markov rumor adapter: flavor around selected rumor facts ─── */

import { Faction, FloorLevel, MonsterKind, RoomType, type ZoneFaction } from '../core/types';
import { ITEMS } from '../data/items';
import { RUMORS, type RumorDef, type RumorLead, type RumorReveal } from '../data/rumors';
import { monsterTypeName } from '../entities/monster';
import { type ContextSnapshot } from './context';
import { type NpcMemory } from './npc_memory';
import {
  cleanLine,
  hashSpeechSeed,
  type MarkovAdapterSpeechRequest,
  type MarkovAdapterSpeechResult,
  type MarkovRouteSpeech,
} from './markov_dialogue';
import { type RumorEventLike } from './rumor';

export interface MarkovRumorFlavorOptions {
  rumor?: RumorDef;
  rumorId?: string;
  snapshot: ContextSnapshot;
  memory?: Pick<NpcMemory, 'entityId' | 'knownRumorIds'>;
  event?: RumorEventLike;
  lockedText?: string;
  exactFallback?: string;
  seed?: number | string;
  repeatIndex?: number;
  now?: number;
  maxChars?: number;
  routeSpeech?: MarkovRouteSpeech;
}

export interface MarkovRumorFlavorResult extends MarkovAdapterSpeechResult {
  rumorId: string;
  topic: RumorDef['topic'];
  leadText?: string;
  revealText?: string;
}

const DEFAULT_MAX_RUMOR_CHARS = 180;

export function renderMarkovRumorFlavor(options: MarkovRumorFlavorOptions): MarkovRumorFlavorResult {
  const rumor = options.rumor ?? (options.rumorId ? findRumor(options.rumorId) : undefined);
  const rumorId = rumor?.id ?? options.rumorId ?? '';
  const locked = cleanLine(options.lockedText);
  if (locked) {
    return {
      text: locked,
      source: 'locked_author_text',
      intent: 'locked_author_text',
      tags: ['locked_author_text', 'rumor'],
      fallbackUsed: false,
      rumorId,
      topic: rumor?.topic ?? 'room',
    };
  }

  if (!rumor) {
    const fallback = cleanLine(options.exactFallback) ?? '';
    return {
      text: fallback,
      source: 'curated_pool',
      intent: 'rumor_flavor',
      tags: ['rumor', 'missing_rumor'],
      fallbackUsed: true,
      rumorId,
      topic: 'room',
    };
  }

  const maxChars = options.maxChars ?? DEFAULT_MAX_RUMOR_CHARS;
  const fallback = cleanLine(options.exactFallback) ?? renderRumorFallback(rumor, options);
  const leadText = formatLeadLine(rumor.lead, options.event);
  const revealText = formatRevealLine(rumor.reveals);
  const leadItemId = rumor.lead?.itemId ?? options.event?.itemId;
  const leadMonsterKind = rumor.lead?.monsterKind ?? options.event?.monsterKind;
  const context = {
    floor: options.snapshot.floor,
    roomName: options.snapshot.roomName,
    roomType: options.snapshot.roomType,
    zoneId: options.snapshot.zoneId,
    itemId: leadItemId,
    itemName: leadItemId ? ITEMS[leadItemId]?.name : undefined,
    monsterKind: leadMonsterKind,
    eventType: options.event?.type,
    eventId: options.event?.id,
    tags: ['rumor', `rumor.${rumor.topic}`, rumor.id],
  };
  const request: MarkovAdapterSpeechRequest = {
    intent: 'rumor_flavor',
    source: 'generated_markov',
    context,
    exactFallback: fallback,
    seed: options.seed ?? rumor.id,
    repeatIndex: options.repeatIndex,
    maxChars,
  };

  const routed = options.routeSpeech?.(request);
  if (routed && validRumorGeneratedText(routed.text, rumor, options, maxChars)) {
    return {
      ...routed,
      intent: 'rumor_flavor',
      tags: routed.tags.length ? routed.tags : context.tags,
      fallbackUsed: false,
      rumorId: rumor.id,
      topic: rumor.topic,
      leadText,
      revealText,
    };
  }

  return {
    text: fallback,
    source: 'curated_pool',
    intent: 'rumor_flavor',
    domainId: 'rumor',
    tags: context.tags,
    fallbackUsed: true,
    rumorId: rumor.id,
    topic: rumor.topic,
    leadText,
    revealText,
  };
}

export function renderMarkovRumorText(options: MarkovRumorFlavorOptions): string {
  return renderMarkovRumorFlavor(options).text;
}

function renderRumorFallback(rumor: RumorDef, options: MarkovRumorFlavorOptions): string {
  const memory = options.memory;
  const idxSeed = memory
    ? Math.abs((memory.entityId * 31 + rumor.id.length * 17 + memory.knownRumorIds.length) | 0)
    : hashSpeechSeed(options.seed ?? rumor.id, options.repeatIndex ?? 0, 'rumor-text');
  const text = fillSlots(rumor.text[idxSeed % rumor.text.length] ?? rumor.text[0] ?? '', options.snapshot);
  const lead = formatLeadLine(rumor.lead, options.event);
  if (lead) return `${text} Зацепка: ${lead}.`;
  const reveal = formatRevealLine(rumor.reveals);
  return reveal ? `${text} ${reveal}` : text;
}

function validRumorGeneratedText(
  text: string,
  rumor: RumorDef,
  options: MarkovRumorFlavorOptions,
  maxChars: number,
): boolean {
  const clean = cleanLine(text);
  if (!clean || clean.length > maxChars) return false;
  if (clean.includes('{')) return false;
  const required = requiredRumorFactTexts(rumor, options);
  if (required.size > 0 && !mentionsAnyFact(clean, required)) return false;
  const allowed = allowedRumorFactTexts(rumor, options);
  const forbidden = observedForbiddenFact(clean, allowed);
  return forbidden === undefined;
}

function requiredRumorFactTexts(rumor: RumorDef, options: MarkovRumorFlavorOptions): Set<string> {
  const required = new Set<string>();
  addRumorLeadFacts(required, rumor.lead);
  addEventFacts(required, options.event);
  const reveals = rumor.reveals ? Array.isArray(rumor.reveals) ? rumor.reveals : [rumor.reveals] : [];
  for (const reveal of reveals) addRevealFacts(required, reveal);
  return required;
}

function allowedRumorFactTexts(rumor: RumorDef, options: MarkovRumorFlavorOptions): Set<string> {
  const allowed = new Set<string>();
  addRumorLeadFacts(allowed, rumor.lead);
  addEventFacts(allowed, options.event);
  const reveals = rumor.reveals ? Array.isArray(rumor.reveals) ? rumor.reveals : [rumor.reveals] : [];
  for (const reveal of reveals) addRevealFacts(allowed, reveal);
  if (options.snapshot.roomName) allowed.add(options.snapshot.roomName.toLowerCase());
  if (options.snapshot.floor !== undefined) allowed.add(floorName(options.snapshot.floor).toLowerCase());
  return allowed;
}

let FORBIDDEN_ITEM_NAMES: string[] | undefined;
let FORBIDDEN_FLOOR_NAMES: string[] | undefined;
let FORBIDDEN_MONSTER_NAMES: string[] | undefined;

function observedForbiddenFact(text: string, allowed: Set<string>): string | undefined {
  const lower = text.toLowerCase();

  if (!FORBIDDEN_ITEM_NAMES) FORBIDDEN_ITEM_NAMES = Object.values(ITEMS).map(item => item.name.toLowerCase());
  for (const name of FORBIDDEN_ITEM_NAMES) {
    if (name.length >= 4 && lower.includes(name) && !allowed.has(name)) return name;
  }

  if (!FORBIDDEN_FLOOR_NAMES) FORBIDDEN_FLOOR_NAMES = Object.values(FLOOR_NAMES).map(value => value.toLowerCase());
  for (const name of FORBIDDEN_FLOOR_NAMES) {
    if (lower.includes(name) && !allowed.has(name)) return name;
  }

  if (!FORBIDDEN_MONSTER_NAMES) {
    FORBIDDEN_MONSTER_NAMES = Object.values(MonsterKind)
      .filter((value): value is MonsterKind => typeof value === 'number')
      .map(kind => monsterTypeName(kind).toLowerCase());
  }
  for (const name of FORBIDDEN_MONSTER_NAMES) {
    if (name.length >= 4 && lower.includes(name) && !allowed.has(name)) return name;
  }

  return undefined;
}

function mentionsAnyFact(text: string, facts: Set<string>): boolean {
  const lower = text.toLowerCase();
  for (const fact of facts) {
    const normalized = fact.toLowerCase().trim();
    if (normalized.length >= 2 && lower.includes(normalized)) return true;
  }
  return false;
}

function addRumorLeadFacts(out: Set<string>, lead: RumorLead | undefined): void {
  if (!lead) return;
  if (lead.floor !== undefined) out.add(floorName(lead.floor).toLowerCase());
  if (lead.roomName) out.add(lead.roomName.toLowerCase());
  if (lead.roomType !== undefined) out.add(roomTypeName(lead.roomType).toLowerCase());
  if (lead.itemId) {
    const itemName = ITEMS[lead.itemId]?.name.toLowerCase();
    if (itemName) out.add(itemName);
  }
  if (lead.monsterKind !== undefined) out.add(monsterTypeName(lead.monsterKind).toLowerCase());
}

function addRevealFacts(out: Set<string>, reveal: RumorReveal): void {
  const formatted = formatReveal(reveal);
  if (formatted) out.add(formatted.toLowerCase());
}

function addEventFacts(out: Set<string>, event: RumorEventLike | undefined): void {
  if (!event) return;
  if (event.floor !== undefined) out.add(floorName(event.floor).toLowerCase());
  if (event.roomName) out.add(event.roomName.toLowerCase());
  if (event.itemId) {
    const itemName = ITEMS[event.itemId]?.name.toLowerCase();
    if (itemName) out.add(itemName);
  }
  if (event.monsterKind !== undefined) out.add(monsterTypeName(event.monsterKind).toLowerCase());
}

function formatLeadLine(lead: RumorLead | undefined, event?: RumorEventLike): string {
  if (lead) return formatStaticLead(lead);
  return event ? formatEventLead(event) : '';
}

function formatStaticLead(lead: RumorLead): string {
  const parts: string[] = [];
  if (lead.floor !== undefined) parts.push(floorName(lead.floor));
  if (lead.zoneHint) parts.push(lead.zoneHint);
  if (lead.roomName) parts.push(lead.roomName);
  else if (lead.roomType !== undefined) parts.push(roomTypeName(lead.roomType));
  if (lead.itemId) {
    const itemName = ITEMS[lead.itemId]?.name.toLowerCase();
    if (itemName) parts.push(itemName);
  }
  if (lead.monsterKind !== undefined) parts.push(monsterTypeName(lead.monsterKind).toLowerCase());
  const prefix = parts.length > 0 ? `${parts.join(' / ')}: ` : '';
  return `${prefix}${lead.action}`;
}

function formatEventLead(event: RumorEventLike): string {
  const parts: string[] = [];
  if (event.floor !== undefined) parts.push(floorName(event.floor));
  if (event.zoneName) parts.push(event.zoneName);
  else if (event.zoneId !== undefined) parts.push(`зона ${event.zoneId + 1}`);
  if (event.roomName) parts.push(event.roomName);
  else if (event.roomType !== undefined) parts.push(roomTypeName(event.roomType));
  if (event.itemId) {
    const itemName = ITEMS[event.itemId]?.name.toLowerCase();
    if (itemName) parts.push(itemName);
  }
  if (event.monsterKind !== undefined) parts.push(monsterTypeName(event.monsterKind).toLowerCase());
  const action = eventLeadAction(event);
  return parts.length > 0 ? `${parts.join(' / ')}: ${action}` : action;
}

function eventLeadAction(event: RumorEventLike): string {
  const type = event.type ?? '';
  if (type === 'contract_created' || type === 'quest_created') return 'открой журнал заданий и подготовь вылазку';
  if (type === 'item_stolen') return 'держись подальше от владельца контейнера или готовь объяснение';
  if (type === 'player_kill_monster' || type === 'npc_kill_monster') return 'проверь место боя на редкий дроп';
  if (type.includes('floor') || event.tags?.includes('floor_transition')) return 'ищи лифт и сверяй этаж перед выходом';
  return 'проверь место слуха, пока свидетели не разошлись';
}

function formatRevealLine(input: RumorDef['reveals']): string {
  if (!input) return '';
  const reveals = Array.isArray(input) ? input : [input];
  if (reveals.length < 2 && !reveals.some(revealIsActionable)) return '';
  const parts: string[] = [];
  for (const reveal of reveals) {
    const part = formatReveal(reveal);
    if (part && !parts.includes(part)) parts.push(part);
  }
  return parts.length > 0 ? `Зацепка: ${parts.join(', ')}.` : '';
}

function revealIsActionable(reveal: RumorReveal): boolean {
  if (reveal.kind === 'danger' || reveal.kind === 'container') return true;
  if (reveal.confidence < 4) return false;
  return formatReveal(reveal).length > 0;
}

function formatReveal(reveal: RumorReveal): string {
  switch (reveal.kind) {
    case 'floor':
      return floorName(reveal.floor);
    case 'zone':
      if (reveal.zoneId !== undefined) return `зона ${reveal.zoneId + 1}`;
      if (reveal.faction !== undefined) return `зона: ${zoneFactionName(reveal.faction)}`;
      return '';
    case 'room':
      return reveal.roomName ?? (reveal.roomType !== undefined ? roomTypeName(reveal.roomType) : '');
    case 'danger':
      return 'опасность';
    case 'monster':
      return reveal.monsterKind !== undefined ? monsterTypeName(reveal.monsterKind).toLowerCase() : '';
    case 'container':
      return reveal.name ?? reveal.tag ?? '';
    case 'item':
      return ITEMS[reveal.itemId]?.name.toLowerCase() ?? '';
    case 'faction':
      return reveal.faction !== undefined ? factionName(reveal.faction) : '';
    case 'warning':
      return reveal.tag.replace(/_/g, ' ');
  }
}

function fillSlots(text: string, snapshot: ContextSnapshot): string {
  let out = text;
  if (out.includes('{zone}')) out = out.split('{zone}').join(snapshot.zoneId === undefined ? 'этой зоне' : `зоне ${snapshot.zoneId + 1}`);
  if (out.includes('{room}')) out = out.split('{room}').join(snapshot.roomName ?? 'этой комнате');
  return out;
}

function findRumor(id: string): RumorDef | undefined {
  return RUMORS.find(rumor => rumor.id === id);
}

const FLOOR_NAMES: Record<FloorLevel, string> = {
  [FloorLevel.MINISTRY]: 'Министерство',
  [FloorLevel.KVARTIRY]: 'Квартиры',
  [FloorLevel.LIVING]: 'Жилая зона',
  [FloorLevel.MAINTENANCE]: 'Коллекторы',
  [FloorLevel.HELL]: 'Ад',
  [FloorLevel.VOID]: 'Пустота',
};

function floorName(floor: FloorLevel): string {
  return FLOOR_NAMES[floor];
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

function factionName(faction: Faction): string {
  switch (faction) {
    case Faction.CITIZEN: return 'жильцы';
    case Faction.LIQUIDATOR: return 'ликвидаторы';
    case Faction.CULTIST: return 'культисты';
    case Faction.SCIENTIST: return 'ученые';
    case Faction.WILD: return 'дикие';
    case Faction.PLAYER: return 'вы';
  }
}

function zoneFactionName(faction: ZoneFaction): string {
  switch (faction) {
    case 0: return 'жильцы';
    case 1: return 'ликвидаторы';
    case 2: return 'культисты';
    case 3: return 'самосбор';
    case 4: return 'дикие';
    default: return 'чужая';
  }
}
