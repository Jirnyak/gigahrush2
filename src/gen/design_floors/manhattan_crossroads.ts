/* -- Design floor: Manhattan-like indoor crossroads ------------- */

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
  type Room,
  type TerritoryOwner,
  type WorldContainer,
} from '../../core/types';
import { REACH_GATE_KEY, REACH_GATE_NONE, World, auditReachability } from '../../core/world';
import { withSeededRandom, SeedRng } from '../../core/rand';
import { freshNeeds } from '../../data/catalog';
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { Spr, monsterSpr } from '../../render/sprite_index';
import {
  calcZoneLevel,
  randomRPG,
  scaleMonsterHp,
  scaleMonsterSpeed,
} from '../../systems/rpg';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { ensureConnectivity, generateZones, sanitizeDoors, stampRoom } from '../shared';
import type { FloorGeneration } from '../floor_manifest';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('manhattan_crossroads');

export const DESIGN_FLOOR_ID = 'manhattan_crossroads' as const;
export const MANHATTAN_CROSSROADS_Z = 8;
export const MANHATTAN_CROSSROADS_SEED = 9009;

const CENTER = W >> 1;
const DISTRICT_MIN = CENTER - 330;
const DISTRICT_MAX = CENTER + 330;
const AVENUE_WIDTH = 11;
const STREET_WIDTH = 9;
const SIDEWALK = 3;
const ROAD_TEX = Tex.DARK;
const SIDEWALK_TEX = Tex.F_CONCRETE;
const MARK_TEX = Tex.F_TILE;
const ROAD_WALL_TEX = Tex.CONCRETE;
const OVERPASS_TEX = Tex.F_TILE;
const UNDERPASS_TEX = Tex.F_CONCRETE;
const CROSSWALK_ROOM_NAME = 'Белая дорожная разметка';
const CONTROL_ROOM_NAME = 'Пост управления перекрестком';
const CARGO_ROOM_NAME = 'Гараж украденного груза';
const WRONG_TURN_ROOM_NAME = 'Съезд Неправильный поворот';
const SAFE_CURB_ROOM_NAME = 'Безопасный бордюр у зебры';
const TOLL_GATE_ROOM_NAME = 'Платная перемычка центральной зебры';
const AVENUE_CENTERS = [232, 344, 512, 680, 792] as const;
const STREET_CENTERS = [232, 344, 512, 680, 792] as const;
const SHELL_AVENUE_CENTERS = [104, ...AVENUE_CENTERS, 920] as const;
const SHELL_STREET_CENTERS = [104, ...STREET_CENTERS, 920] as const;
const CROSSROADS_TOLL_CROWD_CAP = 12;
const CROSSROADS_TRAFFIC_BAND_CAP = 34;

type Axis = 'vertical' | 'horizontal';

interface RoadSpan {
  axis: Axis;
  center: number;
  from: number;
  to: number;
  width: number;
  name: string;
}

interface KeyRooms {
  control: Room;
  cargo: Room;
  wrongTurn: Room;
  safeCurb: Room;
  kiosk: Room;
  tollGate: Room;
}

interface CrossroadsNpcIds {
  militsiya: number;
  granny: number;
  dima: number;
  ksu: number;
}

interface AuditRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ManhattanCrossroadsDebugInfo {
  routeId: typeof DESIGN_FLOOR_ID;
  z: number;
  seed: number;
  junctions: readonly string[];
  blockers: readonly string[];
  questRooms: readonly string[];
  smokePath: string;
}

export interface ManhattanCrossroadsDecisionMetrics {
  crosswalkStripeCells: number;
  blockInteriorRooms: number;
  blockInteriorReachableCells: number;
  escortNpcPresent: boolean;
  tollDoorLocked: boolean;
  tollDoorRequiresKey: boolean;
  tollKeyContainers: number;
  tollQueueNpcs: number;
  overpassUngatedCells: number;
  underpassUngatedCells: number;
  controlRoomReachableCells: number;
  repairFuseCount: number;
  cargoRoomReachableCells: number;
  cargoMetalSheets: number;
  wrongExitUngatedCells: number;
  wrongExitMonsters: number;
}

export const MANHATTAN_CROSSROADS_DEBUG: ManhattanCrossroadsDebugInfo = {
  routeId: DESIGN_FLOOR_ID,
  z: MANHATTAN_CROSSROADS_Z,
  seed: MANHATTAN_CROSSROADS_SEED,
  junctions: [
    '4-way: Central Ave / Main Cross at 512,512',
    'T-junction: Central Ave / Wrong-Turn Spur at 512,600',
    '4-way: West Ave / Main Cross at 344,512',
    '4-way: East Ave / Main Cross at 680,512',
    'outer grid: five avenues and five cross streets between 232..792',
  ],
  blockers: [
    'Wrong-turn spur has no western approach, so the 512,600 node reads as a three-approach junction.',
    'Cargo garage is locked/faction-owned and can be looted, fought over, or handled through Dima.',
    'Three barricaded intersections force alley, storefront and overpass detours instead of a single straight road.',
    'Central zebra has a locked toll gate; the player can steal a key under witnesses or use the overpass/underpass bypass.',
    'Traffic bands seed visible wild clusters, convoy bodies and liquidator posts before the A-Life population field fills the road grid.',
  ],
  questRooms: [CONTROL_ROOM_NAME, CARGO_ROOM_NAME, WRONG_TURN_ROOM_NAME, SAFE_CURB_ROOM_NAME, TOLL_GATE_ROOM_NAME],
  smokePath: 'Spawn on the south curb, choose the locked central toll gate or the east overpass bypass, cross two zebra markings, then reach the wrong-turn spur at 512,600.',
};

const ROAD_SPANS: readonly RoadSpan[] = [
  { axis: 'vertical', center: 232, from: DISTRICT_MIN, to: DISTRICT_MAX, width: AVENUE_WIDTH, name: 'Западная окраинная авеню' },
  { axis: 'vertical', center: 344, from: DISTRICT_MIN, to: DISTRICT_MAX, width: AVENUE_WIDTH, name: 'Западная авеню' },
  { axis: 'vertical', center: 512, from: DISTRICT_MIN, to: DISTRICT_MAX, width: AVENUE_WIDTH, name: 'Центральная авеню' },
  { axis: 'vertical', center: 680, from: DISTRICT_MIN, to: DISTRICT_MAX, width: AVENUE_WIDTH, name: 'Восточная авеню' },
  { axis: 'vertical', center: 792, from: DISTRICT_MIN, to: DISTRICT_MAX, width: AVENUE_WIDTH, name: 'Крайняя восточная авеню' },
  { axis: 'horizontal', center: 232, from: DISTRICT_MIN, to: DISTRICT_MAX, width: STREET_WIDTH, name: 'Северный въезд' },
  { axis: 'horizontal', center: 344, from: DISTRICT_MIN, to: DISTRICT_MAX, width: STREET_WIDTH, name: 'Северная улица' },
  { axis: 'horizontal', center: 512, from: DISTRICT_MIN, to: DISTRICT_MAX, width: STREET_WIDTH, name: 'Главный кросс' },
  { axis: 'horizontal', center: 680, from: DISTRICT_MIN, to: DISTRICT_MAX, width: STREET_WIDTH, name: 'Южная улица' },
  { axis: 'horizontal', center: 792, from: DISTRICT_MIN, to: DISTRICT_MAX, width: STREET_WIDTH, name: 'Южный объезд' },
  { axis: 'horizontal', center: 600, from: 512, to: DISTRICT_MAX, width: STREET_WIDTH, name: 'Съезд Неправильный поворот' },
];

const CENTRAL_CROSSWALK_AUDIT_RECTS: readonly AuditRect[] = [
  { x: 480, y: 480, w: 65, h: 65 },
  { x: 498, y: 592, w: 40, h: 20 },
];

const OVERPASS_AUDIT_RECTS: readonly AuditRect[] = [
  { x: 548, y: 438, w: 8, h: 158 },
  { x: 506, y: 438, w: 50, h: 8 },
  { x: 548, y: 586, w: 92, h: 8 },
  { x: 632, y: 586, w: 8, h: 38 },
];

const UNDERPASS_AUDIT_RECTS: readonly AuditRect[] = [
  { x: 292, y: 620, w: 212, h: 7 },
  { x: 494, y: 600, w: 7, h: 86 },
  { x: 650, y: 626, w: 136, h: 7 },
];

const TRAFFIC_MILITSIYA: PlotNpcDef = {
  name: 'Сержант Оськин',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 175,
  maxHp: 175,
  money: 120,
  speed: 1.05,
  inventory: [
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 18 },
    { defId: 'fuse', count: 1 },
  ],
  talkLines: [
    'Перекресток мой. Не потому что я хочу, а потому что остальные считают полосы по трупам.',
    'Светофор не сломан, у него сгорела пара предохранителей. Вернешь питание - стрелка перестанет врать.',
    'На белые полосы наступай быстро. На черном асфальте шаги слышно дальше, чем надо.',
    'Центральная калитка платная не деньгами, а вниманием. Ключ лежит рядом, очередь тоже.',
  ],
  talkLinesPost: [
    'Свет снова мигает по уставу. Теперь страшно хотя бы ритмично.',
    'Если пойдешь по съезду с неверной стрелкой, не спорь с указателем вслух.',
  ],
};

const ZEBRA_GRANNY: PlotNpcDef = {
  name: 'Бабка Зебрина',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.HOUSEWIFE,
  sprite: Occupation.HOUSEWIFE,
  hp: 90,
  maxHp: 90,
  money: 18,
  speed: 0.58,
  inventory: [
    { defId: 'bread', count: 1 },
    { defId: 'water_coupon', count: 1 },
  ],
  talkLines: [
    'Я через эту зебру сорок лет хожу. Раньше машины боялись людей, теперь полосы боятся тени.',
    'Проводишь до Димы у киоска? Я медленная, зато помню, где асфальт проваливается.',
    'На середине не стой. Перекресток считает тех, кто задумался.',
  ],
  talkLinesPost: [
    'Дошли. Теперь я снова могу ругаться на дорогу с правильной стороны.',
    'Белая полоса не спасает. Просто на ней видно, кто бежит.',
  ],
};

const COURIER_DIMA: PlotNpcDef = {
  name: 'Дима Курьер',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.TRAVELER,
  sprite: Occupation.TRAVELER,
  hp: 105,
  maxHp: 105,
  money: 75,
  speed: 1.35,
  inventory: [
    { defId: 'water', count: 1 },
    { defId: 'metal_sheet', count: 1 },
  ],
  talkLines: [
    'Доставка по авеню: если дошел, значит адрес был настоящий.',
    'Груз увели в гараж за южной зеброй. Два листа металла, документы и чужая наглость.',
    'Милиция держит центр, Ксю знает боковые стрелки. Я знаю только, где меня еще не били.',
  ],
  talkLinesPost: [
    'Металл вернулся. Теперь дверь снова можно убедить, что она броня.',
    'Бабку довел? Хорошо. На этой дороге старость быстрее пули не бегает.',
  ],
  talkQuestResponse: 'Бабка дошла. Я видел, как перекресток притворился вежливым.',
};

const ROAD_STALKER_KSU: PlotNpcDef = {
  name: 'Ксю Развязка',
  isFemale: true,
  faction: Faction.WILD,
  occupation: Occupation.TRAVELER,
  sprite: Occupation.TRAVELER,
  hp: 120,
  maxHp: 120,
  money: 64,
  speed: 1.2,
  inventory: [
    { defId: 'knife', count: 1 },
    { defId: 'lift_scheme', count: 1 },
    { defId: 'cigs', count: 2 },
  ],
  talkLines: [
    'В городе улица ведет к улице. Здесь улица ведет к этажу, если указатель врет красиво.',
    'Неверный съезд за восточной авеню открыт, но не любит свидетелей.',
    'Плати слухом, патроном или молчанием. Дорога всё равно возьмет сдачу.',
  ],
  talkLinesPost: [
    'Съезд увидел тебя и не забрал. Значит, сегодня ему хватило других.',
    'Если стрелка показывает вниз, проверь, не стоит ли она на потолке.',
  ],
};

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'crossroads_traffic_militsiya', TRAFFIC_MILITSIYA, [
  {
    id: 'crossroads_open_junction',
    giverNpcId: 'crossroads_traffic_militsiya',
    type: QuestType.FETCH,
    desc: 'Оськин: «Два предохранителя на пост. Починим светофор — центр станет проходом, а не мясорубкой.»',
    targetItem: 'fuse',
    targetCount: 2,
    rewardItem: 'ammo_9mm',
    rewardCount: 12,
    extraRewards: [{ defId: 'water', count: 1 }],
    relationDelta: 12,
    xpReward: 70,
    moneyReward: 80,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'crossroads_zebra_granny', ZEBRA_GRANNY, [
  {
    id: 'crossroads_zebra_escort',
    giverNpcId: 'crossroads_zebra_granny',
    type: QuestType.TALK,
    desc: 'Зебрина: «Проведи меня через две зебры к Диме {dir}. Если остановишься на черном, дорога решит, что ты знак.»',
    targetNpcId: 'crossroads_courier_dima',
    rewardItem: 'bread',
    rewardCount: 1,
    extraRewards: [{ defId: 'water_coupon', count: 1 }],
    relationDelta: 8,
    xpReward: 45,
    moneyReward: 20,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'crossroads_courier_dima', COURIER_DIMA, [
  {
    id: 'crossroads_stolen_cargo',
    giverNpcId: 'crossroads_courier_dima',
    type: QuestType.FETCH,
    desc: 'Дима: «Из гаража украли два листа металла. Верни груз или продай совесть дешевле дороги.»',
    targetItem: 'metal_sheet',
    targetCount: 2,
    rewardItem: 'filtered_water',
    rewardCount: 1,
    extraRewards: [{ defId: 'ammo_9mm', count: 8 }],
    relationDelta: 10,
    xpReward: 60,
    moneyReward: 55,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'crossroads_road_stalker_ksu', ROAD_STALKER_KSU, [
  {
    id: 'crossroads_wrong_turn',
    giverNpcId: 'crossroads_road_stalker_ksu',
    type: QuestType.VISIT,
    desc: 'Ксю: «Найди съезд с неправильной стрелкой {dir}. Не заходи глубоко, просто докажи, что дорога там есть.»',
    targetRoomName: WRONG_TURN_ROOM_NAME,
    rewardItem: 'lift_scheme',
    rewardCount: 1,
    extraRewards: [{ defId: 'cigs', count: 2 }],
    relationDelta: 7,
    xpReward: 50,
    moneyReward: 35,
  },
]);

function addLogicalRoom(
  world: World,
  name: string,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  floorTex: Tex,
  wallTex = ROAD_WALL_TEX,
): Room {
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
  world.rooms[room.id] = room;
  return room;
}

function setOpenCell(world: World, x: number, y: number, floorTex: Tex, roomId: number): void {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.FLOOR;
  world.floorTex[ci] = floorTex;
  world.wallTex[ci] = ROAD_WALL_TEX;
  world.roomMap[ci] = roomId;
}

function carveRoadSpan(world: World, span: RoadSpan, roadRoomId: number, sidewalkRoomId: number): void {
  const half = Math.floor(span.width / 2);
  const y0 = Math.min(span.from, span.to);
  const y1 = Math.max(span.from, span.to);
  for (let n = y0; n <= y1; n++) {
    for (let o = -half - SIDEWALK; o <= half + SIDEWALK; o++) {
      const road = Math.abs(o) <= half;
      const x = span.axis === 'vertical' ? span.center + o : n;
      const y = span.axis === 'vertical' ? n : span.center + o;
      const ci = world.idx(x, y);
      if (!road && world.floorTex[ci] === ROAD_TEX) continue;
      setOpenCell(world, x, y, road ? ROAD_TEX : SIDEWALK_TEX, road ? roadRoomId : sidewalkRoomId);
    }
  }
}

function isRoadLikeRoom(world: World, roomId: number): boolean {
  const room = world.rooms[roomId];
  return room?.name === 'Асфальтовая сетка авеню'
    || room?.name === 'Бордюры и служебные края'
    || room?.name === CROSSWALK_ROOM_NAME;
}

function canRetuneStreetCell(world: World, ci: number): boolean {
  if (world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR) return false;
  if (world.containerMap.has(ci)) return false;
  const roomId = world.roomMap[ci];
  return roomId < 0 || isRoadLikeRoom(world, roomId);
}

function setOpenCellSafe(world: World, x: number, y: number, floorTex: Tex, roomId: number): void {
  const ci = world.idx(x, y);
  if (!canRetuneStreetCell(world, ci)) return;
  const wasFloor = world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER;
  world.cells[ci] = Cell.FLOOR;
  world.floorTex[ci] = floorTex;
  world.wallTex[ci] = ROAD_WALL_TEX;
  world.roomMap[ci] = roomId;
  if (!wasFloor) world.features[ci] = Feature.NONE;
}

function carveRoadSpanSafe(world: World, span: RoadSpan, roadRoomId: number, sidewalkRoomId: number): void {
  const half = Math.floor(span.width / 2);
  const start = Math.min(span.from, span.to);
  const end = Math.max(span.from, span.to);
  for (let n = start; n <= end; n++) {
    for (let o = -half - SIDEWALK; o <= half + SIDEWALK; o++) {
      const road = Math.abs(o) <= half;
      const x = span.axis === 'vertical' ? span.center + o : n;
      const y = span.axis === 'vertical' ? n : span.center + o;
      setOpenCellSafe(world, x, y, road ? ROAD_TEX : SIDEWALK_TEX, road ? roadRoomId : sidewalkRoomId);
    }
  }
}

function carveOpenRect(
  world: World,
  x: number,
  y: number,
  w: number,
  h: number,
  floorTex: Tex,
  roomId: number,
  safe = false,
): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      if (safe) setOpenCellSafe(world, x + dx, y + dy, floorTex, roomId);
      else setOpenCell(world, x + dx, y + dy, floorTex, roomId);
    }
  }
}

function carveDiagonalPath(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  floorTex: Tex,
  roomId: number,
  safe = false,
): void {
  const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const x = Math.round(ax + (bx - ax) * t);
    const y = Math.round(ay + (by - ay) * t);
    for (let dy = -width; dy <= width; dy++) {
      for (let dx = -width; dx <= width; dx++) {
        if (dx * dx + dy * dy > width * width) continue;
        if (safe) setOpenCellSafe(world, x + dx, y + dy, floorTex, roomId);
        else setOpenCell(world, x + dx, y + dy, floorTex, roomId);
      }
    }
  }
}

function placeBarrierRect(world: World, x: number, y: number, w: number, h: number): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (!canRetuneStreetCell(world, ci)) continue;
      if (world.cells[ci] !== Cell.FLOOR) continue;
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.METAL;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
  }
}

function nearAnyCenter(v: number, centers: readonly number[], radius: number): boolean {
  for (const center of centers) {
    if (Math.abs(v - center) <= radius) return true;
  }
  return false;
}

function paintSurfaceRect(
  world: World,
  x: number,
  y: number,
  px0: number,
  py0: number,
  px1: number,
  py1: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) return;
  let cell = world.surfaceMap.get(ci);
  if (!cell) {
    cell = new Uint8Array(1024);
    world.surfaceMap.set(ci, cell);
  }
  const sx = Math.max(0, Math.min(15, px0));
  const ex = Math.max(0, Math.min(15, px1));
  const sy = Math.max(0, Math.min(15, py0));
  const ey = Math.max(0, Math.min(15, py1));
  for (let py = sy; py <= ey; py++) {
    for (let px = sx; px <= ex; px++) {
      const pi = (py * 16 + px) << 2;
      cell[pi] = r;
      cell[pi + 1] = g;
      cell[pi + 2] = b;
      cell[pi + 3] = Math.max(cell[pi + 3], a);
    }
  }
  world.markSurfaceCellDirty(ci);
}

function markLineCell(world: World, x: number, y: number, axis: Axis, markRoomId: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
  world.floorTex[ci] = MARK_TEX;
  world.roomMap[ci] = markRoomId;
  if (!shouldPaintHighResMark(x, y)) return;
  if (axis === 'vertical') {
    paintSurfaceRect(world, x, y, 6, 0, 9, 15, 238, 238, 224, 235);
  } else {
    paintSurfaceRect(world, x, y, 0, 6, 15, 9, 238, 238, 224, 235);
  }
}

function shouldPaintHighResMark(x: number, y: number): boolean {
  const near = (cx: number, cy: number, r: number) => {
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  };
  return near(512, 512, 90) || near(512, 600, 76) || near(680, 512, 60);
}

function markCrosswalkCell(world: World, x: number, y: number, markRoomId: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
  world.floorTex[ci] = MARK_TEX;
  world.roomMap[ci] = markRoomId;
  if (!shouldPaintHighResMark(x, y)) return;
  paintSurfaceRect(world, x, y, 0, 0, 15, 15, 244, 244, 232, 245);
}

function paintRoadDividers(world: World, markRoomId: number): void {
  for (const span of ROAD_SPANS) {
    const start = Math.min(span.from, span.to);
    const end = Math.max(span.from, span.to);
    for (let n = start; n <= end; n++) {
      if (((n - start) % 8) > 4) continue;
      const x = span.axis === 'vertical' ? span.center : n;
      const y = span.axis === 'vertical' ? n : span.center;
      markLineCell(world, x, y, span.axis, markRoomId);
    }
  }
}

function paintCrosswalkHorizontal(world: World, x0: number, y0: number, w: number, h: number, markRoomId: number): void {
  for (let dy = 0; dy < h; dy++) {
    if (dy % 2 !== 0) continue;
    for (let dx = 0; dx < w; dx++) markCrosswalkCell(world, x0 + dx, y0 + dy, markRoomId);
  }
}

function paintCrosswalkVertical(world: World, x0: number, y0: number, w: number, h: number, markRoomId: number): void {
  for (let dx = 0; dx < w; dx++) {
    if (dx % 2 !== 0) continue;
    for (let dy = 0; dy < h; dy++) markCrosswalkCell(world, x0 + dx, y0 + dy, markRoomId);
  }
}

function paintIntersectionCrosswalks(world: World, cx: number, cy: number, avenueWidth: number, streetWidth: number, markRoomId: number): void {
  const aw = Math.floor(avenueWidth / 2);
  const sw = Math.floor(streetWidth / 2);
  paintCrosswalkHorizontal(world, cx - aw, cy - sw - 9, avenueWidth, 7, markRoomId);
  paintCrosswalkHorizontal(world, cx - aw, cy + sw + 3, avenueWidth, 7, markRoomId);
  paintCrosswalkVertical(world, cx - aw - 9, cy - sw, 7, streetWidth, markRoomId);
  paintCrosswalkVertical(world, cx + aw + 3, cy - sw, 7, streetWidth, markRoomId);
}

function stampNamedRoom(
  world: World,
  name: string,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  wallTex: Tex,
  floorTex: Tex,
): Room {
  const room = stampRoom(world, world.rooms.length, type, x, y, w, h, -1);
  room.name = name;
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.cells[ci] === Cell.WALL) world.wallTex[ci] = wallTex;
    }
  }
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      world.floorTex[ci] = floorTex;
      world.roomMap[ci] = room.id;
    }
  }
  return room;
}

function placeDoor(world: World, room: Room, x: number, y: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.DOOR) return;
  world.cells[ci] = Cell.DOOR;
  world.wallTex[ci] = Tex.DOOR_METAL;
  world.doors.set(ci, {
    idx: ci,
    state: DoorState.CLOSED,
    roomA: room.id,
    roomB: -1,
    keyId: '',
    timer: 0,
  });
  room.doors.push(ci);
}

function connectRoomToStreet(world: World, room: Room, sidewalkRoomId: number): void {
  const probes: { doorX: number; doorY: number; outX: number; outY: number; dx: number; dy: number }[] = [];
  for (let dx = 1; dx < room.w - 1; dx++) {
    probes.push({ doorX: room.x + dx, doorY: room.y - 1, outX: room.x + dx, outY: room.y - 2, dx: 0, dy: -1 });
    probes.push({ doorX: room.x + dx, doorY: room.y + room.h, outX: room.x + dx, outY: room.y + room.h + 1, dx: 0, dy: 1 });
  }
  for (let dy = 1; dy < room.h - 1; dy++) {
    probes.push({ doorX: room.x - 1, doorY: room.y + dy, outX: room.x - 2, outY: room.y + dy, dx: -1, dy: 0 });
    probes.push({ doorX: room.x + room.w, doorY: room.y + dy, outX: room.x + room.w + 1, outY: room.y + dy, dx: 1, dy: 0 });
  }

  let best: typeof probes[number] | null = null;
  let bestPath: number[] = [];
  for (const probe of probes) {
    const path: number[] = [];
    let x = probe.outX;
    let y = probe.outY;
    for (let step = 0; step < 54; step++) {
      const ci = world.idx(x, y);
      if (world.cells[ci] === Cell.FLOOR && world.roomMap[ci] !== room.id) {
        if (!best || path.length < bestPath.length) {
          best = probe;
          bestPath = path.slice();
        }
        break;
      }
      if (world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR) break;
      path.push(ci);
      x += probe.dx;
      y += probe.dy;
    }
  }
  if (!best) return;

  placeDoor(world, room, best.doorX, best.doorY);
  for (const ci of bestPath) {
    if (world.cells[ci] === Cell.LIFT) continue;
    world.cells[ci] = Cell.FLOOR;
    world.floorTex[ci] = SIDEWALK_TEX;
    world.roomMap[ci] = sidewalkRoomId;
  }
}

function connectRoomExit(
  world: World,
  room: Room,
  doorX: number,
  doorY: number,
  dx: number,
  dy: number,
  sidewalkRoomId: number,
): void {
  placeDoor(world, room, doorX, doorY);
  let x = doorX + dx;
  let y = doorY + dy;
  for (let step = 0; step < 46; step++) {
    const ci = world.idx(x, y);
    if (world.cells[ci] === Cell.FLOOR && world.roomMap[ci] !== room.id) break;
    if (world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR) break;
    world.cells[ci] = Cell.FLOOR;
    world.floorTex[ci] = SIDEWALK_TEX;
    world.roomMap[ci] = sidewalkRoomId;
    x += dx;
    y += dy;
  }
}

function setFeatureIfFloor(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER) world.features[ci] = feature;
}

function paintCrosswalkPlaza(world: World, markRoomId: number): void {
  for (let x = 480; x <= 544; x += 4) {
    for (let y = 492; y <= 532; y++) markCrosswalkCell(world, x, y, markRoomId);
  }
  for (let y = 480; y <= 544; y += 4) {
    for (let x = 492; x <= 532; x++) markCrosswalkCell(world, x, y, markRoomId);
  }
}

function carveServiceAlleys(world: World, sidewalkRoomId: number): void {
  carveDiagonalPath(world, 272, 658, 442, 542, 2, SIDEWALK_TEX, sidewalkRoomId);
  carveDiagonalPath(world, 586, 468, 748, 326, 2, SIDEWALK_TEX, sidewalkRoomId);
  carveDiagonalPath(world, 632, 620, 746, 704, 2, SIDEWALK_TEX, sidewalkRoomId);
  carveDiagonalPath(world, 304, 360, 454, 470, 1, SIDEWALK_TEX, sidewalkRoomId);
  for (const [x, y] of [[272, 658], [442, 542], [586, 468], [748, 326], [632, 620], [746, 704]] as const) {
    setFeatureIfFloor(world, x, y, Feature.LAMP);
  }
}

function carveOverpassBypass(world: World, sidewalkRoomId: number): void {
  carveOpenRect(world, 548, 438, 8, 158, OVERPASS_TEX, sidewalkRoomId);
  carveOpenRect(world, 506, 438, 50, 8, OVERPASS_TEX, sidewalkRoomId);
  carveOpenRect(world, 548, 586, 92, 8, OVERPASS_TEX, sidewalkRoomId);
  carveOpenRect(world, 632, 586, 8, 38, OVERPASS_TEX, sidewalkRoomId);
  for (let y = 444; y <= 588; y += 18) {
    setFeatureIfFloor(world, 546, y, Feature.LAMP);
    setFeatureIfFloor(world, 557, y, Feature.LAMP);
  }
  for (let x = 512; x <= 636; x += 18) setFeatureIfFloor(world, x, 586, Feature.LAMP);
}

function carveUnderpassTunnels(world: World, sidewalkRoomId: number): void {
  carveOpenRect(world, 292, 620, 212, 7, UNDERPASS_TEX, sidewalkRoomId);
  carveOpenRect(world, 494, 600, 7, 86, UNDERPASS_TEX, sidewalkRoomId);
  carveDiagonalPath(world, 500, 624, 650, 628, 2, UNDERPASS_TEX, sidewalkRoomId);
  carveOpenRect(world, 650, 626, 136, 7, UNDERPASS_TEX, sidewalkRoomId);
  for (const [x, y] of [[292, 623], [498, 604], [650, 628], [782, 628]] as const) {
    setFeatureIfFloor(world, x, y, Feature.SCREEN);
  }
}

function placeTrafficBarriers(world: World): void {
  placeBarrierRect(world, 356, 340, 42, 7);
  placeBarrierRect(world, 676, 286, 8, 42);
  placeBarrierRect(world, 220, 690, 42, 7);
  placeBarrierRect(world, 498, 502, 8, 20);
  placeBarrierRect(world, 518, 502, 8, 20);
}

function placeRoadDividerCover(world: World): void {
  for (const span of ROAD_SPANS) {
    const start = Math.min(span.from, span.to) + 18;
    const end = Math.max(span.from, span.to) - 18;
    for (let n = start; n <= end; n += 44) {
      if (span.axis === 'vertical' && nearAnyCenter(n, STREET_CENTERS, 18)) continue;
      if (span.axis === 'horizontal' && nearAnyCenter(n, AVENUE_CENTERS, 18)) continue;
      const x = span.axis === 'vertical' ? span.center - 3 : n;
      const y = span.axis === 'vertical' ? n : span.center - 3;
      setFeatureIfFloor(world, x, y, Feature.APPARATUS);
      if (n % 88 === 0) setFeatureIfFloor(world, span.axis === 'vertical' ? span.center + 3 : n, span.axis === 'vertical' ? n : span.center + 3, Feature.LAMP);
    }
  }
}

function paintRoadDividersForSpans(world: World, spans: readonly RoadSpan[], markRoomId: number): void {
  for (const span of spans) {
    const start = Math.min(span.from, span.to);
    const end = Math.max(span.from, span.to);
    for (let n = start; n <= end; n++) {
      if (((n - start) % 8) > 4) continue;
      const x = span.axis === 'vertical' ? span.center : n;
      const y = span.axis === 'vertical' ? n : span.center;
      markLineCell(world, x, y, span.axis, markRoomId);
    }
  }
}

function dressStreetMotifs(world: World, sidewalkRoomId: number, markRoomId: number): void {
  paintCrosswalkPlaza(world, markRoomId);
  carveServiceAlleys(world, sidewalkRoomId);
  carveOverpassBypass(world, sidewalkRoomId);
  carveUnderpassTunnels(world, sidewalkRoomId);
  placeTrafficBarriers(world);
  placeCentralTollGate(world);
  placeRoadDividerCover(world);
}

function logicalRoomByName(world: World, name: string, type: RoomType, floorTex: Tex, wallTex = ROAD_WALL_TEX): Room {
  const existing = world.rooms.find(room => room?.name === name);
  return existing ?? addLogicalRoom(world, name, type, 0, 0, W, W, floorTex, wallTex);
}

function canStampShellRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR || world.containerMap.has(ci)) return false;
      const roomId = world.roomMap[ci];
      if (roomId >= 0 && !isRoadLikeRoom(world, roomId)) return false;
    }
  }
  return true;
}

function stampShellStorefronts(world: World, sidewalkRoomId: number, rng: () => number): void {
  const specs: readonly { name: string; type: RoomType; x: number; y: number; w: number; h: number; wall: Tex; floor: Tex }[] = [
    { name: 'Северная закрытая витрина', type: RoomType.STORAGE, x: 92, y: 118, w: 50, h: 28, wall: Tex.PANEL, floor: Tex.F_TILE },
    { name: 'Двор над западным тоннелем', type: RoomType.COMMON, x: 92, y: 404, w: 64, h: 42, wall: Tex.BRICK, floor: Tex.F_CONCRETE },
    { name: 'Лавка дорожных знаков', type: RoomType.STORAGE, x: 874, y: 302, w: 54, h: 30, wall: Tex.METAL, floor: Tex.F_TILE },
    { name: 'Пустая касса восточного блока', type: RoomType.OFFICE, x: 878, y: 548, w: 46, h: 26, wall: Tex.PANEL, floor: Tex.F_LINO },
    { name: 'Ночной продуктовый на объезде', type: RoomType.STORAGE, x: 718, y: 878, w: 62, h: 34, wall: Tex.PANEL, floor: Tex.F_TILE },
    { name: 'Южный гаражный карман', type: RoomType.STORAGE, x: 394, y: 884, w: 70, h: 36, wall: Tex.METAL, floor: Tex.F_CONCRETE },
    { name: 'Подсобка под ложной авеню', type: RoomType.PRODUCTION, x: 108, y: 748, w: 50, h: 30, wall: Tex.PIPE, floor: Tex.F_CONCRETE },
    { name: 'Офис дорожного старшего', type: RoomType.OFFICE, x: 846, y: 126, w: 52, h: 30, wall: Tex.CONCRETE, floor: Tex.F_LINO },
  ];

  for (const spec of specs) {
    if (!canStampShellRoom(world, spec.x, spec.y, spec.w, spec.h)) continue;
    const room = stampNamedRoom(world, spec.name, spec.type, spec.x, spec.y, spec.w, spec.h, spec.wall, spec.floor);
    connectRoomToStreet(world, room, sidewalkRoomId);
    const featureCount = 2 + Math.floor(rng() * 4);
    for (let i = 0; i < featureCount; i++) {
      const fx = room.x + 3 + Math.floor(rng() * Math.max(1, room.w - 6));
      const fy = room.y + 3 + Math.floor(rng() * Math.max(1, room.h - 6));
      setFeatureIfFloor(world, fx, fy, rng() < 0.45 ? Feature.SHELF : rng() < 0.75 ? Feature.TABLE : Feature.LAMP);
    }
  }
}

function blockRoomType(serial: number): RoomType {
  const types = [
    RoomType.LIVING,
    RoomType.LIVING,
    RoomType.KITCHEN,
    RoomType.BATHROOM,
    RoomType.STORAGE,
    RoomType.OFFICE,
  ] as const;
  return types[serial % types.length];
}

function blockRoomTex(type: RoomType): { wall: Tex; floor: Tex } {
  if (type === RoomType.BATHROOM) return { wall: Tex.TILE_W, floor: Tex.F_TILE };
  if (type === RoomType.KITCHEN) return { wall: Tex.PANEL, floor: Tex.F_TILE };
  if (type === RoomType.STORAGE) return { wall: Tex.METAL, floor: Tex.F_CONCRETE };
  if (type === RoomType.OFFICE) return { wall: Tex.CONCRETE, floor: Tex.F_LINO };
  return { wall: Tex.PANEL, floor: Tex.F_LINO };
}

function decorateBlockInteriorRoom(world: World, room: Room, type: RoomType, rng: () => number): void {
  const centerX = room.x + Math.floor(room.w / 2);
  const centerY = room.y + Math.floor(room.h / 2);
  if (type === RoomType.KITCHEN) {
    setFeatureIfFloor(world, room.x + 2, room.y + 2, Feature.STOVE);
    setFeatureIfFloor(world, room.x + room.w - 3, room.y + 2, Feature.SINK);
  } else if (type === RoomType.BATHROOM) {
    setFeatureIfFloor(world, room.x + 2, room.y + 2, Feature.TOILET);
    setFeatureIfFloor(world, room.x + room.w - 3, room.y + 2, Feature.SINK);
  } else if (type === RoomType.STORAGE) {
    setFeatureIfFloor(world, centerX, centerY, Feature.SHELF);
  } else if (type === RoomType.OFFICE) {
    setFeatureIfFloor(world, centerX, centerY, Feature.DESK);
    setFeatureIfFloor(world, room.x + room.w - 3, room.y + 2, Feature.SCREEN);
  } else {
    setFeatureIfFloor(world, centerX, centerY, rng() < 0.5 ? Feature.TABLE : Feature.BED);
  }
  if (rng() < 0.72) setFeatureIfFloor(world, room.x + room.w - 2, room.y + room.h - 2, Feature.LAMP);
}

interface FloorplanRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function canBuildFloorplanRect(world: World, rect: FloorplanRect): boolean {
  for (let dy = 0; dy < rect.h; dy++) {
    for (let dx = 0; dx < rect.w; dx++) {
      if (!canRetuneStreetCell(world, world.idx(rect.x + dx, rect.y + dy))) return false;
    }
  }
  return true;
}

function addFloorplanRoom(world: World, name: string, type: RoomType, x: number, y: number, w: number, h: number, wallTex: Tex, floorTex: Tex): Room {
  const room = addLogicalRoom(world, name, type, x, y, w, h, floorTex, wallTex);
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  return room;
}

function fillFloorplanWalls(world: World, rect: FloorplanRect, wallTex: Tex): void {
  for (let dy = 0; dy < rect.h; dy++) {
    for (let dx = 0; dx < rect.w; dx++) {
      const ci = world.idx(rect.x + dx, rect.y + dy);
      if (!canRetuneStreetCell(world, ci)) continue;
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = wallTex;
      world.floorTex[ci] = Tex.F_CONCRETE;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
  }
}

function carveFloorplanRoom(world: World, room: Room): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (!canRetuneStreetCell(world, ci)) continue;
      world.cells[ci] = Cell.FLOOR;
      world.wallTex[ci] = room.wallTex;
      world.floorTex[ci] = room.floorTex;
      world.roomMap[ci] = room.id;
      world.features[ci] = Feature.NONE;
    }
  }
}

function canRetuneFloorplanCell(world: World, ci: number): boolean {
  if (canRetuneStreetCell(world, ci)) return true;
  const roomId = world.roomMap[ci];
  return roomId >= 0 && world.rooms[roomId]?.name.startsWith('Внутренний квартал');
}

function carveFloorplanCorridor(world: World, room: Room): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (!canRetuneFloorplanCell(world, ci)) continue;
      world.cells[ci] = Cell.FLOOR;
      world.wallTex[ci] = room.wallTex;
      world.floorTex[ci] = room.floorTex;
      world.roomMap[ci] = room.id;
      world.features[ci] = Feature.NONE;
    }
  }
}

function placeFloorplanDoor(world: World, a: Room, b: Room, x: number, y: number): void {
  const ci = world.idx(x, y);
  if (!canRetuneStreetCell(world, ci) && world.cells[ci] !== Cell.WALL) return;
  world.cells[ci] = Cell.DOOR;
  world.wallTex[ci] = Tex.DOOR_WOOD;
  world.features[ci] = Feature.NONE;
  world.doors.set(ci, {
    idx: ci,
    state: DoorState.CLOSED,
    roomA: a.id,
    roomB: b.id,
    keyId: '',
    timer: 0,
  });
  if (!a.doors.includes(ci)) a.doors.push(ci);
  if (!b.doors.includes(ci)) b.doors.push(ci);
}

function floorplanSegments(start: number, end: number, rng: () => number): { from: number; size: number }[] {
  const out: { from: number; size: number }[] = [];
  let cursor = start;
  while (cursor + 6 <= end) {
    const remaining = end - cursor + 1;
    const target = 7 + Math.floor(rng() * 8);
    const size = remaining <= target + 7 ? remaining : Math.min(target, remaining - 7);
    if (size < 6) break;
    out.push({ from: cursor, size });
    cursor += size + 1;
  }
  return out;
}

function randomFloorplanDepth(maxDepth: number, minDepth: number, rng: () => number): number {
  if (maxDepth <= minDepth) return Math.max(1, maxDepth);
  const span = maxDepth - minDepth;
  const biased = Math.floor(Math.pow(rng(), 1.45) * (span + 1));
  return Math.max(minDepth, Math.min(maxDepth, minDepth + biased));
}

function overlapMidpoint(a0: number, a1: number, b0: number, b1: number): number | null {
  const from = Math.max(a0, b0);
  const to = Math.min(a1, b1);
  return from <= to ? Math.floor((from + to) / 2) : null;
}

function linkFloorplanNeighbors(world: World, rooms: readonly Room[], verticalWall: boolean, rng: () => number): void {
  for (let i = 1; i < rooms.length; i++) {
    if (rng() >= 0.34) continue;
    const prev = rooms[i - 1];
    const room = rooms[i];
    if (verticalWall) {
      const y = overlapMidpoint(prev.y, prev.y + prev.h - 1, room.y, room.y + room.h - 1);
      if (y !== null) placeFloorplanDoor(world, prev, room, room.x - 1, y);
    } else {
      const x = overlapMidpoint(prev.x, prev.x + prev.w - 1, room.x, room.x + room.w - 1);
      if (x !== null) placeFloorplanDoor(world, prev, room, x, room.y - 1);
    }
  }
}

function stampHorizontalFloorplanRow(
  world: World,
  corridor: Room,
  blockIndex: number,
  rowIndex: number,
  y: number,
  h: number,
  x0: number,
  x1: number,
  wallTex: Tex,
  rng: () => number,
): number {
  if (h < 6) return 0;
  const rowRooms: Room[] = [];
  const segments = floorplanSegments(x0, x1, rng);
  const above = y < corridor.y;
  for (let i = 0; i < segments.length; i++) {
    const type = blockRoomType(blockIndex * 17 + rowIndex * 7 + i);
    const tex = blockRoomTex(type);
    const maxDepth = Math.min(h, 12 + Math.floor(rng() * 8));
    const depth = randomFloorplanDepth(maxDepth, Math.min(6, maxDepth), rng);
    const roomY = above ? corridor.y - 1 - depth : corridor.y + corridor.h + 1;
    const room = addFloorplanRoom(
      world,
      `Внутренний квартал ${blockIndex + 1}.${rowIndex + 1}.${i + 1}`,
      type,
      segments[i].from,
      roomY,
      segments[i].size,
      depth,
      wallTex,
      tex.floor,
    );
    carveFloorplanRoom(world, room);
    const doorY = y < corridor.y ? corridor.y - 1 : corridor.y + corridor.h;
    placeFloorplanDoor(world, room, corridor, room.x + Math.floor(room.w / 2), doorY);
    decorateBlockInteriorRoom(world, room, type, rng);
    rowRooms.push(room);
  }
  linkFloorplanNeighbors(world, rowRooms, true, rng);
  return rowRooms.length;
}

function stampVerticalFloorplanRow(
  world: World,
  corridor: Room,
  blockIndex: number,
  rowIndex: number,
  x: number,
  w: number,
  y0: number,
  y1: number,
  wallTex: Tex,
  rng: () => number,
): number {
  if (w < 6) return 0;
  const rowRooms: Room[] = [];
  const segments = floorplanSegments(y0, y1, rng);
  const left = x < corridor.x;
  for (let i = 0; i < segments.length; i++) {
    const type = blockRoomType(blockIndex * 19 + rowIndex * 5 + i);
    const tex = blockRoomTex(type);
    const maxDepth = Math.min(w, 12 + Math.floor(rng() * 8));
    const depth = randomFloorplanDepth(maxDepth, Math.min(6, maxDepth), rng);
    const roomX = left ? corridor.x - 1 - depth : corridor.x + corridor.w + 1;
    const room = addFloorplanRoom(
      world,
      `Внутренний квартал ${blockIndex + 1}.${rowIndex + 1}.${i + 1}`,
      type,
      roomX,
      segments[i].from,
      depth,
      segments[i].size,
      wallTex,
      tex.floor,
    );
    carveFloorplanRoom(world, room);
    const doorX = x < corridor.x ? corridor.x - 1 : corridor.x + corridor.w;
    placeFloorplanDoor(world, room, corridor, doorX, room.y + Math.floor(room.h / 2));
    decorateBlockInteriorRoom(world, room, type, rng);
    rowRooms.push(room);
  }
  linkFloorplanNeighbors(world, rowRooms, false, rng);
  return rowRooms.length;
}

function stampFloorplanBranchCorridor(
  world: World,
  sidewalkRoomId: number,
  rect: FloorplanRect,
  blockIndex: number,
  horizontalMain: boolean,
  wallTex: Tex,
  rng: () => number,
): number {
  if (rect.w < 56 || rect.h < 54 || rng() < 0.22) return 0;
  if (horizontalMain) {
    const w = rng() < 0.45 ? 2 : 3;
    const x = rect.x + 8 + Math.floor(rng() * Math.max(1, rect.w - 16 - w));
    const room = addFloorplanRoom(
      world,
      `Внутренний квартал ${blockIndex + 1}: боковой проход`,
      RoomType.CORRIDOR,
      x,
      rect.y + 1,
      w,
      rect.h - 2,
      wallTex,
      SIDEWALK_TEX,
    );
    carveFloorplanCorridor(world, room);
    connectRoomExit(world, room, x + Math.floor(w / 2), rect.y, 0, -1, sidewalkRoomId);
    connectRoomExit(world, room, x + Math.floor(w / 2), rect.y + rect.h - 1, 0, 1, sidewalkRoomId);
    return 1;
  }

  const h = rng() < 0.45 ? 2 : 3;
  const y = rect.y + 8 + Math.floor(rng() * Math.max(1, rect.h - 16 - h));
  const room = addFloorplanRoom(
    world,
    `Внутренний квартал ${blockIndex + 1}: боковой проход`,
    RoomType.CORRIDOR,
    rect.x + 1,
    y,
    rect.w - 2,
    h,
    wallTex,
    SIDEWALK_TEX,
  );
  carveFloorplanCorridor(world, room);
  connectRoomExit(world, room, rect.x, y + Math.floor(h / 2), -1, 0, sidewalkRoomId);
  connectRoomExit(world, room, rect.x + rect.w - 1, y + Math.floor(h / 2), 1, 0, sidewalkRoomId);
  return 1;
}

function stampFloorplanBlock(world: World, sidewalkRoomId: number, rect: FloorplanRect, blockIndex: number, rng: () => number): number {
  if (rect.w < 44 || rect.h < 40 || !canBuildFloorplanRect(world, rect)) return 0;
  const wallTex = blockIndex % 7 === 0 ? Tex.BRICK : blockIndex % 5 === 0 ? Tex.CONCRETE : Tex.PANEL;
  const horizontal = rect.w >= rect.h ? rng() > 0.22 : rng() > 0.58;
  fillFloorplanWalls(world, rect, wallTex);

  let placed = 0;
  if (horizontal) {
    const corridorH = rect.h >= 68 ? 3 : 2;
    const corridorY = rect.y + Math.floor((rect.h - corridorH) / 2);
    const corridor = addFloorplanRoom(world, `Внутренний квартал ${blockIndex + 1}: общий коридор`, RoomType.CORRIDOR, rect.x + 1, corridorY, rect.w - 2, corridorH, wallTex, SIDEWALK_TEX);
    carveFloorplanRoom(world, corridor);
    connectRoomExit(world, corridor, rect.x, corridorY + Math.floor(corridorH / 2), -1, 0, sidewalkRoomId);
    connectRoomExit(world, corridor, rect.x + rect.w - 1, corridorY + Math.floor(corridorH / 2), 1, 0, sidewalkRoomId);
    placed += stampHorizontalFloorplanRow(world, corridor, blockIndex, 0, rect.y + 2, corridorY - rect.y - 3, rect.x + 2, rect.x + rect.w - 3, wallTex, rng);
    placed += stampHorizontalFloorplanRow(world, corridor, blockIndex, 1, corridorY + corridorH + 1, rect.y + rect.h - corridorY - corridorH - 3, rect.x + 2, rect.x + rect.w - 3, wallTex, rng);
    placed += stampFloorplanBranchCorridor(world, sidewalkRoomId, rect, blockIndex, true, wallTex, rng);
  } else {
    const corridorW = rect.w >= 72 ? 3 : 2;
    const corridorX = rect.x + Math.floor((rect.w - corridorW) / 2);
    const corridor = addFloorplanRoom(world, `Внутренний квартал ${blockIndex + 1}: поперечный коридор`, RoomType.CORRIDOR, corridorX, rect.y + 1, corridorW, rect.h - 2, wallTex, SIDEWALK_TEX);
    carveFloorplanRoom(world, corridor);
    connectRoomExit(world, corridor, corridorX + Math.floor(corridorW / 2), rect.y, 0, -1, sidewalkRoomId);
    connectRoomExit(world, corridor, corridorX + Math.floor(corridorW / 2), rect.y + rect.h - 1, 0, 1, sidewalkRoomId);
    placed += stampVerticalFloorplanRow(world, corridor, blockIndex, 0, rect.x + 2, corridorX - rect.x - 3, rect.y + 2, rect.y + rect.h - 3, wallTex, rng);
    placed += stampVerticalFloorplanRow(world, corridor, blockIndex, 1, corridorX + corridorW + 1, rect.x + rect.w - corridorX - corridorW - 3, rect.y + 2, rect.y + rect.h - 3, wallTex, rng);
    placed += stampFloorplanBranchCorridor(world, sidewalkRoomId, rect, blockIndex, false, wallTex, rng);
  }
  return placed;
}

function stampManhattanBlockInteriors(world: World, sidewalkRoomId: number, rng: () => number): void {
  let blockIndex = 0;
  let placed = 0;
  for (let row = 0; row < SHELL_STREET_CENTERS.length - 1; row++) {
    for (let col = 0; col < SHELL_AVENUE_CENTERS.length - 1; col++) {
      const left = SHELL_AVENUE_CENTERS[col];
      const right = SHELL_AVENUE_CENTERS[col + 1];
      const top = SHELL_STREET_CENTERS[row];
      const bottom = SHELL_STREET_CENTERS[row + 1];
      const rect = {
        x: left + 16,
        y: top + 16,
        w: right - left - 32,
        h: bottom - top - 32,
      };
      placed += stampFloorplanBlock(world, sidewalkRoomId, rect, blockIndex++, rng);
    }
  }
  if (placed > 0) {
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFeaturesDirty(true);
  }
}

const FRONTAGE_ROOM_CAP = 360;

function frontageRoomType(serial: number): RoomType {
  const types = [
    RoomType.STORAGE,
    RoomType.OFFICE,
    RoomType.KITCHEN,
    RoomType.BATHROOM,
    RoomType.LIVING,
    RoomType.SMOKING,
  ] as const;
  return types[serial % types.length];
}

function frontageRoomName(type: RoomType, serial: number): string {
  const prefix =
    type === RoomType.KITCHEN ? 'чайная' :
    type === RoomType.BATHROOM ? 'санузел' :
    type === RoomType.OFFICE ? 'будка' :
    type === RoomType.LIVING ? 'ночлежка' :
    type === RoomType.SMOKING ? 'курилка' :
    'кладовая';
  return `Микролавка перекрестка ${serial + 1}: ${prefix}`;
}

function maybeStampFrontageRoom(
  world: World,
  sidewalkRoomId: number,
  span: RoadSpan,
  side: -1 | 1,
  pos: number,
  serial: number,
  rng: () => number,
): boolean {
  const half = Math.floor(span.width / 2) + SIDEWALK;
  const type = frontageRoomType(serial);
  const tex = blockRoomTex(type);
  const main = 7 + Math.floor(rng() * 8);
  const depth = 6 + Math.floor(rng() * 8);
  let x = 0;
  let y = 0;
  let w = 0;
  let h = 0;

  if (span.axis === 'vertical') {
    if (nearAnyCenter(pos, SHELL_STREET_CENTERS, 24)) return false;
    w = depth;
    h = main;
    x = side > 0 ? span.center + half + 4 : span.center - half - 4 - w;
    y = pos;
  } else {
    if (nearAnyCenter(pos, SHELL_AVENUE_CENTERS, 24)) return false;
    w = main;
    h = depth;
    x = pos;
    y = side > 0 ? span.center + half + 4 : span.center - half - 4 - h;
  }

  if (x < 3 || y < 3 || x + w >= W - 3 || y + h >= W - 3) return false;
  if (!canStampShellRoom(world, x, y, w, h)) return false;

  const room = stampNamedRoom(world, frontageRoomName(type, serial), type, x, y, w, h, tex.wall, tex.floor);
  connectRoomToStreet(world, room, sidewalkRoomId);
  decorateBlockInteriorRoom(world, room, type, rng);
  return room.doors.length > 0;
}

function stampStreetFrontageRooms(
  world: World,
  sidewalkRoomId: number,
  spans: readonly RoadSpan[],
  rng: () => number,
): void {
  let placed = 0;
  for (const span of spans) {
    const start = Math.max(12, Math.min(span.from, span.to) + 22);
    const end = Math.min(W - 18, Math.max(span.from, span.to) - 22);
    for (let pos = start; pos <= end && placed < FRONTAGE_ROOM_CAP; pos += 15 + Math.floor(rng() * 7)) {
      if (maybeStampFrontageRoom(world, sidewalkRoomId, span, -1, pos, placed, rng)) placed++;
      if (placed >= FRONTAGE_ROOM_CAP) break;
      if (maybeStampFrontageRoom(world, sidewalkRoomId, span, 1, pos, placed, rng)) placed++;
    }
  }
  if (placed > 0) {
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFeaturesDirty(true);
  }
}

interface ManhattanHqCampusSpec {
  owner: TerritoryOwner;
  label: string;
  x: number;
  y: number;
  coreName: string;
}

const MANHATTAN_HQ_CAMPUSES: readonly ManhattanHqCampusSpec[] = [
  { owner: ZoneFaction.CITIZEN, label: 'граждан', x: 286, y: 742, coreName: 'Гермодвор гражданского обхода' },
  { owner: ZoneFaction.CITIZEN, label: 'граждан западного объезда', x: 146, y: 286, coreName: 'Домком западного объезда' },
  { owner: ZoneFaction.LIQUIDATOR, label: 'ликвидаторов', x: 520, y: 472, coreName: 'Гермопост регулировщиков' },
  { owner: ZoneFaction.CULTIST, label: 'культистов', x: 856, y: 734, coreName: 'Скрытый молельный светофор' },
  { owner: ZoneFaction.SCIENTIST, label: 'ученых', x: 742, y: 286, coreName: 'Измерительный штаб разметки' },
  { owner: ZoneFaction.WILD, label: 'диких', x: 152, y: 724, coreName: 'Разбитый штаб съезда' },
];

function roomMappedCellCount(world: World, room: Room): number {
  let count = 0;
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      if (world.roomMap[world.idx(room.x + dx, room.y + dy)] === room.id) count++;
    }
  }
  return count;
}

function retintRoom(world: World, room: Room, wallTex: Tex, floorTex: Tex): void {
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) {
        if (world.roomMap[ci] === room.id) world.floorTex[ci] = floorTex;
      } else if (world.cells[ci] === Cell.WALL) {
        world.wallTex[ci] = wallTex;
      }
    }
  }
}

function paintRoomOwnerCells(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[ci] === room.id) world.factionControl[ci] = owner;
    }
  }
  for (const doorIdx of room.doors) world.factionControl[doorIdx] = owner;
}

function hardenAuthoredHqCore(world: World, room: Room, owner: TerritoryOwner, name: string): void {
  room.type = RoomType.HQ;
  room.name = name;
  room.sealed = true;
  retintRoom(world, room, Tex.HERMO_WALL, Tex.F_CONCRETE);
  paintRoomOwnerCells(world, room, owner);
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.cells[ci] !== Cell.WALL) continue;
      world.hermoWall[ci] = 1;
      world.wallTex[ci] = Tex.HERMO_WALL;
    }
  }
  for (const doorIdx of room.doors) {
    const door = world.doors.get(doorIdx);
    if (!door) continue;
    door.state = DoorState.HERMETIC_OPEN;
    door.keyId = '';
  }
  setFeatureIfFloor(world, room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2), Feature.SCREEN);
}

function retuneSupportRoom(world: World, room: Room, owner: TerritoryOwner, label: string, index: number): void {
  const pattern = [
    { type: RoomType.KITCHEN, name: `Кухня штаба ${label}`, wall: Tex.PANEL, floor: Tex.F_TILE },
    { type: RoomType.BATHROOM, name: `Санузел штаба ${label}`, wall: Tex.TILE_W, floor: Tex.F_TILE },
    { type: RoomType.STORAGE, name: `Склад штаба ${label}`, wall: Tex.METAL, floor: Tex.F_CONCRETE },
    { type: RoomType.MEDICAL, name: `Медпункт штаба ${label}`, wall: Tex.PANEL, floor: Tex.F_TILE },
    { type: RoomType.OFFICE, name: `Канцелярия штаба ${label}`, wall: Tex.CONCRETE, floor: Tex.F_LINO },
  ] as const;
  const spec = pattern[index % pattern.length];
  room.type = spec.type;
  room.name = spec.name;
  room.sealed = false;
  retintRoom(world, room, spec.wall, spec.floor);
  paintRoomOwnerCells(world, room, owner);
  decorateBlockInteriorRoom(world, room, spec.type, () => 0.5);
}

function manhattanRoomCenter(room: Room): { x: number; y: number } {
  return { x: room.x + Math.floor(room.w / 2), y: room.y + Math.floor(room.h / 2) };
}

function hqCandidateRooms(world: World, spec: ManhattanHqCampusSpec, used: Set<number>): Room[] {
  return world.rooms
    .filter(room =>
      room &&
      !used.has(room.id) &&
      room.type !== RoomType.CORRIDOR &&
      room.w >= 6 &&
      room.h >= 6 &&
      room.w * room.h <= 360 &&
      roomMappedCellCount(world, room) >= 24 &&
      (
        room.name.startsWith('Внутренний квартал') ||
        room.name.startsWith('Микролавка перекрестка') ||
        room.name.includes('закрытая витрина') ||
        room.name.includes('кладовая') ||
        room.name.includes('касса')
      )
    )
    .sort((a, b) => {
      const ac = manhattanRoomCenter(a);
      const bc = manhattanRoomCenter(b);
      const ad = world.dist2(ac.x, ac.y, spec.x, spec.y);
      const bd = world.dist2(bc.x, bc.y, spec.x, spec.y);
      return ad - bd || a.id - b.id;
    });
}

function claimManhattanHqCampuses(world: World): void {
  const used = new Set<number>();
  for (const spec of MANHATTAN_HQ_CAMPUSES) {
    const candidates = hqCandidateRooms(world, spec, used);
    const core = candidates.find(room => {
      const c = manhattanRoomCenter(room);
      return world.dist2(c.x, c.y, spec.x, spec.y) <= 230 * 230;
    }) ?? candidates[0];
    if (!core) continue;
    used.add(core.id);
    hardenAuthoredHqCore(world, core, spec.owner, spec.coreName);

    let supportIndex = 0;
    for (const room of candidates) {
      if (supportIndex >= 5) break;
      if (used.has(room.id)) continue;
      const c = manhattanRoomCenter(room);
      const cc = manhattanRoomCenter(core);
      if (world.dist2(c.x, c.y, cc.x, cc.y) > 120 * 120) continue;
      used.add(room.id);
      retuneSupportRoom(world, room, spec.owner, spec.label, supportIndex++);
    }
  }
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFeaturesDirty(false);
}

export function reinforceManhattanCrossroadsAuthoredHqTerritory(world: World): void {
  for (const spec of MANHATTAN_HQ_CAMPUSES) {
    for (const room of world.rooms) {
      if (room.name === spec.coreName) hardenAuthoredHqCore(world, room, spec.owner, spec.coreName);
      else if (room.name.includes(`штаба ${spec.label}`)) paintRoomOwnerCells(world, room, spec.owner);
    }
  }
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFeaturesDirty(false);
}

export function expandManhattanCrossroadsRouteShell(world: World, rng: () => number): void {
  const roadRoom = logicalRoomByName(world, 'Асфальтовая сетка авеню', RoomType.CORRIDOR, ROAD_TEX);
  const sidewalkRoom = logicalRoomByName(world, 'Бордюры и служебные края', RoomType.COMMON, SIDEWALK_TEX);
  const markRoom = logicalRoomByName(world, CROSSWALK_ROOM_NAME, RoomType.MEDICAL, MARK_TEX);
  const shellSpans: readonly RoadSpan[] = [
    { axis: 'vertical', center: 104, from: 0, to: W - 1, width: 9, name: 'Ложная западная авеню' },
    { axis: 'vertical', center: 232, from: 0, to: W - 1, width: 9, name: 'Западная окраинная авеню' },
    { axis: 'vertical', center: 344, from: 0, to: W - 1, width: AVENUE_WIDTH, name: 'Западная авеню' },
    { axis: 'vertical', center: 512, from: 0, to: W - 1, width: AVENUE_WIDTH, name: 'Центральная авеню' },
    { axis: 'vertical', center: 680, from: 0, to: W - 1, width: AVENUE_WIDTH, name: 'Восточная авеню' },
    { axis: 'vertical', center: 792, from: 0, to: W - 1, width: 9, name: 'Крайняя восточная авеню' },
    { axis: 'vertical', center: 920, from: 0, to: W - 1, width: 9, name: 'Ложная восточная авеню' },
    { axis: 'horizontal', center: 104, from: 0, to: W - 1, width: 7, name: 'Северный фальшобъезд' },
    { axis: 'horizontal', center: 232, from: 0, to: W - 1, width: STREET_WIDTH, name: 'Северный въезд' },
    { axis: 'horizontal', center: 344, from: 0, to: W - 1, width: STREET_WIDTH, name: 'Северная улица' },
    { axis: 'horizontal', center: 512, from: 0, to: W - 1, width: STREET_WIDTH, name: 'Главный кросс' },
    { axis: 'horizontal', center: 680, from: 0, to: W - 1, width: STREET_WIDTH, name: 'Южная улица' },
    { axis: 'horizontal', center: 792, from: 0, to: W - 1, width: STREET_WIDTH, name: 'Южный объезд' },
    { axis: 'horizontal', center: 920, from: 0, to: W - 1, width: 7, name: 'Нижний фальшобъезд' },
  ];

  for (const span of shellSpans) carveRoadSpanSafe(world, span, roadRoom.id, sidewalkRoom.id);
  paintRoadDividersForSpans(world, shellSpans, markRoom.id);
  for (const x of [104, 232, 512, 792, 920] as const) {
    for (const y of [104, 344, 680, 920] as const) paintIntersectionCrosswalks(world, x, y, AVENUE_WIDTH, STREET_WIDTH, markRoom.id);
  }
  carveDiagonalPath(world, 118, 768, 280, 634, 2, SIDEWALK_TEX, sidewalkRoom.id, true);
  carveDiagonalPath(world, 792, 256, 928, 418, 2, SIDEWALK_TEX, sidewalkRoom.id, true);
  placeBarrierRect(world, 910, 512, 46, 7);
  placeBarrierRect(world, 98, 676, 7, 46);
  stampShellStorefronts(world, sidewalkRoom.id, rng);
  stampManhattanBlockInteriors(world, sidewalkRoom.id, rng);
  stampStreetFrontageRooms(world, sidewalkRoom.id, shellSpans, rng);
  claimManhattanHqCampuses(world);
  for (const [x, y] of [[104, 104], [920, 104], [104, 920], [920, 920], [512, 920], [920, 512]] as const) {
    placeSignalCluster(world, x, y);
  }
  placeCentralTollGate(world);
}

function stampDistrictRooms(world: World, sidewalkRoomId: number): KeyRooms {
  const rooms = [
    stampNamedRoom(world, 'Квартальный блок у Западной авеню', RoomType.LIVING, 218, 224, 86, 72, Tex.PANEL, Tex.F_LINO),
    stampNamedRoom(world, 'Гаражи под северной улицей', RoomType.STORAGE, 382, 222, 74, 48, Tex.METAL, Tex.F_CONCRETE),
    stampNamedRoom(world, 'Лифтовой павильон северного квартала', RoomType.COMMON, 496, 224, 34, 22, Tex.CONCRETE, Tex.F_TILE),
    stampNamedRoom(world, 'Витринный блок западного квартала', RoomType.STORAGE, 250, 402, 58, 28, Tex.PANEL, Tex.F_TILE),
    stampNamedRoom(world, 'Аптека у северной зебры', RoomType.MEDICAL, 548, 390, 44, 24, Tex.PANEL, Tex.F_TILE),
    stampNamedRoom(world, 'Киоск у белой зебры', RoomType.STORAGE, 384, 540, 42, 22, Tex.METAL, Tex.F_TILE),
    stampNamedRoom(world, CONTROL_ROOM_NAME, RoomType.OFFICE, 474, 462, 28, 18, Tex.METAL, Tex.F_CONCRETE),
    stampNamedRoom(world, SAFE_CURB_ROOM_NAME, RoomType.COMMON, 604, 464, 38, 20, Tex.PANEL, Tex.F_TILE),
    stampNamedRoom(world, TOLL_GATE_ROOM_NAME, RoomType.OFFICE, 528, 526, 20, 12, Tex.METAL, Tex.F_CONCRETE),
    stampNamedRoom(world, CARGO_ROOM_NAME, RoomType.STORAGE, 548, 548, 50, 32, Tex.METAL, Tex.F_CONCRETE),
    stampNamedRoom(world, 'Сервисная светофора', RoomType.PRODUCTION, 622, 548, 34, 28, Tex.PIPE, Tex.F_CONCRETE),
    stampNamedRoom(world, 'Низкий тоннель под Восточной авеню', RoomType.CORRIDOR, 650, 626, 84, 14, Tex.PIPE, Tex.F_CONCRETE),
    stampNamedRoom(world, WRONG_TURN_ROOM_NAME, RoomType.CORRIDOR, 744, 614, 82, 16, Tex.CONCRETE, Tex.F_CONCRETE),
    stampNamedRoom(world, 'Дворовая кладовая дорожников', RoomType.STORAGE, 724, 708, 48, 36, Tex.PANEL, Tex.F_CONCRETE),
    stampNamedRoom(world, 'Магазин под эстакадой', RoomType.STORAGE, 676, 452, 48, 26, Tex.METAL, Tex.F_TILE),
    stampNamedRoom(world, 'Южный лифтовой вестибюль', RoomType.COMMON, 498, 782, 36, 24, Tex.CONCRETE, Tex.F_TILE),
    stampNamedRoom(world, 'Квартиры над Южной улицей', RoomType.LIVING, 222, 724, 86, 70, Tex.PANEL, Tex.F_LINO),
  ];

  for (const room of rooms) connectRoomToStreet(world, room, sidewalkRoomId);

  const control = rooms.find(r => r.name === CONTROL_ROOM_NAME)!;
  const cargo = rooms.find(r => r.name === CARGO_ROOM_NAME)!;
  const wrongTurn = rooms.find(r => r.name === WRONG_TURN_ROOM_NAME)!;
  const safeCurb = rooms.find(r => r.name === SAFE_CURB_ROOM_NAME)!;
  const kiosk = rooms.find(r => r.name === 'Киоск у белой зебры')!;
  const tollGate = rooms.find(r => r.name === TOLL_GATE_ROOM_NAME)!;
  const underpass = rooms.find(r => r.name === 'Низкий тоннель под Восточной авеню')!;
  connectRoomExit(world, underpass, underpass.x - 1, underpass.y + Math.floor(underpass.h / 2), -1, 0, sidewalkRoomId);
  connectRoomExit(world, underpass, underpass.x + underpass.w, underpass.y + Math.floor(underpass.h / 2), 1, 0, sidewalkRoomId);

  for (let dx = 3; dx < control.w - 3; dx += 5) setFeatureIfFloor(world, control.x + dx, control.y + 4, Feature.SCREEN);
  setFeatureIfFloor(world, control.x + 4, control.y + control.h - 3, Feature.DESK);
  setFeatureIfFloor(world, control.x + control.w - 5, control.y + control.h - 4, Feature.LAMP);

  for (let dx = 3; dx < cargo.w - 2; dx += 7) setFeatureIfFloor(world, cargo.x + dx, cargo.y + 3, Feature.SHELF);
  setFeatureIfFloor(world, cargo.x + cargo.w - 4, cargo.y + cargo.h - 4, Feature.MACHINE);
  setFeatureIfFloor(world, cargo.x + 5, cargo.y + cargo.h - 4, Feature.LAMP);

  for (let dx = 4; dx < wrongTurn.w - 4; dx += 8) {
    setFeatureIfFloor(world, wrongTurn.x + dx, wrongTurn.y + 3, Feature.SCREEN);
    setFeatureIfFloor(world, wrongTurn.x + dx, wrongTurn.y + wrongTurn.h - 4, Feature.LAMP);
  }
  setFeatureIfFloor(world, wrongTurn.x + wrongTurn.w - 4, wrongTurn.y + Math.floor(wrongTurn.h / 2), Feature.LIFT_BUTTON);
  setFeatureIfFloor(world, safeCurb.x + 4, safeCurb.y + 4, Feature.TABLE);
  setFeatureIfFloor(world, safeCurb.x + 8, safeCurb.y + 4, Feature.CHAIR);
  setFeatureIfFloor(world, kiosk.x + 4, kiosk.y + 4, Feature.SHELF);
  setFeatureIfFloor(world, kiosk.x + kiosk.w - 5, kiosk.y + 4, Feature.LAMP);
  setFeatureIfFloor(world, tollGate.x + 4, tollGate.y + 3, Feature.DESK);
  setFeatureIfFloor(world, tollGate.x + 9, tollGate.y + 3, Feature.SCREEN);
  setFeatureIfFloor(world, tollGate.x + 15, tollGate.y + 8, Feature.SHELF);
  for (let dx = 6; dx < underpass.w - 4; dx += 12) setFeatureIfFloor(world, underpass.x + dx, underpass.y + 4, Feature.LAMP);

  return { control, cargo, wrongTurn, safeCurb, kiosk, tollGate };
}

function placeCentralTollGate(world: World): void {
  const y = 536;
  for (let x = 504; x <= 520; x++) {
    const ci = world.idx(x, y);
    if (!canRetuneStreetCell(world, ci) || world.cells[ci] !== Cell.FLOOR) continue;
    world.cells[ci] = Cell.WALL;
    world.wallTex[ci] = Tex.METAL;
    world.roomMap[ci] = -1;
    world.features[ci] = Feature.NONE;
  }

  const doorIdx = world.idx(512, y);
  world.cells[doorIdx] = Cell.DOOR;
  world.wallTex[doorIdx] = Tex.DOOR_METAL;
  world.floorTex[doorIdx] = ROAD_TEX;
  world.doors.set(doorIdx, {
    idx: doorIdx,
    state: DoorState.LOCKED,
    roomA: -1,
    roomB: -1,
    keyId: 'key',
    timer: 0,
  });
  setFeatureIfFloor(world, 508, y - 2, Feature.SCREEN);
  setFeatureIfFloor(world, 516, y - 2, Feature.LAMP);
}

function placeSignalCluster(world: World, x: number, y: number): void {
  for (const [dx, dy] of [[-8, -8], [8, -8], [-8, 8], [8, 8]] as const) {
    setFeatureIfFloor(world, x + dx, y + dy, Feature.SCREEN);
    paintSurfaceRect(world, x + dx, y + dy, 4, 4, 11, 11, 215, 35, 25, 210);
  }
  for (const [dx, dy] of [[-10, 0], [10, 0], [0, -10], [0, 10]] as const) {
    setFeatureIfFloor(world, x + dx, y + dy, Feature.LAMP);
  }
}

function placeLift(world: World, x: number, y: number, dir: LiftDirection, buttonX: number, buttonY: number): void {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.LIFT;
  world.wallTex[ci] = Tex.LIFT_DOOR;
  world.liftDir[ci] = dir;
  setFeatureIfFloor(world, buttonX, buttonY, Feature.LIFT_BUTTON);
}

function placeDistrictLifts(world: World): void {
  placeLift(world, 512, 223, LiftDirection.UP, 512, 247);
  placeLift(world, 516, 782, LiftDirection.DOWN, 516, 781);
  placeLift(world, 823, 622, LiftDirection.UP, 822, 622);
}

function applyZones(world: World): void {
  generateZones(world);
  for (const zone of world.zones) {
    const d = world.dist(zone.cx, zone.cy, CENTER, CENTER);
    zone.level = Math.max(2, Math.min(5, calcZoneLevel(zone.cx, zone.cy, FloorLevel.KVARTIRY) + (d < 150 ? 2 : 1)));
    if (d < 130) zone.faction = ZoneFaction.LIQUIDATOR;
    else if (zone.cx > CENTER + 120) zone.faction = ZoneFaction.WILD;
    else zone.faction = ZoneFaction.CITIZEN;
    zone.fogged = false;
    zone.hasLift = d < 280;
  }
}

function spawnPlotNpc(
  entities: Entity[],
  nextId: { v: number },
  npcId: string,
  _def: PlotNpcDef,
  x: number,
  y: number,
  angle = 0,
  extra?: Partial<Entity>,
): number {
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, npcId, x + 0.5, y + 0.5, {
    angle,
    extra,
  });
  return npc.id;
}

function spawnAmbientNpc(
  rng: SeedRng,
  entities: Entity[],
  nextId: { v: number },
  name: string,
  x: number,
  y: number,
  faction: Faction,
  occupation: Occupation,
  inventory: { defId: string; count: number }[] = [],
  weapon?: string,
): void {
  entities.push({
    id: nextId.v++,
    type: EntityType.NPC,
    x: x + 0.5,
    y: y + 0.5,
    angle: rng.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: occupation === Occupation.HUNTER ? 1.15 : 1.0,
    sprite: occupation,
    name,
    isFemale: name.endsWith('а') || name.endsWith('я'),
    needs: freshNeeds(),
    hp: faction === Faction.LIQUIDATOR ? 135 : 85,
    maxHp: faction === Faction.LIQUIDATOR ? 135 : 85,
    money: 10 + Math.floor(rng.random() * 35),
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    inventory: inventory.map(i => ({ ...i })),
    weapon,
    faction,
    occupation,
    isTraveler: true,
    questId: -1,
  });
}

function spawnCrossroadsNpcs(rng: SeedRng, world: World, entities: Entity[], nextId: { v: number }, rooms: KeyRooms): CrossroadsNpcIds {
  const militsiya = spawnPlotNpc(
    entities,
    nextId,
    'crossroads_traffic_militsiya',
    TRAFFIC_MILITSIYA,
    rooms.control.x + 5,
    rooms.control.y + 10,
    Math.PI / 2,
    { weapon: 'makarov' },
  );
  const granny = spawnPlotNpc(
    entities,
    nextId,
    'crossroads_zebra_granny',
    ZEBRA_GRANNY,
    rooms.safeCurb.x + 8,
    rooms.safeCurb.y + 11,
    0,
    { spriteScale: 0.86 },
  );
  const dima = spawnPlotNpc(
    entities,
    nextId,
    'crossroads_courier_dima',
    COURIER_DIMA,
    rooms.kiosk.x + 8,
    rooms.kiosk.y + 10,
    Math.PI,
  );
  const ksu = spawnPlotNpc(
    entities,
    nextId,
    'crossroads_road_stalker_ksu',
    ROAD_STALKER_KSU,
    rooms.wrongTurn.x + 9,
    rooms.wrongTurn.y + 8,
    Math.PI,
    { weapon: 'knife' },
  );

  spawnAmbientNpc(rng, entities, nextId, 'Патрульный у делителя', 512, 486, Faction.LIQUIDATOR, Occupation.HUNTER, [
    { defId: 'ammo_9mm', count: 5 },
  ]);
  spawnAmbientNpc(rng, entities, nextId, 'Патрульная у южной зебры', 528, 538, Faction.LIQUIDATOR, Occupation.HUNTER, [
    { defId: 'bandage', count: 1 },
  ]);
  spawnAmbientNpc(rng, entities, nextId, 'Торговец с бордюра', 398, 520, Faction.CITIZEN, Occupation.STOREKEEPER, [
    { defId: 'water', count: 1 },
    { defId: 'bread', count: 2 },
  ]);
  spawnAmbientNpc(rng, entities, nextId, 'Дорожный бродяга', 690, 600, Faction.WILD, Occupation.TRAVELER, [
    { defId: 'pipe', count: 1 },
  ]);
  spawnTollCrowd(rng, entities, nextId);
  spawnTrafficBands(rng, world, entities, nextId);

  return { militsiya, granny, dima, ksu };
}

function spawnTollCrowd(rng: SeedRng, entities: Entity[], nextId: { v: number }): void {
  const spots: readonly [number, number, Faction, Occupation, string][] = [
    [506, 542, Faction.CITIZEN, Occupation.TRAVELER, 'Очередник у платной зебры'],
    [509, 545, Faction.CITIZEN, Occupation.HOUSEWIFE, 'Женщина с талоном перехода'],
    [514, 544, Faction.CITIZEN, Occupation.STOREKEEPER, 'Кладовщик у турникета'],
    [518, 542, Faction.CITIZEN, Occupation.LOCKSMITH, 'Слесарь с пустым ключом'],
    [502, 532, Faction.LIQUIDATOR, Occupation.HUNTER, 'Ликвидатор очереди'],
    [522, 532, Faction.LIQUIDATOR, Occupation.HUNTER, 'Второй счетчик полос'],
    [532, 536, Faction.CITIZEN, Occupation.SECRETARY, 'Секретарь с квитанцией'],
    [536, 540, Faction.CITIZEN, Occupation.TRAVELER, 'Пассажир без сдачи'],
    [526, 546, Faction.WILD, Occupation.TRAVELER, 'Шепот из обхода'],
    [500, 548, Faction.CITIZEN, Occupation.COOK, 'Повар с хлебом в очереди'],
    [516, 550, Faction.CITIZEN, Occupation.TRAVELER, 'Молчаливый свидетель'],
    [510, 550, Faction.CITIZEN, Occupation.TRAVELER, 'Сосед с мокрым купоном'],
  ];
  for (let i = 0; i < Math.min(CROSSROADS_TOLL_CROWD_CAP, spots.length); i++) {
    const [x, y, faction, occupation, name] = spots[i];
    spawnAmbientNpc(rng, entities, nextId, name, x, y, faction, occupation, [
      { defId: i % 3 === 0 ? 'water_coupon' : 'bread', count: 1 },
    ], faction === Faction.LIQUIDATOR ? 'makarov' : undefined);
  }
}

function spawnTrafficBandNpc(
  rng: SeedRng,
  world: World,
  entities: Entity[],
  nextId: { v: number },
  name: string,
  x: number,
  y: number,
  faction: Faction,
  occupation: Occupation,
  item: string,
  weapon?: string,
): void {
  const pos = nearestFloorCell(world, x, y);
  spawnAmbientNpc(rng, entities, nextId, name, pos.x, pos.y, faction, occupation, [{ defId: item, count: 1 }], weapon);
}

function spawnTrafficBands(rng: SeedRng, world: World, entities: Entity[], nextId: { v: number }): void {
  const spots: readonly [string, number, number, Faction, Occupation, string, string?][] = [
    ['Дикий с неверного съезда', 684, 596, Faction.WILD, Occupation.ALCOHOLIC, 'pipe', 'pipe'],
    ['Бетонный счетчик поворота', 690, 604, Faction.WILD, Occupation.TRAVELER, 'cigs', 'knife'],
    ['Резак у синей стрелки', 696, 600, Faction.WILD, Occupation.LOCKSMITH, 'spring', 'knife'],
    ['Молчаливый бандит развязки', 704, 608, Faction.WILD, Occupation.HUNTER, 'ammo_9mm', 'makarov'],
    ['Подручный Ксю на обочине', 712, 602, Faction.WILD, Occupation.TRAVELER, 'govnyak_roll', 'pipe'],
    ['Грузовой вор у гаража', 556, 572, Faction.WILD, Occupation.LOCKSMITH, 'metal_sheet', 'wrench'],
    ['Смотрящий за листовым металлом', 564, 576, Faction.WILD, Occupation.HUNTER, 'ammo_9mm', 'makarov'],
    ['Косой грузчик на стреме', 574, 570, Faction.WILD, Occupation.TRAVELER, 'bread', 'pipe'],
    ['Вор с дорожной биркой', 586, 574, Faction.WILD, Occupation.ALCOHOLIC, 'cigs', 'knife'],
    ['Банда западного делителя один', 334, 520, Faction.WILD, Occupation.TRAVELER, 'pipe', 'pipe'],
    ['Банда западного делителя два', 342, 526, Faction.WILD, Occupation.ALCOHOLIC, 'govnyak_roll', 'knife'],
    ['Банда западного делителя три', 350, 520, Faction.WILD, Occupation.LOCKSMITH, 'spring', 'wrench'],
    ['Патруль центра северный', 506, 490, Faction.LIQUIDATOR, Occupation.HUNTER, 'ammo_9mm', 'makarov'],
    ['Патруль центра восточный', 532, 506, Faction.LIQUIDATOR, Occupation.HUNTER, 'bandage', 'makarov'],
    ['Патруль центра западный', 492, 510, Faction.LIQUIDATOR, Occupation.HUNTER, 'liquidator_ration', 'makarov'],
    ['Регулировщик пробки', 516, 486, Faction.LIQUIDATOR, Occupation.HUNTER, 'fuse', 'makarov'],
    ['Конвойный с мелом', 344, 500, Faction.LIQUIDATOR, Occupation.HUNTER, 'ammo_9mm', 'makarov'],
    ['Проводник грузовой линии', 356, 506, Faction.CITIZEN, Occupation.TRAVELER, 'water_coupon'],
    ['Очередник за конвоем', 364, 514, Faction.CITIZEN, Occupation.HOUSEWIFE, 'bread'],
    ['Носильщик под вывеской', 382, 520, Faction.CITIZEN, Occupation.LOCKSMITH, 'metal_sheet'],
    ['Торговка у киоска', 408, 522, Faction.CITIZEN, Occupation.STOREKEEPER, 'filtered_water'],
    ['Покупатель с чужим талоном', 416, 526, Faction.CITIZEN, Occupation.TRAVELER, 'water_coupon'],
    ['Бегунок через южную зебру', 512, 684, Faction.CITIZEN, Occupation.TRAVELER, 'bread'],
    ['Санитар у безопасного бордюра', 618, 480, Faction.CITIZEN, Occupation.DOCTOR, 'bandage'],
    ['Механик светофорного обхода', 634, 556, Faction.CITIZEN, Occupation.MECHANIC, 'fuse', 'wrench'],
    ['Дежурная в тоннельной очереди', 650, 628, Faction.CITIZEN, Occupation.SECRETARY, 'note'],
    ['Ходок под восточной авеню', 666, 628, Faction.CITIZEN, Occupation.TRAVELER, 'water'],
    ['Дикий над тоннелем', 700, 628, Faction.WILD, Occupation.TRAVELER, 'cigs', 'knife'],
    ['Дикий в ложной витрине', 920, 512, Faction.WILD, Occupation.ALCOHOLIC, 'govnyak_roll', 'pipe'],
    ['Сторож восточного фальшобъезда', 928, 520, Faction.WILD, Occupation.HUNTER, 'ammo_9mm', 'makarov'],
    ['Путница с южного объезда', 512, 920, Faction.CITIZEN, Occupation.TRAVELER, 'tea'],
    ['Кладовщик южного тупика', 504, 912, Faction.CITIZEN, Occupation.STOREKEEPER, 'bread'],
    ['Бандит на южном хвосте', 520, 928, Faction.WILD, Occupation.TRAVELER, 'pipe', 'pipe'],
    ['Счетчик закрытого выезда', 104, 676, Faction.WILD, Occupation.LOCKSMITH, 'spring', 'wrench'],
  ];
  for (let i = 0; i < Math.min(CROSSROADS_TRAFFIC_BAND_CAP, spots.length); i++) {
    const [name, x, y, faction, occupation, item, weapon] = spots[i];
    spawnTrafficBandNpc(rng, world, entities, nextId, name, x, y, faction, occupation, item, weapon);
  }
}

function nearestFloorCell(world: World, x: number, y: number): { x: number; y: number } {
  for (let r = 0; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = world.wrap(x + dx);
        const ty = world.wrap(y + dy);
        const ci = world.idx(tx, ty);
        if (world.cells[ci] === Cell.FLOOR) return { x: tx, y: ty };
      }
    }
  }
  return { x: world.wrap(x), y: world.wrap(y) };
}

function spawnMonster(rng: SeedRng, world: World, entities: Entity[], nextId: { v: number }, kind: MonsterKind, x: number, y: number, level: number): void {
  const pos = nearestFloorCell(world, x, y);
  const def = MONSTERS[kind];
  const hp = scaleMonsterHp(def.hp, level);
  const monster: Entity = {
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: pos.x + 0.5,
    y: pos.y + 0.5,
    angle: rng.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, level),
    sprite: monsterSpr(kind),
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: CENTER, ty: CENTER, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
  };
  entities.push(monster);
}

function spawnRoadHazards(rng: SeedRng, world: World, entities: Entity[], nextId: { v: number }, rooms: KeyRooms): void {
  spawnMonster(rng, world, entities, nextId, MonsterKind.REBAR, rooms.cargo.x + rooms.cargo.w - 7, rooms.cargo.y + 8, 4);
  spawnMonster(rng, world, entities, nextId, MonsterKind.REBAR, rooms.cargo.x + 8, rooms.cargo.y + rooms.cargo.h - 7, 4);
  spawnMonster(rng, world, entities, nextId, MonsterKind.SHADOW, rooms.wrongTurn.x + rooms.wrongTurn.w - 12, rooms.wrongTurn.y + 8, 5);
  spawnMonster(rng, world, entities, nextId, MonsterKind.NELYUD, 704, 602, 4);
  spawnMonster(rng, world, entities, nextId, MonsterKind.EYE, 512, 600, 4);
}

function dropItem(entities: Entity[], nextId: { v: number }, x: number, y: number, defId: string, count = 1): void {
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

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
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
  owner?: { id?: number; name?: string; faction?: Faction },
): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
  world.addContainer({
    id: nextContainerId(world),
    x,
    y,
    floor: FloorLevel.KVARTIRY,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind,
    name,
    inventory: inventory.map(i => ({ ...i })),
    capacitySlots: Math.max(6, inventory.length + 3),
    ownerNpcId: owner?.id,
    ownerName: owner?.name,
    faction: owner?.faction,
    access,
    discovered: true,
    tags: [DESIGN_FLOOR_ID, 'future_design_floor', ...tags],
  });
  setFeatureIfFloor(world, x, y, Feature.SHELF);
}

function seedContainersAndDrops(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  rooms: KeyRooms,
  npcIds: CrossroadsNpcIds,
): void {
  addContainer(
    world,
    rooms.tollGate,
    rooms.tollGate.x + 13,
    rooms.tollGate.y + 7,
    ContainerKind.CASHBOX,
    'Касса платной перемычки',
    'owner',
    [
      { defId: 'key', count: 1 },
      { defId: 'water_coupon', count: 2 },
      { defId: 'cigs', count: 2 },
    ],
    ['toll', 'crowd_pressure', 'junction_key', 'theft'],
    { id: npcIds.militsiya, name: TRAFFIC_MILITSIYA.name, faction: Faction.LIQUIDATOR },
  );
  addContainer(
    world,
    rooms.cargo,
    rooms.cargo.x + rooms.cargo.w - 6,
    rooms.cargo.y + 5,
    ContainerKind.METAL_CABINET,
    'Шкаф украденного груза',
    'locked',
    [
      { defId: 'metal_sheet', count: 2 },
      { defId: 'water_coupon', count: 1 },
      { defId: 'voluntary_receipt', count: 1 },
    ],
    ['cargo', 'garage', 'theft', 'courier'],
    { id: npcIds.dima, name: COURIER_DIMA.name, faction: Faction.CITIZEN },
  );
  addContainer(
    world,
    rooms.control,
    rooms.control.x + rooms.control.w - 4,
    rooms.control.y + 5,
    ContainerKind.TOOL_LOCKER,
    'Светофорный щиток',
    'faction',
    [
      { defId: 'fuse', count: 1 },
      { defId: 'circuit_board', count: 1 },
      { defId: 'relay_diagram', count: 1 },
    ],
    ['junction_control', 'traffic_light', 'repair', 'liquidator'],
    { id: npcIds.militsiya, name: TRAFFIC_MILITSIYA.name, faction: Faction.LIQUIDATOR },
  );
  addContainer(
    world,
    rooms.kiosk,
    rooms.kiosk.x + rooms.kiosk.w - 5,
    rooms.kiosk.y + 5,
    ContainerKind.CASHBOX,
    'Касса дорожного киоска',
    'owner',
    [
      { defId: 'bread', count: 2 },
      { defId: 'filtered_water', count: 1 },
      { defId: 'cigs', count: 3 },
    ],
    ['kiosk', 'food', 'trade', 'theft'],
    { id: npcIds.granny, name: ZEBRA_GRANNY.name, faction: Faction.CITIZEN },
  );
  dropItem(entities, nextId, rooms.cargo.x + 7, rooms.cargo.y + rooms.cargo.h - 6, 'metal_sheet', 1);
  dropItem(entities, nextId, rooms.control.x + 6, rooms.control.y + 5, 'fuse', 1);
  dropItem(entities, nextId, rooms.wrongTurn.x + rooms.wrongTurn.w - 8, rooms.wrongTurn.y + 8, 'lift_scheme', 1);
}

function carveStreetGrid(world: World, roadRoomId: number, sidewalkRoomId: number, markRoomId: number): void {
  for (const span of ROAD_SPANS) carveRoadSpan(world, span, roadRoomId, sidewalkRoomId);
  paintRoadDividers(world, markRoomId);
  for (const x of AVENUE_CENTERS) {
    for (const y of STREET_CENTERS) paintIntersectionCrosswalks(world, x, y, AVENUE_WIDTH, STREET_WIDTH, markRoomId);
  }
  paintIntersectionCrosswalks(world, 512, 600, AVENUE_WIDTH, STREET_WIDTH, markRoomId);
  placeSignalCluster(world, 512, 512);
  placeSignalCluster(world, 512, 600);
  placeSignalCluster(world, 680, 512);
  placeSignalCluster(world, 344, 344);
  placeSignalCluster(world, 232, 680);
  dressStreetMotifs(world, sidewalkRoomId, markRoomId);
}

export function getManhattanCrossroadsDebugLines(): string[] {
  return [
    `[FLOOR] route=${MANHATTAN_CROSSROADS_DEBUG.routeId} z=${MANHATTAN_CROSSROADS_DEBUG.z} seed=${MANHATTAN_CROSSROADS_DEBUG.seed}`,
    ...MANHATTAN_CROSSROADS_DEBUG.junctions.map(j => `[FLOOR] junction ${j}`),
    ...MANHATTAN_CROSSROADS_DEBUG.blockers.map(b => `[FLOOR] blocker ${b}`),
    `[FLOOR] smoke ${MANHATTAN_CROSSROADS_DEBUG.smokePath}`,
  ];
}

function rectCells(rect: AuditRect): number[] {
  const cells: number[] = [];
  for (let dy = 0; dy < rect.h; dy++) {
    for (let dx = 0; dx < rect.w; dx++) {
      cells.push((rect.y + dy) * W + rect.x + dx);
    }
  }
  return cells;
}

function countUngatedRectCells(gen: FloorGeneration, rects: readonly AuditRect[], floorTex: Tex): number {
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  let count = 0;
  for (const rect of rects) {
    for (const rawIdx of rectCells(rect)) {
      const x = rawIdx % W;
      const y = (rawIdx / W) | 0;
      const ci = gen.world.idx(x, y);
      if (gen.world.cells[ci] !== Cell.FLOOR) continue;
      if (gen.world.floorTex[ci] !== floorTex) continue;
      if (!audit.reachable[ci] || audit.gateMask[ci] !== REACH_GATE_NONE) continue;
      count++;
    }
  }
  return count;
}

function roomReachableCellCount(gen: FloorGeneration, roomName: string, ungatedOnly = false): number {
  const roomIds = new Set(gen.world.rooms.filter(room => room.name === roomName).map(room => room.id));
  if (roomIds.size === 0) return 0;
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  let count = 0;
  for (let ci = 0; ci < gen.world.cells.length; ci++) {
    if (!roomIds.has(gen.world.roomMap[ci])) continue;
    if (!audit.reachable[ci]) continue;
    if (ungatedOnly && audit.gateMask[ci] !== REACH_GATE_NONE) continue;
    count++;
  }
  return count;
}

function countInventoryItem(generation: FloorGeneration, defId: string, containerTag?: string): number {
  let count = 0;
  for (const container of generation.world.containers) {
    if (containerTag && !container.tags.includes(containerTag)) continue;
    for (const item of container.inventory) {
      if (item.defId === defId) count += item.count;
    }
  }
  if (containerTag) return count;

  for (const entity of generation.entities) {
    if (!entity.alive || !entity.inventory) continue;
    for (const item of entity.inventory) {
      if (item.defId === defId) count += item.count;
    }
  }
  return count;
}

function countNpcsNear(generation: FloorGeneration, x: number, y: number, radius: number): number {
  const r2 = radius * radius;
  let count = 0;
  for (const entity of generation.entities) {
    if (!entity.alive || entity.type !== EntityType.NPC) continue;
    if (generation.world.dist2(entity.x, entity.y, x, y) <= r2) count++;
  }
  return count;
}

function countMonstersInRoom(generation: FloorGeneration, roomName: string): number {
  const roomIds = new Set(generation.world.rooms.filter(room => room.name === roomName).map(room => room.id));
  let count = 0;
  for (const entity of generation.entities) {
    if (!entity.alive || entity.type !== EntityType.MONSTER) continue;
    const ci = generation.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    if (roomIds.has(generation.world.roomMap[ci])) count++;
  }
  return count;
}

export function measureManhattanCrossroadsDecisionMetrics(generation: FloorGeneration): ManhattanCrossroadsDecisionMetrics {
  const tollDoorIdx = generation.world.idx(512, 536);
  const tollDoor = generation.world.doors.get(tollDoorIdx);
  const audit = auditReachability(generation.world, generation.world.idx(Math.floor(generation.spawnX), Math.floor(generation.spawnY)));

  let crosswalkStripeCells = 0;
  for (const rect of CENTRAL_CROSSWALK_AUDIT_RECTS) {
    for (const rawIdx of rectCells(rect)) {
      const x = rawIdx % W;
      const y = (rawIdx / W) | 0;
      const ci = generation.world.idx(x, y);
      if (generation.world.floorTex[ci] !== MARK_TEX) continue;
      if (!audit.reachable[ci] || audit.gateMask[ci] !== REACH_GATE_NONE) continue;
      crosswalkStripeCells++;
    }
  }

  const blockRoomIds = new Set<number>();
  for (const room of generation.world.rooms) {
    if (!room.name.startsWith('Внутренний квартал')) continue;
    blockRoomIds.add(room.id);
  }
  let blockInteriorReachableCells = 0;
  if (blockRoomIds.size > 0) {
    for (let ci = 0; ci < generation.world.cells.length; ci++) {
      if (blockRoomIds.has(generation.world.roomMap[ci]) && audit.reachable[ci]) blockInteriorReachableCells++;
    }
  }

  return {
    crosswalkStripeCells,
    blockInteriorRooms: blockRoomIds.size,
    blockInteriorReachableCells,
    escortNpcPresent: generation.entities.some(entity => entity.plotNpcId === 'crossroads_zebra_granny')
      && generation.entities.some(entity => entity.plotNpcId === 'crossroads_courier_dima'),
    tollDoorLocked: tollDoor?.state === DoorState.LOCKED,
    tollDoorRequiresKey: !!tollDoor && audit.reachable[tollDoorIdx] === 1 && audit.gateMask[tollDoorIdx] === REACH_GATE_KEY,
    tollKeyContainers: generation.world.containers.filter(container =>
      container.tags.includes('toll') && container.inventory.some(item => item.defId === 'key')).length,
    tollQueueNpcs: countNpcsNear(generation, 516.5, 540.5, 34),
    overpassUngatedCells: countUngatedRectCells(generation, OVERPASS_AUDIT_RECTS, OVERPASS_TEX),
    underpassUngatedCells: countUngatedRectCells(generation, UNDERPASS_AUDIT_RECTS, UNDERPASS_TEX),
    controlRoomReachableCells: roomReachableCellCount(generation, CONTROL_ROOM_NAME),
    repairFuseCount: countInventoryItem(generation, 'fuse'),
    cargoRoomReachableCells: roomReachableCellCount(generation, CARGO_ROOM_NAME),
    cargoMetalSheets: countInventoryItem(generation, 'metal_sheet', 'cargo'),
    wrongExitUngatedCells: roomReachableCellCount(generation, WRONG_TURN_ROOM_NAME, true),
    wrongExitMonsters: countMonstersInRoom(generation, WRONG_TURN_ROOM_NAME),
  };
}

export function generateManhattanCrossroadsDesignFloor(seed = MANHATTAN_CROSSROADS_SEED): FloorGeneration {
  return withSeededRandom(seed, () => {
    const rng = new SeedRng(seed);
    const world = new World();
    const entities: Entity[] = [];
    const nextId = { v: 1 };
    const roadRoom = addLogicalRoom(world, 'Асфальтовая сетка авеню', RoomType.CORRIDOR, DISTRICT_MIN, DISTRICT_MIN, DISTRICT_MAX - DISTRICT_MIN, DISTRICT_MAX - DISTRICT_MIN, ROAD_TEX);
    const sidewalkRoom = addLogicalRoom(world, 'Бордюры и служебные края', RoomType.COMMON, DISTRICT_MIN, DISTRICT_MIN, DISTRICT_MAX - DISTRICT_MIN, DISTRICT_MAX - DISTRICT_MIN, SIDEWALK_TEX);
    const markRoom = addLogicalRoom(world, CROSSWALK_ROOM_NAME, RoomType.MEDICAL, DISTRICT_MIN, DISTRICT_MIN, DISTRICT_MAX - DISTRICT_MIN, DISTRICT_MAX - DISTRICT_MIN, MARK_TEX);

    roadRoom.ceilingTier = 198;
    sidewalkRoom.ceilingTier = 198;
    markRoom.ceilingTier = 198;

    carveStreetGrid(world, roadRoom.id, sidewalkRoom.id, markRoom.id);
    const rooms = stampDistrictRooms(world, sidewalkRoom.id);
    placeDistrictLifts(world);

    const spawnX = 512.5;
    const spawnY = 772.5;
    ensureConnectivity(world, spawnX, spawnY);
    sanitizeDoors(world);
    applyZones(world);

    const npcIds = spawnCrossroadsNpcs(rng, world, entities, nextId, rooms);
    seedContainersAndDrops(world, entities, nextId, rooms, npcIds);
    spawnRoadHazards(rng, world, entities, nextId, rooms);

    world.bakeLights();

    for (const room of world.rooms) {
      if (room) room.ceilingTier = 198;
    }

    return { world, entities, spawnX, spawnY };
  });
}
