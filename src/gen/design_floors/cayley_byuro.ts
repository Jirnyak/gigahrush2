/* -- Design floor: Бюро Кэли, paperwork as a Cayley graph -- */

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
  type Item,
  type Room,
  type TerritoryOwner,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { Spr, monsterSpr } from '../../render/sprite_index';
import { registerRouteCue } from '../../systems/route_cues';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { syncZoneMetadataFromTerritory } from '../../systems/territory';
import { carveCorridor, ensureConnectivity, generateZones, sanitizeDoors, stampRoom } from '../shared';
import type { FloorGeneration } from '../floor_manifest';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('cayley_byuro');

export const CAYLEY_BYURO_ROUTE_ID = 'cayley_byuro' as const;
export const CAYLEY_BYURO_Z = 36;
export const CAYLEY_BYURO_BASE_FLOOR = FloorLevel.MINISTRY;

export type CayleyElement = 'e' | 'r' | 'rr' | 's' | 'sr' | 'srr';
export type CayleyGenerator = 'r' | 's';
export type CayleyCoset = 'even' | 'odd';

export const CAYLEY_BYURO_ROOM_NAMES: Readonly<Record<CayleyElement | 'lobby' | 'bribe' | 'audit' | 'quotient', string>> = {
  lobby: 'Лифтовая приемная бюро Кэли',
  e: 'Нулевая форма e',
  r: 'Окно R: печать после подписи',
  rr: 'Окно R2: подпись после печати',
  s: 'Окно S: смена личности',
  sr: 'Косетная очередь SR',
  srr: 'Косетная очередь SR2',
  bribe: 'Касса платного генератора R',
  audit: 'Комната разоблачения подделок',
  quotient: 'Факторный короткий ход',
} as const;

const CAYLEY_NEXT: Readonly<Record<CayleyGenerator, Readonly<Record<CayleyElement, CayleyElement>>>> = {
  r: { e: 'r', r: 'rr', rr: 'e', s: 'sr', sr: 'srr', srr: 's' },
  s: { e: 's', r: 'srr', rr: 'sr', s: 'e', sr: 'rr', srr: 'r' },
};

export const CAYLEY_BYURO_DECISIONS = [
  {
    id: 'order_rs',
    sequence: ['r', 's'] as const,
    result: 'srr' as CayleyElement,
    cue: 'Формы R затем S ведут в SR2. S затем R ведет в SR.',
  },
  {
    id: 'bribe_generator_r',
    sequence: ['r'] as const,
    result: 'r' as CayleyElement,
    cue: 'Кассир продает ключ к дверям генератора R. Это взятка, но не подделка.',
  },
  {
    id: 'illegal_quotient',
    sequence: ['s'] as const,
    result: 'odd' as CayleyCoset,
    cue: 'Факторный ход пропускает точный порядок форм и принимает поддельный пропуск.',
  },
] as const;

export interface CayleyByuroState {
  routeId: typeof CAYLEY_BYURO_ROUTE_ID;
  anchorZ: typeof CAYLEY_BYURO_Z;
  baseFloor: typeof CAYLEY_BYURO_BASE_FLOOR;
  groupRooms: Record<CayleyElement, number>;
  generatorDoorIds: number[];
  quotientShortcutDoorIds: number[];
  decisionContainerIds: number[];
  debugEntry: {
    spawnX: number;
    spawnY: number;
    summary: string;
  };
}

export interface CayleyByuroGeneration extends FloorGeneration {
  cayleyState: CayleyByuroState;
}

const CAYLEY_TAGS = ['cayley_byuro', 'cayley_graph', 'forms'];

interface Point {
  x: number;
  y: number;
}

interface CayleyHqSpec {
  owner: TerritoryOwner;
  x: number;
  y: number;
  name: string;
  supportPrefix: string;
  wallTex: Tex;
  floorTex: Tex;
  coreW: number;
  coreH: number;
  strong?: boolean;
}

const CAYLEY_GRAPH_POINTS: Readonly<Record<CayleyElement, Point>> = {
  e: { x: 512, y: 168 },
  r: { x: 800, y: 310 },
  rr: { x: 800, y: 674 },
  s: { x: 512, y: 858 },
  sr: { x: 224, y: 674 },
  srr: { x: 224, y: 310 },
} as const;

const CAYLEY_LATTICE_X = [96, 224, 352, 512, 672, 800, 928] as const;
const CAYLEY_LATTICE_Y = [96, 224, 352, 512, 672, 800, 928] as const;

export const CAYLEY_BYURO_TARGET_TERRITORY_SHARES: Readonly<Record<TerritoryOwner, number>> = {
  [ZoneFaction.CITIZEN]: 0.26,
  [ZoneFaction.LIQUIDATOR]: 0.20,
  [ZoneFaction.CULTIST]: 0.10,
  [ZoneFaction.SAMOSBOR]: 0,
  [ZoneFaction.WILD]: 0.10,
  [ZoneFaction.SCIENTIST]: 0.34,
} as const;

const CAYLEY_TERRITORY_GRID: readonly (readonly TerritoryOwner[])[] = [
  [ZoneFaction.CITIZEN, ZoneFaction.CITIZEN, ZoneFaction.CITIZEN, ZoneFaction.SCIENTIST, ZoneFaction.SCIENTIST, ZoneFaction.LIQUIDATOR, ZoneFaction.LIQUIDATOR, ZoneFaction.LIQUIDATOR],
  [ZoneFaction.CITIZEN, ZoneFaction.CITIZEN, ZoneFaction.CITIZEN, ZoneFaction.SCIENTIST, ZoneFaction.SCIENTIST, ZoneFaction.SCIENTIST, ZoneFaction.LIQUIDATOR, ZoneFaction.LIQUIDATOR],
  [ZoneFaction.CITIZEN, ZoneFaction.CITIZEN, ZoneFaction.CITIZEN, ZoneFaction.SCIENTIST, ZoneFaction.SCIENTIST, ZoneFaction.LIQUIDATOR, ZoneFaction.LIQUIDATOR, ZoneFaction.LIQUIDATOR],
  [ZoneFaction.CITIZEN, ZoneFaction.CITIZEN, ZoneFaction.SCIENTIST, ZoneFaction.SCIENTIST, ZoneFaction.SCIENTIST, ZoneFaction.LIQUIDATOR, ZoneFaction.LIQUIDATOR, ZoneFaction.SCIENTIST],
  [ZoneFaction.CITIZEN, ZoneFaction.CITIZEN, ZoneFaction.CITIZEN, ZoneFaction.SCIENTIST, ZoneFaction.SCIENTIST, ZoneFaction.SCIENTIST, ZoneFaction.LIQUIDATOR, ZoneFaction.WILD],
  [ZoneFaction.CITIZEN, ZoneFaction.CULTIST, ZoneFaction.CULTIST, ZoneFaction.SCIENTIST, ZoneFaction.SCIENTIST, ZoneFaction.SCIENTIST, ZoneFaction.WILD, ZoneFaction.WILD],
  [ZoneFaction.CULTIST, ZoneFaction.CULTIST, ZoneFaction.CULTIST, ZoneFaction.SCIENTIST, ZoneFaction.SCIENTIST, ZoneFaction.SCIENTIST, ZoneFaction.WILD, ZoneFaction.WILD],
  [ZoneFaction.CULTIST, ZoneFaction.CITIZEN, ZoneFaction.SCIENTIST, ZoneFaction.SCIENTIST, ZoneFaction.SCIENTIST, ZoneFaction.LIQUIDATOR, ZoneFaction.LIQUIDATOR, ZoneFaction.WILD],
] as const;

const CAYLEY_HQ_SPECS: readonly CayleyHqSpec[] = [
  {
    owner: ZoneFaction.CITIZEN,
    x: 176,
    y: 176,
    name: 'Гражданская приемная очередей Кэли',
    supportPrefix: 'Гражданская очередь',
    wallTex: Tex.PANEL,
    floorTex: Tex.F_LINO,
    coreW: 50,
    coreH: 34,
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    x: 856,
    y: 184,
    name: 'Ликвидаторский пост проверки порядка',
    supportPrefix: 'Пост проверки',
    wallTex: Tex.METAL,
    floorTex: Tex.F_CONCRETE,
    coreW: 54,
    coreH: 36,
  },
  {
    owner: ZoneFaction.CULTIST,
    x: 178,
    y: 822,
    name: 'Скрытый культовый фактор-узел',
    supportPrefix: 'Факторная келья',
    wallTex: Tex.DARK,
    floorTex: Tex.F_RED_CARPET,
    coreW: 42,
    coreH: 30,
  },
  {
    owner: ZoneFaction.SCIENTIST,
    x: 626,
    y: 500,
    name: 'НИИ Кэли: герметичное ядро алгоритма',
    supportPrefix: 'НИИ Кэли',
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_MARBLE_TILE,
    coreW: 76,
    coreH: 46,
    strong: true,
  },
  {
    owner: ZoneFaction.WILD,
    x: 856,
    y: 850,
    name: 'Дикий выбитый архив смежности',
    supportPrefix: 'Выбитый архив',
    wallTex: Tex.ROTTEN,
    floorTex: Tex.F_CONCRETE,
    coreW: 44,
    coreH: 32,
  },
] as const;

const CLERK_DEF: PlotNpcDef = {
  name: 'Григорий Кэли',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 120,
  maxHp: 120,
  money: 110,
  speed: 0.75,
  inventory: [
    { defId: 'blank_form', count: 2 },
    { defId: 'official_permit_slip', count: 1 },
    { defId: 'seal_wax', count: 1 },
  ],
  talkLines: [
    'У нас порядок форм важнее самих форм. R потом S - это одно окно, S потом R - совсем другое.',
    'Двери R открываются ключом. Ключ продается как ускорительный сбор, чтобы слово взятка не пачкало журнал.',
    'Факторный ход короткий, но он не проверяет личность. Потом личность проверяет ликвидатор.',
  ],
  talkLinesPost: [
    'Генератор R оплачен. Теперь не путайте чек с оправданием.',
    'Если дверь спорит, покажите ключ. Если клерк спорит, покажите вторую копию.',
  ],
};

const COSET_DEF: PlotNpcDef = {
  name: 'Маша Косетная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 105,
  maxHp: 105,
  money: 55,
  speed: 0.8,
  inventory: [
    { defId: 'passport_stub', count: 1 },
    { defId: 'blank_form', count: 1 },
  ],
  talkLines: [
    'Мне все равно, кто вы. Мне важно, в какой класс смежности вас положили.',
    'Сделайте R потом S и зайдите в SR2. Потом сделайте наоборот и увидите, что очередь другая.',
    'Короткий ход пропускает кабинет, но оставляет поддельный след.',
  ],
  talkLinesPost: [
    'Вы дошли до нужного окна. Значит, порядок был правильный или очень удачно украденный.',
    'Не говорите "то же самое" в коридоре. Тут за это ставят второй штамп.',
  ],
};

const INSPECTOR_DEF: PlotNpcDef = {
  name: 'Инспектор Смежности',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.DIRECTOR,
  sprite: Occupation.DIRECTOR,
  hp: 230,
  maxHp: 230,
  money: 140,
  speed: 0.88,
  inventory: [
    { defId: 'denunciation', count: 1 },
    { defId: 'makarov', count: 1 },
    { defId: 'official_permit_slip', count: 1 },
  ],
  talkLines: [
    'Поддельная личность не лжет. Она сокращает проверку. За сокращение отвечают отдельно.',
    'Принесете липовый пропуск - я закрою факторный ход на бумаге. Дверь может еще не знать.',
    'Параграфы здесь стреляют по прямой строке. Не стойте в строке.',
  ],
  talkLinesPost: [
    'Подделка принята как улика. Теперь у нее есть владелец, и это уже не вы.',
    'Короткий ход останется коротким. Просто за ним теперь смотрят.',
  ],
};

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'cayley_byuro_clerk', CLERK_DEF, [
  {
    id: 'cayley_byuro_bribe_generator_r',
    giverNpcId: 'cayley_byuro_clerk',
    type: QuestType.FETCH,
    desc: 'Отдай Григорию Кэли сорок рублей за ключ генератора R. Двери R откроются, но запись о платном обходе останется в журнале.',
    targetItem: 'money',
    targetCount: 40,
    rewardItem: 'key',
    rewardCount: 1,
    extraRewards: [{ defId: 'official_permit_slip', count: 1 }],
    relationDelta: 8,
    xpReward: 45,
    moneyReward: 0,
    eventTargetName: 'Ключ генератора R куплен в бюро Кэли.',
    eventTags: [...CAYLEY_TAGS, 'bribe', 'generator_r'],
    eventData: { cayleyAction: 'bribe_generator_r', routeId: CAYLEY_BYURO_ROUTE_ID },
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'cayley_byuro_coset_masha', COSET_DEF, [
  {
    id: 'cayley_byuro_apply_forms_rs',
    giverNpcId: 'cayley_byuro_coset_masha',
    type: QuestType.VISIT,
    desc: 'Пройди порядок R потом S до окна SR2. S потом R ведет в другое окно, поэтому не меняй порядок у двери.',
    targetRoomName: CAYLEY_BYURO_ROOM_NAMES.srr,
    rewardItem: 'archive_access_permit',
    rewardCount: 1,
    relationDelta: 7,
    xpReward: 40,
    moneyReward: 15,
    eventTargetName: 'Порядок форм R затем S пройден в бюро Кэли.',
    eventTags: [...CAYLEY_TAGS, 'order_rs', 'visit'],
    eventData: { cayleyAction: 'apply_forms_rs', result: 'srr' },
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'cayley_byuro_inspector', INSPECTOR_DEF, [
  {
    id: 'cayley_byuro_expose_forged_identity',
    giverNpcId: 'cayley_byuro_inspector',
    type: QuestType.FETCH,
    desc: 'Принеси Инспектору Смежности поддельный пропуск из факторного хода. Он платит за улику, не за мораль.',
    targetItem: 'forged_permit_slip',
    targetCount: 1,
    rewardItem: 'record_exposure_notice',
    rewardCount: 1,
    extraRewards: [{ defId: 'denunciation', count: 1 }],
    relationDelta: 11,
    xpReward: 70,
    moneyReward: 65,
    eventTargetName: 'Поддельная личность сдана инспектору бюро Кэли.',
    eventTags: [...CAYLEY_TAGS, 'forgery', 'exposed', 'liquidator'],
    eventData: { cayleyAction: 'expose_forged_identity', quotientShortcutFlagged: true },
  },
]);

export function cayleyApplyFormSequence(sequence: readonly CayleyGenerator[], start: CayleyElement = 'e'): CayleyElement {
  let current = start;
  for (const generator of sequence) current = CAYLEY_NEXT[generator][current];
  return current;
}

export function cayleyCosetOf(element: CayleyElement): CayleyCoset {
  return element === 'e' || element === 'r' || element === 'rr' ? 'even' : 'odd';
}

function createState(spawnX: number, spawnY: number): CayleyByuroState {
  return {
    routeId: CAYLEY_BYURO_ROUTE_ID,
    anchorZ: CAYLEY_BYURO_Z,
    baseFloor: CAYLEY_BYURO_BASE_FLOOR,
    groupRooms: { e: -1, r: -1, rr: -1, s: -1, sr: -1, srr: -1 },
    generatorDoorIds: [],
    quotientShortcutDoorIds: [],
    decisionContainerIds: [],
    debugEntry: {
      spawnX,
      spawnY,
      summary: 'lobby -> Cayley generator doors -> coset offices -> quotient shortcut or forgery exposure',
    },
  };
}

function styleRoom(world: World, room: Room, wallTex: Tex, floorTex: Tex): Room {
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

function addRoom(
  world: World,
  id: number,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex = Tex.MARBLE,
  floorTex = Tex.F_PARQUET,
): Room {
  const room = stampRoom(world, id, type, x, y, w, h, -1);
  room.name = name;
  return styleRoom(world, room, wallTex, floorTex);
}

function roomCoord(value: number, size: number): number {
  return Math.max(2, Math.min(W - size - 3, Math.round(value)));
}

function addAutoRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex = Tex.MARBLE,
  floorTex = Tex.F_PARQUET,
): Room {
  return addRoom(world, world.rooms.length, type, roomCoord(x, w), roomCoord(y, h), w, h, name, wallTex, floorTex);
}

function canStampGeneratedRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  const rx = roomCoord(x, w);
  const ry = roomCoord(y, h);
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR || world.roomMap[ci] >= 0) return false;
    }
  }
  return true;
}

function tryAddAutoRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex = Tex.MARBLE,
  floorTex = Tex.F_PARQUET,
): Room | null {
  if (!canStampGeneratedRoom(world, x, y, w, h)) return null;
  return addAutoRoom(world, type, x, y, w, h, name, wallTex, floorTex);
}

function center(room: Room): { x: number; y: number } {
  return {
    x: worldClamp(room.x + Math.floor(room.w / 2)),
    y: worldClamp(room.y + Math.floor(room.h / 2)),
  };
}

function worldClamp(value: number): number {
  return Math.max(0, Math.min(W - 1, value));
}

function setCellFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR && world.features[ci] === Feature.NONE) world.features[ci] = feature;
}

function carveCayleyDisc(world: World, cx: number, cy: number, radius: number, wallTex: Tex, floorTex: Tex): void {
  const floorR2 = radius * radius;
  const shoulder = radius + 2;
  const shoulderR2 = shoulder * shoulder;
  for (let dy = -shoulder; dy <= shoulder; dy++) {
    for (let dx = -shoulder; dx <= shoulder; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > shoulderR2) continue;
      const ci = world.idx(cx + dx, cy + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR || world.roomMap[ci] >= 0) continue;
      if (d2 <= floorR2) {
        world.cells[ci] = Cell.FLOOR;
        world.floorTex[ci] = floorTex;
        world.wallTex[ci] = wallTex;
        world.features[ci] = Feature.NONE;
        world.hermoWall[ci] = 0;
      } else if (world.cells[ci] === Cell.WALL) {
        world.wallTex[ci] = wallTex;
        world.features[ci] = Feature.NONE;
      }
    }
  }
}

function carveCayleySegment(world: World, a: Point, b: Point, radius: number, wallTex: Tex, floorTex: Tex): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.max(1, Math.abs(dx), Math.abs(dy));
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const x = Math.round(a.x + dx * t);
    const y = Math.round(a.y + dy * t);
    carveCayleyDisc(world, x, y, radius, wallTex, floorTex);
    if (step % 47 === 0) setCellFeature(world, x, y, step % 94 === 0 ? Feature.SCREEN : Feature.SHELF);
  }
}

function carveCayleyPolyline(world: World, points: readonly Point[], radius: number, wallTex: Tex, floorTex: Tex): void {
  for (let i = 1; i < points.length; i++) carveCayleySegment(world, points[i - 1], points[i], radius, wallTex, floorTex);
}

function carveCayleyGraphField(world: World): void {
  for (const y of CAYLEY_LATTICE_Y) carveCayleySegment(world, { x: 0, y }, { x: W - 1, y }, 2, Tex.MARBLE, Tex.F_PARQUET);
  for (const x of CAYLEY_LATTICE_X) carveCayleySegment(world, { x, y: 0 }, { x, y: W - 1 }, 2, Tex.MARBLE, Tex.F_PARQUET);

  for (const [a, b] of [['e', 'r'], ['r', 'rr'], ['rr', 'e'], ['s', 'sr'], ['sr', 'srr'], ['srr', 's']] as const) {
    carveCayleySegment(world, CAYLEY_GRAPH_POINTS[a], CAYLEY_GRAPH_POINTS[b], 5, Tex.MARBLE, Tex.F_GREEN_CARPET);
  }
  for (const [a, b] of [['e', 's'], ['r', 'srr'], ['rr', 'sr']] as const) {
    carveCayleySegment(world, CAYLEY_GRAPH_POINTS[a], CAYLEY_GRAPH_POINTS[b], 4, Tex.METAL, Tex.F_RED_CARPET);
  }

  const centerPoint = { x: 512, y: 502 };
  carveCayleyPolyline(world, [
    { x: 0, y: centerPoint.y },
    centerPoint,
    { x: W - 1, y: centerPoint.y },
  ], 3, Tex.MARBLE, Tex.F_MARBLE_TILE);
  carveCayleyPolyline(world, [
    { x: centerPoint.x, y: 0 },
    centerPoint,
    { x: centerPoint.x, y: W - 1 },
  ], 3, Tex.MARBLE, Tex.F_MARBLE_TILE);

  for (const element of ['e', 'r', 'rr', 's', 'sr', 'srr'] as const) {
    const p = CAYLEY_GRAPH_POINTS[element];
    carveCayleyDisc(world, p.x, p.y, 28, Tex.MARBLE, Tex.F_MARBLE_TILE);
    setCellFeature(world, p.x, p.y, cayleyCosetOf(element) === 'odd' ? Feature.SCREEN : Feature.DESK);
  }
}

function connectRooms(
  world: World,
  a: Room,
  b: Room,
  state: CayleyByuroState,
  kind: 'plain' | 'generator_r' | 'quotient',
): void {
  const before = new Set([...a.doors, ...b.doors]);
  const ac = center(a);
  const bc = center(b);
  carveCorridor(world, ac.x, ac.y, bc.x, bc.y);

  const newDoorIds = [...a.doors, ...b.doors].filter(idx => !before.has(idx));
  for (const idx of newDoorIds) {
    const door = world.doors.get(idx);
    if (!door) continue;
    world.wallTex[idx] = Tex.DOOR_METAL;
    if (kind === 'generator_r') {
      door.state = DoorState.LOCKED;
      door.keyId = 'key';
      state.generatorDoorIds.push(idx);
    } else if (kind === 'quotient') {
      door.state = DoorState.LOCKED;
      door.keyId = 'forged_permit_slip';
      state.quotientShortcutDoorIds.push(idx);
    } else {
      door.state = DoorState.CLOSED;
      door.keyId = '';
    }
  }
}

function carveShortcutCell(world: World, x: number, y: number): void {
  const ci = world.idx(x, y);
  if (world.aptMask[ci] || world.roomMap[ci] >= 0) return;
  world.cells[ci] = Cell.FLOOR;
  world.floorTex[ci] = Tex.F_CONCRETE;
  world.features[ci] = 0;
}

function carveOrthogonalShortcut(world: World, ax: number, ay: number, bx: number, by: number): void {
  const stepX = ax <= bx ? 1 : -1;
  for (let x = ax; x !== bx; x += stepX) carveShortcutCell(world, x, ay);
  carveShortcutCell(world, bx, ay);

  const stepY = ay <= by ? 1 : -1;
  for (let y = ay; y !== by; y += stepY) carveShortcutCell(world, bx, y);
  carveShortcutCell(world, bx, by);
}

function placeBoundaryDoor(
  world: World,
  room: Room,
  wx: number,
  wy: number,
  outsideX: number,
  outsideY: number,
  state: DoorState,
  keyId: string,
  list?: number[],
): number {
  const idx = world.idx(wx, wy);
  const outsideIdx = world.idx(outsideX, outsideY);
  const verticalWallDoor = wx === room.x - 1 || wx === room.x + room.w;
  const blockers = verticalWallDoor ? [[0, -1], [0, 1]] as const : [[-1, 0], [1, 0]] as const;

  for (const [dx, dy] of blockers) {
    const bi = world.idx(wx + dx, wy + dy);
    if (world.roomMap[bi] < 0 && bi !== outsideIdx) {
      world.cells[bi] = Cell.WALL;
      world.wallTex[bi] = room.wallTex;
    }
  }

  carveShortcutCell(world, outsideX, outsideY);
  world.cells[idx] = Cell.DOOR;
  world.wallTex[idx] = Tex.DOOR_METAL;
  world.doors.set(idx, { idx, state, roomA: room.id, roomB: -1, keyId, timer: 0 });
  if (!room.doors.includes(idx)) room.doors.push(idx);
  if (list && !list.includes(idx)) list.push(idx);
  return idx;
}

function addQuotientShortcut(world: World, rooms: ReturnType<typeof createRooms>, state: CayleyByuroState): void {
  const qy = rooms.quotient.y + Math.floor(rooms.quotient.h / 2);
  const sy = rooms.srr.y + Math.floor(rooms.srr.h / 2);
  const qDoorX = rooms.quotient.x - 1;
  const qOutsideX = rooms.quotient.x - 2;
  const sDoorX = rooms.srr.x - 1;
  const sOutsideX = rooms.srr.x - 2;

  carveOrthogonalShortcut(world, qOutsideX, qy, sOutsideX, sy);
  placeBoundaryDoor(world, rooms.quotient, qDoorX, qy, qOutsideX, qy, DoorState.LOCKED, 'forged_permit_slip', state.quotientShortcutDoorIds);
  placeBoundaryDoor(world, rooms.srr, sDoorX, sy, sOutsideX, sy, DoorState.CLOSED, '');
}

function placeLift(world: World, x: number, y: number, buttonX: number, buttonY: number, direction: LiftDirection): void {
  const li = world.idx(x, y);
  world.cells[li] = Cell.LIFT;
  world.wallTex[li] = Tex.LIFT_DOOR;
  world.liftDir[li] = direction;
  const bi = world.idx(buttonX, buttonY);
  if (world.cells[bi] === Cell.FLOOR) world.features[bi] = Feature.LIFT_BUTTON;
  world.liftDir[bi] = direction;
}

function setFeature(world: World, room: Room, dx: number, dy: number, feature: Feature): void {
  const x = room.x + dx;
  const y = room.y + dy;
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = feature;
}

function decorateRoom(world: World, room: Room, element?: CayleyElement): void {
  for (let x = 3; x < room.w - 3; x += 7) setFeature(world, room, x, 3, Feature.DESK);
  for (let y = 6; y < room.h - 3; y += 6) setFeature(world, room, 3, y, Feature.SHELF);
  setFeature(world, room, room.w - 4, 3, Feature.LAMP);
  if (element && cayleyCosetOf(element) === 'odd') setFeature(world, room, room.w - 5, room.h - 5, Feature.SCREEN);
}

function decorateGeneratedRoom(world: World, room: Room, serial: number): void {
  switch (room.type) {
    case RoomType.KITCHEN:
      for (let x = 2; x < room.w - 2; x += 5) setFeature(world, room, x, 2, Feature.STOVE);
      setFeature(world, room, room.w - 4, room.h - 3, Feature.SINK);
      setFeature(world, room, 3, room.h - 3, Feature.TABLE);
      break;
    case RoomType.BATHROOM:
      for (let x = 2; x < room.w - 2; x += 5) setFeature(world, room, x, 2, Feature.SINK);
      setFeature(world, room, room.w - 4, room.h - 3, Feature.TOILET);
      break;
    case RoomType.MEDICAL:
      for (let x = 3; x < room.w - 3; x += 7) setFeature(world, room, x, 3, Feature.APPARATUS);
      setFeature(world, room, room.w - 4, room.h - 4, Feature.SCREEN);
      break;
    case RoomType.PRODUCTION:
      for (let x = 3; x < room.w - 3; x += 6) setFeature(world, room, x, 3, Feature.MACHINE);
      for (let x = 5; x < room.w - 4; x += 8) setFeature(world, room, x, room.h - 4, Feature.APPARATUS);
      break;
    case RoomType.STORAGE:
      for (let y = 2; y < room.h - 2; y += 4) {
        setFeature(world, room, 2, y, Feature.SHELF);
        setFeature(world, room, room.w - 3, y, Feature.SHELF);
      }
      break;
    case RoomType.HQ:
      for (let x = 4; x < room.w - 4; x += 8) setFeature(world, room, x, 4, Feature.DESK);
      setFeature(world, room, room.w - 5, 4, Feature.SCREEN);
      setFeature(world, room, 4, room.h - 5, Feature.LAMP);
      break;
    case RoomType.COMMON:
      for (let x = 4; x < room.w - 4; x += 10) setFeature(world, room, x, room.h >> 1, Feature.TABLE);
      setFeature(world, room, room.w - 5, 4, Feature.LAMP);
      break;
    case RoomType.OFFICE:
    default:
      for (let x = 3; x < room.w - 3; x += 6) setFeature(world, room, x, 3, serial % 3 === 0 ? Feature.SCREEN : Feature.DESK);
      setFeature(world, room, room.w - 4, room.h - 4, Feature.SHELF);
      break;
  }
}

function connectRoomToPoint(world: World, room: Room, target: Point, state?: DoorState, keyId = ''): void {
  const c = center(room);
  const dx = target.x - c.x;
  const dy = target.y - c.y;
  let wx: number;
  let wy: number;
  let ox: number;
  let oy: number;

  if (Math.abs(dx) >= Math.abs(dy)) {
    wy = worldClamp(room.y + Math.max(1, Math.min(room.h - 2, Math.round(target.y - room.y))));
    if (dx >= 0) {
      wx = room.x + room.w;
      ox = wx + 1;
    } else {
      wx = room.x - 1;
      ox = wx - 1;
    }
    oy = wy;
  } else {
    wx = worldClamp(room.x + Math.max(1, Math.min(room.w - 2, Math.round(target.x - room.x))));
    if (dy >= 0) {
      wy = room.y + room.h;
      oy = wy + 1;
    } else {
      wy = room.y - 1;
      oy = wy - 1;
    }
    ox = wx;
  }

  carveOrthogonalShortcut(world, ox, oy, target.x, target.y);
  placeBoundaryDoor(world, room, wx, wy, ox, oy, state ?? DoorState.CLOSED, keyId);
}

function hardenHermeticCore(world: World, room: Room): void {
  room.wallTex = Tex.HERMO_WALL;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const border = dx < 0 || dx >= room.w || dy < 0 || dy >= room.h;
      const ci = world.idx(room.x + dx, room.y + dy);
      if (border && world.cells[ci] === Cell.WALL) {
        world.wallTex[ci] = Tex.HERMO_WALL;
        world.hermoWall[ci] = 1;
      }
    }
  }
  for (const doorIdx of room.doors) {
    const door = world.doors.get(doorIdx);
    if (!door) continue;
    door.state = DoorState.HERMETIC_OPEN;
    door.keyId = '';
    world.wallTex[doorIdx] = Tex.DOOR_METAL;
  }
}

function createCayleyArchiveWing(world: World, hall: Room, element: CayleyElement, state: CayleyByuroState): void {
  const c = center(hall);
  const serialBase = hall.id * 100;
  const roomTypes = [
    RoomType.OFFICE,
    RoomType.STORAGE,
    RoomType.OFFICE,
    RoomType.BATHROOM,
    RoomType.KITCHEN,
    RoomType.STORAGE,
    RoomType.MEDICAL,
  ] as const;
  let serial = 0;
  for (let i = 0; i < 8; i++) {
    const top = tryAddAutoRoom(world, roomTypes[i % roomTypes.length], c.x - 92 + i * 24, c.y - 98, 14, 10, `Архив ${element}: верхняя ячейка ${i + 1}`);
    if (top) {
      decorateGeneratedRoom(world, top, serialBase + serial++);
      connectRooms(world, hall, top, state, 'plain');
    }
    const bottom = tryAddAutoRoom(world, roomTypes[(i + 3) % roomTypes.length], c.x - 92 + i * 24, c.y + 88, 14, 10, `Архив ${element}: нижняя ячейка ${i + 1}`);
    if (bottom) {
      decorateGeneratedRoom(world, bottom, serialBase + serial++);
      connectRooms(world, hall, bottom, state, 'plain');
    }
  }
  for (let i = 0; i < 7; i++) {
    const left = tryAddAutoRoom(world, roomTypes[(i + 1) % roomTypes.length], c.x - 126, c.y - 62 + i * 20, 13, 11, `Кабинка ${element}: левая ${i + 1}`);
    if (left) {
      decorateGeneratedRoom(world, left, serialBase + serial++);
      connectRooms(world, hall, left, state, 'plain');
    }
    const right = tryAddAutoRoom(world, roomTypes[(i + 4) % roomTypes.length], c.x + 112, c.y - 62 + i * 20, 13, 11, `Кабинка ${element}: правая ${i + 1}`);
    if (right) {
      decorateGeneratedRoom(world, right, serialBase + serial++);
      connectRooms(world, hall, right, state, 'plain');
    }
  }
}

function createCayleyMacroCampuses(
  world: World,
  authoredRooms: ReturnType<typeof createRooms>,
  state: CayleyByuroState,
): Record<CayleyElement, Room> {
  const macroRooms = {} as Record<CayleyElement, Room>;
  for (const element of ['e', 'r', 'rr', 's', 'sr', 'srr'] as const) {
    const p = CAYLEY_GRAPH_POINTS[element];
    const hall = addAutoRoom(
      world,
      RoomType.COMMON,
      p.x - 38,
      p.y - 24,
      76,
      48,
      `Макроузел графа Кэли ${element}: ${CAYLEY_BYURO_ROOM_NAMES[element]}`,
      Tex.MARBLE,
      cayleyCosetOf(element) === 'odd' ? Tex.F_RED_CARPET : Tex.F_GREEN_CARPET,
    );
    macroRooms[element] = hall;
    decorateRoom(world, hall, element);
    setFeature(world, hall, hall.w >> 1, hall.h >> 1, Feature.SCREEN);
    connectRooms(world, hall, authoredRooms[element], state, 'plain');
    createCayleyArchiveWing(world, hall, element, state);
  }
  return macroRooms;
}

function connectCayleyMacroGraph(world: World, macroRooms: Record<CayleyElement, Room>, state: CayleyByuroState): void {
  for (const [a, b] of [['e', 'r'], ['r', 'rr'], ['rr', 'e'], ['s', 'sr'], ['sr', 'srr'], ['srr', 's']] as const) {
    connectRooms(world, macroRooms[a], macroRooms[b], state, 'generator_r');
  }
  for (const [a, b] of [['e', 's'], ['r', 'srr'], ['rr', 'sr']] as const) {
    connectRooms(world, macroRooms[a], macroRooms[b], state, 'plain');
  }
}

function nearestMacroRoom(spec: CayleyHqSpec, macroRooms: Record<CayleyElement, Room>): Room {
  if (spec.owner === ZoneFaction.CITIZEN) return macroRooms.e;
  if (spec.owner === ZoneFaction.LIQUIDATOR) return macroRooms.r;
  if (spec.owner === ZoneFaction.CULTIST) return macroRooms.sr;
  if (spec.owner === ZoneFaction.WILD) return macroRooms.rr;
  return macroRooms.r;
}

function createHqSupportRooms(world: World, core: Room, spec: CayleyHqSpec, state: CayleyByuroState): void {
  const c = center(core);
  const support = [
    { type: RoomType.KITCHEN, x: c.x - 78, y: c.y - 18, w: 24, h: 14, suffix: 'кухня и выдача' },
    { type: RoomType.BATHROOM, x: c.x - 76, y: c.y + 22, w: 22, h: 12, suffix: 'санузел гермы' },
    { type: RoomType.STORAGE, x: c.x + 54, y: c.y - 22, w: 26, h: 16, suffix: 'склад допусков' },
    { type: spec.owner === ZoneFaction.SCIENTIST ? RoomType.MEDICAL : RoomType.OFFICE, x: c.x + 56, y: c.y + 22, w: 28, h: 16, suffix: spec.owner === ZoneFaction.SCIENTIST ? 'медико-измерительная' : 'канцелярия' },
    { type: spec.owner === ZoneFaction.WILD ? RoomType.SMOKING : RoomType.PRODUCTION, x: c.x - 18, y: c.y + 54, w: 34, h: 16, suffix: spec.owner === ZoneFaction.WILD ? 'разбитая курилка' : 'мастерская' },
  ] as const;

  for (let i = 0; i < support.length; i++) {
    const s = support[i];
    const room = tryAddAutoRoom(world, s.type, s.x, s.y, s.w, s.h, `${spec.supportPrefix}: ${s.suffix}`, spec.wallTex, spec.floorTex);
    if (!room) continue;
    decorateGeneratedRoom(world, room, core.id * 10 + i);
    connectRooms(world, core, room, state, 'plain');
  }
}

function createScientistOutposts(world: World, core: Room, state: CayleyByuroState): void {
  const outposts = [
    { x: 690, y: 424, name: 'НИИ Кэли: пост генератора R' },
    { x: 696, y: 566, name: 'НИИ Кэли: пост факторного обхода' },
  ] as const;
  for (const outpost of outposts) {
    const room = tryAddAutoRoom(world, RoomType.HQ, outpost.x - 24, outpost.y - 16, 48, 32, outpost.name, Tex.HERMO_WALL, Tex.F_MARBLE_TILE);
    if (!room) continue;
    decorateGeneratedRoom(world, room, room.id);
    connectRooms(world, core, room, state, 'plain');
    hardenHermeticCore(world, room);
  }
}

function createCayleyHqClusters(world: World, macroRooms: Record<CayleyElement, Room>, state: CayleyByuroState): void {
  for (const spec of CAYLEY_HQ_SPECS) {
    const core = addAutoRoom(
      world,
      RoomType.HQ,
      spec.x - Math.floor(spec.coreW / 2),
      spec.y - Math.floor(spec.coreH / 2),
      spec.coreW,
      spec.coreH,
      spec.name,
      spec.wallTex,
      spec.floorTex,
    );
    decorateGeneratedRoom(world, core, core.id);
    createHqSupportRooms(world, core, spec, state);
    connectRooms(world, core, nearestMacroRoom(spec, macroRooms), state, 'plain');
    if (spec.strong) createScientistOutposts(world, core, state);
    hardenHermeticCore(world, core);
  }
}

function createCayleyLatticeBooths(world: World): void {
  const boothTypes = [RoomType.OFFICE, RoomType.STORAGE, RoomType.OFFICE, RoomType.BATHROOM] as const;
  let serial = 0;
  for (const x of CAYLEY_LATTICE_X) {
    for (const y of CAYLEY_LATTICE_Y) {
      const offsets = [
        { dx: -31, dy: -27, w: 12, h: 9 },
        { dx: 18, dy: -27, w: 12, h: 9 },
        { dx: -31, dy: 18, w: 12, h: 9 },
        { dx: 18, dy: 18, w: 12, h: 9 },
      ] as const;
      for (let i = 0; i < offsets.length; i++) {
        if ((serial + i) % 11 === 0) continue;
        const o = offsets[i];
        const room = tryAddAutoRoom(
          world,
          boothTypes[(serial + i) % boothTypes.length],
          x + o.dx,
          y + o.dy,
          o.w,
          o.h,
          `Микроокно алгоритма ${serial + 1}.${i + 1}`,
          Tex.PANEL,
          Tex.F_LINO,
        );
        if (!room) continue;
        decorateGeneratedRoom(world, room, serial + i);
        connectRoomToPoint(world, room, { x, y });
      }
      serial++;
    }
  }
}

function createRooms(world: World, state: CayleyByuroState): Record<CayleyElement | 'lobby' | 'bribe' | 'audit' | 'quotient', Room> {
  let roomId = 0;
  const rooms = {
    lobby: addRoom(world, roomId++, RoomType.COMMON, 470, 476, 84, 50, CAYLEY_BYURO_ROOM_NAMES.lobby, Tex.MARBLE, Tex.F_MARBLE_TILE),
    e: addRoom(world, roomId++, RoomType.OFFICE, 448, 264, 64, 32, CAYLEY_BYURO_ROOM_NAMES.e),
    r: addRoom(world, roomId++, RoomType.OFFICE, 580, 350, 66, 34, CAYLEY_BYURO_ROOM_NAMES.r),
    rr: addRoom(world, roomId++, RoomType.OFFICE, 580, 540, 66, 34, CAYLEY_BYURO_ROOM_NAMES.rr),
    s: addRoom(world, roomId++, RoomType.OFFICE, 448, 666, 64, 32, CAYLEY_BYURO_ROOM_NAMES.s),
    sr: addRoom(world, roomId++, RoomType.OFFICE, 316, 540, 66, 34, CAYLEY_BYURO_ROOM_NAMES.sr),
    srr: addRoom(world, roomId++, RoomType.OFFICE, 316, 350, 66, 34, CAYLEY_BYURO_ROOM_NAMES.srr),
    bribe: addRoom(world, roomId++, RoomType.OFFICE, 202, 464, 72, 40, CAYLEY_BYURO_ROOM_NAMES.bribe, Tex.PANEL, Tex.F_GREEN_CARPET),
    audit: addRoom(world, roomId++, RoomType.OFFICE, 750, 464, 74, 42, CAYLEY_BYURO_ROOM_NAMES.audit, Tex.METAL, Tex.F_CONCRETE),
    quotient: addRoom(world, roomId++, RoomType.CORRIDOR, 470, 590, 84, 34, CAYLEY_BYURO_ROOM_NAMES.quotient, Tex.METAL, Tex.F_RED_CARPET),
  };

  for (const element of ['e', 'r', 'rr', 's', 'sr', 'srr'] as const) {
    state.groupRooms[element] = rooms[element].id;
    decorateRoom(world, rooms[element], element);
  }
  decorateRoom(world, rooms.lobby);
  decorateRoom(world, rooms.bribe);
  decorateRoom(world, rooms.audit);
  decorateRoom(world, rooms.quotient);
  setFeature(world, rooms.lobby, 8, 8, Feature.SCREEN);
  setFeature(world, rooms.quotient, 12, 7, Feature.APPARATUS);
  return rooms;
}

function connectCayleyGraph(world: World, rooms: ReturnType<typeof createRooms>, state: CayleyByuroState): void {
  connectRooms(world, rooms.lobby, rooms.e, state, 'plain');
  connectRooms(world, rooms.lobby, rooms.bribe, state, 'plain');
  connectRooms(world, rooms.lobby, rooms.audit, state, 'plain');
  connectRooms(world, rooms.lobby, rooms.quotient, state, 'plain');

  for (const [a, b] of [['e', 'r'], ['r', 'rr'], ['rr', 'e'], ['s', 'sr'], ['sr', 'srr'], ['srr', 's']] as const) {
    connectRooms(world, rooms[a], rooms[b], state, 'generator_r');
  }
  for (const [a, b] of [['e', 's'], ['r', 'srr'], ['rr', 'sr']] as const) {
    connectRooms(world, rooms[a], rooms[b], state, 'plain');
  }
  connectRooms(world, rooms.quotient, rooms.srr, state, 'quotient');
  addQuotientShortcut(world, rooms, state);
}

function spawnNpc(
  entities: Entity[],
  nextId: { v: number },
  plotNpcId: string,
  _def: PlotNpcDef,
  room: Room,
  dx: number,
  dy: number,
  weapon?: string,
): number {
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, room.x + dx + 0.5, room.y + dy + 0.5, {
    angle: Math.random() * Math.PI * 2,
    canGiveQuest: true,
    weapon,
    aiTarget: { x: room.x + dx, y: room.y + dy },
    extra: { isTraveler: false },
  });
  return npc.id;
}

function spawnMonster(world: World, entities: Entity[], nextId: { v: number }, room: Room, dx: number, dy: number, kind: MonsterKind): void {
  const def = MONSTERS[kind];
  if (!def) return;
  const x = room.x + dx;
  const y = room.y + dy;
  const ci = world.idx(x, y);
  const zoneLevel = world.zones[world.zoneMap[ci]]?.level ?? 3;
  const hp = scaleMonsterHp(def.hp, zoneLevel);
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: monsterSpr(kind),
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
  });
}

function nextContainerId(world: World): number {
  let id = 1;
  for (const container of world.containers) id = Math.max(id, container.id + 1);
  return id;
}

function addContainer(
  world: World,
  state: CayleyByuroState,
  room: Room,
  x: number,
  y: number,
  opts: {
    kind: ContainerKind;
    name: string;
    access: WorldContainer['access'];
    inventory: Item[];
    tags: string[];
    ownerNpcId?: number;
    ownerName?: string;
    faction?: Faction;
    lockDifficulty?: number;
  },
): WorldContainer {
  const container: WorldContainer = {
    id: nextContainerId(world),
    x,
    y,
    floor: CAYLEY_BYURO_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind: opts.kind,
    name: opts.name,
    inventory: opts.inventory.map(item => ({ ...item })),
    capacitySlots: Math.max(8, opts.inventory.length + 4),
    access: opts.access,
    ownerNpcId: opts.ownerNpcId,
    ownerName: opts.ownerName,
    faction: opts.faction,
    lockDifficulty: opts.lockDifficulty,
    discovered: true,
    tags: [...CAYLEY_TAGS, ...opts.tags],
  };
  world.addContainer(container);
  state.decisionContainerIds.push(container.id);
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = opts.kind === ContainerKind.CASHBOX ? Feature.DESK : Feature.SHELF;
  return container;
}

function addNote(entities: Entity[], nextId: { v: number }, x: number, y: number, text: string): void {
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
    inventory: [{ defId: 'note', count: 1, data: { text } }],
  });
}

function populateAuthoredContent(
  world: World,
  entities: Entity[],
  rooms: ReturnType<typeof createRooms>,
  state: CayleyByuroState,
): void {
  const nextId = { v: 1 };
  const clerkId = spawnNpc(entities, nextId, 'cayley_byuro_clerk', CLERK_DEF, rooms.bribe, 10, 12);
  spawnNpc(entities, nextId, 'cayley_byuro_coset_masha', COSET_DEF, rooms.quotient, 16, 9);
  const inspectorId = spawnNpc(entities, nextId, 'cayley_byuro_inspector', INSPECTOR_DEF, rooms.audit, 10, 10, 'makarov');

  addContainer(world, state, rooms.bribe, rooms.bribe.x + rooms.bribe.w - 5, rooms.bribe.y + 8, {
    kind: ContainerKind.CASHBOX,
    name: 'Касса платного генератора R',
    access: 'owner',
    ownerNpcId: clerkId,
    ownerName: CLERK_DEF.name,
    faction: Faction.CITIZEN,
    inventory: [
      { defId: 'key', count: 1 },
      { defId: 'official_permit_slip', count: 1 },
      { defId: 'seal_wax', count: 1 },
    ],
    tags: ['bribe', 'generator_r', 'paid_access'],
    lockDifficulty: 2,
  });

  addContainer(world, state, rooms.quotient, rooms.quotient.x + rooms.quotient.w - 8, rooms.quotient.y + 8, {
    kind: ContainerKind.FILING_CABINET,
    name: 'Факторная папка короткого хода',
    access: 'locked',
    inventory: [
      { defId: 'forged_permit_slip', count: 1 },
      { defId: 'fake_pass', count: 1 },
      { defId: 'blank_form', count: 2 },
    ],
    tags: ['quotient_shortcut', 'illegal', 'forgery'],
    lockDifficulty: 4,
  });

  addContainer(world, state, rooms.audit, rooms.audit.x + rooms.audit.w - 6, rooms.audit.y + 7, {
    kind: ContainerKind.SAFE,
    name: 'Сейф разоблаченных личностей',
    access: 'owner',
    ownerNpcId: inspectorId,
    ownerName: INSPECTOR_DEF.name,
    faction: Faction.LIQUIDATOR,
    inventory: [
      { defId: 'record_exposure_notice', count: 1 },
      { defId: 'denunciation', count: 2 },
      { defId: 'elevator_access_order', count: 1 },
    ],
    tags: ['identity_exposure', 'liquidator', 'evidence'],
    lockDifficulty: 5,
  });

  addContainer(world, state, rooms.srr, rooms.srr.x + rooms.srr.w - 6, rooms.srr.y + rooms.srr.h - 6, {
    kind: ContainerKind.FILING_CABINET,
    name: 'Папка правильного порядка RS',
    access: 'room',
    inventory: [
      { defId: 'archive_access_permit', count: 1 },
      { defId: 'official_permit_slip', count: 1 },
    ],
    tags: ['order_rs', 'legal', 'reward'],
  });

  addNote(entities, nextId, rooms.lobby.x + 11, rooms.lobby.y + 12, 'Бюро Кэли: R затем S ведет в SR2. S затем R ведет в SR. В журнале это разные люди.');
  addNote(entities, nextId, rooms.quotient.x + 10, rooms.quotient.y + 12, 'Факторный ход принимает любой нечетный класс. Поддельный пропуск сокращает путь и оставляет улику.');
  addNote(entities, nextId, rooms.audit.x + 8, rooms.audit.y + rooms.audit.h - 7, 'Поддельную личность сдавать в комнату разоблачения. Не через окно жалоб.');

  spawnMonster(world, entities, nextId, rooms.r, 9, 10, MonsterKind.PARAGRAPH);
  spawnMonster(world, entities, nextId, rooms.sr, 10, 12, MonsterKind.PECHATEED);
  spawnMonster(world, entities, nextId, rooms.rr, 12, 12, MonsterKind.KONTORSHCHIK);
}

function ownerForCayleyTerritoryTile(x: number, y: number): TerritoryOwner {
  const tx = Math.max(0, Math.min(7, Math.floor(x / 128)));
  const ty = Math.max(0, Math.min(7, Math.floor(y / 128)));
  return CAYLEY_TERRITORY_GRID[ty][tx];
}

function paintRoomTerritory(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (!world.aptMask[ci]) world.factionControl[ci] = owner;
    }
  }
  for (const doorIdx of room.doors) world.factionControl[doorIdx] = owner;
}

function paintNearbyTerritoryPatch(world: World, x: number, y: number, radius: number, owner: TerritoryOwner): void {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const ci = world.idx(x + dx, y + dy);
      if (!world.aptMask[ci]) world.factionControl[ci] = owner;
    }
  }
}

export function retuneCayleyByuroTerritory(world: World): void {
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      world.factionControl[world.idx(x, y)] = ownerForCayleyTerritoryTile(x, y);
    }
  }

  for (const spec of CAYLEY_HQ_SPECS) {
    paintNearbyTerritoryPatch(world, spec.x, spec.y, spec.strong ? 82 : 58, spec.owner);
  }

  for (const room of world.rooms) {
    const c = center(room);
    if (room.type === RoomType.HQ) {
      paintRoomTerritory(world, room, ownerForCayleyTerritoryTile(c.x, c.y));
    } else if (room.name === CAYLEY_BYURO_ROOM_NAMES.bribe) {
      paintRoomTerritory(world, room, ZoneFaction.CITIZEN);
    } else if (room.name === CAYLEY_BYURO_ROOM_NAMES.audit) {
      paintRoomTerritory(world, room, ZoneFaction.LIQUIDATOR);
    } else if (room.name === CAYLEY_BYURO_ROOM_NAMES.quotient || room.name.includes('факторного обхода')) {
      paintRoomTerritory(world, room, ZoneFaction.WILD);
    }
  }

  for (const zone of world.zones) {
    const owner = ownerForCayleyTerritoryTile(zone.cx, zone.cy);
    zone.level = owner === ZoneFaction.CULTIST || owner === ZoneFaction.WILD ? 4 : owner === ZoneFaction.SCIENTIST ? 3 : 2;
    zone.fogged = false;
  }
  syncZoneMetadataFromTerritory(world);
}

function tuneInitialZones(world: World): void {
  generateZones(world);
  retuneCayleyByuroTerritory(world);
}

function registerCayleyRouteCue(world: World, rooms: ReturnType<typeof createRooms>): void {
  const lobby = center(rooms.lobby);
  const target = center(rooms.srr);
  registerRouteCue(world, {
    id: 'cayley_byuro_order_rs',
    x: lobby.x + 0.5,
    y: lobby.y + 0.5,
    targetX: target.x + 0.5,
    targetY: target.y + 0.5,
    floor: CAYLEY_BYURO_BASE_FLOOR,
    label: 'Порядок форм',
    hint: 'R потом S ведет в SR2. Обратный порядок приведет в другую очередь.',
    targetName: CAYLEY_BYURO_ROOM_NAMES.srr,
    color: '#f6c957',
    tags: ['cayley_byuro', 'route_choice', 'forms', 'order_rs'],
    toneSeed: 90_032,
    roomId: rooms.lobby.id,
    targetRoomId: rooms.srr.id,
    heardText: 'Указатель бюро щелкает: сначала R, потом S. Короткий ход требует липовый пропуск.',
    followedText: 'Вы идете по порядку R затем S.',
    ignoredText: 'Порядок форм оставлен без отметки.',
    routeGroup: {
      id: 'cayley_byuro_forms',
      lead: 'В бюро Кэли двери подписаны генераторами R и S.',
      risk: 'Ключ R покупается, факторный ход работает через подделку.',
      decision: 'Идти легальным порядком, платить за R или резать путь липовой личностью.',
      reward: 'Пропуск, улика или быстрый выход к косетным окнам.',
      mapLabel: 'Бюро Кэли',
      mapHint: 'Проверь порядок форм перед дверью.',
      logLine: 'Бюро Кэли показывает порядок R затем S.',
    },
  });
}

function retainLiveCayleyDoorIds(world: World, state: CayleyByuroState): void {
  state.generatorDoorIds = state.generatorDoorIds.filter(idx => world.doors.has(idx));
  state.quotientShortcutDoorIds = state.quotientShortcutDoorIds.filter(idx => world.doors.has(idx));
}

export function generateCayleyByuroDesignFloor(): CayleyByuroGeneration {
  const world = new World();
  const entities: Entity[] = [];
  const spawnX = 512.5;
  const spawnY = 502.5;
  const state = createState(spawnX, spawnY);

  for (let i = 0; i < W * W; i++) {
    world.wallTex[i] = Tex.MARBLE;
    world.floorTex[i] = Tex.F_PARQUET;
  }

  carveCayleyGraphField(world);
  const rooms = createRooms(world, state);
  placeLift(world, rooms.lobby.x + 8, rooms.lobby.y + 24, rooms.lobby.x + 11, rooms.lobby.y + 24, LiftDirection.UP);
  placeLift(world, rooms.lobby.x + rooms.lobby.w - 9, rooms.lobby.y + 24, rooms.lobby.x + rooms.lobby.w - 12, rooms.lobby.y + 24, LiftDirection.DOWN);
  const macroRooms = createCayleyMacroCampuses(world, rooms, state);
  createCayleyHqClusters(world, macroRooms, state);
  createCayleyLatticeBooths(world);
  connectCayleyGraph(world, rooms, state);
  connectCayleyMacroGraph(world, macroRooms, state);
  tuneInitialZones(world);
  populateAuthoredContent(world, entities, rooms, state);
  registerCayleyRouteCue(world, rooms);
  ensureConnectivity(world, spawnX, spawnY);
  sanitizeDoors(world);
  retainLiveCayleyDoorIds(world, state);
  world.rebuildContainerMap();
  world.bakeLights();

  return {
    world,
    entities,
    spawnX,
    spawnY,
    cayleyState: state,
  };
}
