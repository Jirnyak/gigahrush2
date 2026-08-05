/* -- Route floor macro shells: fill authored POIs into 1024x1024 floors. -- */

import {
  W,
  Cell,
  Feature,
  FloorLevel,
  RoomType,
  Tex,
  type Room,
} from '../../core/types';
import { World } from '../../core/world';
import type { DesignFloorRouteDef } from '../../data/design_floors';

interface Point {
  x: number;
  y: number;
}

interface FootprintStats {
  count: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface ShellStyle {
  floorTex: Tex;
  wallTex: Tex;
  radius: number;
  fog: number;
  featureA: Feature;
  featureB: Feature;
  roomPrefix: string;
}

const MIN_OPEN_CELLS = 18_000;
const EDGE = W - 1;

export function ensureRouteWideFootprint(world: World, route: DesignFloorRouteDef, rng: () => number): void {
  const stats = footprintStats(world);
  if (!needsShell(stats)) return;

  const mask = protectedMask(world);
  switch (route.id) {
    case 'roof':
      expandRoofShell(world, mask, rng, stats);
      break;
    case 'darkness':
      expandDarknessShell(world, mask, rng, stats);
      break;
    case 'underhell':
      expandOrganicShell(world, mask, rng, stats, hellStyle(route));
      break;
    case 'pioneer_camp':
      expandCampShell(world, mask, rng, stats);
      break;
    case 'black_market_88':
      expandSocialShell(world, mask, rng, stats, marketStyle(route));
      break;
    default:
      if (route.baseFloor === FloorLevel.MAINTENANCE) {
        expandIndustrialShell(world, mask, rng, stats, industrialStyle(route));
      } else if (route.baseFloor === FloorLevel.HELL || route.baseFloor === FloorLevel.VOID) {
        expandOrganicShell(world, mask, rng, stats, hellStyle(route));
      } else if (route.baseFloor === FloorLevel.KVARTIRY || route.baseFloor === FloorLevel.LIVING) {
        expandSocialShell(world, mask, rng, stats, socialStyle(route));
      } else {
        expandAdministrativeShell(world, mask, rng, stats, administrativeStyle(route));
      }
      break;
  }

  world.markFloorTexDirty();
  world.markWallTexDirty();
  world.markFogDirty();
}

function footprintStats(world: World): FootprintStats {
  const out: FootprintStats = { count: 0, minX: W, minY: W, maxX: -1, maxY: -1 };
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const cell = world.cells[world.idx(x, y)];
      if (cell !== Cell.FLOOR && cell !== Cell.WATER && cell !== Cell.DOOR && cell !== Cell.LIFT) continue;
      out.count++;
      if (x < out.minX) out.minX = x;
      if (y < out.minY) out.minY = y;
      if (x > out.maxX) out.maxX = x;
      if (y > out.maxY) out.maxY = y;
    }
  }
  return out;
}

function needsShell(stats: FootprintStats): boolean {
  return stats.count < MIN_OPEN_CELLS
    || stats.minX !== 0
    || stats.minY !== 0
    || stats.maxX !== EDGE
    || stats.maxY !== EDGE;
}

function footprintCenter(stats: FootprintStats): Point {
  if (stats.count <= 0) return { x: W >> 1, y: W >> 1 };
  return {
    x: Math.max(0, Math.min(EDGE, Math.round((stats.minX + stats.maxX) / 2))),
    y: Math.max(0, Math.min(EDGE, Math.round((stats.minY + stats.maxY) / 2))),
  };
}

function protectedMask(world: World): Uint8Array {
  const mask = new Uint8Array(W * W);
  for (const room of world.rooms) {
    if (!room) continue;
    for (let y = room.y - 1; y <= room.y + room.h; y++) {
      for (let x = room.x - 1; x <= room.x + room.w; x++) mask[world.idx(x, y)] = 1;
    }
  }
  for (const idx of world.doors.keys()) mask[idx] = 1;
  for (const container of world.containers) mask[world.idx(container.x, container.y)] = 1;
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.LIFT || world.features[i] === Feature.LIFT_BUTTON) mask[i] = 1;
  }
  return mask;
}

function administrativeStyle(route: DesignFloorRouteDef): ShellStyle {
  if (route.id === 'bank_floor') {
    return {
      floorTex: Tex.F_MARBLE_TILE,
      wallTex: Tex.MARBLE,
      radius: 2,
      fog: 0,
      featureA: Feature.DESK,
      featureB: Feature.SCREEN,
      roomPrefix: 'Банковский корпус',
    };
  }
  return {
    floorTex: Tex.F_PARQUET,
    wallTex: Tex.MARBLE,
    radius: 2,
    fog: 0,
    featureA: Feature.DESK,
    featureB: Feature.SHELF,
    roomPrefix: route.id === 'registry_morgue' ? 'Регистрационный отсек' : 'Административный отсек',
  };
}

function socialStyle(route: DesignFloorRouteDef): ShellStyle {
  return {
    floorTex: route.id === 'communal_ring' ? Tex.F_LINO : Tex.F_CARPET,
    wallTex: route.id === 'manhattan_crossroads' ? Tex.BRICK : Tex.PANEL,
    radius: 2,
    fog: 0,
    featureA: Feature.TABLE,
    featureB: Feature.CHAIR,
    roomPrefix: 'Коммунальный квартал',
  };
}

function marketStyle(_route: DesignFloorRouteDef): ShellStyle {
  return {
    floorTex: Tex.F_CONCRETE,
    wallTex: Tex.METAL,
    radius: 2,
    fog: 0,
    featureA: Feature.TABLE,
    featureB: Feature.SHELF,
    roomPrefix: 'Рыночная кишка',
  };
}

function industrialStyle(route: DesignFloorRouteDef): ShellStyle {
  return {
    floorTex: route.id === 'dark_metro' ? Tex.F_CONCRETE : Tex.F_CONCRETE,
    wallTex: route.id === 'dark_metro' ? Tex.PIPE : Tex.METAL,
    radius: 2,
    fog: route.id === 'dark_metro' ? 18 : 8,
    featureA: Feature.MACHINE,
    featureB: Feature.APPARATUS,
    roomPrefix: route.id === 'production_belt'
      ? 'Производственный узел'
      : route.id === 'attractor_dvor'
        ? 'Аттракторный двор'
        : 'Служебный узел',
  };
}

function hellStyle(route: DesignFloorRouteDef): ShellStyle {
  const darkness = route.baseFloor === FloorLevel.VOID;
  return {
    floorTex: darkness ? Tex.F_VOID : Tex.F_GUT,
    wallTex: darkness ? Tex.DARK : Tex.GUT,
    radius: darkness ? 1 : 2,
    fog: darkness ? 74 : 28,
    featureA: darkness ? Feature.CANDLE : Feature.APPARATUS,
    featureB: darkness ? Feature.APPARATUS : Feature.CANDLE,
    roomPrefix: darkness ? 'Темный карман' : 'Мясной карман',
  };
}

function expandAdministrativeShell(
  world: World,
  mask: Uint8Array,
  rng: () => number,
  stats: FootprintStats,
  style: ShellStyle,
): void {
  const c = footprintCenter(stats);
  const cores = jitteredGrid(rng, 4, 4, 96, 928, 90, 928, 26);
  const route: Point[] = [c, ...serpentine(cores), c];
  carvePolyline(world, mask, route, style, 0.7);

  const edgeRooms: Point[] = [
    { x: 0, y: c.y },
    { x: EDGE, y: c.y + jitter(rng, 80) },
    { x: c.x + jitter(rng, 80), y: 0 },
    { x: c.x - jitter(rng, 80), y: EDGE },
  ];
  for (const target of edgeRooms) carveBentRoute(world, mask, c, clampPoint(target), style, rng, 1.1);

  for (let i = 0; i < cores.length; i++) {
    const p = cores[i];
    const wide = i % 3 === 0;
    const room = tryStampShellRoom(
      world,
      mask,
      i % 5 === 0 ? RoomType.COMMON : i % 4 === 0 ? RoomType.STORAGE : RoomType.OFFICE,
      p.x - (wide ? 18 : 13),
      p.y - (wide ? 10 : 8),
      wide ? 36 : 26,
      wide ? 20 : 16,
      `${style.roomPrefix} ${i + 1}`,
      style,
    );
    if (room) {
      decorateOfficeRoom(world, room, style, i);
      carveBentRoute(world, mask, roomCenter(room), route[Math.max(0, Math.min(route.length - 1, i + 1))], style, rng, 0.35);
    }
  }
}

function expandSocialShell(
  world: World,
  mask: Uint8Array,
  rng: () => number,
  stats: FootprintStats,
  style: ShellStyle,
): void {
  const c = footprintCenter(stats);
  const blocks = jitteredGrid(rng, 4, 4, 110, 914, 110, 914, 34);
  for (let row = 0; row < 4; row++) {
    const a = blocks[row * 4];
    const b = blocks[row * 4 + 3];
    carveBentRoute(world, mask, a, b, style, rng, 0.45);
  }
  for (let col = 0; col < 4; col++) {
    const a = blocks[col];
    const b = blocks[12 + col];
    carveBentRoute(world, mask, a, b, style, rng, 0.45);
  }
  for (const target of [{ x: 0, y: c.y }, { x: EDGE, y: c.y }, { x: c.x, y: 0 }, { x: c.x, y: EDGE }]) {
    carveBentRoute(world, mask, c, target, style, rng, 0.8);
  }

  for (let i = 0; i < blocks.length; i++) {
    const p = blocks[i];
    if (i % 4 === 0) {
      stampCourtyard(world, mask, p, style, i);
    } else if (i % 4 === 1) {
      stampApartmentChain(world, mask, p, style, i, true);
    } else if (i % 4 === 2) {
      stampApartmentChain(world, mask, p, style, i, false);
    } else {
      const room = tryStampShellRoom(world, mask, RoomType.KITCHEN, p.x - 12, p.y - 6, 24, 12, `${style.roomPrefix}: кухня ${i + 1}`, style);
      if (room) decorateKitchenRoom(world, room);
    }
  }
}

function expandCampShell(world: World, mask: Uint8Array, rng: () => number, stats: FootprintStats): void {
  const style: ShellStyle = {
    floorTex: Tex.F_WOOD,
    wallTex: Tex.PANEL,
    radius: 1,
    fog: 0,
    featureA: Feature.BED,
    featureB: Feature.TABLE,
    roomPrefix: 'Пионерский корпус',
  };
  const c = footprintCenter(stats);
  const fireLoop = [
    { x: c.x, y: c.y },
    { x: 126, y: 136 },
    { x: 884, y: 116 },
    { x: 926, y: 828 },
    { x: 132, y: 898 },
    { x: c.x, y: c.y },
  ];
  carvePolyline(world, mask, fireLoop, style, 1.2);
  for (const target of [{ x: 0, y: 512 }, { x: EDGE, y: 512 }, { x: 512, y: 0 }, { x: 512, y: EDGE }]) {
    carveBentRoute(world, mask, c, target, style, rng, 0.6);
  }
  for (let i = 0; i < 18; i++) {
    const base = fireLoop[i % (fireLoop.length - 1)];
    const next = fireLoop[(i + 1) % (fireLoop.length - 1)];
    const t = ((i % 5) + 1) / 6;
    const x = Math.round(base.x + (next.x - base.x) * t) + jitter(rng, 28);
    const y = Math.round(base.y + (next.y - base.y) * t) + jitter(rng, 28);
    const room = tryStampShellRoom(world, mask, i % 5 === 0 ? RoomType.COMMON : RoomType.LIVING, x - 10, y - 6, 20, 12, `${style.roomPrefix} ${i + 1}`, style);
    if (room) {
      decorateCampRoom(world, room, i);
      carveBentRoute(world, mask, roomCenter(room), base, style, rng, 0.25);
    }
  }
}

function expandIndustrialShell(
  world: World,
  mask: Uint8Array,
  rng: () => number,
  stats: FootprintStats,
  style: ShellStyle,
): void {
  const c = footprintCenter(stats);
  const trunks = [
    [{ x: 0, y: c.y - 92 }, { x: c.x - 120, y: c.y - 92 }, { x: c.x + 210, y: c.y + 36 }, { x: EDGE, y: c.y + 36 }],
    [{ x: c.x - 70, y: 0 }, { x: c.x - 70, y: c.y - 180 }, { x: c.x + 96, y: c.y + 166 }, { x: c.x + 96, y: EDGE }],
    [{ x: 0, y: c.y + 186 }, { x: c.x - 220, y: c.y + 44 }, { x: c.x + 240, y: c.y + 220 }, { x: EDGE, y: c.y - 184 }],
  ];
  const clampedTrunks = trunks.map(trunk => trunk.map(clampPoint));
  for (const trunk of clampedTrunks) carvePolyline(world, mask, trunk, style, 0.4);
  for (const trunk of clampedTrunks) carveIndustrialWater(world, mask, trunk, style);

  for (let i = 0; i < 18; i++) {
    const x = 92 + (i % 6) * 168 + jitter(rng, 22);
    const y = 108 + Math.floor(i / 6) * 270 + jitter(rng, 28);
    const room = tryStampShellRoom(
      world,
      mask,
      i % 4 === 0 ? RoomType.PRODUCTION : i % 4 === 1 ? RoomType.STORAGE : RoomType.CORRIDOR,
      x - 15,
      y - 10,
      30 + (i % 3) * 6,
      18 + (i % 2) * 4,
      `${style.roomPrefix} ${i + 1}`,
      style,
    );
    if (room) {
      decorateMachineRoom(world, room, i);
      carveBentRoute(world, mask, roomCenter(room), trunks[i % trunks.length][1], style, rng, 0.25);
    }
  }
}

function expandOrganicShell(
  world: World,
  mask: Uint8Array,
  rng: () => number,
  stats: FootprintStats,
  style: ShellStyle,
): void {
  const c = footprintCenter(stats);
  const pockets = [
    { x: 34, y: 84 }, { x: 278, y: 42 }, { x: 718, y: 74 }, { x: 990, y: 180 },
    { x: 934, y: 514 }, { x: 992, y: 872 }, { x: 690, y: 960 }, { x: 308, y: 914 },
    { x: 38, y: 786 }, { x: 94, y: 428 }, { x: 512, y: 0 }, { x: 512, y: EDGE },
    { x: 0, y: 512 }, { x: EDGE, y: 512 },
  ];
  let from = c;
  for (let i = 0; i < pockets.length; i++) {
    const p = clampPoint({ x: pockets[i].x + jitter(rng, 24), y: pockets[i].y + jitter(rng, 24) });
    carveWormRoute(world, mask, from, p, style, rng, i % 3 === 0 ? style.radius + 1 : style.radius);
    stampOrganicPocket(world, mask, p, style, i);
    from = p;
  }
  carveWormRoute(world, mask, from, c, style, rng, style.radius);
}

function expandDarknessShell(world: World, mask: Uint8Array, rng: () => number, stats: FootprintStats): void {
  const style: ShellStyle = {
    floorTex: Tex.F_VOID,
    wallTex: Tex.DARK,
    radius: 2,
    fog: 88,
    featureA: Feature.CANDLE,
    featureB: Feature.APPARATUS,
    roomPrefix: 'Темный световой карман',
  };
  expandOrganicShell(world, mask, rng, stats, style);
  const anchors = [{ x: 0, y: 0 }, { x: EDGE, y: 0 }, { x: EDGE, y: EDGE }, { x: 0, y: EDGE }];
  for (let i = 0; i < anchors.length; i++) {
    stampOrganicPocket(world, mask, anchors[i], style, 40 + i);
    setFeature(world, anchors[i].x, anchors[i].y, Feature.CANDLE);
  }
}

function expandRoofShell(world: World, mask: Uint8Array, rng: () => number, stats: FootprintStats): void {
  const style: ShellStyle = {
    floorTex: Tex.F_CONCRETE,
    wallTex: Tex.CONCRETE,
    radius: 1,
    fog: 0,
    featureA: Feature.APPARATUS,
    featureB: Feature.SHELF,
    roomPrefix: 'Крышная плита',
  };
  const c = footprintCenter(stats);
  const slabs = [
    { x: 32, y: 128 }, { x: 260, y: 50 }, { x: 584, y: 82 }, { x: 948, y: 126 },
    { x: 906, y: 438 }, { x: 976, y: 812 }, { x: 620, y: 936 }, { x: 246, y: 962 },
    { x: 54, y: 710 }, { x: 106, y: 376 }, { x: 0, y: 512 }, { x: EDGE, y: 512 },
    { x: 512, y: 0 }, { x: 512, y: EDGE },
  ];
  let last = c;
  for (let i = 0; i < slabs.length; i++) {
    const slab = slabs[i];
    const p = clampPoint({
      x: slab.x === 0 || slab.x === EDGE ? slab.x : slab.x + jitter(rng, 18),
      y: slab.y === 0 || slab.y === EDGE ? slab.y : slab.y + jitter(rng, 18),
    });
    carveBentRoute(world, mask, last, p, style, rng, 0.25);
    const room = tryStampShellRoom(world, mask, i % 3 === 0 ? RoomType.PRODUCTION : RoomType.COMMON, p.x - 18, p.y - 12, 36, 24, `${style.roomPrefix} ${i + 1}`, style);
    if (room) decorateRoofSlab(world, room, i);
    last = p;
  }
  carveBentRoute(world, mask, last, c, style, rng, 0.25);
}

function jitteredGrid(rng: () => number, cols: number, rows: number, minX: number, maxX: number, minY: number, maxY: number, amount: number): Point[] {
  const out: Point[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      out.push(clampPoint({
        x: Math.round(minX + ((maxX - minX) * x) / Math.max(1, cols - 1)) + jitter(rng, amount),
        y: Math.round(minY + ((maxY - minY) * y) / Math.max(1, rows - 1)) + jitter(rng, amount),
      }));
    }
  }
  return out;
}

function serpentine(points: Point[]): Point[] {
  const out: Point[] = [];
  for (let row = 0; row < 4; row++) {
    const slice = points.slice(row * 4, row * 4 + 4);
    if (row & 1) slice.reverse();
    out.push(...slice);
  }
  return out;
}

function jitter(rng: () => number, amount: number): number {
  return Math.round((rng() * 2 - 1) * amount);
}

function clampPoint(p: Point): Point {
  return {
    x: Math.max(0, Math.min(EDGE, Math.round(p.x))),
    y: Math.max(0, Math.min(EDGE, Math.round(p.y))),
  };
}

function roomCenter(room: Room): Point {
  return { x: worldWrap(room.x + (room.w >> 1)), y: worldWrap(room.y + (room.h >> 1)) };
}

function worldWrap(v: number): number {
  return ((v % W) + W) % W;
}

function carvePolyline(world: World, mask: Uint8Array, points: Point[], style: ShellStyle, wobble: number): void {
  for (let i = 1; i < points.length; i++) carveSegment(world, mask, points[i - 1], points[i], style, style.radius, wobble);
}

function carveBentRoute(
  world: World,
  mask: Uint8Array,
  a: Point,
  b: Point,
  style: ShellStyle,
  rng: () => number,
  wobble: number,
): void {
  const horizontalFirst = rng() < 0.5;
  const mid: Point = horizontalFirst
    ? { x: b.x, y: a.y + jitter(rng, 42) }
    : { x: a.x + jitter(rng, 42), y: b.y };
  carvePolyline(world, mask, [clampPoint(a), clampPoint(mid), clampPoint(b)], style, wobble);
}

function carveWormRoute(
  world: World,
  mask: Uint8Array,
  a: Point,
  b: Point,
  style: ShellStyle,
  rng: () => number,
  radius: number,
): void {
  const bends: Point[] = [clampPoint(a)];
  const bendCount = 3 + Math.floor(rng() * 3);
  for (let i = 1; i <= bendCount; i++) {
    const t = i / (bendCount + 1);
    bends.push(clampPoint({
      x: a.x + (b.x - a.x) * t + jitter(rng, 94),
      y: a.y + (b.y - a.y) * t + jitter(rng, 94),
    }));
  }
  bends.push(clampPoint(b));
  for (let i = 1; i < bends.length; i++) carveSegment(world, mask, bends[i - 1], bends[i], style, radius, 1.6);
}

function carveSegment(
  world: World,
  mask: Uint8Array,
  a: Point,
  b: Point,
  style: ShellStyle,
  radius: number,
  wobble: number,
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.max(1, Math.abs(dx), Math.abs(dy));
  const nx = dy === 0 ? 0 : -Math.sign(dy);
  const ny = dx === 0 ? 0 : Math.sign(dx);
  const phase = (a.x * 13 + a.y * 17 + b.x * 19 + b.y * 23) * 0.013;
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const wave = Math.sin(t * Math.PI * 2 + phase) * wobble;
    const x = Math.round(a.x + dx * t + nx * wave);
    const y = Math.round(a.y + dy * t + ny * wave);
    carveDisc(world, mask, x, y, radius, style, Cell.FLOOR);
    if (step % 37 === 0) setFeature(world, x, y, step % 74 === 0 ? style.featureA : style.featureB);
  }
}

function carveDisc(
  world: World,
  mask: Uint8Array,
  cx: number,
  cy: number,
  radius: number,
  style: ShellStyle,
  floorCell: Cell,
): void {
  const floorR2 = radius * radius;
  const shoulder = radius + 2;
  const shoulderR2 = shoulder * shoulder;
  for (let dy = -shoulder; dy <= shoulder; dy++) {
    for (let dx = -shoulder; dx <= shoulder; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > shoulderR2) continue;
      const ci = world.idx(cx + dx, cy + dy);
      if (mask[ci] || world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR) continue;
      if (d2 <= floorR2) {
        world.cells[ci] = floorCell;
        world.roomMap[ci] = -1;
        world.floorTex[ci] = floorCell === Cell.WATER ? Tex.F_WATER : style.floorTex;
        world.wallTex[ci] = 0;
        world.hermoWall[ci] = 0;
        if (style.fog > 0) world.fog[ci] = Math.max(world.fog[ci], style.fog);
      } else if (world.cells[ci] === Cell.WALL || world.cells[ci] === Cell.ABYSS) {
        world.cells[ci] = Cell.WALL;
        world.roomMap[ci] = -1;
        world.wallTex[ci] = style.wallTex;
        world.features[ci] = Feature.NONE;
        world.hermoWall[ci] = 0;
      }
    }
  }
}

function carveIndustrialWater(world: World, mask: Uint8Array, points: Point[], style: ShellStyle): void {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const steps = Math.max(1, Math.abs(dx), Math.abs(dy));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const x = Math.round(a.x + dx * t);
      const y = Math.round(a.y + dy * t);
      carveDisc(world, mask, x, y, 1, style, Cell.WATER);
      if (step % 41 === 0) carveDisc(world, mask, x + 4, y + 4, 1, style, Cell.FLOOR);
    }
  }
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR && world.features[ci] === Feature.NONE) world.features[ci] = feature;
}

function tryStampShellRoom(
  world: World,
  mask: Uint8Array,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  style: ShellStyle,
): Room | null {
  const rx = Math.max(2, Math.min(W - w - 3, Math.round(x)));
  const ry = Math.max(2, Math.min(W - h - 3, Math.round(y)));
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (mask[ci] || world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR) return null;
    }
  }

  const room: Room = {
    id: world.rooms.length,
    type,
    x: rx,
    y: ry,
    w,
    h,
    doors: [],
    sealed: false,
    name,
    apartmentId: -1,
    wallTex: style.wallTex,
    floorTex: style.floorTex,
  };
  world.rooms.push(room);

  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const border = dx < 0 || dx >= w || dy < 0 || dy >= h;
      const ci = world.idx(rx + dx, ry + dy);
      mask[ci] = 1;
      world.cells[ci] = border ? Cell.WALL : Cell.FLOOR;
      world.roomMap[ci] = border ? -1 : room.id;
      world.wallTex[ci] = style.wallTex;
      world.floorTex[ci] = style.floorTex;
      if (border) world.features[ci] = Feature.NONE;
      if (style.fog > 0 && !border) world.fog[ci] = Math.max(world.fog[ci], style.fog);
    }
  }
  return room;
}

function stampCourtyard(world: World, mask: Uint8Array, p: Point, style: ShellStyle, serial: number): void {
  const room = tryStampShellRoom(world, mask, RoomType.COMMON, p.x - 20, p.y - 15, 40, 30, `${style.roomPrefix}: двор ${serial + 1}`, style);
  if (!room) return;
  for (let x = room.x + 6; x < room.x + room.w - 6; x += 8) {
    world.cells[world.idx(x, room.y + (room.h >> 1))] = Cell.WALL;
    setFeature(world, x + 2, room.y + (room.h >> 1) + 2, Feature.TABLE);
  }
  setFeature(world, room.x + 8, room.y + 8, Feature.LAMP);
  setFeature(world, room.x + room.w - 9, room.y + room.h - 8, Feature.LAMP);
}

function stampApartmentChain(world: World, mask: Uint8Array, p: Point, style: ShellStyle, serial: number, horizontal: boolean): void {
  const count = 4 + (serial % 3);
  for (let i = 0; i < count; i++) {
    const x = horizontal ? p.x - 28 + i * 14 : p.x - 5;
    const y = horizontal ? p.y - 4 : p.y - 28 + i * 12;
    const type = i % 3 === 0 ? RoomType.LIVING : i % 3 === 1 ? RoomType.KITCHEN : RoomType.BATHROOM;
    const room = tryStampShellRoom(world, mask, type, x, y, 10, 8, `${style.roomPrefix}: секция ${serial + 1}.${i + 1}`, style);
    if (!room) continue;
    if (type === RoomType.KITCHEN) decorateKitchenRoom(world, room);
    else if (type === RoomType.BATHROOM) decorateBathRoom(world, room);
    else decorateLivingRoom(world, room);
  }
}

function stampOrganicPocket(world: World, mask: Uint8Array, p: Point, style: ShellStyle, serial: number): void {
  carveDisc(world, mask, p.x, p.y, 8 + (serial % 5), style, Cell.FLOOR);
  setFeature(world, p.x, p.y, serial % 2 === 0 ? style.featureA : style.featureB);
  if (serial % 3 !== 0) return;
  const room = tryStampShellRoom(world, mask, RoomType.STORAGE, p.x - 7, p.y - 5, 14, 10, `${style.roomPrefix} ${serial + 1}`, style);
  if (room) decorateStorageRoom(world, room, style);
}

function decorateOfficeRoom(world: World, room: Room, style: ShellStyle, serial: number): void {
  for (let x = room.x + 3; x < room.x + room.w - 3; x += 5) {
    setFeature(world, x, room.y + 3, serial % 2 === 0 ? Feature.DESK : style.featureA);
    setFeature(world, x, room.y + room.h - 4, style.featureB);
  }
  setFeature(world, room.x + room.w - 4, room.y + 3, Feature.SCREEN);
}

function decorateKitchenRoom(world: World, room: Room): void {
  for (let x = room.x + 2; x < room.x + room.w - 2; x += 4) setFeature(world, x, room.y + 2, Feature.STOVE);
  setFeature(world, room.x + 2, room.y + room.h - 3, Feature.SINK);
  setFeature(world, room.x + room.w - 4, room.y + room.h - 3, Feature.TABLE);
}

function decorateBathRoom(world: World, room: Room): void {
  for (let x = room.x + 2; x < room.x + room.w - 2; x += 4) {
    setFeature(world, x, room.y + 2, Feature.SINK);
    setFeature(world, x + 1, room.y + room.h - 3, Feature.TOILET);
  }
}

function decorateLivingRoom(world: World, room: Room): void {
  setFeature(world, room.x + 2, room.y + 2, Feature.BED);
  setFeature(world, room.x + room.w - 4, room.y + 2, Feature.TABLE);
  setFeature(world, room.x + room.w - 4, room.y + room.h - 3, Feature.CHAIR);
}

function decorateStorageRoom(world: World, room: Room, style: ShellStyle): void {
  for (let x = room.x + 2; x < room.x + room.w - 2; x += 3) {
    setFeature(world, x, room.y + 2, Feature.SHELF);
    setFeature(world, x, room.y + room.h - 3, style.featureB);
  }
}

function decorateMachineRoom(world: World, room: Room, serial: number): void {
  for (let x = room.x + 4; x < room.x + room.w - 4; x += 6) {
    setFeature(world, x, room.y + 3, Feature.MACHINE);
    setFeature(world, x + 2, room.y + room.h - 4, Feature.APPARATUS);
  }
  if (serial % 2 === 0) {
    for (let x = room.x + 3; x < room.x + room.w - 3; x++) {
      const ci = world.idx(x, room.y + (room.h >> 1));
      if (world.cells[ci] === Cell.FLOOR) {
        world.cells[ci] = Cell.WATER;
        world.floorTex[ci] = Tex.F_WATER;
      }
    }
  }
}

function decorateCampRoom(world: World, room: Room, serial: number): void {
  if (serial % 5 === 0) {
    setFeature(world, room.x + 4, room.y + 4, Feature.TABLE);
    setFeature(world, room.x + room.w - 5, room.y + 4, Feature.LAMP);
    setFeature(world, room.x + room.w - 6, room.y + room.h - 4, Feature.SHELF);
    return;
  }
  for (let x = room.x + 3; x < room.x + room.w - 3; x += 6) setFeature(world, x, room.y + 3, Feature.BED);
  setFeature(world, room.x + room.w - 5, room.y + room.h - 4, Feature.TABLE);
}

function decorateRoofSlab(world: World, room: Room, serial: number): void {
  for (let x = room.x + 5; x < room.x + room.w - 5; x += 8) {
    setFeature(world, x, room.y + 4, serial % 2 === 0 ? Feature.APPARATUS : Feature.SHELF);
    setFeature(world, x + 2, room.y + room.h - 5, Feature.LAMP);
  }
}
