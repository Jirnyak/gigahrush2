import { W, Cell, Feature, Tex, msg, type Entity, type GameState } from '../../core/types';
import { World } from '../../core/world';
import { RUNTIME_TOPOLOGY_LIMITS } from '../../data/runtime_topology';
import { isPlayerEntity } from '../player_actor';

interface ShiftSection {
  roomId: number;
  x: number;
  y: number;
  w: number;
  h: number;
  phase: number;
  apparatus: number;
  controlX: number;
  controlY: number;
  baseCells: Uint8Array;
  baseWallTex: Uint8Array;
  baseFloorTex: Uint8Array;
  activeWalls: number[];
  cycle: number;
  nextShiftAt: number;
  stableUntil: number;
  controlReadyAt: number;
  warned: boolean;
}

interface ShiftRuntime {
  sections: ShiftSection[];
  lastMsgTime: number;
}

const SECTION_SHIFT_RE = /\[section_shift:(-?\d+),(-?\d+),(\d+),(\d+),(\d+)\]/;
const MIN_WARNING_SECONDS = 4.5;
const SAFE_SEARCH_RADIUS = 4;
const FREEZE_SECONDS = 45;
const CONTROL_COOLDOWN_SECONDS = 75;
const runtimeByWorld = new WeakMap<World, ShiftRuntime | null>();

function localIndex(section: ShiftSection, lx: number, ly: number): number {
  return ly * section.w + lx;
}

function localPoint(world: World, section: Pick<ShiftSection, 'x' | 'y' | 'w' | 'h'>, x: number, y: number): { x: number; y: number } {
  return {
    x: ((world.delta(section.x, x) % section.w) + section.w) % section.w,
    y: ((world.delta(section.y, y) % section.h) + section.h) % section.h,
  };
}

function sectionIdx(world: World, section: Pick<ShiftSection, 'x' | 'y'>, lx: number, ly: number): number {
  return world.idx(section.x + lx, section.y + ly);
}

function findControlPoint(world: World, x: number, y: number, w: number, h: number): { apparatus: number; controlX: number; controlY: number } {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.features[ci] === Feature.APPARATUS) {
        return { apparatus: ci, controlX: dx, controlY: dy };
      }
    }
  }
  return {
    apparatus: -1,
    controlX: Math.max(1, Math.min(w - 2, Math.floor(w / 2))),
    controlY: Math.max(1, Math.min(h - 2, Math.floor(h / 2))),
  };
}

function captureBase(world: World, x: number, y: number, w: number, h: number): {
  baseCells: Uint8Array;
  baseWallTex: Uint8Array;
  baseFloorTex: Uint8Array;
} {
  const count = w * h;
  const baseCells = new Uint8Array(count);
  const baseWallTex = new Uint8Array(count);
  const baseFloorTex = new Uint8Array(count);
  for (let ly = 0; ly < h; ly++) {
    for (let lx = 0; lx < w; lx++) {
      const li = ly * w + lx;
      const ci = world.idx(x + lx, y + ly);
      baseCells[li] = world.cells[ci];
      baseWallTex[li] = world.wallTex[ci];
      baseFloorTex[li] = world.floorTex[ci];
    }
  }
  return { baseCells, baseWallTex, baseFloorTex };
}

function initShift(world: World): ShiftRuntime | null {
  const cached = runtimeByWorld.get(world);
  if (cached !== undefined) return cached;
  const sections: ShiftSection[] = [];
  for (const room of world.rooms) {
    if (sections.length >= RUNTIME_TOPOLOGY_LIMITS.sectionShiftMaxSections) break;
    const match = SECTION_SHIFT_RE.exec(room.name);
    if (!match) continue;
    const x = Number(match[1]);
    const y = Number(match[2]);
    const w = Number(match[3]);
    const h = Number(match[4]);
    const phase = Number(match[5]);
    if (w >= 5 && h >= 5 && w * h <= RUNTIME_TOPOLOGY_LIMITS.sectionShiftMaxSectionCells) {
      const control = findControlPoint(world, x, y, w, h);
      const base = captureBase(world, x, y, w, h);
      sections.push({
        roomId: room.id,
        x,
        y,
        w,
        h,
        phase,
        apparatus: control.apparatus,
        controlX: control.controlX,
        controlY: control.controlY,
        ...base,
        activeWalls: [],
        cycle: phase,
        nextShiftAt: MIN_WARNING_SECONDS + phase * 0.8,
        stableUntil: 0,
        controlReadyAt: 0,
        warned: false,
      });
    }
  }
  const runtime = sections.length > 0 ? { sections, lastMsgTime: -Infinity } : null;
  runtimeByWorld.set(world, runtime);
  return runtime;
}

function inside(world: World, section: ShiftSection, x: number, y: number): boolean {
  const dx = world.delta(section.x, x);
  const dy = world.delta(section.y, y);
  return dx >= 0 && dy >= 0 && dx < section.w && dy < section.h;
}

function isWalkableDestination(world: World, x: number, y: number): boolean {
  const ci = world.idx(x, y);
  return (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER) &&
    world.features[ci] !== Feature.LIFT_BUTTON &&
    world.hermoWall[ci] === 0 &&
    world.aptMask[ci] === 0 &&
    !world.doors.has(ci);
}

function hasSafeNeighbor(world: World, x: number, y: number): boolean {
  return isWalkableDestination(world, x + 1, y) ||
    isWalkableDestination(world, x - 1, y) ||
    isWalkableDestination(world, x, y + 1) ||
    isWalkableDestination(world, x, y - 1);
}

function isSafeDestination(world: World, x: number, y: number): boolean {
  return isWalkableDestination(world, x, y) && hasSafeNeighbor(world, x, y);
}

function shiftedPoint(world: World, section: ShiftSection, x: number, y: number): { x: number; y: number } {
  const p = localPoint(world, section, x, y);
  const sx = (p.x + Math.max(2, Math.floor(section.w / 2)) + section.phase) % section.w;
  const sy = (p.y + Math.max(2, Math.floor(section.h / 3)) + section.phase * 2) % section.h;
  return { x: world.wrap(section.x + sx), y: world.wrap(section.y + sy) };
}

function nearbySafe(world: World, section: ShiftSection, x: number, y: number): { x: number; y: number } | null {
  if (inside(world, section, x, y) && isSafeDestination(world, x, y)) return { x, y };
  for (let r = 1; r <= SAFE_SEARCH_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const tx = world.wrap(x + dx);
        const ty = world.wrap(y + dy);
        if (inside(world, section, tx, ty) && isSafeDestination(world, tx, ty)) return { x: tx, y: ty };
      }
    }
  }
  return null;
}

function tintLocal(world: World, x: number, y: number, phase: number): number {
  let changed = 0;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.cells[ci] === Cell.WALL || world.cells[ci] === Cell.LIFT) continue;
      const next = Math.max(world.fog[ci], 36 + phase * 10);
      if (next !== world.fog[ci]) {
        world.fog[ci] = next;
        changed++;
      }
    }
  }
  if (changed > 0) world.markFogDirty();
  return changed;
}

function seamLocal(section: ShiftSection, cycle: number): { x: number; y: number } {
  const innerW = Math.max(1, section.w - 2);
  const innerH = Math.max(1, section.h - 2);
  return {
    x: 1 + ((section.phase * 3 + cycle * 5) % innerW),
    y: 1 + ((section.phase * 5 + cycle * 3) % innerH),
  };
}

function isWarningCorridor(section: ShiftSection, lx: number, ly: number): boolean {
  return lx === 0 || ly === 0 || lx === section.w - 1 || ly === section.h - 1 ||
    lx === section.controlX || ly === section.controlY;
}

function isSeamCell(section: ShiftSection, cycle: number, lx: number, ly: number): boolean {
  const seam = seamLocal(section, cycle);
  return !isWarningCorridor(section, lx, ly) && (lx === seam.x || ly === seam.y);
}

function mutableShiftCell(world: World, section: ShiftSection, lx: number, ly: number, protectedIdx = -1): boolean {
  const ci = sectionIdx(world, section, lx, ly);
  if (ci === protectedIdx || ci === section.apparatus) return false;
  const cell = section.baseCells[localIndex(section, lx, ly)] as Cell;
  if (cell !== Cell.FLOOR && cell !== Cell.WATER) return false;
  if (world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR || world.cells[ci] === Cell.ABYSS) return false;
  if (world.hermoWall[ci] !== 0 || world.aptMask[ci] !== 0 || world.doors.has(ci) || world.containerMap.has(ci)) return false;
  return world.features[ci] === Feature.NONE;
}

function restoreBaseCell(world: World, section: ShiftSection, lx: number, ly: number): number {
  const ci = sectionIdx(world, section, lx, ly);
  const li = localIndex(section, lx, ly);
  let changed = 0;
  const cell = section.baseCells[li] as Cell;
  const wallTex = section.baseWallTex[li] as Tex;
  const floorTex = section.baseFloorTex[li] as Tex;
  if (world.cells[ci] !== cell) {
    world.cells[ci] = cell;
    changed++;
  }
  if (world.wallTex[ci] !== wallTex) {
    world.wallTex[ci] = wallTex;
    changed++;
  }
  if (world.floorTex[ci] !== floorTex) {
    world.floorTex[ci] = floorTex;
    changed++;
  }
  return changed;
}

function restoreActiveWalls(world: World, section: ShiftSection): number {
  let changed = 0;
  for (const ci of section.activeWalls) {
    const x = ci % W;
    const y = (ci / W) | 0;
    const p = localPoint(world, section, x, y);
    changed += restoreBaseCell(world, section, p.x, p.y);
  }
  section.activeWalls.length = 0;
  return changed;
}

function paintWarningSeam(world: World, section: ShiftSection): number {
  let changed = 0;
  const cycle = section.cycle + 1;
  for (let ly = 0; ly < section.h; ly++) {
    for (let lx = 0; lx < section.w; lx++) {
      if (!isSeamCell(section, cycle, lx, ly)) continue;
      if (!mutableShiftCell(world, section, lx, ly)) continue;
      const ci = sectionIdx(world, section, lx, ly);
      const nextFog = Math.max(world.fog[ci], 44 + section.phase * 9);
      if (world.floorTex[ci] !== Tex.F_TILE) {
        world.floorTex[ci] = Tex.F_TILE;
        changed++;
      }
      if (world.fog[ci] !== nextFog) {
        world.fog[ci] = nextFog;
        changed++;
      }
    }
  }
  if (changed > 0) {
    world.markFloorTexDirty();
    world.markFogDirty();
  }
  return changed;
}

function applyTopologyShift(world: World, section: ShiftSection, protectedIdx: number): number {
  let changed = restoreActiveWalls(world, section);
  const nextCycle = section.cycle + 1;
  for (let ly = 0; ly < section.h; ly++) {
    for (let lx = 0; lx < section.w; lx++) {
      if (!isSeamCell(section, nextCycle, lx, ly)) continue;
      if (!mutableShiftCell(world, section, lx, ly, protectedIdx)) continue;
      const ci = sectionIdx(world, section, lx, ly);
      if (world.cells[ci] !== Cell.WALL) {
        world.cells[ci] = Cell.WALL;
        changed++;
      }
      if (world.wallTex[ci] !== Tex.METAL) {
        world.wallTex[ci] = Tex.METAL;
        changed++;
      }
      if (world.floorTex[ci] !== Tex.F_TILE) {
        world.floorTex[ci] = Tex.F_TILE;
        changed++;
      }
      const nextFog = Math.max(world.fog[ci], 52 + section.phase * 8);
      if (world.fog[ci] !== nextFog) {
        world.fog[ci] = nextFog;
        changed++;
      }
      section.activeWalls.push(ci);
    }
  }
  section.cycle = nextCycle;
  if (changed > 0) {
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFogDirty();
  }
  return changed;
}

function ensureEscapePocket(world: World, section: ShiftSection, x: number, y: number): number {
  let changed = 0;
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) {
    world.cells[ci] = Cell.FLOOR;
    changed++;
  }
  if (hasSafeNeighbor(world, x, y)) {
    if (changed > 0) world.markCellsDirty();
    return changed;
  }
  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ] as const;
  for (const dir of dirs) {
    const tx = world.wrap(x + dir.x);
    const ty = world.wrap(y + dir.y);
    if (!inside(world, section, tx, ty)) continue;
    const p = localPoint(world, section, tx, ty);
    if (!mutableShiftCell(world, section, p.x, p.y)) continue;
    const ti = world.idx(tx, ty);
    if (world.cells[ti] !== Cell.FLOOR) {
      world.cells[ti] = Cell.FLOOR;
      changed++;
    }
    break;
  }
  if (changed > 0) world.markCellsDirty();
  return changed;
}

export function updateSectionShiftAnomaly(world: World, player: Entity, state: GameState, dt: number): void {
  if (!isPlayerEntity(player)) return;
  const runtime = initShift(world);
  if (!runtime) return;
  const px = world.wrap(Math.floor(player.x));
  const py = world.wrap(Math.floor(player.y));
  const ci = world.idx(px, py);
  const roomId = world.roomMap[ci];

  for (const section of runtime.sections) {
    if (section.roomId !== roomId || !inside(world, section, px, py)) continue;
    if (state.time < section.stableUntil) return;

    if (!section.warned) {
      section.warned = true;
      section.nextShiftAt = Math.max(section.nextShiftAt, MIN_WARNING_SECONDS);
      paintWarningSeam(world, section);
      state.msgs.push(msg('Секция пола не совпадает с потолком. Через несколько секунд она сдвинется.', state.time, '#fa4'));
      return;
    }

    section.nextShiftAt -= dt;
    if (section.nextShiftAt > 0) {
      if (section.nextShiftAt < 1.1 && state.time - runtime.lastMsgTime > 2) {
        runtime.lastMsgTime = state.time;
        state.msgs.push(msg('Шов секции пошел в сторону. Можно отскочить или выключить аппарат.', state.time, '#fa4'));
      }
      return;
    }

    const shifted = shiftedPoint(world, section, px, py);
    const safe = nearbySafe(world, section, shifted.x, shifted.y);
    let safeIdx = -1;
    if (safe) {
      safeIdx = world.idx(safe.x, safe.y);
      player.x = safe.x + 0.5;
      player.y = safe.y + 0.5;
      tintLocal(world, safe.x, safe.y, section.phase);
      state.msgs.push(msg('Комната щелкнула, и вы оказались у другого шва той же секции.', state.time, '#c8f'));
    } else {
      player.hp = Math.max(1, (player.hp ?? 100) - 4);
      state.msgs.push(msg('Секция дернулась, но не смогла вас замуровать. Ребра запомнили удар.', state.time, '#f84'));
    }
    const fx = world.wrap(Math.floor(player.x));
    const fy = world.wrap(Math.floor(player.y));
    if (safeIdx < 0) safeIdx = world.idx(fx, fy);
    applyTopologyShift(world, section, safeIdx);
    ensureEscapePocket(world, section, fx, fy);
    section.warned = false;
    section.nextShiftAt = 7.5 + section.phase * 1.5;
    return;
  }
}

export function tryUseSectionShiftAnomaly(world: World, _player: Entity, state: GameState, lookX: number, lookY: number): boolean {
  const runtime = initShift(world);
  if (!runtime) return false;
  const lookIdx = world.idx(Math.floor(lookX), Math.floor(lookY));
  for (const section of runtime.sections) {
    if (section.apparatus !== lookIdx) continue;
    if (state.time < section.controlReadyAt) {
      const left = Math.max(1, Math.ceil(section.controlReadyAt - state.time));
      state.msgs.push(msg(`Реле секции еще горячее. Повторный замороз доступен через ${left} с.`, state.time, '#fa4'));
      return true;
    }
    section.stableUntil = Math.max(section.stableUntil, state.time + FREEZE_SECONDS);
    section.controlReadyAt = state.time + CONTROL_COOLDOWN_SECONDS;
    section.nextShiftAt = 9;
    section.warned = false;
    state.msgs.push(msg('Аппарат секции щелкнул реле. Сдвиг заморожен почти на минуту.', state.time, '#8cf'));
    return true;
  }
  return false;
}
