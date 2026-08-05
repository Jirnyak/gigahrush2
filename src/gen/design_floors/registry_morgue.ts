/* -- Design floor: Морг регистраций ----------------------------
 * Authored route floor registry_morgue, z=+18.
 */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  W,
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
  ZoneFaction,
  type Entity,
  type Room,
  type TerritoryOwner,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { setTerritoryOwnerAtIndex } from '../../systems/territory';
import {
  generateZones,
  placeDoor,
  placeDoorAt,
  sanitizeDoors,
  stampRoom,
} from '../shared';
import { genLog } from '../log';
import type { FloorGeneration } from '../floor_manifest';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('registry_morgue');

export const REGISTRY_MORGUE_ROUTE_ID = 'registry_morgue' as const;
export const REGISTRY_MORGUE_FUTURE_Z = 18 as const;
export const REGISTRY_MORGUE_BASE_FLOOR = FloorLevel.MINISTRY;
export const REGISTRY_MORGUE_DEBUG_ENTRY = 'design_floor.registry_morgue' as const;
const CORPSE_NUMBER_TAG_ITEM = 'corpse_number_tag' as const;

const REGISTRY_MORGUE_TARGET_ROUTE = {
  designFloorId: REGISTRY_MORGUE_ROUTE_ID,
  z: REGISTRY_MORGUE_FUTURE_Z,
  tags: ['registry_morgue', 'morgue', 'death_record'],
  label: 'Морг регистраций',
  risk: 4,
} as const;

type NextId = { v: number };
type MorgueDoorSide = 'north' | 'south' | 'west' | 'east';
type MorgueRecordDomain = 'living_record' | 'dead_record' | 'contaminated_record';

interface MorgueDrawerSlot {
  x: number;
  y: number;
  roomId: number;
  hilbert: number;
}

interface MorgueHqSpec {
  owner: TerritoryOwner;
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  supportPrefix: string;
  wallTex: Tex;
  floorTex: Tex;
  exitSide: MorgueDoorSide;
  connectX: number;
  connectY: number;
  support: readonly RoomType[];
}

interface MorgueArchiveBlockSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  connectX: number;
  connectY: number;
  ownerHint: TerritoryOwner;
}

interface MorgueRecordDomainDef {
  label: string;
  tag: string;
  faction: Faction;
  access: WorldContainer['access'];
  items: readonly string[];
}

const MORGUE_RECORD_DOMAIN_ORDER: readonly MorgueRecordDomain[] = [
  'living_record',
  'dead_record',
  'contaminated_record',
];

const REGISTRY_MORGUE_HQ_SPECS: readonly MorgueHqSpec[] = [
  {
    owner: ZoneFaction.CITIZEN,
    x: 118,
    y: 132,
    w: 48,
    h: 30,
    name: 'Гражданский гермопункт выдачи тел',
    supportPrefix: 'Очередь выдачи тел',
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_LINO,
    exitSide: 'south',
    connectX: 142,
    connectY: 260,
    support: [RoomType.KITCHEN, RoomType.BATHROOM, RoomType.STORAGE, RoomType.COMMON],
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    x: 790,
    y: 132,
    w: 66,
    h: 38,
    name: 'Ликвидаторский штаб карантинной выдачи',
    supportPrefix: 'Карантинный пост выдачи',
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_CONCRETE,
    exitSide: 'south',
    connectX: 824,
    connectY: 260,
    support: [RoomType.STORAGE, RoomType.MEDICAL, RoomType.OFFICE, RoomType.KITCHEN, RoomType.BATHROOM],
  },
  {
    owner: ZoneFaction.SCIENTIST,
    x: 474,
    y: 132,
    w: 58,
    h: 34,
    name: 'НИИ-гермокор сверки посмертных записей',
    supportPrefix: 'НИИ сверки записей',
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_MARBLE_TILE,
    exitSide: 'south',
    connectX: 512,
    connectY: 260,
    support: [RoomType.MEDICAL, RoomType.OFFICE, RoomType.PRODUCTION, RoomType.STORAGE],
  },
  {
    owner: ZoneFaction.CULTIST,
    x: 130,
    y: 836,
    w: 42,
    h: 28,
    name: 'Скрытая культовая комната последней подписи',
    supportPrefix: 'Культовая подпись',
    wallTex: Tex.DARK,
    floorTex: Tex.F_RED_CARPET,
    exitSide: 'north',
    connectX: 152,
    connectY: 782,
    support: [RoomType.COMMON, RoomType.STORAGE, RoomType.BATHROOM],
  },
  {
    owner: ZoneFaction.WILD,
    x: 806,
    y: 834,
    w: 46,
    h: 30,
    name: 'Дикий выбитый пост чужих бирок',
    supportPrefix: 'Выбитый пост бирок',
    wallTex: Tex.ROTTEN,
    floorTex: Tex.F_CONCRETE,
    exitSide: 'north',
    connectX: 828,
    connectY: 782,
    support: [RoomType.STORAGE, RoomType.KITCHEN, RoomType.BATHROOM, RoomType.COMMON],
  },
] as const;

const MORGUE_RECORD_DOMAINS: Record<MorgueRecordDomain, MorgueRecordDomainDef> = {
  living_record: {
    label: 'живая запись',
    tag: 'potts_living_record',
    faction: Faction.SCIENTIST,
    access: 'owner',
    items: ['passport_stub', 'blank_form', 'sealed_complaint'],
  },
  dead_record: {
    label: 'мертвая запись',
    tag: 'potts_dead_record',
    faction: Faction.SCIENTIST,
    access: 'locked',
    items: ['denunciation', 'ink_bottle', 'blank_form'],
  },
  contaminated_record: {
    label: 'зараженная запись',
    tag: 'potts_contaminated_record',
    faction: Faction.LIQUIDATOR,
    access: 'locked',
    items: ['emergency_roster', 'container_key_label', 'denunciation'],
  },
};

const NPC_DEFS: Record<string, PlotNpcDef> = {
  morgue_registrar_faina: {
    name: 'Фаина Реестровая',
    isFemale: true,
    faction: Faction.SCIENTIST,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 105, maxHp: 105, money: 90, speed: 0.7,
    inventory: [
      { defId: 'official_quarantine_clearance', count: 1 },
      { defId: 'blank_form', count: 2 },
      { defId: 'ink_bottle', count: 1 },
    ],
    talkLines: [
      'Здесь не спорят, кто умер. Здесь смотрят, какая строка в журнале осталась открытой.',
      'Бирка без книги ничего не значит. Книга без бирки значит слишком много.',
      'Холодильная камера держит туман лучше людей, но внутри всегда есть цена.',
      'Не подписывайте пустое свидетельство. Пустая графа быстро получает чужой пульс.',
      'Если запись исправить правильно, Райсовет признает новый факт раньше человека.',
    ],
    talkLinesPost: [
      'Запись легла ровно. Теперь дверь открывается на другое имя.',
      'Не носите две справки рядом. Они начинают сверять вас между собой.',
    ],
  },

  morgue_orderly_stepan: {
    name: 'Степан Носильный',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.LOCKSMITH,
    sprite: Occupation.LOCKSMITH,
    hp: 140, maxHp: 140, money: 35, speed: 0.8,
    inventory: [
      { defId: 'crowbar', count: 1 },
      { defId: 'container_key_label', count: 1 },
    ],
    talkLines: [
      'Я тележки считаю по колесам. Сегодня одно колесо вернулось без тележки.',
      'В грязной камере человек попросил свою бирку слишком вежливо.',
      'Бирку лучше не класть в карман с пропуском. Потом оба спорят, кто из вас живой.',
      'Не подходите близко к тому, кто сам знает номер ящика.',
    ],
    talkLinesPost: [
      'Теперь хотя бы ясно, кого не было.',
      'Бирки снова молчат. Для морга это хороший звук.',
    ],
  },

  morgue_relative_ira: {
    name: 'Ира Заименованная',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.HOUSEWIFE,
    sprite: Occupation.HOUSEWIFE,
    hp: 70, maxHp: 70, money: 18, speed: 0.65,
    inventory: [
      { defId: 'tea', count: 1 },
      { defId: 'sealed_complaint', count: 1 },
    ],
    talkLines: [
      'Мне не нужны лекарства. Мне нужна фамилия, которую не вычеркнули.',
      'Если найдете личное дело, я узнаю, кого мне оплакивать в очереди.',
      'Пустая бирка хуже пустого ящика. Ящик хотя бы честно молчит.',
      'Корешок без дела не возвращает человека. Но без корешка его даже искать не будут.',
    ],
    talkLinesPost: [
      'Имя вернулось. Этого мало, но теперь хотя бы есть кому молчать.',
      'Возьмите копию дела. Я больше не хочу быть единственным свидетелем.',
    ],
  },

  morgue_quarantine_sanitar: {
    name: 'Санитар Крутов',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 220, maxHp: 220, money: 75, speed: 0.95,
    inventory: [
      { defId: 'pipe', count: 1 },
      { defId: 'bandage', count: 1 },
      { defId: 'denunciation', count: 1 },
    ],
    talkLines: [
      'Медицинский шкаф открывается справкой, ключом или преступлением.',
      'Мне нужна чистая карантинная бумага. Тогда выдача станет законной.',
      'Если полезете в шкаф сами, журнал назовет это кражей. Я назову громче.',
      'Справка без адресата заражает очередь быстрее кашля.',
    ],
    talkLinesPost: [
      'Справка чистая. Лекарства теперь грязнятся только руками.',
      'Не тратьте ампулу на смелость. Смелость плохо документируется.',
    ],
  },
};

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'morgue_registrar_faina', NPC_DEFS.morgue_registrar_faina, [
  {
    id: 'morgue_find_tag',
    giverNpcId: 'morgue_registrar_faina',
    type: QuestType.FETCH,
    desc: 'Фаина Реестровая: «Верните номерок из холодной камеры. Без него живого человека можно закрыть бумагой, а потом искать уже по форме.»',
    targetItem: CORPSE_NUMBER_TAG_ITEM, targetCount: 1,
    targetFloor: REGISTRY_MORGUE_BASE_FLOOR,
    targetRoute: REGISTRY_MORGUE_TARGET_ROUTE,
    targetRoomName: 'Холодная камера-укрытие',
    targetHint: 'номерок лежит в холодной картотеке; взять его без сдачи можно как кражу из моргового хранения',
    rewardItem: 'official_quarantine_clearance', rewardCount: 1,
    extraRewards: [{ defId: 'clean_health_cert', count: 1 }],
    relationDelta: 14, xpReward: 65, moneyReward: 55,
    eventTags: ['registry_morgue', 'record_correction', 'death_record', 'tag_returned', 'identity'],
    eventData: { outcome: 'record_corrected', routeId: REGISTRY_MORGUE_ROUTE_ID },
    eventTargetName: 'Бирка N-16 возвращена в книгу умерших; запись перестала закрывать живую фамилию.',
    eventSeverity: 4,
  },
  {
    id: 'morgue_swap_certificate',
    giverNpcId: 'morgue_registrar_faina',
    type: QuestType.FETCH,
    desc: 'Фаина Реестровая: «Принесите акт о пропавшей записи. Я оформлю смерть так, что Райсовет выдаст допуск человеку у окна. Пустую строку не трогайте.»',
    targetItem: 'record_exposure_notice', targetCount: 1,
    targetFloor: REGISTRY_MORGUE_BASE_FLOOR,
    targetRoute: REGISTRY_MORGUE_TARGET_ROUTE,
    targetRoomName: 'Кабинет книги умерших',
    rewardItem: 'archive_access_permit', rewardCount: 1,
    extraRewards: [{ defId: 'passport_stub', count: 1 }],
    relationDelta: -4, xpReward: 80, moneyReward: 95,
    eventTags: ['registry_morgue', 'false_death', 'death_record', 'forgery', 'archive_access'],
    eventData: { outcome: 'false_death_registered', routeId: REGISTRY_MORGUE_ROUTE_ID },
    eventTargetName: 'Ложная смерть внесена в морговой журнал; архивный допуск выдан до проверки тела.',
    eventSeverity: 5,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'morgue_orderly_stepan', NPC_DEFS.morgue_orderly_stepan, [
  {
    id: 'morgue_missing_body',
    giverNpcId: 'morgue_orderly_stepan',
    type: QuestType.KILL,
    desc: 'Степан Носильный: «В зараженной камере ходит человек с чужой биркой. Проверьте дистанцией и уберите подмену.»',
    targetMonsterKind: MonsterKind.NELYUD,
    killNeeded: 1,
    targetFloor: REGISTRY_MORGUE_BASE_FLOOR,
    targetRoute: REGISTRY_MORGUE_TARGET_ROUTE,
    targetRoomName: 'Зараженная камера сверки',
    rewardItem: 'personal_file_copy', rewardCount: 1,
    extraRewards: [{ defId: 'filter_receipt', count: 1 }],
    relationDelta: 16, xpReward: 95, moneyReward: 90,
    eventTags: ['registry_morgue', 'false_body', 'false_death', 'nelyud', 'quarantine'],
    eventData: { outcome: 'false_body_exposed', routeId: REGISTRY_MORGUE_ROUTE_ID },
    eventTargetName: 'Человек с чужой биркой разоблачен в зараженной камере.',
    eventSeverity: 4,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'morgue_relative_ira', NPC_DEFS.morgue_relative_ira, [
  {
    id: 'morgue_name_return',
    giverNpcId: 'morgue_relative_ira',
    type: QuestType.FETCH,
    desc: 'Ира Заименованная: «Найдите пропавшее личное дело. Мне нужен не ящик, а имя, пока графа не стала чужой.»',
    targetItem: 'missing_record_file', targetCount: 1,
    targetFloor: REGISTRY_MORGUE_BASE_FLOOR,
    targetRoute: REGISTRY_MORGUE_TARGET_ROUTE,
    targetRoomName: 'Холодная камера-укрытие',
    rewardItem: 'sealed_complaint', rewardCount: 1,
    extraRewards: [{ defId: 'tea', count: 1 }],
    relationDelta: 18, xpReward: 70, moneyReward: 35,
    eventTags: ['registry_morgue', 'identity', 'missing_record', 'name_returned'],
    eventData: { outcome: 'name_returned', routeId: REGISTRY_MORGUE_ROUTE_ID },
    eventTargetName: 'Пропавшее личное дело вернуло Ире фамилию до закрытия ящика.',
    eventSeverity: 4,
  },
  {
    id: 'morgue_relative_escort',
    giverNpcId: 'morgue_relative_ira',
    type: QuestType.VISIT,
    desc: 'Ира Заименованная: «Проведите меня до книги умерших. Одной мне выдадут тишину, а при свидетеле должны назвать строку.»',
    targetFloor: REGISTRY_MORGUE_BASE_FLOOR,
    targetRoute: REGISTRY_MORGUE_TARGET_ROUTE,
    targetRoomName: 'Кабинет книги умерших',
    targetHint: 'доведите Иру от окна приема через бирочную к книге умерших; не оставляйте ее среди холодных ящиков',
    rewardItem: 'personal_file_copy', rewardCount: 1,
    extraRewards: [{ defId: 'water_coupon', count: 1 }],
    relationDelta: 14, xpReward: 65, moneyReward: 25,
    requiresSideQuestDone: 'morgue_name_return',
    failOnNpcDeathPlotId: 'morgue_relative_ira',
    eventTags: ['registry_morgue', 'escort', 'relative', 'identity', 'death_record'],
    eventData: { outcome: 'relative_escorted_to_ledger', routeId: REGISTRY_MORGUE_ROUTE_ID },
    eventTargetName: 'Иру довели до книги умерших как живого свидетеля записи.',
    eventSeverity: 4,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'morgue_quarantine_sanitar', NPC_DEFS.morgue_quarantine_sanitar, [
  {
    id: 'morgue_medicine_lock',
    giverNpcId: 'morgue_quarantine_sanitar',
    type: QuestType.FETCH,
    desc: 'Санитар Крутов: «Принесите чистую карантинную справку. Открою медшкаф законно. Иначе это будет кража.»',
    targetItem: 'official_quarantine_clearance', targetCount: 1,
    targetFloor: REGISTRY_MORGUE_BASE_FLOOR,
    targetRoute: REGISTRY_MORGUE_TARGET_ROUTE,
    targetRoomName: 'Зараженная камера сверки',
    rewardItem: 'sanitary_kit', rewardCount: 1,
    extraRewards: [{ defId: 'antibiotic', count: 1 }],
    relationDelta: 12, xpReward: 75, moneyReward: 60,
    eventTags: ['registry_morgue', 'quarantine_paper_use', 'medical', 'legal_medicine'],
    eventData: { outcome: 'quarantine_paper_spent', routeId: REGISTRY_MORGUE_ROUTE_ID },
    eventTargetName: 'Чистая карантинная справка обменяна на законную медицинскую выдачу.',
    eventSeverity: 4,
  },
]);

function setCellFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = feature;
}

function createDesignRoom(
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
  sealed = false,
): Room {
  const room = stampRoom(world, id, type, x, y, w, h, -1);
  room.name = name;
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  room.sealed = sealed;

  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.cells[ci] === Cell.WALL) {
        world.wallTex[ci] = wallTex;
        if (sealed) world.hermoWall[ci] = 1;
      }
    }
  }
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      world.floorTex[ci] = floorTex;
    }
  }
  return room;
}

function linkRooms(world: World, a: Room, b: Room, state: DoorState): void {
  const before = a.doors.length;
  const hermetic = state === DoorState.HERMETIC_OPEN || state === DoorState.HERMETIC_CLOSED;
  placeDoor(world, a, b, '', hermetic);
  if (a.doors.length <= before) return;
  const doorIdx = a.doors[a.doors.length - 1];
  const door = world.doors.get(doorIdx);
  if (!door) return;
  door.state = state;
}

function carveMorgueCell(world: World, x: number, y: number, floorTex: Tex, wallTex: Tex, roomId = -1): void {
  const ci = world.idx(x, y);
  const prev = world.cells[ci];
  if (prev !== Cell.LIFT && prev !== Cell.DOOR) world.cells[ci] = Cell.FLOOR;
  if (roomId >= 0 || world.roomMap[ci] < 0) world.roomMap[ci] = roomId;
  world.floorTex[ci] = floorTex;
  if (prev === Cell.WALL || prev === Cell.ABYSS) world.features[ci] = Feature.NONE;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const wi = world.idx(x + dx, y + dy);
      if (world.cells[wi] === Cell.WALL) world.wallTex[wi] = wallTex;
    }
  }
}

function carveMorgueLine(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  floorTex: Tex,
  wallTex: Tex,
): void {
  let x = ax;
  let y = ay;
  const sx = bx === ax ? 0 : bx > ax ? 1 : -1;
  const sy = by === ay ? 0 : by > ay ? 1 : -1;
  while (x !== bx) {
    carveMorgueBand(world, x, y, width, floorTex, wallTex);
    x += sx;
  }
  while (y !== by) {
    carveMorgueBand(world, x, y, width, floorTex, wallTex);
    y += sy;
  }
  carveMorgueBand(world, x, y, width, floorTex, wallTex);
}

function carveMorgueBand(world: World, x: number, y: number, width: number, floorTex: Tex, wallTex: Tex): void {
  for (let dy = -width; dy <= width; dy++) {
    for (let dx = -width; dx <= width; dx++) carveMorgueCell(world, x + dx, y + dy, floorTex, wallTex);
  }
}

function carveMorgueFrame(
  world: World,
  x: number,
  y: number,
  w: number,
  h: number,
  width: number,
  floorTex: Tex,
  wallTex: Tex,
): void {
  carveMorgueLine(world, x, y, x + w, y, width, floorTex, wallTex);
  carveMorgueLine(world, x, y + h, x + w, y + h, width, floorTex, wallTex);
  carveMorgueLine(world, x, y, x, y + h, width, floorTex, wallTex);
  carveMorgueLine(world, x + w, y, x + w, y + h, width, floorTex, wallTex);
}

function addMorgueGeometryRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
  sealed = false,
): Room {
  return createDesignRoom(world, world.rooms.length, type, x, y, w, h, name, wallTex, floorTex, sealed);
}

function canStampMorgueRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  if (x < 8 || y < 8 || x + w >= W - 8 || y + h >= W - 8) return false;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const idx = world.idx(x + dx, y + dy);
      const interior = dx >= 0 && dx < w && dy >= 0 && dy < h;
      if (world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.DOOR) return false;
      if (interior && world.roomMap[idx] >= 0) return false;
    }
  }
  return true;
}

function paintMorgueRoomTerritory(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      setTerritoryOwnerAtIndex(world, world.idx(room.x + dx, room.y + dy), owner);
    }
  }
}

function supportRoomSuffix(type: RoomType): string {
  switch (type) {
    case RoomType.KITCHEN: return 'кухня';
    case RoomType.BATHROOM: return 'санузел';
    case RoomType.STORAGE: return 'кладовая';
    case RoomType.MEDICAL: return 'медкабинет';
    case RoomType.OFFICE: return 'канцелярия';
    case RoomType.PRODUCTION: return 'мастерская';
    case RoomType.COMMON: return 'общая';
    default: return 'комната';
  }
}

function dressMorgueSupportRoom(world: World, room: Room, seed: number): void {
  switch (room.type) {
    case RoomType.KITCHEN:
      setCellFeature(world, room.x + 2, room.y + 2, Feature.STOVE);
      setCellFeature(world, room.x + room.w - 3, room.y + 2, Feature.SINK);
      setCellFeature(world, room.x + Math.floor(room.w / 2), room.y + room.h - 3, Feature.TABLE);
      break;
    case RoomType.BATHROOM:
      setCellFeature(world, room.x + 2, room.y + 2, Feature.TOILET);
      setCellFeature(world, room.x + room.w - 3, room.y + 2, Feature.SINK);
      break;
    case RoomType.MEDICAL:
      setCellFeature(world, room.x + 2, room.y + Math.floor(room.h / 2), Feature.BED);
      setCellFeature(world, room.x + room.w - 3, room.y + 2, Feature.APPARATUS);
      break;
    case RoomType.PRODUCTION:
      setCellFeature(world, room.x + 2, room.y + 2, Feature.MACHINE);
      setCellFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.APPARATUS);
      break;
    case RoomType.OFFICE:
      setCellFeature(world, room.x + 2, room.y + 2, Feature.DESK);
      setCellFeature(world, room.x + 3, room.y + 3, Feature.CHAIR);
      setCellFeature(world, room.x + room.w - 3, room.y + 2, Feature.SHELF);
      break;
    case RoomType.COMMON:
      setCellFeature(world, room.x + 2, room.y + 2, Feature.TABLE);
      setCellFeature(world, room.x + room.w - 3, room.y + 2, Feature.CHAIR);
      break;
    case RoomType.STORAGE:
    default:
      for (let dx = 2; dx < room.w - 2; dx += 4) setCellFeature(world, room.x + dx, room.y + 2, Feature.SHELF);
      break;
  }
  if (seed % 2 === 0) setCellFeature(world, room.x + room.w - 2, room.y + room.h - 2, Feature.LAMP);
}

function addMorgueOwnedRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
  owner: TerritoryOwner,
  doorSide: MorgueDoorSide,
  doorTargetX: number,
  doorTargetY: number,
  sealed = false,
): Room | null {
  if (!canStampMorgueRoom(world, x, y, w, h)) return null;
  const room = addMorgueGeometryRoom(world, type, x, y, w, h, name, wallTex, floorTex, sealed);
  paintMorgueRoomTerritory(world, room, owner);
  dressMorgueSupportRoom(world, room, room.id);
  openMorgueDoor(
    world,
    room,
    doorSide,
    doorSide === 'north' || doorSide === 'south' ? Math.floor(room.w / 2) : Math.floor(room.h / 2),
    sealed ? DoorState.HERMETIC_CLOSED : DoorState.CLOSED,
    doorTargetX,
    doorTargetY,
  );
  return room;
}

function openMorgueDoor(
  world: World,
  room: Room,
  side: MorgueDoorSide,
  offset: number,
  state: DoorState,
  targetX?: number,
  targetY?: number,
): void {
  const ox = Math.max(1, Math.min(room.w - 2, offset));
  const oy = Math.max(1, Math.min(room.h - 2, offset));
  let wx = room.x;
  let wy = room.y;
  let cx = room.x;
  let cy = room.y;

  switch (side) {
    case 'north':
      wx = room.x + ox;
      wy = room.y - 1;
      cx = wx;
      cy = wy - 1;
      break;
    case 'south':
      wx = room.x + ox;
      wy = room.y + room.h;
      cx = wx;
      cy = wy + 1;
      break;
    case 'west':
      wx = room.x - 1;
      wy = room.y + oy;
      cx = wx - 1;
      cy = wy;
      break;
    case 'east':
      wx = room.x + room.w;
      wy = room.y + oy;
      cx = wx + 1;
      cy = wy;
      break;
  }

  carveMorgueCell(world, cx, cy, Tex.F_TILE, room.wallTex);
  placeDoorAt(world, wx, wy, room.id);
  const door = world.doors.get(world.idx(wx, wy));
  if (door) door.state = state;
  if (targetX !== undefined && targetY !== undefined) {
    carveMorgueLine(world, cx, cy, targetX, targetY, 0, Tex.F_TILE, room.wallTex);
  }
}

function buildMorgueFactionHqs(world: World): void {
  for (const spec of REGISTRY_MORGUE_HQ_SPECS) {
    if (!canStampMorgueRoom(world, spec.x, spec.y, spec.w, spec.h)) continue;
    const core = addMorgueGeometryRoom(
      world,
      RoomType.HQ,
      spec.x,
      spec.y,
      spec.w,
      spec.h,
      spec.name,
      spec.wallTex,
      spec.floorTex,
      true,
    );
    paintMorgueRoomTerritory(world, core, spec.owner);
    dressMorgueSupportRoom(world, core, core.id);

    const centerX = core.x + Math.floor(core.w / 2);
    const corridorY = spec.exitSide === 'south' ? core.y + core.h + 8 : core.y - 8;
    carveMorgueLine(world, core.x - 18, corridorY, core.x + core.w + 18, corridorY, 1, spec.floorTex, spec.wallTex);
    openMorgueDoor(world, core, spec.exitSide, Math.floor(core.w / 2), DoorState.HERMETIC_CLOSED, centerX, corridorY);
    carveMorgueLine(world, centerX, corridorY, spec.connectX, spec.connectY, 1, spec.floorTex, spec.wallTex);

    const supportDoor = spec.exitSide === 'south' ? 'north' : 'south';
    const roomY = spec.exitSide === 'south' ? corridorY + 4 : corridorY - 15;
    const startX = core.x - 12;
    for (let i = 0; i < spec.support.length; i++) {
      const type = spec.support[i];
      const w = type === RoomType.MEDICAL || type === RoomType.PRODUCTION ? 20 : 17;
      const x = startX + i * 23;
      const room = addMorgueOwnedRoom(
        world,
        type,
        x,
        roomY,
        w,
        11,
        `${spec.supportPrefix}: ${supportRoomSuffix(type)}`,
        spec.wallTex,
        type === RoomType.KITCHEN || type === RoomType.BATHROOM || type === RoomType.MEDICAL ? Tex.F_TILE : spec.floorTex,
        spec.owner,
        supportDoor,
        x + Math.floor(w / 2),
        corridorY,
      );
      if (room) paintMorgueRoomTerritory(world, room, spec.owner);
    }
  }
}

export function reinforceRegistryMorgueAuthoredTerritory(world: World): void {
  for (const spec of REGISTRY_MORGUE_HQ_SPECS) {
    for (const room of world.rooms) {
      if (room.name !== spec.name && !room.name.startsWith(`${spec.supportPrefix}:`)) continue;
      paintMorgueRoomTerritory(world, room, spec.owner);
      if (room.name === spec.name) room.type = RoomType.HQ;
    }
  }
}

function buildMorgueArchiveBlock(world: World, spec: MorgueArchiveBlockSpec, rng: () => number): void {
  const corridorY = spec.y + Math.floor(spec.h / 2);
  const left = spec.x + 8;
  const right = spec.x + spec.w - 8;
  carveMorgueLine(world, left, corridorY, right, corridorY, 1, Tex.F_TILE, Tex.TILE_W);
  carveMorgueLine(world, spec.x + Math.floor(spec.w / 2), corridorY, spec.connectX, spec.connectY, 1, Tex.F_TILE, Tex.TILE_W);

  for (let x = spec.x + 12; x <= spec.x + spec.w - 28; x += 26) {
    for (const row of [
      { y: spec.y + 8, side: 'south' as MorgueDoorSide },
      { y: spec.y + 30, side: 'south' as MorgueDoorSide },
      { y: spec.y + spec.h - 42, side: 'north' as MorgueDoorSide },
      { y: spec.y + spec.h - 20, side: 'north' as MorgueDoorSide },
    ]) {
      const roomW = 16 + Math.floor(rng() * 4);
      const roomH = 9 + Math.floor(rng() * 3);
      const type = ((x + row.y) % 5 === 0) ? RoomType.OFFICE : RoomType.STORAGE;
      const room = addMorgueOwnedRoom(
        world,
        type,
        x,
        row.y,
        roomW,
        roomH,
        `${spec.name}: копийная ячейка`,
        Tex.TILE_W,
        Tex.F_TILE,
        spec.ownerHint,
        row.side,
        x + Math.floor(roomW / 2),
        corridorY,
      );
      if (!room) continue;
      if (type === RoomType.STORAGE) {
        setCellFeature(world, room.x + 2, room.y + Math.floor(room.h / 2), Feature.SHELF);
        setCellFeature(world, room.x + room.w - 3, room.y + Math.floor(room.h / 2), Feature.SHELF);
      }
    }
  }
}

function buildMorgueArchiveSideBlocks(world: World, rng: () => number): void {
  const blocks: readonly MorgueArchiveBlockSpec[] = [
    { x: 88, y: 118, w: 340, h: 118, name: 'Северо-западный зал копий живых', connectX: 240, connectY: 260, ownerHint: ZoneFaction.CITIZEN },
    { x: 582, y: 118, w: 350, h: 118, name: 'Северо-восточный зал карантинных копий', connectX: 784, connectY: 260, ownerHint: ZoneFaction.LIQUIDATOR },
    { x: 88, y: 804, w: 342, h: 118, name: 'Юго-западный зал последних подписей', connectX: 240, connectY: 782, ownerHint: ZoneFaction.CULTIST },
    { x: 584, y: 804, w: 348, h: 118, name: 'Юго-восточный зал выбитых бирок', connectX: 784, connectY: 782, ownerHint: ZoneFaction.WILD },
  ];
  for (const block of blocks) buildMorgueArchiveBlock(world, block, rng);
}

function buildMorgueMicroDrawerRows(world: World, rng: () => number): void {
  const rows = [
    { corridorY: 298, roomY: 306, side: 'north' as MorgueDoorSide, owner: ZoneFaction.SCIENTIST, prefix: 'Микрокартотека живых' },
    { corridorY: 350, roomY: 360, side: 'north' as MorgueDoorSide, owner: ZoneFaction.CITIZEN, prefix: 'Микрокабинет сверки фамилий' },
    { corridorY: 402, roomY: 416, side: 'north' as MorgueDoorSide, owner: ZoneFaction.LIQUIDATOR, prefix: 'Микроотсек карантинной бирки' },
    { corridorY: 616, roomY: 600, side: 'south' as MorgueDoorSide, owner: ZoneFaction.SCIENTIST, prefix: 'Микрокартотека умерших' },
    { corridorY: 668, roomY: 646, side: 'south' as MorgueDoorSide, owner: ZoneFaction.CITIZEN, prefix: 'Микроокно выдачи копий' },
    { corridorY: 720, roomY: 696, side: 'south' as MorgueDoorSide, owner: ZoneFaction.WILD, prefix: 'Микрокладовая сорванных бирок' },
  ];
  for (const row of rows) {
    for (let x = 82; x <= 930; x += 28) {
      const roomW = 12 + Math.floor(rng() * 5);
      const roomH = 7 + Math.floor(rng() * 3);
      const room = addMorgueOwnedRoom(
        world,
        (x + row.corridorY) % 7 === 0 ? RoomType.OFFICE : RoomType.STORAGE,
        x,
        row.roomY,
        roomW,
        roomH,
        `${row.prefix} ${x}`,
        Tex.TILE_W,
        Tex.F_TILE,
        row.owner,
        row.side,
        x + Math.floor(roomW / 2),
        row.corridorY,
      );
      if (!room) continue;
      if (rng() < 0.25) setCellFeature(world, room.x + room.w - 2, room.y + Math.floor(room.h / 2), Feature.SCREEN);
    }
  }
}

function dressDrawerCorridor(world: World, y: number, fromX: number, toX: number): void {
  for (let x = fromX; x <= toX; x += 6) {
    setCellFeature(world, x, y - 1, Feature.SHELF);
    setCellFeature(world, x + 3, y + 1, Feature.SHELF);
    if (x % 24 === 0) setCellFeature(world, x, y, Feature.LAMP);
  }
}

function dressConveyorSpine(world: World): void {
  for (let x = 92; x <= 932; x += 12) {
    setCellFeature(world, x, 516, Feature.MACHINE);
    if (x % 48 === 8) setCellFeature(world, x + 4, 514, Feature.DESK);
  }
  for (let y = 304; y <= 720; y += 32) {
    setCellFeature(world, 512, y, Feature.SCREEN);
  }
}

function dressDrawerRoom(world: World, room: Room, seed: number): void {
  for (let dx = 2; dx < room.w - 2; dx += 4) {
    setCellFeature(world, room.x + dx, room.y + 1, Feature.SHELF);
    setCellFeature(world, room.x + dx, room.y + room.h - 2, Feature.SHELF);
  }
  setCellFeature(world, room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2), Feature.BED);
  if (seed % 3 === 0) setCellFeature(world, room.x + room.w - 3, room.y + 2, Feature.LAMP);
}

function dressAutopsyBay(world: World, room: Room): void {
  for (let dx = 5; dx < room.w - 4; dx += 12) {
    setCellFeature(world, room.x + dx, room.y + Math.floor(room.h / 2), Feature.BED);
    setCellFeature(world, room.x + dx + 3, room.y + Math.floor(room.h / 2), Feature.APPARATUS);
  }
  for (let dx = 3; dx < room.w - 2; dx += 10) setCellFeature(world, room.x + dx, room.y + 2, Feature.SINK);
  setCellFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.LAMP);
}

function dressRegistryCounter(world: World, room: Room): void {
  for (let dx = 2; dx < room.w - 2; dx++) setCellFeature(world, room.x + dx, room.y + 3, Feature.DESK);
  for (let dx = 3; dx < room.w - 3; dx += 4) setCellFeature(world, room.x + dx, room.y + 5, Feature.CHAIR);
  for (let dy = 2; dy < room.h - 2; dy += 3) setCellFeature(world, room.x + room.w - 2, room.y + dy, Feature.SHELF);
  setCellFeature(world, room.x + 2, room.y + room.h - 3, Feature.SCREEN);
}

function dressFrostVault(world: World, room: Room): void {
  for (let dy = 2; dy < room.h - 2; dy += 3) {
    setCellFeature(world, room.x + 2, room.y + dy, Feature.SHELF);
    setCellFeature(world, room.x + room.w - 3, room.y + dy, Feature.SHELF);
  }
  for (let dx = 7; dx < room.w - 5; dx += 10) setCellFeature(world, room.x + dx, room.y + Math.floor(room.h / 2), Feature.BED);
  setCellFeature(world, room.x + Math.floor(room.w / 2), room.y + 2, Feature.LAMP);
}

function rotateHilbertQuadrant(n: number, x: number, y: number, rx: number, ry: number): [number, number] {
  if (ry !== 0) return [x, y];
  if (rx !== 0) {
    x = n - 1 - x;
    y = n - 1 - y;
  }
  return [y, x];
}

function hilbertIndex1024(x: number, y: number): number {
  let hx = Math.max(0, Math.min(W - 1, x | 0));
  let hy = Math.max(0, Math.min(W - 1, y | 0));
  let d = 0;
  for (let s = W >> 1; s > 0; s >>= 1) {
    const rx = (hx & s) > 0 ? 1 : 0;
    const ry = (hy & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    [hx, hy] = rotateHilbertQuadrant(s, hx, hy, rx, ry);
  }
  return d;
}

function buildDrawerCanyon(world: World, rng: () => number): MorgueDrawerSlot[] {
  const drawerSlots: MorgueDrawerSlot[] = [];
  const rows = [
    { roomY: 282, corridorY: 298, door: 'south' as MorgueDoorSide },
    { roomY: 334, corridorY: 350, door: 'south' as MorgueDoorSide },
    { roomY: 386, corridorY: 402, door: 'south' as MorgueDoorSide },
    { roomY: 620, corridorY: 616, door: 'north' as MorgueDoorSide },
    { roomY: 672, corridorY: 668, door: 'north' as MorgueDoorSide },
    { roomY: 724, corridorY: 720, door: 'north' as MorgueDoorSide },
  ];

  for (const row of rows) {
    carveMorgueLine(world, 76, row.corridorY, 948, row.corridorY, 1, Tex.F_TILE, Tex.HERMO_WALL);
    dressDrawerCorridor(world, row.corridorY, 84, 940);
    for (let x = 96; x <= 872; x += 112) {
      const room = addMorgueGeometryRoom(
        world,
        RoomType.STORAGE,
        x + Math.floor(rng() * 5),
        row.roomY,
        30 + Math.floor(rng() * 5),
        12,
        row.roomY < 512 ? 'Северная стена ящиков' : 'Южная стена ящиков',
        Tex.HERMO_WALL,
        Tex.F_TILE,
        true,
      );
      dressDrawerRoom(world, room, room.id);
      openMorgueDoor(world, room, row.door, Math.floor(room.w / 2), DoorState.CLOSED, room.x + Math.floor(room.w / 2), row.corridorY);
      const slotX = room.x + 2 + ((room.id * 7) % Math.max(4, room.w - 5));
      const slotY = row.door === 'south' ? room.y + 1 : room.y + room.h - 2;
      drawerSlots.push({ x: slotX, y: slotY, roomId: room.id, hilbert: hilbertIndex1024(slotX, slotY) });
    }
  }
  return drawerSlots;
}

function initialMorgueRecordDomain(slot: MorgueDrawerSlot): MorgueRecordDomain {
  const living = (slot.x - 500) * (slot.x - 500) + (slot.y - 516) * (slot.y - 516) - 16000;
  const dead = Math.min(
    (slot.x - 240) * (slot.x - 240) + (slot.y - 350) * (slot.y - 350),
    (slot.x - 784) * (slot.x - 784) + (slot.y - 668) * (slot.y - 668),
  );
  const contaminated = (slot.x - 835) * (slot.x - 835) + (slot.y - 516) * (slot.y - 516) - 9000;
  if (contaminated <= living && contaminated <= dead) return 'contaminated_record';
  if (living <= dead) return 'living_record';
  return 'dead_record';
}

function smoothMorgueRecordDomains(slots: readonly MorgueDrawerSlot[]): MorgueRecordDomain[] {
  const domains = slots.map(initialMorgueRecordDomain);
  const influenceRadius2 = 150 * 150;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < slots.length; i++) {
      const scores: Record<MorgueRecordDomain, number> = {
        living_record: domains[i] === 'living_record' ? 1.2 : 0,
        dead_record: domains[i] === 'dead_record' ? 1.2 : 0,
        contaminated_record: domains[i] === 'contaminated_record' ? 1.2 : 0,
      };
      for (let j = 0; j < slots.length; j++) {
        if (i === j) continue;
        const dx = slots[i].x - slots[j].x;
        const dy = slots[i].y - slots[j].y;
        const d2 = dx * dx + dy * dy;
        if (d2 > influenceRadius2) continue;
        scores[domains[j]] += 1.0 - d2 / influenceRadius2;
      }
      let best = domains[i];
      for (const domain of MORGUE_RECORD_DOMAIN_ORDER) {
        if (scores[domain] > scores[best]) best = domain;
      }
      domains[i] = best;
    }
  }
  for (const domain of MORGUE_RECORD_DOMAIN_ORDER) {
    if (domains.includes(domain)) continue;
    let bestIdx = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < slots.length; i++) {
      const candidate = initialMorgueRecordDomain(slots[i]);
      const penalty = candidate === domain ? -1_000_000 : 0;
      const score = slots[i].hilbert + penalty;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    domains[bestIdx] = domain;
  }
  return domains;
}

function nextMorgueContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(container => container.id === id)) id++;
  return id;
}

function drawerInventory(domain: MorgueRecordDomain, order: number): WorldContainer['inventory'] {
  if (order % 4 === 0) return [];
  const def = MORGUE_RECORD_DOMAINS[domain];
  return [{ defId: def.items[order % def.items.length], count: 1 }];
}

function addHilbertDrawerRegistry(world: World, drawerSlots: readonly MorgueDrawerSlot[]): void {
  const ordered = [...drawerSlots].sort((a, b) => a.hilbert - b.hilbert);
  const domains = smoothMorgueRecordDomains(ordered);
  for (let i = 0; i < ordered.length; i++) {
    const slot = ordered[i];
    if (world.containersAt(slot.x, slot.y).length > 0) continue;
    const domain = MORGUE_RECORD_DOMAINS[domains[i]];
    const order = i + 1;
    const orderLabel = order.toString().padStart(2, '0');
    world.addContainer({
      id: nextMorgueContainerId(world),
      x: slot.x,
      y: slot.y,
      floor: REGISTRY_MORGUE_BASE_FLOOR,
      roomId: slot.roomId,
      zoneId: world.zoneMap[world.idx(slot.x, slot.y)],
      kind: ContainerKind.FILING_CABINET,
      name: `Ящик H-${orderLabel}: ${domain.label}`,
      inventory: drawerInventory(domains[i], order),
      capacitySlots: 6,
      faction: domain.faction,
      access: domain.access,
      lockDifficulty: 4,
      discovered: true,
      tags: [
        REGISTRY_MORGUE_ROUTE_ID,
        'morgue',
        'drawer_canyon',
        'hilbert_tag_order',
        `hilbert_order_${orderLabel}`,
        'potts_record_domain',
        domain.tag,
        'morgue_theft',
      ],
    });
  }
}

function buildAutopsyBays(world: World): void {
  const specs = [
    { x: 128, y: 454, side: 'south' as MorgueDoorSide },
    { x: 256, y: 454, side: 'south' as MorgueDoorSide },
    { x: 704, y: 454, side: 'south' as MorgueDoorSide },
    { x: 832, y: 454, side: 'south' as MorgueDoorSide },
    { x: 128, y: 548, side: 'north' as MorgueDoorSide },
    { x: 256, y: 548, side: 'north' as MorgueDoorSide },
    { x: 704, y: 548, side: 'north' as MorgueDoorSide },
    { x: 832, y: 548, side: 'north' as MorgueDoorSide },
  ];
  for (const spec of specs) {
    const room = addMorgueGeometryRoom(world, RoomType.MEDICAL, spec.x, spec.y, 48, 22, 'Аутопсийная бухта', Tex.TILE_W, Tex.F_TILE);
    dressAutopsyBay(world, room);
    openMorgueDoor(world, room, spec.side, Math.floor(room.w / 2), DoorState.CLOSED, room.x + Math.floor(room.w / 2), 516);
  }
}

function buildRegistryCounters(world: World): void {
  const upper = addMorgueGeometryRoom(world, RoomType.OFFICE, 610, 486, 68, 22, 'Стойка юридической смерти', Tex.MARBLE, Tex.F_PARQUET);
  const lower = addMorgueGeometryRoom(world, RoomType.OFFICE, 346, 526, 66, 22, 'Стол сверки живых фамилий', Tex.MARBLE, Tex.F_PARQUET);
  dressRegistryCounter(world, upper);
  dressRegistryCounter(world, lower);
  openMorgueDoor(world, upper, 'south', Math.floor(upper.w / 2), DoorState.CLOSED, upper.x + Math.floor(upper.w / 2), 516);
  openMorgueDoor(world, lower, 'north', Math.floor(lower.w / 2), DoorState.CLOSED, lower.x + Math.floor(lower.w / 2), 516);
}

function buildFrostVaults(world: World): void {
  const west = addMorgueGeometryRoom(world, RoomType.STORAGE, 184, 506, 44, 30, 'Фрост-капсула повторной смерти', Tex.HERMO_WALL, Tex.F_TILE, true);
  const east = addMorgueGeometryRoom(world, RoomType.STORAGE, 796, 506, 46, 30, 'Фрост-архив безымянных', Tex.HERMO_WALL, Tex.F_TILE, true);
  dressFrostVault(world, west);
  dressFrostVault(world, east);
  openMorgueDoor(world, west, 'east', Math.floor(west.h / 2), DoorState.HERMETIC_CLOSED, 240, 516);
  openMorgueDoor(world, east, 'west', Math.floor(east.h / 2), DoorState.HERMETIC_CLOSED, 784, 516);
}

function carveTagSwitchbacks(world: World): void {
  const north = [
    [564, 516], [564, 460], [612, 460], [612, 424], [564, 424], [564, 388], [612, 388], [612, 350], [564, 350], [564, 298],
  ];
  const south = [
    [460, 516], [460, 574], [412, 574], [412, 616], [460, 616], [460, 668], [412, 668], [412, 720],
  ];
  for (let i = 1; i < north.length; i++) carveMorgueLine(world, north[i - 1][0], north[i - 1][1], north[i][0], north[i][1], 1, Tex.F_TILE, Tex.HERMO_WALL);
  for (let i = 1; i < south.length; i++) carveMorgueLine(world, south[i - 1][0], south[i - 1][1], south[i][0], south[i][1], 1, Tex.F_TILE, Tex.HERMO_WALL);
}

export function expandRegistryMorgueGeometry(world: World, rng: () => number): void {
  const drawerSlots = buildDrawerCanyon(world, rng);
  buildAutopsyBays(world);
  buildRegistryCounters(world);
  buildFrostVaults(world);

  carveMorgueLine(world, 72, 516, 952, 516, 2, Tex.F_TILE, Tex.METAL);
  carveMorgueLine(world, 116, 476, 908, 476, 1, Tex.F_TILE, Tex.TILE_W);
  carveMorgueLine(world, 116, 556, 908, 556, 1, Tex.F_TILE, Tex.TILE_W);
  carveMorgueLine(world, 116, 476, 116, 556, 1, Tex.F_TILE, Tex.TILE_W);
  carveMorgueLine(world, 908, 476, 908, 556, 1, Tex.F_TILE, Tex.TILE_W);
  carveMorgueLine(world, 512, 260, 512, 780, 1, Tex.F_TILE, Tex.HERMO_WALL);
  carveMorgueFrame(world, 64, 260, 896, 194, 2, Tex.F_TILE, Tex.HERMO_WALL);
  carveMorgueFrame(world, 64, 588, 896, 194, 2, Tex.F_TILE, Tex.HERMO_WALL);
  carveMorgueLine(world, 64, 358, 960, 358, 1, Tex.F_TILE, Tex.HERMO_WALL);
  carveMorgueLine(world, 64, 674, 960, 674, 1, Tex.F_TILE, Tex.HERMO_WALL);
  carveMorgueLine(world, 240, 260, 240, 782, 1, Tex.F_TILE, Tex.TILE_W);
  carveMorgueLine(world, 784, 260, 784, 782, 1, Tex.F_TILE, Tex.TILE_W);
  carveTagSwitchbacks(world);
  dressConveyorSpine(world);
  buildMorgueFactionHqs(world);
  buildMorgueArchiveSideBlocks(world, rng);
  buildMorgueMicroDrawerRows(world, rng);
  addHilbertDrawerRegistry(world, drawerSlots);
}

function placeDesignLift(world: World, x: number, y: number, direction: LiftDirection): void {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.LIFT;
  world.wallTex[ci] = Tex.LIFT_DOOR;
  world.liftDir[ci] = direction;
  const bi = world.idx(x + 1, y);
  if (world.cells[bi] === Cell.FLOOR) {
    world.features[bi] = Feature.LIFT_BUTTON;
    world.liftDir[bi] = direction;
  }
}

function addDrop(
  entities: Entity[],
  nextId: NextId,
  x: number,
  y: number,
  defId: string,
  count = 1,
  data?: unknown,
): void {
  entities.push({
    id: nextId.v++, type: EntityType.ITEM_DROP,
    x: x + 0.5, y: y + 0.5,
    angle: 0, pitch: 0,
    alive: true, speed: 0, sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count, data }],
  });
}

function spawnMorgueNpc(
  entities: Entity[],
  nextId: NextId,
  _def: PlotNpcDef,
  plotNpcId: string,
  x: number,
  y: number,
  canGiveQuest = true,
  weapon?: string,
): Entity {
  return requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle: Math.random() * Math.PI * 2,
    weapon,
    canGiveQuest,
    isTraveler: false,
    aiTarget: { x: 0, y: 0 },
  });
}

function spawnMorgueMonster(
  world: World,
  entities: Entity[],
  nextId: NextId,
  x: number,
  y: number,
  kind: MonsterKind,
  name: string,
): void {
  const def = MONSTERS[kind];
  if (!def) return;
  entities.push({
    id: nextId.v++, type: EntityType.MONSTER,
    x: x + 0.5, y: y + 0.5,
    angle: Math.random() * Math.PI * 2, pitch: 0,
    alive: true, speed: def.speed,
    sprite: monsterSpr(kind),
    name,
    hp: def.hp, maxHp: def.hp,
    monsterKind: kind, attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
  });
  stampSurfaceSplat(world, x, y, 0.5, 0.5, 3, 0.22, 7100 + kind, 82, 88, 94, false);
}

function addMorgueContainer(
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
  owner?: Entity,
): void {
  world.addContainer({
    id: world.containers.length + 1,
    x,
    y,
    floor: REGISTRY_MORGUE_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind,
    name,
    inventory,
    capacitySlots: Math.max(6, inventory.length + 3),
    ownerNpcId: owner?.id,
    ownerName: owner?.name,
    faction,
    access,
    lockDifficulty: access === 'locked' || access === 'owner' ? 4 : undefined,
    discovered: true,
    tags: [REGISTRY_MORGUE_ROUTE_ID, 'morgue', ...tags],
  });
}

function decorateRegistryMorgue(
  world: World,
  rooms: {
    reception: Room;
    washing: Room;
    tagRoom: Room;
    cold: Room;
    ledger: Room;
    contaminated: Room;
  },
): void {
  const { reception, washing, tagRoom, cold, ledger, contaminated } = rooms;

  for (let dx = 2; dx < reception.w - 2; dx++) setCellFeature(world, reception.x + dx, reception.y + 3, Feature.DESK);
  for (let dx = 2; dx < reception.w - 2; dx += 3) setCellFeature(world, reception.x + dx, reception.y + 4, Feature.CHAIR);
  setCellFeature(world, reception.x + reception.w - 2, reception.y + 1, Feature.LAMP);
  setCellFeature(world, reception.x + 2, reception.y + reception.h - 2, Feature.SCREEN);

  for (let dx = 2; dx < washing.w - 2; dx += 4) {
    setCellFeature(world, washing.x + dx, washing.y + 2, Feature.SINK);
    setCellFeature(world, washing.x + dx, washing.y + washing.h - 3, Feature.APPARATUS);
  }
  setCellFeature(world, washing.x + washing.w - 2, washing.y + 1, Feature.LAMP);

  for (let dy = 1; dy < tagRoom.h - 1; dy++) setCellFeature(world, tagRoom.x + 1, tagRoom.y + dy, Feature.SHELF);
  for (let dx = 3; dx < tagRoom.w - 2; dx += 3) setCellFeature(world, tagRoom.x + dx, tagRoom.y + 2, Feature.DESK);
  setCellFeature(world, tagRoom.x + tagRoom.w - 2, tagRoom.y + tagRoom.h - 2, Feature.LAMP);

  for (let dx = 2; dx < cold.w - 2; dx += 4) {
    setCellFeature(world, cold.x + dx, cold.y + 2, Feature.SHELF);
    setCellFeature(world, cold.x + dx, cold.y + cold.h - 3, Feature.SHELF);
  }
  for (let dx = 4; dx < cold.w - 3; dx += 5) setCellFeature(world, cold.x + dx, cold.y + Math.floor(cold.h / 2), Feature.BED);
  setCellFeature(world, cold.x + cold.w - 3, cold.y + 1, Feature.LAMP);

  for (let dy = 1; dy < ledger.h - 1; dy++) {
    setCellFeature(world, ledger.x + 1, ledger.y + dy, Feature.SHELF);
    setCellFeature(world, ledger.x + ledger.w - 2, ledger.y + dy, Feature.SHELF);
  }
  for (let dx = 4; dx < ledger.w - 3; dx += 4) setCellFeature(world, ledger.x + dx, ledger.y + 3, Feature.DESK);
  setCellFeature(world, ledger.x + Math.floor(ledger.w / 2), ledger.y + 1, Feature.LAMP);

  setCellFeature(world, contaminated.x + 2, contaminated.y + 2, Feature.APPARATUS);
  setCellFeature(world, contaminated.x + contaminated.w - 3, contaminated.y + 2, Feature.SINK);
  setCellFeature(world, contaminated.x + 3, contaminated.y + contaminated.h - 3, Feature.SHELF);
  setCellFeature(world, contaminated.x + contaminated.w - 3, contaminated.y + contaminated.h - 3, Feature.LAMP);

  world.wallTex[world.idx(reception.x + reception.w - 1, reception.y - 1)] = Tex.SCREEN_BASE + 3;
  world.wallTex[world.idx(ledger.x + Math.floor(ledger.w / 2), ledger.y - 1)] = Tex.POSTER_BASE + 9;
}

function seedRegistryMorgueContainers(
  world: World,
  rooms: {
    tagRoom: Room;
    cold: Room;
    ledger: Room;
    contaminated: Room;
  },
  npcs: {
    faina: Entity;
    stepan: Entity;
    sanitar: Entity;
    ira: Entity;
  },
): void {
  addMorgueContainer(
    world, rooms.tagRoom,
    rooms.tagRoom.x + 2, rooms.tagRoom.y + 2,
    ContainerKind.FILING_CABINET,
    'Бирочная стойка N-16',
    'faction',
    [
      { defId: 'container_key_label', count: 1 },
      { defId: 'blank_form', count: 2 },
      { defId: 'ink_bottle', count: 1 },
    ],
    ['record_correction', 'identity', 'paper', 'morgue_theft'],
    Faction.SCIENTIST,
    npcs.faina,
  );

  addMorgueContainer(
    world, rooms.cold,
    rooms.cold.x + 2, rooms.cold.y + 5,
    ContainerKind.METAL_CABINET,
    'Холодная картотека без номера',
    'owner',
    [
      { defId: 'missing_record_file', count: 1 },
      { defId: CORPSE_NUMBER_TAG_ITEM, count: 1 },
      { defId: 'container_key_label', count: 1 },
      { defId: 'emergency_roster', count: 1 },
    ],
    ['body_storage', 'identity', 'contaminated', 'morgue_theft'],
    Faction.CITIZEN,
    npcs.stepan,
  );

  addMorgueContainer(
    world, rooms.ledger,
    rooms.ledger.x + rooms.ledger.w - 3, rooms.ledger.y + 2,
    ContainerKind.SAFE,
    'Сейф свидетельств о смерти',
    'locked',
    [
      { defId: 'record_exposure_notice', count: 1 },
      { defId: 'official_quarantine_clearance', count: 1 },
      { defId: 'archive_access_permit', count: 1 },
    ],
    ['false_death', 'death_record', 'certificate', 'archive_hook'],
    Faction.SCIENTIST,
    npcs.faina,
  );

  addMorgueContainer(
    world, rooms.contaminated,
    rooms.contaminated.x + 3, rooms.contaminated.y + rooms.contaminated.h - 3,
    ContainerKind.MEDICAL_CABINET,
    'Опечатанный медицинский шкаф Крутова',
    'owner',
    [
      { defId: 'sanitary_kit', count: 1 },
      { defId: 'antibiotic', count: 1 },
      { defId: 'morphine_ampoule', count: 1 },
      { defId: 'bandage', count: 2 },
    ],
    ['quarantine', 'medical', 'scarcity', 'morgue_theft'],
    Faction.LIQUIDATOR,
    npcs.sanitar,
  );

  addMorgueContainer(
    world, rooms.ledger,
    rooms.ledger.x + 2, rooms.ledger.y + rooms.ledger.h - 2,
    ContainerKind.SECRET_STASH,
    'Папка Иры под пустым ящиком',
    'secret',
    [
      { defId: 'personal_file_copy', count: 1 },
      { defId: 'sealed_complaint', count: 1 },
      { defId: 'tea', count: 1 },
    ],
    ['relative', 'name', 'secret'],
    Faction.CITIZEN,
    npcs.ira,
  );
}

function seedRegistryMorgueReadables(world: World, entities: Entity[], nextId: NextId, rooms: {
  reception: Room;
  tagRoom: Room;
  cold: Room;
  ledger: Room;
  contaminated: Room;
}): void {
  addDrop(
    entities,
    nextId,
    rooms.reception.x + 3,
    rooms.reception.y + rooms.reception.h - 2,
    'note',
    1,
    'Прием ведется по двум спискам: кто умер и кто может это доказать. Несовпадение списков считать очередью.',
  );
  addDrop(
    entities,
    nextId,
    rooms.tagRoom.x + rooms.tagRoom.w - 3,
    rooms.tagRoom.y + 3,
    'note',
    1,
    'Бирка N-16 совпала с живой очередью Райсовета. До выяснения считать фамилию холодной и не выдавать ей воду.',
  );
  addDrop(
    entities,
    nextId,
    rooms.cold.x + rooms.cold.w - 4,
    rooms.cold.y + rooms.cold.h - 2,
    'siren_instruction',
    1,
  );
  addDrop(
    entities,
    nextId,
    rooms.ledger.x + 4,
    rooms.ledger.y + rooms.ledger.h - 2,
    'note',
    1,
    'Свидетельство о смерти открывает архив быстрее пропуска, если подпись поставлена до вопроса. После вопроса проверяющий смотрит на того, кто принес бумагу.',
  );
  addDrop(
    entities,
    nextId,
    rooms.contaminated.x + rooms.contaminated.w - 4,
    rooms.contaminated.y + 3,
    'note',
    1,
    'Если человек сам просит свою бирку, проверьте дистанцию. Нелюдь любит чужой порядок и ближний разговор.',
  );

  stampSurfaceSplat(world, rooms.ledger.x + 5, rooms.ledger.y + 5, 0.5, 0.5, 2, 0.18, 7161, 35, 35, 42, false);
  stampSurfaceSplat(world, rooms.cold.x + 7, rooms.cold.y + 5, 0.5, 0.5, 4, 0.2, 7162, 120, 140, 150, false);
  stampSurfaceSplat(world, rooms.tagRoom.x + 5, rooms.tagRoom.y + 5, 0.5, 0.5, 2, 0.18, 7163, 50, 45, 32, false);
}

export function generateRegistryMorgueDesignFloor(): FloorGeneration {
  const world = new World();
  const entities: Entity[] = [];
  const nextId: NextId = { v: 1 };
  let nextRoomId = 0;

  for (let i = 0; i < W * W; i++) {
    world.wallTex[i] = Tex.TILE_W;
    world.floorTex[i] = Tex.F_TILE;
  }
  generateZones(world);
  for (const zone of world.zones) {
    zone.faction = zone.id % 5 === 0 ? ZoneFaction.LIQUIDATOR : ZoneFaction.CITIZEN;
    zone.level = zone.id % 7 === 0 ? 3 : 2;
    zone.fogged = false;
  }

  const ox = 488;
  const oy = 500;
  const washing = createDesignRoom(
    world, nextRoomId++, RoomType.MEDICAL,
    ox, oy, 16, 11,
    'Моечный коридор регистрации',
    Tex.TILE_W, Tex.F_TILE,
  );
  const cold = createDesignRoom(
    world, nextRoomId++, RoomType.STORAGE,
    ox + 17, oy, 28, 11,
    'Холодная камера-укрытие',
    Tex.HERMO_WALL, Tex.F_TILE,
    true,
  );
  const contaminated = createDesignRoom(
    world, nextRoomId++, RoomType.MEDICAL,
    ox + 46, oy, 13, 11,
    'Зараженная камера сверки',
    Tex.HERMO_WALL, Tex.F_TILE,
    true,
  );
  const reception = createDesignRoom(
    world, nextRoomId++, RoomType.OFFICE,
    ox, oy + 12, 16, 10,
    'Окно приема смертей',
    Tex.TILE_W, Tex.F_LINO,
  );
  const tagRoom = createDesignRoom(
    world, nextRoomId++, RoomType.OFFICE,
    ox + 17, oy + 12, 12, 10,
    'Бирочная',
    Tex.TILE_W, Tex.F_LINO,
  );
  const ledger = createDesignRoom(
    world, nextRoomId++, RoomType.OFFICE,
    ox + 30, oy + 12, 16, 10,
    'Кабинет книги умерших',
    Tex.MARBLE, Tex.F_PARQUET,
  );

  linkRooms(world, washing, reception, DoorState.CLOSED);
  linkRooms(world, reception, tagRoom, DoorState.CLOSED);
  linkRooms(world, tagRoom, ledger, DoorState.CLOSED);
  linkRooms(world, tagRoom, cold, DoorState.HERMETIC_CLOSED);
  linkRooms(world, cold, contaminated, DoorState.HERMETIC_CLOSED);
  sanitizeDoors(world);

  placeDesignLift(world, reception.x + 1, reception.y + 1, LiftDirection.UP);
  placeDesignLift(world, reception.x + 1, reception.y + 3, LiftDirection.DOWN);

  decorateRegistryMorgue(world, { reception, washing, tagRoom, cold, ledger, contaminated });

  const faina = spawnMorgueNpc(
    entities, nextId, NPC_DEFS.morgue_registrar_faina,
    'morgue_registrar_faina', reception.x + 8, reception.y + 2,
  );
  const stepan = spawnMorgueNpc(
    entities, nextId, NPC_DEFS.morgue_orderly_stepan,
    'morgue_orderly_stepan', washing.x + 5, washing.y + 6,
    true, 'crowbar',
  );
  const ira = spawnMorgueNpc(
    entities, nextId, NPC_DEFS.morgue_relative_ira,
    'morgue_relative_ira', reception.x + 4, reception.y + 7,
  );
  const sanitar = spawnMorgueNpc(
    entities, nextId, NPC_DEFS.morgue_quarantine_sanitar,
    'morgue_quarantine_sanitar', contaminated.x + 2, contaminated.y + 2,
    true, 'pipe',
  );

  seedRegistryMorgueContainers(world, { tagRoom, cold, ledger, contaminated }, { faina, stepan, sanitar, ira });
  seedRegistryMorgueReadables(world, entities, nextId, { reception, tagRoom, cold, ledger, contaminated });

  spawnMorgueMonster(
    world, entities, nextId,
    contaminated.x + contaminated.w - 4,
    contaminated.y + contaminated.h - 4,
    MonsterKind.NELYUD,
    'Человек с чужой биркой',
  );
  spawnMorgueMonster(
    world, entities, nextId,
    ledger.x + ledger.w - 5,
    ledger.y + Math.floor(ledger.h / 2),
    MonsterKind.PECHATEED,
    'Печатеед свидетельств',
  );

  world.bakeLights();

  const spawnX = reception.x + 6.5;
  const spawnY = reception.y + 5.5;
  genLog(`[DESIGN_FLOOR] ${REGISTRY_MORGUE_ROUTE_ID} z=${REGISTRY_MORGUE_FUTURE_Z} at (${ox}, ${oy}) rooms=${nextRoomId}`);
  return { world, entities, spawnX, spawnY };
}
