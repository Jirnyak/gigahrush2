/* ── Future design floor: Хтонический чердак ─────────────────── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  W, Cell, Tex, Feature, DoorState, LiftDirection,
  FloorLevel, RoomType, EntityType, AIGoal, Faction, Occupation,
  QuestType, ContainerKind, MonsterKind, ZoneFaction,
  type Entity, type GameState, type Room, type TerritoryOwner, type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { publishEvent } from '../../systems/events';
import { generateZones } from '../shared';
import { genLog } from '../log';
import { setTerritoryOwnerAtIndex, syncZoneMetadataFromTerritory } from '../../systems/territory';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('chthonic_attic');

export const DESIGN_FLOOR_ID = 'chthonic_attic' as const;
export const DESIGN_FLOOR_Z = 46;

export type ChthonicAtticRootChoice = 'cut' | 'feed' | 'burn';

export interface ChthonicAtticShelterCost {
  kind: 'item' | 'hp' | 'reputation' | 'delay';
  itemId?: string;
  count?: number;
  amount?: number;
  seconds?: number;
}

export interface ChthonicAtticRootState {
  choice: ChthonicAtticRootChoice;
  shelterCost: ChthonicAtticShelterCost;
  shelterRoomIds: number[];
  sealedRoomIds: number[];
  burntRoomIds: number[];
  blockedDoorIdxs: number[];
  oneWayDoorIdxs: number[];
  crossFloorFlag: string;
}

export interface ChthonicAtticExit {
  id: 'ministry_return' | 'roof_service' | 'crawl_hatch';
  idx: number;
}

export interface ChthonicAtticRouteCheck {
  choice: ChthonicAtticRootChoice;
  exitId: ChthonicAtticExit['id'];
  reachable: boolean;
  distance: number;
}

export interface ChthonicAtticLayout {
  routeId: typeof DESIGN_FLOOR_ID;
  z: typeof DESIGN_FLOOR_Z;
  spawnRoomId: number;
  combatLaneCells: number[];
  crawlRouteCells: number[];
  exitCells: ChthonicAtticExit[];
  npcRoomIds: Record<'rootkeeper' | 'deacon' | 'yura' | 'masha', number>;
  rootRoomId: number;
  shrineRoomId: number;
  shelterRoomId: number;
  evidenceRoomId: number;
  rootDoorIdx: number;
  shrineDoorIdx: number;
  shelterDoorIdx: number;
  crawlDoorIdxs: number[];
}

export interface ChthonicAtticGeneration {
  world: World;
  entities: Entity[];
  spawnX: number;
  spawnY: number;
  layout: ChthonicAtticLayout;
  rootState: ChthonicAtticRootState;
  routeChecks: ChthonicAtticRouteCheck[];
  debug: {
    routeId: typeof DESIGN_FLOOR_ID;
    z: typeof DESIGN_FLOOR_Z;
    entry: string;
  };
}

const ATTIC_BASE_X = (W >> 1) - 104;
const ATTIC_BASE_Y = (W >> 1) - 64;
const MAIN_Y = ATTIC_BASE_Y + 58;

const DIRS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

interface AtticPoint {
  x: number;
  y: number;
}

interface AtticChamberPlan {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  anchor: AtticPoint;
  type: RoomType;
  name: string;
  wallTex: Tex;
  floorTex: Tex;
  feature: Feature;
}

const ATTIC_SPINE: readonly AtticPoint[] = [
  { x: ATTIC_BASE_X + 18, y: MAIN_Y },
  { x: ATTIC_BASE_X + 78, y: MAIN_Y - 22 },
  { x: ATTIC_BASE_X + 144, y: MAIN_Y + 6 },
  { x: ATTIC_BASE_X + 212, y: MAIN_Y - 10 },
  { x: 700, y: 536 },
  { x: 780, y: 516 },
  { x: 866, y: 466 },
  { x: 948, y: 492 },
  { x: 34, y: 490 },
  { x: 112, y: 530 },
  { x: 194, y: 508 },
  { x: 286, y: 548 },
  { x: ATTIC_BASE_X + 18, y: MAIN_Y },
];

const ATTIC_CHAMBERS: readonly AtticChamberPlan[] = [
  {
    cx: 314, cy: 548, rx: 20, ry: 10,
    anchor: { x: 286, y: 548 },
    type: RoomType.CORRIDOR,
    name: 'Корневое горло западной плиты',
    wallTex: Tex.GUT,
    floorTex: Tex.F_GUT,
    feature: Feature.CANDLE,
  },
  {
    cx: 848, cy: 466, rx: 24, ry: 9,
    anchor: { x: 866, y: 466 },
    type: RoomType.CORRIDOR,
    name: 'Корневое горло восточного обхода',
    wallTex: Tex.GUT,
    floorTex: Tex.F_GUT,
    feature: Feature.CANDLE,
  },
  {
    cx: 704, cy: 574, rx: 25, ry: 17,
    anchor: { x: 700, y: 536 },
    type: RoomType.COMMON,
    name: 'Бетонное гнездо с пустым центром',
    wallTex: Tex.CONCRETE,
    floorTex: Tex.F_CONCRETE,
    feature: Feature.LAMP,
  },
  {
    cx: 190, cy: 590, rx: 22, ry: 15,
    anchor: { x: 194, y: 508 },
    type: RoomType.COMMON,
    name: 'Бетонное гнездо несущей жилы',
    wallTex: Tex.CONCRETE,
    floorTex: Tex.F_GUT,
    feature: Feature.CANDLE,
  },
  {
    cx: 540, cy: 356, rx: 18, ry: 8,
    anchor: { x: ATTIC_BASE_X + 144, y: MAIN_Y + 6 },
    type: RoomType.CORRIDOR,
    name: 'Низкий сервисный лаз над актом',
    wallTex: Tex.PANEL,
    floorTex: Tex.F_CONCRETE,
    feature: Feature.APPARATUS,
  },
  {
    cx: 984, cy: 492, rx: 18, ry: 7,
    anchor: { x: 948, y: 492 },
    type: RoomType.CORRIDOR,
    name: 'Сервисный лаз через край чердака',
    wallTex: Tex.PANEL,
    floorTex: Tex.F_CONCRETE,
    feature: Feature.APPARATUS,
  },
  {
    cx: 766, cy: 394, rx: 18, ry: 14,
    anchor: { x: 780, y: 516 },
    type: RoomType.STORAGE,
    name: 'Ритуальная кладовая сухих корешков',
    wallTex: Tex.DARK,
    floorTex: Tex.F_GUT,
    feature: Feature.SHELF,
  },
  {
    cx: 72, cy: 430, rx: 16, ry: 12,
    anchor: { x: 34, y: 490 },
    type: RoomType.STORAGE,
    name: 'Ритуальная кладовая черной ладони',
    wallTex: Tex.DARK,
    floorTex: Tex.F_CONCRETE,
    feature: Feature.SHELF,
  },
  {
    cx: 514, cy: 82, rx: 23, ry: 16,
    anchor: { x: 540, y: 356 },
    type: RoomType.CORRIDOR,
    name: 'Сломанный лестничный оголовок вверх',
    wallTex: Tex.METAL,
    floorTex: Tex.F_CONCRETE,
    feature: Feature.LAMP,
  },
  {
    cx: 902, cy: 650, rx: 20, ry: 12,
    anchor: { x: 866, y: 466 },
    type: RoomType.PRODUCTION,
    name: 'Ложная сервисная комната',
    wallTex: Tex.METAL,
    floorTex: Tex.F_CONCRETE,
    feature: Feature.MACHINE,
  },
  {
    cx: 458, cy: 402, rx: 16, ry: 18,
    anchor: { x: ATTIC_BASE_X + 78, y: MAIN_Y - 22 },
    type: RoomType.PRODUCTION,
    name: 'Шахта кабельного давления',
    wallTex: Tex.PIPE,
    floorTex: Tex.F_CONCRETE,
    feature: Feature.APPARATUS,
  },
  {
    cx: 604, cy: 474, rx: 21, ry: 10,
    anchor: { x: 590, y: 476 },
    type: RoomType.PRODUCTION,
    name: 'Кабельная развилка гудящего корня',
    wallTex: Tex.PIPE,
    floorTex: Tex.F_GUT,
    feature: Feature.MACHINE,
  },
  {
    cx: 620, cy: 642, rx: 18, ry: 13,
    anchor: { x: 700, y: 536 },
    type: RoomType.STORAGE,
    name: 'Запечатанный карман фильтров',
    wallTex: Tex.METAL,
    floorTex: Tex.F_CONCRETE,
    feature: Feature.SHELF,
  },
  {
    cx: 438, cy: 842, rx: 20, ry: 12,
    anchor: { x: 410, y: 918 },
    type: RoomType.STORAGE,
    name: 'Склад шахтных уплотнителей',
    wallTex: Tex.CONCRETE,
    floorTex: Tex.F_CONCRETE,
    feature: Feature.SHELF,
  },
  {
    cx: 820, cy: 736, rx: 18, ry: 16,
    anchor: { x: 902, y: 650 },
    type: RoomType.PRODUCTION,
    name: 'Пульт старых вытяжных лопаток',
    wallTex: Tex.PIPE,
    floorTex: Tex.F_CONCRETE,
    feature: Feature.APPARATUS,
  },
  {
    cx: 252, cy: 398, rx: 20, ry: 9,
    anchor: { x: 194, y: 508 },
    type: RoomType.CORRIDOR,
    name: 'Низкая полка под корнем связи',
    wallTex: Tex.GUT,
    floorTex: Tex.F_GUT,
    feature: Feature.CANDLE,
  },
  {
    cx: 662, cy: 424, rx: 14, ry: 7,
    anchor: { x: 638, y: 482 },
    type: RoomType.CORRIDOR,
    name: 'Сдавленная развилка ползучего графа',
    wallTex: Tex.PANEL,
    floorTex: Tex.F_CONCRETE,
    feature: Feature.APPARATUS,
  },
  {
    cx: 722, cy: 426, rx: 13, ry: 8,
    anchor: { x: 662, y: 424 },
    type: RoomType.STORAGE,
    name: 'Ниша сухих кабельных реликвий',
    wallTex: Tex.DARK,
    floorTex: Tex.F_CONCRETE,
    feature: Feature.SHELF,
  },
  {
    cx: 578, cy: 522, rx: 13, ry: 8,
    anchor: { x: 590, y: 476 },
    type: RoomType.STORAGE,
    name: 'Карман корневого подкорма',
    wallTex: Tex.GUT,
    floorTex: Tex.F_GUT,
    feature: Feature.CANDLE,
  },
  {
    cx: 126, cy: 606, rx: 12, ry: 7,
    anchor: { x: 112, y: 530 },
    type: RoomType.COMMON,
    name: 'Поклонная ниша за черной ладонью',
    wallTex: Tex.GUT,
    floorTex: Tex.F_GUT,
    feature: Feature.CANDLE,
  },
  {
    cx: 970, cy: 548, rx: 13, ry: 8,
    anchor: { x: 948, y: 492 },
    type: RoomType.STORAGE,
    name: 'Тайник под сервисным переломом',
    wallTex: Tex.METAL,
    floorTex: Tex.F_CONCRETE,
    feature: Feature.SHELF,
  },
];

const ATTIC_ECOLOGY_ANCHORS: readonly AtticPoint[] = [
  ...ATTIC_SPINE,
  { x: 638, y: 482 },
  { x: 52, y: 538 },
  { x: 524, y: 930 },
  { x: 458, y: 402 },
  { x: 604, y: 474 },
  { x: 620, y: 642 },
  { x: 438, y: 842 },
  { x: 820, y: 736 },
  { x: 252, y: 398 },
  { x: 662, y: 424 },
  { x: 722, y: 426 },
  { x: 578, y: 522 },
  { x: 126, y: 606 },
  { x: 970, y: 548 },
];

interface AtticCrawlNichePlan {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  floorTex: Tex;
  wallTex: Tex;
  feature: Feature;
}

interface AtticCapillarySeed {
  x: number;
  y: number;
  dx: number;
  dy: number;
  root: boolean;
}

interface AtticServiceIslandPlan {
  owner: TerritoryOwner;
  prefix: string;
  cx: number;
  cy: number;
  connect: AtticPoint;
  wallTex: Tex;
  floorTex: Tex;
  coreFeature: Feature;
}

interface AtticMicroBlockPlan {
  cx: number;
  cy: number;
  connect: AtticPoint;
  owner: TerritoryOwner;
  wallTex: Tex;
  floorTex: Tex;
  name: string;
}

interface AtticTerritoryTarget {
  owner: TerritoryOwner;
  share: number;
  anchors: readonly AtticPoint[];
}

type RoomSide = 'north' | 'south' | 'west' | 'east';

const ATTIC_STEALTH_CRAWL_GRAPH: readonly [AtticPoint, AtticPoint][] = [
  [{ x: ATTIC_BASE_X + 52, y: MAIN_Y - 50 }, { x: ATTIC_BASE_X + 116, y: MAIN_Y - 72 }],
  [{ x: ATTIC_BASE_X + 116, y: MAIN_Y - 72 }, { x: ATTIC_BASE_X + 172, y: MAIN_Y - 54 }],
  [{ x: ATTIC_BASE_X + 172, y: MAIN_Y - 54 }, { x: ATTIC_BASE_X + 214, y: MAIN_Y - 10 }],
  [{ x: ATTIC_BASE_X + 116, y: MAIN_Y - 72 }, { x: 458, y: 402 }],
  [{ x: 458, y: 402 }, { x: 545, y: 458 }],
  [{ x: 545, y: 458 }, { x: 604, y: 474 }],
  [{ x: 604, y: 474 }, { x: 662, y: 424 }],
  [{ x: 662, y: 424 }, { x: 722, y: 426 }],
  [{ x: 662, y: 424 }, { x: 746, y: 500 }],
  [{ x: 112, y: 530 }, { x: 126, y: 606 }],
  [{ x: 126, y: 606 }, { x: 194, y: 590 }],
  [{ x: 948, y: 492 }, { x: 970, y: 548 }],
  [{ x: 970, y: 548 }, { x: 42, y: 548 }],
];

const ATTIC_CRAWL_NICHES: readonly AtticCrawlNichePlan[] = [
  { cx: ATTIC_BASE_X + 116, cy: MAIN_Y - 72, rx: 4, ry: 2, floorTex: Tex.F_CONCRETE, wallTex: Tex.PANEL, feature: Feature.APPARATUS },
  { cx: 545, cy: 458, rx: 5, ry: 2, floorTex: Tex.F_CONCRETE, wallTex: Tex.PIPE, feature: Feature.SHELF },
  { cx: 662, cy: 424, rx: 4, ry: 2, floorTex: Tex.F_CONCRETE, wallTex: Tex.PANEL, feature: Feature.APPARATUS },
  { cx: 722, cy: 426, rx: 4, ry: 2, floorTex: Tex.F_CONCRETE, wallTex: Tex.DARK, feature: Feature.SHELF },
  { cx: 126, cy: 606, rx: 4, ry: 2, floorTex: Tex.F_GUT, wallTex: Tex.GUT, feature: Feature.CANDLE },
  { cx: 970, cy: 548, rx: 5, ry: 2, floorTex: Tex.F_CONCRETE, wallTex: Tex.METAL, feature: Feature.SHELF },
];

const ATTIC_CAPILLARY_SEEDS: readonly AtticCapillarySeed[] = [
  { x: 314, y: 548, dx: 1, dy: -1, root: true },
  { x: 704, y: 574, dx: -1, dy: -1, root: true },
  { x: 848, y: 466, dx: -1, dy: 1, root: true },
  { x: 126, y: 606, dx: 1, dy: 0, root: true },
  { x: 604, y: 474, dx: 1, dy: 0, root: false },
  { x: 458, y: 402, dx: 1, dy: 1, root: false },
  { x: 820, y: 736, dx: -1, dy: -1, root: false },
  { x: 970, y: 548, dx: 1, dy: 0, root: false },
];

const ATTIC_SERVICE_ISLANDS: readonly AtticServiceIslandPlan[] = [
  {
    owner: ZoneFaction.CITIZEN,
    prefix: 'Гражданский чердачный приют',
    cx: 178,
    cy: 760,
    connect: { x: 190, y: 590 },
    wallTex: Tex.PANEL,
    floorTex: Tex.F_LINO,
    coreFeature: Feature.TABLE,
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    prefix: 'Ликвидаторский пост люка',
    cx: 832,
    cy: 276,
    connect: { x: 766, y: 394 },
    wallTex: Tex.METAL,
    floorTex: Tex.F_CONCRETE,
    coreFeature: Feature.DESK,
  },
  {
    owner: ZoneFaction.CULTIST,
    prefix: 'Культовая сухая ниша',
    cx: 336,
    cy: 330,
    connect: { x: 252, y: 398 },
    wallTex: Tex.GUT,
    floorTex: Tex.F_GUT,
    coreFeature: Feature.CANDLE,
  },
  {
    owner: ZoneFaction.SCIENTIST,
    prefix: 'НИИ измерительная капсула',
    cx: 596,
    cy: 792,
    connect: { x: 438, y: 842 },
    wallTex: Tex.TILE_W,
    floorTex: Tex.F_TILE,
    coreFeature: Feature.SCREEN,
  },
  {
    owner: ZoneFaction.WILD,
    prefix: 'Дикий чердачный стан',
    cx: 890,
    cy: 836,
    connect: { x: 820, y: 736 },
    wallTex: Tex.DARK,
    floorTex: Tex.F_CONCRETE,
    coreFeature: Feature.SHELF,
  },
];

const ATTIC_WILD_OUTPOSTS: readonly AtticPoint[] = [
  { x: 260, y: 890 },
  { x: 744, y: 626 },
];

const ATTIC_MICRO_BLOCKS: readonly AtticMicroBlockPlan[] = [
  { cx: 96, cy: 220, connect: { x: 252, y: 398 }, owner: ZoneFaction.WILD, wallTex: Tex.DARK, floorTex: Tex.F_CONCRETE, name: 'северо-западный глухой короб' },
  { cx: 202, cy: 286, connect: { x: 252, y: 398 }, owner: ZoneFaction.CULTIST, wallTex: Tex.GUT, floorTex: Tex.F_GUT, name: 'сухой исповедальный короб' },
  { cx: 458, cy: 208, connect: { x: 514, y: 82 }, owner: ZoneFaction.SCIENTIST, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE, name: 'узел старых датчиков' },
  { cx: 640, cy: 188, connect: { x: 514, y: 82 }, owner: ZoneFaction.LIQUIDATOR, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE, name: 'пост верхней балки' },
  { cx: 944, cy: 230, connect: { x: 832, y: 276 }, owner: ZoneFaction.WILD, wallTex: Tex.DARK, floorTex: Tex.F_CONCRETE, name: 'краевой разлом сменщиков' },
  { cx: 118, cy: 374, connect: { x: 72, y: 430 }, owner: ZoneFaction.CULTIST, wallTex: Tex.GUT, floorTex: Tex.F_GUT, name: 'черная кладовая ладони' },
  { cx: 430, cy: 326, connect: { x: 458, y: 402 }, owner: ZoneFaction.SCIENTIST, wallTex: Tex.PIPE, floorTex: Tex.F_CONCRETE, name: 'шумомерный карман' },
  { cx: 590, cy: 330, connect: { x: 662, y: 424 }, owner: ZoneFaction.LIQUIDATOR, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE, name: 'короткий пост растяжек' },
  { cx: 914, cy: 386, connect: { x: 866, y: 466 }, owner: ZoneFaction.WILD, wallTex: Tex.DARK, floorTex: Tex.F_CONCRETE, name: 'обход рваной вентиляции' },
  { cx: 182, cy: 486, connect: { x: 194, y: 508 }, owner: ZoneFaction.CITIZEN, wallTex: Tex.PANEL, floorTex: Tex.F_LINO, name: 'жилой карман сторожей' },
  { cx: 382, cy: 514, connect: { x: ATTIC_BASE_X + 18, y: MAIN_Y }, owner: ZoneFaction.CITIZEN, wallTex: Tex.PANEL, floorTex: Tex.F_CONCRETE, name: 'низкая бытовая связка' },
  { cx: 520, cy: 552, connect: { x: 604, y: 474 }, owner: ZoneFaction.CULTIST, wallTex: Tex.GUT, floorTex: Tex.F_GUT, name: 'узел корневого подкорма' },
  { cx: 742, cy: 548, connect: { x: 704, y: 574 }, owner: ZoneFaction.WILD, wallTex: Tex.DARK, floorTex: Tex.F_CONCRETE, name: 'разобранный вентдвор' },
  { cx: 88, cy: 652, connect: { x: 126, y: 606 }, owner: ZoneFaction.WILD, wallTex: Tex.DARK, floorTex: Tex.F_CONCRETE, name: 'обваленный бытовой карман' },
  { cx: 326, cy: 678, connect: { x: 190, y: 590 }, owner: ZoneFaction.CITIZEN, wallTex: Tex.PANEL, floorTex: Tex.F_LINO, name: 'очередь за кипятком' },
  { cx: 502, cy: 696, connect: { x: 620, y: 642 }, owner: ZoneFaction.SCIENTIST, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE, name: 'лабораторный короб пыли' },
  { cx: 692, cy: 704, connect: { x: 704, y: 574 }, owner: ZoneFaction.WILD, wallTex: Tex.DARK, floorTex: Tex.F_CONCRETE, name: 'низкая стая шахты' },
  { cx: 966, cy: 700, connect: { x: 902, y: 650 }, owner: ZoneFaction.WILD, wallTex: Tex.DARK, floorTex: Tex.F_CONCRETE, name: 'краевой стан мародеров' },
  { cx: 102, cy: 842, connect: { x: 178, y: 760 }, owner: ZoneFaction.CITIZEN, wallTex: Tex.PANEL, floorTex: Tex.F_LINO, name: 'семейный тайник на балках' },
  { cx: 356, cy: 822, connect: { x: 438, y: 842 }, owner: ZoneFaction.LIQUIDATOR, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE, name: 'нижний пост прожига' },
  { cx: 706, cy: 888, connect: { x: 596, y: 792 }, owner: ZoneFaction.SCIENTIST, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE, name: 'капсула мокрых журналов' },
  { cx: 956, cy: 918, connect: { x: 890, y: 836 }, owner: ZoneFaction.WILD, wallTex: Tex.DARK, floorTex: Tex.F_CONCRETE, name: 'ночлежка краевого люка' },
];

const ATTIC_TERRITORY_TARGETS: readonly AtticTerritoryTarget[] = [
  { owner: ZoneFaction.CITIZEN, share: 0.18, anchors: [{ x: 178, y: 760 }, { x: 182, y: 486 }, { x: 382, y: 514 }] },
  { owner: ZoneFaction.LIQUIDATOR, share: 0.24, anchors: [{ x: 832, y: 276 }, { x: ATTIC_BASE_X + 185, y: ATTIC_BASE_Y + 36 }, { x: 356, y: 822 }, { x: 640, y: 188 }] },
  { owner: ZoneFaction.CULTIST, share: 0.14, anchors: [{ x: 336, y: 330 }, { x: ATTIC_BASE_X + 158, y: ATTIC_BASE_Y + 81 }, { x: 520, y: 552 }] },
  { owner: ZoneFaction.SCIENTIST, share: 0.10, anchors: [{ x: 596, y: 792 }, { x: 502, y: 696 }, { x: 458, y: 208 }] },
  { owner: ZoneFaction.WILD, share: 0.34, anchors: [{ x: 890, y: 836 }, { x: 260, y: 890 }, { x: 744, y: 626 }, { x: 944, y: 230 }] },
];

const ATTIC_NPCS: Record<string, PlotNpcDef> = {
  attic_agrafena_rootkeeper: {
    name: 'Аграфена Корневая',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.STOREKEEPER,
    sprite: Occupation.STOREKEEPER,
    hp: 140, maxHp: 140, money: 45, speed: 0.75,
    inventory: [
      { defId: 'gear', count: 2 },
      { defId: 'wire_coil', count: 2 },
      { defId: 'hermo_gasket', count: 1 },
    ],
    talkLines: [
      'Корень держит плиту не хуже балки. Срубите чужой - крыша даст трещину там, где стояли люди.',
      'Накормить корень дешевле, чем чинить пролёт. Только потом он попросит фамилию.',
      'Сервисный этаж любит детали. Ад любит реликвии. Чердак любит, когда выбирают быстро.',
    ],
    talkLinesPost: [
      'Теперь ход открыт. Если потолок вздохнет, не отвечайте.',
      'Срез сухой - значит, ниже кто-то будет ругаться на щель.',
    ],
  },
  attic_deacon_ostap: {
    name: 'Дьякон Остап',
    isFemale: false,
    faction: Faction.CULTIST,
    occupation: Occupation.PRIEST,
    sprite: Occupation.PRIEST,
    hp: 160, maxHp: 160, money: 30, speed: 0.7,
    inventory: [
      { defId: 'denunciation', count: 1 },
      { defId: 'meat_rune', count: 1 },
      { defId: 'holy_water', count: 1 },
    ],
    talkLines: [
      'В нише тесно, зато самосбор считает нас частью стены.',
      'Свидетельство оставите - дверь подумает, что вы свой.',
      'Не всякий культ молится. Некоторые просто правильно оформляют страх.',
    ],
    talkLinesPost: [
      'Укрытие примет вас медленно. Медленная дверь честнее быстрой.',
      'Черная ладонь уже на стене. Осталось выбрать, кому она будет уликой.',
    ],
  },
  attic_cable_boy_yura: {
    name: 'Юра Кабельный',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.CHILD,
    sprite: Occupation.CHILD,
    hp: 80, maxHp: 80, money: 7, speed: 1.55,
    inventory: [
      { defId: 'fuse', count: 1 },
      { defId: 'siren_instruction', count: 1 },
    ],
    talkLines: [
      'По большому коридору стреляют. По маленькому - ползут и молчат.',
      'Я знаю лаз, где кабели теплые. Если сирена начнет считать, идем сразу.',
      'Не берите рюкзак. Корень рюкзак слышит первым.',
    ],
    talkLinesPost: [
      'Лаз еще дышит. Значит, мы прошли вовремя.',
      'Если дверь стала уже, идите боком и не спорьте.',
    ],
  },
  attic_liquidator_masha: {
    name: 'Маша Прожиг',
    isFemale: true,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 240, maxHp: 240, money: 90, speed: 1.0,
    inventory: [
      { defId: 'ammo_fuel', count: 1 },
      { defId: 'makarov', count: 1 },
      { defId: 'ammo_9mm', count: 10 },
    ],
    talkLines: [
      'Жечь надо контуром, а не верой. Иначе дым пойдет вниз по лифту.',
      'Ниша не храм, а пробка. Прожжем - получим проход и злых соседей.',
      'Корень после огня не растет. Только копоть остается на потолке.',
    ],
    talkLinesPost: [
      'Обуглилось ровно. Почти без крика бетона.',
      'Если снизу спросят, это была профилактика, не крестовый поход.',
    ],
  },
};

let contentRegistered = false;

export function registerChthonicAtticContent(): void {
  if (contentRegistered) return;
  contentRegistered = true;

  registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'attic_agrafena_rootkeeper', ATTIC_NPCS.attic_agrafena_rootkeeper, [
    {
      id: 'attic_cut_or_feed_root',
      giverNpcId: 'attic_agrafena_rootkeeper',
      type: QuestType.FETCH,
      desc: 'Аграфена Корневая: «Две шестерни. Срежем несущий корень аккуратно; детали уйдут на сервисный этаж, реликвия останется за бетоном.»',
      targetItem: 'gear', targetCount: 2,
      rewardItem: 'hermo_gasket', rewardCount: 1,
      extraRewards: [{ defId: 'wire_coil', count: 1 }],
      relationDelta: 10, xpReward: 70, moneyReward: 80,
    },
  ]);

  registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'attic_deacon_ostap', ATTIC_NPCS.attic_deacon_ostap, [
    {
      id: 'attic_black_hand_report',
      giverNpcId: 'attic_deacon_ostap',
      type: QuestType.FETCH,
      desc: 'Дьякон Остап: «Принесите донос или акт о черной ладони. Министерство назовет это уликой, мы - платой за укрытие.»',
      targetItem: 'denunciation', targetCount: 1,
      rewardItem: 'meat_rune', rewardCount: 1,
      extraRewards: [{ defId: 'holy_water', count: 1 }],
      relationDelta: 8, xpReward: 65, moneyReward: 40,
    },
  ]);

  registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'attic_cable_boy_yura', ATTIC_NPCS.attic_cable_boy_yura, [
    {
      id: 'attic_crawl_escort',
      giverNpcId: 'attic_cable_boy_yura',
      type: QuestType.VISIT,
      desc: 'Юра Кабельный: «Проведите меня через низкий кабельный лаз во время предупреждения. Большой коридор пусть шумит без нас.»',
      targetRoomType: RoomType.CORRIDOR,
      targetRoomName: 'Низкий кабельный лаз',
      rewardItem: 'fuse', rewardCount: 1,
      extraRewards: [{ defId: 'siren_instruction', count: 1 }],
      relationDelta: 12, xpReward: 75, moneyReward: 35,
    },
  ]);

  registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'attic_liquidator_masha', ATTIC_NPCS.attic_liquidator_masha, [
    {
      id: 'attic_burn_niche',
      giverNpcId: 'attic_liquidator_masha',
      type: QuestType.FETCH,
      desc: 'Маша Прожиг: «Канистру топлива. Сожжем нишу по контуру: дым, вражда культистов, зато проход не затянет.»',
      targetItem: 'ammo_fuel', targetCount: 1,
      rewardItem: 'ammo_9mm', rewardCount: 12,
      extraRewards: [{ defId: 'bandage', count: 2 }],
      relationDelta: 14, xpReward: 90, moneyReward: 110,
      spawnMonstersOnAccept: 2,
    },
  ]);
}

registerChthonicAtticContent();

export function generateChthonicAtticDesignFloor(
  rootChoice: ChthonicAtticRootChoice = 'cut',
): ChthonicAtticGeneration {
  const world = new World();
  const entities: Entity[] = [];
  let nextRoomId = 0;
  let nextEntityId = 1;

  fillBaseTextures(world);

  const spawn = stampRoom(world, nextRoomId++, RoomType.COMMON, ATTIC_BASE_X + 2, ATTIC_BASE_Y + 48, 18, 18, 'Предчердачный тамбур', Tex.CONCRETE, Tex.F_CONCRETE);
  const rootkeeper = stampRoom(world, nextRoomId++, RoomType.STORAGE, ATTIC_BASE_X + 32, ATTIC_BASE_Y + 30, 18, 12, 'Комната хранительницы корней', Tex.CONCRETE, Tex.F_WOOD);
  const crawlA = stampRoom(world, nextRoomId++, RoomType.CORRIDOR, ATTIC_BASE_X + 42, ATTIC_BASE_Y + 8, 15, 8, 'Низкий кабельный лаз A', Tex.PANEL, Tex.F_CONCRETE);
  const crawlB = stampRoom(world, nextRoomId++, RoomType.CORRIDOR, ATTIC_BASE_X + 88, ATTIC_BASE_Y + 10, 20, 7, 'Низкий кабельный лаз B', Tex.PANEL, Tex.F_CONCRETE);
  const crawlC = stampRoom(world, nextRoomId++, RoomType.CORRIDOR, ATTIC_BASE_X + 138, ATTIC_BASE_Y + 12, 18, 8, 'Низкий кабельный лаз C', Tex.PANEL, Tex.F_CONCRETE);
  const rootNursery = stampRoom(world, nextRoomId++, RoomType.PRODUCTION, ATTIC_BASE_X + 108, ATTIC_BASE_Y + 28, 24, 16, 'Гнездо бетонного корня', Tex.GUT, Tex.F_GUT);
  const deacon = stampRoom(world, nextRoomId++, RoomType.OFFICE, ATTIC_BASE_X + 72, ATTIC_BASE_Y + 72, 22, 14, 'Ниша свидетельских ведомостей', Tex.MARBLE, Tex.F_RED_CARPET);
  const evidence = stampRoom(world, nextRoomId++, RoomType.STORAGE, ATTIC_BASE_X + 112, ATTIC_BASE_Y + 76, 18, 12, 'Запертая кладовая черной ладони', Tex.DARK, Tex.F_CONCRETE);
  const shrine = stampRoom(world, nextRoomId++, RoomType.COMMON, ATTIC_BASE_X + 148, ATTIC_BASE_Y + 74, 20, 14, 'Корневая молельная ниша', Tex.GUT, Tex.F_GUT);
  const masha = stampRoom(world, nextRoomId++, RoomType.HQ, ATTIC_BASE_X + 174, ATTIC_BASE_Y + 30, 22, 13, 'Пост контролируемого прожига', Tex.METAL, Tex.F_CONCRETE);
  const exitRoom = stampRoom(world, nextRoomId++, RoomType.CORRIDOR, ATTIC_BASE_X + 206, ATTIC_BASE_Y + 50, 17, 17, 'Служебная развязка крыши', Tex.METAL, Tex.F_CONCRETE);

  const combatLaneCells = carveCombatLane(world, ATTIC_BASE_X + 20, ATTIC_BASE_X + 206, MAIN_Y);
  const crawlRouteCells = carveCrawlRoute(world, spawn, crawlA, crawlB, crawlC, masha, exitRoom);

  const spawnDoor = placeDoor(world, spawn.x + spawn.w, MAIN_Y, spawn.id, DoorState.OPEN);
  const rootkeeperDoor = connectRoomToLane(world, rootkeeper, rootkeeper.x + 8, 1);
  const rootDoorIdx = connectRoomToLane(world, rootNursery, rootNursery.x + 12, 1);
  const deaconDoor = connectRoomToLane(world, deacon, deacon.x + 11, -1);
  connectRoomToLane(world, evidence, evidence.x + 8, -1);
  const shrineDoorIdx = connectRoomToLane(world, shrine, shrine.x + 10, -1);
  const mashaDoor = connectRoomToLane(world, masha, masha.x + 11, 1);
  const exitDoor = placeDoor(world, exitRoom.x - 1, MAIN_Y, exitRoom.id, DoorState.OPEN);

  const crawlDoorIdxs = [
    placeDoor(world, spawn.x + 9, spawn.y - 1, spawn.id, DoorState.OPEN),
    placeDoor(world, crawlA.x - 1, crawlA.y + 4, crawlA.id, DoorState.CLOSED),
    placeDoor(world, crawlA.x + crawlA.w, crawlA.y + 4, crawlA.id, DoorState.CLOSED),
    placeDoor(world, crawlB.x - 1, crawlB.y + 3, crawlB.id, DoorState.CLOSED),
    placeDoor(world, crawlB.x + crawlB.w, crawlB.y + 3, crawlB.id, DoorState.CLOSED),
    placeDoor(world, crawlC.x - 1, crawlC.y + 4, crawlC.id, DoorState.CLOSED),
    placeDoor(world, crawlC.x + crawlC.w, crawlC.y + 4, crawlC.id, DoorState.CLOSED),
    placeDoor(world, masha.x + 11, masha.y - 1, masha.id, DoorState.CLOSED),
    spawnDoor,
    rootkeeperDoor,
    mashaDoor,
    exitDoor,
  ];

  const exits: ChthonicAtticExit[] = [
    { id: 'ministry_return', idx: placeExitLift(world, spawn.x + 3, spawn.y + 9, LiftDirection.DOWN) },
    { id: 'roof_service', idx: placeExitLift(world, exitRoom.x + exitRoom.w - 3, exitRoom.y + 8, LiftDirection.UP) },
    { id: 'crawl_hatch', idx: placeExitLift(world, crawlC.x + crawlC.w - 3, crawlC.y + 3, LiftDirection.UP) },
  ];

  decorateAttic(world, {
    spawn, rootkeeper, crawlA, crawlB, crawlC, rootNursery, deacon, evidence, shrine, masha, exitRoom,
  });
  stampRootObstacles(world, MAIN_Y);

  generateZones(world);
  retuneAtticZones(world, [rootNursery, deacon, shrine, masha]);

  addAtticContainers(world, rootkeeper, deacon, evidence, shrine, masha, rootChoice);

  nextEntityId = spawnNpc(entities, nextEntityId, 'attic_agrafena_rootkeeper', ATTIC_NPCS.attic_agrafena_rootkeeper, rootkeeper.x + 8.5, rootkeeper.y + 6.5);
  nextEntityId = spawnNpc(entities, nextEntityId, 'attic_deacon_ostap', ATTIC_NPCS.attic_deacon_ostap, deacon.x + 11.5, deacon.y + 7.5);
  nextEntityId = spawnNpc(entities, nextEntityId, 'attic_cable_boy_yura', ATTIC_NPCS.attic_cable_boy_yura, crawlA.x + 4.5, crawlA.y + 4.5);
  nextEntityId = spawnNpc(entities, nextEntityId, 'attic_liquidator_masha', ATTIC_NPCS.attic_liquidator_masha, masha.x + 11.5, masha.y + 6.5);

  nextEntityId = addItemDrop(entities, nextEntityId, 'wire_coil', 1, crawlB.x + 10.5, crawlB.y + 3.5);
  nextEntityId = addItemDrop(entities, nextEntityId, 'denunciation', 1, evidence.x + 9.5, evidence.y + 6.5);
  nextEntityId = addItemDrop(entities, nextEntityId, 'ammo_fuel', 1, masha.x + 16.5, masha.y + 6.5);

  nextEntityId = spawnMonster(entities, nextEntityId, MonsterKind.REBAR, rootNursery.x + 12.5, rootNursery.y + 8.5);
  nextEntityId = spawnMonster(entities, nextEntityId, MonsterKind.SHADOW, shrine.x + 10.5, shrine.y + 7.5);
  nextEntityId = spawnMonster(entities, nextEntityId, MonsterKind.SBORKA, ATTIC_BASE_X + 154.5, MAIN_Y + 0.5);
  nextEntityId = spawnMonster(entities, nextEntityId, MonsterKind.EYE, ATTIC_BASE_X + 188.5, MAIN_Y - 2.5);
  void nextEntityId;

  const layout: ChthonicAtticLayout = {
    routeId: DESIGN_FLOOR_ID,
    z: DESIGN_FLOOR_Z,
    spawnRoomId: spawn.id,
    combatLaneCells,
    crawlRouteCells,
    exitCells: exits,
    npcRoomIds: {
      rootkeeper: rootkeeper.id,
      deacon: deacon.id,
      yura: crawlA.id,
      masha: masha.id,
    },
    rootRoomId: rootNursery.id,
    shrineRoomId: shrine.id,
    shelterRoomId: deacon.id,
    evidenceRoomId: evidence.id,
    rootDoorIdx,
    shrineDoorIdx,
    shelterDoorIdx: deaconDoor,
    crawlDoorIdxs,
  };

  const rootState = applyChthonicAtticRootChoice(world, layout, rootChoice);
  world.bakeLights();

  const spawnX = spawn.x + 9.5;
  const spawnY = spawn.y + 9.5;
  const routeChecks = traceChthonicAtticExitPaths(world, spawnX, spawnY, layout, rootChoice);

  genLog(`[FLOOR02_CHTHONIC_ATTIC] ${DESIGN_FLOOR_ID} z=${DESIGN_FLOOR_Z} choice=${rootChoice} at (${spawn.x}, ${spawn.y})`);

  return {
    world,
    entities,
    spawnX,
    spawnY,
    layout,
    rootState,
    routeChecks,
    debug: {
      routeId: DESIGN_FLOOR_ID,
      z: DESIGN_FLOOR_Z,
      entry: `debug:${DESIGN_FLOOR_ID}:z${DESIGN_FLOOR_Z}:${rootChoice}`,
    },
  };
}

export function applyChthonicAtticRootChoice(
  world: World,
  layout: ChthonicAtticLayout,
  choice: ChthonicAtticRootChoice,
): ChthonicAtticRootState {
  const blockedDoorIdxs: number[] = [];
  const oneWayDoorIdxs: number[] = [];
  const sealedRoomIds: number[] = [];
  const burntRoomIds: number[] = [];
  let shelterCost: ChthonicAtticShelterCost;
  let crossFloorFlag: string;

  setDoorState(world, layout.rootDoorIdx, DoorState.CLOSED);
  setDoorState(world, layout.shrineDoorIdx, DoorState.CLOSED);
  setDoorState(world, layout.shelterDoorIdx, DoorState.CLOSED);
  for (const idx of layout.crawlDoorIdxs) setDoorState(world, idx, DoorState.CLOSED);

  if (choice === 'cut') {
    setDoorState(world, layout.rootDoorIdx, DoorState.OPEN);
    setDoorState(world, layout.shrineDoorIdx, DoorState.HERMETIC_CLOSED);
    blockedDoorIdxs.push(layout.shrineDoorIdx);
    sealedRoomIds.push(layout.shrineRoomId);
    world.rooms[layout.shrineRoomId].sealed = true;
    shelterCost = { kind: 'delay', seconds: 18 };
    crossFloorFlag = 'attic_roots_cut_service_parts';
  } else if (choice === 'feed') {
    setDoorState(world, layout.shrineDoorIdx, DoorState.OPEN);
    setDoorState(world, layout.shelterDoorIdx, DoorState.HERMETIC_OPEN);
    setDoorState(world, layout.rootDoorIdx, DoorState.HERMETIC_CLOSED);
    blockedDoorIdxs.push(layout.rootDoorIdx);
    sealedRoomIds.push(layout.rootRoomId, layout.shelterRoomId);
    world.rooms[layout.rootRoomId].sealed = true;
    world.rooms[layout.shelterRoomId].sealed = true;
    shelterCost = { kind: 'item', itemId: 'meat_rune', count: 1 };
    crossFloorFlag = 'attic_roots_fed_hell_relic';
  } else {
    setDoorState(world, layout.rootDoorIdx, DoorState.OPEN);
    setDoorState(world, layout.shrineDoorIdx, DoorState.OPEN);
    const tighteningDoor = layout.crawlDoorIdxs[4];
    setDoorState(world, tighteningDoor, DoorState.HERMETIC_CLOSED);
    blockedDoorIdxs.push(tighteningDoor);
    oneWayDoorIdxs.push(layout.crawlDoorIdxs[2], layout.crawlDoorIdxs[5]);
    burntRoomIds.push(layout.shrineRoomId);
    scorchRoom(world, world.rooms[layout.shrineRoomId]);
    shelterCost = { kind: 'hp', amount: 12 };
    crossFloorFlag = 'attic_shrine_burned_smoke';
  }

  return {
    choice,
    shelterCost,
    shelterRoomIds: [layout.shelterRoomId],
    sealedRoomIds,
    burntRoomIds,
    blockedDoorIdxs,
    oneWayDoorIdxs,
    crossFloorFlag,
  };
}

export function publishChthonicAtticRootChoice(
  state: GameState,
  rootState: ChthonicAtticRootState,
  roomId?: number,
  actorId?: number,
): void {
  publishEvent(state, {
    type: 'room_regrown',
    roomId,
    actorId,
    severity: 4,
    privacy: 'local',
    tags: [
      'design_floor',
      DESIGN_FLOOR_ID,
      `attic_${rootState.choice}`,
      rootState.crossFloorFlag,
    ],
    data: {
      routeId: DESIGN_FLOOR_ID,
      z: DESIGN_FLOOR_Z,
      choice: rootState.choice,
      crossFloorFlag: rootState.crossFloorFlag,
      sealedRoomIds: rootState.sealedRoomIds,
      burntRoomIds: rootState.burntRoomIds,
      shelterCost: rootState.shelterCost,
    },
  });
}

export function traceChthonicAtticExitPaths(
  world: World,
  spawnX: number,
  spawnY: number,
  layout: ChthonicAtticLayout,
  choice: ChthonicAtticRootChoice,
): ChthonicAtticRouteCheck[] {
  const start = world.idx(Math.floor(spawnX), Math.floor(spawnY));
  return layout.exitCells.map(exit => {
    const distance = shortestPathDistance(world, start, exit.idx);
    return {
      choice,
      exitId: exit.id,
      reachable: distance >= 0,
      distance,
    };
  });
}

export function expandChthonicAtticRootNetwork(
  world: World,
  entities: Entity[],
  rng: () => number,
): void {
  const protectedMask = buildAtticProtectedMask(world);

  carveAtticPathChain(world, ATTIC_SPINE, 3, Tex.F_GUT, protectedMask);
  carveAtticRootPath(world, { x: 514, y: 82 }, { x: 514, y: 986 }, 1, Tex.F_CONCRETE, protectedMask);
  carveAtticRootPath(world, { x: 410, y: 918 }, { x: 286, y: 548 }, 1, Tex.F_GUT, protectedMask);

  stampAtticVoidKnot(world, 638, 482, 19, protectedMask);
  stampAtticVoidKnot(world, 52, 538, 15, protectedMask);
  stampAtticVoidKnot(world, 524, 930, 17, protectedMask);

  const chambers = ATTIC_CHAMBERS.map(plan => stampAtticBulbRoom(world, plan));
  for (let i = 0; i < ATTIC_CHAMBERS.length; i++) {
    const plan = ATTIC_CHAMBERS[i];
    const room = chambers[i];
    carveAtticRootPath(world, plan.anchor, { x: plan.cx, y: plan.cy }, plan.type === RoomType.CORRIDOR ? 1 : 2, plan.floorTex, protectedMask);
    dressAtticBulbRoom(world, room, plan, rng);
  }
  fogAtticServiceCavities(world, chambers);
  seedAtticShaftCaches(world, chambers, rng);

  carveAtticCrawlBypasses(world, protectedMask);
  carveAtticStealthCrawlGraph(world, protectedMask);
  stampAtticRootStubs(world, protectedMask);
  stampAtticChokepoints(world, protectedMask);
  stampAtticLowCeilingShells(world);
  stampAtticCapillaryCracks(world, protectedMask, rng);
  stampAtticServiceIslands(world, protectedMask, rng);
  stampAtticExitCues(world);

  carveChthonicLabyrinth(world, protectedMask, rng);

  spawnAtticAmbientMonsters(world, entities, rng, 28);

  world.markCellsDirty();
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFeaturesDirty();
  world.markFogDirty();
}

export function retuneExpandedChthonicAtticEcology(world: World): void {
  for (const zone of world.zones) {
    const rootPressure = nearestAtticAnchorPressure(world, zone.cx, zone.cy, 190);
    const shaftPressure = nearestAtticAnchorPressure(world, zone.cx, zone.cy, 118);
    zone.level = rootPressure > 0.35 ? 5 : 4;
    zone.fogged = shaftPressure > 0.25;
  }

  applyChthonicAtticTerritory(world);
  syncZoneMetadataFromTerritory(world);
}

function buildAtticProtectedMask(world: World): Uint8Array {
  const mask = new Uint8Array(W * W);
  for (const room of world.rooms) {
    for (let y = room.y - 1; y <= room.y + room.h; y++) {
      for (let x = room.x - 1; x <= room.x + room.w; x++) {
        mask[world.idx(x, y)] = 1;
      }
    }
  }
  for (const idx of world.doors.keys()) mask[idx] = 1;
  for (const container of world.containers) mask[world.idx(container.x, container.y)] = 1;
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.LIFT) mask[i] = 1;
  }
  return mask;
}

function carveAtticPathChain(
  world: World,
  points: readonly AtticPoint[],
  radius: number,
  floorTex: Tex,
  protectedMask: Uint8Array,
): void {
  for (let i = 1; i < points.length; i++) {
    carveAtticRootPath(world, points[i - 1], points[i], radius, floorTex, protectedMask);
  }
}

function carveAtticRootPath(
  world: World,
  from: AtticPoint,
  to: AtticPoint,
  radius: number,
  floorTex: Tex,
  protectedMask: Uint8Array,
): void {
  const dx = world.delta(from.x, to.x);
  const dy = world.delta(from.y, to.y);
  const steps = Math.max(1, Math.abs(dx), Math.abs(dy));
  for (let step = 0; step <= steps; step++) {
    const x = from.x + Math.round((dx * step) / steps);
    const y = from.y + Math.round((dy * step) / steps);
    carveAtticDisc(world, x, y, radius, floorTex, protectedMask);
    if (step % 11 === 0) {
      stampSurfaceSplat(world, x, y, 0.5, 0.5, radius + 0.85, 0.18, x * 73856093 ^ y * 19349663, 58, 35, 28, true);
    }
  }
}

function carveAtticDisc(
  world: World,
  cx: number,
  cy: number,
  radius: number,
  floorTex: Tex,
  protectedMask: Uint8Array,
): void {
  const floorR2 = radius * radius;
  const shoulder = radius + 2;
  const shoulderR2 = shoulder * shoulder;
  for (let dy = -shoulder; dy <= shoulder; dy++) {
    for (let dx = -shoulder; dx <= shoulder; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > shoulderR2) continue;
      const idx = world.idx(cx + dx, cy + dy);
      if (protectedMask[idx] || world.cells[idx] === Cell.DOOR || world.cells[idx] === Cell.LIFT) continue;
      if (d2 <= floorR2) {
        world.cells[idx] = Cell.FLOOR;
        world.roomMap[idx] = -1;
        world.floorTex[idx] = floorTex;
        world.features[idx] = Feature.NONE;
      } else if (world.cells[idx] === Cell.WALL || world.cells[idx] === Cell.ABYSS) {
        world.cells[idx] = Cell.WALL;
        world.roomMap[idx] = -1;
        world.wallTex[idx] = (dx + dy + cx + cy) % 5 === 0 ? Tex.GUT : Tex.CONCRETE;
      }
    }
  }
}

function stampAtticVoidKnot(world: World, cx: number, cy: number, radius: number, protectedMask: Uint8Array): void {
  const loop: readonly AtticPoint[] = [
    { x: cx - radius - 7, y: cy },
    { x: cx - 4, y: cy - radius - 6 },
    { x: cx + radius + 7, y: cy - 2 },
    { x: cx + 3, y: cy + radius + 6 },
    { x: cx - radius - 7, y: cy },
  ];
  carveAtticPathChain(world, loop, 1, Tex.F_GUT, protectedMask);

  const r2 = radius * radius;
  const rim2 = (radius + 2) * (radius + 2);
  for (let dy = -radius - 2; dy <= radius + 2; dy++) {
    for (let dx = -radius - 2; dx <= radius + 2; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > rim2) continue;
      const idx = world.idx(cx + dx, cy + dy);
      if (protectedMask[idx] || world.cells[idx] === Cell.DOOR || world.cells[idx] === Cell.LIFT) continue;
      if (d2 <= r2) {
        world.cells[idx] = Cell.ABYSS;
        world.roomMap[idx] = -1;
        world.floorTex[idx] = Tex.F_ABYSS;
        world.features[idx] = Feature.NONE;
      } else {
        world.cells[idx] = Cell.WALL;
        world.roomMap[idx] = -1;
        world.wallTex[idx] = Tex.GUT;
      }
    }
  }
}

function stampAtticBulbRoom(world: World, plan: AtticChamberPlan): Room {
  const room: Room = {
    id: world.rooms.length,
    type: plan.type,
    x: world.wrap(plan.cx - plan.rx),
    y: world.wrap(plan.cy - plan.ry),
    w: plan.rx * 2 + 1,
    h: plan.ry * 2 + 1,
    doors: [],
    sealed: false,
    name: plan.name,
    apartmentId: -1,
    wallTex: plan.wallTex,
    floorTex: plan.floorTex,
  };
  world.rooms.push(room);

  const outerRx = plan.rx + 2;
  const outerRy = plan.ry + 2;
  for (let dy = -outerRy; dy <= outerRy; dy++) {
    for (let dx = -outerRx; dx <= outerRx; dx++) {
      const nx = dx / Math.max(1, plan.rx);
      const ny = dy / Math.max(1, plan.ry);
      const outerNx = dx / Math.max(1, outerRx);
      const outerNy = dy / Math.max(1, outerRy);
      const idx = world.idx(plan.cx + dx, plan.cy + dy);
      if (nx * nx + ny * ny <= 1) {
        world.cells[idx] = Cell.FLOOR;
        world.roomMap[idx] = room.id;
        world.floorTex[idx] = plan.floorTex;
        world.features[idx] = Feature.NONE;
      } else if (outerNx * outerNx + outerNy * outerNy <= 1.05) {
        world.cells[idx] = Cell.WALL;
        world.roomMap[idx] = -1;
        world.wallTex[idx] = plan.wallTex;
      }
    }
  }

  return room;
}

function dressAtticBulbRoom(world: World, room: Room, plan: AtticChamberPlan, rng: () => number): void {
  const featureCount = Math.max(2, Math.floor((room.w * room.h) / 110));
  for (let i = 0; i < featureCount; i++) {
    const x = room.x + 2 + Math.floor(rng() * Math.max(1, room.w - 4));
    const y = room.y + 2 + Math.floor(rng() * Math.max(1, room.h - 4));
    const idx = world.idx(x, y);
    if (world.cells[idx] !== Cell.FLOOR || world.roomMap[idx] !== room.id) continue;
    world.features[idx] = i % 3 === 0 ? plan.feature : plan.type === RoomType.STORAGE ? Feature.SHELF : Feature.CANDLE;
  }
  if (plan.type === RoomType.PRODUCTION) {
    setAtticFeature(world, plan.cx, plan.cy, Feature.MACHINE);
    setAtticFeature(world, plan.cx + 2, plan.cy - 1, Feature.APPARATUS);
  }
  if (plan.type === RoomType.CORRIDOR) {
    stampSurfaceSplat(world, plan.cx, plan.cy, 0.5, 0.5, 2.6, 0.22, room.id * 911, 64, 42, 34, true);
  }
}

function fogAtticServiceCavities(world: World, rooms: readonly Room[]): void {
  for (const room of rooms) {
    if (room.type !== RoomType.PRODUCTION && room.type !== RoomType.STORAGE && room.type !== RoomType.CORRIDOR) continue;
    const strong = room.type === RoomType.PRODUCTION || room.name.includes('Шахта') || room.name.includes('корн');
    for (let dy = 1; dy < room.h - 1; dy++) {
      for (let dx = 1; dx < room.w - 1; dx++) {
        const idx = world.idx(room.x + dx, room.y + dy);
        if (world.cells[idx] !== Cell.FLOOR || world.roomMap[idx] !== room.id) continue;
        if (((dx * 17 + dy * 31 + room.id) & 3) === 0) continue;
        const fog = strong ? 58 + ((idx + room.id * 11) & 31) : 34 + ((idx + room.id * 7) & 23);
        if (world.fog[idx] < fog) world.fog[idx] = fog;
      }
    }
  }
}

function seedAtticShaftCaches(world: World, rooms: readonly Room[], rng: () => number): void {
  const loot: readonly WorldContainer['inventory'][] = [
    [{ defId: 'gasmask_filter', count: 1 }, { defId: 'wire_coil', count: 2 }, { defId: 'sealant_tube', count: 1 }],
    [{ defId: 'hermo_gasket', count: 1 }, { defId: 'fuse', count: 2 }, { defId: 'lamp_bulb', count: 1 }],
    [{ defId: 'circuit_board', count: 1 }, { defId: 'relay_diagram', count: 1 }, { defId: 'wire_coil', count: 1 }],
    [{ defId: 'gear', count: 2 }, { defId: 'sealant_tube', count: 1 }, { defId: 'gasmask_filter', count: 1 }],
  ];
  let placed = 0;
  for (const room of rooms) {
    if (room.type !== RoomType.PRODUCTION && room.type !== RoomType.STORAGE) continue;
    const cell = atticCacheCell(world, room, rng);
    if (cell < 0) continue;
    const x = cell % W;
    const y = (cell / W) | 0;
    world.addContainer({
      id: world.containers.length + 1,
      x,
      y,
      floor: FloorLevel.MINISTRY,
      roomId: room.id,
      zoneId: world.zoneMap[cell],
      kind: placed % 3 === 0 ? ContainerKind.SECRET_STASH : ContainerKind.TOOL_LOCKER,
      name: placed % 3 === 0 ? 'Запаянный шахтный тайник' : 'Сервисный шкаф чердака',
      inventory: loot[placed % loot.length].map(item => ({ ...item })),
      capacitySlots: 6,
      faction: placed % 2 === 0 ? Faction.LIQUIDATOR : Faction.CITIZEN,
      access: placed % 3 === 0 ? 'secret' : 'locked',
      lockDifficulty: placed % 3 === 0 ? undefined : 4,
      discovered: placed % 3 !== 0,
      tags: ['attic', 'shaft', 'utility', 'cache'],
    });
    placed++;
  }
}

function stampAtticServiceIslands(world: World, protectedMask: Uint8Array, rng: () => number): void {
  const openMask = new Uint8Array(W * W);
  carveAtticPathChain(world, [
    { x: 52, y: 538 },
    { x: 178, y: 760 },
    { x: 260, y: 890 },
    { x: 524, y: 930 },
    { x: 596, y: 792 },
    { x: 744, y: 626 },
    { x: 704, y: 574 },
  ], 2, Tex.F_CONCRETE, protectedMask);
  carveAtticPathChain(world, [
    { x: 252, y: 398 },
    { x: 336, y: 330 },
    { x: 514, y: 82 },
    { x: 640, y: 188 },
    { x: 832, y: 276 },
    { x: 766, y: 394 },
  ], 2, Tex.F_CONCRETE, protectedMask);
  carveAtticPathChain(world, [
    { x: 820, y: 736 },
    { x: 890, y: 836 },
    { x: 956, y: 918 },
    { x: 970, y: 548 },
  ], 2, Tex.F_CONCRETE, protectedMask);
  carveAtticPathChain(world, [
    { x: 336, y: 330 },
    { x: 382, y: 514 },
    { x: 326, y: 678 },
    { x: 260, y: 890 },
  ], 1, Tex.F_CONCRETE, protectedMask);
  carveAtticPathChain(world, [
    { x: 832, y: 276 },
    { x: 742, y: 548 },
    { x: 890, y: 836 },
  ], 1, Tex.F_CONCRETE, protectedMask);

  for (const island of ATTIC_SERVICE_ISLANDS) stampAtticFactionIsland(world, island, rng, openMask);
  for (let i = 0; i < ATTIC_WILD_OUTPOSTS.length; i++) {
    stampAtticWildOutpost(world, ATTIC_WILD_OUTPOSTS[i], i, rng, openMask);
  }
  for (let i = 0; i < ATTIC_MICRO_BLOCKS.length; i++) {
    stampAtticMicroBlock(world, ATTIC_MICRO_BLOCKS[i], i, rng, openMask);
  }
}

function stampAtticFactionIsland(world: World, plan: AtticServiceIslandPlan, rng: () => number, openMask: Uint8Array): void {
  carveAtticRootPath(world, plan.connect, { x: plan.cx, y: plan.cy }, 2, plan.floorTex, openMask);
  carveAtticDisc(world, plan.cx, plan.cy, 6, plan.floorTex, openMask);

  const core = stampAtticServiceRoom(world, RoomType.HQ, plan.cx - 10, plan.cy - 25, 20, 15, `${plan.prefix}: гермоядро`, Tex.HERMO_WALL, plan.floorTex, true);
  const common = stampAtticServiceRoom(world, plan.owner === ZoneFaction.CITIZEN ? RoomType.KITCHEN : RoomType.COMMON, plan.cx - 35, plan.cy - 5, 20, 14, `${plan.prefix}: общая`, plan.wallTex, plan.floorTex, false);
  const store = stampAtticServiceRoom(world, RoomType.STORAGE, plan.cx + 15, plan.cy - 5, 22, 14, `${plan.prefix}: склад`, plan.wallTex, plan.floorTex, false);
  const wet = stampAtticServiceRoom(world, RoomType.BATHROOM, plan.cx - 13, plan.cy + 13, 11, 10, `${plan.prefix}: санузел`, Tex.TILE_W, Tex.F_TILE, false);
  const workType = plan.owner === ZoneFaction.SCIENTIST ? RoomType.MEDICAL : plan.owner === ZoneFaction.LIQUIDATOR ? RoomType.OFFICE : RoomType.PRODUCTION;
  const work = stampAtticServiceRoom(world, workType, plan.cx + 5, plan.cy + 13, 20, 11, `${plan.prefix}: ${atticOwnerWorkName(plan.owner)}`, plan.wallTex, plan.owner === ZoneFaction.SCIENTIST ? Tex.F_TILE : plan.floorTex, false);

  connectAtticRoomToHub(world, core, 'south', plan.cx, plan.cy, DoorState.HERMETIC_OPEN);
  connectAtticRoomToHub(world, common, 'east', plan.cx, plan.cy, DoorState.CLOSED);
  connectAtticRoomToHub(world, store, 'west', plan.cx, plan.cy, DoorState.CLOSED);
  connectAtticRoomToHub(world, wet, 'north', plan.cx, plan.cy, DoorState.CLOSED);
  connectAtticRoomToHub(world, work, 'north', plan.cx, plan.cy, DoorState.CLOSED);

  decorateAtticFactionRoom(world, core, plan.owner, plan.coreFeature, rng);
  decorateAtticFactionRoom(world, common, plan.owner, Feature.TABLE, rng);
  decorateAtticFactionRoom(world, store, plan.owner, Feature.SHELF, rng);
  decorateAtticFactionRoom(world, wet, plan.owner, Feature.TOILET, rng);
  decorateAtticFactionRoom(world, work, plan.owner, plan.owner === ZoneFaction.SCIENTIST ? Feature.APPARATUS : Feature.MACHINE, rng);
  seedAtticIslandCache(world, store, plan.owner, rng);
}

function stampAtticWildOutpost(world: World, point: AtticPoint, serial: number, rng: () => number, openMask: Uint8Array): void {
  carveAtticDisc(world, point.x, point.y, 5, Tex.F_CONCRETE, openMask);
  const barrack = stampAtticServiceRoom(world, RoomType.COMMON, point.x - 21, point.y - 8, 18, 14, `Дикий запасной стан ${serial + 1}: ночлежка`, Tex.DARK, Tex.F_CONCRETE, false);
  const stash = stampAtticServiceRoom(world, RoomType.STORAGE, point.x + 6, point.y - 7, 18, 12, `Дикий запасной стан ${serial + 1}: краденый шкаф`, Tex.DARK, Tex.F_CONCRETE, false);
  const lathe = stampAtticServiceRoom(world, RoomType.PRODUCTION, point.x - 8, point.y + 10, 20, 11, `Дикий запасной стан ${serial + 1}: рваная мастерская`, Tex.PIPE, Tex.F_CONCRETE, false);
  connectAtticRoomToHub(world, barrack, 'east', point.x, point.y, DoorState.CLOSED);
  connectAtticRoomToHub(world, stash, 'west', point.x, point.y, DoorState.CLOSED);
  connectAtticRoomToHub(world, lathe, 'north', point.x, point.y, DoorState.CLOSED);
  decorateAtticFactionRoom(world, barrack, ZoneFaction.WILD, Feature.TABLE, rng);
  decorateAtticFactionRoom(world, stash, ZoneFaction.WILD, Feature.SHELF, rng);
  decorateAtticFactionRoom(world, lathe, ZoneFaction.WILD, Feature.MACHINE, rng);
  seedAtticIslandCache(world, stash, ZoneFaction.WILD, rng);
}

function stampAtticMicroBlock(world: World, plan: AtticMicroBlockPlan, serial: number, rng: () => number, openMask: Uint8Array): void {
  carveAtticRootPath(world, plan.connect, { x: plan.cx, y: plan.cy }, serial % 3 === 0 ? 2 : 1, plan.floorTex, openMask);
  carveAtticDisc(world, plan.cx, plan.cy, 4, plan.floorTex, openMask);

  const a = stampAtticServiceRoom(world, RoomType.STORAGE, plan.cx - 17, plan.cy - 15, 14, 10, `Чердак: ${plan.name}: кладовая`, plan.wallTex, plan.floorTex, false);
  const b = stampAtticServiceRoom(world, serial % 4 === 0 ? RoomType.BATHROOM : RoomType.PRODUCTION, plan.cx + 5, plan.cy - 14, 16, 10, `Чердак: ${plan.name}: ${serial % 4 === 0 ? 'туалет' : 'мастерская'}`, plan.wallTex, serial % 4 === 0 ? Tex.F_TILE : plan.floorTex, false);
  const c = stampAtticServiceRoom(world, serial % 3 === 0 ? RoomType.OFFICE : RoomType.COMMON, plan.cx - 7, plan.cy + 7, 18, 11, `Чердак: ${plan.name}: ${serial % 3 === 0 ? 'будка' : 'карман'}`, plan.wallTex, plan.floorTex, false);

  connectAtticRoomToHub(world, a, 'east', plan.cx, plan.cy, DoorState.CLOSED);
  connectAtticRoomToHub(world, b, 'west', plan.cx, plan.cy, DoorState.CLOSED);
  connectAtticRoomToHub(world, c, 'north', plan.cx, plan.cy, DoorState.CLOSED);
  decorateAtticFactionRoom(world, a, plan.owner, Feature.SHELF, rng);
  decorateAtticFactionRoom(world, b, plan.owner, b.type === RoomType.BATHROOM ? Feature.TOILET : Feature.APPARATUS, rng);
  decorateAtticFactionRoom(world, c, plan.owner, c.type === RoomType.OFFICE ? Feature.DESK : Feature.TABLE, rng);
  if (serial % 4 === 1) seedAtticIslandCache(world, a, plan.owner, rng);
}

function atticOwnerWorkName(owner: TerritoryOwner): string {
  switch (owner) {
    case ZoneFaction.CITIZEN: return 'ремонтная';
    case ZoneFaction.LIQUIDATOR: return 'караулка';
    case ZoneFaction.CULTIST: return 'жертвенный стол';
    case ZoneFaction.SCIENTIST: return 'медизмерение';
    case ZoneFaction.WILD: return 'разборочная';
    default: return 'служебная';
  }
}

function stampAtticServiceRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
  hermetic: boolean,
): Room {
  const room: Room = {
    id: world.rooms.length,
    type,
    x: world.wrap(x),
    y: world.wrap(y),
    w,
    h,
    doors: [],
    sealed: hermetic,
    name,
    apartmentId: -1,
    wallTex,
    floorTex,
  };
  world.rooms.push(room);

  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      world.cells[idx] = Cell.WALL;
      world.roomMap[idx] = -1;
      world.wallTex[idx] = hermetic ? Tex.HERMO_WALL : wallTex;
      if (hermetic) world.hermoWall[idx] = 1;
    }
  }
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      world.cells[idx] = Cell.FLOOR;
      world.roomMap[idx] = room.id;
      world.floorTex[idx] = floorTex;
      world.features[idx] = Feature.NONE;
      world.hermoWall[idx] = 0;
    }
  }
  return room;
}

function connectAtticRoomToHub(world: World, room: Room, side: RoomSide, hubX: number, hubY: number, state: DoorState): number {
  const door = atticDoorPoint(room, side);
  carveLine(world, door.outsideX, door.outsideY, hubX, hubY, 1, room.floorTex);
  const doorIdx = placeDoor(world, door.x, door.y, room.id, state);
  if (state === DoorState.HERMETIC_OPEN || state === DoorState.HERMETIC_CLOSED) {
    world.wallTex[doorIdx] = Tex.DOOR_METAL;
    world.hermoWall[doorIdx] = state === DoorState.HERMETIC_CLOSED ? 1 : 0;
  }
  return doorIdx;
}

function atticDoorPoint(room: Room, side: RoomSide): { x: number; y: number; outsideX: number; outsideY: number } {
  const midX = room.x + (room.w >> 1);
  const midY = room.y + (room.h >> 1);
  switch (side) {
    case 'north': return { x: midX, y: room.y - 1, outsideX: midX, outsideY: room.y - 2 };
    case 'south': return { x: midX, y: room.y + room.h, outsideX: midX, outsideY: room.y + room.h + 1 };
    case 'west': return { x: room.x - 1, y: midY, outsideX: room.x - 2, outsideY: midY };
    case 'east': return { x: room.x + room.w, y: midY, outsideX: room.x + room.w + 1, outsideY: midY };
  }
}

function decorateAtticFactionRoom(world: World, room: Room, owner: TerritoryOwner, primary: Feature, rng: () => number): void {
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  setAtticFeature(world, cx, cy, primary);
  if (room.type === RoomType.BATHROOM) {
    setAtticFeature(world, room.x + 2, room.y + 2, Feature.TOILET);
    setAtticFeature(world, room.x + room.w - 3, room.y + 2, Feature.SINK);
    return;
  }
  if (room.type === RoomType.KITCHEN) {
    setAtticFeature(world, room.x + 2, room.y + 2, Feature.STOVE);
    setAtticFeature(world, room.x + room.w - 3, room.y + 2, Feature.SINK);
  }
  const accent = owner === ZoneFaction.CULTIST ? Feature.CANDLE
    : owner === ZoneFaction.SCIENTIST ? Feature.SCREEN
      : owner === ZoneFaction.LIQUIDATOR ? Feature.LAMP
        : owner === ZoneFaction.WILD ? Feature.SHELF
          : Feature.CHAIR;
  for (let i = 0; i < Math.max(2, Math.floor((room.w * room.h) / 90)); i++) {
    const x = room.x + 2 + Math.floor(rng() * Math.max(1, room.w - 4));
    const y = room.y + 2 + Math.floor(rng() * Math.max(1, room.h - 4));
    const idx = world.idx(x, y);
    if (world.cells[idx] === Cell.FLOOR && world.roomMap[idx] === room.id && world.features[idx] === Feature.NONE) {
      world.features[idx] = i === 0 ? accent : room.type === RoomType.STORAGE ? Feature.SHELF : Feature.CHAIR;
    }
  }
}

function seedAtticIslandCache(world: World, room: Room, owner: TerritoryOwner, rng: () => number): void {
  const idx = atticCacheCell(world, room, rng);
  if (idx < 0) return;
  const x = idx % W;
  const y = (idx / W) | 0;
  const faction = owner === ZoneFaction.LIQUIDATOR ? Faction.LIQUIDATOR
    : owner === ZoneFaction.CULTIST ? Faction.CULTIST
      : owner === ZoneFaction.SCIENTIST ? Faction.SCIENTIST
        : owner === ZoneFaction.WILD ? Faction.WILD
          : Faction.CITIZEN;
  world.addContainer({
    id: world.containers.length + 1,
    x,
    y,
    floor: FloorLevel.MINISTRY,
    roomId: room.id,
    zoneId: world.zoneMap[idx],
    kind: owner === ZoneFaction.WILD ? ContainerKind.SECRET_STASH : ContainerKind.TOOL_LOCKER,
    name: owner === ZoneFaction.WILD ? 'Дикий чердачный тайник' : 'Фракционный шкаф чердака',
    inventory: atticIslandCacheLoot(owner),
    capacitySlots: 6,
    faction,
    access: owner === ZoneFaction.WILD ? 'secret' : 'faction',
    lockDifficulty: owner === ZoneFaction.WILD ? undefined : 4,
    discovered: owner !== ZoneFaction.WILD,
    tags: ['attic', 'cache', 'territory', faction.toString()],
  });
}

function atticIslandCacheLoot(owner: TerritoryOwner): WorldContainer['inventory'] {
  switch (owner) {
    case ZoneFaction.LIQUIDATOR:
      return [{ defId: 'ammo_9mm', count: 8 }, { defId: 'bandage', count: 1 }, { defId: 'gasmask_filter', count: 1 }];
    case ZoneFaction.CULTIST:
      return [{ defId: 'holy_water', count: 1 }, { defId: 'meat_rune', count: 1 }, { defId: 'cigs', count: 2 }];
    case ZoneFaction.SCIENTIST:
      return [{ defId: 'circuit_board', count: 1 }, { defId: 'relay_diagram', count: 1 }, { defId: 'fuse', count: 1 }];
    case ZoneFaction.WILD:
      return [{ defId: 'wire_coil', count: 1 }, { defId: 'gear', count: 1 }, { defId: 'sealant_tube', count: 1 }];
    default:
      return [{ defId: 'kasha', count: 1 }, { defId: 'lamp_bulb', count: 1 }, { defId: 'wire_coil', count: 1 }];
  }
}

function applyChthonicAtticTerritory(world: World): void {
  const tileSize = 32;
  const side = W / tileSize;
  const tileCount = side * side;
  const quotas = atticTerritoryTileQuotas(tileCount);
  const tileOwner = new Int16Array(tileCount).fill(-1);
  const ownerCounts = new Int16Array(ATTIC_TERRITORY_TARGETS.length);
  const candidates: { tile: number; ownerIndex: number; score: number }[] = [];

  for (let ty = 0; ty < side; ty++) {
    for (let tx = 0; tx < side; tx++) {
      const tile = ty * side + tx;
      const x = tx * tileSize + (tileSize >> 1);
      const y = ty * tileSize + (tileSize >> 1);
      for (let ownerIndex = 0; ownerIndex < ATTIC_TERRITORY_TARGETS.length; ownerIndex++) {
        candidates.push({ tile, ownerIndex, score: atticTerritoryScore(world, x, y, tx, ty, ownerIndex) });
      }
    }
  }

  candidates.sort((a, b) => a.score - b.score || a.ownerIndex - b.ownerIndex || a.tile - b.tile);
  for (const candidate of candidates) {
    if (tileOwner[candidate.tile] >= 0 || ownerCounts[candidate.ownerIndex] >= quotas[candidate.ownerIndex]) continue;
    tileOwner[candidate.tile] = candidate.ownerIndex;
    ownerCounts[candidate.ownerIndex]++;
  }
  for (let tile = 0; tile < tileCount; tile++) {
    if (tileOwner[tile] >= 0) continue;
    let ownerIndex = 0;
    for (let i = 1; i < ATTIC_TERRITORY_TARGETS.length; i++) {
      if (ownerCounts[i] < quotas[i] && ownerCounts[i] / Math.max(1, quotas[i]) < ownerCounts[ownerIndex] / Math.max(1, quotas[ownerIndex])) ownerIndex = i;
    }
    tileOwner[tile] = ownerIndex;
    ownerCounts[ownerIndex]++;
  }

  for (let ty = 0; ty < side; ty++) {
    for (let tx = 0; tx < side; tx++) {
      const owner = ATTIC_TERRITORY_TARGETS[tileOwner[ty * side + tx]].owner;
      const y0 = ty * tileSize;
      const x0 = tx * tileSize;
      for (let y = y0; y < y0 + tileSize; y++) {
        for (let x = x0; x < x0 + tileSize; x++) {
          setTerritoryOwnerAtIndex(world, world.idx(x, y), owner);
        }
      }
    }
  }

  for (const room of world.rooms) {
    const owner = atticAuthoredRoomOwner(room);
    if (owner === undefined) continue;
    paintAtticRoomTerritory(world, room, owner);
  }
}

function atticTerritoryTileQuotas(tileCount: number): Int16Array {
  const quotas = new Int16Array(ATTIC_TERRITORY_TARGETS.length);
  const fractions = ATTIC_TERRITORY_TARGETS.map((target, index) => {
    const exact = target.share * tileCount;
    const base = Math.floor(exact);
    quotas[index] = base;
    return { index, fraction: exact - base };
  }).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  let used = 0;
  for (const quota of quotas) used += quota;
  for (let i = 0; used < tileCount; i++, used++) quotas[fractions[i % fractions.length].index]++;
  return quotas;
}

function atticTerritoryScore(world: World, x: number, y: number, tx: number, ty: number, ownerIndex: number): number {
  const target = ATTIC_TERRITORY_TARGETS[ownerIndex];
  let best = Infinity;
  for (const anchor of target.anchors) best = Math.min(best, world.dist(x, y, anchor.x, anchor.y));
  const noise = (atticHash01(tx, ty, target.owner * 71 + ownerIndex * 19) - 0.5) * 44;
  return best + noise - target.share * 96;
}

function atticHash01(a: number, b: number, c: number): number {
  let x = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b ^ 0xc2b2ae35, 0x27d4eb2d) ^ Math.imul(c ^ 0x165667b1, 0x9e3779b1);
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  return (x >>> 0) / 0x100000000;
}

function atticAuthoredRoomOwner(room: Room): TerritoryOwner | undefined {
  for (const island of ATTIC_SERVICE_ISLANDS) {
    if (room.name.startsWith(island.prefix)) return island.owner;
  }
  if (room.name.startsWith('Дикий запасной стан')) return ZoneFaction.WILD;
  if (room.name.startsWith('Чердак:')) {
    const plan = ATTIC_MICRO_BLOCKS.find(candidate => room.name.includes(candidate.name));
    return plan?.owner;
  }
  if (room.name.includes('хранительницы') || room.name.includes('Предчердачный')) return ZoneFaction.CITIZEN;
  if (room.name.includes('прожиг') || room.name.includes('крыши')) return ZoneFaction.LIQUIDATOR;
  if (room.name.includes('молельная') || room.name.includes('свидетель') || room.name.includes('черной ладони')) return ZoneFaction.CULTIST;
  if (room.name.includes('кабельного давления') || room.name.includes('датчик')) return ZoneFaction.SCIENTIST;
  if (room.name.includes('ложная') || room.name.includes('рван') || room.name.includes('разлом')) return ZoneFaction.WILD;
  return undefined;
}

function paintAtticRoomTerritory(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      setTerritoryOwnerAtIndex(world, idx, owner);
    }
  }
}

function atticCacheCell(world: World, room: Room, rng: () => number): number {
  for (let attempt = 0; attempt < 80; attempt++) {
    const x = room.x + 2 + Math.floor(rng() * Math.max(1, room.w - 4));
    const y = room.y + 2 + Math.floor(rng() * Math.max(1, room.h - 4));
    const idx = world.idx(x, y);
    if (world.cells[idx] !== Cell.FLOOR || world.roomMap[idx] !== room.id || world.features[idx] !== Feature.NONE) continue;
    return idx;
  }
  return -1;
}

function nearestAtticAnchorPressure(world: World, x: number, y: number, radius: number): number {
  let pressure = 0;
  const r2 = radius * radius;
  for (const anchor of ATTIC_ECOLOGY_ANCHORS) {
    const d2 = world.dist2(x, y, anchor.x, anchor.y);
    if (d2 >= r2) continue;
    pressure = Math.max(pressure, 1 - Math.sqrt(d2) / radius);
  }
  return pressure;
}

function carveAtticCrawlBypasses(world: World, protectedMask: Uint8Array): void {
  carveAtticPathChain(world, [
    { x: ATTIC_BASE_X + 112, y: MAIN_Y - 18 },
    { x: 545, y: 458 },
    { x: 590, y: 476 },
    { x: ATTIC_BASE_X + 212, y: MAIN_Y - 10 },
  ], 0, Tex.F_CONCRETE, protectedMask);
  carveAtticPathChain(world, [
    { x: 746, y: 500 },
    { x: 784, y: 452 },
    { x: 832, y: 454 },
    { x: 866, y: 466 },
  ], 0, Tex.F_CONCRETE, protectedMask);
  carveAtticPathChain(world, [
    { x: 920, y: 522 },
    { x: 984, y: 555 },
    { x: 42, y: 548 },
    { x: 112, y: 530 },
  ], 0, Tex.F_CONCRETE, protectedMask);
  setAtticFeature(world, 545, 458, Feature.APPARATUS);
  setAtticFeature(world, 784, 452, Feature.SHELF);
  setAtticFeature(world, 42, 548, Feature.CANDLE);
}

function carveAtticStealthCrawlGraph(world: World, protectedMask: Uint8Array): void {
  for (const [from, to] of ATTIC_STEALTH_CRAWL_GRAPH) {
    carveAtticRootPath(world, from, to, 0, Tex.F_CONCRETE, protectedMask);
  }
  for (const niche of ATTIC_CRAWL_NICHES) {
    stampAtticCrawlNiche(world, niche, protectedMask);
  }
}

function stampAtticCrawlNiche(world: World, plan: AtticCrawlNichePlan, protectedMask: Uint8Array): void {
  const outerRx = plan.rx + 1;
  const outerRy = plan.ry + 1;
  for (let dy = -outerRy; dy <= outerRy; dy++) {
    for (let dx = -outerRx; dx <= outerRx; dx++) {
      const inner = (dx * dx) / Math.max(1, plan.rx * plan.rx) + (dy * dy) / Math.max(1, plan.ry * plan.ry);
      const outer = (dx * dx) / Math.max(1, outerRx * outerRx) + (dy * dy) / Math.max(1, outerRy * outerRy);
      if (outer > 1.04) continue;
      const idx = world.idx(plan.cx + dx, plan.cy + dy);
      if (protectedMask[idx] || world.cells[idx] === Cell.DOOR || world.cells[idx] === Cell.LIFT) continue;
      if (inner <= 1) {
        world.cells[idx] = Cell.FLOOR;
        world.roomMap[idx] = -1;
        world.floorTex[idx] = plan.floorTex;
        if (dx === 0 && dy === 0) world.features[idx] = plan.feature;
      } else if (world.cells[idx] === Cell.WALL || world.cells[idx] === Cell.ABYSS) {
        world.cells[idx] = Cell.WALL;
        world.roomMap[idx] = -1;
        world.wallTex[idx] = plan.wallTex;
      }
    }
  }
  stampSurfaceSplat(world, plan.cx, plan.cy, 0.5, 0.5, Math.max(plan.rx, plan.ry) * 0.42, 0.2, plan.cx * 29 ^ plan.cy * 31, 52, 43, 36, true);
}

function stampAtticRootStubs(world: World, protectedMask: Uint8Array): void {
  const stubs: readonly [AtticPoint, AtticPoint][] = [
    [{ x: 700, y: 536 }, { x: 742, y: 600 }],
    [{ x: 780, y: 516 }, { x: 816, y: 574 }],
    [{ x: 112, y: 530 }, { x: 82, y: 604 }],
    [{ x: ATTIC_BASE_X + 78, y: MAIN_Y - 22 }, { x: 452, y: 388 }],
    [{ x: 410, y: 918 }, { x: 354, y: 884 }],
  ];
  for (const [from, to] of stubs) {
    carveAtticRootPath(world, from, to, 1, Tex.F_GUT, protectedMask);
    placeAtticRootPillar(world, to.x, to.y, 3, protectedMask);
  }
}

function stampAtticChokepoints(world: World, protectedMask: Uint8Array): void {
  placeAtticRootPillar(world, ATTIC_BASE_X + 142, MAIN_Y - 5, 3, protectedMask);
  placeAtticRootPillar(world, ATTIC_BASE_X + 148, MAIN_Y + 8, 3, protectedMask);
  placeAtticRootPillar(world, 780, 510, 3, protectedMask);
  placeAtticRootPillar(world, 786, 524, 3, protectedMask);
  placeAtticRootPillar(world, 948, 486, 3, protectedMask);
  placeAtticRootPillar(world, 34, 496, 3, protectedMask);
  setAtticFeature(world, ATTIC_BASE_X + 150, MAIN_Y + 1, Feature.CANDLE);
  setAtticFeature(world, 783, 517, Feature.LAMP);
  setAtticFeature(world, 1004, 494, Feature.APPARATUS);
}

function placeAtticRootPillar(world: World, cx: number, cy: number, radius: number, protectedMask: Uint8Array): void {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const idx = world.idx(cx + dx, cy + dy);
      if (protectedMask[idx] || world.cells[idx] === Cell.DOOR || world.cells[idx] === Cell.LIFT) continue;
      world.cells[idx] = Cell.WALL;
      world.roomMap[idx] = -1;
      world.wallTex[idx] = (dx + dy) & 1 ? Tex.GUT : Tex.MEAT;
      world.features[idx] = Feature.NONE;
    }
  }
}

function stampAtticLowCeilingShells(world: World): void {
  for (const room of world.rooms) {
    if (!room || !atticRoomReadsLow(room)) continue;
    for (let dy = 1; dy < room.h - 1; dy++) {
      for (let dx = 1; dx < room.w - 1; dx++) {
        const x = room.x + dx;
        const y = room.y + dy;
        const idx = world.idx(x, y);
        if (world.cells[idx] !== Cell.FLOOR) continue;
        const dist = nearestAtticSolidDistance(world, x, y, 4);
        if (dist > 3.2) continue;
        const pressure = Math.max(0, 4 - dist);
        const fog = Math.min(72, 12 + Math.round(pressure * 12));
        if (world.fog[idx] < fog) world.fog[idx] = fog;
        if (dist <= 1.45 && world.floorTex[idx] === Tex.F_CONCRETE && ((x * 13 + y * 17 + room.id) & 3) === 0) {
          world.floorTex[idx] = room.floorTex === Tex.F_GUT ? Tex.F_GUT : Tex.F_CONCRETE;
        }
        if (world.features[idx] === Feature.NONE && dist <= 1.7 && ((x * 19 + y * 23 + room.id) & 31) === 0) {
          world.features[idx] = room.floorTex === Tex.F_GUT ? Feature.CANDLE : Feature.APPARATUS;
        }
        if (((x * 37 + y * 41 + room.id) & 63) === 0) {
          stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.45, 0.14, room.id * 1009 + x * 7 + y, 58, 51, 45, true);
        }
      }
    }
  }

  for (const point of ATTIC_SPINE) {
    stampSurfaceSplat(world, point.x, point.y, 0.5, 0.5, 1.2, 0.11, point.x * 43 ^ point.y * 47, 44, 39, 35, true);
  }
}

function atticRoomReadsLow(room: Room): boolean {
  const name = room.name.toLowerCase();
  return room.type === RoomType.CORRIDOR
    || room.type === RoomType.STORAGE
    || name.includes('низк')
    || name.includes('лаз')
    || name.includes('шахт')
    || name.includes('карман')
    || name.includes('корн')
    || name.includes('ниша');
}

function nearestAtticSolidDistance(world: World, x: number, y: number, radius: number): number {
  let best = radius + 1;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 === 0 || d2 >= best * best) continue;
      const cell = world.cells[world.idx(x + dx, y + dy)];
      if (cell !== Cell.WALL && cell !== Cell.ABYSS) continue;
      best = Math.sqrt(d2);
    }
  }
  return best;
}

function stampAtticCapillaryCracks(world: World, protectedMask: Uint8Array, rng: () => number): void {
  for (let i = 0; i < ATTIC_CAPILLARY_SEEDS.length; i++) {
    const seed = ATTIC_CAPILLARY_SEEDS[i];
    walkAtticCapillary(world, protectedMask, seed, 44 + i * 3, rng, i * 3);
    walkAtticCapillary(world, protectedMask, {
      x: seed.x,
      y: seed.y,
      dx: -seed.dy || seed.dx,
      dy: seed.dx || seed.dy,
      root: seed.root,
    }, 24 + i * 2, rng, i * 3 + 1);
    if (i % 2 === 0) {
      walkAtticCapillary(world, protectedMask, {
        x: seed.x,
        y: seed.y,
        dx: seed.dy || -seed.dx,
        dy: -seed.dx || seed.dy,
        root: seed.root,
      }, 22 + i, rng, i * 3 + 2);
    }
  }
}

function walkAtticCapillary(
  world: World,
  protectedMask: Uint8Array,
  seed: AtticCapillarySeed,
  length: number,
  rng: () => number,
  serial: number,
): void {
  let x = seed.x;
  let y = seed.y;
  let dx = seed.dx;
  let dy = seed.dy;
  if (dx === 0 && dy === 0) dx = 1;

  for (let step = 0; step < length; step++) {
    const idx = world.idx(x, y);
    if (!protectedMask[idx] && world.cells[idx] !== Cell.DOOR && world.cells[idx] !== Cell.LIFT) {
      if (world.cells[idx] === Cell.WALL) {
        world.wallTex[idx] = seed.root
          ? ((step + serial) & 1 ? Tex.GUT : Tex.MEAT)
          : ((step + serial) & 1 ? Tex.PIPE : Tex.DARK);
      } else if (world.cells[idx] === Cell.FLOOR) {
        if (seed.root && ((step + serial) % 3 === 0)) world.floorTex[idx] = Tex.F_GUT;
        if (world.fog[idx] < (seed.root ? 44 : 28)) world.fog[idx] = seed.root ? 44 : 28;
        if (world.features[idx] === Feature.NONE && ((step + serial) % 19 === 0)) {
          world.features[idx] = seed.root ? Feature.CANDLE : Feature.APPARATUS;
        }
      }
      if ((step & 3) === 0) {
        stampSurfaceSplat(
          world,
          x,
          y,
          0.5,
          0.5,
          seed.root ? 0.62 : 0.42,
          seed.root ? 0.18 : 0.13,
          (seed.x * 73856093 ^ seed.y * 19349663 ^ serial * 83492791 ^ step * 2654435761) | 0,
          seed.root ? 62 : 46,
          seed.root ? 39 : 43,
          seed.root ? 28 : 47,
          true,
        );
      }
    }

    if (step > 0 && step % 7 === 0 && rng() < 0.64) {
      const turnLeft = rng() < 0.5;
      const oldDx = dx;
      dx = turnLeft ? -dy : dy;
      dy = turnLeft ? oldDx : -oldDx;
      if (dx === 0 && dy === 0) dx = 1;
    }
    x = world.wrap(x + dx);
    y = world.wrap(y + dy);
  }
}

function stampAtticExitCues(world: World): void {
  stampSurfaceSplat(world, ATTIC_BASE_X + 7, ATTIC_BASE_Y + 57, 0.5, 0.5, 4.2, 0.2, 3602, 80, 78, 70, true);
  stampSurfaceSplat(world, ATTIC_BASE_X + 216, ATTIC_BASE_Y + 58, 0.5, 0.5, 4.6, 0.22, 3603, 38, 54, 64, true);
  setAtticFeature(world, ATTIC_BASE_X + 5, ATTIC_BASE_Y + 57, Feature.LAMP);
  setAtticFeature(world, ATTIC_BASE_X + 214, ATTIC_BASE_Y + 58, Feature.LAMP);
  setAtticFeature(world, ATTIC_BASE_X + 153, ATTIC_BASE_Y + 15, Feature.LIFT_BUTTON);
}

function setAtticFeature(world: World, x: number, y: number, feature: Feature): void {
  const idx = world.idx(x, y);
  if (world.cells[idx] === Cell.FLOOR) world.features[idx] = feature;
}

function spawnAtticAmbientMonsters(world: World, entities: Entity[], rng: () => number, count: number): void {
  let nextId = entities.reduce((max, entity) => Math.max(max, entity.id), 0) + 1;
  const kinds: readonly MonsterKind[] = [MonsterKind.SHADOW, MonsterKind.POLZUN, MonsterKind.SPIRIT, MonsterKind.REBAR];
  for (let i = 0; i < count; i++) {
    const point = randomAtticRootCell(world, rng);
    if (!point) break;
    const kind = kinds[Math.floor(rng() * kinds.length)];
    nextId = spawnMonster(entities, nextId, kind, point.x + 0.5, point.y + 0.5);
  }
}

function randomAtticRootCell(world: World, rng: () => number): AtticPoint | null {
  for (let attempt = 0; attempt < 2000; attempt++) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    const idx = world.idx(x, y);
    if (world.cells[idx] !== Cell.FLOOR) continue;
    if (world.dist2(x + 0.5, y + 0.5, ATTIC_BASE_X + 11.5, ATTIC_BASE_Y + 57.5) < 48 * 48) continue;
    return { x, y };
  }
  return null;
}

function fillBaseTextures(world: World): void {
  for (let i = 0; i < W * W; i++) {
    world.wallTex[i] = Tex.CONCRETE;
    world.floorTex[i] = Tex.F_CONCRETE;
  }
}

function stampRoom(
  world: World,
  id: number,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
): Room {
  const room: Room = {
    id, type,
    x: world.wrap(x), y: world.wrap(y), w, h,
    doors: [],
    sealed: false,
    name,
    apartmentId: -1,
    wallTex,
    floorTex,
  };

  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      world.cells[idx] = Cell.WALL;
      world.roomMap[idx] = -1;
      world.wallTex[idx] = wallTex;
    }
  }
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      world.cells[idx] = Cell.FLOOR;
      world.roomMap[idx] = id;
      world.floorTex[idx] = floorTex;
    }
  }
  world.rooms[id] = room;
  return room;
}

function carveCombatLane(world: World, x0: number, x1: number, y: number): number[] {
  const cells: number[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let dy = -4; dy <= 4; dy++) {
      const idx = world.idx(x, y + dy);
      world.cells[idx] = Cell.FLOOR;
      world.roomMap[idx] = -1;
      world.floorTex[idx] = Math.abs(dy) <= 1 ? Tex.F_MARBLE_TILE : Tex.F_CONCRETE;
      cells.push(idx);
    }
  }
  return cells;
}

function carveCrawlRoute(
  world: World,
  spawn: Room,
  crawlA: Room,
  crawlB: Room,
  crawlC: Room,
  masha: Room,
  exitRoom: Room,
): number[] {
  const cells: number[] = [];
  carveLine(world, spawn.x + 9, spawn.y - 2, spawn.x + 9, crawlA.y + 4, 0, Tex.F_CONCRETE, cells);
  carveLine(world, spawn.x + 9, crawlA.y + 4, crawlA.x - 2, crawlA.y + 4, 0, Tex.F_CONCRETE, cells);
  carveLine(world, crawlA.x + crawlA.w + 1, crawlA.y + 4, crawlB.x - 2, crawlA.y + 4, 0, Tex.F_CONCRETE, cells);
  carveLine(world, crawlB.x - 2, crawlA.y + 4, crawlB.x - 2, crawlB.y + 3, 0, Tex.F_CONCRETE, cells);
  carveLine(world, crawlB.x + crawlB.w + 1, crawlB.y + 3, crawlC.x - 2, crawlB.y + 3, 0, Tex.F_CONCRETE, cells);
  carveLine(world, crawlC.x - 2, crawlB.y + 3, crawlC.x - 2, crawlC.y + 4, 0, Tex.F_CONCRETE, cells);
  carveLine(world, crawlC.x + crawlC.w + 1, crawlC.y + 4, masha.x + 11, crawlC.y + 4, 0, Tex.F_CONCRETE, cells);
  carveLine(world, masha.x + 11, crawlC.y + 4, masha.x + 11, masha.y - 2, 0, Tex.F_CONCRETE, cells);
  carveLine(world, masha.x + 11, masha.y - 2, exitRoom.x + 5, masha.y - 2, 0, Tex.F_CONCRETE, cells);
  carveLine(world, exitRoom.x + 5, masha.y - 2, exitRoom.x + 5, exitRoom.y - 2, 0, Tex.F_CONCRETE, cells);
  carveLine(world, exitRoom.x + 5, exitRoom.y - 2, exitRoom.x + 5, exitRoom.y + 8, 0, Tex.F_CONCRETE, cells);
  return cells;
}

function carveLine(
  world: World,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  halfWidth: number,
  floorTex: Tex,
  cells?: number[],
): void {
  let x = x0;
  let y = y0;
  const dx = x1 === x0 ? 0 : (x1 > x0 ? 1 : -1);
  const dy = y1 === y0 ? 0 : (y1 > y0 ? 1 : -1);
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let step = 0; step <= steps; step++) {
    for (let oy = -halfWidth; oy <= halfWidth; oy++) {
      for (let ox = -halfWidth; ox <= halfWidth; ox++) {
        const idx = world.idx(x + ox, y + oy);
        world.cells[idx] = Cell.FLOOR;
        world.roomMap[idx] = -1;
        world.floorTex[idx] = floorTex;
        cells?.push(idx);
      }
    }
    x += dx;
    y += dy;
  }
}

function placeDoor(world: World, x: number, y: number, roomId: number, state: DoorState): number {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.DOOR;
  world.roomMap[idx] = -1;
  world.wallTex[idx] = Tex.DOOR_METAL;
  world.doors.set(idx, { idx, state, roomA: roomId, roomB: -1, keyId: '', timer: 0 });
  const room = world.rooms[roomId];
  if (room && !room.doors.includes(idx)) room.doors.push(idx);
  return idx;
}

function connectRoomToLane(world: World, room: Room, doorX: number, side: 1 | -1): number {
  const doorY = side > 0 ? room.y + room.h : room.y - 1;
  const startY = side > 0 ? doorY + 1 : doorY - 1;
  const endY = side > 0 ? MAIN_Y - 5 : MAIN_Y + 5;
  carveLine(world, doorX, startY, doorX, endY, 1, Tex.F_CONCRETE);
  return placeDoor(world, doorX, doorY, room.id, DoorState.CLOSED);
}

function placeExitLift(world: World, x: number, y: number, direction: LiftDirection): number {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.LIFT;
  world.wallTex[idx] = Tex.LIFT_DOOR;
  world.roomMap[idx] = -1;
  world.liftDir[idx] = direction;
  const buttonIdx = world.idx(x + 1, y);
  if (world.cells[buttonIdx] === Cell.FLOOR) {
    world.features[buttonIdx] = Feature.LIFT_BUTTON;
    world.liftDir[buttonIdx] = direction;
  }
  return idx;
}

function decorateAttic(
  world: World,
  rooms: Record<string, Room>,
): void {
  for (const room of Object.values(rooms)) {
    for (let dy = 1; dy < room.h - 1; dy += 3) {
      const left = world.idx(room.x + 1, room.y + dy);
      const right = world.idx(room.x + room.w - 2, room.y + dy);
      if (room.type === RoomType.STORAGE) {
        world.features[left] = Feature.SHELF;
        world.features[right] = Feature.SHELF;
      } else if (room.type === RoomType.OFFICE || room.type === RoomType.HQ) {
        world.features[left] = Feature.DESK;
        world.features[right] = Feature.CHAIR;
      }
    }
  }

  for (const room of [rooms.deacon, rooms.shrine]) {
    const cx = room.x + Math.floor(room.w / 2);
    const cy = room.y + Math.floor(room.h / 2);
    world.features[world.idx(cx, cy)] = Feature.CANDLE;
    world.features[world.idx(cx - 2, cy)] = Feature.CANDLE;
    world.features[world.idx(cx + 2, cy)] = Feature.CANDLE;
  }

  for (const room of [rooms.spawn, rooms.exitRoom, rooms.masha]) {
    world.features[world.idx(room.x + Math.floor(room.w / 2), room.y + 2)] = Feature.LAMP;
  }

  stampBlackHand(world, rooms.evidence.x + 9, rooms.evidence.y + 6);
  stampVerticalServiceHoles(world, rooms.crawlB.x + 6, rooms.crawlB.y + 3);
}

function stampRootObstacles(world: World, y: number): void {
  for (let x = ATTIC_BASE_X + 118; x <= ATTIC_BASE_X + 138; x++) {
    for (let dy = -4; dy <= 4; dy++) {
      if (Math.abs(dy) <= 1 || ((x + dy) & 3) === 0) continue;
      const idx = world.idx(x, y + dy);
      world.cells[idx] = Cell.WALL;
      world.wallTex[idx] = (dy & 1) === 0 ? Tex.GUT : Tex.MEAT;
      world.roomMap[idx] = -1;
    }
  }
  for (let x = ATTIC_BASE_X + 50; x <= ATTIC_BASE_X + 180; x += 13) {
    const idx = world.idx(x, ATTIC_BASE_Y + 17);
    world.wallTex[idx] = Tex.GUT;
    stampSurfaceSplat(world, x, ATTIC_BASE_Y + 17, 0.5, 0.5, 0.35, 0.55, x * 17, 60, 42, 30, true);
  }
}

function stampBlackHand(world: World, x: number, y: number): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      stampSurfaceSplat(world, x + dx, y + dy, 0.5, 0.5, 0.18, 0.75, 7000 + dx * 31 + dy, 12, 8, 6, true);
    }
  }
}

function stampVerticalServiceHoles(world: World, x: number, y: number): void {
  for (let dx = -1; dx <= 1; dx++) {
    const idx = world.idx(x + dx, y);
    if (world.cells[idx] !== Cell.FLOOR) continue;
    world.cells[idx] = Cell.ABYSS;
    world.floorTex[idx] = Tex.F_ABYSS;
  }
}

function retuneAtticZones(world: World, rooms: Room[]): void {
  for (const zone of world.zones) {
    zone.level = 4;
    zone.faction = ZoneFaction.CULTIST;
  }
  for (const room of rooms) {
    const idx = world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2));
    const zone = world.zones[world.zoneMap[idx]];
    if (!zone) continue;
    zone.level = room.type === RoomType.HQ ? 5 : 4;
    zone.faction = room.type === RoomType.HQ ? ZoneFaction.LIQUIDATOR : ZoneFaction.CULTIST;
    zone.hqRoomId = room.type === RoomType.HQ ? room.id : zone.hqRoomId;
  }
}

function addAtticContainers(
  world: World,
  rootkeeper: Room,
  deacon: Room,
  evidence: Room,
  shrine: Room,
  masha: Room,
  rootChoice: ChthonicAtticRootChoice,
): void {
  addContainer(world, rootkeeper, rootkeeper.x + 3, rootkeeper.y + 5, ContainerKind.TOOL_LOCKER, 'Ящик несущих корней', 'owner', [
    { defId: 'gear', count: 2 },
    { defId: 'wire_coil', count: 2 },
    { defId: 'sealant_tube', count: 1 },
  ], ['attic', 'root', 'cut'], Faction.CITIZEN);

  addContainer(world, deacon, deacon.x + 4, deacon.y + 6, ContainerKind.FILING_CABINET, 'Ведомость укрытия Остапа', 'owner', [
    { defId: 'denunciation', count: 1 },
    { defId: 'voluntary_receipt', count: 1 },
    { defId: 'holy_water', count: 1 },
  ], ['attic', 'shelter', 'witness'], Faction.CULTIST);

  addContainer(world, evidence, evidence.x + 9, evidence.y + 6, ContainerKind.SAFE, 'Кладовая черной ладони', 'locked', [
    { defId: 'denunciation', count: 1 },
    { defId: 'official_permit_slip', count: 1 },
    { defId: 'note', count: 1 },
  ], ['attic', 'ministry', 'evidence'], Faction.CITIZEN);

  addContainer(world, shrine, shrine.x + 10, shrine.y + 7, ContainerKind.SECRET_STASH, 'Реликварий корневой ниши', rootChoice === 'feed' ? 'public' : 'secret', [
    { defId: 'idol_chernobog', count: 1 },
    { defId: 'meat_rune', count: 1 },
    { defId: 'psi_dust', count: 1 },
  ], ['attic', 'hell', 'relic', rootChoice], Faction.CULTIST);

  addContainer(world, masha, masha.x + 16, masha.y + 6, ContainerKind.WEAPON_CRATE, 'Контур прожига Маши', 'faction', [
    { defId: 'ammo_fuel', count: 1 },
    { defId: 'ammo_9mm', count: 12 },
    { defId: 'bandage', count: 2 },
  ], ['attic', 'burn', 'liquidator'], Faction.LIQUIDATOR);
}

function addContainer(
  world: World,
  room: Room,
  x: number,
  y: number,
  kind: ContainerKind,
  name: string,
  access: WorldContainer['access'],
  inventory: WorldContainer['inventory'],
  tags: string[],
  faction: Faction,
): void {
  world.addContainer({
    id: world.containers.length + 1,
    x,
    y,
    floor: FloorLevel.MINISTRY,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind,
    name,
    inventory,
    capacitySlots: 8,
    faction,
    access,
    lockDifficulty: access === 'locked' ? 5 : undefined,
    discovered: access !== 'secret',
    tags,
  });
}

function spawnNpc(
  entities: Entity[],
  id: number,
  plotNpcId: string,
  _def: PlotNpcDef,
  x: number,
  y: number,
): number {
  const nextId = { v: id };
  requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x, y, {
    angle: 0,
    canGiveQuest: true,
    aiTarget: { x, y },
  });
  return nextId.v;
}

function addItemDrop(
  entities: Entity[],
  id: number,
  defId: string,
  count: number,
  x: number,
  y: number,
): number {
  entities.push({
    id,
    type: EntityType.ITEM_DROP,
    x, y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count }],
  });
  return id + 1;
}

function spawnMonster(
  entities: Entity[],
  id: number,
  kind: MonsterKind,
  x: number,
  y: number,
): number {
  const hp = kind === MonsterKind.REBAR ? 130 : kind === MonsterKind.SHADOW ? 75 : kind === MonsterKind.EYE ? 60 : 18;
  const speed = kind === MonsterKind.REBAR ? 1.1 : kind === MonsterKind.SHADOW ? 2.3 : kind === MonsterKind.EYE ? 2.0 : 2.8;
  entities.push({
    id,
    type: EntityType.MONSTER,
    x, y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed,
    sprite: monsterSpr(kind),
    hp,
    maxHp: hp,
    ai: { goal: AIGoal.HUNT, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    monsterKind: kind,
    attackCd: 0,
    faction: Faction.WILD,
  });
  return id + 1;
}

function setDoorState(world: World, idx: number, state: DoorState): void {
  const door = world.doors.get(idx);
  if (door) door.state = state;
}

function scorchRoom(world: World, room: Room): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      world.floorTex[idx] = Tex.F_ABYSS;
      if (((dx + dy) & 3) === 0) world.fog[idx] = 35;
      if (dx === 0 || dy === 0 || dx === room.w - 1 || dy === room.h - 1) world.wallTex[idx] = Tex.DARK;
    }
  }
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFogDirty();
}

function shortestPathDistance(world: World, start: number, target: number): number {
  if (start === target) return 0;
  const visited = new Uint8Array(W * W);
  const dist = new Int32Array(W * W).fill(-1);
  const queue = new Int32Array(W * W);
  let head = 0;
  let tail = 0;
  visited[start] = 1;
  dist[start] = 0;
  queue[tail++] = start;

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % W;
    const y = (idx / W) | 0;
    for (const [dx, dy] of DIRS) {
      const next = world.idx(x + dx, y + dy);
      if (visited[next] || !isTracePassable(world, next)) continue;
      visited[next] = 1;
      dist[next] = dist[idx] + 1;
      if (next === target) return dist[next];
      queue[tail++] = next;
    }
  }
  return -1;
}

function isTracePassable(world: World, idx: number): boolean {
  const cell = world.cells[idx];
  if (cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.LIFT) return true;
  if (cell !== Cell.DOOR) return false;
  const door = world.doors.get(idx);
  return !door || (door.state !== DoorState.LOCKED && door.state !== DoorState.HERMETIC_CLOSED);
}

function connectChthonicRoomsOrganic(world: World, rooms: Room[], protectedMask: Uint8Array, rng: () => number): void {
  const n = rooms.length;
  if (n < 2) return;

  const inMST = new Uint8Array(n);
  const minDist = new Float64Array(n).fill(Infinity);
  const minFrom = new Int32Array(n).fill(-1);

  inMST[0] = 1;
  const cx0 = rooms[0].x + Math.floor(rooms[0].w / 2);
  const cy0 = rooms[0].y + Math.floor(rooms[0].h / 2);
  for (let j = 1; j < n; j++) {
    minDist[j] = world.dist(cx0, cy0, rooms[j].x + Math.floor(rooms[j].w / 2), rooms[j].y + Math.floor(rooms[j].h / 2));
    minFrom[j] = 0;
  }

  const mstEdges: [number, number][] = [];
  for (let iter = 0; iter < n - 1; iter++) {
    let best = Infinity;
    let bestIdx = -1;
    for (let j = 0; j < n; j++) {
      if (!inMST[j] && minDist[j] < best) {
        best = minDist[j];
        bestIdx = j;
      }
    }
    if (bestIdx < 0) break;

    inMST[bestIdx] = 1;
    mstEdges.push([minFrom[bestIdx], bestIdx]);

    const cxB = rooms[bestIdx].x + Math.floor(rooms[bestIdx].w / 2);
    const cyB = rooms[bestIdx].y + Math.floor(rooms[bestIdx].h / 2);
    for (let j = 0; j < n; j++) {
      if (inMST[j]) continue;
      const d = world.dist(cxB, cyB, rooms[j].x + Math.floor(rooms[j].w / 2), rooms[j].y + Math.floor(rooms[j].h / 2));
      if (d < minDist[j]) {
        minDist[j] = d;
        minFrom[j] = bestIdx;
      }
    }
  }

  const extra = Math.floor(n * 0.35);
  for (let k = 0; k < extra; k++) {
    const ai = Math.floor(rng() * n);
    const bi = Math.floor(rng() * n);
    if (ai !== bi) {
      mstEdges.push([ai, bi]);
    }
  }

  for (const [i, j] of mstEdges) {
    const a = rooms[i], b = rooms[j];
    let currX = a.x + Math.floor(a.w / 2);
    let currY = a.y + Math.floor(a.h / 2);
    const targetX = b.x + Math.floor(b.w / 2);
    const targetY = b.y + Math.floor(b.h / 2);

    const waypoints: { x: number; y: number }[] = [];
    const dist = Math.hypot(targetX - currX, targetY - currY);
    if (dist > 25) {
      const midX = Math.floor((currX + targetX) / 2);
      const midY = Math.floor((currY + targetY) / 2);
      const offset = Math.floor((rng() - 0.5) * dist * 0.6);
      let wx = midX + (targetY - currY > 0 ? offset : -offset);
      let wy = midY + (targetX - currX > 0 ? -offset : offset);
      wx = Math.max(20, Math.min(W - 20, wx));
      wy = Math.max(20, Math.min(W - 20, wy));
      waypoints.push({ x: wx, y: wy });
    }
    waypoints.push({ x: targetX, y: targetY });

    let stepCounter = 0;
    for (const wp of waypoints) {
      while (currX !== wp.x || currY !== wp.y) {
        if (currX !== wp.x && currY !== wp.y) {
          if (rng() < 0.5) currX += Math.sign(wp.x - currX);
          else currY += Math.sign(wp.y - currY);
        } else if (currX !== wp.x) {
          currX += Math.sign(wp.x - currX);
        } else {
          currY += Math.sign(wp.y - currY);
        }
        stepCounter++;

        const brush = rng() < 0.15 ? 1 : 0;
        for (let dy = -brush; dy <= brush; dy++) {
          for (let dx = -brush; dx <= brush; dx++) {
            const cIdx = world.idx(currX + dx, currY + dy);
            if (protectedMask[cIdx] !== 1 && world.cells[cIdx] === Cell.WALL) {
              world.cells[cIdx] = Cell.FLOOR;
              world.floorTex[cIdx] = Tex.F_CONCRETE;
              world.wallTex[cIdx] = Tex.CONCRETE;
              world.features[cIdx] = Feature.NONE;
              world.roomMap[cIdx] = a.id;
              protectedMask[cIdx] = 2;
            }
          }
        }

        if (stepCounter % 15 === 0 || (currX === wp.x && currY === wp.y && wp !== waypoints[waypoints.length - 1])) {
          if (rng() < 0.7) {
            const hr = 2 + Math.floor(rng() * 4);
            const fTex = rng() < 0.4 ? Tex.F_CONCRETE : rng() < 0.7 ? Tex.F_TILE : Tex.F_GUT;
            const wTex = fTex === Tex.F_TILE ? Tex.METAL : fTex === Tex.F_GUT ? Tex.GUT : Tex.CONCRETE;
            for (let hy = -hr; hy <= hr; hy++) {
              for (let hx = -hr; hx <= hr; hx++) {
                const tx = currX + hx, ty = currY + hy;
                const hIdx = world.idx(tx, ty);
                if (protectedMask[hIdx] !== 1 && world.cells[hIdx] === Cell.WALL) {
                  let touchesOther = false;
                  for (let ny = -1; ny <= 1; ny++) {
                    for (let nx = -1; nx <= 1; nx++) {
                      if (nx === 0 && ny === 0) continue;
                      const nIdx = world.idx(tx + nx, ty + ny);
                      if (world.cells[nIdx] !== Cell.WALL && world.roomMap[nIdx] !== -1 && world.roomMap[nIdx] !== a.id && world.roomMap[nIdx] !== b.id) {
                        touchesOther = true;
                        break;
                      }
                    }
                    if (touchesOther) break;
                  }
                  if (touchesOther) continue;

                  world.cells[hIdx] = Cell.FLOOR;
                  world.floorTex[hIdx] = fTex;
                  world.wallTex[hIdx] = wTex;
                  world.features[hIdx] = Feature.NONE;
                  world.roomMap[hIdx] = a.id;
                  protectedMask[hIdx] = 2;
                }
              }
            }
            const centerIdx = world.idx(currX, currY);
            if (protectedMask[centerIdx] !== 1 && world.cells[centerIdx] === Cell.FLOOR && world.features[centerIdx] === Feature.NONE) {
              world.features[centerIdx] = rng() < 0.3 ? Feature.LAMP : rng() < 0.6 ? Feature.MACHINE : Feature.APPARATUS;
            }
          }
        }
      }
    }
  }
}

function carveChthonicLabyrinth(world: World, protectedMask: Uint8Array, rng: () => number): void {
  const newRooms: Room[] = [];
  const numCaverns = 1200;
  
  for (let i = 0; i < numCaverns; i++) {
    let cx = 40 + Math.floor(rng() * (W - 80));
    let cy = 40 + Math.floor(rng() * (W - 80));
    
    if (protectedMask[world.idx(cx, cy)] === 1) continue;
    
    const type = rng() < 0.3 ? RoomType.STORAGE : rng() < 0.6 ? RoomType.PRODUCTION : RoomType.CORRIDOR;
    const room: Room = {
      id: world.rooms.length,
      type,
      x: cx, y: cy, w: 0, h: 0,
      doors: [], sealed: false,
      name: `Старая выработка #${i + 1}`,
      apartmentId: -1,
      wallTex: Tex.CONCRETE,
      floorTex: Tex.F_CONCRETE,
    };
    world.rooms.push(room);
    newRooms.push(room);
    
    const steps = 15 + Math.floor(rng() * 30);
    let minX = cx, maxX = cx, minY = cy, maxY = cy;
    
    for (let step = 0; step < steps; step++) {
      const radius = 3 + Math.floor(rng() * 5); 
      const r2 = radius * radius;
      
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx*dx + dy*dy > r2) continue;
          const tx = cx + dx, ty = cy + dy;
          const idx = world.idx(tx, ty);
          if (protectedMask[idx] === 1 || world.cells[idx] === Cell.DOOR || world.cells[idx] === Cell.LIFT) continue;
          
          if (world.cells[idx] === Cell.WALL) {
            let touchesOther = false;
            for (let ny = -1; ny <= 1; ny++) {
              for (let nx = -1; nx <= 1; nx++) {
                if (nx === 0 && ny === 0) continue;
                const nIdx = world.idx(tx + nx, ty + ny);
                if (world.cells[nIdx] !== Cell.WALL && world.roomMap[nIdx] !== -1 && world.roomMap[nIdx] !== room.id) {
                  touchesOther = true;
                  break;
                }
              }
              if (touchesOther) break;
            }
            if (touchesOther) continue;

            world.cells[idx] = Cell.FLOOR;
            world.floorTex[idx] = room.floorTex;
            world.features[idx] = Feature.NONE;
          }
          if (world.roomMap[idx] === -1 || world.roomMap[idx] === room.id) {
             world.roomMap[idx] = room.id;
             minX = Math.min(minX, tx);
             maxX = Math.max(maxX, tx);
             minY = Math.min(minY, ty);
             maxY = Math.max(maxY, ty);
             protectedMask[idx] = 2;
          }
        }
      }
      
      cx += Math.floor(rng() * 11) - 5;
      cy += Math.floor(rng() * 11) - 5;
      cx = Math.max(20, Math.min(W - 20, cx));
      cy = Math.max(20, Math.min(W - 20, cy));
    }
    
    room.x = minX;
    room.y = minY;
    room.w = Math.max(1, maxX - minX + 1);
    room.h = Math.max(1, maxY - minY + 1); 
    
    const featureCount = Math.floor((room.w * room.h) / 80);
    for (let j = 0; j < featureCount; j++) {
       const fx = room.x + Math.floor(rng() * room.w);
       const fy = room.y + Math.floor(rng() * room.h);
       const ci = world.idx(fx, fy);
       if (world.roomMap[ci] === room.id && world.cells[ci] === Cell.FLOOR && world.features[ci] === Feature.NONE) {
          world.features[ci] = type === RoomType.STORAGE ? Feature.SHELF : (rng() < 0.5 ? Feature.MACHINE : Feature.APPARATUS);
       }
    }
  }
  
  const connectable = world.rooms.filter(r => !r.sealed && r.type !== RoomType.HQ);
  connectChthonicRoomsOrganic(world, connectable, protectedMask, rng);
}
