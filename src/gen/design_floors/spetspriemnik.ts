/* -- Design floor: spetspriemnik - detention, keys and bounded riot pressure -- */

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
import { monsterSpr } from '../../render/sprite_index';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { generateZones, sanitizeDoors, stampRoom } from '../shared';
import type { FloorGeneration } from '../floor_manifest';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('spetspriemnik');

export const SPETSPRIEMNIK_ROUTE_ID = 'spetspriemnik' as const;
export const SPETSPRIEMNIK_Z = 40 as const;
export const SPETSPRIEMNIK_BASE_FLOOR = FloorLevel.MINISTRY;
export const SPETSPRIEMNIK_CELL_KEY = 'container_key_label';
export const SPETSPRIEMNIK_PERMIT_KEY = 'official_permit_slip';
export const SPETSPRIEMNIK_GUARD_KEY = 'liquidator_token';

export const SPETSPRIEMNIK_ROOM_NAMES = {
  lobby: 'Лифтовый вестибюль спецприёмника',
  intake: 'Окно приема задержанных',
  guardPost: 'Караульная петля спецприёмника',
  command: 'Кабинет начальника спецприёмника',
  visitor: 'Клетка свиданий и обмена фамилий',
  riotYard: 'Двор бунтовой переклички',
  lowerLift: 'Нижний конвойный лифт спецприёмника',
  contraband: 'Склад изъятых передач',
} as const;

const CX = W >> 1;
const CY = W >> 1;
const BASE_TAGS = ['spetspriemnik', 'detention', 'liquidator_control'];

type NextId = { v: number };
type DoorSide = 'north' | 'south' | 'west' | 'east';
type CorridorAxis = 'vertical' | 'horizontal';
type NpcId =
  | 'spetspriemnik_nachalnik_krivda'
  | 'spetspriemnik_guard_savva'
  | 'spetspriemnik_prisoner_mira'
  | 'spetspriemnik_informant_tolya'
  | 'spetspriemnik_clerk_alla';

interface CellBlockResult {
  rooms: Room[];
  shelterRooms: number;
  lockedDoors: number;
  barredCells: number;
}

interface SupportClusterSpec {
  name: string;
  owner: TerritoryOwner;
  axis: CorridorAxis;
  x: number;
  y: number;
  rooms: number;
  roomW: number;
  roomH: number;
  step: number;
  typeA: RoomType;
  typeB: RoomType;
  wallTex: Tex;
  floorTex: Tex;
}

interface HqSpec {
  owner: TerritoryOwner;
  title: string;
  x: number;
  y: number;
  wallTex: Tex;
  floorTex: Tex;
  supportWallTex: Tex;
  supportFloorTex: Tex;
}

export interface SpetspriemnikMetrics {
  routeId: typeof SPETSPRIEMNIK_ROUTE_ID;
  z: typeof SPETSPRIEMNIK_Z;
  cellRooms: number;
  shelterCellRooms: number;
  lockedCellDoors: number;
  lockedPermitDoors: number;
  guardLoopCells: number;
  barredSightlineCells: number;
  hostageContainers: number;
  riotHoldQuestBounded: boolean;
  stablePrisonerNpcIds: readonly string[];
}

const HQ_SPECS: readonly HqSpec[] = [
  {
    owner: ZoneFaction.CULTIST,
    title: 'скрытый культовый карцер',
    x: 116,
    y: 92,
    wallTex: Tex.DARK,
    floorTex: Tex.F_RED_CARPET,
    supportWallTex: Tex.METAL,
    supportFloorTex: Tex.F_CONCRETE,
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    title: 'северный караульный штаб',
    x: 730,
    y: 96,
    wallTex: Tex.METAL,
    floorTex: Tex.F_CONCRETE,
    supportWallTex: Tex.MARBLE,
    supportFloorTex: Tex.F_PARQUET,
  },
  {
    owner: ZoneFaction.CITIZEN,
    title: 'комната родственников',
    x: 112,
    y: 424,
    wallTex: Tex.PANEL,
    floorTex: Tex.F_LINO,
    supportWallTex: Tex.PANEL,
    supportFloorTex: Tex.F_TILE,
  },
  {
    owner: ZoneFaction.WILD,
    title: 'разбитая камера самообороны',
    x: 118,
    y: 790,
    wallTex: Tex.ROTTEN,
    floorTex: Tex.F_CONCRETE,
    supportWallTex: Tex.METAL,
    supportFloorTex: Tex.F_CONCRETE,
  },
  {
    owner: ZoneFaction.SCIENTIST,
    title: 'экспертный НИИ-бокс',
    x: 804,
    y: 790,
    wallTex: Tex.BRICK,
    floorTex: Tex.F_TILE,
    supportWallTex: Tex.TILE_W,
    supportFloorTex: Tex.F_TILE,
  },
] as const;

const SUPPORT_CLUSTERS: readonly SupportClusterSpec[] = [
  { name: 'северные боксы приема', owner: ZoneFaction.CULTIST, axis: 'vertical', x: 72, y: 210, rooms: 8, roomW: 24, roomH: 15, step: 28, typeA: RoomType.STORAGE, typeB: RoomType.LIVING, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
  { name: 'архивные карманы верхнего журнала', owner: ZoneFaction.CITIZEN, axis: 'horizontal', x: 262, y: 116, rooms: 8, roomW: 18, roomH: 14, step: 32, typeA: RoomType.OFFICE, typeB: RoomType.STORAGE, wallTex: Tex.MARBLE, floorTex: Tex.F_PARQUET },
  { name: 'северо-восточные конвойные каптерки', owner: ZoneFaction.LIQUIDATOR, axis: 'vertical', x: 842, y: 210, rooms: 8, roomW: 26, roomH: 15, step: 28, typeA: RoomType.OFFICE, typeB: RoomType.STORAGE, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
  { name: 'левая семейная очередь', owner: ZoneFaction.CITIZEN, axis: 'vertical', x: 68, y: 512, rooms: 8, roomW: 24, roomH: 15, step: 28, typeA: RoomType.COMMON, typeB: RoomType.KITCHEN, wallTex: Tex.PANEL, floorTex: Tex.F_LINO },
  { name: 'правый протокольный архив', owner: ZoneFaction.LIQUIDATOR, axis: 'vertical', x: 844, y: 512, rooms: 8, roomW: 26, roomH: 15, step: 28, typeA: RoomType.OFFICE, typeB: RoomType.STORAGE, wallTex: Tex.MARBLE, floorTex: Tex.F_PARQUET },
  { name: 'нижний дикий пересыльник', owner: ZoneFaction.WILD, axis: 'horizontal', x: 240, y: 884, rooms: 8, roomW: 18, roomH: 14, step: 32, typeA: RoomType.SMOKING, typeB: RoomType.STORAGE, wallTex: Tex.ROTTEN, floorTex: Tex.F_CONCRETE },
  { name: 'нижняя экспертная гребенка', owner: ZoneFaction.SCIENTIST, axis: 'horizontal', x: 548, y: 884, rooms: 8, roomW: 18, roomH: 14, step: 32, typeA: RoomType.MEDICAL, typeB: RoomType.PRODUCTION, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
  { name: 'внутренние шкафы ключей', owner: ZoneFaction.LIQUIDATOR, axis: 'vertical', x: 166, y: 304, rooms: 7, roomW: 20, roomH: 13, step: 30, typeA: RoomType.STORAGE, typeB: RoomType.OFFICE, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
  { name: 'восточные камеры тишины', owner: ZoneFaction.LIQUIDATOR, axis: 'vertical', x: 782, y: 304, rooms: 7, roomW: 20, roomH: 13, step: 30, typeA: RoomType.LIVING, typeB: RoomType.STORAGE, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
  { name: 'гражданский стол передач', owner: ZoneFaction.CITIZEN, axis: 'horizontal', x: 244, y: 246, rooms: 7, roomW: 18, roomH: 13, step: 34, typeA: RoomType.COMMON, typeB: RoomType.KITCHEN, wallTex: Tex.PANEL, floorTex: Tex.F_LINO },
  { name: 'скрытые молитвенные кладовки', owner: ZoneFaction.CULTIST, axis: 'horizontal', x: 244, y: 780, rooms: 7, roomW: 18, roomH: 13, step: 34, typeA: RoomType.STORAGE, typeB: RoomType.COMMON, wallTex: Tex.DARK, floorTex: Tex.F_RED_CARPET },
  { name: 'экспертные кабинки осмотра', owner: ZoneFaction.SCIENTIST, axis: 'vertical', x: 700, y: 560, rooms: 7, roomW: 20, roomH: 13, step: 30, typeA: RoomType.MEDICAL, typeB: RoomType.OFFICE, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
] as const;

const NPC_DEFS: Record<NpcId, PlotNpcDef> = {
  spetspriemnik_nachalnik_krivda: {
    name: 'Кривда Приёмный',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.DIRECTOR,
    sprite: Occupation.DIRECTOR,
    hp: 180,
    maxHp: 180,
    money: 140,
    speed: 0.78,
    weapon: 'makarov',
    inventory: [
      { defId: SPETSPRIEMNIK_PERMIT_KEY, count: 1 },
      { defId: SPETSPRIEMNIK_GUARD_KEY, count: 1 },
      { defId: 'personal_file_copy', count: 1 },
    ],
    talkLines: [
      'Камера не тюрьма. Камера - временное окно, пока фамилия ищет себе правильную строку.',
      'Выпускать можно по бирке, по корешку или по приказу. По жалости у нас дверь не обучена.',
      'Бунт считается происшествием только после третьего разбитого стула. Первые два идут как шум.',
    ],
    talkLinesPost: [
      'Список живых и список отпущенных опять не сошлись. Это работа, не трагедия.',
      'Если ключ вернулся без человека, значит человек пошёл по другому протоколу.',
    ],
  },
  spetspriemnik_guard_savva: {
    name: 'Савва У решётки',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 210,
    maxHp: 210,
    money: 38,
    speed: 0.95,
    weapon: 'makarov',
    inventory: [
      { defId: 'makarov', count: 1 },
      { defId: 'ammo_9mm', count: 18 },
      { defId: SPETSPRIEMNIK_CELL_KEY, count: 1 },
    ],
    talkLines: [
      'Не стой у решётки боком. Через прутья плюют точнее, чем через форму объясняют.',
      'Пачка сигарет - не взятка. Это протирка разговора, чтобы скрип меньше слышно было.',
      'Ключи не мои. Просто если они падают, все смотрят почему-то на меня.',
    ],
    talkLinesPost: [
      'Обход прошёл без лишнего шума. Лишний шум записали на вентиляцию.',
      'Если кто вышел, значит у него была бумага. Или я сделал вид, что была.',
    ],
  },
  spetspriemnik_prisoner_mira: {
    name: 'Мира Седьмая',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.TRAVELER,
    sprite: Occupation.TRAVELER,
    hp: 82,
    maxHp: 92,
    money: 7,
    speed: 0.74,
    inventory: [
      { defId: 'ration_registry_extract', count: 1 },
      { defId: 'bread', count: 1 },
    ],
    talkLines: [
      'Мне не нужен герой. Нужна бирка от ключа и человек, который не будет читать список вслух.',
      'В гермокамере можно переждать сирену. Потом тебя всё равно пересчитают, но хотя бы живым.',
      'Если начнётся шум, не бей первого. Бей дверь, которая открывается.',
    ],
    talkLinesPost: [
      'Ряд вышел тихо. Тихо - это когда начальник ещё не понял, кого считать.',
      'Фамилии лучше не держать в кармане рядом с хлебом. Бумага жирнеет.',
    ],
  },
  spetspriemnik_informant_tolya: {
    name: 'Толя Поимённый',
    isFemale: false,
    faction: Faction.WILD,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 76,
    maxHp: 86,
    money: 31,
    speed: 0.82,
    inventory: [
      { defId: 'denunciation', count: 1 },
      { defId: 'forged_permit_slip', count: 1 },
    ],
    talkLines: [
      'Имя стоит больше пайки, если его вовремя назвать не тому человеку.',
      'Принесёшь копию личного дела - скажу, кого можно выпустить, а кого лучше оставить кричать.',
      'Донос плохой только когда подписан твоей рукой. Чужая рука иногда кормит.',
    ],
    talkLinesPost: [
      'Фамилии поменяли камеры. Теперь охрана ищет старую правду по новой койке.',
      'Я ничего не продавал. Я обменял бумагу на воздух.',
    ],
  },
  spetspriemnik_clerk_alla: {
    name: 'Алла Приёмная',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 90,
    maxHp: 90,
    money: 66,
    speed: 0.8,
    inventory: [
      { defId: 'blank_form', count: 2 },
      { defId: SPETSPRIEMNIK_PERMIT_KEY, count: 1 },
      { defId: 'stolen_terminal_stamp', count: 1 },
    ],
    talkLines: [
      'Задержанный без фамилии принимается как вещь. Вещи жалобы не пишут, но иногда возвращаются.',
      'Корешок пропуска открывает пост. Кованый корешок открывает разговор с Саввой.',
      'Если двор шумит, окно приёма закрывается. Бумаги не любят, когда их толкают плечом.',
    ],
    talkLinesPost: [
      'Окно снова принимает. Вчерашние фамилии убрали в нижний ящик.',
      'Печать целая. Значит, виноват не стол.',
    ],
  },
};

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'spetspriemnik_nachalnik_krivda', NPC_DEFS.spetspriemnik_nachalnik_krivda, [
  {
    id: 'spetspriemnik_shelter_cell_check',
    giverNpcId: 'spetspriemnik_nachalnik_krivda',
    type: QuestType.VISIT,
    desc: 'Проверь гермокамеру спецприёмника. Кривда даст корешок, если дверь держит сирену, а люди внутри не шумят.',
    targetFloor: SPETSPRIEMNIK_BASE_FLOOR,
    targetRoute: { designFloorId: SPETSPRIEMNIK_ROUTE_ID, z: SPETSPRIEMNIK_Z },
    targetRoomName: 'Камера спецприёмника 05: гермоукрытие',
    holdSeconds: 25,
    holdResetOnExit: true,
    rewardItem: SPETSPRIEMNIK_PERMIT_KEY,
    rewardCount: 1,
    relationDelta: 5,
    xpReward: 55,
    moneyReward: 25,
    eventTags: [...BASE_TAGS, 'shelter_cell', 'samosbor_shelter'],
    eventTargetName: 'Гермокамера спецприёмника проверена как укрытие.',
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'spetspriemnik_guard_savva', NPC_DEFS.spetspriemnik_guard_savva, [
  {
    id: 'spetspriemnik_bribe_guard',
    giverNpcId: 'spetspriemnik_guard_savva',
    type: QuestType.FETCH,
    desc: 'Отдай Савве пачку сигарет у решётки. Он не продаст ключ, но бирка может упасть не туда.',
    targetItem: 'cigs',
    targetCount: 1,
    targetFloor: SPETSPRIEMNIK_BASE_FLOOR,
    targetRoute: { designFloorId: SPETSPRIEMNIK_ROUTE_ID, z: SPETSPRIEMNIK_Z },
    rewardItem: SPETSPRIEMNIK_CELL_KEY,
    rewardCount: 1,
    extraRewards: [{ defId: SPETSPRIEMNIK_GUARD_KEY, count: 1 }],
    relationDelta: 3,
    xpReward: 35,
    moneyReward: 0,
    eventTags: [...BASE_TAGS, 'bribe_guard', 'key_gate'],
    eventTargetName: 'Савва принял сигареты, а бирка ключа оказалась у игрока.',
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'spetspriemnik_prisoner_mira', NPC_DEFS.spetspriemnik_prisoner_mira, [
  {
    id: 'spetspriemnik_release_cell_row',
    giverNpcId: 'spetspriemnik_prisoner_mira',
    type: QuestType.FETCH,
    desc: 'Принеси Мире бирку от ключа. Она выведет ряд камер тихо, пока караул спорит с журналом обхода.',
    targetItem: SPETSPRIEMNIK_CELL_KEY,
    targetCount: 1,
    targetFloor: SPETSPRIEMNIK_BASE_FLOOR,
    targetRoute: { designFloorId: SPETSPRIEMNIK_ROUTE_ID, z: SPETSPRIEMNIK_Z },
    targetRoomName: 'Клетка свиданий и обмена фамилий',
    rewardItem: 'personal_file_copy',
    rewardCount: 1,
    extraRewards: [{ defId: 'bread', count: 2 }],
    relationDelta: 12,
    xpReward: 90,
    moneyReward: 18,
    eventTags: [...BASE_TAGS, 'release_prisoners', 'stable_prisoner_identity'],
    eventData: { releasedPlotNpcIds: ['spetspriemnik_prisoner_mira'] },
    eventTargetName: 'Ряд камер спецприёмника вышел по бирке ключа.',
    abandonsSideQuestIds: ['spetspriemnik_trade_names'],
  },
  {
    id: 'spetspriemnik_trigger_riot',
    giverNpcId: 'spetspriemnik_prisoner_mira',
    type: QuestType.VISIT,
    desc: 'Удержи двор переклички, пока Мира срывает список. Шум поднимет охрану, но волна ограничена двором.',
    targetFloor: SPETSPRIEMNIK_BASE_FLOOR,
    targetRoute: { designFloorId: SPETSPRIEMNIK_ROUTE_ID, z: SPETSPRIEMNIK_Z },
    targetRoomName: SPETSPRIEMNIK_ROOM_NAMES.riotYard,
    holdSeconds: 35,
    holdResetOnExit: true,
    holdSpawnMonsters: 3,
    holdSpawnIntervalSeconds: 12,
    holdSpawnMaxAlive: 9,
    rewardItem: 'forged_permit_slip',
    rewardCount: 1,
    relationDelta: 8,
    xpReward: 95,
    moneyReward: 0,
    eventTags: [...BASE_TAGS, 'riot', 'bounded_event', 'not_refill'],
    eventData: { riotBoundedMaxAlive: 9, spawnIntervalSeconds: 12 },
    eventTargetName: 'Бунт спецприёмника поднят и удержан во дворе переклички.',
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'spetspriemnik_informant_tolya', NPC_DEFS.spetspriemnik_informant_tolya, [
  {
    id: 'spetspriemnik_trade_names',
    giverNpcId: 'spetspriemnik_informant_tolya',
    type: QuestType.FETCH,
    desc: 'Принеси Толе копию личного дела из сейфа начальника. Он обменяет фамилии на пропуск и чужой донос.',
    targetItem: 'personal_file_copy',
    targetCount: 1,
    targetFloor: SPETSPRIEMNIK_BASE_FLOOR,
    targetRoute: { designFloorId: SPETSPRIEMNIK_ROUTE_ID, z: SPETSPRIEMNIK_Z },
    targetRoomName: SPETSPRIEMNIK_ROOM_NAMES.command,
    rewardItem: SPETSPRIEMNIK_PERMIT_KEY,
    rewardCount: 1,
    extraRewards: [{ defId: 'denunciation', count: 1 }],
    relationDelta: -3,
    xpReward: 75,
    moneyReward: 30,
    eventTags: [...BASE_TAGS, 'trade_names', 'hostage_economy'],
    eventTargetName: 'Фамилии задержанных обменяны на пропуск и донос.',
    blockedBySideQuestIds: ['spetspriemnik_release_cell_row'],
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'spetspriemnik_clerk_alla', NPC_DEFS.spetspriemnik_clerk_alla, [
  {
    id: 'spetspriemnik_stamp_release_form',
    giverNpcId: 'spetspriemnik_clerk_alla',
    type: QuestType.FETCH,
    desc: 'Принеси Алле украденную печать терминала. Она поставит выпускной штамп, если окно приёма ещё целое.',
    targetItem: 'stolen_terminal_stamp',
    targetCount: 1,
    targetFloor: SPETSPRIEMNIK_BASE_FLOOR,
    targetRoute: { designFloorId: SPETSPRIEMNIK_ROUTE_ID, z: SPETSPRIEMNIK_Z },
    rewardItem: 'forged_permit_slip',
    rewardCount: 1,
    extraRewards: [{ defId: 'blank_form', count: 1 }],
    relationDelta: 5,
    xpReward: 60,
    moneyReward: 12,
    eventTags: [...BASE_TAGS, 'release_stamp', 'forgery'],
    eventTargetName: 'Выпускной штамп спецприёмника поставлен через окно приёма.',
  },
]);

const metricsByWorld = new WeakMap<World, SpetspriemnikMetrics>();

function addRoom(
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
  const room = stampRoom(world, world.rooms.length, type, Math.floor(x), Math.floor(y), w, h, -1);
  room.name = name;
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) world.floorTex[ci] = floorTex;
      else world.wallTex[ci] = wallTex;
    }
  }
  return room;
}

function makeHermeticRoom(world: World, room: Room): void {
  room.sealed = true;
  room.wallTex = Tex.HERMO_WALL;
  for (let y = room.y - 1; y <= room.y + room.h; y++) {
    for (let x = room.x - 1; x <= room.x + room.w; x++) {
      const ci = world.idx(x, y);
      if (world.roomMap[ci] === room.id) continue;
      if (world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR) continue;
      world.wallTex[ci] = Tex.HERMO_WALL;
      world.hermoWall[ci] = 1;
    }
  }
}

function carveRect(
  world: World,
  x: number,
  y: number,
  w: number,
  h: number,
  floorTex: Tex,
  wallTex: Tex,
  out?: Set<number>,
): void {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (dx >= 0 && dx < w && dy >= 0 && dy < h) {
        if (world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR) continue;
        world.cells[ci] = Cell.FLOOR;
        world.roomMap[ci] = -1;
        world.floorTex[ci] = floorTex;
        out?.add(ci);
      } else if (world.cells[ci] === Cell.WALL) {
        world.wallTex[ci] = wallTex;
      }
    }
  }
}

function carveLine(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  floorTex: Tex,
  wallTex: Tex,
  out?: Set<number>,
): void {
  const half = width >> 1;
  if (ay === by) {
    carveRect(world, Math.min(ax, bx), ay - half, Math.abs(bx - ax) + 1, width, floorTex, wallTex, out);
    return;
  }
  carveRect(world, ax - half, Math.min(ay, by), width, Math.abs(by - ay) + 1, floorTex, wallTex, out);
}

function addDoor(
  world: World,
  room: Room,
  x: number,
  y: number,
  state = DoorState.CLOSED,
  keyId = '',
): number {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.DOOR;
  world.roomMap[idx] = -1;
  world.hermoWall[idx] = 0;
  world.wallTex[idx] = state === DoorState.HERMETIC_OPEN || state === DoorState.HERMETIC_CLOSED
    ? Tex.HERMO_WALL
    : state === DoorState.LOCKED
      ? Tex.DOOR_METAL
      : Tex.DOOR_WOOD;
  world.doors.set(idx, { idx, state, roomA: room.id, roomB: -1, keyId, timer: 0 });
  if (!room.doors.includes(idx)) room.doors.push(idx);
  return idx;
}

function connectRoomToPoint(
  world: World,
  room: Room,
  side: DoorSide,
  tx: number,
  ty: number,
  state = DoorState.CLOSED,
  keyId = '',
): number {
  const midX = room.x + (room.w >> 1);
  const midY = room.y + (room.h >> 1);
  const door = side === 'north'
    ? { x: midX, y: room.y - 1, sx: midX, sy: room.y - 2 }
    : side === 'south'
      ? { x: midX, y: room.y + room.h, sx: midX, sy: room.y + room.h + 1 }
      : side === 'west'
        ? { x: room.x - 1, y: midY, sx: room.x - 2, sy: midY }
        : { x: room.x + room.w, y: midY, sx: room.x + room.w + 1, sy: midY };
  const idx = addDoor(world, room, door.x, door.y, state, keyId);
  carveLine(world, door.sx, door.sy, tx, door.sy, 3, room.floorTex, room.wallTex);
  carveLine(world, tx, door.sy, tx, ty, 3, room.floorTex, room.wallTex);
  return idx;
}

function addGateAt(world: World, x: number, y: number, state: DoorState, keyId: string): number {
  for (let dx = -6; dx <= 6; dx++) {
    const wi = world.idx(x + dx, y);
    if (world.cells[wi] === Cell.LIFT) continue;
    world.cells[wi] = Cell.WALL;
    world.roomMap[wi] = -1;
    world.wallTex[wi] = Tex.METAL;
    world.features[wi] = Feature.NONE;
  }
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.DOOR;
  world.roomMap[idx] = -1;
  world.hermoWall[idx] = 0;
  world.wallTex[idx] = Tex.DOOR_METAL;
  world.doors.set(idx, { idx, state, roomA: -1, roomB: -1, keyId, timer: 0 });
  return idx;
}

function markProtectedRect(mask: Uint8Array, world: World, x: number, y: number, w: number, h: number): void {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) mask[world.idx(x + dx, y + dy)] = 1;
  }
}

function buildProtectedMask(world: World): Uint8Array {
  const mask = new Uint8Array(W * W);
  for (const room of world.rooms) {
    if (!room) continue;
    markProtectedRect(mask, world, room.x, room.y, room.w, room.h);
  }
  for (const idx of world.doors.keys()) mask[idx] = 1;
  for (const container of world.containers) mask[world.idx(container.x, container.y)] = 1;
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.LIFT || world.features[i] === Feature.LIFT_BUTTON) mask[i] = 1;
  }
  return mask;
}

function canStampRouteRoom(world: World, mask: Uint8Array, x: number, y: number, w: number, h: number): boolean {
  if (x < 2 || y < 2 || x + w + 2 >= W || y + h + 2 >= W) return false;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (mask[ci] || world.aptMask[ci]) return false;
      if (world.cells[ci] !== Cell.WALL) return false;
    }
  }
  return true;
}

function carveSafeRect(
  world: World,
  mask: Uint8Array,
  x: number,
  y: number,
  w: number,
  h: number,
  floorTex: Tex,
  wallTex: Tex,
): void {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (mask[ci] || world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR) continue;
      if (dx >= 0 && dx < w && dy >= 0 && dy < h) {
        world.cells[ci] = Cell.FLOOR;
        world.roomMap[ci] = -1;
        world.floorTex[ci] = floorTex;
        world.hermoWall[ci] = 0;
      } else if (world.cells[ci] === Cell.WALL) {
        world.wallTex[ci] = wallTex;
        world.hermoWall[ci] = 0;
      }
    }
  }
}

function carveSafeLine(
  world: World,
  mask: Uint8Array,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  floorTex: Tex,
  wallTex: Tex,
): void {
  const half = width >> 1;
  if (ay === by) {
    carveSafeRect(world, mask, Math.min(ax, bx), ay - half, Math.abs(bx - ax) + 1, width, floorTex, wallTex);
    return;
  }
  carveSafeRect(world, mask, ax - half, Math.min(ay, by), width, Math.abs(by - ay) + 1, floorTex, wallTex);
}

function doorOutside(room: Room, side: DoorSide): { doorX: number; doorY: number; outsideX: number; outsideY: number } {
  const midX = room.x + (room.w >> 1);
  const midY = room.y + (room.h >> 1);
  switch (side) {
    case 'north':
      return { doorX: midX, doorY: room.y - 1, outsideX: midX, outsideY: room.y - 2 };
    case 'south':
      return { doorX: midX, doorY: room.y + room.h, outsideX: midX, outsideY: room.y + room.h + 1 };
    case 'west':
      return { doorX: room.x - 1, doorY: midY, outsideX: room.x - 2, outsideY: midY };
    case 'east':
    default:
      return { doorX: room.x + room.w, doorY: midY, outsideX: room.x + room.w + 1, outsideY: midY };
  }
}

function addRouteRoomDoor(world: World, room: Room, side: DoorSide, state = DoorState.CLOSED, keyId = ''): void {
  const p = doorOutside(room, side);
  const outside = world.idx(p.outsideX, p.outsideY);
  if (world.cells[outside] === Cell.WALL) {
    world.cells[outside] = Cell.FLOOR;
    world.roomMap[outside] = -1;
    world.floorTex[outside] = room.floorTex;
    world.hermoWall[outside] = 0;
  }
  addDoor(world, room, p.doorX, p.doorY, state, keyId);
  carveDoorStub(world, room, side, p.outsideX, p.outsideY);
}

function carveDoorStub(world: World, room: Room, side: DoorSide, outsideX: number, outsideY: number): void {
  const dir = side === 'north'
    ? { x: 0, y: -1 }
    : side === 'south'
      ? { x: 0, y: 1 }
      : side === 'west'
        ? { x: -1, y: 0 }
        : { x: 1, y: 0 };
  let length = 0;
  for (let step = 0; step <= 32; step++) {
    const x = outsideX + dir.x * step;
    const y = outsideY + dir.y * step;
    const ci = world.idx(x, y);
    if (step > 0 && (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER)) {
      length = step;
      break;
    }
    if (world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR) break;
  }
  if (length <= 0) length = 3;
  for (let step = 0; step <= length; step++) {
    const x = outsideX + dir.x * step;
    const y = outsideY + dir.y * step;
    const ci = world.idx(x, y);
    if (world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR) continue;
    if (world.roomMap[ci] >= 0) continue;
    world.cells[ci] = Cell.FLOOR;
    world.floorTex[ci] = room.floorTex;
    world.hermoWall[ci] = 0;
  }
}

function decorateSupportRoom(world: World, room: Room, primary: Feature, secondary: Feature): void {
  setFeature(world, room.x + 2, room.y + 2, primary);
  setFeature(world, room.x + room.w - 3, room.y + 2, secondary);
  if (room.w >= 12) setFeature(world, room.x + (room.w >> 1), room.y + room.h - 3, Feature.LAMP);
}

function featureForRoom(type: RoomType, alternate = false): Feature {
  switch (type) {
    case RoomType.KITCHEN: return alternate ? Feature.SINK : Feature.STOVE;
    case RoomType.BATHROOM: return alternate ? Feature.TOILET : Feature.SINK;
    case RoomType.MEDICAL: return alternate ? Feature.SHELF : Feature.APPARATUS;
    case RoomType.PRODUCTION: return alternate ? Feature.SCREEN : Feature.MACHINE;
    case RoomType.OFFICE:
    case RoomType.HQ:
      return alternate ? Feature.SCREEN : Feature.DESK;
    case RoomType.STORAGE: return alternate ? Feature.SHELF : Feature.SHELF;
    case RoomType.SMOKING: return alternate ? Feature.CHAIR : Feature.TABLE;
    case RoomType.LIVING: return alternate ? Feature.CHAIR : Feature.BED;
    case RoomType.COMMON:
    default:
      return alternate ? Feature.CHAIR : Feature.TABLE;
  }
}

function tryStampOwnedRoom(
  world: World,
  mask: Uint8Array,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
  doorSide: DoorSide,
  owner: TerritoryOwner,
  hermetic = false,
): Room | null {
  const rx = Math.round(x);
  const ry = Math.round(y);
  if (!canStampRouteRoom(world, mask, rx, ry, w, h)) return null;
  const room = addRoom(world, type, rx, ry, w, h, name, wallTex, floorTex);
  if (hermetic) makeHermeticRoom(world, room);
  addRouteRoomDoor(world, room, doorSide, hermetic ? DoorState.HERMETIC_OPEN : DoorState.CLOSED);
  decorateSupportRoom(world, room, featureForRoom(type), featureForRoom(type, true));
  paintRoomTerritory(world, room, owner);
  markProtectedRect(mask, world, room.x, room.y, room.w, room.h);
  return room;
}

function paintRoomTerritory(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) world.factionControl[world.idx(room.x + dx, room.y + dy)] = owner;
  }
}

function hqName(spec: HqSpec): string {
  return `Штаб спецприёмника: ${spec.title}`;
}

function buildHqCompound(world: World, mask: Uint8Array, spec: HqSpec): void {
  carveSafeLine(world, mask, spec.x - 36, spec.y + 28, spec.x + 110, spec.y + 28, 5, spec.supportFloorTex, spec.supportWallTex);
  carveSafeLine(world, mask, spec.x + 42, spec.y - 24, spec.x + 42, spec.y + 82, 5, spec.supportFloorTex, spec.supportWallTex);
  const core = tryStampOwnedRoom(
    world,
    mask,
    RoomType.HQ,
    spec.x,
    spec.y,
    32,
    20,
    hqName(spec),
    spec.wallTex,
    spec.floorTex,
    'south',
    spec.owner,
    true,
  );
  if (core) {
    setFeature(world, core.x + 5, core.y + 5, Feature.SCREEN);
    setFeature(world, core.x + core.w - 6, core.y + core.h - 5, Feature.DESK);
  }

  const supports: readonly [RoomType, number, number, number, number, DoorSide, string][] = [
    [RoomType.COMMON, -38, 33, 30, 16, 'north', 'общая'],
    [RoomType.KITCHEN, -38, 56, 30, 14, 'north', 'кухня'],
    [RoomType.STORAGE, 42, 56, 30, 14, 'north', 'склад'],
    [RoomType.MEDICAL, 78, 33, 30, 16, 'north', 'медбокс'],
    [RoomType.OFFICE, 50, -22, 30, 14, 'west', 'дежурная'],
  ] as const;
  for (const [type, dx, dy, w, h, side, suffix] of supports) {
    tryStampOwnedRoom(
      world,
      mask,
      type,
      spec.x + dx,
      spec.y + dy,
      w,
      h,
      `${hqName(spec)}: ${suffix}`,
      spec.supportWallTex,
      spec.supportFloorTex,
      side,
      spec.owner,
    );
  }
}

function buildSupportCluster(world: World, mask: Uint8Array, spec: SupportClusterSpec, rng: () => number): void {
  if (spec.axis === 'vertical') {
    const corridorX = spec.x + 70;
    const top = spec.y - 10;
    const bottom = spec.y + spec.rooms * spec.step + 12;
    carveSafeLine(world, mask, corridorX, top, corridorX, bottom, 5, spec.floorTex, spec.wallTex);
    for (let row = 0; row < spec.rooms; row++) {
      const jitter = Math.floor(rng() * 3) - 1;
      const y = spec.y + row * spec.step + jitter;
      const typeL = row % 2 === 0 ? spec.typeA : spec.typeB;
      const typeR = row % 3 === 0 ? RoomType.BATHROOM : row % 2 === 0 ? spec.typeB : spec.typeA;
      tryStampOwnedRoom(world, mask, typeL, corridorX - spec.roomW - 3, y, spec.roomW, spec.roomH, `${spec.name}: левая ${row + 1}`, spec.wallTex, spec.floorTex, 'east', spec.owner);
      tryStampOwnedRoom(world, mask, typeR, corridorX + 4, y, spec.roomW, spec.roomH, `${spec.name}: правая ${row + 1}`, spec.wallTex, spec.floorTex, 'west', spec.owner);
      if (row % 3 === 1) carveSafeLine(world, mask, corridorX - 26, y + spec.roomH + 5, corridorX + 26, y + spec.roomH + 5, 3, spec.floorTex, spec.wallTex);
    }
    return;
  }

  const corridorY = spec.y + 32;
  const left = spec.x - 10;
  const right = spec.x + spec.rooms * spec.step + 12;
  carveSafeLine(world, mask, left, corridorY, right, corridorY, 5, spec.floorTex, spec.wallTex);
  for (let col = 0; col < spec.rooms; col++) {
    const jitter = Math.floor(rng() * 3) - 1;
    const x = spec.x + col * spec.step + jitter;
    const typeT = col % 2 === 0 ? spec.typeA : spec.typeB;
    const typeB = col % 3 === 0 ? RoomType.BATHROOM : col % 2 === 0 ? spec.typeB : spec.typeA;
    tryStampOwnedRoom(world, mask, typeT, x, corridorY - spec.roomH - 3, spec.roomW, spec.roomH, `${spec.name}: верхняя ${col + 1}`, spec.wallTex, spec.floorTex, 'south', spec.owner);
    tryStampOwnedRoom(world, mask, typeB, x, corridorY + 4, spec.roomW, spec.roomH, `${spec.name}: нижняя ${col + 1}`, spec.wallTex, spec.floorTex, 'north', spec.owner);
    if (col % 3 === 1) carveSafeLine(world, mask, x + spec.roomW + 5, corridorY - 20, x + spec.roomW + 5, corridorY + 20, 3, spec.floorTex, spec.wallTex);
  }
}

function buildSpetspriemnikMidSpines(world: World, mask: Uint8Array): void {
  const corridors: readonly [number, number, number, number, number, Tex, Tex][] = [
    [114, 148, 910, 148, 5, Tex.F_CONCRETE, Tex.METAL],
    [104, 512, 920, 512, 6, Tex.F_CONCRETE, Tex.METAL],
    [116, 876, 908, 876, 5, Tex.F_CONCRETE, Tex.METAL],
    [156, 120, 156, 908, 5, Tex.F_CONCRETE, Tex.METAL],
    [370, 104, 370, 924, 4, Tex.F_PARQUET, Tex.MARBLE],
    [654, 104, 654, 924, 4, Tex.F_PARQUET, Tex.MARBLE],
    [868, 120, 868, 908, 5, Tex.F_CONCRETE, Tex.METAL],
    [250, 238, 778, 238, 4, Tex.F_PARQUET, Tex.MARBLE],
    [250, 790, 778, 790, 4, Tex.F_CONCRETE, Tex.METAL],
  ];
  for (const [ax, ay, bx, by, width, floorTex, wallTex] of corridors) {
    carveSafeLine(world, mask, ax, ay, bx, by, width, floorTex, wallTex);
  }
  for (const [x, y] of [[156, 148], [868, 148], [156, 876], [868, 876], [370, 512], [654, 512]] as const) {
    setFeature(world, x, y, Feature.LAMP);
  }
}

export function expandSpetspriemnikRouteGeometry(world: World, rng: () => number): void {
  const mask = buildProtectedMask(world);
  buildSpetspriemnikMidSpines(world, mask);
  for (const spec of HQ_SPECS) buildHqCompound(world, mask, spec);
  for (const spec of SUPPORT_CLUSTERS) buildSupportCluster(world, mask, spec, rng);
  world.markCellsDirty();
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFeaturesDirty(true);
}

export function reinforceSpetspriemnikRouteGates(world: World): void {
  addGateAt(world, CX, 382, DoorState.LOCKED, SPETSPRIEMNIK_PERMIT_KEY);
  addGateAt(world, CX, 650, DoorState.LOCKED, SPETSPRIEMNIK_GUARD_KEY);
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
  world.features[ci] = feature;
  if (feature === Feature.SCREEN && !world.screenCells.includes(ci)) world.screenCells.push(ci);
}

function setLift(world: World, x: number, y: number, direction: LiftDirection): void {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.LIFT;
  world.liftDir[ci] = direction;
  world.wallTex[ci] = Tex.LIFT_DOOR;
  world.floorTex[ci] = Tex.F_CONCRETE;
  world.roomMap[ci] = -1;
  world.features[ci] = Feature.NONE;
}

function placeBarredSightline(world: World, x1: number, x2: number, y: number): number {
  let cells = 0;
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
    if (x % 3 === 1) continue;
    const ci = world.idx(x, y);
    if (world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR) continue;
    world.cells[ci] = Cell.WALL;
    world.roomMap[ci] = -1;
    world.wallTex[ci] = Tex.METAL;
    world.hermoWall[ci] = 0;
    cells++;
  }
  return cells;
}

function decorateRoom(world: World, room: Room, feature: Feature, altFeature = Feature.LAMP): void {
  setFeature(world, room.x + 4, room.y + 4, feature);
  setFeature(world, room.x + room.w - 5, room.y + 4, altFeature);
  setFeature(world, room.x + (room.w >> 1), room.y + room.h - 5, Feature.LAMP);
}

function buildGuardLoop(world: World): number {
  const cells = new Set<number>();
  carveLine(world, 218, 258, 806, 258, 6, Tex.F_CONCRETE, Tex.METAL, cells);
  carveLine(world, 806, 258, 806, 774, 6, Tex.F_CONCRETE, Tex.METAL, cells);
  carveLine(world, 806, 774, 218, 774, 6, Tex.F_CONCRETE, Tex.METAL, cells);
  carveLine(world, 218, 774, 218, 258, 6, Tex.F_CONCRETE, Tex.METAL, cells);
  carveLine(world, CX, 252, CX, 812, 10, Tex.F_RED_CARPET, Tex.MARBLE, cells);
  carveLine(world, 248, CY, 780, CY, 8, Tex.F_CONCRETE, Tex.METAL, cells);
  for (const [x, y] of [[218, 258], [806, 258], [806, 774], [218, 774], [CX, CY]] as const) {
    setFeature(world, x, y, Feature.LAMP);
  }
  return cells.size;
}

function addCellRoom(
  world: World,
  serial: number,
  x: number,
  y: number,
  w: number,
  h: number,
  doorSide: 'east' | 'west',
  corridorX: number,
  shelter: boolean,
): { room: Room; lockedDoor: boolean; barredCells: number } {
  const name = shelter
    ? `Камера спецприёмника ${String(serial).padStart(2, '0')}: гермоукрытие`
    : `Камера спецприёмника ${String(serial).padStart(2, '0')}`;
  const room = addRoom(world, RoomType.LIVING, x, y, w, h, name, shelter ? Tex.HERMO_WALL : Tex.METAL, Tex.F_CONCRETE);
  if (shelter) makeHermeticRoom(world, room);
  decorateRoom(world, room, Feature.BED, serial % 2 === 0 ? Feature.SHELF : Feature.CHAIR);

  const doorY = room.y + (room.h >> 1);
  const doorX = doorSide === 'east' ? room.x + room.w : room.x - 1;
  const state = shelter ? DoorState.HERMETIC_OPEN : serial % 3 === 0 ? DoorState.CLOSED : DoorState.LOCKED;
  const keyId = state === DoorState.LOCKED ? SPETSPRIEMNIK_CELL_KEY : '';
  addDoor(world, room, doorX, doorY, state, keyId);
  const startX = doorSide === 'east' ? doorX + 1 : doorX - 1;
  carveLine(world, startX, doorY, corridorX, doorY, 3, Tex.F_CONCRETE, Tex.METAL);
  const barredCells = placeBarredSightline(
    world,
    Math.min(room.x + 3, corridorX),
    Math.max(room.x + room.w - 3, corridorX),
    room.y - 2,
  );
  return { room, lockedDoor: state === DoorState.LOCKED, barredCells };
}

function buildCellblockBsp(
  world: World,
  blockX: number,
  blockY: number,
  serialStart: number,
): CellBlockResult {
  const result: CellBlockResult = { rooms: [], shelterRooms: 0, lockedDoors: 0, barredCells: 0 };
  const corridorX = blockX + 108;
  carveLine(world, corridorX, blockY + 20, corridorX, blockY + 365, 8, Tex.F_CONCRETE, Tex.METAL);
  for (let row = 0; row < 6; row++) {
    const y = blockY + 24 + row * 54;
    for (const side of ['left', 'right'] as const) {
      const serial = serialStart + row * 2 + (side === 'left' ? 0 : 1);
      const shelter = serial % 5 === 0 || serial === 3;
      const roomX = side === 'left' ? blockX + 12 : corridorX + 30;
      const { room, lockedDoor, barredCells } = addCellRoom(
        world,
        serial,
        roomX,
        y,
        68,
        34,
        side === 'left' ? 'east' : 'west',
        corridorX,
        shelter,
      );
      result.rooms.push(room);
      if (shelter) result.shelterRooms++;
      if (lockedDoor) result.lockedDoors++;
      result.barredCells += barredCells;
    }
  }
  return result;
}

function addContainer(
  world: World,
  room: Room,
  x: number,
  y: number,
  kind: ContainerKind,
  name: string,
  access: WorldContainer['access'],
  inventory: Item[],
  tags: string[],
  lockDifficulty?: number,
  faction?: Faction,
): WorldContainer {
  const container: WorldContainer = {
    id: nextContainerId(world),
    x,
    y,
    floor: SPETSPRIEMNIK_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)] ?? 0,
    kind,
    name,
    inventory,
    capacitySlots: Math.max(8, inventory.length + 4),
    faction,
    access,
    lockDifficulty,
    discovered: access !== 'secret',
    tags,
  };
  world.addContainer(container);
  setFeature(world, x, y, kind === ContainerKind.SAFE || kind === ContainerKind.CASHBOX ? Feature.DESK : Feature.SHELF);
  return container;
}

function nextContainerId(world: World): number {
  let id = 1;
  for (const container of world.containers) id = Math.max(id, container.id + 1);
  return id;
}

function spawnPlotNpc(
  entities: Entity[],
  nextId: NextId,
  plotNpcId: NpcId,
  room: Room,
  dx: number,
  dy: number,
  angle: number,
  canGiveQuest = true,
): number {
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, room.x + dx + 0.5, room.y + dy + 0.5, {
    angle,
    aiTarget: { x: room.x + dx, y: room.y + dy },
    canGiveQuest,
  });
  return npc.id;
}

function spawnMonster(
  world: World,
  entities: Entity[],
  nextId: NextId,
  kind: MonsterKind,
  x: number,
  y: number,
  level: number,
  name: string,
): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) return;
  const def = MONSTERS[kind];
  if (!def) return;
  const hp = Math.round(def.hp * (1 + level * 0.18));
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: def.speed * (1 + level * 0.04),
    sprite: monsterSpr(kind),
    name,
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    phasing: kind === MonsterKind.SPIRIT,
  });
}

function placeContainers(world: World, rooms: {
  guardPost: Room;
  command: Room;
  visitor: Room;
  riotYard: Room;
  contraband: Room;
}): void {
  addContainer(world, rooms.guardPost, rooms.guardPost.x + 8, rooms.guardPost.y + 9, ContainerKind.METAL_CABINET, 'Шкаф ключей камеры выпуска', 'faction', [
    { defId: SPETSPRIEMNIK_CELL_KEY, count: 2 },
    { defId: SPETSPRIEMNIK_GUARD_KEY, count: 1 },
    { defId: 'ammo_9mm', count: 12 },
  ], [...BASE_TAGS, 'release_prisoners', 'key_gate', 'bribe_guard'], 3, Faction.LIQUIDATOR);

  addContainer(world, rooms.command, rooms.command.x + rooms.command.w - 9, rooms.command.y + 8, ContainerKind.SAFE, 'Сейф списка заложников', 'locked', [
    { defId: 'personal_file_copy', count: 2 },
    { defId: 'denunciation', count: 1 },
    { defId: SPETSPRIEMNIK_PERMIT_KEY, count: 1 },
  ], [...BASE_TAGS, 'trade_names', 'hostage_list', 'official'], 5, Faction.LIQUIDATOR);

  addContainer(world, rooms.visitor, rooms.visitor.x + 8, rooms.visitor.y + rooms.visitor.h - 7, ContainerKind.FILING_CABINET, 'Окно обмена фамилий', 'owner', [
    { defId: 'blank_form', count: 2 },
    { defId: 'ration_registry_extract', count: 1 },
    { defId: 'forged_permit_slip', count: 1 },
  ], [...BASE_TAGS, 'trade_names', 'forgery', 'paperwork']);

  addContainer(world, rooms.riotYard, rooms.riotYard.x + 12, rooms.riotYard.y + 12, ContainerKind.SECRET_STASH, 'Тайник сорванной переклички', 'secret', [
    { defId: 'stolen_terminal_stamp', count: 1 },
    { defId: 'cigs', count: 2 },
    { defId: 'bread', count: 2 },
  ], [...BASE_TAGS, 'riot', 'bounded_event', 'stash']);

  addContainer(world, rooms.contraband, rooms.contraband.x + 8, rooms.contraband.y + 8, ContainerKind.SECRET_STASH, 'Пакет передач без подписи', 'owner', [
    { defId: 'cigs', count: 3 },
    { defId: 'fake_pass', count: 1 },
    { defId: 'water', count: 2 },
  ], [...BASE_TAGS, 'contraband', 'bribe_guard', 'hostage_economy']);
}

function buildCore(world: World): {
  lobby: Room;
  intake: Room;
  guardPost: Room;
  command: Room;
  visitor: Room;
  riotYard: Room;
  lowerLift: Room;
  contraband: Room;
  guardLoopCells: number;
  cellRooms: Room[];
  shelterCellRooms: number;
  lockedCellDoors: number;
  barredSightlineCells: number;
  lockedPermitDoors: number;
} {
  const guardLoopCells = buildGuardLoop(world);
  const lobby = addRoom(world, RoomType.CORRIDOR, 454, 204, 116, 48, SPETSPRIEMNIK_ROOM_NAMES.lobby, Tex.LIFT_DOOR, Tex.F_CONCRETE);
  const intake = addRoom(world, RoomType.OFFICE, 424, 282, 176, 56, SPETSPRIEMNIK_ROOM_NAMES.intake, Tex.MARBLE, Tex.F_PARQUET);
  const guardPost = addRoom(world, RoomType.HQ, 610, 296, 104, 58, SPETSPRIEMNIK_ROOM_NAMES.guardPost, Tex.METAL, Tex.F_CONCRETE);
  const visitor = addRoom(world, RoomType.COMMON, 330, 684, 152, 62, SPETSPRIEMNIK_ROOM_NAMES.visitor, Tex.METAL, Tex.F_CONCRETE);
  const command = addRoom(world, RoomType.OFFICE, 594, 688, 128, 64, SPETSPRIEMNIK_ROOM_NAMES.command, Tex.MARBLE, Tex.F_RED_CARPET);
  const riotYard = addRoom(world, RoomType.COMMON, 408, 754, 210, 58, SPETSPRIEMNIK_ROOM_NAMES.riotYard, Tex.METAL, Tex.F_CONCRETE);
  const lowerLift = addRoom(world, RoomType.CORRIDOR, 454, 836, 116, 44, SPETSPRIEMNIK_ROOM_NAMES.lowerLift, Tex.LIFT_DOOR, Tex.F_CONCRETE);
  const contraband = addRoom(world, RoomType.STORAGE, 274, 728, 92, 52, SPETSPRIEMNIK_ROOM_NAMES.contraband, Tex.METAL, Tex.F_CONCRETE);
  paintRoomTerritory(world, guardPost, ZoneFaction.LIQUIDATOR);
  paintRoomTerritory(world, command, ZoneFaction.LIQUIDATOR);

  setLift(world, CX, lobby.y + 18, LiftDirection.UP);
  setFeature(world, CX + 8, lobby.y + 18, Feature.LIFT_BUTTON);
  setLift(world, CX, lowerLift.y + 22, LiftDirection.DOWN);
  setFeature(world, CX - 8, lowerLift.y + 22, Feature.LIFT_BUTTON);

  connectRoomToPoint(world, lobby, 'south', CX, 260, DoorState.CLOSED);
  connectRoomToPoint(world, intake, 'south', CX, 348, DoorState.CLOSED);
  connectRoomToPoint(world, guardPost, 'west', CX + 54, 325, DoorState.LOCKED, SPETSPRIEMNIK_GUARD_KEY);
  connectRoomToPoint(world, visitor, 'north', CX - 58, 648, DoorState.CLOSED);
  connectRoomToPoint(world, command, 'north', CX + 62, 648, DoorState.LOCKED, SPETSPRIEMNIK_PERMIT_KEY);
  connectRoomToPoint(world, riotYard, 'north', CX, 706, DoorState.CLOSED);
  connectRoomToPoint(world, lowerLift, 'north', CX, 812, DoorState.CLOSED);
  connectRoomToPoint(world, contraband, 'east', CX - 132, 754, DoorState.LOCKED, SPETSPRIEMNIK_CELL_KEY);

  for (const [room, feature] of [
    [lobby, Feature.LAMP],
    [intake, Feature.DESK],
    [guardPost, Feature.SCREEN],
    [visitor, Feature.TABLE],
    [command, Feature.DESK],
    [riotYard, Feature.CHAIR],
    [lowerLift, Feature.LAMP],
    [contraband, Feature.SHELF],
  ] as const) decorateRoom(world, room, feature);

  const west = buildCellblockBsp(world, 250, 318, 1);
  const east = buildCellblockBsp(world, 548, 318, 13);
  const lockedPermitDoors = [
    addGateAt(world, CX, 382, DoorState.LOCKED, SPETSPRIEMNIK_PERMIT_KEY),
    addGateAt(world, CX, 650, DoorState.LOCKED, SPETSPRIEMNIK_GUARD_KEY),
  ].length;
  const barredSightlineCells = west.barredCells + east.barredCells +
    placeBarredSightline(world, 312, 712, 642) +
    placeBarredSightline(world, 312, 712, 386);

  return {
    lobby,
    intake,
    guardPost,
    command,
    visitor,
    riotYard,
    lowerLift,
    contraband,
    guardLoopCells,
    cellRooms: [...west.rooms, ...east.rooms],
    shelterCellRooms: west.shelterRooms + east.shelterRooms,
    lockedCellDoors: west.lockedDoors + east.lockedDoors,
    barredSightlineCells,
    lockedPermitDoors,
  };
}

function spawnAuthoredActors(world: World, entities: Entity[], nextId: NextId, rooms: ReturnType<typeof buildCore>): void {
  spawnPlotNpc(entities, nextId, 'spetspriemnik_nachalnik_krivda', rooms.command, 24, 28, Math.PI);
  spawnPlotNpc(entities, nextId, 'spetspriemnik_guard_savva', rooms.guardPost, 22, 28, Math.PI);
  spawnPlotNpc(entities, nextId, 'spetspriemnik_clerk_alla', rooms.intake, 26, 28, Math.PI / 2);
  spawnPlotNpc(entities, nextId, 'spetspriemnik_prisoner_mira', rooms.visitor, 42, 32, 0);
  const informantRoom = rooms.cellRooms[8] ?? rooms.visitor;
  spawnPlotNpc(entities, nextId, 'spetspriemnik_informant_tolya', informantRoom, 18, 16, 0);

  spawnMonster(world, entities, nextId, MonsterKind.PROTOKOLNIK, rooms.command.x + rooms.command.w - 18, rooms.command.y + 44, 3, 'Протокольник заложников');
  spawnMonster(world, entities, nextId, MonsterKind.NELYUD, rooms.riotYard.x + rooms.riotYard.w - 24, rooms.riotYard.y + 28, 3, 'Нелюдь бунтовой переклички');
  spawnMonster(world, entities, nextId, MonsterKind.BEZEKHIY, rooms.contraband.x + 62, rooms.contraband.y + 28, 2, 'Безэхий под передачами');
}

export function tuneSpetspriemnikRouteZones(world: World): void {
  for (const zone of world.zones) {
    const d = world.dist(zone.cx, zone.cy, CX, CY);
    const inCellblock = zone.cx >= 210 && zone.cx <= 825 && zone.cy >= 300 && zone.cy <= 700;
    const inRiotYard = zone.cx >= 360 && zone.cx <= 660 && zone.cy >= 705 && zone.cy <= 845;
    zone.level = Math.max(2, Math.min(5, Math.round(2 + d / 260)));
    zone.fogged = false;
    if (inRiotYard) {
      zone.faction = zone.id % 3 === 0 ? ZoneFaction.SAMOSBOR : ZoneFaction.WILD;
      zone.level = Math.max(zone.level, 4);
    } else if (inCellblock) {
      zone.faction = zone.id % 5 === 0 ? ZoneFaction.WILD : ZoneFaction.LIQUIDATOR;
      zone.level = Math.max(zone.level, 3);
    } else {
      zone.faction = zone.id % 6 === 0 ? ZoneFaction.CITIZEN : ZoneFaction.LIQUIDATOR;
    }
  }
}

function calculateMetrics(world: World, built: ReturnType<typeof buildCore>): SpetspriemnikMetrics {
  return {
    routeId: SPETSPRIEMNIK_ROUTE_ID,
    z: SPETSPRIEMNIK_Z,
    cellRooms: built.cellRooms.length,
    shelterCellRooms: built.shelterCellRooms,
    lockedCellDoors: built.lockedCellDoors,
    lockedPermitDoors: built.lockedPermitDoors,
    guardLoopCells: built.guardLoopCells,
    barredSightlineCells: built.barredSightlineCells,
    hostageContainers: world.containers.filter(container => container.tags.includes('hostage_economy') || container.tags.includes('hostage_list')).length,
    riotHoldQuestBounded: true,
    stablePrisonerNpcIds: ['spetspriemnik_prisoner_mira', 'spetspriemnik_informant_tolya'],
  };
}

export function measureSpetspriemnikMetrics(generation: FloorGeneration): SpetspriemnikMetrics {
  const cached = metricsByWorld.get(generation.world);
  if (cached) return cached;
  const cellRooms = generation.world.rooms.filter(room => room.name.startsWith('Камера спецприёмника '));
  return {
    routeId: SPETSPRIEMNIK_ROUTE_ID,
    z: SPETSPRIEMNIK_Z,
    cellRooms: cellRooms.length,
    shelterCellRooms: cellRooms.filter(room => room.name.includes('гермоукрытие') || room.sealed).length,
    lockedCellDoors: [...generation.world.doors.values()].filter(door => door.state === DoorState.LOCKED && door.keyId === SPETSPRIEMNIK_CELL_KEY).length,
    lockedPermitDoors: [...generation.world.doors.values()].filter(door => door.state === DoorState.LOCKED && (door.keyId === SPETSPRIEMNIK_PERMIT_KEY || door.keyId === SPETSPRIEMNIK_GUARD_KEY)).length,
    guardLoopCells: 0,
    barredSightlineCells: generation.world.wallTex.reduce((count, tex, idx) => count + (tex === Tex.METAL && generation.world.cells[idx] === Cell.WALL ? 1 : 0), 0),
    hostageContainers: generation.world.containers.filter(container => container.tags.includes('hostage_economy') || container.tags.includes('hostage_list')).length,
    riotHoldQuestBounded: true,
    stablePrisonerNpcIds: ['spetspriemnik_prisoner_mira', 'spetspriemnik_informant_tolya'],
  };
}

export function generateSpetspriemnikDesignFloor(): FloorGeneration {
  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 1 };
  const built = buildCore(world);

  placeContainers(world, built);
  spawnAuthoredActors(world, entities, nextId, built);

  generateZones(world);
  tuneSpetspriemnikRouteZones(world);
  sanitizeDoors(world);
  world.rebuildContainerMap();
  world.bakeLights();

  metricsByWorld.set(world, calculateMetrics(world, built));

  return {
    world,
    entities,
    spawnX: CX + 0.5,
    spawnY: 270.5,
  };
}
