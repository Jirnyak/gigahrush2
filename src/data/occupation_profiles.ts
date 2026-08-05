import { Occupation, RoomType, Faction, type Entity } from '../core/types';

export interface OccupationProfile {
  id: string;
  occupation: Occupation;
  label: string;
  demosLabel: string;
  workLabel: string;
  workRoomTypes: readonly RoomType[];
  workRoomWeights: Readonly<Partial<Record<RoomType, number>>>;
  defaultGenerationWeight: number;
  workDrive: number;
  duty?: number;
  sociability?: number;
  riskTolerance?: number;
  patrolDrive?: number;
  karmaOffset: number;
  kitchenFoodRestore: number;
  medicalRecoveryMultiplier: number;
  sleepScoreBonus: number;
  healIdleScoreBonus: number;
  interests: readonly string[];
  tradeItems: readonly string[];
  tradeTags: readonly string[];
  craftTags: readonly string[];
  routineTags?: readonly string[];
  questFetchItems?: readonly string[];
  questRewardItems?: readonly string[];
  preferredVisitRooms?: readonly RoomType[];
  demosTraits: {
    work: string;
    taste: string;
    quest: string;
  };
}

const DEFAULT_WORK_ROOM_TYPES = [RoomType.PRODUCTION, RoomType.OFFICE] as const;
const DEFAULT_WORK_ROOM_WEIGHTS: Readonly<Partial<Record<RoomType, number>>> = {
  [RoomType.PRODUCTION]: 16,
  [RoomType.OFFICE]: 14,
};
const DEFAULT_TRADE_ITEMS = ['bread', 'water'] as const;
const OCCUPATION_TAG_ALIASES: Readonly<Record<string, readonly string[]>> = {
  admin: ['paperwork', 'authority'],
  market: ['store', 'trader', 'black_market'],
  medicine: ['medical'],
  monster: ['combat', 'patrol'],
  paper: ['documents', 'paperwork'],
  repair: ['maintenance', 'technical'],
  route: ['traveler'],
  cleanup: ['cleaning', 'maintenance'],
};

function p(profile: OccupationProfile): OccupationProfile {
  return profile;
}

export const OCCUPATION_PROFILES: Readonly<Record<Occupation, OccupationProfile>> = {
  [Occupation.HOUSEWIFE]: p({
    id: 'housewife',
    occupation: Occupation.HOUSEWIFE,
    label: 'Домохозяйка',
    demosLabel: 'домохозяйка',
    workLabel: 'держит быт',
    workRoomTypes: [RoomType.LIVING, RoomType.KITCHEN],
    workRoomWeights: { [RoomType.LIVING]: 23, [RoomType.KITCHEN]: 20 },
    defaultGenerationWeight: 10,
    workDrive: 0.55,
    sociability: 0.62,
    karmaOffset: 0,
    kitchenFoodRestore: 3.5,
    medicalRecoveryMultiplier: 1,
    sleepScoreBonus: 0,
    healIdleScoreBonus: 0,
    interests: ['чайник', 'прачечная', 'соседи'],
    tradeItems: ['bread', 'water', 'cigs'],
    tradeTags: ['domestic'],
    craftTags: [],
    routineTags: ['domestic', 'social'],
    demosTraits: { work: 'work_pride', taste: 'taste_food', quest: 'quest_fetch' },
  }),
  [Occupation.CIVIL_DEFENSE]: p({
    id: 'civil_defense',
    occupation: Occupation.CIVIL_DEFENSE,
    label: 'Гражданская оборона',
    demosLabel: 'ГО',
    workLabel: 'охраняет периметр',
    workRoomTypes: [RoomType.CORRIDOR, RoomType.COMMON, RoomType.HQ],
    workRoomWeights: { [RoomType.CORRIDOR]: 35, [RoomType.COMMON]: 20, [RoomType.HQ]: 15 },
    defaultGenerationWeight: 2,
    workDrive: 0.9,
    duty: 0.9,
    sociability: 0.3,
    riskTolerance: 0.85,
    patrolDrive: 0.95,
    karmaOffset: -1,
    kitchenFoodRestore: 2.5,
    medicalRecoveryMultiplier: 1,
    sleepScoreBonus: 0,
    healIdleScoreBonus: 0,
    interests: ['патруль', 'безопасность', 'периметр'],
    tradeItems: ['cigs', 'medkit', 'bandage'],
    tradeTags: ['combat', 'security'],
    craftTags: [],
    routineTags: ['patrol', 'combat', 'guard'],
    demosTraits: { work: 'duty_bound', taste: 'taste_blood', quest: 'quest_kill' },
  }),
  [Occupation.LOCKSMITH]: p({
    id: 'locksmith',
    occupation: Occupation.LOCKSMITH,
    label: 'Слесарь',
    demosLabel: 'слесарь',
    workLabel: 'чинит замки и трубы',
    workRoomTypes: [RoomType.PRODUCTION],
    workRoomWeights: { [RoomType.PRODUCTION]: 35, [RoomType.STORAGE]: 12 },
    defaultGenerationWeight: 10,
    workDrive: 0.72,
    karmaOffset: 0,
    kitchenFoodRestore: 3.5,
    medicalRecoveryMultiplier: 1,
    sleepScoreBonus: 0,
    healIdleScoreBonus: 0,
    interests: ['ключи', 'гермы', 'инструмент'],
    tradeItems: ['wrench', 'pipe', 'flashlight', 'door_kit', 'block_kit', 'electrode_pack', 'water_filter_regulator'],
    tradeTags: ['tools', 'repair'],
    craftTags: ['mechanic_lesson'],
    routineTags: ['technical', 'maintenance', 'repair'],
    questFetchItems: ['wrench', 'flashlight'],
    questRewardItems: ['flashlight', 'wrench'],
    preferredVisitRooms: [RoomType.PRODUCTION, RoomType.STORAGE],
    demosTraits: { work: 'tool_hands', taste: 'taste_tools', quest: 'quest_repair' },
  }),
  [Occupation.SECRETARY]: p({
    id: 'secretary',
    occupation: Occupation.SECRETARY,
    label: 'Секретарь',
    demosLabel: 'секретарь',
    workLabel: 'ведёт журнал',
    workRoomTypes: [RoomType.OFFICE],
    workRoomWeights: { [RoomType.OFFICE]: 34, [RoomType.COMMON]: 8 },
    defaultGenerationWeight: 10,
    workDrive: 0.72,
    sociability: 0.62,
    karmaOffset: 0,
    kitchenFoodRestore: 3.5,
    medicalRecoveryMultiplier: 1,
    sleepScoreBonus: 0,
    healIdleScoreBonus: 0,
    interests: ['журнал', 'печати', 'очередь'],
    tradeItems: ['book', 'tea', 'cigs'],
    tradeTags: ['documents'],
    craftTags: [],
    routineTags: ['paperwork', 'admin', 'social'],
    questFetchItems: ['book', 'cigs', 'note'],
    questRewardItems: ['tea', 'book'],
    preferredVisitRooms: [RoomType.OFFICE, RoomType.HQ],
    demosTraits: { work: 'paper_soul', taste: 'taste_documents', quest: 'quest_fetch' },
  }),
  [Occupation.ELECTRICIAN]: p({
    id: 'electrician',
    occupation: Occupation.ELECTRICIAN,
    label: 'Электрик',
    demosLabel: 'электрик',
    workLabel: 'смотрит щитки',
    workRoomTypes: [RoomType.PRODUCTION],
    workRoomWeights: { [RoomType.PRODUCTION]: 35, [RoomType.STORAGE]: 12 },
    defaultGenerationWeight: 10,
    workDrive: 0.72,
    karmaOffset: 0,
    kitchenFoodRestore: 3.5,
    medicalRecoveryMultiplier: 1,
    sleepScoreBonus: 0,
    healIdleScoreBonus: 0,
    interests: ['щиток', 'кабель', 'сухие перчатки'],
    tradeItems: ['wrench', 'flashlight', 'ammo_nails', 'keyboard_unit', 'screen_unit', 'krona_battery', 'rail_signal_lamp'],
    tradeTags: ['tools', 'electronics', 'repair'],
    craftTags: ['mechanic_lesson'],
    routineTags: ['technical', 'maintenance', 'repair'],
    preferredVisitRooms: [RoomType.PRODUCTION, RoomType.STORAGE],
    demosTraits: { work: 'tool_hands', taste: 'taste_tools', quest: 'quest_repair' },
  }),
  [Occupation.COOK]: p({
    id: 'cook',
    occupation: Occupation.COOK,
    label: 'Повар',
    demosLabel: 'повар',
    workLabel: 'держит кухню',
    workRoomTypes: [RoomType.KITCHEN],
    workRoomWeights: { [RoomType.KITCHEN]: 34, [RoomType.STORAGE]: 10 },
    defaultGenerationWeight: 5,
    workDrive: 0.72,
    sociability: 0.62,
    karmaOffset: 0,
    kitchenFoodRestore: 5,
    medicalRecoveryMultiplier: 1,
    sleepScoreBonus: 0,
    healIdleScoreBonus: 0,
    interests: ['пайка', 'вода', 'общая кухня'],
    tradeItems: ['bread', 'kasha', 'kompot', 'canned', 'zhelemish_dried', 'grey_briquette', 'green_briquette', 'red_concentrate', 'protein_mold_cake', 'concentrate_coupon', 'sugar_pack', 'bottle_empty'],
    tradeTags: ['food'],
    craftTags: [],
    routineTags: ['food', 'kitchen'],
    questFetchItems: ['bread', 'canned', 'kasha', 'rawmeat', 'water'],
    questRewardItems: ['bread', 'kasha', 'kompot'],
    preferredVisitRooms: [RoomType.KITCHEN, RoomType.STORAGE],
    demosTraits: { work: 'kitchen_shift', taste: 'taste_food', quest: 'quest_trade' },
  }),
  [Occupation.DOCTOR]: p({
    id: 'doctor',
    occupation: Occupation.DOCTOR,
    label: 'Врач',
    demosLabel: 'врач',
    workLabel: 'дежурит в медпункте',
    workRoomTypes: [RoomType.MEDICAL],
    workRoomWeights: { [RoomType.MEDICAL]: 36, [RoomType.OFFICE]: 8 },
    defaultGenerationWeight: 5,
    workDrive: 0.8,
    duty: 0.74,
    riskTolerance: 0.38,
    karmaOffset: 10,
    kitchenFoodRestore: 3.5,
    medicalRecoveryMultiplier: 2,
    sleepScoreBonus: 0,
    healIdleScoreBonus: 6,
    interests: ['бинты', 'йод', 'медкарта'],
    tradeItems: ['bandage', 'sterile_bandage', 'pills', 'antidep', 'anti_spore_inhaler', 'burn_gel', 'sleeping_pills', 'permanganate_vial', 'lice_shampoo', 'zhelemish_boiled'],
    tradeTags: ['medicine', 'medical'],
    craftTags: ['lab_lesson'],
    routineTags: ['medical', 'science'],
    questFetchItems: ['bandage', 'pills', 'antidep', 'water'],
    questRewardItems: ['bandage', 'pills', 'antidep'],
    preferredVisitRooms: [RoomType.MEDICAL, RoomType.STORAGE],
    demosTraits: { work: 'paper_soul', taste: 'taste_medicine', quest: 'quest_fetch' },
  }),
  [Occupation.TURNER]: p({
    id: 'turner',
    occupation: Occupation.TURNER,
    label: 'Токарь',
    demosLabel: 'токарь',
    workLabel: 'стоит у станка',
    workRoomTypes: [RoomType.PRODUCTION],
    workRoomWeights: { [RoomType.PRODUCTION]: 35, [RoomType.STORAGE]: 12 },
    defaultGenerationWeight: 10,
    workDrive: 0.72,
    karmaOffset: 0,
    kitchenFoodRestore: 3.5,
    medicalRecoveryMultiplier: 1,
    sleepScoreBonus: 0,
    healIdleScoreBonus: 0,
    interests: ['станок', 'резьба', 'масло'],
    tradeItems: ['wrench', 'pipe', 'rebar'],
    tradeTags: ['tools', 'metal', 'repair'],
    craftTags: ['mechanic_lesson'],
    routineTags: ['technical', 'maintenance', 'repair'],
    preferredVisitRooms: [RoomType.PRODUCTION, RoomType.STORAGE],
    demosTraits: { work: 'tool_hands', taste: 'taste_tools', quest: 'quest_repair' },
  }),
  [Occupation.MECHANIC]: p({
    id: 'mechanic',
    occupation: Occupation.MECHANIC,
    label: 'Механик',
    demosLabel: 'механик',
    workLabel: 'чинит механизмы',
    workRoomTypes: [RoomType.PRODUCTION],
    workRoomWeights: { [RoomType.PRODUCTION]: 35, [RoomType.STORAGE]: 12 },
    defaultGenerationWeight: 10,
    workDrive: 0.72,
    karmaOffset: 0,
    kitchenFoodRestore: 3.5,
    medicalRecoveryMultiplier: 1,
    sleepScoreBonus: 0,
    healIdleScoreBonus: 0,
    interests: ['насос', 'болты', 'привод'],
    tradeItems: ['wrench', 'pipe', 'flashlight', 'jackhammer', 'ammo_nails', 'pump_impeller', 'vent_damper_plate', 'heating_element'],
    tradeTags: ['tools', 'repair'],
    craftTags: ['mechanic_lesson'],
    routineTags: ['technical', 'maintenance', 'repair'],
    preferredVisitRooms: [RoomType.PRODUCTION, RoomType.STORAGE],
    demosTraits: { work: 'tool_hands', taste: 'taste_tools', quest: 'quest_repair' },
  }),
  [Occupation.STOREKEEPER]: p({
    id: 'storekeeper',
    occupation: Occupation.STOREKEEPER,
    label: 'Кладовщик',
    demosLabel: 'кладовщик',
    workLabel: 'считает склад',
    workRoomTypes: [RoomType.STORAGE],
    workRoomWeights: { [RoomType.STORAGE]: 34, [RoomType.PRODUCTION]: 8 },
    defaultGenerationWeight: 10,
    workDrive: 0.72,
    karmaOffset: 0,
    kitchenFoodRestore: 3.5,
    medicalRecoveryMultiplier: 1,
    sleepScoreBonus: 0,
    healIdleScoreBonus: 0,
    interests: ['кладовая', 'накладная', 'остатки'],
    tradeItems: ['bread', 'water', 'cigs', 'toiletpaper', 'import_toiletpaper', 'bandage', 'sleeping_pills', 'ammo_shells', 'cleaning_kit', 'chalk', 'soap_72', 'lice_shampoo', 'krona_battery', 'zhelemish_raw', 'govnyak_roll', 'govnyak_brick', 'grey_briquette', 'green_briquette', 'red_concentrate', 'liquidator_ration', 'concentrate_coupon', 'dice_bone', 'domino_box', 'checkers_board', 'cardboard_stack', 'roller_brush', 'plastic_sheet', 'ceramic_shards_pack'],
    tradeTags: ['store', 'black_market'],
    craftTags: ['market_lesson'],
    routineTags: ['trader', 'black_market', 'supply'],
    questFetchItems: ['cigs', 'toiletpaper', 'canned', 'water', 'govnyak_roll', 'govnyak_brick'],
    questRewardItems: ['cigs', 'water', 'bread'],
    demosTraits: { work: 'paper_soul', taste: 'taste_tools', quest: 'quest_trade' },
  }),
  [Occupation.ALCOHOLIC]: p({
    id: 'alcoholic',
    occupation: Occupation.ALCOHOLIC,
    label: 'Алкоголик',
    demosLabel: 'алкоголик',
    workLabel: 'знает курилку',
    workRoomTypes: [RoomType.SMOKING, RoomType.COMMON, RoomType.KITCHEN],
    workRoomWeights: { [RoomType.SMOKING]: 24, [RoomType.COMMON]: 15, [RoomType.KITCHEN]: 15 },
    defaultGenerationWeight: 5,
    workDrive: 0.35,
    duty: 0.22,
    sociability: 0.72,
    karmaOffset: -6,
    kitchenFoodRestore: 3.5,
    medicalRecoveryMultiplier: 1,
    sleepScoreBonus: 0,
    healIdleScoreBonus: 0,
    interests: ['курилка', 'бутылка', 'занять рубль'],
    tradeItems: ['bread', 'cigs', 'water', 'govnyak_roll'],
    tradeTags: ['contraband', 'rumor'],
    craftTags: [],
    routineTags: ['social', 'rumor'],
    demosTraits: { work: 'work_pride', taste: 'taste_food', quest: 'quest_fetch' },
  }),
  [Occupation.SCIENTIST]: p({
    id: 'scientist',
    occupation: Occupation.SCIENTIST,
    label: 'Учёный',
    demosLabel: 'учёный',
    workLabel: 'пишет протокол',
    workRoomTypes: [RoomType.OFFICE, RoomType.MEDICAL],
    workRoomWeights: { [RoomType.OFFICE]: 26, [RoomType.MEDICAL]: 26, [RoomType.PRODUCTION]: 10 },
    defaultGenerationWeight: 5,
    workDrive: 0.8,
    duty: 0.74,
    riskTolerance: 0.38,
    karmaOffset: 0,
    kitchenFoodRestore: 3.5,
    medicalRecoveryMultiplier: 1,
    sleepScoreBonus: 0,
    healIdleScoreBonus: 0,
    interests: ['образец', 'колба', 'протокол'],
    tradeItems: ['flashlight', 'book', 'note', 'ammo_9mm', 'zhelemish_raw', 'govnyak_sample', 'empty_sample_jar', 'sterile_swab', 'sample_chain_form', 'nii_sample_label', 'glass_ampoule_empty', 'blueprint_t2_folder', 'sound_emitter', 'syringe_empty'],
    tradeTags: ['science', 'sample', 'documents'],
    craftTags: ['lab_lesson'],
    routineTags: ['science', 'paperwork'],
    questFetchItems: ['note', 'book', 'flashlight', 'govnyak_sample'],
    questRewardItems: ['note', 'pills'],
    preferredVisitRooms: [RoomType.MEDICAL, RoomType.OFFICE],
    demosTraits: { work: 'paper_soul', taste: 'taste_documents', quest: 'quest_fetch' },
  }),
  [Occupation.CHILD]: p({
    id: 'child',
    occupation: Occupation.CHILD,
    label: 'Ребёнок',
    demosLabel: 'ребёнок',
    workLabel: 'ходит в школу и по поручениям',
    workRoomTypes: [RoomType.CLASSROOM, RoomType.LIVING, RoomType.COMMON],
    workRoomWeights: { [RoomType.CLASSROOM]: 25, [RoomType.LIVING]: 17, [RoomType.COMMON]: 15 },
    defaultGenerationWeight: 10,
    workDrive: 0.25,
    duty: 0.15,
    sociability: 0.72,
    riskTolerance: 0.15,
    karmaOffset: 6,
    kitchenFoodRestore: 3.5,
    medicalRecoveryMultiplier: 1,
    sleepScoreBonus: 7,
    healIdleScoreBonus: 0,
    interests: ['мел', 'домино', 'сладкий чай'],
    tradeItems: ['bread', 'water', 'chalk'],
    tradeTags: ['child'],
    craftTags: [],
    routineTags: ['child'],
    demosTraits: { work: 'work_pride', taste: 'taste_food', quest: 'quest_fetch' },
  }),
  [Occupation.TEACHER]: p({
    id: 'teacher',
    occupation: Occupation.TEACHER,
    label: 'Учитель',
    demosLabel: 'учитель',
    workLabel: 'учит детей',
    workRoomTypes: [RoomType.CLASSROOM, RoomType.COMMON, RoomType.OFFICE],
    workRoomWeights: { [RoomType.CLASSROOM]: 30, [RoomType.COMMON]: 10, [RoomType.OFFICE]: 5 },
    defaultGenerationWeight: 2,
    workDrive: 0.8,
    duty: 0.7,
    sociability: 0.7,
    riskTolerance: 0.2,
    karmaOffset: 3,
    kitchenFoodRestore: 3,
    medicalRecoveryMultiplier: 1,
    sleepScoreBonus: 0,
    healIdleScoreBonus: 0,
    interests: ['мел', 'указка', 'книга', 'план'],
    tradeItems: ['chalk', 'book', 'note', 'pencil'],
    tradeTags: ['teacher', 'documents'],
    craftTags: ['lesson'],
    routineTags: ['teacher'],
    demosTraits: { work: 'work_pride', taste: 'taste_documents', quest: 'quest_fetch' },
  }),
  [Occupation.DIRECTOR]: p({
    id: 'director',
    occupation: Occupation.DIRECTOR,
    label: 'Директор',
    demosLabel: 'директор',
    workLabel: 'гоняет смены',
    workRoomTypes: [RoomType.OFFICE, RoomType.COMMON],
    workRoomWeights: { [RoomType.OFFICE]: 28, [RoomType.COMMON]: 18 },
    defaultGenerationWeight: 1,
    workDrive: 0.8,
    duty: 0.74,
    karmaOffset: -4,
    kitchenFoodRestore: 3.5,
    medicalRecoveryMultiplier: 1,
    sleepScoreBonus: 0,
    healIdleScoreBonus: 0,
    interests: ['план', 'норма', 'доска заявок'],
    tradeItems: ['book', 'tea', 'cigs', 'ammo_9mm', 'blueprint_t1_folder', 'market_weight_scale'],
    tradeTags: ['documents', 'authority'],
    craftTags: [],
    routineTags: ['paperwork', 'admin', 'authority'],
    preferredVisitRooms: [RoomType.OFFICE, RoomType.HQ],
    demosTraits: { work: 'paper_soul', taste: 'taste_documents', quest: 'quest_fetch' },
  }),
  [Occupation.TRAVELER]: p({
    id: 'traveler',
    occupation: Occupation.TRAVELER,
    label: 'Путник',
    demosLabel: 'путник',
    workLabel: 'ходит маршрутами',
    workRoomTypes: [RoomType.CORRIDOR, RoomType.COMMON],
    workRoomWeights: { [RoomType.CORRIDOR]: 24, [RoomType.COMMON]: 15 },
    defaultGenerationWeight: 0,
    workDrive: 0.25,
    duty: 0.3,
    karmaOffset: 0,
    kitchenFoodRestore: 3.5,
    medicalRecoveryMultiplier: 1,
    sleepScoreBonus: 0,
    healIdleScoreBonus: 0,
    interests: ['лифт', 'карта', 'сухарь'],
    tradeItems: ['bread', 'water', 'filtered_water', 'canned', 'cigs', 'chalk', 'govnyak_roll', 'gasmask_filter', 'caravan_route', 'lift_scheme', 'track_diagram_scrap'],
    tradeTags: ['route', 'travel'],
    craftTags: [],
    routineTags: ['traveler', 'route'],
    demosTraits: { work: 'work_pride', taste: 'taste_tools', quest: 'quest_fetch' },
  }),
  [Occupation.PILGRIM]: p({
    id: 'pilgrim',
    occupation: Occupation.PILGRIM,
    label: 'Паломник',
    demosLabel: 'паломник',
    workLabel: 'держит обет',
    workRoomTypes: [RoomType.CORRIDOR, RoomType.COMMON],
    workRoomWeights: { [RoomType.CORRIDOR]: 24, [RoomType.COMMON]: 15 },
    defaultGenerationWeight: 0,
    workDrive: 0.25,
    duty: 0.3,
    patrolDrive: 0.55,
    karmaOffset: 0,
    kitchenFoodRestore: 3.5,
    medicalRecoveryMultiplier: 1,
    sleepScoreBonus: 0,
    healIdleScoreBonus: 0,
    interests: ['обет', 'свеча', 'тихий угол'],
    tradeItems: ['bread', 'water', 'knife', 'zhelemish_dried', 'govnyak_bad_batch'],
    tradeTags: ['cult', 'route'],
    craftTags: [],
    routineTags: ['traveler', 'cult'],
    demosTraits: { work: 'work_pride', taste: 'taste_tools', quest: 'quest_fetch' },
  }),
  [Occupation.HUNTER]: p({
    id: 'hunter',
    occupation: Occupation.HUNTER,
    label: 'Охотник',
    demosLabel: 'охотник',
    workLabel: 'берёт зачистки',
    workRoomTypes: [RoomType.CORRIDOR, RoomType.COMMON],
    workRoomWeights: { [RoomType.CORRIDOR]: 24, [RoomType.COMMON]: 15 },
    defaultGenerationWeight: 0,
    workDrive: 0.55,
    riskTolerance: 0.78,
    patrolDrive: 0.9,
    karmaOffset: 0,
    kitchenFoodRestore: 3.5,
    medicalRecoveryMultiplier: 1,
    sleepScoreBonus: 0,
    healIdleScoreBonus: 0,
    interests: ['патроны', 'следы', 'дверной клин'],
    tradeItems: ['knife', 'canned', 'rawmeat', 'ammo_9mm', 'ammo_shells', 'gasmask_filter', 'ip4_gasmask', 'filtered_water', 'radio_headset_liquidator', 'chizh3_shotgun', 'rb91_auto_shotgun', 'makarov'],
    tradeTags: ['weapon', 'patrol'],
    craftTags: [],
    routineTags: ['traveler', 'combat', 'patrol'],
    questFetchItems: ['knife', 'pipe', 'wrench', 'canned'],
    questRewardItems: ['canned', 'rawmeat', 'knife'],
    demosTraits: { work: 'tool_hands', taste: 'taste_tools', quest: 'quest_hunt' },
  }),
  [Occupation.PRIEST]: p({
    id: 'priest',
    occupation: Occupation.PRIEST,
    label: 'Священник',
    demosLabel: 'батюшка',
    workLabel: 'держит храм',
    workRoomTypes: [RoomType.HQ, RoomType.COMMON],
    workRoomWeights: { [RoomType.HQ]: 25, [RoomType.COMMON]: 18 },
    defaultGenerationWeight: 0,
    workDrive: 0.55,
    patrolDrive: 0.55,
    karmaOffset: 8,
    kitchenFoodRestore: 3.5,
    medicalRecoveryMultiplier: 1,
    sleepScoreBonus: 0,
    healIdleScoreBonus: 0,
    interests: ['свечи', 'кружка воды', 'исповедь'],
    tradeItems: [...DEFAULT_TRADE_ITEMS],
    tradeTags: ['cult'],
    craftTags: [],
    routineTags: ['cult'],
    demosTraits: { work: 'work_pride', taste: 'taste_tools', quest: 'quest_fetch' },
  }),
  [Occupation.PERFORMER]: p({
    id: 'performer',
    occupation: Occupation.PERFORMER,
    label: 'Перформер',
    demosLabel: 'перформер',
    workLabel: 'держит сцену',
    workRoomTypes: [RoomType.COMMON, RoomType.SMOKING, RoomType.LIVING],
    workRoomWeights: { [RoomType.COMMON]: 26, [RoomType.SMOKING]: 18, [RoomType.LIVING]: 14, [RoomType.OFFICE]: 6 },
    defaultGenerationWeight: 1,
    workDrive: 0.62,
    duty: 0.42,
    sociability: 0.84,
    riskTolerance: 0.42,
    karmaOffset: 0,
    kitchenFoodRestore: 3.5,
    medicalRecoveryMultiplier: 1,
    sleepScoreBonus: 0,
    healIdleScoreBonus: 0,
    interests: ['сцена', 'гардероб', 'служебная дверь'],
    tradeItems: ['tea', 'cigs', 'water', 'bandage', 'book'],
    tradeTags: ['performance', 'rumor', 'social'],
    craftTags: [],
    routineTags: ['performance', 'social'],
    questFetchItems: ['tea', 'cigs', 'water', 'bandage', 'book'],
    questRewardItems: ['tea', 'cigs', 'water'],
    preferredVisitRooms: [RoomType.COMMON, RoomType.LIVING, RoomType.OFFICE],
    demosTraits: { work: 'work_pride', taste: 'taste_documents', quest: 'quest_fetch' },
  }),
  [Occupation.CLEANER]: p({
    id: 'cleaner',
    occupation: Occupation.CLEANER,
    label: 'Уборщица',
    demosLabel: 'уборщица',
    workLabel: 'моет следы',
    workRoomTypes: [RoomType.CORRIDOR, RoomType.COMMON, RoomType.BATHROOM, RoomType.KITCHEN],
    workRoomWeights: { [RoomType.CORRIDOR]: 26, [RoomType.COMMON]: 22, [RoomType.BATHROOM]: 20, [RoomType.KITCHEN]: 14 },
    defaultGenerationWeight: 6,
    workDrive: 0.78,
    duty: 0.72,
    sociability: 0.42,
    riskTolerance: 0.34,
    karmaOffset: 3,
    kitchenFoodRestore: 3.5,
    medicalRecoveryMultiplier: 1,
    sleepScoreBonus: 0,
    healIdleScoreBonus: 0,
    interests: ['швабра', 'следы', 'санузел'],
    tradeItems: ['cleaning_kit', 'soap_72', 'lice_shampoo', 'toiletpaper', 'water', 'roller_brush'],
    tradeTags: ['domestic', 'cleanup', 'repair'],
    craftTags: [],
    routineTags: ['cleaning', 'domestic', 'maintenance'],
    questFetchItems: ['soap_72', 'water', 'toiletpaper', 'cleaning_kit'],
    questRewardItems: ['soap_72', 'water', 'cleaning_kit'],
    preferredVisitRooms: [RoomType.CORRIDOR, RoomType.COMMON, RoomType.BATHROOM, RoomType.KITCHEN],
    demosTraits: { work: 'tool_hands', taste: 'taste_tools', quest: 'quest_repair' },
  }),
  [Occupation.WORKER69]: p({
    id: 'worker69',
    occupation: Occupation.WORKER69,
    label: 'Работник 69',
    demosLabel: 'работник 69',
    workLabel: 'держит тихую комнату',
    workRoomTypes: [RoomType.COMMON, RoomType.LIVING, RoomType.OFFICE],
    workRoomWeights: { [RoomType.COMMON]: 28, [RoomType.LIVING]: 22, [RoomType.OFFICE]: 12, [RoomType.SMOKING]: 10 },
    defaultGenerationWeight: 0,
    workDrive: 0.68,
    duty: 0.48,
    sociability: 0.86,
    riskTolerance: 0.36,
    karmaOffset: 0,
    kitchenFoodRestore: 3.5,
    medicalRecoveryMultiplier: 1,
    sleepScoreBonus: 0,
    healIdleScoreBonus: 0,
    interests: ['красный коридор', 'расписка', 'служебная дверь'],
    tradeItems: ['tea', 'cigs', 'water', 'bandage', 'voluntary_receipt'],
    tradeTags: ['performance', 'rumor', 'social'],
    craftTags: [],
    routineTags: ['floor_69', 'performance', 'social'],
    questFetchItems: ['tea', 'cigs', 'water', 'bandage', 'book'],
    questRewardItems: ['tea', 'cigs', 'water'],
    preferredVisitRooms: [RoomType.COMMON, RoomType.LIVING, RoomType.OFFICE],
    demosTraits: { work: 'work_pride', taste: 'taste_documents', quest: 'quest_fetch' },
  }),
  [Occupation.ENGINEER]: p({
    id: 'engineer',
    occupation: Occupation.ENGINEER,
    label: 'Инженер',
    demosLabel: 'инженер',
    workLabel: 'работает со снаряжением',
    workRoomTypes: [RoomType.PRODUCTION, RoomType.STORAGE],
    workRoomWeights: { [RoomType.PRODUCTION]: 25, [RoomType.STORAGE]: 25 },
    defaultGenerationWeight: 0,
    workDrive: 0.8,
    duty: 0.8,
    sociability: 0.5,
    riskTolerance: 0.6,
    karmaOffset: 0,
    kitchenFoodRestore: 3.5,
    medicalRecoveryMultiplier: 1,
    sleepScoreBonus: 0,
    healIdleScoreBonus: 0,
    interests: ['схемы', 'фильтры', 'защита'],
    tradeItems: ['ip4_gasmask', 'gasmask_filter', 'armor_liquidator', 'armor_medium', 'fog_detector'],
    tradeTags: ['armor', 'tools', 'repair'],
    craftTags: ['mechanic_lesson'],
    routineTags: ['technical', 'maintenance'],
    questFetchItems: ['metal', 'tools', 'pipe', 'duct_tape'],
    questRewardItems: ['gasmask_filter', 'armor_liquidator'],
    preferredVisitRooms: [RoomType.PRODUCTION, RoomType.STORAGE, RoomType.HQ],
    demosTraits: { work: 'tool_hands', taste: 'taste_tools', quest: 'quest_repair' },
  }),
};

const OCCUPATION_VALUE_SET = new Set<Occupation>(
  Object.keys(OCCUPATION_PROFILES)
    .map(value => Number(value))
    .filter((value): value is Occupation => Number.isInteger(value)),
);

export function allOccupationProfiles(): readonly OccupationProfile[] {
  return Object.values(OCCUPATION_PROFILES);
}

export function occupationProfile(occupation: Occupation | undefined): OccupationProfile | undefined {
  return occupation === undefined ? undefined : OCCUPATION_PROFILES[occupation];
}

export function sanitizeOccupation(value: unknown, fallback = Occupation.HOUSEWIFE): Occupation {
  return typeof value === 'number' && Number.isInteger(value) && OCCUPATION_VALUE_SET.has(value as Occupation)
    ? value as Occupation
    : fallback;
}

export function occupationWorkRoomTypes(occupation: Occupation | undefined): readonly RoomType[] {
  return occupationProfile(occupation)?.workRoomTypes ?? DEFAULT_WORK_ROOM_TYPES;
}

export function occupationWorkRoomTypeWeight(occupation: Occupation | undefined, roomType: RoomType): number {
  const profile = occupationProfile(occupation);
  return profile ? profile.workRoomWeights[roomType] ?? 0 : DEFAULT_WORK_ROOM_WEIGHTS[roomType] ?? 0;
}

export function occupationTradeItems(occupation: Occupation | undefined): readonly string[] {
  return occupationProfile(occupation)?.tradeItems ?? DEFAULT_TRADE_ITEMS;
}

export function occupationHasTradeTag(occupation: Occupation | undefined, tag: string): boolean {
  return occupationProfile(occupation)?.tradeTags.includes(tag) === true;
}

export function occupationHasRoutineTag(occupation: Occupation | undefined, tag: string): boolean {
  return occupationProfile(occupation)?.routineTags?.includes(tag) === true;
}

export function occupationHasAnyRoutineTag(occupation: Occupation | undefined, tags: readonly string[]): boolean {
  const profileTags = occupationProfile(occupation)?.routineTags;
  return profileTags?.some(tag => tags.includes(tag)) === true;
}

function occupationProfileHasLiteralTag(profile: OccupationProfile, tag: string): boolean {
  return profile.id === tag ||
    profile.tradeTags.includes(tag) ||
    profile.craftTags.includes(tag) ||
    profile.routineTags?.includes(tag) === true ||
    profile.demosTraits.work === tag ||
    profile.demosTraits.taste === tag ||
    profile.demosTraits.quest === tag;
}

export function occupationHasProfileTag(occupation: Occupation | undefined, tag: string): boolean {
  const profile = occupationProfile(occupation);
  if (!profile) return false;
  const key = tag.toLowerCase();
  if (occupationProfileHasLiteralTag(profile, key)) return true;
  return OCCUPATION_TAG_ALIASES[key]?.some(alias => occupationProfileHasLiteralTag(profile, alias)) === true;
}

export function occupationHasAnyProfileTag(occupation: Occupation | undefined, tags: readonly string[]): boolean {
  return tags.some(tag => occupationHasProfileTag(occupation, tag));
}

export function occupationQuestFetchItems(occupation: Occupation | undefined): readonly string[] {
  return occupationProfile(occupation)?.questFetchItems ?? [];
}

export function occupationQuestRewardItems(occupation: Occupation | undefined): readonly string[] {
  return occupationProfile(occupation)?.questRewardItems ?? [];
}

export function occupationPreferredVisitRooms(occupation: Occupation | undefined): readonly RoomType[] {
  return occupationProfile(occupation)?.preferredVisitRooms ?? [];
}

export function occupationIdsWithCraftTag(tag: string): Occupation[] {
  return allOccupationProfiles()
    .filter(profile => profile.craftTags.includes(tag))
    .map(profile => profile.occupation);
}

interface FactionTradeOffer {
  faction: Faction;
  minRank: number;
  occupation?: Occupation;
  defId: string;
  count: number;
}

const FACTION_TRADE_OFFERS: readonly FactionTradeOffer[] = [
  // Armorer (HUNTER)
  { faction: Faction.LIQUIDATOR, occupation: Occupation.HUNTER, minRank: 1, defId: 'ammo_9mm', count: 18 },
  { faction: Faction.LIQUIDATOR, occupation: Occupation.HUNTER, minRank: 2, defId: 'ammo_shells', count: 8 },
  { faction: Faction.LIQUIDATOR, occupation: Occupation.HUNTER, minRank: 2, defId: 'makarov', count: 1 },
  { faction: Faction.LIQUIDATOR, occupation: Occupation.HUNTER, minRank: 3, defId: 'chizh3_shotgun', count: 1 },
  { faction: Faction.LIQUIDATOR, occupation: Occupation.HUNTER, minRank: 3, defId: 'moskvin_rifle', count: 1 },
  { faction: Faction.LIQUIDATOR, occupation: Occupation.HUNTER, minRank: 3, defId: 'ammo_762', count: 6 },
  { faction: Faction.LIQUIDATOR, occupation: Occupation.HUNTER, minRank: 4, defId: 'rb91_auto_shotgun', count: 1 },
  { faction: Faction.LIQUIDATOR, occupation: Occupation.HUNTER, minRank: 4, defId: 'pushkin_shotgun', count: 1 },
  // Medic (MEDIC)
  { faction: Faction.LIQUIDATOR, occupation: Occupation.DOCTOR, minRank: 1, defId: 'bandage', count: 4 },
  { faction: Faction.LIQUIDATOR, occupation: Occupation.DOCTOR, minRank: 2, defId: 'antidep', count: 2 },
  { faction: Faction.LIQUIDATOR, occupation: Occupation.DOCTOR, minRank: 2, defId: 'iodine', count: 2 },
  { faction: Faction.LIQUIDATOR, occupation: Occupation.DOCTOR, minRank: 3, defId: 'bandage', count: 5 },
  { faction: Faction.LIQUIDATOR, occupation: Occupation.DOCTOR, minRank: 4, defId: 'pills', count: 2 },
  { faction: Faction.LIQUIDATOR, occupation: Occupation.DOCTOR, minRank: 4, defId: 'post_samosbor_probe_kit', count: 1 },
  // Quartermaster (ENGINEER)
  { faction: Faction.LIQUIDATOR, occupation: Occupation.ENGINEER, minRank: 1, defId: 'gasmask_filter', count: 2 },
  { faction: Faction.LIQUIDATOR, occupation: Occupation.ENGINEER, minRank: 2, defId: 'ip4_gasmask', count: 1 },
  { faction: Faction.LIQUIDATOR, occupation: Occupation.ENGINEER, minRank: 3, defId: 'armor_liquidator', count: 1 },
  { faction: Faction.LIQUIDATOR, occupation: Occupation.ENGINEER, minRank: 3, defId: 'armor_medium', count: 1 },
  { faction: Faction.LIQUIDATOR, occupation: Occupation.ENGINEER, minRank: 4, defId: 'fog_detector', count: 1 },
  { faction: Faction.LIQUIDATOR, occupation: Occupation.ENGINEER, minRank: 4, defId: 'breach_charge', count: 2 },
];

function tradeRankForNpc(npc: Entity): number {
  const level = Math.max(1, Math.floor(npc.rpg?.level ?? 1));
  if (level >= 35) return 4;
  if (level >= 18) return 3;
  if (level >= 8) return 2;
  return 1;
}

function appendFactionTradeOffers(npc: Entity, items: { defId: string; count: number }[]): void {
  const rank = tradeRankForNpc(npc);
  for (const offer of FACTION_TRADE_OFFERS) {
    if (npc.faction !== offer.faction) continue;
    if (offer.occupation !== undefined && npc.occupation !== offer.occupation) continue;
    if (rank < offer.minRank) continue;
    items.push({ defId: offer.defId, count: offer.count });
  }
}

export function generateNpcTradeItems(npc: Entity): { defId: string; count: number }[] {
  const items: { defId: string; count: number }[] = [];
  const pool = occupationTradeItems(npc.occupation);
  const count = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    const defId = pool[Math.floor(Math.random() * pool.length)];
    items.push({ defId, count: 1 + Math.floor(Math.random() * 3) });
  }
  if (npc.occupation === Occupation.STOREKEEPER) {
    items.push({ defId: 'soap_72', count: 1 }, { defId: 'lice_shampoo', count: 1 });
  }
  if (npc.occupation === Occupation.DOCTOR) {
    items.push({ defId: 'lice_shampoo', count: 1 });
  }
  if (npc.occupation === Occupation.HUNTER) {
    items.push({ defId: 'radio_headset_liquidator', count: 1 });
  }
  appendFactionTradeOffers(npc, items);
  return items;
}
