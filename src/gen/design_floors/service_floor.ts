/* ── Design floor: service_floor — lift machines and staff routes ─ */

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
  type GameState,
  type Item,
  type Room,
  type TerritoryOwner,
  type WorldContainer,
  type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { factionToTerritoryOwner } from '../../data/factions';
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { Spr } from '../../render/sprite_index';
import { publishEvent } from '../../systems/events';
import { placeEmergencyPanel } from '../../systems/emergency_panels';
import { registerRouteCue } from '../../systems/route_cues';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { setTerritoryOwnerAtIndex } from '../../systems/territory';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { stampRoom } from '../shared';
import type { FloorGeneration } from '../floor_manifest';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('service_floor');

export const DESIGN_FLOOR_ID = 'service_floor' as const;
export const SERVICE_FLOOR_Z = -18;
export const SERVICE_FLOOR_BASE_FLOOR = FloorLevel.MAINTENANCE;

const MASTER_SCOPE_TAG = 'service_master_scope';
const LIFT_MACHINE_ROOM = 'Машинный зал лифтовой группы С-15';
const BREAKER_ROOM = 'Щитовая служебного этажа С-15';
const JANITOR_DEPOT = 'Кладовая дежурных ключей С-15';
const VENT_JUNCTION = 'Вентиляционный узел над шахтой С-15';
const STAFF_CANTEEN = 'Столовая ремонтной смены С-15';
const CLERK_OFFICE = 'Запертая диспетчерская рейдов С-15';
const PUMP_RESCUE_ROOM = 'Насосная ниша западного стояка С-15';
const DRAINAGE_BASIN_NW = 'Дренажный бассейн северо-западного кабельного фронта С-15';
const DRAINAGE_BASIN_NE = 'Дренажный бассейн северо-восточного кабельного фронта С-15';
const DRAINAGE_BASIN_SW = 'Дренажный бассейн юго-западного кабельного фронта С-15';
const DRAINAGE_BASIN_SE = 'Дренажный бассейн юго-восточного кабельного фронта С-15';

type ServiceDoorSide = 'north' | 'south' | 'west' | 'east';

interface ServiceRoomDoorSpec {
  side: ServiceDoorSide;
  targetX: number;
  targetY: number;
  state?: DoorState;
  keyId?: string;
}

interface ServiceHqCompoundSpec {
  owner: ZoneFaction;
  label: string;
  corridor: readonly [number, number, number, number];
  route: readonly [number, number, number, number];
  core: readonly [number, number, number, number, ServiceDoorSide, string];
  supportPrefix: string;
}

interface ServiceBayRowSpec {
  label: string;
  owner: ZoneFaction;
  typeSeed: number;
  horizontal: boolean;
  corridor: number;
  start: number;
  end: number;
  side: -1 | 1;
  step: number;
  span: number;
}

const SERVICE_HQ_COMPOUNDS: readonly ServiceHqCompoundSpec[] = [
  {
    owner: ZoneFaction.CITIZEN,
    label: 'Гражданский узел бытового обхода С-15',
    corridor: [92, 270, 202, 270],
    route: [202, 270, 244, 270],
    core: [132, 248, 28, 13, 'south', 'Гражданский гермокор бытового обхода С-15'],
    supportPrefix: 'Гражданский обход С-15',
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    label: 'Главный пост ликвидаторов С-15',
    corridor: [566, 228, 744, 228],
    route: [612, 228, 612, 188],
    core: [638, 206, 34, 13, 'south', 'Гермопост ликвидаторов С-15'],
    supportPrefix: 'Пост ликвидаторов С-15',
  },
  {
    owner: ZoneFaction.SCIENTIST,
    label: 'НИИ-служба измерения шахт С-15',
    corridor: [832, 300, 972, 300],
    route: [780, 300, 832, 300],
    core: [884, 278, 28, 13, 'south', 'Гермолаборатория шахт С-15'],
    supportPrefix: 'НИИ шахт С-15',
  },
  {
    owner: ZoneFaction.CULTIST,
    label: 'Скрытый культовый лаз С-15',
    corridor: [86, 742, 214, 742],
    route: [214, 742, 244, 742],
    core: [138, 720, 28, 13, 'south', 'Скрытый культовый гермолаз С-15'],
    supportPrefix: 'Культовый лаз С-15',
  },
  {
    owner: ZoneFaction.WILD,
    label: 'Дикий разборный лагерь С-15',
    corridor: [830, 744, 972, 744],
    route: [780, 744, 830, 744],
    core: [884, 708, 30, 13, 'south', 'Разбитый гермокор диких С-15'],
    supportPrefix: 'Дикий лагерь С-15',
  },
];

const SERVICE_BAY_ROWS: readonly ServiceBayRowSpec[] = [
  { label: 'Северная кабельная кассета', owner: ZoneFaction.LIQUIDATOR, typeSeed: 0, horizontal: true, corridor: 188, start: 268, end: 424, side: -1, step: 27, span: 12 },
  { label: 'Северный ремонтный шкаф', owner: ZoneFaction.SCIENTIST, typeSeed: 3, horizontal: true, corridor: 188, start: 270, end: 420, side: 1, step: 26, span: 13 },
  { label: 'Северо-восточная кабельная кассета', owner: ZoneFaction.LIQUIDATOR, typeSeed: 5, horizontal: true, corridor: 188, start: 604, end: 744, side: -1, step: 26, span: 12 },
  { label: 'Верхняя венткамера', owner: ZoneFaction.SCIENTIST, typeSeed: 7, horizontal: true, corridor: 324, start: 270, end: 490, side: -1, step: 25, span: 12 },
  { label: 'Пультовая верхнего пролёта', owner: ZoneFaction.LIQUIDATOR, typeSeed: 11, horizontal: true, corridor: 324, start: 542, end: 760, side: -1, step: 25, span: 12 },
  { label: 'Нижняя венткамера', owner: ZoneFaction.WILD, typeSeed: 13, horizontal: true, corridor: 324, start: 270, end: 488, side: 1, step: 28, span: 13 },
  { label: 'Запасной щиток пролёта', owner: ZoneFaction.LIQUIDATOR, typeSeed: 17, horizontal: true, corridor: 324, start: 544, end: 760, side: 1, step: 28, span: 13 },
  { label: 'Западная насосная гряда', owner: ZoneFaction.WILD, typeSeed: 19, horizontal: true, corridor: 700, start: 270, end: 488, side: 1, step: 27, span: 13 },
  { label: 'Восточная насосная гряда', owner: ZoneFaction.LIQUIDATOR, typeSeed: 23, horizontal: true, corridor: 700, start: 544, end: 760, side: 1, step: 27, span: 13 },
  { label: 'Южная кабельная кассета', owner: ZoneFaction.LIQUIDATOR, typeSeed: 29, horizontal: true, corridor: 836, start: 270, end: 424, side: -1, step: 27, span: 12 },
  { label: 'Южный ремонтный шкаф', owner: ZoneFaction.CULTIST, typeSeed: 31, horizontal: true, corridor: 836, start: 270, end: 424, side: 1, step: 27, span: 12 },
  { label: 'Юго-восточная кабельная кассета', owner: ZoneFaction.LIQUIDATOR, typeSeed: 37, horizontal: true, corridor: 836, start: 604, end: 744, side: -1, step: 26, span: 12 },
  { label: 'Южный склад обратного хода', owner: ZoneFaction.WILD, typeSeed: 41, horizontal: true, corridor: 836, start: 604, end: 744, side: 1, step: 26, span: 12 },
  { label: 'Западный вертикальный обход', owner: ZoneFaction.CITIZEN, typeSeed: 43, horizontal: false, corridor: 244, start: 220, end: 804, side: -1, step: 31, span: 22 },
  { label: 'Западная внутренняя полка', owner: ZoneFaction.LIQUIDATOR, typeSeed: 47, horizontal: false, corridor: 244, start: 220, end: 804, side: 1, step: 31, span: 22 },
  { label: 'Центральная левая полка', owner: ZoneFaction.LIQUIDATOR, typeSeed: 53, horizontal: false, corridor: 520, start: 214, end: 806, side: -1, step: 29, span: 19 },
  { label: 'Центральная правая полка', owner: ZoneFaction.SCIENTIST, typeSeed: 59, horizontal: false, corridor: 520, start: 214, end: 806, side: 1, step: 29, span: 19 },
  { label: 'Восточная внутренняя полка', owner: ZoneFaction.LIQUIDATOR, typeSeed: 61, horizontal: false, corridor: 780, start: 220, end: 804, side: -1, step: 31, span: 22 },
  { label: 'Восточный вертикальный обход', owner: ZoneFaction.WILD, typeSeed: 67, horizontal: false, corridor: 780, start: 220, end: 804, side: 1, step: 31, span: 22 },
];

const SERVICE_LIQUIDATOR_OUTPOST_NAMES = [
  'Пост ликвидаторов у западной перемычки С-15',
  'Пост ликвидаторов у восточной перемычки С-15',
  'Караульная нижнего машинного кольца С-15',
] as const;

export type ServiceUtilityDomain = 'lift' | 'power' | 'water' | 'vent';
export type ServiceUtilityFront = 'staff_safe' | 'machine_maze' | 'pressure_basin' | 'route_transfer';
export type ServiceUtilityEdgeKind = 'lift_cable' | 'power_cable' | 'water_pipe' | 'duct';

export interface ServiceUtilityNode {
  id: string;
  domain: ServiceUtilityDomain;
  front: ServiceUtilityFront;
  roomName: string;
  roomId: number;
  x: number;
  y: number;
  panelId?: 'panel_power' | 'panel_water' | 'panel_doors' | 'panel_vent';
}

export interface ServiceUtilityEdge {
  from: string;
  to: string;
  kind: ServiceUtilityEdgeKind;
  risk: 1 | 2 | 3 | 4 | 5;
  clue: string;
}

export interface ServiceDrainageBasin {
  id: string;
  roomName: string;
  roomId: number;
  x: number;
  y: number;
  waterCells: number;
  pressure: 1 | 2 | 3 | 4 | 5;
}

export interface ServiceUtilityGraph {
  routeId: typeof DESIGN_FLOOR_ID;
  nodes: ServiceUtilityNode[];
  edges: ServiceUtilityEdge[];
  drainageBasins: ServiceDrainageBasin[];
}

export type ServiceLiftMachineState = 'faulty' | 'repaired';
export type ServicePowerZoneId = 'machine_hall' | 'breaker_room' | 'staff_route' | 'ventilation';

export interface ServicePowerZoneFlag {
  id: ServicePowerZoneId;
  name: string;
  powered: boolean;
  roomId: number;
}

export interface ServiceRerouteFlags {
  lowerStaffRouteOpen: boolean;
  marketRaidDiverted: boolean;
  productionBypassArmed: boolean;
}

export type ServiceTransferRouteId =
  | 'service_to_production_belt_feed'
  | 'service_to_dark_metro_signal'
  | 'service_to_darkness_light_reserve';

export interface ServiceTransferRoute {
  id: ServiceTransferRouteId;
  label: string;
  sourceRoomName: string;
  targetRouteId: 'production_belt' | 'dark_metro' | 'darkness';
  requiresZone: ServicePowerZoneId;
  routeFlag: keyof ServiceRerouteFlags | 'power';
  clue: string;
}

export interface ServiceFloorState {
  routeId: typeof DESIGN_FLOOR_ID;
  anchorZ: number;
  baseFloor: FloorLevel;
  liftMachineState: ServiceLiftMachineState;
  masterKeyKnown: boolean;
  powerZones: ServicePowerZoneFlag[];
  rerouteFlags: ServiceRerouteFlags;
  transferRoutes: ServiceTransferRoute[];
  scopedDoorIds: number[];
  scopedContainerIds: number[];
  debugEntry: {
    spawnX: number;
    spawnY: number;
    summary: string;
  };
}

export interface ServiceFloorGeneration extends FloorGeneration {
  serviceState: ServiceFloorState;
}

export interface ServiceFloorExpansionStyle {
  wallTex: Tex;
  floorTex: Tex;
}

export const SERVICE_FLOOR_MASTER_SCOPE = {
  tag: MASTER_SCOPE_TAG,
  rooms: [JANITOR_DEPOT, CLERK_OFFICE],
  note: 'Scoped to recorded Service Floor doors and containers only; it does not use the generic key door path.',
} as const;

export const SERVICE_TRANSFER_ROUTES: readonly ServiceTransferRoute[] = [
  {
    id: 'service_to_production_belt_feed',
    label: 'Обход питания к Производственному поясу',
    sourceRoomName: LIFT_MACHINE_ROOM,
    targetRouteId: 'production_belt',
    requiresZone: 'machine_hall',
    routeFlag: 'productionBypassArmed',
    clue: 'После ремонта С-15 нижний персональный коридор принимает дверь-комплекты и энергоячейки с Пояса.',
  },
  {
    id: 'service_to_dark_metro_signal',
    label: 'Сигнальный лаз в Темную пересадку',
    sourceRoomName: VENT_JUNCTION,
    targetRouteId: 'dark_metro',
    requiresZone: 'ventilation',
    routeFlag: 'power',
    clue: 'Запитанная вентиляция дает короткий путь к стрелочной будке метро, но зовет ламповых.',
  },
  {
    id: 'service_to_darkness_light_reserve',
    label: 'Резерв аварийного света для позднего маршрута',
    sourceRoomName: BREAKER_ROOM,
    targetRouteId: 'darkness',
    requiresZone: 'breaker_room',
    routeFlag: 'power',
    clue: 'Релейная схема может уйти в поздний световой карман вместо местного комфорта.',
  },
];

const serviceUtilityGraphs = new WeakMap<World, ServiceUtilityGraph>();

export function getServiceUtilityGraph(world: World): ServiceUtilityGraph | undefined {
  const graph = serviceUtilityGraphs.get(world);
  if (!graph) return undefined;
  return {
    routeId: graph.routeId,
    nodes: graph.nodes.map(node => ({ ...node })),
    edges: graph.edges.map(edge => ({ ...edge })),
    drainageBasins: graph.drainageBasins.map(basin => ({ ...basin })),
  };
}

function ensureServiceUtilityGraph(world: World): ServiceUtilityGraph {
  let graph = serviceUtilityGraphs.get(world);
  if (!graph) {
    graph = { routeId: DESIGN_FLOOR_ID, nodes: [], edges: [], drainageBasins: [] };
    serviceUtilityGraphs.set(world, graph);
  }
  return graph;
}

function registerUtilityNode(
  world: World,
  room: Room,
  id: string,
  domain: ServiceUtilityDomain,
  front: ServiceUtilityFront,
  panelId?: ServiceUtilityNode['panelId'],
): void {
  const graph = ensureServiceUtilityGraph(world);
  if (graph.nodes.some(node => node.id === id)) return;
  graph.nodes.push({
    id,
    domain,
    front,
    roomName: room.name,
    roomId: room.id,
    x: room.x + room.w / 2,
    y: room.y + room.h / 2,
    panelId,
  });
}

function registerUtilityEdge(
  world: World,
  from: string,
  to: string,
  kind: ServiceUtilityEdgeKind,
  risk: ServiceUtilityEdge['risk'],
  clue: string,
): void {
  const graph = ensureServiceUtilityGraph(world);
  if (graph.edges.some(edge => edge.from === from && edge.to === to && edge.kind === kind)) return;
  graph.edges.push({ from, to, kind, risk, clue });
}

function registerDrainageBasin(
  world: World,
  room: Room,
  id: string,
  pressure: ServiceDrainageBasin['pressure'],
): void {
  const graph = ensureServiceUtilityGraph(world);
  if (graph.drainageBasins.some(basin => basin.id === id)) return;
  let waterCells = 0;
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[idx] === room.id && world.cells[idx] === Cell.WATER) waterCells++;
    }
  }
  graph.drainageBasins.push({
    id,
    roomName: room.name,
    roomId: room.id,
    x: room.x + room.w / 2,
    y: room.y + room.h / 2,
    waterCells,
    pressure,
  });
}

const BORIS_DEF: PlotNpcDef = {
  name: 'Борис Лифтёр',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.MECHANIC,
  sprite: Occupation.MECHANIC,
  hp: 170, maxHp: 170, money: 95, speed: 1.0,
  inventory: [
    { defId: 'wrench', count: 1 },
    { defId: 'lift_scheme', count: 1 },
    { defId: 'fuse', count: 1 },
  ],
  talkLines: [
    'Машина С-15 тянет кабину честно, а маршрут врёт. Если поменять предохранители, лифт хотя бы перестанет выбирать нижний этаж наугад.',
    'Я чиню не лифт целиком. Только маленькое право доехать туда, куда нажал.',
    'Служебный ключ не открывает мир. Он открывает две двери, за которые я потом отвечаю.',
  ],
  talkLinesPost: [
    'Маршрут держит. Не навсегда, но достаточно, чтобы успеть пожалеть о поездке.',
    'Если кнопка молчит, слушай реле. Реле врёт тише человека.',
  ],
};

const NADYA_DEF: PlotNpcDef = {
  name: 'Надя Ключница',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 115, maxHp: 115, money: 65, speed: 0.95,
  inventory: [
    { defId: 'inspection_mirror', count: 1 },
    { defId: 'sealant_tube', count: 1 },
    { defId: 'cigs', count: 1 },
  ],
  talkLines: [
    'Мастер-ключ тут не главный. Главный тот, кто знает, какие две двери в ведомости, а какие придумали жильцы.',
    'Кладовая моя. Возьмёшь без спроса — шум пойдёт по трубам раньше тебя.',
    'Вентиляция ведёт быстро, если не боишься того, что питается светом.',
  ],
  talkLinesPost: [
    'Теперь ты знаешь малый круг. За большой круг людей списывают.',
    'Не показывай допуск в Министерстве. Они спросят, почему он полезный.',
  ],
};

const ROMA_DEF: PlotNpcDef = {
  name: 'Рома Щитовой',
  isFemale: false,
  faction: Faction.SCIENTIST,
  occupation: Occupation.ELECTRICIAN,
  sprite: Occupation.ELECTRICIAN,
  hp: 125, maxHp: 125, money: 80, speed: 1.0,
  inventory: [
    { defId: 'relay_diagram', count: 1 },
    { defId: 'fuse', count: 2 },
    { defId: 'flashlight', count: 1 },
  ],
  talkLines: [
    'Свет можно вернуть на один маршрут. На все нельзя: дом решит, что мы вызываем его наружу.',
    'Ламповый ест яркое. Поэтому я чиню темноту аккуратно.',
    'Если щитовая хлопнет во время самосбора, двери станут мнением.',
  ],
  talkLinesPost: [
    'Один контур горит. Второй пусть стыдится в темноте.',
    'Не стой под новой лампой слишком долго. Она теперь пахнет тобой.',
  ],
};

const CLERK_DEF: PlotNpcDef = {
  name: 'Павел Без Пропуска',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 100, maxHp: 100, money: 40, speed: 0.9,
  inventory: [
    { defId: 'elevator_override_form', count: 1 },
    { defId: 'official_permit_slip', count: 1 },
  ],
  talkLines: [
    'Меня заперли снаружи моего же журнала. Там рейдовая очередь, и она уже почти дошла до рынка.',
    'Переставь форму обхода — рейд пойдёт первым в пустой коридор, а не к людям.',
    'Это не спасение. Это перенос ошибки на адрес, где пока никто не расписался.',
  ],
  talkLinesPost: [
    'Журнал поменял очередь. Теперь он делает вид, что сам так решил.',
    'Если спросят, меня тут не было. Я всё ещё заперт, просто с другой стороны.',
  ],
};

const MITKA_DEF: PlotNpcDef = {
  name: 'Митя Насосный',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.LOCKSMITH,
  sprite: Occupation.LOCKSMITH,
  hp: 135, maxHp: 135, money: 55, speed: 0.98,
  inventory: [
    { defId: 'valve_tag', count: 1 },
    { defId: 'sealant_tube', count: 1 },
    { defId: 'gasmask_filter', count: 1 },
  ],
  talkLines: [
    'Насос держит пол на честном слове. Если дать обратный напор, коридор станет мокрым, зато угри уйдут в трубу.',
    'Я не герой. Я просто знаю, какой вентиль не трогать во время сирены.',
    'Вытащи меня до следующего щелчка, и бирку давления заберешь без рапорта.',
  ],
  talkLinesPost: [
    'Западный стояк дышит ровно. Восточный врёт, но хотя бы по расписанию.',
    'Если щиток воды ругается, не спорь с ним лицом.',
  ],
};

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'service_liftmaster_boris', BORIS_DEF, [
  {
    id: 'service_fix_lift_machine',
    giverNpcId: 'service_liftmaster_boris',
    type: QuestType.FETCH,
    desc: 'Борис: «Три предохранителя в машинный зал С-15. Починим не весь лифт, а маленькое право доехать по кнопке.»',
    targetItem: 'fuse', targetCount: 3,
    rewardItem: 'lift_scheme', rewardCount: 1,
    extraRewards: [{ defId: 'gear', count: 1 }, { defId: 'elevator_override_form', count: 1 }],
    relationDelta: 14, xpReward: 90, moneyReward: 85,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'service_janitor_nadya', NADYA_DEF, [
  {
    id: 'service_steal_master_key',
    giverNpcId: 'service_janitor_nadya',
    type: QuestType.VISIT,
    desc: 'Надя: «Зайди в кладовую С-15 и посмотри ведомость малого круга. Мастер-ключ тут означает ровно две двери.»',
    targetRoomName: JANITOR_DEPOT,
    rewardItem: 'door_kit', rewardCount: 1,
    extraRewards: [{ defId: 'inspection_mirror', count: 1 }],
    relationDelta: 10, xpReward: 60, moneyReward: 45,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'service_electrician_roma', ROMA_DEF, [
  {
    id: 'service_restore_lights',
    giverNpcId: 'service_electrician_roma',
    type: QuestType.FETCH,
    desc: 'Рома: «Неси релейную схему. Поднимем свет на одном маршруте, а не устроим ламповым столовую.»',
    targetItem: 'relay_diagram', targetCount: 1,
    rewardItem: 'flashlight', rewardCount: 1,
    extraRewards: [{ defId: 'gasmask_filter', count: 1 }, { defId: 'fuse', count: 1 }],
    relationDelta: 12, xpReward: 75, moneyReward: 70,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'service_locked_out_clerk', CLERK_DEF, [
  {
    id: 'service_reroute_raid',
    giverNpcId: 'service_locked_out_clerk',
    type: QuestType.FETCH,
    desc: 'Павел: «Бланк обхода в диспетчерскую С-15. Рейдовую очередь отправят в пустой коридор, если печать пройдет у диспетчера.»',
    targetItem: 'elevator_override_form', targetCount: 1,
    rewardItem: 'official_permit_slip', rewardCount: 1,
    extraRewards: [{ defId: 'ammo_9mm', count: 12 }],
    relationDelta: 8, xpReward: 80, moneyReward: 95,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'service_trapped_pump_worker', MITKA_DEF, [
  {
    id: 'service_rescue_pump_worker',
    giverNpcId: 'service_trapped_pump_worker',
    type: QuestType.VISIT,
    desc: 'Митя: «Западная насосная ниша С-15 захлопнулась. Вытащи меня из стояка, пока обратный напор не позвал трубных.»',
    targetRoomName: PUMP_RESCUE_ROOM,
    rewardItem: 'valve_tag', rewardCount: 1,
    extraRewards: [{ defId: 'sealant_tube', count: 1 }, { defId: 'gasmask_filter', count: 1 }],
    relationDelta: 9, xpReward: 85, moneyReward: 60,
  },
]);

export function createServiceFloorState(): ServiceFloorState {
  return {
    routeId: DESIGN_FLOOR_ID,
    anchorZ: SERVICE_FLOOR_Z,
    baseFloor: SERVICE_FLOOR_BASE_FLOOR,
    liftMachineState: 'faulty',
    masterKeyKnown: false,
    powerZones: [],
    rerouteFlags: {
      lowerStaffRouteOpen: false,
      marketRaidDiverted: false,
      productionBypassArmed: false,
    },
    transferRoutes: SERVICE_TRANSFER_ROUTES.map(route => ({ ...route })),
    scopedDoorIds: [],
    scopedContainerIds: [],
    debugEntry: {
      spawnX: 416.5,
      spawnY: 514.5,
      summary: 'service_floor z=-18 spawn at west service lift; east lift is reachable through the staff corridor.',
    },
  };
}

export function summarizeServiceFloorFlags(service: ServiceFloorState): string[] {
  const powered = service.powerZones
    .filter(z => z.powered)
    .map(z => z.id)
    .join(',') || 'none';
  return [
    `route=${service.routeId} z=${service.anchorZ} base=${FloorLevel[service.baseFloor]}`,
    `liftMachine=${service.liftMachineState} masterKeyKnown=${service.masterKeyKnown}`,
    `power=${powered}`,
    `reroute lower=${service.rerouteFlags.lowerStaffRouteOpen} marketRaidDiverted=${service.rerouteFlags.marketRaidDiverted} productionBypass=${service.rerouteFlags.productionBypassArmed}`,
    `transfers=${service.transferRoutes.map(route => `${route.id}:${route.targetRouteId}`).join(',') || 'none'}`,
    `scope doors=${service.scopedDoorIds.length} containers=${service.scopedContainerIds.length}`,
  ];
}

export function applyServiceMasterKeyScope(world: World, service: ServiceFloorState): { doors: number; containers: number } {
  let doors = 0;
  let containers = 0;
  for (const id of service.scopedDoorIds) {
    const door = world.doors.get(id);
    if (!door || door.state !== DoorState.LOCKED) continue;
    door.state = DoorState.CLOSED;
    door.keyId = '';
    doors++;
  }
  for (const id of service.scopedContainerIds) {
    const container = world.containerById.get(id);
    if (!container || !container.tags.includes(MASTER_SCOPE_TAG)) continue;
    if (container.access !== 'room') {
      container.access = 'room';
      container.discovered = true;
      containers++;
    }
  }
  return { doors, containers };
}

export function learnServiceMasterKey(game: GameState, world: World, service: ServiceFloorState): WorldEvent {
  service.masterKeyKnown = true;
  const changed = applyServiceMasterKeyScope(world, service);
  return publishEvent(game, {
    type: 'door_opened',
    floor: game.currentFloor,
    severity: 3,
    privacy: 'local',
    tags: ['service_floor', 'master_key_scope', 'access_flag'],
    data: {
      routeId: service.routeId,
      scopeTag: MASTER_SCOPE_TAG,
      changedDoors: changed.doors,
      changedContainers: changed.containers,
    },
  });
}

export function repairServiceLiftMachine(game: GameState, service: ServiceFloorState): WorldEvent {
  service.liftMachineState = 'repaired';
  service.rerouteFlags.lowerStaffRouteOpen = true;
  service.rerouteFlags.productionBypassArmed = true;
  return publishEvent(game, {
    type: 'elevator_loop_exit',
    floor: game.currentFloor,
    severity: 4,
    privacy: 'local',
    tags: ['service_floor', 'lift_machine', 'repair', 'route_flag'],
    data: {
      routeId: service.routeId,
      anchorZ: service.anchorZ,
      liftMachineState: service.liftMachineState,
      lowerStaffRouteOpen: service.rerouteFlags.lowerStaffRouteOpen,
      productionBypassArmed: service.rerouteFlags.productionBypassArmed,
      transferRoutes: service.transferRoutes
        .filter(route => route.targetRouteId === 'production_belt')
        .map(route => route.id),
    },
  });
}

export function restoreServicePowerZone(
  game: GameState,
  service: ServiceFloorState,
  zoneId: ServicePowerZoneId,
): WorldEvent {
  for (const zone of service.powerZones) {
    if (zone.id === zoneId) zone.powered = true;
  }
  return publishEvent(game, {
    type: 'room_produced_items',
    floor: game.currentFloor,
    severity: 3,
    privacy: 'local',
    tags: ['service_floor', 'power', 'light_route'],
    data: {
      routeId: service.routeId,
      powerZone: zoneId,
      powered: true,
      transferRoutes: service.transferRoutes
        .filter(route => route.requiresZone === zoneId)
        .map(route => route.id),
    },
  });
}

export function rerouteServiceRaid(game: GameState, service: ServiceFloorState): WorldEvent {
  service.rerouteFlags.marketRaidDiverted = true;
  return publishEvent(game, {
    type: 'faction_patrol_clash',
    floor: game.currentFloor,
    severity: 4,
    privacy: 'local',
    tags: ['service_floor', 'raid', 'reroute_flag'],
    data: {
      routeId: service.routeId,
      marketRaidDiverted: service.rerouteFlags.marketRaidDiverted,
    },
  });
}

export function generateServiceFloorDesignFloor(): ServiceFloorGeneration {
  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 1 };
  const serviceState = createServiceFloorState();

  for (let i = 0; i < W * W; i++) {
    world.wallTex[i] = Tex.METAL;
    world.floorTex[i] = Tex.F_CONCRETE;
  }

  carveStaffRoute(world, 430, 512, 190, 5);
  carveStaffRoute(world, 520, 478, 5, 82);
  carveStaffRoute(world, 458, 504, 112, 3);
  carveStaffRoute(world, 478, 538, 84, 3);

  const westLift = stampServiceRoom(world, RoomType.CORRIDOR, 410, 508, 15, 12, 'Западный служебный лифт С-15', Tex.LIFT_DOOR, Tex.F_CONCRETE);
  const eastLift = stampServiceRoom(world, RoomType.CORRIDOR, 625, 508, 15, 12, 'Восточный служебный лифт С-15', Tex.LIFT_DOOR, Tex.F_CONCRETE);
  const machine = stampServiceRoom(world, RoomType.PRODUCTION, 488, 486, 30, 19, LIFT_MACHINE_ROOM, Tex.PIPE, Tex.F_CONCRETE);
  const breaker = stampServiceRoom(world, RoomType.PRODUCTION, 470, 526, 22, 15, BREAKER_ROOM, Tex.METAL, Tex.F_TILE);
  const janitor = stampServiceRoom(world, RoomType.STORAGE, 438, 526, 20, 13, JANITOR_DEPOT, Tex.PANEL, Tex.F_LINO);
  const vent = stampServiceRoom(world, RoomType.CORRIDOR, 536, 486, 24, 17, VENT_JUNCTION, Tex.DARK, Tex.F_CONCRETE);
  const canteen = stampServiceRoom(world, RoomType.KITCHEN, 548, 526, 28, 16, STAFF_CANTEEN, Tex.TILE_W, Tex.F_TILE);
  const clerk = stampServiceRoom(world, RoomType.OFFICE, 584, 494, 22, 13, CLERK_OFFICE, Tex.MARBLE, Tex.F_PARQUET);

  connectRoomRight(world, westLift, 430, 514, DoorState.CLOSED);
  connectRoomLeft(world, eastLift, 619, 514, DoorState.CLOSED);
  connectRoomDown(world, machine, 503, 512, DoorState.CLOSED);
  connectRoomUp(world, breaker, 482, 516, DoorState.CLOSED);
  const janitorDoor = connectRoomUp(world, janitor, 448, 516, DoorState.LOCKED);
  connectRoomDown(world, vent, 548, 512, DoorState.CLOSED);
  connectRoomUp(world, canteen, 562, 516, DoorState.CLOSED);
  const clerkDoor = connectRoomDown(world, clerk, 595, 512, DoorState.LOCKED);
  serviceState.scopedDoorIds.push(janitorDoor, clerkDoor);

  placeLift(world, westLift.x + 4, westLift.y + 6, LiftDirection.UP);
  placeLift(world, eastLift.x + eastLift.w - 5, eastLift.y + 6, LiftDirection.DOWN);

  dressCorridors(world);
  dressLiftMachine(world, machine);
  dressBreakerRoom(world, breaker);
  dressJanitorDepot(world, janitor);
  dressVentJunction(world, vent);
  dressCanteen(world, canteen);
  dressClerkOffice(world, clerk);

  generateServiceZones(world, [westLift, eastLift, machine, breaker, janitor, vent, canteen, clerk]);

  const borisId = spawnPlotNpc(entities, nextId, 'service_liftmaster_boris', BORIS_DEF, machine.x + 6, machine.y + 12, Math.PI);
  const romaId = spawnPlotNpc(entities, nextId, 'service_electrician_roma', ROMA_DEF, breaker.x + 5, breaker.y + 8, Math.PI / 2);
  const nadyaId = spawnPlotNpc(entities, nextId, 'service_janitor_nadya', NADYA_DEF, canteen.x + 5, canteen.y + 10, 0);
  spawnPlotNpc(entities, nextId, 'service_locked_out_clerk', CLERK_DEF, clerk.x - 3, 514, 0);

  addServiceContainer(world, machine, machine.x + machine.w - 3, machine.y + 3, ContainerKind.TOOL_LOCKER, 'Шкаф Бориса у лифтовой машины', 'owner', [
    { defId: 'fuse', count: 2 },
    { defId: 'gear', count: 1 },
    { defId: 'lift_scheme', count: 1 },
    { defId: 'wrench', count: 1 },
  ], borisId, BORIS_DEF.name, ['service_floor', 'lift_machine', 'repair']);

  addServiceContainer(world, breaker, breaker.x + breaker.w - 4, breaker.y + 3, ContainerKind.METAL_CABINET, 'Щитовой шкаф Ромы', 'owner', [
    { defId: 'relay_diagram', count: 1 },
    { defId: 'fuse', count: 2 },
    { defId: 'circuit_board', count: 1 },
  ], romaId, ROMA_DEF.name, ['service_floor', 'power']);

  const janitorContainer = addServiceContainer(world, janitor, janitor.x + 3, janitor.y + 3, ContainerKind.TOOL_LOCKER, 'Ведомость малого круга ключей', 'owner', [
    { defId: 'door_kit', count: 1 },
    { defId: 'inspection_mirror', count: 1 },
    { defId: 'sealant_tube', count: 2 },
    { defId: 'flashlight', count: 1 },
  ], nadyaId, NADYA_DEF.name, ['service_floor', MASTER_SCOPE_TAG, 'janitor']);

  const clerkContainer = addServiceContainer(world, clerk, clerk.x + clerk.w - 3, clerk.y + 3, ContainerKind.FILING_CABINET, 'Рейдовый журнал С-15', 'locked', [
    { defId: 'elevator_override_form', count: 1 },
    { defId: 'official_permit_slip', count: 2 },
    { defId: 'ration_registry_extract', count: 1 },
  ], undefined, undefined, ['service_floor', MASTER_SCOPE_TAG, 'raid']);

  serviceState.scopedContainerIds.push(janitorContainer.id, clerkContainer.id);

  addServiceContainer(world, canteen, canteen.x + canteen.w - 4, canteen.y + 4, ContainerKind.FRIDGE, 'Холодильник ремонтной смены', 'room', [
    { defId: 'water', count: 2 },
    { defId: 'bread', count: 1 },
    { defId: 'canned', count: 1 },
  ], undefined, undefined, ['service_floor', 'food']);

  dropItems(world, entities, nextId, machine, ['fuse', 'gear', 'sealant_tube']);
  dropItems(world, entities, nextId, breaker, ['fuse', 'relay_diagram']);
  dropItems(world, entities, nextId, vent, ['gasmask_filter', 'ammo_energy']);
  dropItems(world, entities, nextId, canteen, ['water', 'bread']);

  spawnMonsterPack(world, entities, nextId, vent.x + 12, vent.y + 8, [MonsterKind.LAMPOVY, MonsterKind.ROBOT, MonsterKind.REBAR]);
  spawnMonsterPack(world, entities, nextId, eastLift.x + 4, eastLift.y + 6, [MonsterKind.ROBOT, MonsterKind.SBORKA]);

  serviceState.powerZones = [
    { id: 'machine_hall', name: LIFT_MACHINE_ROOM, powered: true, roomId: machine.id },
    { id: 'breaker_room', name: BREAKER_ROOM, powered: false, roomId: breaker.id },
    { id: 'staff_route', name: 'Служебный коридор С-15', powered: true, roomId: -1 },
    { id: 'ventilation', name: VENT_JUNCTION, powered: false, roomId: vent.id },
  ];

  registerServiceBaseUtilityGraph(world, {
    westLift,
    eastLift,
    machine,
    breaker,
    janitor,
    vent,
    canteen,
    clerk,
  });
  registerServiceRouteCues(world, serviceState, machine, breaker, vent, eastLift);
  placeServiceFloorEmergencyPanels(world);

  world.bakeLights();
  return {
    world,
    entities,
    spawnX: serviceState.debugEntry.spawnX,
    spawnY: serviceState.debugEntry.spawnY,
    serviceState,
  };
}

function registerServiceRouteCues(
  world: World,
  service: ServiceFloorState,
  machine: Room,
  breaker: Room,
  vent: Room,
  eastLift: Room,
): void {
  const productionRoute = service.transferRoutes.find(route => route.id === 'service_to_production_belt_feed');
  if (productionRoute) {
    const markerX = machine.x + 5.5;
    const markerY = machine.y + 5.5;
    const targetX = eastLift.x + eastLift.w - 5 + 0.5;
    const targetY = eastLift.y + 6.5;
    const markerCell = world.idx(Math.floor(markerX), Math.floor(markerY));
    registerRouteCue(world, {
      id: productionRoute.id,
      x: markerX,
      y: markerY,
      targetX,
      targetY,
      floor: SERVICE_FLOOR_BASE_FLOOR,
      roomId: machine.id,
      targetRoomId: eastLift.id,
      zoneId: world.zoneMap[markerCell],
      label: 'производственный обход',
      hint: 'лебедка С-15 тянет к восточному служебному лифту',
      targetName: productionRoute.label,
      color: '#8cf',
      tags: ['service_floor', 'production_belt', 'shortcut', 'repair'],
      toneSeed: machine.id * 811 + eastLift.id,
      radius: 9,
      targetRadius: 3,
      cooldownSec: 34,
      heardText: 'Лебедка С-15 стучит в сторону Производственного пояса. Ремонт открывает короткий персональный ход.',
      followedText: 'Восточный служебный лифт найден. После ремонта он станет обходом к производственной выдаче.',
      ignoredText: 'Лебедка С-15 стихла за спиной. Производственный обход остался не проверен.',
    });
  }

  const metroRoute = service.transferRoutes.find(route => route.id === 'service_to_dark_metro_signal');
  if (metroRoute) {
    const markerX = vent.x + vent.w - 4 + 0.5;
    const markerY = vent.y + 2.5;
    const targetX = vent.x + 3.5;
    const targetY = vent.y + vent.h - 4 + 0.5;
    const markerCell = world.idx(Math.floor(markerX), Math.floor(markerY));
    registerRouteCue(world, {
      id: metroRoute.id,
      x: markerX,
      y: markerY,
      targetX,
      targetY,
      floor: SERVICE_FLOOR_BASE_FLOOR,
      roomId: vent.id,
      targetRoomId: vent.id,
      zoneId: world.zoneMap[markerCell],
      label: 'метро-сигнал',
      hint: 'темный воздух ведет к стрелочной будке',
      targetName: metroRoute.label,
      color: '#79f',
      tags: ['service_floor', 'dark_metro', 'transfer', 'warning'],
      toneSeed: vent.id * 823 + breaker.id,
      radius: 8,
      targetRadius: 3,
      cooldownSec: 38,
      heardText: 'Вентиляция отвечает метро-сигналом: короткий путь возможен, если вернуть питание контуру.',
      followedText: 'Вентиляционный лаз найден. Он обещает Темную пересадку и предупреждает о ламповых.',
      ignoredText: 'Метро-сигнал ушел в вентиляцию. Короткий лаз остался темным.',
    });
  }

  const darknessRoute = service.transferRoutes.find(route => route.id === 'service_to_darkness_light_reserve');
  if (darknessRoute) {
    const markerX = breaker.x + breaker.w - 4 + 0.5;
    const markerY = breaker.y + 5.5;
    const targetX = breaker.x + 3.5;
    const targetY = breaker.y + breaker.h - 3 + 0.5;
    const markerCell = world.idx(Math.floor(markerX), Math.floor(markerY));
    registerRouteCue(world, {
      id: darknessRoute.id,
      x: markerX,
      y: markerY,
      targetX,
      targetY,
      floor: SERVICE_FLOOR_BASE_FLOOR,
      roomId: breaker.id,
      targetRoomId: breaker.id,
      zoneId: world.zoneMap[markerCell],
      label: 'резерв света',
      hint: 'щитовая держит поздний световой запас',
      targetName: darknessRoute.label,
      color: '#bbf',
      tags: ['service_floor', 'darkness', 'transfer', 'light'],
      toneSeed: breaker.id * 829 + vent.id,
      radius: 8,
      targetRadius: 2.8,
      cooldownSec: 42,
      heardText: 'Щитовая щелкает поздним резервом: схему можно потратить здесь или оставить для нижнего маршрута.',
      followedText: 'Релейный резерв найден. Это будущий световой карман, если не израсходовать его на месте.',
      ignoredText: 'Резерв света остался в щитовой. Поздний маршрут будет темнее.',
    });
  }
}

function registerServiceBaseUtilityGraph(
  world: World,
  rooms: {
    westLift: Room;
    eastLift: Room;
    machine: Room;
    breaker: Room;
    janitor: Room;
    vent: Room;
    canteen: Room;
    clerk: Room;
  },
): void {
  const graph: ServiceUtilityGraph = { routeId: DESIGN_FLOOR_ID, nodes: [], edges: [], drainageBasins: [] };
  serviceUtilityGraphs.set(world, graph);
  registerUtilityNode(world, rooms.westLift, 'west_service_lift', 'lift', 'staff_safe', 'panel_doors');
  registerUtilityNode(world, rooms.eastLift, 'east_service_lift', 'lift', 'route_transfer');
  registerUtilityNode(world, rooms.machine, 'lift_machine_front', 'lift', 'machine_maze', 'panel_doors');
  registerUtilityNode(world, rooms.breaker, 'breaker_power_front', 'power', 'staff_safe', 'panel_power');
  registerUtilityNode(world, rooms.vent, 'vent_signal_front', 'vent', 'route_transfer', 'panel_vent');
  registerUtilityNode(world, rooms.janitor, 'janitor_key_front', 'lift', 'staff_safe');
  registerUtilityNode(world, rooms.canteen, 'crew_safe_front', 'water', 'staff_safe');
  registerUtilityNode(world, rooms.clerk, 'raid_reroute_front', 'power', 'route_transfer');

  registerUtilityEdge(world, 'west_service_lift', 'lift_machine_front', 'lift_cable', 2, 'Западный лифт кормит машинный зал через открытый персональный ход.');
  registerUtilityEdge(world, 'lift_machine_front', 'east_service_lift', 'lift_cable', 3, 'Восточный служебный лифт становится производственным обходом после ремонта.');
  registerUtilityEdge(world, 'breaker_power_front', 'lift_machine_front', 'power_cable', 2, 'Щитовая питает реле лебедки и аварийный дверной контур.');
  registerUtilityEdge(world, 'breaker_power_front', 'vent_signal_front', 'power_cable', 3, 'Запитанная вентиляция открывает темный сигнальный лаз.');
  registerUtilityEdge(world, 'janitor_key_front', 'raid_reroute_front', 'duct', 2, 'Кладовая и диспетчерская входят в малый круг служебного ключа.');
  registerUtilityEdge(world, 'crew_safe_front', 'breaker_power_front', 'water_pipe', 1, 'Столовая держит безопасный бытовой стояк рядом со щитовой.');
}

export function expandServiceFloorMachineMaze(
  world: World,
  rng: () => number,
  style: ServiceFloorExpansionStyle,
  entities?: Entity[],
): void {
  const staffTex = style.floorTex;
  const ductTex = Tex.F_ABYSS;
  const staffWall = style.wallTex;

  carveServiceRun(world, 244, 188, 780, 188, 5, staffTex, staffWall);
  carveServiceRun(world, 244, 836, 780, 836, 5, staffTex, staffWall);
  carveServiceRun(world, 244, 188, 244, 836, 5, staffTex, staffWall);
  carveServiceRun(world, 780, 188, 780, 836, 5, staffTex, staffWall);
  carveServiceRun(world, 244, 514, 408, 514, 5, staffTex, staffWall);
  carveServiceRun(world, 641, 514, 780, 514, 5, staffTex, staffWall);
  carveServiceRun(world, 520, 188, 520, 836, 5, staffTex, staffWall);
  carveServiceRun(world, 244, 324, 780, 324, 3, staffTex, staffWall);
  carveServiceRun(world, 244, 700, 780, 700, 3, staffTex, staffWall);

  const westLift = findServiceRoom(world, 'Западный служебный лифт С-15');
  if (westLift) connectRoomLeft(world, westLift, 244, 514, DoorState.CLOSED);
  const eastLift = findServiceRoom(world, 'Восточный служебный лифт С-15');
  if (eastLift) connectRoomRight(world, eastLift, 780, 514, DoorState.CLOSED);

  const cores = [
    stampMachineCore(world, 160, 170, 58, 36, 'Северо-западное лифтовое ядро С-15', 244, 'right'),
    stampMachineCore(world, 806, 170, 58, 36, 'Северо-восточное лифтовое ядро С-15', 780, 'left'),
    stampMachineCore(world, 160, 818, 60, 38, 'Юго-западное лифтовое ядро С-15', 244, 'right'),
    stampMachineCore(world, 804, 818, 60, 38, 'Юго-восточное лифтовое ядро С-15', 780, 'left'),
    stampMachineCore(world, 456, 140, 128, 34, 'Верхняя лебедочная галерея С-15', 188, 'down'),
    stampMachineCore(world, 448, 860, 128, 34, 'Нижняя лебедочная галерея С-15', 836, 'up'),
  ];

  for (let i = 0; i < cores.length; i++) {
    dressMachineCore(world, cores[i], i);
  }

  const booths = [
    stampControlBooth(world, 235, 142, 'Пульт северо-западного обхода С-15', 244, 188, 'down'),
    stampControlBooth(world, 758, 142, 'Пульт северо-восточного обхода С-15', 780, 188, 'down'),
    stampControlBooth(world, 235, 810, 'Пульт нижнего западного обхода С-15', 244, 836, 'down'),
    stampControlBooth(world, 758, 810, 'Пульт нижнего восточного обхода С-15', 780, 836, 'down'),
    stampControlBooth(world, 496, 226, 'Пост наблюдения над шахтами С-15', 520, 226, 'right'),
    stampControlBooth(world, 496, 762, 'Пост учета кабельных потерь С-15', 520, 762, 'right'),
  ];
  for (const booth of booths) dressControlBooth(world, booth);

  const pumps = [
    stampPumpAlcove(world, 304, 666, 46, 28, PUMP_RESCUE_ROOM, 700, 'down'),
    stampPumpAlcove(world, 674, 666, 46, 28, 'Насосная ниша восточного стояка С-15', 700, 'down'),
    stampPumpAlcove(world, 302, 274, 46, 28, 'Компрессорный карман западной шахты С-15', 324, 'down'),
    stampPumpAlcove(world, 676, 274, 46, 28, 'Компрессорный карман восточной шахты С-15', 324, 'down'),
  ];
  for (const pump of pumps) dressPumpAlcove(world, pump);
  if (entities) spawnServicePumpRescue(world, entities, pumps[0]);

  const basins = [
    stampPressureBasin(world, 360, 394, 54, 34, DRAINAGE_BASIN_NW, 438, 'down'),
    stampPressureBasin(world, 610, 394, 54, 34, DRAINAGE_BASIN_NE, 438, 'down'),
    stampPressureBasin(world, 360, 602, 54, 34, DRAINAGE_BASIN_SW, 590, 'up'),
    stampPressureBasin(world, 610, 602, 54, 34, DRAINAGE_BASIN_SE, 590, 'up'),
  ];
  for (let i = 0; i < basins.length; i++) dressPressureBasin(world, basins[i], rng, i);
  if (entities) seedServiceBasinLoot(world, entities, basins);

  carveDuctBypass(world, 244, 188, 430, 486, ductTex);
  carveDuctBypass(world, 780, 188, 560, 486, ductTex);
  carveDuctBypass(world, 244, 836, 430, 538, ductTex);
  carveDuctBypass(world, 780, 836, 562, 538, ductTex);
  carveDuctBypass(world, 244, 324, 520, 514, ductTex);
  carveDuctBypass(world, 780, 700, 520, 514, ductTex);

  carveCableTrench(world, 332, 188, 332, 836, rng);
  carveCableTrench(world, 704, 188, 704, 836, rng);
  carveCableTrench(world, 244, 438, 780, 438, rng);
  carveCableTrench(world, 244, 590, 780, 590, rng);

  dressServiceRoutes(world, rng);
  buildServiceHqCompounds(world);
  buildLiquidatorServiceOutposts(world);
  buildServiceBayRows(world, rng);
  buildServiceBypassWallStations(world);
  registerExpandedServiceUtilityGraph(world, cores, booths, pumps, basins);
}

function registerExpandedServiceUtilityGraph(
  world: World,
  cores: readonly Room[],
  booths: readonly Room[],
  pumps: readonly Room[],
  basins: readonly Room[],
): void {
  for (let i = 0; i < cores.length; i++) {
    const core = cores[i];
    const nodeId = `machine_core_${i}`;
    registerUtilityNode(world, core, nodeId, 'lift', 'machine_maze', 'panel_doors');
    registerUtilityEdge(
      world,
      'lift_machine_front',
      nodeId,
      'lift_cable',
      i < 2 ? 3 : 4,
      `${core.name}: лебедка подключена к общему машинному фронту С-15.`,
    );
  }

  for (let i = 0; i < booths.length; i++) {
    const booth = booths[i];
    const nodeId = `control_booth_${i}`;
    registerUtilityNode(world, booth, nodeId, i < 4 ? 'lift' : 'power', i < 4 ? 'route_transfer' : 'machine_maze', 'panel_power');
    registerUtilityEdge(
      world,
      'breaker_power_front',
      nodeId,
      'power_cable',
      i < 4 ? 2 : 3,
      `${booth.name}: пульт питается от щитовой и видит служебные обходы.`,
    );
    if (cores.length) {
      registerUtilityEdge(
        world,
        nodeId,
        `machine_core_${i % cores.length}`,
        'lift_cable',
        3,
        `${booth.name}: ручной пульт замыкает соседнее лифтовое ядро.`,
      );
    }
  }

  for (let i = 0; i < pumps.length; i++) {
    const pump = pumps[i];
    const nodeId = `pump_front_${i}`;
    registerUtilityNode(world, pump, nodeId, 'water', 'pressure_basin', 'panel_water');
    registerUtilityEdge(
      world,
      'crew_safe_front',
      nodeId,
      'water_pipe',
      i === 0 ? 3 : 4,
      `${pump.name}: бытовой стояк уходит в напорный карман.`,
    );
  }

  for (let i = 0; i < basins.length; i++) {
    const basin = basins[i];
    const nodeId = `drainage_basin_${i}`;
    registerUtilityNode(world, basin, nodeId, 'water', 'pressure_basin', 'panel_water');
    registerDrainageBasin(world, basin, nodeId, (3 + (i & 1)) as ServiceDrainageBasin['pressure']);
    registerUtilityEdge(
      world,
      `pump_front_${i % Math.max(1, pumps.length)}`,
      nodeId,
      'water_pipe',
      4,
      `${basin.name}: кабельный фронт набирает воду через насосный обратный напор.`,
    );
    registerUtilityEdge(
      world,
      'vent_signal_front',
      nodeId,
      'duct',
      3,
      `${basin.name}: узкий тензорный лаз проходит над мокрой кабельной кромкой.`,
    );
  }
}

export function placeServiceFloorEmergencyPanels(world: World): number {
  const placements: readonly {
    roomName: string;
    dx: number;
    dy: number;
    panelId: 'panel_power' | 'panel_water' | 'panel_doors' | 'panel_vent';
    seed: number;
  }[] = [
    { roomName: LIFT_MACHINE_ROOM, dx: 5, dy: 5, panelId: 'panel_doors', seed: 0x5151 },
    { roomName: BREAKER_ROOM, dx: 16, dy: 4, panelId: 'panel_power', seed: 0x5152 },
    { roomName: VENT_JUNCTION, dx: 19, dy: 3, panelId: 'panel_vent', seed: 0x5153 },
    { roomName: PUMP_RESCUE_ROOM, dx: 5, dy: 4, panelId: 'panel_water', seed: 0x5154 },
    { roomName: 'Насосная ниша восточного стояка С-15', dx: 5, dy: 4, panelId: 'panel_water', seed: 0x5155 },
    { roomName: 'Пост учета кабельных потерь С-15', dx: 14, dy: 4, panelId: 'panel_power', seed: 0x5156 },
  ];
  let placed = 0;
  for (const item of placements) {
    const room = findServiceRoom(world, item.roomName);
    if (!room) continue;
    const x = world.wrap(room.x + Math.min(room.w - 2, Math.max(1, item.dx)));
    const y = world.wrap(room.y + Math.min(room.h - 2, Math.max(1, item.dy)));
    const idx = world.idx(x, y);
    if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) continue;
    if (placeEmergencyPanel(world, x, y, item.panelId, item.seed ^ room.id * 131)) placed++;
  }
  return placed;
}

function spawnServicePumpRescue(world: World, entities: Entity[], room: Room): void {
  if (entities.some(entity => entity.plotNpcId === 'service_trapped_pump_worker')) return;
  const nextId = { v: nextServiceEntityId(entities) };
  const mitkaId = spawnPlotNpc(
    entities,
    nextId,
    'service_trapped_pump_worker',
    MITKA_DEF,
    room.x + 6,
    room.y + 5,
    0,
  );
  addServiceContainer(world, room, room.x + room.w - 5, room.y + 4, ContainerKind.TOOL_LOCKER, 'Аварийный ящик западного стояка С-15', 'owner', [
    { defId: 'valve_tag', count: 1 },
    { defId: 'wire_coil', count: 1 },
    { defId: 'sealant_tube', count: 1 },
    { defId: 'gasmask_filter', count: 1 },
  ], mitkaId, MITKA_DEF.name, ['service_floor', 'pressure', 'rescue', 'tools']);
  dropItems(world, entities, nextId, room, ['valve_tag', 'wire_coil', 'sealant_tube']);
  spawnMonsterPack(world, entities, nextId, room.x + room.w - 11, room.y + 6, [
    MonsterKind.TUBE_EEL,
    MonsterKind.LOTOCHNIK,
    MonsterKind.PAUPSINA,
  ]);
}

function seedServiceBasinLoot(world: World, entities: Entity[], basins: readonly Room[]): void {
  const nextId = { v: nextServiceEntityId(entities) };
  const basinDrops: readonly string[][] = [
    ['gasmask_filter', 'sealant_tube'],
    ['wire_coil', 'fuse'],
    ['valve_tag', 'sealant_tube'],
    ['ammo_energy', 'gasmask_filter'],
  ];
  const basinMonsters: readonly MonsterKind[][] = [
    [MonsterKind.TUBE_EEL, MonsterKind.LOTOCHNIK],
    [MonsterKind.TRUBNYY_AVTOMAT, MonsterKind.RZHAVNIK],
    [MonsterKind.PAUPSINA, MonsterKind.POLZUN],
    [MonsterKind.VODYANOY_KOSHMAR, MonsterKind.TUBE_EEL],
  ];
  for (let i = 0; i < basins.length; i++) {
    const basin = basins[i];
    dropItems(world, entities, nextId, basin, basinDrops[i % basinDrops.length]);
    spawnMonsterPack(
      world,
      entities,
      nextId,
      basin.x + 5,
      basin.y + 5,
      basinMonsters[i % basinMonsters.length],
    );
  }
}

function nextServiceEntityId(entities: readonly Entity[]): number {
  let id = 1;
  for (const entity of entities) id = Math.max(id, entity.id + 1);
  return id;
}

function stampServiceRoom(
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
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.cells[ci] === Cell.WALL) world.wallTex[ci] = wallTex;
      if (dx >= 0 && dx < w && dy >= 0 && dy < h) world.floorTex[ci] = floorTex;
    }
  }
  return room;
}

function findServiceRoom(world: World, name: string): Room | undefined {
  return world.rooms.find(room => room.name === name);
}

function carveStaffRoute(world: World, x: number, y: number, w: number, h: number): void {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (dx < 0 || dx >= w || dy < 0 || dy >= h) {
        if (world.cells[ci] === Cell.WALL) world.wallTex[ci] = Tex.METAL;
      } else {
        world.cells[ci] = Cell.FLOOR;
        world.roomMap[ci] = -1;
        world.floorTex[ci] = Tex.F_CONCRETE;
      }
    }
  }
}

function carveServiceRun(
  world: World,
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
    const x = Math.min(ax, bx);
    carveExpansionRect(world, x, ay - half, Math.abs(bx - ax) + 1, width, floorTex, wallTex);
    return;
  }
  const y = Math.min(ay, by);
  carveExpansionRect(world, ax - half, y, width, Math.abs(by - ay) + 1, floorTex, wallTex);
}

function carveExpansionRect(
  world: World,
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
      if (dx < 0 || dx >= w || dy < 0 || dy >= h) {
        if (world.cells[ci] === Cell.WALL) world.wallTex[ci] = wallTex;
      } else {
        openExpansionTile(world, x + dx, y + dy, floorTex);
      }
    }
  }
}

function openExpansionTile(world: World, x: number, y: number, floorTex: Tex): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR) return;
  if (world.roomMap[ci] >= 0 && world.cells[ci] !== Cell.WALL) return;
  world.cells[ci] = Cell.FLOOR;
  world.roomMap[ci] = -1;
  world.floorTex[ci] = floorTex;
  if (world.features[ci] !== Feature.NONE) world.features[ci] = Feature.NONE;
}

function openRouteTile(world: World, x: number, y: number, floorTex = Tex.F_CONCRETE): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT) return;
  world.cells[ci] = Cell.FLOOR;
  world.roomMap[ci] = -1;
  world.floorTex[ci] = floorTex;
}

function clampDoorCoord(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(v)));
}

function serviceOwnerWallTex(owner: ZoneFaction): Tex {
  if (owner === ZoneFaction.SCIENTIST) return Tex.TILE_W;
  if (owner === ZoneFaction.CULTIST) return Tex.DARK;
  if (owner === ZoneFaction.WILD) return Tex.ROTTEN;
  if (owner === ZoneFaction.CITIZEN) return Tex.PANEL;
  return Tex.METAL;
}

function serviceOwnerFloorTex(owner: ZoneFaction): Tex {
  if (owner === ZoneFaction.SCIENTIST) return Tex.F_TILE;
  if (owner === ZoneFaction.CULTIST) return Tex.F_RED_CARPET;
  if (owner === ZoneFaction.WILD) return Tex.F_CONCRETE;
  if (owner === ZoneFaction.CITIZEN) return Tex.F_LINO;
  return Tex.F_CONCRETE;
}

function serviceSupportType(owner: ZoneFaction, slot: number): RoomType {
  if (slot === 0) return RoomType.KITCHEN;
  if (slot === 1) return RoomType.BATHROOM;
  if (slot === 2) return owner === ZoneFaction.SCIENTIST ? RoomType.MEDICAL : RoomType.STORAGE;
  if (slot === 3) return owner === ZoneFaction.LIQUIDATOR || owner === ZoneFaction.SCIENTIST ? RoomType.OFFICE : RoomType.COMMON;
  return owner === ZoneFaction.WILD ? RoomType.SMOKING : RoomType.STORAGE;
}

function serviceBayType(seed: number): RoomType {
  const types = [
    RoomType.PRODUCTION,
    RoomType.STORAGE,
    RoomType.OFFICE,
    RoomType.BATHROOM,
    RoomType.COMMON,
    RoomType.KITCHEN,
    RoomType.STORAGE,
    RoomType.PRODUCTION,
  ] as const;
  return types[Math.abs(seed) % types.length];
}

function canStampOwnedServiceRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  if (x < 2 || y < 2 || x + w >= W - 2 || y + h >= W - 2) return false;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const idx = world.idx(x + dx, y + dy);
      if (world.aptMask[idx]) return false;
      if (world.cells[idx] !== Cell.WALL) return false;
      if (dx >= 0 && dx < w && dy >= 0 && dy < h && world.roomMap[idx] >= 0) return false;
    }
  }
  return true;
}

function paintServiceRoomOwner(world: World, room: Room, owner: ZoneFaction): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[idx] === room.id) setTerritoryOwnerAtIndex(world, idx, owner);
    }
  }
  for (const idx of room.doors) setTerritoryOwnerAtIndex(world, idx, owner);
}

function hardenServiceHqRoom(world: World, room: Room, owner: ZoneFaction): void {
  room.type = RoomType.HQ;
  room.sealed = true;
  room.wallTex = Tex.HERMO_WALL;
  room.floorTex = serviceOwnerFloorTex(owner);
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      const interior = dx >= 0 && dx < room.w && dy >= 0 && dy < room.h;
      if (interior) {
        if (world.roomMap[idx] === room.id) world.floorTex[idx] = room.floorTex;
        continue;
      }
      if (world.cells[idx] !== Cell.WALL || world.aptMask[idx]) continue;
      world.hermoWall[idx] = 1;
      world.wallTex[idx] = Tex.HERMO_WALL;
    }
  }
  paintServiceRoomOwner(world, room, owner);
}

function decorateOwnedServiceRoom(world: World, room: Room, owner: ZoneFaction, salt: number): void {
  if (room.type === RoomType.KITCHEN) {
    setFeature(world, room.x + 2, room.y + 2, Feature.STOVE);
    setFeature(world, room.x + room.w - 3, room.y + 2, Feature.SINK);
    setFeature(world, room.x + (room.w >> 1), room.y + room.h - 3, Feature.TABLE);
  } else if (room.type === RoomType.BATHROOM) {
    setFeature(world, room.x + 2, room.y + 2, Feature.TOILET);
    setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.SINK);
  } else if (room.type === RoomType.MEDICAL) {
    setFeature(world, room.x + 3, room.y + 2, Feature.APPARATUS);
    setFeature(world, room.x + room.w - 4, room.y + room.h - 3, Feature.BED);
  } else if (room.type === RoomType.OFFICE || room.type === RoomType.HQ) {
    setFeature(world, room.x + 2, room.y + 2, Feature.DESK);
    setFeature(world, room.x + 4, room.y + 2, Feature.SCREEN);
    setFeature(world, room.x + room.w - 3, room.y + 2, Feature.SHELF);
  } else if (room.type === RoomType.PRODUCTION) {
    setFeature(world, room.x + 3, room.y + 2, Feature.MACHINE);
    setFeature(world, room.x + room.w - 4, room.y + room.h - 3, Feature.APPARATUS);
  } else {
    setFeature(world, room.x + 2, room.y + 2, owner === ZoneFaction.CULTIST ? Feature.CANDLE : Feature.TABLE);
    setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.SHELF);
  }
  setFeature(world, room.x + (room.w >> 1), room.y + (room.h >> 1), owner === ZoneFaction.CULTIST ? Feature.CANDLE : Feature.LAMP);
  if (owner === ZoneFaction.WILD && (salt & 1) === 0) {
    stampSurfaceSplat(world, room.x + (room.w >> 1), room.y + (room.h >> 1), 0.5, 0.5, 1.9, 0.16, salt * 977, 72, 54, 36);
  }
}

function stampOwnedServiceRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  owner: ZoneFaction,
  protectedCore = false,
): Room | undefined {
  if (!canStampOwnedServiceRoom(world, x, y, w, h)) return undefined;
  const room = stampServiceRoom(
    world,
    type,
    x,
    y,
    w,
    h,
    name,
    protectedCore ? Tex.HERMO_WALL : serviceOwnerWallTex(owner),
    serviceOwnerFloorTex(owner),
  );
  if (protectedCore) hardenServiceHqRoom(world, room, owner);
  else paintServiceRoomOwner(world, room, owner);
  decorateOwnedServiceRoom(world, room, owner, room.id * 31 + x + y);
  return room;
}

function connectOwnedServiceRoom(world: World, room: Room, owner: ZoneFaction, spec: ServiceRoomDoorSpec): void {
  const state = spec.state ?? DoorState.CLOSED;
  const keyId = spec.keyId ?? '';
  let doorId = -1;
  if (spec.side === 'north') {
    doorId = connectRoomUp(
      world,
      room,
      clampDoorCoord(spec.targetX, room.x + 1, room.x + room.w - 2),
      spec.targetY,
      state,
      keyId,
    );
  } else if (spec.side === 'south') {
    doorId = connectRoomDown(
      world,
      room,
      clampDoorCoord(spec.targetX, room.x + 1, room.x + room.w - 2),
      spec.targetY,
      state,
      keyId,
    );
  } else if (spec.side === 'west') {
    doorId = connectRoomLeft(
      world,
      room,
      spec.targetX,
      clampDoorCoord(spec.targetY, room.y + 1, room.y + room.h - 2),
      state,
      keyId,
    );
  } else {
    doorId = connectRoomRight(
      world,
      room,
      spec.targetX,
      clampDoorCoord(spec.targetY, room.y + 1, room.y + room.h - 2),
      state,
      keyId,
    );
  }
  if (doorId >= 0) setTerritoryOwnerAtIndex(world, doorId, owner);
  paintServiceRoomOwner(world, room, owner);
}

function carveOwnedServiceRun(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  owner: ZoneFaction,
  floorTex: Tex,
  wallTex: Tex,
): void {
  carveServiceRun(world, ax, ay, bx, by, width, floorTex, wallTex);
  const half = width >> 1;
  if (ay === by) {
    const minX = Math.min(ax, bx);
    const maxX = Math.max(ax, bx);
    for (let y = ay - half; y <= ay + half; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = world.idx(x, y);
        if (world.cells[idx] === Cell.FLOOR || world.cells[idx] === Cell.WATER) {
          setTerritoryOwnerAtIndex(world, idx, owner);
        }
      }
    }
    return;
  }
  const minY = Math.min(ay, by);
  const maxY = Math.max(ay, by);
  for (let y = minY; y <= maxY; y++) {
    for (let x = ax - half; x <= ax + half; x++) {
      const idx = world.idx(x, y);
      if (world.cells[idx] === Cell.FLOOR || world.cells[idx] === Cell.WATER) {
        setTerritoryOwnerAtIndex(world, idx, owner);
      }
    }
  }
}

function serviceSupportName(prefix: string, type: RoomType, slot: number): string {
  switch (type) {
    case RoomType.KITCHEN: return `${prefix}: кухня ${slot}`;
    case RoomType.BATHROOM: return `${prefix}: санузел ${slot}`;
    case RoomType.MEDICAL: return `${prefix}: медпункт ${slot}`;
    case RoomType.OFFICE: return `${prefix}: журнал ${slot}`;
    case RoomType.PRODUCTION: return `${prefix}: мастерская ${slot}`;
    case RoomType.SMOKING: return `${prefix}: курилка ${slot}`;
    case RoomType.COMMON: return `${prefix}: общая ${slot}`;
    case RoomType.STORAGE:
    default: return `${prefix}: кладовая ${slot}`;
  }
}

function buildServiceHqCompounds(world: World): void {
  for (const spec of SERVICE_HQ_COMPOUNDS) {
    const floorTex = serviceOwnerFloorTex(spec.owner);
    const wallTex = serviceOwnerWallTex(spec.owner);
    carveOwnedServiceRun(world, spec.route[0], spec.route[1], spec.route[2], spec.route[3], 3, spec.owner, floorTex, wallTex);
    carveOwnedServiceRun(world, spec.corridor[0], spec.corridor[1], spec.corridor[2], spec.corridor[3], 3, spec.owner, floorTex, wallTex);

    const [coreX, coreY, coreW, coreH, coreSide, coreName] = spec.core;
    const core = stampOwnedServiceRoom(world, RoomType.HQ, coreX, coreY, coreW, coreH, coreName, spec.owner, true);
    if (core) {
      connectOwnedServiceRoom(world, core, spec.owner, {
        side: coreSide,
        targetX: core.x + (core.w >> 1),
        targetY: spec.corridor[1],
        state: DoorState.HERMETIC_OPEN,
      });
      hardenServiceHqRoom(world, core, spec.owner);
    }

    const x1 = Math.min(spec.corridor[0], spec.corridor[2]);
    const x2 = Math.max(spec.corridor[0], spec.corridor[2]);
    const y = spec.corridor[1];
    const supportTypes = [0, 1, 2, 3, 4].map(slot => serviceSupportType(spec.owner, slot));
    for (let i = 0; i < supportTypes.length; i++) {
      const type = supportTypes[i];
      const w = type === RoomType.KITCHEN || type === RoomType.MEDICAL || type === RoomType.OFFICE ? 18 : 15;
      const h = 10;
      const px = x1 + 6 + i * Math.max(19, Math.floor((x2 - x1 - 12) / Math.max(1, supportTypes.length)));
      const above = (i & 1) === 0;
      const roomY = above ? y - h - 5 : y + 5;
      const room = stampOwnedServiceRoom(
        world,
        type,
        px,
        roomY,
        w,
        h,
        serviceSupportName(spec.supportPrefix, type, i + 1),
        spec.owner,
      );
      if (!room) continue;
      connectOwnedServiceRoom(world, room, spec.owner, {
        side: above ? 'south' : 'north',
        targetX: room.x + (room.w >> 1),
        targetY: y,
      });
    }
  }
}

function buildLiquidatorServiceOutposts(world: World): void {
  const posts = [
    { name: SERVICE_LIQUIDATOR_OUTPOST_NAMES[0], x: 394, y: 410, w: 22, h: 12, side: 'south' as ServiceDoorSide, tx: 404, ty: 438 },
    { name: SERVICE_LIQUIDATOR_OUTPOST_NAMES[1], x: 608, y: 410, w: 22, h: 12, side: 'south' as ServiceDoorSide, tx: 618, ty: 438 },
    { name: SERVICE_LIQUIDATOR_OUTPOST_NAMES[2], x: 496, y: 716, w: 24, h: 12, side: 'north' as ServiceDoorSide, tx: 508, ty: 700 },
  ] as const;
  for (const post of posts) {
    const room = stampOwnedServiceRoom(world, RoomType.HQ, post.x, post.y, post.w, post.h, post.name, ZoneFaction.LIQUIDATOR, true);
    if (!room) continue;
    connectOwnedServiceRoom(world, room, ZoneFaction.LIQUIDATOR, {
      side: post.side,
      targetX: post.tx,
      targetY: post.ty,
      state: DoorState.HERMETIC_OPEN,
    });
    hardenServiceHqRoom(world, room, ZoneFaction.LIQUIDATOR);
  }
}

function buildServiceBayRows(world: World, rng: () => number): void {
  let serial = 0;
  for (const row of SERVICE_BAY_ROWS) {
    for (let p = row.start; p <= row.end; p += row.step) {
      const jitter = Math.floor(rng() * 5) - 2;
      const type = serviceBayType(row.typeSeed + serial);
      const span = row.span + ((serial + row.typeSeed) % 3);
      let x: number;
      let y: number;
      let w: number;
      let h: number;
      let door: ServiceRoomDoorSpec;
      if (row.horizontal) {
        w = 12 + ((serial + row.typeSeed) % 4) * 3;
        h = span;
        x = p + jitter;
        y = row.side < 0 ? row.corridor - h - 4 : row.corridor + 4;
        door = {
          side: row.side < 0 ? 'south' : 'north',
          targetX: x + (w >> 1),
          targetY: row.corridor,
          state: type === RoomType.OFFICE && row.owner === ZoneFaction.LIQUIDATOR ? DoorState.LOCKED : DoorState.CLOSED,
          keyId: type === RoomType.OFFICE && row.owner === ZoneFaction.LIQUIDATOR ? 'key' : '',
        };
      } else {
        w = span;
        h = 12 + ((serial + row.typeSeed) % 4) * 3;
        x = row.side < 0 ? row.corridor - w - 4 : row.corridor + 4;
        y = p + jitter;
        door = {
          side: row.side < 0 ? 'east' : 'west',
          targetX: row.corridor,
          targetY: y + (h >> 1),
          state: type === RoomType.STORAGE && row.owner === ZoneFaction.WILD ? DoorState.LOCKED : DoorState.CLOSED,
          keyId: type === RoomType.STORAGE && row.owner === ZoneFaction.WILD ? 'key' : '',
        };
      }
      const room = stampOwnedServiceRoom(
        world,
        type,
        x,
        y,
        w,
        h,
        `${row.label} ${serial + 1}`,
        row.owner,
      );
      if (!room) {
        serial++;
        continue;
      }
      connectOwnedServiceRoom(world, room, row.owner, door);
      serial++;
    }
  }
}

function carveServiceRoomBypassWall(world: World, room: Room, vertical: boolean, salt: number): void {
  if (vertical) {
    const x = room.x + (room.w >> 1);
    for (let y = room.y + 6; y < room.y + room.h - 6; y++) {
      if (y < room.y + 10 || y > room.y + room.h - 11) continue;
      const idx = world.idx(x, y);
      if (world.roomMap[idx] !== room.id) continue;
      if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) continue;
      world.cells[idx] = Cell.WALL;
      world.roomMap[idx] = -1;
      world.wallTex[idx] = Tex.PIPE;
      world.features[idx] = Feature.NONE;
    }
    setFeature(world, x - 2, room.y + 8 + (salt % 3), Feature.SCREEN);
    setFeature(world, x + 2, room.y + room.h - 9 - (salt % 3), Feature.APPARATUS);
    return;
  }
  const y = room.y + (room.h >> 1);
  for (let x = room.x + 8; x < room.x + room.w - 8; x++) {
    if (x < room.x + 13 || x > room.x + room.w - 14) continue;
    const idx = world.idx(x, y);
    if (world.roomMap[idx] !== room.id) continue;
    if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) continue;
    world.cells[idx] = Cell.WALL;
    world.roomMap[idx] = -1;
    world.wallTex[idx] = Tex.PIPE;
    world.features[idx] = Feature.NONE;
  }
  setFeature(world, room.x + 8 + (salt % 4), y - 2, Feature.SCREEN);
  setFeature(world, room.x + room.w - 9 - (salt % 4), y + 2, Feature.APPARATUS);
}

function buildServiceBypassWallStations(world: World): void {
  const rooms = [
    findServiceRoom(world, DRAINAGE_BASIN_NW),
    findServiceRoom(world, DRAINAGE_BASIN_NE),
    findServiceRoom(world, DRAINAGE_BASIN_SW),
    findServiceRoom(world, DRAINAGE_BASIN_SE),
    findServiceRoom(world, 'Северо-западное лифтовое ядро С-15'),
    findServiceRoom(world, 'Северо-восточное лифтовое ядро С-15'),
    findServiceRoom(world, 'Юго-западное лифтовое ядро С-15'),
    findServiceRoom(world, 'Юго-восточное лифтовое ядро С-15'),
  ].filter((room): room is Room => room !== undefined);
  for (let i = 0; i < rooms.length; i++) carveServiceRoomBypassWall(world, rooms[i], i % 2 === 0, i);

  const booths = [
    { x: 300, y: 424, side: 'south' as ServiceDoorSide, tx: 310, ty: 438, name: 'Будка обхода северо-западной стены С-15' },
    { x: 668, y: 424, side: 'south' as ServiceDoorSide, tx: 678, ty: 438, name: 'Будка обхода северо-восточной стены С-15' },
    { x: 342, y: 578, side: 'south' as ServiceDoorSide, tx: 352, ty: 590, name: 'Будка обхода юго-западной стены С-15' },
    { x: 642, y: 578, side: 'south' as ServiceDoorSide, tx: 652, ty: 590, name: 'Будка обхода юго-восточной стены С-15' },
  ] as const;
  for (const booth of booths) {
    const room = stampOwnedServiceRoom(world, RoomType.OFFICE, booth.x, booth.y, 20, 10, booth.name, ZoneFaction.LIQUIDATOR);
    if (!room) continue;
    connectOwnedServiceRoom(world, room, ZoneFaction.LIQUIDATOR, {
      side: booth.side,
      targetX: booth.tx,
      targetY: booth.ty,
      state: DoorState.CLOSED,
    });
  }
}

export function reinforceServiceFloorAuthoredHqTerritory(world: World): void {
  for (const spec of SERVICE_HQ_COMPOUNDS) {
    const coreName = spec.core[5];
    for (const room of world.rooms) {
      if (!room) continue;
      if (room.name === coreName) {
        hardenServiceHqRoom(world, room, spec.owner);
        for (const doorIdx of room.doors) {
          const door = world.doors.get(doorIdx);
          if (!door) continue;
          door.state = DoorState.HERMETIC_OPEN;
          door.keyId = '';
          setTerritoryOwnerAtIndex(world, doorIdx, spec.owner);
        }
      } else if (room.name.startsWith(`${spec.supportPrefix}:`)) {
        paintServiceRoomOwner(world, room, spec.owner);
      }
    }
  }
  for (const name of SERVICE_LIQUIDATOR_OUTPOST_NAMES) {
    const room = findServiceRoom(world, name);
    if (!room) continue;
    hardenServiceHqRoom(world, room, ZoneFaction.LIQUIDATOR);
    for (const doorIdx of room.doors) {
      const door = world.doors.get(doorIdx);
      if (!door) continue;
      door.state = DoorState.HERMETIC_OPEN;
      door.keyId = '';
      setTerritoryOwnerAtIndex(world, doorIdx, ZoneFaction.LIQUIDATOR);
    }
  }
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFeaturesDirty(false);
}

function isServiceAmbientNpc(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    !entity.plotNpcId &&
    !entity.persistentNpcId &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    (entity.name?.startsWith('Служебный этаж: ремонтник ') ?? false);
}

function serviceTerritorySpawnCells(world: World): Map<TerritoryOwner, number[]> {
  const cells = new Map<TerritoryOwner, number[]>([
    [ZoneFaction.CITIZEN, []],
    [ZoneFaction.LIQUIDATOR, []],
    [ZoneFaction.CULTIST, []],
    [ZoneFaction.SCIENTIST, []],
    [ZoneFaction.WILD, []],
  ]);
  for (let i = 0; i < W * W; i++) {
    const cell = world.cells[i];
    if (cell !== Cell.FLOOR && cell !== Cell.WATER && cell !== Cell.DOOR) continue;
    const list = cells.get(world.factionControl[i] as TerritoryOwner);
    if (list) list.push(i);
  }
  return cells;
}

export function alignServiceFloorAmbientNpcTerritory(world: World, entities: Entity[]): void {
  const cells = serviceTerritorySpawnCells(world);
  const offsets = new Uint16Array(8);
  for (const entity of entities) {
    if (!isServiceAmbientNpc(entity) || entity.faction === undefined) continue;
    const owner = factionToTerritoryOwner(entity.faction);
    const list = cells.get(owner);
    if (!list || list.length === 0) continue;
    const offset = offsets[owner]++ | 0;
    const cell = list[(entity.id * 127 + offset * 421) % list.length];
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

function stampMachineCore(
  world: World,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  route: number,
  side: 'left' | 'right' | 'up' | 'down',
): Room {
  const room = stampServiceRoom(world, RoomType.PRODUCTION, x, y, w, h, name, Tex.PIPE, Tex.F_CONCRETE);
  const midX = room.x + (room.w >> 1);
  const midY = room.y + (room.h >> 1);
  if (side === 'left') connectRoomLeft(world, room, route, midY, DoorState.CLOSED);
  else if (side === 'right') connectRoomRight(world, room, route, midY, DoorState.CLOSED);
  else if (side === 'up') connectRoomUp(world, room, midX, route, DoorState.CLOSED);
  else connectRoomDown(world, room, midX, route, DoorState.CLOSED);
  return room;
}

function stampControlBooth(
  world: World,
  x: number,
  y: number,
  name: string,
  routeX: number,
  routeY: number,
  side: 'left' | 'right' | 'up' | 'down',
): Room {
  const room = stampServiceRoom(world, RoomType.OFFICE, x, y, 18, 12, name, Tex.METAL, Tex.F_TILE);
  if (side === 'left') connectRoomLeft(world, room, routeX, routeY, DoorState.LOCKED, 'key');
  else if (side === 'right') connectRoomRight(world, room, routeX, routeY, DoorState.LOCKED, 'key');
  else if (side === 'up') connectRoomUp(world, room, room.x + (room.w >> 1), routeY, DoorState.LOCKED, 'key');
  else connectRoomDown(world, room, room.x + (room.w >> 1), routeY, DoorState.LOCKED, 'key');
  return room;
}

function stampPumpAlcove(
  world: World,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  routeY: number,
  side: 'up' | 'down',
): Room {
  const room = stampServiceRoom(world, RoomType.PRODUCTION, x, y, w, h, name, Tex.PIPE, Tex.F_WATER);
  const midX = room.x + (room.w >> 1);
  if (side === 'up') connectRoomUp(world, room, midX, routeY, DoorState.CLOSED);
  else connectRoomDown(world, room, midX, routeY, DoorState.CLOSED);
  return room;
}

function stampPressureBasin(
  world: World,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  routeY: number,
  side: 'up' | 'down',
): Room {
  const room = stampServiceRoom(world, RoomType.BATHROOM, x, y, w, h, name, Tex.PIPE, Tex.F_WATER);
  const midX = room.x + (room.w >> 1);
  if (side === 'up') connectRoomUp(world, room, midX, routeY, DoorState.CLOSED);
  else connectRoomDown(world, room, midX, routeY, DoorState.CLOSED);
  return room;
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.WALL || world.cells[ci] === Cell.LIFT) return;
  world.features[ci] = feature;
}

function addDoor(world: World, room: Room, x: number, y: number, state: DoorState, keyId = ''): number {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.DOOR;
  world.wallTex[ci] = room.wallTex;
  world.doors.set(ci, { idx: ci, state, roomA: room.id, roomB: -1, keyId, timer: 0 });
  room.doors.push(ci);
  return ci;
}

function connectRoomDown(world: World, room: Room, x: number, targetY: number, state: DoorState, keyId = ''): number {
  const doorY = room.y + room.h;
  const doorId = addDoor(world, room, x, doorY, state, keyId);
  for (let y = doorY + 1; y <= targetY; y++) openRouteTile(world, x, y, room.floorTex);
  return doorId;
}

function connectRoomUp(world: World, room: Room, x: number, targetY: number, state: DoorState, keyId = ''): number {
  const doorY = room.y - 1;
  const doorId = addDoor(world, room, x, doorY, state, keyId);
  for (let y = doorY - 1; y >= targetY; y--) openRouteTile(world, x, y, room.floorTex);
  return doorId;
}

function connectRoomLeft(world: World, room: Room, targetX: number, y: number, state: DoorState, keyId = ''): number {
  const doorX = room.x - 1;
  const doorId = addDoor(world, room, doorX, y, state, keyId);
  for (let x = doorX - 1; x >= targetX; x--) openRouteTile(world, x, y, room.floorTex);
  return doorId;
}

function connectRoomRight(world: World, room: Room, targetX: number, y: number, state: DoorState, keyId = ''): number {
  const doorX = room.x + room.w;
  const doorId = addDoor(world, room, doorX, y, state, keyId);
  for (let x = doorX + 1; x <= targetX; x++) openRouteTile(world, x, y, room.floorTex);
  return doorId;
}

function placeLift(world: World, x: number, y: number, direction: LiftDirection): void {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.LIFT;
  world.wallTex[ci] = Tex.LIFT_DOOR;
  world.liftDir[ci] = direction;
  setFeature(world, x + 1, y, Feature.LIFT_BUTTON);
  world.liftDir[world.idx(x + 1, y)] = direction;
}

function dressCorridors(world: World): void {
  for (let x = 438; x < 612; x += 12) {
    setFeature(world, x, 514, x % 24 === 0 ? Feature.SCREEN : Feature.LAMP);
  }
  for (let y = 484; y < 556; y += 10) {
    setFeature(world, 522, y, y % 20 === 0 ? Feature.APPARATUS : Feature.LAMP);
  }
  for (let x = 458; x < 570; x += 16) {
    setFeature(world, x, 505, Feature.APPARATUS);
  }
  for (let x = 480; x < 562; x += 14) {
    setFeature(world, x, 539, Feature.SHELF);
  }
}

function dressServiceRoutes(world: World, rng: () => number): void {
  for (let x = 268; x <= 756; x += 28) {
    setFeature(world, x, 188, x % 84 === 0 ? Feature.SCREEN : Feature.LAMP);
    setFeature(world, x, 836, x % 84 === 0 ? Feature.APPARATUS : Feature.LAMP);
  }
  for (let y = 224; y <= 804; y += 30) {
    setFeature(world, 244, y, y % 90 === 0 ? Feature.SCREEN : Feature.APPARATUS);
    setFeature(world, 780, y, y % 90 === 0 ? Feature.SCREEN : Feature.APPARATUS);
  }
  for (let x = 280; x <= 748; x += 36) {
    setFeature(world, x, 324, Feature.APPARATUS);
    setFeature(world, x, 700, Feature.SHELF);
  }
  for (let y = 216; y <= 808; y += 44) {
    setFeature(world, 520, y, rng() < 0.55 ? Feature.LAMP : Feature.SCREEN);
  }
}

function dressLiftMachine(world: World, room: Room): void {
  for (let y = room.y + 2; y < room.y + room.h - 2; y += 3) {
    setFeature(world, room.x + 2, y, Feature.MACHINE);
    setFeature(world, room.x + room.w - 3, y, Feature.APPARATUS);
  }
  for (let x = room.x + 6; x < room.x + room.w - 4; x += 5) {
    setFeature(world, x, room.y + 2, Feature.SCREEN);
    setFeature(world, x, room.y + room.h - 3, Feature.LAMP);
    stampSurfaceSplat(world, x, room.y + 9, 0.5, 0.5, 0.18, 70, room.id * 53 + x, 30, 30, 35);
  }
  setFeature(world, room.x + 5, room.y + 5, Feature.LIFT_BUTTON);
}

function dressMachineCore(world: World, room: Room, seedOffset: number): void {
  const shaftX = room.x + (room.w >> 1) - 2;
  for (let y = room.y + 5; y < room.y + room.h - 5; y++) {
    for (let x = shaftX; x < shaftX + 4; x++) {
      const ci = world.idx(x, y);
      if (world.roomMap[ci] !== room.id || world.cells[ci] !== Cell.FLOOR) continue;
      world.cells[ci] = Cell.ABYSS;
      world.floorTex[ci] = Tex.F_ABYSS;
      world.features[ci] = Feature.NONE;
    }
  }
  for (let y = room.y + 3; y < room.y + room.h - 3; y += 4) {
    setFeature(world, room.x + 3, y, Feature.MACHINE);
    setFeature(world, room.x + room.w - 4, y, Feature.APPARATUS);
  }
  for (let x = room.x + 8; x < room.x + room.w - 8; x += 8) {
    setFeature(world, x, room.y + 3, Feature.SCREEN);
    setFeature(world, x, room.y + room.h - 4, Feature.LAMP);
    stampSurfaceSplat(world, x, room.y + (room.h >> 1), 0.5, 0.5, 2.4, 0.18, room.id * 311 + seedOffset * 17 + x, 22, 24, 28);
  }
  setFeature(world, room.x + 5, room.y + 5, Feature.LIFT_BUTTON);
}

function dressControlBooth(world: World, room: Room): void {
  setFeature(world, room.x + 3, room.y + 3, Feature.DESK);
  setFeature(world, room.x + 4, room.y + 3, Feature.SCREEN);
  setFeature(world, room.x + room.w - 4, room.y + 3, Feature.SCREEN);
  setFeature(world, room.x + 4, room.y + room.h - 4, Feature.SHELF);
  setFeature(world, room.x + room.w - 5, room.y + room.h - 4, Feature.LAMP);
}

function dressPumpAlcove(world: World, room: Room): void {
  for (let x = room.x + 4; x < room.x + room.w - 4; x++) {
    const ci = world.idx(x, room.y + (room.h >> 1));
    if (world.roomMap[ci] === room.id && world.cells[ci] === Cell.FLOOR) {
      world.cells[ci] = Cell.WATER;
      world.floorTex[ci] = Tex.F_WATER;
    }
  }
  for (let y = room.y + 3; y < room.y + room.h - 3; y += 5) {
    setFeature(world, room.x + 3, y, Feature.MACHINE);
    setFeature(world, room.x + room.w - 4, y, Feature.APPARATUS);
  }
  setFeature(world, room.x + (room.w >> 1), room.y + 3, Feature.SCREEN);
}

function dressPressureBasin(world: World, room: Room, rng: () => number, basinIndex: number): void {
  const poolTop = room.y + 7;
  const poolBottom = room.y + room.h - 7;
  const poolLeft = room.x + 7;
  const poolRight = room.x + room.w - 8;
  let serial = 0;
  for (let y = poolTop; y <= poolBottom; y++) {
    for (let x = poolLeft; x <= poolRight; x++) {
      const ci = world.idx(x, y);
      if (world.roomMap[ci] !== room.id || world.cells[ci] !== Cell.FLOOR) continue;
      const lip = x === poolLeft || x === poolRight || y === poolTop || y === poolBottom;
      if (lip && ((x + y + basinIndex) & 3) === 0) {
        world.floorTex[ci] = Tex.F_CONCRETE;
        continue;
      }
      world.cells[ci] = Cell.WATER;
      world.floorTex[ci] = Tex.F_WATER;
      if (((serial++ + basinIndex) & 15) === 0) stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.42, 0.2, room.id * 401 + serial, 40, 95, 105);
    }
  }
  for (let x = room.x + 4; x < room.x + room.w - 4; x += 9) {
    setFeature(world, x, room.y + 3, rng() < 0.5 ? Feature.APPARATUS : Feature.SCREEN);
    setFeature(world, x, room.y + room.h - 4, Feature.MACHINE);
  }
  for (let y = room.y + 5; y < room.y + room.h - 5; y += 8) {
    setFeature(world, room.x + 3, y, Feature.SINK);
    setFeature(world, room.x + room.w - 4, y, Feature.APPARATUS);
  }
}

function dressBreakerRoom(world: World, room: Room): void {
  for (let x = room.x + 2; x < room.x + room.w - 2; x += 3) {
    setFeature(world, x, room.y + 2, Feature.APPARATUS);
    setFeature(world, x, room.y + 5, Feature.SCREEN);
  }
  setFeature(world, room.x + 3, room.y + room.h - 3, Feature.DESK);
  setFeature(world, room.x + room.w - 4, room.y + room.h - 3, Feature.LAMP);
}

function dressJanitorDepot(world: World, room: Room): void {
  for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
    setFeature(world, room.x + 1, y, Feature.SHELF);
    if (y % 3 === 0) setFeature(world, room.x + room.w - 2, y, Feature.SINK);
  }
  setFeature(world, room.x + 5, room.y + 3, Feature.DESK);
  setFeature(world, room.x + 6, room.y + room.h - 3, Feature.LAMP);
}

function dressVentJunction(world: World, room: Room): void {
  for (let x = room.x + 3; x < room.x + room.w - 3; x += 4) {
    for (let y = room.y + 3; y < room.y + room.h - 3; y += 4) {
      setFeature(world, x, y, Feature.APPARATUS);
      stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.22, 90, room.id * 97 + x + y, 20, 22, 25);
    }
  }
  setFeature(world, room.x + room.w - 4, room.y + 2, Feature.LAMP);
}

function dressCanteen(world: World, room: Room): void {
  for (let x = room.x + 4; x < room.x + room.w - 4; x += 7) {
    setFeature(world, x, room.y + 5, Feature.TABLE);
    setFeature(world, x - 1, room.y + 5, Feature.CHAIR);
    setFeature(world, x + 1, room.y + 5, Feature.CHAIR);
  }
  setFeature(world, room.x + 2, room.y + 2, Feature.STOVE);
  setFeature(world, room.x + 5, room.y + 2, Feature.SINK);
  setFeature(world, room.x + room.w - 4, room.y + room.h - 4, Feature.LAMP);
}

function dressClerkOffice(world: World, room: Room): void {
  for (let y = room.y + 2; y < room.y + room.h - 2; y += 3) {
    setFeature(world, room.x + 2, y, Feature.SHELF);
    setFeature(world, room.x + room.w - 3, y, Feature.SCREEN);
  }
  setFeature(world, room.x + 7, room.y + 6, Feature.DESK);
  setFeature(world, room.x + 9, room.y + 6, Feature.CHAIR);
  setFeature(world, room.x + 4, room.y + 2, Feature.LAMP);
}

function carveDuctBypass(world: World, ax: number, ay: number, bx: number, by: number, floorTex: Tex): void {
  const elbowX = ax;
  const elbowY = by;
  carveServiceRun(world, ax, ay, elbowX, elbowY, 1, floorTex, Tex.DARK);
  carveServiceRun(world, elbowX, elbowY, bx, by, 1, floorTex, Tex.DARK);
  const minX = Math.min(elbowX, bx);
  const maxX = Math.max(elbowX, bx);
  for (let x = minX; x <= maxX; x += 12) setFeature(world, x, by, Feature.APPARATUS);
  const minY = Math.min(ay, elbowY);
  const maxY = Math.max(ay, elbowY);
  for (let y = minY; y <= maxY; y += 14) setFeature(world, ax, y, Feature.SHELF);
}

function carveCableTrench(world: World, ax: number, ay: number, bx: number, by: number, rng: () => number): void {
  carveServiceRun(world, ax, ay, bx, by, 2, Tex.F_ABYSS, Tex.PIPE);
  if (ax === bx) {
    const minY = Math.min(ay, by);
    const maxY = Math.max(ay, by);
    for (let y = minY; y <= maxY; y += 22) {
      setFeature(world, ax - 1, y, rng() < 0.5 ? Feature.APPARATUS : Feature.SCREEN);
      stampSurfaceSplat(world, ax, y, 0.5, 0.5, 1.8, 0.14, ax * 997 + y, 18, 20, 24);
    }
  } else {
    const minX = Math.min(ax, bx);
    const maxX = Math.max(ax, bx);
    for (let x = minX; x <= maxX; x += 24) {
      setFeature(world, x, ay - 1, rng() < 0.5 ? Feature.APPARATUS : Feature.SCREEN);
      stampSurfaceSplat(world, x, ay, 0.5, 0.5, 1.8, 0.14, ay * 991 + x, 18, 20, 24);
    }
  }
}

function generateServiceZones(world: World, rooms: Room[]): void {
  const zoneSize = W / 8;
  world.zones = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const id = y * 8 + x;
      world.zones.push({
        id,
        cx: Math.floor(x * zoneSize + zoneSize / 2),
        cy: Math.floor(y * zoneSize + zoneSize / 2),
        faction: ZoneFaction.LIQUIDATOR,
        hasLift: false,
        fogged: false,
        level: 3,
        hqRoomId: -1,
      });
    }
  }
  for (let y = 0; y < W; y++) {
    const zy = Math.min(7, Math.floor(y / zoneSize));
    for (let x = 0; x < W; x++) {
      const zx = Math.min(7, Math.floor(x / zoneSize));
      world.zoneMap[y * W + x] = zy * 8 + zx;
      world.factionControl[y * W + x] = ZoneFaction.LIQUIDATOR;
    }
  }
  for (const room of rooms) {
    const zi = world.zoneMap[world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2))];
    const zone = world.zones[zi];
    if (!zone) continue;
    zone.hasLift = zone.hasLift || room.name.includes('лифт');
    zone.level = Math.max(zone.level, room.name === VENT_JUNCTION ? 4 : 3);
  }
}

function spawnPlotNpc(
  entities: Entity[],
  nextId: { v: number },
  npcId: string,
  _def: PlotNpcDef,
  x: number,
  y: number,
  angle: number,
): number {
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, npcId, x + 0.5, y + 0.5, {
    angle,
  });
  return npc.id;
}

function addServiceContainer(
  world: World,
  room: Room,
  x: number,
  y: number,
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
    x,
    y,
    floor: SERVICE_FLOOR_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind,
    name,
    inventory: inventory.map(i => ({ ...i })),
    capacitySlots: Math.max(8, inventory.length + 4),
    ownerNpcId,
    ownerName,
    access,
    discovered: access !== 'secret',
    tags,
  };
  world.addContainer(container);
  setFeature(world, x, y, kind === ContainerKind.FRIDGE ? Feature.SINK : Feature.SHELF);
  return container;
}

function nextContainerId(world: World): number {
  let id = 1;
  for (const container of world.containers) id = Math.max(id, container.id + 1);
  return id;
}

function dropItems(world: World, entities: Entity[], nextId: { v: number }, room: Room, itemIds: string[]): void {
  for (let n = 0; n < itemIds.length; n++) {
    const x = room.x + 2 + ((n * 5) % Math.max(1, room.w - 4));
    const y = room.y + 2 + ((n * 3) % Math.max(1, room.h - 4));
    const ci = world.idx(x, y);
    if (world.cells[ci] !== Cell.FLOOR) continue;
    entities.push({
      id: nextId.v++, type: EntityType.ITEM_DROP,
      x: x + 0.5, y: y + 0.5, angle: 0, pitch: 0,
      alive: true, speed: 0, sprite: Spr.ITEM_DROP,
      inventory: [{ defId: itemIds[n], count: 1 }],
    });
  }
}

function spawnMonsterPack(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  x: number,
  y: number,
  kinds: MonsterKind[],
): void {
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    const def = MONSTERS[kind];
    if (!def) continue;
    const mx = x + (i % 2) * 3 - 1;
    const my = y + Math.floor(i / 2) * 3 - 1;
    const ci = world.idx(mx, my);
    if (world.cells[ci] !== Cell.FLOOR) continue;
    const zone = world.zones[world.zoneMap[ci]];
    const zoneLevel = zone?.level ?? 3;
    const hp = scaleMonsterHp(def.hp, zoneLevel);
    const monster: Entity = {
      id: nextId.v++, type: EntityType.MONSTER,
      x: mx + 0.5, y: my + 0.5,
      angle: 0, pitch: 0,
      alive: true,
      speed: scaleMonsterSpeed(def.speed, zoneLevel),
      sprite: def.sprite,
      hp, maxHp: hp,
      monsterKind: kind, attackCd: 0,
      ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
      rpg: randomRPG(zoneLevel),
    };
    entities.push(monster);
  }
}
