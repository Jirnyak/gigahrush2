import { FloorLevel, MonsterKind } from '../core/types';

export type SamosborVariantId = 'classic' | 'wet' | 'electric' | 'meat' | 'maronary' | 'istotit' | 'veretar';
export type SamosborAudioCueId = 'siren' | 'bell' | 'beep' | 'distant_alarm';
export type SamosborScreenFxId =
  | 'violet_noise'
  | 'wet_noise'
  | 'electric_static'
  | 'meat_pulse'
  | 'green_signal'
  | 'gold_bell'
  | 'white_exposure';

export type SamosborSubsystemId =
  | 'warning'
  | 'audio'
  | 'fog_tint'
  | 'fog_spread'
  | 'seal'
  | 'monster_pressure'
  | 'random_transfer'
  | 'room_sirens'
  | 'local_wave'
  | 'aftermath'
  | 'hell_meat_walls'
  | 'maronary_sources'
  | 'wrong_door'
  | 'source_glow'
  | 'fog_rewrite'
  | 'istotit_shelters'
  | 'bell_compulsion'
  | 'fog_create'
  | 'veretar_area_leak'
  | 'fog_delete'
  | 'wet_spawn_shark';

export type SamosborAftermathEffectId =
  | 'fog_residue'
  | 'door_fault'
  | 'monster_aftershock'
  | 'rumor_seed'
  | 'production_shortage'
  | 'faction_panic'
  | 'container_theft'
  | 'false_all_clear'
  | 'item_residue'
  | 'route_block'
  | 'route_residue';

export type SamosborModifierId =
  | 'early_seal'
  | 'dense_fog'
  | 'sparse_fog'
  | 'extra_eyes'
  | 'door_twitch'
  | 'light_flicker'
  | 'false_safe_zone'
  | 'wet_floor_message'
  | 'meat_walls_hell'
  | 'green_source'
  | 'high_beep'
  | 'wrong_door_hint'
  | 'bell_warning'
  | 'golden_light'
  | 'choir_mask'
  | 'white_area'
  | 'no_sun'
  | 'photo_distortion'
  | 'area_leak';

export interface SamosborVariantDef {
  id: SamosborVariantId;
  displayName: string;
  floors: FloorLevel[];
  weight: number;
  subsystems: readonly SamosborSubsystemId[];
  visual: SamosborVisualProfile;
  fogColor: [number, number, number];
  tint: string;
  durationMult: number;
  spawnMult: number;
  sealTimingDelta: number;
  warningLines: string[];
  modifiers: SamosborModifierId[];
  gameplaySignal: string;
  audioCue?: SamosborAudioCueId;
  startLine?: string;
}

export interface SamosborVisualProfile {
  screenFx: SamosborScreenFxId;
  fogDensityBonus: number;
  glitchIntensity: number;
  postIntensity: number;
}

export interface SamosborModifierDef {
  id: SamosborModifierId;
  warningLine: string;
  spawnMult?: number;
  fogSeedMult?: number;
  fogSpawnIntervalMult?: number;
  sealTimingDelta?: number;
  noSiren?: boolean;
  extraEyes?: number;
  meatWallsOnHell?: boolean;
  shelterRoomCount?: number;
}

export interface ActiveSamosborVariant {
  def: SamosborVariantDef;
  modifiers: SamosborModifierDef[];
  subsystems: readonly SamosborSubsystemId[];
  visual: SamosborVisualProfile;
  durationMult: number;
  spawnMult: number;
  fogSeedMult: number;
  fogSpawnIntervalMult: number;
  sealTimingDelta: number;
  noSiren: boolean;
  extraEyes: number;
  shelterRoomCount: number;
  fogColor: [number, number, number];
}

export interface SamosborAftermathBeatDef {
  id: string;
  title: string;
  variants: readonly SamosborVariantId[];
  floors: readonly FloorLevel[];
  weight: number;
  cooldownSec: number;
  maxRuns: number;
  radius: number;
  severity: 2 | 3 | 4;
  effect: SamosborAftermathEffectId;
  message: string;
  tags: readonly string[];
  monsterKind?: MonsterKind;
  monsterCount?: number;
  minSamosborCount?: number;
  resourceId?: string;
  itemId?: string;
  fogStrength?: number;
}

const ALL_FLOORS = [
  FloorLevel.MINISTRY,
  FloorLevel.KVARTIRY,
  FloorLevel.LIVING,
  FloorLevel.MAINTENANCE,
  FloorLevel.HELL,
  FloorLevel.VOID,
];
const CIVIL_FLOORS = [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING];
const CIVIL_AND_SERVICE_FLOORS = [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE];
const VOID_AND_CIVIL_SERVICE_FLOORS = [
  FloorLevel.MINISTRY,
  FloorLevel.KVARTIRY,
  FloorLevel.LIVING,
  FloorLevel.MAINTENANCE,
  FloorLevel.VOID,
];

export const SAMOSBOR_BASE_SUBSYSTEMS: readonly SamosborSubsystemId[] = [
  'warning',
  'audio',
  'fog_tint',
  'fog_spread',
  'seal',
  'monster_pressure',
  'random_transfer',
  'room_sirens',
  'local_wave',
  'aftermath',
];

export const SAMOSBOR_MODIFIERS: Record<SamosborModifierId, SamosborModifierDef> = {
  early_seal: {
    id: 'early_seal',
    warningLine: 'Гермодвери закрываются раньше регламента. Бросай вещи, закрывайся сейчас.',
    sealTimingDelta: 8,
  },
  dense_fog: {
    id: 'dense_fog',
    warningLine: 'Туман идёт низко и густо. Забей щель тряпкой и не ложись у двери.',
    fogSeedMult: 1.35,
    fogSpawnIntervalMult: 0.85,
  },
  sparse_fog: {
    id: 'sparse_fog',
    warningLine: 'Туман рваный, твари идут по чистым промежуткам. Держи стену и не беги в центр.',
    fogSeedMult: 0.65,
    spawnMult: 1.15,
  },
  extra_eyes: {
    id: 'extra_eyes',
    warningLine: 'В тумане открываются глаза. Гаси лампу, не стой в световом пятне.',
    extraEyes: 2,
  },
  door_twitch: {
    id: 'door_twitch',
    warningLine: 'Двери дёргаются. Не держи ручку голой рукой, подпирай створку изнутри.',
  },
  light_flicker: {
    id: 'light_flicker',
    warningLine: 'Лампы моргают. Уйди из-под света и проверь ближайшую герму по карте.',
  },
  false_safe_zone: {
    id: 'false_safe_zone',
    warningLine: 'Карта показывает тихое место. Проверь воздух и выход, не закрывайся в первой комнате.',
  },
  wet_floor_message: {
    id: 'wet_floor_message',
    warningLine: 'Под ногами вода. Иди выше по сухому полу, мокрая герма держит хуже.',
  },
  meat_walls_hell: {
    id: 'meat_walls_hell',
    warningLine: 'Швы стен набухли и стали теплыми. Не гладь их, держись середины прохода.',
    meatWallsOnHell: true,
    spawnMult: 1.1,
  },
  green_source: {
    id: 'green_source',
    warningLine: 'Экран в конце коридора позеленел. Не смотри прямо, сверяй дверь по номеру.',
  },
  high_beep: {
    id: 'high_beep',
    warningLine: 'Писк идёт через стены и зубы. Не иди на звук, ищи тёмную герму по карте.',
    noSiren: true,
    fogSpawnIntervalMult: 1.1,
  },
  wrong_door_hint: {
    id: 'wrong_door_hint',
    warningLine: 'Дверь повторилась на карте. Не входи, пока номер и сектор не совпали.',
    sealTimingDelta: -3,
  },
  bell_warning: {
    id: 'bell_warning',
    warningLine: 'Сирена сорвалась в низкие колокола. Укрытие по церковной ведомости: к золотому контуру, воду держи при себе.',
    noSiren: true,
    sealTimingDelta: 2,
  },
  golden_light: {
    id: 'golden_light',
    warningLine: 'Золотой контур лег на герму как пломба ЖЭКа. Мест меньше, чем людей в коридоре.',
    fogSeedMult: 0.55,
    fogSpawnIntervalMult: 1.65,
    spawnMult: 0.55,
    shelterRoomCount: 2,
  },
  choir_mask: {
    id: 'choir_mask',
    warningLine: 'За стеной поют жильцы, которых нет в списке укрытых. По имени зовут - не отвечай.',
    spawnMult: 0.85,
    extraEyes: 1,
  },
  white_area: {
    id: 'white_area',
    warningLine: 'Дверная щель стала белым окном. Из-под рамы сыпется сухой песок; занавесь и отведи людей от рамы.',
    fogSeedMult: 0.45,
    fogSpawnIntervalMult: 1.2,
    spawnMult: 0.9,
  },
  no_sun: {
    id: 'no_sun',
    warningLine: 'Сирена звучит снаружи, хотя выхода нет. У белого окна не ищи двор, ищи ткань и тёмную герму.',
    noSiren: true,
  },
  photo_distortion: {
    id: 'photo_distortion',
    warningLine: 'Фотография засветилась до щелчка. Засвеченный кадр держи отдельно от карты и свидетеля.',
  },
  area_leak: {
    id: 'area_leak',
    warningLine: 'Карта показала область там, где была кухня. Белый обход короче, но после него спрашивают фамилии.',
    sealTimingDelta: -2,
  },
};

export const SAMOSBOR_VARIANTS: readonly SamosborVariantDef[] = [
  {
    id: 'classic',
    displayName: 'Типовой (ГОСТ-С)',
    floors: ALL_FLOORS,
    weight: 60,
    subsystems: [],
    visual: { screenFx: 'violet_noise', fogDensityBonus: 0.022, glitchIntensity: 0.075, postIntensity: 0.62 },
    fogColor: [112, 24, 168],
    tint: '#a34cff',
    durationMult: 1,
    spawnMult: 1,
    sealTimingDelta: 0,
    warningLines: ['Штатная сирена. Фиолетовый туман пошёл по зоне: к герме или за границу зоны.'],
    modifiers: ['dense_fog'],
    gameplaySignal: 'штатная сирена, фиолетовый туман, гермы закрываются по регламенту',
    audioCue: 'siren',
    startLine: 'САМОСБОР НАЧАЛСЯ: зона закрывается, туман пошёл по щелям.',
  },
  {
    id: 'wet',
    displayName: 'Тяжелый влажный',
    floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL],
    weight: 20,
    subsystems: ['wet_spawn_shark'],
    visual: { screenFx: 'wet_noise', fogDensityBonus: 0.024, glitchIntensity: 0.055, postIntensity: 0.52 },
    fogColor: [44, 116, 156],
    tint: '#44a6d8',
    durationMult: 1.08,
    spawnMult: 1.05,
    sealTimingDelta: 2,
    warningLines: ['На линолеуме выступает вода. Ищи сухой обход до гермы, мокрый пол сдаёт шаги.'],
    modifiers: ['wet_floor_message', 'dense_fog', 'door_twitch'],
    gameplaySignal: 'синий туман, мокрый пол, больше тварей лезет из тумана, безопаснее сухие коридоры и закрываемые шлюзы',
    audioCue: 'siren',
    startLine: 'МОКРЫЙ САМОСБОР НАЧАЛСЯ: вода уводит туман под двери.',
  },
  {
    id: 'electric',
    displayName: 'Озоновый пробой',
    floors: [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE],
    weight: 16,
    subsystems: [],
    visual: { screenFx: 'electric_static', fogDensityBonus: 0.018, glitchIntensity: 0.095, postIntensity: 0.58 },
    fogColor: [80, 180, 210],
    tint: '#72e6ff',
    durationMult: 0.95,
    spawnMult: 1,
    sealTimingDelta: 4,
    warningLines: ['Гермоуплотнитель пахнет озоном. Не стой под лампами, закрывайся до раннего щелчка.'],
    modifiers: ['light_flicker', 'early_seal', 'extra_eyes'],
    gameplaySignal: 'циановый туман, раннее запирание, больше глаз в тумане, уходи от света и готовь дверь заранее',
    audioCue: 'siren',
    startLine: 'ЭЛЕКТРОСБОР НАЧАЛСЯ: гермы закрываются раньше, лампы смотрят.',
  },
  {
    id: 'meat',
    displayName: 'Красный биологический',
    floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL],
    weight: 14,
    subsystems: ['hell_meat_walls'],
    visual: { screenFx: 'meat_pulse', fogDensityBonus: 0.026, glitchIntensity: 0.06, postIntensity: 0.5 },
    fogColor: [156, 40, 56],
    tint: '#d64b5f',
    durationMult: 1.15,
    spawnMult: 1.18,
    sealTimingDelta: 0,
    warningLines: [
      'Пахнет сырым мясом. Стена теплая не потому, что живая. Держись середины прохода.',
      'На кухне оборвался спор и чайник кипит один. Не проверяй комнату без пути назад.',
      'Пол липнет без воды, а шов тянет воздух внутрь. Не верь красивому обходу.',
    ],
    modifiers: ['meat_walls_hell', 'false_safe_zone', 'sparse_fog'],
    gameplaySignal: 'красный туман, теплеющие швы, ложная безопасность, наплыв тварей, держись середины прохода',
    audioCue: 'siren',
    startLine: 'МЯСНОЙ САМОСБОР НАЧАЛСЯ: швы тёплые, уходи от стен.',
  },
  {
    id: 'maronary',
    displayName: 'Маронарий',
    floors: ALL_FLOORS,
    weight: 4,
    subsystems: ['maronary_sources', 'wrong_door', 'source_glow', 'fog_rewrite'],
    visual: { screenFx: 'green_signal', fogDensityBonus: 0.016, glitchIntensity: 0.07, postIntensity: 0.7 },
    fogColor: [48, 230, 86],
    tint: '#35ff66',
    durationMult: 0.82,
    spawnMult: 0.78,
    sealTimingDelta: -2,
    warningLines: [
      'ПРОИЗОШЁЛ МАРОНАРИЙ: сирены нет. Не смотри в зелёный источник; сверяй дверь по номеру.',
      'Писк пошёл без сирены. Не иди на звук: сверяй дверь по номеру и карте.',
      'Глазок зеленеет дольше моргания. Отойди от двери и проверь карту без доверия.',
      'Дверь открылась в тот же коридор. Не повторяй маршрут, пока номер на карте не совпал с табло.',
      'Короткий путь вернул тот же сектор. Развернись, если табло пишет старый номер.',
      'Документ в кармане сменил владельца. Стружку держи отдельно от бумаг.',
      'Из трубы зовут голосом соседа, которого вчера внесли в пропавшие. Уходи от источника, а не к нему.',
      'Маронарий путает дверь. Если номер сменился, разворачивайся до щелчка.',
      'Зелёный источник пищит ровно и жжёт кожу. Обойди свет; если проход отрезан, бей экран или лампу и уходи от осколков.',
      'Карта предлагает короткий путь на писк. Не доверяй стрелке: ставь метку и выбирай длинный обход.',
      'Стружка лежит как улика. Продай НИИ, культу или Министерству, либо спрячь отдельно от бумаг.',
    ],
    modifiers: ['green_source', 'high_beep', 'wrong_door_hint'],
    gameplaySignal: 'зелёный источник обжигает вблизи, высокий писк, повтор двери, ненадёжный короткий путь, источник можно обойти/сломать, стружку продать или спрятать отдельно от документов',
    audioCue: 'beep',
    startLine: 'ПРОИЗОШЁЛ МАРОНАРИЙ: двери путают номера, документы не держи у зелёной стружки.',
  },
  {
    id: 'istotit',
    displayName: 'Истотит',
    floors: CIVIL_FLOORS,
    weight: 3,
    subsystems: ['istotit_shelters', 'bell_compulsion', 'fog_create'],
    visual: { screenFx: 'gold_bell', fogDensityBonus: 0.014, glitchIntensity: 0.04, postIntensity: 0.5 },
    fogColor: [212, 166, 72],
    tint: '#d6a64b',
    durationMult: 0.92,
    spawnMult: 0.52,
    sealTimingDelta: 3,
    warningLines: [
      'Низкий колокол пошёл вместо сирены. К золотому контуру; в ведомость всех не впишут.',
      'Золотой контур лег на дверь, а воды осталось на троих.',
      'Золотая герма держит комнату. Ведомость потом спросит, кто остался без строки.',
      'Хор тянет одну букву. Внутри считают укрытых, снаружи считают стук.',
    ],
    modifiers: ['bell_warning', 'golden_light', 'choir_mask'],
    gameplaySignal: 'низкие церковные колокола вместо сирены, золотой контур гермы, чужие голоса за стеной, укрытые комнаты и тесная ведомость',
    audioCue: 'bell',
    startLine: 'ПРОИЗОШЁЛ ИСТОТИТ: золотые контуры открыты, мест меньше, чем фамилий.',
  },
  {
    id: 'veretar',
    displayName: 'Веретар',
    floors: ALL_FLOORS,
    weight: 4,
    subsystems: ['veretar_area_leak', 'fog_delete'],
    visual: { screenFx: 'white_exposure', fogDensityBonus: 0.015, glitchIntensity: 0.045, postIntensity: 0.54 },
    fogColor: [226, 222, 202],
    tint: '#f4f1df',
    durationMult: 0.96,
    spawnMult: 0.78,
    sealTimingDelta: -1,
    warningLines: [
      'НАСТУПИЛ ВЕРЕТАР. Белое окно не показывает двор. Занавесь или уходи.',
      'Сирена звучит снаружи, а сосед у окна уже не узнаёт подъезд. Оттащи его от рамы.',
      'На полу сухой песок. Там была кухня; теперь старшая не может досчитаться кастрюль и людей.',
      'Фотография засветилась до щелчка. На ней лишняя комната; не сверяй по ней маршрут.',
      'Короткий белый проход экономит шаги. После него в перекличке не хватает фамилии.',
      'Белый источник не трогай взглядом. Сначала ткань на раму, потом герметик в щель.',
      'Песок сухой даже на мокром полу. Бери как улику, но не клади к пайкам и пропускам.',
      'Занавеску держи двумя руками. Если ткань тянет наружу, зови свидетеля по имени и отходи.',
      'Карта показывает область прямой линией. Длинный коридор безопаснее белого сокращения.',
      'Фото с белого порога не доказывает выход. Оно доказывает, что окно стало источником.',
    ],
    modifiers: ['no_sun', 'white_area', 'area_leak', 'photo_distortion'],
    gameplaySignal: 'белый источник, сухой песок, дальняя тревога, засвеченное фото, спасение свидетеля, занавеска или герметик важнее короткого пути',
    audioCue: 'distant_alarm',
    startLine: 'НАСТУПИЛ ВЕРЕТАР: белые окна закрывать, людей от рам уводить, фото и песок держать отдельно.',
  },
];

export const SAMOSBOR_AFTERMATH_BEATS: readonly SamosborAftermathBeatDef[] = [
  {
    id: 'aftermath_fog_residue',
    title: 'Осадок тумана',
    variants: ['classic', 'wet', 'meat'],
    floors: CIVIL_AND_SERVICE_FLOORS,
    weight: 12,
    cooldownSec: 240,
    maxRuns: 8,
    radius: 7,
    severity: 3,
    effect: 'fog_residue',
    message: 'После отбоя у плинтуса остался фиолетовый слой. Обойди, закрой дверь или проходи с риском.',
    tags: ['fog', 'route'],
    fogStrength: 120,
  },
  {
    id: 'aftermath_door_fault',
    title: 'Дверь заело',
    variants: ['wet', 'electric'],
    floors: ALL_FLOORS,
    weight: 10,
    cooldownSec: 360,
    maxRuns: 6,
    radius: 12,
    severity: 3,
    effect: 'door_fault',
    message: 'Одна дверь рядом заела открытой. Как путь годится, как укрытие больше нет.',
    tags: ['door', 'route'],
  },
  {
    id: 'aftermath_shortcut_slab_shift',
    title: 'Плита села в проход',
    variants: ['classic', 'wet', 'electric', 'meat', 'maronary', 'istotit', 'veretar'],
    floors: ALL_FLOORS,
    weight: 11,
    cooldownSec: 480,
    maxRuns: 8,
    radius: 14,
    severity: 3,
    effect: 'route_block',
    message: 'Короткий проход после отбоя сел плитой. Обход длиннее; дверь открыть можно, но старый маршрут не вернулся.',
    tags: ['door', 'route', 'blocked_shortcut'],
  },
  {
    id: 'aftermath_route_entry_residue',
    title: 'Маршрут пережил отбой',
    variants: ['classic', 'wet', 'electric', 'meat', 'maronary', 'istotit', 'veretar'],
    floors: ALL_FLOORS,
    weight: 18,
    cooldownSec: 180,
    maxRuns: 12,
    radius: 16,
    severity: 3,
    effect: 'route_residue',
    message: 'Маршрут пережил самосбор криво: метка на полу, закрытая створка и чужой припас показывают новый обход.',
    tags: ['route', 'residue', 'blocked_shortcut', 'rumor'],
    itemId: 'water',
  },
  {
    id: 'aftermath_aftershock_tvar',
    title: 'Поздняя тварь',
    variants: ['wet', 'meat'],
    floors: ALL_FLOORS,
    weight: 9,
    cooldownSec: 300,
    maxRuns: 8,
    radius: 14,
    severity: 4,
    effect: 'monster_aftershock',
    message: 'После отбоя в углу остался плотный туман. Рядом проснулась поздняя тварь: проверь угол до обыска.',
    tags: ['monster', 'danger'],
    monsterKind: MonsterKind.TVAR,
  },
  {
    id: 'aftermath_electric_eye',
    title: 'Глаз после озона',
    variants: ['electric'],
    floors: [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE],
    weight: 14,
    cooldownSec: 300,
    maxRuns: 8,
    radius: 14,
    severity: 4,
    effect: 'monster_aftershock',
    message: 'Лампы щёлкнули после отбоя. В коридоре открылся глаз; свет больше не укрытие.',
    tags: ['monster', 'electric'],
    monsterKind: MonsterKind.EYE,
  },
  {
    id: 'aftermath_rumor_seed',
    title: 'Слух об отбойном протоколе',
    variants: ['wet', 'electric', 'meat'],
    floors: CIVIL_FLOORS,
    weight: 14,
    cooldownSec: 420,
    maxRuns: 6,
    radius: 18,
    severity: 2,
    effect: 'rumor_seed',
    message: 'Соседи запомнили этот самосбор. Спроси сейчас: кто видел рабочую герму, тот знает обход.',
    tags: ['rumor', 'social'],
  },
  {
    id: 'aftermath_supply_shortage',
    title: 'Срыв снабжения',
    variants: ['wet', 'electric', 'meat'],
    floors: [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE],
    weight: 8,
    cooldownSec: 600,
    maxRuns: 5,
    radius: 18,
    severity: 3,
    effect: 'production_shortage',
    message: 'Местный цех потерял ящик расходников. Производство кашляет, цены уже встали в очередь.',
    tags: ['shortage', 'production'],
    resourceId: 'labor',
  },
  {
    id: 'aftermath_faction_panic',
    title: 'Фракционная паника',
    variants: ['electric', 'meat'],
    floors: [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE],
    weight: 9,
    cooldownSec: 360,
    maxRuns: 7,
    radius: 16,
    severity: 3,
    effect: 'faction_panic',
    message: 'Люди рядом сорвались с мест. Толпа открывает дорогу, уводит охрану и оставляет виноватых у двери.',
    tags: ['faction', 'panic'],
  },
  {
    id: 'aftermath_container_theft',
    title: 'Открытый запас',
    variants: ['wet', 'electric', 'meat'],
    floors: CIVIL_AND_SERVICE_FLOORS,
    weight: 10,
    cooldownSec: 480,
    maxRuns: 6,
    radius: 18,
    severity: 3,
    effect: 'container_theft',
    message: 'Рядом остался раскрытый ящик. Чужое лежит на виду: взять можно, но свидетели тоже выжили.',
    tags: ['container', 'theft'],
    itemId: 'water',
  },
  {
    id: 'aftermath_false_all_clear',
    title: 'Ложный отбой',
    variants: ['meat'],
    floors: ALL_FLOORS,
    weight: 8,
    cooldownSec: 540,
    maxRuns: 5,
    radius: 6,
    severity: 4,
    effect: 'false_all_clear',
    message: 'Система дала отбой слишком рано. Проверь карту и пол: фиолетовый слой мог остаться.',
    tags: ['false_clear', 'fog'],
    fogStrength: 150,
  },
  {
    id: 'aftermath_civil_ration_queue_split',
    title: 'Разорванная очередь пайков',
    variants: ['classic', 'electric'],
    floors: CIVIL_FLOORS,
    weight: 16,
    cooldownSec: 720,
    maxRuns: 4,
    radius: 16,
    severity: 3,
    effect: 'production_shortage',
    message: 'После отбоя очередь пайков потеряла ведомость. Еда стала дороже; можно торговаться, воровать или искать другой лифт.',
    tags: ['civil', 'food', 'shortage'],
    resourceId: 'food',
  },
  {
    id: 'aftermath_ministry_forms_eaten',
    title: 'Съеденные бланки',
    variants: ['electric', 'meat'],
    floors: [FloorLevel.MINISTRY, FloorLevel.KVARTIRY],
    weight: 14,
    cooldownSec: 780,
    maxRuns: 3,
    radius: 18,
    severity: 3,
    effect: 'production_shortage',
    message: 'В канцелярии недосчитались бланков. Документы подорожали; подделка, кража или услуга стали реальным выбором.',
    tags: ['civil', 'documents', 'shortage'],
    resourceId: 'documents',
  },
  {
    id: 'aftermath_open_fridge_line',
    title: 'Открытый общий холодильник',
    variants: ['wet', 'meat'],
    floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING],
    weight: 15,
    cooldownSec: 660,
    maxRuns: 4,
    radius: 14,
    severity: 3,
    effect: 'container_theft',
    message: 'Общий холодильник остался раскрытым. Взять воду легко, объяснить потом труднее, особенно при соседях.',
    tags: ['civil', 'container', 'water'],
    itemId: 'water',
  },
  {
    id: 'aftermath_stairwell_denunciation',
    title: 'Подъездный донос',
    variants: ['electric', 'meat'],
    floors: CIVIL_FLOORS,
    weight: 14,
    cooldownSec: 600,
    maxRuns: 4,
    radius: 20,
    severity: 2,
    effect: 'rumor_seed',
    message: 'На лестнице уже спорят, кто открыл гермодверь. Можно уйти тихо, а можно продать версию первым.',
    tags: ['civil', 'rumor', 'social'],
  },
  {
    id: 'aftermath_liquidator_sweep_pressure',
    title: 'Ликвидаторский обход',
    variants: ['classic', 'electric', 'wet'],
    floors: CIVIL_AND_SERVICE_FLOORS,
    weight: 10,
    cooldownSec: 720,
    maxRuns: 4,
    radius: 18,
    severity: 3,
    effect: 'faction_panic',
    message: 'Ликвидаторы пошли по следу самосбора. Люди расходятся; коридор меняет хозяина до следующего обхода.',
    tags: ['faction', 'pressure', 'civil'],
  },
  {
    id: 'aftermath_black_liquidator_patrol',
    title: 'Черный обход',
    variants: ['classic', 'wet', 'electric'],
    floors: CIVIL_FLOORS,
    weight: 5,
    cooldownSec: 960,
    maxRuns: 2,
    radius: 18,
    severity: 4,
    effect: 'monster_aftershock',
    message: 'После тяжелого отбоя в коридор вошла черная зачистка. Не открывай дверь и не держи пробу на виду.',
    tags: ['monster', 'false_cleanup', 'liquidator', 'patrol'],
    monsterKind: MonsterKind.BLACK_LIQUIDATOR,
    monsterCount: 3,
    minSamosborCount: 3,
  },
  {
    id: 'aftermath_pressure_station_drop',
    title: 'Провал давления',
    variants: ['wet', 'electric'],
    floors: [FloorLevel.MAINTENANCE],
    weight: 20,
    cooldownSec: 720,
    maxRuns: 4,
    radius: 18,
    severity: 3,
    effect: 'production_shortage',
    message: 'В коллекторе просело давление. Вода стала предметом торга: манометр лучше проверить до следующей сирены.',
    tags: ['maintenance', 'water', 'pressure'],
    resourceId: 'drink_water',
  },
  {
    id: 'aftermath_burnt_tool_locker',
    title: 'Сгоревший инструментальный шкаф',
    variants: ['electric', 'wet'],
    floors: [FloorLevel.MAINTENANCE],
    weight: 16,
    cooldownSec: 780,
    maxRuns: 3,
    radius: 14,
    severity: 3,
    effect: 'container_theft',
    message: 'Инструментальный шкаф заклинило открытым. Предохранитель можно забрать, но без него следующий щиток не простит.',
    tags: ['maintenance', 'container', 'electric'],
    itemId: 'fuse',
  },
  {
    id: 'aftermath_service_airlock_fault',
    title: 'Сервисный шлюз не держит',
    variants: ['wet', 'electric', 'classic'],
    floors: [FloorLevel.MAINTENANCE],
    weight: 16,
    cooldownSec: 540,
    maxRuns: 4,
    radius: 16,
    severity: 3,
    effect: 'door_fault',
    message: 'Сервисный шлюз после отбоя не держит защёлку. Путь открыт, но как укрытие он теперь обман.',
    tags: ['maintenance', 'door', 'route'],
  },
  {
    id: 'aftermath_zinc_slime_bucket',
    title: 'Ведро зачистки забыто',
    variants: ['wet', 'classic'],
    floors: [FloorLevel.MAINTENANCE],
    weight: 9,
    cooldownSec: 840,
    maxRuns: 3,
    radius: 14,
    severity: 3,
    effect: 'container_theft',
    message: 'После отбоя в шкафу зачистки осталось цинковое ведро с пломбой. Забрать можно; акт потом спросят у последнего владельца.',
    tags: ['maintenance', 'container', 'slime', 'liquidator', 'cleanup'],
    itemId: 'zinc_slime_bucket',
  },
  {
    id: 'aftermath_slime_sense_node',
    title: 'Узел слышит после отбоя',
    variants: ['wet', 'classic'],
    floors: [FloorLevel.MAINTENANCE],
    weight: 5,
    cooldownSec: 1260,
    maxRuns: 2,
    radius: 9,
    severity: 3,
    effect: 'item_residue',
    message: 'В мокрой трещине остался чувствительный узел слизи. Забери как редкую пробу, сдай НИИ, продай рынку или оставь ликвидаторам на прожиг.',
    tags: ['maintenance', 'slime', 'sample', 'sense', 'nii', 'aftermath'],
    itemId: 'slime_sense_node',
  },
  {
    id: 'aftermath_late_tube_eel',
    title: 'Поздний угорь',
    variants: ['wet'],
    floors: [FloorLevel.MAINTENANCE, FloorLevel.HELL],
    weight: 13,
    cooldownSec: 900,
    maxRuns: 3,
    radius: 16,
    severity: 4,
    effect: 'monster_aftershock',
    message: 'В трубе осталось движение после отбоя. Поздний угорь слышен по воде: сухой обход стоит времени.',
    tags: ['maintenance', 'monster', 'water'],
    monsterKind: MonsterKind.TUBE_EEL,
  },
  {
    id: 'aftermath_cult_cache_unsealed',
    title: 'Культовый схрон раскрылся',
    variants: ['meat'],
    floors: [FloorLevel.HELL],
    weight: 15,
    cooldownSec: 900,
    maxRuns: 3,
    radius: 14,
    severity: 3,
    effect: 'container_theft',
    message: 'Мясной шов раздвинул чужой схрон. Метку можно забрать, но культовый сторож уже считает, кого спросить за пустое место.',
    tags: ['hell', 'container', 'cult'],
    itemId: 'meat_rune',
  },
  {
    id: 'aftermath_herald_afterimage',
    title: 'Послеслед вестника',
    variants: ['meat', 'classic'],
    floors: [FloorLevel.HELL],
    weight: 14,
    cooldownSec: 1080,
    maxRuns: 2,
    radius: 18,
    severity: 4,
    effect: 'monster_aftershock',
    message: 'В проходе остался мокрый след Вестника. Держи дверь между собой и силуэтом.',
    tags: ['hell', 'monster', 'aftershock'],
    monsterKind: MonsterKind.HERALD,
  },
  {
    id: 'aftermath_hell_meat_supply_rot',
    title: 'Гнилая мясная выдача',
    variants: ['meat', 'wet'],
    floors: [FloorLevel.HELL],
    weight: 16,
    cooldownSec: 840,
    maxRuns: 3,
    radius: 16,
    severity: 3,
    effect: 'production_shortage',
    message: 'Мясная выдача испортилась после отбоя. Плоть стала валютой, а у порога её считают ведром, списком и охраной.',
    tags: ['hell', 'shortage', 'meat'],
    resourceId: 'industrial_slurry',
  },
  {
    id: 'aftermath_fibrous_capsule_cut',
    title: 'Фиброзная капсула',
    variants: ['meat'],
    floors: [FloorLevel.HELL],
    weight: 6,
    cooldownSec: 1260,
    maxRuns: 2,
    radius: 9,
    severity: 3,
    effect: 'item_residue',
    message: 'Мясной блок после отбоя оставил плотную капсулу. Срежь пробу: НИИ примет как угрозу укрытию, мастерская считает из неё Т2.',
    tags: ['hell', 'meat', 'sample', 'samosbor', 'aftermath', 'factory_input'],
    itemId: 'fibrous_capsule_cut',
  },
  {
    id: 'aftermath_void_psi_cache',
    title: 'ПСИ-схрон без владельца',
    variants: ['classic', 'maronary', 'veretar'],
    floors: [FloorLevel.VOID],
    weight: 16,
    cooldownSec: 960,
    maxRuns: 3,
    radius: 12,
    severity: 3,
    effect: 'container_theft',
    message: 'В белом коридоре на миг проявился чужой схрон. ПСИ-пыль можно забрать сейчас, пока не пришёл владелец.',
    tags: ['void', 'container', 'psi'],
    itemId: 'psi_dust',
  },
  {
    id: 'aftermath_void_spirit_echo',
    title: 'Эхо без жильца',
    variants: ['classic', 'maronary', 'veretar'],
    floors: [FloorLevel.VOID],
    weight: 15,
    cooldownSec: 1080,
    maxRuns: 2,
    radius: 16,
    severity: 4,
    effect: 'monster_aftershock',
    message: 'Отбой повторился голосом из соседней квартиры. Рядом появился дух; держи стену за спиной.',
    tags: ['void', 'monster', 'psi'],
    monsterKind: MonsterKind.SPIRIT,
  },
  {
    id: 'aftermath_void_false_map',
    title: 'Ложная белая карта',
    variants: ['classic', 'maronary', 'veretar'],
    floors: [FloorLevel.VOID],
    weight: 14,
    cooldownSec: 900,
    maxRuns: 3,
    radius: 7,
    severity: 4,
    effect: 'false_all_clear',
    message: 'Карта показала чистый белый путь. Туман остался ровно там: проверь ногами только край.',
    tags: ['void', 'false_clear', 'fog'],
    fogStrength: 165,
  },
  {
    id: 'aftermath_maronary_shaving',
    title: 'Зелёная стружка',
    variants: ['maronary'],
    floors: ALL_FLOORS,
    weight: 18,
    cooldownSec: 720,
    maxRuns: 5,
    radius: 9,
    severity: 3,
    effect: 'item_residue',
    message: 'В трещине осталась зелёная стружка. Возьми как улику, продай НИИ/культу/Министерству или не клади к документам.',
    tags: ['maronary', 'green_source', 'residue', 'shaving'],
    itemId: 'maronary_shaving',
  },
  {
    id: 'aftermath_maronary_wrong_door',
    title: 'Неправильная дверь',
    variants: ['maronary'],
    floors: ALL_FLOORS,
    weight: 16,
    cooldownSec: 540,
    maxRuns: 6,
    radius: 12,
    severity: 4,
    effect: 'door_fault',
    message: 'Одна дверь повторилась с другим номером. Путь открыт; проверь карту, запомни сектор или не входи.',
    tags: ['maronary', 'wrong_door', 'door', 'route'],
  },
  {
    id: 'aftermath_maronary_green_rumor',
    title: 'Свидетели зелёного',
    variants: ['maronary'],
    floors: VOID_AND_CIVIL_SERVICE_FLOORS,
    weight: 12,
    cooldownSec: 660,
    maxRuns: 4,
    radius: 18,
    severity: 2,
    effect: 'rumor_seed',
    message: 'Соседи спорят, был ли зелёный свет. Спроси молчащих: они знают, от какого глазка ушли.',
    tags: ['maronary', 'green_source', 'rumor', 'witness'],
  },
  {
    id: 'aftermath_istotit_witness_roster',
    title: 'Ведомость укрытых',
    variants: ['istotit'],
    floors: CIVIL_FLOORS,
    weight: 22,
    cooldownSec: 720,
    maxRuns: 4,
    radius: 9,
    severity: 3,
    effect: 'item_residue',
    message: 'После Истотита у золотого контура лежит ведомость: внутри, снаружи, свидетели и долг за закрытую ручку.',
    tags: ['istotit', 'shelter_tally', 'witness', 'social'],
    itemId: 'shelter_tally',
  },
  {
    id: 'aftermath_istotit_church_cache',
    title: 'Открытый церковный запас',
    variants: ['istotit'],
    floors: CIVIL_FLOORS,
    weight: 13,
    cooldownSec: 780,
    maxRuns: 3,
    radius: 18,
    severity: 3,
    effect: 'container_theft',
    message: 'Золотая герма оставила свечи и воду без присмотра. Церковный запас кончился раньше жажды.',
    tags: ['istotit', 'container', 'theft'],
    itemId: 'istotit_candle',
  },
  {
    id: 'aftermath_istotit_social_debt',
    title: 'Долг у батареи',
    variants: ['istotit'],
    floors: CIVIL_FLOORS,
    weight: 16,
    cooldownSec: 840,
    maxRuns: 4,
    radius: 18,
    severity: 3,
    effect: 'rumor_seed',
    message: 'У батареи считают не чудо, а бытовой долг: кто был внутри, кто остался снаружи и кто это видел.',
    tags: ['istotit', 'debt', 'witness', 'social'],
  },
  {
    id: 'aftermath_istotit_golden_false_clear',
    title: 'Ложный церковный отбой',
    variants: ['istotit'],
    floors: CIVIL_FLOORS,
    weight: 10,
    cooldownSec: 840,
    maxRuns: 3,
    radius: 7,
    severity: 4,
    effect: 'false_all_clear',
    message: 'Колокол дал отбой не по графику. Проверь пол: жёлтая пыль могла остаться туманом.',
    tags: ['istotit', 'false_clear', 'fog'],
    fogStrength: 115,
  },
  {
    id: 'aftermath_istotit_gilded_sborka',
    title: 'Позолоченная сборка',
    variants: ['istotit'],
    floors: CIVIL_FLOORS,
    weight: 9,
    cooldownSec: 900,
    maxRuns: 3,
    radius: 14,
    severity: 4,
    effect: 'monster_aftershock',
    message: 'Пение ушло в вентиляцию. В коридоре осталась тихая позолоченная сборка; за закрытую дверь кто-то теперь платит патронами.',
    tags: ['istotit', 'monster', 'aftershock'],
    monsterKind: MonsterKind.SBORKA,
  },
  {
    id: 'aftermath_veretar_white_sand',
    title: 'Белый песок',
    variants: ['veretar'],
    floors: ALL_FLOORS,
    weight: 18,
    cooldownSec: 720,
    maxRuns: 5,
    radius: 9,
    severity: 3,
    effect: 'item_residue',
    message: 'В трещине остался белый песок. Сосед носил такой в кармане после Веретара и забыл дорогу домой.',
    tags: ['veretar', 'residue', 'white_sand', 'sample'],
    itemId: 'veretar_sand',
  },
  {
    id: 'aftermath_veretar_overexposed_photo',
    title: 'Засвеченный кадр',
    variants: ['veretar'],
    floors: CIVIL_AND_SERVICE_FLOORS,
    weight: 8,
    cooldownSec: 840,
    maxRuns: 3,
    radius: 10,
    severity: 3,
    effect: 'item_residue',
    message: 'У щели лежит засвеченный кадр. На нём чужая комната и подпись жильца, которого не нашли после отбоя.',
    tags: ['veretar', 'photo', 'evidence', 'sample'],
    itemId: 'overexposed_photo',
  },
  {
    id: 'aftermath_veretar_area_door',
    title: 'Дверь с белой щелью',
    variants: ['veretar'],
    floors: ALL_FLOORS,
    weight: 15,
    cooldownSec: 540,
    maxRuns: 5,
    radius: 12,
    severity: 4,
    effect: 'door_fault',
    message: 'Одна дверь осталась с сухой белой щелью. Замажь её или обходи; возле неё уже пропал сосед с ведром.',
    tags: ['veretar', 'door', 'area_leak', 'route'],
  },
  {
    id: 'aftermath_veretar_shortcut_cost',
    title: 'Цена белого обхода',
    variants: ['veretar'],
    floors: ALL_FLOORS,
    weight: 10,
    cooldownSec: 900,
    maxRuns: 3,
    radius: 14,
    severity: 4,
    effect: 'route_block',
    message: 'Белый обход остался на карте короче обычного пути. Рядом молчит свидетель; путь сэкономил шаги и забрал объяснение.',
    tags: ['veretar', 'shortcut', 'route', 'witness', 'cost'],
  },
  {
    id: 'aftermath_veretar_pale_eye',
    title: 'Глаз у белого окна',
    variants: ['veretar'],
    floors: ALL_FLOORS,
    weight: 9,
    cooldownSec: 900,
    maxRuns: 3,
    radius: 16,
    severity: 4,
    effect: 'monster_aftershock',
    message: 'Белое ушло с пола, но у окна открылся глаз. Не веди туда людей из укрытия.',
    tags: ['veretar', 'monster', 'aftershock'],
    monsterKind: MonsterKind.EYE,
  },
  {
    id: 'aftermath_veretar_outside_rumor',
    title: 'Свидетели области',
    variants: ['veretar'],
    floors: CIVIL_AND_SERVICE_FLOORS,
    weight: 12,
    cooldownSec: 660,
    maxRuns: 4,
    radius: 18,
    severity: 2,
    effect: 'rumor_seed',
    message: 'Соседи спорят, был ли за белым окном двор. Ликвидаторы велят говорить: щель.',
    tags: ['veretar', 'rumor', 'social', 'witness'],
  },
];

function floorWeight(def: SamosborVariantDef, floor: FloorLevel): number {
  if (!def.floors.includes(floor)) return 0;
  if (floor === FloorLevel.MINISTRY) {
    if (def.id === 'electric') return def.weight * 1.8;
    if (def.id === 'istotit' || def.id === 'veretar') return def.weight * 2.2;
    if (def.id === 'classic') return def.weight * 0.75;
  }
  if (floor === FloorLevel.KVARTIRY || floor === FloorLevel.LIVING) {
    if (def.id === 'electric') return def.weight * 1.45;
    if (def.id === 'istotit' || def.id === 'veretar') return def.weight * 3;
    if (def.id === 'wet' || def.id === 'meat') return def.weight * 1.2;
    if (def.id === 'classic') return def.weight * 0.9;
  }
  if (floor === FloorLevel.MAINTENANCE) {
    if (def.id === 'wet' || def.id === 'electric') return def.weight * 4;
    if (def.id === 'veretar') return def.weight * 1.6;
    if (def.id === 'classic') return def.weight * 0.65;
    if (def.id === 'meat') return def.weight * 0.6;
  }
  if (floor === FloorLevel.HELL) {
    if (def.id === 'meat') return def.weight * 5;
    if (def.id === 'wet') return def.weight * 1.4;
    if (def.id === 'maronary' || def.id === 'veretar') return def.weight * 1.6;
    if (def.id === 'classic') return def.weight * 0.6;
  }
  if (floor === FloorLevel.VOID) {
    if (def.id === 'veretar') return def.weight * 7;
    if (def.id === 'maronary') return def.weight * 3;
    if (def.id === 'classic') return def.weight * 0.4;
  }
  return def.weight;
}

export function getSamosborVariantWeight(id: SamosborVariantId, floor: FloorLevel): number {
  const def = SAMOSBOR_VARIANTS.find(v => v.id === id);
  return def ? floorWeight(def, floor) : 0;
}

export function buildActiveSamosborVariant(def: SamosborVariantDef): ActiveSamosborVariant {
  const modifiers = def.modifiers.map(id => SAMOSBOR_MODIFIERS[id]);
  const subsystems = [...SAMOSBOR_BASE_SUBSYSTEMS];
  for (const subsystem of def.subsystems) {
    if (!subsystems.includes(subsystem)) subsystems.push(subsystem);
  }
  let spawnMult = def.spawnMult;
  let fogSeedMult = 1;
  let fogSpawnIntervalMult = 1;
  let sealTimingDelta = def.sealTimingDelta;
  let noSiren = false;
  let extraEyes = 0;
  let shelterRoomCount = 0;

  for (const mod of modifiers) {
    spawnMult *= mod.spawnMult ?? 1;
    fogSeedMult *= mod.fogSeedMult ?? 1;
    fogSpawnIntervalMult *= mod.fogSpawnIntervalMult ?? 1;
    sealTimingDelta += mod.sealTimingDelta ?? 0;
    noSiren ||= mod.noSiren === true;
    extraEyes += mod.extraEyes ?? 0;
    shelterRoomCount += mod.shelterRoomCount ?? 0;
  }

  return {
    def,
    modifiers,
    subsystems,
    visual: def.visual,
    durationMult: def.durationMult,
    spawnMult,
    fogSeedMult,
    fogSpawnIntervalMult,
    sealTimingDelta,
    noSiren,
    extraEyes,
    shelterRoomCount,
    fogColor: def.fogColor,
  };
}

export function samosborVariantHasSubsystem(
  variant: Pick<ActiveSamosborVariant, 'subsystems'> | Pick<SamosborVariantDef, 'subsystems'>,
  subsystem: SamosborSubsystemId,
): boolean {
  return variant.subsystems.includes(subsystem) || SAMOSBOR_BASE_SUBSYSTEMS.includes(subsystem);
}

export function getSamosborVariantName(id: SamosborVariantId | null | undefined): string {
  if (!id) return '-';
  return SAMOSBOR_VARIANTS.find(v => v.id === id)?.displayName ?? id;
}

export function getSamosborAftermathBeats(
  variant: SamosborVariantId,
  floor: FloorLevel,
): readonly SamosborAftermathBeatDef[] {
  return SAMOSBOR_AFTERMATH_BEATS.filter(def => def.variants.includes(variant) && def.floors.includes(floor));
}
