/* ── Runtime малый/средний самосбор: bounded geometry wave ───── */

import {
  W,
  Cell,
  DoorState,
  EntityType,
  Feature,
  FloorLevel,
  RoomType,
  Tex,
  msg,
  type Entity,
  type GameState,
  type Room,
} from "../core/types";
import { VISUAL_SLOTS_PER_CELL } from "../core/world";
import type { World, WorldGridDirtyRect } from "../core/world";
import type { FloorGeneration } from "../gen/floor_manifest";
import { rebuildPathBlockersFromWorldObjects } from "../gen/path_blockers";
import {
  freezeNavigationCacheForWorld,
  unfreezeNavigationCacheForWorld,
} from "./ai/pathfinding";
import { publishEvent } from "./events";
import { hideMapExplorationCells } from "./map_exploration";
import { pruneRouteCuesInCells } from "./route_cues";
import { isPlayerEntity } from "./player_actor";

export type SamosborWaveScale = "small" | "medium" | "full";

export interface SamosborWaveScaleDef {
  scale: SamosborWaveScale;
  weight: number;
  radius: number;
  budgetCellsPerTick: number;
}

export const SAMOSBOR_WAVE_SCALE_DEFS: Record<
  SamosborWaveScale,
  SamosborWaveScaleDef
> = {
  small: { scale: "small", weight: 5, radius: 14, budgetCellsPerTick: 96 },
  medium: { scale: "medium", weight: 3, radius: 28, budgetCellsPerTick: 192 },
  full: { scale: "full", weight: 4, radius: 0, budgetCellsPerTick: 0 },
};

export interface StartSamosborWaveOptions {
  protectedRoomIds?: readonly number[];
  seed?: number;
  radius?: number;
  budgetCellsPerTick?: number;
  durationSec?: number;
  debug?: boolean;
}

export interface SamosborWaveTickResult {
  active: boolean;
  processed: number;
  changed: number;
  finished: boolean;
}

export interface SamosborWaveDebugSnapshot {
  active: boolean;
  scale: SamosborWaveScale;
  seed: number;
  originIdx: number;
  radius: number;
  budgetCellsPerTick: number;
  frontierLength: number;
  head: number;
  queuedCount: number;
  fieldRadius: number;
  fieldCells: number;
  touchedCount: number;
  dirtyRooms: readonly number[];
  changedCells: number;
  regeneratedCells: number;
  stitchedCells: number;
  deletedContainers: number;
  deletedItems: number;
  deletedProjectiles: number;
  relocatedEntities: number;
  prunedRouteCues: number;
  lastProcessed: number;
  lastChanged: number;
  finished: boolean;
  debug: boolean;
  queuedSample: readonly number[];
  touchedSample: readonly number[];
}

interface DirtyFlags {
  cells: boolean;
  wallTex: boolean;
  floorTex: boolean;
  light: boolean;
  fog: boolean;
  surface: boolean;
  visualSlots: boolean;
}

interface SamosborWave {
  active: boolean;
  scale: "small" | "medium";
  seed: number;
  originIdx: number;
  radius: number;
  budgetCellsPerTick: number;
  durationSec: number;
  budgetCellsPerSecond: number;
  budgetCarry: number;
  lastTickAt: number;
  frontier: number[];
  head: number;
  queued: Uint8Array;
  spreadable: Uint8Array;
  queuedCount: number;
  fieldRadius: number;
  fieldCells: number;
  touched: number[];
  dirtyRooms: number[];
  finished: boolean;
  regenerated: boolean;
  patchRoomId: number;
  protectedRooms: Set<number>;
  player?: Entity;
  floor: FloorLevel;
  startedAt: number;
  changedCells: number;
  regeneratedCells: number;
  stitchedCells: number;
  deletedContainers: number;
  deletedItems: number;
  deletedProjectiles: number;
  relocatedEntities: number;
  prunedRouteCues: number;
  lastProcessed: number;
  lastChanged: number;
  debugSnapshotTick: number;
  debug: boolean;
}

type WaveRole = "floor" | "wall" | "abyss" | "door" | "residue";

const DIR_X = [1, -1, 0, 0] as const;
const DIR_Y = [0, 0, 1, -1] as const;
const EMPTY_WAVE_RESULT: SamosborWaveTickResult = {
  active: false,
  processed: 0,
  changed: 0,
  finished: false,
};
const QUEUED_SAMPLE_CAP = 48;
const WAVE_SNAPSHOT_MIN_TICKS = 15;
const LOCAL_REBUILD_HALO = 2;
const LOCAL_STITCH_DEPTH = 5;

let activeWave: SamosborWave | null = null;
let lastWaveSnapshot: SamosborWaveDebugSnapshot | null = null;

function circularSegmentsForCoords(
  coords: readonly number[],
): { x: number; w: number }[] {
  if (coords.length === 0) return [];
  const unique = Array.from(new Set(coords)).sort((a, b) => a - b);
  if (unique.length >= W) return [{ x: 0, w: W }];
  let largestGap = -1;
  let gapIndex = 0;
  for (let i = 0; i < unique.length; i++) {
    const current = unique[i];
    const next = i === unique.length - 1 ? unique[0] + W : unique[i + 1];
    const gap = next - current - 1;
    if (gap > largestGap) {
      largestGap = gap;
      gapIndex = i;
    }
  }
  let start = unique[(gapIndex + 1) % unique.length];
  let end = unique[gapIndex];
  if (end < start) end += W;
  let len = end - start + 1;
  if (len >= W) return [{ x: 0, w: W }];
  start = ((start % W) + W) % W;
  if (start + len <= W) return [{ x: start, w: len }];
  return [
    { x: start, w: W - start },
    { x: 0, w: (start + len) % W },
  ].filter((segment) => segment.w > 0);
}

function dirtyRectsForIndices(
  indices: readonly number[],
): WorldGridDirtyRect[] | undefined {
  if (indices.length === 0) return undefined;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const idx of indices) {
    xs.push(idx % W);
    ys.push((idx / W) | 0);
  }
  const xSegs = circularSegmentsForCoords(xs);
  const ySegs = circularSegmentsForCoords(ys);
  const rects: WorldGridDirtyRect[] = [];
  for (const x of xSegs) {
    for (const y of ySegs) {
      rects.push({ x: x.x, y: y.x, w: x.w, h: y.w });
    }
  }
  return rects.length > 0 ? rects : undefined;
}

function dirtyRectForIndex(idx: number): WorldGridDirtyRect {
  return { x: idx % W, y: (idx / W) | 0, w: 1, h: 1 };
}

function featureCastsLight(feature: number): boolean {
  return feature === Feature.LAMP || feature === Feature.CANDLE;
}

function hash32(v: number): number {
  let x = v | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function seedForWave(
  state: GameState,
  scale: "small" | "medium",
  originIdx: number,
): number {
  const base =
    ((state.samosborCount + 1) * 1_000_003 + Math.floor(state.time * 60)) | 0;
  return hash32(
    base ^ Math.imul(originIdx + 1, scale === "small" ? 0x45d9f3b : 0x119de1f3),
  );
}

function waveRole(
  seed: number,
  originIdx: number,
  idx: number,
  ring: number,
): WaveRole {
  if (ring <= 1) return "floor";
  const roll =
    hash32(
      seed ^
        Math.imul(idx + 17, 0x9e3779b1) ^
        Math.imul(originIdx + ring + 31, 0x85ebca6b),
    ) % 100;
  if (roll < 42) return "floor";
  if (roll < 66) return "residue";
  if (roll < 84) return "wall";
  if (roll < 96) return "abyss";
  return "door";
}

function waveRoll(
  seed: number,
  originIdx: number,
  idx: number,
  ring: number,
): number {
  return (
    hash32(
      seed ^
        Math.imul(idx + 17, 0x9e3779b1) ^
        Math.imul(originIdx + ring + 31, 0x85ebca6b),
    ) % 100
  );
}

function waveRoleForCell(
  world: World,
  wave: SamosborWave,
  idx: number,
  ring: number,
): WaveRole {
  if (ring <= 1) return "floor";
  const roll = waveRoll(wave.seed, wave.originIdx, idx, ring);
  const cell = world.cells[idx];
  if (walkableCell(cell)) {
    const neighbors = walkableNeighborCount(world, idx);
    if (neighbors <= 1) return roll < 72 ? "floor" : "residue";
    if (neighbors <= 2)
      return roll < 48 ? "residue" : roll < 88 ? "floor" : "door";
    if (roll < 46) return "residue";
    if (roll < 76) return "floor";
    if (roll < 92) return "wall";
    return "door";
  }
  if (cell === Cell.WALL || cell === Cell.ABYSS) {
    if (!hasFloorAnchor(world, idx)) return roll < 72 ? "wall" : "residue";
    if (roll < 26) return "floor";
    if (roll < 40) return "door";
    if (roll < 88) return "wall";
    return "abyss";
  }
  return "residue";
}

function textureRoll(seed: number, idx: number): number {
  return hash32(seed ^ Math.imul(idx + 911, 0x27d4eb2d)) % 4;
}

function floorTexFor(seed: number, idx: number): Tex {
  switch (textureRoll(seed, idx)) {
    case 0:
      return Tex.F_CONCRETE;
    case 1:
      return Tex.F_LINO;
    case 2:
      return Tex.F_TILE;
    default:
      return Tex.F_WOOD;
  }
}

function wallTexFor(seed: number, idx: number): Tex {
  switch (textureRoll(seed, idx)) {
    case 0:
      return Tex.CONCRETE;
    case 1:
      return Tex.PANEL;
    case 2:
      return Tex.BRICK;
    default:
      return Tex.ROTTEN;
  }
}

export function canRunSamosborWave(_state: GameState): boolean {
  return true;
}

export function chooseSamosborScale(state: GameState): SamosborWaveScale {
  if (!canRunSamosborWave(state)) return "full";
  // ~40% full (global fronts only), ~30% small, ~30% medium
  const roll = Math.random();
  if (roll < 0.4) return "full";
  const defs = [
    SAMOSBOR_WAVE_SCALE_DEFS.small,
    SAMOSBOR_WAVE_SCALE_DEFS.medium,
  ];
  let total = 0;
  for (const def of defs) total += def.weight;
  let localRoll = Math.random() * total;
  for (const def of defs) {
    localRoll -= def.weight;
    if (localRoll <= 0) return def.scale;
  }
  return "medium";
}

function waveOriginXY(wave: SamosborWave): { x: number; y: number } {
  return { x: wave.originIdx % W, y: (wave.originIdx / W) | 0 };
}

function toroidalRingDistance(
  world: World,
  originIdx: number,
  idx: number,
): number {
  const ox = originIdx % W;
  const oy = (originIdx / W) | 0;
  const x = idx % W;
  const y = (idx / W) | 0;
  return Math.max(Math.abs(world.delta(ox, x)), Math.abs(world.delta(oy, y)));
}

function withinWaveRadius(
  world: World,
  wave: SamosborWave,
  idx: number,
): boolean {
  const o = waveOriginXY(wave);
  const x = idx % W;
  const y = (idx / W) | 0;
  return (
    world.dist2(o.x + 0.5, o.y + 0.5, x + 0.5, y + 0.5) <=
    wave.radius * wave.radius
  );
}

function walkableCell(cell: number): boolean {
  return cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.WATER;
}

function hermeticDoorCell(world: World, idx: number): boolean {
  if (world.cells[idx] !== Cell.DOOR) return false;
  const state = world.doors.get(idx)?.state;
  return (
    state === DoorState.HERMETIC_CLOSED || state === DoorState.HERMETIC_OPEN
  );
}

function waveSpreadableCell(world: World, idx: number): boolean {
  return walkableCell(world.cells[idx]) && !hermeticDoorCell(world, idx);
}

function entityWalkableCell(world: World, idx: number): boolean {
  return !world.solid(idx % W, (idx / W) | 0);
}

function localPatchCell(cell: number): Cell {
  if (cell === Cell.DOOR) return Cell.FLOOR;
  if (cell === Cell.FLOOR || cell === Cell.WATER) return cell;
  if (cell === Cell.ABYSS) return Cell.WALL;
  return Cell.WALL;
}

function passiveGeneratedFeature(feature: number): Feature {
  switch (feature) {
    case Feature.LAMP:
    case Feature.TABLE:
    case Feature.CHAIR:
    case Feature.BED:
    case Feature.STOVE:
    case Feature.SINK:
    case Feature.TOILET:
    case Feature.SHELF:
    case Feature.DESK:
    case Feature.SLIDE:
    case Feature.CANDLE:
    case Feature.SCREEN:
      return feature;
    default:
      return Feature.NONE;
  }
}

function doorTouchesProtectedRoom(
  world: World,
  idx: number,
  protectedRooms: Set<number>,
): boolean {
  const door = world.doors.get(idx);
  if (!door) return false;
  return protectedRooms.has(door.roomA) || protectedRooms.has(door.roomB);
}

function adjacentLiftOrProtected(world: World, idx: number): boolean {
  const x = idx % W;
  const y = (idx / W) | 0;
  for (let i = 0; i < DIR_X.length; i++) {
    const ni = world.idx(x + DIR_X[i], y + DIR_Y[i]);
    if (
      world.cells[ni] === Cell.LIFT ||
      world.aptMask[ni] ||
      world.hermoWall[ni]
    )
      return true;
  }
  return false;
}

function mutableCell(world: World, wave: SamosborWave, idx: number): boolean {
  if (world.aptMask[idx] || world.hermoWall[idx]) return false;
  if (hermeticDoorCell(world, idx)) return false;
  if (
    world.cells[idx] === Cell.LIFT ||
    world.features[idx] === Feature.LIFT_BUTTON
  )
    return false;
  const roomId = world.roomMap[idx];
  if (roomId >= 0 && wave.protectedRooms.has(roomId)) return false;
  if (
    world.cells[idx] === Cell.DOOR &&
    doorTouchesProtectedRoom(world, idx, wave.protectedRooms)
  )
    return false;
  if (adjacentLiftOrProtected(world, idx)) return false;
  return true;
}

function anchorCell(world: World, wave: SamosborWave, idx: number): boolean {
  return (
    mutableCell(world, wave, idx) &&
    (world.cells[idx] === Cell.FLOOR || world.cells[idx] === Cell.WATER)
  );
}

function findWaveOrigin(
  world: World,
  wave: SamosborWave,
  originX: number,
  originY: number,
): number {
  const start = world.idx(originX, originY);
  if (anchorCell(world, wave, start)) return start;
  const radius = Math.min(Math.max(8, wave.radius), 34);
  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const idx = world.idx(originX + dx, originY + dy);
        if (anchorCell(world, wave, idx)) return idx;
      }
    }
  }
  return -1;
}

function pushUnique(list: number[], value: number): void {
  if (value < 0 || list.includes(value)) return;
  list.push(value);
}

function makePatchRoom(
  world: World,
  wave: Pick<SamosborWave, "scale" | "radius" | "originIdx">,
): number {
  const id = world.rooms.length;
  const ox = wave.originIdx % W;
  const oy = (wave.originIdx / W) | 0;
  const room: Room = {
    id,
    type: RoomType.CORRIDOR,
    x: world.wrap(ox - wave.radius),
    y: world.wrap(oy - wave.radius),
    w: wave.radius * 2 + 1,
    h: wave.radius * 2 + 1,
    doors: [],
    sealed: false,
    name:
      wave.scale === "small"
        ? "Малая складка самосбора"
        : "Средняя складка самосбора",
    apartmentId: -1,
    wallTex: Tex.CONCRETE,
    floorTex: Tex.F_CONCRETE,
  };
  world.rooms[id] = room;
  return id;
}

function buildLocalRebuildField(
  world: World,
  wave: SamosborWave,
): { mask: Uint8Array; indices: number[] } {
  const mask = new Uint8Array(W * W);
  const indices: number[] = [];
  const queue: number[] = [];
  const o = waveOriginXY(wave);
  const r = Math.max(3, wave.fieldRadius);
  const r2 = r * r;
  const push = (idx: number): void => {
    if (mask[idx] || !mutableCell(world, wave, idx)) return;
    const x = idx % W;
    const y = (idx / W) | 0;
    if (world.dist2(o.x + 0.5, o.y + 0.5, x + 0.5, y + 0.5) > r2) return;
    mask[idx] = 1;
    queue.push(idx);
    indices.push(idx);
  };
  push(wave.originIdx);
  for (const idx of wave.touched) push(idx);
  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head];
    const x = idx % W;
    const y = (idx / W) | 0;
    for (let i = 0; i < DIR_X.length; i++)
      push(world.idx(x + DIR_X[i], y + DIR_Y[i]));
  }
  return { mask, indices };
}

function enqueueCell(world: World, wave: SamosborWave, idx: number): void {
  if (wave.queued[idx]) return;
  if (!withinWaveRadius(world, wave, idx)) return;
  if (!mutableCell(world, wave, idx)) return;
  wave.queued[idx] = 1;
  wave.spreadable[idx] = waveSpreadableCell(world, idx) ? 1 : 0;
  wave.queuedCount++;
  wave.frontier.push(idx);
}

function enqueueNeighbors(world: World, wave: SamosborWave, idx: number): void {
  if (!wave.spreadable[idx]) return;
  const x = idx % W;
  const y = (idx / W) | 0;
  for (let i = 0; i < DIR_X.length; i++)
    enqueueCell(world, wave, world.idx(x + DIR_X[i], y + DIR_Y[i]));
}

function markDirty(
  world: World,
  flags: DirtyFlags,
  rects?: readonly WorldGridDirtyRect[],
): void {
  if (flags.cells) world.markCellsDirty(rects);
  if (flags.wallTex) world.markWallTexDirty(rects);
  if (flags.floorTex) world.markFloorTexDirty(rects);
  if (flags.light) world.markFeaturesDirty(true, rects);
  if (flags.fog) world.markFogDirty(rects);
  if (flags.surface) world.markSurfaceDirty();
  if (flags.visualSlots) world.markVisualSlotsDirty();
}

function noteTouched(wave: SamosborWave, idx: number): void {
  wave.touched.push(idx);
  wave.changedCells++;
}

function removeDoor(world: World, idx: number): boolean {
  return world.removeDoorAt(idx);
}

function clearVisualSlotsBatched(
  world: World,
  idx: number,
  flags: DirtyFlags,
): boolean {
  const offset = idx * VISUAL_SLOTS_PER_CELL;
  let changed = false;
  for (let slot = 0; slot < VISUAL_SLOTS_PER_CELL; slot++) {
    if (world.visualSlots[offset + slot] === 0) continue;
    world.visualSlots[offset + slot] = 0;
    changed = true;
  }
  if (changed) flags.visualSlots = true;
  return changed;
}

function addDoorToRoom(world: World, roomId: number, idx: number): void {
  const room = roomId >= 0 ? world.rooms[roomId] : undefined;
  if (room && !room.doors.includes(idx)) room.doors.push(idx);
}

function walkableNeighborCount(world: World, idx: number): number {
  const x = idx % W;
  const y = (idx / W) | 0;
  let count = 0;
  for (let i = 0; i < DIR_X.length; i++) {
    if (walkableCell(world.cells[world.idx(x + DIR_X[i], y + DIR_Y[i])]))
      count++;
  }
  return count;
}

function hasFloorAnchor(world: World, idx: number): boolean {
  const x = idx % W;
  const y = (idx / W) | 0;
  for (let i = 0; i < DIR_X.length; i++) {
    const ni = world.idx(x + DIR_X[i], y + DIR_Y[i]);
    if (
      world.cells[ni] === Cell.FLOOR ||
      world.cells[ni] === Cell.WATER ||
      world.cells[ni] === Cell.DOOR
    )
      return true;
  }
  return false;
}

function preserveExistingWalkable(world: World, idx: number): boolean {
  const cell = world.cells[idx];
  if (cell === Cell.DOOR || cell === Cell.WATER) return true;
  if (cell !== Cell.FLOOR) return false;
  if (walkableNeighborCount(world, idx) <= 2) return true;
  if (adjacentLiftOrProtected(world, idx)) return true;
  return false;
}

function cleanSolidCell(
  world: World,
  wave: SamosborWave,
  idx: number,
  flags: DirtyFlags,
): boolean {
  let changed = false;
  const roomId = world.roomMap[idx];
  pushUnique(wave.dirtyRooms, roomId);
  if (world.cells[idx] === Cell.DOOR)
    changed = removeDoor(world, idx) || changed;
  if (world.roomMap[idx] !== -1) {
    world.roomMap[idx] = -1;
    flags.cells = true;
    changed = true;
  }
  if (world.features[idx] !== Feature.NONE) {
    if (featureCastsLight(world.features[idx])) flags.light = true;
    world.setFeatureAt(idx, Feature.NONE, false, dirtyRectForIndex(idx));
    flags.cells = true;
    changed = true;
  }
  if (world.fog[idx] !== 0) {
    world.fog[idx] = 0;
    flags.fog = true;
    changed = true;
  }
  if (world.surfaceMap.delete(idx) || world.surfaceFlags[idx] !== 0) {
    world.surfaceFlags[idx] = 0;
    flags.surface = true;
    changed = true;
  }
  changed = clearVisualSlotsBatched(world, idx, flags) || changed;
  return changed;
}

function applyFloor(
  world: World,
  wave: SamosborWave,
  idx: number,
  flags: DirtyFlags,
): boolean {
  if (!hasFloorAnchor(world, idx)) return applyResidue(world, wave, idx, flags);
  let changed = false;
  const oldRoom = world.roomMap[idx];
  if (world.cells[idx] === Cell.DOOR)
    changed = removeDoor(world, idx) || changed;
  if (world.cells[idx] !== Cell.FLOOR) {
    world.cells[idx] = Cell.FLOOR;
    flags.cells = true;
    changed = true;
  }
  const nextRoom = oldRoom >= 0 ? oldRoom : wave.patchRoomId;
  if (world.roomMap[idx] !== nextRoom) {
    pushUnique(wave.dirtyRooms, world.roomMap[idx]);
    pushUnique(wave.dirtyRooms, nextRoom);
    world.roomMap[idx] = nextRoom;
    flags.cells = true;
    changed = true;
  }
  const tex = floorTexFor(wave.seed, idx);
  if (world.floorTex[idx] !== tex) {
    world.floorTex[idx] = tex;
    flags.floorTex = true;
    changed = true;
  }
  if (world.wallTex[idx] !== Tex.CONCRETE && oldRoom < 0) {
    world.wallTex[idx] = Tex.CONCRETE;
    flags.wallTex = true;
    changed = true;
  }
  if (world.features[idx] !== Feature.NONE && oldRoom < 0) {
    if (featureCastsLight(world.features[idx])) flags.light = true;
    world.setFeatureAt(idx, Feature.NONE, false, dirtyRectForIndex(idx));
    clearVisualSlotsBatched(world, idx, flags);
    flags.cells = true;
    changed = true;
  }
  if (changed) noteTouched(wave, idx);
  return changed;
}

function applyResidue(
  world: World,
  wave: SamosborWave,
  idx: number,
  flags: DirtyFlags,
): boolean {
  let changed = false;
  if (walkableCell(world.cells[idx])) {
    const fog = 72 + (hash32(wave.seed ^ idx) % 76);
    if (world.fog[idx] < fog) {
      world.fog[idx] = fog;
      flags.fog = true;
      changed = true;
    }
    const tex = textureRoll(wave.seed, idx) === 0 ? Tex.F_TILE : Tex.F_CONCRETE;
    if (world.floorTex[idx] !== tex) {
      world.floorTex[idx] = tex;
      flags.floorTex = true;
      changed = true;
    }
  } else if (world.cells[idx] === Cell.WALL) {
    const tex = wallTexFor(wave.seed, idx);
    if (world.wallTex[idx] !== tex) {
      world.wallTex[idx] = tex;
      flags.wallTex = true;
      changed = true;
    }
  }
  if (changed) noteTouched(wave, idx);
  return changed;
}

function applyWall(
  world: World,
  wave: SamosborWave,
  idx: number,
  flags: DirtyFlags,
): boolean {
  if (preserveExistingWalkable(world, idx))
    return applyResidue(world, wave, idx, flags);
  let changed = false;
  if (world.cells[idx] !== Cell.WALL) {
    changed = cleanSolidCell(world, wave, idx, flags) || changed;
    world.cells[idx] = Cell.WALL;
    flags.cells = true;
    changed = true;
  } else {
    changed = cleanSolidCell(world, wave, idx, flags) || changed;
  }
  const tex = wallTexFor(wave.seed, idx);
  if (world.wallTex[idx] !== tex) {
    world.wallTex[idx] = tex;
    flags.wallTex = true;
    changed = true;
  }
  if (changed) noteTouched(wave, idx);
  return changed;
}

function applyAbyss(
  world: World,
  wave: SamosborWave,
  idx: number,
  flags: DirtyFlags,
): boolean {
  if (preserveExistingWalkable(world, idx))
    return applyResidue(world, wave, idx, flags);
  let changed = false;
  if (world.cells[idx] !== Cell.WALL) {
    changed = cleanSolidCell(world, wave, idx, flags) || changed;
    world.cells[idx] = Cell.WALL;
    flags.cells = true;
    changed = true;
  } else {
    changed = cleanSolidCell(world, wave, idx, flags) || changed;
  }
  if (world.wallTex[idx] !== Tex.DARK) {
    world.wallTex[idx] = Tex.DARK;
    flags.wallTex = true;
    changed = true;
  }
  if (world.floorTex[idx] !== Tex.F_ABYSS) {
    world.floorTex[idx] = Tex.F_ABYSS;
    flags.floorTex = true;
    changed = true;
  }
  if (changed) noteTouched(wave, idx);
  return changed;
}

function neighborRoom(
  world: World,
  idx: number,
  dx: number,
  dy: number,
): number {
  const x = idx % W;
  const y = (idx / W) | 0;
  return world.roomMap[world.idx(x + dx, y + dy)];
}

function tryPatchDoorAxis(
  world: World,
  wave: SamosborWave,
  idx: number,
  ax: number,
  ay: number,
): boolean {
  const x = idx % W;
  const y = (idx / W) | 0;
  const a = world.idx(x + ax, y + ay);
  const b = world.idx(x - ax, y - ay);
  const aPatch =
    world.roomMap[a] === wave.patchRoomId && world.cells[a] === Cell.FLOOR;
  const bPatch =
    world.roomMap[b] === wave.patchRoomId && world.cells[b] === Cell.FLOOR;
  if (aPatch === bPatch) return false;
  const other = aPatch ? b : a;
  if (
    !walkableCell(world.cells[other]) ||
    world.roomMap[other] === wave.patchRoomId
  )
    return false;
  const roomA = wave.patchRoomId;
  const roomB = aPatch
    ? neighborRoom(world, idx, -ax, -ay)
    : neighborRoom(world, idx, ax, ay);
  if (roomB >= 0 && wave.protectedRooms.has(roomB)) return false;
  world.doors.set(idx, {
    idx,
    state: DoorState.CLOSED,
    roomA,
    roomB,
    keyId: "",
    timer: 0,
  });
  addDoorToRoom(world, roomA, idx);
  addDoorToRoom(world, roomB, idx);
  return true;
}

function applyDoor(
  world: World,
  wave: SamosborWave,
  idx: number,
  flags: DirtyFlags,
): boolean {
  if (world.cells[idx] !== Cell.WALL && world.cells[idx] !== Cell.ABYSS)
    return applyFloor(world, wave, idx, flags);
  const madeDoor =
    tryPatchDoorAxis(world, wave, idx, 1, 0) ||
    tryPatchDoorAxis(world, wave, idx, 0, 1);
  if (!madeDoor) return applyFloor(world, wave, idx, flags);
  cleanSolidCell(world, wave, idx, flags);
  world.cells[idx] = Cell.DOOR;
  world.roomMap[idx] = wave.patchRoomId;
  world.wallTex[idx] = Tex.DOOR_METAL;
  world.floorTex[idx] = Tex.F_CONCRETE;
  flags.cells = true;
  flags.wallTex = true;
  flags.floorTex = true;
  pushUnique(wave.dirtyRooms, wave.patchRoomId);
  noteTouched(wave, idx);
  return true;
}

function applyWaveCell(
  world: World,
  wave: SamosborWave,
  idx: number,
  flags: DirtyFlags,
): boolean {
  if (!mutableCell(world, wave, idx)) return false;
  const ring = toroidalRingDistance(world, wave.originIdx, idx);
  switch (waveRoleForCell(world, wave, idx, ring)) {
    case "floor":
      return applyFloor(world, wave, idx, flags);
    case "wall":
      return applyWall(world, wave, idx, flags);
    case "abyss":
      return applyAbyss(world, wave, idx, flags);
    case "door":
      return applyDoor(world, wave, idx, flags);
    case "residue":
      return applyResidue(world, wave, idx, flags);
  }
}

function nearestEntityFloor(
  world: World,
  x: number,
  y: number,
  maxRadius: number,
): { x: number; y: number } | null {
  const sx = world.wrap(Math.floor(x));
  const sy = world.wrap(Math.floor(y));
  const start = world.idx(sx, sy);
  if (entityWalkableCell(world, start)) return { x: sx, y: sy };
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const tx = world.wrap(sx + dx);
        const ty = world.wrap(sy + dy);
        if (entityWalkableCell(world, world.idx(tx, ty)))
          return { x: tx, y: ty };
      }
    }
  }
  return null;
}

function relocateEntity(
  world: World,
  entity: Entity,
  maxRadius: number,
): boolean {
  const pos = nearestEntityFloor(world, entity.x, entity.y, maxRadius);
  if (!pos) return false;
  entity.x = pos.x + 0.5;
  entity.y = pos.y + 0.5;
  return true;
}

function cleanupBatchEntities(
  world: World,
  wave: SamosborWave,
  _entities: Entity[],
  _touched: readonly number[],
): void {
  const player = wave.player?.alive ? wave.player : undefined;
  if (
    player &&
    !entityWalkableCell(
      world,
      world.idx(Math.floor(player.x), Math.floor(player.y)),
    ) &&
    relocateEntity(world, player, 30)
  ) {
    wave.relocatedEntities++;
  }
}

function pruneScreenAndSlideCells(world: World, touchedSet: Set<number>): void {
  const oldScreens = world.screenCells.length;
  const oldSlides = world.slideCells.length;
  if (oldScreens > 0)
    world.screenCells = world.screenCells.filter(
      (idx) => !touchedSet.has(idx) || world.features[idx] === Feature.SCREEN,
    );
  if (oldSlides > 0)
    world.slideCells = world.slideCells.filter(
      (idx) => !touchedSet.has(idx) || world.features[idx] === Feature.SLIDE,
    );
}

function cleanupContainers(
  world: World,
  wave: SamosborWave,
  touchedSet: Set<number>,
  floor: FloorLevel,
): void {
  let changed = false;
  for (let i = world.containers.length - 1; i >= 0; i--) {
    const container = world.containers[i];
    if (container.floor !== floor) continue;
    const idx = world.idx(container.x, container.y);
    if (!touchedSet.has(idx)) continue;
    if (!walkableCell(world.cells[idx])) {
      world.containers.splice(i, 1);
      wave.deletedContainers++;
      changed = true;
      continue;
    }
    container.roomId = world.roomMap[idx];
    container.zoneId = world.zoneMap[idx];
    changed = true;
  }
  if (changed) world.rebuildContainerMap();
}

function cleanupFinalEntities(
  world: World,
  wave: SamosborWave,
  entities: Entity[],
  touchedSet: Set<number>,
): void {
  for (let i = entities.length - 1; i >= 0; i--) {
    const entity = entities[i];
    if (!entity.alive) continue;
    const idx = world.idx(Math.floor(entity.x), Math.floor(entity.y));
    const inTouched = touchedSet.has(idx);
    if (entity.type === EntityType.PROJECTILE && inTouched) {
      entities.splice(i, 1);
      wave.deletedProjectiles++;
      continue;
    }
    if (
      (entity.type === EntityType.ITEM_DROP ||
        entity.type === EntityType.BILLBOARD) &&
      inTouched &&
      !entityWalkableCell(world, idx)
    ) {
      if (relocateEntity(world, entity, 18)) wave.relocatedEntities++;
      else {
        entities.splice(i, 1);
        if (entity.type === EntityType.ITEM_DROP) wave.deletedItems++;
      }
      continue;
    }
    if (
      (isPlayerEntity(entity) ||
        entity.type === EntityType.NPC ||
        entity.type === EntityType.MONSTER) &&
      !entityWalkableCell(world, idx)
    ) {
      if (relocateEntity(world, entity, 30)) wave.relocatedEntities++;
    }
  }
}

function removeDoorsInField(world: World, indices: readonly number[]): void {
  for (const idx of indices) {
    if (world.cells[idx] === Cell.DOOR || world.doors.has(idx))
      removeDoor(world, idx);
  }
}

function copyGeneratedSurfaceCell(
  world: World,
  source: World,
  idx: number,
): void {
  const surface = source.surfaceMap.get(idx);
  if (surface) world.surfaceMap.set(idx, new Uint8Array(surface));
  else world.surfaceMap.delete(idx);
  world.surfaceFlags[idx] = source.surfaceFlags[idx];
}

function copyGeneratedVisualSlotsCell(
  world: World,
  source: World,
  idx: number,
  flags: DirtyFlags,
): void {
  const offset = idx * VISUAL_SLOTS_PER_CELL;
  let changed = false;
  for (let slot = 0; slot < VISUAL_SLOTS_PER_CELL; slot++) {
    const next = source.visualSlots[offset + slot];
    if (world.visualSlots[offset + slot] === next) continue;
    world.visualSlots[offset + slot] = next;
    changed = true;
  }
  if (changed) flags.visualSlots = true;
}

function retunePatchRoomFromGeneratedField(
  world: World,
  source: World,
  wave: SamosborWave,
  indices: readonly number[],
): void {
  const room = world.rooms[wave.patchRoomId];
  if (!room) return;
  const counts = new Map<number, number>();
  for (const idx of indices) {
    const roomId = source.roomMap[idx];
    if (roomId < 0 || !source.rooms[roomId]) continue;
    counts.set(roomId, (counts.get(roomId) ?? 0) + 1);
  }
  let bestRoomId = -1;
  let bestCount = 0;
  for (const [roomId, count] of counts) {
    if (count > bestCount) {
      bestRoomId = roomId;
      bestCount = count;
    }
  }
  const sourceRoom = bestRoomId >= 0 ? source.rooms[bestRoomId] : undefined;
  if (sourceRoom) {
    room.type = sourceRoom.type;
    room.name = sourceRoom.name;
    room.wallTex = sourceRoom.wallTex;
    room.floorTex = sourceRoom.floorTex;
  } else {
    room.type = RoomType.CORRIDOR;
    room.name = "Перестроенный коридор";
    room.wallTex = Tex.CONCRETE;
    room.floorTex = Tex.F_CONCRETE;
  }
}

function copyGeneratedFieldCells(
  world: World,
  source: World,
  wave: SamosborWave,
  indices: readonly number[],
  flags: DirtyFlags,
): number {
  let copied = 0;
  const patchRoomId = wave.patchRoomId;
  pushUnique(wave.dirtyRooms, patchRoomId);
  for (const idx of indices) {
    const oldFog = world.fog[idx];
    const sourceCell = source.cells[idx];
    const cell = localPatchCell(sourceCell);
    world.cells[idx] = cell;
    world.roomMap[idx] = walkableCell(cell) ? patchRoomId : -1;
    world.wallTex[idx] =
      sourceCell === Cell.DOOR
        ? Tex.CONCRETE
        : cell === Cell.WALL && sourceCell === Cell.ABYSS
          ? Tex.DARK
          : source.wallTex[idx];
    world.floorTex[idx] =
      sourceCell === Cell.ABYSS ? Tex.F_ABYSS : source.floorTex[idx];
    world.features[idx] = walkableCell(cell)
      ? passiveGeneratedFeature(source.features[idx])
      : Feature.NONE;
    world.light[idx] = source.light[idx];
    world.fog[idx] = walkableCell(cell) ? Math.max(oldFog, source.fog[idx]) : 0;
    world.liftDir[idx] = 0;
    world.aptMask[idx] = 0;
    world.hermoWall[idx] = 0;
    copyGeneratedSurfaceCell(world, source, idx);
    copyGeneratedVisualSlotsCell(world, source, idx, flags);
    copied++;
  }
  return copied;
}

function refreshPassiveFeatureLists(
  world: World,
  source: World,
  mask: Uint8Array,
): void {
  world.screenCells = world.screenCells.filter((idx) => !mask[idx]);
  world.slideCells = world.slideCells.filter((idx) => !mask[idx]);
  for (const idx of source.screenCells) {
    if (
      mask[idx] &&
      world.features[idx] === Feature.SCREEN &&
      !world.screenCells.includes(idx)
    )
      world.screenCells.push(idx);
  }
  for (const idx of source.slideCells) {
    if (
      mask[idx] &&
      world.features[idx] === Feature.SLIDE &&
      !world.slideCells.includes(idx)
    )
      world.slideCells.push(idx);
  }
}

function clearFieldSideEffects(world: World, mask: Uint8Array): void {
  for (const idx of Array.from(world.anomalyTeleports.keys())) {
    if (mask[idx]) world.anomalyTeleports.delete(idx);
  }
  if (world.anomalySmogSource >= 0 && mask[world.anomalySmogSource])
    world.anomalySmogSource = -1;
  if (world.anomalySmogCells.length > 0)
    world.anomalySmogCells = world.anomalySmogCells.filter((idx) => !mask[idx]);
  if (world.railTrainCells.size > 0) {
    for (const idx of Array.from(world.railTrainCells.keys())) {
      if (mask[idx]) world.railTrainCells.delete(idx);
    }
  }
  if (world.railTracks.length > 0) {
    world.railTracks = world.railTracks
      .map((track) => ({
        ...track,
        cells: track.cells.filter((idx) => !mask[idx]),
      }))
      .filter((track) => track.cells.length > 0);
  }
}

function carvePatchFloor(
  world: World,
  wave: SamosborWave,
  idx: number,
  flags: DirtyFlags,
): boolean {
  if (!mutableCell(world, wave, idx)) return false;
  if (world.cells[idx] === Cell.DOOR || world.doors.has(idx))
    removeDoor(world, idx);
  const changed =
    world.cells[idx] !== Cell.FLOOR || world.roomMap[idx] !== wave.patchRoomId;
  world.cells[idx] = Cell.FLOOR;
  world.roomMap[idx] = wave.patchRoomId;
  world.floorTex[idx] = Tex.F_CONCRETE;
  world.wallTex[idx] = Tex.CONCRETE;
  world.setFeatureAt(idx, Feature.NONE, false, dirtyRectForIndex(idx));
  world.fog[idx] = 0;
  world.surfaceMap.delete(idx);
  world.surfaceFlags[idx] = 0;
  clearVisualSlotsBatched(world, idx, flags);
  pushUnique(wave.dirtyRooms, wave.patchRoomId);
  return changed;
}

function stitchBoundaryCell(
  world: World,
  wave: SamosborWave,
  mask: Uint8Array,
  idx: number,
  fromDx: number,
  fromDy: number,
  flags: DirtyFlags,
): number {
  let stitched = 0;
  let cx = idx % W;
  let cy = (idx / W) | 0;
  for (let step = 0; step < LOCAL_STITCH_DEPTH; step++) {
    const ci = world.idx(cx, cy);
    if (!mask[ci]) break;
    if (carvePatchFloor(world, wave, ci, flags)) stitched++;

    let connected = false;
    for (let i = 0; i < DIR_X.length; i++) {
      if (DIR_X[i] === -fromDx && DIR_Y[i] === -fromDy) continue;
      const ni = world.idx(cx + DIR_X[i], cy + DIR_Y[i]);
      if (
        walkableCell(world.cells[ni]) &&
        (!mask[ni] || world.roomMap[ni] === wave.patchRoomId)
      ) {
        connected = true;
        break;
      }
    }
    if (connected) break;
    cx = world.wrap(cx + fromDx);
    cy = world.wrap(cy + fromDy);
  }
  return stitched;
}

function stitchLocalRebuildField(
  world: World,
  wave: SamosborWave,
  mask: Uint8Array,
  indices: readonly number[],
  flags: DirtyFlags,
): number {
  let stitched = 0;
  for (const idx of indices) {
    const x = idx % W;
    const y = (idx / W) | 0;
    if (walkableCell(world.cells[idx])) continue;
    for (let i = 0; i < DIR_X.length; i++) {
      const nx = x + DIR_X[i];
      const ny = y + DIR_Y[i];
      const ni = world.idx(nx, ny);
      if (mask[ni] || !entityWalkableCell(world, ni)) continue;
      stitched += stitchBoundaryCell(
        world,
        wave,
        mask,
        idx,
        -DIR_X[i],
        -DIR_Y[i],
        flags,
      );
      break;
    }
  }
  return stitched;
}

function applyGeneratedFieldPatch(
  world: World,
  entities: Entity[],
  state: GameState,
  wave: SamosborWave,
  replacement: FloorGeneration,
): void {
  if (wave.regenerated) return;
  const source = replacement.world;
  const field = buildLocalRebuildField(world, wave);
  if (field.indices.length === 0) return;
  const fieldRects = dirtyRectsForIndices(field.indices);
  const fieldSet = new Set(field.indices);
  const visualFlags: DirtyFlags = {
    cells: false,
    wallTex: false,
    floorTex: false,
    light: false,
    fog: false,
    surface: false,
    visualSlots: false,
  };
  removeDoorsInField(world, field.indices);
  wave.regeneratedCells += copyGeneratedFieldCells(
    world,
    source,
    wave,
    field.indices,
    visualFlags,
  );
  retunePatchRoomFromGeneratedField(world, source, wave, field.indices);
  wave.fieldCells = field.indices.length;
  wave.stitchedCells += stitchLocalRebuildField(
    world,
    wave,
    field.mask,
    field.indices,
    visualFlags,
  );
  refreshPassiveFeatureLists(world, source, field.mask);
  clearFieldSideEffects(world, field.mask);
  cleanupContainers(world, wave, fieldSet, state.currentFloor);
  cleanupFinalEntities(world, wave, entities, fieldSet);
  rebuildPathBlockersFromWorldObjects(world, wave.seed, field.indices);
  wave.prunedRouteCues += pruneRouteCuesInCells(world, fieldSet);
  world.markCellsDirty(fieldRects);
  world.markWallTexDirty(fieldRects);
  world.markFloorTexDirty(fieldRects);
  world.markFeaturesDirty(true, fieldRects);
  world.markFogDirty(fieldRects);
  world.markSurfaceDirty();
  if (visualFlags.visualSlots) world.markVisualSlotsDirty();
  wave.regenerated = true;

  const ox = wave.originIdx % W;
  const oy = (wave.originIdx / W) | 0;
  state.msgs.push(
    msg(
      `Поле самосбора перестроило участок r${wave.fieldRadius}: ${field.indices.length} клеток.`,
      state.time,
      "#c8f",
    ),
  );
  publishEvent(state, {
    type: "room_regrown",
    x: ox,
    y: oy,
    severity: wave.scale === "small" ? 4 : 5,
    privacy: "public",
    tags: ["samosbor", "wave", "local_rebuild", wave.scale],
    data: {
      scale: wave.scale,
      radius: wave.radius,
      fieldRadius: wave.fieldRadius,
      fieldCells: field.indices.length,
      regeneratedCells: wave.regeneratedCells,
      stitchedCells: wave.stitchedCells,
    },
  });
}

function buildSnapshot(
  wave: SamosborWave,
  active: boolean,
): SamosborWaveDebugSnapshot {
  return {
    active,
    scale: wave.scale,
    seed: wave.seed,
    originIdx: wave.originIdx,
    radius: wave.radius,
    budgetCellsPerTick: wave.budgetCellsPerTick,
    frontierLength: wave.frontier.length,
    head: wave.head,
    queuedCount: wave.queuedCount,
    fieldRadius: wave.fieldRadius,
    fieldCells: wave.fieldCells,
    touchedCount: wave.touched.length,
    dirtyRooms: wave.dirtyRooms.slice(0, 24),
    changedCells: wave.changedCells,
    regeneratedCells: wave.regeneratedCells,
    stitchedCells: wave.stitchedCells,
    deletedContainers: wave.deletedContainers,
    deletedItems: wave.deletedItems,
    deletedProjectiles: wave.deletedProjectiles,
    relocatedEntities: wave.relocatedEntities,
    prunedRouteCues: wave.prunedRouteCues,
    lastProcessed: wave.lastProcessed,
    lastChanged: wave.lastChanged,
    finished: wave.finished,
    debug: wave.debug,
    queuedSample: wave.frontier.slice(0, QUEUED_SAMPLE_CAP),
    touchedSample: wave.touched.slice(0, QUEUED_SAMPLE_CAP),
  };
}

export function getSamosborWaveDebugSnapshot(): SamosborWaveDebugSnapshot | null {
  if (activeWave) {
    lastWaveSnapshot = buildSnapshot(activeWave, activeWave.active);
    return lastWaveSnapshot;
  }
  return lastWaveSnapshot;
}

/** Clear the cached snapshot so map exploration doesn't read stale wave data */
export function clearSamosborWaveSnapshot(): void {
  lastWaveSnapshot = null;
}

/**
 * Stitch a replacement floor into the world at front-touched cells.
 * This repairs the chaotic geometry left by fronts after samosbor ends.
 * Returns the number of cells patched.
 */
export function applyFrontFieldStitch(
  world: World,
  state: GameState,
  touchedCells: ReadonlySet<number>,
  replacement: FloorGeneration,
): number {
  if (touchedCells.size === 0) return 0;
  const source = replacement.world;
  const indices: number[] = [];
  const mask = new Uint8Array(W * W);

  // Build field from touched cells — filter out protected cells
  for (const ci of touchedCells) {
    if (world.aptMask[ci] || world.hermoWall[ci]) continue;
    if (world.cells[ci] === Cell.LIFT) continue;
    mask[ci] = 1;
    indices.push(ci);
  }
  if (indices.length === 0) return 0;

  // Also expand 1 cell around touched to smooth boundaries
  const boundary: number[] = [];
  for (const ci of indices) {
    const x = ci % W;
    const y = (ci / W) | 0;
    for (let d = 0; d < DIR_X.length; d++) {
      const ni = world.idx(x + DIR_X[d], y + DIR_Y[d]);
      if (mask[ni]) continue;
      if (world.aptMask[ni] || world.hermoWall[ni]) continue;
      if (world.cells[ni] === Cell.LIFT) continue;
      mask[ni] = 1;
      boundary.push(ni);
    }
  }
  const allIndices = indices.concat(boundary);

  const fieldRects = dirtyRectsForIndices(allIndices);
  const fieldSet = new Set(allIndices);
  const visualFlags: DirtyFlags = {
    cells: false,
    wallTex: false,
    floorTex: false,
    light: false,
    fog: false,
    surface: false,
    visualSlots: false,
  };

  // Remove existing doors in field
  for (const ci of allIndices) {
    if (world.cells[ci] === Cell.DOOR || world.doors.has(ci)) {
      world.removeDoorAt(ci);
    }
  }

  // Copy cells from replacement floor
  let copied = 0;
  // Create a patch room for generic stitched cells
  const patchRoomId = world.rooms.length;
  world.rooms.push({
    id: patchRoomId,
    type: RoomType.COMMON,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    doors: [],
    sealed: false,
    name: "Перестроенный участок",
    apartmentId: -1,
    wallTex: Tex.CONCRETE,
    floorTex: Tex.F_CONCRETE,
  });

  for (const idx of allIndices) {
    const oldFog = world.fog[idx];
    const sourceCell = source.cells[idx];
    const cell = localPatchCell(sourceCell);
    world.cells[idx] = cell;
    world.roomMap[idx] = walkableCell(cell)
      ? source.roomMap[idx] >= 0
        ? patchRoomId
        : -1
      : -1;
    world.wallTex[idx] =
      sourceCell === Cell.DOOR
        ? Tex.CONCRETE
        : cell === Cell.WALL && sourceCell === Cell.ABYSS
          ? Tex.DARK
          : source.wallTex[idx];
    world.floorTex[idx] =
      sourceCell === Cell.ABYSS ? Tex.F_ABYSS : source.floorTex[idx];
    world.features[idx] = walkableCell(cell)
      ? passiveGeneratedFeature(source.features[idx])
      : Feature.NONE;
    world.light[idx] = source.light[idx];
    world.fog[idx] = walkableCell(cell) ? Math.max(oldFog, source.fog[idx]) : 0;
    world.liftDir[idx] = 0;
    copyGeneratedSurfaceCell(world, source, idx);
    copyGeneratedVisualSlotsCell(world, source, idx, visualFlags);
    copied++;
  }

  // Stitch boundaries: where the new field walls meet old floor, carve connections
  for (const idx of allIndices) {
    if (walkableCell(world.cells[idx])) continue;
    const x = idx % W;
    const y = (idx / W) | 0;
    for (let d = 0; d < DIR_X.length; d++) {
      const ni = world.idx(x + DIR_X[d], y + DIR_Y[d]);
      if (mask[ni]) continue;
      if (walkableCell(world.cells[ni])) {
        // Adjacent old walkable cell — carve this cell to floor for connection
        world.cells[idx] = Cell.FLOOR;
        world.roomMap[idx] = patchRoomId;
        world.floorTex[idx] = Tex.F_CONCRETE;
        world.wallTex[idx] = Tex.CONCRETE;
        world.setFeatureAt(idx, Feature.NONE, false);
        world.fog[idx] = 0;
        break;
      }
    }
  }

  refreshPassiveFeatureLists(world, source, mask);
  clearFieldSideEffects(world, mask);
  rebuildPathBlockersFromWorldObjects(
    world,
    (Math.random() * 0xffffffff) | 0,
    allIndices,
  );
  pruneRouteCuesInCells(world, fieldSet);

  // Re-fog stitched areas so player must re-explore the changed geometry
  hideMapExplorationCells(world, fieldSet);

  world.markCellsDirty(fieldRects);
  world.markWallTexDirty(fieldRects);
  world.markFloorTexDirty(fieldRects);
  world.markFeaturesDirty(true, fieldRects);
  world.markFogDirty(fieldRects);
  world.markSurfaceDirty();
  if (visualFlags.visualSlots) world.markVisualSlotsDirty();

  state.msgs.push(
    msg(`Самосбор перестроил ${copied} клеток.`, state.time, "#c8f"),
  );
  publishEvent(state, {
    type: "room_regrown",
    x: 0,
    y: 0,
    severity: 5,
    privacy: "public",
    tags: ["samosbor", "fronts", "stitch", "full"],
    data: {
      scale: "full" as SamosborWaveScale,
      fieldCells: allIndices.length,
      regeneratedCells: copied,
    },
  });

  return copied;
}

export function getSamosborWaveDebugLines(): string[] {
  const snapshot = getSamosborWaveDebugSnapshot();
  if (!snapshot) return ["Волна самосбора: -"];
  const status = snapshot.active
    ? "active"
    : snapshot.finished
      ? "done"
      : "idle";
  const ox = snapshot.originIdx % W;
  const oy = (snapshot.originIdx / W) | 0;
  return [
    `Волна самосбора: ${status} ${snapshot.scale} ${ox},${oy} r${snapshot.radius} field=${snapshot.fieldRadius}/${snapshot.fieldCells}`,
    `Волна frontier: ${snapshot.head}/${snapshot.frontierLength} queued=${snapshot.queuedCount} touched=${snapshot.touchedCount} regen=${snapshot.regeneratedCells} stitch=${snapshot.stitchedCells}`,
    `Волна cleanup: containers-${snapshot.deletedContainers} items-${snapshot.deletedItems} proj-${snapshot.deletedProjectiles} cues-${snapshot.prunedRouteCues} reloc=${snapshot.relocatedEntities}`,
  ];
}

export function isSamosborWaveActive(): boolean {
  return activeWave?.active === true;
}

export function isSamosborWaveDebugActive(): boolean {
  return activeWave?.active === true && activeWave.debug === true;
}

export function cancelSamosborWave(): void {
  if (activeWave) {
    activeWave.active = false;
    activeWave.finished = true;
    lastWaveSnapshot = buildSnapshot(activeWave, false);
  }
  unfreezeNavigationCacheForWorld();
  activeWave = null;
}

export function startSamosborWave(
  world: World,
  _entities: readonly Entity[],
  state: GameState,
  scale: SamosborWaveScale,
  originX: number,
  originY: number,
  options: StartSamosborWaveOptions = {},
): boolean {
  if (scale === "full" || !canRunSamosborWave(state)) return false;
  cancelSamosborWave();

  const wave = createInitialSamosborWave(
    world,
    _entities,
    state,
    scale,
    originX,
    originY,
    options,
  );

  const anchorIdx = findWaveOrigin(world, wave, originX, originY);
  if (anchorIdx < 0) return false;

  setupActiveSamosborWave(world, state, wave, anchorIdx, options);
  notifySamosborWaveStart(state, wave, anchorIdx);

  lastWaveSnapshot = buildSnapshot(wave, true);
  return true;
}

function createInitialSamosborWave(
  world: World,
  _entities: readonly Entity[],
  state: GameState,
  scale: SamosborWaveScale,
  originX: number,
  originY: number,
  options: StartSamosborWaveOptions,
): SamosborWave {
  const def = SAMOSBOR_WAVE_SCALE_DEFS[scale];
  const radius = Math.max(3, options.radius ?? def.radius);
  const budgetCellsPerTick = Math.max(
    1,
    options.budgetCellsPerTick ?? def.budgetCellsPerTick,
  );
  const durationSec = Math.max(0, options.durationSec ?? 0);
  const estimatedCells = Math.max(
    8,
    Math.ceil(Math.PI * radius * radius * 0.72),
  );
  const budgetCellsPerSecond =
    durationSec > 0
      ? Math.max(1, Math.ceil(estimatedCells / Math.max(1, durationSec)))
      : 0;
  const protectedRooms = new Set<number>();
  for (const roomId of options.protectedRoomIds ?? [])
    if (roomId >= 0) protectedRooms.add(roomId);

  const originIdx = world.idx(originX, originY);
  return {
    active: true,
    scale: scale as 'small' | 'medium',
    seed: options.seed ?? seedForWave(state, scale as 'small' | 'medium', originIdx),
    originIdx,
    radius,
    budgetCellsPerTick,
    durationSec,
    budgetCellsPerSecond,
    budgetCarry: 0,
    lastTickAt: state.time,
    frontier: [],
    head: 0,
    queued: new Uint8Array(W * W),
    spreadable: new Uint8Array(W * W),
    queuedCount: 0,
    fieldRadius: radius + LOCAL_REBUILD_HALO,
    fieldCells: 0,
    touched: [],
    dirtyRooms: [],
    finished: false,
    regenerated: false,
    patchRoomId: -1,
    protectedRooms,
    player: _entities.find((e) => isPlayerEntity(e) && e.alive),
    floor: state.currentFloor,
    startedAt: state.time,
    changedCells: 0,
    regeneratedCells: 0,
    stitchedCells: 0,
    deletedContainers: 0,
    deletedItems: 0,
    deletedProjectiles: 0,
    relocatedEntities: 0,
    prunedRouteCues: 0,
    lastProcessed: 0,
    lastChanged: 0,
    debugSnapshotTick: -999999,
    debug: options.debug === true,
  };
}

function setupActiveSamosborWave(
  world: World,
  state: GameState,
  wave: SamosborWave,
  anchorIdx: number,
  options: StartSamosborWaveOptions,
): void {
  freezeNavigationCacheForWorld(world);
  wave.originIdx = anchorIdx;
  wave.seed = options.seed ?? seedForWave(state, wave.scale, anchorIdx);
  wave.patchRoomId = makePatchRoom(world, wave);
  activeWave = wave;
  enqueueCell(world, wave, anchorIdx);
  enqueueNeighbors(world, wave, anchorIdx);
}

function notifySamosborWaveStart(
  state: GameState,
  wave: SamosborWave,
  anchorIdx: number,
): void {
  const ax = anchorIdx % W;
  const ay = (anchorIdx / W) | 0;
  state.msgs.push(
    msg(
      wave.scale === "small"
        ? `Малый самосбор пошёл волной от ${ax},${ay}.`
        : `Средний самосбор пошёл волной от ${ax},${ay}.`,
      state.time,
      "#c8f",
    ),
  );
  publishEvent(state, {
    type: "room_regrown",
    x: ax,
    y: ay,
    severity: wave.scale === "small" ? 3 : 4,
    privacy: "public",
    tags: ["samosbor", "wave", "start", wave.scale],
    data: {
      scale: wave.scale,
      radius: wave.radius,
      fieldRadius: wave.fieldRadius,
      budgetCellsPerTick: wave.budgetCellsPerTick,
      durationSec: wave.durationSec || undefined,
      budgetCellsPerSecond: wave.budgetCellsPerSecond || undefined,
      seed: wave.seed,
    },
  });
}

export function tickSamosborWave(
  world: World,
  entities: Entity[],
  state: GameState,
): SamosborWaveTickResult {
  const wave = activeWave;
  if (!wave?.active) return EMPTY_WAVE_RESULT;
  if (wave.floor !== state.currentFloor) {
    cancelSamosborWave();
    return { active: false, processed: 0, changed: 0, finished: true };
  }

  const flags: DirtyFlags = {
    cells: false,
    wallTex: false,
    floorTex: false,
    light: false,
    fog: false,
    surface: false,
    visualSlots: false,
  };
  const batchTouched: number[] = [];
  let budget = wave.budgetCellsPerTick;
  if (wave.durationSec > 0) {
    const dt = Math.max(1 / 60, Math.min(1, state.time - wave.lastTickAt));
    wave.lastTickAt = state.time;
    const available = wave.budgetCarry + wave.budgetCellsPerSecond * dt;
    budget = Math.min(wave.budgetCellsPerTick, Math.floor(available));
    wave.budgetCarry = available - budget;
    if (budget <= 0) {
      wave.lastProcessed = 0;
      wave.lastChanged = 0;
      lastWaveSnapshot = buildSnapshot(wave, true);
      return { active: true, processed: 0, changed: 0, finished: false };
    }
  }
  let processed = 0;
  let changed = 0;
  while (processed < budget && wave.head < wave.frontier.length) {
    const idx = wave.frontier[wave.head++];
    processed++;
    if (!withinWaveRadius(world, wave, idx)) continue;
    if (applyWaveCell(world, wave, idx, flags)) {
      changed++;
      batchTouched.push(idx);
    }
    enqueueNeighbors(world, wave, idx);
  }
  markDirty(world, flags, dirtyRectsForIndices(batchTouched));
  cleanupBatchEntities(world, wave, entities, batchTouched);
  if (batchTouched.length > 0)
    rebuildPathBlockersFromWorldObjects(world, wave.seed, batchTouched);
  wave.lastProcessed = processed;
  wave.lastChanged = changed;
  const tick = state.tick ?? 0;
  if (wave.debug || tick - wave.debugSnapshotTick >= WAVE_SNAPSHOT_MIN_TICKS) {
    lastWaveSnapshot = buildSnapshot(wave, true);
    wave.debugSnapshotTick = tick;
  }

  if (wave.head >= wave.frontier.length) {
    finishSamosborWave(world, entities, state);
    return { active: false, processed, changed, finished: true };
  }
  return { active: true, processed, changed, finished: false };
}

function completeWaveRuntime(
  world: World,
  entities: Entity[],
  state: GameState,
  wave: SamosborWave,
): void {
  if (wave.finished) return;
  const touchedSet = new Set(wave.touched);
  cleanupContainers(world, wave, touchedSet, state.currentFloor);
  cleanupFinalEntities(world, wave, entities, touchedSet);
  pruneScreenAndSlideCells(world, touchedSet);
  rebuildPathBlockersFromWorldObjects(world, wave.seed, wave.touched);
  wave.prunedRouteCues += pruneRouteCuesInCells(world, touchedSet);
  wave.active = false;
  wave.finished = true;
  lastWaveSnapshot = buildSnapshot(wave, false);

  const ox = wave.originIdx % W;
  const oy = (wave.originIdx / W) | 0;
  publishEvent(state, {
    type: "room_regrown",
    x: ox,
    y: oy,
    severity: wave.scale === "small" ? 3 : 4,
    privacy: "public",
    tags: ["samosbor", "wave", "finish", wave.scale],
    data: {
      scale: wave.scale,
      touchedCells: wave.touched.length,
      changedCells: wave.changedCells,
      fieldRadius: wave.fieldRadius,
      dirtyRooms: wave.dirtyRooms.slice(0, 16),
      deletedContainers: wave.deletedContainers,
      deletedItems: wave.deletedItems,
      deletedProjectiles: wave.deletedProjectiles,
      prunedRouteCues: wave.prunedRouteCues,
      relocatedEntities: wave.relocatedEntities,
    },
  });
}

export function finishSamosborWave(
  world: World,
  entities: Entity[],
  state: GameState,
  replacement?: FloorGeneration,
): SamosborWaveDebugSnapshot | null {
  const wave = activeWave;
  if (!wave) return lastWaveSnapshot;
  completeWaveRuntime(world, entities, state, wave);
  if (replacement) {
    applyGeneratedFieldPatch(world, entities, state, wave, replacement);
    lastWaveSnapshot = buildSnapshot(wave, false);
    unfreezeNavigationCacheForWorld(world);
    activeWave = null;
    return lastWaveSnapshot;
  }
  lastWaveSnapshot = buildSnapshot(wave, false);
  if (!state.samosborActive || wave.debug) {
    unfreezeNavigationCacheForWorld(world);
    activeWave = null;
  }
  return lastWaveSnapshot;
}

export function debugStartSamosborWaveAtPlayer(
  world: World,
  player: Entity,
  entities: Entity[],
  state: GameState,
  scale: "small" | "medium" = "small",
): string[] {
  const started = startSamosborWave(
    world,
    entities,
    state,
    scale,
    Math.floor(player.x),
    Math.floor(player.y),
    {
      debug: true,
      seed: 0x51a0b0,
    },
  );
  if (!started)
    return ["wave start failed: mutable local floor anchor required"];
  const tick = tickSamosborWave(world, entities, state);
  const snapshot = getSamosborWaveDebugSnapshot();
  return [
    `wave ${scale} origin=${snapshot ? `${snapshot.originIdx % W},${(snapshot.originIdx / W) | 0}` : "-"}`,
    `frontier=${snapshot?.head ?? 0}/${snapshot?.frontierLength ?? 0} touched=${snapshot?.touchedCount ?? 0}`,
    `budget=${snapshot?.budgetCellsPerTick ?? 0} processed=${tick.processed} changed=${tick.changed}`,
  ];
}

export function classifySamosborWaveCellForTests(
  seed: number,
  originIdx: number,
  idx: number,
  ring: number,
): WaveRole {
  return waveRole(seed, originIdx, idx, ring);
}
