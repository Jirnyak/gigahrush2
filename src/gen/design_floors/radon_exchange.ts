/* -- Design floor: radon_exchange - scan-line transfer through concrete -- */

import {
  Cell,
  ContainerKind,
  DoorState,
  Feature,
  FloorLevel,
  LiftDirection,
  RoomType,
  Tex,
  W,
  ZoneFaction,
  type Room,
  type TerritoryOwner,
  type WorldContainer,
} from '../../core/types';
import { REACH_GATE_NONE, auditReachability } from '../../core/world';
import { World } from '../../core/world';
import { registerRouteCue } from '../../systems/route_cues';
import { carveCorridor, ensureConnectivity, generateZones, sanitizeDoors, stampRoom } from '../shared';
import type { FloorGeneration } from '../floor_manifest';

export const RADON_EXCHANGE_ROUTE_ID = 'radon_exchange' as const;
export const RADON_EXCHANGE_Z = 44 as const;
export const RADON_EXCHANGE_BASE_FLOOR = FloorLevel.MINISTRY;
export const RADON_EXCHANGE_PROJECTION_KEY = 'key' as const;

export const RADON_EXCHANGE_META = {
  routeId: RADON_EXCHANGE_ROUTE_ID,
  displayName: 'Радоновый обменник',
  z: RADON_EXCHANGE_Z,
  baseFloor: RADON_EXCHANGE_BASE_FLOOR,
  debugEntry: 'generateRadonExchangeDesignFloor()',
} as const;

export const RADON_EXCHANGE_ROOM_NAMES = {
  exchangeHall: 'Радоновый обменный зал',
  zeroRadius: 'Узел нулевого радиуса',
  shutterNorth: 'Северная кассета заслонок',
  shutterEast: 'Восточная кассета заслонок',
  serviceChord: 'Сервисная хорда бетонной проекции',
  projectionKey: 'Комната проекционного ключа',
  blindWedge: 'Слепой клин дозиметристов',
  upLift: 'Верхняя кабина радонового обменника',
  downLift: 'Нижняя кабина радонового обменника',
} as const;

interface Point {
  x: number;
  y: number;
}

interface RadonLine {
  angle: number;
  radius: number;
  width: number;
  floorTex: Tex;
}

interface RadonRooms {
  exchangeHall: Room;
  zeroRadius: Room;
  shutterNorth: Room;
  shutterEast: Room;
  serviceChord: Room;
  projectionKey: Room;
  blindWedge: Room;
  upLift: Room;
  downLift: Room;
}

interface RadonFactionOutpostSpec {
  owner: TerritoryOwner;
  x: number;
  y: number;
  name: string;
  prefix: string;
  wallTex: Tex;
  floorTex: Tex;
  support: readonly RoomType[];
  hermeticDoor?: DoorState;
  compact?: boolean;
}

interface RadonTerritoryTarget {
  owner: TerritoryOwner;
  share: number;
}

interface RadonTerritoryAnchor {
  owner: TerritoryOwner;
  x: number;
  y: number;
  strength: number;
}

export interface RadonExchangeMetrics {
  routeId: typeof RADON_EXCHANGE_ROUTE_ID;
  z: typeof RADON_EXCHANGE_Z;
  scanLineCells: number;
  serviceChordCells: number;
  blindWedgeCells: number;
  shutterDoors: number;
  projectionKeyContainers: number;
  controlRooms: number;
  coverCells: number;
  longestScanRun: number;
  ungatedUpLiftReachable: boolean;
  ungatedDownLiftReachable: boolean;
}

const CX = W >> 1;
const CY = W >> 1;
const EDGE = W - 1;
const SCAN_FLOOR = Tex.F_MARBLE_TILE;
const SERVICE_FLOOR = Tex.F_CONCRETE;
const CONTROL_FLOOR = Tex.F_PARQUET;
const ADMIN_WALL = Tex.MARBLE;
const SERVICE_WALL = Tex.METAL;
const BLIND_WALL = Tex.CONCRETE;
const DOOR_METAL = Tex.DOOR_METAL;
const TERRITORY_UNASSIGNED = 255;

const RADON_LINES: readonly RadonLine[] = [
  { angle: 0, radius: -320, width: 1.25, floorTex: SCAN_FLOOR },
  { angle: 0, radius: -160, width: 1.6, floorTex: SCAN_FLOOR },
  { angle: 0, radius: 0, width: 2.2, floorTex: SCAN_FLOOR },
  { angle: 0, radius: 160, width: 1.6, floorTex: SCAN_FLOOR },
  { angle: 0, radius: 320, width: 1.25, floorTex: SCAN_FLOOR },
  { angle: Math.PI / 2, radius: -288, width: 1.25, floorTex: SCAN_FLOOR },
  { angle: Math.PI / 2, radius: -96, width: 1.5, floorTex: SCAN_FLOOR },
  { angle: Math.PI / 2, radius: 96, width: 1.5, floorTex: SCAN_FLOOR },
  { angle: Math.PI / 2, radius: 288, width: 1.25, floorTex: SCAN_FLOOR },
  { angle: Math.PI / 4, radius: -250, width: 1.2, floorTex: SCAN_FLOOR },
  { angle: Math.PI / 4, radius: 0, width: 1.7, floorTex: SCAN_FLOOR },
  { angle: Math.PI / 4, radius: 250, width: 1.2, floorTex: SCAN_FLOOR },
  { angle: -Math.PI / 4, radius: -250, width: 1.2, floorTex: SCAN_FLOOR },
  { angle: -Math.PI / 4, radius: 0, width: 1.7, floorTex: SCAN_FLOOR },
  { angle: -Math.PI / 4, radius: 250, width: 1.2, floorTex: SCAN_FLOOR },
];

const CONTROL_POINTS: readonly Point[] = [
  { x: 512, y: 512 },
  { x: 352, y: 416 },
  { x: 672, y: 416 },
  { x: 352, y: 608 },
  { x: 672, y: 608 },
  { x: 224, y: 512 },
  { x: 800, y: 512 },
  { x: 512, y: 224 },
  { x: 512, y: 800 },
];

const SHUTTER_DOORS: readonly { x: number; y: number; axis: 'horizontal' | 'vertical'; state: DoorState; keyId: string }[] = [
  { x: 512, y: 348, axis: 'vertical', state: DoorState.HERMETIC_OPEN, keyId: '' },
  { x: 512, y: 380, axis: 'vertical', state: DoorState.HERMETIC_CLOSED, keyId: '' },
  { x: 512, y: 644, axis: 'vertical', state: DoorState.HERMETIC_OPEN, keyId: '' },
  { x: 512, y: 676, axis: 'vertical', state: DoorState.HERMETIC_CLOSED, keyId: RADON_EXCHANGE_PROJECTION_KEY },
  { x: 348, y: 512, axis: 'horizontal', state: DoorState.HERMETIC_CLOSED, keyId: '' },
  { x: 380, y: 512, axis: 'horizontal', state: DoorState.HERMETIC_OPEN, keyId: '' },
  { x: 644, y: 512, axis: 'horizontal', state: DoorState.HERMETIC_CLOSED, keyId: RADON_EXCHANGE_PROJECTION_KEY },
  { x: 676, y: 512, axis: 'horizontal', state: DoorState.HERMETIC_OPEN, keyId: '' },
  { x: 400, y: 624, axis: 'horizontal', state: DoorState.CLOSED, keyId: '' },
  { x: 624, y: 400, axis: 'vertical', state: DoorState.CLOSED, keyId: '' },
];

const RADON_TERRITORY_TARGETS: readonly RadonTerritoryTarget[] = [
  { owner: ZoneFaction.CITIZEN, share: 0.16 },
  { owner: ZoneFaction.LIQUIDATOR, share: 0.36 },
  { owner: ZoneFaction.CULTIST, share: 0.10 },
  { owner: ZoneFaction.SCIENTIST, share: 0.26 },
  { owner: ZoneFaction.WILD, share: 0.12 },
];

const RADON_FACTION_OUTPOSTS: readonly RadonFactionOutpostSpec[] = [
  {
    owner: ZoneFaction.CITIZEN,
    x: 132,
    y: 122,
    name: 'Гражданский гермопункт дозиметрической очереди',
    prefix: 'Гражданский дозиметрический пункт',
    wallTex: Tex.PANEL,
    floorTex: Tex.F_LINO,
    support: [RoomType.KITCHEN, RoomType.BATHROOM, RoomType.STORAGE, RoomType.MEDICAL],
    hermeticDoor: DoorState.HERMETIC_OPEN,
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    x: 450,
    y: 292,
    name: 'Ликвидаторский гермопост северных створок',
    prefix: 'Северный пост створок',
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_CONCRETE,
    support: [RoomType.STORAGE, RoomType.PRODUCTION, RoomType.MEDICAL, RoomType.KITCHEN, RoomType.OFFICE],
    hermeticDoor: DoorState.HERMETIC_OPEN,
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    x: 760,
    y: 452,
    name: 'Ликвидаторская будка восточной отсечки',
    prefix: 'Восточная отсечка ликвидаторов',
    wallTex: Tex.METAL,
    floorTex: Tex.F_CONCRETE,
    support: [RoomType.STORAGE, RoomType.PRODUCTION, RoomType.BATHROOM],
    hermeticDoor: DoorState.HERMETIC_CLOSED,
    compact: true,
  },
  {
    owner: ZoneFaction.SCIENTIST,
    x: 702,
    y: 246,
    name: 'НИИ-гермокор измерения радона',
    prefix: 'НИИ радоновой проекции',
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_TILE,
    support: [RoomType.MEDICAL, RoomType.PRODUCTION, RoomType.OFFICE, RoomType.STORAGE, RoomType.BATHROOM],
    hermeticDoor: DoorState.HERMETIC_OPEN,
  },
  {
    owner: ZoneFaction.CULTIST,
    x: 764,
    y: 760,
    name: 'Скрытый культовый гермоузел слепого клина',
    prefix: 'Слепой культовый узел',
    wallTex: Tex.MEAT,
    floorTex: Tex.F_GUT,
    support: [RoomType.STORAGE, RoomType.SMOKING, RoomType.KITCHEN],
    hermeticDoor: DoorState.HERMETIC_CLOSED,
    compact: true,
  },
  {
    owner: ZoneFaction.WILD,
    x: 214,
    y: 694,
    name: 'Дикий гермокарман сервисной хорды',
    prefix: 'Дикий сервисный карман',
    wallTex: Tex.BRICK,
    floorTex: Tex.F_CONCRETE,
    support: [RoomType.STORAGE, RoomType.KITCHEN, RoomType.BATHROOM, RoomType.SMOKING],
    hermeticDoor: DoorState.HERMETIC_CLOSED,
    compact: true,
  },
];

function carveCell(world: World, x: number, y: number, floorTex: Tex): void {
  const idx = world.idx(x, y);
  if (world.aptMask[idx] || world.hermoWall[idx]) return;
  world.cells[idx] = Cell.FLOOR;
  world.roomMap[idx] = -1;
  world.floorTex[idx] = floorTex;
  world.features[idx] = Feature.NONE;
}

function carveDisc(world: World, x: number, y: number, radius: number, floorTex: Tex): void {
  const r = Math.max(1, Math.ceil(radius));
  const r2 = radius * radius;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      carveCell(world, Math.round(x + dx), Math.round(y + dy), floorTex);
    }
  }
}

function carveSegment(world: World, a: Point, b: Point, radius: number, floorTex: Tex): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 1.35));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    carveDisc(world, a.x + dx * t, a.y + dy * t, radius, floorTex);
  }
}

function carveRadonLine(world: World, line: RadonLine): void {
  const nx = Math.cos(line.angle);
  const ny = Math.sin(line.angle);
  const dx = -ny;
  const dy = nx;
  const baseX = CX + nx * line.radius;
  const baseY = CY + ny * line.radius;
  for (let t = -760; t <= 760; t += 0.8) {
    carveDisc(world, baseX + dx * t, baseY + dy * t, line.width, line.floorTex);
  }
}

function stampBlindWedge(world: World, cx: number, cy: number, angle: number, spread: number, inner: number, outer: number): void {
  const minX = Math.max(0, Math.floor(cx - outer - 2));
  const maxX = Math.min(EDGE, Math.ceil(cx + outer + 2));
  const minY = Math.max(0, Math.floor(cy - outer - 2));
  const maxY = Math.min(EDGE, Math.ceil(cy + outer + 2));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const vx = x + 0.5 - cx;
      const vy = y + 0.5 - cy;
      const dist = Math.hypot(vx, vy);
      if (dist < inner || dist > outer) continue;
      let da = Math.atan2(vy, vx) - angle;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(da) > spread) continue;
      const idx = world.idx(x, y);
      if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.DOOR) continue;
      const stripe = ((x * 73856093) ^ (y * 19349663)) & 7;
      if (stripe <= 2) {
        world.cells[idx] = Cell.WALL;
        world.roomMap[idx] = -1;
        world.wallTex[idx] = BLIND_WALL;
        world.features[idx] = Feature.NONE;
      }
      world.fog[idx] = Math.max(world.fog[idx], 52 + stripe * 10);
    }
  }
}

function styleRoom(world: World, room: Room, wallTex: Tex, floorTex: Tex): Room {
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  for (let y = room.y - 1; y <= room.y + room.h; y++) {
    for (let x = room.x - 1; x <= room.x + room.w; x++) {
      const idx = world.idx(x, y);
      if (world.roomMap[idx] === room.id) {
        world.floorTex[idx] = floorTex;
      } else if (world.cells[idx] === Cell.WALL) {
        world.wallTex[idx] = wallTex;
      }
    }
  }
  return room;
}

function stampNamedRoom(
  world: World,
  nextRoomId: { v: number },
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
): Room {
  const room = stampRoom(world, nextRoomId.v++, type, x, y, w, h, -1);
  room.name = name;
  return styleRoom(world, room, wallTex, floorTex);
}

function canStampRadonRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  if (x < 2 || y < 2 || x + w >= EDGE - 2 || y + h >= EDGE - 2) return false;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const idx = world.idx(x + dx, y + dy);
      if (world.aptMask[idx] || world.hermoWall[idx]) return false;
      if (world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.DOOR) return false;
      if (world.doors.has(idx) || world.containerMap.has(idx)) return false;
      if (world.roomMap[idx] >= 0) return false;
    }
  }
  return true;
}

function stampOptionalRadonRoom(
  world: World,
  nextRoomId: { v: number },
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
): Room | null {
  if (!canStampRadonRoom(world, x, y, w, h)) return null;
  return stampNamedRoom(world, nextRoomId, type, x, y, w, h, name, wallTex, floorTex);
}

function sideToward(world: World, room: Room, targetX: number, targetY: number): 'north' | 'south' | 'west' | 'east' {
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h / 2;
  const dx = world.delta(cx, targetX);
  const dy = world.delta(cy, targetY);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}

function setRoomFeature(world: World, room: Room, x: number, y: number, feature: Feature): void {
  const idx = world.idx(room.x + x, room.y + y);
  if (world.roomMap[idx] !== room.id || world.features[idx] !== Feature.NONE) return;
  world.features[idx] = feature;
  if (feature === Feature.SCREEN && !world.screenCells.includes(idx)) world.screenCells.push(idx);
}

function decorateRadonSupportRoom(world: World, room: Room, serial: number): void {
  const midX = Math.max(1, Math.floor(room.w / 2));
  const midY = Math.max(1, Math.floor(room.h / 2));
  switch (room.type) {
    case RoomType.KITCHEN:
      setRoomFeature(world, room, 2, 2, Feature.STOVE);
      setRoomFeature(world, room, room.w - 3, 2, Feature.SINK);
      setRoomFeature(world, room, midX, midY, Feature.TABLE);
      break;
    case RoomType.BATHROOM:
      setRoomFeature(world, room, 2, 2, Feature.TOILET);
      setRoomFeature(world, room, room.w - 3, 2, Feature.SINK);
      break;
    case RoomType.MEDICAL:
      setRoomFeature(world, room, 2, 2, Feature.APPARATUS);
      setRoomFeature(world, room, room.w - 3, room.h - 3, Feature.DESK);
      break;
    case RoomType.PRODUCTION:
      for (let x = 3; x < room.w - 2; x += 6) setRoomFeature(world, room, x, midY, Feature.MACHINE);
      setRoomFeature(world, room, room.w - 3, 2, Feature.SCREEN);
      break;
    case RoomType.STORAGE:
      for (let y = 2; y < room.h - 2; y += 4) {
        setRoomFeature(world, room, 2, y, Feature.SHELF);
        setRoomFeature(world, room, room.w - 3, y, Feature.SHELF);
      }
      break;
    case RoomType.OFFICE:
      setRoomFeature(world, room, 2, 2, Feature.DESK);
      setRoomFeature(world, room, room.w - 3, 2, Feature.SCREEN);
      setRoomFeature(world, room, room.w - 3, room.h - 3, Feature.SHELF);
      break;
    case RoomType.HQ:
      setRoomFeature(world, room, 2, 2, Feature.SCREEN);
      setRoomFeature(world, room, room.w - 3, 2, Feature.DESK);
      setRoomFeature(world, room, midX, room.h - 3, Feature.LAMP);
      break;
    case RoomType.SMOKING:
    case RoomType.COMMON:
      setRoomFeature(world, room, midX, midY, Feature.TABLE);
      setRoomFeature(world, room, Math.max(1, midX - 2), midY, Feature.CHAIR);
      setRoomFeature(world, room, Math.min(room.w - 2, midX + 2), midY, Feature.CHAIR);
      break;
    default:
      setRoomFeature(world, room, 2 + (serial % Math.max(1, room.w - 4)), 2, Feature.LAMP);
      break;
  }
}

function sealRoomShell(world: World, room: Room): void {
  room.sealed = true;
  room.wallTex = Tex.HERMO_WALL;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.cells[idx] !== Cell.WALL) continue;
      world.wallTex[idx] = Tex.HERMO_WALL;
      world.hermoWall[idx] = 1;
    }
  }
}

function addDoorAt(
  world: World,
  room: Room | null,
  x: number,
  y: number,
  state: DoorState,
  keyId = '',
): number {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.DOOR;
  world.wallTex[idx] = state === DoorState.CLOSED ? Tex.DOOR_WOOD : DOOR_METAL;
  world.features[idx] = Feature.NONE;
  world.doors.set(idx, {
    idx,
    state,
    roomA: room?.id ?? -1,
    roomB: -1,
    keyId,
    timer: 0,
  });
  if (room && !room.doors.includes(idx)) room.doors.push(idx);
  return idx;
}

function addShutterDoorAt(
  world: World,
  x: number,
  y: number,
  axis: 'horizontal' | 'vertical',
  state: DoorState,
  keyId: string,
): number {
  const flankA = axis === 'vertical' ? world.idx(x - 1, y) : world.idx(x, y - 1);
  const flankB = axis === 'vertical' ? world.idx(x + 1, y) : world.idx(x, y + 1);
  for (const idx of [flankA, flankB]) {
    world.cells[idx] = Cell.WALL;
    world.roomMap[idx] = -1;
    world.wallTex[idx] = SERVICE_WALL;
    world.features[idx] = Feature.NONE;
  }
  return addDoorAt(world, null, x, y, state, keyId);
}

function connectRoomToPoint(
  world: World,
  room: Room,
  side: 'north' | 'south' | 'west' | 'east',
  targetX: number,
  targetY: number,
  state: DoorState = DoorState.CLOSED,
  keyId = '',
): void {
  const x = side === 'west' ? room.x - 1
    : side === 'east' ? room.x + room.w
      : room.x + Math.floor(room.w / 2);
  const y = side === 'north' ? room.y - 1
    : side === 'south' ? room.y + room.h
      : room.y + Math.floor(room.h / 2);
  addDoorAt(world, room, x, y, state, keyId);
  const outX = side === 'west' ? x - 1 : side === 'east' ? x + 1 : x;
  const outY = side === 'north' ? y - 1 : side === 'south' ? y + 1 : y;
  carveCorridor(world, world.wrap(outX), world.wrap(outY), targetX, targetY);
}

function placeLift(world: World, x: number, y: number, direction: LiftDirection): void {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.LIFT;
  world.wallTex[idx] = Tex.LIFT_DOOR;
  world.floorTex[idx] = SCAN_FLOOR;
  world.features[idx] = Feature.NONE;
  world.liftDir[idx] = direction;
  const buttonIdx = world.idx(x + 1, y);
  if (world.cells[buttonIdx] === Cell.FLOOR) {
    world.features[buttonIdx] = Feature.LIFT_BUTTON;
    world.liftDir[buttonIdx] = direction;
  }
}

function addContainer(
  world: World,
  nextContainerId: { v: number },
  room: Room,
  x: number,
  y: number,
  kind: ContainerKind,
  name: string,
  inventory: WorldContainer['inventory'],
  tags: string[],
  access: WorldContainer['access'] = 'public',
  ownerName?: string,
): void {
  world.addContainer({
    id: nextContainerId.v++,
    x: world.wrap(x),
    y: world.wrap(y),
    floor: RADON_EXCHANGE_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)] ?? 0,
    kind,
    name,
    inventory,
    capacitySlots: Math.max(6, inventory.length + 3),
    access,
    ownerName,
    lockDifficulty: access === 'locked' ? 3 : undefined,
    discovered: access !== 'secret',
    tags: [RADON_EXCHANGE_ROUTE_ID, ...tags],
  });
}

function decorateControlRoom(world: World, room: Room, serial: number): void {
  for (let x = room.x + 3; x < room.x + room.w - 3; x += 7) {
    const top = world.idx(x, room.y + 2);
    const bottom = world.idx(x, room.y + room.h - 3);
    if (world.roomMap[top] === room.id) world.features[top] = Feature.SCREEN;
    if (world.roomMap[bottom] === room.id) world.features[bottom] = Feature.DESK;
  }
  for (let y = room.y + 4; y < room.y + room.h - 3; y += 5) {
    const idx = world.idx(room.x + 2 + ((serial + y) % Math.max(1, room.w - 4)), y);
    if (world.roomMap[idx] === room.id) world.features[idx] = Feature.SHELF;
  }
}

function placeCover(world: World): void {
  let n = 0;
  for (const p of CONTROL_POINTS) {
    for (const [dx, dy] of [[4, 2], [-4, -2], [2, -4], [-2, 4]] as const) {
      const idx = world.idx(p.x + dx, p.y + dy);
      if (world.cells[idx] !== Cell.FLOOR) continue;
      world.features[idx] = n % 3 === 0 ? Feature.MACHINE : n % 3 === 1 ? Feature.DESK : Feature.SHELF;
      n++;
    }
  }
}

function carveRadonFrame(world: World, left: number, top: number, right: number, bottom: number, radius: number, floorTex: Tex): void {
  carveSegment(world, { x: left, y: top }, { x: right, y: top }, radius, floorTex);
  carveSegment(world, { x: right, y: top }, { x: right, y: bottom }, radius, floorTex);
  carveSegment(world, { x: right, y: bottom }, { x: left, y: bottom }, radius, floorTex);
  carveSegment(world, { x: left, y: bottom }, { x: left, y: top }, radius, floorTex);
}

function carveRadonServiceGrid(world: World): void {
  const rows = [96, 160, 288, 352, 480, 544, 672, 736, 864, 928];
  const cols = [96, 160, 288, 352, 480, 544, 672, 736, 864, 928];
  for (let i = 0; i < rows.length; i++) {
    const y = rows[i];
    const drift = i % 2 === 0 ? -18 : 18;
    carveSegment(world, { x: 44, y }, { x: 980, y: y + drift }, i % 3 === 0 ? 2.2 : 1.35, i % 3 === 0 ? SERVICE_FLOOR : Tex.F_CONCRETE);
  }
  for (let i = 0; i < cols.length; i++) {
    const x = cols[i];
    const drift = i % 2 === 0 ? 16 : -16;
    carveSegment(world, { x, y: 44 }, { x: x + drift, y: 980 }, i % 3 === 1 ? 2.1 : 1.35, i % 3 === 1 ? SERVICE_FLOOR : Tex.F_CONCRETE);
  }
  carveRadonFrame(world, 96, 96, 928, 928, 2.2, SERVICE_FLOOR);
  carveRadonFrame(world, 180, 180, 844, 844, 1.8, Tex.F_CONCRETE);
  carveRadonFrame(world, 296, 296, 728, 728, 1.6, CONTROL_FLOOR);
  carveSegment(world, { x: 86, y: 910 }, { x: 910, y: 86 }, 2.1, SERVICE_FLOOR);
  carveSegment(world, { x: 86, y: 86 }, { x: 910, y: 910 }, 1.35, Tex.F_CONCRETE);
}

function stampRadonStation(world: World, nextRoomId: { v: number }, x: number, y: number, serial: number): void {
  carveDisc(world, x, y, 8 + (serial % 3), serial % 4 === 0 ? CONTROL_FLOOR : SERVICE_FLOOR);
  const specs = [
    { type: RoomType.PRODUCTION, dx: -18, dy: -25, w: 16, h: 9, label: 'машинная' },
    { type: RoomType.OFFICE, dx: 8, dy: -24, w: 13, h: 8, label: 'учетная' },
    { type: RoomType.STORAGE, dx: -25, dy: 4, w: 11, h: 9, label: 'кладовая' },
    { type: RoomType.BATHROOM, dx: 16, dy: 6, w: 8, h: 6, label: 'санузел' },
    { type: RoomType.KITCHEN, dx: -14, dy: 17, w: 12, h: 7, label: 'чайная' },
    { type: RoomType.STORAGE, dx: 6, dy: 18, w: 9, h: 7, label: 'кабельный шкаф' },
  ] as const;
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const room = stampOptionalRadonRoom(
      world,
      nextRoomId,
      spec.type,
      x + spec.dx,
      y + spec.dy,
      spec.w,
      spec.h,
      `Радоновая станция ${serial + 1}: ${spec.label}`,
      i % 2 === 0 ? SERVICE_WALL : ADMIN_WALL,
      spec.type === RoomType.KITCHEN || spec.type === RoomType.BATHROOM ? Tex.F_TILE : i % 3 === 0 ? SERVICE_FLOOR : CONTROL_FLOOR,
    );
    if (!room) continue;
    decorateRadonSupportRoom(world, room, serial + i);
    connectRoomToPoint(world, room, sideToward(world, room, x, y), x, y, i % 5 === 0 ? DoorState.OPEN : DoorState.CLOSED);
  }
}

function stampRadonScanBooths(world: World, nextRoomId: { v: number }): void {
  const rows = [224, 416, 608, 800];
  const cols = [192, 352, 672, 832];
  let serial = 0;
  for (const row of rows) {
    for (let x = 72; x <= 936; x += 72) {
      if (Math.abs(x - CX) < 54) continue;
      const above = (serial & 1) === 0;
      const room = stampOptionalRadonRoom(
        world,
        nextRoomId,
        serial % 4 === 0 ? RoomType.OFFICE : RoomType.STORAGE,
        x - 4,
        row + (above ? -18 : 11),
        serial % 4 === 0 ? 9 : 7,
        serial % 3 === 0 ? 6 : 5,
        `Боковая будка скан-линии ${serial + 1}`,
        serial % 4 === 0 ? ADMIN_WALL : SERVICE_WALL,
        serial % 4 === 0 ? CONTROL_FLOOR : SERVICE_FLOOR,
      );
      serial++;
      if (!room) continue;
      decorateRadonSupportRoom(world, room, serial);
      connectRoomToPoint(world, room, above ? 'south' : 'north', x, row, DoorState.CLOSED);
    }
  }
  for (const col of cols) {
    for (let y = 72; y <= 936; y += 72) {
      if (Math.abs(y - CY) < 54) continue;
      const left = (serial & 1) === 0;
      const room = stampOptionalRadonRoom(
        world,
        nextRoomId,
        serial % 5 === 0 ? RoomType.SMOKING : RoomType.STORAGE,
        col + (left ? -18 : 11),
        y - 4,
        serial % 5 === 0 ? 8 : 6,
        serial % 5 === 0 ? 7 : 6,
        `Ниша обслуживания радоновой линии ${serial + 1}`,
        SERVICE_WALL,
        SERVICE_FLOOR,
      );
      serial++;
      if (!room) continue;
      decorateRadonSupportRoom(world, room, serial);
      connectRoomToPoint(world, room, left ? 'east' : 'west', col, y, DoorState.CLOSED);
    }
  }
}

function supportRoomSize(type: RoomType, compact: boolean, serial: number): { w: number; h: number } {
  if (compact) {
    if (type === RoomType.BATHROOM) return { w: 8, h: 6 };
    if (type === RoomType.KITCHEN || type === RoomType.SMOKING) return { w: 10, h: 7 };
    return { w: 12 + (serial % 2) * 2, h: 8 };
  }
  if (type === RoomType.MEDICAL || type === RoomType.PRODUCTION) return { w: 18, h: 11 };
  if (type === RoomType.KITCHEN || type === RoomType.OFFICE) return { w: 16, h: 9 };
  if (type === RoomType.BATHROOM) return { w: 10, h: 7 };
  return { w: 14 + (serial % 3) * 2, h: 9 };
}

function stampRadonFactionOutpost(world: World, nextRoomId: { v: number }, spec: RadonFactionOutpostSpec, serial: number): Room | null {
  const coreW = spec.compact ? 18 : 28;
  const coreH = spec.compact ? 12 : 16;
  const core = stampOptionalRadonRoom(
    world,
    nextRoomId,
    RoomType.HQ,
    spec.x,
    spec.y,
    coreW,
    coreH,
    spec.name,
    spec.wallTex,
    spec.floorTex,
  );
  if (!core) return null;
  sealRoomShell(world, core);
  decorateRadonSupportRoom(world, core, serial);
  connectRoomToPoint(world, core, sideToward(world, core, CX, CY), CX, CY, spec.hermeticDoor ?? DoorState.HERMETIC_OPEN);

  const offsets = [
    { dx: -20, dy: -13 },
    { dx: coreW + 7, dy: -10 },
    { dx: -18, dy: coreH + 8 },
    { dx: coreW + 5, dy: coreH + 7 },
    { dx: Math.floor(coreW / 2) - 8, dy: -(spec.compact ? 21 : 24) },
  ];
  for (let i = 0; i < spec.support.length; i++) {
    const type = spec.support[i];
    const size = supportRoomSize(type, !!spec.compact, serial + i);
    const offset = offsets[i % offsets.length];
    const room = stampOptionalRadonRoom(
      world,
      nextRoomId,
      type,
      spec.x + offset.dx,
      spec.y + offset.dy,
      size.w,
      size.h,
      `${spec.prefix}: ${supportRoomLabel(type)} ${i + 1}`,
      type === RoomType.BATHROOM || type === RoomType.MEDICAL ? Tex.TILE_W : spec.wallTex === Tex.HERMO_WALL ? SERVICE_WALL : spec.wallTex,
      type === RoomType.BATHROOM || type === RoomType.MEDICAL ? Tex.F_TILE : type === RoomType.KITCHEN ? Tex.F_LINO : spec.floorTex,
    );
    if (!room) continue;
    decorateRadonSupportRoom(world, room, serial + i);
    const coreCx = Math.round(core.x + core.w / 2);
    const coreCy = Math.round(core.y + core.h / 2);
    connectRoomToPoint(world, room, sideToward(world, room, coreCx, coreCy), coreCx, coreCy, DoorState.CLOSED);
  }
  return core;
}

function supportRoomLabel(type: RoomType): string {
  switch (type) {
    case RoomType.KITCHEN: return 'кухня';
    case RoomType.BATHROOM: return 'санузел';
    case RoomType.STORAGE: return 'склад';
    case RoomType.MEDICAL: return 'медпункт';
    case RoomType.PRODUCTION: return 'мастерская';
    case RoomType.OFFICE: return 'канцелярия';
    case RoomType.SMOKING: return 'курилка';
    default: return 'комната';
  }
}

function stampRadonMidAndMicroLayer(world: World, nextRoomId: { v: number }): void {
  carveRadonServiceGrid(world);
  let outpostSerial = 1000;
  for (const spec of RADON_FACTION_OUTPOSTS) {
    const core = stampRadonFactionOutpost(world, nextRoomId, spec, outpostSerial);
    if (core) outpostSerial += 17;
  }
  const xs = [112, 244, 376, 500, 624, 756, 888];
  const ys = [112, 244, 376, 500, 624, 756, 888];
  let serial = 0;
  for (const y of ys) {
    for (const x of xs) {
      const nearCentralHall = Math.abs(x - CX) < 64 && Math.abs(y - CY) < 64;
      const nearLift = (Math.abs(x - 836) < 74 && Math.abs(y - 188) < 74) || (Math.abs(x - 188) < 74 && Math.abs(y - 836) < 74);
      if (!nearCentralHall && !nearLift) stampRadonStation(world, nextRoomId, x, y, serial);
      serial++;
    }
  }
  stampRadonScanBooths(world, nextRoomId);
}

function registerRadonRouteCues(world: World, rooms: RadonRooms, keyContainer: WorldContainer): void {
  registerRouteCue(world, {
    id: 'radon_exchange_exposed_scanline',
    x: rooms.exchangeHall.x + 8.5,
    y: rooms.exchangeHall.y + 18.5,
    targetX: rooms.shutterEast.x + 12.5,
    targetY: rooms.shutterEast.y + 7.5,
    floor: RADON_EXCHANGE_BASE_FLOOR,
    roomId: rooms.exchangeHall.id,
    targetRoomId: rooms.shutterEast.id,
    zoneId: world.zoneMap[world.idx(rooms.exchangeHall.x + 8, rooms.exchangeHall.y + 18)],
    label: 'длинная скан-линия',
    hint: 'открытый коридор простреливается до восточной кассеты',
    targetName: rooms.shutterEast.name,
    color: '#bdf',
    tags: [RADON_EXCHANGE_ROUTE_ID, 'scanline', 'long_sight', 'exposed_route'],
    toneSeed: 7401,
    radius: 10,
    targetRadius: 3,
    cooldownSec: 32,
    heardText: 'Радоновая линия гудит ровно: восточная кассета видна слишком далеко.',
    followedText: 'Вы вышли на длинную скан-линию. Здесь быстро, но укрытия считают шаги.',
    ignoredText: 'Длинная линия осталась за бетоном. Обход дольше, зато не смотрит через весь этаж.',
    routeGroup: {
      id: 'radon_scanline_choice',
      lead: 'гул радоновой линии',
      risk: 'дальний прострел и открытая видимость',
      decision: 'пересечь линию быстро или искать сервисную хорду',
      reward: 'короткий проход к восточной кассете',
      mapLabel: 'скан-линия',
      mapHint: 'быстро, открыто, мало укрытий',
    },
  });

  registerRouteCue(world, {
    id: 'radon_exchange_service_chord',
    x: rooms.downLift.x + 8.5,
    y: rooms.downLift.y + 8.5,
    targetX: rooms.serviceChord.x + 14.5,
    targetY: rooms.serviceChord.y + 7.5,
    floor: RADON_EXCHANGE_BASE_FLOOR,
    roomId: rooms.downLift.id,
    targetRoomId: rooms.serviceChord.id,
    zoneId: world.zoneMap[world.idx(rooms.downLift.x + 8, rooms.downLift.y + 8)],
    label: 'сервисная хорда',
    hint: 'бетонная диагональ режет скан-линии без дальнего обзора',
    targetName: rooms.serviceChord.name,
    color: '#8cf',
    tags: [RADON_EXCHANGE_ROUTE_ID, 'service_chord', 'covered_route', 'route_choice'],
    toneSeed: 7402,
    radius: 9,
    targetRadius: 3,
    cooldownSec: 34,
    heardText: 'Под плитами стучит сервисная хорда: длиннее, зато заслонки не смотрят прямо.',
    followedText: 'Сервисная хорда найдена. Бетон держит обзор коротким и выводит к верхней кабине.',
    ignoredText: 'Сервисная хорда ушла в сторону. Открытые линии снова стали короче по времени.',
    routeGroup: {
      id: 'radon_service_chord',
      lead: 'низкий стук под плитой',
      risk: 'дольше и теснее',
      decision: 'идти сервисным обходом или резать через скан-линию',
      reward: 'укрытый путь между лифтами',
      mapLabel: 'сервисная хорда',
      mapHint: 'укрытый обход',
    },
  });

  registerRouteCue(world, {
    id: 'radon_exchange_projection_key',
    x: rooms.projectionKey.x + 6.5,
    y: rooms.projectionKey.y + 5.5,
    targetX: keyContainer.x + 0.5,
    targetY: keyContainer.y + 0.5,
    floor: RADON_EXCHANGE_BASE_FLOOR,
    roomId: rooms.projectionKey.id,
    targetRoomId: rooms.projectionKey.id,
    zoneId: world.zoneMap[world.idx(rooms.projectionKey.x + 6, rooms.projectionKey.y + 5)],
    label: 'проекционный ключ',
    hint: 'чужой лоток открывает часть радоновых заслонок',
    targetName: keyContainer.name,
    color: '#ffd86b',
    tags: [RADON_EXCHANGE_ROUTE_ID, 'projection_key', 'theft', 'shutter'],
    toneSeed: 7403,
    radius: 8,
    targetRadius: 2.5,
    cooldownSec: 40,
    heardText: 'В комнате проекции щелкает ключ: заслонки слушают его лучше приказа.',
    followedText: 'Лоток проекционного ключа рядом. Взять можно как кражу или оставить длинной линии её право.',
    ignoredText: 'Ключ остался в лотке. Закрытые створки всё ещё требуют чужую руку.',
    routeGroup: {
      id: 'radon_projection_key',
      lead: 'щелчок чужого ключа',
      risk: 'кража у операторов обменника',
      decision: 'украсть ключ или идти без коротких заслонок',
      reward: 'часть закрытых створок признает проход',
      mapLabel: 'ключ заслонок',
      mapHint: 'кража открывает короткий ход',
    },
  });
}

function stampRadonRooms(world: World): RadonRooms {
  const nextRoomId = { v: 0 };
  const exchangeHall = stampNamedRoom(world, nextRoomId, RoomType.COMMON, 488, 494, 48, 36, RADON_EXCHANGE_ROOM_NAMES.exchangeHall, ADMIN_WALL, CONTROL_FLOOR);
  const zeroRadius = stampNamedRoom(world, nextRoomId, RoomType.HQ, 490, 456, 44, 24, RADON_EXCHANGE_ROOM_NAMES.zeroRadius, ADMIN_WALL, SCAN_FLOOR);
  const shutterNorth = stampNamedRoom(world, nextRoomId, RoomType.PRODUCTION, 492, 250, 40, 18, RADON_EXCHANGE_ROOM_NAMES.shutterNorth, SERVICE_WALL, SERVICE_FLOOR);
  const shutterEast = stampNamedRoom(world, nextRoomId, RoomType.PRODUCTION, 714, 496, 42, 18, RADON_EXCHANGE_ROOM_NAMES.shutterEast, SERVICE_WALL, SERVICE_FLOOR);
  const serviceChord = stampNamedRoom(world, nextRoomId, RoomType.CORRIDOR, 330, 654, 48, 16, RADON_EXCHANGE_ROOM_NAMES.serviceChord, SERVICE_WALL, SERVICE_FLOOR);
  const projectionKey = stampNamedRoom(world, nextRoomId, RoomType.OFFICE, 620, 356, 34, 20, RADON_EXCHANGE_ROOM_NAMES.projectionKey, ADMIN_WALL, CONTROL_FLOOR);
  const blindWedge = stampNamedRoom(world, nextRoomId, RoomType.STORAGE, 704, 692, 32, 22, RADON_EXCHANGE_ROOM_NAMES.blindWedge, BLIND_WALL, Tex.F_CONCRETE);
  const upLift = stampNamedRoom(world, nextRoomId, RoomType.CORRIDOR, 820, 178, 30, 24, RADON_EXCHANGE_ROOM_NAMES.upLift, SERVICE_WALL, SCAN_FLOOR);
  const downLift = stampNamedRoom(world, nextRoomId, RoomType.CORRIDOR, 174, 822, 30, 24, RADON_EXCHANGE_ROOM_NAMES.downLift, SERVICE_WALL, SCAN_FLOOR);

  connectRoomToPoint(world, exchangeHall, 'north', 512, 474);
  connectRoomToPoint(world, exchangeHall, 'south', 512, 550);
  connectRoomToPoint(world, exchangeHall, 'west', 472, 512);
  connectRoomToPoint(world, exchangeHall, 'east', 552, 512);
  connectRoomToPoint(world, zeroRadius, 'south', 512, 490, DoorState.HERMETIC_OPEN);
  connectRoomToPoint(world, shutterNorth, 'south', 512, 288, DoorState.CLOSED);
  connectRoomToPoint(world, shutterEast, 'west', 676, 512, DoorState.CLOSED);
  connectRoomToPoint(world, serviceChord, 'north', 408, 608, DoorState.CLOSED);
  connectRoomToPoint(world, projectionKey, 'south', 624, 400, DoorState.LOCKED, RADON_EXCHANGE_PROJECTION_KEY);
  connectRoomToPoint(world, blindWedge, 'west', 672, 608, DoorState.HERMETIC_CLOSED, RADON_EXCHANGE_PROJECTION_KEY);
  connectRoomToPoint(world, upLift, 'south', 780, 236);
  connectRoomToPoint(world, downLift, 'north', 236, 780);

  const rooms = { exchangeHall, zeroRadius, shutterNorth, shutterEast, serviceChord, projectionKey, blindWedge, upLift, downLift };
  let serial = 0;
  for (const room of Object.values(rooms)) decorateControlRoom(world, room, serial++);
  stampRadonMidAndMicroLayer(world, nextRoomId);
  return rooms;
}

function buildRadonExchangeGeometry(world: World): void {
  world.wallTex.fill(ADMIN_WALL);
  world.floorTex.fill(SCAN_FLOOR);
  for (const line of RADON_LINES) carveRadonLine(world, line);
  carveSegment(world, { x: 0, y: CY }, { x: EDGE, y: CY }, 2.4, SCAN_FLOOR);
  carveSegment(world, { x: CX, y: 0 }, { x: CX, y: EDGE }, 2.4, SCAN_FLOOR);
  carveSegment(world, { x: 160, y: 874 }, { x: 864, y: 170 }, 3.5, SERVICE_FLOOR);
  carveSegment(world, { x: 172, y: 828 }, { x: 342, y: 664 }, 3.2, SERVICE_FLOOR);
  carveSegment(world, { x: 376, y: 652 }, { x: 836, y: 192 }, 3.2, SERVICE_FLOOR);

  for (const p of CONTROL_POINTS) carveDisc(world, p.x, p.y, 5.5, CONTROL_FLOOR);

  stampBlindWedge(world, 512, 512, -0.18, 0.28, 128, 354);
  stampBlindWedge(world, 512, 512, 2.33, 0.24, 150, 398);
  stampBlindWedge(world, 512, 512, 1.33, 0.18, 190, 430);
  stampBlindWedge(world, 512, 512, -2.06, 0.2, 190, 430);

  placeCover(world);
}

function isRadonTerritoryPassable(cell: Cell): boolean {
  return cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.LIFT || cell === Cell.WATER;
}

function radonRoomOwnerHint(room: Room): TerritoryOwner | null {
  const name = room.name.toLowerCase();
  const outpost = RADON_FACTION_OUTPOSTS.find(spec => spec.name === room.name || room.name.startsWith(`${spec.prefix}:`));
  if (outpost) return outpost.owner;
  if (room.name === RADON_EXCHANGE_ROOM_NAMES.zeroRadius) return ZoneFaction.LIQUIDATOR;
  if (room.name === RADON_EXCHANGE_ROOM_NAMES.shutterNorth || room.name === RADON_EXCHANGE_ROOM_NAMES.shutterEast) return ZoneFaction.LIQUIDATOR;
  if (room.name === RADON_EXCHANGE_ROOM_NAMES.exchangeHall) return ZoneFaction.LIQUIDATOR;
  if (room.name === RADON_EXCHANGE_ROOM_NAMES.projectionKey) return ZoneFaction.SCIENTIST;
  if (room.name === RADON_EXCHANGE_ROOM_NAMES.blindWedge) return ZoneFaction.CULTIST;
  if (room.name === RADON_EXCHANGE_ROOM_NAMES.serviceChord) return ZoneFaction.WILD;
  if (name.includes('граждан')) return ZoneFaction.CITIZEN;
  if (name.includes('ликвидатор') || name.includes('створок') || name.includes('отсечк')) return ZoneFaction.LIQUIDATOR;
  if (name.includes('нии') || name.includes('учетная') || name.includes('проекци')) return ZoneFaction.SCIENTIST;
  if (name.includes('культ') || name.includes('слеп')) return ZoneFaction.CULTIST;
  if (name.includes('дикий') || name.includes('дикие') || name.includes('сервисной хорды')) return ZoneFaction.WILD;
  return null;
}

function roomCenterPoint(room: Room): Point {
  return { x: worldSafeRound(room.x + room.w / 2), y: worldSafeRound(room.y + room.h / 2) };
}

function worldSafeRound(value: number): number {
  return Math.max(0, Math.min(EDGE, Math.round(value)));
}

function collectRadonTerritoryAnchors(world: World): RadonTerritoryAnchor[] {
  const anchors: RadonTerritoryAnchor[] = [];
  const seenOwner = new Set<TerritoryOwner>();
  for (const room of world.rooms) {
    if (!room || room.type !== RoomType.HQ) continue;
    const owner = radonRoomOwnerHint(room);
    if (owner === null) continue;
    const center = roomCenterPoint(room);
    anchors.push({
      owner,
      x: center.x,
      y: center.y,
      strength: owner === ZoneFaction.LIQUIDATOR ? 16 : owner === ZoneFaction.SCIENTIST ? 13 : 10,
    });
    seenOwner.add(owner);
  }
  const fallbacks: readonly RadonTerritoryAnchor[] = [
    { owner: ZoneFaction.CITIZEN, x: 146, y: 134, strength: 8 },
    { owner: ZoneFaction.LIQUIDATOR, x: 512, y: 468, strength: 18 },
    { owner: ZoneFaction.SCIENTIST, x: 716, y: 258, strength: 12 },
    { owner: ZoneFaction.CULTIST, x: 778, y: 772, strength: 8 },
    { owner: ZoneFaction.WILD, x: 226, y: 708, strength: 8 },
  ];
  for (const fallback of fallbacks) {
    if (!seenOwner.has(fallback.owner)) anchors.push(fallback);
  }
  return anchors;
}

function nearestRadonAnchorOwner(world: World, x: number, y: number, anchors: readonly RadonTerritoryAnchor[]): TerritoryOwner {
  let best = anchors[0]?.owner ?? ZoneFaction.LIQUIDATOR;
  let bestScore = Infinity;
  for (const anchor of anchors) {
    const score = world.dist2(x, y, anchor.x, anchor.y) / Math.max(1, anchor.strength);
    if (score < bestScore) {
      bestScore = score;
      best = anchor.owner;
    }
  }
  return best;
}

function claimRadonTerritoryCell(
  world: World,
  idx: number,
  owner: TerritoryOwner,
  ownerQueues: number[][],
  ownerCounts: Uint32Array,
): boolean {
  if (world.factionControl[idx] !== TERRITORY_UNASSIGNED) return false;
  if (!isRadonTerritoryPassable(world.cells[idx] as Cell)) return false;
  world.factionControl[idx] = owner;
  ownerCounts[owner]++;
  ownerQueues[owner].push(idx);
  return true;
}

function claimRadonRoomTerritory(
  world: World,
  room: Room,
  owner: TerritoryOwner,
  ownerQueues: number[][],
  ownerCounts: Uint32Array,
): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      claimRadonTerritoryCell(world, world.idx(room.x + dx, room.y + dy), owner, ownerQueues, ownerCounts);
    }
  }
}

function seedRadonTerritory(
  world: World,
  anchors: readonly RadonTerritoryAnchor[],
  ownerQueues: number[][],
  ownerCounts: Uint32Array,
): number {
  let passable = 0;
  world.factionControl.fill(TERRITORY_UNASSIGNED);
  for (let i = 0; i < W * W; i++) {
    if (isRadonTerritoryPassable(world.cells[i] as Cell)) passable++;
  }
  for (const room of world.rooms) {
    if (!room) continue;
    const owner = radonRoomOwnerHint(room);
    if (owner !== null) claimRadonRoomTerritory(world, room, owner, ownerQueues, ownerCounts);
  }
  for (const anchor of anchors) {
    const r = Math.max(4, Math.round(anchor.strength));
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        claimRadonTerritoryCell(world, world.idx(anchor.x + dx, anchor.y + dy), anchor.owner, ownerQueues, ownerCounts);
      }
    }
  }
  return passable;
}

function expandOneRadonTerritoryCell(
  world: World,
  owner: TerritoryOwner,
  ownerQueues: number[][],
  ownerHeads: Uint32Array,
  ownerCounts: Uint32Array,
): boolean {
  const queue = ownerQueues[owner];
  while (ownerHeads[owner] < queue.length) {
    const idx = queue[ownerHeads[owner]++];
    const x = idx % W;
    const y = (idx / W) | 0;
    const dirs = (idx & 1) === 0
      ? [[1, 0], [0, 1], [-1, 0], [0, -1]] as const
      : [[0, -1], [-1, 0], [0, 1], [1, 0]] as const;
    for (const [dx, dy] of dirs) {
      if (claimRadonTerritoryCell(world, world.idx(x + dx, y + dy), owner, ownerQueues, ownerCounts)) return true;
    }
  }
  return false;
}

function spreadRadonPassableTerritory(world: World, passableCells: number, ownerQueues: number[][], ownerCounts: Uint32Array): void {
  const ownerHeads = new Uint32Array(8);
  const targetCells = new Uint32Array(8);
  for (const target of RADON_TERRITORY_TARGETS) targetCells[target.owner] = Math.max(1, Math.round(passableCells * target.share));
  let assigned = 0;
  for (const target of RADON_TERRITORY_TARGETS) assigned += ownerCounts[target.owner];
  let safety = passableCells * 6;
  while (assigned < passableCells && safety-- > 0) {
    let progressed = false;
    for (const target of RADON_TERRITORY_TARGETS) {
      const owner = target.owner;
      const budget = Math.max(1, Math.round(target.share * 20));
      for (let i = 0; i < budget && ownerCounts[owner] < targetCells[owner]; i++) {
        if (!expandOneRadonTerritoryCell(world, owner, ownerQueues, ownerHeads, ownerCounts)) break;
        assigned++;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
}

function fillUnassignedRadonTerritory(world: World, anchors: readonly RadonTerritoryAnchor[], ownerQueues: number[][], ownerCounts: Uint32Array): void {
  for (let i = 0; i < W * W; i++) {
    if (world.factionControl[i] !== TERRITORY_UNASSIGNED) continue;
    if (!isRadonTerritoryPassable(world.cells[i] as Cell)) continue;
    const owner = nearestRadonAnchorOwner(world, i % W, (i / W) | 0, anchors);
    world.factionControl[i] = owner;
    ownerCounts[owner]++;
    ownerQueues[owner].push(i);
  }

  for (let pass = 0; pass < 8; pass++) {
    let changed = 0;
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const idx = world.idx(x, y);
        if (world.factionControl[idx] !== TERRITORY_UNASSIGNED) continue;
        const candidates = [
          world.factionControl[world.idx(x + 1, y)],
          world.factionControl[world.idx(x - 1, y)],
          world.factionControl[world.idx(x, y + 1)],
          world.factionControl[world.idx(x, y - 1)],
        ];
        const owner = candidates.find(value => value !== TERRITORY_UNASSIGNED);
        if (owner === undefined) continue;
        world.factionControl[idx] = owner;
        changed++;
      }
    }
    if (changed === 0) break;
  }

  for (let i = 0; i < W * W; i++) {
    if (world.factionControl[i] !== TERRITORY_UNASSIGNED) continue;
    world.factionControl[i] = nearestRadonAnchorOwner(world, i % W, (i / W) | 0, anchors);
  }
}

function pinRadonAuthoredRoomTerritory(world: World): void {
  for (const room of world.rooms) {
    if (!room) continue;
    const owner = radonRoomOwnerHint(room);
    if (owner === null) continue;
    for (let dy = 0; dy < room.h; dy++) {
      for (let dx = 0; dx < room.w; dx++) {
        const idx = world.idx(room.x + dx, room.y + dy);
        if (!isRadonTerritoryPassable(world.cells[idx] as Cell)) continue;
        world.factionControl[idx] = owner;
      }
    }
  }
}

function syncRadonZonesFromTerritory(world: World): void {
  const counts = new Uint16Array(8);
  for (const zone of world.zones) {
    counts.fill(0);
    for (let dy = -68; dy <= 68; dy += 4) {
      for (let dx = -68; dx <= 68; dx += 4) {
        const idx = world.idx(zone.cx + dx, zone.cy + dy);
        if (world.zoneMap[idx] !== zone.id) continue;
        counts[world.factionControl[idx]]++;
      }
    }
    let best = ZoneFaction.LIQUIDATOR;
    let bestCount = -1;
    for (const target of RADON_TERRITORY_TARGETS) {
      const count = counts[target.owner] ?? 0;
      if (count > bestCount) {
        best = target.owner;
        bestCount = count;
      }
    }
    zone.faction = best;
    zone.level = Math.max(zone.level, best === ZoneFaction.CULTIST || best === ZoneFaction.WILD ? 5 : best === ZoneFaction.LIQUIDATOR || best === ZoneFaction.SCIENTIST ? 4 : 3);
    const hq = world.rooms.find(room => room.type === RoomType.HQ && radonRoomOwnerHint(room) === best && world.zoneMap[world.idx(room.x + (room.w >> 1), room.y + (room.h >> 1))] === zone.id);
    zone.hqRoomId = hq?.id ?? zone.hqRoomId;
  }
}

export function applyRadonExchangeTerritory(world: World): void {
  const anchors = collectRadonTerritoryAnchors(world);
  const ownerQueues = Array.from({ length: 8 }, () => [] as number[]);
  const ownerCounts = new Uint32Array(8);
  const passableCells = seedRadonTerritory(world, anchors, ownerQueues, ownerCounts);
  spreadRadonPassableTerritory(world, passableCells, ownerQueues, ownerCounts);
  fillUnassignedRadonTerritory(world, anchors, ownerQueues, ownerCounts);
  pinRadonAuthoredRoomTerritory(world);
  syncRadonZonesFromTerritory(world);
}

export function generateRadonExchangeDesignFloor(): FloorGeneration {
  const world = new World();
  buildRadonExchangeGeometry(world);
  const rooms = stampRadonRooms(world);

  for (const shutter of SHUTTER_DOORS) addShutterDoorAt(world, shutter.x, shutter.y, shutter.axis, shutter.state, shutter.keyId);
  placeLift(world, 836, 188, LiftDirection.UP);
  placeLift(world, 188, 836, LiftDirection.DOWN);

  generateZones(world);
  const nextContainerId = { v: 1 };
  addContainer(world, nextContainerId, rooms.projectionKey, rooms.projectionKey.x + 18, rooms.projectionKey.y + 10, ContainerKind.CASHBOX, 'Лоток проекционного ключа', [
    { defId: RADON_EXCHANGE_PROJECTION_KEY, count: 1 },
    { defId: 'container_key_label', count: 1 },
    { defId: 'filter_receipt', count: 1 },
  ], ['projection_key', 'shutter', 'theft', 'documents'], 'owner', 'оператор радоновой проекции');
  addContainer(world, nextContainerId, rooms.blindWedge, rooms.blindWedge.x + 15, rooms.blindWedge.y + 11, ContainerKind.SECRET_STASH, 'Слепой ящик дозиметристов', [
    { defId: 'gasmask_filter', count: 1 },
    { defId: 'overexposed_photo', count: 1 },
    { defId: 'lift_scheme', count: 1 },
  ], ['blind_wedge', 'reward', 'radon'], 'secret');

  registerRadonRouteCues(world, rooms, world.containers[0]);
  ensureConnectivity(world, CX + 0.5, CY + 0.5);
  sanitizeDoors(world);
  world.rebuildContainerMap();
  world.bakeLights();
  world.markFogDirty();

  return {
    world,
    entities: [],
    spawnX: CX + 0.5,
    spawnY: CY + 0.5,
  };
}

function liftReachableWithoutGate(world: World, spawnX: number, spawnY: number, direction: LiftDirection): boolean {
  const audit = auditReachability(world, world.idx(Math.floor(spawnX), Math.floor(spawnY)));
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
      const ni = world.idx(x + dx, y + dy);
      if (audit.reachable[ni] && audit.gateMask[ni] === REACH_GATE_NONE) return true;
    }
  }
  return false;
}

function longestRunOnRows(world: World, rows: readonly number[], tex: Tex): number {
  let best = 0;
  for (const y of rows) {
    let run = 0;
    for (let x = 0; x < W; x++) {
      const idx = world.idx(x, y);
      const passable = (world.cells[idx] === Cell.FLOOR || world.cells[idx] === Cell.DOOR || world.cells[idx] === Cell.LIFT)
        && world.floorTex[idx] === tex;
      if (passable) {
        run++;
        if (run > best) best = run;
      } else {
        run = 0;
      }
    }
  }
  return best;
}

function longestRunOnCols(world: World, cols: readonly number[], tex: Tex): number {
  let best = 0;
  for (const x of cols) {
    let run = 0;
    for (let y = 0; y < W; y++) {
      const idx = world.idx(x, y);
      const passable = (world.cells[idx] === Cell.FLOOR || world.cells[idx] === Cell.DOOR || world.cells[idx] === Cell.LIFT)
        && world.floorTex[idx] === tex;
      if (passable) {
        run++;
        if (run > best) best = run;
      } else {
        run = 0;
      }
    }
  }
  return best;
}

export function measureRadonExchangeMetrics(gen: FloorGeneration): RadonExchangeMetrics {
  let scanLineCells = 0;
  let serviceChordCells = 0;
  let blindWedgeCells = 0;
  let coverCells = 0;
  for (let i = 0; i < W * W; i++) {
    const cell = gen.world.cells[i];
    if (cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.LIFT) {
      if (gen.world.floorTex[i] === SCAN_FLOOR) scanLineCells++;
      if (gen.world.floorTex[i] === SERVICE_FLOOR) serviceChordCells++;
    }
    if (gen.world.fog[i] >= 52) blindWedgeCells++;
    const feature = gen.world.features[i] as Feature;
    if (feature === Feature.DESK || feature === Feature.SHELF || feature === Feature.MACHINE) coverCells++;
  }
  const shutterDoors = [...gen.world.doors.values()].filter(door =>
    door.state === DoorState.HERMETIC_CLOSED ||
    door.state === DoorState.HERMETIC_OPEN ||
    door.keyId === RADON_EXCHANGE_PROJECTION_KEY).length;
  const projectionKeyContainers = gen.world.containers.filter(container => container.tags.includes('projection_key')).length;
  const controlRooms = gen.world.rooms.filter(room =>
    room.name.includes('заслон') ||
    room.name.includes('радиус') ||
    room.name.includes('проекцион') ||
    room.name.includes('обмен')).length;
  const horizontalRun = longestRunOnRows(gen.world, [CY - 288, CY - 96, CY, CY + 96, CY + 288], SCAN_FLOOR);
  const verticalRun = longestRunOnCols(gen.world, [CX - 320, CX - 160, CX, CX + 160, CX + 320], SCAN_FLOOR);
  return {
    routeId: RADON_EXCHANGE_ROUTE_ID,
    z: RADON_EXCHANGE_Z,
    scanLineCells,
    serviceChordCells,
    blindWedgeCells,
    shutterDoors,
    projectionKeyContainers,
    controlRooms,
    coverCells,
    longestScanRun: Math.max(horizontalRun, verticalRun),
    ungatedUpLiftReachable: liftReachableWithoutGate(gen.world, gen.spawnX, gen.spawnY, LiftDirection.UP),
    ungatedDownLiftReachable: liftReachableWithoutGate(gen.world, gen.spawnX, gen.spawnY, LiftDirection.DOWN),
  };
}
