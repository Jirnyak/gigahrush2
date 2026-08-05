/* -- Design floor: shahta_atrium / Шахта-атриум ---------------- */

import {
  AIGoal,
  Cell,
  ContainerKind,
  EntityType,
  Faction,
  Feature,
  FloorLevel,
  LiftDirection,
  MonsterKind,
  RoomType,
  Tex,
  W,
  ZoneFaction,
  type Entity,
  type Room,
  type TerritoryOwner,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { ITEMS } from '../../data/catalog';
import { MONSTERS } from '../../entities/monster';
import { Spr } from '../../render/sprite_index';
import { placeEmergencyPanel } from '../../systems/emergency_panels';
import { registerRouteCue } from '../../systems/route_cues';
import { randomRPG } from '../../systems/rpg';
import { setTerritoryOwnerAtIndex, syncZoneMetadataFromTerritory } from '../../systems/territory';
import {
  ensureConnectivity,
  generateZones,
  placeDoor,
  sanitizeDoors,
  stampRoom,
} from '../shared';
import type { FloorGeneration } from '../floor_manifest';

export const DESIGN_FLOOR_ID = 'shahta_atrium' as const;
export const SHAHTA_ATRIUM_ROUTE_Z = -24 as const;
export const SHAHTA_ATRIUM_BASE_FLOOR = FloorLevel.MAINTENANCE;

const CX = W >> 1;
const CY = W >> 1;
const INNER_R = 138;
const MID_R = 212;
const OUTER_R = 304;
const VOID_R = 116;

const SHAHTA_MICRO_TYPES: readonly RoomType[] = [
  RoomType.STORAGE,
  RoomType.PRODUCTION,
  RoomType.OFFICE,
  RoomType.BATHROOM,
  RoomType.COMMON,
  RoomType.STORAGE,
  RoomType.SMOKING,
  RoomType.MEDICAL,
];

interface ShahtaHqSupportSpec {
  type: RoomType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hermetic?: boolean;
}

interface ShahtaHqSpec {
  owner: TerritoryOwner;
  key: string;
  hall: [number, number, number, number];
  connect: [number, number];
  wallTex: Tex;
  floorTex: Tex;
  support: readonly ShahtaHqSupportSpec[];
}

interface ShahtaHqCompound {
  owner: TerritoryOwner;
  hall: Room;
  core: Room;
  support: Room[];
}

interface ShahtaMidMicroStats {
  serviceCells: number;
  microRooms: number;
  hqCompounds: number;
}

const SHAHTA_HQ_SPECS: readonly ShahtaHqSpec[] = [
  {
    owner: ZoneFaction.LIQUIDATOR,
    key: 'ликвидаторов восточной шахты',
    hall: [842, 430, 94, 7],
    connect: [936, 464],
    wallTex: Tex.METAL,
    floorTex: Tex.F_CONCRETE,
    support: [
      { type: RoomType.HQ, name: 'Гермоядро ликвидаторов восточной шахты', x: 870, y: 438, w: 28, h: 14, hermetic: true },
      { type: RoomType.STORAGE, name: 'Оружейный шкаф ликвидаторов шахты', x: 842, y: 414, w: 21, h: 10 },
      { type: RoomType.OFFICE, name: 'Журнал мостовых нарядов', x: 866, y: 414, w: 22, h: 10 },
      { type: RoomType.MEDICAL, name: 'Перевязочная страховочных тросов', x: 902, y: 438, w: 19, h: 10 },
      { type: RoomType.BATHROOM, name: 'Санузел восточного поста', x: 923, y: 438, w: 11, h: 10 },
      { type: RoomType.COMMON, name: 'Общая караула обода', x: 898, y: 414, w: 27, h: 10 },
      { type: RoomType.PRODUCTION, name: 'Мастерская мостовых щитов', x: 842, y: 438, w: 24, h: 12 },
    ],
  },
  {
    owner: ZoneFaction.CITIZEN,
    key: 'граждан ремонтного притвора',
    hall: [122, 274, 94, 7],
    connect: [86, 286],
    wallTex: Tex.PANEL,
    floorTex: Tex.F_LINO,
    support: [
      { type: RoomType.HQ, name: 'Гермоядро граждан ремонтного притвора', x: 150, y: 282, w: 26, h: 13, hermetic: true },
      { type: RoomType.KITCHEN, name: 'Кухня сухого пайка шахты', x: 122, y: 258, w: 22, h: 10 },
      { type: RoomType.BATHROOM, name: 'Санузел гражданского притвора', x: 146, y: 258, w: 12, h: 10 },
      { type: RoomType.STORAGE, name: 'Кладовая семейных касок', x: 180, y: 282, w: 21, h: 10 },
      { type: RoomType.MEDICAL, name: 'Медуголок ремонтных семей', x: 160, y: 258, w: 21, h: 10 },
      { type: RoomType.COMMON, name: 'Общая ожидания безопасного обхода', x: 122, y: 282, w: 24, h: 12 },
    ],
  },
  {
    owner: ZoneFaction.SCIENTIST,
    key: 'ученых тросовой лаборатории',
    hall: [340, 146, 96, 7],
    connect: [512, 150],
    wallTex: Tex.PIPE,
    floorTex: Tex.F_TILE,
    support: [
      { type: RoomType.HQ, name: 'Гермоядро НИИ тросовой лаборатории', x: 370, y: 154, w: 26, h: 13, hermetic: true },
      { type: RoomType.MEDICAL, name: 'Измерительная травм от высоты', x: 340, y: 130, w: 24, h: 10 },
      { type: RoomType.OFFICE, name: 'Кабинет формулы тяги', x: 366, y: 130, w: 22, h: 10 },
      { type: RoomType.PRODUCTION, name: 'Стенд натяжения мостов', x: 400, y: 154, w: 26, h: 12 },
      { type: RoomType.STORAGE, name: 'Архив датчиков провала', x: 390, y: 130, w: 22, h: 10 },
      { type: RoomType.BATHROOM, name: 'Санузел НИИ у обрыва', x: 418, y: 130, w: 12, h: 10 },
    ],
  },
  {
    owner: ZoneFaction.CULTIST,
    key: 'культа нижнего эха',
    hall: [158, 846, 96, 7],
    connect: [150, 874],
    wallTex: Tex.ROTTEN,
    floorTex: Tex.F_CARPET,
    support: [
      { type: RoomType.HQ, name: 'Гермоядро культа нижнего эха', x: 190, y: 854, w: 24, h: 13, hermetic: true },
      { type: RoomType.COMMON, name: 'Тихая комната слушания шахты', x: 158, y: 830, w: 25, h: 10 },
      { type: RoomType.STORAGE, name: 'Кладовая свечей у провала', x: 216, y: 854, w: 20, h: 10 },
      { type: RoomType.KITCHEN, name: 'Кухня черного кипятка', x: 184, y: 830, w: 21, h: 10 },
      { type: RoomType.BATHROOM, name: 'Санузел следа нижнего эха', x: 238, y: 854, w: 12, h: 10 },
      { type: RoomType.SMOKING, name: 'Курилка шепчущей решетки', x: 208, y: 830, w: 24, h: 10 },
    ],
  },
  {
    owner: ZoneFaction.WILD,
    key: 'диких южной клети',
    hall: [708, 846, 96, 7],
    connect: [874, 874],
    wallTex: Tex.DARK,
    floorTex: Tex.F_CONCRETE,
    support: [
      { type: RoomType.HQ, name: 'Гермоядро диких южной клети', x: 738, y: 854, w: 24, h: 13, hermetic: true },
      { type: RoomType.STORAGE, name: 'Разобранная кладовая южной клети', x: 708, y: 830, w: 24, h: 10 },
      { type: RoomType.SMOKING, name: 'Курилка сорванных перил', x: 764, y: 854, w: 20, h: 10 },
      { type: RoomType.COMMON, name: 'Общий угол самозахвата шахты', x: 734, y: 830, w: 25, h: 10 },
      { type: RoomType.KITCHEN, name: 'Печь сухих консервов', x: 782, y: 854, w: 18, h: 10 },
      { type: RoomType.BATHROOM, name: 'Санузел ободранной клети', x: 762, y: 830, w: 12, h: 10 },
    ],
  },
];

export interface ShahtaAtriumBridgeState {
  id: string;
  name: string;
  exposedCells: number;
  coverCells: number;
  repairable: boolean;
  gapCells: number;
}

export interface ShahtaAtriumState {
  routeId: typeof DESIGN_FLOOR_ID;
  z: typeof SHAHTA_ATRIUM_ROUTE_Z;
  baseFloor: typeof SHAHTA_ATRIUM_BASE_FLOOR;
  voidCells: number;
  ringCells: number;
  bridgeCount: number;
  serviceBypassCells: number;
  outerServiceCells: number;
  microRoomCount: number;
  hqCompoundCount: number;
  coverIslands: number;
  losCoverScore: number;
  repairableBridgeId: string;
  bridges: ShahtaAtriumBridgeState[];
}

export interface ShahtaAtriumGeneration extends FloorGeneration {
  shahtaAtriumState: ShahtaAtriumState;
}

interface BridgeBuild {
  state: ShahtaAtriumBridgeState;
  cells: number[];
}

function logicalRoom(
  world: World,
  type: RoomType,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  wallTex: Tex,
  floorTex: Tex,
): Room {
  const room: Room = {
    id: world.rooms.length,
    type,
    x: world.wrap(x),
    y: world.wrap(y),
    w,
    h,
    doors: [],
    sealed: false,
    name,
    apartmentId: -1,
    wallTex,
    floorTex,
  };
  world.rooms[room.id] = room;
  return room;
}

function paintBoxRoom(world: World, room: Room, wallTex: Tex, floorTex: Tex): void {
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const i = world.idx(room.x + dx, room.y + dy);
      if (world.cells[i] === Cell.WALL) world.wallTex[i] = wallTex;
    }
  }
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const i = world.idx(room.x + dx, room.y + dy);
      world.floorTex[i] = floorTex;
    }
  }
}

function boxRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
): Room {
  const room = stampRoom(world, world.rooms.length, type, x, y, w, h, -1);
  room.name = name;
  paintBoxRoom(world, room, wallTex, floorTex);
  return room;
}

function setFloor(world: World, room: Room, x: number, y: number, floorTex = room.floorTex): boolean {
  const i = world.idx(x, y);
  if (world.cells[i] === Cell.LIFT) return false;
  world.cells[i] = Cell.FLOOR;
  world.roomMap[i] = room.id;
  world.floorTex[i] = floorTex;
  world.wallTex[i] = room.wallTex;
  world.features[i] = Feature.NONE;
  world.fog[i] = 0;
  return true;
}

function setAbyss(world: World, x: number, y: number): boolean {
  const i = world.idx(x, y);
  if (world.cells[i] === Cell.LIFT || world.features[i] === Feature.LIFT_BUTTON) return false;
  world.cells[i] = Cell.ABYSS;
  world.roomMap[i] = -1;
  world.floorTex[i] = Tex.F_ABYSS;
  world.wallTex[i] = Tex.DARK;
  world.features[i] = Feature.NONE;
  world.fog[i] = 34;
  return true;
}

function setFeature(world: World, x: number, y: number, feature: Feature): boolean {
  const i = world.idx(x, y);
  if (world.cells[i] !== Cell.FLOOR && world.cells[i] !== Cell.WATER) return false;
  world.features[i] = feature;
  return true;
}

function setCoverWall(world: World, x: number, y: number): boolean {
  const i = world.idx(x, y);
  if (world.cells[i] !== Cell.FLOOR) return false;
  world.cells[i] = Cell.WALL;
  world.roomMap[i] = -1;
  world.wallTex[i] = Tex.METAL;
  world.features[i] = Feature.NONE;
  return true;
}

function carveRect(world: World, room: Room, x: number, y: number, w: number, h: number, floorTex = room.floorTex): number {
  let count = 0;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      if (setFloor(world, room, x + dx, y + dy, floorTex)) count++;
    }
  }
  return count;
}

function carveRing(world: World, room: Room, radius: number, halfWidth: number, floorTex: Tex): number {
  let count = 0;
  const maxR = radius + halfWidth + 1;
  for (let y = CY - maxR; y <= CY + maxR; y++) {
    for (let x = CX - maxR; x <= CX + maxR; x++) {
      const d = Math.hypot(x - CX, y - CY);
      if (Math.abs(d - radius) > halfWidth) continue;
      if (setFloor(world, room, x, y, floorTex)) count++;
    }
  }
  return count;
}

function carveAbyss(world: World): number {
  let count = 0;
  for (let y = CY - VOID_R; y <= CY + VOID_R; y++) {
    for (let x = CX - VOID_R; x <= CX + VOID_R; x++) {
      const d = Math.hypot(x - CX, y - CY);
      if (d > VOID_R) continue;
      if (setAbyss(world, x, y)) count++;
    }
  }
  return count;
}

function carveLine(
  world: World,
  room: Room,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  floorTex: Tex,
): number[] {
  const cells: number[] = [];
  const dx = bx - ax;
  const dy = by - ay;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  const r = Math.max(0, Math.floor(width / 2));
  for (let s = 0; s <= steps; s++) {
    const x = Math.round(ax + dx * s / steps);
    const y = Math.round(ay + dy * s / steps);
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        if (ox * ox + oy * oy > r * r + 1) continue;
        const px = world.wrap(x + ox);
        const py = world.wrap(y + oy);
        const i = world.idx(px, py);
        if (setFloor(world, room, px, py, floorTex) && !cells.includes(i)) cells.push(i);
      }
    }
  }
  return cells;
}

function placeLift(world: World, liftX: number, liftY: number, buttonX: number, buttonY: number, direction: LiftDirection): void {
  const li = world.idx(liftX, liftY);
  world.cells[li] = Cell.LIFT;
  world.wallTex[li] = Tex.LIFT_DOOR;
  world.roomMap[li] = -1;
  world.liftDir[li] = direction;
  const bi = world.idx(buttonX, buttonY);
  if (world.cells[bi] === Cell.FLOOR) {
    world.features[bi] = Feature.LIFT_BUTTON;
    world.liftDir[bi] = direction;
  }
}

function buildServiceRim(world: World): { rooms: Room[]; cells: number } {
  const north = logicalRoom(world, RoomType.CORRIDOR, 'Северный сервисный обход шахты', 0, 83, W, 7, Tex.METAL, Tex.F_CONCRETE);
  const south = logicalRoom(world, RoomType.CORRIDOR, 'Южный сервисный обход шахты', 0, 934, W, 7, Tex.METAL, Tex.F_CONCRETE);
  const west = logicalRoom(world, RoomType.CORRIDOR, 'Западный сервисный обход шахты', 83, 0, 7, W, Tex.METAL, Tex.F_CONCRETE);
  const east = logicalRoom(world, RoomType.CORRIDOR, 'Восточный сервисный обход шахты', 934, 0, 7, W, Tex.METAL, Tex.F_CONCRETE);
  let cells = 0;
  cells += carveRect(world, north, 0, 83, W, 7);
  cells += carveRect(world, south, 0, 934, W, 7);
  cells += carveRect(world, west, 83, 0, 7, W);
  cells += carveRect(world, east, 934, 0, 7, W);
  return { rooms: [north, south, west, east], cells };
}

function buildRingsAndSpokes(world: World): { ringCells: number; ringRoom: Room; spokeRooms: Room[] } {
  const ringRoom = logicalRoom(world, RoomType.CORRIDOR, 'Кольцевая галерея шахты-атриума', CX - OUTER_R - 10, CY - OUTER_R - 10, OUTER_R * 2 + 20, OUTER_R * 2 + 20, Tex.PIPE, Tex.F_CONCRETE);
  let ringCells = 0;
  ringCells += carveRing(world, ringRoom, INNER_R, 7, Tex.F_TILE);
  ringCells += carveRing(world, ringRoom, MID_R, 6, Tex.F_CONCRETE);
  ringCells += carveRing(world, ringRoom, OUTER_R, 7, Tex.F_CONCRETE);

  const north = logicalRoom(world, RoomType.CORRIDOR, 'Северное ребро лифтовой шахты', CX - 4, 86, 9, CY - OUTER_R - 86, Tex.PIPE, Tex.F_CONCRETE);
  const south = logicalRoom(world, RoomType.CORRIDOR, 'Южное ребро лифтовой шахты', CX - 4, CY + OUTER_R, 9, 936 - (CY + OUTER_R), Tex.PIPE, Tex.F_CONCRETE);
  const west = logicalRoom(world, RoomType.CORRIDOR, 'Западное ребро лифтовой шахты', 86, CY - 4, CX - OUTER_R - 86, 9, Tex.PIPE, Tex.F_CONCRETE);
  const east = logicalRoom(world, RoomType.CORRIDOR, 'Восточное ребро лифтовой шахты', CX + OUTER_R, CY - 4, 936 - (CX + OUTER_R), 9, Tex.PIPE, Tex.F_CONCRETE);
  carveLine(world, north, CX, 86, CX, CY - OUTER_R, 7, Tex.F_CONCRETE);
  carveLine(world, south, CX, CY + OUTER_R, CX, 936, 7, Tex.F_CONCRETE);
  carveLine(world, west, 86, CY, CX - OUTER_R, CY, 7, Tex.F_CONCRETE);
  carveLine(world, east, CX + OUTER_R, CY, 936, CY, 7, Tex.F_CONCRETE);
  return { ringCells, ringRoom, spokeRooms: [north, south, west, east] };
}

function buildBridge(
  world: World,
  id: string,
  name: string,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  repairable = false,
): BridgeBuild {
  const room = logicalRoom(world, RoomType.CORRIDOR, name, Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax) + width + 1, Math.abs(by - ay) + width + 1, Tex.METAL, Tex.F_TILE);
  const cells = carveLine(world, room, ax, ay, bx, by, width, Tex.F_TILE);
  let gapCells = 0;
  if (repairable) {
    const gx = Math.round((ax + bx) / 2);
    const gy = Math.round((ay + by) / 2);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > 3) continue;
        if (setAbyss(world, gx + dx, gy + dy)) gapCells++;
      }
    }
  }
  return {
    state: { id, name, exposedCells: cells.length, coverCells: 0, repairable, gapCells },
    cells,
  };
}

function addBridgeCover(world: World, bridge: BridgeBuild, salt: number): number {
  let islands = 0;
  const stride = Math.max(28, Math.floor(bridge.cells.length / 7));
  for (let i = stride; i < bridge.cells.length - stride; i += stride) {
    const cell = bridge.cells[(i + salt * 11) % bridge.cells.length];
    const x = cell % W;
    const y = (cell / W) | 0;
    const side = (i / stride + salt) % 2 === 0 ? -3 : 3;
    if (Math.abs(y - CY) <= Math.abs(x - CX)) {
      if (setCoverWall(world, x, y + side)) islands++;
      setFeature(world, x, y - side, Feature.MACHINE);
    } else {
      if (setCoverWall(world, x + side, y)) islands++;
      setFeature(world, x - side, y, Feature.MACHINE);
    }
  }
  bridge.state.coverCells = islands;
  return islands;
}

function buildBridges(world: World): { bridges: BridgeBuild[]; coverIslands: number } {
  const bridges = [
    buildBridge(world, 'shahta_west_east_bridge', 'Открытый мост запад-восток', CX - OUTER_R, CY, CX + OUTER_R, CY, 7),
    buildBridge(world, 'shahta_north_south_bridge', 'Открытый мост север-юг', CX, CY - OUTER_R, CX, CY + OUTER_R, 7),
    buildBridge(world, 'shahta_diag_service_bridge', 'Диагональный мост сервисной смены', CX - MID_R, CY - MID_R, CX + MID_R, CY + MID_R, 5),
    buildBridge(world, 'shahta_diag_cover_bridge', 'Диагональный мост с островами укрытий', CX - MID_R, CY + MID_R, CX + MID_R, CY - MID_R, 5),
    buildBridge(world, 'shahta_repair_chord', 'Ремонтная перемычка над шахтой', CX + 128, CY - OUTER_R + 22, CX + OUTER_R - 20, CY - 126, 5, true),
  ];
  let coverIslands = 0;
  for (let i = 0; i < bridges.length; i++) coverIslands += addBridgeCover(world, bridges[i], i + 1);
  return { bridges, coverIslands };
}

function buildServiceRooms(world: World, rimRooms: readonly Room[]): {
  control: Room;
  repair: Room;
  shelter: Room;
  cache: Room;
} {
  const control = boxRoom(world, RoomType.OFFICE, 452, 70, 38, 12, 'Пульт шахты-атриума', Tex.PANEL, Tex.F_LINO);
  const repair = boxRoom(world, RoomType.PRODUCTION, 942, 472, 15, 42, 'Ремонтный пост перемычки', Tex.PIPE, Tex.F_CONCRETE);
  const shelter = boxRoom(world, RoomType.COMMON, 534, 942, 44, 15, 'Убежище сервисного обода', Tex.CONCRETE, Tex.F_LINO);
  const cache = boxRoom(world, RoomType.STORAGE, 66, 544, 16, 38, 'Кладовая мостовых листов', Tex.METAL, Tex.F_CONCRETE);
  placeDoor(world, control, rimRooms[0], '', false);
  placeDoor(world, repair, rimRooms[3], '', false);
  placeDoor(world, shelter, rimRooms[1], '', false);
  placeDoor(world, cache, rimRooms[2], '', false);
  return { control, repair, shelter, cache };
}

function dressRooms(world: World, rooms: ReturnType<typeof buildServiceRooms>): void {
  setFeature(world, rooms.control.x + 5, rooms.control.y + 4, Feature.DESK);
  setFeature(world, rooms.control.x + 13, rooms.control.y + 4, Feature.SCREEN);
  setFeature(world, rooms.control.x + 26, rooms.control.y + 4, Feature.APPARATUS);
  setFeature(world, rooms.control.x + 33, rooms.control.y + 8, Feature.LAMP);

  for (let y = rooms.repair.y + 4; y < rooms.repair.y + rooms.repair.h - 4; y += 7) {
    setFeature(world, rooms.repair.x + 5, y, Feature.MACHINE);
    setFeature(world, rooms.repair.x + 9, y + 2, Feature.APPARATUS);
  }
  setFeature(world, rooms.repair.x + 6, rooms.repair.y + rooms.repair.h - 5, Feature.LAMP);

  for (let x = rooms.shelter.x + 5; x < rooms.shelter.x + rooms.shelter.w - 5; x += 8) {
    setFeature(world, x, rooms.shelter.y + 5, Feature.TABLE);
    setFeature(world, x + 2, rooms.shelter.y + 9, Feature.CHAIR);
  }
  setFeature(world, rooms.shelter.x + rooms.shelter.w - 5, rooms.shelter.y + 4, Feature.LAMP);

  for (let y = rooms.cache.y + 4; y < rooms.cache.y + rooms.cache.h - 4; y += 6) {
    setFeature(world, rooms.cache.x + 4, y, Feature.SHELF);
    setFeature(world, rooms.cache.x + 10, y, Feature.SHELF);
  }
  setFeature(world, rooms.cache.x + 7, rooms.cache.y + rooms.cache.h - 5, Feature.LAMP);
}

function decorateShahtaRoom(world: World, room: Room, serial: number): void {
  const fixtures = Math.max(2, Math.min(8, Math.floor((room.w * room.h) / 34)));
  for (let i = 0; i < fixtures; i++) {
    const x = room.x + 1 + ((serial * 7 + i * 5) % Math.max(1, room.w - 2));
    const y = room.y + 1 + ((serial * 11 + i * 3) % Math.max(1, room.h - 2));
    let feature = Feature.LAMP;
    switch (room.type) {
      case RoomType.HQ:
        feature = i % 3 === 0 ? Feature.DESK : i % 3 === 1 ? Feature.SCREEN : Feature.LAMP;
        break;
      case RoomType.KITCHEN:
        feature = i % 3 === 0 ? Feature.STOVE : i % 3 === 1 ? Feature.SINK : Feature.TABLE;
        break;
      case RoomType.BATHROOM:
        feature = i % 2 === 0 ? Feature.TOILET : Feature.SINK;
        break;
      case RoomType.MEDICAL:
        feature = i % 2 === 0 ? Feature.BED : Feature.APPARATUS;
        break;
      case RoomType.PRODUCTION:
        feature = i % 2 === 0 ? Feature.MACHINE : Feature.APPARATUS;
        break;
      case RoomType.STORAGE:
        feature = Feature.SHELF;
        break;
      case RoomType.OFFICE:
        feature = i % 3 === 0 ? Feature.DESK : i % 3 === 1 ? Feature.CHAIR : Feature.SCREEN;
        break;
      case RoomType.SMOKING:
        feature = i % 2 === 0 ? Feature.TABLE : Feature.CHAIR;
        break;
      case RoomType.COMMON:
      default:
        feature = i % 3 === 0 ? Feature.TABLE : i % 3 === 1 ? Feature.CHAIR : Feature.LAMP;
        break;
    }
    setFeature(world, x, y, feature);
  }
}

function markHermeticShell(world: World, room: Room): void {
  room.sealed = true;
  room.wallTex = Tex.HERMO_WALL;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.cells[idx] !== Cell.WALL || world.aptMask[idx]) continue;
      world.hermoWall[idx] = 1;
      world.wallTex[idx] = Tex.HERMO_WALL;
    }
  }
}

function paintShahtaRoomTerritory(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.aptMask[idx] || world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.ABYSS) continue;
      setTerritoryOwnerAtIndex(world, idx, owner);
    }
  }
  for (const idx of room.doors) {
    if (world.aptMask[idx]) continue;
    setTerritoryOwnerAtIndex(world, idx, owner);
  }
}

function paintShahtaOwnerPatch(world: World, cx: number, cy: number, radius: number, owner: TerritoryOwner): void {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const idx = world.idx(cx + dx, cy + dy);
      if (world.aptMask[idx] || world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.ABYSS) continue;
      setTerritoryOwnerAtIndex(world, idx, owner);
    }
  }
}

function buildOuterServiceLayer(world: World): { rooms: Room[]; cells: number } {
  const north = logicalRoom(world, RoomType.CORRIDOR, 'Внешнее северное кольцо шахты-атриума', 146, 146, 728, 7, Tex.PIPE, Tex.F_CONCRETE);
  const south = logicalRoom(world, RoomType.CORRIDOR, 'Внешнее южное кольцо шахты-атриума', 146, 871, 728, 7, Tex.PIPE, Tex.F_CONCRETE);
  const west = logicalRoom(world, RoomType.CORRIDOR, 'Внешнее западное кольцо шахты-атриума', 146, 146, 7, 728, Tex.PIPE, Tex.F_CONCRETE);
  const east = logicalRoom(world, RoomType.CORRIDOR, 'Внешнее восточное кольцо шахты-атриума', 871, 146, 7, 728, Tex.PIPE, Tex.F_CONCRETE);
  let cells = 0;
  cells += carveRect(world, north, 146, 146, 728, 7);
  cells += carveRect(world, south, 146, 871, 728, 7);
  cells += carveRect(world, west, 146, 146, 7, 728);
  cells += carveRect(world, east, 871, 146, 7, 728);
  cells += carveLine(world, north, CX, 86, CX, CY - OUTER_R, 5, Tex.F_CONCRETE).length;
  cells += carveLine(world, south, CX, CY + OUTER_R, CX, 936, 5, Tex.F_CONCRETE).length;
  cells += carveLine(world, west, 86, CY, CX - OUTER_R, CY, 5, Tex.F_CONCRETE).length;
  cells += carveLine(world, east, CX + OUTER_R, CY, 936, CY, 5, Tex.F_CONCRETE).length;
  cells += carveLine(world, north, 146, 146, 83, 83, 5, Tex.F_CONCRETE).length;
  cells += carveLine(world, north, 874, 146, 936, 83, 5, Tex.F_CONCRETE).length;
  cells += carveLine(world, south, 146, 874, 83, 936, 5, Tex.F_CONCRETE).length;
  cells += carveLine(world, south, 874, 874, 936, 936, 5, Tex.F_CONCRETE).length;
  return { rooms: [north, south, west, east], cells };
}

function microType(serial: number): RoomType {
  return SHAHTA_MICRO_TYPES[serial % SHAHTA_MICRO_TYPES.length];
}

function buildHorizontalMicroRooms(world: World, corridor: Room, label: string, above: boolean, serialBase: number): number {
  let rooms = 0;
  for (let n = 0; n < 9; n++) {
    const w = 14 + ((serialBase + n * 5) % 10);
    const h = 8 + ((serialBase + n * 3) % 5);
    const x = 170 + n * 76 + ((n % 3) * 4);
    const y = above ? corridor.y - h - 1 : corridor.y + corridor.h + 1;
    const type = microType(serialBase + n);
    const room = boxRoom(
      world,
      type,
      x,
      y,
      w,
      h,
      `Микроячейка ${label} ${n + 1}`,
      type === RoomType.BATHROOM ? Tex.TILE_W : Tex.METAL,
      type === RoomType.BATHROOM ? Tex.F_TILE : Tex.F_CONCRETE,
    );
    placeDoor(world, room, corridor, '', false);
    decorateShahtaRoom(world, room, serialBase + n);
    rooms++;
  }
  return rooms;
}

function buildVerticalMicroRooms(world: World, corridor: Room, label: string, left: boolean, serialBase: number): number {
  let rooms = 0;
  for (let n = 0; n < 9; n++) {
    const w = 8 + ((serialBase + n * 7) % 5);
    const h = 14 + ((serialBase + n * 5) % 10);
    const x = left ? corridor.x - w - 1 : corridor.x + corridor.w + 1;
    const y = 170 + n * 76 + ((n % 3) * 4);
    const type = microType(serialBase + n);
    const room = boxRoom(
      world,
      type,
      x,
      y,
      w,
      h,
      `Микроячейка ${label} ${n + 1}`,
      type === RoomType.SMOKING ? Tex.ROTTEN : Tex.METAL,
      type === RoomType.SMOKING ? Tex.F_WOOD : Tex.F_CONCRETE,
    );
    placeDoor(world, room, corridor, '', false);
    decorateShahtaRoom(world, room, serialBase + n);
    rooms++;
  }
  return rooms;
}

function buildCantileverDeck(
  world: World,
  name: string,
  x: number,
  y: number,
  connectA: [number, number],
  connectB: [number, number],
  serialBase: number,
): { room: Room; microRooms: number; cells: number } {
  const deck = boxRoom(world, RoomType.CORRIDOR, x, y, 122, 7, `Консольная палуба ${name}`, Tex.PIPE, Tex.F_CONCRETE);
  let cells = 0;
  cells += carveLine(world, deck, x + 6, y + 3, connectA[0], connectA[1], 4, Tex.F_CONCRETE).length;
  cells += carveLine(world, deck, x + 116, y + 3, connectB[0], connectB[1], 4, Tex.F_CONCRETE).length;
  let microRooms = 0;
  for (let n = 0; n < 6; n++) {
    const type = microType(serialBase + n);
    const w = n % 2 === 0 ? 16 : 20;
    const h = n % 3 === 0 ? 10 : 9;
    const rx = x + 6 + n * 19;
    const above = n % 2 === 0;
    const ry = above ? y - h - 1 : y + deck.h + 1;
    const room = boxRoom(
      world,
      type,
      rx,
      ry,
      w,
      h,
      `Подвесная ячейка ${name} ${n + 1}`,
      type === RoomType.BATHROOM ? Tex.TILE_W : Tex.METAL,
      type === RoomType.BATHROOM ? Tex.F_TILE : Tex.F_CONCRETE,
    );
    placeDoor(world, room, deck, '', false);
    decorateShahtaRoom(world, room, serialBase + n);
    microRooms++;
  }
  return { room: deck, microRooms, cells };
}

function buildMidMicroServiceFabric(world: World): ShahtaMidMicroStats {
  const outer = buildOuterServiceLayer(world);
  let microRooms = 0;
  microRooms += buildHorizontalMicroRooms(world, outer.rooms[0], 'северного внешнего обода сверху', true, 11);
  microRooms += buildHorizontalMicroRooms(world, outer.rooms[0], 'северного внешнего обода снизу', false, 29);
  microRooms += buildHorizontalMicroRooms(world, outer.rooms[1], 'южного внешнего обода сверху', true, 47);
  microRooms += buildHorizontalMicroRooms(world, outer.rooms[1], 'южного внешнего обода снизу', false, 71);
  microRooms += buildVerticalMicroRooms(world, outer.rooms[2], 'западного внешнего обода слева', true, 101);
  microRooms += buildVerticalMicroRooms(world, outer.rooms[2], 'западного внешнего обода справа', false, 131);
  microRooms += buildVerticalMicroRooms(world, outer.rooms[3], 'восточного внешнего обода слева', true, 167);
  microRooms += buildVerticalMicroRooms(world, outer.rooms[3], 'восточного внешнего обода справа', false, 199);
  let serviceCells = outer.cells;
  for (const deck of [
    buildCantileverDeck(world, 'северо-западного зазора', 214, 258, [146, 146], [CX - 214, CY - 214], 233),
    buildCantileverDeck(world, 'северо-восточного зазора', 688, 258, [CX + 214, CY - 214], [874, 146], 251),
    buildCantileverDeck(world, 'юго-западного зазора', 214, 758, [146, 874], [CX - 214, CY + 214], 269),
    buildCantileverDeck(world, 'юго-восточного зазора', 688, 758, [CX + 214, CY + 214], [874, 874], 287),
  ]) {
    microRooms += deck.microRooms;
    serviceCells += deck.cells;
  }
  return { serviceCells, microRooms, hqCompounds: 0 };
}

function buildShahtaFactionHqs(world: World): ShahtaHqCompound[] {
  const compounds: ShahtaHqCompound[] = [];
  for (const spec of SHAHTA_HQ_SPECS) {
    const [x, y, w, h] = spec.hall;
    const hall = boxRoom(world, RoomType.CORRIDOR, x, y, w, h, `Штабной коридор ${spec.key}`, spec.wallTex, spec.floorTex);
    carveLine(
      world,
      hall,
      x + (w >> 1),
      y + (h >> 1),
      spec.connect[0],
      spec.connect[1],
      5,
      spec.floorTex,
    );
    decorateShahtaRoom(world, hall, spec.owner * 101);
    const support: Room[] = [];
    let core = hall;
    for (let i = 0; i < spec.support.length; i++) {
      const roomSpec = spec.support[i];
      const room = boxRoom(world, roomSpec.type, roomSpec.x, roomSpec.y, roomSpec.w, roomSpec.h, roomSpec.name, spec.wallTex, spec.floorTex);
      if (roomSpec.hermetic) {
        markHermeticShell(world, room);
        core = room;
      }
      placeDoor(world, room, hall, '', !!roomSpec.hermetic);
      decorateShahtaRoom(world, room, spec.owner * 113 + i);
      support.push(room);
    }
    compounds.push({ owner: spec.owner, hall, core, support });
  }
  return compounds;
}

function paintShahtaHqTerritory(world: World, compounds: readonly ShahtaHqCompound[]): void {
  for (const compound of compounds) {
    paintShahtaRoomTerritory(world, compound.hall, compound.owner);
    for (const room of compound.support) paintShahtaRoomTerritory(world, room, compound.owner);
    paintShahtaOwnerPatch(
      world,
      compound.core.x + (compound.core.w >> 1),
      compound.core.y + (compound.core.h >> 1),
      compound.owner === ZoneFaction.LIQUIDATOR ? 46 : 34,
      compound.owner,
    );
  }
}

export function reinforceShahtaAtriumAuthoredHqTerritory(world: World): void {
  const roomByName = new Map<string, Room>();
  for (const room of world.rooms) {
    if (room && room.name && !roomByName.has(room.name)) {
      roomByName.set(room.name, room);
    }
  }
  for (const spec of SHAHTA_HQ_SPECS) {
    const hall = roomByName.get(`Штабной коридор ${spec.key}`);
    let core: Room | undefined;
    if (hall) paintShahtaRoomTerritory(world, hall, spec.owner);
    for (const roomSpec of spec.support) {
      const room = roomByName.get(roomSpec.name);
      if (!room) continue;
      if (roomSpec.hermetic) {
        room.type = RoomType.HQ;
        markHermeticShell(world, room);
        core = room;
      }
      paintShahtaRoomTerritory(world, room, spec.owner);
    }
    if (core) {
      paintShahtaOwnerPatch(
        world,
        core.x + (core.w >> 1),
        core.y + (core.h >> 1),
        spec.owner === ZoneFaction.LIQUIDATOR ? 46 : 34,
        spec.owner,
      );
    }
  }
  syncZoneMetadataFromTerritory(world);
  world.markWallTexDirty();
  world.markFeaturesDirty(false);
}

function addContainer(
  world: World,
  room: Room,
  x: number,
  y: number,
  kind: ContainerKind,
  name: string,
  inventory: readonly { defId: string; count: number }[],
  tags: readonly string[],
  access: WorldContainer['access'] = 'room',
): WorldContainer {
  const cleanInventory = inventory.filter(item => ITEMS[item.defId]).map(item => ({ defId: item.defId, count: item.count }));
  const id = world.containers.length + 1;
  const ci = world.idx(x, y);
  const container: WorldContainer = {
    id,
    x: world.wrap(x),
    y: world.wrap(y),
    floor: SHAHTA_ATRIUM_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind,
    name,
    inventory: cleanInventory,
    capacitySlots: Math.max(8, cleanInventory.length + 4),
    faction: access === 'public' ? undefined : Faction.LIQUIDATOR,
    access,
    lockDifficulty: access === 'locked' ? 3 : undefined,
    discovered: true,
    tags: ['shahta_atrium', ...tags],
  };
  world.addContainer(container);
  setFeature(world, x, y, kind === ContainerKind.TOOL_LOCKER ? Feature.MACHINE : Feature.SHELF);
  return container;
}

function spawnMonster(entities: Entity[], nextId: { v: number }, kind: MonsterKind, x: number, y: number, level: number): void {
  const def = MONSTERS[kind];
  const hp = Math.round(def.hp * (1 + Math.max(0, level - 1) * 0.18));
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: def.speed,
    sprite: def.sprite,
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
    phasing: kind === MonsterKind.SPIRIT,
  });
}

function dropItem(entities: Entity[], nextId: { v: number }, x: number, y: number, defId: string, count = 1): void {
  if (!ITEMS[defId]) return;
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

function placeCoverIslandsOnRings(world: World): number {
  let count = 0;
  for (let n = 0; n < 28; n++) {
    const angle = n * Math.PI * 2 / 28;
    const radius = n % 2 === 0 ? MID_R : OUTER_R;
    const x = Math.round(CX + Math.cos(angle) * radius);
    const y = Math.round(CY + Math.sin(angle) * radius);
    if (setCoverWall(world, x, y)) count++;
    setFeature(world, x + Math.round(Math.cos(angle + Math.PI / 2) * 3), y + Math.round(Math.sin(angle + Math.PI / 2) * 3), Feature.MACHINE);
  }
  return count;
}

function registerCues(world: World, rooms: ReturnType<typeof buildServiceRooms>, state: ShahtaAtriumState): void {
  registerRouteCue(world, {
    id: 'shahta_exposed_bridge',
    x: CX - OUTER_R + 16,
    y: CY,
    targetX: CX + OUTER_R - 16,
    targetY: CY,
    floor: SHAHTA_ATRIUM_BASE_FLOOR,
    label: 'Открытый мост',
    hint: 'Быстро, шумно, почти без укрытий. Монстров удобно выманивать на прямую.',
    targetName: 'восточная галерея шахты',
    color: '#ffb36b',
    tags: ['shahta_atrium', 'bridge', 'exposed', 'quick_crossing', 'los_score'],
    toneSeed: 7101,
    roomId: state.bridges[0]?.exposedCells ? rooms.control.id : undefined,
    routeGroup: {
      id: 'shahta_crossing_choice',
      lead: 'Шахта открыта до темноты.',
      risk: 'Прямая простреливается.',
      decision: 'идти мостом или обходить ободом',
      reward: 'быстрый переход к нижнему лифту',
    },
  });
  registerRouteCue(world, {
    id: 'shahta_service_rim',
    x: 86,
    y: CY,
    targetX: 936,
    targetY: CY,
    floor: SHAHTA_ATRIUM_BASE_FLOOR,
    label: 'Сервисный обод',
    hint: 'Длинный обход с укрытиями, шкафами и аварийным щитком.',
    targetName: 'восточный ремонтный пост',
    color: '#9fd6ff',
    tags: ['shahta_atrium', 'service_rim', 'safe_spiral', 'cover'],
    toneSeed: 7102,
    roomId: rooms.cache.id,
    targetRoomId: rooms.repair.id,
  });
  registerRouteCue(world, {
    id: 'shahta_repair_chord',
    x: rooms.repair.x + 6,
    y: rooms.repair.y + 7,
    targetX: CX + 214,
    targetY: CY - 216,
    floor: SHAHTA_ATRIUM_BASE_FLOOR,
    label: 'Ремонт перемычки',
    hint: 'Перемычка оборвана над провалом. Щиток и листы дают короткий путь, но это не главный маршрут.',
    targetName: 'оборванная перемычка',
    color: '#ffd35f',
    tags: ['shahta_atrium', 'repairable_bridge', 'optional_repair', 'bridge_chord'],
    toneSeed: 7103,
    roomId: rooms.repair.id,
    targetRoomId: rooms.repair.id,
  });
  registerRouteCue(world, {
    id: 'shahta_cover_islands',
    x: CX,
    y: CY - MID_R,
    targetX: CX,
    targetY: CY + MID_R,
    floor: SHAHTA_ATRIUM_BASE_FLOOR,
    label: 'Острова укрытий',
    hint: `Укрытия на мостах: ${state.coverIslands}, оценка LOS/cover ${state.losCoverScore}.`,
    targetName: 'южная дуга атриума',
    color: '#d8f0ad',
    tags: ['shahta_atrium', 'cover', 'lure_lane', 'los_cover_score'],
    toneSeed: 7104,
  });
}

function tuneShahtaZones(world: World): void {
  for (const zone of world.zones) {
    const d = world.dist(zone.cx, zone.cy, CX, CY);
    if (d < 180) {
      zone.faction = ZoneFaction.SAMOSBOR;
      zone.level = Math.max(zone.level, 5);
    } else if (d < 330) {
      zone.faction = zone.id % 3 === 0 ? ZoneFaction.WILD : ZoneFaction.LIQUIDATOR;
      zone.level = Math.max(zone.level, 4);
    } else {
      zone.faction = zone.id % 5 === 0 ? ZoneFaction.WILD : ZoneFaction.LIQUIDATOR;
      zone.level = Math.max(zone.level, 3);
    }
    zone.fogged = false;
  }
  for (let i = 0; i < W * W; i++) {
    const zone = world.zones[world.zoneMap[i]];
    world.factionControl[i] = zone?.faction ?? ZoneFaction.LIQUIDATOR;
  }
}

function buildState(
  voidCells: number,
  ringCells: number,
  serviceBypassCells: number,
  outerServiceCells: number,
  microRoomCount: number,
  hqCompoundCount: number,
  coverIslands: number,
  bridges: readonly BridgeBuild[],
): ShahtaAtriumState {
  const bridgeStates = bridges.map(bridge => bridge.state);
  const totalBridgeCells = bridgeStates.reduce((sum, bridge) => sum + bridge.exposedCells, 0);
  const totalCover = bridgeStates.reduce((sum, bridge) => sum + bridge.coverCells, 0) + coverIslands;
  return {
    routeId: DESIGN_FLOOR_ID,
    z: SHAHTA_ATRIUM_ROUTE_Z,
    baseFloor: SHAHTA_ATRIUM_BASE_FLOOR,
    voidCells,
    ringCells,
    bridgeCount: bridgeStates.filter(bridge => !bridge.repairable).length,
    serviceBypassCells,
    outerServiceCells,
    microRoomCount,
    hqCompoundCount,
    coverIslands,
    losCoverScore: Math.round(totalCover * 1000 / Math.max(1, totalBridgeCells)),
    repairableBridgeId: 'shahta_repair_chord',
    bridges: bridgeStates,
  };
}

export function generateShahtaAtriumDesignFloor(): ShahtaAtriumGeneration {
  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 1 };

  world.wallTex.fill(Tex.METAL);
  world.floorTex.fill(Tex.F_CONCRETE);
  world.factionControl.fill(ZoneFaction.LIQUIDATOR);

  const rim = buildServiceRim(world);
  const voidCells = carveAbyss(world);
  const { ringCells } = buildRingsAndSpokes(world);
  const { bridges, coverIslands: bridgeCover } = buildBridges(world);
  const ringCover = placeCoverIslandsOnRings(world);
  const rooms = buildServiceRooms(world, rim.rooms);
  const midMicro = buildMidMicroServiceFabric(world);
  const hqCompounds = buildShahtaFactionHqs(world);
  dressRooms(world, rooms);

  placeLift(world, CX, 82, CX, 84, LiftDirection.UP);
  placeLift(world, CX, 941, CX, 940, LiftDirection.DOWN);
  placeLift(world, 82, CY, 84, CY, LiftDirection.UP);
  placeLift(world, 941, CY, 940, CY, LiftDirection.DOWN);

  sanitizeDoors(world);
  ensureConnectivity(world, CX + OUTER_R + 8.5, CY + 0.5);
  generateZones(world);
  tuneShahtaZones(world);
  paintShahtaHqTerritory(world, hqCompounds);

  placeEmergencyPanel(world, rooms.repair.x + 7, rooms.repair.y + 6, 'panel_doors', 7103);
  addContainer(world, rooms.repair, rooms.repair.x + 6, rooms.repair.y + 30, ContainerKind.TOOL_LOCKER, 'Шкаф ремонта перемычки', [
    { defId: 'metal_sheet', count: 2 },
    { defId: 'wire_coil', count: 1 },
    { defId: 'door_kit', count: 1 },
    { defId: 'fuse', count: 1 },
  ], ['repair', 'repairable_bridge', 'bridge_chord'], 'locked');
  addContainer(world, rooms.cache, rooms.cache.x + 7, rooms.cache.y + 28, ContainerKind.METAL_CABINET, 'Кладовая мостовых листов', [
    { defId: 'metal_sheet', count: 3 },
    { defId: 'gear', count: 1 },
    { defId: 'sealant_tube', count: 1 },
  ], ['service_rim', 'cover', 'repair'], 'room');
  addContainer(world, rooms.shelter, rooms.shelter.x + 35, rooms.shelter.y + 5, ContainerKind.EMERGENCY_BOX, 'Ящик сервисного обода', [
    { defId: 'bandage', count: 2 },
    { defId: 'water', count: 1 },
    { defId: 'bread', count: 1 },
  ], ['shelter', 'service_rim', 'public'], 'public');

  spawnMonster(entities, nextId, MonsterKind.REBAR, CX - 12, CY - 72, 4);
  spawnMonster(entities, nextId, MonsterKind.TRUBNYY_AVTOMAT, CX + 92, CY + 4, 4);
  spawnMonster(entities, nextId, MonsterKind.TUBE_EEL, CX - 82, CY + 12, 3);
  dropItem(entities, nextId, rooms.control.x + 18, rooms.control.y + 7, 'relay_diagram');
  dropItem(entities, nextId, rooms.cache.x + 9, rooms.cache.y + 9, 'wire_coil');

  const state = buildState(
    voidCells,
    ringCells,
    rim.cells,
    midMicro.serviceCells,
    midMicro.microRooms,
    hqCompounds.length,
    bridgeCover + ringCover,
    bridges,
  );
  registerCues(world, rooms, state);

  world.markCellsDirty();
  world.markFloorTexDirty();
  world.markWallTexDirty();
  world.markFeaturesDirty(true);
  world.markFogDirty();
  world.bakeLights();

  return {
    world,
    entities,
    spawnX: CX + OUTER_R + 8.5,
    spawnY: CY + 0.5,
    shahtaAtriumState: state,
  };
}
