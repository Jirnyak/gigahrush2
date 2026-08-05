/* -- Design floor: penrose_laundry - aperiodic laundry and boiler service -- */

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
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { registerRouteCue } from '../../systems/route_cues';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { ensureConnectivity, generateZones, sanitizeDoors, stampRoom } from '../shared';
import type { FloorGeneration } from '../floor_manifest';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('penrose_laundry');

export const PENROSE_LAUNDRY_ROUTE_ID = 'penrose_laundry' as const;
export const PENROSE_LAUNDRY_Z = -8;
export const PENROSE_LAUNDRY_BASE_FLOOR = FloorLevel.LIVING;

export const PENROSE_LAUNDRY_ROOM_NAMES = {
  liftLobby: 'Лифтовая бирка прачечной П-81',
  firstSun: 'Прачечная метка Солнце П-81',
  secondSun: 'Сушильная метка Солнце П-81',
  kiteBoiler: 'Котельная метка Кайт П-81',
  steamValve: 'Паровой отвод П-81',
  lock: 'Прачечный замок П-81',
  hiddenCache: 'Скрытая умывальная кэш П-81',
  dryCache: 'Сухая кэш-складка П-81',
  deflationA: 'Карман дефляции А П-81',
  deflationB: 'Карман дефляции Б П-81',
  rinseLine: 'Ополаскиватель без периода П-81',
  drainTail: 'Хвост сливной решетки П-81',
} as const;

type PenroseLaundrySymbol = 'sun' | 'kite' | 'dart' | 'drop' | 'coil';
type PenroseLaundryMotif = 'route' | 'water' | 'heat' | 'deflation' | 'lock' | 'cache';

interface PenroseTileSpec {
  id: string;
  roomName: string;
  symbol: PenroseLaundrySymbol;
  motif: PenroseLaundryMotif;
  type: RoomType;
  x: number;
  y: number;
  w: number;
  h: number;
  wallTex: Tex;
  floorTex: Tex;
}

export interface PenroseLaundryTileRecord {
  id: string;
  roomName: string;
  roomId: number;
  symbol: PenroseLaundrySymbol;
  motif: PenroseLaundryMotif;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PenroseFullNode {
  room: Room;
  index: number;
  symbol: PenroseLaundrySymbol;
}

interface PenroseHqSpec {
  owner: ZoneFaction;
  title: string;
  x: number;
  y: number;
  strong?: boolean;
  wallTex: Tex;
  floorTex: Tex;
  supportWallTex: Tex;
  supportFloorTex: Tex;
}

export interface PenroseLaundryState {
  routeId: typeof PENROSE_LAUNDRY_ROUTE_ID;
  anchorZ: typeof PENROSE_LAUNDRY_Z;
  baseFloor: typeof PENROSE_LAUNDRY_BASE_FLOOR;
  tiles: PenroseLaundryTileRecord[];
  symbolChainRoomNames: string[];
  deflationPocketRoomNames: string[];
  lockedDoorIds: number[];
  containerIds: {
    laundryLock: number;
    steamValve: number;
    hiddenWashroomCache: number;
  };
  waterCells: number;
  steamCells: number;
  debugEntry: {
    spawnX: number;
    spawnY: number;
    summary: string;
  };
}

export interface PenroseLaundryGeneration extends FloorGeneration {
  penroseLaundryState: PenroseLaundryState;
}

const C = W >> 1;
const PHI = (1 + Math.sqrt(5)) / 2;
const GOLDEN_TURN = Math.PI * (3 - Math.sqrt(5));
const LOCK_KEY_ID = 'container_key_label';

const TILE_SPECS: readonly PenroseTileSpec[] = [
  { id: 'lift_lobby', roomName: PENROSE_LAUNDRY_ROOM_NAMES.liftLobby, symbol: 'coil', motif: 'route', type: RoomType.CORRIDOR, x: C - 34, y: C - 20, w: 22, h: 20, wallTex: Tex.LIFT_DOOR, floorTex: Tex.F_CONCRETE },
  { id: 'first_sun', roomName: PENROSE_LAUNDRY_ROOM_NAMES.firstSun, symbol: 'sun', motif: 'water', type: RoomType.PRODUCTION, x: C, y: C - 32, w: 36, h: 18, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
  { id: 'west_drop', roomName: 'Мокрая метка Капля П-81', symbol: 'drop', motif: 'water', type: RoomType.BATHROOM, x: C - 71, y: C - 23, w: 26, h: 18, wallTex: Tex.TILE_W, floorTex: Tex.F_WATER },
  { id: 'deflation_a', roomName: PENROSE_LAUNDRY_ROOM_NAMES.deflationA, symbol: 'dart', motif: 'deflation', type: RoomType.STORAGE, x: C - 22, y: C - 52, w: 16, h: 12, wallTex: Tex.PANEL, floorTex: Tex.F_LINO },
  { id: 'kite_boiler', roomName: PENROSE_LAUNDRY_ROOM_NAMES.kiteBoiler, symbol: 'kite', motif: 'heat', type: RoomType.PRODUCTION, x: C + 40, y: C - 7, w: 28, h: 22, wallTex: Tex.PIPE, floorTex: Tex.F_CONCRETE },
  { id: 'deflation_b', roomName: PENROSE_LAUNDRY_ROOM_NAMES.deflationB, symbol: 'sun', motif: 'deflation', type: RoomType.STORAGE, x: C + 48, y: C - 38, w: 14, h: 14, wallTex: Tex.PANEL, floorTex: Tex.F_LINO },
  { id: 'rinse_line', roomName: PENROSE_LAUNDRY_ROOM_NAMES.rinseLine, symbol: 'drop', motif: 'water', type: RoomType.BATHROOM, x: C + 103, y: C - 12, w: 28, h: 16, wallTex: Tex.TILE_W, floorTex: Tex.F_WATER },
  { id: 'drain_tail', roomName: PENROSE_LAUNDRY_ROOM_NAMES.drainTail, symbol: 'dart', motif: 'water', type: RoomType.STORAGE, x: C + 78, y: C - 50, w: 22, h: 14, wallTex: Tex.DARK, floorTex: Tex.F_WATER },
  { id: 'steam_valve', roomName: PENROSE_LAUNDRY_ROOM_NAMES.steamValve, symbol: 'kite', motif: 'heat', type: RoomType.PRODUCTION, x: C + 11, y: C + 23, w: 32, h: 22, wallTex: Tex.PIPE, floorTex: Tex.F_CONCRETE },
  { id: 'second_sun', roomName: PENROSE_LAUNDRY_ROOM_NAMES.secondSun, symbol: 'sun', motif: 'water', type: RoomType.PRODUCTION, x: C - 32, y: C + 44, w: 28, h: 18, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
  { id: 'laundry_lock', roomName: PENROSE_LAUNDRY_ROOM_NAMES.lock, symbol: 'coil', motif: 'lock', type: RoomType.STORAGE, x: C - 67, y: C + 23, w: 26, h: 16, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
  { id: 'hidden_cache', roomName: PENROSE_LAUNDRY_ROOM_NAMES.hiddenCache, symbol: 'sun', motif: 'cache', type: RoomType.BATHROOM, x: C - 98, y: C + 46, w: 20, h: 14, wallTex: Tex.TILE_W, floorTex: Tex.F_WATER },
  { id: 'dry_cache', roomName: PENROSE_LAUNDRY_ROOM_NAMES.dryCache, symbol: 'dart', motif: 'cache', type: RoomType.STORAGE, x: C + 78, y: C + 23, w: 18, h: 14, wallTex: Tex.PANEL, floorTex: Tex.F_LINO },
] as const;

const SYMBOL_CHAIN_IDS = ['first_sun', 'deflation_b', 'second_sun', 'hidden_cache'] as const;
const DEFLATION_IDS = ['deflation_a', 'deflation_b'] as const;
const FULL_FLOOR_NODE_COUNT = 96;
const FULL_FLOOR_NODE_RADIUS_MIN = 96;
const FULL_FLOOR_NODE_RADIUS_SPAN = 408;
const FULL_FLOOR_NODE_SYMBOLS: readonly PenroseLaundrySymbol[] = ['sun', 'kite', 'dart', 'drop', 'coil'];

const PENROSE_HQ_SPECS: readonly PenroseHqSpec[] = [
  { owner: ZoneFaction.CITIZEN, title: 'граждан', x: 110, y: 154, strong: true, wallTex: Tex.PANEL, floorTex: Tex.F_LINO, supportWallTex: Tex.PANEL, supportFloorTex: Tex.F_TILE },
  { owner: ZoneFaction.LIQUIDATOR, title: 'ликвидаторов', x: 785, y: 142, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE, supportWallTex: Tex.PIPE, supportFloorTex: Tex.F_CONCRETE },
  { owner: ZoneFaction.SCIENTIST, title: 'учёных', x: 762, y: 736, wallTex: Tex.MARBLE, floorTex: Tex.F_PARQUET, supportWallTex: Tex.TILE_W, supportFloorTex: Tex.F_TILE },
  { owner: ZoneFaction.WILD, title: 'диких', x: 132, y: 746, wallTex: Tex.DARK, floorTex: Tex.F_CONCRETE, supportWallTex: Tex.METAL, supportFloorTex: Tex.F_CONCRETE },
  { owner: ZoneFaction.CULTIST, title: 'культистов', x: 452, y: 878, wallTex: Tex.MEAT, floorTex: Tex.F_MEAT, supportWallTex: Tex.DARK, supportFloorTex: Tex.F_GREEN_CARPET },
] as const;

const NPC_IDS = {
  marfa: 'penrose_laundry_marfa_symbols',
  igor: 'penrose_laundry_igor_lock',
  lidia: 'penrose_laundry_lidia_steam',
  tonya: 'penrose_laundry_tonya_cache',
} as const;

const MARFA_DEF: PlotNpcDef = {
  name: 'Марфа Меточная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.HOUSEWIFE,
  sprite: Occupation.HOUSEWIFE,
  hp: 88, maxHp: 88, money: 24, speed: 0.78,
  inventory: [{ defId: 'chalk', count: 1 }, { defId: 'cloth_roll', count: 1 }],
  talkLines: [
    'Плитка тут не повторяется. Повторяется только знак. За Солнцем иди к Солнцу, а не прямо.',
    'Если знак совпал, не спорь с углом. Машинка знает короче, чем глаз.',
    'Кто идет по мокрому ромбу, тот выходит к сухой кэш-складке.',
  ],
  talkLinesPost: [
    'Солнца сошлись. Значит, прачечная еще помнит, где у нее изнанка.',
    'Метки лучше не стирать: без них пол снова станет просто полом.',
  ],
};

const IGOR_DEF: PlotNpcDef = {
  name: 'Игорь Прищеп',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.LOCKSMITH,
  sprite: Occupation.LOCKSMITH,
  hp: 110, maxHp: 110, money: 31, speed: 0.82,
  inventory: [{ defId: 'wrench', count: 1 }, { defId: LOCK_KEY_ID, count: 1 }],
  talkLines: [
    'Прачечный замок не открывают. Его убеждают ключом, рукояткой или плохой паузой.',
    'Бирка от ключа подходит не к двери, а к ее памяти. Этого тут хватает.',
    'Сломаешь тихо - шкаф обидится меньше, чем очередь.',
  ],
  talkLinesPost: [
    'Замок стал мягче. Не добрее, просто мягче.',
    'Теперь у двери есть версия, что она открылась сама.',
  ],
};

const LIDIA_DEF: PlotNpcDef = {
  name: 'Лидия Пароотвод',
  isFemale: true,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.MECHANIC,
  sprite: Occupation.MECHANIC,
  hp: 128, maxHp: 128, money: 40, speed: 0.84,
  inventory: [{ defId: 'valve_tag', count: 1 }, { defId: 'asbestos_cord', count: 1 }, { defId: 'boiler_water', count: 1 }],
  talkLines: [
    'Пар можно пустить в сушку, в слив или в лицо тому, кто не читает бирку.',
    'Мне нужна бирка вентиля. Тогда жар уйдет в котел, а не в коридор.',
    'Красный туман тут короткий. Длинные ожоги делает не пар, а геройство.',
  ],
  talkLinesPost: [
    'Пар ушел по ромбу. Слушай: теперь свистит не на тебя.',
    'Котел не благодарит. Это хороший признак.',
  ],
};

const TONYA_DEF: PlotNpcDef = {
  name: 'Тоня Тайник',
  isFemale: true,
  faction: Faction.WILD,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 92, maxHp: 92, money: 16, speed: 0.9,
  inventory: [{ defId: 'pressure_logbook', count: 1 }, { defId: 'filtered_water', count: 1 }],
  talkLines: [
    'Скрытая умывальная есть только когда не ищешь умывальную. Иди по двум одинаковым Солнцам.',
    'В кэше лежит мокрый журнал. Не открывай его над водой, он начнет спорить с давлением.',
    'Тайник не мой. Я просто первая поняла, что он боится сухих рук.',
  ],
  talkLinesPost: [
    'Журнал нашелся. Теперь давление хотя бы можно обвинить по фамилии.',
    'Не рассказывай очереди, где кэш. Очередь туда не влезет, но попробует.',
  ],
};

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, NPC_IDS.marfa, MARFA_DEF, [{
  id: 'penrose_laundry_follow_matching_symbols',
  giverNpcId: NPC_IDS.marfa,
  type: QuestType.VISIT,
  desc: 'Марфа Меточная: «На П-81 прямой путь врет. Идите по одинаковым Солнцам: первое у машин, второе у сушки, третье у скрытой умывальной.»',
  targetRoomName: PENROSE_LAUNDRY_ROOM_NAMES.hiddenCache,
  rewardItem: 'chalk',
  rewardCount: 1,
  extraRewards: [{ defId: 'cloth_roll', count: 2 }],
  relationDelta: 10,
  xpReward: 45,
  moneyReward: 12,
  eventTags: ['penrose_laundry', 'symbol_chain', 'hidden_cache', 'route_choice'],
  eventData: { routeId: PENROSE_LAUNDRY_ROUTE_ID, choice: 'follow_matching_symbols' },
}]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, NPC_IDS.igor, IGOR_DEF, [{
  id: 'penrose_laundry_break_lock',
  giverNpcId: NPC_IDS.igor,
  type: QuestType.FETCH,
  desc: 'Игорь Прищеп: «Гаечный ключ принесете - дам бирку. Прачечный замок любит, когда его сначала уважают железом.»',
  targetItem: 'wrench',
  targetCount: 1,
  rewardItem: LOCK_KEY_ID,
  rewardCount: 1,
  extraRewards: [{ defId: 'cleaning_kit', count: 1 }],
  relationDelta: 8,
  xpReward: 35,
  moneyReward: 18,
  eventTags: ['penrose_laundry', 'laundry_lock', 'break_lock', 'access'],
  eventData: { routeId: PENROSE_LAUNDRY_ROUTE_ID, choice: 'break_laundry_lock' },
}]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, NPC_IDS.lidia, LIDIA_DEF, [{
  id: 'penrose_laundry_divert_steam',
  giverNpcId: NPC_IDS.lidia,
  type: QuestType.FETCH,
  desc: 'Лидия Пароотвод: «Бирку вентиля сюда. Пар уйдет в сушильный карман, и П-81 перестанет варить людей у котла.»',
  targetItem: 'valve_tag',
  targetCount: 1,
  rewardItem: 'boiler_water',
  rewardCount: 2,
  extraRewards: [{ defId: 'asbestos_cord', count: 1 }],
  relationDelta: 9,
  xpReward: 40,
  moneyReward: 20,
  eventTags: ['penrose_laundry', 'steam', 'divert_steam', 'repair'],
  eventData: { routeId: PENROSE_LAUNDRY_ROUTE_ID, choice: 'divert_steam' },
}]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, NPC_IDS.tonya, TONYA_DEF, [{
  id: 'penrose_laundry_hidden_washroom_cache',
  giverNpcId: NPC_IDS.tonya,
  type: QuestType.FETCH,
  desc: 'Тоня Тайник: «Из скрытой умывальной достаньте журнал давления. Кэш любит сухую руку и ненавидит прямые маршруты.»',
  targetItem: 'pressure_logbook',
  targetCount: 1,
  rewardItem: 'filtered_water',
  rewardCount: 2,
  extraRewards: [{ defId: 'water_coupon', count: 1 }],
  relationDelta: 10,
  xpReward: 45,
  moneyReward: 14,
  eventTags: ['penrose_laundry', 'hidden_washroom_cache', 'pressure_logbook', 'cache'],
  eventData: { routeId: PENROSE_LAUNDRY_ROUTE_ID, choice: 'find_hidden_washroom_cache' },
}]);

const penroseLaundryStates = new WeakMap<World, PenroseLaundryState>();

export function getPenroseLaundryState(world: World): PenroseLaundryState | undefined {
  const state = penroseLaundryStates.get(world);
  if (!state) return undefined;
  return {
    ...state,
    tiles: state.tiles.map(tile => ({ ...tile })),
    symbolChainRoomNames: [...state.symbolChainRoomNames],
    deflationPocketRoomNames: [...state.deflationPocketRoomNames],
    lockedDoorIds: [...state.lockedDoorIds],
    containerIds: { ...state.containerIds },
    debugEntry: { ...state.debugEntry },
  };
}

export function generatePenroseLaundryDesignFloor(): PenroseLaundryGeneration {
  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 1 };

  for (let i = 0; i < W * W; i++) {
    world.wallTex[i] = Tex.PANEL;
    world.floorTex[i] = Tex.F_CONCRETE;
    world.factionControl[i] = ZoneFaction.CITIZEN;
  }

  const roomsById = new Map<string, Room>();
  const tileRecords: PenroseLaundryTileRecord[] = [];
  for (const spec of TILE_SPECS) {
    const room = stampLaundryRoom(world, spec);
    roomsById.set(spec.id, room);
    tileRecords.push({
      id: spec.id,
      roomName: room.name,
      roomId: room.id,
      symbol: spec.symbol,
      motif: spec.motif,
      x: room.x,
      y: room.y,
      w: room.w,
      h: room.h,
    });
  }

  buildPenroseFullFloor(world, roomsById);
  const lockedDoorIds: number[] = [];
  connectTilePath(world, roomsById, lockedDoorIds);
  placeLifts(world, roomById(roomsById, 'lift_lobby'));
  for (const spec of TILE_SPECS) dressTileRoom(world, roomById(roomsById, spec.id), spec);
  markSymbolCells(world, roomsById);

  generateZones(world);
  tunePenroseZones(world);

  const marfaId = spawnPlotNpc(entities, nextId, NPC_IDS.marfa, MARFA_DEF, roomById(roomsById, 'first_sun'), 4, 5, 0);
  const igorId = spawnPlotNpc(entities, nextId, NPC_IDS.igor, IGOR_DEF, roomById(roomsById, 'laundry_lock'), 4, 4, Math.PI * 0.25);
  const lidiaId = spawnPlotNpc(entities, nextId, NPC_IDS.lidia, LIDIA_DEF, roomById(roomsById, 'steam_valve'), 6, 6, Math.PI);
  const tonyaId = spawnPlotNpc(entities, nextId, NPC_IDS.tonya, TONYA_DEF, roomById(roomsById, 'second_sun'), 5, 4, Math.PI * 0.5);

  const containerIds = placePenroseContainers(world, roomsById, {
    marfaId,
    igorId,
    lidiaId,
    tonyaId,
  });
  dropPenroseSupplies(world, entities, nextId, roomsById);
  spawnPenroseThreats(world, entities, nextId, roomsById);
  registerPenroseRouteCues(world, roomsById);

  sanitizeDoors(world);
  ensureConnectivity(world, C - 23.5, C - 10.5);
  world.rebuildContainerMap();
  world.bakeLights();

  const state: PenroseLaundryState = {
    routeId: PENROSE_LAUNDRY_ROUTE_ID,
    anchorZ: PENROSE_LAUNDRY_Z,
    baseFloor: PENROSE_LAUNDRY_BASE_FLOOR,
    tiles: tileRecords,
    symbolChainRoomNames: SYMBOL_CHAIN_IDS.map(id => roomById(roomsById, id).name),
    deflationPocketRoomNames: DEFLATION_IDS.map(id => roomById(roomsById, id).name),
    lockedDoorIds,
    containerIds,
    waterCells: countCells(world, Cell.WATER),
    steamCells: countFogCells(world, 48),
    debugEntry: {
      spawnX: C - 23.5,
      spawnY: C - 10.5,
      summary: 'finite_penrose_like_patch=13 tiles, symbol_chain=sun, decisions=symbol/lock/steam/cache',
    },
  };
  penroseLaundryStates.set(world, state);

  return {
    world,
    entities,
    spawnX: state.debugEntry.spawnX,
    spawnY: state.debugEntry.spawnY,
    penroseLaundryState: state,
  };
}

export function reinforcePenroseLaundryAuthoredHqTerritory(world: World): void {
  for (const spec of PENROSE_HQ_SPECS) {
    for (const room of world.rooms) {
      if (!room.name.includes(`штаб ${spec.title}`)) continue;
      if (room.type === RoomType.HQ) {
        makePenroseHermeticCore(world, room);
        paintPenroseTerritoryPatch(world, room.x + (room.w >> 1), room.y + (room.h >> 1), spec.strong ? 48 : 36, spec.owner);
      }
      paintPenroseRoomTerritory(world, room, spec.owner);
    }
  }
  world.markWallTexDirty();
  world.markFeaturesDirty(false);
}

function buildPenroseFullFloor(world: World, roomsById: Map<string, Room>): void {
  const hqCores = buildPenroseHqCompounds(world);
  const courts = buildPenroseSteamCourts(world);
  const nodes = buildPenroseAperiodicGraph(world);
  connectPenroseFullGraph(world, roomsById, nodes, courts);
  connectPenroseHqsToGraph(world, hqCores, nodes, courts);
  carvePenroseEdgeDrains(world);
  world.markFloorTexDirty();
  world.markWallTexDirty();
  world.markFeaturesDirty(false);
  world.markFogDirty();
}

function buildPenroseAperiodicGraph(world: World): PenroseFullNode[] {
  const nodes: PenroseFullNode[] = [];
  for (let i = 0; i < FULL_FLOOR_NODE_COUNT; i++) {
    const symbol = FULL_FLOOR_NODE_SYMBOLS[(i * 3 + (i / 7 | 0)) % FULL_FLOOR_NODE_SYMBOLS.length] ?? 'sun';
    const dims = penroseNodeDimensions(symbol, i);
    const radius = FULL_FLOOR_NODE_RADIUS_MIN + Math.sqrt((i + 0.5) / FULL_FLOOR_NODE_COUNT) * FULL_FLOOR_NODE_RADIUS_SPAN;
    const angle = i * GOLDEN_TURN + Math.sin(i * PHI) * 0.17;
    const x = clamp(Math.round(C + Math.cos(angle) * radius - dims.w / 2), 38, W - dims.w - 38);
    const y = clamp(Math.round(C + Math.sin(angle) * radius - dims.h / 2), 38, W - dims.h - 38);
    const room = tryStampPenroseRoom(
      world,
      penroseNodeRoomType(symbol, i),
      x,
      y,
      dims.w,
      dims.h,
      `Прачечная Пенроуза: ромб ${String(i + 1).padStart(2, '0')} ${penroseSymbolName(symbol)}`,
      penroseNodeWallTex(symbol),
      penroseNodeFloorTex(symbol),
      penroseNodeOwner(symbol),
    );
    if (!room) continue;
    decoratePenroseNodeRoom(world, room, symbol, i);
    const node: PenroseFullNode = { room, index: i, symbol };
    nodes.push(node);
    buildPenroseStationCluster(world, node);
  }
  return nodes;
}

function buildPenroseStationCluster(world: World, node: PenroseFullNode): void {
  const n = node.room;
  const layouts: readonly { type: RoomType; label: string; dx: number; dy: number; w: number; h: number; wallTex: Tex; floorTex: Tex }[] = [
    { type: RoomType.STORAGE, label: 'сухой карман', dx: -28, dy: -24, w: 24, h: 14, wallTex: Tex.PANEL, floorTex: Tex.F_LINO },
    { type: RoomType.BATHROOM, label: 'мокрый бокс', dx: n.w + 8, dy: -20, w: 24, h: 15, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
    { type: RoomType.PRODUCTION, label: 'паровая машинка', dx: n.w + 10, dy: n.h + 8, w: 28, h: 16, wallTex: Tex.PIPE, floorTex: Tex.F_CONCRETE },
    { type: RoomType.COMMON, label: 'очередь белья', dx: -30, dy: n.h + 8, w: 26, h: 15, wallTex: Tex.PANEL, floorTex: Tex.F_CARPET },
  ];
  for (let i = 0; i < layouts.length; i++) {
    const spec = layouts[(i + node.index) % layouts.length];
    const room = tryStampPenroseRoom(
      world,
      spec.type,
      n.x + spec.dx,
      n.y + spec.dy,
      spec.w,
      spec.h,
      `Прачечная Пенроуза: станция ${String(node.index + 1).padStart(2, '0')}-${i + 1} ${spec.label}`,
      spec.wallTex,
      spec.floorTex,
      penroseNodeOwner(node.symbol),
    );
    if (!room) continue;
    decoratePenroseSupportRoom(world, room, node.index + i);
    connectRooms(world, n, room, DoorState.CLOSED, '');
    buildPenroseMicroRoom(world, node, room, i);
  }
}

function buildPenroseMicroRoom(world: World, node: PenroseFullNode, parent: Room, index: number): void {
  const ncx = node.room.x + node.room.w / 2;
  const ncy = node.room.y + node.room.h / 2;
  const pcx = parent.x + parent.w / 2;
  const pcy = parent.y + parent.h / 2;
  const horizontal = Math.abs(pcx - ncx) >= Math.abs(pcy - ncy);
  const w = parent.type === RoomType.BATHROOM ? 12 : 14;
  const h = parent.type === RoomType.BATHROOM ? 9 : 10;
  const x = horizontal
    ? (pcx < ncx ? parent.x - w - 7 : parent.x + parent.w + 7)
    : parent.x + 2;
  const y = horizontal
    ? parent.y + 2
    : (pcy < ncy ? parent.y - h - 7 : parent.y + parent.h + 7);
  const room = tryStampPenroseRoom(
    world,
    parent.type === RoomType.BATHROOM ? RoomType.BATHROOM : RoomType.STORAGE,
    Math.round(x),
    Math.round(y),
    w,
    h,
    `Прачечная Пенроуза: шкаф ${String(node.index + 1).padStart(2, '0')}-${index + 1}`,
    parent.wallTex,
    parent.floorTex,
    penroseNodeOwner(node.symbol),
  );
  if (!room) return;
  decoratePenroseSupportRoom(world, room, node.index + index + 11);
  connectRooms(world, parent, room, DoorState.CLOSED, '');
}

function buildPenroseSteamCourts(world: World): Room[] {
  const rooms: Room[] = [];
  let serial = 0;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const x = 128 + col * 236 + (row % 2) * 38;
      const y = 272 + row * 214 + ((col * 19 + row * 11) % 34);
      const type = (row + col) % 3 === 0 ? RoomType.PRODUCTION : (row + col) % 3 === 1 ? RoomType.BATHROOM : RoomType.STORAGE;
      const room = tryStampPenroseRoom(
        world,
        type,
        x,
        y,
        type === RoomType.STORAGE ? 56 : 68,
        type === RoomType.STORAGE ? 28 : 36,
        `Прачечная Пенроуза: паровой двор ${String(++serial).padStart(2, '0')}`,
        type === RoomType.BATHROOM ? Tex.TILE_W : type === RoomType.PRODUCTION ? Tex.PIPE : Tex.METAL,
        type === RoomType.BATHROOM ? Tex.F_WATER : Tex.F_CONCRETE,
        col < 2 ? ZoneFaction.CITIZEN : row === 0 ? ZoneFaction.LIQUIDATOR : row === 2 ? ZoneFaction.WILD : ZoneFaction.SCIENTIST,
      );
      if (!room) continue;
      decoratePenroseCourt(world, room, serial);
      rooms.push(room);
    }
  }
  return rooms;
}

function buildPenroseHqCompounds(world: World): Room[] {
  const cores: Room[] = [];
  for (const spec of PENROSE_HQ_SPECS) {
    const coreW = spec.strong ? 42 : 34;
    const coreH = spec.strong ? 25 : 21;
    const core = stampRequiredPenroseRoom(
      world,
      RoomType.HQ,
      spec.x,
      spec.y,
      coreW,
      coreH,
      `Прачечная Пенроуза: штаб ${spec.title}, герметичная бельевая`,
      spec.wallTex,
      spec.floorTex,
      spec.owner,
    );
    makePenroseHermeticCore(world, core);
    decoratePenroseSupportRoom(world, core, spec.owner);
    const supports: readonly [RoomType, number, number, number, number, string][] = [
      [RoomType.COMMON, -34, coreH + 20, 30, 16, 'общая очередь'],
      [RoomType.KITCHEN, 0, coreH + 25, 30, 15, 'чайная'],
      [RoomType.STORAGE, coreW + 10, coreH + 22, 31, 15, 'склад порошка'],
      [RoomType.MEDICAL, coreW + 12, -22, 30, 15, 'санпост'],
      [RoomType.OFFICE, -34, -20, 30, 14, 'дежурная'],
      [RoomType.PRODUCTION, coreW + 48, 2, 32, 16, 'мастерская'],
    ];
    const limit = spec.strong ? supports.length : 5;
    for (let i = 0; i < limit; i++) {
      const [type, dx, dy, w, h, suffix] = supports[i];
      const support = stampRequiredPenroseRoom(
        world,
        type,
        spec.x + dx,
        spec.y + dy,
        w,
        h,
        `Прачечная Пенроуза: штаб ${spec.title}, ${suffix}`,
        spec.supportWallTex,
        spec.supportFloorTex,
        spec.owner,
      );
      decoratePenroseSupportRoom(world, support, i + spec.owner * 17);
      connectRooms(world, core, support, DoorState.HERMETIC_OPEN, '');
    }
    cores.push(core);
  }
  return cores;
}

function connectPenroseFullGraph(
  world: World,
  roomsById: Map<string, Room>,
  nodes: readonly PenroseFullNode[],
  courts: readonly Room[],
): void {
  const authored = [
    'lift_lobby',
    'first_sun',
    'kite_boiler',
    'steam_valve',
    'second_sun',
    'hidden_cache',
  ].map(id => roomById(roomsById, id));
  const connected: Room[] = [...authored, ...courts];
  for (const court of courts) {
    const target = nearestRoom(world, court, authored);
    if (target) connectRooms(world, court, target, DoorState.CLOSED, '');
  }
  for (const node of nodes) {
    const target = nearestRoom(world, node.room, connected);
    if (target) connectRooms(world, node.room, target, DoorState.CLOSED, '');
    connected.push(node.room);
  }

  const angular = [...nodes].sort((a, b) => roomAngle(a.room) - roomAngle(b.room));
  for (let i = 0; i < angular.length; i += 2) {
    const a = angular[i]?.room;
    const b = angular[(i + 1) % angular.length]?.room;
    if (a && b && world.dist2(a.x + a.w / 2, a.y + a.h / 2, b.x + b.w / 2, b.y + b.h / 2) < 190 * 190) {
      connectRooms(world, a, b, DoorState.CLOSED, '');
    }
  }
}

function connectPenroseHqsToGraph(
  world: World,
  hqs: readonly Room[],
  nodes: readonly PenroseFullNode[],
  courts: readonly Room[],
): void {
  const targets = nodes.map(node => node.room).concat(courts);
  for (const hq of hqs) {
    const target = nearestRoom(world, hq, targets);
    if (target) connectRooms(world, hq, target, DoorState.HERMETIC_OPEN, '');
  }
}

function carvePenroseEdgeDrains(world: World): void {
  carvePenroseLine(world, C, C - 8, 0, C - 184, 4, Tex.F_WATER, Tex.TILE_W, ZoneFaction.CITIZEN);
  carvePenroseLine(world, C + 4, C + 8, W - 1, C + 162, 4, Tex.F_CONCRETE, Tex.PIPE, ZoneFaction.LIQUIDATOR);
  carvePenroseLine(world, C - 36, C, C - 210, 0, 3, Tex.F_LINO, Tex.PANEL, ZoneFaction.CITIZEN);
  carvePenroseLine(world, C + 42, C, C + 184, W - 1, 3, Tex.F_GREEN_CARPET, Tex.DARK, ZoneFaction.CULTIST);
}

function carvePenroseLine(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
  floorTex: Tex,
  wallTex: Tex,
  owner: ZoneFaction,
): void {
  const steps = Math.max(1, Math.max(Math.abs(bx - ax), Math.abs(by - ay)));
  const r2 = radius * radius;
  for (let step = 0; step <= steps; step++) {
    const x = Math.round(ax + (bx - ax) * step / steps);
    const y = Math.round(ay + (by - ay) * step / steps);
    for (let dy = -radius - 1; dy <= radius + 1; dy++) {
      for (let dx = -radius - 1; dx <= radius + 1; dx++) {
        const d2 = dx * dx + dy * dy;
        const idx = world.idx(x + dx, y + dy);
        if (d2 <= r2) {
          openCorridorTile(world, x + dx, y + dy, floorTex, owner, wallTex);
        } else if (world.cells[idx] === Cell.WALL && !world.aptMask[idx]) {
          world.wallTex[idx] = wallTex;
        }
      }
    }
  }
}

function tryStampPenroseRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
  owner: ZoneFaction,
): Room | null {
  const shifts: readonly [number, number][] = [[0, 0], [18, 0], [-18, 0], [0, 18], [0, -18], [24, 16], [-24, -16], [24, -16], [-24, 16], [36, 0], [-36, 0], [0, 36], [0, -36]];
  for (const [sx, sy] of shifts) {
    const px = clamp(Math.round(x + sx), 4, W - w - 5);
    const py = clamp(Math.round(y + sy), 4, W - h - 5);
    if (!canStampPenroseRoom(world, px, py, w, h)) continue;
    return stampPenroseRoom(world, type, px, py, w, h, name, wallTex, floorTex, owner);
  }
  return null;
}

function stampRequiredPenroseRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
  owner: ZoneFaction,
): Room {
  const room = tryStampPenroseRoom(world, type, x, y, w, h, name, wallTex, floorTex, owner);
  if (!room) throw new Error(`Cannot place Penrose laundry room: ${name}`);
  return room;
}

function canStampPenroseRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  if (x < 2 || y < 2 || x + w + 2 >= W || y + h + 2 >= W) return false;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const idx = world.idx(x + dx, y + dy);
      if (world.cells[idx] !== Cell.WALL || world.aptMask[idx]) return false;
    }
  }
  return true;
}

function stampPenroseRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
  owner: ZoneFaction,
): Room {
  const room = stampRoom(world, world.rooms.length, type, x, y, w, h, -1);
  room.name = name;
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) {
        world.floorTex[idx] = floorTex;
        world.factionControl[idx] = owner;
      } else {
        world.wallTex[idx] = wallTex;
      }
    }
  }
  return room;
}

function makePenroseHermeticCore(world: World, room: Room): void {
  room.type = RoomType.HQ;
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

function paintPenroseRoomTerritory(world: World, room: Room, owner: ZoneFaction): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (!world.aptMask[idx]) world.factionControl[idx] = owner;
    }
  }
  for (const doorIdx of room.doors) {
    if (!world.aptMask[doorIdx]) world.factionControl[doorIdx] = owner;
  }
}

function paintPenroseTerritoryPatch(world: World, x: number, y: number, radius: number, owner: ZoneFaction): void {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const idx = world.idx(x + dx, y + dy);
      if (!world.aptMask[idx]) world.factionControl[idx] = owner;
    }
  }
}

function decoratePenroseNodeRoom(world: World, room: Room, symbol: PenroseLaundrySymbol, index: number): void {
  decoratePenroseSupportRoom(world, room, index);
  if (symbol === 'drop') {
    for (let y = room.y + 4; y < room.y + room.h - 3; y += 4) {
      for (let x = room.x + 4; x < room.x + room.w - 4; x++) {
        if (((x + y + index) % 4) !== 0) world.cells[world.idx(x, y)] = Cell.WATER;
      }
    }
  } else if (symbol === 'kite') {
    for (let y = room.y + 3; y < room.y + room.h - 3; y += 3) {
      for (let x = room.x + 3; x < room.x + room.w - 3; x += 5) world.fog[world.idx(x, y)] = 72;
    }
  } else if (symbol === 'sun') {
    setFeature(world, room.x + (room.w >> 1), room.y + (room.h >> 1), Feature.LAMP);
  } else if (symbol === 'coil') {
    setFeature(world, room.x + (room.w >> 1), room.y + 3, Feature.SCREEN);
  }
}

function decoratePenroseCourt(world: World, room: Room, serial: number): void {
  decoratePenroseSupportRoom(world, room, serial);
  for (let y = room.y + 5; y < room.y + room.h - 4; y += 6) {
    for (let x = room.x + 5; x < room.x + room.w - 5; x += 7) {
      const idx = world.idx(x, y);
      if (room.type === RoomType.BATHROOM) {
        world.cells[idx] = Cell.WATER;
        world.floorTex[idx] = Tex.F_WATER;
      } else if (room.type === RoomType.PRODUCTION) {
        world.fog[idx] = 86;
        world.features[idx] = Feature.MACHINE;
      } else {
        world.features[idx] = Feature.SHELF;
      }
    }
  }
}

function decoratePenroseSupportRoom(world: World, room: Room, seed: number): void {
  setFeature(world, room.x + 3, room.y + 3, featureForPenroseRoom(room.type, false));
  setFeature(world, room.x + room.w - 4, room.y + room.h - 4, featureForPenroseRoom(room.type, true));
  if (room.type === RoomType.BATHROOM) {
    for (let x = room.x + 4; x < room.x + room.w - 4; x += 5) {
      const idx = world.idx(x, room.y + (room.h >> 1));
      if (world.roomMap[idx] === room.id) {
        world.cells[idx] = Cell.WATER;
        world.floorTex[idx] = Tex.F_WATER;
      }
    }
  } else if (room.type === RoomType.PRODUCTION) {
    for (let y = room.y + 4; y < room.y + room.h - 4; y += 5) {
      const idx = world.idx(room.x + (room.w >> 1), y);
      if (world.roomMap[idx] === room.id && ((y + seed) & 1) === 0) world.fog[idx] = 64;
    }
  }
}

function featureForPenroseRoom(type: RoomType, secondary: boolean): Feature {
  switch (type) {
    case RoomType.KITCHEN: return secondary ? Feature.TABLE : Feature.STOVE;
    case RoomType.BATHROOM: return secondary ? Feature.TOILET : Feature.SINK;
    case RoomType.STORAGE: return Feature.SHELF;
    case RoomType.MEDICAL: return secondary ? Feature.DESK : Feature.SINK;
    case RoomType.OFFICE: return secondary ? Feature.SCREEN : Feature.DESK;
    case RoomType.PRODUCTION: return secondary ? Feature.APPARATUS : Feature.MACHINE;
    case RoomType.HQ: return secondary ? Feature.DESK : Feature.SCREEN;
    default: return secondary ? Feature.CHAIR : Feature.TABLE;
  }
}

function penroseNodeDimensions(symbol: PenroseLaundrySymbol, index: number): { w: number; h: number } {
  switch (symbol) {
    case 'sun': return { w: 42 + (index % 3) * 4, h: 24 };
    case 'kite': return { w: 38, h: 26 };
    case 'dart': return { w: 34, h: 20 };
    case 'drop': return { w: 32, h: 22 };
    case 'coil': return { w: 36, h: 22 };
  }
}

function penroseNodeRoomType(symbol: PenroseLaundrySymbol, index: number): RoomType {
  if (symbol === 'sun' || symbol === 'kite') return RoomType.PRODUCTION;
  if (symbol === 'drop') return RoomType.BATHROOM;
  if (symbol === 'coil') return index % 2 === 0 ? RoomType.COMMON : RoomType.CORRIDOR;
  return RoomType.STORAGE;
}

function penroseNodeWallTex(symbol: PenroseLaundrySymbol): Tex {
  if (symbol === 'kite') return Tex.PIPE;
  if (symbol === 'drop') return Tex.TILE_W;
  if (symbol === 'dart') return Tex.METAL;
  if (symbol === 'coil') return Tex.PANEL;
  return Tex.TILE_W;
}

function penroseNodeFloorTex(symbol: PenroseLaundrySymbol): Tex {
  if (symbol === 'drop') return Tex.F_WATER;
  if (symbol === 'kite') return Tex.F_CONCRETE;
  if (symbol === 'dart') return Tex.F_LINO;
  if (symbol === 'coil') return Tex.F_CARPET;
  return Tex.F_TILE;
}

function penroseNodeOwner(symbol: PenroseLaundrySymbol): ZoneFaction {
  if (symbol === 'kite') return ZoneFaction.LIQUIDATOR;
  if (symbol === 'dart') return ZoneFaction.WILD;
  if (symbol === 'drop') return ZoneFaction.SCIENTIST;
  if (symbol === 'coil') return ZoneFaction.CULTIST;
  return ZoneFaction.CITIZEN;
}

function penroseSymbolName(symbol: PenroseLaundrySymbol): string {
  switch (symbol) {
    case 'sun': return 'Солнце';
    case 'kite': return 'Кайт';
    case 'dart': return 'Дарт';
    case 'drop': return 'Капля';
    case 'coil': return 'Катушка';
  }
}

function nearestRoom(world: World, source: Room, candidates: readonly Room[]): Room | null {
  let best: Room | null = null;
  let bestD2 = Infinity;
  const sx = source.x + source.w / 2;
  const sy = source.y + source.h / 2;
  for (const candidate of candidates) {
    if (!candidate || candidate.id === source.id) continue;
    const d2 = world.dist2(sx, sy, candidate.x + candidate.w / 2, candidate.y + candidate.h / 2);
    if (d2 < bestD2) {
      best = candidate;
      bestD2 = d2;
    }
  }
  return best;
}

function roomAngle(room: Room): number {
  return Math.atan2(room.y + room.h / 2 - C, room.x + room.w / 2 - C);
}

function stampLaundryRoom(world: World, spec: PenroseTileSpec): Room {
  const room = stampRoom(world, world.rooms.length, spec.type, spec.x, spec.y, spec.w, spec.h, -1);
  room.name = spec.roomName;
  room.wallTex = spec.wallTex;
  room.floorTex = spec.floorTex;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.cells[ci] === Cell.WALL) world.wallTex[ci] = spec.wallTex;
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) {
        world.floorTex[ci] = spec.floorTex;
        world.factionControl[ci] = spec.motif === 'heat' ? ZoneFaction.LIQUIDATOR : ZoneFaction.CITIZEN;
      }
    }
  }
  return room;
}

function connectTilePath(world: World, roomsById: Map<string, Room>, lockedDoorIds: number[]): void {
  const path = [
    'west_drop',
    'lift_lobby',
    'deflation_a',
    'first_sun',
    'deflation_b',
    'kite_boiler',
    'rinse_line',
    'drain_tail',
    'steam_valve',
    'second_sun',
    'laundry_lock',
    'dry_cache',
  ];
  for (let i = 1; i < path.length; i++) connectRooms(world, roomById(roomsById, path[i - 1]), roomById(roomsById, path[i]), DoorState.CLOSED, '');

  const hiddenDoors = connectRooms(
    world,
    roomById(roomsById, 'laundry_lock'),
    roomById(roomsById, 'hidden_cache'),
    DoorState.LOCKED,
    LOCK_KEY_ID,
  );
  lockedDoorIds.push(...hiddenDoors);
}

function connectRooms(world: World, a: Room, b: Room, state: DoorState, keyId: string): number[] {
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  const horizontal = Math.abs(bcx - acx) >= Math.abs(bcy - acy);
  let ax: number;
  let ay: number;
  let bx: number;
  let by: number;
  let startX: number;
  let startY: number;
  let endX: number;
  let endY: number;

  if (horizontal) {
    ay = clamp(Math.round(acy), a.y, a.y + a.h - 1);
    by = clamp(Math.round(bcy), b.y, b.y + b.h - 1);
    if (bcx >= acx) {
      ax = a.x + a.w;
      bx = b.x - 1;
      startX = ax + 1;
      endX = bx - 1;
    } else {
      ax = a.x - 1;
      bx = b.x + b.w;
      startX = ax - 1;
      endX = bx + 1;
    }
    startY = ay;
    endY = by;
  } else {
    ax = clamp(Math.round(acx), a.x, a.x + a.w - 1);
    bx = clamp(Math.round(bcx), b.x, b.x + b.w - 1);
    if (bcy >= acy) {
      ay = a.y + a.h;
      by = b.y - 1;
      startY = ay + 1;
      endY = by - 1;
    } else {
      ay = a.y - 1;
      by = b.y + b.h;
      startY = ay - 1;
      endY = by + 1;
    }
    startX = ax;
    endX = bx;
  }

  const doors = [
    addDoor(world, a, ax, ay, state, keyId),
    addDoor(world, b, bx, by, state, keyId),
  ];
  carveLaundryCorridor(world, startX, startY, endX, endY, Tex.F_LINO);
  return doors;
}

function addDoor(world: World, room: Room, x: number, y: number, state: DoorState, keyId: string): number {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.DOOR;
  world.roomMap[ci] = -1;
  world.wallTex[ci] = room.wallTex;
  world.floorTex[ci] = room.floorTex;
  world.doors.set(ci, { idx: ci, state, roomA: room.id, roomB: -1, keyId, timer: 0 });
  room.doors.push(ci);
  return ci;
}

function carveLaundryCorridor(world: World, ax: number, ay: number, bx: number, by: number, floorTex: Tex): void {
  if (ax !== bx && ay !== by) {
    const turnBias = Math.sin((ax + ay * PHI + bx * GOLDEN_TURN) * 0.07) > 0;
    if (turnBias) {
      carveLaundryCorridor(world, ax, ay, bx, ay, floorTex);
      carveLaundryCorridor(world, bx, ay, bx, by, floorTex);
    } else {
      carveLaundryCorridor(world, ax, ay, ax, by, floorTex);
      carveLaundryCorridor(world, ax, by, bx, by, floorTex);
    }
    return;
  }

  const min = ax === bx ? Math.min(ay, by) : Math.min(ax, bx);
  const max = ax === bx ? Math.max(ay, by) : Math.max(ax, bx);
  for (let p = min; p <= max; p++) {
    const x = ax === bx ? ax : p;
    const y = ax === bx ? p : ay;
    openCorridorTile(world, x, y, floorTex);
  }
}

function openCorridorTile(
  world: World,
  x: number,
  y: number,
  floorTex: Tex,
  owner = ZoneFaction.CITIZEN,
  wallTex = Tex.PANEL,
): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT || world.doors.has(ci) || world.roomMap[ci] >= 0) return;
  world.cells[ci] = Cell.FLOOR;
  world.roomMap[ci] = -1;
  world.wallTex[ci] = wallTex;
  world.floorTex[ci] = floorTex;
  world.features[ci] = Feature.NONE;
  world.factionControl[ci] = owner;
}

function placeLifts(world: World, lobby: Room): void {
  placeLift(world, lobby.x + 5, lobby.y + 4, LiftDirection.UP);
  placeLift(world, lobby.x + 5, lobby.y + lobby.h - 5, LiftDirection.DOWN);
  setFeature(world, lobby.x + 8, lobby.y + 4, Feature.LIFT_BUTTON);
  setFeature(world, lobby.x + 8, lobby.y + lobby.h - 5, Feature.LIFT_BUTTON);
  setFeature(world, lobby.x + lobby.w - 4, lobby.y + 4, Feature.SCREEN);
}

function placeLift(world: World, x: number, y: number, direction: LiftDirection): void {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.LIFT;
  world.roomMap[ci] = -1;
  world.wallTex[ci] = Tex.LIFT_DOOR;
  world.floorTex[ci] = Tex.F_CONCRETE;
  world.liftDir[ci] = direction;
}

function dressTileRoom(world: World, room: Room, spec: PenroseTileSpec): void {
  setFeature(world, room.x + Math.max(2, Math.floor(room.w / 2)), room.y + 2, Feature.SCREEN);
  if (spec.motif === 'water') dressWaterRoom(world, room);
  else if (spec.motif === 'heat') dressHeatRoom(world, room);
  else if (spec.motif === 'deflation') dressDeflationPocket(world, room);
  else if (spec.motif === 'lock') dressLockRoom(world, room);
  else if (spec.motif === 'cache') dressCacheRoom(world, room);
  else {
    setFeature(world, room.x + room.w - 4, room.y + room.h - 4, Feature.LAMP);
    setFeature(world, room.x + 3, room.y + room.h - 4, Feature.DESK);
  }
}

function dressWaterRoom(world: World, room: Room): void {
  for (let y = room.y + 3; y < room.y + room.h - 2; y += 3) {
    for (let x = room.x + 3; x < room.x + room.w - 3; x++) {
      if (((x + y + room.id) % 5) === 0) continue;
      const ci = world.idx(x, y);
      if (world.roomMap[ci] !== room.id) continue;
      world.cells[ci] = Cell.WATER;
      world.floorTex[ci] = Tex.F_WATER;
    }
  }
  for (let x = room.x + 3; x < room.x + room.w - 2; x += 7) setFeature(world, x, room.y + room.h - 3, Feature.MACHINE);
  setFeature(world, room.x + 2, room.y + 2, Feature.SINK);
  setFeature(world, room.x + room.w - 3, room.y + 2, Feature.LAMP);
}

function dressHeatRoom(world: World, room: Room): void {
  for (let y = room.y + 2; y < room.y + room.h - 2; y++) {
    for (let x = room.x + 2; x < room.x + room.w - 2; x++) {
      const ci = world.idx(x, y);
      if (world.roomMap[ci] !== room.id) continue;
      if (((x * 3 + y * 5 + room.id) & 7) === 0) world.fog[ci] = 88;
      if (((x + y) & 5) === 0) world.floorTex[ci] = Tex.F_CONCRETE;
    }
  }
  for (let x = room.x + 3; x < room.x + room.w - 3; x += 5) {
    setFeature(world, x, room.y + 3, Feature.APPARATUS);
    setFeature(world, x, room.y + room.h - 4, Feature.MACHINE);
  }
  setFeature(world, room.x + room.w - 3, room.y + Math.floor(room.h / 2), Feature.LAMP);
}

function dressDeflationPocket(world: World, room: Room): void {
  for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
    for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
      const ci = world.idx(x, y);
      if (world.roomMap[ci] !== room.id) continue;
      world.floorTex[ci] = ((x + y) & 1) === 0 ? Tex.F_LINO : Tex.F_CONCRETE;
    }
  }
  setFeature(world, room.x + 2, room.y + 2, Feature.SHELF);
  setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.LAMP);
}

function dressLockRoom(world: World, room: Room): void {
  for (let y = room.y + 2; y < room.y + room.h - 2; y += 3) {
    setFeature(world, room.x + 2, y, Feature.SHELF);
    setFeature(world, room.x + room.w - 3, y, Feature.MACHINE);
  }
  setFeature(world, room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2), Feature.APPARATUS);
}

function dressCacheRoom(world: World, room: Room): void {
  for (let x = room.x + 2; x < room.x + room.w - 2; x += 4) {
    setFeature(world, x, room.y + 2, Feature.SHELF);
  }
  setFeature(world, room.x + 2, room.y + room.h - 3, Feature.SINK);
  setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.LAMP);
}

function markSymbolCells(world: World, roomsById: Map<string, Room>): void {
  let serial = 0;
  for (const id of SYMBOL_CHAIN_IDS) {
    const room = roomById(roomsById, id);
    const x = room.x + Math.floor(room.w / 2);
    const y = room.y + Math.floor(room.h / 2);
    const ci = world.idx(x, y);
    world.features[ci] = serial % 2 === 0 ? Feature.SCREEN : Feature.APPARATUS;
    world.floorTex[ci] = Tex.F_CARPET_EDGE_BASE + ((serial * 5) & 15);
    serial++;
  }
}

function tunePenroseZones(world: World): void {
  for (const zone of world.zones) {
    const d = world.dist(zone.cx, zone.cy, C, C);
    zone.level = d < 110 ? 3 : d < 230 ? 4 : 2;
    zone.faction = d < 120 ? ZoneFaction.CITIZEN : ZoneFaction.WILD;
    if (zone.cx > C + 24 && Math.abs(zone.cy - C) < 120) zone.faction = ZoneFaction.LIQUIDATOR;
    if (zone.cy > C + 36 && zone.cx < C - 26) zone.faction = ZoneFaction.SAMOSBOR;
  }
}

function placePenroseContainers(
  world: World,
  roomsById: Map<string, Room>,
  owners: { marfaId: number; igorId: number; lidiaId: number; tonyaId: number },
): PenroseLaundryState['containerIds'] {
  const lock = addContainer(world, roomById(roomsById, 'laundry_lock'), 4, 4, ContainerKind.TOOL_LOCKER, 'Прачечный замок с чужими насечками', [
    { defId: 'cleaning_kit', count: 1 },
    { defId: 'cloth_roll', count: 2 },
    { defId: 'sealant_tube', count: 1 },
  ], 'locked', ['penrose_laundry', 'laundry_lock', 'breakable', 'decision'], owners.igorId, IGOR_DEF.name, 3);

  const steam = addContainer(world, roomById(roomsById, 'steam_valve'), 5, 4, ContainerKind.METAL_CABINET, 'Шкаф пароотвода П-81', [
    { defId: 'valve_tag', count: 1 },
    { defId: 'asbestos_cord', count: 1 },
    { defId: 'manometer', count: 1 },
  ], 'owner', ['penrose_laundry', 'steam', 'divert_steam', 'repair'], owners.lidiaId, LIDIA_DEF.name);

  addContainer(world, roomById(roomsById, 'first_sun'), 6, 5, ContainerKind.WOODEN_CHEST, 'Корзина метки Солнце', [
    { defId: 'cloth_roll', count: 2 },
    { defId: 'chalk', count: 1 },
  ], 'room', ['penrose_laundry', 'symbol_chain', 'laundry']);

  addContainer(world, roomById(roomsById, 'dry_cache'), 3, 4, ContainerKind.FILING_CABINET, 'Сухая складка ведомостей П-81', [
    { defId: 'water_coupon', count: 2 },
    { defId: 'filter_receipt', count: 1 },
    { defId: 'sealed_complaint', count: 1 },
  ], 'room', ['penrose_laundry', 'dry_cache', 'papers']);

  const hidden = addContainer(world, roomById(roomsById, 'hidden_cache'), 3, 3, ContainerKind.SECRET_STASH, 'Скрытый умывальный кэш П-81', [
    { defId: 'pressure_logbook', count: 1 },
    { defId: 'filtered_water', count: 2 },
    { defId: 'gasmask_filter', count: 1 },
    { defId: LOCK_KEY_ID, count: 1 },
  ], 'secret', ['penrose_laundry', 'hidden_washroom_cache', 'cache', 'symbol_chain'], owners.tonyaId, TONYA_DEF.name, 4);

  return {
    laundryLock: lock.id,
    steamValve: steam.id,
    hiddenWashroomCache: hidden.id,
  };
}

function addContainer(
  world: World,
  room: Room,
  dx: number,
  dy: number,
  kind: ContainerKind,
  name: string,
  inventory: Item[],
  access: WorldContainer['access'],
  tags: string[],
  ownerNpcId?: number,
  ownerName?: string,
  lockDifficulty?: number,
): WorldContainer {
  const x = room.x + dx;
  const y = room.y + dy;
  const container: WorldContainer = {
    id: nextContainerId(world),
    x,
    y,
    floor: PENROSE_LAUNDRY_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind,
    name,
    inventory: inventory.map(item => ({ ...item })),
    capacitySlots: Math.max(8, inventory.length + 4),
    ownerNpcId,
    ownerName,
    faction: ownerNpcId === undefined ? Faction.CITIZEN : undefined,
    access,
    lockDifficulty,
    discovered: access !== 'secret',
    tags,
  };
  world.addContainer(container);
  setFeature(world, x, y, kind === ContainerKind.SECRET_STASH ? Feature.SHELF : Feature.MACHINE);
  return container;
}

function dropPenroseSupplies(world: World, entities: Entity[], nextId: { v: number }, roomsById: Map<string, Room>): void {
  placeDrop(world, entities, nextId, roomById(roomsById, 'west_drop'), 4, 5, 'toiletpaper', 1);
  placeDrop(world, entities, nextId, roomById(roomsById, 'deflation_a'), 3, 3, 'chalk', 1);
  placeDrop(world, entities, nextId, roomById(roomsById, 'kite_boiler'), 4, 7, 'boiler_water', 1);
  placeDrop(world, entities, nextId, roomById(roomsById, 'drain_tail'), 4, 4, 'valve_tag', 1);
  placeDrop(world, entities, nextId, roomById(roomsById, 'second_sun'), 4, 5, 'cloth_roll', 1);
}

function spawnPenroseThreats(world: World, entities: Entity[], nextId: { v: number }, roomsById: Map<string, Room>): void {
  spawnMonster(entities, nextId, MonsterKind.TUBE_EEL, roomById(roomsById, 'rinse_line'), 10, 7);
  spawnMonster(entities, nextId, MonsterKind.VODYANOY_KOSHMAR, roomById(roomsById, 'drain_tail'), 8, 7);
  spawnMonster(entities, nextId, MonsterKind.KRYSNOZHKA, roomById(roomsById, 'laundry_lock'), 18, 10);
  spawnMonster(entities, nextId, MonsterKind.POLZUN, roomById(roomsById, 'hidden_cache'), 12, 8);
  for (const room of [roomById(roomsById, 'rinse_line'), roomById(roomsById, 'steam_valve')]) {
    const ci = world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2));
    if (world.cells[ci] === Cell.FLOOR) world.fog[ci] = Math.max(world.fog[ci], 110);
  }
}

function registerPenroseRouteCues(world: World, roomsById: Map<string, Room>): void {
  const first = roomById(roomsById, 'first_sun');
  const hidden = roomById(roomsById, 'hidden_cache');
  registerRouteCue(world, {
    id: 'penrose_laundry_symbol_chain',
    x: first.x + first.w / 2,
    y: first.y + first.h / 2,
    targetX: hidden.x + hidden.w / 2,
    targetY: hidden.y + hidden.h / 2,
    floor: PENROSE_LAUNDRY_BASE_FLOOR,
    roomId: first.id,
    targetRoomId: hidden.id,
    zoneId: world.zoneMap[world.idx(first.x + Math.floor(first.w / 2), first.y + Math.floor(first.h / 2))],
    label: 'одинаковые Солнца',
    hint: 'повторяющийся символ ведет к скрытой умывальной',
    targetName: PENROSE_LAUNDRY_ROOM_NAMES.hiddenCache,
    color: '#9ef',
    tags: ['penrose_laundry', 'symbol_chain', 'hidden_washroom_cache'],
    toneSeed: 81081,
    radius: 8,
    targetRadius: 4,
    cooldownSec: 36,
    heardText: 'Мокрые метки П-81 повторяют Солнце. Одинаковые знаки ведут не по прямой, а к скрытой умывальной.',
    followedText: 'Цепочка Солнц сошлась к скрытой умывальной П-81.',
    ignoredText: 'Солнце на плитке осталось за спиной. Прачечная снова стала просто шумной.',
  });
}

function spawnPlotNpc(
  entities: Entity[],
  nextId: { v: number },
  npcId: string,
  _def: PlotNpcDef,
  room: Room,
  dx: number,
  dy: number,
  angle: number,
): number {
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, npcId, room.x + dx + 0.5, room.y + dy + 0.5, {
    angle,
  });
  return npc.id;
}

function spawnMonster(entities: Entity[], nextId: { v: number }, kind: MonsterKind, room: Room, dx: number, dy: number): void {
  const def = MONSTERS[kind];
  if (!def) return;
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: room.x + Math.min(room.w - 2, dx) + 0.5,
    y: room.y + Math.min(room.h - 2, dy) + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: def.speed * 0.9,
    sprite: monsterSpr(kind),
    hp: Math.max(1, Math.round(def.hp * 0.85)),
    maxHp: Math.max(1, Math.round(def.hp * 0.85)),
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    monsterKind: kind,
  });
}

function placeDrop(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  room: Room,
  dx: number,
  dy: number,
  defId: string,
  count: number,
): void {
  const x = room.x + dx;
  const y = room.y + dy;
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

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) return;
  world.features[ci] = feature;
}

function nextContainerId(world: World): number {
  let id = 1;
  for (const container of world.containers) id = Math.max(id, container.id + 1);
  return id;
}

function roomById(roomsById: Map<string, Room>, id: string): Room {
  const room = roomsById.get(id);
  if (!room) throw new Error(`Missing penrose laundry room: ${id}`);
  return room;
}

function countCells(world: World, cell: Cell): number {
  let count = 0;
  for (const value of world.cells) if (value === cell) count++;
  return count;
}

function countFogCells(world: World, min: number): number {
  let count = 0;
  for (const value of world.fog) if (value >= min) count++;
  return count;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
