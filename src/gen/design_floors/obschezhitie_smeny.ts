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
  NpcState,
  Occupation,
  QuestType,
  RoomType,
  Tex,
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
import { ensureConnectivity, generateZones, sanitizeDoors, stampRoom } from '../shared';
import type { FloorGeneration } from '../floor_manifest';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('obschezhitie_smeny');

export const OBSCHEZHITIE_SMENY_DESIGN_FLOOR_ID = 'obschezhitie_smeny' as const;
export const OBSCHEZHITIE_SMENY_ROUTE_Z = -6;

const BASE_FLOOR = FloorLevel.LIVING;
const DORM_SEED = hashSeed(OBSCHEZHITIE_SMENY_DESIGN_FLOOR_ID);
const SLEEPER_TEMPLATE_COUNT = 36;
const PATROL_TEMPLATE_COUNT = 8;

const DORM_RINGS = [
  { left: 300, top: 398, right: 724, bottom: 622, width: 3 },
  { left: 224, top: 342, right: 800, bottom: 688, width: 3 },
  { left: 150, top: 278, right: 874, bottom: 754, width: 3 },
  { left: 82, top: 198, right: 942, bottom: 834, width: 3 },
] as const;

const NPC_IDS = {
  rita: 'obschezhitie_rita_starshaya',
  gleb: 'obschezhitie_gleb_obhod',
  senya: 'obschezhitie_senya_tikhiy',
} as const;

const NPC_DEFS: Record<(typeof NPC_IDS)[keyof typeof NPC_IDS], PlotNpcDef> = {
  obschezhitie_rita_starshaya: {
    name: 'Рита Старшая Смены',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.STOREKEEPER,
    sprite: Occupation.STOREKEEPER,
    hp: 95,
    maxHp: 95,
    money: 34,
    speed: 0.82,
    inventory: [{ defId: 'shelter_tally', count: 1 }, { defId: 'bread', count: 2 }, { defId: 'water_coupon', count: 1 }],
    talkLines: [
      'Смена спит не потому, что спокойно. Просто иначе завтра никто не дойдёт до станка.',
      'Будишь одного - просыпается коридор. Коридор потом всё помнит.',
      'Ведомость укрытых нужна до сирены. Во сне фамилии легко теряются.',
      'Шкафы не наши и не чужие. Они сменные. Это хуже.',
    ],
    talkLinesPost: [
      'Список лежит у гермы. Если сирена начнётся, буди не голосом, а дверью.',
      'Кто взял по талону, тот живёт дольше. Кто взял тихо, живёт тише.',
    ],
  },
  obschezhitie_gleb_obhod: {
    name: 'Глеб Ночной Обход',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 130,
    maxHp: 130,
    money: 48,
    speed: 0.95,
    weapon: 'rubber_club',
    inventory: [{ defId: 'flashlight', count: 1 }, { defId: 'cigs', count: 2 }, { defId: 'samosbor_tally', count: 1 }],
    talkLines: [
      'Маршрут простой: дверь, храп, шкаф, тишина. Сложным его делают живые.',
      'Если хочешь пройти тихо, держи свет ниже лиц. Лицо просыпается быстрее человека.',
      'Пачка сигарет покупает один круг молчания. Второй круг уже оформляется.',
      'Сирена здесь звучит глухо. Зато шаги по линолеуму слышно прекрасно.',
    ],
    talkLinesPost: [
      'Обход видел меньше, чем мог. Запомни это как услугу.',
      'Тихая ночь не бесплатная, просто квитанцию выпишут утром.',
    ],
  },
  obschezhitie_senya_tikhiy: {
    name: 'Сеня Тихий',
    isFemale: false,
    faction: Faction.WILD,
    occupation: Occupation.TRAVELER,
    sprite: Occupation.TRAVELER,
    hp: 100,
    maxHp: 100,
    money: 17,
    speed: 1.03,
    inventory: [{ defId: 'container_key_label', count: 1 }, { defId: 'sleeping_pills', count: 1 }, { defId: 'cigs', count: 1 }],
    talkLines: [
      'Тут воруют не руками. Тут воруют звуком: хлопнул шкафом - уже пойман.',
      'Снотворное не для них, а для совести. Совесть громче койки скрипит.',
      'Я знаю шкаф, который открывается без свидетелей. Но сначала нужен повод не проснуться.',
      'Если начнётся самосбор, все станут честными сразу. До него выбирай сам.',
    ],
    talkLinesPost: [
      'Тихо получилось. Слишком тихо, но это уже не моя работа.',
      'Шкафы любят ночь. Утром они начинают жаловаться.',
    ],
  },
};

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, NPC_IDS.rita, NPC_DEFS.obschezhitie_rita_starshaya, [{
  id: 'obschezhitie_shelter_rollcall',
  giverNpcId: NPC_IDS.rita,
  type: QuestType.FETCH,
  desc: 'Рита Старшая Смены: «Принеси ведомость укрытых. Во сне смена не досчитается сама, а сирена любит пустые строки.»',
  targetItem: 'shelter_tally',
  targetCount: 1,
  rewardItem: 'water_coupon',
  rewardCount: 3,
  extraRewards: [{ defId: 'bread', count: 2 }, { defId: 'bandage', count: 1 }],
  relationDelta: 12,
  xpReward: 45,
  moneyReward: 20,
  eventTags: ['obschezhitie_smeny', 'shelter', 'samosbor', 'resident_relief'],
  eventData: { routeChoice: 'protect_sleeping_shift', rumorIds: ['samosbor_istotit_shelter_tally'] },
}]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, NPC_IDS.gleb, NPC_DEFS.obschezhitie_gleb_obhod, [{
  id: 'obschezhitie_patrol_silence',
  giverNpcId: NPC_IDS.gleb,
  type: QuestType.FETCH,
  desc: 'Глеб Ночной Обход: «Пачку сигарет на пост. Обход пройдёт тише, и никто не будет сверять каждый чужой шкаф до отбоя.»',
  targetItem: 'cigs',
  targetCount: 2,
  rewardItem: 'samosbor_tally',
  rewardCount: 1,
  extraRewards: [{ defId: 'flashlight', count: 1 }],
  relationDelta: 8,
  xpReward: 35,
  moneyReward: 18,
  eventTags: ['obschezhitie_smeny', 'patrol', 'witness', 'quiet_passage'],
  eventData: { routeChoice: 'buy_patrol_silence', rumorIds: ['smoking_second_round_truth'] },
}]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, NPC_IDS.senya, NPC_DEFS.obschezhitie_senya_tikhiy, [{
  id: 'obschezhitie_quiet_lockers',
  giverNpcId: NPC_IDS.senya,
  type: QuestType.FETCH,
  desc: 'Сеня Тихий: «Один блистер снотворного - и скажу, какой шкаф не скрипит. Робко берёшь или честно уходишь - это уже твой шум.»',
  targetItem: 'sleeping_pills',
  targetCount: 1,
  rewardItem: 'container_key_label',
  rewardCount: 1,
  extraRewards: [{ defId: 'cigs', count: 2 }],
  relationDelta: 6,
  xpReward: 40,
  moneyReward: 10,
  eventTags: ['obschezhitie_smeny', 'theft', 'quiet_loot', 'witness'],
  eventData: { routeChoice: 'enable_quiet_locker_theft', rumorIds: ['hunter_wet_container_dry'] },
}]);

interface DormLayout {
  northY: number;
  southY: number;
  leftX: number;
  rightX: number;
  spawnX: number;
  spawnY: number;
}

interface DormRooms {
  bunks: Room[];
  support: Room[];
  hqs: DormHq[];
  watch: Room;
  kitchen: Room;
  lockers: Room;
  wash: Room;
  shelter: Room;
  smoking: Room;
}

interface DormHq {
  owner: ZoneFaction;
  hq: Room;
  support: Room[];
}

export function generateObschezhitieSmenyDesignFloor(seed = DORM_SEED): FloorGeneration {
  return withSeededRandom(seed, () => {
    const world = new World();
    const entities: Entity[] = [];
    const nextId = { v: 1 };
    const containerId = { v: 1 };

    const layout = carveDormSlabs(world);
    carveDormRings(world, layout);
    const rooms = buildDormRooms(world, layout);
    buildDormRoomStacks(world, rooms);
    buildDormHqComplexes(world, rooms);
    generateZones(world);
    applyDormZones(world);
    reinforceDormAuthoredTerritory(world, rooms);
    placeDormLifts(world, layout);
    decorateDorm(world, layout, rooms);
    const owners = spawnAuthoredDormNpcs(entities, nextId, rooms);
    spawnSleeperTemplates(entities, nextId, rooms.bunks);
    spawnNightPatrolTemplates(entities, nextId, layout);
    placeDormContainers(world, containerId, rooms, owners);

    sanitizeDoors(world);
    ensureConnectivity(world, layout.spawnX, layout.spawnY);
    world.rebuildContainerMap();
    world.bakeLights();

    return { world, entities, spawnX: layout.spawnX, spawnY: layout.spawnY };
  });
}

function carveDormSlabs(world: World): DormLayout {
  const leftX = 356;
  const rightX = 668;
  const northY = 458;
  const southY = 560;
  carveLineWidth(world, leftX, northY, rightX, northY, 3, Tex.F_LINO);
  carveLineWidth(world, leftX, southY, rightX, southY, 3, Tex.F_LINO);
  for (const x of [378, 512, 646]) carveLineWidth(world, x, northY, x, southY + 2, 3, Tex.F_LINO);
  carveLineWidth(world, leftX, 510, rightX, 510, 2, Tex.F_CONCRETE);
  carveLineWidth(world, 512, northY - 20, 512, southY + 22, 2, Tex.F_CONCRETE);
  placeCorridorNoiseBreak(world, 446, northY, 1);
  placeCorridorNoiseBreak(world, 574, southY, 1);
  return { leftX, rightX, northY, southY, spawnX: leftX + 5.5, spawnY: northY + 1.5 };
}

function carveDormRings(world: World, layout: DormLayout): void {
  for (const ring of DORM_RINGS) carveDormRing(world, ring.left, ring.top, ring.right, ring.bottom, ring.width);

  for (const x of [layout.leftX, 378, 512, 646, layout.rightX]) {
    carveLineWidth(world, x, DORM_RINGS[0].top, x, DORM_RINGS[0].bottom, 2, Tex.F_LINO);
  }
  for (const x of [184, 332, 512, 692, 840]) {
    carveLineWidth(world, x, DORM_RINGS[1].top, x, DORM_RINGS[3].bottom, 2, Tex.F_LINO);
  }
  for (const y of [layout.northY, 510, layout.southY, 646]) {
    carveLineWidth(world, DORM_RINGS[0].left, y, DORM_RINGS[2].right, y, 2, Tex.F_LINO);
  }
  carveLineWidth(world, DORM_RINGS[3].left, 512, DORM_RINGS[3].right, 512, 2, Tex.F_LINO);
  carveLineWidth(world, 512, DORM_RINGS[3].top, 512, DORM_RINGS[3].bottom, 2, Tex.F_LINO);
}

function carveDormRing(world: World, left: number, top: number, right: number, bottom: number, width: number): void {
  carveLineWidth(world, left, top, right, top, width, Tex.F_LINO);
  carveLineWidth(world, left, bottom, right, bottom, width, Tex.F_LINO);
  carveLineWidth(world, left, top, left, bottom, width, Tex.F_LINO);
  carveLineWidth(world, right, top, right, bottom, width, Tex.F_LINO);
}

function buildDormRooms(world: World, layout: DormLayout): DormRooms {
  const bunks: Room[] = [];
  const support: Room[] = [];
  const hqs: DormHq[] = [];
  for (let i = 0; i < 8; i++) {
    const x = 368 + i * 36;
    const north = createRoom(world, RoomType.LIVING, x, layout.northY - 18, 22, 12, `Северная спальная секция ${i + 1}`, Tex.PANEL, Tex.F_CARPET);
    connectRoomToPoint(world, north, north.x + 11, north.y + north.h, north.x + 11, layout.northY + 1, DoorState.CLOSED);
    bunks.push(north);

    const south = createRoom(world, RoomType.LIVING, x, layout.southY + 6, 22, 12, `Южная спальная секция ${i + 1}`, Tex.PANEL, Tex.F_CARPET);
    connectRoomToPoint(world, south, south.x + 11, south.y - 1, south.x + 11, layout.southY + 1, DoorState.CLOSED);
    bunks.push(south);
  }

  const watch = createRoom(world, RoomType.OFFICE, 493, 480, 38, 18, 'Пост ночного обхода', Tex.PANEL, Tex.F_LINO);
  connectRoomToPoint(world, watch, watch.x + 19, watch.y - 1, watch.x + 19, layout.northY + 1, DoorState.CLOSED);

  const kitchen = createRoom(world, RoomType.KITCHEN, 318, 490, 30, 24, 'Чайная сменного общежития', Tex.TILE_W, Tex.F_TILE);
  connectRoomToPoint(world, kitchen, kitchen.x + kitchen.w, kitchen.y + 12, layout.leftX, kitchen.y + 12, DoorState.CLOSED);

  const lockers = createRoom(world, RoomType.STORAGE, 684, 448, 30, 28, 'Сушилка и сменные шкафы', Tex.PANEL, Tex.F_CONCRETE);
  connectRoomToPoint(world, lockers, lockers.x - 1, lockers.y + 14, layout.rightX, lockers.y + 14, DoorState.LOCKED, 'container_key_label');

  const wash = createRoom(world, RoomType.BATHROOM, 684, 540, 30, 24, 'Умывальная тихой смены', Tex.TILE_W, Tex.F_WATER);
  connectRoomToPoint(world, wash, wash.x - 1, wash.y + 12, layout.rightX, wash.y + 12, DoorState.CLOSED);

  const shelter = createRoom(world, RoomType.COMMON, 456, 596, 112, 22, 'Гермоубежище под спальными секциями', Tex.HERMO_WALL, Tex.F_CONCRETE);
  shelter.sealed = true;
  connectRoomToPoint(world, shelter, shelter.x + 56, shelter.y - 1, shelter.x + 56, layout.southY + 1, DoorState.HERMETIC_OPEN);

  const smoking = createRoom(world, RoomType.SMOKING, 406, 486, 32, 18, 'Курилка шепотом у батареи', Tex.PANEL, Tex.F_LINO);
  connectRoomToPoint(world, smoking, smoking.x + 16, smoking.y - 1, smoking.x + 16, layout.northY + 1, DoorState.CLOSED);

  return { bunks, support, hqs, watch, kitchen, lockers, wash, shelter, smoking };
}

function buildDormRoomStacks(world: World, rooms: DormRooms): void {
  let serial = 0;
  for (let ringIndex = 0; ringIndex < DORM_RINGS.length; ringIndex++) {
    const ring = DORM_RINGS[ringIndex];
    for (let x = ring.left + 34; x <= ring.right - 34; x += 42) {
      const north = createDormStackRoom(world, x - 9, ring.top - 15, 18, 11, 'north', ring.top, ringIndex, serial++);
      registerDormStackRoom(rooms, north);
      const south = createDormStackRoom(world, x - 9, ring.bottom + 4, 18, 11, 'south', ring.bottom, ringIndex, serial++);
      registerDormStackRoom(rooms, south);
    }
    for (let y = ring.top + 34; y <= ring.bottom - 34; y += 42) {
      const west = createDormStackRoom(world, ring.left - 16, y - 8, 12, 16, 'west', ring.left, ringIndex, serial++);
      registerDormStackRoom(rooms, west);
      const east = createDormStackRoom(world, ring.right + 4, y - 8, 12, 16, 'east', ring.right, ringIndex, serial++);
      registerDormStackRoom(rooms, east);
    }
  }
}

function createDormStackRoom(
  world: World,
  x: number,
  y: number,
  w: number,
  h: number,
  side: 'north' | 'south' | 'west' | 'east',
  ringCoord: number,
  ringIndex: number,
  serial: number,
): Room {
  const type = dormStackRoomType(serial, ringIndex);
  const tile = type === RoomType.KITCHEN || type === RoomType.BATHROOM;
  const wallTex = tile ? Tex.TILE_W : type === RoomType.STORAGE ? Tex.METAL : Tex.PANEL;
  const floorTex = tile ? (type === RoomType.BATHROOM ? Tex.F_WATER : Tex.F_TILE) : type === RoomType.STORAGE ? Tex.F_CONCRETE : Tex.F_CARPET;
  const room = createRoom(world, type, x, y, w, h, dormStackRoomName(type, ringIndex, serial), wallTex, floorTex);
  if (side === 'north') connectRoomToPoint(world, room, room.x + (room.w >> 1), room.y + room.h, room.x + (room.w >> 1), ringCoord, DoorState.CLOSED);
  else if (side === 'south') connectRoomToPoint(world, room, room.x + (room.w >> 1), room.y - 1, room.x + (room.w >> 1), ringCoord, DoorState.CLOSED);
  else if (side === 'west') connectRoomToPoint(world, room, room.x + room.w, room.y + (room.h >> 1), ringCoord, room.y + (room.h >> 1), DoorState.CLOSED);
  else connectRoomToPoint(world, room, room.x - 1, room.y + (room.h >> 1), ringCoord, room.y + (room.h >> 1), DoorState.CLOSED);
  return room;
}

function dormStackRoomType(serial: number, ringIndex: number): RoomType {
  const roll = (serial * 7 + ringIndex * 11) % 17;
  if (roll === 0) return RoomType.KITCHEN;
  if (roll === 4) return RoomType.BATHROOM;
  if (roll === 8 || roll === 13) return RoomType.STORAGE;
  if (roll === 11) return RoomType.SMOKING;
  if (roll === 15) return RoomType.COMMON;
  return RoomType.LIVING;
}

function dormStackRoomName(type: RoomType, ringIndex: number, serial: number): string {
  const ring = ringIndex + 1;
  switch (type) {
    case RoomType.KITCHEN: return `Кольцо ${ring}: сменная чайная ${serial + 1}`;
    case RoomType.BATHROOM: return `Кольцо ${ring}: умывальная очередь ${serial + 1}`;
    case RoomType.STORAGE: return `Кольцо ${ring}: шкафовой стек ${serial + 1}`;
    case RoomType.SMOKING: return `Кольцо ${ring}: тихая курилка ${serial + 1}`;
    case RoomType.COMMON: return `Кольцо ${ring}: комната свидетелей ${serial + 1}`;
    default: return `Кольцо ${ring}: койко-ячейка ${serial + 1}`;
  }
}

function registerDormStackRoom(rooms: DormRooms, room: Room): void {
  if (room.type === RoomType.LIVING) rooms.bunks.push(room);
  else rooms.support.push(room);
}

function buildDormHqComplexes(world: World, rooms: DormRooms): void {
  addDormHqComplex(world, rooms, {
    owner: ZoneFaction.CITIZEN,
    name: 'Гражданский штаб старшей смены',
    hq: [430, 646, 42, 18],
    door: 'north',
    target: { x: 451, y: 622 },
    support: [
      [RoomType.KITCHEN, 382, 646, 28, 15, 'Кухня штаба старшей смены'],
      [RoomType.MEDICAL, 490, 646, 26, 15, 'Медпункт недосыпа'],
      [RoomType.STORAGE, 430, 672, 38, 14, 'Склад ведомостей укрытых'],
    ],
  });
  addDormHqComplex(world, rooms, {
    owner: ZoneFaction.LIQUIDATOR,
    name: 'Герма ночного обхода',
    hq: [780, 386, 34, 18],
    door: 'west',
    target: { x: 724, y: 395 },
    support: [
      [RoomType.OFFICE, 820, 384, 26, 14, 'Стол протоколов обхода'],
      [RoomType.STORAGE, 780, 412, 34, 14, 'Шкаф дубинок и фонарей'],
      [RoomType.BATHROOM, 820, 410, 24, 14, 'Умывальная поста обхода'],
    ],
  });
  addDormHqComplex(world, rooms, {
    owner: ZoneFaction.SCIENTIST,
    name: 'Пункт сомнологов НИИ',
    hq: [204, 692, 36, 18],
    door: 'east',
    target: { x: 300, y: 701 },
    support: [
      [RoomType.MEDICAL, 164, 692, 28, 16, 'Кабинет измерения сна'],
      [RoomType.OFFICE, 204, 720, 32, 14, 'Стол протоколов храпа'],
      [RoomType.STORAGE, 164, 718, 28, 14, 'Кладовая датчиков койки'],
    ],
  });
  addDormHqComplex(world, rooms, {
    owner: ZoneFaction.WILD,
    name: 'Дикий шкафовой схрон',
    hq: [118, 536, 34, 18],
    door: 'east',
    target: { x: 224, y: 545 },
    support: [
      [RoomType.STORAGE, 76, 536, 30, 16, 'Разобранные тумбы диких'],
      [RoomType.SMOKING, 118, 562, 32, 14, 'Курилка без свидетелей'],
      [RoomType.KITCHEN, 76, 560, 28, 14, 'Чайник на украденной плитке'],
    ],
  });
  addDormHqComplex(world, rooms, {
    owner: ZoneFaction.CULTIST,
    name: 'Сонная келья свидетелей',
    hq: [842, 786, 34, 18],
    door: 'west',
    target: { x: 800, y: 795 },
    support: [
      [RoomType.COMMON, 882, 786, 34, 16, 'Комната тихой молитвы'],
      [RoomType.STORAGE, 842, 812, 32, 14, 'Полка чужих биркокроватей'],
      [RoomType.BATHROOM, 882, 810, 26, 14, 'Мокрая ниша омовения'],
    ],
  });
}

interface DormHqSpec {
  owner: ZoneFaction;
  name: string;
  hq: [number, number, number, number];
  door: 'north' | 'south' | 'west' | 'east';
  target: { x: number; y: number };
  support: readonly [RoomType, number, number, number, number, string][];
}

function addDormHqComplex(world: World, rooms: DormRooms, spec: DormHqSpec): void {
  const [x, y, w, h] = spec.hq;
  const hq = createRoom(world, RoomType.HQ, x, y, w, h, spec.name, Tex.HERMO_WALL, Tex.F_CONCRETE);
  hq.sealed = true;
  connectRoomToNearestDormCorridor(world, hq, DoorState.HERMETIC_OPEN, spec.target, spec.door);
  const support: Room[] = [];
  for (const [type, sx, sy, sw, sh, name] of spec.support) {
    const tile = type === RoomType.KITCHEN || type === RoomType.BATHROOM || type === RoomType.MEDICAL;
    const room = createRoom(world, type, sx, sy, sw, sh, name, tile ? Tex.TILE_W : Tex.PANEL, tile ? Tex.F_TILE : Tex.F_LINO);
    connectRoomToNearestDormCorridor(world, room, DoorState.CLOSED, spec.target);
    support.push(room);
    rooms.support.push(room);
  }
  rooms.hqs.push({ owner: spec.owner, hq, support });
}

function connectRoomToNearestDormCorridor(
  world: World,
  room: Room,
  state: DoorState,
  fallback: { x: number; y: number },
  preferredSide?: 'north' | 'south' | 'west' | 'east',
): void {
  const target = nearestDormCorridorCell(world, room, 96) ?? fallback;
  const rx = room.x + (room.w >> 1);
  const ry = room.y + (room.h >> 1);
  const side = preferredSide ?? dormDoorSideToward(world, rx, ry, target.x, target.y);
  if (side === 'north') connectRoomToPoint(world, room, rx, room.y - 1, target.x, target.y, state);
  else if (side === 'south') connectRoomToPoint(world, room, rx, room.y + room.h, target.x, target.y, state);
  else if (side === 'west') connectRoomToPoint(world, room, room.x - 1, ry, target.x, target.y, state);
  else connectRoomToPoint(world, room, room.x + room.w, ry, target.x, target.y, state);
}

function dormDoorSideToward(world: World, x: number, y: number, targetX: number, targetY: number): 'north' | 'south' | 'west' | 'east' {
  const dx = world.delta(x, targetX);
  const dy = world.delta(y, targetY);
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'west' : 'east';
  return dy < 0 ? 'north' : 'south';
}

function nearestDormCorridorCell(world: World, room: Room, radius: number): { x: number; y: number } | null {
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  let bestX = -1;
  let bestY = -1;
  let bestD2 = Infinity;
  for (let r = 2; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = world.wrap(cx + dx);
        const y = world.wrap(cy + dy);
        const idx = world.idx(x, y);
        if (world.roomMap[idx] >= 0) continue;
        const cell = world.cells[idx];
        if (cell !== Cell.FLOOR && cell !== Cell.WATER && cell !== Cell.DOOR && cell !== Cell.LIFT) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestX = x;
          bestY = y;
          bestD2 = d2;
        }
      }
    }
    if (bestX >= 0) return { x: bestX, y: bestY };
  }
  return null;
}

function createRoom(
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
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const i = world.idx(room.x + dx, room.y + dy);
      if (world.cells[i] === Cell.WALL) world.wallTex[i] = wallTex;
    }
  }
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) world.floorTex[world.idx(room.x + dx, room.y + dy)] = floorTex;
  }
  return room;
}

function carveFloorCell(world: World, x: number, y: number, floorTex: Tex): void {
  const i = world.idx(x, y);
  world.cells[i] = Cell.FLOOR;
  world.roomMap[i] = -1;
  world.floorTex[i] = floorTex;
  world.factionControl[i] = ZoneFaction.CITIZEN;
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

function placeCorridorNoiseBreak(world: World, x: number, y: number, gapOffset: number): void {
  for (let dy = 0; dy < 3; dy++) {
    if (dy === gapOffset) continue;
    const i = world.idx(x, y + dy);
    if (world.cells[i] !== Cell.FLOOR) continue;
    world.cells[i] = Cell.WALL;
    world.roomMap[i] = -1;
    world.wallTex[i] = Tex.PANEL;
    world.features[i] = Feature.NONE;
  }
}

function connectRoomToCorridor(world: World, room: Room, x: number, y: number, state: DoorState, keyId = ''): void {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.DOOR;
  world.wallTex[idx] = state === DoorState.HERMETIC_OPEN || state === DoorState.HERMETIC_CLOSED ? Tex.HERMO_WALL : Tex.DOOR_WOOD;
  world.doors.set(idx, { idx, state, roomA: room.id, roomB: -1, keyId, timer: 0 });
  room.doors.push(idx);
}

function connectRoomToPoint(
  world: World,
  room: Room,
  doorX: number,
  doorY: number,
  targetX: number,
  targetY: number,
  state: DoorState,
  keyId = '',
): void {
  connectRoomToCorridor(world, room, doorX, doorY, state, keyId);
  const outX = doorX < room.x ? doorX - 1 : doorX >= room.x + room.w ? doorX + 1 : doorX;
  const outY = doorY < room.y ? doorY - 1 : doorY >= room.y + room.h ? doorY + 1 : doorY;
  carveLineWidth(world, outX, outY, targetX, targetY, 1, Tex.F_LINO);
}

function applyDormZones(world: World): void {
  for (const zone of world.zones) {
    zone.level = zone.cx > 650 || zone.cy > 575 ? 3 : 2;
    zone.faction = ZoneFaction.CITIZEN;
    if (zone.cx > 650) zone.faction = ZoneFaction.LIQUIDATOR;
    if (zone.cx < 430 && zone.cy > 470 && zone.cy < 535) zone.faction = ZoneFaction.WILD;
    if (zone.cy > 590 && zone.cx > 450 && zone.cx < 575) zone.faction = ZoneFaction.SAMOSBOR;
    zone.fogged = false;
  }
  for (let i = 0; i < world.factionControl.length; i++) {
    world.factionControl[i] = world.zones[world.zoneMap[i]]?.faction ?? ZoneFaction.CITIZEN;
  }
}

function reinforceDormAuthoredTerritory(world: World, rooms: DormRooms): void {
  for (const anchor of rooms.hqs) {
    paintDormRoomOwner(world, anchor.hq, anchor.owner);
    for (const room of anchor.support) paintDormRoomOwner(world, room, anchor.owner);
  }
}

function paintDormRoomOwner(world: World, room: Room, owner: ZoneFaction): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[idx] === room.id) world.factionControl[idx] = owner;
    }
  }
  for (const doorIdx of room.doors) world.factionControl[doorIdx] = owner;
}

function placeDormLifts(world: World, layout: DormLayout): void {
  placeLift(world, layout.leftX + 3, layout.northY + 1, layout.leftX + 7, layout.northY + 1, LiftDirection.UP);
  placeLift(world, layout.rightX - 3, layout.southY + 1, layout.rightX - 7, layout.southY + 1, LiftDirection.DOWN);
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

function decorateDorm(world: World, layout: DormLayout, rooms: DormRooms): void {
  for (const room of rooms.bunks) decorateBunkRoom(world, room);
  for (const room of rooms.support) decorateDormSupportRoom(world, room);
  for (const anchor of rooms.hqs) decorateDormHq(world, anchor.hq, anchor.owner);
  for (let x = layout.leftX + 16; x <= layout.rightX - 16; x += 42) {
    placeFeature(world, x, layout.northY + 1, Feature.LAMP);
    placeFeature(world, x + 10, layout.southY + 1, Feature.TABLE);
  }

  placeFeature(world, rooms.watch.x + 5, rooms.watch.y + 4, Feature.DESK);
  placeFeature(world, rooms.watch.x + 14, rooms.watch.y + 4, Feature.SCREEN);
  placeFeature(world, rooms.watch.x + 28, rooms.watch.y + 11, Feature.SHELF);
  placeFeature(world, rooms.watch.x + 20, rooms.watch.y + 12, Feature.CHAIR);

  for (let x = rooms.kitchen.x + 4; x < rooms.kitchen.x + rooms.kitchen.w - 3; x += 6) placeFeature(world, x, rooms.kitchen.y + 4, Feature.STOVE);
  placeFeature(world, rooms.kitchen.x + 5, rooms.kitchen.y + 16, Feature.SINK);
  placeFeature(world, rooms.kitchen.x + 17, rooms.kitchen.y + 14, Feature.TABLE);

  for (let y = rooms.lockers.y + 4; y < rooms.lockers.y + rooms.lockers.h - 3; y += 5) {
    placeFeature(world, rooms.lockers.x + 5, y, Feature.SHELF);
    placeFeature(world, rooms.lockers.x + 21, y, Feature.SHELF);
  }

  for (let x = rooms.wash.x + 4; x < rooms.wash.x + rooms.wash.w - 3; x += 6) placeFeature(world, x, rooms.wash.y + 4, Feature.SINK);
  for (let x = rooms.wash.x + 5; x < rooms.wash.x + rooms.wash.w - 3; x += 7) placeFeature(world, x, rooms.wash.y + 17, Feature.TOILET);

  for (let x = rooms.shelter.x + 8; x < rooms.shelter.x + rooms.shelter.w - 8; x += 16) {
    placeFeature(world, x, rooms.shelter.y + 7, Feature.CANDLE);
    placeFeature(world, x + 5, rooms.shelter.y + 14, Feature.BED);
  }

  placeFeature(world, rooms.smoking.x + 5, rooms.smoking.y + 5, Feature.TABLE);
  placeFeature(world, rooms.smoking.x + 13, rooms.smoking.y + 8, Feature.CHAIR);
  placeFeature(world, rooms.smoking.x + 24, rooms.smoking.y + 11, Feature.SHELF);
}

function decorateDormSupportRoom(world: World, room: Room): void {
  switch (room.type) {
    case RoomType.KITCHEN:
      for (let x = room.x + 3; x < room.x + room.w - 3; x += 6) placeFeature(world, x, room.y + 3, Feature.STOVE);
      placeFeature(world, room.x + 3, room.y + room.h - 4, Feature.SINK);
      placeFeature(world, room.x + room.w - 5, room.y + room.h - 4, Feature.TABLE);
      return;
    case RoomType.BATHROOM:
      for (let x = room.x + 3; x < room.x + room.w - 3; x += 5) {
        placeFeature(world, x, room.y + 3, Feature.SINK);
        placeFeature(world, x + 1, room.y + room.h - 4, Feature.TOILET);
      }
      return;
    case RoomType.MEDICAL:
      placeFeature(world, room.x + 4, room.y + 3, Feature.APPARATUS);
      placeFeature(world, room.x + 10, room.y + 3, Feature.DESK);
      placeFeature(world, room.x + room.w - 5, room.y + room.h - 4, Feature.SHELF);
      return;
    case RoomType.STORAGE:
      for (let x = room.x + 3; x < room.x + room.w - 3; x += 5) {
        placeFeature(world, x, room.y + 3, Feature.SHELF);
        placeFeature(world, x, room.y + room.h - 4, Feature.SHELF);
      }
      return;
    case RoomType.SMOKING:
      placeFeature(world, room.x + 4, room.y + 4, Feature.TABLE);
      placeFeature(world, room.x + 8, room.y + 4, Feature.CHAIR);
      placeFeature(world, room.x + room.w - 5, room.y + room.h - 4, Feature.CANDLE);
      return;
    case RoomType.OFFICE:
      placeFeature(world, room.x + 4, room.y + 3, Feature.DESK);
      placeFeature(world, room.x + 10, room.y + 3, Feature.SCREEN);
      placeFeature(world, room.x + room.w - 5, room.y + room.h - 4, Feature.SHELF);
      return;
    case RoomType.COMMON:
      placeFeature(world, room.x + 4, room.y + 4, Feature.TABLE);
      placeFeature(world, room.x + 9, room.y + 4, Feature.CHAIR);
      placeFeature(world, room.x + room.w - 5, room.y + room.h - 4, Feature.LAMP);
      return;
    default:
      return;
  }
}

function decorateDormHq(world: World, room: Room, owner: ZoneFaction): void {
  placeFeature(world, room.x + 4, room.y + 4, owner === ZoneFaction.SCIENTIST ? Feature.APPARATUS : Feature.DESK);
  placeFeature(world, room.x + 11, room.y + 4, owner === ZoneFaction.CULTIST ? Feature.CANDLE : Feature.SCREEN);
  placeFeature(world, room.x + room.w - 6, room.y + 5, Feature.SHELF);
  placeFeature(world, room.x + 5, room.y + room.h - 5, Feature.TABLE);
  placeFeature(world, room.x + 11, room.y + room.h - 5, Feature.CHAIR);
  if (owner === ZoneFaction.CITIZEN || owner === ZoneFaction.WILD) placeFeature(world, room.x + room.w - 12, room.y + room.h - 5, Feature.BED);
}

function decorateBunkRoom(world: World, room: Room): void {
  for (let x = room.x + 3; x < room.x + room.w - 3; x += 8) {
    placeFeature(world, x, room.y + 3, Feature.BED);
    placeFeature(world, x, room.y + 8, Feature.BED);
  }
  placeFeature(world, room.x + room.w - 4, room.y + 5, Feature.SHELF);
  placeFeature(world, room.x + 4, room.y + 5, Feature.TABLE);
}

function placeFeature(world: World, x: number, y: number, feature: Feature): void {
  const i = world.idx(x, y);
  if (world.cells[i] === Cell.FLOOR || world.cells[i] === Cell.WATER) world.features[i] = feature;
}

function spawnAuthoredDormNpcs(entities: Entity[], nextId: { v: number }, rooms: DormRooms): Record<keyof typeof NPC_IDS, number> {
  return {
    rita: spawnNpc(entities, nextId, NPC_DEFS.obschezhitie_rita_starshaya, NPC_IDS.rita, rooms.shelter.x + 9, rooms.shelter.y + 10),
    gleb: spawnNpc(entities, nextId, NPC_DEFS.obschezhitie_gleb_obhod, NPC_IDS.gleb, rooms.watch.x + 18, rooms.watch.y + 8, 'rubber_club'),
    senya: spawnNpc(entities, nextId, NPC_DEFS.obschezhitie_senya_tikhiy, NPC_IDS.senya, rooms.smoking.x + 8, rooms.smoking.y + 8, 'knife'),
  };
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
    canGiveQuest: true,
    weapon,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
  });
  return npc.id;
}

function spawnSleeperTemplates(entities: Entity[], nextId: { v: number }, bunks: readonly Room[]): void {
  for (let i = 0; i < Math.min(SLEEPER_TEMPLATE_COUNT, bunks.length * 3); i++) {
    const room = bunks[i % bunks.length];
    const x = room.x + 3 + (i % 3) * 7;
    const y = room.y + (i % 2 === 0 ? 3 : 8);
    const needs = freshNeeds();
    needs.sleep = 4 + (i % 7);
    entities.push({
      id: nextId.v++,
      type: EntityType.NPC,
      x: x + 0.5,
      y: y + 0.5,
      angle: Math.PI * (i % 2),
      pitch: 0,
      alive: true,
      speed: 0.62,
      sprite: i % 5 === 0 ? Occupation.MECHANIC : i % 4 === 0 ? Occupation.COOK : Occupation.TURNER,
      name: `Спящий сменщик ${i + 1}`,
      needs,
      hp: 78,
      maxHp: 78,
      money: 2 + (i % 9),
      ai: { goal: AIGoal.SLEEP, tx: x + 0.5, ty: y + 0.5, path: [], pi: 0, stuck: 0, timer: 16 + i, npcState: NpcState.SLEEPING },
      inventory: [{ defId: i % 3 === 0 ? 'bread' : i % 3 === 1 ? 'cigs' : 'water_coupon', count: 1 }],
      faction: Faction.CITIZEN,
      occupation: i % 5 === 0 ? Occupation.MECHANIC : i % 4 === 0 ? Occupation.COOK : Occupation.TURNER,
      assignedRoomId: room.id,
      questId: -1,
    });
  }
}

function spawnNightPatrolTemplates(entities: Entity[], nextId: { v: number }, layout: DormLayout): void {
  for (let i = 0; i < PATROL_TEMPLATE_COUNT; i++) {
    const west = i % 2 === 0;
    const x = west ? layout.leftX + 34 + i * 9 : layout.rightX - 34 - i * 9;
    const y = i < 4 ? layout.northY + 1 : layout.southY + 1;
    entities.push({
      id: nextId.v++,
      type: EntityType.NPC,
      x: x + 0.5,
      y: y + 0.5,
      angle: west ? 0 : Math.PI,
      pitch: 0,
      alive: true,
      speed: 0.86,
      sprite: i % 3 === 0 ? Occupation.HUNTER : Occupation.LOCKSMITH,
      name: `Дежурный тихого обхода ${i + 1}`,
      needs: freshNeeds(),
      hp: 92,
      maxHp: 92,
      money: 8 + i,
      ai: { goal: AIGoal.WANDER, tx: x + (west ? 24 : -24), ty: y, path: [], pi: 0, stuck: 0, timer: i * 2, npcState: NpcState.PATROL },
      inventory: [{ defId: i % 2 === 0 ? 'cigs' : 'note', count: 1 }],
      weapon: i % 3 === 0 ? 'rubber_club' : undefined,
      faction: i % 3 === 0 ? Faction.LIQUIDATOR : Faction.CITIZEN,
      occupation: i % 3 === 0 ? Occupation.HUNTER : Occupation.LOCKSMITH,
      questId: -1,
    });
  }
}

function placeDormContainers(
  world: World,
  containerId: { v: number },
  rooms: DormRooms,
  owners: Record<keyof typeof NPC_IDS, number>,
): void {
  addContainer(world, containerId, rooms.watch, 30, 5, ContainerKind.FILING_CABINET, 'Журнал ночного обхода', [
    { defId: 'samosbor_tally', count: 1 },
    { defId: 'neighbor_complaint', count: 2 },
    { defId: 'cigs', count: 1 },
  ], 'owner', owners.gleb, NPC_DEFS.obschezhitie_gleb_obhod.name, ['patrol', 'witness', 'quiet_passage', 'paper']);

  addContainer(world, containerId, rooms.shelter, 10, 15, ContainerKind.EMERGENCY_BOX, 'Общий ящик у гермодвери', [
    { defId: 'bread', count: 4 },
    { defId: 'water', count: 3 },
    { defId: 'bandage', count: 2 },
    { defId: 'shelter_tally', count: 1 },
  ], 'public', undefined, undefined, ['shelter', 'samosbor', 'resident_relief', 'legal_supply']);

  addContainer(world, containerId, rooms.shelter, 101, 15, ContainerKind.FILING_CABINET, 'Ритина ведомость койко-мест', [
    { defId: 'shelter_tally', count: 1 },
    { defId: 'ration_registry_extract', count: 1 },
    { defId: 'water_coupon', count: 2 },
  ], 'owner', owners.rita, NPC_DEFS.obschezhitie_rita_starshaya.name, ['shelter', 'rollcall', 'paper', 'witness']);

  addContainer(world, containerId, rooms.lockers, 6, 8, ContainerKind.METAL_CABINET, 'Скрипучий шкаф первой бригады', [
    { defId: 'sleeping_pills', count: 1 },
    { defId: 'cigs', count: 3 },
    { defId: 'container_key_label', count: 1 },
  ], 'owner', undefined, 'первая спящая бригада', ['theft', 'quiet_loot', 'shift_locker', 'witness'], 3);

  addContainer(world, containerId, rooms.lockers, 22, 18, ContainerKind.METAL_CABINET, 'Шкаф с сухими робами', [
    { defId: 'cloth_roll', count: 2 },
    { defId: 'cleaning_kit', count: 1 },
    { defId: 'water_coupon', count: 1 },
  ], 'owner', undefined, 'вторая спящая бригада', ['theft', 'quiet_loot', 'shift_locker'], 3);

  addContainer(world, containerId, rooms.kitchen, 20, 16, ContainerKind.FRIDGE, 'Холодильник сменной каши', [
    { defId: 'kasha', count: 4 },
    { defId: 'bread', count: 3 },
    { defId: 'tea', count: 2 },
  ], 'room', undefined, undefined, ['kitchen', 'shared', 'resident_relief']);

  addContainer(world, containerId, rooms.smoking, 25, 12, ContainerKind.SECRET_STASH, 'Тихая банка за батареей', [
    { defId: 'container_key_label', count: 1 },
    { defId: 'cigs', count: 2 },
    { defId: 'neighbor_complaint', count: 1 },
  ], 'secret', undefined, undefined, ['secret', 'quiet_loot', 'rumor', 'witness']);

  for (let i = 0; i < rooms.bunks.length; i += 3) {
    const room = rooms.bunks[i];
    addContainer(world, containerId, room, 17, 6, i % 2 === 0 ? ContainerKind.WOODEN_CHEST : ContainerKind.METAL_CABINET, `${room.name}: тумба у койки`, [
      { defId: i % 2 === 0 ? 'bread' : 'water_coupon', count: 1 },
      { defId: i % 4 === 0 ? 'cigs' : 'note', count: 1 },
    ], 'owner', undefined, 'спящий сменщик', ['theft', 'sleeping_group', 'quiet_loot']);
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
  lockDifficulty?: number,
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
    lockDifficulty,
    discovered: access !== 'secret',
    tags: [OBSCHEZHITIE_SMENY_DESIGN_FLOOR_ID, ...tags],
  };
  if (tags.includes('shift_locker')) container.stolenItemIds = ['bread'];
  world.addContainer(container);
  placeFeature(world, x, y, kind === ContainerKind.FRIDGE ? Feature.SINK : Feature.SHELF);
}
