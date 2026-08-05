/* Disabled engine experiment. Main builds import bad_apple_world.ts, which is a lightweight stub without frame/audio packs. */
import {
  W,
  Cell,
  Feature,
  RoomType,
  Tex,
  msg,
  type Entity,
  type GameState,
  type Room,
  type WorldEventSeverity,
} from '../../core/types';
import { World } from '../../core/world';
import {
  BAD_APPLE_FRAME_COUNT,
  BAD_APPLE_HEIGHT,
  BAD_APPLE_SOURCE_FRAME_STEP,
  BAD_APPLE_WIDTH,
  drawBadAppleFrame,
} from '../../data/bad_apple_frames';
import { RUNTIME_TOPOLOGY_LIMITS } from '../../data/runtime_topology';
import { rebuildPathBlockersFromWorldObjects } from '../../gen/path_blockers';
import { primeBadAppleProjectorAudio, updateBadAppleProjectorLoop } from '../audio';
import { publishEvent } from '../events';

const BAD_APPLE_ROOM_PREFIX = 'Bad Apple!';
const BAD_APPLE_TAG_RE = /\[bad_apple:(-?\d+),(-?\d+),(\d+),(\d+),(\d+),(0|1),(-?\d+)\]/;
const BAD_APPLE_PIXELS = BAD_APPLE_WIDTH * BAD_APPLE_HEIGHT;
const BAD_APPLE_FRAME_SECONDS = BAD_APPLE_SOURCE_FRAME_STEP / 30;
const BAD_APPLE_PLAYER_WARN_SECONDS = 2.2;
const BAD_APPLE_LIGHT = 0.52;
const BAD_APPLE_PROJECTOR_SOUND_MARGIN = 32;
export const BAD_APPLE_PROJECTOR_SOUND_RADIUS = Math.ceil(Math.hypot(BAD_APPLE_WIDTH, BAD_APPLE_HEIGHT) * 0.5 + BAD_APPLE_PROJECTOR_SOUND_MARGIN);

interface BadAppleScreenRuntime {
  roomId: number;
  x: number;
  y: number;
  w: number;
  h: number;
  projectorIdx: number;
  frame: number;
  active: boolean;
  accum: number;
  current: Uint8Array;
  target: Uint8Array;
  nextMsgAt: number;
}

interface BadAppleRuntime {
  screens: BadAppleScreenRuntime[];
}

export interface BadApplePlacement {
  roomId: number;
  x: number;
  y: number;
  projectorX: number;
  projectorY: number;
}

interface BadAppleSiteRisk {
  hard: number;
  apt: number;
  protectedInside: number;
  score: number;
}

const runtimeByWorld = new WeakMap<World, BadAppleRuntime | null>();

function normFrame(frame: number): number {
  return ((Math.floor(frame) % BAD_APPLE_FRAME_COUNT) + BAD_APPLE_FRAME_COUNT) % BAD_APPLE_FRAME_COUNT;
}

function localX(pixel: number): number {
  return pixel % BAD_APPLE_WIDTH;
}

function localY(pixel: number): number {
  return (pixel / BAD_APPLE_WIDTH) | 0;
}

function isHardProtected(world: World, ci: number): boolean {
  return world.cells[ci] === Cell.LIFT ||
    world.features[ci] === Feature.LIFT_BUTTON ||
    world.hermoWall[ci] !== 0;
}

function inRect(world: World, x: number, y: number, rx: number, ry: number, rw: number, rh: number): boolean {
  const dx = world.delta(rx, x);
  const dy = world.delta(ry, y);
  return dx >= 0 && dx < rw && dy >= 0 && dy < rh;
}

function setBadApplePixel(world: World, ci: number, black: boolean, roomId: number): void {
  if (isHardProtected(world, ci)) return;
  world.cells[ci] = black ? Cell.WALL : Cell.FLOOR;
  world.roomMap[ci] = roomId;
  world.setFeatureAt(ci, Feature.NONE);
  world.aptMask[ci] = 0;
  world.hermoWall[ci] = 0;
  world.fog[ci] = black ? 4 : 0;
  if (black) {
    world.wallTex[ci] = Tex.DARK;
  } else {
    world.floorTex[ci] = Tex.F_MARBLE_TILE;
  }
  world.light[ci] = Math.max(world.light[ci], BAD_APPLE_LIGHT);
}

function clearContainersOnTouchedCells(world: World, touched: Set<number>): void {
  if (touched.size === 0 || world.containers.length === 0) return;
  const before = world.containers.length;
  world.containers = world.containers.filter(container => !touched.has(world.idx(container.x, container.y)));
  if (world.containers.length !== before) world.rebuildContainerMap();
}

function carveDebugFloor(world: World, x: number, y: number, roomId = -1): void {
  const ci = world.idx(x, y);
  if (isHardProtected(world, ci)) return;
  world.cells[ci] = Cell.FLOOR;
  world.roomMap[ci] = roomId;
  world.setFeatureAt(ci, Feature.NONE);
  world.floorTex[ci] = Tex.F_CONCRETE;
  world.aptMask[ci] = 0;
  world.hermoWall[ci] = 0;
  world.removeDoorAt(ci);
  world.light[ci] = Math.max(world.light[ci], 0.35);
}

function carveLine(world: World, ax: number, ay: number, bx: number, by: number): void {
  let x = world.wrap(ax);
  let y = world.wrap(ay);
  const ddx = world.delta(x, bx);
  const ddy = world.delta(y, by);
  const sx = ddx >= 0 ? 1 : -1;
  const sy = ddy >= 0 ? 1 : -1;
  for (let i = 0; i <= Math.abs(ddx); i++) {
    for (let oy = -1; oy <= 1; oy++) carveDebugFloor(world, x, y + oy);
    if (i < Math.abs(ddx)) x = world.wrap(x + sx);
  }
  for (let i = 0; i <= Math.abs(ddy); i++) {
    for (let ox = -1; ox <= 1; ox++) carveDebugFloor(world, x + ox, y);
    if (i < Math.abs(ddy)) y = world.wrap(y + sy);
  }
}

function visitLineCells(world: World, ax: number, ay: number, bx: number, by: number, visit: (ci: number) => void): void {
  let x = world.wrap(ax);
  let y = world.wrap(ay);
  const ddx = world.delta(x, bx);
  const ddy = world.delta(y, by);
  const sx = ddx >= 0 ? 1 : -1;
  const sy = ddy >= 0 ? 1 : -1;
  for (let i = 0; i <= Math.abs(ddx); i++) {
    for (let oy = -1; oy <= 1; oy++) visit(world.idx(x, y + oy));
    if (i < Math.abs(ddx)) x = world.wrap(x + sx);
  }
  for (let i = 0; i <= Math.abs(ddy); i++) {
    for (let ox = -1; ox <= 1; ox++) visit(world.idx(x + ox, y));
    if (i < Math.abs(ddy)) y = world.wrap(y + sy);
  }
}

function visitProjectorAccessCells(
  world: World,
  x: number,
  y: number,
  protectedX: number,
  protectedY: number,
  visit: (ci: number) => void,
): void {
  const px = world.wrap(x - 4);
  const py = world.wrap(y + Math.floor(BAD_APPLE_HEIGHT / 2));
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) visit(world.idx(px + dx, py + dy));
  }
  visitLineCells(world, px + 2, py, x - 1, py, visit);
  visitLineCells(world, Math.floor(protectedX), Math.floor(protectedY), px, py, visit);
}

function buildProjector(world: World, x: number, y: number, roomId: number): number {
  const px = world.wrap(x - 4);
  const py = world.wrap(y + Math.floor(BAD_APPLE_HEIGHT / 2));
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) carveDebugFloor(world, px + dx, py + dy);
  }
  carveLine(world, px + 2, py, x - 1, py);
  let pi = world.idx(px, py);
  if (isHardProtected(world, pi)) {
    pi = -1;
    for (let dy = -2; dy <= 2 && pi < 0; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const candidate = world.idx(px + dx, py + dy);
        if (!isHardProtected(world, candidate) && world.cells[candidate] === Cell.FLOOR) {
          pi = candidate;
          break;
        }
      }
    }
  }
  if (pi < 0) return -1;
  world.setFeatureAt(pi, Feature.APPARATUS);
  world.floorTex[pi] = Tex.F_VOID;
  world.roomMap[pi] = roomId;
  world.light[pi] = 0.95;
  return pi;
}

function writeBadAppleRoomTag(x: number, y: number, roomId: number, projectorIdx: number, frame: number, active: boolean): string {
  return `${BAD_APPLE_ROOM_PREFIX}: зал ${roomId} [bad_apple:${x},${y},${BAD_APPLE_WIDTH},${BAD_APPLE_HEIGHT},${normFrame(frame)},${active ? 1 : 0},${projectorIdx}]`;
}

export function badAppleSiteScore(
  world: World,
  x: number,
  y: number,
  protectedX: number,
  protectedY: number,
): number {
  return badAppleSiteRisk(world, x, y, protectedX, protectedY).score;
}

function badAppleSiteRisk(
  world: World,
  x: number,
  y: number,
  protectedX: number,
  protectedY: number,
): BadAppleSiteRisk {
  let hard = 0;
  let apt = 0;
  const protectedInside = inRect(world, protectedX, protectedY, x, y, BAD_APPLE_WIDTH, BAD_APPLE_HEIGHT) ? 1 : 0;
  const seen = new Set<number>();
  const visit = (ci: number): void => {
    if (seen.has(ci)) return;
    seen.add(ci);
    if (isHardProtected(world, ci)) hard++;
    else if (world.aptMask[ci] !== 0) apt++;
  };
  for (let dy = 0; dy < BAD_APPLE_HEIGHT; dy++) {
    for (let dx = 0; dx < BAD_APPLE_WIDTH; dx++) {
      visit(world.idx(x + dx, y + dy));
    }
  }
  visitProjectorAccessCells(world, x, y, protectedX, protectedY, visit);
  return {
    hard,
    apt,
    protectedInside,
    score: hard * 100000 + protectedInside * 10000 + apt,
  };
}

export function findBadAppleSiteNear(world: World, centerX: number, centerY: number): { x: number; y: number } {
  const cx = Math.floor(centerX);
  const cy = Math.floor(centerY);
  const candidates: { x: number; y: number; risk: BadAppleSiteRisk }[] = [];
  const seen = new Set<string>();
  const addCandidate = (x: number, y: number): void => {
    const wx = world.wrap(x);
    const wy = world.wrap(y);
    const key = `${wx},${wy}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ x: wx, y: wy, risk: badAppleSiteRisk(world, wx, wy, cx, cy) });
  };
  const offsets = [
    { x: 10, y: -Math.floor(BAD_APPLE_HEIGHT / 2) },
    { x: -BAD_APPLE_WIDTH - 10, y: -Math.floor(BAD_APPLE_HEIGHT / 2) },
    { x: -Math.floor(BAD_APPLE_WIDTH / 2), y: 10 },
    { x: -Math.floor(BAD_APPLE_WIDTH / 2), y: -BAD_APPLE_HEIGHT - 10 },
    { x: 36, y: -Math.floor(BAD_APPLE_HEIGHT / 2) },
    { x: -BAD_APPLE_WIDTH - 36, y: -Math.floor(BAD_APPLE_HEIGHT / 2) },
  ];
  for (const offset of offsets) {
    addCandidate(cx + offset.x, cy + offset.y);
  }
  const stepX = Math.max(24, Math.floor(BAD_APPLE_WIDTH / 3));
  const stepY = Math.max(24, Math.floor(BAD_APPLE_HEIGHT / 3));
  for (let ring = 1; ring <= 8; ring++) {
    for (let gy = -ring; gy <= ring; gy++) {
      for (let gx = -ring; gx <= ring; gx++) {
        if (Math.max(Math.abs(gx), Math.abs(gy)) !== ring) continue;
        addCandidate(cx - Math.floor(BAD_APPLE_WIDTH / 2) + gx * stepX, cy - Math.floor(BAD_APPLE_HEIGHT / 2) + gy * stepY);
      }
    }
    if (candidates.some(candidate => candidate.risk.hard === 0 && candidate.risk.protectedInside === 0)) break;
  }
  candidates.sort((a, b) => a.risk.score - b.risk.score);
  return candidates[0] ?? { x: world.wrap(cx + 10), y: world.wrap(cy - Math.floor(BAD_APPLE_HEIGHT / 2)) };
}

export function stampBadAppleWorld(
  world: World,
  x: number,
  y: number,
  connectFrom?: { x: number; y: number },
): BadApplePlacement {
  const rx = world.wrap(x);
  const ry = world.wrap(y);
  const roomId = world.rooms.length;
  const frame = new Uint8Array(BAD_APPLE_PIXELS);
  const touched = new Set<number>();
  drawBadAppleFrame(frame, 0);

  const projectorIdx = buildProjector(world, rx, ry, roomId);
  const projectorX = projectorIdx >= 0 ? projectorIdx % W : -1;
  const projectorY = projectorIdx >= 0 ? (projectorIdx / W) | 0 : -1;
  if (connectFrom && projectorIdx >= 0) carveLine(world, Math.floor(connectFrom.x), Math.floor(connectFrom.y), projectorX, projectorY);

  for (let i = 0; i < BAD_APPLE_PIXELS; i++) {
    const ci = world.idx(rx + localX(i), ry + localY(i));
    if (isHardProtected(world, ci)) continue;
    touched.add(ci);
    world.removeDoorAt(ci);
    setBadApplePixel(world, ci, frame[i] !== 0, roomId);
  }
  clearContainersOnTouchedCells(world, touched);
  rebuildPathBlockersFromWorldObjects(world, 0, Array.from(touched));

  const room: Room = {
    id: roomId,
    type: RoomType.COMMON,
    x: rx,
    y: ry,
    w: BAD_APPLE_WIDTH,
    h: BAD_APPLE_HEIGHT,
    doors: [],
    sealed: false,
    name: writeBadAppleRoomTag(rx, ry, roomId, projectorIdx, 0, true),
    apartmentId: -1,
    wallTex: Tex.DARK,
    floorTex: Tex.F_MARBLE_TILE,
  };
  world.rooms.push(room);

  world.markCellsDirty();
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFogDirty();
  runtimeByWorld.delete(world);
  return { roomId, x: rx, y: ry, projectorX, projectorY };
}

function screenFromRoom(world: World, room: Room): BadAppleScreenRuntime | null {
  const match = BAD_APPLE_TAG_RE.exec(room.name);
  if (!match) return null;
  const x = world.wrap(Number(match[1]));
  const y = world.wrap(Number(match[2]));
  const w = Number(match[3]);
  const h = Number(match[4]);
  if (w !== BAD_APPLE_WIDTH || h !== BAD_APPLE_HEIGHT) return null;
  const frame = normFrame(Number(match[5]));
  const active = match[6] === '1';
  const projectorIdx = Number(match[7]);
  const current = new Uint8Array(BAD_APPLE_PIXELS);
  drawBadAppleFrame(current, frame);
  return {
    roomId: room.id,
    x,
    y,
    w,
    h,
    projectorIdx: projectorIdx >= 0 ? projectorIdx : -1,
    frame,
    active,
    accum: 0,
    current,
    target: new Uint8Array(BAD_APPLE_PIXELS),
    nextMsgAt: 0,
  };
}

function runtimeFor(world: World): BadAppleRuntime {
  const cached = runtimeByWorld.get(world);
  if (cached) return cached;
  if (cached === null) return { screens: [] };

  const screens: BadAppleScreenRuntime[] = [];
  for (const room of world.rooms) {
    if (screens.length >= RUNTIME_TOPOLOGY_LIMITS.badAppleMaxScreens) break;
    if (!room.name.startsWith(BAD_APPLE_ROOM_PREFIX)) continue;
    const screen = screenFromRoom(world, room);
    if (screen) screens.push(screen);
  }
  const runtime = { screens };
  runtimeByWorld.set(world, screens.length > 0 ? runtime : null);
  return runtime;
}

function applyBadAppleFrame(
  world: World,
  screen: BadAppleScreenRuntime,
  player: Entity,
  state: GameState,
  frame: number,
  blockerCells: number[],
): number {
  drawBadAppleFrame(screen.target, frame);
  const playerIdx = world.idx(Math.floor(player.x), Math.floor(player.y));
  let changed = 0;
  let warned = false;
  for (let i = 0; i < BAD_APPLE_PIXELS; i++) {
    let black = screen.target[i] !== 0;
    const ci = world.idx(screen.x + localX(i), screen.y + localY(i));
    if (black && ci === playerIdx) {
      black = false;
      screen.target[i] = 0;
      if (state.time >= screen.nextMsgAt) {
        player.hp = Math.max(1, (player.hp ?? 100) - 4);
        screen.nextMsgAt = state.time + BAD_APPLE_PLAYER_WARN_SECONDS;
        warned = true;
      }
    }
    const next = black ? 1 : 0;
    if (screen.current[i] === next) continue;
    screen.current[i] = next;
    setBadApplePixel(world, ci, black, screen.roomId);
    blockerCells.push(ci);
    changed++;
  }
  if (warned) state.msgs.push(msg('Кадр сжал клетку под ногами: белое место удержано ценой боли.', state.time, '#fa4'));
  return changed;
}

export function badAppleScreenSoundPosition(screen: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  return {
    x: screen.x + screen.w * 0.5,
    y: screen.y + screen.h * 0.5,
  };
}

function publishBadAppleEvent(
  world: World,
  player: Entity,
  state: GameState,
  type: 'bad_apple_spawned' | 'bad_apple_toggled',
  severity: WorldEventSeverity,
  data: Record<string, unknown>,
): void {
  const ci = world.idx(Math.floor(player.x), Math.floor(player.y));
  publishEvent(state, {
    type,
    zoneId: world.zoneMap[ci],
    roomId: world.roomMap[ci],
    x: player.x,
    y: player.y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    severity,
    privacy: 'local',
    tags: ['procedural', 'anomaly', 'bad_apple_world', 'video', 'screen', 'topology'],
    data,
  });
}

export function updateBadAppleWorldAnomaly(world: World, player: Entity, state: GameState, dt: number): void {
  const runtime = runtimeFor(world);
  if (runtime.screens.length === 0) {
    updateBadAppleProjectorLoop(false, player.x, player.y, 0);
    return;
  }
  let changed = 0;
  const blockerCells: number[] = [];
  let audioScreen: BadAppleScreenRuntime | null = null;
  let audioDist2 = Infinity;
  for (const screen of runtime.screens) {
    if (!screen.active) continue;
    const sound = badAppleScreenSoundPosition(screen);
    const soundX = sound.x;
    const soundY = sound.y;
    const dist2 = world.dist2(player.x, player.y, soundX, soundY);
    if (dist2 < audioDist2) {
      audioDist2 = dist2;
      audioScreen = screen;
    }
    screen.accum += dt;
    while (screen.accum >= BAD_APPLE_FRAME_SECONDS) {
      screen.accum -= BAD_APPLE_FRAME_SECONDS;
      screen.frame = normFrame(screen.frame + 1);
      changed += applyBadAppleFrame(world, screen, player, state, screen.frame, blockerCells);
    }
  }
  if (changed > 0) {
    rebuildPathBlockersFromWorldObjects(world, state.tick, blockerCells);
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFogDirty();
  }
  if (audioScreen) {
    const sound = badAppleScreenSoundPosition(audioScreen);
    updateBadAppleProjectorLoop(true, sound.x, sound.y, audioScreen.frame, BAD_APPLE_PROJECTOR_SOUND_RADIUS);
  } else {
    updateBadAppleProjectorLoop(false, player.x, player.y, 0);
  }
}

export function badAppleWorldInteractionTargetId(world: World, lookX: number, lookY: number): number | null {
  const runtime = runtimeFor(world);
  for (const screen of runtime.screens) {
    if (screen.projectorIdx < 0) continue;
    const px = screen.projectorIdx % W;
    const py = (screen.projectorIdx / W) | 0;
    if (world.dist2(lookX, lookY, px + 0.5, py + 0.5) <= 4) return screen.projectorIdx + 540000;
  }
  return null;
}

export function tryUseBadAppleWorldAnomaly(world: World, player: Entity, state: GameState, lookX: number, lookY: number): boolean {
  const runtime = runtimeFor(world);
  for (const screen of runtime.screens) {
    if (screen.projectorIdx < 0) continue;
    const px = screen.projectorIdx % W;
    const py = (screen.projectorIdx / W) | 0;
    if (world.dist2(player.x, player.y, px + 0.5, py + 0.5) > 8) continue;
    if (world.dist2(lookX, lookY, px + 0.5, py + 0.5) > 4) continue;
    screen.active = !screen.active;
    if (screen.active) primeBadAppleProjectorAudio();
    const room = world.rooms[screen.roomId];
    if (room) room.name = writeBadAppleRoomTag(screen.x, screen.y, screen.roomId, screen.projectorIdx, screen.frame, screen.active);
    state.msgs.push(msg(screen.active ? 'Проектор снова печатает Bad Apple! на бетон.' : 'Проектор остановлен. Кадр застыл в стенах.', state.time, screen.active ? '#8cf' : '#fa4'));
    publishBadAppleEvent(world, player, state, 'bad_apple_toggled', 3, {
      active: screen.active,
      frame: screen.frame,
      roomId: screen.roomId,
    });
    return true;
  }
  return false;
}

export function debugSpawnBadAppleWorld(world: World, player: Entity, state: GameState): string[] {
  primeBadAppleProjectorAudio();
  const site = findBadAppleSiteNear(world, player.x, player.y);
  const placement = stampBadAppleWorld(world, site.x, site.y, { x: player.x, y: player.y });
  publishBadAppleEvent(world, player, state, 'bad_apple_spawned', 4, {
    roomId: placement.roomId,
    x: placement.x,
    y: placement.y,
    projectorX: placement.projectorX,
    projectorY: placement.projectorY,
    width: BAD_APPLE_WIDTH,
    height: BAD_APPLE_HEIGHT,
    frames: BAD_APPLE_FRAME_COUNT,
  });
  return [
    `spawned ${BAD_APPLE_WIDTH}x${BAD_APPLE_HEIGHT} room=${placement.roomId} at ${placement.x},${placement.y}`,
    `projector=${placement.projectorX},${placement.projectorY} frames=${BAD_APPLE_FRAME_COUNT} fps=${(1 / BAD_APPLE_FRAME_SECONDS).toFixed(1)}`,
  ];
}

export function relightBadAppleWorld(world: World): void {
  let touched = false;
  for (const room of world.rooms) {
    if (!room) continue;
    if (!BAD_APPLE_TAG_RE.test(room.name)) continue;
    for (let dy = 0; dy < BAD_APPLE_HEIGHT; dy++) {
      for (let dx = 0; dx < BAD_APPLE_WIDTH; dx++) {
        const ci = world.idx(room.x + dx, room.y + dy);
        world.light[ci] = Math.max(world.light[ci], BAD_APPLE_LIGHT);
      }
    }
    touched = true;
  }
  if (touched) runtimeByWorld.delete(world);
}

export function summarizeBadAppleWorld(world: World): string[] {
  const runtime = runtimeFor(world);
  if (runtime.screens.length === 0) return [];
  const active = runtime.screens.filter(screen => screen.active).length;
  const first = runtime.screens[0];
  return [
    `bad apple: screens=${runtime.screens.length} active=${active} frame=${first.frame + 1}/${BAD_APPLE_FRAME_COUNT} rect=${BAD_APPLE_WIDTH}x${BAD_APPLE_HEIGHT}`,
    `bad apple projector=${first.projectorIdx >= 0 ? `${first.projectorIdx % W},${(first.projectorIdx / W) | 0}` : 'none'} fps=${(1 / BAD_APPLE_FRAME_SECONDS).toFixed(1)}`,
  ];
}
