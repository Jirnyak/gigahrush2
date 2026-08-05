/* -- Design floor: voronoi_quarantine - Laguerre quarantine cells -- */

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
  QuestType,
  RoomType,
  Tex,
  W,
  ZoneFaction,
  msg,
  type Entity,
  type Item,
  type Room,
  type TerritoryOwner,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { hashSeed, withSeededRandom } from '../../core/rand';
import { factionToTerritoryOwner } from '../../data/factions';
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { placeEmergencyPanel } from '../../systems/emergency_panels';
import { randomRPG } from '../../systems/rpg';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { ensureConnectivity, generateZones, sanitizeDoors } from '../shared';
import type { FloorGeneration } from '../floor_manifest';
import { buildVoronoiRoomCells, type VoronoiRoomSite } from '../voronoi_cells';
import { registerContentInteractionHook, registerContentRuntimeHook, type ContentInteractionContext, type ContentRuntimeContext } from '../../systems/content_hooks';
import { publishEvent } from '../../systems/events';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('voronoi_quarantine');

export const VORONOI_QUARANTINE_ROUTE_ID = 'voronoi_quarantine' as const;
export const VORONOI_QUARANTINE_Z = 6 as const;
export const VORONOI_QUARANTINE_BASE_FLOOR = FloorLevel.KVARTIRY;

export const VORONOI_QUARANTINE_ROOM_NAMES = {
  northCheckpoint: 'Северный пост карантинной диаграммы',
  cleanClinic: 'Чистая клиника ячейки Ллойда',
  forgeOffice: 'Канцелярия липких пропусков',
  publicKitchen: 'Кухня общих котлов карантина',
  triageHub: 'Сортировочный центр рёбер',
  infectedWard: 'Жёлтая палата заражённого ребра',
  redWard: 'Красная палата мокрого допуска',
  supplyConnector: 'Складовой соединитель сухих пайков',
  corpsePitWest: 'Западная трупная яма за санитарной стеной',
  corpsePitEast: 'Восточная трупная яма без журнала',
  southCheckpoint: 'Южный пост выхода из карантина',
} as const;

type SiteRole =
  | 'checkpoint'
  | 'clinic'
  | 'office'
  | 'kitchen'
  | 'triage'
  | 'ward'
  | 'supply'
  | 'corpse_pit';

type NpcId =
  | 'voronoi_quarantine_doctor_pavel'
  | 'voronoi_quarantine_clerk_zoya'
  | 'voronoi_quarantine_infected_lev'
  | 'voronoi_quarantine_quartermaster_marta';

interface SiteSeed {
  key?: keyof typeof VORONOI_QUARANTINE_ROOM_NAMES;
  name?: string;
  role: SiteRole;
  x: number;
  y: number;
  weight: number;
  roomType: RoomType;
  wallTex: Tex;
  floorTex: Tex;
  faction: ZoneFaction;
  danger: 1 | 2 | 3 | 4 | 5;
  infected?: boolean;
}

interface Site extends SiteSeed {
  id: number;
  name: string;
  originX: number;
  originY: number;
}

interface Bounds {
  minDx: number;
  minDy: number;
  maxDx: number;
  maxDy: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  count: number;
}

interface RidgeCandidate {
  a: number;
  b: number;
  x: number;
  y: number;
  nx: number;
  ny: number;
  score: number;
}

interface HqSupportSpec {
  type: RoomType;
  name: string;
  dx: number;
  dy: number;
  w: number;
  h: number;
  wallTex: Tex;
  floorTex: Tex;
}

interface FactionHqSpec {
  owner: TerritoryOwner;
  key: keyof typeof VORONOI_QUARANTINE_ROOM_NAMES;
  name: string;
  dx: number;
  dy: number;
  w: number;
  h: number;
  wallTex: Tex;
  floorTex: Tex;
  support: readonly HqSupportSpec[];
}

interface QuarantineCellStats {
  mid: number;
  micro: number;
  microDoors: number;
}

interface MicroVoronoiCellData {
  parentSiteId: number;
  serial: number;
  role: SiteRole;
  faction: ZoneFaction;
  roomType: RoomType;
  wallTex: Tex;
  floorTex: Tex;
  name: string;
}

type MicroVoronoiSite = VoronoiRoomSite<MicroVoronoiCellData>;

export interface VoronoiQuarantineLayout {
  routeId: typeof VORONOI_QUARANTINE_ROUTE_ID;
  lloydPasses: number;
  siteCount: number;
  macroSiteCount: number;
  midCellCount: number;
  microCellCount: number;
  microDoorCount: number;
  siteCellCounts: readonly number[];
  adjacencyEdges: readonly [number, number][];
  ridgeDoorCount: number;
  lockedPassDoorCount: number;
  supplyConnectorDoorCount: number;
  connected: boolean;
}

const SEED = hashSeed(VORONOI_QUARANTINE_ROUTE_ID);
const CX = W >> 1;
const CY = W >> 1;
const CORE_MIN = 0;
const CORE_MAX = W - 1;
const LLOYD_PASSES = 2;
const LLOYD_STEP = 8;
const OWNER_NONE = -1;
const GENERATED_CELL_RING_COUNT = 4;
const MICRO_ROOM_TARGET_MIN = 12_288;
const MICRO_SITE_SAMPLE_ATTEMPTS = 32;
const MICRO_EXTRA_DOOR_RATIO = 0.42;

const SITE_SEEDS: readonly SiteSeed[] = [
  { key: 'northCheckpoint', role: 'checkpoint', x: CX, y: 250, weight: 118, roomType: RoomType.HQ, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE, faction: ZoneFaction.LIQUIDATOR, danger: 3 },
  { key: 'cleanClinic', role: 'clinic', x: 402, y: 370, weight: 132, roomType: RoomType.MEDICAL, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE, faction: ZoneFaction.SCIENTIST, danger: 2 },
  { key: 'forgeOffice', role: 'office', x: 620, y: 362, weight: 104, roomType: RoomType.OFFICE, wallTex: Tex.MARBLE, floorTex: Tex.F_PARQUET, faction: ZoneFaction.CITIZEN, danger: 2 },
  { key: 'publicKitchen', role: 'kitchen', x: 310, y: 522, weight: 126, roomType: RoomType.KITCHEN, wallTex: Tex.BRICK, floorTex: Tex.F_LINO, faction: ZoneFaction.CITIZEN, danger: 2 },
  { key: 'triageHub', role: 'triage', x: CX, y: CY, weight: 148, roomType: RoomType.COMMON, wallTex: Tex.PANEL, floorTex: Tex.F_LINO, faction: ZoneFaction.SCIENTIST, danger: 3 },
  { key: 'infectedWard', role: 'ward', x: 706, y: 508, weight: 130, roomType: RoomType.MEDICAL, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE, faction: ZoneFaction.SCIENTIST, danger: 4, infected: true },
  { key: 'redWard', role: 'ward', x: 440, y: 655, weight: 128, roomType: RoomType.MEDICAL, wallTex: Tex.HERMO_WALL, floorTex: Tex.F_TILE, faction: ZoneFaction.WILD, danger: 4, infected: true },
  { key: 'supplyConnector', role: 'supply', x: 690, y: 660, weight: 112, roomType: RoomType.STORAGE, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE, faction: ZoneFaction.LIQUIDATOR, danger: 3 },
  { key: 'corpsePitWest', role: 'corpse_pit', x: 270, y: 745, weight: 120, roomType: RoomType.STORAGE, wallTex: Tex.HERMO_WALL, floorTex: Tex.F_WATER, faction: ZoneFaction.SAMOSBOR, danger: 5, infected: true },
  { key: 'corpsePitEast', role: 'corpse_pit', x: 595, y: 785, weight: 116, roomType: RoomType.STORAGE, wallTex: Tex.HERMO_WALL, floorTex: Tex.F_WATER, faction: ZoneFaction.SAMOSBOR, danger: 5, infected: true },
  { key: 'southCheckpoint', role: 'checkpoint', x: CX, y: 882, weight: 118, roomType: RoomType.HQ, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE, faction: ZoneFaction.LIQUIDATOR, danger: 3 },
];

const HQ_SUPPORTS = {
  citizen: [
    { type: RoomType.KITCHEN, name: 'кухня кипячёных очередей', dx: -34, dy: 24, w: 18, h: 12, wallTex: Tex.BRICK, floorTex: Tex.F_LINO },
    { type: RoomType.BATHROOM, name: 'туалет чистой очереди', dx: 32, dy: 24, w: 14, h: 10, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
    { type: RoomType.STORAGE, name: 'кладовая общих халатов', dx: 4, dy: 40, w: 20, h: 12, wallTex: Tex.PANEL, floorTex: Tex.F_CONCRETE },
  ],
  liquidator: [
    { type: RoomType.STORAGE, name: 'оружейная сухого ребра', dx: -36, dy: -22, w: 20, h: 12, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
    { type: RoomType.OFFICE, name: 'журнал допуска поста', dx: 34, dy: -20, w: 18, h: 12, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
    { type: RoomType.BATHROOM, name: 'санузел смены ликвидаторов', dx: -4, dy: -38, w: 14, h: 10, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
  ],
  cultist: [
    { type: RoomType.COMMON, name: 'шёпотная общая за ребром', dx: -28, dy: 22, w: 20, h: 12, wallTex: Tex.DARK, floorTex: Tex.F_CARPET },
    { type: RoomType.STORAGE, name: 'тайник мокрых печатей', dx: 28, dy: 22, w: 16, h: 10, wallTex: Tex.HERMO_WALL, floorTex: Tex.F_CONCRETE },
    { type: RoomType.BATHROOM, name: 'умывальник обета карантина', dx: 0, dy: 38, w: 14, h: 10, wallTex: Tex.TILE_W, floorTex: Tex.F_WATER },
  ],
  scientist: [
    { type: RoomType.MEDICAL, name: 'чистая перевязочная НИИ', dx: -38, dy: 22, w: 22, h: 14, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
    { type: RoomType.PRODUCTION, name: 'лабораторный стол проб', dx: 36, dy: 22, w: 22, h: 14, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
    { type: RoomType.OFFICE, name: 'кабинет протокола Ллойда', dx: 0, dy: 42, w: 22, h: 12, wallTex: Tex.MARBLE, floorTex: Tex.F_PARQUET },
  ],
  wild: [
    { type: RoomType.KITCHEN, name: 'коптильня диких халатов', dx: -30, dy: -24, w: 18, h: 12, wallTex: Tex.ROTTEN, floorTex: Tex.F_LINO },
    { type: RoomType.STORAGE, name: 'свалка фильтров и бинтов', dx: 30, dy: -24, w: 18, h: 12, wallTex: Tex.ROTTEN, floorTex: Tex.F_CONCRETE },
    { type: RoomType.BATHROOM, name: 'грязная душевая ячейки', dx: 0, dy: -42, w: 14, h: 10, wallTex: Tex.TILE_W, floorTex: Tex.F_WATER },
  ],
} satisfies Record<string, readonly HqSupportSpec[]>;

const FACTION_HQ_SPECS: readonly FactionHqSpec[] = [
  { owner: ZoneFaction.SCIENTIST, key: 'cleanClinic', name: 'НИИ Вороного: гермоядро чистой клиники', dx: -24, dy: -24, w: 26, h: 18, wallTex: Tex.HERMO_WALL, floorTex: Tex.F_TILE, support: HQ_SUPPORTS.scientist },
  { owner: ZoneFaction.SCIENTIST, key: 'triageHub', name: 'НИИ Вороного: пост сортировки рёбер', dx: 34, dy: -30, w: 24, h: 16, wallTex: Tex.HERMO_WALL, floorTex: Tex.F_TILE, support: HQ_SUPPORTS.scientist },
  { owner: ZoneFaction.LIQUIDATOR, key: 'northCheckpoint', name: 'Ликвидаторы: гермоядро северного допуска', dx: -24, dy: 24, w: 24, h: 16, wallTex: Tex.HERMO_WALL, floorTex: Tex.F_CONCRETE, support: HQ_SUPPORTS.liquidator },
  { owner: ZoneFaction.CITIZEN, key: 'publicKitchen', name: 'Граждане: гермоядро общей кухни', dx: -24, dy: -28, w: 22, h: 16, wallTex: Tex.HERMO_WALL, floorTex: Tex.F_LINO, support: HQ_SUPPORTS.citizen },
  { owner: ZoneFaction.CULTIST, key: 'corpsePitWest', name: 'Культисты: скрытая гермокелья мокрой диаграммы', dx: 24, dy: -28, w: 20, h: 14, wallTex: Tex.HERMO_WALL, floorTex: Tex.F_CARPET, support: HQ_SUPPORTS.cultist },
  { owner: ZoneFaction.WILD, key: 'redWard', name: 'Дикие: гермоядро красной палаты', dx: 28, dy: -34, w: 22, h: 15, wallTex: Tex.HERMO_WALL, floorTex: Tex.F_CONCRETE, support: HQ_SUPPORTS.wild },
];

const NPC_DEFS: Record<NpcId, PlotNpcDef> = {
  voronoi_quarantine_doctor_pavel: {
    name: 'Павел Диаграммный',
    isFemale: false,
    faction: Faction.SCIENTIST,
    occupation: Occupation.DOCTOR,
    sprite: Occupation.DOCTOR,
    hp: 132,
    maxHp: 132,
    money: 90,
    speed: 0.82,
    inventory: [
      { defId: 'official_quarantine_clearance', count: 1 },
      { defId: 'antibiotic', count: 1 },
      { defId: 'sterile_swab', count: 2 },
    ],
    talkLines: [
      'Карантин здесь нарезан не стенами, а ближайшей бедой. Где центр ячейки - там и начальство.',
      'Рёбра между палатами открываются только если бумага чище человека.',
      'Лев ещё говорит. Значит, ведём его как пациента, а не как статистику.',
    ],
    talkLinesPost: [
      'Диаграмма сошлась. Это не значит, что люди выздоровели.',
      'Если пост пропустил липовый допуск, значит пост тоже болен.',
    ],
  },
  voronoi_quarantine_clerk_zoya: {
    name: 'Зоя Рёберная',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 86,
    maxHp: 86,
    money: 118,
    speed: 0.78,
    inventory: [
      { defId: 'blank_form', count: 2 },
      { defId: 'forged_quarantine_clearance', count: 1 },
      { defId: 'ink_bottle', count: 1 },
    ],
    talkLines: [
      'Граница любит круглую печать. Линия Вороного любит чужую фамилию.',
      'Пустой бланк станет пропуском, если не спрашивать, кто пустой.',
      'Чистая справка открывает пост. Липовая открывает разговор на посту.',
    ],
    talkLinesPost: [
      'На бумаге вы теперь почти здоровы.',
      'Не показывайте липовый пропуск доктору. Он видел настоящий.',
    ],
  },
  voronoi_quarantine_infected_lev: {
    name: 'Лев Жёлтый',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.TRAVELER,
    sprite: Occupation.TRAVELER,
    hp: 70,
    maxHp: 92,
    money: 9,
    speed: 0.64,
    inventory: [
      { defId: 'quarantine_medcard', count: 1 },
      { defId: 'contaminated_swab', count: 1 },
    ],
    talkLines: [
      'Я не яма. Я пока палата. Доведите меня до врача словами, руками не надо.',
      'Пост видит кашель раньше лица. Врач видит лицо раньше журнала.',
      'Если я упаду у ребра, меня запишут в соседнюю ячейку.',
    ],
    talkLinesPost: [
      'Доктор сказал: пациент. Я запомнил это слово.',
      'Температура стала ниже стены. Уже легче.',
    ],
  },
  voronoi_quarantine_quartermaster_marta: {
    name: 'Марта Соединитель',
    isFemale: true,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.STOREKEEPER,
    sprite: Occupation.STOREKEEPER,
    hp: 120,
    maxHp: 120,
    money: 144,
    speed: 0.84,
    inventory: [
      { defId: 'gasmask_filter', count: 1 },
      { defId: 'filter_receipt', count: 1 },
      { defId: 'door_kit', count: 1 },
    ],
    talkLines: [
      'Складовой соединитель сухой. Поэтому его и заперли.',
      'Принесёте обеззараживающую жидкость - открою сухую полку без очереди.',
      'Пайки идут по рёбрам. Кто режет ребро, тот решает, чья ячейка ест.',
    ],
    talkLinesPost: [
      'Соединитель открыт настолько, насколько это записано.',
      'Фильтр считайте едой. Дышать тоже надо ежедневно.',
    ],
  },
};

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'voronoi_quarantine_doctor_pavel', NPC_DEFS.voronoi_quarantine_doctor_pavel, [
  {
    id: 'voronoi_quarantine_decon_border',
    giverNpcId: 'voronoi_quarantine_doctor_pavel',
    type: QuestType.FETCH,
    desc: 'Павел Диаграммный: «Принесите обеззараживающую жидкость к чистой клинике. Тогда грязное ребро станет медицинским, а не мясным.»',
    targetItem: 'decon_fluid',
    targetCount: 1,
    rewardItem: 'official_quarantine_clearance',
    rewardCount: 1,
    extraRewards: [{ defId: 'antibiotic', count: 1 }],
    relationDelta: 12,
    xpReward: 80,
    moneyReward: 45,
    eventTags: [VORONOI_QUARANTINE_ROUTE_ID, 'decon', 'cross_border', 'quarantine'],
    eventPrivacy: 'local',
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'voronoi_quarantine_clerk_zoya', NPC_DEFS.voronoi_quarantine_clerk_zoya, [
  {
    id: 'voronoi_quarantine_forge_pass',
    giverNpcId: 'voronoi_quarantine_clerk_zoya',
    type: QuestType.FETCH,
    desc: 'Зоя Рёберная: «Дайте пустой бланк. Я сделаю пропуск, который выдержит одно ребро и не выдержит совесть.»',
    targetItem: 'blank_form',
    targetCount: 1,
    rewardItem: 'forged_quarantine_clearance',
    rewardCount: 1,
    extraRewards: [{ defId: 'fake_pass', count: 1 }],
    relationDelta: 4,
    xpReward: 45,
    moneyReward: 18,
    eventTags: [VORONOI_QUARANTINE_ROUTE_ID, 'forgery', 'pass', 'cross_border'],
    eventPrivacy: 'secret',
    eventData: { forgedClearance: true },
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'voronoi_quarantine_infected_lev', NPC_DEFS.voronoi_quarantine_infected_lev, [
  {
    id: 'voronoi_quarantine_escort_infected',
    giverNpcId: 'voronoi_quarantine_infected_lev',
    type: QuestType.TALK,
    desc: 'Лев Жёлтый: «Доведите меня до Павла. Пусть врач скажет посту, что я ещё пациент, а не соседняя яма.»',
    targetPlotNpcId: 'voronoi_quarantine_doctor_pavel',
    rewardItem: 'clean_health_cert',
    rewardCount: 1,
    extraRewards: [{ defId: 'quarantine_medcard', count: 1 }],
    relationDelta: 16,
    xpReward: 70,
    moneyReward: 12,
    eventTags: [VORONOI_QUARANTINE_ROUTE_ID, 'escort', 'infected_npc', 'triage'],
    eventPrivacy: 'local',
    failOnNpcDeathPlotId: 'voronoi_quarantine_infected_lev',
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'voronoi_quarantine_quartermaster_marta', NPC_DEFS.voronoi_quarantine_quartermaster_marta, [
  {
    id: 'voronoi_quarantine_open_supply_connector',
    giverNpcId: 'voronoi_quarantine_quartermaster_marta',
    type: QuestType.FETCH,
    desc: 'Марта Соединитель: «Канистру обеззараживания принесёте - сухой складовой соединитель откроется без крика кухни.»',
    targetItem: 'decon_fluid',
    targetCount: 1,
    rewardItem: 'gasmask_filter',
    rewardCount: 1,
    extraRewards: [{ defId: 'filtered_water', count: 1 }, { defId: 'ration_registry_extract', count: 1 }],
    relationDelta: 10,
    xpReward: 65,
    moneyReward: 40,
    eventTags: [VORONOI_QUARANTINE_ROUTE_ID, 'supply_connector', 'open_supply', 'decon'],
    eventPrivacy: 'witnessed',
    eventData: { supplyConnectorOpened: true },
  },
]);

const layouts = new WeakMap<World, VoronoiQuarantineLayout>();

export function getVoronoiQuarantineLayout(world: World): VoronoiQuarantineLayout | undefined {
  const layout = layouts.get(world);
  if (!layout) return undefined;
  return {
    ...layout,
    siteCellCounts: [...layout.siteCellCounts],
    adjacencyEdges: layout.adjacencyEdges.map(edge => [edge[0], edge[1]] as [number, number]),
  };
}

export function generateVoronoiQuarantineDesignFloor(seed = SEED): FloorGeneration {
  return withSeededRandom(seed, () => {
    const world = new World();
    const entities: Entity[] = [];
    const nextId = { v: 1 };

    initWorld(world);
    const sites = buildSites(world, seed);
    const owner = assignLaguerreCells(world, sites);
    const edgeMap = collectRidgeCandidates(world, owner, sites);
    const ridgeDoors = placeRidgeDoors(world, sites, edgeMap);
    buildRoomsFromOwners(world, sites, owner);
    placeFactionMiniHqs(world, sites, owner, seed);
    const cellStats = placeQuarantineMidMicroRooms(world, sites, owner, seed);
    decorateSites(world, sites, owner, seed);
    placeLifts(world, sites, owner);
    generateZones(world);
    tuneVoronoiQuarantineRouteZones(world);
    placeQuarantineEmergencyPanels(world, sites, owner, seed);

    const owners = spawnNpcs(world, entities, nextId, sites, owner);
    placeContainers(world, sites, owner, owners);
    placeDrops(world, entities, nextId, sites, owner);
    spawnThreats(world, entities, nextId, sites, owner);
    stampContamination(world, sites, seed);

    const spawn = findSiteCell(world, owner, sites, siteId(sites, 'northCheckpoint'));
    sanitizeDoors(world);
    ensureConnectivity(world, spawn.x + 0.5, spawn.y + 0.5);
    world.rebuildContainerMap();
    world.bakeLights();

    layouts.set(world, {
      routeId: VORONOI_QUARANTINE_ROUTE_ID,
      lloydPasses: LLOYD_PASSES,
      siteCount: sites.length + cellStats.mid + cellStats.micro,
      macroSiteCount: sites.length,
      midCellCount: cellStats.mid,
      microCellCount: cellStats.micro,
      microDoorCount: countMicroVoronoiDoors(world),
      siteCellCounts: countSiteCells(owner, sites.length),
      adjacencyEdges: sortedAdjacency(edgeMap),
      ridgeDoorCount: ridgeDoors.total,
      lockedPassDoorCount: ridgeDoors.lockedPass,
      supplyConnectorDoorCount: ridgeDoors.supplyConnector,
      connected: ridgeGraphConnected(sites, sortedAdjacency(edgeMap)),
    });

    return { world, entities, spawnX: spawn.x + 0.5, spawnY: spawn.y + 0.5 };
  });
}

export function tuneVoronoiQuarantineRouteZones(world: World): void {
  const layoutRooms = world.rooms.filter(room => room.name && siteRoleByRoomName(room.name) !== undefined);
  for (const zone of world.zones) {
    let nearest: Room | undefined;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (const room of layoutRooms) {
      const d2 = world.dist2(zone.cx, zone.cy, room.x + room.w / 2, room.y + room.h / 2);
      if (d2 < bestD2) {
        bestD2 = d2;
        nearest = room;
      }
    }
    const role = nearest ? siteRoleByRoomName(nearest.name) : undefined;
    switch (role) {
      case 'checkpoint':
        zone.faction = ZoneFaction.LIQUIDATOR;
        zone.level = Math.max(zone.level, 3);
        zone.hasLift = true;
        break;
      case 'clinic':
        zone.faction = ZoneFaction.SCIENTIST;
        zone.level = Math.max(zone.level, 3);
        break;
      case 'office':
      case 'kitchen':
        zone.faction = zone.id % 5 === 0 ? ZoneFaction.LIQUIDATOR : ZoneFaction.CITIZEN;
        zone.level = Math.max(zone.level, 2);
        break;
      case 'triage':
        zone.faction = ZoneFaction.SCIENTIST;
        zone.level = Math.max(zone.level, 4);
        break;
      case 'supply':
        zone.faction = ZoneFaction.LIQUIDATOR;
        zone.level = Math.max(zone.level, 3);
        zone.hasLift = true;
        break;
      case 'ward':
        zone.faction = zone.id % 2 === 0 ? ZoneFaction.SAMOSBOR : ZoneFaction.WILD;
        zone.level = Math.max(zone.level, 4);
        break;
      case 'corpse_pit':
        zone.faction = ZoneFaction.SAMOSBOR;
        zone.level = Math.max(zone.level, 5);
        break;
      default:
        zone.faction = ZoneFaction.CITIZEN;
        zone.level = Math.max(zone.level, 2);
        break;
    }
    zone.fogged = false;
  }

  if (!hasAuthoredVoronoiTerritory(world)) {
    for (let i = 0; i < W * W; i++) {
      world.factionControl[i] = world.zones[world.zoneMap[i]]?.faction ?? ZoneFaction.CITIZEN;
    }
  }
}

function initWorld(world: World): void {
  for (let i = 0; i < W * W; i++) {
    world.wallTex[i] = Tex.PANEL;
    world.floorTex[i] = Tex.F_LINO;
    world.factionControl[i] = ZoneFaction.CITIZEN;
    world.fog[i] = 10;
    world.roomMap[i] = -1;
  }
}

function buildSites(world: World, seed: number): Site[] {
  const sites = SITE_SEEDS.map((src, id) => {
    const jx = Math.round((hash01(seed, id, 11, 0) - 0.5) * 34);
    const jy = Math.round((hash01(seed, id, 17, 0) - 0.5) * 34);
    return {
      ...src,
      id,
      name: src.key ? VORONOI_QUARANTINE_ROOM_NAMES[src.key] : (src.name ?? `Вороной-ячейка ${id}`),
      originX: src.x,
      originY: src.y,
      x: world.wrap(src.x + jx),
      y: world.wrap(src.y + jy),
    };
  });
  const baseCount = sites.length;
  for (let parent = 0; parent < baseCount; parent++) {
    const source = sites[parent]!;
    for (let ring = 0; ring < GENERATED_CELL_RING_COUNT; ring++) {
      const roll = hash01(seed, parent, ring, 211);
      const angle = (ring / GENERATED_CELL_RING_COUNT) * Math.PI * 2 + (roll - 0.5) * 0.95;
      const radius = 80 + ring * 130 + Math.round(hash01(seed, parent, ring, 223) * 50);
      const role = generatedRoleForSite(source.role, ring);
      const faction = generatedFactionForSite(source, ring);
      const id = sites.length;
      const x = world.wrap(Math.round(source.originX + Math.cos(angle) * radius));
      const y = world.wrap(Math.round(source.originY + Math.sin(angle) * radius));
      sites.push({
        id,
        role,
        x,
        y,
        originX: x,
        originY: y,
        weight: Math.max(84, Math.round(source.weight * (0.78 + hash01(seed, parent, ring, 227) * 0.18))),
        roomType: roomTypeForGeneratedRole(role, faction),
        wallTex: wallTexForGeneratedRole(role, faction),
        floorTex: floorTexForGeneratedRole(role, faction),
        faction,
        danger: Math.max(1, Math.min(5, source.danger + (role === 'corpse_pit' ? 1 : 0))) as 1 | 2 | 3 | 4 | 5,
        infected: source.infected || role === 'corpse_pit' || (role === 'ward' && faction !== ZoneFaction.CITIZEN),
        name: generatedSiteName(source, id, ring, role, faction),
      });
    }
  }

  for (let pass = 0; pass < LLOYD_PASSES; pass++) {
    const dxSum = new Float64Array(sites.length);
    const dySum = new Float64Array(sites.length);
    const count = new Int32Array(sites.length);
    for (let y = CORE_MIN; y <= CORE_MAX; y += LLOYD_STEP) {
      for (let x = CORE_MIN; x <= CORE_MAX; x += LLOYD_STEP) {
        const id = nearestSiteId(world, x, y, sites);
        const site = sites[id]!;
        dxSum[id] += world.delta(site.x, x);
        dySum[id] += world.delta(site.y, y);
        count[id]++;
      }
    }
    for (const site of sites) {
      if (count[site.id] <= 0 || (site.key && site.role === 'checkpoint')) continue;
      const avgDx = dxSum[site.id]! / count[site.id]!;
      const avgDy = dySum[site.id]! / count[site.id]!;
      site.x = world.wrap(Math.round(site.x + avgDx * 0.58));
      site.y = world.wrap(Math.round(site.y + avgDy * 0.58));
    }
  }

  return sites;
}

function generatedRoleForSite(role: SiteRole, ring: number): SiteRole {
  if (role === 'checkpoint') return ring % 2 === 0 ? 'supply' : 'office';
  if (role === 'clinic' || role === 'triage') return ring % 3 === 0 ? 'clinic' : ring % 3 === 1 ? 'office' : 'supply';
  if (role === 'kitchen') return ring % 2 === 0 ? 'kitchen' : 'supply';
  if (role === 'ward') return ring % 2 === 0 ? 'ward' : 'triage';
  if (role === 'corpse_pit') return ring % 2 === 0 ? 'corpse_pit' : 'ward';
  if (role === 'supply') return ring % 2 === 0 ? 'supply' : 'office';
  return ring % 2 === 0 ? role : 'supply';
}

function generatedFactionForSite(site: Site, ring: number): ZoneFaction {
  if (site.role === 'corpse_pit' && ring === 1) return ZoneFaction.CULTIST;
  if (site.role === 'ward' && ring === 2) return ZoneFaction.WILD;
  if (site.role === 'clinic' || site.role === 'triage') return ZoneFaction.SCIENTIST;
  if (site.role === 'checkpoint' || site.role === 'supply') return ring === 3 ? ZoneFaction.CITIZEN : ZoneFaction.LIQUIDATOR;
  if (site.role === 'office') return ring === 2 ? ZoneFaction.SCIENTIST : ZoneFaction.CITIZEN;
  if (site.role === 'kitchen') return ring === 3 ? ZoneFaction.WILD : ZoneFaction.CITIZEN;
  return site.faction;
}

function roomTypeForGeneratedRole(role: SiteRole, faction: ZoneFaction): RoomType {
  if (faction === ZoneFaction.CULTIST) return RoomType.COMMON;
  switch (role) {
    case 'checkpoint':
      return RoomType.HQ;
    case 'clinic':
    case 'ward':
      return RoomType.MEDICAL;
    case 'office':
      return RoomType.OFFICE;
    case 'kitchen':
      return RoomType.KITCHEN;
    case 'supply':
    case 'corpse_pit':
      return RoomType.STORAGE;
    case 'triage':
    default:
      return RoomType.COMMON;
  }
}

function wallTexForGeneratedRole(role: SiteRole, faction: ZoneFaction): Tex {
  if (faction === ZoneFaction.CULTIST) return Tex.DARK;
  if (faction === ZoneFaction.SCIENTIST) return Tex.TILE_W;
  if (faction === ZoneFaction.LIQUIDATOR) return Tex.METAL;
  if (faction === ZoneFaction.WILD) return Tex.ROTTEN;
  if (role === 'corpse_pit') return Tex.HERMO_WALL;
  if (role === 'office') return Tex.MARBLE;
  return Tex.PANEL;
}

function floorTexForGeneratedRole(role: SiteRole, faction: ZoneFaction): Tex {
  if (faction === ZoneFaction.CULTIST) return Tex.F_CARPET;
  if (faction === ZoneFaction.SCIENTIST) return Tex.F_TILE;
  if (faction === ZoneFaction.LIQUIDATOR) return Tex.F_CONCRETE;
  if (faction === ZoneFaction.WILD) return Tex.F_LINO;
  if (role === 'corpse_pit') return Tex.F_WATER;
  if (role === 'office') return Tex.F_PARQUET;
  return Tex.F_LINO;
}

function generatedSiteName(parent: Site, id: number, ring: number, role: SiteRole, faction: ZoneFaction): string {
  const owner = faction === ZoneFaction.SCIENTIST ? 'НИИ' :
    faction === ZoneFaction.LIQUIDATOR ? 'пост' :
      faction === ZoneFaction.CULTIST ? 'скрытая' :
        faction === ZoneFaction.WILD ? 'дикая' : 'общая';
  const roleName = role === 'clinic' ? 'клиника' :
    role === 'ward' ? 'палата' :
      role === 'supply' ? 'склад' :
        role === 'office' ? 'контора' :
          role === 'kitchen' ? 'кухня' :
            role === 'corpse_pit' ? 'яма' :
              role === 'checkpoint' ? 'пост' : 'сортировка';
  return `Вороной-${owner} ${roleName} ${ring + 1} от ${parent.name} #${id}`;
}

function quarantineRoomType(site: Site, serial: number, scale: 'mid' | 'micro'): RoomType {
  if (scale === 'mid') return roomTypeForGeneratedRole(site.role, site.faction);
  const motif = (site.id + serial) % 7;
  if (site.role === 'clinic' || site.role === 'ward') return motif <= 2 ? RoomType.MEDICAL : motif === 3 ? RoomType.BATHROOM : RoomType.STORAGE;
  if (site.role === 'kitchen') return motif <= 2 ? RoomType.KITCHEN : motif === 3 ? RoomType.BATHROOM : RoomType.LIVING;
  if (site.role === 'supply' || site.role === 'checkpoint') return motif <= 2 ? RoomType.STORAGE : motif === 3 ? RoomType.OFFICE : RoomType.COMMON;
  if (site.role === 'corpse_pit') return motif <= 2 ? RoomType.STORAGE : motif === 3 ? RoomType.MEDICAL : RoomType.COMMON;
  if (site.role === 'office') return motif <= 3 ? RoomType.OFFICE : RoomType.STORAGE;
  return motif === 0 ? RoomType.BATHROOM : motif === 1 ? RoomType.KITCHEN : RoomType.COMMON;
}

function hasAuthoredVoronoiTerritory(world: World): boolean {
  const seen = new Set<ZoneFaction>();
  for (let i = 0; i < world.factionControl.length; i += 64) {
    seen.add(world.factionControl[i] as ZoneFaction);
    if (seen.size >= 3) return true;
  }
  return false;
}

function assignLaguerreCells(world: World, sites: readonly Site[]): Int16Array {
  const owner = new Int16Array(W * W);
  owner.fill(OWNER_NONE);
  for (let y = CORE_MIN; y <= CORE_MAX; y++) {
    for (let x = CORE_MIN; x <= CORE_MAX; x++) {
      owner[world.idx(x, y)] = nearestSiteId(world, x, y, sites);
    }
  }

  for (let y = CORE_MIN; y <= CORE_MAX; y++) {
    for (let x = CORE_MIN; x <= CORE_MAX; x++) {
      const idx = world.idx(x, y);
      const id = owner[idx];
      if (id < 0) continue;
      const site = sites[id]!;
      let border = false;
      for (const [dx, dy] of ORTHO_DIRS) {
        const ni = world.idx(x + dx, y + dy);
        if (owner[ni] >= 0 && owner[ni] !== id) border = true;
      }
      if (border) {
        world.cells[idx] = Cell.WALL;
        world.wallTex[idx] = site.infected ? Tex.HERMO_WALL : site.wallTex;
        world.hermoWall[idx] = site.infected ? 1 : 0;
        world.roomMap[idx] = -1;
      } else {
        openOwnedCell(world, idx, id, site, hash01(SEED, x, y, id));
      }
    }
  }
  return owner;
}

function collectRidgeCandidates(
  world: World,
  owner: Int16Array,
  sites: readonly Site[],
): Map<string, RidgeCandidate> {
  const map = new Map<string, RidgeCandidate>();
  for (let y = CORE_MIN; y <= CORE_MAX; y++) {
    for (let x = CORE_MIN; x <= CORE_MAX; x++) {
      const idx = world.idx(x, y);
      const a = owner[idx];
      if (a < 0) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const ni = world.idx(x + dx, y + dy);
        const b = owner[ni];
        if (b < 0 || b === a) continue;
        recordRidgeCandidate(world, map, sites, a, b, x, y, x + dx, y + dy);
      }
    }
  }
  return map;
}

function placeRidgeDoors(
  world: World,
  sites: readonly Site[],
  edgeMap: Map<string, RidgeCandidate>,
): { total: number; lockedPass: number; supplyConnector: number } {
  const spanning = spanningRidges(sites.length, sortedCandidates(edgeMap));
  const extras = sortedCandidates(edgeMap)
    .filter(edge => !spanning.some(keep => samePair(edge, keep)))
    .filter(edge => shouldAddExtraRidge(sites[edge.a]!, sites[edge.b]!))
    .slice(0, Math.min(170, sites.length * 3));
  const edges = [...spanning, ...extras];
  let lockedPass = 0;
  let supplyConnector = 0;
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]!;
    const state = ridgeDoorState(sites[edge.a]!, sites[edge.b]!, i);
    if (state.keyId === 'official_quarantine_clearance' || state.keyId === 'forged_quarantine_clearance') lockedPass++;
    if (sitePairHasRole(sites[edge.a]!, sites[edge.b]!, 'supply')) supplyConnector++;
    placeDoubleDoor(world, sites, edge, state.state, state.keyId);
  }
  return { total: edges.length * 2, lockedPass, supplyConnector };
}

function buildRoomsFromOwners(world: World, sites: readonly Site[], owner: Int16Array): void {
  const bounds: Bounds[] = sites.map(() => ({ minDx: W, minDy: W, maxDx: -W, maxDy: -W, minX: W, minY: W, maxX: -1, maxY: -1, count: 0 }));
  for (let y = CORE_MIN; y <= CORE_MAX; y++) {
    for (let x = CORE_MIN; x <= CORE_MAX; x++) {
      const idx = world.idx(x, y);
      const id = owner[idx];
      if (id < 0 || world.cells[idx] === Cell.WALL) continue;
      const b = bounds[id]!;
      const site = sites[id]!;
      b.count++;
      const dx = world.delta(site.x, x);
      const dy = world.delta(site.y, y);
      if (dx < b.minDx) b.minDx = dx;
      if (dx > b.maxDx) b.maxDx = dx;
      if (dy < b.minDy) b.minDy = dy;
      if (dy > b.maxDy) b.maxDy = dy;
    }
  }

  world.rooms = sites.map(site => {
    const b = bounds[site.id]!;
    if (b.count > 0) {
      b.minX = site.x + b.minDx;
      b.minY = site.y + b.minDy;
      b.maxX = site.x + b.maxDx;
      b.maxY = site.y + b.maxDy;
    } else {
      b.minX = site.x - 4;
      b.minY = site.y - 4;
      b.maxX = site.x + 4;
      b.maxY = site.y + 4;
    }
    return {
      id: site.id,
      type: site.roomType,
      x: world.wrap(b.minX),
      y: world.wrap(b.minY),
      w: Math.max(4, b.maxX - b.minX + 1),
      h: Math.max(4, b.maxY - b.minY + 1),
      doors: [],
      sealed: site.infected === true,
      name: site.name,
      apartmentId: -1,
      wallTex: site.wallTex,
      floorTex: site.floorTex,
    };
  });

  for (const door of world.doors.values()) {
    const a = world.rooms[door.roomA];
    const b = world.rooms[door.roomB];
    if (a && !a.doors.includes(door.idx)) a.doors.push(door.idx);
    if (b && !b.doors.includes(door.idx)) b.doors.push(door.idx);
  }
}

function placeFactionMiniHqs(world: World, sites: readonly Site[], owner: Int16Array, seed: number): void {
  for (let i = 0; i < FACTION_HQ_SPECS.length; i++) {
    const spec = FACTION_HQ_SPECS[i]!;
    const base = sitePoint(world, owner, sites, spec.key, spec.dx, spec.dy);
    const hq = tryStampQuarantineRoom(world, owner, sites, siteId(sites, spec.key), base.x, base.y, spec.w, spec.h, RoomType.HQ, spec.name, spec.wallTex, spec.floorTex, spec.owner, true, seed ^ (i * 0x9d));
    if (!hq) continue;
    decorateQuarantineRoom(world, hq, RoomType.HQ, i);
    paintRoomTerritory(world, hq, spec.owner);
    for (let j = 0; j < spec.support.length; j++) {
      const support = spec.support[j]!;
      const point = sitePoint(world, owner, sites, spec.key, spec.dx + support.dx, spec.dy + support.dy);
      const room = tryStampQuarantineRoom(
        world,
        owner,
        sites,
        siteId(sites, spec.key),
        point.x,
        point.y,
        support.w,
        support.h,
        support.type,
        `${spec.name}: ${support.name}`,
        support.wallTex,
        support.floorTex,
        spec.owner,
        false,
        seed ^ (i * 0x111 + j * 0x51),
      );
      if (room) {
        decorateQuarantineRoom(world, room, support.type, i * 7 + j);
        paintRoomTerritory(world, room, spec.owner);
      }
    }
  }
}

function placeQuarantineMidMicroRooms(world: World, sites: readonly Site[], owner: Int16Array, seed: number): QuarantineCellStats {
  const microSites = buildMicroVoronoiSites(world, sites, owner, seed);
  const build = buildVoronoiRoomCells(world, {
    sites: microSites,
    minX: CORE_MIN,
    minY: CORE_MIN,
    maxX: CORE_MAX,
    maxY: CORE_MAX,
    seed,
    bucketSize: 10,
    bucketSearchRadius: 3,
    minRoomCells: 3,
    extraDoorRatio: MICRO_EXTRA_DOOR_RATIO,
    doorTex: Tex.DOOR_WOOD,
    doorState: DoorState.CLOSED,
    cellParentId: (idx) => {
      const parentId = owner[idx];
      if (parentId < 0 || world.roomMap[idx] !== parentId) return -1;
      if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) return -1;
      return parentId;
    },
    createRoom: (site, bounds, roomId) => ({
      id: roomId,
      type: site.data.roomType,
      x: bounds.minX,
      y: bounds.minY,
      w: Math.max(2, bounds.maxX - bounds.minX + 1),
      h: Math.max(2, bounds.maxY - bounds.minY + 1),
      doors: [],
      sealed: false,
      name: site.data.name,
      apartmentId: -1,
      wallTex: site.data.wallTex,
      floorTex: site.data.floorTex,
    }),
    paintCell: (idx, site) => {
      world.floorTex[idx] = world.cells[idx] === Cell.WATER ? Tex.F_WATER : site.data.floorTex;
      world.wallTex[idx] = site.data.wallTex;
      world.factionControl[idx] = site.data.faction;
    },
    wallTexForCell: (_idx, parentId) => {
      const site = sites[parentId];
      return site?.infected ? Tex.HERMO_WALL : (site?.wallTex ?? Tex.PANEL);
    },
  });
  return { mid: 0, micro: build.rooms, microDoors: build.doors };
}

function buildMicroVoronoiSites(world: World, sites: readonly Site[], owner: Int16Array, seed: number): MicroVoronoiSite[] {
  const bounds = siteBounds(world, sites, owner);
  const eligible = sites
    .map(site => ({ site, bounds: bounds[site.id]!, exact: 0, quota: 0 }))
    .filter(entry => entry.bounds.count >= 420);
  const totalArea = eligible.reduce((sum, entry) => sum + entry.bounds.count, 0);
  if (totalArea <= 0) return [];

  let allocated = 0;
  for (const entry of eligible) {
    entry.exact = entry.bounds.count / totalArea * MICRO_ROOM_TARGET_MIN;
    entry.quota = Math.max(1, Math.floor(entry.exact));
    allocated += entry.quota;
  }

  const byRemainder = [...eligible].sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)) || a.site.id - b.site.id);
  for (let i = 0; allocated < MICRO_ROOM_TARGET_MIN && byRemainder.length > 0; i++) {
    byRemainder[i % byRemainder.length]!.quota++;
    allocated++;
  }
  const bySize = [...eligible].sort((a, b) => b.quota - a.quota || b.bounds.count - a.bounds.count);
  for (let i = 0; allocated > MICRO_ROOM_TARGET_MIN && bySize.length > 0; i++) {
    const entry = bySize[i % bySize.length]!;
    if (entry.quota <= 1) continue;
    entry.quota--;
    allocated--;
  }

  const out: MicroVoronoiSite[] = [];
  for (const entry of eligible) placeMicroVoronoiSitesForParent(world, owner, entry.site, entry.bounds, entry.quota, seed, out);
  return out;
}

function placeMicroVoronoiSitesForParent(
  world: World,
  owner: Int16Array,
  parent: Site,
  bounds: Bounds,
  target: number,
  seed: number,
  out: MicroVoronoiSite[],
): void {
  const width = Math.max(1, bounds.maxX - bounds.minX + 1);
  const height = Math.max(1, bounds.maxY - bounds.minY + 1);
  const cols = Math.max(1, Math.round(Math.sqrt(target * width / Math.max(1, height))));
  const rows = Math.max(1, Math.ceil(target / cols));
  const used = new Set<number>();
  let serial = 0;

  for (let row = 0; row < rows && serial < target; row++) {
    for (let col = 0; col < cols && serial < target; col++) {
      const jitterX = (hash01(seed, parent.id, serial, 701) - 0.5) * 0.62;
      const jitterY = (hash01(seed, parent.id, serial, 709) - 0.5) * 0.62;
      const x = bounds.minX + Math.round((col + 0.5 + jitterX) / cols * width);
      const y = bounds.minY + Math.round((row + 0.5 + jitterY) / rows * height);
      const radius = Math.max(5, Math.ceil(Math.max(width / cols, height / rows) * 0.66));
      const point = findNearbyParentFloorCell(world, owner, parent.id, x, y, radius, used);
      if (!point) continue;
      used.add(world.idx(point.x, point.y));
      out.push(makeMicroVoronoiSite(parent, point.x, point.y, serial, out.length, seed));
      serial++;
    }
  }

  for (let attempt = 0; serial < target && attempt < target * MICRO_SITE_SAMPLE_ATTEMPTS; attempt++) {
    const x = bounds.minX + Math.floor(hash01(seed, parent.id, attempt, 719) * width);
    const y = bounds.minY + Math.floor(hash01(seed, parent.id, attempt, 727) * height);
    const point = findNearbyParentFloorCell(world, owner, parent.id, x, y, 12, used);
    if (!point) continue;
    used.add(world.idx(point.x, point.y));
    out.push(makeMicroVoronoiSite(parent, point.x, point.y, serial, out.length, seed));
    serial++;
  }
}

function findNearbyParentFloorCell(
  world: World,
  owner: Int16Array,
  parentSiteId: number,
  x: number,
  y: number,
  radius: number,
  used: ReadonlySet<number>,
): { x: number; y: number } | null {
  const sx = world.wrap(x);
  const sy = world.wrap(y);
  for (let r = 0; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const px = world.wrap(sx + dx);
        const py = world.wrap(sy + dy);
        const idx = world.idx(px, py);
        if (used.has(idx)) continue;
        if (owner[idx] !== parentSiteId) continue;
        if (world.roomMap[idx] !== parentSiteId) continue;
        if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) continue;
        return { x: px, y: py };
      }
    }
  }
  return null;
}

function makeMicroVoronoiSite(parent: Site, x: number, y: number, serial: number, id: number, seed: number): MicroVoronoiSite {
  const role = microRoleForParent(parent, serial);
  const roomType = quarantineRoomType({ ...parent, role }, serial, 'micro');
  return {
    id,
    parentId: parent.id,
    x,
    y,
    weight: 2 + hash01(seed, parent.id, serial, 733) * 5,
    data: {
      parentSiteId: parent.id,
      serial,
      role,
      faction: parent.faction,
      roomType,
      wallTex: wallTexForGeneratedRole(role, parent.faction),
      floorTex: floorTexForGeneratedRole(role, parent.faction),
      name: `Вороной-микроячейка ${parent.name}: ${serial + 1}`,
    },
  };
}

function microRoleForParent(parent: Site, serial: number): SiteRole {
  const motif = (parent.id * 5 + serial) % 9;
  if (parent.role === 'checkpoint') return motif < 4 ? 'checkpoint' : motif < 7 ? 'supply' : 'office';
  if (parent.role === 'clinic') return motif < 5 ? 'clinic' : motif < 7 ? 'triage' : 'office';
  if (parent.role === 'triage') return motif < 5 ? 'triage' : motif < 7 ? 'clinic' : 'supply';
  if (parent.role === 'ward') return motif < 6 ? 'ward' : motif === 6 ? 'triage' : 'supply';
  if (parent.role === 'kitchen') return motif < 5 ? 'kitchen' : motif < 7 ? 'supply' : 'office';
  if (parent.role === 'corpse_pit') return motif < 6 ? 'corpse_pit' : 'ward';
  if (parent.role === 'supply') return motif < 6 ? 'supply' : 'office';
  return motif < 6 ? parent.role : 'supply';
}

function countMicroVoronoiDoors(world: World): number {
  let count = 0;
  for (const door of world.doors.values()) {
    const a = world.rooms[door.roomA]?.name ?? '';
    const b = world.rooms[door.roomB]?.name ?? '';
    if (a.includes('Вороной-микроячейка') || b.includes('Вороной-микроячейка')) count++;
  }
  return count;
}

function tryStampQuarantineRoom(
  world: World,
  owner: Int16Array,
  sites: readonly Site[],
  siteIdValue: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
  type: RoomType,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
  territoryOwner: TerritoryOwner,
  sealed: boolean,
  seed: number,
): Room | null {
  const rx = world.wrap(Math.round(cx - w / 2));
  const ry = world.wrap(Math.round(cy - h / 2));
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const idx = world.idx(rx + dx, ry + dy);
      if (owner[idx] !== siteIdValue) return null;
      if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) return null;
      if (world.roomMap[idx] !== siteIdValue) return null;
      if (world.doors.has(idx)) return null;
    }
  }

  const room: Room = {
    id: world.rooms.length,
    type,
    x: rx,
    y: ry,
    w,
    h,
    doors: [],
    sealed,
    name,
    apartmentId: -1,
    wallTex,
    floorTex,
  };
  world.rooms.push(room);

  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const border = dx < 0 || dx >= w || dy < 0 || dy >= h;
      const idx = world.idx(rx + dx, ry + dy);
      world.cells[idx] = border ? Cell.WALL : Cell.FLOOR;
      world.roomMap[idx] = border ? -1 : room.id;
      world.wallTex[idx] = sealed && border ? Tex.HERMO_WALL : wallTex;
      world.floorTex[idx] = floorTex;
      world.hermoWall[idx] = sealed && border ? 1 : 0;
      world.factionControl[idx] = territoryOwner;
      if (border) world.features[idx] = Feature.NONE;
      else world.fog[idx] = Math.max(2, Math.min(world.fog[idx], sealed ? 12 : 18));
    }
  }

  const side = Math.floor(hash01(seed, siteIdValue, room.id, 91) * 4);
  const doorX = world.wrap(side === 2 ? rx - 1 : side === 3 ? rx + w : rx + 1 + Math.floor(hash01(seed, room.id, 1, 0) * Math.max(1, w - 2)));
  const doorY = world.wrap(side === 0 ? ry - 1 : side === 1 ? ry + h : ry + 1 + Math.floor(hash01(seed, room.id, 2, 0) * Math.max(1, h - 2)));
  const doorIdx = world.idx(doorX, doorY);
  world.cells[doorIdx] = Cell.DOOR;
  world.roomMap[doorIdx] = room.id;
  world.hermoWall[doorIdx] = 0;
  world.wallTex[doorIdx] = sealed ? Tex.DOOR_METAL : Tex.DOOR_WOOD;
  world.features[doorIdx] = Feature.NONE;
  world.doors.set(doorIdx, {
    idx: doorIdx,
    state: sealed ? DoorState.HERMETIC_CLOSED : DoorState.CLOSED,
    roomA: room.id,
    roomB: sites[siteIdValue]?.id ?? -1,
    keyId: '',
    timer: 0,
  });
  room.doors.push(doorIdx);
  const parent = world.rooms[siteIdValue];
  if (parent && !parent.doors.includes(doorIdx)) parent.doors.push(doorIdx);
  return room;
}

function siteBounds(world: World, sites: readonly Site[], owner: Int16Array): Bounds[] {
  const bounds: Bounds[] = sites.map(() => ({ minDx: W, minDy: W, maxDx: -W, maxDy: -W, minX: W, minY: W, maxX: -1, maxY: -1, count: 0 }));
  for (let y = CORE_MIN; y <= CORE_MAX; y++) {
    for (let x = CORE_MIN; x <= CORE_MAX; x++) {
      const idx = world.idx(x, y);
      const id = owner[idx];
      if (id < 0 || world.cells[idx] !== Cell.FLOOR || world.roomMap[idx] !== id) continue;
      const b = bounds[id]!;
      const site = sites[id]!;
      b.count++;
      const dx = world.delta(site.x, x);
      const dy = world.delta(site.y, y);
      if (dx < b.minDx) b.minDx = dx;
      if (dx > b.maxDx) b.maxDx = dx;
      if (dy < b.minDy) b.minDy = dy;
      if (dy > b.maxDy) b.maxDy = dy;
    }
  }
  for (const site of sites) {
    const b = bounds[site.id]!;
    if (b.count > 0) {
      b.minX = site.x + b.minDx;
      b.minY = site.y + b.minDy;
      b.maxX = site.x + b.maxDx;
      b.maxY = site.y + b.maxDy;
    } else {
      b.minX = site.x - 4;
      b.minY = site.y - 4;
      b.maxX = site.x + 4;
      b.maxY = site.y + 4;
    }
  }
  return bounds;
}

function paintRoomTerritory(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      world.factionControl[world.idx(room.x + dx, room.y + dy)] = owner;
    }
  }
}

function decorateQuarantineRoom(world: World, room: Room, type: RoomType, serial: number): void {
  if (type === RoomType.HQ || type === RoomType.OFFICE) {
    setFeature(world, room.x + 2, room.y + 2, Feature.DESK);
    setFeature(world, room.x + room.w - 3, room.y + 2, Feature.SCREEN);
    setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.SHELF);
  } else if (type === RoomType.MEDICAL) {
    for (let x = room.x + 2; x < room.x + room.w - 2; x += 5) setFeature(world, x, room.y + 2, Feature.BED);
    setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.APPARATUS);
  } else if (type === RoomType.KITCHEN) {
    setFeature(world, room.x + 2, room.y + 2, Feature.STOVE);
    setFeature(world, room.x + room.w - 3, room.y + 2, Feature.SINK);
    setFeature(world, room.x + (room.w >> 1), room.y + room.h - 3, Feature.TABLE);
  } else if (type === RoomType.BATHROOM) {
    setFeature(world, room.x + 2, room.y + 2, Feature.SINK);
    setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.TOILET);
  } else if (type === RoomType.STORAGE) {
    for (let x = room.x + 2; x < room.x + room.w - 2; x += 4) setFeature(world, x, room.y + 2, Feature.SHELF);
  } else if (type === RoomType.PRODUCTION) {
    setFeature(world, room.x + 3, room.y + 2, Feature.MACHINE);
    setFeature(world, room.x + room.w - 4, room.y + room.h - 3, Feature.APPARATUS);
  } else {
    setFeature(world, room.x + 2, room.y + 2, serial % 2 === 0 ? Feature.TABLE : Feature.CHAIR);
    setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.LAMP);
  }
}

function decorateSites(world: World, sites: readonly Site[], owner: Int16Array, seed: number): void {
  for (let y = CORE_MIN; y <= CORE_MAX; y++) {
    for (let x = CORE_MIN; x <= CORE_MAX; x++) {
      const idx = world.idx(x, y);
      const id = owner[idx];
      if (id < 0 || world.cells[idx] === Cell.WALL || world.cells[idx] === Cell.DOOR) continue;
      const site = sites[id]!;
      if (hash01(seed, x, y, 29) > featureChance(site.role)) continue;
      world.features[idx] = featureForRole(site.role, hash01(seed, x, y, 31));
    }
  }

  for (const site of sites) {
    const center = findSiteCell(world, owner, sites, site.id);
    if (site.role === 'checkpoint') {
      setFeature(world, center.x - 4, center.y, Feature.DESK);
      setFeature(world, center.x + 4, center.y, Feature.SCREEN);
    } else if (site.role === 'triage') {
      setFeature(world, center.x - 5, center.y, Feature.BED);
      setFeature(world, center.x + 4, center.y + 3, Feature.APPARATUS);
    } else if (site.role === 'office') {
      setFeature(world, center.x, center.y, Feature.DESK);
      setFeature(world, center.x + 6, center.y, Feature.SHELF);
    }
  }
}

function placeLifts(world: World, sites: readonly Site[], owner: Int16Array): void {
  const up = findSiteCell(world, owner, sites, siteId(sites, 'northCheckpoint'));
  const down = findSiteCell(world, owner, sites, siteId(sites, 'southCheckpoint'));
  forceOpenDisc(world, owner, sites, siteId(sites, 'northCheckpoint'), up.x, up.y, 3);
  forceOpenDisc(world, owner, sites, siteId(sites, 'southCheckpoint'), down.x, down.y, 3);
  placeLift(world, up.x, up.y, up.x - 3, up.y, LiftDirection.UP);
  placeLift(world, down.x, down.y, down.x + 3, down.y, LiftDirection.DOWN);
}

function placeQuarantineEmergencyPanels(world: World, sites: readonly Site[], owner: Int16Array, seed: number): void {
  placePanelNearSite(world, sites, owner, 'northCheckpoint', 'panel_doors', seed ^ 0x751);
  placePanelNearSite(world, sites, owner, 'supplyConnector', 'panel_power', seed ^ 0x752);
  placePanelNearSite(world, sites, owner, 'infectedWard', 'panel_vent', seed ^ 0x753);
  placePanelNearSite(world, sites, owner, 'corpsePitEast', 'panel_water', seed ^ 0x754);
}

function spawnNpcs(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  sites: readonly Site[],
  owner: Int16Array,
): Record<NpcId, number> {
  return {
    voronoi_quarantine_doctor_pavel: spawnPlotNpc(world, entities, nextId, 'voronoi_quarantine_doctor_pavel', NPC_DEFS.voronoi_quarantine_doctor_pavel, sitePoint(world, owner, sites, 'cleanClinic', 14, -6), 0),
    voronoi_quarantine_clerk_zoya: spawnPlotNpc(world, entities, nextId, 'voronoi_quarantine_clerk_zoya', NPC_DEFS.voronoi_quarantine_clerk_zoya, sitePoint(world, owner, sites, 'forgeOffice', -8, 4), Math.PI),
    voronoi_quarantine_infected_lev: spawnPlotNpc(world, entities, nextId, 'voronoi_quarantine_infected_lev', NPC_DEFS.voronoi_quarantine_infected_lev, sitePoint(world, owner, sites, 'infectedWard', -10, 8), Math.PI / 2),
    voronoi_quarantine_quartermaster_marta: spawnPlotNpc(world, entities, nextId, 'voronoi_quarantine_quartermaster_marta', NPC_DEFS.voronoi_quarantine_quartermaster_marta, sitePoint(world, owner, sites, 'supplyConnector', 10, -6), -Math.PI / 2, 'makarov'),
  };
}

function placeContainers(
  world: World,
  sites: readonly Site[],
  owner: Int16Array,
  owners: Record<NpcId, number>,
): void {
  addContainer(world, roomForSite(world, sites, 'northCheckpoint'), sitePoint(world, owner, sites, 'northCheckpoint', -18, 8), ContainerKind.METAL_CABINET, 'Шкаф поста с чистыми журналами', 'faction', [
    { defId: 'gasmask_filter', count: 1 },
    { defId: 'official_quarantine_clearance', count: 1 },
    { defId: 'ammo_9mm', count: 10 },
  ], undefined, undefined, ['voronoi_quarantine', 'checkpoint', 'official_pass', 'cross_border']);

  addContainer(world, roomForSite(world, sites, 'forgeOffice'), sitePoint(world, owner, sites, 'forgeOffice', 10, 8), ContainerKind.FILING_CABINET, 'Картотека липких пропусков', 'owner', [
    { defId: 'blank_form', count: 2 },
    { defId: 'ink_bottle', count: 1 },
    { defId: 'forged_quarantine_clearance', count: 1 },
  ], owners.voronoi_quarantine_clerk_zoya, NPC_DEFS.voronoi_quarantine_clerk_zoya.name, ['voronoi_quarantine', 'forgery', 'pass', 'documents']);

  addContainer(world, roomForSite(world, sites, 'cleanClinic'), sitePoint(world, owner, sites, 'cleanClinic', -16, 10), ContainerKind.MEDICAL_CABINET, 'Шкаф чистой клиники Ллойда', 'public', [
    { defId: 'bandage', count: 2 },
    { defId: 'sterile_swab', count: 2 },
    { defId: 'pills', count: 1 },
  ], undefined, undefined, ['voronoi_quarantine', 'clinic', 'medicine']);

  addContainer(world, roomForSite(world, sites, 'supplyConnector'), sitePoint(world, owner, sites, 'supplyConnector', -12, 12), ContainerKind.EMERGENCY_BOX, 'Сухой складовой соединитель', 'locked', [
    { defId: 'decon_fluid', count: 1 },
    { defId: 'filter_receipt', count: 1 },
    { defId: 'filtered_water', count: 2 },
    { defId: 'canned', count: 2 },
  ], owners.voronoi_quarantine_quartermaster_marta, NPC_DEFS.voronoi_quarantine_quartermaster_marta.name, ['voronoi_quarantine', 'supply_connector', 'open_supply', 'decon']);

  addContainer(world, roomForSite(world, sites, 'redWard'), sitePoint(world, owner, sites, 'redWard', 8, 8), ContainerKind.MEDICAL_CABINET, 'Тумба красной палаты', 'secret', [
    { defId: 'contaminated_swab', count: 2 },
    { defId: 'quarantine_medcard', count: 1 },
    { defId: 'contaminated_gloves', count: 1 },
  ], undefined, undefined, ['voronoi_quarantine', 'infected_ward', 'contaminated', 'evidence']);
}

function placeDrops(world: World, entities: Entity[], nextId: { v: number }, sites: readonly Site[], owner: Int16Array): void {
  dropItem(world, entities, nextId, sitePoint(world, owner, sites, 'publicKitchen', -8, 6), 'bread', 1);
  dropItem(world, entities, nextId, sitePoint(world, owner, sites, 'triageHub', 12, -4), 'blank_form', 1);
  dropItem(world, entities, nextId, sitePoint(world, owner, sites, 'corpsePitWest', 8, 4), 'contaminated_swab', 1);
  dropItem(world, entities, nextId, sitePoint(world, owner, sites, 'corpsePitEast', -10, 10), 'decon_fluid', 1);
}

function spawnThreats(world: World, entities: Entity[], nextId: { v: number }, sites: readonly Site[], owner: Int16Array): void {
  spawnMonster(world, entities, nextId, MonsterKind.HEAD_SLUG, sitePoint(world, owner, sites, 'infectedWard', 12, 16), 3, 'Головной слизень жёлтого ребра');
  spawnMonster(world, entities, nextId, MonsterKind.DIKIY_MERTVYAK, sitePoint(world, owner, sites, 'redWard', -14, 18), 3, 'Мертвяк красной палаты');
  spawnMonster(world, entities, nextId, MonsterKind.CHERNOSLIZ, sitePoint(world, owner, sites, 'corpsePitEast', 10, -8), 4, 'Чернослиз трупной диаграммы');
  spawnMonster(world, entities, nextId, MonsterKind.BEZEKHIY, sitePoint(world, owner, sites, 'corpsePitWest', -10, -8), 3, 'Безэхий у санитарной стены');
}

function isVoronoiAmbientNpc(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    !entity.plotNpcId &&
    !entity.persistentNpcId &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    entity.faction !== undefined;
}

function voronoiTerritorySpawnCells(world: World): Map<TerritoryOwner, number[]> {
  const cells = new Map<TerritoryOwner, number[]>();
  for (const spec of FACTION_HQ_SPECS) cells.set(spec.owner, []);
  for (let i = 0; i < W * W; i++) {
    const cell = world.cells[i];
    if (cell !== Cell.FLOOR && cell !== Cell.WATER) continue;
    if (world.aptMask[i] || world.containerMap.has(i) || world.features[i] === Feature.LIFT_BUTTON) continue;
    const owner = world.factionControl[i] as TerritoryOwner;
    const list = cells.get(owner);
    if (list) list.push(i);
  }
  return cells;
}

export function alignVoronoiQuarantineAmbientNpcTerritory(world: World, entities: Entity[]): void {
  const cells = voronoiTerritorySpawnCells(world);
  const offsets = new Uint16Array(8);
  for (const entity of entities) {
    if (!isVoronoiAmbientNpc(entity) || entity.faction === undefined) continue;
    const owner = factionToTerritoryOwner(entity.faction);
    const list = cells.get(owner);
    if (!list || list.length === 0) continue;
    const offset = offsets[owner]++ | 0;
    const cell = list[(entity.id * 131 + offset * 467) % list.length]!;
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

function stampContamination(world: World, sites: readonly Site[], seed: number): void {
  for (const site of sites) {
    if (!site.infected) continue;
    stampSurfaceSplat(
      world,
      site.x,
      site.y,
      0.5,
      0.5,
      site.role === 'corpse_pit' ? 10 : 7,
      0.28,
      seed ^ (site.id * 0x71),
      site.role === 'corpse_pit' ? 52 : 164,
      site.role === 'corpse_pit' ? 72 : 68,
      site.role === 'corpse_pit' ? 60 : 38,
      false,
    );
  }
}

function nearestSiteId(world: World, x: number, y: number, sites: readonly Site[]): number {
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const site of sites) {
    const d2 = world.dist2(x, y, site.x, site.y);
    const score = d2 - site.weight * site.weight;
    if (score < bestScore) {
      bestScore = score;
      best = site.id;
    }
  }
  return best;
}

const ORTHO_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

function openOwnedCell(world: World, idx: number, roomId: number, site: Site, noise: number): void {
  world.cells[idx] = site.infected && site.role === 'corpse_pit' && noise > 0.74 ? Cell.WATER : Cell.FLOOR;
  world.roomMap[idx] = roomId;
  world.floorTex[idx] = world.cells[idx] === Cell.WATER ? Tex.F_WATER : site.floorTex;
  world.wallTex[idx] = site.wallTex;
  world.hermoWall[idx] = 0;
  world.factionControl[idx] = site.faction;
  world.fog[idx] = site.infected ? Math.max(world.fog[idx], site.role === 'corpse_pit' ? 58 : 34) : Math.max(2, world.fog[idx] - 3);
  world.light[idx] = site.infected ? 0.1 : site.role === 'clinic' || site.role === 'checkpoint' ? 0.32 : 0.18;
}

function recordRidgeCandidate(
  world: World,
  map: Map<string, RidgeCandidate>,
  sites: readonly Site[],
  a: number,
  b: number,
  x: number,
  y: number,
  nx: number,
  ny: number,
): void {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const key = `${lo}:${hi}`;
  const sa = sites[lo]!;
  const sb = sites[hi]!;
  const mx = world.wrap(sa.x + world.delta(sa.x, sb.x) / 2);
  const my = world.wrap(sa.y + world.delta(sa.y, sb.y) / 2);
  const score = world.dist2(x, y, mx, my) + hash01(SEED, x, y, lo + hi) * 0.01;
  const previous = map.get(key);
  if (!previous || score < previous.score) map.set(key, { a: lo, b: hi, x: world.wrap(x), y: world.wrap(y), nx: world.wrap(nx), ny: world.wrap(ny), score });
}

function sortedCandidates(map: Map<string, RidgeCandidate>): RidgeCandidate[] {
  return [...map.values()].sort((a, b) => a.score - b.score);
}

function sortedAdjacency(map: Map<string, RidgeCandidate>): [number, number][] {
  return [...map.values()]
    .map(edge => [edge.a, edge.b] as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

function spanningRidges(siteCount: number, candidates: readonly RidgeCandidate[]): RidgeCandidate[] {
  const parent = new Int16Array(siteCount);
  for (let i = 0; i < siteCount; i++) parent[i] = i;
  const out: RidgeCandidate[] = [];
  const find = (v: number): number => {
    let p = v;
    while (parent[p] !== p) p = parent[p];
    while (parent[v] !== v) {
      const n = parent[v];
      parent[v] = p;
      v = n;
    }
    return p;
  };
  for (const edge of candidates) {
    const a = find(edge.a);
    const b = find(edge.b);
    if (a === b) continue;
    parent[a] = b;
    out.push(edge);
    if (out.length >= siteCount - 1) break;
  }
  return out;
}

function ridgeGraphConnected(sites: readonly Site[], edges: readonly [number, number][]): boolean {
  const siteCount = sites.length;
  if (siteCount <= 1) return true;
  const seen = new Uint8Array(siteCount);
  const queue = [0];
  seen[0] = 1;
  for (let head = 0; head < queue.length; head++) {
    const v = queue[head]!;
    for (const [a, b] of edges) {
      const n = a === v ? b : b === v ? a : -1;
      if (n < 0 || seen[n]) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  for (let i = 0; i < seen.length; i++) {
    if (!seen[i]) {
      const hasEdges = edges.some(e => e[0] === i || e[1] === i);
      if (hasEdges) return false;
    }
  }
  return true;
}

function shouldAddExtraRidge(a: Site, b: Site): boolean {
  if (sitePairHasRole(a, b, 'supply')) return true;
  if ((a.infected || b.infected) && !(a.infected && b.infected)) return true;
  if (a.role === 'checkpoint' || b.role === 'checkpoint') return true;
  return a.role === 'kitchen' || b.role === 'kitchen';
}

function ridgeDoorState(a: Site, b: Site, serial: number): { state: DoorState; keyId: string } {
  if (sitePairHasRole(a, b, 'supply')) return { state: DoorState.LOCKED, keyId: 'official_quarantine_clearance' };
  if ((a.infected || b.infected) && !(a.infected && b.infected) && serial % 2 === 0) {
    return { state: DoorState.LOCKED, keyId: serial % 4 === 0 ? 'official_quarantine_clearance' : 'forged_quarantine_clearance' };
  }
  return { state: DoorState.CLOSED, keyId: '' };
}

function placeDoubleDoor(
  world: World,
  sites: readonly Site[],
  edge: RidgeCandidate,
  state: DoorState,
  keyId: string,
): void {
  const a = sites[edge.a]!;
  const b = sites[edge.b]!;
  setDoorCell(world, edge.x, edge.y, a.id, b.id, state, keyId);
  setDoorCell(world, edge.nx, edge.ny, b.id, a.id, state, keyId);
  const dx = Math.sign(world.delta(edge.x, edge.nx));
  const dy = Math.sign(world.delta(edge.y, edge.ny));
  forceOpenDisc(world, undefined, sites, a.id, edge.x - dx, edge.y - dy, 1);
  forceOpenDisc(world, undefined, sites, b.id, edge.nx + dx, edge.ny + dy, 1);
}

function setDoorCell(world: World, x: number, y: number, roomA: number, roomB: number, state: DoorState, keyId: string): void {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.DOOR;
  world.roomMap[idx] = roomA;
  world.hermoWall[idx] = 0;
  world.wallTex[idx] = Tex.DOOR_METAL;
  world.features[idx] = Feature.NONE;
  world.doors.set(idx, { idx, state, roomA, roomB, keyId, timer: 0 });
}

function forceOpenDisc(
  world: World,
  owner: Int16Array | undefined,
  sites: readonly Site[],
  siteIdValue: number,
  cx: number,
  cy: number,
  radius: number,
): void {
  const site = sites[siteIdValue]!;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const idx = world.idx(cx + dx, cy + dy);
      if (world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.DOOR) continue;
      if (owner) owner[idx] = siteIdValue;
      openOwnedCell(world, idx, siteIdValue, site, 0);
      world.features[idx] = Feature.NONE;
    }
  }
}

function placeLift(world: World, x: number, y: number, buttonX: number, buttonY: number, direction: LiftDirection): void {
  const li = world.idx(x, y);
  world.cells[li] = Cell.LIFT;
  world.wallTex[li] = Tex.LIFT_DOOR;
  world.liftDir[li] = direction;
  world.roomMap[li] = -1;
  const bi = world.idx(buttonX, buttonY);
  if (world.cells[bi] === Cell.FLOOR || world.cells[bi] === Cell.WATER) world.features[bi] = Feature.LIFT_BUTTON;
  world.liftDir[bi] = direction;
}

function placePanelNearSite(
  world: World,
  sites: readonly Site[],
  owner: Int16Array,
  key: keyof typeof VORONOI_QUARANTINE_ROOM_NAMES,
  panelId: 'panel_doors' | 'panel_power' | 'panel_vent' | 'panel_water',
  seed: number,
): void {
  const p = sitePoint(world, owner, sites, key, 6, 6);
  placeEmergencyPanel(world, p.x, p.y, panelId, seed);
}

function spawnPlotNpc(
  _world: World,
  entities: Entity[],
  nextId: { v: number },
  npcId: NpcId,
  _def: PlotNpcDef,
  point: { x: number; y: number },
  angle: number,
  weapon?: string,
): number {
  const px = point.x + 0.5;
  const py = point.y + 0.5;
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, npcId, px, py, {
    angle,
    weapon,
    aiTarget: { x: px, y: py },
    extra: { rpg: randomRPG(3) },
  });
  return npc.id;
}

function spawnMonster(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  kind: MonsterKind,
  point: { x: number; y: number },
  level: number,
  name?: string,
): void {
  const idx = world.idx(point.x, point.y);
  if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) return;
  const def = MONSTERS[kind];
  if (!def) return;
  const hp = Math.round(def.hp * (0.84 + level * 0.16));
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: point.x + 0.5,
    y: point.y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: def.speed * (0.95 + level * 0.035),
    sprite: monsterSpr(kind),
    name,
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: point.x, ty: point.y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
    phasing: kind === MonsterKind.SHADOW || kind === MonsterKind.SPIRIT,
  });
}

function addContainer(
  world: World,
  room: Room,
  point: { x: number; y: number },
  kind: ContainerKind,
  name: string,
  access: WorldContainer['access'],
  inventory: Item[],
  ownerNpcId: number | undefined,
  ownerName: string | undefined,
  tags: string[],
): WorldContainer {
  const container: WorldContainer = {
    id: nextContainerId(world),
    x: world.wrap(point.x),
    y: world.wrap(point.y),
    floor: VORONOI_QUARANTINE_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(point.x, point.y)],
    kind,
    name,
    inventory: inventory.map(item => ({ ...item })),
    capacitySlots: Math.max(8, inventory.length + 4),
    ownerNpcId,
    ownerName,
    faction: access === 'faction' ? Faction.LIQUIDATOR : undefined,
    access,
    lockDifficulty: access === 'locked' ? 4 : undefined,
    discovered: access !== 'secret',
    tags,
  };
  world.addContainer(container);
  setFeature(world, point.x, point.y, kind === ContainerKind.MEDICAL_CABINET ? Feature.APPARATUS : Feature.SHELF);
  return container;
}

function nextContainerId(world: World): number {
  let id = 1;
  for (const container of world.containers) id = Math.max(id, container.id + 1);
  return id;
}

function dropItem(world: World, entities: Entity[], nextId: { v: number }, point: { x: number; y: number }, defId: string, count: number): void {
  const idx = world.idx(point.x, point.y);
  if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) return;
  entities.push({
    id: nextId.v++,
    type: EntityType.ITEM_DROP,
    x: point.x + 0.5,
    y: point.y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count }],
  });
}

function sitePoint(
  world: World,
  owner: Int16Array,
  sites: readonly Site[],
  key: keyof typeof VORONOI_QUARANTINE_ROOM_NAMES,
  ox: number,
  oy: number,
): { x: number; y: number } {
  const site = sites[siteId(sites, key)]!;
  const preferred = { x: world.wrap(site.x + ox), y: world.wrap(site.y + oy) };
  const preferredIdx = world.idx(preferred.x, preferred.y);
  if ((world.cells[preferredIdx] === Cell.FLOOR || world.cells[preferredIdx] === Cell.WATER) && owner[preferredIdx] === site.id) return preferred;
  return findSiteCell(world, owner, sites, site.id);
}

function findSiteCell(world: World, owner: Int16Array, sites: readonly Site[], id: number): { x: number; y: number } {
  const site = sites[id]!;
  const sx = Math.round(site.x);
  const sy = Math.round(site.y);
  for (let r = 0; r <= 96; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = world.wrap(sx + dx);
        const y = world.wrap(sy + dy);
        const idx = world.idx(x, y);
        if (owner[idx] !== id) continue;
        if (world.cells[idx] === Cell.FLOOR || world.cells[idx] === Cell.WATER) return { x, y };
      }
    }
  }
  return { x: sx, y: sy };
}

function roomForSite(world: World, sites: readonly Site[], key: keyof typeof VORONOI_QUARANTINE_ROOM_NAMES): Room {
  return world.rooms[siteId(sites, key)]!;
}

function siteId(sites: readonly Site[], key: keyof typeof VORONOI_QUARANTINE_ROOM_NAMES): number {
  const site = sites.find(item => item.key === key);
  return site?.id ?? 0;
}

function sitePairHasRole(a: Site, b: Site, role: SiteRole): boolean {
  return a.role === role || b.role === role;
}

function samePair(a: RidgeCandidate, b: RidgeCandidate): boolean {
  return a.a === b.a && a.b === b.b;
}

function countSiteCells(owner: Int16Array, siteCount: number): number[] {
  const counts = new Array(siteCount).fill(0) as number[];
  for (const id of owner) if (id >= 0) counts[id]++;
  return counts;
}

function siteRoleByRoomName(name: string): SiteRole | undefined {
  const seed = SITE_SEEDS.find(item => item.key && VORONOI_QUARANTINE_ROOM_NAMES[item.key] === name);
  return seed?.role;
}

function featureChance(role: SiteRole): number {
  switch (role) {
    case 'checkpoint':
    case 'clinic':
    case 'supply':
      return 0.034;
    case 'kitchen':
    case 'office':
      return 0.028;
    case 'corpse_pit':
      return 0.018;
    default:
      return 0.02;
  }
}

function featureForRole(role: SiteRole, roll: number): Feature {
  switch (role) {
    case 'checkpoint':
      return roll < 0.45 ? Feature.DESK : roll < 0.72 ? Feature.SCREEN : Feature.LAMP;
    case 'clinic':
    case 'ward':
      return roll < 0.42 ? Feature.BED : roll < 0.72 ? Feature.APPARATUS : Feature.SINK;
    case 'office':
      return roll < 0.5 ? Feature.DESK : Feature.SHELF;
    case 'kitchen':
      return roll < 0.34 ? Feature.STOVE : roll < 0.68 ? Feature.SINK : Feature.TABLE;
    case 'supply':
      return roll < 0.72 ? Feature.SHELF : Feature.MACHINE;
    case 'corpse_pit':
      return roll < 0.55 ? Feature.BED : Feature.APPARATUS;
    case 'triage':
    default:
      return roll < 0.45 ? Feature.CHAIR : roll < 0.72 ? Feature.TABLE : Feature.LAMP;
  }
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const idx = world.idx(x, y);
  if (world.cells[idx] === Cell.FLOOR || world.cells[idx] === Cell.WATER) world.features[idx] = feature;
}


function hash01(seed: number, a: number, b: number, c: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(a + 0x632be5ab, 0x27d4eb2d);
  x ^= Math.imul(b + 0x85157af5, 0x165667b1);
  x ^= Math.imul(c + 0x4cf5ad43, 0xd3a2646c);
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  x = Math.imul(x, 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 0x100000000;
}

/* ── Voronoi Quarantine Mini-Game: Protocol "Clean Ridge" (Протокол «Чистое Ребро») ────── */

registerContentInteractionHook({
  id: 'voronoi_quarantine_airlock_protocol',
  target(ctx: ContentInteractionContext) {
    if (ctx.state.currentFloor !== VORONOI_QUARANTINE_BASE_FLOOR) return null;
    const lx = Math.floor(ctx.lookX);
    const ly = Math.floor(ctx.lookY);
    const idx = ctx.world.idx(lx, ly);
    const feature = ctx.world.features[idx];
    if (feature !== Feature.SCREEN && feature !== Feature.APPARATUS && feature !== Feature.MACHINE) return null;

    const roomId = ctx.world.roomMap[idx];
    const room = ctx.world.rooms[roomId];
    if (!room) return null;

    let prompt = ' Протокол Очистки Вороного';
    if (room.name.includes('пост') || room.name.includes('Канцелярия')) {
      prompt = ' Карантинный терминал: Пропуска';
    } else if (room.name.includes('палата') || room.name.includes('трупная')) {
      prompt = ' Управление гермошлюзами ячейки';
    } else if (room.name.includes('Складовой') || room.name.includes('клиника')) {
      prompt = ' УФ-дезинфекция и выдача пайка';
    }

    return {
      id: idx + 530000,
      targetId: 'voronoi_quarantine_console',
      x: lx,
      y: ly,
      priority: 65,
      prompt,
    };
  },
  use(ctx: ContentInteractionContext) {
    if (ctx.state.currentFloor !== VORONOI_QUARANTINE_BASE_FLOOR) return { handled: false };
    const lx = Math.floor(ctx.lookX);
    const ly = Math.floor(ctx.lookY);
    const idx = ctx.world.idx(lx, ly);
    const feature = ctx.world.features[idx];
    if (feature !== Feature.SCREEN && feature !== Feature.APPARATUS && feature !== Feature.MACHINE) return { handled: false };

    const roomId = ctx.world.roomMap[idx];
    const room = ctx.world.rooms[roomId];
    if (!room) return { handled: false };

    let worldChanged = false;

    if (room.name.includes('пост') || room.name.includes('Канцелярия')) {
      // Подделка/печать пропусков и выдача фильтров
      if (!ctx.player.inventory) ctx.player.inventory = [];
      const hasPass = ctx.player.inventory.some(i => i.defId === 'official_quarantine_clearance');
      if (!hasPass) {
        ctx.player.inventory.push({ defId: 'official_quarantine_clearance', count: 1 });
        ctx.state.msgs.push(msg('Терминал распечатал чистый официальный пропуск.', ctx.state.time, '#4a4'));
      } else {
        ctx.player.inventory.push({ defId: 'gasmask_filter', count: 1 });
        ctx.state.msgs.push(msg('Синтезирован аварийный фильтр для противогаза.', ctx.state.time, '#8cf'));
      }
      publishEvent(ctx.state, {
        type: 'permit_forged',
        floor: VORONOI_QUARANTINE_BASE_FLOOR,
        privacy: 'public',
        severity: 2,
        tags: [VORONOI_QUARANTINE_ROUTE_ID, 'permit', 'forgery', 'checkpoint'],
        data: { roomName: room.name, action: 'dispense_clearance' },
      });
      worldChanged = true;
    } else if (room.name.includes('палата') || room.name.includes('трупная')) {
      // Экстренная блокировка/разблокировка гермошлюзов
      let toggled = 0;
      for (const doorIdx of room.doors) {
        const door = ctx.world.doors.get(doorIdx);
        if (!door) continue;
        if (door.state === DoorState.HERMETIC_CLOSED || door.state === DoorState.CLOSED) {
          door.state = DoorState.HERMETIC_OPEN;
          toggled++;
        } else if (door.state === DoorState.HERMETIC_OPEN || door.state === DoorState.OPEN) {
          door.state = DoorState.HERMETIC_CLOSED;
          toggled++;
        }
      }
      ctx.state.msgs.push(msg(`Аварийный протокол гермошлюзов: переключено дверей (${toggled}).`, ctx.state.time, '#f84'));
      publishEvent(ctx.state, {
        type: 'emergency_panel_used',
        floor: VORONOI_QUARANTINE_BASE_FLOOR,
        privacy: 'public',
        severity: 3,
        tags: [VORONOI_QUARANTINE_ROUTE_ID, 'safeguard', 'hermetic_seal', 'quarantine'],
        data: { roomName: room.name, toggledDoors: toggled },
      });
      worldChanged = true;
    } else {
      // УФ-дезинфекция ячейки и выдача снабжения
      let purged = 0;
      for (let dy = -room.h; dy <= room.h; dy++) {
        for (let dx = -room.w; dx <= room.w; dx++) {
          const cidx = ctx.world.idx(room.x + dx, room.y + dy);
          if (ctx.world.roomMap[cidx] === room.id) {
            if (ctx.world.fog[cidx] > 2) {
              ctx.world.fog[cidx] = 2;
              purged++;
            }
          }
        }
      }
      // Урон монстрам в комнате
      let monstersHurt = 0;
      for (const entity of ctx.entities) {
        if (entity.type === EntityType.MONSTER && entity.alive && entity.assignedRoomId === room.id) {
          if (entity.hp !== undefined) {
            entity.hp = Math.max(1, entity.hp - 25);
            monstersHurt++;
          }
        }
      }
      if (!ctx.player.inventory) ctx.player.inventory = [];
      ctx.player.inventory.push({ defId: 'decon_fluid', count: 1 });
      ctx.state.msgs.push(msg(`Включена УФ-очистка: рассеян туман (${purged}), ослаблены угрозы (${monstersHurt}). Выдан деактиватор.`, ctx.state.time, '#9ed'));
      publishEvent(ctx.state, {
        type: 'emergency_panel_used',
        floor: VORONOI_QUARANTINE_BASE_FLOOR,
        privacy: 'public',
        severity: 3,
        tags: [VORONOI_QUARANTINE_ROUTE_ID, 'decon', 'purge', 'sanitation'],
        data: { roomName: room.name, purgedFog: purged, monstersHurt },
      });
      worldChanged = true;
    }

    return { handled: true, worldChanged };
  },
});

let quarantineCheckTimer = 0;

registerContentRuntimeHook({
  id: 'voronoi_quarantine_patrol_ai',
  phases: ['floor_activity'],
  update(ctx: ContentRuntimeContext) {
    if (ctx.state.currentFloor !== VORONOI_QUARANTINE_BASE_FLOOR) return false;
    quarantineCheckTimer += ctx.dt;
    if (quarantineCheckTimer < 5.0) return false;
    quarantineCheckTimer = 0;

    // Специфичное поведение на этаже Вороной-карантин:
    // Ликвидаторы патрулируют гермостены и проверяют наличие пропусков у нейтралов
    let worldChanged = false;
    for (const entity of ctx.entities) {
      if (entity.type === EntityType.NPC && entity.alive && entity.faction === Faction.LIQUIDATOR) {
        // Если ликвидатор находится рядом с загрязненной ячейкой, он периодически очищает пол вокруг себя
        const ex = Math.floor(entity.x);
        const ey = Math.floor(entity.y);
        const eidx = ctx.world.idx(ex, ey);
        if (ctx.world.fog[eidx] > 10) {
          ctx.world.fog[eidx] = Math.max(2, ctx.world.fog[eidx] - 6);
          if (ctx.world.dist2(ctx.player.x, ctx.player.y, entity.x, entity.y) < 100) {
            ctx.state.msgs.push(msg('Патруль ликвидаторов проводит локальную дегазацию сектора.', ctx.state.time, '#8cf'));
          }
          worldChanged = true;
        }
      }
    }
    return { worldChanged };
  },
});
