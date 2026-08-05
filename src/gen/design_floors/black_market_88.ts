/* -- Design floor: Черный рынок 88 --------------------------------
 * Standalone future-floor slice. It deliberately does not add a new
 * FloorLevel; route integration belongs to the floor manifest owner.
 */

import { clamp } from '../../render/ui_utils';
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
  Occupation,
  QuestType,
  RoomType,
  Tex,
  W,
  ZoneFaction,
  type ContainerAccess,
  type Entity,
  type Item,
  type Room,
  type TerritoryOwner,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { ITEMS, freshNeeds } from '../../data/catalog';
import { factionToTerritoryOwner } from '../../data/factions';
import { designNpcFloorKey, type PlotNpcDef, type SideQuestStep, registerFloorSideQuest } from '../../data/plot';
import { syncZoneMetadataFromTerritory } from '../../systems/territory';
import { generateZones, sanitizeDoors, stampRoom } from '../shared';
import type { FloorGeneration } from '../floor_manifest';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('black_market_88');

export const BLACK_MARKET_88_ROUTE_ID = 'black_market_88' as const;
export const BLACK_MARKET_88_DISPLAY_NAME = 'Черный рынок 88';
export const BLACK_MARKET_88_FUTURE_Z = -10;
export const BLACK_MARKET_88_CONTAINER_FLOOR = FloorLevel.LIVING;

export type Market88LaneId = 'survival' | 'weapons' | 'medicine' | 'documents' | 'access';
export type Market88AccessKind = 'password' | 'maintenance_hatch' | 'ministry_document';
export type Market88Settlement = 'rubles' | 'item' | 'contract' | 'document' | 'faction';

export interface Market88StockRow {
  id: string;
  traderId: string;
  lane: Market88LaneId;
  itemId: string;
  count: number;
  markup: number;
  heatDelta: number;
  maxPrice: number;
}

export interface Market88DebtTemplate {
  id: string;
  ownerId: string;
  severity: 1 | 2 | 3 | 4 | 5;
  dueHours: number;
  settlement: Market88Settlement;
  heatDelta: number;
  consequenceId: string;
}

export interface Market88DebtState {
  id: string;
  templateId: string;
  ownerId: string;
  createdAt: number;
  dueAt: number;
  severity: 1 | 2 | 3 | 4 | 5;
  settlement: Market88Settlement;
  consequenceId: string;
  warned: boolean;
  overdue: boolean;
  resolved: boolean;
}

export interface Market88DesignState {
  heat: number;
  trust: number;
  raidCooldownUntil: number;
  raidWarningUntil: number;
  access: Record<Market88AccessKind, boolean>;
  demand: Record<Market88LaneId, number>;
  stock: Record<string, number>;
  traderLocks: Record<string, number>;
  debts: Market88DebtState[];
  stockVersion: number;
}

export interface Market88PriceQuote {
  offerId: string;
  itemId: string;
  lane: Market88LaneId;
  baseValue: number;
  scarcityMultiplier: number;
  heatMultiplier: number;
  trustMultiplier: number;
  demandMultiplier: number;
  buyPrice: number;
  sellPrice: number;
  stock: number;
  locked: boolean;
}

export interface Market88DesignResult {
  ok: boolean;
  reason: string;
  messages: string[];
}

const MAX_DEBTS = 64;
const MAX_HEAT = 100;
const MIN_TRUST = -5;
const MAX_TRUST = 5;
const MARKET88_QUEUE_CROWD_CAP = 16;

export const BLACK_MARKET_88_STOCK: readonly Market88StockRow[] = [
  {
    id: 'market88.purchase.medkit_under_counter',
    traderId: 'market88_marta_broker',
    lane: 'medicine',
    itemId: 'antibiotic',
    count: 1,
    markup: 1.8,
    heatDelta: 2,
    maxPrice: 260,
  },
  {
    id: 'market88.purchase.popobava_blister',
    traderId: 'market88_marta_broker',
    lane: 'medicine',
    itemId: 'sleeping_pills',
    count: 2,
    markup: 1.65,
    heatDelta: 3,
    maxPrice: 180,
  },
  {
    id: 'market88.purchase.panic_bandages',
    traderId: 'market88_uliana_cash',
    lane: 'survival',
    itemId: 'bandage',
    count: 4,
    markup: 1.35,
    heatDelta: 1,
    maxPrice: 80,
  },
  {
    id: 'market88.purchase.quiet_9mm',
    traderId: 'market88_zhoka_knife',
    lane: 'weapons',
    itemId: 'ammo_9mm',
    count: 18,
    markup: 2.1,
    heatDelta: 4,
    maxPrice: 16,
  },
  {
    id: 'market88.purchase.homemade_9mm',
    traderId: 'market88_zhoka_knife',
    lane: 'weapons',
    itemId: 'homemade_9mm',
    count: 6,
    markup: 1.55,
    heatDelta: 5,
    maxPrice: 38,
  },
  {
    id: 'market88.purchase.homemade_ammo_instruction',
    traderId: 'market88_zlata_silence',
    lane: 'documents',
    itemId: 'homemade_ammo_instruction',
    count: 1,
    markup: 2.05,
    heatDelta: 4,
    maxPrice: 260,
  },
  {
    id: 'market88.purchase.false_pass',
    traderId: 'market88_zlata_silence',
    lane: 'documents',
    itemId: 'fake_pass',
    count: 1,
    markup: 2.4,
    heatDelta: 5,
    maxPrice: 190,
  },
  {
    id: 'market88.purchase.stolen_terminal_stamp',
    traderId: 'market88_zlata_silence',
    lane: 'documents',
    itemId: 'stolen_terminal_stamp',
    count: 1,
    markup: 2.25,
    heatDelta: 6,
    maxPrice: 420,
  },
  {
    id: 'market88.purchase.black_shells',
    traderId: 'market88_zhoka_knife',
    lane: 'weapons',
    itemId: 'black_market_shells',
    count: 4,
    markup: 2.6,
    heatDelta: 6,
    maxPrice: 180,
  },
  {
    id: 'market88.purchase.shock_baton_under_shelf',
    traderId: 'market88_zhoka_knife',
    lane: 'weapons',
    itemId: 'shock_baton',
    count: 1,
    markup: 1.85,
    heatDelta: 5,
    maxPrice: 780,
  },
  {
    id: 'market88.purchase.rb91_drum_box',
    traderId: 'market88_zhoka_knife',
    lane: 'weapons',
    itemId: 'rb91_auto_shotgun',
    count: 1,
    markup: 1.75,
    heatDelta: 9,
    maxPrice: 6200,
  },
  {
    id: 'market88.purchase.pushkin_shell_platform',
    traderId: 'market88_zhoka_knife',
    lane: 'weapons',
    itemId: 'pushkin_shotgun',
    count: 1,
    markup: 1.95,
    heatDelta: 10,
    maxPrice: 6800,
  },
  {
    id: 'market88.purchase.chest_failsafe_charge',
    traderId: 'market88_zhoka_knife',
    lane: 'weapons',
    itemId: 'chest_failsafe_charge',
    count: 1,
    markup: 2.4,
    heatDelta: 12,
    maxPrice: 5200,
  },
  {
    id: 'market88.purchase.stolen_filters',
    traderId: 'market88_marta_broker',
    lane: 'survival',
    itemId: 'stolen_filter_pack',
    count: 1,
    markup: 1.7,
    heatDelta: 4,
    maxPrice: 240,
  },
  {
    id: 'market88.purchase.braga_bucket',
    traderId: 'market88_marta_broker',
    lane: 'survival',
    itemId: 'braga_bucket',
    count: 1,
    markup: 1.55,
    heatDelta: 3,
    maxPrice: 220,
  },
  {
    id: 'market88.purchase.moonshine_still_part',
    traderId: 'market88_marta_broker',
    lane: 'access',
    itemId: 'moonshine_still_part',
    count: 1,
    markup: 1.9,
    heatDelta: 4,
    maxPrice: 320,
  },
  {
    id: 'market88.purchase.weapon_blueprint_t2',
    traderId: 'market88_zlata_silence',
    lane: 'documents',
    itemId: 'weapon_blueprint_t2',
    count: 1,
    markup: 2.2,
    heatDelta: 7,
    maxPrice: 720,
  },
  {
    id: 'market88.purchase.shocker_parts',
    traderId: 'market88_zhoka_knife',
    lane: 'weapons',
    itemId: 'contraband_shocker_parts',
    count: 1,
    markup: 2,
    heatDelta: 5,
    maxPrice: 360,
  },
  {
    id: 'market88.purchase.maiden_paint_can',
    traderId: 'market88_zlata_silence',
    lane: 'access',
    itemId: 'aerosol_paint_maiden',
    count: 2,
    markup: 1.9,
    heatDelta: 3,
    maxPrice: 190,
  },
];

export const BLACK_MARKET_88_DEBTS: readonly Market88DebtTemplate[] = [
  {
    id: 'market88.debt.goods_front',
    ownerId: 'market88_marta_broker',
    severity: 2,
    dueHours: 10,
    settlement: 'item',
    heatDelta: 8,
    consequenceId: 'market88.consequence.stock_lock',
  },
  {
    id: 'market88.debt.ruble_note',
    ownerId: 'market88_mikhail_debt',
    severity: 2,
    dueHours: 8,
    settlement: 'rubles',
    heatDelta: 10,
    consequenceId: 'market88.consequence.debt_contract',
  },
  {
    id: 'market88.debt.protection',
    ownerId: 'market88_zhoka_knife',
    severity: 3,
    dueHours: 12,
    settlement: 'faction',
    heatDelta: 14,
    consequenceId: 'market88.consequence.raid_warning',
  },
  {
    id: 'market88.debt.information',
    ownerId: 'market88_zlata_silence',
    severity: 1,
    dueHours: 6,
    settlement: 'document',
    heatDelta: 6,
    consequenceId: 'market88.consequence.access_lock',
  },
  {
    id: 'market88.debt.faction_marker',
    ownerId: 'market88_mikhail_debt',
    severity: 4,
    dueHours: 18,
    settlement: 'contract',
    heatDelta: 18,
    consequenceId: 'market88.consequence.liquidator_sweep',
  },
];

export const BLACK_MARKET_88_CONTRACT_ROWS = [
  {
    id: 'market88.contract.deliver_night_stock',
    issuerId: 'market88_marta_broker',
    objective: 'deliver',
    requiredTrust: 0,
    heatDelta: -4,
    debtSettlementIds: ['market88.debt.goods_front'],
    rewardTable: ['fake_pass', 'cigs', 'money'],
    failureConsequence: 'heat +1, stock stays low',
  },
  {
    id: 'market88.contract.hide_courier',
    issuerId: 'market88_zlata_silence',
    objective: 'hide',
    requiredTrust: 1,
    heatDelta: 3,
    debtSettlementIds: ['market88.debt.information'],
    rewardTable: ['water', 'blank_form'],
    failureConsequence: 'local witness event and heat +2',
  },
  {
    id: 'market88.contract.steal_stamp',
    issuerId: 'market88_zlata_silence',
    objective: 'steal',
    requiredTrust: 0,
    heatDelta: 5,
    debtSettlementIds: ['market88.debt.faction_marker'],
    rewardTable: ['fake_pass', 'money'],
    failureConsequence: 'ministry audit pressure',
  },
] as const;

const NPC_DEFS: Record<string, PlotNpcDef> = {
  market88_marta_broker: {
    name: 'Марта Восьмая',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.STOREKEEPER,
    sprite: Occupation.STOREKEEPER,
    hp: 160, maxHp: 160, money: 140, speed: 0.75,
    inventory: [
      { defId: 'antibiotic', count: 1 },
      { defId: 'pills', count: 2 },
      { defId: 'bandage', count: 3 },
      { defId: 'fake_pass', count: 1 },
      { defId: 'govnyak_roll', count: 3 },
      { defId: 'govnyak_brick', count: 1 },
    ],
    talkLines: [
      'Восемьдесят восьмой не продает спасение. Он продает отсрочку.',
      'Цена растет от дефицита, от жара и от того, как громко ты платишь.',
      'Берешь товар в долг - оставляешь имя. Имя здесь стоит дороже рубля.',
      'Фильтр сухой? Цена одна. Фильтр сухой и без фамилии? Цена другая.',
      'Сдать пробу можно мне, НИИ или Министерству. Я плачу быстрее, они дольше оформляют.',
      'Нужен товар без вопросов - плати до сирены. После сирены вопросы идут сами.',
    ],
    talkLinesPost: [
      'Запас не бесконечный. У прилавка считают каждую руку.',
      'После рейда ящики пустеют сами. Так дешевле, чем объяснять.',
      'Кухня берет водой, этаж 69 - деталями, НИИ - пробами. Рынок берет всем, что дойдет.',
    ],
  },
  market88_mikhail_debt: {
    name: 'Михаил Долговой',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 120, maxHp: 120, money: 88, speed: 0.7,
    inventory: [
      { defId: 'voluntary_receipt', count: 2 },
      { defId: 'blank_form', count: 1 },
      { defId: 'cigs', count: 2 },
    ],
    talkLines: [
      'Долг без владельца - слух. Долг с владельцем - расписание.',
      'Погаси восемьдесят восемь сейчас, пока охрана считает это арифметикой.',
      'Просрочка не убивает сразу. Она ставит охрану ближе к твоей двери.',
      'Долг можно закрыть деньгами, бумагой или человеком. Лучше деньгами.',
      'Мокрый талон идет в полцены. Мокрый должник идет в отдельную колонку.',
      'Не проси скидку при лампе. Лампа потом свидетель.',
    ],
    talkLinesPost: [
      'Сегодня тетрадь закрыта. Завтра Миша снова откроет ее на твоей строке.',
      'Если рейд пришел раньше срока, значит кто-то заплатил чужим временем.',
      'Твой корешок лежит тихо. Так и держи его: сухо, ровно, без героизма.',
    ],
  },
  market88_zlata_silence: {
    name: 'Злата Тишина',
    isFemale: true,
    faction: Faction.WILD,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 95, maxHp: 95, money: 70, speed: 0.9,
    inventory: [
      { defId: 'fake_pass', count: 1 },
      { defId: 'blank_form', count: 2 },
      { defId: 'denunciation', count: 1 },
      { defId: 'metro_ticket', count: 1 },
    ],
    talkLines: [
      'Пароль не говорят. Его теряют рядом с тем, кто умеет слушать.',
      'Чистая печать открывает грязные двери. Грязная печать открывает быстрее.',
      'Курьера прячут не потому, что он важный. Потому что он еще не заговорил.',
      'Документ мокрый - скидка. Печать целая - разговор продолжается.',
      'Подделать можно корешок, очередь и маршрут. Свидетеля лучше не подделывать.',
      'Министерский бланк не продавай у лампы. При свете видно, где печать липовая.',
    ],
    talkLinesPost: [
      'Если бумага молчит, значит сделка еще жива.',
      'Неправильный маршрут тоже маршрут, просто он берет больше.',
      'Кто сдал доказательство наверх, тот продал не вещь, а след за собой.',
    ],
  },
  market88_zhoka_knife: {
    name: 'Жока Нож',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 240, maxHp: 240, money: 60, speed: 0.95,
    inventory: [
      { defId: 'makarov', count: 1 },
      { defId: 'ammo_9mm', count: 18 },
      { defId: 'ammo_shells', count: 3 },
      { defId: 'liquidator_token', count: 1 },
      { defId: 'ip4_gasmask', count: 1 },
      { defId: 'shock_baton', count: 1 },
    ],
    talkLines: [
      'Оружейный ряд не любит скидки. Скидка звучит как донос.',
      'Патроны продаю поштучно, потому что очередь умирает не пачками.',
      'Рейд не грабит рынок. Рейд прячет товар так, что он перестает быть товаром.',
      'Ликвидаторский жетон купишь дешевле крови, но дороже честного объяснения.',
      'Девятку бери до сирены. Во время сирены торгуется только дверь.',
      'Украл из ящика - считай патроны вслух, я по голосу найду остаток.',
    ],
    talkLinesPost: [
      'Стволы закрыты, если жара выше нормы. Норма тут маленькая.',
      'Если взял из ящика без спроса, беги до того, как я досчитаю.',
      'Этаж 69 присылает детали, когда ему страшно. Я беру деталями, если они не пищат.',
    ],
  },
  market88_uliana_cash: {
    name: 'Ульяна Касса',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.STOREKEEPER,
    sprite: Occupation.STOREKEEPER,
    hp: 115, maxHp: 115, money: 120, speed: 0.75,
    inventory: [
      { defId: 'water', count: 3 },
      { defId: 'bread', count: 2 },
      { defId: 'canned', count: 1 },
      { defId: 'bandage', count: 2 },
    ],
    talkLines: [
      'Касса не покупает обратно то, что сама испугалась продать.',
      'Хочешь дешевле - принеси товар, снизь жар или закрой чей-нибудь долг.',
      'После мокрого самосбора сухой хлеб идет как документ.',
      'Входная касса стоит у самой двери: берешь честный талон или идешь через люк с долгом.',
      'Воду меняю на фильтр, фильтр на проход, проход на молчание. Деньги просто короче.',
      'Кухня просит крупу, НИИ просит банку, Министерство просит подпись. Мне хватит цены.',
      'Если покупаешь спасение, не торгуйся так, будто его можно вернуть.',
    ],
    talkLinesPost: [
      'Касса открыта. Ящик закрыт. Это разные новости.',
      'Если товар пропал, пропажа найдет свидетеля сама.',
      'Чужая проблема сегодня свежая. Завтра она дешевеет, если доживет.',
    ],
  },
  market88_courier_sasha: {
    name: 'Саша Люк',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.TRAVELER,
    sprite: Occupation.TRAVELER,
    hp: 75, maxHp: 75, money: 12, speed: 1.15,
    inventory: [
      { defId: 'gasmask_filter', count: 1 },
      { defId: 'note', count: 1 },
    ],
    talkLines: [
      'Я не видел рейд. Я видел, как прилавки стали пустыми за минуту до него.',
      'Люк ведет вниз, если проводник трезвый. Если нет - все равно вниз.',
      'Спрячешь меня до отбоя - получишь маршрут, который еще не успели продать.',
      'На этаж 69 ходят за деталями, назад - за ценой. Я знаю короткий путь, но он берет фильтр.',
      'Если несешь пробу НИИ, не ставь рядом с хлебом. Хлеб потом слишком ученый.',
      'У кухни слухи дешевые, зато горячие. У рынка дорогие, зато с адресом.',
    ],
    talkLinesPost: [
      'Спасибо. Я теперь тише, чем был должен.',
      'Люк мокрый, но живой. Пока.',
      'Маршрут не бесплатный. Просто сегодня я плачу тишиной.',
    ],
  },
};

const SIDE_QUESTS: readonly SideQuestStep[] = [
  {
    id: 'market88_deliver_night_stock',
    giverNpcId: 'market88_marta_broker',
    type: QuestType.FETCH,
    desc: 'Марта Восьмая: «Принеси антибиотик в ночной запас. Деньги будут, но главный товар - доверие.»',
    targetItem: 'antibiotic',
    targetCount: 1,
    rewardItem: 'fake_pass',
    rewardCount: 1,
    extraRewards: [{ defId: 'cigs', count: 2 }],
    relationDelta: 10,
    xpReward: 55,
    moneyReward: 80,
    targetRoute: { designFloorId: BLACK_MARKET_88_ROUTE_ID, label: 'Z-10 Черный рынок 88' },
    targetZoneTag: 'black_market_88',
    targetHint: 'Z-10 Черный рынок 88: антибиотик для ночного запаса у рядов и лекарственного шкафа.',
    eventTags: ['black_market_88', 'trade', 'supplier_delivery', 'market_scarcity'],
    eventData: { routeId: BLACK_MARKET_88_ROUTE_ID, marketAction: 'supplier_delivery', scarcityLane: 'medicine' },
  },
  {
    id: 'market88_hide_courier',
    giverNpcId: 'market88_zlata_silence',
    type: QuestType.TALK,
    desc: 'Злата Тишина: «Найди Сашу Люка и скажи, что люк сегодня спит. Не геройствуй, просто доведи слова.»',
    targetNpcId: 'market88_courier_sasha',
    rewardItem: 'blank_form',
    rewardCount: 1,
    extraRewards: [{ defId: 'water', count: 1 }],
    relationDelta: 9,
    xpReward: 45,
    moneyReward: 45,
    targetRoute: { designFloorId: BLACK_MARKET_88_ROUTE_ID, label: 'Z-10 Черный рынок 88' },
    targetZoneTag: 'black_market_88',
    targetHint: 'Z-10 Черный рынок 88: Саша Люк прячется в курьерской щели у служебного люка.',
    eventTags: ['black_market_88', 'caravan', 'protect_courier', 'black_route_papers'],
    eventData: { routeId: BLACK_MARKET_88_ROUTE_ID, marketAction: 'protect_courier', laneId: 'production_black_market_88' },
    blockedBySideQuestIds: ['market88_betray_supplier'],
  },
  {
    id: 'market88_steal_stamp',
    giverNpcId: 'market88_zlata_silence',
    type: QuestType.FETCH,
    desc: 'Злата Тишина: «Нужна печать ЖЭК. Купить нельзя: продавца сдадут вместе с тобой, и печать сгорит до первого окна.»',
    targetItem: 'zhek_seal',
    targetCount: 1,
    rewardItem: 'fake_pass',
    rewardCount: 1,
    relationDelta: 8,
    xpReward: 60,
    moneyReward: 70,
    targetRoute: { designFloorId: BLACK_MARKET_88_ROUTE_ID, label: 'Z-10 Черный рынок 88' },
    targetZoneTag: 'black_market_88',
    targetHint: 'Z-10 Черный рынок 88: печать ЖЭК нужна Злате для черного маршрута и поддельных окон.',
    eventTags: ['black_market_88', 'forgery', 'theft', 'black_route_papers'],
    eventData: { routeId: BLACK_MARKET_88_ROUTE_ID, marketAction: 'forge_route_papers', permitRisk: 'zhek_seal' },
  },
  {
    id: 'market88_settle_bad_debt',
    giverNpcId: 'market88_mikhail_debt',
    type: QuestType.FETCH,
    desc: 'Михаил Долговой: «Восемьдесят восемь рублей - и я вычеркиваю твою строку до вечерней проверки.»',
    targetItem: 'money',
    targetCount: 88,
    rewardItem: 'voluntary_receipt',
    rewardCount: 1,
    extraRewards: [{ defId: 'bread', count: 1 }],
    relationDelta: 6,
    xpReward: 35,
    targetRoute: { designFloorId: BLACK_MARKET_88_ROUTE_ID, label: 'Z-10 Черный рынок 88' },
    targetZoneTag: 'black_market_88',
    targetHint: 'Z-10 Черный рынок 88: Михаил закрывает долг только у долговой конторы 88.',
    eventTags: ['black_market_88', 'debt_settlement', 'bank_debt', 'market_scarcity'],
    eventData: { routeId: BLACK_MARKET_88_ROUTE_ID, marketAction: 'debt_settlement', debtRubles: 88 },
  },
  {
    id: 'market88_return_ammo_crate',
    giverNpcId: 'market88_zhoka_knife',
    type: QuestType.FETCH,
    desc: 'Жока Нож: «Верни двадцать четыре девятки в ряд. За полный ряд дам дробь и скажу, какой шкаф сегодня без охраны.»',
    targetItem: 'ammo_9mm',
    targetCount: 24,
    rewardItem: 'ammo_shells',
    rewardCount: 3,
    extraRewards: [{ defId: 'liquidator_token', count: 1 }],
    relationDelta: 8,
    xpReward: 50,
    moneyReward: 30,
    targetRoute: { designFloorId: BLACK_MARKET_88_ROUTE_ID, label: 'Z-10 Черный рынок 88' },
    targetZoneTag: 'black_market_88',
    targetHint: 'Z-10 Черный рынок 88: Жока считает патроны у оружейного ряда и рейдовых задвижек.',
    eventTags: ['black_market_88', 'trade', 'weapons', 'supplier_delivery'],
    eventData: { routeId: BLACK_MARKET_88_ROUTE_ID, marketAction: 'ammo_supplier_return', scarcityLane: 'weapons' },
  },
  {
    id: 'market88_betray_supplier',
    giverNpcId: 'market88_zhoka_knife',
    type: QuestType.TALK,
    desc: 'Жока Нож: «Саша ведет поставщика мимо моей задвижки. Скажи ему, что маршрут продан, и не стой между мной и люком.»',
    targetNpcId: 'market88_courier_sasha',
    rewardItem: 'ammo_9mm',
    rewardCount: 12,
    extraRewards: [{ defId: 'liquidator_token', count: 1 }],
    relationDelta: 7,
    xpReward: 45,
    moneyReward: 40,
    targetRoute: { designFloorId: BLACK_MARKET_88_ROUTE_ID, label: 'Z-10 Черный рынок 88' },
    targetZoneTag: 'black_market_88',
    targetHint: 'Z-10 Черный рынок 88: предать поставщика можно через Сашу Люка в курьерской щели.',
    eventTags: ['black_market_88', 'supplier_betrayal', 'caravan', 'crime', 'black_route_papers'],
    eventData: { routeId: BLACK_MARKET_88_ROUTE_ID, marketAction: 'supplier_betrayal', laneId: 'production_black_market_88' },
    blockedBySideQuestIds: ['market88_hide_courier'],
    abandonsSideQuestIds: ['market88_hide_courier'],
  },
];

let contentRegistered = false;

export function registerBlackMarket88DesignFloorContent(): void {
  if (contentRegistered) return;
  const questsByNpcId: Record<string, typeof SIDE_QUESTS[number][]> = {};
  for (const q of SIDE_QUESTS) {
    if (!questsByNpcId[q.giverNpcId]) questsByNpcId[q.giverNpcId] = [];
    questsByNpcId[q.giverNpcId].push(q);
  }
  for (const npcId of Object.keys(NPC_DEFS)) {
    const quests = questsByNpcId[npcId] || [];
    registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, npcId, NPC_DEFS[npcId], quests);
  }
  contentRegistered = true;
}

export function createBlackMarket88DesignState(): Market88DesignState {
  const stock: Record<string, number> = {};
  for (const row of BLACK_MARKET_88_STOCK) stock[row.id] = row.count;
  return {
    heat: 18,
    trust: 0,
    raidCooldownUntil: 0,
    raidWarningUntil: 0,
    access: {
      password: true,
      maintenance_hatch: false,
      ministry_document: false,
    },
    demand: {
      survival: 1,
      weapons: 1,
      medicine: 1,
      documents: 1,
      access: 1,
    },
    stock,
    traderLocks: {},
    debts: [],
    stockVersion: 1,
  };
}

export function quoteBlackMarket88Purchase(
  state: Market88DesignState,
  offerId: string,
  scarcityMultiplier = 1,
  now = 0,
): Market88PriceQuote | null {
  const row = BLACK_MARKET_88_STOCK.find(s => s.id === offerId);
  if (!row) return null;
  const def = ITEMS[row.itemId];
  const baseValue = Math.max(1, def?.value ?? 1);
  const heatMultiplier = 1 + clamp(state.heat, 0, MAX_HEAT) / 180;
  const trust = clamp(state.trust, MIN_TRUST, MAX_TRUST);
  const trustMultiplier = trust >= 0 ? 1 - trust * 0.04 : 1 + Math.abs(trust) * 0.04;
  const demandMultiplier = clamp(state.demand[row.lane] ?? 1, 0.75, 2.75);
  const raw = baseValue * row.markup * clamp(scarcityMultiplier, 0.5, 4) * heatMultiplier * trustMultiplier * demandMultiplier;
  const buyPrice = clamp(Math.round(raw), 1, row.maxPrice);
  return {
    offerId,
    itemId: row.itemId,
    lane: row.lane,
    baseValue,
    scarcityMultiplier,
    heatMultiplier,
    trustMultiplier,
    demandMultiplier,
    buyPrice,
    sellPrice: Math.max(1, Math.floor(buyPrice * 0.45)),
    stock: state.stock[offerId] ?? 0,
    locked: (state.traderLocks[row.traderId] ?? 0) > now || (state.traderLocks[row.lane] ?? 0) > now,
  };
}

export function applyBlackMarket88Purchase(
  state: Market88DesignState,
  offerId: string,
  now = 0,
): Market88DesignResult {
  const row = BLACK_MARKET_88_STOCK.find(s => s.id === offerId);
  const quote = quoteBlackMarket88Purchase(state, offerId, 1, now);
  if (!row || !quote) return { ok: false, reason: 'missing_offer', messages: [] };
  if (quote.locked) return { ok: false, reason: 'trader_locked', messages: ['Ряд закрыт до проверки.'] };
  if (quote.stock <= 0) return { ok: false, reason: 'out_of_stock', messages: ['Товар закончился. Долг не создает новый товар.'] };

  state.stock[offerId] = quote.stock - 1;
  state.heat = clamp(state.heat + row.heatDelta, 0, MAX_HEAT);
  state.demand[row.lane] = clamp((state.demand[row.lane] ?? 1) + 0.04, 0.75, 2.75);
  state.stockVersion++;

  const messages = [`Куплено: ${ITEMS[row.itemId]?.name ?? row.itemId}. Осталось: ${state.stock[offerId]}.`];
  if (state.heat >= 65 && now >= state.raidCooldownUntil) {
    applyBlackMarket88RaidWarning(state, now);
    messages.push('Оружейный ряд убрал ящики: рейд уже стал слухом.');
  }
  return { ok: true, reason: 'purchased', messages };
}

export function createBlackMarket88Debt(
  state: Market88DesignState,
  templateId: string,
  now = 0,
): Market88DesignResult {
  const template = BLACK_MARKET_88_DEBTS.find(d => d.id === templateId);
  if (!template) return { ok: false, reason: 'missing_template', messages: [] };
  if (state.debts.length >= MAX_DEBTS) return { ok: false, reason: 'debt_cap', messages: ['Тетрадь полна. Новые долги не пишут поверх старых.'] };
  if (state.debts.some(d => !d.resolved && d.templateId === templateId)) {
    return { ok: false, reason: 'duplicate_unresolved_debt', messages: ['Сначала закрой старую строку.'] };
  }

  const debt: Market88DebtState = {
    id: `${template.id}.${Math.max(1, state.debts.length + 1)}`,
    templateId: template.id,
    ownerId: template.ownerId,
    createdAt: now,
    dueAt: now + template.dueHours * 60,
    severity: template.severity,
    settlement: template.settlement,
    consequenceId: template.consequenceId,
    warned: false,
    overdue: false,
    resolved: false,
  };
  state.debts.push(debt);
  state.heat = clamp(state.heat + template.heatDelta, 0, MAX_HEAT);
  state.trust = clamp(state.trust - 1, MIN_TRUST, MAX_TRUST);
  return {
    ok: true,
    reason: 'debt_created',
    messages: [`Долг записан: ${template.id}. Срок: ${template.dueHours} ч.`],
  };
}

export function matureBlackMarket88Debts(state: Market88DesignState, now: number): Market88DesignResult {
  const messages: string[] = [];
  let processed = 0;
  for (const debt of state.debts) {
    if (processed >= 3) break;
    if (debt.resolved || debt.overdue || now < debt.dueAt) continue;
    debt.warned = true;
    debt.overdue = true;
    processed++;
    state.heat = clamp(state.heat + debt.severity * 5, 0, MAX_HEAT);
    state.trust = clamp(state.trust - 1, MIN_TRUST, MAX_TRUST);
    if (debt.consequenceId.includes('stock_lock')) state.traderLocks.medicine = now + 6 * 60;
    if (debt.consequenceId.includes('access_lock')) state.traderLocks.access = now + 8 * 60;
    if (debt.consequenceId.includes('raid')) applyBlackMarket88RaidWarning(state, now);
    messages.push(`Просрочен долг ${debt.id}: ${debt.consequenceId}.`);
  }
  return {
    ok: processed > 0,
    reason: processed > 0 ? 'debts_matured' : 'no_due_debts',
    messages,
  };
}

export function applyBlackMarket88RaidWarning(state: Market88DesignState, now: number): Market88DesignResult {
  if (now < state.raidCooldownUntil) {
    return { ok: false, reason: 'raid_cooldown', messages: ['Рейд уже отложен, но рынок не успокоился.'] };
  }
  state.raidWarningUntil = now + 45;
  state.raidCooldownUntil = now + 12 * 60;
  state.traderLocks.weapons = now + 4 * 60;
  state.traderLocks.documents = now + 2 * 60;
  state.heat = clamp(state.heat - 12, 0, MAX_HEAT);
  state.stockVersion++;
  return {
    ok: true,
    reason: 'raid_warning',
    messages: ['Предупреждение рейда: оружие и документы спрятаны, добычи с рейда нет.'],
  };
}

export function applyBlackMarket88SamosborDemand(
  state: Market88DesignState,
  variant: 'classic' | 'wet' | 'electric' | 'meat',
): Market88DesignResult {
  if (variant === 'classic') {
    state.demand.survival = clamp(state.demand.survival + 0.35, 0.75, 2.75);
    state.demand.medicine = clamp(state.demand.medicine + 0.3, 0.75, 2.75);
    state.heat = clamp(state.heat + 4, 0, MAX_HEAT);
  } else if (variant === 'wet') {
    state.demand.survival = clamp(state.demand.survival + 0.25, 0.75, 2.75);
    state.demand.access = clamp(state.demand.access + 0.2, 0.75, 2.75);
  } else if (variant === 'electric') {
    state.demand.weapons = clamp(state.demand.weapons + 0.25, 0.75, 2.75);
    state.traderLocks.weapons = Math.max(state.traderLocks.weapons ?? 0, 3 * 60);
  } else {
    state.demand.documents = clamp(state.demand.documents + 0.2, 0.75, 2.75);
    state.heat = clamp(state.heat + 10, 0, MAX_HEAT);
  }
  state.stockVersion++;
  return { ok: true, reason: `samosbor_${variant}`, messages: [`Спрос рынка изменен: ${variant}.`] };
}

interface MarketRooms {
  publicGate: Room;
  mainLane: Room;
  debtOffice: Room;
  documentGate: Room;
  documentBooth: Room;
  weaponStall: Room;
  medicineLocker: Room;
  serviceHatch: Room;
  courierHideout: Room;
}

export function generateBlackMarket88DesignFloor(): FloorGeneration {
  registerBlackMarket88DesignFloorContent();

  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 1 };

  generateZones(world);
  tuneMarketZones(world);

  const rooms = buildMarketRooms(world);
  linkMarketRooms(world, rooms);
  decorateMarketRooms(world, rooms);
  addAccessLifts(world, rooms);

  const npcs = spawnMarketNpcs(world, entities, nextId, rooms);
  spawnMarketQueueCrowd(world, entities, nextId, rooms);
  seedMarketContainers(world, rooms, npcs);

  sanitizeDoors(world);
  world.bakeLights();

  return {
    world,
    entities,
    spawnX: rooms.publicGate.x + 3.5,
    spawnY: rooms.publicGate.y + Math.floor(rooms.publicGate.h / 2) + 0.5,
  };
}

export function generateBlackMarket88DebugFloor(): FloorGeneration {
  return generateBlackMarket88DesignFloor();
}

type Market88RoomSide = 'north' | 'south' | 'west' | 'east';

interface Market88StallPlacement {
  room: Room;
  laneY: number;
  side: -1 | 1;
}

interface Market88ServiceGutPlacement {
  room: Room;
  side: Market88RoomSide;
  targetX: number;
  targetY: number;
  storage: boolean;
}

interface Market88BazaarRooms {
  auction: Room | null;
  guardWest: Room | null;
  guardEast: Room | null;
  debtCourt: Room | null;
  documentCheckpoint: Room | null;
  tunnelCacheWest: Room | null;
  tunnelCacheEast: Room | null;
  coldStorage: Room | null;
}

interface Market88RoomPlacement {
  room: Room;
  side: Market88RoomSide;
  targetX: number;
  targetY: number;
  doorState: DoorState;
  keyId: string;
}

interface Market88HqClusterSpec {
  owner: ZoneFaction;
  hqName: string;
  x: number;
  y: number;
  w: number;
  h: number;
  side: Market88RoomSide;
  targetX: number;
  targetY: number;
  wallTex: Tex;
  floorTex: Tex;
  support: readonly {
    name: string;
    type: RoomType;
    x: number;
    y: number;
    w: number;
    h: number;
    side: Market88RoomSide;
    targetX: number;
    targetY: number;
    wallTex: Tex;
    floorTex: Tex;
  }[];
}

interface Market88MidBlockSpec {
  name: string;
  type: RoomType;
  x: number;
  y: number;
  w: number;
  h: number;
  side: Market88RoomSide;
  targetX: number;
  targetY: number;
  wallTex: Tex;
  floorTex: Tex;
  doorState?: DoorState;
}

const MARKET88_WEST = 136;
const MARKET88_EAST = W - 136;
const MARKET88_NORTH = 344;
const MARKET88_SOUTH = 680;
const MARKET88_LANE_Y = [376, 424, 472, 500, 548, 596, 644] as const;
const MARKET88_LANE_X = [184, 280, 376, 472, 568, 664, 760, 856] as const;
const MARKET88_STALL_NAMES = [
  'Прилавок сухпайка 88',
  'Лоток тихих патронов 88',
  'Палатка фильтров 88',
  'Стол чужих документов 88',
  'Занавес обмена 88',
  'Склад без вывески 88',
] as const;

export const MARKET88_HQ_ROOM_NAMES = {
  citizen: 'Гермокасса гражданского обмена 88',
  liquidator: 'Гермопост рейдового досмотра 88',
  cultist: 'Гермосвечная долгового шепота 88',
  scientist: 'Гермолаборатория ценового шума 88',
  wild: 'Гермобарак диких поставщиков 88',
} as const;

const MARKET88_HQ_CLUSTERS: readonly Market88HqClusterSpec[] = [
  {
    owner: ZoneFaction.CITIZEN,
    hqName: MARKET88_HQ_ROOM_NAMES.citizen,
    x: 224, y: 214, w: 24, h: 14,
    side: 'south', targetX: 236, targetY: 280,
    wallTex: Tex.HERMO_WALL, floorTex: Tex.F_LINO,
    support: [
      { name: 'Кухня гражданской очереди 88', type: RoomType.KITCHEN, x: 192, y: 238, w: 22, h: 12, side: 'east', targetX: 224, targetY: 260, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      { name: 'Общая комната обменщиков 88', type: RoomType.COMMON, x: 256, y: 238, w: 26, h: 12, side: 'west', targetX: 248, targetY: 260, wallTex: Tex.PANEL, floorTex: Tex.F_LINO },
      { name: 'Санузел входной кассы 88', type: RoomType.BATHROOM, x: 196, y: 196, w: 16, h: 10, side: 'south', targetX: 224, targetY: 238, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      { name: 'Склад честных талонов 88', type: RoomType.STORAGE, x: 288, y: 214, w: 22, h: 10, side: 'west', targetX: 282, targetY: 238, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
    ],
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    hqName: MARKET88_HQ_ROOM_NAMES.liquidator,
    x: 764, y: 214, w: 26, h: 14,
    side: 'south', targetX: 778, targetY: 280,
    wallTex: Tex.HERMO_WALL, floorTex: Tex.F_CONCRETE,
    support: [
      { name: 'Оружейная рейдового досмотра 88', type: RoomType.STORAGE, x: 724, y: 236, w: 28, h: 12, side: 'east', targetX: 764, targetY: 260, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
      { name: 'Комната протокола задвижек 88', type: RoomType.OFFICE, x: 804, y: 236, w: 28, h: 12, side: 'west', targetX: 790, targetY: 260, wallTex: Tex.MARBLE, floorTex: Tex.F_GREEN_CARPET },
      { name: 'Медшкаф рейдовой смены 88', type: RoomType.MEDICAL, x: 724, y: 194, w: 22, h: 10, side: 'south', targetX: 764, targetY: 238, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      { name: 'Санузел поста досмотра 88', type: RoomType.BATHROOM, x: 806, y: 194, w: 18, h: 10, side: 'south', targetX: 790, targetY: 238, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
    ],
  },
  {
    owner: ZoneFaction.CULTIST,
    hqName: MARKET88_HQ_ROOM_NAMES.cultist,
    x: 196, y: 798, w: 24, h: 14,
    side: 'north', targetX: 208, targetY: 760,
    wallTex: Tex.HERMO_WALL, floorTex: Tex.F_RED_CARPET,
    support: [
      { name: 'Свечная кухня долгов 88', type: RoomType.KITCHEN, x: 160, y: 824, w: 24, h: 12, side: 'east', targetX: 196, targetY: 814, wallTex: Tex.DARK, floorTex: Tex.F_GREEN_CARPET },
      { name: 'Исповедальня чужой сдачи 88', type: RoomType.COMMON, x: 232, y: 824, w: 26, h: 12, side: 'west', targetX: 220, targetY: 814, wallTex: Tex.DARK, floorTex: Tex.F_RED_CARPET },
      { name: 'Склад копченых расписок 88', type: RoomType.STORAGE, x: 158, y: 782, w: 24, h: 10, side: 'east', targetX: 196, targetY: 798, wallTex: Tex.ROTTEN, floorTex: Tex.F_CONCRETE },
      { name: 'Санузел свечной очереди 88', type: RoomType.BATHROOM, x: 236, y: 782, w: 18, h: 10, side: 'west', targetX: 220, targetY: 798, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
    ],
  },
  {
    owner: ZoneFaction.SCIENTIST,
    hqName: MARKET88_HQ_ROOM_NAMES.scientist,
    x: 764, y: 798, w: 26, h: 14,
    side: 'north', targetX: 778, targetY: 760,
    wallTex: Tex.HERMO_WALL, floorTex: Tex.F_CONCRETE,
    support: [
      { name: 'Лаборатория серого спроса 88', type: RoomType.PRODUCTION, x: 724, y: 824, w: 30, h: 12, side: 'east', targetX: 764, targetY: 814, wallTex: Tex.PIPE, floorTex: Tex.F_CONCRETE },
      { name: 'Медкабинет ценового шума 88', type: RoomType.MEDICAL, x: 804, y: 824, w: 28, h: 12, side: 'west', targetX: 790, targetY: 814, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      { name: 'Кабинет измерения дефицита 88', type: RoomType.OFFICE, x: 724, y: 782, w: 28, h: 10, side: 'east', targetX: 764, targetY: 798, wallTex: Tex.MARBLE, floorTex: Tex.F_PARQUET },
      { name: 'Склад мерных фильтров 88', type: RoomType.STORAGE, x: 806, y: 782, w: 24, h: 10, side: 'west', targetX: 790, targetY: 798, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
    ],
  },
  {
    owner: ZoneFaction.WILD,
    hqName: MARKET88_HQ_ROOM_NAMES.wild,
    x: 486, y: 802, w: 34, h: 18,
    side: 'north', targetX: 504, targetY: 760,
    wallTex: Tex.HERMO_WALL, floorTex: Tex.F_CONCRETE,
    support: [
      { name: 'Кухня диких поставщиков 88', type: RoomType.KITCHEN, x: 448, y: 830, w: 28, h: 14, side: 'east', targetX: 486, targetY: 820, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      { name: 'Общак ночной выдачи 88', type: RoomType.COMMON, x: 532, y: 830, w: 30, h: 14, side: 'west', targetX: 520, targetY: 820, wallTex: Tex.PANEL, floorTex: Tex.F_LINO },
      { name: 'Западный герморазвал диких 88', type: RoomType.HQ, x: 88, y: 736, w: 22, h: 12, side: 'east', targetX: 136, targetY: 744, wallTex: Tex.HERMO_WALL, floorTex: Tex.F_CONCRETE },
      { name: 'Восточный герморазвал диких 88', type: RoomType.HQ, x: 920, y: 736, w: 22, h: 12, side: 'west', targetX: MARKET88_EAST, targetY: 744, wallTex: Tex.HERMO_WALL, floorTex: Tex.F_CONCRETE },
      { name: 'Склад грязной партии 88', type: RoomType.STORAGE, x: 448, y: 782, w: 30, h: 12, side: 'east', targetX: 486, targetY: 802, wallTex: Tex.BRICK, floorTex: Tex.F_CONCRETE },
      { name: 'Санузел барака поставщиков 88', type: RoomType.BATHROOM, x: 536, y: 782, w: 18, h: 10, side: 'west', targetX: 520, targetY: 802, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
    ],
  },
] as const;

const MARKET88_MID_BLOCKS: readonly Market88MidBlockSpec[] = [
  { name: 'Северная биржа краденых тюков 88', type: RoomType.COMMON, x: 344, y: 222, w: 46, h: 24, side: 'south', targetX: 368, targetY: 280, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE, doorState: DoorState.OPEN },
  { name: 'Северный зал поддельной гарантии 88', type: RoomType.OFFICE, x: 594, y: 222, w: 44, h: 24, side: 'south', targetX: 616, targetY: 280, wallTex: Tex.MARBLE, floorTex: Tex.F_GREEN_CARPET, doorState: DoorState.CLOSED },
  { name: 'Южная биржа мокрых фильтров 88', type: RoomType.COMMON, x: 316, y: 830, w: 46, h: 22, side: 'north', targetX: 338, targetY: 760, wallTex: Tex.BRICK, floorTex: Tex.F_LINO, doorState: DoorState.OPEN },
  { name: 'Южный архив без накладных 88', type: RoomType.STORAGE, x: 628, y: 830, w: 44, h: 22, side: 'north', targetX: 650, targetY: 760, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE, doorState: DoorState.CLOSED },
  { name: 'Западный двор шепотной приемки 88', type: RoomType.COMMON, x: 34, y: 424, w: 34, h: 30, side: 'east', targetX: 56, targetY: 438, wallTex: Tex.PANEL, floorTex: Tex.F_LINO, doorState: DoorState.OPEN },
  { name: 'Восточный двор сухих имен 88', type: RoomType.COMMON, x: 956, y: 424, w: 28, h: 30, side: 'west', targetX: 968, targetY: 438, wallTex: Tex.PANEL, floorTex: Tex.F_LINO, doorState: DoorState.OPEN },
  { name: 'Западная станция чужого веса 88', type: RoomType.PRODUCTION, x: 34, y: 560, w: 34, h: 28, side: 'east', targetX: 56, targetY: 574, wallTex: Tex.PIPE, floorTex: Tex.F_CONCRETE, doorState: DoorState.CLOSED },
  { name: 'Восточная станция рейдовой тишины 88', type: RoomType.PRODUCTION, x: 956, y: 560, w: 28, h: 28, side: 'west', targetX: 968, targetY: 574, wallTex: Tex.PIPE, floorTex: Tex.F_CONCRETE, doorState: DoorState.CLOSED },
] as const;

export const MARKET88_HUB_DEGREE_CAP = 5;

export const MARKET88_GEOMETRY_HUBS = [
  { id: 'entry_gate', x: 392, y: 500, label: 'входная касса' },
  { id: 'auction_pit', x: 514, y: 540, label: 'аукционная яма' },
  { id: 'debt_court', x: 474, y: 574, label: 'долговой суд' },
  { id: 'document_choke', x: 620, y: 444, label: 'документальный кордон' },
  { id: 'west_smuggling', x: MARKET88_WEST + 28, y: 632, label: 'западный контрабандный ход' },
  { id: 'east_smuggling', x: MARKET88_EAST, y: 628, label: 'восточный контрабандный ход' },
  { id: 'cold_storage', x: 704, y: 376, label: 'холодный склад' },
  { id: 'west_service', x: MARKET88_WEST, y: 500, label: 'западная служебная кишка' },
  { id: 'east_service', x: MARKET88_EAST, y: 500, label: 'восточная служебная кишка' },
] as const;

export type Market88GeometryHubId = typeof MARKET88_GEOMETRY_HUBS[number]['id'];

export const MARKET88_SMALL_WORLD_CHORDS: readonly {
  from: Market88GeometryHubId;
  to: Market88GeometryHubId;
  floorTex: Tex;
  width: 1 | 2;
  hidden: boolean;
}[] = [
  { from: 'auction_pit', to: 'entry_gate', floorTex: Tex.F_CONCRETE, width: 2, hidden: false },
  { from: 'auction_pit', to: 'debt_court', floorTex: Tex.F_CONCRETE, width: 2, hidden: false },
  { from: 'auction_pit', to: 'document_choke', floorTex: Tex.F_CONCRETE, width: 2, hidden: false },
  { from: 'auction_pit', to: 'west_smuggling', floorTex: Tex.F_LINO, width: 1, hidden: true },
  { from: 'auction_pit', to: 'east_smuggling', floorTex: Tex.F_LINO, width: 1, hidden: true },
  { from: 'document_choke', to: 'cold_storage', floorTex: Tex.F_TILE, width: 1, hidden: true },
  { from: 'document_choke', to: 'east_service', floorTex: Tex.F_LINO, width: 1, hidden: true },
  { from: 'debt_court', to: 'west_service', floorTex: Tex.F_LINO, width: 1, hidden: true },
  { from: 'west_smuggling', to: 'west_service', floorTex: Tex.F_LINO, width: 1, hidden: true },
  { from: 'east_smuggling', to: 'east_service', floorTex: Tex.F_LINO, width: 1, hidden: true },
] as const;

export const MARKET88_RAID_SHUTTER_GATES = [
  { x: 392, y: 500, axis: 'east_west', bypass: { ax: 382, ay: 488, bx: 404, by: 512 } },
  { x: 622, y: 548, axis: 'east_west', bypass: { ax: 610, ay: 536, bx: 638, by: 564 } },
  { x: 568, y: 424, axis: 'north_south', bypass: { ax: 552, ay: 414, bx: 584, by: 438 } },
  { x: MARKET88_WEST + 28, y: 632, axis: 'east_west', bypass: { ax: MARKET88_WEST + 18, ay: 620, bx: MARKET88_WEST + 48, by: 644 } },
  { x: MARKET88_EAST, y: 628, axis: 'east_west', bypass: { ax: MARKET88_EAST - 18, ay: 616, bx: MARKET88_EAST + 14, by: 640 } },
] as const;

export function expandBlackMarket88Bazaar(world: World, rng: () => number): void {
  const rooms = addBazaarLandmarks(world);
  const serviceGuts = addBazaarServiceGuts(world, rng);
  const hqRooms = addBazaarHqCompounds(world);
  const midBlocks = addBazaarMidBlocks(world, rng);
  const microRooms = addBazaarMicroRooms(world, rng);
  const stalls = addBazaarStallRooms(world, rng);

  carveBazaarAlleys(world);
  carveBazaarOuterRings(world);
  carveBazaarHubChords(world);
  connectBazaarLandmarks(world, rooms);
  connectBazaarServiceGuts(world, serviceGuts);
  connectBazaarRoomPlacements(world, hqRooms);
  connectBazaarRoomPlacements(world, midBlocks);
  connectBazaarRoomPlacements(world, microRooms);
  connectStallsToAlleys(world, stalls);
  addRaidShutters(world);
  decorateBazaarLandmarks(world, rooms);
  decorateBazaarHubChords(world);
  decorateBazaarServiceGuts(world, serviceGuts, rng);
  decorateSmugglingTunnels(world);
  seedBazaarCaches(world, rooms, serviceGuts);
  seedBazaarExpansionCaches(world);
}

function addBazaarLandmarks(world: World): Market88BazaarRooms {
  return {
    auction: tryBazaarRoom(world, RoomType.COMMON, 494, 526, 40, 28, 'Аукционная яма 88', Tex.METAL, Tex.F_CONCRETE),
    guardWest: tryBazaarRoom(world, RoomType.HQ, 438, 486, 12, 9, 'Будка западной задвижки 88', Tex.METAL, Tex.F_CONCRETE),
    guardEast: tryBazaarRoom(world, RoomType.HQ, 574, 538, 12, 9, 'Будка рейдовой задвижки 88', Tex.METAL, Tex.F_CONCRETE),
    debtCourt: tryBazaarRoom(world, RoomType.OFFICE, 462, 568, 24, 14, 'Долговой суд 88', Tex.MARBLE, Tex.F_GREEN_CARPET),
    documentCheckpoint: tryBazaarRoom(world, RoomType.OFFICE, 604, 438, 26, 12, 'Документальный кордон 88', Tex.MARBLE, Tex.F_MARBLE_TILE),
    tunnelCacheWest: tryBazaarRoom(world, RoomType.STORAGE, 168, 626, 18, 10, 'Западный тайник контрабанды 88', Tex.BRICK, Tex.F_LINO),
    tunnelCacheEast: tryBazaarRoom(world, RoomType.STORAGE, 858, 622, 18, 10, 'Восточный тайник контрабанды 88', Tex.PIPE, Tex.F_CONCRETE),
    coldStorage: tryBazaarRoom(world, RoomType.STORAGE, 684, 364, 20, 12, 'Холодный склад без накладной 88', Tex.TILE_W, Tex.F_TILE),
  };
}

function addBazaarServiceGuts(world: World, rng: () => number): Market88ServiceGutPlacement[] {
  const specs: readonly {
    type: RoomType;
    x: number;
    y: number;
    w: number;
    h: number;
    name: string;
    side: Market88RoomSide;
    targetX: number;
    targetY: number;
    wallTex: Tex;
    floorTex: Tex;
  }[] = [
    { type: RoomType.STORAGE, x: 198, y: 306, w: 28, h: 13, name: 'Северный склад краденых тюков 88', side: 'south', targetX: 208, targetY: MARKET88_NORTH, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
    { type: RoomType.PRODUCTION, x: 330, y: 304, w: 32, h: 15, name: 'Сервисная кишка под весами 88', side: 'south', targetX: 344, targetY: MARKET88_NORTH, wallTex: Tex.PIPE, floorTex: Tex.F_CONCRETE },
    { type: RoomType.STORAGE, x: 652, y: 306, w: 30, h: 13, name: 'Склад чужой медицины 88', side: 'south', targetX: 664, targetY: MARKET88_NORTH, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
    { type: RoomType.PRODUCTION, x: 790, y: 306, w: 32, h: 15, name: 'Закрытый перегон поставщика 88', side: 'south', targetX: 792, targetY: MARKET88_NORTH, wallTex: Tex.PIPE, floorTex: Tex.F_CONCRETE },
    { type: RoomType.STORAGE, x: 202, y: 704, w: 28, h: 13, name: 'Южный склад мокрой партии 88', side: 'north', targetX: 216, targetY: MARKET88_SOUTH, wallTex: Tex.BRICK, floorTex: Tex.F_LINO },
    { type: RoomType.PRODUCTION, x: 382, y: 704, w: 32, h: 15, name: 'Задняя мастерская пломб 88', side: 'north', targetX: 392, targetY: MARKET88_SOUTH, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
    { type: RoomType.STORAGE, x: 610, y: 704, w: 30, h: 14, name: 'Темный ряд долговых ящиков 88', side: 'north', targetX: 624, targetY: MARKET88_SOUTH, wallTex: Tex.MARBLE, floorTex: Tex.F_GREEN_CARPET },
    { type: RoomType.PRODUCTION, x: 790, y: 704, w: 34, h: 15, name: 'Мясной протек склада 88', side: 'north', targetX: 808, targetY: MARKET88_SOUTH, wallTex: Tex.PIPE, floorTex: Tex.F_CONCRETE },
    { type: RoomType.PRODUCTION, x: 86, y: 374, w: 26, h: 18, name: 'Западная служебная утроба 88', side: 'east', targetX: MARKET88_WEST, targetY: 384, wallTex: Tex.PIPE, floorTex: Tex.F_CONCRETE },
    { type: RoomType.STORAGE, x: 88, y: 500, w: 24, h: 18, name: 'Клетка должников за занавесом 88', side: 'east', targetX: MARKET88_WEST, targetY: 500, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
    { type: RoomType.PRODUCTION, x: 88, y: 610, w: 26, h: 18, name: 'Западный люк грязного товара 88', side: 'east', targetX: MARKET88_WEST, targetY: 628, wallTex: Tex.PIPE, floorTex: Tex.F_CONCRETE },
    { type: RoomType.STORAGE, x: 912, y: 376, w: 26, h: 18, name: 'Восточная кладовая сухих имен 88', side: 'west', targetX: MARKET88_EAST, targetY: 384, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
    { type: RoomType.PRODUCTION, x: 912, y: 496, w: 28, h: 18, name: 'Восточный сервис рейдовых задвижек 88', side: 'west', targetX: MARKET88_EAST, targetY: 500, wallTex: Tex.PIPE, floorTex: Tex.F_CONCRETE },
    { type: RoomType.STORAGE, x: 912, y: 612, w: 26, h: 18, name: 'Восточный склад черного маршрута 88', side: 'west', targetX: MARKET88_EAST, targetY: 628, wallTex: Tex.BRICK, floorTex: Tex.F_LINO },
  ];
  const placements: Market88ServiceGutPlacement[] = [];
  for (const spec of specs) {
    const room = tryBazaarRoom(
      world,
      spec.type,
      spec.x + Math.floor(rng() * 3) - 1,
      spec.y + Math.floor(rng() * 3) - 1,
      spec.w,
      spec.h,
      spec.name,
      spec.wallTex,
      spec.floorTex,
    );
    if (!room) continue;
    placements.push({ room, side: spec.side, targetX: spec.targetX, targetY: spec.targetY, storage: spec.type === RoomType.STORAGE });
  }
  return placements;
}

function addBazaarHqCompounds(world: World): Market88RoomPlacement[] {
  const placements: Market88RoomPlacement[] = [];
  for (const spec of MARKET88_HQ_CLUSTERS) {
    const hq = tryBazaarRoom(world, RoomType.HQ, spec.x, spec.y, spec.w, spec.h, spec.hqName, spec.wallTex, spec.floorTex);
    if (hq) {
      hq.sealed = true;
      paintBazaarRoomOwner(world, hq, spec.owner);
      paintBazaarOwnerPatch(world, hq.x + (hq.w >> 1), hq.y + (hq.h >> 1), spec.owner, spec.owner === ZoneFaction.WILD ? 32 : 24);
      decorateBazaarOwnedRoom(world, hq, spec.owner, hq.id);
      placements.push({ room: hq, side: spec.side, targetX: spec.targetX, targetY: spec.targetY, doorState: DoorState.HERMETIC_OPEN, keyId: '' });
    }
    for (const support of spec.support) {
      const room = tryBazaarRoom(world, support.type, support.x, support.y, support.w, support.h, support.name, support.wallTex, support.floorTex);
      if (!room) continue;
      if (support.type === RoomType.HQ) room.sealed = true;
      paintBazaarRoomOwner(world, room, spec.owner);
      decorateBazaarOwnedRoom(world, room, spec.owner, room.id);
      placements.push({
        room,
        side: support.side,
        targetX: support.targetX,
        targetY: support.targetY,
        doorState: support.type === RoomType.HQ ? DoorState.HERMETIC_OPEN : support.type === RoomType.STORAGE ? DoorState.CLOSED : DoorState.OPEN,
        keyId: '',
      });
    }
  }
  return placements;
}

function addBazaarMidBlocks(world: World, rng: () => number): Market88RoomPlacement[] {
  const placements: Market88RoomPlacement[] = [];
  for (const spec of MARKET88_MID_BLOCKS) {
    const room = tryBazaarRoom(world, spec.type, spec.x, spec.y, spec.w, spec.h, spec.name, spec.wallTex, spec.floorTex);
    if (!room) continue;
    decorateStallRoom(world, room, rng, spec.type === RoomType.STORAGE || spec.type === RoomType.PRODUCTION);
    placements.push({
      room,
      side: spec.side,
      targetX: spec.targetX,
      targetY: spec.targetY,
      doorState: spec.doorState ?? DoorState.CLOSED,
      keyId: '',
    });
  }
  return placements;
}

function addBazaarMicroRooms(world: World, rng: () => number): Market88RoomPlacement[] {
  const placements: Market88RoomPlacement[] = [];
  let serial = 1;
  const addMicro = (
    prefix: string,
    type: RoomType,
    x: number,
    y: number,
    w: number,
    h: number,
    side: Market88RoomSide,
    targetX: number,
    targetY: number,
    wallTex: Tex,
    floorTex: Tex,
  ): void => {
    const room = tryBazaarRoom(world, type, x, y, w, h, `${prefix} ${serial++}`, wallTex, floorTex);
    if (!room) return;
    decorateStallRoom(world, room, rng, type === RoomType.STORAGE);
    placements.push({
      room,
      side,
      targetX,
      targetY,
      doorState: type === RoomType.STORAGE ? DoorState.CLOSED : DoorState.OPEN,
      keyId: '',
    });
  };

  for (let x = 148; x <= 870; x += 26) {
    const upperType = serial % 6 === 0 ? RoomType.STORAGE : RoomType.COMMON;
    const lowerType = serial % 7 === 0 ? RoomType.STORAGE : RoomType.COMMON;
    addMicro('Микролавка северной верхней дуги 88', upperType, x + Math.floor(rng() * 3), 252 + Math.floor(rng() * 2), 6 + (serial % 3), 5 + (serial % 2), 'south', x + 4, 280, Tex.PANEL, upperType === RoomType.STORAGE ? Tex.F_CONCRETE : Tex.F_LINO);
    addMicro('Микросклад северной нижней дуги 88', lowerType, x + 11 + Math.floor(rng() * 3), 292 + Math.floor(rng() * 2), 6 + (serial % 3), 5 + (serial % 2), 'north', x + 14, 280, Tex.METAL, lowerType === RoomType.STORAGE ? Tex.F_CONCRETE : Tex.F_LINO);
  }

  for (let x = 148; x <= 870; x += 26) {
    const upperType = serial % 5 === 0 ? RoomType.STORAGE : RoomType.COMMON;
    const lowerType = serial % 8 === 0 ? RoomType.STORAGE : RoomType.COMMON;
    addMicro('Микролавка южной верхней дуги 88', upperType, x + Math.floor(rng() * 3), 724 + Math.floor(rng() * 2), 6 + (serial % 3), 5 + (serial % 2), 'south', x + 4, 760, Tex.PANEL, upperType === RoomType.STORAGE ? Tex.F_CONCRETE : Tex.F_LINO);
    addMicro('Микросклад южной нижней дуги 88', lowerType, x + 11 + Math.floor(rng() * 3), 776 + Math.floor(rng() * 2), 6 + (serial % 3), 5 + (serial % 2), 'north', x + 14, 760, Tex.BRICK, lowerType === RoomType.STORAGE ? Tex.F_CONCRETE : Tex.F_LINO);
  }

  for (let y = 344; y <= 694; y += 28) {
    const westType = serial % 5 === 0 ? RoomType.STORAGE : RoomType.COMMON;
    const eastType = serial % 6 === 0 ? RoomType.STORAGE : RoomType.COMMON;
    addMicro('Западная микронить приемки 88', westType, 14 + Math.floor(rng() * 2), y + Math.floor(rng() * 3), 7, 6, 'east', 56, y + 3, Tex.PANEL, westType === RoomType.STORAGE ? Tex.F_CONCRETE : Tex.F_LINO);
    addMicro('Западная внутренняя микроклетка 88', RoomType.COMMON, 72 + Math.floor(rng() * 2), y + 10 + Math.floor(rng() * 3), 7, 6, 'west', 56, y + 12, Tex.METAL, Tex.F_CONCRETE);
    addMicro('Восточная внутренняя микроклетка 88', RoomType.COMMON, 944 + Math.floor(rng() * 2), y + 10 + Math.floor(rng() * 3), 7, 6, 'east', 968, y + 12, Tex.METAL, Tex.F_CONCRETE);
    addMicro('Восточная микронить приемки 88', eastType, 986 + Math.floor(rng() * 2), y + Math.floor(rng() * 3), 7, 6, 'west', 968, y + 3, Tex.PANEL, eastType === RoomType.STORAGE ? Tex.F_CONCRETE : Tex.F_LINO);
  }

  return placements;
}

function addBazaarStallRooms(world: World, rng: () => number): Market88StallPlacement[] {
  const placements: Market88StallPlacement[] = [];
  for (let row = 0; row < MARKET88_LANE_Y.length; row++) {
    const laneY = MARKET88_LANE_Y[row];
    for (let col = 0, x = 154; x <= 840; col++, x += 42) {
      const side: -1 | 1 = ((row + col) & 1) === 0 ? -1 : 1;
      const w = 12 + ((row + col) % 4) * 2 + Math.floor(rng() * 2);
      const h = 6 + Math.floor(rng() * 3);
      const rx = x + Math.floor(rng() * 7);
      const ry = side < 0 ? laneY - h - 6 : laneY + 6;
      if (inMarket88CoreKeepout(world, rx, ry, w, h)) continue;
      const name = MARKET88_STALL_NAMES[(row + col) % MARKET88_STALL_NAMES.length];
      const type = col % 5 === 0 ? RoomType.STORAGE : RoomType.COMMON;
      const room = tryBazaarRoom(world, type, rx, ry, w, h, name, Tex.METAL, col % 3 === 0 ? Tex.F_LINO : Tex.F_CONCRETE);
      if (!room) continue;
      decorateStallRoom(world, room, rng, col % 5 === 0);
      placements.push({ room, laneY, side });
    }
  }
  return placements;
}

function carveBazaarAlleys(world: World): void {
  carveMarketLine(world, MARKET88_WEST, MARKET88_NORTH, MARKET88_EAST, MARKET88_NORTH, 2, Tex.F_CONCRETE);
  carveMarketLine(world, MARKET88_WEST, MARKET88_SOUTH, MARKET88_EAST, MARKET88_SOUTH, 2, Tex.F_CONCRETE);
  carveMarketLine(world, MARKET88_WEST, MARKET88_NORTH, MARKET88_WEST, MARKET88_SOUTH, 2, Tex.F_CONCRETE);
  carveMarketLine(world, MARKET88_EAST, MARKET88_NORTH, MARKET88_EAST, MARKET88_SOUTH, 2, Tex.F_CONCRETE);

  for (const y of MARKET88_LANE_Y) carveMarketLine(world, MARKET88_WEST, y, MARKET88_EAST, y, 2, Tex.F_CONCRETE);
  for (const x of MARKET88_LANE_X) carveMarketLine(world, x, MARKET88_NORTH, x, MARKET88_SOUTH, 2, Tex.F_CONCRETE);

  carveMarketLine(world, 484, 500, MARKET88_WEST, 500, 2, Tex.F_CONCRETE);
  carveMarketLine(world, 536, 500, MARKET88_EAST, 500, 2, Tex.F_CONCRETE);
  carveMarketLine(world, 514, 508, 514, 526, 2, Tex.F_CONCRETE);

  carveMarketLine(world, 518, 474, 518, MARKET88_NORTH, 1, Tex.F_LINO);
  carveMarketLine(world, 535, 508, MARKET88_EAST, 628, 1, Tex.F_LINO);
  carveMarketLine(world, 484, 504, MARKET88_WEST + 28, 632, 1, Tex.F_LINO);
  carveMarketLine(world, 620, 444, 724, MARKET88_NORTH, 1, Tex.F_LINO);
}

function carveBazaarOuterRings(world: World): void {
  carveMarketLine(world, 144, 280, 888, 280, 2, Tex.F_CONCRETE);
  carveMarketLine(world, 144, 760, 888, 760, 2, Tex.F_CONCRETE);
  carveMarketLine(world, 56, 344, 56, 720, 2, Tex.F_LINO);
  carveMarketLine(world, 968, 344, 968, 720, 2, Tex.F_LINO);

  for (const x of [184, 280, 376, 472, 568, 664, 760, 856]) {
    carveMarketLine(world, x, 280, x, MARKET88_NORTH, 1, Tex.F_CONCRETE);
    carveMarketLine(world, x, MARKET88_SOUTH, x, 760, 1, Tex.F_CONCRETE);
  }
  for (const y of [384, 500, 628]) {
    carveMarketLine(world, 56, y, MARKET88_WEST, y, 1, Tex.F_LINO);
    carveMarketLine(world, MARKET88_EAST, y, 968, y, 1, Tex.F_LINO);
  }
}

function carveBazaarHubChords(world: World): void {
  for (const hub of MARKET88_GEOMETRY_HUBS) {
    carveMarketDisc(world, hub.x, hub.y, hub.id === 'auction_pit' ? 4 : 3, hub.id.includes('smuggling') ? Tex.F_LINO : Tex.F_CONCRETE);
  }

  for (const chord of MARKET88_SMALL_WORLD_CHORDS) {
    const from = market88Hub(chord.from);
    const to = market88Hub(chord.to);
    carveMarketLine(world, from.x, from.y, to.x, to.y, chord.width, chord.floorTex);
  }
}

function decorateBazaarHubChords(world: World): void {
  for (const hub of MARKET88_GEOMETRY_HUBS) {
    const feature = hub.id === 'auction_pit'
      ? Feature.SCREEN
      : hub.id.includes('smuggling')
        ? Feature.CANDLE
        : hub.id.includes('service')
          ? Feature.MACHINE
          : Feature.TABLE;
    setMarketFeature(world, hub.x, hub.y, feature);
    setMarketFeature(world, hub.x + 2, hub.y, hub.id.includes('smuggling') ? Feature.SHELF : Feature.LAMP);
  }

  for (const chord of MARKET88_SMALL_WORLD_CHORDS) {
    if (!chord.hidden) continue;
    const from = market88Hub(chord.from);
    const to = market88Hub(chord.to);
    const mx = world.wrap(Math.round(from.x + world.delta(from.x, to.x) * 0.5));
    const my = world.wrap(Math.round(from.y + world.delta(from.y, to.y) * 0.5));
    setMarketFeature(world, mx, my, Feature.CANDLE);
  }
}

function market88Hub(id: Market88GeometryHubId): (typeof MARKET88_GEOMETRY_HUBS)[number] {
  const hub = MARKET88_GEOMETRY_HUBS.find(candidate => candidate.id === id);
  if (!hub) throw new Error(`Missing black market 88 hub: ${id}`);
  return hub;
}

function connectBazaarLandmarks(world: World, rooms: Market88BazaarRooms): void {
  if (rooms.auction) {
    connectRoomToPoint(world, rooms.auction, 'north', rooms.auction.x + (rooms.auction.w >> 1), 500, DoorState.CLOSED, '');
    connectRoomToPoint(world, rooms.auction, 'west', 472, rooms.auction.y + (rooms.auction.h >> 1), DoorState.CLOSED, '');
    connectRoomToPoint(world, rooms.auction, 'east', 568, rooms.auction.y + (rooms.auction.h >> 1), DoorState.CLOSED, '');
    connectRoomToPoint(world, rooms.auction, 'south', rooms.auction.x + (rooms.auction.w >> 1), 596, DoorState.CLOSED, '');
  }
  if (rooms.guardWest) connectRoomToPoint(world, rooms.guardWest, 'east', 472, 500, DoorState.CLOSED, '');
  if (rooms.guardEast) connectRoomToPoint(world, rooms.guardEast, 'west', 568, 548, DoorState.CLOSED, '');
  if (rooms.debtCourt) connectRoomToPoint(world, rooms.debtCourt, 'north', 472, 548, DoorState.LOCKED, 'key');
  if (rooms.documentCheckpoint) connectRoomToPoint(world, rooms.documentCheckpoint, 'south', 608, 472, DoorState.LOCKED, 'key');
  if (rooms.tunnelCacheWest) connectRoomToPoint(world, rooms.tunnelCacheWest, 'north', MARKET88_WEST + 28, 632, DoorState.HERMETIC_CLOSED, '');
  if (rooms.tunnelCacheEast) connectRoomToPoint(world, rooms.tunnelCacheEast, 'west', MARKET88_EAST, 628, DoorState.HERMETIC_CLOSED, '');
  if (rooms.coldStorage) connectRoomToPoint(world, rooms.coldStorage, 'south', 704, 376, DoorState.LOCKED, 'key');
}

function connectBazaarServiceGuts(world: World, placements: Market88ServiceGutPlacement[]): void {
  for (const placement of placements) {
    connectRoomToPoint(
      world,
      placement.room,
      placement.side,
      placement.targetX,
      placement.targetY,
      placement.storage ? DoorState.LOCKED : DoorState.HERMETIC_CLOSED,
      placement.storage ? 'key' : '',
    );
  }
}

function connectBazaarRoomPlacements(world: World, placements: readonly Market88RoomPlacement[]): void {
  for (const placement of placements) {
    connectRoomToPoint(world, placement.room, placement.side, placement.targetX, placement.targetY, placement.doorState, placement.keyId);
  }
}

function connectStallsToAlleys(world: World, placements: Market88StallPlacement[]): void {
  for (const placement of placements) {
    const side: Market88RoomSide = placement.side < 0 ? 'south' : 'north';
    connectRoomToPoint(
      world,
      placement.room,
      side,
      placement.room.x + (placement.room.w >> 1),
      placement.laneY,
      placement.room.type === RoomType.STORAGE ? DoorState.CLOSED : DoorState.OPEN,
      '',
    );
  }
}

function addRaidShutters(world: World): void {
  for (const gate of MARKET88_RAID_SHUTTER_GATES) {
    addShutterGate(world, gate.x, gate.y, gate.axis);
    addShutterBypass(world, gate.bypass.ax, gate.bypass.ay, gate.bypass.bx, gate.bypass.by);
  }
}

function addShutterBypass(world: World, ax: number, ay: number, bx: number, by: number): void {
  carveMarketLine(world, ax, ay, bx, ay, 1, Tex.F_LINO);
  carveMarketLine(world, bx, ay, bx, by, 1, Tex.F_LINO);
  setMarketFeature(world, ax, ay, Feature.CANDLE);
  setMarketFeature(world, bx, by, Feature.SHELF);
}

function decorateBazaarLandmarks(world: World, rooms: Market88BazaarRooms): void {
  if (rooms.auction) {
    const room = rooms.auction;
    const cx = room.x + (room.w >> 1);
    const cy = room.y + (room.h >> 1);
    stampSurfaceSplat(world, cx, cy, 0.5, 0.5, 12, 0.18, 88013, 74, 58, 30, false);
    for (let dx = 6; dx < room.w - 5; dx += 5) {
      setMarketFeature(world, room.x + dx, room.y + 4, Feature.TABLE);
      setMarketFeature(world, room.x + dx, room.y + room.h - 5, Feature.DESK);
    }
    for (let dy = 6; dy < room.h - 5; dy += 5) {
      setMarketFeature(world, room.x + 4, room.y + dy, Feature.CHAIR);
      setMarketFeature(world, room.x + room.w - 5, room.y + dy, Feature.SHELF);
    }
    setMarketFeature(world, cx, cy, Feature.SCREEN);
    setMarketFeature(world, cx - 6, cy, Feature.LAMP);
    setMarketFeature(world, cx + 6, cy, Feature.LAMP);
  }

  for (const room of [rooms.guardWest, rooms.guardEast]) {
    if (!room) continue;
    setMarketFeature(world, room.x + 2, room.y + 2, Feature.DESK);
    setMarketFeature(world, room.x + room.w - 3, room.y + 2, Feature.SCREEN);
    setMarketFeature(world, room.x + 2, room.y + room.h - 3, Feature.SHELF);
    setMarketFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.LAMP);
  }

  for (const room of [rooms.debtCourt, rooms.documentCheckpoint]) {
    if (!room) continue;
    for (let dx = 3; dx < room.w - 2; dx += 5) setMarketFeature(world, room.x + dx, room.y + 2, Feature.DESK);
    setMarketFeature(world, room.x + room.w - 4, room.y + room.h - 3, Feature.SHELF);
    setMarketFeature(world, room.x + 3, room.y + room.h - 3, Feature.LAMP);
  }

  for (const room of [rooms.tunnelCacheWest, rooms.tunnelCacheEast, rooms.coldStorage]) {
    if (!room) continue;
    decorateStallRoom(world, room, () => 0.35, true);
  }
}

function decorateBazaarServiceGuts(world: World, placements: Market88ServiceGutPlacement[], rng: () => number): void {
  for (let i = 0; i < placements.length; i++) {
    const room = placements[i].room;
    decorateStallRoom(world, room, rng, placements[i].storage);
    const cx = room.x + (room.w >> 1);
    const cy = room.y + (room.h >> 1);
    setMarketFeature(world, cx, cy, placements[i].storage ? Feature.SHELF : Feature.MACHINE);
    if (!placements[i].storage && room.w > 10) setMarketFeature(world, room.x + room.w - 4, room.y + room.h - 4, Feature.APPARATUS);
    if (i % 3 === 0) setMarketFeature(world, room.x + 3, room.y + room.h - 3, Feature.CANDLE);
  }
}

function decorateBazaarOwnedRoom(world: World, room: Room, owner: ZoneFaction, salt: number): void {
  if (room.type === RoomType.BATHROOM) {
    setMarketFeature(world, room.x + 2, room.y + 2, Feature.SINK);
    setMarketFeature(world, room.x + Math.max(3, room.w - 3), room.y + Math.max(3, room.h - 3), Feature.TOILET);
    return;
  }
  if (room.type === RoomType.KITCHEN) {
    setMarketFeature(world, room.x + 2, room.y + 2, Feature.SINK);
    setMarketFeature(world, room.x + Math.max(3, room.w - 4), room.y + 2, Feature.TABLE);
    setMarketFeature(world, room.x + (room.w >> 1), room.y + Math.max(3, room.h - 3), Feature.SHELF);
    return;
  }
  if (room.type === RoomType.MEDICAL) {
    setMarketFeature(world, room.x + 2, room.y + 2, Feature.APPARATUS);
    setMarketFeature(world, room.x + Math.max(3, room.w - 4), room.y + 2, Feature.SHELF);
    setMarketFeature(world, room.x + (room.w >> 1), room.y + Math.max(3, room.h - 3), Feature.LAMP);
    return;
  }
  if (room.type === RoomType.PRODUCTION) {
    setMarketFeature(world, room.x + 2, room.y + 2, Feature.MACHINE);
    setMarketFeature(world, room.x + Math.max(3, room.w - 4), room.y + Math.max(3, room.h - 3), Feature.APPARATUS);
    return;
  }
  if (room.type === RoomType.STORAGE) {
    decorateStallRoom(world, room, () => ((salt * 37) % 100) / 100, true);
    return;
  }
  if (room.type === RoomType.HQ) {
    setMarketFeature(world, room.x + 3, room.y + 2, owner === ZoneFaction.CULTIST ? Feature.CANDLE : Feature.SCREEN);
    setMarketFeature(world, room.x + Math.max(4, room.w - 4), room.y + 2, Feature.DESK);
    setMarketFeature(world, room.x + (room.w >> 1), room.y + Math.max(4, room.h - 4), owner === ZoneFaction.WILD ? Feature.SHELF : Feature.LAMP);
    if (owner === ZoneFaction.CULTIST) {
      stampSurfaceSplat(world, room.x + (room.w >> 1), room.y + (room.h >> 1), 0.5, 0.5, 3, 0.2, 88200 + salt, 118, 42, 164, true);
    }
    return;
  }
  setMarketFeature(world, room.x + 2, room.y + 2, Feature.TABLE);
  setMarketFeature(world, room.x + Math.max(3, room.w - 4), room.y + 2, Feature.SHELF);
  setMarketFeature(world, room.x + (room.w >> 1), room.y + Math.max(3, room.h - 3), owner === ZoneFaction.CULTIST ? Feature.CANDLE : Feature.LAMP);
}

function decorateSmugglingTunnels(world: World): void {
  for (let x = MARKET88_WEST + 28; x < 484; x += 34) {
    setMarketFeature(world, x, 632, x % 68 === 0 ? Feature.CANDLE : Feature.SHELF);
  }
  for (let x = 552; x < MARKET88_EAST; x += 38) {
    setMarketFeature(world, x, 628, x % 76 === 0 ? Feature.CANDLE : Feature.MACHINE);
  }
  for (let y = MARKET88_NORTH + 12; y < 472; y += 28) {
    setMarketFeature(world, 518, y, y % 56 === 0 ? Feature.CANDLE : Feature.SHELF);
  }
}

function seedBazaarCaches(world: World, rooms: Market88BazaarRooms, serviceGuts: readonly Market88ServiceGutPlacement[]): void {
  if (rooms.tunnelCacheWest) {
    addContainer(world, rooms.tunnelCacheWest, 9, 5, ContainerKind.SECRET_STASH, 'Тайник западного обхода 88', 'secret', 5, [
      { defId: 'fake_pass', count: 1 },
      { defId: 'blank_form', count: 1 },
      { defId: 'cigs', count: 3 },
    ], ['market88', 'contraband_cache', 'smuggling_tunnel'], undefined, Faction.WILD, 4, false);
  }
  if (rooms.tunnelCacheEast) {
    addContainer(world, rooms.tunnelCacheEast, 8, 5, ContainerKind.SECRET_STASH, 'Тайник восточного обхода 88', 'secret', 6, [
      { defId: 'ammo_9mm', count: 10 },
      { defId: 'gasmask_filter', count: 1 },
      { defId: 'voluntary_receipt', count: 1 },
    ], ['market88', 'contraband_cache', 'raid_bypass'], undefined, Faction.WILD, 5, false);
  }
  if (rooms.coldStorage) {
    addContainer(world, rooms.coldStorage, 11, 6, ContainerKind.METAL_CABINET, 'Холодный шкаф без накладной 88', 'locked', 7, [
      { defId: 'pills', count: 2 },
      { defId: 'water', count: 2 },
      { defId: 'door_kit', count: 1 },
    ], ['market88', 'contraband_cache', 'cold_storage'], undefined, Faction.CITIZEN, 4);
  }
  const cacheDefs: readonly {
    name: string;
    kind: ContainerKind;
    access: ContainerAccess;
    capacitySlots: number;
    inventory: Item[];
    tags: string[];
    faction?: Faction;
    lockDifficulty?: number;
    discovered?: boolean;
  }[] = [
    {
      name: 'Серый тюк поставщика 88',
      kind: ContainerKind.SECRET_STASH,
      access: 'faction',
      capacitySlots: 6,
      inventory: [
        { defId: 'caravan_route', count: 1 },
        { defId: 'ration_registry_extract', count: 1 },
        { defId: 'govnyak_bad_batch', count: 1 },
      ],
      tags: ['market88', 'contraband_cache', 'supplier_betrayal', 'caravan', 'theft'],
      faction: Faction.WILD,
      lockDifficulty: 5,
    },
    {
      name: 'Сейф черного маршрута 88',
      kind: ContainerKind.SAFE,
      access: 'locked',
      capacitySlots: 7,
      inventory: [
        { defId: 'metro_ticket', count: 1 },
        { defId: 'forged_bank_debt_paper', count: 1 },
        { defId: 'container_key_label', count: 1 },
      ],
      tags: ['market88', 'black_route_papers', 'debt', 'documents', 'contraband_cache'],
      faction: Faction.WILD,
      lockDifficulty: 7,
    },
    {
      name: 'Шкаф панической медицины 88',
      kind: ContainerKind.MEDICAL_CABINET,
      access: 'faction',
      capacitySlots: 6,
      inventory: [
        { defId: 'antibiotic', count: 1 },
        { defId: 'pills', count: 2 },
        { defId: 'morphine_ampoule', count: 1 },
      ],
      tags: ['market88', 'medicine', 'scarcity', 'panic_buying', 'theft'],
      faction: Faction.CITIZEN,
      lockDifficulty: 4,
    },
    {
      name: 'Ящик рейдовой задвижки 88',
      kind: ContainerKind.TOOL_LOCKER,
      access: 'locked',
      capacitySlots: 6,
      inventory: [
        { defId: 'door_kit', count: 1 },
        { defId: 'gasmask_filter', count: 1 },
        { defId: 'fuse', count: 2 },
      ],
      tags: ['market88', 'raid_shutter', 'samosbor', 'service_guts'],
      faction: Faction.LIQUIDATOR,
      lockDifficulty: 6,
    },
  ];
  for (let i = 0; i < Math.min(cacheDefs.length, serviceGuts.length); i++) {
    const room = serviceGuts[i].room;
    const def = cacheDefs[i];
    addContainer(world, room, Math.max(2, room.w - 4), Math.max(2, Math.floor(room.h / 2)), def.kind, def.name, def.access, def.capacitySlots, def.inventory, def.tags, undefined, def.faction, def.lockDifficulty, def.discovered ?? true);
  }
}

function seedBazaarExpansionCaches(world: World): void {
  const cacheDefs: readonly {
    roomName: string;
    name: string;
    kind: ContainerKind;
    access: ContainerAccess;
    inventory: Item[];
    tags: string[];
    owner: ZoneFaction;
    lockDifficulty?: number;
    discovered?: boolean;
  }[] = [
    {
      roomName: 'Склад честных талонов 88',
      name: 'Ящик гражданских талонов 88',
      kind: ContainerKind.METAL_CABINET,
      access: 'faction',
      inventory: [{ defId: 'water_coupon', count: 2 }, { defId: 'bread', count: 2 }, { defId: 'voluntary_receipt', count: 1 }],
      tags: ['market88', 'hq_support', 'citizen', 'ration'],
      owner: ZoneFaction.CITIZEN,
      lockDifficulty: 3,
    },
    {
      roomName: 'Оружейная рейдового досмотра 88',
      name: 'Шкаф рейдового досмотра 88',
      kind: ContainerKind.TOOL_LOCKER,
      access: 'faction',
      inventory: [{ defId: 'ammo_9mm', count: 12 }, { defId: 'door_kit', count: 1 }, { defId: 'liquidator_token', count: 1 }],
      tags: ['market88', 'hq_support', 'liquidator', 'raid'],
      owner: ZoneFaction.LIQUIDATOR,
      lockDifficulty: 5,
    },
    {
      roomName: 'Склад копченых расписок 88',
      name: 'Коптилка долговых расписок 88',
      kind: ContainerKind.SECRET_STASH,
      access: 'secret',
      inventory: [{ defId: 'voluntary_receipt', count: 2 }, { defId: 'cigs', count: 2 }, { defId: 'denunciation', count: 1 }],
      tags: ['market88', 'hq_support', 'cultist', 'debt'],
      owner: ZoneFaction.CULTIST,
      lockDifficulty: 4,
      discovered: false,
    },
    {
      roomName: 'Склад мерных фильтров 88',
      name: 'Холодный ящик мерных фильтров 88',
      kind: ContainerKind.MEDICAL_CABINET,
      access: 'faction',
      inventory: [{ defId: 'gasmask_filter', count: 1 }, { defId: 'antibiotic', count: 1 }, { defId: 'blank_form', count: 1 }],
      tags: ['market88', 'hq_support', 'scientist', 'measurement'],
      owner: ZoneFaction.SCIENTIST,
      lockDifficulty: 5,
    },
    {
      roomName: 'Склад грязной партии 88',
      name: 'Тюк грязной партии 88',
      kind: ContainerKind.SECRET_STASH,
      access: 'secret',
      inventory: [{ defId: 'stolen_filter_pack', count: 1 }, { defId: 'ammo_9mm', count: 8 }, { defId: 'metro_ticket', count: 1 }],
      tags: ['market88', 'hq_support', 'wild', 'contraband'],
      owner: ZoneFaction.WILD,
      lockDifficulty: 5,
      discovered: false,
    },
    {
      roomName: 'Южный архив без накладных 88',
      name: 'Архивный сейф без накладных 88',
      kind: ContainerKind.SAFE,
      access: 'locked',
      inventory: [{ defId: 'fake_pass', count: 1 }, { defId: 'caravan_route', count: 1 }, { defId: 'forged_bank_debt_paper', count: 1 }],
      tags: ['market88', 'mid_block', 'documents', 'contraband_cache'],
      owner: ZoneFaction.WILD,
      lockDifficulty: 7,
    },
  ];
  for (const def of cacheDefs) {
    const room = world.rooms.find(candidate => candidate.name === def.roomName);
    if (!room) continue;
    addContainer(
      world,
      room,
      Math.max(2, room.w - 4),
      Math.max(2, Math.floor(room.h / 2)),
      def.kind,
      def.name,
      def.access,
      6,
      def.inventory,
      def.tags,
      undefined,
      market88OwnerFaction(def.owner),
      def.lockDifficulty,
      def.discovered ?? true,
    );
  }
}

function market88OwnerFaction(owner: ZoneFaction): Faction {
  switch (owner) {
    case ZoneFaction.LIQUIDATOR: return Faction.LIQUIDATOR;
    case ZoneFaction.CULTIST: return Faction.CULTIST;
    case ZoneFaction.SCIENTIST: return Faction.SCIENTIST;
    case ZoneFaction.WILD: return Faction.WILD;
    case ZoneFaction.CITIZEN:
    default:
      return Faction.CITIZEN;
  }
}

function market88AuthoredRoomOwner(room: Room): ZoneFaction | undefined {
  for (const spec of MARKET88_HQ_CLUSTERS) {
    if (room.name === spec.hqName) return spec.owner;
    for (const support of spec.support) {
      if (room.name === support.name) return spec.owner;
    }
  }
  return undefined;
}

function market88AuthoredConnection(room: Room): Market88RoomPlacement | undefined {
  for (const spec of MARKET88_HQ_CLUSTERS) {
    if (room.name === spec.hqName) {
      return { room, side: spec.side, targetX: spec.targetX, targetY: spec.targetY, doorState: DoorState.HERMETIC_OPEN, keyId: '' };
    }
    for (const support of spec.support) {
      if (room.name !== support.name) continue;
      return {
        room,
        side: support.side,
        targetX: support.targetX,
        targetY: support.targetY,
        doorState: support.type === RoomType.HQ ? DoorState.HERMETIC_OPEN : support.type === RoomType.STORAGE ? DoorState.CLOSED : DoorState.OPEN,
        keyId: '',
      };
    }
  }
  return undefined;
}

function restoreBlackMarket88FallbackRoomType(room: Room): void {
  if (market88AuthoredRoomOwner(room) !== undefined) return;
  if (room.type !== RoomType.HQ) return;
  if (room.name === 'Рыночные ряды 88') room.type = RoomType.COMMON;
  else if (room.name === 'Служебный люк 88') room.type = RoomType.PRODUCTION;
  else if (room.name === 'Долговой суд 88' || room.name === 'Документальный кордон 88') room.type = RoomType.OFFICE;
  else if (room.name.startsWith('Будка ')) room.type = RoomType.OFFICE;
}

function hasHermeticOpenDoor(world: World, room: Room): boolean {
  return room.doors.some(doorIdx => world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN);
}

export function reinforceBlackMarket88AuthoredHqTerritory(world: World): void {
  for (const room of world.rooms) {
    if (room) restoreBlackMarket88FallbackRoomType(room);
  }
  for (const room of world.rooms) {
    if (!room) continue;
    const owner = market88AuthoredRoomOwner(room);
    if (owner === undefined) continue;
    const isCore = room.name === MARKET88_HQ_ROOM_NAMES.citizen ||
      room.name === MARKET88_HQ_ROOM_NAMES.liquidator ||
      room.name === MARKET88_HQ_ROOM_NAMES.cultist ||
      room.name === MARKET88_HQ_ROOM_NAMES.scientist ||
      room.name === MARKET88_HQ_ROOM_NAMES.wild ||
      room.name === 'Западный герморазвал диких 88' ||
      room.name === 'Восточный герморазвал диких 88';
    if (isCore) {
      room.type = RoomType.HQ;
      room.sealed = true;
      room.wallTex = Tex.HERMO_WALL;
      if (!hasHermeticOpenDoor(world, room)) {
        const connection = market88AuthoredConnection(room);
        if (connection) connectRoomToPoint(world, room, connection.side, connection.targetX, connection.targetY, DoorState.HERMETIC_OPEN, '');
      }
      for (let dy = -1; dy <= room.h; dy++) {
        for (let dx = -1; dx <= room.w; dx++) {
          const idx = world.idx(room.x + dx, room.y + dy);
          const inside = dx >= 0 && dx < room.w && dy >= 0 && dy < room.h;
          if (!inside && world.cells[idx] === Cell.WALL && !world.aptMask[idx]) {
            world.hermoWall[idx] = 1;
            world.wallTex[idx] = Tex.HERMO_WALL;
          }
        }
      }
      paintBazaarOwnerPatch(world, room.x + (room.w >> 1), room.y + (room.h >> 1), owner, owner === ZoneFaction.WILD ? 36 : 26);
    }
    paintBazaarRoomOwner(world, room, owner);
  }
  addRaidShutters(world);
  syncZoneMetadataFromTerritory(world);
  markBlackMarket88ServiceGutZonesHostile(world);
  world.markWallTexDirty();
}

function markBlackMarket88ServiceGutZonesHostile(world: World): void {
  for (const zone of world.zones) {
    const northSouthGuts = zone.cx >= 180 && zone.cx <= 844 &&
      ((zone.cy >= 286 && zone.cy <= 356) || (zone.cy >= 676 && zone.cy <= 736));
    const westEastGuts = zone.cy >= 344 && zone.cy <= 660 &&
      (zone.cx <= 180 || zone.cx >= 844);
    if (!northSouthGuts && !westEastGuts) continue;
    zone.faction = zone.id % 5 === 0 ? ZoneFaction.SAMOSBOR : ZoneFaction.WILD;
    zone.level = Math.max(zone.level, 4);
    zone.fogged = false;
  }
}

function tryBazaarRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
): Room | null {
  if (!canFitBazaarRoom(world, x, y, w, h)) return null;
  return makeRoom(world, world.rooms.length, type, x, y, w, h, name, wallTex, floorTex);
}

function paintBazaarRoomOwner(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[idx] === room.id && !world.aptMask[idx]) world.factionControl[idx] = owner;
    }
  }
  for (const idx of room.doors) {
    if (!world.aptMask[idx]) world.factionControl[idx] = owner;
  }
}

function paintBazaarOwnerPatch(world: World, cx: number, cy: number, owner: TerritoryOwner, radius: number): void {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const idx = world.idx(cx + dx, cy + dy);
      if (world.aptMask[idx] || world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.ABYSS) continue;
      world.factionControl[idx] = owner;
    }
  }
}

function canFitBazaarRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  for (const room of world.rooms) {
    if (rectsOverlap(x - 1, y - 1, w + 2, h + 2, room.x - 1, room.y - 1, room.w + 2, room.h + 2)) return false;
  }
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const i = world.idx(x + dx, y + dy);
      if (world.cells[i] !== Cell.WALL || world.doors.has(i)) return false;
    }
  }
  return true;
}

function rectsOverlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function inMarket88CoreKeepout(world: World, x: number, y: number, w: number, h: number): boolean {
  const cx = x + (w >> 1);
  const cy = y + (h >> 1);
  return Math.abs(world.delta(cx, 512)) < 92 && Math.abs(world.delta(cy, 512)) < 96;
}

function connectRoomToPoint(
  world: World,
  room: Room,
  side: Market88RoomSide,
  targetX: number,
  targetY: number,
  state: DoorState,
  keyId: string,
): void {
  const offset = side === 'north' || side === 'south'
    ? Math.max(2, Math.min(room.w - 3, room.w >> 1))
    : Math.max(2, Math.min(room.h - 3, room.h >> 1));
  const door = addRoomDoor(world, room, side, offset, state, keyId);
  if (!door) return;
  const sx = side === 'west' ? door.x - 1 : side === 'east' ? door.x + 1 : door.x;
  const sy = side === 'north' ? door.y - 1 : side === 'south' ? door.y + 1 : door.y;
  carveMarketLine(world, sx, sy, targetX, targetY, 1, Tex.F_CONCRETE);
}

function addRoomDoor(
  world: World,
  room: Room,
  side: Market88RoomSide,
  offset: number,
  state: DoorState,
  keyId: string,
): { x: number; y: number } | null {
  const x = side === 'west' ? room.x - 1 : side === 'east' ? room.x + room.w : room.x + offset;
  const y = side === 'north' ? room.y - 1 : side === 'south' ? room.y + room.h : room.y + offset;
  addDoorCell(world, x, y, state, room.id, -1, keyId);
  return { x, y };
}

function addShutterGate(world: World, x: number, y: number, axis: 'east_west' | 'north_south'): void {
  if (axis === 'east_west') {
    carveMarketCell(world, x - 1, y, Tex.F_CONCRETE);
    carveMarketCell(world, x + 1, y, Tex.F_CONCRETE);
    setMarketWall(world, x, y - 1, Tex.METAL);
    setMarketWall(world, x, y + 1, Tex.METAL);
  } else {
    carveMarketCell(world, x, y - 1, Tex.F_CONCRETE);
    carveMarketCell(world, x, y + 1, Tex.F_CONCRETE);
    setMarketWall(world, x - 1, y, Tex.METAL);
    setMarketWall(world, x + 1, y, Tex.METAL);
  }
  addDoorCell(world, x, y, DoorState.HERMETIC_CLOSED, -1, -1, '');
  stampSurfaceSplat(world, x, y, 0.5, 0.5, 2, 0.35, 88100 + x + y, 112, 88, 38, true);
}

function addDoorCell(world: World, x: number, y: number, state: DoorState, roomA: number, roomB: number, keyId: string): void {
  const i = world.idx(x, y);
  if (world.cells[i] === Cell.LIFT) return;
  world.cells[i] = Cell.DOOR;
  world.roomMap[i] = -1;
  world.wallTex[i] = Tex.DOOR_METAL;
  world.floorTex[i] = Tex.F_CONCRETE;
  world.doors.set(i, { idx: i, state, roomA, roomB, keyId, timer: 0 });
  const a = world.rooms[roomA];
  if (a && !a.doors.includes(i)) a.doors.push(i);
  const b = world.rooms[roomB];
  if (b && !b.doors.includes(i)) b.doors.push(i);
}

function carveMarketLine(world: World, ax: number, ay: number, bx: number, by: number, width: number, floorTex: Tex): void {
  let x = world.wrap(ax);
  let y = world.wrap(ay);
  const tx = world.wrap(bx);
  const ty = world.wrap(by);
  const sx = tx === x ? 0 : world.delta(x, tx) > 0 ? 1 : -1;
  const sy = ty === y ? 0 : world.delta(y, ty) > 0 ? 1 : -1;
  let guard = 0;
  while (x !== tx && guard++ < W) {
    carveMarketDisc(world, x, y, width, floorTex);
    x = world.wrap(x + sx);
  }
  guard = 0;
  while (y !== ty && guard++ < W) {
    carveMarketDisc(world, x, y, width, floorTex);
    y = world.wrap(y + sy);
  }
  carveMarketDisc(world, x, y, width, floorTex);
}

function carveMarketDisc(world: World, cx: number, cy: number, r: number, floorTex: Tex): void {
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      carveMarketCell(world, cx + dx, cy + dy, floorTex);
    }
  }
}

function carveMarketCell(world: World, x: number, y: number, floorTex: Tex): void {
  const i = world.idx(x, y);
  if (world.cells[i] === Cell.LIFT || world.cells[i] === Cell.DOOR) return;
  world.cells[i] = Cell.FLOOR;
  if (world.roomMap[i] < 0) world.roomMap[i] = -1;
  world.floorTex[i] = floorTex;
}

function setMarketWall(world: World, x: number, y: number, wallTex: Tex): void {
  const i = world.idx(x, y);
  if (world.cells[i] === Cell.LIFT || world.roomMap[i] >= 0 || world.containerMap.has(i)) return;
  world.cells[i] = Cell.WALL;
  world.roomMap[i] = -1;
  world.features[i] = Feature.NONE;
  world.wallTex[i] = wallTex;
}

function setMarketFeature(world: World, x: number, y: number, feature: Feature): void {
  const i = world.idx(x, y);
  if (world.cells[i] !== Cell.FLOOR || world.features[i] !== Feature.NONE || world.containerMap.has(i)) return;
  world.features[i] = feature;
}

function decorateStallRoom(world: World, room: Room, rng: () => number, storage: boolean): void {
  for (let dx = 2; dx < room.w - 2; dx += 4) {
    setMarketFeature(world, room.x + dx, room.y + 2, storage ? Feature.SHELF : Feature.DESK);
  }
  if (room.h > 6) {
    setMarketFeature(world, room.x + 2, room.y + room.h - 3, storage ? Feature.MACHINE : Feature.TABLE);
    setMarketFeature(world, room.x + room.w - 3, room.y + room.h - 3, rng() < 0.5 ? Feature.CANDLE : Feature.LAMP);
  }
}

function buildMarketRooms(world: World): MarketRooms {
  const x = 492;
  const y = 492;
  return {
    publicGate: makeRoom(world, 0, RoomType.CORRIDOR, x - 11, y + 5, 10, 6, 'Парольный вход 88', Tex.METAL, Tex.F_CONCRETE),
    mainLane: makeRoom(world, 1, RoomType.COMMON, x, y, 36, 16, 'Рыночные ряды 88', Tex.METAL, Tex.F_CONCRETE),
    debtOffice: makeRoom(world, 2, RoomType.OFFICE, x + 3, y - 11, 12, 10, 'Долговая контора 88', Tex.METAL, Tex.F_GREEN_CARPET),
    documentGate: makeRoom(world, 3, RoomType.CORRIDOR, x + 20, y - 18, 12, 6, 'Документальный вход 88', Tex.MARBLE, Tex.F_MARBLE_TILE),
    documentBooth: makeRoom(world, 4, RoomType.OFFICE, x + 20, y - 11, 12, 10, 'Бумажная будка 88', Tex.MARBLE, Tex.F_RED_CARPET),
    weaponStall: makeRoom(world, 5, RoomType.STORAGE, x + 3, y + 17, 13, 9, 'Оружейный ряд 88', Tex.METAL, Tex.F_CONCRETE),
    medicineLocker: makeRoom(world, 6, RoomType.MEDICAL, x + 20, y + 17, 13, 9, 'Лекарственный шкаф 88', Tex.TILE_W, Tex.F_TILE),
    serviceHatch: makeRoom(world, 7, RoomType.PRODUCTION, x + 37, y + 5, 10, 6, 'Служебный люк 88', Tex.PIPE, Tex.F_CONCRETE),
    courierHideout: makeRoom(world, 8, RoomType.SMOKING, x + 37, y + 13, 10, 8, 'Курьерская щель 88', Tex.BRICK, Tex.F_LINO),
  };
}

function makeRoom(
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
): Room {
  const room = stampRoom(world, id, type, x, y, w, h, -1);
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

function linkMarketRooms(world: World, rooms: MarketRooms): void {
  placeSharedDoor(world, rooms.publicGate, rooms.mainLane, DoorState.CLOSED, '');
  placeSharedDoor(world, rooms.mainLane, rooms.debtOffice, DoorState.CLOSED, '');
  placeSharedDoor(world, rooms.mainLane, rooms.documentBooth, DoorState.LOCKED, 'key');
  placeSharedDoor(world, rooms.documentGate, rooms.documentBooth, DoorState.LOCKED, 'key');
  placeSharedDoor(world, rooms.mainLane, rooms.weaponStall, DoorState.CLOSED, '');
  placeSharedDoor(world, rooms.mainLane, rooms.medicineLocker, DoorState.CLOSED, '');
  placeSharedDoor(world, rooms.mainLane, rooms.serviceHatch, DoorState.LOCKED, 'key');
  placeSharedDoor(world, rooms.serviceHatch, rooms.courierHideout, DoorState.HERMETIC_CLOSED, '');
}

function placeSharedDoor(world: World, a: Room, b: Room, state: DoorState, keyId: string): void {
  const candidates: number[] = [];
  for (let dy = -1; dy <= a.h; dy++) {
    for (let dx = -1; dx <= a.w; dx++) {
      if (dx >= 0 && dx < a.w && dy >= 0 && dy < a.h) continue;
      const wx = world.wrap(a.x + dx);
      const wy = world.wrap(a.y + dy);
      const i = world.idx(wx, wy);
      if (world.cells[i] !== Cell.WALL) continue;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (world.roomMap[world.idx(wx + ox, wy + oy)] === b.id && world.roomMap[world.idx(wx - ox, wy - oy)] === a.id) {
          candidates.push(i);
          break;
        }
      }
    }
  }
  if (candidates.length === 0) return;
  const doorIdx = candidates[Math.floor(candidates.length / 2)];
  world.cells[doorIdx] = Cell.DOOR;
  world.doors.set(doorIdx, { idx: doorIdx, state, roomA: a.id, roomB: b.id, keyId, timer: 0 });
  a.doors.push(doorIdx);
  b.doors.push(doorIdx);
}

function decorateMarketRooms(world: World, rooms: MarketRooms): void {
  for (let dx = 3; dx < rooms.mainLane.w - 3; dx += 4) {
    world.features[world.idx(rooms.mainLane.x + dx, rooms.mainLane.y + 4)] = Feature.DESK;
    world.features[world.idx(rooms.mainLane.x + dx, rooms.mainLane.y + 11)] = Feature.SHELF;
  }
  for (let dx = 4; dx < rooms.mainLane.w - 4; dx += 8) {
    world.features[world.idx(rooms.mainLane.x + dx, rooms.mainLane.y + 2)] = Feature.LAMP;
  }
  world.features[world.idx(rooms.debtOffice.x + 3, rooms.debtOffice.y + 3)] = Feature.DESK;
  world.features[world.idx(rooms.debtOffice.x + 8, rooms.debtOffice.y + 2)] = Feature.SHELF;
  world.features[world.idx(rooms.debtOffice.x + 6, rooms.debtOffice.y + 7)] = Feature.LAMP;

  world.features[world.idx(rooms.documentBooth.x + 2, rooms.documentBooth.y + 2)] = Feature.DESK;
  world.features[world.idx(rooms.documentBooth.x + 7, rooms.documentBooth.y + 2)] = Feature.SHELF;
  world.features[world.idx(rooms.documentBooth.x + 9, rooms.documentBooth.y + 7)] = Feature.LAMP;

  for (let dx = 2; dx < rooms.weaponStall.w - 1; dx += 3) {
    world.features[world.idx(rooms.weaponStall.x + dx, rooms.weaponStall.y + 2)] = Feature.SHELF;
  }
  world.features[world.idx(rooms.weaponStall.x + 7, rooms.weaponStall.y + 6)] = Feature.MACHINE;

  for (let dx = 2; dx < rooms.medicineLocker.w - 1; dx += 3) {
    world.features[world.idx(rooms.medicineLocker.x + dx, rooms.medicineLocker.y + 2)] = Feature.SHELF;
  }
  world.features[world.idx(rooms.medicineLocker.x + 7, rooms.medicineLocker.y + 6)] = Feature.APPARATUS;

  world.features[world.idx(rooms.serviceHatch.x + 4, rooms.serviceHatch.y + 3)] = Feature.MACHINE;
  world.features[world.idx(rooms.courierHideout.x + 3, rooms.courierHideout.y + 3)] = Feature.CHAIR;
  world.features[world.idx(rooms.courierHideout.x + 7, rooms.courierHideout.y + 4)] = Feature.CANDLE;
}

function addAccessLifts(world: World, rooms: MarketRooms): void {
  addLiftGate(world, rooms.publicGate, rooms.publicGate.x - 1, rooms.publicGate.y + 3, rooms.publicGate.x, rooms.publicGate.y + 3, LiftDirection.UP);
  addLiftGate(world, rooms.serviceHatch, rooms.serviceHatch.x + rooms.serviceHatch.w, rooms.serviceHatch.y + 3, rooms.serviceHatch.x + rooms.serviceHatch.w - 1, rooms.serviceHatch.y + 3, LiftDirection.DOWN);
  addLiftGate(world, rooms.documentGate, rooms.documentGate.x + 6, rooms.documentGate.y - 1, rooms.documentGate.x + 6, rooms.documentGate.y, LiftDirection.UP);
}

function addLiftGate(world: World, room: Room, liftX: number, liftY: number, buttonX: number, buttonY: number, direction: LiftDirection): void {
  const i = world.idx(liftX, liftY);
  world.cells[i] = Cell.LIFT;
  world.roomMap[i] = -1;
  world.wallTex[i] = Tex.LIFT_DOOR;
  world.floorTex[i] = Tex.F_CONCRETE;
  world.liftDir[i] = direction;
  const bi = world.idx(buttonX, buttonY);
  world.features[bi] = Feature.LIFT_BUTTON;
  world.liftDir[bi] = direction;
  void room;
}

function spawnMarketNpcs(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  rooms: MarketRooms,
): Record<string, Entity> {
  const npcs: Record<string, Entity> = {};
  npcs.market88_marta_broker = spawnNpc(world, entities, nextId, rooms.mainLane, 'market88_marta_broker', 10, 3, Math.PI / 2, true);
  npcs.market88_mikhail_debt = spawnNpc(world, entities, nextId, rooms.debtOffice, 'market88_mikhail_debt', 5, 5, Math.PI / 2, true);
  npcs.market88_zlata_silence = spawnNpc(world, entities, nextId, rooms.documentBooth, 'market88_zlata_silence', 5, 5, Math.PI, true);
  npcs.market88_zhoka_knife = spawnNpc(world, entities, nextId, rooms.weaponStall, 'market88_zhoka_knife', 6, 5, -Math.PI / 2, true, 'makarov');
  npcs.market88_uliana_cash = spawnNpc(world, entities, nextId, rooms.mainLane, 'market88_uliana_cash', 23, 12, -Math.PI / 2, false, undefined, {
    spriteScale: 0.72,
  });
  npcs.market88_courier_sasha = spawnNpc(world, entities, nextId, rooms.courierHideout, 'market88_courier_sasha', 5, 4, Math.PI, false);
  return npcs;
}

function spawnNpc(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  room: Room,
  plotNpcId: string,
  dx: number,
  dy: number,
  angle: number,
  canGiveQuest: boolean,
  weapon?: string,
  extra?: Partial<Entity>,
): Entity {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const entity = requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle,
    weapon,
    canGiveQuest,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
    extra,
  });
  return entity;
}

function spawnMarketQueueCrowd(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  rooms: MarketRooms,
): void {
  const spots: readonly { name: string; faction: Faction; occupation: Occupation; x: number; y: number; item: string; weapon?: string }[] = [
    { name: 'Очередник с пустым талоном 88', faction: Faction.CITIZEN, occupation: Occupation.TRAVELER, x: rooms.publicGate.x + 2, y: rooms.publicGate.y + 2, item: 'water_coupon' },
    { name: 'Покупательница сухого пайка 88', faction: Faction.CITIZEN, occupation: Occupation.HOUSEWIFE, x: rooms.mainLane.x + 4, y: rooms.mainLane.y + 8, item: 'bread' },
    { name: 'Молчаливый должник 88', faction: Faction.CITIZEN, occupation: Occupation.SECRETARY, x: rooms.debtOffice.x + 2, y: rooms.debtOffice.y + 2, item: 'voluntary_receipt' },
    { name: 'Сторож оружейной очереди 88', faction: Faction.LIQUIDATOR, occupation: Occupation.HUNTER, x: rooms.weaponStall.x + 2, y: rooms.weaponStall.y + 6, item: 'liquidator_token', weapon: 'makarov' },
    { name: 'Пациент у лекарственного долга 88', faction: Faction.CITIZEN, occupation: Occupation.TRAVELER, x: rooms.medicineLocker.x + 2, y: rooms.medicineLocker.y + 6, item: 'bandage' },
    { name: 'Слушательница бумажной будки 88', faction: Faction.WILD, occupation: Occupation.SECRETARY, x: rooms.documentBooth.x + 2, y: rooms.documentBooth.y + 6, item: 'blank_form' },
    { name: 'Человек у закрытого люка 88', faction: Faction.CITIZEN, occupation: Occupation.TRAVELER, x: rooms.serviceHatch.x + 3, y: rooms.serviceHatch.y + 2, item: 'metro_ticket' },
    { name: 'Курьер с чужим фильтром 88', faction: Faction.CITIZEN, occupation: Occupation.TRAVELER, x: rooms.courierHideout.x + 2, y: rooms.courierHideout.y + 2, item: 'gasmask_filter' },
    { name: 'Скупщик слуха 88', faction: Faction.WILD, occupation: Occupation.STOREKEEPER, x: rooms.mainLane.x + 9, y: rooms.mainLane.y + 13, item: 'cigs' },
    { name: 'Проверяющий рядов 88', faction: Faction.LIQUIDATOR, occupation: Occupation.HUNTER, x: rooms.mainLane.x + 16, y: rooms.mainLane.y + 2, item: 'note', weapon: 'makarov' },
    { name: 'Женщина с пустой аптечкой 88', faction: Faction.CITIZEN, occupation: Occupation.DOCTOR, x: rooms.medicineLocker.x + 7, y: rooms.medicineLocker.y + 6, item: 'sanitary_kit' },
    { name: 'Держатель очереди 88', faction: Faction.CITIZEN, occupation: Occupation.STOREKEEPER, x: rooms.mainLane.x + 21, y: rooms.mainLane.y + 4, item: 'ration_registry_extract' },
    { name: 'Ночной свидетель 88', faction: Faction.CITIZEN, occupation: Occupation.TRAVELER, x: rooms.mainLane.x + 27, y: rooms.mainLane.y + 13, item: 'tea' },
    { name: 'Серый проводник 88', faction: Faction.WILD, occupation: Occupation.TRAVELER, x: rooms.serviceHatch.x + 8, y: rooms.serviceHatch.y + 4, item: 'door_kit' },
    { name: 'Патронный счетчик 88', faction: Faction.LIQUIDATOR, occupation: Occupation.HUNTER, x: rooms.weaponStall.x + 10, y: rooms.weaponStall.y + 6, item: 'ammo_9mm', weapon: 'makarov' },
    { name: 'Последний у кассы 88', faction: Faction.CITIZEN, occupation: Occupation.TRAVELER, x: rooms.publicGate.x + 7, y: rooms.publicGate.y + 3, item: 'bread' },
  ];

  for (let i = 0; i < Math.min(MARKET88_QUEUE_CROWD_CAP, spots.length); i++) {
    const spot = spots[i];
    const x = world.wrap(spot.x);
    const y = world.wrap(spot.y);
    entities.push({
      id: nextId.v++,
      type: EntityType.NPC,
      x: x + 0.5,
      y: y + 0.5,
      angle: Math.random() * Math.PI * 2,
      pitch: 0,
      alive: true,
      speed: 0.72,
      sprite: spot.occupation,
      name: spot.name,
      needs: freshNeeds(),
      hp: spot.faction === Faction.LIQUIDATOR ? 120 : 80,
      maxHp: spot.faction === Faction.LIQUIDATOR ? 120 : 80,
      money: 4 + (i % 5) * 8,
      ai: { goal: AIGoal.IDLE, tx: x + 0.5, ty: y + 0.5, path: [], pi: 0, stuck: 0, timer: 0 },
      inventory: [{ defId: spot.item, count: 1 }],
      weapon: spot.weapon,
      faction: spot.faction,
      occupation: spot.occupation,
      canGiveQuest: false,
      questId: -1,
    });
  }
}

function seedMarketContainers(world: World, rooms: MarketRooms, npcs: Record<string, Entity>): void {
  addContainer(world, rooms.publicGate, 5, 3, ContainerKind.CASHBOX, 'Входная касса 88', 'owner', 5, [
    { defId: 'metro_ticket', count: 1 },
    { defId: 'water_coupon', count: 1 },
    { defId: 'voluntary_receipt', count: 1 },
  ], ['market88', 'entry_toll', 'crowd_pressure', 'debt'], npcs.market88_uliana_cash);

  addContainer(world, rooms.mainLane, 5, 12, ContainerKind.CASHBOX, 'Касса Ульяны 88', 'owner', 8, [
    { defId: 'water', count: 2 },
    { defId: 'bread', count: 2 },
    { defId: 'cigs', count: 4 },
    { defId: 'govnyak_roll', count: 2 },
    { defId: 'voluntary_receipt', count: 1 },
  ], ['market88', 'purchase', 'limited_stock', 'no_buyback'], npcs.market88_uliana_cash);

  addContainer(world, rooms.debtOffice, 9, 5, ContainerKind.SAFE, 'Сейф долговой тетради 88', 'locked', 6, [
    { defId: 'voluntary_receipt', count: 2 },
    { defId: 'denunciation', count: 1 },
    { defId: 'blank_form', count: 2 },
    { defId: 'govnyak_bad_batch', count: 1 },
  ], ['market88', 'debt', 'audit', 'raid_warning'], npcs.market88_mikhail_debt, Faction.CITIZEN, 4);

  addContainer(world, rooms.documentBooth, 8, 6, ContainerKind.FILING_CABINET, 'Папка чужих печатей 88', 'owner', 7, [
    { defId: 'fake_pass', count: 1 },
    { defId: 'blank_form', count: 2 },
    { defId: 'denunciation', count: 1 },
    { defId: 'note', count: 1, data: '88: документ открывает дверь один раз, потом открывает дело.' },
  ], ['market88', 'documents', 'contract', 'steal_stamp'], npcs.market88_zlata_silence);

  addContainer(world, rooms.weaponStall, 9, 5, ContainerKind.WEAPON_CRATE, 'Запертый оружейный ящик 88', 'faction', 6, [
    { defId: 'shock_baton', count: 1 },
    { defId: 'pushkin_shotgun', count: 1 },
    { defId: 'ammo_9mm', count: 18 },
    { defId: 'ammo_shells', count: 3 },
    { defId: 'liquidator_token', count: 1 },
  ], ['market88', 'weapons', 'control', 'ovb', 'raid_lock', 'theft'], npcs.market88_zhoka_knife, Faction.LIQUIDATOR, 3);

  addContainer(world, rooms.medicineLocker, 9, 5, ContainerKind.MEDICAL_CABINET, 'Лекарственный долг 88', 'owner', 6, [
    { defId: 'pills', count: 2 },
    { defId: 'antibiotic', count: 1 },
    { defId: 'morphine_ampoule', count: 1 },
    { defId: 'sanitary_kit', count: 1 },
  ], ['market88', 'medicine', 'scarcity', 'debt'], npcs.market88_marta_broker);

  addContainer(world, rooms.serviceHatch, 6, 3, ContainerKind.TOOL_LOCKER, 'Люк проводника 88', 'secret', 5, [
    { defId: 'gasmask_filter', count: 1 },
    { defId: 'metro_ticket', count: 1 },
    { defId: 'door_kit', count: 1 },
  ], ['market88', 'access', 'maintenance_hatch', 'secret'], undefined, undefined, 2, false);
}

function addContainer(
  world: World,
  room: Room,
  dx: number,
  dy: number,
  kind: ContainerKind,
  name: string,
  access: ContainerAccess,
  capacitySlots: number,
  inventory: Item[],
  tags: string[],
  owner?: Entity,
  faction?: Faction,
  lockDifficulty?: number,
  discovered = true,
): void {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const container: WorldContainer = {
    id: world.containers.length + 1,
    x,
    y,
    floor: BLACK_MARKET_88_CONTAINER_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind,
    name,
    inventory: inventory.map(i => ({ ...i })),
    capacitySlots,
    ownerNpcId: owner?.id,
    ownerName: owner?.name,
    faction: faction ?? owner?.faction,
    access,
    lockDifficulty,
    discovered,
    tags,
  };
  world.addContainer(container);
}

function tuneMarketZones(world: World): void {
  for (const zone of world.zones) {
    zone.level = 3;
    zone.fogged = false;
    zone.faction = zone.id % 5 === 0 ? ZoneFaction.LIQUIDATOR : ZoneFaction.CITIZEN;
    zone.hasLift = false;
  }
}

function isBlackMarket88AmbientNpc(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    entity.alive &&
    !entity.plotNpcId &&
    !entity.persistentNpcId &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    entity.faction !== undefined;
}

function blackMarket88TerritorySpawnCells(world: World): Map<TerritoryOwner, number[]> {
  const cells = new Map<TerritoryOwner, number[]>([
    [ZoneFaction.CITIZEN, []],
    [ZoneFaction.LIQUIDATOR, []],
    [ZoneFaction.CULTIST, []],
    [ZoneFaction.SCIENTIST, []],
    [ZoneFaction.WILD, []],
  ]);
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

export function alignBlackMarket88AmbientNpcTerritory(world: World, entities: Entity[]): void {
  const cells = blackMarket88TerritorySpawnCells(world);
  const offsets = new Uint16Array(8);
  for (const entity of entities) {
    if (!isBlackMarket88AmbientNpc(entity) || entity.faction === undefined) continue;
    const owner = factionToTerritoryOwner(entity.faction);
    const list = cells.get(owner);
    if (!list || list.length === 0) continue;
    const offset = offsets[owner]++ | 0;
    const cell = list[(entity.id * 139 + offset * 487) % list.length];
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
