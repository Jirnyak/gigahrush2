/* ── Per-run vertical procedural floor route ─────────────────── */

import { FloorLevel, LiftDirection, MonsterKind, type GameState } from '../core/types';
import {
  FLOOR_ANOMALIES,
  FLOOR_GEOMETRIES,
  FLOOR_MAJORITY_FACTIONS,
  FLOOR_RUN_MAX_Z,
  FLOOR_RUN_MIN_Z,
  FLOOR_RUN_VOID_Z,
  PROCEDURAL_FLOOR_COUNT,
  PROCEDURAL_FLOOR_ZS,
  anomalyById,
  floorRunZAllowsNpcs,
  geometryById,
  majorityById,
  type FloorAnomalyId,
  type FloorGeometryId,
  type FloorMajorityId,
  type ProceduralFloorSpec,
  isProceduralFloorZ,
  makeProceduralFloorSpec,
  proceduralFloorKey,
  storyFloorAtZ,
  zForStoryFloor,
} from '../data/procedural_floors';
import {
  DESIGN_FLOOR_ROUTES,
  designFloorAtZ,
  designFloorById,
  type DesignFloorId,
} from '../data/design_floors';
import {
  floorKeyForDesign,
  floorKeyForEntry,
  floorKeyForProcedural,
  floorKeyForStory,
  floorKeyZ,
} from './floor_keys';
import {
  routeDirectionBlockedByClosedGate,
  routeGateDirectionIsClosed,
} from './route_gates';
import { portalBlocksDesignFloor } from './platform_bridge';

export interface FloorRunState {
  runSeed: number;
  currentZ: number;
  specs: Record<string, ProceduralFloorSpec>;
  visited: Record<string, boolean>;
  // Floors the player has personally unlocked for fast-elevator travel. A floor
  // is added when the player opens a fast elevator standing on it. Saved per run.
  unlockedZs: number[];
}

export interface FloorRunEntry {
  z: number;
  baseFloor: FloorLevel;
  storyFloor?: FloorLevel;
  designFloorId?: DesignFloorId;
  spec?: ProceduralFloorSpec;
  procedural: boolean;
  label: string;
  color: string;
}

export interface FloorRunEntrySnapshot {
  key: string;
  z: number;
  baseFloor: FloorLevel;
  storyFloor?: FloorLevel;
  designFloorId?: DesignFloorId;
  spec?: ProceduralFloorSpec;
  procedural: boolean;
}

type FloorRunHost = GameState & { floorRun?: FloorRunState };
const normalizedFloorRuns = new WeakSet<FloorRunState>();

const STORY_NAMES: Record<FloorLevel, string> = {
  [FloorLevel.MINISTRY]: 'Министерство',
  [FloorLevel.KVARTIRY]: 'Квартиры',
  [FloorLevel.LIVING]: 'Жилая зона',
  [FloorLevel.MAINTENANCE]: 'Коллекторы',
  [FloorLevel.HELL]: 'Мясной низ',
  [FloorLevel.VOID]: 'Пустота',
};

const STORY_ROUTE_IDS: Record<FloorLevel, string> = {
  [FloorLevel.MINISTRY]: floorKeyForStory(FloorLevel.MINISTRY),
  [FloorLevel.KVARTIRY]: floorKeyForStory(FloorLevel.KVARTIRY),
  [FloorLevel.LIVING]: floorKeyForStory(FloorLevel.LIVING),
  [FloorLevel.MAINTENANCE]: floorKeyForStory(FloorLevel.MAINTENANCE),
  [FloorLevel.HELL]: floorKeyForStory(FloorLevel.HELL),
  [FloorLevel.VOID]: floorKeyForStory(FloorLevel.VOID),
};

const STORY_ROLES: Record<FloorLevel, string> = {
  [FloorLevel.MINISTRY]: 'документы, пропуска, бюрократия',
  [FloorLevel.KVARTIRY]: 'социальный riot-floor, вода, очереди',
  [FloorLevel.LIVING]: 'домашний hub, подготовка, возврат',
  [FloorLevel.MAINTENANCE]: 'ремонт, давление, тех-лут',
  [FloorLevel.HELL]: 'высокая угроза, мясо, ПСИ',
  [FloorLevel.VOID]: 'финальная аномалия и выход',
};

const STORY_DANGERS: Record<FloorLevel, 1 | 2 | 3 | 4 | 5> = {
  [FloorLevel.MINISTRY]: 3,
  [FloorLevel.KVARTIRY]: 3,
  [FloorLevel.LIVING]: 1,
  [FloorLevel.MAINTENANCE]: 4,
  [FloorLevel.HELL]: 5,
  [FloorLevel.VOID]: 5,
};

const MAX_RUN_SEED = 0x7fffffff;
const MAX_SAVED_TITLE = 96;
const MAX_SAVED_ID = 64;
export const ROUTE_LIFTS_PER_DIRECTION = 16;
export const SAMOSBOR_DURATION_MIN_SEC = 20;
export const SAMOSBOR_DURATION_MAX_SEC = 5 * 60;
export const SAMOSBOR_COOLDOWN_MIN_SEC = 45;
export const SAMOSBOR_COOLDOWN_MAX_SEC = 25 * 60;
const VALID_GEOMETRY_IDS = new Set<FloorGeometryId>(FLOOR_GEOMETRIES.map(def => def.id));
const VALID_MAJORITY_IDS = new Set<FloorMajorityId>(FLOOR_MAJORITY_FACTIONS.map(def => def.id));
const VALID_ANOMALY_IDS = new Set<FloorAnomalyId>(FLOOR_ANOMALIES.map(def => def.id));

function randomRunSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRunSeed(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return randomRunSeed();
  const seed = Math.abs(Math.trunc(value)) % MAX_RUN_SEED;
  return seed;
}

export function normalizeFloorRunSeed(value: unknown): number {
  return normalizeRunSeed(value);
}

function isFloorGeometryId(value: unknown): value is FloorGeometryId {
  return typeof value === 'string' && VALID_GEOMETRY_IDS.has(value as FloorGeometryId);
}

function isFloorMajorityId(value: unknown): value is FloorMajorityId {
  return typeof value === 'string' && VALID_MAJORITY_IDS.has(value as FloorMajorityId);
}

function isFloorAnomalyId(value: unknown): value is FloorAnomalyId {
  return typeof value === 'string' && VALID_ANOMALY_IDS.has(value as FloorAnomalyId);
}

function isMonsterKind(value: unknown): value is MonsterKind {
  return typeof value === 'number' && Number.isInteger(value) && MonsterKind[value] !== undefined;
}

function cleanStringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (out.length >= maxItems) break;
    if (typeof item !== 'string') continue;
    const clean = item.slice(0, MAX_SAVED_ID);
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out;
}

function cleanMonsterKinds(value: unknown, fallback: MonsterKind[]): MonsterKind[] {
  if (!Array.isArray(value)) return fallback;
  const out: MonsterKind[] = [];
  for (const item of value) {
    if (out.length >= 4) break;
    if (isMonsterKind(item) && !out.includes(item)) out.push(item);
  }
  return out.length > 0 ? out : fallback;
}

function createSpecDeck(runSeed: number): Record<string, ProceduralFloorSpec> {
  const specs: Record<string, ProceduralFloorSpec> = {};
  for (const z of PROCEDURAL_FLOOR_ZS) {
    specs[proceduralFloorKey(z)] = makeProceduralFloorSpec(runSeed, z);
  }
  return specs;
}

function normalizeZ(value: unknown, fallbackFloor: FloorLevel): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const z = Math.trunc(value);
    if ((z >= FLOOR_RUN_MIN_Z && z <= FLOOR_RUN_MAX_Z) || z === FLOOR_RUN_VOID_Z) return z;
  }
  return zForStoryFloor(fallbackFloor);
}

function normalizeSpec(input: unknown, runSeed: number, z: number): ProceduralFloorSpec {
  const fallback = makeProceduralFloorSpec(runSeed, z);
  if (!isRecord(input)) return fallback;
  const src = input as Partial<ProceduralFloorSpec>;
  if (src.z !== z) return fallback;
  const geometryId = isFloorGeometryId(src.geometryId) ? src.geometryId : fallback.geometryId;
  const majorityId = isFloorMajorityId(src.majorityId) ? src.majorityId : fallback.majorityId;
  const anomalyId = isFloorAnomalyId(src.anomalyId) ? src.anomalyId : fallback.anomalyId;
  const geometry = FLOOR_GEOMETRIES.find(def => def.id === geometryId);
  const title = typeof src.title === 'string' && src.title.trim()
    ? src.title.trim().slice(0, MAX_SAVED_TITLE)
    : fallback.title;
  const monsterBiasTags = cleanStringArray(src.monsterBiasTags, fallback.monsterBiasTags.length || 5);
  return {
    key: proceduralFloorKey(z),
    z,
    seed: normalizeRunSeed(src.seed ?? fallback.seed),
    ordinal: fallback.ordinal,
    depth: fallback.depth,
    danger: Math.max(1, Math.min(5, Math.round(src.danger ?? fallback.danger))) as 1 | 2 | 3 | 4 | 5,
    geometryId,
    baseFloor: geometry?.baseFloor ?? fallback.baseFloor,
    majorityId,
    anomalyId,
    title,
    lootBiasIds: cleanStringArray(src.lootBiasIds, 5),
    monsterBiasKinds: cleanMonsterKinds(src.monsterBiasKinds, fallback.monsterBiasKinds),
    monsterBiasTags: monsterBiasTags.length > 0 ? monsterBiasTags : fallback.monsterBiasTags,
  };
}

function cloneSpec(spec: ProceduralFloorSpec): ProceduralFloorSpec {
  return {
    ...spec,
    lootBiasIds: [...spec.lootBiasIds],
    monsterBiasKinds: [...spec.monsterBiasKinds],
  };
}

function validVisitedKeys(runSeed: number): Set<string> {
  const keys = new Set<string>(Object.values(STORY_ROUTE_IDS));
  for (const route of DESIGN_FLOOR_ROUTES) {
    if (portalBlocksDesignFloor(route.id)) {
      keys.add(floorKeyForProcedural(proceduralFloorKey(route.z)));
      continue;
    }
    keys.add(floorKeyForDesign(route.id));
  }
  for (const z of PROCEDURAL_FLOOR_ZS) keys.add(floorKeyForProcedural(proceduralFloorKey(z)));
  for (const spec of Object.values(createSpecDeck(runSeed))) keys.add(floorKeyForProcedural(spec.key));
  return keys;
}

function floorRunEntryKey(entry: Pick<FloorRunEntry, 'z' | 'storyFloor' | 'designFloorId' | 'spec'>): string {
  return floorKeyForEntry({
    z: entry.z,
    baseFloor: FloorLevel.LIVING,
    storyFloor: entry.storyFloor,
    designFloorId: entry.designFloorId,
    spec: entry.spec,
  });
}

export function snapshotFloorRunEntry(entry: FloorRunEntry): FloorRunEntrySnapshot {
  return {
    key: floorRunEntryKey(entry),
    z: entry.z,
    baseFloor: entry.baseFloor,
    storyFloor: entry.storyFloor,
    designFloorId: entry.designFloorId,
    spec: entry.spec ? cloneSpec(entry.spec) : undefined,
    procedural: entry.procedural,
  };
}

export function normalizeFloorRunEntrySnapshot(input: unknown): FloorRunEntrySnapshot | undefined {
  if (!isRecord(input)) return undefined;
  const zInput = input.z;
  if (typeof zInput !== 'number' || !Number.isFinite(zInput)) return undefined;
  const z = Math.trunc(zInput);
  if (z < FLOOR_RUN_MIN_Z || z > FLOOR_RUN_MAX_Z) return undefined;

  const storyFloor = storyFloorAtZ(z);
  if (storyFloor !== undefined) {
    return {
      key: floorKeyForStory(storyFloor),
      z,
      baseFloor: storyFloor,
      storyFloor,
      procedural: false,
    };
  }

  const designFloor = designFloorAtZ(z);
  if (designFloor) {
    if (portalBlocksDesignFloor(designFloor.id)) {
      const specInput = input.spec;
      const specSeed = isRecord(specInput) ? specInput.seed : undefined;
      const spec = normalizeSpec(specInput, normalizeRunSeed(specSeed), z);
      return {
        key: floorKeyForProcedural(spec.key),
        z,
        baseFloor: spec.baseFloor,
        spec: cloneSpec(spec),
        procedural: true,
      };
    }
    const savedDesignId = typeof input.designFloorId === 'string' ? input.designFloorId : undefined;
    if (savedDesignId && savedDesignId !== designFloor.id) return undefined;
    return {
      key: floorKeyForDesign(designFloor.id),
      z,
      baseFloor: designFloor.baseFloor,
      designFloorId: designFloor.id,
      procedural: false,
    };
  }

  if (!isProceduralFloorZ(z)) return undefined;
  const specInput = input.spec;
  const specSeed = isRecord(specInput) ? specInput.seed : undefined;
  const spec = normalizeSpec(specInput, normalizeRunSeed(specSeed), z);
  return {
    key: floorKeyForProcedural(spec.key),
    z,
    baseFloor: spec.baseFloor,
    spec: cloneSpec(spec),
    procedural: true,
  };
}

export function createFloorRunState(currentFloor = FloorLevel.LIVING): FloorRunState {
  const runSeed = randomRunSeed();
  const startZ = zForStoryFloor(currentFloor);
  const run: FloorRunState = {
    runSeed,
    currentZ: startZ,
    specs: createSpecDeck(runSeed),
    visited: {},
    unlockedZs: [startZ],
  };
  normalizedFloorRuns.add(run);
  return run;
}

export function normalizeFloorRunState(
  input: Partial<FloorRunState> | null | undefined,
  currentFloor = FloorLevel.LIVING,
): FloorRunState {
  const runSeed = normalizeRunSeed(input?.runSeed);
  const currentZ = normalizeZ(input?.currentZ, currentFloor);
  const out: FloorRunState = {
    runSeed,
    currentZ,
    specs: createSpecDeck(runSeed),
    visited: {},
    unlockedZs: sanitizeUnlockedZs(input?.unlockedZs, currentZ),
  };
  const savedSpecs = input?.specs ?? {};
  for (const z of PROCEDURAL_FLOOR_ZS) {
    const key = proceduralFloorKey(z);
    out.specs[key] = normalizeSpec(savedSpecs[key], runSeed, z);
  }
  const visited = input?.visited ?? {};
  const validVisited = validVisitedKeys(runSeed);
  for (const [key, value] of Object.entries(visited)) {
    if (value && validVisited.has(key)) out.visited[key] = true;
  }
  normalizedFloorRuns.add(out);
  return out;
}

export function floorRunSaveHasRestorableRoute(input: unknown): boolean {
  if (!isRecord(input)) return false;
  const z = input.currentZ;
  return typeof z === 'number' && Number.isFinite(z) && z >= FLOOR_RUN_MIN_Z && z <= FLOOR_RUN_MAX_Z;
}

function sanitizeUnlockedZs(input: unknown, currentZ: number): number[] {
  const set = new Set<number>([currentZ]);
  if (Array.isArray(input)) {
    for (const value of input) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const z = Math.trunc(value);
      if ((z >= FLOOR_RUN_MIN_Z && z <= FLOOR_RUN_MAX_Z) || z === FLOOR_RUN_VOID_Z) set.add(z);
    }
  }
  return [...set].sort((a, b) => b - a);
}

export function isFloorZUnlocked(state: GameState, z: number): boolean {
  return ensureFloorRunState(state).unlockedZs.includes(z);
}

export function unlockFloorZ(state: GameState, z: number): boolean {
  if (z < FLOOR_RUN_MIN_Z || z > FLOOR_RUN_MAX_Z) return false;
  const run = ensureFloorRunState(state);
  if (run.unlockedZs.includes(z)) return false;
  run.unlockedZs.push(z);
  run.unlockedZs.sort((a, b) => b - a);
  return true;
}

export function unlockedFloorZs(state: GameState): readonly number[] {
  return ensureFloorRunState(state).unlockedZs;
}

export function ensureFloorRunState(state: GameState, currentFloor = state.currentFloor): FloorRunState {
  const host = state as FloorRunHost;
  if (host.floorRun && normalizedFloorRuns.has(host.floorRun)) return host.floorRun;
  host.floorRun = normalizeFloorRunState(host.floorRun, currentFloor);
  return host.floorRun;
}

export function setFloorRunState(
  state: GameState,
  input: Partial<FloorRunState> | null | undefined,
  currentFloor = state.currentFloor,
): FloorRunState {
  const normalized = normalizeFloorRunState(input, currentFloor);
  (state as FloorRunHost).floorRun = normalized;
  return normalized;
}

export function floorRunStateForSave(state: GameState): FloorRunState {
  return normalizeFloorRunState((state as FloorRunHost).floorRun, state.currentFloor);
}

function entryForZ(state: GameState, z: number): FloorRunEntry | null {
  const storyFloor = storyFloorAtZ(z);
  if (storyFloor !== undefined) {
    return {
      z,
      baseFloor: storyFloor,
      storyFloor,
      procedural: false,
      label: STORY_NAMES[storyFloor],
      color: storyFloor === FloorLevel.HELL ? '#f44' : storyFloor === FloorLevel.VOID ? '#0f8' : '#4af',
    };
  }
  const designFloor = designFloorAtZ(z);
  if (designFloor) {
    if (portalBlocksDesignFloor(designFloor.id)) {
      const run = ensureFloorRunState(state);
      const spec = run.specs[proceduralFloorKey(z)] ?? makeProceduralFloorSpec(run.runSeed, z);
      run.specs[spec.key] = spec;
      return {
        z,
        baseFloor: spec.baseFloor,
        spec,
        procedural: true,
        label: `Этаж ${formatFloorZ(z)}: ${spec.title}`,
        color: spec.anomalyId === 'none' ? '#8cf' : '#c8f',
      };
    }
    return {
      z,
      baseFloor: designFloor.baseFloor,
      designFloorId: designFloor.id,
      procedural: false,
      label: `Этаж ${formatFloorZ(z)}: ${designFloor.displayName}`,
      color: designFloor.color,
    };
  }
  if (!isProceduralFloorZ(z)) return null;
  const run = ensureFloorRunState(state);
  const spec = run.specs[proceduralFloorKey(z)] ?? makeProceduralFloorSpec(run.runSeed, z);
  run.specs[spec.key] = spec;
  return {
    z,
    baseFloor: spec.baseFloor,
    spec,
    procedural: true,
    label: `Этаж ${formatFloorZ(z)}: ${spec.title}`,
    color: spec.anomalyId === 'none' ? '#8cf' : '#c8f',
  };
}

export function floorRunEntryForZ(state: GameState, z: number): FloorRunEntry | null {
  return entryForZ(state, z);
}

export function floorRunEntryForDesignFloor(state: GameState, designFloorId: DesignFloorId): FloorRunEntry | null {
  const designFloor = designFloorById(designFloorId);
  return designFloor ? entryForZ(state, designFloor.z) : null;
}

export function floorRunEntryForFloorKey(state: GameState, floorKey: string): FloorRunEntry | null {
  const run = ensureFloorRunState(state);
  const z = floorKeyZ(floorKey, { proceduralSpecs: run.specs });
  return z === undefined ? null : entryForZ(state, z);
}

export function currentFloorRunEntry(state: GameState): FloorRunEntry {
  const run = ensureFloorRunState(state);
  return entryForZ(state, run.currentZ) ?? {
    z: zForStoryFloor(state.currentFloor),
    baseFloor: state.currentFloor,
    storyFloor: state.currentFloor,
    procedural: false,
    label: STORY_NAMES[state.currentFloor],
    color: '#4af',
  };
}

export function resolveFloorRunRoute(state: GameState, direction: LiftDirection): FloorRunEntry | null {
  const run = ensureFloorRunState(state);
  const current = entryForZ(state, run.currentZ);
  if (current && routeDirectionBlockedByClosedGate(floorRunEntryFloorKey(current), direction, state)) return null;
  const dz = direction === LiftDirection.DOWN ? -1 : 1;
  const targetZ = run.currentZ + dz;
  if (targetZ < FLOOR_RUN_MIN_Z || targetZ > FLOOR_RUN_MAX_Z) return null;
  return entryForZ(state, targetZ);
}

export function commitFloorRunEntry(state: GameState, entry: FloorRunEntry): void {
  const run = ensureFloorRunState(state);
  run.currentZ = entry.z;
  run.visited[floorRunEntryFloorKey(entry)] = true;
}

export function floorRunEntryFromSnapshot(state: GameState, input: unknown): FloorRunEntry | null {
  const snapshot = normalizeFloorRunEntrySnapshot(input);
  if (!snapshot) return null;
  if (snapshot.spec) {
    const run = ensureFloorRunState(state, snapshot.baseFloor);
    run.specs[snapshot.spec.key] = cloneSpec(snapshot.spec);
  }
  return entryForZ(state, snapshot.z);
}

export function commitFloorRunEntrySnapshot(state: GameState, input: unknown): FloorRunEntry | null {
  const entry = floorRunEntryFromSnapshot(state, input);
  if (!entry) return null;
  commitFloorRunEntry(state, entry);
  return entry;
}

export function forceFloorRunStory(state: GameState, floor: FloorLevel): void {
  const run = ensureFloorRunState(state, floor);
  run.currentZ = zForStoryFloor(floor);
}

export function isCurrentProceduralFloor(state: GameState): boolean {
  return currentFloorRunEntry(state).procedural;
}

export function currentProceduralFloorSpec(state: GameState): ProceduralFloorSpec | undefined {
  return currentFloorRunEntry(state).spec;
}

export function isCurrentStoryFloor(state: GameState, floor: FloorLevel): boolean {
  const entry = currentFloorRunEntry(state);
  return !entry.procedural && entry.storyFloor === floor;
}

export function currentFloorRunLabel(state: GameState): string | undefined {
  return floorRunEntryMapLabel(currentFloorRunEntry(state));
}

export function floorRunEntryKindLabel(entry: FloorRunEntry): string {
  if (entry.procedural) return 'вылазка';
  if (entry.designFloorId) return 'ручной маршрут';
  return 'сюжетный якорь';
}

export function floorRunEntryRouteId(entry: FloorRunEntry): string {
  if (entry.designFloorId) return entry.designFloorId;
  if (entry.spec) return entry.spec.key;
  return STORY_ROUTE_IDS[entry.storyFloor ?? entry.baseFloor];
}

export function floorRunEntryFloorKey(entry: FloorRunEntry): string {
  return floorKeyForEntry(entry);
}

export function floorRunEntryDanger(entry: FloorRunEntry): 1 | 2 | 3 | 4 | 5 {
  if (entry.spec) return entry.spec.danger;
  if (entry.designFloorId) return designFloorById(entry.designFloorId)?.danger ?? STORY_DANGERS[entry.baseFloor];
  return STORY_DANGERS[entry.storyFloor ?? entry.baseFloor];
}

export function floorRunEntryRole(entry: FloorRunEntry): string {
  if (entry.spec) {
    const geometry = geometryById(entry.spec.geometryId);
    const majority = majorityById(entry.spec.majorityId);
    const anomaly = anomalyById(entry.spec.anomalyId);
    return `${geometry.title}, ${majority.title}, ${anomaly.title}`;
  }
  if (entry.designFloorId) return designFloorById(entry.designFloorId)?.role ?? STORY_ROLES[entry.baseFloor];
  return STORY_ROLES[entry.storyFloor ?? entry.baseFloor];
}

export function floorRunEntryMapLabel(entry: FloorRunEntry): string {
  const z = formatFloorZ(entry.z);
  if (entry.spec) {
    return `Z${z} ${entry.spec.title}`;
  }
  if (entry.designFloorId) {
    const design = designFloorById(entry.designFloorId);
    return `Z${z} ${entry.designFloorId} ${design?.displayName ?? entry.label}`;
  }
  const story = entry.storyFloor ?? entry.baseFloor;
  return `Z${z} ${STORY_ROUTE_IDS[story]} ${STORY_NAMES[story]}`;
}

export function floorRunEntryLiftLabel(entry: FloorRunEntry): string {
  const kind = floorRunEntryKindLabel(entry).toUpperCase();
  const routeId = entry.spec ? '' : ` ${floorRunEntryRouteId(entry)}`;
  const name = entry.designFloorId
    ? designFloorById(entry.designFloorId)?.displayName ?? entry.label
    : entry.storyFloor !== undefined
      ? STORY_NAMES[entry.storyFloor]
      : entry.spec?.title ?? entry.label;
  return `${kind} Z${formatFloorZ(entry.z)}${routeId}: ${name}`;
}

export function floorRunEntryLiftDirections(
  entry: FloorRunEntry,
  openGateIds?: ReadonlySet<string>,
): LiftDirection[] {
  const directions: LiftDirection[] = [];
  if (entry.z > FLOOR_RUN_MIN_Z && !routeGateDirectionIsClosed(floorRunEntryFloorKey(entry), LiftDirection.DOWN, openGateIds)) {
    directions.push(LiftDirection.DOWN);
  }
  if (entry.z < FLOOR_RUN_MAX_Z) directions.push(LiftDirection.UP);
  return directions;
}

export function floorRunEntryRouteCard(entry: FloorRunEntry): string {
  return `${floorRunEntryLiftLabel(entry)}. ${floorRunEntryRole(entry)}.`;
}

export function floorRunLiftPrompt(state: GameState, direction: LiftDirection): string {
  const entry = resolveFloorRunRoute(state, direction);
  if (!entry) return direction === LiftDirection.DOWN ? '↓ маршрута ниже нет' : '↑ маршрута выше нет';
  return `${direction === LiftDirection.DOWN ? '↓' : '↑'} ${floorRunEntryLiftLabel(entry)}`;
}

export function floorRunArrivalLead(entry: FloorRunEntry, returnDirection: LiftDirection): string {
  const back = returnDirection === LiftDirection.DOWN ? '↓' : '↑';
  return `Зацепка: ${floorRunEntryRouteCard(entry)} Возврат: лифт ${back} к предыдущему Z.`;
}

export function floorRunEntryKind(entry: FloorRunEntry): 'story' | 'design' | 'procedural' {
  if (entry.spec) return 'procedural';
  if (entry.designFloorId) return 'design';
  return 'story';
}

export function floorRunEntryAllowsNpcs(entry: FloorRunEntry): boolean {
  return floorRunZAllowsNpcs(entry.z);
}

export function currentFloorRunAllowsNpcs(state: GameState): boolean {
  return floorRunEntryAllowsNpcs(currentFloorRunEntry(state));
}

export function floorRunSamosborDepth01(state: GameState): number {
  const z = currentFloorRunEntry(state).z;
  return Math.max(0, Math.min(1, Math.abs(z) / FLOOR_RUN_MAX_Z));
}

export function nextFloorRunSamosborDuration(state: GameState): number {
  const depth = floorRunSamosborDepth01(state);
  const maxForDepth = SAMOSBOR_DURATION_MIN_SEC +
    (SAMOSBOR_DURATION_MAX_SEC - SAMOSBOR_DURATION_MIN_SEC) * depth;
  return SAMOSBOR_DURATION_MIN_SEC + Math.random() * (maxForDepth - SAMOSBOR_DURATION_MIN_SEC);
}

export function nextFloorRunSamosborCooldown(state: GameState): number {
  const depth = floorRunSamosborDepth01(state);
  const maxForDepth = SAMOSBOR_COOLDOWN_MAX_SEC -
    (SAMOSBOR_COOLDOWN_MAX_SEC - SAMOSBOR_COOLDOWN_MIN_SEC) * depth;
  // Luck-based variance: rare back-to-back or long gap
  const luck = Math.random();
  if (luck < 0.08) {
    // ~8% chance: rapid double-strike, cooldown < 2 min
    return SAMOSBOR_COOLDOWN_MIN_SEC + Math.random() * (120 - SAMOSBOR_COOLDOWN_MIN_SEC);
  }
  if (luck > 0.85) {
    // ~15% chance: long calm, cooldown > 20 min
    return 20 * 60 + Math.random() * (maxForDepth - 20 * 60);
  }
  return SAMOSBOR_COOLDOWN_MIN_SEC + Math.random() * (maxForDepth - SAMOSBOR_COOLDOWN_MIN_SEC);
}

function clampRunDanger(value: number): 1 | 2 | 3 | 4 | 5 {
  return Math.max(1, Math.min(5, Math.round(value))) as 1 | 2 | 3 | 4 | 5;
}

function stripAnomalyPrefix(title: string): string {
  const idx = title.indexOf(': ');
  return idx >= 0 ? title.slice(idx + 2) : title;
}

export function forceProceduralFloorAnomaly(state: GameState, anomalyId: FloorAnomalyId): ProceduralFloorSpec | undefined {
  const run = ensureFloorRunState(state);
  for (const z of PROCEDURAL_FLOOR_ZS) {
    const spec = run.specs[proceduralFloorKey(z)];
    if (spec?.anomalyId === anomalyId) return spec;
  }

  const anomaly = anomalyById(anomalyId);
  const z = PROCEDURAL_FLOOR_ZS.find(candidate => {
    const spec = run.specs[proceduralFloorKey(candidate)];
    return spec && spec.danger >= anomaly.minDanger;
  }) ?? PROCEDURAL_FLOOR_ZS[0];
  if (z === undefined) return undefined;
  const key = proceduralFloorKey(z);
  const spec = run.specs[key] ?? makeProceduralFloorSpec(run.runSeed, z);
  const forced: ProceduralFloorSpec = {
    ...spec,
    anomalyId,
    danger: clampRunDanger(Math.max(spec.danger, anomaly.minDanger) + anomaly.dangerBias),
    title: anomalyId === 'none' ? stripAnomalyPrefix(spec.title) : `${anomaly.title}: ${stripAnomalyPrefix(spec.title)}`,
  };
  run.specs[key] = forced;
  return forced;
}

export function summarizeFloorRun(state: GameState): string[] {
  const run = ensureFloorRunState(state);
  const entry = currentFloorRunEntry(state);
  const visited = Object.keys(run.visited).length;
  const out = [
    `z=${entry.z} seed=${run.runSeed} ${entry.procedural ? 'procedural' : entry.designFloorId ? 'design' : 'story'} ${entry.label}`,
    `visited=${visited}/${PROCEDURAL_FLOOR_COUNT}`,
  ];
  if (entry.spec) {
    out.push(`geom=${entry.spec.geometryId} faction=${entry.spec.majorityId} anomaly=${entry.spec.anomalyId} danger=${entry.spec.danger}`);
    out.push(`loot=${entry.spec.lootBiasIds.join(',') || 'none'} monsters=${entry.spec.monsterBiasKinds.join(',') || 'none'}`);
  }
  const anomalyCounts: Record<string, number> = {};
  for (const spec of Object.values(run.specs)) {
    if (spec.anomalyId === 'none') continue;
    anomalyCounts[spec.anomalyId] = (anomalyCounts[spec.anomalyId] ?? 0) + 1;
  }
  const anomalyLine = Object.entries(anomalyCounts).map(([id, count]) => `${id}=${count}`).join(' ');
  if (anomalyLine) out.push(`anomalies ${anomalyLine}`);
  if (entry.designFloorId) out.push(`route=${entry.designFloorId} base=${FloorLevel[entry.baseFloor]}`);
  return out;
}

export function formatFloorZ(z: number): string {
  return z >= 0 ? `+${z}` : `${z}`;
}
