/* -- Design floor: Оранжерея бетона ------------------------------
 * A food-and-water route floor where crop beds, spores and valves
 * make scarcity visible without a runtime growth simulation.
 */

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
  type Entity,
  type Item,
  type Room,
  type TerritoryOwner,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { hashSeed, withSeededRandom } from '../../core/rand';
import { ITEMS } from '../../data/catalog';
import { factionToTerritoryOwner } from '../../data/factions';
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { randomRPG } from '../../systems/rpg';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import {
  carveCorridor,
  ensureConnectivity,
  generateZones,
  roomExit,
  sanitizeDoors,
  stampRoom,
} from '../shared';
import type { FloorGeneration } from '../floor_manifest';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('oranzhereya_betona');

export const ORANZHEREYA_BETONA_ROUTE_ID = 'oranzhereya_betona' as const;
export const ORANZHEREYA_BETONA_Z = -2 as const;
export const ORANZHEREYA_BETONA_BASE_FLOOR = FloorLevel.LIVING;
export const ORANZHEREYA_BETONA_DISPLAY_NAME = 'Оранжерея бетона';

export const ORANZHEREYA_ROOM_NAMES = {
  entry: 'Лифтовая теплица О-8',
  gallery: 'Галерея бетонных гряд О-8',
  pump: 'Насосная капельного полива О-8',
  northRows: 'Северные грядки пайковой зелени',
  southRows: 'Южные стеллажи грибной пайки',
  waterBasin: 'Бассейн питательного раствора',
  burnTrench: 'Прожиговая канава спор',
  mushroomWard: 'Сырой грибной карман',
  seedVault: 'Семенная кладовая жильцов',
  marketStall: 'Рыночная форточка Оранжереи',
  guardPost: 'Пост водяной нормы',
  compost: 'Компостная долговая яма',
} as const;

export const ORANZHEREYA_HQ_ROOM_NAMES = {
  citizen: 'Штаб пайковой очереди Оранжереи',
  liquidator: 'Гермопост водяной нормы',
  cultist: 'Скрытый спорохрам компоста',
  scientist: 'НИИ семенного контроля Оранжереи',
  wild: 'Дикая форточка испорченной пайки',
  citizenNorth: 'Северный пост пайковой очереди',
  citizenSouth: 'Южный пост чистой зелени',
} as const;

export const ORANZHEREYA_MICRO_ROOM_PREFIXES = [
  'Микросклад семенных кассет',
  'Переход водяной бирки',
  'Кладовая сухой тары',
  'Будка чистки фильтра',
  'Кабина спорного стеллажа',
] as const;

const SEED = hashSeed(ORANZHEREYA_BETONA_ROUTE_ID);
const CONTENT_TAG = 'oranzhereya_betona';
const CX = W >> 1;
const CY = W >> 1;

type NextId = { v: number };
type GreenhouseNpcId =
  | 'oranzhereya_agronom_nadya'
  | 'oranzhereya_irrigator_gleb'
  | 'oranzhereya_guard_arsen'
  | 'oranzhereya_market_sonya';

interface GreenhouseRooms {
  entry: Room;
  gallery: Room;
  pump: Room;
  northRows: Room;
  southRows: Room;
  waterBasin: Room;
  burnTrench: Room;
  mushroomWard: Room;
  seedVault: Room;
  marketStall: Room;
  guardPost: Room;
  compost: Room;
}

interface GreenhouseBlockSpec {
  name: string;
  x: number;
  y: number;
  owner: TerritoryOwner;
  wallTex: Tex;
  floorTex: Tex;
}

interface HqSupportSpec {
  type: RoomType;
  dx: number;
  dy: number;
  w: number;
  h: number;
  name: string;
  wallTex: Tex;
  floorTex: Tex;
  feature: Feature;
}

interface HqSpec {
  owner: TerritoryOwner;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  wallTex: Tex;
  floorTex: Tex;
  supports: readonly HqSupportSpec[];
}

export interface OranzhereyaBetonaMetrics {
  cropCells: number;
  waterCells: number;
  basinContainers: number;
  publicHarvestContainers: number;
  sabotageContainers: number;
}

const BLOCK_ROOM_W = 14;
const BLOCK_ROOM_H = 8;
const BLOCK_COLS = 6;
const BLOCK_ROWS = 5;
const BLOCK_GAP_X = 9;
const BLOCK_GAP_Y = 8;

const GREENHOUSE_BLOCKS: readonly GreenhouseBlockSpec[] = [
  { name: 'Северо-западный пайковый блок', x: 92, y: 70, owner: ZoneFaction.CITIZEN, wallTex: Tex.PANEL, floorTex: Tex.F_GREEN_CARPET },
  { name: 'Северная лабораторная гряда', x: 314, y: 74, owner: ZoneFaction.SCIENTIST, wallTex: Tex.TILE_W, floorTex: Tex.F_GREEN_CARPET },
  { name: 'Северо-восточный водяной стеллаж', x: 592, y: 72, owner: ZoneFaction.SCIENTIST, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
  { name: 'Восточные грибные кассеты', x: 798, y: 308, owner: ZoneFaction.WILD, wallTex: Tex.ROTTEN, floorTex: Tex.F_GREEN_CARPET },
  { name: 'Юго-восточный споровый склад', x: 704, y: 742, owner: ZoneFaction.WILD, wallTex: Tex.BRICK, floorTex: Tex.F_LINO },
  { name: 'Южный пайковый парник', x: 432, y: 824, owner: ZoneFaction.CITIZEN, wallTex: Tex.PANEL, floorTex: Tex.F_GREEN_CARPET },
  { name: 'Юго-западные компостные кассеты', x: 118, y: 742, owner: ZoneFaction.CULTIST, wallTex: Tex.ROTTEN, floorTex: Tex.F_CONCRETE },
  { name: 'Западный прожиговый ряд', x: 72, y: 324, owner: ZoneFaction.LIQUIDATOR, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
];

const HQ_SUPPORTS: readonly HqSupportSpec[] = [
  { type: RoomType.KITCHEN, dx: -42, dy: 4, w: 30, h: 16, name: 'кухня сухой пайки', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE, feature: Feature.STOVE },
  { type: RoomType.BATHROOM, dx: 78, dy: 4, w: 24, h: 14, name: 'санузел фильтров', wallTex: Tex.TILE_W, floorTex: Tex.F_WATER, feature: Feature.SINK },
  { type: RoomType.STORAGE, dx: 8, dy: -24, w: 34, h: 16, name: 'кладовая тары', wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE, feature: Feature.SHELF },
  { type: RoomType.MEDICAL, dx: 12, dy: 42, w: 32, h: 16, name: 'медпункт спор', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE, feature: Feature.APPARATUS },
];

const ORANZHEREYA_HQ_SPECS: readonly HqSpec[] = [
  {
    owner: ZoneFaction.CITIZEN,
    name: ORANZHEREYA_HQ_ROOM_NAMES.citizen,
    x: 432,
    y: 646,
    w: 82,
    h: 38,
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_LINO,
    supports: HQ_SUPPORTS,
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    name: ORANZHEREYA_HQ_ROOM_NAMES.liquidator,
    x: 738,
    y: 244,
    w: 70,
    h: 34,
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_CONCRETE,
    supports: HQ_SUPPORTS,
  },
  {
    owner: ZoneFaction.CULTIST,
    name: ORANZHEREYA_HQ_ROOM_NAMES.cultist,
    x: 74,
    y: 584,
    w: 58,
    h: 30,
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_GREEN_CARPET,
    supports: HQ_SUPPORTS,
  },
  {
    owner: ZoneFaction.SCIENTIST,
    name: ORANZHEREYA_HQ_ROOM_NAMES.scientist,
    x: 820,
    y: 94,
    w: 66,
    h: 34,
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_TILE,
    supports: HQ_SUPPORTS,
  },
  {
    owner: ZoneFaction.WILD,
    name: ORANZHEREYA_HQ_ROOM_NAMES.wild,
    x: 816,
    y: 766,
    w: 64,
    h: 32,
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_LINO,
    supports: HQ_SUPPORTS,
  },
];

const NPC_DEFS: Record<GreenhouseNpcId, PlotNpcDef> = {
  oranzhereya_agronom_nadya: {
    name: 'Надя Агроном',
    isFemale: true,
    faction: Faction.SCIENTIST,
    occupation: Occupation.SCIENTIST,
    sprite: Occupation.SCIENTIST,
    hp: 125,
    maxHp: 125,
    money: 88,
    speed: 0.86,
    inventory: [
      { defId: 'spore_print', count: 1 },
      { defId: 'substrate_sack', count: 1 },
      { defId: 'filtered_water', count: 1 },
    ],
    talkLines: [
      'Оранжерея не выращивает чудо. Она выращивает очередь, чтобы очередь не съела себя.',
      'Если споры уйдут в капельный полив, хлеб станет слухом. Нужна соль, чистая тара и холодная голова.',
      'Рынок хочет заражённый урожай. Жильцы хотят живой. Дом хочет, чтобы мы спорили у грядки.',
    ],
    talkLinesPost: [
      'Грядки дышат ровнее. Это ещё не урожай, но уже не паника.',
      'Соль помогла. Главное теперь не продать чистый ряд под видом редкости.',
    ],
  },
  oranzhereya_irrigator_gleb: {
    name: 'Глеб Капельник',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.ELECTRICIAN,
    sprite: Occupation.ELECTRICIAN,
    hp: 115,
    maxHp: 115,
    money: 42,
    speed: 0.9,
    inventory: [
      { defId: 'valve_tag', count: 1 },
      { defId: 'pipe', count: 1 },
      { defId: 'water_coupon', count: 1 },
    ],
    talkLines: [
      'Вода идёт по графику, а график по рукам. Переставишь бирку вентиля - решишь, кто пьёт первым.',
      'Труба течёт в компост. Можно закрыть, можно пустить на чистые грядки, можно продать рыноковой форточке.',
      'Я не сантехник. Сантехники просят деньги. Я прошу, чтобы никто не умер у крана.',
    ],
    talkLinesPost: [
      'Капля пошла в нужную сторону. Очередь всё равно будет, но уже без ножей у насоса.',
      'Бирка на месте. Кто захочет спорить, пусть спорит с давлением.',
    ],
  },
  oranzhereya_guard_arsen: {
    name: 'Арсен Водомер',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 175,
    maxHp: 175,
    money: 76,
    speed: 0.96,
    weapon: 'makarov',
    inventory: [
      { defId: 'makarov', count: 1 },
      { defId: 'ammo_9mm', count: 12 },
      { defId: 'filter_layer', count: 1 },
    ],
    talkLines: [
      'Водомер не охраняет еду. Водомер охраняет момент, когда еда становится поводом.',
      'Если полезете в пайковую кладовую без слова, я запишу вас как потерю воды.',
      'Сжечь заражённый ряд можно. Только не сжигайте весь этаж ради красивого дыма.',
    ],
    talkLinesPost: [
      'Пламя прошло по канаве, не по людям. Редкий случай, когда инструкция похожа на правду.',
      'Пост стоит. Теперь воруют тише, а это уже почти порядок.',
    ],
  },
  oranzhereya_market_sonya: {
    name: 'Соня Форточка',
    isFemale: true,
    faction: Faction.WILD,
    occupation: Occupation.STOREKEEPER,
    sprite: Occupation.STOREKEEPER,
    hp: 110,
    maxHp: 110,
    money: 155,
    speed: 0.88,
    inventory: [
      { defId: 'infected_mushroom', count: 2 },
      { defId: 'forged_ration_card', count: 1 },
      { defId: 'acid_bottle', count: 1 },
    ],
    talkLines: [
      'Чистая еда скучная. Заражённая еда редкая. Редкость дороже скуки.',
      'Кислота в басейн - и урожай уйдёт в рынок не как пайка, а как товар для смелых.',
      'Я не травлю жильцов. Я предлагаю им выбор, который они всё равно сделают в темноте.',
    ],
    talkLinesPost: [
      'Форточка помнит, кто умеет портить аккуратно.',
      'Если вдруг стало слишком чисто, приходите. Я испорчу цену, не урожай.',
    ],
  },
};

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'oranzhereya_agronom_nadya', NPC_DEFS.oranzhereya_agronom_nadya, [{
  id: 'oranzhereya_save_clean_crop',
  giverNpcId: 'oranzhereya_agronom_nadya',
  type: QuestType.FETCH,
  desc: 'Надя Агроном: «Принеси каменную соль. Споры надо остановить у грядки, пока рынок не назвал их деликатесом.»',
  targetItem: 'rock_salt',
  targetCount: 1,
  rewardItem: 'mushroom_mass',
  rewardCount: 3,
  extraRewards: [{ defId: 'filtered_water', count: 1 }, { defId: 'water_coupon', count: 1 }],
  relationDelta: 12,
  xpReward: 70,
  moneyReward: 36,
  eventTags: [CONTENT_TAG, 'crop_saved', 'food', 'water', 'fungus'],
  eventPrivacy: 'local',
  eventSeverity: 3,
}]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'oranzhereya_irrigator_gleb', NPC_DEFS.oranzhereya_irrigator_gleb, [{
  id: 'oranzhereya_reroute_water',
  giverNpcId: 'oranzhereya_irrigator_gleb',
  type: QuestType.FETCH,
  desc: 'Глеб Капельник: «Найди бирку вентиля. Без неё вода течёт в компост, а люди считают друг друга ведрами.»',
  targetItem: 'valve_tag',
  targetCount: 1,
  rewardItem: 'filtered_water',
  rewardCount: 2,
  extraRewards: [{ defId: 'pipe', count: 1 }],
  relationDelta: 10,
  xpReward: 65,
  moneyReward: 30,
  eventTags: [CONTENT_TAG, 'water', 'reroute', 'valve', 'living_scarcity'],
  eventPrivacy: 'local',
  eventSeverity: 3,
}]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'oranzhereya_guard_arsen', NPC_DEFS.oranzhereya_guard_arsen, [{
  id: 'oranzhereya_burn_infestation',
  giverNpcId: 'oranzhereya_guard_arsen',
  type: QuestType.KILL,
  desc: 'Арсен Водомер: «В прожиговой канаве проснулся борщевик. Сожги или пристрели корень, пока он не научил пайку кусаться.»',
  targetMonsterKind: MonsterKind.BORSHCHEVIK,
  killNeeded: 1,
  rewardItem: 'filter_layer',
  rewardCount: 2,
  extraRewards: [{ defId: 'ammo_fuel', count: 1 }, { defId: 'ammo_9mm', count: 8 }],
  relationDelta: 8,
  xpReward: 110,
  moneyReward: 55,
  eventTags: [CONTENT_TAG, 'burn_infestation', 'liquidator', 'fire', 'crop_defense'],
  eventPrivacy: 'witnessed',
  eventSeverity: 4,
}]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'oranzhereya_market_sonya', NPC_DEFS.oranzhereya_market_sonya, [{
  id: 'oranzhereya_poison_market_crop',
  giverNpcId: 'oranzhereya_market_sonya',
  type: QuestType.FETCH,
  desc: 'Соня Форточка: «Кислоту в питательный басейн. Чистая пайка кормит соседей, испорченная платит сразу.»',
  targetItem: 'acid_bottle',
  targetCount: 1,
  rewardItem: 'forged_ration_card',
  rewardCount: 1,
  extraRewards: [{ defId: 'infected_mushroom', count: 3 }],
  relationDelta: -6,
  xpReward: 55,
  moneyReward: 95,
  eventTags: [CONTENT_TAG, 'poison_crop', 'black_market_88', 'sabotage', 'food'],
  eventPrivacy: 'secret',
  eventSeverity: 4,
}]);

export function generateOranzhereyaBetonaDesignFloor(seed = SEED): FloorGeneration {
  return withSeededRandom(seed, () => {
    const world = new World();
    const entities: Entity[] = [];
    const nextId = { v: 1 };

    initWorld(world);
    const rooms = buildRooms(world);
    connectRooms(world, rooms);
    decorateRooms(world, rooms);
    placeLifts(world, rooms.entry);
    generateZones(world);
    tuneOranzhereyaBetonaRouteZones(world);

    const owners = spawnNpcs(entities, nextId, rooms);
    placeContainers(world, rooms, owners);
    placeDrops(world, entities, nextId, rooms);
    spawnThreats(world, entities, nextId, rooms);

    sanitizeDoors(world);
    ensureConnectivity(world, rooms.entry.x + 10.5, rooms.entry.y + 14.5);
    world.rebuildContainerMap();
    world.bakeLights();

    return {
      world,
      entities,
      spawnX: rooms.entry.x + 10.5,
      spawnY: rooms.entry.y + 14.5,
    };
  });
}

export function tuneOranzhereyaBetonaRouteZones(world: World): void {
  for (const zone of world.zones) {
    const d = world.dist(zone.cx, zone.cy, CX, CY);
    const marketSide = zone.cx > CX + 130 && zone.cy > CY - 40;
    const wetSide = zone.cx > CX + 70 && zone.cy < CY - 40;
    const cropCore = d < 190;
    const sporeEdge = zone.cx < CX - 150 || zone.cy > CY + 160;

    zone.faction = marketSide ? ZoneFaction.WILD
      : wetSide ? ZoneFaction.LIQUIDATOR
        : cropCore ? ZoneFaction.CITIZEN
          : sporeEdge ? ZoneFaction.SAMOSBOR
            : ZoneFaction.CITIZEN;
    zone.level = Math.max(zone.level, sporeEdge ? 4 : marketSide ? 3 : cropCore ? 2 : 3);
    zone.fogged = sporeEdge && (zone.id % 3 === 0);
  }

  for (let i = 0; i < W * W; i++) {
    const zone = world.zones[world.zoneMap[i]];
    world.factionControl[i] = zone?.faction ?? ZoneFaction.CITIZEN;
    if (zone?.fogged) world.fog[i] = Math.max(world.fog[i], 12);
  }
  world.markFogDirty();
}

export function measureOranzhereyaBetonaGeometry(world: World): OranzhereyaBetonaMetrics {
  const cropRoomNames = new Set<string>([
    ORANZHEREYA_ROOM_NAMES.northRows,
    ORANZHEREYA_ROOM_NAMES.southRows,
    ORANZHEREYA_ROOM_NAMES.mushroomWard,
  ]);
  const cropRoomIds = new Set(world.rooms
    .filter(room => cropRoomNames.has(room.name))
    .map(room => room.id));
  let cropCells = 0;
  let waterCells = 0;
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.WATER) waterCells++;
    if (cropRoomIds.has(world.roomMap[i]) && world.floorTex[i] === Tex.F_GREEN_CARPET) cropCells++;
  }
  return {
    cropCells,
    waterCells,
    basinContainers: world.containers.filter(c => c.tags.includes('nutrient_basin')).length,
    publicHarvestContainers: world.containers.filter(c => c.tags.includes('harvest') && c.access === 'public').length,
    sabotageContainers: world.containers.filter(c => c.tags.includes('sabotage_drop')).length,
  };
}

export function expandOranzhereyaBetonaRouteGeometry(world: World, rng: () => number = Math.random): void {
  const anchors: Room[] = [];
  for (const spec of ORANZHEREYA_HQ_SPECS) {
    const hq = addHqCompound(world, spec);
    if (hq) anchors.push(hq);
  }
  anchors.push(...addCitizenOutposts(world));

  const hubs: Room[] = [];
  for (const spec of GREENHOUSE_BLOCKS) {
    const hub = addGreenhouseBlock(world, spec, rng);
    if (hub) hubs.push(hub);
  }

  carveMacroIrrigation(world, rng);
  connectExpansionRooms(world, [...anchors, ...hubs]);
  fillOranzhereyaVoids(world, rng, [...anchors, ...hubs]);
  reinforceOranzhereyaBetonaAuthoredTerritory(world);
  world.markFloorTexDirty();
  world.markWallTexDirty();
  world.markFeaturesDirty(false);
}

export function reinforceOranzhereyaBetonaAuthoredTerritory(world: World): void {
  for (const spec of ORANZHEREYA_HQ_SPECS) {
    const hq = world.rooms.find(room => room.name === spec.name);
    if (hq) {
      hardenAuthoredHq(world, hq, spec.owner);
      paintRoomTerritory(world, hq, spec.owner);
    }
    for (const support of spec.supports) {
      const room = world.rooms.find(candidate => candidate.name === hqSupportName(spec, support));
      if (room) paintRoomTerritory(world, room, spec.owner);
    }
  }

  for (const [name, owner] of [
    [ORANZHEREYA_HQ_ROOM_NAMES.citizenNorth, ZoneFaction.CITIZEN],
    [ORANZHEREYA_HQ_ROOM_NAMES.citizenSouth, ZoneFaction.CITIZEN],
    [ORANZHEREYA_ROOM_NAMES.guardPost, ZoneFaction.LIQUIDATOR],
    [ORANZHEREYA_ROOM_NAMES.seedVault, ZoneFaction.SCIENTIST],
    [ORANZHEREYA_ROOM_NAMES.marketStall, ZoneFaction.WILD],
    [ORANZHEREYA_ROOM_NAMES.compost, ZoneFaction.CULTIST],
  ] as const) {
    const room = world.rooms.find(candidate => candidate.name === name);
    if (!room) continue;
    if (
      name === ORANZHEREYA_ROOM_NAMES.guardPost ||
      name === ORANZHEREYA_HQ_ROOM_NAMES.citizenNorth ||
      name === ORANZHEREYA_HQ_ROOM_NAMES.citizenSouth
    ) hardenAuthoredHq(world, room, owner);
    paintRoomTerritory(world, room, owner);
  }

  for (const room of world.rooms) {
    if (!room?.name) continue;
    const block = GREENHOUSE_BLOCKS.find(spec => room.name.startsWith(spec.name));
    if (block) paintRoomTerritory(world, room, block.owner);
  }
  world.markWallTexDirty();
  world.markFeaturesDirty(false);
}

export function alignOranzhereyaBetonaAmbientNpcTerritory(world: World, entities: Entity[]): void {
  const cells = oranzhereyaTerritorySpawnCells(world);
  const offsets = new Uint16Array(8);
  for (const entity of entities) {
    if (!isOranzhereyaAmbientNpc(entity) || entity.faction === undefined) continue;
    const owner = factionToTerritoryOwner(entity.faction);
    const list = cells.get(owner);
    if (!list || list.length === 0) continue;
    const offset = offsets[owner]++ | 0;
    const cell = list[(entity.id * 109 + offset * 397) % list.length];
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

function addGreenhouseBlock(world: World, spec: GreenhouseBlockSpec, rng: () => number): Room | null {
  const gridW = BLOCK_COLS * BLOCK_ROOM_W + (BLOCK_COLS - 1) * BLOCK_GAP_X;
  const gridH = BLOCK_ROWS * BLOCK_ROOM_H + (BLOCK_ROWS - 1) * BLOCK_GAP_Y;
  const hub = tryMakeRoom(
    world,
    RoomType.COMMON,
    spec.x + ((gridW - 42) >> 1),
    spec.y + gridH + 10,
    42,
    18,
    `${spec.name}: узел переходов`,
    spec.wallTex,
    spec.floorTex,
  );
  if (!hub) return null;
  paintRoomTerritory(world, hub, spec.owner);
  setFeature(world, hub.x + 5, hub.y + 5, Feature.TABLE);
  setFeature(world, hub.x + hub.w - 6, hub.y + 5, Feature.SHELF);

  const rooms: Room[] = [];
  for (let row = 0; row < BLOCK_ROWS; row++) {
    for (let col = 0; col < BLOCK_COLS; col++) {
      const serial = row * BLOCK_COLS + col;
      const x = spec.x + col * (BLOCK_ROOM_W + BLOCK_GAP_X);
      const y = spec.y + row * (BLOCK_ROOM_H + BLOCK_GAP_Y);
      const type = greenhouseMicroRoomType(serial);
      const prefix = ORANZHEREYA_MICRO_ROOM_PREFIXES[serial % ORANZHEREYA_MICRO_ROOM_PREFIXES.length];
      const room = tryMakeRoom(
        world,
        type,
        x,
        y,
        BLOCK_ROOM_W + (serial % 4 === 0 ? 2 : 0),
        BLOCK_ROOM_H + (serial % 5 === 0 ? 2 : 0),
        `${spec.name}: ${prefix} ${serial + 1}`,
        type === RoomType.BATHROOM ? Tex.TILE_W : spec.wallTex,
        type === RoomType.BATHROOM ? Tex.F_WATER : spec.floorTex,
      );
      if (!room) continue;
      decorateGreenhouseMicroRoom(world, room, serial, rng);
      paintRoomTerritory(world, room, spec.owner);
      rooms.push(room);
    }
  }
  for (const room of rooms) connectRoomPair(world, room, hub);
  return hub;
}

function addHqCompound(world: World, spec: HqSpec): Room | null {
  const hq = tryMakeRoom(world, RoomType.HQ, spec.x, spec.y, spec.w, spec.h, spec.name, spec.wallTex, spec.floorTex);
  if (!hq) return null;
  hardenAuthoredHq(world, hq, spec.owner);
  setFeature(world, hq.x + 5, hq.y + 5, Feature.DESK);
  setFeature(world, hq.x + hq.w - 6, hq.y + 5, Feature.SCREEN);
  setFeature(world, hq.x + (hq.w >> 1), hq.y + hq.h - 5, Feature.SHELF);

  const supports: Room[] = [];
  for (const support of spec.supports) {
    const room = tryMakeRoom(
      world,
      support.type,
      spec.x + support.dx,
      spec.y + support.dy,
      support.w,
      support.h,
      hqSupportName(spec, support),
      support.wallTex,
      support.floorTex,
    );
    if (!room) continue;
    paintRoomTerritory(world, room, spec.owner);
    setFeature(world, room.x + Math.max(2, Math.min(room.w - 3, 4)), room.y + Math.max(2, Math.min(room.h - 3, 4)), support.feature);
    supports.push(room);
  }
  for (const room of supports) connectRoomPair(world, hq, room);
  return hq;
}

function addCitizenOutposts(world: World): Room[] {
  const out: Room[] = [];
  for (const spec of [
    { name: ORANZHEREYA_HQ_ROOM_NAMES.citizenNorth, x: 250, y: 196, w: 46, h: 22 },
    { name: ORANZHEREYA_HQ_ROOM_NAMES.citizenSouth, x: 552, y: 896, w: 50, h: 24 },
  ] as const) {
    const room = tryMakeRoom(world, RoomType.HQ, spec.x, spec.y, spec.w, spec.h, spec.name, Tex.HERMO_WALL, Tex.F_LINO);
    if (!room) continue;
    hardenAuthoredHq(world, room, ZoneFaction.CITIZEN);
    setFeature(world, room.x + 4, room.y + 4, Feature.DESK);
    setFeature(world, room.x + room.w - 5, room.y + 4, Feature.SHELF);
    out.push(room);
  }
  return out;
}

function carveMacroIrrigation(world: World, rng: () => number): void {
  const green = Tex.F_GREEN_CARPET;
  const concrete = Tex.F_CONCRETE;
  const tile = Tex.F_TILE;
  for (const line of [
    [CX, CY, 0, CY, 7, concrete],
    [CX, CY, W - 1, CY, 7, concrete],
    [CX, CY, CX, 0, 7, concrete],
    [CX, CY, CX, W - 1, 7, concrete],
    [72, 184, 952, 184, 5, tile],
    [72, 824, 952, 824, 5, tile],
    [184, 72, 184, 952, 5, tile],
    [824, 72, 824, 952, 5, tile],
    [140, 140, 884, 884, 3, concrete],
    [884, 140, 140, 884, 3, concrete],
  ] as const) {
    carveGreenhouseLine(world, line[0], line[1], line[2], line[3], line[4], line[5]);
  }

  for (const field of [
    { x: 48, y: 220, w: 216, h: 86, tex: green, seed: 11 },
    { x: 318, y: 218, w: 174, h: 72, tex: green, seed: 17 },
    { x: 558, y: 210, w: 198, h: 78, tex: green, seed: 23 },
    { x: 760, y: 420, w: 170, h: 110, tex: green, seed: 31 },
    { x: 592, y: 590, w: 244, h: 92, tex: green, seed: 37 },
    { x: 298, y: 688, w: 216, h: 88, tex: green, seed: 41 },
    { x: 64, y: 644, w: 212, h: 84, tex: green, seed: 43 },
    { x: 208, y: 102, w: 86, h: 70, tex: green, seed: 47 },
  ] as const) {
    carveCultivationField(world, field.x, field.y, field.w, field.h, field.tex, field.seed, rng);
  }

  for (const basin of [
    { x: 370, y: 366, w: 124, h: 28 },
    { x: 536, y: 356, w: 112, h: 30 },
    { x: 426, y: 580, w: 188, h: 24 },
    { x: 156, y: 498, w: 92, h: 24 },
    { x: 780, y: 604, w: 96, h: 24 },
  ] as const) {
    carveWaterBasin(world, basin.x, basin.y, basin.w, basin.h);
  }
}

function connectExpansionRooms(world: World, rooms: readonly Room[]): void {
  const gallery = world.rooms.find(room => room.name === ORANZHEREYA_ROOM_NAMES.gallery)
    ?? world.rooms.find(room => room.type === RoomType.COMMON)
    ?? world.rooms[0];
  if (!gallery) return;
  for (const room of rooms) connectRoomPair(world, gallery, room);
  for (let i = 1; i < rooms.length; i++) {
    if (i % 2 === 0) connectRoomPair(world, rooms[i - 1], rooms[i]);
  }
}

function tryMakeRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
  ceilingTier?: number,
): Room | null {
  if (!canStampGreenhouseRoom(world, x, y, w, h)) return null;
  const room = makeRoom(world, type, x, y, w, h, name, wallTex, floorTex, ceilingTier);
  return room;
}

function canStampGreenhouseRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  if (x < 4 || y < 4 || x + w >= W - 4 || y + h >= W - 4) return false;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const idx = world.idx(x + dx, y + dy);
      if (world.aptMask[idx] || world.cells[idx] !== Cell.WALL || world.roomMap[idx] >= 0) return false;
    }
  }
  return true;
}

function greenhouseMicroRoomType(serial: number): RoomType {
  switch (serial % 8) {
    case 0: return RoomType.STORAGE;
    case 1: return RoomType.KITCHEN;
    case 2: return RoomType.PRODUCTION;
    case 3: return RoomType.BATHROOM;
    case 4: return RoomType.STORAGE;
    case 5: return RoomType.COMMON;
    case 6: return RoomType.OFFICE;
    default: return RoomType.KITCHEN;
  }
}

function decorateGreenhouseMicroRoom(world: World, room: Room, serial: number, rng: () => number): void {
  const primary = room.type === RoomType.BATHROOM ? Feature.SINK
    : room.type === RoomType.PRODUCTION ? Feature.APPARATUS
      : room.type === RoomType.OFFICE ? Feature.DESK
        : room.type === RoomType.COMMON ? Feature.TABLE
          : Feature.SHELF;
  setFeature(world, room.x + 3, room.y + 3, primary);
  if (room.w > 10) setFeature(world, room.x + room.w - 4, room.y + Math.max(3, room.h - 4), serial % 3 === 0 ? Feature.SCREEN : Feature.SHELF);
  if (room.type === RoomType.KITCHEN || room.type === RoomType.PRODUCTION) {
    for (let x = room.x + 2; x < room.x + room.w - 2; x += 5) {
      const idx = world.idx(x, room.y + room.h - 2);
      world.floorTex[idx] = Tex.F_GREEN_CARPET;
      if (rng() < 0.5) world.features[idx] = Feature.TABLE;
    }
  }
}

function carveGreenhouseLine(world: World, ax: number, ay: number, bx: number, by: number, width: number, floorTex: Tex): void {
  if (ax !== bx && ay !== by) {
    carveGreenhouseLine(world, ax, ay, bx, ay, width, floorTex);
    carveGreenhouseLine(world, bx, ay, bx, by, width, floorTex);
    return;
  }
  const half = Math.floor(width / 2);
  const from = ax === bx ? Math.min(ay, by) : Math.min(ax, bx);
  const to = ax === bx ? Math.max(ay, by) : Math.max(ax, bx);
  for (let p = from; p <= to; p++) {
    for (let o = -half; o <= half; o++) {
      setGreenhouseFloor(world, ax === bx ? ax + o : p, ax === bx ? p : ay + o, floorTex);
    }
  }
}

function carveCultivationField(
  world: World,
  x: number,
  y: number,
  w: number,
  h: number,
  floorTex: Tex,
  seed: number,
  rng: () => number,
): void {
  const roomId = world.rooms.length;
  const room: Room = {
    id: roomId,
    type: RoomType.PRODUCTION,
    x: world.wrap(x),
    y: world.wrap(y),
    w,
    h,
    doors: [],
    sealed: false,
    name: `Внешнее поле выращивания #${roomId}`,
    apartmentId: -1,
    wallTex: Tex.PANEL,
    floorTex,
    ceilingTier: 3,
  };
  world.rooms.push(room);

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const row = dy % 12;
      if (row === 0 || row === 1 || row === 6) {
        setGreenhouseFloor(world, x + dx, y + dy, row === 6 ? Tex.F_CONCRETE : floorTex, false, roomId);
      } else if (dx % 13 <= 1) {
        setGreenhouseFloor(world, x + dx, y + dy, Tex.F_WATER, true, roomId);
      }
      if (row === 3 && dx % 17 === 0 && rng() < 0.85) {
        const idx = world.idx(x + dx, y + dy);
        if (world.cells[idx] === Cell.FLOOR && world.features[idx] === Feature.NONE) world.features[idx] = Feature.TABLE;
      }
      if ((dx * 19 + dy * 23 + seed) % 211 === 0) {
        stampSurfaceSplat(world, x + dx, y + dy, 0.5, 0.5, 1.1, 0.16, seed * 4099 + dx * 17 + dy, 62, 118, 52, true);
      }
      if (dx > 4 && dy > 4 && dx < w - 4 && dy < h - 4) {
        if (dx % 24 === 0 && dy % 24 === 0) {
          const idx = world.idx(x + dx, y + dy);
          if (!world.aptMask[idx] && !world.hermoWall[idx]) {
            world.cells[idx] = Cell.WALL;
            world.wallTex[idx] = Tex.PIPE;
            world.roomMap[idx] = -1;
            world.features[idx] = Feature.NONE;
          }
        } else if (dx % 24 === 2 && dy % 24 === 0) {
          const idx = world.idx(x + dx, y + dy);
          if (world.cells[idx] === Cell.FLOOR && world.features[idx] === Feature.NONE) {
            world.features[idx] = Feature.MACHINE;
          }
        } else if (dx % 24 === 4 && dy % 24 === 0) {
          const idx = world.idx(x + dx, y + dy);
          if (world.cells[idx] === Cell.FLOOR && world.features[idx] === Feature.NONE) {
            world.features[idx] = Feature.APPARATUS;
          }
        }
      }
    }
  }
}

function carveWaterBasin(world: World, x: number, y: number, w: number, h: number): void {
  const roomId = world.rooms.length;
  const room: Room = {
    id: roomId,
    type: RoomType.BATHROOM,
    x: world.wrap(x),
    y: world.wrap(y),
    w,
    h,
    doors: [],
    sealed: false,
    name: `Внешний питательный бассейн #${roomId}`,
    apartmentId: -1,
    wallTex: Tex.TILE_W,
    floorTex: Tex.F_WATER,
    ceilingTier: 3,
  };
  world.rooms.push(room);

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      if (dx <= 1 || dy <= 1 || dx >= w - 2 || dy >= h - 2) setGreenhouseFloor(world, x + dx, y + dy, Tex.F_TILE, false, roomId);
      else setGreenhouseFloor(world, x + dx, y + dy, Tex.F_WATER, true, roomId);

      if (dx > 3 && dy > 3 && dx < w - 3 && dy < h - 3) {
        if (dx % 20 === 0 && dy % 20 === 0) {
          const idx = world.idx(x + dx, y + dy);
          if (!world.aptMask[idx] && !world.hermoWall[idx]) {
            world.cells[idx] = Cell.WALL;
            world.wallTex[idx] = Tex.CONCRETE;
            world.roomMap[idx] = -1;
            world.features[idx] = Feature.NONE;
          }
        } else if (dx % 20 === 2 && dy % 20 === 0) {
          const idx = world.idx(x + dx, y + dy);
          if (world.cells[idx] === Cell.FLOOR && world.features[idx] === Feature.NONE) {
            world.features[idx] = Feature.MACHINE;
          }
        }
      }
    }
  }
}

function setGreenhouseFloor(world: World, x: number, y: number, floorTex: Tex, water = false, roomId = -1): void {
  const idx = world.idx(x, y);
  if (world.aptMask[idx] || world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.DOOR) return;
  if (world.roomMap[idx] >= 0 || world.hermoWall[idx]) return;
  world.cells[idx] = water ? Cell.WATER : Cell.FLOOR;
  world.roomMap[idx] = roomId;
  world.floorTex[idx] = floorTex;
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
    const ni = world.idx(x + dx, y + dy);
    if (world.cells[ni] === Cell.WALL) world.wallTex[ni] = Tex.PANEL;
  }
}

function hardenAuthoredHq(world: World, room: Room, owner: TerritoryOwner): void {
  room.type = RoomType.HQ;
  room.sealed = true;
  room.wallTex = Tex.HERMO_WALL;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      const interior = dx >= 0 && dx < room.w && dy >= 0 && dy < room.h;
      if (interior) {
        if (world.roomMap[idx] === room.id) world.factionControl[idx] = owner;
        continue;
      }
      if (world.cells[idx] !== Cell.WALL || world.aptMask[idx]) continue;
      world.hermoWall[idx] = 1;
      world.wallTex[idx] = Tex.HERMO_WALL;
    }
  }
  for (const doorIdx of room.doors) {
    const door = world.doors.get(doorIdx);
    if (door) door.state = DoorState.HERMETIC_OPEN;
    world.factionControl[doorIdx] = owner;
  }
  ensureHermeticHqDoor(world, room, owner);
}

function paintRoomTerritory(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[idx] === room.id && !world.aptMask[idx]) world.factionControl[idx] = owner;
    }
  }
  for (const doorIdx of room.doors) world.factionControl[doorIdx] = owner;
}

function ensureHermeticHqDoor(world: World, room: Room, owner: TerritoryOwner): void {
  if (room.doors.some(doorIdx => {
    const door = world.doors.get(doorIdx);
    return door?.state === DoorState.HERMETIC_OPEN || door?.state === DoorState.HERMETIC_CLOSED;
  })) return;

  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const x = room.x + dx;
      const y = room.y + dy;
      const idx = world.idx(x, y);
      if (world.aptMask[idx]) continue;
      let interior = false;
      let exteriorRoom = -1;
      let exteriorPassable = false;
      for (const [ox, oy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
        const ni = world.idx(x + ox, y + oy);
        if (world.roomMap[ni] === room.id) {
          interior = true;
          continue;
        }
        const cell = world.cells[ni];
        if (cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR) {
          exteriorPassable = true;
          if (world.roomMap[ni] >= 0) exteriorRoom = world.roomMap[ni];
        }
      }
      if (!interior || !exteriorPassable) continue;
      world.cells[idx] = Cell.DOOR;
      world.hermoWall[idx] = 0;
      world.wallTex[idx] = Tex.HERMO_WALL;
      world.factionControl[idx] = owner;
      world.doors.set(idx, { idx, state: DoorState.HERMETIC_OPEN, roomA: room.id, roomB: exteriorRoom, keyId: '', timer: 0 });
      if (!room.doors.includes(idx)) room.doors.push(idx);
      if (exteriorRoom >= 0) {
        const other = world.rooms[exteriorRoom];
        if (other && !other.doors.includes(idx)) other.doors.push(idx);
      }
      return;
    }
  }
}

function hqSupportName(spec: HqSpec, support: HqSupportSpec): string {
  return `${spec.name}: ${support.name}`;
}

function isOranzhereyaAmbientNpc(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    !entity.plotNpcId &&
    !entity.persistentNpcId &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    entity.faction !== undefined;
}

function oranzhereyaTerritorySpawnCells(world: World): Map<TerritoryOwner, number[]> {
  const cells = new Map<TerritoryOwner, number[]>([
    [ZoneFaction.CITIZEN, []],
    [ZoneFaction.LIQUIDATOR, []],
    [ZoneFaction.CULTIST, []],
    [ZoneFaction.SCIENTIST, []],
    [ZoneFaction.WILD, []],
  ]);
  for (let i = 0; i < W * W; i++) {
    const cell = world.cells[i];
    if (cell !== Cell.FLOOR && cell !== Cell.WATER) continue;
    if (world.aptMask[i] || world.hermoWall[i] || world.containerMap.has(i) || world.features[i] === Feature.LIFT_BUTTON) continue;
    const list = cells.get(world.factionControl[i] as TerritoryOwner);
    if (list) list.push(i);
  }
  return cells;
}

function initWorld(world: World): void {
  world.wallTex.fill(Tex.PANEL);
  world.floorTex.fill(Tex.F_CONCRETE);
}

function buildRooms(world: World): GreenhouseRooms {
  const entry = makeRoom(world, RoomType.CORRIDOR, CX - 66, CY - 16, 132, 32, ORANZHEREYA_ROOM_NAMES.entry, Tex.PANEL, Tex.F_TILE, 3);
  const gallery = makeRoom(world, RoomType.COMMON, CX - 106, CY - 88, 212, 102, ORANZHEREYA_ROOM_NAMES.gallery, Tex.PANEL, Tex.F_GREEN_CARPET, 3);
  const pump = makeRoom(world, RoomType.PRODUCTION, CX - 62, CY - 154, 124, 44, ORANZHEREYA_ROOM_NAMES.pump, Tex.PIPE, Tex.F_CONCRETE, 3);
  const northRows = makeRoom(world, RoomType.KITCHEN, CX - 270, CY - 184, 156, 78, ORANZHEREYA_ROOM_NAMES.northRows, Tex.PANEL, Tex.F_GREEN_CARPET, 3);
  const waterBasin = makeRoom(world, RoomType.BATHROOM, CX + 112, CY - 184, 156, 78, ORANZHEREYA_ROOM_NAMES.waterBasin, Tex.TILE_W, Tex.F_WATER, 3);
  const burnTrench = makeRoom(world, RoomType.PRODUCTION, CX - 270, CY - 74, 116, 86, ORANZHEREYA_ROOM_NAMES.burnTrench, Tex.METAL, Tex.F_CONCRETE, 3);
  const guardPost = makeRoom(world, RoomType.HQ, CX + 134, CY - 68, 114, 76, ORANZHEREYA_ROOM_NAMES.guardPost, Tex.METAL, Tex.F_LINO, 3);
  const mushroomWard = makeRoom(world, RoomType.PRODUCTION, CX - 270, CY + 68, 158, 82, ORANZHEREYA_ROOM_NAMES.mushroomWard, Tex.ROTTEN, Tex.F_GREEN_CARPET, 3);
  const compost = makeRoom(world, RoomType.STORAGE, CX - 92, CY + 32, 76, 58, ORANZHEREYA_ROOM_NAMES.compost, Tex.ROTTEN, Tex.F_CONCRETE, 2);
  const seedVault = makeRoom(world, RoomType.STORAGE, CX - 76, CY + 96, 92, 68, ORANZHEREYA_ROOM_NAMES.seedVault, Tex.METAL, Tex.F_CONCRETE, 2);
  const marketStall = makeRoom(world, RoomType.COMMON, CX + 28, CY + 88, 100, 76, ORANZHEREYA_ROOM_NAMES.marketStall, Tex.BRICK, Tex.F_LINO, 3);
  const southRows = makeRoom(world, RoomType.KITCHEN, CX + 154, CY + 70, 156, 82, ORANZHEREYA_ROOM_NAMES.southRows, Tex.PANEL, Tex.F_GREEN_CARPET, 3);

  return {
    entry,
    gallery,
    pump,
    northRows,
    southRows,
    waterBasin,
    burnTrench,
    mushroomWard,
    seedVault,
    marketStall,
    guardPost,
    compost,
  };
}

function makeRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
  ceilingTier?: number,
): Room {
  const room = stampRoom(world, world.rooms.length, type, x, y, w, h, -1);
  room.name = name;
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  if (ceilingTier !== undefined) room.ceilingTier = ceilingTier;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const idx = world.idx(x + dx, y + dy);
      if (world.cells[idx] === Cell.WALL) world.wallTex[idx] = wallTex;
    }
  }
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const idx = world.idx(x + dx, y + dy);
      world.floorTex[idx] = floorTex;
    }
  }
  return room;
}

function connectRooms(world: World, rooms: GreenhouseRooms): void {
  for (const room of [
    rooms.pump,
    rooms.northRows,
    rooms.waterBasin,
    rooms.burnTrench,
    rooms.guardPost,
    rooms.mushroomWard,
    rooms.compost,
    rooms.seedVault,
    rooms.marketStall,
    rooms.southRows,
  ]) connectRoomPair(world, rooms.gallery, room);
  connectRoomPair(world, rooms.entry, rooms.gallery);
  connectRoomPair(world, rooms.pump, rooms.waterBasin);
  connectRoomPair(world, rooms.mushroomWard, rooms.compost);
  connectRoomPair(world, rooms.marketStall, rooms.southRows);
}

function connectRoomPair(world: World, a: Room, b: Room): void {
  const ac = roomCenter(a);
  const bc = roomCenter(b);
  const ae = roomExit(world, a, bc.x, bc.y);
  const be = roomExit(world, b, ac.x, ac.y);
  carveCorridor(world, ae.ox, ae.oy, be.ox, be.oy);
}

function roomCenter(room: Room): { x: number; y: number } {
  return {
    x: room.x + Math.floor(room.w / 2),
    y: room.y + Math.floor(room.h / 2),
  };
}

function decorateRooms(world: World, rooms: GreenhouseRooms): void {
  placeCropRows(world, rooms.northRows, 0);
  placeCropRows(world, rooms.southRows, 97);
  placeMushroomRows(world, rooms.mushroomWard);
  placeIrrigationGraph(world, rooms);
  placeRoomFixtures(world, rooms);
  stampGrowthFields(world, rooms);
  decorateLargeRoomColumnsAndMeshes(world, rooms);
}

function decorateLargeRoomColumnsAndMeshes(world: World, rooms: GreenhouseRooms): void {
  for (let dy = 6; dy < rooms.gallery.h - 6; dy++) {
    for (let dx = 6; dx < rooms.gallery.w - 6; dx++) {
      const x = rooms.gallery.x + dx;
      const y = rooms.gallery.y + dy;
      const idx = world.idx(x, y);
      if (world.cells[idx] !== Cell.FLOOR || world.aptMask[idx]) continue;

      if (dx % 16 === 0 && dy % 16 === 0) {
        world.cells[idx] = Cell.WALL;
        world.wallTex[idx] = Tex.CONCRETE;
        world.roomMap[idx] = -1;
        world.features[idx] = Feature.NONE;
      } else if (dx % 16 === 2 && dy % 16 === 0) {
        if (world.features[idx] === Feature.NONE) world.features[idx] = Feature.MACHINE;
      } else if (dx % 16 === 4 && dy % 16 === 0) {
        if (world.features[idx] === Feature.NONE) world.features[idx] = Feature.TABLE;
      } else if (dx % 16 === 8 && dy % 16 === 0) {
        if (world.features[idx] === Feature.NONE) world.features[idx] = Feature.LAMP;
      }
    }
  }

  for (const room of [rooms.pump, rooms.burnTrench, rooms.waterBasin, rooms.northRows, rooms.southRows, rooms.mushroomWard, rooms.guardPost, rooms.entry]) {
    for (let dy = 5; dy < room.h - 5; dy++) {
      for (let dx = 5; dx < room.w - 5; dx++) {
        const x = room.x + dx;
        const y = room.y + dy;
        const idx = world.idx(x, y);
        if ((world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) || world.aptMask[idx]) continue;

        const step = room === rooms.entry ? 18 : 14;
        if (dx % step === 0 && dy % step === 0) {
          world.cells[idx] = Cell.WALL;
          world.wallTex[idx] = room === rooms.pump || room === rooms.burnTrench ? Tex.PIPE : Tex.CONCRETE;
          world.roomMap[idx] = -1;
          world.features[idx] = Feature.NONE;
        } else if (dx % step === 2 && dy % step === 0) {
          if (world.cells[idx] === Cell.FLOOR && world.features[idx] === Feature.NONE) {
            world.features[idx] = room === rooms.guardPost ? Feature.DESK : Feature.APPARATUS;
          }
        }
      }
    }
  }
}

function fillOranzhereyaVoids(world: World, rng: () => number, existingHubs: Room[]): void {
  carveGreenhouseLine(world, 24, 24, 996, 24, 4, Tex.F_CONCRETE);
  carveGreenhouseLine(world, 24, 996, 996, 996, 4, Tex.F_CONCRETE);
  carveGreenhouseLine(world, 24, 24, 24, 996, 4, Tex.F_CONCRETE);
  carveGreenhouseLine(world, 996, 24, 996, 996, 4, Tex.F_CONCRETE);

  const newRooms: Room[] = [];
  for (let p = 60; p < 960; p += 80) {
    const boothN = tryMakeRoom(world, RoomType.PRODUCTION, p, 32, 16, 12, 'Периметральная щитовая О-8', Tex.PIPE, Tex.F_CONCRETE, 1);
    if (boothN) {
      setFeature(world, boothN.x + 4, boothN.y + 4, Feature.MACHINE);
      setFeature(world, boothN.x + boothN.w - 5, boothN.y + 4, Feature.APPARATUS);
      newRooms.push(boothN);
    }
    const boothS = tryMakeRoom(world, RoomType.PRODUCTION, p, 976, 16, 12, 'Периметральная щитовая О-8', Tex.PIPE, Tex.F_CONCRETE, 1);
    if (boothS) {
      setFeature(world, boothS.x + 4, boothS.y + 4, Feature.MACHINE);
      setFeature(world, boothS.x + boothS.w - 5, boothS.y + 4, Feature.APPARATUS);
      newRooms.push(boothS);
    }
    const boothW = tryMakeRoom(world, RoomType.PRODUCTION, 32, p, 12, 16, 'Трансформаторная будка О-8', Tex.METAL, Tex.F_CONCRETE, 1);
    if (boothW) {
      setFeature(world, boothW.x + 4, boothW.y + 4, Feature.MACHINE);
      setFeature(world, boothW.x + 4, boothW.y + boothW.h - 5, Feature.APPARATUS);
      newRooms.push(boothW);
    }
    const boothE = tryMakeRoom(world, RoomType.PRODUCTION, 976, p, 12, 16, 'Трансформаторная будка О-8', Tex.METAL, Tex.F_CONCRETE, 1);
    if (boothE) {
      setFeature(world, boothE.x + 4, boothE.y + 4, Feature.MACHINE);
      setFeature(world, boothE.x + 4, boothE.y + boothE.h - 5, Feature.APPARATUS);
      newRooms.push(boothE);
    }
  }

  const storageCoords = [
    { x: 120, y: 120, w: 42, h: 28 },
    { x: 440, y: 120, w: 46, h: 30 },
    { x: 720, y: 120, w: 40, h: 28 },
    { x: 120, y: 860, w: 44, h: 30 },
    { x: 720, y: 860, w: 42, h: 28 },
    { x: 280, y: 440, w: 38, h: 26 },
    { x: 680, y: 440, w: 40, h: 26 },
    { x: 520, y: 740, w: 42, h: 28 },
  ];
  for (const sc of storageCoords) {
    const storage = tryMakeRoom(world, RoomType.STORAGE, sc.x, sc.y, sc.w, sc.h, 'Склад госрезерва Оранжереи', Tex.BRICK, Tex.F_CONCRETE, 2);
    if (storage) {
      for (let dy = 5; dy < storage.h - 5; dy += 5) {
        for (let dx = 6; dx < storage.w - 6; dx += 2) {
          const idx = world.idx(storage.x + dx, storage.y + dy);
          if (world.cells[idx] === Cell.FLOOR) world.features[idx] = Feature.SHELF;
        }
      }
      for (let dx = 12; dx < storage.w - 12; dx += 12) {
        const idx = world.idx(storage.x + dx, storage.y + Math.floor(storage.h / 2));
        if (world.cells[idx] === Cell.FLOOR) {
          world.cells[idx] = Cell.WALL;
          world.wallTex[idx] = Tex.CONCRETE;
          world.roomMap[idx] = -1;
          world.features[idx] = Feature.NONE;
        }
      }
      newRooms.push(storage);
    }
  }

  const industrialCoords = [
    { x: 200, y: 380, w: 34, h: 34, type: 'water' },
    { x: 740, y: 380, w: 32, h: 32, type: 'vent' },
    { x: 220, y: 560, w: 32, h: 32, type: 'vent' },
    { x: 680, y: 560, w: 36, h: 36, type: 'water' },
    { x: 380, y: 780, w: 34, h: 34, type: 'water' },
    { x: 580, y: 140, w: 32, h: 32, type: 'vent' },
  ];
  for (const ic of industrialCoords) {
    if (ic.type === 'water') {
      const waterHall = tryMakeRoom(world, RoomType.PRODUCTION, ic.x, ic.y, ic.w, ic.h, 'Зал водоочистки О-8', Tex.TILE_W, Tex.F_TILE, 3);
      if (waterHall) {
        for (let dy = 8; dy < waterHall.h - 8; dy++) {
          for (let dx = 8; dx < waterHall.w - 8; dx++) {
            const idx = world.idx(waterHall.x + dx, waterHall.y + dy);
            if (world.cells[idx] === Cell.FLOOR) {
              world.cells[idx] = Cell.WATER;
              world.floorTex[idx] = Tex.F_WATER;
            }
          }
        }
        for (let dx = 5; dx < waterHall.w - 5; dx += 6) {
          setFeature(world, waterHall.x + dx, waterHall.y + 4, Feature.MACHINE);
          setFeature(world, waterHall.x + dx, waterHall.y + waterHall.h - 5, Feature.MACHINE);
        }
        newRooms.push(waterHall);
      }
    } else {
      const ventTower = tryMakeRoom(world, RoomType.PRODUCTION, ic.x, ic.y, ic.w, ic.h, 'Вентиляционная градирня О-8', Tex.PIPE, Tex.F_CONCRETE, 3);
      if (ventTower) {
        for (let dy = 6; dy < ventTower.h - 6; dy += 6) {
          for (let dx = 6; dx < ventTower.w - 6; dx += 4) {
            const idx = world.idx(ventTower.x + dx, ventTower.y + dy);
            if (world.cells[idx] === Cell.FLOOR) {
              if (dx % 12 === 0) {
                world.cells[idx] = Cell.WALL;
                world.wallTex[idx] = Tex.METAL;
                world.roomMap[idx] = -1;
                world.features[idx] = Feature.NONE;
              } else {
                world.features[idx] = Feature.MACHINE;
              }
            }
          }
        }
        newRooms.push(ventTower);
      }
    }
  }

  const prefixes = ['Курилка агрономов', 'Зал ожидания пайки', 'Пункт проверки фильтров', 'Бытовка капельников', 'Технический карман О-8'];
  let count = 0;
  for (let y = 50; y < 970; y += 28) {
    for (let x = 50; x < 970; x += 28) {
      const w = 16 + Math.floor(rng() * 6);
      const h = 14 + Math.floor(rng() * 6);
      const name = prefixes[count % prefixes.length];
      const room = tryMakeRoom(world, RoomType.COMMON, x, y, w, h, name, Tex.PANEL, Tex.F_LINO, 1);
      if (room) {
        setFeature(world, room.x + 4, room.y + 4, Feature.TABLE);
        setFeature(world, room.x + room.w - 5, room.y + room.h - 5, Feature.SHELF);
        if (rng() < 0.5) setFeature(world, room.x + Math.floor(room.w / 2), room.y + 4, Feature.APPARATUS);
        newRooms.push(room);
        count++;
      }
    }
  }

  const secretWard = tryMakeRoom(world, RoomType.PRODUCTION, 340, 480, 24, 20, 'Секретный бокс гидропоники НИИ', Tex.TILE_W, Tex.F_TILE, 3);
  if (secretWard) {
    setFeature(world, secretWard.x + 6, secretWard.y + 6, Feature.APPARATUS);
    setFeature(world, secretWard.x + secretWard.w - 7, secretWard.y + 6, Feature.MACHINE);
    addContainer(world, secretWard, 3, ContainerKind.METAL_CABINET, 'Инкубатор мутагенных культур', [
      { defId: 'zhelemish_sample_sealed', count: 1 },
      { defId: 'experimental_concentrate', count: 2 },
      { defId: 'nii_sample_container', count: 1 },
      { defId: 'antidep', count: 1 },
    ], ['nii_bioreactor', 'secret_nii', 'mutagenic'], 'locked', Faction.SCIENTIST);
    newRooms.push(secretWard);
  }

  const smugglePoint = tryMakeRoom(world, RoomType.STORAGE, 620, 310, 22, 18, 'Перевалочный пункт агро-контрабанды', Tex.ROTTEN, Tex.F_LINO, 1);
  if (smugglePoint) {
    setFeature(world, smugglePoint.x + 5, smugglePoint.y + 5, Feature.SHELF);
    setFeature(world, smugglePoint.x + smugglePoint.w - 6, smugglePoint.y + smugglePoint.h - 6, Feature.TABLE);
    addContainer(world, smugglePoint, 4, ContainerKind.SECRET_STASH, 'Замаскированная бочка со спиртом и спорами', [
      { defId: 'contraband_shocker_parts', count: 1 },
      { defId: 'black_market_shells', count: 2 },
      { defId: 'braga_bucket', count: 1 },
      { defId: 'technical_spirit', count: 1 },
      { defId: 'govnyak_brick', count: 1 },
    ], ['black_market_88', 'contraband', 'smuggling'], 'secret', Faction.WILD);
    newRooms.push(smugglePoint);
  }

  const cleansingPost = tryMakeRoom(world, RoomType.HQ, 210, 680, 26, 22, 'Огневой рубеж хим-зачистки', Tex.METAL, Tex.F_CONCRETE, 3);
  if (cleansingPost) {
    setFeature(world, cleansingPost.x + 6, cleansingPost.y + 6, Feature.DESK);
    setFeature(world, cleansingPost.x + cleansingPost.w - 7, cleansingPost.y + 6, Feature.MACHINE);
    addContainer(world, cleansingPost, 5, ContainerKind.TOOL_LOCKER, 'Опечатанный ящик дезинфекции', [
      { defId: 'agnia_a130', count: 1 },
      { defId: 'decon_fluid', count: 2 },
      { defId: 'ammo_12g_incendiary', count: 2 },
      { defId: 'ip4_gasmask', count: 1 },
      { defId: 'liquidator_flashlamp', count: 1 },
    ], ['liquidator', 'burn_infestation', 'cleanup'], 'faction', Faction.LIQUIDATOR);
    newRooms.push(cleansingPost);
  }

  const cultAltar = tryMakeRoom(world, RoomType.COMMON, 780, 520, 28, 24, 'Святилище Спор Чернобога', Tex.ROTTEN, Tex.F_GREEN_CARPET, 3);
  if (cultAltar) {
    setFeature(world, cultAltar.x + 8, cultAltar.y + 8, Feature.TABLE);
    setFeature(world, cultAltar.x + cultAltar.w - 9, cultAltar.y + cultAltar.h - 9, Feature.LAMP);
    addContainer(world, cultAltar, 6, ContainerKind.SECRET_STASH, 'Чаша истотитного подношения', [
      { defId: 'holy_water', count: 1 },
      { defId: 'istotit_candle', count: 2 },
      { defId: 'maronary_shaving', count: 1 },
      { defId: 'green_briquette', count: 2 },
      { defId: 'zhelemish_raw', count: 1 },
    ], ['cultist', 'istotit', 'fungal_altar'], 'public', Faction.CULTIST);
    newRooms.push(cultAltar);
  }

  const hydroNode = tryMakeRoom(world, RoomType.PRODUCTION, 480, 210, 24, 20, 'Узел гидро-распределения О-8', Tex.PIPE, Tex.F_CONCRETE, 3);
  if (hydroNode) {
    setFeature(world, hydroNode.x + 6, hydroNode.y + 6, Feature.MACHINE);
    setFeature(world, hydroNode.x + hydroNode.w - 7, hydroNode.y + 6, Feature.APPARATUS);
    addContainer(world, hydroNode, 7, ContainerKind.TOOL_LOCKER, 'Шкаф резервных талонов и вентилей', [
      { defId: 'manometer', count: 1 },
      { defId: 'water_filter_regulator', count: 1 },
      { defId: 'pump_impeller', count: 1 },
      { defId: 'rubber_tube', count: 2 },
      { defId: 'water_coupon', count: 2 },
      { defId: 'hermodoor_journal', count: 1 },
    ], ['water', 'reroute', 'maintenance'], 'locked', Faction.CITIZEN);
    newRooms.push(hydroNode);
  }

  const allTargets = [...existingHubs, ...world.rooms.filter(r => r.name === ORANZHEREYA_ROOM_NAMES.gallery || r.name === ORANZHEREYA_ROOM_NAMES.entry)];
  if (allTargets.length > 0) {
    for (const room of newRooms) {
      let bestTarget = allTargets[0];
      let bestDist = Infinity;
      const rc = roomCenter(room);
      for (const target of allTargets) {
        const tc = roomCenter(target);
        const d = world.dist2(rc.x, rc.y, tc.x, tc.y);
        if (d < bestDist) {
          bestDist = d;
          bestTarget = target;
        }
      }
      connectRoomPair(world, room, bestTarget);
      allTargets.push(room);
    }
  }
}

function placeCropRows(world: World, room: Room, seed: number): void {
  for (let y = room.y + 7; y < room.y + room.h - 5; y += 8) {
    for (let x = room.x + 6; x < room.x + room.w - 6; x++) {
      const idx = world.idx(x, y);
      if (world.cells[idx] !== Cell.FLOOR) continue;
      world.floorTex[idx] = Tex.F_GREEN_CARPET;
      if ((x + seed) % 9 === 0) world.features[idx] = Feature.TABLE;
      if ((x + y + seed) % 23 === 0) stampSurfaceSplat(world, x, y, 0.5, 0.5, 1.2, 0.18, seed * 1009 + x * 17 + y, 48, 128, 54, true);
    }
  }
}

function placeMushroomRows(world: World, room: Room): void {
  for (let y = room.y + 5; y < room.y + room.h - 5; y += 7) {
    for (let x = room.x + 5; x < room.x + room.w - 5; x += 2) {
      const idx = world.idx(x, y);
      if (world.cells[idx] !== Cell.FLOOR) continue;
      world.floorTex[idx] = Tex.F_GREEN_CARPET;
      if ((x + y) % 11 === 0) world.features[idx] = Feature.SHELF;
      if ((x + y) % 19 === 0) stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.9, 0.22, x * 31 + y * 37, 72, 88, 56, true);
    }
  }
}

function placeIrrigationGraph(world: World, rooms: GreenhouseRooms): void {
  const pump = roomCenter(rooms.pump);
  const basin = roomCenter(rooms.waterBasin);
  const north = roomCenter(rooms.northRows);
  const south = roomCenter(rooms.southRows);
  const mushroom = roomCenter(rooms.mushroomWard);
  carveWaterLine(world, pump.x, pump.y, basin.x, basin.y);
  carveWaterLine(world, pump.x, pump.y, north.x, north.y);
  carveWaterLine(world, basin.x, basin.y, south.x, south.y);
  carveWaterLine(world, pump.x, pump.y, mushroom.x, mushroom.y);

  for (let y = rooms.waterBasin.y + 8; y < rooms.waterBasin.y + rooms.waterBasin.h - 8; y++) {
    for (let x = rooms.waterBasin.x + 10; x < rooms.waterBasin.x + rooms.waterBasin.w - 10; x++) {
      if ((x + y) % 3 !== 0) continue;
      const idx = world.idx(x, y);
      if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) continue;
      world.cells[idx] = Cell.WATER;
      world.floorTex[idx] = Tex.F_WATER;
    }
  }
}

function carveWaterLine(world: World, ax: number, ay: number, bx: number, by: number): void {
  const dx = world.delta(ax, bx);
  const dy = world.delta(ay, by);
  const sx = dx >= 0 ? 1 : -1;
  const sy = dy >= 0 ? 1 : -1;
  let x = ax;
  let y = ay;
  for (let i = 0; i <= Math.abs(dx); i++) {
    markWater(world, x, y);
    if (i < Math.abs(dx)) x = world.wrap(x + sx);
  }
  for (let i = 0; i <= Math.abs(dy); i++) {
    markWater(world, x, y);
    if (i < Math.abs(dy)) y = world.wrap(y + sy);
  }
}

function markWater(world: World, x: number, y: number): void {
  for (const [dx, dy] of [[0,0], [1,0], [-1,0], [0,1], [0,-1]] as const) {
    const idx = world.idx(x + dx, y + dy);
    if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) continue;
    world.cells[idx] = Cell.WATER;
    world.floorTex[idx] = Tex.F_WATER;
  }
}

function placeRoomFixtures(world: World, rooms: GreenhouseRooms): void {
  setFeature(world, rooms.pump.x + 12, rooms.pump.y + 10, Feature.MACHINE);
  setFeature(world, rooms.pump.x + rooms.pump.w - 14, rooms.pump.y + 12, Feature.APPARATUS);
  setFeature(world, rooms.waterBasin.x + 12, rooms.waterBasin.y + 10, Feature.SINK);
  setFeature(world, rooms.waterBasin.x + rooms.waterBasin.w - 13, rooms.waterBasin.y + 11, Feature.APPARATUS);
  setFeature(world, rooms.guardPost.x + 14, rooms.guardPost.y + 12, Feature.DESK);
  setFeature(world, rooms.marketStall.x + 12, rooms.marketStall.y + 16, Feature.TABLE);
  setFeature(world, rooms.seedVault.x + 10, rooms.seedVault.y + 12, Feature.SHELF);
  setFeature(world, rooms.seedVault.x + rooms.seedVault.w - 11, rooms.seedVault.y + 12, Feature.SHELF);
  setFeature(world, rooms.compost.x + 10, rooms.compost.y + 10, Feature.APPARATUS);
  setFeature(world, rooms.burnTrench.x + 10, rooms.burnTrench.y + 12, Feature.MACHINE);

  for (const room of Object.values(rooms)) {
    const c = roomCenter(room);
    setFeature(world, c.x, c.y, room.type === RoomType.STORAGE ? Feature.SHELF : Feature.LAMP);
  }
}

function stampGrowthFields(world: World, rooms: GreenhouseRooms): void {
  const splats = [
    { room: rooms.northRows, r: 46, g: 120, b: 52, radius: 24 },
    { room: rooms.southRows, r: 64, g: 132, b: 58, radius: 26 },
    { room: rooms.mushroomWard, r: 86, g: 88, b: 64, radius: 30 },
    { room: rooms.burnTrench, r: 130, g: 72, b: 38, radius: 18 },
    { room: rooms.compost, r: 70, g: 55, b: 38, radius: 16 },
  ] as const;
  for (let i = 0; i < splats.length; i++) {
    const c = roomCenter(splats[i].room);
    stampSurfaceSplat(world, c.x, c.y, 0.5, 0.5, splats[i].radius, 0.2, SEED + i * 901, splats[i].r, splats[i].g, splats[i].b, true);
  }
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const idx = world.idx(x, y);
  if (world.cells[idx] === Cell.FLOOR || world.cells[idx] === Cell.WATER) world.features[idx] = feature;
}

function placeLifts(world: World, entry: Room): void {
  placeLift(world, entry.x + 8, entry.y + 15, entry.x + 12, entry.y + 15, LiftDirection.UP);
  placeLift(world, entry.x + entry.w - 9, entry.y + 15, entry.x + entry.w - 13, entry.y + 15, LiftDirection.DOWN);
}

function placeLift(world: World, x: number, y: number, buttonX: number, buttonY: number, direction: LiftDirection): void {
  const li = world.idx(x, y);
  world.cells[li] = Cell.LIFT;
  world.wallTex[li] = Tex.LIFT_DOOR;
  world.liftDir[li] = direction;
  const bi = world.idx(buttonX, buttonY);
  if (world.cells[bi] === Cell.FLOOR || world.cells[bi] === Cell.WATER) world.features[bi] = Feature.LIFT_BUTTON;
  world.liftDir[bi] = direction;
}

function spawnNpcs(entities: Entity[], nextId: NextId, rooms: GreenhouseRooms): Record<GreenhouseNpcId, number> {
  return {
    oranzhereya_agronom_nadya: spawnPlotNpc(entities, nextId, 'oranzhereya_agronom_nadya', rooms.northRows, 8, Math.PI / 2),
    oranzhereya_irrigator_gleb: spawnPlotNpc(entities, nextId, 'oranzhereya_irrigator_gleb', rooms.pump, 7, 0),
    oranzhereya_guard_arsen: spawnPlotNpc(entities, nextId, 'oranzhereya_guard_arsen', rooms.guardPost, 5, Math.PI, 'makarov'),
    oranzhereya_market_sonya: spawnPlotNpc(entities, nextId, 'oranzhereya_market_sonya', rooms.marketStall, 4, -Math.PI / 2),
  };
}

function spawnPlotNpc(
  entities: Entity[],
  nextId: NextId,
  npcId: GreenhouseNpcId,
  room: Room,
  salt: number,
  angle: number,
  weapon = NPC_DEFS[npcId].weapon,
): number {
  const pos = roomCell(room, salt);
  const px = pos.x + 0.5;
  const py = pos.y + 0.5;
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, npcId, px, py, {
    angle,
    weapon,
    aiTarget: { x: px, y: py },
    extra: {
      assignedRoomId: room.id,
      rpg: randomRPG(3),
    },
  });
  return npc.id;
}

function placeContainers(
  world: World,
  rooms: GreenhouseRooms,
  owners: Record<GreenhouseNpcId, number>,
): void {
  addContainer(world, rooms.northRows, 1, ContainerKind.FRIDGE, 'Общий ящик чистой зелени', [
    { defId: 'mushroom_mass', count: 3 },
    { defId: 'bread', count: 2 },
    { defId: 'filtered_water', count: 1 },
  ], ['harvest', 'food', 'clean_crop', 'resident_relief'], 'public');

  addContainer(world, rooms.southRows, 2, ContainerKind.FRIDGE, 'Стеллаж спорного урожая', [
    { defId: 'mushroom_mass', count: 2 },
    { defId: 'infected_mushroom', count: 2 },
    { defId: 'spore_print', count: 1 },
  ], ['harvest', 'fungal', 'risky_food', 'black_market_88'], 'room');

  addContainer(world, rooms.waterBasin, 3, ContainerKind.METAL_CABINET, 'Шкаф питательного басейна', [
    { defId: 'filtered_water', count: 2 },
    { defId: 'filter_layer', count: 1 },
    { defId: 'water_coupon', count: 1 },
  ], ['nutrient_basin', 'water', 'reroute', 'service'], 'faction', Faction.LIQUIDATOR, owners.oranzhereya_guard_arsen, NPC_DEFS.oranzhereya_guard_arsen.name);

  addContainer(world, rooms.pump, 4, ContainerKind.TOOL_LOCKER, 'Пломбированный шкаф вентилей', [
    { defId: 'valve_tag', count: 1 },
    { defId: 'pipe', count: 1 },
    { defId: 'wrench', count: 1 },
  ], ['water', 'reroute', 'repair', 'valve', 'service'], 'owner', Faction.CITIZEN, owners.oranzhereya_irrigator_gleb, NPC_DEFS.oranzhereya_irrigator_gleb.name);

  addContainer(world, rooms.seedVault, 5, ContainerKind.METAL_CABINET, 'Семенная кладовая под подпись', [
    { defId: 'substrate_sack', count: 2 },
    { defId: 'spore_print', count: 2 },
    { defId: 'rock_salt', count: 1 },
    { defId: 'ration_registry_extract', count: 1 },
  ], ['seed', 'food', 'evidence_drop', 'ration'], 'owner', Faction.SCIENTIST, owners.oranzhereya_agronom_nadya, NPC_DEFS.oranzhereya_agronom_nadya.name);

  addContainer(world, rooms.marketStall, 6, ContainerKind.SECRET_STASH, 'Форточка испорченной пайки', [
    { defId: 'acid_bottle', count: 1 },
    { defId: 'infected_mushroom', count: 3 },
    { defId: 'forged_ration_card', count: 1 },
  ], ['black_market_88', 'sabotage_drop', 'poison_crop', 'contraband', 'secret'], 'secret', Faction.WILD, owners.oranzhereya_market_sonya, NPC_DEFS.oranzhereya_market_sonya.name);

  addContainer(world, rooms.burnTrench, 7, ContainerKind.TOOL_LOCKER, 'Прожиговый аварийный ящик', [
    { defId: 'ammo_fuel', count: 1 },
    { defId: 'gasmask_filter', count: 1 },
    { defId: 'cleaning_kit', count: 1 },
  ], ['burn_infestation', 'cleanup', 'fungus_counterplay', 'liquidator'], 'faction', Faction.LIQUIDATOR, owners.oranzhereya_guard_arsen, NPC_DEFS.oranzhereya_guard_arsen.name);

  addContainer(world, rooms.compost, 8, ContainerKind.TRASH_BIN, 'Компостная яма недостачи', [
    { defId: 'infected_mushroom', count: 1 },
    { defId: 'grey_briquette', count: 2 },
    { defId: 'rock_salt', count: 1 },
  ], ['compost', 'food', 'theft', 'samosbor'], 'room');
}

function addContainer(
  world: World,
  room: Room,
  salt: number,
  kind: ContainerKind,
  name: string,
  inventory: readonly Item[],
  tags: readonly string[],
  access: WorldContainer['access'],
  faction?: Faction,
  ownerNpcId?: number,
  ownerName?: string,
): WorldContainer {
  const pos = roomCell(room, salt);
  const idx = world.idx(pos.x, pos.y);
  setFeature(world, pos.x, pos.y, kind === ContainerKind.FRIDGE ? Feature.SINK : Feature.SHELF);
  const container: WorldContainer = {
    id: nextContainerId(world),
    x: pos.x,
    y: pos.y,
    floor: ORANZHEREYA_BETONA_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[idx],
    kind,
    name,
    inventory: cloneInventory(inventory),
    capacitySlots: Math.max(6, inventory.length + 3),
    ownerNpcId,
    ownerName,
    faction,
    access,
    lockDifficulty: access === 'locked' ? 3 : undefined,
    discovered: access !== 'secret',
    tags: uniqueTags([CONTENT_TAG, ...tags]),
  };
  world.addContainer(container);
  return container;
}

function nextContainerId(world: World): number {
  let id = 1;
  for (const container of world.containers) id = Math.max(id, container.id + 1);
  return id;
}

function placeDrops(world: World, entities: Entity[], nextId: NextId, rooms: GreenhouseRooms): void {
  dropItems(entities, nextId, rooms.northRows, ['mushroom_mass', 'mushroom_mass', 'water_coupon']);
  dropItems(entities, nextId, rooms.waterBasin, ['filtered_water', 'valve_tag']);
  dropItems(entities, nextId, rooms.mushroomWard, ['infected_mushroom', 'spore_print', 'substrate_sack']);
  dropItems(entities, nextId, rooms.burnTrench, ['rock_salt', 'ammo_fuel']);

  const cleansingPost = world.rooms.find(r => r.name === 'Огневой рубеж хим-зачистки');
  if (cleansingPost) dropItems(entities, nextId, cleansingPost, ['body_bag_roll', 'corpse_number_tag', 'contaminated_gloves']);
}

function dropItems(entities: Entity[], nextId: NextId, room: Room, itemIds: readonly string[]): void {
  for (let i = 0; i < itemIds.length; i++) {
    const defId = itemIds[i];
    if (!ITEMS[defId]) continue;
    const pos = roomCell(room, i + 9);
    entities.push({
      id: nextId.v++,
      type: EntityType.ITEM_DROP,
      x: pos.x + 0.5,
      y: pos.y + 0.5,
      angle: 0,
      pitch: 0,
      alive: true,
      speed: 0,
      sprite: Spr.ITEM_DROP,
      inventory: [{ defId, count: 1 }],
    });
  }
}

function spawnThreats(world: World, entities: Entity[], nextId: NextId, rooms: GreenhouseRooms): void {
  spawnMonster(world, entities, nextId, MonsterKind.BORSHCHEVIK, rooms.burnTrench, 4, 3, 'Борщевик из прожиговой канавы');
  spawnMonster(world, entities, nextId, MonsterKind.SPORE_CARPET, rooms.mushroomWard, 7, 3, 'Споровый ковёр у стеллажа');
  spawnMonster(world, entities, nextId, MonsterKind.CHERNOSLIZ, rooms.waterBasin, 6, 3, 'Чернослиз питательного басейна');
  spawnMonster(world, entities, nextId, MonsterKind.POMOYNY_ROY, rooms.compost, 3, 2, 'Компостный рой');

  const secretWard = world.rooms.find(r => r.name === 'Секретный бокс гидропоники НИИ');
  if (secretWard) spawnMonster(world, entities, nextId, MonsterKind.CHERNOSLIZ, secretWard, 5, 4, 'Лабораторный прото-чернослиз');

  const smugglePoint = world.rooms.find(r => r.name === 'Перевалочный пункт агро-контрабанды');
  if (smugglePoint) spawnMonster(world, entities, nextId, MonsterKind.BORSHCHEVIK, smugglePoint, 5, 4, 'Перекормленный борщевик-охранник');

  const cultAltar = world.rooms.find(r => r.name === 'Святилище Спор Чернобога');
  if (cultAltar) spawnMonster(world, entities, nextId, MonsterKind.POMOYNY_ROY, cultAltar, 5, 3, 'Благословенный рой культа');

  const hydroNode = world.rooms.find(r => r.name === 'Узел гидро-распределения О-8');
  if (hydroNode) spawnMonster(world, entities, nextId, MonsterKind.SPORE_CARPET, hydroNode, 5, 3, 'Уплотненный споровый ковер');
}

function spawnMonster(
  world: World,
  entities: Entity[],
  nextId: NextId,
  kind: MonsterKind,
  room: Room,
  salt: number,
  level: number,
  name?: string,
): void {
  const def = MONSTERS[kind];
  const pos = roomCell(room, salt);
  const idx = world.idx(pos.x, pos.y);
  if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) return;
  const hp = Math.round(def.hp * (0.9 + level * 0.16));
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: pos.x + 0.5,
    y: pos.y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: def.speed * (0.95 + level * 0.03),
    sprite: monsterSpr(kind),
    name,
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: pos.x, ty: pos.y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
  });
}

function roomCell(room: Room, salt: number): { x: number; y: number } {
  const iw = Math.max(1, room.w - 2);
  const ih = Math.max(1, room.h - 2);
  return {
    x: room.x + 1 + ((salt * 7) % iw),
    y: room.y + 1 + ((salt * 11) % ih),
  };
}

function cloneInventory(items: readonly Item[]): Item[] {
  return items.filter(item => !!ITEMS[item.defId]).map(item => ({ ...item }));
}

function uniqueTags(tags: readonly string[]): string[] {
  return Array.from(new Set(tags)).slice(0, 12);
}
