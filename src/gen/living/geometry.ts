/* ── Living hub geometry — readable z=0 district routes ───────── */

import {
  W,
  Cell,
  DoorState,
  Tex,
  Feature,
  LiftDirection,
  type Room,
} from '../../core/types';
import { World } from '../../core/world';
import { ensureConnectivity, sanitizeDoors } from '../shared';

interface Point { x: number; y: number; }
interface Bounds { x: number; y: number; w: number; h: number; }
interface CorridorStyle { floor: Tex; wall: Tex; radius: number; }

export interface LivingHubGeometryStats {
  carvedCells: number;
  motifs: number;
  landmarkRoutes: number;
  liftRoutes: number;
  chokepoints: number;
  serviceRoutes: number;
  rewardDeadEnds: number;
  shelterShellRooms: number;
  shelterShellCells: number;
}

const PUBLIC: CorridorStyle = { floor: Tex.F_TILE, wall: Tex.PANEL, radius: 1 };
const HOME: CorridorStyle = { floor: Tex.F_LINO, wall: Tex.PANEL, radius: 1 };
const MARKET: CorridorStyle = { floor: Tex.F_CONCRETE, wall: Tex.METAL, radius: 1 };
const SHELTER: CorridorStyle = { floor: Tex.F_CONCRETE, wall: Tex.HERMO_WALL, radius: 1 };
const SERVICE: CorridorStyle = { floor: Tex.F_CONCRETE, wall: Tex.PIPE, radius: 1 };

export interface LivingShelterShellMetrics {
  roomCount: number;
  hermeticDoors: number;
  shellCells: number;
}

interface LandmarkTarget {
  needle: string;
  style: CorridorStyle;
  route: 'north' | 'east' | 'south' | 'west';
}

const LANDMARK_TARGETS: readonly LandmarkTarget[] = [
  { needle: 'Пункт сборов вылазки', style: MARKET, route: 'east' },
  { needle: 'Лаборатория', style: PUBLIC, route: 'north' },
  { needle: 'Комната Ваньки', style: HOME, route: 'west' },
  { needle: 'Комната живой карты', style: PUBLIC, route: 'north' },
  { needle: 'Патронный шкаф домкома', style: MARKET, route: 'east' },
  { needle: 'Толкучка', style: MARKET, route: 'east' },
  { needle: 'Счетная 88', style: MARKET, route: 'east' },
  { needle: 'Информаторий', style: PUBLIC, route: 'north' },
  { needle: 'Православный храм', style: PUBLIC, route: 'north' },
  { needle: 'Кабинет ОБЖ', style: SHELTER, route: 'south' },
  { needle: 'Спортзал-убежище ОБЖ', style: SHELTER, route: 'south' },
  { needle: 'Аварийный медпост', style: PUBLIC, route: 'north' },
  { needle: 'Больничный блок карантина', style: PUBLIC, route: 'north' },
  { needle: 'Комната герметичного шва', style: SHELTER, route: 'south' },
];

export function buildLivingHubGeometry(world: World): LivingHubGeometryStats {
  const ctx = livingHubContext(world);
  if (!ctx) return emptyStats();
  const stats = emptyStats();

  carveMacroRouteSkeleton(world, ctx.bounds, ctx.anchors, stats, true);
  stats.motifs += decorateHomeBlock(world, ctx.anchors.west, ctx.center);
  stats.motifs += decorateMarketStrip(world, ctx.anchors.east, ctx.center);
  stats.motifs += decoratePublicCorridor(world, ctx.anchors.north, ctx.center);
  stats.motifs += decorateShelterRoute(world, ctx.anchors.south, ctx.center);
  stats.motifs += decorateServiceBypass(world, ctx.anchors);
  stats.chokepoints += addChokepoints(world, ctx.anchors);
  stats.landmarkRoutes += connectLandmarks(world, ctx.anchors);
  stats.liftRoutes += connectNearestLifts(world, ctx.anchors);
  ensureConnectivity(world, ctx.spawn.x + 0.5, ctx.spawn.y + 0.5);
  sanitizeDoors(world);

  const shell = markLivingShelterShells(world);
  stats.shelterShellRooms = shell.roomCount;
  stats.shelterShellCells = shell.shellCells;

  world.bakeLights();
  return stats;
}

export function seedLivingMacroRouteIntent(world: World): LivingHubGeometryStats {
  const ctx = livingHubContext(world);
  if (!ctx) return emptyStats();
  const stats = emptyStats();
  carveMacroRouteSkeleton(world, ctx.bounds, ctx.anchors, stats, false);
  return stats;
}

export function measureLivingShelterShells(world: World): LivingShelterShellMetrics {
  return collectLivingShelterShells(world, false);
}

function emptyStats(): LivingHubGeometryStats {
  return {
    carvedCells: 0,
    motifs: 0,
    landmarkRoutes: 0,
    liftRoutes: 0,
    chokepoints: 0,
    serviceRoutes: 0,
    rewardDeadEnds: 0,
    shelterShellRooms: 0,
    shelterShellCells: 0,
  };
}

function livingHubContext(world: World): {
  bounds: Bounds;
  center: Point;
  spawn: Point;
  anchors: Record<'north' | 'east' | 'south' | 'west', Point>;
} | null {
  const hall = findRoom(world, 'Актовый зал');
  if (!hall) return null;

  const armory = findRoom(world, 'Оружейная');
  const bounds = roomBounds(hall, armory && roomDistance2(world, hall, armory) < 900 ? armory : null);
  const spawn = roomCenter(hall);
  const center = {
    x: world.wrap(bounds.x + Math.floor(bounds.w / 2)),
    y: world.wrap(bounds.y + Math.floor(bounds.h / 2)),
  };
  return { bounds, center, spawn, anchors: hubAnchors(bounds, center) };
}

function findRoom(world: World, needle: string): Room | null {
  for (const room of world.rooms) {
    if (room && room.name.includes(needle)) return room;
  }
  return null;
}

function roomCenter(room: Room): Point {
  return { x: room.x + Math.floor(room.w / 2), y: room.y + Math.floor(room.h / 2) };
}

function roomDistance2(world: World, a: Room, b: Room): number {
  const ac = roomCenter(a);
  const bc = roomCenter(b);
  return world.dist2(ac.x, ac.y, bc.x, bc.y);
}

function roomBounds(a: Room, b: Room | null): Bounds {
  if (!b) return { x: a.x, y: a.y, w: a.w, h: a.h };
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function hubAnchors(bounds: Bounds, center: Point): Record<'north' | 'east' | 'south' | 'west', Point> {
  return {
    north: { x: center.x, y: bounds.y - 14 },
    east: { x: bounds.x + bounds.w + 16, y: center.y },
    south: { x: center.x, y: bounds.y + bounds.h + 14 },
    west: { x: bounds.x - 16, y: center.y },
  };
}

function carveMacroRouteSkeleton(
  world: World,
  bounds: Bounds,
  anchors: Record<'north' | 'east' | 'south' | 'west', Point>,
  stats: LivingHubGeometryStats,
  finalPass: boolean,
): void {
  stats.carvedCells += carveHubRing(world, bounds);
  stats.carvedCells += carveDistrictSpokes(world, anchors);
  stats.serviceRoutes += carveServiceBypass(world, anchors);
  stats.rewardDeadEnds += carveRewardDeadEnds(world, anchors, finalPass);
}

function carveHubRing(world: World, bounds: Bounds): number {
  const left = bounds.x - 7;
  const right = bounds.x + bounds.w + 7;
  const top = bounds.y - 7;
  const bottom = bounds.y + bounds.h + 7;
  let carved = 0;
  carved += carveLine(world, { x: left, y: top }, { x: right, y: top }, PUBLIC);
  carved += carveLine(world, { x: right, y: top }, { x: right, y: bottom }, MARKET);
  carved += carveLine(world, { x: right, y: bottom }, { x: left, y: bottom }, SHELTER);
  carved += carveLine(world, { x: left, y: bottom }, { x: left, y: top }, HOME);
  carved += carveBlock(world, left + 5, bottom - 2, Math.max(8, bounds.w - 2), 5, SHELTER);
  return carved;
}

function carveDistrictSpokes(world: World, anchors: Record<'north' | 'east' | 'south' | 'west', Point>): number {
  let carved = 0;
  carved += carveLine(world, anchors.north, { x: anchors.north.x, y: anchors.north.y - 120 }, PUBLIC);
  carved += carveLine(world, anchors.east, { x: anchors.east.x + 136, y: anchors.east.y }, MARKET);
  carved += carveLine(world, anchors.south, { x: anchors.south.x, y: anchors.south.y + 128 }, SHELTER);
  carved += carveLine(world, anchors.west, { x: anchors.west.x - 120, y: anchors.west.y }, HOME);
  carved += carveDogleg(world, { x: anchors.west.x - 72, y: anchors.west.y }, { x: anchors.south.x, y: anchors.south.y + 72 }, HOME, 'vertical');
  carved += carveDogleg(world, { x: anchors.east.x + 84, y: anchors.east.y }, { x: anchors.north.x, y: anchors.north.y - 72 }, MARKET, 'vertical');
  return carved;
}

function carveServiceBypass(world: World, anchors: Record<'north' | 'east' | 'south' | 'west', Point>): number {
  let routes = 0;
  const spineX = anchors.west.x - 104;
  const top = { x: spineX, y: anchors.north.y - 96 };
  const mid = { x: spineX, y: anchors.west.y };
  const bottom = { x: spineX, y: anchors.south.y + 96 };
  if (carveLine(world, top, bottom, SERVICE) > 0) routes++;
  if (carveDogleg(world, anchors.north, top, SERVICE, 'horizontal') > 0) routes++;
  if (carveDogleg(world, anchors.south, bottom, SERVICE, 'horizontal') > 0) routes++;
  if (carveLine(world, anchors.west, mid, SERVICE) > 0) routes++;
  return routes;
}

function carveRewardDeadEnds(
  world: World,
  anchors: Record<'north' | 'east' | 'south' | 'west', Point>,
  placeRewards: boolean,
): number {
  const bays: Array<{ x: number; y: number; w: number; h: number; style: CorridorStyle; feature: Feature }> = [
    { x: anchors.east.x + 58, y: anchors.east.y - 14, w: 9, h: 5, style: MARKET, feature: Feature.SHELF },
    { x: anchors.east.x + 100, y: anchors.east.y + 10, w: 8, h: 5, style: MARKET, feature: Feature.DESK },
    { x: anchors.north.x - 18, y: anchors.north.y - 76, w: 7, h: 7, style: PUBLIC, feature: Feature.TABLE },
    { x: anchors.south.x + 14, y: anchors.south.y + 78, w: 8, h: 5, style: SHELTER, feature: Feature.BED },
    { x: anchors.west.x - 120, y: anchors.west.y - 36, w: 7, h: 5, style: SERVICE, feature: Feature.MACHINE },
  ];

  let made = 0;
  for (const bay of bays) {
    const carved = carveBlock(world, bay.x, bay.y, bay.w, bay.h, bay.style);
    if (carved <= 0 && !placeRewards) continue;
    if (placeRewards) {
      placeFeature(world, bay.x + Math.floor(bay.w / 2), bay.y + Math.floor(bay.h / 2), bay.feature);
      placeFeature(world, bay.x + 1, bay.y + 1, Feature.LAMP);
    }
    made++;
  }
  return made;
}

function decorateHomeBlock(world: World, west: Point, center: Point): number {
  let motifs = 0;
  for (let k = 0; k < 5; k++) {
    const x = center.x - 34 - k * 17;
    const y = west.y + (k % 2 === 0 ? -7 : 4);
    carveBlock(world, x, y, 7, 5, HOME);
    placeFeature(world, x + 2, y + 2, Feature.CHAIR);
    placeFeature(world, x + 4, y + 2, Feature.SHELF);
    placeFeature(world, x + 3, y + 1, Feature.LAMP);
    motifs++;
  }
  return motifs;
}

function decorateMarketStrip(world: World, east: Point, center: Point): number {
  let motifs = 0;
  for (let k = 0; k < 6; k++) {
    const x = center.x + 32 + k * 14;
    const y = east.y + (k % 2 === 0 ? -6 : 4);
    carveBlock(world, x, y, 8, 4, MARKET);
    placeFeature(world, x + 2, y + 1, Feature.DESK);
    placeFeature(world, x + 3, y + 1, Feature.DESK);
    placeFeature(world, x + 5, y + 2, k % 2 === 0 ? Feature.SHELF : Feature.MACHINE);
    placeFeature(world, x + 1, y + 2, Feature.LAMP);
    motifs++;
  }
  return motifs;
}

function decoratePublicCorridor(world: World, north: Point, center: Point): number {
  let motifs = 0;
  for (let k = 0; k < 5; k++) {
    const x = north.x + (k % 2 === 0 ? -9 : 5);
    const y = center.y - 36 - k * 18;
    carveBlock(world, x, y, 6, 6, PUBLIC);
    placeFeature(world, x + 2, y + 2, Feature.TABLE);
    placeFeature(world, x + 3, y + 2, Feature.CHAIR);
    placeFeature(world, x + 2, y + 4, Feature.SHELF);
    placeFeature(world, x + 3, y + 1, Feature.LAMP);
    motifs++;
  }
  return motifs;
}

function decorateShelterRoute(world: World, south: Point, center: Point): number {
  let motifs = 0;
  for (let k = 0; k < 5; k++) {
    const x = south.x + (k % 2 === 0 ? -10 : 5);
    const y = center.y + 34 + k * 18;
    carveBlock(world, x, y, 7, 5, SHELTER);
    placeFeature(world, x + 2, y + 2, Feature.BED);
    placeFeature(world, x + 4, y + 2, Feature.SHELF);
    placeFeature(world, x + 3, y + 1, Feature.LAMP);
    motifs++;
  }
  return motifs;
}

function decorateServiceBypass(world: World, anchors: Record<'north' | 'east' | 'south' | 'west', Point>): number {
  let motifs = 0;
  const x = anchors.west.x - 108;
  for (let k = 0; k < 5; k++) {
    const y = anchors.north.y - 58 + k * 34;
    carveBlock(world, x + (k % 2 === 0 ? -5 : 3), y, 5, 8, SERVICE);
    placeFeature(world, x + (k % 2 === 0 ? -3 : 5), y + 3, k % 2 === 0 ? Feature.MACHINE : Feature.APPARATUS);
    placeFeature(world, x + (k % 2 === 0 ? -4 : 4), y + 1, Feature.LAMP);
    motifs++;
  }
  return motifs;
}

function addChokepoints(world: World, anchors: Record<'north' | 'east' | 'south' | 'west', Point>): number {
  let n = 0;
  n += pinchHorizontal(world, anchors.east.x + 46, anchors.east.y, Tex.METAL);
  n += pinchHorizontal(world, anchors.west.x - 42, anchors.west.y, Tex.PANEL);
  n += pinchVertical(world, anchors.north.x, anchors.north.y - 44, Tex.PANEL);
  n += pinchVertical(world, anchors.south.x, anchors.south.y + 42, Tex.HERMO_WALL);
  return n;
}

function connectLandmarks(world: World, anchors: Record<'north' | 'east' | 'south' | 'west', Point>): number {
  let routes = 0;
  for (const target of LANDMARK_TARGETS) {
    const room = findRoom(world, target.needle);
    if (!room) continue;
    const source = anchors[target.route];
    const dest = exteriorPointForRoom(world, room, source);
    if (!dest) continue;
    carveDogleg(world, source, dest, target.style, target.route === 'east' || target.route === 'west' ? 'horizontal' : 'vertical');
    routes++;
  }
  return routes;
}

function connectNearestLifts(world: World, anchors: Record<'north' | 'east' | 'south' | 'west', Point>): number {
  const down = nearestLiftAccess(world, anchors.east, LiftDirection.DOWN);
  const up = nearestLiftAccess(world, anchors.north, LiftDirection.UP);
  let routes = 0;
  if (down) {
    carveDogleg(world, anchors.east, down, MARKET, 'horizontal');
    placeFeature(world, down.x, down.y, Feature.LAMP);
    routes++;
  }
  if (up) {
    carveDogleg(world, anchors.north, up, PUBLIC, 'vertical');
    placeFeature(world, up.x, up.y, Feature.LAMP);
    routes++;
  }
  return routes;
}

function nearestLiftAccess(world: World, source: Point, direction: LiftDirection): Point | null {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    const x = i % W;
    const y = (i / W) | 0;
    const d = world.dist2(source.x, source.y, x, y);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best < 0) return null;

  const lx = best % W;
  const ly = (best / W) | 0;
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
    const x = world.wrap(lx + dx);
    const y = world.wrap(ly + dy);
    const i = world.idx(x, y);
    if (world.features[i] === Feature.LIFT_BUTTON) return { x, y };
  }
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
    const x = world.wrap(lx + dx);
    const y = world.wrap(ly + dy);
    const i = world.idx(x, y);
    if (!world.aptMask[i] && world.cells[i] === Cell.FLOOR) return { x, y };
  }
  return null;
}

function exteriorPointForRoom(world: World, room: Room, source: Point): Point | null {
  let best: Point | null = null;
  let bestD = Infinity;
  for (const di of room.doors) {
    const x = di % W;
    const y = (di / W) | 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
      const px = world.wrap(x + dx);
      const py = world.wrap(y + dy);
      const pi = world.idx(px, py);
      if (world.aptMask[pi] || world.cells[pi] === Cell.LIFT) continue;
      const d = world.dist2(source.x, source.y, px, py);
      if (d < bestD) { bestD = d; best = { x: px, y: py }; }
    }
  }
  if (best) return best;

  const candidates: Point[] = [
    { x: room.x + Math.floor(room.w / 2), y: room.y - 1 },
    { x: room.x + Math.floor(room.w / 2), y: room.y + room.h },
    { x: room.x - 1, y: room.y + Math.floor(room.h / 2) },
    { x: room.x + room.w, y: room.y + Math.floor(room.h / 2) },
  ];
  for (const p of candidates) {
    const x = world.wrap(p.x);
    const y = world.wrap(p.y);
    const i = world.idx(x, y);
    if (world.aptMask[i] || world.cells[i] === Cell.LIFT) continue;
    const d = world.dist2(source.x, source.y, x, y);
    if (d < bestD) { bestD = d; best = { x, y }; }
  }
  return best;
}

function carveDogleg(
  world: World, a: Point, b: Point, style: CorridorStyle,
  first: 'horizontal' | 'vertical',
): number {
  const mid = first === 'horizontal' ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  return carveLine(world, a, mid, style) + carveLine(world, mid, b, style);
}

function carveLine(world: World, a: Point, b: Point, style: CorridorStyle): number {
  const dx = Math.trunc(world.delta(a.x, b.x));
  const dy = Math.trunc(world.delta(a.y, b.y));
  if (Math.abs(dx) >= Math.abs(dy)) {
    return carveAxis(world, a, Math.sign(dx), 0, Math.abs(dx), style);
  }
  return carveAxis(world, a, 0, Math.sign(dy), Math.abs(dy), style);
}

function carveAxis(world: World, start: Point, stepX: number, stepY: number, steps: number, style: CorridorStyle): number {
  let carved = 0;
  let x = world.wrap(start.x);
  let y = world.wrap(start.y);
  for (let s = 0; s <= steps; s++) {
    carved += carveBrush(world, x, y, style);
    x = world.wrap(x + stepX);
    y = world.wrap(y + stepY);
  }
  return carved;
}

function carveBlock(world: World, x: number, y: number, w: number, h: number, style: CorridorStyle): number {
  let carved = 0;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      if (carveCell(world, x + dx, y + dy, style)) carved++;
    }
  }
  for (let dy = -1; dy <= h; dy++) {
    trimWall(world, x - 1, y + dy, style.wall);
    trimWall(world, x + w, y + dy, style.wall);
  }
  for (let dx = -1; dx <= w; dx++) {
    trimWall(world, x + dx, y - 1, style.wall);
    trimWall(world, x + dx, y + h, style.wall);
  }
  return carved;
}

function carveBrush(world: World, x: number, y: number, style: CorridorStyle): number {
  let carved = 0;
  for (let dy = -style.radius; dy <= style.radius; dy++) {
    for (let dx = -style.radius; dx <= style.radius; dx++) {
      if (carveCell(world, x + dx, y + dy, style)) carved++;
    }
  }
  for (let dy = -style.radius - 1; dy <= style.radius + 1; dy++) {
    trimWall(world, x - style.radius - 1, y + dy, style.wall);
    trimWall(world, x + style.radius + 1, y + dy, style.wall);
  }
  for (let dx = -style.radius - 1; dx <= style.radius + 1; dx++) {
    trimWall(world, x + dx, y - style.radius - 1, style.wall);
    trimWall(world, x + dx, y + style.radius + 1, style.wall);
  }
  return carved;
}

function carveCell(world: World, x: number, y: number, style: CorridorStyle): boolean {
  const i = world.idx(x, y);
  if (world.aptMask[i] || world.cells[i] === Cell.LIFT) return false;
  const wasFloor = world.cells[i] === Cell.FLOOR;
  const wasDoor = world.cells[i] === Cell.DOOR;
  if (!wasDoor) world.cells[i] = Cell.FLOOR;
  world.roomMap[i] = -1;
  world.floorTex[i] = style.floor;
  if (!wasFloor && world.features[i] !== Feature.LIFT_BUTTON) world.features[i] = Feature.NONE;
  return !wasFloor && !wasDoor;
}

function trimWall(world: World, x: number, y: number, wallTex: Tex): void {
  const i = world.idx(x, y);
  if (world.aptMask[i] || world.cells[i] !== Cell.WALL) return;
  world.wallTex[i] = wallTex;
}

function setWall(world: World, x: number, y: number, wallTex: Tex): boolean {
  const i = world.idx(x, y);
  if (world.aptMask[i] || world.cells[i] === Cell.LIFT) return false;
  world.cells[i] = Cell.WALL;
  world.roomMap[i] = -1;
  world.wallTex[i] = wallTex;
  world.features[i] = Feature.NONE;
  return true;
}

function pinchHorizontal(world: World, x: number, y: number, wallTex: Tex): number {
  let made = 0;
  if (setWall(world, x, y - 1, wallTex)) made++;
  if (setWall(world, x, y + 1, wallTex)) made++;
  return made > 0 ? 1 : 0;
}

function pinchVertical(world: World, x: number, y: number, wallTex: Tex): number {
  let made = 0;
  if (setWall(world, x - 1, y, wallTex)) made++;
  if (setWall(world, x + 1, y, wallTex)) made++;
  return made > 0 ? 1 : 0;
}

function placeFeature(world: World, x: number, y: number, feature: Feature): void {
  const i = world.idx(x, y);
  if (world.cells[i] !== Cell.FLOOR || world.features[i] !== Feature.NONE) return;
  world.features[i] = feature;
}

function markLivingShelterShells(world: World): LivingShelterShellMetrics {
  return collectLivingShelterShells(world, true);
}

function collectLivingShelterShells(world: World, mutate: boolean): LivingShelterShellMetrics {
  const shellSeen = new Set<number>();
  let roomCount = 0;
  let hermeticDoors = 0;
  for (let ri = 0; ri < world.apartmentRoomCount; ri++) {
    const room = world.rooms[ri];
    if (!room || !roomHasHermeticShell(world, room)) continue;
    roomCount++;
    hermeticDoors += room.doors.filter(idx => {
      const door = world.doors.get(idx);
      return door?.state === DoorState.HERMETIC_OPEN || door?.state === DoorState.HERMETIC_CLOSED;
    }).length;
    for (let dy = -2; dy <= room.h + 1; dy++) {
      for (let dx = -2; dx <= room.w + 1; dx++) {
        if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
        const ci = world.idx(room.x + dx, room.y + dy);
        if (world.aptMask[ci] || world.cells[ci] !== Cell.FLOOR) continue;
        shellSeen.add(ci);
        if (!mutate) continue;
        world.floorTex[ci] = Tex.F_CONCRETE;
        for (const [ox, oy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
          trimWall(world, ci % W + ox, ((ci / W) | 0) + oy, Tex.HERMO_WALL);
        }
      }
    }
  }
  return { roomCount, hermeticDoors, shellCells: shellSeen.size };
}

function roomHasHermeticShell(world: World, room: Room): boolean {
  for (const idx of room.doors) {
    const door = world.doors.get(idx);
    if (door?.state === DoorState.HERMETIC_OPEN || door?.state === DoorState.HERMETIC_CLOSED) return true;
  }
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      if (world.hermoWall[world.idx(room.x + dx, room.y + dy)]) return true;
    }
  }
  return false;
}
