/* ── Volatile maze — destroyed and rebuilt every samosbor ─────── */

import {
  W,
  Cell,
  Tex,
  RoomType,
  Feature,
  LiftDirection,
  type Room,
} from '../../core/types';
import { World } from '../../core/world';
import { ROOM_DEFS } from '../../data/catalog';
import { pickPosterTex } from './posters';
import {
  rng, pick, shuffle,
  connectRoomsMST, canPlaceRoom, stampRoom,
  decorateRoom, placeAbyssPits, connectToNetwork,
  ensureConnectivity, sanitizeDoors, pruneDeadEnds, placeLifts,
  repairRoomWalls, shapeRoom, openVolatileDoors,
  placeAirlocks, ensurePermanentRoomAccess, punchThinWalls,
} from '../shared';
import { connectApartmentsToMaze } from './apartments';
import { seedLivingMacroRouteIntent } from './geometry';
import { maybePlaceBrokenFixture } from '../interactive_fixtures';

/* ── Generate the volatile gigastructure ─────────────────────── */
function cleanupOldVolatileRooms(world: World): void {
  const aptCount = world.apartmentRoomCount;

  // Snapshot apartment doors before volatile doors are removed,
  // because world.removeDoorAt mutates room.doors arrays globally.
  const aptOldDoors: number[][] = [];
  for (let i = 0; i < aptCount; i++) {
    const room = world.rooms[i];
    aptOldDoors[i] = room ? room.doors.slice() : [];
  }
  // Remove any old volatile rooms & their doors
  for (let i = aptCount; i < world.rooms.length; i++) {
    const room = world.rooms[i];
    if (!room) continue;
    for (const di of room.doors.slice()) world.removeDoorAt(di);
  }
  world.rooms.length = aptCount;

  // Strip external (corridor-facing) doors from apartment rooms
  for (let i = 0; i < aptCount; i++) {
    const room = world.rooms[i];
    if (!room) continue;
    const keepDoors: number[] = [];
    const removeDoors: number[] = [];
    for (const di of aptOldDoors[i]) {
      const door = world.doors.get(di);
      if (!door) {
        // Door data already removed (by volatile room cleanup) — fix cell
        if (world.cells[di] === Cell.DOOR || world.cells[di] === Cell.FLOOR) {
          world.cells[di] = Cell.WALL;
          world.wallTex[di] = room.wallTex;
        }
        continue;
      }
      if (door.roomA >= 0 && door.roomA < aptCount &&
          door.roomB >= 0 && door.roomB < aptCount) {
        keepDoors.push(di);
        continue;
      }
      world.cells[door.idx] = Cell.WALL;
      world.wallTex[door.idx] = room.wallTex;
      removeDoors.push(di);
    }
    room.doors = keepDoors;
    for (const di of removeDoors) world.removeDoorAt(di);
    // Do not unseal explicitly sealed rooms (e.g. tutorial rooms)
    // room.sealed = false;
  }
}

function placeArchitecturalRooms(world: World, placed: Room[], connectable: Room[], nextRoomId: number): number {
  const SGRID = 16;
  const SCELL = Math.floor(W / SGRID);
  const superCells: [number, number][] = [];
  for (let sx = 0; sx < SGRID; sx++)
    for (let sy = 0; sy < SGRID; sy++)
      superCells.push([sx, sy]);
  shuffle(superCells);

  const archTypes = [RoomType.CORRIDOR, RoomType.CORRIDOR, RoomType.COMMON, RoomType.COMMON, RoomType.COMMON];
  const funcTypes = [RoomType.STORAGE, RoomType.MEDICAL, RoomType.PRODUCTION, RoomType.SMOKING, RoomType.OFFICE];
  for (const [sx, sy] of superCells) {
    if (Math.random() > 0.85) continue;

    const rt = Math.random() < 0.70 ? pick(archTypes) : pick(funcTypes);
    let rw: number, rh: number;
    if (rt === RoomType.COMMON) {
      rw = rng(8, 16); rh = rng(8, 14);
    } else if (rt === RoomType.CORRIDOR) {
      if (Math.random() < 0.5) { rw = rng(2, 3); rh = rng(10, 24); }
      else { rw = rng(10, 24); rh = rng(2, 3); }
    } else {
      const def = ROOM_DEFS[rt];
      rw = rng(def.minW, def.maxW);
      rh = rng(def.minH, def.maxH);
    }
    const bx = sx * SCELL + rng(2, Math.max(2, SCELL - rw - 4));
    const by = sy * SCELL + rng(2, Math.max(2, SCELL - rh - 4));
    if (!canPlaceRoom(world, bx, by, rw, rh)) continue;
    const room = stampRoom(world, nextRoomId++, rt, bx, by, rw, rh, -1);
    placed.push(room);
    connectable.push(room);
  }
  return nextRoomId;
}

function placeDenseFillRooms(world: World, placed: Room[], fillRooms: Room[], nextRoomId: number): number {
  const allFillTypes: RoomType[] = [
    RoomType.COMMON, RoomType.CORRIDOR, RoomType.STORAGE,
    RoomType.MEDICAL, RoomType.PRODUCTION,
    RoomType.KITCHEN, RoomType.BATHROOM,
    RoomType.SMOKING, RoomType.OFFICE,
  ];

  function randFillRoom(): [number, number, RoomType] {
    const area = Math.exp(2.0 + Math.random() * 2.8);
    const logAspect = (Math.random() - 0.5) * 3.0;
    const aspect = Math.exp(logAspect);
    let w = Math.round(Math.sqrt(area * aspect));
    let h = Math.round(Math.sqrt(area / aspect));
    w = Math.max(1, Math.min(20, w));
    h = Math.max(1, Math.min(20, h));
    let rt: RoomType;
    if (w <= 2 || h <= 2) rt = RoomType.CORRIDOR;
    else if (w >= 8 && h >= 8) rt = pick([RoomType.COMMON, RoomType.COMMON, RoomType.PRODUCTION]);
    else rt = pick(allFillTypes);
    return [w, h, rt];
  }

  for (let gy = 0; gy < W; gy += 7) {
    for (let gx = 0; gx < W; gx += 7) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const [rw, rh, rt] = randFillRoom();
        const ox = gx + rng(0, 4), oy = gy + rng(0, 4);
        if (canPlaceRoom(world, ox, oy, rw, rh)) {
          const room = stampRoom(world, nextRoomId++, rt, ox, oy, rw, rh, -1);
          placed.push(room);
          fillRooms.push(room);
          break;
        }
      }
    }
  }

  /* ── Connect fill rooms to existing network ────────── */
  for (const room of fillRooms) connectToNetwork(world, room);
  return nextRoomId;
}

function killIsolatedFloorPockets(world: World): void {
  const dirs: [number, number][] = [[1,0],[-1,0],[0,1],[0,-1]];
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (world.cells[i] !== Cell.FLOOR) continue;
        if (world.aptMask[i]) continue;
        let walkN = 0;
        for (const [dx, dy] of dirs) {
          const ni = world.idx(world.wrap(x + dx), world.wrap(y + dy));
          if (world.cells[ni] === Cell.FLOOR || world.cells[ni] === Cell.DOOR) walkN++;
        }
        if (walkN === 0) {
          world.cells[i] = Cell.WALL;
          world.features[i] = 0;
          world.roomMap[i] = -1;
          changed = true;
        }
      }
    }
  }
}

function applyVolatileRoomFeatures(world: World, placed: Room[]): void {
  /* ── Volatile room textures ────────────────────────── */
  for (const room of placed) {
    for (let dy = 0; dy < room.h; dy++)
      for (let dx = 0; dx < room.w; dx++)
        world.floorTex[world.idx(room.x + dx, room.y + dy)] = room.floorTex;
  }

  /* ── Volatile room features ────────────────────────── */
  const VOL_FEATURES: Record<RoomType, Feature[]> = {
    [RoomType.LIVING]:     [Feature.LAMP, Feature.BED, Feature.TABLE, Feature.CHAIR, Feature.SHELF],
    [RoomType.KITCHEN]:    [Feature.LAMP, Feature.STOVE, Feature.TABLE, Feature.SINK, Feature.SHELF],
    [RoomType.BATHROOM]:   [Feature.LAMP, Feature.TOILET, Feature.SINK],
    [RoomType.STORAGE]:    [Feature.LAMP, Feature.SHELF, Feature.SHELF, Feature.MACHINE],
    [RoomType.MEDICAL]:    [Feature.LAMP, Feature.SHELF, Feature.TABLE, Feature.APPARATUS],
    [RoomType.COMMON]:     [Feature.LAMP, Feature.LAMP, Feature.TABLE, Feature.CHAIR, Feature.CHAIR],
    [RoomType.PRODUCTION]: [Feature.LAMP, Feature.MACHINE, Feature.APPARATUS, Feature.TABLE],
    [RoomType.CORRIDOR]:   [Feature.LAMP],
    [RoomType.SMOKING]:    [Feature.LAMP, Feature.CHAIR, Feature.CHAIR, Feature.TABLE],
    [RoomType.OFFICE]:     [Feature.LAMP, Feature.TABLE, Feature.TABLE, Feature.CHAIR, Feature.SHELF],
    [RoomType.HQ]:         [Feature.LAMP, Feature.TABLE, Feature.CHAIR, Feature.SHELF],
    [RoomType.CLASSROOM]:  [Feature.LAMP, Feature.TABLE, Feature.CHAIR, Feature.CHAIR, Feature.SHELF],
  };
  for (const room of placed) {
    world.features[world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2))] = Feature.LAMP;
    const feats = VOL_FEATURES[room.type] ?? [Feature.LAMP];
    for (const feat of feats) {
      if (feat === Feature.LAMP) continue;
      for (let tries = 0; tries < 10; tries++) {
        const fx = room.x + rng(1, Math.max(1, room.w - 2));
        const fy = room.y + rng(1, Math.max(1, room.h - 2));
        const fi = world.idx(fx, fy);
        if (world.features[fi] === Feature.NONE && world.cells[fi] === Cell.FLOOR) {
          world.features[fi] = feat;
          maybePlaceBrokenFixture(world, fx, fy, { salt: room.id * 31 + tries });
          break;
        }
      }
    }
  }
}

function applyGlobalTexturesAndCorridors(world: World): void {
  /* ── Global wall/floor/corridor textures ───────────── */
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (world.cells[i] !== Cell.WALL || world.aptMask[i]) continue;
      for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const ni = world.idx(x + ddx, y + ddy);
        const rid = world.roomMap[ni];
        if (rid >= 0 && world.rooms[rid]) {
          world.wallTex[i] = world.rooms[rid].wallTex;
          break;
        }
      }
    }
  }
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.FLOOR && world.roomMap[i] < 0) {
      const x = i % W, y = (i / W) | 0;
      world.floorTex[i] = ((x >> 5) + (y >> 5)) & 1 ? Tex.F_CONCRETE : Tex.F_LINO;
    }
  }
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.WALL && world.wallTex[i] === 0 && !world.aptMask[i]) {
      const x = i % W, y = (i / W) | 0;
      world.wallTex[i] = ((x >> 6) ^ (y >> 6)) & 1 ? Tex.CONCRETE : Tex.BRICK;
    }
  }

  /* ── Corridor lamps ────────────────────────────────── */
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.FLOOR && world.roomMap[i] < 0 && world.features[i] === Feature.NONE) {
      if (Math.random() < 0.04) world.features[i] = Feature.LAMP;
    }
  }

  /* ── Agitprop posters on corridor walls ─────────────── */
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] !== Cell.WALL || world.aptMask[i]) continue;
    if (world.wallTex[i] !== Tex.CONCRETE && world.wallTex[i] !== Tex.BRICK && world.wallTex[i] !== Tex.PANEL) continue;
    // Only walls adjacent to corridor floor (not room interiors)
    const x = i % W, y = (i / W) | 0;
    let adjCorridor = false;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const ni = world.idx(x + dx, y + dy);
      if (world.cells[ni] === Cell.FLOOR && world.roomMap[ni] < 0) { adjCorridor = true; break; }
    }
    if (adjCorridor && Math.random() < 0.02) {
      world.wallTex[i] = pickPosterTex(x, y);
    }
  }
}

export function generateVolatileMaze(world: World): void {
  const aptCount = world.apartmentRoomCount;
  let nextRoomId = aptCount;

  cleanupOldVolatileRooms(world);

  const placed: Room[] = [];
  const connectable: Room[] = [];

  /* ── Macro route intent: reserve readable public/service/shelter lanes before random rooms. */
  seedLivingMacroRouteIntent(world);

  nextRoomId = placeArchitecturalRooms(world, placed, connectable, nextRoomId);

  /* ── MST corridors between volatile rooms only ─────── */
  connectRoomsMST(world, connectable);

  const fillRooms: Room[] = [];
  nextRoomId = placeDenseFillRooms(world, placed, fillRooms, nextRoomId);

  /* ── Repair + sanitize ─────────────────────────────── */
  repairRoomWalls(world);
  sanitizeDoors(world);
  pruneDeadEnds(world);

  /* ── Percolation — start from first volatile room ──── */
  if (placed.length > 0) {
    const vr = placed[0];
    ensureConnectivity(world, vr.x + Math.floor(vr.w / 2) + 0.5, vr.y + Math.floor(vr.h / 2) + 0.5);
  }

  /* ── Shape rooms ───────────────────────────────────── */
  for (const room of placed) shapeRoom(world, room);

  /* ── Second repair pass after shaping ──────────────── */
  repairRoomWalls(world);
  sanitizeDoors(world);
  pruneDeadEnds(world);

  if (placed.length > 0) {
    const vr2 = placed[0];
    ensureConnectivity(world, vr2.x + Math.floor(vr2.w / 2) + 0.5, vr2.y + Math.floor(vr2.h / 2) + 0.5);
  }

  /* ── Connect apartments ────────────────────────────── */
  connectApartmentsToMaze(world);
  sanitizeDoors(world);

  if (placed.length > 0) {
    const vr3 = placed[0];
    ensureConnectivity(world, vr3.x + Math.floor(vr3.w / 2) + 0.5, vr3.y + Math.floor(vr3.h / 2) + 0.5);
  }

  /* ── Punch thin walls for shortcut loops ────────────── */
  punchThinWalls(world, 0.12);

  /* ── Convert non-apartment doors to floor openings ─── */
  openVolatileDoors(world);

  /* ── Zone boundary airlocks ────────────────────────── */
  placeAirlocks(world);
  pruneDeadEnds(world);

  /* ── Kill isolated single-cell floor pockets ───────── */
  killIsolatedFloorPockets(world);

  /* ── Post-airlock connectivity ─────────────────────── */
  if (placed.length > 0) {
    const vrF = placed[0];
    ensureConnectivity(world, vrF.x + Math.floor(vrF.w / 2) + 0.5, vrF.y + Math.floor(vrF.h / 2) + 0.5);
  }

  /* ── Connect any isolated permanent rooms (universal) ─ */
  ensurePermanentRoomAccess(world);

  /* ── Final cleanup — catch any comb/dead-end artifacts ─ */
  sanitizeDoors(world);
  pruneDeadEnds(world);

  /* ── Decorations ───────────────────────────────────── */
  for (const room of placed) {
    if (room.type === RoomType.COMMON || room.type === RoomType.CORRIDOR || room.type === RoomType.PRODUCTION) {
      decorateRoom(world, room);
    }
  }

  /* ── Abyss pits ────────────────────────────────────── */
  placeAbyssPits(world);

  /* ── Volatile room textures and features ───────────── */
  applyVolatileRoomFeatures(world, placed);

  /* ── Global wall/floor/corridor textures & features ── */
  applyGlobalTexturesAndCorridors(world);

  /* ── Lifts + lightmap ──────────────────────────────── */
  placeLifts(world, 8, LiftDirection.DOWN);  // half go down to maintenance
  placeLifts(world, 8, LiftDirection.UP);    // half go up to kvartiry
  world.bakeLights();
}

export function pruneVolatileSideArrays(world: World): { screenCells: number; surfaceCells: number } {
  let write = 0;
  const seenScreens = new Set<number>();
  for (const ci of world.screenCells) {
    if (!world.aptMask[ci] || seenScreens.has(ci)) continue;
    world.screenCells[write++] = ci;
    seenScreens.add(ci);
  }
  const removedScreens = world.screenCells.length - write;
  world.screenCells.length = write;

  let removedSurfaces = 0;
  for (const [ci] of world.surfaceMap) {
    if (world.aptMask[ci]) continue;
    world.surfaceMap.delete(ci);
    world.surfaceFlags[ci] = 0;
    removedSurfaces++;
  }
  if (removedSurfaces > 0) world.markSurfaceDirty();

  return { screenCells: removedScreens, surfaceCells: removedSurfaces };
}

/* ── Wipe all volatile (non-apartment) data ──────────────────── */
export function wipeVolatile(world: World): void {
  pruneVolatileSideArrays(world);
  for (let i = 0; i < W * W; i++) {
    if (world.aptMask[i]) continue;
    world.cells[i] = Cell.WALL;
    world.roomMap[i] = -1;
    world.wallTex[i] = 0;
    world.floorTex[i] = 0;
    world.features[i] = 0;
    world.light[i] = 0;
    world.hermoWall[i] = 0;
    world.liftDir[i] = 0;
  }
  for (const [idx] of Array.from(world.doors)) {
    if (world.aptMask[idx]) continue;
    world.removeDoorAt(idx);
  }
}
