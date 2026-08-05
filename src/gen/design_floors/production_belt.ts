import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal,
  Cell,
  ContainerKind,
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
  type GameState,
  type Room,
  type TerritoryOwner,
  type WorldEvent,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { ITEMS } from '../../data/catalog';
import { HUMAN_TERRITORY_OWNERS, factionToTerritoryOwner } from '../../data/factions';
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { Spr } from '../../render/sprite_index';
import { registerCellHazardSite } from '../../systems/cell_hazards';
import { publishEvent } from '../../systems/events';
import { registerRouteCue } from '../../systems/route_cues';
import { randomRPG } from '../../systems/rpg';
import {
  ensureConnectivity,
  generateZones,
  placeDoor,
  sanitizeDoors,
  stampRoom,
} from '../shared';
import type { FloorGeneration } from '../floor_manifest';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('production_belt');

export const DESIGN_FLOOR_ID = 'production_belt' as const;
export const PRODUCTION_BELT_ROUTE_Z = -14;
export const PRODUCTION_BELT_BASE_FLOOR = FloorLevel.MAINTENANCE;

const CONTENT_TAG = 'floor14_production_belt';

export interface ProductionBeltLineDef {
  id: string;
  factoryId: string;
  roomName: string;
  outputTags: readonly string[];
  state: 'repairable' | 'audited' | 'bad_batch';
}

export type ProductionBeltDecisionId =
  | 'repair_metal_line'
  | 'transfer_charge_cells'
  | 'expose_bad_batch'
  | 'steal_bad_batch';

export interface ProductionBeltPipelineDependency {
  id: string;
  fromRouteId: typeof DESIGN_FLOOR_ID;
  toRouteId: 'service_floor' | 'black_market_88' | 'floor_69' | 'living';
  factoryId: string;
  outputTag: string;
  decisionId: ProductionBeltDecisionId;
  clue: string;
}

export interface ProductionBeltLineState {
  id: string;
  factoryId: string;
  roomId: number;
  outputContainerId: number;
  state: ProductionBeltLineDef['state'];
  dependencyIds: string[];
}

export interface ProductionBeltRouteState {
  routeId: typeof DESIGN_FLOOR_ID;
  anchorZ: typeof PRODUCTION_BELT_ROUTE_Z;
  baseFloor: typeof PRODUCTION_BELT_BASE_FLOOR;
  lines: ProductionBeltLineState[];
  dependencies: ProductionBeltPipelineDependency[];
  cueIds: string[];
}

export interface ProductionBeltGeneration extends FloorGeneration {
  productionState: ProductionBeltRouteState;
}

export const PRODUCTION_BELT_FACTORY_LINES: readonly ProductionBeltLineDef[] = [
  {
    id: 'prod_restore_line',
    factoryId: 'metal_shop',
    roomName: 'Цех металла: линия восстановления',
    outputTags: ['tools', 'faction'],
    state: 'repairable',
  },
  {
    id: 'prod_charge_line',
    factoryId: 'utility_room',
    roomName: 'Диспетчерская зарядки: линия ячеек',
    outputTags: ['utility', 'room'],
    state: 'audited',
  },
  {
    id: 'prod_illegal_ammo',
    factoryId: 'illegal_ammo_smelter',
    roomName: 'Патронная плавильня: нелегальная смена',
    outputTags: ['ammo', 'weapon', 'illegal'],
    state: 'bad_batch',
  },
];

export const PRODUCTION_BELT_PIPELINE_DEPENDENCIES: readonly ProductionBeltPipelineDependency[] = [
  {
    id: 'prod_to_service_door_kits',
    fromRouteId: DESIGN_FLOOR_ID,
    toRouteId: 'service_floor',
    factoryId: 'metal_shop',
    outputTag: 'tools',
    decisionId: 'repair_metal_line',
    clue: 'Дверь-комплекты с восстановительной линии питают машинный зал С-15.',
  },
  {
    id: 'prod_charge_to_service_power',
    fromRouteId: DESIGN_FLOOR_ID,
    toRouteId: 'service_floor',
    factoryId: 'utility_room',
    outputTag: 'utility',
    decisionId: 'transfer_charge_cells',
    clue: 'Энергоячейка из зарядки может уйти в обход Служебного этажа или в карман Егора.',
  },
  {
    id: 'prod_bad_batch_to_market',
    fromRouteId: DESIGN_FLOOR_ID,
    toRouteId: 'black_market_88',
    factoryId: 'illegal_ammo_smelter',
    outputTag: 'illegal',
    decisionId: 'steal_bad_batch',
    clue: 'Зеленая партия стоит денег на рынке, но дает поздний слух о браке.',
  },
  {
    id: 'prod_bad_batch_to_living_warning',
    fromRouteId: DESIGN_FLOOR_ID,
    toRouteId: 'living',
    factoryId: 'illegal_ammo_smelter',
    outputTag: 'bad_batch',
    decisionId: 'expose_bad_batch',
    clue: 'Акт БОТ-14 останавливает зеленую партию до Жилой зоны, если сдать образцы аудитору.',
  },
];

export const PRODUCTION_BELT_DEBUG_ENTRY = {
  routeId: DESIGN_FLOOR_ID,
  z: PRODUCTION_BELT_ROUTE_Z,
  baseFloor: PRODUCTION_BELT_BASE_FLOOR,
  spawnHint: 'Проходная смены 14',
} as const;

const FOREMAN_DEF: PlotNpcDef = {
  name: 'Галина Нормировщица',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.DIRECTOR,
  sprite: Occupation.DIRECTOR,
  hp: 165,
  maxHp: 165,
  money: 120,
  speed: 0.95,
  inventory: [
    { defId: 'ration_stamp_pad', count: 1 },
    { defId: 'water', count: 1 },
    { defId: 'bread', count: 1 },
  ],
  talkLines: [
    'Галина Нормировщица. Тут не завод, а ремень дома: остановится - наверху начнут грызть ведомость.',
    'Работа простая: держишь линию, не суешь руку в пресс, не называешь брак браком при аудиторе.',
    'Мастер не кричит на станок. Мастер кричит на людей, которые еще могут отойти.',
    'Егор застрял между зарядкой и браком. Проведи его к проходной, пока роботы считают людей тарой.',
  ],
  talkLinesPost: [
    'Смена идет. Не идеально, но идеально тут выглядит только недостача.',
    'Выходные ящики под отчетом. Работай легально или воруй быстро.',
    'Грузчиков не вижу, но ящики двигаются. Это хуже опоздания.',
  ],
};

const MECHANIC_DEF: PlotNpcDef = {
  name: 'Рустам Обводной',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.MECHANIC,
  sprite: Occupation.MECHANIC,
  hp: 145,
  maxHp: 145,
  money: 80,
  speed: 1.0,
  inventory: [
    { defId: 'wrench', count: 1 },
    { defId: 'fuse', count: 2 },
    { defId: 'relay_diagram', count: 1 },
  ],
  talkLines: [
    'Рустам Обводной. Линию можно чинить, можно молиться на нее, можно воровать из нее. Первое дешевле.',
    'Две шестерни на восстановительный вал - и я сниму защиту с выходного шкафа по акту.',
    'Если слышишь писк зарядки, не беги на звук. Звук обычно уже бежит на тебя.',
    'Новый парень спросил про кнопку стоп. Я показал, где лежит журнал травм.',
  ],
  talkLinesPost: [
    'Вал держит. Теперь очередь наверху будет ругаться с полным ртом.',
    'Не трогай зеленую партию голыми руками. Она спорит с кожей.',
    'Если линия снова пойдет рывком, я ее не чиню - я ее уговариваю до отбоя.',
  ],
};

const WORKER_DEF: PlotNpcDef = {
  name: 'Егор Сменный',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.TURNER,
  sprite: Occupation.TURNER,
  hp: 115,
  maxHp: 115,
  money: 35,
  speed: 1.05,
  inventory: [
    { defId: 'metal_sheet', count: 1 },
    { defId: 'grey_briquette', count: 1 },
  ],
  talkLines: [
    'Егор Сменный. Квота опасная: зарядку гонят горячей, брак называют пайком, а нас - расходом.',
    'Укради энергоячейку из выходного шкафа. Без нее зарядка встанет на ревизию, а люди успеют уйти.',
    'Я новый только по списку. По рукаву уже старый: локоть протерт до серой нитки.',
    'Если Галина спросит, я шел не саботировать. Я шел жить.',
  ],
  talkLinesPost: [
    'Смена притормозила. Иногда саботаж - это просто тормоз, которого не дали инженеру.',
    'Не ешь зеленое из карантина. Даже если оно подписано как еда.',
    'Душевые пустые, а вода идет. Кто-то еще числится на линии без тела у проходной.',
  ],
};

const AUDITOR_DEF: PlotNpcDef = {
  name: 'Аудитор-БОТ 14',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 220,
  maxHp: 220,
  money: 160,
  speed: 0.8,
  inventory: [
    { defId: 'clean_health_cert', count: 1 },
    { defId: 'container_key_label', count: 1 },
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 8 },
  ],
  talkLines: [
    'Аудитор-БОТ 14. Партия хорошая, если акт говорит хорошая. Акт хороший, если партия молчит.',
    'Две зеленые единицы из карантина докажут брак. Или докажут вашу кражу. Формально это разные графы.',
    'Свидетелей рядом не требуется. Ревизия рядом всегда.',
    'Контролер качества не нюхает страх. Только партию, фильтр и подпись мастера.',
  ],
  talkLinesPost: [
    'Брак записан. Теперь виновный будет найден из числа тех, кто еще не убежал.',
    'Справка чистая. Не значит, что чисты вы.',
    'План сохранен с пометкой о человеческом факторе. Человеческий фактор пока не сохранен.',
  ],
};

let contentRegistered = false;

export function registerProductionBeltContent(): void {
  if (contentRegistered) return;
  contentRegistered = true;

  registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'prod_foreman_galina', FOREMAN_DEF, [{
    id: 'prod_worker_escort',
    giverNpcId: 'prod_foreman_galina',
    type: QuestType.TALK,
    desc: 'Галина: «Найди Егора {dir} и доведи до проходной хотя бы словами. Если он пропадет, смену закроют вместе с людьми.»',
    targetNpcId: 'prod_worker_egor',
    rewardItem: 'water',
    rewardCount: 2,
    extraRewards: [{ defId: 'bread', count: 2 }],
    relationDelta: 10,
    xpReward: 50,
    moneyReward: 45,
  }]);

  registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'prod_mechanic_rustam', MECHANIC_DEF, [{
    id: 'prod_restore_line',
    giverNpcId: 'prod_mechanic_rustam',
    type: QuestType.FETCH,
    desc: 'Рустам: «Две шестерни в восстановительный вал. Линия снова даст комплект, а не искры.»',
    targetItem: 'gear',
    targetCount: 2,
    rewardItem: 'door_kit',
    rewardCount: 1,
    extraRewards: [{ defId: 'wrench', count: 1 }],
    relationDelta: 14,
    xpReward: 70,
    moneyReward: 70,
  }]);

  registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'prod_worker_egor', WORKER_DEF, [{
    id: 'prod_steal_crate',
    giverNpcId: 'prod_worker_egor',
    type: QuestType.FETCH,
    desc: 'Егор: «Вытащи энергоячейку из выходного шкафа зарядки. Без нее опасную смену остановит ревизия, а не похороны.»',
    targetItem: 'ammo_energy',
    targetCount: 1,
    rewardItem: 'fake_pass',
    rewardCount: 1,
    extraRewards: [{ defId: 'ammo_9mm', count: 10 }],
    relationDelta: 6,
    xpReward: 60,
    moneyReward: 55,
  }]);

  registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'prod_auditor_bot', AUDITOR_DEF, [{
    id: 'prod_bad_batch',
    giverNpcId: 'prod_auditor_bot',
    type: QuestType.FETCH,
    desc: 'Аудитор-БОТ 14: «Две зеленые единицы из карантина. Выдать наверх или списать - решит акт, не желудок.»',
    targetItem: 'green_briquette',
    targetCount: 2,
    rewardItem: 'clean_health_cert',
    rewardCount: 1,
    extraRewards: [{ defId: 'container_key_label', count: 1 }],
    relationDelta: 8,
    xpReward: 65,
    moneyReward: 90,
  }]);
}

registerProductionBeltContent();

interface ProductionBeltRooms {
  gate: Room;
  corridor: Room;
  foreman: Room;
  lockers: Room;
  metalLine: Room;
  loadingDock: Room;
  shelter: Room;
  chargeLine: Room;
  ammoLine: Room;
  quarantine: Room;
  auditOffice: Room;
  exitDock: Room;
}

interface ProductionBeltContainers {
  metalOutput: WorldContainer;
  chargeOutput: WorldContainer;
  ammoOutput: WorldContainer;
  p41Mount: WorldContainer;
  g41Mount: WorldContainer;
  zhernovMachine: WorldContainer;
  quarantine: WorldContainer;
  lockers: WorldContainer;
  loading: WorldContainer;
}

function paintRoom(world: World, room: Room, wallTex: Tex, floorTex: Tex): void {
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const i = world.idx(room.x + dx, room.y + dy);
      if (world.cells[i] === Cell.WALL) world.wallTex[i] = wallTex;
    }
  }
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      world.floorTex[world.idx(room.x + dx, room.y + dy)] = floorTex;
    }
  }
}

function namedRoom(
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
  const room = stampRoom(world, world.rooms.length, type, x, y, w, h, -1);
  room.name = name;
  paintRoom(world, room, wallTex, floorTex);
  return room;
}

function buildRooms(world: World): ProductionBeltRooms {
  const corridor = namedRoom(world, RoomType.CORRIDOR, 430, 508, 138, 7, 'Транспортный коридор ленты 14', Tex.METAL, Tex.F_CONCRETE);
  const gate = namedRoom(world, RoomType.COMMON, 414, 508, 15, 7, 'Проходная смены 14', Tex.PANEL, Tex.F_LINO);
  const foreman = namedRoom(world, RoomType.OFFICE, 442, 496, 17, 11, 'Контора нормировщика', Tex.PANEL, Tex.F_LINO);
  const lockers = namedRoom(world, RoomType.STORAGE, 462, 496, 15, 11, 'Шкафчики ремонтной смены', Tex.METAL, Tex.F_CONCRETE);
  const metalLine = namedRoom(world, RoomType.PRODUCTION, 480, 490, 30, 17, PRODUCTION_BELT_FACTORY_LINES[0].roomName, Tex.PIPE, Tex.F_CONCRETE);
  const loadingDock = namedRoom(world, RoomType.STORAGE, 514, 496, 22, 11, 'Погрузочная рампа выхода', Tex.METAL, Tex.F_CONCRETE);
  const shelter = namedRoom(world, RoomType.COMMON, 540, 496, 19, 11, 'Комната ожидания смены', Tex.CONCRETE, Tex.F_LINO);
  const chargeLine = namedRoom(world, RoomType.PRODUCTION, 442, 516, 28, 14, PRODUCTION_BELT_FACTORY_LINES[1].roomName, Tex.PIPE, Tex.F_CONCRETE);
  const ammoLine = namedRoom(world, RoomType.PRODUCTION, 474, 516, 26, 14, PRODUCTION_BELT_FACTORY_LINES[2].roomName, Tex.METAL, Tex.F_CONCRETE);
  const quarantine = namedRoom(world, RoomType.STORAGE, 504, 516, 23, 12, 'Карантин брака: зеленая партия', Tex.ROTTEN, Tex.F_WATER);
  const auditOffice = namedRoom(world, RoomType.OFFICE, 531, 516, 18, 12, 'Пост аудита БОТ-14', Tex.MARBLE, Tex.F_TILE);
  const exitDock = namedRoom(world, RoomType.STORAGE, 569, 508, 17, 7, 'Выходной док подъемников', Tex.METAL, Tex.F_CONCRETE);

  for (const room of [gate, foreman, lockers, metalLine, loadingDock, shelter, chargeLine, ammoLine, quarantine, auditOffice, exitDock]) {
    placeDoor(world, room, corridor, '', false);
  }
  return {
    gate,
    corridor,
    foreman,
    lockers,
    metalLine,
    loadingDock,
    shelter,
    chargeLine,
    ammoLine,
    quarantine,
    auditOffice,
    exitDock,
  };
}

function placeLift(world: World, liftX: number, liftY: number, buttonX: number, buttonY: number, direction: LiftDirection): void {
  const li = world.idx(liftX, liftY);
  world.cells[li] = Cell.LIFT;
  world.wallTex[li] = Tex.LIFT_DOOR;
  world.liftDir[li] = direction;
  const bi = world.idx(buttonX, buttonY);
  if (world.cells[bi] === Cell.FLOOR) {
    world.features[bi] = Feature.LIFT_BUTTON;
    world.liftDir[bi] = direction;
  }
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const i = world.idx(x, y);
  if (world.cells[i] === Cell.FLOOR || world.cells[i] === Cell.WATER) world.features[i] = feature;
}

function setHazardWater(world: World, x: number, y: number, fog = 120): void {
  const i = world.idx(x, y);
  if (world.cells[i] !== Cell.FLOOR) return;
  world.cells[i] = Cell.WATER;
  world.floorTex[i] = Tex.F_WATER;
  world.fog[i] = fog;
}

function productionProtectedMask(world: World): Uint8Array {
  const mask = new Uint8Array(W * W);
  for (const room of world.rooms) {
    for (let dy = 0; dy < room.h; dy++) {
      for (let dx = 0; dx < room.w; dx++) {
        mask[world.idx(room.x + dx, room.y + dy)] = 1;
      }
    }
  }
  for (const container of world.containers) mask[world.idx(container.x, container.y)] = 1;
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.LIFT || world.features[i] === Feature.LIFT_BUTTON) mask[i] = 1;
  }
  return mask;
}

function rectTouchesMask(world: World, mask: Uint8Array, x: number, y: number, w: number, h: number, margin: number): boolean {
  for (let dy = -margin; dy < h + margin; dy++) {
    for (let dx = -margin; dx < w + margin; dx++) {
      if (mask[world.idx(x + dx, y + dy)]) return true;
    }
  }
  return false;
}

function carveRectMasked(
  world: World,
  mask: Uint8Array,
  x: number,
  y: number,
  w: number,
  h: number,
  roomId: number,
  floorTex: Tex,
): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const i = world.idx(x + dx, y + dy);
      if (mask[i]) continue;
      world.cells[i] = Cell.FLOOR;
      world.roomMap[i] = roomId;
      world.floorTex[i] = floorTex;
    }
  }
}

function wallRingMasked(world: World, mask: Uint8Array, x: number, y: number, w: number, h: number, wallTex: Tex): void {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      if (dx >= 0 && dx < w && dy >= 0 && dy < h) continue;
      const i = world.idx(x + dx, y + dy);
      if (mask[i]) continue;
      if (world.cells[i] === Cell.WALL || world.cells[i] === Cell.ABYSS) {
        world.cells[i] = Cell.WALL;
        world.wallTex[i] = wallTex;
        world.features[i] = Feature.NONE;
      }
    }
  }
}

function macroRoom(
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
  margin = 2,
): Room | null {
  if (rectTouchesMask(world, mask, x, y, w, h, margin)) return null;
  const room: Room = {
    id: world.rooms.length,
    type,
    x: world.wrap(x),
    y: world.wrap(y),
    w,
    h,
    doors: [],
    sealed: false,
    name,
    apartmentId: -1,
    wallTex,
    floorTex,
  };
  world.rooms.push(room);
  carveRectMasked(world, mask, room.x, room.y, w, h, room.id, floorTex);
  wallRingMasked(world, mask, room.x, room.y, w, h, wallTex);
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      mask[world.idx(room.x + dx, room.y + dy)] = 1;
    }
  }
  return room;
}

function macroCorridor(
  world: World,
  mask: Uint8Array,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  floorTex: Tex,
): Room {
  const room: Room = {
    id: world.rooms.length,
    type: RoomType.CORRIDOR,
    x: world.wrap(x),
    y: world.wrap(y),
    w,
    h,
    doors: [],
    sealed: false,
    name,
    apartmentId: -1,
    wallTex: Tex.METAL,
    floorTex,
  };
  world.rooms.push(room);
  carveRectMasked(world, mask, room.x, room.y, w, h, room.id, floorTex);
  wallRingMasked(world, mask, room.x, room.y, w, h, Tex.METAL);
  return room;
}

function connectRoomToLane(world: World, mask: Uint8Array, room: Room, laneY: number, floorTex: Tex): void {
  const cx = room.x + (room.w >> 1);
  if (room.y > laneY) {
    const y = laneY + 5;
    carveRectMasked(world, mask, cx - 1, y, 3, Math.max(1, room.y - y), -1, floorTex);
  } else {
    const y = room.y + room.h;
    carveRectMasked(world, mask, cx - 1, y, 3, Math.max(1, laneY - 4 - y), -1, floorTex);
  }
}

function placeWallBlock(world: World, mask: Uint8Array, x: number, y: number, w: number, h: number, wallTex: Tex): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const i = world.idx(x + dx, y + dy);
      if (mask[i] || world.cells[i] !== Cell.FLOOR) continue;
      world.cells[i] = Cell.WALL;
      world.roomMap[i] = -1;
      world.wallTex[i] = wallTex;
      world.features[i] = Feature.NONE;
    }
  }
}

function dressMachineIsland(world: World, room: Room, rng: () => number): void {
  for (let x = room.x + 3; x < room.x + room.w - 3; x += 5) {
    setFeature(world, x, room.y + 4, Feature.MACHINE);
    setFeature(world, x + 1, room.y + room.h - 5, Feature.APPARATUS);
  }
  setFeature(world, room.x + 3, room.y + room.h - 3, Feature.LAMP);
  setFeature(world, room.x + room.w - 4, room.y + 3, Feature.LAMP);
  if (rng() < 0.55) {
    stampSurfaceSplat(world, room.x + (room.w >> 1), room.y + (room.h >> 1), 0.5, 0.5, 4 + rng() * 4, 0.16, room.id * 8191, 42, 46, 42, false);
  }
}

function dressStorageBay(world: World, room: Room, rng: () => number): void {
  for (let x = room.x + 2; x < room.x + room.w - 2; x += 4) setFeature(world, x, room.y + 2, Feature.SHELF);
  for (let y = room.y + 5; y < room.y + room.h - 2; y += 4) setFeature(world, room.x + room.w - 3, y, Feature.SHELF);
  setFeature(world, room.x + 3, room.y + room.h - 3, Feature.LAMP);
  if (rng() < 0.35) setFeature(world, room.x + (room.w >> 1), room.y + (room.h >> 1), Feature.TABLE);
}

function dressLoadingDock(world: World, room: Room): void {
  for (let x = room.x + 3; x < room.x + room.w - 3; x += 5) setFeature(world, x, room.y + room.h - 4, Feature.SHELF);
  setFeature(world, room.x + 4, room.y + 4, Feature.DESK);
  setFeature(world, room.x + room.w - 5, room.y + 4, Feature.LAMP);
}

function dressShiftGate(world: World, room: Room): void {
  setFeature(world, room.x + 2, room.y + 2, Feature.SCREEN);
  setFeature(world, room.x + room.w - 3, room.y + 2, Feature.DESK);
  setFeature(world, room.x + 2, room.y + room.h - 3, Feature.LAMP);
}

function dressScrapPocket(world: World, room: Room, rng: () => number): void {
  setFeature(world, room.x + 3, room.y + 3, Feature.SHELF);
  setFeature(world, room.x + room.w - 4, room.y + 3, Feature.MACHINE);
  for (let i = 0; i < 3; i++) {
    setHazardWater(world, room.x + 4 + Math.floor(rng() * Math.max(1, room.w - 8)), room.y + 5 + Math.floor(rng() * Math.max(1, room.h - 8)), 135);
  }
}

function addDockLoop(world: World, mask: Uint8Array, x: number, y: number, w: number, h: number, name: string): void {
  macroCorridor(world, mask, x, y, w, 5, `${name}: верхняя рампа`, Tex.F_CONCRETE);
  macroCorridor(world, mask, x, y + h - 5, w, 5, `${name}: нижняя рампа`, Tex.F_CONCRETE);
  macroCorridor(world, mask, x, y, 5, h, `${name}: левый разворот`, Tex.F_CONCRETE);
  macroCorridor(world, mask, x + w - 5, y, 5, h, `${name}: правый разворот`, Tex.F_CONCRETE);
}

function addLaneBlockages(world: World, mask: Uint8Array, laneY: number, xStart: number, xEnd: number, rng: () => number): void {
  for (let x = xStart + 46; x < xEnd - 24; x += 82) {
    if (x > 368 && x < 642 && laneY > 470 && laneY < 552) continue;
    if (rng() < 0.55) placeWallBlock(world, mask, x, laneY - 1, 4, 3, Tex.METAL);
    setFeature(world, x + 7, laneY - 3, Feature.MACHINE);
    setFeature(world, x + 9, laneY + 3, Feature.APPARATUS);
  }
}

function addSideRoomsForLane(world: World, mask: Uint8Array, laneY: number, row: number, rng: () => number): void {
  const xs = [108, 210, 312, 608, 710, 812];
  for (let n = 0; n < xs.length; n++) {
    const top = (row + n) % 2 === 0;
    const w = 22 + Math.floor(rng() * 12);
    const h = 13 + Math.floor(rng() * 8);
    const x = xs[n] + Math.floor(rng() * 18);
    const y = top ? laneY - h - 15 : laneY + 14;
    const motif = (row + n) % 4;
    const room = macroRoom(
      world,
      mask,
      motif === 0 ? RoomType.PRODUCTION : motif === 1 ? RoomType.STORAGE : motif === 2 ? RoomType.HQ : RoomType.STORAGE,
      x,
      y,
      w,
      h,
      motif === 0 ? 'Безопасный машинный остров ленты 14' : motif === 1 ? 'Складская ячейка ленты 14' : motif === 2 ? 'Пост охраны смены 14' : 'Карман лома у ленты',
      motif === 2 ? Tex.PANEL : Tex.METAL,
      motif === 2 ? Tex.F_LINO : Tex.F_CONCRETE,
    );
    if (!room) continue;
    connectRoomToLane(world, mask, room, laneY, Tex.F_CONCRETE);
    if (motif === 0) dressMachineIsland(world, room, rng);
    else if (motif === 1) dressStorageBay(world, room, rng);
    else if (motif === 2) dressShiftGate(world, room);
    else dressScrapPocket(world, room, rng);
  }
}

function addShiftGate(world: World, mask: Uint8Array, x: number, y: number): void {
  const room = macroRoom(world, mask, RoomType.COMMON, x - 7, y - 5, 14, 10, 'Сменный турникет ленты 14', Tex.PANEL, Tex.F_LINO, 1);
  if (room) dressShiftGate(world, room);
}

function addCatwalkBypass(world: World, mask: Uint8Array, x: number, y0: number, y1: number, name: string): void {
  macroCorridor(world, mask, x - 1, y0, 3, y1 - y0, name, Tex.F_TILE);
  macroCorridor(world, mask, x - 58, y0 + 124, 58, 3, `${name}: перемычка`, Tex.F_TILE);
  macroCorridor(world, mask, x, y0 + 352, 58, 3, `${name}: дальняя перемычка`, Tex.F_TILE);
  for (let y = y0 + 42; y < y1 - 28; y += 96) {
    setFeature(world, x, y, Feature.LAMP);
    if (y % 192 === 0) setFeature(world, x, y + 3, Feature.APPARATUS);
  }
}

function dressSupportRoom(world: World, room: Room, rng: () => number): void {
  switch (room.type) {
    case RoomType.PRODUCTION:
      dressMachineIsland(world, room, rng);
      break;
    case RoomType.STORAGE:
      dressStorageBay(world, room, rng);
      break;
    case RoomType.KITCHEN:
      setFeature(world, room.x + 2, room.y + 2, Feature.STOVE);
      setFeature(world, room.x + 4, room.y + 2, Feature.SINK);
      setFeature(world, room.x + Math.max(5, room.w - 4), room.y + Math.max(4, room.h - 3), Feature.TABLE);
      break;
    case RoomType.BATHROOM:
      setFeature(world, room.x + 2, room.y + 2, Feature.SINK);
      setFeature(world, room.x + Math.max(4, room.w - 3), room.y + Math.max(3, room.h - 3), Feature.TOILET);
      break;
    case RoomType.MEDICAL:
      setFeature(world, room.x + 2, room.y + 2, Feature.APPARATUS);
      setFeature(world, room.x + Math.max(5, room.w - 4), room.y + 2, Feature.DESK);
      setFeature(world, room.x + 3, room.y + Math.max(4, room.h - 3), Feature.LAMP);
      break;
    case RoomType.OFFICE:
      setFeature(world, room.x + 2, room.y + 2, Feature.DESK);
      setFeature(world, room.x + Math.max(5, room.w - 4), room.y + 2, Feature.SCREEN);
      setFeature(world, room.x + 3, room.y + Math.max(4, room.h - 3), Feature.SHELF);
      break;
    case RoomType.COMMON:
      setFeature(world, room.x + 2, room.y + 2, Feature.TABLE);
      setFeature(world, room.x + 4, room.y + 2, Feature.CHAIR);
      setFeature(world, room.x + Math.max(5, room.w - 4), room.y + Math.max(4, room.h - 3), Feature.LAMP);
      break;
    case RoomType.HQ:
      dressShiftGate(world, room);
      break;
  }
}

function connectSupportRoom(world: World, room: Room | null, corridor: Room | null): Room | null {
  if (!room || !corridor) return room;
  placeDoor(world, room, corridor, '', false);
  return room;
}

function paintOwnedRoom(world: World, room: Room | null, owner: TerritoryOwner, level: number): void {
  if (!room) return;
  applyZoneRole(world, room, owner, level);
}

interface ProductionBeltHqSpec {
  owner: TerritoryOwner;
  x: number;
  y: number;
  title: string;
  floorTex: Tex;
  wallTex: Tex;
  laneY: number;
  strong?: boolean;
}

function addFactionHqCluster(world: World, mask: Uint8Array, spec: ProductionBeltHqSpec, rng: () => number): void {
  const corridor = macroCorridor(world, mask, spec.x + 8, spec.y + 18, spec.strong ? 118 : 96, 5, `${spec.title}: внутренний коридор`, spec.floorTex);
  const hq = macroRoom(world, mask, RoomType.HQ, spec.x + 38, spec.y + 4, spec.strong ? 28 : 22, 13, `${spec.title}: гермоядро`, Tex.HERMO_WALL, Tex.F_LINO, 0);
  const storage = macroRoom(world, mask, RoomType.STORAGE, spec.x + 8, spec.y + 5, 20, 12, `${spec.title}: склад и пломбы`, spec.wallTex, Tex.F_CONCRETE, 0);
  const office = macroRoom(world, mask, spec.owner === ZoneFaction.SCIENTIST ? RoomType.MEDICAL : RoomType.OFFICE, spec.x + 72, spec.y + 5, spec.strong ? 24 : 20, 12, `${spec.title}: учетный пост`, spec.wallTex, spec.floorTex, 0);
  const kitchen = macroRoom(world, mask, spec.owner === ZoneFaction.WILD ? RoomType.COMMON : RoomType.KITCHEN, spec.x + 8, spec.y + 24, 22, 12, `${spec.title}: бытовка`, spec.wallTex, Tex.F_LINO, 0);
  const bathroom = macroRoom(world, mask, RoomType.BATHROOM, spec.x + 35, spec.y + 24, 13, 10, `${spec.title}: санузел`, Tex.CONCRETE, Tex.F_TILE, 0);
  const workshop = macroRoom(world, mask, spec.owner === ZoneFaction.CITIZEN ? RoomType.PRODUCTION : RoomType.STORAGE, spec.x + 58, spec.y + 24, spec.strong ? 38 : 30, 12, `${spec.title}: мастерская поддержки`, spec.wallTex, Tex.F_CONCRETE, 0);
  const extraPost = spec.strong
    ? macroRoom(world, mask, RoomType.HQ, spec.x + 100, spec.y + 5, 20, 12, `${spec.title}: внешний кордон`, Tex.HERMO_WALL, Tex.F_LINO, 0)
    : null;
  const laneFrom = Math.min(spec.laneY, spec.y + 16);
  const laneTo = Math.max(spec.laneY, spec.y + 24);
  const spur = macroCorridor(world, mask, spec.x + 54, laneFrom, 5, Math.max(5, laneTo - laneFrom), `${spec.title}: связь с лентой`, Tex.F_TILE);
  markConveyorSpine(world, spec.x + 56, laneFrom, spec.x + 56, laneTo, spec.x + spec.y + spec.owner * 23);

  for (const room of [hq, storage, office, kitchen, bathroom, workshop, extraPost]) {
    connectSupportRoom(world, room, corridor);
    if (room) dressSupportRoom(world, room, rng);
    paintOwnedRoom(world, room, spec.owner, spec.strong ? 4 : 3);
  }
  connectSupportRoom(world, corridor, spur);
  paintOwnedRoom(world, corridor, spec.owner, spec.strong ? 4 : 3);
  paintOwnedRoom(world, spur, spec.owner, spec.strong ? 4 : 3);
}

interface ProductionBeltBaySpec {
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  serial: number;
}

function bayRoomType(serial: number): RoomType {
  switch (serial % 9) {
    case 0: return RoomType.PRODUCTION;
    case 1: return RoomType.STORAGE;
    case 2: return RoomType.OFFICE;
    case 3: return RoomType.BATHROOM;
    case 4: return RoomType.KITCHEN;
    case 5: return RoomType.COMMON;
    case 6: return RoomType.MEDICAL;
    default: return RoomType.STORAGE;
  }
}

function bayRoomName(type: RoomType, name: string, serial: number, micro: boolean): string {
  const prefix = micro ? 'микроузел' : 'ячейка';
  switch (type) {
    case RoomType.PRODUCTION: return `${name}: ${prefix} станка ${serial}`;
    case RoomType.STORAGE: return `${name}: ${prefix} тары ${serial}`;
    case RoomType.OFFICE: return `${name}: ${prefix} учета ${serial}`;
    case RoomType.BATHROOM: return `${name}: ${prefix} санобработки ${serial}`;
    case RoomType.KITCHEN: return `${name}: ${prefix} пайка ${serial}`;
    case RoomType.COMMON: return `${name}: ${prefix} ожидания ${serial}`;
    case RoomType.MEDICAL: return `${name}: ${prefix} травмпункта ${serial}`;
    default: return `${name}: ${prefix} ${serial}`;
  }
}

function addProductionBayCell(world: World, mask: Uint8Array, spec: ProductionBeltBaySpec, rng: () => number): void {
  const axisY = spec.y + Math.floor(spec.h / 2) - 2;
  const axis = macroCorridor(world, mask, spec.x + 8, axisY, Math.max(24, spec.w - 16), 5, `${spec.name}: осевой проход`, Tex.F_CONCRETE);
  const spurX = spec.x + Math.floor(spec.w / 2) - 2;
  const spur = macroCorridor(world, mask, spurX, spec.y, 5, spec.h, `${spec.name}: вертикальная подача`, Tex.F_TILE);
  markConveyorSpine(world, spec.x + 8, axisY + 2, spec.x + spec.w - 8, axisY + 2, spec.serial * 11 + 3);
  markConveyorSpine(world, spurX + 2, spec.y + 2, spurX + 2, spec.y + spec.h - 2, spec.serial * 13 + 7);

  const columns = Math.max(4, Math.floor((spec.w - 34) / 32));
  const step = (spec.w - 34) / columns;
  for (let c = 0; c < columns; c++) {
    const baseX = Math.floor(spec.x + 14 + c * step);
    for (let side = 0; side < 2; side++) {
      const serial = spec.serial * 100 + c * 2 + side;
      const type = bayRoomType(serial);
      const rw = Math.min(24, Math.max(11, Math.floor(step) - 4 + Math.floor(rng() * 5)));
      const rh = 8 + Math.floor(rng() * 6);
      const rx = baseX + Math.floor(rng() * 3);
      const ry = side === 0 ? axisY - rh - 1 : axisY + 6;
      const room = macroRoom(world, mask, type, rx, ry, rw, rh, bayRoomName(type, spec.name, serial, false), type === RoomType.PRODUCTION ? Tex.PIPE : Tex.METAL, type === RoomType.BATHROOM ? Tex.F_TILE : Tex.F_CONCRETE, 0);
      connectSupportRoom(world, room, axis);
      if (room) dressSupportRoom(world, room, rng);
    }
  }

  const microRows = Math.max(4, Math.floor((spec.h - 20) / 22));
  for (let r = 0; r < microRows; r++) {
    const serial = spec.serial * 1000 + r;
    const type = bayRoomType(serial + 5);
    const rw = 7 + (serial % 4);
    const rh = 6 + ((serial >> 2) % 3);
    const ry = spec.y + 10 + r * 22;
    const leftRoom = macroRoom(world, mask, type, spurX - rw - 1, ry, rw, rh, bayRoomName(type, spec.name, serial, true), Tex.PANEL, type === RoomType.BATHROOM ? Tex.F_TILE : Tex.F_LINO, 0);
    const rightRoom = macroRoom(world, mask, bayRoomType(serial + 2), spurX + 6, ry + 8, rw + 2, rh, bayRoomName(bayRoomType(serial + 2), spec.name, serial + 1, true), Tex.PANEL, Tex.F_LINO, 0);
    connectSupportRoom(world, leftRoom, spur);
    connectSupportRoom(world, rightRoom, spur);
    if (leftRoom) dressSupportRoom(world, leftRoom, rng);
    if (rightRoom) dressSupportRoom(world, rightRoom, rng);
  }
}

function productionBeltAuthoredOwner(roomName: string): TerritoryOwner | undefined {
  if (roomName.startsWith('Гражданский миништаб смены 14:')) return ZoneFaction.CITIZEN;
  if (roomName.startsWith('Ликвидаторский штаб ленты 14:')) return ZoneFaction.LIQUIDATOR;
  if (roomName.startsWith('Скрытый культовый миништаб:')) return ZoneFaction.CULTIST;
  if (roomName.startsWith('Научный миништаб контроля брака:')) return ZoneFaction.SCIENTIST;
  if (roomName.startsWith('Дикий миништаб ночной тары:')) return ZoneFaction.WILD;
  return undefined;
}

function hardenProductionBeltHqRoom(world: World, room: Room, owner: TerritoryOwner): void {
  room.type = RoomType.HQ;
  room.sealed = true;
  room.wallTex = Tex.HERMO_WALL;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      const interior = dx >= 0 && dx < room.w && dy >= 0 && dy < room.h;
      if (interior) {
        if (world.roomMap[idx] === room.id) {
          world.factionControl[idx] = owner;
          if (world.features[idx] === Feature.NONE && ((dx * 13 + dy * 29 + owner) % 17) === 0) {
            world.features[idx] = Feature.DESK;
          }
        }
        continue;
      }
      if (world.cells[idx] !== Cell.WALL || world.aptMask[idx]) continue;
      world.hermoWall[idx] = 1;
      world.wallTex[idx] = Tex.HERMO_WALL;
    }
  }
}

export function reinforceProductionBeltAuthoredHqTerritory(world: World): void {
  for (const room of world.rooms) {
    const owner = productionBeltAuthoredOwner(room.name);
    if (owner === undefined) continue;
    paintOwnedRoom(world, room, owner, owner === ZoneFaction.LIQUIDATOR ? 4 : 3);
    if (room.type === RoomType.HQ) hardenProductionBeltHqRoom(world, room, owner);
  }
  world.markWallTexDirty();
  world.markFeaturesDirty(false);
}

function productionBeltTerritorySpawnCells(world: World): Map<TerritoryOwner, number[]> {
  const cells = new Map<TerritoryOwner, number[]>();
  for (const owner of HUMAN_TERRITORY_OWNERS) cells.set(owner, []);
  for (let i = 0; i < W * W; i++) {
    const cell = world.cells[i];
    if (cell !== Cell.FLOOR && cell !== Cell.WATER) continue;
    if (world.aptMask[i] || world.hermoWall[i] || world.containerMap.has(i) || world.features[i] === Feature.LIFT_BUTTON) continue;
    const owner = world.factionControl[i] as TerritoryOwner;
    const list = cells.get(owner);
    if (list) list.push(i);
  }
  return cells;
}

function isProductionBeltAmbientNpc(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    entity.alive &&
    entity.name?.startsWith('Производственный пояс: работник') === true &&
    entity.plotNpcId === undefined &&
    entity.persistentNpcId === undefined &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    entity.faction !== undefined;
}

export function alignProductionBeltAmbientNpcTerritory(world: World, entities: Entity[]): void {
  const cells = productionBeltTerritorySpawnCells(world);
  const offsets = new Uint16Array(8);
  for (const entity of entities) {
    if (!isProductionBeltAmbientNpc(entity) || entity.faction === undefined) continue;
    const owner = factionToTerritoryOwner(entity.faction);
    const list = cells.get(owner);
    if (!list || list.length === 0) continue;
    const offset = offsets[owner]++ | 0;
    const cell = list[(entity.id * 127 + offset * 463) % list.length];
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

function isRoom(room: Room | null): room is Room {
  return room !== null;
}

function seedExpandedProductionCaches(world: World, dockRooms: readonly Room[], hazardRooms: readonly Room[]): void {
  const dockInventories: readonly (readonly { defId: string; count: number }[])[] = [
    [{ defId: 'gear', count: 1 }, { defId: 'fuse', count: 1 }, { defId: 'metal_sheet', count: 1 }],
    [{ defId: 'pipe', count: 1 }, { defId: 'wrench', count: 1 }, { defId: 'relay_diagram', count: 1 }],
    [{ defId: 'door_kit', count: 1 }, { defId: 'metal_sheet', count: 1 }, { defId: 'filter_layer', count: 1 }],
    [{ defId: 'ammo_energy', count: 1 }, { defId: 'fuse', count: 1 }, { defId: 'gasmask_filter', count: 1 }],
  ];
  for (let i = 0; i < dockRooms.length; i++) {
    addContainer(
      world,
      dockRooms[i],
      17 + i,
      ContainerKind.TOOL_LOCKER,
      `Запертый ремонтный шкаф ленты 14-${i + 1}`,
      dockInventories[i % dockInventories.length],
      ['industrial_cache', 'repair', 'locked_output', 'service_floor', 'quota'],
      'locked',
      Faction.LIQUIDATOR,
      undefined,
      'Охрана ленты 14',
      i % 2 === 0 ? 'metal_shop' : 'utility_room',
    );
  }

  const hazardInventories: readonly (readonly { defId: string; count: number }[])[] = [
    [{ defId: 'acid_bottle', count: 1 }, { defId: 'filter_layer', count: 1 }, { defId: 'metal_sheet', count: 1 }],
    [{ defId: 'ammo_fuel', count: 1 }, { defId: 'pipe', count: 1 }, { defId: 'gear', count: 1 }],
  ];
  for (let i = 0; i < hazardRooms.length; i++) {
    addContainer(
      world,
      hazardRooms[i],
      31 + i,
      ContainerKind.METAL_CABINET,
      `Аварийная тара брака ${i + 1}`,
      hazardInventories[i % hazardInventories.length],
      ['industrial_cache', 'hazard', 'bad_batch', 'repair', 'theft'],
      i % 2 === 0 ? 'locked' : 'room',
      Faction.WILD,
      undefined,
      'Ночная смена',
      'illegal_ammo_smelter',
    );
  }
}

export function expandProductionBeltGeometry(world: World, rng: () => number): void {
  const mask = productionProtectedMask(world);
  const laneYs = [150, 274, 398, 626, 750, 874];

  macroCorridor(world, mask, 72, 508, 342, 7, 'Левая подача проходной 14', Tex.F_CONCRETE);
  macroCorridor(world, mask, 586, 508, 366, 7, 'Правая выдача проходной 14', Tex.F_CONCRETE);
  markConveyorSpine(world, 72, 511, 414, 511, 1);
  markConveyorSpine(world, 586, 511, 952, 511, 2);

  for (let i = 0; i < laneYs.length; i++) {
    const y = laneYs[i];
    macroCorridor(world, mask, 56, y - 4, 912, 9, i % 2 === 0 ? 'Главный конвейерный пролет' : 'Обратная линия погрузки', Tex.F_CONCRETE);
    markConveyorSpine(world, 56, y, 968, y, 10 + i);
  }

  for (const x of [128, 320, 704, 896]) {
    macroCorridor(world, mask, x - 2, 146, 5, 732, 'Вертикальный подъемник тары', Tex.F_CONCRETE);
    markConveyorSpine(world, x, 146, x, 878, 40 + x);
  }

  addDockLoop(world, mask, 82, 204, 204, 214, 'Западная погрузочная петля');
  addDockLoop(world, mask, 738, 204, 204, 214, 'Восточная погрузочная петля');
  addDockLoop(world, mask, 82, 584, 204, 214, 'Нижняя петля грязной тары');
  addDockLoop(world, mask, 738, 584, 204, 214, 'Нижняя петля выдачи');

  addCatwalkBypass(world, mask, 382, 150, 876, 'Левый ремонтный мостик');
  addCatwalkBypass(world, mask, 642, 150, 876, 'Правый ремонтный мостик');

  for (const spec of [
    { owner: ZoneFaction.CITIZEN, x: 182, y: 82, title: 'Гражданский миништаб смены 14', floorTex: Tex.F_LINO, wallTex: Tex.PANEL, laneY: 150 },
    { owner: ZoneFaction.LIQUIDATOR, x: 442, y: 562, title: 'Ликвидаторский штаб ленты 14', floorTex: Tex.F_LINO, wallTex: Tex.METAL, laneY: 626, strong: true },
    { owner: ZoneFaction.CULTIST, x: 162, y: 910, title: 'Скрытый культовый миништаб', floorTex: Tex.F_LINO, wallTex: Tex.ROTTEN, laneY: 874 },
    { owner: ZoneFaction.SCIENTIST, x: 724, y: 82, title: 'Научный миништаб контроля брака', floorTex: Tex.F_TILE, wallTex: Tex.PANEL, laneY: 150 },
    { owner: ZoneFaction.WILD, x: 728, y: 910, title: 'Дикий миништаб ночной тары', floorTex: Tex.F_CONCRETE, wallTex: Tex.ROTTEN, laneY: 874 },
  ] as const) {
    addFactionHqCluster(world, mask, spec, rng);
  }

  for (const spec of [
    { x: 372, y: 176, w: 226, h: 86, name: 'Верхний сортировочный бай', serial: 1 },
    { x: 372, y: 300, w: 226, h: 86, name: 'Бай холодной приемки', serial: 2 },
    { x: 150, y: 430, w: 248, h: 168, name: 'Западный ремонтный остров', serial: 3 },
    { x: 626, y: 430, w: 248, h: 168, name: 'Восточный ревизионный остров', serial: 4 },
    { x: 372, y: 654, w: 226, h: 86, name: 'Бай обратной выдачи', serial: 5 },
    { x: 372, y: 778, w: 226, h: 86, name: 'Нижний бай грязной тары', serial: 6 },
  ] as const) {
    addProductionBayCell(world, mask, spec, rng);
  }

  for (let i = 0; i < laneYs.length; i++) {
    addLaneBlockages(world, mask, laneYs[i], 56, 968, rng);
    addSideRoomsForLane(world, mask, laneYs[i], i, rng);
  }
  for (const x of [128, 320, 704, 896]) {
    for (const y of [274, 398, 626, 750]) addShiftGate(world, mask, x, y);
  }

  const loadingRooms = [
    macroRoom(world, mask, RoomType.STORAGE, 116, 226, 58, 28, 'Док ручной приемки', Tex.METAL, Tex.F_CONCRETE),
    macroRoom(world, mask, RoomType.STORAGE, 850, 226, 58, 28, 'Док опломбированной выдачи', Tex.METAL, Tex.F_CONCRETE),
    macroRoom(world, mask, RoomType.STORAGE, 116, 698, 58, 28, 'Док возврата брака', Tex.METAL, Tex.F_CONCRETE),
    macroRoom(world, mask, RoomType.STORAGE, 850, 698, 58, 28, 'Док ночной погрузки', Tex.METAL, Tex.F_CONCRETE),
  ];
  for (const room of loadingRooms) if (room) dressLoadingDock(world, room);

  for (const spec of [
    { x: 104, y: 226, w: 170, h: 166, name: 'Западный двор ручной приемки', serial: 21 },
    { x: 760, y: 226, w: 170, h: 166, name: 'Восточный двор пломбированной выдачи', serial: 22 },
    { x: 104, y: 606, w: 170, h: 166, name: 'Двор возврата брака', serial: 23 },
    { x: 760, y: 606, w: 170, h: 166, name: 'Двор ночной погрузки', serial: 24 },
  ] as const) {
    addProductionBayCell(world, mask, spec, rng);
  }

  const hazardRooms: Room[] = [];
  for (const spec of [
    { x: 344, y: 206 }, { x: 654, y: 326 }, { x: 344, y: 682 }, { x: 654, y: 806 },
  ]) {
    const room = macroRoom(world, mask, RoomType.STORAGE, spec.x, spec.y, 24, 16, 'Опасный карман ремонта', Tex.ROTTEN, Tex.F_CONCRETE);
    if (room) {
      dressScrapPocket(world, room, rng);
      hazardRooms.push(room);
    }
  }

  seedExpandedProductionCaches(world, loadingRooms.filter(isRoom), hazardRooms);
  const machineRooms = world.rooms.filter(room =>
    room.type === RoomType.PRODUCTION ||
    room.name.includes('Опасный карман') ||
    room.name.includes('Безопасный машинный остров')
  );
  registerProductionMachineHazards(world, machineRooms, 14);
  world.markFogDirty();
}

function decorateLineRooms(world: World, rooms: ProductionBeltRooms): void {
  for (let dx = 2; dx < rooms.metalLine.w - 3; dx += 4) {
    setFeature(world, rooms.metalLine.x + dx, rooms.metalLine.y + 4, Feature.MACHINE);
    setFeature(world, rooms.metalLine.x + dx + 1, rooms.metalLine.y + 8, Feature.APPARATUS);
  }
  setFeature(world, rooms.metalLine.x + 4, rooms.metalLine.y + 12, Feature.LAMP);
  setFeature(world, rooms.metalLine.x + 17, rooms.metalLine.y + 12, Feature.LAMP);
  setFeature(world, rooms.metalLine.x + 25, rooms.metalLine.y + 4, Feature.SHELF);

  for (let dx = 2; dx < rooms.chargeLine.w - 3; dx += 3) {
    setFeature(world, rooms.chargeLine.x + dx, rooms.chargeLine.y + 3, Feature.APPARATUS);
    setFeature(world, rooms.chargeLine.x + dx, rooms.chargeLine.y + 8, Feature.MACHINE);
  }
  setFeature(world, rooms.chargeLine.x + 6, rooms.chargeLine.y + 6, Feature.LAMP);
  setFeature(world, rooms.chargeLine.x + 19, rooms.chargeLine.y + 6, Feature.LAMP);
  setHazardWater(world, rooms.chargeLine.x + 2, rooms.chargeLine.y + rooms.chargeLine.h - 2, 90);
  setHazardWater(world, rooms.chargeLine.x + 3, rooms.chargeLine.y + rooms.chargeLine.h - 2, 90);

  for (let dx = 2; dx < rooms.ammoLine.w - 2; dx += 4) {
    setFeature(world, rooms.ammoLine.x + dx, rooms.ammoLine.y + 3, Feature.MACHINE);
    setFeature(world, rooms.ammoLine.x + dx, rooms.ammoLine.y + 9, Feature.APPARATUS);
  }
  setFeature(world, rooms.ammoLine.x + 4, rooms.ammoLine.y + 6, Feature.LAMP);
  setFeature(world, rooms.ammoLine.x + 18, rooms.ammoLine.y + 6, Feature.LAMP);

  for (let dx = 2; dx < rooms.quarantine.w - 2; dx += 3) {
    setHazardWater(world, rooms.quarantine.x + dx, rooms.quarantine.y + 4, 160);
    setHazardWater(world, rooms.quarantine.x + dx, rooms.quarantine.y + 5, 180);
  }
  setFeature(world, rooms.quarantine.x + 3, rooms.quarantine.y + 2, Feature.APPARATUS);
  setFeature(world, rooms.quarantine.x + 17, rooms.quarantine.y + 2, Feature.SHELF);
  setFeature(world, rooms.quarantine.x + 10, rooms.quarantine.y + 9, Feature.LAMP);
  world.markFogDirty();

  for (let dx = 2; dx < rooms.loadingDock.w - 2; dx += 4) setFeature(world, rooms.loadingDock.x + dx, rooms.loadingDock.y + 5, Feature.SHELF);
  for (let dx = 2; dx < rooms.lockers.w - 2; dx += 3) setFeature(world, rooms.lockers.x + dx, rooms.lockers.y + 5, Feature.SHELF);
  setFeature(world, rooms.foreman.x + 3, rooms.foreman.y + 4, Feature.DESK);
  setFeature(world, rooms.foreman.x + 10, rooms.foreman.y + 4, Feature.SHELF);
  setFeature(world, rooms.foreman.x + 8, rooms.foreman.y + 8, Feature.LAMP);
  setFeature(world, rooms.auditOffice.x + 3, rooms.auditOffice.y + 4, Feature.DESK);
  setFeature(world, rooms.auditOffice.x + 9, rooms.auditOffice.y + 4, Feature.APPARATUS);
  setFeature(world, rooms.auditOffice.x + 12, rooms.auditOffice.y + 8, Feature.LAMP);
  setFeature(world, rooms.gate.x + 4, rooms.gate.y + 3, Feature.TABLE);
  setFeature(world, rooms.gate.x + 8, rooms.gate.y + 3, Feature.CHAIR);
  setFeature(world, rooms.gate.x + 11, rooms.gate.y + 3, Feature.LAMP);
  setFeature(world, rooms.shelter.x + 4, rooms.shelter.y + 4, Feature.TABLE);
  setFeature(world, rooms.shelter.x + 8, rooms.shelter.y + 4, Feature.CHAIR);
  setFeature(world, rooms.shelter.x + 13, rooms.shelter.y + 4, Feature.LAMP);
}

function roomCell(world: World, room: Room, salt: number): { x: number; y: number } {
  const iw = Math.max(1, room.w - 2);
  const ih = Math.max(1, room.h - 2);
  for (let a = 0; a < Math.max(8, room.w * room.h); a++) {
    const x = world.wrap(room.x + 1 + ((salt * 5 + a * 3) % iw));
    const y = world.wrap(room.y + 1 + ((salt * 7 + a * 5) % ih));
    const i = world.idx(x, y);
    if (world.roomMap[i] === room.id && (world.cells[i] === Cell.FLOOR || world.cells[i] === Cell.WATER)) return { x, y };
  }
  return { x: world.wrap(room.x + Math.floor(room.w / 2)), y: world.wrap(room.y + Math.floor(room.h / 2)) };
}

function cloneInventory(items: readonly { defId: string; count: number }[]): { defId: string; count: number }[] {
  return items.filter(i => !!ITEMS[i.defId]).map(i => ({ defId: i.defId, count: i.count }));
}

function spawnNpc(
  entities: Entity[],
  nextId: { v: number },
  plotNpcId: string,
  _def: PlotNpcDef,
  room: Room,
  salt: number,
  angle: number,
  weapon?: string,
): number {
  const pos = roomCellForActor(room, salt);
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, pos.x, pos.y, {
    angle,
    canGiveQuest: true,
    weapon,
    aiTarget: { x: 0, y: 0 },
    extra: {
      assignedRoomId: room.id,
      rpg: randomRPG(3),
    },
  });
  return npc.id;
}

function roomCellForActor(room: Room, salt: number): { x: number; y: number } {
  const iw = Math.max(1, room.w - 2);
  const ih = Math.max(1, room.h - 2);
  return {
    x: room.x + 1 + ((salt * 5) % iw) + 0.5,
    y: room.y + 1 + ((salt * 7) % ih) + 0.5,
  };
}

function spawnMonster(
  entities: Entity[],
  nextId: { v: number },
  kind: MonsterKind,
  room: Room,
  salt: number,
  level: number,
): void {
  const def = MONSTERS[kind];
  const pos = roomCellForActor(room, salt);
  const hp = Math.round(def.hp * (1 + Math.max(0, level - 1) * 0.18));
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: pos.x,
    y: pos.y,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: def.speed,
    sprite: def.sprite,
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
    phasing: kind === MonsterKind.SPIRIT,
  });
}

function dropItems(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  room: Room,
  itemIds: readonly string[],
): void {
  for (let n = 0; n < itemIds.length; n++) {
    const defId = itemIds[n];
    if (!ITEMS[defId]) continue;
    const pos = roomCell(world, room, n + 3);
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

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function uniqueTags(tags: readonly string[]): string[] {
  return tags.filter((tag, idx, all) => all.indexOf(tag) === idx);
}

function addContainer(
  world: World,
  room: Room,
  salt: number,
  kind: ContainerKind,
  name: string,
  inventory: readonly { defId: string; count: number }[],
  tags: readonly string[],
  access: WorldContainer['access'],
  faction?: Faction,
  ownerNpcId?: number,
  ownerName?: string,
  factoryId?: string,
): WorldContainer {
  const pos = roomCell(world, room, salt);
  setFeature(world, pos.x, pos.y, kind === ContainerKind.SAFE ? Feature.DESK : Feature.SHELF);
  const ci = world.idx(pos.x, pos.y);
  const container: WorldContainer = {
    id: nextContainerId(world),
    x: pos.x,
    y: pos.y,
    floor: PRODUCTION_BELT_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind,
    name,
    inventory: cloneInventory(inventory),
    capacitySlots: Math.max(6, inventory.length + 3),
    ownerNpcId,
    ownerName,
    faction,
    access,
    lockDifficulty: access === 'locked' ? 3 : undefined,
    discovered: true,
    factoryId,
    tags: uniqueTags([CONTENT_TAG, ...tags]),
  };
  world.addContainer(container);
  return container;
}

function applyZoneRole(world: World, room: Room, faction: ZoneFaction, level: number): void {
  const zi = world.zoneMap[world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2))];
  const zone = world.zones[zi];
  if (zone) {
    zone.faction = faction;
    zone.level = Math.max(zone.level, level);
  }
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      world.factionControl[world.idx(room.x + dx, room.y + dy)] = faction;
    }
  }
}

function createProductionBeltState(
  rooms: ProductionBeltRooms,
  containers: ProductionBeltContainers,
): ProductionBeltRouteState {
  return {
    routeId: DESIGN_FLOOR_ID,
    anchorZ: PRODUCTION_BELT_ROUTE_Z,
    baseFloor: PRODUCTION_BELT_BASE_FLOOR,
    lines: [
      {
        id: 'prod_restore_line',
        factoryId: 'metal_shop',
        roomId: rooms.metalLine.id,
        outputContainerId: containers.metalOutput.id,
        state: 'repairable',
        dependencyIds: ['prod_to_service_door_kits'],
      },
      {
        id: 'prod_charge_line',
        factoryId: 'utility_room',
        roomId: rooms.chargeLine.id,
        outputContainerId: containers.chargeOutput.id,
        state: 'audited',
        dependencyIds: ['prod_charge_to_service_power'],
      },
      {
        id: 'prod_illegal_ammo',
        factoryId: 'illegal_ammo_smelter',
        roomId: rooms.ammoLine.id,
        outputContainerId: containers.ammoOutput.id,
        state: 'bad_batch',
        dependencyIds: ['prod_bad_batch_to_market', 'prod_bad_batch_to_living_warning'],
      },
    ],
    dependencies: PRODUCTION_BELT_PIPELINE_DEPENDENCIES.map(dep => ({ ...dep })),
    cueIds: [
      'production_belt_repair_feed',
      'production_belt_service_feed',
      'production_belt_bad_batch_warning',
      'production_belt_tracked_zhernov',
      'production_belt_tensor_spine',
      'production_belt_machine_shelter',
    ],
  };
}

function isPassableHazardCell(world: World, cell: number, roomId: number): boolean {
  return world.roomMap[cell] === roomId &&
    (world.cells[cell] === Cell.FLOOR || world.cells[cell] === Cell.WATER) &&
    world.features[cell] !== Feature.LIFT_BUTTON &&
    !world.containerMap.has(cell);
}

function collectMachineFieldCells(world: World, room: Room, radius: number): number[] {
  const cells: number[] = [];
  const seen = new Set<number>();
  const r2 = radius * radius;
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const x = room.x + dx;
      const y = room.y + dy;
      const feature = world.features[world.idx(x, y)];
      if (feature !== Feature.MACHINE && feature !== Feature.APPARATUS) continue;
      for (let oy = -radius; oy <= radius; oy++) {
        for (let ox = -radius; ox <= radius; ox++) {
          const d2 = ox * ox + oy * oy;
          if (d2 > r2) continue;
          const cell = world.idx(x + ox, y + oy);
          if (seen.has(cell) || !isPassableHazardCell(world, cell, room.id)) continue;
          seen.add(cell);
          cells.push(cell);
        }
      }
    }
  }
  return cells;
}

function stampMachineHazardCues(world: World, cells: readonly number[], seed: number): void {
  if (cells.length === 0) return;
  const step = Math.max(1, Math.floor(cells.length / 14));
  for (let n = 0; n < cells.length; n += step) {
    const cell = cells[n];
    const x = cell % W;
    const y = (cell / W) | 0;
    stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.26, 0.5, seed + n * 37, 210, 138, 44, false);
  }
}

function registerMachineHazardSite(world: World, room: Room, serial: number): boolean {
  const cells = collectMachineFieldCells(world, room, room.type === RoomType.PRODUCTION ? 2 : 1);
  if (cells.length < 6) return false;
  stampMachineHazardCues(world, cells, room.id * 9109 + serial * 131);
  const center = cells[Math.floor(cells.length / 2)];
  const cx = center % W;
  const cy = (center / W) | 0;
  const zoneId = world.zoneMap[center];
  registerCellHazardSite(world, {
    id: `production_belt_machine_field_${room.id}`,
    kind: 'production_machine_field',
    displayName: 'Опасная зона станка',
    cells,
    tags: ['production_belt', 'machine_hazard', 'industrial', 'static_field'],
    sticky: false,
    cleanable: false,
    slowMult: 0.72,
    activeFog: 54,
    playerDamagePerSecond: room.type === RoomType.PRODUCTION ? 0.08 : 0,
    monsterDamagePerSecond: 0.35,
    messageCooldownSeconds: 3.2,
    roomId: room.id,
    zoneId: zoneId >= 0 ? zoneId : undefined,
    centerX: cx + 0.5,
    centerY: cy + 0.5,
    warning: 'Станочная зона тянет одежду и сбивает шаг. Идите по освещенной кромке или через ремонтный мостик.',
    warningColor: '#fd6',
  });
  return true;
}

function registerProductionMachineHazards(world: World, rooms: readonly Room[], limit: number): number {
  let registered = 0;
  for (const room of rooms) {
    if (registered >= limit) break;
    if (registerMachineHazardSite(world, room, registered)) registered++;
  }
  return registered;
}

function markConveyorSpine(world: World, x0: number, y0: number, x1: number, y1: number, serial: number): void {
  const horizontal = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
  if (horizontal) {
    const y = world.wrap(y0);
    const from = Math.min(x0, x1);
    const to = Math.max(x0, x1);
    for (let x = from; x <= to; x++) {
      const i = world.idx(x, y);
      if (world.cells[i] !== Cell.FLOOR) continue;
      world.floorTex[i] = Tex.F_TILE;
      if ((x + serial) % 37 === 0) stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.18, 0.44, serial * 7919 + x, 180, 150, 70, false);
    }
    return;
  }
  const x = world.wrap(x0);
  const from = Math.min(y0, y1);
  const to = Math.max(y0, y1);
  for (let y = from; y <= to; y++) {
    const i = world.idx(x, y);
    if (world.cells[i] !== Cell.FLOOR) continue;
    world.floorTex[i] = Tex.F_TILE;
    if ((y + serial) % 37 === 0) stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.18, 0.44, serial * 7919 + y, 180, 150, 70, false);
  }
}

export function publishProductionBeltDecision(
  game: GameState,
  world: World,
  actor: Entity,
  routeState: ProductionBeltRouteState,
  decisionId: ProductionBeltDecisionId,
): WorldEvent {
  const dependencies = routeState.dependencies.filter(dep => dep.decisionId === decisionId);
  const line = routeState.lines.find(l => dependencies.some(dep => dep.factoryId === l.factoryId)) ?? routeState.lines[0];
  const px = Math.floor(actor.x);
  const py = Math.floor(actor.y);
  const zoneId = world.zoneMap[world.idx(px, py)];
  const badBatch = decisionId === 'expose_bad_batch' || decisionId === 'steal_bad_batch';
  return publishEvent(game, {
    type: badBatch ? 'room_blocked_production' : 'room_produced_items',
    floor: PRODUCTION_BELT_BASE_FLOOR,
    zoneId: zoneId >= 0 ? zoneId : undefined,
    roomId: line?.roomId,
    containerId: line?.outputContainerId,
    actorId: actor.id,
    actorName: actor.name,
    actorFaction: actor.faction,
    severity: badBatch ? 4 : 3,
    privacy: decisionId === 'steal_bad_batch' ? 'secret' : 'local',
    tags: ['production_belt', 'pipeline', decisionId, ...dependencies.map(dep => dep.toRouteId)],
    data: {
      routeId: routeState.routeId,
      z: routeState.anchorZ,
      decisionId,
      dependencyIds: dependencies.map(dep => dep.id),
      factoryIds: dependencies.map(dep => dep.factoryId),
      outputContainerId: line?.outputContainerId,
    },
  });
}

function registerProductionBeltRouteCues(
  world: World,
  rooms: ProductionBeltRooms,
  containers: ProductionBeltContainers,
): void {
  const repairMarkerX = rooms.metalLine.x + 6.5;
  const repairMarkerY = rooms.metalLine.y + 12.5;
  const repairTargetX = containers.metalOutput.x + 0.5;
  const repairTargetY = containers.metalOutput.y + 0.5;
  const repairCell = world.idx(Math.floor(repairMarkerX), Math.floor(repairMarkerY));
  registerRouteCue(world, {
    id: 'production_belt_repair_feed',
    x: repairMarkerX,
    y: repairMarkerY,
    targetX: repairTargetX,
    targetY: repairTargetY,
    floor: PRODUCTION_BELT_BASE_FLOOR,
    roomId: rooms.metalLine.id,
    targetRoomId: rooms.metalLine.id,
    zoneId: world.zoneMap[repairCell],
    label: 'ремонтная линия',
    hint: 'две шестерни возвращают дверь-комплект в выходной шкаф',
    targetName: containers.metalOutput.name,
    color: '#fd6',
    tags: ['production_belt', 'repair', 'pipeline', 'service_floor', 'quota'],
    toneSeed: rooms.metalLine.id * 97 + containers.metalOutput.id,
    radius: 8,
    targetRadius: 2.8,
    cooldownSec: 30,
    heardText: 'Восстановительная линия бьет валом: Рустаму нужны шестерни, выходной шкаф ждет комплект.',
    followedText: 'Вы у выходного шкафа восстановительной линии. Его можно чинить по акту или обчищать как сменный долг.',
    ignoredText: 'Стук восстановительной линии остался позади. Без ремонта С-15 снова недополучит дверь-комплект.',
  });

  const serviceMarkerX = rooms.chargeLine.x + 6.5;
  const serviceMarkerY = rooms.chargeLine.y + 6.5;
  const serviceTargetX = containers.chargeOutput.x + 0.5;
  const serviceTargetY = containers.chargeOutput.y + 0.5;
  const serviceCell = world.idx(Math.floor(serviceMarkerX), Math.floor(serviceMarkerY));
  registerRouteCue(world, {
    id: 'production_belt_service_feed',
    x: serviceMarkerX,
    y: serviceMarkerY,
    targetX: serviceTargetX,
    targetY: serviceTargetY,
    floor: PRODUCTION_BELT_BASE_FLOOR,
    roomId: rooms.chargeLine.id,
    targetRoomId: rooms.chargeLine.id,
    zoneId: world.zoneMap[serviceCell],
    label: 'зарядная передача',
    hint: 'реле ведет к энергоячейке для С-15',
    targetName: containers.chargeOutput.name,
    color: '#8cf',
    tags: ['production_belt', 'pipeline', 'service_floor', 'transfer'],
    toneSeed: rooms.chargeLine.id * 101 + containers.chargeOutput.id,
    radius: 9,
    targetRadius: 2.8,
    cooldownSec: 32,
    heardText: 'Зарядная линия щелкает в сторону С-15: ячейку можно сдать, украсть или сорвать смену.',
    followedText: 'Вы у ящика энергоячеек. Это питание для обхода Служебного этажа и повод для кражи.',
    ignoredText: 'Реле зарядки осталось позади. Служебный обход не получил эту ячейку.',
  });

  const warningMarkerX = rooms.auditOffice.x + 9.5;
  const warningMarkerY = rooms.auditOffice.y + 4.5;
  const warningTargetX = containers.quarantine.x + 0.5;
  const warningTargetY = containers.quarantine.y + 0.5;
  const warningCell = world.idx(Math.floor(warningMarkerX), Math.floor(warningMarkerY));
  registerRouteCue(world, {
    id: 'production_belt_bad_batch_warning',
    x: warningMarkerX,
    y: warningMarkerY,
    targetX: warningTargetX,
    targetY: warningTargetY,
    floor: PRODUCTION_BELT_BASE_FLOOR,
    roomId: rooms.auditOffice.id,
    targetRoomId: rooms.quarantine.id,
    zoneId: world.zoneMap[warningCell],
    label: 'акт брака',
    hint: 'зеленая партия пищит за стеной аудита',
    targetName: containers.quarantine.name,
    color: '#afa',
    tags: ['production_belt', 'warning', 'bad_batch', 'living'],
    toneSeed: rooms.auditOffice.id * 103 + containers.quarantine.id,
    radius: 8,
    targetRadius: 3,
    cooldownSec: 36,
    heardText: 'Экран БОТ-14 предупреждает: зеленую партию можно выдать наверх или остановить актом.',
    followedText: 'Карантинный шкаф найден. Дальше выбор: образцы аудитору, товар рынку или оставить отраву в линии.',
    ignoredText: 'Предупреждение БОТ-14 погасло за спиной. Зеленая партия осталась в маршруте.',
  });

  const zhernovMarkerX = rooms.metalLine.x + 22.5;
  const zhernovMarkerY = rooms.metalLine.y + 6.5;
  const zhernovTargetX = containers.zhernovMachine.x + 0.5;
  const zhernovTargetY = containers.zhernovMachine.y + 0.5;
  const zhernovCell = world.idx(Math.floor(zhernovMarkerX), Math.floor(zhernovMarkerY));
  registerRouteCue(world, {
    id: 'production_belt_tracked_zhernov',
    x: zhernovMarkerX,
    y: zhernovMarkerY,
    targetX: zhernovTargetX,
    targetY: zhernovTargetY,
    floor: PRODUCTION_BELT_BASE_FLOOR,
    roomId: rooms.metalLine.id,
    targetRoomId: rooms.metalLine.id,
    zoneId: world.zoneMap[zhernovCell],
    label: 'гусеничный жернов',
    hint: 'пломбированная тележка добивает собранных тварей, но числится у ликвидаторов',
    targetName: containers.zhernovMachine.name,
    color: '#f96',
    tags: ['production_belt', 'tracked_zhernov', 'liquidator', 'regenerator_finisher', 'theft'],
    toneSeed: rooms.metalLine.id * 107 + containers.zhernovMachine.id,
    radius: 8,
    targetRadius: 2.8,
    cooldownSec: 42,
    heardText: 'У восстановительной линии скрежещет тележка жернова: финишер для собранной твари стоит под пломбой.',
    followedText: 'Вы у пломбированной тележки жернова. Можно оставить её ликвидаторам или вынести как тяжёлый финальный аргумент.',
    ignoredText: 'Скрежет жернова остался за спиной. Собранную тварь придётся добивать обычным железом.',
  });

  const spineMarkerX = rooms.corridor.x + 32.5;
  const spineMarkerY = rooms.corridor.y + 3.5;
  const spineTargetX = rooms.exitDock.x + rooms.exitDock.w - 3.5;
  const spineTargetY = rooms.exitDock.y + 3.5;
  const spineCell = world.idx(Math.floor(spineMarkerX), Math.floor(spineMarkerY));
  registerRouteCue(world, {
    id: 'production_belt_tensor_spine',
    x: spineMarkerX,
    y: spineMarkerY,
    targetX: spineTargetX,
    targetY: spineTargetY,
    floor: PRODUCTION_BELT_BASE_FLOOR,
    roomId: rooms.corridor.id,
    targetRoomId: rooms.exitDock.id,
    zoneId: world.zoneMap[spineCell],
    label: 'тензорная линия',
    hint: 'светлая полоса ленты ведет от проходной к докам и обходам',
    targetName: rooms.exitDock.name,
    color: '#fd6',
    tags: ['production_belt', 'conveyor_spine', 'static_route_line', 'dock_loop'],
    toneSeed: rooms.corridor.id * 109 + rooms.exitDock.id,
    radius: 10,
    targetRadius: 3,
    cooldownSec: 34,
    heardText: 'На полу тянется светлая линия ленты: по ней можно идти к докам без живой механики конвейера.',
    followedText: 'Вы на линии ленты. Она не двигает тело, но читает маршрут: доки, обходы, выдача.',
    ignoredText: 'Полоса ленты ушла в шум цеха. Без нее доки придется искать по железу и лампам.',
  });

  const hazardMarkerX = rooms.chargeLine.x + 9.5;
  const hazardMarkerY = rooms.chargeLine.y + 8.5;
  const shelterTargetX = rooms.shelter.x + 8.5;
  const shelterTargetY = rooms.shelter.y + 4.5;
  const hazardCell = world.idx(Math.floor(hazardMarkerX), Math.floor(hazardMarkerY));
  registerRouteCue(world, {
    id: 'production_belt_machine_shelter',
    x: hazardMarkerX,
    y: hazardMarkerY,
    targetX: shelterTargetX,
    targetY: shelterTargetY,
    floor: PRODUCTION_BELT_BASE_FLOOR,
    roomId: rooms.chargeLine.id,
    targetRoomId: rooms.shelter.id,
    zoneId: world.zoneMap[hazardCell],
    label: 'укрытие у станков',
    hint: 'желтый туман показывает опасную кромку, освещенная бытовка дает безопасный обход',
    targetName: rooms.shelter.name,
    color: '#fc8',
    tags: ['production_belt', 'machine_hazard', 'shelter', 'samosbor', 'bypass'],
    toneSeed: rooms.chargeLine.id * 113 + rooms.shelter.id,
    radius: 9,
    targetRadius: 3.2,
    cooldownSec: 38,
    heardText: 'Зарядная линия шипит желтым полем. Сменная бытовка справа держит сухую кромку.',
    followedText: 'Вы у безопасной кромки станков. Отсюда можно переждать такт, чинить линию или вести Егора к проходной.',
    ignoredText: 'Станочная кромка осталась без ориентира. В шуме цеха укрытие выглядит как обычная дверь.',
  });
}

function populateRooms(world: World, entities: Entity[], nextId: { v: number }, rooms: ProductionBeltRooms): ProductionBeltContainers {
  const galinaId = spawnNpc(entities, nextId, 'prod_foreman_galina', FOREMAN_DEF, rooms.foreman, 1, Math.PI / 2);
  const rustamId = spawnNpc(entities, nextId, 'prod_mechanic_rustam', MECHANIC_DEF, rooms.metalLine, 2, Math.PI);
  const egorId = spawnNpc(entities, nextId, 'prod_worker_egor', WORKER_DEF, rooms.quarantine, 3, -Math.PI / 2);
  const auditorId = spawnNpc(entities, nextId, 'prod_auditor_bot', AUDITOR_DEF, rooms.auditOffice, 4, Math.PI, 'makarov');

  const metalOutput = addContainer(world, rooms.metalLine, 1, ContainerKind.TOOL_LOCKER, 'Выходной шкаф восстановительной линии', [
    { defId: 'pipe', count: 1 },
    { defId: 'door_kit', count: 1 },
    { defId: 'metal_sheet', count: 2 },
  ], ['production_output', 'metal_shop', 'tools', 'faction', 'legal_output', 'service_floor', 'theft'], 'owner', Faction.CITIZEN, galinaId, FOREMAN_DEF.name, 'metal_shop');

  const chargeOutput = addContainer(world, rooms.chargeLine, 2, ContainerKind.TOOL_LOCKER, 'Опломбированный ящик энергоячеек', [
    { defId: 'ammo_energy', count: 1 },
    { defId: 'fuse', count: 2 },
    { defId: 'relay_diagram', count: 1 },
  ], ['production_output', 'utility_room', 'utility', 'room', 'tech', 'service_floor', 'transfer', 'theft'], 'owner', Faction.CITIZEN, rustamId, MECHANIC_DEF.name, 'utility_room');

  const ammoOutput = addContainer(world, rooms.ammoLine, 3, ContainerKind.WEAPON_CRATE, 'Серый ящик патронной смены', [
    { defId: 'rpl23_lmg', count: 1 },
    { defId: 'ammo_belt', count: 40 },
    { defId: 'ammo_9mm', count: 18 },
    { defId: 'ammo_fuel', count: 1 },
    { defId: 'brt2_foam_projector', count: 1 },
    { defId: 'foam_grenade_6p10', count: 3 },
    { defId: 'pbrog1_foam_launcher', count: 1 },
    { defId: 'metal_sheet', count: 1 },
    { defId: 'homemade_ammo_instruction', count: 1 },
  ], ['production_output', 'illegal_ammo_smelter', 'ammo', 'weapon', 'engineer', 'foam', 'rare_engineer_crate', 'illegal', 'black_market_88', 'theft'], 'faction', Faction.WILD, egorId, WORKER_DEF.name, 'illegal_ammo_smelter');

  const p41Mount = addContainer(world, rooms.ammoLine, 6, ContainerKind.WEAPON_CRATE, 'Опломбированный станок 6П41', [
    { defId: 'p41_heavy_mg', count: 1 },
    { defId: 'ammo_belt', count: 80 },
    { defId: 'weapon_checkout_tag', count: 1 },
  ], ['mounted_weapon', 'p41_heavy_mg', 'heavy_mg', 'ammo_belt', 'stationary', 'authored_route', 'theft'], 'faction', Faction.LIQUIDATOR, auditorId, AUDITOR_DEF.name, 'illegal_ammo_smelter');

  const g41Mount = addContainer(world, rooms.ammoLine, 7, ContainerKind.WEAPON_CRATE, 'Опломбированный станок 5Г41', [
    { defId: 'g41_grenade_launcher', count: 1 },
    { defId: 'grenade', count: 3 },
    { defId: 'weapon_checkout_tag', count: 1 },
  ], ['mounted_weapon', 'g41_grenade_launcher', 'grenade', 'stationary', 'authored_route', 'theft'], 'faction', Faction.LIQUIDATOR, auditorId, AUDITOR_DEF.name, 'illegal_ammo_smelter');

  const zhernovMachine = addContainer(world, rooms.metalLine, 8, ContainerKind.WEAPON_CRATE, 'Пломбированная тележка жернова', [
    { defId: 'tracked_zhernov', count: 1 },
    { defId: 'weapon_checkout_tag', count: 1 },
  ], ['mounted_weapon', 'tracked_zhernov', 'stationary', 'authored_route', 'regenerator_finisher', 'theft'], 'faction', Faction.LIQUIDATOR, auditorId, AUDITOR_DEF.name, 'metal_shop');

  const quarantine = addContainer(world, rooms.quarantine, 4, ContainerKind.METAL_CABINET, 'Карантинный шкаф зеленой партии', [
    { defId: 'green_briquette', count: 4 },
    { defId: 'acid_bottle', count: 1 },
    { defId: 'filter_layer', count: 2 },
  ], ['quarantine', 'bad_batch', 'food', 'living', 'warning', 'theft'], 'owner', Faction.CITIZEN, auditorId, AUDITOR_DEF.name);

  const lockers = addContainer(world, rooms.lockers, 5, ContainerKind.TOOL_LOCKER, 'Открытые шкафчики смены', [
    { defId: 'labor_shift_card', count: 2 },
    { defId: 'gear', count: 2 },
    { defId: 'fuse', count: 1 },
    { defId: 'wrench', count: 1 },
    { defId: 'water', count: 1 },
  ], ['repair', 'public', 'shift'], 'public');

  const loading = addContainer(world, rooms.loadingDock, 6, ContainerKind.METAL_CABINET, 'Промежуточная тара погрузки', [
    { defId: 'grey_briquette', count: 3 },
    { defId: 'gasmask_filter', count: 1 },
    { defId: 'container_key_label', count: 1 },
  ], ['loading', 'public', 'food'], 'room', Faction.CITIZEN);

  dropItems(world, entities, nextId, rooms.lockers, ['gear', 'gear', 'fuse', 'circuit_board', 'water']);
  dropItems(world, entities, nextId, rooms.metalLine, ['metal_sheet', 'pipe', 'wrench', 'relay_diagram']);
  dropItems(world, entities, nextId, rooms.quarantine, ['green_briquette', 'green_briquette', 'acid_bottle']);
  dropItems(world, entities, nextId, rooms.shelter, ['bread', 'bandage', 'grey_briquette']);

  spawnMonster(entities, nextId, MonsterKind.REBAR, rooms.metalLine, 5, 3);
  spawnMonster(entities, nextId, MonsterKind.ROBOT, rooms.chargeLine, 6, 3);
  spawnMonster(entities, nextId, MonsterKind.ROBOT, rooms.chargeLine, 7, 3);
  spawnMonster(entities, nextId, MonsterKind.SBORKA, rooms.quarantine, 8, 2);
  spawnMonster(entities, nextId, MonsterKind.SBORKA, rooms.quarantine, 9, 2);

  return { metalOutput, chargeOutput, ammoOutput, p41Mount, g41Mount, zhernovMachine, quarantine, lockers, loading };
}

export function generateProductionBeltDesignFloor(): ProductionBeltGeneration {
  registerProductionBeltContent();

  const world = new World();
  world.wallTex.fill(Tex.METAL);
  world.floorTex.fill(Tex.F_CONCRETE);
  world.factionControl.fill(ZoneFaction.CITIZEN);

  const rooms = buildRooms(world);
  const spawnX = rooms.gate.x + 3.5;
  const spawnY = rooms.gate.y + 3.5;

  placeLift(world, rooms.corridor.x + 4, rooms.corridor.y - 1, rooms.corridor.x + 4, rooms.corridor.y, LiftDirection.UP);
  placeLift(world, rooms.corridor.x + rooms.corridor.w - 4, rooms.corridor.y + rooms.corridor.h, rooms.corridor.x + rooms.corridor.w - 4, rooms.corridor.y + rooms.corridor.h - 1, LiftDirection.DOWN);

  sanitizeDoors(world);
  ensureConnectivity(world, spawnX, spawnY);
  generateZones(world);

  applyZoneRole(world, rooms.gate, ZoneFaction.CITIZEN, 2);
  applyZoneRole(world, rooms.foreman, ZoneFaction.CITIZEN, 2);
  applyZoneRole(world, rooms.metalLine, ZoneFaction.CITIZEN, 3);
  applyZoneRole(world, rooms.chargeLine, ZoneFaction.LIQUIDATOR, 3);
  applyZoneRole(world, rooms.ammoLine, ZoneFaction.WILD, 4);
  applyZoneRole(world, rooms.quarantine, ZoneFaction.WILD, 4);
  applyZoneRole(world, rooms.auditOffice, ZoneFaction.LIQUIDATOR, 3);

  decorateLineRooms(world, rooms);

  const entities: Entity[] = [];
  const nextId = { v: 1 };
  const containers = populateRooms(world, entities, nextId, rooms);
  const productionState = createProductionBeltState(rooms, containers);
  registerProductionBeltRouteCues(world, rooms, containers);
  markConveyorSpine(world, rooms.corridor.x + 1, rooms.corridor.y + 3, rooms.corridor.x + rooms.corridor.w - 2, rooms.corridor.y + 3, 91);
  registerProductionMachineHazards(world, [rooms.metalLine, rooms.chargeLine, rooms.ammoLine, rooms.quarantine], 4);

  world.bakeLights();
  return { world, entities, spawnX, spawnY, productionState };
}
