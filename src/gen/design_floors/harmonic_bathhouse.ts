/* -- Design floor: harmonic_bathhouse - heat, steam and pressure routes -- */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal,
  Cell,
  ContainerKind,
  DoorState,
  EntityType,
  Faction,
  Feature,
  FloorLevel,
  LiftDirection,
  MonsterKind,
  Occupation,
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
import { World } from '../../core/world';
import { hashSeed, withSeededRandom } from '../../core/rand';
import { freshNeeds } from '../../data/catalog';
import { HUMAN_TERRITORY_OWNERS, factionToTerritoryOwner } from '../../data/factions';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { placeEmergencyPanel } from '../../systems/emergency_panels';
import { registerCellHazardSite } from '../../systems/cell_hazards';
import { registerRouteCue } from '../../systems/route_cues';
import { randomRPG } from '../../systems/rpg';
import {
  ensureConnectivity,
  generateZones,
  placeDoorAt,
  sanitizeDoors,
  stampRoom,
} from '../shared';
import type { FloorGeneration } from '../floor_manifest';

export const HARMONIC_BATHHOUSE_ROUTE_ID = 'harmonic_bathhouse' as const;
export const HARMONIC_BATHHOUSE_Z = -28 as const;
export const HARMONIC_BATHHOUSE_BASE_FLOOR = FloorLevel.MAINTENANCE;

export type BathhouseDecisionId =
  | 'turn_valve'
  | 'hot_fast_path'
  | 'cold_flooded_bypass'
  | 'repair_pressure_route';

export interface BathhouseThermalBands {
  hotFogCells: number;
  coldWaterCells: number;
  pressureCells: number;
}

export interface BathhouseRouteNode {
  id: BathhouseDecisionId;
  roomName: string;
  roomId: number;
  x: number;
  y: number;
  tags: readonly string[];
}

export interface HarmonicBathhouseState {
  routeId: typeof HARMONIC_BATHHOUSE_ROUTE_ID;
  anchorZ: typeof HARMONIC_BATHHOUSE_Z;
  baseFloor: typeof HARMONIC_BATHHOUSE_BASE_FLOOR;
  bands: BathhouseThermalBands;
  decisions: BathhouseRouteNode[];
  cueIds: string[];
  hazardIds: string[];
  panelIds: string[];
}

export interface HarmonicBathhouseGeneration extends FloorGeneration {
  bathhouseState: HarmonicBathhouseState;
}

interface BathhouseRooms {
  entry: Room;
  mixingHall: Room;
  centralBath: Room;
  boiler: Room;
  hotGallery: Room;
  coldBypass: Room;
  repairGallery: Room;
  lowerLift: Room;
}

interface Point {
  x: number;
  y: number;
}

interface HarmonicField {
  originX: number;
  originY: number;
  step: number;
  width: number;
  height: number;
  values: Float32Array;
}

type NextId = { v: number };

const SEED = hashSeed(HARMONIC_BATHHOUSE_ROUTE_ID);
const CX = W >> 1;
const CY = W >> 1;
const FIELD_W = 171;
const FIELD_H = 171;
const FIELD_STEP = 2;
const FIELD_ORIGIN_X = CX - Math.floor(FIELD_W * FIELD_STEP / 2);
const FIELD_ORIGIN_Y = CY - 176;
const SERVICE_GRID_X = [112, 272, 432, 592, 752, 912] as const;
const SERVICE_GRID_Y = [118, 278, 438, 598, 758, 918] as const;

interface BathhouseHqSpec {
  owner: TerritoryOwner;
  name: string;
  x: number;
  y: number;
  floorTex: Tex;
  wallTex: Tex;
}

const BATHHOUSE_HQ_SPECS: readonly BathhouseHqSpec[] = [
  { owner: ZoneFaction.CITIZEN, name: 'Миништаб общей помывочной очереди', x: 122, y: 826, floorTex: Tex.F_TILE, wallTex: Tex.TILE_W },
  { owner: ZoneFaction.LIQUIDATOR, name: 'Миништаб напорной вахты ликвидаторов', x: 828, y: 144, floorTex: Tex.F_CONCRETE, wallTex: Tex.METAL },
  { owner: ZoneFaction.SCIENTIST, name: 'Миништаб НИИ тепловой гармоники', x: 126, y: 138, floorTex: Tex.F_TILE, wallTex: Tex.HERMO_WALL },
  { owner: ZoneFaction.CULTIST, name: 'Скрытый миништаб хора конденсата', x: 338, y: 846, floorTex: Tex.F_CARPET, wallTex: Tex.CROSS },
  { owner: ZoneFaction.WILD, name: 'Разорённый миништаб мокрых диких', x: 806, y: 826, floorTex: Tex.F_CONCRETE, wallTex: Tex.ROTTEN },
];

const BATHHOUSE_OWNER_SEQUENCE = [
  ZoneFaction.LIQUIDATOR,
  ZoneFaction.CITIZEN,
  ZoneFaction.SCIENTIST,
  ZoneFaction.WILD,
  ZoneFaction.LIQUIDATOR,
  ZoneFaction.CULTIST,
] as const;

function idxField(x: number, y: number): number {
  return y * FIELD_W + x;
}

function hash01(seed: number, x: number, y: number, salt: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul(x + salt, 0xc2b2ae35);
  h ^= Math.imul(y - salt, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return ((h >>> 0) & 0xffff) / 0x10000;
}

export function generateHarmonicBathhouseDesignFloor(seed = SEED): HarmonicBathhouseGeneration {
  return withSeededRandom(seed, () => {
    const world = new World();
    const entities: Entity[] = [];
    const nextId = { v: 1 };

    initWorld(world);
    const field = solveHarmonicBathhouseField(seed);
    carveLevelSetCorridors(world, field, seed);
    const rooms = buildRooms(world);
    connectRooms(world, rooms);
    placeLifts(world, rooms);
    const bands = applyThermalBands(world, field, rooms, seed);
    decorateRooms(world, rooms, seed);

    generateZones(world);
    tuneBathhouseZones(world);
    const panelIds = placePanels(world, rooms);
    const hazardIds = registerHazards(world, rooms, seed);
    const cueIds = registerCues(world, rooms);
    placeContainers(world, rooms);
    spawnBathhouseNpcs(entities, nextId, rooms);
    spawnBathhouseThreats(world, entities, nextId, rooms);

    sanitizeDoors(world);
    ensureConnectivity(world, rooms.entry.x + 46.5, rooms.entry.y + 13.5);
    world.rebuildContainerMap();
    world.bakeLights();

    return {
      world,
      entities,
      spawnX: rooms.entry.x + 46.5,
      spawnY: rooms.entry.y + 13.5,
      bathhouseState: {
        routeId: HARMONIC_BATHHOUSE_ROUTE_ID,
        anchorZ: HARMONIC_BATHHOUSE_Z,
        baseFloor: HARMONIC_BATHHOUSE_BASE_FLOOR,
        bands,
        decisions: [
          decisionNode('turn_valve', rooms.boiler, ['valve', 'steam', 'pressure']),
          decisionNode('hot_fast_path', rooms.hotGallery, ['hot_fast_path', 'steam', 'risk']),
          decisionNode('cold_flooded_bypass', rooms.coldBypass, ['cold_flooded_bypass', 'water', 'slow']),
          decisionNode('repair_pressure_route', rooms.repairGallery, ['repair_pressure_route', 'panel', 'pressure']),
        ],
        cueIds,
        hazardIds,
        panelIds,
      },
    };
  });
}

function initWorld(world: World): void {
  world.wallTex.fill(Tex.METAL);
  world.floorTex.fill(Tex.F_CONCRETE);
  world.factionControl.fill(ZoneFaction.LIQUIDATOR);
}

/* The candidate asks for a harmonic floor: fixed hot/cold sources are relaxed
 * into a scalar potential, then corridor bands follow its level sets. */
function solveHarmonicBathhouseField(seed: number): HarmonicField {
  const values = new Float32Array(FIELD_W * FIELD_H);
  const next = new Float32Array(values.length);
  const fixed = new Uint8Array(values.length);

  const hot = [
    { x: FIELD_W * 0.54, y: FIELD_H * 0.10, v: 1.0, r: 14 },
    { x: FIELD_W * 0.86, y: FIELD_H * 0.43, v: 0.82, r: 18 },
  ];
  const cold = [
    { x: FIELD_W * 0.12, y: FIELD_H * 0.56, v: -0.92, r: 20 },
    { x: FIELD_W * 0.58, y: FIELD_H * 0.94, v: -0.42, r: 16 },
  ];

  for (let y = 0; y < FIELD_H; y++) {
    for (let x = 0; x < FIELD_W; x++) {
      const i = idxField(x, y);
      let weighted = 0;
      let weight = 0;
      for (const src of [...hot, ...cold]) {
        const dx = x - src.x;
        const dy = y - src.y;
        const d2 = dx * dx + dy * dy;
        const w = 1 / (8 + d2);
        weighted += src.v * w;
        weight += w;
        if (d2 <= src.r * src.r) {
          fixed[i] = 1;
          values[i] = src.v;
        }
      }
      if (!fixed[i]) values[i] = weight > 0 ? weighted / weight : 0;
      if (x === 0 || y === 0 || x === FIELD_W - 1 || y === FIELD_H - 1) {
        fixed[i] = 1;
        values[i] = y < FIELD_H * 0.35 ? 0.44 : x < FIELD_W * 0.5 ? -0.38 : 0.08;
      }
    }
  }

  for (let iter = 0; iter < 72; iter++) {
    next.set(values);
    for (let y = 1; y < FIELD_H - 1; y++) {
      for (let x = 1; x < FIELD_W - 1; x++) {
        const i = idxField(x, y);
        if (fixed[i]) continue;
        const bias = (hash01(seed, x, y, iter) - 0.5) * 0.002;
        next[i] = (
          values[idxField(x - 1, y)] +
          values[idxField(x + 1, y)] +
          values[idxField(x, y - 1)] +
          values[idxField(x, y + 1)]
        ) * 0.25 + bias;
      }
    }
    values.set(next);
  }

  return {
    originX: FIELD_ORIGIN_X,
    originY: FIELD_ORIGIN_Y,
    step: FIELD_STEP,
    width: FIELD_W,
    height: FIELD_H,
    values,
  };
}

function carveLevelSetCorridors(world: World, field: HarmonicField, seed: number): void {
  const levels = [0.54, 0.32, 0.1, -0.16, -0.38] as const;
  for (let gy = 3; gy < field.height - 3; gy++) {
    for (let gx = 3; gx < field.width - 3; gx++) {
      const v = field.values[idxField(gx, gy)];
      let nearest = 1;
      for (const level of levels) nearest = Math.min(nearest, Math.abs(v - level));
      const noise = hash01(seed, gx, gy, 31);
      const levelSet = nearest < 0.018 + noise * 0.012;
      const pressure = Math.abs(field.values[idxField(gx + 1, gy)] - field.values[idxField(gx - 1, gy)])
        + Math.abs(field.values[idxField(gx, gy + 1)] - field.values[idxField(gx, gy - 1)]);
      if (!levelSet && pressure < 0.105) continue;
      if (!levelSet && noise < 0.86) continue;
      carveDisc(world, field.originX + gx * field.step, field.originY + gy * field.step, levelSet ? 2 : 1, Tex.F_CONCRETE);
    }
  }
}

function buildRooms(world: World): BathhouseRooms {
  const entry = addRoom(world, RoomType.CORRIDOR, CX - 46, CY + 164, 92, 28, 'Верхняя кабина парного этажа', Tex.PIPE, Tex.F_CONCRETE);
  const mixingHall = addRoom(world, RoomType.COMMON, CX - 60, CY + 84, 120, 50, 'Смесительный зал давления', Tex.TILE_W, Tex.F_TILE);
  const centralBath = addRoom(world, RoomType.BATHROOM, CX - 58, CY - 52, 116, 86, 'Гармоническая купель', Tex.TILE_W, Tex.F_TILE);
  const boiler = addRoom(world, RoomType.PRODUCTION, CX - 44, CY - 164, 88, 66, 'Котельная поющего стояка', Tex.PIPE, Tex.F_CONCRETE);
  const hotGallery = addRoom(world, RoomType.PRODUCTION, CX + 86, CY - 78, 72, 192, 'Горячий быстрый ход', Tex.PIPE, Tex.F_TILE);
  const coldBypass = addRoom(world, RoomType.BATHROOM, CX - 162, CY - 78, 76, 192, 'Холодный затопленный обход', Tex.TILE_W, Tex.F_WATER);
  const repairGallery = addRoom(world, RoomType.PRODUCTION, CX - 82, CY + 48, 164, 28, 'Галерея манометров', Tex.METAL, Tex.F_CONCRETE);
  const lowerLift = addRoom(world, RoomType.CORRIDOR, CX + 86, CY + 164, 92, 28, 'Нижняя кабина за сушилками', Tex.PIPE, Tex.F_CONCRETE);
  return { entry, mixingHall, centralBath, boiler, hotGallery, coldBypass, repairGallery, lowerLift };
}

function addRoom(
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
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) {
        world.floorTex[ci] = floorTex;
      } else {
        world.wallTex[ci] = wallTex;
      }
    }
  }
  return room;
}

function connectRooms(world: World, rooms: BathhouseRooms): void {
  connectDoorToPoint(world, rooms.entry, 'north', rooms.entry.w >> 1, { x: CX, y: CY + 148 }, 3, Tex.F_CONCRETE);
  connectDoorToPoint(world, rooms.mixingHall, 'south', rooms.mixingHall.w >> 1, { x: CX, y: CY + 148 }, 3, Tex.F_TILE);
  connectDoorToPoint(world, rooms.mixingHall, 'north', rooms.mixingHall.w >> 1, { x: CX, y: CY + 58 }, 3, Tex.F_TILE);
  connectDoorToPoint(world, rooms.repairGallery, 'south', rooms.repairGallery.w >> 1, { x: CX, y: CY + 58 }, 2, Tex.F_CONCRETE);
  connectDoorToPoint(world, rooms.repairGallery, 'north', rooms.repairGallery.w >> 1, { x: CX, y: CY + 36 }, 2, Tex.F_CONCRETE);
  connectDoorToPoint(world, rooms.centralBath, 'south', rooms.centralBath.w >> 1, { x: CX, y: CY + 36 }, 3, Tex.F_TILE);
  connectDoorToPoint(world, rooms.centralBath, 'north', rooms.centralBath.w >> 1, { x: CX, y: CY - 92 }, 3, Tex.F_TILE);
  connectDoorToPoint(world, rooms.boiler, 'south', rooms.boiler.w >> 1, { x: CX, y: CY - 92 }, 3, Tex.F_CONCRETE);
  connectDoorToPoint(world, rooms.centralBath, 'east', rooms.centralBath.h >> 1, { x: CX + 76, y: CY }, 3, Tex.F_TILE);
  connectDoorToPoint(world, rooms.hotGallery, 'west', rooms.hotGallery.h >> 1, { x: CX + 76, y: CY }, 3, Tex.F_TILE);
  connectDoorToPoint(world, rooms.centralBath, 'west', rooms.centralBath.h >> 1, { x: CX - 76, y: CY }, 3, Tex.F_WATER);
  connectDoorToPoint(world, rooms.coldBypass, 'east', rooms.coldBypass.h >> 1, { x: CX - 76, y: CY }, 3, Tex.F_WATER);
  connectDoorToPoint(world, rooms.hotGallery, 'south', rooms.hotGallery.w >> 1, { x: CX + 132, y: CY + 150 }, 3, Tex.F_TILE);
  connectDoorToPoint(world, rooms.lowerLift, 'north', 28, { x: CX + 132, y: CY + 150 }, 3, Tex.F_CONCRETE);
  connectDoorToPoint(world, rooms.coldBypass, 'south', rooms.coldBypass.w >> 1, { x: CX - 124, y: CY + 150 }, 3, Tex.F_WATER);
  carveLine(world, CX - 124, CY + 150, CX + 98, CY + 150, 3, Tex.F_CONCRETE);
  connectDoorToPoint(world, rooms.lowerLift, 'north', 66, { x: CX + 98, y: CY + 150 }, 3, Tex.F_CONCRETE);
}

function connectDoorToPoint(
  world: World,
  room: Room,
  side: 'north' | 'south' | 'west' | 'east',
  offset: number,
  target: Point,
  width: number,
  floorTex: Tex,
  owner?: TerritoryOwner,
  hermetic = false,
): void {
  const door = doorPoint(room, side, offset);
  placeDoorAt(world, door.wall.x, door.wall.y, room.id);
  const doorInfo = world.doors.get(world.idx(door.wall.x, door.wall.y));
  if (doorInfo && hermetic) doorInfo.state = DoorState.HERMETIC_OPEN;
  if (owner !== undefined) {
    const doorIdx = world.idx(door.wall.x, door.wall.y);
    world.factionControl[doorIdx] = owner;
  }
  carveLine(world, door.outside.x, door.outside.y, target.x, target.y, width, floorTex, owner);
  restoreDoorJambs(world, room, side, door.wall, owner, hermetic);
}

function doorPoint(room: Room, side: 'north' | 'south' | 'west' | 'east', offset: number): { wall: Point; outside: Point } {
  if (side === 'north') {
    const x = room.x + Math.max(1, Math.min(room.w - 2, offset));
    return { wall: { x, y: room.y - 1 }, outside: { x, y: room.y - 2 } };
  }
  if (side === 'south') {
    const x = room.x + Math.max(1, Math.min(room.w - 2, offset));
    return { wall: { x, y: room.y + room.h }, outside: { x, y: room.y + room.h + 1 } };
  }
  if (side === 'west') {
    const y = room.y + Math.max(1, Math.min(room.h - 2, offset));
    return { wall: { x: room.x - 1, y }, outside: { x: room.x - 2, y } };
  }
  const y = room.y + Math.max(1, Math.min(room.h - 2, offset));
  return { wall: { x: room.x + room.w, y }, outside: { x: room.x + room.w + 1, y } };
}

function restoreDoorJambs(
  world: World,
  room: Room,
  side: 'north' | 'south' | 'west' | 'east',
  wall: Point,
  owner: TerritoryOwner | undefined,
  hermetic: boolean,
): void {
  const offsets = side === 'north' || side === 'south'
    ? [[-1, 0], [1, 0]] as const
    : [[0, -1], [0, 1]] as const;
  for (const [dx, dy] of offsets) {
    const idx = world.idx(wall.x + dx, wall.y + dy);
    if (world.aptMask[idx] || world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.DOOR) continue;
    if (world.roomMap[idx] >= 0) continue;
    world.cells[idx] = Cell.WALL;
    world.roomMap[idx] = -1;
    world.wallTex[idx] = hermetic ? Tex.HERMO_WALL : room.wallTex;
    world.features[idx] = Feature.NONE;
    if (hermetic) world.hermoWall[idx] = 1;
    if (owner !== undefined) world.factionControl[idx] = owner;
  }
}

function carveLine(world: World, ax: number, ay: number, bx: number, by: number, width: number, floorTex: Tex, owner?: TerritoryOwner): void {
  let x = Math.round(ax);
  let y = Math.round(ay);
  const mx = Math.round(bx);
  const my = Math.round(by);
  const sx = mx === x ? 0 : mx > x ? 1 : -1;
  const sy = my === y ? 0 : my > y ? 1 : -1;
  while (x !== mx) {
    carveDisc(world, x, y, width, floorTex, owner);
    x += sx;
  }
  while (y !== my) {
    carveDisc(world, x, y, width, floorTex, owner);
    y += sy;
  }
  carveDisc(world, x, y, width, floorTex, owner);
}

function carveDisc(world: World, cx: number, cy: number, r: number, floorTex: Tex, owner?: TerritoryOwner): void {
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = world.wrap(cx + dx);
      const y = world.wrap(cy + dy);
      const ci = world.idx(x, y);
      if (world.aptMask[ci]) continue;
      if (world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR || world.hermoWall[ci]) continue;
      if (owner !== undefined && world.roomMap[ci] >= 0) continue;
      world.cells[ci] = Cell.FLOOR;
      world.roomMap[ci] = -1;
      world.floorTex[ci] = floorTex;
      world.wallTex[ci] = Tex.PIPE;
      if (owner !== undefined) world.factionControl[ci] = owner;
    }
  }
}

function placeLifts(world: World, rooms: BathhouseRooms): void {
  placeLift(world, rooms.entry.x + 14, rooms.entry.y + 14, rooms.entry.x + 20, rooms.entry.y + 14, LiftDirection.UP);
  placeLift(world, rooms.lowerLift.x + rooms.lowerLift.w - 14, rooms.lowerLift.y + 14, rooms.lowerLift.x + rooms.lowerLift.w - 20, rooms.lowerLift.y + 14, LiftDirection.DOWN);
}

function placeLift(world: World, liftX: number, liftY: number, buttonX: number, buttonY: number, direction: LiftDirection): void {
  const li = world.idx(liftX, liftY);
  world.cells[li] = Cell.LIFT;
  world.wallTex[li] = Tex.LIFT_DOOR;
  world.liftDir[li] = direction;
  const bi = world.idx(buttonX, buttonY);
  if (world.cells[bi] === Cell.FLOOR) {
    world.features[bi] = Feature.LIFT_BUTTON;
    world.liftDir[bi] = direction;
  }
}

function applyThermalBands(world: World, field: HarmonicField, rooms: BathhouseRooms, seed: number): BathhouseThermalBands {
  let hotFogCells = 0;
  let coldWaterCells = 0;
  let pressureCells = 0;
  for (let gy = 1; gy < field.height - 1; gy++) {
    for (let gx = 1; gx < field.width - 1; gx++) {
      const wx = field.originX + gx * field.step;
      const wy = field.originY + gy * field.step;
      const ci = world.idx(wx, wy);
      if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) continue;
      const v = field.values[idxField(gx, gy)];
      const n = hash01(seed, gx, gy, 97);
      if (v > 0.34) {
        world.fog[ci] = Math.max(world.fog[ci], Math.floor(48 + v * 92 + n * 24));
        world.floorTex[ci] = Tex.F_TILE;
        hotFogCells++;
      } else if (v < -0.24 && n > 0.18) {
        world.cells[ci] = Cell.WATER;
        world.floorTex[ci] = Tex.F_WATER;
        world.fog[ci] = Math.max(world.fog[ci], Math.floor(18 + Math.abs(v) * 44));
        coldWaterCells++;
      } else if (Math.abs(v) < 0.08) {
        world.fog[ci] = Math.max(world.fog[ci], 14);
        pressureCells++;
      }
    }
  }
  coldWaterCells += floodRoom(world, rooms.coldBypass, 0.72, seed ^ 0x77);
  hotFogCells += steamRoom(world, rooms.hotGallery, 96, seed ^ 0x88);
  return { hotFogCells, coldWaterCells, pressureCells };
}

function floodRoom(world: World, room: Room, chance: number, seed: number): number {
  let changed = 0;
  forRoomCells(world, room, (ci, x, y) => {
    if (world.features[ci] !== Feature.NONE) return;
    if (hash01(seed, x, y, 5) > chance) return;
    world.cells[ci] = Cell.WATER;
    world.floorTex[ci] = Tex.F_WATER;
    world.fog[ci] = Math.max(world.fog[ci], 28);
    changed++;
  });
  return changed;
}

function steamRoom(world: World, room: Room, fog: number, seed: number): number {
  let changed = 0;
  forRoomCells(world, room, (ci, x, y) => {
    if ((x + y + seed) % 5 !== 0) return;
    world.fog[ci] = Math.max(world.fog[ci], fog);
    changed++;
  });
  return changed;
}

function decorateRooms(world: World, rooms: BathhouseRooms, seed: number): void {
  for (let x = rooms.centralBath.x + 14; x < rooms.centralBath.x + rooms.centralBath.w - 12; x += 18) {
    setFeature(world, x, rooms.centralBath.y + 14, Feature.SINK);
    setFeature(world, x, rooms.centralBath.y + rooms.centralBath.h - 12, Feature.CHAIR);
  }
  for (let y = rooms.boiler.y + 10; y < rooms.boiler.y + rooms.boiler.h - 8; y += 11) {
    setFeature(world, rooms.boiler.x + 10, y, Feature.MACHINE);
    setFeature(world, rooms.boiler.x + rooms.boiler.w - 10, y, Feature.APPARATUS);
  }
  for (let y = rooms.hotGallery.y + 12; y < rooms.hotGallery.y + rooms.hotGallery.h - 8; y += 18) {
    setFeature(world, rooms.hotGallery.x + 12, y, Feature.APPARATUS);
    setFeature(world, rooms.hotGallery.x + rooms.hotGallery.w - 10, y + 4, Feature.LAMP);
  }
  for (let y = rooms.coldBypass.y + 14; y < rooms.coldBypass.y + rooms.coldBypass.h - 8; y += 20) {
    setFeature(world, rooms.coldBypass.x + 10, y, Feature.SINK);
  }
  for (let x = rooms.repairGallery.x + 12; x < rooms.repairGallery.x + rooms.repairGallery.w - 8; x += 22) {
    setFeature(world, x, rooms.repairGallery.y + 8, Feature.APPARATUS);
    setFeature(world, x + 5, rooms.repairGallery.y + 18, Feature.SCREEN);
  }
  setFeature(world, rooms.mixingHall.x + 12, rooms.mixingHall.y + 12, Feature.TABLE);
  setFeature(world, rooms.mixingHall.x + rooms.mixingHall.w - 12, rooms.mixingHall.y + 12, Feature.SHELF);
  setFeature(world, rooms.entry.x + rooms.entry.w - 14, rooms.entry.y + 13, Feature.LAMP);
  setFeature(world, rooms.lowerLift.x + 14, rooms.lowerLift.y + 13, Feature.LAMP);

  stampRoomSurface(world, rooms.centralBath, seed ^ 0xa1, [82, 132, 155]);
  stampRoomSurface(world, rooms.hotGallery, seed ^ 0xa2, [190, 102, 54]);
  stampRoomSurface(world, rooms.coldBypass, seed ^ 0xa3, [70, 120, 170]);
}

function stampRoomSurface(world: World, room: Room, seed: number, tint: [number, number, number]): void {
  stampSurfaceSplat(world, room.x + room.w / 2, room.y + room.h / 2, 0.5, 0.5, Math.max(room.w, room.h) / 86, 0.62, seed, tint[0], tint[1], tint[2], false);
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER) world.features[ci] = feature;
}

function forRoomCells(world: World, room: Room, fn: (idx: number, x: number, y: number) => void): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const ci = world.idx(x, y);
      if (world.roomMap[ci] === room.id) fn(ci, x, y);
    }
  }
}

function tuneBathhouseZones(world: World): void {
  for (const zone of world.zones) {
    const hot = zone.cx > CX + 72 && zone.cy >= CY - 110 && zone.cy <= CY + 150;
    const cold = zone.cx < CX - 72 && zone.cy >= CY - 110 && zone.cy <= CY + 150;
    const core = Math.abs(world.delta(zone.cx, CX)) < 96 && zone.cy >= CY - 178 && zone.cy <= CY + 190;
    if (hot) {
      zone.faction = ZoneFaction.SAMOSBOR;
      zone.level = Math.max(zone.level, 4);
    } else if (cold) {
      zone.faction = ZoneFaction.WILD;
      zone.level = Math.max(zone.level, 3);
    } else if (core) {
      zone.faction = ZoneFaction.LIQUIDATOR;
      zone.level = Math.max(zone.level, 4);
      zone.hasLift = true;
    } else if (zone.id % 5 === 0) {
      zone.faction = ZoneFaction.WILD;
      zone.level = Math.max(zone.level, 3);
    } else {
      zone.faction = ZoneFaction.LIQUIDATOR;
      zone.level = Math.max(zone.level, 3);
    }
    zone.fogged = false;
  }
  for (let i = 0; i < W * W; i++) world.factionControl[i] = world.zones[world.zoneMap[i]]?.faction ?? ZoneFaction.LIQUIDATOR;
}

export function expandHarmonicBathhouseRouteGeometry(world: World, rng: () => number): void {
  carveBathhouseSecondaryLoops(world);
  buildBathhouseHqCompounds(world);
  buildBathhouseServiceBlocks(world, rng);
  repairBathhouseDoorFrames(world);
  world.markCellsDirty();
  world.markFloorTexDirty();
  world.markWallTexDirty();
  world.markFeaturesDirty(false);
  world.markFogDirty();
}

function carveBathhouseSecondaryLoops(world: World): void {
  const pressureLoop = [
    { x: CX - 352, y: CY - 268 },
    { x: CX + 324, y: CY - 268 },
    { x: CX + 372, y: CY + 238 },
    { x: CX - 348, y: CY + 266 },
    { x: CX - 352, y: CY - 268 },
  ];
  const hotLoop = [
    { x: CX - 98, y: CY - 342 },
    { x: CX + 268, y: CY - 332 },
    { x: CX + 390, y: CY - 104 },
    { x: CX + 330, y: CY + 154 },
    { x: CX + 126, y: CY + 172 },
  ];
  const coldLoop = [
    { x: CX - 148, y: CY + 180 },
    { x: CX - 372, y: CY + 184 },
    { x: CX - 408, y: CY - 48 },
    { x: CX - 278, y: CY - 264 },
    { x: CX - 78, y: CY - 216 },
  ];

  carveOwnedPolyline(world, pressureLoop, 3, Tex.F_CONCRETE, ZoneFaction.LIQUIDATOR);
  carveOwnedPolyline(world, hotLoop, 3, Tex.F_TILE, ZoneFaction.LIQUIDATOR);
  carveOwnedPolyline(world, coldLoop, 3, Tex.F_WATER, ZoneFaction.WILD, Cell.WATER);
  carveLine(world, CX - 278, CY - 264, CX - 162, CY - 78, 2, Tex.F_WATER, ZoneFaction.WILD);
  carveLine(world, CX + 268, CY - 332, CX + 122, CY - 78, 2, Tex.F_TILE, ZoneFaction.LIQUIDATOR);
  carveLine(world, CX - 348, CY + 266, CX - 124, CY + 150, 2, Tex.F_CONCRETE, ZoneFaction.CITIZEN);
  carveLine(world, CX + 372, CY + 238, CX + 132, CY + 150, 2, Tex.F_CONCRETE, ZoneFaction.LIQUIDATOR);
}

function carveOwnedPolyline(
  world: World,
  points: readonly Point[],
  width: number,
  floorTex: Tex,
  owner: TerritoryOwner,
  cell = Cell.FLOOR,
): void {
  for (let i = 1; i < points.length; i++) {
    carveOwnedLine(world, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, width, floorTex, owner, cell);
  }
}

function carveOwnedLine(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  floorTex: Tex,
  owner: TerritoryOwner,
  cell = Cell.FLOOR,
): void {
  if (ax !== bx && ay !== by) {
    carveOwnedLine(world, ax, ay, bx, ay, width, floorTex, owner, cell);
    carveOwnedLine(world, bx, ay, bx, by, width, floorTex, owner, cell);
    return;
  }
  const from = ax === bx ? Math.min(ay, by) : Math.min(ax, bx);
  const to = ax === bx ? Math.max(ay, by) : Math.max(ax, bx);
  for (let p = from; p <= to; p++) {
    for (let o = -width; o <= width; o++) {
      openBathhouseTile(world, ax === bx ? ax + o : p, ax === bx ? p : ay + o, floorTex, owner, cell);
    }
  }
}

function openBathhouseTile(world: World, x: number, y: number, floorTex: Tex, owner: TerritoryOwner, cell: Cell): void {
  const idx = world.idx(x, y);
  if (world.aptMask[idx] || world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.DOOR || world.hermoWall[idx]) return;
  if (world.roomMap[idx] >= 0) return;
  world.cells[idx] = cell;
  world.roomMap[idx] = -1;
  world.floorTex[idx] = cell === Cell.WATER ? Tex.F_WATER : floorTex;
  world.wallTex[idx] = Tex.PIPE;
  world.factionControl[idx] = owner;
  if (world.features[idx] !== Feature.LIFT_BUTTON) world.features[idx] = Feature.NONE;
  if (cell === Cell.WATER) world.fog[idx] = Math.max(world.fog[idx], 26);
}

function buildBathhouseHqCompounds(world: World): void {
  for (const spec of BATHHOUSE_HQ_SPECS) {
    const cx = spec.x + 18;
    const cy = spec.y + 10;
    carveOwnedLine(world, cx - 42, cy + 26, cx + 76, cy + 26, 2, spec.floorTex, spec.owner);
    const hq = tryAddBathhouseRoom(world, RoomType.HQ, spec.x, spec.y, 36, 20, spec.name, Tex.HERMO_WALL, spec.floorTex, spec.owner);
    if (!hq) continue;
    hq.sealed = true;
    markBathhouseHermeticRoom(world, hq);
    connectDoorToPoint(world, hq, 'south', hq.w >> 1, { x: cx, y: cy + 26 }, 2, spec.floorTex, spec.owner, true);
    paintRoomOwner(world, hq, spec.owner);
    decorateBathhouseRoom(world, hq, 0, spec.owner);

    const supports = [
      { type: RoomType.BATHROOM, name: `${spec.name}: саншлюз`, x: spec.x - 30, y: spec.y + 30, w: 24, h: 12, side: 'east' as const },
      { type: RoomType.KITCHEN, name: `${spec.name}: чайная`, x: spec.x + 40, y: spec.y + 30, w: 24, h: 12, side: 'west' as const },
      { type: RoomType.STORAGE, name: `${spec.name}: склад`, x: spec.x + 70, y: spec.y + 4, w: 22, h: 12, side: 'west' as const },
      { type: spec.owner === ZoneFaction.SCIENTIST ? RoomType.MEDICAL : RoomType.OFFICE, name: `${spec.name}: журнал`, x: spec.x - 28, y: spec.y + 4, w: 22, h: 12, side: 'east' as const },
      { type: RoomType.COMMON, name: `${spec.name}: предбанник`, x: spec.x + 12, y: spec.y + 46, w: 30, h: 12, side: 'north' as const },
    ];
    for (let i = 0; i < supports.length; i++) {
      const support = supports[i];
      const room = tryAddBathhouseRoom(world, support.type, support.x, support.y, support.w, support.h, support.name, spec.wallTex, spec.floorTex, spec.owner);
      if (!room) continue;
      connectDoorToPoint(world, room, support.side, support.side === 'north' ? room.w >> 1 : room.h >> 1, { x: cx, y: cy + 26 }, 2, spec.floorTex, spec.owner);
      decorateBathhouseRoom(world, room, i + 1, spec.owner);
      paintRoomOwner(world, room, spec.owner);
    }
  }
}

function buildBathhouseServiceBlocks(world: World, rng: () => number): void {
  let serial = 0;
  for (let gy = 0; gy < SERVICE_GRID_Y.length; gy++) {
    for (let gx = 0; gx < SERVICE_GRID_X.length; gx++) {
      const cx = SERVICE_GRID_X[gx];
      const cy = SERVICE_GRID_Y[gy];
      if (cx >= 330 && cx <= 700 && cy >= 305 && cy <= 730) continue;
      const owner = BATHHOUSE_OWNER_SEQUENCE[(gx + gy * 2) % BATHHOUSE_OWNER_SEQUENCE.length];
      const floorTex = bathhouseOwnerFloor(owner, serial);
      const wallTex = bathhouseOwnerWall(owner);
      buildBathhouseServiceBlock(world, cx, cy, owner, floorTex, wallTex, serial++, rng);
    }
  }
}

function buildBathhouseServiceBlock(
  world: World,
  cx: number,
  cy: number,
  owner: TerritoryOwner,
  floorTex: Tex,
  wallTex: Tex,
  serial: number,
  rng: () => number,
): void {
  const wobble = Math.round((rng() - 0.5) * 10);
  carveOwnedLine(world, cx - 66, cy, cx + 66, cy + wobble, 2, floorTex, owner);
  carveOwnedLine(world, cx, cy - 44, cx + Math.sign(wobble), cy + 44, 1, floorTex, owner);
  const hall = tryAddBathhouseRoom(world, RoomType.COMMON, cx - 22, cy - 8, 44, 16, `Гармоническая баня: смесительный узел ${serial + 1}`, wallTex, floorTex, owner);
  if (hall) {
    connectDoorToPoint(world, hall, 'west', hall.h >> 1, { x: cx - 66, y: cy }, 2, floorTex, owner);
    connectDoorToPoint(world, hall, 'east', hall.h >> 1, { x: cx + 66, y: cy + wobble }, 2, floorTex, owner);
    connectDoorToPoint(world, hall, 'north', hall.w >> 1, { x: cx, y: cy - 44 }, 1, floorTex, owner);
    connectDoorToPoint(world, hall, 'south', hall.w >> 1, { x: cx, y: cy + 44 }, 1, floorTex, owner);
    decorateBathhouseRoom(world, hall, serial, owner);
    paintRoomOwner(world, hall, owner);
  }

  const rooms = bathhouseMicroSpecs(cx, cy, serial, owner);
  for (let i = 0; i < rooms.length; i++) {
    const spec = rooms[i];
    const room = tryAddBathhouseRoom(world, spec.type, spec.x, spec.y, spec.w, spec.h, spec.name, wallTex, spec.floorTex ?? floorTex, owner);
    if (!room) continue;
    connectDoorToPoint(world, room, spec.side, spec.side === 'north' || spec.side === 'south' ? room.w >> 1 : room.h >> 1, { x: cx, y: cy }, 1, floorTex, owner);
    decorateBathhouseRoom(world, room, i + serial, owner);
    paintRoomOwner(world, room, owner);
  }
}

function bathhouseMicroSpecs(cx: number, cy: number, serial: number, owner: TerritoryOwner): {
  type: RoomType;
  x: number;
  y: number;
  w: number;
  h: number;
  side: 'north' | 'south' | 'west' | 'east';
  name: string;
  floorTex?: Tex;
}[] {
  const prefix = `Гармоническая баня: ${bathhouseOwnerLabel(owner)} блок ${serial + 1}`;
  return [
    { type: RoomType.BATHROOM, x: cx - 62, y: cy - 34, w: 18, h: 11, side: 'south', name: `${prefix}: душевая А`, floorTex: Tex.F_TILE },
    { type: RoomType.STORAGE, x: cx - 40, y: cy - 36, w: 16, h: 12, side: 'south', name: `${prefix}: шкаф пара` },
    { type: RoomType.PRODUCTION, x: cx - 18, y: cy - 38, w: 20, h: 13, side: 'south', name: `${prefix}: насосная` },
    { type: RoomType.MEDICAL, x: cx + 8, y: cy - 34, w: 17, h: 11, side: 'south', name: `${prefix}: ожоговая`, floorTex: Tex.F_TILE },
    { type: RoomType.BATHROOM, x: cx + 32, y: cy - 36, w: 18, h: 12, side: 'south', name: `${prefix}: душевая Б`, floorTex: Tex.F_WATER },
    { type: RoomType.KITCHEN, x: cx + 54, y: cy - 32, w: 18, h: 10, side: 'south', name: `${prefix}: чайник` },
    { type: RoomType.STORAGE, x: cx - 66, y: cy + 23, w: 18, h: 11, side: 'north', name: `${prefix}: сухая кладовая` },
    { type: RoomType.BATHROOM, x: cx - 42, y: cy + 25, w: 18, h: 12, side: 'north', name: `${prefix}: мокрый закуток`, floorTex: Tex.F_WATER },
    { type: RoomType.OFFICE, x: cx - 18, y: cy + 27, w: 18, h: 11, side: 'north', name: `${prefix}: журнал давления` },
    { type: RoomType.PRODUCTION, x: cx + 8, y: cy + 25, w: 20, h: 13, side: 'north', name: `${prefix}: венткамера` },
    { type: RoomType.STORAGE, x: cx + 36, y: cy + 24, w: 18, h: 11, side: 'north', name: `${prefix}: соляной шкаф` },
    { type: RoomType.SMOKING, x: cx + 58, y: cy + 22, w: 18, h: 10, side: 'north', name: `${prefix}: курилка полотенец` },
    { type: RoomType.CORRIDOR, x: cx - 82, y: cy - 8, w: 14, h: 16, side: 'east', name: `${prefix}: боковой шлюз` },
    { type: RoomType.COMMON, x: cx + 70, y: cy - 8, w: 16, h: 16, side: 'west', name: `${prefix}: боковой предбанник` },
  ];
}

function tryAddBathhouseRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
  owner: TerritoryOwner,
): Room | null {
  if (!canStampBathhouseRoom(world, x, y, w, h)) return null;
  const room = addRoom(world, type, x, y, w, h, name, wallTex, floorTex);
  paintRoomOwner(world, room, owner);
  return room;
}

function canStampBathhouseRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  if (x < 2 || y < 2 || x + w + 2 >= W || y + h + 2 >= W) return false;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const idx = world.idx(x + dx, y + dy);
      if (world.aptMask[idx] || world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.DOOR) return false;
      if (world.roomMap[idx] >= 0) return false;
    }
  }
  return true;
}

function markBathhouseHermeticRoom(world: World, room: Room): void {
  room.wallTex = Tex.HERMO_WALL;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      const interior = dx >= 0 && dx < room.w && dy >= 0 && dy < room.h;
      if (interior) continue;
      if (world.cells[idx] !== Cell.WALL || world.aptMask[idx]) continue;
      world.hermoWall[idx] = 1;
      world.wallTex[idx] = Tex.HERMO_WALL;
    }
  }
}

function repairBathhouseDoorFrames(world: World): void {
  for (const [idx, door] of world.doors) {
    if (world.cells[idx] !== Cell.DOOR) continue;
    const room = world.rooms[door.roomA];
    if (!room) continue;
    const x = idx % W;
    const y = (idx / W) | 0;
    const left = world.idx(x - 1, y);
    const right = world.idx(x + 1, y);
    const up = world.idx(x, y - 1);
    const down = world.idx(x, y + 1);
    const verticalPass = world.roomMap[up] === room.id || world.roomMap[down] === room.id;
    const jambs = verticalPass ? [left, right] : [up, down];
    const hermetic = door.state === DoorState.HERMETIC_OPEN || door.state === DoorState.HERMETIC_CLOSED;
    for (const jamb of jambs) {
      if (world.aptMask[jamb] || world.cells[jamb] === Cell.LIFT || world.cells[jamb] === Cell.DOOR) continue;
      if (world.roomMap[jamb] >= 0) continue;
      world.cells[jamb] = Cell.WALL;
      world.roomMap[jamb] = -1;
      world.wallTex[jamb] = hermetic ? Tex.HERMO_WALL : room.wallTex;
      world.features[jamb] = Feature.NONE;
      if (hermetic) world.hermoWall[jamb] = 1;
      world.factionControl[jamb] = world.factionControl[idx];
    }
  }
}

function paintRoomOwner(world: World, room: Room, owner: TerritoryOwner): void {
  forRoomCells(world, room, idx => {
    world.factionControl[idx] = owner;
  });
  for (const door of room.doors) world.factionControl[door] = owner;
}

function decorateBathhouseRoom(world: World, room: Room, serial: number, owner: TerritoryOwner): void {
  switch (room.type) {
    case RoomType.BATHROOM:
      for (let x = room.x + 2; x < room.x + room.w - 1; x += 4) {
        setFeature(world, x, room.y + 2, Feature.SINK);
        if (x + 1 < room.x + room.w - 1) setFeature(world, x + 1, room.y + room.h - 3, Feature.TOILET);
      }
      break;
    case RoomType.KITCHEN:
      setFeature(world, room.x + 2, room.y + 2, Feature.STOVE);
      setFeature(world, room.x + room.w - 4, room.y + 2, Feature.SINK);
      setFeature(world, room.x + room.w - 5, room.y + room.h - 3, Feature.TABLE);
      break;
    case RoomType.STORAGE:
      for (let x = room.x + 2; x < room.x + room.w - 2; x += 3) setFeature(world, x, room.y + 2, Feature.SHELF);
      break;
    case RoomType.PRODUCTION:
      for (let x = room.x + 3; x < room.x + room.w - 3; x += 5) {
        setFeature(world, x, room.y + 2, Feature.MACHINE);
        setFeature(world, x + 1, room.y + room.h - 3, Feature.APPARATUS);
      }
      break;
    case RoomType.MEDICAL:
      setFeature(world, room.x + 3, room.y + 2, Feature.BED);
      setFeature(world, room.x + room.w - 4, room.y + 2, Feature.APPARATUS);
      break;
    case RoomType.OFFICE:
    case RoomType.HQ:
      setFeature(world, room.x + 3, room.y + 2, Feature.DESK);
      setFeature(world, room.x + room.w - 4, room.y + 2, Feature.SCREEN);
      setFeature(world, room.x + room.w - 5, room.y + room.h - 3, owner === ZoneFaction.CULTIST ? Feature.CANDLE : Feature.LAMP);
      break;
    default:
      setFeature(world, room.x + 3, room.y + 2, serial % 2 === 0 ? Feature.TABLE : Feature.CHAIR);
      setFeature(world, room.x + room.w - 4, room.y + room.h - 3, Feature.LAMP);
      break;
  }
  if (room.floorTex === Tex.F_WATER) {
    forRoomCells(world, room, (idx, x, y) => {
      if ((x + y + serial) % 3 === 0 && world.features[idx] === Feature.NONE) {
        world.cells[idx] = Cell.WATER;
        world.fog[idx] = Math.max(world.fog[idx], 24);
      }
    });
  }
}

function bathhouseOwnerFloor(owner: TerritoryOwner, serial: number): Tex {
  if (owner === ZoneFaction.CITIZEN) return serial % 2 === 0 ? Tex.F_TILE : Tex.F_LINO;
  if (owner === ZoneFaction.SCIENTIST) return Tex.F_TILE;
  if (owner === ZoneFaction.WILD) return serial % 2 === 0 ? Tex.F_WATER : Tex.F_CONCRETE;
  if (owner === ZoneFaction.CULTIST) return Tex.F_CARPET;
  return Tex.F_CONCRETE;
}

function bathhouseOwnerWall(owner: TerritoryOwner): Tex {
  if (owner === ZoneFaction.CITIZEN) return Tex.TILE_W;
  if (owner === ZoneFaction.SCIENTIST) return Tex.HERMO_WALL;
  if (owner === ZoneFaction.WILD) return Tex.ROTTEN;
  if (owner === ZoneFaction.CULTIST) return Tex.CROSS;
  return Tex.METAL;
}

function bathhouseOwnerLabel(owner: TerritoryOwner): string {
  if (owner === ZoneFaction.CITIZEN) return 'гражданский';
  if (owner === ZoneFaction.SCIENTIST) return 'лабораторный';
  if (owner === ZoneFaction.WILD) return 'дикий';
  if (owner === ZoneFaction.CULTIST) return 'культовый';
  return 'ликвидаторский';
}

export function alignHarmonicBathhouseAmbientNpcTerritory(world: World, entities: Entity[]): void {
  const cells = bathhouseTerritorySpawnCells(world);
  const offsets = new Uint16Array(8);
  for (const entity of entities) {
    if (!isHarmonicBathhouseAmbientNpc(entity) || entity.faction === undefined) continue;
    const owner = factionToTerritoryOwner(entity.faction);
    const list = cells.get(owner);
    if (!list || list.length === 0) continue;
    const offset = offsets[owner]++ | 0;
    const cell = list[(entity.id * 149 + offset * 431) % list.length];
    entity.x = (cell % W) + 0.5;
    entity.y = ((cell / W) | 0) + 0.5;
    entity.assignedRoomId = world.roomMap[cell] >= 0 ? world.roomMap[cell] : -1;
    if (entity.ai) {
      entity.ai.tx = cell % W;
      entity.ai.ty = (cell / W) | 0;
      entity.ai.path = [];
      entity.ai.pi = 0;
      entity.ai.stuck = 0;
    }
  }
}

function isHarmonicBathhouseAmbientNpc(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    entity.alive &&
    entity.name?.startsWith('Гармоническая баня:') === true &&
    entity.plotNpcId === undefined &&
    entity.persistentNpcId === undefined &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    entity.faction !== undefined;
}

function bathhouseTerritorySpawnCells(world: World): Map<TerritoryOwner, number[]> {
  const cells = new Map<TerritoryOwner, number[]>();
  for (const owner of HUMAN_TERRITORY_OWNERS) cells.set(owner, []);
  for (let i = 0; i < W * W; i++) {
    const cell = world.cells[i];
    if (cell !== Cell.FLOOR && cell !== Cell.WATER) continue;
    if (world.aptMask[i] || world.hermoWall[i] || world.containerMap.has(i) || world.features[i] === Feature.LIFT_BUTTON) continue;
    const owner = world.factionControl[i] as TerritoryOwner;
    const list = cells.get(owner);
    if (list) list.push(i);
  }
  return cells;
}

function placePanels(world: World, rooms: BathhouseRooms): string[] {
  const placed = [
    placeEmergencyPanel(world, rooms.boiler.x + 12, rooms.boiler.y + 10, 'panel_power', SEED ^ 0xba01),
    placeEmergencyPanel(world, rooms.hotGallery.x + 10, rooms.hotGallery.y + 12, 'panel_vent', SEED ^ 0xba02),
    placeEmergencyPanel(world, rooms.repairGallery.x + 14, rooms.repairGallery.y + 14, 'panel_water', SEED ^ 0xba03),
    placeEmergencyPanel(world, rooms.lowerLift.x + 18, rooms.lowerLift.y + 14, 'panel_doors', SEED ^ 0xba04),
  ];
  return placed.filter(panel => !!panel).map(panel => `${panel!.defId}:${panel!.idx}`);
}

function registerHazards(world: World, rooms: BathhouseRooms, seed: number): string[] {
  const hotCells = roomCellsByHash(world, rooms.hotGallery, seed ^ 0x5100, 0.58);
  const coldCells = roomWaterCells(world, rooms.coldBypass);
  const pressureCells = roomCellsByHash(world, rooms.boiler, seed ^ 0x5200, 0.22);

  registerCellHazardSite(world, {
    id: 'harmonic_bathhouse_hot_fast_path',
    kind: 'steam_pressure',
    displayName: 'Паровой сброс',
    cells: hotCells,
    tags: [HARMONIC_BATHHOUSE_ROUTE_ID, 'hot_fast_path', 'steam', 'pressure'],
    sticky: false,
    cleanable: true,
    slowMult: 0.62,
    trappedMult: 0.34,
    pulsePeriodSeconds: 7.5,
    pulseActiveSeconds: 4.2,
    activeFog: 132,
    inactiveFog: 44,
    playerDamagePerSecond: 2.2,
    monsterDamagePerSecond: 1.2,
    roomId: rooms.hotGallery.id,
    centerX: rooms.hotGallery.x + rooms.hotGallery.w / 2,
    centerY: rooms.hotGallery.y + rooms.hotGallery.h / 2,
    warning: 'Пар режет быстрый ход. Идите рывком, чините вытяжку или уходите в холодный обход.',
    inactiveWarning: 'Пар ушёл в стояк. Горячий ход открыт на короткий такт.',
    warningColor: '#ff8a45',
  });
  registerCellHazardSite(world, {
    id: 'harmonic_bathhouse_cold_flooded_bypass',
    kind: 'cold_flood',
    displayName: 'Холодный затопленный обход',
    cells: coldCells,
    tags: [HARMONIC_BATHHOUSE_ROUTE_ID, 'cold_flooded_bypass', 'water', 'slow'],
    sticky: false,
    cleanable: false,
    slowMult: 0.66,
    trappedMult: 0.42,
    activeFog: 32,
    roomId: rooms.coldBypass.id,
    centerX: rooms.coldBypass.x + rooms.coldBypass.w / 2,
    centerY: rooms.coldBypass.y + rooms.coldBypass.h / 2,
    warning: 'Вода ледяная и тянет обувь. Безопаснее пара, но медленнее.',
    warningColor: '#79c8ff',
  });
  registerCellHazardSite(world, {
    id: 'harmonic_bathhouse_boiler_pressure_leak',
    kind: 'pressure_leak',
    displayName: 'Срыв давления',
    cells: pressureCells,
    tags: [HARMONIC_BATHHOUSE_ROUTE_ID, 'turn_valve', 'repair_pressure_route', 'pressure'],
    sticky: false,
    cleanable: true,
    slowMult: 0.72,
    pulsePeriodSeconds: 9,
    pulseActiveSeconds: 2.5,
    activeFog: 118,
    inactiveFog: 34,
    playerDamagePerSecond: 1.4,
    monsterDamagePerSecond: 0.6,
    roomId: rooms.boiler.id,
    centerX: rooms.boiler.x + rooms.boiler.w / 2,
    centerY: rooms.boiler.y + rooms.boiler.h / 2,
    warning: 'Котёл бьёт обратным давлением. Вентиль просит бирку, герметик и терпение.',
    inactiveWarning: 'Стрелка манометра упала. Можно проскочить к котлу.',
    warningColor: '#ffd16f',
  });

  return [
    'harmonic_bathhouse_hot_fast_path',
    'harmonic_bathhouse_cold_flooded_bypass',
    'harmonic_bathhouse_boiler_pressure_leak',
  ];
}

function roomCellsByHash(world: World, room: Room, seed: number, chance: number): number[] {
  const out: number[] = [];
  forRoomCells(world, room, (ci, x, y) => {
    if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) return;
    if (hash01(seed, x, y, 19) <= chance) out.push(ci);
  });
  return out;
}

function roomWaterCells(world: World, room: Room): number[] {
  const out: number[] = [];
  forRoomCells(world, room, ci => {
    if (world.cells[ci] === Cell.WATER) out.push(ci);
  });
  return out;
}

function registerCues(world: World, rooms: BathhouseRooms): string[] {
  const cues = [
    {
      id: 'harmonic_bathhouse_turn_valve',
      room: rooms.mixingHall,
      target: rooms.boiler,
      label: 'поющий вентиль',
      hint: 'Котельная держит давление. Водяной щиток и вентиль меняют соседние комнаты, не весь этаж.',
      color: '#ffd16f',
      tags: ['turn_valve', 'pressure', 'steam'],
      group: {
        id: 'harmonic_bathhouse_valve',
        lead: 'Котёл держит горячий ход под давлением.',
        risk: 'Срыв пара бьёт короткими тактами.',
        decision: 'Повернуть вентиль или оставить быстрый ход опасным.',
        reward: 'Меньше пара рядом с котлом и доступ к ремонтным шкафам.',
      },
    },
    {
      id: 'harmonic_bathhouse_hot_fast_path',
      room: rooms.entry,
      target: rooms.hotGallery,
      label: 'горячий быстрый ход',
      hint: 'Короткий путь к нижней кабине идёт через паровой сброс.',
      color: '#ff8a45',
      tags: ['hot_fast_path', 'steam', 'route_choice'],
      group: {
        id: 'harmonic_bathhouse_hot_fast_path',
        lead: 'Паровая галерея почти прямая.',
        risk: 'Пульсирующий пар режет здоровье и видимость.',
        decision: 'Идти быстро через жар или чинить вытяжку.',
        reward: 'Самый короткий путь к нижней кабине.',
      },
    },
    {
      id: 'harmonic_bathhouse_cold_flooded_bypass',
      room: rooms.entry,
      target: rooms.coldBypass,
      label: 'холодный обход',
      hint: 'Затопленный путь медленный, но обходит основную паровую петлю.',
      color: '#79c8ff',
      tags: ['cold_flooded_bypass', 'water', 'route_choice'],
      group: {
        id: 'harmonic_bathhouse_cold_flooded_bypass',
        lead: 'Слева вода держит обход до сушилок.',
        risk: 'Вода тянет шаг и собирает мокрых тварей.',
        decision: 'Терять время в воде или идти через жар.',
        reward: 'Меньше прямого урона от пара.',
      },
    },
    {
      id: 'harmonic_bathhouse_repair_pressure_route',
      room: rooms.mixingHall,
      target: rooms.repairGallery,
      label: 'галерея манометров',
      hint: 'Ремонтный щиток может осушить или затуманить только соседние комнаты.',
      color: '#b7d0c0',
      tags: ['repair_pressure_route', 'panel', 'route_choice'],
      group: {
        id: 'harmonic_bathhouse_repair_pressure_route',
        lead: 'Манометры показывают, где давление спорит с водой.',
        risk: 'Ошибочная перегрузка зовёт местную аварию.',
        decision: 'Починить контур, сорвать пломбу или уйти без ремонта.',
        reward: 'Локально чище туман, вода и двери.',
      },
    },
  ] as const;

  for (const cue of cues) {
    registerRouteCue(world, {
      id: cue.id,
      x: cue.room.x + cue.room.w / 2,
      y: cue.room.y + cue.room.h / 2,
      targetX: cue.target.x + cue.target.w / 2,
      targetY: cue.target.y + cue.target.h / 2,
      floor: HARMONIC_BATHHOUSE_BASE_FLOOR,
      label: cue.label,
      hint: cue.hint,
      targetName: cue.target.name,
      color: cue.color,
      tags: [HARMONIC_BATHHOUSE_ROUTE_ID, ...cue.tags],
      toneSeed: SEED ^ cue.id.length * 131,
      roomId: cue.room.id,
      targetRoomId: cue.target.id,
      radius: 13,
      targetRadius: 4,
      routeGroup: cue.group,
      heardText: cue.hint,
      followedText: `Вы приняли маршрут: ${cue.label}.`,
      ignoredText: `Вы отвернулись от маршрута: ${cue.label}.`,
    });
  }
  return cues.map(cue => cue.id);
}

function placeContainers(world: World, rooms: BathhouseRooms): void {
  addContainer(world, rooms.repairGallery, rooms.repairGallery.x + 132, rooms.repairGallery.y + 13, ContainerKind.TOOL_LOCKER, 'Шкаф галереи манометров', 'locked', [
    { defId: 'valve_tag', count: 1 },
    { defId: 'sealant_tube', count: 1 },
    { defId: 'manometer', count: 1 },
    { defId: 'asbestos_cord', count: 1 },
  ], ['harmonic_bathhouse', 'repair_pressure_route', 'pressure', 'tool']);
  addContainer(world, rooms.boiler, rooms.boiler.x + rooms.boiler.w - 12, rooms.boiler.y + 12, ContainerKind.METAL_CABINET, 'Горячий шкаф котельной', 'secret', [
    { defId: 'pressure_logbook', count: 1 },
    { defId: 'boiler_water', count: 2 },
    { defId: 'burn_gel', count: 1 },
  ], ['harmonic_bathhouse', 'turn_valve', 'steam', 'theft']);
  addContainer(world, rooms.coldBypass, rooms.coldBypass.x + 12, rooms.coldBypass.y + rooms.coldBypass.h - 14, ContainerKind.EMERGENCY_BOX, 'Мокрый ящик холодного обхода', 'public', [
    { defId: 'filtered_water', count: 2 },
    { defId: 'gasmask_filter', count: 1 },
    { defId: 'bandage', count: 1 },
  ], ['harmonic_bathhouse', 'cold_flooded_bypass', 'water', 'public']);
  addContainer(world, rooms.hotGallery, rooms.hotGallery.x + rooms.hotGallery.w - 14, rooms.hotGallery.y + rooms.hotGallery.h - 16, ContainerKind.TOOL_LOCKER, 'Сухой шкаф горячего хода', 'locked', [
    { defId: 'fuse', count: 1 },
    { defId: 'relay_diagram', count: 1 },
    { defId: 'gasmask_filter', count: 1 },
  ], ['harmonic_bathhouse', 'hot_fast_path', 'vent', 'tool']);
}

function addContainer(
  world: World,
  room: Room,
  x: number,
  y: number,
  kind: ContainerKind,
  name: string,
  access: WorldContainer['access'],
  inventory: readonly Item[],
  tags: readonly string[],
): void {
  const ci = world.idx(x, y);
  world.addContainer({
    id: world.containers.length,
    x,
    y,
    floor: HARMONIC_BATHHOUSE_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind,
    name,
    inventory: inventory.map(item => ({ ...item })),
    capacitySlots: 8,
    access,
    lockDifficulty: access === 'locked' ? 2 : access === 'secret' ? 3 : undefined,
    discovered: access !== 'secret',
    tags: [...tags],
  });
  setFeature(world, x, y, kind === ContainerKind.TOOL_LOCKER ? Feature.SHELF : Feature.APPARATUS);
}

function spawnBathhouseNpcs(entities: Entity[], nextId: NextId, rooms: BathhouseRooms): void {
  spawnNpc(entities, nextId, 'Смотрительница пара', Faction.LIQUIDATOR, Occupation.MECHANIC, rooms.repairGallery.x + 34, rooms.repairGallery.y + 14, [
    { defId: 'valve_tag', count: 1 },
    { defId: 'pressure_logbook', count: 1 },
  ]);
  spawnNpc(entities, nextId, 'Банщик без смены', Faction.CITIZEN, Occupation.LOCKSMITH, rooms.centralBath.x + 18, rooms.centralBath.y + 28, [
    { defId: 'boiler_water', count: 1 },
    { defId: 'asbestos_cord', count: 1 },
  ]);
  spawnNpc(entities, nextId, 'Дикий ныряльщик обхода', Faction.WILD, Occupation.HUNTER, rooms.coldBypass.x + 34, rooms.coldBypass.y + 118, [
    { defId: 'filtered_water', count: 1 },
    { defId: 'gasmask_filter', count: 1 },
  ]);
}

function spawnNpc(
  entities: Entity[],
  nextId: NextId,
  name: string,
  faction: Faction,
  occupation: Occupation,
  x: number,
  y: number,
  inventory: Item[],
): void {
  entities.push({
    id: nextId.v++,
    type: EntityType.NPC,
    x: x + 0.5,
    y: y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0.86,
    sprite: occupation,
    name,
    hp: 125,
    maxHp: 125,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    faction,
    occupation,
    assignedRoomId: -1,
    questId: -1,
    canGiveQuest: false,
    inventory,
    needs: freshNeeds(),
    rpg: randomRPG(3),
  });
}

function spawnBathhouseThreats(world: World, entities: Entity[], nextId: NextId, rooms: BathhouseRooms): void {
  spawnMonster(world, entities, nextId, MonsterKind.TUMANNIK, rooms.hotGallery.x + 46, rooms.hotGallery.y + 74, 4, 'Туманник паровой галереи');
  spawnMonster(world, entities, nextId, MonsterKind.VODYANOY_KOSHMAR, rooms.coldBypass.x + 38, rooms.coldBypass.y + 86, 4, 'Водяной кошмар холодного обхода');
  spawnMonster(world, entities, nextId, MonsterKind.TRUBNYY_AVTOMAT, rooms.boiler.x + 48, rooms.boiler.y + 34, 4, 'Трубный автомат котельной');
}

function spawnMonster(
  world: World,
  entities: Entity[],
  nextId: NextId,
  kind: MonsterKind,
  x: number,
  y: number,
  level: number,
  name: string,
): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) return;
  const def = MONSTERS[kind];
  if (!def) return;
  const hp = Math.round(def.hp * (0.9 + level * 0.14));
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: def.speed,
    sprite: monsterSpr(kind),
    name,
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
  });
}

function decisionNode(id: BathhouseDecisionId, room: Room, tags: readonly string[]): BathhouseRouteNode {
  return {
    id,
    roomName: room.name,
    roomId: room.id,
    x: room.x + room.w / 2,
    y: room.y + room.h / 2,
    tags,
  };
}

export function dropBathhouseDebugItem(world: World, entities: Entity[], nextId: NextId, x: number, y: number, defId: string, count: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) return;
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
