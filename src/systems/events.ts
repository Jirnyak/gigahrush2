/* ── Structured world event store: fixed-size ring buffers ────── */

import {
  FloorLevel,
  WORLD_EVENT_IMPORTANT_CAPACITY,
  WORLD_EVENT_RECENT_CAPACITY,
  WORLD_EVENT_ZONE_CAPACITY,
  WORLD_EVENT_ZONE_COUNT,
  type ContextFact,
  type EventFilter,
  type GameState,
  type WorldEvent,
  type WorldEventBuffer,
  type WorldEventDraft,
  type WorldEventSeverity,
  type WorldEventState,
  type WorldEventType,
} from '../core/types';
import { getMonsterEcology, monsterEcologyEventData, monsterEcologyTags } from '../data/monster_ecology';
import { recordWorldLogEvent } from './world_log';
import { recordRumorEvent } from './rumor';
import { recordRoomMemoryEvent } from './room_memory';

const MAX_EVENT_TAGS = 16;
const MAX_EVENT_TAG_LEN = 32;
const MAX_EVENT_DATA_KEYS = 12;
const MAX_EVENT_DATA_KEY_LEN = 32;
const MAX_EVENT_DATA_STRING_LEN = 96;
const MAX_EVENT_DATA_ARRAY = 8;
const MAX_EVENT_DATA_DEPTH = 2;
const EVENT_PRIVACIES = new Set(['public', 'local', 'witnessed', 'private', 'secret']);
const CONTEXT_FACT_KINDS = new Set([
  'danger', 'shortage', 'theft', 'death', 'production', 'need', 'quest_hook', 'social', 'territory',
]);
const BASE_FLOORS = [
  FloorLevel.MINISTRY,
  FloorLevel.KVARTIRY,
  FloorLevel.LIVING,
  FloorLevel.MAINTENANCE,
  FloorLevel.HELL,
  FloorLevel.VOID,
] as const;
const RESOURCE_SCARCITY_EVENT_COOLDOWN_S = 600;
const MAX_RESOURCE_SCARCITY_RUMORS = 4;
const MAX_OBSERVER_ERROR_LOGS = 8;

export interface EventZoneSummary {
  floor: FloorLevel;
  zoneId: number;
  count: number;
  maxSeverity: WorldEventSeverity;
  lastId: number;
  lastType: WorldEventType;
}

export interface ContextFactFilter {
  kind?: ContextFact['kind'];
  zoneId?: number;
  minScore?: number;
  sinceEventId?: number;
  tags?: string[];
  now?: number;
  limit?: number;
}

export type WorldEventObserver = (state: GameState, event: WorldEvent) => void;

const eventObservers: WorldEventObserver[] = [];

export type ResourceScarcityBand = 'normal' | 'strained' | 'shortage' | 'critical';
export type ResourceScarcityTrend = 'worsened' | 'recovered';

export interface ResourceScarcityEventDraft {
  floor: FloorLevel;
  zoneId?: number;
  roomId?: number;
  resourceId: string;
  resourceName: string;
  stock: number;
  target: number;
  lowStock: number;
  previousBand: ResourceScarcityBand;
  band: ResourceScarcityBand;
  trend: ResourceScarcityTrend;
  severity: WorldEventSeverity;
  scarcityMultiplier: number;
  contractPressureMultiplier: number;
  tags?: readonly string[];
  reason?: string;
  rumorIds?: readonly string[];
}

export function registerWorldEventObserver(observer: WorldEventObserver): void {
  if (!eventObservers.includes(observer)) eventObservers.push(observer);
}

export function unregisterWorldEventObserver(observer: WorldEventObserver): boolean {
  const idx = eventObservers.indexOf(observer);
  if (idx < 0) return false;
  eventObservers.splice(idx, 1);
  return true;
}

function dispatchEventObservers(state: GameState, event: WorldEvent): void {
  const snapshot = eventObservers.slice();
  let errorLogs = 0;
  for (const observer of snapshot) {
    try {
      observer(state, event);
    } catch (error) {
      if (errorLogs < MAX_OBSERVER_ERROR_LOGS && typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('World event observer failed', error);
        errorLogs++;
      }
    }
  }
}

function createBuffer(capacity: number): WorldEventBuffer {
  return { capacity, start: 0, count: 0, items: new Array<WorldEvent | null>(capacity).fill(null) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readSavedBuffer(input: unknown): unknown[] {
  if (!isRecord(input) || !Array.isArray(input.items)) return [];
  const items = input.items;
  const capacity = Math.max(1, Math.floor(Number(input.capacity) || items.length || 1));
  const start = Math.max(0, Math.floor(Number(input.start) || 0)) % capacity;
  const count = Math.max(0, Math.min(Math.floor(Number(input.count) || 0), capacity, items.length));
  const out: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const idx = (start + count - 1 - i + capacity) % capacity;
    if (idx >= 0 && idx < items.length) out.push(items[idx]);
  }
  return out;
}

function cloneBuffer(input: unknown, capacity: number): WorldEventBuffer {
  const out = createBuffer(capacity);
  const events = readSavedBuffer(input).slice(0, capacity);
  for (let i = events.length - 1; i >= 0; i--) {
    const event = normalizeEvent(events[i], out.count + 1);
    if (event) pushBuffer(out, event);
  }
  return out;
}

function pushBuffer(buffer: WorldEventBuffer, event: WorldEvent): void {
  if (buffer.capacity <= 0) return;
  if (buffer.items.length !== buffer.capacity) buffer.items.length = buffer.capacity;
  if (buffer.count < buffer.capacity) {
    buffer.items[(buffer.start + buffer.count) % buffer.capacity] = event;
    buffer.count++;
  } else {
    buffer.items[buffer.start] = event;
    buffer.start = (buffer.start + 1) % buffer.capacity;
  }
}

function readBuffer(buffer: WorldEventBuffer, limit = buffer.count): WorldEvent[] {
  const out: WorldEvent[] = [];
  const total = Math.min(buffer.count, limit);
  for (let i = 0; i < total; i++) {
    const idx = (buffer.start + buffer.count - 1 - i + buffer.capacity) % buffer.capacity;
    const event = buffer.items[idx];
    if (event) out.push(event);
  }
  return out;
}

function cleanTags(tags: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    if (out.length >= MAX_EVENT_TAGS) break;
    const tag = String(raw).slice(0, MAX_EVENT_TAG_LEN);
    if (tag.length > 0 && !out.includes(tag)) out.push(tag);
  }
  return out;
}

function compactDataValue(value: unknown, depth: number): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') return value.slice(0, MAX_EVENT_DATA_STRING_LEN);
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    if (depth >= MAX_EVENT_DATA_DEPTH) return `[${Math.min(value.length, MAX_EVENT_DATA_ARRAY)}]`;
    const out: unknown[] = [];
    for (const item of value.slice(0, MAX_EVENT_DATA_ARRAY)) {
      const compact = compactDataValue(item, depth + 1);
      if (compact !== undefined) out.push(compact);
    }
    return out;
  }
  if (typeof value === 'object') {
    if (depth >= MAX_EVENT_DATA_DEPTH) return '[object]';
    const out: Record<string, unknown> = {};
    let used = 0;
    for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
      if (used >= MAX_EVENT_DATA_KEYS) break;
      const key = rawKey.slice(0, MAX_EVENT_DATA_KEY_LEN);
      const compact = compactDataValue(rawValue, depth + 1);
      if (key.length > 0 && compact !== undefined) {
        out[key] = compact;
        used++;
      }
    }
    return out;
  }
  return undefined;
}

function compactEventData(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const compact = compactDataValue(data, 0);
  if (!compact || typeof compact !== 'object' || Array.isArray(compact)) return undefined;
  return Object.keys(compact).length > 0 ? compact as Record<string, unknown> : undefined;
}

function clampSeverity(value: unknown): WorldEventSeverity {
  const n = Math.max(0, Math.min(5, Math.floor(Number(value) || 0)));
  return n as WorldEventSeverity;
}

function maxBufferEventId(buffer: WorldEventBuffer): number {
  let maxId = 0;
  for (const event of readBuffer(buffer)) {
    if (event.id > maxId) maxId = event.id;
  }
  return maxId;
}

function normalizeFloor(value: unknown): FloorLevel {
  return typeof value === 'number' && BASE_FLOORS.includes(value as FloorLevel)
    ? value as FloorLevel
    : FloorLevel.LIVING;
}

function normalizePrivacy(value: unknown): WorldEvent['privacy'] {
  return typeof value === 'string' && EVENT_PRIVACIES.has(value)
    ? value as WorldEvent['privacy']
    : 'local';
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeEvent(raw: unknown, fallbackId: number): WorldEvent | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  const event = raw as Partial<WorldEvent>;
  return {
    ...event,
    id: Math.max(1, Math.floor(Number(event.id) || fallbackId)),
    type: raw.type as WorldEventType,
    time: finiteNumber(event.time, 0),
    day: finiteNumber(event.day, 0),
    hour: finiteNumber(event.hour, 0),
    minute: finiteNumber(event.minute, 0),
    floor: normalizeFloor(event.floor),
    truth: 'fact',
    severity: clampSeverity(event.severity),
    privacy: normalizePrivacy(event.privacy),
    tags: cleanTags(event.tags),
    data: compactEventData(event.data),
  } as WorldEvent;
}

function normalizeContextFact(raw: unknown, fallbackId: number): ContextFact | null {
  if (!isRecord(raw) || typeof raw.kind !== 'string' || !CONTEXT_FACT_KINDS.has(raw.kind)) return null;
  const fact = raw as Partial<ContextFact>;
  return {
    id: Math.max(1, Math.floor(Number(fact.id) || fallbackId)),
    eventId: Math.max(0, Math.floor(Number(fact.eventId) || 0)),
    kind: raw.kind as ContextFact['kind'],
    subjectId: Number.isFinite(fact.subjectId) ? fact.subjectId as number : undefined,
    subjectName: typeof fact.subjectName === 'string' ? fact.subjectName.slice(0, MAX_EVENT_DATA_STRING_LEN) : undefined,
    zoneId: Number.isFinite(fact.zoneId) ? fact.zoneId as number : undefined,
    roomId: Number.isFinite(fact.roomId) ? fact.roomId as number : undefined,
    itemId: typeof fact.itemId === 'string' ? fact.itemId.slice(0, MAX_EVENT_DATA_STRING_LEN) : undefined,
    faction: Number.isFinite(fact.faction) ? fact.faction as ContextFact['faction'] : undefined,
    score: Math.max(0, Math.min(999, Number(fact.score) || 0)),
    expiresAt: Number.isFinite(fact.expiresAt) ? fact.expiresAt as number : undefined,
    tags: cleanTags(fact.tags),
  };
}

export function createWorldEventState(): WorldEventState {
  const zoneEvents: WorldEventBuffer[] = [];
  for (let i = 0; i < WORLD_EVENT_ZONE_COUNT; i++) zoneEvents.push(createBuffer(WORLD_EVENT_ZONE_CAPACITY));
  return {
    nextId: 1,
    recentEvents: createBuffer(WORLD_EVENT_RECENT_CAPACITY),
    importantEvents: createBuffer(WORLD_EVENT_IMPORTANT_CAPACITY),
    zoneEvents,
    facts: [],
    nextFactId: 1,
    lastLogKey: '',
    lastLogTime: -Infinity,
  };
}

export function normalizeWorldEventState(input?: Partial<WorldEventState> | null): WorldEventState {
  if (!isRecord(input)) return createWorldEventState();
  const state = createWorldEventState();
  state.nextId = Math.max(1, Math.floor(Number(input.nextId) || 1));
  if (input.recentEvents) state.recentEvents = cloneBuffer(input.recentEvents, WORLD_EVENT_RECENT_CAPACITY);
  if (input.importantEvents) state.importantEvents = cloneBuffer(input.importantEvents, WORLD_EVENT_IMPORTANT_CAPACITY);
  if (Array.isArray(input.zoneEvents)) {
    for (let i = 0; i < WORLD_EVENT_ZONE_COUNT; i++) {
      if (input.zoneEvents[i]) state.zoneEvents[i] = cloneBuffer(input.zoneEvents[i], WORLD_EVENT_ZONE_CAPACITY);
    }
  }
  if (Array.isArray(input.facts)) {
    for (const raw of input.facts.slice(-WORLD_EVENT_IMPORTANT_CAPACITY)) {
      const fact = normalizeContextFact(raw, state.facts.length + 1);
      if (!fact) continue;
      state.facts.push(fact);
      state.nextFactId = Math.max(state.nextFactId, fact.id + 1);
    }
  }
  state.nextFactId = Math.max(state.nextFactId, Math.floor(Number(input.nextFactId) || 1));
  state.lastLogKey = typeof input.lastLogKey === 'string' ? input.lastLogKey.slice(0, MAX_EVENT_DATA_STRING_LEN) : '';
  state.lastLogTime = finiteNumber(input.lastLogTime, -Infinity);
  let maxEventId = Math.max(maxBufferEventId(state.recentEvents), maxBufferEventId(state.importantEvents));
  for (const buffer of state.zoneEvents) maxEventId = Math.max(maxEventId, maxBufferEventId(buffer));
  state.nextId = Math.max(state.nextId, maxEventId + 1);
  return state;
}

export function ensureWorldEventState(state: GameState): WorldEventState {
  if (!state.worldEvents) state.worldEvents = createWorldEventState();
  return state.worldEvents;
}



function enrichMonsterKillDraft(draft: WorldEventDraft): WorldEventDraft {
  if (draft.monsterKind === undefined) return draft;
  if (draft.type !== 'player_kill_monster' && draft.type !== 'npc_kill_monster') return draft;
  const ecology = getMonsterEcology(draft.monsterKind);
  const data = monsterEcologyEventData(draft.monsterKind);
  if (!ecology || !data) return draft;

  const tags = [...draft.tags];
  for (const tag of monsterEcologyTags(draft.monsterKind)) {
    if (!tags.includes(tag)) tags.push(tag);
  }

  return {
    ...draft,
    severity: ecology.rare ? clampSeverity(Math.max(draft.severity, 4)) : draft.severity,
    tags,
    data: { ...draft.data, ...data },
  };
}

function contextFactKind(event: WorldEvent): ContextFact['kind'] | undefined {
  if (event.type === 'room_lacked_resources' || event.type === 'room_blocked_production' || event.tags.includes('resource_shortage')) return 'shortage';
  if (event.type === 'room_produced_items' || event.tags.includes('resource_recovery')) return 'production';
  if (event.type === 'item_stolen' || event.tags.includes('theft')) return 'theft';
  if (
    event.type === 'permit_forged' ||
    event.type === 'permit_exposed' ||
    event.type === 'access_granted' ||
    event.tags.includes('permit')
  ) return 'social';
  if (event.type === 'contract_created' || event.type === 'contract_completed' || event.type === 'contract_failed') return 'quest_hook';
  if (event.type === 'gnilushka_spared' || event.type === 'gnilushka_delivered') return 'social';
  if (
    event.type === 'player_kill_monster' ||
    event.type === 'npc_kill_monster' ||
    event.type === 'fog_boss_killed' ||
    event.type === 'player_kill_npc' ||
    event.type === 'npc_kill_npc' ||
    event.type === 'death_seen'
  ) return 'death';
  if (event.type === 'monster_sighted' && isRareMonsterEvent(event)) return 'danger';
  if (event.type === 'gnilushka_hurt') return 'danger';
  if (event.type === 'emergency_panel_used') {
    if (event.tags.includes('repair')) return 'production';
    if (event.tags.includes('overload') || event.tags.includes('shutdown')) return 'danger';
    return 'territory';
  }
  if (
    event.type === 'samosbor_warning' ||
    event.type === 'samosbor_started' ||
    event.type === 'samosbor_zone_captured' ||
    event.type === 'samosbor_ended' ||
    event.type === 'net_terminal_hack_failed' ||
    event.type === 'gravity_beam_fired' ||
    event.tags.includes('hack_failed') ||
    event.tags.includes('safeguard') ||
    event.tags.includes('deletion_beam') ||
    event.tags.includes('samosbor')
  ) return 'danger';
  if (event.type === 'faction_event' || event.type === 'faction_patrol_clash' || event.type === 'faction_relation_changed' || event.tags.includes('faction_event')) return 'territory';
  return undefined;
}

function dataNumber(data: Record<string, unknown> | undefined, key: string): number {
  const value = data?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function dataArrayHasItems(data: Record<string, unknown> | undefined, key: string): boolean {
  const value = data?.[key];
  return Array.isArray(value) && value.length > 0;
}

function isRareMonsterEvent(event: WorldEvent): boolean {
  return event.monsterKind !== undefined && getMonsterEcology(event.monsterKind)?.rare === true;
}

function contextFactResidueTags(event: WorldEvent): string[] {
  const tags: string[] = [];
  if (dataNumber(event.data, 'marksPlaced') > 0 || dataArrayHasItems(event.data, 'markKinds')) tags.push('residue_mark');
  if (
    event.type === 'item_stolen' ||
    event.type === 'container_looted' ||
    dataNumber(event.data, 'spawnedDrops') > 0 ||
    dataNumber(event.data, 'deposited') > 0 ||
    event.containerId !== undefined
  ) tags.push('residue_moved_loot');
  if (
    event.type === 'samosbor_warning' ||
    event.type === 'samosbor_started' ||
    event.type === 'samosbor_ended' ||
    event.type === 'player_kill_npc' ||
    event.type === 'npc_kill_npc' ||
    event.type === 'monster_sighted' ||
    event.tags.includes('faction_event')
  ) tags.push('residue_scared_npc');
  if (
    event.type === 'room_lacked_resources' ||
    event.type === 'room_blocked_production' ||
    event.tags.includes('resource_shortage') ||
    event.tags.includes('resource_recovery') ||
    dataArrayHasItems(event.data, 'economyDeltas')
  ) tags.push('residue_price');
  if (
    event.type === 'samosbor_zone_captured' ||
    dataNumber(event.data, 'pressureCells') > 0 ||
    event.type === 'faction_relation_changed' ||
    event.type === 'faction_patrol_clash'
  ) tags.push('residue_zone');
  return tags;
}

function contextFactTags(event: WorldEvent, kind: ContextFact['kind']): string[] {
  const tags: string[] = [kind, event.type];
  if (kind === 'quest_hook') tags.push('contract');
  if (kind === 'death') {
    tags.push('kill');
    if (event.type === 'player_kill_npc' || event.type === 'npc_kill_npc' || event.type === 'death_seen') tags.push('murder');
    else tags.push('monster');
  }
  if (kind === 'shortage') tags.push('shortage', 'production_shortage');
  if (kind === 'production') tags.push('production');
  if (event.type === 'monster_sighted' && isRareMonsterEvent(event)) tags.push('rare_monster');
  if (kind === 'theft') tags.push('theft');
  if (event.type === 'samosbor_ended') tags.push('samosbor', 'aftermath');
  else if (event.type.includes('samosbor') || event.tags.includes('samosbor')) tags.push('samosbor');
  if (event.type === 'faction_event' || event.type === 'faction_patrol_clash' || event.type === 'faction_relation_changed' || event.tags.includes('faction_event')) tags.push('faction_event');
  for (const tag of contextFactResidueTags(event)) tags.push(tag);
  for (const tag of event.tags) tags.push(tag);
  return cleanTags(tags);
}

function contextFactTtl(event: WorldEvent, kind: ContextFact['kind']): number {
  switch (kind) {
    case 'theft': return 720;
    case 'quest_hook': return event.type === 'contract_created' ? 900 : 600;
    case 'death': return 600;
    case 'shortage': return 900;
    case 'production': return 600;
    case 'danger': return event.type === 'samosbor_ended' ? 900 : 480;
    case 'territory': return 720;
    default: return 480;
  }
}

function contextFactScore(event: WorldEvent, kind: ContextFact['kind']): number {
  const privacyBoost = event.privacy === 'public' ? 8 : event.privacy === 'witnessed' ? 12 : 0;
  const valueBoost = kind === 'theft' ? Math.min(18, Math.floor((event.itemValue ?? 0) / 10)) : 0;
  return Math.max(1, Math.min(100, event.severity * 18 + privacyBoost + valueBoost));
}

function contextFactSubjectId(event: WorldEvent, kind: ContextFact['kind']): number | undefined {
  if (kind === 'theft' || kind === 'quest_hook') return event.actorId;
  if (kind === 'death') return event.targetId ?? event.actorId;
  return event.targetId ?? event.actorId;
}

function contextFactSubjectName(event: WorldEvent, kind: ContextFact['kind']): string | undefined {
  if (kind === 'theft' || kind === 'quest_hook') return event.actorName ?? event.targetName;
  if (kind === 'death') return event.targetName ?? event.actorName;
  return event.targetName ?? event.actorName;
}

function contextFactFaction(event: WorldEvent, kind: ContextFact['kind']): ContextFact['faction'] | undefined {
  if (kind === 'theft' || kind === 'quest_hook') return event.actorFaction;
  return event.targetFaction ?? event.actorFaction ?? event.containerFaction;
}

function recordContextFact(store: WorldEventState, event: WorldEvent): void {
  const kind = contextFactKind(event);
  if (!kind) return;
  store.facts.push({
    id: store.nextFactId++,
    eventId: event.id,
    kind,
    subjectId: contextFactSubjectId(event, kind),
    subjectName: contextFactSubjectName(event, kind),
    zoneId: event.zoneId,
    roomId: event.roomId,
    itemId: event.itemId,
    faction: contextFactFaction(event, kind),
    score: contextFactScore(event, kind),
    expiresAt: event.time + contextFactTtl(event, kind),
    tags: contextFactTags(event, kind),
  });
  if (store.facts.length > WORLD_EVENT_IMPORTANT_CAPACITY) {
    store.facts.splice(0, store.facts.length - WORLD_EVENT_IMPORTANT_CAPACITY);
  }
}

export function publishEvent(state: GameState, draft: WorldEventDraft): WorldEvent {
  const enriched = enrichMonsterKillDraft(draft);
  const store = ensureWorldEventState(state);
  const event: WorldEvent = {
    ...enriched,
    id: store.nextId++,
    time: enriched.time ?? state.time,
    day: enriched.day ?? Math.floor(state.clock.totalMinutes / 1440),
    hour: enriched.hour ?? state.clock.hour,
    minute: enriched.minute ?? state.clock.minute,
    floor: enriched.floor ?? state.currentFloor,
    truth: 'fact',
    severity: clampSeverity(enriched.severity),
    tags: cleanTags(enriched.tags),
    data: compactEventData(enriched.data),
  };

  pushBuffer(store.recentEvents, event);
  if (event.severity >= 4) pushBuffer(store.importantEvents, event);
  if (event.zoneId !== undefined && event.zoneId >= 0 && event.zoneId < store.zoneEvents.length) {
    pushBuffer(store.zoneEvents[event.zoneId], event);
  }
  recordContextFact(store, event);
  recordRoomMemoryEvent(event);
  recordWorldLogEvent(state, event);
  recordRumorEvent(event);
  dispatchEventObservers(state, event);
  return event;
}

function compactNumber(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function recentResourceScarcityEventExists(state: GameState, draft: ResourceScarcityEventDraft): boolean {
  const store = ensureWorldEventState(state);
  const buffer = store.recentEvents;
  for (let i = 0; i < buffer.count; i++) {
    const idx = (buffer.start + buffer.count - 1 - i + buffer.capacity) % buffer.capacity;
    const event = buffer.items[idx];
    if (!event) continue;
    const age = state.time - event.time;
    if (age < 0) continue;
    if (age > RESOURCE_SCARCITY_EVENT_COOLDOWN_S) break;
    if (event.floor !== draft.floor) continue;
    if ((event.zoneId ?? -1) !== (draft.zoneId ?? -1)) continue;
    if (event.data?.resourceId !== draft.resourceId) continue;
    if (event.data?.band !== draft.band) continue;
    if (event.data?.trend !== draft.trend) continue;
    if (!event.tags.includes('resource_shortage') && !event.tags.includes('resource_recovery')) continue;
    return true;
  }
  return false;
}

export function publishResourceScarcityEvent(state: GameState, draft: ResourceScarcityEventDraft): WorldEvent | undefined {
  if (recentResourceScarcityEventExists(state, draft)) return undefined;
  const recovered = draft.trend === 'recovered';
  return publishEvent(state, {
    type: recovered ? 'room_produced_items' : 'room_lacked_resources',
    floor: draft.floor,
    zoneId: draft.zoneId,
    roomId: draft.roomId,
    targetName: draft.resourceName,
    severity: draft.severity,
    privacy: draft.severity >= 4 ? 'public' : 'local',
    tags: [
      'economy',
      recovered ? 'resource_recovery' : 'resource_shortage',
      'scarcity_band',
      `res_${draft.resourceId}`,
      `band_${draft.band}`,
      'contract_pressure',
      ...(draft.tags ?? []),
    ],
    data: {
      resourceId: draft.resourceId,
      resourceName: draft.resourceName,
      stock: Math.round(draft.stock),
      target: Math.round(draft.target),
      lowStock: Math.round(draft.lowStock),
      previousBand: draft.previousBand,
      band: draft.band,
      trend: draft.trend,
      scarcityMultiplier: compactNumber(draft.scarcityMultiplier),
      contractPressureMultiplier: compactNumber(draft.contractPressureMultiplier),
      reason: draft.reason,
      rumorIds: draft.rumorIds?.slice(0, MAX_RESOURCE_SCARCITY_RUMORS),
    },
  });
}

export function getRecentEvents(state: GameState, filter: EventFilter = {}): WorldEvent[] {
  const store = ensureWorldEventState(state);
  const buffer = store.recentEvents;
  const limit = filter.limit ?? buffer.count;
  const out: WorldEvent[] = [];
  if (limit <= 0 || buffer.count === 0) return out;

  const filterType = filter.type;
  const filterZoneId = filter.zoneId;
  const filterFloor = filter.floor;
  const filterMinSeverity = filter.minSeverity;
  const filterPrivacy = filter.privacy;
  const filterActorId = filter.actorId;
  const filterTargetId = filter.targetId;
  const filterSinceId = filter.sinceId;
  const filterTags = filter.tags;
  const filterTagsLen = filterTags ? filterTags.length : 0;

  const total = buffer.count;
  const capacity = buffer.capacity;
  const start = buffer.start;
  const items = buffer.items;

  for (let i = 0; i < total; i++) {
    const idx = (start + total - 1 - i + capacity) % capacity;
    const event = items[idx];
    if (!event) continue;

    if (filterSinceId !== undefined && event.id <= filterSinceId) break;
    if (filterType !== undefined && event.type !== filterType) continue;
    if (filterZoneId !== undefined && event.zoneId !== filterZoneId) continue;
    if (filterFloor !== undefined && event.floor !== filterFloor) continue;
    if (filterMinSeverity !== undefined && event.severity < filterMinSeverity) continue;
    if (filterPrivacy !== undefined && event.privacy !== filterPrivacy) continue;
    if (filterActorId !== undefined && event.actorId !== filterActorId) continue;
    if (filterTargetId !== undefined && event.targetId !== filterTargetId) continue;
    if (filterTagsLen > 0) {
      let tagsMatch = true;
      for (let j = 0; j < filterTagsLen; j++) {
        if (!event.tags.includes(filterTags![j])) {
          tagsMatch = false;
          break;
        }
      }
      if (!tagsMatch) continue;
    }

    out.push(event);
    if (out.length >= limit) break;
  }
  return out;
}

export function getZoneEvents(state: GameState, zoneId: number, filter: EventFilter = {}): WorldEvent[] {
  const store = ensureWorldEventState(state);
  const buffer = store.zoneEvents[zoneId];
  if (!buffer) return [];
  const limit = filter.limit ?? buffer.count;
  const out: WorldEvent[] = [];
  if (limit <= 0 || buffer.count === 0) return out;

  const filterType = filter.type;
  const filterFloor = filter.floor;
  const filterMinSeverity = filter.minSeverity;
  const filterPrivacy = filter.privacy;
  const filterActorId = filter.actorId;
  const filterTargetId = filter.targetId;
  const filterSinceId = filter.sinceId;
  const filterTags = filter.tags;
  const filterTagsLen = filterTags ? filterTags.length : 0;

  const total = buffer.count;
  const capacity = buffer.capacity;
  const start = buffer.start;
  const items = buffer.items;

  for (let i = 0; i < total; i++) {
    const idx = (start + total - 1 - i + capacity) % capacity;
    const event = items[idx];
    if (!event) continue;

    if (filterSinceId !== undefined && event.id <= filterSinceId) break;
    if (event.zoneId !== zoneId) continue;
    if (filterType !== undefined && event.type !== filterType) continue;
    if (filterFloor !== undefined && event.floor !== filterFloor) continue;
    if (filterMinSeverity !== undefined && event.severity < filterMinSeverity) continue;
    if (filterPrivacy !== undefined && event.privacy !== filterPrivacy) continue;
    if (filterActorId !== undefined && event.actorId !== filterActorId) continue;
    if (filterTargetId !== undefined && event.targetId !== filterTargetId) continue;
    if (filterTagsLen > 0) {
      let tagsMatch = true;
      for (let j = 0; j < filterTagsLen; j++) {
        if (!event.tags.includes(filterTags![j])) {
          tagsMatch = false;
          break;
        }
      }
      if (!tagsMatch) continue;
    }

    out.push(event);
    if (out.length >= limit) break;
  }
  return out;
}

export function getImportantEvents(state: GameState, limit = 10): WorldEvent[] {
  const store = ensureWorldEventState(state);
  return readBuffer(store.importantEvents, limit);
}

export function getRecentContextFacts(state: GameState, filter: ContextFactFilter = {}): ContextFact[] {
  const store = ensureWorldEventState(state);
  const out: ContextFact[] = [];
  const limit = filter.limit ?? store.facts.length;
  for (let i = store.facts.length - 1; i >= 0; i--) {
    const fact = store.facts[i];
    if (filter.kind !== undefined && fact.kind !== filter.kind) continue;
    if (filter.zoneId !== undefined && fact.zoneId !== filter.zoneId) continue;
    if (filter.minScore !== undefined && fact.score < filter.minScore) continue;
    if (filter.sinceEventId !== undefined && fact.eventId <= filter.sinceEventId) continue;
    if (filter.now !== undefined && fact.expiresAt !== undefined && filter.now > fact.expiresAt) continue;
    if (filter.tags && !filter.tags.every(tag => fact.tags.includes(tag))) continue;
    out.push(fact);
    if (out.length >= limit) break;
  }
  return out;
}

export function summarizeImportantEventsByFloorZone(state: GameState, limit = 12): EventZoneSummary[] {
  const store = ensureWorldEventState(state);
  const byZone = new Map<string, EventZoneSummary>();
  for (const event of readBuffer(store.importantEvents)) {
    const zoneId = event.zoneId ?? -1;
    const key = `${event.floor}:${zoneId}`;
    let row = byZone.get(key);
    if (!row) {
      row = {
        floor: event.floor,
        zoneId,
        count: 0,
        maxSeverity: 0,
        lastId: event.id,
        lastType: event.type,
      };
      byZone.set(key, row);
    }
    row.count++;
    if (event.severity > row.maxSeverity) row.maxSeverity = event.severity;
    if (event.id >= row.lastId) {
      row.lastId = event.id;
      row.lastType = event.type;
    }
  }
  return [...byZone.values()].sort((a, b) => b.lastId - a.lastId).slice(0, limit);
}

export function trimEventHistoryForSave(state: GameState): WorldEventState {
  return normalizeWorldEventState(ensureWorldEventState(state));
}
