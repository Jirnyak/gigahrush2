import {
  AIGoal,
  Cell,
  EntityType,
  Feature,
  Faction,
  FloorLevel,
  RoomType,
  msg,
  type Entity,
  type GameState,
  type WorldEvent,
} from '../core/types';
import type { World } from '../core/world';
import { CARAVAN_LANE_BY_ID, CARAVAN_LANES, SMALL_CARAVAN_TEMPLATES, type CaravanLaneDef, type SmallCaravanTemplateDef } from '../data/caravans';
import type { EconomyFloorRef } from '../data/economy_rules';
import { addFactionRelMutual } from '../data/relations';
import {
  assignPersistentAlifeNpcFromEntity,
  captureAlifeFloorState,
  currentAlifeFloorKey,
  moveAlifeNpcRecord,
  recordAlifeNpcDeath,
  sampleAlifeFloorRecordIds,
} from './alife';
import { changeResourceStock, invalidateEconomyPrices, registerEconomyTariffProvider } from './economy';
import { publishEvent, registerWorldEventObserver } from './events';
import { cleanFloorKey, floorKeyForStory } from './floor_keys';

export const CARAVAN_TICK_SECONDS = 30;
export const MAX_CARAVAN_LANES_PER_TICK = 2;

const TARIFF_DURATION_SECONDS = 12 * 60;
const MIN_STABILITY = 0.25;
const MAX_STABILITY = 1.25;
const SMALL_CARAVAN_SPAWN_SECONDS = 4 * 60;
const SMALL_CARAVAN_ACTIVE_SECONDS = 9 * 60;
const SMALL_CARAVAN_TERMINAL_SECONDS = 90;
const MAX_ACTIVE_SMALL_CARAVANS = 3;
const SMALL_CARAVAN_SPAWN_RADIUS = 72;
const SMALL_CARAVAN_MEMBER_ALIFE_CAP = 8;

export type SmallCaravanStatus =
  | 'waiting'
  | 'moving'
  | 'escorted'
  | 'arrived'
  | 'raided'
  | 'reported'
  | 'rerouted'
  | 'seat_sold'
  | 'abandoned';

export interface CaravanLaneState {
  id: string;
  open: boolean;
  stability: number;
  tariffPressure: number;
  tariffPaidUntil: number;
  lastTickAt: number;
  nextTickAt: number;
  runs: number;
  raids: number;
}

export interface SmallCaravanRunState {
  id: string;
  templateId: string;
  laneId: string;
  floor: FloorLevel;
  x: number;
  y: number;
  status: SmallCaravanStatus;
  spawnedAt: number;
  updatedAt: number;
  expiresAt: number;
  progress: number;
  risk: number;
  memberIds: number[];
  memberAlifeIds?: number[];
  fromFloorKey?: string;
  toFloorKey?: string;
}

export interface CaravanState {
  tickAccum: number;
  cursor: number;
  nextRunSeq: number;
  nextSmallSpawnAt: number;
  lanes: Record<string, CaravanLaneState>;
  active: Record<string, SmallCaravanRunState>;
}

type CaravanGameState = GameState & { caravans?: CaravanState };
const normalizedStates = new WeakMap<GameState, CaravanState>();

const CARAVAN_CONTRACT_OUTCOMES: Record<string, { action: 'escort' | 'raid' | 'reroute' | 'report' | 'seat'; laneId: string }> = {
  caravan_escort_queue_porters: { action: 'escort', laneId: 'kvartiry_living_food_water' },
  caravan_raid_queue_cargo: { action: 'raid', laneId: 'kvartiry_living_food_water' },
  caravan_buy_queue_seat: { action: 'seat', laneId: 'kvartiry_living_food_water' },
  caravan_escort_repair_crew: { action: 'escort', laneId: 'maintenance_living_tools' },
  caravan_reroute_repair_crew: { action: 'reroute', laneId: 'maintenance_living_tools' },
  caravan_raid_market88_smugglers: { action: 'raid', laneId: 'production_black_market_88' },
  caravan_report_market88_smugglers: { action: 'report', laneId: 'production_black_market_88' },
  caravan_escort_ministry_forms: { action: 'escort', laneId: 'ministry_market_docs' },
  caravan_reroute_ministry_forms: { action: 'reroute', laneId: 'ministry_market_docs' },
  caravan_escort_net_signalers: { action: 'escort', laneId: 'net_exchange_data' },
  caravan_reroute_net_signalers: { action: 'reroute', laneId: 'net_exchange_data' },
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function laneInterval(def: CaravanLaneDef): number {
  let hash = 0;
  for (let i = 0; i < def.id.length; i++) hash = (hash * 33 + def.id.charCodeAt(i)) | 0;
  return 65 + (Math.abs(hash) % 45);
}

function initialLaneState(def: CaravanLaneDef, now: number): CaravanLaneState {
  return {
    id: def.id,
    open: def.startsOpen !== false,
    stability: def.startsOpen === false ? 0.55 : 0.85,
    tariffPressure: def.startsOpen === false ? 0.18 : 0.08,
    tariffPaidUntil: 0,
    lastTickAt: 0,
    nextTickAt: now + laneInterval(def),
    runs: 0,
    raids: 0,
  };
}

function saneNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeLaneState(def: CaravanLaneDef, raw: Partial<CaravanLaneState> | undefined, now: number): CaravanLaneState {
  const base = initialLaneState(def, now);
  if (!raw) return base;
  return {
    id: def.id,
    open: typeof raw.open === 'boolean' ? raw.open : base.open,
    stability: clamp(saneNumber(raw.stability, base.stability), MIN_STABILITY, MAX_STABILITY),
    tariffPressure: clamp(saneNumber(raw.tariffPressure, base.tariffPressure), 0, 1.75),
    tariffPaidUntil: saneNumber(raw.tariffPaidUntil, base.tariffPaidUntil),
    lastTickAt: saneNumber(raw.lastTickAt, base.lastTickAt),
    nextTickAt: saneNumber(raw.nextTickAt, base.nextTickAt),
    runs: Math.max(0, Math.floor(saneNumber(raw.runs, base.runs))),
    raids: Math.max(0, Math.floor(saneNumber(raw.raids, base.raids))),
  };
}

function normalizeSmallCaravanStatus(value: unknown): SmallCaravanStatus {
  switch (value) {
    case 'waiting':
    case 'moving':
    case 'escorted':
    case 'arrived':
    case 'raided':
    case 'reported':
    case 'rerouted':
    case 'seat_sold':
    case 'abandoned':
      return value;
    default:
      return 'moving';
  }
}

function normalizeMemberIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const raw of value.slice(0, 5)) {
    const id = Math.floor(Number(raw));
    if (Number.isFinite(id) && id > 0 && !out.includes(id)) out.push(id);
  }
  return out;
}

function normalizeMemberAlifeIds(value: unknown, limit: number): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  const cap = Math.max(0, Math.min(SMALL_CARAVAN_MEMBER_ALIFE_CAP, Math.floor(limit)));
  for (const raw of value) {
    if (out.length >= cap) break;
    const id = Math.floor(Number(raw));
    if (Number.isFinite(id) && id > 0 && !out.includes(id)) out.push(id);
  }
  return out;
}

function lanePrimaryFromFloorKey(def: CaravanLaneDef): string {
  return cleanFloorKey(def.fromFloorKeys?.[0] ?? floorKeyForStory(def.fromFloor));
}

function lanePrimaryToFloorKey(def: CaravanLaneDef): string {
  return cleanFloorKey(def.toFloorKeys?.[0] ?? floorKeyForStory(def.toFloor));
}

function normalizeSmallCaravanRun(raw: unknown, now: number): SmallCaravanRunState | undefined {
  if (!isRecord(raw)) return undefined;
  const templateId = typeof raw.templateId === 'string' ? raw.templateId : '';
  const template = SMALL_CARAVAN_TEMPLATES.find(item => item.id === templateId);
  const laneId = typeof raw.laneId === 'string' ? raw.laneId : template?.laneId ?? '';
  const def = CARAVAN_LANE_BY_ID[laneId];
  if (!template || !def) return undefined;
  const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id.slice(0, 48) : `${template.id}_${Math.floor(now)}`;
  const floor = typeof raw.floor === 'number' ? raw.floor as FloorLevel : def.toFloor;
  if (!Object.values(FloorLevel).includes(floor)) return undefined;
  const status = normalizeSmallCaravanStatus(raw.status);
  const expiresAt = saneNumber(raw.expiresAt, now + SMALL_CARAVAN_ACTIVE_SECONDS);
  const fromFloorKey = cleanFloorKey(raw.fromFloorKey) || lanePrimaryFromFloorKey(def);
  const toFloorKey = cleanFloorKey(raw.toFloorKey) || lanePrimaryToFloorKey(def);
  return {
    id,
    templateId,
    laneId,
    floor,
    x: clamp(saneNumber(raw.x, 0), 0, 1024),
    y: clamp(saneNumber(raw.y, 0), 0, 1024),
    status,
    spawnedAt: saneNumber(raw.spawnedAt, now),
    updatedAt: saneNumber(raw.updatedAt, now),
    expiresAt,
    progress: clamp(saneNumber(raw.progress, 0), 0, 1),
    risk: clamp(saneNumber(raw.risk, template.risk), 1, 5),
    memberIds: normalizeMemberIds(raw.memberIds),
    memberAlifeIds: normalizeMemberAlifeIds(raw.memberAlifeIds, template.memberCount),
    fromFloorKey,
    toFloorKey,
  };
}

function normalizeActiveSmallCaravans(raw: unknown, now: number): Record<string, SmallCaravanRunState> {
  const out: Record<string, SmallCaravanRunState> = {};
  if (!isRecord(raw)) return out;
  for (const value of Object.values(raw)) {
    const run = normalizeSmallCaravanRun(value, now);
    if (!run || run.expiresAt <= now) continue;
    out[run.id] = run;
  }
  return out;
}

export function ensureCaravanState(state: GameState): CaravanState {
  const s = state as CaravanGameState;
  const raw = s.caravans;
  if (raw && normalizedStates.get(state) === raw) return raw;
  const next: CaravanState = {
    tickAccum: clamp(saneNumber(raw?.tickAccum, 0), 0, CARAVAN_TICK_SECONDS),
    cursor: Math.max(0, Math.floor(saneNumber(raw?.cursor, 0))),
    nextRunSeq: Math.max(1, Math.floor(saneNumber(raw?.nextRunSeq, 1))),
    nextSmallSpawnAt: saneNumber(raw?.nextSmallSpawnAt, state.time + 20),
    lanes: {},
    active: normalizeActiveSmallCaravans(raw?.active, state.time),
  };
  for (const def of CARAVAN_LANES) {
    next.lanes[def.id] = normalizeLaneState(def, raw?.lanes?.[def.id], state.time);
  }
  s.caravans = next;
  normalizedStates.set(state, next);
  return next;
}

function uniqueResourceIds(def: CaravanLaneDef): string[] {
  const ids: string[] = [];
  for (const id of def.tariffResourceIds) {
    if (!ids.includes(id)) ids.push(id);
  }
  for (const delta of def.resourceDeltas) {
    if (!ids.includes(delta.resourceId)) ids.push(delta.resourceId);
  }
  return ids;
}

function caravanTags(def: CaravanLaneDef, extra: readonly string[] = []): string[] {
  const tags: string[] = ['caravan', 'tariff', 'supply_lane', def.id];
  for (const resourceId of uniqueResourceIds(def)) if (!tags.includes(resourceId)) tags.push(resourceId);
  for (const corpId of def.corpIds ?? []) {
    const tag = `corp_${corpId}`;
    if (!tags.includes(tag)) tags.push(tag);
  }
  for (const tag of extra) if (tag && !tags.includes(tag)) tags.push(tag);
  return tags;
}

function deltaCountsFor(def: CaravanLaneDef, multiplier: number): number[] {
  return def.resourceDeltas.map(delta => Math.max(1, Math.round(delta.count * multiplier)));
}

function rumorIdsFor(def: CaravanLaneDef): string[] {
  const resources = uniqueResourceIds(def);
  if (resources.includes('drink_water')) return ['economy_water_price'];
  if (resources.includes('food')) return ['economy_kitchen_stock'];
  return ['economy_factory_tick'];
}

function templateForLane(laneId: string): SmallCaravanTemplateDef | undefined {
  return SMALL_CARAVAN_TEMPLATES.find(template => template.laneId === laneId);
}

function activeStatus(status: SmallCaravanStatus): boolean {
  return status === 'waiting' || status === 'moving' || status === 'escorted';
}

function terminalStatus(status: SmallCaravanStatus): boolean {
  return !activeStatus(status);
}

function floorMatchesLane(floor: FloorLevel, def: CaravanLaneDef): boolean {
  return floor === def.fromFloor || floor === def.toFloor;
}

function addPlayerRelation(faction: Faction, delta: number): void {
  if (delta !== 0 && faction !== Faction.PLAYER) addFactionRelMutual(Faction.PLAYER, faction, delta);
}

function markActiveRunOutcome(state: GameState, laneId: string, status: SmallCaravanStatus): void {
  const caravans = ensureCaravanState(state);
  let selected: SmallCaravanRunState | undefined;
  for (const id in caravans.active) {
    const run = caravans.active[id];
    if (run.laneId !== laneId || run.expiresAt <= state.time) continue;
    if (!selected || (activeStatus(run.status) && !activeStatus(selected.status))) selected = run;
  }
  if (!selected) return;
  selected.status = status;
  selected.updatedAt = state.time;
  if (terminalStatus(status)) selected.expiresAt = state.time + SMALL_CARAVAN_TERMINAL_SECONDS;
}

function applyLaneCargo(
  state: GameState,
  def: CaravanLaneDef,
  cargo: readonly { resourceId: string; count: number }[],
  multiplier: number,
  reason: string,
): number[] {
  const counts = cargo.map(delta => Math.max(1, Math.round(delta.count * multiplier)));
  for (let i = 0; i < cargo.length; i++) {
    const delta = cargo[i];
    const count = counts[i];
    changeResourceStock(state, delta.resourceId, -count, def.fromFloor, { reason, tags: ['caravan', def.id] });
    changeResourceStock(state, delta.resourceId, count, def.toFloor, { reason, tags: ['caravan', def.id] });
  }
  return counts;
}

function publishSmallCaravanEvent(
  state: GameState,
  def: CaravanLaneDef,
  lane: CaravanLaneState,
  run: SmallCaravanRunState | undefined,
  action: string,
  severity: 3 | 4 | 5,
  extraTags: readonly string[],
  counts?: readonly number[],
  source?: WorldEvent,
  extraData?: Record<string, unknown>,
): void {
  publishEvent(state, {
    type: 'faction_relation_changed',
    floor: run?.floor ?? def.toFloor,
    zoneId: source?.zoneId,
    roomId: source?.roomId,
    x: run?.x ?? source?.x,
    y: run?.y ?? source?.y,
    actorId: source?.actorId,
    actorName: source?.actorName ?? 'Малый караван',
    actorFaction: source?.actorFaction ?? def.faction,
    targetName: run ? `${templateForLane(def.id)?.name ?? def.name}` : def.name,
    targetFaction: def.faction,
    severity,
    privacy: severity >= 4 ? 'public' : 'local',
    tags: caravanTags(def, ['small_caravan', action, ...extraTags]),
    data: {
      factionEventId: 'small_caravan',
      name: run ? templateForLane(def.id)?.name ?? def.name : def.name,
      laneId: def.id,
      runId: run?.id,
      templateId: run?.templateId,
      caravanAction: action,
      fromFloor: FloorLevel[def.fromFloor],
      toFloor: FloorLevel[def.toFloor],
      resourceIds: def.resourceDeltas.map(delta => delta.resourceId),
      deltaCounts: counts,
      tariffMultiplier: getCaravanLaneTariffMultiplier(state, def.id),
      stability: Number(lane.stability.toFixed(2)),
      rumorIds: rumorIdsFor(def),
      ...extraData,
    },
  });
}

function publishCaravanEvent(
  state: GameState,
  def: CaravanLaneDef,
  lane: CaravanLaneState,
  action: string,
  severity: 3 | 4 | 5,
  extraTags: readonly string[],
  counts?: readonly number[],
  source?: WorldEvent,
  extraData?: Record<string, unknown>,
): void {
  publishEvent(state, {
    type: 'faction_relation_changed',
    floor: def.toFloor,
    zoneId: source?.zoneId,
    roomId: source?.roomId,
    x: source?.x,
    y: source?.y,
    actorId: source?.actorId,
    actorName: source?.actorName ?? (action === 'tick' ? 'Караван' : undefined),
    actorFaction: source?.actorFaction ?? def.faction,
    targetName: def.name,
    targetFaction: def.faction,
    severity,
    privacy: severity >= 4 ? 'public' : 'local',
    tags: caravanTags(def, ['faction_event', action, ...extraTags]),
    data: {
      factionEventId: 'caravan_supply_lane',
      name: def.name,
      laneId: def.id,
      caravanAction: action,
      fromFloor: FloorLevel[def.fromFloor],
      toFloor: FloorLevel[def.toFloor],
      resourceIds: def.resourceDeltas.map(delta => delta.resourceId),
      deltaCounts: counts,
      tariffMultiplier: getCaravanLaneTariffMultiplier(state, def.id),
      stability: Number(lane.stability.toFixed(2)),
      corpId: def.corpIds?.[0],
      rumorIds: rumorIdsFor(def),
      ...extraData,
    },
  });
}

function migrateLaneAlifeRecords(state: GameState, def: CaravanLaneDef, lane: CaravanLaneState, paid: boolean): number {
  const fromFloorKey = lanePrimaryFromFloorKey(def);
  const toFloorKey = lanePrimaryToFloorKey(def);
  if (!fromFloorKey || !toFloorKey || fromFloorKey === toFloorKey) return 0;
  if (lane.stability < 0.65 || lane.runs % (paid ? 2 : 4) !== 0) return 0;
  const limit = paid && lane.stability >= 0.95 ? 2 : 1;
  const ids = sampleAlifeFloorRecordIds(state, fromFloorKey, limit, lane.runs + def.id.length, {
    faction: def.faction,
    maxAttempts: 96,
  });
  let moved = 0;
  for (const id of ids) {
    if (moveAlifeNpcRecord(state, id, toFloorKey, { floor: def.toFloor, preservePosition: false })) moved++;
  }
  return moved;
}

function processLane(state: GameState, def: CaravanLaneDef, lane: CaravanLaneState, force: boolean): boolean {
  if (!lane.open) return false;
  if (!force && state.time < lane.nextTickAt) return false;

  const paid = lane.tariffPaidUntil > state.time;
  const throughput = paid ? Math.min(MAX_STABILITY, lane.stability + 0.12) : Math.max(0.45, lane.stability);
  const counts = deltaCountsFor(def, throughput);
  for (let i = 0; i < def.resourceDeltas.length; i++) {
    const delta = def.resourceDeltas[i];
    const count = counts[i];
    changeResourceStock(state, delta.resourceId, -count, def.fromFloor);
    changeResourceStock(state, delta.resourceId, count, def.toFloor);
  }

  lane.runs++;
  lane.lastTickAt = state.time;
  lane.nextTickAt = state.time + laneInterval(def);
  if (paid) {
    lane.stability = clamp(lane.stability + 0.03, MIN_STABILITY, MAX_STABILITY);
    lane.tariffPressure = clamp(lane.tariffPressure - 0.05, 0, 1.75);
  } else {
    lane.stability = clamp(lane.stability - 0.01, MIN_STABILITY, MAX_STABILITY);
    lane.tariffPressure = clamp(lane.tariffPressure + 0.025 + (1 - lane.stability) * 0.015, 0, 1.75);
  }

  invalidateEconomyPrices(state);
  const migratedMembers = migrateLaneAlifeRecords(state, def, lane, paid);
  publishCaravanEvent(state, def, lane, 'tick', 3, paid ? ['paid'] : ['unpaid'], counts, undefined, {
    memberAlifeMoved: migratedMembers,
    fromFloorKey: lanePrimaryFromFloorKey(def),
    toFloorKey: lanePrimaryToFloorKey(def),
  });
  return true;
}

function floorCellNear(world: World, x: number, y: number): { x: number; y: number } | undefined {
  const bx = Math.floor(x);
  const by = Math.floor(y);
  for (let r = 0; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const tx = world.wrap(bx + dx);
        const ty = world.wrap(by + dy);
        const cell = world.cells[world.idx(tx, ty)];
        if (cell === Cell.FLOOR || cell === Cell.WATER) return { x: tx, y: ty };
      }
    }
  }
  return undefined;
}

function caravanSpawnScore(world: World, x: number, y: number, ox: number, oy: number): number {
  const idx = world.idx(x, y);
  const cell = world.cells[idx];
  if (cell !== Cell.FLOOR && cell !== Cell.WATER) return -Infinity;
  let score = -world.dist2(ox, oy, x + 0.5, y + 0.5) * 0.01;
  const room = world.rooms[world.roomMap[idx]];
  if (room) {
    if (room.name.includes('Караван') || room.name.includes('рынок') || room.name.includes('88')) score += 24;
    if (room.type === RoomType.OFFICE || room.type === RoomType.STORAGE || room.type === RoomType.PRODUCTION) score += 10;
  }
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const ni = world.idx(x + dx, y + dy);
      if (world.cells[ni] === Cell.LIFT || world.features[ni] === Feature.LIFT_BUTTON) score += 18;
    }
  }
  return score;
}

function findSmallCaravanSpawn(world: World, player?: Entity): { x: number; y: number } | undefined {
  const ox = player ? Math.floor(player.x) : 512;
  const oy = player ? Math.floor(player.y) : 512;
  let best: { x: number; y: number } | undefined;
  let bestScore = -Infinity;
  for (let i = 0; i < 180; i++) {
    const a = i * 2.399963229728653 + 0.37;
    const d = 4 + (i % 36) * (SMALL_CARAVAN_SPAWN_RADIUS / 36);
    const x = world.wrap(ox + Math.round(Math.cos(a) * d));
    const y = world.wrap(oy + Math.round(Math.sin(a) * d));
    const pos = floorCellNear(world, x, y);
    if (!pos) continue;
    const score = caravanSpawnScore(world, pos.x, pos.y, ox, oy);
    if (score > bestScore) {
      best = pos;
      bestScore = score;
    }
  }
  return best;
}

function chooseSmallCaravanTemplate(state: GameState, requestedId?: string): SmallCaravanTemplateDef | undefined {
  if (requestedId) {
    const requested = SMALL_CARAVAN_TEMPLATES.find(template => template.id === requestedId);
    const lane = requested ? ensureCaravanState(state).lanes[requested.laneId] : undefined;
    const def = requested ? CARAVAN_LANE_BY_ID[requested.laneId] : undefined;
    return requested && lane?.open && def && floorMatchesLane(state.currentFloor, def) ? requested : undefined;
  }

  const caravanState = ensureCaravanState(state);
  const candidates = SMALL_CARAVAN_TEMPLATES.filter(template => {
    const def = CARAVAN_LANE_BY_ID[template.laneId];
    const lane = caravanState.lanes[template.laneId];
    return !!def && lane?.open === true && floorMatchesLane(state.currentFloor, def);
  });
  if (candidates.length === 0) return undefined;
  return candidates[(caravanState.nextRunSeq + state.currentFloor) % candidates.length];
}

function nearbyMemberPosition(world: World, x: number, y: number, index: number): { x: number; y: number } {
  const offsets = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1]] as const;
  for (let i = 0; i < offsets.length; i++) {
    const off = offsets[(index + i) % offsets.length];
    const tx = world.wrap(x + off[0]);
    const ty = world.wrap(y + off[1]);
    const cell = world.cells[world.idx(tx, ty)];
    if (cell === Cell.FLOOR || cell === Cell.WATER) return { x: tx, y: ty };
  }
  return { x, y };
}

function smallCaravanMemberEligible(state: GameState, npc: Entity, template: SmallCaravanTemplateDef, usedIds: ReadonlySet<number>): boolean {
  if (!npc.alive || npc.type !== EntityType.NPC || !npc.ai) return false;
  if (usedIds.has(npc.id) || npc.faction !== template.faction) return false;
  if (npc.plotNpcId || npc.canGiveQuest || (npc.questId !== undefined && npc.questId !== -1)) return false;
  if (npc.persistentNpcId === 'player' || npc.faction === Faction.PLAYER) return false;
  if (state.showNpcMenu && state.npcMenuTarget === npc.id) return false;
  if (npc.alifeId === undefined && npc.persistentNpcId) return false;
  return true;
}

function ensureSmallCaravanMemberAlifeId(
  state: GameState,
  entities: readonly Entity[],
  npc: Entity,
  run: SmallCaravanRunState,
): number | undefined {
  const sourceFloorKey = run.fromFloorKey || currentAlifeFloorKey(state);
  if (npc.alifeId !== undefined) return npc.alifeId;
  if (!assignPersistentAlifeNpcFromEntity(state, npc, entities, sourceFloorKey)) return undefined;
  return npc.alifeId;
}

function claimSmallCaravanMember(
  state: GameState,
  world: World,
  entities: Entity[],
  template: SmallCaravanTemplateDef,
  run: SmallCaravanRunState,
  usedIds: Set<number>,
): Entity | null {
  let best: Entity | null = null;
  let bestScore = Infinity;
  for (const npc of entities) {
    if (!smallCaravanMemberEligible(state, npc, template, usedIds)) continue;
    const score = world.dist2(run.x, run.y, npc.x, npc.y) + ((npc.id * 137) % 100) * 0.001;
    if (score >= bestScore) continue;
    best = npc;
    bestScore = score;
  }
  if (!best) return null;
  const alifeId = ensureSmallCaravanMemberAlifeId(state, entities, best, run);
  if (alifeId === undefined) return null;
  const pos = nearbyMemberPosition(world, Math.floor(run.x), Math.floor(run.y), run.memberIds.length);
  const ai = best.ai;
  if (!ai) return null;
  usedIds.add(best.id);
  best.isTraveler = true;
  ai.goal = AIGoal.GOTO;
  ai.tx = pos.x;
  ai.ty = pos.y;
  ai.path = [];
  ai.pi = 0;
  ai.timer = 0;
  run.memberIds.push(best.id);
  run.memberAlifeIds = normalizeMemberAlifeIds([...(run.memberAlifeIds ?? []), alifeId], template.memberCount);
  return best;
}

function spawnSmallCaravanMembers(
  state: GameState,
  world: World,
  entities: Entity[],
  template: SmallCaravanTemplateDef,
  run: SmallCaravanRunState,
): number {
  const usedIds = new Set<number>();
  for (let i = 0; i < template.memberCount; i++) {
    if (!claimSmallCaravanMember(state, world, entities, template, run, usedIds)) return run.memberIds.length;
  }
  return run.memberIds.length;
}

function currentFloorActiveSmallCaravanCount(caravans: CaravanState, floor: FloorLevel, now: number): number {
  let count = 0;
  for (const id in caravans.active) {
    const run = caravans.active[id];
    if (run.floor === floor && run.expiresAt > now && activeStatus(run.status)) count++;
  }
  return count;
}

export function spawnSmallCaravanNear(
  state: GameState,
  world: World,
  entities: Entity[],
  _nextId: { v: number },
  player?: Entity,
  templateId?: string,
): SmallCaravanRunState | undefined {
  const caravans = ensureCaravanState(state);
  if (currentFloorActiveSmallCaravanCount(caravans, state.currentFloor, state.time) >= MAX_ACTIVE_SMALL_CARAVANS) return undefined;
  const template = chooseSmallCaravanTemplate(state, templateId);
  if (!template) return undefined;
  const pos = findSmallCaravanSpawn(world, player);
  if (!pos) return undefined;

  const run: SmallCaravanRunState = {
    id: `small_${caravans.nextRunSeq}`,
    templateId: template.id,
    laneId: template.laneId,
    floor: state.currentFloor,
    x: pos.x + 0.5,
    y: pos.y + 0.5,
    status: 'moving',
    spawnedAt: state.time,
    updatedAt: state.time,
    expiresAt: state.time + SMALL_CARAVAN_ACTIVE_SECONDS,
    progress: 0,
    risk: template.risk,
    memberIds: [],
    memberAlifeIds: [],
    fromFloorKey: currentAlifeFloorKey(state),
    toFloorKey: lanePrimaryToFloorKey(CARAVAN_LANE_BY_ID[template.laneId]),
  };
  if (spawnSmallCaravanMembers(state, world, entities, template, run) === 0) return undefined;
  caravans.nextRunSeq++;
  caravans.active[run.id] = run;
  caravans.nextSmallSpawnAt = state.time + SMALL_CARAVAN_SPAWN_SECONDS;
  const def = CARAVAN_LANE_BY_ID[template.laneId];
  const lane = caravans.lanes[template.laneId];
  if (def && lane) publishSmallCaravanEvent(state, def, lane, run, 'spawned', 3, ['spawned']);
  return run;
}

function updateSmallCaravanPosition(run: SmallCaravanRunState, entityMap: Map<number, Entity>): boolean {
  let count = 0;
  let x = 0;
  let y = 0;
  for (const id of run.memberIds) {
    const member = entityMap.get(id);
    if (!member?.alive) continue;
    x += member.x;
    y += member.y;
    count++;
  }
  if (count === 0 && run.memberIds.length > 0) return false;
  if (count > 0) {
    run.x = x / count;
    run.y = y / count;
  }
  return true;
}

function moveSmallCaravanAlifeMembers(
  state: GameState,
  run: SmallCaravanRunState,
  def: CaravanLaneDef,
  entities?: readonly Entity[],
): number {
  const toFloorKey = cleanFloorKey(run.toFloorKey) || lanePrimaryToFloorKey(def);
  const ids = normalizeMemberAlifeIds(run.memberAlifeIds, SMALL_CARAVAN_MEMBER_ALIFE_CAP);
  let moved = 0;
  for (const id of ids) {
    const live = entities?.find(entity => entity.type === EntityType.NPC && entity.alifeId === id);
    if (live && !live.alive) {
      recordAlifeNpcDeath(state, live);
      continue;
    }
    if (live) captureAlifeFloorState(state, [live]);
    if (moveAlifeNpcRecord(state, id, toFloorKey, { floor: def.toFloor, preservePosition: false })) moved++;
  }
  return moved;
}

function completeSmallCaravanArrival(state: GameState, run: SmallCaravanRunState, entities?: readonly Entity[]): void {
  const def = CARAVAN_LANE_BY_ID[run.laneId];
  if (!def) return;
  const caravans = ensureCaravanState(state);
  const lane = caravans.lanes[def.id];
  const template = SMALL_CARAVAN_TEMPLATES.find(item => item.id === run.templateId);
  const counts = applyLaneCargo(state, def, template?.cargo ?? def.resourceDeltas, 0.55, 'small_caravan_arrival');
  const migratedMembers = moveSmallCaravanAlifeMembers(state, run, def, entities);
  lane.runs++;
  lane.stability = clamp(lane.stability + 0.04, MIN_STABILITY, MAX_STABILITY);
  lane.tariffPressure = clamp(lane.tariffPressure - 0.04, 0, 1.75);
  lane.lastTickAt = state.time;
  run.status = 'arrived';
  run.updatedAt = state.time;
  run.expiresAt = state.time + SMALL_CARAVAN_TERMINAL_SECONDS;
  invalidateEconomyPrices(state);
  publishSmallCaravanEvent(state, def, lane, run, 'arrived', 3, ['arrived'], counts, undefined, {
    memberAlifeMoved: migratedMembers,
    fromFloorKey: run.fromFloorKey ?? lanePrimaryFromFloorKey(def),
    toFloorKey: run.toFloorKey ?? lanePrimaryToFloorKey(def),
  });
}

function markSmallCaravanLost(state: GameState, run: SmallCaravanRunState, status: 'raided' | 'abandoned'): void {
  const def = CARAVAN_LANE_BY_ID[run.laneId];
  if (!def) return;
  const lane = ensureCaravanState(state).lanes[def.id];
  if (status === 'raided') lane.raids++;
  lane.stability = clamp(lane.stability - (status === 'abandoned' ? 0.12 : 0.2), MIN_STABILITY, MAX_STABILITY);
  lane.tariffPressure = clamp(lane.tariffPressure + (status === 'abandoned' ? 0.16 : 0.24), 0, 1.75);
  run.status = status;
  run.updatedAt = state.time;
  run.expiresAt = state.time + SMALL_CARAVAN_TERMINAL_SECONDS;
  invalidateEconomyPrices(state);
  publishSmallCaravanEvent(state, def, lane, run, status === 'abandoned' ? 'abandoned_samosbor' : 'small_caravan_raided', status === 'abandoned' ? 4 : 5, [status]);
}

function pruneSmallCaravans(caravans: CaravanState, now: number): void {
  for (const [id, run] of Object.entries(caravans.active)) {
    if (run.expiresAt <= now || (terminalStatus(run.status) && run.updatedAt + SMALL_CARAVAN_TERMINAL_SECONDS <= now)) {
      delete caravans.active[id];
    }
  }
}

function updateSmallCaravans(
  state: GameState,
  elapsed: number,
  world?: World,
  entities?: Entity[],
  player?: Entity,
  nextId?: { v: number },
): void {
  const caravans = ensureCaravanState(state);
  pruneSmallCaravans(caravans, state.time);
  if (entities) {
    const entityMap = new Map<number, Entity>();
    for (const e of entities) {
      entityMap.set(e.id, e);
    }
    for (const id in caravans.active) {
      const run = caravans.active[id];
      if (!activeStatus(run.status)) continue;
      if (!updateSmallCaravanPosition(run, entityMap)) {
        markSmallCaravanLost(state, run, 'raided');
        continue;
      }
      if (state.samosborActive && player && world && world.dist2(player.x, player.y, run.x, run.y) <= 48 * 48) {
        markSmallCaravanLost(state, run, 'abandoned');
        continue;
      }
      run.progress = clamp(run.progress + elapsed / (210 + run.risk * 35), 0, 1);
      run.updatedAt = state.time;
      if (run.progress >= 1) completeSmallCaravanArrival(state, run, entities);
    }
  }

  if (!world || !entities || !nextId || state.time < caravans.nextSmallSpawnAt || state.samosborActive) return;
  if (spawnSmallCaravanNear(state, world, entities, nextId, player)) return;
  caravans.nextSmallSpawnAt = state.time + 60;
}

export function tickCaravans(
  state: GameState,
  dt: number,
  force = false,
  maxUpdates = MAX_CARAVAN_LANES_PER_TICK,
  world?: World,
  entities?: Entity[],
  player?: Entity,
  nextId?: { v: number },
): number {
  const caravans = ensureCaravanState(state);
  const elapsed = Math.max(0, dt);
  if (!force) {
    caravans.tickAccum += Math.max(0, dt);
    if (caravans.tickAccum < CARAVAN_TICK_SECONDS) return 0;
    caravans.tickAccum -= CARAVAN_TICK_SECONDS;
  } else {
    caravans.tickAccum = 0;
  }

  let processed = 0;
  let scanned = 0;
  while (processed < maxUpdates && scanned < CARAVAN_LANES.length) {
    const def = CARAVAN_LANES[caravans.cursor % CARAVAN_LANES.length];
    caravans.cursor = (caravans.cursor + 1) % CARAVAN_LANES.length;
    scanned++;
    if (processLane(state, def, caravans.lanes[def.id], force)) processed++;
  }
  updateSmallCaravans(state, elapsed || CARAVAN_TICK_SECONDS, world, entities, player, nextId);
  return processed;
}

function laneFromEvent(event: WorldEvent): CaravanLaneDef | undefined {
  for (const tag of event.tags) {
    const lane = CARAVAN_LANE_BY_ID[tag];
    if (lane) return lane;
  }
  const containerTags = event.data?.containerTags;
  if (Array.isArray(containerTags)) {
    for (const tag of containerTags) {
      if (typeof tag !== 'string') continue;
      const lane = CARAVAN_LANE_BY_ID[tag];
      if (lane) return lane;
    }
  }
  const laneId = event.data?.laneId;
  return typeof laneId === 'string' ? CARAVAN_LANE_BY_ID[laneId] : undefined;
}

export function payCaravanTariff(state: GameState, laneId: string, source?: WorldEvent): boolean {
  const def = CARAVAN_LANE_BY_ID[laneId];
  if (!def) return false;
  const lane = ensureCaravanState(state).lanes[def.id];
  lane.open = true;
  lane.tariffPaidUntil = Math.max(lane.tariffPaidUntil, state.time) + TARIFF_DURATION_SECONDS;
  lane.stability = clamp(lane.stability + 0.18, MIN_STABILITY, MAX_STABILITY);
  lane.tariffPressure = clamp(lane.tariffPressure - 0.22, 0, 1.75);
  invalidateEconomyPrices(state);
  publishCaravanEvent(state, def, lane, 'paid_tariff', 4, ['paid', 'stabilized'], undefined, source);
  return true;
}

export function openCaravanLane(state: GameState, laneId: string, source?: WorldEvent): boolean {
  const def = CARAVAN_LANE_BY_ID[laneId];
  if (!def) return false;
  const lane = ensureCaravanState(state).lanes[def.id];
  lane.open = true;
  lane.stability = clamp(Math.max(lane.stability, 0.82) + 0.08, MIN_STABILITY, MAX_STABILITY);
  lane.tariffPressure = clamp(lane.tariffPressure - 0.12, 0, 1.75);
  lane.nextTickAt = Math.min(lane.nextTickAt, state.time + 20);
  invalidateEconomyPrices(state);
  publishCaravanEvent(state, def, lane, 'opened_lane', 4, ['opened'], undefined, source);
  return true;
}

export function closeCaravanLane(state: GameState, laneId: string, source?: WorldEvent): boolean {
  const def = CARAVAN_LANE_BY_ID[laneId];
  if (!def) return false;
  const lane = ensureCaravanState(state).lanes[def.id];
  lane.open = false;
  lane.stability = clamp(lane.stability - 0.18, MIN_STABILITY, MAX_STABILITY);
  lane.tariffPressure = clamp(lane.tariffPressure + 0.3, 0, 1.75);
  invalidateEconomyPrices(state);
  publishCaravanEvent(state, def, lane, 'closed_lane', 4, ['closed'], undefined, source);
  return true;
}

export function robCaravanCargo(state: GameState, laneId: string, source?: WorldEvent): boolean {
  const def = CARAVAN_LANE_BY_ID[laneId];
  if (!def) return false;
  const lane = ensureCaravanState(state).lanes[def.id];
  const counts = deltaCountsFor(def, 0.7);
  for (let i = 0; i < def.resourceDeltas.length; i++) {
    changeResourceStock(state, def.resourceDeltas[i].resourceId, -counts[i], def.toFloor);
  }
  lane.raids++;
  lane.stability = clamp(lane.stability - 0.24, MIN_STABILITY, MAX_STABILITY);
  lane.tariffPressure = clamp(lane.tariffPressure + 0.28, 0, 1.75);
  markActiveRunOutcome(state, laneId, 'raided');
  addPlayerRelation(def.faction, -5);
  invalidateEconomyPrices(state);
  publishCaravanEvent(state, def, lane, 'robbed_cargo', 5, ['robbed', 'theft'], counts, source);
  return true;
}

export function escortCaravan(state: GameState, laneId: string, source?: WorldEvent): boolean {
  const def = CARAVAN_LANE_BY_ID[laneId];
  if (!def) return false;
  const lane = ensureCaravanState(state).lanes[def.id];
  lane.open = true;
  const template = templateForLane(def.id);
  const counts = applyLaneCargo(state, def, template?.cargo ?? def.resourceDeltas, 0.75, 'small_caravan_escort');
  lane.runs++;
  lane.lastTickAt = state.time;
  lane.nextTickAt = Math.min(lane.nextTickAt, state.time + laneInterval(def));
  lane.stability = clamp(lane.stability + 0.16, MIN_STABILITY, MAX_STABILITY);
  lane.tariffPressure = clamp(lane.tariffPressure - 0.18, 0, 1.75);
  markActiveRunOutcome(state, laneId, 'escorted');
  addPlayerRelation(def.faction, 4);
  invalidateEconomyPrices(state);
  publishCaravanEvent(state, def, lane, 'escorted_small_caravan', 4, ['escorted', 'small_caravan'], counts, source);
  return true;
}

export function rerouteCaravan(state: GameState, laneId: string, source?: WorldEvent): boolean {
  const def = CARAVAN_LANE_BY_ID[laneId];
  if (!def) return false;
  const lane = ensureCaravanState(state).lanes[def.id];
  lane.open = true;
  const template = templateForLane(def.id);
  const risk = template?.risk ?? 3;
  const counts = applyLaneCargo(state, def, template?.cargo ?? def.resourceDeltas, 0.9 + risk * 0.08, 'small_caravan_reroute');
  lane.runs++;
  lane.lastTickAt = state.time;
  lane.nextTickAt = Math.min(lane.nextTickAt, state.time + laneInterval(def));
  lane.stability = clamp(lane.stability - 0.05 - risk * 0.02, MIN_STABILITY, MAX_STABILITY);
  lane.tariffPressure = clamp(lane.tariffPressure + 0.1 + risk * 0.03, 0, 1.75);
  markActiveRunOutcome(state, laneId, 'rerouted');
  addPlayerRelation(def.faction, 2);
  invalidateEconomyPrices(state);
  publishCaravanEvent(state, def, lane, 'rerouted_small_caravan', 4, ['rerouted', 'risk', 'small_caravan'], counts, source);
  return true;
}

export function reportCaravan(state: GameState, laneId: string, source?: WorldEvent): boolean {
  const def = CARAVAN_LANE_BY_ID[laneId];
  if (!def) return false;
  const ok = closeCaravanLane(state, laneId, source);
  if (ok) {
    markActiveRunOutcome(state, laneId, 'reported');
    addPlayerRelation(Faction.LIQUIDATOR, 4);
    addPlayerRelation(def.faction, def.faction === Faction.LIQUIDATOR ? 0 : -4);
  }
  return ok;
}

export function buyCaravanSeat(state: GameState, laneId: string, source?: WorldEvent): boolean {
  const def = CARAVAN_LANE_BY_ID[laneId];
  if (!def) return false;
  const lane = ensureCaravanState(state).lanes[def.id];
  lane.open = true;
  lane.stability = clamp(lane.stability + 0.06, MIN_STABILITY, MAX_STABILITY);
  lane.tariffPressure = clamp(lane.tariffPressure - 0.06, 0, 1.75);
  markActiveRunOutcome(state, laneId, 'seat_sold');
  addPlayerRelation(def.faction, 1);
  invalidateEconomyPrices(state);
  publishCaravanEvent(state, def, lane, 'bought_seat', 3, ['seat', 'paid'], undefined, source);
  state.msgs.push(msg('Место в малом караване записано. В середине идут тише.', state.time, '#8cf'));
  return true;
}

export function getCaravanLaneTariffMultiplier(state: GameState, laneId: string): number {
  const def = CARAVAN_LANE_BY_ID[laneId];
  if (!def) return 1;
  const lane = ensureCaravanState(state).lanes[def.id];
  const closed = lane.open ? 0 : 0.22;
  return Number(clamp(1 + closed + lane.tariffPressure * 0.35, 0.75, 2.5).toFixed(3));
}

export function getCaravanResourceTariffMultiplier(
  state: GameState,
  resourceId: string,
  floor: FloorLevel = state.currentFloor,
): number {
  let multiplier = 1;
  for (const def of CARAVAN_LANES) {
    if (!def.tariffResourceIds.includes(resourceId)) continue;
    if (def.fromFloor !== floor && def.toFloor !== floor) continue;
    multiplier *= getCaravanLaneTariffMultiplier(state, def.id);
  }
  return Number(clamp(multiplier, 0.5, 3).toFixed(3));
}

export interface SmallCaravanHudSnapshot {
  id: string;
  laneId: string;
  name: string;
  status: SmallCaravanStatus;
  statusText: string;
  detail: string;
  x: number;
  y: number;
  dist: number;
  risk: number;
  color: string;
}

const SMALL_CARAVAN_STATUS_TEXT: Record<SmallCaravanStatus, string> = {
  waiting: 'ждет',
  moving: 'в пути',
  escorted: 'под охраной',
  arrived: 'дошел',
  raided: 'разграблен',
  reported: 'сдан',
  rerouted: 'обход',
  seat_sold: 'место куплено',
  abandoned: 'брошен',
};

function smallCaravanColor(status: SmallCaravanStatus): string {
  if (status === 'raided' || status === 'abandoned') return '#f66';
  if (status === 'reported') return '#8cf';
  if (status === 'rerouted') return '#fc6';
  if (status === 'arrived' || status === 'escorted' || status === 'seat_sold') return '#8f8';
  return '#ffd36a';
}

export function getNearestSmallCaravan(
  state: GameState,
  world: World,
  player: Entity,
  maxDist = 120,
): SmallCaravanHudSnapshot | undefined {
  const caravans = ensureCaravanState(state);
  let best: SmallCaravanRunState | undefined;
  let bestD2 = maxDist * maxDist;
  for (const id in caravans.active) {
    const run = caravans.active[id];
    if (run.floor !== state.currentFloor || run.expiresAt <= state.time) continue;
    if (terminalStatus(run.status) && run.updatedAt + SMALL_CARAVAN_TERMINAL_SECONDS < state.time) continue;
    const d2 = world.dist2(player.x, player.y, run.x, run.y);
    if (d2 < bestD2) {
      best = run;
      bestD2 = d2;
    }
  }
  if (!best) return undefined;
  const template = SMALL_CARAVAN_TEMPLATES.find(item => item.id === best.templateId);
  const tariff = getCaravanLaneTariffMultiplier(state, best.laneId).toFixed(2);
  return {
    id: best.id,
    laneId: best.laneId,
    name: template?.name ?? CARAVAN_LANE_BY_ID[best.laneId]?.name ?? 'малый караван',
    status: best.status,
    statusText: SMALL_CARAVAN_STATUS_TEXT[best.status],
    detail: `тариф x${tariff}`,
    x: best.x,
    y: best.y,
    dist: Math.max(0, Math.round(Math.sqrt(bestD2))),
    risk: best.risk,
    color: smallCaravanColor(best.status),
  };
}

registerEconomyTariffProvider({
  id: 'caravan_supply_lanes',
  quote(state: GameState, resourceId: string | undefined, floor: EconomyFloorRef) {
    if (!resourceId || typeof floor !== 'number') return undefined;
    const multiplier = getCaravanResourceTariffMultiplier(state, resourceId, floor);
    if (multiplier === 1) return undefined;
    return {
      multiplier,
      tags: ['tariff', 'caravan_tariff'],
      reason: 'caravan_supply_lane_tariff',
    };
  },
});

export function summarizeCaravans(state: GameState, limit = 6): string[] {
  const caravans = ensureCaravanState(state);
  return CARAVAN_LANES.slice(0, limit).map(def => {
    const lane = caravans.lanes[def.id];
    const status = lane.open ? 'открыта' : 'закрыта';
    const tariff = getCaravanLaneTariffMultiplier(state, def.id).toFixed(2);
    return `${def.name}: ${status}, стабильность ${Math.round(lane.stability * 100)}%, тариф x${tariff}`;
  });
}

function handleCaravanQuestEvent(state: GameState, event: WorldEvent): boolean {
  if (event.type !== 'quest_completed' && event.type !== 'contract_completed') return false;
  const action = event.data?.caravanAction;
  const laneId = event.data?.laneId;
  if (typeof action === 'string' && typeof laneId === 'string') {
    if (action === 'pay_tariff') return payCaravanTariff(state, laneId, event);
    if (action === 'open_lane') return openCaravanLane(state, laneId, event);
    if (action === 'close_lane') return closeCaravanLane(state, laneId, event);
  }
  const contractId = event.data?.contractId;
  const outcome = typeof contractId === 'string' ? CARAVAN_CONTRACT_OUTCOMES[contractId] : undefined;
  if (!outcome) return false;
  if (outcome.action === 'escort') return escortCaravan(state, outcome.laneId, event);
  if (outcome.action === 'raid') return robCaravanCargo(state, outcome.laneId, event);
  if (outcome.action === 'reroute') return rerouteCaravan(state, outcome.laneId, event);
  if (outcome.action === 'report') return reportCaravan(state, outcome.laneId, event);
  if (outcome.action === 'seat') return buyCaravanSeat(state, outcome.laneId, event);
  return false;
}

function handleCaravanWorldEvent(state: GameState, event: WorldEvent): void {
  if (handleCaravanQuestEvent(state, event)) return;
  if (event.type === 'faction_relation_changed' && event.data?.routeImpact === 'market_88_caravan_lane') {
    openCaravanLane(state, 'production_black_market_88', event);
    return;
  }
  if (event.type !== 'item_stolen' || !event.tags.includes('caravan')) return;
  const lane = laneFromEvent(event);
  if (lane) robCaravanCargo(state, lane.id, event);
}

registerWorldEventObserver(handleCaravanWorldEvent);
