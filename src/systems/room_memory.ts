/* ── Bounded communal room memory from public/local events ────── */

import {
  Faction,
  type FloorLevel,
  type WorldContainer,
  type WorldEvent,
  type WorldEventSeverity,
  type WorldEventType,
} from '../core/types';

export const ROOM_MEMORY_BITS = {
  THEFT: 1 << 0,
  HELP: 1 << 1,
  INFORM: 1 << 2,
  COMBAT: 1 << 3,
  REPAIR: 1 << 4,
  SAMOSBOR: 1 << 5,
} as const;

export const ROOM_MEMORY_ACTOR_PLAYER = 1 << 0;
export const ROOM_MEMORY_CAP = 96;

export interface RoomMemoryRecord {
  floor: FloorLevel;
  roomId: number;
  zoneId?: number;
  bits: number;
  severity: WorldEventSeverity;
  lastAt: number;
  ttl: number;
  actorFlags: number;
  lastEventId: number;
  lastEventType: WorldEventType;
  count: number;
}

const MEMORY_TICK_S = 5;
const SEVERITY_DECAY_S = 180;
const MIN_TTL_S = 300;
const MAX_TTL_S = 1800;
const REMEMBERED_PRIVACIES = new Set(['public', 'local', 'witnessed']);

const roomMemory = new Map<string, RoomMemoryRecord>();
let tickAccum = 0;

function memoryKey(floor: FloorLevel, roomId: number): string {
  return `${floor}:${roomId}`;
}

function hasTag(event: WorldEvent, tag: string): boolean {
  return event.tags.includes(tag);
}

function hasAnyTag(event: WorldEvent, tags: readonly string[]): boolean {
  for (const tag of tags) if (hasTag(event, tag)) return true;
  return false;
}

function dataString(event: WorldEvent, key: string): string {
  const value = event.data?.[key];
  return typeof value === 'string' ? value : '';
}

function eventInvolvesPlayer(event: WorldEvent): boolean {
  return event.actorFaction === Faction.PLAYER
    || event.type.startsWith('player_')
    || event.actorId === 0
    || hasTag(event, 'player');
}

function roomMemoryBitsForEvent(event: WorldEvent): number {
  let bits = 0;
  const type = event.type;
  const outcome = dataString(event, 'outcome') || dataString(event, 'depositOutcome');

  if (type === 'item_stolen' || type === 'ration_coupon_stolen' || hasAnyTag(event, ['theft', 'stolen', 'coupon_stolen'])) {
    bits |= ROOM_MEMORY_BITS.THEFT;
  }
  if (
    type === 'player_hurt_npc' ||
    type === 'player_kill_npc' ||
    type === 'player_kill_monster' ||
    (hasTag(event, 'combat') && eventInvolvesPlayer(event))
  ) {
    bits |= ROOM_MEMORY_BITS.COMBAT;
  }
  if (
    hasAnyTag(event, ['rescue', 'rescued', 'relief', 'resident_relief', 'veretar_window_curtain', 'veretar_window_seal'])
    || outcome.includes('rescued')
    || outcome === 'resident_relief'
    || outcome === 'veretar_window_curtained'
    || outcome === 'veretar_window_sealed'
  ) {
    bits |= ROOM_MEMORY_BITS.HELP;
  }
  if (
    hasAnyTag(event, ['evidence', 'expose', 'report', 'denunciation'])
    || type === 'ration_coupon_reported'
    || outcome === 'evidence_planted'
  ) {
    bits |= ROOM_MEMORY_BITS.INFORM;
  }
  if (type === 'hermodoor_borer_repaired' || type.endsWith('_repaired') || hasAnyTag(event, ['repair', 'repaired'])) {
    bits |= ROOM_MEMORY_BITS.REPAIR;
  }
  if (
    type === 'shelter_tally_handled'
    || hasAnyTag(event, ['shelter_choice', 'samosbor_aftermath'])
    || (hasTag(event, 'shelter') && hasTag(event, 'samosbor'))
  ) {
    bits |= ROOM_MEMORY_BITS.SAMOSBOR;
  }

  return bits;
}

function minSeverityForBits(bits: number): number {
  if (bits & ROOM_MEMORY_BITS.COMBAT) return 3;
  if (bits & ROOM_MEMORY_BITS.THEFT) return 2;
  if (bits & ROOM_MEMORY_BITS.SAMOSBOR) return 3;
  if (bits & ROOM_MEMORY_BITS.INFORM) return 2;
  if (bits & ROOM_MEMORY_BITS.REPAIR) return 2;
  if (bits & ROOM_MEMORY_BITS.HELP) return 2;
  return 1;
}

function clampSeverity(value: number): WorldEventSeverity {
  return Math.max(1, Math.min(5, Math.floor(value))) as WorldEventSeverity;
}

function ttlForBits(bits: number, severity: WorldEventSeverity): number {
  let ttl = 0;
  if (bits & ROOM_MEMORY_BITS.THEFT) ttl = Math.max(ttl, 720);
  if (bits & ROOM_MEMORY_BITS.COMBAT) ttl = Math.max(ttl, 900);
  if (bits & ROOM_MEMORY_BITS.SAMOSBOR) ttl = Math.max(ttl, 900);
  if (bits & ROOM_MEMORY_BITS.INFORM) ttl = Math.max(ttl, 720);
  if (bits & ROOM_MEMORY_BITS.REPAIR) ttl = Math.max(ttl, 600);
  if (bits & ROOM_MEMORY_BITS.HELP) ttl = Math.max(ttl, 600);
  return Math.max(MIN_TTL_S, Math.min(MAX_TTL_S, ttl + severity * 75));
}

function trimRoomMemoryToCap(): void {
  while (roomMemory.size > ROOM_MEMORY_CAP) {
    let dropKey = '';
    let dropScore = Infinity;
    for (const [key, record] of roomMemory) {
      const score = record.severity * 10_000 + record.ttl + record.lastAt * 0.001;
      if (score < dropScore) {
        dropKey = key;
        dropScore = score;
      }
    }
    if (!dropKey) return;
    roomMemory.delete(dropKey);
  }
}

export function clearRoomMemory(): void {
  roomMemory.clear();
  tickAccum = 0;
}

export function getRoomMemoryCount(): number {
  return roomMemory.size;
}

export function recordRoomMemoryEvent(event: WorldEvent): RoomMemoryRecord | undefined {
  if (!REMEMBERED_PRIVACIES.has(event.privacy)) return undefined;
  if (event.roomId === undefined || event.roomId < 0) return undefined;
  if (!eventInvolvesPlayer(event)) return undefined;
  const bits = roomMemoryBitsForEvent(event);
  if (bits === 0) return undefined;

  const severity = clampSeverity(Math.max(event.severity, minSeverityForBits(bits)));
  const key = memoryKey(event.floor, event.roomId);
  const existing = roomMemory.get(key);
  const ttl = ttlForBits(bits, severity);
  if (existing) {
    existing.bits |= bits;
    existing.severity = clampSeverity(Math.max(existing.severity, severity));
    existing.lastAt = event.time;
    existing.ttl = Math.max(existing.ttl, ttl);
    existing.actorFlags |= ROOM_MEMORY_ACTOR_PLAYER;
    existing.lastEventId = event.id;
    existing.lastEventType = event.type;
    existing.zoneId = event.zoneId ?? existing.zoneId;
    existing.count = Math.min(999, existing.count + 1);
    return existing;
  }

  const record: RoomMemoryRecord = {
    floor: event.floor,
    roomId: event.roomId,
    zoneId: event.zoneId,
    bits,
    severity,
    lastAt: event.time,
    ttl,
    actorFlags: ROOM_MEMORY_ACTOR_PLAYER,
    lastEventId: event.id,
    lastEventType: event.type,
    count: 1,
  };
  roomMemory.set(key, record);
  trimRoomMemoryToCap();
  return record;
}

export function tickRoomMemory(_now: number, dt: number): number {
  if (dt <= 0 || roomMemory.size === 0) return 0;
  tickAccum += dt;
  if (tickAccum < MEMORY_TICK_S) return 0;
  const elapsed = tickAccum;
  tickAccum = 0;

  let changed = 0;
  for (const [key, record] of roomMemory) {
    const previousTtl = record.ttl;
    record.ttl -= elapsed;
    if (record.ttl <= 0) {
      roomMemory.delete(key);
      changed++;
      continue;
    }
    const previousBucket = Math.floor(previousTtl / SEVERITY_DECAY_S);
    const nextBucket = Math.floor(record.ttl / SEVERITY_DECAY_S);
    if (nextBucket < previousBucket && record.severity > 1) {
      record.severity = clampSeverity(record.severity - 1);
      changed++;
    }
  }
  return changed;
}

export function getRoomMemory(floor: FloorLevel | undefined, roomId: number | undefined): RoomMemoryRecord | undefined {
  if (floor === undefined || roomId === undefined || roomId < 0) return undefined;
  const record = roomMemory.get(memoryKey(floor, roomId));
  return record && record.ttl > 0 ? record : undefined;
}

export function getRoomMemoryForContainer(container: Pick<WorldContainer, 'floor' | 'roomId'>): RoomMemoryRecord | undefined {
  return getRoomMemory(container.floor, container.roomId);
}

export function roomMemoryHas(record: RoomMemoryRecord | undefined, bits: number): boolean {
  return record !== undefined && (record.bits & bits) !== 0;
}

export function roomMemoryHasAny(record: RoomMemoryRecord | undefined, bits: number): boolean {
  return roomMemoryHas(record, bits);
}

export function roomMemoryIsHostile(record: RoomMemoryRecord | undefined): boolean {
  return roomMemoryHasAny(record, ROOM_MEMORY_BITS.THEFT | ROOM_MEMORY_BITS.COMBAT);
}

export function roomMemoryIsHelpful(record: RoomMemoryRecord | undefined): boolean {
  return roomMemoryHasAny(record, ROOM_MEMORY_BITS.HELP | ROOM_MEMORY_BITS.REPAIR | ROOM_MEMORY_BITS.INFORM);
}

export function roomMemoryRevealsStash(record: RoomMemoryRecord | undefined): boolean {
  if (!record || record.severity < 3) return false;
  if (roomMemoryIsHostile(record)) return false;
  return roomMemoryHasAny(record, ROOM_MEMORY_BITS.HELP | ROOM_MEMORY_BITS.REPAIR | ROOM_MEMORY_BITS.SAMOSBOR);
}

export function roomMemoryPriceMultiplier(record: RoomMemoryRecord | undefined): number {
  if (!record) return 1;
  if (roomMemoryIsHostile(record)) return record.severity >= 4 ? 1.35 : 1.18;
  if (roomMemoryIsHelpful(record)) return record.severity >= 4 ? 0.82 : 0.9;
  return 1;
}

export function roomMemoryShouldRefuseService(record: RoomMemoryRecord | undefined): boolean {
  return !!record && record.severity >= 4 && roomMemoryIsHostile(record);
}

export function roomMemoryShouldReportTouch(record: RoomMemoryRecord | undefined): boolean {
  return !!record && record.severity >= 3 && roomMemoryIsHostile(record);
}

const BIT_LABELS: readonly [number, string][] = [
  [ROOM_MEMORY_BITS.THEFT, 'кража'],
  [ROOM_MEMORY_BITS.HELP, 'помощь'],
  [ROOM_MEMORY_BITS.INFORM, 'сдача'],
  [ROOM_MEMORY_BITS.COMBAT, 'бой'],
  [ROOM_MEMORY_BITS.REPAIR, 'ремонт'],
  [ROOM_MEMORY_BITS.SAMOSBOR, 'самосбор'],
];

export function roomMemoryLabels(bits: number): string[] {
  const out: string[] = [];
  for (const [bit, label] of BIT_LABELS) if ((bits & bit) !== 0) out.push(label);
  return out;
}

export function describeRoomMemory(record: RoomMemoryRecord): string {
  const labels = roomMemoryLabels(record.bits).join(', ') || 'след';
  return `room #${record.roomId}: ${labels}; sev${record.severity}; ttl ${Math.ceil(record.ttl)}s; event ${record.lastEventType}#${record.lastEventId}`;
}

export function summarizeRoomMemoryForRoom(floor: FloorLevel | undefined, roomId: number | undefined): string[] {
  const record = getRoomMemory(floor, roomId);
  if (!record) return ['Коммунальная память: нет'];
  return [
    `Коммунальная память: ${roomMemoryLabels(record.bits).join(', ') || 'след'} sev${record.severity}`,
    `Память: ttl ${Math.ceil(record.ttl)}s, событий ${record.count}, last ${record.lastEventType}#${record.lastEventId}`,
  ];
}
