import { Cell, Feature, FloorLevel, RoomType, W, type Room } from '../core/types';
import { World } from '../core/world';
import type { DesignFloorRouteDef } from '../data/design_floors';
import {
  INTERACTIVE_SURFACE_FLAG_CRAFT_LAB_BENCH,
  INTERACTIVE_SURFACE_FLAG_CRAFT_LATHE,
  INTERACTIVE_SURFACE_FLAG_DISASSEMBLY_WORKBENCH,
  INTERACTIVE_SURFACE_FLAG_RECIPE_BILLBOARD,
} from '../data/interactive';
import {
  CRAFT_LAB_BENCH_ID,
  CRAFT_LATHE_ID,
  CRAFT_STATION_CAPS,
  CRAFT_STATION_IDS,
  DISASSEMBLY_WORKBENCH_ID,
  RECIPE_BILLBOARD_ID,
  craftStationProfileForDesignFloor,
  craftStationProfileForProceduralFloor,
  craftStationProfileForStoryFloor,
  type CraftStationDefId,
  type CraftStationPlacementProfile,
} from '../data/craft_station_placement';
import type { ProceduralFloorSpec } from '../data/procedural_floors';
import type { InteractiveInstance } from '../systems/interactive';
import { placeInteractiveAt } from './interactive_placement';
import { isConnectivityWalkable } from './shared';

export {
  CRAFT_LAB_BENCH_ID,
  CRAFT_LATHE_ID,
  CRAFT_STATION_CAPS,
  CRAFT_STATION_IDS,
  DISASSEMBLY_WORKBENCH_ID,
  RECIPE_BILLBOARD_ID,
  type CraftStationDefId,
} from '../data/craft_station_placement';

interface CraftStationSpec {
  feature: Feature;
  surfaceFlag: number;
  weights: Partial<Record<RoomType, number>>;
}

const STATION_SPECS: Record<CraftStationDefId, CraftStationSpec> = {
  [CRAFT_LATHE_ID]: {
    feature: Feature.MACHINE,
    surfaceFlag: INTERACTIVE_SURFACE_FLAG_CRAFT_LATHE,
    weights: {
      [RoomType.PRODUCTION]: 9,
      [RoomType.STORAGE]: 5,
      [RoomType.MEDICAL]: 1,
      [RoomType.OFFICE]: 1,
      [RoomType.COMMON]: 1,
      [RoomType.HQ]: 5,
    },
  },
  [DISASSEMBLY_WORKBENCH_ID]: {
    feature: Feature.TABLE,
    surfaceFlag: INTERACTIVE_SURFACE_FLAG_DISASSEMBLY_WORKBENCH,
    weights: {
      [RoomType.PRODUCTION]: 9,
      [RoomType.STORAGE]: 9,
      [RoomType.MEDICAL]: 1,
      [RoomType.OFFICE]: 1,
      [RoomType.COMMON]: 5,
      [RoomType.HQ]: 5,
    },
  },
  [CRAFT_LAB_BENCH_ID]: {
    feature: Feature.APPARATUS,
    surfaceFlag: INTERACTIVE_SURFACE_FLAG_CRAFT_LAB_BENCH,
    weights: {
      [RoomType.PRODUCTION]: 1,
      [RoomType.STORAGE]: 1,
      [RoomType.MEDICAL]: 9,
      [RoomType.OFFICE]: 1,
      [RoomType.HQ]: 5,
    },
  },
  [RECIPE_BILLBOARD_ID]: {
    feature: Feature.SCREEN,
    surfaceFlag: INTERACTIVE_SURFACE_FLAG_RECIPE_BILLBOARD,
    weights: {
      [RoomType.PRODUCTION]: 5,
      [RoomType.STORAGE]: 2,
      [RoomType.MEDICAL]: 5,
      [RoomType.OFFICE]: 9,
      [RoomType.COMMON]: 5,
      [RoomType.HQ]: 9,
    },
  },
};

export interface CraftStationPlacementOptions {
  seed?: number;
  tags?: readonly string[];
  reachable?: Uint8Array;
  allowProtectedExistingFeature?: boolean;
}

export interface CraftStationPlacementSummary {
  placed: number;
  cap: number;
  cells: number[];
  byId: Record<CraftStationDefId, number>;
}

interface Candidate {
  defId: CraftStationDefId;
  room: Room;
  idx: number;
  x: number;
  y: number;
  score: number;
}

const EMPTY_SUMMARY_COUNTS = (): Record<CraftStationDefId, number> => ({
  [CRAFT_LATHE_ID]: 0,
  [DISASSEMBLY_WORKBENCH_ID]: 0,
  [CRAFT_LAB_BENCH_ID]: 0,
  [RECIPE_BILLBOARD_ID]: 0,
});

function hash32(seed: number, a: number, b = 0, c = 0): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (a + 0x85ebca6b), 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ (b + 0x27d4eb2d), 0x165667b1) >>> 0;
  h = Math.imul(h ^ (c + 0xd3a2646c), 0x9e3779b1) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

function stationProfileWeight(defId: CraftStationDefId, profile?: CraftStationPlacementProfile): number {
  if (!profile) return 1;
  return Math.max(0, profile.stationWeights[defId] ?? 0);
}

function profileStationIds(profile?: CraftStationPlacementProfile): readonly CraftStationDefId[] {
  if (!profile) return CRAFT_STATION_IDS;
  return CRAFT_STATION_IDS.filter(defId => stationProfileWeight(defId, profile) > 0);
}

function roomWeight(defId: CraftStationDefId, room: Room, profile?: CraftStationPlacementProfile): number {
  const base = STATION_SPECS[defId].weights[room.type] ?? 0;
  if (base <= 0) return 0;
  const stationWeight = stationProfileWeight(defId, profile);
  if (stationWeight <= 0) return 0;
  const roomTypeWeight = profile?.roomTypeWeights?.[room.type] ?? 1;
  return base * stationWeight * roomTypeWeight;
}

export function craftStationFeature(defId: CraftStationDefId): Feature {
  return STATION_SPECS[defId].feature;
}

export function craftStationSurfaceFlag(defId: CraftStationDefId): number {
  return STATION_SPECS[defId].surfaceFlag;
}

function stationCellValid(
  world: World,
  idx: number,
  defId: CraftStationDefId,
  options: CraftStationPlacementOptions,
): boolean {
  const spec = STATION_SPECS[defId];
  if (world.cells[idx] !== Cell.FLOOR) return false;
  if (world.hermoWall[idx] || world.doors.has(idx) || world.containerMap.has(idx)) return false;
  if (options.reachable && !options.reachable[idx]) return false;

  const feature = world.features[idx] as Feature;
  if (feature !== Feature.NONE && feature !== spec.feature) return false;
  if (world.aptMask[idx] && !(options.allowProtectedExistingFeature && feature === spec.feature)) return false;
  return true;
}

export function canPlaceCraftStationAt(
  world: World,
  x: number,
  y: number,
  defId: CraftStationDefId,
  options: CraftStationPlacementOptions = {},
): boolean {
  return stationCellValid(world, world.idx(x, y), defId, options);
}

function attachStationInteractive(
  world: World,
  x: number,
  y: number,
  defId: CraftStationDefId,
  options: CraftStationPlacementOptions,
): InteractiveInstance | null {
  if (defId === CRAFT_LATHE_ID) {
    return placeInteractiveAt(world, x, y, 'craft_lathe', { seed: options.seed, tags: options.tags });
  }
  if (defId === DISASSEMBLY_WORKBENCH_ID) {
    return placeInteractiveAt(world, x, y, 'disassembly_workbench', { seed: options.seed, tags: options.tags });
  }
  if (defId === CRAFT_LAB_BENCH_ID) {
    return placeInteractiveAt(world, x, y, 'craft_lab_bench', { seed: options.seed, tags: options.tags });
  }
  return placeInteractiveAt(world, x, y, 'recipe_billboard', { seed: options.seed, tags: options.tags });
}

export function placeCraftStationAt(
  world: World,
  x: number,
  y: number,
  defId: CraftStationDefId,
  options: CraftStationPlacementOptions = {},
): InteractiveInstance | null {
  const wx = world.wrap(x);
  const wy = world.wrap(y);
  const idx = world.idx(wx, wy);
  if (!stationCellValid(world, idx, defId, options)) return null;

  const spec = STATION_SPECS[defId];
  const oldFeature = world.features[idx] as Feature;
  const oldFlags = world.surfaceFlags[idx];
  if (oldFeature !== spec.feature) world.setFeatureAt(idx, spec.feature);
  const nextFlags = oldFlags | spec.surfaceFlag;
  if (nextFlags !== oldFlags) {
    world.surfaceFlags[idx] = nextFlags;
    world.markSurfaceDirty();
  }

  const placed = attachStationInteractive(world, wx, wy, defId, {
    ...options,
    seed: options.seed ?? hash32(idx, spec.surfaceFlag, world.roomMap[idx]),
  });
  if (!placed) {
    if (oldFeature !== spec.feature) world.setFeatureAt(idx, oldFeature);
    if (world.surfaceFlags[idx] !== oldFlags) {
      world.surfaceFlags[idx] = oldFlags;
      world.markSurfaceDirty();
    }
    return null;
  }
  return placed;
}

function reachableFrom(world: World, spawnX: number, spawnY: number): Uint8Array {
  const reachable = new Uint8Array(W * W);
  const start = world.idx(Math.floor(spawnX), Math.floor(spawnY));
  if (!isConnectivityWalkable(world, start)) return reachable;
  const queue = new Int32Array(W * W);
  let head = 0;
  let tail = 0;
  reachable[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const ci = queue[head++];
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = world.idx(x + dx, y + dy);
      if (reachable[ni] || !isConnectivityWalkable(world, ni)) continue;
      reachable[ni] = 1;
      queue[tail++] = ni;
    }
  }
  return reachable;
}

function candidateForRoom(
  world: World,
  room: Room,
  defId: CraftStationDefId,
  seed: number,
  usedCells: Set<number>,
  usedRooms: Set<number>,
  options: CraftStationPlacementOptions,
  profile?: CraftStationPlacementProfile,
): Candidate | null {
  if (!room || room.sealed || room.w < 4 || room.h < 4 || usedRooms.has(room.id)) return null;
  const weight = roomWeight(defId, room, profile);
  if (weight <= 0) return null;

  const innerW = Math.max(1, room.w - 2);
  const innerH = Math.max(1, room.h - 2);
  const attempts = Math.min(32, Math.max(8, Math.ceil((innerW * innerH) / 5)));
  let best: Candidate | null = null;
  const seen = new Set<number>();
  for (let n = 0; n < attempts; n++) {
    const h = hash32(seed, room.id, n, craftStationSurfaceFlag(defId));
    const x = world.wrap(room.x + 1 + (h % innerW));
    const y = world.wrap(room.y + 1 + (((h >>> 8) + n * 7) % innerH));
    const idx = world.idx(x, y);
    if (seen.has(idx) || usedCells.has(idx)) continue;
    seen.add(idx);
    if (!stationCellValid(world, idx, defId, options)) continue;

    const matchingFeatureBonus = world.features[idx] === craftStationFeature(defId) ? 600_000 : 0;
    const edgePenalty = Math.min(
      (x - room.x + W) % W,
      (room.x + room.w - 1 - x + W) % W,
      (y - room.y + W) % W,
      (room.y + room.h - 1 - y + W) % W,
    ) <= 0 ? 20_000 : 0;
    const score = weight * 1_000_000 + matchingFeatureBonus - edgePenalty + (h & 0xffff);
    if (!best || score > best.score) best = { defId, room, idx, x, y, score };
  }
  return best;
}

function chooseCandidate(
  world: World,
  rooms: readonly Room[],
  seed: number,
  usedCells: Set<number>,
  usedRooms: Set<number>,
  options: CraftStationPlacementOptions,
  profile?: CraftStationPlacementProfile,
  fixedDefId?: CraftStationDefId,
): Candidate | null {
  let best: Candidate | null = null;
  const stationIds = fixedDefId ? [fixedDefId] : profileStationIds(profile);
  for (const room of rooms) {
    for (const defId of stationIds) {
      const candidate = candidateForRoom(world, room, defId, seed, usedCells, usedRooms, options, profile);
      if (!candidate) continue;
      if (!best || candidate.score > best.score) best = candidate;
    }
  }
  return best;
}

function placeWeightedCraftStations(
  world: World,
  rooms: readonly Room[],
  cap: number,
  options: CraftStationPlacementOptions = {},
  profile?: CraftStationPlacementProfile,
): CraftStationPlacementSummary {
  const summary: CraftStationPlacementSummary = {
    placed: 0,
    cap,
    cells: [],
    byId: EMPTY_SUMMARY_COUNTS(),
  };
  if (cap <= 0 || rooms.length === 0) return summary;

  const usedCells = new Set<number>();
  const usedRooms = new Set<number>();
  const seed = options.seed ?? hash32(rooms.length, cap, world.rooms.length);
  const placementOptions = { ...options, seed };
  for (const defId of profileStationIds(profile)) {
    const required = Math.max(0, Math.floor(profile?.requiredById?.[defId] ?? 0));
    for (let i = 0; i < required && summary.placed < cap; i++) {
      const candidate = chooseCandidate(
        world,
        rooms,
        seed + summary.placed * 101 + i * 37,
        usedCells,
        usedRooms,
        placementOptions,
        profile,
        defId,
      );
      if (!candidate) break;
      const placed = placeCraftStationAt(world, candidate.x, candidate.y, candidate.defId, {
        ...placementOptions,
        seed: hash32(seed, candidate.idx, candidate.room.id, craftStationSurfaceFlag(candidate.defId)),
        tags: ['craft_station', 'required', ...(profile?.tags ?? []), ...(options.tags ?? [])],
      });
      usedCells.add(candidate.idx);
      usedRooms.add(candidate.room.id);
      if (!placed) continue;
      summary.placed++;
      summary.cells.push(candidate.idx);
      summary.byId[candidate.defId]++;
    }
  }
  while (summary.placed < cap) {
    const candidate = chooseCandidate(world, rooms, seed + summary.placed * 101, usedCells, usedRooms, placementOptions, profile);
    if (!candidate) break;
    const placed = placeCraftStationAt(world, candidate.x, candidate.y, candidate.defId, {
      ...placementOptions,
      seed: hash32(seed, candidate.idx, candidate.room.id, craftStationSurfaceFlag(candidate.defId)),
      tags: ['craft_station', 'weighted', ...(profile?.tags ?? []), ...(options.tags ?? [])],
    });
    usedCells.add(candidate.idx);
    usedRooms.add(candidate.room.id);
    if (!placed) continue;
    summary.placed++;
    summary.cells.push(candidate.idx);
    summary.byId[candidate.defId]++;
  }
  return summary;
}

function emptyCraftStationPlacementSummary(cap = 0): CraftStationPlacementSummary {
  return {
    placed: 0,
    cap,
    cells: [],
    byId: EMPTY_SUMMARY_COUNTS(),
  };
}

function requiredStationCount(profile: CraftStationPlacementProfile): number {
  let total = 0;
  for (const defId of CRAFT_STATION_IDS) total += Math.max(0, Math.floor(profile.requiredById?.[defId] ?? 0));
  return total;
}

function placementTarget(profile: CraftStationPlacementProfile, roomCount: number): number {
  const cap = Math.max(0, Math.floor(profile.max));
  if (cap <= 0 || roomCount <= 0) return 0;
  const divisor = Math.max(1, Math.floor(profile.roomDivisor));
  const byRooms = Math.floor(roomCount / divisor);
  const min = Math.max(0, Math.floor(profile.min));
  return Math.min(cap, Math.max(min, requiredStationCount(profile), byRooms));
}

function eligibleCraftStationRooms(
  rooms: readonly Room[],
  profile: CraftStationPlacementProfile,
  excludeCorridors: boolean,
): Room[] {
  return rooms.filter(room =>
    room &&
    !room.sealed &&
    room.apartmentId < 0 &&
    (!excludeCorridors || room.type !== RoomType.CORRIDOR) &&
    room.w >= 4 &&
    room.h >= 4 &&
    profileStationIds(profile).some(defId => roomWeight(defId, room, profile) > 0),
  );
}

export function placeCraftStationsWithProfile(
  world: World,
  rooms: readonly Room[],
  spawnX: number,
  spawnY: number,
  profile: CraftStationPlacementProfile | undefined,
  options: CraftStationPlacementOptions & { excludeCorridors?: boolean } = {},
): CraftStationPlacementSummary {
  if (!profile) return emptyCraftStationPlacementSummary();
  const reachable = options.reachable ?? reachableFrom(world, spawnX, spawnY);
  const eligibleRooms = eligibleCraftStationRooms(rooms, profile, options.excludeCorridors ?? false);
  const target = placementTarget(profile, eligibleRooms.length);
  return placeWeightedCraftStations(world, eligibleRooms, target, {
    ...options,
    reachable,
    seed: options.seed ?? hash32(spawnX | 0, spawnY | 0, target),
  }, profile);
}

export function placeLivingCraftStationPair(world: World, room: Room): CraftStationPlacementSummary {
  const summary: CraftStationPlacementSummary = {
    placed: 0,
    cap: CRAFT_STATION_CAPS.livingFixed,
    cells: [],
    byId: EMPTY_SUMMARY_COUNTS(),
  };
  const fixed = [
    { defId: DISASSEMBLY_WORKBENCH_ID, dx: 3, dy: 4 },
    { defId: CRAFT_LATHE_ID, dx: room.w - 5, dy: 4 },
  ] as const;
  for (const station of fixed) {
    const x = world.wrap(room.x + station.dx);
    const y = world.wrap(room.y + station.dy);
    const placed = placeCraftStationAt(world, x, y, station.defId, {
      allowProtectedExistingFeature: true,
      seed: hash32(room.id, station.dx, station.dy, craftStationSurfaceFlag(station.defId)),
      tags: ['craft_station', 'living_fixed', 'expedition_prep'],
    });
    if (!placed) continue;
    summary.placed++;
    summary.cells.push(world.idx(x, y));
    summary.byId[station.defId]++;
  }
  return summary;
}

export const placeLivingExpeditionCraftStations = placeLivingCraftStationPair;

export function placeCraftStationsForStoryFloor(
  world: World,
  spawnX: number,
  spawnY: number,
  floor: FloorLevel,
  options: { seed?: number } = {},
): CraftStationPlacementSummary {
  const profile = craftStationProfileForStoryFloor(floor);
  return placeCraftStationsWithProfile(world, world.rooms, spawnX, spawnY, profile, {
    seed: options.seed ?? hash32(floor, world.rooms.length, 0),
  });
}

export function placeMaintenanceCraftStations(
  world: World,
  rooms: readonly Room[],
  spawnX: number,
  spawnY: number,
): CraftStationPlacementSummary {
  const profile = craftStationProfileForStoryFloor(FloorLevel.MAINTENANCE);
  return placeCraftStationsWithProfile(world, rooms, spawnX, spawnY, profile, {
    seed: hash32(FloorLevel.MAINTENANCE, rooms.length, Math.floor(spawnX), Math.floor(spawnY)),
  });
}

export function proceduralCraftStationCap(spec: ProceduralFloorSpec, roomCount: number): number {
  const profile = craftStationProfileForProceduralFloor(spec);
  return profile ? placementTarget(profile, roomCount) : 0;
}

export function placeProceduralCraftStations(
  world: World,
  rooms: readonly Room[],
  spec: ProceduralFloorSpec,
  reachableInput: Uint8Array | { reachable: Uint8Array },
): CraftStationPlacementSummary {
  const reachable = reachableInput instanceof Uint8Array ? reachableInput : reachableInput.reachable;
  const profile = craftStationProfileForProceduralFloor(spec);
  return placeCraftStationsWithProfile(world, rooms, 0, 0, profile, {
    seed: hash32(spec.seed, spec.z, spec.danger, rooms.length),
    reachable,
    excludeCorridors: true,
  });
}

export function placeDesignFloorCraftStations(
  world: World,
  spawnX: number,
  spawnY: number,
  route: DesignFloorRouteDef,
): CraftStationPlacementSummary {
  const profile = craftStationProfileForDesignFloor(route);
  return placeCraftStationsWithProfile(world, world.rooms, spawnX, spawnY, profile, {
    seed: hash32(route.z, world.rooms.length, route.danger),
    excludeCorridors: true,
  });
}

export function craftStationCells(world: World, defId?: CraftStationDefId): number[] {
  const out: number[] = [];
  for (let i = 0; i < world.surfaceFlags.length; i++) {
    if (defId) {
      if ((world.surfaceFlags[i] & craftStationSurfaceFlag(defId)) !== 0 && world.features[i] === craftStationFeature(defId)) {
        out.push(i);
      }
      continue;
    }
    if (CRAFT_STATION_IDS.some(id => (world.surfaceFlags[i] & craftStationSurfaceFlag(id)) !== 0 && world.features[i] === craftStationFeature(id))) {
      out.push(i);
    }
  }
  return out;
}
