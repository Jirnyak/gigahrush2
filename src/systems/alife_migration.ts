import {
  AIGoal,
  Cell,
  EntityType,
  Feature,
  FloorLevel,
  W,
  type Entity,
  type GameState,
} from '../core/types';
import type { World } from '../core/world';
import {
  ALIFE_MIGRATION_INTENTS,
  type AlifeDestinationSelector,
  type AlifeMigrationIntentDef,
  type AlifeMigrationReason,
} from '../data/alife_migration';
import { ALIFE_POPULATION_CAPACITY } from '../data/alife_population_plan';
import { occupationHasRoutineTag } from '../data/occupation_profiles';
import { DESIGN_FLOOR_ROUTES } from '../data/design_floors';
import {
  anomalyById,
  majorityById,
  type ProceduralFloorSpec,
} from '../data/procedural_floors';
import {
  themeForDesignRoute,
  themeForProceduralSpec,
  themeForStoryFloor,
} from '../data/floor_theme_profiles';
import {
  alifeNpcRecordCount,
  alifeSeed,
  forEachAlifeNpcRecordSlice,
  getAlifeNpcRecordSnapshot,
  materializeAlifeArrival,
  moveAlifeNpcRecord,
  type AlifeNpcSnapshot,
  currentAlifeFloorKey,
  captureAlifeFloorState,
} from './alife';
import { canSpawnEntityType } from './entity_limits';
import { publishEvent } from './events';
import { cleanFloorKey } from './floor_keys';
import { currentFloorRunAllowsNpcs, ensureFloorRunState } from './procedural_floors';
import { isNativePlayerBodyEntity, isPlayerEntity } from './player_actor';
import { tryAssignPathToCell } from './ai/pathfinding';

export const MAX_ALIFE_JOURNEYS = 512;
export const MAX_ALIFE_PENDING_ARRIVALS = 256;
export const ALIFE_MIGRATION_TICK_SECONDS = 30;
export const ALIFE_MIGRATION_RECORDS_PER_TICK = 64;
export const ALIFE_MIGRATION_FORCE_RECORD_CAP = 256;
const MAX_ACTIVE_ALIFE_DEPARTURES = 32;
const MAX_ACTIVE_DEPARTURE_UPDATES = 8;
const MAX_ACTIVE_ARRIVAL_TRIES = 12;
const ALIFE_MIGRATION_TRAVELER_PRIORITY_RECORDS = 16;
const ALIFE_MIGRATION_TRAVELER_PRIORITY_ATTEMPTS = 256;
const ALIFE_MIGRATION_TRAVELER_ETA_MULTIPLIER = 0.55;
const MAX_ROOM_ANCHOR_SCAN_CELLS = 32_768;
const MAX_SAMPLED_ANCHOR_SCAN_CELLS = 16_384;
const DEPARTURE_REACHED_DIST2 = 1.8 * 1.8;
const ANCHOR_NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export interface AlifeJourney {
  id: string;
  alifeId: number;
  fromFloorKey: string;
  toFloorKey: string;
  intentId: string;
  reason: AlifeMigrationReason;
  laneId: string;
  risk: 1 | 2 | 3 | 4 | 5;
  startedAt: number;
  etaAt: number;
  status: 'in_transit' | 'lost';
}

export interface AlifeArrival {
  journeyId: string;
  alifeId: number;
  fromFloorKey: string;
  toFloorKey: string;
  floorKey?: string;
  intentId: string;
  reason: AlifeMigrationReason;
  risk: 1 | 2 | 3 | 4 | 5;
  etaAt: number;
  queuedAt: number;
  tries?: number;
  preferredX?: number;
  preferredY?: number;
}

export interface ActiveAlifeDeparture {
  entityId: number;
  alifeId: number;
  toFloorKey: string;
  intentId: string;
  reason: AlifeMigrationReason;
  startedAt: number;
  anchorX: number;
  anchorY: number;
}

export interface AlifeMigrationSummary {
  processed: number;
  journeysStarted: number;
  journeysArrived: number;
  pendingArrivals: number;
  eventsPublished: number;
  cursor: number;
  lastTickAt: number;
}

export interface AlifeMobilityState {
  version: 1;
  tickAccum: number;
  cursor: number;
  nextJourneySeq: number;
  journeys: Record<string, AlifeJourney>;
  pendingArrivals: AlifeArrival[];
  activeDepartures: ActiveAlifeDeparture[];
  lastSummary?: AlifeMigrationSummary;
}

export interface AlifeMobilitySaveState {
  version: 1;
  tickAccum: number;
  cursor: number;
  nextJourneySeq: number;
  journeys: Record<string, AlifeJourney>;
  pendingArrivals: AlifeArrival[];
}

interface RouteInfo {
  floorKey: string;
  baseFloor: FloorLevel;
  z?: number;
  danger: 1 | 2 | 3 | 4 | 5;
  npcAllowed: boolean;
  tags: readonly string[];
}

interface Anchor {
  x: number;
  y: number;
  angle?: number;
}

interface AnchorCache {
  cellVersion: number;
  featureVersion: number;
  liftAnchors: Anchor[];
  buttonAnchors: Anchor[];
}

type MobilityHost = GameState & { alifeMobility?: AlifeMobilityState; alifeMigration?: AlifeMobilityState };

const anchorCache = new WeakMap<World, AnchorCache>();

const STORY_ROUTE_INFO: readonly RouteInfo[] = [
  storyRouteInfo(FloorLevel.MINISTRY),
  storyRouteInfo(FloorLevel.KVARTIRY),
  storyRouteInfo(FloorLevel.LIVING),
  storyRouteInfo(FloorLevel.MAINTENANCE),
  storyRouteInfo(FloorLevel.HELL),
  storyRouteInfo(FloorLevel.VOID),
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
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

function unit(seed: number, a: number, b: number): number {
  return hash32(seed, a, b) / 0x100000000;
}

function uniqueTags(tags: readonly string[], cap = 16): readonly string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag || out.includes(tag)) continue;
    out.push(tag.slice(0, 32));
    if (out.length >= cap) break;
  }
  return out;
}

function storyRouteInfo(floor: FloorLevel): RouteInfo {
  const theme = themeForStoryFloor(floor);
  return {
    floorKey: theme.floorKey,
    baseFloor: floor,
    z: theme.routeZ,
    danger: theme.danger,
    npcAllowed: theme.npcAllowed,
    tags: uniqueTags(['story', ...theme.specialContentTags, ...theme.economyTags, ...theme.objectProfileTags, ...theme.monsterPressureTags]),
  };
}

function designRouteInfo(): RouteInfo[] {
  return DESIGN_FLOOR_ROUTES.map(route => {
    const theme = themeForDesignRoute(route);
    return {
      floorKey: theme.floorKey,
      baseFloor: route.baseFloor,
      z: route.z,
      danger: route.danger,
      npcAllowed: theme.npcAllowed,
      tags: uniqueTags(['design', route.id, ...theme.specialContentTags, ...theme.economyTags, ...theme.objectProfileTags, ...theme.monsterPressureTags]),
    };
  });
}

function proceduralRouteInfo(specs: Record<string, ProceduralFloorSpec>): RouteInfo[] {
  return Object.values(specs).map(spec => {
    const theme = themeForProceduralSpec(spec);
    const majority = majorityById(spec.majorityId);
    const anomaly = anomalyById(spec.anomalyId);
    return {
      floorKey: theme.floorKey,
      baseFloor: spec.baseFloor,
      z: spec.z,
      danger: spec.danger,
      npcAllowed: theme.npcAllowed,
      tags: uniqueTags([
        'procedural',
        spec.key,
        spec.geometryId,
        spec.majorityId,
        spec.anomalyId,
        ...theme.specialContentTags,
        ...theme.economyTags,
        ...theme.objectProfileTags,
        ...theme.monsterPressureTags,
        ...majority.tags,
        ...anomaly.tags,
      ]),
    };
  });
}

function routeContext(state: GameState): RouteInfo[] {
  const run = ensureFloorRunState(state);
  return [...STORY_ROUTE_INFO, ...designRouteInfo(), ...proceduralRouteInfo(run.specs)];
}

function createMobilityState(): AlifeMobilityState {
  return {
    version: 1,
    tickAccum: 0,
    cursor: 0,
    nextJourneySeq: 1,
    journeys: {},
    pendingArrivals: [],
    activeDepartures: [],
  };
}

export function ensureAlifeMobilityState(state: GameState): AlifeMobilityState {
  const host = state as MobilityHost;
  if (host.alifeMobility?.version === 1) {
    host.alifeMobility.activeDepartures ??= [];
    host.alifeMigration = host.alifeMobility;
    return host.alifeMobility;
  }
  if (host.alifeMigration?.version === 1) {
    host.alifeMigration.activeDepartures ??= [];
    host.alifeMobility = host.alifeMigration;
    return host.alifeMigration;
  }
  host.alifeMobility = createMobilityState();
  host.alifeMigration = host.alifeMobility;
  return host.alifeMobility;
}

function cleanReason(value: unknown): AlifeMigrationReason {
  return typeof value === 'string' && [
    'routine',
    'market',
    'work',
    'rest',
    'research',
    'caravan',
    'faction',
    'samosbor',
    'quest',
    'refugee',
  ].includes(value)
    ? value as AlifeMigrationReason
    : 'routine';
}

function cleanRisk(value: unknown): 1 | 2 | 3 | 4 | 5 {
  return clampInt(value, 1, 1, 5) as 1 | 2 | 3 | 4 | 5;
}

function cleanJourney(raw: unknown): AlifeJourney | undefined {
  if (!isRecord(raw)) return undefined;
  const alifeId = clampInt(raw.alifeId, 0, 1, ALIFE_POPULATION_CAPACITY);
  if (alifeId <= 0) return undefined;
  const id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : `alife_journey_${alifeId}`;
  const fromFloorKey = cleanFloorKey(raw.fromFloorKey);
  const toFloorKey = cleanFloorKey(raw.toFloorKey);
  if (!fromFloorKey || !toFloorKey) return undefined;
  return {
    id,
    alifeId,
    fromFloorKey,
    toFloorKey,
    intentId: typeof raw.intentId === 'string' && raw.intentId ? raw.intentId.slice(0, 48) : 'routine',
    reason: cleanReason(raw.reason),
    laneId: typeof raw.laneId === 'string' && raw.laneId ? raw.laneId.slice(0, 96) : `${fromFloorKey}->${toFloorKey}`,
    risk: cleanRisk(raw.risk),
    startedAt: clampInt(raw.startedAt, 0, 0, 10_000_000),
    etaAt: clampInt(raw.etaAt, 0, 0, 10_000_000),
    status: raw.status === 'lost' ? 'lost' : 'in_transit',
  };
}

function cleanArrival(raw: unknown): AlifeArrival | undefined {
  if (!isRecord(raw)) return undefined;
  const targetFloorKey = cleanFloorKey(raw.toFloorKey) || cleanFloorKey(raw.floorKey);
  const journey = cleanJourney({ ...raw, toFloorKey: targetFloorKey, status: 'in_transit' });
  if (!journey) return undefined;
  return {
    journeyId: typeof raw.journeyId === 'string' && raw.journeyId ? raw.journeyId.slice(0, 64) : journey.id,
    alifeId: journey.alifeId,
    fromFloorKey: journey.fromFloorKey,
    toFloorKey: journey.toFloorKey,
    floorKey: journey.toFloorKey,
    intentId: journey.intentId,
    reason: journey.reason,
    risk: journey.risk,
    etaAt: journey.etaAt,
    queuedAt: clampInt(raw.queuedAt, journey.etaAt, 0, 10_000_000),
    tries: clampInt(raw.tries, 0, 0, 12),
    preferredX: typeof raw.preferredX === 'number' && Number.isFinite(raw.preferredX) ? raw.preferredX : undefined,
    preferredY: typeof raw.preferredY === 'number' && Number.isFinite(raw.preferredY) ? raw.preferredY : undefined,
  };
}

export function setAlifeMobilityState(state: GameState, input: unknown): AlifeMobilityState {
  const source = isRecord(input) ? input : {};
  const out = createMobilityState();
  out.tickAccum = Math.max(0, Math.min(ALIFE_MIGRATION_TICK_SECONDS, Number(source.tickAccum) || 0));
  out.cursor = clampInt(source.cursor, 0, 0, ALIFE_POPULATION_CAPACITY);
  out.nextJourneySeq = clampInt(source.nextJourneySeq, 1, 1, 1_000_000_000);
  if (isRecord(source.journeys)) {
    for (const raw of Object.values(source.journeys)) {
      if (Object.keys(out.journeys).length >= MAX_ALIFE_JOURNEYS) break;
      const journey = cleanJourney(raw);
      if (!journey) continue;
      out.journeys[journey.id] = journey;
    }
  }
  if (Array.isArray(source.pendingArrivals)) {
    for (const raw of source.pendingArrivals) {
      if (out.pendingArrivals.length >= MAX_ALIFE_PENDING_ARRIVALS) break;
      const arrival = cleanArrival(raw);
      if (arrival) out.pendingArrivals.push(arrival);
    }
  }
  const host = state as MobilityHost;
  host.alifeMobility = out;
  host.alifeMigration = out;
  return out;
}

export function alifeMobilityForSave(state: GameState): AlifeMobilitySaveState {
  const mobility = ensureAlifeMobilityState(state);
  const journeys: Record<string, AlifeJourney> = {};
  for (const journey of Object.values(mobility.journeys).slice(0, MAX_ALIFE_JOURNEYS)) {
    journeys[journey.id] = { ...journey };
  }
  return {
    version: 1,
    tickAccum: Math.max(0, Math.min(ALIFE_MIGRATION_TICK_SECONDS, mobility.tickAccum)),
    cursor: Math.max(0, Math.floor(mobility.cursor)),
    nextJourneySeq: Math.max(1, Math.floor(mobility.nextJourneySeq)),
    journeys,
    pendingArrivals: mobility.pendingArrivals.slice(0, MAX_ALIFE_PENDING_ARRIVALS).map(arrival => ({ ...arrival })),
  };
}

function journeyAlifeIds(mobility: AlifeMobilityState): Set<number> {
  const ids = new Set<number>();
  for (const journey of Object.values(mobility.journeys)) {
    if (journey.status === 'in_transit') ids.add(journey.alifeId);
  }
  return ids;
}

function wealthBand(record: AlifeNpcSnapshot): 'poor' | 'stable' | 'rich' {
  const wealth = record.money + record.accountRubles;
  if (wealth < 120) return 'poor';
  if (wealth < 15_000) return 'stable';
  return 'rich';
}

function weightedBiasScore<T>(value: T, weights: readonly { value: T; weight: number }[] | undefined): number {
  if (!weights || weights.length === 0) return 1;
  const match = weights.find(row => row.value === value);
  return match ? Math.max(0, match.weight) : 0.25;
}

function intentScore(intent: AlifeMigrationIntentDef, record: AlifeNpcSnapshot): number {
  if (intent.minLevel !== undefined && record.level < intent.minLevel) return 0;
  if (intent.wealthBias && intent.wealthBias !== 'any' && intent.wealthBias !== wealthBand(record)) return intent.weight * 0.25;
  return intent.weight *
    weightedBiasScore(record.faction, intent.factionBias) *
    weightedBiasScore(record.occupation, intent.occupationBias);
}

function pickIntent(seed: number, time: number, record: AlifeNpcSnapshot, cursor: number): AlifeMigrationIntentDef | undefined {
  let total = 0;
  const len = ALIFE_MIGRATION_INTENTS.length;
  const scores = new Array<number>(len);

  for (let i = 0; i < len; i++) {
    const w = intentScore(ALIFE_MIGRATION_INTENTS[i], record);
    scores[i] = w;
    if (w > 0) {
      total += w;
    }
  }

  if (total <= 0) return undefined;

  let roll = unit(seed, record.id, Math.floor(time) ^ cursor) * total;
  let lastValidIntent: AlifeMigrationIntentDef | undefined = undefined;

  for (let i = 0; i < len; i++) {
    const w = scores[i];
    if (w > 0) {
      roll -= w;
      lastValidIntent = ALIFE_MIGRATION_INTENTS[i];
      if (roll <= 0) return lastValidIntent;
    }
  }

  return lastValidIntent;
}

function selectorMatches(route: RouteInfo, selector: AlifeDestinationSelector): boolean {
  if (selector.allowsNpcOnly !== false && !route.npcAllowed) return false;
  if (selector.floorKeys?.includes(route.floorKey)) return true;
  if (selector.baseFloors?.includes(route.baseFloor)) {
    const absZ = Math.abs(route.z ?? 0);
    if (selector.minAbsZ !== undefined && absZ < selector.minAbsZ) return false;
    if (selector.maxAbsZ !== undefined && absZ > selector.maxAbsZ) return false;
    return true;
  }
  if (selector.routeTags?.some(tag => route.tags.includes(tag))) {
    const absZ = Math.abs(route.z ?? 0);
    if (selector.minAbsZ !== undefined && absZ < selector.minAbsZ) return false;
    if (selector.maxAbsZ !== undefined && absZ > selector.maxAbsZ) return false;
    return true;
  }
  if (!selector.floorKeys?.length && !selector.baseFloors?.length && !selector.routeTags?.length) {
    const absZ = Math.abs(route.z ?? 0);
    if (selector.minAbsZ !== undefined && absZ < selector.minAbsZ) return false;
    if (selector.maxAbsZ !== undefined && absZ > selector.maxAbsZ) return false;
    return true;
  }
  return false;
}

function resolveRoute(context: readonly RouteInfo[], floorKey: string): RouteInfo | undefined {
  return context.find(route => route.floorKey === floorKey);
}

function resolveDestination(
  seed: number,
  time: number,
  record: AlifeNpcSnapshot,
  intent: AlifeMigrationIntentDef,
  context: readonly RouteInfo[],
): RouteInfo | undefined {
  const source = resolveRoute(context, record.floorKey);
  const candidates = context.filter(route => {
    if (route.floorKey === record.floorKey) return false;
    if (route.baseFloor === FloorLevel.VOID) return false;
    if (!selectorMatches(route, intent.destination)) return false;
    if (intent.maxRisk !== undefined) {
      const sourceRisk = source?.danger ?? 3;
      if (Math.max(sourceRisk, route.danger) > intent.maxRisk) return false;
    }
    return true;
  });
  if (candidates.length === 0) return undefined;
  const idx = hash32(seed ^ Math.floor(time), record.id, intent.id.length * 997) % candidates.length;
  return candidates[idx];
}

function routeRisk(source: RouteInfo | undefined, destination: RouteInfo): 1 | 2 | 3 | 4 | 5 {
  return Math.max(source?.danger ?? 3, destination.danger) as 1 | 2 | 3 | 4 | 5;
}

function usesTravelerMigrationLane(record: AlifeNpcSnapshot): boolean {
  return occupationHasRoutineTag(record.occupation, 'traveler');
}

function travelEta(seed: number, state: GameState, record: AlifeNpcSnapshot, source: RouteInfo | undefined, destination: RouteInfo, risk: number): number {
  const zA = source?.z;
  const zB = destination.z;
  const distance = zA !== undefined && zB !== undefined ? Math.abs(zA - zB) : 3;
  const base = 60 + distance * 20;
  const riskFactor = 1 + (risk - 1) * 0.35;
  const jitter = 0.8 + unit(seed, record.id, Math.floor(state.time) ^ 0x51a7) * 0.55;
  const travelerMultiplier = usesTravelerMigrationLane(record) ? ALIFE_MIGRATION_TRAVELER_ETA_MULTIPLIER : 1;
  return state.time + base * riskFactor * jitter * travelerMultiplier;
}

function queueArrival(mobility: AlifeMobilityState, journey: AlifeJourney, now: number): boolean {
  if (mobility.pendingArrivals.length >= MAX_ALIFE_PENDING_ARRIVALS) return false;
  mobility.pendingArrivals.push({
    journeyId: journey.id,
    alifeId: journey.alifeId,
    fromFloorKey: journey.fromFloorKey,
    toFloorKey: journey.toFloorKey,
    floorKey: journey.toFloorKey,
    intentId: journey.intentId,
    reason: journey.reason,
    risk: journey.risk,
    etaAt: journey.etaAt,
    queuedAt: now,
    tries: 0,
  });
  return true;
}

function publishMigrationEvent(
  state: GameState,
  record: AlifeNpcSnapshot,
  journey: AlifeJourney,
  tags: readonly string[],
): void {
  publishEvent(state, {
    type: 'alife_migration',
    severity: journey.risk >= 4 ? 3 : 2,
    privacy: 'private',
    actorName: record.name,
    actorFaction: record.faction,
    tags: uniqueTags(['alife_migration', 'migration', journey.intentId, journey.reason, ...tags], 8) as string[],
    data: {
      alifeId: record.id,
      fromFloorKey: journey.fromFloorKey,
      toFloorKey: journey.toFloorKey,
      intentId: journey.intentId,
      reason: journey.reason,
      journeyId: journey.id,
      laneId: journey.laneId,
      risk: journey.risk,
    },
  });
}

function startJourney(
  state: GameState,
  mobility: AlifeMobilityState,
  record: AlifeNpcSnapshot,
  destination: RouteInfo,
  intent: AlifeMigrationIntentDef,
  context: readonly RouteInfo[],
  eventBudget: { remaining: number },
): boolean {
  if (Object.keys(mobility.journeys).length >= MAX_ALIFE_JOURNEYS) return false;
  const source = resolveRoute(context, record.floorKey);
  const risk = routeRisk(source, destination);
  const id = `alife_journey_${mobility.nextJourneySeq++}`;
  const journey: AlifeJourney = {
    id,
    alifeId: record.id,
    fromFloorKey: record.floorKey,
    toFloorKey: destination.floorKey,
    intentId: intent.id,
    reason: intent.reason,
    laneId: `${record.floorKey}->${destination.floorKey}`,
    risk,
    startedAt: state.time,
    etaAt: travelEta(alifeSeed(state), state, record, source, destination, risk),
    status: 'in_transit',
  };
  mobility.journeys[id] = journey;
  if (eventBudget.remaining > 0) {
    publishMigrationEvent(state, record, journey, intent.eventTags);
    eventBudget.remaining--;
  }
  return true;
}

function tryStartColdJourneyForRecord(
  state: GameState,
  mobility: AlifeMobilityState,
  record: AlifeNpcSnapshot,
  cursor: number,
  activeFloorKey: string,
  inJourney: Set<number>,
  context: readonly RouteInfo[],
  eventBudget: { remaining: number },
): boolean {
  if (record.dead) return false;
  if (record.reservedKind) return false;
  if (record.floorKey === activeFloorKey) return false;
  if (inJourney.has(record.id)) return false;
  const intent = pickIntent(alifeSeed(state), state.time, record, cursor);
  if (!intent) return false;
  const destination = resolveDestination(alifeSeed(state), state.time, record, intent, context);
  if (!destination || destination.floorKey === record.floorKey) return false;
  if (!startJourney(state, mobility, record, destination, intent, context, eventBudget)) return false;
  inJourney.add(record.id);
  return true;
}

function processTravelerPriorityRecords(
  state: GameState,
  mobility: AlifeMobilityState,
  activeFloorKey: string,
  maxRecords: number,
  inJourney: Set<number>,
  context: readonly RouteInfo[],
  eventBudget: { remaining: number },
): { processed: number; journeysStarted: number } {
  const total = alifeNpcRecordCount(state);
  if (total <= 0 || maxRecords <= 0) return { processed: 0, journeysStarted: 0 };
  let processed = 0;
  let journeysStarted = 0;
  const seen = new Set<number>();
  const seed = alifeSeed(state);
  const tickBucket = Math.floor(state.time / ALIFE_MIGRATION_TICK_SECONDS);
  const maxAccepted = Math.min(maxRecords, ALIFE_MIGRATION_TRAVELER_PRIORITY_RECORDS);
  for (let attempt = 0; attempt < ALIFE_MIGRATION_TRAVELER_PRIORITY_ATTEMPTS && processed < maxAccepted; attempt++) {
    const id = 1 + (hash32(seed ^ tickBucket, mobility.cursor + attempt, 0x71a7) % total);
    if (seen.has(id)) continue;
    seen.add(id);
    const record = getAlifeNpcRecordSnapshot(state, id);
    if (!record || !usesTravelerMigrationLane(record)) continue;
    processed++;
    if (tryStartColdJourneyForRecord(state, mobility, record, id - 1, activeFloorKey, inJourney, context, eventBudget)) {
      journeysStarted++;
    }
  }
  return { processed, journeysStarted };
}

function processDueJourneys(
  state: GameState,
  mobility: AlifeMobilityState,
  activeFloorKey: string,
  maxRecords: number,
  eventBudget: { remaining: number },
): { processed: number; arrived: number } {
  let processed = 0;
  let arrived = 0;
  let blocked = 0;
  for (const journey of Object.values(mobility.journeys)) {
    if (processed >= maxRecords) break;
    if (journey.status !== 'in_transit' || journey.etaAt > state.time) continue;
    const arrivalTargetsActiveFloor = journey.toFloorKey === activeFloorKey;
    if (arrivalTargetsActiveFloor && mobility.pendingArrivals.length >= MAX_ALIFE_PENDING_ARRIVALS) {
      blocked++;
      continue;
    }
    processed++;
    const before = getAlifeNpcRecordSnapshot(state, journey.alifeId);
    if (!before) {
      delete mobility.journeys[journey.id];
      continue;
    }
    const moved = moveAlifeNpcRecord(state, journey.alifeId, journey.toFloorKey);
    if (!moved) {
      delete mobility.journeys[journey.id];
      continue;
    }
    const record = getAlifeNpcRecordSnapshot(state, journey.alifeId) ?? before;
    if (arrivalTargetsActiveFloor) queueArrival(mobility, journey, state.time);
    delete mobility.journeys[journey.id];
    arrived++;
    if (eventBudget.remaining > 0) {
      publishMigrationEvent(state, record, journey, ['arrival']);
      eventBudget.remaining--;
    }
  }
  return { processed: Math.min(maxRecords, processed + blocked), arrived };
}

function cleanActiveId(value: string, fallback: string): string {
  const clean = value.trim().replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 64);
  return clean.length > 0 ? clean : fallback;
}

function finiteCoord(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function passableCell(world: World, x: number, y: number): boolean {
  const cell = world.cells[world.idx(x, y)];
  return cell === Cell.FLOOR || cell === Cell.WATER;
}

function anchorAngle(world: World, ax: number, ay: number, sx: number, sy: number): number {
  return Math.atan2(world.delta(ay + 0.5, sy + 0.5), world.delta(ax + 0.5, sx + 0.5));
}

function anchorForPassableCell(world: World, x: number, y: number, sourceX: number, sourceY: number): Anchor | null {
  if (!passableCell(world, x, y)) return null;
  return {
    x: world.wrap(x) + 0.5,
    y: world.wrap(y) + 0.5,
    angle: anchorAngle(world, x, y, sourceX, sourceY),
  };
}

function bestAdjacentAnchor(
  world: World,
  sourceX: number,
  sourceY: number,
  preferredX?: number,
  preferredY?: number,
): Anchor | null {
  let best: Anchor | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const [dx, dy] of ANCHOR_NEIGHBORS) {
    const x = world.wrap(sourceX + dx);
    const y = world.wrap(sourceY + dy);
    const anchor = anchorForPassableCell(world, x, y, sourceX, sourceY);
    if (!anchor) continue;
    const score = finiteCoord(preferredX) && finiteCoord(preferredY)
      ? world.dist2(anchor.x, anchor.y, preferredX, preferredY)
      : world.dist2(anchor.x, anchor.y, sourceX + 0.5, sourceY + 0.5);
    if (score < bestScore) {
      best = anchor;
      bestScore = score;
    }
  }
  return best;
}

function addUniqueAnchor(list: Anchor[], anchor: Anchor | null): void {
  if (!anchor) return;
  const x = Math.floor(anchor.x);
  const y = Math.floor(anchor.y);
  if (list.some(item => Math.floor(item.x) === x && Math.floor(item.y) === y)) return;
  list.push(anchor);
}

function scanLocalSourceAnchors(
  world: World,
  cx: number,
  cy: number,
  radius: number,
  source: 'lift' | 'button',
  preferredX?: number,
  preferredY?: number,
): Anchor | null {
  let best: Anchor | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const ix = Math.floor(cx);
  const iy = Math.floor(cy);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = world.wrap(ix + dx);
      const y = world.wrap(iy + dy);
      const idx = world.idx(x, y);
      const matches = source === 'lift'
        ? world.cells[idx] === Cell.LIFT
        : world.features[idx] === Feature.LIFT_BUTTON;
      if (!matches) continue;
      const anchor = bestAdjacentAnchor(world, x, y, preferredX, preferredY)
        ?? (source === 'button' ? anchorForPassableCell(world, x, y, x, y) : null);
      if (!anchor) continue;
      const score = finiteCoord(preferredX) && finiteCoord(preferredY)
        ? world.dist2(anchor.x, anchor.y, preferredX, preferredY)
        : world.dist2(anchor.x, anchor.y, cx, cy);
      if (score < bestScore) {
        best = anchor;
        bestScore = score;
      }
    }
  }
  return best;
}

function scanPreferredAnchors(
  world: World,
  preferredX: number | undefined,
  preferredY: number | undefined,
  source: 'lift' | 'button',
): Anchor | null {
  if (!finiteCoord(preferredX) || !finiteCoord(preferredY)) return null;
  for (const radius of [8, 16, 32]) {
    const anchor = scanLocalSourceAnchors(world, preferredX, preferredY, radius, source, preferredX, preferredY);
    if (anchor) return anchor;
  }
  return null;
}

function collectSourceAnchor(
  world: World,
  x: number,
  y: number,
  liftAnchors: Anchor[],
  buttonAnchors: Anchor[],
): void {
  const idx = world.idx(x, y);
  if (world.cells[idx] === Cell.LIFT) {
    addUniqueAnchor(liftAnchors, bestAdjacentAnchor(world, x, y));
  }
  if (world.features[idx] === Feature.LIFT_BUTTON) {
    addUniqueAnchor(buttonAnchors, bestAdjacentAnchor(world, x, y) ?? anchorForPassableCell(world, x, y, x, y));
  }
}

function collectRoomAnchors(world: World, liftAnchors: Anchor[], buttonAnchors: Anchor[]): void {
  let scanned = 0;
  const roomCount = world.rooms.length;
  const start = roomCount > 0 ? hash32(roomCount, world.cellVersion, world.featureVersion) % roomCount : 0;
  for (let offset = 0; offset < roomCount; offset++) {
    const room = world.rooms[(start + offset) % roomCount];
    if (!room) continue;
    for (let y = room.y - 1; y <= room.y + room.h; y++) {
      for (let x = room.x - 1; x <= room.x + room.w; x++) {
        collectSourceAnchor(world, x, y, liftAnchors, buttonAnchors);
        scanned++;
        if (scanned >= MAX_ROOM_ANCHOR_SCAN_CELLS) return;
      }
    }
  }
}

function collectZoneAnchors(world: World, liftAnchors: Anchor[], buttonAnchors: Anchor[]): void {
  for (const zone of world.zones) {
    if (!zone?.hasLift) continue;
    addUniqueAnchor(liftAnchors, scanLocalSourceAnchors(world, zone.cx, zone.cy, 32, 'lift'));
    addUniqueAnchor(buttonAnchors, scanLocalSourceAnchors(world, zone.cx, zone.cy, 32, 'button'));
  }
}

function collectSampledAnchors(world: World, liftAnchors: Anchor[], buttonAnchors: Anchor[]): void {
  const total = W * W;
  const step = 9973;
  for (let attempt = 0; attempt < MAX_SAMPLED_ANCHOR_SCAN_CELLS; attempt++) {
    const idx = (attempt * step) % total;
    collectSourceAnchor(world, idx % W, (idx / W) | 0, liftAnchors, buttonAnchors);
  }
}

function getAnchorCache(world: World): AnchorCache {
  const cached = anchorCache.get(world);
  if (
    cached &&
    cached.cellVersion === world.cellVersion &&
    cached.featureVersion === world.featureVersion
  ) {
    return cached;
  }
  const next: AnchorCache = {
    cellVersion: world.cellVersion,
    featureVersion: world.featureVersion,
    liftAnchors: [],
    buttonAnchors: [],
  };
  collectZoneAnchors(world, next.liftAnchors, next.buttonAnchors);
  collectRoomAnchors(world, next.liftAnchors, next.buttonAnchors);
  if (next.liftAnchors.length === 0 && next.buttonAnchors.length === 0) {
    collectSampledAnchors(world, next.liftAnchors, next.buttonAnchors);
  }
  anchorCache.set(world, next);
  return next;
}

function nearestAnchor(world: World, anchors: readonly Anchor[], preferredX?: number, preferredY?: number, salt = 0): Anchor | null {
  if (anchors.length === 0) return null;
  if (!finiteCoord(preferredX) || !finiteCoord(preferredY)) {
    return anchors[hash32(anchors.length, salt, world.cellVersion ^ world.featureVersion) % anchors.length];
  }
  let best = anchors[0];
  let bestScore = world.dist2(best.x, best.y, preferredX, preferredY);
  for (let i = 1; i < anchors.length; i++) {
    const anchor = anchors[i];
    const score = world.dist2(anchor.x, anchor.y, preferredX, preferredY);
    if (score < bestScore) {
      best = anchor;
      bestScore = score;
    }
  }
  return best;
}

function findLiftOrButtonAnchor(world: World, preferredX?: number, preferredY?: number, salt = 0): Anchor | null {
  const localLift = scanPreferredAnchors(world, preferredX, preferredY, 'lift');
  if (localLift) return localLift;
  const localButton = scanPreferredAnchors(world, preferredX, preferredY, 'button');
  if (localButton) return localButton;
  const cached = getAnchorCache(world);
  return nearestAnchor(world, cached.liftAnchors, preferredX, preferredY, salt)
    ?? nearestAnchor(world, cached.buttonAnchors, preferredX, preferredY, salt);
}

function fallbackPreferredAnchor(world: World, preferredX?: number, preferredY?: number): Anchor | null {
  if (!finiteCoord(preferredX) || !finiteCoord(preferredY)) return null;
  const ix = Math.floor(preferredX);
  const iy = Math.floor(preferredY);
  for (const radius of [0, 2, 4, 8, 16, 32]) {
    let best: Anchor | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (radius > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = world.wrap(ix + dx);
        const y = world.wrap(iy + dy);
        const anchor = anchorForPassableCell(world, x, y, x, y);
        if (!anchor) continue;
        const score = world.dist2(anchor.x, anchor.y, preferredX, preferredY);
        if (score < bestScore) {
          best = anchor;
          bestScore = score;
        }
      }
    }
    if (best) return best;
  }
  return null;
}

export function findAlifeArrivalAnchor(world: World, preferredX?: number, preferredY?: number, salt = 0): { x: number; y: number; angle?: number } | null {
  return findLiftOrButtonAnchor(world, preferredX, preferredY, salt)
    ?? fallbackPreferredAnchor(world, preferredX, preferredY);
}

function delayedArrival(arrival: AlifeArrival): AlifeArrival {
  return { ...arrival, tries: Math.max(0, Math.floor(arrival.tries ?? 0)) + 1 };
}

function normalArrivalBlockedBySamosbor(state: GameState, arrival: AlifeArrival): boolean {
  return state.samosborActive && arrival.reason !== 'samosbor' && arrival.reason !== 'refugee';
}

function publishActiveMigrationEvent(
  state: GameState,
  kind: 'arrival' | 'departure' | 'arrival_failed',
  item: AlifeArrival | ActiveAlifeDeparture,
  entity: Entity | undefined,
  data: Record<string, unknown>,
): void {
  publishEvent(state, {
    type: 'alife_migration',
    severity: kind === 'arrival_failed' ? 2 : 3,
    privacy: 'local',
    actorId: entity?.id,
    actorName: entity?.name,
    actorFaction: entity?.faction,
    targetId: entity?.id,
    targetName: entity?.name ?? `alife:${item.alifeId}`,
    x: entity?.x,
    y: entity?.y,
    tags: uniqueTags(['alife_migration', kind, item.reason, item.intentId], 8) as string[],
    data,
  });
}

export function enqueueAlifeArrival(state: GameState, arrival: AlifeArrival): boolean {
  const mobility = ensureAlifeMobilityState(state);
  if (mobility.pendingArrivals.length >= MAX_ALIFE_PENDING_ARRIVALS) return false;
  const clean = cleanArrival(arrival);
  if (!clean) return false;
  if (mobility.pendingArrivals.some(item =>
    item.alifeId === clean.alifeId &&
    item.toFloorKey === clean.toFloorKey &&
    item.intentId === clean.intentId
  )) {
    return false;
  }
  mobility.pendingArrivals.push(clean);
  return true;
}

export function processAlifePendingArrivals(
  state: GameState,
  world: World,
  entities: Entity[],
  nextId: { v: number },
  opts: { maxArrivals?: number; activeFloorKey?: string } = {},
): number {
  const mobility = ensureAlifeMobilityState(state);
  if (mobility.pendingArrivals.length === 0) return 0;
  const activeFloorKey = cleanFloorKey(opts.activeFloorKey) || currentAlifeFloorKey(state);
  const maxArrivals = Math.max(0, Math.floor(opts.maxArrivals ?? 2));
  let attempted = 0;
  let materialized = 0;
  const kept: AlifeArrival[] = [];

  for (const arrival of mobility.pendingArrivals) {
    if (arrival.toFloorKey !== activeFloorKey || attempted >= maxArrivals) {
      kept.push(arrival);
      continue;
    }
    attempted++;
    let delayed: AlifeArrival | null = null;
    if (
      normalArrivalBlockedBySamosbor(state, arrival) ||
      !currentFloorRunAllowsNpcs(state) ||
      !canSpawnEntityType(entities, EntityType.NPC)
    ) {
      delayed = delayedArrival(arrival);
    } else {
      const anchor = finiteCoord(arrival.preferredX) && finiteCoord(arrival.preferredY)
        ? findAlifeArrivalAnchor(world, arrival.preferredX, arrival.preferredY, arrival.alifeId)
        : findLiftOrButtonAnchor(world, undefined, undefined, arrival.alifeId);
      if (!anchor) {
        delayed = delayedArrival(arrival);
      } else {
        const entity = materializeAlifeArrival(state, world, entities, nextId, arrival.alifeId, {
          x: anchor.x,
          y: anchor.y,
          angle: anchor.angle,
        }, activeFloorKey);
        if (entity) {
          materialized++;
          publishActiveMigrationEvent(state, 'arrival', arrival, entity, {
            fromFloorKey: arrival.fromFloorKey,
            floorKey: activeFloorKey,
            alifeId: arrival.alifeId,
            intentId: arrival.intentId,
            reason: arrival.reason,
            journeyId: arrival.journeyId,
          });
        } else {
          delayed = delayedArrival(arrival);
        }
      }
    }

    if (!delayed) continue;
    if ((delayed.tries ?? 0) >= MAX_ACTIVE_ARRIVAL_TRIES) {
      publishActiveMigrationEvent(state, 'arrival_failed', delayed, undefined, {
        fromFloorKey: delayed.fromFloorKey,
        floorKey: activeFloorKey,
        alifeId: delayed.alifeId,
        intentId: delayed.intentId,
        reason: delayed.reason,
        journeyId: delayed.journeyId,
        tries: delayed.tries,
      });
      continue;
    }
    kept.push(delayed);
  }

  mobility.pendingArrivals = kept;
  return materialized;
}

function canStartDeparture(state: GameState, entity: Entity, reason: AlifeMigrationReason): boolean {
  if (!entity.alive || entity.type !== EntityType.NPC || entity.alifeId === undefined) return false;
  if (isPlayerEntity(entity) || isNativePlayerBodyEntity(entity) || entity.persistentNpcId === 'player') return false;
  if (entity.plotNpcId) return false;
  if (entity.questId !== undefined && entity.questId !== -1) return false;
  if (entity.canGiveQuest === true) return false;
  if (state.showNpcMenu && state.npcMenuTarget === entity.id) return false;
  if (entity.ai?.combatTargetId !== undefined && reason !== 'samosbor' && reason !== 'refugee') return false;
  return currentFloorRunAllowsNpcs(state);
}

function assignActiveDepartureGoal(world: World, entity: Entity, anchorX: number, anchorY: number, force = false): boolean {
  const tx = anchorX;
  const ty = anchorY;
  const ai = entity.ai;
  if (!force && ai && ai.tx === tx && ai.ty === ty && (ai.path.length > ai.pi || world.dist2(entity.x, entity.y, anchorX, anchorY) <= DEPARTURE_REACHED_DIST2)) {
    entity.isTraveler = true;
    ai.goal = AIGoal.GOTO;
    ai.timer = Math.max(ai.timer, 0.75);
    return true;
  }
  const previousTraveler = entity.isTraveler;
  const previousAi = entity.ai
    ? { ...entity.ai, path: [...entity.ai.path] }
    : undefined;
  entity.isTraveler = true;
  entity.ai = entity.ai ?? { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 };
  entity.ai.goal = AIGoal.GOTO;
  entity.ai.tx = tx;
  entity.ai.ty = ty;
  entity.ai.path = [];
  entity.ai.pi = 0;
  entity.ai.stuck = 0;
  entity.ai.timer = 0.75;
  const status = tryAssignPathToCell(world, entity, entity.ai.tx, entity.ai.ty);
  entity.ai.goal = AIGoal.GOTO;
  entity.ai.timer = Math.max(entity.ai.timer, 0.75);
  if (status !== 'not_found') return true;
  entity.isTraveler = previousTraveler;
  if (previousAi) entity.ai = previousAi;
  else delete entity.ai;
  return false;
}

export function startActiveAlifeDeparture(
  state: GameState,
  world: World,
  entity: Entity,
  toFloorKey: string,
  intentId: string,
  reason: AlifeMigrationReason,
): boolean {
  if (!canStartDeparture(state, entity, reason)) return false;
  const alifeId = entity.alifeId;
  if (alifeId === undefined) return false;
  const mobility = ensureAlifeMobilityState(state);
  if (mobility.activeDepartures.length >= MAX_ACTIVE_ALIFE_DEPARTURES) return false;
  if (mobility.activeDepartures.some(item => item.entityId === entity.id || item.alifeId === alifeId)) return false;
  const anchor = findLiftOrButtonAnchor(world, entity.x, entity.y);
  const cleanTarget = cleanFloorKey(toFloorKey);
  if (!anchor || !cleanTarget) return false;
  if (!assignActiveDepartureGoal(world, entity, anchor.x, anchor.y, true)) return false;

  mobility.activeDepartures.push({
    entityId: entity.id,
    alifeId,
    toFloorKey: cleanTarget,
    intentId: cleanActiveId(intentId, 'departure'),
    reason,
    startedAt: state.time,
    anchorX: anchor.x,
    anchorY: anchor.y,
  });
  return true;
}

export function updateActiveAlifeDepartures(
  state: GameState,
  world: World,
  entities: Entity[],
  _dt: number,
): number {
  const mobility = ensureAlifeMobilityState(state);
  if (mobility.activeDepartures.length === 0) return 0;
  let processed = 0;
  let completed = 0;
  const deferred: ActiveAlifeDeparture[] = [];
  const rotated: ActiveAlifeDeparture[] = [];

  for (const departure of mobility.activeDepartures) {
    if (processed >= MAX_ACTIVE_DEPARTURE_UPDATES) {
      deferred.push(departure);
      continue;
    }
    processed++;
    const entityIndex = entities.findIndex(entity => entity.id === departure.entityId);
    const entity = entityIndex >= 0 ? entities[entityIndex] : undefined;
    if (!entity || !entity.alive || entity.alifeId !== departure.alifeId) continue;

    if (!assignActiveDepartureGoal(world, entity, departure.anchorX, departure.anchorY)) {
      rotated.push(departure);
      continue;
    }

    if (world.dist2(entity.x, entity.y, departure.anchorX, departure.anchorY) > DEPARTURE_REACHED_DIST2) {
      rotated.push(departure);
      continue;
    }

    captureAlifeFloorState(state, [entity]);
    if (!moveAlifeNpcRecord(state, departure.alifeId, departure.toFloorKey)) {
      rotated.push(departure);
      continue;
    }
    entities.splice(entityIndex, 1);
    completed++;
    publishActiveMigrationEvent(state, 'departure', departure, entity, {
      floorKey: currentAlifeFloorKey(state),
      toFloorKey: departure.toFloorKey,
      alifeId: departure.alifeId,
      intentId: departure.intentId,
      reason: departure.reason,
      startedAt: departure.startedAt,
    });
  }

  mobility.activeDepartures = [...deferred, ...rotated];
  return completed;
}

function normalizedMaxRecords(force: boolean | undefined, input: number | undefined): number {
  const cap = force ? ALIFE_MIGRATION_FORCE_RECORD_CAP : ALIFE_MIGRATION_RECORDS_PER_TICK;
  return Math.max(1, Math.min(cap, Math.floor(input ?? ALIFE_MIGRATION_RECORDS_PER_TICK)));
}

export function tickAlifeMigration(
  state: GameState,
  dt: number,
  opts: { force?: boolean; maxRecords?: number; activeFloorKey?: string } = {},
): number {
  const mobility = ensureAlifeMobilityState(state);
  if (!opts.force) {
    mobility.tickAccum += Math.max(0, dt);
    if (mobility.tickAccum < ALIFE_MIGRATION_TICK_SECONDS) return 0;
    mobility.tickAccum %= ALIFE_MIGRATION_TICK_SECONDS;
  }

  const maxRecords = normalizedMaxRecords(opts.force, opts.maxRecords);
  const activeFloorKey = opts.activeFloorKey ?? currentAlifeFloorKey(state);
  const eventBudget = { remaining: 3 };
  const context = routeContext(state);
  const due = processDueJourneys(state, mobility, activeFloorKey, maxRecords, eventBudget);
  let processed = due.processed;
  let journeysStarted = 0;
  const total = alifeNpcRecordCount(state);
  const inJourney = journeyAlifeIds(mobility);

  if (!opts.force && processed < maxRecords && total > 0) {
    const priority = processTravelerPriorityRecords(
      state,
      mobility,
      activeFloorKey,
      maxRecords - processed,
      inJourney,
      context,
      eventBudget,
    );
    processed += priority.processed;
    journeysStarted += priority.journeysStarted;
  }

  if (processed < maxRecords && total > 0) {
    const slice = forEachAlifeNpcRecordSlice(state, mobility.cursor, maxRecords - processed, (record, cursor) => {
      processed++;
      if (tryStartColdJourneyForRecord(state, mobility, record, cursor, activeFloorKey, inJourney, context, eventBudget)) {
        journeysStarted++;
      }
    });
    mobility.cursor = slice.nextCursor;
  }

  mobility.lastSummary = {
    processed,
    journeysStarted,
    journeysArrived: due.arrived,
    pendingArrivals: mobility.pendingArrivals.length,
    eventsPublished: 3 - eventBudget.remaining,
    cursor: mobility.cursor,
    lastTickAt: state.time,
  };
  return processed;
}

export function summarizeAlifeMigration(state: GameState, limit = 8): string[] {
  const mobility = ensureAlifeMobilityState(state);
  const summary = mobility.lastSummary;
  const out = [
    `mobility cursor=${mobility.cursor} tick=${Math.round(mobility.tickAccum * 10) / 10}s journeys=${Object.keys(mobility.journeys).length}/${MAX_ALIFE_JOURNEYS} arrivals=${mobility.pendingArrivals.length}/${MAX_ALIFE_PENDING_ARRIVALS}`,
  ];
  if (summary) {
    out.push(`last processed=${summary.processed} started=${summary.journeysStarted} arrived=${summary.journeysArrived} events=${summary.eventsPublished}`);
  }
  for (const journey of Object.values(mobility.journeys).slice(0, Math.max(0, Math.min(32, limit)))) {
    out.push(`${journey.id} alife:${journey.alifeId} ${journey.fromFloorKey}->${journey.toFloorKey} eta=${Math.round(journey.etaAt)} ${journey.intentId}`);
  }
  return out;
}
