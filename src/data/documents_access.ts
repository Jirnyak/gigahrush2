import {
  Faction,
  FloorLevel,
  ItemType,
  RoomType,
  type Entity,
  type ItemDef,
  type WorldEventPrivacy,
  type WorldEventSeverity,
} from '../core/types';
import { MAX_INVENTORY_SLOTS, MAX_ITEM_STACK } from './inventory_limits';

function addDocumentUseOutput(e: Entity, defId: string, count: number): void {
  const inv = e.inventory ?? (e.inventory = []);
  let left = Math.floor(count);
  if (!Number.isFinite(left) || left <= 0) return;
  for (const slot of inv) {
    if (left <= 0) return;
    if (slot.defId !== defId || slot.data !== undefined || slot.count >= MAX_ITEM_STACK) continue;
    const add = Math.min(left, MAX_ITEM_STACK - slot.count);
    slot.count += add;
    left -= add;
  }
  while (left > 0 && inv.length < MAX_INVENTORY_SLOTS) {
    const add = Math.min(left, MAX_ITEM_STACK);
    inv.push({ defId, count: add });
    left -= add;
  }
}

function redeemRifleCoupon(e: Entity): string {
  addDocumentUseOutput(e, 'ammo_762', 6);
  return 'Талон на винтовочные патроны погашен: выдали шесть 7.62.';
}

const DECON_COMPLETION_STAMP_TAGS = ['document', 'decon', 'stamp', 'official', 'cleanup', 'liquidator', 'maintenance', 'trade'] as const;
const PART_TICKET_TAGS = ['document', 'permit', 'official', 'party', 'access', 'document_gate'] as const;
const RAIL_SWITCH_ORDER_TAGS = ['document', 'order', 'official', 'rail', 'transport', 'route_permit', 'access', 'document_gate'] as const;

export const DOCUMENT_ACCESS_ITEMS: Record<string, ItemDef> = {
  liquidator_field_roster: {
    id: 'liquidator_field_roster',
    name: 'Полевая ведомость ликвидаторов',
    type: ItemType.MISC,
    desc: 'Список группы зачистки с маршрутной строкой. Можно сдать, спрятать или продать тем, кто ищет пропавший отряд.',
    spawnRooms: [RoomType.HQ, RoomType.OFFICE, RoomType.STORAGE],
    spawnW: 0.35,
    value: 70,
    stack: 2,
  },
  scrubbed_weapon_tag: {
    id: 'scrubbed_weapon_tag',
    name: 'Сбитая оружейная бирка',
    type: ItemType.MISC,
    desc: 'Номер сбит до металла. Рынок берет как тишину, ликвидаторы - как повод.',
    spawnRooms: [RoomType.SMOKING, RoomType.STORAGE],
    spawnW: 0.25,
    value: 50,
    stack: 4,
  },
  ammo_coupon_9mm: {
    id: 'ammo_coupon_9mm',
    name: 'Талон на 9мм',
    type: ItemType.MISC,
    desc: 'Малый патронный талон. Гасится на десять девяток, если шкаф еще признает смену.',
    spawnRooms: [RoomType.OFFICE, RoomType.HQ],
    spawnW: 0.35,
    value: 45,
    stack: 6,
  },
  ammo_coupon_shells: {
    id: 'ammo_coupon_shells',
    name: 'Талон на дробь',
    type: ItemType.MISC,
    desc: 'Бумага на короткую пачку дроби. Для коридора полезнее жалобы.',
    spawnRooms: [RoomType.OFFICE, RoomType.HQ],
    spawnW: 0.25,
    value: 62,
    stack: 4,
  },
  ammo_rifle_coupon: {
    id: 'ammo_rifle_coupon',
    name: 'Талон на винтовочные патроны',
    type: ItemType.MISC,
    desc: 'Закрытая бумага на малую выдачу 7.62. Погасить на шесть патронов или беречь для оружейного окна.',
    spawnRooms: [RoomType.HQ, RoomType.OFFICE],
    spawnW: 0.18,
    value: 96,
    stack: 4,
    use: redeemRifleCoupon,
  },
  fuel_issue_stamp: {
    id: 'fuel_issue_stamp',
    name: 'Штамп выдачи топлива',
    type: ItemType.MISC,
    desc: 'Масляный штамп на огневой запас. Один раз превращается в канистру бензина.',
    spawnRooms: [RoomType.HQ, RoomType.PRODUCTION, RoomType.OFFICE],
    spawnW: 0.18,
    value: 76,
    tags: ['document', 'stamp', 'fuel', 'single_use', 'official', 'liquidator'],
    stack: 3,
  },
  gusl_index_page: {
    id: 'gusl_index_page',
    name: 'Страница индекса ГУСЛ',
    type: ItemType.NOTE,
    desc: 'Страница классификатора снаряжения: номера важнее названий. Архив берет ее как подсказку к уставной выдаче.',
    spawnRooms: [RoomType.OFFICE, RoomType.HQ, RoomType.STORAGE],
    spawnW: 0.22,
    value: 60,
    tags: ['document', 'gusl', 'index', 'official', 'lore', 'access'],
    stack: 1,
  },
  gusl_index_fragment: {
    id: 'gusl_index_fragment',
    name: 'Обрывок ГУСЛ',
    type: ItemType.MISC,
    desc: 'Кусок индекса с половиной номера. Архивист спорит о странном стволе, рынок покупает подсказку без целой страницы.',
    spawnRooms: [RoomType.OFFICE, RoomType.STORAGE],
    spawnW: 0.4,
    value: 28,
    stack: 5,
  },
  foam_grenade_act: {
    id: 'foam_grenade_act',
    name: 'Акт выдачи 6П10',
    type: ItemType.MISC,
    desc: 'Акт на одну пеногранату 6П10. Сберечь до оружейного окна или погасить, пока журнал не передумал.',
    spawnRooms: [RoomType.HQ, RoomType.OFFICE],
    spawnW: 0.18,
    value: 72,
    stack: 2,
  },
  contraband_receipt_blank: {
    id: 'contraband_receipt_blank',
    name: 'Пустая расписка контрабанды',
    type: ItemType.MISC,
    desc: 'Расписка без товара и подписи. Самая дорогая часть сделки - пустое место.',
    spawnRooms: [RoomType.SMOKING, RoomType.OFFICE, RoomType.STORAGE],
    spawnW: 0.28,
    value: 44,
    stack: 5,
  },
  contaminated_sample_act: {
    id: 'contaminated_sample_act',
    name: 'Акт испорченной пробы',
    type: ItemType.MISC,
    desc: 'Документ, где плохая проба становится виноватым шкафом. НИИ и ликвидаторы читают его по-разному.',
    spawnRooms: [RoomType.MEDICAL, RoomType.OFFICE],
    spawnW: 0.24,
    value: 58,
    tags: ['document', 'nii', 'sample', 'contaminated', 'evidence', 'audit'],
    stack: 3,
  },
  quarantine_breach_notice: {
    id: 'quarantine_breach_notice',
    name: 'Извещение о нарушении карантина',
    type: ItemType.MISC,
    desc: 'Красная бумага: кто прошел, где дышал, почему теперь спорят у санитарного окна.',
    spawnRooms: [RoomType.MEDICAL, RoomType.OFFICE, RoomType.HQ],
    spawnW: 0.28,
    value: 66,
    stack: 3,
  },
  decon_completion_stamp: {
    id: 'decon_completion_stamp',
    name: 'Штамп санобработки',
    type: ItemType.MISC,
    desc: 'Мокрая отметка о зачистке. Пол может быть грязным, но журнал уже успокоился; рынок берет ее как доказательство санобработки.',
    spawnRooms: [RoomType.HQ, RoomType.MEDICAL, RoomType.PRODUCTION],
    spawnW: 0.32,
    value: 55,
    tags: DECON_COMPLETION_STAMP_TAGS,
    stack: 4,
  },
  resident_identity_stub: {
    id: 'resident_identity_stub',
    name: 'Корешок удостоверения личности',
    type: ItemType.MISC,
    desc: 'Отрывной корешок с комнатой и фамилией. Его можно вернуть соседям, продать рынку или отдать вместо объяснений.',
    spawnRooms: [RoomType.LIVING, RoomType.OFFICE, RoomType.COMMON],
    spawnW: 0.8,
    value: 32,
    stack: 6,
  },
  part_ticket: {
    id: 'part_ticket',
    name: 'Партбилет',
    type: ItemType.MISC,
    desc: 'Высокая бумага для низкого коридора. На посту ее читают медленнее, чем пропуск, но тише спорят.',
    spawnRooms: [RoomType.OFFICE, RoomType.HQ],
    spawnW: 0.08,
    value: 160,
    tags: PART_TICKET_TAGS,
    stack: 1,
  },
  labor_shift_card: {
    id: 'labor_shift_card',
    name: 'Карта смены',
    type: ItemType.MISC,
    desc: 'Рабочая карта со строкой цеха. Можно предъявить у поста N3, сберечь для проходной смены или продать рынку.',
    spawnRooms: [RoomType.PRODUCTION, RoomType.OFFICE],
    spawnW: 0.55,
    value: 24,
    tags: ['document', 'permit', 'official', 'labor', 'production', 'access', 'document_gate'],
    stack: 8,
  },
  hazard_shift_extension: {
    id: 'hazard_shift_extension',
    name: 'Допуск на сверхсмену',
    type: ItemType.MISC,
    desc: 'Разрешение работать там, где нормальная смена уже вышла. Риск вписан мелким шрифтом.',
    spawnRooms: [RoomType.PRODUCTION, RoomType.HQ, RoomType.OFFICE],
    spawnW: 0.28,
    value: 58,
    stack: 4,
  },
  terminal_order_receipt: {
    id: 'terminal_order_receipt',
    name: 'Квитанция терминального заказа',
    type: ItemType.MISC,
    desc: 'Чек заказа из терминала. Товар где-то едет, спор уже приехал.',
    spawnRooms: [RoomType.OFFICE, RoomType.COMMON],
    spawnW: 0.35,
    value: 36,
    stack: 4,
  },
  mail_intercept_slip: {
    id: 'mail_intercept_slip',
    name: 'Лист перехвата почты',
    type: ItemType.MISC,
    desc: 'Почтовый лист с чужим маршрутом. Можно вернуть, украсть дальше или продать адрес.',
    spawnRooms: [RoomType.OFFICE, RoomType.SMOKING, RoomType.STORAGE],
    spawnW: 0.3,
    value: 46,
    stack: 4,
  },
  rail_depot_pass: {
    id: 'rail_depot_pass',
    name: 'Пропуск в депо',
    type: ItemType.MISC,
    desc: 'Транспортный пропуск на линию, которой нет в свежих схемах. Старые двери помнят лучше людей.',
    spawnRooms: [RoomType.OFFICE, RoomType.PRODUCTION, RoomType.CORRIDOR],
    spawnW: 0.14,
    value: 95,
    stack: 2,
  },
  rail_switch_order: {
    id: 'rail_switch_order',
    name: 'Ордер стрелочного перевода',
    type: ItemType.MISC,
    desc: 'Приказ на перевод стрелки. Его можно предъявить у поста, продать рынку или сберечь до будки управления.',
    spawnRooms: [RoomType.OFFICE, RoomType.PRODUCTION],
    spawnW: 0.12,
    value: 110,
    tags: RAIL_SWITCH_ORDER_TAGS,
    stack: 2,
  },
  samosbor_alarm_schedule: {
    id: 'samosbor_alarm_schedule',
    name: 'График тревог',
    type: ItemType.MISC,
    desc: 'График учебных и настоящих тревог. Не предсказывает Самосбор, зато объясняет ложные сирены.',
    spawnRooms: [RoomType.OFFICE, RoomType.HQ, RoomType.COMMON],
    spawnW: 0.3,
    value: 52,
    stack: 2,
  },
  shelter_seat_card: {
    id: 'shelter_seat_card',
    name: 'Карточка места в укрытии',
    type: ItemType.MISC,
    desc: 'Честная карточка на одно место у гермодвери. Соседи читают ее громче сирены.',
    spawnRooms: [RoomType.COMMON, RoomType.OFFICE, RoomType.HQ],
    spawnW: 0.32,
    value: 68,
    stack: 4,
  },
  shelter_seat_forgery: {
    id: 'shelter_seat_forgery',
    name: 'Поддельная карточка укрытия',
    type: ItemType.MISC,
    desc: 'Липовое место в укрытии. Дверь может поверить, но очередь помнит лица.',
    spawnRooms: [RoomType.SMOKING, RoomType.OFFICE, RoomType.COMMON],
    spawnW: 0.2,
    value: 46,
    stack: 4,
  },
  water_reservoir_quota: {
    id: 'water_reservoir_quota',
    name: 'Квота резервуара воды',
    type: ItemType.MISC,
    desc: 'Квота на малую выдачу воды. Бумага сухая, очередь мокрая.',
    spawnRooms: [RoomType.OFFICE, RoomType.KITCHEN, RoomType.HQ],
    spawnW: 0.28,
    value: 34,
    stack: 4,
  },
  concentrate_bonus_coupon: {
    id: 'concentrate_bonus_coupon',
    name: 'Премиальный талон концентрата',
    type: ItemType.MISC,
    desc: 'Талон на усиленную пайку. Очередь видит слово премия и считает ваши зубы.',
    spawnRooms: [RoomType.OFFICE, RoomType.KITCHEN, RoomType.HQ],
    spawnW: 0.24,
    value: 42,
    stack: 4,
  },
  ovb_search_warrant: {
    id: 'ovb_search_warrant',
    name: 'Ордер ОВБ на обыск',
    type: ItemType.MISC,
    desc: 'Жесткий ордер на чужой шкаф и чужие оправдания. Легальная сила с нелегким эхом.',
    spawnRooms: [RoomType.HQ, RoomType.OFFICE],
    spawnW: 0.06,
    value: 210,
    stack: 1,
  },
};

export const DOCUMENT_ACCESS_ITEM_TAGS: Record<string, readonly string[]> = {
  liquidator_issue_card: ['document', 'permit', 'official', 'liquidator', 'issue', 'access', 'field_kit', 'single_use', 'document_gate'],
  liquidator_field_roster: ['document', 'liquidator', 'roster', 'evidence', 'route', 'audit'],
  weapon_checkout_tag: ['document', 'weapon', 'weapon_permit', 'audit', 'official', 'evidence', 'armory'],
  scrubbed_weapon_tag: ['document', 'weapon_permit', 'contraband', 'audit', 'forgery'],
  ammo_coupon_9mm: ['document', 'coupon', 'weapon_permit', 'ammo', 'single_use', 'official'],
  ammo_coupon_shells: ['document', 'coupon', 'weapon_permit', 'ammo', 'single_use', 'official'],
  ammo_rifle_coupon: ['document', 'coupon', 'weapon_permit', 'rifle', 'ammo_762', 'single_use', 'official', 'liquidator'],
  fuel_issue_stamp: ['document', 'stamp', 'fuel', 'single_use', 'official', 'liquidator'],
  gusl_index_page: ['document', 'gusl', 'index', 'official', 'lore', 'access'],
  gusl_index_fragment: ['document', 'gusl', 'index', 'fragment', 'weapon', 'evidence', 'trade'],
  foam_grenade_act: ['document', 'weapon_permit', 'foam', 'official', 'liquidator', 'issue', 'single_use', 'access'],
  confiscation_tag: ['document', 'confiscation', 'evidence', 'audit', 'liquidator'],
  contraband_receipt_blank: ['document', 'receipt', 'contraband', 'forgery', 'audit'],
  sample_chain_form: ['document', 'nii', 'sample_form', 'chain_of_custody', 'official', 'audit', 'legal_handoff'],
  nii_sample_label: ['document', 'nii', 'sample', 'label', 'official'],
  contaminated_sample_act: ['document', 'nii', 'sample', 'contaminated', 'evidence', 'audit'],
  quarantine_breach_notice: ['document', 'quarantine', 'breach', 'evidence', 'audit'],
  decon_completion_stamp: DECON_COMPLETION_STAMP_TAGS,
  resident_identity_stub: ['document', 'identity', 'resident', 'official', 'access', 'evidence', 'trade'],
  part_ticket: PART_TICKET_TAGS,
  labor_shift_card: ['document', 'permit', 'official', 'labor', 'production', 'access', 'document_gate'],
  hazard_shift_extension: ['document', 'permit', 'official', 'hazard', 'production', 'quarantine', 'access', 'document_gate'],
  terminal_order_receipt: ['document', 'receipt', 'terminal', 'delivery', 'access'],
  mail_intercept_slip: ['document', 'mail', 'stolen', 'contraband', 'evidence'],
  blueprint_t1_folder: ['document', 'blueprint', 'recipe', 'production', 'access', 'tier1'],
  blueprint_t2_folder: ['document', 'blueprint', 'recipe', 'production', 'access', 'valuable', 'tier2', 'terminal', 'fibrous_capsule'],
  blueprint_t3_folder: ['document', 'blueprint', 'recipe', 'production', 'access', 'valuable', 'rare', 'tier3', 'frozen', 'deep_route'],
  weapon_blueprint_t2: ['document', 'blueprint', 'recipe', 'weapon', 'production', 'access', 'tier2', 'armory', 'contraband', 'audit'],
  rail_depot_pass: ['document', 'permit', 'official', 'rail', 'transport', 'elevator', 'access', 'document_gate'],
  rail_switch_order: RAIL_SWITCH_ORDER_TAGS,
  samosbor_alarm_schedule: ['document', 'samosbor', 'alarm', 'schedule', 'evidence'],
  shelter_seat_card: ['document', 'shelter', 'shelter_tally', 'permit', 'official', 'access', 'samosbor'],
  shelter_seat_forgery: ['document', 'shelter', 'permit', 'forged', 'forgery', 'contraband', 'audit'],
  water_reservoir_quota: ['document', 'ration', 'coupon', 'water', 'single_use', 'official'],
  concentrate_bonus_coupon: ['document', 'ration', 'coupon', 'concentrate', 'single_use', 'official'],
  ovb_search_warrant: ['document', 'warrant', 'ovb', 'official', 'evidence', 'audit', 'access', 'document_gate'],
};

export type DocumentAccessEventType = 'player_use_item' | 'player_handoff_item' | 'player_sell_item';

export interface DocumentAccessResourceDelta {
  resourceId: string;
  delta: number;
  floor?: FloorLevel;
}

export interface DocumentAccessRelationDelta {
  faction: Faction;
  delta: number;
}

export interface DocumentAccessAction {
  itemId: string;
  floors?: readonly FloorLevel[];
  consume?: boolean;
  outputItemId?: string;
  outputCount?: number;
  moneyDelta?: number;
  eventType: DocumentAccessEventType;
  severity: WorldEventSeverity;
  privacy: WorldEventPrivacy;
  targetName: string;
  message: string;
  tags: readonly string[];
  resourceDeltas?: readonly DocumentAccessResourceDelta[];
  relationDeltas?: readonly DocumentAccessRelationDelta[];
  data?: Record<string, unknown>;
}

export const DOCUMENT_ACCESS_ACTIONS: Record<string, DocumentAccessAction> = {
  ammo_coupon_9mm: {
    itemId: 'ammo_coupon_9mm',
    outputItemId: 'ammo_9mm',
    outputCount: 10,
    eventType: 'player_use_item',
    severity: 3,
    privacy: 'local',
    targetName: 'патронный шкаф',
    message: 'Талон на 9мм погашен: выдали десять патронов.',
    tags: ['ammo_coupon', 'single_use', 'weapon_permit'],
    resourceDeltas: [{ resourceId: 'ammo', delta: -1 }],
    relationDeltas: [{ faction: Faction.LIQUIDATOR, delta: 1 }],
    data: { outcome: 'ammo_coupon_redeemed' },
  },
  ammo_coupon_shells: {
    itemId: 'ammo_coupon_shells',
    outputItemId: 'ammo_shells',
    outputCount: 4,
    eventType: 'player_use_item',
    severity: 3,
    privacy: 'local',
    targetName: 'патронный шкаф',
    message: 'Талон на дробь погашен: выдали четыре патрона.',
    tags: ['ammo_coupon', 'single_use', 'weapon_permit'],
    resourceDeltas: [{ resourceId: 'ammo', delta: -1 }],
    relationDeltas: [{ faction: Faction.LIQUIDATOR, delta: 1 }],
    data: { outcome: 'shell_coupon_redeemed' },
  },
  fuel_issue_stamp: {
    itemId: 'fuel_issue_stamp',
    outputItemId: 'ammo_fuel',
    outputCount: 1,
    eventType: 'player_use_item',
    severity: 4,
    privacy: 'local',
    targetName: 'склад топлива',
    message: 'Штамп топлива погашен: выдали канистру бензина и записали расход.',
    tags: ['fuel', 'single_use', 'liquidator'],
    resourceDeltas: [{ resourceId: 'fuel', delta: -1 }],
    relationDeltas: [{ faction: Faction.LIQUIDATOR, delta: 1 }],
    data: { outcome: 'fuel_stamp_redeemed' },
  },
  foam_grenade_act: {
    itemId: 'foam_grenade_act',
    outputItemId: 'foam_grenade_6p10',
    outputCount: 1,
    eventType: 'player_use_item',
    severity: 4,
    privacy: 'local',
    targetName: 'оружейное окно Л-47',
    message: 'Акт выдачи 6П10 погашен: выдали одну пеногранату и записали расход.',
    tags: ['foam', 'single_use', 'weapon_permit', 'liquidator'],
    resourceDeltas: [{ resourceId: 'ammo', delta: -1 }],
    relationDeltas: [{ faction: Faction.LIQUIDATOR, delta: 1 }],
    data: { outcome: 'foam_grenade_act_redeemed' },
  },
  water_reservoir_quota: {
    itemId: 'water_reservoir_quota',
    outputItemId: 'water',
    outputCount: 3,
    eventType: 'player_use_item',
    severity: 3,
    privacy: 'local',
    targetName: 'водное окно',
    message: 'Квота воды погашена: выдали три бутылки и записали резервуар.',
    tags: ['ration', 'water', 'single_use'],
    resourceDeltas: [{ resourceId: 'drink_water', delta: -3 }],
    relationDeltas: [{ faction: Faction.CITIZEN, delta: 1 }],
    data: { outcome: 'water_quota_redeemed' },
  },
  concentrate_bonus_coupon: {
    itemId: 'concentrate_bonus_coupon',
    outputItemId: 'green_briquette',
    outputCount: 2,
    eventType: 'player_use_item',
    severity: 3,
    privacy: 'local',
    targetName: 'паечное окно',
    message: 'Премиальный талон погашен: выдали две усиленные пайки.',
    tags: ['ration', 'concentrate', 'single_use'],
    resourceDeltas: [{ resourceId: 'food', delta: -2 }],
    relationDeltas: [{ faction: Faction.CITIZEN, delta: 1 }],
    data: { outcome: 'bonus_concentrate_redeemed' },
  },
  shelter_seat_card: {
    itemId: 'shelter_seat_card',
    floors: [FloorLevel.LIVING, FloorLevel.KVARTIRY],
    eventType: 'player_handoff_item',
    severity: 4,
    privacy: 'witnessed',
    targetName: 'старшие у гермодвери',
    message: 'Карточка места сдана старшим у гермодвери. Место стало общим долгом, но без подделки.',
    tags: ['shelter', 'samosbor', 'handoff', 'official'],
    relationDeltas: [{ faction: Faction.CITIZEN, delta: 3 }],
    data: { outcome: 'shelter_seat_registered' },
  },
  shelter_seat_forgery: {
    itemId: 'shelter_seat_forgery',
    floors: [FloorLevel.LIVING, FloorLevel.KVARTIRY],
    eventType: 'player_handoff_item',
    severity: 5,
    privacy: 'public',
    targetName: 'очередь у гермодвери',
    message: 'Липовая карточка укрытия показана у гермодвери. Очередь запомнила лишнюю строку.',
    tags: ['shelter', 'handoff', 'forgery', 'audit_risk'],
    relationDeltas: [{ faction: Faction.CITIZEN, delta: -4 }, { faction: Faction.WILD, delta: 1 }],
    data: { outcome: 'shelter_forgery_presented' },
  },
};

export const DOCUMENT_ACCESS_MARKET_VALUES: Record<string, number> = {
  liquidator_field_roster: 48,
  weapon_checkout_tag: 28,
  scrubbed_weapon_tag: 46,
  gusl_index_page: 54,
  gusl_index_fragment: 24,
  foam_grenade_act: 50,
  confiscation_tag: 36,
  contraband_receipt_blank: 42,
  sample_chain_form: 34,
  nii_sample_label: 22,
  slime_age_label_orange: 38,
  contaminated_sample_act: 45,
  quarantine_breach_notice: 52,
  decon_completion_stamp: 35,
  resident_identity_stub: 24,
  part_ticket: 112,
  labor_shift_card: 18,
  terminal_order_receipt: 28,
  stolen_terminal_stamp: 118,
  mail_intercept_slip: 40,
  blueprint_t1_folder: 72,
  blueprint_t2_folder: 135,
  blueprint_t3_folder: 240,
  weapon_blueprint_t2: 210,
  rail_switch_order: 85,
  samosbor_alarm_schedule: 44,
  shelter_seat_forgery: 58,
  ovb_search_warrant: 140,
};

export const DOCUMENT_MINISTRY_GATE_OUTPUTS: Record<string, string> = {
  liquidator_issue_card: 'key',
  part_ticket: 'key',
  labor_shift_card: 'key',
  hazard_shift_extension: 'key',
  rail_depot_pass: 'key',
  rail_switch_order: 'key',
  quarantine_breach_notice: 'archive_access_permit',
  ovb_search_warrant: 'archive_access_permit',
};

export const DOCUMENT_MINISTRY_GATE_ACCESS_DEFS = [
  {
    itemId: 'liquidator_issue_card',
    method: 'legal',
    legal: true,
    severity: 3,
    privacy: 'private',
    line: 'Карточка выдачи ликвидатора прошла как служебный комплект. N3 открылся под учет.',
  },
  {
    itemId: 'part_ticket',
    method: 'legal',
    legal: true,
    severity: 3,
    privacy: 'private',
    line: 'Партбилет приняли без улыбки. Коридор открылся, будто это его идея.',
  },
  {
    itemId: 'labor_shift_card',
    method: 'legal',
    legal: true,
    severity: 3,
    privacy: 'private',
    line: 'Карта смены совпала с производственным списком. N3 пропустил рабочего.',
  },
  {
    itemId: 'hazard_shift_extension',
    method: 'legal',
    legal: true,
    severity: 4,
    privacy: 'local',
    line: 'Допуск на сверхсмену открыл проход, но охрана отметила опасную строку.',
  },
  {
    itemId: 'rail_depot_pass',
    method: 'legal',
    legal: true,
    severity: 3,
    privacy: 'private',
    line: 'Пропуск в депо прошел как транспортный доступ. N3 уступил старой линии.',
  },
  {
    itemId: 'rail_switch_order',
    method: 'legal',
    legal: true,
    severity: 4,
    privacy: 'local',
    line: 'Ордер стрелочного перевода открыл служебный проход. Журнал записал маршрутную причину.',
  },
  {
    itemId: 'quarantine_breach_notice',
    method: 'expose',
    legal: true,
    severity: 4,
    privacy: 'witnessed',
    line: 'Извещение о нарушении карантина заставило N3 пропустить акт выше.',
  },
  {
    itemId: 'ovb_search_warrant',
    method: 'expose',
    legal: true,
    severity: 5,
    privacy: 'witnessed',
    line: 'Ордер ОВБ открыл проход силой закона. Очередь сделала вид, что это обычная бумага.',
  },
] as const;

export const DOCUMENT_ACCESS_ITEM_IDS = Object.keys(DOCUMENT_ACCESS_ITEMS);
export const DOCUMENT_ACCESS_EXISTING_ITEM_IDS = [
  'liquidator_issue_card',
  'weapon_checkout_tag',
  'confiscation_tag',
  'sample_chain_form',
  'nii_sample_label',
  'blueprint_t1_folder',
  'blueprint_t2_folder',
  'blueprint_t3_folder',
  'weapon_blueprint_t2',
];
const DOCUMENT_ACCESS_EXISTING_PAPER_ITEM_IDS = [
  'weapon_checkout_tag',
  'confiscation_tag',
  'blueprint_t1_folder',
  'blueprint_t2_folder',
  'blueprint_t3_folder',
  'weapon_blueprint_t2',
];
const DOCUMENT_ACCESS_NON_PAPER_ITEM_IDS = new Set([
  'fuel_issue_stamp',
  'sample_chain_form',
  'nii_sample_label',
  'contaminated_sample_act',
]);
export const DOCUMENT_ACCESS_PAPER_ITEM_IDS = [
  ...DOCUMENT_ACCESS_EXISTING_PAPER_ITEM_IDS,
  ...DOCUMENT_ACCESS_ITEM_IDS.filter(itemId => !DOCUMENT_ACCESS_NON_PAPER_ITEM_IDS.has(itemId)),
];
export const DOCUMENT_ACCESS_DOCUMENT_RESOURCE_ITEM_IDS = [
  ...DOCUMENT_ACCESS_EXISTING_ITEM_IDS,
  ...DOCUMENT_ACCESS_ITEM_IDS,
];
export const DOCUMENT_ACCESS_CONTRABAND_ITEM_IDS = [
  'scrubbed_weapon_tag',
  'contraband_receipt_blank',
  'mail_intercept_slip',
  'shelter_seat_forgery',
];
export const DOCUMENT_ACCESS_AMMO_RESOURCE_ITEM_IDS = [
  'ammo_coupon_9mm',
  'ammo_coupon_shells',
  'ammo_rifle_coupon',
  'foam_grenade_act',
];
export const DOCUMENT_ACCESS_FUEL_RESOURCE_ITEM_IDS = [
  'fuel_issue_stamp',
];
export const DOCUMENT_ACCESS_SAMPLE_RESOURCE_ITEM_IDS = [
  'sample_chain_form',
  'nii_sample_label',
  'contaminated_sample_act',
];
