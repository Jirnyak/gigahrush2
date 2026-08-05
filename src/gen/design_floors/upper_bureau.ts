/* ── Design floor: Верхнее бюро ──────────────────────────────── */

import {
  W,
  Cell,
  ContainerKind,
  DoorState,
  Faction,
  Feature,
  FloorLevel,
  LiftDirection,
  MonsterKind,
  Occupation,
  QuestType,
  RoomType,
  Tex,
  ZoneFaction,
  type Entity,
  type GameState,
  type Room,
  type TerritoryOwner,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { calcZoneLevel } from '../../systems/rpg';
import { publishEvent } from '../../systems/events';
import { setTerritoryOwnerAtIndex, syncZoneMetadataFromTerritory } from '../../systems/territory';
import { ensureConnectivity, generateZones, stampRoom } from '../shared';
import { placeProceduralScreens } from '../procedural_screens';
import { genLog } from '../log';
import {
  type NextId, addItemDrop, setFeature, spawnAdminMonster, spawnAdminNpc, spawnNamedCivilian,
} from '../admin_common';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('upper_bureau');

export const UPPER_BUREAU_ROUTE_ID = 'upper_bureau' as const;
export const UPPER_BUREAU_DISPLAY_NAME = 'Верхнее бюро' as const;
export const UPPER_BUREAU_ANCHOR_Z = 34;
export const UPPER_BUREAU_BASE_FLOOR = FloorLevel.MINISTRY;
export const UPPER_BUREAU_AUDIT_HEAT_MAX = 3;

export const UPPER_BUREAU_FLAG_IDS = {
  appointmentToken: 'upper_bureau.appointment_token',
  staffRouteKnown: 'upper_bureau.staff_route_known',
  auditHeat: 'upper_bureau.audit_heat',
  nameErased: 'upper_bureau.name_erased',
} as const;

export interface UpperBureauFlags {
  appointmentToken: boolean;
  staffRouteKnown: boolean;
  auditHeat: number;
  nameErased: boolean;
}

export const UPPER_BUREAU_DOCUMENTS = {
  appointmentToken: 'official_permit_slip',
  forgedAppointment: 'forged_permit_slip',
  cleanerKey: 'key',
  staffRoute: 'elevator_access_order',
  auditPacket: 'denunciation',
  erasedName: 'missing_record_file',
  exposedRecord: 'record_exposure_notice',
} as const;

export const UPPER_BUREAU_GATE_OUTCOMES = [
  {
    id: 'legal_preapproval',
    route: 'legal',
    documentItem: UPPER_BUREAU_DOCUMENTS.appointmentToken,
    flag: UPPER_BUREAU_FLAG_IDS.appointmentToken,
    consequence: 'Дверь открывается тихо; аудит не растёт.',
  },
  {
    id: 'acceleration_fee',
    route: 'social_economic',
    documentItem: UPPER_BUREAU_DOCUMENTS.cleanerKey,
    flag: UPPER_BUREAU_FLAG_IDS.appointmentToken,
    consequence: 'Проход за деньги открыт; аудит получает слабый след.',
  },
  {
    id: 'cleaner_staff_route',
    route: 'stealth',
    documentItem: UPPER_BUREAU_DOCUMENTS.staffRoute,
    flag: UPPER_BUREAU_FLAG_IDS.staffRouteKnown,
    consequence: 'Служебный обход минует главный пост, если ключ получен у Толика.',
  },
  {
    id: 'stolen_or_combat_key',
    route: 'illegal_combat',
    documentItem: UPPER_BUREAU_DOCUMENTS.erasedName,
    flag: UPPER_BUREAU_FLAG_IDS.auditHeat,
    consequence: 'Кража или убийство дают доступ, но поднимают аудит и слухи.',
  },
] as const;

export const UPPER_BUREAU_ROUTE_DECISIONS = [
  {
    id: 'permit_ambush',
    roomName: 'Засада поддельных корешков',
    legalItemId: UPPER_BUREAU_DOCUMENTS.appointmentToken,
    illegalItemId: UPPER_BUREAU_DOCUMENTS.forgedAppointment,
    eventTag: 'permit_ambush',
    outcome: 'С чистым корешком проход открыт; подделку можно сдать как улику или украсть папку засады с ростом аудита.',
  },
  {
    id: 'archive_toll',
    roomName: 'Платный архивный проход',
    legalItemId: 'money',
    illegalItemId: UPPER_BUREAU_DOCUMENTS.auditPacket,
    eventTag: 'archive_toll',
    outcome: 'Кассир продает допуск в архив за деньги; альтернативой остается кража кассы или актовое разоблачение.',
  },
] as const;

export const UPPER_BUREAU_DEBUG_ENTRY = {
  routeId: UPPER_BUREAU_ROUTE_ID,
  displayName: UPPER_BUREAU_DISPLAY_NAME,
  anchorZ: UPPER_BUREAU_ANCHOR_Z,
  baseFloor: UPPER_BUREAU_BASE_FLOOR,
  generator: 'generateUpperBureauDesignFloor',
  smokePath: 'spawn -> salon appointment gate OR cleaner closet -> staff route -> zero file room -> service lift',
} as const;

const UPPER_BUREAU_EVENT_BASE_TAGS = ['upper_bureau', 'bureaucracy', 'documents'] as const;

interface UpperBureauDistrictSpec {
  name: string;
  owner: TerritoryOwner;
  x: number;
  y: number;
  cols: number;
  rows: number;
  roomW: number;
  roomH: number;
  floorTex: Tex;
  wallTex: Tex;
  roomTypes: readonly RoomType[];
  connector: { x: number; y: number };
}

interface UpperBureauHqSpec {
  owner: TerritoryOwner;
  hqName: string;
  x: number;
  y: number;
  floorTex: Tex;
  wallTex: Tex;
  connector: { x: number; y: number };
}

interface UpperBureauTerritoryProfile {
  owner: TerritoryOwner;
  targetShare: number;
  spread: number;
  seeds: readonly { x: number; y: number; weight: number }[];
}

const UPPER_BUREAU_DISTRICTS: readonly UpperBureauDistrictSpec[] = [
  {
    name: 'Северный сектор прошений',
    owner: ZoneFaction.CITIZEN,
    x: 72,
    y: 104,
    cols: 10,
    rows: 7,
    roomW: 14,
    roomH: 9,
    floorTex: Tex.F_RED_CARPET,
    wallTex: Tex.MARBLE,
    roomTypes: [RoomType.OFFICE, RoomType.COMMON, RoomType.STORAGE, RoomType.OFFICE],
    connector: { x: 196, y: 452 },
  },
  {
    name: 'Надпотолочная часовня согласований',
    owner: ZoneFaction.CULTIST,
    x: 386,
    y: 88,
    cols: 10,
    rows: 6,
    roomW: 14,
    roomH: 9,
    floorTex: Tex.F_GREEN_CARPET,
    wallTex: Tex.MARBLE,
    roomTypes: [RoomType.STORAGE, RoomType.OFFICE, RoomType.COMMON, RoomType.SMOKING],
    connector: { x: 512, y: 378 },
  },
  {
    name: 'НИИ-сектор измерения подписей',
    owner: ZoneFaction.SCIENTIST,
    x: 704,
    y: 104,
    cols: 10,
    rows: 7,
    roomW: 14,
    roomH: 9,
    floorTex: Tex.F_MARBLE_TILE,
    wallTex: Tex.TILE_W,
    roomTypes: [RoomType.OFFICE, RoomType.MEDICAL, RoomType.STORAGE, RoomType.PRODUCTION],
    connector: { x: 708, y: 430 },
  },
  {
    name: 'Западный хвост очереди',
    owner: ZoneFaction.CITIZEN,
    x: 58,
    y: 744,
    cols: 10,
    rows: 7,
    roomW: 14,
    roomH: 9,
    floorTex: Tex.F_LINO,
    wallTex: Tex.PANEL,
    roomTypes: [RoomType.COMMON, RoomType.KITCHEN, RoomType.BATHROOM, RoomType.STORAGE],
    connector: { x: 220, y: 742 },
  },
  {
    name: 'Дикий сервисный низ',
    owner: ZoneFaction.WILD,
    x: 366,
    y: 812,
    cols: 10,
    rows: 6,
    roomW: 14,
    roomH: 9,
    floorTex: Tex.F_CONCRETE,
    wallTex: Tex.METAL,
    roomTypes: [RoomType.STORAGE, RoomType.SMOKING, RoomType.PRODUCTION, RoomType.COMMON],
    connector: { x: 584, y: 742 },
  },
  {
    name: 'Юго-восточная аудит-рота',
    owner: ZoneFaction.LIQUIDATOR,
    x: 704,
    y: 744,
    cols: 10,
    rows: 7,
    roomW: 14,
    roomH: 9,
    floorTex: Tex.F_GREEN_CARPET,
    wallTex: Tex.MARBLE,
    roomTypes: [RoomType.OFFICE, RoomType.STORAGE, RoomType.HQ, RoomType.OFFICE],
    connector: { x: 884, y: 742 },
  },
];

const UPPER_BUREAU_HQ_SPECS: readonly UpperBureauHqSpec[] = [
  {
    owner: ZoneFaction.CITIZEN,
    hqName: 'Гражданский гермостол сверки очередей',
    x: 124,
    y: 266,
    floorTex: Tex.F_RED_CARPET,
    wallTex: Tex.HERMO_WALL,
    connector: { x: 220, y: 452 },
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    hqName: 'Гермокабинет аудиторской стражи',
    x: 804,
    y: 662,
    floorTex: Tex.F_GREEN_CARPET,
    wallTex: Tex.HERMO_WALL,
    connector: { x: 884, y: 616 },
  },
  {
    owner: ZoneFaction.CULTIST,
    hqName: 'Скрытый алтарь согласующей печати',
    x: 500,
    y: 220,
    floorTex: Tex.F_GREEN_CARPET,
    wallTex: Tex.HERMO_WALL,
    connector: { x: 512, y: 378 },
  },
  {
    owner: ZoneFaction.SCIENTIST,
    hqName: 'Гермолаборатория экспертизы подписи',
    x: 792,
    y: 268,
    floorTex: Tex.F_MARBLE_TILE,
    wallTex: Tex.HERMO_WALL,
    connector: { x: 708, y: 430 },
  },
  {
    owner: ZoneFaction.WILD,
    hqName: 'Разбитый штаб обходных тележек',
    x: 430,
    y: 762,
    floorTex: Tex.F_CONCRETE,
    wallTex: Tex.HERMO_WALL,
    connector: { x: 584, y: 742 },
  },
];

const UPPER_BUREAU_TERRITORY_PROFILES: readonly UpperBureauTerritoryProfile[] = [
  {
    owner: ZoneFaction.CITIZEN,
    targetShare: 0.42,
    spread: 1.34,
    seeds: [
      { x: 180, y: 190, weight: 1.15 },
      { x: 244, y: 508, weight: 1.38 },
      { x: 154, y: 838, weight: 1.08 },
      { x: 430, y: 534, weight: 1.0 },
    ],
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    targetShare: 0.26,
    spread: 1.16,
    seeds: [
      { x: 444, y: 508, weight: 1.22 },
      { x: 628, y: 430, weight: 1.12 },
      { x: 850, y: 724, weight: 1.18 },
      { x: 820, y: 846, weight: 1.0 },
    ],
  },
  {
    owner: ZoneFaction.CULTIST,
    targetShare: 0.08,
    spread: 0.76,
    seeds: [
      { x: 506, y: 246, weight: 1.28 },
      { x: 480, y: 150, weight: 1.0 },
    ],
  },
  {
    owner: ZoneFaction.SCIENTIST,
    targetShare: 0.16,
    spread: 0.98,
    seeds: [
      { x: 822, y: 296, weight: 1.26 },
      { x: 790, y: 176, weight: 1.08 },
      { x: 690, y: 430, weight: 0.98 },
    ],
  },
  {
    owner: ZoneFaction.WILD,
    targetShare: 0.08,
    spread: 0.76,
    seeds: [
      { x: 468, y: 790, weight: 1.2 },
      { x: 528, y: 882, weight: 1.08 },
      { x: 276, y: 738, weight: 0.92 },
    ],
  },
];

function upperBureauQuestTags(...tags: string[]): string[] {
  return [...UPPER_BUREAU_EVENT_BASE_TAGS, ...tags].slice(0, 8);
}

function upperBureauQuestData(action: string, extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    routeId: UPPER_BUREAU_ROUTE_ID,
    floorZ: UPPER_BUREAU_ANCHOR_Z,
    baseFloor: UPPER_BUREAU_BASE_FLOOR,
    upperBureauAction: action,
    ...extra,
  };
}

const ISKRA_DEF: PlotNpcDef = {
  name: 'Мадам Искра',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 160, maxHp: 160, money: 220, speed: 0.75,
  inventory: [
    { defId: 'official_permit_slip', count: 1 },
    { defId: 'blank_form', count: 2 },
    { defId: 'tea', count: 1 },
  ],
  talkLines: [
    'Верхнее бюро принимает тех, кого уже решили принять.',
    'Назначение не получают. Назначение вспоминают при свидетелях.',
    'Корешок пропуска, чистая печать и спокойные руки открывают больше дверей, чем пистолет.',
    'Ускорительный сбор существует только в тех разговорах, которые никто не записывает.',
  ],
  talkLinesPost: [
    'Ваше назначение внесено карандашом. Карандаш здесь тверже приказа.',
    'Проходите по ковру и не смотрите на картотеку дольше секунды.',
  ],
};

const LEV_DEF: PlotNpcDef = {
  name: 'Аудитор Лев',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.DIRECTOR,
  sprite: Occupation.DIRECTOR,
  hp: 240, maxHp: 240, money: 160, speed: 0.85,
  inventory: [
    { defId: 'denunciation', count: 2 },
    { defId: 'permanent_pass', count: 1 },
    { defId: 'makarov', count: 1 },
  ],
  talkLines: [
    'Я аудирую не деньги. Деньги всегда виноваты. Я ищу, кто им помог.',
    'Черный рынок 88 слишком хорошо знает, когда проверка поворачивает за угол.',
    'Предупредите рынок - получите должников. Поможете мне - получите врагов с печатью.',
    'Жар аудита растет до трех делений. Потом коридор сам начинает спрашивать фамилию.',
  ],
  talkLinesPost: [
    'Папка пошла наверх. Теперь шум будет спускаться этажами.',
    'Если рынок узнал раньше меня, значит у уборщика снова чистые карманы.',
  ],
};

const TOLIK_DEF: PlotNpcDef = {
  name: 'Толик Чистый',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.LOCKSMITH,
  sprite: Occupation.LOCKSMITH,
  hp: 120, maxHp: 120, money: 45, speed: 0.9,
  inventory: [
    { defId: 'key', count: 1 },
    { defId: 'cleaning_kit', count: 1 },
    { defId: 'cigs', count: 1 },
  ],
  talkLines: [
    'Я мою только пол. Двери сами пачкаются ключами.',
    'Служебный ход тихий, пока не хлопнуть тележкой.',
    'Комплект для уборки вернете - покажу, где ковёр не скрипит.',
    'Ключ не спрашивает, законно ли вы идете. Зато журнал спрашивает потом.',
  ],
  talkLinesPost: [
    'Идите служебным. Там охрана ленится смотреть вниз.',
    'Если спросит мадам, я вас не видел. Я вообще вижу только пыль.',
  ],
};

const ANNA_DEF: PlotNpcDef = {
  name: 'Анна Безымянная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.HOUSEWIFE,
  sprite: Occupation.HOUSEWIFE,
  hp: 90, maxHp: 90, money: 25, speed: 0.8,
  inventory: [
    { defId: 'passport_stub', count: 1 },
    { defId: 'sealed_complaint', count: 1 },
    { defId: 'bread', count: 1 },
  ],
  talkLines: [
    'Внизу меня похоронили по ошибке. Наверху сказали, что ошибка уже утверждена.',
    'Мне нужно стереть запись о смерти, пока тело не решило согласиться.',
    'Пропавшее личное дело лежит там, где шкафы дышат чужими именами.',
    'Если вынести акт наружу, меня заметят. Если стереть имя, заметят кого-нибудь другого.',
  ],
  talkLinesPost: [
    'Теперь я опять числюсь живой. Это не радость, но паёк выдают живым.',
    'Архив потерял меня второй раз. Второй раз я уже была готова.',
  ],
};

const TOLL_KEEPER_DEF: PlotNpcDef = {
  name: 'Кассир Архивной Пошлины',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 120, maxHp: 120, money: 190, speed: 0.75,
  inventory: [
    { defId: 'archive_access_permit', count: 1 },
    { defId: 'blank_form', count: 2 },
    { defId: 'tea', count: 1 },
  ],
  talkLines: [
    'Архивная пошлина не взятка. Взятка стесняется чека.',
    'Восемьдесят восемь рублей - и касса запишет вас читателем.',
    'Можно не платить. Тогда принесите акт, что пошлина незаконна, и мы все сделаем вид, что удивлены.',
  ],
  talkLinesPost: [
    'Квитанция тише ключа. Но ключ быстрее.',
    'Не стойте у кассы после сирены: деньги любят гермодвери сильнее людей.',
  ],
};

const AMBUSH_DEF: PlotNpcDef = {
  name: 'Старший Корешков',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 210, maxHp: 210, money: 60, speed: 0.95,
  inventory: [
    { defId: 'forged_permit_slip', count: 1 },
    { defId: 'denunciation', count: 1 },
    { defId: 'ammo_9mm', count: 8 },
  ],
  weapon: 'makarov',
  talkLines: [
    'Поддельный корешок идет сюда сам. Мы только ставим стул.',
    'Чистая бумага проходит мимо. Нервная бумага приводит владельца.',
    'Принесешь подделку как улику - будет акт. Попробуешь пройти с ней - будет засада.',
  ],
  talkLinesPost: [
    'Засада закрыта до следующего красивого корешка.',
    'Печать не врет. Врет рука, которая слишком старалась.',
  ],
};

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'bureau_madam_iskra', ISKRA_DEF, [
  {
    id: 'bureau_preapproval_legal',
    giverNpcId: 'bureau_madam_iskra',
    type: QuestType.FETCH,
    desc: 'Мадам Искра: «Официальный корешок пропуска - и главный пост признает ваше назначение без шума.»',
    targetItem: 'official_permit_slip', targetCount: 1,
    rewardItem: 'key', rewardCount: 1,
    extraRewards: [{ defId: 'temp_pass', count: 1 }],
    relationDelta: 14, xpReward: 85, moneyReward: 55,
    eventTargetName: 'Назначение Верхнего бюро подтверждено чистым корешком.',
    eventSeverity: 3,
    eventPrivacy: 'local',
    eventTags: upperBureauQuestTags('appointment', 'legal', 'access', 'queue'),
    eventData: upperBureauQuestData('legal_preapproval', {
      appointmentToken: true,
      auditHeatDelta: 0,
      accessLayer: 'main_appointment_gate',
    }),
  },
  {
    id: 'bureau_preapproval_fee',
    giverNpcId: 'bureau_madam_iskra',
    type: QuestType.FETCH,
    desc: 'Мадам Искра: «Сто восемьдесят рублей ускорительного сбора. Я поставлю назначение задним числом.»',
    targetItem: 'money', targetCount: 180,
    rewardItem: 'key', rewardCount: 1,
    extraRewards: [{ defId: 'official_permit_slip', count: 1 }],
    relationDelta: -4, xpReward: 55, moneyReward: 0,
    eventTargetName: 'Ускорительный сбор Верхнего бюро оставил слабый аудиторский след.',
    eventSeverity: 4,
    eventPrivacy: 'local',
    eventTags: upperBureauQuestTags('appointment', 'bribe', 'audit_heat', 'access'),
    eventData: upperBureauQuestData('acceleration_fee', {
      appointmentToken: true,
      auditHeatDelta: 1,
      accessLayer: 'main_appointment_gate',
    }),
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'bureau_cleaner_tolik', TOLIK_DEF, [
  {
    id: 'bureau_cleaner_keys_help',
    giverNpcId: 'bureau_cleaner_tolik',
    type: QuestType.FETCH,
    desc: 'Толик Чистый: «Верните чистящий комплект. Покажу служебный ход, где охрана смотрит на ковёр, а не на вас.»',
    targetItem: 'cleaning_kit', targetCount: 1,
    rewardItem: 'key', rewardCount: 1,
    extraRewards: [{ defId: 'elevator_access_order', count: 1 }],
    relationDelta: 12, xpReward: 70, moneyReward: 35,
    eventTargetName: 'Служебный маршрут Верхнего бюро открыт через Толика.',
    eventSeverity: 3,
    eventPrivacy: 'private',
    eventTags: upperBureauQuestTags('staff_route', 'stealth', 'access', 'cleaner'),
    eventData: upperBureauQuestData('staff_route_opened', {
      staffRouteKnown: true,
      auditHeatDelta: 0,
      accessLayer: 'cleaner_service_corridor',
    }),
  },
  {
    id: 'bureau_market88_warning',
    giverNpcId: 'bureau_cleaner_tolik',
    type: QuestType.TALK,
    desc: 'Толик Чистый: «Если дойдете до Счетной 88, скажите Марте: Лев уже считает их расписки.»',
    targetNpcId: 'ag15_marta_broker',
    rewardItem: 'forged_permit_slip', rewardCount: 1,
    relationDelta: -6, xpReward: 90, moneyReward: 88,
    eventTargetName: 'Предупреждение о проверке Льва ушло к рынку 88.',
    eventSeverity: 4,
    eventPrivacy: 'secret',
    eventTags: upperBureauQuestTags('staff_route', 'black_market_88', 'leak', 'audit_heat'),
    eventData: upperBureauQuestData('market88_warning_leaked', {
      staffRouteKnown: true,
      auditHeatDelta: 1,
      targetRouteId: 'black_market_88',
      backlash: 'auditor_trace_if_lev_checks_cleaner',
    }),
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'bureau_auditor_lev', LEV_DEF, [
  {
    id: 'bureau_audit_market88_help',
    giverNpcId: 'bureau_auditor_lev',
    type: QuestType.FETCH,
    desc: 'Аудитор Лев: «Два доноса и папка по рынку 88 станут делом. Дело станет жаром аудита.»',
    targetItem: 'denunciation', targetCount: 2,
    rewardItem: 'permanent_pass', rewardCount: 1,
    extraRewards: [{ defId: 'record_exposure_notice', count: 1 }],
    relationDelta: 14, xpReward: 100, moneyReward: 120,
    eventTargetName: 'Аудитор Лев поднял жар проверки по рынку 88.',
    eventSeverity: 5,
    eventPrivacy: 'public',
    eventTags: upperBureauQuestTags('audit_heat', 'liquidator', 'black_market_88', 'expose'),
    eventData: upperBureauQuestData('audit_heat_raised', {
      auditHeatDelta: 2,
      auditHeatMax: UPPER_BUREAU_AUDIT_HEAT_MAX,
      targetRouteId: 'black_market_88',
      accessLayer: 'auditor_office',
    }),
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'bureau_archive_toll_keeper', TOLL_KEEPER_DEF, [
  {
    id: 'bureau_archive_toll_pay',
    giverNpcId: 'bureau_archive_toll_keeper',
    type: QuestType.FETCH,
    desc: 'Кассир Архивной Пошлины: «Восемьдесят восемь рублей - и архивный проход признает вас читателем, а не нарушителем.»',
    targetItem: 'money', targetCount: 88,
    rewardItem: 'archive_access_permit', rewardCount: 1,
    extraRewards: [{ defId: 'elevator_access_order', count: 1 }],
    relationDelta: 4, xpReward: 65, moneyReward: 0,
    eventTargetName: 'Архивная пошлина Верхнего бюро оплачена законно.',
    eventSeverity: 3,
    eventPrivacy: 'local',
    eventTags: upperBureauQuestTags('archive_toll', 'pay', 'access', 'queue'),
    eventData: upperBureauQuestData('archive_toll_paid', {
      archiveAccess: true,
      auditHeatDelta: 0,
      accessLayer: 'archive_toll_window',
    }),
  },
  {
    id: 'bureau_archive_toll_expose',
    giverNpcId: 'bureau_archive_toll_keeper',
    type: QuestType.FETCH,
    desc: 'Кассир Архивной Пошлины: «Акт о пропавшей записи можно приложить к кассе. Тогда проход откроется, но Лев услышит скрип.»',
    targetItem: 'record_exposure_notice', targetCount: 1,
    rewardItem: 'personal_file_copy', rewardCount: 1,
    extraRewards: [{ defId: 'denunciation', count: 1 }],
    relationDelta: -4, xpReward: 75, moneyReward: 35,
    eventTargetName: 'Пошлина Верхнего бюро приложена к делу как незаконная.',
    eventSeverity: 4,
    eventPrivacy: 'public',
    eventTags: upperBureauQuestTags('archive_toll', 'exposed_file', 'audit_heat', 'access'),
    eventData: upperBureauQuestData('archive_toll_exposed', {
      exposedFile: true,
      auditHeatDelta: 1,
      accessLayer: 'archive_toll_window',
    }),
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'bureau_permit_ambush_guard', AMBUSH_DEF, [
  {
    id: 'bureau_permit_ambush_expose',
    giverNpcId: 'bureau_permit_ambush_guard',
    type: QuestType.FETCH,
    desc: 'Старший Корешков: «Принесите поддельный корешок как приманку. Чистый проход оставим чистым, а засада получит акт.»',
    targetItem: 'forged_permit_slip', targetCount: 1,
    rewardItem: 'record_exposure_notice', rewardCount: 1,
    extraRewards: [{ defId: 'official_permit_slip', count: 1 }],
    relationDelta: 10, xpReward: 90, moneyReward: 50,
    eventTargetName: 'Поддельный корешок Верхнего бюро сработал как приманка засады.',
    eventSeverity: 4,
    eventPrivacy: 'witnessed',
    eventTags: upperBureauQuestTags('forgery', 'backlash', 'permit_ambush', 'audit'),
    eventData: upperBureauQuestData('forged_document_backlash', {
      forgedDocumentBacklash: true,
      auditHeatDelta: 1,
      accessLayer: 'permit_ambush_room',
    }),
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'bureau_visitor_anna', ANNA_DEF, [
  {
    id: 'bureau_erase_name_file',
    giverNpcId: 'bureau_visitor_anna',
    type: QuestType.FETCH,
    desc: 'Анна Безымянная: «Принесите пропавшее личное дело. Я сотру смерть с той страницы, где она выглядит законной.»',
    targetItem: 'missing_record_file', targetCount: 1,
    rewardItem: 'passport_stub', rewardCount: 1,
    extraRewards: [{ defId: 'personal_file_copy', count: 1 }],
    relationDelta: 16, xpReward: 110, moneyReward: 40,
    eventTargetName: 'Имя Анны стерто из нулевой картотеки Верхнего бюро.',
    eventSeverity: 4,
    eventPrivacy: 'secret',
    eventTags: upperBureauQuestTags('zero_file', 'record_edit', 'name_erasure', 'secret'),
    eventData: upperBureauQuestData('name_erased_from_zero_file', {
      nameErased: true,
      auditHeatDelta: 1,
      accessLayer: 'zero_file_room',
    }),
  },
  {
    id: 'bureau_expose_erased_record',
    giverNpcId: 'bureau_visitor_anna',
    type: QuestType.FETCH,
    desc: 'Анна Безымянная: «Можно не стирать. Вынесите акт о пропавшей записи - пусть Райсовет отвечает вслух.»',
    targetItem: 'record_exposure_notice', targetCount: 1,
    rewardItem: 'archive_access_permit', rewardCount: 1,
    relationDelta: 8, xpReward: 85, moneyReward: 70,
    eventTargetName: 'Пропавшая запись Анны вынесена наружу как акт.',
    eventSeverity: 4,
    eventPrivacy: 'public',
    eventTags: upperBureauQuestTags('zero_file', 'exposed_file', 'audit_heat', 'legal'),
    eventData: upperBureauQuestData('erased_record_exposed', {
      exposedFile: true,
      auditHeatDelta: 1,
      accessLayer: 'zero_file_room',
    }),
  },
]);

export function createUpperBureauFlags(): UpperBureauFlags {
  return {
    appointmentToken: false,
    staffRouteKnown: false,
    auditHeat: 0,
    nameErased: false,
  };
}

export interface UpperBureauFlagChange {
  appointmentToken?: boolean;
  staffRouteKnown?: boolean;
  auditHeatDelta?: number;
  auditHeat?: number;
  nameErased?: boolean;
  actor?: Entity;
  x?: number;
  y?: number;
  zoneId?: number;
  roomId?: number;
  reason: string;
  documentItemId?: string;
}

export function clampUpperBureauAuditHeat(value: number): number {
  return Math.max(0, Math.min(UPPER_BUREAU_AUDIT_HEAT_MAX, Math.floor(value)));
}

export function applyUpperBureauFlagChange(
  state: GameState,
  current: UpperBureauFlags,
  change: UpperBureauFlagChange,
): UpperBureauFlags {
  const next: UpperBureauFlags = { ...current };
  let auditChanged = false;
  let recordChanged = false;
  let routeChanged = false;

  if (change.appointmentToken !== undefined && next.appointmentToken !== change.appointmentToken) {
    next.appointmentToken = change.appointmentToken;
    routeChanged = true;
  }
  if (change.staffRouteKnown !== undefined && next.staffRouteKnown !== change.staffRouteKnown) {
    next.staffRouteKnown = change.staffRouteKnown;
    routeChanged = true;
  }
  if (change.auditHeat !== undefined || change.auditHeatDelta !== undefined) {
    const rawHeat = change.auditHeat ?? next.auditHeat + (change.auditHeatDelta ?? 0);
    const heat = clampUpperBureauAuditHeat(rawHeat);
    auditChanged = heat !== next.auditHeat;
    next.auditHeat = heat;
  }
  if (change.nameErased !== undefined && next.nameErased !== change.nameErased) {
    next.nameErased = change.nameErased;
    recordChanged = true;
  }

  if (auditChanged || recordChanged || routeChanged) {
    const severity = next.auditHeat >= 3 ? 5 : recordChanged ? 4 : 3;
    publishEvent(state, {
      type: 'faction_relation_changed',
      floor: UPPER_BUREAU_BASE_FLOOR,
      zoneId: change.zoneId,
      roomId: change.roomId,
      x: change.x,
      y: change.y,
      actorId: change.actor?.id,
      actorName: change.actor?.name,
      actorFaction: change.actor?.faction,
      targetName: recordChanged ? UPPER_BUREAU_FLAG_IDS.nameErased : UPPER_BUREAU_FLAG_IDS.auditHeat,
      itemId: change.documentItemId,
      severity,
      privacy: next.auditHeat >= 2 ? 'local' : 'private',
      tags: [
        'upper_bureau',
        auditChanged ? 'audit_heat' : 'route_flag',
        recordChanged ? 'record_edit' : 'access',
      ],
      data: {
        routeId: UPPER_BUREAU_ROUTE_ID,
        reason: change.reason,
        appointmentToken: next.appointmentToken,
        staffRouteKnown: next.staffRouteKnown,
        auditHeat: next.auditHeat,
        auditHeatMax: UPPER_BUREAU_AUDIT_HEAT_MAX,
        nameErased: next.nameErased,
        documentItemId: change.documentItemId,
      },
    });
  }

  return next;
}

export function upperBureauDebugLine(flags: UpperBureauFlags = createUpperBureauFlags()): string {
  return `${UPPER_BUREAU_ROUTE_ID} z=${UPPER_BUREAU_ANCHOR_Z} `
    + `token=${flags.appointmentToken ? 1 : 0} staff=${flags.staffRouteKnown ? 1 : 0} `
    + `audit=${clampUpperBureauAuditHeat(flags.auditHeat)}/${UPPER_BUREAU_AUDIT_HEAT_MAX} `
    + `erased=${flags.nameErased ? 1 : 0}`;
}

function fillDefaultTextures(world: World): void {
  for (let i = 0; i < W * W; i++) {
    world.wallTex[i] = Tex.MARBLE;
    world.floorTex[i] = Tex.F_MARBLE_TILE;
  }
}

function stampBureauRoom(
  world: World,
  id: number,
  type: RoomType,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  floorTex: Tex,
): Room {
  const room = stampRoom(world, id, type, x, y, w, h, -1);
  room.name = name;
  room.wallTex = Tex.MARBLE;
  room.floorTex = floorTex;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.cells[ci] === Cell.WALL) world.wallTex[ci] = Tex.MARBLE;
      if (dx >= 0 && dx < w && dy >= 0 && dy < h) world.floorTex[ci] = floorTex;
    }
  }
  return room;
}

function carveFloorRect(world: World, x: number, y: number, w: number, h: number, floorTex: Tex): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      world.cells[ci] = Cell.FLOOR;
      world.roomMap[ci] = -1;
      world.floorTex[ci] = floorTex;
    }
  }
}

function addDoor(
  world: World,
  room: Room | null,
  x: number,
  y: number,
  state = DoorState.CLOSED,
  keyId = '',
  wallTex = Tex.DOOR_WOOD,
): void {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.DOOR;
  world.wallTex[idx] = wallTex;
  world.roomMap[idx] = room?.id ?? -1;
  world.doors.set(idx, {
    idx,
    state,
    roomA: room?.id ?? -1,
    roomB: room?.id ?? -1,
    keyId,
    timer: 0,
  });
  if (room && !room.doors.includes(idx)) room.doors.push(idx);
}

function addGatePartition(
  world: World,
  x: number,
  y0: number,
  y1: number,
  doorY: number,
  keyId: string,
): void {
  for (let y = y0; y <= y1; y++) {
    const ci = world.idx(x, y);
    world.cells[ci] = Cell.WALL;
    world.roomMap[ci] = -1;
    world.wallTex[ci] = Tex.MARBLE;
    world.features[ci] = Feature.NONE;
  }
  addDoor(world, null, x, doorY, DoorState.LOCKED, keyId, Tex.DOOR_METAL);
}

function placeLiftCell(world: World, x: number, y: number, buttonX: number, buttonY: number, direction: LiftDirection): void {
  const liftIdx = world.idx(x, y);
  world.cells[liftIdx] = Cell.LIFT;
  world.wallTex[liftIdx] = Tex.LIFT_DOOR;
  world.liftDir[liftIdx] = direction;
  const buttonIdx = world.idx(buttonX, buttonY);
  if (world.cells[buttonIdx] === Cell.FLOOR) {
    world.features[buttonIdx] = Feature.LIFT_BUTTON;
    world.liftDir[buttonIdx] = direction;
  }
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addBureauContainer(
  world: World,
  room: Room,
  x: number,
  y: number,
  kind: ContainerKind,
  name: string,
  access: WorldContainer['access'],
  inventory: WorldContainer['inventory'],
  tags: string[],
  owner?: { id: number; name: string; faction: Faction },
): void {
  world.addContainer({
    id: nextContainerId(world),
    x,
    y,
    floor: UPPER_BUREAU_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind,
    name,
    inventory,
    capacitySlots: Math.max(8, inventory.length + 2),
    ownerNpcId: owner?.id,
    ownerName: owner?.name,
    faction: owner?.faction ?? Faction.CITIZEN,
    access,
    lockDifficulty: access === 'locked' ? 4 : undefined,
    discovered: access !== 'secret',
    tags: ['upper_bureau', ...tags],
  });
}

function decorateSalon(world: World, room: Room): void {
  const deskY = room.y + 4;
  for (let dx = 3; dx < room.w - 3; dx++) setFeature(world, room.x + dx, deskY, Feature.DESK);
  for (let dx = 4; dx < room.w - 4; dx += 3) setFeature(world, room.x + dx, deskY + 2, Feature.CHAIR);
  for (let dx = 5; dx < room.w - 5; dx += 5) setFeature(world, room.x + dx, room.y + room.h - 3, Feature.CHAIR);
  setFeature(world, room.x + 4, room.y + 3, Feature.LAMP);
  setFeature(world, room.x + room.w - 5, room.y + 3, Feature.LAMP);
  setFeature(world, room.x + Math.floor(room.w / 2), room.y + room.h - 4, Feature.SCREEN);
  world.wallTex[world.idx(room.x + Math.floor(room.w / 2), room.y - 1)] = Tex.PORTRAIT_BASE + 7;
  world.wallTex[world.idx(room.x + room.w, room.y + 5)] = Tex.POSTER_BASE + 21;
}

function decorateOffice(world: World, room: Room): void {
  const deskY = room.y + 3;
  for (let dx = 3; dx < room.w - 3; dx++) setFeature(world, room.x + dx, deskY, Feature.DESK);
  for (let dx = 4; dx < room.w - 4; dx += 4) setFeature(world, room.x + dx, deskY + 2, Feature.CHAIR);
  for (let dy = 2; dy < room.h - 2; dy += 2) {
    setFeature(world, room.x + 1, room.y + dy, Feature.SHELF);
    setFeature(world, room.x + room.w - 2, room.y + dy, Feature.SHELF);
  }
  setFeature(world, room.x + Math.floor(room.w / 2), room.y + 1, Feature.LAMP);
  world.wallTex[world.idx(room.x + Math.floor(room.w / 2), room.y - 1)] = Tex.PORTRAIT_BASE + 31;
}

function decorateFileRoom(world: World, room: Room): void {
  for (let dy = 1; dy < room.h - 1; dy++) {
    if (dy % 2 === 0) {
      for (let dx = 2; dx < room.w - 2; dx += 3) setFeature(world, room.x + dx, room.y + dy, Feature.SHELF);
    }
  }
  setFeature(world, room.x + 2, room.y + 2, Feature.LAMP);
  setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.LAMP);
  world.wallTex[world.idx(room.x + room.w, room.y + Math.floor(room.h / 2))] = Tex.POSTER_BASE + 44;
}

function decorateCleanerRoom(world: World, room: Room): void {
  for (let dy = 2; dy < room.h - 2; dy += 2) setFeature(world, room.x + 1, room.y + dy, Feature.SHELF);
  setFeature(world, room.x + room.w - 3, room.y + 2, Feature.SINK);
  setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.LAMP);
}

function carveBureauCell(world: World, x: number, y: number, floorTex: Tex, roomId = -1): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT) return;
  if (world.cells[ci] !== Cell.DOOR) world.cells[ci] = Cell.FLOOR;
  if (roomId >= 0 || world.roomMap[ci] < 0) world.roomMap[ci] = roomId;
  world.floorTex[ci] = floorTex;
  if (world.roomMap[ci] < 0 && world.features[ci] !== Feature.LIFT_BUTTON) world.features[ci] = Feature.NONE;
}

function carveBureauRect(world: World, x: number, y: number, w: number, h: number, floorTex: Tex, roomId = -1): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) carveBureauCell(world, x + dx, y + dy, floorTex, roomId);
  }
}

function carveBureauLine(world: World, ax: number, ay: number, bx: number, by: number, width: number, floorTex: Tex): void {
  const half = Math.floor(width / 2);
  if (ay === by) {
    const minX = Math.min(ax, bx);
    const maxX = Math.max(ax, bx);
    carveBureauRect(world, minX, ay - half, maxX - minX + 1, width, floorTex);
    return;
  }
  if (ax === bx) {
    const minY = Math.min(ay, by);
    const maxY = Math.max(ay, by);
    carveBureauRect(world, ax - half, minY, width, maxY - minY + 1, floorTex);
    return;
  }
  carveBureauLine(world, ax, ay, bx, ay, width, floorTex);
  carveBureauLine(world, bx, ay, bx, by, width, floorTex);
}

function carveRibbonLine(world: World, ax: number, ay: number, bx: number, by: number, width: number, fieldTex: Tex, ribbonTex: Tex): void {
  carveBureauLine(world, ax, ay, bx, by, width, fieldTex);
  carveBureauLine(world, ax, ay, bx, by, Math.max(1, width - 3), ribbonTex);
}

function stampExpansionRoom(
  world: World,
  type: RoomType,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  floorTex: Tex,
  wallTex = Tex.MARBLE,
): Room {
  const room = stampBureauRoom(world, world.rooms.length, type, name, x, y, w, h, floorTex);
  room.wallTex = wallTex;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      if (dx >= 0 && dx < w && dy >= 0 && dy < h) continue;
      const ci = world.idx(x + dx, y + dy);
      if (world.cells[ci] === Cell.WALL) world.wallTex[ci] = wallTex;
    }
  }
  return room;
}

function sealExpansionRoomPerimeter(world: World, room: Room): void {
  const doors = new Set(room.doors);
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const idx = world.idx(room.x + dx, room.y + dy);
      if (doors.has(idx) || world.aptMask[idx]) continue;
      world.cells[idx] = Cell.WALL;
      world.roomMap[idx] = -1;
      world.wallTex[idx] = room.wallTex;
      world.features[idx] = Feature.NONE;
    }
  }
}

function sealUpperBureauRouteCutRooms(world: World): void {
  for (const name of [
    'Ниша проверки пропусков',
    'Окно заднего назначения',
    'Пост переписи сотрудников',
    'Карман выданных обходов',
  ] as const) {
    const room = world.rooms.find(candidate => candidate?.name === name);
    if (room) sealExpansionRoomPerimeter(world, room);
  }
}

function addHorizontalGatePartition(
  world: World,
  y: number,
  x0: number,
  x1: number,
  doorX: number,
  keyId: string,
): void {
  for (let x = x0; x <= x1; x++) {
    const ci = world.idx(x, y);
    world.cells[ci] = Cell.WALL;
    world.roomMap[ci] = -1;
    world.wallTex[ci] = Tex.MARBLE;
    world.features[ci] = Feature.NONE;
  }
  addDoor(world, null, doorX, y, DoorState.LOCKED, keyId, Tex.DOOR_METAL);
}

function placeFeatureRow(world: World, ax: number, ay: number, bx: number, by: number, step: number, feature: Feature): void {
  const dx = bx === ax ? 0 : bx > ax ? 1 : -1;
  const dy = by === ay ? 0 : by > ay ? 1 : -1;
  let x = ax;
  let y = ay;
  let n = 0;
  while (x !== bx || y !== by) {
    if (n % step === 0) setFeature(world, x, y, feature);
    x += dx;
    y += dy;
    n++;
  }
  setFeature(world, bx, by, feature);
}

function decorateClerkCage(world: World, room: Room): void {
  for (let dx = 2; dx < room.w - 2; dx++) {
    if (dx % 2 === 0) setFeature(world, room.x + dx, room.y + 3, Feature.DESK);
  }
  for (let dx = 3; dx < room.w - 3; dx += 4) {
    setFeature(world, room.x + dx, room.y + 5, Feature.CHAIR);
    setFeature(world, room.x + dx, room.y + room.h - 3, Feature.SCREEN);
  }
  setFeature(world, room.x + 2, room.y + 2, Feature.LAMP);
  setFeature(world, room.x + room.w - 3, room.y + 2, Feature.LAMP);
}

function decorateArchiveBalcony(world: World, x0: number, y0: number, x1: number, y1: number): void {
  placeFeatureRow(world, x0, y0 - 3, x1, y0 - 3, 4, Feature.SHELF);
  placeFeatureRow(world, x0, y1 + 3, x1, y1 + 3, 4, Feature.SHELF);
  placeFeatureRow(world, x1 + 3, y0, x1 + 3, y1, 4, Feature.SHELF);
  placeFeatureRow(world, x0 - 3, y0, x0 - 3, y1, 5, Feature.LAMP);
}

function addPublicQueueTier(world: World, rng: () => number): void {
  carveRibbonLine(world, 128, 508, 486, 508, 7, Tex.F_MARBLE_TILE, Tex.F_RED_CARPET);
  carveRibbonLine(world, 154, 452, 422, 452, 7, Tex.F_MARBLE_TILE, Tex.F_RED_CARPET);
  carveRibbonLine(world, 422, 452, 422, 484, 7, Tex.F_MARBLE_TILE, Tex.F_RED_CARPET);
  carveRibbonLine(world, 194, 484, 422, 484, 7, Tex.F_MARBLE_TILE, Tex.F_RED_CARPET);
  carveRibbonLine(world, 194, 484, 194, 532, 7, Tex.F_MARBLE_TILE, Tex.F_RED_CARPET);
  carveRibbonLine(world, 194, 532, 454, 532, 7, Tex.F_MARBLE_TILE, Tex.F_RED_CARPET);
  carveRibbonLine(world, 454, 508, 454, 532, 7, Tex.F_MARBLE_TILE, Tex.F_RED_CARPET);
  carveBureauLine(world, 300, 484, 300, 532, 3, Tex.F_MARBLE_TILE);
  carveBureauLine(world, 194, 508, 422, 508, 3, Tex.F_MARBLE_TILE);

  const firstSalon = stampExpansionRoom(world, RoomType.COMMON, 'Передний зал живой очереди', 168, 418, 104, 30, Tex.F_RED_CARPET);
  const complaintSalon = stampExpansionRoom(world, RoomType.COMMON, 'Салон жалоб без номера', 282, 536, 126, 30, Tex.F_GREEN_CARPET);
  const cage = stampExpansionRoom(world, RoomType.OFFICE, 'Стеклянная клетка младших клерков', 318, 462, 78, 22, Tex.F_MARBLE_TILE, Tex.TILE_W);
  const permitNiche = stampExpansionRoom(world, RoomType.HQ, 'Ниша проверки пропусков', 426, 462, 28, 28, Tex.F_MARBLE_TILE);
  const refusalRoom = stampExpansionRoom(world, RoomType.OFFICE, 'Тупик личного отказа', 116, 477, 44, 28, Tex.F_PARQUET);

  addDoor(world, firstSalon, 220, 448);
  addDoor(world, complaintSalon, 344, 535);
  addDoor(world, cage, 356, 484, DoorState.CLOSED, '', Tex.DOOR_METAL);
  addDoor(world, permitNiche, 425, 476, DoorState.LOCKED, UPPER_BUREAU_DOCUMENTS.appointmentToken, Tex.DOOR_METAL);
  addDoor(world, refusalRoom, 138, 505);

  decorateSalon(world, firstSalon);
  decorateSalon(world, complaintSalon);
  decorateClerkCage(world, cage);
  decorateOffice(world, permitNiche);
  decorateOffice(world, refusalRoom);

  addGatePartition(world, 444, 492, 524, 508, UPPER_BUREAU_DOCUMENTS.appointmentToken);
  addGatePartition(world, 468, 494, 522, 508, rng() < 0.5 ? UPPER_BUREAU_DOCUMENTS.forgedAppointment : UPPER_BUREAU_DOCUMENTS.appointmentToken);

  placeFeatureRow(world, 160, 447, 410, 447, 5, Feature.CHAIR);
  placeFeatureRow(world, 206, 489, 410, 489, 5, Feature.CHAIR);
  placeFeatureRow(world, 206, 527, 444, 527, 5, Feature.CHAIR);
  placeFeatureRow(world, 306, 512, 438, 512, 6, Feature.SHELF);
}

function addPrivateOfficeTier(world: World, rng: () => number): void {
  carveRibbonLine(world, 372, 378, 708, 378, 7, Tex.F_MARBLE_TILE, Tex.F_GREEN_CARPET);
  carveRibbonLine(world, 512, 378, 512, 497, 7, Tex.F_MARBLE_TILE, Tex.F_GREEN_CARPET);
  carveRibbonLine(world, 586, 430, 708, 430, 5, Tex.F_PARQUET, Tex.F_GREEN_CARPET);
  carveRibbonLine(world, 708, 378, 708, 430, 5, Tex.F_PARQUET, Tex.F_GREEN_CARPET);

  const offices = [
    stampExpansionRoom(world, RoomType.OFFICE, 'Личный кабинет тишины', 400, 346, 40, 28, Tex.F_PARQUET),
    stampExpansionRoom(world, RoomType.OFFICE, 'Кабинет утвержденного родства', 452, 346, 40, 28, Tex.F_PARQUET),
    stampExpansionRoom(world, RoomType.OFFICE, 'Комната предварительной подписи', 540, 346, 44, 28, Tex.F_PARQUET),
    stampExpansionRoom(world, RoomType.HQ, 'Малый кабинет аудиторской тени', 596, 346, 44, 28, Tex.F_GREEN_CARPET),
    stampExpansionRoom(world, RoomType.HQ, 'Привилегированная приемная', 650, 399, 42, 28, Tex.F_RED_CARPET),
    stampExpansionRoom(world, RoomType.OFFICE, 'Тупик особого ходатайства', 711, 392, 48, 26, Tex.F_PARQUET),
  ];

  addDoor(world, offices[0], offices[0].x + 20, offices[0].y + offices[0].h);
  addDoor(world, offices[1], offices[1].x + 20, offices[1].y + offices[1].h);
  addDoor(world, offices[2], offices[2].x + 22, offices[2].y + offices[2].h);
  addDoor(world, offices[3], offices[3].x + 22, offices[3].y + offices[3].h);
  addDoor(world, offices[4], offices[4].x + 21, offices[4].y + offices[4].h, DoorState.LOCKED, UPPER_BUREAU_DOCUMENTS.appointmentToken, Tex.DOOR_METAL);
  addDoor(world, offices[5], offices[5].x - 1, offices[5].y + 13, DoorState.LOCKED, UPPER_BUREAU_DOCUMENTS.staffRoute, Tex.DOOR_METAL);

  for (const office of offices) decorateOffice(world, office);
  addHorizontalGatePartition(world, 444, 492, 536, 512, UPPER_BUREAU_DOCUMENTS.appointmentToken);
  addGatePartition(world, 628, 374, 434, 430, rng() < 0.45 ? UPPER_BUREAU_DOCUMENTS.auditPacket : UPPER_BUREAU_DOCUMENTS.appointmentToken);
}

function addArchiveBalconyTier(world: World): void {
  carveBureauLine(world, 586, 508, 620, 508, 5, Tex.F_MARBLE_TILE);
  carveBureauLine(world, 620, 458, 620, 616, 5, Tex.F_MARBLE_TILE);
  carveBureauLine(world, 620, 458, 890, 458, 5, Tex.F_MARBLE_TILE);
  carveBureauLine(world, 890, 458, 890, 616, 5, Tex.F_MARBLE_TILE);
  carveBureauLine(world, 620, 616, 890, 616, 5, Tex.F_MARBLE_TILE);
  carveRibbonLine(world, 704, 508, 890, 508, 5, Tex.F_MARBLE_TILE, Tex.F_GREEN_CARPET);

  const archiveRooms = [
    stampExpansionRoom(world, RoomType.STORAGE, 'Архивный балкон пропусков', 646, 425, 54, 30, Tex.F_MARBLE_TILE),
    stampExpansionRoom(world, RoomType.STORAGE, 'Балкон чужих назначений', 720, 425, 54, 30, Tex.F_MARBLE_TILE),
    stampExpansionRoom(world, RoomType.STORAGE, 'Закрытая опись родственников', 794, 425, 54, 30, Tex.F_MARBLE_TILE),
    stampExpansionRoom(world, RoomType.STORAGE, 'Картотека обходных подписей', 646, 619, 58, 32, Tex.F_MARBLE_TILE),
    stampExpansionRoom(world, RoomType.STORAGE, 'Полка стертых фамилий', 724, 619, 58, 32, Tex.F_MARBLE_TILE),
    stampExpansionRoom(world, RoomType.STORAGE, 'Тупиковый сейф привилегий', 806, 619, 50, 32, Tex.F_GREEN_CARPET),
  ];

  for (let i = 0; i < archiveRooms.length; i++) {
    const room = archiveRooms[i];
    const doorY = i < 3 ? room.y + room.h : room.y - 1;
    addDoor(world, room, room.x + Math.floor(room.w / 2), doorY, i === 5 ? DoorState.LOCKED : DoorState.CLOSED, i === 5 ? UPPER_BUREAU_DOCUMENTS.cleanerKey : '', Tex.DOOR_METAL);
    decorateFileRoom(world, room);
  }

  addGatePartition(world, 704, 492, 526, 508, UPPER_BUREAU_DOCUMENTS.appointmentToken);
  addGatePartition(world, 866, 470, 614, 508, UPPER_BUREAU_DOCUMENTS.staffRoute);
  decorateArchiveBalcony(world, 620, 458, 890, 616);
}

function addStaffBalconyTier(world: World): void {
  carveRibbonLine(world, 452, 586, 724, 586, 5, Tex.F_MARBLE_TILE, Tex.F_GREEN_CARPET);
  carveBureauLine(world, 452, 508, 452, 586, 3, Tex.F_MARBLE_TILE);
  carveBureauLine(world, 684, 540, 684, 586, 3, Tex.F_TILE);
  carveBureauLine(world, 724, 586, 724, 616, 3, Tex.F_MARBLE_TILE);

  const staffQueue = stampExpansionRoom(world, RoomType.COMMON, 'Балкон служебной очереди', 438, 590, 84, 24, Tex.F_GREEN_CARPET);
  const backAppointment = stampExpansionRoom(world, RoomType.OFFICE, 'Окно заднего назначения', 536, 590, 44, 22, Tex.F_MARBLE_TILE);
  const witnessPost = stampExpansionRoom(world, RoomType.HQ, 'Пост переписи сотрудников', 596, 590, 54, 22, Tex.F_RED_CARPET);
  const bypassLedger = stampExpansionRoom(world, RoomType.STORAGE, 'Карман выданных обходов', 666, 590, 44, 22, Tex.F_TILE);

  addDoor(world, staffQueue, staffQueue.x + 42, staffQueue.y - 1);
  addDoor(world, backAppointment, backAppointment.x + 22, backAppointment.y - 1, DoorState.LOCKED, UPPER_BUREAU_DOCUMENTS.forgedAppointment, Tex.DOOR_METAL);
  addDoor(world, witnessPost, witnessPost.x + 27, witnessPost.y - 1, DoorState.LOCKED, UPPER_BUREAU_DOCUMENTS.staffRoute, Tex.DOOR_METAL);
  addDoor(world, bypassLedger, bypassLedger.x + 22, bypassLedger.y - 1, DoorState.LOCKED, UPPER_BUREAU_DOCUMENTS.cleanerKey, Tex.DOOR_METAL);
  sealExpansionRoomPerimeter(world, bypassLedger);

  decorateSalon(world, staffQueue);
  decorateClerkCage(world, backAppointment);
  decorateOffice(world, witnessPost);
  decorateCleanerRoom(world, bypassLedger);
  placeFeatureRow(world, 462, 582, 712, 582, 8, Feature.CHAIR);
  placeFeatureRow(world, 462, 588, 712, 588, 10, Feature.SHELF);
}

function addServiceTier(world: World, rng: () => number): void {
  carveBureauLine(world, 502, 540, 884, 540, 5, Tex.F_TILE);
  carveBureauLine(world, 584, 540, 584, 742, 5, Tex.F_TILE);
  carveBureauLine(world, 220, 742, 884, 742, 5, Tex.F_TILE);
  carveBureauLine(world, 884, 616, 884, 742, 5, Tex.F_TILE);
  carveBureauLine(world, 220, 508, 220, 742, 3, Tex.F_MARBLE_TILE);
  carveBureauLine(world, 220, 620, 584, 620, 3, Tex.F_TILE);

  const serviceRooms = [
    stampExpansionRoom(world, RoomType.STORAGE, 'Служебная лестница к верхним печатям', 836, 711, 36, 28, Tex.F_CONCRETE, Tex.METAL),
    stampExpansionRoom(world, RoomType.STORAGE, 'Кладовая тележек и чужих пальто', 250, 711, 48, 28, Tex.F_TILE),
    stampExpansionRoom(world, RoomType.SMOKING, 'Обходная курилка без протокола', 326, 711, 44, 28, Tex.F_TILE),
    stampExpansionRoom(world, RoomType.OFFICE, 'Черный ход печатей', 678, 711, 52, 28, Tex.F_MARBLE_TILE),
    stampExpansionRoom(world, RoomType.STORAGE, 'Сервисный карман мимо охраны', 520, 623, 42, 28, Tex.F_TILE),
  ];

  addDoor(world, serviceRooms[0], serviceRooms[0].x + 18, serviceRooms[0].y + serviceRooms[0].h);
  addDoor(world, serviceRooms[1], serviceRooms[1].x + 24, serviceRooms[1].y + serviceRooms[1].h);
  addDoor(world, serviceRooms[2], serviceRooms[2].x + 22, serviceRooms[2].y + serviceRooms[2].h);
  addDoor(world, serviceRooms[3], serviceRooms[3].x + 26, serviceRooms[3].y + serviceRooms[3].h, DoorState.LOCKED, UPPER_BUREAU_DOCUMENTS.staffRoute, Tex.DOOR_METAL);
  addDoor(world, serviceRooms[4], serviceRooms[4].x + 21, serviceRooms[4].y - 1, DoorState.LOCKED, UPPER_BUREAU_DOCUMENTS.cleanerKey, Tex.DOOR_METAL);

  decorateCleanerRoom(world, serviceRooms[0]);
  decorateCleanerRoom(world, serviceRooms[1]);
  decorateSalon(world, serviceRooms[2]);
  decorateOffice(world, serviceRooms[3]);
  decorateCleanerRoom(world, serviceRooms[4]);

  addHorizontalGatePartition(world, 640, 568, 604, 584, UPPER_BUREAU_DOCUMENTS.cleanerKey);
  addGatePartition(world, 760, 724, 746, 742, rng() < 0.5 ? UPPER_BUREAU_DOCUMENTS.staffRoute : UPPER_BUREAU_DOCUMENTS.cleanerKey);
  placeFeatureRow(world, 238, 738, 852, 738, 12, Feature.SHELF);
  placeFeatureRow(world, 590, 552, 590, 724, 10, Feature.LAMP);
}

function bureauRoomPitch(spec: UpperBureauDistrictSpec): { x: number; y: number } {
  return { x: spec.roomW + 5, y: spec.roomH + 7 };
}

function bureauDistrictSpine(spec: UpperBureauDistrictSpec): { x: number; y0: number; y1: number } {
  const pitch = bureauRoomPitch(spec);
  const midCol = Math.max(1, Math.floor(spec.cols / 2));
  return {
    x: spec.x + midCol * pitch.x - 3,
    y0: spec.y + spec.roomH + 1,
    y1: spec.y + (spec.rows - 1) * pitch.y + spec.roomH + 3,
  };
}

function decorateMicroRoom(world: World, room: Room, serial: number): void {
  switch (room.type) {
    case RoomType.KITCHEN:
      for (let x = room.x + 2; x < room.x + room.w - 2; x += 4) setFeature(world, x, room.y + 2, Feature.STOVE);
      setFeature(world, room.x + room.w - 4, room.y + room.h - 3, Feature.SINK);
      setFeature(world, room.x + 3, room.y + room.h - 3, Feature.TABLE);
      break;
    case RoomType.BATHROOM:
      setFeature(world, room.x + 2, room.y + 2, Feature.SINK);
      setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.TOILET);
      break;
    case RoomType.MEDICAL:
      setFeature(world, room.x + 2, room.y + 2, Feature.BED);
      setFeature(world, room.x + room.w - 4, room.y + 2, Feature.APPARATUS);
      setFeature(world, room.x + room.w - 4, room.y + room.h - 3, Feature.SINK);
      break;
    case RoomType.PRODUCTION:
      setFeature(world, room.x + 3, room.y + 2, Feature.MACHINE);
      setFeature(world, room.x + room.w - 4, room.y + 2, Feature.APPARATUS);
      setFeature(world, room.x + 3, room.y + room.h - 3, Feature.SHELF);
      break;
    case RoomType.SMOKING:
      setFeature(world, room.x + 2, room.y + 2, Feature.TABLE);
      setFeature(world, room.x + room.w - 3, room.y + 2, Feature.CHAIR);
      setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.LAMP);
      break;
    case RoomType.COMMON:
      setFeature(world, room.x + 2, room.y + 2, Feature.TABLE);
      setFeature(world, room.x + room.w - 3, room.y + 2, Feature.CHAIR);
      setFeature(world, room.x + Math.floor(room.w / 2), room.y + room.h - 3, Feature.LAMP);
      break;
    case RoomType.HQ:
      decorateOffice(world, room);
      setFeature(world, room.x + 2, room.y + room.h - 3, Feature.SCREEN);
      break;
    case RoomType.STORAGE:
      for (let y = room.y + 2; y < room.y + room.h - 2; y += 3) setFeature(world, room.x + 2, y, Feature.SHELF);
      setFeature(world, room.x + room.w - 3, room.y + 2, Feature.LAMP);
      break;
    case RoomType.OFFICE:
    default:
      if (serial % 5 === 0) decorateClerkCage(world, room);
      else decorateOffice(world, room);
      break;
  }
}

function addBureauMicroDistrict(world: World, spec: UpperBureauDistrictSpec): void {
  const pitch = bureauRoomPitch(spec);
  const width = (spec.cols - 1) * pitch.x + spec.roomW;
  const spine = bureauDistrictSpine(spec);
  let serial = 0;

  for (let row = 0; row < spec.rows; row++) {
    const rowY = spec.y + row * pitch.y;
    const corridorY = rowY + spec.roomH + 2;
    carveBureauLine(world, spec.x - 4, corridorY, spec.x + width + 4, corridorY, 3, spec.floorTex);
    for (let col = 0; col < spec.cols; col++) {
      const roomType = spec.roomTypes[(row * spec.cols + col) % spec.roomTypes.length];
      const room = stampExpansionRoom(
        world,
        roomType,
        `${spec.name} ${row + 1}.${col + 1}`,
        spec.x + col * pitch.x,
        rowY,
        spec.roomW,
        spec.roomH,
        spec.floorTex,
        spec.wallTex,
      );
      decorateMicroRoom(world, room, serial++);
      addDoor(world, room, room.x + Math.floor(room.w / 2), room.y + room.h, DoorState.CLOSED, '', spec.wallTex === Tex.METAL ? Tex.DOOR_METAL : Tex.DOOR_WOOD);
    }
  }

  carveBureauLine(world, spine.x, spine.y0, spine.x, spine.y1, 3, spec.floorTex);
  carveBureauLine(world, spine.x, Math.floor((spine.y0 + spine.y1) / 2), spec.connector.x, spec.connector.y, 3, spec.floorTex);
  placeFeatureRow(world, spec.x + 2, spec.y + spec.rows * pitch.y + 1, spec.x + width - 2, spec.y + spec.rows * pitch.y + 1, 9, Feature.LAMP);
}

function addMiniHqCluster(world: World, spec: UpperBureauHqSpec): void {
  const hq = stampExpansionRoom(world, RoomType.HQ, spec.hqName, spec.x, spec.y, 26, 16, spec.floorTex, spec.wallTex);
  const common = stampExpansionRoom(world, RoomType.COMMON, `${spec.hqName}: общая`, spec.x - 30, spec.y + 1, 22, 12, spec.floorTex, Tex.MARBLE);
  const storage = stampExpansionRoom(world, RoomType.STORAGE, `${spec.hqName}: запас`, spec.x + 34, spec.y + 1, 20, 12, spec.floorTex, Tex.MARBLE);
  const kitchen = stampExpansionRoom(world, RoomType.KITCHEN, `${spec.hqName}: кухня`, spec.x - 28, spec.y + 22, 18, 10, Tex.F_TILE, Tex.TILE_W);
  const office = stampExpansionRoom(world, spec.owner === ZoneFaction.SCIENTIST ? RoomType.MEDICAL : RoomType.OFFICE, `${spec.hqName}: служба`, spec.x + 34, spec.y + 22, 22, 10, spec.floorTex, Tex.MARBLE);
  const bathroom = stampExpansionRoom(world, RoomType.BATHROOM, `${spec.hqName}: санузел`, spec.x + 5, spec.y + 22, 14, 9, Tex.F_TILE, Tex.TILE_W);

  decorateMicroRoom(world, hq, 0);
  decorateMicroRoom(world, common, 1);
  decorateMicroRoom(world, storage, 2);
  decorateMicroRoom(world, kitchen, 3);
  decorateMicroRoom(world, office, 4);
  decorateMicroRoom(world, bathroom, 5);

  carveBureauLine(world, spec.x - 34, spec.y + 18, spec.x + 60, spec.y + 18, 3, spec.floorTex);
  carveBureauLine(world, spec.x + 13, spec.y + 18, spec.connector.x, spec.connector.y, 3, spec.floorTex);
  carveBureauLine(world, common.x + (common.w >> 1), common.y + common.h + 1, common.x + (common.w >> 1), spec.y + 18, 1, spec.floorTex);
  carveBureauLine(world, storage.x + (storage.w >> 1), storage.y + storage.h + 1, storage.x + (storage.w >> 1), spec.y + 18, 1, spec.floorTex);
  carveBureauLine(world, kitchen.x + (kitchen.w >> 1), spec.y + 18, kitchen.x + (kitchen.w >> 1), kitchen.y - 2, 1, spec.floorTex);
  carveBureauLine(world, office.x + (office.w >> 1), spec.y + 18, office.x + (office.w >> 1), office.y - 2, 1, spec.floorTex);
  carveBureauLine(world, bathroom.x + (bathroom.w >> 1), spec.y + 18, bathroom.x + (bathroom.w >> 1), bathroom.y - 2, 1, spec.floorTex);
  addDoor(world, hq, hq.x + Math.floor(hq.w / 2), hq.y + hq.h, DoorState.HERMETIC_OPEN, '', Tex.DOOR_METAL);
  addDoor(world, common, common.x + (common.w >> 1), common.y + common.h, DoorState.CLOSED, '', Tex.DOOR_WOOD);
  addDoor(world, storage, storage.x + (storage.w >> 1), storage.y + storage.h, DoorState.CLOSED, '', Tex.DOOR_METAL);
  addDoor(world, kitchen, kitchen.x + (kitchen.w >> 1), kitchen.y - 1, DoorState.CLOSED, '', Tex.DOOR_WOOD);
  addDoor(world, office, office.x + (office.w >> 1), office.y - 1, DoorState.CLOSED, '', Tex.DOOR_METAL);
  addDoor(world, bathroom, bathroom.x + (bathroom.w >> 1), bathroom.y - 1, DoorState.CLOSED, '', Tex.DOOR_WOOD);
}

function addUpperBureauDistricts(world: World): void {
  carveRibbonLine(world, 40, 308, 964, 308, 5, Tex.F_MARBLE_TILE, Tex.F_GREEN_CARPET);
  carveRibbonLine(world, 40, 704, 964, 704, 5, Tex.F_MARBLE_TILE, Tex.F_GREEN_CARPET);
  carveRibbonLine(world, 308, 40, 308, 964, 5, Tex.F_MARBLE_TILE, Tex.F_RED_CARPET);
  carveRibbonLine(world, 676, 40, 676, 964, 5, Tex.F_MARBLE_TILE, Tex.F_GREEN_CARPET);

  for (const spec of UPPER_BUREAU_DISTRICTS) addBureauMicroDistrict(world, spec);
  for (const spec of UPPER_BUREAU_HQ_SPECS) addMiniHqCluster(world, spec);
}

export function expandUpperBureauGeometry(world: World, rng: () => number): void {
  addPublicQueueTier(world, rng);
  addPrivateOfficeTier(world, rng);
  addArchiveBalconyTier(world);
  addStaffBalconyTier(world);
  addServiceTier(world, rng);
  addUpperBureauDistricts(world);
  sealUpperBureauRouteCutRooms(world);
}

function setAdministrativeZones(world: World): void {
  generateZones(world);
  retuneUpperBureauZones(world);
}

interface UpperBureauZoneLevelMark {
  x: number;
  y: number;
  level: number;
}

const UPPER_BUREAU_TERRITORY_BUCKET_SIZE = 32;
const UPPER_BUREAU_TERRITORY_BUCKET_SIDE = W / UPPER_BUREAU_TERRITORY_BUCKET_SIZE;

const UPPER_BUREAU_ZONE_LEVEL_MARKS: readonly UpperBureauZoneLevelMark[] = [
  { x: 260, y: 508, level: 3 },
  { x: 356, y: 476, level: 3 },
  { x: 444, y: 508, level: 4 },
  { x: 468, y: 508, level: 4 },
  { x: 532, y: 508, level: 4 },
  { x: 628, y: 430, level: 4 },
  { x: 704, y: 508, level: 4 },
  { x: 724, y: 540, level: 5 },
  { x: 760, y: 635, level: 5 },
  { x: 840, y: 616, level: 5 },
  { x: 520, y: 640, level: 4 },
  { x: 584, y: 742, level: 4 },
  { x: 760, y: 742, level: 4 },
  { x: 220, y: 620, level: 3 },
  { x: 506, y: 246, level: 5 },
  { x: 822, y: 296, level: 4 },
];

const UPPER_BUREAU_SAMOSBOR_ZONE_MARKS: readonly { x: number; y: number }[] = [
  { x: 724, y: 540 },
  { x: 760, y: 635 },
  { x: 840, y: 616 },
];

function upperBureauBaselineZoneLevel(world: World, x: number, y: number): number {
  const archiveD = Math.min(
    world.dist(x, y, 758, 520),
    world.dist(x, y, 760, 635),
  );
  const serviceD = Math.min(
    world.dist(x, y, 584, 710),
    world.dist(x, y, 760, 742),
    world.dist(x, y, 220, 620),
  );
  const auditD = Math.min(
    world.dist(x, y, 532, 508),
    world.dist(x, y, 628, 430),
    world.dist(x, y, 546, 482),
  );
  const base = Math.max(2, calcZoneLevel(x, y, UPPER_BUREAU_BASE_FLOOR));
  const localBoost = archiveD < 185 ? 2 : serviceD < 195 || auditD < 170 ? 1 : 0;
  const edgeBoost = world.dist(x, y, W / 2, W / 2) > 310 ? 1 : 0;
  return Math.max(2, Math.min(5, base + localBoost + edgeBoost));
}

function applyUpperBureauZoneLevelMark(world: World, mark: UpperBureauZoneLevelMark): void {
  const zone = world.zones[world.zoneMap[world.idx(mark.x, mark.y)]];
  if (!zone) return;
  zone.level = Math.max(zone.level, mark.level);
}

function upperBureauHash01(a: number, b: number, c: number): number {
  let n = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b)
    ^ Math.imul(b ^ 0xc2b2ae35, 0x27d4eb2d)
    ^ Math.imul(c ^ 0x165667b1, 0x7feb352d);
  n ^= n >>> 15;
  n = Math.imul(n, 0x846ca68b);
  n ^= n >>> 16;
  return (n >>> 0) / 0x100000000;
}

function upperBureauRoomOwnerHint(room: Room | undefined): TerritoryOwner | undefined {
  if (!room) return undefined;
  for (const spec of UPPER_BUREAU_HQ_SPECS) {
    if (room.name === spec.hqName || room.name.startsWith(`${spec.hqName}:`)) return spec.owner;
  }
  if (
    room.name === 'Ниша проверки пропусков' ||
    room.name === 'Засада поддельных корешков' ||
    room.name === 'Малый кабинет аудиторской тени' ||
    room.name === 'Привилегированная приемная' ||
    room.name === 'Пост переписи сотрудников'
  ) return ZoneFaction.LIQUIDATOR;
  for (const spec of UPPER_BUREAU_DISTRICTS) {
    if (room.name.startsWith(spec.name)) return spec.owner;
  }
  return undefined;
}

function upperBureauRoomBias(room: Room | undefined, owner: TerritoryOwner): number {
  if (!room) return 0;
  const hint = upperBureauRoomOwnerHint(room);
  if (hint === owner) return -0.22;
  if (hint !== undefined) return 0.18;
  if (owner === ZoneFaction.CITIZEN && (room.type === RoomType.COMMON || room.type === RoomType.KITCHEN || room.type === RoomType.BATHROOM)) return -0.06;
  if (owner === ZoneFaction.LIQUIDATOR && (room.type === RoomType.HQ || room.type === RoomType.OFFICE)) return -0.07;
  if (owner === ZoneFaction.SCIENTIST && (room.type === RoomType.MEDICAL || room.type === RoomType.PRODUCTION)) return -0.1;
  if (owner === ZoneFaction.CULTIST && (room.type === RoomType.STORAGE || room.type === RoomType.SMOKING)) return -0.05;
  if (owner === ZoneFaction.WILD && (room.type === RoomType.STORAGE || room.type === RoomType.SMOKING || room.type === RoomType.PRODUCTION)) return -0.08;
  return 0;
}

function upperBureauOwnerScore(world: World, x: number, y: number, profile: UpperBureauTerritoryProfile, room: Room | undefined): number {
  let nearest = Infinity;
  for (const seed of profile.seeds) {
    const d = Math.sqrt(world.dist2(x, y, seed.x, seed.y)) / Math.max(0.1, seed.weight);
    if (d < nearest) nearest = d;
  }
  const distanceScore = nearest / (176 * profile.spread);
  const targetBias = profile.targetShare * 0.94;
  const noise = (upperBureauHash01(Math.floor(x / 11), Math.floor(y / 11), profile.owner + 17) - 0.5) * 0.12;
  return distanceScore - targetBias + noise + upperBureauRoomBias(room, profile.owner);
}

function paintUpperBureauTargetTerritory(world: World): void {
  const bucketCount = UPPER_BUREAU_TERRITORY_BUCKET_SIDE * UPPER_BUREAU_TERRITORY_BUCKET_SIDE;
  const ownerBuckets = new Uint8Array(bucketCount).fill(255);
  const quota = new Map<TerritoryOwner, number>();
  const assigned = new Map<TerritoryOwner, number>();
  let remaining = bucketCount;
  for (let i = 0; i < UPPER_BUREAU_TERRITORY_PROFILES.length; i++) {
    const profile = UPPER_BUREAU_TERRITORY_PROFILES[i];
    const target = i === UPPER_BUREAU_TERRITORY_PROFILES.length - 1
      ? remaining
      : Math.max(1, Math.round(profile.targetShare * bucketCount));
    quota.set(profile.owner, target);
    assigned.set(profile.owner, 0);
    remaining -= target;
  }

  const candidates: { owner: TerritoryOwner; bucket: number; score: number }[] = [];
  for (const profile of UPPER_BUREAU_TERRITORY_PROFILES) {
    for (let bucket = 0; bucket < bucketCount; bucket++) {
      const bx = bucket % UPPER_BUREAU_TERRITORY_BUCKET_SIDE;
      const by = (bucket / UPPER_BUREAU_TERRITORY_BUCKET_SIDE) | 0;
      const x = bx * UPPER_BUREAU_TERRITORY_BUCKET_SIZE + UPPER_BUREAU_TERRITORY_BUCKET_SIZE / 2;
      const y = by * UPPER_BUREAU_TERRITORY_BUCKET_SIZE + UPPER_BUREAU_TERRITORY_BUCKET_SIZE / 2;
      const rid = world.roomMap[world.idx(x, y)];
      const room = rid >= 0 ? world.rooms[rid] : undefined;
      candidates.push({ owner: profile.owner, bucket, score: upperBureauOwnerScore(world, x, y, profile, room) });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  for (const candidate of candidates) {
    if (ownerBuckets[candidate.bucket] !== 255) continue;
    const used = assigned.get(candidate.owner) ?? 0;
    const cap = quota.get(candidate.owner) ?? 0;
    if (used >= cap) continue;
    ownerBuckets[candidate.bucket] = candidate.owner;
    assigned.set(candidate.owner, used + 1);
  }
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    if (ownerBuckets[bucket] !== 255) continue;
    let bestOwner = UPPER_BUREAU_TERRITORY_PROFILES[0].owner;
    let bestOverflow = Infinity;
    for (const profile of UPPER_BUREAU_TERRITORY_PROFILES) {
      const used = assigned.get(profile.owner) ?? 0;
      const cap = Math.max(1, quota.get(profile.owner) ?? 1);
      const overflow = used / cap;
      if (overflow < bestOverflow) {
        bestOverflow = overflow;
        bestOwner = profile.owner;
      }
    }
    ownerBuckets[bucket] = bestOwner;
    assigned.set(bestOwner, (assigned.get(bestOwner) ?? 0) + 1);
  }

  for (let by = 0; by < UPPER_BUREAU_TERRITORY_BUCKET_SIDE; by++) {
    for (let bx = 0; bx < UPPER_BUREAU_TERRITORY_BUCKET_SIDE; bx++) {
      const owner = ownerBuckets[by * UPPER_BUREAU_TERRITORY_BUCKET_SIDE + bx] as TerritoryOwner;
      for (let dy = 0; dy < UPPER_BUREAU_TERRITORY_BUCKET_SIZE; dy++) {
        for (let dx = 0; dx < UPPER_BUREAU_TERRITORY_BUCKET_SIZE; dx++) {
          setTerritoryOwnerAtIndex(
            world,
            world.idx(bx * UPPER_BUREAU_TERRITORY_BUCKET_SIZE + dx, by * UPPER_BUREAU_TERRITORY_BUCKET_SIZE + dy),
            owner,
          );
        }
      }
    }
  }
}

function paintUpperBureauRoomTerritory(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) setTerritoryOwnerAtIndex(world, world.idx(room.x + dx, room.y + dy), owner);
  }
}

function paintUpperBureauHqTerritory(world: World): void {
  for (const room of world.rooms) {
    if (!room) continue;
    const owner = upperBureauRoomOwnerHint(room);
    if (owner === undefined) continue;
    paintUpperBureauRoomTerritory(world, room, owner);
    if (room.type !== RoomType.HQ) continue;
    const cx = room.x + (room.w >> 1);
    const cy = room.y + (room.h >> 1);
    for (let dy = -8; dy <= 8; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        if (dx * dx + dy * dy > 64) continue;
        const idx = world.idx(cx + dx, cy + dy);
        if (world.cells[idx] !== Cell.ABYSS && world.cells[idx] !== Cell.LIFT) setTerritoryOwnerAtIndex(world, idx, owner);
      }
    }
  }
}

function applyUpperBureauSamosborZoneOverlay(world: World): void {
  for (const mark of UPPER_BUREAU_SAMOSBOR_ZONE_MARKS) {
    const idx = world.idx(mark.x, mark.y);
    const zone = world.zones[world.zoneMap[idx]];
    if (!zone) continue;
    zone.faction = ZoneFaction.SAMOSBOR;
    zone.level = Math.max(zone.level, 5);
  }
}

export function retuneUpperBureauZones(world: World): void {
  for (const zone of world.zones) {
    zone.faction = ZoneFaction.CITIZEN;
    zone.level = upperBureauBaselineZoneLevel(world, zone.cx, zone.cy);
    zone.hqRoomId = -1;
    zone.fogged = false;
  }
  for (const mark of UPPER_BUREAU_ZONE_LEVEL_MARKS) applyUpperBureauZoneLevelMark(world, mark);
  paintUpperBureauTargetTerritory(world);
  paintUpperBureauHqTerritory(world);
  sealUpperBureauRouteCutRooms(world);
  syncZoneMetadataFromTerritory(world);
  applyUpperBureauSamosborZoneOverlay(world);
}

export function reinforceUpperBureauAuthoredHqTerritory(world: World): void {
  paintUpperBureauHqTerritory(world);
  sealUpperBureauRouteCutRooms(world);
  syncZoneMetadataFromTerritory(world);
  applyUpperBureauSamosborZoneOverlay(world);
}

type UpperBureauRooms = {
  salon: Room;
  executive: Room;
  files: Room;
  audit: Room;
  cleaner: Room;
  staffDesk: Room;
  shelter: Room;
  archiveToll: Room;
  permitAmbush: Room;
};

type NpcIds = {
  iskraId: number;
  levId: number;
  tolikId: number;
  tollKeeperId: number;
  ambushId: number;
};

function stampUpperBureauRooms(world: World): UpperBureauRooms {
  let nextRoomId = 0;
  const salon = stampBureauRoom(world, nextRoomId++, RoomType.COMMON, 'Салон ожидания верхнего бюро', 486, 497, 31, 21, Tex.F_RED_CARPET);
  const executive = stampBureauRoom(world, nextRoomId++, RoomType.OFFICE, 'Кабинет предварительных решений', 544, 493, 20, 14, Tex.F_PARQUET);
  const files = stampBureauRoom(world, nextRoomId++, RoomType.STORAGE, 'Нулевая картотека стертых имен', 568, 493, 18, 14, Tex.F_MARBLE_TILE);
  const audit = stampBureauRoom(world, nextRoomId++, RoomType.OFFICE, 'Аудиторская Льва', 535, 474, 22, 13, Tex.F_GREEN_CARPET);
  const cleaner = stampBureauRoom(world, nextRoomId++, RoomType.STORAGE, 'Чистая кладовая Толика', 494, 526, 15, 10, Tex.F_TILE);
  const staffDesk = stampBureauRoom(world, nextRoomId++, RoomType.OFFICE, 'Служебный стол обходных листов', 552, 526, 20, 10, Tex.F_MARBLE_TILE);
  const shelter = stampBureauRoom(world, nextRoomId++, RoomType.COMMON, 'Политическое укрытие при салоне', 464, 496, 16, 14, Tex.F_GREEN_CARPET);
  const archiveToll = stampBureauRoom(world, nextRoomId++, RoomType.OFFICE, 'Платный архивный проход', 588, 526, 22, 12, Tex.F_GREEN_CARPET);
  const permitAmbush = stampBureauRoom(world, nextRoomId++, RoomType.HQ, 'Засада поддельных корешков', 520, 548, 24, 12, Tex.F_RED_CARPET);

  return { salon, executive, files, audit, cleaner, staffDesk, shelter, archiveToll, permitAmbush };
}

function carveUpperBureauCorridors(world: World): void {
  carveFloorRect(world, 476, 506, 10, 5, Tex.F_RED_CARPET);
  carveFloorRect(world, 517, 506, 72, 5, Tex.F_RED_CARPET);
  carveFloorRect(world, 545, 487, 5, 19, Tex.F_GREEN_CARPET);
  carveFloorRect(world, 501, 518, 5, 8, Tex.F_MARBLE_TILE);
  carveFloorRect(world, 501, 537, 82, 5, Tex.F_MARBLE_TILE);
  carveFloorRect(world, 578, 507, 5, 31, Tex.F_MARBLE_TILE);
  carveFloorRect(world, 480, 503, 6, 6, Tex.F_RED_CARPET);
  carveFloorRect(world, 583, 531, 5, 5, Tex.F_GREEN_CARPET);
  carveFloorRect(world, 530, 542, 5, 6, Tex.F_MARBLE_TILE);
}

function addUpperBureauDoorsAndLifts(world: World, rooms: UpperBureauRooms): void {
  const { salon, shelter, executive, files, audit, cleaner, staffDesk, archiveToll, permitAmbush } = rooms;

  addDoor(world, salon, 485, 508);
  addDoor(world, salon, 517, 508);
  addDoor(world, shelter, 480, 503, DoorState.HERMETIC_CLOSED, '', Tex.DOOR_METAL);
  addDoor(world, executive, 552, 507);
  addDoor(world, files, 576, 507, DoorState.CLOSED, '', Tex.DOOR_METAL);
  addDoor(world, audit, 546, 487);
  addDoor(world, cleaner, 502, 525, DoorState.CLOSED, '', Tex.DOOR_METAL);
  addDoor(world, cleaner, 502, 536, DoorState.CLOSED, '', Tex.DOOR_METAL);
  addDoor(world, staffDesk, 560, 525);
  addDoor(world, archiveToll, 587, 532, DoorState.CLOSED, '', Tex.DOOR_METAL);
  addDoor(world, permitAmbush, 532, 547, DoorState.CLOSED, '', Tex.DOOR_METAL);

  addGatePartition(world, 532, 504, 512, 508, UPPER_BUREAU_DOCUMENTS.cleanerKey);
  addGatePartition(world, 522, 536, 543, 540, UPPER_BUREAU_DOCUMENTS.cleanerKey);

  placeLiftCell(world, 477, 508, 478, 508, LiftDirection.UP);
  placeLiftCell(world, 586, 540, 584, 540, LiftDirection.DOWN);
}

function decorateUpperBureauRooms(world: World, rooms: UpperBureauRooms): void {
  decorateSalon(world, rooms.salon);
  decorateOffice(world, rooms.executive);
  decorateOffice(world, rooms.audit);
  decorateOffice(world, rooms.staffDesk);
  decorateFileRoom(world, rooms.files);
  decorateCleanerRoom(world, rooms.cleaner);
  decorateSalon(world, rooms.shelter);
  decorateOffice(world, rooms.archiveToll);
  decorateOffice(world, rooms.permitAmbush);
}

function spawnUpperBureauNpcs(entities: Entity[], nextId: NextId, rooms: UpperBureauRooms): NpcIds {
  const { salon, audit, cleaner, archiveToll, permitAmbush } = rooms;

  const iskraId = nextId.v;
  spawnAdminNpc(entities, nextId, ISKRA_DEF, 'bureau_madam_iskra', salon.x + 6, salon.y + 3);

  const levId = nextId.v;
  spawnAdminNpc(entities, nextId, LEV_DEF, 'bureau_auditor_lev', audit.x + 10, audit.y + 3, true, 'makarov');

  const tolikId = nextId.v;
  spawnAdminNpc(entities, nextId, TOLIK_DEF, 'bureau_cleaner_tolik', cleaner.x + 4, cleaner.y + 4);

  spawnAdminNpc(entities, nextId, ANNA_DEF, 'bureau_visitor_anna', salon.x + 21, salon.y + 13);

  const tollKeeperId = nextId.v;
  spawnAdminNpc(entities, nextId, TOLL_KEEPER_DEF, 'bureau_archive_toll_keeper', archiveToll.x + 4, archiveToll.y + 4);

  const ambushId = nextId.v;
  spawnAdminNpc(entities, nextId, AMBUSH_DEF, 'bureau_permit_ambush_guard', permitAmbush.x + 5, permitAmbush.y + 4, true, 'makarov');

  spawnNamedCivilian(
    entities, nextId, 'Инспектор Главного Поста', false,
    530, 510, Occupation.HUNTER, Faction.LIQUIDATOR,
    [{ defId: 'key', count: 1 }, { defId: 'makarov', count: 1 }, { defId: 'ammo_9mm', count: 10 }],
    'makarov',
  );
  spawnNamedCivilian(
    entities, nextId, 'Понятая у ковра', true,
    salon.x + 9, salon.y + 12, Occupation.SECRETARY, Faction.CITIZEN,
    [{ defId: 'sealed_complaint', count: 1 }, { defId: 'tea', count: 1 }],
  );
  spawnNamedCivilian(
    entities, nextId, 'Младший Засадный', false,
    permitAmbush.x + permitAmbush.w - 5, permitAmbush.y + 7, Occupation.HUNTER, Faction.LIQUIDATOR,
    [{ defId: 'denunciation', count: 1 }, { defId: 'ammo_9mm', count: 6 }],
    'makarov',
  );

  return { iskraId, levId, tolikId, tollKeeperId, ambushId };
}

function addUpperBureauItems(entities: Entity[], nextId: NextId, rooms: UpperBureauRooms): void {
  const { salon, cleaner, files, audit, permitAmbush } = rooms;
  addItemDrop(entities, nextId, salon.x + 4, salon.y + salon.h - 3, 'blank_form', 1);
  addItemDrop(entities, nextId, salon.x + 8, salon.y + salon.h - 3, 'official_permit_slip', 1);
  addItemDrop(entities, nextId, cleaner.x + cleaner.w - 3, cleaner.y + 2, 'cleaning_kit', 1);
  addItemDrop(entities, nextId, files.x + 3, files.y + 2, 'missing_record_file', 1);
  addItemDrop(entities, nextId, files.x + files.w - 4, files.y + 2, 'record_exposure_notice', 1);
  addItemDrop(entities, nextId, audit.x + 3, audit.y + audit.h - 3, 'denunciation', 1);
  addItemDrop(entities, nextId, permitAmbush.x + 3, permitAmbush.y + permitAmbush.h - 3, 'forged_permit_slip', 1);
}

function addUpperBureauContainers(world: World, rooms: UpperBureauRooms, ids: NpcIds): void {
  const { executive, files, cleaner, audit, archiveToll, permitAmbush, salon } = rooms;

  addBureauContainer(
    world, executive, executive.x + executive.w - 3, executive.y + 2,
    ContainerKind.SAFE,
    'Сейф предварительных назначений',
    'locked',
    [
      { defId: 'official_permit_slip', count: 1 },
      { defId: 'raionsovet_floor_pass', count: 1 },
      { defId: 'permanent_pass', count: 1 },
      { defId: 'elevator_access_order', count: 1 },
    ],
    ['appointment', 'locked', 'paper'],
    { id: ids.iskraId, name: ISKRA_DEF.name, faction: Faction.CITIZEN },
  );
  addBureauContainer(
    world, files, files.x + 2, files.y + 2,
    ContainerKind.FILING_CABINET,
    'Нулевая картотека',
    'faction',
    [
      { defId: 'missing_record_file', count: 1 },
      { defId: 'record_exposure_notice', count: 1 },
      { defId: 'personal_file_copy', count: 1 },
      { defId: 'stolen_archive_card', count: 1 },
    ],
    ['record_edit', 'name_erasure', 'audit', 'theft'],
    { id: ids.levId, name: LEV_DEF.name, faction: Faction.LIQUIDATOR },
  );
  addBureauContainer(
    world, cleaner, cleaner.x + 2, cleaner.y + cleaner.h - 3,
    ContainerKind.TOOL_LOCKER,
    'Связка служебных ключей Толика',
    'owner',
    [
      { defId: 'key', count: 1 },
      { defId: 'elevator_access_order', count: 1 },
      { defId: 'cigs', count: 2 },
    ],
    ['staff_route', 'key', 'theft'],
    { id: ids.tolikId, name: TOLIK_DEF.name, faction: Faction.CITIZEN },
  );
  addBureauContainer(
    world, audit, audit.x + audit.w - 3, audit.y + audit.h - 3,
    ContainerKind.FILING_CABINET,
    'Папка аудита рынка 88',
    'owner',
    [
      { defId: 'denunciation', count: 2 },
      { defId: 'record_exposure_notice', count: 1 },
      { defId: 'official_permit_slip', count: 1 },
      { defId: 'confiscation_warrant', count: 1 },
    ],
    ['audit', 'black_market_88', 'paper'],
    { id: ids.levId, name: LEV_DEF.name, faction: Faction.LIQUIDATOR },
  );
  addBureauContainer(
    world, archiveToll, archiveToll.x + archiveToll.w - 3, archiveToll.y + 3,
    ContainerKind.CASHBOX,
    'Касса архивной пошлины',
    'owner',
    [
      { defId: 'archive_access_permit', count: 1 },
      { defId: 'debt_settlement_receipt', count: 1 },
      { defId: 'elevator_access_order', count: 1 },
      { defId: 'blank_form', count: 2 },
    ],
    ['archive_toll', 'route_clue', 'paper'],
    { id: ids.tollKeeperId, name: TOLL_KEEPER_DEF.name, faction: Faction.CITIZEN },
  );
  addBureauContainer(
    world, permitAmbush, permitAmbush.x + permitAmbush.w - 4, permitAmbush.y + permitAmbush.h - 3,
    ContainerKind.FILING_CABINET,
    'Папка подставных корешков',
    'faction',
    [
      { defId: 'forged_permit_slip', count: 1 },
      { defId: 'forged_raionsovet_pass', count: 1 },
      { defId: 'record_exposure_notice', count: 1 },
      { defId: 'denunciation', count: 1 },
    ],
    ['permit_ambush', 'exposure', 'audit', 'theft'],
    { id: ids.ambushId, name: AMBUSH_DEF.name, faction: Faction.LIQUIDATOR },
  );
  addBureauContainer(
    world, salon, salon.x + 3, salon.y + salon.h - 4,
    ContainerKind.EMERGENCY_BOX,
    'Чайный стол ожидания',
    'public',
    [
      { defId: 'tea', count: 2 },
      { defId: 'water', count: 1 },
      { defId: 'blank_form', count: 1 },
    ],
    ['public', 'salon'],
  );
}

function finalizeUpperBureauFloor(world: World, salon: Room): void {
  for (const room of world.rooms) {
    if (!room) continue;
    for (let dy = 1; dy < room.h - 1; dy += 5) {
      for (let dx = 1; dx < room.w - 1; dx += 5) {
        const ci = world.idx(room.x + dx, room.y + dy);
        if (world.cells[ci] === Cell.FLOOR && world.features[ci] === Feature.NONE) world.features[ci] = Feature.LAMP;
      }
    }
  }

  ensureConnectivity(world, salon.x + 8.5, salon.y + 10.5);
  placeProceduralScreens(world, UPPER_BUREAU_BASE_FLOOR);
  world.bakeLights();
}

export function generateUpperBureauDesignFloor(): { world: World; entities: Entity[]; spawnX: number; spawnY: number } {
  const world = new World();
  const entities: Entity[] = [];
  const nextId: NextId = { v: 1 };

  fillDefaultTextures(world);

  const rooms = stampUpperBureauRooms(world);
  carveUpperBureauCorridors(world);
  addUpperBureauDoorsAndLifts(world, rooms);
  decorateUpperBureauRooms(world, rooms);
  setAdministrativeZones(world);

  const npcIds = spawnUpperBureauNpcs(entities, nextId, rooms);
  addUpperBureauItems(entities, nextId, rooms);
  addUpperBureauContainers(world, rooms, npcIds);
  spawnAdminMonster(world, entities, nextId, rooms.files.x + rooms.files.w - 4, rooms.files.y + rooms.files.h - 3, MonsterKind.PARAGRAPH);

  finalizeUpperBureauFloor(world, rooms.salon);

  const spawnX = rooms.salon.x + 8.5;
  const spawnY = rooms.salon.y + 10.5;
  genLog(`[UPPER_BUREAU] ${UPPER_BUREAU_DISPLAY_NAME} ${UPPER_BUREAU_ROUTE_ID} z=${UPPER_BUREAU_ANCHOR_Z} spawn=(${spawnX}, ${spawnY})`);
  return { world, entities, spawnX, spawnY };
}
