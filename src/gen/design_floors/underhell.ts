/* ── Underhell design floor: ritual thresholds below Hell ─────── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal, Cell, ContainerKind, DoorState, EntityType, Faction, Feature,
  FloorLevel, LiftDirection, MonsterKind, Occupation, QuestType, RoomType,
  Tex, W, ZoneFaction,
  type Entity, type GameState, type Item, type Room, type WorldContainer,
  type WorldEvent, type WorldEventSeverity,
} from '../../core/types';
import { auditReachability, World, type ReachabilityAudit } from '../../core/world';
import { withSeededRandom } from '../../core/rand';
import { HUMAN_TERRITORY_OWNERS, factionToTerritoryOwner } from '../../data/factions';
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { Spr, monsterSpr } from '../../render/sprite_index';
import { publishEvent } from '../../systems/events';
import { registerRouteCue } from '../../systems/route_cues';
import { calcZoneLevel, randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { ensureConnectivity, generateZones, placeDoorAt, stampRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('underhell');

export const DESIGN_FLOOR_ID = 'underhell' as const;
export const UNDERHELL_ROUTE_ID = DESIGN_FLOOR_ID;
export const UNDERHELL_Z = -38;
export const UNDERHELL_DEFAULT_SEED = 19032;

const UNDERHELL_FLOOR = FloorLevel.HELL;
const SPAWN_X = W >> 1;
const SPAWN_Y = W >> 1;
const THRESHOLD_MASK = 0b0000_0000_0000_0111;
const WITNESS_MASK = 0b0000_0000_0001_1000;
const UNDERHELL_THRESHOLD_CHAIN_MIN_SCORE = 9;

export const UNDERHELL_FLAGS = {
  THRESHOLD_HOLY_WATER: 1 << 0,
  THRESHOLD_PASSPORT_STUB: 1 << 1,
  THRESHOLD_BLOOD_HP: 1 << 2,
  WITNESS_RESCUED: 1 << 3,
  WITNESS_SILENCED: 1 << 4,
  DEBT_BURNED: 1 << 5,
  VOID_ANCHOR_BROKEN: 1 << 6,
  VOID_GATE_OPEN: 1 << 7,
} as const;

export type UnderhellWitnessState = 'sealed' | 'rescued' | 'silenced';
export type UnderhellVoidGateState = 'sealed' | 'anchored' | 'open';
export type UnderhellLateWarningId =
  | 'underhell_threshold_price_echo'
  | 'underhell_void_cut_darkness_trace'
  | 'underhell_root_retreat_ledge'
  | 'underhell_lower_retreat_ledge';

export interface UnderhellLateWarning {
  id: UnderhellLateWarningId;
  label: string;
  sourceRoomName: string;
  targetRoomName: string;
  warning: string;
  tags: readonly string[];
}

export interface UnderhellRitualState {
  routeId: typeof UNDERHELL_ROUTE_ID;
  z: typeof UNDERHELL_Z;
  seed: number;
  flags: number;
  entryRoomId: number;
  fallbackRoomId: number;
  thresholdRoomId: number;
  witnessRoomIds: number[];
  witnessDoorCells: number[];
  lowerFallbackRoomId: number;
  debtRoomId: number;
  voidGateRoomId: number;
  debtWellCell: number;
  voidGateCell: number;
  voidAnchorEntityId: number;
  capillaryCells: number;
  tributeFrontCells: number;
  shelterCells: number;
  lateWarningIds: UnderhellLateWarningId[];
}

export interface UnderhellRitualSnapshot {
  thresholdPaid: boolean;
  thresholdCost: UnderhellThresholdCostId | 'none';
  witnessState: UnderhellWitnessState;
  debtBurned: boolean;
  voidGateState: UnderhellVoidGateState;
  flags: number;
}

export interface UnderhellDesignGeneration {
  world: World;
  entities: Entity[];
  spawnX: number;
  spawnY: number;
  ritualState: UnderhellRitualState;
  thresholdChain: UnderhellThresholdChainScore;
}

export interface UnderhellGenerationOptions {
  seed?: number;
  forceOpenVoidGate?: boolean;
}

export type UnderhellThresholdCostId = 'holy_water' | 'passport_stub' | 'blood_35hp';

export type UnderhellThresholdChainRole = 'entry' | 'threat' | 'fallback' | 'reward' | 'exit';

export interface UnderhellThresholdChainNode {
  role: UnderhellThresholdChainRole;
  roomId: number;
  roomName: string;
  x: number;
  y: number;
  reachable: boolean;
}

export interface UnderhellThresholdChainScore {
  routeId: typeof UNDERHELL_ROUTE_ID;
  z: typeof UNDERHELL_Z;
  score: number;
  minScore: number;
  nodes: readonly UnderhellThresholdChainNode[];
  hasRetreat: boolean;
  hasWitnessBranch: boolean;
  hasDebtReward: boolean;
  hasVoidExit: boolean;
  capillaryCells: number;
  tributeFrontCells: number;
  shelterCells: number;
}

interface UnderhellSdfMetrics {
  tributeFrontCells: number;
  shelterCells: number;
}

export interface UnderhellThresholdCost {
  id: UnderhellThresholdCostId;
  label: string;
  flag: number;
  item?: Item;
  hp?: number;
  backlash?: 'identity';
}

export const UNDERHELL_THRESHOLD_COSTS = [
  {
    id: 'holy_water',
    label: '1 фляга воды с церковной печатью',
    flag: UNDERHELL_FLAGS.THRESHOLD_HOLY_WATER,
    item: { defId: 'holy_water', count: 1 },
  },
  {
    id: 'passport_stub',
    label: '1 паспортный корешок',
    flag: UNDERHELL_FLAGS.THRESHOLD_PASSPORT_STUB,
    item: { defId: 'passport_stub', count: 1 },
    backlash: 'identity',
  },
  {
    id: 'blood_35hp',
    label: '35 HP кровью у поста',
    flag: UNDERHELL_FLAGS.THRESHOLD_BLOOD_HP,
    hp: 35,
  },
] as const satisfies readonly UnderhellThresholdCost[];

export const UNDERHELL_LATE_WARNINGS: readonly UnderhellLateWarning[] = [
  {
    id: 'underhell_threshold_price_echo',
    label: 'Цена пропуска возвращается слухом',
    sourceRoomName: 'Пост трех оплат',
    targetRoomName: 'Свидетельские клетки',
    warning: 'Пост берет одну плату сейчас, но свидетельская клетка решает, кто потом расскажет о цене.',
    tags: ['underhell', 'threshold', 'witness', 'warning'],
  },
  {
    id: 'underhell_void_cut_darkness_trace',
    label: 'Разрез к Пустоте оставляет след',
    sourceRoomName: 'Списочная створка',
    targetRoomName: 'Разрез к Пустоте',
    warning: 'Открытый разрез ведет к Пустоте, а позже может оставить мокрый след в темном отсеке.',
    tags: ['underhell', 'void_gate', 'darkness', 'warning'],
  },
  {
    id: 'underhell_root_retreat_ledge',
    label: 'Верхний обратный уступ виден до платы',
    sourceRoomName: 'Корневой вход',
    targetRoomName: 'Обратный уступ',
    warning: 'Обратный уступ и корневая лестница остаются открытыми: если пост слишком громкий, уходи к лифту тем же светом.',
    tags: ['underhell', 'retreat', 'threshold', 'warning'],
  },
  {
    id: 'underhell_lower_retreat_ledge',
    label: 'Нижний уступ не запирает разрез',
    sourceRoomName: 'Культовая пошлинная палата',
    targetRoomName: 'Нижний обратный уступ',
    warning: 'Нижний обратный уступ связывает долг, якорь и разрез: награду можно взять и уйти без прямого боя у створки.',
    tags: ['underhell', 'retreat', 'reward', 'warning'],
  },
];

export const UNDERHELL_DEBUG_ENTRY = {
  routeId: UNDERHELL_ROUTE_ID,
  z: UNDERHELL_Z,
  label: 'Нижний пропускник',
  generator: 'generateUnderhellDesignFloor',
  seed: UNDERHELL_DEFAULT_SEED,
  smokePath: [
    'spawn',
    'Корневой вход',
    'Обратный уступ',
    'Корневая лестница',
    'Пост трех оплат',
    'Культовая пошлинная палата',
    'Свидетельские клетки',
    'Печь долга',
    'Палата якоря',
    'Списочная створка',
    'Разрез к Пустоте',
  ],
} as const;

const THRESHOLD_MARFUSHA_DEF: PlotNpcDef = {
  name: 'Марфуша Постовая',
  isFemale: true,
  faction: Faction.CULTIST,
  occupation: Occupation.PRIEST,
  sprite: Occupation.PRIEST,
  hp: 620, maxHp: 620, money: 6, speed: 0.75,
  inventory: [
    { defId: 'holy_water', count: 1 },
    { defId: 'note', count: 1 },
  ],
  talkLines: [
    'Нижний пропускник не слушает веру. Нужна вода с печатью, корешок паспорта или кровь на мокрой плитке.',
    'Пост принимает три платы: флягу с печатью, паспортный корешок или тридцать пять здоровья прямо здесь.',
    'Платить можно один раз. Второй раз пост спросит у свидетеля, списка или двери.',
  ],
  talkLinesPost: [
    'Пост принял плату. Теперь смотри на клетки: свидетели помнят лишнее.',
    'Если Пустота откроется мягко, не верь мягкости.',
  ],
};

const DEBT_CULTIST_DEF: PlotNpcDef = {
  name: 'Иона Долгожог',
  isFemale: false,
  faction: Faction.CULTIST,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 420, maxHp: 420, money: 88, speed: 0.8,
  inventory: [
    { defId: 'forged_stamp_sheet', count: 1 },
    { defId: 'water_coupon', count: 2 },
  ],
  talkLines: [
    'Рынок 88 и этаж 69 пишут долги разными чернилами. Горят одинаково.',
    'Принеси лист с поддельной печатью. Я сожгу долг, а запах уйдет в журнал как оплата.',
    'Бумага исчезнет сразу. Последствие придет позже, с чужой фамилией.',
  ],
  talkLinesPost: [
    'Печь сыта. Если наверху стало дешевле, значит снизу стало личнее.',
    'Не называй это прощением. Это отсрочка с зубами.',
  ],
};

const WORDLESS_LIQUIDATOR_DEF: PlotNpcDef = {
  name: 'Безмолвный ликвидатор',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 500, maxHp: 500, money: 0, speed: 0.9,
  inventory: [
    { defId: 'ammo_9mm', count: 10 },
    { defId: 'bandage', count: 1 },
    { defId: 'note', count: 1 },
  ],
  talkLines: [
    '...',
    'Он чертит на полу: КЛЕТКА - ДОЛГ - ЯКОРЬ.',
    'На записке: свидетеля можно вывести, можно замолчать. Разница всплывет слухом.',
  ],
  talkLinesPost: [
    'Он кивает на разрез в полу и больше не пишет.',
  ],
};

const FALSE_YAKOV_DEF: PlotNpcDef = {
  name: 'Ложный Яков-эхо',
  isFemale: false,
  faction: Faction.CULTIST,
  occupation: Occupation.SCIENTIST,
  sprite: Occupation.SCIENTIST,
  hp: 260, maxHp: 260, money: 0, speed: 0.95,
  inventory: [
    { defId: 'psi_dust', count: 1 },
    { defId: 'antidep', count: 1 },
  ],
  talkLines: [
    'Яков Давидович бы сказал: не трогай якорь. Поэтому я скажу наоборот.',
    'Разрез откроется, когда пост оплачен, а якорь разбит. Порядок не важен.',
    'Если голос в банке начнет учить тебя фамилии, закрой банку патроном.',
  ],
  talkLinesPost: [
    'Эхо стало короче. Значит, где-то стало пустее.',
  ],
};

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'underhell_threshold_marfusha', THRESHOLD_MARFUSHA_DEF, [
  {
    id: 'underhell_pay_threshold',
    giverNpcId: 'underhell_threshold_marfusha',
    type: QuestType.FETCH,
    desc: 'Марфуша Постовая: «Пост примет одну из трех плат: флягу с церковной печатью, паспортный корешок или 35 HP кровью. Для журнала принеси флягу, остальные цены отмечены в табличке.»',
    targetItem: 'holy_water', targetCount: 1,
    rewardItem: 'psi_stabilizer', rewardCount: 1,
    relationDelta: 8, xpReward: 90,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'underhell_debt_cultist', DEBT_CULTIST_DEF, [
  {
    id: 'underhell_burn_debt',
    giverNpcId: 'underhell_debt_cultist',
    type: QuestType.FETCH,
    desc: 'Иона Долгожог: «Принеси лист с поддельной печатью. Сожжем рыночный долг, но Market 88 и этаж 69 получат слух с плохим хвостом.»',
    targetItem: 'forged_stamp_sheet', targetCount: 1,
    rewardItem: 'water_coupon', rewardCount: 3,
    extraRewards: [{ defId: 'fake_pass', count: 1 }],
    relationDelta: -6, xpReward: 100, moneyReward: 69,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'underhell_wordless_liquidator', WORDLESS_LIQUIDATOR_DEF, [
  {
    id: 'underhell_free_witness',
    giverNpcId: 'underhell_wordless_liquidator',
    type: QuestType.TALK,
    desc: 'Безмолвный ликвидатор просит открыть свидетельскую клетку. Можно вывести свидетеля или замолчать клетку, но оба исхода пишутся событием.',
    targetNpcId: 'underhell_wordless_liquidator',
    rewardItem: 'ammo_9mm', rewardCount: 12,
    extraRewards: [{ defId: 'bandage', count: 2 }],
    relationDelta: 12, xpReward: 80,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'underhell_false_yakov_echo', FALSE_YAKOV_DEF, [
  {
    id: 'underhell_open_void_cut',
    giverNpcId: 'underhell_false_yakov_echo',
    type: QuestType.KILL,
    desc: 'Ложный Яков-эхо: «Разбей идол-якорь в палате якоря. Если пост уже оплачен, разрез к Пустоте откроется сразу.»',
    targetMonsterKind: MonsterKind.IDOL,
    killNeeded: 1,
    rewardItem: 'void_spike', rewardCount: 1,
    relationDelta: 0, xpReward: 160,
  },
]);

export function generateUnderhellDesignFloor(options: UnderhellGenerationOptions = {}): UnderhellDesignGeneration {
  const seed = options.seed ?? UNDERHELL_DEFAULT_SEED;
  return withSeededRandom(seed, () => generateUnderhellDesignFloorSeeded(seed, options.forceOpenVoidGate === true));
}

export function snapshotUnderhellFlags(flags: number): UnderhellRitualSnapshot {
  const thresholdCost = thresholdCostFromFlags(flags);
  const witnessState: UnderhellWitnessState =
    (flags & UNDERHELL_FLAGS.WITNESS_RESCUED) ? 'rescued'
      : (flags & UNDERHELL_FLAGS.WITNESS_SILENCED) ? 'silenced'
        : 'sealed';
  const voidGateState: UnderhellVoidGateState =
    (flags & UNDERHELL_FLAGS.VOID_GATE_OPEN) ? 'open'
      : (flags & UNDERHELL_FLAGS.VOID_ANCHOR_BROKEN) ? 'anchored'
        : 'sealed';
  return {
    thresholdPaid: thresholdCost !== 'none',
    thresholdCost,
    witnessState,
    debtBurned: (flags & UNDERHELL_FLAGS.DEBT_BURNED) !== 0,
    voidGateState,
    flags,
  };
}

export function scoreUnderhellThresholdChain(world: World, ritual: UnderhellRitualState): UnderhellThresholdChainScore {
  const audit = auditReachability(world, world.idx(SPAWN_X, SPAWN_Y));
  const reachableRooms = reachableRoomIds(world, audit);
  const nodes: UnderhellThresholdChainNode[] = [
    underhellChainNode(world, reachableRooms, 'entry', ritual.entryRoomId),
    underhellChainNode(world, reachableRooms, 'threat', ritual.thresholdRoomId),
    underhellChainNode(world, reachableRooms, 'fallback', ritual.fallbackRoomId),
    underhellChainNode(world, reachableRooms, 'reward', ritual.debtRoomId),
    underhellChainNode(world, reachableRooms, 'exit', ritual.voidGateRoomId),
  ];
  const reachableCount = nodes.reduce((sum, node) => sum + (node.reachable ? 1 : 0), 0);
  const hasRetreat = reachableRooms.has(ritual.fallbackRoomId)
    && reachableRooms.has(ritual.lowerFallbackRoomId)
    && ritual.shelterCells >= 18;
  const hasWitnessBranch = ritual.witnessRoomIds.length >= 2
    && ritual.witnessRoomIds.some(roomId => reachableRooms.has(roomId))
    && ritual.witnessDoorCells.some(cell => world.doors.has(cell));
  const hasDebtReward = reachableRooms.has(ritual.debtRoomId) && ritual.debtWellCell >= 0;
  const hasVoidExit = reachableRooms.has(ritual.voidGateRoomId)
    && ritual.voidGateCell >= 0
    && audit.reachable[ritual.voidGateCell] === 1;
  const score =
    reachableCount
    + (hasRetreat ? 1 : 0)
    + (hasWitnessBranch ? 1 : 0)
    + (hasDebtReward ? 1 : 0)
    + (hasVoidExit ? 1 : 0)
    + (ritual.capillaryCells >= 72 ? 1 : 0)
    + (ritual.tributeFrontCells >= 24 && ritual.shelterCells >= 18 ? 1 : 0);

  return {
    routeId: ritual.routeId,
    z: ritual.z,
    score,
    minScore: UNDERHELL_THRESHOLD_CHAIN_MIN_SCORE,
    nodes,
    hasRetreat,
    hasWitnessBranch,
    hasDebtReward,
    hasVoidExit,
    capillaryCells: ritual.capillaryCells,
    tributeFrontCells: ritual.tributeFrontCells,
    shelterCells: ritual.shelterCells,
  };
}

export function payUnderhellThreshold(
  state: GameState,
  player: Entity,
  ritual: UnderhellRitualState,
  costId: UnderhellThresholdCostId,
  world?: World,
): boolean {
  const cost = UNDERHELL_THRESHOLD_COSTS.find(c => c.id === costId) as UnderhellThresholdCost | undefined;
  if (!cost) return false;
  if (cost.item && !consumeInventoryItem(player, cost.item.defId, cost.item.count)) return false;
  if (cost.hp !== undefined) {
    const hp = player.hp ?? 0;
    if (hp <= cost.hp) return false;
    player.hp = hp - cost.hp;
  }

  ritual.flags = (ritual.flags & ~THRESHOLD_MASK) | cost.flag;
  publishEvent(state, {
    type: 'quest_completed',
    floor: UNDERHELL_FLOOR,
    zoneId: world && player ? zoneFor(world, player) : undefined,
    actorId: player.id,
    actorName: player.name,
    actorFaction: player.faction,
    targetName: `Подпорог: ${cost.label}`,
    itemId: cost.item?.defId,
    itemCount: cost.item?.count,
    severity: 3,
    privacy: 'local',
    tags: ['underhell', 'threshold', cost.id],
    data: {
      routeId: ritual.routeId,
      z: ritual.z,
      cost: cost.label,
      hpCost: cost.hp ?? 0,
      flags: ritual.flags,
      warning: 'Порог оплачен. Проверь свидетелей и держи обратный уступ открытым до разреза.',
    },
  });

  if (cost.backlash === 'identity') {
    publishUnderhellBacklash(state, 'identity', 4, player, {
      costId,
      burnedItem: cost.item?.defId ?? '',
      consequence: 'identity_stub_missing',
    });
  }

  if (world) tryOpenUnderhellVoidGate(world, ritual);
  return true;
}

export function resolveUnderhellWitness(
  state: GameState,
  ritual: UnderhellRitualState,
  outcome: Exclude<UnderhellWitnessState, 'sealed'>,
  actor?: Entity,
  world?: World,
): void {
  ritual.flags &= ~WITNESS_MASK;
  ritual.flags |= outcome === 'rescued'
    ? UNDERHELL_FLAGS.WITNESS_RESCUED
    : UNDERHELL_FLAGS.WITNESS_SILENCED;

  if (outcome === 'rescued' && world) openWitnessCells(world, ritual);

  publishEvent(state, {
    type: outcome === 'rescued' ? 'quest_completed' : 'death_seen',
    floor: UNDERHELL_FLOOR,
    zoneId: world && actor ? zoneFor(world, actor) : undefined,
    actorId: actor?.id,
    actorName: actor?.name,
    actorFaction: actor?.faction,
    targetName: outcome === 'rescued' ? 'Свидетельская клетка открыта' : 'Свидетельская клетка замолчала',
    severity: outcome === 'rescued' ? 3 : 4,
    privacy: outcome === 'rescued' ? 'witnessed' : 'secret',
    tags: ['underhell', 'witness', outcome],
    data: {
      routeId: ritual.routeId,
      z: ritual.z,
      flags: ritual.flags,
      consequence: outcome === 'rescued' ? 'witness_can_testify' : 'witness_silenced_backlash',
      warning: outcome === 'rescued'
        ? 'Свидетель вышел. Слух станет публичнее, но клетки больше не держат маршрут.'
        : 'Свидетель замолчал. Цена порога станет тайным поздним слухом.',
    },
  });
}

export function burnUnderhellDebt(
  state: GameState,
  player: Entity,
  ritual: UnderhellRitualState,
  world?: World,
): boolean {
  if (!consumeInventoryItem(player, 'forged_stamp_sheet', 1)) return false;
  ritual.flags |= UNDERHELL_FLAGS.DEBT_BURNED;
  publishUnderhellBacklash(state, 'debt', 5, player, {
    routeId: ritual.routeId,
    z: ritual.z,
    burnedItem: 'forged_stamp_sheet',
    debtClearedFor: ['market_88', 'floor_69'],
    consequence: 'future_collector_knows_player',
  });
  publishEvent(state, {
    type: 'faction_relation_changed',
    floor: UNDERHELL_FLOOR,
    zoneId: world ? zoneFor(world, player) : undefined,
    actorId: player.id,
    actorName: player.name,
    actorFaction: player.faction,
    severity: 4,
    privacy: 'secret',
    tags: ['underhell', 'debt_burn', 'market_88', 'floor_69'],
    data: {
      flags: ritual.flags,
      relationDelta: -6,
      note: 'Debt erased locally; backlash is published for later market/floor hooks.',
      warning: 'Долг сожжен. Рынок и этаж 69 получат слух, но нижний уступ остается путем отхода.',
    },
  });
  return true;
}

export function breakUnderhellVoidAnchor(
  state: GameState,
  ritual: UnderhellRitualState,
  actor?: Entity,
  world?: World,
): boolean {
  ritual.flags |= UNDERHELL_FLAGS.VOID_ANCHOR_BROKEN;
  const opened = world ? tryOpenUnderhellVoidGate(world, ritual) : false;
  publishEvent(state, {
    type: 'quest_completed',
    floor: UNDERHELL_FLOOR,
    zoneId: world && actor ? zoneFor(world, actor) : undefined,
    actorId: actor?.id,
    actorName: actor?.name,
    actorFaction: actor?.faction,
    targetId: ritual.voidAnchorEntityId,
    targetName: 'Идол-якорь нижнего поста',
    severity: opened ? 5 : 4,
    privacy: 'local',
    tags: ['underhell', 'void_gate', opened ? 'open' : 'anchor_broken'],
    data: {
      routeId: ritual.routeId,
      z: ritual.z,
      thresholdPaid: snapshotUnderhellFlags(ritual.flags).thresholdPaid,
      flags: ritual.flags,
      warning: opened
        ? 'Разрез открыт. Забери награду и уходи через нижний уступ или к Пустоте.'
        : 'Якорь сломан, но пост еще не оплачен. Возвращайся к трем платам, отход открыт.',
    },
  });
  return opened;
}

export function canOpenUnderhellVoidGate(flags: number): boolean {
  return (flags & THRESHOLD_MASK) !== 0 && (flags & UNDERHELL_FLAGS.VOID_ANCHOR_BROKEN) !== 0;
}

export function tryOpenUnderhellVoidGate(world: World, ritual: UnderhellRitualState): boolean {
  if (!canOpenUnderhellVoidGate(ritual.flags)) return false;
  openUnderhellVoidGate(world, ritual);
  ritual.flags |= UNDERHELL_FLAGS.VOID_GATE_OPEN;
  return true;
}

export function openUnderhellVoidGate(world: World, ritual: UnderhellRitualState): void {
  const gx = ritual.voidGateCell % W;
  const gy = (ritual.voidGateCell / W) | 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const d2 = dx * dx + dy * dy;
      const ci = world.idx(gx + dx, gy + dy);
      if (d2 <= 2) {
        world.cells[ci] = Cell.FLOOR;
        world.floorTex[ci] = Tex.PORTAL;
        world.wallTex[ci] = 0;
        world.features[ci] = Feature.NONE;
      } else if (world.cells[ci] === Cell.FLOOR) {
        world.floorTex[ci] = Tex.F_VOID;
      }
    }
  }
  world.markCellsDirty();
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFeaturesDirty();
}

export function alignUnderhellAmbientNpcTerritory(world: World, entities: Entity[]): void {
  const cells = underhellTerritorySpawnCells(world);
  const offsets = new Uint16Array(8);
  for (const entity of entities) {
    if (!isUnderhellAmbientNpc(entity) || entity.faction === undefined) continue;
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

function isUnderhellAmbientNpc(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    entity.alive &&
    entity.plotNpcId === undefined &&
    entity.persistentNpcId === undefined &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    entity.faction !== undefined &&
    (entity.name?.startsWith('Нижний пропускник: ветеран ') ?? false);
}

function underhellTerritorySpawnCells(world: World): Map<ZoneFaction, number[]> {
  const cells = new Map<ZoneFaction, number[]>();
  for (const owner of HUMAN_TERRITORY_OWNERS) cells.set(owner, []);
  for (let i = 0; i < W * W; i++) {
    const cell = world.cells[i];
    if (cell !== Cell.FLOOR && cell !== Cell.WATER && cell !== Cell.DOOR) continue;
    if (world.aptMask[i] || world.containerMap.has(i) || world.features[i] === Feature.LIFT_BUTTON) continue;
    const list = cells.get(world.factionControl[i] as ZoneFaction);
    if (list) list.push(i);
  }
  return cells;
}

export function publishUnderhellBacklash(
  state: GameState,
  kind: 'debt' | 'identity',
  severity: WorldEventSeverity,
  actor?: Entity,
  data: Record<string, unknown> = {},
): WorldEvent {
  return publishEvent(state, {
    type: 'rumor_observed',
    floor: UNDERHELL_FLOOR,
    actorId: actor?.id,
    actorName: actor?.name,
    actorFaction: actor?.faction,
    severity,
    privacy: 'secret',
    tags: ['underhell', 'backlash', kind],
    data: {
      routeId: UNDERHELL_ROUTE_ID,
      z: UNDERHELL_Z,
      warning: kind === 'identity'
        ? 'Паспортный корешок сгорел в цене порога. Следующий слух спросит фамилию.'
        : 'Сожженный долг ушел слухом наверх. Это отсрочка, не чистый выход.',
      ...data,
    },
  });
}

export function publishUnderhellLateWarning(
  state: GameState,
  warningId: UnderhellLateWarningId,
  actor?: Entity,
  world?: World,
): WorldEvent {
  const warning = UNDERHELL_LATE_WARNINGS.find(item => item.id === warningId);
  return publishEvent(state, {
    type: 'samosbor_warning',
    floor: UNDERHELL_FLOOR,
    zoneId: world && actor ? zoneFor(world, actor) : undefined,
    actorId: actor?.id,
    actorName: actor?.name,
    actorFaction: actor?.faction,
    severity: 4,
    privacy: 'local',
    tags: ['underhell', 'late_warning', warningId, ...(warning?.tags ?? [])],
    data: {
      routeId: UNDERHELL_ROUTE_ID,
      z: UNDERHELL_Z,
      warningId,
      warning: warning?.warning,
    },
  });
}

function generateUnderhellDesignFloorSeeded(seed: number, forceOpenVoidGate: boolean): UnderhellDesignGeneration {
  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 1 };

  paintBaseUnderhell(world);

  const entry = createUnderhellRoom(world, SPAWN_X - 8, SPAWN_Y - 6, 17, 13, RoomType.COMMON, 'Корневой вход', Tex.GUT, Tex.F_MEAT);
  const fallback = createUnderhellRoom(world, SPAWN_X - 64, SPAWN_Y + 8, 17, 11, RoomType.CORRIDOR, 'Обратный уступ', Tex.MEAT, Tex.F_MEAT);
  const rootStair = createUnderhellRoom(world, SPAWN_X + 48, SPAWN_Y + 8, 17, 11, RoomType.CORRIDOR, 'Корневая лестница', Tex.GUT, Tex.F_GUT);
  const threshold = createUnderhellRoom(world, SPAWN_X - 15, SPAWN_Y + 46, 31, 15, RoomType.HQ, 'Пост трех оплат', Tex.GUT, Tex.F_GUT);
  const witnessA = createUnderhellRoom(world, SPAWN_X - 57, SPAWN_Y + 49, 11, 9, RoomType.STORAGE, 'Свидетельская клетка А', Tex.MEAT, Tex.F_MEAT);
  const witnessB = createUnderhellRoom(world, SPAWN_X + 46, SPAWN_Y + 49, 11, 9, RoomType.STORAGE, 'Свидетельская клетка Б', Tex.MEAT, Tex.F_MEAT);
  const toll = createUnderhellRoom(world, SPAWN_X - 15, SPAWN_Y + 103, 31, 13, RoomType.HQ, 'Культовая пошлинная палата', Tex.MEAT, Tex.F_GUT);
  const debt = createUnderhellRoom(world, SPAWN_X - 80, SPAWN_Y + 132, 21, 15, RoomType.PRODUCTION, 'Печь сожженного долга', Tex.GUT, Tex.F_GUT);
  const chapel = createUnderhellRoom(world, SPAWN_X + 59, SPAWN_Y + 132, 27, 19, RoomType.HQ, 'Палата якоря', Tex.MEAT, Tex.F_GUT);
  const sacrifice = createUnderhellRoom(world, SPAWN_X - 14, SPAWN_Y + 188, 29, 17, RoomType.CORRIDOR, 'Списочная створка', Tex.GUT, Tex.F_MEAT);
  const lowerFallback = createUnderhellRoom(world, SPAWN_X - 69, SPAWN_Y + 195, 19, 11, RoomType.CORRIDOR, 'Нижний обратный уступ', Tex.MEAT, Tex.F_MEAT);
  const gate = createUnderhellRoom(world, SPAWN_X - 11, SPAWN_Y + 252, 23, 15, RoomType.CORRIDOR, 'Разрез к Пустоте', Tex.VOID_WALL, Tex.F_VOID);

  connectRooms(world, entry, threshold, 2, DoorState.HERMETIC_OPEN, Tex.F_GUT);
  connectRooms(world, entry, fallback, 1, DoorState.HERMETIC_OPEN, Tex.F_CONCRETE);
  connectRooms(world, fallback, threshold, 1, DoorState.HERMETIC_OPEN, Tex.F_CONCRETE);
  connectRooms(world, entry, rootStair, 2, DoorState.HERMETIC_OPEN, Tex.F_GUT);
  connectRooms(world, rootStair, threshold, 1, DoorState.HERMETIC_OPEN, Tex.F_GUT);
  const witnessDoorA = connectRooms(world, threshold, witnessA, 1, DoorState.HERMETIC_CLOSED, Tex.F_CONCRETE);
  const witnessDoorB = connectRooms(world, threshold, witnessB, 1, DoorState.HERMETIC_CLOSED, Tex.F_CONCRETE);
  connectRooms(world, threshold, toll, 2, DoorState.CLOSED, Tex.F_GUT);
  connectRooms(world, toll, debt, 2, DoorState.CLOSED, Tex.F_CONCRETE);
  connectRooms(world, toll, chapel, 2, DoorState.CLOSED, Tex.F_CONCRETE);
  connectRooms(world, debt, lowerFallback, 1, DoorState.HERMETIC_OPEN, Tex.F_CONCRETE);
  connectRooms(world, lowerFallback, sacrifice, 1, DoorState.HERMETIC_OPEN, Tex.F_CONCRETE);
  connectRooms(world, chapel, sacrifice, 2, DoorState.HERMETIC_OPEN, Tex.F_GUT);
  connectRooms(world, sacrifice, gate, 2, DoorState.HERMETIC_OPEN, Tex.F_GUT);
  connectRooms(world, lowerFallback, gate, 1, DoorState.HERMETIC_OPEN, Tex.F_CONCRETE);
  carveRootTunnel(world, entry.x + (entry.w >> 1), entry.y - 16, entry.x + (entry.w >> 1), entry.y + (entry.h >> 1), 2, Tex.F_MEAT);
  sinkUnderhellAbyss(world);
  markBridgeCandles(world, entry, fallback, 8);
  markBridgeCandles(world, entry, rootStair, 8);
  markBridgeCandles(world, toll, debt, 7);
  markBridgeCandles(world, toll, chapel, 7);
  markBridgeCandles(world, lowerFallback, gate, 9);

  decorateEntry(world, entry);
  decorateFallbackLedge(world, fallback);
  decorateRootStair(world, rootStair);
  decorateThreshold(world, threshold);
  decorateWitnessCell(world, witnessA, true);
  decorateWitnessCell(world, witnessB, false);
  decorateTollChamber(world, toll);
  const debtWellCell = decorateDebtWell(world, debt);
  decorateInvertedChapel(world, chapel);
  decorateSacrificeGate(world, sacrifice);
  decorateFallbackLedge(world, lowerFallback);
  const voidGateCell = decorateVoidGate(world, gate);
  const capillaryCells = measureUnderhellCapillaryCells(world);
  const sdfMetrics = measureUnderhellSdfMetrics(world, entry, fallback, rootStair, threshold, toll, lowerFallback);

  ensureConnectivity(world, SPAWN_X + 0.5, SPAWN_Y + 0.5);
  generateZones(world);
  retuneUnderhellZones(world);

  const marfushaId = spawnUnderhellNpc(world, entities, nextId, threshold, THRESHOLD_MARFUSHA_DEF, 'underhell_threshold_marfusha', 15, 7, Math.PI);
  const debtCultistId = spawnUnderhellNpc(world, entities, nextId, debt, DEBT_CULTIST_DEF, 'underhell_debt_cultist', 5, 7, 0);
  const liquidatorId = spawnUnderhellNpc(world, entities, nextId, witnessA, WORDLESS_LIQUIDATOR_DEF, 'underhell_wordless_liquidator', 4, 4, Math.PI / 2);
  const echoId = spawnUnderhellNpc(world, entities, nextId, chapel, FALSE_YAKOV_DEF, 'underhell_false_yakov_echo', 13, 4, Math.PI);
  void marfushaId;
  void debtCultistId;
  void liquidatorId;
  void echoId;

  addUnderhellContainer(world, debt, debt.x + debt.w - 4, debt.y + 2, 'Коптильный сейф долга', Faction.CULTIST, [
    { defId: 'forged_stamp_sheet', count: 1 },
    { defId: 'fake_pass', count: 1 },
    { defId: 'water_coupon', count: 3 },
  ], ['underhell', 'debt_burn', 'market_88', 'floor_69']);

  addItemDrop(entities, nextId, threshold.x + 3, threshold.y + threshold.h - 3, 'holy_water', 1);
  addItemDrop(entities, nextId, threshold.x + threshold.w - 4, threshold.y + threshold.h - 3, 'passport_stub', 1);
  addItemDrop(entities, nextId, fallback.x + 3, fallback.y + fallback.h - 3, 'bandage', 1);
  addItemDrop(entities, nextId, lowerFallback.x + lowerFallback.w - 4, lowerFallback.y + lowerFallback.h - 3, 'filtered_water', 1);
  addItemDrop(entities, nextId, gate.x + 2, gate.y + gate.h - 3, 'bottled_voice', 1);
  addNote(entities, nextId, entry.x + 3, entry.y + 3, 'Нижний пропускник берет одну явную плату: holy_water, passport_stub или blood_35hp. Обратный уступ и корневая лестница ведут к лифту, пока вы не полезли глубже.');
  addNote(entities, nextId, fallback.x + 2, fallback.y + 2, UNDERHELL_LATE_WARNINGS[2].warning);
  addNote(entities, nextId, threshold.x + 5, threshold.y + 3, `${UNDERHELL_LATE_WARNINGS[0].warning} У поста есть боковой отход к обратному уступу.`);
  addNote(entities, nextId, witnessB.x + 4, witnessB.y + 4, 'Свидетель Б молчит. Клетку можно открыть, но можно и оставить его без показаний.');
  addNote(entities, nextId, lowerFallback.x + 3, lowerFallback.y + 2, UNDERHELL_LATE_WARNINGS[3].warning);
  addNote(entities, nextId, sacrifice.x + 4, sacrifice.y + 4, UNDERHELL_LATE_WARNINGS[1].warning);

  spawnUnderhellMonster(world, entities, nextId, MonsterKind.SHADOW, threshold.x + 5, threshold.y + 3, 'Тень у платы', 4);
  spawnUnderhellMonster(world, entities, nextId, MonsterKind.KOSTOREZ, toll.x + toll.w - 5, toll.y + 6, 'Косторез пошлины', 5);
  spawnUnderhellMonster(world, entities, nextId, MonsterKind.SPIRIT, debt.x + 4, debt.y + 6, 'Дым сожженного долга', 5);
  spawnUnderhellMonster(world, entities, nextId, MonsterKind.REBAR, sacrifice.x + 6, sacrifice.y + 8, 'Костяная арматура створки', 5);
  spawnUnderhellMonster(world, entities, nextId, MonsterKind.EYE, gate.x + gate.w - 4, gate.y + 4, 'Глаз разреза', 5);
  const anchorEntityId = spawnUnderhellMonster(world, entities, nextId, MonsterKind.IDOL, chapel.x + 13, chapel.y + 11, 'Идол-якорь нижнего поста', 7);

  const ritualState: UnderhellRitualState = {
    routeId: UNDERHELL_ROUTE_ID,
    z: UNDERHELL_Z,
    seed,
    flags: forceOpenVoidGate ? UNDERHELL_FLAGS.THRESHOLD_HOLY_WATER | UNDERHELL_FLAGS.VOID_ANCHOR_BROKEN : 0,
    entryRoomId: entry.id,
    fallbackRoomId: fallback.id,
    thresholdRoomId: threshold.id,
    witnessRoomIds: [witnessA.id, witnessB.id],
    witnessDoorCells: [...witnessDoorA, ...witnessDoorB].filter(i => i >= 0),
    lowerFallbackRoomId: lowerFallback.id,
    debtRoomId: debt.id,
    voidGateRoomId: gate.id,
    debtWellCell,
    voidGateCell,
    voidAnchorEntityId: anchorEntityId,
    capillaryCells,
    tributeFrontCells: sdfMetrics.tributeFrontCells,
    shelterCells: sdfMetrics.shelterCells,
    lateWarningIds: UNDERHELL_LATE_WARNINGS.map(warning => warning.id),
  };
  if (forceOpenVoidGate) tryOpenUnderhellVoidGate(world, ritualState);
  registerUnderhellRouteCues(world, ritualState, entry, fallback, threshold, witnessA, toll, lowerFallback, sacrifice, gate);
  const thresholdChain = scoreUnderhellThresholdChain(world, ritualState);

  world.bakeLights();
  genLog(`[FLOOR19_UNDERHELL] generated ${UNDERHELL_ROUTE_ID} seed ${seed} rooms=${world.rooms.length} gate=${voidGateCell} chain=${thresholdChain.score}/${thresholdChain.minScore}`);

  return {
    world,
    entities,
    spawnX: SPAWN_X + 0.5,
    spawnY: SPAWN_Y + 0.5,
    ritualState,
    thresholdChain,
  };
}

function registerUnderhellRouteCues(
  world: World,
  ritual: UnderhellRitualState,
  entry: Room,
  fallback: Room,
  threshold: Room,
  witness: Room,
  toll: Room,
  lowerFallback: Room,
  sacrifice: Room,
  gate: Room,
): void {
  const entryMarkerX = entry.x + (entry.w >> 1) + 0.5;
  const entryMarkerY = entry.y + (entry.h >> 1) + 0.5;
  const fallbackTargetX = fallback.x + (fallback.w >> 1) + 0.5;
  const fallbackTargetY = fallback.y + (fallback.h >> 1) + 0.5;
  const entryCell = world.idx(Math.floor(entryMarkerX), Math.floor(entryMarkerY));
  registerRouteCue(world, {
    id: 'underhell_root_retreat_ledge',
    x: entryMarkerX,
    y: entryMarkerY,
    targetX: fallbackTargetX,
    targetY: fallbackTargetY,
    floor: UNDERHELL_FLOOR,
    roomId: entry.id,
    targetRoomId: fallback.id,
    zoneId: world.zoneMap[entryCell],
    label: 'верхний отход',
    hint: 'обратный уступ и корневая лестница ведут назад к лифту',
    targetName: 'обратный уступ',
    color: '#9cf',
    tags: ['underhell', 'retreat', 'threshold', 'warning'],
    toneSeed: ritual.seed + entry.id * 19 + fallback.id,
    radius: 10,
    targetRadius: 4,
    cooldownSec: 42,
    heardText: 'Корневой вход показывает обратный уступ: до платы отметь путь к лифту.',
    followedText: 'Обратный уступ найден. Тут есть перевязка и короткий возврат к корневому входу.',
    ignoredText: 'Пост трех оплат впереди, но верхний отход не проверен.',
  });

  const thresholdMarkerX = threshold.x + (threshold.w >> 1) + 0.5;
  const thresholdMarkerY = threshold.y + 3.5;
  const witnessTargetX = witness.x + 4.5;
  const witnessTargetY = witness.y + 4.5;
  const thresholdCell = world.idx(Math.floor(thresholdMarkerX), Math.floor(thresholdMarkerY));
  registerRouteCue(world, {
    id: 'underhell_threshold_price_echo',
    x: thresholdMarkerX,
    y: thresholdMarkerY,
    targetX: witnessTargetX,
    targetY: witnessTargetY,
    floor: UNDERHELL_FLOOR,
    roomId: threshold.id,
    targetRoomId: witness.id,
    zoneId: world.zoneMap[thresholdCell],
    label: 'цена пропуска',
    hint: 'свидетели знают, чем платили',
    targetName: 'свидетельская клетка',
    color: '#f88',
    tags: ['underhell', 'late_warning', 'threshold', 'witness'],
    toneSeed: threshold.id * 1901 + witness.id,
    radius: 9,
    targetRadius: 3,
    cooldownSec: 40,
    heardText: 'У поста скребет решетка: после оплаты реши, что делать со свидетелем.',
    followedText: 'Свидетельская клетка найдена. Ее можно открыть, замолчать или оставить долг расти.',
    ignoredText: 'Цена пропуска ушла в журнал. Свидетель останется чужим поздним слухом.',
  });

  const lowerMarkerX = toll.x + (toll.w >> 1) + 0.5;
  const lowerMarkerY = toll.y + (toll.h >> 1) + 0.5;
  const lowerTargetX = lowerFallback.x + (lowerFallback.w >> 1) + 0.5;
  const lowerTargetY = lowerFallback.y + (lowerFallback.h >> 1) + 0.5;
  const lowerCell = world.idx(Math.floor(lowerMarkerX), Math.floor(lowerMarkerY));
  registerRouteCue(world, {
    id: 'underhell_lower_retreat_ledge',
    x: lowerMarkerX,
    y: lowerMarkerY,
    targetX: lowerTargetX,
    targetY: lowerTargetY,
    floor: UNDERHELL_FLOOR,
    roomId: toll.id,
    targetRoomId: lowerFallback.id,
    zoneId: world.zoneMap[lowerCell],
    label: 'нижний отход',
    hint: 'долг, якорь и разрез сходятся через уступ с водой',
    targetName: 'нижний обратный уступ',
    color: '#9fd',
    tags: ['underhell', 'retreat', 'reward', 'warning'],
    toneSeed: ritual.seed + toll.id * 23 + lowerFallback.id,
    radius: 10,
    targetRadius: 4,
    cooldownSec: 44,
    heardText: 'Пошлинная палата шуршит списком: нижний уступ связывает долг, якорь и отход.',
    followedText: 'Нижний обратный уступ найден. Вода здесь не победа, а право развернуться.',
    ignoredText: 'Долг, якорь и разрез остались впереди без проверенного нижнего отхода.',
  });

  const gateMarkerX = sacrifice.x + (sacrifice.w >> 1) + 0.5;
  const gateMarkerY = sacrifice.y + sacrifice.h - 4 + 0.5;
  const gateTargetX = gate.x + (gate.w >> 1) + 0.5;
  const gateTargetY = gate.y + (gate.h >> 1) + 0.5;
  const gateCell = world.idx(Math.floor(gateMarkerX), Math.floor(gateMarkerY));
  registerRouteCue(world, {
    id: 'underhell_void_cut_darkness_trace',
    x: gateMarkerX,
    y: gateMarkerY,
    targetX: gateTargetX,
    targetY: gateTargetY,
    floor: UNDERHELL_FLOOR,
    roomId: sacrifice.id,
    targetRoomId: gate.id,
    zoneId: world.zoneMap[gateCell],
    label: 'разрез после поста',
    hint: 'створка ведет к Пустоте и темному отсеку',
    targetName: 'разрез к Пустоте',
    color: '#f4a',
    tags: ['underhell', 'void_gate', 'darkness', 'warning'],
    toneSeed: ritual.seed + ritual.voidGateCell,
    radius: 10,
    targetRadius: 4,
    cooldownSec: 44,
    heardText: 'Списочная створка предупреждает: короткий разрез к Пустоте оставит мокрый след позже.',
    followedText: 'Разрез найден. Открыть его можно, но в темном отсеке останется след оплаченного маршрута.',
    ignoredText: 'Разрез остался позади. Темный отсек пока не получил этот след.',
  });
}

function thresholdCostFromFlags(flags: number): UnderhellThresholdCostId | 'none' {
  for (const cost of UNDERHELL_THRESHOLD_COSTS) {
    if ((flags & cost.flag) !== 0) return cost.id;
  }
  return 'none';
}

function consumeInventoryItem(entity: Entity, defId: string, count: number): boolean {
  if (!entity.inventory) return false;
  let remaining = count;
  for (const item of entity.inventory) {
    if (item.defId === defId) remaining -= item.count;
  }
  if (remaining > 0) return false;

  let need = count;
  for (let i = entity.inventory.length - 1; i >= 0 && need > 0; i--) {
    const item = entity.inventory[i];
    if (item.defId !== defId) continue;
    const take = Math.min(item.count, need);
    item.count -= take;
    need -= take;
    if (item.count <= 0) entity.inventory.splice(i, 1);
  }
  return true;
}

function zoneFor(world: World, actor: Entity): number {
  return world.zoneMap[world.idx(Math.floor(actor.x), Math.floor(actor.y))];
}

function reachableRoomIds(world: World, audit: ReachabilityAudit): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < world.roomMap.length; i++) {
    if (!audit.reachable[i]) continue;
    const roomId = world.roomMap[i];
    if (roomId >= 0) out.add(roomId);
  }
  return out;
}

function underhellChainNode(
  world: World,
  reachableRooms: ReadonlySet<number>,
  role: UnderhellThresholdChainRole,
  roomId: number,
): UnderhellThresholdChainNode {
  const room = world.rooms[roomId];
  if (!room) {
    return { role, roomId, roomName: '', x: -1, y: -1, reachable: false };
  }
  const center = roomCenter(room);
  return {
    role,
    roomId,
    roomName: room.name,
    x: center.x + 0.5,
    y: center.y + 0.5,
    reachable: reachableRooms.has(roomId),
  };
}

function paintBaseUnderhell(world: World): void {
  for (let i = 0; i < W * W; i++) {
    world.cells[i] = Cell.WALL;
    world.wallTex[i] = (i & 7) === 0 ? Tex.GUT : Tex.MEAT;
    world.floorTex[i] = 0;
    world.features[i] = Feature.NONE;
  }
}

function createUnderhellRoom(
  world: World,
  x: number,
  y: number,
  w: number,
  h: number,
  type: RoomType,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
): Room {
  const room = stampRoom(world, world.rooms.length, type, world.wrap(x), world.wrap(y), w, h, -1);
  room.name = name;
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  paintRoomSkin(world, room, wallTex, floorTex);
  return room;
}

function paintRoomSkin(world: World, room: Room, wallTex: Tex, floorTex: Tex): void {
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) {
        world.floorTex[ci] = floorTex;
        world.wallTex[ci] = 0;
      } else {
        world.wallTex[ci] = wallTex;
      }
    }
  }
}

function connectRooms(world: World, a: Room, b: Room, width: number, state: DoorState, floorTex: Tex = Tex.F_GUT): number[] {
  const ac = roomCenter(a);
  const bc = roomCenter(b);
  const ae = roomExitToward(world, a, bc.x, bc.y);
  const be = roomExitToward(world, b, ac.x, ac.y);
  placeDoorAt(world, ae.doorX, ae.doorY, a.id);
  placeDoorAt(world, be.doorX, be.doorY, b.id);
  configureDoor(world, a, ae.doorX, ae.doorY, state);
  configureDoor(world, b, be.doorX, be.doorY, state);
  carveRootTunnel(world, ae.outX, ae.outY, be.outX, be.outY, width, floorTex);
  return [world.idx(ae.doorX, ae.doorY), world.idx(be.doorX, be.doorY)];
}

function roomCenter(room: Room): { x: number; y: number } {
  return { x: room.x + (room.w >> 1), y: room.y + (room.h >> 1) };
}

function roomExitToward(world: World, room: Room, tx: number, ty: number): { doorX: number; doorY: number; outX: number; outY: number } {
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  const dx = world.delta(cx, tx);
  const dy = world.delta(cy, ty);
  if (Math.abs(dx) >= Math.abs(dy)) {
    const doorY = world.wrap(cy);
    if (dx >= 0) return { doorX: world.wrap(room.x + room.w), doorY, outX: world.wrap(room.x + room.w + 1), outY: doorY };
    return { doorX: world.wrap(room.x - 1), doorY, outX: world.wrap(room.x - 2), outY: doorY };
  }
  const doorX = world.wrap(cx);
  if (dy >= 0) return { doorX, doorY: world.wrap(room.y + room.h), outX: doorX, outY: world.wrap(room.y + room.h + 1) };
  return { doorX, doorY: world.wrap(room.y - 1), outX: doorX, outY: world.wrap(room.y - 2) };
}

function configureDoor(world: World, room: Room, x: number, y: number, state: DoorState): void {
  const ci = world.idx(x, y);
  world.wallTex[ci] = Tex.DOOR_METAL;
  const door = world.doors.get(ci);
  if (!door) return;
  door.state = state;
  door.keyId = '';
  if (!room.doors.includes(ci)) room.doors.push(ci);
}

function carveRootTunnel(world: World, ax: number, ay: number, bx: number, by: number, width: number, floorTex: Tex): void {
  const ddx = world.delta(ax, bx);
  const ddy = world.delta(ay, by);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(ddx), Math.abs(ddy))));
  const len = Math.max(1, Math.sqrt(ddx * ddx + ddy * ddy));
  const nx = -ddy / len;
  const ny = ddx / len;
  const carved: number[] = [];

  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const wiggle = Math.sin((step + ax * 0.17 + by * 0.11) * 0.45) * width * 0.55;
    const x = world.wrap(Math.round(ax + ddx * t + nx * wiggle));
    const y = world.wrap(Math.round(ay + ddy * t + ny * wiggle));
    carveDisc(world, x, y, width, floorTex, carved);
  }

  for (const ci of carved) {
    const x = ci % W;
    const y = (ci / W) | 0;
    for (let dy2 = -1; dy2 <= 1; dy2++) {
      for (let dx2 = -1; dx2 <= 1; dx2++) {
        const ni = world.idx(x + dx2, y + dy2);
        if (world.cells[ni] === Cell.WALL) world.wallTex[ni] = Tex.GUT;
      }
    }
  }
}

function carveDisc(world: World, cx: number, cy: number, radius: number, floorTex: Tex, carved: number[]): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius + 1) continue;
      const ci = world.idx(cx + dx, cy + dy);
      if (world.cells[ci] === Cell.LIFT) continue;
      if (world.roomMap[ci] >= 0) continue;
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = floorTex;
      world.wallTex[ci] = 0;
      world.features[ci] = Feature.NONE;
      carved.push(ci);
    }
  }
}

function sinkUnderhellAbyss(world: World): void {
  const cy = SPAWN_Y + 126;
  for (let y = SPAWN_Y - 46; y <= SPAWN_Y + 284; y++) {
    for (let x = SPAWN_X - 122; x <= SPAWN_X + 122; x++) {
      const dx = world.delta(SPAWN_X, x);
      const dy = world.delta(cy, y);
      const mainBasin = (dx * dx) / (120 * 120) + (dy * dy) / (205 * 205) <= 1;
      const leftBasin = (world.delta(SPAWN_X - 58, x) ** 2) / (74 * 74) + (world.delta(SPAWN_Y + 116, y) ** 2) / (132 * 132) <= 1;
      const rightBasin = (world.delta(SPAWN_X + 58, x) ** 2) / (74 * 74) + (world.delta(SPAWN_Y + 116, y) ** 2) / (132 * 132) <= 1;
      if (!mainBasin && !leftBasin && !rightBasin) continue;
      const ci = world.idx(x, y);
      if (world.cells[ci] !== Cell.WALL || touchesRoomInterior(world, x, y)) continue;
      world.cells[ci] = Cell.ABYSS;
      world.roomMap[ci] = -1;
      world.wallTex[ci] = Tex.DARK;
      world.floorTex[ci] = Tex.F_ABYSS;
      world.features[ci] = Feature.NONE;
    }
  }
}

function touchesRoomInterior(world: World, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (world.roomMap[world.idx(x + dx, y + dy)] >= 0) return true;
    }
  }
  return false;
}

function markBridgeCandles(world: World, a: Room, b: Room, interval: number): void {
  const ac = roomCenter(a);
  const bc = roomCenter(b);
  const ddx = world.delta(ac.x, bc.x);
  const ddy = world.delta(ac.y, bc.y);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(ddx), Math.abs(ddy))));
  for (let step = interval; step < steps; step += interval) {
    const x = world.wrap(Math.round(ac.x + ddx * (step / steps)));
    const y = world.wrap(Math.round(ac.y + ddy * (step / steps)));
    const ci = world.idx(x, y);
    if (world.cells[ci] === Cell.FLOOR && world.roomMap[ci] < 0 && world.features[ci] === Feature.NONE) {
      world.features[ci] = Feature.CANDLE;
    }
  }
}

function decorateEntry(world: World, room: Room): void {
  setFeature(world, room.x + 2, room.y + 2, Feature.LAMP);
  setFeature(world, room.x + room.w - 3, room.y + 2, Feature.CANDLE);
  setFeature(world, room.x + 3, room.y + room.h - 3, Feature.SHELF);
  const liftCell = world.idx(room.x + room.w - 3, room.y + room.h - 3);
  world.cells[liftCell] = Cell.LIFT;
  world.wallTex[liftCell] = Tex.LIFT_DOOR;
  world.liftDir[liftCell] = LiftDirection.UP;
  world.features[world.idx(room.x + room.w - 4, room.y + room.h - 3)] = Feature.LIFT_BUTTON;
  stampSurfaceSplat(world, room.x + (room.w >> 1), room.y + (room.h >> 1), 0.5, 0.5, 5, 130, 19032, 75, 18, 40, false);
}

function decorateFallbackLedge(world: World, room: Room): void {
  setFeature(world, room.x + 2, room.y + 2, Feature.CANDLE);
  setFeature(world, room.x + room.w - 3, room.y + 2, Feature.SHELF);
  setFeature(world, room.x + 2, room.y + room.h - 3, Feature.TABLE);
  stampSurfaceSplat(world, room.x + (room.w >> 1), room.y + (room.h >> 1), 0.5, 0.5, 4, 110, room.id * 19039, 92, 78, 64, false);
}

function decorateRootStair(world: World, room: Room): void {
  for (let i = 2; i < room.w - 2; i += 4) {
    setFeature(world, room.x + i, room.y + 2 + (i & 3), Feature.CANDLE);
  }
  setFeature(world, room.x + room.w - 4, room.y + room.h - 3, Feature.APPARATUS);
  stampSurfaceSplat(world, room.x + (room.w >> 1), room.y + (room.h >> 1), 0.5, 0.5, 4, 130, 19040, 54, 24, 18, false);
}

function decorateThreshold(world: World, room: Room): void {
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  setFeature(world, cx, cy, Feature.APPARATUS);
  for (const [dx, dy] of [[-6, -3], [0, -4], [6, -3], [-6, 3], [0, 4], [6, 3]] as const) {
    setFeature(world, cx + dx, cy + dy, Feature.CANDLE);
  }
  setFeature(world, room.x + 3, room.y + room.h - 3, Feature.SINK);
  setFeature(world, room.x + room.w - 4, room.y + room.h - 3, Feature.DESK);
  stampSurfaceSplat(world, cx, cy, 0.5, 0.5, 6, 160, 19033, 90, 12, 60, false);
}

function decorateWitnessCell(world: World, room: Room, lit: boolean): void {
  setFeature(world, room.x + 2, room.y + 2, lit ? Feature.LAMP : Feature.CANDLE);
  setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.BED);
  setFeature(world, room.x + 2, room.y + room.h - 3, Feature.TABLE);
  stampSurfaceSplat(world, room.x + (room.w >> 1), room.y + (room.h >> 1), 0.5, 0.5, 3, 110, lit ? 19034 : 19035, 40, 35, 35, false);
}

function decorateTollChamber(world: World, room: Room): void {
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  setFeature(world, cx, cy, Feature.DESK);
  setFeature(world, room.x + 4, cy, Feature.SHELF);
  setFeature(world, room.x + room.w - 5, cy, Feature.APPARATUS);
  for (const [dx, dy] of [[-9, -4], [-3, 4], [3, 4], [9, -4]] as const) {
    setFeature(world, cx + dx, cy + dy, Feature.CANDLE);
  }
  stampSurfaceSplat(world, cx, cy, 0.5, 0.5, 5, 130, 19041, 86, 16, 18, false);
}

function decorateDebtWell(world: World, room: Room): number {
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  setFeature(world, room.x + 2, room.y + 2, Feature.APPARATUS);
  setFeature(world, room.x + room.w - 3, room.y + 2, Feature.SHELF);
  setFeature(world, room.x + 2, room.y + room.h - 3, Feature.CANDLE);
  setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.CANDLE);
  addBlackWell(world, cx, cy, 2);
  return world.idx(cx, cy);
}

function decorateInvertedChapel(world: World, room: Room): void {
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  for (let dx = 3; dx < room.w - 3; dx += 3) setFeature(world, room.x + dx, room.y + 2, Feature.CANDLE);
  for (let dx = 3; dx < room.w - 3; dx += 3) setFeature(world, room.x + dx, room.y + room.h - 3, Feature.CANDLE);
  setFeature(world, cx, cy + 5, Feature.APPARATUS);
  setFeature(world, cx, cy - 5, Feature.SCREEN);
  world.wallTex[world.idx(cx, room.y - 1)] = Tex.ICON;
  stampSurfaceSplat(world, cx, cy + 4, 0.5, 0.5, 7, 140, 19036, 110, 18, 45, false);
}

function decorateSacrificeGate(world: World, room: Room): void {
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  setFeature(world, cx - 8, cy - 4, Feature.SINK);
  setFeature(world, cx, cy - 5, Feature.DESK);
  setFeature(world, cx + 8, cy - 4, Feature.APPARATUS);
  setFeature(world, cx - 8, cy + 5, Feature.CANDLE);
  setFeature(world, cx, cy + 5, Feature.CANDLE);
  setFeature(world, cx + 8, cy + 5, Feature.CANDLE);
  addBlackWell(world, cx, cy, 1);
  stampSurfaceSplat(world, cx, cy, 0.5, 0.5, 6, 150, 19042, 120, 28, 24, false);
}

function decorateVoidGate(world: World, room: Room): number {
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  setFeature(world, cx, cy - 4, Feature.CANDLE);
  setFeature(world, cx - 5, cy, Feature.CANDLE);
  setFeature(world, cx + 5, cy, Feature.CANDLE);
  setFeature(world, cx, cy + 4, Feature.APPARATUS);
  world.floorTex[world.idx(cx, cy)] = Tex.F_ABYSS;
  stampSurfaceSplat(world, cx, cy, 0.5, 0.5, 6, 180, 19037, 5, 80, 70, false);
  return world.idx(cx, cy);
}

function addBlackWell(world: World, cx: number, cy: number, radius: number): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const ci = world.idx(cx + dx, cy + dy);
      world.cells[ci] = Cell.ABYSS;
      world.floorTex[ci] = Tex.F_ABYSS;
      world.wallTex[ci] = 0;
      world.features[ci] = Feature.NONE;
    }
  }
}

function measureUnderhellCapillaryCells(world: World): number {
  let count = 0;
  for (let y = SPAWN_Y - 52; y <= SPAWN_Y + 284; y++) {
    for (let x = SPAWN_X - 132; x <= SPAWN_X + 132; x++) {
      const ci = world.idx(x, y);
      if (!isUnderhellWalkableCell(world, ci) || world.roomMap[ci] >= 0) continue;
      const floorTex = world.floorTex[ci];
      if (floorTex === Tex.F_GUT || floorTex === Tex.F_MEAT || floorTex === Tex.F_CONCRETE || floorTex === Tex.F_VOID) {
        count++;
      }
    }
  }
  return count;
}

function measureUnderhellSdfMetrics(
  world: World,
  entry: Room,
  fallback: Room,
  rootStair: Room,
  threshold: Room,
  toll: Room,
  lowerFallback: Room,
): UnderhellSdfMetrics {
  const tributeRooms = [threshold, toll];
  const shelterRooms = [entry, fallback, rootStair, lowerFallback];
  let tributeFrontCells = 0;
  let shelterCells = 0;

  for (let y = SPAWN_Y - 24; y <= SPAWN_Y + 220; y++) {
    for (let x = SPAWN_X - 96; x <= SPAWN_X + 96; x++) {
      const ci = world.idx(x, y);
      if (!isUnderhellWalkableCell(world, ci)) continue;
      const tributeD2 = minRoomCenterDist2(world, x + 0.5, y + 0.5, tributeRooms);
      const shelterD2 = minRoomCenterDist2(world, x + 0.5, y + 0.5, shelterRooms);
      if (tributeD2 <= 32 * 32 && tributeD2 <= shelterD2 * 1.18) tributeFrontCells++;
      if (shelterD2 <= 24 * 24 && shelterD2 < tributeD2) shelterCells++;
    }
  }

  return { tributeFrontCells, shelterCells };
}

function minRoomCenterDist2(world: World, x: number, y: number, rooms: readonly Room[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const room of rooms) {
    const center = roomCenter(room);
    const d2 = world.dist2(x, y, center.x + 0.5, center.y + 0.5);
    if (d2 < best) best = d2;
  }
  return best;
}

function isUnderhellWalkableCell(world: World, ci: number): boolean {
  const cell = world.cells[ci];
  return cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.LIFT;
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = feature;
}

function retuneUnderhellZones(world: World): void {
  for (const zone of world.zones) {
    zone.level = calcZoneLevel(zone.cx, zone.cy, FloorLevel.HELL) + 5;
    const roll = Math.abs(Math.sin((zone.cx * 12.9898 + zone.cy * 78.233 + 19) * 0.01));
    zone.faction = roll < 0.62 ? ZoneFaction.CULTIST : roll < 0.84 ? ZoneFaction.WILD : ZoneFaction.LIQUIDATOR;
    zone.hqRoomId = -1;
  }
}

function spawnUnderhellNpc(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  room: Room,
  _def: PlotNpcDef,
  plotNpcId: string,
  dx: number,
  dy: number,
  angle: number,
): number {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle,
    canGiveQuest: true,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
    extra: {
      rpg: { level: 12, xp: 0, attrPoints: 0, str: 5, agi: 4, int: 5, psi: 20, maxPsi: 20 },
    },
  });
  return npc.id;
}

function spawnUnderhellMonster(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  kind: MonsterKind,
  x: number,
  y: number,
  name: string,
  bonusLevel: number,
): number {
  const def = MONSTERS[kind];
  const zoneLevel = world.zones[world.zoneMap[world.idx(x, y)]]?.level ?? 12;
  const level = zoneLevel + bonusLevel;
  const hp = Math.round(scaleMonsterHp(def.hp, level));
  const id = nextId.v++;
  entities.push({
    id,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: kind === MonsterKind.IDOL ? 0 : scaleMonsterSpeed(def.speed, level),
    sprite: monsterSpr(kind),
    name,
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
    phasing: kind === MonsterKind.SPIRIT,
    spriteScale: kind === MonsterKind.IDOL ? 1.25 : undefined,
  });
  return id;
}

function addUnderhellContainer(
  world: World,
  room: Room,
  x: number,
  y: number,
  name: string,
  faction: Faction,
  inventory: Item[],
  tags: string[],
): void {
  const id = world.containers.reduce((mx, c) => Math.max(mx, c.id), 0) + 1;
  const container: WorldContainer = {
    id,
    x,
    y,
    floor: UNDERHELL_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind: ContainerKind.SAFE,
    name,
    inventory,
    capacitySlots: 6,
    faction,
    access: 'faction',
    lockDifficulty: 4,
    discovered: true,
    tags,
  };
  world.addContainer(container);
  setFeature(world, x, y, Feature.SHELF);
}

function addItemDrop(
  entities: Entity[],
  nextId: { v: number },
  x: number,
  y: number,
  defId: string,
  count: number,
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
    inventory: [{ defId, count }],
  });
}

function addNote(entities: Entity[], nextId: { v: number }, x: number, y: number, text: string): void {
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
    inventory: [{ defId: 'note', count: 1, data: { text } }],
  });
}

function openWitnessCells(world: World, ritual: UnderhellRitualState): void {
  for (const doorCell of ritual.witnessDoorCells) {
    const door = world.doors.get(doorCell);
    if (door) {
      door.state = DoorState.HERMETIC_OPEN;
      door.timer = 0;
    }
    world.cells[doorCell] = Cell.DOOR;
    world.wallTex[doorCell] = Tex.DOOR_METAL;
  }
}
