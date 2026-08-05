/* ── Procedural geometry recipes ──────────────────────────────── */
/*                                                                */
/*  Each recipe is a pure geometry function that fills a region   */
/*  of the 1024×1024 torus with rooms, corridors, and features.   */
/*  Recipes are extracted from design floor algorithms and        */
/*  made parametric for reuse in procedural floors.               */
/*                                                                */
/*  Contract:                                                     */
/*  • Fill ≥ 60% of the region with walkable space               */
/*  • Return created Room[] for MST connectivity                  */
/*  • Respect protectedMask / aptMask / hermoWall                 */
/*  • Use world.idx / world.wrap for torus-safety                 */

import {
  Cell,
  DoorState,
  Feature,
  RoomType,
  Tex,
  W,
  type Room,
} from '../core/types';
import { World } from '../core/world';
import { hashSeed } from '../core/rand';
import {
  canPlaceRoom,
  carveCorridor,
  connectRoomsMST,
  decorateRoom,
  stampRoom,
} from './shared';

/* ── Recipe ids ──────────────────────────────────────────────── */

export type ProceduralRecipeId =
  | 'voronoi_partition'
  | 'manhattan_grid'
  | 'hilbert_fill'
  | 'concentric_rings'
  | 'organic_braid'
  | 'smart_quarter_infill'
  | 'production_islands'
  | 'dark_tunnel_web'
  | 'dense_room_scatter'
  | 'attractor_courtyards';

/* ── Shared types ───────────────────────────────────────────── */

export interface RecipeRegion {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

export interface RecipeTexKit {
  wallTex: Tex;
  floorTex: Tex;
  roomTypes: readonly RoomType[];
}

export interface RecipeContext {
  world: World;
  region: RecipeRegion;
  seed: number;
  tex: RecipeTexKit;
  nextRoomId: { v: number };
  industrial: boolean;
}

export interface RecipeResult {
  rooms: Room[];
}

/* ── Utilities ──────────────────────────────────────────────── */

function rSeed(seed: number, salt: number): number {
  return hashSeed(`recipe:${salt}`, seed);
}

/** Seeded pseudo-random from xorshift32, no global state. */
function xsh(state: number): [number, number] {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  state = state >>> 0;
  return [state, (state & 0x7FFFFFFF) / 0x7FFFFFFF];
}

function xshInt(state: number, lo: number, hi: number): [number, number] {
  const [next, t] = xsh(state);
  return [next, lo + Math.floor(t * (hi - lo + 1))];
}

function xshPick<T>(state: number, items: readonly T[]): [number, T] {
  const [next, idx] = xshInt(state, 0, items.length - 1);
  return [next, items[idx]];
}

/** Check if region cell is safe for carving (no protected content). */
function canCarve(world: World, x: number, y: number): boolean {
  const i = world.idx(x, y);
  return !world.aptMask[i] && !world.hermoWall[i] && world.cells[i] !== Cell.LIFT;
}

/** Carve a single floor cell without room ownership. */
function carveFloor(world: World, x: number, y: number, wallTex: Tex, floorTex: Tex): boolean {
  const i = world.idx(x, y);
  if (world.aptMask[i] || world.hermoWall[i] || world.cells[i] === Cell.LIFT) return false;
  if (world.cells[i] === Cell.DOOR) return false;
  if (world.cells[i] !== Cell.FLOOR) {
    world.cells[i] = Cell.FLOOR;
    world.roomMap[i] = -1;
    world.floorTex[i] = floorTex;
    world.wallTex[i] = wallTex;
    return true;
  }
  return false;
}

/** Carve a corridor with organic jitter — wobbles perpendicular to travel. */
function carveWideCorridor(
  world: World, ax: number, ay: number, bx: number, by: number,
  halfWidth: number, wallTex: Tex, floorTex: Tex, featureStep: number, featureType: Feature, _seed: number,
): void {
  const ddx = world.delta(ax, bx);
  const ddy = world.delta(ay, by);
  const horizontal = Math.abs(ddx) >= Math.abs(ddy);
  const delta = horizontal ? ddx : ddy;
  const steps = Math.abs(delta);
  const stepDir = delta >= 0 ? 1 : -1;
  let cx = ax, cy = ay;
  let stepCount = 0;
  let drift = 0; // perpendicular drift
  let jst = (_seed ^ 0x5A5A) >>> 0;

  for (let s = 0; s <= steps; s++) {
    // Jitter: randomly drift perpendicular ±1 with 25% chance
    jst ^= jst << 13; jst ^= jst >>> 17; jst ^= jst << 5; jst = jst >>> 0;
    if ((jst & 3) === 0 && s > 0 && s < steps) {
      drift += (jst & 4) ? 1 : -1;
      drift = Math.max(-4, Math.min(4, drift));
    }

    for (let side = -halfWidth; side <= halfWidth; side++) {
      const wx = horizontal ? cx : cx + side + drift;
      const wy = horizontal ? cy + side + drift : cy;
      carveFloor(world, wx, wy, wallTex, floorTex);
      if (side === 0 && featureStep > 0 && stepCount > 0 && stepCount % featureStep === 0) {
        const fi = world.idx(wx, wy);
        if (world.cells[fi] === Cell.FLOOR && world.features[fi] === Feature.NONE) {
          world.features[fi] = featureType;
        }
      }
    }
    if (s < steps) {
      if (horizontal) cx = world.wrap(cx + stepDir);
      else cy = world.wrap(cy + stepDir);
    }
    stepCount++;
  }
}

/** Try to stamp a room inside the given region. Returns null on failure. */
function tryStampRoomInRegion(
  ctx: RecipeContext, x: number, y: number, rw: number, rh: number, type: RoomType, name: string,
): Room | null {
  const { world } = ctx;
  const wx = world.wrap(x);
  const wy = world.wrap(y);
  if (!canPlaceRoom(world, wx, wy, rw, rh)) return null;
  const room = stampRoom(world, ctx.nextRoomId.v++, type, wx, wy, rw, rh, -1);
  room.name = name;
  // Apply textures
  room.wallTex = ctx.tex.wallTex;
  room.floorTex = ctx.tex.floorTex;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const i = world.idx(room.x + dx, room.y + dy);
      if (world.cells[i] === Cell.WALL) world.wallTex[i] = ctx.tex.wallTex;
    }
  }
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      world.floorTex[world.idx(room.x + dx, room.y + dy)] = ctx.tex.floorTex;
    }
  }
  return room;
}

/** Decorate a recipe room with features. */
function decorateRecipeRoom(world: World, room: Room, seed: number, industrial: boolean): void {
  decorateRoom(world, room);
  let st = seed;
  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      [st] = xsh(st);
      if ((st & 0x3F) !== 0) continue; // ~1.5% chance
      const i = world.idx(room.x + dx, room.y + dy);
      if (world.cells[i] !== Cell.FLOOR || world.features[i] !== Feature.NONE) continue;
      if (room.type === RoomType.PRODUCTION) world.features[i] = industrial ? Feature.MACHINE : Feature.TABLE;
      else if (room.type === RoomType.KITCHEN) world.features[i] = (st & 1) ? Feature.STOVE : Feature.SINK;
      else if (room.type === RoomType.BATHROOM) world.features[i] = (st & 1) ? Feature.TOILET : Feature.SINK;
      else if (room.type === RoomType.OFFICE) world.features[i] = (st & 1) ? Feature.DESK : Feature.SHELF;
      else if (room.type === RoomType.STORAGE) world.features[i] = Feature.SHELF;
      else if ((st & 3) === 0) world.features[i] = Feature.LAMP;
    }
  }
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Recipe 1: VORONOI PARTITION                                   */
/*  Fills the region with Voronoi cells → rooms.                  */
/*  Inspired by voronoi_quarantine design floor.                  */
/* ═══════════════════════════════════════════════════════════════ */

function recipeVoronoiPartition(ctx: RecipeContext): RecipeResult {
  const { world, region, seed, tex } = ctx;
  const rooms: Room[] = [];

  // Generate site positions
  const siteCount = 24 + Math.floor((region.w * region.h) / (42 * 42));
  const sites: { x: number; y: number; id: number }[] = [];
  let st = rSeed(seed, 0xB0A1);
  for (let i = 0; i < siteCount; i++) {
    let sx: number, sy: number;
    [st, sx] = xshInt(st, region.x0 + 8, region.x0 + region.w - 9);
    [st, sy] = xshInt(st, region.y0 + 8, region.y0 + region.h - 9);
    sites.push({ x: world.wrap(sx), y: world.wrap(sy), id: i });
  }

  // Assign every cell in region to nearest site (Voronoi)
  const owner = new Int32Array(W * W).fill(-1);
  for (let dy = 0; dy < region.h; dy++) {
    for (let dx = 0; dx < region.w; dx++) {
      const wx = world.wrap(region.x0 + dx);
      const wy = world.wrap(region.y0 + dy);
      const idx = world.idx(wx, wy);
      if (world.aptMask[idx] || world.hermoWall[idx] || world.cells[idx] === Cell.LIFT) continue;
      let best = -1, bestD = Infinity;
      for (const site of sites) {
        const d = world.dist2(wx, wy, site.x, site.y);
        if (d < bestD) { bestD = d; best = site.id; }
      }
      owner[idx] = best;
    }
  }

  // Find boundaries → place walls
  for (let dy = 0; dy < region.h; dy++) {
    for (let dx = 0; dx < region.w; dx++) {
      const wx = world.wrap(region.x0 + dx);
      const wy = world.wrap(region.y0 + dy);
      const idx = world.idx(wx, wy);
      if (owner[idx] < 0) continue;
      let isBoundary = false;
      for (const [ddx, ddy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
        const ni = world.idx(wx + ddx, wy + ddy);
        if (owner[ni] >= 0 && owner[ni] !== owner[idx]) { isBoundary = true; break; }
      }
      if (isBoundary && canCarve(world, wx, wy)) {
        world.cells[idx] = Cell.WALL;
        world.wallTex[idx] = tex.wallTex;
        world.roomMap[idx] = -1;
      } else if (canCarve(world, wx, wy)) {
        world.cells[idx] = Cell.FLOOR;
        world.floorTex[idx] = tex.floorTex;
        world.roomMap[idx] = -1;
      }
    }
  }

  // Create rooms from Voronoi cells
  const siteMinX = new Int32Array(siteCount).fill(W);
  const siteMinY = new Int32Array(siteCount).fill(W);
  const siteMaxX = new Int32Array(siteCount).fill(0);
  const siteMaxY = new Int32Array(siteCount).fill(0);
  const siteCellCount = new Int32Array(siteCount);

  for (let dy = 0; dy < region.h; dy++) {
    for (let dx = 0; dx < region.w; dx++) {
      const wx = world.wrap(region.x0 + dx);
      const wy = world.wrap(region.y0 + dy);
      const idx = world.idx(wx, wy);
      const o = owner[idx];
      if (o < 0 || world.cells[idx] !== Cell.FLOOR) continue;
      siteCellCount[o]++;
      if (dx < siteMinX[o]) siteMinX[o] = dx;
      if (dy < siteMinY[o]) siteMinY[o] = dy;
      if (dx > siteMaxX[o]) siteMaxX[o] = dx;
      if (dy > siteMaxY[o]) siteMaxY[o] = dy;
    }
  }

  // Register rooms (cells with > 16 cells)
  let typeSt = rSeed(seed, 0x7931);
  for (let i = 0; i < siteCount; i++) {
    if (siteCellCount[i] < 16) continue;
    let type: RoomType;
    [typeSt, type] = xshPick(typeSt, tex.roomTypes);
    const roomId = ctx.nextRoomId.v++;
    const room: Room = {
      id: roomId,
      type,
      x: world.wrap(region.x0 + siteMinX[i]),
      y: world.wrap(region.y0 + siteMinY[i]),
      w: siteMaxX[i] - siteMinX[i] + 1,
      h: siteMaxY[i] - siteMinY[i] + 1,
      doors: [],
      sealed: false,
      name: `Ячейка ${roomId}`,
      apartmentId: -1,
      wallTex: tex.wallTex,
      floorTex: tex.floorTex,
    };
    world.rooms[roomId] = room;
    // Assign roomMap
    for (let dy = 0; dy < region.h; dy++) {
      for (let dx = 0; dx < region.w; dx++) {
        const wx = world.wrap(region.x0 + dx);
        const wy = world.wrap(region.y0 + dy);
        const idx = world.idx(wx, wy);
        if (owner[idx] === i && world.cells[idx] === Cell.FLOOR) {
          world.roomMap[idx] = roomId;
        }
      }
    }
    rooms.push(room);
  }

  // Place doors between adjacent Voronoi cells
  const doorPairs = new Set<string>();
  for (let dy = 0; dy < region.h; dy++) {
    for (let dx = 0; dx < region.w; dx++) {
      const wx = world.wrap(region.x0 + dx);
      const wy = world.wrap(region.y0 + dy);
      const idx = world.idx(wx, wy);
      if (world.cells[idx] !== Cell.WALL) continue;
      const adj: number[] = [];
      for (const [ddx, ddy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
        const ni = world.idx(wx + ddx, wy + ddy);
        if (world.roomMap[ni] >= 0) adj.push(world.roomMap[ni]);
      }
      if (adj.length < 2) continue;
      const a = Math.min(adj[0], adj[1]);
      const b = Math.max(adj[0], adj[1]);
      if (a === b) continue;
      const key = `${a}:${b}`;
      if (doorPairs.has(key)) continue;
      doorPairs.add(key);
      // Place door at this wall cell
      world.cells[idx] = Cell.DOOR;
      world.doors.set(idx, {
        idx, state: DoorState.CLOSED,
        roomA: a, roomB: b, keyId: '', timer: 0,
      });
      const roomA = world.rooms[a];
      const roomB = world.rooms[b];
      if (roomA) roomA.doors.push(idx);
      if (roomB) roomB.doors.push(idx);
    }
  }

  return { rooms };
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Recipe 2: MANHATTAN GRID                                      */
/*  Orthogonal avenues + blocks between them.                     */
/*  Inspired by manhattan_crossroads design floor.                */
/* ═══════════════════════════════════════════════════════════════ */

function recipeManhattanGrid(ctx: RecipeContext): RecipeResult {
  const { world, region, seed, tex } = ctx;
  const rooms: Room[] = [];

  const avenueSpacing = 48 + (seed & 31); // 48-79
  const avenueWidth = 3;
  let st = rSeed(seed, 0xA1A1);

  // Carve horizontal avenues
  const hAvenueCount = Math.max(3, Math.floor(region.h / avenueSpacing));
  const hSpacing = Math.floor(region.h / hAvenueCount);
  for (let i = 0; i < hAvenueCount; i++) {
    const ay = region.y0 + i * hSpacing + Math.floor(hSpacing / 2);
    for (let dx = 0; dx < region.w; dx++) {
      for (let dw = -avenueWidth; dw <= avenueWidth; dw++) {
        carveFloor(world, region.x0 + dx, ay + dw, tex.wallTex, tex.floorTex);
      }
    }
    // Place features along avenue center
    for (let dx = 0; dx < region.w; dx += 17 + (seed & 7)) {
      const fi = world.idx(world.wrap(region.x0 + dx), world.wrap(ay));
      if (world.cells[fi] === Cell.FLOOR && world.features[fi] === Feature.NONE) {
        world.features[fi] = Feature.LAMP;
      }
    }
  }

  // Carve vertical avenues
  const vAvenueCount = Math.max(3, Math.floor(region.w / avenueSpacing));
  const vSpacing = Math.floor(region.w / vAvenueCount);
  for (let i = 0; i < vAvenueCount; i++) {
    const ax = region.x0 + i * vSpacing + Math.floor(vSpacing / 2);
    for (let dy = 0; dy < region.h; dy++) {
      for (let dw = -avenueWidth; dw <= avenueWidth; dw++) {
        carveFloor(world, ax + dw, region.y0 + dy, tex.wallTex, tex.floorTex);
      }
    }
  }

  // Place intersection plazas with rooms
  for (let hi = 0; hi < hAvenueCount; hi++) {
    const ay = region.y0 + hi * hSpacing + Math.floor(hSpacing / 2);
    for (let vi = 0; vi < vAvenueCount; vi++) {
      const ax = region.x0 + vi * vSpacing + Math.floor(vSpacing / 2);
      const plazaRadius = 6 + (((seed + hi * 3 + vi * 7) >>> 0) & 3);
      for (let dy = -plazaRadius; dy <= plazaRadius; dy++) {
        for (let dx = -plazaRadius; dx <= plazaRadius; dx++) {
          carveFloor(world, ax + dx, ay + dy, tex.wallTex, tex.floorTex);
        }
      }
      // Center feature
      const ci = world.idx(world.wrap(ax), world.wrap(ay));
      if (world.cells[ci] === Cell.FLOOR && world.features[ci] === Feature.NONE) {
        world.features[ci] = Feature.APPARATUS;
      }
    }
  }

  // Fill blocks between avenues with rooms
  for (let hi = 0; hi < hAvenueCount; hi++) {
    const y0 = region.y0 + hi * hSpacing + Math.floor(hSpacing / 2) + avenueWidth + 3;
    const y1 = region.y0 + ((hi + 1) % hAvenueCount) * hSpacing + Math.floor(hSpacing / 2) - avenueWidth - 3;
    if (y1 <= y0) continue;

    for (let vi = 0; vi < vAvenueCount; vi++) {
      const x0 = region.x0 + vi * vSpacing + Math.floor(vSpacing / 2) + avenueWidth + 3;
      const x1 = region.x0 + ((vi + 1) % vAvenueCount) * vSpacing + Math.floor(vSpacing / 2) - avenueWidth - 3;
      if (x1 <= x0) continue;

      const blockW = Math.min(x1 - x0, 40);
      const blockH = Math.min(y1 - y0, 30);
      if (blockW < 6 || blockH < 6) continue;

      let roomType: RoomType;
      [st, roomType] = xshPick(st, tex.roomTypes);
      const room = tryStampRoomInRegion(
        ctx, x0, y0, blockW, blockH, roomType, `Квартал ${hi * vAvenueCount + vi}`,
      );
      if (room) {
        decorateRecipeRoom(world, room, st, ctx.industrial);
        rooms.push(room);
      }
    }
  }

  return { rooms };
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Recipe 3: HILBERT FILL                                        */
/*  Space-filling Hilbert curve → continuous corridor maze.        */
/*  Inspired by hilbert_depot design floor.                       */
/* ═══════════════════════════════════════════════════════════════ */

function recipeHilbertFill(ctx: RecipeContext): RecipeResult {
  const { world, region, seed, tex } = ctx;
  const rooms: Room[] = [];

  // Hilbert curve generation
  const order = region.w >= 400 ? 5 : 4; // 2^5 = 32 segments or 2^4 = 16
  const n = 1 << order;
  const cellW = Math.floor(region.w / n);
  const cellH = Math.floor(region.h / n);
  const points: { x: number; y: number }[] = [];

  for (let i = 0; i < n * n; i++) {
    const { x, y } = hilbertD2xy(n, i);
    points.push({
      x: region.x0 + x * cellW + Math.floor(cellW / 2),
      y: region.y0 + y * cellH + Math.floor(cellH / 2),
    });
  }

  // Carve corridors along the Hilbert path
  const corridorWidth = 2;
  for (let i = 0; i < points.length - 1; i++) {
    carveWideCorridor(
      world, points[i].x, points[i].y, points[i + 1].x, points[i + 1].y,
      corridorWidth, tex.wallTex, tex.floorTex, 11, Feature.LAMP, seed + i,
    );
  }

  // Place rooms at curve nodes (every 3-5 nodes)
  let st = rSeed(seed, 0xF1BE);
  const roomInterval = 3 + (seed & 3);
  for (let i = 0; i < points.length; i += roomInterval) {
    const p = points[i];
    let rw: number, rh: number;
    [st, rw] = xshInt(st, 7, 18);
    [st, rh] = xshInt(st, 6, 14);
    const rx = p.x - Math.floor(rw / 2);
    const ry = p.y - Math.floor(rh / 2);
    let roomType: RoomType;
    [st, roomType] = xshPick(st, tex.roomTypes);
    const room = tryStampRoomInRegion(ctx, rx, ry, rw, rh, roomType, `Складская ячейка ${rooms.length}`);
    if (room) {
      decorateRecipeRoom(world, room, st, ctx.industrial);
      rooms.push(room);
    }
  }

  return { rooms };
}

/** Convert Hilbert d to (x, y) */
function hilbertD2xy(n: number, d: number): { x: number; y: number } {
  let rx: number, ry: number, t = d;
  let x = 0, y = 0;
  for (let s = 1; s < n; s <<= 1) {
    rx = (t & 2) > 0 ? 1 : 0;
    ry = ((t & 1) ^ rx) > 0 ? 0 : 1;
    if (ry === 0) {
      if (rx === 1) { x = s - 1 - x; y = s - 1 - y; }
      [x, y] = [y, x];
    }
    x += s * rx;
    y += s * ry;
    t >>= 2;
  }
  return { x, y };
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Recipe 4: CONCENTRIC RINGS                                    */
/*  Nested rectangular rings with radial connectors.              */
/*  Inspired by communal_ring design floor.                       */
/* ═══════════════════════════════════════════════════════════════ */

function recipeConcentricRings(ctx: RecipeContext): RecipeResult {
  const { world, region, seed, tex } = ctx;
  const rooms: Room[] = [];

  const cx = region.x0 + Math.floor(region.w / 2);
  const cy = region.y0 + Math.floor(region.h / 2);
  const ringCount = 4 + ((seed >>> 4) & 1); // 4-5 rings
  const ringWidth = 3;
  const ringGap = Math.floor(Math.min(region.w, region.h) / (ringCount * 2 + 2));
  let st = rSeed(seed, 0xD181);

  // Draw concentric rectangular rings
  for (let ring = 0; ring < ringCount; ring++) {
    const radius = ringGap * (ring + 1);
    const x0 = cx - radius;
    const y0 = cy - radius;
    const x1 = cx + radius;
    const y1 = cy + radius;

    // Carve 4 sides of the ring
    for (let t = 0; t <= radius * 2; t++) {
      for (let w = 0; w < ringWidth; w++) {
        // Top side
        carveFloor(world, x0 + t, y0 - w, tex.wallTex, tex.floorTex);
        // Bottom side
        carveFloor(world, x0 + t, y1 + w, tex.wallTex, tex.floorTex);
        // Left side
        carveFloor(world, x0 - w, y0 + t, tex.wallTex, tex.floorTex);
        // Right side
        carveFloor(world, x1 + w, y0 + t, tex.wallTex, tex.floorTex);
      }
    }

    // Place rooms along the ring
    const roomsPerSide = 3 + ring;
    for (let side = 0; side < 4; side++) {
      for (let ri = 0; ri < roomsPerSide; ri++) {
        const frac = (ri + 0.5) / roomsPerSide;
        let rx: number, ry: number;
        if (side === 0) { rx = x0 + Math.floor(frac * radius * 2); ry = y0 - ringWidth - 1; }
        else if (side === 1) { rx = x0 + Math.floor(frac * radius * 2); ry = y1 + ringWidth + 1; }
        else if (side === 2) { rx = x0 - ringWidth - 1; ry = y0 + Math.floor(frac * radius * 2); }
        else { rx = x1 + ringWidth + 1; ry = y0 + Math.floor(frac * radius * 2); }

        let rw: number, rh: number, roomType: RoomType;
        [st, rw] = xshInt(st, 5, 12);
        [st, rh] = xshInt(st, 5, 10);
        [st, roomType] = xshPick(st, tex.roomTypes);
        const room = tryStampRoomInRegion(
          ctx, rx - Math.floor(rw / 2), ry - Math.floor(rh / 2), rw, rh,
          roomType, `Кольцо ${ring + 1} узел ${ri + 1}`,
        );
        if (room) {
          decorateRecipeRoom(world, room, st, ctx.industrial);
          rooms.push(room);
        }
      }
    }
  }

  // Radial connectors
  const radialCount = 4 + ((seed >>> 8) & 3);
  for (let i = 0; i < radialCount; i++) {
    const angle = (i / radialCount) * Math.PI * 2 + ((seed & 0xFF) / 255) * 0.5;
    const innerR = ringGap;
    const outerR = ringGap * ringCount;
    const x0 = cx + Math.floor(Math.cos(angle) * innerR);
    const y0 = cy + Math.floor(Math.sin(angle) * innerR);
    const x1 = cx + Math.floor(Math.cos(angle) * outerR);
    const y1 = cy + Math.floor(Math.sin(angle) * outerR);
    carveWideCorridor(world, x0, y0, x1, y1, 1, tex.wallTex, tex.floorTex, 13, Feature.LAMP, seed + i);
  }

  // Fill gaps between rings with scattered rooms
  let fillSt = rSeed(seed, 0xF177);
  const fillCount = 30 + ((seed >>> 6) & 15);
  for (let fi = 0; fi < fillCount * 20; fi++) {
    let fx: number, fy: number, fw: number, fh: number;
    [fillSt, fx] = xshInt(fillSt, region.x0 + 8, region.x0 + region.w - 15);
    [fillSt, fy] = xshInt(fillSt, region.y0 + 8, region.y0 + region.h - 15);
    [fillSt, fw] = xshInt(fillSt, 5, 12);
    [fillSt, fh] = xshInt(fillSt, 5, 10);
    let fType: RoomType;
    [fillSt, fType] = xshPick(fillSt, tex.roomTypes);
    const fRoom = tryStampRoomInRegion(ctx, fx, fy, fw, fh, fType, `Межкольцо ${rooms.length + 1}`);
    if (fRoom) {
      decorateRecipeRoom(world, fRoom, fillSt, ctx.industrial);
      rooms.push(fRoom);
      if (rooms.length >= fillCount + 20) break;
    }
  }

  // Central hub room
  const hubW = 14 + ((seed >>> 12) & 7);
  const hubH = 12 + ((seed >>> 16) & 5);
  let hubType: RoomType;
  [st, hubType] = xshPick(st, tex.roomTypes);
  const hub = tryStampRoomInRegion(
    ctx, cx - Math.floor(hubW / 2), cy - Math.floor(hubH / 2),
    hubW, hubH, hubType, 'Центральный узел',
  );
  if (hub) {
    decorateRecipeRoom(world, hub, st, ctx.industrial);
    rooms.push(hub);
  }

  return { rooms };
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Recipe 5: ORGANIC BRAID                                       */
/*  Random waypoints → organic corridors → junction rooms.        */
/*  Inspired by chthonic_attic tensor-field weaving.              */
/* ═══════════════════════════════════════════════════════════════ */

function recipeOrganicBraid(ctx: RecipeContext): RecipeResult {
  const { world, region, seed, tex } = ctx;
  const rooms: Room[] = [];

  // Generate waypoints
  const waypointCount = 18 + ((seed >>> 3) & 15);
  const waypoints: { x: number; y: number }[] = [];
  let st = rSeed(seed, 0xCA7E);
  for (let i = 0; i < waypointCount; i++) {
    let wx: number, wy: number;
    [st, wx] = xshInt(st, region.x0 + 12, region.x0 + region.w - 13);
    [st, wy] = xshInt(st, region.y0 + 12, region.y0 + region.h - 13);
    waypoints.push({ x: wx, y: wy });
  }

  // Build MST-like connectivity with organic corridors
  const used = new Uint8Array(waypointCount);
  used[0] = 1;
  const edges: [number, number][] = [];

  for (let iter = 0; iter < waypointCount - 1; iter++) {
    let bestD = Infinity, bestFrom = -1, bestTo = -1;
    for (let i = 0; i < waypointCount; i++) {
      if (!used[i]) continue;
      for (let j = 0; j < waypointCount; j++) {
        if (used[j]) continue;
        const d = world.dist2(waypoints[i].x, waypoints[i].y, waypoints[j].x, waypoints[j].y);
        if (d < bestD) { bestD = d; bestFrom = i; bestTo = j; }
      }
    }
    if (bestTo < 0) break;
    used[bestTo] = 1;
    edges.push([bestFrom, bestTo]);
  }

  // Add extra cross-connections for loops
  const extraCount = Math.floor(waypointCount * 0.3);
  for (let i = 0; i < extraCount; i++) {
    let a: number, b: number;
    [st, a] = xshInt(st, 0, waypointCount - 1);
    [st, b] = xshInt(st, 0, waypointCount - 1);
    if (a !== b) edges.push([a, b]);
  }

  // Carve organic corridors (with slight random jitter via midpoint)
  for (const [ai, bi] of edges) {
    const a = waypoints[ai];
    const b = waypoints[bi];
    // Add a midpoint for organic feel
    let midX: number, midY: number;
    const avgX = a.x + Math.floor(world.delta(a.x, b.x) / 2);
    const avgY = a.y + Math.floor(world.delta(a.y, b.y) / 2);
    let jitterX: number, jitterY: number;
    [st, jitterX] = xshInt(st, -15, 15);
    [st, jitterY] = xshInt(st, -15, 15);
    midX = avgX + jitterX;
    midY = avgY + jitterY;

    let corridorWidth: number;
    [st, corridorWidth] = xshInt(st, 1, 3);
    carveWideCorridor(world, a.x, a.y, midX, midY, corridorWidth, tex.wallTex, tex.floorTex, 15, Feature.LAMP, st);
    carveWideCorridor(world, midX, midY, b.x, b.y, corridorWidth, tex.wallTex, tex.floorTex, 15, Feature.LAMP, st + 1);
  }

  // Place rooms at waypoints
  for (let i = 0; i < waypointCount; i++) {
    const wp = waypoints[i];
    let rw: number, rh: number, roomType: RoomType;
    [st, rw] = xshInt(st, 7, 20);
    [st, rh] = xshInt(st, 6, 16);
    [st, roomType] = xshPick(st, tex.roomTypes);
    const room = tryStampRoomInRegion(
      ctx, wp.x - Math.floor(rw / 2), wp.y - Math.floor(rh / 2),
      rw, rh, roomType, `Тоннельный зал ${i + 1}`,
    );
    if (room) {
      decorateRecipeRoom(world, room, st, ctx.industrial);
      rooms.push(room);
    }
  }

  return { rooms };
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Recipe 6: SMART QUARTER INFILL                                */
/*  Divide region into ~25×25 quarters, fill each with a room.    */
/*  Inspired by floor_69 quarter-based infill.                    */
/* ═══════════════════════════════════════════════════════════════ */

function recipeSmartQuarterInfill(ctx: RecipeContext): RecipeResult {
  const { world, region, seed, tex } = ctx;
  const rooms: Room[] = [];
  let st = rSeed(seed, 0x1234);

  const quarterSize = 25 + ((seed >>> 6) & 7); // 25-32
  const cols = Math.max(2, Math.floor(region.w / quarterSize));
  const rows = Math.max(2, Math.floor(region.h / quarterSize));
  const cellW = Math.floor(region.w / cols);
  const cellH = Math.floor(region.h / rows);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const qx = region.x0 + col * cellW;
      const qy = region.y0 + row * cellH;
      const margin = 2;
      const rw = cellW - margin * 2;
      const rh = cellH - margin * 2;
      if (rw < 5 || rh < 5) continue;

      let roomType: RoomType;
      [st, roomType] = xshPick(st, tex.roomTypes);
      const room = tryStampRoomInRegion(
        ctx, qx + margin, qy + margin, rw, rh,
        roomType, `Квартал ${row * cols + col + 1}`,
      );
      if (room) {
        decorateRecipeRoom(world, room, st, ctx.industrial);
        rooms.push(room);
      }
    }
  }

  // Connect adjacent quarters with corridors
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      if (idx >= rooms.length) continue;
      const room = rooms[idx];
      // Connect to right neighbor
      if (col + 1 < cols && idx + 1 < rooms.length) {
        const right = rooms[idx + 1];
        carveCorridor(
          world,
          room.x + room.w, room.y + Math.floor(room.h / 2),
          right.x, right.y + Math.floor(right.h / 2),
        );
      }
      // Connect to bottom neighbor
      const below = row + 1 < rows ? rooms[(row + 1) * cols + col] : undefined;
      if (below) {
        carveCorridor(
          world,
          room.x + Math.floor(room.w / 2), room.y + room.h,
          below.x + Math.floor(below.w / 2), below.y,
        );
      }
    }
  }

  return { rooms };
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Recipe 7: PRODUCTION ISLANDS                                  */
/*  Large industrial rooms with connecting corridors.             */
/*  Inspired by production_belt / service_floor.                  */
/* ═══════════════════════════════════════════════════════════════ */

function recipeProductionIslands(ctx: RecipeContext): RecipeResult {
  const { world, region, seed, tex } = ctx;
  const rooms: Room[] = [];
  let st = rSeed(seed, 0xFA01);

  const islandCount = 8 + ((seed >>> 5) & 7);

  for (let i = 0; i < islandCount; i++) {
    let rw: number, rh: number, ix: number, iy: number, roomType: RoomType;
    [st, rw] = xshInt(st, 18, 48);
    [st, rh] = xshInt(st, 14, 32);
    [st, ix] = xshInt(st, region.x0 + 8, region.x0 + region.w - rw - 9);
    [st, iy] = xshInt(st, region.y0 + 8, region.y0 + region.h - rh - 9);
    [st, roomType] = xshPick(st, [RoomType.PRODUCTION, RoomType.PRODUCTION, RoomType.STORAGE, RoomType.COMMON]);
    const room = tryStampRoomInRegion(ctx, ix, iy, rw, rh, roomType, `Производственный блок ${i + 1}`);
    if (!room) continue;

    // Decorate with columns and machinery
    const columnStride = Math.max(5, Math.floor(rw / 4));
    for (let dy = 2; dy < rh - 2; dy += columnStride) {
      for (let dx = 2; dx < rw - 2; dx += columnStride) {
        const ci = world.idx(room.x + dx, room.y + dy);
        if (world.cells[ci] === Cell.FLOOR && world.features[ci] === Feature.NONE) {
          world.cells[ci] = Cell.WALL;
          world.wallTex[ci] = tex.wallTex;
        }
      }
    }
    // Center machinery
    const cxi = world.idx(room.x + Math.floor(rw / 2), room.y + Math.floor(rh / 2));
    if (world.cells[cxi] === Cell.FLOOR) {
      world.features[cxi] = roomType === RoomType.PRODUCTION ? Feature.APPARATUS : Feature.TABLE;
    }
    decorateRecipeRoom(world, room, st, true);
    rooms.push(room);

    // Spawn satellite micro-rooms
    for (let sat = 0; sat < 3; sat++) {
      let sw: number, sh: number, satType: RoomType;
      [st, sw] = xshInt(st, 5, 10);
      [st, sh] = xshInt(st, 5, 8);
      [st, satType] = xshPick(st, [RoomType.OFFICE, RoomType.STORAGE, RoomType.BATHROOM]);
      let sx: number, sy: number;
      // Try to place near the island
      [st, sx] = xshInt(st, ix - sw - 6, ix + rw + 6);
      [st, sy] = xshInt(st, iy - sh - 6, iy + rh + 6);
      const satRoom = tryStampRoomInRegion(ctx, sx, sy, sw, sh, satType, `Подсобка ${i + 1}.${sat + 1}`);
      if (satRoom) {
        decorateRecipeRoom(world, satRoom, st, ctx.industrial);
        rooms.push(satRoom);
        // Connect satellite to island
        carveCorridor(
          world,
          room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2),
          satRoom.x + Math.floor(satRoom.w / 2), satRoom.y + Math.floor(satRoom.h / 2),
        );
      }
    }
  }

  // Wide inter-island corridors
  if (rooms.length >= 2) {
    connectRoomsMST(world, rooms);
    // Extra wide trunk between first few islands
    for (let i = 0; i < Math.min(rooms.length - 1, 6); i++) {
      const a = rooms[i];
      const b = rooms[i + 1];
      carveWideCorridor(
        world,
        a.x + Math.floor(a.w / 2), a.y + Math.floor(a.h / 2),
        b.x + Math.floor(b.w / 2), b.y + Math.floor(b.h / 2),
        2, tex.wallTex, tex.floorTex, 19, Feature.LAMP, st + i,
      );
    }
  }

  return { rooms };
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Recipe 8: DARK TUNNEL WEB                                     */
/*  Wide main tunnels + platform expansions.                      */
/*  Inspired by dark_metro design floor.                          */
/* ═══════════════════════════════════════════════════════════════ */

function recipeDarkTunnelWeb(ctx: RecipeContext): RecipeResult {
  const { world, region, seed, tex } = ctx;
  const rooms: Room[] = [];
  let st = rSeed(seed, 0xDA41);

  // Main tunnel lines — 3-5 lines crossing the region
  const lineCount = 3 + ((seed >>> 7) & 3);
  const tunnelWidth = 4;
  const lines: { ax: number; ay: number; bx: number; by: number }[] = [];

  for (let i = 0; i < lineCount; i++) {
    let ax: number, ay: number, bx: number, by: number;
    if (i % 2 === 0) {
      // Horizontal tunnel
      ax = region.x0;
      [st, ay] = xshInt(st, region.y0 + 20, region.y0 + region.h - 21);
      bx = region.x0 + region.w - 1;
      by = ay + ((st & 63) - 32); // Slight angle
    } else {
      // Vertical tunnel
      [st, ax] = xshInt(st, region.x0 + 20, region.x0 + region.w - 21);
      ay = region.y0;
      bx = ax + ((st & 63) - 32);
      by = region.y0 + region.h - 1;
    }
    lines.push({ ax, ay, bx, by });
    carveWideCorridor(world, ax, ay, bx, by, tunnelWidth, tex.wallTex, tex.floorTex, 13, Feature.LAMP, st + i);
  }

  // Platform rooms along tunnels
  for (const line of lines) {
    const isHorizontal = Math.abs(world.delta(line.ax, line.bx)) > Math.abs(world.delta(line.ay, line.by));

    // Place 2-4 platform rooms along each line
    let platformCount: number;
    [st, platformCount] = xshInt(st, 2, 4);
    for (let p = 0; p < platformCount; p++) {
      const frac = (p + 0.5) / platformCount;
      const px = line.ax + Math.floor(world.delta(line.ax, line.bx) * frac);
      const py = line.ay + Math.floor(world.delta(line.ay, line.by) * frac);
      let rw: number, rh: number, roomType: RoomType;
      [st, rw] = xshInt(st, 10, 22);
      [st, rh] = xshInt(st, 8, 16);
      [st, roomType] = xshPick(st, tex.roomTypes);
      // Offset perpendicular to tunnel
      const offsetDir = (p & 1) === 0 ? 1 : -1;
      const offset = tunnelWidth + 2;
      const rx = isHorizontal ? px - Math.floor(rw / 2) : px + offset * offsetDir;
      const ry = isHorizontal ? py + offset * offsetDir : py - Math.floor(rh / 2);
      const room = tryStampRoomInRegion(ctx, rx, ry, rw, rh, roomType, `Платформа ${rooms.length + 1}`);
      if (room) {
        decorateRecipeRoom(world, room, st, ctx.industrial);
        rooms.push(room);
        // Connect to tunnel
        carveCorridor(world, px, py, room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2));
      }
    }
  }

  return { rooms };
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Recipe 9: DENSE ROOM SCATTER (improved original)              */
/*  Much denser version of the original scatter algorithm.        */
/*  Places many more rooms, smaller gaps, wider corridors.        */
/* ═══════════════════════════════════════════════════════════════ */

function recipeDenseRoomScatter(ctx: RecipeContext): RecipeResult {
  const { world, region, seed, tex } = ctx;
  const rooms: Room[] = [];
  let st = rSeed(seed, 0x5CA7);

  const targetRooms = Math.floor((region.w * region.h) / (18 * 18)); // 1 room per ~18×18 area

  for (let attempt = 0; attempt < targetRooms * 50 && rooms.length < targetRooms; attempt++) {
    let roomType: RoomType;
    [st, roomType] = xshPick(st, tex.roomTypes);
    let rw: number, rh: number;
    if (roomType === RoomType.CORRIDOR) {
      if (st & 1) { [st, rw] = xshInt(st, 14, 32); [st, rh] = xshInt(st, 3, 5); }
      else { [st, rw] = xshInt(st, 3, 5); [st, rh] = xshInt(st, 14, 32); }
    } else if (roomType === RoomType.PRODUCTION) {
      [st, rw] = xshInt(st, 10, ctx.industrial ? 26 : 18);
      [st, rh] = xshInt(st, 8, ctx.industrial ? 20 : 14);
    } else if (roomType === RoomType.COMMON) {
      [st, rw] = xshInt(st, 8, 18);
      [st, rh] = xshInt(st, 7, 14);
    } else if (roomType === RoomType.BATHROOM || roomType === RoomType.KITCHEN) {
      [st, rw] = xshInt(st, 4, 7);
      [st, rh] = xshInt(st, 4, 7);
    } else {
      [st, rw] = xshInt(st, 5, 12);
      [st, rh] = xshInt(st, 5, 10);
    }

    let rx: number, ry: number;
    [st, rx] = xshInt(st, region.x0 + 4, region.x0 + region.w - rw - 5);
    [st, ry] = xshInt(st, region.y0 + 4, region.y0 + region.h - rh - 5);

    const room = tryStampRoomInRegion(ctx, rx, ry, rw, rh, roomType, `Помещение ${rooms.length + 1}`);
    if (room) {
      decorateRecipeRoom(world, room, st, ctx.industrial);
      rooms.push(room);
    }
  }

  // MST connectivity
  if (rooms.length >= 2) {
    connectRoomsMST(world, rooms);
  }

  return { rooms };
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Recipe 10: ATTRACTOR COURTYARDS                               */
/*  Attraction points → yards of varying sizes → corridors.       */
/*  Inspired by attractor_dvor design floor.                      */
/* ═══════════════════════════════════════════════════════════════ */

function recipeAttractorCourtyards(ctx: RecipeContext): RecipeResult {
  const { world, region, seed, tex } = ctx;
  const rooms: Room[] = [];
  let st = rSeed(seed, 0xDC01);

  // Place attractors using a relaxed Poisson-like distribution
  const attractorCount = 4 + ((seed >>> 4) & 3);
  const minSpacing = Math.max(36, Math.floor(Math.min(region.w, region.h) / (attractorCount + 1)));
  const attractors: { x: number; y: number; radius: number }[] = [];

  for (let attempt = 0; attempt < attractorCount * 30 && attractors.length < attractorCount; attempt++) {
    let ax: number, ay: number;
    [st, ax] = xshInt(st, region.x0 + 16, region.x0 + region.w - 17);
    [st, ay] = xshInt(st, region.y0 + 16, region.y0 + region.h - 17);
    // Check spacing
    let tooClose = false;
    for (const other of attractors) {
      if (world.dist2(ax, ay, other.x, other.y) < minSpacing * minSpacing) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    let radius: number;
    [st, radius] = xshInt(st, 8, 14);
    attractors.push({ x: ax, y: ay, radius });
  }

  // Carve courtyard circles and place rooms
  for (let i = 0; i < attractors.length; i++) {
    const attr = attractors[i];
    // Carve circular yard
    for (let dy = -attr.radius; dy <= attr.radius; dy++) {
      for (let dx = -attr.radius; dx <= attr.radius; dx++) {
        if (dx * dx + dy * dy > attr.radius * attr.radius) continue;
        carveFloor(world, attr.x + dx, attr.y + dy, tex.wallTex, tex.floorTex);
      }
    }

    // Central room in the courtyard
    let rw: number, rh: number, roomType: RoomType;
    [st, rw] = xshInt(st, Math.max(5, attr.radius - 4), attr.radius * 2 - 2);
    [st, rh] = xshInt(st, Math.max(5, attr.radius - 6), attr.radius * 2 - 4);
    rw = Math.min(rw, 40);
    rh = Math.min(rh, 30);
    [st, roomType] = xshPick(st, tex.roomTypes);
    const room = tryStampRoomInRegion(
      ctx, attr.x - Math.floor(rw / 2), attr.y - Math.floor(rh / 2),
      rw, rh, roomType, `Дворовый корпус ${i + 1}`,
    );
    if (room) {
      decorateRecipeRoom(world, room, st, ctx.industrial);
      rooms.push(room);
    }

    // Peripheral micro-rooms
    const peripCount = 3 + ((st >>> 3) & 3);
    for (let p = 0; p < peripCount; p++) {
      const angle = (p / peripCount) * Math.PI * 2;
      const dist = attr.radius + 4;
      const px = attr.x + Math.floor(Math.cos(angle) * dist);
      const py = attr.y + Math.floor(Math.sin(angle) * dist);
      let pw: number, ph: number, pType: RoomType;
      [st, pw] = xshInt(st, 5, 10);
      [st, ph] = xshInt(st, 5, 9);
      [st, pType] = xshPick(st, tex.roomTypes);
      const pRoom = tryStampRoomInRegion(
        ctx, px - Math.floor(pw / 2), py - Math.floor(ph / 2),
        pw, ph, pType, `Пристройка ${i + 1}.${p + 1}`,
      );
      if (pRoom) {
        decorateRecipeRoom(world, pRoom, st, ctx.industrial);
        rooms.push(pRoom);
      }
    }
  }

  // Connect attractors with wide corridors
  for (let i = 0; i < attractors.length; i++) {
    const next = attractors[(i + 1) % attractors.length];
    carveWideCorridor(
      world, attractors[i].x, attractors[i].y, next.x, next.y,
      2, tex.wallTex, tex.floorTex, 17, Feature.LAMP, st + i,
    );
  }
  // Cross-connections
  if (attractors.length >= 4) {
    for (let i = 0; i < Math.min(3, attractors.length); i++) {
      const a = attractors[i];
      const b = attractors[(i + Math.floor(attractors.length / 2)) % attractors.length];
      carveWideCorridor(world, a.x, a.y, b.x, b.y, 1, tex.wallTex, tex.floorTex, 21, Feature.LAMP, st + i + 100);
    }
  }

  return { rooms };
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Recipe registry                                               */
/* ═══════════════════════════════════════════════════════════════ */

type RecipeFn = (ctx: RecipeContext) => RecipeResult;

const RECIPE_REGISTRY: Record<ProceduralRecipeId, RecipeFn> = {
  voronoi_partition: recipeVoronoiPartition,
  manhattan_grid: recipeManhattanGrid,
  hilbert_fill: recipeHilbertFill,
  concentric_rings: recipeConcentricRings,
  organic_braid: recipeOrganicBraid,
  smart_quarter_infill: recipeSmartQuarterInfill,
  production_islands: recipeProductionIslands,
  dark_tunnel_web: recipeDarkTunnelWeb,
  dense_room_scatter: recipeDenseRoomScatter,
  attractor_courtyards: recipeAttractorCourtyards,
};

export function executeRecipe(id: ProceduralRecipeId, ctx: RecipeContext): RecipeResult {
  return RECIPE_REGISTRY[id](ctx);
}

export const ALL_RECIPE_IDS: readonly ProceduralRecipeId[] = Object.keys(RECIPE_REGISTRY) as ProceduralRecipeId[];

/* ═══════════════════════════════════════════════════════════════ */
/*  Sector division strategies                                    */
/* ═══════════════════════════════════════════════════════════════ */

export type SectorStrategy = 'grid_4x4' | 'grid_4x3' | 'grid_3x4' | 'grid_3x3';

export function divideTorus(strategy: SectorStrategy, _seed: number): RecipeRegion[] {
  let cols: number;
  let rows: number;
  switch (strategy) {
    case 'grid_4x4': cols = 4; rows = 4; break;
    case 'grid_4x3': cols = 4; rows = 3; break;
    case 'grid_3x4': cols = 3; rows = 4; break;
    case 'grid_3x3': cols = 3; rows = 3; break;
  }
  const regions: RecipeRegion[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x0 = Math.floor(col * W / cols);
      const y0 = Math.floor(row * W / rows);
      const x1 = Math.floor((col + 1) * W / cols);
      const y1 = Math.floor((row + 1) * W / rows);
      regions.push({ x0, y0, w: x1 - x0, h: y1 - y0 });
    }
  }
  return regions;
}

export function pickSectorStrategy(seed: number): SectorStrategy {
  const strategies: SectorStrategy[] = ['grid_4x4', 'grid_4x4', 'grid_4x3', 'grid_3x4', 'grid_3x3'];
  return strategies[((seed >>> 12) & 7) % strategies.length];
}
