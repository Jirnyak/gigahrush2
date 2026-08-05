/* ── Bounded short-lived noise records for AI / HUD ───────────── */

import {
  FloorLevel,
  RoomType,
  W,
  type Entity,
  type Faction,
  type GameState,
  type WorldEvent,
  type WorldEventSeverity,
  msg,
} from '../core/types';
import { World } from '../core/world';
import type { WeaponStats } from '../data/weapons';
import { ITEMS } from '../data/catalog';
import { registerInventoryUseHandler, removeItem, type InventoryUseHandlerContext } from './inventory';
import { publishEvent, registerWorldEventObserver } from './events';
import { isPlayerEntity } from './player_actor';

export type NoiseSource =
  | 'weapon_fire'
  | 'melee'
  | 'footstep'
  | 'door'
  | 'siren'
  | 'explosion'
  | 'hack_fail'
  | 'decoy';

export interface NoiseRecord {
  id: number;
  time: number;
  expiresAt: number;
  floor: FloorLevel;
  x: number;
  y: number;
  radius: number;
  radiusSq: number;
  ttl: number;
  source: NoiseSource;
  severity: WorldEventSeverity;
  actorId?: number;
  actorFaction?: Faction;
  itemId?: string;
  eventId?: number;
  suppressed?: boolean;
  tags: string[];
}

export interface NoiseDraft {
  x: number;
  y: number;
  floor?: FloorLevel;
  radius: number;
  ttl: number;
  source: NoiseSource;
  severity: number;
  actorId?: number;
  actorFaction?: Faction;
  itemId?: string;
  eventId?: number;
  suppressed?: boolean;
  tags?: readonly string[];
}

export interface NoiseQuery {
  floor?: FloorLevel;
  minSeverity?: number;
  source?: NoiseSource;
  limit?: number;
  sinceId?: number;
}

export interface NoiseHudCue {
  label: string;
  detail: string;
  color: string;
  intensity: number;
}

interface ActorNoiseMemory {
  nextScanAt: number;
  hotUntil: number;
  recordId: number;
}

interface NoiseProfile {
  radius: number;
  ttl: number;
  severity: number;
  source: NoiseSource;
  tags: readonly string[];
}

const NOISE_RECORD_CAP = 64;
const NOISE_TAG_CAP = 8;
const NOISE_RADIUS_CAP = 48;
const NOISE_SCAN_LIMIT = 28;
const JAMMER_DURATION = 18;
const JAMMER_RADIUS_MULT = 0.38;
const QUIET_DOOR_DURATION = 35;
const NOISE_CAN_ID = 'noise_can';
const RADIO_JAMMER_ID = 'radio_jammer';
const FELT_DOOR_PAD_ID = 'felt_door_pad';
const SMOKE_CANDLE_CHECK_ID = 'smoke_candle_check';
const noiseRecords: NoiseRecord[] = [];
let nextNoiseId = 1;
let lastNoiseTime = -Infinity;
let actorNoiseMemory = new WeakMap<Entity, ActorNoiseMemory>();
let actorJammerUntil = new WeakMap<Entity, number>();
let actorQuietDoorUntil = new WeakMap<Entity, number>();

const LOUD_MELEE: Record<string, NoiseProfile> = {
  chainsaw: { radius: 14, ttl: 3.2, severity: 3, source: 'melee', tags: ['weapon', 'melee', 'chainsaw'] },
  sledgehammer: { radius: 9, ttl: 2.4, severity: 2, source: 'melee', tags: ['weapon', 'melee', 'heavy'] },
  axe: { radius: 7, ttl: 2.1, severity: 2, source: 'melee', tags: ['weapon', 'melee', 'heavy'] },
  liquidator_axe: { radius: 8, ttl: 2.2, severity: 2, source: 'melee', tags: ['weapon', 'melee', 'heavy', 'liquidator'] },
  pipe: { radius: 7, ttl: 2.1, severity: 2, source: 'melee', tags: ['weapon', 'melee', 'metal'] },
  rebar: { radius: 7, ttl: 2.1, severity: 2, source: 'melee', tags: ['weapon', 'melee', 'metal'] },
  crowbar: { radius: 7, ttl: 2.1, severity: 2, source: 'melee', tags: ['weapon', 'melee', 'metal'] },
  metal_chair: { radius: 8, ttl: 2.2, severity: 2, source: 'melee', tags: ['weapon', 'melee', 'metal'] },
};

const RANGED_RADIUS_BY_WEAPON: Record<string, number> = {
  makarov: 14,
  tt_pistol: 15,
  nagant: 16,
  homemade_pistol: 13,
  ppsh: 20,
  ak47: 22,
  machinegun: 24,
  shotgun: 19,
  toz_shotgun: 20,
  nailgun: 11,
  harpoon_gun: 13,
  flamethrower: 9,
  grenade: 6,
  gauss: 18,
  plasma: 17,
  bfg: 30,
};

function clampSeverity(value: number): WorldEventSeverity {
  return Math.max(0, Math.min(5, Math.round(value))) as WorldEventSeverity;
}

function cleanTags(tags: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    if (out.length >= NOISE_TAG_CAP) break;
    const clean = String(tag).slice(0, 32);
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out;
}

function hashUnit(id: number, salt: number): number {
  const h = Math.imul(id ^ salt, 0x85ebca6b) >>> 0;
  return (h & 1023) / 1023;
}

function maybeResetForTime(time: number): void {
  if (time < lastNoiseTime - 30) resetNoiseRecords();
  lastNoiseTime = Math.max(lastNoiseTime, time);
}

function pruneNoiseRecords(now: number): void {
  for (let i = noiseRecords.length - 1; i >= 0; i--) {
    if (noiseRecords[i].expiresAt <= now) noiseRecords.splice(i, 1);
  }
}

function actorNoiseRadiusMult(actor: Entity | undefined, time: number): number {
  if (!actor) return 1;
  return (actorJammerUntil.get(actor) ?? -Infinity) > time ? JAMMER_RADIUS_MULT : 1;
}

function publishActorNoise(state: GameState, actor: Entity | undefined, draft: NoiseDraft, suppressible = true): NoiseRecord | undefined {
  const mult = suppressible ? actorNoiseRadiusMult(actor, state.time) : 1;
  return publishNoise(state, {
    ...draft,
    radius: draft.radius * mult,
    actorId: draft.actorId ?? actor?.id,
    actorFaction: draft.actorFaction ?? actor?.faction,
    suppressed: draft.suppressed ?? mult < 1,
  });
}

export function resetNoiseRecords(): void {
  noiseRecords.length = 0;
  nextNoiseId = 1;
  lastNoiseTime = -Infinity;
  actorNoiseMemory = new WeakMap<Entity, ActorNoiseMemory>();
  actorJammerUntil = new WeakMap<Entity, number>();
  actorQuietDoorUntil = new WeakMap<Entity, number>();
}

export function expireNoiseRecords(now: number): void {
  pruneNoiseRecords(now);
}

export function publishNoise(state: GameState, draft: NoiseDraft): NoiseRecord | undefined {
  const time = state.time;
  maybeResetForTime(time);
  pruneNoiseRecords(time);
  if (!Number.isFinite(draft.x) || !Number.isFinite(draft.y)) return undefined;
  if (!Number.isFinite(draft.radius) || draft.radius <= 0 || !Number.isFinite(draft.ttl) || draft.ttl <= 0) return undefined;

  const radius = Math.max(0.75, Math.min(NOISE_RADIUS_CAP, draft.radius));
  const record: NoiseRecord = {
    id: nextNoiseId++,
    time,
    expiresAt: time + draft.ttl,
    floor: draft.floor ?? state.currentFloor,
    x: draft.x,
    y: draft.y,
    radius,
    radiusSq: radius * radius,
    ttl: draft.ttl,
    source: draft.source,
    severity: clampSeverity(draft.severity),
    actorId: draft.actorId,
    actorFaction: draft.actorFaction,
    itemId: draft.itemId,
    eventId: draft.eventId,
    suppressed: draft.suppressed,
    tags: cleanTags([draft.source, ...(draft.tags ?? [])]),
  };
  noiseRecords.push(record);
  if (noiseRecords.length > NOISE_RECORD_CAP) noiseRecords.splice(0, noiseRecords.length - NOISE_RECORD_CAP);
  return record;
}

export function getRecentNoiseRecords(state: GameState, query: NoiseQuery = {}, now = state.time): NoiseRecord[] {
  maybeResetForTime(now);
  pruneNoiseRecords(now);
  const floor = query.floor ?? state.currentFloor;
  const minSeverity = query.minSeverity ?? 0;
  const limit = query.limit ?? noiseRecords.length;
  const out: NoiseRecord[] = [];
  for (let i = noiseRecords.length - 1; i >= 0; i--) {
    const record = noiseRecords[i];
    if (record.floor !== floor) continue;
    if (record.severity < minSeverity) continue;
    if (query.source !== undefined && record.source !== query.source) continue;
    if (query.sinceId !== undefined && record.id <= query.sinceId) continue;
    out.push(record);
    if (out.length >= limit) break;
  }
  return out;
}

function weaponNoiseProfile(weaponId: string, ws: WeaponStats): NoiseProfile | undefined {
  if (!ws.isRanged) return LOUD_MELEE[weaponId];
  if (ws.psiCost) {
    const siren = weaponId === 'psi_siren_pulse';
    return {
      radius: siren ? 17 : ws.aoeRadius ? 11 : 7,
      ttl: siren ? 3.4 : 2.4,
      severity: siren ? 3 : 2,
      source: 'weapon_fire',
      tags: ['weapon', 'psi', weaponId],
    };
  }

  const mapped = RANGED_RADIUS_BY_WEAPON[weaponId];
  const pellets = ws.pellets ?? 1;
  const fallback = Math.min(24, 9 + ws.dmg / 7 + Math.min(8, pellets));
  const radius = mapped ?? fallback;
  const severity = weaponId === 'bfg' ? 5 : radius >= 21 || ws.aoeRadius ? 4 : radius >= 13 ? 3 : 2;
  return {
    radius,
    ttl: weaponId === 'bfg' ? 4.2 : ws.aoeRadius ? 3.2 : 2.8,
    severity,
    source: 'weapon_fire',
    tags: ['weapon', ws.aoeRadius ? 'aoe' : 'shot', weaponId],
  };
}

export function publishWeaponNoise(
  state: GameState | undefined,
  actor: Entity,
  weaponId: string,
  ws: WeaponStats,
  x = actor.x,
  y = actor.y,
): NoiseRecord | undefined {
  if (!state) return undefined;
  const profile = weaponNoiseProfile(weaponId, ws);
  if (!profile) return undefined;
  return publishActorNoise(state, actor, {
    x,
    y,
    radius: profile.radius,
    ttl: profile.ttl,
    source: profile.source,
    severity: profile.severity,
    itemId: weaponId,
    tags: profile.tags,
  });
}

export function publishFootstepNoise(state: GameState, actor: Entity, rushed: boolean): NoiseRecord | undefined {
  return publishActorNoise(state, actor, {
    x: actor.x,
    y: actor.y,
    radius: rushed ? 5 : 3,
    ttl: rushed ? 1.4 : 1.0,
    source: 'footstep',
    severity: rushed ? 2 : 1,
    tags: ['movement', rushed ? 'rushed' : 'step'],
  });
}

export function publishDoorNoise(
  state: GameState,
  actor: Entity,
  doorIdx: number,
  hermetic: boolean,
  quiet: boolean,
): NoiseRecord | undefined {
  const x = doorIdx % W + 0.5;
  const y = ((doorIdx / W) | 0) + 0.5;
  return publishActorNoise(state, actor, {
    x,
    y,
    radius: quiet ? 2.5 : hermetic ? 12 : 7,
    ttl: quiet ? 1.2 : hermetic ? 3.2 : 2.2,
    source: 'door',
    severity: quiet ? 1 : hermetic ? 3 : 2,
    tags: ['door', hermetic ? 'hermetic' : 'normal', quiet ? 'quiet' : 'loud'],
  }, !quiet);
}

export function publishExplosionNoise(
  state: GameState,
  actor: Entity | undefined,
  x: number,
  y: number,
  blastRadius: number,
  itemId: string,
): NoiseRecord | undefined {
  const bfg = itemId === 'bfg';
  return publishActorNoise(state, actor, {
    x,
    y,
    radius: Math.max(18, blastRadius * (bfg ? 5.5 : 4.5)),
    ttl: bfg ? 5.0 : 4.0,
    source: 'explosion',
    severity: bfg ? 5 : 4,
    itemId,
    tags: ['explosion', itemId],
  }, false);
}

export function isNoiseJammerActive(actor: Entity, time: number): boolean {
  return (actorJammerUntil.get(actor) ?? -Infinity) > time;
}

export function prepareQuietDoorCharge(actor: Entity, time: number): void {
  actorQuietDoorUntil.set(actor, time + QUIET_DOOR_DURATION);
}

export function consumeQuietDoorCharge(actor: Entity, time: number): boolean {
  const until = actorQuietDoorUntil.get(actor) ?? -Infinity;
  if (until <= time) return false;
  actorQuietDoorUntil.delete(actor);
  return true;
}

function activeMemoryRecord(memory: ActorNoiseMemory, state: GameState, time: number): NoiseRecord | undefined {
  if (memory.hotUntil <= time) return undefined;
  pruneNoiseRecords(time);
  const record = noiseRecords.find(r => r.id === memory.recordId);
  if (!record || record.expiresAt <= time || record.floor !== state.currentFloor) return undefined;
  return record;
}

export function findNoiseForActor(
  world: World,
  state: GameState | undefined,
  actor: Entity,
  time: number,
  options: { minSeverity?: number; scanInterval?: number; hearingMult?: number } = {},
): NoiseRecord | undefined {
  if (!state) return undefined;
  const memory = actorNoiseMemory.get(actor);
  if (memory) {
    const active = activeMemoryRecord(memory, state, time);
    if (active) return active;
    if (time < memory.nextScanAt) return undefined;
  }

  const scanInterval = options.scanInterval ?? 0.8;
  const nextScanAt = time + scanInterval + hashUnit(actor.id, 0x4e17) * 0.45;
  const minSeverity = options.minSeverity ?? 2;
  const hearingMult = options.hearingMult ?? 1;
  let best: NoiseRecord | undefined;
  let bestScore = -Infinity;
  let checked = 0;

  pruneNoiseRecords(time);
  for (let i = noiseRecords.length - 1; i >= 0 && checked < NOISE_SCAN_LIMIT; i--) {
    const record = noiseRecords[i];
    checked++;
    if (record.floor !== state.currentFloor) continue;
    if (record.severity < minSeverity) continue;
    if (record.actorId === actor.id) continue;
    const effectiveRadius = record.radius * hearingMult;
    const d2 = world.dist2(actor.x, actor.y, record.x, record.y);
    if (d2 > effectiveRadius * effectiveRadius) continue;
    const age = Math.max(0, time - record.time);
    const nearness = 1 - d2 / Math.max(1, effectiveRadius * effectiveRadius);
    const score = record.severity * 10 + nearness * 8 - age * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = record;
    }
  }

  actorNoiseMemory.set(actor, {
    nextScanAt,
    hotUntil: best ? time + Math.min(4.5, 0.8 + best.severity * 0.55) : time,
    recordId: best?.id ?? 0,
  });
  return best;
}

export function isActorNoiseHot(world: World, state: GameState | undefined, actor: Entity, time: number): boolean {
  return findNoiseForActor(world, state, actor, time, { minSeverity: 2, scanInterval: 0.75 }) !== undefined;
}

export function findNoiseInvestigationTarget(
  world: World,
  state: GameState | undefined,
  actor: Entity,
  time: number,
): NoiseRecord | undefined {
  return findNoiseForActor(world, state, actor, time, { minSeverity: 2, scanInterval: 1.0, hearingMult: 1.12 });
}

function sourceDetail(record: NoiseRecord): string {
  switch (record.source) {
    case 'weapon_fire': return record.itemId ? (ITEMS[record.itemId]?.name ?? record.itemId) : 'выстрел';
    case 'melee': return 'металл';
    case 'footstep': return 'шаги';
    case 'door': return record.tags.includes('quiet') ? 'дверь тихо' : 'дверь';
    case 'siren': return 'сирена';
    case 'explosion': return 'взрыв';
    case 'hack_fail': return 'пост';
    case 'decoy': return 'отвлечение';
  }
}

export function getNoiseHudCue(world: World, state: GameState, player: Entity, time: number): NoiseHudCue | null {
  pruneNoiseRecords(time);
  let best: NoiseRecord | undefined;
  let bestScore = -Infinity;
  for (let i = noiseRecords.length - 1; i >= 0; i--) {
    const record = noiseRecords[i];
    if (record.floor !== state.currentFloor || record.severity < 2) continue;
    const own = record.actorId === player.id;
    const d2 = world.dist2(player.x, player.y, record.x, record.y);
    if (!own && d2 > record.radiusSq) continue;
    const age = Math.max(0, time - record.time);
    if (age > 2.2 && !own) continue;
    const score = record.severity * 12 + (own ? 8 : 0) - age * 3;
    if (score > bestScore) {
      bestScore = score;
      best = record;
    }
  }
  if (!best) return null;
  const age = Math.max(0, time - best.time);
  const intensity = Math.max(0, Math.min(1, (best.expiresAt - time) / Math.max(0.5, best.ttl)));
  if (intensity <= 0) return null;
  const label = best.suppressed ? 'ГЛУШИТСЯ' : best.severity >= 4 ? 'СЛЫШАТ' : 'СЛЫШНО';
  const detail = `${sourceDetail(best)} ${Math.max(1, Math.round(best.radius))}м`;
  const color = best.suppressed ? '#8cf' : best.severity >= 4 ? '#fa4' : '#fc8';
  return { label, detail: age < 0.25 ? detail : detail.toLowerCase(), color, intensity };
}

function publishNoiseItemEvent(
  state: GameState | undefined,
  actor: Entity,
  itemId: string,
  action: string,
  severity: WorldEventSeverity,
  zoneId: number | undefined,
  world: World | undefined,
): void {
  if (!state || !isPlayerEntity(actor)) return;
  const def = ITEMS[itemId];
  publishEvent(state, {
    type: 'player_use_item',
    zoneId: zoneId ?? (world ? world.zoneMap[world.idx(Math.floor(actor.x), Math.floor(actor.y))] : undefined),
    roomId: world?.roomAt(actor.x, actor.y)?.id,
    x: actor.x,
    y: actor.y,
    actorId: actor.id,
    actorName: actor.name ?? 'Вы',
    actorFaction: actor.faction,
    itemId,
    itemName: def?.name ?? itemId,
    itemCount: 1,
    itemValue: def?.value ?? 0,
    severity,
    privacy: 'private',
    tags: ['player', 'inventory', 'noise_item', action, 'counterplay'],
  });
}

function smokeCandleDraftResult(
  state: GameState | undefined,
  world: World | undefined,
  actor: Entity,
): { result: string; text: string; severity: WorldEventSeverity } {
  const room = world?.roomAt(actor.x, actor.y);
  const maintenance = state?.currentFloor === FloorLevel.MAINTENANCE;
  if (maintenance && (room?.type === RoomType.CORRIDOR || room?.type === RoomType.PRODUCTION)) {
    return {
      result: 'pulling_draft',
      text: 'Дым лег ниткой вдоль труб. Тяга есть: вентканал живой, но источник не вскрыт.',
      severity: 3,
    };
  }
  if (maintenance && room?.type === RoomType.STORAGE) {
    return {
      result: 'weak_draft',
      text: 'Дым держится у стеллажей и медленно ползет к щели. Тяга слабая, дальше нужен осмотр.',
      severity: 2,
    };
  }
  return {
    result: 'stale_air',
    text: 'Дым повис низко и быстро осел. Проверка ничего не запускает: это только местная тяга.',
    severity: 1,
  };
}

function publishSmokeCandleCheckEvent(
  ctx: InventoryUseHandlerContext,
  result: string,
  severity: WorldEventSeverity,
  noiseRecordId: number | undefined,
): void {
  const { state, actor, world } = ctx;
  if (!state || !isPlayerEntity(actor)) return;
  const def = ITEMS[SMOKE_CANDLE_CHECK_ID];
  const x = actor.x;
  const y = actor.y;
  const ci = world?.idx(Math.floor(x), Math.floor(y));
  const room = world?.roomAt(x, y);
  publishEvent(state, {
    type: 'player_use_item',
    floor: state.currentFloor,
    zoneId: ctx.zoneId ?? (ci !== undefined ? world?.zoneMap[ci] : undefined),
    roomId: room?.id,
    x,
    y,
    actorId: actor.id,
    actorName: actor.name ?? 'Вы',
    actorFaction: actor.faction,
    itemId: SMOKE_CANDLE_CHECK_ID,
    itemName: def?.name ?? SMOKE_CANDLE_CHECK_ID,
    itemCount: 1,
    itemValue: def?.value ?? 0,
    severity,
    privacy: 'private',
    tags: [
      'player',
      'inventory',
      'smoke',
      'vent_check',
      state.currentFloor === FloorLevel.MAINTENANCE ? 'maintenance' : 'off_floor',
      'counterplay',
    ],
    data: {
      result,
      roomType: room?.type,
      noiseRecordId,
      noGasSimulation: true,
    },
  });
}

function handleNoiseInventoryUse(ctx: InventoryUseHandlerContext): boolean {
  if (ctx.def.id === SMOKE_CANDLE_CHECK_ID) {
    removeItem(ctx.actor, SMOKE_CANDLE_CHECK_ID, 1);
    const draft = smokeCandleDraftResult(ctx.state, ctx.world, ctx.actor);
    const noise = ctx.state ? publishActorNoise(ctx.state, ctx.actor, {
      x: ctx.actor.x,
      y: ctx.actor.y,
      radius: 5,
      ttl: 3.5,
      source: 'decoy',
      severity: 1,
      itemId: SMOKE_CANDLE_CHECK_ID,
      tags: ['smoke', 'vent_check', 'inspection'],
    }, false) : undefined;
    ctx.msgs.push(msg(draft.text, ctx.time, draft.severity >= 3 ? '#cfd' : '#d8d4bf'));
    publishSmokeCandleCheckEvent(ctx, draft.result, draft.severity, noise?.id);
    return true;
  }

  if (ctx.def.id === NOISE_CAN_ID) {
    removeItem(ctx.actor, NOISE_CAN_ID, 1);
    if (ctx.state) {
      publishActorNoise(ctx.state, ctx.actor, {
        x: ctx.actor.x,
        y: ctx.actor.y,
        radius: 16,
        ttl: 7.5,
        source: 'decoy',
        severity: 3,
        itemId: NOISE_CAN_ID,
        tags: ['decoy', 'can', 'counterplay'],
      }, false);
    }
    ctx.msgs.push(msg('Шумовая банка покатилась и зазвенела по бетону.', ctx.time, '#fc8'));
    publishNoiseItemEvent(ctx.state, ctx.actor, NOISE_CAN_ID, 'noise_decoy', 3, ctx.zoneId, ctx.world);
    return true;
  }

  if (ctx.def.id === RADIO_JAMMER_ID) {
    removeItem(ctx.actor, RADIO_JAMMER_ID, 1);
    actorJammerUntil.set(ctx.actor, ctx.time + JAMMER_DURATION);
    ctx.msgs.push(msg('Глушилка режет короткий шум. Дальние уши потеряют часть сигнала.', ctx.time, '#8cf'));
    publishNoiseItemEvent(ctx.state, ctx.actor, RADIO_JAMMER_ID, 'noise_jammer', 3, ctx.zoneId, ctx.world);
    return true;
  }

  if (ctx.def.id === FELT_DOOR_PAD_ID) {
    removeItem(ctx.actor, FELT_DOOR_PAD_ID, 1);
    prepareQuietDoorCharge(ctx.actor, ctx.time);
    ctx.msgs.push(msg('Войлочная накладка готова. Следующая дверь щёлкнет тише.', ctx.time, '#8cf'));
    publishNoiseItemEvent(ctx.state, ctx.actor, FELT_DOOR_PAD_ID, 'quiet_door_prepared', 2, ctx.zoneId, ctx.world);
    return true;
  }

  return false;
}

function handleNoiseSourceEvent(state: GameState, event: WorldEvent): void {
  const eventType = String(event.type);
  if (eventType === 'samosbor_warning' || eventType === 'samosbor_started') {
    publishNoise(state, {
      x: event.x ?? 0,
      y: event.y ?? 0,
      floor: event.floor,
      radius: eventType === 'samosbor_started' ? 42 : 30,
      ttl: eventType === 'samosbor_started' ? 6 : 5,
      source: 'siren',
      severity: eventType === 'samosbor_started' ? 5 : 4,
      eventId: event.id,
      tags: ['samosbor', 'siren'],
    });
    return;
  }

  if (eventType === 'door_opened' || eventType === 'door_sealed') {
    publishNoise(state, {
      x: event.x ?? 0,
      y: event.y ?? 0,
      floor: event.floor,
      radius: event.severity >= 4 || event.tags.includes('hermetic') ? 13 : 8,
      ttl: 3,
      source: 'door',
      severity: event.severity >= 4 ? 3 : 2,
      actorId: event.actorId,
      actorFaction: event.actorFaction,
      eventId: event.id,
      tags: ['door', ...event.tags],
    });
    return;
  }

  if (eventType === 'paritel_valve_changed' || event.tags.includes('valve')) {
    publishNoise(state, {
      x: event.x ?? 0,
      y: event.y ?? 0,
      floor: event.floor,
      radius: 14,
      ttl: 4.5,
      source: 'decoy',
      severity: 3,
      actorId: event.actorId,
      actorFaction: event.actorFaction,
      eventId: event.id,
      tags: ['valve', 'pipe', 'metal', 'counterplay'],
    });
    return;
  }

  if (eventType === 'document_gate_access_failure' || event.tags.includes('access_denied')) {
    publishNoise(state, {
      x: event.x ?? 0,
      y: event.y ?? 0,
      floor: event.floor,
      radius: 14,
      ttl: 4,
      source: 'hack_fail',
      severity: 3,
      actorId: event.actorId,
      actorFaction: event.actorFaction,
      itemId: event.itemId,
      eventId: event.id,
      tags: ['access', 'failure', 'safeguard'],
    });
  }
}

registerInventoryUseHandler(handleNoiseInventoryUse);
registerWorldEventObserver(handleNoiseSourceEvent);
