import { after, test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, ContainerKind, DoorState, EntityType, Faction, Feature, FloorLevel, LiftDirection, MonsterKind, Occupation, QuestType, RoomType, Tex, W, ZoneFaction } from '../src/core/types';
import {
  FALSE_SAFE_BLOCK_ROOM_PREFIX,
  FLOOR_ANOMALIES,
  FLOOR_GEOMETRIES,
  FLOOR_RUN_MAX_Z,
  FLOOR_RUN_MIN_Z,
  FLOOR_RUN_VOID_Z,
  PROCEDURAL_FLOOR_COUNT,
  PROCEDURAL_FLOOR_ZS,
  floorRunProfileZ,
  floorRunZAllowsNpcs,
  makeProceduralFloorSpec,
  type ProceduralFloorSpec,
  storyFloorAtZ,
  zForStoryFloor,
} from '../src/data/procedural_floors';
import { DESIGN_FLOOR_ROUTES } from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import { ACTIVE_ACTOR_SOFT_LIMIT, ENTITY_SOFT_LIMITS } from '../src/data/entity_limits';
import { HUMAN_TERRITORY_OWNERS, territoryOwnerToFaction } from '../src/data/factions';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { SIDE_QUESTS } from '../src/data/plot';
import { PROCEDURAL_POPULATION_PROFILES, proceduralPopulationBudget } from '../src/data/population_profiles';
import { ROUTE_GATE_DEFS } from '../src/data/route_gates';
import { isFloor69FemaleSprite } from '../src/entities/procedural_visuals';
import { NPC_VISUAL_FLOOR69_FEMALE } from '../src/entities/npc_visuals';
import { NPC_VISUAL_WORKER69 } from '../src/data/art_sprite_manifest';
import {
  commitFloorRunEntry,
  currentFloorRunEntry,
  currentFloorRunLabel,
  ensureFloorRunState,
  floorRunEntryForDesignFloor,
  floorRunArrivalLead,
  floorRunEntryFloorKey,
  floorRunEntryKind,
  floorRunEntryLiftDirections,
  floorRunEntryLiftLabel,
  floorRunEntryMapLabel,
  floorRunEntryRouteCard,
  floorRunStateForSave,
  normalizeFloorRunSeed,
  resolveFloorRunRoute,
  setFloorRunState,
} from '../src/systems/procedural_floors';
import {
  floorInstanceStateForSave,
  floorInstanceWorldKey,
  setFloorInstanceState,
} from '../src/systems/floor_instances';
import {
  currentMapEditorFloorKey,
  getMapEditorSnapshot,
  replayMapEditorPatchForCurrentFloor,
  setMapEditorPatchState,
} from '../src/systems/map_editor';
import { currentNetTerminalGenFloorKey } from '../src/systems/net_terminal_gen';
import {
  BAD_APPLE_EXPERIMENT_ENABLED,
  BAD_APPLE_HEIGHT,
  BAD_APPLE_WIDTH,
  findBadAppleSiteNear,
  stampBadAppleWorld,
  tryUseBadAppleWorldAnomaly,
  updateBadAppleWorldAnomaly,
} from '../src/systems/procedural_anomalies/bad_apple_world';
import { getProceduralSmogStatus, updateProceduralAnomalies } from '../src/systems/procedural_anomalies';
import { updateLivingTunnelsAnomaly } from '../src/systems/procedural_anomalies/living_tunnels';
import { tryZombieApocalypseInfection } from '../src/systems/procedural_anomalies/zombie_apocalypse';
import { getRecentEvents } from '../src/systems/events';
import { countTerritoryCells, territoryHqAnchors, territoryOwnerAtIndex } from '../src/systems/territory';
import { questTargetLiftDirection } from '../src/systems/contracts';
import { getObjectiveRouteHud, getRouteCueMarkers, routeCueCount, routeObjectiveLiftPromptSuffix } from '../src/systems/route_cues';
import { getEmergencyPanels } from '../src/systems/emergency_panels';
import { openRouteGateIds } from '../src/systems/route_gates';
import { generateProceduralFloor, measureCollectorDecisionMetrics } from '../src/gen/procedural_floor';
import { getGeometryMetrics, measureAndRecordGeometryMetrics, measureGeometryMetrics } from '../src/gen/geometry_metrics';
import { generateDarknessDesignFloor } from '../src/gen/design_floors/darkness';
import { extractPodadTopologyDescriptor } from '../src/gen/design_floors/podad';
import { measureManhattanCrossroadsDecisionMetrics } from '../src/gen/design_floors/manhattan_crossroads';
import { UPPER_BUREAU_DOCUMENTS } from '../src/gen/design_floors/upper_bureau';
import { designFloorGeneratorIds, generateDesignFloor, validateDesignFloorGenerators } from '../src/gen/design_floors/manifest';
import { validateProceduralAnomalyGenerationRegistry } from '../src/gen/procedural_anomalies';
import { proceduralStructureFamilyForSpec } from '../src/gen/procedural_structure_library';
import { generateFloor } from '../src/gen/floor_manifest';
import { sampleNaturalPopulationCells } from '../src/gen/population_placement';
import {
  World,
  auditReachability,
  describeReachability,
  hasReachableAdjacentCell,
  type ReachabilityAudit,
} from '../src/core/world';
import { printSlowestFloorGenerators, timeFloorGeneration } from './generator_helpers';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

function playableBounds(world: World): { count: number; minX: number; minY: number; maxX: number; maxY: number } {
  const out = { count: 0, minX: W, minY: W, maxX: -1, maxY: -1 };
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const cell = world.cells[world.idx(x, y)];
      if (cell !== Cell.FLOOR && cell !== Cell.WATER && cell !== Cell.DOOR && cell !== Cell.LIFT) continue;
      out.count++;
      if (x < out.minX) out.minX = x;
      if (y < out.minY) out.minY = y;
      if (x > out.maxX) out.maxX = x;
      if (y > out.maxY) out.maxY = y;
    }
  }
  return out;
}

function maxEntitiesInArea(entities: readonly { alive: boolean; type: EntityType; x: number; y: number }[], type: EntityType, areaSize: number): number {
  const side = Math.ceil(W / areaSize);
  const counts = new Int32Array(side * side);
  let max = 0;
  for (const entity of entities) {
    if (!entity.alive || entity.type !== type) continue;
    const bx = Math.min(side - 1, Math.max(0, Math.floor(entity.x / areaSize)));
    const by = Math.min(side - 1, Math.max(0, Math.floor(entity.y / areaSize)));
    const next = ++counts[by * side + bx];
    if (next > max) max = next;
  }
  return max;
}

function countNear(entities: readonly { alive: boolean; x: number; y: number }[], x: number, y: number, radius: number): number {
  const r2 = radius * radius;
  let count = 0;
  for (const entity of entities) {
    if (!entity.alive) continue;
    const dx = entity.x - x;
    const dy = entity.y - y;
    if (dx * dx + dy * dy <= r2) count++;
  }
  return count;
}

const ORTHO_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

function walkableWithDoorKeys(world: World, idx: number, keys: ReadonlySet<string>): boolean {
  const cell = world.cells[idx];
  if (cell === Cell.FLOOR || cell === Cell.WATER) return true;
  if (cell !== Cell.DOOR) return false;
  const door = world.doors.get(idx);
  if (!door) return false;
  if (door.state === DoorState.OPEN || door.state === DoorState.CLOSED || door.state === DoorState.HERMETIC_OPEN) return true;
  if (door.state === DoorState.LOCKED) return keys.has(door.keyId || 'key');
  return false;
}

function reachableWithDoorKeys(gen: ReturnType<typeof generateDesignFloor>, keyIds: readonly string[]): Uint8Array {
  const keys = new Set(keyIds);
  const world = gen.world;
  const out = new Uint8Array(W * W);
  const queue = new Int32Array(W * W);
  const start = world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY));
  if (!walkableWithDoorKeys(world, start, keys)) return out;

  let head = 0;
  let tail = 0;
  out[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const ci = queue[head++];
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const [dx, dy] of ORTHO_DIRS) {
      const ni = world.idx(x + dx, y + dy);
      if (out[ni] || !walkableWithDoorKeys(world, ni, keys)) continue;
      out[ni] = 1;
      queue[tail++] = ni;
    }
  }
  return out;
}

function countReachableCells(reachable: Uint8Array): number {
  let count = 0;
  for (const value of reachable) count += value;
  return count;
}

function territoryCellCount(world: World, owner: ZoneFaction): number {
  return countTerritoryCells(world).find(row => row.owner === owner)?.cells ?? 0;
}

function assertTerritoryShare(world: World, owner: ZoneFaction, min: number, max: number): void {
  const share = territoryCellCount(world, owner) / (W * W);
  assert.equal(share >= min && share <= max, true, `${ZoneFaction[owner]} share ${share.toFixed(3)} expected ${min}..${max}`);
}

function reachableBucketCount(world: World, reachable: Uint8Array, bucketSize: number): number {
  const side = Math.ceil(W / bucketSize);
  const buckets = new Uint8Array(side * side);
  let count = 0;
  for (let i = 0; i < world.cells.length; i++) {
    if (!reachable[i]) continue;
    const cell = world.cells[i];
    if (cell !== Cell.FLOOR && cell !== Cell.WATER && cell !== Cell.DOOR && cell !== Cell.LIFT) continue;
    const x = i % W;
    const y = (i / W) | 0;
    const bi = Math.min(side - 1, Math.floor(y / bucketSize)) * side + Math.min(side - 1, Math.floor(x / bucketSize));
    if (!buckets[bi]) {
      buckets[bi] = 1;
      count++;
    }
  }
  return count;
}

function reachableRoomCellCount(gen: ReturnType<typeof generateDesignFloor>, reachable: Uint8Array, roomName: string): number {
  const room = gen.world.rooms.find(candidate => candidate.name === roomName);
  if (!room) return 0;
  let count = 0;
  for (let i = 0; i < gen.world.cells.length; i++) {
    if (gen.world.roomMap[i] === room.id && reachable[i]) count++;
  }
  return count;
}

function hasReachableLiftWithDoorKeys(gen: ReturnType<typeof generateDesignFloor>, reachable: Uint8Array, direction: LiftDirection): boolean {
  const world = gen.world;
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of ORTHO_DIRS) {
      if (reachable[world.idx(x + dx, y + dy)]) return true;
    }
  }
  return false;
}

function reachableRoomCount(gen: ReturnType<typeof generateDesignFloor>, roomNames: readonly string[]): number {
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  let count = 0;
  for (const name of roomNames) {
    const room = gen.world.rooms.find(candidate => candidate.name === name);
    if (!room) continue;
    let reachable = false;
    for (let i = 0; i < gen.world.cells.length; i++) {
      if (gen.world.roomMap[i] === room.id && audit.reachable[i]) {
        reachable = true;
        break;
      }
    }
    if (reachable) count++;
  }
  return count;
}

function assertFullFootprint(world: World, label: string): void {
  const bounds = playableBounds(world);
  assert.equal(bounds.minX, 0, `${label} minX`);
  assert.equal(bounds.minY, 0, `${label} minY`);
  assert.equal(bounds.maxX, W - 1, `${label} maxX`);
  assert.equal(bounds.maxY, W - 1, `${label} maxY`);
  assert.equal(bounds.count >= 18_000, true, `${label} playable cells`);
}

function reachabilityAudit(gen: ReturnType<typeof generateProceduralFloor>): ReachabilityAudit {
  const world = gen.world;
  const start = world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY));
  return auditReachability(world, start);
}

function hasReachableLift(gen: ReturnType<typeof generateProceduralFloor>, audit: ReachabilityAudit, direction: LiftDirection): boolean {
  const world = gen.world;
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    if (hasReachableAdjacentCell(world, audit, i)) return true;
  }
  return false;
}

function reachableProceduralCellsWithDoorKeys(gen: ReturnType<typeof generateProceduralFloor>, keyIds: readonly string[]): Uint8Array {
  const keys = new Set(keyIds);
  const world = gen.world;
  const out = new Uint8Array(W * W);
  const queue = new Int32Array(W * W);
  const start = world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY));
  if (!walkableWithDoorKeys(world, start, keys)) return out;

  let head = 0;
  let tail = 0;
  out[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const ci = queue[head++];
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const [dx, dy] of ORTHO_DIRS) {
      const ni = world.idx(x + dx, y + dy);
      if (out[ni] || !walkableWithDoorKeys(world, ni, keys)) continue;
      out[ni] = 1;
      queue[tail++] = ni;
    }
  }
  return out;
}

function hasReachableLiftFromMask(world: World, reachable: Uint8Array, direction: LiftDirection): boolean {
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of ORTHO_DIRS) {
      if (reachable[world.idx(x + dx, y + dy)]) return true;
    }
  }
  return false;
}

function dryReachableFromSpawn(gen: ReturnType<typeof generateProceduralFloor>): Uint8Array {
  const world = gen.world;
  const out = new Uint8Array(W * W);
  const queue = new Int32Array(W * W);
  const start = world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY));
  const startCell = world.cells[start];
  if (startCell !== Cell.FLOOR && startCell !== Cell.DOOR) return out;
  let head = 0;
  let tail = 0;
  out[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const ci = queue[head++];
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const [dx, dy] of ORTHO_DIRS) {
      const ni = world.idx(x + dx, y + dy);
      if (out[ni]) continue;
      const cell = world.cells[ni];
      if (cell !== Cell.FLOOR && cell !== Cell.DOOR) continue;
      out[ni] = 1;
      queue[tail++] = ni;
    }
  }
  return out;
}

function hasDryReachableLift(gen: ReturnType<typeof generateProceduralFloor>, reachable: Uint8Array, direction: LiftDirection): boolean {
  const world = gen.world;
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of ORTHO_DIRS) {
      if (reachable[world.idx(x + dx, y + dy)]) return true;
    }
  }
  return false;
}

function assertAuditReachable(world: World, audit: ReachabilityAudit, idx: number, label: string): void {
  assert.equal(audit.reachable[idx], 1, `${label}: ${describeReachability(audit, world, idx)}`);
}

function roomHasReachableCell(world: World, audit: ReachabilityAudit, room: { id: number }): boolean {
  for (let i = 0; i < world.cells.length; i++) {
    if (world.roomMap[i] === room.id && audit.reachable[i]) return true;
  }
  return false;
}

function roomHasMaskCell(world: World, mask: Uint8Array, room: { id: number }): boolean {
  for (let i = 0; i < world.cells.length; i++) {
    if (world.roomMap[i] === room.id && mask[i]) return true;
  }
  return false;
}

const RUN_GENERATION_MATRIX = process.env.GIGAHRUSH_GENERATION_MATRIX === '1';
const GENERATION_SKIP_REASON = 'run npm run test:generation for the full generation matrix';
const RUN_PROCEDURAL_FLOOR_FULL_MATRIX = process.env.GIGAHRUSH_PROCEDURAL_FLOOR_FULL_MATRIX === '1';
const PROCEDURAL_FLOOR_FULL_MATRIX_SKIP_REASON = 'run GIGAHRUSH_PROCEDURAL_FLOOR_FULL_MATRIX=1 npm run test:generation for the exhaustive procedural floor matrix';
const RUN_PROCEDURAL_FLOOR_REGRESSION_MATRIX = process.env.GIGAHRUSH_PROCEDURAL_FLOOR_REGRESSION_MATRIX === '1';
const PROCEDURAL_FLOOR_REGRESSION_SKIP_REASON = 'run GIGAHRUSH_PROCEDURAL_FLOOR_REGRESSION_MATRIX=1 npm run test:generation for procedural genfix regression floors';
const BAD_APPLE_EXPERIMENT_SKIP_REASON = 'Bad Apple world experiment is disabled in the shipped path';
const P0_REACHABILITY_FAST_CASES = [
  { runSeed: 96, z: 1 },
  { runSeed: 321, z: 9 },
  { runSeed: 42, z: 25 },
] as const;
const P0_REACHABILITY_RUN_SEEDS = [42, 96, 321] as const;
const P0_REACHABILITY_ZS = [-43, -35, -27, -23, -19, -11, -3, 1, 9, 17, 21, 25, 33, 39] as const;

after(() => printSlowestFloorGenerators());

function testGenerationMatrix(name: string, fn: () => void | Promise<void>, options?: { skip?: boolean | string }): void {
  let skip: boolean | string = RUN_GENERATION_MATRIX ? options?.skip ?? false : GENERATION_SKIP_REASON;
  if (RUN_GENERATION_MATRIX && skip === false && name.startsWith('genfix ') && !RUN_PROCEDURAL_FLOOR_REGRESSION_MATRIX) {
    skip = PROCEDURAL_FLOOR_REGRESSION_SKIP_REASON;
  }
  test(name, { skip }, fn);
}

function testProceduralFloorFullMatrix(name: string, fn: () => void | Promise<void>): void {
  testGenerationMatrix(name, fn, {
    skip: RUN_PROCEDURAL_FLOOR_FULL_MATRIX ? false : PROCEDURAL_FLOOR_FULL_MATRIX_SKIP_REASON,
  });
}

function testBadAppleExperiment(name: string, fn: () => void | Promise<void>): void {
  testGenerationMatrix(name, fn, {
    skip: BAD_APPLE_EXPERIMENT_ENABLED ? false : BAD_APPLE_EXPERIMENT_SKIP_REASON,
  });
}

function timedProceduralFloor(runSeed: number, z: number, prefix: string): ReturnType<typeof generateProceduralFloor> {
  const spec = makeProceduralFloorSpec(runSeed, z);
  return timedProceduralSpec(spec, `${prefix} seed=${runSeed}`);
}

function timedProceduralSpec(spec: ProceduralFloorSpec, prefix: string): ReturnType<typeof generateProceduralFloor> {
  return timeFloorGeneration(
    `${prefix} z=${spec.z} ${spec.geometryId}/${spec.majorityId}/${spec.anomalyId} d${spec.danger}`,
    () => generateProceduralFloor(spec),
  );
}

const designFloorCache = new Map<Parameters<typeof generateDesignFloor>[0], ReturnType<typeof generateDesignFloor>>();

function timedDesignFloor(id: Parameters<typeof generateDesignFloor>[0], label: string): ReturnType<typeof generateDesignFloor> {
  let gen = designFloorCache.get(id);
  if (!gen) {
    gen = timeFloorGeneration(label, () => generateDesignFloor(id));
    designFloorCache.set(id, gen);
  }
  return gen;
}

function proceduralZForGeometry(def: (typeof FLOOR_GEOMETRIES)[number]): number {
  const z = PROCEDURAL_FLOOR_ZS.find(candidate => {
    if (!floorRunZAllowsNpcs(candidate)) return false;
    const profileZ = floorRunProfileZ(candidate);
    if (def.minZ !== undefined && profileZ < def.minZ) return false;
    if (def.maxZ !== undefined && profileZ > def.maxZ) return false;
    return true;
  });
  assert.notEqual(z, undefined, `no procedural z can force geometry ${def.id}`);
  return z!;
}

type DangerBandId = 'upper' | 'residential' | 'industrial' | 'hellVoid';

interface DangerBandSummary {
  slots: number;
  averageTimes100: number;
  dangerCounts: number[];
}

const DANGER_SNAPSHOT_SEEDS = [41, 4101, 4102, 4103, 4104] as const;

function dangerBandForZ(z: number): DangerBandId {
  const profileZ = floorRunProfileZ(z);
  if (profileZ <= -13) return 'upper';
  if (profileZ <= 8) return 'residential';
  if (profileZ <= 27) return 'industrial';
  return 'hellVoid';
}

function summarizeDangerDeck(): Record<DangerBandId, DangerBandSummary> {
  const rows: Record<DangerBandId, { slots: number; sum: number; dangerCounts: number[] }> = {
    upper: { slots: 0, sum: 0, dangerCounts: [0, 0, 0, 0, 0] },
    residential: { slots: 0, sum: 0, dangerCounts: [0, 0, 0, 0, 0] },
    industrial: { slots: 0, sum: 0, dangerCounts: [0, 0, 0, 0, 0] },
    hellVoid: { slots: 0, sum: 0, dangerCounts: [0, 0, 0, 0, 0] },
  };

  for (const seed of DANGER_SNAPSHOT_SEEDS) {
    for (const z of PROCEDURAL_FLOOR_ZS) {
      const spec = makeProceduralFloorSpec(seed, z);
      const row = rows[dangerBandForZ(z)];
      row.slots++;
      row.sum += spec.danger;
      row.dangerCounts[spec.danger - 1]++;
    }
  }

  return {
    upper: {
      slots: rows.upper.slots,
      averageTimes100: Math.round(rows.upper.sum * 100 / rows.upper.slots),
      dangerCounts: rows.upper.dangerCounts,
    },
    residential: {
      slots: rows.residential.slots,
      averageTimes100: Math.round(rows.residential.sum * 100 / rows.residential.slots),
      dangerCounts: rows.residential.dangerCounts,
    },
    industrial: {
      slots: rows.industrial.slots,
      averageTimes100: Math.round(rows.industrial.sum * 100 / rows.industrial.slots),
      dangerCounts: rows.industrial.dangerCounts,
    },
    hellVoid: {
      slots: rows.hellVoid.slots,
      averageTimes100: Math.round(rows.hellVoid.sum * 100 / rows.hellVoid.slots),
      dangerCounts: rows.hellVoid.dangerCounts,
    },
  };
}

function summarizeAnomalyPressure(): Record<'none' | 'anomaly', { slots: number; averageTimes100: number; danger5: number }> {
  const rows = {
    none: { slots: 0, sum: 0, danger5: 0 },
    anomaly: { slots: 0, sum: 0, danger5: 0 },
  };

  for (const seed of DANGER_SNAPSHOT_SEEDS) {
    for (const z of PROCEDURAL_FLOOR_ZS) {
      const spec = makeProceduralFloorSpec(seed, z);
      const row = spec.anomalyId === 'none' ? rows.none : rows.anomaly;
      row.slots++;
      row.sum += spec.danger;
      if (spec.danger === 5) row.danger5++;
    }
  }

  return {
    none: {
      slots: rows.none.slots,
      averageTimes100: Math.round(rows.none.sum * 100 / rows.none.slots),
      danger5: rows.none.danger5,
    },
    anomaly: {
      slots: rows.anomaly.slots,
      averageTimes100: Math.round(rows.anomaly.sum * 100 / rows.anomaly.slots),
      danger5: rows.anomaly.danger5,
    },
  };
}

function summarizeProceduralDeckDiversity(): {
  total: number;
  geometryCounts: Map<string, number>;
  anomalyCounts: Map<string, number>;
} {
  const geometryCounts = new Map<string, number>();
  const anomalyCounts = new Map<string, number>();
  let total = 0;

  for (const seed of DANGER_SNAPSHOT_SEEDS) {
    for (const z of PROCEDURAL_FLOOR_ZS) {
      const spec = makeProceduralFloorSpec(seed, z);
      geometryCounts.set(spec.geometryId, (geometryCounts.get(spec.geometryId) ?? 0) + 1);
      anomalyCounts.set(spec.anomalyId, (anomalyCounts.get(spec.anomalyId) ?? 0) + 1);
      total++;
    }
  }

  return { total, geometryCounts, anomalyCounts };
}

test('procedural route deck keeps broad geometry and anomaly diversity', () => {
  const summary = summarizeProceduralDeckDiversity();
  const maxGeometryShare = Math.max(...summary.geometryCounts.values()) / summary.total;
  const noneAnomalyShare = (summary.anomalyCounts.get('none') ?? 0) / summary.total;

  assert.equal(summary.geometryCounts.size >= Math.min(8, FLOOR_GEOMETRIES.length), true, `geometry ids ${[...summary.geometryCounts.keys()].join(',')}`);
  assert.equal(maxGeometryShare < 0.34, true, `dominant geometry share ${maxGeometryShare}`);
  assert.equal(summary.anomalyCounts.size >= 12, true, `anomaly ids ${[...summary.anomalyCounts.keys()].join(',')}`);
  assert.equal(noneAnomalyShare < 0.45, true, `none anomaly share ${noneAnomalyShare}`);
});

test('normalizeFloorRunSeed returns deterministic valid run seeds', () => {
  // Pass valid integer
  assert.equal(normalizeFloorRunSeed(123456789), 123456789);

  // Absolute truncation of floats and negatives
  assert.equal(normalizeFloorRunSeed(123.45), 123);
  assert.equal(normalizeFloorRunSeed(-678), 678);
  assert.equal(normalizeFloorRunSeed(-999.99), 999);

  // Wrapping for numbers larger than MAX_RUN_SEED (0x7fffffff = 2147483647)
  const MAX_RUN_SEED = 0x7fffffff;
  assert.equal(normalizeFloorRunSeed(MAX_RUN_SEED + 5), 5);

  // Fallbacks to random seed for non-number or non-finite
  const checkRandomFallback = (value: unknown) => {
    const seed = normalizeFloorRunSeed(value);
    assert.equal(typeof seed, 'number');
    assert.equal(Number.isFinite(seed), true);
    assert.equal(seed >= 0, true);
    assert.equal(seed <= MAX_RUN_SEED, true);
    assert.equal(Math.trunc(seed), seed);
  };

  checkRandomFallback('123');
  checkRandomFallback(NaN);
  checkRandomFallback(Infinity);
  checkRandomFallback(-Infinity);
  checkRandomFallback({ seed: 123 });
  checkRandomFallback(null);
  checkRandomFallback(undefined);

  // Verify it's actually generating different seeds (stochastic, might rarely match, but generally should differ)
  const s1 = normalizeFloorRunSeed(NaN);
  const s2 = normalizeFloorRunSeed(NaN);
  const s3 = normalizeFloorRunSeed(NaN);
  assert.ok(s1 !== s2 || s2 !== s3, 'Fallback should generate pseudo-random distinct seeds');
});

test('floor run reaches the next lower authored floor through procedural gaps', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  setFloorRunState(state, { runSeed: 123, currentZ: 0, specs: {}, visited: {} }, FloorLevel.LIVING);

  const first = resolveFloorRunRoute(state, LiftDirection.DOWN);
  assert.equal(first?.z, -1);
  assert.equal(first?.procedural, true);
  commitFloorRunEntry(state, first!);

  const second = resolveFloorRunRoute(state, LiftDirection.DOWN);
  assert.equal(second?.z, -2);
  assert.equal(second?.designFloorId, 'oranzhereya_betona');
  commitFloorRunEntry(state, second!);

  const third = resolveFloorRunRoute(state, LiftDirection.DOWN);
  assert.equal(third?.z, -3);
  assert.equal(third?.procedural, true);
  commitFloorRunEntry(state, third!);

  const authored = resolveFloorRunRoute(state, LiftDirection.DOWN);
  assert.equal(authored?.z, -4);
  assert.equal(authored?.designFloorId, 'floor_69');
  assert.equal(authored?.baseFloor, FloorLevel.MAINTENANCE);
});

test('floor run UX labels avoid duplicate procedural z and keep return path', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  setFloorRunState(state, { runSeed: 123, currentZ: 0, specs: {}, visited: {} }, FloorLevel.LIVING);

  assert.match(currentFloorRunLabel(state) ?? '', /Z\+0 story:living Жилая зона/);
  assert.equal(floorRunEntryKind(currentFloorRunEntry(state)), 'story');
  assert.equal(floorRunEntryFloorKey(currentFloorRunEntry(state)), 'story:living');
  assert.match(floorRunEntryRouteCard(currentFloorRunEntry(state)), /СЮЖЕТНЫЙ ЯКОРЬ Z\+0 story:living: Жилая зона\. домашний hub, подготовка, возврат\./);

  const first = resolveFloorRunRoute(state, LiftDirection.DOWN);
  assert.equal(first?.procedural, true);
  assert.equal(floorRunEntryKind(first!), 'procedural');
  assert.equal(floorRunEntryFloorKey(first!), 'procedural:z-1');
  assert.match(floorRunEntryLiftLabel(first!), /ВЫЛАЗКА Z-1:/);
  assert.doesNotMatch(floorRunEntryLiftLabel(first!), /Z-1 z-1/);
  assert.doesNotMatch(floorRunEntryMapLabel(first!), /Z-1 z-1/);
  assert.match(floorRunEntryRouteCard(first!), /ВЫЛАЗКА Z-1: .+\. .+, .+, .+\./);
  assert.match(floorRunArrivalLead(first!, LiftDirection.UP), /Зацепка: ВЫЛАЗКА Z-1: .+\. .+ Возврат: лифт ↑ к предыдущему Z\./);

  commitFloorRunEntry(state, first!);
  commitFloorRunEntry(state, resolveFloorRunRoute(state, LiftDirection.DOWN)!);
  commitFloorRunEntry(state, resolveFloorRunRoute(state, LiftDirection.DOWN)!);
  const authored = resolveFloorRunRoute(state, LiftDirection.DOWN);
  assert.equal(authored?.designFloorId, 'floor_69');
  assert.equal(floorRunEntryKind(authored!), 'design');
  assert.equal(floorRunEntryFloorKey(authored!), 'design:floor_69');
  assert.match(floorRunEntryLiftLabel(authored!), /РУЧНОЙ МАРШРУТ Z-4 floor_69/);
  assert.match(floorRunEntryRouteCard(authored!), /РУЧНОЙ МАРШРУТ Z-4 floor_69: .+\. населенный сбой, сделки, слухи\./);
  assert.match(floorRunArrivalLead(authored!, LiftDirection.UP), /населенный сбой, сделки, слухи/);
  assert.match(floorRunArrivalLead(authored!, LiftDirection.UP), /Возврат: лифт ↑ к предыдущему Z/);
});

test('strict portal mode resolves blocked Floor 69 as procedural route entry', () => {
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { search: '?portal=pikabu' },
  });

  try {
    const state = makeGameState({ currentFloor: FloorLevel.LIVING });
    setFloorRunState(state, { runSeed: 123, currentZ: -3, specs: {}, visited: {} }, FloorLevel.LIVING);

    const routeEntry = resolveFloorRunRoute(state, LiftDirection.DOWN);
    assert.equal(routeEntry?.z, -4);
    assert.equal(routeEntry?.procedural, true);
    assert.equal(routeEntry?.designFloorId, undefined);
    assert.equal(floorRunEntryFloorKey(routeEntry!), 'procedural:z-4');

    const directEntry = floorRunEntryForDesignFloor(state, 'floor_69');
    assert.equal(directEntry?.procedural, true);
    assert.equal(floorRunEntryFloorKey(directEntry!), 'procedural:z-4');
    assert.ok(ensureFloorRunState(state).specs['z-4']);
  } finally {
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
    else delete (globalThis as typeof globalThis & { location?: Location }).location;
  }
});

test('floor run reads keep normalized state identity', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const run = setFloorRunState(state, { runSeed: 123, currentZ: 0, specs: {}, visited: {} }, FloorLevel.LIVING);
  const host = state as typeof state & { floorRun?: unknown };

  assert.equal(ensureFloorRunState(state), run);
  currentFloorRunEntry(state);
  currentFloorRunLabel(state);
  resolveFloorRunRoute(state, LiftDirection.DOWN);

  assert.equal(host.floorRun, run);
});

test('objective route HUD and lift prompts point down to lower route targets', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  setFloorRunState(state, { runSeed: 123, currentZ: 0, specs: {}, visited: {} }, FloorLevel.LIVING);

  const startHud = getObjectiveRouteHud(state);
  assert.match(startHud.title, /Ольга.*Баринов.*Яков/);
  assert.match(startHud.lift, /после цели/);

  const quest = {
    id: 77,
    type: QuestType.FETCH,
    giverId: -77,
    giverName: 'Пост давления',
    desc: 'Принеси манометр с нижнего маршрута.',
    targetItem: 'manometer',
    targetCount: 1,
    targetFloor: FloorLevel.MAINTENANCE,
    targetRoute: { z: -20, label: 'Z-20 Коллекторы', risk: 2 },
    targetHint: 'Коллекторы: насосная или пост давления; проверяйте клапан до входа в пар.',
    done: false,
  };
  state.quests.push(quest);

  assert.equal(questTargetLiftDirection(quest, state), LiftDirection.DOWN);
  assert.equal(routeObjectiveLiftPromptSuffix(state, LiftDirection.DOWN), ' / ЦЕЛЬ');
  assert.equal(routeObjectiveLiftPromptSuffix(state, LiftDirection.UP), '');

  const hud = getObjectiveRouteHud(state);
  assert.match(hud.title, /добыть/);
  assert.match(hud.target, /Z-20 Коллекторы/);
  assert.match(hud.lift, /Лифт ↓ к цели от Z\+0/);
  assert.match(hud.risk, /Коллекторы: насосная или пост давления/);
  assert.match(hud.returnPath, /Жилая зона/);

  commitFloorRunEntry(state, resolveFloorRunRoute(state, LiftDirection.DOWN)!);
  assert.equal(routeObjectiveLiftPromptSuffix(state, LiftDirection.DOWN), ' / ЦЕЛЬ');
  assert.equal(routeObjectiveLiftPromptSuffix(state, LiftDirection.UP), ' / ВОЗВРАТ');
  assert.match(getObjectiveRouteHud(state).returnPath, /лифт ↑ к Z\+0/);
});

test('floor run keeps authored stops on expandable even route slots', () => {
  const anchors = [
    zForStoryFloor(FloorLevel.MINISTRY),
    zForStoryFloor(FloorLevel.KVARTIRY),
    zForStoryFloor(FloorLevel.LIVING),
    zForStoryFloor(FloorLevel.MAINTENANCE),
    zForStoryFloor(FloorLevel.HELL),
    zForStoryFloor(FloorLevel.VOID),
    ...DESIGN_FLOOR_ROUTES.map(def => def.z),
  ].sort((a, b) => a - b);

  assert.equal(anchors[0], FLOOR_RUN_MIN_Z);
  assert.equal(anchors.at(-1), FLOOR_RUN_MAX_Z);
  assert.equal(new Set(anchors).size, anchors.length);
  assert.equal(anchors.every(z => z % 2 === 0), true);
  assert.equal(PROCEDURAL_FLOOR_ZS.every(z => !anchors.includes(z)), true);
  assert.equal(PROCEDURAL_FLOOR_ZS.some(z => z % 2 === 0), true);
  assert.equal(PROCEDURAL_FLOOR_ZS.length >= 50 && PROCEDURAL_FLOOR_ZS.length <= 60, true);
});

test('floor run reaches the upper Ministry authored ladder through procedural gaps', () => {
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY });
  setFloorRunState(state, { runSeed: 789, currentZ: 30, specs: {}, visited: {} }, FloorLevel.MINISTRY);

  const z31 = resolveFloorRunRoute(state, LiftDirection.UP);
  assert.equal(z31?.z, 31);
  assert.equal(z31?.procedural, true);
  commitFloorRunEntry(state, z31!);

  const numberRegistry = resolveFloorRunRoute(state, LiftDirection.UP);
  assert.equal(numberRegistry?.z, 32);
  assert.equal(numberRegistry?.designFloorId, 'number_registry');
  commitFloorRunEntry(state, numberRegistry!);

  const z33 = resolveFloorRunRoute(state, LiftDirection.UP);
  assert.equal(z33?.z, 33);
  assert.equal(z33?.procedural, true);
  commitFloorRunEntry(state, z33!);

  const upperBureau = resolveFloorRunRoute(state, LiftDirection.UP);
  assert.equal(upperBureau?.z, 34);
  assert.equal(upperBureau?.designFloorId, 'upper_bureau');
  commitFloorRunEntry(state, upperBureau!);

  const z35 = resolveFloorRunRoute(state, LiftDirection.UP);
  assert.equal(z35?.z, 35);
  assert.equal(z35?.procedural, true);
  commitFloorRunEntry(state, z35!);

  const cayley = resolveFloorRunRoute(state, LiftDirection.UP);
  assert.equal(cayley?.z, 36);
  assert.equal(cayley?.designFloorId, 'cayley_byuro');
  commitFloorRunEntry(state, cayley!);

  const z37 = resolveFloorRunRoute(state, LiftDirection.UP);
  assert.equal(z37?.z, 37);
  assert.equal(z37?.procedural, true);
  commitFloorRunEntry(state, z37!);

  const camp = resolveFloorRunRoute(state, LiftDirection.UP);
  assert.equal(camp?.z, 38);
  assert.equal(camp?.designFloorId, 'pioneer_camp');
  assert.equal(camp?.baseFloor, FloorLevel.LIVING);
});

test('floor run exposes seeded procedural slots across the normal lift span', () => {
  assert.equal(PROCEDURAL_FLOOR_COUNT, expectedProceduralFloorCount());
  assert.equal(PROCEDURAL_FLOOR_ZS[0], -49);
  assert.equal(PROCEDURAL_FLOOR_ZS.at(-1), 49);
  assert.equal(PROCEDURAL_FLOOR_ZS.includes(1), true);
  assert.equal(PROCEDURAL_FLOOR_ZS.includes(-25), true);
  assert.equal(PROCEDURAL_FLOOR_ZS.includes(-22), false);
  assert.equal(PROCEDURAL_FLOOR_ZS.includes(-6), false);
  assert.equal(PROCEDURAL_FLOOR_ZS.includes(2), false);
  assert.equal(PROCEDURAL_FLOOR_ZS.includes(12), false);
  assert.equal(PROCEDURAL_FLOOR_ZS.includes(26), false);
  assert.equal(PROCEDURAL_FLOOR_ZS.includes(38), false);

  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  setFloorRunState(state, { runSeed: 456, currentZ: 0, specs: {}, visited: {} }, FloorLevel.LIVING);

  const firstGap = resolveFloorRunRoute(state, LiftDirection.UP);
  assert.equal(firstGap?.z, 1);
  assert.equal(firstGap?.procedural, true);
  commitFloorRunEntry(state, firstGap!);

  const moebiusPodezd = resolveFloorRunRoute(state, LiftDirection.UP);
  assert.equal(moebiusPodezd?.z, 2);
  assert.equal(moebiusPodezd?.designFloorId, 'moebius_podezd');
  assert.equal(moebiusPodezd?.baseFloor, FloorLevel.KVARTIRY);
  commitFloorRunEntry(state, moebiusPodezd!);

  for (const expectedZ of [3]) {
    const entry = resolveFloorRunRoute(state, LiftDirection.UP);
    assert.equal(entry?.z, expectedZ);
    assert.equal(entry?.procedural, true);
    commitFloorRunEntry(state, entry!);
  }

  const communalRing = resolveFloorRunRoute(state, LiftDirection.UP);
  assert.equal(communalRing?.z, 4);
  assert.equal(communalRing?.designFloorId, 'communal_ring');
  commitFloorRunEntry(state, communalRing!);

  const z5 = resolveFloorRunRoute(state, LiftDirection.UP);
  assert.equal(z5?.z, 5);
  assert.equal(z5?.procedural, true);
  commitFloorRunEntry(state, z5!);

  const voronoiQuarantine = resolveFloorRunRoute(state, LiftDirection.UP);
  assert.equal(voronoiQuarantine?.z, 6);
  assert.equal(voronoiQuarantine?.designFloorId, 'voronoi_quarantine');
  commitFloorRunEntry(state, voronoiQuarantine!);

  const z7 = resolveFloorRunRoute(state, LiftDirection.UP);
  assert.equal(z7?.z, 7);
  assert.equal(z7?.procedural, true);
  commitFloorRunEntry(state, z7!);

  const crossroads = resolveFloorRunRoute(state, LiftDirection.UP);
  assert.equal(crossroads?.z, 8);
  assert.equal(crossroads?.designFloorId, 'manhattan_crossroads');
  commitFloorRunEntry(state, crossroads!);

  const z9 = resolveFloorRunRoute(state, LiftDirection.UP);
  assert.equal(z9?.z, 9);
  assert.equal(z9?.procedural, true);
  commitFloorRunEntry(state, z9!);

  const turingNursery = resolveFloorRunRoute(state, LiftDirection.UP);
  assert.equal(turingNursery?.z, 10);
  assert.equal(turingNursery?.designFloorId, 'turing_nursery');
  commitFloorRunEntry(state, turingNursery!);

  const z11 = resolveFloorRunRoute(state, LiftDirection.UP);
  assert.equal(z11?.z, 11);
  assert.equal(z11?.procedural, true);
  commitFloorRunEntry(state, z11!);

  const slimeNii = resolveFloorRunRoute(state, LiftDirection.UP);
  assert.equal(slimeNii?.z, 12);
  assert.equal(slimeNii?.designFloorId, 'slime_nii');
  assert.equal(slimeNii?.baseFloor, FloorLevel.KVARTIRY);
  commitFloorRunEntry(state, slimeNii!);

  const z13 = resolveFloorRunRoute(state, LiftDirection.UP);
  assert.equal(z13?.z, 13);
  assert.equal(z13?.procedural, true);
  commitFloorRunEntry(state, z13!);

  const kvartiry = resolveFloorRunRoute(state, LiftDirection.UP);
  assert.equal(kvartiry?.z, 14);
  assert.equal(kvartiry?.storyFloor, FloorLevel.KVARTIRY);
});

function expectedProceduralFloorCount(): number {
  const occupied = new Set(DESIGN_FLOOR_ROUTES.map(route => route.z));
  for (const floor of [
    FloorLevel.MINISTRY,
    FloorLevel.KVARTIRY,
    FloorLevel.LIVING,
    FloorLevel.MAINTENANCE,
    FloorLevel.HELL,
    FloorLevel.VOID,
  ]) {
    occupied.add(zForStoryFloor(floor));
  }
  let count = 0;
  for (let z = FLOOR_RUN_MIN_Z; z <= FLOOR_RUN_MAX_Z; z++) {
    if (!occupied.has(z)) count++;
  }
  return count;
}

test('floor run lift directions respect roof void and data-owned Podad lower gate', () => {
  const state = makeGameState();

  setFloorRunState(state, { runSeed: 123, currentZ: FLOOR_RUN_MAX_Z, specs: {}, visited: {} }, FloorLevel.MINISTRY);
  assert.deepEqual(floorRunEntryLiftDirections(currentFloorRunEntry(state)), [LiftDirection.DOWN]);

  setFloorRunState(state, { runSeed: 123, currentZ: FLOOR_RUN_MIN_Z, specs: {}, visited: {} }, FloorLevel.VOID);
  assert.deepEqual(floorRunEntryLiftDirections(currentFloorRunEntry(state)), [LiftDirection.UP]);

  setFloorRunState(state, { runSeed: 123, currentZ: -40, specs: {}, visited: {} }, FloorLevel.HELL);
  const podad = currentFloorRunEntry(state);
  const podadGate = ROUTE_GATE_DEFS.find(gate => gate.id === 'podad_lower_route');
  assert.equal(podadGate?.targetRouteKind, 'design');
  assert.equal(podadGate?.targetRouteId, 'podad');
  assert.equal(podadGate?.targetFloorKey, 'design:podad');
  assert.equal(podadGate?.blockedDirection, LiftDirection.DOWN);
  assert.deepEqual(podadGate?.liftMutation.directions, [LiftDirection.DOWN]);
  assert.equal(podad.designFloorId, 'podad');
  assert.deepEqual(floorRunEntryLiftDirections(podad), [LiftDirection.UP]);
  assert.equal(resolveFloorRunRoute(state, LiftDirection.DOWN), null);

  state.quests.push({
    id: 1,
    type: QuestType.KILL,
    giverId: 0,
    giverName: 'Марфа',
    desc: 'Тестовый счет Вестников',
    targetMonsterKind: MonsterKind.HERALD,
    killCount: 3,
    killNeeded: 3,
    eventTags: ['podad', 'herald_gate', 'lower_route_unlocked'],
    done: false,
  });
  const openGateIds = openRouteGateIds(state);
  assert.deepEqual([...openGateIds], ['podad_lower_route']);
  assert.deepEqual(floorRunEntryLiftDirections(podad, openGateIds), [LiftDirection.DOWN, LiftDirection.UP]);
  assert.equal(resolveFloorRunRoute(state, LiftDirection.DOWN)?.z, -41);
});

test('procedural floor specs are deterministic from run seed and z', () => {
  const a = makeProceduralFloorSpec(999, 3);
  const b = makeProceduralFloorSpec(999, 3);
  const c = makeProceduralFloorSpec(999, 5);

  assert.deepEqual(a, b);
  assert.notEqual(a.seed, c.seed);
});

test('active numbered floor instances key editor and runtime state by anomaly id', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 12 });
  setFloorRunState(state, { runSeed: 404, currentZ: 1, specs: {}, visited: {} }, FloorLevel.LIVING);

  const intendedKey = currentMapEditorFloorKey(state);
  assert.match(intendedKey, /^procedural:/);

  const savedRun = floorRunStateForSave(state);
  setFloorInstanceState(state, {
    current: {
      id: 'loop_404',
      fromFloor: FloorLevel.LIVING,
      intendedFloor: FloorLevel.MAINTENANCE,
      returnFloor: FloorLevel.MAINTENANCE,
      direction: LiftDirection.DOWN,
    },
  }, FloorLevel.LIVING);

  const anomalyKey = floorInstanceWorldKey('loop_404');
  assert.equal(floorInstanceStateForSave(state).current?.worldKey, anomalyKey);
  assert.equal(currentMapEditorFloorKey(state), anomalyKey);
  assert.equal(currentNetTerminalGenFloorKey(state), anomalyKey);
  assert.equal(currentFloorRunEntry(state).z, 1);

  const loaded = makeGameState({ currentFloor: FloorLevel.LIVING });
  setFloorRunState(loaded, savedRun, FloorLevel.LIVING);
  setFloorInstanceState(loaded, floorInstanceStateForSave(state), FloorLevel.LIVING);
  assert.equal(currentMapEditorFloorKey(loaded), anomalyKey);
  assert.equal(currentNetTerminalGenFloorKey(loaded), anomalyKey);
});

test('active numbered floor editor replay does not leak patches to intended route floor', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 20 });
  setFloorRunState(state, { runSeed: 405, currentZ: 1, specs: {}, visited: {} }, FloorLevel.LIVING);
  const intendedKey = currentMapEditorFloorKey(state);
  const anomalyKey = floorInstanceWorldKey('loop_404');
  setFloorInstanceState(state, {
    current: {
      id: 'loop_404',
      fromFloor: FloorLevel.LIVING,
      intendedFloor: FloorLevel.MAINTENANCE,
      returnFloor: FloorLevel.MAINTENANCE,
      direction: LiftDirection.DOWN,
    },
  }, FloorLevel.LIVING);

  const world = new World();
  const player = makeTestPlayer({ id: 1, x: 2.5, y: 2.5 });
  const entities = [player];
  const nextEntityId = { v: 2 };
  world.cells[world.idx(10, 10)] = Cell.FLOOR;
  world.cells[world.idx(11, 11)] = Cell.FLOOR;

  setMapEditorPatchState(state, {
    patches: {
      [intendedKey]: {
        floorKey: intendedKey,
        baseFloor: FloorLevel.MAINTENANCE,
        z: 1,
        createdAt: 1,
        opCount: 1,
        ops: [{ kind: 'set_cell', x: 10, y: 10, cell: Cell.WALL }],
      },
      [anomalyKey]: {
        floorKey: anomalyKey,
        baseFloor: FloorLevel.LIVING,
        createdAt: 2,
        opCount: 1,
        ops: [{ kind: 'set_cell', x: 11, y: 11, cell: Cell.WATER }],
      },
    },
    skipped: [],
  });

  const snapshot = getMapEditorSnapshot(state);
  assert.equal(snapshot.floorKey, anomalyKey);
  assert.equal(snapshot.patchOps, 1);

  const applied = replayMapEditorPatchForCurrentFloor(world, entities, player, state, nextEntityId);
  assert.equal(applied, 1);
  assert.equal(world.cells[world.idx(10, 10)], Cell.FLOOR);
  assert.equal(world.cells[world.idx(11, 11)], Cell.WATER);
});

test('procedural floor danger deck keeps route-band pressure rhythm', () => {
  const deck = summarizeDangerDeck();
  assert.equal(deck.upper.averageTimes100 >= 300 && deck.upper.averageTimes100 <= 350, true);
  assert.equal(deck.residential.averageTimes100 >= 200 && deck.residential.averageTimes100 <= 280, true);
  assert.equal(deck.industrial.averageTimes100 >= 330 && deck.industrial.averageTimes100 <= 400, true);
  assert.equal(deck.hellVoid.averageTimes100 >= 430 && deck.hellVoid.averageTimes100 <= 500, true);

  const pressure = summarizeAnomalyPressure();
  assert.equal(pressure.none.averageTimes100 < pressure.anomaly.averageTimes100, true);
  assert.equal(pressure.anomaly.danger5 > pressure.none.danger5, true);
});

test('procedural floor danger snapshot is deterministic by z and seed', () => {
  const snapshot = PROCEDURAL_FLOOR_ZS
    .map(z => `${z}:${makeProceduralFloorSpec(41, z).danger}`)
    .join(' ');

  assert.equal(snapshot.length > 50, true);
  assert.equal(snapshot.includes('-49:5'), true);
  assert.equal(snapshot.includes('1:1'), true);
});

test('procedural floor generator returns a playable non-story floor', () => {
  const spec = makeProceduralFloorSpec(321, 3);
  const gen = timedProceduralSpec(spec, 'procedural smoke seed=321');
  const spawnCell = gen.world.cells[gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))];
  const liftUp = gen.world.liftDir.some((dir, idx) => dir === LiftDirection.UP && gen.world.cells[idx] === Cell.LIFT);
  const liftDown = gen.world.liftDir.some((dir, idx) => dir === LiftDirection.DOWN && gen.world.cells[idx] === Cell.LIFT);

  assert.equal(spawnCell, Cell.FLOOR);
  assert.equal(liftUp, true);
  assert.equal(liftDown, true);
  assert.equal(gen.entities.some(e => e.type === EntityType.NPC), true);
  assert.equal(gen.entities.some(e => e.type === EntityType.MONSTER), true);
  assert.equal(gen.world.containers.some(container => container.inventory.length > 0), true);
});

test('shared route registration contract keeps floor registries complete', () => {
  validateDesignFloorGenerators();
  validateProceduralAnomalyGenerationRegistry();

  const routeIds = new Set<string>();
  const sortedRouteIds = DESIGN_FLOOR_ROUTES.map(route => route.id).sort();
  const sortedGeneratorIds = [...designFloorGeneratorIds()].sort();
  assert.deepEqual(sortedGeneratorIds, sortedRouteIds, 'design floor manifest ids must match route data exactly');

  for (const route of DESIGN_FLOOR_ROUTES) {
    assert.equal(routeIds.has(route.id), false, `duplicate design floor route ${route.id}`);
    routeIds.add(route.id);
    const profile = designFloorPopulationProfile(route);
    assert.equal(profile.routeId, route.id, `population profile route mismatch for ${route.id}`);
    assert.equal(profile.z, route.z, `population profile z mismatch for ${route.id}`);
  }

  const geometryIds = new Set<string>();
  for (const def of FLOOR_GEOMETRIES) {
    assert.equal(geometryIds.has(def.id), false, `duplicate procedural geometry ${def.id}`);
    geometryIds.add(def.id);
    assert.equal(PROCEDURAL_FLOOR_ZS.includes(proceduralZForGeometry(def)), true, `${def.id} must have a forceable procedural z`);
  }

  const anomalyIds = new Set<string>();
  for (const def of FLOOR_ANOMALIES) {
    assert.equal(anomalyIds.has(def.id), false, `duplicate procedural anomaly ${def.id}`);
    anomalyIds.add(def.id);
    assert.equal(def.minDanger >= 1 && def.minDanger <= 5, true, `${def.id} minDanger`);
  }
});

test('P0 procedural reachability fast subset keeps route lifts usable', () => {
  for (const { runSeed, z } of P0_REACHABILITY_FAST_CASES) {
    assert.equal(PROCEDURAL_FLOOR_ZS.includes(z), true, `z=${z} is procedural`);
    const gen = timedProceduralFloor(runSeed, z, 'P0 fast reachability');
    const audit = reachabilityAudit(gen);
    assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true, `seed=${runSeed} z=${z} up lift`);
    assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true, `seed=${runSeed} z=${z} down lift`);
  }
});

testProceduralFloorFullMatrix('P0 procedural reachability matrix keeps sampled route lifts usable', () => {
  for (const z of P0_REACHABILITY_ZS) {
    assert.equal(PROCEDURAL_FLOOR_ZS.includes(z), true, `z=${z} is procedural`);
  }

  for (const runSeed of P0_REACHABILITY_RUN_SEEDS) {
    for (const z of P0_REACHABILITY_ZS) {
      const gen = timedProceduralFloor(runSeed, z, 'P0 matrix reachability');
      const audit = reachabilityAudit(gen);
      assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true, `seed=${runSeed} z=${z} up lift`);
      assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true, `seed=${runSeed} z=${z} down lift`);
    }
  }
});

testProceduralFloorFullMatrix('all procedural geometry profiles can be forced without anomaly', () => {
  for (const def of FLOOR_GEOMETRIES) {
    const z = proceduralZForGeometry(def);
    const base = makeProceduralFloorSpec(202_002, z);
    const gen = timedProceduralSpec({
      ...base,
      geometryId: def.id,
      baseFloor: def.baseFloor,
      anomalyId: 'none',
      danger: Math.max(1, Math.min(5, base.danger + def.dangerBias)) as ProceduralFloorSpec['danger'],
      title: `${def.title}: ${base.title}`,
    }, 'forced geometry contract');
    const audit = reachabilityAudit(gen);

    assert.equal(gen.world.rooms.length > 0, true, `${def.id} should create rooms`);
    assert.equal(gen.world.cells[gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))], Cell.FLOOR, `${def.id} spawn cell`);
    assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true, `${def.id} up lift`);
    assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true, `${def.id} down lift`);
    assert.equal(reachableBucketCount(gen.world, audit.reachable, 64) >= 10, true, `${def.id} should occupy multiple map-scale buckets`);
    if (!['living_blocks', 'archive_warrens', 'apartment_pressure', 'sump_causeways'].includes(def.id)) {
      const macroHalls = gen.world.rooms.filter(room =>
        room.name.startsWith('Насосный зал') ||
        room.name.startsWith('Цеховой пролет') ||
        room.name.startsWith('Сервисный узел') ||
        room.name.startsWith('Ветровой короб') ||
        room.name.startsWith('Приемный зал') ||
        room.name.startsWith('Общий тамбур') ||
        room.name.startsWith('Большой общий зал') ||
        room.name.startsWith('Опорный зал') ||
        (room.w * room.h >= 140 && Math.max(room.w, room.h) >= 18)
      );
      const macroCues = getRouteCueMarkers(gen.world).filter(marker => marker.tags.includes('macro_spine') && marker.tags.includes(def.id));
      assert.equal(macroHalls.length >= 3, true, `${def.id} macro halls ${macroHalls.length}`);
      assert.equal(macroCues.length >= 1, true, `${def.id} macro spine cue`);
    }
  }
});

testGenerationMatrix('procedural structure library gives generic geometries distinct macro overlays', () => {
  const cases = [
    { geometryId: 'communal_knots', z: 1, family: 'cellular_braid' },
    { geometryId: 'admin_pockets', z: -21, family: 'prime_xor_registry' },
    { geometryId: 'service_spines', z: 17, family: 'braided_maintenance_maze' },
    { geometryId: 'workshops', z: 17, family: 'factory_islands' },
  ] as const;

  for (const [i, item] of cases.entries()) {
    const def = FLOOR_GEOMETRIES.find(candidate => candidate.id === item.geometryId);
    assert.ok(def, `missing geometry ${item.geometryId}`);
    const base = makeProceduralFloorSpec(202_606 + i * 17, item.z);
    const spec: ProceduralFloorSpec = {
      ...base,
      geometryId: item.geometryId,
      baseFloor: def.baseFloor,
      majorityId: 'citizens',
      anomalyId: 'none',
      danger: 3,
      title: `${def.title}: ${base.title}`,
    };
    assert.equal(proceduralStructureFamilyForSpec(spec), item.family);
    const gen = timedProceduralSpec(spec, `structure library ${item.geometryId}`);
    const audit = reachabilityAudit(gen);
    const cues = getRouteCueMarkers(gen.world).filter(marker =>
      marker.tags.includes('structure_library') &&
      marker.tags.includes(item.family) &&
      marker.tags.includes(item.geometryId),
    );

    assert.equal(cues.length >= 1, true, `${item.geometryId} structure cue`);
    assert.equal(reachableBucketCount(gen.world, audit.reachable, 64) >= 12, true, `${item.geometryId} macro buckets`);
    assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true, `${item.geometryId} up lift`);
    assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true, `${item.geometryId} down lift`);
  }
});



testGenerationMatrix('genfix 018 archive warrens citizens floor has registry microstructure and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, 33);
  assert.equal(spec.geometryId, 'archive_warrens');
  assert.equal(spec.majorityId, 'citizens');
  assert.equal(spec.anomalyId, 'none');
  assert.equal(spec.danger, 2);

  const gen = timedProceduralSpec(spec, 'genfix 018 archive_warrens citizens seed=61061');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const archiveMicroRooms = gen.world.rooms.filter(room =>
    room.name.startsWith('Архивная ячейка') ||
    room.name.startsWith('Архивная будка') ||
    room.name.startsWith('Боковой регистр'));
  const hqRooms = gen.world.rooms.filter(room => room.type === RoomType.HQ);
  const hqSupportRooms = gen.world.rooms.filter(room => room.name.startsWith('Архивная опора'));
  const hqOwners = new Set(hqRooms.map(room => territoryOwnerAtIndex(gen.world, gen.world.idx(room.x + (room.w >> 1), room.y + (room.h >> 1)))));
  const anchors = territoryHqAnchors(gen.world);
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / (W * W);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  assert.equal(gen.world.rooms.length >= 1200, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 1800, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 110_000, true, `reachable ${reachable}`);
  assert.equal(archiveMicroRooms.length >= 900, true, `archive micro rooms ${archiveMicroRooms.length}`);
  assert.equal(hqRooms.length >= 7, true, `archive HQ rooms ${hqRooms.length}`);
  assert.equal(hqSupportRooms.length >= 15, true, `archive HQ support rooms ${hqSupportRooms.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(anchors.some(anchor => anchor.owner === owner), true, `missing HQ anchor ${owner}`);
    assert.equal(hqOwners.has(owner), true, `missing HQ room owner ${owner}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `missing territory cells ${owner}`);
  }
  assert.equal(dominant, ZoneFaction.CITIZEN);
  assert.equal(share(ZoneFaction.CITIZEN) >= 0.54 && share(ZoneFaction.CITIZEN) <= 0.58, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(share(ZoneFaction.LIQUIDATOR) >= 0.15 && share(ZoneFaction.LIQUIDATOR) <= 0.19, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(share(ZoneFaction.CULTIST) >= 0.05 && share(ZoneFaction.CULTIST) <= 0.09, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(share(ZoneFaction.SCIENTIST) >= 0.06 && share(ZoneFaction.SCIENTIST) <= 0.10, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(share(ZoneFaction.WILD) >= 0.10 && share(ZoneFaction.WILD) <= 0.14, true, `wild share ${share(ZoneFaction.WILD)}`);
});

testGenerationMatrix('genfix 022 procedural archive warrens z29 citizens floor has dense micro rooms and cell territory', () => {
  const spec = makeProceduralFloorSpec(61_061, 29);
  assert.equal(spec.z, 29);
  assert.equal(spec.geometryId, 'archive_warrens');
  assert.equal(spec.majorityId, 'citizens');
  assert.equal(spec.anomalyId, 'none');
  assert.equal(spec.danger, 2);

  const gen = timedProceduralSpec(spec, 'genfix 022 archive_warrens citizens seed=61061');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const archiveMicroRooms = gen.world.rooms.filter(room =>
    room.name.startsWith('Архивная ячейка') ||
    room.name.startsWith('Архивная будка') ||
    room.name.startsWith('Боковой регистр'));
  const hqRooms = gen.world.rooms.filter(room => room.type === RoomType.HQ);
  const hqSupportRooms = gen.world.rooms.filter(room => room.name.startsWith('Архивная опора'));
  const hqOwners = new Set(hqRooms.map(room => territoryOwnerAtIndex(gen.world, gen.world.idx(room.x + (room.w >> 1), room.y + (room.h >> 1)))));
  const anchors = territoryHqAnchors(gen.world);
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const totalCells = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / totalCells;
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    if (entity.faction === undefined) return false;
    const owner = territoryOwnerAtIndex(gen.world, gen.world.idx(Math.floor(entity.x), Math.floor(entity.y)));
    return territoryOwnerToFaction(owner) === entity.faction;
  });

  assert.equal(gen.world.rooms.length >= 1500, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 2400, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 130_000, true, `reachable ${reachable}`);
  assert.equal(archiveMicroRooms.length >= 1300, true, `archive micro rooms ${archiveMicroRooms.length}`);
  assert.equal(hqRooms.length >= 7, true, `archive HQ rooms ${hqRooms.length}`);
  assert.equal(hqRooms.every(room => room.sealed), true, 'archive HQ rooms should be sealed shelter cores');
  assert.equal(hqSupportRooms.length >= 15, true, `archive HQ support rooms ${hqSupportRooms.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(anchors.some(anchor => anchor.owner === owner), true, `missing HQ anchor ${owner}`);
    assert.equal(hqOwners.has(owner), true, `missing HQ room owner ${owner}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `missing territory cells ${owner}`);
  }
  assert.equal(dominant, ZoneFaction.CITIZEN);
  assert.equal(share(ZoneFaction.CITIZEN) >= 0.54 && share(ZoneFaction.CITIZEN) <= 0.58, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(share(ZoneFaction.LIQUIDATOR) >= 0.15 && share(ZoneFaction.LIQUIDATOR) <= 0.19, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(share(ZoneFaction.CULTIST) >= 0.05 && share(ZoneFaction.CULTIST) <= 0.09, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(share(ZoneFaction.SCIENTIST) >= 0.06 && share(ZoneFaction.SCIENTIST) <= 0.10, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(share(ZoneFaction.WILD) >= 0.10 && share(ZoneFaction.WILD) <= 0.14, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.7, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 024 procedural archive smog citizens floor keeps macro, micro rooms and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, 27);
  assert.equal(spec.z, 27);
  assert.equal(spec.geometryId, 'archive_warrens');
  assert.equal(spec.majorityId, 'citizens');
  assert.equal(spec.anomalyId, 'smog');
  assert.equal(spec.danger, 3);

  const gen = timedProceduralSpec(spec, 'genfix 024 archive_warrens smog citizens seed=61061');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const archiveMicroRooms = gen.world.rooms.filter(room =>
    room.name.startsWith('Архивная ячейка') ||
    room.name.startsWith('Архивная будка') ||
    room.name.startsWith('Боковой регистр'));
  const hqRooms = gen.world.rooms.filter(room => room.type === RoomType.HQ);
  const hqSupportRooms = gen.world.rooms.filter(room => room.name.startsWith('Архивная опора'));
  const hqOwners = new Set(hqRooms.map(room => territoryOwnerAtIndex(gen.world, gen.world.idx(room.x + (room.w >> 1), room.y + (room.h >> 1)))));
  const anchors = territoryHqAnchors(gen.world);
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const totalCells = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / totalCells;
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    if (entity.faction === undefined) return false;
    const owner = territoryOwnerAtIndex(gen.world, gen.world.idx(Math.floor(entity.x), Math.floor(entity.y)));
    return territoryOwnerToFaction(owner) === entity.faction;
  });

  assert.equal(gen.world.rooms.length >= 1500, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 2400, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 125_000, true, `reachable ${reachable}`);
  assert.equal(archiveMicroRooms.length >= 1300, true, `archive micro rooms ${archiveMicroRooms.length}`);
  assert.equal((gen.world.anomalySmogCells?.length ?? 0) >= 400, true, `smog cells ${gen.world.anomalySmogCells?.length ?? 0}`);
  assert.equal(hqRooms.length >= 7, true, `archive HQ rooms ${hqRooms.length}`);
  assert.equal(hqRooms.every(room => room.sealed), true, 'archive HQ rooms should be sealed shelter cores');
  assert.equal(hqSupportRooms.length >= 15, true, `archive HQ support rooms ${hqSupportRooms.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(anchors.some(anchor => anchor.owner === owner), true, `missing HQ anchor ${owner}`);
    assert.equal(hqOwners.has(owner), true, `missing HQ room owner ${owner}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `missing territory cells ${owner}`);
  }
  assert.equal(dominant, ZoneFaction.CITIZEN);
  assert.equal(share(ZoneFaction.CITIZEN) >= 0.54 && share(ZoneFaction.CITIZEN) <= 0.58, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(share(ZoneFaction.LIQUIDATOR) >= 0.15 && share(ZoneFaction.LIQUIDATOR) <= 0.19, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(share(ZoneFaction.CULTIST) >= 0.05 && share(ZoneFaction.CULTIST) <= 0.09, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(share(ZoneFaction.SCIENTIST) >= 0.06 && share(ZoneFaction.SCIENTIST) <= 0.10, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(share(ZoneFaction.WILD) >= 0.10 && share(ZoneFaction.WILD) <= 0.14, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.7, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 026 procedural archive false-safe citizen floor has cult foothold and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, 25);
  assert.equal(spec.z, 25);
  assert.equal(spec.geometryId, 'archive_warrens');
  assert.equal(spec.majorityId, 'citizens');
  assert.equal(spec.anomalyId, 'false_safe_block');
  assert.equal(spec.danger, 3);

  const gen = timedProceduralSpec(spec, 'genfix 026 procedural archive false-safe citizens seed=61061 z25');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const archiveMicroRooms = gen.world.rooms.filter(room =>
    room.name.startsWith('Архивная ячейка') ||
    room.name.startsWith('Архивная будка') ||
    room.name.startsWith('Боковой регистр'));
  const hqRooms = gen.world.rooms.filter(room => room.type === RoomType.HQ);
  const hqSupportRooms = gen.world.rooms.filter(room => room.name.startsWith('Архивная опора'));
  const hqOwners = new Set(hqRooms.map(room => territoryOwnerAtIndex(gen.world, gen.world.idx(room.x + (room.w >> 1), room.y + (room.h >> 1)))));
  const falseSafeRooms = gen.world.rooms.filter(room => room.name.startsWith(FALSE_SAFE_BLOCK_ROOM_PREFIX));
  const anchors = territoryHqAnchors(gen.world);
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const totalCells = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / totalCells;
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    if (entity.faction === undefined) return false;
    const owner = territoryOwnerAtIndex(gen.world, gen.world.idx(Math.floor(entity.x), Math.floor(entity.y)));
    return territoryOwnerToFaction(owner) === entity.faction;
  });

  assert.equal(gen.world.rooms.length >= 1500, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 2400, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 125_000, true, `reachable ${reachable}`);
  assert.equal(archiveMicroRooms.length >= 1200, true, `archive micro rooms ${archiveMicroRooms.length}`);
  assert.equal(hqRooms.length >= 7, true, `archive HQ rooms ${hqRooms.length}`);
  assert.equal(hqRooms.every(room => room.sealed), true, 'archive HQ rooms should be sealed shelter cores');
  assert.equal(hqSupportRooms.length >= 15, true, `archive HQ support rooms ${hqSupportRooms.length}`);
  assert.equal(falseSafeRooms.length >= 4, true, `false-safe rooms ${falseSafeRooms.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(anchors.some(anchor => anchor.owner === owner), true, `missing HQ anchor ${owner}`);
    assert.equal(hqOwners.has(owner), true, `missing HQ room owner ${owner}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `missing territory cells ${owner}`);
  }
  for (const room of falseSafeRooms) {
    const centerOwner = territoryOwnerAtIndex(gen.world, gen.world.idx(room.x + (room.w >> 1), room.y + (room.h >> 1)));
    assert.equal(centerOwner, ZoneFaction.CULTIST, `${room.name} should be cult territory`);
  }
  assert.equal(dominant, ZoneFaction.CITIZEN);
  assert.equal(share(ZoneFaction.CITIZEN) >= 0.52 && share(ZoneFaction.CITIZEN) <= 0.55, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(share(ZoneFaction.LIQUIDATOR) >= 0.15 && share(ZoneFaction.LIQUIDATOR) <= 0.17, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(share(ZoneFaction.CULTIST) >= 0.11 && share(ZoneFaction.CULTIST) <= 0.13, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(share(ZoneFaction.SCIENTIST) >= 0.07 && share(ZoneFaction.SCIENTIST) <= 0.09, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(share(ZoneFaction.WILD) >= 0.10 && share(ZoneFaction.WILD) <= 0.12, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.7, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 034 procedural apartment samosbor route has dense blocks and cell territory anchors', () => {
  const spec = makeProceduralFloorSpec(61_061, 17);
  assert.equal(spec.z, 17);
  assert.equal(spec.geometryId, 'apartment_pressure');
  assert.equal(spec.majorityId, 'citizens');
  assert.equal(spec.anomalyId, 'samosbor_seed');
  assert.equal(spec.danger, 4);

  const gen = timedProceduralSpec(spec, 'genfix 034 apartment_pressure samosbor citizens seed=61061 z17');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const anchors = territoryHqAnchors(gen.world);
  const anchorOwners = new Set(anchors.map(anchor => anchor.owner));

  assert.equal(gen.world.rooms.length >= 900, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 900, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 125_000, true, `reachable ${reachable}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(anchorOwners.has(owner), true, `missing HQ anchor ${owner}`);
    assert.equal(territoryCellCount(gen.world, owner) > 0, true, `missing territory cells ${owner}`);
  }

  assertTerritoryShare(gen.world, ZoneFaction.CITIZEN, 0.47, 0.56);
  assertTerritoryShare(gen.world, ZoneFaction.LIQUIDATOR, 0.12, 0.18);
  assertTerritoryShare(gen.world, ZoneFaction.CULTIST, 0.04, 0.09);
  assertTerritoryShare(gen.world, ZoneFaction.SCIENTIST, 0.05, 0.10);
  assertTerritoryShare(gen.world, ZoneFaction.WILD, 0.08, 0.14);
  assertTerritoryShare(gen.world, ZoneFaction.SAMOSBOR, 0.08, 0.13);
});

testGenerationMatrix('genfix 046 procedural apartment cement-memory citizens floor has courts and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, 5);
  assert.equal(spec.z, 5);
  assert.equal(spec.geometryId, 'apartment_pressure');
  assert.equal(spec.majorityId, 'citizens');
  assert.equal(spec.anomalyId, 'cement_memory');
  assert.equal(spec.danger, 3);

  const gen = timedProceduralSpec(spec, 'genfix 046 apartment_pressure cement_memory citizens seed=61061 z5');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const anchors = territoryHqAnchors(gen.world);
  const anchorOwners = new Set(anchors.map(anchor => anchor.owner));
  const memoryCourtRooms = gen.world.rooms.filter(room => room.name.startsWith('Цементный двор памяти'));
  let reachableMemoryCourtRooms = 0;
  for (const room of memoryCourtRooms) {
    let roomReachable = false;
    for (let dy = 0; dy < room.h && !roomReachable; dy++) {
      for (let dx = 0; dx < room.w && !roomReachable; dx++) {
        const ci = gen.world.idx(room.x + dx, room.y + dy);
        if (gen.world.roomMap[ci] === room.id && audit.reachable[ci]) roomReachable = true;
      }
    }
    if (roomReachable) reachableMemoryCourtRooms++;
  }
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const owner = territoryOwnerAtIndex(gen.world, gen.world.idx(Math.floor(entity.x), Math.floor(entity.y)));
    return territoryOwnerToFaction(owner) === entity.faction;
  });

  assert.equal(gen.world.rooms.length >= 3_000, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 4_300, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 255_000, true, `reachable ${reachable}`);
  assert.equal(memoryCourtRooms.length >= 240, true, `cement-memory rooms ${memoryCourtRooms.length}`);
  assert.equal(reachableMemoryCourtRooms, memoryCourtRooms.length, `reachable cement-memory rooms ${reachableMemoryCourtRooms}/${memoryCourtRooms.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(anchorOwners.has(owner), true, `missing HQ anchor ${owner}`);
    assert.equal(territoryCellCount(gen.world, owner) > 0, true, `missing territory cells ${owner}`);
  }

  assertTerritoryShare(gen.world, ZoneFaction.CITIZEN, 0.54, 0.58);
  assertTerritoryShare(gen.world, ZoneFaction.LIQUIDATOR, 0.15, 0.19);
  assertTerritoryShare(gen.world, ZoneFaction.CULTIST, 0.055, 0.085);
  assertTerritoryShare(gen.world, ZoneFaction.SCIENTIST, 0.065, 0.095);
  assertTerritoryShare(gen.world, ZoneFaction.WILD, 0.105, 0.135);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.78, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('collector geometry records wet basins, dry causeways and valve route choices', () => {
  const def = FLOOR_GEOMETRIES.find(item => item.id === 'collectors');
  assert.equal(def?.tags.includes('water'), true);
  const z = proceduralZForGeometry(def!);
  const base = makeProceduralFloorSpec(40_040, z);
  const gen = timedProceduralSpec({
    ...base,
    geometryId: 'collectors',
    baseFloor: FloorLevel.MAINTENANCE,
    majorityId: 'liquidators',
    anomalyId: 'none',
    danger: 4,
    title: `коллекторы: ${base.title}`,
  }, 'forced collectors seed=40040');
  const audit = reachabilityAudit(gen);
  const metrics = measureCollectorDecisionMetrics(gen);
  const valveRooms = gen.world.rooms.filter(room => room.name.startsWith('Вентильная седловина'));

  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(metrics.wetBasinCells >= 1200, true, `wet cells ${metrics.wetBasinCells}`);
  assert.equal(metrics.dryCausewayCells >= 180, true, `dry causeway cells ${metrics.dryCausewayCells}`);
  assert.equal(metrics.repairCrossingCells >= 12, true, `repair crossing cells ${metrics.repairCrossingCells}`);
  assert.equal(metrics.valveRoomCount >= 2, true, `valve rooms ${metrics.valveRoomCount}`);
  assert.equal(metrics.wetRouteLength > 0, true, `wet route ${metrics.wetRouteLength}`);
  assert.equal(metrics.dryRouteLength > metrics.wetRouteLength, true, `dry ${metrics.dryRouteLength} wet ${metrics.wetRouteLength}`);
  assert.equal(metrics.actualWetPathLength > 0, true, `actual wet path ${metrics.actualWetPathLength}`);
  assert.equal(metrics.actualDryPathLength > 0, true, `actual dry path ${metrics.actualDryPathLength}`);
  assert.equal(metrics.dryReachableUpLifts >= 1, true, `dry up lifts ${metrics.dryReachableUpLifts}`);
  assert.equal(metrics.dryReachableDownLifts >= 1, true, `dry down lifts ${metrics.dryReachableDownLifts}`);
  assert.equal(gen.world.containers.some(container => container.tags.includes('collector_valve') && container.tags.includes('tool_repair')), true);

  for (const room of valveRooms.slice(0, 2)) {
    const ci = gen.world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2));
    assertAuditReachable(gen.world, audit, ci, `${room.name} center`);
  }
});

testProceduralFloorFullMatrix('all procedural anomalies can be forced and keep route lifts usable', () => {
  for (let i = 0; i < FLOOR_ANOMALIES.length; i++) {
    const def = FLOOR_ANOMALIES[i];
    const base = makeProceduralFloorSpec(303_002 + i, 9);
    const gen = timedProceduralSpec({
      ...base,
      anomalyId: def.id,
      danger: Math.max(def.minDanger, base.danger) as ProceduralFloorSpec['danger'],
      title: `${def.title}: ${base.title}`,
    }, 'forced anomaly contract');
    const audit = reachabilityAudit(gen);

    assert.equal(gen.world.rooms.length > 0, true, `${def.id} should preserve generated rooms`);
    assert.equal(gen.world.cells[gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))], Cell.FLOOR, `${def.id} spawn cell`);
    assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true, `${def.id} up lift`);
    assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true, `${def.id} down lift`);
  }
});

testGenerationMatrix('sandpile perekrytie anomaly seeds a cracked arena with safe rim and stabilizer', () => {
  const def = FLOOR_GEOMETRIES.find(item => item.id === 'workshops');
  assert.ok(def);
  const base = makeProceduralFloorSpec(73_073, proceduralZForGeometry(def));
  const gen = timedProceduralSpec({
    ...base,
    geometryId: 'workshops',
    baseFloor: FloorLevel.MAINTENANCE,
    majorityId: 'liquidators',
    anomalyId: 'sandpile_perekrytie',
    danger: 4,
    title: `песчаное перекрытие: ${base.title}`,
  }, 'forced sandpile_perekrytie seed=73073');
  const audit = reachabilityAudit(gen);
  const sandpileRooms = gen.world.rooms.filter(room => room.name.includes('[sandpile_perekrytie:'));

  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(sandpileRooms.length >= 1, true, 'sandpile arena room should be tagged');

  let apparatus = 0;
  let crackedReachableCells = 0;
  let seamWalls = 0;
  let stableRimCells = 0;
  for (const room of sandpileRooms) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        const ci = gen.world.idx(x, y);
        if (gen.world.roomMap[ci] !== room.id) continue;
        if (gen.world.features[ci] === Feature.APPARATUS) apparatus++;
        if (gen.world.cells[ci] === Cell.WALL && gen.world.wallTex[ci] === Tex.CONCRETE) seamWalls++;
        if (gen.world.cells[ci] === Cell.FLOOR && gen.world.floorTex[ci] === Tex.F_TILE && audit.reachable[ci]) stableRimCells++;
        if (audit.reachable[ci] && (gen.world.floorTex[ci] === Tex.F_GUT || gen.world.fog[ci] >= 34)) crackedReachableCells++;
      }
    }
  }

  assert.equal(apparatus >= sandpileRooms.length, true, 'each sandpile arena should have a stabilizer');
  assert.equal(seamWalls >= 6, true, 'sandpile arena should include a brittle wall seam');
  assert.equal(stableRimCells >= 12, true, 'sandpile arena should leave a reachable safe rim route');
  assert.equal(crackedReachableCells >= 24, true, 'sandpile arena should visibly warn reachable players');
  assert.equal(
    gen.entities.some(entity => entity.type === EntityType.ITEM_DROP && entity.inventory?.some(item => item.defId === 'metal_sheet' || item.defId === 'sealant_tube')) ||
      gen.world.containers.some(container => container.inventory.some(item => item.defId === 'metal_sheet' || item.defId === 'sealant_tube')),
    true,
    'sandpile arena should seed stabilizer supplies',
  );
});

testGenerationMatrix('genfix 062 collector zombie apocalypse floor has residential scale and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, -11);
  assert.equal(spec.geometryId, 'collectors');
  assert.equal(spec.majorityId, 'wild');
  assert.equal(spec.anomalyId, 'zombie_apocalypse');
  assert.equal(spec.danger, 4);

  const gen = timedProceduralSpec(spec, 'genfix_062 collectors zombie wild seed=61061 z-11');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const infectedResidentialRooms = gen.world.rooms.filter(room => room.name.startsWith('Зараженный жилблок'));
  const reachableResidentialRooms = infectedResidentialRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const stationRooms = gen.world.rooms.filter(room =>
    room.name.startsWith('Насосная станция коллектора') ||
    room.name.startsWith('Кладовая вентилей коллектора') ||
    room.name.startsWith('Смотровая будка коллектора') ||
    room.name.startsWith('Санузел смены коллектора') ||
    room.name.startsWith('Сухая бытовка коллектора'));
  const reachableStationRooms = stationRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const microStationRooms = stationRooms.filter(room => room.w * room.h <= 90);
  const routeCues = getRouteCueMarkers(gen.world).filter(marker =>
    marker.tags.includes('collectors') &&
    marker.tags.includes('zombie_apocalypse') &&
    marker.tags.includes('residential_infill'));
  const anchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(anchors.map(anchor => anchor.owner));
  const hqRooms = anchors
    .map(anchor => gen.world.rooms[anchor.roomId])
    .filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });

  assertFullFootprint(gen.world, 'genfix_062 collectors zombie apocalypse');
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(reachableBucketCount(gen.world, audit.reachable, 128) >= 63, true);
  assert.equal(gen.world.rooms.length >= 1_900, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 2_800, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 300_000, true, `reachable ${reachable}`);
  assert.equal(infectedResidentialRooms.length >= 1_600, true, `infected residential rooms ${infectedResidentialRooms.length}`);
  assert.equal(reachableResidentialRooms.length >= 1_500, true, `reachable infected residential rooms ${reachableResidentialRooms.length}`);
  assert.equal(stationRooms.length >= 130, true, `collector station rooms ${stationRooms.length}`);
  assert.equal(reachableStationRooms.length >= 120, true, `reachable collector station rooms ${reachableStationRooms.length}`);
  assert.equal(microStationRooms.length >= 120, true, `collector micro rooms ${microStationRooms.length}`);
  assert.equal(routeCues.length >= 1, true, 'collector zombie residential route cue');

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = anchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 15, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(dominant, ZoneFaction.WILD);
  assertTerritoryShare(gen.world, ZoneFaction.CITIZEN, 0.24, 0.26);
  assertTerritoryShare(gen.world, ZoneFaction.LIQUIDATOR, 0.11, 0.13);
  assertTerritoryShare(gen.world, ZoneFaction.CULTIST, 0.11, 0.13);
  assertTerritoryShare(gen.world, ZoneFaction.SCIENTIST, 0.08, 0.10);
  assertTerritoryShare(gen.world, ZoneFaction.WILD, 0.41, 0.43);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.75, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 072 sandpile collectors liquidator floor has station scale and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, -21);
  assert.equal(spec.geometryId, 'collectors');
  assert.equal(spec.majorityId, 'liquidators');
  assert.equal(spec.anomalyId, 'sandpile_perekrytie');
  assert.equal(spec.danger, 4);

  const gen = timedProceduralSpec(spec, 'genfix_072 collectors sandpile liquidators seed=61061 z-21');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const stationRooms = gen.world.rooms.filter(room =>
    room.name.startsWith('Насосная станция коллектора') ||
    room.name.startsWith('Кладовая вентилей коллектора') ||
    room.name.startsWith('Смотровая будка коллектора') ||
    room.name.startsWith('Санузел смены коллектора') ||
    room.name.startsWith('Сухая бытовка коллектора'));
  const reachableStationRooms = stationRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const microRooms = stationRooms.filter(room => room.w * room.h <= 90);
  const sandpileRooms = gen.world.rooms.filter(room => room.name.includes('[sandpile_perekrytie:'));
  const metrics = measureCollectorDecisionMetrics(gen);
  const anchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(anchors.map(anchor => anchor.owner));
  const hqRooms = anchors
    .map(anchor => gen.world.rooms[anchor.roomId])
    .filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });

  assertFullFootprint(gen.world, 'genfix_072 collectors sandpile');
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(reachableBucketCount(gen.world, audit.reachable, 128) >= 63, true);
  assert.equal(gen.world.rooms.length >= 320, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 730, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 225_000, true, `reachable ${reachable}`);
  assert.equal(stationRooms.length >= 200, true, `collector station rooms ${stationRooms.length}`);
  assert.equal(reachableStationRooms.length >= 200, true, `reachable collector station rooms ${reachableStationRooms.length}`);
  assert.equal(microRooms.length >= 200, true, `collector micro rooms ${microRooms.length}`);
  assert.equal(sandpileRooms.length >= 1, true, `sandpile rooms ${sandpileRooms.length}`);
  assert.equal(metrics.wetBasinCells >= 120_000, true, `wet basin cells ${metrics.wetBasinCells}`);
  assert.equal(metrics.dryCausewayCells >= 9_000, true, `dry causeway cells ${metrics.dryCausewayCells}`);
  assert.equal(metrics.valveRoomCount >= 3, true, `valve rooms ${metrics.valveRoomCount}`);
  assert.equal(metrics.dryReachableUpLifts >= 1, true, `dry up lifts ${metrics.dryReachableUpLifts}`);
  assert.equal(metrics.dryReachableDownLifts >= 1, true, `dry down lifts ${metrics.dryReachableDownLifts}`);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = anchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 15, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(dominant, ZoneFaction.LIQUIDATOR);
  assertTerritoryShare(gen.world, ZoneFaction.CITIZEN, 0.15, 0.19);
  assertTerritoryShare(gen.world, ZoneFaction.LIQUIDATOR, 0.54, 0.58);
  assertTerritoryShare(gen.world, ZoneFaction.CULTIST, 0.05, 0.09);
  assertTerritoryShare(gen.world, ZoneFaction.SCIENTIST, 0.06, 0.10);
  assertTerritoryShare(gen.world, ZoneFaction.WILD, 0.10, 0.14);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.75, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 090 smog collectors liquidator floor has dense stations, smog pockets and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, -39);
  assert.equal(spec.geometryId, 'collectors');
  assert.equal(spec.majorityId, 'liquidators');
  assert.equal(spec.anomalyId, 'smog');
  assert.equal(spec.danger, 4);

  const gen = timedProceduralSpec(spec, 'genfix_090 collectors smog liquidators seed=61061 z-39');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const stationRooms = gen.world.rooms.filter(room =>
    room.name.startsWith('Насосная станция коллектора') ||
    room.name.startsWith('Кладовая вентилей коллектора') ||
    room.name.startsWith('Смотровая будка коллектора') ||
    room.name.startsWith('Санузел смены коллектора') ||
    room.name.startsWith('Сухая бытовка коллектора'));
  const reachableStationRooms = stationRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const microRooms = stationRooms.filter(room => room.w * room.h <= 90);
  const metrics = measureCollectorDecisionMetrics(gen);
  const anchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(anchors.map(anchor => anchor.owner));
  const hqRooms = anchors
    .map(anchor => gen.world.rooms[anchor.roomId])
    .filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });

  assertFullFootprint(gen.world, 'genfix_090 collectors smog');
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(reachableBucketCount(gen.world, audit.reachable, 128) >= 63, true);
  assert.equal(gen.world.rooms.length >= 370, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 800, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 245_000, true, `reachable ${reachable}`);
  assert.equal(stationRooms.length >= 260, true, `collector station rooms ${stationRooms.length}`);
  assert.equal(reachableStationRooms.length >= 260, true, `reachable collector station rooms ${reachableStationRooms.length}`);
  assert.equal(microRooms.length >= 260, true, `collector micro rooms ${microRooms.length}`);
  assert.equal((gen.world.anomalySmogCells?.length ?? 0) >= 900, true, `smog cells ${gen.world.anomalySmogCells?.length ?? 0}`);
  assert.equal(metrics.wetBasinCells >= 120_000, true, `wet basin cells ${metrics.wetBasinCells}`);
  assert.equal(metrics.dryCausewayCells >= 9_000, true, `dry causeway cells ${metrics.dryCausewayCells}`);
  assert.equal(metrics.valveRoomCount >= 3, true, `valve rooms ${metrics.valveRoomCount}`);
  assert.equal(metrics.dryReachableUpLifts >= 1, true, `dry up lifts ${metrics.dryReachableUpLifts}`);
  assert.equal(metrics.dryReachableDownLifts >= 1, true, `dry down lifts ${metrics.dryReachableDownLifts}`);
  assert.equal(gen.world.containers.some(container => container.tags.includes('collector_valve')), true, 'collector valve container');
  assert.equal(gen.world.containers.some(container => container.tags.includes('liquidator_checkpoint')), true, 'liquidator checkpoint container');

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = anchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 15, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(dominant, ZoneFaction.LIQUIDATOR);
  assertTerritoryShare(gen.world, ZoneFaction.CITIZEN, 0.15, 0.19);
  assertTerritoryShare(gen.world, ZoneFaction.LIQUIDATOR, 0.54, 0.58);
  assertTerritoryShare(gen.world, ZoneFaction.CULTIST, 0.05, 0.09);
  assertTerritoryShare(gen.world, ZoneFaction.SCIENTIST, 0.06, 0.10);
  assertTerritoryShare(gen.world, ZoneFaction.WILD, 0.10, 0.14);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.75, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 088 mirror collectors citizen floor has mirrored infill and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, -37);
  assert.equal(spec.geometryId, 'collectors');
  assert.equal(spec.majorityId, 'citizens');
  assert.equal(spec.anomalyId, 'mirror_run');
  assert.equal(spec.danger, 4);

  const gen = timedProceduralSpec(spec, 'genfix_088 collectors mirror citizens seed=61061 z-37');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const stationRooms = gen.world.rooms.filter(room =>
    room.name.startsWith('Насосная станция коллектора') ||
    room.name.startsWith('Кладовая вентилей коллектора') ||
    room.name.startsWith('Смотровая будка коллектора') ||
    room.name.startsWith('Санузел смены коллектора') ||
    room.name.startsWith('Сухая бытовка коллектора'));
  const mirrorRooms = gen.world.rooms.filter(room =>
    room.name.startsWith('Зеркальная галерея коллектора') ||
    room.name.startsWith('Санузел зеркальной смены') ||
    room.name.startsWith('Кухня сухой проводки') ||
    room.name.startsWith('Кабельная насосная зеркала') ||
    room.name.startsWith('Будка сверки зеркала') ||
    room.name.startsWith('Склад зеркального кабеля') ||
    room.name.startsWith('Бытовка зеркальной проводки'));
  const reachableMirrorRooms = mirrorRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const mirrorGalleryRooms = gen.world.rooms.filter(room => room.name.startsWith('Зеркальная галерея коллектора'));
  const routeCues = getRouteCueMarkers(gen.world).filter(marker => marker.tags.includes('collector_mirror_infill'));
  const metrics = measureCollectorDecisionMetrics(gen);
  const anchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(anchors.map(anchor => anchor.owner));
  const hqRooms = anchors
    .map(anchor => gen.world.rooms[anchor.roomId])
    .filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });

  assertFullFootprint(gen.world, 'genfix_088 collectors mirror');
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(reachableBucketCount(gen.world, audit.reachable, 128) >= 63, true);
  assert.equal(gen.world.rooms.length >= 500, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 1_200, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 250_000, true, `reachable ${reachable}`);
  assert.equal(stationRooms.length >= 200, true, `collector station rooms ${stationRooms.length}`);
  assert.equal(mirrorRooms.length >= 160, true, `collector mirror rooms ${mirrorRooms.length}`);
  assert.equal(reachableMirrorRooms.length >= 160, true, `reachable mirror rooms ${reachableMirrorRooms.length}`);
  assert.equal(mirrorGalleryRooms.length >= 20, true, `mirror galleries ${mirrorGalleryRooms.length}`);
  assert.equal(routeCues.length >= 1, true, 'collector mirror infill route cue');
  assert.equal(metrics.wetBasinCells >= 120_000, true, `wet basin cells ${metrics.wetBasinCells}`);
  assert.equal(metrics.dryCausewayCells >= 9_000, true, `dry causeway cells ${metrics.dryCausewayCells}`);
  assert.equal(metrics.valveRoomCount >= 3, true, `valve rooms ${metrics.valveRoomCount}`);
  assert.equal(metrics.dryReachableUpLifts >= 1, true, `dry up lifts ${metrics.dryReachableUpLifts}`);
  assert.equal(metrics.dryReachableDownLifts >= 1, true, `dry down lifts ${metrics.dryReachableDownLifts}`);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = anchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 15, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(dominant, ZoneFaction.CITIZEN);
  assertTerritoryShare(gen.world, ZoneFaction.CITIZEN, 0.54, 0.58);
  assertTerritoryShare(gen.world, ZoneFaction.LIQUIDATOR, 0.15, 0.19);
  assertTerritoryShare(gen.world, ZoneFaction.CULTIST, 0.05, 0.09);
  assertTerritoryShare(gen.world, ZoneFaction.SCIENTIST, 0.06, 0.10);
  assertTerritoryShare(gen.world, ZoneFaction.WILD, 0.10, 0.14);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.75, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('mushroom mycelium anomaly grows visible reachable food and spore territory', () => {
  const base = makeProceduralFloorSpec(53_053, 9);
  const gen = timedProceduralSpec({
    ...base,
    anomalyId: 'mushroom_mycelium',
    danger: 4,
    title: `грибница: ${base.title}`,
  }, 'forced mushroom mycelium seed=53053');
  const audit = reachabilityAudit(gen);
  const myceliumRooms = gen.world.rooms.filter(room => room.name.startsWith('Грибничный карман'));
  let reachableMyceliumRooms = 0;
  let visibleReachableCells = 0;
  for (let i = 0; i < gen.world.cells.length; i++) {
    const roomId = gen.world.roomMap[i];
    if (roomId >= 0 && gen.world.rooms[roomId]?.name.startsWith('Грибничный карман') && audit.reachable[i]) {
      if (gen.world.floorTex[i] === Tex.F_GUT || gen.world.fog[i] >= 32) visibleReachableCells++;
    }
  }
  for (const room of myceliumRooms) {
    if (roomHasReachableCell(gen.world, audit, room)) reachableMyceliumRooms++;
  }

  const foodBasins = gen.world.containers.filter(container => container.tags.includes('mycelium_basin') && container.tags.includes('food_reward'));
  const sporeBasins = gen.world.containers.filter(container => container.tags.includes('mycelium_basin') && container.tags.includes('spore_reward'));
  const fungalMonsters = gen.entities.filter(entity => entity.type === EntityType.MONSTER && (
    entity.monsterKind === MonsterKind.BORSHCHEVIK ||
    entity.monsterKind === MonsterKind.SLIMEVIK
  ));

  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(myceliumRooms.length >= 8, true, `mycelium rooms ${myceliumRooms.length}`);
  assert.equal(reachableMyceliumRooms >= 8, true, `reachable mycelium rooms ${reachableMyceliumRooms}`);
  assert.equal(visibleReachableCells >= 120, true, `visible mycelium cells ${visibleReachableCells}`);
  assert.equal(foodBasins.length >= 1, true);
  assert.equal(sporeBasins.length >= 1, true);
  assert.equal(fungalMonsters.length >= 1, true);
  for (const container of [...foodBasins, ...sporeBasins]) {
    assert.equal(audit.reachable[gen.world.idx(container.x, container.y)], 1, `${container.name} should be reachable`);
    assert.equal(container.tags.includes('visible_risk_cue'), true);
  }
});



testGenerationMatrix('genfix 038 apartment pressure z13 citizens floor has dense blocks and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, 13);
  assert.equal(spec.geometryId, 'apartment_pressure');
  assert.equal(spec.majorityId, 'citizens');
  assert.equal(spec.anomalyId, 'none');
  assert.equal(spec.danger, 2);

  const gen = timedProceduralSpec(spec, 'genfix_038 apartment_pressure citizens seed=61061');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const denseRooms = gen.world.rooms.filter(room => room.name.startsWith('Квартирная давка'));
  const hqRooms = gen.world.rooms.filter(room => room.type === RoomType.HQ);
  const hqSupportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const hqOwners = new Set(hqRooms.map(room => territoryOwnerAtIndex(gen.world, gen.world.idx(room.x + (room.w >> 1), room.y + (room.h >> 1)))));
  const anchors = territoryHqAnchors(gen.world);
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const totalCells = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / totalCells;
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    if (entity.faction === undefined) return false;
    const owner = territoryOwnerAtIndex(gen.world, gen.world.idx(Math.floor(entity.x), Math.floor(entity.y)));
    return territoryOwnerToFaction(owner) === entity.faction;
  });

  assert.equal(gen.world.rooms.length >= 950, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 1500, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 120_000, true, `reachable ${reachable}`);
  assert.equal(denseRooms.length >= 800, true, `dense rooms ${denseRooms.length}`);
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(hqRooms.every(room => room.sealed), true, 'HQ rooms should be sealed shelter cores');
  assert.equal(hqSupportRooms.length >= 15, true, `HQ support rooms ${hqSupportRooms.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(anchors.some(anchor => anchor.owner === owner), true, `missing HQ anchor ${ZoneFaction[owner]}`);
    assert.equal(hqOwners.has(owner), true, `missing HQ room owner ${ZoneFaction[owner]}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
  }
  assert.equal(dominant, ZoneFaction.CITIZEN);
  assert.equal(share(ZoneFaction.CITIZEN) >= 0.54 && share(ZoneFaction.CITIZEN) <= 0.58, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(share(ZoneFaction.LIQUIDATOR) >= 0.15 && share(ZoneFaction.LIQUIDATOR) <= 0.19, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(share(ZoneFaction.CULTIST) >= 0.05 && share(ZoneFaction.CULTIST) <= 0.09, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(share(ZoneFaction.SCIENTIST) >= 0.06 && share(ZoneFaction.SCIENTIST) <= 0.10, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(share(ZoneFaction.WILD) >= 0.10 && share(ZoneFaction.WILD) <= 0.14, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.75, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 042 apartment pressure z9 citizens floor has multi-scale dense apartments and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, 9);
  assert.equal(spec.z, 9);
  assert.equal(spec.geometryId, 'apartment_pressure');
  assert.equal(spec.majorityId, 'citizens');
  assert.equal(spec.anomalyId, 'none');
  assert.equal(spec.danger, 3);

  const gen = timedProceduralSpec(spec, 'genfix_042 apartment_pressure citizens seed=61061');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const denseRooms = gen.world.rooms.filter(room => room.name.startsWith('Квартирная давка'));
  const hqRooms = gen.world.rooms.filter(room => room.type === RoomType.HQ);
  const hqSupportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const hqOwners = new Set(hqRooms.map(room => territoryOwnerAtIndex(gen.world, gen.world.idx(room.x + (room.w >> 1), room.y + (room.h >> 1)))));
  const anchors = territoryHqAnchors(gen.world);
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const totalCells = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / totalCells;
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    if (entity.faction === undefined) return false;
    const owner = territoryOwnerAtIndex(gen.world, gen.world.idx(Math.floor(entity.x), Math.floor(entity.y)));
    return territoryOwnerToFaction(owner) === entity.faction;
  });

  assert.equal(gen.world.rooms.length >= 2500, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 3800, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 220_000, true, `reachable ${reachable}`);
  assert.equal(denseRooms.length >= 2400, true, `dense rooms ${denseRooms.length}`);
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(hqRooms.every(room => room.sealed), true, 'HQ rooms should be sealed shelter cores');
  assert.equal(hqSupportRooms.length >= 15, true, `HQ support rooms ${hqSupportRooms.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(anchors.some(anchor => anchor.owner === owner), true, `missing HQ anchor ${ZoneFaction[owner]}`);
    assert.equal(hqOwners.has(owner), true, `missing HQ room owner ${ZoneFaction[owner]}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
  }
  assert.equal(dominant, ZoneFaction.CITIZEN);
  assert.equal(share(ZoneFaction.CITIZEN) >= 0.54 && share(ZoneFaction.CITIZEN) <= 0.58, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(share(ZoneFaction.LIQUIDATOR) >= 0.15 && share(ZoneFaction.LIQUIDATOR) <= 0.19, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(share(ZoneFaction.CULTIST) >= 0.05 && share(ZoneFaction.CULTIST) <= 0.09, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(share(ZoneFaction.SCIENTIST) >= 0.06 && share(ZoneFaction.SCIENTIST) <= 0.10, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(share(ZoneFaction.WILD) >= 0.10 && share(ZoneFaction.WILD) <= 0.14, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.8, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});



testGenerationMatrix('genfix 050 living rail citizens floor fills map with blocks trains and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, 1);
  assert.equal(spec.geometryId, 'living_blocks');
  assert.equal(spec.majorityId, 'citizens');
  assert.equal(spec.anomalyId, 'rail_trains');
  assert.equal(spec.danger, 2);

  const gen = timedProceduralSpec(spec, 'genfix_050 living_blocks rail citizens seed=61061 z1');
  const audit = reachabilityAudit(gen);
  const blockRooms = gen.world.rooms.filter(room => room.name.startsWith('Домовой блок'));
  const platformRooms = gen.world.rooms.filter(room => room.name.includes('платформ') || room.name.includes('Платформ'));
  const reachablePlatformRooms = platformRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const territoryRows = countTerritoryCells(gen.world);
  const territoryByOwner = new Map(territoryRows.map(row => [row.owner, row.cells]));
  const hqOwners = new Set(territoryHqAnchors(gen.world).map(anchor => anchor.owner));
  const npcs = gen.entities.filter(e => e.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ownerFaction = territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, gen.world.idx(Math.floor(entity.x), Math.floor(entity.y))));
    return ownerFaction === entity.faction;
  });

  assert.equal(gen.world.rooms.length >= 900, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 900, true, `doors ${gen.world.doors.size}`);
  assert.equal(blockRooms.length >= 850, true, `block rooms ${blockRooms.length}`);
  assert.equal(countReachableCells(audit.reachable) >= 180_000, true, `reachable ${countReachableCells(audit.reachable)}`);
  assert.equal(reachableBucketCount(gen.world, audit.reachable, 64) >= 200, true, 'living rail floor should occupy most map-scale buckets');
  assert.equal(platformRooms.length >= 8, true, `platform service rooms ${platformRooms.length}`);
  assert.equal(reachablePlatformRooms.length >= 8, true, `reachable platform rooms ${reachablePlatformRooms.length}`);
  assert.equal(gen.world.railTracks.length >= 2, true, `rail tracks ${gen.world.railTracks.length}`);
  assert.equal(gen.world.railTrains.length >= 2, true, `rail trains ${gen.world.railTrains.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal((territoryByOwner.get(owner) ?? 0) > 0, true, `territory cells for ${owner}`);
    assert.equal(hqOwners.has(owner), true, `HQ owner ${owner}`);
  }
  assertTerritoryShare(gen.world, ZoneFaction.CITIZEN, 0.54, 0.58);
  assertTerritoryShare(gen.world, ZoneFaction.LIQUIDATOR, 0.15, 0.19);
  assertTerritoryShare(gen.world, ZoneFaction.CULTIST, 0.05, 0.09);
  assertTerritoryShare(gen.world, ZoneFaction.SCIENTIST, 0.06, 0.10);
  assertTerritoryShare(gen.world, ZoneFaction.WILD, 0.10, 0.14);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.75, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 048 procedural living blocks z3 scientific shift fills floor and owns territory', () => {
  const spec = makeProceduralFloorSpec(61_061, 3);
  assert.equal(spec.key, 'z3');
  assert.equal(spec.geometryId, 'living_blocks');
  assert.equal(spec.majorityId, 'scientists');
  assert.equal(spec.anomalyId, 'none');
  assert.equal(spec.danger, 1);

  const gen = timedProceduralSpec(spec, 'genfix_048 living_blocks scientists seed=61061 z3');
  const audit = reachabilityAudit(gen);
  const blockRooms = gen.world.rooms.filter(room => room.name.startsWith('Домовой блок'));
  const territoryRows = countTerritoryCells(gen.world);
  const territoryByOwner = new Map(territoryRows.map(row => [row.owner, row.cells]));
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const hqRooms = hqAnchors
    .map(anchor => gen.world.rooms[anchor.roomId])
    .filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const dominant = [...territoryByOwner.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const npcs = gen.entities.filter(e => e.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ownerFaction = territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, gen.world.idx(Math.floor(entity.x), Math.floor(entity.y))));
    return ownerFaction === entity.faction;
  });

  assert.equal(gen.world.rooms.length >= 1000, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 900, true, `doors ${gen.world.doors.size}`);
  assert.equal(blockRooms.length >= 1000, true, `block rooms ${blockRooms.length}`);
  assert.equal(countReachableCells(audit.reachable) >= 220_000, true, `reachable ${countReachableCells(audit.reachable)}`);
  assert.equal(reachableBucketCount(gen.world, audit.reachable, 64) >= 220, true, 'living blocks should occupy most map-scale buckets');
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(hqRooms.every(room => room?.sealed), true, 'HQ rooms should be sealed shelter cores');
  assert.equal(supportRooms.length >= 15, true, `HQ support rooms ${supportRooms.length}`);
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal((territoryByOwner.get(owner) ?? 0) > 0, true, `territory cells for ${owner}`);
    assert.equal(hqOwners.has(owner), true, `HQ owner ${owner}`);
  }
  assert.equal(dominant, ZoneFaction.SCIENTIST);
  assertTerritoryShare(gen.world, ZoneFaction.CITIZEN, 0.20, 0.24);
  assertTerritoryShare(gen.world, ZoneFaction.LIQUIDATOR, 0.14, 0.18);
  assertTerritoryShare(gen.world, ZoneFaction.CULTIST, 0.06, 0.10);
  assertTerritoryShare(gen.world, ZoneFaction.SCIENTIST, 0.40, 0.44);
  assertTerritoryShare(gen.world, ZoneFaction.WILD, 0.10, 0.14);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.75, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 052 procedural living blocks scientific shift fills floor and owns territory from HQ anchors', () => {
  const spec = makeProceduralFloorSpec(61_061, -1);
  assert.equal(spec.geometryId, 'living_blocks');
  assert.equal(spec.majorityId, 'scientists');
  assert.equal(spec.anomalyId, 'none');
  assert.equal(spec.danger, 2);

  const gen = timedProceduralSpec(spec, 'genfix_052 living_blocks scientists seed=61061 z-1');
  const audit = reachabilityAudit(gen);
  const blockRooms = gen.world.rooms.filter(room => room.name.startsWith('Домовой блок'));
  const territoryRows = countTerritoryCells(gen.world);
  const territoryByOwner = new Map(territoryRows.map(row => [row.owner, row.cells]));
  const hqOwners = new Set(territoryHqAnchors(gen.world).map(anchor => anchor.owner));
  const npcs = gen.entities.filter(e => e.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ownerFaction = territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, gen.world.idx(Math.floor(entity.x), Math.floor(entity.y))));
    return ownerFaction === entity.faction;
  });

  assert.equal(gen.world.rooms.length >= 1100, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 1000, true, `doors ${gen.world.doors.size}`);
  assert.equal(blockRooms.length >= 1000, true, `block rooms ${blockRooms.length}`);
  assert.equal(countReachableCells(audit.reachable) >= 220_000, true, `reachable ${countReachableCells(audit.reachable)}`);
  assert.equal(reachableBucketCount(gen.world, audit.reachable, 64) >= 180, true, 'living blocks should occupy most map-scale buckets');
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal((territoryByOwner.get(owner) ?? 0) > 0, true, `territory cells for ${owner}`);
    assert.equal(hqOwners.has(owner), true, `HQ owner ${owner}`);
  }
  assertTerritoryShare(gen.world, ZoneFaction.CITIZEN, 0.20, 0.24);
  assertTerritoryShare(gen.world, ZoneFaction.LIQUIDATOR, 0.14, 0.18);
  assertTerritoryShare(gen.world, ZoneFaction.CULTIST, 0.06, 0.10);
  assertTerritoryShare(gen.world, ZoneFaction.SCIENTIST, 0.40, 0.44);
  assertTerritoryShare(gen.world, ZoneFaction.WILD, 0.10, 0.14);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.75, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 056 procedural living smog citizens floor fills map and keeps target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, -5);
  assert.equal(spec.geometryId, 'living_blocks');
  assert.equal(spec.majorityId, 'citizens');
  assert.equal(spec.anomalyId, 'smog');
  assert.equal(spec.danger, 2);

  const gen = timedProceduralSpec(spec, 'genfix_056 living_blocks smog citizens seed=61061 z-5');
  const audit = reachabilityAudit(gen);
  const blockRooms = gen.world.rooms.filter(room => room.name.startsWith('Домовой блок'));
  const territoryRows = countTerritoryCells(gen.world);
  const territoryByOwner = new Map(territoryRows.map(row => [row.owner, row.cells]));
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const hqRooms = hqAnchors
    .map(anchor => gen.world.rooms[anchor.roomId])
    .filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const npcs = gen.entities.filter(e => e.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ownerFaction = territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, gen.world.idx(Math.floor(entity.x), Math.floor(entity.y))));
    return ownerFaction === entity.faction;
  });

  assert.equal(gen.world.rooms.length >= 850, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 900, true, `doors ${gen.world.doors.size}`);
  assert.equal(blockRooms.length >= 820, true, `block rooms ${blockRooms.length}`);
  assert.equal(countReachableCells(audit.reachable) >= 180_000, true, `reachable ${countReachableCells(audit.reachable)}`);
  assert.equal(reachableBucketCount(gen.world, audit.reachable, 64) >= 170, true, 'living smog floor should occupy most map-scale buckets');
  assert.equal(gen.world.anomalySmogCells.length >= 500, true, `smog cells ${gen.world.anomalySmogCells.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal((territoryByOwner.get(owner) ?? 0) > 0, true, `territory cells for ${owner}`);
    assert.equal(hqOwners.has(owner), true, `HQ owner ${owner}`);
    const anchor = hqAnchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.sealed, true, `HQ sealed ${owner}`);
    assert.equal(room?.doors.some(doorIdx => {
      const door = gen.world.doors.get(doorIdx);
      return door?.state === DoorState.HERMETIC_OPEN || door?.state === DoorState.HERMETIC_CLOSED;
    }), true, `HQ hermetic door ${owner}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 15, true, `HQ support rooms ${supportRooms.length}`);
  assertTerritoryShare(gen.world, ZoneFaction.CITIZEN, 0.54, 0.58);
  assertTerritoryShare(gen.world, ZoneFaction.LIQUIDATOR, 0.15, 0.19);
  assertTerritoryShare(gen.world, ZoneFaction.CULTIST, 0.05, 0.09);
  assertTerritoryShare(gen.world, ZoneFaction.SCIENTIST, 0.06, 0.10);
  assertTerritoryShare(gen.world, ZoneFaction.WILD, 0.10, 0.14);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.75, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 060 procedural hladon living blocks scientific shift fills floor from HQ territory', () => {
  const spec = makeProceduralFloorSpec(61_061, -9);
  assert.equal(spec.geometryId, 'living_blocks');
  assert.equal(spec.majorityId, 'scientists');
  assert.equal(spec.anomalyId, 'hladon');
  assert.equal(spec.danger, 3);

  const gen = timedProceduralSpec(spec, 'genfix_060 living_blocks hladon scientists seed=61061 z-9');
  const audit = reachabilityAudit(gen);
  const blockRooms = gen.world.rooms.filter(room => room.name.startsWith('Домовой блок'));
  const coldRooms = gen.world.rooms.filter(room => room.name.startsWith('Хладон:'));
  const hqRooms = gen.world.rooms.filter(room => room.type === RoomType.HQ);
  const hermeticHqs = hqRooms.filter(room =>
    room.sealed &&
    room.doors.some(doorIdx => {
      const door = gen.world.doors.get(doorIdx);
      return door?.state === DoorState.HERMETIC_OPEN || door?.state === DoorState.HERMETIC_CLOSED;
    })
  );
  const territoryRows = countTerritoryCells(gen.world);
  const territoryByOwner = new Map(territoryRows.map(row => [row.owner, row.cells]));
  const hqOwners = new Set(territoryHqAnchors(gen.world).map(anchor => anchor.owner));
  const npcs = gen.entities.filter(e => e.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ownerFaction = territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, gen.world.idx(Math.floor(entity.x), Math.floor(entity.y))));
    return ownerFaction === entity.faction;
  });

  assert.equal(gen.world.rooms.length >= 1000, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 900, true, `doors ${gen.world.doors.size}`);
  assert.equal(blockRooms.length >= 950, true, `block rooms ${blockRooms.length}`);
  assert.equal(countReachableCells(audit.reachable) >= 200_000, true, `reachable ${countReachableCells(audit.reachable)}`);
  assert.equal(reachableBucketCount(gen.world, audit.reachable, 64) >= 180, true, 'hladon living floor should occupy most map-scale buckets');
  assert.equal(coldRooms.length >= 3, true, `cold rooms ${coldRooms.length}`);
  assert.equal(hermeticHqs.length >= HUMAN_TERRITORY_OWNERS.length, true, `hermetic HQs ${hermeticHqs.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal((territoryByOwner.get(owner) ?? 0) > 0, true, `territory cells for ${owner}`);
    assert.equal(hqOwners.has(owner), true, `HQ owner ${owner}`);
  }
  assertTerritoryShare(gen.world, ZoneFaction.CITIZEN, 0.20, 0.24);
  assertTerritoryShare(gen.world, ZoneFaction.LIQUIDATOR, 0.14, 0.18);
  assertTerritoryShare(gen.world, ZoneFaction.CULTIST, 0.06, 0.10);
  assertTerritoryShare(gen.world, ZoneFaction.SCIENTIST, 0.40, 0.44);
  assertTerritoryShare(gen.world, ZoneFaction.WILD, 0.10, 0.14);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.75, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 058 workshop liquidator floor adds mid micro rooms and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, -7);
  assert.equal(spec.geometryId, 'workshops');
  assert.equal(spec.majorityId, 'liquidators');
  assert.equal(spec.anomalyId, 'none');
  assert.equal(spec.danger, 2);

  const gen = timedProceduralSpec(spec, 'genfix_058 workshops liquidators seed=61061 z-7');
  const audit = reachabilityAudit(gen);
  const clusterRooms = gen.world.rooms.filter(room =>
    room.name.startsWith('Цеховой остров') ||
    room.name.startsWith('Инструментальная ячейка') ||
    room.name.startsWith('Малый станочный бокс') ||
    room.name.startsWith('Мастерская контора') ||
    room.name.startsWith('Цеховой туалет') ||
    room.name.startsWith('Комната кипятка цеха') ||
    room.name.startsWith('Бытовка цеха'));
  const microRooms = clusterRooms.filter(room => room.w * room.h <= 90);
  const reachableClusterRooms = clusterRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const anchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(anchors.map(anchor => anchor.owner));
  const hqRooms = anchors
    .map(anchor => gen.world.rooms[anchor.roomId])
    .filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });

  assert.equal(gen.world.rooms.length >= 180, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 500, true, `doors ${gen.world.doors.size}`);
  assert.equal(countReachableCells(audit.reachable) >= 115_000, true, `reachable ${countReachableCells(audit.reachable)}`);
  assert.equal(clusterRooms.length >= 75, true, `workshop cluster rooms ${clusterRooms.length}`);
  assert.equal(microRooms.length >= 55, true, `workshop micro rooms ${microRooms.length}`);
  assert.equal(reachableClusterRooms.length >= 70, true, `reachable workshop cluster rooms ${reachableClusterRooms.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = anchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 15, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(dominant, ZoneFaction.LIQUIDATOR);
  assertTerritoryShare(gen.world, ZoneFaction.CITIZEN, 0.15, 0.19);
  assertTerritoryShare(gen.world, ZoneFaction.LIQUIDATOR, 0.54, 0.58);
  assertTerritoryShare(gen.world, ZoneFaction.CULTIST, 0.05, 0.09);
  assertTerritoryShare(gen.world, ZoneFaction.SCIENTIST, 0.06, 0.10);
  assertTerritoryShare(gen.world, ZoneFaction.WILD, 0.10, 0.14);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.75, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 063 service spines scientist floor has stations micro rooms and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, -12);
  assert.equal(spec.geometryId, 'service_spines');
  assert.equal(spec.majorityId, 'scientists');
  assert.equal(spec.anomalyId, 'none');
  assert.equal(spec.danger, 2);

  const gen = timedProceduralSpec(spec, 'genfix_063 service_spines scientists seed=61061 z-12');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const serviceRooms = gen.world.rooms.filter(room => room.name.includes('сервисного штрека') || room.name.includes('штрека'));
  const reachableServiceRooms = serviceRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const stationRooms = serviceRooms.filter(room => room.name.includes('станция') || room.name.includes('станции'));
  const inspectionRooms = serviceRooms.filter(room => room.name.includes('инспекционная клетка'));
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const hqRooms = hqAnchors
    .map(anchor => gen.world.rooms[anchor.roomId])
    .filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const territoryRows = countTerritoryCells(gen.world);
  const dominant = [...territoryRows].sort((a, b) => b.cells - a.cells)[0]?.owner;
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });

  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(gen.world.rooms.length >= 600, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 1_100, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 175_000, true, `reachable ${reachable}`);
  assert.equal(serviceRooms.length >= 350, true, `service rooms ${serviceRooms.length}`);
  assert.equal(reachableServiceRooms.length >= 350, true, `reachable service rooms ${reachableServiceRooms.length}`);
  assert.equal(stationRooms.length >= 120, true, `station rooms ${stationRooms.length}`);
  assert.equal(inspectionRooms.length >= 50, true, `inspection rooms ${inspectionRooms.length}`);
  assert.equal(getRouteCueMarkers(gen.world).some(marker => marker.tags.includes('service_spines')), true);

  for (const room of serviceRooms.slice(0, 64)) {
    assert.equal(roomHasReachableCell(gen.world, audit, room), true, `${room.name} reachable`);
  }
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal(territoryCellCount(gen.world, owner) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = hqAnchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => {
      const door = gen.world.doors.get(doorIdx);
      return door?.state === DoorState.HERMETIC_OPEN || door?.state === DoorState.HERMETIC_CLOSED;
    }), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 12, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(dominant, ZoneFaction.SCIENTIST);
  assertTerritoryShare(gen.world, ZoneFaction.CITIZEN, 0.205, 0.235);
  assertTerritoryShare(gen.world, ZoneFaction.LIQUIDATOR, 0.145, 0.175);
  assertTerritoryShare(gen.world, ZoneFaction.CULTIST, 0.065, 0.095);
  assertTerritoryShare(gen.world, ZoneFaction.SCIENTIST, 0.405, 0.435);
  assertTerritoryShare(gen.world, ZoneFaction.WILD, 0.105, 0.135);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.78, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 070 service smog citizen floor fills spines and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, -19);
  assert.equal(spec.geometryId, 'service_spines');
  assert.equal(spec.majorityId, 'citizens');
  assert.equal(spec.anomalyId, 'smog');
  assert.equal(spec.danger, 3);

  const gen = timedProceduralSpec(spec, 'genfix_070 service_spines smog citizens seed=61061 z-19');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const serviceRooms = gen.world.rooms.filter(room => room.name.includes('сервисного штрека') || room.name.includes('штрека'));
  const reachableServiceRooms = serviceRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const microServiceRooms = serviceRooms.filter(room => room.w * room.h <= 90);
  const anchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(anchors.map(anchor => anchor.owner));
  const hqRooms = anchors
    .map(anchor => gen.world.rooms[anchor.roomId])
    .filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const owner = territoryOwnerAtIndex(gen.world, gen.world.idx(Math.floor(entity.x), Math.floor(entity.y)));
    return territoryOwnerToFaction(owner) === entity.faction;
  });

  assert.equal(gen.world.rooms.length >= 600, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 1200, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 180_000, true, `reachable ${reachable}`);
  assert.equal(serviceRooms.length >= 350, true, `service rooms ${serviceRooms.length}`);
  assert.equal(reachableServiceRooms.length >= 340, true, `reachable service rooms ${reachableServiceRooms.length}`);
  assert.equal(microServiceRooms.length >= 300, true, `micro service rooms ${microServiceRooms.length}`);
  assert.equal((gen.world.anomalySmogCells?.length ?? 0) >= 1000, true, `smog cells ${gen.world.anomalySmogCells?.length ?? 0}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = anchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => {
      const door = gen.world.doors.get(doorIdx);
      return door?.state === DoorState.HERMETIC_OPEN || door?.state === DoorState.HERMETIC_CLOSED;
    }), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 15, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(dominant, ZoneFaction.CITIZEN);
  assertTerritoryShare(gen.world, ZoneFaction.CITIZEN, 0.54, 0.58);
  assertTerritoryShare(gen.world, ZoneFaction.LIQUIDATOR, 0.15, 0.19);
  assertTerritoryShare(gen.world, ZoneFaction.CULTIST, 0.05, 0.09);
  assertTerritoryShare(gen.world, ZoneFaction.SCIENTIST, 0.06, 0.10);
  assertTerritoryShare(gen.world, ZoneFaction.WILD, 0.10, 0.14);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.8, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('cultist procedural majority imprints optional ritual geometry without locking route lifts', () => {
  const base = makeProceduralFloorSpec(49_049, 9);
  const gen = timedProceduralSpec({
    ...base,
    geometryId: 'communal_knots',
    baseFloor: FloorLevel.KVARTIRY,
    majorityId: 'cultists',
    anomalyId: 'none',
    danger: 4,
    lootBiasIds: ['meat_rune', 'holy_water', 'psi_dust', 'idol_chernobog', 'blank_form'],
    monsterBiasTags: ['cult', 'psi'],
    title: `культовое большинство: ${base.title}`,
  }, 'forced cultist majority seed=49049');
  const audit = reachabilityAudit(gen);
  const ritualRooms = gen.world.rooms.filter(room => room.name.startsWith('Культовый алтарь'));
  const falseShelters = gen.world.rooms.filter(room => room.name.startsWith('Ложное убежище Черной ладони'));
  const candles = gen.world.features.reduce((count, feature) => count + (feature === Feature.CANDLE ? 1 : 0), 0);
  const phaseCells = gen.world.factionControl.reduce((count, faction) => count + (faction === ZoneFaction.CULTIST ? 1 : 0), 0);
  const cues = getRouteCueMarkers(gen.world);

  assert.equal(ritualRooms.length >= 1, true, `ritual rooms ${ritualRooms.length}`);
  assert.equal(falseShelters.length >= 1, true, `false shelters ${falseShelters.length}`);
  assert.equal(candles >= 4, true, `cult candles ${candles}`);
  assert.equal(phaseCells > 0, true, `phase cells ${phaseCells}`);
  assert.equal(gen.world.containers.some(c => c.tags.includes('cult_tribute_gate') && c.tags.includes('optional_shortcut')), true);
  assert.equal(gen.world.containers.some(c => c.tags.includes('cult_false_shelter') && c.tags.includes('false_safe_block')), true);
  assert.equal(gen.world.containers.some(c => c.tags.includes('cult_evidence') && c.tags.includes('evidence')), true);
  assert.equal(cues.some(cue => cue.tags.includes('cult_tribute_gate') && cue.routeGroup?.id === 'cult_tribute_gate'), true);
  assert.equal([...gen.world.doors.values()].some(door => door.state === DoorState.LOCKED), false);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
});

testGenerationMatrix('wild procedural majority builds risky stash leaves without locking route lifts', () => {
  const base = makeProceduralFloorSpec(47_047, 3);
  const gen = timedProceduralSpec({
    ...base,
    geometryId: 'service_spines',
    baseFloor: FloorLevel.MAINTENANCE,
    majorityId: 'wild',
    anomalyId: 'none',
    danger: 4,
    lootBiasIds: ['filtered_water', 'gasmask_filter', 'ammo_nails', 'filter_receipt', 'grey_briquette'],
    monsterBiasTags: ['ambush', 'crawler'],
    title: `дикое большинство: ${base.title}`,
  }, 'forced wild majority seed=47047');
  const audit = reachabilityAudit(gen);
  const deadEndRooms = gen.world.rooms.filter(room => room.name.startsWith('Дикая тупиковая закладка'));
  const stashes = gen.world.containers.filter(container =>
    container.tags.includes('wild_reward_leaf') &&
    container.tags.includes('wild_risk_cue') &&
    container.tags.includes('raid_stash'));
  const stashRoomIds = new Set(stashes.map(container => container.roomId));
  const ambushers = gen.entities.filter(entity =>
    entity.type === EntityType.NPC &&
    entity.faction === Faction.WILD &&
    entity.assignedRoomId !== undefined &&
    stashRoomIds.has(entity.assignedRoomId));
  const rewardCues = getRouteCueMarkers(gen.world).filter(marker =>
    marker.tags.includes('wild_reward_leaf') &&
    marker.tags.includes('wild_risk_cue'));
  const shortcutCues = getRouteCueMarkers(gen.world).filter(marker =>
    marker.tags.includes('wild_unsafe_shortcut') &&
    marker.tags.includes('wild_risk_cue'));

  assert.equal(deadEndRooms.length >= 2, true, `dead-end reward rooms ${deadEndRooms.length}`);
  assert.equal(stashes.length >= 2, true, `wild reward stashes ${stashes.length}`);
  for (const stash of stashes) {
    assert.equal(stash.discovered, true, `wild stash ${stash.id} is visibly cued`);
    assertAuditReachable(gen.world, audit, gen.world.idx(stash.x, stash.y), `wild stash ${stash.id}`);
  }
  assert.equal(ambushers.length >= Math.min(2, stashes.length), true, `ambushers ${ambushers.length} stashes ${stashes.length}`);
  const minAmbushDistance = Math.min(...ambushers.map(entity => gen.world.dist(gen.spawnX, gen.spawnY, entity.x, entity.y)));
  assert.equal(minAmbushDistance >= 36, true, `min ambush distance ${minAmbushDistance}`);
  assert.equal(rewardCues.length >= stashes.length, true, `wild reward cues ${rewardCues.length} stashes ${stashes.length}`);
  assert.equal(rewardCues.some(cue => cue.routeGroup?.decision.includes('ограбить')), true);
  assert.equal(shortcutCues.length >= 1, true, `wild shortcut cues ${shortcutCues.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
});

testGenerationMatrix('liquidator procedural majority builds readable checkpoints without isolating lifts', () => {
  const base = makeProceduralFloorSpec(46_046, -23);
  const gen = timedProceduralSpec({
    ...base,
    geometryId: 'admin_pockets',
    baseFloor: FloorLevel.MINISTRY,
    majorityId: 'liquidators',
    anomalyId: 'none',
    danger: 4,
    lootBiasIds: ['liquidator_field_roster', 'cleanup_order_stub', 'foam_grenade_6p10', 'confiscation_tag'],
    monsterBiasTags: ['armed', 'patrol'],
    title: `ликвидаторское большинство: ${base.title}`,
  }, 'forced liquidator majority seed=46046');
  const audit = reachabilityAudit(gen);
  const checkpointRooms = gen.world.rooms.filter(room =>
    room.name.startsWith('Главный пост ликвидаторов') || room.name.startsWith('Контрольный пост ликвидаторов'));
  const cueTags = new Set(getRouteCueMarkers(gen.world).flatMap(marker => marker.tags));
  const guards = gen.entities.filter(entity =>
    entity.type === EntityType.NPC &&
    entity.faction === Faction.LIQUIDATOR &&
    entity.name?.startsWith('Постовой ликвидатор'));
  const requiredContainerTags = [
    'permit_gate',
    'bribe_checkpoint',
    'staff_route',
    'weapon_room',
    'expose_abuse',
  ] as const;

  assert.equal(checkpointRooms.length >= 3, true, `checkpoint rooms ${checkpointRooms.length}`);
  assert.equal(guards.length >= 3, true, `guard templates ${guards.length}`);
  assert.equal(cueTags.has('liquidator_checkpoint'), true);
  assert.equal(cueTags.has('patrol_triangle'), true);
  assert.equal(cueTags.has('permit_gate'), true);
  assert.equal(cueTags.has('staff_route'), true);
  for (const tag of requiredContainerTags) {
    const container = gen.world.containers.find(candidate => candidate.tags.includes(tag));
    assert.ok(container, `missing ${tag} container`);
    assertAuditReachable(gen.world, audit, gen.world.idx(container.x, container.y), `${tag} container`);
  }
  assert.equal(gen.world.containers.some(c => c.tags.includes('permit_gate') && c.access === 'locked' && c.tags.includes('show_permit')), true);
  assert.equal(gen.world.containers.some(c => c.tags.includes('bribe_checkpoint') && c.tags.includes('buyable')), true);
  assert.equal(gen.world.containers.some(c => c.tags.includes('staff_route') && c.access === 'secret' && c.discovered), true);
  assert.equal(gen.world.containers.some(c => c.tags.includes('weapon_room') && c.kind === ContainerKind.WEAPON_CRATE), true);
  assert.equal([...gen.world.doors.values()].some(door => door.state === DoorState.LOCKED), false);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
});

testGenerationMatrix('admin pocket geometry exposes legal queue, staff chord and document landmarks', () => {
  const def = FLOOR_GEOMETRIES.find(item => item.id === 'admin_pockets');
  assert.equal(def?.baseFloor, FloorLevel.MINISTRY);
  assert.equal(def?.tags.includes('admin'), true);
  assert.equal(def?.tags.includes('documents'), true);

  const base = makeProceduralFloorSpec(43_043, proceduralZForGeometry(def!));
  const gen = timedProceduralSpec({
    ...base,
    geometryId: 'admin_pockets',
    baseFloor: FloorLevel.MINISTRY,
    majorityId: 'citizens',
    anomalyId: 'none',
    danger: 3,
    title: `административные карманы: ${base.title}`,
  }, 'forced admin_pockets seed=43043');
  const audit = reachabilityAudit(gen);
  const queueRooms = gen.world.rooms.filter(room => room.name.startsWith('Юридическая очередь') || room.name.startsWith('Окно приема'));
  const officeRooms = gen.world.rooms.filter(room => room.name.startsWith('Кабинет-слэб') || room.name.startsWith('Документный карман'));
  const staffRooms = gen.world.rooms.filter(room => room.name.startsWith('Служебная хорда'));
  const landmarkTags = ['legal_queue', 'bribe_checkpoint', 'document_theft', 'staff_stealth'] as const;

  assert.equal(queueRooms.length >= 2, true, `queue rooms ${queueRooms.length}`);
  assert.equal(officeRooms.length >= 8, true, `office pockets ${officeRooms.length}`);
  assert.equal(staffRooms.length >= 2, true, `staff rooms ${staffRooms.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  let legalQueueFixtures = 0;
  let staffChordCells = 0;
  for (let i = 0; i < gen.world.cells.length; i++) {
    if (!audit.reachable[i]) continue;
    const room = gen.world.roomMap[i] >= 0 ? gen.world.rooms[gen.world.roomMap[i]] : undefined;
    if (room && queueRooms.includes(room) && (gen.world.features[i] === Feature.DESK || gen.world.features[i] === Feature.SCREEN)) {
      legalQueueFixtures++;
    }
    if (gen.world.roomMap[i] < 0 && gen.world.cells[i] === Cell.FLOOR && gen.world.floorTex[i] === Tex.F_GREEN_CARPET) {
      staffChordCells++;
    }
  }
  assert.equal(legalQueueFixtures >= 12, true, `legal queue fixtures ${legalQueueFixtures}`);
  assert.equal(staffChordCells >= 80, true, `staff chord cells ${staffChordCells}`);

  for (const tag of landmarkTags) {
    const container = gen.world.containers.find(candidate => candidate.tags.includes(tag));
    assert.notEqual(container, undefined, `missing ${tag} landmark`);
    assertAuditReachable(gen.world, audit, gen.world.idx(container!.x, container!.y), `${tag} landmark`);
  }
});

testGenerationMatrix('genfix 002 procedural admin teleport scientist floor has multi-scale rooms and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, 49);
  assert.equal(spec.geometryId, 'admin_pockets');
  assert.equal(spec.majorityId, 'scientists');
  assert.equal(spec.anomalyId, 'teleport_cells');
  assert.equal(spec.danger, 3);

  const gen = timedProceduralSpec(spec, 'genfix_002 admin teleport scientists seed=61061');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const clusterRooms = gen.world.rooms.filter(room =>
    room.name.includes('грозди') ||
    room.name.includes('гроздь') ||
    room.name.startsWith('Окно приема') ||
    room.name.startsWith('Юридическая очередь') ||
    room.name.startsWith('Кабина справки') ||
    room.name.startsWith('Архивная ячейка') ||
    room.name.startsWith('Туалет очереди') ||
    room.name.startsWith('Комната кипятка') ||
    room.name.startsWith('Кабинет справки о здоровье') ||
    room.name.includes('штаба'));
  const anchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(anchors.map(anchor => anchor.owner));
  const territoryCounts = new Map(countTerritoryCells(gen.world, 4).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (territoryCounts.get(owner) ?? 0) / (W * W);
  const dominant = [...territoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const hqRooms = anchors
    .map(anchor => gen.world.rooms[anchor.roomId])
    .filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  let hermeticShellCells = 0;
  for (const room of hqRooms) {
    for (let dy = -1; dy <= room.h; dy++) {
      for (let dx = -1; dx <= room.w; dx++) {
        if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
        hermeticShellCells += gen.world.hermoWall[gen.world.idx(room.x + dx, room.y + dy)] ? 1 : 0;
      }
    }
  }

  assert.equal(gen.world.rooms.length >= 550, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 1500, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 120_000, true, `reachable ${reachable}`);
  assert.equal(clusterRooms.length >= 220, true, `admin/science cluster rooms ${clusterRooms.length}`);
  assert.equal(gen.world.anomalyTeleports.size >= 12, true, `teleport endpoints ${gen.world.anomalyTeleports.size}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((territoryCounts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = anchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
  }
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      assert.equal(gen.world.dist2(anchors[i].x, anchors[i].y, anchors[j].x, anchors[j].y) >= 120 * 120, true, `HQ spacing ${i}/${j}`);
    }
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 15, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(hermeticShellCells >= hqRooms.length * 8, true, `hermetic shell cells ${hermeticShellCells}`);
  assert.equal(dominant, ZoneFaction.SCIENTIST);
  assert.equal(share(ZoneFaction.CITIZEN) >= 0.20 && share(ZoneFaction.CITIZEN) <= 0.24, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(share(ZoneFaction.LIQUIDATOR) >= 0.14 && share(ZoneFaction.LIQUIDATOR) <= 0.18, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(share(ZoneFaction.CULTIST) >= 0.06 && share(ZoneFaction.CULTIST) <= 0.10, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(share(ZoneFaction.SCIENTIST) >= 0.40 && share(ZoneFaction.SCIENTIST) <= 0.44, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(share(ZoneFaction.WILD) >= 0.10 && share(ZoneFaction.WILD) <= 0.14, true, `wild share ${share(ZoneFaction.WILD)}`);
});

testGenerationMatrix('genfix 006 admin smog liquidator floor has clustered rooms and target territory', () => {
  const base = makeProceduralFloorSpec(61_061, 45);
  const gen = timedProceduralSpec({
    ...base,
    geometryId: 'admin_pockets',
    baseFloor: FloorLevel.MINISTRY,
    majorityId: 'liquidators',
    anomalyId: 'smog',
    danger: 3,
    title: `говнячный смог: административные карманы, этаж ликвидаторов`,
  }, 'genfix 006 admin smog liquidators seed=61061');
  const audit = reachabilityAudit(gen);
  const clusterRooms = gen.world.rooms.filter(room =>
    room.name.includes('грозди') ||
    room.name.includes('гроздь') ||
    room.name.startsWith('Туалет при очереди') ||
    room.name.startsWith('Чайная при коридоре'));
  const reachableClusterRooms = clusterRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const anchors = territoryHqAnchors(gen.world);
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / (W * W);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  assert.equal(gen.world.rooms.length >= 190, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 330, true, `doors ${gen.world.doors.size}`);
  assert.equal(clusterRooms.length >= 45, true, `admin cluster rooms ${clusterRooms.length}`);
  assert.equal(reachableClusterRooms.length >= 35, true, `reachable admin cluster rooms ${reachableClusterRooms.length}`);
  assert.equal(gen.world.anomalySmogCells.length >= 500, true, `smog cells ${gen.world.anomalySmogCells.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(anchors.some(anchor => anchor.owner === owner), true, `missing HQ anchor ${owner}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `missing territory cells ${owner}`);
  }
  assert.equal(dominant, ZoneFaction.LIQUIDATOR);
  assert.equal(share(ZoneFaction.CITIZEN) >= 0.14 && share(ZoneFaction.CITIZEN) <= 0.21, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(share(ZoneFaction.LIQUIDATOR) >= 0.52 && share(ZoneFaction.LIQUIDATOR) <= 0.60, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(share(ZoneFaction.CULTIST) >= 0.04 && share(ZoneFaction.CULTIST) <= 0.10, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(share(ZoneFaction.SCIENTIST) >= 0.05 && share(ZoneFaction.SCIENTIST) <= 0.11, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(share(ZoneFaction.WILD) >= 0.09 && share(ZoneFaction.WILD) <= 0.16, true, `wild share ${share(ZoneFaction.WILD)}`);
});

testGenerationMatrix('genfix 016 admin teleport wild floor has dense pockets and target territory', () => {
  const base = makeProceduralFloorSpec(61_061, 35);
  const gen = timedProceduralSpec({
    ...base,
    geometryId: 'admin_pockets',
    baseFloor: FloorLevel.MINISTRY,
    majorityId: 'wild',
    anomalyId: 'teleport_cells',
    danger: 3,
    title: `перескоки клеток: административные карманы, дикий этаж`,
  }, 'genfix 016 admin teleport wild seed=61061');
  const audit = reachabilityAudit(gen);
  const clusterRooms = gen.world.rooms.filter(room =>
    room.name.includes('грозди') ||
    room.name.includes('гроздь') ||
    room.name.startsWith('Туалет при очереди') ||
    room.name.startsWith('Чайная при коридоре'));
  const reachableClusterRooms = clusterRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const anchors = territoryHqAnchors(gen.world);
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / (W * W);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const hqRooms = anchors
    .map(anchor => gen.world.rooms[anchor.roomId])
    .filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  let hermeticShellCells = 0;
  for (const room of hqRooms) {
    for (let dy = -1; dy <= room.h; dy++) {
      for (let dx = -1; dx <= room.w; dx++) {
        if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
        hermeticShellCells += gen.world.hermoWall[gen.world.idx(room.x + dx, room.y + dy)] ? 1 : 0;
      }
    }
  }
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });

  assert.equal(gen.world.rooms.length >= 190, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 320, true, `doors ${gen.world.doors.size}`);
  assert.equal(clusterRooms.length >= 45, true, `admin cluster rooms ${clusterRooms.length}`);
  assert.equal(reachableClusterRooms.length >= 35, true, `reachable admin cluster rooms ${reachableClusterRooms.length}`);
  assert.equal(gen.world.anomalyTeleports.size >= 12, true, `teleport endpoints ${gen.world.anomalyTeleports.size}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(anchors.some(anchor => anchor.owner === owner), true, `missing HQ anchor ${owner}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `missing territory cells ${owner}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 15, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(hermeticShellCells >= hqRooms.length * 8, true, `hermetic shell cells ${hermeticShellCells}`);
  assert.equal(dominant, ZoneFaction.WILD);
  assert.equal(share(ZoneFaction.CITIZEN) >= 0.14 && share(ZoneFaction.CITIZEN) <= 0.20, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(share(ZoneFaction.LIQUIDATOR) >= 0.10 && share(ZoneFaction.LIQUIDATOR) <= 0.16, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(share(ZoneFaction.CULTIST) >= 0.09 && share(ZoneFaction.CULTIST) <= 0.15, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(share(ZoneFaction.SCIENTIST) >= 0.055 && share(ZoneFaction.SCIENTIST) <= 0.105, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(share(ZoneFaction.WILD) >= 0.47 && share(ZoneFaction.WILD) <= 0.53, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.5, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 032 procedural admin mirror citizens floor has multi-scale pockets and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, 19);
  assert.equal(spec.geometryId, 'admin_pockets');
  assert.equal(spec.majorityId, 'citizens');
  assert.equal(spec.anomalyId, 'mirror_run');
  assert.equal(spec.danger, 3);

  const gen = timedProceduralSpec(spec, 'genfix_032 admin mirror citizens seed=61061');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const clusterRooms = gen.world.rooms.filter(room =>
    room.name.includes('грозди') ||
    room.name.includes('гроздь') ||
    room.name.startsWith('Окно приема') ||
    room.name.startsWith('Юридическая очередь') ||
    room.name.startsWith('Кабина справки') ||
    room.name.startsWith('Архивная ячейка') ||
    room.name.startsWith('Туалет очереди') ||
    room.name.startsWith('Комната кипятка') ||
    room.name.startsWith('Кабинет справки о здоровье') ||
    room.name.startsWith('Малый кабинет') ||
    room.name.startsWith('Архивный шкаф-карман') ||
    room.name.startsWith('Служебный туалет') ||
    room.name.startsWith('Чайная в кармане') ||
    room.name.startsWith('Пункт холодной помощи') ||
    room.name.startsWith('Малая очередь') ||
    room.name.includes('штаба'));
  const reachableClusterRooms = clusterRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const routeCueTags = new Set(getRouteCueMarkers(gen.world).flatMap(cue => cue.tags));
  const anchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(anchors.map(anchor => anchor.owner));
  const hqRooms = anchors
    .map(anchor => gen.world.rooms[anchor.roomId])
    .filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const territoryCounts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (territoryCounts.get(owner) ?? 0) / (W * W);
  const dominant = [...territoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  let alignedNpcs = 0;
  for (const npc of npcs) {
    const cellOwner = territoryOwnerAtIndex(gen.world, gen.world.idx(Math.floor(npc.x), Math.floor(npc.y)));
    if (territoryOwnerToFaction(cellOwner) === npc.faction) alignedNpcs++;
  }
  let mirrorTeleportScreens = 0;
  let staffChordCells = 0;
  let hermeticShellCells = 0;
  for (let i = 0; i < gen.world.cells.length; i++) {
    if (gen.world.features[i] === Feature.SCREEN && gen.world.floorTex[i] === Tex.F_VOID) mirrorTeleportScreens++;
    if (audit.reachable[i] && gen.world.roomMap[i] < 0 && gen.world.cells[i] === Cell.FLOOR && gen.world.floorTex[i] === Tex.F_GREEN_CARPET) {
      staffChordCells++;
    }
  }
  for (const room of hqRooms) {
    for (let dy = -1; dy <= room.h; dy++) {
      for (let dx = -1; dx <= room.w; dx++) {
        if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
        hermeticShellCells += gen.world.hermoWall[gen.world.idx(room.x + dx, room.y + dy)] ? 1 : 0;
      }
    }
  }

  assert.equal(gen.world.rooms.length >= 590, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 1700, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 130_000, true, `reachable ${reachable}`);
  assert.equal(clusterRooms.length >= 290, true, `admin/mirror cluster rooms ${clusterRooms.length}`);
  assert.equal(reachableClusterRooms.length >= 280, true, `reachable admin/mirror cluster rooms ${reachableClusterRooms.length}`);
  assert.equal(staffChordCells >= 1000, true, `staff chord cells ${staffChordCells}`);
  assert.equal(mirrorTeleportScreens >= 6, true, `mirror teleport screens ${mirrorTeleportScreens}`);
  assert.equal(routeCueTags.has('mirror_run'), true, 'missing mirror route cue');
  assert.equal(routeCueTags.has('admin_pockets'), true, 'missing admin route cue');
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((territoryCounts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = anchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
  }
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      assert.equal(gen.world.dist2(anchors[i].x, anchors[i].y, anchors[j].x, anchors[j].y) >= 120 * 120, true, `HQ spacing ${i}/${j}`);
    }
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 15, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(hermeticShellCells >= hqRooms.length * 8, true, `hermetic shell cells ${hermeticShellCells}`);
  assert.equal(npcs.length > 0, true, `npcs ${npcs.length}`);
  assert.equal(alignedNpcs / npcs.length >= 0.75, true, `aligned NPC share ${alignedNpcs / npcs.length}`);
  assert.equal(dominant, ZoneFaction.CITIZEN);
  assert.equal(share(ZoneFaction.CITIZEN) >= 0.54 && share(ZoneFaction.CITIZEN) <= 0.58, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(share(ZoneFaction.LIQUIDATOR) >= 0.15 && share(ZoneFaction.LIQUIDATOR) <= 0.19, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(share(ZoneFaction.CULTIST) >= 0.055 && share(ZoneFaction.CULTIST) <= 0.085, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(share(ZoneFaction.SCIENTIST) >= 0.065 && share(ZoneFaction.SCIENTIST) <= 0.10, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(share(ZoneFaction.WILD) >= 0.10 && share(ZoneFaction.WILD) <= 0.14, true, `wild share ${share(ZoneFaction.WILD)}`);
});

testGenerationMatrix('genfix 010 procedural admin hladon wild floor adds micro rooms and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, 41);
  assert.equal(spec.geometryId, 'admin_pockets');
  assert.equal(spec.majorityId, 'wild');
  assert.equal(spec.anomalyId, 'hladon');
  assert.equal(spec.danger, 4);

  const gen = timedProceduralSpec(spec, 'genfix_010 admin hladon wild seed=61061');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const clusterRooms = gen.world.rooms.filter(room =>
    room.name.includes('грозди') ||
    room.name.includes('гроздь') ||
    room.name.startsWith('Туалет при очереди') ||
    room.name.startsWith('Чайная при коридоре'));
  const reachableClusterRooms = clusterRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const smallRooms = gen.world.rooms.filter(room => room.w * room.h <= 54);
  const hladonRooms = gen.world.rooms.filter(room => room.name.startsWith('Хладон:'));
  const anchors = territoryHqAnchors(gen.world);
  const hqRooms = anchors.map(anchor => gen.world.rooms[anchor.roomId]).filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / (W * W);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  let hermeticShellCells = 0;
  for (const room of hqRooms) {
    for (let dy = -1; dy <= room.h; dy++) {
      for (let dx = -1; dx <= room.w; dx++) {
        if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
        hermeticShellCells += gen.world.hermoWall[gen.world.idx(room.x + dx, room.y + dy)] ? 1 : 0;
      }
    }
  }

  assert.equal(gen.world.rooms.length >= 430, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(smallRooms.length >= 180, true, `small rooms ${smallRooms.length}`);
  assert.equal(gen.world.doors.size >= 900, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 190_000, true, `reachable ${reachable}`);
  assert.equal(clusterRooms.length >= 80, true, `admin cluster rooms ${clusterRooms.length}`);
  assert.equal(reachableClusterRooms.length >= 60, true, `reachable admin cluster rooms ${reachableClusterRooms.length}`);
  assert.equal(hladonRooms.length >= 4, true, `hladon rooms ${hladonRooms.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(anchors.some(anchor => anchor.owner === owner), true, `missing HQ anchor ${ZoneFaction[owner]}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `missing territory cells ${ZoneFaction[owner]}`);
  }
  assert.equal(anchors.some(anchor => anchor.roomId === 0), false, 'arrival room must not become an automatic HQ');
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 15, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(hermeticShellCells >= hqRooms.length * 12, true, `hermetic shell cells ${hermeticShellCells}`);
  assert.equal(dominant, ZoneFaction.WILD);
  assert.equal(Math.abs(share(ZoneFaction.CITIZEN) - 0.17) <= 0.02, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(Math.abs(share(ZoneFaction.LIQUIDATOR) - 0.13) <= 0.02, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(Math.abs(share(ZoneFaction.CULTIST) - 0.12) <= 0.02, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.SCIENTIST) - 0.08) <= 0.02, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.WILD) - 0.5) <= 0.02, true, `wild share ${share(ZoneFaction.WILD)}`);
});

testGenerationMatrix('genfix 020 admin pockets wild floor has multi-scale rooms and target territory', () => {
  const base = makeProceduralFloorSpec(61_061, 31);
  const gen = timedProceduralSpec({
    ...base,
    geometryId: 'admin_pockets',
    baseFloor: FloorLevel.MINISTRY,
    majorityId: 'wild',
    anomalyId: 'none',
    danger: 3,
    title: `genfix 020: административные карманы, дикий этаж`,
  }, 'genfix_020 admin pockets wild seed=61061');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const clusterRooms = gen.world.rooms.filter(room =>
    room.name.includes('грозди') ||
    room.name.includes('гроздь') ||
    room.name.startsWith('Окно приема') ||
    room.name.startsWith('Юридическая очередь') ||
    room.name.startsWith('Кабина справки') ||
    room.name.startsWith('Архивная ячейка') ||
    room.name.startsWith('Туалет очереди') ||
    room.name.startsWith('Комната кипятка') ||
    room.name.startsWith('Кабинет справки о здоровье'));
  const anchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(anchors.map(anchor => anchor.owner));
  const territoryCounts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (territoryCounts.get(owner) ?? 0) / (W * W);

  assert.equal(gen.world.rooms.length >= 550, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 1500, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 120_000, true, `reachable ${reachable}`);
  assert.equal(clusterRooms.length >= 180, true, `admin cluster rooms ${clusterRooms.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((territoryCounts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = anchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
  }
  assert.equal(share(ZoneFaction.CITIZEN) >= 0.15 && share(ZoneFaction.CITIZEN) <= 0.19, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(share(ZoneFaction.LIQUIDATOR) >= 0.11 && share(ZoneFaction.LIQUIDATOR) <= 0.15, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(share(ZoneFaction.CULTIST) >= 0.10 && share(ZoneFaction.CULTIST) <= 0.14, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(share(ZoneFaction.SCIENTIST) >= 0.06 && share(ZoneFaction.SCIENTIST) <= 0.10, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(share(ZoneFaction.WILD) >= 0.48 && share(ZoneFaction.WILD) <= 0.52, true, `wild share ${share(ZoneFaction.WILD)}`);
});

testGenerationMatrix('genfix 028 procedural admin rail liquidator floor has dense stations and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, 23);
  assert.equal(spec.z, 23);
  assert.equal(spec.geometryId, 'admin_pockets');
  assert.equal(spec.majorityId, 'liquidators');
  assert.equal(spec.anomalyId, 'rail_trains');
  assert.equal(spec.danger, 2);
  assert.equal(proceduralStructureFamilyForSpec(spec), 'prime_xor_registry');

  const gen = timedProceduralSpec(spec, 'genfix_028 admin rail liquidators seed=61061');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const clusterRooms = gen.world.rooms.filter(room =>
    room.name.includes('грозди') ||
    room.name.includes('гроздь') ||
    room.name.startsWith('Окно приема') ||
    room.name.startsWith('Юридическая очередь') ||
    room.name.startsWith('Кабина справки') ||
    room.name.startsWith('Архивная ячейка') ||
    room.name.startsWith('Туалет очереди') ||
    room.name.startsWith('Комната кипятка') ||
    room.name.startsWith('Кабинет справки о здоровье') ||
    room.name.includes('платформ') ||
    room.name.includes('Платформ'));
  const platformRooms = gen.world.rooms.filter(room => room.name.includes('платформ') || room.name.includes('Платформ'));
  const reachablePlatformRooms = platformRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const anchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(anchors.map(anchor => anchor.owner));
  const territoryCounts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (territoryCounts.get(owner) ?? 0) / (W * W);
  const dominant = [...territoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });

  assert.equal(gen.world.rooms.length >= 540, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 1_300, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 180_000, true, `reachable ${reachable}`);
  assert.equal(clusterRooms.length >= 250, true, `admin/rail cluster rooms ${clusterRooms.length}`);
  assert.equal(platformRooms.length >= 12, true, `platform service rooms ${platformRooms.length}`);
  assert.equal(reachablePlatformRooms.length >= 12, true, `reachable platform service rooms ${reachablePlatformRooms.length}`);
  assert.equal(gen.world.railTracks.length >= 2, true, `rail tracks ${gen.world.railTracks.length}`);
  assert.equal(gen.world.railTrains.length >= 2, true, `rail trains ${gen.world.railTrains.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((territoryCounts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
  }
  assert.equal(dominant, ZoneFaction.LIQUIDATOR);
  assert.equal(Math.abs(share(ZoneFaction.CITIZEN) - 0.17) <= 0.02, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(Math.abs(share(ZoneFaction.LIQUIDATOR) - 0.56) <= 0.02, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(Math.abs(share(ZoneFaction.CULTIST) - 0.07) <= 0.02, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.SCIENTIST) - 0.08) <= 0.02, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.WILD) - 0.12) <= 0.02, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.6, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 036 procedural admin teleport citizens floor keeps macro pockets micro rooms and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, 15);
  assert.equal(spec.ordinal, 36);
  assert.equal(spec.geometryId, 'admin_pockets');
  assert.equal(spec.majorityId, 'citizens');
  assert.equal(spec.anomalyId, 'teleport_cells');
  assert.equal(spec.danger, 3);

  const gen = timedProceduralSpec(spec, 'genfix_036 admin teleport citizens seed=61061');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const clusterRooms = gen.world.rooms.filter(room =>
    room.name.includes('грозди') ||
    room.name.includes('гроздь') ||
    room.name.startsWith('Окно приема') ||
    room.name.startsWith('Юридическая очередь') ||
    room.name.startsWith('Кабина справки') ||
    room.name.startsWith('Архивная ячейка') ||
    room.name.startsWith('Туалет очереди') ||
    room.name.startsWith('Комната кипятка') ||
    room.name.startsWith('Кабинет справки о здоровье') ||
    room.name.startsWith('Архивный шкаф-карман') ||
    room.name.startsWith('Служебный туалет') ||
    room.name.startsWith('Чайная в кармане') ||
    room.name.startsWith('Пункт холодной помощи') ||
    room.name.startsWith('Малая очередь') ||
    room.name.startsWith('Малый кабинет'));
  const reachableClusterRooms = clusterRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const territoryCounts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (territoryCounts.get(owner) ?? 0) / (W * W);
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);

  assert.equal(gen.world.rooms.length >= 540, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 1_350, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 220_000, true, `reachable ${reachable}`);
  assert.equal(clusterRooms.length >= 240, true, `admin cluster rooms ${clusterRooms.length}`);
  assert.equal(reachableClusterRooms.length >= 220, true, `reachable admin cluster rooms ${reachableClusterRooms.length}`);
  assert.equal(gen.world.anomalyTeleports.size >= 14, true, `teleport endpoints ${gen.world.anomalyTeleports.size}`);
  assert.equal(getRouteCueMarkers(gen.world).some(marker => marker.tags.includes('admin_pockets')), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((territoryCounts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = hqAnchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => gen.world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(supportRooms.length >= 15, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(Math.abs(share(ZoneFaction.CITIZEN) - 0.56) <= 0.02, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(Math.abs(share(ZoneFaction.LIQUIDATOR) - 0.17) <= 0.02, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(Math.abs(share(ZoneFaction.CULTIST) - 0.07) <= 0.02, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.SCIENTIST) - 0.08) <= 0.02, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.WILD) - 0.12) <= 0.02, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.7, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 030 procedural admin conveyor scientist floor has sorter annexes and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, 21);
  assert.equal(spec.geometryId, 'admin_pockets');
  assert.equal(spec.majorityId, 'scientists');
  assert.equal(spec.anomalyId, 'conveyor_sorter');
  assert.equal(spec.danger, 3);

  const gen = timedProceduralSpec(spec, 'genfix_030 admin conveyor scientists seed=61061');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const sorterAnnexRooms = gen.world.rooms.filter(room => room.name.startsWith('Сортировочная станция'));
  const conveyorRooms = gen.world.rooms.filter(room => room.name.startsWith('Сортировочный конвейер'));
  const smallRooms = gen.world.rooms.filter(room => room.w * room.h <= 54);
  const clusterRooms = gen.world.rooms.filter(room =>
    room.name.includes('грозди') ||
    room.name.includes('гроздь') ||
    room.name.startsWith('Окно приема') ||
    room.name.startsWith('Юридическая очередь') ||
    room.name.startsWith('Кабина справки') ||
    room.name.startsWith('Архивная ячейка') ||
    room.name.startsWith('Туалет очереди') ||
    room.name.startsWith('Комната кипятка') ||
    room.name.startsWith('Кабинет справки о здоровье') ||
    room.name.startsWith('Сортировочная станция'));
  const reachableClusterRooms = clusterRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const anchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(anchors.map(anchor => anchor.owner));
  const hqRooms = anchors.map(anchor => gen.world.rooms[anchor.roomId]).filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const territoryCounts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (territoryCounts.get(owner) ?? 0) / (W * W);
  const dominant = [...territoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  let hermeticShellCells = 0;
  for (const room of hqRooms) {
    for (let dy = -1; dy <= room.h; dy++) {
      for (let dx = -1; dx <= room.w; dx++) {
        if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
        hermeticShellCells += gen.world.hermoWall[gen.world.idx(room.x + dx, room.y + dy)] ? 1 : 0;
      }
    }
  }
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });

  assert.equal(gen.world.rooms.length >= 620, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 1600, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 130_000, true, `reachable ${reachable}`);
  assert.equal(smallRooms.length >= 260, true, `small rooms ${smallRooms.length}`);
  assert.equal(sorterAnnexRooms.length >= 36, true, `sorter annex rooms ${sorterAnnexRooms.length}`);
  assert.equal(conveyorRooms.length >= 8, true, `conveyor rooms ${conveyorRooms.length}`);
  assert.equal(clusterRooms.length >= 280, true, `admin/conveyor cluster rooms ${clusterRooms.length}`);
  assert.equal(reachableClusterRooms.length >= 260, true, `reachable admin/conveyor cluster rooms ${reachableClusterRooms.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((territoryCounts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 15, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(hermeticShellCells >= hqRooms.length * 12, true, `hermetic shell cells ${hermeticShellCells}`);
  assert.equal(dominant, ZoneFaction.SCIENTIST);
  assert.equal(Math.abs(share(ZoneFaction.CITIZEN) - 0.22) <= 0.025, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(Math.abs(share(ZoneFaction.LIQUIDATOR) - 0.16) <= 0.025, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(Math.abs(share(ZoneFaction.CULTIST) - 0.08) <= 0.025, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.SCIENTIST) - 0.42) <= 0.025, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.WILD) - 0.12) <= 0.025, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.65, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});



testGenerationMatrix('genfix 040 communal liquidator floor keeps macro and adds mid micro territory', () => {
  const spec = makeProceduralFloorSpec(61_061, 11);
  assert.equal(spec.geometryId, 'communal_knots');
  assert.equal(spec.majorityId, 'liquidators');
  assert.equal(spec.anomalyId, 'none');
  assert.equal(spec.danger, 2);

  const gen = timedProceduralSpec(spec, 'genfix 040 communal liquidators seed=61061');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const clusterRooms = gen.world.rooms.filter(room => room.name.startsWith('Очередной блок'));
  const microRooms = clusterRooms.filter(room => room.w * room.h <= 72);
  const serviceRooms = gen.world.rooms.filter(room =>
    room.name.includes('Общая кухня') ||
    room.name.includes('Водяная очередь') ||
    room.name.includes('Кладовая общака') ||
    room.name.includes('Очередь у курилки') ||
    room.name.includes('Коммунальная очередь'),
  );
  const bypassRooms = gen.world.rooms.filter(room => room.name.includes('Сквозная коммуналка'));
  const grievanceRooms = gen.world.rooms.filter(room => room.name.startsWith('Домен жалобы'));
  const liquidatorPosts = gen.world.rooms.filter(room => room.name.includes('пост ликвидаторов'));
  const checkpointContainers = gen.world.containers.filter(container => container.tags.includes('liquidator_checkpoint'));
  const anchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(anchors.map(anchor => anchor.owner));
  const hqRooms = anchors
    .map(anchor => gen.world.rooms[anchor.roomId])
    .filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / (W * W);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });
  let hermeticShellCells = 0;
  for (const room of hqRooms) {
    for (let dy = -1; dy <= room.h; dy++) {
      for (let dx = -1; dx <= room.w; dx++) {
        if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
        hermeticShellCells += gen.world.hermoWall[gen.world.idx(room.x + dx, room.y + dy)] ? 1 : 0;
      }
    }
  }

  assert.equal(gen.world.rooms.length >= 240, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 600, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 175_000, true, `reachable ${reachable}`);
  assert.equal(clusterRooms.length >= 90, true, `communal cluster rooms ${clusterRooms.length}`);
  assert.equal(microRooms.length >= 80, true, `communal micro rooms ${microRooms.length}`);
  assert.equal(serviceRooms.length >= 4, true, `service rooms ${serviceRooms.length}`);
  assert.equal(bypassRooms.length >= 3, true, `bypass rooms ${bypassRooms.length}`);
  assert.equal(grievanceRooms.length >= 2, true, `grievance rooms ${grievanceRooms.length}`);
  assert.equal(liquidatorPosts.length >= 4, true, `liquidator posts ${liquidatorPosts.length}`);
  assert.equal(checkpointContainers.length >= 5, true, `checkpoint containers ${checkpointContainers.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const room of [...clusterRooms.slice(0, 12), ...liquidatorPosts]) {
    const ci = gen.world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2));
    assertAuditReachable(gen.world, audit, ci, `${room.name} center`);
  }
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = anchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 12, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(hermeticShellCells >= hqRooms.length * 8, true, `hermetic shell cells ${hermeticShellCells}`);
  assert.equal(dominant, ZoneFaction.LIQUIDATOR);
  assert.equal(Math.abs(share(ZoneFaction.CITIZEN) - 0.17) <= 0.02, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(Math.abs(share(ZoneFaction.LIQUIDATOR) - 0.56) <= 0.02, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(Math.abs(share(ZoneFaction.CULTIST) - 0.07) <= 0.02, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.SCIENTIST) - 0.08) <= 0.02, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.WILD) - 0.12) <= 0.02, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.65, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 054 communal conveyor wild floor has scaled clusters and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, -3);
  assert.equal(spec.geometryId, 'communal_knots');
  assert.equal(spec.majorityId, 'wild');
  assert.equal(spec.anomalyId, 'conveyor_sorter');
  assert.equal(spec.danger, 2);

  const gen = timedProceduralSpec(spec, 'genfix 054 communal conveyor wild seed=61061');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const clusterRooms = gen.world.rooms.filter(room => room.name.startsWith('Очередной блок'));
  const microRooms = clusterRooms.filter(room => room.w * room.h <= 72);
  const reachableClusterRooms = clusterRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const sorterAnnexRooms = gen.world.rooms.filter(room => room.name.startsWith('Сортировочная станция'));
  const reachableSorterAnnexRooms = sorterAnnexRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const conveyorRooms = gen.world.rooms.filter(room => room.name.startsWith('Сортировочный конвейер'));
  const serviceRooms = gen.world.rooms.filter(room =>
    room.name.includes('Общая кухня') ||
    room.name.includes('Водяная очередь') ||
    room.name.includes('Кладовая общака') ||
    room.name.includes('Очередь у курилки') ||
    room.name.includes('Коммунальная очередь'),
  );
  const bypassRooms = gen.world.rooms.filter(room => room.name.includes('Сквозная коммуналка'));
  const grievanceRooms = gen.world.rooms.filter(room => room.name.startsWith('Домен жалобы'));
  const anchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(anchors.map(anchor => anchor.owner));
  const hqRooms = anchors
    .map(anchor => gen.world.rooms[anchor.roomId])
    .filter(room => room?.type === RoomType.HQ);
  const territoryCounts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (territoryCounts.get(owner) ?? 0) / (W * W);
  const dominant = [...territoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });
  const supportTypes = new Set([
    RoomType.KITCHEN,
    RoomType.BATHROOM,
    RoomType.STORAGE,
    RoomType.MEDICAL,
    RoomType.OFFICE,
    RoomType.COMMON,
    RoomType.PRODUCTION,
    RoomType.SMOKING,
  ]);
  let hermeticShellCells = 0;
  let hqAnchorsWithSupport = 0;
  for (const anchor of anchors) {
    const hq = gen.world.rooms[anchor.roomId];
    if (!hq) continue;
    const cx = hq.x + (hq.w >> 1);
    const cy = hq.y + (hq.h >> 1);
    let supportCount = 0;
    for (const room of gen.world.rooms) {
      if (!room || room.id === hq.id || room.type === RoomType.HQ || room.apartmentId >= 0 || !supportTypes.has(room.type)) continue;
      if (gen.world.dist2(cx, cy, room.x + (room.w >> 1), room.y + (room.h >> 1)) <= 120 * 120) supportCount++;
    }
    if (supportCount >= 4) hqAnchorsWithSupport++;
    for (let dy = -1; dy <= hq.h; dy++) {
      for (let dx = -1; dx <= hq.w; dx++) {
        if (dx >= 0 && dx < hq.w && dy >= 0 && dy < hq.h) continue;
        hermeticShellCells += gen.world.hermoWall[gen.world.idx(hq.x + dx, hq.y + dy)] ? 1 : 0;
      }
    }
  }

  assert.equal(gen.world.rooms.length >= 370, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 900, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 205_000, true, `reachable ${reachable}`);
  assert.equal(clusterRooms.length >= 200, true, `communal cluster rooms ${clusterRooms.length}`);
  assert.equal(microRooms.length >= 170, true, `communal micro rooms ${microRooms.length}`);
  assert.equal(reachableClusterRooms.length >= 190, true, `reachable communal cluster rooms ${reachableClusterRooms.length}`);
  assert.equal(sorterAnnexRooms.length >= 24, true, `sorter annex rooms ${sorterAnnexRooms.length}`);
  assert.equal(reachableSorterAnnexRooms.length >= 24, true, `reachable sorter annex rooms ${reachableSorterAnnexRooms.length}`);
  assert.equal(conveyorRooms.length >= 9, true, `conveyor rooms ${conveyorRooms.length}`);
  assert.equal(serviceRooms.length >= 5, true, `service rooms ${serviceRooms.length}`);
  assert.equal(bypassRooms.length >= 4, true, `bypass rooms ${bypassRooms.length}`);
  assert.equal(grievanceRooms.length >= 2, true, `grievance rooms ${grievanceRooms.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((territoryCounts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = anchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(hqAnchorsWithSupport >= HUMAN_TERRITORY_OWNERS.length, true, `HQ anchors with support ${hqAnchorsWithSupport}`);
  assert.equal(hermeticShellCells >= hqRooms.length * 8, true, `hermetic shell cells ${hermeticShellCells}`);
  assert.equal(dominant, ZoneFaction.WILD);
  assert.equal(Math.abs(share(ZoneFaction.CITIZEN) - 0.17) <= 0.02, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(Math.abs(share(ZoneFaction.LIQUIDATOR) - 0.13) <= 0.02, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(Math.abs(share(ZoneFaction.CULTIST) - 0.12) <= 0.02, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.SCIENTIST) - 0.08) <= 0.02, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.WILD) - 0.50) <= 0.02, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.75, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 044 communal citizen floor keeps macro, queue rings and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, 7);
  assert.equal(spec.geometryId, 'communal_knots');
  assert.equal(spec.majorityId, 'citizens');
  assert.equal(spec.anomalyId, 'none');
  assert.equal(spec.danger, 1);

  const gen = timedProceduralSpec(spec, 'genfix 044 communal citizens seed=61061');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const macroHalls = gen.world.rooms.filter(room =>
    room.name.startsWith('Общий тамбур') ||
    (room.w * room.h >= 140 && Math.max(room.w, room.h) >= 18),
  );
  const clusterRooms = gen.world.rooms.filter(room => room.name.startsWith('Очередной блок'));
  const microRooms = clusterRooms.filter(room => room.w * room.h <= 72);
  const serviceRooms = gen.world.rooms.filter(room =>
    room.name.includes('Общая кухня') ||
    room.name.includes('Водяная очередь') ||
    room.name.includes('Кладовая общака') ||
    room.name.includes('Очередь у курилки') ||
    room.name.includes('Коммунальная очередь'),
  );
  const bypassRooms = gen.world.rooms.filter(room => room.name.includes('Сквозная коммуналка'));
  const grievanceRooms = gen.world.rooms.filter(room => room.name.startsWith('Домен жалобы'));
  const anchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(anchors.map(anchor => anchor.owner));
  const hqRooms = anchors
    .map(anchor => gen.world.rooms[anchor.roomId])
    .filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const totalCells = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / totalCells;
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    if (entity.faction === undefined) return false;
    const owner = territoryOwnerAtIndex(gen.world, gen.world.idx(Math.floor(entity.x), Math.floor(entity.y)));
    return territoryOwnerToFaction(owner) === entity.faction;
  });
  const structureCues = getRouteCueMarkers(gen.world).filter(marker =>
    marker.tags.includes('structure_library') &&
    marker.tags.includes('cellular_braid') &&
    marker.tags.includes('communal_knots'),
  );

  assert.equal(gen.world.rooms.length >= 270, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 670, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 198_000, true, `reachable ${reachable}`);
  assert.equal(macroHalls.length >= 24, true, `macro halls ${macroHalls.length}`);
  assert.equal(clusterRooms.length >= 140, true, `communal cluster rooms ${clusterRooms.length}`);
  assert.equal(microRooms.length >= 120, true, `communal micro rooms ${microRooms.length}`);
  assert.equal(serviceRooms.length >= 4, true, `service rooms ${serviceRooms.length}`);
  assert.equal(bypassRooms.length >= 3, true, `bypass rooms ${bypassRooms.length}`);
  assert.equal(grievanceRooms.length >= 2, true, `grievance rooms ${grievanceRooms.length}`);
  assert.equal(structureCues.length >= 1, true, `structure cues ${structureCues.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const room of [...clusterRooms.slice(0, 16), ...serviceRooms, ...bypassRooms]) {
    assert.equal(roomHasReachableCell(gen.world, audit, room), true, `${room.name} reachable cell`);
  }
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = anchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => gen.world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 12, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(dominant, ZoneFaction.CITIZEN);
  assert.equal(Math.abs(share(ZoneFaction.CITIZEN) - 0.56) <= 0.02, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(Math.abs(share(ZoneFaction.LIQUIDATOR) - 0.17) <= 0.02, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(Math.abs(share(ZoneFaction.CULTIST) - 0.07) <= 0.02, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.SCIENTIST) - 0.08) <= 0.02, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.WILD) - 0.12) <= 0.02, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.75, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 064 communal mushroom citizens floor keeps macro mid micro mycelium and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, -13);
  assert.equal(spec.geometryId, 'communal_knots');
  assert.equal(spec.majorityId, 'citizens');
  assert.equal(spec.anomalyId, 'mushroom_mycelium');
  assert.equal(spec.danger, 2);

  const gen = timedProceduralSpec(spec, 'genfix 064 communal mushroom citizens seed=61061 z-13');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const macroHalls = gen.world.rooms.filter(room =>
    room.name.startsWith('Общий тамбур') ||
    (room.w * room.h >= 140 && Math.max(room.w, room.h) >= 18),
  );
  const clusterRooms = gen.world.rooms.filter(room => room.name.startsWith('Очередной блок'));
  const microRooms = clusterRooms.filter(room => room.w * room.h <= 72);
  const reachableClusterRooms = clusterRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const myceliumRooms = gen.world.rooms.filter(room => room.name.startsWith('Грибничный карман'));
  const reachableMyceliumRooms = myceliumRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const serviceRooms = gen.world.rooms.filter(room =>
    room.name.includes('Общая кухня') ||
    room.name.includes('Водяная очередь') ||
    room.name.includes('Кладовая общака') ||
    room.name.includes('Очередь у курилки') ||
    room.name.includes('Коммунальная очередь'),
  );
  const bypassRooms = gen.world.rooms.filter(room => room.name.includes('Сквозная коммуналка'));
  const grievanceRooms = gen.world.rooms.filter(room => room.name.startsWith('Домен жалобы'));
  const foodBasins = gen.world.containers.filter(container => container.tags.includes('mycelium_basin') && container.tags.includes('food_reward'));
  const sporeBasins = gen.world.containers.filter(container => container.tags.includes('mycelium_basin') && container.tags.includes('spore_reward'));
  const anchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(anchors.map(anchor => anchor.owner));
  const hqRooms = anchors
    .map(anchor => gen.world.rooms[anchor.roomId])
    .filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const totalCells = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / totalCells;
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    if (entity.faction === undefined) return false;
    const owner = territoryOwnerAtIndex(gen.world, gen.world.idx(Math.floor(entity.x), Math.floor(entity.y)));
    return territoryOwnerToFaction(owner) === entity.faction;
  });
  let visibleReachableMyceliumCells = 0;
  for (let i = 0; i < gen.world.cells.length; i++) {
    const roomId = gen.world.roomMap[i];
    if (roomId < 0 || !audit.reachable[i]) continue;
    if (!gen.world.rooms[roomId]?.name.startsWith('Грибничный карман')) continue;
    if (gen.world.floorTex[i] === Tex.F_GUT || gen.world.fog[i] >= 32) visibleReachableMyceliumCells++;
  }

  assert.equal(gen.world.rooms.length >= 290, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 730, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 195_000, true, `reachable ${reachable}`);
  assert.equal(macroHalls.length >= 24, true, `macro halls ${macroHalls.length}`);
  assert.equal(clusterRooms.length >= 155, true, `communal cluster rooms ${clusterRooms.length}`);
  assert.equal(microRooms.length >= 135, true, `communal micro rooms ${microRooms.length}`);
  assert.equal(reachableClusterRooms.length >= 150, true, `reachable communal cluster rooms ${reachableClusterRooms.length}`);
  assert.equal(serviceRooms.length >= 4, true, `service rooms ${serviceRooms.length}`);
  assert.equal(bypassRooms.length >= 3, true, `bypass rooms ${bypassRooms.length}`);
  assert.equal(grievanceRooms.length >= 2, true, `grievance rooms ${grievanceRooms.length}`);
  assert.equal(myceliumRooms.length >= 10, true, `mycelium rooms ${myceliumRooms.length}`);
  assert.equal(reachableMyceliumRooms.length >= 10, true, `reachable mycelium rooms ${reachableMyceliumRooms.length}`);
  assert.equal(visibleReachableMyceliumCells >= 300, true, `visible mycelium cells ${visibleReachableMyceliumCells}`);
  assert.equal(foodBasins.length >= 2, true, `food basins ${foodBasins.length}`);
  assert.equal(sporeBasins.length >= 2, true, `spore basins ${sporeBasins.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = anchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => gen.world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 12, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(dominant, ZoneFaction.CITIZEN);
  assert.equal(Math.abs(share(ZoneFaction.CITIZEN) - 0.56) <= 0.02, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(Math.abs(share(ZoneFaction.LIQUIDATOR) - 0.17) <= 0.02, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(Math.abs(share(ZoneFaction.CULTIST) - 0.07) <= 0.02, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.SCIENTIST) - 0.08) <= 0.02, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.WILD) - 0.12) <= 0.02, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.75, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('service spine geometry carves connected maintenance trunks with usable lifts', () => {
  const def = FLOOR_GEOMETRIES.find(item => item.id === 'service_spines');
  assert.equal(def?.minZ, 9);
  assert.equal(def?.maxZ, 23);
  assert.equal(def?.tags.includes('service'), true);

  const base = makeProceduralFloorSpec(9127, 17);
  const gen = timedProceduralSpec({
    ...base,
    geometryId: 'service_spines',
    baseFloor: FloorLevel.MAINTENANCE,
    anomalyId: 'none',
    title: `сервисные штреки: ${base.title}`,
  }, 'forced service_spines seed=9127');
  const audit = reachabilityAudit(gen);
  const spineRooms = gen.world.rooms.filter(room => room.name.includes('сервисного штрека'));

  assert.equal(spineRooms.length >= 2, true);
  for (const room of spineRooms) {
    const ci = gen.world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2));
    assertAuditReachable(gen.world, audit, ci, `${room.name} center`);
  }
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  const spineMetrics = measureAndRecordGeometryMetrics(gen.world, {
    id: 'service_spines',
    spawn: { x: gen.spawnX, y: gen.spawnY },
    anchors: spineRooms.map(room => ({
      id: `service_spine_room_${room.id}`,
      x: room.x + Math.floor(room.w / 2),
      y: room.y + Math.floor(room.h / 2),
    })),
    coarseSize: 128,
    losSampleCount: 24,
    losMaxDistance: 72,
  });
  assert.equal(spineMetrics.landmarkCount, spineRooms.length);
  assert.equal(spineMetrics.loopCount > 0, true);
  assert.equal(spineMetrics.liftPathLength.up > 0, true);
  assert.equal(spineMetrics.liftPathLength.down > 0, true);
  assert.deepEqual(getGeometryMetrics(gen.world, 'service_spines'), [spineMetrics]);

  const panels = getEmergencyPanels(gen.world);
  assert.equal(panels.length >= 1 && panels.length <= 3, true);
  for (const panel of panels) {
    assertAuditReachable(gen.world, audit, panel.idx, 'emergency panel');
    assert.equal(panel.zoneId >= 0, true);
    assert.equal(panel.roomId >= 0, true);
  }

  let serviceFixtures = 0;
  for (let i = 0; i < gen.world.cells.length; i++) {
    const feature = gen.world.features[i];
    if (
      audit.reachable[i] &&
      gen.world.roomMap[i] < 0 &&
      (feature === Feature.SCREEN || feature === Feature.APPARATUS || feature === Feature.MACHINE)
    ) {
      serviceFixtures++;
    }
  }
  assert.equal(serviceFixtures > 0, true);
});

testGenerationMatrix('genfix 066 service rail citizens floor has stations micro rooms and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, -15);
  assert.equal(spec.geometryId, 'service_spines');
  assert.equal(spec.majorityId, 'citizens');
  assert.equal(spec.anomalyId, 'rail_trains');
  assert.equal(spec.danger, 3);

  const gen = timedProceduralSpec(spec, 'genfix_066 service_spines rail citizens seed=61061 z-15');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const serviceRooms = gen.world.rooms.filter(room => room.name.includes('сервисного штрека'));
  const reachableServiceRooms = serviceRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const stationRooms = gen.world.rooms.filter(room => room.name.includes('станция') || room.name.includes('станции'));
  const inspectionRooms = gen.world.rooms.filter(room => room.name.includes('инспекционная клетка'));
  const microServiceRooms = serviceRooms.filter(room => room.w * room.h <= 90);
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const territoryRows = countTerritoryCells(gen.world);
  const dominant = [...territoryRows].sort((a, b) => b.cells - a.cells)[0]?.owner;
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });

  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(gen.world.rooms.length >= 680, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 1_300, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 150_000, true, `reachable ${reachable}`);
  assert.equal(reachableBucketCount(gen.world, audit.reachable, 64) >= 240, true, 'service rail floor should span most map buckets');
  assert.equal(serviceRooms.length >= 350, true, `service rooms ${serviceRooms.length}`);
  assert.equal(reachableServiceRooms.length >= 340, true, `reachable service rooms ${reachableServiceRooms.length}`);
  assert.equal(stationRooms.length >= 200, true, `station rooms ${stationRooms.length}`);
  assert.equal(inspectionRooms.length >= 70, true, `inspection rooms ${inspectionRooms.length}`);
  assert.equal(microServiceRooms.length >= 320, true, `micro service rooms ${microServiceRooms.length}`);
  assert.equal(gen.world.railTracks.length >= 3, true, `rail tracks ${gen.world.railTracks.length}`);
  assert.equal(gen.world.railTrains.length >= 3, true, `rail trains ${gen.world.railTrains.length}`);
  assert.equal(getRouteCueMarkers(gen.world).some(marker => marker.tags.includes('service_spines')), true);
  assert.equal(getRouteCueMarkers(gen.world).some(marker => marker.tags.includes('rail_trains')), true);

  for (const room of serviceRooms.slice(0, 64)) {
    assert.equal(roomHasReachableCell(gen.world, audit, room), true, `${room.name} reachable`);
  }
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal(territoryCellCount(gen.world, owner) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = hqAnchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => {
      const door = gen.world.doors.get(doorIdx);
      return door?.state === DoorState.HERMETIC_OPEN || door?.state === DoorState.HERMETIC_CLOSED;
    }), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(dominant, ZoneFaction.CITIZEN);
  assertTerritoryShare(gen.world, ZoneFaction.CITIZEN, 0.54, 0.58);
  assertTerritoryShare(gen.world, ZoneFaction.LIQUIDATOR, 0.15, 0.19);
  assertTerritoryShare(gen.world, ZoneFaction.CULTIST, 0.05, 0.09);
  assertTerritoryShare(gen.world, ZoneFaction.SCIENTIST, 0.06, 0.10);
  assertTerritoryShare(gen.world, ZoneFaction.WILD, 0.10, 0.14);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.8, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 067 service spines scientist floor fills mid micro layers and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, -16);
  assert.equal(spec.geometryId, 'service_spines');
  assert.equal(spec.majorityId, 'scientists');
  assert.equal(spec.anomalyId, 'none');
  assert.equal(spec.danger, 2);

  const gen = timedProceduralSpec(spec, 'genfix_067 service_spines scientists seed=61061 z-16');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const serviceRooms = gen.world.rooms.filter(room => room.name.includes('сервисного штрека'));
  const reachableServiceRooms = serviceRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const stationRooms = serviceRooms.filter(room => room.name.includes('станция') || room.name.includes('станции'));
  const inspectionRooms = serviceRooms.filter(room => room.name.includes('инспекционная клетка'));
  const microServiceRooms = serviceRooms.filter(room => room.w * room.h <= 90);
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const hqRooms = hqAnchors
    .map(anchor => gen.world.rooms[anchor.roomId])
    .filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const territoryRows = countTerritoryCells(gen.world);
  const dominant = [...territoryRows].sort((a, b) => b.cells - a.cells)[0]?.owner;
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });
  let minHqDistance = Infinity;
  for (let i = 0; i < hqAnchors.length; i++) {
    for (let j = i + 1; j < hqAnchors.length; j++) {
      minHqDistance = Math.min(minHqDistance, Math.sqrt(gen.world.dist2(hqAnchors[i].x, hqAnchors[i].y, hqAnchors[j].x, hqAnchors[j].y)));
    }
  }

  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(reachableBucketCount(gen.world, audit.reachable, 128) >= 63, true);
  assert.equal(gen.world.rooms.length >= 560, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 1_050, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 180_000, true, `reachable ${reachable}`);
  assert.equal(serviceRooms.length >= 280, true, `service rooms ${serviceRooms.length}`);
  assert.equal(reachableServiceRooms.length >= 275, true, `reachable service rooms ${reachableServiceRooms.length}`);
  assert.equal(stationRooms.length >= 105, true, `station rooms ${stationRooms.length}`);
  assert.equal(inspectionRooms.length >= 55, true, `inspection rooms ${inspectionRooms.length}`);
  assert.equal(microServiceRooms.length >= 250, true, `micro service rooms ${microServiceRooms.length}`);
  assert.equal(getRouteCueMarkers(gen.world).some(marker => marker.tags.includes('service_spines')), true);

  for (const room of serviceRooms.slice(0, 64)) {
    assert.equal(roomHasReachableCell(gen.world, audit, room), true, `${room.name} reachable`);
  }
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal(territoryCellCount(gen.world, owner) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = hqAnchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => {
      const door = gen.world.doors.get(doorIdx);
      return door?.state === DoorState.HERMETIC_OPEN || door?.state === DoorState.HERMETIC_CLOSED;
    }), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 12, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(minHqDistance >= 180, true, `HQ min distance ${minHqDistance}`);
  assert.equal(dominant, ZoneFaction.SCIENTIST);
  assertTerritoryShare(gen.world, ZoneFaction.CITIZEN, 0.205, 0.235);
  assertTerritoryShare(gen.world, ZoneFaction.LIQUIDATOR, 0.145, 0.175);
  assertTerritoryShare(gen.world, ZoneFaction.CULTIST, 0.065, 0.095);
  assertTerritoryShare(gen.world, ZoneFaction.SCIENTIST, 0.405, 0.435);
  assertTerritoryShare(gen.world, ZoneFaction.WILD, 0.105, 0.135);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.75, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 076 service spines citizen floor fills mid micro layers and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, -25);
  assert.equal(spec.geometryId, 'service_spines');
  assert.equal(spec.majorityId, 'citizens');
  assert.equal(spec.anomalyId, 'none');
  assert.equal(spec.danger, 3);

  const gen = timedProceduralSpec(spec, 'genfix_076 service_spines citizens seed=61061 z-25');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const serviceRooms = gen.world.rooms.filter(room => room.name.includes('сервисного штрека'));
  const reachableServiceRooms = serviceRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const stationRooms = serviceRooms.filter(room => room.name.includes('станция') || room.name.includes('станции'));
  const inspectionRooms = serviceRooms.filter(room => room.name.includes('инспекционная клетка'));
  const microServiceRooms = serviceRooms.filter(room => room.w * room.h <= 90);
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const hqRooms = hqAnchors
    .map(anchor => gen.world.rooms[anchor.roomId])
    .filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба'));
  const territoryRows = countTerritoryCells(gen.world);
  const dominant = [...territoryRows].sort((a, b) => b.cells - a.cells)[0]?.owner;
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });

  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(gen.world.rooms.length >= 600, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 1_000, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 185_000, true, `reachable ${reachable}`);
  assert.equal(serviceRooms.length >= 300, true, `service rooms ${serviceRooms.length}`);
  assert.equal(reachableServiceRooms.length >= 290, true, `reachable service rooms ${reachableServiceRooms.length}`);
  assert.equal(stationRooms.length >= 120, true, `station rooms ${stationRooms.length}`);
  assert.equal(inspectionRooms.length >= 60, true, `inspection rooms ${inspectionRooms.length}`);
  assert.equal(microServiceRooms.length >= 250, true, `micro service rooms ${microServiceRooms.length}`);
  assert.equal(getRouteCueMarkers(gen.world).some(marker => marker.tags.includes('service_spines')), true);

  for (const room of serviceRooms.slice(0, 64)) {
    assert.equal(roomHasReachableCell(gen.world, audit, room), true, `${room.name} reachable`);
  }
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal(territoryCellCount(gen.world, owner) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = hqAnchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => {
      const door = gen.world.doors.get(doorIdx);
      return door?.state === DoorState.HERMETIC_OPEN || door?.state === DoorState.HERMETIC_CLOSED;
    }), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 12, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(dominant, ZoneFaction.CITIZEN);
  assertTerritoryShare(gen.world, ZoneFaction.CITIZEN, 0.54, 0.58);
  assertTerritoryShare(gen.world, ZoneFaction.LIQUIDATOR, 0.15, 0.19);
  assertTerritoryShare(gen.world, ZoneFaction.CULTIST, 0.05, 0.09);
  assertTerritoryShare(gen.world, ZoneFaction.SCIENTIST, 0.06, 0.10);
  assertTerritoryShare(gen.world, ZoneFaction.WILD, 0.10, 0.14);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.8, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 068 service spines cult samosbor floor has stations micro rooms and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, -17);
  assert.equal(spec.geometryId, 'service_spines');
  assert.equal(spec.majorityId, 'cultists');
  assert.equal(spec.anomalyId, 'samosbor_seed');
  assert.equal(spec.danger, 4);

  const gen = timedProceduralSpec(spec, 'genfix_068 service_spines cult samosbor seed=61061 z-17');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const serviceRooms = gen.world.rooms.filter(room => room.name.includes('сервисного штрека'));
  const stationRooms = gen.world.rooms.filter(room => room.name.includes('станция') && room.name.includes('сервисного штрека'));
  const inspectionRooms = gen.world.rooms.filter(room => room.name.includes('инспекционная клетка') && room.name.includes('сервисного штрека'));
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const hqRooms = hqAnchors
    .map(anchor => gen.world.rooms[anchor.roomId])
    .filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба'));
  const territoryRows = countTerritoryCells(gen.world);
  const dominant = [...territoryRows].sort((a, b) => b.cells - a.cells)[0]?.owner;
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });

  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(gen.world.rooms.length >= 700, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 1_300, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 190_000, true, `reachable ${reachable}`);
  assert.equal(serviceRooms.length >= 380, true, `service rooms ${serviceRooms.length}`);
  assert.equal(stationRooms.length >= 150, true, `station rooms ${stationRooms.length}`);
  assert.equal(inspectionRooms.length >= 80, true, `inspection rooms ${inspectionRooms.length}`);
  assert.equal(getRouteCueMarkers(gen.world).some(marker => marker.tags.includes('service_spines')), true);

  for (const room of serviceRooms.slice(0, 64)) {
    assert.equal(roomHasReachableCell(gen.world, audit, room), true, `${room.name} reachable`);
  }
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal(territoryCellCount(gen.world, owner) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = hqAnchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => gen.world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 12, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(dominant, ZoneFaction.CULTIST);
  assertTerritoryShare(gen.world, ZoneFaction.CITIZEN, 0.13, 0.18);
  assertTerritoryShare(gen.world, ZoneFaction.LIQUIDATOR, 0.09, 0.13);
  assertTerritoryShare(gen.world, ZoneFaction.CULTIST, 0.34, 0.39);
  assertTerritoryShare(gen.world, ZoneFaction.SCIENTIST, 0.05, 0.09);
  assertTerritoryShare(gen.world, ZoneFaction.WILD, 0.20, 0.24);
  assertTerritoryShare(gen.world, ZoneFaction.SAMOSBOR, 0.07, 0.11);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.68, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 080 conveyor service spines scale up stations and scientist territory control', () => {
  const spec = makeProceduralFloorSpec(61_061, -29);
  assert.equal(spec.geometryId, 'service_spines');
  assert.equal(spec.majorityId, 'scientists');
  assert.equal(spec.anomalyId, 'conveyor_sorter');
  assert.equal(spec.danger, 4);

  const gen = timedProceduralSpec(spec, 'genfix_080 conveyor service_spines scientists seed=61061 z-29');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const serviceRooms = gen.world.rooms.filter(room => room.name.includes('сервисного штрека'));
  const stationRooms = gen.world.rooms.filter(room => room.name.includes('станция') || room.name.includes('станции'));
  const conveyorRooms = gen.world.rooms.filter(room => room.name.includes('Сортиров'));
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const hqRooms = hqAnchors
    .map(anchor => gen.world.rooms[anchor.roomId])
    .filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба'));
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });

  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(gen.world.rooms.length >= 650, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 1_000, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 190_000, true, `reachable ${reachable}`);
  assert.equal(serviceRooms.length >= 320, true, `service rooms ${serviceRooms.length}`);
  assert.equal(stationRooms.length >= 180, true, `station rooms ${stationRooms.length}`);
  assert.equal(conveyorRooms.length >= 40, true, `conveyor rooms ${conveyorRooms.length}`);
  assert.equal(getRouteCueMarkers(gen.world).some(marker => marker.tags.includes('service_spines')), true);

  for (const room of serviceRooms.slice(0, 48)) {
    assert.equal(roomHasReachableCell(gen.world, audit, room), true, `${room.name} reachable`);
  }
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal(territoryCellCount(gen.world, owner) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = hqAnchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => gen.world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 12, true, `HQ support rooms ${supportRooms.length}`);
  assertTerritoryShare(gen.world, ZoneFaction.CITIZEN, 0.205, 0.235);
  assertTerritoryShare(gen.world, ZoneFaction.LIQUIDATOR, 0.145, 0.175);
  assertTerritoryShare(gen.world, ZoneFaction.CULTIST, 0.065, 0.095);
  assertTerritoryShare(gen.world, ZoneFaction.SCIENTIST, 0.405, 0.435);
  assertTerritoryShare(gen.world, ZoneFaction.WILD, 0.105, 0.135);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.8, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 082 procedural workshop wild floor fills factory islands and target territory control', () => {
  const spec = makeProceduralFloorSpec(61_061, -31);
  assert.equal(spec.geometryId, 'workshops');
  assert.equal(spec.majorityId, 'wild');
  assert.equal(spec.anomalyId, 'none');
  assert.equal(spec.danger, 4);

  const gen = timedProceduralSpec(spec, 'genfix_082 workshops wild seed=61061 z-31');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const islandRooms = gen.world.rooms.filter(room => room.name.includes('Цеховой остров'));
  const supportRooms = gen.world.rooms.filter(room =>
    /^(Цеховой туалет|Комната кипятка цеха|Мастерская контора|Инструментальная ячейка|Бытовка цеха)/.test(room.name),
  );
  const factoryRooms = gen.world.rooms.filter(room =>
    room.name.startsWith('Цех металла') ||
    room.name.startsWith('Плавильня гильз') ||
    room.name.startsWith('Оружейная мастерская') ||
    room.name.startsWith('Технический склад'),
  );
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const hqRooms = hqAnchors
    .map(anchor => gen.world.rooms[anchor.roomId])
    .filter(room => room?.type === RoomType.HQ);
  const hqSupportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });
  let minHqDistance = Infinity;
  for (let i = 0; i < hqAnchors.length; i++) {
    for (let j = i + 1; j < hqAnchors.length; j++) {
      minHqDistance = Math.min(minHqDistance, Math.sqrt(gen.world.dist2(hqAnchors[i].x, hqAnchors[i].y, hqAnchors[j].x, hqAnchors[j].y)));
    }
  }

  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(gen.world.rooms.length >= 360, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.rooms.every(room => room.w > 0 && room.h > 0), true, 'workshop rooms should have positive dimensions');
  assert.equal(gen.world.doors.size >= 1_000, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 160_000, true, `reachable ${reachable}`);
  assert.equal(islandRooms.length >= 28, true, `workshop island rooms ${islandRooms.length}`);
  assert.equal(supportRooms.length >= 160, true, `workshop support rooms ${supportRooms.length}`);
  assert.equal(factoryRooms.length >= 60, true, `factory rooms ${factoryRooms.length}`);
  assert.equal(getRouteCueMarkers(gen.world).some(marker => marker.tags.includes('factory_islands')), true);

  for (const room of supportRooms.slice(0, 80)) {
    assert.equal(roomHasReachableCell(gen.world, audit, room), true, `${room.name} reachable`);
  }
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal(territoryCellCount(gen.world, owner) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = hqAnchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => gen.world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(hqSupportRooms.length >= 12, true, `HQ support rooms ${hqSupportRooms.length}`);
  assert.equal(minHqDistance >= 260, true, `HQ min distance ${minHqDistance}`);
  assertTerritoryShare(gen.world, ZoneFaction.CITIZEN, 0.145, 0.195);
  assertTerritoryShare(gen.world, ZoneFaction.LIQUIDATOR, 0.105, 0.155);
  assertTerritoryShare(gen.world, ZoneFaction.CULTIST, 0.095, 0.145);
  assertTerritoryShare(gen.world, ZoneFaction.SCIENTIST, 0.055, 0.105);
  assertTerritoryShare(gen.world, ZoneFaction.WILD, 0.475, 0.525);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.78, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('attic weatherworks geometry exposes wind lanes, crawl pockets, repair and document choices', () => {
  const def = FLOOR_GEOMETRIES.find(item => item.id === 'attic_weatherworks');
  assert.equal(def?.tags.includes('wind'), true);
  assert.equal(def?.tags.includes('documents'), true);

  const z = proceduralZForGeometry(def!);
  const base = makeProceduralFloorSpec(38_038, z);
  const gen = timedProceduralSpec({
    ...base,
    geometryId: 'attic_weatherworks',
    baseFloor: FloorLevel.MINISTRY,
    majorityId: 'liquidators',
    anomalyId: 'none',
    danger: 4,
    title: `чердачные венткамеры: ${base.title}`,
  }, 'forced attic_weatherworks seed=38038');
  const audit = reachabilityAudit(gen);

  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  const pocketRooms = gen.world.rooms.filter(room => room.name.startsWith('Чердачный '));
  const noisyRooms = gen.world.rooms.filter(room => room.name.includes('шумной тяги'));
  assert.equal(pocketRooms.length >= 1, true, `attic pockets ${pocketRooms.length}`);
  assert.equal(noisyRooms.length >= 2, true, `noisy duct rooms ${noisyRooms.length}`);
  for (const room of pocketRooms) {
    const ci = gen.world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2));
    assertAuditReachable(gen.world, audit, ci, `${room.name} center`);
  }

  let exposedWindCells = 0;
  let ductFixtures = 0;
  for (let i = 0; i < gen.world.cells.length; i++) {
    if (!audit.reachable[i] || gen.world.roomMap[i] >= 0) continue;
    if (gen.world.wallTex[i] !== Tex.PIPE || gen.world.floorTex[i] !== Tex.F_CONCRETE) continue;
    if (gen.world.fog[i] >= 18) exposedWindCells++;
    const feature = gen.world.features[i];
    if (feature === Feature.SCREEN || feature === Feature.APPARATUS || feature === Feature.MACHINE || feature === Feature.LAMP) ductFixtures++;
  }
  assert.equal(exposedWindCells >= 84, true, `wind cells ${exposedWindCells}`);
  assert.equal(ductFixtures >= 12, true, `duct fixtures ${ductFixtures}`);

  const atticContainers = gen.world.containers.filter(container => container.tags.includes('attic_weatherworks'));
  assert.equal(atticContainers.some(container => container.tags.includes('duct_repair')), true);
  assert.equal(atticContainers.some(container => container.tags.includes('document_cache') && container.tags.includes('steal_document_cache')), true);

  const atticCues = getRouteCueMarkers(gen.world).filter(marker => marker.tags.includes('attic_weatherworks'));
  assert.equal(atticCues.some(marker => marker.tags.includes('wind_lane') && marker.tags.includes('exposed_service_run')), true);
  assert.equal(atticCues.some(marker => marker.tags.includes('document_cache') && marker.tags.includes('crawl_bypass')), true);
});

testGenerationMatrix('genfix 008 procedural false-safe attic liquidator floor keeps scaled weatherworks and target territory shares', () => {
  const base = makeProceduralFloorSpec(61_061, 43);
  const spec = {
    ...base,
    anomalyId: 'false_safe_block' as const,
    danger: 4 as const,
    title: `ложная безопасность: ${base.title}`,
  };
  assert.equal(spec.geometryId, 'attic_weatherworks');
  assert.equal(spec.majorityId, 'liquidators');
  assert.equal(spec.anomalyId, 'false_safe_block');
  assert.equal(spec.danger, 4);

  const gen = timedProceduralSpec(spec, 'genfix_008 attic false-safe liquidators seed=61061 z43');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const atticRooms = gen.world.rooms.filter(room => room.name.startsWith('Чердачный '));
  const smallRooms = gen.world.rooms.filter(room => room.w * room.h <= 54);
  const falseSafeRooms = gen.world.rooms.filter(room => room.name.startsWith('Тихий блок'));
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const hqRooms = hqAnchors
    .map(anchor => gen.world.rooms[anchor.roomId])
    .filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room =>
    room.name.includes('штаба') ||
    room.name.startsWith('Чердачная опора'));
  const territoryCounts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (territoryCounts.get(owner) ?? 0) / (W * W);
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });

  assertFullFootprint(gen.world, 'genfix_008 attic false-safe');
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(reachableBucketCount(gen.world, audit.reachable, 128), 64);
  assert.equal(gen.world.rooms.length >= 540, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 1_300, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 165_000, true, `reachable ${reachable}`);
  assert.equal(atticRooms.length >= 75, true, `attic rooms ${atticRooms.length}`);
  assert.equal(smallRooms.length >= 150, true, `small rooms ${smallRooms.length}`);
  assert.equal(falseSafeRooms.length >= 4, true, `false-safe rooms ${falseSafeRooms.length}`);
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 20, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(getRouteCueMarkers(gen.world).some(marker => marker.tags.includes('attic_weatherworks')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('false_safe_block')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('attic_weatherworks') && container.tags.includes('duct_repair')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('attic_weatherworks') && container.tags.includes('document_cache')), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((territoryCounts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = hqAnchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed core ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => gen.world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(Math.abs(share(ZoneFaction.CITIZEN) - 0.16) <= 0.015, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(Math.abs(share(ZoneFaction.LIQUIDATOR) - 0.53) <= 0.015, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(Math.abs(share(ZoneFaction.CULTIST) - 0.12) <= 0.015, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.SCIENTIST) - 0.08) <= 0.015, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.WILD) - 0.11) <= 0.015, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.75, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 003 attic living tunnels scale up rooms and wild territory control', () => {
  const base = makeProceduralFloorSpec(61_061, 48);
  const gen = timedProceduralSpec({
    ...base,
    geometryId: 'attic_weatherworks',
    baseFloor: FloorLevel.MINISTRY,
    majorityId: 'wild',
    anomalyId: 'living_tunnels',
    danger: 5,
    title: `genfix 003: ${base.title}`,
  }, 'genfix_003 attic living tunnels seed=61061');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const territoryCounts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (territoryCounts.get(owner) ?? 0) / (W * W);

  assert.equal(gen.world.rooms.length >= 420, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 760, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 130_000, true, `reachable ${reachable}`);
  assert.equal(getRouteCueMarkers(gen.world).some(marker => marker.tags.includes('living_tunnels')), true);
  assert.equal(getRouteCueMarkers(gen.world).some(marker => marker.tags.includes('attic_weatherworks')), true);
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((territoryCounts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
  }
  assert.equal(share(ZoneFaction.CITIZEN) >= 0.14 && share(ZoneFaction.CITIZEN) <= 0.20, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(share(ZoneFaction.LIQUIDATOR) >= 0.10 && share(ZoneFaction.LIQUIDATOR) <= 0.16, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(share(ZoneFaction.CULTIST) >= 0.09 && share(ZoneFaction.CULTIST) <= 0.15, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(share(ZoneFaction.SCIENTIST) >= 0.06 && share(ZoneFaction.SCIENTIST) <= 0.10, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(share(ZoneFaction.WILD) >= 0.46 && share(ZoneFaction.WILD) <= 0.54, true, `wild share ${share(ZoneFaction.WILD)}`);
});

testGenerationMatrix('genfix 004 procedural attic mirror scientists floor has multi-scale rooms and target territory shares', () => {
  const spec = makeProceduralFloorSpec(61_061, 47);
  assert.equal(spec.geometryId, 'attic_weatherworks');
  assert.equal(spec.majorityId, 'scientists');
  assert.equal(spec.anomalyId, 'mirror_run');
  assert.equal(spec.danger, 4);

  const gen = timedProceduralSpec(spec, 'genfix_004 attic mirror scientists seed=61061');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const atticRooms = gen.world.rooms.filter(room => room.name.startsWith('Чердачный '));
  const smallRooms = gen.world.rooms.filter(room => room.w * room.h <= 54);
  const mirrorRooms = gen.world.rooms.filter(room => room.name.includes('Зеркало '));
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const territoryCounts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (territoryCounts.get(owner) ?? 0) / (W * W);
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });

  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(gen.world.rooms.length >= 540, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 1_200, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 160_000, true, `reachable ${reachable}`);
  assert.equal(atticRooms.length >= 70, true, `attic rooms ${atticRooms.length}`);
  assert.equal(smallRooms.length >= 150, true, `small rooms ${smallRooms.length}`);
  assert.equal(mirrorRooms.length >= 10, true, `mirror rooms ${mirrorRooms.length}`);
  assert.equal(gen.world.anomalyTeleports.size >= 2, true, `mirror teleports ${gen.world.anomalyTeleports.size}`);
  assert.equal(getRouteCueMarkers(gen.world).some(marker => marker.tags.includes('attic_weatherworks')), true);
  assert.equal(getRouteCueMarkers(gen.world).some(marker => marker.tags.includes('mirror_run')), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((territoryCounts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = hqAnchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed core ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => gen.world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(Math.abs(share(ZoneFaction.CITIZEN) - 0.22) <= 0.02, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(Math.abs(share(ZoneFaction.LIQUIDATOR) - 0.16) <= 0.02, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(Math.abs(share(ZoneFaction.CULTIST) - 0.08) <= 0.02, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.SCIENTIST) - 0.42) <= 0.02, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.WILD) - 0.12) <= 0.02, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(share(ZoneFaction.SCIENTIST) > share(ZoneFaction.CITIZEN), true);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.75, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 012 procedural attic smog citizen floor has multi-scale weatherworks and target territory shares', () => {
  const spec = makeProceduralFloorSpec(61_061, 39);
  assert.equal(spec.geometryId, 'attic_weatherworks');
  assert.equal(spec.majorityId, 'citizens');
  assert.equal(spec.anomalyId, 'smog');
  assert.equal(spec.danger, 4);

  const gen = timedProceduralSpec(spec, 'genfix_012 attic smog citizens seed=61061');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const atticRooms = gen.world.rooms.filter(room => room.name.startsWith('Чердачный '));
  const smallRooms = gen.world.rooms.filter(room => room.w * room.h <= 54);
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const territoryCounts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (territoryCounts.get(owner) ?? 0) / (W * W);
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });

  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(gen.world.rooms.length >= 520, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 1_200, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 160_000, true, `reachable ${reachable}`);
  assert.equal(atticRooms.length >= 70, true, `attic rooms ${atticRooms.length}`);
  assert.equal(smallRooms.length >= 140, true, `small rooms ${smallRooms.length}`);
  assert.equal(gen.world.anomalySmogCells.length >= 500, true, `smog cells ${gen.world.anomalySmogCells.length}`);
  assert.equal(getRouteCueMarkers(gen.world).some(marker => marker.tags.includes('attic_weatherworks')), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((territoryCounts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = hqAnchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed core ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => gen.world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(Math.abs(share(ZoneFaction.CITIZEN) - 0.56) <= 0.02, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(Math.abs(share(ZoneFaction.LIQUIDATOR) - 0.17) <= 0.02, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(Math.abs(share(ZoneFaction.CULTIST) - 0.07) <= 0.02, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.SCIENTIST) - 0.08) <= 0.02, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.WILD) - 0.12) <= 0.02, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.65, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 014 procedural radio chess attic wild floor keeps multi-scale geometry and target territory shares', () => {
  const base = makeProceduralFloorSpec(61_061, 37);
  const gen = timedProceduralSpec({
    ...base,
    geometryId: 'attic_weatherworks',
    baseFloor: FloorLevel.MINISTRY,
    majorityId: 'wild',
    anomalyId: 'radio_chess',
    danger: 4,
    title: `genfix 014: ${base.title}`,
  }, 'genfix_014 attic radio chess seed=61061');
  const audit = reachabilityAudit(gen);
  const reachable = countReachableCells(audit.reachable);
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const territoryCounts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (territoryCounts.get(owner) ?? 0) / (W * W);

  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(gen.world.rooms.length >= 500, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 1_000, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 160_000, true, `reachable ${reachable}`);
  assert.equal(getRouteCueMarkers(gen.world).some(marker => marker.tags.includes('attic_weatherworks')), true);
  assert.equal(getRouteCueMarkers(gen.world).some(marker => marker.tags.includes('radio_chess')), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((territoryCounts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = hqAnchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed core ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => gen.world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(share(ZoneFaction.CITIZEN) >= 0.13 && share(ZoneFaction.CITIZEN) <= 0.21, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(share(ZoneFaction.LIQUIDATOR) >= 0.09 && share(ZoneFaction.LIQUIDATOR) <= 0.17, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(share(ZoneFaction.CULTIST) >= 0.08 && share(ZoneFaction.CULTIST) <= 0.16, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(share(ZoneFaction.SCIENTIST) >= 0.05 && share(ZoneFaction.SCIENTIST) <= 0.11, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(share(ZoneFaction.WILD) >= 0.46 && share(ZoneFaction.WILD) <= 0.54, true, `wild share ${share(ZoneFaction.WILD)}`);
});

testGenerationMatrix('sump causeway geometry builds dry repair spans and off-path stash islands', () => {
  const def = FLOOR_GEOMETRIES.find(item => item.id === 'sump_causeways');
  assert.equal(def?.minZ, 21);
  assert.equal(def?.maxZ, 39);
  assert.equal(def?.tags.includes('sump'), true);

  const base = makeProceduralFloorSpec(42_042, -35);
  const gen = timedProceduralSpec({
    ...base,
    geometryId: 'sump_causeways',
    baseFloor: FloorLevel.MAINTENANCE,
    majorityId: 'liquidators',
    anomalyId: 'none',
    danger: 5,
    title: `затопленные эстакады: ${base.title}`,
  }, 'forced sump_causeways seed=42042');
  const audit = reachabilityAudit(gen);
  const dryReachable = dryReachableFromSpawn(gen);
  const repairRooms = gen.world.rooms.filter(room => room.name.startsWith('Ремонтный пролет эстакады'));
  const stashRooms = gen.world.rooms.filter(room => room.name.startsWith('Сухой остров черной воды'));
  const repairRoomIds = new Set(repairRooms.map(room => room.id));
  const stashRoomIds = new Set(stashRooms.map(room => room.id));
  const waterPanels = getEmergencyPanels(gen.world).filter(panel => panel.defId === 'panel_water' && repairRoomIds.has(panel.roomId));
  const islandStashes = gen.world.containers.filter(container => container.tags.includes('sump_island_stash'));
  let waterCells = 0;
  for (const cell of gen.world.cells) if (cell === Cell.WATER) waterCells++;

  assert.equal(waterCells >= 20_000, true, 'blackwater percolation field should be substantial');
  assert.equal(repairRooms.length >= 2, true);
  assert.equal(stashRooms.length >= 2, true);
  assert.equal(waterPanels.length >= 2, true);
  assert.equal(islandStashes.length >= 1, true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(hasDryReachableLift(gen, dryReachable, LiftDirection.UP), true);
  assert.equal(hasDryReachableLift(gen, dryReachable, LiftDirection.DOWN), true);

  for (const room of repairRooms) {
    const ci = gen.world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2));
    assert.equal(dryReachable[ci], 1, `${room.name} should sit on the dry repair component`);
  }
  for (const room of stashRooms) {
    const ci = gen.world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2));
    assertAuditReachable(gen.world, audit, ci, `${room.name} passable route`);
    assert.equal(dryReachable[ci], 0, `${room.name} should require crossing blackwater`);
  }
  for (const stash of islandStashes) {
    assert.equal(stashRoomIds.has(stash.roomId ?? -1), true, `${stash.name} should be on a stash island`);
    assertAuditReachable(gen.world, audit, gen.world.idx(stash.x, stash.y), stash.name);
  }
});

testGenerationMatrix('genfix 078 sump conveyor cultist floor has dense stations, micro rooms and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, -27);
  assert.equal(spec.geometryId, 'sump_causeways');
  assert.equal(spec.majorityId, 'cultists');
  assert.equal(spec.anomalyId, 'conveyor_sorter');
  assert.equal(spec.danger, 5);

  const gen = timedProceduralSpec(spec, 'genfix_078 sump conveyor cultists seed=61061 z-27');
  const audit = reachabilityAudit(gen);
  const dryReachable = dryReachableFromSpawn(gen);
  const reachable = countReachableCells(audit.reachable);
  const stations = gen.world.rooms.filter(room => room.name.startsWith('Сухая станция эстакады'));
  const microRooms = gen.world.rooms.filter(room => room.name.startsWith('Боковая будка эстакады'));
  const dryStations = stations.filter(room => roomHasMaskCell(gen.world, dryReachable, room));
  const dryMicroRooms = microRooms.filter(room => roomHasMaskCell(gen.world, dryReachable, room));
  const sorterAnnexRooms = gen.world.rooms.filter(room => room.name.startsWith('Сортировочная станция'));
  const conveyorRooms = gen.world.rooms.filter(room => room.name.startsWith('Сортировочный конвейер'));
  const smallRooms = gen.world.rooms.filter(room => room.w * room.h <= 72);
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const hqRooms = hqAnchors.map(anchor => gen.world.rooms[anchor.roomId]).filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const territoryCounts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (territoryCounts.get(owner) ?? 0) / (W * W);
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });
  let waterCells = 0;
  for (const cell of gen.world.cells) if (cell === Cell.WATER) waterCells++;

  assert.equal(gen.world.rooms.length >= 400, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 500, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 140_000, true, `reachable ${reachable}`);
  assert.equal(reachableBucketCount(gen.world, audit.reachable, 128), 64);
  assert.equal(waterCells >= 50_000, true, `water cells ${waterCells}`);
  assert.equal(smallRooms.length >= 220, true, `small rooms ${smallRooms.length}`);
  assert.equal(stations.length >= 45, true, `sump stations ${stations.length}`);
  assert.equal(microRooms.length >= 190, true, `sump micro rooms ${microRooms.length}`);
  assert.equal(dryStations.length >= 30, true, `dry stations ${dryStations.length}`);
  assert.equal(dryMicroRooms.length >= 130, true, `dry micro rooms ${dryMicroRooms.length}`);
  assert.equal(sorterAnnexRooms.length >= 32, true, `sorter annex rooms ${sorterAnnexRooms.length}`);
  assert.equal(conveyorRooms.length >= 12, true, `conveyor rooms ${conveyorRooms.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(hasDryReachableLift(gen, dryReachable, LiftDirection.UP), true);
  assert.equal(hasDryReachableLift(gen, dryReachable, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((territoryCounts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = hqAnchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => gen.world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 15, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(Math.abs(share(ZoneFaction.CITIZEN) - 0.16) <= 0.02, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(Math.abs(share(ZoneFaction.LIQUIDATOR) - 0.12) <= 0.02, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(Math.abs(share(ZoneFaction.CULTIST) - 0.40) <= 0.02, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.SCIENTIST) - 0.08) <= 0.02, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.WILD) - 0.24) <= 0.02, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.75, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testBadAppleExperiment('genfix 097 bad apple sump cultist floor has dense causeways, edge rooms and target territory', () => {
  const base = makeProceduralFloorSpec(61_061, -46);
  const spec = {
    ...base,
    anomalyId: 'bad_apple_world' as const,
    danger: 5 as const,
    title: `bad apple!: ${base.title}`,
  };
  assert.equal(spec.geometryId, 'sump_causeways');
  assert.equal(spec.majorityId, 'cultists');
  assert.equal(spec.anomalyId, 'bad_apple_world');
  assert.equal(spec.danger, 5);

  const gen = timedProceduralSpec(spec, 'genfix_097 bad apple sump cultists seed=61061 z-46');
  const audit = reachabilityAudit(gen);
  const dryReachable = dryReachableFromSpawn(gen);
  const reachable = countReachableCells(audit.reachable);
  const stations = gen.world.rooms.filter(room => room.name.startsWith('Сухая станция эстакады'));
  const microRooms = gen.world.rooms.filter(room => room.name.startsWith('Боковая будка эстакады'));
  const edgeBooths = gen.world.rooms.filter(room => room.name.startsWith('Боковой отсек эстакады'));
  const dryStations = stations.filter(room => roomHasMaskCell(gen.world, dryReachable, room));
  const dryMicroRooms = microRooms.filter(room => roomHasMaskCell(gen.world, dryReachable, room));
  const dryEdgeBooths = edgeBooths.filter(room => roomHasMaskCell(gen.world, dryReachable, room));
  const smallRooms = gen.world.rooms.filter(room => room.w * room.h <= 72);
  const badAppleRoom = gen.world.rooms.find(room => room.name.startsWith('Bad Apple!'));
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const territoryCounts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (territoryCounts.get(owner) ?? 0) / (W * W);
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });
  let waterCells = 0;
  for (const cell of gen.world.cells) if (cell === Cell.WATER) waterCells++;

  assert.equal(gen.world.rooms.length >= 620, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 700, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 185_000, true, `reachable ${reachable}`);
  assert.equal(reachableBucketCount(gen.world, audit.reachable, 128), 64);
  assert.equal(waterCells >= 80_000, true, `water cells ${waterCells}`);
  assert.equal(smallRooms.length >= 430, true, `small rooms ${smallRooms.length}`);
  assert.equal(stations.length >= 80, true, `sump stations ${stations.length}`);
  assert.equal(microRooms.length >= 300, true, `sump micro rooms ${microRooms.length}`);
  assert.equal(edgeBooths.length >= 100, true, `edge booths ${edgeBooths.length}`);
  assert.equal(dryStations.length >= 50, true, `dry stations ${dryStations.length}`);
  assert.equal(dryMicroRooms.length >= 160, true, `dry micro rooms ${dryMicroRooms.length}`);
  assert.equal(dryEdgeBooths.length >= 80, true, `dry edge booths ${dryEdgeBooths.length}`);
  assert.equal(badAppleRoom?.w, BAD_APPLE_WIDTH);
  assert.equal(badAppleRoom?.h, BAD_APPLE_HEIGHT);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(hasDryReachableLift(gen, dryReachable, LiftDirection.UP), true);
  assert.equal(hasDryReachableLift(gen, dryReachable, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((territoryCounts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = hqAnchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => gen.world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(Math.abs(share(ZoneFaction.CITIZEN) - 0.16) <= 0.02, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(Math.abs(share(ZoneFaction.LIQUIDATOR) - 0.12) <= 0.02, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(Math.abs(share(ZoneFaction.CULTIST) - 0.40) <= 0.02, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.SCIENTIST) - 0.08) <= 0.02, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.WILD) - 0.24) <= 0.02, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.75, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 092 sump rail wild floor has station yards, micro rooms and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, -41);
  assert.equal(spec.geometryId, 'sump_causeways');
  assert.equal(spec.majorityId, 'wild');
  assert.equal(spec.anomalyId, 'rail_trains');
  assert.equal(spec.danger, 5);

  const gen = timedProceduralSpec(spec, 'genfix_092 sump rail wild seed=61061 z-41');
  const audit = reachabilityAudit(gen);
  const dryReachable = dryReachableFromSpawn(gen);
  const reachable = countReachableCells(audit.reachable);
  const stations = gen.world.rooms.filter(room => room.name.startsWith('Сухая станция эстакады'));
  const microRooms = gen.world.rooms.filter(room => room.name.startsWith('Боковая будка эстакады'));
  const railServiceRooms = gen.world.rooms.filter(room => room.name.startsWith('Служба пути') || room.name.startsWith('Карман платформы'));
  const smallRooms = gen.world.rooms.filter(room => room.w * room.h <= 72);
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const territoryCounts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (territoryCounts.get(owner) ?? 0) / (W * W);
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });
  let waterCells = 0;
  for (const cell of gen.world.cells) if (cell === Cell.WATER) waterCells++;

  assert.equal(gen.world.rooms.length >= 640, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 650, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 450_000, true, `reachable ${reachable}`);
  assert.equal(reachableBucketCount(gen.world, audit.reachable, 128), 64);
  assert.equal(waterCells >= 280_000, true, `water cells ${waterCells}`);
  assert.equal(stations.length >= 80, true, `sump stations ${stations.length}`);
  assert.equal(microRooms.length >= 280, true, `sump micro rooms ${microRooms.length}`);
  assert.equal(railServiceRooms.length >= 16, true, `rail service rooms ${railServiceRooms.length}`);
  assert.equal(smallRooms.length >= 450, true, `small rooms ${smallRooms.length}`);
  assert.equal(gen.world.railTracks.length >= 3, true, `rail tracks ${gen.world.railTracks.length}`);
  assert.equal(gen.world.railTrains.length >= 3, true, `rail trains ${gen.world.railTrains.length}`);
  assert.equal(getRouteCueMarkers(gen.world).filter(marker => marker.tags.includes('rail_trains')).length >= 10, true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(hasDryReachableLift(gen, dryReachable, LiftDirection.UP), true);
  assert.equal(hasDryReachableLift(gen, dryReachable, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((territoryCounts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = hqAnchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => gen.world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(Math.abs(share(ZoneFaction.CITIZEN) - 0.17) <= 0.02, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(Math.abs(share(ZoneFaction.LIQUIDATOR) - 0.13) <= 0.02, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(Math.abs(share(ZoneFaction.CULTIST) - 0.12) <= 0.02, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.SCIENTIST) - 0.08) <= 0.02, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.WILD) - 0.50) <= 0.02, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.78, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 098 sump none citizens floor has flooded multi-scale causeways and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, -47);
  assert.equal(spec.geometryId, 'sump_causeways');
  assert.equal(spec.majorityId, 'citizens');
  assert.equal(spec.anomalyId, 'none');
  assert.equal(spec.danger, 4);

  const gen = timedProceduralSpec(spec, 'genfix_098 sump none citizens seed=61061 z-47');
  const audit = reachabilityAudit(gen);
  const dryReachable = dryReachableFromSpawn(gen);
  const reachable = countReachableCells(audit.reachable);
  const stations = gen.world.rooms.filter(room => room.name.startsWith('Сухая станция эстакады'));
  const microRooms = gen.world.rooms.filter(room => room.name.startsWith('Боковая будка эстакады'));
  const edgeBooths = gen.world.rooms.filter(room => room.name.startsWith('Боковой отсек эстакады'));
  const dryStations = stations.filter(room => roomHasMaskCell(gen.world, dryReachable, room));
  const dryMicroRooms = microRooms.filter(room => roomHasMaskCell(gen.world, dryReachable, room));
  const dryEdgeBooths = edgeBooths.filter(room => roomHasMaskCell(gen.world, dryReachable, room));
  const smallRooms = gen.world.rooms.filter(room => room.w * room.h <= 72);
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const hqRooms = hqAnchors.map(anchor => gen.world.rooms[anchor.roomId]).filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const territoryCounts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (territoryCounts.get(owner) ?? 0) / (W * W);
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });
  let waterCells = 0;
  for (const cell of gen.world.cells) if (cell === Cell.WATER) waterCells++;

  assert.equal(gen.world.rooms.length >= 600, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 650, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 430_000, true, `reachable ${reachable}`);
  assert.equal(reachableBucketCount(gen.world, audit.reachable, 128), 64);
  assert.equal(waterCells >= 250_000, true, `water cells ${waterCells}`);
  assert.equal(smallRooms.length >= 450, true, `small rooms ${smallRooms.length}`);
  assert.equal(stations.length >= 70, true, `sump stations ${stations.length}`);
  assert.equal(microRooms.length >= 250, true, `sump micro rooms ${microRooms.length}`);
  assert.equal(edgeBooths.length >= 160, true, `edge booths ${edgeBooths.length}`);
  assert.equal(dryStations.length >= 35, true, `dry stations ${dryStations.length}`);
  assert.equal(dryMicroRooms.length + dryEdgeBooths.length >= 240, true, `dry micro layer ${dryMicroRooms.length + dryEdgeBooths.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(hasDryReachableLift(gen, dryReachable, LiftDirection.UP), true);
  assert.equal(hasDryReachableLift(gen, dryReachable, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((territoryCounts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = hqAnchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => gen.world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 15, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(Math.abs(share(ZoneFaction.CITIZEN) - 0.56) <= 0.02, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(Math.abs(share(ZoneFaction.LIQUIDATOR) - 0.17) <= 0.02, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(Math.abs(share(ZoneFaction.CULTIST) - 0.07) <= 0.02, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.SCIENTIST) - 0.08) <= 0.02, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.WILD) - 0.12) <= 0.02, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.75, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 100 deep sump none scientist floor has flooded field, edge booths and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, -49);
  assert.equal(spec.geometryId, 'sump_causeways');
  assert.equal(spec.majorityId, 'scientists');
  assert.equal(spec.anomalyId, 'none');
  assert.equal(spec.danger, 4);
  assert.equal(floorRunZAllowsNpcs(spec.z), false);

  const gen = timedProceduralSpec(spec, 'genfix_100 sump none scientists seed=61061 z-49');
  const audit = reachabilityAudit(gen);
  const dryReachable = dryReachableFromSpawn(gen);
  const reachable = countReachableCells(audit.reachable);
  const stations = gen.world.rooms.filter(room => room.name.startsWith('Сухая станция эстакады'));
  const microRooms = gen.world.rooms.filter(room => room.name.startsWith('Боковая будка эстакады'));
  const edgeBooths = gen.world.rooms.filter(room => room.name.startsWith('Боковой отсек эстакады'));
  const dryStations = stations.filter(room => roomHasMaskCell(gen.world, dryReachable, room));
  const dryMicroRooms = microRooms.filter(room => roomHasMaskCell(gen.world, dryReachable, room));
  const dryEdgeBooths = edgeBooths.filter(room => roomHasMaskCell(gen.world, dryReachable, room));
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const hqRooms = hqAnchors.map(anchor => gen.world.rooms[anchor.roomId]).filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const territoryRows = countTerritoryCells(gen.world);
  const dominant = [...territoryRows].sort((a, b) => b.cells - a.cells)[0]?.owner;
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  let waterCells = 0;
  for (const cell of gen.world.cells) if (cell === Cell.WATER) waterCells++;

  assert.equal(gen.world.rooms.length >= 620, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 640, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 420_000, true, `reachable ${reachable}`);
  assert.equal(reachableBucketCount(gen.world, audit.reachable, 128), 64);
  assert.equal(waterCells >= 250_000, true, `water cells ${waterCells}`);
  assert.equal(stations.length >= 75, true, `sump stations ${stations.length}`);
  assert.equal(microRooms.length >= 260, true, `sump micro rooms ${microRooms.length}`);
  assert.equal(edgeBooths.length >= 170, true, `edge booths ${edgeBooths.length}`);
  assert.equal(dryStations.length >= 40, true, `dry stations ${dryStations.length}`);
  assert.equal(dryMicroRooms.length >= 110, true, `dry micro rooms ${dryMicroRooms.length}`);
  assert.equal(dryEdgeBooths.length >= 90, true, `dry edge booths ${dryEdgeBooths.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(hasDryReachableLift(gen, dryReachable, LiftDirection.UP), true);
  assert.equal(hasDryReachableLift(gen, dryReachable, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal(territoryCellCount(gen.world, owner) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = hqAnchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => gen.world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }

  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 15, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(dominant, ZoneFaction.SCIENTIST);
  assertTerritoryShare(gen.world, ZoneFaction.CITIZEN, 0.20, 0.24);
  assertTerritoryShare(gen.world, ZoneFaction.LIQUIDATOR, 0.14, 0.18);
  assertTerritoryShare(gen.world, ZoneFaction.CULTIST, 0.06, 0.10);
  assertTerritoryShare(gen.world, ZoneFaction.SCIENTIST, 0.40, 0.44);
  assertTerritoryShare(gen.world, ZoneFaction.WILD, 0.10, 0.14);
  assert.equal(npcs.length, 0, 'z-49 route floor should stay NPC-free');
});

testGenerationMatrix('genfix 084 procedural sump conway liquidator floor keeps macro and fills mid micro territory', () => {
  const base = makeProceduralFloorSpec(61_061, -33);
  const spec = {
    ...base,
    anomalyId: 'conway_life' as const,
    danger: 5 as const,
    title: `клеточная жизнь: ${base.title}`,
  };
  assert.equal(spec.geometryId, 'sump_causeways');
  assert.equal(spec.majorityId, 'liquidators');
  assert.equal(spec.anomalyId, 'conway_life');
  assert.equal(spec.danger, 5);

  const gen = timedProceduralSpec(spec, 'genfix_084 sump conway liquidators seed=61061 z-33');
  const audit = reachabilityAudit(gen);
  const dryReachable = dryReachableFromSpawn(gen);
  const reachable = countReachableCells(audit.reachable);
  const dryReachableCells = countReachableCells(dryReachable);
  const stations = gen.world.rooms.filter(room => room.name.startsWith('Сухая станция эстакады'));
  const microRooms = gen.world.rooms.filter(room => room.name.startsWith('Боковая будка эстакады'));
  const lifeStations = gen.world.rooms.filter(room => room.name.startsWith('Клеточная станция эстакады'));
  const lifeMicroRooms = gen.world.rooms.filter(room => room.name.startsWith('Клеточная будка эстакады'));
  const dryLifeStations = lifeStations.filter(room => roomHasMaskCell(gen.world, dryReachable, room));
  const dryLifeMicroRooms = lifeMicroRooms.filter(room => roomHasMaskCell(gen.world, dryReachable, room));
  const smallRooms = gen.world.rooms.filter(room => room.w * room.h <= 72);
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const hqRooms = hqAnchors.map(anchor => gen.world.rooms[anchor.roomId]).filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const territoryCounts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (territoryCounts.get(owner) ?? 0) / (W * W);
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });
  const cues = getRouteCueMarkers(gen.world);
  let waterCells = 0;
  for (const cell of gen.world.cells) if (cell === Cell.WATER) waterCells++;

  assert.equal(gen.world.rooms.length >= 400, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 300, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 780_000, true, `reachable ${reachable}`);
  assert.equal(reachableBucketCount(gen.world, audit.reachable, 128), 64);
  assert.equal(dryReachableCells >= 500_000, true, `dry reachable ${dryReachableCells}`);
  assert.equal(waterCells >= 70_000, true, `water cells ${waterCells}`);
  assert.equal(smallRooms.length >= 270, true, `small rooms ${smallRooms.length}`);
  assert.equal(stations.length >= 50, true, `sump stations ${stations.length}`);
  assert.equal(microRooms.length >= 180, true, `sump micro rooms ${microRooms.length}`);
  assert.equal(lifeStations.length >= 24, true, `life stations ${lifeStations.length}`);
  assert.equal(lifeMicroRooms.length >= 70, true, `life micro rooms ${lifeMicroRooms.length}`);
  assert.equal(dryLifeStations.length >= 24, true, `dry life stations ${dryLifeStations.length}`);
  assert.equal(dryLifeMicroRooms.length >= 70, true, `dry life micro rooms ${dryLifeMicroRooms.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(hasDryReachableLift(gen, dryReachable, LiftDirection.UP), true);
  assert.equal(hasDryReachableLift(gen, dryReachable, LiftDirection.DOWN), true);
  assert.equal(cues.some(cue => cue.tags.includes('sump_causeways') && cue.tags.includes('conway_life') && cue.tags.includes('mid_geometry')), true);
  assert.equal(cues.some(cue => cue.tags.includes('conway_life') && cue.tags.includes('visible_anomaly')), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((territoryCounts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = hqAnchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => gen.world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 15, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(Math.abs(share(ZoneFaction.CITIZEN) - 0.17) <= 0.02, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(Math.abs(share(ZoneFaction.LIQUIDATOR) - 0.56) <= 0.02, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(Math.abs(share(ZoneFaction.CULTIST) - 0.07) <= 0.02, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.SCIENTIST) - 0.08) <= 0.02, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.WILD) - 0.12) <= 0.02, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length >= 1_000, true, `NPCs ${npcs.length}`);
  assert.equal(ownTerritoryNpcs.length / npcs.length >= 0.75, true, `own territory NPC share ${ownTerritoryNpcs.length / npcs.length}`);
});

testGenerationMatrix('genfix 094 sump mushroom citizens floor has dense causeways mycelium and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, -43);
  assert.equal(spec.geometryId, 'sump_causeways');
  assert.equal(spec.majorityId, 'citizens');
  assert.equal(spec.anomalyId, 'mushroom_mycelium');
  assert.equal(spec.danger, 4);

  const gen = timedProceduralSpec(spec, 'genfix_094 sump mushroom citizens seed=61061 z-43');
  const audit = reachabilityAudit(gen);
  const dryReachable = dryReachableFromSpawn(gen);
  const reachable = countReachableCells(audit.reachable);
  const stations = gen.world.rooms.filter(room => room.name.startsWith('Сухая станция эстакады'));
  const microRooms = gen.world.rooms.filter(room => room.name.startsWith('Боковая будка эстакады'));
  const dryStations = stations.filter(room => roomHasMaskCell(gen.world, dryReachable, room));
  const dryMicroRooms = microRooms.filter(room => roomHasMaskCell(gen.world, dryReachable, room));
  const myceliumRooms = gen.world.rooms.filter(room => room.name.startsWith('Грибничный карман'));
  const reachableMyceliumRooms = myceliumRooms.filter(room => roomHasReachableCell(gen.world, audit, room));
  const repairRooms = gen.world.rooms.filter(room => room.name.startsWith('Ремонтный пролет эстакады'));
  const stashRooms = gen.world.rooms.filter(room => room.name.startsWith('Сухой остров черной воды'));
  const smallRooms = gen.world.rooms.filter(room => room.w * room.h <= 72);
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const territoryCounts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (territoryCounts.get(owner) ?? 0) / (W * W);
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });
  let waterCells = 0;
  for (const cell of gen.world.cells) if (cell === Cell.WATER) waterCells++;

  assert.equal(gen.world.rooms.length >= 430, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 540, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 160_000, true, `reachable ${reachable}`);
  assert.equal(reachableBucketCount(gen.world, audit.reachable, 128), 64);
  assert.equal(waterCells >= 70_000, true, `water cells ${waterCells}`);
  assert.equal(smallRooms.length >= 260, true, `small rooms ${smallRooms.length}`);
  assert.equal(stations.length >= 60, true, `sump stations ${stations.length}`);
  assert.equal(microRooms.length >= 240, true, `sump micro rooms ${microRooms.length}`);
  assert.equal(dryStations.length >= 30, true, `dry stations ${dryStations.length}`);
  assert.equal(dryMicroRooms.length >= 140, true, `dry micro rooms ${dryMicroRooms.length}`);
  assert.equal(myceliumRooms.length >= 16, true, `mycelium rooms ${myceliumRooms.length}`);
  assert.equal(reachableMyceliumRooms.length >= 16, true, `reachable mycelium rooms ${reachableMyceliumRooms.length}`);
  assert.equal(repairRooms.length >= 2, true, `repair rooms ${repairRooms.length}`);
  assert.equal(stashRooms.length >= 2, true, `stash rooms ${stashRooms.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(hasDryReachableLift(gen, dryReachable, LiftDirection.UP), true);
  assert.equal(hasDryReachableLift(gen, dryReachable, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((territoryCounts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = hqAnchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => gen.world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(supportRooms.length >= 15, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(Math.abs(share(ZoneFaction.CITIZEN) - 0.56) <= 0.02, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(Math.abs(share(ZoneFaction.LIQUIDATOR) - 0.17) <= 0.02, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(Math.abs(share(ZoneFaction.CULTIST) - 0.07) <= 0.02, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.SCIENTIST) - 0.08) <= 0.02, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.WILD) - 0.12) <= 0.02, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.75, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testBadAppleExperiment('genfix 096 procedural sump bad apple wild floor fills blank spans from HQ territory', () => {
  const base = makeProceduralFloorSpec(61_061, -45);
  const spec = {
    ...base,
    anomalyId: 'bad_apple_world' as const,
    danger: 5 as const,
    title: `bad apple!: ${base.title}`,
  };
  assert.equal(spec.geometryId, 'sump_causeways');
  assert.equal(spec.majorityId, 'wild');
  assert.equal(spec.anomalyId, 'bad_apple_world');
  assert.equal(spec.danger, 5);

  const gen = timedProceduralSpec(spec, 'genfix_096 sump bad apple wild seed=61061 z-45');
  const audit = reachabilityAudit(gen);
  const dryReachable = dryReachableFromSpawn(gen);
  const reachable = countReachableCells(audit.reachable);
  const stations = gen.world.rooms.filter(room => room.name.startsWith('Сухая станция эстакады'));
  const microRooms = gen.world.rooms.filter(room => room.name.startsWith('Боковая будка эстакады'));
  const dryStations = stations.filter(room => roomHasMaskCell(gen.world, dryReachable, room));
  const dryMicroRooms = microRooms.filter(room => roomHasMaskCell(gen.world, dryReachable, room));
  const smallRooms = gen.world.rooms.filter(room => room.w * room.h <= 72);
  const badAppleRooms = gen.world.rooms.filter(room => room.name.startsWith('Bad Apple!'));
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const hqRooms = hqAnchors.map(anchor => gen.world.rooms[anchor.roomId]).filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const territoryCounts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (territoryCounts.get(owner) ?? 0) / (W * W);
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });
  let waterCells = 0;
  for (const cell of gen.world.cells) if (cell === Cell.WATER) waterCells++;

  assert.equal(gen.world.rooms.length >= 540, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 620, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 175_000, true, `reachable ${reachable}`);
  assert.equal(reachableBucketCount(gen.world, audit.reachable, 128), 64);
  assert.equal(waterCells >= 75_000, true, `water cells ${waterCells}`);
  assert.equal(stations.length >= 90, true, `sump stations ${stations.length}`);
  assert.equal(microRooms.length >= 330, true, `sump micro rooms ${microRooms.length}`);
  assert.equal(dryStations.length >= 55, true, `dry stations ${dryStations.length}`);
  assert.equal(dryMicroRooms.length >= 160, true, `dry micro rooms ${dryMicroRooms.length}`);
  assert.equal(smallRooms.length >= 340, true, `small rooms ${smallRooms.length}`);
  assert.equal(badAppleRooms.length >= 1, true, 'bad apple room');
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(hasDryReachableLift(gen, dryReachable, LiftDirection.UP), true);
  assert.equal(hasDryReachableLift(gen, dryReachable, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((territoryCounts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = hqAnchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => gen.world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 15, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(Math.abs(share(ZoneFaction.CITIZEN) - 0.17) <= 0.02, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(Math.abs(share(ZoneFaction.LIQUIDATOR) - 0.13) <= 0.02, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(Math.abs(share(ZoneFaction.CULTIST) - 0.12) <= 0.02, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.SCIENTIST) - 0.08) <= 0.02, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.WILD) - 0.50) <= 0.02, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.8, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('genfix 086 sump fractal citizens floor has filled causeways and target territory', () => {
  const spec = makeProceduralFloorSpec(61_061, -35);
  assert.equal(spec.geometryId, 'sump_causeways');
  assert.equal(spec.majorityId, 'citizens');
  assert.equal(spec.anomalyId, 'fractal_floor');
  assert.equal(spec.danger, 5);

  const gen = timedProceduralSpec(spec, 'genfix_086 sump fractal citizens seed=61061 z-35');
  const audit = reachabilityAudit(gen);
  const dryReachable = dryReachableFromSpawn(gen);
  const reachable = countReachableCells(audit.reachable);
  const stations = gen.world.rooms.filter(room => room.name.startsWith('Сухая станция эстакады'));
  const microRooms = gen.world.rooms.filter(room => room.name.startsWith('Боковая будка эстакады'));
  const dryStations = stations.filter(room => roomHasMaskCell(gen.world, dryReachable, room));
  const dryMicroRooms = microRooms.filter(room => roomHasMaskCell(gen.world, dryReachable, room));
  const smallRooms = gen.world.rooms.filter(room => room.w * room.h <= 72);
  const fractalRooms = gen.world.rooms.filter(room => room.name.startsWith('Фрактал'));
  const hqAnchors = territoryHqAnchors(gen.world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const hqRooms = hqAnchors.map(anchor => gen.world.rooms[anchor.roomId]).filter(room => room?.type === RoomType.HQ);
  const supportRooms = gen.world.rooms.filter(room => room.name.includes('штаба') && room.type !== RoomType.HQ);
  const territoryCounts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (territoryCounts.get(owner) ?? 0) / (W * W);
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const ownTerritoryNpcs = npcs.filter(entity => {
    const ci = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, ci)) === entity.faction;
  });
  let waterCells = 0;
  for (const cell of gen.world.cells) if (cell === Cell.WATER) waterCells++;

  assert.equal(gen.world.rooms.length >= 400, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 500, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachable >= 150_000, true, `reachable ${reachable}`);
  assert.equal(reachableBucketCount(gen.world, audit.reachable, 128), 64);
  assert.equal(waterCells >= 60_000, true, `water cells ${waterCells}`);
  assert.equal(smallRooms.length >= 230, true, `small rooms ${smallRooms.length}`);
  assert.equal(stations.length >= 55, true, `sump stations ${stations.length}`);
  assert.equal(microRooms.length >= 220, true, `sump micro rooms ${microRooms.length}`);
  assert.equal(dryStations.length >= 40, true, `dry stations ${dryStations.length}`);
  assert.equal(dryMicroRooms.length >= 130, true, `dry micro rooms ${dryMicroRooms.length}`);
  assert.equal(fractalRooms.length >= 4, true, `fractal rooms ${fractalRooms.length}`);
  assert.equal(gen.world.anomalyTeleports.size >= 1, true, `fractal teleports ${gen.world.anomalyTeleports.size}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(hasDryReachableLift(gen, dryReachable, LiftDirection.UP), true);
  assert.equal(hasDryReachableLift(gen, dryReachable, LiftDirection.DOWN), true);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(hqOwners.has(owner), true, `missing HQ owner ${ZoneFaction[owner]}`);
    assert.equal((territoryCounts.get(owner) ?? 0) > 0, true, `empty territory ${ZoneFaction[owner]}`);
    const anchor = hqAnchors.find(item => item.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.equal(room?.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room?.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
    assert.equal(room?.doors.some(doorIdx => gen.world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN), true, `HQ hermetic door ${ZoneFaction[owner]}`);
  }
  assert.equal(hqRooms.length >= HUMAN_TERRITORY_OWNERS.length, true, `HQ rooms ${hqRooms.length}`);
  assert.equal(supportRooms.length >= 15, true, `HQ support rooms ${supportRooms.length}`);
  assert.equal(Math.abs(share(ZoneFaction.CITIZEN) - 0.56) <= 0.02, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(Math.abs(share(ZoneFaction.LIQUIDATOR) - 0.17) <= 0.02, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(Math.abs(share(ZoneFaction.CULTIST) - 0.07) <= 0.02, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.SCIENTIST) - 0.08) <= 0.02, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(Math.abs(share(ZoneFaction.WILD) - 0.12) <= 0.02, true, `wild share ${share(ZoneFaction.WILD)}`);
  assert.equal(npcs.length === 0 || ownTerritoryNpcs.length / npcs.length >= 0.8, true, `own territory NPC share ${npcs.length ? ownTerritoryNpcs.length / npcs.length : 1}`);
});

testGenerationMatrix('procedural monster pressure stays capped and registers a route cue', () => {
  const base = makeProceduralFloorSpec(2468, -38);
  const gen = timedProceduralSpec({
    ...base,
    danger: 5,
    anomalyId: 'samosbor_seed',
    title: `поражение самосбором: ${base.title}`,
    monsterBiasKinds: [MonsterKind.HERALD, MonsterKind.MANCOBUS, MonsterKind.KOSTOREZ, MonsterKind.NIGHTMARE],
  }, 'forced monster pressure seed=2468');
  const monsters = gen.entities.filter(e => e.type === EntityType.MONSTER);
  const rareKinds = new Set([MonsterKind.HERALD, MonsterKind.MANCOBUS, MonsterKind.KOSTOREZ, MonsterKind.NIGHTMARE]);

  assert.equal(monsters.length <= PROCEDURAL_POPULATION_PROFILES.normal.monsters.cap, true);
  assert.equal(monsters.length >= 1000, true);
  assert.equal(monsters.every(e => e.ai), true);
  assert.equal(monsters.filter(e => e.monsterKind !== undefined && rareKinds.has(e.monsterKind)).length <= 2, true);
  const cues = getRouteCueMarkers(gen.world);
  const retreatCue = cues.find(cue => cue.tags.includes('samosbor_seed') && cue.tags.includes('shelter'));
  assert.equal(cues.some(cue => cue.tags.includes('monster_pressure') || cue.tags.includes('samosbor_seed')), true);
  assert.equal(retreatCue !== undefined, true);
  assert.equal(routeCueCount(gen.world) >= 1, true);

  let infectedFloorCells = 0;
  let heavyFogCells = 0;
  for (let i = 0; i < gen.world.cells.length; i++) {
    if (gen.world.floorTex[i] === Tex.F_MEAT || gen.world.floorTex[i] === Tex.F_GUT) infectedFloorCells++;
    if (gen.world.fog[i] >= 80) heavyFogCells++;
  }
  assert.equal(infectedFloorCells >= 1200, true);
  assert.equal(heavyFogCells >= 80, true);

  const breachRoom = gen.world.rooms.find(room => room.name.startsWith('Семя самосбора'));
  assert.equal(breachRoom !== undefined, true);
  assert.equal(breachRoom?.id, retreatCue?.roomId);
  const shelterRoom = retreatCue?.targetRoomId !== undefined ? gen.world.rooms[retreatCue.targetRoomId] : undefined;
  assert.equal(shelterRoom !== undefined, true);
  let cleanShelterCells = 0;
  if (shelterRoom) {
    for (let y = shelterRoom.y; y < shelterRoom.y + shelterRoom.h; y++) {
      for (let x = shelterRoom.x; x < shelterRoom.x + shelterRoom.w; x++) {
        const ci = gen.world.idx(x, y);
        if (gen.world.roomMap[ci] === shelterRoom.id && (gen.world.floorTex[ci] === Tex.F_CONCRETE || gen.world.floorTex[ci] === Tex.F_TILE) && gen.world.fog[ci] <= 18) {
          cleanShelterCells++;
        }
      }
    }
  }
  assert.equal(cleanShelterCells >= 12, true);
});

test('zombie apocalypse procedural specs bias monster pressure to мертвяки', () => {
  const spec = makeProceduralFloorSpec(48, -35);
  assert.equal(spec.anomalyId, 'zombie_apocalypse');
  assert.deepEqual(spec.monsterBiasKinds, [MonsterKind.ZOMBIE]);
});

testGenerationMatrix('deep procedural route floors blend route identity with design monster bias', () => {
  const base = makeProceduralFloorSpec(1357, -35);
  const gen = timedProceduralSpec({
    ...base,
    danger: 4,
    anomalyId: 'none',
    title: base.title,
    monsterBiasKinds: [MonsterKind.PECHATEED, MonsterKind.PARAGRAPH, MonsterKind.SHOVNIK],
  }, 'forced deep monster mix seed=1357');
  const monsters = gen.entities.filter(e => e.type === EntityType.MONSTER);
  const bureaucratic = new Set([MonsterKind.PECHATEED, MonsterKind.PARAGRAPH, MonsterKind.SHOVNIK]);
  const deep = new Set([MonsterKind.TVAR, MonsterKind.POLZUN, MonsterKind.SHADOW, MonsterKind.EYE, MonsterKind.TUBE_EEL, MonsterKind.KOSTOREZ]);

  assert.equal(monsters.length > 0, true);
  assert.equal(monsters.some(e => e.monsterKind !== undefined && bureaucratic.has(e.monsterKind)), true);
  assert.equal(monsters.some(e => e.monsterKind !== undefined && deep.has(e.monsterKind)), true);
  assert.equal(monsters.some(e => e.monsterKind === MonsterKind.CREATOR), false);
});

testGenerationMatrix('void and lower route floors do not generate NPCs', () => {
  const voidGen = timeFloorGeneration('story VOID', () => generateFloor(FloorLevel.VOID));
  assert.equal(voidGen.entities.some(e => e.type === EntityType.NPC), false);
  assert.equal(voidGen.entities.some(e => e.type === EntityType.MONSTER), true);
  assertFullFootprint(voidGen.world, 'VOID story floor');
  const voidAudit = auditReachability(voidGen.world, voidGen.world.idx(Math.floor(voidGen.spawnX), Math.floor(voidGen.spawnY)));
  assert.equal(reachableBucketCount(voidGen.world, voidAudit.reachable, 128) >= 16, true, 'VOID should spread reachable chaos across many coarse buckets');
  let voidSignals = 0;
  let voidInteriorWallEdges = 0;
  for (let i = 0; i < voidGen.world.cells.length; i++) {
    const feature = voidGen.world.features[i];
    if (feature === Feature.SCREEN || feature === Feature.APPARATUS || feature === Feature.CANDLE) voidSignals++;
    if (voidGen.world.cells[i] !== Cell.WALL || voidGen.world.wallTex[i] !== Tex.VOID_WALL) continue;
    const x = i % W;
    const y = (i / W) | 0;
    if (
      voidAudit.reachable[voidGen.world.idx(x + 1, y)] ||
      voidAudit.reachable[voidGen.world.idx(x - 1, y)] ||
      voidAudit.reachable[voidGen.world.idx(x, y + 1)] ||
      voidAudit.reachable[voidGen.world.idx(x, y - 1)]
    ) {
      voidInteriorWallEdges++;
    }
  }
  assert.equal(voidSignals >= 24, true, `VOID signals ${voidSignals}`);
  assert.equal(voidInteriorWallEdges >= 240, true, `VOID interior wall edges ${voidInteriorWallEdges}`);

  const base = makeProceduralFloorSpec(321, FLOOR_RUN_VOID_Z + 1);
  const procGen = timedProceduralSpec({
    ...base,
    anomalyId: 'smog',
    title: `говнячный смог: ${base.title}`,
  }, 'void lower procedural seed=321');
  assert.equal(procGen.entities.some(e => e.type === EntityType.NPC), false);
  assert.equal(procGen.entities.some(e => e.type === EntityType.MONSTER), true);

  const darknessGen = timedDesignFloor('darkness', 'design darkness');
  const darknessMonsters = darknessGen.entities.filter(e => e.type === EntityType.MONSTER);
  const darknessMonsterKinds = new Set(darknessMonsters.map(e => e.monsterKind));
  assert.equal(darknessGen.entities.some(e => e.type === EntityType.NPC), false);
  assert.equal(darknessMonsters.length >= 500 && darknessMonsters.length <= 15000, true);
  assert.equal(darknessMonsterKinds.has(MonsterKind.LISHENNYY), true);
  assert.equal(darknessMonsterKinds.has(MonsterKind.SLEPOGLAZ), true);
  assert.equal(darknessMonsterKinds.has(MonsterKind.PROTOKOLNIK), true);
  assert.equal(darknessMonsters.filter(e => e.monsterKind === MonsterKind.SBORKA).length < darknessMonsters.length / 3, true);
  assert.equal(darknessMonsters.filter(e => darknessGen.world.dist2(e.x, e.y, darknessGen.spawnX, darknessGen.spawnY) <= 32 * 32).length <= Math.max(64, Math.floor(darknessMonsters.length * 0.02)), true);
  assert.equal(darknessGen.world.features.some(feature => feature === Feature.LAMP || feature === Feature.CANDLE), false);
  assert.equal(darknessGen.world.light.some(value => value > 0), false);
  assert.equal(routeCueCount(darknessGen.world) >= 3, true);
  assertFullFootprint(darknessGen.world, 'darkness design floor');

  const rawDarknessGen = timeFloorGeneration('raw design darkness', () => generateDarknessDesignFloor());
  assert.equal(rawDarknessGen.entities.some(e => e.type === EntityType.NPC), false);
  assert.equal(rawDarknessGen.entities.some(e => e.type === EntityType.MONSTER), true);
});

testGenerationMatrix('smog anomaly generates bounded curl plumes and reachable filter pockets', () => {
  const base = makeProceduralFloorSpec(611, -35);
  const spec = {
    ...base,
    anomalyId: 'smog' as const,
    danger: 4 as const,
    title: `говнячный смог: ${base.title}`,
  };
  const gen = timedProceduralSpec(spec, 'forced smog curl plume seed=611');
  const world = gen.world;
  const audit = reachabilityAudit(gen);
  const source = world.anomalySmogSource;
  assert.notEqual(source, -1);
  assert.equal(world.fogVersion > 0, true);
  assert.equal(world.anomalySmogCells.length >= 500, true);
  assert.equal(world.anomalySmogCells.length <= 13_750, true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  const sourceX = source % W;
  const sourceY = (source / W) | 0;
  const fogProxyCells = new Set<string>();
  let farFog = false;
  for (const ci of world.anomalySmogCells) {
    if (world.fog[ci] < 64) continue;
    const x = ci % W;
    const y = (ci / W) | 0;
    fogProxyCells.add(`${Math.floor(x / 16)}:${Math.floor(y / 16)}`);
    if (world.dist2(sourceX + 0.5, sourceY + 0.5, x + 0.5, y + 0.5) > 42 * 42) farFog = true;
  }
  assert.equal(fogProxyCells.size >= 5, true);
  assert.equal(farFog, true);

  const counterplay = new Set(['wet_rag_bundle', 'cloth_roll', 'gasmask_filter', 'filter_canister', 'valve_tag']);
  const reachablePocketDrop = gen.entities.some(entity => {
    if (entity.type !== EntityType.ITEM_DROP) return false;
    if (!entity.inventory?.some(item => counterplay.has(item.defId))) return false;
    const idx = world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return !!audit.reachable[idx] && world.fog[idx] < 64;
  }) || world.containers.some(container => {
    if (!container.inventory.some(item => counterplay.has(item.defId))) return false;
    const idx = world.idx(container.x, container.y);
    return !!audit.reachable[idx] && world.fog[idx] < 64;
  });
  assert.equal(reachablePocketDrop, true);
});

testGenerationMatrix('wall snake anomaly places a visible nearby map cue and loot loop', () => {
  const def = FLOOR_GEOMETRIES.find(item => item.id === 'workshops');
  assert.ok(def);
  const base = makeProceduralFloorSpec(61_061, proceduralZForGeometry(def));
  const gen = timedProceduralSpec({
    ...base,
    geometryId: 'workshops',
    baseFloor: FloorLevel.MAINTENANCE,
    majorityId: 'liquidators',
    anomalyId: 'wall_snake',
    danger: 4,
    title: `змейка: ${base.title}`,
  }, 'forced wall_snake visibility seed=61061');
  const audit = reachabilityAudit(gen);
  const snakeRooms = gen.world.rooms.filter(room => room.name.includes('[wall_snake:'));
  const cues = getRouteCueMarkers(gen.world).filter(marker => marker.tags.includes('wall_snake') && marker.tags.includes('visible_anomaly'));

  assert.equal(snakeRooms.length >= 1, true);
  assert.equal(cues.length >= 1, true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  const nearestCueD2 = Math.min(...cues.map(cue => gen.world.dist2(gen.spawnX, gen.spawnY, cue.x, cue.y)));
  assert.equal(nearestCueD2 <= 120 * 120, true, `nearest wall snake cue d2=${nearestCueD2}`);
  const reachableGearBait = gen.entities.some(entity => {
    if (entity.type !== EntityType.ITEM_DROP || !entity.inventory?.some(item => item.defId === 'gear')) return false;
    return !!audit.reachable[gen.world.idx(Math.floor(entity.x), Math.floor(entity.y))];
  }) || gen.world.containers.some(container => {
    if (!container.inventory.some(item => item.defId === 'gear')) return false;
    return !!audit.reachable[gen.world.idx(container.x, container.y)];
  });
  assert.equal(reachableGearBait, true);

  const fieldCues = cues.filter(marker => marker.tags.includes('macro_geometry'));
  const hermoIslands = gen.world.rooms.filter(room =>
    room.sealed && room.doors.some(doorIdx => gen.world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN)
  );
  let meatBlocks = 0;
  let gutCaverns = 0;
  let larvaTrackCells = 0;
  let sphincterLamps = 0;
  const macroSide = 32;
  const macroCols = W / macroSide;
  const macroFloor = new Int32Array(macroCols * macroCols);
  const macroWall = new Int32Array(macroCols * macroCols);
  for (let ci = 0; ci < gen.world.cells.length; ci++) {
    if (gen.world.cells[ci] === Cell.WALL && (gen.world.wallTex[ci] === Tex.MEAT || gen.world.wallTex[ci] === Tex.GUT)) meatBlocks++;
    if (gen.world.cells[ci] === Cell.FLOOR && (gen.world.floorTex[ci] === Tex.F_GUT || gen.world.floorTex[ci] === Tex.F_MEAT)) gutCaverns++;
    if (gen.world.fog[ci] >= 28 && (gen.world.wallTex[ci] === Tex.MEAT || gen.world.wallTex[ci] === Tex.GUT)) larvaTrackCells++;
    if (gen.world.features[ci] === Feature.LAMP && (gen.world.floorTex[ci] === Tex.F_GUT || gen.world.floorTex[ci] === Tex.F_MEAT)) sphincterLamps++;
    const x = ci % W;
    const y = (ci / W) | 0;
    const macro = Math.floor(y / macroSide) * macroCols + Math.floor(x / macroSide);
    if (gen.world.cells[ci] === Cell.FLOOR && (gen.world.floorTex[ci] === Tex.F_GUT || gen.world.floorTex[ci] === Tex.F_MEAT)) macroFloor[macro]++;
    if (gen.world.cells[ci] === Cell.WALL && (gen.world.wallTex[ci] === Tex.MEAT || gen.world.wallTex[ci] === Tex.GUT)) macroWall[macro]++;
  }
  const macroArea = macroSide * macroSide;
  const largeLacunae = Array.from(macroFloor).filter(count => count >= macroArea * 0.82).length;
  const largeFleshMasses = Array.from(macroWall).filter(count => count >= macroArea * 0.34).length;
  assert.equal(fieldCues.length >= 6, true, `wall snake macro cues ${fieldCues.length}`);
  assert.equal(hermoIslands.length >= 12, true, `wall snake hermo islands ${hermoIslands.length}`);
  assert.equal(meatBlocks >= 250_000, true, `wall snake meat blocks ${meatBlocks}`);
  assert.equal(gutCaverns >= 100_000, true, `wall snake gut caverns ${gutCaverns}`);
  assert.equal(larvaTrackCells >= 2000, true, `wall snake larva track cells ${larvaTrackCells}`);
  assert.equal(sphincterLamps >= 48, true, `wall snake sphincter lamps ${sphincterLamps}`);
  assert.equal(largeLacunae >= 40, true, `wall snake large lacunae ${largeLacunae}`);
  assert.equal(largeFleshMasses >= 40, true, `wall snake large flesh masses ${largeFleshMasses}`);
});

testGenerationMatrix('conway life anomaly seeds multiple visible nearby arenas', () => {
  const def = FLOOR_GEOMETRIES.find(item => item.id === 'communal_knots');
  assert.ok(def);
  const base = makeProceduralFloorSpec(67_067, proceduralZForGeometry(def));
  const gen = timedProceduralSpec({
    ...base,
    geometryId: 'communal_knots',
    baseFloor: FloorLevel.KVARTIRY,
    majorityId: 'citizens',
    anomalyId: 'conway_life',
    danger: 5,
    title: `игра жизнь: ${base.title}`,
  }, 'forced conway_life visibility seed=67067');
  const audit = reachabilityAudit(gen);
  const arenas = gen.world.rooms.filter(room => room.name.startsWith('Игра жизнь:'));
  const cues = getRouteCueMarkers(gen.world).filter(marker => marker.tags.includes('conway_life') && marker.tags.includes('visible_anomaly'));
  const macroCues = cues.filter(marker => marker.tags.includes('macro_geometry'));

  assert.equal(arenas.length >= 2, true, `conway arenas ${arenas.length}`);
  assert.equal(cues.length >= 2, true, `conway cues ${cues.length}`);
  assert.equal(macroCues.length >= 1, true, `conway macro cues ${macroCues.length}`);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  const nearestCueD2 = Math.min(...cues.map(cue => gen.world.dist2(gen.spawnX, gen.spawnY, cue.x, cue.y)));
  assert.equal(nearestCueD2 <= 150 * 150, true, `nearest conway cue d2=${nearestCueD2}`);
  let apparatus = 0;
  let cellularWalls = 0;
  for (const room of arenas) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        const ci = gen.world.idx(x, y);
        if (gen.world.features[ci] === Feature.APPARATUS) apparatus++;
        if (gen.world.cells[ci] === Cell.WALL && gen.world.wallTex[ci] === Tex.DARK) cellularWalls++;
      }
    }
  }
  assert.equal(apparatus >= arenas.length, true, `conway apparatus ${apparatus}`);
  assert.equal(cellularWalls >= 40, true, `conway walls ${cellularWalls}`);
  let macroLifeWalls = 0;
  for (let ci = 0; ci < gen.world.cells.length; ci++) {
    if (gen.world.cells[ci] === Cell.WALL && gen.world.wallTex[ci] === Tex.DARK) macroLifeWalls++;
  }
  assert.equal(macroLifeWalls >= 20_000, true, `macro life walls ${macroLifeWalls}`);
});

testGenerationMatrix('podad ships as a denser-than-Hell monster floor with gated lower lifts', () => {
  const route = DESIGN_FLOOR_ROUTES.find(def => def.id === 'podad');
  assert.ok(route);
  const profile = designFloorPopulationProfile(route);
  const gen = timedDesignFloor('podad', 'design podad population');
  const npcs = gen.entities.filter(e => e.type === EntityType.NPC);
  const ambientNpcs = npcs.filter(e => !e.plotNpcId && !e.persistentNpcId && e.alifeId === undefined);
  const monsters = gen.entities.filter(e => e.type === EntityType.MONSTER);
  const heralds = monsters.filter(e => e.monsterKind === MonsterKind.HERALD);
  const nonHeraldRareMonsters = monsters.filter(e => e.monsterKind !== MonsterKind.HERALD && getMonsterEcology(e.monsterKind)?.rare);
  const hasDownLift = gen.world.cells.some((cell, idx) => cell === Cell.LIFT && gen.world.liftDir[idx] === LiftDirection.DOWN);
  const cues = getRouteCueMarkers(gen.world).filter(marker => marker.tags.includes('podad'));
  const descriptor = extractPodadTopologyDescriptor(gen.world);

  assert.equal(ambientNpcs.length, 0);
  assert.equal(npcs.length <= 60, true);
  assert.equal(monsters.length <= profile.monsterTarget, true);
  assert.equal(monsters.length >= profile.monsterTarget - 16, true);
  assert.equal(monsters.length <= ACTIVE_ACTOR_SOFT_LIMIT, true);
  assert.equal(monsters.length >= ACTIVE_ACTOR_SOFT_LIMIT - 16, true);
  assert.equal(monsters.length <= ENTITY_SOFT_LIMITS[EntityType.MONSTER], true);
  assert.equal(heralds.length, 3);
  assert.equal(nonHeraldRareMonsters.length, 0);
  assert.equal(hasDownLift, false);
  assert.equal(cues.length >= 4, true);
  assert.equal(cues.some(marker => marker.tags.includes('living_tunnels')), true);
  assert.equal(cues.some(marker => marker.tags.includes('wall_snake')), true);
  assert.equal(cues.some(marker => marker.tags.includes('section_shift')), true);
  assert.equal(descriptor.capillaryCells >= 200, true);
  assert.equal(descriptor.nodes.length >= 7, true);
  assert.equal(descriptor.edges.length >= 5, true);
  assert.equal(descriptor.movingWallChokepointScore > 4, true);
  assert.equal(descriptor.sectionShiftChokepointScore > 4, true);
});

test('design floor population profiles follow route density curve and caps', () => {
  const profiles = Object.fromEntries(DESIGN_FLOOR_ROUTES.map(route => [route.id, designFloorPopulationProfile(route)]));

  assert.equal(profiles.roof.npcTarget, 0);
  assert.equal(profiles.chthonic_attic.npcTarget, 0);
  assert.equal(profiles.chthonic_attic.monsterTarget, ACTIVE_ACTOR_SOFT_LIMIT);
  assert.equal(profiles.chthonic_attic.monsterTags.includes('fog'), true);
  assert.equal((profiles.chthonic_attic.monsterPlacement.maxPerBucket ?? 0) <= 8, true);
  assert.equal(profiles.roof.monsterTarget > profiles.bank_floor.monsterTarget, true);
  assert.equal(profiles.communal_ring.npcTarget > profiles.upper_bureau.npcTarget, true);
  assert.equal(profiles.manhattan_crossroads.npcTarget > profiles.raionsovet_archive.npcTarget, true);
  assert.equal((profiles.manhattan_crossroads.npcPlacement.anchors?.length ?? 0) >= 6, true);
  assert.equal((profiles.manhattan_crossroads.monsterPlacement.anchors?.length ?? 0) >= 5, true);
  assert.equal((profiles.manhattan_crossroads.monsterPlacement.roomWeights?.[RoomType.STORAGE] ?? 0) > 1.5, true);
  assert.equal(profiles.pioneer_camp.npcTarget > profiles.antenna_court.npcTarget, true);
  assert.equal(profiles.floor_69.npcTarget, 2200);
  assert.equal(profiles.floor_69.monsterTarget, 380);
  assert.equal(profiles.floor_69.npcNoun, 'посетитель');
  assert.equal(profiles.floor_69.npcOccupations.some(item => item.value === Occupation.CHILD), false);
  assert.equal((profiles.floor_69.npcPlacement.roomWeights?.[RoomType.MEDICAL] ?? 0) > 1, true);
  assert.equal((profiles.floor_69.npcPlacement.roomWeights?.[RoomType.OFFICE] ?? 0) > 1, true);
  assert.equal((profiles.floor_69.npcPlacement.roomWeights?.[RoomType.HQ] ?? 0) > 1, true);
  assert.equal((profiles.floor_69.npcPlacement.anchors?.length ?? 0) >= 4, true);
  assert.equal(profiles.antenna_court.npcTarget >= 20 && profiles.antenna_court.npcTarget <= 80, true);
  assert.equal(profiles.antenna_court.monsterTarget >= 2200 && profiles.antenna_court.monsterTarget <= ACTIVE_ACTOR_SOFT_LIMIT, true);
  assert.equal(profiles.antenna_court.npcFactions.some(entry => entry.value === Faction.CITIZEN), false);
  assert.equal(profiles.antenna_court.monsterBiasKinds.includes(MonsterKind.LAMPOVY), true);
  assert.equal(profiles.antenna_court.monsterTags.includes('signal'), true);
  assert.equal(profiles.silicon_net_well.npcTarget >= 350 && profiles.silicon_net_well.npcTarget <= 900, true);
  assert.equal(profiles.silicon_net_well.monsterTarget >= 1200 && profiles.silicon_net_well.monsterTarget <= 2600, true);
  assert.equal(profiles.silicon_net_well.npcNoun, 'специалист');
  assert.equal(profiles.silicon_net_well.monsterBiasKinds.includes(MonsterKind.CHERNOSLIZ), true);
  assert.equal(profiles.silicon_net_well.monsterTags.includes('silicon'), true);
  assert.equal(profiles.slime_nii.npcTarget, 1300);
  assert.equal(profiles.slime_nii.monsterTarget, 1700);
  assert.equal(profiles.slime_nii.npcNoun, 'сотрудник НИИ');
  assert.equal(profiles.slime_nii.monsterBiasKinds.includes(MonsterKind.CHERNOSLIZ), true);
  assert.equal(profiles.slime_nii.monsterTags.includes('quarantine'), true);
  assert.equal((profiles.slime_nii.npcPlacement.roomWeights?.[RoomType.MEDICAL] ?? 0) > 1.5, true);
  assert.equal((profiles.slime_nii.monsterPlacement.anchors?.length ?? 0) >= 4, true);
  assert.equal(profiles.dark_metro.npcTarget >= 80 && profiles.dark_metro.npcTarget <= 300, true);
  assert.equal(profiles.dark_metro.monsterTarget >= 2500 && profiles.dark_metro.monsterTarget <= ACTIVE_ACTOR_SOFT_LIMIT, true);
  assert.equal(profiles.dark_metro.npcNoun, 'ветеран');
  assert.equal(profiles.dark_metro.npcFactions.some(entry => entry.value === Faction.CITIZEN), false);
  assert.equal(profiles.dark_metro.monsterTags.includes('rail'), true);
  assert.equal((profiles.dark_metro.npcPlacement.anchors?.length ?? 0) >= 12, true);
  assert.equal((profiles.dark_metro.npcPlacement.roomWeights?.[RoomType.HQ] ?? 0) > 4, true);
  assert.equal(profiles.podad.npcTarget, 0);
  assert.equal(profiles.darkness.npcTarget, 0);
  assert.equal(profiles.darkness.monsterTarget >= 3000 && profiles.darkness.monsterTarget <= ACTIVE_ACTOR_SOFT_LIMIT, true);
  assert.equal((profiles.darkness.monsterPlacement.anchors?.length ?? 0) >= 4, true);
  assert.equal(profiles.darkness.monsterTags.includes('sound'), true);
  assert.equal(profiles.underhell.npcTarget >= 0 && profiles.underhell.npcTarget <= 120, true);
  assert.equal(profiles.underhell.monsterTarget >= 3900 && profiles.underhell.monsterTarget <= ACTIVE_ACTOR_SOFT_LIMIT, true);
  assert.equal(profiles.underhell.npcNoun, 'ветеран');
  assert.deepEqual(profiles.underhell.npcFactions.map(item => item.value), [Faction.LIQUIDATOR, Faction.CULTIST]);
  assert.equal(profiles.podad.monsterTarget, ACTIVE_ACTOR_SOFT_LIMIT);
  assert.equal((profiles.podad.monsterPlacement.anchors?.length ?? 0) >= 5, true);
  assert.equal(profiles.podad.monsterTags.includes('living_tunnels'), true);
  assert.equal(profiles.podad.monsterTags.includes('section_shift'), true);

  for (const route of DESIGN_FLOOR_ROUTES) {
    const profile = profiles[route.id];
    assert.equal(profile.npcTarget <= (ENTITY_SOFT_LIMITS[EntityType.NPC] ?? 0), true, `${route.id} npc cap`);
    assert.equal(profile.monsterTarget <= (ENTITY_SOFT_LIMITS[EntityType.MONSTER] ?? 0), true, `${route.id} monster cap`);
    assert.equal(profile.npcTarget + profile.monsterTarget <= ACTIVE_ACTOR_SOFT_LIMIT, true, `${route.id} actor cap`);
    if (!floorRunZAllowsNpcs(route.z)) assert.equal(profile.npcTarget, 0, `${route.id} npc-free route`);
  }
});

testGenerationMatrix('slime NII route ships containment cameras, samples, and slime pressure', () => {
  const route = DESIGN_FLOOR_ROUTES.find(def => def.id === 'slime_nii');
  assert.ok(route);
  assert.equal(route.z, 12);
  assert.equal(route.baseFloor, FloorLevel.KVARTIRY);

  const gen = timedDesignFloor('slime_nii', 'design slime_nii containment');
  const cameraRooms = gen.world.rooms.filter(room => room.name.startsWith('Гермокамера НИИ слизи'));
  const hermeticDoors = [...gen.world.doors.values()].filter(door =>
    door.state === DoorState.HERMETIC_CLOSED || door.state === DoorState.HERMETIC_OPEN);
  const monsters = gen.entities.filter(e => e.type === EntityType.MONSTER);
  const slimeKinds = new Set([MonsterKind.SLIMEVIK, MonsterKind.SLIME_WOMAN, MonsterKind.CHERNOSLIZ, MonsterKind.HEAD_SLUG, MonsterKind.BEZEKHIY]);
  const panelDefs = new Set(getEmergencyPanels(gen.world).map(panel => panel.defId));
  let wetCells = 0;
  for (const cell of gen.world.cells) if (cell === Cell.WATER) wetCells++;

  assert.equal(cameraRooms.length >= 14, true);
  assert.equal(hermeticDoors.length >= 4, true);
  assert.equal(wetCells >= 250, true);
  assert.equal(panelDefs.has('panel_doors'), true);
  assert.equal(panelDefs.has('panel_water'), true);
  assert.equal(panelDefs.has('panel_vent'), true);
  assert.equal(gen.world.containers.some(c => c.tags.includes('slime_nii') && c.inventory.some(i => i.defId === 'slime_sample_green')), true);
  assert.equal(gen.world.containers.some(c => c.tags.includes('inoculation') && c.inventory.some(i => i.defId === 'anti_spore_inhaler')), true);
  assert.equal(gen.entities.some(e => e.type === EntityType.NPC && e.plotNpcId === 'slime_nii_volunteer_mitya'), true);
  assert.equal(monsters.some(e => e.monsterKind !== undefined && slimeKinds.has(e.monsterKind)), true);
  assert.equal(gen.world.cells.some((cell, idx) => cell === Cell.LIFT && gen.world.liftDir[idx] === LiftDirection.UP), true);
  assert.equal(gen.world.cells.some((cell, idx) => cell === Cell.LIFT && gen.world.liftDir[idx] === LiftDirection.DOWN), true);
});

testGenerationMatrix('manhattan crossroads ships as dense road traffic with gang and wrong-exit pressure', () => {
  const gen = timedDesignFloor('manhattan_crossroads', 'design manhattan_crossroads population field');
  const npcs = gen.entities.filter(e => e.type === EntityType.NPC);
  const monsters = gen.entities.filter(e => e.type === EntityType.MONSTER);
  const wildNpcs = npcs.filter(e => e.faction === Faction.WILD);
  const liquidatorNpcs = npcs.filter(e => e.faction === Faction.LIQUIDATOR);
  const wildZones = gen.world.zones.filter(zone => zone.faction === ZoneFaction.WILD);
  const liquidatorZones = gen.world.zones.filter(zone => zone.faction === ZoneFaction.LIQUIDATOR);
  const routeChoices = reachableRoomCount(gen, [
    'Платная перемычка центральной зебры',
    'Низкий тоннель под Восточной авеню',
    'Магазин под эстакадой',
    'Съезд Неправильный поворот',
    'Безопасный бордюр у зебры',
  ]);

  assert.equal(npcs.length >= 2200 && npcs.length <= 4200, true, `npc count ${npcs.length}`);
  assert.equal(monsters.length >= 500 && monsters.length <= 1200, true, `monster count ${monsters.length}`);
  assert.equal(countNear(wildNpcs, 696.5, 602.5, 38) >= 5, true);
  assert.equal(countNear(wildNpcs, 564.5, 574.5, 34) >= 4, true);
  assert.equal(countNear(liquidatorNpcs, 512.5, 512.5, 74) >= 5, true);
  assert.equal(countNear(monsters, 790.5, 622.5, 140) >= 10, true);
  assert.equal(routeChoices >= 3, true);
  assert.equal(wildZones.length > 0, true);
  assert.equal(liquidatorZones.length > 0, true);
  assert.equal(maxEntitiesInArea(gen.entities, EntityType.NPC, 32) <= 40, true);
});

testGenerationMatrix('manhattan crossroads keeps its core route decisions reachable', () => {
  const gen = timedDesignFloor('manhattan_crossroads', 'design manhattan_crossroads decisions');
  const metrics = measureManhattanCrossroadsDecisionMetrics(gen);

  assert.equal(metrics.crosswalkStripeCells >= 100, true, `crosswalk cells ${metrics.crosswalkStripeCells}`);
  assert.equal(metrics.blockInteriorRooms >= 18, true, `block interior rooms ${metrics.blockInteriorRooms}`);
  assert.equal(metrics.blockInteriorReachableCells >= 300, true, `block interior reachable cells ${metrics.blockInteriorReachableCells}`);
  assert.equal(metrics.escortNpcPresent, true);
  assert.equal(metrics.tollDoorLocked, true);
  assert.equal(metrics.tollDoorRequiresKey, true);
  assert.equal(metrics.tollKeyContainers >= 1, true);
  assert.equal(metrics.tollQueueNpcs >= 8, true, `toll queue ${metrics.tollQueueNpcs}`);
  assert.equal(metrics.overpassUngatedCells >= 120, true, `overpass cells ${metrics.overpassUngatedCells}`);
  assert.equal(metrics.underpassUngatedCells >= 120, true, `underpass cells ${metrics.underpassUngatedCells}`);
  assert.equal(metrics.controlRoomReachableCells >= 100, true, `control room cells ${metrics.controlRoomReachableCells}`);
  assert.equal(metrics.repairFuseCount >= 2, true, `repair fuses ${metrics.repairFuseCount}`);
  assert.equal(metrics.cargoRoomReachableCells >= 100, true, `cargo room cells ${metrics.cargoRoomReachableCells}`);
  assert.equal(metrics.cargoMetalSheets >= 2, true, `cargo metal sheets ${metrics.cargoMetalSheets}`);
  assert.equal(metrics.wrongExitUngatedCells >= 100, true, `wrong-exit cells ${metrics.wrongExitUngatedCells}`);
  assert.equal(metrics.wrongExitMonsters >= 1, true, `wrong-exit monsters ${metrics.wrongExitMonsters}`);
});

testGenerationMatrix('underhell ships as a monster-owned veteran threshold', () => {
  const gen = timedDesignFloor('underhell', 'design underhell population field');
  const npcs = gen.entities.filter(e => e.type === EntityType.NPC);
  const ambientNpcs = npcs.filter(e => !e.plotNpcId && !e.persistentNpcId && e.alifeId === undefined);
  const monsters = gen.entities.filter(e => e.type === EntityType.MONSTER);
  const samosborZones = gen.world.zones.filter(zone => zone.faction === ZoneFaction.SAMOSBOR);
  const legalNpcFactions = new Set([Faction.LIQUIDATOR, Faction.CULTIST]);

  assert.equal(npcs.length >= 4 && npcs.length <= 120, true);
  assert.equal(ambientNpcs.length <= 80, true);
  assert.equal(ambientNpcs.every(e => e.name?.includes('ветеран')), true);
  assert.equal(npcs.every(e => e.faction !== undefined && legalNpcFactions.has(e.faction)), true);
  assert.equal(monsters.length >= 3900 && monsters.length <= ACTIVE_ACTOR_SOFT_LIMIT, true);
  assert.equal(maxEntitiesInArea(gen.entities, EntityType.MONSTER, 32) <= 64, true);
  assert.equal(routeCueCount(gen.world) >= 4, true);
  assert.equal(samosborZones.length > 0, true);
});

testGenerationMatrix('dark metro ships as sparse defended bands inside monster-heavy train pressure', () => {
  const route = DESIGN_FLOOR_ROUTES.find(def => def.id === 'dark_metro');
  assert.ok(route);
  const profile = designFloorPopulationProfile(route);
  const gen = timedDesignFloor('dark_metro', 'design dark metro population field');
  const npcs = gen.entities.filter(e => e.type === EntityType.NPC);
  const ambientNpcs = npcs.filter(e => !e.plotNpcId && !e.persistentNpcId && e.alifeId === undefined);
  const monsters = gen.entities.filter(e => e.type === EntityType.MONSTER);
  const legalNpcFactions = new Set([Faction.LIQUIDATOR, Faction.CULTIST, Faction.WILD, Faction.SCIENTIST]);
  const lineYs = [118, 260, 402, 642, 786, 920];
  const railBandMonsters = monsters.filter(e => lineYs.some(y => Math.abs(Math.floor(e.y) - y) <= 24));
  const defendedRooms = gen.world.rooms.filter(room => room.name.startsWith('Пост белой лампы'));
  const defendedEdges = gen.world.rooms.filter(room => room.name.startsWith('Обороняемая кромка'));
  const transitCaches = gen.world.containers.filter(container => container.tags.includes('transit_cache'));
  const hqMonsterCount = monsters.filter(e => {
    const ci = gen.world.idx(Math.floor(e.x), Math.floor(e.y));
    const roomId = gen.world.roomMap[ci];
    return roomId >= 0 && gen.world.rooms[roomId]?.type === RoomType.HQ;
  }).length;

  assert.equal(ambientNpcs.length, profile.npcTarget);
  assert.equal(ambientNpcs.length >= 80 && ambientNpcs.length <= 300, true);
  assert.equal(monsters.length, profile.monsterTarget);
  assert.equal(monsters.length >= 2500 && monsters.length <= ACTIVE_ACTOR_SOFT_LIMIT, true);
  assert.equal(ambientNpcs.every(e => e.name?.includes('ветеран')), true);
  assert.equal(ambientNpcs.every(e => e.faction !== undefined && legalNpcFactions.has(e.faction)), true);
  assert.equal(gen.world.railTracks.length >= 7, true);
  assert.equal(gen.world.railTrains.length >= 7, true);
  assert.equal(gen.world.railTrains.every(train => train.speed >= 3.4 && train.stopSeconds <= 3.8), true);
  assert.equal(defendedRooms.length >= 12, true);
  assert.equal(defendedEdges.length >= 12, true);
  assert.equal(transitCaches.length >= 12, true);
  assert.equal(railBandMonsters.length >= Math.floor(monsters.length * 0.45), true);
  assert.equal(hqMonsterCount <= Math.floor(monsters.length * 0.03), true);
  assert.equal(maxEntitiesInArea(gen.entities, EntityType.NPC, 32) <= 20, true);
});

testGenerationMatrix('upper bureau keeps controlled legal queues with archive monster pressure', () => {
  const route = DESIGN_FLOOR_ROUTES.find(def => def.id === 'upper_bureau');
  assert.ok(route);
  const profile = designFloorPopulationProfile(route);
  const gen = timedDesignFloor('upper_bureau', 'design upper bureau population field');
  const npcs = gen.entities.filter(e => e.type === EntityType.NPC);
  const monsters = gen.entities.filter(e => e.type === EntityType.MONSTER);
  const paperKinds = new Set([
    MonsterKind.PARAGRAPH,
    MonsterKind.PECHATEED,
    MonsterKind.KONTORSHCHIK,
    MonsterKind.PROTOKOLNIK,
    MonsterKind.KANTSELYARSKIY_IDOL,
  ]);
  const paperMonsters = monsters.filter(e => e.monsterKind !== undefined && paperKinds.has(e.monsterKind));
  const zoneFactions = new Set(gen.world.zones.map(zone => zone.faction));
  const hqRooms = gen.world.rooms.filter(room => room.type === RoomType.HQ);

  assert.equal(profile.npcTarget, 650);
  assert.equal(profile.monsterTarget, 1100);
  assert.equal(profile.npcNoun, 'проситель');
  assert.equal(npcs.length >= 350 && npcs.length <= 900, true);
  assert.equal(monsters.length >= 600 && monsters.length <= 1500, true);
  assert.equal(npcs.filter(e => e.occupation === Occupation.SECRETARY).length >= Math.floor(npcs.length * 0.28), true);
  assert.equal(npcs.filter(e => e.faction === Faction.LIQUIDATOR).length >= 120, true);
  assert.equal(npcs.filter(e => e.faction === Faction.SCIENTIST).length >= 25, true);
  assert.equal(paperMonsters.length >= 250, true);
  assert.equal(zoneFactions.has(ZoneFaction.CITIZEN), true);
  assert.equal(zoneFactions.has(ZoneFaction.LIQUIDATOR), true);
  assert.equal(zoneFactions.has(ZoneFaction.SAMOSBOR), true);
  assert.equal(zoneFactions.has(ZoneFaction.WILD), true);
  assert.equal(hqRooms.some(room => room.name === 'Ниша проверки пропусков'), true);
  assert.equal(hqRooms.some(room => room.name === 'Малый кабинет аудиторской тени'), true);
  assert.equal(maxEntitiesInArea(gen.entities, EntityType.NPC, 32) <= 18, true);
});

testGenerationMatrix('upper bureau preserves legal, forged, stolen-key and staff route cuts', () => {
  const gen = timedDesignFloor('upper_bureau', 'design upper bureau route cuts');
  const publicRoute = reachableWithDoorKeys(gen, []);
  const legalRoute = reachableWithDoorKeys(gen, [UPPER_BUREAU_DOCUMENTS.appointmentToken]);
  const forgedRoute = reachableWithDoorKeys(gen, [UPPER_BUREAU_DOCUMENTS.forgedAppointment]);
  const stolenKeyRoute = reachableWithDoorKeys(gen, [UPPER_BUREAU_DOCUMENTS.cleanerKey]);
  const staffOrderRoute = reachableWithDoorKeys(gen, [UPPER_BUREAU_DOCUMENTS.staffRoute]);
  const fullStaffRoute = reachableWithDoorKeys(gen, [
    UPPER_BUREAU_DOCUMENTS.cleanerKey,
    UPPER_BUREAU_DOCUMENTS.staffRoute,
  ]);

  assert.equal(hasReachableLiftWithDoorKeys(gen, publicRoute, LiftDirection.UP), true);
  assert.equal(hasReachableLiftWithDoorKeys(gen, publicRoute, LiftDirection.DOWN), true);
  assert.equal(reachableRoomCellCount(gen, publicRoute, 'Ниша проверки пропусков'), 0);
  assert.equal(reachableRoomCellCount(gen, publicRoute, 'Окно заднего назначения'), 0);
  assert.equal(reachableRoomCellCount(gen, publicRoute, 'Пост переписи сотрудников'), 0);
  assert.equal(reachableRoomCellCount(gen, publicRoute, 'Карман выданных обходов'), 0);

  assert.equal(countReachableCells(legalRoute) > countReachableCells(publicRoute), true);
  assert.equal(reachableRoomCellCount(gen, legalRoute, 'Ниша проверки пропусков') > 0, true);
  assert.equal(reachableRoomCellCount(gen, legalRoute, 'Окно заднего назначения'), 0);

  assert.equal(countReachableCells(forgedRoute) > countReachableCells(publicRoute), true);
  assert.equal(reachableRoomCellCount(gen, forgedRoute, 'Окно заднего назначения') > 0, true);
  assert.equal(reachableRoomCellCount(gen, forgedRoute, 'Ниша проверки пропусков'), 0);

  assert.equal(countReachableCells(stolenKeyRoute) > countReachableCells(publicRoute), true);
  assert.equal(reachableRoomCellCount(gen, stolenKeyRoute, 'Сервисный карман мимо охраны') > 0, true);
  assert.equal(reachableRoomCellCount(gen, stolenKeyRoute, 'Карман выданных обходов') > 0, true);
  assert.equal(reachableRoomCellCount(gen, stolenKeyRoute, 'Пост переписи сотрудников'), 0);

  assert.equal(countReachableCells(staffOrderRoute) > countReachableCells(publicRoute), true);
  assert.equal(reachableRoomCellCount(gen, staffOrderRoute, 'Пост переписи сотрудников') > 0, true);
  assert.equal(reachableRoomCellCount(gen, staffOrderRoute, 'Сервисный карман мимо охраны'), 0);

  assert.equal(countReachableCells(fullStaffRoute) > countReachableCells(stolenKeyRoute), true);
  assert.equal(countReachableCells(fullStaffRoute) > countReachableCells(staffOrderRoute), true);
  assert.equal(reachableRoomCellCount(gen, fullStaffRoute, 'Тупиковый сейф привилегий') > 0, true);
  assert.equal(reachableRoomCellCount(gen, fullStaffRoute, 'Черный ход печатей') > 0, true);
});

testGenerationMatrix('antenna court keeps signal macrostructure with mid micro faction territories', () => {
  const gen = timedDesignFloor('antenna_court', 'design antenna_court population field');
  const ambientNpcs = gen.entities.filter(e => e.type === EntityType.NPC && !e.plotNpcId && !e.persistentNpcId && e.alifeId === undefined);
  const monsters = gen.entities.filter(e => e.type === EntityType.MONSTER);
  const legalNpcFactions = new Set([Faction.SCIENTIST, Faction.LIQUIDATOR]);
  const routeChoices = reachableRoomCount(gen, ['Релейная будка', 'Пост сигнал-инспекции', 'Кабина глушения', 'Архив мониторинга']);
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  const microRooms = gen.world.rooms.filter(room =>
    room.name.includes('малые радиокомнаты') ||
    room.name.includes('сектор') ||
    room.name.includes('ячейки'));
  const territoryCounts = countTerritoryCells(gen.world);
  const totalTerritoryCells = territoryCounts.reduce((sum, row) => sum + row.cells, 0);
  const territoryByOwner = new Map(territoryCounts.map(row => [row.owner, row.cells]));
  const hqOwners = new Set(territoryHqAnchors(gen.world).map(anchor => anchor.owner));
  const targetShares = [
    [ZoneFaction.CITIZEN, 0.18],
    [ZoneFaction.LIQUIDATOR, 0.36],
    [ZoneFaction.CULTIST, 0.08],
    [ZoneFaction.SCIENTIST, 0.24],
    [ZoneFaction.WILD, 0.14],
  ] as const;
  let signalCableCells = 0;
  let signalYardFixtures = 0;
  for (let i = 0; i < gen.world.cells.length; i++) {
    if (!audit.reachable[i] || gen.world.roomMap[i] >= 0) continue;
    if (gen.world.cells[i] === Cell.FLOOR && gen.world.floorTex[i] === Tex.F_LINO) signalCableCells++;
    const feature = gen.world.features[i];
    if (feature === Feature.APPARATUS || feature === Feature.MACHINE || feature === Feature.LAMP) signalYardFixtures++;
  }

  assert.equal(ambientNpcs.length >= 20 && ambientNpcs.length <= 80, true);
  assert.equal(ambientNpcs.every(e => e.faction !== undefined && legalNpcFactions.has(e.faction)), true);
  assert.equal(ambientNpcs.every(e => e.name?.includes('сигнал-специалист')), true);
  assert.equal(monsters.length >= 2200 && monsters.length <= ACTIVE_ACTOR_SOFT_LIMIT, true);
  assert.equal(gen.world.rooms.length >= 400, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 400, true, `doors ${gen.world.doors.size}`);
  assert.equal(microRooms.length >= 280, true, `micro rooms ${microRooms.length}`);
  assert.equal(routeChoices >= 3, true);
  assert.equal(signalCableCells >= 900, true);
  assert.equal(signalYardFixtures >= 40, true);
  for (const [owner, targetShare] of targetShares) {
    const cells = territoryByOwner.get(owner) ?? 0;
    const share = cells / totalTerritoryCells;
    assert.equal(cells > 0, true, `territory cells for ${owner}`);
    assert.equal(Math.abs(share - targetShare) <= 0.025, true, `territory share ${owner}: ${share}`);
    assert.equal(hqOwners.has(owner), true, `HQ owner ${owner}`);
  }
  const liquidatorCells = territoryByOwner.get(ZoneFaction.LIQUIDATOR) ?? 0;
  assert.equal(liquidatorCells > (territoryByOwner.get(ZoneFaction.SCIENTIST) ?? 0), true);
});

testGenerationMatrix('silicon net well creates protected science pockets and silicon monster pressure', () => {
  const gen = timedDesignFloor('silicon_net_well', 'design silicon_net_well population field');
  const npcs = gen.entities.filter(e => e.type === EntityType.NPC);
  const ambientNpcs = npcs.filter(e => !e.plotNpcId && !e.persistentNpcId && e.alifeId === undefined);
  const genericSpecialists = ambientNpcs.filter(e => e.name?.startsWith('Кремниевый НЕТ-колодец:'));
  const monsters = gen.entities.filter(e => e.type === EntityType.MONSTER);
  const specialists = npcs.filter(e =>
    e.faction === Faction.SCIENTIST ||
    e.occupation === Occupation.SCIENTIST ||
    e.occupation === Occupation.ELECTRICIAN ||
    e.occupation === Occupation.MECHANIC,
  );
  const liquidators = npcs.filter(e => e.faction === Faction.LIQUIDATOR);
  const siliconKinds = new Set([
    MonsterKind.SAFEGUARD,
    MonsterKind.SLIMEVIK,
    MonsterKind.SLIME_WOMAN,
    MonsterKind.CHERVIE_AVATAR,
    MonsterKind.CHERNOSLIZ,
    MonsterKind.HEAD_SLUG,
  ]);
  const siliconMonsters = monsters.filter(e => e.monsterKind !== undefined && siliconKinds.has(e.monsterKind));
  const sciencePocketRooms = gen.world.rooms.filter(room =>
    room.name.includes('НИИ-под') ||
    room.name.includes('Серверная') ||
    room.name.includes('Кабельная')
  );
  const protectedRooms = gen.world.rooms.filter(room => room.type === RoomType.MEDICAL || room.type === RoomType.HQ);
  const monsterZones = gen.world.zones.filter(zone => zone.faction === ZoneFaction.SAMOSBOR || zone.faction === ZoneFaction.WILD);
  const liquidatorZones = gen.world.zones.filter(zone => zone.faction === ZoneFaction.LIQUIDATOR);

  assert.equal(npcs.length >= 350 && npcs.length <= 900, true);
  assert.equal(genericSpecialists.length >= 520, true);
  assert.equal(genericSpecialists.every(e => e.name?.includes('специалист')), true);
  assert.equal(monsters.length >= 1200 && monsters.length <= 2600, true);
  assert.equal(specialists.length >= 240, true);
  assert.equal(liquidators.length >= 120, true);
  assert.equal(siliconMonsters.length >= 240, true);
  assert.equal(sciencePocketRooms.length >= 7, true);
  assert.equal(protectedRooms.length >= 6, true);
  assert.equal(monsterZones.length >= liquidatorZones.length, true);
  assert.equal(maxEntitiesInArea(gen.entities, EntityType.NPC, 32) <= 18, true);
});

testGenerationMatrix('floor 69 uses the shared field as an adult social-debt route', () => {
  const gen = timedDesignFloor('floor_69', 'design floor_69 population field');
  const npcs = gen.entities.filter(e => e.type === EntityType.NPC);
  const ambientNpcs = npcs.filter(e => !e.plotNpcId && !e.persistentNpcId && e.alifeId === undefined);
  const monsters = gen.entities.filter(e => e.type === EntityType.MONSTER);
  const liquidatorNpcs = npcs.filter(e => e.faction === Faction.LIQUIDATOR);
  const socialStaffNpcs = npcs.filter(e =>
    e.occupation === Occupation.SECRETARY ||
    e.occupation === Occupation.STOREKEEPER ||
    e.occupation === Occupation.DOCTOR ||
    e.occupation === Occupation.HUNTER,
  );
  const generatedWorkers = ambientNpcs.filter(e => e.name?.startsWith('Этаж 69: работница '));
  const generatedVisitors = ambientNpcs.filter(e => e.name?.startsWith('Этаж 69: посетитель '));
  const floor69FemaleSprites = ambientNpcs.filter(e => isFloor69FemaleSprite(e.sprite));
  const femaleQuestNpcs = npcs.filter(e => e.plotNpcId?.startsWith('f69_') && e.isFemale === true);

  assert.equal(npcs.length >= 1700 && npcs.length <= 3200, true);
  assert.equal(ambientNpcs.length >= 1700, true);
  assert.equal(monsters.length >= 200 && monsters.length <= 700, true);
  assert.equal(npcs.some(e => e.occupation === Occupation.CHILD), false);
  assert.equal(liquidatorNpcs.length > 40, true);
  assert.equal(socialStaffNpcs.length > 400, true);
  assert.equal(floor69FemaleSprites.length >= 300, true);
  assert.equal(floor69FemaleSprites.length, generatedWorkers.length);
  assert.equal(floor69FemaleSprites.every(e =>
    e.isFemale === true &&
    e.npcVisualId === NPC_VISUAL_WORKER69 &&
    e.name?.startsWith('Этаж 69: работница ')
  ), true);
  assert.equal(generatedWorkers.every(e => isFloor69FemaleSprite(e.sprite)), true);
  assert.equal(generatedVisitors.every(e => !isFloor69FemaleSprite(e.sprite)), true);
  assert.deepEqual(femaleQuestNpcs.map(e => e.plotNpcId).sort(), ['f69_doctor_sima', 'f69_madam_roza', 'f69_performer_ira']);
  assert.equal(femaleQuestNpcs.every(e => isFloor69FemaleSprite(e.sprite) && e.npcVisualId === NPC_VISUAL_FLOOR69_FEMALE), true);
  assert.equal(maxEntitiesInArea(gen.entities, EntityType.NPC, 32) <= 26, true);
});

testGenerationMatrix('pioneer camp keeps a populated protected center and dangerous trail edge', () => {
  const route = DESIGN_FLOOR_ROUTES.find(def => def.id === 'pioneer_camp');
  assert.ok(route);
  const profile = designFloorPopulationProfile(route);
  const gen = timedDesignFloor('pioneer_camp', 'design pioneer camp population field');
  const npcs = gen.entities.filter(e => e.type === EntityType.NPC);
  const monsters = gen.entities.filter(e => e.type === EntityType.MONSTER);
  const childNpcs = npcs.filter(e => e.occupation === Occupation.CHILD);
  const centerNpcs = npcs.filter(e => gen.world.dist(e.x, e.y, W / 2, W / 2) < 180);
  const centerMonsters = monsters.filter(e => gen.world.dist(e.x, e.y, W / 2, W / 2) < 180);
  const edgeMonsters = monsters.filter(e => gen.world.dist(e.x, e.y, W / 2, W / 2) > 250);
  const factionAt = (x: number, y: number) => gen.world.factionControl[gen.world.idx(x, y)];
  const roomNames = new Set(gen.world.rooms.map(room => room.name));
  const reachable = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))).reachable;
  const forestTrailPoints = gen.world.features.reduce((count, feature, cell) => {
    if (feature !== Feature.SLIDE) return count;
    if (gen.world.cells[cell] !== Cell.FLOOR || gen.world.roomMap[cell] >= 0) return count;
    const x = cell % W;
    const y = (cell / W) | 0;
    const d = gen.world.dist(x + 0.5, y + 0.5, W / 2, W / 2);
    return d >= 180 && d <= 470 ? count + 1 : count;
  }, 0);
  const territoryRows = countTerritoryCells(gen.world);
  const territoryTotal = territoryRows.reduce((sum, row) => sum + row.cells, 0);
  const territoryShare = (owner: ZoneFaction): number => (territoryRows.find(row => row.owner === owner)?.cells ?? 0) / territoryTotal;
  const hqOwners = new Set(territoryHqAnchors(gen.world).map(anchor => anchor.owner));
  const hermeticHqs = gen.world.rooms.filter(room =>
    room.type === RoomType.HQ &&
    room.sealed &&
    room.doors.some(doorIdx => {
      const door = gen.world.doors.get(doorIdx);
      return door?.state === DoorState.HERMETIC_OPEN || door?.state === DoorState.HERMETIC_CLOSED;
    })
  );
  const campMicroRooms = gen.world.rooms.filter(room =>
    room.name.includes(': малая спальня') ||
    room.name.includes(': кладовая инвентаря') ||
    room.name.includes(': умывальная будка') ||
    room.name.includes(': чайная комната') ||
    room.name.includes(': комната совета отряда') ||
    room.name.includes(': шкафы формы')
  );
  const landscapeCourts = gen.world.rooms.filter(room =>
    room.name === 'Большой парк бетонных берёз' ||
    room.name === 'Двор утренней зарядки' ||
    room.name === 'Поляна костровой сирены' ||
    room.name === 'Парк мокрых качелей'
  );

  assert.equal(profile.npcTarget, 1100);
  assert.equal(profile.monsterTarget, 900);
  assert.equal(gen.world.rooms.length >= 110, true, `pioneer camp rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 80, true, `pioneer camp doors ${gen.world.doors.size}`);
  assert.equal(countReachableCells(reachable) >= 130_000, true, `pioneer camp reachable ${countReachableCells(reachable)}`);
  assert.equal(npcs.length >= 700 && npcs.length <= 1400, true);
  assert.equal(monsters.length >= 500 && monsters.length <= 1200, true);
  assert.equal(childNpcs.length >= Math.floor(npcs.length * 0.6), true);
  assert.equal(centerNpcs.length > centerMonsters.length, true);
  assert.equal(edgeMonsters.length > centerMonsters.length, true);
  assert.equal(maxEntitiesInArea(gen.entities, EntityType.NPC, 32) <= 16, true);
  assert.equal(npcs.filter(e => e.canGiveQuest).length >= 4, true);
  assert.equal(gen.world.containers.filter(container => container.tags.includes('pioneer_camp')).length >= 5, true);
  assert.equal(roomNames.has('Громкоговоритель строевого сбора'), true);
  assert.equal(roomNames.has('Склад смены с чужими бирками'), true);
  assert.equal(landscapeCourts.length, 4);
  assert.equal(campMicroRooms.length >= 48, true, `pioneer camp micro rooms ${campMicroRooms.length}`);
  assert.equal(hermeticHqs.length >= 5, true, `pioneer camp hermetic hqs ${hermeticHqs.length}`);
  for (const owner of [ZoneFaction.CITIZEN, ZoneFaction.LIQUIDATOR, ZoneFaction.CULTIST, ZoneFaction.SCIENTIST, ZoneFaction.WILD] as const) {
    assert.equal(hqOwners.has(owner), true, `pioneer camp hq owner ${owner}`);
    assert.equal(territoryShare(owner) > 0, true, `pioneer camp owned cells ${owner}`);
  }
  assert.equal(territoryShare(ZoneFaction.CITIZEN) >= 0.53 && territoryShare(ZoneFaction.CITIZEN) <= 0.63, true, `citizen share ${territoryShare(ZoneFaction.CITIZEN)}`);
  assert.equal(territoryShare(ZoneFaction.LIQUIDATOR) >= 0.09 && territoryShare(ZoneFaction.LIQUIDATOR) <= 0.15, true, `liquidator share ${territoryShare(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(territoryShare(ZoneFaction.CULTIST) >= 0.045 && territoryShare(ZoneFaction.CULTIST) <= 0.095, true, `cultist share ${territoryShare(ZoneFaction.CULTIST)}`);
  assert.equal(territoryShare(ZoneFaction.SCIENTIST) >= 0.065 && territoryShare(ZoneFaction.SCIENTIST) <= 0.12, true, `scientist share ${territoryShare(ZoneFaction.SCIENTIST)}`);
  assert.equal(territoryShare(ZoneFaction.WILD) >= 0.11 && territoryShare(ZoneFaction.WILD) <= 0.18, true, `wild share ${territoryShare(ZoneFaction.WILD)}`);
  assert.equal(forestTrailPoints >= 36, true);
  assert.equal(factionAt(W / 2, W / 2), ZoneFaction.CITIZEN);
  assert.equal(factionAt(W / 2, W / 2 - 150), ZoneFaction.SCIENTIST);
});

testGenerationMatrix('chthonic attic keeps a zero-ordinary-NPC monster service maze', () => {
  const gen = timedDesignFloor('chthonic_attic', 'design chthonic attic population field');
  const npcs = gen.entities.filter(e => e.type === EntityType.NPC);
  const ambientNpcs = npcs.filter(e => !e.plotNpcId && !e.persistentNpcId && e.alifeId === undefined);
  const monsters = gen.entities.filter(e => e.type === EntityType.MONSTER);
  const cacheCount = gen.world.containers.filter(container => container.tags.includes('attic') && container.tags.includes('cache')).length;
  const serviceRooms = gen.world.rooms.filter(room => {
    const name = room.name.toLowerCase();
    return name.includes('шахт') || name.includes('кабель') || name.includes('карман') || name.includes('сервис');
  });

  assert.equal(ambientNpcs.length, 0);
  assert.equal(npcs.length <= 40, true);
  assert.equal(monsters.length >= 2500 && monsters.length <= ACTIVE_ACTOR_SOFT_LIMIT, true);
  assert.equal(maxEntitiesInArea(gen.entities, EntityType.MONSTER, 32) <= 36, true);
  assert.equal(gen.world.zones.some(zone => zone.fogged && zone.level >= 4), true);
  assert.equal(cacheCount >= 4, true);
  assert.equal(serviceRooms.length >= 4, true);
});

testGenerationMatrix('generic design floor population field adds density without violating edge rules', () => {
  const communal = timedDesignFloor('communal_ring', 'design communal population field');
  const communalNpcs = communal.entities.filter(e => e.type === EntityType.NPC);
  const communalMonsters = communal.entities.filter(e => e.type === EntityType.MONSTER);
  assert.equal(communalNpcs.length >= 3000, true);
  assert.equal(communalMonsters.length >= 250, true);
  assert.equal(communalNpcs.length <= ENTITY_SOFT_LIMITS[EntityType.NPC], true);
  assert.equal(maxEntitiesInArea(communal.entities, EntityType.NPC, 32) <= 18, true);
});

testProceduralFloorFullMatrix('roof design floor population stays NPC-free and monster-capped', () => {
  const roof = timedDesignFloor('roof', 'design roof population field');
  const roofNpcs = roof.entities.filter(e => e.type === EntityType.NPC);
  const roofMonsters = roof.entities.filter(e => e.type === EntityType.MONSTER);
  assert.equal(roofNpcs.length, 0);
  assert.equal(roofMonsters.length >= ACTIVE_ACTOR_SOFT_LIMIT - 16, true);
  assert.equal(roofMonsters.length <= ACTIVE_ACTOR_SOFT_LIMIT, true);
  assert.equal(roofMonsters.length <= ENTITY_SOFT_LIMITS[EntityType.MONSTER], true);
});

test('population placement sampler skips fixtures, containers and lift buttons', () => {
  const world = new World();
  for (let x = 10; x < 20; x++) {
    const ci = world.idx(x, 10);
    world.cells[ci] = Cell.FLOOR;
  }
  const lampCell = world.idx(10, 10);
  const liftButtonCell = world.idx(11, 10);
  const tableCell = world.idx(12, 10);
  const containerCell = world.idx(13, 10);
  world.features[lampCell] = Feature.LAMP;
  world.features[liftButtonCell] = Feature.LIFT_BUTTON;
  world.liftDir[liftButtonCell] = LiftDirection.DOWN;
  world.features[tableCell] = Feature.TABLE;
  world.addContainer({
    id: 1,
    x: 13,
    y: 10,
    floor: FloorLevel.LIVING,
    roomId: -1,
    zoneId: 0,
    kind: ContainerKind.WOODEN_CHEST,
    name: 'test placement blocker',
    inventory: [],
    capacitySlots: 1,
    access: 'public',
    discovered: true,
    tags: [],
  });

  const blocked = new Set([lampCell, liftButtonCell, tableCell, containerCell]);
  const cells = sampleNaturalPopulationCells(world, 20, {
    noiseScale: 64,
    noiseStrength: 0,
    openWeight: 1,
    smoothingPasses: 0,
  }, 88013);

  assert.equal(cells.length, 6);
  assert.equal(new Set(cells).size, cells.length);
  for (const cell of cells) {
    assert.equal(blocked.has(cell), false, `sampled occupied fixture cell ${cell}`);
    assert.equal(world.features[cell], Feature.NONE);
    assert.equal(world.containerMap.has(cell), false);
  }
});

testGenerationMatrix('black market 88 ships dense trade, guarded contraband, and service-gut monster pressure', () => {
  const gen = timedDesignFloor('black_market_88', 'design black_market_88 rework');
  const npcs = gen.entities.filter(e => e.type === EntityType.NPC);
  const monsters = gen.entities.filter(e => e.type === EntityType.MONSTER);
  const marketContainers = gen.world.containers.filter(c => c.tags.includes('market88'));
  const guardedMarketContainers = marketContainers.filter(c => c.tags.some(tag =>
    tag === 'contraband_cache' ||
    tag === 'debt' ||
    tag === 'medicine' ||
    tag === 'weapons' ||
    tag === 'black_route_papers' ||
    tag === 'supplier_betrayal',
  ));
  const serviceRoom = (x: number, y: number): boolean => {
    const cell = gen.world.idx(Math.floor(x), Math.floor(y));
    const room = gen.world.rooms[gen.world.roomMap[cell]];
    return !!room && (
      room.type === RoomType.STORAGE ||
      room.type === RoomType.PRODUCTION ||
      room.name.includes('склад') ||
      room.name.includes('служеб') ||
      room.name.includes('кишка') ||
      room.name.includes('люк') ||
      room.name.includes('кладовая')
    );
  };
  const serviceMonsters = monsters.filter(e => serviceRoom(e.x, e.y)).length;
  const serviceGutZone = (x: number, y: number): boolean => {
    const northSouthGuts = x >= 180 && x <= 844 && ((y >= 286 && y <= 356) || (y >= 676 && y <= 736));
    const westEastGuts = y >= 344 && y <= 660 && (x <= 180 || x >= 844);
    return northSouthGuts || westEastGuts;
  };
  const serviceGutZones = gen.world.zones.filter(zone => serviceGutZone(zone.cx, zone.cy));
  const serviceGutFactionSet = new Set(serviceGutZones.map(zone => zone.faction));
  const hostileServiceGutZones = serviceGutZones.filter(zone =>
    zone.faction === ZoneFaction.WILD || zone.faction === ZoneFaction.SAMOSBOR,
  );
  const marketQuestTags = new Set(SIDE_QUESTS
    .filter(q => q.id.startsWith('market88_'))
    .flatMap(q => q.eventTags ?? []));

  assert.equal(npcs.length >= 1600 && npcs.length <= 3000, true);
  assert.equal(monsters.length >= 300 && monsters.length <= 900, true);
  assert.equal(marketContainers.length >= 14, true);
  assert.equal(guardedMarketContainers.length >= 8, true);
  assert.equal(guardedMarketContainers.every(c => c.access !== 'public' && c.access !== 'room'), true);
  assert.equal(serviceMonsters >= 80, true);
  assert.equal(serviceGutZones.length >= 8, true);
  assert.equal(hostileServiceGutZones.length, serviceGutZones.length);
  assert.equal(serviceGutFactionSet.has(ZoneFaction.WILD), true);
  assert.equal(serviceGutFactionSet.has(ZoneFaction.SAMOSBOR), true);
  for (const tag of ['supplier_delivery', 'protect_courier', 'forgery', 'debt_settlement', 'supplier_betrayal', 'market_scarcity']) {
    assert.equal(marketQuestTags.has(tag), true, `missing Market 88 quest event tag ${tag}`);
  }
});

testGenerationMatrix('service floor rework keeps sparse crews, pressure panels and machine-maze monsters reachable', () => {
  const route = DESIGN_FLOOR_ROUTES.find(item => item.id === 'service_floor');
  assert.ok(route);
  const profile = designFloorPopulationProfile(route);
  assert.equal(profile.npcTarget, 780);
  assert.equal(profile.monsterTarget, 1600);
  assert.equal(profile.npcPlacement.anchors?.length ?? 0, 5);
  assert.equal((profile.monsterPlacement.anchors?.length ?? 0) >= 8, true);

  const gen = timedDesignFloor('service_floor', 'design service_floor rework');
  const npcs = gen.entities.filter(e => e.type === EntityType.NPC);
  const monsters = gen.entities.filter(e => e.type === EntityType.MONSTER);
  const rescueWorker = gen.entities.find(e => e.plotNpcId === 'service_trapped_pump_worker');
  const panels = getEmergencyPanels(gen.world);
  const panelDefs = new Set(panels.map(panel => panel.defId));
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));

  assert.equal(npcs.length >= 500 && npcs.length <= 1100, true);
  assert.equal(monsters.length >= 900 && monsters.length <= 2200, true);
  assert.equal(maxEntitiesInArea(gen.entities, EntityType.NPC, 32) <= 18, true);
  assert.ok(rescueWorker);
  assertAuditReachable(gen.world, audit, gen.world.idx(Math.floor(rescueWorker.x), Math.floor(rescueWorker.y)), 'service rescue worker');
  assert.equal(panelDefs.has('panel_power'), true);
  assert.equal(panelDefs.has('panel_water'), true);
  assert.equal(panelDefs.has('panel_doors'), true);
  assert.equal(panelDefs.has('panel_vent'), true);
  for (const panel of panels) assertAuditReachable(gen.world, audit, panel.idx, `service panel ${panel.defId}`);
});

testProceduralFloorFullMatrix('authored design floors occupy the full 1024x1024 route footprint', () => {
  for (const route of DESIGN_FLOOR_ROUTES) {
    const gen = timedDesignFloor(route.id, `design ${route.id}`);
    assertFullFootprint(gen.world, route.id);
  }
});

testGenerationMatrix('rail train anomaly generates tracks, trains, and rideable train entities', () => {
  const base = makeProceduralFloorSpec(654, 3);
  const spec = {
    ...base,
    anomalyId: 'rail_trains' as const,
    danger: Math.max(2, base.danger) as typeof base.danger,
    title: `поезда: ${base.title}`,
  };
  const gen = timedProceduralSpec(spec, 'forced rail trains seed=654');
  const railCues = getRouteCueMarkers(gen.world).filter(marker => marker.tags.includes('rail_trains'));
  const railAxes = new Set(gen.world.railTracks.map(track => {
    const xs = new Set(track.cells.map(cell => cell % W));
    const ys = new Set(track.cells.map(cell => (cell / W) | 0));
    return xs.size >= ys.size ? 'horizontal' : 'vertical';
  }));
  const railOwners = new Map<number, number>();
  let crossingCells = 0;
  for (let trackIndex = 0; trackIndex < gen.world.railTracks.length; trackIndex++) {
    for (const cell of gen.world.railTracks[trackIndex].cells) {
      const owner = railOwners.get(cell);
      if (owner === undefined) railOwners.set(cell, trackIndex);
      else if (owner !== trackIndex) crossingCells++;
    }
  }
  const platformCells = gen.world.railTracks.flatMap(track => track.platformCells);
  const litPlatformCells = platformCells.filter(cell =>
    gen.world.cells[cell] === Cell.FLOOR &&
    gen.world.light[cell] > 0.15 &&
    gen.world.features[cell] !== Feature.LIFT_BUTTON);

  assert.equal(gen.world.railTracks.length >= 2, true);
  assert.equal(gen.world.railTrains.length >= 2, true);
  assert.equal(railAxes.has('horizontal'), true);
  assert.equal(railAxes.has('vertical'), true);
  assert.equal(crossingCells > 0, true, `rail crossings ${crossingCells}`);
  assert.equal(gen.world.railTracks[0].stationOffsets.length > 0, true);
  assert.equal(gen.world.railTracks[0].platformCells.length > 0, true);
  assert.equal(litPlatformCells.length >= 24, true, `lit platform cells ${litPlatformCells.length}`);
  assert.equal(railCues.some(marker => marker.tags.includes('safe_shell')), true);
  assert.equal(railCues.some(marker => marker.tags.includes('transfer') && marker.tags.includes('crossing')), true);
  assert.equal(gen.world.railTrains[0].entityIds.every(id => gen.entities.some(e => e.id === id && e.type === EntityType.BILLBOARD)), true);
});

test('smog anomaly spends gasmask filters under sustained exposure', () => {
  const base = makeProceduralFloorSpec(606, -35);
  const spec = {
    ...base,
    anomalyId: 'smog' as const,
    danger: Math.max(3, base.danger) as typeof base.danger,
    title: `говнячный смог: ${base.title}`,
  };
  const state = makeGameState({ currentFloor: spec.baseFloor, time: 10 });
  setFloorRunState(state, {
    runSeed: 606,
    currentZ: spec.z,
    specs: { [spec.key]: spec },
    visited: {},
  }, spec.baseFloor);

  const world = new World();
  const smogIdx = world.idx(24, 24);
  world.cells[smogIdx] = Cell.FLOOR;
  world.anomalySmogSource = smogIdx;
  world.anomalySmogCells = [smogIdx];
  world.fog[smogIdx] = 255;
  const player = makeTestPlayer({
    id: 9001,
    x: 24.5,
    y: 24.5,
    hp: 100,
    maxHp: 100,
    inventory: [{ defId: 'gasmask_filter', count: 1 }],
  });

  for (let i = 0; i < 80 && countInventoryItem(player, 'gasmask_filter') > 0; i++) {
    updateProceduralAnomalies(world, player, state, 2.5);
    state.time += 2.5;
  }

  assert.equal(countInventoryItem(player, 'gasmask_filter'), 0);
  assert.equal(player.hp, 100);
  const spent = getRecentEvents(state, { type: 'player_use_item', tags: ['smog', 'spent'], limit: 1 })[0];
  assert.equal(spent?.itemId, 'gasmask_filter');
});

test('smog anomaly spends wet rag bundles as short wet-cloth mitigation', () => {
  const base = makeProceduralFloorSpec(608, -35);
  const spec = {
    ...base,
    anomalyId: 'smog' as const,
    danger: Math.max(3, base.danger) as typeof base.danger,
    title: `говнячный смог: ${base.title}`,
  };
  const state = makeGameState({ currentFloor: spec.baseFloor, time: 10 });
  setFloorRunState(state, {
    runSeed: 608,
    currentZ: spec.z,
    specs: { [spec.key]: spec },
    visited: {},
  }, spec.baseFloor);

  const world = new World();
  const smogIdx = world.idx(30, 30);
  world.cells[smogIdx] = Cell.FLOOR;
  world.anomalySmogSource = smogIdx;
  world.anomalySmogCells = [smogIdx];
  world.fog[smogIdx] = 255;
  const player = makeTestPlayer({
    id: 9002,
    x: 30.5,
    y: 30.5,
    hp: 100,
    maxHp: 100,
    inventory: [{ defId: 'wet_rag_bundle', count: 1 }],
  });

  assert.equal(getProceduralSmogStatus(world, player, state).protection, 'cloth_ready');
  updateProceduralAnomalies(world, player, state, 2.5);

  assert.equal(countInventoryItem(player, 'wet_rag_bundle'), 0);
  assert.equal(player.hp, 100);
  assert.equal(getProceduralSmogStatus(world, player, state).protection, 'wet_cloth');
  const spent = getRecentEvents(state, { type: 'player_use_item', tags: ['wet_rag_bundle', 'spent'], limit: 1 })[0];
  assert.equal(spent?.itemId, 'wet_rag_bundle');
  assert.equal(spent?.data?.durationSeconds, 45);
});

test('smog anomaly runtime is scoped to the current procedural floor spec', () => {
  const baseA = makeProceduralFloorSpec(610, -35);
  const specA: ProceduralFloorSpec = {
    ...baseA,
    anomalyId: 'smog',
    danger: Math.max(3, baseA.danger) as typeof baseA.danger,
    title: `говнячный смог: ${baseA.title}`,
  };
  const baseB = makeProceduralFloorSpec(611, -37);
  const specB: ProceduralFloorSpec = {
    ...baseB,
    anomalyId: 'smog',
    danger: Math.max(3, baseB.danger) as typeof baseB.danger,
    title: `говнячный смог: ${baseB.title}`,
  };
  const state = makeGameState({ currentFloor: specA.baseFloor, time: 10 });
  const smogIdx = 40 + 40 * W;
  const worldA = new World();
  worldA.cells[smogIdx] = Cell.FLOOR;
  worldA.anomalySmogSource = smogIdx;
  worldA.anomalySmogCells = [smogIdx];
  worldA.fog[smogIdx] = 255;
  setFloorRunState(state, {
    runSeed: 610,
    currentZ: specA.z,
    specs: { [specA.key]: specA },
    visited: {},
  }, specA.baseFloor);

  const player = makeTestPlayer({
    id: 9003,
    x: 40.5,
    y: 40.5,
    hp: 100,
    maxHp: 100,
    inventory: [{ defId: 'wet_rag_bundle', count: 1 }],
  });
  updateProceduralAnomalies(worldA, player, state, 2.5);

  assert.equal(countInventoryItem(player, 'wet_rag_bundle'), 0);
  assert.equal(getProceduralSmogStatus(worldA, player, state).protection, 'wet_cloth');

  const worldB = new World();
  worldB.cells[smogIdx] = Cell.FLOOR;
  worldB.anomalySmogSource = smogIdx;
  worldB.anomalySmogCells = [smogIdx];
  worldB.fog[smogIdx] = 255;
  state.currentFloor = specB.baseFloor;
  setFloorRunState(state, {
    runSeed: 611,
    currentZ: specB.z,
    specs: { [specB.key]: specB },
    visited: {},
  }, specB.baseFloor);
  player.x = 80.5;
  player.y = 80.5;

  const status = getProceduralSmogStatus(worldB, player, state);
  assert.equal(status.protection, 'none');
  assert.equal(status.sourceFound, false);
});

testGenerationMatrix('living tunnels anomaly seeds roots and mutates bounded cells over time', () => {
  const base = makeProceduralFloorSpec(881, 9);
  const spec = {
    ...base,
    anomalyId: 'living_tunnels' as const,
    danger: Math.max(3, base.danger) as typeof base.danger,
    title: `живые тоннели: ${base.title}`,
  };
  const gen = timedProceduralSpec(spec, 'forced living tunnels seed=881');
  const roots = gen.world.rooms.filter(room => room.name.includes('[living_tunnel:'));
  assert.equal(roots.length > 0, true);
  const monsters = gen.entities.filter(e => e.type === EntityType.MONSTER);
  assert.equal(monsters.length <= PROCEDURAL_POPULATION_PROFILES.normal.monsters.cap, true);

  let initialGutCells = 0;
  for (let i = 0; i < gen.world.cells.length; i++) {
    if (gen.world.cells[i] === Cell.FLOOR && gen.world.floorTex[i] === Tex.F_GUT) initialGutCells++;
  }
  assert.equal(initialGutCells >= roots.length * 4, true);

  const state = makeGameState({ currentFloor: spec.baseFloor });
  const player = makeTestPlayer({ id: 999999, x: gen.spawnX, y: gen.spawnY, hp: 100, maxHp: 100 });
  const beforeVersion = gen.world.cellVersion;
  updateLivingTunnelsAnomaly(gen.world, player, state, 1.4);

  let liveCells = 0;
  for (let i = 0; i < gen.world.cells.length; i++) {
    if (gen.world.cells[i] === Cell.FLOOR && gen.world.floorTex[i] === Tex.F_GUT) liveCells++;
  }

  assert.equal(gen.world.cellVersion > beforeVersion, true);
  assert.equal(liveCells > 0, true);
  assert.equal(gen.world.cells[gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))], Cell.FLOOR);
});

test('bad apple frame pack decodes 144x108 binary frames', async () => {
  const frames = await import('../src/data/bad_apple_frames');
  assert.equal(frames.BAD_APPLE_WIDTH, BAD_APPLE_WIDTH);
  assert.equal(frames.BAD_APPLE_HEIGHT, BAD_APPLE_HEIGHT);

  const pixels = new Uint8Array(frames.BAD_APPLE_WIDTH * frames.BAD_APPLE_HEIGHT);
  frames.drawBadAppleFrame(pixels, 60);

  let black = 0;
  for (const px of pixels) {
    assert.equal(px === 0 || px === 1, true);
    black += px;
  }

  assert.equal(frames.BAD_APPLE_WIDTH, 144);
  assert.equal(frames.BAD_APPLE_HEIGHT, 108);
  assert.equal(black > 0 && black < pixels.length, true);
});

testBadAppleExperiment('bad apple anomaly stamps an honest 144x108 map rectangle', () => {
  const base = makeProceduralFloorSpec(777, 3);
  const spec = {
    ...base,
    anomalyId: 'bad_apple_world' as const,
    danger: Math.max(3, base.danger) as typeof base.danger,
    title: `bad apple!: ${base.title}`,
  };
  const gen = timedProceduralSpec(spec, 'forced bad apple stamp seed=777');
  const room = gen.world.rooms.find(r => r.name.startsWith('Bad Apple!'));

  assert.equal(!!room, true);
  assert.equal(room?.w, BAD_APPLE_WIDTH);
  assert.equal(room?.h, BAD_APPLE_HEIGHT);
  assert.equal(gen.world.cells[gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))], Cell.FLOOR);

  let owned = 0;
  for (let dy = 0; dy < BAD_APPLE_HEIGHT; dy++) {
    for (let dx = 0; dx < BAD_APPLE_WIDTH; dx++) {
      const ci = gen.world.idx((room?.x ?? 0) + dx, (room?.y ?? 0) + dy);
      if (gen.world.roomMap[ci] === room?.id) owned++;
    }
  }
  assert.equal(owned, BAD_APPLE_WIDTH * BAD_APPLE_HEIGHT);
});

testBadAppleExperiment('bad apple runtime advances the map rectangle into white floor cells', () => {
  const base = makeProceduralFloorSpec(778, 3);
  const spec = {
    ...base,
    anomalyId: 'bad_apple_world' as const,
    danger: Math.max(3, base.danger) as typeof base.danger,
    title: `bad apple!: ${base.title}`,
  };
  const gen = timedProceduralSpec(spec, 'forced bad apple runtime seed=778');
  const room = gen.world.rooms.find(r => r.name.startsWith('Bad Apple!'));
  assert.equal(!!room, true);

  const state = makeGameState({ currentFloor: spec.baseFloor });
  const player = {
    id: 999999,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: gen.spawnX,
    y: gen.spawnY,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    hp: 100,
    maxHp: 100,
  };
  const beforeVersion = gen.world.cellVersion;
  updateBadAppleWorldAnomaly(gen.world, player, state, 0.4);

  let whiteFloor = 0;
  for (let dy = 0; dy < BAD_APPLE_HEIGHT; dy++) {
    for (let dx = 0; dx < BAD_APPLE_WIDTH; dx++) {
      const ci = gen.world.idx((room?.x ?? 0) + dx, (room?.y ?? 0) + dy);
      if (gen.world.cells[ci] === Cell.FLOOR) whiteFloor++;
    }
  }

  assert.equal(whiteFloor > 0, true);
  assert.equal(gen.world.cellVersion > beforeVersion, true);
});

testBadAppleExperiment('bad apple placement searches past route-critical cells before stamping', () => {
  const world = new World();
  const centerX = 512;
  const centerY = 512;
  const hardCells: number[] = [];
  const offsets = [
    { x: 10, y: -Math.floor(BAD_APPLE_HEIGHT / 2) },
    { x: -BAD_APPLE_WIDTH - 10, y: -Math.floor(BAD_APPLE_HEIGHT / 2) },
    { x: -Math.floor(BAD_APPLE_WIDTH / 2), y: 10 },
    { x: -Math.floor(BAD_APPLE_WIDTH / 2), y: -BAD_APPLE_HEIGHT - 10 },
    { x: 36, y: -Math.floor(BAD_APPLE_HEIGHT / 2) },
    { x: -BAD_APPLE_WIDTH - 36, y: -Math.floor(BAD_APPLE_HEIGHT / 2) },
  ];
  for (const offset of offsets) {
    const idx = world.idx(centerX + offset.x + 5, centerY + offset.y + 5);
    world.cells[idx] = Cell.LIFT;
    world.features[idx] = Feature.LIFT_BUTTON;
    hardCells.push(idx);
  }

  const site = findBadAppleSiteNear(world, centerX, centerY);
  const placement = stampBadAppleWorld(world, site.x, site.y, { x: centerX, y: centerY });

  assert.equal(placement.roomId >= 0, true);
  for (const idx of hardCells) {
    assert.equal(world.cells[idx], Cell.LIFT);
    assert.equal(world.features[idx], Feature.LIFT_BUTTON);
  }
});

testBadAppleExperiment('bad apple projector toggles animation without breaking route reachability', () => {
  const base = makeProceduralFloorSpec(780, 3);
  const spec = {
    ...base,
    anomalyId: 'bad_apple_world' as const,
    danger: Math.max(3, base.danger) as typeof base.danger,
    title: `bad apple!: ${base.title}`,
  };
  const gen = timedProceduralSpec(spec, 'forced bad apple toggle seed=780');
  const room = gen.world.rooms.find(r => r.name.startsWith('Bad Apple!'));
  if (!room) throw new Error('Bad Apple room missing');
  const match = /\[bad_apple:-?\d+,-?\d+,\d+,\d+,\d+,(0|1),(-?\d+)\]/.exec(room.name);
  const projectorIdx = match ? Number(match[2]) : -1;
  assert.equal(projectorIdx >= 0, true);

  const state = makeGameState({ currentFloor: spec.baseFloor });
  const player = makeTestPlayer({
    id: 999999,
    x: projectorIdx % W + 0.5,
    y: ((projectorIdx / W) | 0) + 0.5,
    hp: 100,
    maxHp: 100,
    speed: 3,
  });
  const reachableBefore = reachabilityAudit(gen);
  assert.equal(hasReachableLift(gen, reachableBefore, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, reachableBefore, LiftDirection.DOWN), true);

  assert.equal(tryUseBadAppleWorldAnomaly(gen.world, player, state, player.x, player.y), true);
  const pausedVersion = gen.world.cellVersion;
  updateBadAppleWorldAnomaly(gen.world, player, state, 1);
  assert.equal(gen.world.cellVersion, pausedVersion);
  const reachablePaused = reachabilityAudit(gen);
  assert.equal(hasReachableLift(gen, reachablePaused, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, reachablePaused, LiftDirection.DOWN), true);

  assert.equal(tryUseBadAppleWorldAnomaly(gen.world, player, state, player.x, player.y), true);
  updateBadAppleWorldAnomaly(gen.world, player, state, 0.4);
  assert.equal(gen.world.cellVersion > pausedVersion, true);
  const reachableActive = reachabilityAudit(gen);
  assert.equal(hasReachableLift(gen, reachableActive, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, reachableActive, LiftDirection.DOWN), true);
});

testGenerationMatrix('zombie apocalypse anomaly seeds a dense crowd and patient zero infection', () => {
  const base = makeProceduralFloorSpec(779, -35);
  const spec = {
    ...base,
    anomalyId: 'zombie_apocalypse' as const,
    geometryId: 'apartment_pressure' as const,
    baseFloor: FloorLevel.KVARTIRY,
    danger: 5 as const,
    monsterBiasKinds: [MonsterKind.SHADOW],
    title: `зомби-апокалипсис: ${base.title}`,
  };
  const gen = timedProceduralSpec(spec, 'forced zombie apocalypse seed=779');
  const npcs = gen.entities.filter(e => e.type === EntityType.NPC);
  const actors = gen.entities.filter(e => e.type === EntityType.NPC || e.type === EntityType.MONSTER);
  const zombiesBeforeInfection = gen.entities.filter(e => e.type === EntityType.MONSTER && e.monsterKind === MonsterKind.ZOMBIE);
  const patientZero = gen.entities.find(e => e.type === EntityType.MONSTER && e.monsterKind === MonsterKind.ZOMBIE && e.name === 'Пациент зеро');
  const quarantineDoors = Array.from(gen.world.doors.values()).filter(door => (
    door.state === DoorState.HERMETIC_OPEN &&
    gen.world.wallTex[door.idx] === Tex.DOOR_METAL
  ));
  const quarantineWalls = gen.world.cells.reduce((count, cell, idx) => (
    count + (cell === Cell.WALL && gen.world.wallTex[idx] === Tex.METAL ? 1 : 0)
  ), 0);
  const medicalRooms = gen.world.rooms.filter(room => room.name.startsWith('Пункт карантинной медицины'));
  const medicalCounterplayContainers = gen.world.containers.filter(container => (
    container.kind === ContainerKind.MEDICAL_CABINET &&
    container.tags.includes('zombie_apocalypse') &&
    container.tags.includes('medical_counterplay')
  ));
  const routeCues = getRouteCueMarkers(gen.world);
  const budget = proceduralPopulationBudget({
    z: spec.z,
    danger: spec.danger,
    anomalyPressure: 2,
    industrial: false,
    npcAllowed: true,
    profileId: 'highDensity',
  });

  assert.equal(actors.length <= ACTIVE_ACTOR_SOFT_LIMIT, true);
  assert.equal(npcs.length >= budget.npcs - 16, true);
  assert.equal(npcs.length <= budget.npcs + 16, true);
  assert.equal(npcs.length >= 3000, true);
  assert.equal(maxEntitiesInArea(gen.entities, EntityType.NPC, 32) <= 20, true);
  assert.equal(npcs.every(e => e.ai), true);
  assert.equal(!!patientZero, true);
  assert.equal(gen.entities.some(e => e.type === EntityType.MONSTER && e.monsterKind === MonsterKind.SHADOW), false);
  assert.equal(zombiesBeforeInfection.length > 1, true);
  assert.equal(npcs.some(e => e.ai), true);
  assert.equal(quarantineDoors.length + quarantineWalls > 0, true);
  assert.equal(quarantineWalls > 0, true);
  assert.equal(medicalRooms.length >= 1, true);
  assert.equal(medicalCounterplayContainers.length >= 1, true);
  assert.equal(routeCues.some(marker => marker.tags.includes('quarantine_ring') && marker.tags.includes('infection_voronoi')), true);
  assert.equal(routeCues.some(marker => marker.tags.includes('medical_counterplay')), true);
  const audit = reachabilityAudit(gen);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  const state = makeGameState({ currentFloor: spec.baseFloor, time: 1 });
  setFloorRunState(state, {
    runSeed: 779,
    currentZ: spec.z,
    specs: { [spec.key]: spec },
    visited: {},
  }, spec.baseFloor);

  const target = npcs[0];
  const infected = tryZombieApocalypseInfection(gen.world, patientZero!, target, state, state.msgs, state.time);
  assert.equal(infected, true);
  assert.equal(target.type, EntityType.MONSTER);
  assert.equal(target.monsterKind, MonsterKind.ZOMBIE);
  assert.notEqual(target.monsterKind, MonsterKind.SHADOW);
  assert.equal(!!target.ai, true);

  const infectionCap = 96 + spec.danger * 64;
  let converted = 1;
  for (let i = 1; i < infectionCap; i++) {
    const candidate = npcs[i];
    assert.equal(tryZombieApocalypseInfection(gen.world, patientZero!, candidate, state, state.msgs, state.time + i * 0.01), true);
    converted++;
  }
  const cappedTarget = npcs[infectionCap];
  assert.equal(converted, infectionCap);
  assert.equal(tryZombieApocalypseInfection(gen.world, patientZero!, cappedTarget, state, state.msgs, state.time + 9), false);
  assert.equal(cappedTarget.type, EntityType.NPC);
  assert.equal(getRecentEvents(state, { tags: ['infection_cap'] }).length, 1);
});

test('storyFloorAtZ returns correct FloorLevel or undefined', () => {
  // Known story floors
  assert.equal(storyFloorAtZ(30), FloorLevel.MINISTRY);
  assert.equal(storyFloorAtZ(14), FloorLevel.KVARTIRY);
  assert.equal(storyFloorAtZ(0), FloorLevel.LIVING);
  assert.equal(storyFloorAtZ(-26), FloorLevel.MAINTENANCE);
  assert.equal(storyFloorAtZ(-36), FloorLevel.HELL);
  assert.equal(storyFloorAtZ(FLOOR_RUN_VOID_Z), FloorLevel.VOID);

  // Z values that are not story floors
  assert.equal(storyFloorAtZ(100), undefined);
  assert.equal(storyFloorAtZ(1), undefined);
  assert.equal(storyFloorAtZ(-1), undefined);
  assert.equal(storyFloorAtZ(-51), undefined);
});
