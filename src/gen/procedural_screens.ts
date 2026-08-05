/* ── Procedural wall screens / TVs ────────────────────────────── */

import {
  W,
  Cell,
  Feature,
  FloorLevel,
  RoomType,
  Tex,
  ZoneFaction,
  type Room,
} from '../core/types';
import { World } from '../core/world';
import {
  SCREEN_SIGNAL_DEFS,
  screenSignalEligible,
  screenSignalForVariant,
  type ScreenSignalDef,
  type ScreenSignalId,
} from '../data/screen_signals';
import {
  SCREEN_FRAMES,
  isProceduralScreenTex,
  proceduralScreenHash01,
  proceduralScreenTex,
} from '../data/procedural_screen_textures';

export { SCREEN_FRAMES, SCREEN_VARIANTS } from '../data/procedural_screen_textures';

const SCREEN_MAX_RATIO = 0.01;
const SCREEN_CONTEXT_RADIUS = 10;

const FLOOR_CAP: Record<FloorLevel, number> = {
  [FloorLevel.MINISTRY]: 180,
  [FloorLevel.KVARTIRY]: 160,
  [FloorLevel.LIVING]: 120,
  [FloorLevel.MAINTENANCE]: 90,
  [FloorLevel.HELL]: 48,
  [FloorLevel.VOID]: 0,
};

const DIRS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const proceduralScreenCells = new WeakMap<World, Set<number>>();

interface ScreenSignalContext {
  zoneFaction?: ZoneFaction;
  zoneLevel: number;
  zoneHasLift: boolean;
  nearLift: boolean;
  nearTeleport: boolean;
  nearRail: boolean;
  nearSmog: boolean;
  samosborZone: boolean;
  falseSafeRoom: boolean;
}

function hash01(x: number, y: number, s: number): number {
  return proceduralScreenHash01(x, y, s);
}

function floorScreenCap(floor: FloorLevel): number {
  return Math.min(FLOOR_CAP[floor], Math.floor(W * W * SCREEN_MAX_RATIO));
}

function baseWallTexFor(floor: FloorLevel): Tex {
  switch (floor) {
    case FloorLevel.MINISTRY: return Tex.MARBLE;
    case FloorLevel.MAINTENANCE: return Tex.PIPE;
    case FloorLevel.HELL: return Tex.MEAT;
    default: return Tex.PANEL;
  }
}

function isTrackedScreenStillPresent(world: World, ci: number): boolean {
  return isProceduralScreenTex(world.wallTex[ci]) || world.features[ci] === Feature.SCREEN;
}

function restoreScreenWall(world: World, floor: FloorLevel, ci: number): void {
  if (world.cells[ci] !== Cell.WALL) return;
  const x = ci % W;
  const y = (ci / W) | 0;
  let restored = false;
  for (const [dx, dy] of DIRS) {
    const ni = world.idx(x + dx, y + dy);
    const rid = world.roomMap[ni];
    const room = rid >= 0 ? world.rooms[rid] : undefined;
    if (room) {
      world.wallTex[ci] = room.wallTex;
      restored = true;
      break;
    }
  }
  if (!restored) world.wallTex[ci] = baseWallTexFor(floor);
  if (world.features[ci] === Feature.SCREEN) world.features[ci] = Feature.NONE;
}

function restoreExistingScreens(world: World, floor: FloorLevel): void {
  const owned = proceduralScreenCells.get(world);
  const kept: number[] = [];
  const seen = new Set<number>();
  for (const ci of world.screenCells) {
    if (owned?.has(ci)) {
      restoreScreenWall(world, floor, ci);
      continue;
    }
    if (!isTrackedScreenStillPresent(world, ci) || seen.has(ci)) continue;
    seen.add(ci);
    kept.push(ci);
  }
  world.screenCells.length = 0;
  world.screenCells.push(...kept);
  if (owned) owned.clear();
}

function isPlainWallTexture(tex: number): boolean {
  return tex === Tex.CONCRETE || tex === Tex.BRICK || tex === Tex.PANEL || tex === Tex.TILE_W
    || tex === Tex.METAL || tex === Tex.PIPE || tex === Tex.MARBLE || tex === Tex.MEAT || tex === Tex.GUT;
}

function isRoomEligible(floor: FloorLevel, room: Room): boolean {
  if (room.name === 'Актовый зал') return false;
  switch (floor) {
    case FloorLevel.MINISTRY:
      return room.type === RoomType.OFFICE || room.type === RoomType.COMMON || room.type === RoomType.CORRIDOR
        || room.type === RoomType.MEDICAL || room.type === RoomType.STORAGE;
    case FloorLevel.KVARTIRY:
      return room.type === RoomType.LIVING || room.type === RoomType.KITCHEN || room.type === RoomType.COMMON
        || room.type === RoomType.OFFICE || room.type === RoomType.SMOKING;
    case FloorLevel.LIVING:
      return room.type === RoomType.LIVING || room.type === RoomType.COMMON || room.type === RoomType.PRODUCTION
        || room.type === RoomType.OFFICE || room.type === RoomType.MEDICAL;
    case FloorLevel.MAINTENANCE:
      return room.type === RoomType.PRODUCTION || room.type === RoomType.OFFICE || room.type === RoomType.MEDICAL
        || room.type === RoomType.COMMON;
    default:
      return false;
  }
}

function roomChance(floor: FloorLevel, room: Room): number {
  const area = room.w * room.h;
  const scale = area >= 100 ? 1.45 : area >= 45 ? 1 : 0.55;
  let base = 0;
  switch (floor) {
    case FloorLevel.MINISTRY:
      base = room.type === RoomType.COMMON ? 0.20 : room.type === RoomType.OFFICE ? 0.10 : 0.07;
      break;
    case FloorLevel.KVARTIRY:
      base = room.type === RoomType.LIVING ? 0.018 : room.type === RoomType.COMMON ? 0.032 : 0.014;
      break;
    case FloorLevel.LIVING:
      base = room.type === RoomType.PRODUCTION || room.type === RoomType.MEDICAL ? 0.10 : 0.045;
      break;
    case FloorLevel.MAINTENANCE:
      base = room.type === RoomType.PRODUCTION || room.type === RoomType.OFFICE ? 0.16 : 0.08;
      break;
  }
  return Math.min(0.35, base * scale);
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

function collectRoomWallCells(world: World, room: Room): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const ci = world.idx(x, y);
      if (seen.has(ci)) continue;
      seen.add(ci);
      if (world.cells[ci] !== Cell.WALL) continue;
      if (world.features[ci] !== Feature.NONE) continue;
      if (!isPlainWallTexture(world.wallTex[ci])) continue;
      let facesRoom = false;
      for (const [ox, oy] of DIRS) {
        const ni = world.idx(x + ox, y + oy);
        if (world.cells[ni] === Cell.FLOOR && world.roomMap[ni] === room.id) facesRoom = true;
      }
      if (facesRoom && !isDoorNear(world, x, y)) out.push(ci);
    }
  }
  return out;
}

function shuffleNumbers(a: number[]): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
}

function placeScreenAt(world: World, ci: number, variant: number, owned: Set<number>): void {
  const x = ci % W;
  const y = (ci / W) | 0;
  const frame = Math.floor(hash01(x, y, 700) * SCREEN_FRAMES);
  world.wallTex[ci] = proceduralScreenTex(variant, frame);
  world.features[ci] = Feature.SCREEN;
  if (!world.screenCells.includes(ci)) world.screenCells.push(ci);
  owned.add(ci);
}

function isNearLift(world: World, x: number, y: number): boolean {
  for (let dy = -8; dy <= 8; dy++) {
    for (let dx = -8; dx <= 8; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.cells[ci] === Cell.LIFT || world.features[ci] === Feature.LIFT_BUTTON) return true;
    }
  }
  return false;
}

function hasTeleportNear(world: World, x: number, y: number): boolean {
  if (world.anomalyTeleports.size === 0) return false;
  const r2 = SCREEN_CONTEXT_RADIUS * SCREEN_CONTEXT_RADIUS;
  for (const [ci] of world.anomalyTeleports) {
    const ax = ci % W;
    const ay = (ci / W) | 0;
    if (world.dist2(x + 0.5, y + 0.5, ax + 0.5, ay + 0.5) <= r2) return true;
  }
  return false;
}

function hasRailNear(world: World, x: number, y: number): boolean {
  if (world.railTracks.length === 0 && world.railTrainCells.size === 0) return false;
  const r2 = SCREEN_CONTEXT_RADIUS * SCREEN_CONTEXT_RADIUS;
  for (const track of world.railTracks) {
    const cells = track.platformCells.length > 0 ? track.platformCells : track.cells;
    for (const ci of cells) {
      const rx = ci % W;
      const ry = (ci / W) | 0;
      if (world.dist2(x + 0.5, y + 0.5, rx + 0.5, ry + 0.5) <= r2) return true;
    }
  }
  for (const [ci] of world.railTrainCells) {
    const rx = ci % W;
    const ry = (ci / W) | 0;
    if (world.dist2(x + 0.5, y + 0.5, rx + 0.5, ry + 0.5) <= r2) return true;
  }
  return false;
}

function hasSmogNear(world: World, x: number, y: number): boolean {
  if (world.anomalySmogSource >= 0) {
    const sx = world.anomalySmogSource % W;
    const sy = (world.anomalySmogSource / W) | 0;
    if (world.dist2(x + 0.5, y + 0.5, sx + 0.5, sy + 0.5) <= SCREEN_CONTEXT_RADIUS * SCREEN_CONTEXT_RADIUS) return true;
  }
  if (world.anomalySmogCells.length === 0) return world.fog[world.idx(x, y)] > 0;
  const r2 = SCREEN_CONTEXT_RADIUS * SCREEN_CONTEXT_RADIUS;
  for (const ci of world.anomalySmogCells) {
    const sx = ci % W;
    const sy = (ci / W) | 0;
    if (world.dist2(x + 0.5, y + 0.5, sx + 0.5, sy + 0.5) <= r2) return true;
  }
  return world.fog[world.idx(x, y)] > 0;
}

function buildSignalContext(world: World, room: Room | undefined, ci: number): ScreenSignalContext {
  const x = ci % W;
  const y = (ci / W) | 0;
  const zone = world.zones[world.zoneMap[ci]];
  const nearSmog = hasSmogNear(world, x, y);
  return {
    zoneFaction: zone?.faction,
    zoneLevel: zone?.level ?? 0,
    zoneHasLift: zone?.hasLift ?? false,
    nearLift: isNearLift(world, x, y),
    nearTeleport: hasTeleportNear(world, x, y),
    nearRail: hasRailNear(world, x, y),
    nearSmog,
    samosborZone: zone?.faction === ZoneFaction.SAMOSBOR || zone?.fogged === true || nearSmog,
    falseSafeRoom: room?.name.includes('Тихий блок') === true,
  };
}

function signalWeight(
  def: ScreenSignalDef,
  floor: FloorLevel,
  room: Room | undefined,
  ctx: ScreenSignalContext,
): number {
  if (!screenSignalEligible(def, floor, room?.type, ctx.zoneFaction)) return 0;
  let w = def.weight;
  switch (def.id) {
    case 'samosbor_warning':
      w *= ctx.samosborZone ? 6 : floor === FloorLevel.HELL ? 1.6 : room?.type === RoomType.CORRIDOR ? 1.1 : 0.75;
      break;
    case 'economy_shortage':
      if (room?.type === RoomType.KITCHEN || room?.type === RoomType.STORAGE) w *= 4;
      else if (room?.type === RoomType.COMMON || room?.type === RoomType.LIVING) w *= 2.1;
      else w *= 1.15;
      if (ctx.zoneFaction === ZoneFaction.WILD) w *= 2.2;
      else if (ctx.zoneFaction === ZoneFaction.CITIZEN) w *= 1.35;
      else if (ctx.zoneFaction === ZoneFaction.SAMOSBOR) w *= 1.8;
      if (ctx.zoneLevel >= 5) w *= 1.3;
      break;
    case 'faction_control':
      if (room?.type === RoomType.HQ) w *= 5;
      else if (room?.type === RoomType.STORAGE || room?.type === RoomType.OFFICE) w *= 1.8;
      else if (room?.type === RoomType.CORRIDOR || room?.type === RoomType.COMMON) w *= 1.35;
      if (ctx.zoneFaction === ZoneFaction.LIQUIDATOR || ctx.zoneFaction === ZoneFaction.CULTIST || ctx.zoneFaction === ZoneFaction.WILD) w *= 2.2;
      else if (ctx.zoneFaction === ZoneFaction.SAMOSBOR) w *= 1.8;
      if (ctx.falseSafeRoom) w *= 4;
      break;
    case 'elevator_anomaly':
      if (!ctx.nearLift && !ctx.zoneHasLift && !ctx.nearTeleport && !ctx.nearRail) return 0;
      if (ctx.nearLift) w *= 10;
      else if (ctx.zoneHasLift) w *= 3;
      if (ctx.nearTeleport || ctx.nearRail) w *= 8;
      if (room?.type === RoomType.CORRIDOR) w *= 1.7;
      break;
    case 'ministry_queue':
      w *= room?.type === RoomType.COMMON ? 3 : room?.type === RoomType.OFFICE ? 2.4 : 1.6;
      if (ctx.zoneFaction === ZoneFaction.LIQUIDATOR) w *= 1.25;
      break;
    case 'maintenance_pressure':
      w *= room?.type === RoomType.PRODUCTION ? 4 : room?.type === RoomType.OFFICE || room?.type === RoomType.MEDICAL ? 1.8 : 1.35;
      if (ctx.nearSmog) w *= 2.6;
      if (ctx.zoneLevel >= 5) w *= 1.35;
      break;
    case 'void_protocol':
      w *= floor === FloorLevel.VOID ? 5 : floor === FloorLevel.HELL ? 4 : 1;
      if (ctx.nearTeleport) w *= 2.4;
      break;
  }
  return w;
}

function pickSignal(world: World, floor: FloorLevel, room: Room | undefined, ci: number): ScreenSignalDef {
  const x = ci % W;
  const y = (ci / W) | 0;
  const ctx = buildSignalContext(world, room, ci);
  let total = 0;
  for (const def of SCREEN_SIGNAL_DEFS) total += signalWeight(def, floor, room, ctx);
  if (total <= 0) return SCREEN_SIGNAL_DEFS[0];
  let roll = hash01(x, y, 701) * total;
  for (const def of SCREEN_SIGNAL_DEFS) {
    roll -= signalWeight(def, floor, room, ctx);
    if (roll <= 0) return def;
  }
  return SCREEN_SIGNAL_DEFS[0];
}

function pickVariant(def: ScreenSignalDef, x: number, y: number): number {
  const variants = def.textureVariants;
  return variants[Math.floor(hash01(x, y, 703) * variants.length)] ?? variants[0] ?? 0;
}

function placeRoomScreens(world: World, floor: FloorLevel, cap: number, owned: Set<number>): void {
  for (const room of world.rooms) {
    if (world.screenCells.length >= cap) break;
    if (!room || !isRoomEligible(floor, room)) continue;
    if (Math.random() > roomChance(floor, room)) continue;
    const cells = collectRoomWallCells(world, room);
    if (cells.length === 0) continue;
    shuffleNumbers(cells);
    const count = room.w * room.h > 140 && Math.random() < 0.35 ? 2 : 1;
    for (let i = 0; i < count && i < cells.length && world.screenCells.length < cap; i++) {
      const ci = cells[i];
      const signal = pickSignal(world, floor, room, ci);
      placeScreenAt(world, ci, pickVariant(signal, ci % W, (ci / W) | 0), owned);
    }
  }
}

function placeHellScreens(world: World, cap: number, owned: Set<number>): void {
  for (let attempt = 0; attempt < 7000 && world.screenCells.length < cap; attempt++) {
    const ci = Math.floor(Math.random() * W * W);
    if (world.cells[ci] !== Cell.WALL || world.features[ci] !== Feature.NONE) continue;
    if (world.wallTex[ci] !== Tex.MEAT && world.wallTex[ci] !== Tex.GUT) continue;
    const x = ci % W;
    const y = (ci / W) | 0;
    let facesFloor = false;
    for (const [dx, dy] of DIRS) {
      const ni = world.idx(x + dx, y + dy);
      if (world.cells[ni] === Cell.FLOOR) { facesFloor = true; break; }
    }
    if (!facesFloor) continue;
    if (Math.random() < 0.10) {
      const signal = pickSignal(world, FloorLevel.HELL, undefined, ci);
      placeScreenAt(world, ci, pickVariant(signal, x, y), owned);
    }
  }
}

export function placeProceduralScreens(world: World, floor: FloorLevel): void {
  restoreExistingScreens(world, floor);
  const cap = floorScreenCap(floor);
  if (cap <= 0) return;
  const owned = new Set<number>();
  proceduralScreenCells.set(world, owned);
  if (floor === FloorLevel.HELL) placeHellScreens(world, cap, owned);
  else placeRoomScreens(world, floor, cap, owned);
}

export function flashSamosborWarningScreens(world: World, cx: number, cy: number, radius: number, maxScreens: number): number {
  if (world.screenCells.length === 0 || radius <= 0 || maxScreens <= 0) return 0;
  const r2 = radius * radius;
  let changed = 0;
  for (const ci of world.screenCells) {
    if (changed >= maxScreens) break;
    const tex = world.wallTex[ci];
    if (!isProceduralScreenTex(tex)) continue;
    const x = ci % W;
    const y = (ci / W) | 0;
    if (world.dist2(cx + 0.5, cy + 0.5, x + 0.5, y + 0.5) > r2) continue;
    const frame = Math.floor(hash01(x, y, 704) * SCREEN_FRAMES);
    const desired = proceduralScreenTex(0, frame);
    if (tex === desired) continue;
    world.wallTex[ci] = desired;
    changed++;
  }
  if (changed > 0) world.markWallTexDirty();
  return changed;
}

export function updateProceduralScreens(world: World, time: number): boolean {
  if (world.screenCells.length === 0) return false;
  const step = Math.floor(time / 1.2);
  let dirty = false;
  for (const ci of world.screenCells) {
    const tex = world.wallTex[ci];
    if (!isProceduralScreenTex(tex)) continue;
    const variant = Math.floor((tex - Tex.SCREEN_BASE) / SCREEN_FRAMES);
    const phase = Math.floor(hash01(ci % W, (ci / W) | 0, 702) * SCREEN_FRAMES);
    const desired = proceduralScreenTex(variant, (step + phase) % SCREEN_FRAMES);
    if (tex !== desired) {
      world.wallTex[ci] = desired;
      dirty = true;
    }
  }
  return dirty;
}

export interface ProceduralScreenSummary {
  total: number;
  unknown: number;
  bySignal: Partial<Record<ScreenSignalId, number>>;
  lines: string[];
}

export function summarizeProceduralScreens(world: World): ProceduralScreenSummary {
  const bySignal: Partial<Record<ScreenSignalId, number>> = {};
  let unknown = 0;
  for (const ci of world.screenCells) {
    const tex = world.wallTex[ci];
    if (!isProceduralScreenTex(tex)) { unknown++; continue; }
    const variant = Math.floor((tex - Tex.SCREEN_BASE) / SCREEN_FRAMES);
    const signal = screenSignalForVariant(variant);
    if (signal) bySignal[signal.id] = (bySignal[signal.id] ?? 0) + 1;
    else unknown++;
  }
  const lines = [`screens=${world.screenCells.length}`];
  for (const def of SCREEN_SIGNAL_DEFS) {
    const count = bySignal[def.id] ?? 0;
    if (count > 0) lines.push(`${def.id}=${count}`);
  }
  if (unknown > 0) lines.push(`unknown=${unknown}`);
  return { total: world.screenCells.length, unknown, bySignal, lines };
}
