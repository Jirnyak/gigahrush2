/* -- Design floor: hilbert_depot - indexed cargo curve and locked chords -- */

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
import { ITEMS } from '../../data/catalog';
import { HUMAN_TERRITORY_OWNERS, factionToTerritoryOwner } from '../../data/factions';
import { MONSTERS } from '../../entities/monster';
import { Spr, monsterSpr } from '../../render/sprite_index';
import { registerRouteCue } from '../../systems/route_cues';
import { setTerritoryOwnerAtIndex, territoryOwnerAtIndex } from '../../systems/territory';
import {
  ensureConnectivity,
  generateZones,
  sanitizeDoors,
  stampRoom,
} from '../shared';
import type { FloorGeneration } from '../floor_manifest';

export const DESIGN_FLOOR_ID = 'hilbert_depot' as const;
export const HILBERT_DEPOT_ROUTE_Z = -30;
export const HILBERT_DEPOT_BASE_FLOOR = FloorLevel.MAINTENANCE;
export const HILBERT_DEPOT_CARGO_TAG = 'hilbert_depot_indexed_cargo';
export const HILBERT_DEPOT_CHORD_TAG = 'hilbert_depot_locked_chord';

const CURVE_ORDER = 4;
const CURVE_STEP = 34;
const CURVE_X = 256;
const CURVE_Y = 256;
const CONTENT_TAG = 'hilbert_depot';
const SAFE_AISLE_RADIUS = 1;
const BAY_FIRST_INDEX = 8;
const BAY_INDEX_STEP = 8;
const ROUTE_GRAPH_ORDER = 5;
const ROUTE_GRAPH_X = 32;
const ROUTE_GRAPH_Y = 32;
const ROUTE_GRAPH_STEP = 30;
const BLOCK_GRAPH_ORDER = 3;
const BLOCK_GRAPH_X = 92;
const BLOCK_GRAPH_Y = 108;
const BLOCK_GRAPH_STEP = 112;

interface Point {
  x: number;
  y: number;
}

interface DepotHqSpec {
  owner: TerritoryOwner;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  support: readonly DepotSupportSpec[];
}

interface DepotSupportSpec {
  type: RoomType;
  name: string;
  dx: number;
  dy: number;
  w: number;
  h: number;
}

const DEPOT_OWNER_SEQUENCE: readonly TerritoryOwner[] = [
  ZoneFaction.LIQUIDATOR,
  ZoneFaction.SCIENTIST,
  ZoneFaction.CITIZEN,
  ZoneFaction.WILD,
  ZoneFaction.LIQUIDATOR,
  ZoneFaction.CULTIST,
  ZoneFaction.SCIENTIST,
  ZoneFaction.LIQUIDATOR,
];

const DEPOT_HQ_SPECS: readonly DepotHqSpec[] = [
  {
    owner: ZoneFaction.LIQUIDATOR,
    name: 'Склад Гильберта: главный гермопост ликвидаторов',
    x: 716,
    y: 176,
    w: 34,
    h: 18,
    support: [
      { type: RoomType.STORAGE, name: 'оружейная ячейка', dx: -30, dy: -18, w: 24, h: 12 },
      { type: RoomType.OFFICE, name: 'журнал коротких хорд', dx: 40, dy: -16, w: 24, h: 12 },
      { type: RoomType.KITCHEN, name: 'пункт сухпайка', dx: -28, dy: 28, w: 24, h: 12 },
      { type: RoomType.MEDICAL, name: 'перевязочная учета', dx: 42, dy: 26, w: 22, h: 12 },
      { type: RoomType.COMMON, name: 'караульный предбанник', dx: 6, dy: 32, w: 26, h: 12 },
    ],
  },
  {
    owner: ZoneFaction.SCIENTIST,
    name: 'Склад Гильберта: НИИ узла нумерации',
    x: 164,
    y: 188,
    w: 30,
    h: 16,
    support: [
      { type: RoomType.OFFICE, name: 'кабинет индекса', dx: -28, dy: -16, w: 22, h: 11 },
      { type: RoomType.MEDICAL, name: 'измерительная', dx: 34, dy: -16, w: 22, h: 11 },
      { type: RoomType.STORAGE, name: 'архив этикеток', dx: -28, dy: 26, w: 22, h: 11 },
      { type: RoomType.PRODUCTION, name: 'стол калибровки', dx: 34, dy: 24, w: 24, h: 12 },
      { type: RoomType.BATHROOM, name: 'санпропускник НИИ', dx: 4, dy: 30, w: 20, h: 10 },
    ],
  },
  {
    owner: ZoneFaction.CITIZEN,
    name: 'Склад Гильберта: гражданская приемка паек',
    x: 168,
    y: 710,
    w: 30,
    h: 16,
    support: [
      { type: RoomType.KITCHEN, name: 'кухня талонов', dx: -30, dy: -16, w: 24, h: 12 },
      { type: RoomType.COMMON, name: 'комната очереди', dx: 34, dy: -16, w: 24, h: 12 },
      { type: RoomType.STORAGE, name: 'общая кладовая', dx: -30, dy: 26, w: 24, h: 12 },
      { type: RoomType.MEDICAL, name: 'медугол очереди', dx: 36, dy: 24, w: 22, h: 11 },
      { type: RoomType.BATHROOM, name: 'санузел приемки', dx: 4, dy: 30, w: 20, h: 10 },
    ],
  },
  {
    owner: ZoneFaction.WILD,
    name: 'Склад Гильберта: разбитый гермокор диких',
    x: 746,
    y: 790,
    w: 28,
    h: 15,
    support: [
      { type: RoomType.STORAGE, name: 'разобранная кладовая', dx: -30, dy: -16, w: 24, h: 12 },
      { type: RoomType.SMOKING, name: 'курилка самозахвата', dx: 34, dy: -16, w: 22, h: 11 },
      { type: RoomType.COMMON, name: 'общий угол', dx: -28, dy: 24, w: 24, h: 12 },
      { type: RoomType.KITCHEN, name: 'плитка на ящике', dx: 34, dy: 24, w: 22, h: 11 },
      { type: RoomType.BATHROOM, name: 'сорванный санузел', dx: 2, dy: 28, w: 20, h: 10 },
    ],
  },
  {
    owner: ZoneFaction.CULTIST,
    name: 'Склад Гильберта: скрытая культовая ячейка',
    x: 376,
    y: 858,
    w: 28,
    h: 15,
    support: [
      { type: RoomType.COMMON, name: 'тихая комната следа', dx: -30, dy: -16, w: 24, h: 12 },
      { type: RoomType.STORAGE, name: 'кладовая свечей', dx: 34, dy: -16, w: 22, h: 11 },
      { type: RoomType.KITCHEN, name: 'ритуальный кипяток', dx: -28, dy: 24, w: 22, h: 11 },
      { type: RoomType.OFFICE, name: 'лист чужих номеров', dx: 34, dy: 24, w: 22, h: 11 },
      { type: RoomType.BATHROOM, name: 'мойка хорд', dx: 2, dy: 28, w: 20, h: 10 },
    ],
  },
];

export interface HilbertDepotChordState {
  fromIndex: number;
  toIndex: number;
  doorCells: number[];
}

export interface HilbertDepotState {
  routeId: typeof DESIGN_FLOOR_ID;
  anchorZ: typeof HILBERT_DEPOT_ROUTE_Z;
  baseFloor: typeof HILBERT_DEPOT_BASE_FLOOR;
  curveOrder: typeof CURVE_ORDER;
  curvePointCount: number;
  cargoContainerIds: number[];
  cargoOrders: number[];
  lockedChordDoorCells: number[];
  chords: HilbertDepotChordState[];
  debugEntry: {
    spawnX: number;
    spawnY: number;
    summary: string;
  };
}

export interface HilbertDepotGeneration extends FloorGeneration {
  hilbertState: HilbertDepotState;
}

export function generateHilbertDepotDesignFloor(): HilbertDepotGeneration {
  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 1 };
  const points = hilbertTracePoints(CURVE_ORDER, CURVE_X, CURVE_Y, CURVE_STEP);
  const state: HilbertDepotState = {
    routeId: DESIGN_FLOOR_ID,
    anchorZ: HILBERT_DEPOT_ROUTE_Z,
    baseFloor: HILBERT_DEPOT_BASE_FLOOR,
    curveOrder: CURVE_ORDER,
    curvePointCount: points.length,
    cargoContainerIds: [],
    cargoOrders: [],
    lockedChordDoorCells: [],
    chords: [],
    debugEntry: {
      spawnX: CURVE_X - 10.5,
      spawnY: CURVE_Y - 1.5,
      summary: 'hilbert_depot z=-30: safe aisle follows Hilbert index; locked chords cut distant cargo order.',
    },
  };

  for (let i = 0; i < W * W; i++) {
    world.wallTex[i] = Tex.METAL;
    world.floorTex[i] = Tex.F_CONCRETE;
  }

  carveSafeCurve(world, points);
  const entry = addNamedRoom(world, RoomType.CORRIDOR, CURVE_X - 30, CURVE_Y - 10, 16, 14, 'Лифтовая приемка склада Гильберта', Tex.LIFT_DOOR, Tex.F_CONCRETE);
  const exitPoint = points[points.length - 1];
  const exit = addNamedRoom(world, RoomType.CORRIDOR, exitPoint.x + 12, exitPoint.y - 10, 16, 14, 'Дальняя приемка склада Гильберта', Tex.LIFT_DOOR, Tex.F_CONCRETE);
  state.debugEntry.spawnX = entry.x + entry.w - 3 + 0.5;
  state.debugEntry.spawnY = entry.y + 7 + 0.5;
  connectRoomToPoint(world, entry, CURVE_X, CURVE_Y, DoorState.CLOSED);
  connectRoomToPoint(world, exit, exitPoint.x, exitPoint.y, DoorState.CLOSED);
  placeLift(world, entry.x + 3, entry.y + 7, LiftDirection.UP);
  placeLift(world, exit.x + exit.w - 4, exit.y + 7, LiftDirection.DOWN);

  for (let d = BAY_FIRST_INDEX; d < points.length - BAY_FIRST_INDEX; d += BAY_INDEX_STEP) {
    addCargoBay(world, state, points, d);
  }

  addDepotChords(world, state, points);
  decorateSafeCurve(world, points);
  addDepotPressure(entities, nextId, points);
  addItemDrop(world, entities, nextId, CURVE_X + 2, CURVE_Y + 2, 'track_diagram_scrap', 1, 'Индексная памятка склада Гильберта: видимый сосед может быть чужим номером. Идите по Г-000, Г-008, Г-016, пока не решите резать хорду.');

  generateZones(world);
  refreshContainerZones(world);
  ensureConnectivity(world, state.debugEntry.spawnX, state.debugEntry.spawnY);
  sanitizeDoors(world);
  world.rebuildContainerMap();
  registerHilbertDepotRouteCues(world, state, points, entry, exit);
  world.bakeLights();

  return {
    world,
    entities,
    spawnX: state.debugEntry.spawnX,
    spawnY: state.debugEntry.spawnY,
    hilbertState: state,
  };
}

export function expandHilbertDepotRouteGeometry(world: World, rng: () => number): void {
  carveDepotRouteGraph(world);
  buildDepotHqCompounds(world);
  buildDepotIndexBlocks(world, rng);
  repairDepotDoorFrames(world);
  world.markCellsDirty();
  world.markFloorTexDirty();
  world.markWallTexDirty();
  world.markFeaturesDirty(false);
  world.markFogDirty();
}

export function applyHilbertDepotTerritorySeeds(world: World): void {
  for (const spec of DEPOT_HQ_SPECS) {
    const hq = world.rooms.find(room => room.name === spec.name);
    if (hq) {
      hardenDepotHqRoom(world, hq, spec.owner);
      paintDepotRoomOwner(world, hq, spec.owner);
    }
    for (const room of world.rooms) {
      if (room.name.startsWith(`${spec.name}:`)) paintDepotRoomOwner(world, room, spec.owner);
    }
  }
  world.markWallTexDirty();
  world.markFeaturesDirty(false);
}

export function alignHilbertDepotAmbientNpcTerritory(world: World, entities: Entity[]): void {
  const cells = depotTerritorySpawnCells(world);
  const offsets = new Uint16Array(8);
  for (const entity of entities) {
    if (!isHilbertDepotAmbientNpc(entity) || entity.faction === undefined) continue;
    const owner = factionToTerritoryOwner(entity.faction);
    const list = cells.get(owner);
    if (!list || list.length === 0) continue;
    const offset = offsets[owner]++ | 0;
    const cell = list[(entity.id * 157 + offset * 409) % list.length];
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

function carveSafeCurve(world: World, points: readonly Point[]): void {
  for (let i = 1; i < points.length; i++) {
    carveLine(world, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, SAFE_AISLE_RADIUS, Tex.F_CONCRETE);
  }
}

function decorateSafeCurve(world: World, points: readonly Point[]): void {
  for (let i = 0; i < points.length; i += 4) {
    const point = points[i];
    const feature =
      i % 32 === 0 ? Feature.SCREEN :
      i % 16 === 0 ? Feature.APPARATUS :
      i % 8 === 0 ? Feature.LAMP :
      Feature.SHELF;
    setFeature(world, point.x, point.y, feature);
  }
}

function carveDepotRouteGraph(world: World): void {
  const fine = hilbertTracePoints(ROUTE_GRAPH_ORDER, ROUTE_GRAPH_X, ROUTE_GRAPH_Y, ROUTE_GRAPH_STEP);
  for (let i = 1; i < fine.length; i++) {
    const owner = DEPOT_OWNER_SEQUENCE[(i >> 6) % DEPOT_OWNER_SEQUENCE.length];
    carveOwnedLine(world, fine[i - 1].x, fine[i - 1].y, fine[i].x, fine[i].y, 2, depotOwnerFloor(owner, i), owner);
  }

  const coarse = hilbertTracePoints(BLOCK_GRAPH_ORDER, BLOCK_GRAPH_X, BLOCK_GRAPH_Y, BLOCK_GRAPH_STEP);
  for (let i = 1; i < coarse.length; i++) {
    const owner = DEPOT_OWNER_SEQUENCE[i % DEPOT_OWNER_SEQUENCE.length];
    carveOwnedLine(world, coarse[i - 1].x, coarse[i - 1].y, coarse[i].x, coarse[i].y, 4, depotOwnerFloor(owner, i), owner);
  }

  const first = fine[0];
  const last = fine[fine.length - 1];
  carveOwnedLine(world, 0, first.y, first.x, first.y, 3, Tex.F_CONCRETE, ZoneFaction.LIQUIDATOR);
  carveOwnedLine(world, last.x, last.y, W - 1, last.y, 3, Tex.F_CONCRETE, ZoneFaction.LIQUIDATOR);
  carveOwnedLine(world, CURVE_X, CURVE_Y, first.x, first.y, 2, Tex.F_CONCRETE, ZoneFaction.LIQUIDATOR);
  carveOwnedLine(world, last.x, last.y, W - 18, W - 18, 2, Tex.F_CONCRETE, ZoneFaction.WILD);
}

function buildDepotIndexBlocks(world: World, rng: () => number): void {
  const nodes = hilbertTracePoints(BLOCK_GRAPH_ORDER, BLOCK_GRAPH_X, BLOCK_GRAPH_Y, BLOCK_GRAPH_STEP);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const owner = DEPOT_OWNER_SEQUENCE[(i + ((node.x + node.y) >> 7)) % DEPOT_OWNER_SEQUENCE.length];
    carveOwnedLine(world, node.x - 38, node.y, node.x + 38, node.y, 2, depotOwnerFloor(owner, i), owner);
    carveOwnedLine(world, node.x, node.y - 28, node.x, node.y + 28, 1, depotOwnerFloor(owner, i + 11), owner);
    buildDepotBlockRooms(world, node, owner, i, rng);
  }
}

function buildDepotBlockRooms(world: World, node: Point, owner: TerritoryOwner, serial: number, rng: () => number): void {
  const skew = Math.round((rng() - 0.5) * 6);
  const label = serial.toString().padStart(2, '0');
  const specs = [
    { type: RoomType.STORAGE, x: node.x - 30, y: node.y - 42 + skew, w: 24, h: 12, name: `Склад Гильберта: верхняя секция Г-${label}`, salt: 1 },
    { type: serial % 5 === 0 ? RoomType.PRODUCTION : RoomType.STORAGE, x: node.x + 4, y: node.y - 42 - skew, w: 24, h: 12, name: `Склад Гильберта: верхний шкаф Г-${label}`, salt: 2 },
    { type: serial % 4 === 0 ? RoomType.OFFICE : RoomType.STORAGE, x: node.x - 30, y: node.y + 30 - skew, w: 24, h: 12, name: `Склад Гильберта: нижняя секция Г-${label}`, salt: 3 },
    { type: serial % 7 === 0 ? RoomType.MEDICAL : RoomType.STORAGE, x: node.x + 4, y: node.y + 30 + skew, w: 24, h: 12, name: `Склад Гильберта: нижний шкаф Г-${label}`, salt: 4 },
    { type: serial % 6 === 0 ? RoomType.COMMON : RoomType.OFFICE, x: node.x - 58, y: node.y - 8, w: 22, h: 13, name: `Склад Гильберта: левая будка Г-${label}`, salt: 5 },
    { type: serial % 8 === 0 ? RoomType.BATHROOM : RoomType.STORAGE, x: node.x + 36, y: node.y - 8, w: 22, h: 13, name: `Склад Гильберта: правая будка Г-${label}`, salt: 6 },
  ] as const;

  for (const spec of specs) {
    const room = tryAddDepotRoom(world, spec.type, spec.x, spec.y, spec.w, spec.h, spec.name, depotOwnerWall(owner), depotOwnerFloor(owner, serial + spec.salt), owner);
    if (!room) continue;
    connectRoomToPoint(world, room, node.x, node.y, DoorState.CLOSED);
    paintDepotRoomOwner(world, room, owner);
    decorateDepotRoom(world, room, serial + spec.salt, owner);
  }
}

function buildDepotHqCompounds(world: World): void {
  for (const spec of DEPOT_HQ_SPECS) {
    const floorTex = depotOwnerFloor(spec.owner, spec.x + spec.y);
    const center = { x: spec.x + (spec.w >> 1), y: spec.y + spec.h + 25 };
    carveOwnedLine(world, center.x - 58, center.y, center.x + 72, center.y, 3, floorTex, spec.owner);
    carveOwnedLine(world, center.x, center.y - 20, center.x, center.y + 38, 2, floorTex, spec.owner);

    const hq = tryAddDepotRoom(world, RoomType.HQ, spec.x, spec.y, spec.w, spec.h, spec.name, Tex.HERMO_WALL, floorTex, spec.owner);
    if (hq) {
      connectRoomToPoint(world, hq, center.x, center.y, DoorState.HERMETIC_OPEN);
      hardenDepotHqRoom(world, hq, spec.owner);
      paintDepotRoomOwner(world, hq, spec.owner);
      decorateDepotRoom(world, hq, spec.x + spec.y, spec.owner);
    }

    for (let i = 0; i < spec.support.length; i++) {
      const support = spec.support[i];
      const room = tryAddDepotRoom(
        world,
        support.type,
        spec.x + support.dx,
        spec.y + support.dy,
        support.w,
        support.h,
        `${spec.name}: ${support.name}`,
        depotOwnerWall(spec.owner),
        depotOwnerFloor(spec.owner, i + spec.x),
        spec.owner,
      );
      if (!room) continue;
      connectRoomToPoint(world, room, center.x, center.y, DoorState.CLOSED);
      paintDepotRoomOwner(world, room, spec.owner);
      decorateDepotRoom(world, room, i + spec.y, spec.owner);
    }
  }
}

function addCargoBay(
  world: World,
  state: HilbertDepotState,
  points: readonly Point[],
  order: number,
): void {
  const point = points[order];
  const prev = points[Math.max(0, order - 1)];
  const next = points[Math.min(points.length - 1, order + 1)];
  const dx = Math.sign(next.x - prev.x);
  const normals = dx !== 0
    ? [{ x: 0, y: order % 16 === 0 ? -1 : 1 }, { x: 0, y: order % 16 === 0 ? 1 : -1 }]
    : [{ x: order % 16 === 0 ? 1 : -1, y: 0 }, { x: order % 16 === 0 ? -1 : 1, y: 0 }];
  const w = 12 + ((order >> 3) % 3) * 2;
  const h = 8 + ((order >> 4) % 2) * 2;

  for (const normal of normals) {
    const x = Math.round(point.x + normal.x * 18 - w / 2);
    const y = Math.round(point.y + normal.y * 18 - h / 2);
    if (!canStampRoom(world, x, y, w, h)) continue;
    const label = cargoLabel(order);
    const room = addNamedRoom(world, RoomType.STORAGE, x, y, w, h, `Индексная секция ${label}`, Tex.METAL, Tex.F_CONCRETE);
    connectRoomToPoint(world, room, point.x, point.y, DoorState.CLOSED);
    decorateCargoRoom(world, room, order);
    const container = addContainer(
      world,
      room,
      order,
      order % 5 === 0 ? ContainerKind.SAFE : order % 3 === 0 ? ContainerKind.METAL_CABINET : ContainerKind.TOOL_LOCKER,
      `Индексный груз ${label}`,
      cargoInventory(order),
      order % 5 === 0 ? 'locked' : order % 3 === 0 ? 'owner' : 'room',
      [
        CONTENT_TAG,
        HILBERT_DEPOT_CARGO_TAG,
        'safe_curve_order',
        `hilbert_order_${order.toString().padStart(3, '0')}`,
        order < 80 ? 'cargo_index_low' : order < 168 ? 'cargo_index_mid' : 'cargo_index_high',
      ],
    );
    state.cargoContainerIds.push(container.id);
    state.cargoOrders.push(order);
    return;
  }
}

function decorateCargoRoom(world: World, room: Room, order: number): void {
  for (let x = room.x + 2; x < room.x + room.w - 1; x += 3) {
    setFeature(world, x, room.y + 1, Feature.SHELF);
  }
  for (let y = room.y + 3; y < room.y + room.h - 1; y += 3) {
    setFeature(world, room.x + room.w - 2, y, order % 5 === 0 ? Feature.SCREEN : Feature.SHELF);
  }
  if (order % 4 === 0) setFeature(world, room.x + 2, room.y + room.h - 2, Feature.LAMP);
}

function addDepotChords(world: World, state: HilbertDepotState, points: readonly Point[]): void {
  for (const pair of selectChordPairs(points, 6)) {
    const cells = carveChord(world, points[pair.fromIndex], points[pair.toIndex]);
    const doors = placeChordDoors(world, cells);
    if (doors.length === 0) continue;
    state.lockedChordDoorCells.push(...doors);
    state.chords.push({ ...pair, doorCells: doors });
    const mid = cells[(cells.length / 2) | 0];
    if (mid !== undefined) {
      const x = mid % W;
      const y = (mid / W) | 0;
      setFeature(world, x, y, Feature.SCREEN);
    }
  }
}

function selectChordPairs(points: readonly Point[], count: number): { fromIndex: number; toIndex: number }[] {
  const out: { fromIndex: number; toIndex: number }[] = [];
  const used = new Set<number>();
  const nearUsed = (idx: number): boolean => {
    for (let i = idx - 7; i <= idx + 7; i++) if (used.has(i)) return true;
    return false;
  };
  for (let fromIndex = 6; fromIndex < points.length - 6 && out.length < count; fromIndex += 3) {
    if (nearUsed(fromIndex)) continue;
    for (let toIndex = fromIndex + 31; toIndex < points.length - 6; toIndex++) {
      if (nearUsed(toIndex)) continue;
      const dist = Math.abs(points[fromIndex].x - points[toIndex].x) + Math.abs(points[fromIndex].y - points[toIndex].y);
      if (dist < 48 || dist > 96) continue;
      out.push({ fromIndex, toIndex });
      for (let i = fromIndex - 7; i <= fromIndex + 7; i++) used.add(i);
      for (let i = toIndex - 7; i <= toIndex + 7; i++) used.add(i);
      break;
    }
  }
  return out;
}

function carveChord(world: World, a: Point, b: Point): number[] {
  const cells: number[] = [];
  const push = (x: number, y: number): void => {
    openCell(world, x, y, Tex.F_TILE);
    const ci = world.idx(x, y);
    if (cells[cells.length - 1] !== ci) cells.push(ci);
  };
  let x = a.x;
  let y = a.y;
  push(x, y);
  const dx = Math.sign(b.x - a.x);
  while (x !== b.x) {
    x += dx;
    push(x, y);
  }
  const dy = Math.sign(b.y - a.y);
  while (y !== b.y) {
    y += dy;
    push(x, y);
  }
  return cells;
}

function placeChordDoors(world: World, cells: readonly number[]): number[] {
  const doors: number[] = [];
  const startDoor = findChordDoorCell(world, cells, false);
  const endDoor = findChordDoorCell(world, cells, true);
  if (startDoor >= 0) doors.push(setLockedChordDoor(world, startDoor));
  if (endDoor >= 0 && endDoor !== startDoor) doors.push(setLockedChordDoor(world, endDoor));
  return doors;
}

function findChordDoorCell(world: World, cells: readonly number[], reverse: boolean): number {
  const start = reverse ? cells.length - 4 : 3;
  const end = reverse ? 2 : cells.length - 3;
  const step = reverse ? -1 : 1;
  for (let k = start; reverse ? k >= end : k <= end; k += step) {
    const prev = cells[k - 1];
    const cur = cells[k];
    const next = cells[k + 1];
    if (prev === undefined || cur === undefined || next === undefined) continue;
    const px = prev % W;
    const py = (prev / W) | 0;
    const cx = cur % W;
    const cy = (cur / W) | 0;
    const nx = next % W;
    const ny = (next / W) | 0;
    if (!((px === cx && cx === nx) || (py === cy && cy === ny))) continue;
    const horizontal = py === cy && cy === ny;
    const sideA = horizontal ? world.idx(cx, cy - 1) : world.idx(cx - 1, cy);
    const sideB = horizontal ? world.idx(cx, cy + 1) : world.idx(cx + 1, cy);
    if (world.cells[sideA] === Cell.WALL && world.cells[sideB] === Cell.WALL) return cur;
  }
  return -1;
}

function setLockedChordDoor(world: World, idx: number): number {
  world.cells[idx] = Cell.DOOR;
  world.wallTex[idx] = Tex.DOOR_METAL;
  world.doors.set(idx, {
    idx,
    state: DoorState.LOCKED,
    roomA: -1,
    roomB: -1,
    keyId: 'key',
    timer: 0,
  });
  return idx;
}

function registerHilbertDepotRouteCues(
  world: World,
  state: HilbertDepotState,
  points: readonly Point[],
  entry: Room,
  exit: Room,
): void {
  const firstCargoOrder = state.cargoOrders[0] ?? BAY_FIRST_INDEX;
  const firstCargo = points[firstCargoOrder];
  registerRouteCue(world, {
    id: 'hilbert_depot_safe_curve_order',
    x: entry.x + entry.w - 3.5,
    y: entry.y + 7.5,
    targetX: firstCargo.x + 0.5,
    targetY: firstCargo.y + 0.5,
    floor: HILBERT_DEPOT_BASE_FLOOR,
    roomId: entry.id,
    targetRoomId: world.roomMap[world.idx(firstCargo.x, firstCargo.y)],
    zoneId: world.zoneMap[world.idx(entry.x + entry.w - 3, entry.y + 7)],
    label: 'индексная кривая',
    hint: 'безопасный проход идет по росту номера Г, а не по ближайшей двери',
    targetName: 'первый индексный груз',
    color: '#b7f08a',
    tags: [CONTENT_TAG, 'hilbert_order', 'safe_curve', 'route_teach'],
    toneSeed: 76001,
    radius: 11,
    targetRadius: 5,
    cooldownSec: 38,
    heardText: 'Склад шепчет номером: Г-000, Г-008, Г-016. Ближайший ящик может быть поздним.',
    followedText: 'Первый индекс найден. Дальше безопаснее идти по росту Г-номера.',
    ignoredText: 'Вы ушли от индексной кривой: хорды короче глазами, но длиннее по складу.',
  });

  const chord = state.chords[0];
  if (chord) {
    const from = points[chord.fromIndex];
    const to = points[chord.toIndex];
    registerRouteCue(world, {
      id: 'hilbert_depot_locked_chord_cut',
      x: from.x + 0.5,
      y: from.y + 0.5,
      targetX: to.x + 0.5,
      targetY: to.y + 0.5,
      floor: HILBERT_DEPOT_BASE_FLOOR,
      zoneId: world.zoneMap[world.idx(from.x, from.y)],
      label: 'запертая хорда',
      hint: 'решетка режет десятки индексов, но открывает чужой учет и охрану',
      targetName: 'дальний номер без обхода',
      color: '#ffd35f',
      tags: [CONTENT_TAG, HILBERT_DEPOT_CHORD_TAG, 'shortcut', 'theft'],
      toneSeed: 76077,
      radius: 9,
      targetRadius: 5,
      cooldownSec: 44,
      heardText: 'За решеткой хорда: короткий металл к дальнему номеру, но замок числит это кражей маршрута.',
      followedText: 'Хорда срезала индексный путь. Склад стал быстрее и злее.',
      ignoredText: 'Запертая хорда осталась рядом. Без нее придется идти по честной кривой.',
    });
  }

  registerRouteCue(world, {
    id: 'hilbert_depot_exit_index_tail',
    x: points[points.length - 9].x + 0.5,
    y: points[points.length - 9].y + 0.5,
    targetX: exit.x + 2.5,
    targetY: exit.y + 7.5,
    floor: HILBERT_DEPOT_BASE_FLOOR,
    roomId: exit.id,
    targetRoomId: exit.id,
    zoneId: world.zoneMap[world.idx(exit.x + 2, exit.y + 7)],
    label: 'конец индекса',
    hint: 'последние Г-номера выводят к дальней приемке и нижнему лифту',
    targetName: 'дальний лифт склада',
    color: '#8cf',
    tags: [CONTENT_TAG, 'hilbert_order', 'exit', 'lift'],
    toneSeed: 76131,
    radius: 10,
    targetRadius: 4,
    cooldownSec: 40,
    heardText: 'Хвост индекса ведет к дальней приемке. Тут выход ниже, если не резать новую хорду.',
    followedText: 'Дальняя приемка найдена. Нижний лифт рядом с последними Г-номерами.',
    ignoredText: 'Конец индекса остался за спиной, а склад снова считает из начала.',
  });
}

function addDepotPressure(entities: Entity[], nextId: { v: number }, points: readonly Point[]): void {
  const spawns: Array<{ index: number; kind: MonsterKind; name: string }> = [
    { index: 54, kind: MonsterKind.ROBOT, name: 'Счетчик Г-054' },
    { index: 121, kind: MonsterKind.RZHAVNIK, name: 'Ржавый сторож Г-121' },
    { index: 149, kind: MonsterKind.TRUBNYY_AVTOMAT, name: 'Трубный автомат Г-149' },
    { index: 198, kind: MonsterKind.REBAR, name: 'Арматурный стеллаж Г-198' },
    { index: 233, kind: MonsterKind.SAFEGUARD, name: 'Сейфгард накладной Г-233' },
  ];
  for (const spawn of spawns) {
    const point = points[spawn.index];
    spawnMonster(entities, nextId, spawn.kind, point.x + 0.5, point.y + 0.5, spawn.name);
  }
}

function spawnMonster(
  entities: Entity[],
  nextId: { v: number },
  kind: MonsterKind,
  x: number,
  y: number,
  name: string,
): void {
  const def = MONSTERS[kind];
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: def.speed,
    sprite: def.sprite >= 0 ? def.sprite : monsterSpr(kind),
    name,
    monsterKind: kind,
    hp: Math.round(def.hp * 1.12),
    maxHp: Math.round(def.hp * 1.12),
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    faction: Faction.WILD,
  });
}

function addItemDrop(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  x: number,
  y: number,
  defId: string,
  count = 1,
  data?: unknown,
): void {
  if (!ITEMS[defId]) return;
  openCell(world, x, y, Tex.F_CONCRETE);
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
    inventory: [{ defId, count, data }],
  });
}

function cargoInventory(order: number): Item[] {
  const pools = order < 80
    ? ['wire_coil', 'fuse', 'relay_diagram', 'container_key_label']
    : order < 168
      ? ['gear', 'sealant_tube', 'wrench', 'track_diagram_scrap']
      : ['circuit_board', 'ammo_energy', 'rail_signal_lamp', 'rail_switch_handle'];
  const out: Item[] = [];
  for (let i = 0; i < pools.length; i++) {
    const defId = pools[(order + i * 3) % pools.length];
    if (ITEMS[defId]) out.push({ defId, count: i === 0 && order % 6 === 0 ? 2 : 1 });
  }
  return out.length > 0 ? out : [{ defId: 'container_key_label', count: 1 }];
}

function addContainer(
  world: World,
  room: Room,
  salt: number,
  kind: ContainerKind,
  name: string,
  inventory: readonly Item[],
  access: WorldContainer['access'],
  tags: readonly string[],
): WorldContainer {
  const pos = roomCell(room, salt);
  setFeature(world, pos.x, pos.y, kind === ContainerKind.SAFE ? Feature.DESK : Feature.SHELF);
  const container: WorldContainer = {
    id: nextContainerId(world),
    x: pos.x,
    y: pos.y,
    floor: HILBERT_DEPOT_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(pos.x, pos.y)],
    kind,
    name,
    inventory: inventory.map(item => ({ ...item })),
    capacitySlots: Math.max(8, inventory.length + 4),
    access,
    lockDifficulty: access === 'locked' ? 4 : undefined,
    discovered: true,
    faction: access === 'owner' || access === 'locked' ? Faction.LIQUIDATOR : undefined,
    ownerName: access === 'owner' ? 'Складская смена Гильберта' : undefined,
    tags: uniqueTags(tags),
  };
  world.addContainer(container);
  return container;
}

function addNamedRoom(
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
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      world.wallTex[ci] = wallTex;
      if (dx >= 0 && dx < w && dy >= 0 && dy < h) world.floorTex[ci] = floorTex;
    }
  }
  return room;
}

function tryAddDepotRoom(
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
  if (!canStampDepotRoom(world, x, y, w, h)) return null;
  const room = addNamedRoom(world, type, x, y, w, h, name, wallTex, floorTex);
  paintDepotRoomOwner(world, room, owner);
  return room;
}

function canStampDepotRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  if (x < 4 || y < 4 || x + w >= W - 4 || y + h >= W - 4) return false;
  for (const room of world.rooms) {
    if (!room) continue;
    if (x + w < room.x - 2 || room.x + room.w + 2 < x || y + h < room.y - 2 || room.y + room.h + 2 < y) continue;
    return false;
  }
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const idx = world.idx(x + dx, y + dy);
      if (world.aptMask[idx] || world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.DOOR || world.hermoWall[idx]) return false;
      if (world.containerMap.has(idx)) return false;
    }
  }
  return true;
}

function paintDepotRoomOwner(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[idx] === room.id) setTerritoryOwnerAtIndex(world, idx, owner);
    }
  }
  for (const idx of room.doors) setTerritoryOwnerAtIndex(world, idx, owner);
}

function hardenDepotHqRoom(world: World, room: Room, owner: TerritoryOwner): void {
  room.type = RoomType.HQ;
  room.sealed = true;
  room.wallTex = Tex.HERMO_WALL;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      const interior = dx >= 0 && dx < room.w && dy >= 0 && dy < room.h;
      if (interior) {
        if (world.roomMap[idx] === room.id) {
          world.floorTex[idx] = room.floorTex;
          setTerritoryOwnerAtIndex(world, idx, owner);
        }
        continue;
      }
      if (world.cells[idx] !== Cell.WALL || world.aptMask[idx]) continue;
      world.hermoWall[idx] = 1;
      world.wallTex[idx] = Tex.HERMO_WALL;
      setTerritoryOwnerAtIndex(world, idx, owner);
    }
  }
  for (const idx of room.doors) {
    const door = world.doors.get(idx);
    if (!door) continue;
    door.state = DoorState.HERMETIC_OPEN;
    world.wallTex[idx] = Tex.HERMO_WALL;
    world.hermoWall[idx] = 1;
    setTerritoryOwnerAtIndex(world, idx, owner);
  }
  if (!room.doors.some(idx => world.doors.get(idx)?.state === DoorState.HERMETIC_OPEN)) {
    ensureDepotHqDoor(world, room, owner);
  }
}

function ensureDepotHqDoor(world: World, room: Room, owner: TerritoryOwner): void {
  const passable = (idx: number): boolean => {
    const cell = world.cells[idx];
    return cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR;
  };
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const x = room.x + dx;
      const y = room.y + dy;
      const idx = world.idx(x, y);
      if (world.aptMask[idx] || world.cells[idx] === Cell.LIFT) continue;
      for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const inside = world.idx(x - ddx, y - ddy);
        const outside = world.idx(x + ddx, y + ddy);
        if (world.roomMap[inside] !== room.id || !passable(outside)) continue;
        world.cells[idx] = Cell.DOOR;
        world.wallTex[idx] = Tex.HERMO_WALL;
        world.hermoWall[idx] = 1;
        world.doors.set(idx, { idx, state: DoorState.HERMETIC_OPEN, roomA: room.id, roomB: -1, keyId: '', timer: 0 });
        if (!room.doors.includes(idx)) room.doors.push(idx);
        setTerritoryOwnerAtIndex(world, idx, owner);
        const jambA = world.idx(x + ddy, y + ddx);
        const jambB = world.idx(x - ddy, y - ddx);
        for (const jamb of [jambA, jambB]) {
          if (world.aptMask[jamb] || world.cells[jamb] === Cell.LIFT || world.cells[jamb] === Cell.DOOR || world.roomMap[jamb] >= 0) continue;
          world.cells[jamb] = Cell.WALL;
          world.wallTex[jamb] = Tex.HERMO_WALL;
          world.hermoWall[jamb] = 1;
          setTerritoryOwnerAtIndex(world, jamb, owner);
        }
        return;
      }
    }
  }
}

function decorateDepotRoom(world: World, room: Room, serial: number, owner: TerritoryOwner): void {
  switch (room.type) {
    case RoomType.KITCHEN:
      setFeature(world, room.x + 2, room.y + 2, Feature.STOVE);
      setFeature(world, room.x + room.w - 4, room.y + 2, Feature.SINK);
      setFeature(world, room.x + (room.w >> 1), room.y + room.h - 3, Feature.TABLE);
      break;
    case RoomType.BATHROOM:
      setFeature(world, room.x + 2, room.y + 2, Feature.TOILET);
      setFeature(world, room.x + room.w - 4, room.y + room.h - 3, Feature.SINK);
      break;
    case RoomType.MEDICAL:
      setFeature(world, room.x + 3, room.y + 2, Feature.BED);
      setFeature(world, room.x + room.w - 4, room.y + 2, Feature.APPARATUS);
      break;
    case RoomType.PRODUCTION:
      setFeature(world, room.x + 3, room.y + 2, Feature.MACHINE);
      setFeature(world, room.x + room.w - 4, room.y + room.h - 3, Feature.APPARATUS);
      break;
    case RoomType.OFFICE:
    case RoomType.HQ:
      setFeature(world, room.x + 2, room.y + 2, Feature.DESK);
      setFeature(world, room.x + 4, room.y + 2, Feature.SCREEN);
      setFeature(world, room.x + room.w - 4, room.y + room.h - 3, owner === ZoneFaction.CULTIST ? Feature.CANDLE : Feature.LAMP);
      break;
    case RoomType.SMOKING:
      setFeature(world, room.x + 2, room.y + 2, owner === ZoneFaction.CULTIST ? Feature.CANDLE : Feature.CHAIR);
      setFeature(world, room.x + room.w - 4, room.y + 2, Feature.TABLE);
      break;
    case RoomType.STORAGE:
    default:
      for (let x = room.x + 2; x < room.x + room.w - 2; x += 4) setFeature(world, x, room.y + 2, Feature.SHELF);
      setFeature(world, room.x + room.w - 4, room.y + room.h - 3, serial % 3 === 0 ? Feature.SCREEN : Feature.LAMP);
      break;
  }
}

function repairDepotDoorFrames(world: World): void {
  for (const [idx, door] of world.doors) {
    const room = world.rooms[door.roomA] ?? world.rooms[door.roomB];
    if (!room) continue;
    const x = idx % W;
    const y = (idx / W) | 0;
    const left = world.idx(x - 1, y);
    const right = world.idx(x + 1, y);
    const up = world.idx(x, y - 1);
    const down = world.idx(x, y + 1);
    const vertical = world.roomMap[up] >= 0 || world.roomMap[down] >= 0;
    const jambs = vertical ? [left, right] : [up, down];
    for (const jamb of jambs) {
      if (world.cells[jamb] !== Cell.WALL || world.aptMask[jamb]) continue;
      world.wallTex[jamb] = door.state === DoorState.HERMETIC_OPEN || door.state === DoorState.HERMETIC_CLOSED ? Tex.HERMO_WALL : room.wallTex;
    }
  }
}

function canStampRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.cells[ci] !== Cell.WALL || world.aptMask[ci]) return false;
    }
  }
  return true;
}

function connectRoomToPoint(world: World, room: Room, targetX: number, targetY: number, state: DoorState, keyId = ''): number {
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  const dx = targetX - cx;
  const dy = targetY - cy;
  let doorX = cx;
  let doorY = cy;
  let outX = cx;
  let outY = cy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    doorY = Math.max(room.y + 1, Math.min(room.y + room.h - 2, targetY));
    if (dx >= 0) {
      doorX = room.x + room.w;
      outX = doorX + 1;
    } else {
      doorX = room.x - 1;
      outX = doorX - 1;
    }
    outY = doorY;
  } else {
    doorX = Math.max(room.x + 1, Math.min(room.x + room.w - 2, targetX));
    if (dy >= 0) {
      doorY = room.y + room.h;
      outY = doorY + 1;
    } else {
      doorY = room.y - 1;
      outY = doorY - 1;
    }
    outX = doorX;
  }

  const doorId = addDoor(world, room, doorX, doorY, state, keyId);
  carveLine(world, outX, outY, targetX, targetY, 0, room.floorTex);
  return doorId;
}

function addDoor(world: World, room: Room, x: number, y: number, state: DoorState, keyId = ''): number {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.DOOR;
  world.wallTex[ci] = room.wallTex;
  world.doors.set(ci, { idx: ci, state, roomA: room.id, roomB: -1, keyId, timer: 0 });
  if (!room.doors.includes(ci)) room.doors.push(ci);
  return ci;
}

function placeLift(world: World, x: number, y: number, direction: LiftDirection): void {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.LIFT;
  world.wallTex[ci] = Tex.LIFT_DOOR;
  world.liftDir[ci] = direction;
  setFeature(world, x + (direction === LiftDirection.UP ? 1 : -1), y, Feature.LIFT_BUTTON);
  world.liftDir[world.idx(x + (direction === LiftDirection.UP ? 1 : -1), y)] = direction;
}

function carveLine(world: World, ax: number, ay: number, bx: number, by: number, radius: number, floorTex: Tex): void {
  let x = ax;
  let y = ay;
  const dx = Math.sign(bx - ax);
  const dy = Math.sign(by - ay);
  openBrush(world, x, y, radius, floorTex);
  while (x !== bx) {
    x += dx;
    openBrush(world, x, y, radius, floorTex);
  }
  while (y !== by) {
    y += dy;
    openBrush(world, x, y, radius, floorTex);
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
): void {
  let x = world.wrap(ax);
  let y = world.wrap(ay);
  const targetX = world.wrap(bx);
  const targetY = world.wrap(by);
  const dx = Math.sign(world.delta(targetX, x));
  const dy = Math.sign(world.delta(targetY, y));
  openOwnedBrush(world, x, y, width, floorTex, owner);
  while (x !== targetX) {
    x = world.wrap(x + dx);
    openOwnedBrush(world, x, y, width, floorTex, owner);
  }
  while (y !== targetY) {
    y = world.wrap(y + dy);
    openOwnedBrush(world, x, y, width, floorTex, owner);
  }
}

function openBrush(world: World, x: number, y: number, radius: number, floorTex: Tex): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      openCell(world, x + dx, y + dy, floorTex);
    }
  }
}

function openOwnedBrush(world: World, x: number, y: number, radius: number, floorTex: Tex, owner: TerritoryOwner): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > (radius + 0.4) * (radius + 0.4)) continue;
      openOwnedCell(world, x + dx, y + dy, floorTex, owner);
    }
  }
}

function openCell(world: World, x: number, y: number, floorTex: Tex): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT) return;
  world.cells[ci] = Cell.FLOOR;
  world.floorTex[ci] = floorTex;
  if (world.roomMap[ci] < 0) world.wallTex[ci] = Tex.METAL;
}

function openOwnedCell(world: World, x: number, y: number, floorTex: Tex, owner: TerritoryOwner): void {
  const idx = world.idx(x, y);
  if (world.aptMask[idx] || world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.DOOR || world.hermoWall[idx]) return;
  if (world.roomMap[idx] >= 0) return;
  world.cells[idx] = Cell.FLOOR;
  world.roomMap[idx] = -1;
  world.floorTex[idx] = floorTex;
  world.wallTex[idx] = Tex.METAL;
  setTerritoryOwnerAtIndex(world, idx, owner);
  if (world.features[idx] !== Feature.LIFT_BUTTON) world.features[idx] = Feature.NONE;
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.WALL || world.cells[ci] === Cell.LIFT) return;
  world.features[ci] = feature;
}

function roomCell(room: Room, salt: number): Point {
  const w = Math.max(1, room.w - 4);
  const h = Math.max(1, room.h - 4);
  return {
    x: room.x + 2 + ((salt * 5) % w),
    y: room.y + 2 + ((salt * 3) % h),
  };
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function refreshContainerZones(world: World): void {
  for (const container of world.containers) {
    container.zoneId = world.zoneMap[world.idx(container.x, container.y)];
  }
}

function uniqueTags(tags: readonly string[]): string[] {
  return tags.filter((tag, index, all) => all.indexOf(tag) === index);
}

function cargoLabel(order: number): string {
  return `Г-${order.toString().padStart(3, '0')}`;
}

function depotOwnerFloor(owner: TerritoryOwner, serial: number): Tex {
  if (owner === ZoneFaction.SCIENTIST) return Tex.F_TILE;
  if (owner === ZoneFaction.CITIZEN) return serial % 2 === 0 ? Tex.F_LINO : Tex.F_CONCRETE;
  if (owner === ZoneFaction.CULTIST) return Tex.F_CARPET;
  if (owner === ZoneFaction.WILD) return serial % 3 === 0 ? Tex.F_TILE : Tex.F_CONCRETE;
  return serial % 5 === 0 ? Tex.F_TILE : Tex.F_CONCRETE;
}

function depotOwnerWall(owner: TerritoryOwner): Tex {
  if (owner === ZoneFaction.SCIENTIST) return Tex.TILE_W;
  if (owner === ZoneFaction.CITIZEN) return Tex.PANEL;
  if (owner === ZoneFaction.CULTIST) return Tex.CROSS;
  if (owner === ZoneFaction.WILD) return Tex.ROTTEN;
  return Tex.METAL;
}

function isHilbertDepotAmbientNpc(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    entity.alive &&
    entity.name?.startsWith('Склад Гильберта:') === true &&
    entity.plotNpcId === undefined &&
    entity.persistentNpcId === undefined &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    entity.faction !== undefined;
}

function depotTerritorySpawnCells(world: World): Map<TerritoryOwner, number[]> {
  const cells = new Map<TerritoryOwner, number[]>();
  for (const owner of HUMAN_TERRITORY_OWNERS) cells.set(owner, []);
  for (let i = 0; i < W * W; i++) {
    const cell = world.cells[i];
    if (cell !== Cell.FLOOR && cell !== Cell.WATER) continue;
    if (world.aptMask[i] || world.hermoWall[i] || world.containerMap.has(i) || world.features[i] === Feature.LIFT_BUTTON) continue;
    const owner = territoryOwnerAtIndex(world, i);
    const list = cells.get(owner);
    if (list) list.push(i);
  }
  return cells;
}

function hilbertTracePoints(order: number, x: number, y: number, step: number): Point[] {
  const n = 1 << order;
  const points: Point[] = [];
  for (let d = 0; d < n * n; d++) {
    const p = hilbertIndexToPoint(n, d);
    points.push({ x: x + p.x * step, y: y + p.y * step });
  }
  return points;
}

function hilbertIndexToPoint(n: number, d: number): Point {
  let rx = 0;
  let ry = 0;
  let t = d;
  let x = 0;
  let y = 0;
  for (let s = 1; s < n; s <<= 1) {
    rx = 1 & (t >> 1);
    ry = 1 & (t ^ rx);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      const swap = x;
      x = y;
      y = swap;
    }
    x += s * rx;
    y += s * ry;
    t >>= 2;
  }
  return { x, y };
}
