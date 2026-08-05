/* -- Design floor: istinniy_labirint / Истинный лабиринт -------- */

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
  QuestType,
  RoomType,
  Tex,
  W,
  ZoneFaction,
  type Entity,
  type Room,
  type TerritoryOwner,
  type WorldContainer,
} from '../../core/types';
import { SURFACE_FLAG_CHALK_MAP, World } from '../../core/world';
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import { stampSurfaceSplat } from '../../systems/surface_marks';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { ensureConnectivity, generateZones, sanitizeDoors, stampRoom } from '../shared';
import type { FloorGeneration } from '../floor_manifest';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('istinniy_labirint');

export const ISTINNIY_LABIRINT_ROUTE_ID = 'istinniy_labirint' as const;
export const ISTINNIY_LABIRINT_Z = 28;
export const ISTINNIY_LABIRINT_CHORD_KEY = 'key';

const BASE_FLOOR = FloorLevel.MINISTRY;
const GRID_W = 63;
const GRID_H = 63;
const GRID_N = GRID_W * GRID_H;
const PITCH = 16;
const CENTER_OFFSET = 8;
const START_GX = 31;
const START_GY = 31;
const SAFE_WALL_MIN = 32;
const SAFE_WALL_MAX = W - 33;
const ROOM_WALL = Tex.MARBLE;
const ROOM_FLOOR = Tex.F_PARQUET;
const MAZE_WALL = Tex.PANEL;
const MAZE_FLOOR = Tex.F_CONCRETE;
const THREAD_FLOOR = Tex.F_TILE;
const CHORD_FLOOR = Tex.F_RED_CARPET;
const SAFE_WALL_ROOM = 'Лабиринт: белая стена обратного пути';
const LOST_ROOM = 'Лабиринт: узел потерянного Паши';
const DOCUMENT_STASH_ROOM = 'Лабиринт: тупик документного ящика';
const LANDMARK_ROOM_NAMES = new Set([
  'Лабиринт: нулевая катушка Ариадны',
  SAFE_WALL_ROOM,
  'Лабиринт: комната шести стрелок',
  'Лабиринт: узел короткой красной хорды',
  LOST_ROOM,
  DOCUMENT_STASH_ROOM,
  'Лабиринт: дальняя лифтовая спина',
]);

const BIT_E = 1 << 0;
const BIT_W = 1 << 1;
const BIT_S = 1 << 2;
const BIT_N = 1 << 3;

interface Dir {
  dx: number;
  dy: number;
  bit: number;
  opposite: number;
}

const DIRS: readonly Dir[] = [
  { dx: 1, dy: 0, bit: BIT_E, opposite: BIT_W },
  { dx: -1, dy: 0, bit: BIT_W, opposite: BIT_E },
  { dx: 0, dy: 1, bit: BIT_S, opposite: BIT_N },
  { dx: 0, dy: -1, bit: BIT_N, opposite: BIT_S },
] as const;

interface MazeGraph {
  links: Uint8Array;
  start: number;
  exit: number;
  parent: Int32Array;
  depth: Int32Array;
  mainPath: number[];
  braidedLinks: number;
}

interface LockedChord {
  a: number;
  b: number;
  doorIdx: number;
}

interface CellPoint {
  x: number;
  y: number;
}

interface Landmark {
  cell: number;
  name: string;
  type: RoomType;
  w: number;
  h: number;
  feature: Feature;
}

interface LabyrinthOwnedRoom {
  room: Room;
  owner: TerritoryOwner;
}

interface RoomStampSpec {
  cell: number;
  dx: number;
  dy: number;
  w: number;
  h: number;
  type: RoomType;
  name: string;
  wallTex: Tex;
  floorTex: Tex;
  feature: Feature;
  owner?: TerritoryOwner;
  sealed?: boolean;
  hermeticDoor?: boolean;
}

export interface IstinniyLabirintMetrics {
  routeId: typeof ISTINNIY_LABIRINT_ROUTE_ID;
  z: typeof ISTINNIY_LABIRINT_Z;
  landmarkCount: number;
  midRooms: number;
  microRooms: number;
  rewardDeadEnds: number;
  lockedChords: number;
  ariadneCueCells: number;
  mainPathLength: number;
  pathEntropy: number;
  minLandmarkSpacing: number;
  safeWallCells: number;
  ungatedDownLiftReachable: boolean;
  ungatedUpLiftReachable: boolean;
}

const NPC_IDS = {
  ariadna: 'labyrinth_ariadna_zina',
  lostPavel: 'labyrinth_lost_pavel',
} as const;

const ARIADNA_DEF: PlotNpcDef = {
  name: 'Зина Ариадна',
  isFemale: true,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 150,
  maxHp: 150,
  money: 64,
  speed: 1.0,
  weapon: 'makarov',
  inventory: [
    { defId: 'chalk', count: 1 },
    { defId: 'key', count: 1 },
    { defId: 'ammo_9mm', count: 10 },
  ],
  talkLines: [
    'Истинный лабиринт не прячет выход. Он прячет уверенность, что ты уже был здесь.',
    'Белую стену держи левой рукой. Красная хорда короче, но там голоса считают патроны.',
    'Мел ставь не на память, а на отступление. Память здесь берет взятки.',
    'Паша ушел по ламповому следу и перестал спорить. Если найдешь, веди к белой стене, не к центру.',
  ],
  talkLinesPost: [
    'Нить обновлена. Если метка свежая, а пыль старая, значит, метку поставили не люди.',
    'Ключ от хорды не делает ход безопасным. Он только делает ошибку короче.',
  ],
  talkQuestResponse: 'Паша дошел до поста и молчит правильно. Держи схему лифтов. В следующий раз бери мел до входа.',
};

const LOST_PAVEL_DEF: PlotNpcDef = {
  name: 'Паша Без Нити',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.TRAVELER,
  sprite: Occupation.TRAVELER,
  hp: 88,
  maxHp: 88,
  money: 17,
  speed: 0.78,
  inventory: [
    { defId: 'bread', count: 1 },
    { defId: 'chalk', count: 1 },
  ],
  talkLines: [
    'Я помнил три поворота. Потом стены стали одинаковые, а мои метки начали смотреть назад.',
    'Если ведешь к лифту, не срезай по красному ковру. Там кто-то дышит между шагами.',
    'В тупике с ящиком лежит бумага. Я ее не трогал: бумага знала мое имя.',
  ],
  talkLinesPost: [
    'У белой стены тихо. Слишком тихо, но это уже работа Зины.',
    'Я больше не считаю повороты. Считаю воду.',
  ],
};

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, NPC_IDS.ariadna, ARIADNA_DEF, [{
  id: 'labyrinth_rechalk_safe_wall',
  giverNpcId: NPC_IDS.ariadna,
  type: QuestType.FETCH,
  desc: 'Зина Ариадна: «Принеси мелок на белую стену. Обновим нить, пока лабиринт не выучил старые стрелки.»',
  targetItem: 'chalk',
  targetCount: 1,
  targetFloor: BASE_FLOOR,
  targetRoute: { designFloorId: ISTINNIY_LABIRINT_ROUTE_ID },
  targetRoomName: SAFE_WALL_ROOM,
  targetHint: 'Истинный лабиринт z=+28: держаться белой стены и искать свежие желтые метки.',
  rewardItem: 'key',
  rewardCount: 1,
  extraRewards: [{ defId: 'gasmask_filter', count: 1 }],
  relationDelta: 8,
  xpReward: 45,
  moneyReward: 28,
  eventTags: ['istinniy_labirint', 'chalk_route_mark', 'safe_wall'],
}]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, NPC_IDS.lostPavel, LOST_PAVEL_DEF, [{
  id: 'labyrinth_rescue_lost_pavel',
  giverNpcId: NPC_IDS.lostPavel,
  type: QuestType.TALK,
  desc: 'Паша Без Нити: «Доведи меня до Зины Ариадны. Только не красной хордой: там коротко, потому что там ждут.»',
  targetNpcId: NPC_IDS.ariadna,
  targetFloor: BASE_FLOOR,
  targetRoute: { designFloorId: ISTINNIY_LABIRINT_ROUTE_ID },
  targetRoomName: SAFE_WALL_ROOM,
  targetHint: 'Истинный лабиринт: вернуться к белой стене и поговорить с Зиной Ариадной.',
  rewardItem: 'lift_scheme',
  rewardCount: 1,
  extraRewards: [{ defId: 'water', count: 1 }],
  relationDelta: 12,
  xpReward: 55,
  moneyReward: 36,
  eventTags: ['istinniy_labirint', 'rescue', 'lost_npc'],
  failOnNpcDeathPlotId: NPC_IDS.lostPavel,
}]);

function gridIdx(gx: number, gy: number): number {
  const x = ((gx % GRID_W) + GRID_W) % GRID_W;
  const y = ((gy % GRID_H) + GRID_H) % GRID_H;
  return y * GRID_W + x;
}

function gridX(idx: number): number {
  return idx % GRID_W;
}

function gridY(idx: number): number {
  return (idx / GRID_W) | 0;
}

function centerOf(idx: number): CellPoint {
  return {
    x: CENTER_OFFSET + gridX(idx) * PITCH,
    y: CENTER_OFFSET + gridY(idx) * PITCH,
  };
}

function randInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

function degree(links: Uint8Array, idx: number): number {
  let count = 0;
  const mask = links[idx];
  for (const dir of DIRS) if (mask & dir.bit) count++;
  return count;
}

function shuffleDirs(): Dir[] {
  const dirs = [...DIRS];
  for (let i = dirs.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
  }
  return dirs;
}

function buildGrowingTreeMaze(): MazeGraph {
  const links = new Uint8Array(GRID_N);
  const visited = new Uint8Array(GRID_N);
  const start = gridIdx(START_GX, START_GY);
  const active = [start];
  visited[start] = 1;

  while (active.length > 0) {
    const ai = Math.random() < 0.72 ? active.length - 1 : randInt(active.length);
    const cell = active[ai];
    const gx = gridX(cell);
    const gy = gridY(cell);
    const candidates: { dir: Dir; next: number }[] = [];
    for (const dir of shuffleDirs()) {
      const next = gridIdx(gx + dir.dx, gy + dir.dy);
      if (!visited[next]) candidates.push({ dir, next });
    }
    if (candidates.length === 0) {
      if (ai === active.length - 1) {
        active.pop();
      } else {
        active[ai] = active.pop()!;
      }
      continue;
    }
    const pick = candidates[randInt(candidates.length)];
    links[cell] |= pick.dir.bit;
    links[pick.next] |= pick.dir.opposite;
    visited[pick.next] = 1;
    active.push(pick.next);
  }

  const braidedLinks = braidDeadEnds(links);
  const { parent, depth, exit } = measureMazeDepth(links, start);
  const mainPath = pathToRoot(parent, exit);
  return { links, start, exit, parent, depth, mainPath, braidedLinks };
}

function braidDeadEnds(links: Uint8Array): number {
  let added = 0;
  for (let idx = 0; idx < GRID_N; idx++) {
    if (degree(links, idx) !== 1 || Math.random() > 0.44) continue;
    const gx = gridX(idx);
    const gy = gridY(idx);
    const options: { dir: Dir; next: number; score: number }[] = [];
    for (const dir of DIRS) {
      if (links[idx] & dir.bit) continue;
      const next = gridIdx(gx + dir.dx, gy + dir.dy);
      options.push({ dir, next, score: degree(links, next) });
    }
    options.sort((a, b) => a.score - b.score);
    const pick = options[0];
    if (!pick) continue;
    links[idx] |= pick.dir.bit;
    links[pick.next] |= pick.dir.opposite;
    added++;
  }
  return added;
}

function measureMazeDepth(links: Uint8Array, start: number): { parent: Int32Array; depth: Int32Array; exit: number } {
  const parent = new Int32Array(GRID_N).fill(-1);
  const depth = new Int32Array(GRID_N).fill(-1);
  const queue = new Int32Array(GRID_N);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  depth[start] = 0;
  let exit = start;

  while (head < tail) {
    const cell = queue[head++];
    if (depth[cell] > depth[exit]) exit = cell;
    const gx = gridX(cell);
    const gy = gridY(cell);
    for (const dir of DIRS) {
      if ((links[cell] & dir.bit) === 0) continue;
      const next = gridIdx(gx + dir.dx, gy + dir.dy);
      if (depth[next] >= 0) continue;
      depth[next] = depth[cell] + 1;
      parent[next] = cell;
      queue[tail++] = next;
    }
  }

  return { parent, depth, exit };
}

function pathToRoot(parent: Int32Array, from: number): number[] {
  const path: number[] = [];
  let current = from;
  while (current >= 0) {
    path.push(current);
    current = parent[current];
  }
  path.reverse();
  return path;
}

function carvePatch(world: World, x: number, y: number, radius: number, floorTex: Tex): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.cells[ci] === Cell.LIFT) continue;
      if (world.roomMap[ci] >= 0) continue;
      if (world.cells[ci] === Cell.DOOR) continue;
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = floorTex;
      world.wallTex[ci] = MAZE_WALL;
      world.features[ci] = Feature.NONE;
    }
  }
}

function carveLine(world: World, a: CellPoint, b: CellPoint, radius: number, floorTex: Tex, mark = false): number[] {
  const touched: number[] = [];
  let x = world.wrap(a.x);
  let y = world.wrap(a.y);
  const ddx = world.delta(x, b.x);
  const ddy = world.delta(y, b.y);
  const sx = ddx === 0 ? 0 : ddx > 0 ? 1 : -1;
  const sy = ddy === 0 ? 0 : ddy > 0 ? 1 : -1;

  for (let i = 0; i <= Math.abs(ddx); i++) {
    carvePatch(world, x, y, radius, floorTex);
    const ci = world.idx(x, y);
    touched.push(ci);
    if (mark && i % 11 === 0) markAriadneCue(world, x, y, touched.length, 220, 214, 130);
    if (i < Math.abs(ddx)) x = world.wrap(x + sx);
  }
  for (let i = 0; i <= Math.abs(ddy); i++) {
    carvePatch(world, x, y, radius, floorTex);
    const ci = world.idx(x, y);
    touched.push(ci);
    if (mark && i % 11 === 0) markAriadneCue(world, x, y, touched.length + 600, 220, 214, 130);
    if (i < Math.abs(ddy)) y = world.wrap(y + sy);
  }

  return touched;
}

function carveThinLine(world: World, a: CellPoint, b: CellPoint, floorTex: Tex, markSeed = 0): number[] {
  const touched: number[] = [];
  let x = world.wrap(a.x);
  let y = world.wrap(a.y);
  const ddx = world.delta(x, b.x);
  const ddy = world.delta(y, b.y);
  const sx = ddx === 0 ? 0 : ddx > 0 ? 1 : -1;
  const sy = ddy === 0 ? 0 : ddy > 0 ? 1 : -1;

  function carveOne(serial: number): void {
    const ci = world.idx(x, y);
    if (world.cells[ci] !== Cell.LIFT && world.cells[ci] !== Cell.DOOR && world.roomMap[ci] < 0) {
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = floorTex;
      world.wallTex[ci] = MAZE_WALL;
      touched.push(ci);
      if (markSeed > 0 && serial % 9 === 0) markAriadneCue(world, x, y, markSeed + serial, 206, 198, 142);
    }
  }

  for (let i = 0; i <= Math.abs(ddx); i++) {
    carveOne(i);
    if (i < Math.abs(ddx)) x = world.wrap(x + sx);
  }
  for (let i = 0; i <= Math.abs(ddy); i++) {
    carveOne(i + 400);
    if (i < Math.abs(ddy)) y = world.wrap(y + sy);
  }
  return touched;
}

function carveMaze(world: World, graph: MazeGraph): void {
  for (let idx = 0; idx < GRID_N; idx++) {
    const c = centerOf(idx);
    carvePatch(world, c.x, c.y, 2, MAZE_FLOOR);
  }

  for (let idx = 0; idx < GRID_N; idx++) {
    const c = centerOf(idx);
    const gx = gridX(idx);
    const gy = gridY(idx);
    for (const dir of DIRS) {
      if ((graph.links[idx] & dir.bit) === 0) continue;
      if (dir.bit === BIT_W || dir.bit === BIT_N) continue;
      const next = centerOf(gridIdx(gx + dir.dx, gy + dir.dy));
      carveLine(world, c, next, 1, MAZE_FLOOR);
    }
  }
}

function carveSafeWallRoute(world: World, graph: MazeGraph): number[] {
  const start = centerOf(graph.start);
  const exit = centerOf(graph.exit);
  const waypoints: CellPoint[] = [
    start,
    { x: SAFE_WALL_MIN, y: start.y },
    { x: SAFE_WALL_MIN, y: SAFE_WALL_MIN },
    { x: SAFE_WALL_MAX, y: SAFE_WALL_MIN },
    { x: SAFE_WALL_MAX, y: SAFE_WALL_MAX },
    { x: exit.x, y: SAFE_WALL_MAX },
    exit,
  ];
  const route: number[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    route.push(...carveLine(world, waypoints[i], waypoints[i + 1], 2, THREAD_FLOOR, true));
  }
  return route;
}

function markAriadneCue(world: World, x: number, y: number, seed: number, r: number, g: number, b: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.DOOR) return;
  stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.9, 0.6, seed, r, g, b, false);
  world.surfaceFlags[ci] |= SURFACE_FLAG_CHALK_MAP;
}

function markMainThread(world: World, graph: MazeGraph): void {
  for (let i = 0; i < graph.mainPath.length; i += 3) {
    const p = centerOf(graph.mainPath[i]);
    markAriadneCue(world, p.x, p.y, i + 90, 208, 202, 154);
  }
}

function linkedDirections(links: Uint8Array, cell: number): Dir[] {
  return DIRS.filter(dir => (links[cell] & dir.bit) !== 0);
}

function retintRoom(world: World, room: Room, wallTex: Tex, floorTex: Tex): void {
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  for (let y = room.y - 1; y <= room.y + room.h; y++) {
    for (let x = room.x - 1; x <= room.x + room.w; x++) {
      const ci = world.idx(x, y);
      if (world.roomMap[ci] === room.id) {
        world.floorTex[ci] = floorTex;
      } else if (world.cells[ci] === Cell.WALL) {
        world.wallTex[ci] = wallTex;
      }
    }
  }
}

function addDoorToRoom(world: World, room: Room, wx: number, wy: number): void {
  const idx = world.idx(wx, wy);
  if (world.cells[idx] === Cell.DOOR) return;
  world.cells[idx] = Cell.DOOR;
  world.wallTex[idx] = Tex.DOOR_METAL;
  world.doors.set(idx, {
    idx,
    state: DoorState.CLOSED,
    roomA: room.id,
    roomB: -1,
    keyId: '',
    timer: 0,
  });
  room.doors.push(idx);
}

function addDoorToRoomState(world: World, room: Room, wx: number, wy: number, state: DoorState, keyId = ''): void {
  const idx = world.idx(wx, wy);
  if (world.cells[idx] === Cell.DOOR) return;
  world.cells[idx] = Cell.DOOR;
  world.wallTex[idx] = state === DoorState.HERMETIC_OPEN || state === DoorState.HERMETIC_CLOSED ? Tex.HERMO_WALL : Tex.DOOR_METAL;
  world.doors.set(idx, {
    idx,
    state,
    roomA: room.id,
    roomB: -1,
    keyId,
    timer: 0,
  });
  room.doors.push(idx);
}

function connectLandmarkRoom(world: World, room: Room, cell: number, links: Uint8Array): void {
  const c = centerOf(cell);
  const dirs = linkedDirections(links, cell);
  const chosen = dirs.length > 0 ? dirs : [DIRS[0]];
  for (const dir of chosen) {
    let wx = c.x;
    let wy = c.y;
    if (dir.dx > 0) wx = room.x + room.w;
    else if (dir.dx < 0) wx = room.x - 1;
    else if (dir.dy > 0) wy = room.y + room.h;
    else wy = room.y - 1;
    if (dir.dy !== 0) wx = c.x;
    if (dir.dx !== 0) wy = c.y;
    addDoorToRoom(world, room, wx, wy);
    carvePatch(world, wx + dir.dx, wy + dir.dy, 1, MAZE_FLOOR);
  }
}

function placeLandmarkRoom(world: World, graph: MazeGraph, spec: Landmark): Room {
  const c = centerOf(spec.cell);
  const x = Math.max(10, Math.min(W - spec.w - 12, c.x - Math.floor(spec.w / 2)));
  const y = Math.max(10, Math.min(W - spec.h - 12, c.y - Math.floor(spec.h / 2)));
  const room = stampRoom(world, world.rooms.length, spec.type, x, y, spec.w, spec.h, -1);
  room.name = spec.name;
  retintRoom(world, room, ROOM_WALL, ROOM_FLOOR);
  if (spec.feature !== Feature.NONE) world.features[world.idx(c.x, c.y)] = spec.feature;
  connectLandmarkRoom(world, room, spec.cell, graph.links);
  return room;
}

function pathCell(graph: MazeGraph, fraction: number): number {
  const idx = Math.max(0, Math.min(graph.mainPath.length - 1, Math.round((graph.mainPath.length - 1) * fraction)));
  return graph.mainPath[idx];
}

function deepestDeadEnds(graph: MazeGraph, count: number, exclude: ReadonlySet<number>): number[] {
  const cells: number[] = [];
  for (let idx = 0; idx < GRID_N; idx++) {
    if (exclude.has(idx)) continue;
    if (degree(graph.links, idx) <= 1) cells.push(idx);
  }
  cells.sort((a, b) => graph.depth[b] - graph.depth[a]);
  return cells.slice(0, count);
}

function chooseLandmarks(graph: MazeGraph): Landmark[] {
  const onMain = new Set(graph.mainPath);
  const deadEnds = deepestDeadEnds(graph, 4, onMain);
  const specs: Landmark[] = [
    { cell: graph.start, name: 'Лабиринт: нулевая катушка Ариадны', type: RoomType.HQ, w: 17, h: 13, feature: Feature.DESK },
    { cell: pathCell(graph, 0.18), name: SAFE_WALL_ROOM, type: RoomType.CORRIDOR, w: 23, h: 9, feature: Feature.LAMP },
    { cell: pathCell(graph, 0.38), name: 'Лабиринт: комната шести стрелок', type: RoomType.COMMON, w: 17, h: 15, feature: Feature.SCREEN },
    { cell: pathCell(graph, 0.62), name: 'Лабиринт: узел короткой красной хорды', type: RoomType.CORRIDOR, w: 19, h: 11, feature: Feature.LAMP },
    { cell: deadEnds[0] ?? pathCell(graph, 0.73), name: LOST_ROOM, type: RoomType.LIVING, w: 13, h: 13, feature: Feature.CHAIR },
    { cell: deadEnds[1] ?? pathCell(graph, 0.84), name: DOCUMENT_STASH_ROOM, type: RoomType.STORAGE, w: 13, h: 11, feature: Feature.SHELF },
    { cell: graph.exit, name: 'Лабиринт: дальняя лифтовая спина', type: RoomType.HQ, w: 17, h: 13, feature: Feature.LIFT_BUTTON },
  ];
  return specs;
}

function roomCanOverwriteLabyrinth(world: World, x: number, y: number, w: number, h: number): boolean {
  if (x < 4 || y < 4 || x + w + 4 >= W || y + h + 4 >= W) return false;
  for (let dy = -3; dy <= h + 2; dy++) {
    for (let dx = -3; dx <= w + 2; dx++) {
      const idx = world.idx(x + dx, y + dy);
      if (world.aptMask[idx]) return false;
      if (world.roomMap[idx] >= 0) return false;
      if (world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.DOOR) return false;
      if (world.features[idx] === Feature.LIFT_BUTTON) return false;
      if (world.doors.has(idx)) return false;
    }
  }
  return true;
}

function decorateLabyrinthRoom(world: World, room: Room, feature: Feature, serial: number): void {
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  const centerIdx = world.idx(cx, cy);
  if (world.features[centerIdx] === Feature.NONE) world.features[centerIdx] = feature;
  const left = world.idx(room.x + 1, cy);
  const right = world.idx(room.x + room.w - 2, cy);
  const top = world.idx(cx, room.y + 1);
  const bottom = world.idx(cx, room.y + room.h - 2);
  switch (room.type) {
    case RoomType.KITCHEN:
      world.features[left] = Feature.STOVE;
      world.features[right] = Feature.SINK;
      break;
    case RoomType.BATHROOM:
      world.features[left] = Feature.TOILET;
      world.features[right] = Feature.SINK;
      break;
    case RoomType.STORAGE:
      world.features[left] = Feature.SHELF;
      world.features[right] = serial % 3 === 0 ? Feature.MACHINE : Feature.SHELF;
      break;
    case RoomType.MEDICAL:
      world.features[top] = Feature.APPARATUS;
      world.features[bottom] = Feature.BED;
      break;
    case RoomType.PRODUCTION:
      world.features[top] = Feature.MACHINE;
      world.features[bottom] = Feature.APPARATUS;
      break;
    case RoomType.OFFICE:
    case RoomType.HQ:
      world.features[left] = Feature.DESK;
      world.features[right] = serial % 2 === 0 ? Feature.SCREEN : Feature.SHELF;
      break;
  }
}

function paintRoomTerritory(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.aptMask[idx]) continue;
      world.factionControl[idx] = owner;
    }
  }
}

function connectRoomToPoint(
  world: World,
  room: Room,
  targetX: number,
  targetY: number,
  state: DoorState,
  markSeed: number,
): void {
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  const dx = world.delta(cx, targetX);
  const dy = world.delta(cy, targetY);
  let wx = cx;
  let wy = cy;
  let ox = cx;
  let oy = cy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    wx = dx >= 0 ? room.x + room.w : room.x - 1;
    wy = Math.max(room.y, Math.min(room.y + room.h - 1, targetY));
    ox = wx + (dx >= 0 ? 1 : -1);
    oy = wy;
  } else {
    wx = Math.max(room.x, Math.min(room.x + room.w - 1, targetX));
    wy = dy >= 0 ? room.y + room.h : room.y - 1;
    ox = wx;
    oy = wy + (dy >= 0 ? 1 : -1);
  }
  addDoorToRoomState(world, room, wx, wy, state);
  carveThinLine(world, { x: ox, y: oy }, { x: targetX, y: targetY }, state === DoorState.HERMETIC_OPEN ? THREAD_FLOOR : MAZE_FLOOR, markSeed);
  markAriadneCue(world, ox, oy, markSeed, 206, 198, 142);
}

function tryStampLabyrinthRoom(world: World, spec: RoomStampSpec, serial: number): Room | null {
  const center = centerOf(spec.cell);
  const x = Math.max(6, Math.min(W - spec.w - 7, center.x + spec.dx - Math.floor(spec.w / 2)));
  const y = Math.max(6, Math.min(W - spec.h - 7, center.y + spec.dy - Math.floor(spec.h / 2)));
  if (!roomCanOverwriteLabyrinth(world, x, y, spec.w, spec.h)) return null;
  const room = stampRoom(world, world.rooms.length, spec.type, x, y, spec.w, spec.h, -1);
  room.name = spec.name;
  room.sealed = spec.sealed === true;
  retintRoom(world, room, spec.wallTex, spec.floorTex);
  decorateLabyrinthRoom(world, room, spec.feature, serial);
  connectRoomToPoint(
    world,
    room,
    center.x,
    center.y,
    spec.hermeticDoor ? DoorState.HERMETIC_OPEN : DoorState.CLOSED,
    2400 + serial * 17,
  );
  if (spec.owner !== undefined) paintRoomTerritory(world, room, spec.owner);
  return room;
}

function hqSupportSpecs(cell: number, owner: TerritoryOwner, prefix: string, serial: number, includeCore: boolean): RoomStampSpec[] {
  const wallTex = owner === ZoneFaction.LIQUIDATOR ? Tex.METAL
    : owner === ZoneFaction.SCIENTIST ? Tex.TILE_W
      : owner === ZoneFaction.CULTIST ? Tex.CROSS
        : owner === ZoneFaction.WILD ? Tex.BRICK
          : Tex.PANEL;
  const floorTex = owner === ZoneFaction.SCIENTIST ? Tex.F_TILE
    : owner === ZoneFaction.CULTIST ? Tex.F_RED_CARPET
      : owner === ZoneFaction.WILD ? Tex.F_CONCRETE
        : owner === ZoneFaction.LIQUIDATOR ? Tex.F_CONCRETE
          : Tex.F_LINO;
  const out: RoomStampSpec[] = [];
  if (includeCore) {
    out.push({
      cell,
      dx: 0,
      dy: 0,
      w: 15,
      h: 11,
      type: RoomType.HQ,
      name: `${prefix}: гермоядро`,
      wallTex: Tex.HERMO_WALL,
      floorTex,
      feature: owner === ZoneFaction.CULTIST ? Feature.CANDLE : Feature.DESK,
      owner,
      sealed: true,
      hermeticDoor: true,
    });
  }
  out.push(
    { cell, dx: -18, dy: -18, w: 10, h: 8, type: RoomType.KITCHEN, name: `${prefix}: кухня нити`, wallTex, floorTex, feature: Feature.STOVE, owner },
    { cell, dx: 18, dy: -18, w: 9, h: 7, type: RoomType.BATHROOM, name: `${prefix}: санитарная ниша`, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE, feature: Feature.SINK, owner },
    { cell, dx: -18, dy: 18, w: 11, h: 8, type: RoomType.STORAGE, name: `${prefix}: склад коротких ходов`, wallTex, floorTex, feature: Feature.SHELF, owner },
    {
      cell,
      dx: 18,
      dy: 18,
      w: 11,
      h: 8,
      type: owner === ZoneFaction.SCIENTIST ? RoomType.MEDICAL : owner === ZoneFaction.WILD ? RoomType.SMOKING : RoomType.OFFICE,
      name: `${prefix}: комната поддержки`,
      wallTex,
      floorTex,
      feature: owner === ZoneFaction.SCIENTIST ? Feature.APPARATUS : Feature.TABLE,
      owner,
    },
    { cell, dx: 0, dy: 28, w: 12, h: 7, type: RoomType.PRODUCTION, name: `${prefix}: мастерская отступления`, wallTex, floorTex, feature: Feature.MACHINE, owner },
  );
  void serial;
  return out;
}

function selectDistinctCells(candidates: readonly number[], count: number, used: Set<number>, minGridDistance: number): number[] {
  const out: number[] = [];
  for (const cell of candidates) {
    if (used.has(cell)) continue;
    let far = true;
    const x = gridX(cell);
    const y = gridY(cell);
    for (const taken of used) {
      const tx = gridX(taken);
      const ty = gridY(taken);
      const dx = Math.abs(x - tx);
      const dy = Math.abs(y - ty);
      if (Math.min(dx, GRID_W - dx) + Math.min(dy, GRID_H - dy) < minGridDistance) {
        far = false;
        break;
      }
    }
    if (!far) continue;
    out.push(cell);
    used.add(cell);
    if (out.length >= count) break;
  }
  return out;
}

function placeFactionHqPackages(world: World, graph: MazeGraph, roomsByName: Map<string, Room>): LabyrinthOwnedRoom[] {
  const owned: LabyrinthOwnedRoom[] = [];
  const used = new Set<number>([graph.start, graph.exit, ...graph.mainPath.filter((_, index) => index % 11 === 0)]);
  const existing: { room: Room | undefined; owner: TerritoryOwner; cell: number; prefix: string }[] = [
    { room: roomsByName.get('Лабиринт: нулевая катушка Ариадны'), owner: ZoneFaction.LIQUIDATOR, cell: graph.start, prefix: 'Лабиринт: миништаб ликвидаторов у катушки' },
    { room: roomsByName.get('Лабиринт: дальняя лифтовая спина'), owner: ZoneFaction.WILD, cell: graph.exit, prefix: 'Лабиринт: дикий пост у дальней спины' },
  ];
  for (const item of existing) {
    if (!item.room) continue;
    item.room.sealed = true;
    paintRoomTerritory(world, item.room, item.owner);
    owned.push({ room: item.room, owner: item.owner });
    for (const spec of hqSupportSpecs(item.cell, item.owner, item.prefix, owned.length, false)) {
      const room = tryStampLabyrinthRoom(world, spec, owned.length + 1);
      if (room) owned.push({ room, owner: item.owner });
    }
  }

  const deadEnds = deepestDeadEnds(graph, 64, new Set(graph.mainPath));
  const newHqs: { owner: TerritoryOwner; cell: number; prefix: string }[] = [
    { owner: ZoneFaction.CITIZEN, cell: pathCell(graph, 0.24), prefix: 'Лабиринт: гражданский узел белой стены' },
    { owner: ZoneFaction.SCIENTIST, cell: pathCell(graph, 0.47), prefix: 'Лабиринт: НИИ измерения поворотов' },
    { owner: ZoneFaction.CULTIST, cell: deadEnds[8] ?? pathCell(graph, 0.68), prefix: 'Лабиринт: культовый карман обратных стрелок' },
  ];
  for (const hq of newHqs) {
    used.add(hq.cell);
    for (const spec of hqSupportSpecs(hq.cell, hq.owner, hq.prefix, owned.length, true)) {
      const room = tryStampLabyrinthRoom(world, spec, owned.length + 1);
      if (room) owned.push({ room, owner: hq.owner });
    }
  }
  return owned;
}

function placeMidStations(world: World, graph: MazeGraph, used: Set<number>): void {
  const candidates = [
    ...graph.mainPath.filter((_, index) => index % 9 === 4),
    ...deepestDeadEnds(graph, 36, new Set(graph.mainPath)),
  ].sort((a, b) => graph.depth[b] - graph.depth[a]);
  const cells = selectDistinctCells(candidates, 34, used, 5);
  for (let i = 0; i < cells.length; i++) {
    const motif = i % 6;
    const spec: RoomStampSpec = {
      cell: cells[i],
      dx: motif % 2 === 0 ? 18 : -18,
      dy: motif % 3 === 0 ? 18 : -18,
      w: motif === 0 ? 28 : motif === 1 ? 22 : 18,
      h: motif === 0 ? 18 : motif === 2 ? 16 : 13,
      type: motif === 0 ? RoomType.COMMON : motif === 1 ? RoomType.OFFICE : motif === 2 ? RoomType.STORAGE : motif === 3 ? RoomType.PRODUCTION : motif === 4 ? RoomType.MEDICAL : RoomType.CORRIDOR,
      name: `Лабиринт: станция поворота ${i + 1}`,
      wallTex: motif === 4 ? Tex.TILE_W : ROOM_WALL,
      floorTex: motif === 4 ? Tex.F_TILE : motif === 3 ? Tex.F_CONCRETE : ROOM_FLOOR,
      feature: motif === 3 ? Feature.MACHINE : motif === 4 ? Feature.APPARATUS : motif === 2 ? Feature.SHELF : Feature.TABLE,
    };
    const station = tryStampLabyrinthRoom(world, spec, 300 + i);
    if (!station) continue;
    const annexTypes = [RoomType.STORAGE, RoomType.BATHROOM, RoomType.OFFICE, RoomType.KITCHEN] as const;
    const annexFeatures = [Feature.SHELF, Feature.SINK, Feature.DESK, Feature.STOVE] as const;
    const annexOffsets = [
      { dx: spec.dx + 30, dy: spec.dy },
      { dx: spec.dx - 30, dy: spec.dy },
      { dx: spec.dx, dy: spec.dy + 26 },
      { dx: spec.dx, dy: spec.dy - 26 },
    ];
    for (let j = 0; j < annexOffsets.length; j++) {
      if ((i + j) % 3 === 0) continue;
      tryStampLabyrinthRoom(world, {
        cell: cells[i],
        dx: annexOffsets[j].dx,
        dy: annexOffsets[j].dy,
        w: 8 + ((i + j) % 4),
        h: 6 + ((i + j * 2) % 3),
        type: annexTypes[j],
        name: `Лабиринт: станция поворота ${i + 1}: боковая ячейка ${j + 1}`,
        wallTex: j === 1 ? Tex.TILE_W : MAZE_WALL,
        floorTex: j === 1 ? Tex.F_TILE : MAZE_FLOOR,
        feature: annexFeatures[j],
      }, 360 + i * 5 + j);
    }
  }
}

function placeMicroRooms(world: World, graph: MazeGraph, used: Set<number>): void {
  const allCells: number[] = [];
  for (let i = 0; i < GRID_N; i++) {
    if (degree(graph.links, i) <= 0) continue;
    allCells.push(i);
  }
  allCells.sort((a, b) => {
    const ah = (graph.depth[a] * 1103515245 + a * 2654435761) >>> 0;
    const bh = (graph.depth[b] * 1103515245 + b * 2654435761) >>> 0;
    return ah - bh;
  });
  const cells = selectDistinctCells(allCells, 150, used, 3);
  const roomTypes = [RoomType.STORAGE, RoomType.OFFICE, RoomType.BATHROOM, RoomType.KITCHEN, RoomType.COMMON, RoomType.SMOKING] as const;
  const features = [Feature.SHELF, Feature.DESK, Feature.SINK, Feature.STOVE, Feature.TABLE, Feature.CHAIR] as const;
  for (let i = 0; i < cells.length; i++) {
    const side = i % 4;
    const spec: RoomStampSpec = {
      cell: cells[i],
      dx: side === 0 ? 12 : side === 1 ? -12 : 0,
      dy: side === 2 ? 12 : side === 3 ? -12 : 0,
      w: 5 + (i % 5),
      h: 5 + ((i * 3) % 4),
      type: roomTypes[i % roomTypes.length],
      name: `Лабиринт: малая ячейка ${i + 1}`,
      wallTex: i % 7 === 0 ? Tex.BRICK : MAZE_WALL,
      floorTex: i % 6 === 0 ? Tex.F_LINO : i % 5 === 0 ? Tex.F_TILE : MAZE_FLOOR,
      feature: features[i % features.length],
    };
    tryStampLabyrinthRoom(world, spec, 600 + i);
  }
}

function placeSideAlcoves(world: World, graph: MazeGraph): void {
  for (let i = 2; i < graph.mainPath.length; i += 5) {
    const p = centerOf(graph.mainPath[i]);
    const dir = DIRS[(i + graph.mainPath[i]) % DIRS.length];
    const ax = p.x + dir.dx * 6;
    const ay = p.y + dir.dy * 6;
    carvePatch(world, ax, ay, 1, i % 2 === 0 ? THREAD_FLOOR : MAZE_FLOOR);
    if (i % 4 === 0) {
      const idx = world.idx(ax, ay);
      if (world.features[idx] === Feature.NONE) world.features[idx] = i % 8 === 0 ? Feature.SHELF : Feature.CHAIR;
    }
  }
}

function placeLabyrinthMidMicro(world: World, graph: MazeGraph, roomsByName: Map<string, Room>): LabyrinthOwnedRoom[] {
  const owned = placeFactionHqPackages(world, graph, roomsByName);
  const used = new Set<number>([graph.start, graph.exit]);
  for (const ownedRoom of owned) {
    const cx = ownedRoom.room.x + Math.floor(ownedRoom.room.w / 2);
    const cy = ownedRoom.room.y + Math.floor(ownedRoom.room.h / 2);
    used.add(gridIdx(Math.round((cx - CENTER_OFFSET) / PITCH), Math.round((cy - CENTER_OFFSET) / PITCH)));
  }
  placeMidStations(world, graph, used);
  placeMicroRooms(world, graph, used);
  placeSideAlcoves(world, graph);
  return owned;
}

function paintLabyrinthTerritorySeeds(world: World, ownedRooms: readonly LabyrinthOwnedRoom[]): void {
  for (const item of ownedRooms) paintRoomTerritory(world, item.room, item.owner);
}

function ownerForLabyrinthRoomName(name: string): TerritoryOwner | undefined {
  if (name === 'Лабиринт: нулевая катушка Ариадны' || name.startsWith('Лабиринт: миништаб ликвидаторов у катушки')) return ZoneFaction.LIQUIDATOR;
  if (name === 'Лабиринт: дальняя лифтовая спина' || name.startsWith('Лабиринт: дикий пост у дальней спины')) return ZoneFaction.WILD;
  if (name.startsWith('Лабиринт: гражданский узел белой стены')) return ZoneFaction.CITIZEN;
  if (name.startsWith('Лабиринт: НИИ измерения поворотов')) return ZoneFaction.SCIENTIST;
  if (name.startsWith('Лабиринт: культовый карман обратных стрелок')) return ZoneFaction.CULTIST;
  return undefined;
}

export function reinforceIstinniyLabirintTerritorySeeds(world: World): void {
  for (const room of world.rooms) {
    const owner = ownerForLabyrinthRoomName(room.name);
    if (owner === undefined) continue;
    if (room.name.endsWith(': гермоядро') || room.name === 'Лабиринт: нулевая катушка Ариадны' || room.name === 'Лабиринт: дальняя лифтовая спина') {
      room.type = RoomType.HQ;
      room.sealed = true;
      room.wallTex = Tex.HERMO_WALL;
      for (let dy = -1; dy <= room.h; dy++) {
        for (let dx = -1; dx <= room.w; dx++) {
          const idx = world.idx(room.x + dx, room.y + dy);
          if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
          if (world.cells[idx] === Cell.WALL) {
            world.hermoWall[idx] = 1;
            world.wallTex[idx] = Tex.HERMO_WALL;
          }
        }
      }
    }
    paintRoomTerritory(world, room, owner);
  }
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function selectLockedChords(graph: MazeGraph, count: number): { a: number; dir: Dir; b: number }[] {
  const main = new Set(graph.mainPath);
  const used = new Set<string>();
  const candidates: { a: number; dir: Dir; b: number; score: number }[] = [];
  for (let a = 0; a < GRID_N; a++) {
    const gx = gridX(a);
    const gy = gridY(a);
    for (const dir of DIRS) {
      if (graph.links[a] & dir.bit) continue;
      const b = gridIdx(gx + dir.dx, gy + dir.dy);
      const key = pairKey(a, b);
      if (used.has(key)) continue;
      used.add(key);
      const onPath = main.has(a) || main.has(b);
      const score = graph.depth[a] + graph.depth[b] + (onPath ? 120 : 0);
      candidates.push({ a, dir, b, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, count);
}

function carveLockedChord(world: World, chord: { a: number; dir: Dir; b: number }, serial: number): LockedChord {
  const a = centerOf(chord.a);
  const b = centerOf(chord.b);
  const ddx = world.delta(a.x, b.x);
  const ddy = world.delta(a.y, b.y);
  const steps = Math.max(Math.abs(ddx), Math.abs(ddy));
  const sx = ddx === 0 ? 0 : ddx > 0 ? 1 : -1;
  const sy = ddy === 0 ? 0 : ddy > 0 ? 1 : -1;
  const gateStep = Math.max(2, Math.floor(steps / 2));
  let x = world.wrap(a.x);
  let y = world.wrap(a.y);
  let doorIdx = world.idx(x, y);
  let gateX = x;
  let gateY = y;

  function stampGate(): void {
    doorIdx = world.idx(gateX, gateY);
    if (sx !== 0) {
      for (let oy = -1; oy <= 1; oy++) {
        const wi = world.idx(gateX, gateY + oy);
        world.cells[wi] = oy === 0 ? Cell.DOOR : Cell.WALL;
        world.wallTex[wi] = oy === 0 ? Tex.DOOR_METAL : Tex.METAL;
      }
    } else {
      for (let ox = -1; ox <= 1; ox++) {
        const wi = world.idx(gateX + ox, gateY);
        world.cells[wi] = ox === 0 ? Cell.DOOR : Cell.WALL;
        world.wallTex[wi] = ox === 0 ? Tex.DOOR_METAL : Tex.METAL;
      }
    }
    world.doors.set(doorIdx, {
      idx: doorIdx,
      state: DoorState.LOCKED,
      roomA: -1,
      roomB: -1,
      keyId: ISTINNIY_LABIRINT_CHORD_KEY,
      timer: 0,
    });
  }

  for (let step = 0; step <= steps; step++) {
    if (step === gateStep) {
      gateX = x;
      gateY = y;
      stampGate();
    } else {
      carvePatch(world, x, y, 1, CHORD_FLOOR);
      if (step % 5 === 0) markAriadneCue(world, x, y, 1000 + serial * 97 + step, 160, 52, 52);
    }
    if (step < steps) {
      x = world.wrap(x + sx);
      y = world.wrap(y + sy);
    }
  }
  stampGate();

  return { a: chord.a, b: chord.b, doorIdx };
}

function placeLift(world: World, x: number, y: number, direction: LiftDirection): void {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.LIFT;
  world.wallTex[idx] = Tex.LIFT_DOOR;
  world.features[idx] = Feature.NONE;
  world.liftDir[idx] = direction;
  for (const dir of DIRS) {
    const ai = world.idx(x + dir.dx, y + dir.dy);
    if (world.cells[ai] === Cell.FLOOR) {
      world.features[ai] = Feature.LIFT_BUTTON;
      world.liftDir[ai] = direction;
      return;
    }
  }
}

function addContainer(world: World, nextContainerId: { v: number }, x: number, y: number, roomId: number, kind: ContainerKind, name: string, inventory: WorldContainer['inventory'], tags: string[], access: WorldContainer['access'] = 'public'): void {
  world.addContainer({
    id: nextContainerId.v++,
    x: world.wrap(x),
    y: world.wrap(y),
    floor: BASE_FLOOR,
    roomId,
    zoneId: world.zoneMap[world.idx(x, y)] ?? 0,
    kind,
    name,
    inventory,
    capacitySlots: Math.max(6, inventory.length + 3),
    access,
    lockDifficulty: access === 'locked' ? 3 : undefined,
    discovered: access !== 'secret',
    tags: ['istinniy_labirint', ...tags],
  });
}

function placeRewardStashes(world: World, graph: MazeGraph, nextContainerId: { v: number }, roomsByName: Map<string, Room>): void {
  const excluded = new Set(graph.mainPath);
  const deadEnds = deepestDeadEnds(graph, 7, excluded);
  const docRoom = roomsByName.get(DOCUMENT_STASH_ROOM);
  if (docRoom) {
    addContainer(world, nextContainerId, docRoom.x + Math.floor(docRoom.w / 2), docRoom.y + Math.floor(docRoom.h / 2), docRoom.id, ContainerKind.FILING_CABINET, 'Документный ящик без обратной стрелки', [
      { defId: 'note', count: 1, data: 'Записка: белая стена ведет назад, красная хорда ведет быстро, но не всех.' },
      { defId: 'elevator_access_order', count: 1 },
      { defId: 'personal_file_copy', count: 1 },
    ], ['document_stash', 'dead_end', 'reward'], 'secret');
  }

  for (let i = 0; i < deadEnds.length; i++) {
    const p = centerOf(deadEnds[i]);
    addContainer(world, nextContainerId, p.x, p.y, -1, i % 2 === 0 ? ContainerKind.SECRET_STASH : ContainerKind.METAL_CABINET, `Тупиковый тайник нити ${i + 1}`, [
      { defId: i % 2 === 0 ? 'chalk' : 'water', count: 1 },
      { defId: i % 3 === 0 ? 'bandage' : 'bread', count: 1 },
      ...(i === 0 ? [{ defId: 'key', count: 1 }] : []),
    ], ['dead_end', 'reward', i === 0 ? 'chord_key' : 'supply'], i === 0 ? 'locked' : 'secret');
    markAriadneCue(world, p.x, p.y, 1500 + i, 232, 220, 158);
  }
}

function spawnPlotNpc(
  entities: Entity[],
  nextId: { v: number },
  npcId: string,
  _def: PlotNpcDef,
  x: number,
  y: number,
  angle = 0,
): number {
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, npcId, x + 0.5, y + 0.5, {
    angle,
    aiTarget: { x, y },
    extra: { rpg: randomRPG(3) },
  });
  return npc.id;
}

function spawnMonster(
  entities: Entity[],
  nextId: { v: number },
  kind: MonsterKind,
  x: number,
  y: number,
  level: number,
): void {
  const def = MONSTERS[kind];
  if (!def) return;
  const hp = scaleMonsterHp(def.hp, level);
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, level),
    sprite: monsterSpr(kind),
    name: def.name,
    hp,
    maxHp: hp,
    monsterKind: kind,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    attackCd: Math.random(),
    rpg: randomRPG(level),
  });
}

function placeActors(world: World, graph: MazeGraph, roomsByName: Map<string, Room>, entities: Entity[], nextId: { v: number }, chords: readonly LockedChord[]): void {
  const startRoom = roomsByName.get('Лабиринт: нулевая катушка Ариадны');
  const lostRoom = roomsByName.get(LOST_ROOM);
  if (startRoom) spawnPlotNpc(entities, nextId, NPC_IDS.ariadna, ARIADNA_DEF, startRoom.x + 4, startRoom.y + 6, 0);
  if (lostRoom) spawnPlotNpc(entities, nextId, NPC_IDS.lostPavel, LOST_PAVEL_DEF, lostRoom.x + 5, lostRoom.y + 6, Math.PI);

  const chordKinds = [MonsterKind.SHADOW, MonsterKind.BEZEKHIY, MonsterKind.NELYUD, MonsterKind.PECHATEED] as const;
  for (let i = 0; i < chords.length; i++) {
    const p = centerOf(i % 2 === 0 ? chords[i].a : chords[i].b);
    spawnMonster(entities, nextId, chordKinds[i % chordKinds.length], p.x + (i % 3) - 1, p.y + ((i + 1) % 3) - 1, 5);
  }

  const deepDeadEnds = deepestDeadEnds(graph, 14, new Set(graph.mainPath));
  const ambushKinds = [MonsterKind.BEZEKHIY, MonsterKind.KONTORSHCHIK, MonsterKind.SHADOW, MonsterKind.PARAGRAPH] as const;
  for (let i = 0; i < deepDeadEnds.length; i++) {
    const p = centerOf(deepDeadEnds[i]);
    spawnMonster(entities, nextId, ambushKinds[i % ambushKinds.length], p.x, p.y, 3 + (i % 3));
  }

  void world;
}

function placeLandmarks(world: World, graph: MazeGraph): Map<string, Room> {
  const rooms = new Map<string, Room>();
  for (const spec of chooseLandmarks(graph)) {
    const room = placeLandmarkRoom(world, graph, spec);
    rooms.set(room.name, room);
  }
  return rooms;
}

function tuneLabyrinthZones(world: World): void {
  generateZones(world);
  for (const zone of world.zones) {
    const d = world.dist(zone.cx, zone.cy, W / 2, W / 2);
    zone.level = Math.max(2, Math.min(5, 2 + Math.round(d / 280)));
    zone.faction = d < 190 ? ZoneFaction.LIQUIDATOR : zone.id % 5 === 0 ? ZoneFaction.WILD : ZoneFaction.CITIZEN;
    zone.fogged = false;
    zone.hasLift = d < 260 || zone.id % 11 === 0;
  }
  for (let i = 0; i < W * W; i++) {
    world.factionControl[i] = world.zones[world.zoneMap[i]]?.faction ?? ZoneFaction.CITIZEN;
  }
}

function strictWalkable(world: World, idx: number): boolean {
  const cell = world.cells[idx];
  if (cell === Cell.FLOOR || cell === Cell.WATER) return true;
  if (cell !== Cell.DOOR) return false;
  const door = world.doors.get(idx);
  return !!door && (door.state === DoorState.OPEN || door.state === DoorState.CLOSED || door.state === DoorState.HERMETIC_OPEN);
}

function reachableStrict(world: World, startIdx: number): Uint8Array {
  const seen = new Uint8Array(W * W);
  const queue = new Int32Array(W * W);
  if (!strictWalkable(world, startIdx)) return seen;
  let head = 0;
  let tail = 0;
  seen[startIdx] = 1;
  queue[tail++] = startIdx;
  while (head < tail) {
    const ci = queue[head++];
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const dir of DIRS) {
      const ni = world.idx(x + dir.dx, y + dir.dy);
      if (seen[ni] || !strictWalkable(world, ni)) continue;
      seen[ni] = 1;
      queue[tail++] = ni;
    }
  }
  return seen;
}

function reachableLift(world: World, reachable: Uint8Array, direction: LiftDirection): boolean {
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    const x = i % W;
    const y = (i / W) | 0;
    for (const dir of DIRS) {
      if (reachable[world.idx(x + dir.dx, y + dir.dy)]) return true;
    }
  }
  return false;
}

function findPathToLift(world: World, startIdx: number, direction: LiftDirection): number[] {
  const parent = new Int32Array(W * W).fill(-1);
  const seen = new Uint8Array(W * W);
  const queue = new Int32Array(W * W);
  let head = 0;
  let tail = 0;
  seen[startIdx] = 1;
  queue[tail++] = startIdx;
  let target = -1;
  while (head < tail && target < 0) {
    const ci = queue[head++];
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const dir of DIRS) {
      const ni = world.idx(x + dir.dx, y + dir.dy);
      if (world.cells[ni] === Cell.LIFT && world.liftDir[ni] === direction) {
        target = ci;
        break;
      }
      if (seen[ni] || !strictWalkable(world, ni)) continue;
      seen[ni] = 1;
      parent[ni] = ci;
      queue[tail++] = ni;
    }
  }
  if (target < 0) return [];
  const path: number[] = [];
  let current = target;
  while (current >= 0) {
    path.push(current);
    if (current === startIdx) break;
    current = parent[current];
  }
  path.reverse();
  return path;
}

function pathDirectionEntropy(path: readonly number[]): number {
  if (path.length < 2) return 0;
  const counts = [0, 0, 0, 0];
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1] % W;
    const ay = (path[i - 1] / W) | 0;
    const bx = path[i] % W;
    const by = (path[i] / W) | 0;
    const dx = Math.sign(((bx - ax + W + W / 2) % W) - W / 2);
    const dy = Math.sign(((by - ay + W + W / 2) % W) - W / 2);
    if (dx > 0) counts[0]++;
    else if (dx < 0) counts[1]++;
    else if (dy > 0) counts[2]++;
    else if (dy < 0) counts[3]++;
  }
  const total = counts.reduce((sum, value) => sum + value, 0);
  let entropy = 0;
  for (const count of counts) {
    if (count <= 0) continue;
    const p = count / total;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function minRoomSpacing(world: World, rooms: readonly Room[]): number {
  let best = Infinity;
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      const d = world.dist(a.x + a.w / 2, a.y + a.h / 2, b.x + b.w / 2, b.y + b.h / 2);
      if (d < best) best = d;
    }
  }
  return best === Infinity ? 0 : best;
}

export function measureIstinniyLabirintMetrics(generation: FloorGeneration): IstinniyLabirintMetrics {
  const { world } = generation;
  const startIdx = world.idx(Math.floor(generation.spawnX), Math.floor(generation.spawnY));
  const reachable = reachableStrict(world, startIdx);
  const path = findPathToLift(world, startIdx, LiftDirection.DOWN);
  const landmarkRooms = world.rooms.filter(room => LANDMARK_ROOM_NAMES.has(room.name));
  let cueCells = 0;
  let safeWallCells = 0;
  for (let i = 0; i < W * W; i++) {
    if (world.surfaceFlags[i] & SURFACE_FLAG_CHALK_MAP) cueCells++;
    if (world.floorTex[i] === THREAD_FLOOR && world.cells[i] === Cell.FLOOR) safeWallCells++;
  }
  return {
    routeId: ISTINNIY_LABIRINT_ROUTE_ID,
    z: ISTINNIY_LABIRINT_Z,
    landmarkCount: landmarkRooms.length,
    midRooms: world.rooms.filter(room => room.name.startsWith('Лабиринт: станция поворота')).length,
    microRooms: world.rooms.filter(room => room.name.startsWith('Лабиринт: малая ячейка')).length,
    rewardDeadEnds: world.containers.filter(container => container.tags.includes('dead_end') && container.tags.includes('reward')).length,
    lockedChords: [...world.doors.values()].filter(door => door.keyId === ISTINNIY_LABIRINT_CHORD_KEY && door.state === DoorState.LOCKED).length,
    ariadneCueCells: cueCells,
    mainPathLength: path.length,
    pathEntropy: pathDirectionEntropy(path),
    minLandmarkSpacing: minRoomSpacing(world, landmarkRooms),
    safeWallCells,
    ungatedDownLiftReachable: reachableLift(world, reachable, LiftDirection.DOWN),
    ungatedUpLiftReachable: reachableLift(world, reachable, LiftDirection.UP),
  };
}

export function generateIstinniyLabirintDesignFloor(): FloorGeneration {
  const world = new World();
  world.wallTex.fill(MAZE_WALL);
  world.floorTex.fill(MAZE_FLOOR);

  const graph = buildGrowingTreeMaze();
  carveMaze(world, graph);
  carveSafeWallRoute(world, graph);
  markMainThread(world, graph);

  const roomsByName = placeLandmarks(world, graph);
  const chordSpecs = selectLockedChords(graph, 8);
  const chords = chordSpecs.map((chord, index) => carveLockedChord(world, chord, index));
  const ownedRooms = placeLabyrinthMidMicro(world, graph, roomsByName);

  const nextContainerId = { v: 1 };
  placeRewardStashes(world, graph, nextContainerId, roomsByName);

  const start = centerOf(graph.start);
  const exit = centerOf(graph.exit);
  placeLift(world, start.x - 3, start.y, LiftDirection.UP);
  placeLift(world, exit.x + 3, exit.y, LiftDirection.DOWN);

  tuneLabyrinthZones(world);
  paintLabyrinthTerritorySeeds(world, ownedRooms);
  ensureConnectivity(world, start.x + 0.5, start.y + 0.5);
  sanitizeDoors(world);
  world.rebuildContainerMap();
  world.bakeLights();

  const entities: Entity[] = [];
  const nextId = { v: 1 };
  placeActors(world, graph, roomsByName, entities, nextId, chords);

  return {
    world,
    entities,
    spawnX: start.x + 0.5,
    spawnY: start.y + 0.5,
  };
}
