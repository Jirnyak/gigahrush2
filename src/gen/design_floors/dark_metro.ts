/* ── Design floor: dark_metro / Темная пересадка ─────────────── */

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
  type RailTrainTrack,
  type Room,
  type TerritoryOwner,
  type Zone,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { hashSeed, withSeededRandom } from '../../core/rand';
import { HUMAN_TERRITORY_OWNERS, factionToTerritoryOwner } from '../../data/factions';
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { Spr } from '../../render/sprite_index';
import { publishEvent } from '../../systems/events';
import { addRailTrainRoute } from '../../systems/rail_trains';
import { registerRouteCue } from '../../systems/route_cues';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { ensureConnectivity, generateZones, sanitizeDoors, stampRoom } from '../shared';
import type { FloorGeneration } from '../floor_manifest';
import { setTerritoryOwnerAtIndex, syncZoneMetadataFromTerritory, territoryOwnerAtIndex } from '../../systems/territory';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('dark_metro');

export const DESIGN_FLOOR_ID = 'dark_metro' as const;
export const DARK_METRO_DISPLAY_NAME = 'Темная пересадка';
export const DARK_METRO_FUTURE_Z = -32;
export const DARK_METRO_DEFAULT_SEED = 0x17da_4b0d;

const DARK_METRO_BASE_FLOOR = FloorLevel.MAINTENANCE;

const enum PlatformLightState {
  OFF = 0,
  WEAK = 1,
  ON = 2,
}

const enum SignalBoxState {
  WORN = 0,
  REPAIRED = 1,
  SABOTAGED = 2,
}

const enum StrandedNpcState {
  STRANDED = 0,
  GUIDED = 1,
  LEFT_BEHIND = 2,
}

export type DarkMetroPackedState = number;

export interface DarkMetroStateParts {
  platformLight: 'off' | 'weak' | 'on';
  wrongRouteArmed: DarkMetroRouteId;
  signalBox: 'worn' | 'repaired' | 'sabotaged';
  strandedNpc: 'stranded' | 'guided' | 'left_behind';
}

export type DarkMetroRouteId =
  | 'dark_metro_market_88_smuggle'
  | 'dark_metro_service_floor_shortcut'
  | 'dark_metro_red_lower_wrong'
  | 'dark_metro_platform_fallback';

export interface DarkMetroRouteDef {
  id: DarkMetroRouteId;
  label: string;
  panelSlot: number;
  costItem?: string;
  costCount?: number;
  destinationHook: string;
  clue: string;
  fallbackRouteId: DarkMetroRouteId;
  tags: readonly string[];
}

export type DarkMetroAmbushCueId =
  | 'dark_metro_white_lamp_ambush'
  | 'dark_metro_red_panel_wrong_stop';

export interface DarkMetroAmbushCueDef {
  id: DarkMetroAmbushCueId;
  label: string;
  markerRoom: 'underpass' | 'platform';
  targetRoom: 'blindTunnel' | 'exit';
  warning: string;
  tags: readonly string[];
}

export interface DarkMetroFloorState {
  routeId: typeof DESIGN_FLOOR_ID;
  z: typeof DARK_METRO_FUTURE_Z;
  baseFloor: typeof DARK_METRO_BASE_FLOOR;
  packedState: DarkMetroPackedState;
  ambushCueIds: DarkMetroAmbushCueId[];
  shortcutRouteIds: DarkMetroRouteId[];
}

export interface DarkMetroGeneration extends FloorGeneration {
  metroState: DarkMetroFloorState;
}

const ROUTE_BITS = 2;
const SIGNAL_BITS = 4;
const STRANDED_BITS = 6;

export const DARK_METRO_ROUTES: readonly DarkMetroRouteDef[] = [
  {
    id: 'dark_metro_market_88_smuggle',
    label: 'Черный рынок 88: служебный ход',
    panelSlot: 0,
    costItem: 'metro_ticket',
    costCount: 1,
    destinationHook: 'future.market_88.underpass_entry',
    clue: 'Над табло мигает зеленая лампа, а на полу к тоннелю ведут три желтых пятна.',
    fallbackRouteId: 'dark_metro_platform_fallback',
    tags: ['dark_metro', 'market_88', 'smuggle', 'shortcut'],
  },
  {
    id: 'dark_metro_service_floor_shortcut',
    label: 'Служебный этаж: стрелочный коридор',
    panelSlot: 1,
    costItem: 'fuse',
    costCount: 1,
    destinationHook: 'future.service_floor.signal_hatch',
    clue: 'Табло щелкает в такт реле; стрелка горит только при живом предохранителе.',
    fallbackRouteId: 'dark_metro_platform_fallback',
    tags: ['dark_metro', 'service_floor', 'signal', 'shortcut'],
  },
  {
    id: 'dark_metro_red_lower_wrong',
    label: 'Красная нижняя: чужая остановка',
    panelSlot: 2,
    costItem: 'metro_ticket',
    costCount: 2,
    destinationHook: 'future.hell.red_platform_edge',
    clue: 'Красное табло показывает номер вагона без станции; безопасный обход подписан мелом у подземного хода.',
    fallbackRouteId: 'dark_metro_platform_fallback',
    tags: ['dark_metro', 'hell', 'wrong_route', 'red_line'],
  },
  {
    id: 'dark_metro_platform_fallback',
    label: 'Петля платформы: вернуться к свету',
    panelSlot: 3,
    destinationHook: 'dark_metro.station_hall',
    clue: 'Белые лампы вдоль стены ведут обратно в зал даже после неверного объявления.',
    fallbackRouteId: 'dark_metro_platform_fallback',
    tags: ['dark_metro', 'fallback', 'safe_return'],
  },
];

export const DARK_METRO_AMBUSH_CUES: readonly DarkMetroAmbushCueDef[] = [
  {
    id: 'dark_metro_white_lamp_ambush',
    label: 'Белые лампы перед засадой',
    markerRoom: 'underpass',
    targetRoom: 'blindTunnel',
    warning: 'Белый свет кончается перед слепым тоннелем: дальше слышно шаги, но фонарь ловит только мокрый бетон.',
    tags: ['dark_metro', 'ambush', 'shadow', 'warning'],
  },
  {
    id: 'dark_metro_red_panel_wrong_stop',
    label: 'Красное табло неверной посадки',
    markerRoom: 'platform',
    targetRoom: 'exit',
    warning: 'Красный номер на табло ведет к короткому ходу, но может объявить чужую остановку.',
    tags: ['dark_metro', 'wrong_route', 'shortcut', 'warning'],
  },
];

const NORA_DEF: PlotNpcDef = {
  name: 'Нора Диспетчерская',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 150, maxHp: 150, money: 70, speed: 0.9,
  inventory: [
    { defId: 'metro_ticket', count: 3 },
    { defId: 'relay_diagram', count: 1 },
    { defId: 'tea', count: 1 },
  ],
  talkLines: [
    'Поезд здесь не ходит по расписанию. Он приходит, когда реле щелкнет не в ту сторону.',
    'Если табло говорит ровно, проверь лампу. Ровные объявления у нас чаще всего чужие.',
    'Не садись туда, где красный номер появился раньше станции. Возвратная петля отмечена белым светом.',
    'Двери закрываются - руки убрать, мысли тоже. Потом уже решай, ехать или ждать.',
    'Повторилась станция - сиди. Второй раз она обычно проверяет смелых.',
  ],
  talkLinesPost: [
    'Стрелка снова отвечает на ручку. Это не значит, что ей можно верить без билета.',
    'Платформа стала светлее. Теперь видно, кто стоит у края без билета.',
  ],
};

const VENDOR_DEF: PlotNpcDef = {
  name: 'Ламповщик Гена',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 120, maxHp: 120, money: 110, speed: 0.85,
  inventory: [
    { defId: 'flashlight', count: 1 },
    { defId: 'lamp_bulb', count: 2 },
    { defId: 'metro_ticket', count: 2 },
    { defId: 'cigs', count: 3 },
  ],
  talkLines: [
    'Лампа дешевле, чем лечение после темного тоннеля.',
    'Платформу можно зажечь. Можно не зажигать. В темноте меньше видят и свои, и чужие.',
    'Фонарик не делает маршрут безопасным. Он только показывает, где платить.',
    'Если пустой состав дышит, спрячься за киоск. Пусть высадит тех, кого уже везет.',
    'Белая лампа у депо не спасает. Просто под ней видно обратную стену.',
  ],
  talkLinesPost: [
    'Горит? Значит, кто-то еще не украл лампу.',
    'Теперь у киоска видно руки. Этого уже хватает для торговли.',
  ],
};

const STRANDED_DEF: PlotNpcDef = {
  name: 'Сержант Барсуков',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 95, maxHp: 180, money: 28, speed: 0.75,
  inventory: [
    { defId: 'bandage', count: 1 },
    { defId: 'ammo_9mm', count: 10 },
    { defId: 'gasmask_filter', count: 1 },
  ],
  talkLines: [
    'Я не заблудился. Я занял неправильную станцию до приказа.',
    'До света дойду. До голоса диспетчера - не уверен.',
    'Если объявят мою фамилию, не отвечай. Это не эвакуация.',
    'Красная нижняя теплая, как кабина после чужого рейса. От такой отходят к стене.',
    'Проводник был прав: первый щелчок слушай, на втором не стой у края.',
  ],
  talkLinesPost: [
    'Свет вижу. Значит, живые пока выигрывают у расписания.',
    'Возьми фильтр. Внизу воздух тоже любит проверять документы.',
  ],
  talkQuestResponse: 'Барсуков дошел? Хорошо. Пусть сидит у белой лампы и не спорит с объявлениями.',
};

const MISHA_DEF: PlotNpcDef = {
  name: 'Миша с повтором',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.CHILD,
  sprite: Occupation.CHILD,
  hp: 80, maxHp: 80, money: 0, speed: 1.0,
  inventory: [
    { defId: 'child_map', count: 1 },
  ],
  talkLines: [
    'Не красный. Белый путь назад.',
    'Если поезд спросит имя, молчи.',
    'Я уже сказал это. Значит, еще не поздно.',
    'Билет с зубами прячь от света.',
    'Когда станция повторяется, пол холоднее двери. Сиди на полу.',
  ],
  talkLinesPost: [
    'Белый путь назад.',
  ],
};

let contentRegistered = false;

export function registerDarkMetroContent(): void {
  if (contentRegistered) return;
  contentRegistered = true;

  registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'dark_metro_dispatcher_nora', NORA_DEF, [
    {
      id: 'dark_metro_wrong_train',
      giverNpcId: 'dark_metro_dispatcher_nora',
      type: QuestType.FETCH,
      desc: 'Нора: «Принеси билет метро и выбери табло с подсказкой. Неверная посадка должна стоить жетон, а не жизнь.»',
      targetItem: 'metro_ticket', targetCount: 1,
      rewardItem: 'lift_scheme', rewardCount: 1,
      extraRewards: [{ defId: 'clean_health_cert', count: 1 }],
      relationDelta: 10, xpReward: 65, moneyReward: 35,
    },
    {
      id: 'dark_metro_signal_box',
      giverNpcId: 'dark_metro_dispatcher_nora',
      type: QuestType.FETCH,
      desc: 'Нора: «Два предохранителя в сигнальный ящик - и стрелка хотя бы начнет врать одинаково.»',
      targetItem: 'fuse', targetCount: 2,
      rewardItem: 'metro_ticket', rewardCount: 2,
      extraRewards: [{ defId: 'relay_diagram', count: 1 }],
      relationDelta: 12, xpReward: 80, moneyReward: 50,
    },
  ]);

  registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'dark_metro_lamp_vendor', VENDOR_DEF, [
    {
      id: 'dark_metro_light_platform',
      giverNpcId: 'dark_metro_lamp_vendor',
      type: QuestType.FETCH,
      desc: 'Гена: «Три целые лампы - и на платформе будет видно край. Не принесешь - людей снова будут считать по крику.»',
      targetItem: 'lamp_bulb', targetCount: 3,
      rewardItem: 'flashlight', rewardCount: 1,
      extraRewards: [{ defId: 'metro_ticket', count: 1 }],
      relationDelta: 10, xpReward: 70, moneyReward: 30,
    },
  ]);

  registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'dark_metro_stranded_liquidator', STRANDED_DEF, [
    {
      id: 'dark_metro_rescue_stranded',
      giverNpcId: 'dark_metro_stranded_liquidator',
      type: QuestType.TALK,
      desc: 'Барсуков: «Проведи меня до Норы {dir}. Если белые лампы кончатся, идем назад, не героим.»',
      targetNpcId: 'dark_metro_dispatcher_nora',
      rewardItem: 'gasmask_filter', rewardCount: 1,
      extraRewards: [{ defId: 'ammo_9mm', count: 12 }, { defId: 'bandage', count: 1 }],
      relationDelta: 12, xpReward: 75, moneyReward: 40,
    },
  ]);

  registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'dark_metro_child_omen_misha', MISHA_DEF, []);
}

registerDarkMetroContent();

export function packDarkMetroState(parts: DarkMetroStateParts): DarkMetroPackedState {
  const light = parts.platformLight === 'on' ? PlatformLightState.ON
    : parts.platformLight === 'off' ? PlatformLightState.OFF
      : PlatformLightState.WEAK;
  const route = Math.max(0, DARK_METRO_ROUTES.findIndex(r => r.id === parts.wrongRouteArmed));
  const signal = parts.signalBox === 'repaired' ? SignalBoxState.REPAIRED
    : parts.signalBox === 'sabotaged' ? SignalBoxState.SABOTAGED
      : SignalBoxState.WORN;
  const stranded = parts.strandedNpc === 'guided' ? StrandedNpcState.GUIDED
    : parts.strandedNpc === 'left_behind' ? StrandedNpcState.LEFT_BEHIND
      : StrandedNpcState.STRANDED;
  return light | (route << ROUTE_BITS) | (signal << SIGNAL_BITS) | (stranded << STRANDED_BITS);
}

export function unpackDarkMetroState(packed: DarkMetroPackedState): DarkMetroStateParts {
  const light = packed & 3;
  const routeIndex = (packed >> ROUTE_BITS) & 3;
  const signal = (packed >> SIGNAL_BITS) & 3;
  const stranded = (packed >> STRANDED_BITS) & 3;
  return {
    platformLight: light === PlatformLightState.ON ? 'on' : light === PlatformLightState.OFF ? 'off' : 'weak',
    wrongRouteArmed: DARK_METRO_ROUTES[Math.min(routeIndex, DARK_METRO_ROUTES.length - 1)].id,
    signalBox: signal === SignalBoxState.REPAIRED ? 'repaired' : signal === SignalBoxState.SABOTAGED ? 'sabotaged' : 'worn',
    strandedNpc: stranded === StrandedNpcState.GUIDED ? 'guided'
      : stranded === StrandedNpcState.LEFT_BEHIND ? 'left_behind'
        : 'stranded',
  };
}

export function initialDarkMetroState(seed = DARK_METRO_DEFAULT_SEED): DarkMetroPackedState {
  const routeIndex = hashSeed(DESIGN_FLOOR_ID, seed) % (DARK_METRO_ROUTES.length - 1);
  return packDarkMetroState({
    platformLight: 'weak',
    wrongRouteArmed: DARK_METRO_ROUTES[routeIndex].id,
    signalBox: 'worn',
    strandedNpc: 'stranded',
  });
}

export function createDarkMetroFloorState(packedState = initialDarkMetroState()): DarkMetroFloorState {
  return {
    routeId: DESIGN_FLOOR_ID,
    z: DARK_METRO_FUTURE_Z,
    baseFloor: DARK_METRO_BASE_FLOOR,
    packedState,
    ambushCueIds: DARK_METRO_AMBUSH_CUES.map(cue => cue.id),
    shortcutRouteIds: DARK_METRO_ROUTES
      .filter(route => route.tags.includes('shortcut'))
      .map(route => route.id),
  };
}

export function publishDarkMetroRouteEvent(
  state: GameState,
  world: World,
  actor: Entity,
  routeId: DarkMetroRouteId,
  packedState = initialDarkMetroState(),
): void {
  const route = DARK_METRO_ROUTES.find(r => r.id === routeId) ?? DARK_METRO_ROUTES[3];
  const parts = unpackDarkMetroState(packedState);
  const wrongStop = route.id === parts.wrongRouteArmed && route.id !== 'dark_metro_platform_fallback';
  const px = Math.floor(actor.x);
  const py = Math.floor(actor.y);
  const zoneId = world.zoneMap[world.idx(px, py)];
  publishEvent(state, {
    type: wrongStop ? 'metro_wrong_stop' : 'metro_route_taken',
    zoneId: zoneId >= 0 ? zoneId : undefined,
    x: actor.x,
    y: actor.y,
    actorId: actor.id,
    actorName: actor.name ?? 'Вы',
    actorFaction: actor.faction,
    severity: wrongStop ? 4 : 3,
    privacy: 'local',
    tags: ['metro', 'dark_metro', route.id, wrongStop ? 'wrong_route' : 'route_taken'],
    data: {
      routeId: route.id,
      routeLabel: route.label,
      routeCostItem: route.costItem,
      routeCostCount: route.costCount,
      destinationHook: route.destinationHook,
      fallbackRouteId: route.fallbackRouteId,
      clue: route.clue,
      platformLight: parts.platformLight,
      signalBox: parts.signalBox,
      strandedNpc: parts.strandedNpc,
      futureHooks: route.tags,
    },
  });
}

export function publishDarkMetroAmbushWarning(
  state: GameState,
  world: World,
  actor: Entity,
  cueId: DarkMetroAmbushCueId,
): void {
  const cue = DARK_METRO_AMBUSH_CUES.find(c => c.id === cueId);
  const px = Math.floor(actor.x);
  const py = Math.floor(actor.y);
  const zoneId = world.zoneMap[world.idx(px, py)];
  publishEvent(state, {
    type: 'monster_sighted',
    floor: DARK_METRO_BASE_FLOOR,
    zoneId: zoneId >= 0 ? zoneId : undefined,
    x: actor.x,
    y: actor.y,
    actorId: actor.id,
    actorName: actor.name,
    actorFaction: actor.faction,
    severity: 4,
    privacy: 'local',
    tags: ['dark_metro', 'ambush_cue', cueId, ...(cue?.tags ?? [])],
    data: {
      routeId: DESIGN_FLOOR_ID,
      z: DARK_METRO_FUTURE_Z,
      cueId,
      warning: cue?.warning,
    },
  });
}

interface DarkMetroLayout {
  hall: Room;
  platform: Room;
  underpass: Room;
  kiosk: Room;
  signal: Room;
  blindTunnel: Room;
  exit: Room;
}

interface BuildCtx {
  world: World;
  entities: Entity[];
  nextId: { v: number };
  nextContainerId: { v: number };
  packedState: DarkMetroPackedState;
}

interface DarkMetroFullFloorStyle {
  wallTex: Tex;
  floorTex: Tex;
}

type DarkMetroRoomSide = 'north' | 'south' | 'west' | 'east';

interface DarkMetroOwnedRoomSpec {
  name: string;
  type: RoomType;
  x: number;
  y: number;
  w: number;
  h: number;
  side: DarkMetroRoomSide;
  targetX: number;
  targetY: number;
  wallTex: Tex;
  floorTex: Tex;
  doorState?: DoorState;
}

interface DarkMetroHqCompoundSpec {
  owner: TerritoryOwner;
  core: DarkMetroOwnedRoomSpec;
  support: readonly DarkMetroOwnedRoomSpec[];
}

const DARK_METRO_FULL_LINE_YS = [118, 260, 402, 642, 786, 920] as const;
const DARK_METRO_SAFETY_SHELL_RADIUS = 18;

export const DARK_METRO_HQ_ROOM_NAMES = {
  citizen: 'Гермокасса белой петли',
  liquidator: 'Гермопост короткого хода',
  cultist: 'Гермосвечная неверной станции',
  scientist: 'Гермолаборатория стрелочного шума',
  wild: 'Гермобаррикада черного перегона',
} as const;

const DARK_METRO_HQ_COMPOUNDS: readonly DarkMetroHqCompoundSpec[] = [
  {
    owner: ZoneFaction.CITIZEN,
    core: { name: DARK_METRO_HQ_ROOM_NAMES.citizen, type: RoomType.HQ, x: 84, y: 168, w: 26, h: 14, side: 'east', targetX: 176, targetY: 184, wallTex: Tex.HERMO_WALL, floorTex: Tex.F_LINO, doorState: DoorState.HERMETIC_OPEN },
    support: [
      { name: 'Кухня белой петли', type: RoomType.KITCHEN, x: 46, y: 190, w: 24, h: 12, side: 'east', targetX: 84, targetY: 182, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      { name: 'Общая комната ожидающих пересадку', type: RoomType.COMMON, x: 122, y: 188, w: 28, h: 13, side: 'west', targetX: 110, targetY: 182, wallTex: Tex.PANEL, floorTex: Tex.F_LINO },
      { name: 'Санузел кассовой петли', type: RoomType.BATHROOM, x: 50, y: 142, w: 18, h: 10, side: 'east', targetX: 84, targetY: 168, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      { name: 'Кладовая честных жетонов', type: RoomType.STORAGE, x: 126, y: 142, w: 22, h: 10, side: 'west', targetX: 110, targetY: 168, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
    ],
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    core: { name: DARK_METRO_HQ_ROOM_NAMES.liquidator, type: RoomType.HQ, x: 742, y: 150, w: 28, h: 15, side: 'south', targetX: 690, targetY: 130, wallTex: Tex.HERMO_WALL, floorTex: Tex.F_CONCRETE, doorState: DoorState.HERMETIC_OPEN },
    support: [
      { name: 'Оружейная короткого хода', type: RoomType.STORAGE, x: 704, y: 170, w: 28, h: 12, side: 'east', targetX: 742, targetY: 158, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
      { name: 'Медшкаф белых ламп', type: RoomType.MEDICAL, x: 780, y: 170, w: 24, h: 12, side: 'west', targetX: 770, targetY: 158, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      { name: 'Кабинет рейсового журнала', type: RoomType.OFFICE, x: 704, y: 126, w: 28, h: 11, side: 'east', targetX: 742, targetY: 150, wallTex: Tex.MARBLE, floorTex: Tex.F_GREEN_CARPET },
      { name: 'Санузел поста короткого хода', type: RoomType.BATHROOM, x: 784, y: 126, w: 18, h: 10, side: 'west', targetX: 770, targetY: 150, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
    ],
  },
  {
    owner: ZoneFaction.CULTIST,
    core: { name: DARK_METRO_HQ_ROOM_NAMES.cultist, type: RoomType.HQ, x: 244, y: 846, w: 26, h: 14, side: 'south', targetX: 304, targetY: 908, wallTex: Tex.HERMO_WALL, floorTex: Tex.F_RED_CARPET, doorState: DoorState.HERMETIC_OPEN },
    support: [
      { name: 'Свечная кухня неверной станции', type: RoomType.KITCHEN, x: 204, y: 870, w: 24, h: 12, side: 'east', targetX: 244, targetY: 854, wallTex: Tex.DARK, floorTex: Tex.F_GREEN_CARPET },
      { name: 'Тихая комната объявления без голоса', type: RoomType.COMMON, x: 284, y: 870, w: 30, h: 12, side: 'west', targetX: 270, targetY: 854, wallTex: Tex.DARK, floorTex: Tex.F_RED_CARPET },
      { name: 'Кладовая копченых билетов', type: RoomType.STORAGE, x: 202, y: 822, w: 24, h: 10, side: 'east', targetX: 244, targetY: 846, wallTex: Tex.ROTTEN, floorTex: Tex.F_CONCRETE },
      { name: 'Санузел свечной платформы', type: RoomType.BATHROOM, x: 286, y: 822, w: 18, h: 10, side: 'west', targetX: 270, targetY: 846, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
    ],
  },
  {
    owner: ZoneFaction.SCIENTIST,
    core: { name: DARK_METRO_HQ_ROOM_NAMES.scientist, type: RoomType.HQ, x: 748, y: 708, w: 28, h: 15, side: 'north', targetX: 690, targetY: 775, wallTex: Tex.HERMO_WALL, floorTex: Tex.F_CONCRETE, doorState: DoorState.HERMETIC_OPEN },
    support: [
      { name: 'Лаборатория стрелочного шума', type: RoomType.PRODUCTION, x: 706, y: 734, w: 30, h: 13, side: 'east', targetX: 748, targetY: 716, wallTex: Tex.PIPE, floorTex: Tex.F_CONCRETE },
      { name: 'Медкабинет повторной станции', type: RoomType.MEDICAL, x: 790, y: 734, w: 28, h: 12, side: 'west', targetX: 776, targetY: 716, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      { name: 'Кабинет фазового расписания', type: RoomType.OFFICE, x: 706, y: 682, w: 28, h: 11, side: 'east', targetX: 748, targetY: 708, wallTex: Tex.MARBLE, floorTex: Tex.F_PARQUET },
      { name: 'Склад измеренных ламп', type: RoomType.STORAGE, x: 792, y: 682, w: 24, h: 10, side: 'west', targetX: 776, targetY: 708, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
    ],
  },
  {
    owner: ZoneFaction.WILD,
    core: { name: DARK_METRO_HQ_ROOM_NAMES.wild, type: RoomType.HQ, x: 568, y: 506, w: 36, h: 18, side: 'west', targetX: 512, targetY: 520, wallTex: Tex.HERMO_WALL, floorTex: Tex.F_CONCRETE, doorState: DoorState.HERMETIC_OPEN },
    support: [
      { name: 'Кухня черного перегона', type: RoomType.KITCHEN, x: 528, y: 532, w: 28, h: 14, side: 'east', targetX: 568, targetY: 520, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      { name: 'Общак пассажиров без билета', type: RoomType.COMMON, x: 612, y: 532, w: 32, h: 14, side: 'west', targetX: 604, targetY: 520, wallTex: Tex.PANEL, floorTex: Tex.F_LINO },
      { name: 'Склад сорванных поручней', type: RoomType.STORAGE, x: 528, y: 482, w: 30, h: 12, side: 'east', targetX: 568, targetY: 506, wallTex: Tex.BRICK, floorTex: Tex.F_CONCRETE },
      { name: 'Санузел разбитой платформы', type: RoomType.BATHROOM, x: 618, y: 482, w: 18, h: 10, side: 'west', targetX: 604, targetY: 506, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      { name: 'Западный герморазвал черного перегона', type: RoomType.HQ, x: 104, y: 520, w: 22, h: 12, side: 'east', targetX: 176, targetY: 520, wallTex: Tex.HERMO_WALL, floorTex: Tex.F_CONCRETE, doorState: DoorState.HERMETIC_OPEN },
      { name: 'Восточный герморазвал черного перегона', type: RoomType.HQ, x: 900, y: 520, w: 22, h: 12, side: 'west', targetX: 842, targetY: 520, wallTex: Tex.HERMO_WALL, floorTex: Tex.F_CONCRETE, doorState: DoorState.HERMETIC_OPEN },
    ],
  },
];

const DARK_METRO_TRANSFER_NODES = [
  { x: 524, y: 184, w: 18, h: 14, name: 'Пересадочный узел линий 1-2', a: [580, 133], b: [484, 246] },
  { x: 338, y: 324, w: 18, h: 14, name: 'Пересадочный узел линий 2-3', a: [304, 275], b: [390, 388] },
  { x: 676, y: 516, w: 18, h: 16, name: 'Пересадочный узел линий 3-4', a: [684, 432], b: [684, 630] },
  { x: 338, y: 706, w: 18, h: 14, name: 'Пересадочный узел линий 4-5', a: [304, 657], b: [390, 772] },
  { x: 524, y: 846, w: 18, h: 14, name: 'Пересадочный узел линий 5-6', a: [580, 801], b: [484, 906] },
] as const;

function axisDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, W - d);
}

function nearestDarkMetroLineDistance(y: number): number {
  let best = W;
  for (const lineY of DARK_METRO_FULL_LINE_YS) best = Math.min(best, axisDistance(y, lineY));
  return best;
}

function nearestDarkMetroDefendedPostDistance2(x: number, y: number): number {
  let best = Infinity;
  for (let line = 0; line < DARK_METRO_FULL_LINE_YS.length; line++) {
    const lineY = DARK_METRO_FULL_LINE_YS[line];
    const platformY = darkMetroPlatformY(lineY, line);
    const side = line % 2 === 0 ? 1 : -1;
    const roomY = side > 0 ? platformY + 11 : platformY - 11;
    const slots = line % 2 === 0 ? [1, 3] : [0, 2];
    const stations = darkMetroStationXs(line);
    for (const slot of slots) {
      const dx = axisDistance(x, stations[slot]);
      const dy = axisDistance(y, roomY);
      best = Math.min(best, dx * dx + dy * dy);
    }
  }
  return best;
}

export function tuneDarkMetroRouteZone(zone: Zone): void {
  const lineDistance = nearestDarkMetroLineDistance(zone.cy);
  const defended = nearestDarkMetroDefendedPostDistance2(zone.cx, zone.cy) <= 92 * 92;
  const serviceDistance = Math.min(axisDistance(zone.cx, 176), axisDistance(zone.cx, 842), axisDistance(zone.cx, 512));
  const serviceTunnel = serviceDistance <= 52 && zone.cy > 96 && zone.cy < 940;

  zone.level = defended ? 4 : lineDistance <= 44 || serviceTunnel ? 5 : 4;
  zone.faction = defended ? ZoneFaction.LIQUIDATOR
    : lineDistance <= 28 && zone.id % 4 === 0 ? ZoneFaction.SAMOSBOR
      : lineDistance <= 58 || serviceTunnel ? ZoneFaction.WILD
        : zone.id % 5 === 0 ? ZoneFaction.CULTIST
          : ZoneFaction.LIQUIDATOR;
  zone.fogged = false;
}

export function generateDarkMetroDesignFloor(seed = DARK_METRO_DEFAULT_SEED): DarkMetroGeneration {
  return withSeededRandom(seed, () => {
    const world = new World();
    const entities: Entity[] = [];
    const ctx: BuildCtx = {
      world,
      entities,
      nextId: { v: 1 },
      nextContainerId: { v: 1 },
      packedState: initialDarkMetroState(seed),
    };

    const layout = stampDarkMetroLayout(ctx);
    generateZones(world);
    tuneDarkMetroZones(world);
    dressDarkMetro(ctx, layout);
    seedCoreMetroTrain(ctx, layout);
    spawnDarkMetroNpcs(ctx, layout);
    spawnDarkMetroLoot(ctx, layout);
    spawnDarkMetroThreats(ctx, layout);
    registerDarkMetroRouteCues(ctx, layout);

    const spawnX = layout.hall.x + Math.floor(layout.hall.w / 2) + 0.5;
    const spawnY = layout.hall.y + Math.floor(layout.hall.h / 2) + 0.5;
    ensureConnectivity(world, spawnX, spawnY);
    sanitizeDoors(world);
    world.bakeLights();
    applyDarkMetroAmbientLight(world, layout, ctx.packedState);
    world.markFogDirty();

    return { world, entities, spawnX, spawnY, metroState: createDarkMetroFloorState(ctx.packedState) };
  });
}

export function expandDarkMetroFullFloorGeometry(
  world: World,
  rng: () => number,
  style: DarkMetroFullFloorStyle,
  entities?: Entity[],
): void {
  const protectedCells = darkMetroProtectedMask(world);
  for (let i = 0; i < DARK_METRO_FULL_LINE_YS.length; i++) {
    carveDarkMetroStationLine(world, protectedCells, DARK_METRO_FULL_LINE_YS[i], i, style, rng);
  }

  addDarkMetroTicketHalls(world, protectedCells, style);
  addDarkMetroServiceRoutes(world, protectedCells, style, rng);
  addDarkMetroTransferWeb(world, protectedCells, style);
  addDarkMetroTransferNodes(world, protectedCells, style);
  addDarkMetroRailBaitEdges(world, style);
  addDarkMetroDefendedPlatforms(world, protectedCells, style);
  addDarkMetroHqCompounds(world, protectedCells);
  addDarkMetroStationBlocks(world, protectedCells, style, rng);
  addDarkMetroServiceIslands(world, protectedCells, style, rng);
  addDarkMetroBlindCells(world, protectedCells, style, rng);
  applyDarkMetroPlatformSafetyShells(world);
  linkDarkMetroCoreToInterchange(world, style);
  if (entities) seedFullFloorMetroTrains(world, entities);
  world.markFogDirty();
}

function darkMetroProtectedMask(world: World): Uint8Array {
  const mask = new Uint8Array(W * W);
  for (const room of world.rooms) {
    if (!room) continue;
    for (let y = room.y - 1; y <= room.y + room.h; y++) {
      for (let x = room.x - 1; x <= room.x + room.w; x++) {
        mask[world.idx(x, y)] = 1;
      }
    }
  }
  for (const idx of world.doors.keys()) mask[idx] = 1;
  for (const container of world.containers) mask[world.idx(container.x, container.y)] = 1;
  return mask;
}

function clampDarkMetroRoomCoord(v: number, size: number): number {
  return Math.max(8, Math.min(W - size - 8, v));
}

function canStampDarkMetroRoom(world: World, mask: Uint8Array, x: number, y: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (mask[ci] || world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.WATER) return false;
      if (world.doors.has(ci) || world.roomMap[ci] >= 0) return false;
    }
  }
  return true;
}

function findDarkMetroRoomSpot(
  world: World,
  mask: Uint8Array,
  desiredX: number,
  desiredY: number,
  w: number,
  h: number,
  radius: number,
): { x: number; y: number } | null {
  const baseX = clampDarkMetroRoomCoord(desiredX, w);
  const baseY = clampDarkMetroRoomCoord(desiredY, h);
  if (canStampDarkMetroRoom(world, mask, baseX, baseY, w, h)) return { x: baseX, y: baseY };
  for (let r = 4; r <= radius; r += 4) {
    for (let dy = -r; dy <= r; dy += 4) {
      for (let dx = -r; dx <= r; dx += 4) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = clampDarkMetroRoomCoord(baseX + dx, w);
        const y = clampDarkMetroRoomCoord(baseY + dy, h);
        if (canStampDarkMetroRoom(world, mask, x, y, w, h)) return { x, y };
      }
    }
  }
  return null;
}

function rememberDarkMetroRoomMask(world: World, mask: Uint8Array, room: Room): void {
  markMetroMask(mask, world, room.x - 2, room.y - 2, room.w + 4, room.h + 4);
}

function paintDarkMetroRoomOwner(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.cells[ci] !== Cell.LIFT && !world.aptMask[ci]) setTerritoryOwnerAtIndex(world, ci, owner);
    }
  }
  for (const doorIdx of room.doors) setTerritoryOwnerAtIndex(world, doorIdx, owner);
}

function decorateDarkMetroOwnedRoom(world: World, room: Room, owner: TerritoryOwner, seed: number): void {
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  const put = (x: number, y: number, feature: Feature): void => {
    const ci = world.idx(x, y);
    if (world.roomMap[ci] === room.id && world.features[ci] === Feature.NONE) world.features[ci] = feature;
  };
  if (room.type === RoomType.KITCHEN) {
    put(room.x + 2, room.y + 2, Feature.STOVE);
    put(room.x + room.w - 3, room.y + 2, Feature.SINK);
    put(cx, cy, Feature.TABLE);
    return;
  }
  if (room.type === RoomType.BATHROOM) {
    put(room.x + 2, room.y + 2, Feature.TOILET);
    put(room.x + room.w - 3, room.y + 2, Feature.SINK);
    return;
  }
  if (room.type === RoomType.STORAGE) {
    put(room.x + 2, room.y + 2, Feature.SHELF);
    put(room.x + room.w - 3, room.y + room.h - 3, Feature.SHELF);
    return;
  }
  if (room.type === RoomType.PRODUCTION) {
    put(room.x + 3, room.y + 2, Feature.MACHINE);
    put(room.x + room.w - 4, room.y + room.h - 3, Feature.APPARATUS);
    return;
  }
  if (room.type === RoomType.MEDICAL) {
    put(room.x + 2, room.y + 2, Feature.BED);
    put(room.x + room.w - 3, room.y + 2, Feature.SHELF);
    return;
  }
  if (room.type === RoomType.OFFICE) {
    put(cx, cy, Feature.TABLE);
    put(room.x + room.w - 3, room.y + 2, Feature.SCREEN);
    return;
  }
  if (room.type === RoomType.HQ) {
    put(room.x + 3, room.y + 2, owner === ZoneFaction.CULTIST ? Feature.CANDLE : Feature.LAMP);
    put(cx, cy, Feature.TABLE);
    put(room.x + room.w - 4, room.y + room.h - 3, owner === ZoneFaction.SCIENTIST ? Feature.APPARATUS : Feature.SHELF);
    return;
  }
  put(cx, cy, Feature.TABLE);
  put(room.x + 3 + (seed % Math.max(1, room.w - 6)), room.y + Math.max(2, room.h - 3), Feature.CHAIR);
}

function addDarkMetroDoor(
  world: World,
  x: number,
  y: number,
  room: Room,
  state: DoorState,
  keyId = '',
): number {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT) return ci;
  world.cells[ci] = Cell.DOOR;
  world.roomMap[ci] = -1;
  world.wallTex[ci] = Tex.DOOR_METAL;
  world.floorTex[ci] = room.floorTex;
  world.doors.set(ci, { idx: ci, state, roomA: room.id, roomB: -1, keyId, timer: 0 });
  if (!room.doors.includes(ci)) room.doors.push(ci);
  return ci;
}

function connectDarkMetroRoomToPoint(
  world: World,
  room: Room,
  side: DarkMetroRoomSide,
  targetX: number,
  targetY: number,
  state: DoorState,
): void {
  const midX = room.x + (room.w >> 1);
  const midY = room.y + (room.h >> 1);
  const doorX = side === 'west' ? room.x - 1 : side === 'east' ? room.x + room.w : midX;
  const doorY = side === 'north' ? room.y - 1 : side === 'south' ? room.y + room.h : midY;
  addDarkMetroDoor(world, doorX, doorY, room, state);
  const startX = side === 'west' ? doorX - 1 : side === 'east' ? doorX + 1 : doorX;
  const startY = side === 'north' ? doorY - 1 : side === 'south' ? doorY + 1 : doorY;
  carveMetroLine(world, null, startX, startY, targetX, targetY, 0, room.floorTex);
}

function hardenDarkMetroHqRoom(world: World, room: Room, owner: TerritoryOwner): void {
  room.type = RoomType.HQ;
  room.sealed = true;
  room.wallTex = Tex.HERMO_WALL;
  paintDarkMetroRoomOwner(world, room, owner);
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      const inside = dx >= 0 && dx < room.w && dy >= 0 && dy < room.h;
      if (inside) continue;
      if (world.cells[ci] !== Cell.WALL || world.aptMask[ci]) continue;
      world.hermoWall[ci] = 1;
      world.wallTex[ci] = Tex.HERMO_WALL;
    }
  }
  for (const doorIdx of room.doors) {
    const door = world.doors.get(doorIdx);
    if (!door) continue;
    door.state = DoorState.HERMETIC_OPEN;
    door.keyId = '';
    world.hermoWall[doorIdx] = 1;
    world.wallTex[doorIdx] = Tex.HERMO_WALL;
    setTerritoryOwnerAtIndex(world, doorIdx, owner);
  }
}

function addDarkMetroOwnedRoom(
  world: World,
  mask: Uint8Array,
  spec: DarkMetroOwnedRoomSpec,
  owner: TerritoryOwner,
  seed: number,
): Room | null {
  const spot = findDarkMetroRoomSpot(world, mask, spec.x, spec.y, spec.w, spec.h, spec.type === RoomType.HQ ? 18 : 36);
  if (!spot) return null;
  const room = styledRoom(world, spec.type, spot.x, spot.y, spec.w, spec.h, spec.name, spec.wallTex, spec.floorTex);
  paintDarkMetroRoomOwner(world, room, owner);
  decorateDarkMetroOwnedRoom(world, room, owner, seed);
  connectDarkMetroRoomToPoint(world, room, spec.side, spec.targetX, spec.targetY, spec.doorState ?? DoorState.CLOSED);
  if (spec.type === RoomType.HQ || spec.doorState === DoorState.HERMETIC_OPEN) hardenDarkMetroHqRoom(world, room, owner);
  rememberDarkMetroRoomMask(world, mask, room);
  return room;
}

function addDarkMetroHqCompounds(world: World, mask: Uint8Array): void {
  for (const compound of DARK_METRO_HQ_COMPOUNDS) {
    addDarkMetroOwnedRoom(world, mask, compound.core, compound.owner, compound.owner * 101);
    for (let i = 0; i < compound.support.length; i++) {
      addDarkMetroOwnedRoom(world, mask, compound.support[i], compound.owner, compound.owner * 101 + i + 1);
    }
  }
}

function darkMetroStationOwner(line: number, slot: number): TerritoryOwner {
  const owners = [
    ZoneFaction.LIQUIDATOR,
    ZoneFaction.WILD,
    ZoneFaction.CULTIST,
    ZoneFaction.SCIENTIST,
    ZoneFaction.WILD,
    ZoneFaction.CITIZEN,
  ] as const;
  return owners[(line * 2 + slot) % owners.length];
}

function darkMetroMicroSpec(
  prefix: string,
  serial: number,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  side: DarkMetroRoomSide,
  targetX: number,
  targetY: number,
  wallTex: Tex,
  floorTex: Tex,
): DarkMetroOwnedRoomSpec {
  return { name: `${prefix} ${serial}`, type, x, y, w, h, side, targetX, targetY, wallTex, floorTex, doorState: type === RoomType.STORAGE || type === RoomType.OFFICE ? DoorState.CLOSED : DoorState.OPEN };
}

function addDarkMetroStationBlocks(
  world: World,
  mask: Uint8Array,
  style: DarkMetroFullFloorStyle,
  rng: () => number,
): void {
  let serial = 1;
  const microTypes = [
    RoomType.STORAGE,
    RoomType.BATHROOM,
    RoomType.OFFICE,
    RoomType.PRODUCTION,
    RoomType.KITCHEN,
    RoomType.SMOKING,
  ] as const;
  for (let line = 0; line < DARK_METRO_FULL_LINE_YS.length; line++) {
    const lineY = DARK_METRO_FULL_LINE_YS[line];
    const platformY = darkMetroPlatformY(lineY, line);
    const blockSide = line % 2 === 0 ? -1 : 1;
    const stations = darkMetroStationXs(line);
    for (let slot = 0; slot < stations.length; slot++) {
      const owner = darkMetroStationOwner(line, slot);
      const hallW = 38;
      const hallH = 12;
      const hallX = stations[slot] - (hallW >> 1);
      const hallY = blockSide < 0 ? platformY - hallH - 20 : platformY + 20;
      const hall = addDarkMetroOwnedRoom(world, mask, {
        name: `Станционный блок темной пересадки ${line + 1}-${slot + 1}`,
        type: RoomType.COMMON,
        x: hallX,
        y: hallY,
        w: hallW,
        h: hallH,
        side: blockSide < 0 ? 'south' : 'north',
        targetX: stations[slot],
        targetY: platformY,
        wallTex: style.wallTex,
        floorTex: Tex.F_TILE,
        doorState: DoorState.OPEN,
      }, owner, line * 97 + slot);
      if (!hall) continue;

      const backY = blockSide < 0 ? hall.y - 17 : hall.y + hall.h + 8;
      const backSide: DarkMetroRoomSide = blockSide < 0 ? 'south' : 'north';
      const sideY = hall.y + 2;
      const specs = [
        darkMetroMicroSpec('Кладовая станции темной пересадки', serial++, microTypes[(line + slot) % microTypes.length], hall.x - 20, sideY, 12, 8, 'east', hall.x, hall.y + 5, Tex.METAL, Tex.F_CONCRETE),
        darkMetroMicroSpec('Будка станции темной пересадки', serial++, microTypes[(line + slot + 1) % microTypes.length], hall.x + hall.w + 8, sideY, 12, 8, 'west', hall.x + hall.w - 1, hall.y + 5, Tex.PIPE, style.floorTex),
        darkMetroMicroSpec('Задняя ячейка темной пересадки', serial++, microTypes[(line + slot + 2) % microTypes.length], hall.x, backY, 12, 8, backSide, hall.x + 6, hall.y + (blockSide < 0 ? 0 : hall.h - 1), Tex.PANEL, Tex.F_LINO),
        darkMetroMicroSpec('Ламповая ячейка темной пересадки', serial++, microTypes[(line + slot + 3) % microTypes.length], hall.x + 13, backY + Math.floor(rng() * 3) - 1, 12, 8, backSide, hall.x + 19, hall.y + (blockSide < 0 ? 0 : hall.h - 1), Tex.DARK, Tex.F_CONCRETE),
        darkMetroMicroSpec('Архивная ячейка темной пересадки', serial++, microTypes[(line + slot + 4) % microTypes.length], hall.x + 26, backY, 12, 8, backSide, hall.x + 31, hall.y + (blockSide < 0 ? 0 : hall.h - 1), Tex.METAL, Tex.F_CONCRETE),
        darkMetroMicroSpec('Боковой карман темной пересадки', serial++, microTypes[(line + slot + 5) % microTypes.length], hall.x + 8, blockSide < 0 ? hall.y + hall.h + 7 : hall.y - 15, 18, 7, blockSide < 0 ? 'north' : 'south', hall.x + 19, hall.y + (blockSide < 0 ? hall.h - 1 : 0), Tex.CONCRETE, style.floorTex),
      ];
      for (let i = 0; i < specs.length; i++) {
        addDarkMetroOwnedRoom(world, mask, specs[i], owner, line * 409 + slot * 31 + i);
      }
    }
  }
}

function addDarkMetroServiceIslands(
  world: World,
  mask: Uint8Array,
  style: DarkMetroFullFloorStyle,
  rng: () => number,
): void {
  let serial = 1;
  const ys = [158, 214, 324, 468, 560, 706, 852, 902] as const;
  for (const tunnel of [{ x: 176, side: 1 }, { x: 842, side: -1 }] as const) {
    for (let i = 0; i < ys.length; i++) {
      const y = ys[i] + Math.floor(rng() * 5) - 2;
      const owner = i % 3 === 0 ? ZoneFaction.LIQUIDATOR : i % 3 === 1 ? ZoneFaction.WILD : ZoneFaction.SCIENTIST;
      const x = tunnel.x + tunnel.side * (tunnel.side > 0 ? 18 : 42);
      const side: DarkMetroRoomSide = tunnel.side > 0 ? 'west' : 'east';
      addDarkMetroOwnedRoom(world, mask, {
        name: `Сервисный остров темной пересадки ${serial++}`,
        type: i % 4 === 0 ? RoomType.PRODUCTION : i % 4 === 1 ? RoomType.STORAGE : i % 4 === 2 ? RoomType.OFFICE : RoomType.BATHROOM,
        x,
        y,
        w: i % 2 === 0 ? 24 : 18,
        h: i % 2 === 0 ? 10 : 9,
        side,
        targetX: tunnel.x,
        targetY: y + 4,
        wallTex: i % 2 === 0 ? Tex.PIPE : Tex.METAL,
        floorTex: style.floorTex,
        doorState: DoorState.CLOSED,
      }, owner, serial * 13);
    }
  }
}

function addDarkMetroBlindCells(
  world: World,
  mask: Uint8Array,
  style: DarkMetroFullFloorStyle,
  rng: () => number,
): void {
  let serial = 1;
  const bands = [
    { y: 178, targetY: 130 },
    { y: 326, targetY: 249 },
    { y: 520, targetY: 414 },
    { y: 708, targetY: 654 },
    { y: 850, targetY: 797 },
  ] as const;
  for (const band of bands) {
    for (let x = 250; x <= 754; x += 84) {
      const owner = x % 4 === 0 ? ZoneFaction.CULTIST : x % 3 === 0 ? ZoneFaction.SCIENTIST : ZoneFaction.WILD;
      const side: DarkMetroRoomSide = band.y < band.targetY ? 'south' : 'north';
      const room = addDarkMetroOwnedRoom(world, mask, {
        name: `Слепая подсобка темной пересадки ${serial++}`,
        type: serial % 5 === 0 ? RoomType.KITCHEN : serial % 5 === 1 ? RoomType.STORAGE : serial % 5 === 2 ? RoomType.OFFICE : serial % 5 === 3 ? RoomType.BATHROOM : RoomType.COMMON,
        x: x + Math.floor(rng() * 7) - 3,
        y: band.y + Math.floor(rng() * 7) - 3,
        w: 18 + (serial % 3) * 4,
        h: 8 + (serial % 2) * 3,
        side,
        targetX: x,
        targetY: band.targetY,
        wallTex: serial % 2 === 0 ? Tex.DARK : style.wallTex,
        floorTex: serial % 2 === 0 ? Tex.F_CONCRETE : Tex.F_LINO,
        doorState: serial % 4 === 0 ? DoorState.LOCKED : DoorState.CLOSED,
      }, owner, serial * 29);
      if (room && serial % 6 === 0) setDarkMetroFog(world, room.x + (room.w >> 1), room.y + (room.h >> 1), 28);
    }
  }
}

function carveDarkMetroStationLine(
  world: World,
  mask: Uint8Array,
  y: number,
  line: number,
  style: DarkMetroFullFloorStyle,
  rng: () => number,
): void {
  const x0 = 44;
  const w = W - 88;
  const lampOffset = Math.floor(rng() * 18);

  carveMetroRect(world, mask, x0, y - 13, w, 5, style.floorTex);
  carveMetroTrack(world, mask, x0, y - 7, w, 5);
  carveMetroRect(world, mask, x0, y - 1, w, 4, style.floorTex);
  carveMetroTrack(world, mask, x0, y + 4, w, 5);
  carveMetroRect(world, mask, x0, y + 10, w, 5, style.floorTex);

  for (let x = 90 + (line % 2) * 46; x < W - 90; x += 174) {
    carveMetroRect(world, mask, x, y - 13, 5, 28, style.floorTex);
    setFeature(world, x + 2, y - 10, line % 3 === 0 ? Feature.SCREEN : Feature.LAMP);
    setFeature(world, x + 2, y + 12, line % 2 === 0 ? Feature.LAMP : Feature.CANDLE);
  }

  for (let x = 72 + lampOffset; x < W - 72; x += 64) {
    setFeature(world, x, y - 11, Feature.LAMP);
    if ((x + line) % 3 === 0) setFeature(world, x + 8, y + 12, Feature.CANDLE);
    if ((x + line) % 5 === 0) setFeature(world, x + 17, y + 1, Feature.SCREEN);
  }

  const trainX = 158 + ((line * 149) % 640);
  const trainY = y + (line % 2 === 0 ? -7 : 4);
  addDeadTrainShell(world, mask, trainX, trainY, line, style);
}

function addDeadTrainShell(
  world: World,
  mask: Uint8Array,
  x: number,
  y: number,
  line: number,
  style: DarkMetroFullFloorStyle,
): void {
  if (!canPlaceMetroRoom(world, mask, x, y, 92, 5)) return;
  const train = styledRoom(world, RoomType.CORRIDOR, x, y, 92, 5, `Мертвый вагон линии ${line + 1}`, Tex.METAL, Tex.F_CONCRETE);
  carveMetroRect(world, null, train.x - 2, train.y + 2, 4, 1, style.floorTex);
  carveMetroRect(world, null, train.x + train.w - 2, train.y + 2, 4, 1, style.floorTex);
  for (let i = 8; i < train.w - 8; i += 14) {
    setFeature(world, train.x + i, train.y + 1, Feature.CHAIR);
    if (i % 28 === 0) setFeature(world, train.x + i + 5, train.y + 3, Feature.CANDLE);
    stampSurfaceSplat(world, train.x + i, train.y + 2, 0.5, 0.5, 1.7, 0.18, hashSeed(`dark_metro_train.${line}.${i}`), 42, 38, 44, false);
  }
}

function addDarkMetroTicketHalls(world: World, mask: Uint8Array, style: DarkMetroFullFloorStyle): void {
  const halls = [
    { x: 74, y: 66, w: 86, h: 30, name: 'Северный билетный зал', tx: 118, ty: DARK_METRO_FULL_LINE_YS[0] - 13 },
    { x: 770, y: 210, w: 102, h: 32, name: 'Зал погашенных жетонов', tx: 820, ty: DARK_METRO_FULL_LINE_YS[1] - 13 },
    { x: 116, y: 734, w: 92, h: 34, name: 'Кассовая развязка без касс', tx: 160, ty: DARK_METRO_FULL_LINE_YS[4] - 13 },
    { x: 702, y: 872, w: 112, h: 34, name: 'Южный зал неверных объявлений', tx: 760, ty: DARK_METRO_FULL_LINE_YS[5] - 13 },
  ];

  for (const h of halls) {
    const room = addDarkMetroLandmarkRoom(world, mask, RoomType.COMMON, h.x, h.y, h.w, h.h, h.name, style.wallTex, Tex.F_TILE);
    if (!room) continue;
    carveMetroLine(world, null, room.x + (room.w >> 1), room.y + room.h - 1, h.tx, h.ty, 2, Tex.F_TILE);
    setFeature(world, room.x + 5, room.y + 5, Feature.SCREEN);
    setFeature(world, room.x + room.w - 6, room.y + 5, Feature.LAMP);
    setFeature(world, room.x + (room.w >> 1), room.y + (room.h >> 1), Feature.TABLE);
    setFeature(world, room.x + (room.w >> 1) + 4, room.y + (room.h >> 1), Feature.SHELF);
  }
}

function addDarkMetroServiceRoutes(
  world: World,
  mask: Uint8Array,
  style: DarkMetroFullFloorStyle,
  rng: () => number,
): void {
  const tunnels = [
    { x: 176, side: 1 },
    { x: 842, side: -1 },
  ];

  for (const tunnel of tunnels) {
    carveMetroLine(world, mask, tunnel.x, 82, tunnel.x, 950, 2, Tex.F_CONCRETE);
    for (let y = 98; y < 950; y += 34) {
      setDarkMetroFog(world, tunnel.x, y, 34);
      if (y % 102 === 0) setFeature(world, tunnel.x + tunnel.side, y, Feature.CANDLE);
    }
    for (let i = 0; i < DARK_METRO_FULL_LINE_YS.length; i++) {
      const y = DARK_METRO_FULL_LINE_YS[i];
      setFeature(world, tunnel.x + tunnel.side * 2, y, Feature.APPARATUS);
      if (i % 2 === 0) {
        const rx = tunnel.x + tunnel.side * (10 + Math.floor(rng() * 8));
        const room = addDarkMetroLandmarkRoom(world, mask, RoomType.PRODUCTION, rx, y - 14, 20, 12, `Стрелочная будка ${i + 1}`, Tex.PIPE, style.floorTex);
        if (room) {
          carveMetroLine(world, null, room.x + (tunnel.side > 0 ? 0 : room.w - 1), room.y + (room.h >> 1), tunnel.x, y, 1, style.floorTex);
          setFeature(world, room.x + 4, room.y + 3, Feature.MACHINE);
          setFeature(world, room.x + room.w - 5, room.y + 4, Feature.SCREEN);
        }
      }
    }
  }

  const stair = addDarkMetroLandmarkRoom(world, mask, RoomType.CORRIDOR, 700, 504, 18, 70, 'Служебная лестница между линиями', Tex.DARK, style.floorTex);
  if (stair) {
    carveMetroLine(world, null, stair.x + 9, DARK_METRO_FULL_LINE_YS[2] + 14, stair.x + 9, DARK_METRO_FULL_LINE_YS[3] - 13, 2, style.floorTex);
    for (let y = stair.y + 5; y < stair.y + stair.h - 4; y += 10) {
      setFeature(world, stair.x + 4, y, Feature.CANDLE);
      setDarkMetroFog(world, stair.x + 9, y, 26);
    }
  }
}

function addDarkMetroTransferWeb(world: World, mask: Uint8Array, style: DarkMetroFullFloorStyle): void {
  for (let i = 1; i < DARK_METRO_FULL_LINE_YS.length; i++) {
    const prevY = DARK_METRO_FULL_LINE_YS[i - 1];
    const y = DARK_METRO_FULL_LINE_YS[i];
    const x0 = i % 2 === 0 ? 304 : 580;
    const x1 = x0 + (i % 2 === 0 ? 86 : -96);
    carveMetroLine(world, mask, x0, prevY + 15, x1, y - 14, 2, style.floorTex);
    setFeature(world, x0, prevY + 18, Feature.LAMP);
    setFeature(world, x1, y - 17, i % 2 === 0 ? Feature.SCREEN : Feature.CANDLE);
  }

  for (const x of [340, 512, 684]) {
    carveMetroLine(world, mask, x, DARK_METRO_FULL_LINE_YS[1] + 14, x, DARK_METRO_FULL_LINE_YS[4] - 13, 1, Tex.F_CONCRETE);
    for (let y = DARK_METRO_FULL_LINE_YS[1] + 34; y < DARK_METRO_FULL_LINE_YS[4] - 20; y += 78) {
      setFeature(world, x, y, x === 512 ? Feature.CANDLE : Feature.LAMP);
      setDarkMetroFog(world, x, y, x === 512 ? 42 : 22);
    }
  }
}

function addDarkMetroTransferNodes(world: World, mask: Uint8Array, style: DarkMetroFullFloorStyle): void {
  for (const node of DARK_METRO_TRANSFER_NODES) {
    const room = addDarkMetroOpenNodeRoom(world, node.x, node.y, node.w, node.h, node.name, Tex.F_TILE, RoomType.CORRIDOR);
    markMetroMask(mask, world, node.x - 1, node.y - 1, node.w + 2, node.h + 2);
    const cx = room.x + (room.w >> 1);
    const cy = room.y + (room.h >> 1);
    carveMetroLine(world, null, cx, cy, node.a[0], node.a[1], 2, style.floorTex);
    carveMetroLine(world, null, cx, cy, node.b[0], node.b[1], 2, style.floorTex);
    setFeature(world, cx - 5, cy, Feature.LAMP);
    setFeature(world, cx, cy, Feature.SCREEN);
    setFeature(world, cx + 5, cy, Feature.LAMP);
    setFeature(world, cx, cy + 3, Feature.CHAIR);
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        const ci = world.idx(x, y);
        if (world.cells[ci] !== Cell.WALL && world.cells[ci] !== Cell.LIFT) world.fog[ci] = Math.min(world.fog[ci], 6);
      }
    }
  }
}

function addDarkMetroRailBaitEdges(world: World, style: DarkMetroFullFloorStyle): void {
  for (let line = 0; line < DARK_METRO_FULL_LINE_YS.length; line++) {
    const lineY = DARK_METRO_FULL_LINE_YS[line];
    const platformY = darkMetroPlatformY(lineY, line);
    const stations = darkMetroStationXs(line);
    const x = stations[line % 2 === 0 ? 2 : 1];
    const room = addDarkMetroOpenNodeRoom(
      world,
      x - 14,
      platformY - 1,
      28,
      3,
      `Приманочная кромка линии ${line + 1}`,
      style.floorTex,
      RoomType.CORRIDOR,
    );
    setFeature(world, room.x + 6, room.y + 1, Feature.CANDLE);
    setFeature(world, room.x + 14, room.y + 1, Feature.SCREEN);
    setFeature(world, room.x + 22, room.y + 1, Feature.CANDLE);
    stampSurfaceSplat(world, room.x + 14, room.y + 1, 0.5, 0.5, 2.1, 0.2, hashSeed(`dark_metro_bait.${line}`), 72, 54, 38, false);
  }
}

function addDarkMetroOpenNodeRoom(
  world: World,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  floorTex: Tex,
  type: RoomType,
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
    wallTex: Tex.METAL,
    floorTex,
  };
  world.rooms.push(room);
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      openMetroTile(world, null, x + dx, y + dy, floorTex);
      const ci = world.idx(x + dx, y + dy);
      if (world.cells[ci] !== Cell.LIFT) world.roomMap[ci] = room.id;
    }
  }
  return room;
}

function addDarkMetroDefendedPlatforms(world: World, mask: Uint8Array, style: DarkMetroFullFloorStyle): void {
  for (let line = 0; line < DARK_METRO_FULL_LINE_YS.length; line++) {
    const lineY = DARK_METRO_FULL_LINE_YS[line];
    const platformY = darkMetroPlatformY(lineY, line);
    const side = line % 2 === 0 ? 1 : -1;
    const stations = darkMetroStationXs(line);
    const slots = line % 2 === 0 ? [1, 3] : [0, 2];
    for (let i = 0; i < slots.length; i++) {
      const platformX = stations[slots[i]];
      addDarkMetroOpenPlatformRoom(
        world,
        platformX - 16,
        platformY - 1,
        32,
        3,
        `Обороняемая кромка линии ${line + 1}-${i + 1}`,
        style.floorTex,
      );
      setFeature(world, platformX - 8, platformY, Feature.LAMP);
      setFeature(world, platformX + 8, platformY, Feature.SCREEN);

      const roomW = i === 0 ? 26 : 24;
      const roomH = 8;
      const roomX = Math.max(38, Math.min(W - 38 - roomW, platformX - (roomW >> 1)));
      const roomY = side > 0 ? platformY + 7 : platformY - roomH - 7;
      const room = addDarkMetroLandmarkRoom(
        world,
        mask,
        RoomType.HQ,
        roomX,
        roomY,
        roomW,
        roomH,
        `Пост белой лампы ${line + 1}-${i + 1}`,
        Tex.METAL,
        Tex.F_CONCRETE,
      );
      if (!room) continue;
      markMetroMask(mask, world, room.x - 1, room.y - 1, room.w + 2, room.h + 2);

      const doorX = room.x + (room.w >> 1);
      const doorY = side > 0 ? room.y - 1 : room.y + room.h;
      const outsideY = side > 0 ? doorY - 1 : doorY + 1;
      carveMetroLine(world, null, doorX, outsideY, platformX, platformY, 1, style.floorTex);
      placeDoor(world, doorX, doorY, room.id, -1);

      setFeature(world, room.x + 3, room.y + 2, Feature.LAMP);
      setFeature(world, room.x + room.w - 4, room.y + 2, Feature.SCREEN);
      setFeature(world, room.x + 7, room.y + room.h - 3, Feature.TABLE);
      setFeature(world, room.x + room.w - 5, room.y + room.h - 3, Feature.SHELF);
      addDarkMetroTransitCache(world, room, room.x + room.w - 5, room.y + room.h - 3, line, i);
    }
  }
}

function applyDarkMetroPlatformSafetyShells(world: World): void {
  const seedCells: number[] = [];
  for (const room of world.rooms) {
    if (!room) continue;
    if (
      !room.name.startsWith('Пост белой лампы') &&
      !room.name.startsWith('Обороняемая кромка') &&
      !room.name.startsWith('Пересадочный узел')
    ) continue;
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        const ci = world.idx(x, y);
        if (darkMetroSafetyShellPassable(world, ci)) seedCells.push(ci);
      }
    }
  }
  if (seedCells.length === 0) return;

  const dist = new Int16Array(W * W).fill(-1);
  const queue = new Int32Array(W * W);
  let head = 0;
  let tail = 0;
  for (const ci of seedCells) {
    if (dist[ci] >= 0) continue;
    dist[ci] = 0;
    queue[tail++] = ci;
  }

  let lamps = 0;
  const maxLamps = 96;
  while (head < tail) {
    const ci = queue[head++];
    const d = dist[ci];
    const x = ci % W;
    const y = (ci / W) | 0;
    world.fog[ci] = Math.min(world.fog[ci], d <= 9 ? 0 : 10);
    if (
      d >= 5 &&
      lamps < maxLamps &&
      world.cells[ci] === Cell.FLOOR &&
      world.features[ci] === Feature.NONE &&
      (Math.imul(ci ^ 0x51f0_0d31, 1103515245) >>> 0) % 83 === 0
    ) {
      world.features[ci] = Feature.LAMP;
      lamps++;
    }
    if (d >= DARK_METRO_SAFETY_SHELL_RADIUS) continue;
    if (enqueueDarkMetroSafetyNeighbor(world, dist, queue, tail, x + 1, y, d + 1)) tail++;
    if (enqueueDarkMetroSafetyNeighbor(world, dist, queue, tail, x - 1, y, d + 1)) tail++;
    if (enqueueDarkMetroSafetyNeighbor(world, dist, queue, tail, x, y + 1, d + 1)) tail++;
    if (enqueueDarkMetroSafetyNeighbor(world, dist, queue, tail, x, y - 1, d + 1)) tail++;
  }
}

function enqueueDarkMetroSafetyNeighbor(
  world: World,
  dist: Int16Array,
  queue: Int32Array,
  tail: number,
  x: number,
  y: number,
  d: number,
): boolean {
  const ci = world.idx(x, y);
  if (dist[ci] >= 0 || !darkMetroSafetyShellPassable(world, ci)) return false;
  dist[ci] = d;
  queue[tail] = ci;
  return true;
}

function darkMetroSafetyShellPassable(world: World, ci: number): boolean {
  const cell = world.cells[ci];
  return cell === Cell.FLOOR || cell === Cell.DOOR;
}

function addDarkMetroOpenPlatformRoom(world: World, x: number, y: number, w: number, h: number, name: string, floorTex: Tex): Room {
  const room: Room = {
    id: world.rooms.length,
    type: RoomType.HQ,
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
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.cells[ci] !== Cell.FLOOR) continue;
      world.roomMap[ci] = room.id;
      world.floorTex[ci] = floorTex;
    }
  }
  return room;
}

function darkMetroStationXs(line: number): readonly number[] {
  return [
    132 + line * 11,
    398 + (line % 2) * 54,
    690 - (line % 3) * 23,
    884 - line * 7,
  ].map(x => Math.max(72, Math.min(W - 72, x)));
}

function darkMetroPlatformY(lineY: number, line: number): number {
  return lineY + (line % 2 === 0 ? 12 : -11);
}

function markMetroMask(mask: Uint8Array, world: World, x: number, y: number, w: number, h: number): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      mask[world.idx(x + dx, y + dy)] = 1;
    }
  }
}

function nextDarkMetroContainerId(world: World): number {
  let next = 1;
  for (const container of world.containers) next = Math.max(next, container.id + 1);
  return next;
}

function addDarkMetroTransitCache(world: World, room: Room, x: number, y: number, line: number, slot: number): void {
  const inventory: WorldContainer['inventory'] = line % 3 === 0
    ? [{ defId: 'metro_ticket', count: 1 }, { defId: 'ammo_9mm', count: 10 }, { defId: 'bandage', count: 1 }]
    : line % 3 === 1
      ? [{ defId: 'fuse', count: 1 }, { defId: 'lamp_bulb', count: 1 }, { defId: 'water', count: 1 }]
      : [{ defId: 'gasmask_filter', count: 1 }, { defId: 'ammo_9mm', count: 6 }, { defId: 'metro_ticket', count: 1 }];
  const ci = world.idx(x, y);
  world.addContainer({
    id: nextDarkMetroContainerId(world),
    x,
    y,
    floor: DARK_METRO_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind: slot === 0 ? ContainerKind.TOOL_LOCKER : ContainerKind.EMERGENCY_BOX,
    name: slot === 0 ? `Постовой ящик линии ${line + 1}` : `Аварийный кэш линии ${line + 1}`,
    inventory,
    capacitySlots: 8,
    ownerName: 'пост белой лампы',
    faction: Faction.LIQUIDATOR,
    access: slot === 0 ? 'faction' : 'locked',
    lockDifficulty: slot === 0 ? undefined : 4,
    discovered: true,
    tags: ['dark_metro', 'transit_cache', 'platform', 'train_risk'],
  });
}

function linkDarkMetroCoreToInterchange(world: World, style: DarkMetroFullFloorStyle): void {
  const platform = world.rooms.find(r => r?.name === 'Платформа без расписания');
  const exit = world.rooms.find(r => r?.name === 'Служебный выход к лифтам');
  if (platform) {
    carveMetroLine(world, null, platform.x + platform.w - 3, platform.y + platform.h - 1, 700, 540, 2, style.floorTex);
    setFeature(world, platform.x + platform.w - 5, platform.y + 2, Feature.SCREEN);
  }
  if (exit) {
    carveMetroLine(world, null, exit.x + 2, exit.y + 3, 700, 540, 1, Tex.F_CONCRETE);
    setFeature(world, exit.x + 3, exit.y + 5, Feature.LAMP);
  }
}

function addDarkMetroLandmarkRoom(
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
): Room | null {
  if (!canPlaceMetroRoom(world, mask, x, y, w, h)) return null;
  return styledRoom(world, type, x, y, w, h, name, wallTex, floorTex);
}

function canPlaceMetroRoom(world: World, mask: Uint8Array, x: number, y: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      if (mask[world.idx(x + dx, y + dy)]) return false;
    }
  }
  return true;
}

function carveMetroLine(
  world: World,
  mask: Uint8Array | null,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  floorTex: Tex,
): void {
  let x = world.wrap(ax);
  let y = world.wrap(ay);
  const tx = world.wrap(bx);
  const ty = world.wrap(by);
  const sx = world.delta(x, tx) >= 0 ? 1 : -1;
  const sy = world.delta(y, ty) >= 0 ? 1 : -1;
  while (x !== tx) {
    carveMetroDisc(world, mask, x, y, width, floorTex);
    x = world.wrap(x + sx);
  }
  while (y !== ty) {
    carveMetroDisc(world, mask, x, y, width, floorTex);
    y = world.wrap(y + sy);
  }
  carveMetroDisc(world, mask, x, y, width, floorTex);
}

function carveMetroDisc(world: World, mask: Uint8Array | null, cx: number, cy: number, r: number, floorTex: Tex): void {
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      openMetroTile(world, mask, cx + dx, cy + dy, floorTex);
    }
  }
}

function carveMetroRect(
  world: World,
  mask: Uint8Array | null,
  x: number,
  y: number,
  w: number,
  h: number,
  floorTex: Tex,
): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      openMetroTile(world, mask, x + dx, y + dy, floorTex);
    }
  }
}

function carveMetroTrack(world: World, mask: Uint8Array, x: number, y: number, w: number, h: number): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (mask[ci] || world.cells[ci] === Cell.LIFT) continue;
      world.cells[ci] = Cell.WATER;
      world.floorTex[ci] = Tex.F_WATER;
      world.features[ci] = Feature.NONE;
      world.roomMap[ci] = -1;
      if ((dx + dy) % 17 === 0) world.fog[ci] = Math.max(world.fog[ci], 20);
    }
  }
}

function openMetroTile(world: World, mask: Uint8Array | null, x: number, y: number, floorTex: Tex): void {
  const ci = world.idx(x, y);
  if ((mask && mask[ci]) || world.cells[ci] === Cell.LIFT) return;
  world.cells[ci] = Cell.FLOOR;
  world.roomMap[ci] = -1;
  world.floorTex[ci] = floorTex;
}

function setDarkMetroFog(world: World, x: number, y: number, fog: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.WALL || world.cells[ci] === Cell.LIFT) return;
  world.fog[ci] = Math.max(world.fog[ci], fog);
}

function stampDarkMetroLayout(ctx: BuildCtx): DarkMetroLayout {
  const bx = Math.floor(W / 2) - 32;
  const by = Math.floor(W / 2) - 12;
  const { world } = ctx;

  const hall = styledRoom(world, RoomType.COMMON, bx, by, 30, 18, 'Вестибюль темной пересадки', Tex.DARK, Tex.F_CONCRETE);
  const platform = styledRoom(world, RoomType.CORRIDOR, bx - 4, by + 22, 42, 9, 'Платформа без расписания', Tex.METAL, Tex.F_CONCRETE);
  const underpass = styledRoom(world, RoomType.CORRIDOR, bx + 12, by + 33, 8, 25, 'Подземный переход белых ламп', Tex.CONCRETE, Tex.F_TILE);
  const kiosk = styledRoom(world, RoomType.STORAGE, bx - 16, by + 6, 10, 8, 'Киоск ламп и жетонов', Tex.PANEL, Tex.F_LINO);
  const signal = styledRoom(world, RoomType.PRODUCTION, bx + 42, by + 8, 14, 10, 'Сигнальная будка стрелки', Tex.PIPE, Tex.F_CONCRETE);
  const blindTunnel = styledRoom(world, RoomType.CORRIDOR, bx + 20, by + 61, 34, 5, 'Слепой тоннель чужой станции', Tex.DARK, Tex.F_CONCRETE);
  const exit = styledRoom(world, RoomType.PRODUCTION, bx + 58, by + 57, 12, 9, 'Служебный выход к лифтам', Tex.METAL, Tex.F_CONCRETE);

  connectWithDoors(world, hall, platform, bx + 14, by + 18, bx + 14, by + 21);
  connectWithDoors(world, platform, underpass, bx + 16, by + 31, bx + 16, by + 32);
  connectWithDoors(world, kiosk, hall, bx - 6, by + 10, bx - 1, by + 10);
  connectWithDoors(world, hall, signal, bx + 30, by + 13, bx + 41, by + 13);
  connectWithDoors(world, underpass, blindTunnel, bx + 16, by + 58, bx + 19, by + 64);
  connectWithDoors(world, blindTunnel, exit, bx + 54, by + 64, bx + 57, by + 64);

  return { hall, platform, underpass, kiosk, signal, blindTunnel, exit };
}

function styledRoom(
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
    }
  }
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      world.floorTex[world.idx(x + dx, y + dy)] = floorTex;
    }
  }
  return room;
}

function connectWithDoors(world: World, a: Room, b: Room, ax: number, ay: number, bx: number, by: number): void {
  carveLine(world, ax, ay, bx, by);
  placeDoor(world, ax, ay, a.id, -1);
  placeDoor(world, bx, by, b.id, -1);
}

function carveLine(world: World, ax: number, ay: number, bx: number, by: number): void {
  let x = ax;
  let y = ay;
  const sx = world.delta(ax, bx) >= 0 ? 1 : -1;
  const sy = world.delta(ay, by) >= 0 ? 1 : -1;
  while (x !== bx) {
    openTile(world, x, y);
    x = world.wrap(x + sx);
  }
  while (y !== by) {
    openTile(world, x, y);
    y = world.wrap(y + sy);
  }
  openTile(world, x, y);
}

function openTile(world: World, x: number, y: number, floorTex = Tex.F_CONCRETE): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT) return;
  world.cells[ci] = Cell.FLOOR;
  world.roomMap[ci] = -1;
  world.floorTex[ci] = floorTex;
}

function placeDoor(world: World, x: number, y: number, roomA: number, roomB: number): void {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.DOOR;
  world.roomMap[ci] = -1;
  world.doors.set(ci, { idx: ci, state: DoorState.CLOSED, roomA, roomB, keyId: '', timer: 0 });
  const a = world.rooms[roomA];
  if (a && !a.doors.includes(ci)) a.doors.push(ci);
  const b = roomB >= 0 ? world.rooms[roomB] : undefined;
  if (b && !b.doors.includes(ci)) b.doors.push(ci);
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.WALL || world.cells[ci] === Cell.LIFT) return;
  world.features[ci] = feature;
}

function setWater(world: World, x: number, y: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT) return;
  world.cells[ci] = Cell.WATER;
  world.floorTex[ci] = Tex.F_WATER;
}

function tuneDarkMetroZones(world: World): void {
  for (const zone of world.zones) {
    const roll = hashSeed(`${DESIGN_FLOOR_ID}.${zone.id}`) % 10;
    zone.level = roll >= 7 ? 5 : roll >= 3 ? 4 : 3;
    zone.faction = roll === 0 ? ZoneFaction.CULTIST : roll <= 4 ? ZoneFaction.LIQUIDATOR : ZoneFaction.WILD;
    zone.fogged = false;
    zone.hasLift = zone.id % 11 === 0;
  }
  for (let i = 0; i < W * W; i++) {
    const zone = world.zones[world.zoneMap[i]];
    world.factionControl[i] = zone?.faction ?? ZoneFaction.WILD;
  }
}

function dressDarkMetro(ctx: BuildCtx, layout: DarkMetroLayout): void {
  const { world } = ctx;
  const state = unpackDarkMetroState(ctx.packedState);

  for (let x = layout.platform.x + 1; x < layout.platform.x + layout.platform.w - 1; x++) {
    setWater(world, x, layout.platform.y + layout.platform.h - 2);
    if ((x - layout.platform.x) % 5 === 0) setFeature(world, x, layout.platform.y + 1, Feature.LAMP);
  }

  for (let i = 0; i < DARK_METRO_ROUTES.length; i++) {
    const route = DARK_METRO_ROUTES[i];
    const x = layout.platform.x + 4 + route.panelSlot * 9;
    setFeature(world, x, layout.platform.y + 2, Feature.SCREEN);
    setFeature(world, x, layout.platform.y + 3, Feature.APPARATUS);
    if (route.id === state.wrongRouteArmed) setFeature(world, x + 1, layout.platform.y + 4, Feature.CANDLE);
  }

  for (let y = layout.underpass.y + 2; y < layout.underpass.y + layout.underpass.h - 1; y += 4) {
    setFeature(world, layout.underpass.x + 1, y, Feature.LAMP);
  }
  for (let x = layout.blindTunnel.x + 2; x < layout.blindTunnel.x + layout.blindTunnel.w - 2; x += 7) {
    setFeature(world, x, layout.blindTunnel.y + 2, Feature.CANDLE);
    world.fog[world.idx(x, layout.blindTunnel.y + 2)] = 32;
  }

  setFeature(world, layout.hall.x + 4, layout.hall.y + 4, Feature.LAMP);
  setFeature(world, layout.hall.x + layout.hall.w - 5, layout.hall.y + 4, Feature.LAMP);
  setFeature(world, layout.hall.x + 8, layout.hall.y + layout.hall.h - 3, Feature.CHAIR);
  setFeature(world, layout.hall.x + 14, layout.hall.y + layout.hall.h - 4, Feature.TABLE);
  setFeature(world, layout.kiosk.x + 3, layout.kiosk.y + 2, Feature.SHELF);
  setFeature(world, layout.kiosk.x + 6, layout.kiosk.y + 4, Feature.TABLE);
  setFeature(world, layout.signal.x + 3, layout.signal.y + 3, Feature.MACHINE);
  setFeature(world, layout.signal.x + 7, layout.signal.y + 4, Feature.APPARATUS);
  setFeature(world, layout.signal.x + 10, layout.signal.y + 2, Feature.SCREEN);
  setFeature(world, layout.exit.x + 8, layout.exit.y + 3, Feature.LIFT_BUTTON);

  const liftUp = world.idx(layout.exit.x + 10, layout.exit.y + 2);
  world.cells[liftUp] = Cell.LIFT;
  world.wallTex[liftUp] = Tex.LIFT_DOOR;
  world.liftDir[liftUp] = LiftDirection.UP;
  const liftDown = world.idx(layout.exit.x + 10, layout.exit.y + 5);
  world.cells[liftDown] = Cell.LIFT;
  world.wallTex[liftDown] = Tex.LIFT_DOOR;
  world.liftDir[liftDown] = LiftDirection.DOWN;

  for (let i = 0; i < 9; i++) {
    const x = layout.blindTunnel.x + 4 + i * 3;
    stampSurfaceSplat(world, x, layout.blindTunnel.y + 2, 0.5, 0.5, 2.5, 0.24, hashSeed(`dark_metro_mark.${i}`), 55, 45, 70, false);
  }
}

function nextTrainEntityId(entities: Entity[]): { v: number } {
  return { v: entities.reduce((mx, e) => Math.max(mx, e.id), 0) + 1 };
}

function addPlatformCells(world: World, out: number[], x0: number, x1: number, y: number): void {
  for (let x = x0; x <= x1; x++) {
    const ci = world.idx(x, y);
    if (world.cells[ci] !== Cell.LIFT && world.cells[ci] !== Cell.WALL) out.push(ci);
  }
}

function seedCoreMetroTrain(ctx: BuildCtx, layout: DarkMetroLayout): void {
  const y = layout.platform.y + layout.platform.h - 2;
  const cells: number[] = [];
  for (let x = layout.platform.x + 2; x < layout.platform.x + layout.platform.w - 2; x++) {
    const ci = ctx.world.idx(x, y);
    if (ctx.world.cells[ci] === Cell.WATER) cells.push(ci);
  }
  const platformCells: number[] = [];
  addPlatformCells(ctx.world, platformCells, layout.platform.x + 3, layout.platform.x + layout.platform.w - 4, y - 3);
  const track: RailTrainTrack = {
    id: 'dark_metro_platform_loop',
    label: 'Петля платформы',
    cells,
    stationOffsets: [Math.floor(cells.length / 2)],
    platformCells,
    loop: true,
  };
  addRailTrainRoute(ctx.world, ctx.entities, ctx.nextId, track, {
    id: 'dark_metro_platform_train',
    label: 'Короткий состав платформы',
    speed: 3.4,
    length: 7,
    initialOffset: track.stationOffsets[0],
    stopSeconds: 3.8,
  });
}

function buildFullFloorMetroTrack(world: World, lineY: number, line: number): RailTrainTrack | null {
  const trackY = lineY + (line % 2 === 0 ? 6 : -5);
  const platformY = lineY + (line % 2 === 0 ? 12 : -11);
  const cells: number[] = [];
  for (let x = 48; x < W - 48; x++) {
    const ci = world.idx(x, trackY);
    if (world.cells[ci] === Cell.WATER) cells.push(ci);
  }
  if (cells.length < 180) return null;

  const platformCells: number[] = [];
  const stationOffsets: number[] = [];
  const stations = [
    132 + line * 11,
    398 + (line % 2) * 54,
    690 - (line % 3) * 23,
    884 - line * 7,
  ];
  for (const sx of stations) {
    const x = Math.max(72, Math.min(W - 72, sx));
    let bestOffset = 0;
    let bestD = Infinity;
    for (let i = 0; i < cells.length; i++) {
      const cx = cells[i] % W;
      const d = Math.abs(world.delta(cx, x));
      if (d < bestD) {
        bestD = d;
        bestOffset = i;
      }
    }
    stationOffsets.push(bestOffset);
    for (let dx = -13; dx <= 13; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const ci = world.idx(x + dx, platformY + dy);
        if (world.cells[ci] !== Cell.LIFT && world.cells[ci] !== Cell.WALL) platformCells.push(ci);
      }
    }
    setFeature(world, x, platformY, Feature.SCREEN);
    setFeature(world, x + 8, platformY, Feature.LAMP);
  }

  return {
    id: `dark_metro_line_${line + 1}`,
    label: `Линия ${line + 1}`,
    cells,
    stationOffsets,
    platformCells,
    loop: true,
  };
}

function seedFullFloorMetroTrains(world: World, entities: Entity[]): void {
  const nextId = nextTrainEntityId(entities);
  for (let i = 0; i < DARK_METRO_FULL_LINE_YS.length; i++) {
    const track = buildFullFloorMetroTrack(world, DARK_METRO_FULL_LINE_YS[i], i);
    if (!track) continue;
    addRailTrainRoute(world, entities, nextId, track, {
      id: `${track.id}_train`,
      label: i % 3 === 0 ? `Состав ${i + 1} без машиниста` : `Состав ${i + 1}`,
      speed: 4.8 + i * 0.45,
      length: 11 + (i % 3),
      direction: i % 2 === 0 ? 1 : -1,
      initialOffset: track.stationOffsets[0],
      stopSeconds: 3.4,
    });
  }
}

function spawnDarkMetroNpcs(ctx: BuildCtx, layout: DarkMetroLayout): void {
  spawnPlotNpc(ctx, 'dark_metro_dispatcher_nora', NORA_DEF, layout.signal.x + 5, layout.signal.y + 5, Math.PI);
  spawnPlotNpc(ctx, 'dark_metro_lamp_vendor', VENDOR_DEF, layout.kiosk.x + 4, layout.kiosk.y + 5, 0);
  spawnPlotNpc(ctx, 'dark_metro_stranded_liquidator', STRANDED_DEF, layout.blindTunnel.x + 7, layout.blindTunnel.y + 2, 0);
  spawnPlotNpc(ctx, 'dark_metro_child_omen_misha', MISHA_DEF, layout.hall.x + 23, layout.hall.y + 13, Math.PI * 0.5, {
    canGiveQuest: false,
    spriteScale: 0.65,
  });
}

function spawnPlotNpc(
  ctx: BuildCtx,
  npcId: string,
  _def: PlotNpcDef,
  x: number,
  y: number,
  angle: number,
  extra?: Partial<Entity>,
): void {
  const px = x + 0.5;
  const py = y + 0.5;
  requireSpawnedPlotNpcFromPackage(ctx.entities, ctx.nextId, npcId, px, py, {
    angle,
    aiTarget: { x: px, y: py },
    extra,
  });
}

function spawnDarkMetroLoot(ctx: BuildCtx, layout: DarkMetroLayout): void {
  dropItem(ctx, layout.platform.x + 5, layout.platform.y + 5, 'metro_ticket', 1);
  dropItem(ctx, layout.platform.x + 13, layout.platform.y + 4, 'note', 1, DARK_METRO_ROUTES[2].clue);
  dropItem(ctx, layout.underpass.x + 2, layout.underpass.y + 6, 'note', 1, DARK_METRO_AMBUSH_CUES[0].warning);
  dropItem(ctx, layout.underpass.x + 5, layout.underpass.y + 10, 'lamp_bulb', 1);
  dropItem(ctx, layout.blindTunnel.x + 19, layout.blindTunnel.y + 2, 'bandage', 1);
  dropItem(ctx, layout.exit.x + 4, layout.exit.y + 4, 'fuse', 1);

  addContainer(ctx, layout.kiosk, layout.kiosk.x + 2, layout.kiosk.y + 2, ContainerKind.CASHBOX, 'Касса ламповщика', [
    { defId: 'metro_ticket', count: 4 },
    { defId: 'lamp_bulb', count: 3 },
    { defId: 'cigs', count: 2 },
  ], 'owner', Faction.CITIZEN, VENDOR_DEF.name, ['dark_metro', 'tickets', 'light']);

  addContainer(ctx, layout.signal, layout.signal.x + 11, layout.signal.y + 5, ContainerKind.TOOL_LOCKER, 'Шкаф сигнальной будки', [
    { defId: 'fuse', count: 2 },
    { defId: 'relay_diagram', count: 1 },
    { defId: 'circuit_board', count: 1 },
    { defId: 'inspection_mirror', count: 1 },
  ], 'locked', Faction.CITIZEN, NORA_DEF.name, ['dark_metro', 'signal', 'repair']);

  addContainer(ctx, layout.hall, layout.hall.x + 3, layout.hall.y + layout.hall.h - 3, ContainerKind.EMERGENCY_BOX, 'Аварийный ящик белой петли', [
    { defId: 'water', count: 1 },
    { defId: 'bandage', count: 1 },
    { defId: 'flashlight', count: 1 },
  ], 'public', undefined, undefined, ['dark_metro', 'fallback', 'light']);
}

function addContainer(
  ctx: BuildCtx,
  room: Room,
  x: number,
  y: number,
  kind: ContainerKind,
  name: string,
  inventory: WorldContainer['inventory'],
  access: WorldContainer['access'],
  faction: Faction | undefined,
  ownerName: string | undefined,
  tags: string[],
): void {
  const ci = ctx.world.idx(x, y);
  ctx.world.addContainer({
    id: ctx.nextContainerId.v++,
    x,
    y,
    floor: DARK_METRO_BASE_FLOOR,
    roomId: room.id,
    zoneId: ctx.world.zoneMap[ci],
    kind,
    name,
    inventory,
    capacitySlots: 8,
    ownerName,
    faction,
    access,
    lockDifficulty: access === 'locked' ? 3 : undefined,
    discovered: true,
    tags,
  });
  setFeature(ctx.world, x, y, Feature.SHELF);
}

function dropItem(ctx: BuildCtx, x: number, y: number, defId: string, count = 1, noteText?: string): void {
  ctx.entities.push({
    id: ctx.nextId.v++,
    type: EntityType.ITEM_DROP,
    x: x + 0.5,
    y: y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{
      defId,
      count,
      data: noteText,
    }],
  });
}

function spawnDarkMetroThreats(ctx: BuildCtx, layout: DarkMetroLayout): void {
  spawnMonster(ctx, MonsterKind.SHADOW, layout.blindTunnel.x + 26, layout.blindTunnel.y + 2, layout.hall);
  spawnMonster(ctx, MonsterKind.LAMPOVY, layout.platform.x + 31, layout.platform.y + 5, layout.hall);
  spawnMonster(ctx, MonsterKind.REBAR, layout.underpass.x + 4, layout.underpass.y + 16, layout.hall);
  spawnMonster(ctx, MonsterKind.TUBE_EEL, layout.platform.x + 20, layout.platform.y + 7, layout.hall);
}

function spawnMonster(ctx: BuildCtx, kind: MonsterKind, x: number, y: number, anchor: Room): void {
  const def = MONSTERS[kind];
  if (!def) return;
  const ci = ctx.world.idx(x, y);
  const zone = ctx.world.zones[ctx.world.zoneMap[ci]];
  const zoneLevel = zone?.level ?? 4;
  const hp = scaleMonsterHp(def.hp, zoneLevel);
  const monster: Entity = {
    id: ctx.nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.atan2(anchor.y + anchor.h / 2 - y, anchor.x + anchor.w / 2 - x),
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: def.sprite,
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: anchor.x + Math.floor(anchor.w / 2), ty: anchor.y + Math.floor(anchor.h / 2), path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
  };
  ctx.entities.push(monster);
}

function registerDarkMetroRouteCues(ctx: BuildCtx, layout: DarkMetroLayout): void {
  const ambushMarkerX = layout.underpass.x + 1.5;
  const ambushMarkerY = layout.underpass.y + layout.underpass.h - 5 + 0.5;
  const ambushTargetX = layout.blindTunnel.x + 26.5;
  const ambushTargetY = layout.blindTunnel.y + 2.5;
  const ambushCell = ctx.world.idx(Math.floor(ambushMarkerX), Math.floor(ambushMarkerY));
  registerRouteCue(ctx.world, {
    id: 'dark_metro_white_lamp_ambush',
    x: ambushMarkerX,
    y: ambushMarkerY,
    targetX: ambushTargetX,
    targetY: ambushTargetY,
    floor: DARK_METRO_BASE_FLOOR,
    roomId: layout.underpass.id,
    targetRoomId: layout.blindTunnel.id,
    zoneId: ctx.world.zoneMap[ambushCell],
    label: 'обрыв белого света',
    hint: 'лампы кончаются перед слепым тоннелем',
    targetName: 'засада слепого тоннеля',
    color: '#bbf',
    tags: ['dark_metro', 'ambush', 'warning', 'shadow'],
    toneSeed: layout.underpass.id * 1709 + layout.blindTunnel.id,
    radius: 8,
    targetRadius: 4,
    cooldownSec: 30,
    heardText: 'Белые лампы сбиваются: впереди слепой тоннель, в углу слышно чужое дыхание.',
    followedText: 'Засада прочитана до выстрела. Можно идти медленно, светить или вернуться петлей.',
    ignoredText: 'Белые лампы остались позади. Слепой тоннель встретит без предупреждения.',
  });

  const shortcutMarkerX = layout.platform.x + 4 + DARK_METRO_ROUTES[1].panelSlot * 9 + 0.5;
  const shortcutMarkerY = layout.platform.y + 2.5;
  const shortcutTargetX = layout.exit.x + 8.5;
  const shortcutTargetY = layout.exit.y + 3.5;
  const shortcutCell = ctx.world.idx(Math.floor(shortcutMarkerX), Math.floor(shortcutMarkerY));
  registerRouteCue(ctx.world, {
    id: 'dark_metro_service_floor_shortcut',
    x: shortcutMarkerX,
    y: shortcutMarkerY,
    targetX: shortcutTargetX,
    targetY: shortcutTargetY,
    floor: DARK_METRO_BASE_FLOOR,
    roomId: layout.platform.id,
    targetRoomId: layout.exit.id,
    zoneId: ctx.world.zoneMap[shortcutCell],
    label: 'стрелочный коридор',
    hint: 'предохранитель держит короткий путь к С-15',
    targetName: DARK_METRO_ROUTES[1].label,
    color: '#79f',
    tags: ['dark_metro', 'service_floor', 'shortcut', 'transfer'],
    toneSeed: layout.platform.id * 1721 + layout.exit.id,
    radius: 8,
    targetRadius: 3,
    cooldownSec: 36,
    heardText: 'Табло щелкает служебным маршрутом: предохранитель покупает короткий ход к С-15.',
    followedText: 'Служебный выход найден. Можно потратить предохранитель на путь или сохранить его для ремонта.',
    ignoredText: 'Стрелочный коридор погас. Служебный короткий путь остался на табло.',
  });
}

export function reinforceDarkMetroAuthoredHqTerritory(world: World): void {
  for (const compound of DARK_METRO_HQ_COMPOUNDS) {
    const names = new Set([compound.core.name, ...compound.support.map(room => room.name)]);
    for (const room of world.rooms) {
      if (!room || !names.has(room.name)) continue;
      paintDarkMetroRoomOwner(world, room, compound.owner);
      decorateDarkMetroOwnedRoom(world, room, compound.owner, room.id);
      if (room.name === compound.core.name || room.type === RoomType.HQ) {
        hardenDarkMetroHqRoom(world, room, compound.owner);
      }
    }
  }
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFeaturesDirty(false);
  syncZoneMetadataFromTerritory(world);
}

function isDarkMetroAmbientNpc(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    !entity.plotNpcId &&
    !entity.persistentNpcId &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    entity.faction !== undefined;
}

function darkMetroTerritorySpawnCells(world: World): Map<TerritoryOwner, number[]> {
  const cells = new Map<TerritoryOwner, number[]>();
  for (const owner of HUMAN_TERRITORY_OWNERS) cells.set(owner, []);
  for (let i = 0; i < W * W; i++) {
    const cell = world.cells[i];
    if (cell !== Cell.FLOOR && cell !== Cell.DOOR) continue;
    const owner = territoryOwnerAtIndex(world, i);
    const list = cells.get(owner);
    if (!list) continue;
    const roomId = world.roomMap[i];
    if (roomId >= 0) {
      const room = world.rooms[roomId];
      if (room?.type === RoomType.HQ || room?.type === RoomType.COMMON || room?.type === RoomType.STORAGE || room?.type === RoomType.PRODUCTION) {
        list.push(i);
        list.push(i);
        continue;
      }
    }
    list.push(i);
  }
  return cells;
}

export function alignDarkMetroAmbientNpcTerritory(world: World, entities: Entity[]): void {
  const cells = darkMetroTerritorySpawnCells(world);
  const offsets = new Uint16Array(8);
  for (const entity of entities) {
    if (!isDarkMetroAmbientNpc(entity) || entity.faction === undefined) continue;
    const owner = factionToTerritoryOwner(entity.faction);
    const list = cells.get(owner);
    if (!list || list.length === 0) continue;
    const offset = offsets[owner]++ | 0;
    const cell = list[(entity.id * 193 + offset * 421) % list.length];
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

function applyDarkMetroAmbientLight(world: World, layout: DarkMetroLayout, packedState: DarkMetroPackedState): void {
  const state = unpackDarkMetroState(packedState);
  const platformMin = state.platformLight === 'on' ? 0.38 : state.platformLight === 'weak' ? 0.18 : 0.1;
  raiseRoomLight(world, layout.hall, 0.34);
  raiseRoomLight(world, layout.platform, platformMin);
  raiseRoomLight(world, layout.underpass, 0.2);
  raiseRoomLight(world, layout.kiosk, 0.3);
  raiseRoomLight(world, layout.signal, 0.28);
  raiseRoomLight(world, layout.blindTunnel, 0.08);
  raiseRoomLight(world, layout.exit, 0.22);
}

function raiseRoomLight(world: World, room: Room, minLight: number): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.cells[ci] === Cell.WALL) continue;
      world.light[ci] = Math.max(world.light[ci], minLight);
    }
  }
}
