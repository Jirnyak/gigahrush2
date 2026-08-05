/* -- Ministry macro geometry -------------------------------------
 * Axes, rings, queues and private cuts that sit under the procedural
 * office maze. The base generator adds smaller rooms around this graph.
 */

import {
  W,
  Cell,
  Tex,
  RoomType,
  Feature,
  DoorState,
  ZoneFaction,
  type Room,
  type TerritoryOwner,
} from '../../core/types';
import { World } from '../../core/world';

export interface MinistryMacroGeometry {
  nextRoomId: number;
  rooms: Room[];
  carpetCells: number[];
}

type RouteKind = 'public' | 'queue' | 'service' | 'authority';
type MinistryGraphRole = 'backbone' | 'office_bsp' | 'queue_hall' | 'archive_stack' | 'staff_chord' | 'landmark';
type LandmarkDecor = 'portrait_hall' | 'seal_cabinet' | 'clerk_cage' | 'copy_room' | 'complaint_pit';
type DoorSide = 'n' | 's' | 'e' | 'w';

const CENTER = Math.floor(W / 2);

interface ArchiveSubgraphSpec {
  role: Extract<MinistryGraphRole, 'archive_stack'>;
  x: number;
  y: number;
  cols: number;
  rows: number;
  cell: number;
  entryX: number;
  entryY: number;
}

interface LandmarkSpec {
  role: Extract<MinistryGraphRole, 'landmark'>;
  name: string;
  type: RoomType;
  x: number;
  y: number;
  w: number;
  h: number;
  floorTex: Tex;
  depth: number;
  centrality: number;
  decor: LandmarkDecor;
  leaf?: {
    doorSide: 'n' | 's' | 'e' | 'w';
    state: DoorState;
    keyId: string;
    connectX: number;
    connectY: number;
  };
}

interface ClosedRoomSpec {
  name: string;
  type: RoomType;
  x: number;
  y: number;
  w: number;
  h: number;
  floorTex: Tex;
  doorSide: DoorSide;
  state?: DoorState;
  keyId?: string;
  hermetic?: boolean;
  owner?: TerritoryOwner;
}

interface FactionHqCompoundSpec {
  owner: TerritoryOwner;
  label: string;
  x: number;
  y: number;
  linkX: number;
  linkY: number;
}

const ARCHIVE_SUBGRAPHS: readonly ArchiveSubgraphSpec[] = [
  { role: 'archive_stack', x: 124, y: 256, cols: 8, rows: 10, cell: 22, entryX: 232, entryY: 384 },
  { role: 'archive_stack', x: 724, y: 256, cols: 8, rows: 10, cell: 22, entryX: W - 232, entryY: 384 },
  { role: 'archive_stack', x: 232, y: 700, cols: 10, rows: 6, cell: 22, entryX: 384, entryY: 640 },
  { role: 'archive_stack', x: 572, y: 700, cols: 10, rows: 6, cell: 22, entryX: 640, entryY: 640 },
];

const LANDMARK_SPECS: readonly LandmarkSpec[] = [
  {
    role: 'landmark',
    name: 'Портретный зал центральных подписей',
    type: RoomType.CORRIDOR,
    x: CENTER - 76,
    y: CENTER - 252,
    w: 153,
    h: 29,
    floorTex: Tex.F_PARQUET,
    depth: 1,
    centrality: 98,
    decor: 'portrait_hall',
  },
  {
    role: 'landmark',
    name: 'Шкаф гербовых печатей',
    type: RoomType.STORAGE,
    x: CENTER + 42,
    y: CENTER - 182,
    w: 18,
    h: 13,
    floorTex: Tex.F_PARQUET,
    depth: 3,
    centrality: 70,
    decor: 'seal_cabinet',
    leaf: { doorSide: 's', state: DoorState.LOCKED, keyId: 'key', connectX: CENTER + 51, connectY: CENTER - 128 },
  },
  {
    role: 'landmark',
    name: 'Клетка клерков временной выдачи',
    type: RoomType.OFFICE,
    x: CENTER - 78,
    y: CENTER - 46,
    w: 22,
    h: 15,
    floorTex: Tex.F_GREEN_CARPET,
    depth: 2,
    centrality: 86,
    decor: 'clerk_cage',
    leaf: { doorSide: 'w', state: DoorState.CLOSED, keyId: '', connectX: CENTER - 96, connectY: CENTER - 44 },
  },
  {
    role: 'landmark',
    name: 'Копировальная комната мокрых справок',
    type: RoomType.PRODUCTION,
    x: CENTER - 76,
    y: CENTER + 92,
    w: 20,
    h: 14,
    floorTex: Tex.F_MARBLE_TILE,
    depth: 3,
    centrality: 74,
    decor: 'copy_room',
    leaf: { doorSide: 'e', state: DoorState.CLOSED, keyId: '', connectX: CENTER - 24, connectY: CENTER + 99 },
  },
  {
    role: 'landmark',
    name: 'Жалобная яма с обратной нумерацией',
    type: RoomType.COMMON,
    x: CENTER - 58,
    y: CENTER + 52,
    w: 117,
    h: 34,
    floorTex: Tex.F_GREEN_CARPET,
    depth: 2,
    centrality: 91,
    decor: 'complaint_pit',
  },
];

const FACTION_HQ_COMPOUNDS: readonly FactionHqCompoundSpec[] = [
  { owner: ZoneFaction.CITIZEN, label: 'гражданских окон', x: CENTER - 24, y: 64, linkX: CENTER, linkY: 112 },
  { owner: ZoneFaction.LIQUIDATOR, label: 'ликвидаторского наряда', x: 72, y: 148, linkX: 184, linkY: 184 },
  { owner: ZoneFaction.SCIENTIST, label: 'НИИ-сверки', x: W - 116, y: 148, linkX: W - 184, linkY: 184 },
  { owner: ZoneFaction.WILD, label: 'дикой очереди', x: 72, y: W - 224, linkX: 184, linkY: W - 184 },
  { owner: ZoneFaction.CULTIST, label: 'культовой подачи', x: W - 116, y: W - 224, linkX: W - 184, linkY: W - 184 },
];

function routeFloor(kind: RouteKind): Tex {
  switch (kind) {
    case 'public': return Tex.F_RED_CARPET;
    case 'queue': return Tex.F_GREEN_CARPET;
    case 'authority': return Tex.F_PARQUET;
    case 'service':
    default: return Tex.F_MARBLE_TILE;
  }
}

function carveRouteCell(
  world: World,
  x: number,
  y: number,
  floorTex: Tex,
  carpetCells: number[],
): void {
  const ci = world.idx(x, y);
  if (world.aptMask[ci]) return;
  world.cells[ci] = Cell.FLOOR;
  world.roomMap[ci] = -1;
  world.wallTex[ci] = Tex.MARBLE;
  world.floorTex[ci] = floorTex;
  if (floorTex === Tex.F_RED_CARPET) carpetCells.push(ci);
}

function carveLine(
  world: World,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  halfW: number,
  kind: RouteKind,
  carpetCells: number[],
): void {
  const floorTex = routeFloor(kind);
  if (y0 === y1) {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    for (let x = minX; x <= maxX; x++) {
      for (let t = -halfW; t <= halfW; t++) {
        const tex = kind === 'public' && Math.abs(t) > 2 ? Tex.F_MARBLE_TILE : floorTex;
        carveRouteCell(world, x, y0 + t, tex, carpetCells);
      }
    }
    return;
  }

  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  for (let y = minY; y <= maxY; y++) {
    for (let t = -halfW; t <= halfW; t++) {
      const tex = kind === 'public' && Math.abs(t) > 2 ? Tex.F_MARBLE_TILE : floorTex;
      carveRouteCell(world, x0 + t, y, tex, carpetCells);
    }
  }
}

function carveRectLoop(
  world: World,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  halfW: number,
  kind: RouteKind,
  carpetCells: number[],
): void {
  carveLine(world, x0, y0, x1, y0, halfW, kind, carpetCells);
  carveLine(world, x1, y0, x1, y1, halfW, kind, carpetCells);
  carveLine(world, x1, y1, x0, y1, halfW, kind, carpetCells);
  carveLine(world, x0, y1, x0, y0, halfW, kind, carpetCells);
}

function addCarpetCellsForRoom(world: World, room: Room, carpetCells: number[]): void {
  if (room.floorTex !== Tex.F_RED_CARPET) return;
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.cells[ci] === Cell.FLOOR) carpetCells.push(ci);
    }
  }
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR && world.features[ci] === Feature.NONE) {
    world.features[ci] = feature;
  }
}

function roomDoorGeometry(x: number, y: number, w: number, h: number, side: DoorSide): { doorX: number; doorY: number; outX: number; outY: number } {
  let doorX = x + Math.floor(w / 2);
  let doorY = y - 1;
  let outX = doorX;
  let outY = doorY - 1;
  if (side === 's') {
    doorY = y + h;
    outY = doorY + 1;
  } else if (side === 'w') {
    doorX = x - 1;
    doorY = y + Math.floor(h / 2);
    outX = doorX - 1;
    outY = doorY;
  } else if (side === 'e') {
    doorX = x + w;
    doorY = y + Math.floor(h / 2);
    outX = doorX + 1;
    outY = doorY;
  }
  return { doorX, doorY, outX, outY };
}

function addRouteDoor(
  world: World,
  x: number,
  y: number,
  state: DoorState,
  keyId: string,
): void {
  const ci = world.idx(x, y);
  if (world.aptMask[ci]) return;
  world.cells[ci] = Cell.DOOR;
  world.roomMap[ci] = -1;
  world.wallTex[ci] = state === DoorState.LOCKED ? Tex.DOOR_METAL : Tex.DOOR_WOOD;
  world.doors.set(ci, {
    idx: ci,
    state,
    roomA: -1,
    roomB: -1,
    keyId,
    timer: 0,
  });
}

function decorateClosedRoom(world: World, room: Room): void {
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  switch (room.type) {
    case RoomType.HQ:
      setFeature(world, cx, cy, Feature.TABLE);
      setFeature(world, cx, room.y + 1, Feature.LAMP);
      setFeature(world, room.x + 2, room.y + 2, Feature.SHELF);
      setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.SHELF);
      break;
    case RoomType.KITCHEN:
      setFeature(world, room.x + 2, cy, Feature.STOVE);
      setFeature(world, room.x + room.w - 3, cy, Feature.SINK);
      setFeature(world, cx, room.y + 2, Feature.TABLE);
      break;
    case RoomType.BATHROOM:
      setFeature(world, room.x + 2, cy, Feature.TOILET);
      setFeature(world, room.x + room.w - 3, cy, Feature.SINK);
      break;
    case RoomType.MEDICAL:
      setFeature(world, room.x + 2, cy, Feature.APPARATUS);
      setFeature(world, room.x + room.w - 3, cy, Feature.SINK);
      break;
    case RoomType.OFFICE:
      setFeature(world, cx, cy, Feature.DESK);
      setFeature(world, cx, cy + 1, Feature.CHAIR);
      break;
    case RoomType.STORAGE:
      for (let x = room.x + 2; x < room.x + room.w - 1; x += 3) {
        setFeature(world, x, room.y + 2, Feature.SHELF);
        setFeature(world, x, room.y + room.h - 3, Feature.SHELF);
      }
      break;
    case RoomType.COMMON:
      setFeature(world, cx, cy, Feature.TABLE);
      setFeature(world, cx - 1, cy, Feature.CHAIR);
      setFeature(world, cx + 1, cy, Feature.CHAIR);
      break;
  }
}

function makeClosedRoomWithDoor(
  world: World,
  id: number,
  spec: ClosedRoomSpec,
  carpetCells: number[],
): Room {
  const wallTex = spec.hermetic ? Tex.HERMO_WALL : Tex.MARBLE;
  const room: Room = {
    id,
    type: spec.type,
    x: spec.x,
    y: spec.y,
    w: spec.w,
    h: spec.h,
    doors: [],
    sealed: spec.hermetic === true,
    name: spec.name,
    apartmentId: -1,
    wallTex,
    floorTex: spec.floorTex,
  };

  for (let dy = -1; dy <= spec.h; dy++) {
    for (let dx = -1; dx <= spec.w; dx++) {
      const ci = world.idx(spec.x + dx, spec.y + dy);
      if (world.aptMask[ci]) continue;
      world.roomMap[ci] = -1;
      if (dx >= 0 && dx < spec.w && dy >= 0 && dy < spec.h) {
        world.cells[ci] = Cell.FLOOR;
        world.roomMap[ci] = id;
        world.wallTex[ci] = wallTex;
        world.floorTex[ci] = spec.floorTex;
        if (spec.owner !== undefined) world.factionControl[ci] = spec.owner;
        if (spec.floorTex === Tex.F_RED_CARPET) carpetCells.push(ci);
        continue;
      }
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = wallTex;
      world.hermoWall[ci] = spec.hermetic ? 1 : 0;
      if (spec.owner !== undefined) world.factionControl[ci] = spec.owner;
    }
  }

  const door = roomDoorGeometry(spec.x, spec.y, spec.w, spec.h, spec.doorSide);
  const doorIdx = world.idx(door.doorX, door.doorY);
  world.cells[doorIdx] = Cell.DOOR;
  world.roomMap[doorIdx] = -1;
  world.wallTex[doorIdx] = spec.hermetic || spec.state === DoorState.LOCKED ? Tex.DOOR_METAL : Tex.DOOR_WOOD;
  world.hermoWall[doorIdx] = 0;
  if (spec.owner !== undefined) world.factionControl[doorIdx] = spec.owner;
  world.doors.set(doorIdx, {
    idx: doorIdx,
    state: spec.state ?? DoorState.CLOSED,
    roomA: id,
    roomB: -1,
    keyId: spec.keyId ?? '',
    timer: 0,
  });
  room.doors.push(doorIdx);

  world.rooms[id] = room;
  decorateClosedRoom(world, room);
  return room;
}

function makeOpenLandmark(
  world: World,
  id: number,
  name: string,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  floorTex: Tex,
): Room {
  const room: Room = {
    id,
    type,
    x,
    y,
    w,
    h,
    doors: [],
    sealed: false,
    name,
    apartmentId: -1,
    wallTex: Tex.MARBLE,
    floorTex,
  };
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.aptMask[ci]) continue;
      world.cells[ci] = Cell.FLOOR;
      world.roomMap[ci] = id;
      world.wallTex[ci] = Tex.MARBLE;
      world.floorTex[ci] = floorTex;
    }
  }
  world.rooms[id] = room;
  return room;
}

function makeClosedLandmarkLeaf(
  world: World,
  id: number,
  spec: LandmarkSpec,
  carpetCells: number[],
): Room {
  const room: Room = {
    id,
    type: spec.type,
    x: spec.x,
    y: spec.y,
    w: spec.w,
    h: spec.h,
    doors: [],
    sealed: false,
    name: spec.name,
    apartmentId: -1,
    wallTex: Tex.MARBLE,
    floorTex: spec.floorTex,
  };

  for (let dy = -1; dy <= spec.h; dy++) {
    for (let dx = -1; dx <= spec.w; dx++) {
      const ci = world.idx(spec.x + dx, spec.y + dy);
      if (world.aptMask[ci]) continue;
      world.roomMap[ci] = -1;
      if (dx >= 0 && dx < spec.w && dy >= 0 && dy < spec.h) {
        world.cells[ci] = Cell.FLOOR;
        world.roomMap[ci] = id;
        world.wallTex[ci] = Tex.MARBLE;
        world.floorTex[ci] = spec.floorTex;
        if (spec.floorTex === Tex.F_RED_CARPET) carpetCells.push(ci);
        continue;
      }
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.MARBLE;
    }
  }

  const leaf = spec.leaf;
  if (leaf) {
    let doorX = spec.x + Math.floor(spec.w / 2);
    let doorY = spec.y - 1;
    let outX = doorX;
    let outY = doorY - 1;
    if (leaf.doorSide === 's') {
      doorY = spec.y + spec.h;
      outY = doorY + 1;
    } else if (leaf.doorSide === 'w') {
      doorX = spec.x - 1;
      doorY = spec.y + Math.floor(spec.h / 2);
      outX = doorX - 1;
      outY = doorY;
    } else if (leaf.doorSide === 'e') {
      doorX = spec.x + spec.w;
      doorY = spec.y + Math.floor(spec.h / 2);
      outX = doorX + 1;
      outY = doorY;
    }

    const doorIdx = world.idx(doorX, doorY);
    world.cells[doorIdx] = Cell.DOOR;
    world.roomMap[doorIdx] = -1;
    world.wallTex[doorIdx] = leaf.state === DoorState.LOCKED ? Tex.DOOR_METAL : Tex.DOOR_WOOD;
    world.doors.set(doorIdx, {
      idx: doorIdx,
      state: leaf.state,
      roomA: id,
      roomB: -1,
      keyId: leaf.keyId,
      timer: 0,
    });
    room.doors.push(doorIdx);
    carveLine(world, outX, outY, leaf.connectX, leaf.connectY, 1, 'service', carpetCells);
  }

  world.rooms[id] = room;
  return room;
}

function addCourtyardColumns(world: World, room: Room): void {
  for (let dy = 5; dy < room.h - 4; dy += 7) {
    for (let dx = 6; dx < room.w - 5; dx += 8) {
      const ci = world.idx(room.x + dx, room.y + dy);
      world.cells[ci] = Cell.WALL;
      world.roomMap[ci] = -1;
      world.wallTex[ci] = Tex.MARBLE;
    }
  }
  for (let dx = 3; dx < room.w - 2; dx += 8) {
    setFeature(world, room.x + dx, room.y + 2, Feature.LAMP);
    setFeature(world, room.x + dx, room.y + room.h - 3, Feature.LAMP);
  }
}

function addArchiveShelves(world: World, x0: number, y0: number, x1: number, y1: number): void {
  for (let x = x0; x <= x1; x += 8) {
    setFeature(world, x, y0 - 2, Feature.SHELF);
    setFeature(world, x, y1 + 2, Feature.SHELF);
  }
  for (let y = y0; y <= y1; y += 8) {
    setFeature(world, x0 - 2, y, Feature.SHELF);
    setFeature(world, x1 + 2, y, Feature.SHELF);
  }
}

function addArchiveNodeMarks(world: World, x: number, y: number): void {
  for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
    setFeature(world, x + dx, y + dy, Feature.SHELF);
  }
}

function carveArchiveSubgraph(world: World, spec: ArchiveSubgraphSpec, carpetCells: number[]): void {
  const total = spec.cols * spec.rows;
  const visited = new Uint8Array(total);
  const frontiers: { ax: number; ay: number; bx: number; by: number }[] = [];
  const idx = (gx: number, gy: number): number => gy * spec.cols + gx;
  const cx = (gx: number): number => spec.x + gx * spec.cell + Math.floor(spec.cell / 2);
  const cy = (gy: number): number => spec.y + gy * spec.cell + Math.floor(spec.cell / 2);

  function pushFrontiers(gx: number, gy: number): void {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = gx + dx;
      const ny = gy + dy;
      if (nx < 0 || ny < 0 || nx >= spec.cols || ny >= spec.rows) continue;
      if (visited[idx(nx, ny)]) continue;
      frontiers.push({ ax: gx, ay: gy, bx: nx, by: ny });
    }
  }

  const startX = Math.floor(spec.cols / 2);
  const startY = Math.floor(spec.rows / 2);
  visited[idx(startX, startY)] = 1;
  let visitedCount = 1;
  pushFrontiers(startX, startY);
  addArchiveNodeMarks(world, cx(startX), cy(startY));

  while (frontiers.length > 0 && visitedCount < total) {
    const pickIdx = Math.floor(Math.random() * frontiers.length);
    const edge = frontiers[pickIdx];
    frontiers[pickIdx] = frontiers[frontiers.length - 1];
    frontiers.pop();
    if (visited[idx(edge.bx, edge.by)]) continue;
    carveLine(world, cx(edge.ax), cy(edge.ay), cx(edge.bx), cy(edge.by), 1, 'service', carpetCells);
    addArchiveNodeMarks(world, cx(edge.bx), cy(edge.by));
    visited[idx(edge.bx, edge.by)] = 1;
    visitedCount++;
    pushFrontiers(edge.bx, edge.by);
  }

  const extraChords = Math.max(2, Math.floor(total * 0.14));
  for (let i = 0; i < extraChords; i++) {
    const gx = Math.floor(Math.random() * spec.cols);
    const gy = Math.floor(Math.random() * spec.rows);
    const horizontal = Math.random() < 0.5;
    const nx = gx + (horizontal ? 1 : 0);
    const ny = gy + (horizontal ? 0 : 1);
    if (nx >= spec.cols || ny >= spec.rows) continue;
    carveLine(world, cx(gx), cy(gy), cx(nx), cy(ny), 1, 'service', carpetCells);
  }

  carveLine(world, spec.entryX, spec.entryY, cx(startX), cy(startY), 1, 'service', carpetCells);
}

function carveOfficeBsp(
  world: World,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  depth: number,
  carpetCells: number[],
): void {
  if (depth >= 3 || x1 - x0 < 96 || y1 - y0 < 96) return;
  const vertical = (x1 - x0) >= (y1 - y0);
  const offset = depth === 0 ? 0 : (depth % 2 === 0 ? -14 : 14);
  if (vertical) {
    const x = Math.floor((x0 + x1) / 2) + offset;
    carveLine(world, x, y0, x, y1, 1, 'service', carpetCells);
    for (let y = y0 + 18; y <= y1 - 18; y += 42) {
      setFeature(world, x - 1, y, Feature.DESK);
      setFeature(world, x + 1, y + 2, Feature.CHAIR);
    }
    carveOfficeBsp(world, x0, y0, x - 18, y1, depth + 1, carpetCells);
    carveOfficeBsp(world, x + 18, y0, x1, y1, depth + 1, carpetCells);
    return;
  }

  const y = Math.floor((y0 + y1) / 2) + offset;
  carveLine(world, x0, y, x1, y, 1, 'service', carpetCells);
  for (let x = x0 + 18; x <= x1 - 18; x += 42) {
    setFeature(world, x, y - 1, Feature.DESK);
    setFeature(world, x + 2, y + 1, Feature.CHAIR);
  }
  carveOfficeBsp(world, x0, y0, x1, y - 18, depth + 1, carpetCells);
  carveOfficeBsp(world, x0, y + 18, x1, y1, depth + 1, carpetCells);
}

function carveQueueSerpent(
  world: World,
  x: number,
  y: number,
  w: number,
  lanes: number,
  carpetCells: number[],
): void {
  const gap = 8;
  for (let lane = 0; lane < lanes; lane++) {
    const ly = y + lane * gap;
    carveLine(world, x, ly, x + w, ly, 1, 'queue', carpetCells);
    if (lane < lanes - 1) {
      const cx = lane % 2 === 0 ? x + w : x;
      carveLine(world, cx, ly, cx, ly + gap, 1, 'queue', carpetCells);
    }
  }
  for (let lane = 0; lane < lanes; lane++) {
    const ly = y + lane * gap;
    const counterX = lane % 2 === 0 ? x + w - 8 : x + 8;
    for (let i = 0; i < 5; i++) {
      setFeature(world, counterX + i, ly - 2, Feature.DESK);
      setFeature(world, counterX + i, ly + 2, Feature.CHAIR);
    }
  }
}

function decorateLandmark(world: World, room: Room, decor: LandmarkDecor): void {
  switch (decor) {
    case 'portrait_hall':
      for (let x = room.x + 4; x < room.x + room.w - 3; x += 9) {
        setFeature(world, x, room.y + 2, Feature.LAMP);
        setFeature(world, x, room.y + room.h - 3, Feature.LAMP);
        const north = world.idx(x, room.y - 1);
        const south = world.idx(x, room.y + room.h);
        if (world.cells[north] === Cell.WALL) world.wallTex[north] = Tex.PORTRAIT_BASE + ((x + room.y) % 64);
        if (world.cells[south] === Cell.WALL) world.wallTex[south] = Tex.PORTRAIT_BASE + ((x + room.y + 17) % 64);
      }
      for (let x = room.x + 12; x < room.x + room.w - 12; x += 24) {
        setFeature(world, x, room.y + Math.floor(room.h / 2), Feature.TABLE);
      }
      break;
    case 'seal_cabinet':
      for (let x = room.x + 2; x < room.x + room.w - 1; x += 3) {
        setFeature(world, x, room.y + 2, Feature.SHELF);
        setFeature(world, x, room.y + room.h - 3, Feature.SHELF);
      }
      setFeature(world, room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2), Feature.APPARATUS);
      setFeature(world, room.x + room.w - 3, room.y + Math.floor(room.h / 2), Feature.DESK);
      break;
    case 'clerk_cage':
      for (let y = room.y + 2; y < room.y + room.h - 1; y += 4) {
        for (let x = room.x + 3; x < room.x + room.w - 2; x += 5) {
          setFeature(world, x, y, Feature.DESK);
          setFeature(world, x, y + 1, Feature.CHAIR);
        }
      }
      break;
    case 'copy_room':
      for (let x = room.x + 3; x < room.x + room.w - 2; x += 5) {
        setFeature(world, x, room.y + 3, Feature.MACHINE);
        setFeature(world, x, room.y + room.h - 3, Feature.SHELF);
      }
      setFeature(world, room.x + room.w - 3, room.y + Math.floor(room.h / 2), Feature.DESK);
      break;
    case 'complaint_pit':
      for (let x = room.x + 8; x < room.x + room.w - 8; x += 12) {
        setFeature(world, x, room.y + 5, Feature.CHAIR);
        setFeature(world, x, room.y + room.h - 6, Feature.CHAIR);
      }
      for (let y = room.y + 9; y < room.y + room.h - 8; y += 7) {
        setFeature(world, room.x + 6, y, Feature.DESK);
        setFeature(world, room.x + room.w - 7, y, Feature.DESK);
      }
      break;
  }
}

function addLandmarks(
  world: World,
  nextRoomId: number,
  rooms: Room[],
  carpetCells: number[],
): number {
  const ordered = [...LANDMARK_SPECS].sort((a, b) => b.centrality - a.centrality || a.depth - b.depth);
  for (const spec of ordered) {
    const room = spec.leaf
      ? makeClosedLandmarkLeaf(world, nextRoomId++, spec, carpetCells)
      : makeOpenLandmark(world, nextRoomId++, spec.name, spec.type, spec.x, spec.y, spec.w, spec.h, spec.floorTex);
    decorateLandmark(world, room, spec.decor);
    addCarpetCellsForRoom(world, room, carpetCells);
    rooms.push(room);
  }
  return nextRoomId;
}

function carveServiceLink(world: World, x0: number, y0: number, x1: number, y1: number, carpetCells: number[]): void {
  const midX = x1;
  carveLine(world, x0, y0, midX, y0, 1, 'service', carpetCells);
  carveLine(world, midX, y0, x1, y1, 1, 'service', carpetCells);
}

function addAxisBooths(world: World, nextRoomId: number, rooms: Room[], carpetCells: number[]): number {
  const boothFloor = Tex.F_PARQUET;
  for (let x = 64; x <= W - 64; x += 64) {
    if (Math.abs(x - CENTER) < 176) continue;
    rooms.push(makeClosedRoomWithDoor(world, nextRoomId++, {
      name: `Окно центрального креста север ${x}`,
      type: RoomType.OFFICE,
      x: x - 4,
      y: CENTER - 12,
      w: 8,
      h: 5,
      floorTex: boothFloor,
      doorSide: 's',
    }, carpetCells));
    rooms.push(makeClosedRoomWithDoor(world, nextRoomId++, {
      name: `Окно центрального креста юг ${x}`,
      type: RoomType.OFFICE,
      x: x - 4,
      y: CENTER + 8,
      w: 8,
      h: 5,
      floorTex: boothFloor,
      doorSide: 'n',
    }, carpetCells));
  }

  for (let y = 192; y <= W - 192; y += 64) {
    if (Math.abs(y - CENTER) < 176) continue;
    rooms.push(makeClosedRoomWithDoor(world, nextRoomId++, {
      name: `Окно центрального креста запад ${y}`,
      type: RoomType.OFFICE,
      x: CENTER - 12,
      y: y - 4,
      w: 5,
      h: 8,
      floorTex: boothFloor,
      doorSide: 'e',
    }, carpetCells));
    rooms.push(makeClosedRoomWithDoor(world, nextRoomId++, {
      name: `Окно центрального креста восток ${y}`,
      type: RoomType.OFFICE,
      x: CENTER + 8,
      y: y - 4,
      w: 5,
      h: 8,
      floorTex: boothFloor,
      doorSide: 'w',
    }, carpetCells));
  }
  return nextRoomId;
}

function addFactionHqCompound(world: World, nextRoomId: number, spec: FactionHqCompoundSpec, rooms: Room[], carpetCells: number[]): number {
  const corridorX = spec.x + 24;
  const corridorY0 = spec.y + 4;
  const corridorY1 = spec.y + 32;

  carveLine(world, corridorX, corridorY0, corridorX, corridorY1, 1, 'service', carpetCells);
  carveServiceLink(world, corridorX, corridorY0 + 14, spec.linkX, spec.linkY, carpetCells);

  const support: ClosedRoomSpec[] = [
    {
      name: `Штаб ${spec.label}`,
      type: RoomType.HQ,
      x: spec.x,
      y: spec.y,
      w: 18,
      h: 10,
      floorTex: Tex.F_MARBLE_TILE,
      doorSide: 'e',
      state: DoorState.HERMETIC_OPEN,
      hermetic: true,
      owner: spec.owner,
    },
    {
      name: `Канцелярия ${spec.label}`,
      type: RoomType.OFFICE,
      x: spec.x + 29,
      y: spec.y,
      w: 16,
      h: 8,
      floorTex: Tex.F_PARQUET,
      doorSide: 'w',
      owner: spec.owner,
    },
    {
      name: `Общая кухня ${spec.label}`,
      type: RoomType.KITCHEN,
      x: spec.x,
      y: spec.y + 14,
      w: 18,
      h: 8,
      floorTex: Tex.F_MARBLE_TILE,
      doorSide: 'e',
      owner: spec.owner,
    },
    {
      name: `Склад ${spec.label}`,
      type: RoomType.STORAGE,
      x: spec.x + 29,
      y: spec.y + 12,
      w: 16,
      h: 8,
      floorTex: Tex.F_MARBLE_TILE,
      doorSide: 'w',
      owner: spec.owner,
    },
    {
      name: `Медокно ${spec.label}`,
      type: RoomType.MEDICAL,
      x: spec.x,
      y: spec.y + 26,
      w: 18,
      h: 8,
      floorTex: Tex.F_MARBLE_TILE,
      doorSide: 'e',
      owner: spec.owner,
    },
    {
      name: `Санузел ${spec.label}`,
      type: RoomType.BATHROOM,
      x: spec.x + 29,
      y: spec.y + 24,
      w: 11,
      h: 7,
      floorTex: Tex.F_MARBLE_TILE,
      doorSide: 'w',
      owner: spec.owner,
    },
  ];

  for (const roomSpec of support) {
    const room = makeClosedRoomWithDoor(world, nextRoomId++, roomSpec, carpetCells);
    rooms.push(room);
    const door = roomDoorGeometry(roomSpec.x, roomSpec.y, roomSpec.w, roomSpec.h, roomSpec.doorSide);
    carveLine(world, door.outX, door.outY, corridorX, door.outY, 0, 'service', carpetCells);
    carveLine(world, corridorX, door.outY, corridorX, corridorY0 + 14, 0, 'service', carpetCells);
  }

  return nextRoomId;
}

function addFactionHqCompounds(world: World, nextRoomId: number, rooms: Room[], carpetCells: number[]): number {
  for (const spec of FACTION_HQ_COMPOUNDS) {
    nextRoomId = addFactionHqCompound(world, nextRoomId, spec, rooms, carpetCells);
  }
  return nextRoomId;
}

function makeShelterRoom(world: World, id: number, x: number, y: number, w: number, h: number): Room {
  const room: Room = {
    id,
    type: RoomType.COMMON,
    x,
    y,
    w,
    h,
    doors: [],
    sealed: false,
    name: 'Дежурное укрытие комиссара',
    apartmentId: -1,
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_MARBLE_TILE,
  };

  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.aptMask[ci]) continue;
      world.roomMap[ci] = -1;
      if (dx >= 0 && dx < w && dy >= 0 && dy < h) {
        world.cells[ci] = Cell.FLOOR;
        world.roomMap[ci] = id;
        world.floorTex[ci] = Tex.F_MARBLE_TILE;
        continue;
      }
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.HERMO_WALL;
      world.hermoWall[ci] = 1;
    }
  }

  const doorX = x + Math.floor(w / 2);
  const doorY = y + h;
  const doorIdx = world.idx(doorX, doorY);
  world.cells[doorIdx] = Cell.DOOR;
  world.wallTex[doorIdx] = Tex.DOOR_METAL;
  world.hermoWall[doorIdx] = 0;
  world.doors.set(doorIdx, {
    idx: doorIdx,
    state: DoorState.HERMETIC_OPEN,
    roomA: id,
    roomB: -1,
    keyId: '',
    timer: 0,
  });
  room.doors.push(doorIdx);

  for (let dx = -1; dx <= 1; dx++) {
    const ci = world.idx(doorX + dx, doorY + 1);
    world.cells[ci] = Cell.FLOOR;
    world.roomMap[ci] = -1;
    world.floorTex[ci] = Tex.F_MARBLE_TILE;
  }
  setFeature(world, x + 2, y + 2, Feature.SHELF);
  setFeature(world, x + w - 3, y + 2, Feature.SHELF);
  setFeature(world, x + Math.floor(w / 2), y + Math.floor(h / 2), Feature.TABLE);
  setFeature(world, x + Math.floor(w / 2), y + 1, Feature.LAMP);

  world.rooms[id] = room;
  return room;
}

export function applyMinistryMacroGeometry(world: World, nextRoomId: number): MinistryMacroGeometry {
  const rooms: Room[] = [];
  const carpetCells: number[] = [];

  // Public backbone: ungated axes and nested rings. Lifts attach to this graph later.
  carveLine(world, 16, CENTER, W - 16, CENTER, 6, 'public', carpetCells);
  carveLine(world, CENTER, 16, CENTER, W - 16, 6, 'public', carpetCells);
  carveRectLoop(world, 184, 184, W - 184, W - 184, 4, 'public', carpetCells);
  carveRectLoop(world, 304, 304, W - 304, W - 304, 3, 'public', carpetCells);
  carveRectLoop(world, 424, 424, W - 424, W - 424, 2, 'queue', carpetCells);

  // Office BSP: explicit service spines that give the room grower office frontage.
  carveOfficeBsp(world, 160, 160, W - 160, W - 160, 0, carpetCells);

  // Archive/service backroutes: thinner marble loops offset from the carpet graph.
  carveRectLoop(world, 232, 276, W - 232, W - 276, 1, 'service', carpetCells);
  carveRectLoop(world, 276, 232, W - 276, W - 232, 1, 'service', carpetCells);
  carveLine(world, 232, 384, W - 232, 384, 1, 'service', carpetCells);
  carveLine(world, 232, 640, W - 232, 640, 1, 'service', carpetCells);
  carveLine(world, 384, 232, 384, W - 232, 1, 'service', carpetCells);
  carveLine(world, 640, 232, 640, W - 232, 1, 'service', carpetCells);
  addArchiveShelves(world, 232, 276, W - 232, W - 276);
  addArchiveShelves(world, 276, 232, W - 276, W - 232);
  for (const spec of ARCHIVE_SUBGRAPHS) {
    carveArchiveSubgraph(world, spec, carpetCells);
  }

  // Clerk queue switchbacks beside the central axis, plus a visible bypass.
  carveQueueSerpent(world, 232, 468, 184, 7, carpetCells);
  carveQueueSerpent(world, 608, 468, 184, 7, carpetCells);
  carveLine(world, 232, 532, 416, 532, 1, 'service', carpetCells);
  carveLine(world, 608, 532, 792, 532, 1, 'service', carpetCells);
  addRouteDoor(world, 324, 532, DoorState.CLOSED, '');
  addRouteDoor(world, 700, 532, DoorState.CLOSED, '');

  // Locked authority shortcut: a fast private cut across the rings.
  carveLine(world, 352, 456, 672, 456, 2, 'authority', carpetCells);
  carveLine(world, 536, 456, 536, 506, 1, 'authority', carpetCells);
  carveLine(world, 488, 456, 488, 304, 1, 'authority', carpetCells);
  carveLine(world, 584, 456, 584, 720, 1, 'authority', carpetCells);
  addRouteDoor(world, 536, 505, DoorState.LOCKED, 'key');
  addRouteDoor(world, 352, 456, DoorState.LOCKED, 'key');
  addRouteDoor(world, 672, 456, DoorState.LOCKED, 'key');
  addRouteDoor(world, 488, 304, DoorState.LOCKED, 'key');
  addRouteDoor(world, 584, 720, DoorState.LOCKED, 'key');

  // Document-gate chokepoints on the public graph. They can be opened, fought
  // through, or avoided by queue/service/authority routes.
  addRouteDoor(world, 384, CENTER, DoorState.CLOSED, '');
  addRouteDoor(world, 640, CENTER, DoorState.CLOSED, '');
  addRouteDoor(world, CENTER, 384, DoorState.CLOSED, '');
  addRouteDoor(world, CENTER, 640, DoorState.CLOSED, '');
  for (const [gx, gy] of [[384, CENTER], [640, CENTER], [CENTER, 384], [CENTER, 640]] as const) {
    setFeature(world, gx - 2, gy - 2, Feature.DESK);
    setFeature(world, gx + 2, gy + 2, Feature.DESK);
    setFeature(world, gx - 3, gy + 2, Feature.CHAIR);
    setFeature(world, gx + 3, gy - 2, Feature.CHAIR);
  }

  nextRoomId = addAxisBooths(world, nextRoomId, rooms, carpetCells);

  const courtyardSpecs: [string, number, number][] = [
    ['Северо-западный мраморный двор', 300, 300],
    ['Северо-восточный мраморный двор', 686, 300],
    ['Юго-западный мраморный двор', 300, 686],
    ['Юго-восточный мраморный двор', 686, 686],
  ];
  for (const [name, x, y] of courtyardSpecs) {
    const room = makeOpenLandmark(world, nextRoomId++, name, RoomType.COMMON, x, y, 38, 28, Tex.F_MARBLE_TILE);
    addCourtyardColumns(world, room);
    rooms.push(room);
  }

  nextRoomId = addLandmarks(world, nextRoomId, rooms, carpetCells);

  const vestibule = makeOpenLandmark(
    world,
    nextRoomId++,
    'Центральный вестибюль входящих дел',
    RoomType.COMMON,
    CENTER - 16,
    CENTER - 16,
    33,
    33,
    Tex.F_RED_CARPET,
  );
  addCarpetCellsForRoom(world, vestibule, carpetCells);
  for (let d = 4; d < vestibule.w - 3; d += 8) {
    setFeature(world, vestibule.x + d, vestibule.y + 3, Feature.LAMP);
    setFeature(world, vestibule.x + d, vestibule.y + vestibule.h - 4, Feature.LAMP);
  }
  rooms.push(vestibule);

  rooms.push(makeShelterRoom(world, nextRoomId++, CENTER - 16, CENTER - 26, 16, 9));

  nextRoomId = addFactionHqCompounds(world, nextRoomId, rooms, carpetCells);

  return { nextRoomId, rooms, carpetCells };
}
