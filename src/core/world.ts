/* ── Toroidal world grid ──────────────────────────────────────── */

import {
  W, Cell, DoorState, Feature, Tex,
  type RailTrain,
  type RailTrainTrack,
  type Room,
  type Door,
  type Zone,
  type WorldContainer,
} from './types';
import { PATH_BLOCKER_ROWS_PER_CELL } from './path_blockers';

export interface WorldGenerationLike {
  world: World;
}

export interface WorldGridDirtyRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ReachabilityReason =
  | 'open'
  | 'water'
  | 'door_open'
  | 'door_closed'
  | 'door_locked'
  | 'door_hermetic_open'
  | 'door_hermetic_closed'
  | 'door_missing'
  | 'lift'
  | 'wall'
  | 'abyss'
  | 'blocked';

export const REACH_GATE_NONE = 0;
export const REACH_GATE_KEY = 1 << 0;
export const REACH_GATE_HERMETIC = 1 << 1;
export const REACH_UNREACHED = 255;
export const SURFACE_FLAG_CHALK_MAP = 1 << 0;
export const VISUAL_SLOTS_PER_CELL = 16;
export const EMPTY_VISUAL_CELL_CODE = 0;

export interface ReachabilityCell {
  passable: boolean;
  reason: ReachabilityReason;
  gateMask: number;
}

export type ReachabilityReasonCounts = Partial<Record<ReachabilityReason, number>>;

export interface ReachabilityAudit {
  reachable: Uint8Array;
  gateMask: Uint8Array;
  reasonCounts: ReachabilityReasonCounts;
}

function nextVersion(version: number): number {
  return (version + 1) | 0;
}

const MAX_GRID_DIRTY_RECTS = 32;
const MAX_SURFACE_DIRTY_CELLS = 512;
type GridDirtyRectsInput = WorldGridDirtyRect | readonly WorldGridDirtyRect[] | undefined;
type PendingGridDirtyRects = WorldGridDirtyRect[] | null;

function normalizeGridDirtyRect(rect: WorldGridDirtyRect): WorldGridDirtyRect | null {
  const x = Math.max(0, Math.min(W, Math.floor(rect.x)));
  const y = Math.max(0, Math.min(W, Math.floor(rect.y)));
  const w = Math.max(0, Math.ceil(rect.w));
  const h = Math.max(0, Math.ceil(rect.h));
  if (w <= 0 || h <= 0 || x >= W || y >= W) return { x: 0, y: 0, w: W, h: W };
  const x2 = Math.min(W, x + w);
  const y2 = Math.min(W, y + h);
  if (x === 0 && y === 0 && x2 === W && y2 === W) return null;
  return { x, y, w: x2 - x, h: y2 - y };
}

function appendGridDirtyRects(current: PendingGridDirtyRects, input: GridDirtyRectsInput): PendingGridDirtyRects {
  if (!input || current === null) return null;
  const list = Array.isArray(input) ? input : [input];
  for (const candidate of list) {
    const rect = normalizeGridDirtyRect(candidate);
    if (!rect) return null;
    current.push(rect);
    if (current.length > MAX_GRID_DIRTY_RECTS) return null;
  }
  return current;
}

function markWorldReplaced(world: World, versions: {
  cellVersion: number;
  surfaceVersion: number;
  wallTexVersion: number;
  floorTexVersion: number;
  featureVersion: number;
  lightVersion: number;
  fogVersion: number;
  visualSlotVersion: number;
  pathBlockerVersion: number;
}): void {
  world.cellVersion = nextVersion(versions.cellVersion);
  world.surfaceVersion = nextVersion(versions.surfaceVersion);
  world.wallTexVersion = nextVersion(versions.wallTexVersion);
  world.floorTexVersion = nextVersion(versions.floorTexVersion);
  world.featureVersion = nextVersion(versions.featureVersion);
  world.lightVersion = nextVersion(versions.lightVersion);
  world.fogVersion = nextVersion(versions.fogVersion);
  world.visualSlotVersion = nextVersion(versions.visualSlotVersion);
  world.visualSlotDirtyVersion = world.visualSlotVersion;
  world.pathBlockerVersion = nextVersion(versions.pathBlockerVersion);
  world.pathBlockerDirtyVersion = world.pathBlockerVersion;
  world.clearPendingGridDirtyRects();
  world.markSurfaceUploadDirty();
}

function lightFeature(feature: number): boolean {
  return feature === Feature.LAMP || feature === Feature.CANDLE;
}

const LIGHT_MAX_RADIUS = 8;
const LIGHT_GRID_SIZE = LIGHT_MAX_RADIUS * 2 + 1;
const LIGHT_QUEUE_CAP = LIGHT_GRID_SIZE * LIGHT_GRID_SIZE;
const LIGHT_QUEUE_DX = new Int16Array(LIGHT_QUEUE_CAP);
const LIGHT_QUEUE_DY = new Int16Array(LIGHT_QUEUE_CAP);
const LIGHT_SEEN = new Uint8Array(LIGHT_QUEUE_CAP);
const LIGHT_DIR_X = [1, -1, 0, 0] as const;
const LIGHT_DIR_Y = [0, 0, 1, -1] as const;

function localLightIndex(dx: number, dy: number): number {
  return (dy + LIGHT_MAX_RADIUS) * LIGHT_GRID_SIZE + dx + LIGHT_MAX_RADIUS;
}

function lightPassesCell(world: World, idx: number): boolean {
  if (world.hermoWall[idx]) return false;
  switch (world.cells[idx]) {
    case Cell.FLOOR:
    case Cell.WATER:
      return true;
    case Cell.DOOR: {
      const door = world.doors.get(idx);
      return door?.state === DoorState.OPEN || door?.state === DoorState.HERMETIC_OPEN;
    }
    default:
      return false;
  }
}

function featureLightParams(feature: Feature): { radius: number; intensity: number } | null {
  if (feature === Feature.LAMP) return { radius: 8, intensity: 1.0 };
  if (feature === Feature.CANDLE) return { radius: 5, intensity: 0.62 };
  return null;
}

export class World {
  cells:     Uint8Array;
  roomMap:   Int16Array;   // room id per cell (-1 = none)
  wallTex:   Uint8Array;
  floorTex:  Uint8Array;
  features:  Uint8Array;   // Feature enum per cell
  lampBlinks: Uint8Array;  // Blink frequency (0 = solid) per cell for lamps
  light:     Float32Array; // lightmap 0..1 per cell
  lightBlinks: Uint8Array; // light blink frequency (propagated with light)
  visualSlots: Uint8Array; // render-only visual slots
  pathBlockers: Uint8Array; // gameplay path blocker row masks, 4 bytes per cell
  rooms:     Room[]  = [];
  doors:     Map<number, Door> = new Map();
  apartmentRoomCount = 0;          // first N rooms are permanent apartments
  aptMask:   Uint8Array;           // 1 = protected apartment cell (interior + wall ring)
  hermoWall: Uint8Array;           // 1 = unbreakable hermetic shelter wall
  zones:     Zone[] = [];          // 64 macro-regions
  zoneMap:   Uint8Array;           // zone id per cell (0-63)
  factionControl: Uint8Array;      // per-cell faction control (ZoneFaction enum)
  fog:       Uint8Array;           // purple fog density per cell (0 = clear, 255 = full)
  tissue:    Uint8Array;           // samosbor tissue overlay per cell (0 = clean, 255 = full infection)
  dangerField: Uint8Array;         // fluid dynamic danger/blood vector field (0-255)
  slideCells: number[] = [];       // cell indices of slide walls (cycle textures)
  screenCells: number[] = [];      // cell indices of procedural screen/TV walls
  surfaceMap: Map<number, Uint8Array> = new Map(); // sparse RGBA canvas, 16×16×4 per cell (floors + walls)
  surfaceFlags: Uint8Array;        // bit flags for surfaceMap cells
  anomalyTeleports: Map<number, number> = new Map(); // rare floor-anomaly cell links
  anomalySmogSource = -1;       // procedural smog source cell, -1 = none
  anomalySmogCells: number[] = []; // bounded cells affected by procedural smog
  anomalySmogHandled = false;
  railTracks: RailTrainTrack[] = [];
  railTrains: RailTrain[] = [];
  railTrainCells: Map<number, number> = new Map(); // cell idx -> train index
  cellVersion = 0;                 // bumped when runtime cell solidity changes
  surfaceVersion = 0;              // bumped when surfaceMap pixels change
  wallTexVersion = 0;              // bumped when runtime wall texture data changes
  floorTexVersion = 0;             // bumped when runtime floor texture data changes
  featureVersion = 0;              // bumped when runtime feature data changes
  ceilHeightVersion = 0;           // bumped when render-only ceiling-height tiers change
  lightVersion = 0;                // bumped when baked feature light changes
  fogVersion = 0;                  // bumped when runtime fog data changes
  tissueVersion = 0;               // bumped when tissue overlay changes
  visualSlotVersion = 0;           // bumped when render-only visual slot data changes
  visualSlotDirtyVersion = 0;      // conservative whole-layer invalidation marker for future mesh cache
  pathBlockerVersion = 0;          // bumped when path blocker masks change
  pathBlockerDirtyVersion = 0;     // conservative whole-layer path blocker invalidation marker
  globalCeilingTier?: number;      // if set, forces all open cells to this ceiling tier
  liftDir:   Uint8Array;           // LiftDirection per cell (only meaningful where cells[i] === Cell.LIFT)
  ceilHeight: Uint8Array;          // render-only ceiling-height tier per cell (0 = standard)
  containers: WorldContainer[] = [];
  containerMap: Map<number, number[]> = new Map(); // cell idx -> container ids
  containerById: Map<number, WorldContainer> = new Map();
  private cellDirtyRects: PendingGridDirtyRects = [];
  private wallTexDirtyRects: PendingGridDirtyRects = [];
  private floorTexDirtyRects: PendingGridDirtyRects = [];
  private featureDirtyRects: PendingGridDirtyRects = [];
  private fogDirtyRects: PendingGridDirtyRects = [];
  private tissueDirtyRects: PendingGridDirtyRects = [];
  private surfaceDirtyCells: Set<number> = new Set();
  private surfaceDirtyFull = true;

  constructor() {
    const n = W * W;
    this.cells    = new Uint8Array(n).fill(Cell.WALL);
    this.roomMap  = new Int16Array(n).fill(-1);
    this.wallTex  = new Uint8Array(n);
    this.floorTex = new Uint8Array(n);
    this.features = new Uint8Array(n);              // Feature.NONE = 0
    this.lampBlinks = new Uint8Array(n);            // 0 = no blink
    this.light    = new Float32Array(n);            // 0 = dark
    this.lightBlinks = new Uint8Array(n);           // 0 = no blink
    this.visualSlots = new Uint8Array(n * VISUAL_SLOTS_PER_CELL);
    this.pathBlockers = new Uint8Array(n * PATH_BLOCKER_ROWS_PER_CELL);
    this.aptMask  = new Uint8Array(n);              // 0 = volatile, 1 = apartment-protected
    this.hermoWall = new Uint8Array(n);             // 0 = normal, 1 = unbreakable wall
    this.zoneMap  = new Uint8Array(n);              // zone id
    this.factionControl = new Uint8Array(n);        // per-cell faction (ZoneFaction)
    this.fog      = new Uint8Array(n);              // fog density
    this.tissue   = new Uint8Array(n);              // samosbor tissue overlay
    this.dangerField = new Uint8Array(n);           // fluid dynamic danger/blood
    this.liftDir  = new Uint8Array(n);              // LiftDirection (0=DOWN, 1=UP)
    this.surfaceFlags = new Uint8Array(n);
    this.ceilHeight = new Uint8Array(n);            // 0 = standard ceiling height
  }

  addContainer(container: WorldContainer): void {
    this.containers.push(container);
    this.containerById.set(container.id, container);
    const i = this.idx(container.x, container.y);
    const ids = this.containerMap.get(i);
    if (ids) ids.push(container.id);
    else this.containerMap.set(i, [container.id]);
  }

  rebuildContainerMap(): void {
    this.containerMap.clear();
    this.containerById.clear();
    for (const c of this.containers) {
      this.containerById.set(c.id, c);
      const i = this.idx(c.x, c.y);
      const ids = this.containerMap.get(i);
      if (ids) ids.push(c.id);
      else this.containerMap.set(i, [c.id]);
    }
  }

  containersAt(x: number, y: number): WorldContainer[] {
    const ids = this.containerMap.get(this.idx(x, y));
    if (!ids) return [];
    const out: WorldContainer[] = [];
    for (const id of ids) {
      const c = this.containerById.get(id);
      if (c) out.push(c);
    }
    return out;
  }

  initializeLampBlinks(_seed: number): void {
    // Disabled normal lamp flickering per user feedback.
    // uSamosborAlert will still override frequency during Samosbor.
  }

  /* rebuild lightmap from local feature light sources */
  bakeLights(): void {
    this.light.fill(0);
    this.lightBlinks.fill(0);
    for (let i = 0; i < W * W; i++) {
      const params = featureLightParams(this.features[i] as Feature);
      if (!params) continue;
      const lx = i % W;
      const ly = (i / W) | 0;
      const radius = params.radius;
      const radius2 = radius * radius;
      LIGHT_SEEN.fill(0);

      let head = 0;
      let tail = 0;
      LIGHT_QUEUE_DX[tail] = 0;
      LIGHT_QUEUE_DY[tail] = 0;
      tail++;
      LIGHT_SEEN[localLightIndex(0, 0)] = 1;

      const sourceBrightness = params.intensity;
      const sourceBlink = this.features[i] === Feature.LAMP ? this.lampBlinks[i] : 0;
      if (sourceBrightness > this.light[i]) {
        this.light[i] = sourceBrightness;
        this.lightBlinks[i] = sourceBlink;
      }

      while (head < tail) {
        const dx = LIGHT_QUEUE_DX[head];
        const dy = LIGHT_QUEUE_DY[head];
        head++;
        for (let dir = 0; dir < 4; dir++) {
          const ndx = dx + LIGHT_DIR_X[dir];
          const ndy = dy + LIGHT_DIR_Y[dir];
          if (ndx < -radius || ndx > radius || ndy < -radius || ndy > radius) continue;
          const d2 = ndx * ndx + ndy * ndy;
          if (d2 > radius2) continue;
          const localIdx = localLightIndex(ndx, ndy);
          if (LIGHT_SEEN[localIdx]) continue;
          LIGHT_SEEN[localIdx] = 1;

          const wx = this.wrap(lx + ndx);
          const wy = this.wrap(ly + ndy);
          const ti = wy * W + wx;
          const dist = Math.sqrt(d2);
          const falloff = Math.max(0, 1 - dist / radius);
          const candleSoftness = params.intensity < 1 ? 0.75 + falloff * 0.25 : 1;
          const passable = lightPassesCell(this, ti);
          const brightness = sourceBrightness * falloff * candleSoftness * (passable ? 1 : 0.46);
          if (brightness > this.light[ti]) {
            this.light[ti] = brightness;
            this.lightBlinks[ti] = sourceBlink;
          }
          if (!passable || tail >= LIGHT_QUEUE_CAP) continue;
          LIGHT_QUEUE_DX[tail] = ndx;
          LIGHT_QUEUE_DY[tail] = ndy;
          tail++;
        }
      }
    }
  }

  /* toroidal helpers */
  wrap(v: number): number { return ((v % W) + W) % W; }

  idx(x: number, y: number): number {
    return this.wrap(y | 0) * W + this.wrap(x | 0);
  }

  get(x: number, y: number): number {
    return this.cells[this.idx(x, y)];
  }

  set(x: number, y: number, v: Cell): void {
    this.cells[this.idx(x, y)] = v;
  }

  clearPendingGridDirtyRects(): void {
    this.cellDirtyRects = [];
    this.wallTexDirtyRects = [];
    this.floorTexDirtyRects = [];
    this.featureDirtyRects = [];
    this.fogDirtyRects = [];
    this.tissueDirtyRects = [];
  }

  takeCellDirtyRects(): readonly WorldGridDirtyRect[] | null {
    const rects = this.cellDirtyRects;
    this.cellDirtyRects = [];
    return rects === null ? null : rects.slice();
  }

  takeWallTexDirtyRects(): readonly WorldGridDirtyRect[] | null {
    const rects = this.wallTexDirtyRects;
    this.wallTexDirtyRects = [];
    return rects === null ? null : rects.slice();
  }

  takeFloorTexDirtyRects(): readonly WorldGridDirtyRect[] | null {
    const rects = this.floorTexDirtyRects;
    this.floorTexDirtyRects = [];
    return rects === null ? null : rects.slice();
  }

  takeFeatureDirtyRects(): readonly WorldGridDirtyRect[] | null {
    const rects = this.featureDirtyRects;
    this.featureDirtyRects = [];
    return rects === null ? null : rects.slice();
  }

  takeFogDirtyRects(): readonly WorldGridDirtyRect[] | null {
    const rects = this.fogDirtyRects;
    this.fogDirtyRects = [];
    return rects === null ? null : rects.slice();
  }

  markSurfaceCellDirty(idx: number): void {
    if (!this.surfaceDirtyFull) {
      this.surfaceDirtyCells.add(idx);
      if (this.surfaceDirtyCells.size > MAX_SURFACE_DIRTY_CELLS) {
        this.surfaceDirtyFull = true;
        this.surfaceDirtyCells.clear();
      }
    }
    this.surfaceVersion = nextVersion(this.surfaceVersion);
  }

  markSurfaceCellsDirty(cells: readonly number[]): void {
    if (cells.length <= 0) return;
    if (!this.surfaceDirtyFull) {
      for (const idx of cells) {
        this.surfaceDirtyCells.add(idx);
        if (this.surfaceDirtyCells.size > MAX_SURFACE_DIRTY_CELLS) {
          this.surfaceDirtyFull = true;
          this.surfaceDirtyCells.clear();
          break;
        }
      }
    }
    this.surfaceVersion = nextVersion(this.surfaceVersion);
  }

  markSurfaceDirty(): void {
    this.surfaceDirtyFull = true;
    this.surfaceDirtyCells.clear();
    this.surfaceVersion = nextVersion(this.surfaceVersion);
  }

  markSurfaceUploadDirty(): void {
    this.surfaceDirtyFull = true;
    this.surfaceDirtyCells.clear();
  }

  pendingSurfaceDirtyCells(): readonly number[] | null {
    if (this.surfaceDirtyFull) return null;
    return Array.from(this.surfaceDirtyCells);
  }

  clearPendingSurfaceDirtyCells(): void {
    this.surfaceDirtyFull = false;
    this.surfaceDirtyCells.clear();
  }

  markWallTexDirty(rects?: GridDirtyRectsInput): void {
    this.wallTexVersion = (this.wallTexVersion + 1) | 0;
    this.wallTexDirtyRects = appendGridDirtyRects(this.wallTexDirtyRects, rects);
  }

  markCellsDirty(rects?: GridDirtyRectsInput): void {
    this.cellVersion = (this.cellVersion + 1) | 0;
    this.cellDirtyRects = appendGridDirtyRects(this.cellDirtyRects, rects);
  }

  markFloorTexDirty(rects?: GridDirtyRectsInput): void {
    this.floorTexVersion = (this.floorTexVersion + 1) | 0;
    this.floorTexDirtyRects = appendGridDirtyRects(this.floorTexDirtyRects, rects);
  }

  markFeaturesDirty(rebakeLights = false, rects?: GridDirtyRectsInput): void {
    if (rebakeLights) this.bakeLights();
    if (rebakeLights) this.lightVersion = (this.lightVersion + 1) | 0;
    this.featureVersion = (this.featureVersion + 1) | 0;
    this.featureDirtyRects = appendGridDirtyRects(this.featureDirtyRects, rects);
  }

  markFogDirty(rects?: GridDirtyRectsInput): void {
    this.fogVersion = (this.fogVersion + 1) | 0;
    this.fogDirtyRects = appendGridDirtyRects(this.fogDirtyRects, rects);
  }

  markTissueDirty(rects?: GridDirtyRectsInput): void {
    this.tissueVersion = (this.tissueVersion + 1) | 0;
    this.tissueDirtyRects = appendGridDirtyRects(this.tissueDirtyRects, rects);
  }

  takeTissueDirtyRects(): readonly WorldGridDirtyRect[] | null {
    const rects = this.tissueDirtyRects;
    this.tissueDirtyRects = [];
    return rects === null ? null : rects.slice();
  }

  clearTissue(): void {
    this.tissue.fill(0);
    this.tissueVersion = (this.tissueVersion + 1) | 0;
    this.tissueDirtyRects = null;
  }

  markCeilHeightDirty(): void {
    this.ceilHeightVersion = (this.ceilHeightVersion + 1) | 0;
  }

  markVisualSlotsDirty(): void {
    this.visualSlotVersion = nextVersion(this.visualSlotVersion);
    this.visualSlotDirtyVersion = this.visualSlotVersion;
  }

  setFeatureAt(idx: number, feature: Feature, rebakeLights = true, rects?: GridDirtyRectsInput): boolean {
    const old = this.features[idx] as Feature;
    if (old === feature) return false;
    this.features[idx] = feature;
    this.markFeaturesDirty(rebakeLights && (lightFeature(old) || lightFeature(feature)), rects);
    if (old === Feature.SCREEN && feature !== Feature.SCREEN) this.screenCells = this.screenCells.filter(i => i !== idx);
    if (feature === Feature.SCREEN && !this.screenCells.includes(idx)) this.screenCells.push(idx);
    if (old === Feature.SLIDE && feature !== Feature.SLIDE) this.slideCells = this.slideCells.filter(i => i !== idx);
    if (feature === Feature.SLIDE && !this.slideCells.includes(idx)) this.slideCells.push(idx);
    return true;
  }

  removeDoorAt(idx: number): boolean {
    let changed = false;
    const door = this.doors.get(idx);
    const removeFromRoom = (roomId: number): void => {
      const room = roomId >= 0 ? this.rooms[roomId] : undefined;
      if (!room) return;
      if (room.doors.includes(idx)) {
        room.doors = room.doors.filter(i => i !== idx);
        changed = true;
      }
    };
    if (door) {
      removeFromRoom(door.roomA);
      removeFromRoom(door.roomB);
    }
    if (this.doors.delete(idx)) changed = true;
    for (let i = 0; i < this.rooms.length; i++) {
      const room = this.rooms[i];
      if (!room) continue;
      if (room.doors.includes(idx)) {
        room.doors = room.doors.filter(i => i !== idx);
        changed = true;
      }
    }
    if (this.cells[idx] === Cell.DOOR) {
      this.cells[idx] = Cell.FLOOR;
      this.markCellsDirty();
      changed = true;
    }
    if (this.wallTex[idx] === Tex.DOOR_WOOD || this.wallTex[idx] === Tex.DOOR_METAL || this.wallTex[idx] === Tex.DOOR_HERMETIC) {
      this.wallTex[idx] = Tex.CONCRETE;
      this.markWallTexDirty();
      changed = true;
    }
    return changed;
  }

  solid(x: number, y: number): boolean {
    const i = this.idx(x, y);
    const c = this.cells[i];
    if (c === Cell.FLOOR || c === Cell.WATER) return false;
    if (c === Cell.LIFT) return true;  // lift wall — interact to use
    if (c === Cell.DOOR) {
      const d = this.doors.get(i);
      if (!d) return true;
      return d.state === DoorState.CLOSED
          || d.state === DoorState.LOCKED
          || d.state === DoorState.HERMETIC_CLOSED;
    }
    return true;
  }

  /* toroidal shortest displacement from a→b */
  delta(a: number, b: number): number {
    let d = b - a;
    if (d >  W / 2) d -= W;
    if (d < -W / 2) d += W;
    return d;
  }

  dist(x1: number, y1: number, x2: number, y2: number): number {
    const dx = this.delta(x1, x2);
    const dy = this.delta(y1, y2);
    return Math.sqrt(dx * dx + dy * dy);
  }

  dist2(x1: number, y1: number, x2: number, y2: number): number {
    const dx = this.delta(x1, x2);
    const dy = this.delta(y1, y2);
    return dx * dx + dy * dy;
  }

  roomAt(x: number, y: number): Room | null {
    const id = this.roomMap[this.idx(Math.floor(x), Math.floor(y))];
    return id >= 0 ? this.rooms[id] ?? null : null;
  }

  /* carve a floor cell */
  carve(x: number, y: number): void {
    this.set(x, y, Cell.FLOOR);
  }

  /* carve rectangle */
  carveRect(rx: number, ry: number, rw: number, rh: number, roomId: number): void {
    for (let dy = 0; dy < rh; dy++) {
      for (let dx = 0; dx < rw; dx++) {
        const wx = this.wrap(rx + dx);
        const wy = this.wrap(ry + dy);
        const i = wy * W + wx;
        this.cells[i] = Cell.FLOOR;
        this.roomMap[i] = roomId;
      }
    }
  }
}

function assertVisualSlotCell(cellIdx: number): number {
  const idx = Math.floor(cellIdx);
  if (!Number.isFinite(cellIdx) || idx !== cellIdx || idx < 0 || idx >= W * W) {
    throw new RangeError(`visual cell index out of range: ${cellIdx}`);
  }
  return idx;
}

function assertVisualSlotIndex(slot: number): number {
  const idx = Math.floor(slot);
  if (!Number.isFinite(slot) || idx !== slot || idx < 0 || idx >= VISUAL_SLOTS_PER_CELL) {
    throw new RangeError(`visual slot index out of range: ${slot}`);
  }
  return idx;
}

function assertVisualCellCode(code: number): number {
  const normalized = Math.floor(code);
  if (!Number.isFinite(code) || normalized !== code || normalized < 0 || normalized > 255) {
    throw new RangeError(`visual cell code out of byte range: ${code}`);
  }
  return normalized;
}

export function visualSlotOffset(cellIdx: number, slot: number): number {
  return assertVisualSlotCell(cellIdx) * VISUAL_SLOTS_PER_CELL + assertVisualSlotIndex(slot);
}

export function getVisualSlot(world: World, cellIdx: number, slot: number): number {
  return world.visualSlots[visualSlotOffset(cellIdx, slot)];
}

export function setVisualSlot(world: World, cellIdx: number, slot: number, code: number): boolean {
  const offset = visualSlotOffset(cellIdx, slot);
  const normalized = assertVisualCellCode(code);
  if (world.visualSlots[offset] === normalized) return false;
  world.visualSlots[offset] = normalized;
  world.markVisualSlotsDirty();
  return true;
}

export function clearVisualSlots(world: World, cellIdx: number): boolean {
  const offset = visualSlotOffset(cellIdx, 0);
  let changed = false;
  for (let slot = 0; slot < VISUAL_SLOTS_PER_CELL; slot++) {
    if (world.visualSlots[offset + slot] === EMPTY_VISUAL_CELL_CODE) continue;
    world.visualSlots[offset + slot] = EMPTY_VISUAL_CELL_CODE;
    changed = true;
  }
  if (changed) world.markVisualSlotsDirty();
  return changed;
}

export function classifyReachabilityCell(world: World, idx: number): ReachabilityCell {
  const cell = world.cells[idx];
  if (cell === Cell.FLOOR) return { passable: true, reason: 'open', gateMask: REACH_GATE_NONE };
  if (cell === Cell.WATER) return { passable: true, reason: 'water', gateMask: REACH_GATE_NONE };
  if (cell === Cell.LIFT) return { passable: false, reason: 'lift', gateMask: REACH_GATE_NONE };
  if (cell === Cell.WALL) return { passable: false, reason: 'wall', gateMask: REACH_GATE_NONE };
  if (cell === Cell.ABYSS) return { passable: false, reason: 'abyss', gateMask: REACH_GATE_NONE };
  if (cell !== Cell.DOOR) return { passable: false, reason: 'blocked', gateMask: REACH_GATE_NONE };

  const door = world.doors.get(idx);
  if (!door) return { passable: false, reason: 'door_missing', gateMask: REACH_GATE_NONE };
  if (door.state === DoorState.OPEN) return { passable: true, reason: 'door_open', gateMask: REACH_GATE_NONE };
  if (door.state === DoorState.CLOSED) return { passable: true, reason: 'door_closed', gateMask: REACH_GATE_NONE };
  if (door.state === DoorState.LOCKED) return { passable: true, reason: 'door_locked', gateMask: REACH_GATE_KEY };
  if (door.state === DoorState.HERMETIC_OPEN) return { passable: true, reason: 'door_hermetic_open', gateMask: REACH_GATE_NONE };
  return { passable: true, reason: 'door_hermetic_closed', gateMask: REACH_GATE_HERMETIC };
}

function reachabilityGateRank(mask: number): number {
  if (mask === REACH_GATE_NONE) return 0;
  if (mask === REACH_GATE_KEY) return 1;
  if (mask === REACH_GATE_HERMETIC) return 2;
  if (mask === REACH_UNREACHED) return 4;
  return 3;
}

export function reachabilityGateLabel(mask: number): string {
  if (mask === REACH_UNREACHED) return 'unreachable';
  if (mask === REACH_GATE_NONE) return 'reachable';
  if (mask === REACH_GATE_KEY) return 'gated by key';
  if (mask === REACH_GATE_HERMETIC) return 'gated by hermetic door';
  return 'gated by key and hermetic door';
}

export function auditReachability(world: World, startIdx: number): ReachabilityAudit {
  const n = W * W;
  const reachable = new Uint8Array(n);
  const gateMask = new Uint8Array(n).fill(REACH_UNREACHED);
  const reasonCounts: ReachabilityReasonCounts = {};
  const queues: number[][] = [[], [], [], []];
  const heads = [0, 0, 0, 0];

  const start = classifyReachabilityCell(world, startIdx);
  if (!start.passable) return { reachable, gateMask, reasonCounts };

  reachable[startIdx] = 1;
  gateMask[startIdx] = start.gateMask;
  reasonCounts[start.reason] = 1;
  queues[reachabilityGateRank(start.gateMask)].push(startIdx);

  for (let rank = 0; rank < queues.length; rank++) {
    while (heads[rank] < queues[rank].length) {
      const ci = queues[rank][heads[rank]++];
      const currentGate = gateMask[ci];
      if (reachabilityGateRank(currentGate) !== rank) continue;

      const x = ci % W;
      const y = (ci / W) | 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
        const ni = world.idx(x + dx, y + dy);
        const next = classifyReachabilityCell(world, ni);
        if (!next.passable) continue;

        const nextGate = currentGate | next.gateMask;
        const nextRank = reachabilityGateRank(nextGate);
        if (nextRank >= reachabilityGateRank(gateMask[ni])) continue;

        if (!reachable[ni]) {
          reasonCounts[next.reason] = (reasonCounts[next.reason] ?? 0) + 1;
        }
        reachable[ni] = 1;
        gateMask[ni] = nextGate;
        queues[nextRank].push(ni);
      }
    }
  }

  return { reachable, gateMask, reasonCounts };
}

export function hasReachableAdjacentCell(world: World, audit: ReachabilityAudit, idx: number): boolean {
  const x = idx % W;
  const y = (idx / W) | 0;
  return !!(
    audit.reachable[world.idx(x + 1, y)] ||
    audit.reachable[world.idx(x - 1, y)] ||
    audit.reachable[world.idx(x, y + 1)] ||
    audit.reachable[world.idx(x, y - 1)]
  );
}

export function describeReachability(audit: ReachabilityAudit, world: World, idx: number): string {
  if (audit.reachable[idx]) return reachabilityGateLabel(audit.gateMask[idx]);
  return `unreachable (${classifyReachabilityCell(world, idx).reason})`;
}

export function replaceWorldFromGeneration(target: World | null | undefined, generation: WorldGenerationLike): World {
  const source = generation.world;
  if (!target) {
    markWorldReplaced(source, {
      cellVersion: source.cellVersion,
      surfaceVersion: source.surfaceVersion,
      wallTexVersion: source.wallTexVersion,
      floorTexVersion: source.floorTexVersion,
      featureVersion: source.featureVersion,
      lightVersion: source.lightVersion,
      fogVersion: source.fogVersion,
      visualSlotVersion: source.visualSlotVersion,
      pathBlockerVersion: source.pathBlockerVersion,
    });
    return source;
  }

  const versions = {
    cellVersion: target.cellVersion,
    surfaceVersion: target.surfaceVersion,
    wallTexVersion: target.wallTexVersion,
    floorTexVersion: target.floorTexVersion,
    featureVersion: target.featureVersion,
    lightVersion: target.lightVersion,
    fogVersion: target.fogVersion,
    visualSlotVersion: target.visualSlotVersion,
    pathBlockerVersion: target.pathBlockerVersion,
  };

  target.cells.set(source.cells);
  target.roomMap.set(source.roomMap);
  target.wallTex.set(source.wallTex);
  target.floorTex.set(source.floorTex);
  target.features.set(source.features);
  target.light.set(source.light);
  target.visualSlots.set(source.visualSlots);
  target.pathBlockers.set(source.pathBlockers);
  target.aptMask.set(source.aptMask);
  target.hermoWall.set(source.hermoWall);
  target.zoneMap.set(source.zoneMap);
  target.factionControl.set(source.factionControl);
  target.fog.set(source.fog);
  target.tissue.set(source.tissue);
  target.dangerField.set(source.dangerField);
  target.liftDir.set(source.liftDir);

  target.rooms = source.rooms.slice();
  target.doors = new Map(source.doors);
  target.apartmentRoomCount = source.apartmentRoomCount;
  target.zones = source.zones.slice();
  target.slideCells = source.slideCells.slice();
  target.screenCells = source.screenCells.slice();
  target.surfaceMap = new Map(source.surfaceMap);
  target.surfaceFlags.set(source.surfaceFlags);
  target.anomalyTeleports = new Map(source.anomalyTeleports);
  target.anomalySmogSource = source.anomalySmogSource;
  target.anomalySmogCells = source.anomalySmogCells.slice();
  target.anomalySmogHandled = source.anomalySmogHandled;
  target.railTracks = source.railTracks.slice();
  target.railTrains = source.railTrains.slice();
  target.railTrainCells = new Map(source.railTrainCells);
  target.containers = source.containers.slice();
  target.rebuildContainerMap();

  markWorldReplaced(target, versions);
  return target;
}
