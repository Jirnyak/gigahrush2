import { Cell, Feature, RoomType, W, type Room } from '../core/types';
import {
  EMPTY_VISUAL_CELL_CODE,
  VISUAL_SLOTS_PER_CELL,
  World,
  clearVisualSlots,
  getVisualSlot,
  setVisualSlot,
  visualSlotOffset,
} from '../core/world';
import {
  visualCellDefByCode,
  visualCellDefById,
  type VisualCellDef,
  type VisualCellSource,
} from '../data/visual_cell_slots';

export interface VisualCellFaceResolution {
  sourceCell: number;
  wallCell?: number;
  normalX: -1 | 0 | 1;
  normalY: -1 | 0 | 1;
  mount: VisualCellDef['mount'];
  zBand?: VisualCellDef['zBand'];
  source: VisualCellSource;
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

interface VisualDecorCandidate {
  room: Room;
  idx: number;
  x: number;
  y: number;
  score: number;
}

export interface VisualSlotRoomDecorOptions {
  seed: number;
  tags?: readonly string[];
  reachable?: Uint8Array;
  wallCap?: number;
  ceilingCap?: number;
  columnCap?: number;
  maxPerRoom?: number;
  avoidX?: number;
  avoidY?: number;
}

export interface VisualSlotRoomDecorSummary {
  wallFixtures: number;
  ceilingDetails: number;
  columns: number;
}

function normalComponent(value: number): -1 | 0 | 1 {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

const FEATURE_VISUAL_IDS: Partial<Record<Feature, readonly string[]>> = {
  [Feature.TABLE]: ['furniture_table_hint'],
  [Feature.CHAIR]: ['furniture_chair_hint'],
  [Feature.BED]: ['furniture_bed_hint'],
  [Feature.STOVE]: ['machine_body'],
  [Feature.MACHINE]: ['machine_body', 'machine_panel', 'ceiling_pipe_bundle'],
  [Feature.APPARATUS]: ['apparatus_frame', 'ceiling_cable_bundle'],
  [Feature.LIFT_BUTTON]: ['button_panel'],
  [Feature.DESK]: ['furniture_desk_hint'],
  [Feature.CANDLE]: ['candle_stub_hint'],
  [Feature.SCREEN]: ['wall_panel_screen', 'cable_wall_loose'],
  [Feature.LAMP]: ['ceiling_bulb', 'ceiling_light_panel'],
};



function hash32(seed: number, a: number, b = 0, c = 0): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (a + 0x85ebca6b), 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ (b + 0x27d4eb2d), 0x165667b1) >>> 0;
  h = Math.imul(h ^ (c + 0xd3a2646c), 0x9e3779b1) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

function visualDefOrThrow(code: number): VisualCellDef {
  const def = visualCellDefByCode(code);
  if (!def || code === EMPTY_VISUAL_CELL_CODE) throw new RangeError(`unknown visual cell code: ${code}`);
  return def;
}

function visualCodeForId(id: string): number {
  const def = visualCellDefById(id);
  if (!def) throw new Error(`unknown visual cell id: ${id}`);
  return def.code;
}

function cellHasVisualCode(world: World, cellIdx: number, code: number): boolean {
  const offset = visualSlotOffset(cellIdx, 0);
  for (let slot = 0; slot < VISUAL_SLOTS_PER_CELL; slot++) {
    if (world.visualSlots[offset + slot] === code) return true;
  }
  return false;
}

function isPassableVisualSource(world: World, idx: number): boolean {
  const cell = world.cells[idx];
  return cell === Cell.FLOOR || cell === Cell.WATER;
}

function isWallVisualSource(world: World, idx: number): boolean {
  return world.cells[idx] === Cell.WALL || world.cells[idx] === Cell.LIFT;
}

function visualPriorityScore(def: VisualCellDef, seed: number, cellIdx: number, slot: number): number {
  return def.priority * 1_000_000 + (hash32(seed, cellIdx, def.code, slot) & 0xffff);
}

export function visualSlotStableHash(seed: number, cellIdx: number, slot: number, code = 0): number {
  return hash32(seed, cellIdx, slot, code);
}

export function clearVisualSlotRegion(world: World, x: number, y: number, w: number, h: number): number {
  let changed = 0;
  const width = Math.max(0, Math.floor(w));
  const height = Math.max(0, Math.floor(h));
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      if (clearVisualSlots(world, world.idx(x + dx, y + dy))) changed++;
    }
  }
  return changed;
}

export function removeVisualSlotCode(world: World, cellIdx: number, code: number): number {
  let removed = 0;
  const offset = visualSlotOffset(cellIdx, 0);
  for (let slot = 0; slot < VISUAL_SLOTS_PER_CELL; slot++) {
    if (world.visualSlots[offset + slot] === code) {
      setVisualSlot(world, cellIdx, slot, EMPTY_VISUAL_CELL_CODE);
      removed++;
    }
  }
  return removed;
}

export function addVisualSlotFirstFree(world: World, cellIdx: number, code: number): number {
  visualDefOrThrow(code);
  const offset = visualSlotOffset(cellIdx, 0);
  for (let slot = 0; slot < VISUAL_SLOTS_PER_CELL; slot++) {
    if (world.visualSlots[offset + slot] !== EMPTY_VISUAL_CELL_CODE) continue;
    setVisualSlot(world, cellIdx, slot, code);
    return slot;
  }
  return -1;
}

export function hasVisualSlotCode(world: World, cellIdx: number, code: number): boolean {
  const offset = visualSlotOffset(cellIdx, 0);
  for (let slot = 0; slot < VISUAL_SLOTS_PER_CELL; slot++) {
    if (world.visualSlots[offset + slot] === code) return true;
  }
  return false;
}

export function findMeatChunkCell(world: World, cx: number, cy: number, maxRadius: number): { x: number, y: number } | null {
  const r = Math.ceil(maxRadius);
  const maxD2 = maxRadius * maxRadius;
  let best: { x: number, y: number } | null = null;
  let bestD2 = maxD2;
  
  const cxInt = Math.floor(cx);
  const cyInt = Math.floor(cy);

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 >= bestD2) continue;
      const x = world.wrap(cxInt + dx);
      const y = world.wrap(cyInt + dy);
      const idx = world.idx(x, y);
      if (hasVisualSlotCode(world, idx, 34)) { // 34 = organic_meat_lump
        best = { x, y };
        bestD2 = d2;
      }
    }
  }
  return best;
}

export function addVisualSlotByPriority(world: World, cellIdx: number, code: number, seed: number): number {
  const incoming = visualDefOrThrow(code);
  const free = addVisualSlotFirstFree(world, cellIdx, code);
  if (free >= 0) return free;

  let replaceSlot = -1;
  let replaceScore = Number.POSITIVE_INFINITY;
  for (let slot = 0; slot < VISUAL_SLOTS_PER_CELL; slot++) {
    const existingCode = getVisualSlot(world, cellIdx, slot);
    const existing = visualCellDefByCode(existingCode);
    const score = existing
      ? visualPriorityScore(existing, seed, cellIdx, slot)
      : Number.NEGATIVE_INFINITY;
    if (score < replaceScore) {
      replaceScore = score;
      replaceSlot = slot;
    }
  }

  const incomingScore = visualPriorityScore(incoming, seed, cellIdx, replaceSlot);
  if (replaceSlot < 0 || incomingScore <= replaceScore) return -1;
  setVisualSlot(world, cellIdx, replaceSlot, code);
  return replaceSlot;
}

export function featureVisualCellIds(feature: Feature): readonly string[] {
  return FEATURE_VISUAL_IDS[feature] ?? [];
}

function featureVisualCellIdsForFill(feature: Feature): readonly string[] {
  return featureVisualCellIds(feature);
}

export function fillVisualSlotsFromFeature(world: World, cellIdx: number, seed: number): number {
  const feature = world.features[cellIdx] as Feature;
  let placed = 0;
  let ordinal = 0;
  for (const id of featureVisualCellIdsForFill(feature)) {
    const code = visualCodeForId(id);
    if (cellHasVisualCode(world, cellIdx, code)) {
      ordinal++;
      continue;
    }
    const slot = addVisualSlotByPriority(world, cellIdx, code, hash32(seed, cellIdx, ordinal++));
    if (slot >= 0) placed++;
  }
  return placed;
}

export function fillVisualSlotsForWorldFeatures(world: World, seed: number, cells?: Iterable<number>): number {
  let placed = 0;
  if (cells) {
    for (const idx of cells) placed += fillVisualSlotsFromFeature(world, idx, seed);
    return placed;
  }
  for (let idx = 0; idx < W * W; idx++) {
    if (world.features[idx] === Feature.NONE) continue;
    placed += fillVisualSlotsFromFeature(world, idx, seed);
  }
  return placed;
}

export function rebuildVisualSlotsFromWorldFeatures(world: World, seed: number): number {
  world.visualSlots.fill(EMPTY_VISUAL_CELL_CODE);
  world.markVisualSlotsDirty();
  return fillVisualSlotsForWorldFeatures(world, seed);
}

function tagSet(tags: readonly string[] | undefined): ReadonlySet<string> {
  return new Set(tags ?? []);
}

function hasAnyTag(tags: ReadonlySet<string>, values: readonly string[]): boolean {
  for (const value of values) {
    if (tags.has(value)) return true;
  }
  return false;
}

function roomEligibleForDecor(room: Room): boolean {
  return !!room &&
    !room.sealed &&
    room.apartmentId < 0 &&
    room.w >= 4 &&
    room.h >= 4;
}

function isReachableFloor(world: World, idx: number, reachable: Uint8Array | undefined): boolean {
  if (reachable && !reachable[idx]) return false;
  return world.cells[idx] === Cell.FLOOR;
}

function doorNear(world: World, x: number, y: number, radius = 1): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const idx = world.idx(x + dx, y + dy);
      if (world.cells[idx] === Cell.DOOR || world.doors.has(idx)) return true;
    }
  }
  return false;
}

function wallFacesRoomTangent(world: World, room: Room, idx: number): readonly [number, number] | null {
  const x = idx % W;
  const y = (idx / W) | 0;
  for (const [dx, dy] of DIRS) {
    const ni = world.idx(x + dx, y + dy);
    if (world.roomMap[ni] !== room.id || !isReachableFloor(world, ni, undefined)) continue;
    return dx !== 0 ? [0, 1] : [1, 0];
  }
  return null;
}

function wallCellAllowedForVisualDecor(
  world: World,
  room: Room,
  idx: number,
  reachable: Uint8Array | undefined,
): boolean {
  if (world.cells[idx] !== Cell.WALL) return false;
  if (world.hermoWall[idx] || world.aptMask[idx] || world.doors.has(idx) || world.containerMap.has(idx)) return false;
  if (world.features[idx] !== Feature.NONE) return false;
  const x = idx % W;
  const y = (idx / W) | 0;
  if (doorNear(world, x, y, 1)) return false;
  for (const [dx, dy] of DIRS) {
    const ni = world.idx(x + dx, y + dy);
    if (world.roomMap[ni] === room.id && isReachableFloor(world, ni, reachable)) return true;
  }
  return false;
}

function collectRoomWallDecorCandidates(
  world: World,
  room: Room,
  seed: number,
  reachable: Uint8Array | undefined,
): VisualDecorCandidate[] {
  const out: VisualDecorCandidate[] = [];
  const seen = new Set<number>();
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const idx = world.idx(x, y);
      if (seen.has(idx) || !wallCellAllowedForVisualDecor(world, room, idx, reachable)) continue;
      seen.add(idx);
      out.push({ room, idx, x, y, score: hash32(seed, idx, room.id, 0x77616c) & 0xffff });
    }
  }
  return out;
}

function floorCellAllowedForVisualDecor(
  world: World,
  room: Room,
  idx: number,
  reachable: Uint8Array | undefined,
  requireEmptyFeature: boolean,
): boolean {
  if (world.roomMap[idx] !== room.id || !isReachableFloor(world, idx, reachable)) return false;
  if (world.hermoWall[idx] || world.aptMask[idx] || world.doors.has(idx) || world.containerMap.has(idx)) return false;
  if (requireEmptyFeature && world.features[idx] !== Feature.NONE) return false;
  const x = idx % W;
  const y = (idx / W) | 0;
  return !doorNear(world, x, y, 1);
}

function collectRoomFloorDecorCandidates(
  world: World,
  room: Room,
  seed: number,
  reachable: Uint8Array | undefined,
  requireEmptyFeature: boolean,
): VisualDecorCandidate[] {
  const out: VisualDecorCandidate[] = [];
  for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
    for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
      const idx = world.idx(x, y);
      if (!floorCellAllowedForVisualDecor(world, room, idx, reachable, requireEmptyFeature)) continue;
      out.push({
        room,
        idx,
        x: world.wrap(x),
        y: world.wrap(y),
        score: hash32(seed, idx, room.id, 0x666c72) & 0xffff,
      });
    }
  }
  return out;
}

// ── Floor-class decor tables ──────────────────────────────────────
// Each floor class defines which wall, ceiling and column models it uses.
// Adding a new class: append a row here and a matching branch in
// visualDecorCaps if density needs adjustment.

interface FloorDecorClass {
  wallIds: readonly string[];
  ceilingIds: readonly string[];
  columnId: string;
}

const FLOOR_DECOR_CLASSES: readonly {
  tags: readonly string[];
  decor: FloorDecorClass;
}[] = [
  // Industrial / maintenance / collectors
  {
    tags: ['maintenance', 'collectors', 'industrial', 'pump'],
    decor: {
      wallIds: ['pipe_wall_large', 'cable_wall_loose', 'pipe_wall_small', 'pipe_wall_small'],
      ceilingIds: ['ceiling_pipe_bundle', 'ceiling_cable_bundle'],
      columnId: 'column_concrete_round',
    },
  },
  // Ministry / bureaucratic
  {
    tags: ['ministry', 'bureaucratic', 'paper', 'office'],
    decor: {
      wallIds: ['button_panel', 'wall_panel_flat', 'cable_wall_loose', 'wall_panel_flat'],
      ceilingIds: ['ceiling_light_panel'],
      columnId: 'column_concrete_square',
    },
  },
  // Residential / kvartiry / living
  {
    tags: ['residential', 'kvartiry', 'living', 'public'],
    decor: {
      wallIds: ['button_panel', 'wall_panel_flat', 'cable_wall_loose', 'wall_panel_flat'],
      ceilingIds: ['ceiling_light_panel'],
      columnId: 'column_concrete_square',
    },
  },
  // Void / protocol
  {
    tags: ['void', 'protocol'],
    decor: {
      wallIds: ['wall_panel_screen', 'wall_panel_flat', 'wall_panel_flat', 'wall_panel_flat'],
      ceilingIds: ['ceiling_light_panel'],
      columnId: 'column_concrete_square',
    },
  },
  // Hell / meat — organic horror
  {
    tags: ['hell', 'meat_low', 'gut', 'ritual', 'samosbor', 'meat', 'underhell'],
    decor: {
      wallIds: ['organic_wall_ribs', 'organic_wall_veins', 'cable_wall_loose', 'organic_wall_veins'],
      ceilingIds: ['organic_ceiling_tendrils'],
      columnId: 'organic_column_bone',
    },
  },
  // Cave / mushroom / living tunnels
  {
    tags: ['cave', 'mushroom', 'living_tunnels'],
    decor: {
      wallIds: ['cave_wall_protrusion', 'organic_wall_veins', 'cable_wall_loose', 'cave_wall_protrusion'],
      ceilingIds: ['cave_stalactite', 'organic_ceiling_tendrils'],
      columnId: 'column_concrete_round',
    },
  },
];

const DEFAULT_FLOOR_DECOR: FloorDecorClass = {
  wallIds: ['cable_wall_loose'],
  ceilingIds: ['ceiling_light_panel'],
  columnId: 'column_concrete_square',
};

function floorDecorClass(tags: ReadonlySet<string>): FloorDecorClass {
  for (const entry of FLOOR_DECOR_CLASSES) {
    if (hasAnyTag(tags, entry.tags)) return entry.decor;
  }
  return DEFAULT_FLOOR_DECOR;
}

function visualWallDecorCode(tags: ReadonlySet<string>, hash: number): number {
  const decor = floorDecorClass(tags);
  return visualCodeForId(decor.wallIds[hash & (decor.wallIds.length - 1)] ?? decor.wallIds[0]);
}

function visualCeilingDecorCode(tags: ReadonlySet<string>, hash: number): number {
  const decor = floorDecorClass(tags);
  return visualCodeForId(decor.ceilingIds[hash & (decor.ceilingIds.length - 1)] ?? decor.ceilingIds[0]);
}

function ceilingRunTangent(room: Room, hash: number): readonly [number, number] {
  if (room.w > room.h) return [1, 0];
  if (room.h > room.w) return [0, 1];
  return (hash & 1) === 0 ? [1, 0] : [0, 1];
}

function placeCeilingVisualRun(
  world: World,
  candidate: VisualDecorCandidate,
  code: number,
  seed: number,
  capLeft: number,
  reachable: Uint8Array | undefined,
): number {
  const h = hash32(seed, candidate.idx, code, 0x637275);
  const [tx, ty] = ceilingRunTangent(candidate.room, h);
  const desired = 2 + (h % (candidate.room.type === RoomType.CORRIDOR ? 6 : 4));
  let placed = 0;
  for (let step = 0; step < desired && placed < capLeft; step++) {
    const sx = world.wrap(candidate.x + tx * step);
    const sy = world.wrap(candidate.y + ty * step);
    const idx = world.idx(sx, sy);
    if (!floorCellAllowedForVisualDecor(world, candidate.room, idx, reachable, true)) break;
    if (addVisualSlotByPriority(world, idx, code, hash32(seed, idx, code, step)) >= 0) placed++;
  }
  return placed;
}

function visualDecorCaps(
  rooms: readonly Room[],
  tags: ReadonlySet<string>,
  options: VisualSlotRoomDecorOptions,
): { wall: number; ceiling: number; column: number; maxPerRoom: number } {
  const roomCount = rooms.filter(roomEligibleForDecor).length;
  const industrial = hasAnyTag(tags, ['maintenance', 'collectors', 'industrial', 'pump']);
  const ministry = hasAnyTag(tags, ['ministry', 'bureaucratic', 'paper', 'office']);
  const residential = hasAnyTag(tags, ['residential', 'kvartiry', 'living', 'public']);
  const sparse = hasAnyTag(tags, ['void', 'protocol']);
  const organic = hasAnyTag(tags, ['hell', 'meat_low', 'gut', 'ritual', 'samosbor', 'meat', 'underhell']);
  const cave = hasAnyTag(tags, ['cave', 'mushroom', 'living_tunnels']);
  const wallMul = industrial ? 2.6 : organic ? 2.2 : cave ? 1.8 : ministry ? 2.0 : residential ? 1.45 : sparse ? 0.8 : 1.05;
  const ceilingMul = industrial ? 1.9 : organic ? 1.5 : cave ? 1.4 : ministry ? 1.25 : residential ? 0.85 : sparse ? 0.45 : 0.9;
  const columnMul = ministry ? 0.8 : industrial ? 0.5 : organic ? 0.4 : cave ? 0.35 : residential ? 0.25 : sparse ? 0.12 : 0.35;
  return {
    wall: Math.max(0, Math.min(160, Math.floor(options.wallCap ?? roomCount * wallMul))),
    ceiling: Math.max(0, Math.min(128, Math.floor(options.ceilingCap ?? roomCount * ceilingMul))),
    column: Math.max(0, Math.min(48, Math.floor(options.columnCap ?? roomCount * columnMul))),
    maxPerRoom: Math.max(1, Math.min(8, Math.floor(options.maxPerRoom ?? 3))),
  };
}

function placeWallVisualRun(
  world: World,
  candidate: VisualDecorCandidate,
  code: number,
  seed: number,
  capLeft: number,
  reachable: Uint8Array | undefined,
): number {
  const tangent = wallFacesRoomTangent(world, candidate.room, candidate.idx);
  if (!tangent) return 0;
  const [tx, ty] = tangent;
  const desired = 1 + (hash32(seed, candidate.idx, code, 0x72756e) % 4);
  let placed = 0;
  for (let step = 0; step < desired && placed < capLeft; step++) {
    const sx = world.wrap(candidate.x + tx * step);
    const sy = world.wrap(candidate.y + ty * step);
    const idx = world.idx(sx, sy);
    if (!wallCellAllowedForVisualDecor(world, candidate.room, idx, reachable)) break;
    if (!wallFacesRoomTangent(world, candidate.room, idx)) break;
    if (addVisualSlotByPriority(world, idx, code, hash32(seed, idx, code, step)) >= 0) placed++;
  }
  return placed;
}

function placeWallVisualDecor(
  world: World,
  rooms: readonly Room[],
  tags: ReadonlySet<string>,
  options: VisualSlotRoomDecorOptions,
  cap: number,
): number {
  if (cap <= 0) return 0;
  const candidates: VisualDecorCandidate[] = [];
  for (const room of rooms) {
    if (!roomEligibleForDecor(room)) continue;
    candidates.push(...collectRoomWallDecorCandidates(world, room, hash32(options.seed, room.id, 0x7761), options.reachable));
  }
  candidates.sort((a, b) => b.score - a.score || a.idx - b.idx);
  const perRoom = new Map<number, number>();
  let placed = 0;
  for (const candidate of candidates) {
    if (placed >= cap) break;
    if ((perRoom.get(candidate.room.id) ?? 0) >= (options.maxPerRoom ?? 3)) continue;
    const h = hash32(options.seed, candidate.idx, candidate.room.id, 0x7764);
    const code = visualWallDecorCode(tags, h);
    const made = placeWallVisualRun(world, candidate, code, hash32(options.seed, h, placed), cap - placed, options.reachable);
    if (made <= 0) continue;
    placed += made;
    perRoom.set(candidate.room.id, (perRoom.get(candidate.room.id) ?? 0) + made);
  }
  return placed;
}

function placeCeilingVisualDecor(
  world: World,
  rooms: readonly Room[],
  tags: ReadonlySet<string>,
  options: VisualSlotRoomDecorOptions,
  cap: number,
): number {
  if (cap <= 0) return 0;
  const candidates: VisualDecorCandidate[] = [];
  for (const room of rooms) {
    if (!roomEligibleForDecor(room)) continue;
    if (
      room.type !== RoomType.CORRIDOR &&
      room.type !== RoomType.COMMON &&
      room.type !== RoomType.PRODUCTION &&
      room.type !== RoomType.STORAGE &&
      room.type !== RoomType.OFFICE &&
      room.type !== RoomType.HQ
    ) continue;
    for (const candidate of collectRoomFloorDecorCandidates(world, room, hash32(options.seed, room.id, 0x6365), options.reachable, true)) {
      const lx = candidate.x - room.x;
      const ly = candidate.y - room.y;
      const spacing = room.type === RoomType.CORRIDOR ? 4 : 6;
      const h = hash32(options.seed, candidate.idx, room.id, 0x7370);
      if ((lx + (h & 3)) % spacing !== 0 && (ly + ((h >>> 4) & 3)) % spacing !== 0) continue;
      candidate.score += 250_000 + (h & 0xffff);
      candidates.push(candidate);
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.idx - b.idx);
  let placed = 0;
  const industrial = hasAnyTag(tags, ['maintenance', 'collectors', 'industrial', 'pump']);
  for (const candidate of candidates) {
    if (placed >= cap) break;
    const code = visualCeilingDecorCode(tags, hash32(options.seed, candidate.idx, candidate.room.id, 0x6364));
    if (industrial) {
      placed += placeCeilingVisualRun(world, candidate, code, hash32(options.seed, candidate.idx, code), cap - placed, options.reachable);
    } else if (addVisualSlotByPriority(world, candidate.idx, code, hash32(options.seed, candidate.idx, code)) >= 0) {
      placed++;
    }
  }
  return placed;
}

function placeColumnVisualDecor(
  world: World,
  rooms: readonly Room[],
  options: VisualSlotRoomDecorOptions,
  cap: number,
): number {
  if (cap <= 0) return 0;
  const candidates: VisualDecorCandidate[] = [];
  for (const room of rooms) {
    if (!roomEligibleForDecor(room) || room.type === RoomType.CORRIDOR || room.w < 8 || room.h < 8) continue;
    for (const candidate of collectRoomFloorDecorCandidates(world, room, hash32(options.seed, room.id, 0x636f), options.reachable, true)) {
      const lx = candidate.x - room.x;
      const ly = candidate.y - room.y;
      if (lx < 2 || ly < 2 || lx >= room.w - 2 || ly >= room.h - 2) continue;
      if (options.avoidX !== undefined && options.avoidY !== undefined) {
        const dx = world.delta(candidate.x + 0.5, options.avoidX);
        const dy = world.delta(candidate.y + 0.5, options.avoidY);
        if (dx * dx + dy * dy < 9) continue;
      }
      const spacing = 5 + (hash32(options.seed, room.id, 0x7370) & 1);
      if ((lx + room.id) % spacing !== 0 || (ly + ((room.id * 3) & 7)) % spacing !== 0) continue;
      candidate.score += 500_000 + (hash32(options.seed, candidate.idx, room.id, 0x6363) & 0xffff);
      candidates.push(candidate);
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.idx - b.idx);
  const tags = new Set(options.tags ?? []);
  const decor = floorDecorClass(tags);
  const code = visualCodeForId(decor.columnId);
  let placed = 0;
  for (const candidate of candidates) {
    if (placed >= cap) break;
    if (addVisualSlotByPriority(world, candidate.idx, code, hash32(options.seed, candidate.idx, code)) >= 0) placed++;
  }
  return placed;
}

export function fillVisualSlotsForRoomDecor(
  world: World,
  rooms: readonly Room[],
  options: VisualSlotRoomDecorOptions,
): VisualSlotRoomDecorSummary {
  const tags = tagSet(options.tags);
  const caps = visualDecorCaps(rooms, tags, options);
  const maxPerRoom = caps.maxPerRoom;
  const wallFixtures = placeWallVisualDecor(world, rooms, tags, { ...options, maxPerRoom }, caps.wall);
  const ceilingDetails = placeCeilingVisualDecor(world, rooms, tags, options, caps.ceiling);
  const columns = placeColumnVisualDecor(world, rooms, options, caps.column);
  return { wallFixtures, ceilingDetails, columns };
}

function candidateWallFaces(world: World, wallCell: number): VisualCellFaceResolution[] {
  const out: VisualCellFaceResolution[] = [];
  if (!isWallVisualSource(world, wallCell)) return out;
  const x = wallCell % W;
  const y = (wallCell / W) | 0;
  for (const [dx, dy] of DIRS) {
    const ni = world.idx(x + dx, y + dy);
    if (!isPassableVisualSource(world, ni)) continue;
    out.push({
      sourceCell: wallCell,
      wallCell,
      normalX: dx,
      normalY: dy,
      mount: 'wallFace',
      source: 'wallCell',
    });
  }
  return out;
}

function deterministicFace(
  faces: readonly VisualCellFaceResolution[],
  seed: number,
  cellIdx: number,
  slot: number,
  code: number,
): VisualCellFaceResolution | null {
  if (faces.length <= 0) return null;
  return faces[hash32(seed, cellIdx, slot, code) % faces.length] ?? null;
}

function resolveWallCellVisual(
  world: World,
  cellIdx: number,
  def: VisualCellDef,
  slot: number,
  seed: number,
): VisualCellFaceResolution | null {
  const face = deterministicFace(candidateWallFaces(world, cellIdx), seed, cellIdx, slot, def.code);
  return face ? { ...face, mount: def.mount, zBand: def.zBand, source: 'wallCell' } : null;
}

function resolveAdjacentWallVisual(
  world: World,
  cellIdx: number,
  def: VisualCellDef,
  slot: number,
  seed: number,
): VisualCellFaceResolution | null {
  if (!isPassableVisualSource(world, cellIdx)) return null;
  const x = cellIdx % W;
  const y = (cellIdx / W) | 0;
  const faces: VisualCellFaceResolution[] = [];
  for (const [dx, dy] of DIRS) {
    const wallCell = world.idx(x + dx, y + dy);
    if (!isWallVisualSource(world, wallCell)) continue;
    faces.push({
      sourceCell: cellIdx,
      wallCell,
      normalX: normalComponent(-dx),
      normalY: normalComponent(-dy),
      mount: def.mount,
      zBand: def.zBand,
      source: 'adjacentWallCell',
    });
  }
  return deterministicFace(faces, seed, cellIdx, slot, def.code);
}

function resolveFloorVisual(world: World, cellIdx: number, def: VisualCellDef): VisualCellFaceResolution | null {
  if (!isPassableVisualSource(world, cellIdx)) return null;
  return {
    sourceCell: cellIdx,
    normalX: 0,
    normalY: 0,
    mount: def.mount,
    zBand: def.zBand,
    source: 'floorCell',
  };
}

export function resolveVisualCellFace(
  world: World,
  cellIdx: number,
  slot: number,
  seed: number,
): VisualCellFaceResolution | null {
  const code = getVisualSlot(world, cellIdx, slot);
  if (code === EMPTY_VISUAL_CELL_CODE) return null;
  const def = visualDefOrThrow(code);

  if (def.source === 'wallCell') return resolveWallCellVisual(world, cellIdx, def, slot, seed);
  if (def.source === 'adjacentWallCell') return resolveAdjacentWallVisual(world, cellIdx, def, slot, seed);
  if (def.source === 'floorCell') return resolveFloorVisual(world, cellIdx, def);

  return resolveWallCellVisual(world, cellIdx, def, slot, seed) ??
    resolveAdjacentWallVisual(world, cellIdx, def, slot, seed) ??
    resolveFloorVisual(world, cellIdx, def);
}

export function visualWallLineMergeCompatible(
  world: World,
  aCellIdx: number,
  aSlot: number,
  bCellIdx: number,
  bSlot: number,
  seed: number,
): boolean {
  const aCode = getVisualSlot(world, aCellIdx, aSlot);
  const bCode = getVisualSlot(world, bCellIdx, bSlot);
  const aDef = visualCellDefByCode(aCode);
  const bDef = visualCellDefByCode(bCode);
  if (!aDef || !bDef || aDef.merge !== 'wallLine' || bDef.merge !== 'wallLine') return false;
  if (aDef.family !== bDef.family) return false;

  const a = resolveVisualCellFace(world, aCellIdx, aSlot, seed);
  const b = resolveVisualCellFace(world, bCellIdx, bSlot, seed);
  if (!a?.wallCell || !b?.wallCell) return false;
  if (a.normalX !== b.normalX || a.normalY !== b.normalY) return false;

  const ax = a.wallCell % W;
  const ay = (a.wallCell / W) | 0;
  const bx = b.wallCell % W;
  const by = (b.wallCell / W) | 0;
  const dx = world.delta(ax, bx);
  const dy = world.delta(ay, by);
  if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
  if (a.normalX !== 0) return dy !== 0;
  if (a.normalY !== 0) return dx !== 0;
  return false;
}
