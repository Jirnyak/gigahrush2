import { Cell, Feature, FloorLevel, RoomType, Tex, W, type Room } from '../core/types';
import { World } from '../core/world';
import type { DesignFloorRouteDef } from '../data/design_floors';
import {
  floorObjectProfileForDesignFloor,
  floorObjectProfileForProceduralFloor,
  floorObjectProfileForStoryFloor,
  type BrokenFixturePlacementRule,
  type FeaturePlacementRule,
  type FloorObjectPlacementDensity,
  type FloorObjectPlacementProfile,
  type InteractivePlacementRule,
  type RoomTextureRule,
  type RoomWeightedPlacementRule,
  type WallDecorPlacementRule,
} from '../data/floor_object_placement';
import type { ProceduralFloorSpec } from '../data/procedural_floors';
import type { CraftStationPlacementSummary } from './craft_stations';
import { placeCraftStationsWithProfile } from './craft_stations';
import { maybePlaceBrokenFixture } from './interactive_fixtures';
import { placeInteractiveAt } from './interactive_placement';
import { isConnectivityWalkable } from './shared';
import {
  fillVisualSlotsForRoomDecor,
  fillVisualSlotsFromFeature,
  type VisualSlotRoomDecorSummary,
} from './visual_cell_slots';

interface ObjectCandidate {
  room: Room;
  idx: number;
  x: number;
  y: number;
  score: number;
}

export interface FloorObjectPlacementSummary {
  profileId: string;
  roomTextures: Record<string, number>;
  wallDecor: Record<string, number>;
  features: Record<string, number>;
  interactives: Record<string, number>;
  brokenFixtures: Record<string, number>;
  visualSlotDecor?: VisualSlotRoomDecorSummary;
  craftStations?: CraftStationPlacementSummary;
}

const DIRS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const SCREEN_FRAMES = 4;

function hash32(seed: number, a: number, b = 0, c = 0): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (a + 0x85ebca6b), 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ (b + 0x27d4eb2d), 0x165667b1) >>> 0;
  h = Math.imul(h ^ (c + 0xd3a2646c), 0x9e3779b1) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
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

function placementTarget(rule: RoomWeightedPlacementRule, roomCount: number, remainingCap?: number): number {
  const cap = Math.max(0, Math.floor(Math.min(rule.max, remainingCap ?? rule.max)));
  if (cap <= 0 || roomCount <= 0) return 0;
  const divisor = Math.max(1, Math.floor(rule.roomDivisor));
  const byRooms = Math.floor(roomCount / divisor);
  return Math.min(cap, Math.max(0, Math.min(cap, Math.floor(rule.min)), byRooms));
}

function remainingDensityCap(limit: number | undefined, used: number): number | undefined {
  return limit === undefined ? undefined : Math.max(0, Math.floor(limit) - used);
}

function ruleRoomWeight(rule: RoomWeightedPlacementRule, room: Room): number {
  return Math.max(0, rule.roomTypeWeights[room.type] ?? 0);
}

function eligibleRooms(rooms: readonly Room[], rule: RoomWeightedPlacementRule): Room[] {
  return rooms.filter(room =>
    room &&
    !room.sealed &&
    room.apartmentId < 0 &&
    room.type !== RoomType.CORRIDOR &&
    room.w >= 4 &&
    room.h >= 4 &&
    ruleRoomWeight(rule, room) > 0,
  );
}

function isPlainWallTexture(tex: number): boolean {
  return tex === Tex.CONCRETE ||
    tex === Tex.BRICK ||
    tex === Tex.PANEL ||
    tex === Tex.TILE_W ||
    tex === Tex.METAL ||
    tex === Tex.ROTTEN ||
    tex === Tex.DARK ||
    tex === Tex.PIPE ||
    tex === Tex.MEAT ||
    tex === Tex.GUT ||
    tex === Tex.VOID_WALL ||
    tex === Tex.MARBLE;
}

function isPlainFloorTexture(tex: number): boolean {
  return tex === Tex.CONCRETE ||
    tex === Tex.F_CONCRETE ||
    tex === Tex.F_LINO ||
    tex === Tex.F_TILE ||
    tex === Tex.F_WOOD ||
    tex === Tex.F_CARPET ||
    tex === Tex.F_WATER ||
    tex === Tex.F_MEAT ||
    tex === Tex.F_GUT ||
    tex === Tex.F_VOID ||
    tex === Tex.F_RED_CARPET ||
    tex === Tex.F_GREEN_CARPET ||
    tex === Tex.F_MARBLE_TILE ||
    tex === Tex.F_PARQUET ||
    (tex >= Tex.F_CARPET_EDGE_BASE && tex < Tex.SCREEN_BASE);
}

function isDoorNear(world: World, x: number, y: number): boolean {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.cells[ci] === Cell.DOOR || world.doors.has(ci)) return true;
    }
  }
  return false;
}

function wallFacesRoom(world: World, x: number, y: number, room: Room): boolean {
  for (const [dx, dy] of DIRS) {
    const ni = world.idx(x + dx, y + dy);
    if (world.roomMap[ni] === room.id && (world.cells[ni] === Cell.FLOOR || world.cells[ni] === Cell.WATER)) return true;
  }
  return false;
}

function wallCellValidForDecor(world: World, room: Room, idx: number, allowSpecialReplace = false): boolean {
  if (world.cells[idx] !== Cell.WALL) return false;
  if (world.hermoWall[idx] || world.aptMask[idx] || world.doors.has(idx) || world.containerMap.has(idx)) return false;
  if (world.features[idx] !== Feature.NONE) return false;
  if (!allowSpecialReplace && !isPlainWallTexture(world.wallTex[idx])) return false;
  const x = idx % W;
  const y = (idx / W) | 0;
  if (!wallFacesRoom(world, x, y, room)) return false;
  return !isDoorNear(world, x, y);
}

function collectRoomWallCells(world: World, room: Room, allowSpecialReplace = false): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const idx = world.idx(x, y);
      if (seen.has(idx)) continue;
      seen.add(idx);
      if (wallCellValidForDecor(world, room, idx, allowSpecialReplace)) out.push(idx);
    }
  }
  return out;
}

function roomTextureCellAllowed(world: World, idx: number, allowSpecialReplace = false): boolean {
  if (world.hermoWall[idx] || world.aptMask[idx] || world.doors.has(idx) || world.containerMap.has(idx)) return false;
  if (world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.DOOR || world.cells[idx] === Cell.ABYSS) return false;
  if (world.features[idx] === Feature.SLIDE || world.features[idx] === Feature.SCREEN) return false;
  if (world.cells[idx] === Cell.WALL) return allowSpecialReplace || isPlainWallTexture(world.wallTex[idx]);
  return allowSpecialReplace || isPlainFloorTexture(world.floorTex[idx]);
}

function selectRoomsForRule(rooms: readonly Room[], rule: RoomWeightedPlacementRule, target: number, seed: number): Room[] {
  if (target <= 0) return [];
  return rooms
    .map(room => ({ room, score: ruleRoomWeight(rule, room) * 1_000_000 + (hash32(seed, room.id, rule.id.length) & 0xffff) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, target)
    .map(entry => entry.room);
}

function applyRoomTextureRule(world: World, rooms: readonly Room[], rule: RoomTextureRule, seed: number, remainingCap?: number): number {
  if (rule.wallTex === undefined && rule.floorTex === undefined) return 0;
  const eligible = eligibleRooms(rooms, rule);
  const target = placementTarget(rule, eligible.length, remainingCap);
  let changedRooms = 0;
  let changedWalls = 0;
  let changedFloors = 0;
  for (const room of selectRoomsForRule(eligible, rule, target, seed)) {
    let roomChanged = false;
    if (rule.floorTex !== undefined) {
      for (let y = room.y; y < room.y + room.h; y++) {
        for (let x = room.x; x < room.x + room.w; x++) {
          const idx = world.idx(x, y);
          if (world.roomMap[idx] !== room.id || !roomTextureCellAllowed(world, idx, rule.allowSpecialReplace)) continue;
          if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) continue;
          if (world.floorTex[idx] === rule.floorTex) continue;
          world.floorTex[idx] = rule.floorTex;
          changedFloors++;
          roomChanged = true;
        }
      }
      if (room.floorTex !== rule.floorTex) {
        room.floorTex = rule.floorTex;
        roomChanged = true;
      }
    }
    if (rule.wallTex !== undefined) {
      for (const idx of collectRoomWallCells(world, room, rule.allowSpecialReplace)) {
        if (!roomTextureCellAllowed(world, idx, rule.allowSpecialReplace) || world.wallTex[idx] === rule.wallTex) continue;
        world.wallTex[idx] = rule.wallTex;
        changedWalls++;
        roomChanged = true;
      }
      if (room.wallTex !== rule.wallTex) {
        room.wallTex = rule.wallTex;
        roomChanged = true;
      }
    }
    if (roomChanged) changedRooms++;
  }
  if (changedWalls > 0) world.markWallTexDirty();
  if (changedFloors > 0) world.markFloorTexDirty();
  return changedRooms;
}

function featureCellValid(
  world: World,
  room: Room,
  idx: number,
  reachable: Uint8Array,
  rule: FeaturePlacementRule | InteractivePlacementRule,
): boolean {
  if (world.roomMap[idx] !== room.id) return false;
  if (world.hermoWall[idx] || world.aptMask[idx] || world.doors.has(idx) || world.containerMap.has(idx)) return false;
  if (world.surfaceFlags[idx] !== 0 || !reachable[idx]) return false;
  if (world.features[idx] !== Feature.NONE) return false;
  if (world.cells[idx] === Cell.FLOOR) return true;
  return rule.kind === 'feature' && !!rule.allowWater && world.cells[idx] === Cell.WATER;
}

function candidatesForRoom(
  world: World,
  room: Room,
  rule: FeaturePlacementRule | InteractivePlacementRule,
  seed: number,
  reachable: Uint8Array,
): ObjectCandidate[] {
  const weight = ruleRoomWeight(rule, room);
  if (weight <= 0) return [];
  const innerW = Math.max(1, room.w - 2);
  const innerH = Math.max(1, room.h - 2);
  const attempts = Math.min(48, Math.max(8, Math.ceil((innerW * innerH) / 4)));
  const candidates: ObjectCandidate[] = [];
  const seen = new Set<number>();
  for (let n = 0; n < attempts; n++) {
    const h = hash32(seed, room.id, n, rule.id.length);
    const x = world.wrap(room.x + 1 + (h % innerW));
    const y = world.wrap(room.y + 1 + (((h >>> 8) + n * 7) % innerH));
    const idx = world.idx(x, y);
    if (seen.has(idx)) continue;
    seen.add(idx);
    if (!featureCellValid(world, room, idx, reachable, rule)) continue;
    const edgePenalty = Math.min(
      (x - room.x + W) % W,
      (room.x + room.w - 1 - x + W) % W,
      (y - room.y + W) % W,
      (room.y + room.h - 1 - y + W) % W,
    ) <= 0 ? 20_000 : 0;
    const score = weight * 1_000_000 - edgePenalty + (h & 0xffff);
    candidates.push({ room, idx, x, y, score });
  }
  return candidates;
}

function sortedPlacementCandidates(
  world: World,
  rooms: readonly Room[],
  rule: FeaturePlacementRule | InteractivePlacementRule,
  seed: number,
  reachable: Uint8Array,
): ObjectCandidate[] {
  const candidates: ObjectCandidate[] = [];
  for (const room of rooms) {
    candidates.push(...candidatesForRoom(world, room, rule, seed, reachable));
  }
  return candidates.sort((a, b) => b.score - a.score);
}

function placeFeatureRule(
  world: World,
  rooms: readonly Room[],
  rule: FeaturePlacementRule,
  seed: number,
  reachable: Uint8Array,
  remainingCap?: number,
): number {
  const eligible = eligibleRooms(rooms, rule);
  const target = placementTarget(rule, eligible.length, remainingCap);
  const usedCells = new Set<number>();
  const candidates = sortedPlacementCandidates(world, eligible, rule, seed, reachable);
  let placed = 0;
  for (const candidate of candidates) {
    if (placed >= target) break;
    if (usedCells.has(candidate.idx)) continue;
    usedCells.add(candidate.idx);
    if (!featureCellValid(world, candidate.room, candidate.idx, reachable, rule)) continue;
    if (!world.setFeatureAt(candidate.idx, rule.feature)) continue;
    fillVisualSlotsFromFeature(world, candidate.idx, seed);
    placed++;
  }
  return placed;
}

function placeInteractiveRule(
  world: World,
  rooms: readonly Room[],
  rule: InteractivePlacementRule,
  seed: number,
  reachable: Uint8Array,
  remainingCap?: number,
): number {
  const eligible = eligibleRooms(rooms, rule);
  const target = placementTarget(rule, eligible.length, remainingCap);
  const usedCells = new Set<number>();
  const candidates = sortedPlacementCandidates(world, eligible, rule, seed, reachable);
  let placed = 0;
  for (const candidate of candidates) {
    if (placed >= target) break;
    if (usedCells.has(candidate.idx)) continue;
    usedCells.add(candidate.idx);
    if (!featureCellValid(world, candidate.room, candidate.idx, reachable, rule)) continue;
    const instance = placeInteractiveAt(world, candidate.x, candidate.y, rule.defId, {
      forceFeature: rule.forceFeature,
      seed: hash32(seed, candidate.idx, candidate.room.id),
      tags: ['floor_object_profile', rule.id, ...(rule.tags ?? [])],
    });
    if (!instance) continue;
    placed++;
  }
  return placed;
}

function fixtureCellAllowed(world: World, room: Room, idx: number, rule: BrokenFixturePlacementRule, reachable: Uint8Array): boolean {
  if (!reachable[idx] || world.roomMap[idx] !== room.id) return false;
  if (world.hermoWall[idx] || world.doors.has(idx)) return false;
  if (!rule.features.includes(world.features[idx] as Feature)) return false;
  const roomWeight = rule.roomTypeWeights?.[room.type] ?? 1;
  return roomWeight > 0;
}

function brokenFixtureDefId(feature: Feature): string | undefined {
  if (feature === Feature.SINK) return 'sink_broken';
  if (feature === Feature.TOILET) return 'toilet_broken';
  return undefined;
}

function sortedBrokenFixtureCandidates(
  world: World,
  rooms: readonly Room[],
  rule: BrokenFixturePlacementRule,
  seed: number,
  reachable: Uint8Array,
): ObjectCandidate[] {
  const candidates: ObjectCandidate[] = [];
  for (const room of rooms) {
    if (!room || room.sealed || room.w < 3 || room.h < 3) continue;
    const roomWeight = rule.roomTypeWeights?.[room.type] ?? 1;
    if (roomWeight <= 0) continue;
    for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
      for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
        const idx = world.idx(x, y);
        if (!fixtureCellAllowed(world, room, idx, rule, reachable)) continue;
        const h = hash32(seed, idx, room.id, rule.id.length);
        candidates.push({ room, idx, x: idx % W, y: (idx / W) | 0, score: roomWeight * 1_000_000 + (h & 0xffff) });
      }
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

function placeBrokenFixtureRule(
  world: World,
  rooms: readonly Room[],
  rule: BrokenFixturePlacementRule,
  seed: number,
  reachable: Uint8Array,
  remainingCap?: number,
): number {
  let placed = 0;
  const max = Math.max(0, Math.floor(Math.min(rule.max, remainingCap ?? rule.max)));
  if (max <= 0) return 0;
  const candidates = sortedBrokenFixtureCandidates(world, rooms, rule, seed, reachable);
  for (const candidate of candidates) {
    if (placed >= max) break;
    if (!fixtureCellAllowed(world, candidate.room, candidate.idx, rule, reachable)) continue;
    const roomWeight = rule.roomTypeWeights?.[candidate.room.type] ?? 1;
    const baseChance = Math.max(0, Math.min(1, rule.baseChance * roomWeight));
    const guaranteedDefId = baseChance >= 1 ? brokenFixtureDefId(world.features[candidate.idx] as Feature) : undefined;
    const fixturePlaced = baseChance >= 1
      ? !!guaranteedDefId && !!placeInteractiveAt(world, candidate.x, candidate.y, guaranteedDefId, {
        seed: hash32(seed, candidate.idx, candidate.room.id),
        tags: ['floor_object_profile', rule.id, ...(rule.tags ?? [])],
      })
      : maybePlaceBrokenFixture(world, candidate.x, candidate.y, {
        baseChance,
        salt: hash32(seed, candidate.idx, candidate.room.id),
      });
    if (!fixturePlaced) continue;
    placed++;
  }
  return placed;
}

function wallDecorTexture(rule: WallDecorPlacementRule, seed: number, idx: number, placed: number): Tex {
  const variantCount = Math.max(1, Math.floor(rule.variantCount));
  const variant = (hash32(seed, idx, placed, rule.id.length) % variantCount) + Math.max(0, Math.floor(rule.variantOffset ?? 0));
  if (rule.decor === 'screen') {
    const program = variant % 8;
    const frame = hash32(seed, idx, placed, 0x5c3e) % SCREEN_FRAMES;
    return (Tex.SCREEN_BASE + program * SCREEN_FRAMES + frame) as Tex;
  }
  return (rule.textureBase + variant) as Tex;
}

interface WallDecorCandidateBucket {
  room: Room;
  weight: number;
  cells: readonly number[];
}

function buildWallDecorBuckets(world: World, rooms: readonly Room[], rule: WallDecorPlacementRule): WallDecorCandidateBucket[] {
  const buckets: WallDecorCandidateBucket[] = [];
  for (const room of rooms) {
    const weight = ruleRoomWeight(rule, room);
    if (weight <= 0) continue;
    const cells = collectRoomWallCells(world, room, rule.allowSpecialReplace);
    if (cells.length <= 0) continue;
    buckets.push({ room, weight, cells });
  }
  return buckets;
}

function sortedWallDecorCandidates(
  buckets: readonly WallDecorCandidateBucket[],
  rule: WallDecorPlacementRule,
  seed: number,
): ObjectCandidate[] {
  const candidates: ObjectCandidate[] = [];
  for (const bucket of buckets) {
    for (let n = 0; n < bucket.cells.length; n++) {
      const idx = bucket.cells[n];
      const h = hash32(seed, idx, n, rule.id.length);
      const score = bucket.weight * 1_000_000 + (h & 0xffff);
      candidates.push({ room: bucket.room, idx, x: idx % W, y: (idx / W) | 0, score });
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

function placeWallDecorRule(
  world: World,
  rooms: readonly Room[],
  rule: WallDecorPlacementRule,
  seed: number,
  density: FloorObjectPlacementDensity | undefined,
  usedWallDecor: number,
  usedScreens: number,
  roomDecorCounts: Map<number, number>,
): number {
  const eligible = eligibleRooms(rooms, rule);
  const decorRemaining = remainingDensityCap(density?.wallDecor, usedWallDecor);
  const screenRemaining = rule.decor === 'screen' ? remainingDensityCap(density?.screens, usedScreens) : undefined;
  const remaining = decorRemaining === undefined
    ? screenRemaining
    : screenRemaining === undefined
      ? decorRemaining
      : Math.min(decorRemaining, screenRemaining);
  const target = placementTarget(rule, eligible.length, remaining);
  const maxPerRoom = Math.max(1, Math.floor(rule.maxPerRoom ?? density?.maxPerRoom ?? 1));
  const buckets = buildWallDecorBuckets(world, eligible, rule);
  const candidates = sortedWallDecorCandidates(buckets, rule, seed);
  const usedCells = new Set<number>();
  let placed = 0;
  let wallTexChanged = false;
  for (const candidate of candidates) {
    if (placed >= target) break;
    if ((roomDecorCounts.get(candidate.room.id) ?? 0) >= maxPerRoom) continue;
    if (usedCells.has(candidate.idx)) continue;
    usedCells.add(candidate.idx);
    if (!wallCellValidForDecor(world, candidate.room, candidate.idx, rule.allowSpecialReplace)) continue;
    world.wallTex[candidate.idx] = wallDecorTexture(rule, seed, candidate.idx, placed);
    wallTexChanged = true;
    if (rule.decor === 'screen' && world.setFeatureAt(candidate.idx, Feature.SCREEN, false)) {
      fillVisualSlotsFromFeature(world, candidate.idx, seed);
    }
    roomDecorCounts.set(candidate.room.id, (roomDecorCounts.get(candidate.room.id) ?? 0) + 1);
    placed++;
  }
  if (wallTexChanged) world.markWallTexDirty();
  return placed;
}

export function applyFloorObjectPlacementProfile(
  world: World,
  rooms: readonly Room[],
  spawnX: number,
  spawnY: number,
  profile: FloorObjectPlacementProfile | undefined,
  options: { seed?: number; reachable?: Uint8Array } = {},
): FloorObjectPlacementSummary | undefined {
  if (!profile) return undefined;
  const reachable = options.reachable ?? reachableFrom(world, spawnX, spawnY);
  const seed = options.seed ?? hash32(rooms.length, Math.floor(spawnX), Math.floor(spawnY));
  const summary: FloorObjectPlacementSummary = {
    profileId: profile.id,
    roomTextures: {},
    wallDecor: {},
    features: {},
    interactives: {},
    brokenFixtures: {},
  };
  const density = profile.density;
  let placedFeatures = 0;
  let placedInteractives = 0;
  let placedBrokenFixtures = 0;
  let placedWallDecor = 0;
  let placedScreens = 0;

  for (const rule of profile.roomTextureRules ?? []) {
    summary.roomTextures[rule.id] = applyRoomTextureRule(world, rooms, rule, hash32(seed, rule.id.length, 0));
  }
  for (const rule of profile.featureRules ?? []) {
    const placed = placeFeatureRule(
      world,
      rooms,
      rule,
      hash32(seed, rule.id.length, 1),
      reachable,
      remainingDensityCap(density?.features, placedFeatures),
    );
    summary.features[rule.id] = placed;
    placedFeatures += placed;
  }
  for (const rule of profile.interactiveRules ?? []) {
    const placed = placeInteractiveRule(
      world,
      rooms,
      rule,
      hash32(seed, rule.id.length, 2),
      reachable,
      remainingDensityCap(density?.interactives, placedInteractives),
    );
    summary.interactives[rule.id] = placed;
    placedInteractives += placed;
  }
  if (profile.craftStations) {
    summary.craftStations = placeCraftStationsWithProfile(world, rooms, spawnX, spawnY, profile.craftStations, {
      reachable,
      seed: hash32(seed, profile.craftStations.id.length, 3),
      tags: ['floor_object_profile', ...profile.tags],
    });
  }
  for (const rule of profile.brokenFixtures ?? []) {
    const placed = placeBrokenFixtureRule(
      world,
      rooms,
      rule,
      hash32(seed, rule.id.length, 4),
      reachable,
      remainingDensityCap(density?.brokenFixtures, placedBrokenFixtures),
    );
    summary.brokenFixtures[rule.id] = placed;
    placedBrokenFixtures += placed;
  }
  const roomDecorCounts = new Map<number, number>();
  for (const rule of profile.wallDecorRules ?? []) {
    const placed = placeWallDecorRule(
      world,
      rooms,
      rule,
      hash32(seed, rule.id.length, 5),
      density,
      placedWallDecor,
      placedScreens,
      roomDecorCounts,
    );
    summary.wallDecor[rule.id] = placed;
    placedWallDecor += placed;
    if (rule.decor === 'screen') placedScreens += placed;
  }
  summary.visualSlotDecor = fillVisualSlotsForRoomDecor(world, rooms, {
    seed: hash32(seed, profile.id.length, 6),
    tags: profile.tags,
    reachable,
    wallCap: density?.wallDecor === undefined && density?.features === undefined
      ? undefined
      : Math.min(160, Math.max(0, (density?.wallDecor ?? 0) + Math.ceil((density?.features ?? 0) * 0.75))),
    ceilingCap: density?.features === undefined && density?.screens === undefined
      ? undefined
      : Math.min(128, Math.max(0, Math.ceil((density?.features ?? 0) * 0.55) + Math.ceil((density?.screens ?? 0) * 1.2))),
    columnCap: density?.features === undefined
      ? undefined
      : Math.min(48, Math.max(0, Math.ceil((density?.features ?? 0) * 0.18))),
    maxPerRoom: density?.maxPerRoom === undefined ? undefined : Math.max(2, density.maxPerRoom + 1),
    avoidX: spawnX,
    avoidY: spawnY,
  });

  return summary;
}

export function applyStoryFloorObjectProfile(world: World, spawnX: number, spawnY: number, floor: FloorLevel): FloorObjectPlacementSummary | undefined {
  return applyFloorObjectPlacementProfile(world, world.rooms, spawnX, spawnY, floorObjectProfileForStoryFloor(floor), {
    seed: hash32(floor, world.rooms.length),
  });
}

export function applyDesignFloorObjectProfile(
  world: World,
  spawnX: number,
  spawnY: number,
  route: DesignFloorRouteDef,
): FloorObjectPlacementSummary | undefined {
  return applyFloorObjectPlacementProfile(world, world.rooms, spawnX, spawnY, floorObjectProfileForDesignFloor(route), {
    seed: hash32(route.z, world.rooms.length, route.danger),
  });
}

export function applyProceduralFloorObjectProfile(
  world: World,
  rooms: readonly Room[],
  spec: ProceduralFloorSpec,
  reachable: Uint8Array,
): FloorObjectPlacementSummary | undefined {
  return applyFloorObjectPlacementProfile(world, rooms, 0, 0, floorObjectProfileForProceduralFloor(spec), {
    reachable,
    seed: hash32(spec.seed, spec.z, spec.danger, rooms.length),
  });
}
