/* ── Bounded module-level NPC memory store ────────────────────── */

import { Faction, MonsterKind, type Entity, type FloorLevel } from '../core/types';

export type NpcObservedFactKind =
  | 'theft'
  | 'murder'
  | 'samosbor'
  | 'rare_monster'
  | 'monster_kill'
  | 'shortage'
  | 'contract'
  | 'faction_event';
export type NpcWitnessAction =
  | 'theft'
  | 'murder'
  | 'samosbor'
  | 'rare_monster'
  | 'monster_kill'
  | 'shortage'
  | 'contract'
  | 'faction_clash';
export type NpcWitnessResidue = 'mark' | 'moved_loot' | 'scared_npc' | 'price' | 'zone';

export interface NpcObservedFact {
  eventId: number;
  kind: NpcObservedFactKind;
  floor?: FloorLevel;
  zoneId?: number;
  roomId?: number;
  actorId?: number;
  actorName?: string;
  actorFaction?: Faction;
  action: NpcWitnessAction;
  targetId?: number;
  targetName?: string;
  targetFaction?: Faction;
  itemId?: string;
  itemName?: string;
  monsterKind?: MonsterKind;
  residue: NpcWitnessResidue[];
  observedAt: number;
  expiresAt: number;
  score: number;
  tags: string[];
}

export interface NpcMemoryEventLike {
  id?: number;
  type?: string;
  time?: number;
  floor?: FloorLevel;
  zoneId?: number;
  roomId?: number;
  severity?: number;
  privacy?: string;
  tags?: readonly string[];
  actorId?: number;
  actorName?: string;
  actorFaction?: Faction;
  targetId?: number;
  targetName?: string;
  targetFaction?: Faction;
  itemId?: string;
  itemName?: string;
  monsterKind?: MonsterKind;
  data?: Record<string, unknown>;
}

export interface NpcMemory {
  entityId: number;
  lastSeenPlayerAt: number;
  helpedByPlayer: number;
  hurtByPlayer: number;
  knownRumorIds: string[];
  fear: number;
  trustPlayer: number;
  lastSpokeAt: number;
  lastRumorAt: number;
  lastContextAt: number;
  lastBarkAt: number;
  lastMemoryTickMinute: number;
  lastRumorEventId: number;
  lastEventRumorId: string;
  lastEventRumorAt: number;
  lastWitnessFactLineAt: number;
  lastWitnessFactEventId: number;
  lastTouchedAt: number;
  observedFacts: NpcObservedFact[];
}

export interface RecentRumorLead {
  rumorId: string;
  text: string;
  heardAt: number;
  expiresAt: number;
  floor?: FloorLevel;
  roomName?: string;
  itemId?: string;
  monsterKind?: MonsterKind;
}

const MAX_NPC_MEMORIES = 16384;
const MAX_RUMORS_PER_NPC = 12;
const MAX_OBSERVED_FACTS_PER_NPC = 8;
const MAX_OBSERVED_FACT_RESIDUE = 4;
const MEMORY_TICK_MINUTES = 4;
const RECENT_RUMOR_LEAD_TTL_S = 360;
const WITNESS_FACT_LINE_COOLDOWN_S = 90;

const memories = new Map<number, NpcMemory>();
let recentRumorLead: RecentRumorLead | undefined;

export function rememberRecentRumorLead(input: Omit<RecentRumorLead, 'expiresAt'>): void {
  recentRumorLead = {
    ...input,
    expiresAt: input.heardAt + RECENT_RUMOR_LEAD_TTL_S,
  };
}

export function getRecentRumorLead(now: number): RecentRumorLead | undefined {
  if (!recentRumorLead) return undefined;
  if (now > recentRumorLead.expiresAt) {
    recentRumorLead = undefined;
    return undefined;
  }
  return recentRumorLead;
}

export function getNpcMemory(npc: Entity, now = 0): NpcMemory {
  let memory = memories.get(npc.id);
  if (!memory) {
    memory = {
      entityId: npc.id,
      lastSeenPlayerAt: -Infinity,
      helpedByPlayer: 0,
      hurtByPlayer: 0,
      knownRumorIds: [],
      fear: 0,
      trustPlayer: 0,
      lastSpokeAt: -Infinity,
      lastRumorAt: -Infinity,
      lastContextAt: -Infinity,
      lastBarkAt: -Infinity,
      lastMemoryTickMinute: -999999,
      lastRumorEventId: -1,
      lastEventRumorId: '',
      lastEventRumorAt: -Infinity,
      lastWitnessFactLineAt: -Infinity,
      lastWitnessFactEventId: 0,
      lastTouchedAt: now,
      observedFacts: [],
    };
    memories.set(npc.id, memory);
    pruneMemoryStore();
  }
  memory.lastTouchedAt = now;
  return memory;
}

export function markNpcSpokenTo(npc: Entity, now: number): NpcMemory {
  const memory = getNpcMemory(npc, now);
  memory.lastSpokeAt = now;
  memory.lastSeenPlayerAt = now;
  return memory;
}

export function notePlayerHelped(npc: Entity, now: number, amount = 1): void {
  const memory = getNpcMemory(npc, now);
  applyPlayerHelped(memory, amount);
}

export function notePlayerHurt(npc: Entity, now: number, amount = 1): void {
  const memory = getNpcMemory(npc, now);
  applyPlayerHurt(memory, amount);
}

export function notePlayerTheftWitnessed(npc: Entity, now: number, amount = 1): void {
  const memory = getNpcMemory(npc, now);
  applyPlayerTheftWitnessed(memory, amount);
  memory.lastSeenPlayerAt = now;
}

export function notePlayerTheftAudited(npc: Entity, now: number, amount = 1): void {
  const memory = getNpcMemory(npc, now);
  applyPlayerTheftAudited(memory, amount);
}

export function noteObservedEventFact(npc: Entity, event: NpcMemoryEventLike, now: number, react = true): boolean {
  const kind = observedFactKind(event);
  if (!kind) return false;
  const memory = getNpcMemory(npc, now);
  trimObservedFacts(memory, now);
  const eventId = typeof event.id === 'number' ? event.id : syntheticObservedEventId(event, now);
  if (memory.observedFacts.some(fact => fact.eventId === eventId)) return true;
  memory.observedFacts.push({
    eventId,
    kind,
    floor: event.floor,
    zoneId: event.zoneId,
    roomId: event.roomId,
    actorId: event.actorId,
    actorName: clippedName(event.actorName),
    actorFaction: event.actorFaction,
    action: observedFactAction(event, kind),
    targetId: event.targetId,
    targetName: clippedName(event.targetName),
    targetFaction: event.targetFaction,
    itemId: event.itemId,
    itemName: clippedName(event.itemName),
    monsterKind: event.monsterKind,
    residue: observedFactResidue(event, kind),
    observedAt: now,
    expiresAt: now + observedFactTtl(kind),
    score: observedFactScore(event),
    tags: observedFactTags(event, kind),
  });
  if (memory.observedFacts.length > MAX_OBSERVED_FACTS_PER_NPC) {
    memory.observedFacts.splice(0, memory.observedFacts.length - MAX_OBSERVED_FACTS_PER_NPC);
  }
  if (react) applyObservedFactReaction(memory, event, kind, now);
  return true;
}

export function formatRecentWitnessFactLine(memory: NpcMemory, now: number): string | undefined {
  trimObservedFacts(memory, now);
  const fact = mostUsefulObservedFact(memory, now);
  if (!fact) return undefined;
  if (fact.eventId === memory.lastWitnessFactEventId && now - memory.lastWitnessFactLineAt < WITNESS_FACT_LINE_COOLDOWN_S) {
    return undefined;
  }
  memory.lastWitnessFactEventId = fact.eventId;
  memory.lastWitnessFactLineAt = now;
  const place = witnessPlace(fact);
  const residue = witnessResidueText(fact.residue);
  return residue
    ? `Я видел: ${witnessActionText(fact)}. Зацепка: ${place}; след: ${residue}.`
    : `Я видел: ${witnessActionText(fact)}. Зацепка: ${place}.`;
}

export function rememberRumor(npc: Entity, rumorId: string, now: number): boolean {
  return storeRumor(npc, rumorId, now, true);
}

export function learnRumor(npc: Entity, rumorId: string, now: number): boolean {
  return storeRumor(npc, rumorId, now, false);
}

export function flagEventRumor(npc: Entity, rumorId: string, eventId: number, now: number): boolean {
  const memory = getNpcMemory(npc, now);
  if (eventId <= memory.lastRumorEventId) return false;
  memory.lastRumorEventId = eventId;
  memory.lastEventRumorId = rumorId;
  memory.lastEventRumorAt = now;
  return learnRumor(npc, rumorId, now);
}

function storeRumor(npc: Entity, rumorId: string, now: number, markSpoken: boolean): boolean {
  const memory = getNpcMemory(npc, now);
  if (memory.knownRumorIds.includes(rumorId)) return false;
  memory.knownRumorIds.push(rumorId);
  if (memory.knownRumorIds.length > MAX_RUMORS_PER_NPC) {
    memory.knownRumorIds.splice(0, memory.knownRumorIds.length - MAX_RUMORS_PER_NPC);
  }
  if (markSpoken) memory.lastRumorAt = now;
  return true;
}

export function trimNpcMemory(npc: Entity, now: number): void {
  const memory = getNpcMemory(npc, now);
  if (memory.knownRumorIds.length > MAX_RUMORS_PER_NPC) {
    memory.knownRumorIds.splice(0, memory.knownRumorIds.length - MAX_RUMORS_PER_NPC);
  }
  trimObservedFacts(memory, now);
  memory.fear = clamp(memory.fear - 1, 0, 100);
  if (memory.trustPlayer > 0) memory.trustPlayer--;
  else if (memory.trustPlayer < 0) memory.trustPlayer++;
}

export function tickNpcMemoryLowFrequency(npc: Entity, now: number, totalMinutes: number, samosborActive: boolean): boolean {
  const stagger = npc.id % MEMORY_TICK_MINUTES;
  if ((totalMinutes | 0) % MEMORY_TICK_MINUTES !== stagger) return false;
  const memory = getNpcMemory(npc, now);
  if (totalMinutes - memory.lastMemoryTickMinute < MEMORY_TICK_MINUTES) return false;

  memory.lastMemoryTickMinute = totalMinutes;
  if (samosborActive) memory.fear = clamp(memory.fear + 4, 0, 100);
  if (npc.hp !== undefined && npc.maxHp !== undefined && npc.hp < npc.maxHp * 0.5) {
    memory.fear = clamp(memory.fear + 3, 0, 100);
  }
  trimNpcMemory(npc, now);
  return true;
}

export function getNpcMemoryCount(): number {
  return memories.size;
}

function pruneMemoryStore(): void {
  if (memories.size <= MAX_NPC_MEMORIES) return;
  let oldestId = -1;
  let oldestTouch = Infinity;
  for (const [id, memory] of memories) {
    if (memory.lastTouchedAt < oldestTouch) {
      oldestTouch = memory.lastTouchedAt;
      oldestId = id;
    }
  }
  if (oldestId >= 0) memories.delete(oldestId);
}

function applyPlayerHelped(memory: NpcMemory, amount: number): void {
  memory.helpedByPlayer = Math.min(999, memory.helpedByPlayer + amount);
  memory.trustPlayer = clamp(memory.trustPlayer + 8 * amount, -100, 100);
  memory.fear = Math.max(0, memory.fear - 3 * amount);
}

function applyPlayerHurt(memory: NpcMemory, amount: number): void {
  memory.hurtByPlayer = Math.min(999, memory.hurtByPlayer + amount);
  memory.trustPlayer = clamp(memory.trustPlayer - 18 * amount, -100, 100);
  memory.fear = clamp(memory.fear + 15 * amount, 0, 100);
}

function applyPlayerTheftWitnessed(memory: NpcMemory, amount: number): void {
  memory.hurtByPlayer = Math.min(999, memory.hurtByPlayer + amount);
  memory.trustPlayer = clamp(memory.trustPlayer - 14 * amount, -100, 100);
  memory.fear = clamp(memory.fear + 10 * amount, 0, 100);
}

function applyPlayerTheftAudited(memory: NpcMemory, amount: number): void {
  memory.hurtByPlayer = Math.min(999, memory.hurtByPlayer + amount);
  memory.trustPlayer = clamp(memory.trustPlayer - 8 * amount, -100, 100);
  memory.fear = clamp(memory.fear + 5 * amount, 0, 100);
}

function observedFactKind(event: NpcMemoryEventLike): NpcObservedFactKind | undefined {
  const type = event.type ?? '';
  const tags = event.tags ?? [];
  if (type === 'room_lacked_resources' || type === 'room_blocked_production' || tags.includes('resource_shortage')) return 'shortage';
  if (type === 'item_stolen' || tags.includes('theft')) return 'theft';
  if (type === 'contract_created' || type === 'contract_completed' || type === 'contract_failed') return 'contract';
  if (type === 'player_kill_npc' || type === 'npc_kill_npc' || type === 'death_seen') return 'murder';
  if ((type === 'monster_sighted' || type === 'player_kill_monster' || type === 'npc_kill_monster') && isRareMonsterKind(event.monsterKind)) return 'rare_monster';
  if (type === 'player_kill_monster' || type === 'npc_kill_monster' || type === 'fog_boss_killed') return 'monster_kill';
  if (type.includes('samosbor') || tags.includes('samosbor')) return 'samosbor';
  if (type === 'faction_event' || type === 'faction_patrol_clash' || type === 'faction_relation_changed' || tags.includes('faction_event')) return 'faction_event';
  return undefined;
}

function observedFactTtl(kind: NpcObservedFactKind): number {
  switch (kind) {
    case 'theft': return 720;
    case 'murder': return 900;
    case 'contract': return 900;
    case 'rare_monster': return 900;
    case 'monster_kill': return 600;
    case 'shortage': return 720;
    case 'samosbor': return 900;
    case 'faction_event': return 720;
  }
}

function observedFactScore(event: NpcMemoryEventLike): number {
  let score = (event.severity ?? 0) * 20;
  if (event.type === 'player_kill_npc' || event.type === 'npc_kill_npc') score += 12;
  if (isRareMonsterKind(event.monsterKind)) score += 10;
  if (event.type === 'room_lacked_resources' || event.type === 'room_blocked_production') score += 6;
  return clamp(score, 1, 100);
}

function observedFactTags(event: NpcMemoryEventLike, kind: NpcObservedFactKind): string[] {
  const out: string[] = [kind, observedFactAction(event, kind)];
  for (const tag of event.tags ?? []) {
    const clean = String(tag).slice(0, 32);
    if (clean && !out.includes(clean)) out.push(clean);
    if (out.length >= 8) break;
  }
  return out;
}

function syntheticObservedEventId(event: NpcMemoryEventLike, now: number): number {
  const typeHash = event.type ? hashString(event.type) : 0;
  return -Math.abs(((Math.floor(now * 10) & 0xfffff) << 8) ^ typeHash ^ ((event.targetId ?? 0) << 3));
}

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = ((h << 5) - h + input.charCodeAt(i)) | 0;
  return h;
}

function clippedName(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 64) : undefined;
}

function observedFactAction(event: NpcMemoryEventLike, kind: NpcObservedFactKind): NpcWitnessAction {
  if (kind === 'faction_event') return 'faction_clash';
  if (kind === 'rare_monster') return 'rare_monster';
  if (kind === 'monster_kill') return 'monster_kill';
  if (kind === 'murder') return 'murder';
  if (kind === 'shortage') return 'shortage';
  if (kind === 'contract') return 'contract';
  if (kind === 'samosbor') return 'samosbor';
  if (event.type === 'item_stolen' || event.tags?.includes('theft')) return 'theft';
  return 'theft';
}

function observedFactResidue(event: NpcMemoryEventLike, kind: NpcObservedFactKind): NpcWitnessResidue[] {
  const out: NpcWitnessResidue[] = [];
  if (dataNumber(event.data, 'marksPlaced') > 0 || dataArrayHasItems(event.data, 'markKinds')) pushResidue(out, 'mark');
  if (
    kind === 'theft' ||
    event.type === 'container_looted' ||
    dataNumber(event.data, 'spawnedDrops') > 0 ||
    dataNumber(event.data, 'deposited') > 0 ||
    event.data?.containerName !== undefined
  ) pushResidue(out, 'moved_loot');
  if (kind === 'murder' || kind === 'samosbor' || kind === 'rare_monster' || kind === 'faction_event') pushResidue(out, 'scared_npc');
  if (kind === 'shortage' || event.tags?.includes('resource_shortage') || event.tags?.includes('resource_recovery') || dataArrayHasItems(event.data, 'economyDeltas')) {
    pushResidue(out, 'price');
  }
  if (
    event.type === 'samosbor_zone_captured' ||
    dataNumber(event.data, 'pressureCells') > 0 ||
    event.type === 'faction_relation_changed' ||
    event.type === 'faction_patrol_clash'
  ) pushResidue(out, 'zone');
  return out;
}

function dataNumber(data: Record<string, unknown> | undefined, key: string): number {
  const value = data?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function dataArrayHasItems(data: Record<string, unknown> | undefined, key: string): boolean {
  const value = data?.[key];
  return Array.isArray(value) && value.length > 0;
}

function pushResidue(out: NpcWitnessResidue[], value: NpcWitnessResidue): void {
  if (out.length >= MAX_OBSERVED_FACT_RESIDUE || out.includes(value)) return;
  out.push(value);
}

function isRareMonsterKind(kind: MonsterKind | undefined): boolean {
  return kind === MonsterKind.BETONNIK
    || kind === MonsterKind.BETONOED
    || kind === MonsterKind.NIGHTMARE
    || kind === MonsterKind.SHADOW
    || kind === MonsterKind.REBAR
    || kind === MonsterKind.MATKA
    || kind === MonsterKind.KHOROVAYA_MATKA
    || kind === MonsterKind.MANCOBUS
    || kind === MonsterKind.HERALD
    || kind === MonsterKind.CREATOR
    || kind === MonsterKind.SHOVNIK
    || kind === MonsterKind.LAMPOVY
    || kind === MonsterKind.PECHATEED
    || kind === MonsterKind.TUBE_EEL
    || kind === MonsterKind.TRUBNYY_AVTOMAT
    || kind === MonsterKind.PARAGRAPH
    || kind === MonsterKind.NELYUD
    || kind === MonsterKind.KOSTOREZ
    || kind === MonsterKind.SAFEGUARD;
}

function mostUsefulObservedFact(memory: NpcMemory, now: number): NpcObservedFact | undefined {
  let best: NpcObservedFact | undefined;
  let bestScore = -Infinity;
  for (let i = memory.observedFacts.length - 1; i >= 0; i--) {
    const fact = memory.observedFacts[i];
    if (now > fact.expiresAt) continue;
    const freshness = Math.max(0, 30 - Math.floor((now - fact.observedAt) / 30));
    const score = fact.score + freshness + i;
    if (score > bestScore) {
      best = fact;
      bestScore = score;
    }
  }
  return best;
}

const FLOOR_NAMES: Record<number, string> = {
  0: 'Министерство',
  1: 'Квартиры',
  2: 'Жилая зона',
  3: 'Коллекторы',
  4: 'Мясной низ',
  5: 'Пустота',
};

function witnessPlace(fact: NpcObservedFact): string {
  const parts: string[] = [];
  if (fact.floor !== undefined) parts.push(FLOOR_NAMES[fact.floor] ?? `этаж ${fact.floor}`);
  if (fact.zoneId !== undefined) parts.push(`зона ${fact.zoneId + 1}`);
  if (fact.roomId !== undefined) parts.push(`комната ${fact.roomId}`);
  return parts.length > 0 ? parts.join(' / ') : 'место рядом';
}

function witnessActionText(fact: NpcObservedFact): string {
  const actor = fact.actorName ?? factionActorName(fact.actorFaction);
  const playerActor = fact.actorFaction === Faction.PLAYER || fact.actorId === 0;
  const target = fact.targetName ?? fact.itemName ?? fact.itemId ?? 'цель';
  switch (fact.action) {
    case 'theft':
      return `${actor} ${playerActor ? 'украли' : 'украл'} ${fact.itemName ?? fact.itemId ?? 'вещь'}`;
    case 'murder':
      return `${actor} ${playerActor ? 'убили' : 'убил'} ${target}`;
    case 'samosbor':
      return 'самосбор прошел по сектору';
    case 'rare_monster':
      return fact.targetName ? `редкая тварь рядом: ${fact.targetName}` : 'редкая тварь была рядом';
    case 'monster_kill':
      return `${actor} добил ${target}`;
    case 'shortage':
      return `${fact.targetName ?? fact.itemName ?? 'запас'} ушел в дефицит`;
    case 'contract':
      return `${actor} тронул системное задание`;
    case 'faction_clash':
      return 'фракции сцепились в коридоре';
  }
}

function factionActorName(faction: Faction | undefined): string {
  switch (faction) {
    case Faction.PLAYER: return 'вы';
    case Faction.LIQUIDATOR: return 'ликвидатор';
    case Faction.CULTIST: return 'культист';
    case Faction.SCIENTIST: return 'ученый';
    case Faction.WILD: return 'дикий';
    case Faction.CITIZEN: return 'жилец';
    default: return 'кто-то';
  }
}

function witnessResidueText(residue: readonly NpcWitnessResidue[]): string {
  const parts: string[] = [];
  for (const value of residue) {
    switch (value) {
      case 'mark': parts.push('метки на полу'); break;
      case 'moved_loot': parts.push('пропажа или трофеи'); break;
      case 'scared_npc': parts.push('испуганные свидетели'); break;
      case 'price': parts.push('цены и задания сдвинулись'); break;
      case 'zone': parts.push('контроль зоны изменился'); break;
    }
  }
  return parts.slice(0, MAX_OBSERVED_FACT_RESIDUE).join(', ');
}

function applyObservedFactReaction(memory: NpcMemory, event: NpcMemoryEventLike, kind: NpcObservedFactKind, now: number): void {
  const type = event.type ?? '';
  switch (kind) {
    case 'theft':
      if (event.privacy === 'witnessed' || event.tags?.includes('witnessed')) {
        applyPlayerTheftWitnessed(memory, 1);
        memory.lastSeenPlayerAt = now;
      } else {
        applyPlayerTheftAudited(memory, 1);
      }
      return;
    case 'murder':
      if (event.actorFaction === Faction.PLAYER || event.actorId === 0 || type === 'player_kill_npc') applyPlayerHurt(memory, 1);
      memory.fear = clamp(memory.fear + 14, 0, 100);
      return;
    case 'contract':
      if (type === 'contract_completed') applyPlayerHelped(memory, 1);
      else if (type === 'contract_failed') applyPlayerHurt(memory, 1);
      else memory.fear = clamp(memory.fear + 1, 0, 100);
      return;
    case 'rare_monster':
      memory.fear = clamp(memory.fear + 12, 0, 100);
      return;
    case 'monster_kill':
      if (type === 'player_kill_monster' || type === 'fog_boss_killed' || event.actorFaction === Faction.PLAYER || event.actorId === 0) {
        applyPlayerHelped(memory, 1);
        memory.fear = clamp(memory.fear + 3, 0, 100);
      } else {
        memory.fear = clamp(memory.fear + 5, 0, 100);
      }
      return;
    case 'shortage':
      memory.fear = clamp(memory.fear + 4, 0, 100);
      return;
    case 'samosbor':
      memory.fear = clamp(memory.fear + (type === 'samosbor_ended' ? 8 : 12), 0, 100);
      return;
    case 'faction_event':
      memory.fear = clamp(memory.fear + ((event.severity ?? 0) >= 4 ? 8 : 5), 0, 100);
      return;
  }
}

function trimObservedFacts(memory: NpcMemory, now: number): void {
  const facts = memory.observedFacts;
  let keepCount = 0;
  for (let i = 0; i < facts.length; i++) {
    if (now <= facts[i].expiresAt) {
      facts[keepCount++] = facts[i];
    }
  }
  facts.length = keepCount;
  if (keepCount > MAX_OBSERVED_FACTS_PER_NPC) {
    memory.observedFacts = facts.slice(keepCount - MAX_OBSERVED_FACTS_PER_NPC);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
