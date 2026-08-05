/* -- Design floor: cantor_pustoty / Кантор пустоты ---------------- */

import {
  AIGoal,
  Cell,
  ContainerKind,
  DoorState,
  EntityType,
  Feature,
  FloorLevel,
  LiftDirection,
  MonsterKind,
  RoomType,
  Tex,
  W,
  ZoneFaction,
  type Entity,
  type Item,
  type Room,
  type TerritoryOwner,
  type WorldContainer,
} from '../../core/types';
import { World, auditReachability } from '../../core/world';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { registerRouteCue } from '../../systems/route_cues';
import { ensureConnectivity, generateZones, placeDoor, sanitizeDoors, stampRoom } from '../shared';
import type { FloorGeneration } from '../floor_manifest';

export const CANTOR_PUSTOTY_ROUTE_ID = 'cantor_pustoty' as const;
export const CANTOR_PUSTOTY_Z = -44 as const;
export const CANTOR_PUSTOTY_BASE_FLOOR = FloorLevel.VOID;

export const CANTOR_PUSTOTY_ROOM_NAMES = {
  entry: 'Кантор пустоты: входной остров досок',
  repair: 'Кантор пустоты: ремонтная полка мостов',
  dust: 'Кантор пустоты: пыльный остров тайника',
  hidden: 'Кантор пустоты: остров без обратного шага',
  upLift: 'Кантор пустоты: верхняя пустотная кабина',
  downLift: 'Кантор пустоты: нижняя пустотная кабина',
} as const;

export interface CantorPustotyMetrics {
  routeId: typeof CANTOR_PUSTOTY_ROUTE_ID;
  z: typeof CANTOR_PUSTOTY_Z;
  recursionDepth: number;
  proxyOpenCells: number;
  componentCountBeforeBridge: number;
  largestComponentBeforeBridge: number;
  bridgedComponents: number;
  bridgeProxyCells: number;
  stashIslandCount: number;
  reachableStashContainers: number;
  abyssCells: number;
  ungatedUpLiftReachable: boolean;
  ungatedDownLiftReachable: boolean;
}

interface Point {
  x: number;
  y: number;
}

interface ProxyComponentGraph {
  label: Int16Array;
  sizes: number[];
  samples: number[][];
  largestId: number;
}

interface CantorBuild {
  mask: Uint8Array;
  bridgeCells: number;
  bridgedComponents: number;
  componentCountBeforeBridge: number;
  largestComponentBeforeBridge: number;
  proxyOpenCells: number;
}

interface CantorRooms {
  entry: Room;
  repair: Room;
  dust: Room;
  hidden: Room;
  upLift: Room;
  downLift: Room;
}

interface CantorHqSpec {
  owner: TerritoryOwner;
  point: Point;
  name: string;
  supportPrefix: string;
  supportTypes: readonly [RoomType, RoomType, RoomType, RoomType];
}

const PROXY_SIZE = 81;
const PROXY_TILE = 12;
const PROXY_ORIGIN = 26;
const RECURSION_DEPTH = 4;
const CENTER_PROXY = 40;

const GAP = 0;
const ISLAND = 1;
const BRIDGE = 2;
const ANCHOR = 3;
const STASH = 4;

const ENTRY_PROXY: Point = { x: CENTER_PROXY, y: CENTER_PROXY };
const UP_PROXY: Point = { x: 13, y: 13 };
const DOWN_PROXY: Point = { x: 67, y: 67 };
const REPAIR_PROXY: Point = { x: 13, y: 67 };
const DUST_PROXY: Point = { x: 67, y: 13 };
const HIDDEN_PROXY: Point = { x: 40, y: 8 };

const CANTOR_HQ_SPECS: readonly CantorHqSpec[] = [
  {
    owner: ZoneFaction.CITIZEN,
    point: { x: 35, y: 43 },
    name: 'Кантор пустоты: гражданский штаб счетчиков шага',
    supportPrefix: 'гражданской полки',
    supportTypes: [RoomType.KITCHEN, RoomType.STORAGE, RoomType.MEDICAL, RoomType.COMMON],
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    point: { x: 18, y: 18 },
    name: 'Кантор пустоты: пост ликвидаторов на верхней скобе',
    supportPrefix: 'ликвидаторской скобы',
    supportTypes: [RoomType.STORAGE, RoomType.OFFICE, RoomType.MEDICAL, RoomType.BATHROOM],
  },
  {
    owner: ZoneFaction.SCIENTIST,
    point: { x: 62, y: 20 },
    name: 'Кантор пустоты: НИИ пыльной меры',
    supportPrefix: 'НИИ пыльной меры',
    supportTypes: [RoomType.OFFICE, RoomType.MEDICAL, RoomType.PRODUCTION, RoomType.STORAGE],
  },
  {
    owner: ZoneFaction.CULTIST,
    point: { x: 40, y: 16 },
    name: 'Кантор пустоты: культовый штаб разрыва',
    supportPrefix: 'культового разрыва',
    supportTypes: [RoomType.COMMON, RoomType.STORAGE, RoomType.KITCHEN, RoomType.SMOKING],
  },
  {
    owner: ZoneFaction.WILD,
    point: { x: 61, y: 62 },
    name: 'Кантор пустоты: дикий штаб обратной лестницы',
    supportPrefix: 'дикой лестницы',
    supportTypes: [RoomType.STORAGE, RoomType.SMOKING, RoomType.COMMON, RoomType.KITCHEN],
  },
];

const CANTOR_MID_PROXIES: readonly Point[] = [
  { x: 23, y: 23 }, { x: 57, y: 23 }, { x: 23, y: 57 }, { x: 57, y: 57 },
  { x: 40, y: 23 }, { x: 23, y: 40 }, { x: 57, y: 40 }, { x: 40, y: 57 },
  { x: 8, y: 40 }, { x: 72, y: 40 }, { x: 40, y: 72 },
  { x: 18, y: 62 }, { x: 62, y: 18 }, { x: 32, y: 66 }, { x: 66, y: 32 },
  { x: 50, y: 50 }, { x: 30, y: 30 },
];

const CANTOR_METRICS = new WeakMap<World, Omit<CantorPustotyMetrics, 'reachableStashContainers' | 'abyssCells' | 'ungatedUpLiftReachable' | 'ungatedDownLiftReachable'>>();

function proxyIdx(x: number, y: number): number {
  return y * PROXY_SIZE + x;
}

function proxyPoint(idx: number): Point {
  return { x: idx % PROXY_SIZE, y: (idx / PROXY_SIZE) | 0 };
}

function proxyCenter(point: Point): Point {
  return {
    x: PROXY_ORIGIN + point.x * PROXY_TILE + (PROXY_TILE >> 1),
    y: PROXY_ORIGIN + point.y * PROXY_TILE + (PROXY_TILE >> 1),
  };
}

function cantorOpen(x: number, y: number): boolean {
  for (let level = 0; level < RECURSION_DEPTH; level++) {
    const scale = 3 ** (RECURSION_DEPTH - level - 1);
    const tx = Math.floor(x / scale) % 3;
    const ty = Math.floor(y / scale) % 3;
    if (level === 0 && (tx === 1 || ty === 1)) return false;
    if (tx === 1 && ty === 1) return false;
  }
  return true;
}

function forceProxyDisk(mask: Uint8Array, point: Point, radius: number, kind: number): void {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = point.x + dx;
      const y = point.y + dy;
      if (x < 0 || x >= PROXY_SIZE || y < 0 || y >= PROXY_SIZE) continue;
      mask[proxyIdx(x, y)] = kind;
    }
  }
}

function buildInitialProxyMask(): Uint8Array {
  const mask = new Uint8Array(PROXY_SIZE * PROXY_SIZE);
  for (let y = 0; y < PROXY_SIZE; y++) {
    for (let x = 0; x < PROXY_SIZE; x++) {
      if (cantorOpen(x, y)) mask[proxyIdx(x, y)] = ISLAND;
    }
  }
  forceProxyDisk(mask, ENTRY_PROXY, 3, ANCHOR);
  forceProxyDisk(mask, UP_PROXY, 3, ANCHOR);
  forceProxyDisk(mask, DOWN_PROXY, 3, ANCHOR);
  forceProxyDisk(mask, REPAIR_PROXY, 3, STASH);
  forceProxyDisk(mask, DUST_PROXY, 3, STASH);
  forceProxyDisk(mask, HIDDEN_PROXY, 2, STASH);
  for (const spec of CANTOR_HQ_SPECS) forceProxyDisk(mask, spec.point, 3, ANCHOR);
  for (const point of CANTOR_MID_PROXIES) forceProxyDisk(mask, point, 2, BRIDGE);
  return mask;
}

function labelProxyComponents(mask: Uint8Array): ProxyComponentGraph {
  const label = new Int16Array(mask.length).fill(-1);
  const sizes: number[] = [];
  const samples: number[][] = [];
  const queue = new Int16Array(mask.length);
  let largestId = -1;

  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === GAP || label[i] >= 0) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    let size = 0;
    const sample: number[] = [];
    label[i] = id;
    queue[tail++] = i;
    while (head < tail) {
      const current = queue[head++];
      size++;
      if (sample.length < 96 && (size === 1 || size % 5 === 0)) sample.push(current);
      const x = current % PROXY_SIZE;
      const y = (current / PROXY_SIZE) | 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= PROXY_SIZE || ny < 0 || ny >= PROXY_SIZE) continue;
        const ni = proxyIdx(nx, ny);
        if (mask[ni] === GAP || label[ni] >= 0) continue;
        label[ni] = id;
        queue[tail++] = ni;
      }
    }
    sizes.push(size);
    samples.push(sample);
    if (largestId < 0 || size > sizes[largestId]) largestId = id;
  }

  return { label, sizes, samples, largestId };
}

function nearestSamplePair(a: readonly number[], b: readonly number[]): [number, number] {
  let bestA = a[0] ?? 0;
  let bestB = b[0] ?? 0;
  let bestD = Infinity;
  for (const ai of a) {
    const ap = proxyPoint(ai);
    for (const bi of b) {
      const bp = proxyPoint(bi);
      const dx = ap.x - bp.x;
      const dy = ap.y - bp.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        bestA = ai;
        bestB = bi;
      }
    }
  }
  return [bestA, bestB];
}

function carveProxyBridge(mask: Uint8Array, from: number, to: number): number {
  const a = proxyPoint(from);
  const b = proxyPoint(to);
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
  let changed = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(a.x + (b.x - a.x) * t);
    const y = Math.round(a.y + (b.y - a.y) * t);
    for (const [dx, dy] of [[0,0], [1,0], [-1,0], [0,1], [0,-1]] as const) {
      const bx = x + dx;
      const by = y + dy;
      if (bx < 0 || bx >= PROXY_SIZE || by < 0 || by >= PROXY_SIZE) continue;
      const idx = proxyIdx(bx, by);
      if (mask[idx] === GAP) changed++;
      if (mask[idx] !== STASH && mask[idx] !== ANCHOR) mask[idx] = BRIDGE;
    }
  }
  return changed;
}

function bridgeImportantComponents(mask: Uint8Array, important: readonly Point[]): { bridgeCells: number; bridgedComponents: number } {
  let bridgeCells = 0;
  let bridgedComponents = 0;
  for (const point of important) {
    const graph = labelProxyComponents(mask);
    if (graph.largestId < 0) break;
    const idx = proxyIdx(point.x, point.y);
    const componentId = graph.label[idx];
    if (componentId < 0 || componentId === graph.largestId) continue;
    const pair = nearestSamplePair(graph.samples[componentId], graph.samples[graph.largestId]);
    bridgeCells += carveProxyBridge(mask, pair[0], pair[1]);
    bridgedComponents++;
  }
  return { bridgeCells, bridgedComponents };
}

function buildCantorProxy(): CantorBuild {
  const mask = buildInitialProxyMask();
  const before = labelProxyComponents(mask);
  const important = [
    ENTRY_PROXY,
    UP_PROXY,
    DOWN_PROXY,
    REPAIR_PROXY,
    DUST_PROXY,
    HIDDEN_PROXY,
    ...CANTOR_HQ_SPECS.map(spec => spec.point),
    ...CANTOR_MID_PROXIES,
  ];
  const bridge = bridgeImportantComponents(mask, important);

  forceProxyDisk(mask, ENTRY_PROXY, 3, ANCHOR);
  forceProxyDisk(mask, UP_PROXY, 3, ANCHOR);
  forceProxyDisk(mask, DOWN_PROXY, 3, ANCHOR);
  forceProxyDisk(mask, REPAIR_PROXY, 3, STASH);
  forceProxyDisk(mask, DUST_PROXY, 3, STASH);
  forceProxyDisk(mask, HIDDEN_PROXY, 2, STASH);
  for (const spec of CANTOR_HQ_SPECS) forceProxyDisk(mask, spec.point, 3, ANCHOR);
  for (const point of CANTOR_MID_PROXIES) forceProxyDisk(mask, point, 2, BRIDGE);

  let proxyOpenCells = 0;
  for (const cell of mask) if (cell !== GAP) proxyOpenCells++;

  return {
    mask,
    bridgeCells: bridge.bridgeCells,
    bridgedComponents: bridge.bridgedComponents,
    componentCountBeforeBridge: before.sizes.length,
    largestComponentBeforeBridge: before.largestId >= 0 ? before.sizes[before.largestId] : 0,
    proxyOpenCells,
  };
}

function paintVoidBase(world: World): void {
  world.cells.fill(Cell.ABYSS);
  world.wallTex.fill(Tex.VOID_WALL);
  world.floorTex.fill(Tex.F_ABYSS);
  world.fog.fill(118);
}

function carveWorldCell(world: World, x: number, y: number, kind: number): void {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.FLOOR;
  world.roomMap[ci] = -1;
  world.hermoWall[ci] = 0;
  world.wallTex[ci] = Tex.VOID_WALL;
  world.floorTex[ci] = kind === BRIDGE ? Tex.F_CONCRETE : kind === ANCHOR ? Tex.F_TILE : Tex.F_VOID;
  world.fog[ci] = kind === BRIDGE ? 48 : kind === STASH ? 74 : 88;
}

function carveProxyMaskToWorld(world: World, mask: Uint8Array): void {
  for (let gy = 0; gy < PROXY_SIZE; gy++) {
    for (let gx = 0; gx < PROXY_SIZE; gx++) {
      const kind = mask[proxyIdx(gx, gy)];
      if (kind === GAP) continue;
      const x0 = PROXY_ORIGIN + gx * PROXY_TILE;
      const y0 = PROXY_ORIGIN + gy * PROXY_TILE;
      for (let dy = 0; dy < PROXY_TILE; dy++) {
        for (let dx = 0; dx < PROXY_TILE; dx++) carveWorldCell(world, x0 + dx, y0 + dy, kind);
      }
      if ((gx + gy) % 17 === 0) {
        const ci = world.idx(x0 + (PROXY_TILE >> 1), y0 + (PROXY_TILE >> 1));
        world.features[ci] = kind === BRIDGE ? Feature.TABLE : kind === STASH ? Feature.SHELF : Feature.NONE;
      }
    }
  }
}

function applyRoomLook(world: World, room: Room, wallTex: Tex, floorTex: Tex, fog: number): void {
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  for (let y = room.y - 1; y <= room.y + room.h; y++) {
    for (let x = room.x - 1; x <= room.x + room.w; x++) {
      const ci = world.idx(x, y);
      if (world.cells[ci] === Cell.WALL) world.wallTex[ci] = wallTex;
      if (world.roomMap[ci] === room.id) {
        world.floorTex[ci] = floorTex;
        world.fog[ci] = fog;
      }
    }
  }
}

function addRoomAtProxy(world: World, point: Point, type: RoomType, w: number, h: number, name: string, floorTex: Tex, fog: number): Room {
  const center = proxyCenter(point);
  const room = stampRoom(world, world.rooms.length, type, center.x - (w >> 1), center.y - (h >> 1), w, h, -1);
  room.name = name;
  applyRoomLook(world, room, Tex.VOID_WALL, floorTex, fog);
  return room;
}

function addDoor(world: World, room: Room, side: 'north' | 'south' | 'west' | 'east'): void {
  const wx = side === 'west' ? room.x - 1 : side === 'east' ? room.x + room.w : room.x + (room.w >> 1);
  const wy = side === 'north' ? room.y - 1 : side === 'south' ? room.y + room.h : room.y + (room.h >> 1);
  const outsideX = side === 'west' ? wx - 1 : side === 'east' ? wx + 1 : wx;
  const outsideY = side === 'north' ? wy - 1 : side === 'south' ? wy + 1 : wy;
  const idx = world.idx(wx, wy);
  world.cells[idx] = Cell.DOOR;
  world.wallTex[idx] = Tex.DOOR_METAL;
  world.doors.set(idx, { idx, state: DoorState.CLOSED, roomA: room.id, roomB: -1, keyId: '', timer: 0 });
  room.doors.push(idx);
  carveWorldCell(world, outsideX, outsideY, BRIDGE);
}

function canStampCantorRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  if (x < 2 || y < 2 || x + w >= W - 2 || y + h >= W - 2) return false;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.aptMask[ci]) return false;
      if (world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR) return false;
      if (world.features[ci] === Feature.LIFT_BUTTON) return false;
      if (world.roomMap[ci] >= 0) return false;
    }
  }
  return true;
}

function stampCantorRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  floorTex: Tex,
  fog: number,
): Room | null {
  const rx = Math.round(x);
  const ry = Math.round(y);
  if (!canStampCantorRoom(world, rx, ry, w, h)) return null;
  const room = stampRoom(world, world.rooms.length, type, rx, ry, w, h, -1);
  room.name = name;
  applyRoomLook(world, room, Tex.VOID_WALL, floorTex, fog);
  return room;
}

function paintRoomTerritorySeed(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[idx] === room.id) world.factionControl[idx] = owner;
    }
  }
  for (const doorIdx of room.doors) world.factionControl[doorIdx] = owner;
}

function featureForRoom(type: RoomType): Feature {
  switch (type) {
    case RoomType.KITCHEN: return Feature.STOVE;
    case RoomType.BATHROOM: return Feature.SINK;
    case RoomType.MEDICAL: return Feature.APPARATUS;
    case RoomType.PRODUCTION: return Feature.MACHINE;
    case RoomType.OFFICE: return Feature.DESK;
    case RoomType.STORAGE: return Feature.SHELF;
    case RoomType.SMOKING: return Feature.CHAIR;
    case RoomType.HQ: return Feature.SCREEN;
    default: return Feature.TABLE;
  }
}

function decorateCantorSupportRoom(world: World, room: Room): void {
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  world.features[world.idx(cx, cy)] = featureForRoom(room.type);
  if (room.w > 7 && room.h > 5) {
    world.features[world.idx(room.x + 2, room.y + 2)] = room.type === RoomType.BATHROOM ? Feature.TOILET : Feature.SHELF;
    world.features[world.idx(room.x + room.w - 3, room.y + room.h - 3)] = room.type === RoomType.KITCHEN ? Feature.SINK : Feature.TABLE;
  }
}

function stampCantorStation(world: World, point: Point, serial: number): void {
  const center = proxyCenter(point);
  const hall = stampCantorRoom(
    world,
    serial % 4 === 0 ? RoomType.COMMON : RoomType.CORRIDOR,
    center.x - 18,
    center.y - 6,
    36,
    12,
    `Кантор пустоты: средний узел разрывов ${serial + 1}`,
    serial % 3 === 0 ? Tex.F_CONCRETE : Tex.F_VOID,
    58 + (serial % 3) * 8,
  );
  if (!hall) return;
  decorateCantorSupportRoom(world, hall);
  addDoor(world, hall, serial % 2 === 0 ? 'east' : 'west');

  const supports = [
    { type: RoomType.STORAGE, x: hall.x + 2, y: hall.y - 9, w: 14, h: 8, name: 'кладовая' },
    { type: RoomType.OFFICE, x: hall.x + hall.w - 17, y: hall.y - 9, w: 15, h: 8, name: 'пост учета' },
    { type: RoomType.PRODUCTION, x: hall.x + 3, y: hall.y + hall.h + 1, w: 16, h: 9, name: 'ремонтная' },
    { type: RoomType.COMMON, x: hall.x + hall.w - 18, y: hall.y + hall.h + 1, w: 16, h: 9, name: 'ожидальня' },
  ];
  for (let i = 0; i < supports.length; i++) {
    const spec = supports[i];
    const room = stampCantorRoom(
      world,
      spec.type,
      spec.x,
      spec.y,
      spec.w,
      spec.h,
      `Кантор пустоты: ${spec.name} среднего узла ${serial + 1}`,
      spec.type === RoomType.PRODUCTION ? Tex.F_CONCRETE : Tex.F_VOID,
      62 + ((serial + i) % 4) * 5,
    );
    if (!room) continue;
    placeDoor(world, hall, room, '', false);
    decorateCantorSupportRoom(world, room);
  }
}

function stampCantorHqCompound(world: World, spec: CantorHqSpec): void {
  const center = proxyCenter(spec.point);
  const hall = stampCantorRoom(
    world,
    RoomType.COMMON,
    center.x - 20,
    center.y - 5,
    40,
    10,
    `${spec.name}: приемная полка`,
    Tex.F_CONCRETE,
    42,
  );
  const hq = stampCantorRoom(
    world,
    RoomType.HQ,
    center.x - 12,
    center.y - 19,
    24,
    13,
    spec.name,
    Tex.F_CONCRETE,
    36,
  );
  if (!hall || !hq) return;
  placeDoor(world, hall, hq, '', false);
  paintRoomTerritorySeed(world, hall, spec.owner);
  paintRoomTerritorySeed(world, hq, spec.owner);
  decorateCantorSupportRoom(world, hall);
  decorateCantorSupportRoom(world, hq);

  const supports = [
    { type: spec.supportTypes[0], x: center.x - 37, y: center.y - 5, w: 16, h: 10 },
    { type: spec.supportTypes[1], x: center.x + 21, y: center.y - 5, w: 16, h: 10 },
    { type: spec.supportTypes[2], x: center.x - 18, y: center.y + 6, w: 17, h: 10 },
    { type: spec.supportTypes[3], x: center.x + 3, y: center.y + 6, w: 17, h: 10 },
  ];
  for (let i = 0; i < supports.length; i++) {
    const support = supports[i];
    const room = stampCantorRoom(
      world,
      support.type,
      support.x,
      support.y,
      support.w,
      support.h,
      `${spec.name}: ${spec.supportPrefix} ${i + 1}`,
      support.type === RoomType.BATHROOM ? Tex.F_TILE : Tex.F_CONCRETE,
      44 + i * 4,
    );
    if (!room) continue;
    placeDoor(world, hall, room, '', false);
    paintRoomTerritorySeed(world, room, spec.owner);
    decorateCantorSupportRoom(world, room);
  }
}

function microRoomType(gx: number, gy: number): RoomType {
  const roll = (gx * 7 + gy * 11) % 9;
  if (roll === 0) return RoomType.KITCHEN;
  if (roll === 1) return RoomType.BATHROOM;
  if (roll === 2) return RoomType.OFFICE;
  if (roll === 3) return RoomType.SMOKING;
  if (roll === 4 || roll === 5) return RoomType.COMMON;
  return RoomType.STORAGE;
}

function microDoorSide(gx: number, gy: number): 'north' | 'south' | 'west' | 'east' {
  switch ((gx * 13 + gy * 5) & 3) {
    case 0: return 'north';
    case 1: return 'south';
    case 2: return 'west';
    default: return 'east';
  }
}

function shouldSkipMicroRoom(point: Point): boolean {
  const protectedPoints = [ENTRY_PROXY, UP_PROXY, DOWN_PROXY, REPAIR_PROXY, DUST_PROXY, HIDDEN_PROXY, ...CANTOR_HQ_SPECS.map(spec => spec.point)];
  for (const protectedPoint of protectedPoints) {
    const dx = point.x - protectedPoint.x;
    const dy = point.y - protectedPoint.y;
    if (dx * dx + dy * dy <= 5 * 5) return true;
  }
  return false;
}

function stampCantorMicroRooms(world: World, mask: Uint8Array): number {
  let stamped = 0;
  for (let gy = 1; gy < PROXY_SIZE - 1; gy++) {
    for (let gx = 1; gx < PROXY_SIZE - 1; gx++) {
      const kind = mask[proxyIdx(gx, gy)];
      if (kind === GAP || kind === ANCHOR || kind === STASH) continue;
      if (shouldSkipMicroRoom({ x: gx, y: gy })) continue;
      const hash = ((gx * 73856093) ^ (gy * 19349663)) >>> 0;
      if (hash % (kind === BRIDGE ? 7 : 5) !== 0) continue;
      const w = 6 + (hash % 3);
      const h = 4 + ((hash >>> 3) % 3);
      const x0 = PROXY_ORIGIN + gx * PROXY_TILE;
      const y0 = PROXY_ORIGIN + gy * PROXY_TILE;
      const x = x0 + 2 + ((hash >>> 7) % Math.max(1, PROXY_TILE - w - 3));
      const y = y0 + 2 + ((hash >>> 11) % Math.max(1, PROXY_TILE - h - 3));
      const type = microRoomType(gx, gy);
      const room = stampCantorRoom(
        world,
        type,
        x,
        y,
        w,
        h,
        `Кантор пустоты: рекурсивная клетка ${stamped + 1}`,
        type === RoomType.BATHROOM ? Tex.F_TILE : kind === BRIDGE ? Tex.F_CONCRETE : Tex.F_VOID,
        kind === BRIDGE ? 54 : 72,
      );
      if (!room) continue;
      addDoor(world, room, microDoorSide(gx, gy));
      decorateCantorSupportRoom(world, room);
      stamped++;
    }
  }
  return stamped;
}

function stampCantorMidAndMicroLayer(world: World, mask: Uint8Array): number {
  for (const spec of CANTOR_HQ_SPECS) stampCantorHqCompound(world, spec);
  for (const [i, point] of CANTOR_MID_PROXIES.entries()) stampCantorStation(world, point, i);
  return stampCantorMicroRooms(world, mask);
}

function placeLift(world: World, room: Room, direction: LiftDirection, dx: number): void {
  const x = room.x + Math.max(2, Math.min(room.w - 3, dx));
  const y = room.y + (room.h >> 1);
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.LIFT;
  world.liftDir[ci] = direction;
  world.wallTex[ci] = Tex.LIFT_DOOR;
  world.floorTex[ci] = Tex.F_CONCRETE;
  const button = world.idx(x + 1, y);
  if (world.cells[button] === Cell.FLOOR) world.features[button] = Feature.LIFT_BUTTON;
}

function stampRooms(world: World): CantorRooms {
  const entry = addRoomAtProxy(world, ENTRY_PROXY, RoomType.COMMON, 28, 18, CANTOR_PUSTOTY_ROOM_NAMES.entry, Tex.F_CONCRETE, 36);
  const repair = addRoomAtProxy(world, REPAIR_PROXY, RoomType.PRODUCTION, 26, 18, CANTOR_PUSTOTY_ROOM_NAMES.repair, Tex.F_CONCRETE, 44);
  const dust = addRoomAtProxy(world, DUST_PROXY, RoomType.STORAGE, 24, 16, CANTOR_PUSTOTY_ROOM_NAMES.dust, Tex.F_VOID, 70);
  const hidden = addRoomAtProxy(world, HIDDEN_PROXY, RoomType.STORAGE, 22, 14, CANTOR_PUSTOTY_ROOM_NAMES.hidden, Tex.F_VOID, 82);
  const upLift = addRoomAtProxy(world, UP_PROXY, RoomType.CORRIDOR, 24, 16, CANTOR_PUSTOTY_ROOM_NAMES.upLift, Tex.F_CONCRETE, 38);
  const downLift = addRoomAtProxy(world, DOWN_PROXY, RoomType.CORRIDOR, 24, 16, CANTOR_PUSTOTY_ROOM_NAMES.downLift, Tex.F_CONCRETE, 46);

  addDoor(world, entry, 'north');
  addDoor(world, repair, 'east');
  addDoor(world, dust, 'west');
  addDoor(world, hidden, 'south');
  addDoor(world, upLift, 'east');
  addDoor(world, downLift, 'west');
  placeLift(world, upLift, LiftDirection.UP, 7);
  placeLift(world, downLift, LiftDirection.DOWN, downLift.w - 8);

  decorateRooms(world, [entry, repair, dust, hidden, upLift, downLift]);
  return { entry, repair, dust, hidden, upLift, downLift };
}

function decorateRooms(world: World, rooms: readonly Room[]): void {
  for (const room of rooms) {
    const cx = room.x + (room.w >> 1);
    const cy = room.y + (room.h >> 1);
    world.features[world.idx(cx, cy)] = room.type === RoomType.PRODUCTION ? Feature.MACHINE : room.type === RoomType.STORAGE ? Feature.SHELF : Feature.CANDLE;
    if (room.type === RoomType.COMMON) {
      world.features[world.idx(room.x + 4, room.y + 4)] = Feature.TABLE;
      world.features[world.idx(room.x + room.w - 5, room.y + room.h - 5)] = Feature.CANDLE;
    }
    if (room.type === RoomType.PRODUCTION) {
      world.features[world.idx(room.x + 5, room.y + 5)] = Feature.APPARATUS;
      world.features[world.idx(room.x + room.w - 6, room.y + 5)] = Feature.SHELF;
    }
  }
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(container => container.id === id)) id++;
  return id;
}

function addContainer(
  world: World,
  room: Room,
  x: number,
  y: number,
  kind: ContainerKind,
  name: string,
  access: WorldContainer['access'],
  inventory: Item[],
  tags: string[],
): void {
  const ci = world.idx(x, y);
  world.addContainer({
    id: nextContainerId(world),
    x: world.wrap(x),
    y: world.wrap(y),
    floor: FloorLevel.VOID,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind,
    name,
    inventory,
    capacitySlots: 7,
    access,
    lockDifficulty: access === 'locked' ? 6 : undefined,
    discovered: access !== 'secret',
    tags,
  });
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = kind === ContainerKind.TOOL_LOCKER ? Feature.SHELF : Feature.DESK;
}

function placeContainers(world: World, rooms: CantorRooms): void {
  addContainer(world, rooms.entry, rooms.entry.x + 5, rooms.entry.y + 5, ContainerKind.EMERGENCY_BOX, 'Ящик досок входного острова', 'public', [
    { defId: 'duct_tape', count: 2 },
    { defId: 'chalk', count: 1 },
    { defId: 'water', count: 1 },
  ], ['cantor_pustoty', 'entry', 'bridge_supply']);

  addContainer(world, rooms.repair, rooms.repair.x + rooms.repair.w - 6, rooms.repair.y + 6, ContainerKind.TOOL_LOCKER, 'Шкаф ремонта канторова моста', 'public', [
    { defId: 'metal_sheet', count: 2 },
    { defId: 'sealant_tube', count: 1 },
    { defId: 'wrench', count: 1 },
  ], ['cantor_pustoty', 'repair', 'gap_bridge', 'tools']);

  addContainer(world, rooms.dust, rooms.dust.x + 7, rooms.dust.y + 6, ContainerKind.SECRET_STASH, 'Пыльный островной тайник', 'secret', [
    { defId: 'psi_dust', count: 2 },
    { defId: 'breach_charge', count: 1 },
    { defId: 'gasmask_filter', count: 1 },
  ], ['cantor_pustoty', 'dust_island', 'stash_island', 'risk_bridge']);

  addContainer(world, rooms.hidden, rooms.hidden.x + rooms.hidden.w - 7, rooms.hidden.y + 5, ContainerKind.SECRET_STASH, 'Тайник острова без обратного шага', 'secret', [
    { defId: 'psi_stabilizer', count: 1 },
    { defId: 'chalk', count: 1 },
    { defId: 'metal_sheet', count: 1 },
  ], ['cantor_pustoty', 'stash_island', 'one_way_dust']);
}

function cantorMonsterPhases(kind: MonsterKind): boolean {
  return kind === MonsterKind.SHADOW ||
    kind === MonsterKind.TONKAYA_TEN ||
    kind === MonsterKind.GLUBINNAYA_TEN ||
    kind === MonsterKind.LISHENNYY ||
    kind === MonsterKind.SPIRIT;
}

function spawnMonster(entities: Entity[], nextId: { v: number }, kind: MonsterKind, x: number, y: number, level: number, name: string): void {
  const def = MONSTERS[kind];
  const hp = Math.round(scaleMonsterHp(def.hp, level));
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: ((x * 31 + y * 17) % 360) * Math.PI / 180,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, level),
    sprite: monsterSpr(kind),
    name,
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
    phasing: cantorMonsterPhases(kind),
  });
}

function dropItem(entities: Entity[], nextId: { v: number }, x: number, y: number, defId: string, count = 1): void {
  entities.push({
    id: nextId.v++,
    type: EntityType.ITEM_DROP,
    x: x + 0.5,
    y: y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count }],
  });
}

function placeEntities(world: World, entities: Entity[], nextId: { v: number }, rooms: CantorRooms): void {
  spawnMonster(entities, nextId, MonsterKind.TONKAYA_TEN, rooms.dust.x + 5, rooms.dust.y + 5, 10, 'Тонкая тень пыльного острова');
  spawnMonster(entities, nextId, MonsterKind.LISHENNYY, rooms.hidden.x + 4, rooms.hidden.y + 5, 11, 'Лишенный обратного шага');
  spawnMonster(entities, nextId, MonsterKind.SHADOW, rooms.repair.x + rooms.repair.w - 7, rooms.repair.y + rooms.repair.h - 6, 9, 'Тень ремонтной полки');
  spawnMonster(entities, nextId, MonsterKind.GLUBINNAYA_TEN, rooms.downLift.x + 5, rooms.downLift.y + 7, 11, 'Глубинная тень нижней кабины');
  dropItem(entities, nextId, rooms.entry.x + rooms.entry.w - 6, rooms.entry.y + 4, 'chalk', 1);
  void world;
}

function registerCantorRouteCues(world: World, rooms: CantorRooms): void {
  registerRouteCue(world, {
    id: 'cantor_pustoty_gap_bridge',
    x: rooms.entry.x + rooms.entry.w - 3,
    y: rooms.entry.y + 4,
    targetX: rooms.repair.x + 6,
    targetY: rooms.repair.y + 7,
    floor: FloorLevel.VOID,
    label: 'Канторов мост',
    hint: 'рискнуть узкой бетонной связкой или идти длинной компонентой',
    targetName: CANTOR_PUSTOTY_ROOM_NAMES.repair,
    color: '#9cf',
    tags: ['cantor_pustoty', 'gap_bridge', 'repair', 'tools'],
    toneSeed: 0x8701,
    roomId: rooms.entry.id,
    targetRoomId: rooms.repair.id,
    heardText: 'За разрывом скрипит ремонтная полка: мост держится на листовом металле.',
    followedText: 'Канторов мост найден. Дальше можно чинить путь, а не только помнить его.',
    ignoredText: 'Узкая связка остается сбоку; длинная компонента гасит шаги медленнее.',
  });

  registerRouteCue(world, {
    id: 'cantor_pustoty_dust_island',
    x: rooms.repair.x + rooms.repair.w - 4,
    y: rooms.repair.y + 6,
    targetX: rooms.dust.x + 7,
    targetY: rooms.dust.y + 6,
    floor: FloorLevel.VOID,
    label: 'Пыльный остров',
    hint: 'тайник за рекурсивной прорезью, путь назад уже',
    targetName: CANTOR_PUSTOTY_ROOM_NAMES.dust,
    color: '#c8f',
    tags: ['cantor_pustoty', 'stash_island', 'dust_island', 'risk_bridge'],
    toneSeed: 0x8702,
    roomId: rooms.repair.id,
    targetRoomId: rooms.dust.id,
    heardText: 'Пыльный остров отвечает глухо: лут есть, ширины почти нет.',
    followedText: 'Пыльный остров найден. Тайник лежит на безопасной клетке, а не на безопасной совести.',
    ignoredText: 'Пыльный остров остается за прорезью. Пустота не закрывает его, только считает шаги.',
  });
}

function tuneCantorZones(world: World): void {
  for (const zone of world.zones) {
    const d = world.dist(zone.cx, zone.cy, W / 2, W / 2);
    zone.faction = ZoneFaction.SAMOSBOR;
    zone.level = Math.max(5, Math.min(8, 5 + Math.round(d / 250)));
    zone.fogged = true;
  }
  for (let i = 0; i < W * W; i++) world.factionControl[i] = ZoneFaction.SAMOSBOR;
}

export function reinforceCantorPustotyAuthoredHqTerritory(world: World): void {
  for (const spec of CANTOR_HQ_SPECS) {
    for (const room of world.rooms) {
      if (!room || !room.name.startsWith(spec.name)) continue;
      paintRoomTerritorySeed(world, room, spec.owner);
    }
  }
}

function reachableLifts(world: World, spawnX: number, spawnY: number): { up: boolean; down: boolean } {
  const audit = auditReachability(world, world.idx(Math.floor(spawnX), Math.floor(spawnY)));
  let up = false;
  let down = false;
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] !== Cell.LIFT) continue;
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
      if (!audit.reachable[world.idx(x + dx, y + dy)]) continue;
      if (world.liftDir[i] === LiftDirection.UP) up = true;
      if (world.liftDir[i] === LiftDirection.DOWN) down = true;
    }
  }
  return { up, down };
}

function countAbyssCells(world: World): number {
  let count = 0;
  for (const cell of world.cells) if (cell === Cell.ABYSS) count++;
  return count;
}

function reachableStashContainers(world: World, spawnX: number, spawnY: number): number {
  const audit = auditReachability(world, world.idx(Math.floor(spawnX), Math.floor(spawnY)));
  let count = 0;
  for (const container of world.containers) {
    if (!container.tags.includes('stash_island')) continue;
    if (audit.reachable[world.idx(container.x, container.y)]) count++;
  }
  return count;
}

export function measureCantorPustotyMetrics(gen: FloorGeneration): CantorPustotyMetrics {
  const base = CANTOR_METRICS.get(gen.world) ?? {
    routeId: CANTOR_PUSTOTY_ROUTE_ID,
    z: CANTOR_PUSTOTY_Z,
    recursionDepth: RECURSION_DEPTH,
    proxyOpenCells: 0,
    componentCountBeforeBridge: 0,
    largestComponentBeforeBridge: 0,
    bridgedComponents: 0,
    bridgeProxyCells: 0,
    stashIslandCount: 0,
  };
  const lifts = reachableLifts(gen.world, gen.spawnX, gen.spawnY);
  return {
    ...base,
    reachableStashContainers: reachableStashContainers(gen.world, gen.spawnX, gen.spawnY),
    abyssCells: countAbyssCells(gen.world),
    ungatedUpLiftReachable: lifts.up,
    ungatedDownLiftReachable: lifts.down,
  };
}

export function generateCantorPustotyDesignFloor(): FloorGeneration {
  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 1 };

  paintVoidBase(world);
  const cantor = buildCantorProxy();
  carveProxyMaskToWorld(world, cantor.mask);
  const rooms = stampRooms(world);
  const microRooms = stampCantorMidAndMicroLayer(world, cantor.mask);
  const spawnX = rooms.entry.x + (rooms.entry.w >> 1) + 0.5;
  const spawnY = rooms.entry.y + (rooms.entry.h >> 1) + 0.5;

  generateZones(world);
  tuneCantorZones(world);
  reinforceCantorPustotyAuthoredHqTerritory(world);
  placeContainers(world, rooms);
  placeEntities(world, entities, nextId, rooms);
  registerCantorRouteCues(world, rooms);
  ensureConnectivity(world, spawnX, spawnY);
  sanitizeDoors(world);
  world.rebuildContainerMap();
  world.bakeLights();

  CANTOR_METRICS.set(world, {
    routeId: CANTOR_PUSTOTY_ROUTE_ID,
    z: CANTOR_PUSTOTY_Z,
    recursionDepth: RECURSION_DEPTH,
    proxyOpenCells: cantor.proxyOpenCells,
    componentCountBeforeBridge: cantor.componentCountBeforeBridge,
    largestComponentBeforeBridge: cantor.largestComponentBeforeBridge,
    bridgedComponents: cantor.bridgedComponents,
    bridgeProxyCells: cantor.bridgeCells,
    stashIslandCount: 3 + Math.floor(microRooms / 160),
  });

  return { world, entities, spawnX, spawnY };
}
