/* ── Design floor: Райсовет и Живой архив ───────────────────────
 * Routed authored-floor package. Route data lives in data/design_floors.ts;
 * generation is mounted through the design-floor manifest.
 */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  W, Cell, Tex, Feature, RoomType, LiftDirection, ContainerKind, DoorState,
  EntityType, AIGoal, Faction, Occupation, FloorLevel, QuestType, MonsterKind, ZoneFaction,
  type Entity, type GameState, type Room, type TerritoryOwner, type WorldContainer, type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { freshNeeds } from '../../data/catalog';
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { Spr, monsterSpr } from '../../render/sprite_index';
import { publishEvent } from '../../systems/events';
import { calcZoneLevel, randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { setTerritoryOwnerAtIndex } from '../../systems/territory';
import {
  carveCorridor, ensureConnectivity, generateZones, placeDoor, placeDoorAt, protectRoom,
  roomExit, stampRoom,
} from '../shared';
import type { FloorGeneration } from '../floor_manifest';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('raionsovet_archive');

export const RAIONSOVET_ARCHIVE_ROUTE_ID = 'raionsovet_archive' as const;
export const RAIONSOVET_ARCHIVE_Z = 22;
export const RAIONSOVET_ARCHIVE_DEBUG_SEED = 602006;

export const RAIONSOVET_ARCHIVE_META = {
  routeId: RAIONSOVET_ARCHIVE_ROUTE_ID,
  displayName: 'Райсовет и архив картотек',
  z: RAIONSOVET_ARCHIVE_Z,
  baseFloor: FloorLevel.MINISTRY,
  debugEntry: 'generateRaionsovetArchiveDesignFloor()',
} as const;

export interface RaionsovetArchiveDocument {
  id: string;
  itemId: string;
  title: string;
  routeId: string;
  accessTags: readonly string[];
  suspicion: number;
  legal: boolean;
  flag: string;
}

export const RAIONSOVET_ARCHIVE_DOCUMENTS: readonly RaionsovetArchiveDocument[] = [
  {
    id: 'doc_archive_floor_permit',
    itemId: 'archive_access_permit',
    title: 'Допуск к закрытой картотеке',
    routeId: RAIONSOVET_ARCHIVE_ROUTE_ID,
    accessTags: ['archive_entry', 'personal_file'],
    suspicion: 0,
    legal: true,
    flag: 'archive.permit.raionsovet_archive',
  },
  {
    id: 'doc_route_registry_morgue',
    itemId: 'elevator_access_order',
    title: 'Маршрутная бумага к моргу регистраций',
    routeId: 'registry_morgue',
    accessTags: ['route_permit', 'registry_morgue'],
    suspicion: 1,
    legal: true,
    flag: 'archive.permit.registry_morgue',
  },
  {
    id: 'doc_apartment_rights_card',
    itemId: 'personal_file_copy',
    title: 'Копия квартирного права',
    routeId: 'living',
    accessTags: ['apartment_rights', 'personal_file'],
    suspicion: 0,
    legal: true,
    flag: 'archive.card_swapped.living_shelf_17',
  },
  {
    id: 'doc_burned_shelf_act',
    itemId: 'record_exposure_notice',
    title: 'Акт о сожженной зараженной полке',
    routeId: RAIONSOVET_ARCHIVE_ROUTE_ID,
    accessTags: ['archive_burn_order', 'samosbor_record'],
    suspicion: 3,
    legal: true,
    flag: 'archive.shelf_burned.west_stack',
  },
  {
    id: 'doc_market_88_license',
    itemId: 'official_permit_slip',
    title: 'Лицензионный корешок рынка 88',
    routeId: 'black_market_88',
    accessTags: ['trade_license', 'market_88'],
    suspicion: 2,
    legal: true,
    flag: 'archive.market_license_state.licensed',
  },
  {
    id: 'doc_forged_archive_route',
    itemId: 'forged_stamp_sheet',
    title: 'Поддельная печать на архивный обход',
    routeId: RAIONSOVET_ARCHIVE_ROUTE_ID,
    accessTags: ['archive_entry', 'forged'],
    suspicion: 12,
    legal: false,
    flag: 'archive.permit.raionsovet_archive.forged',
  },
  {
    id: 'doc_stolen_apartment_card',
    itemId: 'stolen_archive_card',
    title: 'Краденая карточка квартирных прав',
    routeId: 'living',
    accessTags: ['apartment_rights', 'stolen'],
    suspicion: 9,
    legal: false,
    flag: 'archive.card_swapped.living_shelf_17.stolen',
  },
  {
    id: 'doc_false_market_license',
    itemId: 'fake_pass',
    title: 'Липовая рыночная лицензия',
    routeId: 'black_market_88',
    accessTags: ['trade_license', 'forged'],
    suspicion: 10,
    legal: false,
    flag: 'archive.market_license_state.forged',
  },
];

export interface RaionsovetArchiveAccessCheck {
  id: string;
  targetId: string;
  roomName: string;
  legalItemId: string;
  illegalItemId: string;
  legalFlag: string;
  illegalFlag: string;
  visibleEffect: string;
}

export const RAIONSOVET_ARCHIVE_ACCESS_CHECKS: readonly RaionsovetArchiveAccessCheck[] = [
  {
    id: 'access_living_shelf_legal',
    targetId: 'door_living_rights_front',
    roomName: 'Закрытые жилые полки',
    legalItemId: 'archive_access_permit',
    illegalItemId: 'forged_stamp_sheet',
    legalFlag: 'archive.permit.raionsovet_archive',
    illegalFlag: 'archive.permit.raionsovet_archive.forged',
    visibleEffect: 'Передняя дверь открывается законным допуском; черный вход открывается поддельной печатью.',
  },
  {
    id: 'access_market_license_safe',
    targetId: 'container_market_88_license_safe',
    roomName: 'Лицензионная ниша рынка 88',
    legalItemId: 'official_permit_slip',
    illegalItemId: 'fake_pass',
    legalFlag: 'archive.market_license_state.licensed',
    illegalFlag: 'archive.market_license_state.forged',
    visibleEffect: 'Лицензионный сейф дает чистый корешок или подозрительный липовый пропуск.',
  },
  {
    id: 'access_apartment_card_swap',
    targetId: 'container_living_rights_shelf',
    roomName: 'Полка квартирных прав',
    legalItemId: 'personal_file_copy',
    illegalItemId: 'stolen_archive_card',
    legalFlag: 'archive.card_swapped.living_shelf_17',
    illegalFlag: 'archive.card_swapped.living_shelf_17.stolen',
    visibleEffect: 'Карточка меняет владельца комнаты через поручение или через кражу из картотеки.',
  },
];

export function resolveRaionsovetArchiveAccess(documentItemId: string, targetId: string): {
  allowed: boolean;
  flag: string;
  suspicionDelta: number;
  legal: boolean;
} | null {
  const check = RAIONSOVET_ARCHIVE_ACCESS_CHECKS.find(c => c.targetId === targetId);
  if (!check) return null;
  if (documentItemId === check.legalItemId) {
    const doc = RAIONSOVET_ARCHIVE_DOCUMENTS.find(d => d.itemId === documentItemId && d.legal);
    return { allowed: true, flag: check.legalFlag, suspicionDelta: doc?.suspicion ?? 0, legal: true };
  }
  if (documentItemId === check.illegalItemId) {
    const doc = RAIONSOVET_ARCHIVE_DOCUMENTS.find(d => d.itemId === documentItemId && !d.legal);
    return { allowed: true, flag: check.illegalFlag, suspicionDelta: doc?.suspicion ?? 8, legal: false };
  }
  return { allowed: false, flag: 'archive.denied.missing_record', suspicionDelta: 1, legal: false };
}

export type RaionsovetArchiveEventKind =
  | 'permit_issued'
  | 'card_swapped'
  | 'shelf_burned'
  | 'market_license_changed'
  | 'archive_denied';

export function publishRaionsovetArchiveEvent(
  state: GameState,
  kind: RaionsovetArchiveEventKind,
  routeId: string,
  targetId: string,
  roomId?: number,
  zoneId?: number,
): WorldEvent {
  return publishEvent(state, {
    type: 'rumor_observed',
    floor: FloorLevel.MINISTRY,
    roomId,
    zoneId,
    targetName: targetId,
    severity: kind === 'shelf_burned' || kind === 'archive_denied' ? 4 : 3,
    privacy: kind === 'archive_denied' ? 'witnessed' : 'local',
    tags: ['archive', RAIONSOVET_ARCHIVE_ROUTE_ID, kind, routeId],
    data: { archiveEvent: kind, routeId, targetId },
  });
}

const LIDA_DEF: PlotNpcDef = {
  name: 'Лида Индексная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 120, maxHp: 120, money: 70, speed: 0.75,
  inventory: [
    { defId: 'archive_access_permit', count: 1 },
    { defId: 'elevator_access_order', count: 1 },
    { defId: 'blank_form', count: 2 },
  ],
  talkLines: [
    'Маршрут не существует, пока я не поставила его в указатель у лифта.',
    'Два пустых бланка - и у вас будет допуск к закрытой картотеке.',
    'Кованая печать тоже открывает полку. Потом полка открывает дело на вас.',
    'Не подписывайте форму без адресата. В картотеке пустая графа быстро получает чужую фамилию.',
  ],
  talkLinesPost: [
    'Ваш маршрут внесен в журнал. В лифте держите ордер сверху, а не в кармане.',
    'Карточки любят аккуратных. Громких тут переписывают без очереди.',
  ],
};

const GRANDFATHER_DEF: PlotNpcDef = {
  name: 'Дед Бумажный',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 140, maxHp: 140, money: 20, speed: 0.45,
  inventory: [
    { defId: 'personal_file_copy', count: 1 },
    { defId: 'passport_stub', count: 1 },
  ],
  talkLines: [
    'Я не старый. Я карточка, которую забыли вынуть из человека.',
    'Вернете краденую карточку — покажу, чья комната пережила самосбор.',
    'Если меня сдвинуть на полку, в комнате окажется другой жилец с правильной карточкой.',
    'Дело без обложки не принимается. Обложку берегите: по ней пропускают к полке.',
  ],
  talkLinesPost: [
    'Карточка легла не туда. Теперь квартира спорит с фамилией.',
    'Запомните: право на комнату тише ключа, зато проверяющий смотрит сначала в него.',
  ],
};

const FIRE_LIQUIDATOR_DEF: PlotNpcDef = {
  name: 'Инна Огневая',
  isFemale: true,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 240, maxHp: 240, money: 110, speed: 1.0,
  inventory: [
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 12 },
    { defId: 'record_exposure_notice', count: 1 },
  ],
  talkLines: [
    'Западные стеллажи заражены туманом. Бумага уже кашляет фамилиями.',
    'Принесете пропавшее дело — решим: сохранить запись или сжечь полку.',
    'Сохранить — значит рискнуть людьми. Сжечь — значит оставить людей без прав.',
    'Печатеед у огневой полки не сторож. Он санитар документа: ест лишних владельцев.',
  ],
  talkLinesPost: [
    'Полка дымится, но коридор стал тише.',
    'Если запись спасли, проверьте дверь. В журнале теперь лишнее имя, и проверяющий его найдет.',
  ],
};

const FALSE_HEIR_DEF: PlotNpcDef = {
  name: 'Гера Наследник',
  isFemale: false,
  faction: Faction.WILD,
  occupation: Occupation.TRAVELER,
  sprite: Occupation.TRAVELER,
  hp: 110, maxHp: 110, money: 160, speed: 1.05,
  inventory: [
    { defId: 'fake_pass', count: 1 },
    { defId: 'forged_stamp_sheet', count: 1 },
    { defId: 'ration_registry_extract', count: 1 },
  ],
  talkLines: [
    'Я наследую только пустые комнаты. Они не возражают, если бумага правильная.',
    'Рынок 88 любит лицензии, особенно те, которые никто не проверял утром.',
    'Принесите лист с печатью — сделаем так, будто торговля была всегда.',
    'Липовая лицензия открывает рынок и закрывает чей-то настоящий адрес.',
  ],
  talkLinesPost: [
    'Лицензия чистая на вид. Грязь спрятана в журнале.',
    'Если рынок спросит, я здесь не стоял. Если архив спросит, вы тоже.',
  ],
};

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'archive_lida_index', LIDA_DEF, [
  {
    id: 'archive_get_floor_permit',
    giverNpcId: 'archive_lida_index',
    type: QuestType.FETCH,
    desc: 'Лида Индексная: «Два пустых бланка - и дам допуск к закрытой картотеке и маршрутный ордер. Подписывать их будете не здесь.»',
    targetItem: 'blank_form',
    targetCount: 2,
    rewardItem: 'archive_access_permit',
    rewardCount: 1,
    extraRewards: [{ defId: 'elevator_access_order', count: 1 }],
    relationDelta: 10,
    xpReward: 70,
    moneyReward: 50,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'archive_paper_grandfather', GRANDFATHER_DEF, [
  {
    id: 'archive_swap_card',
    giverNpcId: 'archive_paper_grandfather',
    type: QuestType.FETCH,
    desc: 'Дед Бумажный: «Принесите краденую карточку. Я покажу, кому теперь числится комната, и кто останется без строки.»',
    targetItem: 'stolen_archive_card',
    targetCount: 1,
    rewardItem: 'personal_file_copy',
    rewardCount: 1,
    extraRewards: [{ defId: 'passport_stub', count: 1 }],
    relationDelta: 12,
    xpReward: 80,
    moneyReward: 60,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'archive_fire_liquidator', FIRE_LIQUIDATOR_DEF, [
  {
    id: 'archive_save_or_burn',
    giverNpcId: 'archive_fire_liquidator',
    type: QuestType.FETCH,
    desc: 'Инна Огневая: «Принесите пропавшее дело. Сохраним запись или сожжем зараженную полку по акту. Оба варианта вредят разным людям.»',
    targetItem: 'missing_record_file',
    targetCount: 1,
    rewardItem: 'record_exposure_notice',
    rewardCount: 1,
    extraRewards: [{ defId: 'siren_instruction', count: 1 }],
    relationDelta: 8,
    xpReward: 85,
    moneyReward: 100,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'archive_false_heir', FALSE_HEIR_DEF, [
  {
    id: 'archive_market_license',
    giverNpcId: 'archive_false_heir',
    type: QuestType.FETCH,
    desc: 'Гера Наследник: «Лист с поддельной печатью превратим в лицензию для рынка 88. Почти чистую.»',
    targetItem: 'forged_stamp_sheet',
    targetCount: 1,
    rewardItem: 'official_permit_slip',
    rewardCount: 1,
    extraRewards: [{ defId: 'fake_pass', count: 1 }],
    relationDelta: 6,
    xpReward: 75,
    moneyReward: 130,
  },
]);

interface ArchiveRooms {
  waiting: Room;
  clerk: Room;
  catalog: Room;
  shelves: Room;
  stamp: Room;
  fire: Room;
  heir: Room;
  market: Room;
  checker: Room;
}

interface ArchivePoint {
  x: number;
  y: number;
}

type ArchiveDoorSide = 'north' | 'south' | 'west' | 'east';

interface ArchiveMicroGridSpec {
  name: string;
  owner: TerritoryOwner;
  x: number;
  y: number;
  cols: number;
  rows: number;
  roomW: number;
  roomH: number;
  gapX: number;
  gapY: number;
  connector: ArchivePoint;
  floorTex: Tex;
  wallTex: Tex;
  roomTypes: readonly RoomType[];
}

interface ArchiveHqSpec {
  owner: TerritoryOwner;
  name: string;
  x: number;
  y: number;
  linkX: number;
  linkY: number;
  wallTex: Tex;
  floorTex: Tex;
}

const RAIONSOVET_ARCHIVE_MICRO_GRIDS: readonly ArchiveMicroGridSpec[] = [
  {
    name: 'Северные окна справок',
    owner: ZoneFaction.CITIZEN,
    x: 382,
    y: 196,
    cols: 6,
    rows: 5,
    roomW: 15,
    roomH: 9,
    gapX: 10,
    gapY: 8,
    connector: { x: 512, y: 256 },
    floorTex: Tex.F_MARBLE_TILE,
    wallTex: Tex.MARBLE,
    roomTypes: [RoomType.OFFICE, RoomType.STORAGE, RoomType.OFFICE, RoomType.COMMON],
  },
  {
    name: 'Юго-западные шкафы прописки',
    owner: ZoneFaction.WILD,
    x: 78,
    y: 538,
    cols: 6,
    rows: 6,
    roomW: 13,
    roomH: 9,
    gapX: 9,
    gapY: 8,
    connector: { x: 142, y: 512 },
    floorTex: Tex.F_WOOD,
    wallTex: Tex.PANEL,
    roomTypes: [RoomType.STORAGE, RoomType.SMOKING, RoomType.STORAGE, RoomType.KITCHEN],
  },
  {
    name: 'Юго-восточная сетка допусков',
    owner: ZoneFaction.SCIENTIST,
    x: 660,
    y: 632,
    cols: 8,
    rows: 6,
    roomW: 14,
    roomH: 9,
    gapX: 9,
    gapY: 8,
    connector: { x: 768, y: 768 },
    floorTex: Tex.F_CONCRETE,
    wallTex: Tex.METAL,
    roomTypes: [RoomType.OFFICE, RoomType.PRODUCTION, RoomType.MEDICAL, RoomType.STORAGE],
  },
  {
    name: 'Нижние маленькие спорные дела',
    owner: ZoneFaction.CITIZEN,
    x: 598,
    y: 878,
    cols: 7,
    rows: 4,
    roomW: 14,
    roomH: 9,
    gapX: 10,
    gapY: 8,
    connector: { x: 512, y: 864 },
    floorTex: Tex.F_PARQUET,
    wallTex: Tex.MARBLE,
    roomTypes: [RoomType.STORAGE, RoomType.OFFICE, RoomType.STORAGE, RoomType.BATHROOM],
  },
  {
    name: 'Культовые ячейки сгоревших фамилий',
    owner: ZoneFaction.CULTIST,
    x: 704,
    y: 812,
    cols: 5,
    rows: 4,
    roomW: 13,
    roomH: 9,
    gapX: 9,
    gapY: 8,
    connector: { x: 768, y: 768 },
    floorTex: Tex.F_MEAT,
    wallTex: Tex.ROTTEN,
    roomTypes: [RoomType.STORAGE, RoomType.COMMON, RoomType.SMOKING, RoomType.MEDICAL],
  },
];

const RAIONSOVET_ARCHIVE_HQ_SPECS: readonly ArchiveHqSpec[] = [
  {
    owner: ZoneFaction.CITIZEN,
    name: 'Гражданский штаб очереди райсовета',
    x: 420,
    y: 334,
    linkX: 512,
    linkY: 256,
    wallTex: Tex.PANEL,
    floorTex: Tex.F_PARQUET,
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    name: 'Пост ликвидаторов зараженной полки',
    x: 850,
    y: 546,
    linkX: 884,
    linkY: 512,
    wallTex: Tex.METAL,
    floorTex: Tex.F_CONCRETE,
  },
  {
    owner: ZoneFaction.SCIENTIST,
    name: 'НИИ-штаб сверки картотек',
    x: 862,
    y: 704,
    linkX: 884,
    linkY: 768,
    wallTex: Tex.METAL,
    floorTex: Tex.F_CONCRETE,
  },
  {
    owner: ZoneFaction.WILD,
    name: 'Дикий штаб подмены адресов',
    x: 86,
    y: 604,
    linkX: 142,
    linkY: 512,
    wallTex: Tex.ROTTEN,
    floorTex: Tex.F_WOOD,
  },
  {
    owner: ZoneFaction.CULTIST,
    name: 'Скрытый культовый штаб пепельной ведомости',
    x: 640,
    y: 828,
    linkX: 768,
    linkY: 768,
    wallTex: Tex.ROTTEN,
    floorTex: Tex.F_MEAT,
  },
];

function createArchiveRoom(
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
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  return room;
}

function paintRoom(world: World, room: Room): void {
  protectRoom(world, room.x, room.y, room.w, room.h, room.wallTex, room.floorTex);
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.cells[ci] !== Cell.WALL) world.floorTex[ci] = room.floorTex;
      else world.wallTex[ci] = room.wallTex;
    }
  }
}

function canStampArchiveOwnedRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.aptMask[ci]) return false;
      if (world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR) return false;
      if (world.containerMap.has(ci)) return false;
      if (world.roomMap[ci] >= 0) return false;
    }
  }
  return true;
}

function paintArchiveRoomTerritory(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) setTerritoryOwnerAtIndex(world, world.idx(room.x + dx, room.y + dy), owner);
  }
}

function stampOwnedArchiveRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  owner: TerritoryOwner,
  wallTex: Tex,
  floorTex: Tex,
): Room | null {
  if (!canStampArchiveOwnedRoom(world, x, y, w, h)) return null;
  const room = createArchiveRoom(world, world.rooms.length, type, x, y, w, h, name, wallTex, floorTex);
  paintRoom(world, room);
  paintArchiveRoomTerritory(world, room, owner);
  return room;
}

function addArchiveRoomDoor(
  world: World,
  room: Room,
  x: number,
  y: number,
  state = DoorState.CLOSED,
  keyId = '',
): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.WALL) return;
  world.cells[ci] = Cell.DOOR;
  world.wallTex[ci] = state === DoorState.HERMETIC_OPEN || state === DoorState.HERMETIC_CLOSED ? Tex.DOOR_METAL : room.wallTex;
  world.doors.set(ci, { idx: ci, state, roomA: room.id, roomB: -1, keyId, timer: 0 });
  if (!room.doors.includes(ci)) room.doors.push(ci);
}

function archiveDoorPoint(room: Room, side: ArchiveDoorSide): { wx: number; wy: number; ox: number; oy: number } {
  const x = side === 'west' ? room.x - 1 : side === 'east' ? room.x + room.w : room.x + Math.floor(room.w / 2);
  const y = side === 'north' ? room.y - 1 : side === 'south' ? room.y + room.h : room.y + Math.floor(room.h / 2);
  return {
    wx: x,
    wy: y,
    ox: side === 'west' ? x - 1 : side === 'east' ? x + 1 : x,
    oy: side === 'north' ? y - 1 : side === 'south' ? y + 1 : y,
  };
}

function addArchiveDoorOnSide(
  world: World,
  room: Room,
  side: ArchiveDoorSide,
  state = DoorState.CLOSED,
  keyId = '',
): ArchivePoint {
  const point = archiveDoorPoint(room, side);
  addArchiveRoomDoor(world, room, point.wx, point.wy, state, keyId);
  return { x: point.ox, y: point.oy };
}

function markArchiveHermeticShell(world: World, room: Room): void {
  room.sealed = true;
  room.wallTex = Tex.HERMO_WALL;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      const interior = dx >= 0 && dx < room.w && dy >= 0 && dy < room.h;
      if (interior) continue;
      if (world.cells[ci] !== Cell.WALL) continue;
      world.hermoWall[ci] = 1;
      world.wallTex[ci] = Tex.HERMO_WALL;
    }
  }
}

function decorateArchiveMicroRoom(world: World, room: Room, owner: TerritoryOwner, serial: number): void {
  switch (room.type) {
    case RoomType.KITCHEN:
      setFeatureIfFloor(world, room.x + 3, room.y + 3, Feature.STOVE);
      setFeatureIfFloor(world, room.x + room.w - 4, room.y + 3, Feature.SINK);
      setFeatureIfFloor(world, room.x + 4, room.y + room.h - 3, Feature.TABLE);
      break;
    case RoomType.BATHROOM:
      setFeatureIfFloor(world, room.x + 3, room.y + 3, Feature.SINK);
      setFeatureIfFloor(world, room.x + room.w - 4, room.y + room.h - 3, Feature.TOILET);
      break;
    case RoomType.MEDICAL:
      setFeatureIfFloor(world, room.x + 3, room.y + 3, Feature.APPARATUS);
      setFeatureIfFloor(world, room.x + room.w - 4, room.y + 3, Feature.TABLE);
      break;
    case RoomType.PRODUCTION:
      setFeatureIfFloor(world, room.x + 3, room.y + 3, Feature.MACHINE);
      setFeatureIfFloor(world, room.x + room.w - 4, room.y + 3, Feature.SCREEN);
      break;
    case RoomType.OFFICE:
      setFeatureIfFloor(world, room.x + 3, room.y + 3, Feature.DESK);
      setFeatureIfFloor(world, room.x + room.w - 4, room.y + 3, Feature.SCREEN);
      setFeatureIfFloor(world, room.x + 4, room.y + room.h - 3, Feature.CHAIR);
      break;
    case RoomType.HQ:
      setFeatureIfFloor(world, room.x + 4, room.y + 4, owner === ZoneFaction.CULTIST ? Feature.CANDLE : Feature.DESK);
      setFeatureIfFloor(world, room.x + room.w - 5, room.y + 4, owner === ZoneFaction.SCIENTIST ? Feature.APPARATUS : Feature.SCREEN);
      setFeatureIfFloor(world, room.x + 5, room.y + room.h - 4, Feature.SHELF);
      setFeatureIfFloor(world, room.x + room.w - 6, room.y + room.h - 4, Feature.LAMP);
      break;
    case RoomType.STORAGE:
      for (let y = room.y + 2; y < room.y + room.h - 1; y += 3) {
        setFeatureIfFloor(world, room.x + 3, y, owner === ZoneFaction.CULTIST ? Feature.CANDLE : Feature.SHELF);
        setFeatureIfFloor(world, room.x + room.w - 4, y, Feature.SHELF);
      }
      break;
    default:
      setFeatureIfFloor(world, room.x + 3, room.y + 3, serial % 2 === 0 ? Feature.TABLE : Feature.DESK);
      setFeatureIfFloor(world, room.x + room.w - 4, room.y + room.h - 3, Feature.CHAIR);
      break;
  }
}

function setFeatureIfFloor(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = feature;
}

function setShelfWall(world: World, x: number, y: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
  world.cells[ci] = Cell.WALL;
  world.wallTex[ci] = Tex.PANEL;
  world.features[ci] = Feature.NONE;
}

function isArchiveReserved(world: World, x: number, y: number): boolean {
  const ci = world.idx(x, y);
  return world.aptMask[ci] !== 0
    || world.cells[ci] === Cell.LIFT
    || world.containerMap.has(ci);
}

function carveArchiveCell(world: World, x: number, y: number, floorTex = Tex.F_MARBLE_TILE, roomId = -1): void {
  const ci = world.idx(x, y);
  if (isArchiveReserved(world, x, y) || world.cells[ci] === Cell.DOOR) return;
  world.cells[ci] = Cell.FLOOR;
  world.roomMap[ci] = roomId;
  world.floorTex[ci] = floorTex;
  world.features[ci] = Feature.NONE;
}

function carveArchiveBlock(world: World, x: number, y: number, w: number, h: number, floorTex = Tex.F_MARBLE_TILE, roomId = -1): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) carveArchiveCell(world, x + dx, y + dy, floorTex, roomId);
  }
}

function carveArchiveDisc(world: World, cx: number, cy: number, r: number, floorTex = Tex.F_MARBLE_TILE, roomId = -1): void {
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r2) carveArchiveCell(world, cx + dx, cy + dy, floorTex, roomId);
    }
  }
}

function carveArchiveLine(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width = 1,
  floorTex = Tex.F_MARBLE_TILE,
  roomId = -1,
): void {
  const sx = bx === ax ? 0 : bx > ax ? 1 : -1;
  const sy = by === ay ? 0 : by > ay ? 1 : -1;
  let x = ax;
  let y = ay;
  while (x !== bx) {
    carveArchiveDisc(world, x, y, width, floorTex, roomId);
    x += sx;
  }
  while (y !== by) {
    carveArchiveDisc(world, x, y, width, floorTex, roomId);
    y += sy;
  }
  carveArchiveDisc(world, x, y, width, floorTex, roomId);
}

function setArchiveWall(world: World, x: number, y: number, wallTex = Tex.PANEL): void {
  const ci = world.idx(x, y);
  if (isArchiveReserved(world, x, y) || world.cells[ci] === Cell.DOOR) return;
  world.cells[ci] = Cell.WALL;
  world.roomMap[ci] = -1;
  world.wallTex[ci] = wallTex;
  world.features[ci] = Feature.NONE;
}

function frameArchiveArea(world: World, x: number, y: number, w: number, h: number, wallTex = Tex.MARBLE): void {
  for (let dx = -1; dx <= w; dx++) {
    setArchiveWall(world, x + dx, y - 1, wallTex);
    setArchiveWall(world, x + dx, y + h, wallTex);
  }
  for (let dy = 0; dy < h; dy++) {
    setArchiveWall(world, x - 1, y + dy, wallTex);
    setArchiveWall(world, x + w, y + dy, wallTex);
  }
}

function addArchiveGate(world: World, x: number, y: number, keyId = ''): void {
  const ci = world.idx(x, y);
  if (isArchiveReserved(world, x, y) || world.cells[ci] !== Cell.WALL) return;

  const l = world.cells[world.idx(x - 1, y)];
  const r = world.cells[world.idx(x + 1, y)];
  const u = world.cells[world.idx(x, y - 1)];
  const d = world.cells[world.idx(x, y + 1)];
  const floorH = (l === Cell.FLOOR || l === Cell.DOOR) && (r === Cell.FLOOR || r === Cell.DOOR);
  const floorV = (u === Cell.FLOOR || u === Cell.DOOR) && (d === Cell.FLOOR || d === Cell.DOOR);
  const wallH = l === Cell.WALL && r === Cell.WALL;
  const wallV = u === Cell.WALL && d === Cell.WALL;
  if ((!floorH || !wallV) && (!floorV || !wallH)) return;

  world.cells[ci] = Cell.DOOR;
  world.doors.set(ci, {
    idx: ci,
    state: keyId ? DoorState.LOCKED : DoorState.CLOSED,
    roomA: -1,
    roomB: -1,
    keyId,
    timer: 0,
  });
}

function connectArchiveRoomToPoint(world: World, room: Room, tx: number, ty: number, floorTex = Tex.F_MARBLE_TILE): void {
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  const dx = world.delta(cx, tx);
  const dy = world.delta(cy, ty);
  let wx = cx;
  let wy = cy;
  let ox = cx;
  let oy = cy;

  if (Math.abs(dx) >= Math.abs(dy)) {
    wy = cy;
    if (dx >= 0) {
      wx = room.x + room.w;
      ox = wx + 1;
    } else {
      wx = room.x - 1;
      ox = wx - 1;
    }
    oy = wy;
  } else {
    wx = cx;
    if (dy >= 0) {
      wy = room.y + room.h;
      oy = wy + 1;
    } else {
      wy = room.y - 1;
      oy = wy - 1;
    }
    ox = wx;
  }

  placeDoorAt(world, wx, wy, room.id);
  carveArchiveLine(world, ox, oy, tx, ty, 1, floorTex);
}

function decorateClerkBridge(world: World, x: number, y: number, len: number, horizontal: boolean): void {
  for (let i = 0; i < len; i += 6) {
    const px = horizontal ? x + i : x;
    const py = horizontal ? y : y + i;
    setFeatureIfFloor(world, px, py, Feature.DESK);
    setFeatureIfFloor(world, horizontal ? px : px + 1, horizontal ? py + 1 : py, Feature.SCREEN);
  }
}

function buildStackCanyon(
  world: World,
  room: Room,
  vertical: boolean,
  rng: () => number,
): ArchivePoint[] {
  const { x, y, w, h } = room;
  const bridges: ArchivePoint[] = [];
  carveArchiveBlock(world, x, y, w, h, Tex.F_PARQUET, room.id);
  frameArchiveArea(world, x, y, w, h, Tex.MARBLE);

  if (vertical) {
    const bridgeYs = [y + 32, y + Math.floor(h / 2), y + h - 34];
    for (let sx = x + 9; sx < x + w - 8; sx += 13) {
      for (let sy = y + 4; sy < y + h - 4; sy++) {
        const bridge = bridgeYs.some(by => Math.abs(sy - by) <= 2);
        if (!bridge && (sy + sx) % 47 > 2) setArchiveWall(world, sx, sy, Tex.PANEL);
      }
      if (rng() < 0.6) addArchiveGate(world, sx, y + 16 + Math.floor(rng() * Math.max(1, h - 32)), rng() < 0.25 ? 'archive_access_permit' : '');
    }
    for (const by of bridgeYs) {
      carveArchiveLine(world, x + 3, by, x + w - 4, by, 2, Tex.F_MARBLE_TILE, room.id);
      decorateClerkBridge(world, x + 8, by - 1, w - 16, true);
      bridges.push({ x: x + Math.floor(w / 2), y: by });
    }
  } else {
    const bridgeXs = [x + 42, x + Math.floor(w / 2), x + w - 44];
    for (let sy = y + 8; sy < y + h - 8; sy += 12) {
      for (let sx = x + 4; sx < x + w - 4; sx++) {
        const bridge = bridgeXs.some(bx => Math.abs(sx - bx) <= 2);
        if (!bridge && (sx + sy) % 53 > 2) setArchiveWall(world, sx, sy, Tex.PANEL);
      }
      if (rng() < 0.55) addArchiveGate(world, x + 20 + Math.floor(rng() * Math.max(1, w - 40)), sy, rng() < 0.2 ? 'forged_stamp_sheet' : '');
    }
    for (const bx of bridgeXs) {
      carveArchiveLine(world, bx, y + 3, bx, y + h - 4, 2, Tex.F_MARBLE_TILE, room.id);
      decorateClerkBridge(world, bx - 1, y + 8, h - 16, false);
      bridges.push({ x: bx, y: y + Math.floor(h / 2) });
    }
  }

  return bridges;
}

interface ArchiveMacroMotif {
  id: number;
  weight: number;
  east: readonly number[];
  south: readonly number[];
}

const ARCHIVE_MACRO_MOTIFS: readonly ArchiveMacroMotif[] = [
  { id: 0, weight: 5, east: [0, 1, 3, 4], south: [0, 2, 3, 4] },
  { id: 1, weight: 4, east: [0, 1, 2, 4], south: [1, 2, 3, 4] },
  { id: 2, weight: 3, east: [1, 2, 3, 4], south: [0, 1, 2, 4] },
  { id: 3, weight: 2, east: [0, 2, 3, 4], south: [1, 2, 3, 4] },
  { id: 4, weight: 2, east: [0, 1, 2, 3, 4], south: [0, 1, 2, 3, 4] },
];

function chooseArchiveMacroMotif(motifs: Uint8Array, gx: number, gy: number, gw: number, rng: () => number): number {
  let total = 0;
  const weights = new Float32Array(ARCHIVE_MACRO_MOTIFS.length);
  const left = gx > 0 ? motifs[gy * gw + gx - 1] : 255;
  const top = gy > 0 ? motifs[(gy - 1) * gw + gx] : 255;
  for (let i = 0; i < ARCHIVE_MACRO_MOTIFS.length; i++) {
    const motif = ARCHIVE_MACRO_MOTIFS[i];
    if (left !== 255 && !ARCHIVE_MACRO_MOTIFS[left]?.east.includes(motif.id)) continue;
    if (top !== 255 && !ARCHIVE_MACRO_MOTIFS[top]?.south.includes(motif.id)) continue;
    total += motif.weight;
    weights[i] = motif.weight;
  }
  if (total <= 0) return 4;
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return ARCHIVE_MACRO_MOTIFS[i].id;
  }
  return 4;
}

function stampArchiveMacroMotif(world: World, cx: number, cy: number, motif: number): void {
  if (motif === 0) {
    for (let yy = -6; yy <= 6; yy++) {
      if (Math.abs(yy) <= 1) continue;
      setShelfWall(world, cx - 5, cy + yy);
      setShelfWall(world, cx + 5, cy + yy);
    }
    setFeatureIfFloor(world, cx - 2, cy - 4, Feature.SHELF);
    setFeatureIfFloor(world, cx + 2, cy + 4, Feature.SHELF);
  } else if (motif === 1) {
    for (let xx = -6; xx <= 6; xx++) {
      if (Math.abs(xx) <= 1) continue;
      setShelfWall(world, cx + xx, cy - 5);
      setShelfWall(world, cx + xx, cy + 5);
    }
    setFeatureIfFloor(world, cx - 4, cy + 2, Feature.SHELF);
    setFeatureIfFloor(world, cx + 4, cy - 2, Feature.SHELF);
  } else if (motif === 2) {
    for (let d = -5; d <= 5; d++) {
      if (Math.abs(d) <= 1) continue;
      setShelfWall(world, cx - 5, cy + d);
      setShelfWall(world, cx + d, cy + 5);
    }
    setFeatureIfFloor(world, cx + 3, cy - 3, Feature.DESK);
  } else if (motif === 3) {
    for (let d = -4; d <= 4; d++) {
      if (Math.abs(d) <= 1) continue;
      setShelfWall(world, cx + 5, cy + d);
    }
    setFeatureIfFloor(world, cx - 3, cy, Feature.SCREEN);
    setFeatureIfFloor(world, cx - 4, cy + 2, Feature.DESK);
  } else {
    setFeatureIfFloor(world, cx - 3, cy - 2, Feature.CHAIR);
    setFeatureIfFloor(world, cx + 3, cy + 2, Feature.CHAIR);
    setFeatureIfFloor(world, cx, cy - 4, Feature.LAMP);
  }
}

function archiveMazeNeighbors(idx: number, gw: number, gh: number): number[] {
  const gx = idx % gw;
  const gy = Math.floor(idx / gw);
  const out: number[] = [];
  if (gx > 0) out.push(idx - 1);
  if (gx < gw - 1) out.push(idx + 1);
  if (gy > 0) out.push(idx - gw);
  if (gy < gh - 1) out.push(idx + gw);
  return out;
}

function connectArchiveMazeCells(edges: Uint8Array, a: number, b: number, gw: number): void {
  if (b === a + 1) {
    edges[a] |= 1;
    edges[b] |= 4;
  } else if (b === a - 1) {
    edges[a] |= 4;
    edges[b] |= 1;
  } else if (b === a + gw) {
    edges[a] |= 2;
    edges[b] |= 8;
  } else if (b === a - gw) {
    edges[a] |= 8;
    edges[b] |= 2;
  }
}

function archiveMazeDegree(edges: Uint8Array, idx: number): number {
  let degree = 0;
  const bits = edges[idx];
  if (bits & 1) degree++;
  if (bits & 2) degree++;
  if (bits & 4) degree++;
  if (bits & 8) degree++;
  return degree;
}

function buildWilsonBraidedArchiveGraph(gw: number, gh: number, rng: () => number): Uint8Array {
  const total = gw * gh;
  const inTree = new Uint8Array(total);
  const edges = new Uint8Array(total);
  let treeCount = 1;
  inTree[Math.floor(rng() * total)] = 1;

  while (treeCount < total) {
    let start = Math.floor(rng() * total);
    while (inTree[start]) start = (start + 1) % total;
    const path = [start];
    const pathIndex = new Int16Array(total);
    pathIndex.fill(-1);
    pathIndex[start] = 0;
    let cur = start;

    while (!inTree[cur]) {
      const neighbors = archiveMazeNeighbors(cur, gw, gh);
      const next = neighbors[Math.floor(rng() * neighbors.length)];
      const seen = pathIndex[next];
      if (seen >= 0) {
        for (let i = seen + 1; i < path.length; i++) pathIndex[path[i]] = -1;
        path.length = seen + 1;
      } else {
        pathIndex[next] = path.length;
        path.push(next);
      }
      cur = next;
    }

    for (let i = 1; i < path.length; i++) connectArchiveMazeCells(edges, path[i - 1], path[i], gw);
    for (const idx of path) {
      if (!inTree[idx]) {
        inTree[idx] = 1;
        treeCount++;
      }
    }
  }

  for (let idx = 0; idx < total; idx++) {
    const degree = archiveMazeDegree(edges, idx);
    for (const next of archiveMazeNeighbors(idx, gw, gh)) {
      if (next < idx) continue;
      const already = next === idx + 1 ? (edges[idx] & 1) : next === idx + gw ? (edges[idx] & 2) : false;
      if (already) continue;
      const braidChance = degree <= 1 ? 0.5 : 0.16;
      if (rng() < braidChance) connectArchiveMazeCells(edges, idx, next, gw);
    }
  }

  return edges;
}

function decorateArchiveLandmark(world: World, x: number, y: number, n: number): void {
  carveArchiveDisc(world, x, y, 4, Tex.F_MARBLE_TILE);
  setFeatureIfFloor(world, x, y - 3, Feature.LAMP);
  setFeatureIfFloor(world, x - 2, y, n % 2 === 0 ? Feature.SCREEN : Feature.DESK);
  setFeatureIfFloor(world, x + 2, y, n % 3 === 0 ? Feature.APPARATUS : Feature.SHELF);
  setFeatureIfFloor(world, x, y + 3, n % 2 === 0 ? Feature.CHAIR : Feature.CANDLE);
}

function buildBraidedArchiveStack(world: World, room: Room, rng: () => number, step = 18): ArchivePoint[] {
  const pad = 10;
  const gw = Math.max(5, Math.floor((room.w - pad * 2) / step));
  const gh = Math.max(5, Math.floor((room.h - pad * 2) / step));
  const left = room.x + Math.floor((room.w - gw * step) / 2);
  const top = room.y + Math.floor((room.h - gh * step) / 2);
  const motifs = new Uint8Array(gw * gh);
  const edges = buildWilsonBraidedArchiveGraph(gw, gh, rng);
  const landmarks: ArchivePoint[] = [];

  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const idx = gy * gw + gx;
      motifs[idx] = chooseArchiveMacroMotif(motifs, gx, gy, gw, rng);
      const cx = left + gx * step + Math.floor(step / 2);
      const cy = top + gy * step + Math.floor(step / 2);
      stampArchiveMacroMotif(world, cx, cy, motifs[idx]);
    }
  }

  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const idx = gy * gw + gx;
      const cx = left + gx * step + Math.floor(step / 2);
      const cy = top + gy * step + Math.floor(step / 2);
      carveArchiveDisc(world, cx, cy, 2, Tex.F_PARQUET, room.id);
      if ((edges[idx] & 1) && gx < gw - 1) carveArchiveLine(world, cx, cy, cx + step, cy, 1, Tex.F_PARQUET, room.id);
      if ((edges[idx] & 2) && gy < gh - 1) carveArchiveLine(world, cx, cy, cx, cy + step, 1, Tex.F_PARQUET, room.id);
    }
  }

  for (let gy = 1; gy < gh - 1; gy++) {
    for (let gx = 1; gx < gw - 1; gx++) {
      const idx = gy * gw + gx;
      const degree = archiveMazeDegree(edges, idx);
      if (degree < 3 && rng() > 0.18) continue;
      const cx = left + gx * step + Math.floor(step / 2);
      const cy = top + gy * step + Math.floor(step / 2);
      if (landmarks.some(p => world.dist2(p.x, p.y, cx, cy) < 52 * 52)) continue;
      decorateArchiveLandmark(world, cx, cy, landmarks.length);
      landmarks.push({ x: cx, y: cy });
      if (landmarks.length >= 8) return landmarks;
    }
  }

  const fallback = [
    { x: left + Math.floor(step * 1.5), y: top + Math.floor(step * 1.5) },
    { x: left + Math.floor((gw - 1.5) * step), y: top + Math.floor(step * 1.5) },
    { x: left + Math.floor(step * 1.5), y: top + Math.floor((gh - 1.5) * step) },
    { x: left + Math.floor((gw - 1.5) * step), y: top + Math.floor((gh - 1.5) * step) },
  ];
  for (const point of fallback) {
    if (landmarks.length >= 4) break;
    decorateArchiveLandmark(world, point.x, point.y, landmarks.length);
    landmarks.push(point);
  }
  return landmarks;
}

function decorateDocumentLane(world: World, ax: number, ay: number, bx: number, by: number): void {
  const horizontal = ay === by;
  const len = horizontal ? Math.abs(bx - ax) : Math.abs(by - ay);
  const sx = bx >= ax ? 1 : -1;
  const sy = by >= ay ? 1 : -1;
  for (let d = 0; d <= len; d += 14) {
    const x = horizontal ? ax + d * sx : ax;
    const y = horizontal ? ay : ay + d * sy;
    setFeatureIfFloor(world, x, y, d % 28 === 0 ? Feature.SCREEN : Feature.DESK);
    setFeatureIfFloor(world, horizontal ? x : x + 2, horizontal ? y + 2 : y, Feature.SHELF);
    setFeatureIfFloor(world, horizontal ? x : x - 2, horizontal ? y - 2 : y, Feature.CHAIR);
  }
}

function buildArchiveLoop(world: World): ArchivePoint[] {
  const nodes: ArchivePoint[] = [
    { x: 142, y: 154 }, { x: 512, y: 154 }, { x: 884, y: 154 },
    { x: 884, y: 512 }, { x: 884, y: 864 }, { x: 512, y: 864 },
    { x: 142, y: 864 }, { x: 142, y: 512 },
  ];
  for (let i = 1; i < nodes.length; i++) {
    carveArchiveLine(world, nodes[i - 1].x, nodes[i - 1].y, nodes[i].x, nodes[i].y, 2, Tex.F_MARBLE_TILE);
  }
  carveArchiveLine(world, nodes[nodes.length - 1].x, nodes[nodes.length - 1].y, nodes[0].x, nodes[0].y, 2, Tex.F_MARBLE_TILE);

  carveArchiveLine(world, 256, 154, 256, 864, 2, Tex.F_MARBLE_TILE);
  carveArchiveLine(world, 512, 154, 512, 864, 2, Tex.F_MARBLE_TILE);
  carveArchiveLine(world, 768, 154, 768, 864, 2, Tex.F_MARBLE_TILE);
  carveArchiveLine(world, 142, 256, 884, 256, 2, Tex.F_MARBLE_TILE);
  carveArchiveLine(world, 142, 512, 884, 512, 2, Tex.F_MARBLE_TILE);
  carveArchiveLine(world, 142, 768, 884, 768, 2, Tex.F_MARBLE_TILE);

  carveArchiveLine(world, 530, 464, 530, 154, 2, Tex.F_MARBLE_TILE);
  carveArchiveLine(world, 530, 552, 530, 864, 2, Tex.F_MARBLE_TILE);
  carveArchiveLine(world, 512, 464, 142, 464, 1, Tex.F_MARBLE_TILE);
  carveArchiveLine(world, 568, 507, 884, 507, 1, Tex.F_MARBLE_TILE);
  return nodes;
}

function carveReadingPit(world: World, room: Room): void {
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  const rx = Math.floor(room.w / 3);
  const ry = Math.floor(room.h / 3);
  for (let y = room.y + 5; y < room.y + room.h - 5; y++) {
    for (let x = room.x + 6; x < room.x + room.w - 6; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      if (nx * nx + ny * ny > 1) continue;
      const bridge = Math.abs(x - cx) <= 2 || Math.abs(y - cy) <= 2;
      const ci = world.idx(x, y);
      if (world.roomMap[ci] !== room.id || bridge) continue;
      world.cells[ci] = Cell.ABYSS;
      world.floorTex[ci] = Tex.F_ABYSS;
      world.features[ci] = Feature.NONE;
    }
  }
  for (let x = room.x + 8; x < room.x + room.w - 8; x += 12) {
    setFeatureIfFloor(world, x, room.y + 5, Feature.CHAIR);
    setFeatureIfFloor(world, x, room.y + room.h - 6, Feature.SHELF);
  }
  setFeatureIfFloor(world, cx - 3, cy, Feature.DESK);
  setFeatureIfFloor(world, cx + 3, cy, Feature.SCREEN);
  setFeatureIfFloor(world, room.x + 4, room.y + 4, Feature.CANDLE);
  setFeatureIfFloor(world, room.x + room.w - 5, room.y + room.h - 5, Feature.CANDLE);
}

function decorateVaultRoom(world: World, room: Room): void {
  for (let y = room.y + 4; y < room.y + room.h - 4; y += 5) {
    for (let x = room.x + 5; x < room.x + room.w - 5; x += 7) {
      setShelfWall(world, x, y);
      setFeatureIfFloor(world, x + 1, y, Feature.SHELF);
    }
  }
  setFeatureIfFloor(world, room.x + 3, room.y + 3, Feature.LAMP);
  setFeatureIfFloor(world, room.x + room.w - 4, room.y + room.h - 4, Feature.APPARATUS);
}

function buildArchiveMicroGrid(world: World, spec: ArchiveMicroGridSpec): number {
  const pitchX = spec.roomW + spec.gapX;
  const pitchY = spec.roomH + spec.gapY;
  const left = spec.x - 4;
  const right = spec.x + (spec.cols - 1) * pitchX + spec.roomW + 4;
  let stamped = 0;

  for (let row = 0; row < spec.rows; row++) {
    const roomY = spec.y + row * pitchY;
    const corridorY = roomY + spec.roomH + 1;
    carveArchiveLine(world, left, corridorY, right, corridorY, 1, spec.floorTex);
    for (let col = 0; col < spec.cols; col++) {
      const roomType = spec.roomTypes[(row * spec.cols + col) % spec.roomTypes.length];
      const room = stampOwnedArchiveRoom(
        world,
        roomType,
        spec.x + col * pitchX,
        roomY,
        spec.roomW,
        spec.roomH,
        `${spec.name} ${row + 1}.${col + 1}`,
        spec.owner,
        spec.wallTex,
        spec.floorTex,
      );
      if (!room) continue;
      decorateArchiveMicroRoom(world, room, spec.owner, stamped);
      addArchiveDoorOnSide(world, room, 'south');
      stamped++;
    }
  }

  const spineX = spec.x + Math.floor(((spec.cols - 1) * pitchX + spec.roomW) / 2);
  carveArchiveLine(
    world,
    spineX,
    spec.y + spec.roomH + 1,
    spineX,
    spec.y + (spec.rows - 1) * pitchY + spec.roomH + 1,
    1,
    spec.floorTex,
  );
  carveArchiveLine(
    world,
    spineX,
    spec.y + Math.floor((spec.rows * pitchY) / 2),
    spec.connector.x,
    spec.connector.y,
    1,
    spec.floorTex,
  );
  for (let row = 0; row < spec.rows; row += 2) {
    setFeatureIfFloor(world, spineX, spec.y + row * pitchY + spec.roomH + 1, Feature.LAMP);
  }
  return stamped;
}

function archiveHqSupportSpecs(owner: TerritoryOwner): readonly { type: RoomType; name: string; wallTex: Tex; floorTex: Tex }[] {
  switch (owner) {
    case ZoneFaction.LIQUIDATOR:
      return [
        { type: RoomType.OFFICE, name: 'дежурная проверки', wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
        { type: RoomType.STORAGE, name: 'шкаф актов прожига', wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
        { type: RoomType.MEDICAL, name: 'перевязочная дыма', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
        { type: RoomType.KITCHEN, name: 'кипяток караула', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
        { type: RoomType.BATHROOM, name: 'санузел поста', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      ] as const;
    case ZoneFaction.SCIENTIST:
      return [
        { type: RoomType.PRODUCTION, name: 'стол индексации', wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
        { type: RoomType.MEDICAL, name: 'изолятор плесени', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
        { type: RoomType.STORAGE, name: 'шкаф приборов', wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
        { type: RoomType.OFFICE, name: 'журнал сверки', wallTex: Tex.MARBLE, floorTex: Tex.F_MARBLE_TILE },
        { type: RoomType.BATHROOM, name: 'санпропускник', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      ] as const;
    case ZoneFaction.WILD:
      return [
        { type: RoomType.STORAGE, name: 'свалка адресов', wallTex: Tex.ROTTEN, floorTex: Tex.F_WOOD },
        { type: RoomType.KITCHEN, name: 'коптилка бланков', wallTex: Tex.ROTTEN, floorTex: Tex.F_CONCRETE },
        { type: RoomType.SMOKING, name: 'лежанки наследников', wallTex: Tex.ROTTEN, floorTex: Tex.F_WOOD },
        { type: RoomType.OFFICE, name: 'стол подделки', wallTex: Tex.PANEL, floorTex: Tex.F_WOOD },
        { type: RoomType.BATHROOM, name: 'ржавая вода', wallTex: Tex.TILE_W, floorTex: Tex.F_WATER },
      ] as const;
    case ZoneFaction.CULTIST:
      return [
        { type: RoomType.COMMON, name: 'круг пепельной фамилии', wallTex: Tex.ROTTEN, floorTex: Tex.F_MEAT },
        { type: RoomType.STORAGE, name: 'кладовая масок', wallTex: Tex.ROTTEN, floorTex: Tex.F_WOOD },
        { type: RoomType.MEDICAL, name: 'тихая перевязка', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
        { type: RoomType.SMOKING, name: 'дымная ведомость', wallTex: Tex.ROTTEN, floorTex: Tex.F_MEAT },
        { type: RoomType.BATHROOM, name: 'умывальная золы', wallTex: Tex.TILE_W, floorTex: Tex.F_WATER },
      ] as const;
    case ZoneFaction.CITIZEN:
    default:
      return [
        { type: RoomType.COMMON, name: 'общая ожидания', wallTex: Tex.PANEL, floorTex: Tex.F_PARQUET },
        { type: RoomType.KITCHEN, name: 'чайная очередь', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
        { type: RoomType.STORAGE, name: 'шкаф пайков и дел', wallTex: Tex.PANEL, floorTex: Tex.F_CONCRETE },
        { type: RoomType.MEDICAL, name: 'медицинский стол', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
        { type: RoomType.BATHROOM, name: 'санузел ожидания', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      ] as const;
  }
}

function buildArchiveHqCompound(world: World, spec: ArchiveHqSpec): void {
  const hubX = spec.x + 12;
  const hubY = spec.y + 22;
  carveArchiveLine(world, spec.x - 34, hubY, spec.x + 64, hubY, 2, spec.floorTex);
  carveArchiveLine(world, hubX, hubY, spec.linkX, spec.linkY, 1, spec.floorTex);

  const hq = stampOwnedArchiveRoom(
    world,
    RoomType.HQ,
    spec.x,
    spec.y,
    24,
    16,
    spec.name,
    spec.owner,
    spec.wallTex,
    spec.floorTex,
  );
  if (hq) {
    markArchiveHermeticShell(world, hq);
    decorateArchiveMicroRoom(world, hq, spec.owner, 0);
    const outside = addArchiveDoorOnSide(world, hq, 'south', DoorState.HERMETIC_OPEN);
    carveArchiveLine(world, outside.x, outside.y, hubX, hubY, 1, spec.floorTex);
  }

  const placements = [
    { dx: -30, dy: 2, w: 22, h: 11, side: 'east' as const },
    { dx: 32, dy: 2, w: 22, h: 11, side: 'west' as const },
    { dx: -28, dy: 30, w: 20, h: 10, side: 'north' as const },
    { dx: 7, dy: 31, w: 16, h: 9, side: 'north' as const },
    { dx: 32, dy: 30, w: 22, h: 10, side: 'north' as const },
  ] as const;
  const supports = archiveHqSupportSpecs(spec.owner);
  for (let i = 0; i < supports.length; i++) {
    const support = supports[i];
    const place = placements[i];
    const room = stampOwnedArchiveRoom(
      world,
      support.type,
      spec.x + place.dx,
      spec.y + place.dy,
      place.w,
      place.h,
      `${spec.name}: ${support.name}`,
      spec.owner,
      support.wallTex,
      support.floorTex,
    );
    if (!room) continue;
    decorateArchiveMicroRoom(world, room, spec.owner, i + 1);
    const outside = addArchiveDoorOnSide(world, room, place.side);
    carveArchiveLine(world, outside.x, outside.y, hubX, hubY, 1, spec.floorTex);
  }
}

function buildRaionsovetArchiveMicroLayer(world: World): void {
  for (const spec of RAIONSOVET_ARCHIVE_HQ_SPECS) buildArchiveHqCompound(world, spec);
  for (const spec of RAIONSOVET_ARCHIVE_MICRO_GRIDS) buildArchiveMicroGrid(world, spec);
}

export function reinforceRaionsovetArchiveAuthoredHqTerritory(world: World): void {
  for (const spec of RAIONSOVET_ARCHIVE_HQ_SPECS) {
    for (const room of world.rooms) {
      if (!room) continue;
      if (room.name !== spec.name && !room.name.startsWith(`${spec.name}:`)) continue;
      paintArchiveRoomTerritory(world, room, spec.owner);
      if (room.type === RoomType.HQ) {
        markArchiveHermeticShell(world, room);
        room.sealed = true;
      }
    }
  }
  world.markWallTexDirty();
  world.markFeaturesDirty(true);
}

function decorateServiceLiftRoom(world: World, room: Room): void {
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  placeFixedLift(world, cx, cy, LiftDirection.DOWN);
  for (let y = room.y + 5; y < room.y + room.h - 5; y += 7) {
    setFeatureIfFloor(world, room.x + 5, y, Feature.APPARATUS);
    setFeatureIfFloor(world, room.x + room.w - 6, y, Feature.MACHINE);
  }
  setFeatureIfFloor(world, cx - 5, cy, Feature.SCREEN);
  setFeatureIfFloor(world, cx + 5, cy, Feature.DESK);
}

function nextArchiveContainerId(world: World): { v: number } {
  return { v: world.containers.reduce((max, container) => Math.max(max, container.id), 0) + 1 };
}

export function expandRaionsovetArchiveGeometry(world: World, rng: () => number): void {
  paintNonRoomCells(world);
  const westStacks = createArchiveRoom(world, world.rooms.length, RoomType.STORAGE, 78, 184, 286, 296, 'Западная картотека квартирных карточек', Tex.PANEL, Tex.F_PARQUET);
  const eastStacks = createArchiveRoom(world, world.rooms.length, RoomType.STORAGE, 660, 176, 286, 318, 'Восточная картотека маршрутных дел', Tex.PANEL, Tex.F_PARQUET);
  const lowerStacks = createArchiveRoom(world, world.rooms.length, RoomType.STORAGE, 158, 690, 410, 198, 'Нижний архив спорных копий', Tex.PANEL, Tex.F_PARQUET);
  const formQueue = createArchiveRoom(world, world.rooms.length, RoomType.COMMON, 182, 62, 658, 104, 'Длинная очередь формуляров', Tex.MARBLE, Tex.F_PARQUET);
  const bridges = [
    ...buildStackCanyon(world, westStacks, true, rng),
    ...buildStackCanyon(world, eastStacks, true, rng),
    ...buildStackCanyon(world, lowerStacks, false, rng),
    ...buildStackCanyon(world, formQueue, false, rng),
  ];
  const landmarks = [
    ...buildBraidedArchiveStack(world, westStacks, rng),
    ...buildBraidedArchiveStack(world, eastStacks, rng),
    ...buildBraidedArchiveStack(world, lowerStacks, rng),
  ];
  const loopNodes = buildArchiveLoop(world);

  for (let i = 1; i < bridges.length; i++) {
    if (i % 2 === 0) carveArchiveLine(world, bridges[i - 1].x, bridges[i - 1].y, bridges[i].x, bridges[i].y, 1, Tex.F_MARBLE_TILE);
  }
  for (const node of loopNodes) setFeatureIfFloor(world, node.x, node.y, Feature.LAMP);
  for (const point of landmarks) carveArchiveLine(world, point.x, point.y, 512, point.y < 512 ? 256 : 768, 1, Tex.F_MARBLE_TILE);
  decorateDocumentLane(world, 142, 256, 884, 256);
  decorateDocumentLane(world, 142, 512, 884, 512);
  decorateDocumentLane(world, 142, 768, 884, 768);
  decorateDocumentLane(world, 256, 154, 256, 864);
  decorateDocumentLane(world, 512, 154, 512, 864);
  decorateDocumentLane(world, 768, 154, 768, 864);

  const counterHall = createArchiveRoom(world, world.rooms.length, RoomType.OFFICE, 392, 418, 242, 36, 'Мост счетных окон', Tex.MARBLE, Tex.F_RED_CARPET);
  const westVault = createArchiveRoom(world, world.rooms.length, RoomType.STORAGE, 174, 288, 76, 56, 'Запечатанный ряд квартирных прав', Tex.METAL, Tex.F_CONCRETE);
  const eastVault = createArchiveRoom(world, world.rooms.length, RoomType.STORAGE, 778, 308, 72, 58, 'Восточный сейф личных дел', Tex.METAL, Tex.F_CONCRETE);
  const readingPit = createArchiveRoom(world, world.rooms.length, RoomType.COMMON, 372, 594, 278, 104, 'Читальный провал личных дел', Tex.MARBLE, Tex.F_PARQUET);
  const serviceLift = createArchiveRoom(world, world.rooms.length, RoomType.PRODUCTION, 706, 548, 88, 62, 'Служебный лифт документов', Tex.METAL, Tex.F_CONCRETE);

  connectArchiveRoomToPoint(world, counterHall, 530, 464, Tex.F_MARBLE_TILE);
  connectArchiveRoomToPoint(world, westVault, 256, 256, Tex.F_MARBLE_TILE);
  connectArchiveRoomToPoint(world, eastVault, 768, 256, Tex.F_MARBLE_TILE);
  connectArchiveRoomToPoint(world, readingPit, 530, 552, Tex.F_MARBLE_TILE);
  connectArchiveRoomToPoint(world, readingPit, 512, 768, Tex.F_MARBLE_TILE);
  connectArchiveRoomToPoint(world, serviceLift, 768, 512, Tex.F_MARBLE_TILE);

  for (const room of [counterHall, westVault, eastVault, readingPit, serviceLift]) paintRoom(world, room);
  for (let x = counterHall.x + 8; x < counterHall.x + counterHall.w - 8; x += 8) {
    setFeatureIfFloor(world, x, counterHall.y + 8, Feature.DESK);
    setFeatureIfFloor(world, x, counterHall.y + counterHall.h - 8, Feature.CHAIR);
  }
  setFeatureIfFloor(world, counterHall.x + 5, counterHall.y + 5, Feature.SCREEN);
  setFeatureIfFloor(world, counterHall.x + counterHall.w - 6, counterHall.y + 5, Feature.LAMP);

  decorateVaultRoom(world, westVault);
  decorateVaultRoom(world, eastVault);
  carveReadingPit(world, readingPit);
  decorateServiceLiftRoom(world, serviceLift);
  buildRaionsovetArchiveMicroLayer(world);

  const nextContainerId = nextArchiveContainerId(world);
  addArchiveContainer(
    world, nextContainerId, westVault, westVault.x + westVault.w - 6, westVault.y + westVault.h - 6,
    ContainerKind.SAFE,
    'Пломбированный шкаф квартирного ряда',
    'locked',
    [
      { defId: 'personal_file_copy', count: 1 },
      { defId: 'stolen_archive_card', count: 1 },
      { defId: 'passport_stub', count: 1 },
    ],
    ['vault', 'apartment_rights', 'force_or_permit'],
    Faction.CITIZEN,
  );
  addArchiveContainer(
    world, nextContainerId, eastVault, eastVault.x + eastVault.w - 6, eastVault.y + 5,
    ContainerKind.FILING_CABINET,
    'Индекс вскрытых наследств',
    'faction',
    [
      { defId: 'missing_record_file', count: 1 },
      { defId: 'record_exposure_notice', count: 1 },
      { defId: 'ration_registry_extract', count: 1 },
    ],
    ['vault', 'expose_record', 'personal_file'],
    Faction.CITIZEN,
  );

  stampSurfaceSplat(world, 236, 318, 0.5, 0.5, 5, 0.45, 6021, 0.55, 0.09, 0.04, false);
  stampSurfaceSplat(world, 812, 338, 0.5, 0.5, 5, 0.35, 6022, 0.08, 0.12, 0.18, false);
  stampSurfaceSplat(world, 512, 646, 0.5, 0.5, 8, 0.22, 6023, 0.7, 0.68, 0.55, true);
  world.markCellsDirty();
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFeaturesDirty(true);
}

function connectRoomToPoint(world: World, room: Room, tx: number, ty: number): void {
  const exit = roomExit(world, room, tx, ty);
  placeDoorAt(world, exit.wx, exit.wy, room.id);
  carveCorridor(world, exit.ox, exit.oy, tx, ty);
}

function placeFixedLift(world: World, x: number, y: number, direction: LiftDirection): void {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.LIFT;
  world.wallTex[ci] = Tex.LIFT_DOOR;
  world.liftDir[ci] = direction;
  const bi = world.idx(x, y + (direction === LiftDirection.UP ? 1 : -1));
  if (world.cells[bi] === Cell.FLOOR) {
    world.features[bi] = Feature.LIFT_BUTTON;
    world.liftDir[bi] = direction;
  }
}

function addDrop(entities: Entity[], nextId: { v: number }, x: number, y: number, defId: string, count = 1): void {
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

function spawnArchiveNpc(
  entities: Entity[],
  nextId: { v: number },
  _def: PlotNpcDef,
  plotNpcId: string,
  x: number,
  y: number,
  weapon?: string,
): void {
  requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle: Math.PI,
    weapon,
    canGiveQuest: true,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
  });
}

function spawnArchiveGuard(entities: Entity[], nextId: { v: number }, x: number, y: number): void {
  entities.push({
    id: nextId.v++,
    type: EntityType.NPC,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.PI / 2,
    pitch: 0,
    alive: true,
    speed: 0.95,
    sprite: Occupation.HUNTER,
    name: 'Кислов Проверяющий',
    isFemale: false,
    needs: freshNeeds(),
    hp: 220,
    maxHp: 220,
    money: 45,
    ai: { goal: AIGoal.IDLE, tx: x + 0.5, ty: y + 0.5, path: [], pi: 0, stuck: 0, timer: 0 },
    inventory: [
      { defId: 'makarov', count: 1 },
      { defId: 'ammo_9mm', count: 10 },
      { defId: 'denunciation', count: 1 },
    ],
    weapon: 'makarov',
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    questId: -1,
  });
}

function spawnArchiveMonster(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  x: number,
  y: number,
  kind: MonsterKind,
): void {
  const def = MONSTERS[kind];
  if (!def) return;
  const ci = world.idx(x, y);
  const zoneId = world.zoneMap[ci];
  const zoneLevel = world.zones[zoneId]?.level ?? 1;
  const hp = scaleMonsterHp(def.hp, zoneLevel);
  const monster: Entity = {
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
  };
  entities.push(monster);
}

function addArchiveContainer(
  world: World,
  nextContainerId: { v: number },
  room: Room,
  x: number,
  y: number,
  kind: ContainerKind,
  name: string,
  access: WorldContainer['access'],
  inventory: WorldContainer['inventory'],
  tags: string[],
  faction?: Faction,
): void {
  world.addContainer({
    id: nextContainerId.v++,
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
    discovered: true,
    tags: [RAIONSOVET_ARCHIVE_ROUTE_ID, ...tags],
  });
}

function decorateArchive(world: World, rooms: ArchiveRooms): void {
  const { waiting, clerk, catalog, shelves, stamp, fire, heir, market, checker } = rooms;

  for (let x = waiting.x + 3; x < waiting.x + waiting.w - 3; x += 3) {
    setFeatureIfFloor(world, x, waiting.y + 4, Feature.CHAIR);
    setFeatureIfFloor(world, x, waiting.y + 8, Feature.CHAIR);
  }
  setFeatureIfFloor(world, waiting.x + 2, waiting.y + 2, Feature.SCREEN);
  setFeatureIfFloor(world, waiting.x + waiting.w - 3, waiting.y + 2, Feature.LAMP);

  for (let x = clerk.x + 2; x < clerk.x + clerk.w - 2; x++) setFeatureIfFloor(world, x, clerk.y + clerk.h - 3, Feature.DESK);
  for (let x = clerk.x + 4; x < clerk.x + clerk.w - 4; x += 5) setFeatureIfFloor(world, x, clerk.y + 2, Feature.SHELF);
  setFeatureIfFloor(world, clerk.x + 2, clerk.y + 2, Feature.LAMP);

  for (let x = catalog.x + 4; x < catalog.x + catalog.w - 2; x += 4) {
    for (let y = catalog.y + 2; y < catalog.y + catalog.h - 2; y++) {
      if ((y - catalog.y) % 5 === 0) continue;
      setShelfWall(world, x, y);
    }
  }
  setFeatureIfFloor(world, catalog.x + 2, catalog.y + 2, Feature.LAMP);
  setFeatureIfFloor(world, catalog.x + catalog.w - 3, catalog.y + catalog.h - 3, Feature.SCREEN);

  for (let x = shelves.x + 3; x < shelves.x + shelves.w - 2; x += 5) {
    for (let y = shelves.y + 2; y < shelves.y + shelves.h - 2; y++) {
      if ((y - shelves.y) % 6 === 0) continue;
      setShelfWall(world, x, y);
    }
  }
  setFeatureIfFloor(world, shelves.x + shelves.w - 3, shelves.y + 2, Feature.LAMP);
  stampSurfaceSplat(world, shelves.x + 5, shelves.y + shelves.h - 5, 0.5, 0.5, 3, 0.65, 41, 0.7, 0.12, 0.05, false);

  for (let x = stamp.x + 3; x < stamp.x + stamp.w - 3; x += 4) setFeatureIfFloor(world, x, stamp.y + 3, Feature.DESK);
  setFeatureIfFloor(world, stamp.x + stamp.w - 4, stamp.y + stamp.h - 3, Feature.APPARATUS);
  setFeatureIfFloor(world, stamp.x + 2, stamp.y + stamp.h - 3, Feature.SHELF);

  for (let y = fire.y + 2; y < fire.y + fire.h - 2; y += 3) {
    setShelfWall(world, fire.x + 4, y);
    setShelfWall(world, fire.x + 10, y);
    setFeatureIfFloor(world, fire.x + fire.w - 3, y, Feature.CANDLE);
  }
  stampSurfaceSplat(world, fire.x + 5, fire.y + 5, 0.5, 0.5, 4, 0.9, 17, 0.65, 0.08, 0.04, false);

  setFeatureIfFloor(world, heir.x + 3, heir.y + 3, Feature.DESK);
  setFeatureIfFloor(world, heir.x + heir.w - 3, heir.y + 3, Feature.CHAIR);
  setFeatureIfFloor(world, heir.x + 2, heir.y + heir.h - 3, Feature.SHELF);

  setFeatureIfFloor(world, market.x + 2, market.y + 2, Feature.SCREEN);
  setFeatureIfFloor(world, market.x + market.w - 3, market.y + 2, Feature.DESK);
  setFeatureIfFloor(world, market.x + market.w - 3, market.y + market.h - 3, Feature.SHELF);

  for (let x = checker.x + 2; x < checker.x + checker.w - 2; x++) setFeatureIfFloor(world, x, checker.y + checker.h - 3, Feature.DESK);
  setFeatureIfFloor(world, checker.x + checker.w - 3, checker.y + 2, Feature.LAMP);
}

function paintNonRoomCells(world: World): void {
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.WALL) {
      if (world.wallTex[i] === Tex.CONCRETE) world.wallTex[i] = Tex.MARBLE;
    } else if (world.roomMap[i] < 0) {
      world.floorTex[i] = Tex.F_MARBLE_TILE;
    }
  }
}

export function generateRaionsovetArchiveDesignFloor(): FloorGeneration {
  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 1 };
  const nextContainerId = { v: 1 };

  for (let i = 0; i < W * W; i++) {
    world.wallTex[i] = Tex.MARBLE;
    world.floorTex[i] = Tex.F_MARBLE_TILE;
  }

  let roomId = 0;
  const waiting = createArchiveRoom(world, roomId++, RoomType.COMMON, 500, 500, 24, 14, 'Райсоветская очередь', Tex.MARBLE, Tex.F_RED_CARPET);
  const clerk = createArchiveRoom(world, roomId++, RoomType.OFFICE, 500, 487, 24, 12, 'Окна выдачи маршрутов');
  const catalog = createArchiveRoom(world, roomId++, RoomType.STORAGE, 525, 500, 22, 14, 'Каталожные коридоры', Tex.MARBLE, Tex.F_PARQUET);
  const shelves = createArchiveRoom(world, roomId++, RoomType.STORAGE, 548, 496, 20, 22, 'Закрытые жилые полки', Tex.PANEL, Tex.F_WOOD);
  const stamp = createArchiveRoom(world, roomId++, RoomType.OFFICE, 500, 515, 18, 12, 'Комната печатей');
  const fire = createArchiveRoom(world, roomId++, RoomType.STORAGE, 479, 500, 20, 14, 'Западные зараженные стеллажи', Tex.ROTTEN, Tex.F_CONCRETE);
  const heir = createArchiveRoom(world, roomId++, RoomType.OFFICE, 519, 515, 17, 12, 'Кабинет ложного наследника');
  const market = createArchiveRoom(world, roomId++, RoomType.OFFICE, 537, 515, 10, 12, 'Лицензионная ниша рынка 88');
  const checker = createArchiveRoom(world, roomId++, RoomType.OFFICE, 525, 487, 18, 12, 'Проверяющий пост');
  const rooms: ArchiveRooms = { waiting, clerk, catalog, shelves, stamp, fire, heir, market, checker };

  placeDoor(world, waiting, clerk, '', false);
  placeDoor(world, waiting, catalog, '', false);
  placeDoor(world, waiting, stamp, '', false);
  placeDoor(world, waiting, fire, '', false);
  placeDoor(world, stamp, heir, '', false);
  placeDoor(world, heir, market, '', false);
  placeDoor(world, catalog, checker, '', false);
  placeDoor(world, catalog, shelves, 'archive_access_permit', false);
  placeDoor(world, market, shelves, 'forged_stamp_sheet', false);

  connectRoomToPoint(world, waiting, 512, 464);
  connectRoomToPoint(world, waiting, 512, 552);
  carveCorridor(world, 512, 464, 530, 464);
  carveCorridor(world, 512, 552, 530, 552);
  placeFixedLift(world, 530, 464, LiftDirection.UP);
  placeFixedLift(world, 530, 552, LiftDirection.DOWN);

  for (const room of Object.values(rooms)) paintRoom(world, room);
  decorateArchive(world, rooms);
  paintNonRoomCells(world);
  ensureConnectivity(world, 512, 507);

  generateZones(world);
  for (const zone of world.zones) {
    zone.faction = zone.id % 5 === 0 ? ZoneFaction.LIQUIDATOR : ZoneFaction.CITIZEN;
    zone.level = Math.max(1, calcZoneLevel(zone.cx, zone.cy, FloorLevel.MINISTRY));
  }

  addArchiveContainer(
    world, nextContainerId, clerk, clerk.x + 3, clerk.y + 3,
    ContainerKind.FILING_CABINET,
    'Журнал законных маршрутов',
    'faction',
    [
      { defId: 'archive_access_permit', count: 1 },
      { defId: 'raionsovet_floor_pass', count: 1 },
      { defId: 'elevator_access_order', count: 1 },
      { defId: 'temp_pass', count: 1 },
    ],
    ['legal', 'route_permit', 'document'],
    Faction.CITIZEN,
  );
  addArchiveContainer(
    world, nextContainerId, catalog, catalog.x + 2, catalog.y + catalog.h - 3,
    ContainerKind.FILING_CABINET,
    'Служебная картотека квартирных прав',
    'faction',
    [
      { defId: 'stolen_archive_card', count: 1 },
      { defId: 'missing_record_file', count: 1 },
      { defId: 'passport_stub', count: 1 },
    ],
    ['apartment_rights', 'theft', 'personal_file'],
    Faction.CITIZEN,
  );
  addArchiveContainer(
    world, nextContainerId, shelves, shelves.x + shelves.w - 3, shelves.y + shelves.h - 3,
    ContainerKind.SAFE,
    'Сейф жилых полок',
    'locked',
    [
      { defId: 'personal_file_copy', count: 1 },
      { defId: 'permanent_pass', count: 1 },
      { defId: 'confiscation_warrant', count: 1 },
      { defId: 'record_exposure_notice', count: 1 },
    ],
    ['visible_consequence', 'locked', 'apartment_rights'],
    Faction.CITIZEN,
  );
  addArchiveContainer(
    world, nextContainerId, stamp, stamp.x + stamp.w - 3, stamp.y + stamp.h - 3,
    ContainerKind.SECRET_STASH,
    'Черный ящик подмененных печатей',
    'secret',
    [
      { defId: 'forged_stamp_sheet', count: 1 },
      { defId: 'forged_raionsovet_pass', count: 1 },
      { defId: 'fake_pass', count: 1 },
      { defId: 'ink_bottle', count: 2 },
    ],
    ['illegal', 'forgery', 'back_route'],
  );
  addArchiveContainer(
    world, nextContainerId, market, market.x + market.w - 3, market.y + market.h - 3,
    ContainerKind.CASHBOX,
    'Лицензионный сейф рынка 88',
    'locked',
    [
      { defId: 'official_permit_slip', count: 1 },
      { defId: 'debt_settlement_receipt', count: 1 },
      { defId: 'ration_registry_extract', count: 1 },
      { defId: 'fake_pass', count: 1 },
    ],
    ['market_88', 'trade_license', 'document'],
    Faction.WILD,
  );

  addDrop(entities, nextId, waiting.x + 3, waiting.y + 2, 'blank_form', 1);
  addDrop(entities, nextId, waiting.x + waiting.w - 4, waiting.y + waiting.h - 3, 'blank_form', 1);
  addDrop(entities, nextId, stamp.x + 2, stamp.y + stamp.h - 3, 'ink_bottle', 1);
  addDrop(entities, nextId, fire.x + 2, fire.y + 2, 'siren_instruction', 1);

  spawnArchiveNpc(entities, nextId, LIDA_DEF, 'archive_lida_index', clerk.x + 5, clerk.y + clerk.h - 4);
  spawnArchiveNpc(entities, nextId, GRANDFATHER_DEF, 'archive_paper_grandfather', catalog.x + catalog.w - 4, catalog.y + 3);
  spawnArchiveNpc(entities, nextId, FIRE_LIQUIDATOR_DEF, 'archive_fire_liquidator', fire.x + fire.w - 4, fire.y + fire.h - 4, 'makarov');
  spawnArchiveNpc(entities, nextId, FALSE_HEIR_DEF, 'archive_false_heir', heir.x + 4, heir.y + 4);
  spawnArchiveGuard(entities, nextId, checker.x + checker.w - 4, checker.y + checker.h - 4);
  spawnArchiveMonster(world, entities, nextId, shelves.x + 7, shelves.y + shelves.h - 5, MonsterKind.PARAGRAPH);
  spawnArchiveMonster(world, entities, nextId, catalog.x + catalog.w - 5, catalog.y + Math.floor(catalog.h / 2), MonsterKind.PROTOKOLNIK);
  spawnArchiveMonster(world, entities, nextId, fire.x + 8, fire.y + 4, MonsterKind.PECHATEED);

  world.bakeLights();
  return { world, entities, spawnX: 512.5, spawnY: 507.5 };
}
