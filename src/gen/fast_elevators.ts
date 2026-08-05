import { Cell, Feature, Tex, W } from '../core/types';
import type { World } from '../core/world';

const GRID = 4;
const STEP = Math.floor(W / GRID); // 256 on a 1024 torus
const OFFSET = Math.floor(STEP / 2); // 128
const CARVE_SEARCH_RADIUS = 40;

/**
 * Absolute, deterministic 4x4 fast-elevator grid (16 cabins) stamped at fixed
 * world positions on every floor for fast travel.
 *
 * Each cabin is a `Cell.LIFT` carrying `Feature.MACHINE`. That pair is the unique
 * fast-elevator marker (ordinary route lifts carry no `MACHINE`, ordinary machines
 * sit on `Cell.FLOOR`), so the interaction, render and route-lift layers can tell
 * the two apart.
 *
 * The grid is absolute by design: cabins overwrite whatever occupied their fixed
 * cell (wall, room, abyss), are max-protected via `aptMask` so samosbor waves and
 * volatile regrowth never erase them, and a short passage is carved to the nearest
 * reachable floor so a cabin is never sealed inside solid wall mass.
 *
 * Re-injection is idempotent: the same fixed cells every load, so it is safe to
 * call on fresh generation, memory restore and samosbor rebuild alike.
 */
export function injectFastElevators(world: World): void {
  let changed = false;
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const x = gx * STEP + OFFSET;
      const y = gy * STEP + OFFSET;
      if (stampFastElevator(world, x, y)) changed = true;
    }
  }
  if (changed) {
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFeaturesDirty(true);
  }
}

export function isFastElevatorCell(world: World, idx: number): boolean {
  return world.cells[idx] === Cell.LIFT && world.features[idx] === Feature.MACHINE;
}

function stampFastElevator(world: World, x: number, y: number): boolean {
  const idx = world.idx(x, y);
  const already = isFastElevatorCell(world, idx);
  // Force the cabin cell, overwriting whatever was there (wall, room, apartment).
  if (world.doors.has(idx)) world.removeDoorAt(idx);
  if (world.containerMap.has(idx)) world.containerMap.delete(idx);
  world.cells[idx] = Cell.LIFT;
  world.features[idx] = Feature.MACHINE;
  world.roomMap[idx] = -1;
  world.wallTex[idx] = Tex.LIFT_DOOR;
  world.floorTex[idx] = Tex.F_CONCRETE;
  world.aptMask[idx] = 1; // max protection: survive samosbor + volatile wipe
  world.hermoWall[idx] = 0; // a cabin must stay walkable, never a solid hermetic wall
  carvePassageToNearestFloor(world, x, y);
  return !already;
}

function carvePassageToNearestFloor(world: World, x: number, y: number): void {
  if (hasWalkableNeighbor(world, x, y)) return; // already reachable, no carving needed

  let bestX = -1;
  let bestY = -1;
  let bestD2 = Infinity;
  for (let r = 1; r <= CARVE_SEARCH_RADIUS && bestX < 0; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring perimeter only
        const nx = world.wrap(x + dx);
        const ny = world.wrap(y + dy);
        const idx = world.idx(nx, ny);
        if (isFastElevatorCell(world, idx)) continue;
        const cell = world.cells[idx];
        if (cell !== Cell.FLOOR && cell !== Cell.DOOR && cell !== Cell.WATER) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestX = nx;
          bestY = ny;
        }
      }
    }
  }

  if (bestX < 0) {
    // No reachable floor nearby: open the four cardinal neighbours so the cabin
    // is at least locally walkable.
    carveFloorCell(world, world.wrap(x + 1), y);
    carveFloorCell(world, world.wrap(x - 1), y);
    carveFloorCell(world, x, world.wrap(y + 1));
    carveFloorCell(world, x, world.wrap(y - 1));
    return;
  }

  carveLineToTarget(world, x, y, bestX, bestY);
}

function carveLineToTarget(world: World, x: number, y: number, tx: number, ty: number): void {
  // Toroidal L-path: step along x, then along y, opening solid cells to floor.
  let cx = x;
  let cy = y;
  const stepX = Math.sign(world.delta(cx, tx));
  let guard = 0;
  while (cx !== tx && guard++ < W) {
    cx = world.wrap(cx + stepX);
    if (cx === tx && cy === ty) break;
    carveFloorCell(world, cx, cy);
  }
  const stepY = Math.sign(world.delta(cy, ty));
  guard = 0;
  while (cy !== ty && guard++ < W) {
    cy = world.wrap(cy + stepY);
    if (cx === tx && cy === ty) break;
    carveFloorCell(world, cx, cy);
  }
}

function carveFloorCell(world: World, x: number, y: number): void {
  const idx = world.idx(x, y);
  if (isFastElevatorCell(world, idx)) return; // never carve through another cabin
  const cell = world.cells[idx];
  if (cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.WATER) return; // already walkable
  if (world.doors.has(idx)) world.removeDoorAt(idx);
  world.cells[idx] = Cell.FLOOR;
  world.roomMap[idx] = -1;
  world.floorTex[idx] = Tex.F_CONCRETE;
  world.wallTex[idx] = Tex.CONCRETE;
  world.features[idx] = Feature.NONE;
}

function hasWalkableNeighbor(world: World, x: number, y: number): boolean {
  for (let i = 0; i < 4; i++) {
    const nx = world.wrap(x + (i === 0 ? 1 : i === 1 ? -1 : 0));
    const ny = world.wrap(y + (i === 2 ? 1 : i === 3 ? -1 : 0));
    const cell = world.cells[world.idx(nx, ny)];
    if (cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.WATER) return true;
  }
  return false;
}
