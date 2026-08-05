/* ── Design floor: Darkness — post-Void light-resource pocket ─── */

import {
  W, Cell, Tex, Feature, RoomType, DoorState, LiftDirection,
  FloorLevel, ZoneFaction, EntityType, AIGoal,
  MonsterKind, ContainerKind,
  type Entity, type Room, type Item, type WorldContainer,
  type GameState, type WorldEvent, type TerritoryOwner,
} from '../../core/types';
import { World } from '../../core/world';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { publishEvent } from '../../systems/events';
import { registerRouteCue } from '../../systems/route_cues';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  carveCorridor,
  ensureConnectivity,
  generateZones,
  placeDoorAt,
  sanitizeDoors,
  stampRoom,
} from '../shared';
import type { FloorGeneration } from '../floor_manifest';

export const DARKNESS_DESIGN_FLOOR_ID = 'darkness' as const;
export const DARKNESS_FUTURE_Z = -48;
export const DARKNESS_PRESERVED_NAME_ID = 'tamara_belova' as const;

export const DARKNESS_DEBUG_ENTRY = {
  routeId: DARKNESS_DESIGN_FLOOR_ID,
  z: DARKNESS_FUTURE_Z,
  generator: 'generateDarknessDesignFloor',
} as const;

type DarknessTollState = 'unpaid' | 'paid_light' | 'fought' | 'bypassed';
export type DarknessLateWarningId =
  | 'darkness_light_debt_warning'
  | 'darkness_return_trace_warning';
type DarknessQuestChoice =
  | 'spend_light'
  | 'save_light'
  | 'preserve_name'
  | 'leave_name'
  | 'pay_toll'
  | 'fight_shadows'
  | 'long_route'
  | 'carry_trace';
type DarknessTopologyDecision =
  | DarknessQuestChoice
  | 'listen'
  | 'follow_protocol'
  | 'flee'
  | 'abandon_loot';

export interface DarknessRoomLabel {
  roomId: number;
  key: string;
  hiddenName: string;
  revealedName: string;
  lightCost: number;
  revealedAtStart: boolean;
}

export interface DarknessQuestDef {
  id: string;
  sourceKey: string;
  title: string;
  objective: string;
  choices: DarknessQuestChoice[];
  rewardHint: string;
}

export interface DarknessLateWarning {
  id: DarknessLateWarningId;
  label: string;
  sourceKey: string;
  targetKey: string;
  warning: string;
  tags: readonly string[];
}

export interface DarknessLightGraphNode {
  id: string;
  roomKey: string;
  roomId: number;
  x: number;
  y: number;
  lightCost: number;
  revealRadius: number;
  budgetAfterReveal: number;
  tags: string[];
}

export interface DarknessLightGraphEdge {
  id: string;
  fromKey: string;
  toKey: string;
  fromRoomId: number;
  toRoomId: number;
  lightCost: number;
  decisions: DarknessTopologyDecision[];
  tags: string[];
}

export interface DarknessRevealShell {
  id: string;
  roomKey: string;
  roomId: number;
  originX: number;
  originY: number;
  radius: number;
  cellCount: number;
  minFog: number;
  maxFog: number;
  lightCost: number;
  tags: string[];
}

export interface DarknessSoundPath {
  id: string;
  fromKey: string;
  toKey: string;
  fromRoomId: number;
  toRoomId: number;
  cellCount: number;
  averageFog: number;
  cueId: string;
  decisions: DarknessTopologyDecision[];
  tags: string[];
}

export interface DarknessRadonSightCorridor {
  id: string;
  fromKey: string;
  toKey: string;
  fromRoomId: number;
  toRoomId: number;
  angleDeg: number;
  cellCount: number;
  coverBreaks: number;
  minFog: number;
  maxFog: number;
  decisions: DarknessTopologyDecision[];
  tags: string[];
}

export interface DarknessTopologyPlan {
  lightGraphNodes: DarknessLightGraphNode[];
  lightGraphEdges: DarknessLightGraphEdge[];
  revealShells: DarknessRevealShell[];
  soundPaths: DarknessSoundPath[];
  radonSightCorridors: DarknessRadonSightCorridor[];
}

export interface DarknessFloorState {
  routeId: typeof DARKNESS_DESIGN_FLOOR_ID;
  z: typeof DARKNESS_FUTURE_Z;
  lightBudget: number;
  revealedRoomIds: number[];
  preservedNameId: typeof DARKNESS_PRESERVED_NAME_ID | null;
  shadowTollState: DarknessTollState;
  roomLabels: DarknessRoomLabel[];
  quests: DarknessQuestDef[];
  lateWarnings: DarknessLateWarning[];
  shortcutCueIds: string[];
  lightGraphNodes: DarknessLightGraphNode[];
  lightGraphEdges: DarknessLightGraphEdge[];
  revealShells: DarknessRevealShell[];
  soundPaths: DarknessSoundPath[];
  radonSightCorridors: DarknessRadonSightCorridor[];
  returnTracePublished: boolean;
}

export interface DarknessDesignGeneration extends FloorGeneration {
  darknessState: DarknessFloorState;
}

export interface DarknessReturnTraceOptions {
  preservedNameId?: typeof DARKNESS_PRESERVED_NAME_ID;
  sourceRoomId?: number;
  sourceZoneId?: number;
  x?: number;
  y?: number;
}

interface DarknessRoomSpec {
  key: string;
  type: RoomType;
  x: number;
  y: number;
  w: number;
  h: number;
  hiddenName: string;
  revealedName: string;
  lightCost: number;
  revealedAtStart?: boolean;
  lamps?: readonly [number, number, Feature][];
  fog?: number;
}

interface DarknessSupportRoomSpec {
  type: RoomType;
  name: string;
  dx: number;
  dy: number;
  w: number;
  h: number;
  feature: Feature;
}

interface DarknessHqCompoundSpec {
  owner: TerritoryOwner;
  cx: number;
  cy: number;
  hqName: string;
  support: readonly DarknessSupportRoomSpec[];
}

interface DarknessStationSpec {
  cx: number;
  cy: number;
  name: string;
  fog: number;
  owner?: TerritoryOwner;
}

const ROOM_ORIGIN_X = (W >> 1) - 36;
const ROOM_ORIGIN_Y = (W >> 1) - 10;
const DARKNESS_LIGHT_BUDGET = 8;

const DARKNESS_HQ_COMPOUNDS: readonly DarknessHqCompoundSpec[] = [
  {
    owner: ZoneFaction.CITIZEN,
    cx: 176,
    cy: 438,
    hqName: 'Гражданский штаб последней лампы',
    support: [
      { type: RoomType.KITCHEN, name: 'Кухня гражданского светового пайка', dx: -54, dy: -6, w: 22, h: 10, feature: Feature.STOVE },
      { type: RoomType.BATHROOM, name: 'Санузел гражданского убежища', dx: -10, dy: 22, w: 18, h: 9, feature: Feature.TOILET },
      { type: RoomType.STORAGE, name: 'Склад лампового стекла граждан', dx: 30, dy: -6, w: 20, h: 10, feature: Feature.SHELF },
      { type: RoomType.MEDICAL, name: 'Медпункт темного привала', dx: -10, dy: -28, w: 22, h: 10, feature: Feature.DESK },
      { type: RoomType.COMMON, name: 'Общая комната тихого счета', dx: -54, dy: 18, w: 24, h: 10, feature: Feature.TABLE },
    ],
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    cx: 822,
    cy: 226,
    hqName: 'Пост ликвидаторов черного сектора',
    support: [
      { type: RoomType.STORAGE, name: 'Оружейный шкаф черного сектора', dx: -54, dy: -6, w: 22, h: 10, feature: Feature.SHELF },
      { type: RoomType.BATHROOM, name: 'Санпропускник черного сектора', dx: -8, dy: 22, w: 18, h: 9, feature: Feature.SINK },
      { type: RoomType.OFFICE, name: 'Журнал темной зачистки', dx: 30, dy: -6, w: 22, h: 10, feature: Feature.DESK },
      { type: RoomType.MEDICAL, name: 'Медкомната после вспышки', dx: -10, dy: -28, w: 22, h: 10, feature: Feature.TABLE },
      { type: RoomType.COMMON, name: 'Комната смены без света', dx: 30, dy: 18, w: 24, h: 10, feature: Feature.CHAIR },
    ],
  },
  {
    owner: ZoneFaction.SCIENTIST,
    cx: 246,
    cy: 214,
    hqName: 'НИИ остаточного фотона',
    support: [
      { type: RoomType.OFFICE, name: 'Кабинет протокола фотона', dx: -54, dy: -6, w: 24, h: 10, feature: Feature.DESK },
      { type: RoomType.PRODUCTION, name: 'Мастерская темного спектра', dx: 30, dy: -6, w: 24, h: 10, feature: Feature.APPARATUS },
      { type: RoomType.MEDICAL, name: 'Измерительная медкомната фотона', dx: -10, dy: -28, w: 22, h: 10, feature: Feature.SCREEN },
      { type: RoomType.STORAGE, name: 'Архив погасших колб', dx: -10, dy: 22, w: 20, h: 9, feature: Feature.SHELF },
      { type: RoomType.KITCHEN, name: 'Чайник лабораторной темноты', dx: -54, dy: 18, w: 22, h: 10, feature: Feature.STOVE },
    ],
  },
  {
    owner: ZoneFaction.WILD,
    cx: 806,
    cy: 806,
    hqName: 'Дикий штаб слепого привала',
    support: [
      { type: RoomType.STORAGE, name: 'Разобранная кладовая слепого привала', dx: -54, dy: -6, w: 24, h: 10, feature: Feature.SHELF },
      { type: RoomType.SMOKING, name: 'Курилка людей без фонаря', dx: 30, dy: -6, w: 22, h: 10, feature: Feature.TABLE },
      { type: RoomType.KITCHEN, name: 'Кухня копченого пайка', dx: -10, dy: 22, w: 22, h: 9, feature: Feature.STOVE },
      { type: RoomType.BATHROOM, name: 'Разбитый умывальник диких', dx: -10, dy: -28, w: 18, h: 10, feature: Feature.SINK },
      { type: RoomType.COMMON, name: 'Общий угол самозахвата тьмы', dx: 30, dy: 18, w: 24, h: 10, feature: Feature.CHAIR },
    ],
  },
  {
    owner: ZoneFaction.CULTIST,
    cx: 240,
    cy: 806,
    hqName: 'Скрытый культовый штаб черного имени',
    support: [
      { type: RoomType.COMMON, name: 'Тихая комната черного имени', dx: -54, dy: -6, w: 24, h: 10, feature: Feature.TABLE },
      { type: RoomType.STORAGE, name: 'Кладовая свечей без огня', dx: 30, dy: -6, w: 22, h: 10, feature: Feature.SHELF },
      { type: RoomType.KITCHEN, name: 'Кухня ритуального кипятка во тьме', dx: -10, dy: 22, w: 24, h: 9, feature: Feature.STOVE },
      { type: RoomType.OFFICE, name: 'Писарская комната возвращаемого имени', dx: -10, dy: -28, w: 22, h: 10, feature: Feature.DESK },
      { type: RoomType.BATHROOM, name: 'Умывальник свечного следа', dx: -54, dy: 18, w: 20, h: 10, feature: Feature.SINK },
    ],
  },
];

const DARKNESS_STATIONS: readonly DarknessStationSpec[] = [
  { cx: 502, cy: 146, name: 'Верхняя линза потухших ламп', fog: 70, owner: ZoneFaction.SCIENTIST },
  { cx: 696, cy: 130, name: 'Пультовая слепого контура', fog: 76, owner: ZoneFaction.LIQUIDATOR },
  { cx: 890, cy: 404, name: 'Правая станция черной тяги', fog: 84, owner: ZoneFaction.WILD },
  { cx: 874, cy: 624, name: 'Биржа чужого дыхания', fog: 88, owner: ZoneFaction.WILD },
  { cx: 520, cy: 888, name: 'Нижний архив возвращенного следа', fog: 82, owner: ZoneFaction.CULTIST },
  { cx: 128, cy: 664, name: 'Левый двор низкого света', fog: 80, owner: ZoneFaction.CULTIST },
  { cx: 124, cy: 282, name: 'Северный шкаф аварийного быта', fog: 72, owner: ZoneFaction.CITIZEN },
  { cx: 512, cy: 704, name: 'Центральный карман пустого коридора', fog: 92, owner: ZoneFaction.SAMOSBOR },
  { cx: 344, cy: 904, name: 'Склад темного обхода', fog: 86, owner: ZoneFaction.WILD },
  { cx: 928, cy: 870, name: 'Угловой пост нижнего выдоха', fog: 90, owner: ZoneFaction.LIQUIDATOR },
];

const ROOM_SPECS: readonly DarknessRoomSpec[] = [
  {
    key: 'entry',
    type: RoomType.COMMON,
    x: ROOM_ORIGIN_X,
    y: ROOM_ORIGIN_Y + 8,
    w: 12,
    h: 9,
    hiddenName: 'Входной пост',
    revealedName: 'Входной пост с аварийной лампой',
    lightCost: 0,
    revealedAtStart: true,
    lamps: [[2, 2, Feature.LAMP], [9, 6, Feature.CANDLE]],
    fog: 12,
  },
  {
    key: 'junction',
    type: RoomType.CORRIDOR,
    x: ROOM_ORIGIN_X + 16,
    y: ROOM_ORIGIN_Y + 10,
    w: 22,
    h: 5,
    hiddenName: 'Темный коридор',
    revealedName: 'Коридор остаточного света',
    lightCost: 1,
    revealedAtStart: true,
    lamps: [[2, 2, Feature.CANDLE], [18, 2, Feature.CANDLE]],
    fog: 24,
  },
  {
    key: 'lamp',
    type: RoomType.STORAGE,
    x: ROOM_ORIGIN_X + 43,
    y: ROOM_ORIGIN_Y + 2,
    w: 13,
    h: 10,
    hiddenName: 'Комната с теплым пятном',
    revealedName: 'Пост Ники-лампоносца',
    lightCost: 2,
    lamps: [[2, 2, Feature.LAMP], [10, 7, Feature.CANDLE]],
    fog: 18,
  },
  {
    key: 'generator',
    type: RoomType.PRODUCTION,
    x: ROOM_ORIGIN_X + 43,
    y: ROOM_ORIGIN_Y - 18,
    w: 17,
    h: 10,
    hiddenName: 'Комната с гулом',
    revealedName: 'Генераторная остаточного света',
    lightCost: 2,
    lamps: [[3, 2, Feature.LAMP], [13, 7, Feature.CANDLE]],
    fog: 20,
  },
  {
    key: 'name',
    type: RoomType.OFFICE,
    x: ROOM_ORIGIN_X + 66,
    y: ROOM_ORIGIN_Y - 4,
    w: 15,
    h: 11,
    hiddenName: 'Комната без названия',
    revealedName: 'Регистратура Тамары Беловой',
    lightCost: 3,
    lamps: [[3, 2, Feature.CANDLE]],
    fog: 42,
  },
  {
    key: 'control',
    type: RoomType.OFFICE,
    x: ROOM_ORIGIN_X + 84,
    y: ROOM_ORIGIN_Y - 19,
    w: 16,
    h: 9,
    hiddenName: 'Щит без подписей',
    revealedName: 'Пульт аварийного света',
    lightCost: 2,
    lamps: [[12, 4, Feature.CANDLE]],
    fog: 28,
  },
  {
    key: 'toll',
    type: RoomType.COMMON,
    x: ROOM_ORIGIN_X + 66,
    y: ROOM_ORIGIN_Y + 17,
    w: 15,
    h: 11,
    hiddenName: 'Темный сбор',
    revealedName: 'Пункт теневой пошлины',
    lightCost: 2,
    lamps: [[2, 8, Feature.CANDLE]],
    fog: 48,
  },
  {
    key: 'toll_gate',
    type: RoomType.CORRIDOR,
    x: ROOM_ORIGIN_X + 85,
    y: ROOM_ORIGIN_Y + 24,
    w: 11,
    h: 8,
    hiddenName: 'Узкое темное место',
    revealedName: 'Шлюз теневой пошлины',
    lightCost: 2,
    lamps: [[5, 3, Feature.CANDLE]],
    fog: 58,
  },
  {
    key: 'bypass',
    type: RoomType.CORRIDOR,
    x: ROOM_ORIGIN_X + 39,
    y: ROOM_ORIGIN_Y + 34,
    w: 35,
    h: 4,
    hiddenName: 'Длинная темнота',
    revealedName: 'Обход без ламп',
    lightCost: 1,
    fog: 38,
  },
  {
    key: 'emergency',
    type: RoomType.STORAGE,
    x: ROOM_ORIGIN_X + 82,
    y: ROOM_ORIGIN_Y + 38,
    w: 15,
    h: 8,
    hiddenName: 'Низкий свет',
    revealedName: 'Аварийный световой карман',
    lightCost: 1,
    lamps: [[2, 5, Feature.CANDLE], [12, 2, Feature.CANDLE]],
    fog: 24,
  },
  {
    key: 'trace',
    type: RoomType.OFFICE,
    x: ROOM_ORIGIN_X + 92,
    y: ROOM_ORIGIN_Y + 8,
    w: 13,
    h: 9,
    hiddenName: 'Пустое место',
    revealedName: 'Комната возвратного следа',
    lightCost: 2,
    lamps: [[6, 4, Feature.LAMP]],
    fog: 56,
  },
];

const LIGHT_GRAPH_EDGE_SPECS: readonly {
  fromKey: string;
  toKey: string;
  lightCost: number;
  decisions: readonly DarknessTopologyDecision[];
  tags: readonly string[];
}[] = [
  { fromKey: 'entry', toKey: 'junction', lightCost: 0, decisions: ['listen'], tags: ['entry', 'revealed'] },
  { fromKey: 'junction', toKey: 'lamp', lightCost: 1, decisions: ['spend_light', 'save_light'], tags: ['light_budget', 'warm_pocket'] },
  { fromKey: 'lamp', toKey: 'generator', lightCost: 2, decisions: ['spend_light', 'listen'], tags: ['generator_hum', 'light_pocket'] },
  { fromKey: 'generator', toKey: 'name', lightCost: 3, decisions: ['preserve_name', 'follow_protocol'], tags: ['preserved_name', 'protocol_dark'] },
  { fromKey: 'name', toKey: 'control', lightCost: 2, decisions: ['follow_protocol'], tags: ['protocol_dark', 'route_hint'] },
  { fromKey: 'control', toKey: 'trace', lightCost: 2, decisions: ['listen', 'carry_trace'], tags: ['return_trace', 'late_warning'] },
  { fromKey: 'junction', toKey: 'toll', lightCost: 2, decisions: ['pay_toll', 'fight_shadows'], tags: ['shadow_toll', 'shortcut'] },
  { fromKey: 'toll', toKey: 'toll_gate', lightCost: 3, decisions: ['pay_toll', 'flee'], tags: ['shadow_toll', 'chokepoint'] },
  { fromKey: 'toll_gate', toKey: 'trace', lightCost: 2, decisions: ['flee', 'carry_trace'], tags: ['shortcut', 'return_trace'] },
  { fromKey: 'lamp', toKey: 'bypass', lightCost: 1, decisions: ['save_light', 'long_route'], tags: ['long_route', 'abandon_loot'] },
  { fromKey: 'bypass', toKey: 'emergency', lightCost: 1, decisions: ['listen', 'flee'], tags: ['fallback_route', 'sound_path'] },
  { fromKey: 'emergency', toKey: 'trace', lightCost: 1, decisions: ['listen', 'carry_trace'], tags: ['exit', 'sound_path'] },
];

const SOUND_PATH_SPECS: readonly {
  id: string;
  fromKey: string;
  toKey: string;
  cueId: string;
  decisions: readonly DarknessTopologyDecision[];
  tags: readonly string[];
}[] = [
  {
    id: 'darkness_sound_generator_hum',
    fromKey: 'junction',
    toKey: 'generator',
    cueId: 'darkness_generator_hum',
    decisions: ['listen', 'spend_light'],
    tags: ['sound_path', 'generator_hum', 'light_budget'],
  },
  {
    id: 'darkness_sound_toll_breath',
    fromKey: 'toll',
    toKey: 'toll_gate',
    cueId: 'darkness_shadow_toll_shortcut',
    decisions: ['listen', 'pay_toll', 'fight_shadows'],
    tags: ['sound_path', 'shadow_toll', 'chokepoint'],
  },
  {
    id: 'darkness_sound_exit_breath',
    fromKey: 'emergency',
    toKey: 'trace',
    cueId: 'darkness_exit_breath',
    decisions: ['listen', 'flee', 'carry_trace'],
    tags: ['sound_path', 'exit', 'route_protocol'],
  },
];

const RADON_SIGHT_SPECS: readonly {
  id: string;
  fromKey: string;
  toKey: string;
  fog: number;
  decisions: readonly DarknessTopologyDecision[];
  tags: readonly string[];
}[] = [
  {
    id: 'darkness_radon_name_trace',
    fromKey: 'name',
    toKey: 'trace',
    fog: 46,
    decisions: ['follow_protocol', 'carry_trace', 'abandon_loot'],
    tags: ['radon', 'sight_corridor', 'protocol_dark', 'return_trace'],
  },
  {
    id: 'darkness_radon_generator_toll',
    fromKey: 'generator',
    toKey: 'toll_gate',
    fog: 62,
    decisions: ['listen', 'fight_shadows', 'flee'],
    tags: ['radon', 'sight_corridor', 'shadow_toll', 'sound_path'],
  },
];

const QUESTS: readonly DarknessQuestDef[] = [
  {
    id: 'darkness_keep_lamp_alive',
    sourceKey: 'lamp',
    title: 'Держать лампу живой',
    objective: 'Донести лампу от входного поста до возвратного следа, не тратя заряд на каждую дверь.',
    choices: ['spend_light', 'save_light'],
    rewardHint: 'светлая короткая дорога или запас фонаря на обратный путь',
  },
  {
    id: 'darkness_find_name',
    sourceKey: 'name',
    title: 'Вернуть имя',
    objective: 'Осветить безымянную регистратуру и сохранить одну карточку имени.',
    choices: ['preserve_name', 'leave_name'],
    rewardHint: 'имя Тамары Беловой становится переносимым фактом',
  },
  {
    id: 'darkness_shadow_toll',
    sourceKey: 'toll',
    title: 'Пошлина за короткий ход',
    objective: 'Отдать лампу, драться у короткого хода или идти длинным темным обходом.',
    choices: ['pay_toll', 'fight_shadows', 'long_route'],
    rewardHint: 'короткий путь, добыча с поста или сохраненный свет',
  },
  {
    id: 'darkness_return_with_trace',
    sourceKey: 'trace',
    title: 'Вынести след',
    objective: 'Забрать засвеченный кадр и вынести его будущим адресатам: Жилой зоне, Министерству или Якову.',
    choices: ['carry_trace'],
    rewardHint: 'структурированное событие darkness_return_trace для поздних хуков',
  },
];

export const DARKNESS_LATE_WARNINGS: readonly DarknessLateWarning[] = [
  {
    id: 'darkness_light_debt_warning',
    label: 'Световой долг у пошлины',
    sourceKey: 'toll',
    targetKey: 'toll_gate',
    warning: 'Короткий путь через сборщика экономит время, но съедает свет, который нужен для подписи и возврата.',
    tags: ['darkness', 'light_budget', 'shadow_toll', 'warning'],
  },
  {
    id: 'darkness_return_trace_warning',
    label: 'Возвратный след выйдет наружу',
    sourceKey: 'control',
    targetKey: 'trace',
    warning: 'След возврата можно вынести, но он станет фактом для Жилой зоны, Министерства или Якова.',
    tags: ['darkness', 'return_trace', 'late_warning', 'warning'],
  },
];

const darknessStateByWorld = new WeakMap<World, DarknessFloorState>();

interface DarknessBfsScratch {
  visited: Uint8Array;
  queue: Int32Array;
  depth: Uint16Array;
  parent: Int32Array;
  touched: number[];
}

interface DarknessRadonBuildResult {
  corridor: DarknessRadonSightCorridor;
  fogDirty: boolean;
}

export function blackoutDarknessLights(world: World): void {
  let removed = false;
  for (let i = 0; i < W * W; i++) {
    const feature = world.features[i];
    if (feature === Feature.LAMP || feature === Feature.CANDLE) {
      world.features[i] = Feature.NONE;
      removed = true;
    }
  }
  world.light.fill(0);
  if (removed) world.markFeaturesDirty(false);
}

function centerX(room: Room): number {
  return worldWrap(room.x + (room.w >> 1));
}

function centerY(room: Room): number {
  return worldWrap(room.y + (room.h >> 1));
}

function worldWrap(v: number): number {
  return ((v % W) + W) % W;
}

function darknessRoomSpecByKey(key: string): DarknessRoomSpec {
  const spec = ROOM_SPECS.find(item => item.key === key);
  if (!spec) throw new Error(`Unknown darkness room key: ${key}`);
  return spec;
}

function makeDarknessBfsScratch(): DarknessBfsScratch {
  const n = W * W;
  const parent = new Int32Array(n);
  parent.fill(-1);
  return {
    visited: new Uint8Array(n),
    queue: new Int32Array(n),
    depth: new Uint16Array(n),
    parent,
    touched: [],
  };
}

function resetDarknessBfsScratch(scratch: DarknessBfsScratch): void {
  for (const ci of scratch.touched) {
    scratch.visited[ci] = 0;
    scratch.parent[ci] = -1;
  }
  scratch.touched.length = 0;
}

function darknessGraphWalkable(world: World, ci: number): boolean {
  const cell = world.cells[ci];
  return cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR;
}

function darknessRevealRadius(spec: DarknessRoomSpec): number {
  return Math.max(5, Math.min(14, Math.ceil(Math.max(spec.w, spec.h) / 2) + 3));
}

function darknessLightPathCosts(): Map<string, number> {
  const costs = new Map<string, number>();
  costs.set('entry', 0);
  for (let pass = 0; pass < ROOM_SPECS.length; pass++) {
    let changed = false;
    for (const edge of LIGHT_GRAPH_EDGE_SPECS) {
      const fromCost = costs.get(edge.fromKey);
      if (fromCost !== undefined) {
        const next = fromCost + edge.lightCost;
        if (next < (costs.get(edge.toKey) ?? Number.POSITIVE_INFINITY)) {
          costs.set(edge.toKey, next);
          changed = true;
        }
      }
      const toCost = costs.get(edge.toKey);
      if (toCost !== undefined) {
        const next = toCost + edge.lightCost;
        if (next < (costs.get(edge.fromKey) ?? Number.POSITIVE_INFINITY)) {
          costs.set(edge.fromKey, next);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return costs;
}

function buildDarknessLightGraphNodes(
  roomsByKey: Map<string, Room>,
  labels: readonly DarknessRoomLabel[],
): DarknessLightGraphNode[] {
  const pathCosts = darknessLightPathCosts();
  return labels.map(label => {
    const room = roomsByKey.get(label.key)!;
    const travelCost = pathCosts.get(label.key) ?? DARKNESS_LIGHT_BUDGET;
    const revealSpend = label.revealedAtStart ? 0 : travelCost + label.lightCost;
    const tags = [
      'darkness',
      'light_graph',
      label.revealedAtStart ? 'revealed_start' : 'paid_reveal',
      label.lightCost > 0 ? 'spend_light' : 'free_light',
    ];
    if (darknessRoomSpecByKey(label.key).lamps?.length) tags.push('light_pocket');
    return {
      id: `darkness_light_node_${label.key}`,
      roomKey: label.key,
      roomId: label.roomId,
      x: centerX(room),
      y: centerY(room),
      lightCost: label.lightCost,
      revealRadius: darknessRevealRadius(darknessRoomSpecByKey(label.key)),
      budgetAfterReveal: Math.max(0, DARKNESS_LIGHT_BUDGET - revealSpend),
      tags,
    };
  });
}

function buildDarknessLightGraphEdges(roomsByKey: Map<string, Room>): DarknessLightGraphEdge[] {
  return LIGHT_GRAPH_EDGE_SPECS.map(spec => {
    const from = roomsByKey.get(spec.fromKey)!;
    const to = roomsByKey.get(spec.toKey)!;
    return {
      id: `darkness_light_edge_${spec.fromKey}_${spec.toKey}`,
      fromKey: spec.fromKey,
      toKey: spec.toKey,
      fromRoomId: from.id,
      toRoomId: to.id,
      lightCost: spec.lightCost,
      decisions: [...spec.decisions],
      tags: ['darkness', 'light_graph_edge', ...spec.tags],
    };
  });
}

function buildDarknessRevealShell(
  world: World,
  room: Room,
  spec: DarknessRoomSpec,
  scratch: DarknessBfsScratch,
): DarknessRevealShell {
  resetDarknessBfsScratch(scratch);
  const originX = centerX(room);
  const originY = centerY(room);
  const radius = darknessRevealRadius(spec);
  const seed = world.idx(originX, originY);
  let head = 0;
  let tail = 0;
  scratch.queue[tail] = seed;
  scratch.depth[tail] = 0;
  scratch.visited[seed] = 1;
  scratch.parent[seed] = -1;
  scratch.touched.push(seed);
  tail++;

  let cellCount = 0;
  let minFog = 255;
  let maxFog = 0;
  while (head < tail) {
    const ci = scratch.queue[head];
    const depth = scratch.depth[head];
    head++;
    if (!darknessGraphWalkable(world, ci)) continue;
    cellCount++;
    const fog = world.fog[ci] ?? 0;
    minFog = Math.min(minFog, fog);
    maxFog = Math.max(maxFog, fog);
    if (depth >= radius) continue;
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
      const ni = world.idx(x + dx, y + dy);
      if (scratch.visited[ni] || !darknessGraphWalkable(world, ni)) continue;
      scratch.visited[ni] = 1;
      scratch.parent[ni] = ci;
      scratch.touched.push(ni);
      scratch.queue[tail] = ni;
      scratch.depth[tail] = depth + 1;
      tail++;
    }
  }
  resetDarknessBfsScratch(scratch);

  return {
    id: `darkness_reveal_shell_${spec.key}`,
    roomKey: spec.key,
    roomId: room.id,
    originX,
    originY,
    radius,
    cellCount,
    minFog: cellCount > 0 ? minFog : 0,
    maxFog: cellCount > 0 ? maxFog : 0,
    lightCost: spec.lightCost,
    tags: [
      'darkness',
      'bfs_reveal_shell',
      spec.revealedAtStart ? 'revealed_start' : 'paid_reveal',
      spec.lightCost > 0 ? 'spend_light' : 'free_light',
    ],
  };
}

function findDarknessPathCells(
  world: World,
  fromRoom: Room,
  toRoom: Room,
  scratch: DarknessBfsScratch,
): number[] {
  resetDarknessBfsScratch(scratch);
  const seed = world.idx(centerX(fromRoom), centerY(fromRoom));
  const target = world.idx(centerX(toRoom), centerY(toRoom));
  let head = 0;
  let tail = 0;
  scratch.queue[tail] = seed;
  scratch.depth[tail] = 0;
  scratch.visited[seed] = 1;
  scratch.parent[seed] = -1;
  scratch.touched.push(seed);
  tail++;

  let found = seed === target;
  while (head < tail && !found) {
    const ci = scratch.queue[head++];
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
      const ni = world.idx(x + dx, y + dy);
      if (scratch.visited[ni] || !darknessGraphWalkable(world, ni)) continue;
      scratch.visited[ni] = 1;
      scratch.parent[ni] = ci;
      scratch.touched.push(ni);
      scratch.queue[tail++] = ni;
      if (ni === target) {
        found = true;
        break;
      }
    }
  }

  const path: number[] = [];
  if (found) {
    for (let ci = target; ci >= 0; ci = scratch.parent[ci]) {
      path.push(ci);
      if (ci === seed) break;
    }
    path.reverse();
  }
  resetDarknessBfsScratch(scratch);
  return path;
}

function averageFogForCells(world: World, cells: readonly number[]): number {
  if (cells.length === 0) return 0;
  let fog = 0;
  for (const ci of cells) fog += world.fog[ci] ?? 0;
  return Math.round(fog / cells.length);
}

function buildDarknessSoundPath(
  world: World,
  roomsByKey: Map<string, Room>,
  spec: (typeof SOUND_PATH_SPECS)[number],
  scratch: DarknessBfsScratch,
): DarknessSoundPath {
  const from = roomsByKey.get(spec.fromKey)!;
  const to = roomsByKey.get(spec.toKey)!;
  const path = findDarknessPathCells(world, from, to, scratch);
  return {
    id: spec.id,
    fromKey: spec.fromKey,
    toKey: spec.toKey,
    fromRoomId: from.id,
    toRoomId: to.id,
    cellCount: path.length,
    averageFog: averageFogForCells(world, path),
    cueId: spec.cueId,
    decisions: [...spec.decisions],
    tags: ['darkness', ...spec.tags],
  };
}

function buildDarknessRadonSightCorridor(
  world: World,
  roomsByKey: Map<string, Room>,
  spec: (typeof RADON_SIGHT_SPECS)[number],
): DarknessRadonBuildResult {
  const from = roomsByKey.get(spec.fromKey)!;
  const to = roomsByKey.get(spec.toKey)!;
  const ax = centerX(from);
  const ay = centerY(from);
  const dx = world.delta(ax, centerX(to));
  const dy = world.delta(ay, centerY(to));
  const steps = Math.max(1, Math.abs(dx), Math.abs(dy));
  let previous = -1;
  let cellCount = 0;
  let coverBreaks = 0;
  let minFog = 255;
  let maxFog = 0;
  let fogDirty = false;

  for (let i = 0; i <= steps; i++) {
    const x = world.wrap(Math.round(ax + (dx * i) / steps));
    const y = world.wrap(Math.round(ay + (dy * i) / steps));
    const ci = world.idx(x, y);
    if (ci === previous) continue;
    previous = ci;
    if (!darknessGraphWalkable(world, ci)) {
      coverBreaks++;
      continue;
    }
    cellCount++;
    if (world.fog[ci] < spec.fog) {
      world.fog[ci] = spec.fog;
      fogDirty = true;
    }
    const fog = world.fog[ci] ?? 0;
    minFog = Math.min(minFog, fog);
    maxFog = Math.max(maxFog, fog);
  }

  return {
    corridor: {
      id: spec.id,
      fromKey: spec.fromKey,
      toKey: spec.toKey,
      fromRoomId: from.id,
      toRoomId: to.id,
      angleDeg: Math.round((Math.atan2(dy, dx) * 180) / Math.PI),
      cellCount,
      coverBreaks,
      minFog: cellCount > 0 ? minFog : 0,
      maxFog: cellCount > 0 ? maxFog : 0,
      decisions: [...spec.decisions],
      tags: ['darkness', ...spec.tags],
    },
    fogDirty,
  };
}

function buildDarknessTopologyPlan(
  world: World,
  roomsByKey: Map<string, Room>,
  labels: readonly DarknessRoomLabel[],
): DarknessTopologyPlan {
  const scratch = makeDarknessBfsScratch();
  const revealShells = labels.map(label => {
    const room = roomsByKey.get(label.key)!;
    return buildDarknessRevealShell(world, room, darknessRoomSpecByKey(label.key), scratch);
  });
  const soundPaths = SOUND_PATH_SPECS.map(spec => buildDarknessSoundPath(world, roomsByKey, spec, scratch));
  const radonResults = RADON_SIGHT_SPECS.map(spec => buildDarknessRadonSightCorridor(world, roomsByKey, spec));
  if (radonResults.some(result => result.fogDirty)) world.markFogDirty();
  return {
    lightGraphNodes: buildDarknessLightGraphNodes(roomsByKey, labels),
    lightGraphEdges: buildDarknessLightGraphEdges(roomsByKey),
    revealShells,
    soundPaths,
    radonSightCorridors: radonResults.map(result => result.corridor),
  };
}

function applyRoomLook(world: World, room: Room, wallTex: Tex, floorTex: Tex, fog: number): void {
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) {
        world.floorTex[ci] = floorTex;
        world.fog[ci] = Math.max(world.fog[ci], fog);
      } else {
        world.wallTex[ci] = wallTex;
      }
    }
  }
}

function placeRoomLights(world: World, room: Room, lamps: readonly [number, number, Feature][] | undefined): void {
  if (!lamps) return;
  for (const [dx, dy, feature] of lamps) {
    const ci = world.idx(room.x + dx, room.y + dy);
    if (world.cells[ci] === Cell.FLOOR) world.features[ci] = feature;
  }
}

function setFloorFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = feature;
}

function setInteriorWall(world: World, room: Room, dx: number, dy: number, wallTex = Tex.VOID_WALL): void {
  const ci = world.idx(room.x + dx, room.y + dy);
  if (world.cells[ci] !== Cell.FLOOR) return;
  world.cells[ci] = Cell.WALL;
  world.roomMap[ci] = -1;
  world.wallTex[ci] = wallTex;
  world.features[ci] = Feature.NONE;
}

function decorateDarknessRoom(world: World, room: Room, key: string): void {
  if (key === 'generator') {
    for (let dx = 4; dx <= 12; dx += 4) {
      setFloorFeature(world, room.x + dx, room.y + 5, Feature.MACHINE);
      setFloorFeature(world, room.x + dx, room.y + 7, Feature.APPARATUS);
    }
    setFloorFeature(world, room.x + 14, room.y + 2, Feature.SCREEN);
    return;
  }

  if (key === 'control') {
    setFloorFeature(world, room.x + 3, room.y + 2, Feature.DESK);
    setFloorFeature(world, room.x + 11, room.y + 3, Feature.SCREEN);
    setInteriorWall(world, room, 7, 1, Tex.DARK);
    setInteriorWall(world, room, 7, 2, Tex.DARK);
    setInteriorWall(world, room, 7, 6, Tex.DARK);
    setInteriorWall(world, room, 7, 7, Tex.DARK);
    return;
  }

  if (key === 'toll_gate') {
    for (let dy = 1; dy < room.h - 1; dy++) {
      if (dy === 3 || dy === 4) continue;
      setInteriorWall(world, room, 5, dy);
    }
    setFloorFeature(world, room.x + 2, room.y + 2, Feature.TABLE);
    setFloorFeature(world, room.x + 8, room.y + 5, Feature.APPARATUS);
    return;
  }

  if (key === 'bypass') {
    for (let dx = 3; dx < room.w - 2; dx += 5) {
      setFloorFeature(world, room.x + dx, room.y + 1, Feature.APPARATUS);
    }
    return;
  }

  if (key === 'emergency') {
    setFloorFeature(world, room.x + 4, room.y + 4, Feature.SHELF);
    setFloorFeature(world, room.x + 10, room.y + 4, Feature.SHELF);
  }
}

function connectRoomCenters(world: World, a: Room, b: Room): void {
  carveCorridor(world, centerX(a), centerY(a), centerX(b), centerY(b));
}

function carveDarknessDisc(
  world: World,
  cx: number,
  cy: number,
  r: number,
  floorTex: Tex,
  fog: number,
  roomId = -1,
): void {
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const ci = world.idx(cx + dx, cy + dy);
      if (world.cells[ci] === Cell.LIFT) continue;
      if (world.cells[ci] === Cell.DOOR) {
        world.floorTex[ci] = floorTex;
        world.fog[ci] = Math.max(world.fog[ci], fog);
        continue;
      }
      world.cells[ci] = Cell.FLOOR;
      if (world.roomMap[ci] < 0) world.roomMap[ci] = roomId;
      world.floorTex[ci] = floorTex;
      world.fog[ci] = Math.max(world.fog[ci], fog);
    }
  }
}

function carveDarknessPathCells(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
  fog: number,
  floorTex = Tex.F_VOID,
): void {
  const ddx = world.delta(ax, bx);
  const ddy = world.delta(ay, by);
  const steps = Math.max(1, Math.abs(ddx), Math.abs(ddy));
  for (let i = 0; i <= steps; i++) {
    const x = world.wrap(Math.round(ax + (ddx * i) / steps));
    const y = world.wrap(Math.round(ay + (ddy * i) / steps));
    carveDarknessDisc(world, x, y, radius, floorTex, fog);
  }
}

function carveDarknessPath(world: World, a: Room, b: Room, radius: number, fog: number, floorTex = Tex.F_VOID): void {
  carveDarknessPathCells(world, centerX(a), centerY(a), centerX(b), centerY(b), radius, fog, floorTex);
}

function softenFogDisc(world: World, cx: number, cy: number, r: number, fog: number): void {
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const ci = world.idx(cx + dx, cy + dy);
      if (world.cells[ci] !== Cell.FLOOR) continue;
      world.fog[ci] = Math.min(world.fog[ci], fog);
    }
  }
}

function markLightIsland(world: World, room: Room, radius: number, fog: number): void {
  softenFogDisc(world, centerX(room), centerY(room), radius, fog);
}

function addDeadLampRow(world: World, a: Room, b: Room): void {
  const ax = centerX(a);
  const ay = centerY(a);
  const ddx = world.delta(ax, centerX(b));
  const ddy = world.delta(ay, centerY(b));
  const steps = Math.max(1, Math.abs(ddx), Math.abs(ddy));
  for (let i = 3; i < steps; i += 4) {
    const x = world.wrap(Math.round(ax + (ddx * i) / steps));
    const y = world.wrap(Math.round(ay + (ddy * i) / steps));
    const ci = world.idx(x, y);
    if (world.cells[ci] === Cell.FLOOR && world.features[ci] === Feature.NONE) {
      world.features[ci] = Feature.APPARATUS;
    }
  }
}

function applyLightRouteGeometry(world: World, roomsByKey: Map<string, Room>): void {
  const entry = roomsByKey.get('entry')!;
  const junction = roomsByKey.get('junction')!;
  const lamp = roomsByKey.get('lamp')!;
  const generator = roomsByKey.get('generator')!;
  const name = roomsByKey.get('name')!;
  const control = roomsByKey.get('control')!;
  const toll = roomsByKey.get('toll')!;
  const tollGate = roomsByKey.get('toll_gate')!;
  const bypass = roomsByKey.get('bypass')!;
  const emergency = roomsByKey.get('emergency')!;
  const trace = roomsByKey.get('trace')!;

  carveDarknessPath(world, entry, junction, 2, 24, Tex.F_CONCRETE);
  carveDarknessPath(world, junction, lamp, 2, 28, Tex.F_CONCRETE);
  carveDarknessPath(world, lamp, generator, 1, 34, Tex.F_CONCRETE);
  carveDarknessPath(world, generator, name, 1, 44);
  carveDarknessPath(world, name, control, 1, 52);
  carveDarknessPath(world, control, trace, 1, 44);

  carveDarknessPath(world, junction, toll, 1, 72);
  carveDarknessPath(world, toll, tollGate, 1, 88);
  carveDarknessPath(world, tollGate, trace, 1, 78);

  carveDarknessPath(world, lamp, bypass, 1, 60);
  carveDarknessPath(world, bypass, emergency, 1, 82);
  carveDarknessPath(world, emergency, trace, 1, 68);
  carveDarknessPath(world, generator, control, 1, 42);
  carveDarknessPath(world, tollGate, emergency, 1, 92);

  addDeadLampRow(world, junction, toll);
  addDeadLampRow(world, bypass, emergency);

  markLightIsland(world, entry, 7, 10);
  markLightIsland(world, junction, 9, 18);
  markLightIsland(world, lamp, 9, 14);
  markLightIsland(world, generator, 8, 16);
  markLightIsland(world, control, 7, 22);
  markLightIsland(world, emergency, 8, 18);
  markLightIsland(world, trace, 8, 22);
}

function setDoorStates(world: World): void {
  for (const door of world.doors.values()) {
    door.state = DoorState.CLOSED;
    door.timer = 0;
  }
}

function paintCorridors(world: World): void {
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.WALL) {
      if (!world.wallTex[i]) world.wallTex[i] = Tex.DARK;
      continue;
    }
    if (!world.floorTex[i]) world.floorTex[i] = Tex.F_CONCRETE;
    if (world.roomMap[i] < 0) world.fog[i] = Math.max(world.fog[i], 30);
  }
  world.markFogDirty();
}

function addLift(world: World, x: number, y: number, direction: LiftDirection): void {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.LIFT;
  world.wallTex[ci] = Tex.LIFT_DOOR;
  world.liftDir[ci] = direction;
}

function dropItem(
  entities: Entity[],
  nextId: { v: number },
  x: number,
  y: number,
  item: Item,
): void {
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
    inventory: [item],
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
  name: string,
  inventory: Item[],
  tags: string[],
): void {
  const id = nextContainerId(world);
  const ci = world.idx(x, y);
  const container: WorldContainer = {
    id,
    x: world.wrap(x),
    y: world.wrap(y),
    floor: FloorLevel.VOID,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind: ContainerKind.SECRET_STASH,
    name,
    inventory,
    capacitySlots: 6,
    access: 'public',
    discovered: true,
    tags,
  };
  world.addContainer(container);
}

function darknessMonsterAngle(id: number, x: number, y: number): number {
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(worldWrap(x) + 1, 0xc2b2ae35) ^ Math.imul(worldWrap(y) + 1, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return ((h >>> 0) / 0x100000000) * Math.PI * 2;
}

function darknessMonsterPhases(kind: MonsterKind): boolean {
  return kind === MonsterKind.SPIRIT ||
    kind === MonsterKind.SHADOW ||
    kind === MonsterKind.TONKAYA_TEN ||
    kind === MonsterKind.GLUBINNAYA_TEN ||
    kind === MonsterKind.LOZHNYY_DUKH;
}

function spawnMonster(
  entities: Entity[],
  nextId: { v: number },
  kind: MonsterKind,
  x: number,
  y: number,
  level: number,
  name?: string,
): void {
  const def = MONSTERS[kind];
  const hp = Math.round(scaleMonsterHp(def.hp, level));
  const id = nextId.v++;
  entities.push({
    id,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: darknessMonsterAngle(id, x, y),
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, level),
    sprite: monsterSpr(kind),
    name,
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
    phasing: darknessMonsterPhases(kind),
  });
}

function buildRooms(world: World): { roomsByKey: Map<string, Room>; labels: DarknessRoomLabel[] } {
  const roomsByKey = new Map<string, Room>();
  const labels: DarknessRoomLabel[] = [];

  for (const spec of ROOM_SPECS) {
    const room = stampRoom(world, world.rooms.length, spec.type, spec.x, spec.y, spec.w, spec.h, -1);
    room.name = spec.revealedAtStart ? spec.revealedName : spec.hiddenName;
    applyRoomLook(world, room, Tex.DARK, spec.key === 'trace' ? Tex.F_VOID : Tex.F_CONCRETE, spec.fog ?? 30);
    placeRoomLights(world, room, spec.lamps);
    decorateDarknessRoom(world, room, spec.key);
    roomsByKey.set(spec.key, room);
    labels.push({
      roomId: room.id,
      key: spec.key,
      hiddenName: spec.hiddenName,
      revealedName: spec.revealedName,
      lightCost: spec.lightCost,
      revealedAtStart: spec.revealedAtStart === true,
    });
  }

  const entry = roomsByKey.get('entry')!;
  const junction = roomsByKey.get('junction')!;
  const lamp = roomsByKey.get('lamp')!;
  const generator = roomsByKey.get('generator')!;
  const name = roomsByKey.get('name')!;
  const control = roomsByKey.get('control')!;
  const toll = roomsByKey.get('toll')!;
  const tollGate = roomsByKey.get('toll_gate')!;
  const bypass = roomsByKey.get('bypass')!;
  const emergency = roomsByKey.get('emergency')!;
  const trace = roomsByKey.get('trace')!;

  connectRoomCenters(world, entry, junction);
  connectRoomCenters(world, junction, lamp);
  connectRoomCenters(world, lamp, generator);
  connectRoomCenters(world, generator, name);
  connectRoomCenters(world, lamp, name);
  connectRoomCenters(world, name, control);
  connectRoomCenters(world, control, trace);
  connectRoomCenters(world, name, trace);
  connectRoomCenters(world, junction, toll);
  connectRoomCenters(world, toll, tollGate);
  connectRoomCenters(world, tollGate, trace);
  connectRoomCenters(world, lamp, bypass);
  connectRoomCenters(world, bypass, emergency);
  connectRoomCenters(world, emergency, trace);
  connectRoomCenters(world, generator, control);
  connectRoomCenters(world, tollGate, emergency);
  applyLightRouteGeometry(world, roomsByKey);

  placeDoorAt(world, entry.x - 1, entry.y + (entry.h >> 1), entry.id);
  addLift(world, entry.x - 2, entry.y + (entry.h >> 1), LiftDirection.UP);
  placeDoorAt(world, trace.x + trace.w, trace.y + (trace.h >> 1), trace.id);
  addLift(world, trace.x + trace.w + 1, trace.y + (trace.h >> 1), LiftDirection.DOWN);

  setDoorStates(world);
  sanitizeDoors(world);
  paintCorridors(world);
  return { roomsByKey, labels };
}

function placeContent(world: World, entities: Entity[], nextId: { v: number }, roomsByKey: Map<string, Room>): void {
  const entry = roomsByKey.get('entry')!;
  const lamp = roomsByKey.get('lamp')!;
  const generator = roomsByKey.get('generator')!;
  const name = roomsByKey.get('name')!;
  const control = roomsByKey.get('control')!;
  const toll = roomsByKey.get('toll')!;
  const tollGate = roomsByKey.get('toll_gate')!;
  const trace = roomsByKey.get('trace')!;
  const bypass = roomsByKey.get('bypass')!;
  const emergency = roomsByKey.get('emergency')!;

  dropItem(entities, nextId, entry.x + 4, entry.y + 4, {
    defId: 'note',
    count: 1,
    data: 'ТЬМА: стартовый бюджет света - 8. Комната стоит 1-3. Не всякую табличку надо спасать.',
  });
  dropItem(entities, nextId, entry.x + 7, entry.y + 4, { defId: 'flashlight', count: 1 });

  addContainer(world, lamp, lamp.x + 9, lamp.y + 5, 'Ящик Ники: запас света', [
    { defId: 'lamp_bulb', count: 3 },
    { defId: 'fuse', count: 1 },
    {
      defId: 'note',
      count: 1,
      data: 'Зарядов мало. Один откроет подпись комнаты, два удержат Нику рядом, три купят короткий путь.',
    },
  ], ['darkness', 'light_budget', 'lamp_survival']);

  addContainer(world, name, name.x + 10, name.y + 5, 'Карточка имени под лампой', [
    {
      defId: 'personal_file_copy',
      count: 1,
      data: { darknessNameId: DARKNESS_PRESERVED_NAME_ID },
    },
    {
      defId: 'note',
      count: 1,
      data: 'Тамара Белова. Дата рождения читается, пока горит лампа. Без света карточка пустеет.',
    },
  ], ['darkness', 'preserved_name', DARKNESS_PRESERVED_NAME_ID]);

  addContainer(world, generator, generator.x + 14, generator.y + 7, 'Генераторный ящик', [
    { defId: 'fuse', count: 2 },
    { defId: 'lamp_bulb', count: 1 },
    {
      defId: 'note',
      count: 1,
      data: 'Генератор держит свет на островах, но не освещает пошлину. Свет лучше тратить на выбор, а не на страх.',
    },
  ], ['darkness', 'generator_room', 'light_budget']);

  addContainer(world, control, control.x + 2, control.y + 6, 'Пульт аварийных островов', [
    {
      defId: 'note',
      count: 1,
      data: 'Три линии: светлая через имя, короткая через сборщика, длинная через карманы. Все ведут к следу.',
    },
  ], ['darkness', 'route_hint', 'control_room']);

  addContainer(world, toll, toll.x + 2, toll.y + 8, 'Короткий путь за свет', [
    {
      defId: 'note',
      count: 1,
      data: 'Если отдать лампу сборщику, тени расходятся на один проход. Если нет - они остаются голодными.',
    },
  ], ['darkness', 'shadow_toll', 'pay_light']);

  addContainer(world, tollGate, tollGate.x + 8, tollGate.y + 3, 'Щель теневой пошлины', [
    {
      defId: 'note',
      count: 1,
      data: 'Шлюз узкий. Заплатишь светом - тихо. Сохранишь свет - тени услышат шаг.',
    },
  ], ['darkness', 'shadow_toll', 'chokepoint']);

  addContainer(world, bypass, bypass.x + 18, bypass.y + 2, 'Темный обходной тайник', [
    { defId: 'tanev_svt40', count: 1 },
    { defId: 'ammo_762', count: 6 },
    { defId: 'ptrs_liquidator', count: 1 },
    { defId: 'ammo_harpoon', count: 2 },
    { defId: 'bandage', count: 1 },
    {
      defId: 'note',
      count: 1,
      data: 'Обход длинный, но свет остается у тебя. Винтовку Танева берегли для тихого выстрела, ПТРС - для брони, которую нельзя уговорить.',
    },
  ], ['darkness', 'shadow_toll', 'long_route', 'tanev_svt40', 'ptrs_liquidator', 'sniper_reward', 'anti_armor_reward']);

  addContainer(world, emergency, emergency.x + 5, emergency.y + 4, 'Аварийный карман без ключа', [
    { defId: 'bandage', count: 1 },
    { defId: 'water', count: 1 },
    {
      defId: 'note',
      count: 1,
      data: 'Это не награда, а право ошибиться: переждать темный отсек, затем идти дальше без редкого ключа.',
    },
  ], ['darkness', 'emergency_stash', 'fallback_route']);

  addContainer(world, trace, trace.x + 6, trace.y + 6, 'Отметина возврата', [
    { defId: 'overexposed_photo', count: 1 },
    {
      defId: 'note',
      count: 1,
      data: 'Возвратный след: living/ministry/yakov. Один сохраненный факт разрешен к переносу.',
    },
  ], ['darkness', 'return_trace', 'living_hook', 'ministry_hook', 'yakov_hook']);

  addContainer(world, trace, trace.x + 2, trace.y + 2, 'Атомный футляр АТО-41', [
    { defId: 'ato41_atomic_flamer', count: 2 },
    {
      defId: 'note',
      count: 1,
      data: 'АТО-41: две секции. Режет дверь и налёт одной линией, но всё в луче считается сгоревшим имуществом.',
    },
  ], ['darkness', 'ato41_atomic_flamer', 'unique_weapon', 'collateral']);

  spawnMonster(entities, nextId, MonsterKind.SHADOW, toll.x + 11, toll.y + 3, 12, 'Тень пошлины');
  spawnMonster(entities, nextId, MonsterKind.SHADOW, toll.x + 12, toll.y + 8, 12, 'Тень сдачи');
  spawnMonster(entities, nextId, MonsterKind.SHADOW, tollGate.x + 6, tollGate.y + 2, 12, 'Тень турникета');
  spawnMonster(entities, nextId, MonsterKind.SHADOW, emergency.x + 10, emergency.y + 5, 11, 'Тень длинного обхода');
  spawnMonster(entities, nextId, MonsterKind.SHADOW, name.x + 3, name.y + 8, 11, 'Тень без фамилии');
  spawnMonster(entities, nextId, MonsterKind.GLUBINNAYA_TEN, trace.x + 5, trace.y + 8, 13, 'Глубинная Тень у пустотного шва');
  spawnMonster(entities, nextId, MonsterKind.SLEPOGLAZ, bypass.x + 24, bypass.y + 2, 12, 'Слепоглаз гулкого обхода');
  spawnMonster(entities, nextId, MonsterKind.PROTOKOLNIK, control.x + 11, control.y + 4, 12, 'Протокольник аварийного света');
  spawnMonster(entities, nextId, MonsterKind.LAMPOVY, generator.x + 6, generator.y + 5, 12, 'Ламповый у генератора');
  spawnMonster(entities, nextId, MonsterKind.EYE, trace.x + 9, trace.y + 2, 13, 'Глаз возврата');
}

function applyDarknessZones(world: World): void {
  generateZones(world);
  for (const zone of world.zones) {
    zone.faction = ZoneFaction.SAMOSBOR;
    zone.fogged = true;
    zone.level = 12;
    zone.hasLift = false;
  }
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.LIFT) world.zones[world.zoneMap[i]].hasLift = true;
  }
}

function initialState(labels: DarknessRoomLabel[], topology: DarknessTopologyPlan): DarknessFloorState {
  return {
    routeId: DARKNESS_DESIGN_FLOOR_ID,
    z: DARKNESS_FUTURE_Z,
    lightBudget: DARKNESS_LIGHT_BUDGET,
    revealedRoomIds: labels.filter(label => label.revealedAtStart).map(label => label.roomId),
    preservedNameId: null,
    shadowTollState: 'unpaid',
    roomLabels: labels,
    quests: QUESTS.map(q => ({ ...q, choices: [...q.choices] })),
    lateWarnings: DARKNESS_LATE_WARNINGS.map(warning => ({ ...warning, tags: [...warning.tags] })),
    shortcutCueIds: ['darkness_shadow_toll_shortcut', 'darkness_return_trace_warning'],
    lightGraphNodes: topology.lightGraphNodes,
    lightGraphEdges: topology.lightGraphEdges,
    revealShells: topology.revealShells,
    soundPaths: topology.soundPaths,
    radonSightCorridors: topology.radonSightCorridors,
    returnTracePublished: false,
  };
}

function darknessRoomByKey(world: World, key: string): Room | null {
  const idx = ROOM_SPECS.findIndex(spec => spec.key === key);
  return idx >= 0 ? world.rooms[idx] ?? null : null;
}

function carveLightPocket(world: World, cx: number, cy: number, radius: number, fog: number, lamp: Feature): void {
  carveDarknessDisc(world, cx, cy, radius, Tex.F_CONCRETE, fog);
  softenFogDisc(world, cx, cy, radius + 2, fog);
  setFloorFeature(world, cx, cy, lamp);
  setFloorFeature(world, cx + 2, cy + 1, Feature.SHELF);
}

function canStampDarknessExpandedRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  if (x < 3 || y < 3 || x + w >= W - 3 || y + h >= W - 3) return false;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.aptMask[ci]) return false;
      if (world.cells[ci] !== Cell.WALL) return false;
      if (world.roomMap[ci] >= 0) return false;
      if (world.hermoWall[ci]) return false;
    }
  }
  return true;
}

function stampDarknessExpandedRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  fog: number,
  wallTex = Tex.DARK,
  floorTex = Tex.F_VOID,
): Room | null {
  if (!canStampDarknessExpandedRoom(world, x, y, w, h)) return null;
  const room = stampRoom(world, world.rooms.length, type, x, y, w, h, -1);
  room.name = name;
  applyRoomLook(world, room, wallTex, floorTex, fog);
  return room;
}

function paintDarknessRoomOwner(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[ci] === room.id && !world.aptMask[ci]) world.factionControl[ci] = owner;
    }
  }
  for (const doorIdx of room.doors) {
    if (!world.aptMask[doorIdx]) world.factionControl[doorIdx] = owner;
  }
}

function decorateDarknessSupportRoom(world: World, room: Room, feature: Feature): void {
  setFloorFeature(world, room.x + Math.max(1, Math.floor(room.w / 3)), room.y + Math.max(1, Math.floor(room.h / 2)), feature);
  if (room.type === RoomType.BATHROOM) {
    setFloorFeature(world, room.x + room.w - 3, room.y + Math.max(1, Math.floor(room.h / 2)), Feature.SINK);
  } else if (room.type === RoomType.KITCHEN) {
    setFloorFeature(world, room.x + room.w - 3, room.y + Math.max(1, Math.floor(room.h / 2)), Feature.TABLE);
  } else if (room.type === RoomType.PRODUCTION || room.type === RoomType.MEDICAL) {
    setFloorFeature(world, room.x + room.w - 3, room.y + 2, Feature.APPARATUS);
  } else if (room.type === RoomType.OFFICE) {
    setFloorFeature(world, room.x + room.w - 3, room.y + 2, Feature.SCREEN);
  }
}

function hardenDarknessHqRoom(world: World, room: Room, owner: TerritoryOwner): void {
  room.type = RoomType.HQ;
  room.sealed = true;
  room.wallTex = Tex.HERMO_WALL;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      const inside = dx >= 0 && dx < room.w && dy >= 0 && dy < room.h;
      if (inside) {
        if (world.roomMap[ci] === room.id) world.factionControl[ci] = owner;
        continue;
      }
      if (world.cells[ci] !== Cell.WALL || world.aptMask[ci]) continue;
      world.hermoWall[ci] = 1;
      world.wallTex[ci] = Tex.HERMO_WALL;
    }
  }
  for (const doorIdx of room.doors) {
    const door = world.doors.get(doorIdx);
    if (door) {
      door.state = DoorState.HERMETIC_OPEN;
      door.timer = 0;
    }
    world.hermoWall[doorIdx] = 1;
    world.wallTex[doorIdx] = Tex.HERMO_WALL;
    world.factionControl[doorIdx] = owner;
  }
}

export function reinforceDarknessAuthoredHqTerritory(world: World): void {
  for (const compound of DARKNESS_HQ_COMPOUNDS) {
    const hq = world.rooms.find(room => room.name === compound.hqName);
    if (!hq) continue;
    hardenDarknessHqRoom(world, hq, compound.owner);
    paintDarknessRoomOwner(world, hq, compound.owner);
    for (const support of compound.support) {
      const room = world.rooms.find(candidate => candidate.name === support.name);
      if (!room) continue;
      room.type = support.type;
      paintDarknessRoomOwner(world, room, compound.owner);
      for (const doorIdx of room.doors) world.factionControl[doorIdx] = compound.owner;
    }
  }
  world.markWallTexDirty();
  world.markFeaturesDirty(false);
}

function buildDarknessHqCompound(world: World, spec: DarknessHqCompoundSpec): Room | null {
  const hq = stampDarknessExpandedRoom(
    world,
    RoomType.HQ,
    spec.cx - 11,
    spec.cy - 7,
    22,
    14,
    spec.hqName,
    44,
    Tex.HERMO_WALL,
    Tex.F_CONCRETE,
  );
  if (!hq) return null;
  paintDarknessRoomOwner(world, hq, spec.owner);
  setFloorFeature(world, spec.cx - 4, spec.cy, Feature.TABLE);
  setFloorFeature(world, spec.cx + 4, spec.cy, Feature.SCREEN);

  for (const support of spec.support) {
    const room = stampDarknessExpandedRoom(
      world,
      support.type,
      spec.cx + support.dx,
      spec.cy + support.dy,
      support.w,
      support.h,
      support.name,
      52,
      support.type === RoomType.BATHROOM ? Tex.TILE_W : Tex.DARK,
      support.type === RoomType.BATHROOM ? Tex.F_TILE : Tex.F_CONCRETE,
    );
    if (!room) continue;
    paintDarknessRoomOwner(world, room, spec.owner);
    decorateDarknessSupportRoom(world, room, support.feature);
    connectRoomCenters(world, hq, room);
  }

  return hq;
}

function buildDarknessStationBlock(world: World, spec: DarknessStationSpec, ordinal: number, rng: () => number): Room | null {
  const hub = stampDarknessExpandedRoom(
    world,
    RoomType.COMMON,
    spec.cx - 17,
    spec.cy - 10,
    34,
    20,
    spec.name,
    spec.fog,
    Tex.VOID_WALL,
    Tex.F_VOID,
  );
  if (!hub) return null;
  if (spec.owner !== undefined) paintDarknessRoomOwner(world, hub, spec.owner);
  setFloorFeature(world, spec.cx - 5, spec.cy, Feature.APPARATUS);
  setFloorFeature(world, spec.cx + 5, spec.cy, Feature.SHELF);

  const supportTypes = [
    RoomType.STORAGE,
    RoomType.PRODUCTION,
    RoomType.OFFICE,
    RoomType.BATHROOM,
    RoomType.COMMON,
    RoomType.STORAGE,
  ] as const;
  const supports = [
    { x: spec.cx - 58, y: spec.cy - 6, w: 20, h: 10 },
    { x: spec.cx + 38, y: spec.cy - 6, w: 22, h: 10 },
    { x: spec.cx - 10, y: spec.cy - 38, w: 22, h: 10 },
    { x: spec.cx - 10, y: spec.cy + 28, w: 18, h: 9 },
    { x: spec.cx - 42, y: spec.cy + 24, w: 22, h: 9 },
    { x: spec.cx + 22, y: spec.cy + 24, w: 20, h: 9 },
  ] as const;
  for (let i = 0; i < supports.length; i++) {
    const p = supports[i];
    const room = stampDarknessExpandedRoom(
      world,
      supportTypes[i],
      p.x,
      p.y,
      p.w,
      p.h,
      `${spec.name}: боковой отсек ${i + 1}`,
      spec.fog + 4,
      Tex.DARK,
      i === 3 ? Tex.F_TILE : Tex.F_CONCRETE,
    );
    if (!room) continue;
    if (spec.owner !== undefined) paintDarknessRoomOwner(world, room, spec.owner);
    decorateDarknessSupportRoom(world, room, i === 0 || i === 5 ? Feature.SHELF : i === 1 ? Feature.MACHINE : Feature.TABLE);
    connectRoomCenters(world, hub, room);
  }

  const microTypes = [
    RoomType.STORAGE,
    RoomType.OFFICE,
    RoomType.BATHROOM,
    RoomType.COMMON,
    RoomType.STORAGE,
    RoomType.PRODUCTION,
    RoomType.SMOKING,
    RoomType.STORAGE,
  ] as const;
  for (let i = 0; i < 10; i++) {
    const angle = ((Math.PI * 2) / 10) * i + ordinal * 0.17;
    const radius = 46 + (i % 3) * 8 + Math.floor(rng() * 5);
    const w = 7 + (i % 2) * 3;
    const h = 5 + (i % 3);
    const x = world.wrap(Math.round(spec.cx + Math.cos(angle) * radius) - (w >> 1));
    const y = world.wrap(Math.round(spec.cy + Math.sin(angle) * radius) - (h >> 1));
    if (x < 3 || y < 3 || x + w >= W - 3 || y + h >= W - 3) continue;
    const room = stampDarknessExpandedRoom(
      world,
      microTypes[i % microTypes.length],
      x,
      y,
      w,
      h,
      `${spec.name}: микрокомната ${i + 1}`,
      spec.fog + 8,
      Tex.DARK,
      i % 4 === 2 ? Tex.F_TILE : Tex.F_VOID,
    );
    if (!room) continue;
    if (spec.owner !== undefined && i % 3 !== 0) paintDarknessRoomOwner(world, room, spec.owner);
    decorateDarknessSupportRoom(world, room, i % 4 === 0 ? Feature.SHELF : i % 4 === 1 ? Feature.DESK : i % 4 === 2 ? Feature.SINK : Feature.CHAIR);
    connectRoomCenters(world, hub, room);
  }

  return hub;
}

function widenDarknessRoute(world: World, a: Room, b: Room, radius: number, fog: number): void {
  connectRoomCenters(world, a, b);
  carveDarknessPathCells(world, centerX(a), centerY(a), centerX(b), centerY(b), radius, fog, Tex.F_VOID);
  addDeadLampRow(world, a, b);
}

function retouchDarknessExpansion(world: World): void {
  for (let i = 0; i < W * W; i++) {
    const cell = world.cells[i];
    if (cell === Cell.WALL) {
      if (world.wallTex[i] !== Tex.HERMO_WALL && world.wallTex[i] !== Tex.VOID_WALL) world.wallTex[i] = Tex.DARK;
      continue;
    }
    if (cell === Cell.FLOOR || cell === Cell.DOOR) {
      if (world.roomMap[i] < 0) {
        world.floorTex[i] = Tex.F_VOID;
        world.fog[i] = Math.max(world.fog[i], 70);
      }
    }
  }
  world.markFloorTexDirty();
  world.markWallTexDirty();
  world.markFogDirty();
  world.markFeaturesDirty(false);
}

function expandDarknessMidMicroLayer(world: World, rng: () => number): void {
  const entry = darknessRoomByKey(world, 'entry');
  const generator = darknessRoomByKey(world, 'generator');
  const tollGate = darknessRoomByKey(world, 'toll_gate');
  const emergency = darknessRoomByKey(world, 'emergency');
  const trace = darknessRoomByKey(world, 'trace');
  if (!entry || !generator || !tollGate || !emergency || !trace) return;

  const hqRooms: Room[] = [];
  for (const compound of DARKNESS_HQ_COMPOUNDS) {
    const hq = buildDarknessHqCompound(world, compound);
    if (hq) hqRooms.push(hq);
  }

  const stationRooms: Room[] = [];
  for (let i = 0; i < DARKNESS_STATIONS.length; i++) {
    const station = buildDarknessStationBlock(world, DARKNESS_STATIONS[i], i, rng);
    if (station) stationRooms.push(station);
  }

  const humanLoop = [entry, hqRooms[0], stationRooms[6], hqRooms[2], stationRooms[0], stationRooms[1], hqRooms[1], tollGate, trace]
    .filter((room): room is Room => room !== undefined);
  for (let i = 0; i < humanLoop.length - 1; i++) {
    widenDarknessRoute(world, humanLoop[i], humanLoop[i + 1], i % 3 === 0 ? 2 : 1, 78 + (i % 3) * 8);
  }

  const lowerLoop = [trace, stationRooms[2], stationRooms[3], hqRooms[3], stationRooms[9], stationRooms[4], hqRooms[4], stationRooms[5], emergency, trace]
    .filter((room): room is Room => room !== undefined);
  for (let i = 0; i < lowerLoop.length - 1; i++) {
    widenDarknessRoute(world, lowerLoop[i], lowerLoop[i + 1], i % 2 === 0 ? 2 : 1, 84 + (i % 4) * 6);
  }

  const crossLoop = [generator, stationRooms[7], stationRooms[8], stationRooms[4], emergency, stationRooms[5], entry]
    .filter((room): room is Room => room !== undefined);
  for (let i = 0; i < crossLoop.length - 1; i++) {
    widenDarknessRoute(world, crossLoop[i], crossLoop[i + 1], 1, 88);
  }

  for (const hq of hqRooms) {
    const owner = world.factionControl[world.idx(centerX(hq), centerY(hq))] as TerritoryOwner;
    hardenDarknessHqRoom(world, hq, owner);
  }
  sanitizeDoors(world);
  retouchDarknessExpansion(world);
}

export function expandDarknessRouteGeometry(world: World, entities: Entity[], rng: () => number): void {
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.WALL) {
      world.wallTex[i] = (i & 7) === 0 ? Tex.VOID_WALL : Tex.DARK;
      world.floorTex[i] = Tex.F_VOID;
      continue;
    }
    if (world.roomMap[i] < 0 && world.cells[i] === Cell.FLOOR) {
      world.floorTex[i] = Tex.F_VOID;
      world.fog[i] = Math.max(world.fog[i], 58);
    }
  }

  const entry = darknessRoomByKey(world, 'entry');
  const junction = darknessRoomByKey(world, 'junction');
  const generator = darknessRoomByKey(world, 'generator');
  const tollGate = darknessRoomByKey(world, 'toll_gate');
  const emergency = darknessRoomByKey(world, 'emergency');
  const trace = darknessRoomByKey(world, 'trace');
  if (!entry || !junction || !generator || !tollGate || !emergency || !trace) return;

  const westPocket = { x: world.wrap(centerX(entry) - 24), y: world.wrap(centerY(entry) + 12) };
  const northPocket = { x: world.wrap(centerX(generator) + 18), y: world.wrap(centerY(generator) - 18) };
  const southPocket = { x: world.wrap(centerX(emergency) + 18), y: world.wrap(centerY(emergency) + 15) };
  const tracePocket = { x: world.wrap(centerX(trace) + 24), y: world.wrap(centerY(trace) + 10) };

  carveLightPocket(world, westPocket.x, westPocket.y, 6, 18, Feature.CANDLE);
  carveLightPocket(world, northPocket.x, northPocket.y, 7, 22, Feature.LAMP);
  carveLightPocket(world, southPocket.x, southPocket.y, 6, 26, Feature.CANDLE);
  carveLightPocket(world, tracePocket.x, tracePocket.y, 6, 24, Feature.CANDLE);

  carveDarknessPathCells(world, centerX(entry), centerY(entry), westPocket.x, westPocket.y, 1, 48);
  carveDarknessPathCells(world, centerX(generator), centerY(generator), northPocket.x, northPocket.y, 1, 54);
  carveDarknessPathCells(world, northPocket.x, northPocket.y, centerX(trace), centerY(trace), 1, 72);
  carveDarknessPathCells(world, centerX(emergency), centerY(emergency), southPocket.x, southPocket.y, 1, 82);
  carveDarknessPathCells(world, southPocket.x, southPocket.y, tracePocket.x, tracePocket.y, 1, 90);
  carveDarknessPathCells(world, tracePocket.x, tracePocket.y, centerX(trace), centerY(trace), 1, 62);
  addDeadLampRow(world, junction, tollGate);
  expandDarknessMidMicroLayer(world, rng);

  const nextId = { v: entities.reduce((mx, e) => Math.max(mx, e.id), 0) + 1 };
  const shadowCount = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < shadowCount; i++) {
    const x = i % 2 === 0 ? southPocket.x + Math.floor(rng() * 5) - 2 : tollGate.x + 2 + Math.floor(rng() * 6);
    const y = i % 2 === 0 ? southPocket.y + Math.floor(rng() * 5) - 2 : tollGate.y + 2 + Math.floor(rng() * 4);
    const kind = i === shadowCount - 1 ? MonsterKind.GLUBINNAYA_TEN : MonsterKind.SHADOW;
    const name = kind === MonsterKind.GLUBINNAYA_TEN ? 'Глубинная Тень темного маршрута' : 'Тень темного маршрута';
    spawnMonster(entities, nextId, kind, world.wrap(x), world.wrap(y), 11 + (i & 1), name);
  }

  world.markFogDirty();
}

export function getDarknessState(world: World): DarknessFloorState | null {
  return darknessStateByWorld.get(world) ?? null;
}

export function publishDarknessLateWarning(
  state: GameState,
  warningId: DarknessLateWarningId,
  options: DarknessReturnTraceOptions = {},
): WorldEvent {
  const warning = DARKNESS_LATE_WARNINGS.find(item => item.id === warningId);
  return publishEvent(state, {
    type: 'samosbor_warning',
    floor: state.currentFloor,
    zoneId: options.sourceZoneId,
    roomId: options.sourceRoomId,
    x: options.x,
    y: options.y,
    actorName: 'Темный отсек',
    targetName: warning?.label,
    severity: 4,
    privacy: 'secret',
    tags: ['darkness', 'late_warning', warningId, ...(warning?.tags ?? [])],
    data: {
      routeId: DARKNESS_DESIGN_FLOOR_ID,
      z: DARKNESS_FUTURE_Z,
      warningId,
      warning: warning?.warning,
    },
  });
}

export function publishDarknessReturnTrace(
  state: GameState,
  options: DarknessReturnTraceOptions = {},
): WorldEvent {
  return publishEvent(state, {
    type: 'rumor_observed',
    floor: state.currentFloor,
    zoneId: options.sourceZoneId,
    roomId: options.sourceRoomId,
    x: options.x,
    y: options.y,
    actorName: 'Темный отсек',
    targetName: 'Жилая зона / Министерство / Яков',
    severity: 4,
    privacy: 'secret',
    tags: ['darkness', 'return_trace', 'living_hook', 'ministry_hook', 'yakov_hook'],
    data: {
      routeId: DARKNESS_DESIGN_FLOOR_ID,
      z: DARKNESS_FUTURE_Z,
      preservedNameId: options.preservedNameId ?? DARKNESS_PRESERVED_NAME_ID,
      fact: 'one_name_returned_from_darkness',
    },
  });
}

function registerDarknessRouteCues(world: World, roomsByKey: Map<string, Room>): void {
  const toll = roomsByKey.get('toll');
  const tollGate = roomsByKey.get('toll_gate');
  const control = roomsByKey.get('control');
  const emergency = roomsByKey.get('emergency');
  const trace = roomsByKey.get('trace');
  if (toll && tollGate) {
    const markerX = toll.x + 2.5;
    const markerY = toll.y + 8.5;
    const targetX = tollGate.x + 6.5;
    const targetY = tollGate.y + 3.5;
    const markerCell = world.idx(Math.floor(markerX), Math.floor(markerY));
    registerRouteCue(world, {
      id: 'darkness_shadow_toll_shortcut',
      x: markerX,
      y: markerY,
      targetX,
      targetY,
      floor: FloorLevel.VOID,
      roomId: toll.id,
      targetRoomId: tollGate.id,
      zoneId: world.zoneMap[markerCell],
      label: 'теневая пошлина',
      hint: 'короткий путь просит свет',
      targetName: 'шлюз теневой пошлины',
      color: '#88f',
      tags: ['darkness', 'shadow_toll', 'shortcut', 'light_budget'],
      toneSeed: toll.id * 2003 + tollGate.id,
      radius: 8,
      targetRadius: 3,
      cooldownSec: 42,
      heardText: 'Сборщик тени показывает короткий путь: заплатить светом, драться или идти обходом.',
      followedText: 'Шлюз пошлины найден. Быстро пройти можно, но свет больше не вернется.',
      ignoredText: 'Теневая пошлина осталась позади. Длинный обход сохранит свет, но съест время.',
    });
  }

  if (control && trace) {
    const markerX = control.x + 11.5;
    const markerY = control.y + 3.5;
    const targetX = trace.x + 6.5;
    const targetY = trace.y + 4.5;
    const markerCell = world.idx(Math.floor(markerX), Math.floor(markerY));
    registerRouteCue(world, {
      id: 'darkness_return_trace_warning',
      x: markerX,
      y: markerY,
      targetX,
      targetY,
      floor: FloorLevel.VOID,
      roomId: control.id,
      targetRoomId: trace.id,
      zoneId: world.zoneMap[markerCell],
      label: 'возвратный след',
      hint: 'поздний факт выйдет наружу',
      targetName: 'комната возвратного следа',
      color: '#bbf',
      tags: ['darkness', 'return_trace', 'late_warning', 'living_hook'],
      toneSeed: control.id * 2011 + trace.id,
      radius: 8,
      targetRadius: 3,
      cooldownSec: 44,
      heardText: 'Пульт аварийного света предупреждает: возвратный след станет фактом для верхних этажей.',
      followedText: 'Комната следа найдена. Забрать кадр значит вынести темный отсек в другой маршрут.',
      ignoredText: 'Возвратный след остался в темноте. Верхние этажи пока не знают это имя.',
    });
  }

  if (emergency && trace) {
    const markerX = emergency.x + 10.5;
    const markerY = emergency.y + 4.5;
    const targetX = trace.x + trace.w + 1.5;
    const targetY = trace.y + (trace.h >> 1) + 0.5;
    const markerCell = world.idx(Math.floor(markerX), Math.floor(markerY));
    registerRouteCue(world, {
      id: 'darkness_exit_breath',
      x: markerX,
      y: markerY,
      targetX,
      targetY,
      floor: FloorLevel.VOID,
      roomId: emergency.id,
      targetRoomId: trace.id,
      zoneId: world.zoneMap[markerCell],
      label: 'нижний выдох',
      hint: 'выход слышен за следом',
      targetName: 'нижний лифт Темного отсека',
      color: '#9af',
      tags: ['darkness', 'exit', 'sound', 'route_protocol', 'tool_cue'],
      toneSeed: emergency.id * 2027 + trace.id,
      radius: 7,
      targetRadius: 3,
      cooldownSec: 38,
      heardText: 'За аварийным карманом слышен нижний выдох лифта: идти по звуку, не по темной табличке.',
      followedText: 'Возвратный след и нижний лифт найдены. Дальше темнота уже не просит имени.',
      ignoredText: 'Нижний выдох стихает за спиной. В Темном отсеке остались только обходы и чужие шаги.',
    });
  }
}

export function generateDarknessDesignFloor(): DarknessDesignGeneration {
  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 1 };

  world.wallTex.fill(Tex.DARK);
  world.floorTex.fill(Tex.F_CONCRETE);

  const { roomsByKey, labels } = buildRooms(world);
  const entry = roomsByKey.get('entry')!;
  const spawnX = entry.x + 2.5;
  const spawnY = entry.y + (entry.h >> 1) + 0.5;

  applyDarknessZones(world);
  placeContent(world, entities, nextId, roomsByKey);
  registerDarknessRouteCues(world, roomsByKey);
  ensureConnectivity(world, spawnX, spawnY);
  const topology = buildDarknessTopologyPlan(world, roomsByKey, labels);
  blackoutDarknessLights(world);

  const darknessState = initialState(labels, topology);
  darknessStateByWorld.set(world, darknessState);

  return { world, entities, spawnX, spawnY, darknessState };
}
