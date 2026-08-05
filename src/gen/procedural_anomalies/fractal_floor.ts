import { stampSurfaceSplat } from '../../systems/surface_marks';
import { Cell, EntityType, Feature, RoomType, Tex, W, type Room } from '../../core/types';
import {
  addItemDrop,
  isProtectedCell,
  isWalkableCell,
  rebuildProceduralAnomalyPlacement,
  roomCell,
  roomCenter,
  type ProceduralAnomalyGenContext,
} from './common';

const REAL_LOOT = ['lift_scheme', 'missing_record_file', 'psi_dust', 'siren_shard'] as const;
const COPY_LOOT = ['bleached_document', 'sand_spoiled_ration', 'note', 'blank_form'] as const;
const FRACTAL_MIN_DOMAIN = 96;
const FRACTAL_MAX_DOMAIN = 192;
const FRACTAL_SPAWN_CLEAR_RADIUS = 58;
const FRACTAL_BRIDGE_SAMPLE_LIMIT = 1536;

interface FractalDomain {
  x0: number;
  y0: number;
  size: number;
  cells: number[];
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

function orderRooms(rooms: Room[], seed: number): Room[] {
  return [...rooms].sort((a, b) => hash32(seed ^ Math.imul(a.id + 1, 0x45d9f3b)) - hash32(seed ^ Math.imul(b.id + 1, 0x45d9f3b)));
}

function carpetHole(x: number, y: number, size: number): boolean {
  let scale = size;
  let lx = x;
  let ly = y;
  while (scale >= 3) {
    const third = Math.max(1, Math.floor(scale / 3));
    if (Math.floor(lx / third) === 1 && Math.floor(ly / third) === 1) return true;
    lx %= third;
    ly %= third;
    scale = third;
  }
  return false;
}

function cantorBand(v: number, size: number): boolean {
  let scale = size;
  let lv = v;
  while (scale >= 9) {
    const third = Math.max(1, Math.floor(scale / 3));
    if (Math.floor(lv / third) === 1) return true;
    lv %= third;
    scale = third;
  }
  return false;
}

function gasketNibble(x: number, y: number): boolean {
  return (((x & y) & 31) === 31) || (((x ^ (y << 1)) & 63) === 37);
}

function protectedForFractal(
  ctx: ProceduralAnomalyGenContext,
  x: number,
  y: number,
  occupied: ReadonlySet<number> | null = null,
): boolean {
  const ci = ctx.world.idx(x, y);
  return (occupied?.has(ci) ?? false) ||
    isProtectedCell(ctx.world, ci) ||
    ctx.world.dist2(ctx.spawnX, ctx.spawnY, x + 0.5, y + 0.5) < FRACTAL_SPAWN_CLEAR_RADIUS * FRACTAL_SPAWN_CLEAR_RADIUS;
}

function fractalCellDeletable(ctx: ProceduralAnomalyGenContext, ci: number): boolean {
  return (ctx.world.cells[ci] === Cell.FLOOR || ctx.world.cells[ci] === Cell.WATER) &&
    ctx.world.features[ci] === Feature.NONE &&
    ctx.world.hermoWall[ci] === 0 &&
    ctx.world.aptMask[ci] === 0 &&
    !ctx.world.doors.has(ci) &&
    !ctx.world.containerMap.has(ci);
}

function collectOccupiedCells(ctx: ProceduralAnomalyGenContext): Set<number> {
  const out = new Set<number>();
  for (const entity of ctx.entities) {
    if (!entity.alive || entity.type === EntityType.PROJECTILE) continue;
    out.add(ctx.world.idx(Math.floor(entity.x), Math.floor(entity.y)));
  }
  return out;
}

function setFractalGap(ctx: ProceduralAnomalyGenContext, x: number, y: number, seed: number, occupied: ReadonlySet<number>): boolean {
  const ci = ctx.world.idx(x, y);
  if (protectedForFractal(ctx, x, y, occupied) || !fractalCellDeletable(ctx, ci)) return false;
  ctx.world.cells[ci] = Cell.ABYSS;
  ctx.world.floorTex[ci] = Tex.F_ABYSS;
  ctx.world.wallTex[ci] = Tex.VOID_WALL;
  ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 70);
  if ((hash32(seed ^ ci) & 3) === 0) {
    stampSurfaceSplat(ctx.world, x, y, 0.5, 0.5, 0.38, 0.56, seed ^ ci, 32, 92, 82, false);
  }
  return true;
}

function setFractalBlock(ctx: ProceduralAnomalyGenContext, x: number, y: number, seed: number, occupied: ReadonlySet<number>): boolean {
  const ci = ctx.world.idx(x, y);
  if (protectedForFractal(ctx, x, y, occupied) || !fractalCellDeletable(ctx, ci)) return false;
  ctx.world.cells[ci] = Cell.WALL;
  ctx.world.wallTex[ci] = Tex.VOID_WALL;
  ctx.world.floorTex[ci] = Tex.F_VOID;
  ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 42);
  if ((hash32(seed ^ ci) & 15) === 0) {
    stampSurfaceSplat(ctx.world, x, y, 0.5, 0.5, 0.22, 0.34, seed ^ ci, 62, 104, 96, true);
  }
  return true;
}

function markFractalCell(
  ctx: ProceduralAnomalyGenContext,
  x: number,
  y: number,
  seed: number,
  spine: boolean,
  occupied: ReadonlySet<number> | null = null,
): void {
  const ci = ctx.world.idx(x, y);
  if (protectedForFractal(ctx, x, y, occupied)) return;
  if (spine && (ctx.world.cells[ci] === Cell.WALL || ctx.world.cells[ci] === Cell.ABYSS)) {
    ctx.world.cells[ci] = Cell.FLOOR;
    if (ctx.world.roomMap[ci] < 0) ctx.world.roomMap[ci] = -1;
  }
  if (!isWalkableCell(ctx.world, ci)) return;

  ctx.world.floorTex[ci] = spine ? Tex.F_CONCRETE : Tex.F_VOID;
  ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], spine ? 18 : 46);
  if ((hash32(seed ^ ci) & 7) === 0) {
    stampSurfaceSplat(ctx.world, x, y, 0.5, 0.5, spine ? 0.26 : 0.42, spine ? 0.44 : 0.62, seed ^ ci, 44, 105, 92, false);
  }
}

function carveSpine(ctx: ProceduralAnomalyGenContext, cx: number, cy: number, half: number, seed: number, occupied: ReadonlySet<number>): void {
  for (let d = -half; d <= half; d++) {
    markFractalCell(ctx, cx + d, cy, seed + d * 17, true, occupied);
    markFractalCell(ctx, cx, cy + d, seed + d * 31, true, occupied);
    if ((d & 15) === 0) {
      markFractalCell(ctx, cx + d, cy + Math.floor(d / 4), seed + d * 47, true, occupied);
      markFractalCell(ctx, cx + Math.floor(d / 4), cy - d, seed + d * 61, true, occupied);
    }
  }
}

function carveFractalLoop(
  ctx: ProceduralAnomalyGenContext,
  x0: number,
  y0: number,
  side: number,
  seed: number,
  occupied: ReadonlySet<number>,
): void {
  for (let d = 0; d < side; d++) {
    markFractalCell(ctx, x0 + d, y0, seed + d * 3, true, occupied);
    markFractalCell(ctx, x0 + d, y0 + side - 1, seed + d * 5, true, occupied);
    markFractalCell(ctx, x0, y0 + d, seed + d * 7, true, occupied);
    markFractalCell(ctx, x0 + side - 1, y0 + d, seed + d * 11, true, occupied);
  }
}

function carveSelfSimilarLoops(ctx: ProceduralAnomalyGenContext, domain: FractalDomain, occupied: ReadonlySet<number>): void {
  let side = domain.size - 8;
  let inset = 4;
  let level = 0;
  while (side >= 24) {
    carveFractalLoop(ctx, domain.x0 + inset, domain.y0 + inset, side, ctx.spec.seed ^ (0x5f00 + level * 97), occupied);
    const branchSide = Math.max(12, Math.floor(side / 3));
    if (branchSide >= 12) {
      carveFractalLoop(
        ctx,
        domain.x0 + inset + Math.floor(side / 3),
        domain.y0 + inset + Math.floor(side / 3),
        branchSide,
        ctx.spec.seed ^ (0x6d00 + level * 131),
        occupied,
      );
    }
    inset += Math.max(8, Math.floor(side / 4));
    side = Math.floor(side / 2);
    level++;
  }
}

function applySquareDomain(ctx: ProceduralAnomalyGenContext, anchor: Room, occupied: ReadonlySet<number>): FractalDomain {
  const center = roomCenter(anchor);
  const size = Math.min(FRACTAL_MAX_DOMAIN, Math.max(FRACTAL_MIN_DOMAIN, ctx.spec.danger >= 5 ? 192 : ctx.spec.danger >= 4 ? 144 : 96));
  const half = Math.floor(size / 2);
  const x0 = center.x - half;
  const y0 = center.y - half;
  const domain: FractalDomain = { x0, y0, size, cells: [] };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const wx = ctx.world.wrap(x0 + x);
      const wy = ctx.world.wrap(y0 + y);
      const ci = ctx.world.idx(wx, wy);
      domain.cells.push(ci);
      if ((ctx.world.cells[ci] !== Cell.FLOOR && ctx.world.cells[ci] !== Cell.WATER) || protectedForFractal(ctx, wx, wy, occupied)) continue;
      const onEdgeStep = (x === 0 || y === 0 || x === size - 1 || y === size - 1) && ((x + y) % 5 === 0);
      const seed = ctx.spec.seed + x * 131 + y * 977;
      const cantor = cantorBand(x, size) || cantorBand(y, size);
      if (carpetHole(x, y, size) || (cantor && gasketNibble(x + ctx.spec.ordinal, y + ctx.spec.danger)) || onEdgeStep) {
        setFractalGap(ctx, wx, wy, seed, occupied);
      } else if (cantor && ((x * 3 + y * 5 + ctx.spec.seed) & 7) === 0) {
        setFractalBlock(ctx, wx, wy, seed, occupied);
      } else if (gasketNibble(x, y) && ((x + y + ctx.spec.seed) & 15) === 0) {
        markFractalCell(ctx, wx, wy, seed, false, occupied);
      }
    }
  }

  carveSpine(ctx, center.x, center.y, half, ctx.spec.seed ^ 0x5f2a1, occupied);
  carveSelfSimilarLoops(ctx, domain, occupied);
  return domain;
}

function decorateCopyRoom(ctx: ProceduralAnomalyGenContext, room: Room, ordinal: number): { x: number; y: number } | null {
  room.name = `Фрактал ${ordinal}: ${ordinal === 0 ? 'исходная кладовая' : 'копия кладовой'} ${room.id}`;
  room.floorTex = ordinal === 0 ? Tex.F_PARQUET : Tex.F_VOID;
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const x = ctx.world.wrap(room.x + dx);
      const y = ctx.world.wrap(room.y + dy);
      const ci = ctx.world.idx(x, y);
      if (ctx.world.roomMap[ci] !== room.id || !isWalkableCell(ctx.world, ci)) continue;
      const repeated = ((dx & 3) === (dy & 3)) || carpetHole(dx, dy, Math.max(room.w, room.h));
      if (repeated) {
        ctx.world.floorTex[ci] = ordinal === 0 ? Tex.F_PARQUET : Tex.F_VOID;
        ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], ordinal === 0 ? 12 : 54);
        if (((dx + dy + ordinal) % 6) === 0) stampSurfaceSplat(ctx.world, x, y, 0.5, 0.5, 0.24, 0.38, ctx.spec.seed + room.id * 97 + dx * 11 + dy, 58, 116, 94, false);
      }
    }
  }

  const apparatus = nearestFractalRoomCell(ctx, room, Math.floor(room.w / 2), Math.floor(room.h / 2), true);
  if (apparatus) ctx.world.features[ctx.world.idx(apparatus.x, apparatus.y)] = ordinal === 0 ? Feature.APPARATUS : Feature.SCREEN;
  const loot = nearestFractalRoomCell(ctx, room, 1 + (ordinal * 3) % Math.max(1, room.w - 2), 1 + (ordinal * 5) % Math.max(1, room.h - 2), true);
  if (loot) addItemDrop(ctx, loot.x, loot.y, ordinal === 0 ? REAL_LOOT[hash32(ctx.spec.seed + room.id) % REAL_LOOT.length] : COPY_LOOT[ordinal % COPY_LOOT.length], 1);
  return apparatus;
}

function nearestFractalRoomCell(
  ctx: ProceduralAnomalyGenContext,
  room: Room,
  preferredDx: number,
  preferredDy: number,
  requireEmpty: boolean,
): { x: number; y: number } | null {
  const direct = roomCell(ctx.world, room, preferredDx, preferredDy, requireEmpty);
  if (direct) return direct;
  let best: { x: number; y: number } | null = null;
  let bestD2 = Infinity;
  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      const x = ctx.world.wrap(room.x + dx);
      const y = ctx.world.wrap(room.y + dy);
      const ci = ctx.world.idx(x, y);
      if (ctx.world.roomMap[ci] !== room.id || !isWalkableCell(ctx.world, ci)) continue;
      if (requireEmpty && ctx.world.features[ci] !== Feature.NONE) continue;
      const d2 = (dx - preferredDx) * (dx - preferredDx) + (dy - preferredDy) * (dy - preferredDy);
      if (d2 < bestD2) {
        best = { x, y };
        bestD2 = d2;
      }
    }
  }
  return best;
}

function addFractalTeleport(ctx: ProceduralAnomalyGenContext, a: { x: number; y: number } | null, b: { x: number; y: number } | null): boolean {
  if (!a || !b) return false;
  const ai = ctx.world.idx(a.x, a.y);
  const bi = ctx.world.idx(b.x, b.y);
  if (!isWalkableCell(ctx.world, ai) || !isWalkableCell(ctx.world, bi) || ctx.world.dist2(a.x, a.y, b.x, b.y) < 32 * 32) return false;
  ctx.world.anomalyTeleports.set(ai, bi);
  ctx.world.anomalyTeleports.set(bi, ai);
  ctx.world.features[ai] = Feature.SCREEN;
  ctx.world.features[bi] = Feature.SCREEN;
  ctx.world.floorTex[ai] = Tex.F_VOID;
  ctx.world.floorTex[bi] = Tex.F_VOID;
  return true;
}

function fractalWalkable(ctx: ProceduralAnomalyGenContext, ci: number): boolean {
  const cell = ctx.world.cells[ci];
  return cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR;
}

function labelFractalComponents(ctx: ProceduralAnomalyGenContext): {
  label: Int32Array;
  sizes: number[];
  samples: number[][];
  largest: number;
} {
  const total = W * W;
  const label = new Int32Array(total);
  label.fill(-1);
  const queue = new Int32Array(total);
  const sizes: number[] = [];
  const samples: number[][] = [];
  let largest = -1;

  for (let start = 0; start < total; start++) {
    if (label[start] >= 0 || !fractalWalkable(ctx, start)) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    label[start] = id;
    queue[tail++] = start;
    const componentSamples: number[] = [];
    while (head < tail) {
      const ci = queue[head++];
      if (componentSamples.length < FRACTAL_BRIDGE_SAMPLE_LIMIT && (tail & 15) === 0) componentSamples.push(ci);
      const x = ci % W;
      const y = (ci / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ni = ctx.world.idx(x + dx, y + dy);
        if (label[ni] >= 0 || !fractalWalkable(ctx, ni)) continue;
        label[ni] = id;
        queue[tail++] = ni;
      }
    }
    if (componentSamples.length === 0) componentSamples.push(start);
    sizes.push(tail);
    samples.push(componentSamples);
    if (largest < 0 || tail > sizes[largest]) largest = id;
  }

  return { label, sizes, samples, largest };
}

function nearestWalkableToAnchor(ctx: ProceduralAnomalyGenContext, idx: number): number {
  if (fractalWalkable(ctx, idx)) return idx;
  const sx = idx % W;
  const sy = (idx / W) | 0;
  for (let r = 1; r <= 16; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const ci = ctx.world.idx(sx + dx, sy + dy);
        if (fractalWalkable(ctx, ci)) return ci;
      }
    }
  }
  return -1;
}

function anchorAccessCells(ctx: ProceduralAnomalyGenContext): number[] {
  const anchors: number[] = [nearestWalkableToAnchor(ctx, ctx.world.idx(Math.floor(ctx.spawnX), Math.floor(ctx.spawnY)))];
  for (let i = 0; i < ctx.world.cells.length; i++) {
    if (ctx.world.cells[i] !== Cell.LIFT) continue;
    const x = i % W;
    const y = (i / W) | 0;
    let best = -1;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = ctx.world.idx(x + dx, y + dy);
      if (fractalWalkable(ctx, ni) && (best < 0 || ctx.world.features[ni] === Feature.LIFT_BUTTON)) best = ni;
    }
    if (best >= 0) anchors.push(best);
  }
  return anchors.filter(idx => idx >= 0);
}

function forceFractalBridgeFloor(ctx: ProceduralAnomalyGenContext, x: number, y: number): boolean {
  const ci = ctx.world.idx(x, y);
  if (isProtectedCell(ctx.world, ci) || ctx.world.cells[ci] === Cell.LIFT || ctx.world.hermoWall[ci] || ctx.world.containerMap.has(ci)) return false;
  ctx.world.cells[ci] = Cell.FLOOR;
  ctx.world.floorTex[ci] = Tex.F_CONCRETE;
  ctx.world.wallTex[ci] = Tex.VOID_WALL;
  if (ctx.world.features[ci] !== Feature.LIFT_BUTTON) ctx.world.features[ci] = Feature.NONE;
  if (ctx.world.roomMap[ci] < 0) ctx.world.roomMap[ci] = -1;
  return true;
}

function carveFractalBridgeRun(
  ctx: ProceduralAnomalyGenContext,
  from: { x: number; y: number },
  to: { x: number; y: number },
  horizontalFirst: boolean,
): void {
  let x = ctx.world.wrap(from.x);
  let y = ctx.world.wrap(from.y);
  const carveAxis = (horizontal: boolean): void => {
    const target = horizontal ? to.x : to.y;
    const delta = horizontal ? ctx.world.delta(x, target) : ctx.world.delta(y, target);
    const dir = delta >= 0 ? 1 : -1;
    for (let s = 0; s < Math.abs(delta); s++) {
      forceFractalBridgeFloor(ctx, x, y);
      if (horizontal) x = ctx.world.wrap(x + dir);
      else y = ctx.world.wrap(y + dir);
      forceFractalBridgeFloor(ctx, x, y);
    }
  };
  if (horizontalFirst) {
    carveAxis(true);
    carveAxis(false);
  } else {
    carveAxis(false);
    carveAxis(true);
  }
}

function bridgeComponentToLargest(
  ctx: ProceduralAnomalyGenContext,
  anchorIdx: number,
  components: ReturnType<typeof labelFractalComponents>,
): boolean {
  const fromLabel = components.label[anchorIdx];
  if (fromLabel < 0 || fromLabel === components.largest) return false;
  const largestSamples = components.samples[components.largest] ?? [];
  if (largestSamples.length === 0) return false;
  let best = largestSamples[0];
  let bestD = Infinity;
  const ax = anchorIdx % W;
  const ay = (anchorIdx / W) | 0;
  for (const sample of largestSamples) {
    const sx = sample % W;
    const sy = (sample / W) | 0;
    const d = Math.abs(ctx.world.delta(ax, sx)) + Math.abs(ctx.world.delta(ay, sy));
    if (d < bestD) {
      bestD = d;
      best = sample;
    }
  }
  carveFractalBridgeRun(
    ctx,
    { x: ax, y: ay },
    { x: best % W, y: (best / W) | 0 },
    (hash32(ctx.spec.seed ^ anchorIdx) & 1) === 0,
  );
  return true;
}

function roomWalkableSample(ctx: ProceduralAnomalyGenContext, room: Room): number {
  if (room.sealed) return -1;
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = ctx.world.idx(room.x + dx, room.y + dy);
      if (ctx.world.roomMap[idx] === room.id && fractalWalkable(ctx, idx)) return idx;
    }
  }
  return -1;
}

function bridgeUnreachableFractalRooms(ctx: ProceduralAnomalyGenContext): void {
  let components = labelFractalComponents(ctx);
  if (components.largest < 0) return;
  for (const room of ctx.rooms) {
    const sample = roomWalkableSample(ctx, room);
    if (sample < 0) continue;
    if (components.label[sample] === components.largest) continue;
    if (bridgeComponentToLargest(ctx, sample, components)) components = labelFractalComponents(ctx);
  }
}

function extractFractalLargestComponent(ctx: ProceduralAnomalyGenContext, domain: FractalDomain, occupied: ReadonlySet<number>): void {
  let components = labelFractalComponents(ctx);
  for (const anchor of anchorAccessCells(ctx)) {
    components = labelFractalComponents(ctx);
    bridgeComponentToLargest(ctx, anchor, components);
  }

  components = labelFractalComponents(ctx);
  if (components.largest < 0) return;
  for (const ci of domain.cells) {
    if (!fractalWalkable(ctx, ci) || components.label[ci] === components.largest) continue;
    const x = ci % W;
    const y = (ci / W) | 0;
    setFractalGap(ctx, x, y, ctx.spec.seed ^ ci ^ 0x7a11, occupied);
  }
  bridgeUnreachableFractalRooms(ctx);
}

export function applyFractalFloor(ctx: ProceduralAnomalyGenContext): void {
  const candidates = orderRooms(ctx.rooms.filter(room => (
    room.type !== RoomType.CORRIDOR &&
    room.type !== RoomType.BATHROOM &&
    room.w >= 7 &&
    room.h >= 7 &&
    ctx.world.dist2(ctx.spawnX, ctx.spawnY, roomCenter(room).x, roomCenter(room).y) > 64 * 64
  )), ctx.spec.seed);
  if (candidates.length === 0) return;

  const anchor = candidates[0];
  const occupied = collectOccupiedCells(ctx);
  const domain = applySquareDomain(ctx, anchor, occupied);
  extractFractalLargestComponent(ctx, domain, occupied);
  rebuildProceduralAnomalyPlacement(ctx);

  const copies = candidates.slice(0, Math.min(candidates.length, 3 + Math.floor(ctx.spec.danger / 2)));
  const apparatuses: ({ x: number; y: number } | null)[] = [];
  for (let i = 0; i < copies.length; i++) {
    const apparatus = decorateCopyRoom(ctx, copies[i], i);
    apparatuses.push(apparatus);
  }
  for (let i = 1; i < apparatuses.length && ctx.world.anomalyTeleports.size < 2; i++) {
    addFractalTeleport(ctx, apparatuses[0], apparatuses[i]);
  }
  for (let a = 1; a < apparatuses.length && ctx.world.anomalyTeleports.size < 2; a++) {
    for (let b = a + 1; b < apparatuses.length && ctx.world.anomalyTeleports.size < 2; b++) {
      addFractalTeleport(ctx, apparatuses[a], apparatuses[b]);
    }
  }

  ctx.world.markCellsDirty();
  ctx.world.markWallTexDirty();
  ctx.world.markFogDirty();
  ctx.world.markFeaturesDirty(false);
  ctx.world.markFloorTexDirty();
}
