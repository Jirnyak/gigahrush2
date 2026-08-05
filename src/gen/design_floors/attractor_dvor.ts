/* -- Design floor: attractor_dvor / flow-driven service yard -------- */

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
  RoomType,
  Tex,
  W,
  ZoneFaction,
  type Entity,
  type Room,
  type TerritoryOwner,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { freshNeeds } from '../../data/catalog';
import { HUMAN_TERRITORY_OWNERS, factionToTerritoryOwner } from '../../data/factions';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import { placeEmergencyPanel } from '../../systems/emergency_panels';
import { registerRouteCue } from '../../systems/route_cues';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { ensureConnectivity, generateZones, sanitizeDoors, stampRoom } from '../shared';
import type { FloorGeneration } from '../floor_manifest';

export const ATTRACTOR_DVOR_ROUTE_ID = 'attractor_dvor' as const;
export const ATTRACTOR_DVOR_Z = -34;
export const ATTRACTOR_DVOR_BASE_FLOOR = FloorLevel.MAINTENANCE;

const CX = W >> 1;
const CY = W >> 1;
const FLOW_FLOOR = Tex.F_CONCRETE;
const DEAD_FLOOR = Tex.F_WATER;

export const ATTRACTOR_DVOR_ROOM_NAMES = {
  entry: 'Аттракторный двор: приемка потока',
  northSpine: 'Аттракторный двор: северная тензорная спина',
  eastSpine: 'Аттракторный двор: восточная тензорная спина',
  southSpine: 'Аттракторный двор: южная тензорная спина',
  westSpine: 'Аттракторный двор: западная тензорная спина',
  pumpCore: 'Аттракторный двор: насосный центр',
  deadZone: 'Аттракторный двор: мертвая зона',
  guardLoop: 'Аттракторный двор: пост предельной петли',
  westSwitch: 'Аттракторный двор: параметр западной струи',
  eastSwitch: 'Аттракторный двор: параметр восточной струи',
  northSwitch: 'Аттракторный двор: параметр верхнего вихря',
  transitCache: 'Аттракторный двор: ящик обходного течения',
} as const;

type DoorSide = 'north' | 'south' | 'west' | 'east';
type FlowId = 'main_stream' | 'return_stream' | 'dead_cut';

interface Point {
  x: number;
  y: number;
}

interface DoorSite {
  x: number;
  y: number;
  ox: number;
  oy: number;
}

interface AttractorHqSupportSpec {
  type: RoomType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  doorSide: DoorSide;
  targetX: number;
  targetY: number;
}

interface AttractorHqSpec {
  owner: TerritoryOwner;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  doorSide: DoorSide;
  targetX: number;
  targetY: number;
  supports: readonly AttractorHqSupportSpec[];
}

interface AttractorStationSpec {
  x: number;
  y: number;
  owner: TerritoryOwner;
  vertical?: boolean;
  label: string;
}

interface AttractorRooms {
  entry: Room;
  northSpine: Room;
  eastSpine: Room;
  southSpine: Room;
  westSpine: Room;
  pumpCore: Room;
  deadZone: Room;
  guardLoop: Room;
  westSwitch: Room;
  eastSwitch: Room;
  northSwitch: Room;
  transitCache: Room;
}

export interface AttractorStreamline {
  id: FlowId;
  label: string;
  points: readonly Point[];
  cellCount: number;
  risk: 1 | 2 | 3 | 4 | 5;
}

export interface AttractorSwitchPanel {
  id: string;
  roomName: string;
  panelDefId: 'panel_doors' | 'panel_vent' | 'panel_power';
  x: number;
  y: number;
  parameter: 'curl' | 'damping' | 'phase';
}

export interface AttractorPatrolLoop {
  id: string;
  roomNames: readonly string[];
  guardCount: number;
  predictionHint: string;
}

export interface AttractorDvorState {
  routeId: typeof ATTRACTOR_DVOR_ROUTE_ID;
  z: typeof ATTRACTOR_DVOR_Z;
  baseFloor: typeof ATTRACTOR_DVOR_BASE_FLOOR;
  streamlines: readonly AttractorStreamline[];
  switchPanels: readonly AttractorSwitchPanel[];
  patrolLoops: readonly AttractorPatrolLoop[];
  deadZoneRoomName: string;
  debugEntry: {
    spawnX: number;
    spawnY: number;
    summary: string;
  };
}

const attractorStates = new WeakMap<World, AttractorDvorState>();

export function getAttractorDvorState(world: World): AttractorDvorState | undefined {
  const state = attractorStates.get(world);
  if (!state) return undefined;
  return {
    ...state,
    streamlines: state.streamlines.map(flow => ({
      ...flow,
      points: flow.points.map(point => ({ ...point })),
    })),
    switchPanels: state.switchPanels.map(panel => ({ ...panel })),
    patrolLoops: state.patrolLoops.map(loop => ({ ...loop, roomNames: [...loop.roomNames] })),
    debugEntry: { ...state.debugEntry },
  };
}

const FLOW_SPECS: readonly Omit<AttractorStreamline, 'cellCount'>[] = [
  {
    id: 'main_stream',
    label: 'синяя струя быстрого двора',
    risk: 2,
    points: [
      { x: CX, y: 766 }, { x: 423, y: 700 }, { x: 352, y: 612 },
      { x: 358, y: 472 }, { x: 426, y: 376 }, { x: CX, y: 348 },
      { x: 650, y: 390 }, { x: 714, y: CY }, { x: 650, y: 646 },
      { x: CX, y: 666 },
    ],
  },
  {
    id: 'return_stream',
    label: 'желтая возвратная струя патруля',
    risk: 3,
    points: [
      { x: 338, y: CY }, { x: 408, y: 430 }, { x: 514, y: 398 },
      { x: 624, y: 432 }, { x: 692, y: CY }, { x: 620, y: 612 },
      { x: 510, y: 626 }, { x: 408, y: 596 }, { x: 338, y: CY },
    ],
  },
  {
    id: 'dead_cut',
    label: 'сухой рез через мертвую зону',
    risk: 5,
    points: [
      { x: CX, y: 684 }, { x: CX - 10, y: 620 }, { x: CX + 12, y: 584 },
      { x: CX - 8, y: 536 }, { x: CX + 10, y: 474 }, { x: CX, y: 392 },
    ],
  },
];

const ATTRACTOR_HQ_COMPOUNDS: readonly AttractorHqSpec[] = [
  {
    owner: ZoneFaction.CITIZEN,
    name: 'Аттракторный двор: гражданский штаб расходной очереди',
    x: 142,
    y: 168,
    w: 38,
    h: 22,
    doorSide: 'east',
    targetX: 214,
    targetY: 180,
    supports: [
      { type: RoomType.KITCHEN, name: 'Аттракторный двор: кухня расходной очереди', x: 112, y: 170, w: 20, h: 14, doorSide: 'east', targetX: 214, targetY: 180 },
      { type: RoomType.COMMON, name: 'Аттракторный двор: комната старших потока', x: 145, y: 198, w: 34, h: 16, doorSide: 'north', targetX: 214, targetY: 180 },
      { type: RoomType.STORAGE, name: 'Аттракторный двор: склад общих прокладок', x: 188, y: 168, w: 22, h: 14, doorSide: 'west', targetX: 214, targetY: 180 },
      { type: RoomType.MEDICAL, name: 'Аттракторный двор: медпункт слабого напора', x: 146, y: 140, w: 24, h: 14, doorSide: 'south', targetX: 214, targetY: 180 },
    ],
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    name: 'Аттракторный двор: главный ликвидаторский штаб петли',
    x: 778,
    y: 144,
    w: 48,
    h: 28,
    doorSide: 'south',
    targetX: 802,
    targetY: 206,
    supports: [
      { type: RoomType.STORAGE, name: 'Аттракторный двор: оружейная быстрой струи', x: 744, y: 150, w: 24, h: 16, doorSide: 'east', targetX: 802, targetY: 206 },
      { type: RoomType.OFFICE, name: 'Аттракторный двор: журнал петлевой охраны', x: 834, y: 150, w: 28, h: 16, doorSide: 'west', targetX: 802, targetY: 206 },
      { type: RoomType.MEDICAL, name: 'Аттракторный двор: санитарный шлюз ликвидаторов', x: 782, y: 108, w: 30, h: 16, doorSide: 'south', targetX: 802, targetY: 206 },
      { type: RoomType.KITCHEN, name: 'Аттракторный двор: полевая кухня петли', x: 782, y: 184, w: 32, h: 16, doorSide: 'north', targetX: 802, targetY: 206 },
    ],
  },
  {
    owner: ZoneFaction.SCIENTIST,
    name: 'Аттракторный двор: НИИ-штаб фазовой решетки',
    x: 476,
    y: 112,
    w: 44,
    h: 26,
    doorSide: 'south',
    targetX: 512,
    targetY: 166,
    supports: [
      { type: RoomType.OFFICE, name: 'Аттракторный двор: кабинет фазовых протоколов', x: 430, y: 116, w: 30, h: 16, doorSide: 'east', targetX: 512, targetY: 166 },
      { type: RoomType.STORAGE, name: 'Аттракторный двор: архив датчиков притяжения', x: 530, y: 116, w: 28, h: 16, doorSide: 'west', targetX: 512, targetY: 166 },
      { type: RoomType.MEDICAL, name: 'Аттракторный двор: измерительная медкомната', x: 478, y: 76, w: 30, h: 16, doorSide: 'south', targetX: 512, targetY: 166 },
      { type: RoomType.PRODUCTION, name: 'Аттракторный двор: стенд сухого вихря', x: 482, y: 150, w: 34, h: 18, doorSide: 'north', targetX: 512, targetY: 166 },
    ],
  },
  {
    owner: ZoneFaction.CULTIST,
    name: 'Аттракторный двор: скрытый культовый штаб обратной струи',
    x: 182,
    y: 792,
    w: 34,
    h: 22,
    doorSide: 'east',
    targetX: 236,
    targetY: 804,
    supports: [
      { type: RoomType.COMMON, name: 'Аттракторный двор: тихая комната кругового следа', x: 142, y: 790, w: 26, h: 16, doorSide: 'east', targetX: 236, targetY: 804 },
      { type: RoomType.STORAGE, name: 'Аттракторный двор: кладовая свечей потока', x: 226, y: 790, w: 24, h: 16, doorSide: 'west', targetX: 236, targetY: 804 },
      { type: RoomType.KITCHEN, name: 'Аттракторный двор: кухня ритуального кипятка', x: 182, y: 824, w: 26, h: 16, doorSide: 'north', targetX: 236, targetY: 804 },
      { type: RoomType.BATHROOM, name: 'Аттракторный двор: мокрый предбанник обратной струи', x: 184, y: 756, w: 24, h: 16, doorSide: 'south', targetX: 236, targetY: 804 },
    ],
  },
  {
    owner: ZoneFaction.WILD,
    name: 'Аттракторный двор: дикий штаб сухого кармана',
    x: 796,
    y: 812,
    w: 42,
    h: 24,
    doorSide: 'west',
    targetX: 760,
    targetY: 824,
    supports: [
      { type: RoomType.STORAGE, name: 'Аттракторный двор: разобранная кладовая диких', x: 848, y: 814, w: 28, h: 16, doorSide: 'west', targetX: 760, targetY: 824 },
      { type: RoomType.SMOKING, name: 'Аттракторный двор: курилка самозахвата', x: 760, y: 850, w: 28, h: 16, doorSide: 'north', targetX: 760, targetY: 824 },
      { type: RoomType.COMMON, name: 'Аттракторный двор: общий угол сухого кармана', x: 756, y: 786, w: 30, h: 16, doorSide: 'south', targetX: 760, targetY: 824 },
      { type: RoomType.BATHROOM, name: 'Аттракторный двор: сломанный душ сухого кармана', x: 842, y: 790, w: 24, h: 16, doorSide: 'west', targetX: 760, targetY: 824 },
    ],
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    name: 'Аттракторный двор: ликвидаторский форпост восточного завихрения',
    x: 884,
    y: 454,
    w: 36,
    h: 20,
    doorSide: 'west',
    targetX: 842,
    targetY: 466,
    supports: [
      { type: RoomType.STORAGE, name: 'Аттракторный двор: шкаф восточного форпоста', x: 928, y: 454, w: 22, h: 14, doorSide: 'west', targetX: 842, targetY: 466 },
      { type: RoomType.OFFICE, name: 'Аттракторный двор: стол восточного дозора', x: 884, y: 486, w: 28, h: 14, doorSide: 'north', targetX: 842, targetY: 466 },
    ],
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    name: 'Аттракторный двор: ликвидаторский форпост нижней петли',
    x: 454,
    y: 846,
    w: 38,
    h: 20,
    doorSide: 'north',
    targetX: 480,
    targetY: 810,
    supports: [
      { type: RoomType.STORAGE, name: 'Аттракторный двор: шкаф нижнего форпоста', x: 410, y: 846, w: 24, h: 14, doorSide: 'east', targetX: 480, targetY: 810 },
      { type: RoomType.MEDICAL, name: 'Аттракторный двор: перевязочный угол нижней петли', x: 500, y: 846, w: 26, h: 14, doorSide: 'west', targetX: 480, targetY: 810 },
    ],
  },
];

const ATTRACTOR_STATIONS: readonly AttractorStationSpec[] = [
  { x: 118, y: 118, owner: ZoneFaction.CITIZEN, label: 'северо-западный расход' },
  { x: 314, y: 126, owner: ZoneFaction.LIQUIDATOR, label: 'северный затвор' },
  { x: 626, y: 126, owner: ZoneFaction.SCIENTIST, label: 'северная фазовая полка' },
  { x: 904, y: 122, owner: ZoneFaction.LIQUIDATOR, label: 'северо-восточный пост' },
  { x: 126, y: 334, owner: ZoneFaction.WILD, vertical: true, label: 'левая дальняя струя' },
  { x: 300, y: 304, owner: ZoneFaction.CITIZEN, label: 'пункт выдачи сухих талонов' },
  { x: 726, y: 306, owner: ZoneFaction.SCIENTIST, label: 'стенд бокового сдвига' },
  { x: 904, y: 344, owner: ZoneFaction.LIQUIDATOR, vertical: true, label: 'правый патрульный крюк' },
  { x: 118, y: 522, owner: ZoneFaction.CULTIST, vertical: true, label: 'серая обратная щель' },
  { x: 260, y: 524, owner: ZoneFaction.WILD, label: 'дикий разборный остров' },
  { x: 764, y: 520, owner: ZoneFaction.LIQUIDATOR, label: 'узел внешней петли' },
  { x: 910, y: 526, owner: ZoneFaction.WILD, vertical: true, label: 'правый сухой карман' },
  { x: 128, y: 708, owner: ZoneFaction.CULTIST, label: 'нижний след струи' },
  { x: 330, y: 736, owner: ZoneFaction.WILD, label: 'паечная свалка' },
  { x: 530, y: 748, owner: ZoneFaction.LIQUIDATOR, label: 'нижний пульт напора' },
  { x: 720, y: 730, owner: ZoneFaction.SCIENTIST, label: 'сухая лаборатория завихрения' },
  { x: 904, y: 730, owner: ZoneFaction.WILD, label: 'крайний самозахват' },
  { x: 126, y: 910, owner: ZoneFaction.CULTIST, label: 'нижняя скрытая петля' },
  { x: 332, y: 900, owner: ZoneFaction.CITIZEN, label: 'нижний жилой остров' },
  { x: 520, y: 908, owner: ZoneFaction.WILD, label: 'разгрузка сухих труб' },
  { x: 710, y: 896, owner: ZoneFaction.LIQUIDATOR, label: 'нижний ликвидаторский проход' },
  { x: 910, y: 904, owner: ZoneFaction.WILD, label: 'юго-восточный сухой двор' },
];

export function generateAttractorDvorDesignFloor(): FloorGeneration {
  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 1 };

  initWorld(world);
  const rooms = buildRooms(world);
  const streamlines = carveAttractorStreamlines(world);
  connectRoomsGraph(world, rooms);
  decorateRooms(world, rooms);
  placeLifts(world, rooms);
  generateZones(world);
  tuneAttractorDvorRouteZones(world);
  const switchPanels = placeAttractorDvorEmergencyPanels(world);
  registerAttractorRouteCues(world, rooms);
  placeContainers(world, rooms);
  spawnActors(world, entities, nextId, rooms);

  sanitizeDoors(world);
  ensureConnectivity(world, rooms.entry.x + 82.5, rooms.entry.y + 17.5);
  world.rebuildContainerMap();
  world.bakeLights();

  const state: AttractorDvorState = {
    routeId: ATTRACTOR_DVOR_ROUTE_ID,
    z: ATTRACTOR_DVOR_Z,
    baseFloor: ATTRACTOR_DVOR_BASE_FLOOR,
    streamlines,
    switchPanels,
    patrolLoops: [
      {
        id: 'limit_cycle_guard_ring',
        roomNames: [
          ATTRACTOR_DVOR_ROOM_NAMES.southSpine,
          ATTRACTOR_DVOR_ROOM_NAMES.westSpine,
          ATTRACTOR_DVOR_ROOM_NAMES.northSpine,
          ATTRACTOR_DVOR_ROOM_NAMES.eastSpine,
        ],
        guardCount: 4,
        predictionHint: 'Патруль держится внешней петли; срез через мертвую зону короче, но шумнее.',
      },
    ],
    deadZoneRoomName: ATTRACTOR_DVOR_ROOM_NAMES.deadZone,
    debugEntry: {
      spawnX: rooms.entry.x + 82.5,
      spawnY: rooms.entry.y + 17.5,
      summary: 'flow corridors, three local parameter panels, dead-zone cut and limit-cycle patrol ring',
    },
  };
  attractorStates.set(world, state);

  return {
    world,
    entities,
    spawnX: state.debugEntry.spawnX,
    spawnY: state.debugEntry.spawnY,
  };
}

export function expandAttractorDvorRouteGeometry(world: World, rng: () => number): void {
  carveAttractorOuterFlowField(world, rng);
  const expansionFlows = [
    [{ x: 42, y: 214 }, { x: 236, y: 158 }, { x: 514, y: 216 }, { x: 812, y: 154 }, { x: 990, y: 236 }],
    [{ x: 34, y: 824 }, { x: 246, y: 762 }, { x: 520, y: 804 }, { x: 780, y: 748 }, { x: 986, y: 822 }],
    [{ x: 190, y: 38 }, { x: 154, y: 256 }, { x: 220, y: 512 }, { x: 148, y: 782 }, { x: 208, y: 988 }],
    [{ x: 838, y: 38 }, { x: 880, y: 274 }, { x: 818, y: 512 }, { x: 884, y: 764 }, { x: 830, y: 988 }],
  ] as const;
  for (let i = 0; i < expansionFlows.length; i++) {
    const flow = expansionFlows[i].map(point => ({
      x: point.x + Math.round((rng() * 2 - 1) * 18),
      y: point.y + Math.round((rng() * 2 - 1) * 18),
    }));
    carvePolyline(world, flow, i % 2 === 0 ? 3 : 2, FLOW_FLOOR, 4200 + i * 173, i % 2 === 0 ? [82, 156, 230] : [210, 188, 92]);
    const room = addRoom(
      world,
      i % 2 === 0 ? RoomType.PRODUCTION : RoomType.STORAGE,
      flow[2].x - 18,
      flow[2].y - 12,
      36,
      24,
      `Аттракторный двор: дальний вихревой карман ${i + 1}`,
      i % 2 === 0 ? Tex.PIPE : Tex.METAL,
      FLOW_FLOOR,
    );
    decoratePocket(world, room, i);
  }
  buildAttractorHqCompounds(world);
  buildAttractorMidStations(world);
  buildAttractorServiceBays(world, rng);
  world.markCellsDirty();
  world.markFloorTexDirty();
  world.markWallTexDirty();
  world.markFeaturesDirty(true);
}

export function tuneAttractorDvorRouteZones(world: World, syncCellField = true): void {
  for (const zone of world.zones) {
    const d = world.dist(zone.cx, zone.cy, CX, CY);
    const inCore = d < 178;
    const inOuterFlow = zone.cx < 236 || zone.cx > 788 || zone.cy < 236 || zone.cy > 788;
    const inDeadCut = zone.cx >= 450 && zone.cx <= 580 && zone.cy >= 520 && zone.cy <= 640;
    if (inDeadCut) {
      zone.faction = ZoneFaction.SAMOSBOR;
      zone.level = Math.max(zone.level, 5);
    } else if (inCore) {
      zone.faction = ZoneFaction.LIQUIDATOR;
      zone.level = Math.max(zone.level, 4);
    } else if (inOuterFlow) {
      zone.faction = zone.id % 3 === 0 ? ZoneFaction.WILD : ZoneFaction.LIQUIDATOR;
      zone.level = Math.max(zone.level, 3);
    } else {
      zone.faction = zone.id % 5 === 0 ? ZoneFaction.CITIZEN : ZoneFaction.LIQUIDATOR;
      zone.level = Math.max(zone.level, 3);
    }
    zone.fogged = false;
  }
  if (syncCellField) {
    for (let i = 0; i < W * W; i++) {
      world.factionControl[i] = world.zones[world.zoneMap[i]]?.faction ?? ZoneFaction.LIQUIDATOR;
    }
    paintAttractorAuthoredHqOwners(world);
  }
}

export function placeAttractorDvorEmergencyPanels(world: World): AttractorSwitchPanel[] {
  const panels: AttractorSwitchPanel[] = [];
  const west = roomByName(world, ATTRACTOR_DVOR_ROOM_NAMES.westSwitch);
  const east = roomByName(world, ATTRACTOR_DVOR_ROOM_NAMES.eastSwitch);
  const north = roomByName(world, ATTRACTOR_DVOR_ROOM_NAMES.northSwitch);
  if (west) {
    placeEmergencyPanel(world, west.x + 8, west.y + 10, 'panel_doors', 0x88a1);
    panels.push({ id: 'attractor_west_curl', roomName: west.name, panelDefId: 'panel_doors', x: west.x + 8, y: west.y + 10, parameter: 'curl' });
  }
  if (east) {
    placeEmergencyPanel(world, east.x + east.w - 9, east.y + 10, 'panel_vent', 0x88a2);
    panels.push({ id: 'attractor_east_damping', roomName: east.name, panelDefId: 'panel_vent', x: east.x + east.w - 9, y: east.y + 10, parameter: 'damping' });
  }
  if (north) {
    placeEmergencyPanel(world, north.x + (north.w >> 1), north.y + 10, 'panel_power', 0x88a3);
    panels.push({ id: 'attractor_north_phase', roomName: north.name, panelDefId: 'panel_power', x: north.x + (north.w >> 1), y: north.y + 10, parameter: 'phase' });
  }
  return panels;
}

function initWorld(world: World): void {
  for (let i = 0; i < W * W; i++) {
    world.wallTex[i] = Tex.PIPE;
    world.floorTex[i] = FLOW_FLOOR;
    world.fog[i] = 10;
    world.factionControl[i] = ZoneFaction.LIQUIDATOR;
  }
}

function buildRooms(world: World): AttractorRooms {
  return {
    entry: addRoom(world, RoomType.CORRIDOR, CX - 82, CY + 236, 164, 34, ATTRACTOR_DVOR_ROOM_NAMES.entry, Tex.METAL, FLOW_FLOOR),
    northSpine: addRoom(world, RoomType.CORRIDOR, CX - 174, CY - 164, 348, 28, ATTRACTOR_DVOR_ROOM_NAMES.northSpine, Tex.PIPE, FLOW_FLOOR),
    eastSpine: addRoom(world, RoomType.CORRIDOR, CX + 136, CY - 136, 30, 274, ATTRACTOR_DVOR_ROOM_NAMES.eastSpine, Tex.PIPE, FLOW_FLOOR),
    southSpine: addRoom(world, RoomType.CORRIDOR, CX - 174, CY + 136, 348, 30, ATTRACTOR_DVOR_ROOM_NAMES.southSpine, Tex.PIPE, FLOW_FLOOR),
    westSpine: addRoom(world, RoomType.CORRIDOR, CX - 166, CY - 136, 30, 274, ATTRACTOR_DVOR_ROOM_NAMES.westSpine, Tex.PIPE, FLOW_FLOOR),
    pumpCore: addRoom(world, RoomType.PRODUCTION, CX - 42, CY - 38, 84, 70, ATTRACTOR_DVOR_ROOM_NAMES.pumpCore, Tex.METAL, FLOW_FLOOR),
    deadZone: addRoom(world, RoomType.STORAGE, CX - 58, CY + 46, 116, 62, ATTRACTOR_DVOR_ROOM_NAMES.deadZone, Tex.HERMO_WALL, DEAD_FLOOR, true),
    guardLoop: addRoom(world, RoomType.OFFICE, CX - 44, CY - 108, 88, 40, ATTRACTOR_DVOR_ROOM_NAMES.guardLoop, Tex.METAL, FLOW_FLOOR),
    westSwitch: addRoom(world, RoomType.OFFICE, CX - 232, CY - 34, 58, 44, ATTRACTOR_DVOR_ROOM_NAMES.westSwitch, Tex.METAL, FLOW_FLOOR),
    eastSwitch: addRoom(world, RoomType.OFFICE, CX + 174, CY - 34, 58, 44, ATTRACTOR_DVOR_ROOM_NAMES.eastSwitch, Tex.METAL, FLOW_FLOOR),
    northSwitch: addRoom(world, RoomType.PRODUCTION, CX - 40, CY - 226, 80, 44, ATTRACTOR_DVOR_ROOM_NAMES.northSwitch, Tex.PIPE, FLOW_FLOOR),
    transitCache: addRoom(world, RoomType.STORAGE, CX + 86, CY + 54, 56, 50, ATTRACTOR_DVOR_ROOM_NAMES.transitCache, Tex.METAL, FLOW_FLOOR),
  };
}

function carveAttractorStreamlines(world: World): AttractorStreamline[] {
  return FLOW_SPECS.map((spec, index) => ({
    ...spec,
    cellCount: carvePolyline(
      world,
      spec.points,
      spec.id === 'dead_cut' ? 1 : 2,
      spec.id === 'dead_cut' ? Tex.F_WATER : FLOW_FLOOR,
      2200 + index * 211,
      spec.id === 'main_stream' ? [82, 156, 230] : spec.id === 'return_stream' ? [220, 192, 86] : [90, 90, 100],
    ),
  }));
}

function connectRoomsGraph(world: World, rooms: AttractorRooms): void {
  connectRooms(world, rooms.entry, 'north', rooms.southSpine, 'south', DoorState.CLOSED);
  connectRooms(world, rooms.southSpine, 'west', rooms.westSpine, 'south', DoorState.CLOSED);
  connectRooms(world, rooms.southSpine, 'east', rooms.eastSpine, 'south', DoorState.CLOSED);
  connectRooms(world, rooms.westSpine, 'north', rooms.northSpine, 'west', DoorState.CLOSED);
  connectRooms(world, rooms.eastSpine, 'north', rooms.northSpine, 'east', DoorState.CLOSED);
  connectRooms(world, rooms.northSpine, 'south', rooms.guardLoop, 'north', DoorState.CLOSED);
  connectRooms(world, rooms.guardLoop, 'south', rooms.pumpCore, 'north', DoorState.CLOSED);
  connectRooms(world, rooms.pumpCore, 'south', rooms.deadZone, 'north', DoorState.HERMETIC_CLOSED);
  connectRooms(world, rooms.deadZone, 'south', rooms.southSpine, 'north', DoorState.LOCKED, 'attractor_dead_cut');
  connectRooms(world, rooms.deadZone, 'east', rooms.transitCache, 'west', DoorState.LOCKED, 'attractor_transit_cache');
  connectRooms(world, rooms.westSwitch, 'east', rooms.westSpine, 'west', DoorState.CLOSED);
  connectRooms(world, rooms.eastSwitch, 'west', rooms.eastSpine, 'east', DoorState.CLOSED);
  connectRooms(world, rooms.northSwitch, 'south', rooms.northSpine, 'north', DoorState.CLOSED);
}

function decorateRooms(world: World, rooms: AttractorRooms): void {
  for (const spine of [rooms.northSpine, rooms.eastSpine, rooms.southSpine, rooms.westSpine]) {
    const long = Math.max(spine.w, spine.h);
    for (let n = 8; n < long - 4; n += 34) {
      const x = spine.w >= spine.h ? spine.x + n : spine.x + (spine.w >> 1);
      const y = spine.w >= spine.h ? spine.y + (spine.h >> 1) : spine.y + n;
      setFeature(world, x, y, n % 68 === 0 ? Feature.APPARATUS : Feature.LAMP);
    }
  }
  for (let x = rooms.pumpCore.x + 10; x < rooms.pumpCore.x + rooms.pumpCore.w - 8; x += 16) {
    setFeature(world, x, rooms.pumpCore.y + 16, Feature.APPARATUS);
  }
  setFeature(world, rooms.pumpCore.x + 14, rooms.pumpCore.y + rooms.pumpCore.h - 12, Feature.SCREEN);
  setFeature(world, rooms.guardLoop.x + 12, rooms.guardLoop.y + 12, Feature.DESK);
  setFeature(world, rooms.guardLoop.x + 32, rooms.guardLoop.y + 12, Feature.SCREEN);
  setFeature(world, rooms.guardLoop.x + 62, rooms.guardLoop.y + 22, Feature.CHAIR);
  decorateSwitchRoom(world, rooms.westSwitch, 'west');
  decorateSwitchRoom(world, rooms.eastSwitch, 'east');
  decorateSwitchRoom(world, rooms.northSwitch, 'north');
  for (let x = rooms.deadZone.x + 6; x < rooms.deadZone.x + rooms.deadZone.w - 5; x += 11) {
    for (let y = rooms.deadZone.y + 6; y < rooms.deadZone.y + rooms.deadZone.h - 5; y += 13) {
      const idx = world.idx(x, y);
      if (((x * 19 + y * 23) & 3) === 0) {
        world.cells[idx] = Cell.WATER;
        world.floorTex[idx] = DEAD_FLOOR;
      }
    }
  }
  setFeature(world, rooms.transitCache.x + 9, rooms.transitCache.y + 10, Feature.SHELF);
  setFeature(world, rooms.transitCache.x + rooms.transitCache.w - 10, rooms.transitCache.y + rooms.transitCache.h - 10, Feature.SHELF);
}

function decorateSwitchRoom(world: World, room: Room, side: string): void {
  setFeature(world, room.x + (room.w >> 1), room.y + 12, Feature.SCREEN);
  setFeature(world, room.x + 8, room.y + room.h - 10, side === 'north' ? Feature.APPARATUS : Feature.DESK);
  setFeature(world, room.x + room.w - 9, room.y + room.h - 10, Feature.CHAIR);
}

function decoratePocket(world: World, room: Room, serial: number): void {
  setFeature(world, room.x + 8, room.y + 8, serial % 2 === 0 ? Feature.APPARATUS : Feature.SHELF);
  setFeature(world, room.x + room.w - 9, room.y + room.h - 9, serial % 2 === 0 ? Feature.LAMP : Feature.CHAIR);
}

function carveAttractorOuterFlowField(world: World, rng: () => number): void {
  const flows: readonly (readonly Point[])[] = [
    [{ x: 42, y: 128 }, { x: 250, y: 92 }, { x: 512, y: 134 }, { x: 774, y: 92 }, { x: 982, y: 130 }],
    [{ x: 42, y: 884 }, { x: 256, y: 930 }, { x: 512, y: 884 }, { x: 766, y: 930 }, { x: 982, y: 882 }],
    [{ x: 112, y: 42 }, { x: 76, y: 260 }, { x: 124, y: 512 }, { x: 78, y: 760 }, { x: 118, y: 982 }],
    [{ x: 904, y: 42 }, { x: 942, y: 264 }, { x: 896, y: 512 }, { x: 944, y: 760 }, { x: 902, y: 982 }],
    [{ x: 66, y: 334 }, { x: 262, y: 302 }, { x: 512, y: 352 }, { x: 762, y: 302 }, { x: 958, y: 338 }],
    [{ x: 66, y: 704 }, { x: 262, y: 746 }, { x: 512, y: 706 }, { x: 762, y: 746 }, { x: 958, y: 704 }],
  ];
  for (let i = 0; i < flows.length; i++) {
    const flow = flows[i].map(point => ({
      x: point.x + Math.round((rng() * 2 - 1) * 9),
      y: point.y + Math.round((rng() * 2 - 1) * 9),
    }));
    carvePolyline(world, flow, i < 4 ? 4 : 3, FLOW_FLOOR, 0x8a00 + i * 97, i % 2 === 0 ? [92, 158, 220] : [210, 180, 84]);
  }
  for (const target of [
    { x: 112, y: 128 }, { x: 904, y: 128 },
    { x: 112, y: 884 }, { x: 904, y: 884 },
    { x: 512, y: 128 }, { x: 512, y: 884 },
    { x: 112, y: 512 }, { x: 904, y: 512 },
  ]) {
    carveLineWidth(world, target.x, target.y, CX, CY, 2, FLOW_FLOOR, 0x8ad0 + target.x + target.y, [86, 138, 186]);
  }
}

function buildAttractorHqCompounds(world: World): void {
  for (const spec of ATTRACTOR_HQ_COMPOUNDS) {
    const target = nearestAttractorFlowPoint(world, spec.targetX, spec.targetY);
    carveLineWidth(world, spec.targetX, spec.targetY, target.x, target.y, 2, FLOW_FLOOR, 0x8b00 + spec.owner * 41 + spec.x, [130, 160, 190]);
    const hq = tryAddAttractorRoom(world, RoomType.HQ, spec.x, spec.y, spec.w, spec.h, spec.name, Tex.HERMO_WALL, FLOW_FLOOR, true);
    if (!hq) continue;
    paintAttractorRoomOwner(world, hq, spec.owner);
    connectRoomToPoint(world, hq, spec.doorSide, spec.targetX, spec.targetY, DoorState.HERMETIC_OPEN);
    decorateAttractorExpansionRoom(world, hq, spec.owner, 0);
    for (let i = 0; i < spec.supports.length; i++) {
      const support = spec.supports[i];
      const room = tryAddAttractorRoom(
        world,
        support.type,
        support.x,
        support.y,
        support.w,
        support.h,
        support.name,
        wallTexForAttractorRoom(support.type),
        floorTexForAttractorRoom(support.type),
      );
      if (!room) continue;
      paintAttractorRoomOwner(world, room, spec.owner);
      connectRoomToPoint(world, room, support.doorSide, support.targetX, support.targetY, DoorState.CLOSED);
      decorateAttractorExpansionRoom(world, room, spec.owner, i + 1);
    }
  }
}

function buildAttractorMidStations(world: World): void {
  for (let i = 0; i < ATTRACTOR_STATIONS.length; i++) {
    const spec = ATTRACTOR_STATIONS[i];
    const w = spec.vertical ? 22 : 70;
    const h = spec.vertical ? 70 : 22;
    const room = tryAddAttractorRoom(
      world,
      i % 3 === 0 ? RoomType.PRODUCTION : RoomType.CORRIDOR,
      spec.x - (w >> 1),
      spec.y - (h >> 1),
      w,
      h,
      `Аттракторный двор: средний распределитель ${spec.label}`,
      Tex.METAL,
      FLOW_FLOOR,
    );
    if (!room) continue;
    paintAttractorRoomOwner(world, room, spec.owner);
    const target = nearestAttractorFlowPoint(world, spec.x, spec.y);
    connectRoomToPoint(world, room, sideTowardPoint(room, target.x, target.y), target.x, target.y, DoorState.CLOSED);
    decorateAttractorExpansionRoom(world, room, spec.owner, i);
    stampAttractorStationMicros(world, room, spec, i);
  }
}

function stampAttractorStationMicros(world: World, hall: Room, spec: AttractorStationSpec, serial: number): void {
  const base: readonly AttractorHqSupportSpec[] = spec.vertical
    ? [
        { type: RoomType.STORAGE, name: 'шкаф фильтров', x: hall.x - 24, y: hall.y + 4, w: 16, h: 12, doorSide: 'east', targetX: hall.x + (hall.w >> 1), targetY: hall.y + 12 },
        { type: RoomType.OFFICE, name: 'будка наблюдения', x: hall.x + hall.w + 8, y: hall.y + 6, w: 18, h: 12, doorSide: 'west', targetX: hall.x + (hall.w >> 1), targetY: hall.y + 18 },
        { type: RoomType.BATHROOM, name: 'мокрый шкаф', x: hall.x - 24, y: hall.y + hall.h - 18, w: 16, h: 12, doorSide: 'east', targetX: hall.x + (hall.w >> 1), targetY: hall.y + hall.h - 16 },
        { type: RoomType.COMMON, name: 'угол ожидания', x: hall.x + hall.w + 8, y: hall.y + hall.h - 20, w: 18, h: 14, doorSide: 'west', targetX: hall.x + (hall.w >> 1), targetY: hall.y + hall.h - 16 },
      ]
    : [
        { type: RoomType.STORAGE, name: 'шкаф фильтров', x: hall.x + 4, y: hall.y - 22, w: 18, h: 12, doorSide: 'south', targetX: hall.x + 12, targetY: hall.y + (hall.h >> 1) },
        { type: RoomType.OFFICE, name: 'будка наблюдения', x: hall.x + 26, y: hall.y - 22, w: 18, h: 12, doorSide: 'south', targetX: hall.x + 34, targetY: hall.y + (hall.h >> 1) },
        { type: RoomType.BATHROOM, name: 'мокрый шкаф', x: hall.x + 4, y: hall.y + hall.h + 8, w: 18, h: 12, doorSide: 'north', targetX: hall.x + 12, targetY: hall.y + (hall.h >> 1) },
        { type: RoomType.COMMON, name: 'угол ожидания', x: hall.x + 28, y: hall.y + hall.h + 8, w: 22, h: 14, doorSide: 'north', targetX: hall.x + 40, targetY: hall.y + (hall.h >> 1) },
      ];
  for (let i = 0; i < base.length; i++) {
    const item = base[i];
    const room = tryAddAttractorRoom(
      world,
      item.type,
      item.x,
      item.y,
      item.w,
      item.h,
      `Аттракторный двор: микрокамера ${spec.label}: ${item.name}`,
      wallTexForAttractorRoom(item.type),
      floorTexForAttractorRoom(item.type),
    );
    if (!room) continue;
    paintAttractorRoomOwner(world, room, spec.owner);
    connectRoomToPoint(world, room, item.doorSide, item.targetX, item.targetY, DoorState.CLOSED);
    decorateAttractorExpansionRoom(world, room, spec.owner, serial * 7 + i);
  }
}

function buildAttractorServiceBays(world: World, rng: () => number): void {
  const rows = [82, 236, 792, 944] as const;
  for (let row = 0; row < rows.length; row++) {
    const y = rows[row];
    for (let n = 0; n < 23; n++) {
      const x = 68 + n * 40 + Math.round((rng() * 2 - 1) * 5);
      const above = (n + row) % 2 === 0;
      const roomY = y + (above ? -25 : 15);
      const w = 15 + ((n + row) % 4) * 3;
      const h = 10 + ((n + row) % 3);
      const owner = attractorOwnerForPoint(x, roomY);
      const type = attractorMicroRoomType(n + row * 31);
      const room = tryAddAttractorRoom(
        world,
        type,
        x - (w >> 1),
        roomY,
        w,
        h,
        `Аттракторный двор: поточный шкаф ${row + 1}-${n + 1}`,
        wallTexForAttractorRoom(type),
        floorTexForAttractorRoom(type),
      );
      if (!room) continue;
      paintAttractorRoomOwner(world, room, owner);
      connectRoomToPoint(world, room, above ? 'south' : 'north', x, y, DoorState.CLOSED);
      decorateAttractorExpansionRoom(world, room, owner, n);
    }
  }

  const cols = [82, 234, 790, 942] as const;
  for (let col = 0; col < cols.length; col++) {
    const x = cols[col];
    for (let n = 0; n < 18; n++) {
      const y = 82 + n * 48 + Math.round((rng() * 2 - 1) * 5);
      const left = (n + col) % 2 === 0;
      const roomX = x + (left ? -28 : 15);
      const w = 14 + ((n + col) % 3) * 3;
      const h = 11 + ((n + col) % 4);
      const owner = attractorOwnerForPoint(roomX, y);
      const type = attractorMicroRoomType(n + col * 23 + 11);
      const room = tryAddAttractorRoom(
        world,
        type,
        roomX,
        y - (h >> 1),
        w,
        h,
        `Аттракторный двор: боковая будка ${col + 1}-${n + 1}`,
        wallTexForAttractorRoom(type),
        floorTexForAttractorRoom(type),
      );
      if (!room) continue;
      paintAttractorRoomOwner(world, room, owner);
      connectRoomToPoint(world, room, left ? 'east' : 'west', x, y, DoorState.CLOSED);
      decorateAttractorExpansionRoom(world, room, owner, n + 100);
    }
  }
}

function attractorMicroRoomType(serial: number): RoomType {
  switch (serial % 7) {
    case 0: return RoomType.STORAGE;
    case 1: return RoomType.OFFICE;
    case 2: return RoomType.BATHROOM;
    case 3: return RoomType.KITCHEN;
    case 4: return RoomType.COMMON;
    case 5: return RoomType.SMOKING;
    default: return RoomType.PRODUCTION;
  }
}

function attractorOwnerForPoint(x: number, y: number): TerritoryOwner {
  if (x < 300 && y > 620) return ZoneFaction.CULTIST;
  if (x > 680 && y < 620) return ZoneFaction.LIQUIDATOR;
  if (y < 220 && x >= 360 && x <= 700) return ZoneFaction.SCIENTIST;
  if (y > 700 || x > 850) return ZoneFaction.WILD;
  if (x < 340 && y < 430) return ZoneFaction.CITIZEN;
  return ZoneFaction.LIQUIDATOR;
}

function nearestAttractorFlowPoint(world: World, x: number, y: number): Point {
  const candidates: readonly Point[] = [
    { x: CX, y: CY },
    { x, y: 128 },
    { x, y: 334 },
    { x, y: 704 },
    { x, y: 884 },
    { x: 112, y },
    { x: 904, y },
    { x: CX, y },
    { x, y: CY },
  ];
  let best = candidates[0];
  let bestD2 = Infinity;
  for (const candidate of candidates) {
    const d2 = world.dist2(x, y, candidate.x, candidate.y);
    if (d2 < bestD2) {
      best = candidate;
      bestD2 = d2;
    }
  }
  return best;
}

function tryAddAttractorRoom(
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
): Room | undefined {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (!canStampAttractorRoom(world, ix, iy, w, h)) return undefined;
  return addRoom(world, type, ix, iy, w, h, name, wallTex, floorTex, sealed);
}

function canStampAttractorRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  if (x < 4 || y < 4 || x + w >= W - 4 || y + h >= W - 4) return false;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const idx = world.idx(x + dx, y + dy);
      if (world.aptMask[idx] || world.hermoWall[idx]) return false;
      if (world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.DOOR) return false;
      if (world.features[idx] === Feature.LIFT_BUTTON) return false;
      if (world.containerMap.has(idx)) return false;
      if (world.roomMap[idx] >= 0) return false;
    }
  }
  return true;
}

function connectRoomToPoint(world: World, room: Room, side: DoorSide, targetX: number, targetY: number, state: DoorState): void {
  const site = doorSite(room, side);
  const vx = Math.sign(site.x - site.ox);
  const vy = Math.sign(site.y - site.oy);
  const outsideX = site.x + vx;
  const outsideY = site.y + vy;
  carveLineWidth(world, outsideX, outsideY, targetX, targetY, 2, FLOW_FLOOR, 0x8c00 + room.id * 17, [112, 146, 168]);
  setRoomDoorToRoute(world, room, site.x, site.y, state);
}

function setRoomDoorToRoute(world: World, room: Room, x: number, y: number, state: DoorState): void {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.DOOR;
  world.wallTex[idx] = state === DoorState.HERMETIC_OPEN || state === DoorState.HERMETIC_CLOSED ? Tex.HERMO_WALL : Tex.DOOR_METAL;
  if (state === DoorState.HERMETIC_OPEN || state === DoorState.HERMETIC_CLOSED) world.hermoWall[idx] = 1;
  world.doors.set(idx, { idx, state, roomA: room.id, roomB: -1, keyId: '', timer: 0 });
  if (!room.doors.includes(idx)) room.doors.push(idx);
}

function paintAttractorRoomOwner(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[idx] === room.id) world.factionControl[idx] = owner;
    }
  }
  for (const idx of room.doors) world.factionControl[idx] = owner;
}

function paintAttractorAuthoredHqOwners(world: World): void {
  const seeds: { name: string; owner: TerritoryOwner }[] =
    ATTRACTOR_HQ_COMPOUNDS.map(spec => ({ name: spec.name, owner: spec.owner }));
  for (const seed of seeds) {
    const room = roomByName(world, seed.name);
    if (!room) continue;
    room.type = RoomType.HQ;
    room.sealed = true;
    paintAttractorRoomOwner(world, room, seed.owner);
  }
}

function decorateAttractorExpansionRoom(world: World, room: Room, owner: TerritoryOwner, serial: number): void {
  const feature = featureForAttractorRoom(room.type, serial);
  setFeature(world, room.x + Math.max(2, Math.min(room.w - 3, 4 + (serial * 7) % Math.max(1, room.w - 6))), room.y + Math.max(2, Math.min(room.h - 3, 4 + (serial * 5) % Math.max(1, room.h - 6))), feature);
  if (room.w > 14 && room.h > 10) {
    setFeature(world, room.x + room.w - 4, room.y + room.h - 4, owner === ZoneFaction.SCIENTIST ? Feature.SCREEN : owner === ZoneFaction.WILD ? Feature.SHELF : Feature.CHAIR);
  }
}

function featureForAttractorRoom(type: RoomType, serial: number): Feature {
  switch (type) {
    case RoomType.KITCHEN: return serial % 2 === 0 ? Feature.STOVE : Feature.SINK;
    case RoomType.BATHROOM: return serial % 2 === 0 ? Feature.TOILET : Feature.SINK;
    case RoomType.MEDICAL: return Feature.TABLE;
    case RoomType.OFFICE: return Feature.DESK;
    case RoomType.STORAGE: return Feature.SHELF;
    case RoomType.SMOKING: return Feature.CHAIR;
    case RoomType.HQ: return Feature.SCREEN;
    case RoomType.PRODUCTION: return Feature.APPARATUS;
    default: return Feature.LAMP;
  }
}

function wallTexForAttractorRoom(type: RoomType): Tex {
  if (type === RoomType.BATHROOM || type === RoomType.KITCHEN || type === RoomType.MEDICAL) return Tex.TILE_W;
  if (type === RoomType.HQ) return Tex.HERMO_WALL;
  if (type === RoomType.COMMON || type === RoomType.SMOKING) return Tex.PANEL;
  return Tex.METAL;
}

function floorTexForAttractorRoom(type: RoomType): Tex {
  if (type === RoomType.BATHROOM) return Tex.F_WATER;
  if (type === RoomType.KITCHEN || type === RoomType.MEDICAL) return Tex.F_TILE;
  if (type === RoomType.COMMON || type === RoomType.SMOKING) return Tex.F_LINO;
  return FLOW_FLOOR;
}

function sideTowardPoint(room: Room, x: number, y: number): DoorSide {
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  const dx = x - cx;
  const dy = y - cy;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'west' : 'east';
  return dy < 0 ? 'north' : 'south';
}

function placeLifts(world: World, rooms: AttractorRooms): void {
  placeLift(world, rooms.entry.x + 126, rooms.entry.y + 17, rooms.entry.x + 116, rooms.entry.y + 16, LiftDirection.UP);
  placeLift(world, rooms.northSpine.x + 20, rooms.northSpine.y + 14, rooms.northSpine.x + 30, rooms.northSpine.y + 14, LiftDirection.DOWN);
}

function placeContainers(world: World, rooms: AttractorRooms): void {
  addContainer(world, rooms.entry, rooms.entry.x + 16, rooms.entry.y + 14, ContainerKind.TOOL_LOCKER, 'Шкаф входной струи', 'public', [
    { defId: 'fuse', count: 1 },
    { defId: 'wire_coil', count: 1 },
    { defId: 'water', count: 1 },
  ], ['entry', 'flow', 'repair']);
  addContainer(world, rooms.deadZone, rooms.deadZone.x + 16, rooms.deadZone.y + 16, ContainerKind.SECRET_STASH, 'Сухой ящик в мертвой зоне', 'secret', [
    { defId: 'relay_diagram', count: 1 },
    { defId: 'door_kit', count: 1 },
    { defId: 'gasmask_filter', count: 1 },
  ], ['dead_zone', 'shortcut', 'risk']);
  addContainer(world, rooms.transitCache, rooms.transitCache.x + 13, rooms.transitCache.y + 13, ContainerKind.METAL_CABINET, 'Запертый ящик обходного течения', 'locked', [
    { defId: 'hermo_gasket', count: 1 },
    { defId: 'sealant_tube', count: 1 },
    { defId: 'ammo_9mm', count: 10 },
  ], ['transit_cache', 'switch_reward', 'locked']);
}

function spawnActors(world: World, entities: Entity[], nextId: { v: number }, rooms: AttractorRooms): void {
  spawnNpc(entities, nextId, 'Ликвидатор внешней петли', Faction.LIQUIDATOR, Occupation.HUNTER, rooms.southSpine.x + 42, rooms.southSpine.y + 15, Math.PI / 2, 'makarov');
  spawnNpc(entities, nextId, 'Ликвидатор внешней петли', Faction.LIQUIDATOR, Occupation.HUNTER, rooms.westSpine.x + 15, rooms.westSpine.y + 72, 0, 'makarov');
  spawnNpc(entities, nextId, 'Ликвидатор внешней петли', Faction.LIQUIDATOR, Occupation.HUNTER, rooms.northSpine.x + 230, rooms.northSpine.y + 14, -Math.PI / 2, 'makarov');
  spawnNpc(entities, nextId, 'Ликвидатор внешней петли', Faction.LIQUIDATOR, Occupation.HUNTER, rooms.eastSpine.x + 15, rooms.eastSpine.y + 184, Math.PI, 'makarov');
  spawnNpc(entities, nextId, 'Инженер параметров двора', Faction.SCIENTIST, Occupation.ELECTRICIAN, rooms.pumpCore.x + 20, rooms.pumpCore.y + 40, Math.PI);

  spawnMonster(world, entities, nextId, MonsterKind.TUBE_EEL, rooms.deadZone.x + 72, rooms.deadZone.y + 28, 4, 'Трубный угорь мертвой зоны');
  spawnMonster(world, entities, nextId, MonsterKind.TRUBNYY_AVTOMAT, rooms.transitCache.x + 34, rooms.transitCache.y + 28, 4, 'Трубный автомат обходного течения');
  spawnMonster(world, entities, nextId, MonsterKind.RZHAVNIK, rooms.westSpine.x + 14, rooms.westSpine.y + 180, 3, 'Ржавник желтой петли');
  void world;
}

function isAttractorAmbientNpc(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    entity.alive &&
    entity.plotNpcId === undefined &&
    entity.persistentNpcId === undefined &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    entity.faction !== undefined;
}

function attractorTerritorySpawnCells(world: World): Map<TerritoryOwner, number[]> {
  const cells = new Map<TerritoryOwner, number[]>();
  for (const owner of HUMAN_TERRITORY_OWNERS) cells.set(owner, []);
  for (let i = 0; i < W * W; i++) {
    const cell = world.cells[i];
    if (cell !== Cell.FLOOR && cell !== Cell.WATER) continue;
    if (world.aptMask[i] || world.hermoWall[i] || world.containerMap.has(i) || world.features[i] === Feature.LIFT_BUTTON) continue;
    const list = cells.get(world.factionControl[i] as TerritoryOwner);
    if (list) list.push(i);
  }
  return cells;
}

export function alignAttractorDvorAmbientNpcTerritory(world: World, entities: Entity[]): void {
  const cells = attractorTerritorySpawnCells(world);
  const offsets = new Uint16Array(8);
  for (const entity of entities) {
    if (!isAttractorAmbientNpc(entity) || entity.faction === undefined) continue;
    const owner = factionToTerritoryOwner(entity.faction);
    const list = cells.get(owner);
    if (!list || list.length === 0) continue;
    const offset = offsets[owner]++ | 0;
    const cell = list[(entity.id * 131 + offset * 457) % list.length];
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

function registerAttractorRouteCues(world: World, rooms: AttractorRooms): void {
  registerRouteCue(world, {
    id: 'attractor_main_stream',
    x: rooms.entry.x + 78,
    y: rooms.entry.y + 14,
    targetX: rooms.northSpine.x + 226,
    targetY: rooms.northSpine.y + 14,
    floor: ATTRACTOR_DVOR_BASE_FLOOR,
    label: 'Синяя струя',
    hint: 'Поток ведет вокруг двора быстрее прямой линии.',
    targetName: ATTRACTOR_DVOR_ROOM_NAMES.northSpine,
    color: '#65b7ff',
    tags: ['attractor_dvor', 'flow', 'main_stream', 'safe_route'],
    toneSeed: 0x88f101,
    heardText: 'Синий шум двора показывает быстрый обход.',
    followedText: 'Вы вошли в струю и держите широкий ход.',
    ignoredText: 'Струя ушла за спину; двор стал прямее и опаснее.',
  });
  registerRouteCue(world, {
    id: 'attractor_dead_cut',
    x: rooms.southSpine.x + 174,
    y: rooms.southSpine.y + 14,
    targetX: rooms.deadZone.x + 58,
    targetY: rooms.deadZone.y + 30,
    floor: ATTRACTOR_DVOR_BASE_FLOOR,
    label: 'Мертвая зона',
    hint: 'Короткий срез проходит через воду, гермодвери и плохой звук.',
    targetName: ATTRACTOR_DVOR_ROOM_NAMES.deadZone,
    color: '#9da3ac',
    tags: ['attractor_dvor', 'dead_zone', 'shortcut', 'risk'],
    toneSeed: 0x88f102,
    heardText: 'Тишина в середине двора слишком ровная.',
    followedText: 'Вы режете двор через мертвую зону.',
    ignoredText: 'Срез остался закрытым; патрульная петля сохраняет преимущество.',
  });
  registerRouteCue(world, {
    id: 'attractor_patrol_loop',
    x: rooms.guardLoop.x + 44,
    y: rooms.guardLoop.y + 20,
    targetX: rooms.westSwitch.x + 8,
    targetY: rooms.westSwitch.y + 10,
    floor: ATTRACTOR_DVOR_BASE_FLOOR,
    label: 'Петля патруля',
    hint: 'Патруль ходит по внешнему циклу; параметрический щиток дает окно.',
    targetName: ATTRACTOR_DVOR_ROOM_NAMES.westSwitch,
    color: '#ffd36f',
    tags: ['attractor_dvor', 'patrol_loop', 'switch', 'prediction'],
    toneSeed: 0x88f103,
    heardText: 'Шаги повторяются по одной петле.',
    followedText: 'Вы читаете цикл и выходите к параметру струи.',
    ignoredText: 'Патрульная петля не сбилась.',
  });
}

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
  sealed = false,
): Room {
  const room = stampRoom(world, world.rooms.length, type, Math.floor(x), Math.floor(y), w, h, -1);
  room.name = name;
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  room.sealed = sealed;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) {
        world.floorTex[ci] = floorTex;
        if (floorTex === DEAD_FLOOR && ((dx + dy) & 2) === 0) world.cells[ci] = Cell.WATER;
      } else {
        world.wallTex[ci] = wallTex;
        if (sealed) world.hermoWall[ci] = 1;
      }
    }
  }
  return room;
}

function roomByName(world: World, name: string): Room | undefined {
  return world.rooms.find(room => room.name === name);
}

function doorSite(room: Room, side: DoorSide): DoorSite {
  switch (side) {
    case 'north': {
      const x = room.x + (room.w >> 1);
      const y = room.y - 1;
      return { x, y, ox: x, oy: room.y };
    }
    case 'south': {
      const x = room.x + (room.w >> 1);
      const y = room.y + room.h;
      return { x, y, ox: x, oy: room.y + room.h - 1 };
    }
    case 'west': {
      const x = room.x - 1;
      const y = room.y + (room.h >> 1);
      return { x, y, ox: room.x, oy: y };
    }
    case 'east': {
      const x = room.x + room.w;
      const y = room.y + (room.h >> 1);
      return { x, y, ox: room.x + room.w - 1, oy: y };
    }
  }
}

function connectRooms(
  world: World,
  a: Room,
  aSide: DoorSide,
  b: Room,
  bSide: DoorSide,
  state: DoorState,
  keyId = '',
): void {
  const da = doorSite(a, aSide);
  const db = doorSite(b, bSide);
  carveLineWidth(world, da.ox, da.oy, db.ox, db.oy, 2, FLOW_FLOOR, 0x8810, [100, 150, 180]);
  setDoor(world, a, b, da.x, da.y, state, keyId);
  setDoor(world, b, a, db.x, db.y, state, keyId);
}

function setDoor(world: World, roomA: Room, roomB: Room, x: number, y: number, state: DoorState, keyId: string): void {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.DOOR;
  world.wallTex[idx] = state === DoorState.HERMETIC_CLOSED ? Tex.HERMO_WALL : Tex.DOOR_METAL;
  world.doors.set(idx, { idx, state, roomA: roomA.id, roomB: roomB.id, keyId, timer: 0 });
  if (!roomA.doors.includes(idx)) roomA.doors.push(idx);
  if (!roomB.doors.includes(idx)) roomB.doors.push(idx);
}

function placeLift(world: World, x: number, y: number, buttonX: number, buttonY: number, direction: LiftDirection): void {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.LIFT;
  world.wallTex[idx] = Tex.LIFT_DOOR;
  world.features[idx] = Feature.NONE;
  world.liftDir[idx] = direction;
  setFeature(world, buttonX, buttonY, Feature.LIFT_BUTTON);
  world.liftDir[world.idx(buttonX, buttonY)] = direction;
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const idx = world.idx(x, y);
  if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) return;
  world.features[idx] = feature;
}

function carvePolyline(world: World, points: readonly Point[], radius: number, floorTex: Tex, seed: number, tint: readonly [number, number, number]): number {
  let count = 0;
  for (let i = 1; i < points.length; i++) {
    count += carveLineWidth(world, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, radius, floorTex, seed + i * 47, tint);
  }
  return count;
}

function carveLineWidth(
  world: World,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  floorTex: Tex,
  seed: number,
  tint: readonly [number, number, number],
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  let changed = 0;
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const x = Math.round(x0 + dx * t);
    const y = Math.round(y0 + dy * t);
    for (let oy = -radius; oy <= radius; oy++) {
      for (let ox = -radius; ox <= radius; ox++) {
        if (ox * ox + oy * oy > radius * radius + 1) continue;
        const idx = world.idx(x + ox, y + oy);
        if (world.cells[idx] === Cell.LIFT) continue;
        if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) changed++;
        world.cells[idx] = floorTex === DEAD_FLOOR && (step + ox + oy) % 7 === 0 ? Cell.WATER : Cell.FLOOR;
        world.floorTex[idx] = floorTex;
        if (world.roomMap[idx] < 0) world.fog[idx] = floorTex === DEAD_FLOOR ? 32 : Math.min(world.fog[idx], 8);
      }
    }
    if (step % 19 === 0) {
      stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.2, 0.38, seed + step, tint[0], tint[1], tint[2], false);
    }
  }
  return changed;
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
): void {
  world.addContainer({
    id: world.containers.length + 1,
    x: world.wrap(x),
    y: world.wrap(y),
    floor: ATTRACTOR_DVOR_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)] ?? 0,
    kind,
    name,
    inventory,
    capacitySlots: Math.max(6, inventory.length + 3),
    access,
    lockDifficulty: access === 'locked' ? 3 : undefined,
    discovered: access !== 'secret',
    tags: [ATTRACTOR_DVOR_ROUTE_ID, ...tags],
  });
}

function spawnNpc(
  entities: Entity[],
  nextId: { v: number },
  name: string,
  faction: Faction,
  occupation: Occupation,
  x: number,
  y: number,
  angle: number,
  weapon?: string,
): void {
  entities.push({
    id: nextId.v++,
    type: EntityType.NPC,
    x: x + 0.5,
    y: y + 0.5,
    angle,
    pitch: 0,
    alive: true,
    speed: 0.88,
    sprite: occupation,
    name,
    isFemale: false,
    needs: freshNeeds(),
    hp: 145,
    maxHp: 145,
    money: 34,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    inventory: weapon ? [{ defId: 'ammo_9mm', count: 8 }] : [{ defId: 'bread', count: 1 }],
    weapon,
    faction,
    occupation,
    questId: -1,
    rpg: randomRPG(3),
  });
}

function spawnMonster(
  _world: World,
  entities: Entity[],
  nextId: { v: number },
  kind: MonsterKind,
  x: number,
  y: number,
  level: number,
  name?: string,
): void {
  const def = MONSTERS[kind];
  if (!def) return;
  const hp = scaleMonsterHp(def.hp, level);
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, level),
    sprite: monsterSpr(kind),
    name: name ?? def.name,
    hp,
    maxHp: hp,
    monsterKind: kind,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    attackCd: 0,
    rpg: randomRPG(level),
  });
}
