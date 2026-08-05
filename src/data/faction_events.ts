import {
  Faction,
  Occupation,
  RoomType,
  ZoneFaction,
  type Item,
  type WorldEventPrivacy,
  type WorldEventSeverity,
} from '../core/types';

export type FactionEventKind =
  | 'patrol'
  | 'relief_caravan'
  | 'tax_raid'
  | 'chernobog_recruitment'
  | 'black_hand_marks'
  | 'external_supply_cell'
  | 'blocked_corridor'
  | 'cult_procession'
  | 'cult_liquidator_clash'
  | 'chernobog_archive_evidence'
  | 'wild_looters'
  | 'liquidator_sweep'
  | 'nii_sample_audit'
  | 'ministerial_recount';

export type FactionResidueMarkKind =
  | 'blood'
  | 'gore'
  | 'bullet'
  | 'scorch'
  | 'psi'
  | 'ash'
  | 'chalk'
  | 'water'
  | 'scuff';

export type FactionPressureShape = 'patch' | 'route' | 'cordon';
export type FactionResidueChoiceKind = 'cleanup' | 'avoid' | 'report' | 'loot' | 'follow' | 'disguise' | 'disrupt';

export interface FactionResidueChoiceDef {
  kind: FactionResidueChoiceKind;
  text: string;
}

export interface FactionResidueMarkDef {
  kind: FactionResidueMarkKind;
  count: number;
  radius: number;
  intensity?: number;
}

export interface FactionPressureDef {
  radius: number;
  strength: number;
  text: string;
  shape?: FactionPressureShape;
  maxCells?: number;
  routeRadius?: number;
  targetRoomTypes?: readonly RoomType[];
}

export interface CultProcessionDef {
  activeSec: number;
  actionRadius: number;
  fearRadius: number;
  controlRadius: number;
  coverSec: number;
}

export type FactionClashOutcome =
  | 'liquidators_win'
  | 'cultists_win'
  | 'mutual_ruin'
  | 'unresolved';

export interface FactionClashSideDef {
  label: string;
  faction: Faction;
  occupation: Occupation;
  minGroup: number;
  maxGroup: number;
  weapons?: readonly string[];
  npcInventory?: readonly Item[];
}

export interface FactionClashOutcomeDef {
  outcome: FactionClashOutcome;
  text: string;
  winnerFaction?: Faction;
  items: readonly Item[];
  rumorIds: readonly string[];
}

export interface FactionClashDef {
  sides: readonly [FactionClashSideDef, FactionClashSideDef];
  reportFaction: Faction;
  reportRewardMoney: number;
  reportText: string;
  outcomes: readonly FactionClashOutcomeDef[];
}

export interface FactionEventDef {
  id: FactionEventKind;
  name: string;
  zoneFactions: readonly ZoneFaction[];
  actorFaction?: Faction;
  occupation: Occupation;
  weight: number;
  cooldownSec: number;
  minGroup: number;
  maxGroup: number;
  weapons?: readonly string[];
  npcInventory?: readonly Item[];
  drops?: readonly Item[];
  containerDrops?: readonly Item[];
  economyDeltas?: readonly { resourceId: string; count: number }[];
  marks: readonly FactionResidueMarkDef[];
  pressure: FactionPressureDef;
  residueText: string;
  residueChoices?: readonly FactionResidueChoiceDef[];
  message: string;
  itemId?: string;
  severity: WorldEventSeverity;
  privacy: WorldEventPrivacy;
  tags: readonly string[];
  procession?: CultProcessionDef;
  clash?: FactionClashDef;
}

const CIVIL_ZONES = [ZoneFaction.CITIZEN] as const;
const LIQUIDATOR_ZONES = [ZoneFaction.LIQUIDATOR] as const;
const CULTIST_ZONES = [ZoneFaction.CULTIST] as const;
const CULT_CONFLICT_ZONES = [ZoneFaction.CULTIST, ZoneFaction.LIQUIDATOR] as const;
const WILD_ZONES = [ZoneFaction.WILD] as const;
const OWNED_ZONES = [
  ZoneFaction.CITIZEN,
  ZoneFaction.LIQUIDATOR,
  ZoneFaction.CULTIST,
  ZoneFaction.WILD,
] as const;

const SHORTAGE_RESIDUE_CHOICES = [
  { kind: 'cleanup', text: 'подобрать воду/хлеб и вернуть найденное в ближайший запас' },
  { kind: 'avoid', text: 'обойти очередь и не входить в давку' },
  { kind: 'report', text: 'сказать старшему у пайкового стола, где просела поставка' },
] as const satisfies readonly FactionResidueChoiceDef[];

const ENFORCEMENT_RESIDUE_CHOICES = [
  { kind: 'cleanup', text: 'собрать гильзы и бумаги, замыть кровь до второго обхода' },
  { kind: 'avoid', text: 'обойти пост и не шуметь у линии контроля' },
  { kind: 'report', text: 'передать след ликвидатору как свидетельство' },
] as const satisfies readonly FactionResidueChoiceDef[];

const CULT_RESIDUE_CHOICES = [
  { kind: 'cleanup', text: 'снять мясную руну или смыть отпечаток ладони, пока знак свежий' },
  { kind: 'avoid', text: 'держаться у стены и дать ходу пройти мимо' },
  { kind: 'report', text: 'сдать маршрут или знак ликвидаторам' },
] as const satisfies readonly FactionResidueChoiceDef[];

const PROCESSION_RESIDUE_CHOICES = [
  { kind: 'avoid', text: 'переждать ход у края коридора' },
  { kind: 'follow', text: 'пойти в хвосте и запомнить опасный маршрут' },
  { kind: 'report', text: 'доложить по рации ликвидаторам' },
  { kind: 'disguise', text: 'пройти под мясной руной' },
  { kind: 'disrupt', text: 'сорвать ход насилием' },
  { kind: 'cleanup', text: 'после хода подобрать руну и следы крови' },
] as const satisfies readonly FactionResidueChoiceDef[];

const CLASH_RESIDUE_CHOICES = [
  { kind: 'cleanup', text: 'забрать свидетельство, гильзы или знак с места боя' },
  { kind: 'avoid', text: 'уйти из сектора до оформления тел' },
  { kind: 'report', text: 'сдать свидетельство ликвидатору' },
  { kind: 'loot', text: 'снять добычу, пока обе стороны заняты' },
] as const satisfies readonly FactionResidueChoiceDef[];

const EVIDENCE_RESIDUE_CHOICES = [
  { kind: 'cleanup', text: 'спрятать бумагу или унести улику до слухов' },
  { kind: 'avoid', text: 'не трогать архивный след и не становиться свидетелем' },
  { kind: 'report', text: 'отдать копию тому, кто оформит дело' },
] as const satisfies readonly FactionResidueChoiceDef[];

const THEFT_RESIDUE_CHOICES = [
  { kind: 'cleanup', text: 'подобрать остатки и закрыть вскрытый ящик' },
  { kind: 'avoid', text: 'обойти чужой запас, пока хозяева ищут виновного' },
  { kind: 'report', text: 'сдать след налета посту или старшему секции' },
  { kind: 'loot', text: 'добрать то, что мародеры не успели унести' },
] as const satisfies readonly FactionResidueChoiceDef[];

export const FACTION_EVENT_DEFS: readonly FactionEventDef[] = [
  {
    id: 'patrol',
    name: 'Патруль зоны',
    zoneFactions: OWNED_ZONES,
    occupation: Occupation.TRAVELER,
    weight: 22,
    cooldownSec: 220,
    minGroup: 2,
    maxGroup: 3,
    npcInventory: [{ defId: 'bread', count: 1 }],
    drops: [{ defId: 'cigs', count: 1 }],
    economyDeltas: [{ resourceId: 'labor', count: -1 }],
    marks: [{ kind: 'scuff', count: 3, radius: 0.18, intensity: 90 }],
    pressure: {
      radius: 8,
      strength: 0.42,
      shape: 'route',
      maxCells: 42,
      routeRadius: 1,
      targetRoomTypes: [RoomType.HQ, RoomType.COMMON, RoomType.CORRIDOR],
      text: 'Патруль прошел между постом и общим коридором: по его следу можно идти хвостом, но пересечение поперек заметят и попросят бумагу.',
    },
    residueText: 'окурок у стены, свежие следы ботинок, хлебная крошка и меловая граница нового обхода',
    message: 'Малый патруль прошел по секции: рабочие руки ушли на обход, а коридор теперь проверяют по меловой линии.',
    severity: 2,
    privacy: 'local',
    tags: ['faction', 'patrol'],
  },
  {
    id: 'relief_caravan',
    name: 'Эскорт дефицита',
    zoneFactions: CIVIL_ZONES,
    actorFaction: Faction.CITIZEN,
    occupation: Occupation.TRAVELER,
    weight: 12,
    cooldownSec: 360,
    minGroup: 3,
    maxGroup: 4,
    npcInventory: [{ defId: 'water', count: 1 }, { defId: 'bread', count: 1 }],
    drops: [{ defId: 'water', count: 2 }, { defId: 'bread', count: 2 }, { defId: 'bandage', count: 1 }],
    containerDrops: [{ defId: 'water', count: 1 }, { defId: 'bread', count: 1 }],
    economyDeltas: [{ resourceId: 'drink_water', count: 4 }, { resourceId: 'food', count: 3 }, { resourceId: 'medicine', count: 1 }],
    marks: [{ kind: 'water', count: 2, radius: 0.22, intensity: 80 }, { kind: 'chalk', count: 1, radius: 0.28, intensity: 95 }],
    pressure: {
      radius: 8,
      strength: 0.48,
      shape: 'route',
      maxCells: 52,
      routeRadius: 1,
      targetRoomTypes: [RoomType.KITCHEN, RoomType.STORAGE, RoomType.MEDICAL],
      text: 'Жильцы ведут воду и хлеб к пайковому столу: можно идти в хвосте, обойти кухней или лезть к ящику и получить давку.',
    },
    residueText: 'бутылки воды, хлебная крошка, мокрые следы, мел очереди и пополненный местный контейнер',
    residueChoices: SHORTAGE_RESIDUE_CHOICES,
    message: 'Жильцы тащат воду и хлеб к пайковому столу; кто помогает эскорту, получает проход, кто режет очередь, поднимает толпу.',
    itemId: 'water',
    severity: 3,
    privacy: 'local',
    tags: ['faction', 'caravan', 'relief', 'shortage_escort'],
  },
  {
    id: 'tax_raid',
    name: 'Налоговый рейд',
    zoneFactions: LIQUIDATOR_ZONES,
    actorFaction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    weight: 13,
    cooldownSec: 300,
    minGroup: 3,
    maxGroup: 5,
    weapons: ['makarov', 'tt_pistol', 'entrenching_spade'],
    npcInventory: [{ defId: 'ammo_9mm', count: 8 }, { defId: 'liquidator_token', count: 1 }],
    drops: [{ defId: 'note', count: 1, data: 'Опись ликвидаторов: из кладовой изъяли еду и корешки за долги секции, спорящих отправить к сержанту.' }],
    containerDrops: [{ defId: 'note', count: 1, data: 'Квитанция рейда: шкаф вскрыт, недостача записана, повторный осмотр будет после отбоя.' }],
    economyDeltas: [{ resourceId: 'documents', count: -4 }, { resourceId: 'food', count: -2 }],
    marks: [{ kind: 'bullet', count: 2, radius: 0.16, intensity: 180 }, { kind: 'blood', count: 2, radius: 0.2, intensity: 160 }],
    pressure: { radius: 7, strength: 0.65, text: 'Рейд прижал кладовые и бумаги: у ящиков требуют жетон, а без него путь к запасам заканчивается обыском.' },
    residueText: 'дырки от пуль, кровь у ящика, квитанция рейда, сорванная пломба и просевшие бумажные запасы',
    residueChoices: ENFORCEMENT_RESIDUE_CHOICES,
    message: 'Ликвидаторы выбивают долги из кладовых: документы и еда уходят в опись, вокруг шкафов стало опаснее шуметь.',
    itemId: 'liquidator_token',
    severity: 4,
    privacy: 'local',
    tags: ['faction', 'raid', 'tax'],
  },
  {
    id: 'chernobog_recruitment',
    name: 'Вербовка Чернобога',
    zoneFactions: CIVIL_ZONES,
    actorFaction: Faction.CULTIST,
    occupation: Occupation.TRAVELER,
    weight: 8,
    cooldownSec: 420,
    minGroup: 2,
    maxGroup: 4,
    weapons: ['knife'],
    npcInventory: [{ defId: 'bread', count: 1 }, { defId: 'cigs', count: 1 }],
    drops: [{ defId: 'note', count: 1, data: 'Записка без подписи: хлеб вечером под батарею, про Чернобога на кухне не спрашивать, должников вести по одному.' }],
    containerDrops: [{ defId: 'note', count: 1, data: 'Список соседей: кому нужна вода, кто должен за фильтр, кого можно позвать без детей и свидетелей.' }],
    economyDeltas: [{ resourceId: 'food', count: -1 }, { resourceId: 'documents', count: 1 }],
    marks: [{ kind: 'chalk', count: 2, radius: 0.2, intensity: 105 }, { kind: 'scuff', count: 2, radius: 0.18, intensity: 90 }],
    pressure: { radius: 4, strength: 0.3, text: 'После тихой вербовки просьбы идут через соседей: хлеб вечером, долг вслух не называть, с детьми у двери не торговаться.' },
    residueText: 'хлебная крошка, окурок, меловая ладонь, список бытовых долгов и водная отметка у батареи',
    residueChoices: CULT_RESIDUE_CHOICES,
    message: 'Чернобожники обходят должников: дают хлеб сейчас, а потом требуют воду, молчание и адрес следующего соседа.',
    itemId: 'note',
    severity: 3,
    privacy: 'witnessed',
    tags: ['faction', 'cult', 'chernobog', 'external_cell', 'witness'],
  },
  {
    id: 'black_hand_marks',
    name: 'Черные ладони',
    zoneFactions: OWNED_ZONES,
    actorFaction: Faction.CULTIST,
    occupation: Occupation.PILGRIM,
    weight: 9,
    cooldownSec: 360,
    minGroup: 0,
    maxGroup: 1,
    weapons: ['knife'],
    drops: [{ defId: 'note', count: 1, data: 'Оборот листка замазан черной ладонью; на лицевой стороне номер подъезда и пометка не смывать до ночного обхода.' }],
    economyDeltas: [{ resourceId: 'paper', count: -1 }],
    marks: [{ kind: 'ash', count: 3, radius: 0.26, intensity: 160 }, { kind: 'chalk', count: 2, radius: 0.22, intensity: 120 }, { kind: 'scuff', count: 2, radius: 0.18, intensity: 90 }],
    pressure: { radius: 5, strength: 0.35, text: 'Черная ладонь метит коридор как чужой проход: жильцы жмутся к стене, а патруль проверяет, кто пытался смыть знак.' },
    residueText: 'сажные отпечатки ладони, меловой край, листок с номером подъезда и след мокрой тряпки',
    residueChoices: CULT_RESIDUE_CHOICES,
    message: 'На стенах появились черные ладони: теперь проход спорный, а смывшего метку будут искать и культ, и пост.',
    itemId: 'note',
    severity: 3,
    privacy: 'local',
    tags: ['faction', 'cult', 'chernobog', 'black_hand', 'witness'],
  },
  {
    id: 'external_supply_cell',
    name: 'Внешняя ячейка снабжения',
    zoneFactions: CIVIL_ZONES,
    actorFaction: Faction.CULTIST,
    occupation: Occupation.STOREKEEPER,
    weight: 7,
    cooldownSec: 460,
    minGroup: 1,
    maxGroup: 2,
    weapons: ['knife', 'pipe'],
    npcInventory: [{ defId: 'bread', count: 1 }, { defId: 'water', count: 1 }, { defId: 'note', count: 1, data: 'Пайки передать через кухню; черную метку не показывать у очереди, курьера менять после сирены.' }],
    drops: [{ defId: 'bread', count: 1 }, { defId: 'water', count: 1 }],
    containerDrops: [{ defId: 'bread', count: 1 }, { defId: 'water', count: 1 }, { defId: 'note', count: 1, data: 'Снабжение внешней ячейки: вода и хлеб через кухню, старого курьера не искать у поста.' }],
    economyDeltas: [{ resourceId: 'food', count: -2 }, { resourceId: 'drink_water', count: -2 }, { resourceId: 'documents', count: 1 }],
    marks: [{ kind: 'water', count: 2, radius: 0.2, intensity: 80 }, { kind: 'chalk', count: 2, radius: 0.24, intensity: 110 }],
    pressure: { radius: 5, strength: 0.4, text: 'Кладовые вокруг ячейки пустеют тихо: воду уносят через кухню, свидетелей кормят первыми, а пустой ящик списывают на очередь.' },
    residueText: 'пайковый узел, мокрый след, кухонная меловая метка, список курьеров и пустой водный ящик',
    residueChoices: CULT_RESIDUE_CHOICES,
    message: 'Внешняя ячейка Чернобога таскает воду и хлеб через кухни; запасы падают, зато в секции появляются новые курьеры.',
    itemId: 'bread',
    severity: 3,
    privacy: 'witnessed',
    tags: ['faction', 'cult', 'chernobog', 'external_cell', 'contraband'],
  },
  {
    id: 'blocked_corridor',
    name: 'Перекрытый коридор',
    zoneFactions: LIQUIDATOR_ZONES,
    actorFaction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    weight: 7,
    cooldownSec: 480,
    minGroup: 2,
    maxGroup: 2,
    weapons: ['makarov', 'pipe'],
    npcInventory: [{ defId: 'ammo_9mm', count: 8 }, { defId: 'liquidator_token', count: 1 }],
    drops: [{ defId: 'note', count: 1, data: 'Постовой лист: коридор перекрыт до проверки проходящих, обход разрешен только с записью фамилии.' }],
    containerDrops: [{ defId: 'note', count: 1, data: 'Журнал блок-поста: кто прошел по бумаге, кто обошел через кухню, кто сделал вид, что не видел.' }],
    economyDeltas: [{ resourceId: 'documents', count: -1 }, { resourceId: 'ammo', count: -1 }],
    marks: [{ kind: 'chalk', count: 2, radius: 0.2, intensity: 120 }, { kind: 'bullet', count: 1, radius: 0.16, intensity: 170 }, { kind: 'scuff', count: 3, radius: 0.18, intensity: 110 }],
    pressure: {
      radius: 6,
      strength: 0.82,
      shape: 'cordon',
      maxCells: 36,
      routeRadius: 1,
      targetRoomTypes: [RoomType.CORRIDOR, RoomType.HQ, RoomType.COMMON],
      text: 'Блок-пост встал поперек прохода: показывай бумагу, ищи обход через общий зал или готовься к шуму и отметке в журнале.',
    },
    residueText: 'меловая линия, постовой лист, гильза, следы людей в обход и свежая подпись дежурного',
    residueChoices: ENFORCEMENT_RESIDUE_CHOICES,
    message: 'Ликвидаторы поставили малый блок-пост: проход стоит бумаги, обход стоит времени, шум стоит патронов.',
    itemId: 'liquidator_token',
    severity: 4,
    privacy: 'local',
    tags: ['faction', 'liquidator', 'blockade', 'blocked_corridor', 'route_pressure'],
  },
  {
    id: 'cult_procession',
    name: 'Культовая процессия',
    zoneFactions: CULTIST_ZONES,
    actorFaction: Faction.CULTIST,
    occupation: Occupation.PILGRIM,
    weight: 6,
    cooldownSec: 620,
    minGroup: 4,
    maxGroup: 5,
    weapons: ['knife', 'psi_madness', 'psi_strike'],
    npcInventory: [{ defId: 'meat_rune', count: 1 }],
    drops: [{ defId: 'meat_rune', count: 1 }],
    economyDeltas: [{ resourceId: 'psi', count: 1 }],
    marks: [{ kind: 'psi', count: 3, radius: 0.28, intensity: 190 }, { kind: 'gore', count: 1, radius: 0.32, intensity: 190 }],
    pressure: {
      radius: 6,
      strength: 0.58,
      shape: 'route',
      maxCells: 42,
      routeRadius: 1,
      targetRoomTypes: [RoomType.HQ, RoomType.COMMON, RoomType.CORRIDOR],
      text: 'Процессия занимает узкий ход: уступи к стене, иди за хвостом или сдавай маршрут старшему, пока они не закрыли коридор пением.',
    },
    residueText: 'мясная руна, фиолетовые ожоги пола, темный сгусток крови у поворота и следы людей у дверей',
    residueChoices: PROCESSION_RESIDUE_CHOICES,
    message: 'Культовая процессия заняла коридор: жильцы жмутся к дверям, а открытый проход теперь идет за их хвостом.',
    itemId: 'meat_rune',
    severity: 4,
    privacy: 'local',
    tags: ['faction', 'cult', 'chernobog', 'procession'],
    procession: { activeSec: 55, actionRadius: 9, fearRadius: 16, controlRadius: 6, coverSec: 30 },
  },
  {
    id: 'cult_liquidator_clash',
    name: 'Стычка ликвидаторов и культа',
    zoneFactions: CULT_CONFLICT_ZONES,
    actorFaction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    weight: 8,
    cooldownSec: 520,
    minGroup: 3,
    maxGroup: 5,
    weapons: ['makarov', 'shotgun', 'entrenching_spade'],
    npcInventory: [{ defId: 'ammo_9mm', count: 8 }, { defId: 'bandage', count: 1 }],
    drops: [{ defId: 'ammo_9mm', count: 6 }, { defId: 'meat_rune', count: 1 }],
    containerDrops: [{ defId: 'note', count: 1, data: 'Протокол столкновения: черные ладони, один свидетель, оружие изъять без огласки, тела не считать при жильцах.' }],
    economyDeltas: [{ resourceId: 'ammo', count: -4 }, { resourceId: 'medicine', count: -1 }, { resourceId: 'documents', count: 1 }],
    marks: [{ kind: 'bullet', count: 3, radius: 0.17, intensity: 210 }, { kind: 'blood', count: 3, radius: 0.22, intensity: 175 }, { kind: 'ash', count: 2, radius: 0.26, intensity: 150 }],
    pressure: {
      radius: 6,
      strength: 0.62,
      shape: 'cordon',
      maxCells: 48,
      routeRadius: 1,
      targetRoomTypes: [RoomType.CORRIDOR, RoomType.HQ, RoomType.COMMON],
      text: 'После стычки проход режет новая линия контроля: приказ на одной стене, черная ладонь на другой, а посередине спрашивают свидетелей.',
    },
    clash: {
      reportFaction: Faction.LIQUIDATOR,
      reportRewardMoney: 45,
      reportText: 'Ликвидатор принял свидетельство о схватке, выдал деньги за доклад и записал ваш номер как свидетеля.',
      sides: [
        {
          label: 'ликвидаторы',
          faction: Faction.LIQUIDATOR,
          occupation: Occupation.HUNTER,
          minGroup: 2,
          maxGroup: 3,
          weapons: ['makarov', 'shotgun', 'entrenching_spade'],
          npcInventory: [{ defId: 'ammo_9mm', count: 10 }, { defId: 'bandage', count: 1 }],
        },
        {
          label: 'чернобожники',
          faction: Faction.CULTIST,
          occupation: Occupation.PILGRIM,
          minGroup: 2,
          maxGroup: 3,
          weapons: ['knife', 'psi_strike', 'psi_madness'],
          npcInventory: [{ defId: 'meat_rune', count: 1 }],
        },
      ],
      outcomes: [
        {
          outcome: 'liquidators_win',
          winnerFaction: Faction.LIQUIDATOR,
          text: 'Ликвидаторы добили ячейку, но один след ушел к дверям; можно забрать гильзы и знак, пока патруль не оформил место.',
          items: [
            { defId: 'note', count: 1, data: 'Свидетельство схватки: ликвидаторы зачистили культовую ячейку, один знак пропал вместе с беглецом.' },
            { defId: 'ammo_9mm', count: 7 },
            { defId: 'meat_rune', count: 1 },
          ],
          rumorIds: ['faction_liquidator_ammo'],
        },
        {
          outcome: 'cultists_win',
          winnerFaction: Faction.CULTIST,
          text: 'Чернобожники утащили тела, оставив жетон в крови; жетон можно сдать посту или продать тем, кто собирает чужие имена.',
          items: [
            { defId: 'note', count: 1, data: 'Свидетельство схватки: культовая ячейка пережила зачистку, жетон найден в крови у коридорной стены.' },
            { defId: 'liquidator_token', count: 1 },
            { defId: 'meat_rune', count: 1 },
          ],
          rumorIds: ['faction_zone_border'],
        },
        {
          outcome: 'mutual_ruin',
          text: 'Обе стороны легли рядом; доказательства можно забрать, но следующий патруль закроет проход и спросит, кто трогал тела.',
          items: [
            { defId: 'note', count: 1, data: 'Свидетельство схватки: обе стороны погибли, знаки Чернобога и гильзы остались рядом до обхода.' },
            { defId: 'ammo_9mm', count: 5 },
            { defId: 'meat_rune', count: 1 },
          ],
          rumorIds: ['faction_zone_border'],
        },
        {
          outcome: 'unresolved',
          text: 'Схватка распалась на отдельные выстрелы; победителя нет, зато следы ведут к двум постам и оба будут искать свидетеля.',
          items: [
            { defId: 'note', count: 1, data: 'Свидетельство схватки: стороны разошлись, но на полу остались гильзы, кровь и культовый знак.' },
            { defId: 'ammo_9mm', count: 4 },
          ],
          rumorIds: ['faction_zone_border'],
        },
      ],
    },
    residueText: 'пули, кровь, сажа от ладоней, мясная руна, сорванный жетон и протокол без фамилий',
    residueChoices: CLASH_RESIDUE_CHOICES,
    message: 'Ликвидаторы и чернобожники сцепились в коридоре: кто донесет свидетельство первым, получит деньги и чужую злость.',
    itemId: 'meat_rune',
    severity: 5,
    privacy: 'local',
    tags: ['faction', 'cult', 'chernobog', 'liquidator', 'witness'],
  },
  {
    id: 'chernobog_archive_evidence',
    name: 'Архивное свидетельство Чернобога',
    zoneFactions: [ZoneFaction.CITIZEN, ZoneFaction.LIQUIDATOR],
    actorFaction: Faction.LIQUIDATOR,
    occupation: Occupation.SECRETARY,
    weight: 5,
    cooldownSec: 520,
    minGroup: 0,
    maxGroup: 1,
    weapons: ['makarov'],
    drops: [{ defId: 'note', count: 1, data: 'Архивная выписка: внешние ячейки Чернобога активны, черные ладони совпали, свидетели в деле расходятся.' }],
    containerDrops: [{ defId: 'note', count: 1, data: 'Копия дела Чернобога: центральная ячейка не подтверждена, внешние ячейки кормят курьеров и должников.' }],
    economyDeltas: [{ resourceId: 'documents', count: 2 }, { resourceId: 'paper', count: -1 }],
    marks: [{ kind: 'chalk', count: 2, radius: 0.2, intensity: 115 }, { kind: 'scuff', count: 2, radius: 0.18, intensity: 95 }],
    pressure: { radius: 4, strength: 0.28, text: 'Архивная копия превращает кухонный слух в улику: ее можно сдать посту, продать культу или спрятать от соседей.' },
    residueText: 'архивная выписка, стертая подпись, меловая ладонь, следы поспешной описи и пустой конверт',
    residueChoices: EVIDENCE_RESIDUE_CHOICES,
    message: 'В секции нашли выписку по ячейкам Чернобога: теперь спор идет не о слухе, а о том, кому отдать бумагу.',
    itemId: 'note',
    severity: 4,
    privacy: 'witnessed',
    tags: ['faction', 'cult', 'chernobog', 'external_cell', 'witness'],
  },
  {
    id: 'wild_looters',
    name: 'Налет диких',
    zoneFactions: WILD_ZONES,
    actorFaction: Faction.WILD,
    occupation: Occupation.TRAVELER,
    weight: 16,
    cooldownSec: 240,
    minGroup: 3,
    maxGroup: 6,
    weapons: ['pipe', 'knife', 'crowbar'],
    npcInventory: [{ defId: 'cigs', count: 2 }, { defId: 'bread', count: 1 }],
    drops: [{ defId: 'cigs', count: 2 }],
    containerDrops: [{ defId: 'note', count: 1, data: 'Кривая метка: здесь уже вскрывали чужой запас, вторую попытку встречают ножом или пустым ящиком.' }],
    economyDeltas: [{ resourceId: 'food', count: -4 }, { resourceId: 'tools', count: -2 }],
    marks: [{ kind: 'blood', count: 2, radius: 0.18, intensity: 145 }, { kind: 'scuff', count: 3, radius: 0.2, intensity: 100 }],
    pressure: { radius: 5, strength: 0.55, text: 'После налета люди обходят шкафы стороной: вскрытый ящик привлекает хозяина, мародеров и тех, кто слышал шум.' },
    residueText: 'окурки, кровь, следы вскрытия, кривая метка, пустое место под хлебом и скол от ножа',
    residueChoices: THEFT_RESIDUE_CHOICES,
    message: 'Дикие вскрыли нычки и унесли хлеб с инструментами; хозяева идут проверять шкафы, а мародеры ждут вторую драку.',
    itemId: 'cigs',
    severity: 4,
    privacy: 'local',
    tags: ['faction', 'looters', 'theft'],
  },
  {
    id: 'liquidator_sweep',
    name: 'Зачистка ликвидаторов',
    zoneFactions: LIQUIDATOR_ZONES,
    actorFaction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    weight: 10,
    cooldownSec: 420,
    minGroup: 3,
    maxGroup: 5,
    weapons: ['makarov', 'shotgun', 'ppsh'],
    npcInventory: [{ defId: 'ammo_9mm', count: 12 }, { defId: 'bandage', count: 1 }],
    drops: [{ defId: 'ammo_9mm', count: 8 }],
    economyDeltas: [{ resourceId: 'ammo', count: -3 }],
    marks: [{ kind: 'bullet', count: 3, radius: 0.17, intensity: 210 }, { kind: 'scorch', count: 1, radius: 0.3, intensity: 170 }, { kind: 'blood', count: 2, radius: 0.22, intensity: 170 }],
    pressure: {
      radius: 7,
      strength: 0.66,
      shape: 'route',
      maxCells: 54,
      routeRadius: 1,
      targetRoomTypes: [RoomType.HQ, RoomType.CORRIDOR, RoomType.COMMON],
      text: 'Зачистка оставила маршрут ликвидаторов: шуметь на нем опасно, зато за патрулем можно пройти под прикрытием до следующего поста.',
    },
    residueText: 'рассыпанные патроны, пулевые отметины, копоть, кровь у коридора и бинт с номером смены',
    residueChoices: ENFORCEMENT_RESIDUE_CHOICES,
    message: 'Ликвидаторы прошли зачисткой по коридорам: пуль и копоти стало больше, патронов меньше, а шум теперь слышат быстрее.',
    itemId: 'ammo_9mm',
    severity: 4,
    privacy: 'local',
    tags: ['faction', 'sweep', 'liquidator'],
  },
  {
    id: 'nii_sample_audit',
    name: 'Изъятие проб НИИ',
    zoneFactions: [ZoneFaction.CITIZEN, ZoneFaction.LIQUIDATOR],
    actorFaction: Faction.SCIENTIST,
    occupation: Occupation.SCIENTIST,
    weight: 6,
    cooldownSec: 520,
    minGroup: 1,
    maxGroup: 2,
    npcInventory: [{ defId: 'nii_sample_container', count: 1 }, { defId: 'nii_market_receipt', count: 1 }],
    drops: [{ defId: 'nii_market_receipt', count: 1 }, { defId: 'slime_sample_contaminated', count: 1 }],
    containerDrops: [{ defId: 'nii_contraband_manifest', count: 1 }, { defId: 'nii_sample_container', count: 1 }],
    economyDeltas: [{ resourceId: 'documents', count: -2 }, { resourceId: 'slime_samples', count: -1 }],
    marks: [{ kind: 'chalk', count: 2, radius: 0.24, intensity: 105 }, { kind: 'scuff', count: 2, radius: 0.18, intensity: 110 }],
    pressure: {
      radius: 7,
      strength: 0.5,
      shape: 'route',
      maxCells: 48,
      routeRadius: 1,
      targetRoomTypes: [RoomType.MEDICAL, RoomType.OFFICE, RoomType.STORAGE],
      text: 'Маршрут изъятия НИИ идет через медшкафы и архив: образцы дорожают до первого свидетеля, потом становятся уликой.',
    },
    residueText: 'меловые номера проб, рыночная расписка, загрязненная проба, пустая тара и пропавшая строка в ведомости',
    residueChoices: EVIDENCE_RESIDUE_CHOICES,
    message: 'Учёные НИИ выводят пробы через чужие шкафы: можно сдать накладную, продать расписку или оставить утечку висеть на секции.',
    itemId: 'nii_market_receipt',
    severity: 4,
    privacy: 'local',
    tags: ['faction', 'nii', 'sample', 'contraband', 'ministry', 'audit', 'science_extraction'],
  },
  {
    id: 'ministerial_recount',
    name: 'Гражданский пересчёт',
    zoneFactions: [ZoneFaction.CITIZEN, ZoneFaction.LIQUIDATOR],
    actorFaction: Faction.CITIZEN,
    occupation: Occupation.DIRECTOR,
    weight: 5,
    cooldownSec: 540,
    minGroup: 1,
    maxGroup: 2,
    npcInventory: [{ defId: 'blank_form', count: 1 }, { defId: 'water_coupon', count: 1 }],
    drops: [{ defId: 'note', count: 1, data: 'Выписка комиссии: норматив снабжения стабилен после исключения закрытых секций из расчета; воду выдать по новой строке.' }],
    containerDrops: [
      { defId: 'note', count: 1, data: 'Распоряжение: список укрытых изъять до публичного чтения, пустые строки родственникам не показывать.' },
      { defId: 'water_coupon', count: 1 },
    ],
    economyDeltas: [{ resourceId: 'documents', count: 3 }, { resourceId: 'drink_water', count: -3 }, { resourceId: 'food', count: -1 }],
    marks: [{ kind: 'chalk', count: 2, radius: 0.22, intensity: 115 }, { kind: 'water', count: 1, radius: 0.24, intensity: 70 }, { kind: 'scuff', count: 2, radius: 0.18, intensity: 95 }],
    pressure: {
      radius: 6,
      strength: 0.44,
      shape: 'route',
      maxCells: 40,
      routeRadius: 1,
      targetRoomTypes: [RoomType.OFFICE, RoomType.COMMON, RoomType.STORAGE],
      text: 'Комиссия прошла по ведомостям: бумага стала толще, вода и пайки ушли в меньшую строку, очередь получила новый повод злиться.',
    },
    residueText: 'меловые номера секций, мокрая печать, выписка комиссии, исчезнувший талон и зачеркнутая фамилия',
    residueChoices: SHORTAGE_RESIDUE_CHOICES,
    message: 'Гражданская комиссия пересчитывает укрытых и воду: документы растут, пайки режут, закрытые секции снова не попали в число.',
    itemId: 'water_coupon',
    severity: 4,
    privacy: 'witnessed',
    tags: ['faction', 'ministry', 'civil_minister', 'commission', 'recount', 'water', 'shelter_tally', 'authority'],
  },
];
