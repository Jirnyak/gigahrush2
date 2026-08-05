/* -- Design floor: critical_leak_archive - wet percolation archive -- */

import {
  AIGoal,
  Cell,
  ContainerKind,
  DoorState,
  Faction,
  Feature,
  FloorLevel,
  LiftDirection,
  Occupation,
  QuestType,
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
import { hashSeed } from '../../core/rand';
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { generateZones, sanitizeDoors, stampRoom } from '../shared';
import type { FloorGeneration } from '../floor_manifest';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('critical_leak_archive');

export const CRITICAL_LEAK_ARCHIVE_ROUTE_ID = 'critical_leak_archive' as const;
export const CRITICAL_LEAK_ARCHIVE_Z = 24;
export const CRITICAL_LEAK_ARCHIVE_BASE_FLOOR = FloorLevel.MINISTRY;

export const CRITICAL_LEAK_ARCHIVE_ROOM_NAMES = {
  lobby: 'Сухой лифтовый тамбур критической протечки',
  trade: 'Окно обмена сухих архивных пакетов',
  dryIndex: 'Сухой остров дел постоянного хранения',
  disputedStack: 'Мокрая картотека спорных причин',
  floodgate: 'Пульт архивной водоотсечки',
  shortcut: 'Зараженный водяной короткий ход',
  dryingRoom: 'Комната аварийной просушки',
  witness: 'Стол свидетелей протечки',
} as const;

export interface CriticalLeakArchiveState {
  routeId: typeof CRITICAL_LEAK_ARCHIVE_ROUTE_ID;
  anchorZ: typeof CRITICAL_LEAK_ARCHIVE_Z;
  baseFloor: typeof CRITICAL_LEAK_ARCHIVE_BASE_FLOOR;
  largestComponentCells: number;
  wetCausewayCells: number;
  dryCausewayCells: number;
  bridgesAdded: number;
  contaminatedShortcutCells: number;
  midArchiveBlocks: number;
  microArchiveRooms: number;
  hqAnchorRooms: number;
  hqSupportRooms: number;
  dryPacketContainerIds: number[];
  floodgateContainerId: number;
  debugEntry: {
    spawnX: number;
    spawnY: number;
    summary: string;
  };
}

export interface CriticalLeakArchiveGeneration extends FloorGeneration {
  criticalLeakState: CriticalLeakArchiveState;
}

interface Point {
  x: number;
  y: number;
}

interface PercolationField {
  inLargest: Uint8Array;
  east: Uint8Array;
  south: Uint8Array;
  largestCells: number[];
  centers: Point[];
}

type NextId = { v: number };

interface ArchiveBlockSpec {
  cx: number;
  cy: number;
  cols: number;
  lanes: number;
  wet?: boolean;
  prefix: string;
}

interface FactionHqSpec {
  owner: TerritoryOwner;
  x: number;
  y: number;
  label: string;
  wallTex: Tex;
  floorTex: Tex;
}

interface FactionHqCompound {
  owner: TerritoryOwner;
  core: Room;
  supportRooms: Room[];
}

interface ArchiveExpansionStats {
  blocks: number;
  microRooms: number;
  hqRooms: number;
  supportRooms: number;
  hqCompounds: FactionHqCompound[];
}

const GRID_W = 45;
const GRID_H = 45;
const GRID_STEP = 20;
const GRID_ORIGIN = 72;
const SITE_P = 0.64;
const BOND_P = 0.66;
const WATER_TAGS = ['critical_leak_archive', 'wet_archive', 'contaminated_shortcut'] as const;

const ARCHIVE_ROOM_W = 11;
const ARCHIVE_ROOM_H = 8;
const ARCHIVE_ROOM_GAP = 3;
const ARCHIVE_AISLE_W = 3;
const ARCHIVE_LANE_GAP = 8;

const ARCHIVE_BLOCKS: readonly ArchiveBlockSpec[] = [
  { cx: 150, cy: 130, cols: 7, lanes: 4, prefix: 'Северо-западная сетка сухих причин' },
  { cx: 506, cy: 116, cols: 8, lanes: 4, prefix: 'Северная сетка отсроченных жалоб' },
  { cx: 858, cy: 126, cols: 7, lanes: 4, wet: true, prefix: 'Северо-восточная сетка мокрых актов' },
  { cx: 122, cy: 310, cols: 7, lanes: 4, prefix: 'Левый реестр аварийных писем' },
  { cx: 362, cy: 338, cols: 7, lanes: 4, prefix: 'Сухой карман проверочных листов' },
  { cx: 640, cy: 346, cols: 7, lanes: 4, prefix: 'Поперечный архив причинных скрепок' },
  { cx: 888, cy: 330, cols: 7, lanes: 4, wet: true, prefix: 'Правый мокрый реестр отказов' },
  { cx: 142, cy: 548, cols: 8, lanes: 4, prefix: 'Западная сетка свидетельских копий' },
  { cx: 638, cy: 548, cols: 7, lanes: 4, prefix: 'Средняя сетка водоотсечки' },
  { cx: 888, cy: 590, cols: 7, lanes: 4, wet: true, prefix: 'Восточная сетка зараженных дел' },
  { cx: 138, cy: 782, cols: 7, lanes: 4, prefix: 'Нижний левый архив сухих отметок' },
  { cx: 430, cy: 820, cols: 8, lanes: 4, prefix: 'Нижний центральный архив просушки' },
  { cx: 704, cy: 836, cols: 7, lanes: 4, prefix: 'Нижняя сетка насосных ведомостей' },
  { cx: 900, cy: 830, cols: 7, lanes: 4, wet: true, prefix: 'Нижний правый мокрый каталог' },
] as const;

const ARCHIVE_HQ_SPECS: readonly FactionHqSpec[] = [
  { owner: ZoneFaction.CITIZEN, x: 68, y: 454, label: 'гражданской сухой очереди', wallTex: Tex.PANEL, floorTex: Tex.F_LINO },
  { owner: ZoneFaction.LIQUIDATOR, x: 828, y: 438, label: 'ликвидаторской отсечки', wallTex: Tex.HERMO_WALL, floorTex: Tex.F_CONCRETE },
  { owner: ZoneFaction.CULTIST, x: 824, y: 184, label: 'культа мокрой причины', wallTex: Tex.MARBLE, floorTex: Tex.F_WATER },
  { owner: ZoneFaction.SCIENTIST, x: 552, y: 782, label: 'ученого учета протечки', wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
  { owner: ZoneFaction.WILD, x: 70, y: 820, label: 'дикой сушки трофеев', wallTex: Tex.BRICK, floorTex: Tex.F_CONCRETE },
] as const;

const TARGET_ROUTE = {
  designFloorId: CRITICAL_LEAK_ARCHIVE_ROUTE_ID,
  z: CRITICAL_LEAK_ARCHIVE_Z,
  tags: ['critical_leak_archive', 'wet_archive', 'documents', 'floodgate'],
  label: 'Архив критической протечки',
  risk: 4,
} as const;

const ARCHIVIST_DEF: PlotNpcDef = {
  name: 'Варвара Сухопись',
  isFemale: true,
  faction: Faction.SCIENTIST,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 110, maxHp: 110, money: 84, speed: 0.72,
  inventory: [
    { defId: 'filter_receipt', count: 1 },
    { defId: 'blank_form', count: 2 },
    { defId: 'seal_wax', count: 1 },
  ],
  talkLines: [
    'Сухой пакет несут двумя руками. Мокрый пакет сам несет вас к проверке.',
    'Здесь важна не папка, а путь, по которому она осталась сухой.',
    'Если вода соединила шкафы, значит причина уже почти доказана.',
  ],
  talkLinesPost: [
    'Сухой пакет принят. Теперь у протечки есть причина, а у причины есть номер.',
    'Не кладите сухие бумаги рядом с зараженными. Они начинают спорить чернилами.',
  ],
};

const LIQUIDATOR_DEF: PlotNpcDef = {
  name: 'Егор Отсечка',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 210, maxHp: 210, money: 42, speed: 0.92,
  inventory: [
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 10 },
    { defId: 'decon_fluid', count: 1 },
  ],
  talkLines: [
    'Короткий ход есть. Он мокрый. Умный человек называет это ценой, а не дорогой.',
    'Шлюз поднимете - архив вздохнет. Не поднимете - вода сама найдет форму.',
    'Если пошли через воду, не прячьте перчатки. Их потом находят первыми.',
  ],
  talkLinesPost: [
    'Затвор поднят. Вода ушла ровно настолько, чтобы вернуться без предупреждения.',
    'Пакет сухой, ботинки нет. Для архива это приемлемый баланс.',
  ],
};

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'critical_leak_archivist_varvara', ARCHIVIST_DEF, [
  {
    id: 'critical_leak_carry_dry_packet',
    giverNpcId: 'critical_leak_archivist_varvara',
    type: QuestType.FETCH,
    desc: 'Варвара Сухопись: «Найдете сухую жалобу под сургучом - донесите, не заходя лишний раз в воду. Мокрая причина становится слухом.»',
    targetItem: 'sealed_complaint', targetCount: 1,
    targetFloor: CRITICAL_LEAK_ARCHIVE_BASE_FLOOR,
    targetRoute: TARGET_ROUTE,
    targetRoomName: CRITICAL_LEAK_ARCHIVE_ROOM_NAMES.dryIndex,
    targetHint: 'сухой пакет лежит на архивном острове; водяной короткий ход быстрее, но заражает маршрут',
    rewardItem: 'filter_receipt', rewardCount: 1,
    extraRewards: [{ defId: 'blank_form', count: 2 }],
    relationDelta: 10, xpReward: 55, moneyReward: 38,
    eventTargetName: 'Сухой архивный пакет вынесен из критической протечки.',
    eventTags: ['critical_leak_archive', 'dry_packet', 'documents', 'trade'],
    eventData: { routeId: CRITICAL_LEAK_ARCHIVE_ROUTE_ID, outcome: 'dry_packet_saved' },
    eventSeverity: 3,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'critical_leak_liquidator_egor', LIQUIDATOR_DEF, [
  {
    id: 'critical_leak_raise_floodgate',
    giverNpcId: 'critical_leak_liquidator_egor',
    type: QuestType.VISIT,
    desc: 'Егор Отсечка: «Дойдите до пульта водоотсечки. Шлюз не спасет архив, но даст сухой край для отхода.»',
    targetFloor: CRITICAL_LEAK_ARCHIVE_BASE_FLOOR,
    targetRoute: TARGET_ROUTE,
    targetRoomName: CRITICAL_LEAK_ARCHIVE_ROOM_NAMES.floodgate,
    targetHint: 'пульт стоит за зараженным водяным коротким ходом и сухой обходной перемычкой',
    rewardItem: 'decon_fluid', rewardCount: 1,
    relationDelta: 8, xpReward: 45, moneyReward: 24,
    eventTargetName: 'Пульт архивной водоотсечки проверен; вода получила временный край.',
    eventTags: ['critical_leak_archive', 'floodgate', 'water', 'shortcut'],
    eventData: { routeId: CRITICAL_LEAK_ARCHIVE_ROUTE_ID, floodgateRaised: true },
    eventSeverity: 4,
  },
  {
    id: 'critical_leak_trade_contaminated_proof',
    giverNpcId: 'critical_leak_liquidator_egor',
    type: QuestType.FETCH,
    desc: 'Егор Отсечка: «Если полезете коротким ходом, принесите мазок воды. Без пробы все скажут, что вы просто намочили сапоги.»',
    targetItem: 'contaminated_swab', targetCount: 1,
    targetFloor: CRITICAL_LEAK_ARCHIVE_BASE_FLOOR,
    targetRoute: TARGET_ROUTE,
    targetRoomName: CRITICAL_LEAK_ARCHIVE_ROOM_NAMES.shortcut,
    rewardItem: 'wet_rag_bundle', rewardCount: 1,
    extraRewards: [{ defId: 'decon_fluid', count: 1 }],
    relationDelta: 6, xpReward: 48, moneyReward: 28,
    eventTargetName: 'Проба зараженной воды из архивного короткого хода сдана ликвидатору.',
    eventTags: ['critical_leak_archive', 'contaminated_shortcut', 'water_sample', 'liquidator'],
    eventData: { routeId: CRITICAL_LEAK_ARCHIVE_ROUTE_ID, shortcutEvidence: true },
    eventSeverity: 3,
  },
]);

function gridIndex(gx: number, gy: number): number {
  return gy * GRID_W + gx;
}

function gridCenter(gx: number, gy: number): Point {
  return {
    x: GRID_ORIGIN + gx * GRID_STEP + (GRID_STEP >> 1),
    y: GRID_ORIGIN + gy * GRID_STEP + (GRID_STEP >> 1),
  };
}

function rand01(seed: number, i: number, salt: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(i ^ 0xc2b2ae35, 0x27d4eb2d) + salt;
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  x = Math.imul(x, 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 0x100000000;
}

function buildPercolationField(seed: number): PercolationField {
  const open = new Uint8Array(GRID_W * GRID_H);
  const east = new Uint8Array(GRID_W * GRID_H);
  const south = new Uint8Array(GRID_W * GRID_H);

  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const i = gridIndex(gx, gy);
      const centralLeak = Math.abs(gx - 22) <= 2 || Math.abs(gy - 22) <= 2;
      const archiveBias = gx > 7 && gx < 38 && gy > 7 && gy < 38 ? 0.026 : -0.018;
      open[i] = rand01(seed, i, 11) < SITE_P + archiveBias + (centralLeak ? 0.035 : 0) ? 1 : 0;
    }
  }

  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const i = gridIndex(gx, gy);
      if (!open[i]) continue;
      if (gx + 1 < GRID_W && open[gridIndex(gx + 1, gy)]) {
        east[i] = rand01(seed, i, 23) < BOND_P + (Math.abs(gy - 22) <= 2 ? 0.07 : 0) ? 1 : 0;
      }
      if (gy + 1 < GRID_H && open[gridIndex(gx, gy + 1)]) {
        south[i] = rand01(seed, i, 37) < BOND_P + (Math.abs(gx - 22) <= 2 ? 0.07 : 0) ? 1 : 0;
      }
    }
  }

  const largestCells = largestBondComponent(open, east, south);
  const inLargest = new Uint8Array(GRID_W * GRID_H);
  for (const i of largestCells) inLargest[i] = 1;
  const centers = largestCells.map(i => gridCenter(i % GRID_W, Math.floor(i / GRID_W)));
  return { inLargest, east, south, largestCells, centers };
}

function largestBondComponent(open: Uint8Array, east: Uint8Array, south: Uint8Array): number[] {
  const seen = new Uint8Array(GRID_W * GRID_H);
  const queue = new Int32Array(GRID_W * GRID_H);
  let best: number[] = [];

  for (let start = 0; start < open.length; start++) {
    if (!open[start] || seen[start]) continue;
    const current: number[] = [];
    let head = 0;
    let tail = 0;
    seen[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const i = queue[head++];
      current.push(i);
      const gx = i % GRID_W;
      const gy = Math.floor(i / GRID_W);
      const candidates: number[] = [];
      if (gx + 1 < GRID_W && east[i]) candidates.push(gridIndex(gx + 1, gy));
      if (gx > 0 && east[gridIndex(gx - 1, gy)]) candidates.push(gridIndex(gx - 1, gy));
      if (gy + 1 < GRID_H && south[i]) candidates.push(gridIndex(gx, gy + 1));
      if (gy > 0 && south[gridIndex(gx, gy - 1)]) candidates.push(gridIndex(gx, gy - 1));
      for (const next of candidates) {
        if (!open[next] || seen[next]) continue;
        seen[next] = 1;
        queue[tail++] = next;
      }
    }
    if (current.length > best.length) best = current;
  }

  return best;
}

function wetNode(seed: number, i: number): boolean {
  return rand01(seed, i, 401) < 0.47;
}

function carveDisc(
  world: World,
  cx: number,
  cy: number,
  radius: number,
  cell: Cell.FLOOR | Cell.WATER,
  state: CriticalLeakArchiveState,
): void {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = world.wrap(cx + dx);
      const y = world.wrap(cy + dy);
      const idx = world.idx(x, y);
      if (world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.DOOR) continue;
      world.cells[idx] = cell;
      world.roomMap[idx] = -1;
      world.floorTex[idx] = cell === Cell.WATER ? Tex.F_WATER : Tex.F_MARBLE_TILE;
      world.wallTex[idx] = Tex.MARBLE;
      world.features[idx] = Feature.NONE;
      if (cell === Cell.WATER) state.wetCausewayCells++;
      else state.dryCausewayCells++;
    }
  }
}

function carveLine(
  world: World,
  a: Point,
  b: Point,
  radius: number,
  cell: Cell.FLOOR | Cell.WATER,
  state: CriticalLeakArchiveState,
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.max(1, Math.abs(dx), Math.abs(dy));
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    carveDisc(
      world,
      Math.round(a.x + dx * t),
      Math.round(a.y + dy * t),
      radius,
      cell,
      state,
    );
  }
}

function carveBentBridge(
  world: World,
  a: Point,
  b: Point,
  cell: Cell.FLOOR | Cell.WATER,
  state: CriticalLeakArchiveState,
): void {
  const mid: Point = Math.abs(a.x - b.x) > Math.abs(a.y - b.y)
    ? { x: b.x, y: a.y }
    : { x: a.x, y: b.y };
  carveLine(world, a, mid, cell === Cell.WATER ? 2 : 1, cell, state);
  carveLine(world, mid, b, cell === Cell.WATER ? 2 : 1, cell, state);
  state.bridgesAdded++;
}

function carvePercolationComponent(world: World, field: PercolationField, seed: number, state: CriticalLeakArchiveState): void {
  for (const i of field.largestCells) {
    const p = gridCenter(i % GRID_W, Math.floor(i / GRID_W));
    carveDisc(world, p.x, p.y, wetNode(seed, i) ? 2 : 1, wetNode(seed, i) ? Cell.WATER : Cell.FLOOR, state);
  }

  for (const i of field.largestCells) {
    const gx = i % GRID_W;
    const gy = Math.floor(i / GRID_W);
    const p = gridCenter(gx, gy);
    if (gx + 1 < GRID_W && field.east[i] && field.inLargest[gridIndex(gx + 1, gy)]) {
      const next = gridCenter(gx + 1, gy);
      carveLine(world, p, next, 1, wetNode(seed, i) || wetNode(seed, gridIndex(gx + 1, gy)) ? Cell.WATER : Cell.FLOOR, state);
    }
    if (gy + 1 < GRID_H && field.south[i] && field.inLargest[gridIndex(gx, gy + 1)]) {
      const next = gridCenter(gx, gy + 1);
      carveLine(world, p, next, 1, wetNode(seed, i) || wetNode(seed, gridIndex(gx, gy + 1)) ? Cell.WATER : Cell.FLOOR, state);
    }
  }
}

function nearestComponentCenter(world: World, from: Point, centers: readonly Point[]): Point {
  let best = centers[0] ?? { x: W >> 1, y: W >> 1 };
  let bestD2 = Number.POSITIVE_INFINITY;
  for (const center of centers) {
    const d2 = world.dist2(from.x, from.y, center.x, center.y);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = center;
    }
  }
  return best;
}

function stampNamedRoom(
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
  for (let yy = y - 1; yy <= y + h; yy++) {
    for (let xx = x - 1; xx <= x + w; xx++) {
      const idx = world.idx(xx, yy);
      if (world.roomMap[idx] === room.id) {
        world.floorTex[idx] = floorTex;
      } else if (world.cells[idx] === Cell.WALL) {
        world.wallTex[idx] = wallTex;
      }
    }
  }
  return room;
}

function addDoor(world: World, room: Room, side: 'north' | 'south' | 'west' | 'east', offset: number, state = DoorState.CLOSED): Point {
  const wx = side === 'west' ? room.x - 1 : side === 'east' ? room.x + room.w : room.x + offset;
  const wy = side === 'north' ? room.y - 1 : side === 'south' ? room.y + room.h : room.y + offset;
  const idx = world.idx(wx, wy);
  world.cells[idx] = Cell.DOOR;
  world.wallTex[idx] = Tex.DOOR_METAL;
  world.doors.set(idx, { idx, state, roomA: room.id, roomB: -1, keyId: '', timer: 0 });
  room.doors.push(idx);
  if (side === 'north') return { x: world.wrap(wx), y: world.wrap(wy - 1) };
  if (side === 'south') return { x: world.wrap(wx), y: world.wrap(wy + 1) };
  if (side === 'west') return { x: world.wrap(wx - 1), y: world.wrap(wy) };
  return { x: world.wrap(wx + 1), y: world.wrap(wy) };
}

function canStampArchiveRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  if (x < 2 || y < 2 || x + w + 2 >= W || y + h + 2 >= W) return false;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const idx = world.idx(x + dx, y + dy);
      if (world.cells[idx] !== Cell.WALL || world.aptMask[idx]) return false;
    }
  }
  return true;
}

function stampArchiveRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
): Room | null {
  const rx = Math.round(x);
  const ry = Math.round(y);
  if (!canStampArchiveRoom(world, rx, ry, w, h)) return null;
  return stampNamedRoom(world, type, rx, ry, w, h, name, wallTex, floorTex);
}

function carveArchiveCell(
  world: World,
  x: number,
  y: number,
  cell: Cell.FLOOR | Cell.WATER,
  floorTex: Tex,
  wallTex = Tex.MARBLE,
): void {
  const idx = world.idx(x, y);
  if (world.aptMask[idx] || world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.DOOR) return;
  if (world.roomMap[idx] >= 0) return;
  world.cells[idx] = cell;
  world.roomMap[idx] = -1;
  world.floorTex[idx] = cell === Cell.WATER ? Tex.F_WATER : floorTex;
  world.wallTex[idx] = wallTex;
  world.hermoWall[idx] = 0;
  if (world.features[idx] !== Feature.LIFT_BUTTON) world.features[idx] = Feature.NONE;
}

function carveArchiveRect(
  world: World,
  x: number,
  y: number,
  w: number,
  h: number,
  cell: Cell.FLOOR | Cell.WATER,
  floorTex: Tex,
  wallTex = Tex.MARBLE,
): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) carveArchiveCell(world, xx, yy, cell, floorTex, wallTex);
  }
}

function carveArchiveLine(
  world: World,
  a: Point,
  b: Point,
  radius: number,
  cell: Cell.FLOOR | Cell.WATER,
  floorTex: Tex,
  wallTex = Tex.MARBLE,
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.max(1, Math.abs(dx), Math.abs(dy));
  const r2 = radius * radius;
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const x = Math.round(a.x + dx * t);
    const y = Math.round(a.y + dy * t);
    for (let yy = -radius; yy <= radius; yy++) {
      for (let xx = -radius; xx <= radius; xx++) {
        if (xx * xx + yy * yy > r2) continue;
        carveArchiveCell(world, x + xx, y + yy, cell, floorTex, wallTex);
      }
    }
  }
}

function carveArchiveBentRoute(
  world: World,
  a: Point,
  b: Point,
  radius: number,
  cell: Cell.FLOOR | Cell.WATER,
  floorTex: Tex,
  wallTex = Tex.MARBLE,
): void {
  const mid: Point = Math.abs(world.delta(a.x, b.x)) > Math.abs(world.delta(a.y, b.y))
    ? { x: b.x, y: a.y }
    : { x: a.x, y: b.y };
  carveArchiveLine(world, a, mid, radius, cell, floorTex, wallTex);
  carveArchiveLine(world, mid, b, radius, cell, floorTex, wallTex);
}

function archiveMicroRoomType(serial: number): RoomType {
  switch (serial % 12) {
    case 0: return RoomType.OFFICE;
    case 1: return RoomType.BATHROOM;
    case 2: return RoomType.KITCHEN;
    case 3: return RoomType.COMMON;
    case 4: return RoomType.MEDICAL;
    default: return RoomType.STORAGE;
  }
}

function decorateMicroArchiveRoom(world: World, room: Room, serial: number): void {
  if (room.type === RoomType.BATHROOM) {
    setFeature(world, room.x + 2, room.y + 2, Feature.SINK);
    setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.TOILET);
    return;
  }
  if (room.type === RoomType.KITCHEN) {
    setFeature(world, room.x + 2, room.y + 2, Feature.STOVE);
    setFeature(world, room.x + room.w - 3, room.y + 2, Feature.SINK);
    setFeature(world, room.x + (room.w >> 1), room.y + room.h - 3, Feature.TABLE);
    return;
  }
  if (room.type === RoomType.OFFICE || room.type === RoomType.MEDICAL) {
    setFeature(world, room.x + 2, room.y + 2, Feature.DESK);
    setFeature(world, room.x + room.w - 3, room.y + 2, serial % 2 === 0 ? Feature.SCREEN : Feature.APPARATUS);
    setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.SHELF);
    return;
  }
  for (let x = room.x + 2; x < room.x + room.w - 2; x += 3) {
    setFeature(world, x, room.y + 2, Feature.SHELF);
    if (room.h > 6) setFeature(world, x, room.y + room.h - 3, serial % 5 === 0 ? Feature.TABLE : Feature.SHELF);
  }
  if (serial % 7 === 0) setFeature(world, room.x + room.w - 3, room.y + 2, Feature.LAMP);
}

function paintRoomTerritory(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      world.factionControl[world.idx(room.x + dx, room.y + dy)] = owner;
    }
  }
}

function markHermeticRoomShell(world: World, room: Room): void {
  room.sealed = true;
  room.wallTex = Tex.HERMO_WALL;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const border = dx < 0 || dx >= room.w || dy < 0 || dy >= room.h;
      if (!border) continue;
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.cells[idx] !== Cell.WALL || world.aptMask[idx]) continue;
      world.hermoWall[idx] = 1;
      world.wallTex[idx] = Tex.HERMO_WALL;
    }
  }
}

function connectPointToField(world: World, field: PercolationField, point: Point, wet: boolean, floorTex: Tex): void {
  const target = nearestComponentCenter(world, point, field.centers);
  carveArchiveBentRoute(world, point, target, wet ? 1 : 0, wet ? Cell.WATER : Cell.FLOOR, floorTex);
}

function stampArchiveBlock(world: World, field: PercolationField, spec: ArchiveBlockSpec, serialBase: number): { rooms: Room[]; placed: boolean } {
  const rooms: Room[] = [];
  const stride = ARCHIVE_ROOM_W + ARCHIVE_ROOM_GAP;
  const width = spec.cols * ARCHIVE_ROOM_W + (spec.cols - 1) * ARCHIVE_ROOM_GAP;
  const laneSpan = ARCHIVE_ROOM_H * 2 + ARCHIVE_AISLE_W;
  const height = spec.lanes * laneSpan + (spec.lanes - 1) * ARCHIVE_LANE_GAP;
  const left = Math.round(spec.cx - width / 2);
  const top = Math.round(spec.cy - height / 2);
  const aisleCell = spec.wet ? Cell.WATER : Cell.FLOOR;
  const aisleTex = spec.wet ? Tex.F_WATER : Tex.F_MARBLE_TILE;
  let firstAisle: Point | null = null;
  let previousAisleY = -1;

  for (let lane = 0; lane < spec.lanes; lane++) {
    const laneTop = top + lane * (laneSpan + ARCHIVE_LANE_GAP);
    const aisleY = laneTop + ARCHIVE_ROOM_H + 1;
    firstAisle ??= { x: spec.cx, y: aisleY };
    carveArchiveRect(world, left - 4, aisleY, width + 8, 1, aisleCell, aisleTex);
    if (previousAisleY >= 0) {
      carveArchiveLine(world, { x: left - 2, y: previousAisleY }, { x: left - 2, y: aisleY }, 0, aisleCell, aisleTex);
      carveArchiveLine(world, { x: left + width + 1, y: previousAisleY }, { x: left + width + 1, y: aisleY }, 0, aisleCell, aisleTex);
    }
    previousAisleY = aisleY;

    for (let col = 0; col < spec.cols; col++) {
      const roomX = left + col * stride;
      const topRoomY = aisleY - 1 - ARCHIVE_ROOM_H;
      const bottomRoomY = aisleY + ARCHIVE_AISLE_W - 1;
      for (const [roomY, side, rowTag] of [
        [topRoomY, 'south', 'верхняя'],
        [bottomRoomY, 'north', 'нижняя'],
      ] as const) {
        const serial = serialBase + rooms.length + lane * 31 + col * 7 + (rowTag === 'нижняя' ? 3 : 0);
        const room = stampArchiveRoom(
          world,
          archiveMicroRoomType(serial),
          roomX,
          roomY,
          ARCHIVE_ROOM_W,
          ARCHIVE_ROOM_H,
          `${spec.prefix}: ${rowTag} ячейка ${lane + 1}.${col + 1}`,
          spec.wet ? Tex.TILE_W : Tex.MARBLE,
          spec.wet && serial % 4 === 0 ? Tex.F_WATER : Tex.F_PARQUET,
        );
        if (!room) continue;
        addDoor(world, room, side, Math.floor(room.w / 2));
        decorateMicroArchiveRoom(world, room, serial);
        rooms.push(room);
      }
    }
  }

  if (firstAisle) {
    const target = nearestComponentCenter(world, firstAisle, field.centers);
    const exitX = world.delta(firstAisle.x, target.x) < 0 ? left - 6 : left + width + 6;
    carveArchiveLine(world, firstAisle, { x: exitX, y: firstAisle.y }, 1, aisleCell, aisleTex);
    connectPointToField(world, field, { x: exitX, y: firstAisle.y }, !!spec.wet, aisleTex);
  }

  return { rooms, placed: rooms.length > 0 };
}

function hqOwnerName(owner: TerritoryOwner): string {
  switch (owner) {
    case ZoneFaction.LIQUIDATOR: return 'ликвидаторов';
    case ZoneFaction.CULTIST: return 'культистов';
    case ZoneFaction.SCIENTIST: return 'ученых';
    case ZoneFaction.WILD: return 'диких';
    case ZoneFaction.CITIZEN:
    default: return 'граждан';
  }
}

function decorateHqSupportRoom(world: World, room: Room): void {
  if (room.type === RoomType.KITCHEN) {
    setFeature(world, room.x + 2, room.y + 2, Feature.STOVE);
    setFeature(world, room.x + room.w - 3, room.y + 2, Feature.SINK);
    setFeature(world, room.x + 4, room.y + room.h - 3, Feature.TABLE);
  } else if (room.type === RoomType.BATHROOM) {
    setFeature(world, room.x + 2, room.y + 2, Feature.SINK);
    setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.TOILET);
  } else if (room.type === RoomType.MEDICAL) {
    setFeature(world, room.x + 2, room.y + 2, Feature.APPARATUS);
    setFeature(world, room.x + room.w - 3, room.y + 2, Feature.DESK);
  } else if (room.type === RoomType.OFFICE) {
    setFeature(world, room.x + 2, room.y + 2, Feature.DESK);
    setFeature(world, room.x + room.w - 3, room.y + 2, Feature.SCREEN);
  } else {
    for (let x = room.x + 2; x < room.x + room.w - 2; x += 3) setFeature(world, x, room.y + 2, Feature.SHELF);
  }
  setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.LAMP);
}

function stampFactionHqCompound(world: World, field: PercolationField, spec: FactionHqSpec): FactionHqCompound | null {
  const attempts: readonly Point[] = [
    { x: spec.x, y: spec.y },
    { x: spec.x + 18, y: spec.y },
    { x: spec.x - 18, y: spec.y + 18 },
    { x: spec.x, y: spec.y - 18 },
  ];
  for (const attempt of attempts) {
    const core = stampArchiveRoom(
      world,
      RoomType.HQ,
      attempt.x,
      attempt.y,
      24,
      16,
      `Штаб ${spec.label}`,
      spec.wallTex,
      spec.floorTex,
    );
    if (!core) continue;
    markHermeticRoomShell(world, core);
    setFeature(world, core.x + 4, core.y + 3, Feature.DESK);
    setFeature(world, core.x + core.w - 5, core.y + 3, Feature.SCREEN);
    setFeature(world, core.x + core.w - 5, core.y + core.h - 4, Feature.LAMP);

    const supportRooms: Room[] = [];
    const supportSpecs = [
      { type: RoomType.KITCHEN, x: core.x - 20, y: core.y + 1, w: 14, h: 9, side: 'east' as const, name: 'кухня' },
      { type: RoomType.BATHROOM, x: core.x - 18, y: core.y + 14, w: 12, h: 8, side: 'east' as const, name: 'санузел' },
      { type: RoomType.STORAGE, x: core.x + core.w + 6, y: core.y + 1, w: 15, h: 9, side: 'west' as const, name: 'кладовая' },
      { type: spec.owner === ZoneFaction.SCIENTIST ? RoomType.MEDICAL : RoomType.OFFICE, x: core.x + core.w + 6, y: core.y + 14, w: 16, h: 9, side: 'west' as const, name: spec.owner === ZoneFaction.SCIENTIST ? 'медпункт' : 'кабинет' },
    ];
    for (const support of supportSpecs) {
      const room = stampArchiveRoom(
        world,
        support.type,
        support.x,
        support.y,
        support.w,
        support.h,
        `Опора ${hqOwnerName(spec.owner)}: ${support.name}`,
        spec.wallTex,
        support.type === RoomType.BATHROOM ? Tex.F_TILE : spec.floorTex,
      );
      if (!room) continue;
      const exit = addDoor(world, room, support.side, Math.floor(room.h / 2));
      carveArchiveLine(world, exit, { x: core.x + (core.w >> 1), y: exit.y }, 0, Cell.FLOOR, spec.floorTex, spec.wallTex);
      decorateHqSupportRoom(world, room);
      supportRooms.push(room);
    }

    const coreExit = addDoor(world, core, 'south', Math.floor(core.w / 2), DoorState.HERMETIC_CLOSED);
    carveArchiveLine(world, coreExit, { x: coreExit.x, y: coreExit.y + 5 }, 1, Cell.FLOOR, spec.floorTex, spec.wallTex);
    connectPointToField(world, field, { x: coreExit.x, y: coreExit.y + 5 }, spec.floorTex === Tex.F_WATER, spec.floorTex);
    return { owner: spec.owner, core, supportRooms };
  }
  return null;
}

function expandArchiveMidAndMicro(world: World, field: PercolationField): ArchiveExpansionStats {
  const hqCompounds: FactionHqCompound[] = [];
  for (const spec of ARCHIVE_HQ_SPECS) {
    const hq = stampFactionHqCompound(world, field, spec);
    if (hq) hqCompounds.push(hq);
  }

  let blocks = 0;
  let microRooms = 0;
  for (let i = 0; i < ARCHIVE_BLOCKS.length; i++) {
    const result = stampArchiveBlock(world, field, ARCHIVE_BLOCKS[i], i * 101);
    if (result.placed) blocks++;
    microRooms += result.rooms.length;
  }

  return {
    blocks,
    microRooms,
    hqRooms: hqCompounds.length,
    supportRooms: hqCompounds.reduce((sum, hq) => sum + hq.supportRooms.length, 0),
    hqCompounds,
  };
}

function paintCriticalLeakHqTerritory(world: World, compounds: readonly FactionHqCompound[]): void {
  for (const compound of compounds) {
    paintRoomTerritory(world, compound.core, compound.owner);
    for (const room of compound.supportRooms) paintRoomTerritory(world, room, compound.owner);
  }
}

function placeLift(world: World, x: number, y: number, buttonX: number, buttonY: number, direction: LiftDirection): void {
  const liftIdx = world.idx(x, y);
  world.cells[liftIdx] = Cell.LIFT;
  world.wallTex[liftIdx] = Tex.LIFT_DOOR;
  world.roomMap[liftIdx] = -1;
  world.liftDir[liftIdx] = direction;
  const buttonIdx = world.idx(buttonX, buttonY);
  if (world.cells[buttonIdx] === Cell.FLOOR) world.features[buttonIdx] = Feature.LIFT_BUTTON;
  world.liftDir[buttonIdx] = direction;
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const idx = world.idx(x, y);
  if (world.cells[idx] === Cell.FLOOR || world.cells[idx] === Cell.WATER) world.features[idx] = feature;
}

function nextContainerId(world: World): number {
  let id = 1;
  for (const container of world.containers) id = Math.max(id, container.id + 1);
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
  inventory: readonly Item[],
  tags: readonly string[],
  lockDifficulty?: number,
): WorldContainer {
  const container: WorldContainer = {
    id: nextContainerId(world),
    x,
    y,
    floor: CRITICAL_LEAK_ARCHIVE_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind,
    name,
    inventory: inventory.map(item => ({ ...item })),
    capacitySlots: Math.max(8, inventory.length + 5),
    faction: tags.includes('liquidator') ? Faction.LIQUIDATOR : Faction.SCIENTIST,
    access,
    lockDifficulty,
    discovered: true,
    tags: [CRITICAL_LEAK_ARCHIVE_ROUTE_ID, ...tags],
  };
  world.addContainer(container);
  setFeature(world, x, y, kind === ContainerKind.EMERGENCY_BOX ? Feature.APPARATUS : Feature.SHELF);
  return container;
}

function decorateArchiveRooms(world: World, rooms: Record<keyof typeof CRITICAL_LEAK_ARCHIVE_ROOM_NAMES, Room>): void {
  for (const room of [rooms.dryIndex, rooms.disputedStack]) {
    for (let y = room.y + 3; y < room.y + room.h - 2; y += 4) {
      for (let x = room.x + 3; x < room.x + room.w - 3; x++) {
        if ((x - room.x) % 9 === 0) continue;
        setFeature(world, x, y, Feature.SHELF);
      }
    }
  }
  for (let x = rooms.trade.x + 3; x < rooms.trade.x + rooms.trade.w - 3; x += 6) {
    setFeature(world, x, rooms.trade.y + 4, Feature.DESK);
  }
  for (const room of Object.values(rooms)) {
    setFeature(world, room.x + room.w - 3, room.y + 2, Feature.LAMP);
  }
  setFeature(world, rooms.floodgate.x + 6, rooms.floodgate.y + 5, Feature.APPARATUS);
  setFeature(world, rooms.floodgate.x + 12, rooms.floodgate.y + 5, Feature.SCREEN);
  setFeature(world, rooms.shortcut.x + 5, rooms.shortcut.y + 4, Feature.SINK);
  setFeature(world, rooms.dryingRoom.x + 5, rooms.dryingRoom.y + 5, Feature.MACHINE);
}

function spawnLeakNpc(
  entities: Entity[],
  nextId: NextId,
  _def: PlotNpcDef,
  plotNpcId: string,
  x: number,
  y: number,
  weapon?: string,
): Entity {
  return requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle: 0,
    canGiveQuest: true,
    weapon,
    aiTarget: { x, y },
    extra: {
      ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    },
  });
}

function carveContaminatedShortcut(world: World, from: Point, to: Point, state: CriticalLeakArchiveState): void {
  const before = state.wetCausewayCells;
  carveBentBridge(world, from, { x: 750, y: 524 }, Cell.WATER, state);
  carveBentBridge(world, { x: 750, y: 524 }, to, Cell.WATER, state);
  state.contaminatedShortcutCells += state.wetCausewayCells - before;
}

function connectAnchors(
  world: World,
  field: PercolationField,
  anchors: readonly { point: Point; wet?: boolean }[],
  state: CriticalLeakArchiveState,
): void {
  for (const anchor of anchors) {
    carveBentBridge(
      world,
      anchor.point,
      nearestComponentCenter(world, anchor.point, field.centers),
      anchor.wet ? Cell.WATER : Cell.FLOOR,
      state,
    );
  }

  carveBentBridge(world, { x: 512, y: 512 }, { x: 0, y: 512 }, Cell.FLOOR, state);
  carveBentBridge(world, { x: 512, y: 512 }, { x: W - 1, y: 512 }, Cell.WATER, state);
  carveBentBridge(world, { x: 512, y: 512 }, { x: 512, y: 0 }, Cell.FLOOR, state);
  carveBentBridge(world, { x: 512, y: 512 }, { x: 512, y: W - 1 }, Cell.WATER, state);
}

function buildRooms(world: World): Record<keyof typeof CRITICAL_LEAK_ARCHIVE_ROOM_NAMES, Room> {
  return {
    lobby: stampNamedRoom(world, RoomType.COMMON, 488, 486, 50, 34, CRITICAL_LEAK_ARCHIVE_ROOM_NAMES.lobby, Tex.MARBLE, Tex.F_MARBLE_TILE),
    trade: stampNamedRoom(world, RoomType.OFFICE, 374, 486, 72, 30, CRITICAL_LEAK_ARCHIVE_ROOM_NAMES.trade, Tex.MARBLE, Tex.F_PARQUET),
    dryIndex: stampNamedRoom(world, RoomType.STORAGE, 230, 196, 76, 44, CRITICAL_LEAK_ARCHIVE_ROOM_NAMES.dryIndex, Tex.MARBLE, Tex.F_PARQUET),
    disputedStack: stampNamedRoom(world, RoomType.STORAGE, 706, 212, 70, 48, CRITICAL_LEAK_ARCHIVE_ROOM_NAMES.disputedStack, Tex.MARBLE, Tex.F_WATER),
    floodgate: stampNamedRoom(world, RoomType.PRODUCTION, 594, 698, 66, 34, CRITICAL_LEAK_ARCHIVE_ROOM_NAMES.floodgate, Tex.METAL, Tex.F_CONCRETE),
    shortcut: stampNamedRoom(world, RoomType.BATHROOM, 752, 494, 72, 34, CRITICAL_LEAK_ARCHIVE_ROOM_NAMES.shortcut, Tex.TILE_W, Tex.F_WATER),
    dryingRoom: stampNamedRoom(world, RoomType.PRODUCTION, 292, 698, 70, 38, CRITICAL_LEAK_ARCHIVE_ROOM_NAMES.dryingRoom, Tex.METAL, Tex.F_CONCRETE),
    witness: stampNamedRoom(world, RoomType.COMMON, 454, 318, 84, 30, CRITICAL_LEAK_ARCHIVE_ROOM_NAMES.witness, Tex.MARBLE, Tex.F_GREEN_CARPET),
  };
}

function populateContainers(world: World, rooms: Record<keyof typeof CRITICAL_LEAK_ARCHIVE_ROOM_NAMES, Room>, state: CriticalLeakArchiveState): void {
  const dryA = addContainer(
    world,
    rooms.dryIndex,
    rooms.dryIndex.x + rooms.dryIndex.w - 8,
    rooms.dryIndex.y + 8,
    ContainerKind.FILING_CABINET,
    'Сухой пакет причины протечки',
    'locked',
    [
      { defId: 'sealed_complaint', count: 1 },
      { defId: 'blank_form', count: 2 },
      { defId: 'seal_wax', count: 1 },
    ],
    ['dry_archive_packet', 'documents', 'carry_dry_documents', 'trade'],
    3,
  );
  const dryB = addContainer(
    world,
    rooms.witness,
    rooms.witness.x + rooms.witness.w - 7,
    rooms.witness.y + 7,
    ContainerKind.FILING_CABINET,
    'Копии свидетельских сухих листов',
    'room',
    [
      { defId: 'sealed_complaint', count: 1 },
      { defId: 'emergency_roster', count: 1 },
    ],
    ['dry_archive_packet', 'witness', 'documents', 'public_trade'],
  );
  addContainer(
    world,
    rooms.shortcut,
    rooms.shortcut.x + rooms.shortcut.w - 8,
    rooms.shortcut.y + 8,
    ContainerKind.EMERGENCY_BOX,
    'Ящик проб зараженного короткого хода',
    'public',
    [
      { defId: 'contaminated_swab', count: 1 },
      { defId: 'wet_rag_bundle', count: 1 },
    ],
    [...WATER_TAGS, 'sample', 'shortcut_risk'],
  );
  const floodgate = addContainer(
    world,
    rooms.floodgate,
    rooms.floodgate.x + 8,
    rooms.floodgate.y + 7,
    ContainerKind.TOOL_LOCKER,
    'Пломбированный шкаф водоотсечки',
    'faction',
    [
      { defId: 'valve_tag', count: 1 },
      { defId: 'decon_fluid', count: 1 },
      { defId: 'filter_receipt', count: 1 },
    ],
    ['floodgate_control', 'raise_floodgate', 'liquidator', 'water'],
    4,
  );
  addContainer(
    world,
    rooms.dryingRoom,
    rooms.dryingRoom.x + rooms.dryingRoom.w - 8,
    rooms.dryingRoom.y + 9,
    ContainerKind.TOOL_LOCKER,
    'Ремонтный ящик аварийной просушки',
    'room',
    [
      { defId: 'cloth_roll', count: 1 },
      { defId: 'wet_rag_bundle', count: 1 },
      { defId: 'filter_receipt', count: 1 },
    ],
    ['drying_room', 'counterplay', 'water'],
  );
  state.dryPacketContainerIds.push(dryA.id, dryB.id);
  state.floodgateContainerId = floodgate.id;
}

function tuneInitialZones(world: World): void {
  generateZones(world);
  for (const zone of world.zones) {
    const wetEast = zone.cx > 600 || zone.cy > 620;
    zone.faction = wetEast ? ZoneFaction.LIQUIDATOR : ZoneFaction.CITIZEN;
    zone.level = wetEast ? 4 : 3;
    zone.fogged = false;
  }
  for (let i = 0; i < W * W; i++) {
    const zone = world.zones[world.zoneMap[i]];
    world.factionControl[i] = zone?.faction ?? ZoneFaction.CITIZEN;
  }
}

export function generateCriticalLeakArchiveDesignFloor(): CriticalLeakArchiveGeneration {
  const world = new World();
  const entities: Entity[] = [];
  const nextId: NextId = { v: 1 };
  const seed = hashSeed('design-floor:critical-leak-archive:percolation', CRITICAL_LEAK_ARCHIVE_Z);
  const state: CriticalLeakArchiveState = {
    routeId: CRITICAL_LEAK_ARCHIVE_ROUTE_ID,
    anchorZ: CRITICAL_LEAK_ARCHIVE_Z,
    baseFloor: CRITICAL_LEAK_ARCHIVE_BASE_FLOOR,
    largestComponentCells: 0,
    wetCausewayCells: 0,
    dryCausewayCells: 0,
    bridgesAdded: 0,
    contaminatedShortcutCells: 0,
    midArchiveBlocks: 0,
    microArchiveRooms: 0,
    hqAnchorRooms: 0,
    hqSupportRooms: 0,
    dryPacketContainerIds: [],
    floodgateContainerId: -1,
    debugEntry: {
      spawnX: 512.5,
      spawnY: 502.5,
      summary: 'critical leak archive pending',
    },
  };

  const field = buildPercolationField(seed);
  state.largestComponentCells = field.largestCells.length;
  carvePercolationComponent(world, field, seed, state);

  const rooms = buildRooms(world);
  const lobbyNorth = addDoor(world, rooms.lobby, 'north', 25);
  const lobbyWest = addDoor(world, rooms.lobby, 'west', 18);
  const tradeEast = addDoor(world, rooms.trade, 'east', 16);
  const drySouth = addDoor(world, rooms.dryIndex, 'south', 34);
  const disputedSouth = addDoor(world, rooms.disputedStack, 'south', 35, DoorState.HERMETIC_CLOSED);
  const floodgateNorth = addDoor(world, rooms.floodgate, 'north', 33);
  const shortcutWest = addDoor(world, rooms.shortcut, 'west', 17);
  const dryingNorth = addDoor(world, rooms.dryingRoom, 'north', 34);
  const witnessSouth = addDoor(world, rooms.witness, 'south', 40);

  connectAnchors(world, field, [
    { point: lobbyNorth },
    { point: lobbyWest },
    { point: tradeEast },
    { point: drySouth },
    { point: disputedSouth, wet: true },
    { point: floodgateNorth },
    { point: shortcutWest, wet: true },
    { point: dryingNorth },
    { point: witnessSouth },
  ], state);
  carveContaminatedShortcut(world, shortcutWest, floodgateNorth, state);
  const archiveExpansion = expandArchiveMidAndMicro(world, field);
  state.midArchiveBlocks = archiveExpansion.blocks;
  state.microArchiveRooms = archiveExpansion.microRooms;
  state.hqAnchorRooms = archiveExpansion.hqRooms;
  state.hqSupportRooms = archiveExpansion.supportRooms;

  placeLift(world, rooms.lobby.x + 4, rooms.lobby.y + 8, rooms.lobby.x + 7, rooms.lobby.y + 8, LiftDirection.UP);
  placeLift(world, rooms.lobby.x + rooms.lobby.w - 5, rooms.lobby.y + 8, rooms.lobby.x + rooms.lobby.w - 8, rooms.lobby.y + 8, LiftDirection.DOWN);

  tuneInitialZones(world);
  paintCriticalLeakHqTerritory(world, archiveExpansion.hqCompounds);
  decorateArchiveRooms(world, rooms);
  populateContainers(world, rooms, state);

  spawnLeakNpc(entities, nextId, ARCHIVIST_DEF, 'critical_leak_archivist_varvara', rooms.trade.x + 9, rooms.trade.y + 14);
  spawnLeakNpc(entities, nextId, LIQUIDATOR_DEF, 'critical_leak_liquidator_egor', rooms.floodgate.x + 14, rooms.floodgate.y + 16, 'makarov');

  sanitizeDoors(world);
  world.rebuildContainerMap();
  world.bakeLights();

  state.debugEntry.summary = `largest=${state.largestComponentCells} bridges=${state.bridgesAdded} wet=${state.wetCausewayCells} dry=${state.dryCausewayCells} blocks=${state.midArchiveBlocks} micro=${state.microArchiveRooms}`;
  return {
    world,
    entities,
    spawnX: state.debugEntry.spawnX,
    spawnY: state.debugEntry.spawnY,
    criticalLeakState: state,
  };
}
