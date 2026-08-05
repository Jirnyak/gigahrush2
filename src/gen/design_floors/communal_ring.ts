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
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { hashSeed, withSeededRandom } from '../../core/rand';
import { freshNeeds } from '../../data/catalog';
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { ensureConnectivity, generateZones, sanitizeDoors, stampRoom } from '../shared';
import type { FloorGeneration } from '../floor_manifest';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('communal_ring');

export const COMMUNAL_RING_DESIGN_FLOOR_ID = 'communal_ring' as const;
export const COMMUNAL_RING_ROUTE_Z = 4;

const BASE_FLOOR = FloorLevel.KVARTIRY;
const RING_SEED = hashSeed(COMMUNAL_RING_DESIGN_FLOOR_ID);
const COMMUNAL_QUEUE_CROWD_CAP = 12;

const NPC_IDS = {
  luba: 'communal_laundry_luba',
  viktor: 'communal_shower_viktor',
  tamara: 'communal_notice_tamara',
  sasha: 'communal_panhandler_sasha',
  nina: 'communal_through_nina',
  yegor: 'communal_primus_yegor',
  arkhip: 'communal_syndicate_arkhip',
  zoya: 'communal_inspector_zoya',
} as const;

const NPC_DEFS: Record<(typeof NPC_IDS)[keyof typeof NPC_IDS], PlotNpcDef> = {
  communal_laundry_luba: {
    name: 'Люба Прачечная',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.HOUSEWIFE,
    sprite: Occupation.HOUSEWIFE,
    hp: 90, maxHp: 90, money: 24, speed: 0.8,
    inventory: [{ defId: 'cloth_roll', count: 2 }, { defId: 'bandage', count: 2 }, { defId: 'cleaning_kit', count: 1 }],
    talkLines: [
      'Кольцо держится на чистой ткани. Грязная ткань держит только слухи.',
      'Принесёшь рулоны - отдам бинты. Не стерильные, но сухие.',
      'После самосбора машинка сама открылась. Внутри был список, а не бельё.',
      'У прачечной общий вход, но у шкафчика есть глаза. Очередь видит даже через мокрую дверь.',
    ],
    talkLinesPost: [
      'Бинты вывешены. Кто первый снял - тот потом первый объясняет.',
      'Ползун под сливом притих. Значит, слушает.',
    ],
  },
  communal_shower_viktor: {
    name: 'Виктор Напорный',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.LOCKSMITH,
    sprite: Occupation.LOCKSMITH,
    hp: 130, maxHp: 130, money: 45, speed: 0.9,
    inventory: [{ defId: 'wrench', count: 1 }, { defId: 'valve_tag', count: 1 }, { defId: 'filtered_water', count: 1 }],
    talkLines: [
      'Душ не моет. Душ голосует давлением.',
      'Две бирки вентиля - и я решу, кому сегодня достанется вода.',
      'Можно пустить напор вниз, в коллекторы. Тогда здесь сухо, зато снизу злые.',
      'Не стой босиком у третьей кабинки. После сирены там бьет грязная вода.',
    ],
    talkLinesPost: [
      'Напор ровный. Слишком ровный, if слушать трубу.',
      'Чистая вода - это временное соглашение с нижним этажом.',
    ],
  },
  communal_notice_tamara: {
    name: 'Тамара Объявление',
    isFemale: true,
    faction: Faction.SCIENTIST,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 85, maxHp: 85, money: 62, speed: 0.85,
    inventory: [{ defId: 'neighbor_complaint', count: 2 }, { defId: 'sealed_complaint', count: 1 }, { defId: 'water_coupon', count: 2 }],
    talkLines: [
      'На кольце правда появляется только после кнопки и подписи.',
      'Две бумажки спорят за одну доску. Принеси запечатанную жалобу - решим, чья очередь станет законом.',
      'Сорвать объявление можно быстро. Потом оно догоняет медленно.',
      'Кухня хочет кипяток, прачечная - ткань, кладовая - тишину. Доска не выдержит всех.',
    ],
    talkLinesPost: [
      'Объявление принято. Теперь оно официально мешает жить.',
      'Если доска изменилась после сирены, значит кто-то спрятался рядом с кнопками.',
    ],
  },
  communal_panhandler_sasha: {
    name: 'Саша У Очереди',
    isFemale: false,
    faction: Faction.WILD,
    occupation: Occupation.TRAVELER,
    sprite: Occupation.TRAVELER,
    hp: 105, maxHp: 105, money: 12, speed: 1.05,
    inventory: [{ defId: 'bread', count: 1 }, { defId: 'cigs', count: 2 }, { defId: 'container_key_label', count: 1 }],
    talkLines: [
      'Кладовая общая, пока дверь закрыта. Открытая кладовая сразу чья-то.',
      'Я не сторож. Я свидетель с хорошей памятью.',
      'Бирку от ключа принесёшь - скажу, какой шкаф пищит тише.',
      'На столе пайка мало и честно. В шкафу больше, но там очередь считает пальцы.',
    ],
    talkLinesPost: [
      'Пайки выдали. Теперь спорят, кому выдали взглядом больше.',
      'Я видел меньше, чем мог. Это тоже услуга.',
    ],
  },
  communal_through_nina: {
    name: 'Нина Сквозная',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.HOUSEWIFE,
    sprite: Occupation.HOUSEWIFE,
    hp: 95, maxHp: 95, money: 18, speed: 0.82,
    inventory: [{ defId: 'bread', count: 1 }, { defId: 'neighbor_complaint', count: 1 }, { defId: 'water_coupon', count: 1 }],
    talkLines: [
      'Коммуналка сквозная: вошёл за хлебом, вышел свидетелем.',
      'У нас три двери и ни одной личной тишины. Зато сирену... слышно раньше всех.',
      'Две буханки в цепочку - и я скажу, какой шкаф открывается без крика.',
      'Не стой в проходной комнате спиной к кухне. Там спор горячее плиты.',
    ],
    talkLinesPost: [
      'Хлеб дошёл до конца цепочки. Сегодня двери хлопают тише.',
      'Если кто спросит про ключевую бирку, ты её нашёл законно. Почти.',
    ],
  },
  communal_primus_yegor: {
    name: 'Егор Примус',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.LOCKSMITH,
    sprite: Occupation.LOCKSMITH,
    hp: 105, maxHp: 105, money: 22, speed: 0.88,
    inventory: [{ defId: 'boiler_water', count: 1 }, { defId: 'tea', count: 1 }, { defId: 'wrench', count: 1 }],
    talkLines: [
      'Примус не сломан. Он ждёт бирку, чтобы решить, кому кипяток.',
      'Сквозная квартира удобная: дым уходит к соседям, жалоба возвращается к тебе.',
      'Бирку вентиля принеси - запущу чайник и не спрошу, откуда пар.',
      'Кухня на проходе честнее комнаты: там видно, кто украл и кто сделал вид.',
    ],
    talkLinesPost: [
      'Кипяток пошёл. Теперь осталось пережить благодарность.',
      'Двери держатся, пока чайник шумит громче очереди.',
    ],
  },
  communal_syndicate_arkhip: {
    name: 'Архип Завхозный',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.STOREKEEPER,
    sprite: Occupation.STOREKEEPER,
    hp: 120, maxHp: 120, money: 85, speed: 0.85,
    inventory: [{ defId: 'water_coupon', count: 5 }, { defId: 'canned', count: 3 }, { defId: 'cigs', count: 5 }],
    talkLines: [
      'Госрезерв велик, да ключи утеряны. А где нет ключа, там решает сводка.',
      'Очередь думает, что паёк падает сверху. Паёк течет там, где я открываю задвижку.',
      'Принеси мне самосборную сводку (samosbor_tally). С этим списком мы быстро докажем домкому, кто здесь хозяин кольца.',
      'По магистральным туннелям рассованы тайники синдиката. Ищи за старыми плакатами, там много дефицита.',
    ],
    talkLinesPost: [
      'Сводки у меня. Теперь паёк распределяется справедливо. То есть, через меня.',
      'Кто ищет в туннелях, тот всегда найдет лишнюю бирку или консервы.',
    ],
  },
  communal_inspector_zoya: {
    name: 'Зоя Управдомша',
    isFemale: true,
    faction: Faction.SCIENTIST,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 110, maxHp: 110, money: 95, speed: 0.9,
    inventory: [{ defId: 'ration_registry_extract', count: 1 }, { defId: 'sterile_bandage', count: 1 }, { defId: 'filtered_water', count: 3 }], // Исправлено с firstaid
    talkLines: [
      'Без строгого учета кольцо задохнется в слухах и грязной воде.',
      'Развелось подпольных мастеров да завхозов. Каждый норовит врезаться в трубу или сорвать пломбу.',
      'Найди выписку из реестра пайков (ration_registry_extract). Вернем железный порядок на этаж.',
      'Будешь спускаться в водоочистку — держи ухо востро. После сирены там завелась слизь и зубастые головы.',
    ],
    talkLinesPost: [
      'Аудит проведен успешно. Нарушители взяты на карандаш.',
      'Чистая вода любит тишину и правильные подписи.',
    ],
  },
};

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, NPC_IDS.luba, NPC_DEFS.communal_laundry_luba, [{
  id: 'communal_clean_bandages',
  giverNpcId: NPC_IDS.luba,
  type: QuestType.FETCH,
  desc: 'Люба Прачечная: «Два рулона ткани - и я отстираю из них бинты до вечерней очереди. Потом машинку опять займут простыни с поста.»',
  targetItem: 'cloth_roll',
  targetCount: 2,
  rewardItem: 'bandage',
  rewardCount: 4,
  extraRewards: [{ defId: 'cleaning_kit', count: 1 }],
  relationDelta: 12,
  xpReward: 35,
  moneyReward: 20,
}]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, NPC_IDS.viktor, NPC_DEFS.communal_shower_viktor, [{
  id: 'communal_shower_pressure',
  giverNpcId: NPC_IDS.viktor,
  type: QuestType.FETCH,
  desc: 'Виктор Напорный: «Две бирки вентиля. Починим душ или спустим воду коллекторам. Выбирай, кто сегодня останется сухим.»',
  targetItem: 'valve_tag',
  targetCount: 2,
  rewardItem: 'filtered_water',
  rewardCount: 2,
  extraRewards: [{ defId: 'pressure_logbook', count: 1 }],
  relationDelta: 10,
  xpReward: 40,
  moneyReward: 25,
}]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, NPC_IDS.tamara, NPC_DEFS.communal_notice_tamara, [{
  id: 'communal_notice_dispute',
  giverNpcId: NPC_IDS.tamara,
  type: QuestType.FETCH,
  desc: 'Тамара Объявление: «Запечатанная жалоба решит, чьё объявление станет официальным: кухня, душ или кладовая.»',
  targetItem: 'sealed_complaint',
  targetCount: 1,
  rewardItem: 'water_coupon',
  rewardCount: 2,
  extraRewards: [{ defId: 'neighbor_complaint', count: 2 }],
  relationDelta: 14,
  xpReward: 35,
  moneyReward: 30,
}]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, NPC_IDS.sasha, NPC_DEFS.communal_panhandler_sasha, [{
  id: 'communal_pantry_theft',
  giverNpcId: NPC_IDS.sasha,
  type: QuestType.FETCH,
  desc: 'Саша У Очереди: «Бирку от ключа принеси. Тогда кладовая откроется как услуга, а не как кража при свидетелях.»',
  targetItem: 'container_key_label',
  targetCount: 1,
  rewardItem: 'canned',
  rewardCount: 2,
  extraRewards: [{ defId: 'bread', count: 3 }, { defId: 'water_coupon', count: 1 }],
  relationDelta: 8,
  xpReward: 35,
  moneyReward: 12,
}]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, NPC_IDS.nina, NPC_DEFS.communal_through_nina, [{
  id: 'communal_through_chain_bread',
  giverNpcId: NPC_IDS.nina,
  type: QuestType.FETCH,
  desc: 'Нина Сквозная: «Две буханки пустим через проходные комнаты. Накормленные соседи чаще держат дверь открытой и реже зовут домкома.»',
  targetItem: 'bread',
  targetCount: 2,
  rewardItem: 'container_key_label',
  rewardCount: 1,
  extraRewards: [{ defId: 'water_coupon', count: 1 }],
  relationDelta: 10,
  xpReward: 35,
  moneyReward: 16,
  eventTags: ['communal_ring', 'through_flat', 'food', 'resident_relief'],
  eventData: { routeChoice: 'feed_through_flat', rumorIds: ['economy_kitchen_stock'] },
}]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, NPC_IDS.yegor, NPC_DEFS.communal_primus_yegor, [{
  id: 'communal_primus_valve',
  giverNpcId: NPC_IDS.yegor,
  type: QuestType.FETCH,
  desc: 'Егор Примус: «Бирку вентиля дай. Починим кипяток в сквозной коммуналке или хотя бы сделаем вид, что очередь управляема.»',
  targetItem: 'valve_tag',
  targetCount: 1,
  rewardItem: 'boiler_water',
  rewardCount: 2,
  extraRewards: [{ defId: 'tea', count: 2 }],
  relationDelta: 9,
  xpReward: 35,
  moneyReward: 18,
  eventTags: ['communal_ring', 'through_flat', 'repair', 'water'],
  eventData: { routeChoice: 'repair_primus', rumorIds: ['maint_steam_valves'] },
}]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, NPC_IDS.arkhip, NPC_DEFS.communal_syndicate_arkhip, [{
  id: 'communal_syndicate_scarcity',
  giverNpcId: NPC_IDS.arkhip,
  type: QuestType.FETCH,
  desc: 'Архип Завхозный: «Принеси мне самосборную сводку (samosbor_tally). С этим списком в руках я смогу прижать официальных распределителей пайка и взять склад под полный контроль.»',
  targetItem: 'samosbor_tally',
  targetCount: 1,
  rewardItem: 'water_coupon',
  rewardCount: 4,
  extraRewards: [{ defId: 'canned', count: 3 }, { defId: 'cigs', count: 5 }],
  relationDelta: 15,
  xpReward: 50,
  moneyReward: 40,
  eventTags: ['communal_ring', 'syndicate', 'pantry', 'black_market'],
  eventData: { routeChoice: 'syndicate_monopoly', rumorIds: ['economy_black_market_88_medicine'] },
}]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, NPC_IDS.zoya, NPC_DEFS.communal_inspector_zoya, [{
  id: 'communal_inspector_audit',
  giverNpcId: NPC_IDS.zoya,
  type: QuestType.FETCH,
  desc: 'Зоя Управдомша: «Мне нужна подлинная выписка из реестра пайков (ration_registry_extract). Прекратим эту вакханалию с подпольной торговлей дефицитом.»',
  targetItem: 'ration_registry_extract',
  targetCount: 1,
  rewardItem: 'sterile_bandage',
  rewardCount: 1,
  extraRewards: [{ defId: 'filtered_water', count: 3 }, { defId: 'bandage', count: 2 }],
  relationDelta: 15,
  xpReward: 50,
  moneyReward: 50,
  eventTags: ['communal_ring', 'official_audit', 'domkom', 'law_and_order'],
  eventData: { routeChoice: 'domkom_enforcement', rumorIds: ['economy_ruble_soft'] },
}]);
interface RingLayout {
  left: number;
  right: number;
  top: number;
  bottom: number;
  innerLeft: number;
  innerRight: number;
  innerTop: number;
  innerBottom: number;
  width: number;
  spawnX: number;
  spawnY: number;
}

interface ThroughFlat {
  name: string;
  rooms: Room[];
}

interface CommunalServiceRooms {
  laundry: Room;
  kitchen: Room;
  shower: Room;
  pantry: Room;
  notice: Room;
  smoking: Room;
  core: Room;
}

interface CommunalRooms extends CommunalServiceRooms {
  flats: ThroughFlat[];
}

type OwnerKey = keyof typeof NPC_IDS;

export function generateCommunalRingDesignFloor(seed = RING_SEED): FloorGeneration {
  return withSeededRandom(seed, () => {
    const world = new World();
    const entities: Entity[] = [];
    const nextId = { v: 1 };
    const containerId = { v: 1 };

    const ring = carveRing(world);
    const serviceRooms = buildServiceRooms(world, ring);
    const rooms: CommunalRooms = {
      ...serviceRooms,
      flats: buildThroughCommunalFlats(world, ring),
    };
    fillCommunalVoids(world, entities, nextId, containerId, ring);
    generateZones(world);
    applyCommunalZones(world);
    placeRingLifts(world, ring);
    decorateRing(world, ring, rooms);
    const owners = spawnCommunalNpcSet(entities, nextId, rooms);
    spawnWitnesses(entities, nextId, rooms);
    spawnThroughFlatResidents(entities, nextId, rooms.flats);
    spawnCommunalQueueCrowd(entities, nextId, rooms);
    placeServiceContainers(world, containerId, rooms, owners);
    placeThroughFlatContainers(world, containerId, rooms.flats, owners);
    placeLooseSupplies(world, entities, nextId, rooms);
    applySamosborAftermath(world, entities, nextId, rooms);

    sanitizeDoors(world);
    ensureConnectivity(world, ring.spawnX, ring.spawnY);
    world.bakeLights();

    return { world, entities, spawnX: ring.spawnX, spawnY: ring.spawnY };
  });
}

function carveRing(world: World): RingLayout {
  const cx = W / 2;
  const cy = W / 2;
  const width = 4;
  const left = cx - 70;
  const right = cx + 66;
  const top = cy - 52;
  const bottom = cy + 48;
  const innerLeft = cx - 38;
  const innerRight = cx + 35;
  const innerTop = cy - 26;
  const innerBottom = cy + 23;

  carveCorridorLoop(world, left, right, top, bottom, width, Tex.F_LINO);
  carveCorridorLoop(world, innerLeft, innerRight, innerTop, innerBottom, 3, Tex.F_LINO);

  carveLineWidth(world, cx, top + width, cx, innerTop - 1, 3, Tex.F_LINO);
  carveLineWidth(world, cx + 12, innerBottom + 3, cx + 12, bottom - 1, 3, Tex.F_LINO);
  carveLineWidth(world, left + width, cy - 2, innerLeft - 1, cy - 2, 3, Tex.F_LINO);
  carveLineWidth(world, innerRight + 3, cy + 6, right - 1, cy + 6, 3, Tex.F_LINO);
  carveLineWidth(world, innerLeft + 4, innerTop + 6, innerRight - 4, innerTop + 6, 1, Tex.F_CONCRETE);
  carveLineWidth(world, innerLeft + 8, innerBottom - 7, innerRight - 2, innerBottom - 7, 1, Tex.F_CONCRETE);
  carveCourtyardVoid(world, cx - 13, cy - 7, 27, 14);
  placeCorridorPinch(world, left + 34, bottom, width, 2);
  placeCorridorPinch(world, right - 30, top, width, 1);

  return {
    left,
    right,
    top,
    bottom,
    innerLeft,
    innerRight,
    innerTop,
    innerBottom,
    width,
    spawnX: left + 8.5,
    spawnY: top + 1.5,
  };
}

function carveCorridorLoop(world: World, left: number, right: number, top: number, bottom: number, width: number, floorTex: Tex): void {
  for (let x = left; x <= right + width - 1; x++) {
    carveCorridorCell(world, x, top, width, false, floorTex);
    carveCorridorCell(world, x, bottom, width, false, floorTex);
  }
  for (let y = top; y <= bottom + width - 1; y++) {
    carveCorridorCell(world, left, y, width, true, floorTex);
    carveCorridorCell(world, right, y, width, true, floorTex);
  }
}

function carveCorridorCell(world: World, x: number, y: number, width: number, vertical = false, floorTex = Tex.F_LINO): void {
  for (let n = 0; n < width; n++) {
    const wx = vertical ? x + n : x;
    const wy = vertical ? y : y + n;
    carveFloorCell(world, wx, wy, floorTex);
  }
}

function carveLineWidth(world: World, ax: number, ay: number, bx: number, by: number, width: number, floorTex: Tex): void {
  if (ax !== bx && ay !== by) {
    carveLineWidth(world, ax, ay, bx, ay, width, floorTex);
    carveLineWidth(world, bx, ay, bx, by, width, floorTex);
    return;
  }
  const half = Math.floor(width / 2);
  const from = ax === bx ? Math.min(ay, by) : Math.min(ax, bx);
  const to = ax === bx ? Math.max(ay, by) : Math.max(ax, bx);
  for (let p = from; p <= to; p++) {
    for (let n = 0; n < width; n++) {
      const o = n - half;
      carveFloorCell(world, ax === bx ? ax + o : p, ax === bx ? p : ay + o, floorTex);
    }
  }
}

function carveFloorCell(world: World, x: number, y: number, floorTex: Tex): void {
  const i = world.idx(x, y);
  world.cells[i] = Cell.FLOOR;
  world.roomMap[i] = -1;
  world.floorTex[i] = floorTex;
  world.factionControl[i] = ZoneFaction.CITIZEN;
}

function carveCourtyardVoid(world: World, x: number, y: number, w: number, h: number): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const i = world.idx(x + dx, y + dy);
      world.cells[i] = Cell.ABYSS;
      world.roomMap[i] = -1;
      world.wallTex[i] = Tex.DARK;
      world.floorTex[i] = Tex.F_ABYSS;
      world.features[i] = Feature.NONE;
    }
  }
}

function placeCorridorPinch(world: World, x: number, y: number, width: number, gapOffset: number): void {
  for (let dy = 0; dy < width; dy++) {
    if (dy === gapOffset) continue;
    const i = world.idx(x, y + dy);
    if (world.cells[i] !== Cell.FLOOR) continue;
    world.cells[i] = Cell.WALL;
    world.roomMap[i] = -1;
    world.wallTex[i] = Tex.BRICK;
    world.features[i] = Feature.NONE;
  }
}

function buildServiceRooms(world: World, ring: RingLayout): CommunalServiceRooms {
  let id = 0;
  const kitchen = createRoom(world, id++, RoomType.KITCHEN, W / 2 - 31, ring.top - 11, 21, 10, 'Общая кухня с двумя плитами', Tex.TILE_W, Tex.F_TILE);
  connectRoomToCorridor(world, kitchen, kitchen.x + 10, kitchen.y + kitchen.h, DoorState.CLOSED);

  const laundry = createRoom(world, id++, RoomType.PRODUCTION, ring.left - 17, W / 2 - 22, 16, 12, 'Прачечная после самосбора', Tex.TILE_W, Tex.F_TILE);
  connectRoomToCorridor(world, laundry, laundry.x + laundry.w, laundry.y + 6, DoorState.CLOSED);

  const shower = createRoom(world, id++, RoomType.BATHROOM, ring.right + ring.width + 1, W / 2 - 20, 15, 13, 'Душевая слабого напора', Tex.TILE_W, Tex.F_WATER);
  connectRoomToCorridor(world, shower, shower.x - 1, shower.y + 6, DoorState.CLOSED);

  const pantry = createRoom(world, id++, RoomType.STORAGE, W / 2 - 9, ring.bottom + ring.width + 1, 22, 10, 'Паёчная кладовая', Tex.PANEL, Tex.F_CONCRETE);
  connectRoomToCorridor(world, pantry, pantry.x + 11, pantry.y - 1, DoorState.LOCKED, 'container_key_label');

  const notice = createRoom(world, id++, RoomType.OFFICE, ring.right - 34, ring.top + 11, 18, 9, 'Бюро доски объявлений', Tex.PANEL, Tex.F_LINO);
  carveShortCorridor(world, notice.x + 9, ring.top + ring.width, notice.x + 9, notice.y - 2);
  connectRoomToCorridor(world, notice, notice.x + 9, notice.y - 1, DoorState.CLOSED);

  const smoking = createRoom(world, id++, RoomType.SMOKING, ring.left + 9, ring.bottom + ring.width + 14, 17, 8, 'Курилка свидетелей у кольца', Tex.PANEL, Tex.F_LINO);
  carveShortCorridor(world, smoking.x + 8, ring.bottom + ring.width, smoking.x + 8, smoking.y - 2);
  connectRoomToCorridor(world, smoking, smoking.x + 8, smoking.y - 1, DoorState.CLOSED);

  const core = createRoom(world, id++, RoomType.PRODUCTION, W / 2 - 10, ring.innerBottom + 8, 20, 10, 'Сервисное ядро двора', Tex.PIPE, Tex.F_CONCRETE);
  carveLineWidth(world, core.x + 10, ring.innerBottom + 3, core.x + 10, core.y - 2, 2, Tex.F_CONCRETE);
  connectRoomToCorridor(world, core, core.x + 10, core.y - 1, DoorState.CLOSED);

  return { laundry, kitchen, shower, pantry, notice, smoking, core };
}

interface ThroughFlatSpec {
  name: string;
  x: number;
  y: number;
  horizontal: boolean;
  entryX: number;
  entryY: number;
  exitX: number;
  exitY: number;
}

const THROUGH_FLAT_TYPES: readonly RoomType[] = [
  RoomType.LIVING,
  RoomType.KITCHEN,
  RoomType.LIVING,
  RoomType.BATHROOM,
  RoomType.LIVING,
];

function buildThroughCommunalFlats(world: World, ring: RingLayout): ThroughFlat[] {
  const specs: readonly ThroughFlatSpec[] = [
    {
      name: 'Северная сквозная коммуналка',
      x: ring.left + 22,
      y: ring.top - 35,
      horizontal: true,
      entryX: ring.left + 12,
      entryY: ring.top + 1,
      exitX: ring.right - 10,
      exitY: ring.top + 1,
    },
    {
      name: 'Южная сквозная коммуналка',
      x: ring.left + 36,
      y: ring.bottom + 22,
      horizontal: true,
      entryX: ring.left + 18,
      entryY: ring.bottom + 2,
      exitX: ring.right - 25,
      exitY: ring.bottom + 2,
    },
    {
      name: 'Западная сквозная коммуналка',
      x: ring.left - 37,
      y: ring.top + 10,
      horizontal: false,
      entryX: ring.left + 1,
      entryY: ring.top + 16,
      exitX: ring.left + 1,
      exitY: ring.bottom - 18,
    },
    {
      name: 'Восточная сквозная коммуналка',
      x: ring.right + ring.width + 28,
      y: ring.top + 18,
      horizontal: false,
      entryX: ring.right + 2,
      entryY: ring.top + 28,
      exitX: ring.right + 2,
      exitY: ring.bottom - 12,
    },
  ];
  const flats: ThroughFlat[] = [];
  for (const spec of specs) flats.push(addThroughCommunalFlat(world, spec));
  return flats;
}

function addThroughCommunalFlat(world: World, spec: ThroughFlatSpec): ThroughFlat {
  const roomW = 8;
  const roomH = 7;
  const rooms: Room[] = [];
  for (let i = 0; i < THROUGH_FLAT_TYPES.length; i++) {
    const type = THROUGH_FLAT_TYPES[i];
    const x = spec.horizontal ? spec.x + i * (roomW + 1) : spec.x;
    const y = spec.horizontal ? spec.y : spec.y + i * (roomH + 1);
    const tile = type === RoomType.KITCHEN || type === RoomType.BATHROOM;
    const floorTex = type === RoomType.BATHROOM ? Tex.F_TILE : type === RoomType.KITCHEN ? Tex.F_LINO : Tex.F_WOOD;
    const wallTex = tile ? Tex.TILE_W : Tex.PANEL;
    const room = createRoom(world, world.rooms.length, type, x, y, roomW, roomH, `${spec.name}: ${throughFlatRoomName(type, i)}`, wallTex, floorTex);
    decorateThroughFlatRoom(world, room, i);
    if (rooms.length > 0) connectAdjacentFlatRooms(world, rooms[rooms.length - 1], room, spec.horizontal);
    rooms.push(room);
  }

  const first = rooms[0];
  const last = rooms[rooms.length - 1];
  connectThroughFlatEnd(world, first, spec.horizontal ? 'west' : 'north', spec.entryX, spec.entryY);
  connectThroughFlatEnd(world, last, spec.horizontal ? 'east' : 'south', spec.exitX, spec.exitY);
  return { name: spec.name, rooms };
}

function throughFlatRoomName(type: RoomType, index: number): string {
  if (type === RoomType.KITCHEN) return 'кухня на проходе';
  if (type === RoomType.BATHROOM) return 'санузел у второй двери';
  return index === 0 ? 'первая жилая' : index === THROUGH_FLAT_TYPES.length - 1 ? 'выходная жилая' : 'средняя жилая';
}

function decorateThroughFlatRoom(world: World, room: Room, index: number): void {
  if (room.type === RoomType.KITCHEN) {
    placeFeature(world, room.x + 2, room.y + 2, Feature.STOVE);
    placeFeature(world, room.x + 5, room.y + 2, Feature.SINK);
    placeFeature(world, room.x + 4, room.y + 5, Feature.TABLE);
    return;
  }
  if (room.type === RoomType.BATHROOM) {
    placeFeature(world, room.x + 2, room.y + 2, Feature.TOILET);
    placeFeature(world, room.x + 5, room.y + 2, Feature.SINK);
    return;
  }
  placeFeature(world, room.x + 2, room.y + 2, Feature.BED);
  placeFeature(world, room.x + 5, room.y + 4, index % 2 === 0 ? Feature.TABLE : Feature.SHELF);
  if (index === 0) placeFeature(world, room.x + 5, room.y + 2, Feature.LAMP);
}

function connectAdjacentFlatRooms(world: World, a: Room, b: Room, horizontal: boolean): void {
  const x = horizontal ? a.x + a.w : a.x + (a.w >> 1);
  const y = horizontal ? a.y + (a.h >> 1) : a.y + a.h;
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.DOOR;
  world.wallTex[idx] = Tex.DOOR_WOOD;
  world.doors.set(idx, {
    idx,
    state: DoorState.CLOSED,
    roomA: a.id,
    roomB: b.id,
    keyId: '',
    timer: 0,
  });
  a.doors.push(idx);
  b.doors.push(idx);
}

function connectThroughFlatEnd(world: World, room: Room, side: 'west' | 'east' | 'north' | 'south', targetX: number, targetY: number): void {
  let doorX = room.x + (room.w >> 1);
  let doorY = room.y + (room.h >> 1);
  let outX = doorX;
  let outY = doorY;
  if (side === 'west') {
    doorX = room.x - 1;
    outX = doorX - 1;
  } else if (side === 'east') {
    doorX = room.x + room.w;
    outX = doorX + 1;
  } else if (side === 'north') {
    doorY = room.y - 1;
    outY = doorY - 1;
  } else {
    doorY = room.y + room.h;
    outY = doorY + 1;
  }
  if (side === 'west' || side === 'east') {
    doorY = room.y + (room.h >> 1);
    outY = doorY;
  } else {
    doorX = room.x + (room.w >> 1);
    outX = doorX;
  }
  connectRoomToCorridor(world, room, doorX, doorY, DoorState.CLOSED);
  carveLineWidth(world, outX, outY, targetX, targetY, 1, Tex.F_LINO);
}

function createRoom(
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
  const room = stampRoom(world, id, type, Math.floor(x), Math.floor(y), w, h, -1);
  room.name = name;
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const i = world.idx(room.x + dx, room.y + dy);
      if (world.cells[i] === Cell.WALL) world.wallTex[i] = wallTex;
    }
  }
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      world.floorTex[world.idx(room.x + dx, room.y + dy)] = floorTex;
    }
  }
  return room;
}

function connectRoomToCorridor(world: World, room: Room, x: number, y: number, state: DoorState, keyId = ''): void {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.DOOR;
  world.wallTex[idx] = Tex.DOOR_WOOD;
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

function carveShortCorridor(world: World, ax: number, ay: number, bx: number, by: number): void {
  const stepX = ax === bx ? 0 : ax < bx ? 1 : -1;
  const stepY = ay === by ? 0 : ay < by ? 1 : -1;
  let x = ax;
  let y = ay;
  for (let guard = 0; guard < 80; guard++) {
    const i = world.idx(x, y);
    if (world.cells[i] === Cell.WALL) {
      world.cells[i] = Cell.FLOOR;
      world.roomMap[i] = -1;
      world.floorTex[i] = Tex.F_LINO;
    }
    if (x === bx && y === by) break;
    x += stepX;
    y += stepY;
  }
}

function applyCommunalZones(world: World): void {
  for (const zone of world.zones) {
    zone.faction = ZoneFaction.CITIZEN;
    zone.level = 2;
    zone.fogged = false;
    zone.hasLift = zone.id % 17 === 0;
  }
  for (let i = 0; i < world.factionControl.length; i++) {
    world.factionControl[i] = world.zones[world.zoneMap[i]]?.faction ?? ZoneFaction.CITIZEN;
  }
}

function placeRingLifts(world: World, ring: RingLayout): void {
  placeLift(world, ring.left + 2, ring.top + 1, ring.left + 5, ring.top + 1, LiftDirection.UP);
  placeLift(world, ring.right + 1, ring.bottom + 2, ring.right - 2, ring.bottom + 2, LiftDirection.DOWN);
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

function decorateRing(world: World, ring: RingLayout, rooms: CommunalRooms): void {
  placeFeature(world, ring.left + 7, ring.top + 1, Feature.SCREEN);
  placeFeature(world, ring.right - 4, ring.top + 1, Feature.LAMP);
  placeFeature(world, ring.left + 1, ring.bottom + 1, Feature.TABLE);
  placeFeature(world, ring.right + 2, ring.bottom + 2, Feature.SHELF);
  placeFeature(world, ring.innerLeft + 5, ring.innerTop + 1, Feature.CANDLE);
  placeFeature(world, ring.innerRight - 4, ring.innerBottom + 1, Feature.LAMP);
  placeFeature(world, ring.left + 33, ring.bottom + 2, Feature.SHELF);
  placeFeature(world, ring.right - 29, ring.top + 2, Feature.TABLE);

  for (let x = rooms.kitchen.x + 2; x < rooms.kitchen.x + rooms.kitchen.w - 2; x += 4) placeFeature(world, x, rooms.kitchen.y + 2, Feature.STOVE);
  for (let x = rooms.kitchen.x + 3; x < rooms.kitchen.x + rooms.kitchen.w - 2; x += 5) placeFeature(world, x, rooms.kitchen.y + 6, Feature.TABLE);
  placeFeature(world, rooms.kitchen.x + 1, rooms.kitchen.y + 1, Feature.SINK);

  for (let y = rooms.laundry.y + 2; y < rooms.laundry.y + rooms.laundry.h - 2; y += 3) placeFeature(world, rooms.laundry.x + 3, y, Feature.MACHINE);
  placeFeature(world, rooms.laundry.x + rooms.laundry.w - 3, rooms.laundry.y + 2, Feature.SINK);
  placeFeature(world, rooms.laundry.x + rooms.laundry.w - 4, rooms.laundry.y + rooms.laundry.h - 3, Feature.SHELF);

  for (let x = rooms.shower.x + 2; x < rooms.shower.x + rooms.shower.w - 2; x += 4) placeFeature(world, x, rooms.shower.y + 2, Feature.SINK);
  for (let x = rooms.shower.x + 3; x < rooms.shower.x + rooms.shower.w - 2; x += 4) placeFeature(world, x, rooms.shower.y + rooms.shower.h - 3, Feature.TOILET);

  for (let x = rooms.pantry.x + 2; x < rooms.pantry.x + rooms.pantry.w - 2; x += 3) placeFeature(world, x, rooms.pantry.y + 2, Feature.SHELF);
  for (let x = rooms.pantry.x + 3; x < rooms.pantry.x + rooms.pantry.w - 2; x += 4) placeFeature(world, x, rooms.pantry.y + 6, Feature.SHELF);

  placeFeature(world, rooms.notice.x + 3, rooms.notice.y + 2, Feature.DESK);
  placeFeature(world, rooms.notice.x + 9, rooms.notice.y + 2, Feature.SCREEN);
  placeFeature(world, rooms.notice.x + 14, rooms.notice.y + 5, Feature.SHELF);

  placeFeature(world, rooms.smoking.x + 3, rooms.smoking.y + 2, Feature.TABLE);
  placeFeature(world, rooms.smoking.x + 6, rooms.smoking.y + 3, Feature.CHAIR);
  placeFeature(world, rooms.smoking.x + 10, rooms.smoking.y + 3, Feature.CANDLE);
  placeFeature(world, rooms.smoking.x + 14, rooms.smoking.y + 5, Feature.SHELF);

  placeFeature(world, rooms.core.x + 3, rooms.core.y + 2, Feature.MACHINE);
  placeFeature(world, rooms.core.x + 8, rooms.core.y + 5, Feature.APPARATUS);
  placeFeature(world, rooms.core.x + 13, rooms.core.y + 3, Feature.SCREEN);
  placeFeature(world, rooms.core.x + 17, rooms.core.y + 7, Feature.SHELF);

  markPosterWall(world, rooms.notice.x + 7, rooms.notice.y - 1, 8);
  markPosterWall(world, rooms.kitchen.x + 8, rooms.kitchen.y + rooms.kitchen.h, 12);
  markPosterWall(world, rooms.pantry.x + 9, rooms.pantry.y - 1, 17);
  markPosterWall(world, rooms.smoking.x + 8, rooms.smoking.y - 1, 21);
  markPosterWall(world, rooms.core.x + 4, rooms.core.y - 1, 23);
}

function placeFeature(world: World, x: number, y: number, feature: Feature): void {
  const i = world.idx(x, y);
  if (world.cells[i] === Cell.FLOOR || world.cells[i] === Cell.WATER) world.features[i] = feature;
}

function markPosterWall(world: World, x: number, y: number, n: number): void {
  const i = world.idx(x, y);
  if (world.cells[i] === Cell.WALL) world.wallTex[i] = (Tex.POSTER_BASE + (n % 64)) as Tex;
}

function spawnCommunalNpcSet(entities: Entity[], nextId: { v: number }, rooms: CommunalRooms): Record<OwnerKey, number> {
  const northFlat = rooms.flats[0]?.rooms[0] ?? rooms.kitchen;
  const southFlat = rooms.flats[1]?.rooms[1] ?? rooms.core;
  const owners = {
    luba: spawnNpc(entities, nextId, NPC_DEFS.communal_laundry_luba, NPC_IDS.luba, rooms.laundry.x + 6, rooms.laundry.y + 5),
    viktor: spawnNpc(entities, nextId, NPC_DEFS.communal_shower_viktor, NPC_IDS.viktor, rooms.shower.x + 5, rooms.shower.y + 6, 'wrench'),
    tamara: spawnNpc(entities, nextId, NPC_DEFS.communal_notice_tamara, NPC_IDS.tamara, rooms.notice.x + 4, rooms.notice.y + 4),
    sasha: spawnNpc(entities, nextId, NPC_DEFS.communal_panhandler_sasha, NPC_IDS.sasha, rooms.pantry.x + 11, rooms.pantry.y - 3, 'knife'),
    nina: spawnNpc(entities, nextId, NPC_DEFS.communal_through_nina, NPC_IDS.nina, northFlat.x + 3, northFlat.y + 3),
    yegor: spawnNpc(entities, nextId, NPC_DEFS.communal_primus_yegor, NPC_IDS.yegor, southFlat.x + 4, southFlat.y + 3, 'wrench'),
    arkhip: spawnNpc(entities, nextId, NPC_DEFS.communal_syndicate_arkhip, NPC_IDS.arkhip, 120 + 12, 60 + 10, 'pistol'),
    zoya: spawnNpc(entities, nextId, NPC_DEFS.communal_inspector_zoya, NPC_IDS.zoya, rooms.core.x + 10, rooms.core.y - 4),
  };
  return owners;
}

function spawnNpc(
  entities: Entity[],
  nextId: { v: number },
  _npc: PlotNpcDef,
  plotNpcId: string,
  x: number,
  y: number,
  weapon?: string,
): number {
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle: Math.random() * Math.PI * 2,
    weapon,
    canGiveQuest: true,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
  });
  return npc.id;
}

function spawnWitnesses(entities: Entity[], nextId: { v: number }, rooms: CommunalRooms): void {
  spawnAmbientNpc(entities, nextId, 'Дежурная у кладовой', Faction.CITIZEN, Occupation.STOREKEEPER, rooms.pantry.x + 2, rooms.pantry.y - 3, [{ defId: 'note', count: 1 }]);
  spawnAmbientNpc(entities, nextId, 'Очередник с тазом', Faction.CITIZEN, Occupation.TRAVELER, rooms.laundry.x + rooms.laundry.w + 3, rooms.laundry.y + 6, [{ defId: 'cloth_roll', count: 1 }]);
  spawnAmbientNpc(entities, nextId, 'Повар у второй плиты', Faction.CITIZEN, Occupation.COOK, rooms.kitchen.x + 15, rooms.kitchen.y + 5, [{ defId: 'kasha', count: 2 }], 'knife');
  spawnAmbientNpc(entities, nextId, 'Слесарь душевой очереди', Faction.LIQUIDATOR, Occupation.MECHANIC, rooms.shower.x - 3, rooms.shower.y + 7, [{ defId: 'valve_tag', count: 1 }], 'wrench');
  spawnAmbientNpc(entities, nextId, 'Курящий свидетель', Faction.WILD, Occupation.ALCOHOLIC, rooms.smoking.x + 8, rooms.smoking.y + 4, [{ defId: 'cigs', count: 2 }, { defId: 'neighbor_complaint', count: 1 }]);
}

function spawnThroughFlatResidents(entities: Entity[], nextId: { v: number }, flats: readonly ThroughFlat[]): void {
  const names = [
    'Жилец у первой двери',
    'Соседка с кастрюлей',
    'Свидетель у санузла',
    'Старший по проходу',
  ];
  for (let i = 0; i < flats.length; i++) {
    const flat = flats[i];
    const room = flat.rooms[(i + 2) % flat.rooms.length];
    spawnAmbientNpc(
      entities,
      nextId,
      `${names[i % names.length]}: ${flat.name}`,
      Faction.CITIZEN,
      i % 2 === 0 ? Occupation.TRAVELER : Occupation.HOUSEWIFE,
      room.x + 3,
      room.y + 3,
      [{ defId: i % 2 === 0 ? 'bread' : 'neighbor_complaint', count: 1 }],
    );
  }
}

function spawnCommunalQueueCrowd(entities: Entity[], nextId: { v: number }, rooms: CommunalRooms): void {
  const spots: readonly { name: string; faction: Faction; occupation: Occupation; x: number; y: number; item: string }[] = [
    { name: 'Очередница у паечного стола', faction: Faction.CITIZEN, occupation: Occupation.HOUSEWIFE, x: rooms.pantry.x + 5, y: rooms.pantry.y - 3, item: 'water_coupon' },
    { name: 'Сосед с пустой банкой', faction: Faction.CITIZEN, occupation: Occupation.TRAVELER, x: rooms.pantry.x + 8, y: rooms.pantry.y - 3, item: 'bread' },
    { name: 'Дежурный по списку пайка', faction: Faction.CITIZEN, occupation: Occupation.SECRETARY, x: rooms.pantry.x + 14, y: rooms.pantry.y - 3, item: 'ration_registry_extract' },
    { name: 'Свидетельница у замка', faction: Faction.CITIZEN, occupation: Occupation.STOREKEEPER, x: rooms.pantry.x + 18, y: rooms.pantry.y - 2, item: 'note' },
    { name: 'Повар с чужой кружкой', faction: Faction.CITIZEN, occupation: Occupation.COOK, x: rooms.kitchen.x + 6, y: rooms.kitchen.y + rooms.kitchen.h + 2, item: 'tea' },
    { name: 'Сосед у второй плиты', faction: Faction.CITIZEN, occupation: Occupation.TRAVELER, x: rooms.kitchen.x + 12, y: rooms.kitchen.y + rooms.kitchen.h + 2, item: 'kasha' },
    { name: 'Старшая по кипятку', faction: Faction.CITIZEN, occupation: Occupation.HOUSEWIFE, x: rooms.kitchen.x + 18, y: rooms.kitchen.y + rooms.kitchen.h + 2, item: 'boiler_water' },
    { name: 'Слесарь без бирки', faction: Faction.LIQUIDATOR, occupation: Occupation.MECHANIC, x: rooms.shower.x - 3, y: rooms.shower.y + 3, item: 'valve_tag' },
    { name: 'Мокрый очередник', faction: Faction.CITIZEN, occupation: Occupation.TRAVELER, x: rooms.shower.x - 3, y: rooms.shower.y + 9, item: 'toiletpaper' },
    { name: 'Тамарин свидетель', faction: Faction.SCIENTIST, occupation: Occupation.SECRETARY, x: rooms.notice.x + 9, y: rooms.notice.y + rooms.notice.h + 2, item: 'neighbor_complaint' },
    { name: 'Молчаливый возле ядра', faction: Faction.CITIZEN, occupation: Occupation.LOCKSMITH, x: rooms.core.x + 4, y: rooms.core.y - 3, item: 'cleaning_kit' },
    { name: 'Последний в кольце', faction: Faction.CITIZEN, occupation: Occupation.TRAVELER, x: rooms.core.x + 14, y: rooms.core.y - 3, item: 'bread' },
  ];
  for (let i = 0; i < Math.min(COMMUNAL_QUEUE_CROWD_CAP, spots.length); i++) {
    const spot = spots[i];
    spawnAmbientNpc(
      entities,
      nextId,
      spot.name,
      spot.faction,
      spot.occupation,
      spot.x,
      spot.y,
      [{ defId: spot.item, count: 1 }],
      spot.faction === Faction.LIQUIDATOR ? 'wrench' : undefined,
    );
  }
}

function spawnAmbientNpc(
  entities: Entity[],
  nextId: { v: number },
  name: string,
  faction: Faction,
  occupation: Occupation,
  x: number,
  y: number,
  inventory: Item[],
  weapon?: string,
): void {
  entities.push({
    id: nextId.v++,
    type: EntityType.NPC,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: 0.85,
    sprite: occupation,
    name,
    needs: freshNeeds(),
    hp: 80,
    maxHp: 80,
    money: 5 + Math.floor(Math.random() * 16),
    ai: { goal: AIGoal.IDLE, tx: x + 0.5, ty: y + 0.5, path: [], pi: 0, stuck: 0, timer: 0 },
    inventory: inventory.map(item => ({ ...item })),
    weapon,
    faction,
    occupation,
    questId: -1,
  });
}

function placeServiceContainers(
  world: World,
  containerId: { v: number },
  rooms: CommunalRooms,
  owners: Record<OwnerKey, number>,
): void {
  addContainer(world, containerId, rooms.laundry, 11, 8, ContainerKind.METAL_CABINET, 'Шкаф чистой ткани', [
    { defId: 'cloth_roll', count: 3 },
    { defId: 'bandage', count: 2 },
    { defId: 'cleaning_kit', count: 1 },
  ], 'owner', owners.luba, NPC_DEFS.communal_laundry_luba.name, ['laundry', 'cloth']);

  addContainer(world, containerId, rooms.kitchen, 17, 2, ContainerKind.FRIDGE, 'Общий холодильник с подписанными полками', [
    { defId: 'kasha', count: 3 },
    { defId: 'water', count: 3 },
    { defId: 'tea', count: 2 },
  ], 'room', undefined, undefined, ['kitchen', 'shared']);

  addContainer(world, containerId, rooms.shower, 11, 7, ContainerKind.TOOL_LOCKER, 'Ящик вентильных бирок', [
    { defId: 'valve_tag', count: 2 },
    { defId: 'wrench', count: 1 },
    { defId: 'pressure_logbook', count: 1 },
  ], 'owner', owners.viktor, NPC_DEFS.communal_shower_viktor.name, ['shower', 'pressure', 'tools']);

  addContainer(world, containerId, rooms.pantry, 17, 6, ContainerKind.METAL_CABINET, 'Паёчный шкаф под взглядом очереди', [
    { defId: 'canned', count: 4 },
    { defId: 'bread', count: 5 },
    { defId: 'water_coupon', count: 2 },
    { defId: 'ration_registry_extract', count: 1 },
  ], 'owner', owners.sasha, NPC_DEFS.communal_panhandler_sasha.name, ['pantry', 'food', 'witnessed']);

  addContainer(world, containerId, rooms.pantry, 4, 6, ContainerKind.EMERGENCY_BOX, 'Лимитированный стол пайка', [
    { defId: 'bread', count: 1 },
    { defId: 'water_coupon', count: 1 },
  ], 'public', undefined, undefined, ['pantry', 'scarcity', 'ration_limit', 'legal_supply', 'resident_relief']);

  addContainer(world, containerId, rooms.notice, 13, 5, ContainerKind.FILING_CABINET, 'Картотека спорных объявлений', [
    { defId: 'sealed_complaint', count: 2 },
    { defId: 'neighbor_complaint', count: 3 },
    { defId: 'samosbor_tally', count: 1 },
    { defId: 'shelter_tally', count: 1 },
  ], 'owner', owners.tamara, NPC_DEFS.communal_notice_tamara.name, ['notice', 'paper']);

  addContainer(world, containerId, rooms.notice, 5, 6, ContainerKind.FILING_CABINET, 'Щель публичной доски для улик', [], 'public', undefined, undefined, [
    'notice',
    'paper',
    'evidence_drop',
    'expose',
    'communal_ring',
  ]);

  addContainer(world, containerId, rooms.smoking, 13, 5, ContainerKind.WOODEN_CHEST, 'Жестянка курилки с чужими жалобами', [
    { defId: 'cigs', count: 4 },
    { defId: 'neighbor_complaint', count: 2 },
    { defId: 'container_key_label', count: 1 },
  ], 'room', undefined, undefined, ['smoking', 'grievance', 'witness']);

  addContainer(world, containerId, rooms.smoking, 3, 5, ContainerKind.SECRET_STASH, 'Тайник за мокрым плакатом курилки', [], 'secret', undefined, undefined, [
    'smoking',
    'grievance',
    'shelter_tally',
    'secret',
    'hide',
    'communal_ring',
  ]);

  addContainer(world, containerId, rooms.kitchen, 11, 7, ContainerKind.WOODEN_CHEST, 'Меновая полка общей кухни', [
    { defId: 'bread', count: 2 },
    { defId: 'tea', count: 2 },
    { defId: 'water_coupon', count: 1 },
  ], 'faction', undefined, undefined, ['kitchen', 'trade', 'buyable', 'communal_ring']);
}

function placeThroughFlatContainers(
  world: World,
  containerId: { v: number },
  flats: readonly ThroughFlat[],
  owners: Record<OwnerKey, number>,
): void {
  for (let i = 0; i < flats.length; i++) {
    const flat = flats[i];
    const room = flat.rooms[Math.min(2, flat.rooms.length - 1)];
    const ownerId = i === 0 ? owners.nina : i === 1 ? owners.yegor : undefined;
    const ownerName = i === 0
      ? NPC_DEFS.communal_through_nina.name
      : i === 1
        ? NPC_DEFS.communal_primus_yegor.name
        : undefined;
    addContainer(world, containerId, room, 5, 5, i % 2 === 0 ? ContainerKind.WOODEN_CHEST : ContainerKind.METAL_CABINET, `${flat.name}: общий шкаф у прохода`, [
      { defId: 'bread', count: 1 + (i % 2) },
      { defId: 'tea', count: 1 },
      { defId: i === 1 ? 'valve_tag' : 'neighbor_complaint', count: 1 },
    ], ownerId === undefined ? 'room' : 'owner', ownerId, ownerName, ['communal_ring', 'through_flat', 'shared_home']);
  }
}

function addContainer(
  world: World,
  containerId: { v: number },
  room: Room,
  dx: number,
  dy: number,
  kind: ContainerKind,
  name: string,
  inventory: Item[],
  access: WorldContainer['access'],
  ownerNpcId: number | undefined,
  ownerName: string | undefined,
  tags: string[],
): void {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const container: WorldContainer = {
    id: containerId.v++,
    x,
    y,
    floor: BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind,
    name,
    inventory: inventory.map(item => ({ ...item })),
    capacitySlots: 10,
    ownerNpcId,
    ownerName,
    faction: ownerNpcId === undefined ? Faction.CITIZEN : undefined,
    access,
    discovered: true,
    tags,
  };
  world.addContainer(container);
}

function placeLooseSupplies(world: World, entities: Entity[], nextId: { v: number }, rooms: CommunalRooms): void {
  placeDrop(world, entities, nextId, rooms.kitchen, 4, 4, 'kasha', 1);
  placeDrop(world, entities, nextId, rooms.kitchen, 8, 6, 'tea', 1);
  placeDrop(world, entities, nextId, rooms.laundry, 5, 8, 'cloth_roll', 1);
  placeDrop(world, entities, nextId, rooms.shower, 3, 9, 'toiletpaper', 1);
  placeDrop(world, entities, nextId, rooms.notice, 7, 6, 'neighbor_complaint', 1);
  placeDrop(world, entities, nextId, rooms.smoking, 4, 4, 'cigs', 1);
  for (const flat of rooms.flats) {
    placeDrop(world, entities, nextId, flat.rooms[1], 3, 4, 'bread', 1);
    placeDrop(world, entities, nextId, flat.rooms[3], 4, 3, 'toiletpaper', 1);
  }
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
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const i = world.idx(x, y);
  if (world.cells[i] !== Cell.FLOOR && world.cells[i] !== Cell.WATER) return;
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

function applySamosborAftermath(world: World, entities: Entity[], nextId: { v: number }, rooms: CommunalRooms): void {
  rooms.laundry.sealed = true;
  const washCabinet = world.containers.find(container => container.roomId === rooms.laundry.id);
  if (washCabinet) {
    washCabinet.stolenItemIds = ['cloth_roll'];
    washCabinet.lastAuditAt = 0;
    washCabinet.tags = [...washCabinet.tags, 'samosbor_aftermath'];
  }

  for (let dx = 2; dx < rooms.laundry.w - 2; dx++) {
    const i = world.idx(rooms.laundry.x + dx, rooms.laundry.y + rooms.laundry.h - 2);
    world.cells[i] = Cell.WATER;
    world.floorTex[i] = Tex.F_WATER;
  }
  for (let dy = 3; dy < rooms.shower.h - 2; dy += 2) {
    const i = world.idx(rooms.shower.x + 7, rooms.shower.y + dy);
    world.cells[i] = Cell.WATER;
    world.floorTex[i] = Tex.F_WATER;
  }

  stampSurfaceSplat(world, rooms.laundry.x + 6, rooms.laundry.y + 8, 0, 0, 4, 0.55, 2718, 40, 80, 90, false);
  spawnMonster(entities, nextId, MonsterKind.POLZUN, rooms.laundry.x + 9, rooms.laundry.y + 8);
}

function spawnMonster(entities: Entity[], nextId: { v: number }, kind: MonsterKind, x: number, y: number): void {
  const def = MONSTERS[kind];
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: def.speed * 0.85,
    sprite: monsterSpr(kind),
    hp: Math.round(def.hp * 0.85),
    maxHp: Math.round(def.hp * 0.85),
    monsterKind: kind,
    ai: { goal: AIGoal.HUNT, tx: x + 0.5, ty: y + 0.5, path: [], pi: 0, stuck: 0, timer: 0 },
  });
}

function fillCommunalVoids(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  containerId: { v: number },
  _ring: RingLayout,
): void {
  // 1. Магистральные туннели периметра (Perimeter Bypass Tunnels)
  // Прокладываем сквозные магистрали через всю карту 1024x1024
  const bypassCoords = [64, 160, 256, 352, 672, 768, 864, 960];

  for (const x of bypassCoords) {
    carveMajorBypass(world, x, 32, x, W - 32, 2, true);
    // Добавляем скрытые тайники контрабандистов вдоль вертикальных магистралей
    for (let sy = 100; sy < W - 100; sy += 180) {
      if (world.cells[world.idx(x, sy)] === Cell.FLOOR) {
        markPosterWall(world, x - 1, sy, sy);
        const stashRoom = world.rooms[world.roomMap[world.idx(x, sy)]] ?? world.rooms[0];
        if (stashRoom) {
          addContainer(world, containerId, stashRoom, x - stashRoom.x, sy - stashRoom.y, ContainerKind.SECRET_STASH, 'Тайник магистрального синдиката', [
            { defId: 'water_coupon', count: 2 },
            { defId: 'canned', count: 1 },
            { defId: 'cigs', count: 2 },
          ], 'secret', undefined, undefined, ['contraband', 'bypass_stash', 'secret', 'communal_ring']);
        }
      }
    }
  }
  for (const y of bypassCoords) {
    carveMajorBypass(world, 32, y, W - 32, y, 2, false);
    // Добавляем скрытые тайники контрабандистов вдоль горизонтальных магистралей
    for (let sx = 100; sx < W - 100; sx += 180) {
      if (world.cells[world.idx(sx, y)] === Cell.FLOOR) {
        markPosterWall(world, sx, y - 1, sx);
        const stashRoom = world.rooms[world.roomMap[world.idx(sx, y)]] ?? world.rooms[0];
        if (stashRoom) {
          addContainer(world, containerId, stashRoom, sx - stashRoom.x, y - stashRoom.y, ContainerKind.SECRET_STASH, 'Тайник кольцевой контрабанды', [
            { defId: 'valve_tag', count: 1 },
            { defId: 'bread', count: 2 },
            { defId: 'cloth_roll', count: 1 },
          ], 'secret', undefined, undefined, ['contraband', 'bypass_stash', 'secret', 'communal_ring']);
        }
      }
    }
  }

  // 2. Склады госрезерва и Индустриальные залы водоочистки (Логистическая и индустриальная эстетика)
  const majorPois = [
    { x: 120, y: 60, w: 24, h: 20, type: RoomType.STORAGE, name: 'Склад госрезерва Север-1' },
    { x: 380, y: 60, w: 28, h: 22, type: RoomType.STORAGE, name: 'Склад госрезерва Север-2' },
    { x: 620, y: 60, w: 26, h: 24, type: RoomType.STORAGE, name: 'Склад госрезерва Север-3' },
    { x: 860, y: 60, w: 24, h: 20, type: RoomType.STORAGE, name: 'Склад госрезерва Север-4' },
    { x: 120, y: W - 90, w: 26, h: 22, type: RoomType.STORAGE, name: 'Склад госрезерва Юг-1' },
    { x: 380, y: W - 90, w: 24, h: 20, type: RoomType.STORAGE, name: 'Склад госрезерва Юг-2' },
    { x: 620, y: W - 90, w: 28, h: 24, type: RoomType.STORAGE, name: 'Склад госрезерва Юг-3' },
    { x: 860, y: W - 90, w: 24, h: 20, type: RoomType.STORAGE, name: 'Склад госрезерва Юг-4' },
    { x: 60, y: 300, w: 20, h: 26, type: RoomType.PRODUCTION, name: 'Зал водоочистки Запад-1' },
    { x: 60, y: 700, w: 22, h: 24, type: RoomType.PRODUCTION, name: 'Зал водоочистки Запад-2' },
    { x: W - 85, y: 300, w: 22, h: 24, type: RoomType.PRODUCTION, name: 'Зал водоочистки Восток-1' },
    { x: W - 85, y: 700, w: 20, h: 26, type: RoomType.PRODUCTION, name: 'Зал водоочистки Восток-2' },
  ];

  for (const poi of majorPois) {
    if (isAreaTotallyFree(world, poi.x - 2, poi.y - 2, poi.w + 4, poi.h + 4)) {
      const room = createRoom(world, world.rooms.length, poi.type, poi.x, poi.y, poi.w, poi.h, poi.name, Tex.CONCRETE, poi.type === RoomType.STORAGE ? Tex.F_CONCRETE : Tex.F_TILE);
      if (poi.type === RoomType.STORAGE) {
        // Упорядоченные ряды стеллажей
        for (let sx = poi.x + 3; sx <= poi.x + poi.w - 4; sx += 3) {
          for (let sy = poi.y + 3; sy <= poi.y + poi.h - 4; sy++) {
            if (sy !== poi.y + Math.floor(poi.h / 2)) { // Оставляем центральный проход
              placeFeature(world, sx, sy, Feature.SHELF);
            }
          }
        }
        addContainer(world, containerId, room, Math.floor(poi.w / 2), 2, ContainerKind.METAL_CABINET, `Учетный шкаф: ${poi.name}`, [{ defId: 'canned', count: 3 }, { defId: 'cloth_roll', count: 2 }], 'room', undefined, undefined, ['pantry', 'storage']);
        
        // Геймплей: Армированные ящики с квестовыми сводками и дефицитом
        addContainer(world, containerId, room, poi.w - 4, poi.h - 3, ContainerKind.WEAPON_CRATE, `Элитный сейф госрезерва: ${poi.name}`, [
          { defId: 'samosbor_tally', count: 1 },
          { defId: 'ration_registry_extract', count: 1 },
          { defId: 'water_coupon', count: 3 },
          { defId: 'canned', count: 2 },
        ], 'room', undefined, undefined, ['elite_storage', 'syndicate_loot']);

        // Спавн бдительной охраны госрезерва
        if (Math.random() < 0.5) {
          spawnAmbientNpc(entities, nextId, `Охранник госрезерва (${poi.name})`, Faction.CITIZEN, Occupation.STOREKEEPER, poi.x + 4, poi.y + Math.floor(poi.h / 2), [{ defId: 'canned', count: 1 }], 'pistol');
        }
      } else {
        // Резервуары водоочистки
        for (let wx = poi.x + 4; wx <= poi.x + poi.w - 5; wx++) {
          for (let wy = poi.y + 4; wy <= poi.y + poi.h - 5; wy++) {
            const i = world.idx(wx, wy);
            world.cells[i] = Cell.WATER;
            world.floorTex[i] = Tex.F_WATER;
          }
        }
        placeFeature(world, poi.x + 2, poi.y + 2, Feature.MACHINE);
        placeFeature(world, poi.x + poi.w - 3, poi.y + poi.h - 3, Feature.MACHINE);
        addContainer(world, containerId, room, 3, 2, ContainerKind.TOOL_LOCKER, `Ящик обслуживания: ${poi.name}`, [{ defId: 'wrench', count: 1 }, { defId: 'valve_tag', count: 2 }], 'room', undefined, undefined, ['production', 'water']);
        
        // Геймплей: Опасные монстры водоочистки, охраняющие вентильные бирки
        spawnMonster(entities, nextId, MonsterKind.TUBE_EEL, poi.x + Math.floor(poi.w / 2), poi.y + 5);
        if (Math.random() < 0.5) {
          spawnMonster(entities, nextId, MonsterKind.SLIMEVIK, poi.x + Math.floor(poi.w / 2), poi.y + poi.h - 6);
        }
      }
      // Пускаем проходческие лучи из центра зала для гарантированной связности
      carveInfillRays(world, poi.x + Math.floor(poi.w / 2), poi.y + Math.floor(poi.h / 2));
    }
  }

  // 3. Smart Total Infill (Квартальная застройка пустот по всей сетке 1024x1024)
  const step = 32;
  const roomTypes: readonly RoomType[] = [
    RoomType.LIVING,
    RoomType.STORAGE,
    RoomType.COMMON,
    RoomType.PRODUCTION,
    RoomType.KITCHEN,
    RoomType.BATHROOM,
    RoomType.MEDICAL,
  ];

  for (let qy = 32; qy < W - 32; qy += step) {
    for (let qx = 32; qx < W - 32; qx += step) {
      if (!isAreaTotallyFree(world, qx, qy, step, step)) continue;

      // Свободный квадрат 32x32: строим перекресток и 4 угловые ячейки
      const cx = qx + 15;
      const cy = qy + 15;
      carveLineWidth(world, qx + 2, cy, qx + step - 3, cy, 2, Tex.F_LINO);
      carveLineWidth(world, cx, qy + 2, cx, qy + step - 3, 2, Tex.F_LINO);

      // Угловые комнаты 11x11
      const quadrants = [
        { x: qx + 2, y: qy + 2, doorX: qx + 7, doorY: qy + 13, doorState: DoorState.CLOSED },
        { x: qx + 19, y: qy + 2, doorX: qx + 24, doorY: qy + 13, doorState: DoorState.CLOSED },
        { x: qx + 2, y: qy + 19, doorX: qx + 7, doorY: qy + 18, doorState: DoorState.CLOSED },
        { x: qx + 19, y: qy + 19, doorX: qx + 24, doorY: qy + 18, doorState: DoorState.CLOSED },
      ];

      for (const q of quadrants) {
        const type = roomTypes[Math.floor(Math.random() * roomTypes.length)];
        const isTile = type === RoomType.KITCHEN || type === RoomType.BATHROOM || type === RoomType.MEDICAL;
        const isUtility = type === RoomType.STORAGE || type === RoomType.PRODUCTION;
        const isCommon = type === RoomType.COMMON;

        const wallTex = isTile ? Tex.TILE_W : isUtility ? Tex.BRICK : isCommon ? Tex.ROTTEN : Tex.PANEL;
        const floorTex = isTile ? Tex.F_TILE : isUtility ? Tex.F_CONCRETE : isCommon ? Tex.F_LINO : Tex.F_WOOD;
        const name = getAuxRoomName(type);

        const room = createRoom(world, world.rooms.length, type, q.x, q.y, 11, 11, name, wallTex, floorTex);
        connectRoomToCorridor(world, room, q.doorX, q.doorY, q.doorState);
        decorateAuxRoom(world, entities, nextId, containerId, room);
      }

      // Проходческие соединительные лучи из центра квартала
      carveInfillRays(world, cx, cy);
    }
  }

  // 4. Органическое самосборное зашумление (Organic Samosbor Weaving)
  // 10 000 итераций змеевидных сбоек для 100% покрытия остаточных монолитов
  const sIter = 10000;
  for (let s = 0; s < sIter; s++) {
    let rx = 16 + Math.floor(Math.random() * (W - 32));
    let ry = 16 + Math.floor(Math.random() * (W - 32));
    if (world.cells[world.idx(rx, ry)] !== Cell.WALL || world.aptMask[world.idx(rx, ry)] === 1) continue;

    let dx = Math.random() < 0.5 ? (Math.random() < 0.5 ? 1 : -1) : 0;
    let dy = dx === 0 ? (Math.random() < 0.5 ? 1 : -1) : 0;
    const len = 15 + Math.floor(Math.random() * 25);

    for (let step = 0; step < len; step++) {
      const i = world.idx(rx, ry);
      if (world.aptMask[i] === 1 || world.roomMap[i] !== -1 || world.cells[i] === Cell.ABYSS) break;
      world.cells[i] = Cell.FLOOR;
      world.floorTex[i] = Tex.F_CONCRETE;

      rx = world.wrap(rx + dx);
      ry = world.wrap(ry + dy);

      // Высокий шанс поворота (30-35%)
      if (Math.random() < 0.32) {
        const temp = dx;
        dx = dy === 0 ? 0 : (Math.random() < 0.5 ? 1 : -1);
        dy = temp === 0 ? 0 : (Math.random() < 0.5 ? 1 : -1);
      }
    }
  }
}

function carveMajorBypass(
  world: World,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  vertical: boolean,
): void {
  const checkMinX = vertical ? x1 - 1 : x1;
  const checkMaxX = vertical ? x1 + width : x2;
  const checkMinY = vertical ? y1 : y1 - 1;
  const checkMaxY = vertical ? y2 : y1 + width;

  for (let y = checkMinY; y <= checkMaxY; y++) {
    for (let x = checkMinX; x <= checkMaxX; x++) {
      const i = world.idx(x, y);
      if (world.aptMask[i] === 1 || world.roomMap[i] !== -1 || world.cells[i] === Cell.ABYSS) {
        return; // Если натыкаемся на авторскую комнату или защищенную зону, отменяем данный сегмент магистрали
      }
    }
  }

  carveLineWidth(world, x1, y1, x2, y2, width, Tex.F_CONCRETE);
}

function carveInfillRays(world: World, cx: number, cy: number): void {
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  for (const d of dirs) {
    let x = world.wrap(cx + d.dx * 2);
    let y = world.wrap(cy + d.dy * 2);
    for (let s = 0; s < 120; s++) {
      const i = world.idx(x, y);
      if (world.aptMask[i] === 1 || world.cells[i] === Cell.ABYSS) break;
      if (world.cells[i] === Cell.FLOOR || world.cells[i] === Cell.WATER || world.cells[i] === Cell.DOOR) {
        break; // Успешно соединились с существующим пространством!
      }
      world.cells[i] = Cell.FLOOR;
      world.floorTex[i] = Tex.F_CONCRETE;
      x = world.wrap(x + d.dx);
      y = world.wrap(y + d.dy);
    }
  }
}

function isAreaTotallyFree(world: World, x: number, y: number, w: number, h: number): boolean {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const i = world.idx(world.wrap(x + dx), world.wrap(y + dy));
      if (world.cells[i] !== Cell.WALL || world.roomMap[i] !== -1 || world.aptMask[i] === 1) {
        return false;
      }
    }
  }
  return true;
}

function getAuxRoomName(type: RoomType): string {
  switch (type) {
    case RoomType.LIVING:
      return 'Стихийная жилая микро-ячейка';
    case RoomType.STORAGE:
      return 'Кладовка хранения припасов';
    case RoomType.COMMON:
      return 'Трущобная выгородка между коридорами';
    case RoomType.PRODUCTION:
      return 'Самодельная микро-мастерская';
    case RoomType.KITCHEN:
      return 'Тесная проходная ниша с плитой';
    case RoomType.BATHROOM:
      return 'Кольцевой туалетный микро-блок';
    case RoomType.MEDICAL:
      return 'Санитарный пункт между коридорами';
    default:
      return 'Тесная проходная техническая полость';
  }
}

function decorateAuxRoom(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  containerId: { v: number },
  room: Room,
): void {
  if (room.type === RoomType.KITCHEN) {
    placeFeature(world, room.x + 2, room.y + 2, Feature.STOVE);
    placeFeature(world, room.x + room.w - 3, room.y + 2, Feature.SINK);
    placeFeature(world, room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2), Feature.TABLE);
  } else if (room.type === RoomType.BATHROOM) {
    placeFeature(world, room.x + 2, room.y + 2, Feature.TOILET);
    placeFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.SINK);
  } else if (room.type === RoomType.PRODUCTION) {
    placeFeature(world, room.x + 2, room.y + 2, Feature.MACHINE);
    placeFeature(world, room.x + room.w - 3, room.y + 2, Feature.TABLE);
    placeFeature(world, room.x + 2, room.y + room.h - 3, Feature.SHELF);
  } else {
    placeFeature(world, room.x + 2, room.y + 2, Feature.BED);
    placeFeature(world, room.x + room.w - 3, room.y + 2, Feature.TABLE);
    placeFeature(world, room.x + 2, room.y + room.h - 3, Feature.SHELF);
  }

  const rand = Math.random();
  if (rand < 0.4) {
    const items: { defId: string; count: number }[] = [];
    if (room.type === RoomType.KITCHEN) items.push({ defId: 'bread', count: 1 }, { defId: 'tea', count: 1 });
    else if (room.type === RoomType.BATHROOM) items.push({ defId: 'toiletpaper', count: 1 });
    else if (room.type === RoomType.PRODUCTION) items.push({ defId: 'wrench', count: 1 });
    else items.push({ defId: 'kasha', count: 1 }, { defId: 'cigs', count: 1 });

    const kind = room.type === RoomType.KITCHEN ? ContainerKind.FRIDGE : room.type === RoomType.PRODUCTION ? ContainerKind.TOOL_LOCKER : ContainerKind.WOODEN_CHEST;
    addContainer(world, containerId, room, Math.floor(room.w / 2), 2, kind, `Тумба: ${room.name.toLowerCase()}`, items, 'room', undefined, undefined, ['aux_pantry', 'communal_ring']);
  } else if (rand < 0.7) {
    const defId = room.type === RoomType.KITCHEN ? 'bread' : room.type === RoomType.PRODUCTION ? 'cloth_roll' : 'cigs';
    placeDrop(world, entities, nextId, room, Math.floor(room.w / 2), Math.floor(room.h / 2), defId, 1);
  }

  if (Math.random() < 0.25) {
    const occ = room.type === RoomType.PRODUCTION ? Occupation.LOCKSMITH : room.type === RoomType.KITCHEN ? Occupation.COOK : Occupation.TRAVELER;
    const npcName = room.type === RoomType.PRODUCTION ? 'Самодельный мастер' : room.type === RoomType.KITCHEN ? 'Стихийный кашевар' : 'Запоздалый свидетель';
    spawnAmbientNpc(entities, nextId, npcName, Faction.CITIZEN, occ, room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2), [{ defId: 'bread', count: 1 }]);
  }
}

