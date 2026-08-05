/* -- Design floor: bank_floor - cash desks, debt and vault risk -- */

import {
  Cell,
  ContainerKind,
  DoorState,
  Faction,
  Feature,
  FloorLevel,
  LiftDirection,
  Occupation,
  QuestType,
  RoomType,
  Tex,
  W,
  ZoneFaction,
  type TerritoryOwner,
  type Entity,
  type GameState,
  type Item,
  type Room,
  type WorldContainer,
  type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { publishEvent } from '../../systems/events';
import { setTerritoryOwnerAtIndex, syncZoneMetadataFromTerritory } from '../../systems/territory';
import { canPlaceRoom, stampRoom } from '../shared';
import type { FloorGeneration } from '../floor_manifest';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('bank_floor');

export const BANK_FLOOR_ROUTE_ID = 'bank_floor' as const;
export const BANK_FLOOR_Z = 26;
export const BANK_FLOOR_BASE_FLOOR = FloorLevel.MINISTRY;

export const BANK_ROOM_NAMES = {
  liftLobby: 'Лифтовый вестибюль банка Б-22',
  hall: 'Главный кассовый зал банка Б-22',
  teller: 'Кассовая линия банка Б-22',
  deposit: 'Депозитный ряд банка Б-22',
  credit: 'Кредитное окно банка Б-22',
  queue: 'Очередь должников банка Б-22',
  vault: 'Хранилище кассовых ячеек Б-22',
  bypass: 'Черный служебный обход банка Б-22',
  tellerLane: 'Кассовая змейка ожидания Б-22',
  debtorCircuit: 'Долговая петля Б-22',
  bribeQueue: 'Нулевая очередь подкупщиков Б-22',
  vaultShell: 'Наружная оболочка хранилища Б-22',
  bypassGate: 'Черный пост служебного обхода Б-22',
} as const;

export const BANK_HQ_ROOM_NAMES = {
  citizen: 'Герметическая комната гражданского баланса Б-22',
  liquidator: 'Герметический пост инкассаторов Б-22',
  cultist: 'Герметическая свечная долгового культа Б-22',
  scientist: 'Герметическая лаборатория счетчиков НИИ Б-22',
  wild: 'Герметическая ночная касса диких Б-22',
} as const;

export const BANK_VAULT_RISK_RADIUS = 96;
export const BANK_VAULT_RISK_INNER_RADIUS = 10;

export interface BankVaultRiskSource {
  x: number;
  y: number;
  radius: number;
}

export const BANK_FLOOR_META = {
  routeId: BANK_FLOOR_ROUTE_ID,
  displayName: 'Банковский этаж',
  z: BANK_FLOOR_Z,
  baseFloor: BANK_FLOOR_BASE_FLOOR,
  // Bank B-22 lives in the Ministry band because money here is paperwork first:
  // accounts, stamped debt, audits and liquidator-backed vault rules.
  baseReason: 'ministry_bureaucratic_finance',
  debugEntry: 'generateBankFloorDesignFloor()',
} as const;

export interface BankFloorState {
  routeId: typeof BANK_FLOOR_ROUTE_ID;
  anchorZ: typeof BANK_FLOOR_Z;
  baseFloor: typeof BANK_FLOOR_BASE_FLOOR;
  legalRooms: string[];
  riskRooms: string[];
  debtCircuitRooms: string[];
  vaultContainerIds: number[];
  depositContainerIds: number[];
  vaultRiskRadius: number;
  debugEntry: {
    spawnX: number;
    spawnY: number;
    summary: string;
  };
}

export interface BankFloorGeneration extends FloorGeneration {
  bankState: BankFloorState;
}

type BankActionKind = 'deposit' | 'loan' | 'repay' | 'forgery' | 'vault_theft';

const BANK_TAGS = ['banking', BANK_FLOOR_ROUTE_ID];

interface BankMicroBlockSpec {
  name: string;
  type: RoomType;
  x: number;
  y: number;
  w: number;
  h: number;
  count: number;
  stepX: number;
  stepY: number;
  wallTex: Tex;
  floorTex: Tex;
}

interface BankHqClusterSpec {
  owner: TerritoryOwner;
  hqName: string;
  x: number;
  y: number;
  w: number;
  h: number;
  wallTex: Tex;
  floorTex: Tex;
  support: readonly Omit<BankMicroBlockSpec, 'count' | 'stepX' | 'stepY'>[];
}

const BANK_HQ_CLUSTERS: readonly BankHqClusterSpec[] = [
  {
    owner: ZoneFaction.CITIZEN,
    hqName: BANK_HQ_ROOM_NAMES.citizen,
    x: 156,
    y: 438,
    w: 28,
    h: 20,
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_PARQUET,
    support: [
      { name: 'Общая банка гражданского штаба Б-22', type: RoomType.COMMON, x: 156, y: 410, w: 26, h: 16, wallTex: Tex.MARBLE, floorTex: Tex.F_MARBLE_TILE },
      { name: 'Кухня гражданского баланса Б-22', type: RoomType.KITCHEN, x: 156, y: 466, w: 24, h: 16, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      { name: 'Санузел гражданского баланса Б-22', type: RoomType.BATHROOM, x: 190, y: 438, w: 16, h: 14, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      { name: 'Склад квитанций гражданского баланса Б-22', type: RoomType.STORAGE, x: 84, y: 438, w: 24, h: 16, wallTex: Tex.PANEL, floorTex: Tex.F_LINO },
    ],
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    hqName: BANK_HQ_ROOM_NAMES.liquidator,
    x: 832,
    y: 436,
    w: 30,
    h: 22,
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_CONCRETE,
    support: [
      { name: 'Оружейный шкаф инкассаторов Б-22', type: RoomType.STORAGE, x: 928, y: 436, w: 24, h: 16, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
      { name: 'Медпункт инкассаторов Б-22', type: RoomType.MEDICAL, x: 832, y: 464, w: 26, h: 16, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      { name: 'Дежурка инкассаторов Б-22', type: RoomType.OFFICE, x: 832, y: 408, w: 28, h: 16, wallTex: Tex.METAL, floorTex: Tex.F_GREEN_CARPET },
      { name: 'Склад пломб инкассаторов Б-22', type: RoomType.STORAGE, x: 768, y: 436, w: 24, h: 16, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
    ],
  },
  {
    owner: ZoneFaction.CULTIST,
    hqName: BANK_HQ_ROOM_NAMES.cultist,
    x: 744,
    y: 764,
    w: 26,
    h: 20,
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_RED_CARPET,
    support: [
      { name: 'Свечная книга долгов Б-22', type: RoomType.COMMON, x: 744, y: 792, w: 28, h: 16, wallTex: Tex.DARK, floorTex: Tex.F_CARPET },
      { name: 'Кладовая восковых процентов Б-22', type: RoomType.STORAGE, x: 708, y: 764, w: 26, h: 16, wallTex: Tex.DARK, floorTex: Tex.F_CONCRETE },
      { name: 'Курилка долгового культа Б-22', type: RoomType.SMOKING, x: 780, y: 764, w: 26, h: 16, wallTex: Tex.PANEL, floorTex: Tex.F_LINO },
      { name: 'Санузел свечной очереди Б-22', type: RoomType.BATHROOM, x: 680, y: 710, w: 18, h: 14, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
    ],
  },
  {
    owner: ZoneFaction.SCIENTIST,
    hqName: BANK_HQ_ROOM_NAMES.scientist,
    x: 474,
    y: 142,
    w: 28,
    h: 20,
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_CONCRETE,
    support: [
      { name: 'Лаборатория процентного шума Б-22', type: RoomType.PRODUCTION, x: 508, y: 142, w: 30, h: 16, wallTex: Tex.PIPE, floorTex: Tex.F_CONCRETE },
      { name: 'Медкабинет счетчиков НИИ Б-22', type: RoomType.MEDICAL, x: 438, y: 142, w: 26, h: 16, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      { name: 'Кабинет статистики вкладов Б-22', type: RoomType.OFFICE, x: 474, y: 114, w: 30, h: 16, wallTex: Tex.MARBLE, floorTex: Tex.F_PARQUET },
      { name: 'Склад мерных квитанций Б-22', type: RoomType.STORAGE, x: 548, y: 170, w: 26, h: 14, wallTex: Tex.PANEL, floorTex: Tex.F_LINO },
    ],
  },
  {
    owner: ZoneFaction.WILD,
    hqName: BANK_HQ_ROOM_NAMES.wild,
    x: 238,
    y: 764,
    w: 28,
    h: 20,
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_CONCRETE,
    support: [
      { name: 'Кухня ночной кассы Б-22', type: RoomType.KITCHEN, x: 238, y: 792, w: 24, h: 16, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      { name: 'Склад залоговых мешков диких Б-22', type: RoomType.STORAGE, x: 202, y: 764, w: 26, h: 16, wallTex: Tex.BRICK, floorTex: Tex.F_CONCRETE },
      { name: 'Курилка ночной кассы Б-22', type: RoomType.SMOKING, x: 274, y: 764, w: 26, h: 16, wallTex: Tex.PANEL, floorTex: Tex.F_LINO },
      { name: 'Санузел ночной кассы Б-22', type: RoomType.BATHROOM, x: 202, y: 732, w: 18, h: 14, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
    ],
  },
];

const DIRECTOR_DEF: PlotNpcDef = {
  name: 'Зинаида Балансовна',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.DIRECTOR,
  sprite: Occupation.DIRECTOR,
  hp: 150, maxHp: 150, money: 210, speed: 0.75,
  inventory: [
    { defId: 'official_permit_slip', count: 1 },
    { defId: 'ration_registry_extract', count: 1 },
    { defId: 'seal_wax', count: 2 },
  ],
  talkLines: [
    'Деньги без печати - слух. С печатью это уже обязательство, и оно умеет ждать у лифта.',
    'Хранилище открыто глазами, но закрыто ведомостью. Украсть можно. Потом ведомость украдет сон.',
    'Фальшивую долговую бумагу лучше сдавать до того, как она научилась писать вашу фамилию.',
  ],
  talkLinesPost: [
    'Баланс сошелся. В Гигахруще это не победа, а короткая пауза.',
    'Если долг стал тише, не значит, что он ушел. Он просто перешел на внутренний учет.',
  ],
};

const CASHIER_DEF: PlotNpcDef = {
  name: 'Люба Кассир',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 95, maxHp: 95, money: 160, speed: 0.8,
  inventory: [
    { defId: 'voluntary_receipt', count: 2 },
    { defId: 'filter_receipt', count: 1 },
    { defId: 'blank_form', count: 1 },
  ],
  talkLines: [
    'Внести можно наличные. Снять нельзя без очереди, потому что очередь тоже хочет снять.',
    'Касса любит простую арифметику: рубль вошел, бумага вышла, человек стал спокойнее на один коридор.',
    'Не ставьте локти на окно. Предыдущий локоть до сих пор числится залогом.',
  ],
  talkLinesPost: [
    'Ваш взнос лежит там, где деньги становятся строкой.',
    'Квитанцию не мочите. Мокрая бумага считает себя прощенным долгом.',
  ],
};

const CREDIT_DEF: PlotNpcDef = {
  name: 'Прохор Кредитный',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 120, maxHp: 120, money: 320, speed: 0.7,
  inventory: [
    { defId: 'voluntary_receipt', count: 1 },
    { defId: 'bank_debt_paper', count: 1 },
    { defId: 'forged_stamp_sheet', count: 1 },
    { defId: 'ink_bottle', count: 1 },
  ],
  talkLines: [
    'Кредит - это когда банк верит, что вы вернетесь. В нашем доме это почти угроза.',
    'Проценты растут медленнее самосбора, но зато без сирены.',
    'Погасить можно деньгами. Нельзя погасить взгляд ликвидатора у хранилища.',
  ],
  talkLinesPost: [
    'Долг записан. Теперь у вас есть причина вернуться живым.',
    'Погашенная строка пахнет сургучом. Непогашенная - коридором за спиной.',
  ],
};

const GUARD_DEF: PlotNpcDef = {
  name: 'Семен Инкассатор',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 230, maxHp: 230, money: 55, speed: 1.05,
  inventory: [
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 14 },
    { defId: 'liquidator_token', count: 1 },
  ],
  talkLines: [
    'Я охраняю не деньги. Деньги сами кусаются. Я охраняю свидетелей от плохих решений.',
    'В хранилище тихо только до первой чужой руки.',
    'Черный обход существует для сотрудников. Воры тоже сотрудники, просто без ведомости.',
  ],
  talkLinesPost: [
    'Если касса молчит, значит пока все живы.',
    'У сейфа нет настроения. У меня есть.',
  ],
};

const DEBTOR_DEF: PlotNpcDef = {
  name: 'Митя Просрочка',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.TRAVELER,
  sprite: Occupation.TRAVELER,
  hp: 80, maxHp: 80, money: 9, speed: 0.9,
  inventory: [
    { defId: 'forged_bank_debt_paper', count: 1 },
    { defId: 'forged_stamp_sheet', count: 1 },
    { defId: 'cigs', count: 1 },
  ],
  talkLines: [
    'Если бумага похожа на долг, банк сам дорисует остальное.',
    'Я не вор. Я курьер между чужой подписью и своим страхом.',
    'Можно сдать липу управляющей. Можно отдать мне, и касса на минуту станет слепой.',
  ],
  talkLinesPost: [
    'Долг не исчез. Он просто сменил почерк.',
    'Очередь смотрит, будто знает, кто подделал строку.',
  ],
};

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'bank_director_zinaida', DIRECTOR_DEF, [
  {
    id: 'bank_report_forged_debt_paper',
    giverNpcId: 'bank_director_zinaida',
    type: QuestType.FETCH,
    desc: 'Зинаида Балансовна: «Найдете липовую долговую бумагу - сдайте в окно управляющей. Лучше пусть банк злится на бумагу, а не на вас.»',
    targetItem: 'forged_bank_debt_paper', targetCount: 1,
    rewardItem: 'official_permit_slip', rewardCount: 1,
    extraRewards: [{ defId: 'seal_wax', count: 1 }],
    relationDelta: 10, xpReward: 55, moneyReward: 35,
    eventTargetName: 'Фальшивая долговая бумага сдана управляющей банка Б-22.',
    eventTags: [...BANK_TAGS, 'forgery', 'debt_paper', 'report', 'legal'],
    eventData: { bankingAction: 'report_forged_debt_paper', debtRiskClosed: true },
    abandonsSideQuestIds: ['bank_cash_forged_debt_paper'],
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'bank_cashier_lyuba', CASHIER_DEF, [
  {
    id: 'bank_wait_teller_lane',
    giverNpcId: 'bank_cashier_lyuba',
    type: QuestType.VISIT,
    desc: 'Люба Кассир: «Встаньте в кассовую змейку Б-22. Кто дождался окна, тот уже почти внес деньги: банк любит людей, которые умеют стоять.»',
    targetRoomName: BANK_ROOM_NAMES.tellerLane,
    rewardItem: 'voluntary_receipt', rewardCount: 1,
    relationDelta: 4, xpReward: 18, moneyReward: 0,
    eventTargetName: 'Очередь кассовой змейки банка Б-22 выстояна до окна.',
    eventTags: [...BANK_TAGS, 'wait', 'queue', 'legal'],
    eventData: { bankingAction: 'wait_teller_lane', queueProgress: true },
  },
  {
    id: 'bank_cash_deposit_50',
    giverNpcId: 'bank_cashier_lyuba',
    type: QuestType.FETCH,
    desc: 'Люба Кассир: «Пятьдесят рублей в кассу Б-22. На руки дам квитанцию: деньги станут строкой, строка станет спокойнее наличных.»',
    targetItem: 'money', targetCount: 50,
    rewardItem: 'voluntary_receipt', rewardCount: 1,
    extraRewards: [{ defId: 'filter_receipt', count: 1 }],
    relationDelta: 8, xpReward: 45, moneyReward: 6,
    eventTargetName: 'Наличные внесены через кассу банка Б-22.',
    eventTags: [...BANK_TAGS, 'deposit', 'cash_to_account', 'legal'],
    eventData: { bankingAction: 'cash_deposit', amount: 50, fee: 6 },
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'bank_credit_prokhor', CREDIT_DEF, [
  {
    id: 'bank_take_corridor_loan',
    giverNpcId: 'bank_credit_prokhor',
    type: QuestType.VISIT,
    desc: 'Прохор Кредитный: «Встаньте к кредитному окну. Банк выдаст сто двадцать рублей и оставит долг в журнале: вернуть придется больше.»',
    targetRoomName: BANK_ROOM_NAMES.credit,
    rewardItem: 'voluntary_receipt', rewardCount: 1,
    relationDelta: -2, xpReward: 30, moneyReward: 120,
    eventTargetName: 'В банке Б-22 открыт кредитный долг.',
    eventSeverity: 4,
    eventTags: [...BANK_TAGS, 'loan', 'credit', 'debt_opened'],
    eventData: { bankingAction: 'loan_taken', principal: 120, due: 140, visibleAs: 'repay_side_quest' },
  },
  {
    id: 'bank_repay_corridor_loan',
    giverNpcId: 'bank_credit_prokhor',
    type: QuestType.FETCH,
    desc: 'Прохор Кредитный: «Верните сто сорок рублей по кредитной строке Б-22. Проценты не любят героев, они любят календарь.»',
    targetItem: 'money', targetCount: 140,
    rewardItem: 'official_permit_slip', rewardCount: 1,
    relationDelta: 14, xpReward: 65, moneyReward: 0,
    requiresSideQuestDone: 'bank_take_corridor_loan',
    eventTargetName: 'Кредит банка Б-22 погашен наличными.',
    eventTags: [...BANK_TAGS, 'loan', 'repay', 'debt_closed'],
    eventData: { bankingAction: 'loan_repaid', amount: 140, principal: 120 },
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'bank_guard_semyon', GUARD_DEF, []);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'bank_debtor_mitya', DEBTOR_DEF, [
  {
    id: 'bank_cash_forged_debt_paper',
    giverNpcId: 'bank_debtor_mitya',
    type: QuestType.FETCH,
    desc: 'Митя Просрочка: «Отдай мне липовую долговую бумагу. Я подсуну ее в хвост очереди, а ты получишь деньги раньше, чем касса проснется.»',
    targetItem: 'forged_bank_debt_paper', targetCount: 1,
    rewardItem: 'fake_pass', rewardCount: 1,
    extraRewards: [{ defId: 'cigs', count: 2 }],
    relationDelta: -6, xpReward: 35, moneyReward: 90,
    eventTargetName: 'Фальшивая долговая бумага обналичена через очередь должников Б-22.',
    eventSeverity: 5,
    eventPrivacy: 'witnessed',
    eventTags: [...BANK_TAGS, 'forgery', 'debt_paper', 'cash_out', 'risk'],
    eventData: { bankingAction: 'cash_forged_debt_paper', heat: 3, debtRiskOpened: true },
    abandonsSideQuestIds: ['bank_report_forged_debt_paper'],
  },
]);

export function createBankFloorState(): BankFloorState {
  return {
    routeId: BANK_FLOOR_ROUTE_ID,
    anchorZ: BANK_FLOOR_Z,
    baseFloor: BANK_FLOOR_BASE_FLOOR,
    legalRooms: [
      BANK_ROOM_NAMES.hall,
      BANK_ROOM_NAMES.teller,
      BANK_ROOM_NAMES.deposit,
      BANK_ROOM_NAMES.credit,
      BANK_ROOM_NAMES.tellerLane,
      BANK_ROOM_NAMES.bribeQueue,
    ],
    riskRooms: [
      BANK_ROOM_NAMES.vault,
      BANK_ROOM_NAMES.queue,
      BANK_ROOM_NAMES.bypass,
      BANK_ROOM_NAMES.debtorCircuit,
      BANK_ROOM_NAMES.vaultShell,
      BANK_ROOM_NAMES.bypassGate,
    ],
    debtCircuitRooms: [
      BANK_ROOM_NAMES.tellerLane,
      BANK_ROOM_NAMES.queue,
      BANK_ROOM_NAMES.debtorCircuit,
      BANK_ROOM_NAMES.bribeQueue,
      BANK_ROOM_NAMES.bypassGate,
      BANK_ROOM_NAMES.vaultShell,
    ],
    vaultContainerIds: [],
    depositContainerIds: [],
    vaultRiskRadius: BANK_VAULT_RISK_RADIUS,
    debugEntry: {
      spawnX: 454.5,
      spawnY: 514.5,
      summary: 'bank_floor z=+26 spawn at west lift; cash desks, credit window, debt loop, service bypass and vault risk shell are connected.',
    },
  };
}

export function summarizeBankFloorState(bank: BankFloorState): string[] {
  return [
    `route=${bank.routeId} z=${bank.anchorZ} base=${FloorLevel[bank.baseFloor]}`,
    `legalRooms=${bank.legalRooms.length} riskRooms=${bank.riskRooms.length}`,
    `debtCircuit=${bank.debtCircuitRooms.join(' -> ')}`,
    `vaultRiskRadius=${bank.vaultRiskRadius}`,
    `vaultContainers=${bank.vaultContainerIds.join(',') || 'none'}`,
    `depositContainers=${bank.depositContainerIds.join(',') || 'none'}`,
    bank.debugEntry.summary,
  ];
}

export function publishBankFloorEvent(
  state: GameState,
  kind: BankActionKind,
  targetName: string,
  roomId?: number,
  zoneId?: number,
): WorldEvent {
  return publishEvent(state, {
    type: 'rumor_observed',
    floor: BANK_FLOOR_BASE_FLOOR,
    roomId,
    zoneId,
    targetName,
    severity: kind === 'vault_theft' || kind === 'forgery' ? 5 : 3,
    privacy: kind === 'vault_theft' || kind === 'forgery' ? 'witnessed' : 'local',
    tags: [...BANK_TAGS, kind],
    data: { bankingAction: kind, routeId: BANK_FLOOR_ROUTE_ID },
  });
}

export function generateBankFloorDesignFloor(): BankFloorGeneration {
  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 1 };
  const bankState = createBankFloorState();

  for (let i = 0; i < W * W; i++) {
    world.wallTex[i] = Tex.MARBLE;
    world.floorTex[i] = Tex.F_MARBLE_TILE;
  }

  const rooms = createBankRooms(world);
  dressBankRooms(world, rooms);
  placeBankLifts(world, rooms.liftLobby);
  generateBankZones(world);

  const directorId = spawnBankNpc(entities, nextId, 'bank_director_zinaida', DIRECTOR_DEF, rooms.deposit, 7, 7, Math.PI / 2);
  const cashierId = spawnBankNpc(entities, nextId, 'bank_cashier_lyuba', CASHIER_DEF, rooms.teller, 6, 9, Math.PI / 2);
  const creditId = spawnBankNpc(entities, nextId, 'bank_credit_prokhor', CREDIT_DEF, rooms.credit, 6, 8, Math.PI);
  const guardId = spawnBankNpc(entities, nextId, 'bank_guard_semyon', GUARD_DEF, rooms.vault, 5, 6, Math.PI);
  spawnBankNpc(entities, nextId, 'bank_debtor_mitya', DEBTOR_DEF, rooms.queue, 7, 5, 0);

  addBankContainers(world, bankState, rooms, directorId, cashierId, creditId, guardId);
  applyBankVaultRiskSdf(world);
  world.bakeLights();

  return {
    world,
    entities,
    spawnX: bankState.debugEntry.spawnX,
    spawnY: bankState.debugEntry.spawnY,
    bankState,
  };
}

export function expandBankFloorRouteGeometry(world: World, rng: () => number): void {
  carveRun(world, 220, 318, 804, 318, 4, Tex.F_MARBLE_TILE, Tex.MARBLE);
  carveRun(world, 220, 706, 804, 706, 4, Tex.F_MARBLE_TILE, Tex.MARBLE);
  carveRun(world, 220, 318, 220, 706, 4, Tex.F_MARBLE_TILE, Tex.MARBLE);
  carveRun(world, 804, 318, 804, 706, 4, Tex.F_MARBLE_TILE, Tex.MARBLE);
  carveRun(world, 512, 318, 512, 706, 5, Tex.F_GREEN_CARPET, Tex.MARBLE);
  carveRun(world, 220, 512, 804, 512, 5, Tex.F_GREEN_CARPET, Tex.MARBLE);

  const annexes = [
    stampBankRoom(world, RoomType.OFFICE, 250, 282, 38, 22, 'Северная бухгалтерия банка Б-22', Tex.MARBLE, Tex.F_PARQUET),
    stampBankRoom(world, RoomType.STORAGE, 736, 282, 38, 22, 'Архив просроченных вкладов Б-22', Tex.METAL, Tex.F_GREEN_CARPET),
    stampBankRoom(world, RoomType.OFFICE, 252, 718, 40, 22, 'Комната сверки вкладчиков Б-22', Tex.MARBLE, Tex.F_PARQUET),
    stampBankRoom(world, RoomType.OFFICE, 728, 718, 44, 24, 'Пост инкассации банка Б-22', Tex.METAL, Tex.F_CONCRETE),
    stampBankRoom(world, RoomType.STORAGE, 482, 280, 62, 20, 'Полка невыплаченных процентов Б-22', Tex.PANEL, Tex.F_GREEN_CARPET),
    stampBankRoom(world, RoomType.CORRIDOR, 482, 724, 62, 18, 'Нижний банковский обход Б-22', Tex.PANEL, Tex.F_LINO),
    stampBankRoom(world, RoomType.COMMON, 368, 338, 128, 34, 'Очередной зал вкладчиков Б-22', Tex.MARBLE, Tex.F_MARBLE_TILE),
    stampBankRoom(world, RoomType.COMMON, 528, 338, 128, 34, 'Очередной зал должников Б-22', Tex.MARBLE, Tex.F_MARBLE_TILE),
    stampBankRoom(world, RoomType.OFFICE, 334, 472, 90, 34, 'Кассовая галерея мелких выплат Б-22', Tex.MARBLE, Tex.F_GREEN_CARPET),
    stampBankRoom(world, RoomType.OFFICE, 334, 530, 104, 34, 'Кредитная кишка просрочек Б-22', Tex.PANEL, Tex.F_LINO),
    stampBankRoom(world, RoomType.OFFICE, 622, 458, 64, 38, 'Сейфовый пост ликвидаторов Б-22', Tex.METAL, Tex.F_CONCRETE),
    stampBankRoom(world, RoomType.STORAGE, 632, 536, 82, 44, 'Архив испорченных депозитов Б-22', Tex.METAL, Tex.F_GREEN_CARPET),
    stampBankRoom(world, RoomType.CORRIDOR, 548, 638, 140, 30, 'Черная кассовая перемычка Б-22', Tex.PANEL, Tex.F_LINO),
    stampBankRoom(world, RoomType.STORAGE, 326, 636, 84, 42, 'Склад залогового хлама Б-22', Tex.PANEL, Tex.F_CONCRETE),
  ];
  for (const room of annexes) {
    openRoomToNearestCorridor(world, room);
    scatterRoomFurniture(world, room, rng);
  }

  const tellerLane = stampBankRoom(world, RoomType.COMMON, 306, 392, 160, 32, BANK_ROOM_NAMES.tellerLane, Tex.MARBLE, Tex.F_MARBLE_TILE);
  const debtorCircuit = stampBankRoom(world, RoomType.COMMON, 306, 578, 160, 34, BANK_ROOM_NAMES.debtorCircuit, Tex.PANEL, Tex.F_LINO);
  const bribeQueue = stampBankRoom(world, RoomType.OFFICE, 472, 580, 52, 30, BANK_ROOM_NAMES.bribeQueue, Tex.PANEL, Tex.F_GREEN_CARPET);
  const vaultShell = stampBankRoom(world, RoomType.STORAGE, 594, 392, 104, 52, BANK_ROOM_NAMES.vaultShell, Tex.METAL, Tex.F_CONCRETE);
  const bypassGate = stampBankRoom(world, RoomType.CORRIDOR, 692, 582, 70, 32, BANK_ROOM_NAMES.bypassGate, Tex.PANEL, Tex.F_LINO);
  const circuitRooms = [tellerLane, debtorCircuit, bribeQueue, vaultShell, bypassGate];
  for (const room of circuitRooms) openRoomToNearestCorridor(world, room);
  decorateExpandedBankDecisionRooms(world, { tellerLane, debtorCircuit, bribeQueue, vaultShell, bypassGate });
  buildDebtCircuitLoop(world);
  addExpandedBankContainers(world, { bribeQueue, vaultShell, bypassGate });
  buildBankMicroLayer(world, rng);
  applyBankVaultRiskSdf(world);

  for (let i = 0; i < 32; i++) {
    const x = 236 + Math.floor(rng() * 552);
    const y = rng() < 0.5 ? 318 + Math.floor(rng() * 390) : 500 + Math.floor(rng() * 28);
    const ci = world.idx(x, y);
    if (world.cells[ci] === Cell.FLOOR && world.roomMap[ci] < 0 && world.features[ci] === Feature.NONE) {
      world.features[ci] = rng() < 0.5 ? Feature.DESK : Feature.SHELF;
    }
  }
}

export function bankVaultRiskSources(world: World): BankVaultRiskSource[] {
  const sources: BankVaultRiskSource[] = [];
  for (const container of world.containers) {
    if (!container.tags.includes('banking')) continue;
    if (!container.tags.includes('vault') && !container.tags.includes('high_value')) continue;
    sources.push({ x: container.x + 0.5, y: container.y + 0.5, radius: BANK_VAULT_RISK_INNER_RADIUS });
  }
  for (const room of world.rooms) {
    if (!room) continue;
    const isVaultRoom = room.name === BANK_ROOM_NAMES.vault || room.name === BANK_ROOM_NAMES.vaultShell;
    if (!isVaultRoom) continue;
    sources.push({
      x: room.x + room.w / 2,
      y: room.y + room.h / 2,
      radius: Math.max(BANK_VAULT_RISK_INNER_RADIUS, Math.min(room.w, room.h) / 2),
    });
  }
  return sources;
}

export function bankVaultRiskSignedDistance(world: World, x: number, y: number, sources = bankVaultRiskSources(world)): number {
  let best = Infinity;
  for (const source of sources) {
    const d = Math.sqrt(world.dist2(x, y, source.x, source.y)) - source.radius;
    if (d < best) best = d;
  }
  return best;
}

export function bankVaultRiskTierAt(world: World, x: number, y: number, sources = bankVaultRiskSources(world)): number {
  const signedDistance = bankVaultRiskSignedDistance(world, x, y, sources);
  if (!Number.isFinite(signedDistance) || signedDistance > BANK_VAULT_RISK_RADIUS) return 0;
  const outside = Math.max(0, signedDistance);
  return Math.max(1, Math.min(5, 1 + Math.floor((BANK_VAULT_RISK_RADIUS - outside) / (BANK_VAULT_RISK_RADIUS / 5))));
}

function decorateExpandedBankDecisionRooms(
  world: World,
  rooms: {
    tellerLane: Room;
    debtorCircuit: Room;
    bribeQueue: Room;
    vaultShell: Room;
    bypassGate: Room;
  },
): void {
  for (let x = rooms.tellerLane.x + 8; x < rooms.tellerLane.x + rooms.tellerLane.w - 8; x += 10) {
    setFeature(world, x, rooms.tellerLane.y + 6, Feature.DESK);
    setFeature(world, x, rooms.tellerLane.y + 16, Feature.CHAIR);
    setFeature(world, x + 4, rooms.tellerLane.y + 25, Feature.CHAIR);
  }
  setFeature(world, rooms.tellerLane.x + 4, rooms.tellerLane.y + 4, Feature.SCREEN);

  for (let x = rooms.debtorCircuit.x + 6; x < rooms.debtorCircuit.x + rooms.debtorCircuit.w - 8; x += 9) {
    const upper = ((x - rooms.debtorCircuit.x) / 9) % 2 < 1;
    setFeature(world, x, rooms.debtorCircuit.y + (upper ? 8 : rooms.debtorCircuit.h - 9), Feature.CHAIR);
    setFeature(world, x + 3, rooms.debtorCircuit.y + (upper ? rooms.debtorCircuit.h - 9 : 8), Feature.CHAIR);
  }
  setFeature(world, rooms.debtorCircuit.x + rooms.debtorCircuit.w - 5, rooms.debtorCircuit.y + 5, Feature.SCREEN);

  setFeature(world, rooms.bribeQueue.x + 6, rooms.bribeQueue.y + 6, Feature.DESK);
  setFeature(world, rooms.bribeQueue.x + 14, rooms.bribeQueue.y + 6, Feature.SCREEN);
  setFeature(world, rooms.bribeQueue.x + rooms.bribeQueue.w - 8, rooms.bribeQueue.y + rooms.bribeQueue.h - 7, Feature.SHELF);

  for (let x = rooms.vaultShell.x + 6; x < rooms.vaultShell.x + rooms.vaultShell.w - 6; x += 12) {
    setFeature(world, x, rooms.vaultShell.y + 6, Feature.SHELF);
    setFeature(world, x, rooms.vaultShell.y + rooms.vaultShell.h - 7, Feature.SHELF);
  }
  for (let y = rooms.vaultShell.y + 12; y < rooms.vaultShell.y + rooms.vaultShell.h - 12; y += 12) {
    setFeature(world, rooms.vaultShell.x + 5, y, Feature.LAMP);
    setFeature(world, rooms.vaultShell.x + rooms.vaultShell.w - 6, y, Feature.SCREEN);
  }

  for (let x = rooms.bypassGate.x + 6; x < rooms.bypassGate.x + rooms.bypassGate.w - 6; x += 12) {
    setFeature(world, x, rooms.bypassGate.y + 8, Feature.SCREEN);
    setFeature(world, x + 4, rooms.bypassGate.y + rooms.bypassGate.h - 8, Feature.LAMP);
  }
}

function buildDebtCircuitLoop(world: World): void {
  const loop: [number, number][] = [
    [386, 408],
    [512, 408],
    [650, 418],
    [742, 598],
    [498, 598],
    [386, 594],
    [386, 408],
  ];
  for (let i = 1; i < loop.length; i++) {
    const [ax, ay] = loop[i - 1];
    const [bx, by] = loop[i];
    if (ax !== bx && ay !== by) {
      carveRun(world, ax, ay, bx, ay, 3, Tex.F_GREEN_CARPET, Tex.PANEL);
      carveRun(world, bx, ay, bx, by, 3, Tex.F_GREEN_CARPET, Tex.PANEL);
    } else {
      carveRun(world, ax, ay, bx, by, 3, Tex.F_GREEN_CARPET, Tex.PANEL);
    }
  }
  for (const [x, y] of loop) {
    setFeature(world, x, y, Feature.LAMP);
    setFeature(world, x + 2, y, Feature.SCREEN);
  }
}

function addExpandedBankContainers(
  world: World,
  rooms: {
    bribeQueue: Room;
    vaultShell: Room;
    bypassGate: Room;
  },
): void {
  addBankContainer(world, rooms.bribeQueue, rooms.bribeQueue.x + rooms.bribeQueue.w - 6, rooms.bribeQueue.y + 10, {
    kind: ContainerKind.CASHBOX,
    name: 'Короб нулевой очереди Б-22',
    access: 'faction',
    faction: Faction.CITIZEN,
    inventory: [
      { defId: 'voluntary_receipt', count: 1 },
      { defId: 'forged_stamp_sheet', count: 1 },
      { defId: 'blank_form', count: 2 },
    ],
    tags: ['bribe', 'buyable', 'debt_circuit', 'queue_skip', 'legal_window'],
  });

  addBankContainer(world, rooms.vaultShell, rooms.vaultShell.x + rooms.vaultShell.w - 9, rooms.vaultShell.y + 14, {
    kind: ContainerKind.SAFE,
    name: 'Оболочка малых сейфов Б-22',
    access: 'locked',
    faction: Faction.LIQUIDATOR,
    inventory: [
      { defId: 'debt_settlement_receipt', count: 1 },
      { defId: 'official_permit_slip', count: 1 },
      { defId: 'container_key_label', count: 1 },
      { defId: 'ammo_9mm', count: 12 },
    ],
    tags: ['vault', 'vault_shell', 'high_value', 'theft_risk', 'liquidator_audit'],
    lockDifficulty: 4,
  });

  addBankContainer(world, rooms.bypassGate, rooms.bypassGate.x + 8, rooms.bypassGate.y + rooms.bypassGate.h - 8, {
    kind: ContainerKind.TOOL_LOCKER,
    name: 'Шкаф черного служебного обхода Б-22',
    access: 'locked',
    faction: Faction.LIQUIDATOR,
    inventory: [
      { defId: 'key', count: 1 },
      { defId: 'seal_wax', count: 1 },
      { defId: 'ink_bottle', count: 1 },
    ],
    tags: ['bypass', 'service_bypass', 'escape_pressure', 'vault_risk_sdf'],
    lockDifficulty: 3,
  });
}

function buildBankMicroLayer(world: World, rng: () => number): void {
  carveBankWingCorridors(world);
  for (const cluster of BANK_HQ_CLUSTERS) {
    stampOptionalBankRoom(world, RoomType.HQ, cluster.x, cluster.y, cluster.w, cluster.h, cluster.hqName, cluster.wallTex, cluster.floorTex, rng);
    for (const support of cluster.support) {
      stampOptionalBankRoom(world, support.type, support.x, support.y, support.w, support.h, support.name, support.wallTex, support.floorTex, rng);
    }
  }

  const blocks: readonly BankMicroBlockSpec[] = [
    { name: 'Северная депозитная ячейка Б-22', type: RoomType.STORAGE, x: 250, y: 154, w: 22, h: 12, count: 7, stepX: 64, stepY: 0, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
    { name: 'Северный кабинет вкладов Б-22', type: RoomType.OFFICE, x: 250, y: 206, w: 22, h: 12, count: 7, stepX: 64, stepY: 0, wallTex: Tex.MARBLE, floorTex: Tex.F_PARQUET },
    { name: 'Южная долговая клетка Б-22', type: RoomType.OFFICE, x: 318, y: 794, w: 22, h: 12, count: 6, stepX: 66, stepY: 0, wallTex: Tex.PANEL, floorTex: Tex.F_LINO },
    { name: 'Южный склад залога Б-22', type: RoomType.STORAGE, x: 318, y: 866, w: 22, h: 12, count: 6, stepX: 66, stepY: 0, wallTex: Tex.PANEL, floorTex: Tex.F_CONCRETE },
    { name: 'Западный кассовый кабинет Б-22', type: RoomType.OFFICE, x: 78, y: 318, w: 18, h: 18, count: 5, stepX: 0, stepY: 84, wallTex: Tex.MARBLE, floorTex: Tex.F_GREEN_CARPET },
    { name: 'Западный склад очереди Б-22', type: RoomType.STORAGE, x: 154, y: 318, w: 18, h: 18, count: 5, stepX: 0, stepY: 84, wallTex: Tex.PANEL, floorTex: Tex.F_LINO },
    { name: 'Восточный сейфовый кабинет Б-22', type: RoomType.OFFICE, x: 834, y: 318, w: 18, h: 18, count: 5, stepX: 0, stepY: 84, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
    { name: 'Восточная архивная клетка Б-22', type: RoomType.STORAGE, x: 916, y: 318, w: 18, h: 18, count: 5, stepX: 0, stepY: 84, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
  ];

  for (const block of blocks) {
    for (let i = 0; i < block.count; i++) {
      stampOptionalBankRoom(
        world,
        block.type,
        block.x + block.stepX * i,
        block.y + block.stepY * i,
        block.w,
        block.h,
        `${block.name} ${i + 1}`,
        block.wallTex,
        block.floorTex,
        rng,
      );
    }
  }
}

function carveBankWingCorridors(world: World): void {
  carveRun(world, 512, 318, 512, 188, 4, Tex.F_GREEN_CARPET, Tex.MARBLE);
  carveRun(world, 244, 188, 768, 188, 4, Tex.F_MARBLE_TILE, Tex.MARBLE);
  carveRun(world, 512, 706, 512, 842, 4, Tex.F_GREEN_CARPET, Tex.PANEL);
  carveRun(world, 238, 842, 786, 842, 4, Tex.F_LINO, Tex.PANEL);
  carveRun(world, 220, 512, 128, 512, 4, Tex.F_MARBLE_TILE, Tex.MARBLE);
  carveRun(world, 128, 310, 128, 714, 4, Tex.F_MARBLE_TILE, Tex.MARBLE);
  carveRun(world, 804, 512, 894, 512, 4, Tex.F_CONCRETE, Tex.METAL);
  carveRun(world, 894, 310, 894, 714, 4, Tex.F_CONCRETE, Tex.METAL);
}

function stampOptionalBankRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
  rng: () => number,
): Room | null {
  if (!canPlaceRoom(world, x, y, w, h)) return null;
  const room = stampBankRoom(world, type, x, y, w, h, name, wallTex, floorTex);
  openRoomToNearestCorridor(world, room);
  decorateBankMicroRoom(world, room, rng);
  return room;
}

function decorateBankMicroRoom(world: World, room: Room, rng: () => number): void {
  const fixtures = Math.max(2, Math.min(8, Math.floor((room.w * room.h) / 32)));
  for (let i = 0; i < fixtures; i++) {
    const x = room.x + 1 + Math.floor(rng() * Math.max(1, room.w - 2));
    const y = room.y + 1 + Math.floor(rng() * Math.max(1, room.h - 2));
    let feature = Feature.CHAIR;
    switch (room.type) {
      case RoomType.HQ:
        feature = i % 3 === 0 ? Feature.DESK : i % 3 === 1 ? Feature.SCREEN : Feature.LAMP;
        break;
      case RoomType.KITCHEN:
        feature = i % 3 === 0 ? Feature.STOVE : i % 3 === 1 ? Feature.SINK : Feature.TABLE;
        break;
      case RoomType.BATHROOM:
        feature = i % 2 === 0 ? Feature.TOILET : Feature.SINK;
        break;
      case RoomType.MEDICAL:
        feature = i % 2 === 0 ? Feature.BED : Feature.APPARATUS;
        break;
      case RoomType.PRODUCTION:
        feature = i % 2 === 0 ? Feature.MACHINE : Feature.APPARATUS;
        break;
      case RoomType.STORAGE:
        feature = Feature.SHELF;
        break;
      case RoomType.OFFICE:
        feature = i % 3 === 0 ? Feature.DESK : i % 3 === 1 ? Feature.CHAIR : Feature.SCREEN;
        break;
      case RoomType.SMOKING:
        feature = i % 2 === 0 ? Feature.TABLE : Feature.CHAIR;
        break;
      case RoomType.COMMON:
      default:
        feature = i % 3 === 0 ? Feature.TABLE : i % 3 === 1 ? Feature.CHAIR : Feature.LAMP;
        break;
    }
    setFeature(world, x, y, feature);
  }
}

export function applyBankFloorTerritorySeeds(world: World): void {
  for (const cluster of BANK_HQ_CLUSTERS) {
    const hq = world.rooms.find(room => room.name === cluster.hqName);
    if (!hq) continue;
    hq.type = RoomType.HQ;
    hq.sealed = true;
    paintBankRoomTerritory(world, hq, cluster.owner);
    paintBankOwnerPatch(world, hq.x + (hq.w >> 1), hq.y + (hq.h >> 1), 44, cluster.owner);
    for (const support of cluster.support) {
      const room = world.rooms.find(candidate => candidate.name === support.name);
      if (room) paintBankRoomTerritory(world, room, cluster.owner);
    }
  }
  syncZoneMetadataFromTerritory(world);
}

function paintBankRoomTerritory(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.aptMask[idx] || world.cells[idx] === Cell.LIFT) continue;
      setTerritoryOwnerAtIndex(world, idx, owner);
    }
  }
}

function paintBankOwnerPatch(world: World, cx: number, cy: number, radius: number, owner: TerritoryOwner): void {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const idx = world.idx(cx + dx, cy + dy);
      if (world.aptMask[idx] || world.cells[idx] === Cell.LIFT) continue;
      setTerritoryOwnerAtIndex(world, idx, owner);
    }
  }
}

function applyBankVaultRiskSdf(world: World): void {
  const sources = bankVaultRiskSources(world);
  if (sources.length === 0) return;

  for (const container of world.containers) {
    if (!container.tags.includes('banking')) continue;
    if (!container.tags.includes('vault') && !container.tags.includes('high_value')) continue;
    const tier = bankVaultRiskTierAt(world, container.x + 0.5, container.y + 0.5, sources);
    addBankTag(container, 'vault_risk_sdf');
    addBankTag(container, `vault_risk_${tier}`);
    if (tier >= 4) addBankTag(container, 'escape_pressure');
  }

  for (const source of sources) {
    const radius = Math.ceil(source.radius + BANK_VAULT_RISK_RADIUS);
    const minX = Math.floor(source.x - radius);
    const maxX = Math.ceil(source.x + radius);
    const minY = Math.floor(source.y - radius);
    const maxY = Math.ceil(source.y + radius);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const wx = world.wrap(x);
        const wy = world.wrap(y);
        const ci = world.idx(wx, wy);
        if (world.cells[ci] !== Cell.FLOOR || world.aptMask[ci]) continue;
        const tier = bankVaultRiskTierAt(world, wx + 0.5, wy + 0.5, sources);
        if (tier <= 0) continue;
        if (tier >= 4) world.floorTex[ci] = Tex.F_RED_CARPET;
        else if (tier >= 2 && world.roomMap[ci] < 0) world.floorTex[ci] = Tex.F_GREEN_CARPET;
        if (tier >= 4 && world.features[ci] === Feature.NONE && ((wx * 31 + wy * 17) & 31) === 0) {
          world.features[ci] = ((wx + wy) & 1) === 0 ? Feature.SCREEN : Feature.LAMP;
        }
      }
    }
  }
}

function addBankTag(container: WorldContainer, tag: string): void {
  if (!container.tags.includes(tag)) container.tags.push(tag);
}

function createBankRooms(world: World): {
  liftLobby: Room;
  hall: Room;
  teller: Room;
  deposit: Room;
  credit: Room;
  queue: Room;
  vault: Room;
  bypass: Room;
} {
  const liftLobby = stampBankRoom(world, RoomType.CORRIDOR, 444, 504, 23, 20, BANK_ROOM_NAMES.liftLobby, Tex.LIFT_DOOR, Tex.F_CONCRETE);
  const hall = stampBankRoom(world, RoomType.COMMON, 468, 488, 92, 50, BANK_ROOM_NAMES.hall, Tex.MARBLE, Tex.F_MARBLE_TILE);
  const teller = stampBankRoom(world, RoomType.OFFICE, 480, 468, 28, 19, BANK_ROOM_NAMES.teller, Tex.MARBLE, Tex.F_GREEN_CARPET);
  const deposit = stampBankRoom(world, RoomType.OFFICE, 514, 468, 28, 19, BANK_ROOM_NAMES.deposit, Tex.MARBLE, Tex.F_GREEN_CARPET);
  const credit = stampBankRoom(world, RoomType.OFFICE, 561, 500, 23, 20, BANK_ROOM_NAMES.credit, Tex.MARBLE, Tex.F_PARQUET);
  const queue = stampBankRoom(world, RoomType.COMMON, 472, 539, 68, 17, BANK_ROOM_NAMES.queue, Tex.PANEL, Tex.F_LINO);
  const bypass = stampBankRoom(world, RoomType.CORRIDOR, 561, 522, 23, 36, BANK_ROOM_NAMES.bypass, Tex.PANEL, Tex.F_LINO);
  const vault = stampBankRoom(world, RoomType.STORAGE, 585, 497, 36, 36, BANK_ROOM_NAMES.vault, Tex.METAL, Tex.F_CONCRETE);

  placeBankDoor(world, liftLobby, hall, DoorState.CLOSED);
  placeBankDoor(world, hall, teller, DoorState.CLOSED);
  placeBankDoor(world, hall, deposit, DoorState.CLOSED);
  placeBankDoor(world, hall, credit, DoorState.CLOSED);
  placeBankDoor(world, hall, queue, DoorState.CLOSED);
  placeBankDoor(world, hall, bypass, DoorState.CLOSED);
  placeBankDoor(world, credit, vault, DoorState.CLOSED);
  placeBankDoor(world, bypass, vault, DoorState.CLOSED);
  placeBankDoor(world, bypass, queue, DoorState.CLOSED);

  return { liftLobby, hall, teller, deposit, credit, queue, vault, bypass };
}

function stampBankRoom(
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
      if (dx >= 0 && dx < w && dy >= 0 && dy < h) {
        world.floorTex[ci] = floorTex;
      } else if (world.cells[ci] === Cell.WALL) {
        world.wallTex[ci] = wallTex;
      }
    }
  }
  return room;
}

function placeBankDoor(world: World, a: Room, b: Room, state: DoorState): number {
  const candidates: number[] = [];
  for (let dy = -1; dy <= a.h; dy++) {
    for (let dx = -1; dx <= a.w; dx++) {
      if (dx >= 0 && dx < a.w && dy >= 0 && dy < a.h) continue;
      const wx = world.wrap(a.x + dx);
      const wy = world.wrap(a.y + dy);
      const ci = world.idx(wx, wy);
      if (world.cells[ci] !== Cell.WALL) continue;
      let facesA = false;
      let facesB = false;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ni = world.idx(wx + ox, wy + oy);
        if (world.roomMap[ni] === a.id) facesA = true;
        if (world.roomMap[ni] === b.id) facesB = true;
      }
      if (facesA && facesB) candidates.push(ci);
    }
  }
  const ci = candidates[(candidates.length / 2) | 0];
  if (ci === undefined) return -1;
  world.cells[ci] = Cell.DOOR;
  world.doors.set(ci, { idx: ci, state, roomA: a.id, roomB: b.id, keyId: '', timer: 0 });
  a.doors.push(ci);
  b.doors.push(ci);
  return ci;
}

function dressBankRooms(
  world: World,
  rooms: ReturnType<typeof createBankRooms>,
): void {
  for (let x = rooms.hall.x + 8; x < rooms.hall.x + rooms.hall.w - 8; x += 10) {
    setFeature(world, x, rooms.hall.y + 9, Feature.CHAIR);
    setFeature(world, x, rooms.hall.y + 38, Feature.CHAIR);
  }
  for (let x = rooms.teller.x + 3; x < rooms.teller.x + rooms.teller.w - 2; x += 5) {
    setFeature(world, x, rooms.teller.y + rooms.teller.h - 3, Feature.DESK);
  }
  for (let x = rooms.deposit.x + 3; x < rooms.deposit.x + rooms.deposit.w - 2; x += 5) {
    setFeature(world, x, rooms.deposit.y + 3, Feature.SHELF);
    setFeature(world, x, rooms.deposit.y + rooms.deposit.h - 4, Feature.DESK);
  }
  setFeature(world, rooms.credit.x + 5, rooms.credit.y + 5, Feature.DESK);
  setFeature(world, rooms.credit.x + rooms.credit.w - 4, rooms.credit.y + 4, Feature.SHELF);
  setFeature(world, rooms.credit.x + 8, rooms.credit.y + rooms.credit.h - 4, Feature.LAMP);

  for (let x = rooms.queue.x + 5; x < rooms.queue.x + rooms.queue.w - 5; x += 8) {
    setFeature(world, x, rooms.queue.y + 5, Feature.CHAIR);
    setFeature(world, x, rooms.queue.y + 10, Feature.CHAIR);
  }
  for (let y = rooms.vault.y + 4; y < rooms.vault.y + rooms.vault.h - 3; y += 5) {
    setFeature(world, rooms.vault.x + 4, y, Feature.SHELF);
    setFeature(world, rooms.vault.x + 11, y, Feature.SHELF);
    setFeature(world, rooms.vault.x + rooms.vault.w - 5, y, Feature.SHELF);
  }
  for (let y = rooms.bypass.y + 4; y < rooms.bypass.y + rooms.bypass.h - 3; y += 7) {
    setFeature(world, rooms.bypass.x + 4, y, Feature.SCREEN);
    setFeature(world, rooms.bypass.x + rooms.bypass.w - 5, y, Feature.LAMP);
  }
  for (const room of Object.values(rooms)) {
    setFeature(world, room.x + room.w - 3, room.y + 2, Feature.LAMP);
  }
}

function placeBankLifts(world: World, lobby: Room): void {
  placeLift(world, lobby.x + 3, lobby.y + 9, lobby.x + 6, lobby.y + 9, LiftDirection.UP);
  placeLift(world, lobby.x + lobby.w - 4, lobby.y + 9, lobby.x + lobby.w - 7, lobby.y + 9, LiftDirection.DOWN);
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

function generateBankZones(world: World): void {
  const zoneSize = W / 8;
  world.zones = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const id = y * 8 + x;
      const faction = x >= 4 && y >= 3 && y <= 4 ? ZoneFaction.LIQUIDATOR : ZoneFaction.CITIZEN;
      world.zones.push({
        id,
        cx: Math.floor(x * zoneSize + zoneSize / 2),
        cy: Math.floor(y * zoneSize + zoneSize / 2),
        faction,
        hasLift: false,
        fogged: false,
        level: faction === ZoneFaction.LIQUIDATOR ? 3 : 2,
        hqRoomId: -1,
      });
    }
  }
  for (let y = 0; y < W; y++) {
    const zy = Math.min(7, Math.floor(y / zoneSize));
    for (let x = 0; x < W; x++) {
      const zx = Math.min(7, Math.floor(x / zoneSize));
      const zoneId = zy * 8 + zx;
      world.zoneMap[y * W + x] = zoneId;
      world.factionControl[y * W + x] = world.zones[zoneId]?.faction ?? ZoneFaction.CITIZEN;
    }
  }
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.LIFT) world.zones[world.zoneMap[i]].hasLift = true;
  }
}

function spawnBankNpc(
  entities: Entity[],
  nextId: { v: number },
  npcId: string,
  def: PlotNpcDef,
  room: Room,
  dx: number,
  dy: number,
  angle: number,
): number {
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, npcId, room.x + dx + 0.5, room.y + dy + 0.5, {
    angle,
    canGiveQuest: npcId !== 'bank_guard_semyon',
    weapon: def.inventory.some(i => i.defId === 'makarov') ? 'makarov' : undefined,
    aiTarget: { x: room.x + dx, y: room.y + dy },
  });
  return npc.id;
}

function addBankContainers(
  world: World,
  bankState: BankFloorState,
  rooms: ReturnType<typeof createBankRooms>,
  directorId: number,
  cashierId: number,
  creditId: number,
  guardId: number,
): void {
  const cashbox = addBankContainer(world, rooms.teller, rooms.teller.x + rooms.teller.w - 4, rooms.teller.y + 5, {
    kind: ContainerKind.CASHBOX,
    name: 'Кассовый ящик Любы Б-22',
    access: 'owner',
    ownerNpcId: cashierId,
    ownerName: CASHIER_DEF.name,
    faction: Faction.CITIZEN,
    inventory: [
      { defId: 'voluntary_receipt', count: 2 },
      { defId: 'filter_receipt', count: 2 },
      { defId: 'water_coupon', count: 1 },
    ],
    tags: ['cashbox', 'deposit', 'teller', 'legal_window'],
  });
  bankState.depositContainerIds.push(cashbox.id);

  const depositBox = addBankContainer(world, rooms.deposit, rooms.deposit.x + rooms.deposit.w - 5, rooms.deposit.y + 8, {
    kind: ContainerKind.FILING_CABINET,
    name: 'Депозитная картотека Б-22',
    access: 'room',
    ownerNpcId: directorId,
    ownerName: DIRECTOR_DEF.name,
    faction: Faction.CITIZEN,
    inventory: [
      { defId: 'official_permit_slip', count: 1 },
      { defId: 'ration_registry_extract', count: 1 },
      { defId: 'debt_settlement_receipt', count: 1 },
    ],
    tags: ['deposit', 'account', 'paper_in', 'banking_drop'],
  });
  bankState.depositContainerIds.push(depositBox.id);

  addBankContainer(world, rooms.credit, rooms.credit.x + rooms.credit.w - 4, rooms.credit.y + rooms.credit.h - 4, {
    kind: ContainerKind.FILING_CABINET,
    name: 'Кредитная папка Прохора Б-22',
    access: 'owner',
    ownerNpcId: creditId,
    ownerName: CREDIT_DEF.name,
    faction: Faction.CITIZEN,
    inventory: [
      { defId: 'voluntary_receipt', count: 1 },
      { defId: 'bank_debt_paper', count: 1 },
      { defId: 'forged_stamp_sheet', count: 1 },
      { defId: 'ink_bottle', count: 1 },
    ],
    tags: ['credit', 'loan', 'debt', 'paper'],
  });

  const vaultA = addBankContainer(world, rooms.vault, rooms.vault.x + 18, rooms.vault.y + 8, {
    kind: ContainerKind.SAFE,
    name: 'Сейф вкладов Б-22',
    access: 'owner',
    ownerNpcId: guardId,
    ownerName: GUARD_DEF.name,
    faction: Faction.LIQUIDATOR,
    inventory: [
      { defId: 'official_permit_slip', count: 2 },
      { defId: 'weapon_permit_signed', count: 1 },
      { defId: 'confiscation_warrant', count: 1 },
      { defId: 'ammo_9mm', count: 18 },
    ],
    tags: ['vault', 'safe', 'cashbox', 'theft_risk', 'liquidator_audit'],
    lockDifficulty: 5,
  });
  const vaultB = addBankContainer(world, rooms.vault, rooms.vault.x + 27, rooms.vault.y + 25, {
    kind: ContainerKind.CASHBOX,
    name: 'Наличная касса хранилища Б-22',
    access: 'owner',
    ownerNpcId: guardId,
    ownerName: GUARD_DEF.name,
    faction: Faction.LIQUIDATOR,
    inventory: [
      { defId: 'voluntary_receipt', count: 3 },
      { defId: 'elevator_access_order', count: 1 },
      { defId: 'debt_settlement_receipt', count: 1 },
      { defId: 'fake_pass', count: 1 },
    ],
    tags: ['vault', 'cashbox', 'theft_risk', 'debt_paper', 'liquidator_audit'],
    lockDifficulty: 4,
  });
  bankState.vaultContainerIds.push(vaultA.id, vaultB.id);

  addBankContainer(world, rooms.queue, rooms.queue.x + rooms.queue.w - 5, rooms.queue.y + 7, {
    kind: ContainerKind.CASHBOX,
    name: 'Короб должников Б-22',
    access: 'public',
    ownerNpcId: undefined,
    ownerName: undefined,
    faction: Faction.CITIZEN,
    inventory: [
      { defId: 'forged_bank_debt_paper', count: 1 },
      { defId: 'bank_debt_paper', count: 1 },
      { defId: 'forged_stamp_sheet', count: 1 },
      { defId: 'blank_form', count: 2 },
      { defId: 'cigs', count: 1 },
    ],
    tags: ['debt', 'forgery', 'paper', 'risk_path'],
  });
}

function addBankContainer(
  world: World,
  room: Room,
  x: number,
  y: number,
  opts: {
    kind: ContainerKind;
    name: string;
    access: WorldContainer['access'];
    ownerNpcId?: number;
    ownerName?: string;
    faction?: Faction;
    inventory: Item[];
    tags: string[];
    lockDifficulty?: number;
  },
): WorldContainer {
  const container: WorldContainer = {
    id: nextContainerId(world),
    x,
    y,
    floor: BANK_FLOOR_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind: opts.kind,
    name: opts.name,
    inventory: opts.inventory.map(i => ({ ...i })),
    capacitySlots: Math.max(8, opts.inventory.length + 5),
    ownerNpcId: opts.ownerNpcId,
    ownerName: opts.ownerName,
    faction: opts.faction,
    access: opts.access,
    lockDifficulty: opts.lockDifficulty,
    discovered: true,
    tags: [...BANK_TAGS, ...opts.tags],
  };
  world.addContainer(container);
  setFeature(world, x, y, opts.kind === ContainerKind.CASHBOX ? Feature.DESK : Feature.SHELF);
  return container;
}

function nextContainerId(world: World): number {
  let id = 1;
  for (const container of world.containers) id = Math.max(id, container.id + 1);
  return id;
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER) world.features[ci] = feature;
}

function carveRun(
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
    const minX = Math.min(ax, bx);
    carveRect(world, minX, ay - half, Math.abs(bx - ax) + 1, width, floorTex, wallTex);
    return;
  }
  const minY = Math.min(ay, by);
  carveRect(world, ax - half, minY, width, Math.abs(by - ay) + 1, floorTex, wallTex);
}

function carveRect(world: World, x: number, y: number, w: number, h: number, floorTex: Tex, wallTex: Tex): void {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (dx >= 0 && dx < w && dy >= 0 && dy < h) {
        if (world.cells[ci] !== Cell.LIFT && world.cells[ci] !== Cell.DOOR) {
          world.cells[ci] = Cell.FLOOR;
          world.roomMap[ci] = -1;
          world.floorTex[ci] = floorTex;
        }
      } else if (world.cells[ci] === Cell.WALL) {
        world.wallTex[ci] = wallTex;
      }
    }
  }
}

function openRoomToNearestCorridor(world: World, room: Room): void {
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  const probes: [number, number, number, number][] = [
    [cx, room.y - 1, 0, -1],
    [cx, room.y + room.h, 0, 1],
    [room.x - 1, cy, -1, 0],
    [room.x + room.w, cy, 1, 0],
  ];
  let best: { sx: number; sy: number; path: number[] } | null = null;
  for (const [sx, sy, dx, dy] of probes) {
    const path: number[] = [];
    let x = sx;
    let y = sy;
    for (let i = 0; i < 80; i++) {
      const ci = world.idx(x, y);
      if (world.cells[ci] === Cell.FLOOR && world.roomMap[ci] < 0) {
        if (!best || path.length < best.path.length) best = { sx, sy, path: [...path] };
        break;
      }
      path.push(ci);
      x += dx;
      y += dy;
    }
  }
  if (!best) return;
  const doorIdx = world.idx(best.sx, best.sy);
  world.cells[doorIdx] = Cell.DOOR;
  world.doors.set(doorIdx, { idx: doorIdx, state: DoorState.CLOSED, roomA: room.id, roomB: -1, keyId: '', timer: 0 });
  room.doors.push(doorIdx);
  for (const ci of best.path) {
    if (ci === doorIdx) continue;
    if (world.cells[ci] !== Cell.LIFT) {
      world.cells[ci] = Cell.FLOOR;
      world.roomMap[ci] = -1;
      world.floorTex[ci] = Tex.F_MARBLE_TILE;
    }
  }
}

function scatterRoomFurniture(world: World, room: Room, rng: () => number): void {
  for (let i = 0; i < 8; i++) {
    const x = room.x + 2 + Math.floor(rng() * Math.max(1, room.w - 4));
    const y = room.y + 2 + Math.floor(rng() * Math.max(1, room.h - 4));
    if (world.features[world.idx(x, y)] === Feature.NONE) {
      setFeature(world, x, y, i % 3 === 0 ? Feature.DESK : i % 3 === 1 ? Feature.SHELF : Feature.CHAIR);
    }
  }
}
