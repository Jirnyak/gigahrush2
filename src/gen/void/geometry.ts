/* ── VOID macro geometry: islands, folds, shelters, boss lane ─── */

import {
  W,
  Cell,
  Tex,
  Feature,
  LiftDirection,
  DoorState,
  RoomType,
  ZoneFaction,
  type Room,
  type TerritoryOwner,
} from '../../core/types';
import { World } from '../../core/world';
import { placeDoorAt, stampRoom } from '../shared';
import {
  createProxyGrid,
  extractProxyDescriptors,
  proxyCellCenter,
  proxyIndex,
  worldToProxy,
  type ProxyGrid,
} from '../proxy_grid';

export interface VoidGeometryLayout {
  spawnX: number;
  spawnY: number;
  bossX: number;
  bossY: number;
}

export const VOID_DEAD_LAMP_ROWS: readonly (readonly [number, number, number, number])[] = [
  [436, 520, 474, 520],
  [778, 528, 818, 536],
  [922, 620, 970, 620],
  [132, 492, 92, 492],
] as const;

interface IslandSpec {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  shardSeed: number;
}

interface ChaosPocketSpec {
  x: number;
  y: number;
  radius: number;
  kind: 'spiral' | 'ring' | 'cross' | 'diamond' | 'line';
  serial: number;
}

interface VoidMidBlockSpec {
  cx: number;
  cy: number;
  cols: number;
  rows: number;
  serial: number;
  owner: TerritoryOwner;
}

interface VoidHqSpec {
  owner: TerritoryOwner;
  name: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  supportSerial: number;
}

const SPAWN_X = W >> 1;
const SPAWN_Y = W >> 1;

export const VOID_GEOMETRY_ANCHORS = {
  spawn: [SPAWN_X, SPAWN_Y],
  lightPocket: [SPAWN_X, SPAWN_Y - 21],
  listeningRoute: [462, 520],
  fastCrossing: [650, 558],
  fallbackBridge: [948, 620],
  protocolFrame: [602, 525],
  boss: [684, 558],
} as const;

const ISLANDS: IslandSpec[] = [
  { cx: SPAWN_X, cy: SPAWN_Y, rx: 20, ry: 15, shardSeed: 1 },
  { cx: 458, cy: 540, rx: 17, ry: 11, shardSeed: 2 },
  { cx: 432, cy: 492, rx: 18, ry: 12, shardSeed: 3 },
  { cx: 562, cy: 508, rx: 24, ry: 15, shardSeed: 4 },
  { cx: 526, cy: 574, rx: 26, ry: 15, shardSeed: 5 },
  { cx: 616, cy: 560, rx: 22, ry: 12, shardSeed: 6 },
  { cx: 684, cy: 558, rx: 29, ry: 20, shardSeed: 7 },
  { cx: 1000, cy: 496, rx: 18, ry: 11, shardSeed: 8 },
  { cx: 28, cy: 496, rx: 18, ry: 11, shardSeed: 9 },
  { cx: 948, cy: 620, rx: 16, ry: 10, shardSeed: 10 },
  { cx: 84, cy: 636, rx: 18, ry: 12, shardSeed: 11 },
  { cx: 324, cy: 628, rx: 21, ry: 13, shardSeed: 12 },
  { cx: 742, cy: 486, rx: 17, ry: 11, shardSeed: 13 },
  { cx: 800, cy: 532, rx: 19, ry: 12, shardSeed: 14 },
  { cx: 652, cy: 684, rx: 20, ry: 12, shardSeed: 15 },
  { cx: 388, cy: 382, rx: 18, ry: 12, shardSeed: 16 },
];

const FOLDED_PATHS: readonly (readonly (readonly [number, number])[])[] = [
  [[SPAWN_X, SPAWN_Y], [500, 512], [500, 536], [458, 536], [458, 550]],
  [[458, 540], [458, 506], [432, 506], [432, 492]],
  [[SPAWN_X, SPAWN_Y], [526, 512], [526, 498], [544, 498], [544, 508]],
  [[SPAWN_X, SPAWN_Y], [512, 538], [528, 538], [528, 574]],
  [[562, 508], [592, 508], [592, 560], [616, 560]],
  [[526, 574], [560, 574], [560, 560], [616, 560]],
  [[432, 492], [1000, 492], [28, 492], [84, 636], [324, 628], [526, 574]],
  [[616, 560], [684, 558]],
  [[684, 558], [742, 486], [800, 532], [684, 558]],
  [[526, 574], [652, 684], [948, 620], [28, 496]],
  [[432, 492], [388, 382], [562, 508]],
];

const VOID_REMOTE_POCKETS: readonly (readonly [number, number])[] = [
  [0, 512], [84, 86], [312, 0], [706, 92], [1023, 214],
  [928, 520], [1023, 846], [688, 1023], [328, 922], [0, 790],
  [122, 390], [512, 1023], [512, 0], [1023, 512],
];

const VOID_CHAOS_POCKETS: readonly ChaosPocketSpec[] = [
  { x: 176, y: 176, radius: 24, kind: 'spiral', serial: 21 },
  { x: 304, y: 92, radius: 18, kind: 'cross', serial: 22 },
  { x: 486, y: 120, radius: 22, kind: 'ring', serial: 23 },
  { x: 742, y: 166, radius: 26, kind: 'spiral', serial: 24 },
  { x: 918, y: 308, radius: 20, kind: 'diamond', serial: 25 },
  { x: 808, y: 438, radius: 23, kind: 'line', serial: 26 },
  { x: 906, y: 704, radius: 25, kind: 'spiral', serial: 27 },
  { x: 742, y: 884, radius: 20, kind: 'cross', serial: 28 },
  { x: 552, y: 908, radius: 22, kind: 'ring', serial: 29 },
  { x: 352, y: 842, radius: 24, kind: 'spiral', serial: 30 },
  { x: 162, y: 714, radius: 21, kind: 'diamond', serial: 31 },
  { x: 112, y: 492, radius: 24, kind: 'line', serial: 32 },
  { x: 274, y: 358, radius: 19, kind: 'ring', serial: 33 },
  { x: 884, y: 96, radius: 17, kind: 'spiral', serial: 34 },
  { x: 1008, y: 898, radius: 18, kind: 'cross', serial: 35 },
  { x: 42, y: 222, radius: 19, kind: 'spiral', serial: 36 },
];

const VOID_CHAOS_LINKS: readonly (readonly [number, number, number])[] = [
  [0, 3, 61], [1, 5, 62], [2, 8, 63], [3, 10, 64],
  [4, 12, 65], [5, 9, 66], [6, 11, 67], [7, 13, 68],
  [8, 14, 69], [10, 15, 70], [12, 2, 71], [15, 4, 72],
];

const VOID_ATTRACTOR_FIELDS: readonly (readonly [number, number, number, number])[] = [
  [222, 246, 42, 201],
  [456, 238, 48, 202],
  [720, 278, 54, 203],
  [884, 542, 46, 204],
  [676, 782, 52, 205],
  [412, 724, 44, 206],
  [164, 548, 50, 207],
];

const VOID_MID_BLOCKS: readonly VoidMidBlockSpec[] = [
  { cx: 176, cy: 176, cols: 6, rows: 4, serial: 301, owner: ZoneFaction.WILD },
  { cx: 304, cy: 92, cols: 5, rows: 4, serial: 302, owner: ZoneFaction.SCIENTIST },
  { cx: 486, cy: 120, cols: 6, rows: 4, serial: 303, owner: ZoneFaction.CULTIST },
  { cx: 742, cy: 166, cols: 6, rows: 5, serial: 304, owner: ZoneFaction.WILD },
  { cx: 918, cy: 308, cols: 5, rows: 4, serial: 305, owner: ZoneFaction.LIQUIDATOR },
  { cx: 808, cy: 438, cols: 6, rows: 4, serial: 306, owner: ZoneFaction.WILD },
  { cx: 906, cy: 704, cols: 6, rows: 5, serial: 307, owner: ZoneFaction.CULTIST },
  { cx: 742, cy: 884, cols: 5, rows: 4, serial: 308, owner: ZoneFaction.WILD },
  { cx: 552, cy: 908, cols: 6, rows: 4, serial: 309, owner: ZoneFaction.CULTIST },
  { cx: 352, cy: 842, cols: 6, rows: 5, serial: 310, owner: ZoneFaction.WILD },
  { cx: 162, cy: 714, cols: 5, rows: 4, serial: 311, owner: ZoneFaction.WILD },
  { cx: 112, cy: 492, cols: 5, rows: 4, serial: 312, owner: ZoneFaction.CITIZEN },
  { cx: 274, cy: 358, cols: 6, rows: 4, serial: 313, owner: ZoneFaction.CITIZEN },
  { cx: 884, cy: 96, cols: 5, rows: 4, serial: 314, owner: ZoneFaction.LIQUIDATOR },
  { cx: 1008, cy: 898, cols: 4, rows: 4, serial: 315, owner: ZoneFaction.WILD },
  { cx: 42, cy: 222, cols: 4, rows: 4, serial: 316, owner: ZoneFaction.WILD },
  { cx: 222, cy: 246, cols: 5, rows: 5, serial: 317, owner: ZoneFaction.CITIZEN },
  { cx: 720, cy: 278, cols: 6, rows: 4, serial: 318, owner: ZoneFaction.SCIENTIST },
  { cx: 676, cy: 782, cols: 6, rows: 5, serial: 319, owner: ZoneFaction.CULTIST },
  { cx: 412, cy: 724, cols: 5, rows: 4, serial: 320, owner: ZoneFaction.WILD },
];

const VOID_HQ_SPECS: readonly VoidHqSpec[] = [
  { owner: ZoneFaction.CITIZEN, name: 'Гражданский карман заемного света', cx: 254, cy: 448, w: 15, h: 10, supportSerial: 401 },
  { owner: ZoneFaction.LIQUIDATOR, name: 'Ликвидаторский пост последнего лифта', cx: 944, cy: 484, w: 17, h: 11, supportSerial: 402 },
  { owner: ZoneFaction.CULTIST, name: 'Культовый хор пустого ребра', cx: 812, cy: 776, w: 17, h: 12, supportSerial: 403 },
  { owner: ZoneFaction.SCIENTIST, name: 'НИИ отрицательной комнаты', cx: 584, cy: 234, w: 16, h: 11, supportSerial: 404 },
  { owner: ZoneFaction.WILD, name: 'Дикий узел выбитых дверей', cx: 166, cy: 650, w: 21, h: 13, supportSerial: 405 },
];

const VOID_ROOM_TYPE_SEQUENCE: readonly RoomType[] = [
  RoomType.STORAGE,
  RoomType.OFFICE,
  RoomType.COMMON,
  RoomType.PRODUCTION,
  RoomType.BATHROOM,
  RoomType.KITCHEN,
  RoomType.MEDICAL,
  RoomType.SMOKING,
];

const VOID_REVEAL_SHELLS: readonly (readonly [number, number, number, number])[] = [
  [SPAWN_X, SPAWN_Y, 18, 0.34],
  [SPAWN_X, SPAWN_Y - 21, 28, 0.56],
  [462, 520, 22, 0.32],
  [548, 576, 20, 0.42],
  [602, 525, 24, 0.38],
  [650, 558, 16, 0.26],
  [684, 558, 26, 0.52],
  [948, 620, 18, 0.24],
] as const;

const VOID_ROUTE_ANCHOR_POINTS: readonly (readonly [number, number])[] = [
  VOID_GEOMETRY_ANCHORS.spawn,
  VOID_GEOMETRY_ANCHORS.lightPocket,
  VOID_GEOMETRY_ANCHORS.listeningRoute,
  VOID_GEOMETRY_ANCHORS.fastCrossing,
  VOID_GEOMETRY_ANCHORS.fallbackBridge,
  VOID_GEOMETRY_ANCHORS.protocolFrame,
  VOID_GEOMETRY_ANCHORS.boss,
] as const;

const VOID_PROXY_GRID_SIZE = 64;
const VOID_PROXY_PASSABLE_RATIO = 0.012;

function hash2(x: number, y: number, seed: number): number {
  let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177)) | 0;
  n = Math.imul(n ^ (n >> 13), 1103515245);
  n ^= n >> 16;
  return (n & 0x7fffffff) / 0x7fffffff;
}

function setVoidFloor(world: World, x: number, y: number): void {
  const i = world.idx(x, y);
  if (world.cells[i] === Cell.LIFT) return;
  world.cells[i] = Cell.FLOOR;
  world.roomMap[i] = -1;
  world.floorTex[i] = Tex.F_VOID;
  world.wallTex[i] = 0;
}

function setVoidWall(world: World, x: number, y: number): void {
  const i = world.idx(x, y);
  if (world.cells[i] === Cell.LIFT) return;
  world.cells[i] = Cell.WALL;
  world.roomMap[i] = -1;
  world.wallTex[i] = Tex.VOID_WALL;
  world.floorTex[i] = 0;
  world.features[i] = Feature.NONE;
}

function carveDisk(world: World, cx: number, cy: number, radius: number): void {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= r2) setVoidFloor(world, cx + dx, cy + dy);
    }
  }
}

function carveEllipse(world: World, spec: IslandSpec): void {
  for (let dy = -spec.ry; dy <= spec.ry; dy++) {
    for (let dx = -spec.rx; dx <= spec.rx; dx++) {
      const nx = dx / (spec.rx + 0.35);
      const ny = dy / (spec.ry + 0.35);
      if (nx * nx + ny * ny <= 1) setVoidFloor(world, spec.cx + dx, spec.cy + dy);
    }
  }

  const shards = 3 + (spec.shardSeed % 4);
  for (let s = 0; s < shards; s++) {
    const ax = spec.cx + Math.round(Math.cos((spec.shardSeed + s) * 1.72) * spec.rx * 0.52);
    const ay = spec.cy + Math.round(Math.sin((spec.shardSeed + s) * 1.31) * spec.ry * 0.52);
    if (Math.abs(world.delta(ax, spec.cx)) < 4 && Math.abs(world.delta(ay, spec.cy)) < 4) continue;
    setVoidWall(world, ax, ay);
    if (s % 2 === 0) setVoidWall(world, ax + 1, ay);
    else setVoidWall(world, ax, ay + 1);
  }
}

function carveWideCell(world: World, x: number, y: number, width: number): void {
  for (let dy = -width; dy <= width; dy++) {
    for (let dx = -width; dx <= width; dx++) {
      if (Math.abs(dx) + Math.abs(dy) <= width + 1) setVoidFloor(world, x + dx, y + dy);
    }
  }
}

function carveBand(world: World, ax: number, ay: number, bx: number, by: number, width: number): void {
  const ddx = world.delta(ax, bx);
  const ddy = world.delta(ay, by);
  const steps = Math.max(Math.abs(ddx), Math.abs(ddy), 1);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = world.wrap(Math.round(ax + ddx * t));
    const y = world.wrap(Math.round(ay + ddy * t));
    carveWideCell(world, x, y, width);
  }
}

function carvePath(world: World, points: readonly (readonly [number, number])[], width: number): void {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    carveBand(world, a[0], a[1], b[0], b[1], width);
  }
}

function carveEchoAlcoves(world: World): void {
  for (let i = 0; i < 5; i++) {
    const x = 462 - i * 7;
    const y = 520 + (i % 2) * 16;
    carveBand(world, x, y, x + 9, y, 2);
    setVoidWall(world, x + 4, y - 1);
    setVoidWall(world, x + 4, y + 1);
  }
  for (let i = 0; i < 4; i++) {
    const x = worldWrapLiteral(986 + i * 9);
    carveBand(world, x, 504, x, 516, 1);
    world.features[world.idx(x, 516)] = Feature.SCREEN;
  }
}

function worldWrapLiteral(v: number): number {
  return ((v % W) + W) % W;
}

function openDoor(world: World, x: number, y: number): void {
  const door = world.doors.get(world.idx(x, y));
  if (door) {
    door.state = DoorState.HERMETIC_OPEN;
    door.timer = 0;
  }
}

function setRoomVoidTextures(world: World, room: Room): void {
  room.wallTex = Tex.VOID_WALL;
  room.floorTex = Tex.F_VOID;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const i = world.idx(room.x + dx, room.y + dy);
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) world.floorTex[i] = Tex.F_VOID;
      else world.wallTex[i] = Tex.VOID_WALL;
    }
  }
}

function setVoidConnectorFloor(world: World, x: number, y: number): void {
  const i = world.idx(x, y);
  if (world.cells[i] === Cell.LIFT || world.cells[i] === Cell.DOOR || world.roomMap[i] >= 0) return;
  world.cells[i] = Cell.FLOOR;
  world.roomMap[i] = -1;
  world.floorTex[i] = Tex.F_VOID;
  world.wallTex[i] = 0;
  world.hermoWall[i] = 0;
}

function carveVoidConnectorBand(world: World, ax: number, ay: number, bx: number, by: number, width: number): void {
  const ddx = world.delta(ax, bx);
  const ddy = world.delta(ay, by);
  const steps = Math.max(Math.abs(ddx), Math.abs(ddy), 1);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = world.wrap(Math.round(ax + ddx * t));
    const y = world.wrap(Math.round(ay + ddy * t));
    for (let dy = -width; dy <= width; dy++) {
      for (let dx = -width; dx <= width; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > width + 1) continue;
        setVoidConnectorFloor(world, x + dx, y + dy);
      }
    }
  }
}

function roomFootprintAvailable(world: World, x: number, y: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const idx = world.idx(x + dx, y + dy);
      if (world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.DOOR) return false;
      if (world.roomMap[idx] >= 0) return false;
    }
  }
  return true;
}

function paintOwnedVoidRoom(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[idx] === room.id) world.factionControl[idx] = owner;
    }
  }
  for (const doorIdx of room.doors) world.factionControl[doorIdx] = owner;
}

function decorateVoidRoom(world: World, room: Room, serial: number): void {
  const midX = room.x + (room.w >> 1);
  const midY = room.y + (room.h >> 1);
  const first = world.idx(midX, midY);
  if (world.features[first] === Feature.NONE) {
    if (room.type === RoomType.KITCHEN) world.features[first] = Feature.STOVE;
    else if (room.type === RoomType.BATHROOM) world.features[first] = Feature.TOILET;
    else if (room.type === RoomType.MEDICAL) world.features[first] = Feature.APPARATUS;
    else if (room.type === RoomType.PRODUCTION) world.features[first] = Feature.MACHINE;
    else if (room.type === RoomType.OFFICE) world.features[first] = Feature.DESK;
    else world.features[first] = Feature.SHELF;
  }
  const second = world.idx(room.x + 1 + (serial % Math.max(1, room.w - 2)), room.y + 1);
  if (world.features[second] === Feature.NONE) {
    world.features[second] = serial % 5 === 0 ? Feature.SCREEN : Feature.TABLE;
  }
}

function stampOwnedVoidRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  owner: TerritoryOwner,
  name: string,
  serial: number,
): Room | null {
  if (!roomFootprintAvailable(world, x, y, w, h)) return null;
  const room = stampRoom(world, world.rooms.length, type, x, y, w, h, -1);
  room.name = name;
  setRoomVoidTextures(world, room);
  paintOwnedVoidRoom(world, room, owner);
  decorateVoidRoom(world, room, serial);
  return room;
}

function connectVoidRoomToHub(world: World, room: Room, hubX: number, hubY: number, hermetic = false): void {
  const centerX = room.x + (room.w >> 1);
  const centerY = room.y + (room.h >> 1);
  let doorX = centerX;
  let doorY = room.y + room.h;
  let outsideX = doorX;
  let outsideY = doorY + 1;

  if (Math.abs(world.delta(centerX, hubX)) > Math.abs(world.delta(centerY, hubY))) {
    if (world.delta(centerX, hubX) > 0) {
      doorX = room.x + room.w;
      outsideX = doorX + 1;
    } else {
      doorX = room.x - 1;
      outsideX = doorX - 1;
    }
    doorY = centerY;
    outsideY = doorY;
  } else if (world.delta(centerY, hubY) < 0) {
    doorY = room.y - 1;
    outsideY = doorY - 1;
  }

  carveVoidConnectorBand(world, outsideX, outsideY, hubX, hubY, 0);
  placeDoorAt(world, doorX, doorY, room.id);
  if (hermetic) openDoor(world, doorX, doorY);
  paintOwnedVoidRoom(world, room, world.factionControl[world.idx(centerX, centerY)] as TerritoryOwner);
}

function voidRoomTypeFor(serial: number, row: number, col: number): RoomType {
  return VOID_ROOM_TYPE_SEQUENCE[(serial + row * 3 + col * 5) % VOID_ROOM_TYPE_SEQUENCE.length];
}

function addShelterRoom(world: World): void {
  const room = stampRoom(world, world.rooms.length, RoomType.OFFICE, SPAWN_X - 10, SPAWN_Y - 27, 20, 11, -1);
  room.name = 'Световой карман';
  setRoomVoidTextures(world, room);
  const doorX = room.x + (room.w >> 1);
  const doorY = room.y + room.h;
  placeDoorAt(world, doorX, doorY, room.id);
  openDoor(world, doorX, doorY);
  carveBand(world, SPAWN_X, SPAWN_Y - 3, doorX, doorY + 1, 2);

  for (let x = room.x + 3; x < room.x + room.w - 3; x += 4) {
    world.features[world.idx(x, room.y + 2)] = Feature.LAMP;
  }
  world.features[world.idx(room.x + 2, room.y + room.h - 3)] = Feature.SHELF;
  world.features[world.idx(room.x + room.w - 3, room.y + room.h - 3)] = Feature.DESK;
}

function addProtocolFrame(world: World): void {
  const room = stampRoom(world, world.rooms.length, RoomType.OFFICE, 594, 520, 17, 11, -1);
  room.name = 'Пустотный повторитель';
  setRoomVoidTextures(world, room);
  const westDoorY = room.y + (room.h >> 1);
  const southDoorX = room.x + (room.w >> 1);
  placeDoorAt(world, room.x - 1, westDoorY, room.id);
  placeDoorAt(world, southDoorX, room.y + room.h, room.id);
  openDoor(world, room.x - 1, westDoorY);
  openDoor(world, southDoorX, room.y + room.h);
  carveBand(world, 592, 560, room.x - 2, westDoorY, 2);
  carveBand(world, southDoorX, room.y + room.h + 1, 616, 560, 2);

  for (let dx = 2; dx < room.w - 2; dx += 3) {
    world.features[world.idx(room.x + dx, room.y + 2)] = Feature.SCREEN;
    world.features[world.idx(room.x + dx, room.y + room.h - 3)] = Feature.APPARATUS;
  }
}

function addShelterNiches(world: World): void {
  for (const [x, y] of [[548, 576], [650, 544], [72, 636]] as const) {
    carveDisk(world, x, y, 5);
    world.features[world.idx(x, y)] = Feature.LAMP;
    world.features[world.idx(x + 2, y)] = Feature.SHELF;
  }
}

function addBossLane(world: World): void {
  carveBand(world, 616, 558, 684, 558, 3);
  for (let x = 624; x <= 676; x += 8) {
    world.features[world.idx(x, 555)] = Feature.LAMP;
    world.features[world.idx(x, 561)] = Feature.LAMP;
    if ((x / 8) % 2 === 0) {
      setVoidWall(world, x, 552);
      setVoidWall(world, x, 564);
    }
  }
}

function addReturnFrame(world: World, bossX: number, bossY: number): void {
  for (let a = 0; a < 24; a++) {
    const angle = (a / 24) * Math.PI * 2;
    const x = bossX + Math.round(Math.cos(angle) * 8);
    const y = bossY + Math.round(Math.sin(angle) * 6);
    const i = world.idx(x, y);
    if (world.cells[i] === Cell.FLOOR) {
      world.features[i] = a % 3 === 0 ? Feature.LAMP : Feature.SCREEN;
    }
  }
  world.features[world.idx(bossX - 10, bossY)] = Feature.APPARATUS;
  world.features[world.idx(bossX + 10, bossY)] = Feature.APPARATUS;
}

function placeLift(world: World, x: number, y: number, buttonX: number, buttonY: number, direction: LiftDirection): void {
  const liftIdx = world.idx(x, y);
  world.cells[liftIdx] = Cell.LIFT;
  world.wallTex[liftIdx] = Tex.LIFT_DOOR;
  world.liftDir[liftIdx] = direction;
  const buttonIdx = world.idx(buttonX, buttonY);
  if (world.cells[buttonIdx] === Cell.FLOOR) {
    world.features[buttonIdx] = Feature.LIFT_BUTTON;
    world.liftDir[buttonIdx] = direction;
  }
}

function placeVoidLifts(world: World): void {
  carveBand(world, SPAWN_X - 17, SPAWN_Y + 8, SPAWN_X - 11, SPAWN_Y + 8, 2);
  placeLift(world, SPAWN_X - 20, SPAWN_Y + 8, SPAWN_X - 19, SPAWN_Y + 8, LiftDirection.DOWN);
  carveBand(world, 700, 570, 708, 570, 2);
  placeLift(world, 711, 570, 710, 570, LiftDirection.UP);
}

function buildVoidProtectedMask(world: World): Uint8Array {
  const mask = new Uint8Array(W * W);
  for (const room of world.rooms) {
    for (let y = room.y - 1; y <= room.y + room.h; y++) {
      for (let x = room.x - 1; x <= room.x + room.w; x++) mask[world.idx(x, y)] = 1;
    }
  }
  for (const idx of world.doors.keys()) mask[idx] = 1;
  for (let i = 0; i < W * W; i++) if (world.cells[i] === Cell.LIFT) mask[i] = 1;
  for (let i = 0; i < W * W; i++) if (world.features[i] !== Feature.NONE) mask[i] = 1;
  return mask;
}

function isVoidGraphWalkable(world: World, idx: number): boolean {
  const cell = world.cells[idx];
  return cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.WATER;
}

interface VoidComponentGraph {
  label: Int32Array;
  sizes: number[];
  samples: number[][];
  largestId: number;
}

interface VoidProxyComponentGraph {
  grid: ProxyGrid;
  passable: Uint8Array;
  label: Int32Array;
  sizes: number[];
  samples: number[][];
  largestId: number;
}

function extractVoidComponentGraph(world: World): VoidComponentGraph {
  const n = W * W;
  const label = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  const sizes: number[] = [];
  const samples: number[][] = [];
  let largestId = -1;
  let largestSize = 0;

  for (let i = 0; i < n; i++) {
    if (label[i] >= 0 || !isVoidGraphWalkable(world, i)) continue;
    const id = sizes.length;
    const sample: number[] = [i];
    let head = 0;
    let tail = 0;
    let size = 0;
    label[i] = id;
    queue[tail++] = i;

    while (head < tail) {
      const ci = queue[head++];
      const x = ci % W;
      const y = (ci / W) | 0;
      size++;
      if (sample.length < 48 || (size & 127) === 0) sample.push(ci);

      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
        const ni = world.idx(x + dx, y + dy);
        if (label[ni] >= 0 || !isVoidGraphWalkable(world, ni)) continue;
        label[ni] = id;
        queue[tail++] = ni;
      }
    }

    sizes.push(size);
    samples.push(sample);
    if (size > largestSize) {
      largestSize = size;
      largestId = id;
    }
  }

  return { label, sizes, samples, largestId };
}

function nearestVoidSamplePair(
  world: World,
  from: readonly number[],
  to: readonly number[],
): readonly [number, number] {
  let bestA = from[0] ?? 0;
  let bestB = to[0] ?? 0;
  let bestD = Infinity;
  for (const a of from) {
    const ax = a % W;
    const ay = (a / W) | 0;
    for (const b of to) {
      const bx = b % W;
      const by = (b / W) | 0;
      const d = Math.abs(world.delta(ax, bx)) + Math.abs(world.delta(ay, by));
      if (d < bestD) {
        bestD = d;
        bestA = a;
        bestB = b;
      }
    }
  }
  return [bestA, bestB];
}

function markVoidBridgeCues(world: World, ax: number, ay: number, bx: number, by: number, serial: number): void {
  const ddx = world.delta(ax, bx);
  const ddy = world.delta(ay, by);
  const steps = Math.max(1, Math.abs(ddx), Math.abs(ddy));
  const gap = 18 + (serial % 5) * 3;
  for (let step = gap; step < steps; step += gap) {
    const x = world.wrap(Math.round(ax + (ddx * step) / steps));
    const y = world.wrap(Math.round(ay + (ddy * step) / steps));
    const ci = world.idx(x, y);
    if (world.cells[ci] !== Cell.FLOOR || world.features[ci] !== Feature.NONE) continue;
    world.features[ci] = serial % 2 === 0 ? Feature.CANDLE : Feature.APPARATUS;
  }
}

function extractVoidProxyPercolationGraph(world: World): VoidProxyComponentGraph {
  const grid = createProxyGrid(VOID_PROXY_GRID_SIZE, 0x140014);
  const total = grid.size * grid.size;
  const passable = new Uint8Array(total);
  const label = new Int32Array(total).fill(-1);
  const queue = new Int32Array(total);
  const sizes: number[] = [];
  const samples: number[][] = [];
  let largestId = -1;
  let largestSize = 0;

  for (const descriptor of extractProxyDescriptors(world, grid)) {
    if (descriptor.passableRatio >= VOID_PROXY_PASSABLE_RATIO) passable[descriptor.index] = 1;
  }

  for (let i = 0; i < total; i++) {
    if (label[i] >= 0 || !passable[i]) continue;
    const id = sizes.length;
    const sample: number[] = [i];
    let head = 0;
    let tail = 0;
    let size = 0;
    label[i] = id;
    queue[tail++] = i;

    while (head < tail) {
      const ci = queue[head++];
      const x = ci % grid.size;
      const y = (ci / grid.size) | 0;
      size++;
      if (sample.length < 32 || (size & 31) === 0) sample.push(ci);

      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
        const ni = proxyIndex(grid, x + dx, y + dy);
        if (label[ni] >= 0 || !passable[ni]) continue;
        label[ni] = id;
        queue[tail++] = ni;
      }
    }

    sizes.push(size);
    samples.push(sample);
    if (size > largestSize) {
      largestSize = size;
      largestId = id;
    }
  }

  return { grid, passable, label, sizes, samples, largestId };
}

function nearestVoidProxySamplePair(
  world: World,
  grid: ProxyGrid,
  from: readonly number[],
  to: readonly number[],
): readonly [number, number] {
  let bestA = from[0] ?? 0;
  let bestB = to[0] ?? 0;
  let bestD = Infinity;
  for (const a of from) {
    const ac = proxyCellCenter(grid, a % grid.size, (a / grid.size) | 0);
    for (const b of to) {
      const bc = proxyCellCenter(grid, b % grid.size, (b / grid.size) | 0);
      const d = world.dist2(ac.x, ac.y, bc.x, bc.y);
      if (d < bestD) {
        bestD = d;
        bestA = a;
        bestB = b;
      }
    }
  }
  return [bestA, bestB];
}

function carveVoidProxyBridge(world: World, mask: Uint8Array, graph: VoidProxyComponentGraph, from: number, to: number, serial: number): void {
  const a = proxyCellCenter(graph.grid, from % graph.grid.size, (from / graph.grid.size) | 0);
  const b = proxyCellCenter(graph.grid, to % graph.grid.size, (to / graph.grid.size) | 0);
  carveVoidFoldRoute(world, mask, Math.round(a.x), Math.round(a.y), Math.round(b.x), Math.round(b.y), serial);
  markVoidBridgeCues(world, Math.round(a.x), Math.round(a.y), Math.round(b.x), Math.round(b.y), serial);
}

function bridgeVoidProxyPercolation(world: World): void {
  let graph = extractVoidProxyPercolationGraph(world);
  if (graph.sizes.length <= 1 || graph.largestId < 0) return;

  const mask = buildVoidProtectedMask(world);
  const mainSamples = graph.samples[graph.largestId].slice();
  const bridgedComponents = new Set<number>([graph.largestId]);

  for (let i = 0; i < VOID_ROUTE_ANCHOR_POINTS.length; i++) {
    const anchor = VOID_ROUTE_ANCHOR_POINTS[i];
    const proxy = worldToProxy(graph.grid, anchor[0], anchor[1]).index;
    const componentId = graph.label[proxy];
    if (componentId < 0 || bridgedComponents.has(componentId)) continue;
    const [from, to] = nearestVoidProxySamplePair(world, graph.grid, graph.samples[componentId], mainSamples);
    carveVoidProxyBridge(world, mask, graph, from, to, 150 + i);
    mainSamples.push(...graph.samples[componentId].slice(0, 12));
    bridgedComponents.add(componentId);
  }

  graph = extractVoidProxyPercolationGraph(world);
  const refreshedMainSamples = graph.largestId >= 0 ? graph.samples[graph.largestId].slice() : mainSamples;
  const componentIds = graph.sizes
    .map((size, id) => ({ id, size }))
    .filter(component => component.id !== graph.largestId)
    .sort((a, b) => b.size - a.size);

  for (const component of componentIds) {
    const [from, to] = nearestVoidProxySamplePair(world, graph.grid, graph.samples[component.id], refreshedMainSamples);
    carveVoidProxyBridge(world, mask, graph, from, to, 170 + component.id);
    refreshedMainSamples.push(...graph.samples[component.id].slice(0, 12));
  }
}

function bridgeVoidPercolationComponents(world: World): void {
  for (let pass = 0; pass < 4; pass++) {
    const graph = extractVoidComponentGraph(world);
    if (graph.sizes.length <= 1 || graph.largestId < 0) return;

    const mask = buildVoidProtectedMask(world);
    const mainSamples = graph.samples[graph.largestId].slice();
    const componentIds = graph.sizes
      .map((size, id) => ({ id, size }))
      .filter(component => component.id !== graph.largestId)
      .sort((a, b) => b.size - a.size);

    for (const component of componentIds) {
      const [from, to] = nearestVoidSamplePair(world, graph.samples[component.id], mainSamples);
      const ax = from % W;
      const ay = (from / W) | 0;
      const bx = to % W;
      const by = (to / W) | 0;
      carveVoidFoldRoute(world, mask, ax, ay, bx, by, 100 + pass * 17 + component.id);
      carveWideCell(world, ax, ay, 1);
      carveWideCell(world, bx, by, 1);
      markVoidBridgeCues(world, ax, ay, bx, by, component.id);
      mainSamples.push(...graph.samples[component.id].slice(0, 16));
    }
  }
}

function carveVoidFootprintBand(
  world: World,
  mask: Uint8Array,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
): void {
  if (ax === bx) {
    const from = Math.min(ay, by);
    const to = Math.max(ay, by);
    for (let y = from; y <= to; y++) carveVoidFootprintDisc(world, mask, ax, y, radius);
    return;
  }
  if (ay === by) {
    const from = Math.min(ax, bx);
    const to = Math.max(ax, bx);
    for (let x = from; x <= to; x++) carveVoidFootprintDisc(world, mask, x, ay, radius);
    return;
  }

  const ddx = world.delta(ax, bx);
  const ddy = world.delta(ay, by);
  const steps = Math.max(1, Math.abs(ddx), Math.abs(ddy));
  for (let step = 0; step <= steps; step++) {
    const x = world.wrap(Math.round(ax + (ddx * step) / steps));
    const y = world.wrap(Math.round(ay + (ddy * step) / steps));
    carveVoidFootprintDisc(world, mask, x, y, radius);
  }
}

function clampVoidPoint(x: number, y: number): [number, number] {
  return [
    Math.max(0, Math.min(W - 1, Math.round(x))),
    Math.max(0, Math.min(W - 1, Math.round(y))),
  ];
}

function carveVoidFoldRoute(world: World, mask: Uint8Array, ax: number, ay: number, bx: number, by: number, serial: number): void {
  const [mx1, my1] = clampVoidPoint(ax + (bx - ax) * 0.34 + Math.sin(serial * 1.7) * 74, ay + (by - ay) * 0.24);
  const [mx2, my2] = clampVoidPoint(ax + (bx - ax) * 0.68, ay + (by - ay) * 0.72 + Math.cos(serial * 1.31) * 82);
  const pts: readonly (readonly [number, number])[] = [[ax, ay], [mx1, my1], [mx2, my2], [bx, by]];
  for (let i = 1; i < pts.length; i++) {
    carveVoidFootprintBand(world, mask, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], serial % 3 === 0 ? 2 : 1);
  }
}

function carveVoidFootprintDisc(world: World, mask: Uint8Array, cx: number, cy: number, radius: number): void {
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
        world.cells[ci] = Cell.FLOOR;
        world.roomMap[ci] = -1;
        world.floorTex[ci] = Tex.F_VOID;
        world.wallTex[ci] = 0;
        world.hermoWall[ci] = 0;
      } else if (world.cells[ci] === Cell.WALL || world.cells[ci] === Cell.ABYSS) {
        world.cells[ci] = Cell.WALL;
        world.roomMap[ci] = -1;
        world.wallTex[ci] = Tex.VOID_WALL;
        world.floorTex[ci] = Tex.F_VOID;
        world.features[ci] = Feature.NONE;
        world.hermoWall[ci] = 0;
      }
    }
  }
}

function carveVoidChaosPocket(world: World, mask: Uint8Array, spec: ChaosPocketSpec): void {
  const innerR2 = spec.radius * spec.radius;
  const outer = spec.radius + 3;
  const outerR2 = outer * outer;
  for (let dy = -outer; dy <= outer; dy++) {
    for (let dx = -outer; dx <= outer; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > outerR2) continue;
      const x = spec.x + dx;
      const y = spec.y + dy;
      const ci = world.idx(x, y);
      if (mask[ci] || world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR) continue;
      if (d2 <= innerR2) {
        const n = hash2(world.wrap(x) >> 2, world.wrap(y) >> 2, spec.serial);
        if (d2 < innerR2 * 0.68 || n > 0.18) {
          world.cells[ci] = Cell.FLOOR;
          world.roomMap[ci] = -1;
          world.floorTex[ci] = Tex.F_VOID;
          world.wallTex[ci] = 0;
          world.hermoWall[ci] = 0;
        }
      } else if (world.cells[ci] !== Cell.FLOOR) {
        world.cells[ci] = Cell.WALL;
        world.roomMap[ci] = -1;
        world.wallTex[ci] = Tex.VOID_WALL;
        world.floorTex[ci] = Tex.F_VOID;
        world.hermoWall[ci] = 0;
      }
    }
  }
}

function setChaosWall(world: World, mask: Uint8Array, x: number, y: number): void {
  const ci = world.idx(x, y);
  if (mask[ci] || world.cells[ci] !== Cell.FLOOR || world.features[ci] !== Feature.NONE) return;
  world.cells[ci] = Cell.WALL;
  world.roomMap[ci] = -1;
  world.wallTex[ci] = Tex.VOID_WALL;
  world.floorTex[ci] = Tex.F_VOID;
  world.features[ci] = Feature.NONE;
  world.hermoWall[ci] = 0;
}

function stampChaosSpiral(world: World, mask: Uint8Array, spec: ChaosPocketSpec): void {
  const turns = 3 + (spec.serial % 3);
  const steps = spec.radius * 18;
  const phase = spec.serial * 0.37;
  for (let step = 10; step < steps; step++) {
    if (step % 19 === 0 || step % 23 === 0) continue;
    const t = step / steps;
    const angle = phase + t * Math.PI * 2 * turns;
    const r = 3 + t * (spec.radius - 4);
    const x = spec.x + Math.round(Math.cos(angle) * r);
    const y = spec.y + Math.round(Math.sin(angle) * r);
    setChaosWall(world, mask, x, y);
    if (step % 4 === 0) setChaosWall(world, mask, x + 1, y);
    if (step % 7 === 0) setChaosWall(world, mask, x, y + 1);
  }
}

function stampChaosRing(world: World, mask: Uint8Array, spec: ChaosPocketSpec): void {
  const radius = Math.max(6, spec.radius - 5);
  for (let a = 0; a < 128; a++) {
    if ((a + spec.serial) % 17 === 0) continue;
    const angle = (a / 128) * Math.PI * 2;
    const x = spec.x + Math.round(Math.cos(angle) * radius);
    const y = spec.y + Math.round(Math.sin(angle) * radius * 0.72);
    setChaosWall(world, mask, x, y);
    if (a % 5 === 0) setChaosWall(world, mask, x, y + 1);
  }
}

function stampChaosCross(world: World, mask: Uint8Array, spec: ChaosPocketSpec): void {
  const radius = Math.max(8, spec.radius - 3);
  for (let d = -radius; d <= radius; d++) {
    if (Math.abs(d) < 3 || (d + spec.serial) % 11 === 0) continue;
    setChaosWall(world, mask, spec.x + d, spec.y);
    setChaosWall(world, mask, spec.x, spec.y + d);
    if (Math.abs(d) % 5 === 0) {
      setChaosWall(world, mask, spec.x + d, spec.y + Math.sign(d || 1));
      setChaosWall(world, mask, spec.x + Math.sign(d || 1), spec.y + d);
    }
  }
}

function stampChaosDiamond(world: World, mask: Uint8Array, spec: ChaosPocketSpec): void {
  const radius = Math.max(7, spec.radius - 5);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const edge = Math.abs(dx) + Math.abs(dy);
      if (edge !== radius && edge !== radius - 1) continue;
      if ((dx * 13 + dy * 7 + spec.serial) % 19 === 0) continue;
      setChaosWall(world, mask, spec.x + dx, spec.y + dy);
    }
  }
}

function stampChaosLine(world: World, mask: Uint8Array, spec: ChaosPocketSpec): void {
  const len = spec.radius * 3;
  const angle = hash2(spec.x, spec.y, spec.serial) * Math.PI * 2;
  for (let s = -len; s <= len; s++) {
    if ((s + spec.serial) % 13 === 0) continue;
    const bend = Math.sin((s + spec.serial) * 0.18) * spec.radius * 0.36;
    const x = spec.x + Math.round(Math.cos(angle) * s - Math.sin(angle) * bend);
    const y = spec.y + Math.round(Math.sin(angle) * s + Math.cos(angle) * bend);
    setChaosWall(world, mask, x, y);
    if (s % 6 === 0) setChaosWall(world, mask, x + 1, y);
  }
}

function stampChaosPocketWalls(world: World, mask: Uint8Array, spec: ChaosPocketSpec): void {
  switch (spec.kind) {
    case 'spiral':
      stampChaosSpiral(world, mask, spec);
      break;
    case 'ring':
      stampChaosRing(world, mask, spec);
      break;
    case 'cross':
      stampChaosCross(world, mask, spec);
      break;
    case 'diamond':
      stampChaosDiamond(world, mask, spec);
      break;
    case 'line':
      stampChaosLine(world, mask, spec);
      break;
  }
}

function carveChaosSpiralTendril(world: World, mask: Uint8Array, spec: ChaosPocketSpec): void {
  if (spec.kind !== 'spiral') return;
  const turns = 1.35 + (spec.serial % 3) * 0.32;
  const steps = spec.radius * 12;
  const phase = spec.serial * 0.41;
  let px = world.wrap(spec.x + Math.round(Math.cos(phase) * (spec.radius - 3)));
  let py = world.wrap(spec.y + Math.round(Math.sin(phase) * (spec.radius - 3)));
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const r = spec.radius - 3 + t * spec.radius * 1.85;
    const angle = phase + t * Math.PI * 2 * turns;
    const x = world.wrap(spec.x + Math.round(Math.cos(angle) * r));
    const y = world.wrap(spec.y + Math.round(Math.sin(angle) * r));
    carveVoidFootprintBand(world, mask, px, py, x, y, step % 29 === 0 ? 2 : 1);
    if (step % 41 === 0) carveVoidFootprintDisc(world, mask, x, y, 3);
    px = x;
    py = y;
  }
}

function expandVoidChaoticGeometry(world: World): void {
  const mask = buildVoidProtectedMask(world);
  let last: readonly [number, number] = [SPAWN_X, SPAWN_Y];
  for (const spec of VOID_CHAOS_POCKETS) {
    carveVoidFoldRoute(world, mask, last[0], last[1], spec.x, spec.y, spec.serial);
    carveVoidChaosPocket(world, mask, spec);
    last = [spec.x, spec.y];
  }
  for (const [from, to, serial] of VOID_CHAOS_LINKS) {
    const a = VOID_CHAOS_POCKETS[from];
    const b = VOID_CHAOS_POCKETS[to];
    carveVoidFoldRoute(world, mask, a.x, a.y, b.x, b.y, serial);
  }
  carveVoidFoldRoute(world, mask, last[0], last[1], 684, 558, 90);
  for (const spec of VOID_CHAOS_POCKETS) stampChaosPocketWalls(world, mask, spec);
  for (const spec of VOID_CHAOS_POCKETS) carveChaosSpiralTendril(world, mask, spec);
}

function expandVoidAttractorFields(world: World): void {
  const mask = buildVoidProtectedMask(world);
  for (const [cx, cy, radius, serial] of VOID_ATTRACTOR_FIELDS) {
    carveVoidFootprintDisc(world, mask, cx, cy, Math.max(6, Math.floor(radius * 0.18)));
    for (let arm = 0; arm < 3; arm++) {
      const phase = serial * 0.17 + arm * Math.PI * 2 / 3;
      let px = world.wrap(cx + Math.round(Math.cos(phase) * radius * 0.22));
      let py = world.wrap(cy + Math.round(Math.sin(phase) * radius * 0.22));
      const steps = radius * 5;
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        const angle = phase + t * Math.PI * (2.4 + arm * 0.35);
        const wave = Math.sin(t * Math.PI * 5 + serial) * radius * 0.16;
        const r = radius * (0.2 + t * 0.95);
        const x = world.wrap(cx + Math.round(Math.cos(angle) * r - Math.sin(angle) * wave));
        const y = world.wrap(cy + Math.round(Math.sin(angle) * r + Math.cos(angle) * wave));
        carveVoidFootprintBand(world, mask, px, py, x, y, step % 37 === 0 ? 2 : 1);
        if (step % 53 === 0) {
          carveVoidFootprintDisc(world, mask, x, y, 4 + ((serial + arm + step) % 3));
          const ci = world.idx(x, y);
          if (world.cells[ci] === Cell.FLOOR && world.features[ci] === Feature.NONE) {
            world.features[ci] = (serial + step) % 2 === 0 ? Feature.SCREEN : Feature.APPARATUS;
          }
        }
        px = x;
        py = y;
      }
    }

    const ringSpec: ChaosPocketSpec = {
      x: cx,
      y: cy,
      radius: Math.max(14, Math.floor(radius * 0.46)),
      kind: serial % 2 === 0 ? 'ring' : 'diamond',
      serial,
    };
    stampChaosPocketWalls(world, mask, ringSpec);
  }
}

function addVoidMidBlock(world: World, spec: VoidMidBlockSpec): void {
  const spanX = spec.cols * 14 + 18;
  const spanY = spec.rows * 12 + 18;
  carveVoidConnectorBand(world, spec.cx - (spanX >> 1), spec.cy, spec.cx + (spanX >> 1), spec.cy, 2);
  carveVoidConnectorBand(world, spec.cx, spec.cy - (spanY >> 1), spec.cx, spec.cy + (spanY >> 1), 2);
  carveVoidConnectorBand(world, spec.cx - (spanX >> 2), spec.cy - (spanY >> 2), spec.cx + (spanX >> 2), spec.cy + (spanY >> 2), 1);

  for (let row = 0; row < spec.rows; row++) {
    for (let col = 0; col < spec.cols; col++) {
      const gridX = spec.cx - Math.floor(((spec.cols - 1) * 14) / 2) + col * 14;
      const gridY = spec.cy - Math.floor(((spec.rows - 1) * 12) / 2) + row * 12;
      if (Math.abs(world.delta(gridX, spec.cx)) <= 8 && Math.abs(world.delta(gridY, spec.cy)) <= 8) continue;
      const w = 4 + ((spec.serial + row + col * 2) % 4);
      const h = 3 + ((spec.serial + row * 2 + col) % 3);
      const type = voidRoomTypeFor(spec.serial, row, col);
      const room = stampOwnedVoidRoom(
        world,
        type,
        gridX - (w >> 1),
        gridY - (h >> 1),
        w,
        h,
        spec.owner,
        `Пустотный отсек ${spec.serial}-${row + 1}-${col + 1}`,
        spec.serial + row * 17 + col * 29,
      );
      if (room) connectVoidRoomToHub(world, room, spec.cx, spec.cy);
    }
  }

  for (let i = 0; i < 5; i++) {
    const x = world.wrap(spec.cx + Math.round(Math.cos(spec.serial + i * 1.9) * (spanX * 0.38)));
    const y = world.wrap(spec.cy + Math.round(Math.sin(spec.serial * 0.7 + i * 1.4) * (spanY * 0.38)));
    const ci = world.idx(x, y);
    if (world.cells[ci] === Cell.FLOOR && world.features[ci] === Feature.NONE) {
      world.features[ci] = i % 2 === 0 ? Feature.APPARATUS : Feature.SCREEN;
    }
  }
}

function addVoidMidBlocks(world: World): void {
  for (const spec of VOID_MID_BLOCKS) addVoidMidBlock(world, spec);
}

function supportRoomName(owner: TerritoryOwner, type: RoomType, serial: number): string {
  const ownerName =
    owner === ZoneFaction.CITIZEN ? 'граждан' :
    owner === ZoneFaction.LIQUIDATOR ? 'ликвидаторов' :
    owner === ZoneFaction.CULTIST ? 'культа' :
    owner === ZoneFaction.SCIENTIST ? 'НИИ' :
    'диких';
  const typeName =
    type === RoomType.KITCHEN ? 'кухня' :
    type === RoomType.BATHROOM ? 'санузел' :
    type === RoomType.STORAGE ? 'кладовая' :
    type === RoomType.MEDICAL ? 'медпункт' :
    type === RoomType.OFFICE ? 'канцелярия' :
    type === RoomType.PRODUCTION ? 'мастерская' :
    'общая';
  return `Опора ${ownerName}: ${typeName} ${serial}`;
}

function addVoidFactionHq(world: World, spec: VoidHqSpec): void {
  carveVoidConnectorBand(world, spec.cx - 30, spec.cy, spec.cx + 30, spec.cy, 2);
  carveVoidConnectorBand(world, spec.cx, spec.cy - 26, spec.cx, spec.cy + 26, 2);
  const hq = stampOwnedVoidRoom(
    world,
    RoomType.HQ,
    spec.cx - (spec.w >> 1),
    spec.cy - (spec.h >> 1),
    spec.w,
    spec.h,
    spec.owner,
    spec.name,
    spec.supportSerial,
  );
  if (hq) {
    hq.sealed = true;
    connectVoidRoomToHub(world, hq, spec.cx, spec.cy + spec.h + 4, true);
  }

  const supportTypes: readonly RoomType[] = [
    RoomType.KITCHEN,
    RoomType.BATHROOM,
    RoomType.STORAGE,
    RoomType.MEDICAL,
    RoomType.OFFICE,
    RoomType.PRODUCTION,
    RoomType.COMMON,
  ];
  const offsets: readonly (readonly [number, number])[] = [
    [-30, -18],
    [28, -17],
    [-32, 16],
    [31, 17],
    [0, -28],
    [0, 29],
    [41, 0],
  ];
  for (let i = 0; i < supportTypes.length; i++) {
    const type = supportTypes[i];
    const [ox, oy] = offsets[i];
    const w = type === RoomType.COMMON ? 12 : 7 + ((spec.supportSerial + i) % 3);
    const h = type === RoomType.COMMON ? 8 : 5 + ((spec.supportSerial + i * 2) % 3);
    const room = stampOwnedVoidRoom(
      world,
      type,
      spec.cx + ox - (w >> 1),
      spec.cy + oy - (h >> 1),
      w,
      h,
      spec.owner,
      supportRoomName(spec.owner, type, spec.supportSerial + i),
      spec.supportSerial + i * 13,
    );
    if (room) connectVoidRoomToHub(world, room, spec.cx, spec.cy);
  }
}

function addVoidFactionHqs(world: World): void {
  for (const spec of VOID_HQ_SPECS) addVoidFactionHq(world, spec);
}

function markVoidSamosborScars(world: World): void {
  const scars: readonly (readonly [number, number, number, number])[] = [
    [684, 558, 52, 501],
    [676, 782, 58, 502],
    [906, 704, 48, 503],
    [552, 908, 46, 504],
    [42, 222, 44, 505],
    [1008, 898, 50, 506],
    [512, 1023, 42, 507],
  ];
  for (const [cx, cy, radius, serial] of scars) {
    const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const idx = world.idx(cx + dx, cy + dy);
        if (world.cells[idx] === Cell.LIFT) continue;
        const n = hash2(world.wrap(cx + dx) >> 2, world.wrap(cy + dy) >> 2, serial);
        if (d2 > r2 * 0.44 && n < 0.28) continue;
        world.factionControl[idx] = ZoneFaction.SAMOSBOR;
        if (world.cells[idx] === Cell.FLOOR && world.features[idx] === Feature.NONE && n > 0.86) {
          world.features[idx] = n > 0.93 ? Feature.CANDLE : Feature.APPARATUS;
        }
      }
    }
  }
}

function expandVoidMegastructureFootprint(world: World): void {
  const mask = buildVoidProtectedMask(world);
  let last: readonly [number, number] = [SPAWN_X, SPAWN_Y];
  for (let i = 0; i < VOID_REMOTE_POCKETS.length; i++) {
    const pocket = VOID_REMOTE_POCKETS[i];
    carveVoidFoldRoute(world, mask, last[0], last[1], pocket[0], pocket[1], i);
    carveVoidFootprintDisc(world, mask, pocket[0], pocket[1], 7 + (i % 4));
    const ci = world.idx(pocket[0], pocket[1]);
    if (world.cells[ci] === Cell.FLOOR && world.features[ci] === Feature.NONE) {
      world.features[ci] = i % 3 === 0 ? Feature.CANDLE : Feature.APPARATUS;
    }
    last = pocket;
  }
  carveVoidFoldRoute(world, mask, last[0], last[1], SPAWN_X, SPAWN_Y, 40);
}

function addDeadLampRows(world: World): void {
  for (const [ax, ay, bx, by] of VOID_DEAD_LAMP_ROWS) {
    const ddx = world.delta(ax, bx);
    const ddy = world.delta(ay, by);
    const steps = Math.max(1, Math.abs(ddx), Math.abs(ddy));
    for (let step = 0; step <= steps; step += 4) {
      const x = world.wrap(Math.round(ax + (ddx * step) / steps));
      const y = world.wrap(Math.round(ay + (ddy * step) / steps));
      const ci = world.idx(x, y);
      if (world.cells[ci] !== Cell.FLOOR || world.features[ci] !== Feature.NONE) continue;
      world.features[ci] = step % 12 === 0 ? Feature.SCREEN : Feature.APPARATUS;
    }
  }
}

export function applyVoidRevealLighting(world: World): void {
  const n = W * W;
  const seen = new Uint8Array(n);
  const depth = new Uint8Array(n);
  const queue = new Int32Array(n);

  for (const [anchorX, anchorY, radius, strength] of VOID_REVEAL_SHELLS) {
    seen.fill(0);
    depth.fill(0);
    let start = world.idx(anchorX, anchorY);
    if (!isVoidGraphWalkable(world, start)) {
      start = -1;
      for (let r = 1; r <= 10 && start < 0; r++) {
        for (let dy = -r; dy <= r && start < 0; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            const ci = world.idx(anchorX + dx, anchorY + dy);
            if (isVoidGraphWalkable(world, ci)) {
              start = ci;
              break;
            }
          }
        }
      }
    }
    if (start < 0) continue;

    let head = 0;
    let tail = 0;
    seen[start] = 1;
    queue[tail++] = start;

    while (head < tail) {
      const ci = queue[head++];
      const d = depth[ci];
      const glow = strength * (1 - d / Math.max(1, radius));
      if (glow > world.light[ci]) world.light[ci] = glow;
      if (d >= radius) continue;

      const x = ci % W;
      const y = (ci / W) | 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
        const ni = world.idx(x + dx, y + dy);
        if (seen[ni] || !isVoidGraphWalkable(world, ni)) continue;
        seen[ni] = 1;
        depth[ni] = d + 1;
        queue[tail++] = ni;
      }
    }
  }
}

export function paintVoidDefaults(world: World): void {
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.FLOOR || world.cells[i] === Cell.DOOR) {
      if (world.floorTex[i] === 0) world.floorTex[i] = Tex.F_VOID;
      if (world.cells[i] === Cell.FLOOR) world.wallTex[i] = 0;
    } else if (world.cells[i] === Cell.WALL && world.wallTex[i] === 0) {
      world.wallTex[i] = Tex.VOID_WALL;
    }
  }
}

export function buildVoidGeometry(world: World): VoidGeometryLayout {
  for (let i = 0; i < W * W; i++) world.wallTex[i] = Tex.VOID_WALL;

  for (const island of ISLANDS) carveEllipse(world, island);
  for (const path of FOLDED_PATHS) carvePath(world, path, path[0][0] === 616 ? 3 : 1);

  addShelterRoom(world);
  addProtocolFrame(world);
  addShelterNiches(world);
  addBossLane(world);
  addReturnFrame(world, 684, 558);
  carveEchoAlcoves(world);
  placeVoidLifts(world);
  expandVoidMegastructureFootprint(world);
  expandVoidChaoticGeometry(world);
  expandVoidAttractorFields(world);
  addVoidMidBlocks(world);
  addVoidFactionHqs(world);
  markVoidSamosborScars(world);
  bridgeVoidProxyPercolation(world);
  bridgeVoidPercolationComponents(world);
  addDeadLampRows(world);
  paintVoidDefaults(world);

  return {
    spawnX: SPAWN_X + 0.5,
    spawnY: SPAWN_Y + 0.5,
    bossX: 684,
    bossY: 558,
  };
}
