/* ── Monster ecology: spawn identity, counterplay, and loot hints ── */

import { FloorLevel, MonsterKind, RoomType } from '../core/types';

export interface MonsterRareDrop {
  itemId: string;
  chance: number;
  count?: number;
}

export interface MonsterEcologyDef {
  kind: MonsterKind;
  role?: string;
  cue?: string;
  rule?: string;
  floorFit?: string;
  floors: readonly FloorLevel[];
  rooms: readonly RoomType[];
  spawnWeight: number;
  minSamosborCount: number;
  rare: boolean;
  lootHint: string;
  counterplay: string;
  deathLogHint?: string;
  rumorIds: readonly string[];
  rareDrops: readonly MonsterRareDrop[];
}

export type MonsterCueTaskChannel = 'data' | 'text' | 'sprite' | 'audio';

export interface MonsterCueTask {
  id: string;
  kind: MonsterKind;
  channel: MonsterCueTaskChannel;
  cue: string;
  task: string;
}

export interface MonsterEcologyQuery {
  floor: FloorLevel;
  roomType?: RoomType;
  floorTags?: readonly string[];
  roomTags?: readonly string[];
  samosborCount?: number;
  allowRare?: boolean;
  allowOffFloor?: boolean;
  floorAffinity?: 'strict' | 'weighted' | 'none';
  excludeKinds?: readonly MonsterKind[];
  rng?: () => number;
  biasKinds?: readonly MonsterKind[];
  routePressure?: number;
}

export interface MonsterEcologyRank {
  kind: MonsterKind;
  weight: number;
  ecology: MonsterEcologyDef;
}

const CIVIL: readonly FloorLevel[] = [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING];
const DEEP: readonly FloorLevel[] = [FloorLevel.MAINTENANCE, FloorLevel.HELL, FloorLevel.VOID];
const ALL_BUT_VOID: readonly FloorLevel[] = [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL];
const NATIVE_FLOOR_MULT = 2.4;
const BIAS_KIND_MULT = 2.7;
const ROUTE_PRESSURE_KINDS: readonly MonsterKind[] = [
  MonsterKind.EYE,
  MonsterKind.SHADOW,
  MonsterKind.GLUBINNAYA_TEN,
  MonsterKind.NELYUD,
  MonsterKind.BEZEKHIY,
  MonsterKind.POLZUN,
  MonsterKind.REBAR,
  MonsterKind.ZAKALENNAYA_ARMATURA,
  MonsterKind.PANELNIK,
  MonsterKind.PAUPSINA,
  MonsterKind.TUBE_EEL,
  MonsterKind.LOTOCHNIK,
  MonsterKind.VODYANOY_KOSHMAR,
  MonsterKind.OLGOY,
  MonsterKind.CHERNOSLIZ,
  MonsterKind.LAMPOVY,
  MonsterKind.LAMPOGLAZ,
  MonsterKind.PECHATEED,
  MonsterKind.KONTORSHCHIK,
  MonsterKind.PROTOKOLNIK,
  MonsterKind.KANTSELYARSKIY_IDOL,
  MonsterKind.TRUBNYY_AVTOMAT,
  MonsterKind.LOZHNYY_DUKH,
  MonsterKind.PARAGRAPH,
  MonsterKind.SAFEGUARD,
  MonsterKind.SLEPOGLAZ,
  MonsterKind.TONKAYA_TEN,
  MonsterKind.TUMANNIK,
  MonsterKind.LISHENNYY,
  MonsterKind.ZHORNAYA_TVAR,
  MonsterKind.DIKIY_MERTVYAK,
  MonsterKind.TRESKOTNIK,
  MonsterKind.GREEN_DOG,
  MonsterKind.SLIME_WOMAN,
  MonsterKind.HEAD_SLUG,
  MonsterKind.BORSHCHEVIK,
  MonsterKind.SWARM,
  MonsterKind.SPORE_CARPET,
];

export const BAIT_ATTRACTED_MONSTER_KINDS: readonly MonsterKind[] = [
  MonsterKind.KRYSNOZHKA,
  MonsterKind.POMOYNY_ROY,
  MonsterKind.SWARM,
  MonsterKind.SBORKA,
  MonsterKind.TVAR,
  MonsterKind.ZHORNAYA_TVAR,
  MonsterKind.POLZUN,
  MonsterKind.TUBE_EEL,
  MonsterKind.OLGOY,
  MonsterKind.SLIMEVIK,
  MonsterKind.GREEN_DOG,
  MonsterKind.PECHATEED,
  MonsterKind.KONTORSHCHIK,
  MonsterKind.PROTOKOLNIK,
];

export function isBaitAttractedMonster(kind: MonsterKind | undefined): boolean {
  return kind !== undefined && BAIT_ATTRACTED_MONSTER_KINDS.includes(kind);
}

export const MONSTER_COUNTERPLAY_CUE_TASKS: readonly MonsterCueTask[] = [
  {
    id: 'cue_sborka_wire_crackle_audio',
    kind: MonsterKind.SBORKA,
    channel: 'audio',
    cue: 'Треск проволоки до контакта.',
    task: 'Добавить короткий procedural crackle при первом sighted/windup pack spawn, чтобы сборка читалась до укуса.',
  },
  {
    id: 'cue_krysnozhka_garbage_motion_sprite',
    kind: MonsterKind.KRYSNOZHKA,
    channel: 'sprite',
    cue: 'Мусор шевелится и выдает стаю.',
    task: 'Дать помойной/обычной крысоножке маленький garbage-flicker кадр или floor mark перед первым рывком.',
  },
  {
    id: 'cue_tvar_panel_scratch_text',
    kind: MonsterKind.TVAR,
    channel: 'text',
    cue: 'Панель царапает сама себя.',
    task: 'Связать sighted/log text с wallBias, чтобы игрок видел причину держать центр комнаты.',
  },
  {
    id: 'cue_polzun_wet_drag_audio',
    kind: MonsterKind.POLZUN,
    channel: 'audio',
    cue: 'Мокрый drag-sound перед дверью или ванной.',
    task: 'Добавить низкий мокрый звук при входе ползуна в door/water/bathroom kill cell.',
  },
  {
    id: 'cue_zombie_crowd_grab_death_text',
    kind: MonsterKind.ZOMBIE,
    channel: 'text',
    cue: 'Смерть объясняет толпу, кухню или дверной хват.',
    task: 'Добавить death-log wording для мертвяка, чтобы ошибка была социальной/позиционной, а не просто HP.',
  },
  {
    id: 'cue_lampovy_light_flicker_data',
    kind: MonsterKind.LAMPOVY,
    channel: 'data',
    cue: 'Лампа гудит и отмечает опасный радиус.',
    task: 'Пробросить lampPowered cue в event data/HUD hint рядом с Feature.LAMP без per-frame full-world scan.',
  },
  {
    id: 'cue_pechateed_paper_rustle_text',
    kind: MonsterKind.PECHATEED,
    channel: 'text',
    cue: 'Шелест бумаги идет из кармана игрока.',
    task: 'Показывать короткий local log, когда documentHunter выбирает цель из-за документов.',
  },
  {
    id: 'cue_tube_eel_water_ripple_sprite',
    kind: MonsterKind.TUBE_EEL,
    channel: 'sprite',
    cue: 'Вода рябит против течения до рывка угря.',
    task: 'Добавить дешевый water ripple mark на route-set-piece клетках угря и в debug pack рядом с водой.',
  },
  {
    id: 'cue_treskotnik_fracture_pulse_sprite',
    kind: MonsterKind.TRESKOTNIK,
    channel: 'sprite',
    cue: 'Красные трещины вспыхивают за долю секунды до рывка.',
    task: 'Держать windup-pulse через spriteScale/HUD cue без перегенерации спрайта в кадре.',
  },
  {
    id: 'cue_glubinnaya_ten_second_beat_text',
    kind: MonsterKind.GLUBINNAYA_TEN,
    channel: 'text',
    cue: 'Второй силуэт отстает от настоящего тела на один шаг.',
    task: 'Сохранять local-log предупреждение при первом темном рывке: светлый выход или стояние на месте срывают второй темп.',
  },
  {
    id: 'cue_gnome_concrete_scratch_audio',
    kind: MonsterKind.GNOME,
    channel: 'audio',
    cue: 'Скрежет арматуры по бетону и быстрый топот в узком туннеле.',
    task: 'Добавить звук копания и шороха камней, когда гном находится за стеной или в узком проходе.',
  },
];

export const MONSTER_ECOLOGY: readonly MonsterEcologyDef[] = [
  {
    kind: MonsterKind.SBORKA,
    role: 'Быстрый слабый расход патронов и проверка широкого прохода.',
    cue: 'Треск проволоки, мелкий топот и несколько силуэтов перед контактом.',
    rule: 'Догоняет первой и опасна числом, но падает от дешевого раннего выстрела; реагирует на приманку.',
    floorFit: 'Гражданские коридоры, кладовые и самосборные хвосты почти везде кроме Пустоты.',
    floors: ALL_BUT_VOID,
    rooms: [RoomType.CORRIDOR, RoomType.COMMON, RoomType.STORAGE],
    spawnWeight: 8.5,
    minSamosborCount: 1,
    rare: false,
    lootHint: 'проволока, кладовой мусор, редкая изолента из треснувшего узла',
    counterplay: 'Быстрая, слабая и часто не одна: принимайте в широком месте, гасите дешевым выстрелом и не тратьте последний магазин на первую.',
    deathLogHint: 'Смерть от сборки должна читать ошибку как поздний выстрел, узкий поворот или пустой магазин.',
    rumorIds: ['monster_sborka_fast', 'ecology_sborka_swarm'],
    rareDrops: [{ itemId: 'duct_tape', chance: 0.03 }],
  },
  {
    kind: MonsterKind.TUMANNIK,
    role: 'Туманный карман с ложным силуэтом и боковым ударом по последнему шумному шагу.',
    cue: 'В сером тумане один силуэт сдвинут в сторону, а настоящий корпус выдает только черно-красный сустав.',
    rule: 'Пока оба в плотном fog-пятне, видимая фигура смещена; свет, огонь или выход из тумана складывают смещение.',
    floorFit: 'Жилые самосборные карманы, адские пепельные коридоры и редкие смоговые маршрутные этажи.',
    floors: [FloorLevel.LIVING, FloorLevel.HELL],
    rooms: [RoomType.CORRIDOR, RoomType.COMMON, RoomType.STORAGE, RoomType.SMOKING],
    spawnWeight: 1.35,
    minSamosborCount: 2,
    rare: false,
    lootHint: 'серый влажный след, холодная пыль, редкий фильтрующий слой',
    counterplay: 'Не гонитесь за силуэтом в тумане: держите угол и слушайте боковой шаг; фонарь, огонь или выход из fog-кармана возвращают настоящее тело.',
    deathLogHint: 'Смерть от туманника должна читать ожидание чистого силуэта вместо угла, света или отхода из тумана.',
    rumorIds: ['monster_tumannik_side_sound', 'ecology_tumannik_light_commit'],
    rareDrops: [{ itemId: 'filter_layer', chance: 0.035 }, { itemId: 'psi_dust', chance: 0.015 }],
  },
  {
    kind: MonsterKind.KRYSNOZHKA,
    role: 'Пищевая мусорная стая, которая превращает запас еды в маршрутный риск.',
    cue: 'Мусор шевелится, лапки скребут у кухни, приманка пахнет сильнее кармана.',
    rule: 'Первый рывок слабый, но стая идет на помеченную еду или говняк и быстро окружает в быту.',
    floorFit: 'Кухни, кладовые и мусорные проходы Квартир, Жилой зоны и Коллекторов.',
    floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE],
    rooms: [RoomType.KITCHEN, RoomType.STORAGE, RoomType.CORRIDOR, RoomType.COMMON],
    spawnWeight: 3.2,
    minSamosborCount: 1,
    rare: false,
    lootHint: 'мелкие лапки, грязный жир, мусор гнезда, редкое сырое мясо',
    counterplay: 'Не кормите рой карманом: бросьте меченую приманку дальше себя, заведите через липкую ловушку или сбейте первый рывок дробью.',
    deathLogHint: 'Смерть от крысоножки должна напоминать про еду в кармане, позднюю дробь или бой в мусоре.',
    rumorIds: ['ecology_krysnozhka_bait'],
    rareDrops: [{ itemId: 'rawmeat', chance: 0.04 }, { itemId: 'mutant_tissue_sample', chance: 0.018 }],
  },
  {
    kind: MonsterKind.GREEN_DOG,
    role: 'Гражданско-техническая стая, которая начинается с воя за дверью и наказывает доверчивое открывание.',
    cue: 'Жалобный вой в коридоре, мокрые лапы по металлу, зеленый мох на серой низкой спине.',
    rule: 'Собаки делятся целью в малом радиусе и заходят телами, но громкий металл, вентиль, шумовая банка или дробовик пугают их и рвут стаю.',
    floorFit: 'Заброшенные жилые блоки, мусорные коридоры, ложные безопасные секции и технические переходы.',
    floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE],
    rooms: [RoomType.CORRIDOR, RoomType.COMMON, RoomType.STORAGE, RoomType.LIVING, RoomType.KITCHEN],
    spawnWeight: 2.4,
    minSamosborCount: 1,
    rare: false,
    lootHint: 'грязная шерсть, зеленый мох, черная слюна, редкий сырой кусок',
    counterplay: 'Не открывайте дверь на жалобный вой. Громкий металл, шумовая банка, вентиль или дробовик пугают стаю; еда уводит ее, но зовет мусорных тварей.',
    deathLogHint: 'Смерть от зеленой собаки должна читать открытую дверь на жалобный звук, бой в узком проходе или забытый шумовой инструмент.',
    rumorIds: ['monster_green_dog_door', 'ecology_green_dog_noise'],
    rareDrops: [{ itemId: 'rawmeat', chance: 0.045 }],
  },
  {
    kind: MonsterKind.POMOYNY_ROY,
    role: 'Помойная стая, которая занимает фланги вокруг открытой еды и брошенной приманки.',
    cue: 'Пакеты шуршат ногами, желтые крошки собираются на переднем краю, запах еды ведет край роя.',
    rule: 'Дальше чует открытую еду и говняк в инвентаре игрока, идет на брошенную приманку и расходится по фиксированным фланговым слотам.',
    floorFit: 'Мусорные кухни, рынки, кладовые, бытовые коридоры и засоренные технические углы.',
    floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE],
    rooms: [RoomType.KITCHEN, RoomType.STORAGE, RoomType.COMMON, RoomType.CORRIDOR],
    spawnWeight: 2.9,
    minSamosborCount: 1,
    rare: false,
    lootHint: 'пластиковый мусор, грязный жир, желтые крошки еды, редкое сырое мясо',
    counterplay: 'Закрытая банка и плотный пакет почти не пахнут: держите запас закрытым, бросайте приманку в сторону от маршрута и выжигайте или простреливайте узкий выход.',
    deathLogHint: 'Смерть от помойного роя должна читать открытую еду в кармане, приманку у ног или бой без узкого выхода.',
    rumorIds: ['monster_pomoyny_roy'],
    rareDrops: [{ itemId: 'rawmeat', chance: 0.03 }, { itemId: 'duct_tape', chance: 0.025 }],
  },
  {
    kind: MonsterKind.SWARM,
    role: 'Источник в вентиляции, который давит область короткоживущими быстрыми телами.',
    cue: 'Черно-ржавая живая статика течет из щели, на полу остается темная крошка и желтые точки глаз.',
    rule: 'Пока источник не заклеен или не выжжен, он на cooldown выпускает ограниченное число слабых быстрых тел рядом с игроком.',
    floorFit: 'Технические пустоты, заброшенные кухни после самосбора, сервисные щели Коллекторов и мясные вентиляции нижних этажей.',
    floors: [FloorLevel.MAINTENANCE, FloorLevel.HELL],
    rooms: [RoomType.CORRIDOR, RoomType.STORAGE, RoomType.PRODUCTION, RoomType.KITCHEN],
    spawnWeight: 1.15,
    minSamosborCount: 2,
    rare: false,
    lootHint: 'черная хитиновая крошка, ржавые лапки, желтые глазки, редкая изолента из гнезда',
    counterplay: 'Не геройствуйте против тел бесконечно: заклейте щель изолентой или герметиком, выжгите источник огнем, уведите тела приманкой или бегите через узел коротким рывком.',
    deathLogHint: 'Смерть от роя должна читать бой с телами вместо поиска источника, позднее заклеивание или стояние у активной вентиляции.',
    rumorIds: ['monster_swarm_source'],
    rareDrops: [{ itemId: 'duct_tape', chance: 0.035 }, { itemId: 'rawmeat', chance: 0.018 }],
  },
  {
    kind: MonsterKind.TVAR,
    role: 'Средняя ближняя угроза, заставляющая держать дистанцию от бетонной кромки.',
    cue: 'Бетон царапает сам себя, лапа тянется из-за панели, силуэт держит стену.',
    rule: 'У стены и рядом с прижатой целью тварь бьет дальше и больнее; в центре комнаты теряет преимущество.',
    floorFit: 'Жилые и технические коридоры, общие комнаты и склады до Мясного низа.',
    floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL],
    rooms: [RoomType.CORRIDOR, RoomType.LIVING, RoomType.COMMON, RoomType.STORAGE],
    spawnWeight: 6.2,
    minSamosborCount: 1,
    rare: false,
    lootHint: 'сырая органика, бетонная крошка у лап, редкий кусок мяса',
    counterplay: 'Держите полторы клетки, центр комнаты и запас назад: у бетонной кромки тварь достает дальше, а приманка срывает погоню.',
    deathLogHint: 'Смерть от твари должна указывать на прижатие к панели, слишком короткую дистанцию или проигнорированную приманку.',
    rumorIds: ['monster_tvar_walls', 'ecology_tvar_wall'],
    rareDrops: [{ itemId: 'rawmeat', chance: 0.04 }],
  },
  {
    kind: MonsterKind.PANELNIK,
    role: 'Панельный wall-anchor bruiser, который делает кромку стены плохим местом для размена.',
    cue: 'Скреб плитной руки, светлая пыль на ребре, широкие плечи закрывают стену.',
    rule: 'У стены держит броню и достает дальше плитной рукой; в двух клетках от стен теряет упор и коротко замедляется.',
    floorFit: 'Панельные жилые комнаты, общие проходы Квартир и редкие сервисные коридоры Коллекторов.',
    floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE],
    rooms: [RoomType.LIVING, RoomType.COMMON, RoomType.CORRIDOR, RoomType.STORAGE],
    spawnWeight: 1.7,
    minSamosborCount: 2,
    rare: false,
    lootHint: 'бетонная пыль, ржавые царапины арматуры, редкий герметик из плитного шва',
    counterplay: 'Не бейте у панели: дверь, угол и шаг в центр комнаты ломают упор. В двух клетках от стены Панельник замедляется и теряет броню.',
    deathLogHint: 'Смерть от панельника должна указывать на бой у стены, игнорирование плитной руки или отказ выманить в центр комнаты.',
    rumorIds: ['ecology_panelnik_wall'],
    rareDrops: [{ itemId: 'sealant_tube', chance: 0.05 }, { itemId: 'rebar', chance: 0.035 }],
  },
  {
    kind: MonsterKind.PAUPSINA,
    role: 'Быстрый web-spitter контроля, который не грызет здоровье, а делает плохой коридор липкой ловушкой.',
    cue: 'Палевая паутина на полу и стене, низкое многоногое тело, зеленые кончики клыков и обрывки сбруи.',
    rule: 'Держит среднюю дистанцию, плюет по прямой короткой сетью, отступает вбок при сближении и не стакает контроль дольше нескольких секунд.',
    floorFit: 'Сервисные кладовые, заброшенные комнаты, аварийные склады милиции или партии; редко в Квартирах как сбежавшая обученная тварь.',
    floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE],
    rooms: [RoomType.STORAGE, RoomType.PRODUCTION, RoomType.CORRIDOR, RoomType.COMMON],
    spawnWeight: 1.15,
    minSamosborCount: 2,
    rare: false,
    lootHint: 'бледные нитки, обломки сбруи, липкий мешок, редкая проволока',
    counterplay: 'Паутина летит только по видимой прямой и держит недолго: дверь, шкаф или угол срывают плевок, а нож, багор, топор, бензопила и огонь быстро освобождают ноги.',
    deathLogHint: 'Смерть от паупсины должна читать вход в уже оплетенную комнату, открытую прямую или отказ разрезать сеть.',
    rumorIds: ['monster_paupsina_web', 'ecology_paupsina_cut_fire'],
    rareDrops: [{ itemId: 'wire_coil', chance: 0.045 }, { itemId: 'duct_tape', chance: 0.025 }],
  },
  {
    kind: MonsterKind.ZHORNAYA_TVAR,
    role: 'Пищевой scent-lunge хищник, который превращает еду, мясо и приманку в маршрутное решение.',
    cue: 'Челюсть раскрывается, брюхо подтягивается, короткие усики нюхают пол до рывка.',
    rule: 'Сначала выбирает близкую пищевую вонь, бросок или носителя еды; промах оставляет длинное окно наказания.',
    floorFit: 'Кухни, мясные склады, алтарные застолья и тёплые коридоры Жилой зоны, Квартир и Ада.',
    floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.HELL],
    rooms: [RoomType.KITCHEN, RoomType.STORAGE, RoomType.COMMON, RoomType.CORRIDOR],
    spawnWeight: 2.2,
    minSamosborCount: 2,
    rare: false,
    lootHint: 'сырой жир, зубная крошка, редкое сырое мясо',
    counterplay: 'Запечатайте еду в контейнер или бросьте мясную приманку в сторону от своего пути: жорная тварь перекидывает рывок и долго восстанавливается после промаха.',
    deathLogHint: 'Смерть от жорной твари должна указывать на открытую еду, приманку у ног или бой до конца ее восстановления.',
    rumorIds: ['ecology_zhornaya_tvar_scent'],
    rareDrops: [{ itemId: 'rawmeat', chance: 0.07 }],
  },
  {
    kind: MonsterKind.POLZUN,
    role: 'Медленный танк, который превращает двери, воду и сантехнику в ловушку.',
    cue: 'Мокрый шорох у пола, тяжелое ползание под дверью, вода отвечает раньше шага.',
    rule: 'Снаружи тесных клеток кайтится, но в дверях, ванной и воде получает убийный контакт.',
    floorFit: 'Склады, ванные, производственные лотки и мокрые коридоры Жилой зоны, Коллекторов и Ада.',
    floors: [FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL],
    rooms: [RoomType.CORRIDOR, RoomType.BATHROOM, RoomType.PRODUCTION, RoomType.STORAGE],
    spawnWeight: 4.3,
    minSamosborCount: 1,
    rare: false,
    lootHint: 'мокрая ветошь, ванная грязь, редкий фильтрующий слой',
    counterplay: 'Не принимайте бой в дверях, ванной или воде: ползун медленный, но там уже рядом. Прямой отход дает время расстрелять.',
    deathLogHint: 'Смерть от ползуна должна читать ошибку как бой в двери, ванной, воде или отход без прямой линии.',
    rumorIds: ['monster_polzun_floor', 'ecology_polzun_low'],
    rareDrops: [{ itemId: 'filter_layer', chance: 0.04 }, { itemId: 'mutant_tissue_sample', chance: 0.014 }],
  },
  {
    kind: MonsterKind.BETONNIK,
    role: 'Редкая тяжелая бетонная угроза, которая закрывает прямой коридор.',
    cue: 'Коридор дрожит, бетон осыпается, тяжелая фигура перекрывает прямой ход.',
    rule: 'Прямой размен проигран; углы, шум и огонь покупают путь или отход.',
    floorFit: 'Редкие тяжелые встречи в гражданских этажах, Коллекторах, Аду и Пустоте.',
    floors: [FloorLevel.MINISTRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL, FloorLevel.VOID],
    rooms: [RoomType.CORRIDOR, RoomType.PRODUCTION, RoomType.HQ, RoomType.COMMON],
    spawnWeight: 0.65,
    minSamosborCount: 4,
    rare: true,
    lootHint: 'арматурная крошка, бетонные осколки, редкий теплый бетонный сгусток',
    counterplay: 'Не разменивайтесь ударами в прямом коридоре: обходите углами, держите выносливость, отвлекайте шумом или огнем.',
    deathLogHint: 'Смерть от бетонника должна объяснять, что игрок остался в прямом коридоре без угла, шума или огня.',
    rumorIds: ['monster_betonnik_heavy', 'ecology_betonnik_weight'],
    rareDrops: [{ itemId: 'rebar', chance: 0.06 }, { itemId: 'psi_concrete_splinter', chance: 0.02 }],
  },
  {
    kind: MonsterKind.BETONOED,
    role: 'Авторская слабостенная угроза, превращающая короткий путь в решение про шум, печать и огонь.',
    cue: 'Слабая стена хрустит изнутри, пыль тянется линией вдоль шва до прогрыза.',
    rule: 'Прогрызает только подготовленный слабый шов; шум ускоряет выход, герметик и блок-комплект закрывают, огонь отгоняет.',
    floorFit: 'Коллекторские кладовые, технические короткие ходы и слабые бетонные швы.',
    floors: [FloorLevel.MAINTENANCE],
    rooms: [RoomType.STORAGE, RoomType.CORRIDOR, RoomType.PRODUCTION],
    spawnWeight: 0.12,
    minSamosborCount: 0,
    rare: true,
    lootHint: 'арматурная крошка, бетонный осколок, редкая ПСИ-бетонная заноза',
    counterplay: 'Слушайте стену: герметик или блок-комплект закрывают шов, шумовая приманка меняет темп, огонь отгоняет бетоноеда.',
    deathLogHint: 'Смерть от бетоноеда должна читать нерешенную слабую стену, жадный короткий путь или поздний огонь.',
    rumorIds: ['monster_betonoed_weak_wall', 'ecology_betonoed_shortcut'],
    rareDrops: [{ itemId: 'rebar', chance: 0.05 }, { itemId: 'psi_concrete_splinter', chance: 0.025 }],
  },
  {
    kind: MonsterKind.GNOME,
    role: 'Мелкий бетоноруб и собиратель арматуры, опасный в узких технических туннелях.',
    cue: 'Скрежет мелкой арматуры по бетону, низкий топот и стук откалываемых камней.',
    rule: 'Любит узкие технические туннели и глухие коридоры, старается избегать открытых залов; роет у стен.',
    floorFit: 'Узкие переходы Коллекторов, технические щели Квартир и Жилой зоны.',
    floors: [FloorLevel.MAINTENANCE, FloorLevel.KVARTIRY, FloorLevel.LIVING],
    rooms: [RoomType.CORRIDOR, RoomType.STORAGE, RoomType.PRODUCTION],
    spawnWeight: 1.5,
    minSamosborCount: 1,
    rare: false,
    lootHint: 'мелкие детали, гайки, провода, изолента, арматура',
    counterplay: 'Не деритесь в узком туннеле: выманите на открытое пространство. Маленький и быстрый — дробовик решает.',
    deathLogHint: 'Смерть от гнома должна указывать на зажатость в узком туннеле или промах по мелкой цели.',
    rumorIds: ['ecology_gnome_tunnels'],
    rareDrops: [{ itemId: 'rebar', chance: 0.08 }, { itemId: 'wire_coil', chance: 0.05 }],
  },
  {
    kind: MonsterKind.ZOMBIE,
    role: 'Бывший жилец, опасный в толпе, кухне и дверном заторе.',
    cue: 'Сосед идет без взгляда, толпа расступается поздно, хват появляется у двери.',
    rule: 'Один мертвяк читается, но в людях и дверях хватает раньше, чем его удобно добить.',
    floorFit: 'Жилые, кухонные, общие и офисные комнаты на всех непустотных маршрутах.',
    floors: ALL_BUT_VOID,
    rooms: [RoomType.LIVING, RoomType.KITCHEN, RoomType.COMMON, RoomType.OFFICE],
    spawnWeight: 3.4,
    minSamosborCount: 2,
    rare: false,
    lootHint: 'карманный бытовой хлам, чужая записка, редкие сигареты',
    counterplay: 'Не подпускайте через толпу, кухню или палату: выводите мертвяка на пустой проход и добивайте до первого хвата.',
    deathLogHint: 'Смерть от мертвяка должна показывать, что игрок пустил его в толпу, кухню или дверной хват.',
    rumorIds: ['monster_zombie_human', 'ecology_zombie_neighbor'],
    rareDrops: [{ itemId: 'note', chance: 0.05 }, { itemId: 'cigs', chance: 0.03 }],
  },
  {
    kind: MonsterKind.DIKIY_MERTVYAK,
    role: 'Хрупкий бегун, который превращает очередь, рынок или дверной затор в короткую панику.',
    cue: 'Рваный хрип ускоряется, белые костяшки вынесены вперед, ноги смазаны рывком.',
    rule: 'Разгоняется в узких проходах и рядом с телами; любой ранний урон сбивает моментум до столкновения.',
    floorFit: 'Очереди, жилые коридоры, толкучки и соседские драки Квартир и Жилой зоны.',
    floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING],
    rooms: [RoomType.CORRIDOR, RoomType.COMMON, RoomType.KITCHEN, RoomType.LIVING],
    spawnWeight: 2.15,
    minSamosborCount: 1,
    rare: false,
    lootHint: 'рваная одежда, белые костяшки, мелкий бытовой хлам',
    counterplay: 'Бейте до разгона или отходите на открытый пол: в одиночку дикий мертвяк хрупок, но в дверях и очереди сбивает толпу.',
    deathLogHint: 'Смерть от дикого мертвяка должна читать бой в дверной толпе или поздний выстрел после разгона.',
    rumorIds: ['monster_dikiy_mertvyak_shove'],
    rareDrops: [{ itemId: 'bandage', chance: 0.035 }, { itemId: 'cigs', chance: 0.02 }],
  },
  {
    kind: MonsterKind.EYE,
    role: 'Дальний враг линии обзора, который ломает открытую коридорную стрельбу.',
    cue: 'Зеленый разогрев, ламповый взгляд и пауза перед болтом.',
    rule: 'Если линия видимости не сломана до вспышки, летит болт; после залпа есть окно сближения.',
    floorFit: 'Коридоры, офисы, производство и поздние открытые комнаты от Министерства до Пустоты.',
    floors: [FloorLevel.MINISTRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL, FloorLevel.VOID],
    rooms: [RoomType.CORRIDOR, RoomType.OFFICE, RoomType.PRODUCTION, RoomType.COMMON],
    spawnWeight: 3.1,
    minSamosborCount: 3,
    rare: false,
    lootHint: 'перегоревшая нить, стеклянная пыль, редкая лампа или ПСИ-пыль',
    counterplay: 'Зеленый разогрев предупреждает выстрел: дверь, угол или колонна до вспышки сбивают залп, после выстрела можно сближаться.',
    deathLogHint: 'Смерть от глаза должна читать открытую линию, поздний угол или сближение до окончания залпа.',
    rumorIds: ['monster_eye_lamps', 'ecology_eye_line'],
    rareDrops: [{ itemId: 'lamp_bulb', chance: 0.05 }, { itemId: 'psi_dust', chance: 0.02 }],
  },
  {
    kind: MonsterKind.LAMPOGLAZ,
    role: 'Стационарный стрелок световой линии, который делает лампу безопасностью и риском одновременно.',
    cue: 'Желтый гул плафона, фарфоровый обод и зеленая точка на освещенной прямой.',
    rule: 'Получает точный захват и больший урон, если цель стоит в светлой клетке или вплотную к лампе; темнота и укрытие сбивают выстрел.',
    floorFit: 'Длинные жилые коридоры, министерские офисные линии и освещенные общие проходы.',
    floors: [FloorLevel.LIVING, FloorLevel.MINISTRY],
    rooms: [RoomType.CORRIDOR, RoomType.OFFICE, RoomType.COMMON],
    spawnWeight: 2.2,
    minSamosborCount: 2,
    rare: false,
    lootHint: 'ламповая линза, фарфоровый ободок, стеклянная пыль, редкий предохранитель',
    counterplay: 'Пересекайте свет быстро, уходите в темный угол или ломайте линию шкафом: без света Лампоглаз теряет захват.',
    deathLogHint: 'Смерть от лампоглаза должна читать стояние под лампой на прямой линии без темного угла или укрытия.',
    rumorIds: ['monster_lampoglaz_hum', 'ecology_lampoglaz_light_lock'],
    rareDrops: [{ itemId: 'lamp_bulb', chance: 0.07 }, { itemId: 'fuse', chance: 0.035 }],
  },
  {
    kind: MonsterKind.CHERNOSLIZ,
    role: 'Темноводная турель-засада, которая наказывает вход в черный лоток без проверки.',
    cue: 'Рябь идет против течения, мутный глаз раскрывает зеленую щель из-под черной пленки.',
    rule: 'Пока чернослиз сидит в темной воде, он почти скрыт; свет, шум, урон или близкий шаг раскрывают первый точный залп.',
    floorFit: 'Черные коллекторские лужи, насосные изгибы, мокрые шкафы проб НИИ и темные обходы.',
    floors: [FloorLevel.MAINTENANCE],
    rooms: [RoomType.CORRIDOR, RoomType.PRODUCTION, RoomType.STORAGE],
    spawnWeight: 1.4,
    minSamosborCount: 2,
    rare: false,
    lootHint: 'проба черной слизи, стеклянная пыль, редкий мутный зрачок',
    counterplay: 'Не входите лицом в черную воду: подсветите лоток, киньте шумовую банку или дайте пробный выстрел, затем выводите его на сухую кромку.',
    deathLogHint: 'Смерть от чернослиза должна читать непроверенную черную воду, открытую линию и отсутствие сухого отхода.',
    rumorIds: ['ecology_chernosliz_wake'],
    rareDrops: [{ itemId: 'slime_sample_black', chance: 0.05 }, { itemId: 'psi_dust', chance: 0.015 }],
  },
  {
    kind: MonsterKind.NIGHTMARE,
    role: 'Редкое давление, где правильный выбор - короткий burst или немедленный уход.',
    cue: 'Мысли громче сирены, комната кажется теснее, выход за спиной становится важным.',
    rule: 'Длинный бой усиливает давление; победа требует тяжелого урона сразу или отказа от комнаты.',
    floorFit: 'Общие, штабные, медицинские и коридорные комнаты на опасных маршрутах всех этажей.',
    floors: [FloorLevel.MINISTRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL, FloorLevel.VOID],
    rooms: [RoomType.COMMON, RoomType.HQ, RoomType.MEDICAL, RoomType.CORRIDOR],
    spawnWeight: 1.4,
    minSamosborCount: 3,
    rare: true,
    lootHint: 'психический налет, ПСИ-пыль, редкий антидепрессант из кармана жертвы',
    counterplay: 'Не играйте в длинный бой: либо сразу тратьте тяжелый урон с выходом за спиной, либо уходите до давления.',
    deathLogHint: 'Смерть от кошмарища должна указывать на затянутый бой без выхода или без тяжелого урона.',
    rumorIds: ['ecology_nightmare_pressure'],
    rareDrops: [{ itemId: 'psi_dust', chance: 0.06 }, { itemId: 'antidep', chance: 0.02 }],
  },
  {
    kind: MonsterKind.SOBRANNYY,
    role: 'Редкий постсамосборный композит из убежища, где бой, изоляция и доклад равны по смыслу.',
    cue: 'За гермодверью шевелится один тяжелый силуэт с несколькими головами и общим пальто.',
    rule: 'Спит в трансе, просыпается от близости, шума или урона, растет от серии попаданий и убийств; слизь или гермодверь срывают погоню.',
    floorFit: 'Производственные комнаты, склады, бункеры и запечатанные укрытия Жилой зоны, Коллекторов и Ада.',
    floors: [FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL],
    rooms: [RoomType.PRODUCTION, RoomType.STORAGE, RoomType.COMMON, RoomType.CORRIDOR],
    spawnWeight: 0.28,
    minSamosborCount: 5,
    rare: true,
    lootHint: 'обгоревшая ткань убежища, костяные швы, редкий гермосписок пропавших',
    counterplay: 'Не будите без выхода: мелкая стрельба только заводит рост. Дробь и огонь режут темп, токсичная слизь или закрытая гермодверь дают изоляцию вместо убийства.',
    deathLogHint: 'Смерть от собранного должна указывать на бой без выхода, игнор роста или попытку удержать один проем телом.',
    rumorIds: ['ecology_sobrannyy_shelter'],
    rareDrops: [{ itemId: 'cloth_roll', chance: 0.05 }, { itemId: 'hermo_gasket', chance: 0.025 }],
  },
  {
    kind: MonsterKind.BORSHCHEVIK,
    role: 'Коридорная растительная блокада: жжет кожу, путает карту семенами и давит слабые швы корнями.',
    cue: 'Высокий зонтик белых семян, желтые капли на стебле и корни, которые уже легли поперек прохода.',
    rule: 'Почти не ходит: держит маршрут телом, соком и семенным облаком. Рубка чистит путь тише, огонь убивает быстро, но дает дым.',
    floorFit: 'Сервисные коридоры, грибные биотопы, склады борщеводов и заброшенные влажные комнаты Жилой зоны и Коллекторов.',
    floors: [FloorLevel.LIVING, FloorLevel.MAINTENANCE],
    rooms: [RoomType.CORRIDOR, RoomType.PRODUCTION, RoomType.STORAGE, RoomType.COMMON],
    spawnWeight: 1.15,
    minSamosborCount: 2,
    rare: false,
    lootHint: 'семенной зонтик, желтый сок, сухой фильтр, редкая противогрибковая мазь',
    counterplay: 'Не входите в зонтик: режущий инструмент открывает путь без дыма, огонь убивает быстрее, но требует отойти от семенного облака; сухой обход часто дешевле.',
    deathLogHint: 'Смерть от борщевика должна читать стояние в соке, пожар без отхода или попытку протиснуться через зонтик без защиты.',
    rumorIds: ['ecology_borshchevik_sap', 'lead_maintenance_borshchevik_blockade'],
    rareDrops: [{ itemId: 'antifungal_ointment', chance: 0.045 }, { itemId: 'gasmask_filter', chance: 0.025 }],
  },
  {
    kind: MonsterKind.SHADOW,
    role: 'Темный ambush-монстр, который проверяет свет, движение и широкий отход.',
    cue: 'Силуэт сжимается в темном углу, тень остается после тела, воздух холодеет.',
    rule: 'В темноте готовит рывок; свет, фонарь, шаг назад или открытое место срывают удар.',
    floorFit: 'Коридоры, курилки, офисы и общие комнаты гражданских этажей, Ада и Пустоты.',
    floors: [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.HELL, FloorLevel.VOID],
    rooms: [RoomType.CORRIDOR, RoomType.SMOKING, RoomType.OFFICE, RoomType.COMMON],
    spawnWeight: 3.6,
    minSamosborCount: 2,
    rare: false,
    lootHint: 'темный след, холодная пыль, редкий странный сгусток',
    counterplay: 'В темноте теневик делает короткий рывок перед ударом. Свет, фонарь или шаг назад срывают рывок и режут урон.',
    deathLogHint: 'Смерть от теневика должна объяснять темный угол, отсутствие света или шаг в упор вместо отхода.',
    rumorIds: ['monster_shadow_silence', 'ecology_shadow_afterimage'],
    rareDrops: [{ itemId: 'strange_clot', chance: 0.03 }],
  },
  {
    kind: MonsterKind.GLUBINNAYA_TEN,
    role: 'Глубинный темный засадник, который наказывает погоню за первым силуэтом вторым телом.',
    cue: 'Черный силуэт отскакивает, а позади на один удар остается более бледный торс.',
    rule: 'Первый темный рывок ставит afterimage-якорь; если цель идет к нему в темноте, второй темп бьет сбоку, а свет или стояние на месте гасят ловушку.',
    floorFit: 'Глубокие туманные выходы, пустотные швы, культовые коридоры и темные алтари Ада и Пустоты.',
    floors: [FloorLevel.HELL, FloorLevel.VOID],
    rooms: [RoomType.CORRIDOR, RoomType.COMMON, RoomType.HQ, RoomType.STORAGE],
    spawnWeight: 0.62,
    minSamosborCount: 3,
    rare: false,
    lootHint: 'холодная пыль, темный след, редкий странный сгусток из второго силуэта',
    counterplay: 'Не догоняйте первый силуэт: стойте на месте, держите светлый выход за спиной или вскройте настоящее тело фонарем до второго удара.',
    deathLogHint: 'Смерть от глубинной тени должна читать погоню за afterimage в темноту без света или удержанного выхода.',
    rumorIds: ['monster_glubinnaya_ten_second_beat', 'ecology_glubinnaya_ten_afterimage'],
    rareDrops: [{ itemId: 'strange_clot', chance: 0.035 }, { itemId: 'psi_dust', chance: 0.015 }],
  },
  {
    kind: MonsterKind.LISHENNYY,
    role: 'Глубинный страж света: превращает фонарь из чистой защиты в приманку и маршрутный риск.',
    cue: 'Черное человеческое отсутствие с серой пепельной кромкой тянется к ближайшему свету.',
    rule: 'Ищет активный свет в ограниченном радиусе: фонарь, УФ, лампу, свечу или брошенный светящийся предмет. Контакт дает короткий распад HP и нужд.',
    floorFit: 'Темный отсек, Пустота, адские швы, глубокие туманные выходы и отрицательные маршрутные этажи.',
    floors: [FloorLevel.HELL, FloorLevel.VOID],
    rooms: [RoomType.CORRIDOR, RoomType.COMMON, RoomType.HQ, RoomType.STORAGE],
    spawnWeight: 0.58,
    minSamosborCount: 4,
    rare: false,
    lootHint: 'пепельная пыль, черный след, редкий странный сгусток',
    counterplay: 'Свет ведет Лишенного: бросьте фонарь или истотитную свечу как приманку, выключайте луч перед поворотом, УФ дает короткий разрыв, а контакт быстро сушит тело.',
    deathLogHint: 'Смерть от Лишенного должна читать слишком долгий контакт со светом в руке или отказ от световой приманки.',
    rumorIds: ['monster_lishennyy_light_lure', 'ecology_lishennyy_contact_decay'],
    rareDrops: [{ itemId: 'strange_clot', chance: 0.035 }, { itemId: 'psi_dust', chance: 0.02 }],
  },
  {
    kind: MonsterKind.TONKAYA_TEN,
    role: 'Трусливая приманка, которая отступает к темной линии и бьет только за погоню.',
    cue: 'Игольная тень стоит спиной, локти указывают в коридор, шаг назад слишком охотный.',
    rule: 'Выбирает рядом темный коридор или дверную линию, держится видимой и получает один фланговый удар, если цель пересекает подготовленную линию.',
    floorFit: 'Темные коридоры, дверные повороты, офисные и квартирные изгибы Министерства, Жилой зоны и редких пустотных маршрутов.',
    floors: [FloorLevel.MINISTRY, FloorLevel.LIVING, FloorLevel.VOID],
    rooms: [RoomType.CORRIDOR, RoomType.OFFICE, RoomType.LIVING, RoomType.COMMON],
    spawnWeight: 1.15,
    minSamosborCount: 2,
    rare: false,
    lootHint: 'холодная пыль, узкий темный след, редкий странный сгусток',
    counterplay: 'Не гонитесь за тонкой тенью: стойте на месте, шумите или включайте свет. Без погони она теряет нерв, возвращается и остается слабой.',
    deathLogHint: 'Смерть от тонкой тени должна читать погоню в темный коридор, а не силу удара в открытом месте.',
    rumorIds: ['monster_tonkaya_ten_follow'],
    rareDrops: [{ itemId: 'strange_clot', chance: 0.02 }],
  },
  {
    kind: MonsterKind.REBAR,
    role: 'Складской debris-lurker, который притворяется ровным железом у стен.',
    cue: 'Ровная арматура лежит слишком тихо, металл звенит до удара, пол отмечен резами.',
    rule: 'У стен, стеллажей и станков быстрее выходит из укрытия; в центре лучше читается и расстреливается.',
    floorFit: 'Производство, склады и коридоры Жилой зоны, Коллекторов, Ада и Пустоты.',
    floors: [FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL, FloorLevel.VOID],
    rooms: [RoomType.PRODUCTION, RoomType.STORAGE, RoomType.CORRIDOR],
    spawnWeight: 1.1,
    minSamosborCount: 5,
    rare: true,
    lootHint: 'тяжелый металл, витая проволока, редкий годный прут арматуры',
    counterplay: 'Обходите ровное железо у стен и складов: арматура звенит перед ударом, а дистанция лучше рукопашной.',
    deathLogHint: 'Смерть от арматуры должна указывать на наступание на ровный металл, стену или складскую стойку.',
    rumorIds: ['monster_rebar_metal', 'ecology_rebar_still'],
    rareDrops: [{ itemId: 'rebar', chance: 0.08 }, { itemId: 'wire_coil', chance: 0.04 }],
  },
  {
    kind: MonsterKind.RZHAVNIK,
    role: 'Складской scrap-ambusher: полезный металл, который наказывает быстрый сбор хабара.',
    cue: 'Слишком ровная стопка ржавых прутьев у стеллажа, пыль без следов и масляная лужица под железом.',
    rule: 'Спит в складском мусоре, просыпается от близкого шага, громкого металла или выстрела; первый рывок силен, дальше корпус хрупкий.',
    floorFit: 'Склады, ремонтные ниши, кабельные и трубные клетки Жилой зоны и Коллекторов.',
    floors: [FloorLevel.LIVING, FloorLevel.MAINTENANCE],
    rooms: [RoomType.STORAGE, RoomType.PRODUCTION, RoomType.CORRIDOR],
    spawnWeight: 0.85,
    minSamosborCount: 2,
    rare: false,
    lootHint: 'ржавчина, черная масляная ветошь, обломок арматуры, редкий годный прут',
    counterplay: 'Не хватайте ровную стопку железа у стеллажа сразу: ткните или стрельните издали, держите две клетки и добивайте после первого рывка.',
    deathLogHint: 'Смерть от ржавника должна читать жадный шаг к ровному металлу, бой у стеллажа или пропущенный первый рывок.',
    rumorIds: ['monster_rzhavnik_scrap', 'ecology_rzhavnik_first_leap'],
    rareDrops: [{ itemId: 'rebar', chance: 0.05 }, { itemId: 'wire_coil', chance: 0.04 }],
  },
  {
    kind: MonsterKind.ZAKALENNAYA_ARMATURA,
    role: 'Медленный бронированный melee-элитник, который запрещает слабый размен.',
    cue: 'Темная сталь, бетонные плечи и оранжевые трещины; после тяжелого попадания плиты осыпаются.',
    rule: 'Пока броня на месте, ножи и слабые пули почти не двигают бой; дробь, кувалда, взрыв или тяжелый выстрел срывают бронеплиты.',
    floorFit: 'Машинные, складские и глубокие сервисные комнаты Коллекторов и Ада.',
    floors: [FloorLevel.MAINTENANCE, FloorLevel.HELL],
    rooms: [RoomType.PRODUCTION, RoomType.STORAGE, RoomType.CORRIDOR],
    spawnWeight: 0.28,
    minSamosborCount: 5,
    rare: true,
    lootHint: 'закаленный прут, бетонная окалина, обломок бронеплиты',
    counterplay: 'Не ножом и не паническим пистолетом: держите дистанцию, заводите вокруг станка или стеллажа и срывайте броню дробью, кувалдой, гранатой или тяжелым выстрелом.',
    deathLogHint: 'Смерть от закаленной арматуры должна читать слабый размен в упор без дистанции, препятствия или тяжелого stagger-удара.',
    rumorIds: ['monster_zakalennaya_armatura_armor', 'ecology_zakalennaya_armatura_heavy_hit'],
    rareDrops: [{ itemId: 'rebar', chance: 0.1 }, { itemId: 'metal_sheet', chance: 0.05 }],
  },
  {
    kind: MonsterKind.MATKA,
    role: 'Spawner-boss, где игрок выбирает: убить источник, чистить приплод или уйти.',
    cue: 'Мокрые удары за стеной, приплод у входа, комната звучит как гнездо.',
    rule: 'Если тянуть бой, capped-приплод заполняет проход и превращает отход в задачу.',
    floorFit: 'Штабные, общие и производственные комнаты Коллекторов, Ада и Пустоты.',
    floors: [FloorLevel.MAINTENANCE, FloorLevel.HELL, FloorLevel.VOID],
    rooms: [RoomType.HQ, RoomType.COMMON, RoomType.PRODUCTION, RoomType.CORRIDOR],
    spawnWeight: 0.45,
    minSamosborCount: 4,
    rare: true,
    lootHint: 'маточный узел, теплая слизь, редкая мясная руна после зачистки',
    counterplay: 'Сначала решите: быстро убить матку или чистить приплод. Если тянуть оба плана, комната заполнится приплодом и отход станет тесным.',
    deathLogHint: 'Смерть от матки должна читать смешанный план: игрок не убил источник, не чистил приплод и потерял отход.',
    rumorIds: ['monster_matka_spawn', 'ecology_matka_children'],
    rareDrops: [{ itemId: 'meat_rune', chance: 0.05 }, { itemId: 'rawmeat', chance: 0.12 }],
  },
  {
    kind: MonsterKind.KHOROVAYA_MATKA,
    role: 'Адский источник приплода: объявляет ограниченные волны мокрым хором.',
    cue: 'Детские лица открываются одно за другим, стена поёт мокро, потом рядом с источником падают маленькие тела.',
    rule: 'Хоровой отсчёт даёт ограниченную волну приплода; зачистка детей открывает короткое окно урона до следующего куплета.',
    floorFit: 'Мясные комнаты, культовые хоровые сборы, алтарные маршруты и глубокие органические коридоры Ада.',
    floors: [FloorLevel.HELL],
    rooms: [RoomType.HQ, RoomType.COMMON, RoomType.PRODUCTION, RoomType.CORRIDOR],
    spawnWeight: 0.34,
    minSamosborCount: 5,
    rare: true,
    lootHint: 'хоровой маточный узел, серая мембрана, редкая мясная руна после сорванного припева',
    counterplay: 'Считайте припев: убивайте источник до вывода, чистите детей ради короткого окна урона или уходите, пока кап приплода не забил маршрут.',
    deathLogHint: 'Смерть от хоровой матки должна читать промедление: припев услышан, дети не вычищены, окно урона пропущено.',
    rumorIds: ['monster_khorovaya_matka_choir', 'ecology_khorovaya_matka_window'],
    rareDrops: [{ itemId: 'meat_rune', chance: 0.06 }, { itemId: 'rawmeat', chance: 0.16 }, { itemId: 'fibrous_capsule_cut', chance: 0.025 }],
  },
  {
    kind: MonsterKind.IDOL,
    role: 'Неподвижная ПСИ-турель, которая наказывает среднюю дистанцию.',
    cue: 'Черная фигурка смотрит даже спиной, воздух щелкает перед ПСИ-выстрелом.',
    rule: 'Не двигается, но держит открытую среднюю линию; угол, дверь или упор ломают задачу.',
    floorFit: 'Офисы, склады, курилки и штабы Министерства, Жилой зоны, Ада и Пустоты.',
    floors: [FloorLevel.MINISTRY, FloorLevel.LIVING, FloorLevel.HELL, FloorLevel.VOID],
    rooms: [RoomType.STORAGE, RoomType.OFFICE, RoomType.SMOKING, RoomType.HQ],
    spawnWeight: 0.9,
    minSamosborCount: 3,
    rare: true,
    lootHint: 'ПСИ-пыль, холодный культовый камень, редкий идол Чернобога или меточный сгусток',
    counterplay: 'Не стойте на средней дистанции: сбивайте угол выстрела или входите в упор к неподвижному идолу.',
    deathLogHint: 'Смерть от идола должна указывать на открытую среднюю дистанцию вместо угла, двери или упора.',
    rumorIds: ['monster_idol_static', 'ecology_idol_stares'],
    rareDrops: [{ itemId: 'idol_chernobog', chance: 0.03 }, { itemId: 'psi_mark', chance: 0.015 }],
  },
  {
    kind: MonsterKind.KANTSELYARSKIY_IDOL,
    role: 'Стационарная министерская офисная турель, которая превращает столы, шкафы и формы в ПСИ-линию.',
    cue: 'Черная фигура срослась со столом, желтые листы вытягиваются в линию, красная печать собирает ложное лицо.',
    rule: 'Офисное поле усиливает дальность и урон у столов, шкафов, архивов и целей с бумагами; упор, шкаф или стена срывают выстрел.',
    floorFit: 'Офисные коридоры, архивные картотеки, приемные и регистрационные комнаты Министерства.',
    floors: [FloorLevel.MINISTRY],
    rooms: [RoomType.OFFICE, RoomType.STORAGE, RoomType.COMMON, RoomType.CORRIDOR],
    spawnWeight: 0.68,
    minSamosborCount: 2,
    rare: true,
    lootHint: 'желтая бумажная пыль, грязный латунный уголок, обломок красной печати',
    counterplay: 'Не стойте на открытой офисной линии с бумагами: шкаф, стена или упор срывают поле, а после залпа есть окно для сближения.',
    deathLogHint: 'Смерть от Канцелярского Идола должна читать открытую линию кабинета, бумаги в кармане и пропущенное окно после залпа.',
    rumorIds: ['monster_kantselyarskiy_idol_line', 'ecology_kantselyarskiy_idol_office_field'],
    rareDrops: [{ itemId: 'blank_form', chance: 0.07 }, { itemId: 'psi_dust', chance: 0.02 }, { itemId: 'seal_wax', chance: 0.04 }],
  },
  {
    kind: MonsterKind.MANCOBUS,
    role: 'Командирская тяжелая угроза: охрана плюс секторный дальний бой.',
    cue: 'Мелочь вокруг начинает действовать организованно, тяжелый корпус держит прямой сектор.',
    rule: 'Сначала снять охрану и разбить линию колонной; прямой вход кормит залпы и окружение.',
    floorFit: 'Производственные, штабные и общие комнаты Коллекторов и Ада.',
    floors: [FloorLevel.MAINTENANCE, FloorLevel.HELL],
    rooms: [RoomType.HQ, RoomType.PRODUCTION, RoomType.COMMON],
    spawnWeight: 0.32,
    minSamosborCount: 6,
    rare: true,
    lootHint: 'жирный металл, командная органика, энергоячейка, бутылка с голосом',
    counterplay: 'Сначала снимайте охрану, затем бейте с углов между залпами: стены и колонны ломают прямой сектор Манкобуса.',
    deathLogHint: 'Смерть от манкобуса должна объяснять прямой сектор, живую охрану или отсутствие укрытия между залпами.',
    rumorIds: ['ecology_mancobus_orders'],
    rareDrops: [{ itemId: 'ammo_energy', chance: 0.08 }, { itemId: 'bottled_voice', chance: 0.03 }],
  },
  {
    kind: MonsterKind.HERALD,
    role: 'Hell watcher: открытая линия, потолочный голос и наказание за задержку.',
    cue: 'Сверху шепчет сирена, потолок следит, проход становится слишком открытым.',
    rule: 'Держит линию и слушание; дверь, угол или колонна между залпами важнее дуэли.',
    floorFit: 'Пороговые общие, штабные и коридорные зоны Мясного низа.',
    floors: [FloorLevel.HELL],
    rooms: [RoomType.COMMON, RoomType.HQ, RoomType.CORRIDOR],
    spawnWeight: 0.28,
    minSamosborCount: 5,
    rare: true,
    lootHint: 'осколок сирены, бирка порога, бутылка с голосом',
    counterplay: 'Держите дверь, угол или колонну между залпами: Вестник наказывает открытую линию и тех, кто слишком долго слушает.',
    deathLogHint: 'Смерть от вестника должна указывать на открытый коридор, отсутствие укрытия или слишком долгое слушание.',
    rumorIds: ['ecology_herald_ceiling'],
    rareDrops: [{ itemId: 'siren_shard', chance: 0.06 }, { itemId: 'bottled_voice', chance: 0.04 }],
  },
  {
    kind: MonsterKind.CREATOR,
    role: 'Финальный void-босс: ресурс, укрытие и зеленый контур как экзамен.',
    cue: 'Белый силуэт правит расстояние, зеленый свет отмечает ошибочный путь.',
    rule: 'Открытая линия и пустой запас проигрывают; укрытие между залпами и выход за спиной решают бой.',
    floorFit: 'Финальные общие и штабные пространства Пустоты.',
    floors: [FloorLevel.VOID],
    rooms: [RoomType.COMMON, RoomType.HQ],
    spawnWeight: 0,
    minSamosborCount: 99,
    rare: true,
    lootHint: 'пустотный шип, белая пыль, пустая квитанция протокола',
    counterplay: 'Входите с полным запасом: держите укрытие между залпами, уходите из зеленого света и не тратьте рывок без выхода.',
    deathLogHint: 'Смерть от Творца должна читать пустой запас, стояние в зеленом свете или рывок без выхода.',
    rumorIds: ['ecology_creator_white'],
    rareDrops: [{ itemId: 'void_spike', chance: 0.12 }],
  },
  {
    kind: MonsterKind.SAFEGUARD,
    role: 'Быстрый late-game охранитель НЕТ/БЛЕЙМ-ветки с коротким клинковым windup.',
    cue: 'Белый человекообразный корпус замирает, красно-циановая щель пишет отказ, клинки расходятся до рывка.',
    rule: 'Очень быстр, но режет честно: стена, дверь, машина или аппарат рвут линию, дробь сбивает замах.',
    floorFit: 'Редкие глубокие офисы, штабы, производства и коридоры Коллекторов и Пустоты, плюс терминальный backlash.',
    floors: [FloorLevel.MAINTENANCE, FloorLevel.VOID],
    rooms: [RoomType.OFFICE, RoomType.HQ, RoomType.PRODUCTION, RoomType.CORRIDOR],
    spawnWeight: 0.18,
    minSamosborCount: 7,
    rare: true,
    lootHint: 'белая пластина, черный суставной штифт, редкая плата отказа',
    counterplay: 'Не принимайте его в прямом коридоре: ломайте линию стеной, дверью, машиной или аппаратом, а дробью сбивайте короткий замах.',
    deathLogHint: 'Смерть от сейфгарда должна указывать на прямой коридор, открытый терминал или несбитый белый замах.',
    rumorIds: ['monster_safeguard_access_denied', 'ecology_safeguard_windup', 'ecology_safeguard_shotgun'],
    rareDrops: [{ itemId: 'circuit_board', chance: 0.07 }, { itemId: 'relay_diagram', chance: 0.03 }],
  },
  {
    kind: MonsterKind.SPIRIT,
    role: 'Фазирующий преследователь, который отменяет привычную безопасность двери и стены.',
    cue: 'Холодный сквозняк идет против двери, лицо-череп появляется не с той стороны стены.',
    rule: 'Стены не держат контакт; спасает смена позиции, дистанция и сбитый УФ-светом темп.',
    floorFit: 'Коридоры, офисы, штабы и общие пространства Министерства, Ада и Пустоты.',
    floors: [FloorLevel.MINISTRY, FloorLevel.HELL, FloorLevel.VOID],
    rooms: [RoomType.CORRIDOR, RoomType.OFFICE, RoomType.HQ, RoomType.COMMON],
    spawnWeight: 1.1,
    minSamosborCount: 4,
    rare: true,
    lootHint: 'пустая записка, холодный сквозняк, редкая ПСИ-пыль',
    counterplay: 'Меняйте позицию до контакта: двери и стены духа не держат, помогает дистанция и сбитый УФ-светом темп.',
    deathLogHint: 'Смерть от духа должна объяснять попытку закрыться дверью или стеной вместо смены позиции.',
    rumorIds: ['ecology_spirit_wall'],
    rareDrops: [{ itemId: 'psi_dust', chance: 0.05 }, { itemId: 'void_spike', chance: 0.015 }],
  },
  {
    kind: MonsterKind.LOZHNYY_DUKH,
    role: 'Дверной фланкер, который ломает привычку пережидать угрозу за закрытой створкой.',
    cue: 'Холодный сквозняк идет из дверной щели, тело наклоняется через косяк до перехода.',
    rule: 'После предупреждения делает один локальный проход через закрытую дверь; затем долго не повторяет фазу и слабеет от точного выстрела или УФ.',
    floorFit: 'Офисные двери Министерства, редкие жилые комнаты и пустотные швы с открытым обходом.',
    floors: [FloorLevel.MINISTRY, FloorLevel.LIVING, FloorLevel.VOID],
    rooms: [RoomType.OFFICE, RoomType.CORRIDOR, RoomType.LIVING, RoomType.COMMON],
    spawnWeight: 0.72,
    minSamosborCount: 3,
    rare: true,
    lootHint: 'пустая записка, холодный сквозняк, редкая ПСИ-пыль из второго лица',
    counterplay: 'Не ждите за одной дверью: после холодного сквозняка выходите в открытое место или сбивайте фазу точным выстрелом/УФ.',
    deathLogHint: 'Смерть от Ложного Духа должна указывать на ставку в закрытую дверь вместо смены позиции после сквозняка.',
    rumorIds: ['ecology_lozhnyy_dukh_door'],
    rareDrops: [{ itemId: 'psi_dust', chance: 0.05 }, { itemId: 'blank_form', chance: 0.03 }],
  },
  {
    kind: MonsterKind.ROBOT,
    role: 'Индустриальный дальний автомат, который проверяет прямую линию и паузу после залпа.',
    cue: 'Плазма заряжается, мокрый проход гудит, корпус замирает перед выстрелом.',
    rule: 'Прямая линия опасна, особенно в воде; после залпа есть короткая пауза для захода.',
    floorFit: 'Производственные, штабные, коридорные и офисные зоны Министерства и Коллекторов.',
    floors: [FloorLevel.MINISTRY, FloorLevel.MAINTENANCE],
    rooms: [RoomType.PRODUCTION, RoomType.HQ, RoomType.CORRIDOR, RoomType.OFFICE],
    spawnWeight: 1.4,
    minSamosborCount: 3,
    rare: true,
    lootHint: 'электронный лом, плата, проводка, редкая энергоячейка',
    counterplay: 'Уходите с прямой линии плазмы и бейте после залпа. В мокром проходе не стойте: там плазменный луч попадает чаще.',
    deathLogHint: 'Смерть от робота должна указывать на мокрую прямую линию или вход до паузы после плазмы.',
    rumorIds: ['ecology_robot_plasma'],
    rareDrops: [{ itemId: 'ammo_energy', chance: 0.07 }, { itemId: 'circuit_board', chance: 0.06 }],
  },
  {
    kind: MonsterKind.TRUBNYY_AVTOMAT,
    role: 'Коридорный сервис-автомат, который закрывает длинную мокрую прямую и затем остывает.',
    cue: 'Синие трубные кольца ярчают, вода по линии гудит, белый сердечник держит одну ось.',
    rule: 'Стреляет только по коротко проверенной мокрой линии; сухой шаг, угол или фланг срывают заряд, а после залпа есть длинное окно.',
    floorFit: 'Мокрые сервисные коридоры, насосные, трубные мосты и машинные линии Коллекторов.',
    floors: [FloorLevel.MAINTENANCE],
    rooms: [RoomType.CORRIDOR, RoomType.PRODUCTION, RoomType.STORAGE],
    spawnWeight: 1.25,
    minSamosborCount: 2,
    rare: true,
    lootHint: 'мокрая плата, трубные кольца, обожженный манометр, редкая энергоячейка',
    counterplay: 'Сойдите с мокрой прямой до вспышки: автомат не ведет сухой фланг, а после выстрела долго остывает для упора или обхода.',
    deathLogHint: 'Смерть от Трубного Автомата должна читать стояние на мокрой прямой и пропущенное окно остывания.',
    rumorIds: ['ecology_trubnyy_avtomat_wet_line'],
    rareDrops: [{ itemId: 'circuit_board', chance: 0.08 }, { itemId: 'ammo_energy', chance: 0.05 }, { itemId: 'manometer', chance: 0.04 }],
  },
  {
    kind: MonsterKind.SHOVNIK,
    role: 'Охотник по швам, который делает стену плохим местом для рукопашной.',
    cue: 'Белый шов пахнет резиной, стена щелкает, силуэт скользит вдоль панели.',
    rule: 'У стены и шва ускоряется и бьет больнее; в центре комнаты теряет ход.',
    floorFit: 'Гражданские коридоры, жилые, офисные и общие комнаты.',
    floors: CIVIL,
    rooms: [RoomType.CORRIDOR, RoomType.LIVING, RoomType.OFFICE, RoomType.COMMON],
    spawnWeight: 3.2,
    minSamosborCount: 2,
    rare: false,
    lootHint: 'резиновая крошка, герметичный мусор, редкий гермоуплотнитель',
    counterplay: 'Выводите в центр комнаты: у стен и швов шовник быстрее и больнее бьет, без кромки теряет ход.',
    deathLogHint: 'Смерть от шовника должна читать бой у стены или шва вместо вывода в центр.',
    rumorIds: ['ecology_shovnik_seams'],
    rareDrops: [{ itemId: 'hermo_gasket', chance: 0.05 }, { itemId: 'sealant_tube', chance: 0.03 }],
  },
  {
    kind: MonsterKind.LAMPOVY,
    role: 'Световой паразит, который превращает лампу в опасную позицию.',
    cue: 'Лампа гудит как зуб, озон висит в проходе, силуэт держится у света.',
    rule: 'Рядом с лампой бьет сильнее; три клетки, темный коридор, угол или выключатель режут преимущество.',
    floorFit: 'Освещенные коридоры, офисы, общие и производственные комнаты до Коллекторов.',
    floors: [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE],
    rooms: [RoomType.CORRIDOR, RoomType.OFFICE, RoomType.COMMON, RoomType.PRODUCTION],
    spawnWeight: 2.8,
    minSamosborCount: 2,
    rare: false,
    lootHint: 'перегоревшая нить, стекло, запах озона, редкий предохранитель',
    counterplay: 'Не деритесь под лампой: отведите его на три клетки от света, в темный коридор или за угол.',
    deathLogHint: 'Смерть от лампового должна указывать на бой под лампой без отхода, угла или выключателя.',
    rumorIds: ['ecology_lampovy_light'],
    rareDrops: [{ itemId: 'lamp_bulb', chance: 0.06 }, { itemId: 'fuse', chance: 0.04 }],
  },
  {
    kind: MonsterKind.PECHATEED,
    role: 'Бумажный хищник, который делает документы боевым запахом.',
    cue: 'Кислые чернила, шелест без бумаги, печать облизывает воздух рядом с карманом.',
    rule: 'Дальше чует цели с документами; контейнер, сброс лишних бумаг и углы сокращают преследование.',
    floorFit: 'Офисы, общие, курилки и коридоры гражданских этажей.',
    floors: CIVIL,
    rooms: [RoomType.OFFICE, RoomType.COMMON, RoomType.SMOKING, RoomType.CORRIDOR],
    spawnWeight: 2.6,
    minSamosborCount: 2,
    rare: false,
    lootHint: 'обглоданный бланк, кислые чернила, пустой формуляр без подписи',
    counterplay: 'Сбросьте лишние записки, бланки и ключи в ящик: с бумажным запахом печатеед чует дальше, через углы теряет нюх.',
    deathLogHint: 'Смерть от печатееда должна указывать на бумажный запах, неразгруженный инвентарь или прямую погоню без углов.',
    rumorIds: ['ecology_pechateed_docs'],
    rareDrops: [{ itemId: 'ink_bottle', chance: 0.05 }, { itemId: 'blank_form', chance: 0.04 }],
  },
  {
    kind: MonsterKind.KONTORSHCHIK,
    role: 'Министерский мертвый клерк, который превращает жадность к бумагам в шум и хват.',
    cue: 'Серый пиджак, желтая папка на груди, полосы бумаги с красными печатями тянутся к карману.',
    rule: 'Без документов медленный; с бланками, пропусками и печатями чует дальше, ускоряется и помечает бумагу шумной канцелярской меткой.',
    floorFit: 'Архивы, картотеки, столы форм, очереди и кабинетные коридоры Министерства; редко забредает в жилые офисные углы.',
    floors: [FloorLevel.MINISTRY, FloorLevel.LIVING],
    rooms: [RoomType.OFFICE, RoomType.STORAGE, RoomType.COMMON, RoomType.CORRIDOR],
    spawnWeight: 0.95,
    minSamosborCount: 2,
    rare: true,
    lootHint: 'желтая папка, красная печать на рукаве, редкий пустой бланк',
    counterplay: 'Не несите пачку форм в ближний бой: сложите дорогие бумаги в контейнер, бросьте дешевый бланк как приманку и рвите хват у шкафа или стола.',
    deathLogHint: 'Смерть от конторщика должна читать документы в инвентаре, поздний сброс бумаги или бой без шкафа рядом.',
    rumorIds: ['ecology_kontorshchik_forms'],
    rareDrops: [{ itemId: 'blank_form', chance: 0.06 }, { itemId: 'official_permit_slip', chance: 0.025 }],
  },
  {
    kind: MonsterKind.PROTOKOLNIK,
    role: 'Министерский ПСИ-хищник, который превращает пачку официальных бумаг в боевое давление.',
    cue: 'Пустое лицо-печать, черная бумажная ряса и красные штампы вокруг кармана.',
    rule: 'Давление растет от времени боя и ценности документов у цели; сброс или тайник режут будущий рост, а быстрый burst или выход из комнаты закрывают протокол.',
    floorFit: 'Архивы, картотеки, регистратуры и залы комиссии Министерства.',
    floors: [FloorLevel.MINISTRY],
    rooms: [RoomType.OFFICE, RoomType.STORAGE, RoomType.COMMON],
    spawnWeight: 0.72,
    minSamosborCount: 3,
    rare: true,
    lootHint: 'испорченный протокол, сургучная крошка, редкая ПСИ-пыль из пустой графы',
    counterplay: 'Не держите полный пакет бумаг в длинном бою: сбросьте документы в ящик, ударьте коротким burst или уходите за дверь до закрытия протокола.',
    deathLogHint: 'Смерть от протокольника должна читать затянутый бой с официальными бумагами и поздний отказ от комнаты.',
    rumorIds: ['ecology_protokolnik_protocol'],
    rareDrops: [{ itemId: 'unsigned_order', chance: 0.06 }, { itemId: 'psi_dust', chance: 0.025 }],
  },
  {
    kind: MonsterKind.TUBE_EEL,
    role: 'Водный pipe-ambusher, который диктует маршрут через сухую кромку.',
    cue: 'Вода щелкает, манометр дрожит, лоток рябит против течения.',
    rule: 'В воде резко ускоряется; сухой край, мост, гарпун и приманка возвращают игроку темп.',
    floorFit: 'Затопленные коридоры, производство, склады и ванные Коллекторов.',
    floors: [FloorLevel.MAINTENANCE],
    rooms: [RoomType.CORRIDOR, RoomType.PRODUCTION, RoomType.STORAGE, RoomType.BATHROOM],
    spawnWeight: 4.3,
    minSamosborCount: 1,
    rare: false,
    lootHint: 'ржавая слизь, манометр, обломок трубы из затопленного лотка',
    counterplay: 'Выходите из воды: сухая кромка и мост режут рывок угря. Гарпун бьет через лоток, приманка уводит с маршрута.',
    deathLogHint: 'Смерть от трубного угря должна читать шаг в воду, отказ от сухой кромки, гарпуна или приманки.',
    rumorIds: ['ecology_eel_water'],
    rareDrops: [{ itemId: 'manometer', chance: 0.05 }, { itemId: 'pipe', chance: 0.03 }],
  },
  {
    kind: MonsterKind.LOTOCHNIK,
    role: 'Мокрый служебный хищник, который делает лоток выбором маршрута, а не плоской водой.',
    cue: 'Плоское тело блестит у кромки, широкие ладони оставляют синие потеки, желтый осадок дрожит на спине.',
    rule: 'В воде получает броню, регенерацию и темп; на сухом бетоне теряет защиту, медлит и оставляет короткий мокрый след.',
    floorFit: 'Дрены, насосные, коллекторы, затопленные коридоры и редкие жилые ванные.',
    floors: [FloorLevel.MAINTENANCE, FloorLevel.LIVING],
    rooms: [RoomType.CORRIDOR, RoomType.PRODUCTION, RoomType.BATHROOM, RoomType.COMMON],
    spawnWeight: 2.1,
    minSamosborCount: 2,
    rare: false,
    lootHint: 'мокрая ветошь, фильтрующий слой, желтый осадок из служебного лотка',
    counterplay: 'Выманивайте его на сухой порог: в воде броня и регенерация держат бой, на бетоне Лоточник медленнее и уязвимее.',
    deathLogHint: 'Смерть от Лоточника должна читать ошибку как бой в воде без сухого порога или поздний отход с мокрого маршрута.',
    rumorIds: ['ecology_lotochnik_drain', 'lead_maintenance_lotochnik_lotok'],
    rareDrops: [{ itemId: 'filter_layer', chance: 0.05 }, { itemId: 'cloth_roll', chance: 0.04 }],
  },
  {
    kind: MonsterKind.VODYANOY_KOSHMAR,
    role: 'ПСИ-хищник водной линии, который наказывает длинный отход по одному мокрому маршруту.',
    cue: 'Рябь идет от темного отражения к игроку, манометр давит без стрелки, вода гудит в голове.',
    rule: 'Если игрок и монстр стоят на связанной мокрой линии, давление растет; сухой бетон рвет линию после короткой паузы.',
    floorFit: 'Насосные, затопленные коридоры, сливные мосты и производственные лотки Коллекторов.',
    floors: [FloorLevel.MAINTENANCE],
    rooms: [RoomType.CORRIDOR, RoomType.PRODUCTION, RoomType.STORAGE, RoomType.BATHROOM],
    spawnWeight: 1.15,
    minSamosborCount: 2,
    rare: false,
    lootHint: 'мокрый ПСИ-налет, вода с привкусом металла, редкая ПСИ-пыль из сливного лица',
    counterplay: 'Не пятитесь по мокрой линии: шаг на сухой бетон рвет давление, после паузы входите коротким burst или уходите с лотка.',
    deathLogHint: 'Смерть от водяного кошмара должна читать отход по связанной воде вместо шага на сухой бетон.',
    rumorIds: ['ecology_vodyanoy_koshmar_line'],
    rareDrops: [{ itemId: 'metal_water', chance: 0.06 }, { itemId: 'psi_dust', chance: 0.025 }],
  },
  {
    kind: MonsterKind.OLGOY,
    role: 'Тяжелый collector worm: мясо отвлекает, труба делает укус решающим.',
    cue: 'Бледная кишка поднимается из лотка, зубное кольцо раскрывается, кровь у трубы уходит вниз.',
    rule: 'Сухой пол замедляет его, но вода, труба или провал дают тяжелый укус и короткий подтяг к пасти.',
    floorFit: 'Мясные тайники, коллекторные лотки, затопленные лаборатории и адские холодильные комнаты.',
    floors: [FloorLevel.MAINTENANCE, FloorLevel.HELL],
    rooms: [RoomType.CORRIDOR, RoomType.PRODUCTION, RoomType.STORAGE, RoomType.BATHROOM],
    spawnWeight: 0.82,
    minSamosborCount: 2,
    rare: true,
    lootHint: 'бледная шкура, кровяная слизь, редкая мясная руна из пасти коллектора',
    counterplay: 'Уводите бой на сухой открытый пол и бросайте сырое мясо дальше маршрута. У воды, трубы или провала Олгой кусает тяжелее и подтягивает цель.',
    deathLogHint: 'Смерть от Олгой-Хорхоя должна читать мясо в кармане, бой у трубы или отказ от приманки.',
    rumorIds: ['monster_olgoy_meat', 'ecology_olgoy_collector'],
    rareDrops: [{ itemId: 'rawmeat', chance: 0.12 }, { itemId: 'meat_rune', chance: 0.03 }, { itemId: 'fibrous_capsule_cut', chance: 0.02 }],
  },
  {
    kind: MonsterKind.PARAGRAPH,
    role: 'Дальний бюрократический стрелок, где укрытие важнее спора с текстом.',
    cue: 'Формулировка шуршит без бумаги, строка выпрямляется на 15 клеток.',
    rule: 'Стреляет по прямой линии; шкаф, дверь или угол ломают пункт, а после залпа нужно сближаться.',
    floorFit: 'Офисы, штабы, коридоры и общие комнаты Министерства и Пустоты.',
    floors: [FloorLevel.MINISTRY, FloorLevel.VOID],
    rooms: [RoomType.OFFICE, RoomType.HQ, RoomType.CORRIDOR, RoomType.COMMON],
    spawnWeight: 1.5,
    minSamosborCount: 3,
    rare: true,
    lootHint: 'порванный приказ, сургучная пыль, обрывки шевелящегося приказа',
    counterplay: 'Ломайте линию видимости шкафом, дверью или углом и сближайтесь сразу после залпа: в упоре параграф теряет дистанцию.',
    deathLogHint: 'Смерть от параграфа должна указывать на открытую линию текста или чтение приказа без укрытия.',
    rumorIds: ['ecology_paragraph_clause'],
    rareDrops: [{ itemId: 'unsigned_order', chance: 0.05 }, { itemId: 'psi_order_seal', chance: 0.015 }],
  },
  {
    kind: MonsterKind.NELYUD,
    role: 'Ложный человек, который проверяет подозрение, дистанцию, свидетеля и свет.',
    cue: 'Сосед не моргает, отражение не сходится, терпеливо ждет вашего шага.',
    rule: 'Долго похож на человека и раскрывается близко; дистанция, свидетель, свет и свободный выход сохраняют выбор.',
    floorFit: 'Жилые, кухонные, общие и коридорные пространства гражданских этажей.',
    floors: CIVIL,
    rooms: [RoomType.LIVING, RoomType.KITCHEN, RoomType.COMMON, RoomType.CORRIDOR],
    spawnWeight: 1.2,
    minSamosborCount: 3,
    rare: true,
    lootHint: 'фальшивый пропуск, чужой ключ без царапин, редкий детектор нелюдей',
    counterplay: 'Проверяйте дистанцией: нелюдь раскрывается поздно, поэтому не подпускайте слишком спокойного соседа без света и выхода.',
    deathLogHint: 'Смерть от нелюди должна читать доверчивое сближение без света, свидетеля или пути отхода.',
    rumorIds: ['ecology_nelyud_close'],
    rareDrops: [{ itemId: 'fake_pass', chance: 0.04 }, { itemId: 'unpeople_detector', chance: 0.015 }],
  },
  {
    kind: MonsterKind.OBZHIVALSHCHIK,
    role: 'Квартирная аберрация, которая держится своей комнаты и превращает шум соседей в нарастающую стенную органику.',
    cue: 'За закрытой дверью скребут длинные пальцы, глазки краснеют в темноте, на обоях растет бледная слизь.',
    rule: 'Не выходит из домашней комнаты, пока самосбор или высокая злость не сорвут поводок; шум, кража и бой растят злость, доклад или помощь соседям ее сбивают.',
    floorFit: 'Жилые квартиры, ложные безопасные блоки и плотные коммунальные карманы Жилой зоны и Квартир.',
    floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING],
    rooms: [RoomType.LIVING, RoomType.COMMON, RoomType.KITCHEN, RoomType.STORAGE],
    spawnWeight: 0.72,
    minSamosborCount: 1,
    rare: false,
    lootHint: 'домовой мусор, куски мебели, слизь со стены, редкая жалоба соседа',
    counterplay: 'Не ломайте дверь ради любопытства: тишина, доклад или помощь соседям удерживают обживальщика в комнате, а рост на стене нужно чистить до выхода в коридор.',
    deathLogHint: 'Смерть от обживальщика должна читать шум у двери, кражу в квартире или поздний отход после того, как комнатная злость сорвала поводок.',
    rumorIds: ['monster_obzhivalshchik_room', 'ecology_obzhivalshchik_growth'],
    rareDrops: [{ itemId: 'neighbor_complaint', chance: 0.08 }, { itemId: 'sealant_tube', chance: 0.035 }],
  },
  {
    kind: MonsterKind.SLIMEVIK,
    role: 'Нейтральный слизевой падальщик: бартер за зачистку, пробу или безопасный обход.',
    cue: 'Темный носитель несет прозрачный мешок, усики трогают пол и тянутся к пятнам.',
    rule: 'Не охотится первым, идет к слизевым комнатам и пятнам; раненый бежит, а в углу бьет слабой кислотной плетью.',
    floorFit: 'Слизевые комнаты Жилой зоны, Коллекторы и потерянные грибные/самосборные блоки.',
    floors: [FloorLevel.LIVING, FloorLevel.MAINTENANCE],
    rooms: [RoomType.PRODUCTION, RoomType.BATHROOM, RoomType.MEDICAL, RoomType.STORAGE, RoomType.CORRIDOR],
    spawnWeight: 1.15,
    minSamosborCount: 1,
    rare: false,
    lootHint: 'грязная слизь, фильтрующий слой, отмеченная проба рядом с местом кормления',
    counterplay: 'Держите дистанцию без фильтра/тары, кормите едой или лекарством вместо убийства, а раненого не загоняйте в угол.',
    deathLogHint: 'Смерть от слизневика должна читать долгое прижатие без защиты или попытку добить в углу.',
    rumorIds: ['monster_slimevik_bargain', 'lead_maintenance_safe_slimevik'],
    rareDrops: [{ itemId: 'filter_layer', chance: 0.05 }, { itemId: 'slime_sample_brown', chance: 0.04 }],
  },
  {
    kind: MonsterKind.HEAD_SLUG,
    role: 'Редкий паразит носителя: ломает привычную проверку тела, карантина и добивания.',
    cue: 'Над шеей висит мокрый серо-розовый комок, усики держат тело как чужой воротник.',
    rule: 'При развале носителя отделяется, коротко ползет к трупу или оглушенному NPC и пытается занять новое тело; УФ задерживает переползание.',
    floorFit: 'Карантинные палаты, фальшивые медпункты, больничные комнаты после самосбора и гражданские офисы с мертвой очередью.',
    floors: [FloorLevel.LIVING, FloorLevel.KVARTIRY, FloorLevel.MINISTRY, FloorLevel.MAINTENANCE],
    rooms: [RoomType.MEDICAL, RoomType.COMMON, RoomType.OFFICE, RoomType.CORRIDOR, RoomType.STORAGE],
    spawnWeight: 0.36,
    minSamosborCount: 2,
    rare: true,
    lootHint: 'мокрая нервная слизь, карантинная карта, редкая пластинка антибиотика из сорванного носителя',
    counterplay: 'Убейте носителя на дистанции, не стойте рядом с трупами и оглушенными людьми, бейте отделившегося слизня УФ или огнем до переползания.',
    deathLogHint: 'Смерть от головного слизня должна читать недобитого паразита, бой рядом с телами или попытку спасать носителя без карантина.',
    rumorIds: ['monster_head_slug_host', 'ecology_head_slug_rehost'],
    rareDrops: [{ itemId: 'antibiotic', chance: 0.035 }, { itemId: 'quarantine_medcard', chance: 0.025 }],
  },
  {
    kind: MonsterKind.SLIME_WOMAN,
    role: 'Редкий водно-слизевой гуманоид: опасна в лотке и дает выбор между обходом, сушкой и пробой.',
    cue: 'Высокий мокрый силуэт собирается из черной воды, рога темнеют, глаза холодно белеют.',
    rule: 'В воде и активной слизи ускоряется и сильнее хватает; на сухом освещенном бетоне подсыхает, теряет темп и оставляет короткую токсичную пленку.',
    floorFit: 'Коллекторные лотки, затопленные лаборатории, черные слизевые комнаты и редкие пробитые санузлы Жилой зоны.',
    floors: [FloorLevel.MAINTENANCE, FloorLevel.LIVING],
    rooms: [RoomType.BATHROOM, RoomType.PRODUCTION, RoomType.MEDICAL, RoomType.STORAGE, RoomType.CORRIDOR],
    spawnWeight: 0.42,
    minSamosborCount: 3,
    rare: true,
    lootHint: 'проба зеленой или черной слизи в таре НИИ, фильтрующий слой, токсичная пленка после хватки',
    counterplay: 'Не деритесь в воде: выманивайте на сухой освещенный бетон, бейте УФ-импульсом, чистите пленку комплектом или огнем и берите пробу только в тару НИИ.',
    deathLogHint: 'Смерть от жижевой женщины должна читать бой в воде, игнор УФ/сухого края или попытку брать пробу без тары.',
    rumorIds: ['monster_slime_woman_drain', 'ecology_slime_woman_dry_edge', 'lead_maint_slime_woman_sump'],
    rareDrops: [{ itemId: 'slime_sample_green', chance: 0.06 }, { itemId: 'filter_layer', chance: 0.04 }],
  },
  {
    kind: MonsterKind.GNILUSHKA,
    role: 'Редкая нейтральная мутантка: проверяет выдержку, помощь и выбор между пробой, доносом и насилием.',
    cue: 'Тонкая черная женщина с серыми волосами и ветвящимися наростами пятится от света и оружия.',
    rule: 'Не нападает первой: разговаривает, принимает еду/лекарство или тару НИИ, но после удара бежит и режет когтями только в тесном углу.',
    floorFit: 'Потерянные жилые ячейки, ложные безопасные блоки, грибные и самосборные маршруты Жилой зоны и Квартир.',
    floors: [FloorLevel.LIVING, FloorLevel.KVARTIRY],
    rooms: [RoomType.LIVING, RoomType.COMMON, RoomType.STORAGE, RoomType.KITCHEN, RoomType.CORRIDOR],
    spawnWeight: 0.18,
    minSamosborCount: 2,
    rare: true,
    lootHint: 'серо-зеленый соскоб, старая записка, редкий мутный образец после добровольной передачи НИИ',
    counterplay: 'Не загоняйте и не бейте первой: опустите оружие, поговорите, дайте воду/еду/лекарство или тару НИИ; если ранили, оставьте выход вместо боя в углу.',
    deathLogHint: 'Смерть от Гнилушки должна читать нападение первым, погоню в тупик или попытку добить раненую мутантку в тесноте.',
    rumorIds: ['ecology_gnilushka_restraint', 'lead_living_lost_gnilushka_cell'],
    rareDrops: [{ itemId: 'slime_sample_brown', chance: 0.035 }, { itemId: 'note', chance: 0.04 }],
  },
  {
    kind: MonsterKind.SLEPOGLAZ,
    role: 'Слепая дальняя турель, которая стреляет по последнему шуму или старой позиции игрока.',
    cue: 'Запечатанный глаз пульсирует зеленым не в вас, а в место последнего громкого звука.',
    rule: 'Долго заряжает луч в зафиксированную точку; шаг в сторону и рывок после промаха превращают дальнюю смерть в слабый упор.',
    floorFit: 'Длинные технические и мясные коридоры с боковым обходом в Коллекторах и Аду.',
    floors: [FloorLevel.MAINTENANCE, FloorLevel.HELL],
    rooms: [RoomType.CORRIDOR, RoomType.PRODUCTION, RoomType.COMMON],
    spawnWeight: 1.05,
    minSamosborCount: 3,
    rare: false,
    lootHint: 'зеленая стеклянная пыль, серые перепонки, редкий слепой нерв',
    counterplay: 'Шумните или покажитесь, затем шагните с прямой: Слепоглаз стреляет туда, где вы были. После зеленого луча он долго перезаряжается и слаб в упоре.',
    deathLogHint: 'Смерть от слепоглаза должна указывать на стояние в старой шумной позиции и отказ от шага в сторону после зарядки.',
    rumorIds: ['ecology_slepoglaz_last_sound'],
    rareDrops: [{ itemId: 'psi_dust', chance: 0.04 }, { itemId: 'strange_clot', chance: 0.02 }],
  },
  {
    kind: MonsterKind.KOSTOREZ,
    role: 'Элитный windup-рукопашник, которого нужно читать до рывка.',
    cue: 'Пилы поднимаются, воздух скребет, на полу параллельные резы.',
    rule: 'Опасен в конце замаха; три шага, угол, колонна, дробь или бронелист срывают смертельный темп.',
    floorFit: 'Производственные, складские и коридорные зоны Коллекторов и Ада.',
    floors: [FloorLevel.MAINTENANCE, FloorLevel.HELL],
    rooms: [RoomType.PRODUCTION, RoomType.STORAGE, RoomType.CORRIDOR],
    spawnWeight: 0.35,
    minSamosborCount: 6,
    rare: true,
    lootHint: 'резаный металл, бронелист, обломок арматуры',
    counterplay: 'Читайте замах: три шага, угол или колонна отменяют рывок, дробь сбивает пилы, бронелист принимает один рез.',
    deathLogHint: 'Смерть от костореза должна указывать на стояние в замахе без трех шагов, угла, дроби или бронелиста.',
    rumorIds: ['monster_kostorez_cuts', 'ecology_kostorez_windup', 'ecology_kostorez_shotgun', 'lead_maintenance_kostorez_locker'],
    rareDrops: [{ itemId: 'metal_sheet', chance: 0.08 }, { itemId: 'rebar', chance: 0.06 }],
  },
  {
    kind: MonsterKind.BEZEKHIY,
    role: 'Дверной засадник, который убирает привычное эхо и наказывает спину к открытому порогу.',
    cue: 'У двери внезапно нет эха; у кромки кадра белеют пальцы, а серая полоска пола слишком живая.',
    rule: 'Молчит до короткой дистанции; первый бонус теряет от прямого взгляда, закрытой двери или осторожного прохода спиной назад.',
    floorFit: 'Двери, кладовки, квартирные пороги и ложные соседские комнаты Жилой зоны и Квартир, редко Министерства.',
    floors: [FloorLevel.LIVING, FloorLevel.KVARTIRY, FloorLevel.MINISTRY],
    rooms: [RoomType.CORRIDOR, RoomType.LIVING, RoomType.STORAGE, RoomType.COMMON, RoomType.OFFICE],
    spawnWeight: 1.55,
    minSamosborCount: 2,
    rare: false,
    lootHint: 'серый дверной налет, белая ногтевая крошка, редкий шумовой крючок',
    counterplay: 'Проверяйте косяки до обыска, закрывайте дверь за собой и проходите порог спиной назад: прямой взгляд или закрытый проем срывает первый рывок.',
    deathLogHint: 'Смерть от безэхия должна указывать на открытый порог за спиной, поспешный обыск или отказ проверить косяк.',
    rumorIds: ['monster_bezekhiy_dead_echo'],
    rareDrops: [{ itemId: 'wire_coil', chance: 0.035 }, { itemId: 'sealant_tube', chance: 0.02 }],
  },
  {
    kind: MonsterKind.PSEUDOLIFT,
    role: 'Редкая маршрутная ловушка: ложная кабина вместо обычного перехода.',
    cue: 'Табло показывает неверный этаж, металл двери не совпадает с шахтой, у порога влажная красная кромка.',
    rule: 'Не ходит по этажу: осмотр, приманка или отход из тамбура превращают ловушку в выбор маршрута.',
    floorFit: 'Процедурные маршруты, темные метро/служебные этажи и лифтовые аномалии после самосбора.',
    floors: [FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL],
    rooms: [RoomType.CORRIDOR, RoomType.PRODUCTION, RoomType.COMMON],
    spawnWeight: 0,
    minSamosborCount: 1,
    rare: true,
    lootHint: 'кабельный язык, мокрая табличка этажа, редкая живая реле-пластина',
    counterplay: 'Осматривайте табло и мокрый порог, бросайте приманку перед входом или выходите из лифтового тамбура: далеко Псевдолифт не преследует.',
    deathLogHint: 'Смерть от псевдолифта должна читать вход в странную кабину без осмотра, приманки или отхода из тамбура.',
    rumorIds: ['monster_pseudolift_wrong_floor'],
    rareDrops: [{ itemId: 'circuit_board', chance: 0.04 }, { itemId: 'relay_diagram', chance: 0.025 }],
  },
  {
    kind: MonsterKind.BLACK_LIQUIDATOR,
    role: 'Ложный постсамосборный обход, который сначала выглядит как поздняя зачистка.',
    cue: 'Старые черные шинели идут строем, номера на масках не совпадают, красные линзы моргают не как у живых.',
    rule: 'Патруль стучит в двери и держит нейтральную фазу, пока игрок не подходит вплотную, не несет пробу или не открывает герму.',
    floorFit: 'Редкие тяжелые последствия самосбора в жилых, квартальных и министерских коридорах.',
    floors: [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING],
    rooms: [RoomType.CORRIDOR, RoomType.COMMON, RoomType.OFFICE, RoomType.STORAGE],
    spawnWeight: 0.14,
    minSamosborCount: 3,
    rare: true,
    lootHint: 'обугленная бирка, мел с номером, черный крюк из инструментальной сумки',
    counterplay: 'Не открывайте дверь первому обходу после тяжелого отбоя: сверяйте номер маски, убирайте пробы в тайник и держите дистанцию до раскрытия.',
    deathLogHint: 'Смерть от черного ликвидатора должна читать доверие к ложной зачистке: дверь открыта, проба на руках или дистанция потеряна.',
    rumorIds: ['monster_black_liquidator_wrong_count', 'ecology_black_liquidator_masks', 'samosbor_false_cleanup_patrol'],
    rareDrops: [{ itemId: 'liquidator_token', chance: 0.035 }, { itemId: 'gasmask_filter', chance: 0.045 }],
  },
  {
    kind: MonsterKind.CHERVIE_AVATAR,
    role: 'Локальный NET-аватар, который делает экранную комнату опасной только рядом с источником сигнала.',
    cue: 'Зеленый экран распадается на черные кабели, текстовые зубы и несколько голов, повторяющих один приказ.',
    rule: 'Силен у экранов, серверов и аппаратов; угол, разбитая линия к экрану, отключенный аппарат или энергооружие превращают аватар в обычную цель.',
    floorFit: 'Министерские архивы, машинные комнаты Коллекторов, NET-колодцы и пустотные экранные узлы.',
    floors: [FloorLevel.MINISTRY, FloorLevel.MAINTENANCE, FloorLevel.VOID],
    rooms: [RoomType.OFFICE, RoomType.HQ, RoomType.PRODUCTION, RoomType.CORRIDOR],
    spawnWeight: 0.42,
    minSamosborCount: 4,
    rare: true,
    lootHint: 'микросхема, зеленые проводки, редкая энергоячейка из локального сервера',
    counterplay: 'Ломайте линию к экрану, отключайте или разбивайте аппарат, не выполняйте свежий приказ с монитора и бейте энергооружием, пока аватар оторван от источника.',
    deathLogHint: 'Смерть от Червие должна читать бой рядом с рабочим экраном, послушание ложному приказу или игнор отключаемого источника.',
    rumorIds: ['monster_chervie_avatar_screen', 'ecology_chervie_avatar_disconnect'],
    rareDrops: [{ itemId: 'circuit_board', chance: 0.08 }, { itemId: 'ammo_energy', chance: 0.035 }],
  },
  {
    kind: MonsterKind.MUKHOZHUK_HOST,
    role: 'Редкий раскрытый носитель паразита власти: социальный риск становится боевым приказом.',
    cue: 'Чиновник или охранник пахнет сладкой гнилью, прячет еду, а из воротника шевелятся хитиновые лапки.',
    rule: 'После раскрытия гонит к еде, документам и охране; опасен рядом с уже враждебными свидетелями, но карантин, публичное разоблачение или быстрый выстрел ломают командный темп.',
    floorFit: 'Министерские кабинеты, карантинные коридоры и редкие ликвидаторские склады Коллекторов.',
    floors: [FloorLevel.MINISTRY, FloorLevel.MAINTENANCE],
    rooms: [RoomType.OFFICE, RoomType.HQ, RoomType.STORAGE, RoomType.CORRIDOR],
    spawnWeight: 0.18,
    minSamosborCount: 4,
    rare: true,
    lootHint: 'жирный хитин, приказ без подписи, редкая карантинная карта из воротника',
    counterplay: 'Не давайте носителю добежать до охраны или еды: вскрывайте болезнь при свидетелях, карантиньте, бейте до командного крика или уводите от складов.',
    deathLogHint: 'Смерть от мухожука должна читать доверие больному начальнику, поздний карантин или бой рядом с его охраной и пайками.',
    rumorIds: ['monster_mukhozhuk_host_command', 'ecology_mukhozhuk_quarantine'],
    rareDrops: [{ itemId: 'unsigned_order', chance: 0.06 }, { itemId: 'quarantine_medcard', chance: 0.03 }],
  },
  {
    kind: MonsterKind.FOG_SHARK,
    role: 'Низко-HП стайный хищник, который делает плотный туман маршрутом риска, а не только визуальным шумом.',
    cue: 'В серой пелене хлопают газовые жабры, металлические зубы блестят сбоку и стая разворачивается не по полу.',
    rule: 'В тумане быстро делится целью со стаей; на сухом воздухе теряет темп и поворот, огонь убивает надежно, но рядом взрывает газовое брюхо.',
    floorFit: 'Смоговые жилые карманы, коллекторные туманные линии, адский пепел и самосборные остатки.',
    floors: [FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL],
    rooms: [RoomType.CORRIDOR, RoomType.PRODUCTION, RoomType.COMMON, RoomType.BATHROOM],
    spawnWeight: 0.95,
    minSamosborCount: 2,
    rare: false,
    lootHint: 'акулья чешуя, фильтрующий слой, серебристый зуб из газового брюха',
    counterplay: 'Выходите из тумана на сухой воздух, закрывайте двери и углы, стреляйте безопасно с дистанции или жгите только не вплотную из-за газового взрыва.',
    deathLogHint: 'Смерть от туманной акулы должна читать стояние в тумане, поздний выход из стаи или поджог рядом с газовым брюхом.',
    rumorIds: ['monster_fog_shark_fog', 'ecology_fog_shark_fire'],
    rareDrops: [{ itemId: 'shark_scale', chance: 0.035 }, { itemId: 'filter_layer', chance: 0.04 }],
  },
  {
    kind: MonsterKind.BLOOD_PLANT,
    role: 'Корневой источник красной плесени: стационарный бой, контрабанда и выбор зачистить или прорубить путь.',
    cue: 'Красно-черный ствол с человеческой складкой в коре держит комнату корнями, а плесень у ящиков остается теплой.',
    rule: 'Бьет короткими корнями вокруг центра и лечится от близких партий красной плесени; огонь и режущие инструменты открывают корневой проход быстрее полного боя.',
    floorFit: 'Заброшенные биоблоки, ложные безопасные комнаты, культовые наркопритоны и мясные влажные карманы.',
    floors: [FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL],
    rooms: [RoomType.PRODUCTION, RoomType.STORAGE, RoomType.COMMON, RoomType.LIVING],
    spawnWeight: 0.16,
    minSamosborCount: 4,
    rare: true,
    lootHint: 'проба красной плесени, каменная соль, влажная кора и живой корень для НИИ или культа',
    counterplay: 'Не входите в красный центр без соли, огня или режущего инструмента: уничтожьте плесневые запасы, прорубите корни или сожгите источник до лечения.',
    deathLogHint: 'Смерть от кровавого растения должна читать вход в центр без инструмента, оставленные рядом запасы плесени или попытку собирать пробу во время удара корней.',
    rumorIds: ['monster_blood_plant_red_mold', 'ecology_blood_plant_roots', 'lead_living_blood_plant_den'],
    rareDrops: [{ itemId: 'red_mold_sample', chance: 0.08 }, { itemId: 'rock_salt', chance: 0.06 }],
  },
  {
    kind: MonsterKind.SPORE_CARPET,
    role: 'Домашняя ловушка под видом ковра: охраняет вещи, порог или тихий кабинет.',
    cue: 'Приподнятый угол, зеленые жилы в ворсе, плесневая бахрома и тень под висящей тряпкой.',
    rule: 'Спит до близкого шага, урона или вскрытого рядом контейнера; после пробуждения плывет к порогу и выпускает короткий cooldown-споровый выдох.',
    floorFit: 'Квартиры, офисы, кладовые, ложные безопасные блоки и грибные бытовые комнаты.',
    floors: [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE],
    rooms: [RoomType.LIVING, RoomType.OFFICE, RoomType.STORAGE, RoomType.CORRIDOR, RoomType.PRODUCTION],
    spawnWeight: 0.72,
    minSamosborCount: 1,
    rare: false,
    lootHint: 'плесневелая бахрома, споровый отпечаток, фильтрующий слой из старой подкладки',
    counterplay: 'Читайте поднятый угол до обыска: обходите порог, жгите ковер с дистанции, держите соль или фильтр и не деритесь в дверях во время спорового выдоха.',
    deathLogHint: 'Смерть от ковра должна читать жадный шаг за хабаром, бой в дверном проеме или отсутствие огня, соли и фильтра.',
    rumorIds: ['monster_spore_carpet_lifted_corner', 'ecology_spore_carpet_fire_salt', 'lead_living_spore_carpet_cache'],
    rareDrops: [{ itemId: 'spore_print', chance: 0.055 }, { itemId: 'filter_layer', chance: 0.035 }, { itemId: 'rock_salt', chance: 0.025 }],
  },
  {
    kind: MonsterKind.TRESKOTNIK,
    role: 'Хрупкий crack-sprinter, который превращает тихий коридор в короткий тест тайминга.',
    cue: 'Узкая бетонная фигура замирает, красные трещины вспыхивают и пыль сыплется перед прямым рывком.',
    rule: 'Короткий windup можно сбить любым попаданием; если рывок дошел, он бьет больно и ломает себя.',
    floorFit: 'Длинные жилые и квартальные коридоры, захламленные общие комнаты и редкие адские бетонные кишки.',
    floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.HELL],
    rooms: [RoomType.CORRIDOR, RoomType.COMMON, RoomType.STORAGE, RoomType.LIVING],
    spawnWeight: 2.4,
    minSamosborCount: 1,
    rare: false,
    lootHint: 'бетонная крошка, красная пыль из трещин, редкий кусок хрупкой плиты',
    counterplay: 'Стреляйте во время красной вспышки трещин, ломайте прямую углом или заставьте рывок удариться в дверь, стол, шкаф.',
    deathLogHint: 'Смерть от трескотника должна читать поздний выстрел, открытую прямую или игнор красной вспышки перед рывком.',
    rumorIds: ['monster_treskotnik_crack_pulse', 'ecology_treskotnik_corner'],
    rareDrops: [{ itemId: 'rebar', chance: 0.04 }, { itemId: 'psi_concrete_splinter', chance: 0.015 }],
  },
  {
    kind: MonsterKind.SCULPTURE,
    role: 'Бетонная аномалия, которая движется с огромной скоростью, когда на нее никто не смотрит.',
    cue: 'Шорох бетона, когда вы отворачиваетесь. Необычно гладкая статуя.',
    rule: 'Не движется, если любой актор (игрок или НПЦ) смотрит на нее (находится в угле обзора и есть прямая видимость). Смертельно опасна вблизи.',
    floorFit: 'Глубокие и безлюдные уровни: техобслуживание, ад, пустота.',
    floors: [FloorLevel.MAINTENANCE, FloorLevel.HELL, FloorLevel.VOID],
    rooms: [RoomType.CORRIDOR, RoomType.STORAGE, RoomType.PRODUCTION],
    spawnWeight: 0.05,
    minSamosborCount: 2,
    rare: true,
    lootHint: 'редкая арматура, изолента, странные бетонные фрагменты',
    counterplay: 'Скульптура. Двигается только в слепых зонах. Держите зрительный контакт и медленно отходите.',
    deathLogHint: 'Смерть от скульптуры: отвернулся, моргнул, или зашел в темный угол без прямой видимости.',
    rumorIds: ['monster_sculpture_angel', 'ecology_sculpture_stare'],
    rareDrops: [{ itemId: 'rebar', chance: 0.1 }, { itemId: 'psi_concrete_splinter', chance: 0.1 }],
  },
];

export const MONSTER_ECOLOGY_BY_KIND: Partial<Record<MonsterKind, MonsterEcologyDef>> = {};

for (const def of MONSTER_ECOLOGY) {
  MONSTER_ECOLOGY_BY_KIND[def.kind] = def;
}

export function getMonsterEcology(kind: MonsterKind | undefined): MonsterEcologyDef | undefined {
  return kind === undefined ? undefined : MONSTER_ECOLOGY_BY_KIND[kind];
}

interface MonsterEcologyContext {
  tags: readonly string[];
  anchorTags?: readonly string[];
  avoidTags?: readonly string[];
  anchorPenalty?: number;
  avoidPenalty?: number;
}

const MONSTER_ECOLOGY_CONTEXT: Partial<Record<MonsterKind, MonsterEcologyContext>> = {
  [MonsterKind.SBORKA]: {
    tags: ['corridor', 'storage', 'swarm', 'samosbor', 'meat', 'food', 'fog', 'crowd'],
    anchorTags: ['corridor', 'storage', 'samosbor', 'meat', 'food', 'crowd'],
  },
  [MonsterKind.KRYSNOZHKA]: {
    tags: ['residential', 'kitchen', 'storage', 'food', 'garbage', 'crowd', 'swarm'],
    anchorTags: ['kitchen', 'storage', 'food', 'garbage', 'residential'],
  },
  [MonsterKind.GREEN_DOG]: {
    tags: ['residential', 'living', 'corridor', 'storage', 'door', 'noise', 'metal', 'pack', 'garbage', 'false_safe'],
    anchorTags: ['residential', 'living', 'corridor', 'door', 'storage', 'garbage', 'false_safe'],
    avoidTags: ['documents', 'office'],
    anchorPenalty: 0.3,
    avoidPenalty: 0.55,
  },
  [MonsterKind.POMOYNY_ROY]: {
    tags: ['residential', 'kitchen', 'storage', 'market', 'food', 'garbage', 'trash', 'swarm', 'crowd'],
    anchorTags: ['kitchen', 'storage', 'market', 'food', 'garbage', 'trash'],
  },
  [MonsterKind.SWARM]: {
    tags: ['maintenance', 'storage', 'production', 'vent', 'void', 'source', 'swarm', 'samosbor', 'fire', 'sealant'],
    anchorTags: ['maintenance', 'storage', 'production', 'vent', 'void', 'source', 'samosbor'],
    avoidTags: ['office', 'documents'],
    anchorPenalty: 0.32,
    avoidPenalty: 0.5,
  },
  [MonsterKind.TVAR]: {
    tags: ['residential', 'corridor', 'wall', 'predator', 'meat', 'smog', 'infection'],
    anchorTags: ['residential', 'corridor', 'wall', 'predator', 'meat'],
  },
  [MonsterKind.PANELNIK]: {
    tags: ['residential', 'panel', 'wall', 'corridor', 'common', 'concrete', 'service'],
    anchorTags: ['residential', 'panel', 'wall', 'corridor', 'common', 'concrete'],
    anchorPenalty: 0.35,
  },
  [MonsterKind.ZHORNAYA_TVAR]: {
    tags: ['residential', 'kitchen', 'storage', 'food', 'meat', 'corpse', 'feast', 'altar', 'predator', 'hell'],
    anchorTags: ['kitchen', 'storage', 'food', 'meat', 'corpse', 'feast', 'altar'],
    anchorPenalty: 0.32,
  },
  [MonsterKind.POLZUN]: {
    tags: ['water', 'wet', 'bathroom', 'storage', 'industrial', 'conveyor', 'movement', 'fog', 'low'],
    anchorTags: ['water', 'wet', 'bathroom', 'storage', 'industrial', 'movement'],
  },
  [MonsterKind.TUMANNIK]: {
    tags: ['fog', 'smog', 'smoke', 'ash', 'aftershock', 'corridor', 'ambush', 'sound', 'noise', 'visibility', 'hell'],
    anchorTags: ['fog', 'smog', 'smoke', 'ash', 'aftershock', 'corridor', 'sound'],
    avoidTags: ['light', 'lamp', 'open', 'dry'],
    anchorPenalty: 0.16,
    avoidPenalty: 0.24,
  },
  [MonsterKind.BETONNIK]: {
    tags: ['concrete', 'corridor', 'production', 'crush', 'deep', 'samosbor'],
    anchorTags: ['concrete', 'corridor', 'production', 'crush', 'deep'],
  },
  [MonsterKind.BETONOED]: {
    tags: ['concrete', 'weak_wall', 'shortcut', 'noise', 'sealant', 'fire', 'maintenance', 'storage'],
    anchorTags: ['concrete', 'weak_wall', 'shortcut', 'maintenance', 'storage'],
    anchorPenalty: 0.2,
  },
  [MonsterKind.PSEUDOLIFT]: {
    tags: ['lift', 'route', 'metro', 'service', 'dark', 'samosbor', 'trap', 'corridor'],
    anchorTags: ['lift', 'route', 'metro', 'service', 'dark', 'trap'],
    anchorPenalty: 0.2,
  },
  [MonsterKind.BLACK_LIQUIDATOR]: {
    tags: ['liquidator', 'cleanup', 'samosbor', 'patrol', 'mask', 'quarantine', 'corridor', 'documents'],
    anchorTags: ['liquidator', 'cleanup', 'samosbor', 'patrol', 'mask', 'quarantine'],
    avoidTags: ['water', 'hell', 'void'],
    anchorPenalty: 0.18,
    avoidPenalty: 0.35,
  },
  [MonsterKind.MUKHOZHUK_HOST]: {
    tags: ['documents', 'office', 'hq', 'authority', 'quarantine', 'food', 'parasite', 'liquidator'],
    anchorTags: ['documents', 'office', 'hq', 'authority', 'quarantine', 'food'],
    avoidTags: ['open', 'hell', 'void'],
    anchorPenalty: 0.18,
    avoidPenalty: 0.32,
  },
  [MonsterKind.FOG_SHARK]: {
    tags: ['fog', 'smog', 'samosbor', 'water', 'wet', 'corridor', 'pack', 'hell', 'predator'],
    anchorTags: ['fog', 'smog', 'samosbor', 'water', 'wet', 'corridor'],
    avoidTags: ['dry', 'bright', 'office'],
    anchorPenalty: 0.14,
    avoidPenalty: 0.22,
  },
  [MonsterKind.BLOOD_PLANT]: {
    tags: ['plant', 'red_mold', 'mushroom', 'cult', 'contraband', 'storage', 'false_safe_block', 'meat', 'roots'],
    anchorTags: ['plant', 'red_mold', 'mushroom', 'cult', 'contraband', 'storage', 'false_safe_block'],
    avoidTags: ['dry', 'documents', 'office'],
    anchorPenalty: 0.12,
    avoidPenalty: 0.3,
  },
  [MonsterKind.SPORE_CARPET]: {
    tags: ['residential', 'living', 'office', 'storage', 'corridor', 'door', 'threshold', 'mushroom', 'spores', 'loot', 'false_safe_block'],
    anchorTags: ['residential', 'living', 'office', 'storage', 'corridor', 'door', 'threshold', 'mushroom', 'loot', 'false_safe_block'],
    avoidTags: ['water', 'wet', 'open', 'industrial'],
    anchorPenalty: 0.18,
    avoidPenalty: 0.32,
  },
  [MonsterKind.CHERVIE_AVATAR]: {
    tags: ['net', 'screen', 'terminal', 'documents', 'office', 'hq', 'power', 'protocol', 'void'],
    anchorTags: ['net', 'screen', 'terminal', 'office', 'hq', 'power', 'protocol'],
    avoidTags: ['water', 'kitchen', 'residential'],
    anchorPenalty: 0.12,
    avoidPenalty: 0.25,
  },
  [MonsterKind.ZOMBIE]: {
    tags: ['residential', 'living', 'kitchen', 'crowd', 'zombie', 'infection', 'quarantine', 'food'],
    anchorTags: ['residential', 'living', 'kitchen', 'crowd', 'zombie', 'infection'],
  },
  [MonsterKind.HEAD_SLUG]: {
    tags: ['medical', 'quarantine', 'infection', 'parasite', 'host', 'corpse', 'office', 'corridor'],
    anchorTags: ['medical', 'quarantine', 'infection', 'parasite', 'host', 'corpse'],
    avoidTags: ['dry', 'machine', 'void'],
    anchorPenalty: 0.18,
    avoidPenalty: 0.35,
  },
  [MonsterKind.OBZHIVALSHCHIK]: {
    tags: ['residential', 'living', 'apartment', 'room', 'door', 'noise', 'neighbor', 'false_safe', 'growth'],
    anchorTags: ['residential', 'living', 'apartment', 'room', 'door', 'neighbor', 'false_safe'],
    avoidTags: ['industrial', 'water', 'void', 'hell', 'open'],
    anchorPenalty: 0.22,
    avoidPenalty: 0.45,
  },
  [MonsterKind.DIKIY_MERTVYAK]: {
    tags: ['residential', 'living', 'kitchen', 'crowd', 'queue', 'riot', 'market', 'door', 'infection'],
    anchorTags: ['residential', 'crowd', 'queue', 'riot', 'market', 'door'],
    anchorPenalty: 0.55,
  },
  [MonsterKind.EYE]: {
    tags: ['visibility', 'light', 'lamp', 'screen', 'power', 'patrol', 'lab', 'corridor', 'line'],
    anchorTags: ['visibility', 'light', 'lamp', 'screen', 'power', 'patrol', 'lab', 'corridor'],
  },
  [MonsterKind.LAMPOGLAZ]: {
    tags: ['light', 'lamp', 'visibility', 'corridor', 'line', 'office', 'power', 'patrol'],
    anchorTags: ['light', 'lamp', 'corridor', 'line', 'office', 'power'],
    anchorPenalty: 0.28,
  },
  [MonsterKind.SLEPOGLAZ]: {
    tags: ['sound', 'noise', 'corridor', 'line', 'green', 'industrial', 'hell', 'deep', 'blind'],
    anchorTags: ['sound', 'noise', 'corridor', 'line', 'industrial', 'hell', 'deep'],
    anchorPenalty: 0.3,
  },
  [MonsterKind.NIGHTMARE]: {
    tags: ['fog', 'dark', 'psi', 'samosbor', 'pressure', 'deep', 'medical'],
    anchorTags: ['fog', 'dark', 'psi', 'samosbor', 'pressure', 'deep'],
  },
  [MonsterKind.SOBRANNYY]: {
    tags: ['samosbor', 'production', 'shelter', 'bunker', 'sealed', 'slime', 'toxic', 'meat', 'crowd'],
    anchorTags: ['samosbor', 'production', 'shelter', 'bunker', 'sealed', 'crowd'],
    anchorPenalty: 0.22,
  },
  [MonsterKind.BORSHCHEVIK]: {
    tags: ['plant', 'mushroom', 'contaminated', 'service', 'maintenance', 'corridor', 'storage', 'route_pressure', 'toxic', 'fog'],
    anchorTags: ['mushroom', 'contaminated', 'service', 'maintenance', 'corridor', 'storage', 'route_pressure'],
    avoidTags: ['documents', 'office', 'dry'],
    anchorPenalty: 0.2,
    avoidPenalty: 0.35,
  },
  [MonsterKind.SHADOW]: {
    tags: ['dark', 'low_light', 'fog', 'visibility', 'cult', 'psi', 'void', 'mirror', 'duality'],
    anchorTags: ['dark', 'low_light', 'fog', 'cult', 'psi', 'void', 'mirror'],
    avoidTags: ['light', 'lamp'],
    anchorPenalty: 0.42,
    avoidPenalty: 0.35,
  },
  [MonsterKind.GLUBINNAYA_TEN]: {
    tags: ['dark', 'low_light', 'fog', 'deep', 'hell', 'void', 'cult', 'altar', 'seam', 'psi', 'route_pressure'],
    anchorTags: ['dark', 'low_light', 'fog', 'deep', 'hell', 'void', 'cult', 'altar', 'seam'],
    avoidTags: ['light', 'lamp', 'open'],
    anchorPenalty: 0.24,
    avoidPenalty: 0.22,
  },
  [MonsterKind.LISHENNYY]: {
    tags: ['dark', 'low_light', 'deep', 'hell', 'void', 'light', 'lamp', 'candle', 'route_pressure', 'decay'],
    anchorTags: ['dark', 'low_light', 'deep', 'hell', 'void', 'light', 'lamp', 'candle', 'route_pressure'],
    avoidTags: ['open', 'dry', 'civil'],
    anchorPenalty: 0.18,
    avoidPenalty: 0.24,
  },
  [MonsterKind.TONKAYA_TEN]: {
    tags: ['dark', 'low_light', 'corridor', 'door', 'office', 'residential', 'void', 'line'],
    anchorTags: ['dark', 'low_light', 'corridor', 'door', 'office', 'residential', 'line'],
    avoidTags: ['light', 'lamp', 'open'],
    anchorPenalty: 0.3,
    avoidPenalty: 0.25,
  },
  [MonsterKind.REBAR]: {
    tags: ['industrial', 'metal', 'production', 'storage', 'crush', 'rail', 'moving_walls'],
    anchorTags: ['industrial', 'metal', 'production', 'storage', 'crush', 'rail'],
  },
  [MonsterKind.RZHAVNIK]: {
    tags: ['industrial', 'metal', 'storage', 'shelf', 'scrap', 'repair', 'pipes', 'cable', 'workshop'],
    anchorTags: ['metal', 'storage', 'shelf', 'scrap', 'repair', 'pipes', 'cable'],
    anchorPenalty: 0.18,
  },
  [MonsterKind.ZAKALENNAYA_ARMATURA]: {
    tags: ['industrial', 'metal', 'production', 'storage', 'machine', 'service', 'armor', 'hell', 'deep'],
    anchorTags: ['industrial', 'metal', 'production', 'storage', 'machine', 'service', 'hell', 'deep'],
    anchorPenalty: 0.24,
  },
  [MonsterKind.MATKA]: {
    tags: ['production', 'hq', 'meat', 'deep', 'samosbor', 'cult', 'spawn'],
    anchorTags: ['production', 'hq', 'meat', 'deep', 'samosbor'],
  },
  [MonsterKind.KHOROVAYA_MATKA]: {
    tags: ['hell', 'meat', 'deep', 'cult', 'spawn', 'swarm', 'choir', 'altar'],
    anchorTags: ['hell', 'meat', 'cult', 'spawn', 'choir', 'altar'],
  },
  [MonsterKind.IDOL]: {
    tags: ['cult', 'psi', 'shelter', 'false_safe_block', 'office', 'storage', 'hq'],
    anchorTags: ['cult', 'psi', 'shelter', 'false_safe_block', 'office'],
  },
  [MonsterKind.KANTSELYARSKIY_IDOL]: {
    tags: ['documents', 'paper', 'admin', 'office', 'archive', 'registry', 'desk', 'shelf', 'line', 'psi'],
    anchorTags: ['documents', 'paper', 'admin', 'office', 'archive', 'registry', 'desk', 'shelf'],
    avoidTags: ['wet', 'water', 'kitchen', 'residential'],
    anchorPenalty: 0.16,
    avoidPenalty: 0.28,
  },
  [MonsterKind.MANCOBUS]: {
    tags: ['production', 'hq', 'industrial', 'hell', 'deep', 'command'],
    anchorTags: ['production', 'hq', 'industrial', 'hell', 'deep'],
  },
  [MonsterKind.HERALD]: {
    tags: ['hell', 'deep', 'corridor', 'hq', 'samosbor', 'line'],
    anchorTags: ['hell', 'deep', 'samosbor', 'corridor', 'hq'],
  },
  [MonsterKind.CREATOR]: {
    tags: ['void', 'protocol', 'line', 'white', 'hq'],
    anchorTags: ['void', 'protocol'],
  },
  [MonsterKind.SAFEGUARD]: {
    tags: ['net', 'terminal', 'screen', 'protocol', 'white', 'blade', 'access', 'industrial', 'hq', 'line'],
    anchorTags: ['net', 'terminal', 'screen', 'protocol', 'industrial', 'hq', 'line'],
    anchorPenalty: 0.28,
  },
  [MonsterKind.SPIRIT]: {
    tags: ['void', 'teleport', 'mirror', 'cult', 'psi', 'false_safe_block', 'dark'],
    anchorTags: ['void', 'teleport', 'mirror', 'cult', 'psi'],
  },
  [MonsterKind.LOZHNYY_DUKH]: {
    tags: ['door', 'closed_door', 'office', 'void', 'mirror', 'false_safe_block', 'cold', 'flank'],
    anchorTags: ['door', 'closed_door', 'office', 'void', 'mirror', 'false_safe_block'],
    anchorPenalty: 0.34,
  },
  [MonsterKind.ROBOT]: {
    tags: ['industrial', 'machine', 'machines', 'power', 'lab', 'patrol', 'screen', 'rail'],
    anchorTags: ['industrial', 'machine', 'machines', 'power', 'lab', 'patrol'],
  },
  [MonsterKind.TRUBNYY_AVTOMAT]: {
    tags: ['industrial', 'machine', 'machines', 'pipes', 'water', 'wet', 'pump', 'drain', 'line', 'service'],
    anchorTags: ['pipes', 'water', 'wet', 'pump', 'drain', 'line', 'service', 'machine'],
    avoidTags: ['dry'],
    anchorPenalty: 0.14,
    avoidPenalty: 0.2,
  },
  [MonsterKind.SHOVNIK]: {
    tags: ['civil', 'residential', 'corridor', 'office', 'seam', 'fractal', 'admin'],
    anchorTags: ['civil', 'residential', 'corridor', 'office', 'admin'],
  },
  [MonsterKind.LAMPOVY]: {
    tags: ['light', 'lamp', 'power', 'screen', 'radio', 'pattern', 'office', 'production'],
    anchorTags: ['light', 'lamp', 'power', 'screen', 'radio'],
    anchorPenalty: 0.5,
  },
  [MonsterKind.PECHATEED]: {
    tags: ['documents', 'paper', 'admin', 'office', 'forms', 'quarantine', 'math', 'fractal'],
    anchorTags: ['documents', 'paper', 'admin', 'office', 'forms'],
    anchorPenalty: 0.5,
  },
  [MonsterKind.KONTORSHCHIK]: {
    tags: ['documents', 'paper', 'admin', 'office', 'forms', 'archive', 'queue', 'cabinet', 'shelf'],
    anchorTags: ['documents', 'paper', 'admin', 'office', 'forms', 'archive', 'cabinet', 'shelf'],
    avoidTags: ['water', 'wet', 'kitchen', 'industrial', 'hell'],
    anchorPenalty: 0.18,
    avoidPenalty: 0.28,
  },
  [MonsterKind.PROTOKOLNIK]: {
    tags: ['documents', 'paper', 'admin', 'office', 'archive', 'registry', 'court', 'protocol', 'psi', 'pressure'],
    anchorTags: ['documents', 'paper', 'admin', 'office', 'archive', 'registry', 'court', 'protocol'],
    avoidTags: ['residential', 'kitchen', 'wet', 'water'],
    anchorPenalty: 0.18,
    avoidPenalty: 0.25,
  },
  [MonsterKind.TUBE_EEL]: {
    tags: ['water', 'wet', 'pipes', 'bathroom', 'collectors', 'rail'],
    anchorTags: ['water', 'wet', 'pipes', 'bathroom', 'collectors'],
    avoidTags: ['dry'],
    anchorPenalty: 0.12,
    avoidPenalty: 0.18,
  },
  [MonsterKind.VODYANOY_KOSHMAR]: {
    tags: ['water', 'wet', 'pipes', 'pressure', 'psi', 'collectors', 'pump', 'drain', 'line'],
    anchorTags: ['water', 'wet', 'pipes', 'pressure', 'psi', 'collectors', 'pump', 'drain'],
    avoidTags: ['dry'],
    anchorPenalty: 0.12,
    avoidPenalty: 0.16,
  },
  [MonsterKind.CHERNOSLIZ]: {
    tags: ['water', 'wet', 'slime', 'black_slime', 'sample', 'lab', 'collectors', 'pipes', 'dark', 'ambush'],
    anchorTags: ['water', 'wet', 'black_slime', 'sample', 'lab', 'collectors', 'pipes'],
    avoidTags: ['dry', 'bright'],
    anchorPenalty: 0.1,
    avoidPenalty: 0.2,
  },
  [MonsterKind.OLGOY]: {
    tags: ['water', 'wet', 'pipes', 'collectors', 'meat', 'corpse', 'food', 'mushroom', 'samosbor', 'hell', 'predator'],
    anchorTags: ['water', 'wet', 'pipes', 'collectors', 'meat', 'corpse', 'mushroom', 'samosbor'],
    avoidTags: ['dry'],
    anchorPenalty: 0.18,
    avoidPenalty: 0.22,
  },
  [MonsterKind.PARAGRAPH]: {
    tags: ['documents', 'paper', 'admin', 'office', 'hq', 'fractal', 'math', 'teleport', 'protocol'],
    anchorTags: ['documents', 'paper', 'admin', 'office', 'hq', 'protocol'],
  },
  [MonsterKind.NELYUD]: {
    tags: ['residential', 'living', 'kitchen', 'crowd', 'duality', 'trail', 'smog', 'quarantine'],
    anchorTags: ['residential', 'living', 'kitchen', 'crowd', 'duality', 'trail'],
  },
  [MonsterKind.BEZEKHIY]: {
    tags: ['residential', 'living', 'corridor', 'door', 'threshold', 'storage', 'duality', 'trail', 'admin'],
    anchorTags: ['residential', 'living', 'corridor', 'door', 'threshold', 'storage', 'duality'],
    avoidTags: ['water', 'wet', 'production'],
    anchorPenalty: 0.24,
    avoidPenalty: 0.35,
  },
  [MonsterKind.SLIMEVIK]: {
    tags: ['slime', 'sample', 'mushroom', 'samosbor', 'contaminated', 'water', 'wet', 'lab', 'food', 'medical'],
    anchorTags: ['slime', 'sample', 'mushroom', 'samosbor', 'contaminated', 'water', 'wet', 'lab'],
    avoidTags: ['dry', 'documents'],
    anchorPenalty: 0.22,
    avoidPenalty: 0.4,
  },
  [MonsterKind.SLIME_WOMAN]: {
    tags: ['slime', 'toxic', 'sample', 'water', 'wet', 'bathroom', 'lab', 'black_slime', 'green_slime', 'collectors'],
    anchorTags: ['slime', 'toxic', 'sample', 'water', 'wet', 'bathroom', 'lab', 'black_slime', 'green_slime'],
    avoidTags: ['dry', 'bright', 'documents'],
    anchorPenalty: 0.12,
    avoidPenalty: 0.18,
  },
  [MonsterKind.GNILUSHKA]: {
    tags: ['residential', 'living', 'lost', 'samosbor', 'mushroom', 'false_safe_block', 'slime', 'sample', 'medical', 'noncombat'],
    anchorTags: ['residential', 'living', 'samosbor', 'mushroom', 'false_safe_block', 'slime', 'sample', 'medical'],
    avoidTags: ['industrial', 'metal', 'documents', 'office'],
    anchorPenalty: 0.08,
    avoidPenalty: 0.38,
  },
  [MonsterKind.KOSTOREZ]: {
    tags: ['industrial', 'metal', 'production', 'storage', 'predator', 'crush', 'hell'],
    anchorTags: ['industrial', 'metal', 'production', 'storage', 'predator', 'crush', 'hell'],
  },
  [MonsterKind.TRESKOTNIK]: {
    tags: ['residential', 'civil', 'corridor', 'storage', 'clutter', 'timing', 'movement', 'moving_walls', 'predator', 'hell'],
    anchorTags: ['residential', 'civil', 'corridor', 'storage', 'clutter', 'timing', 'movement'],
    avoidTags: ['water', 'wet', 'documents'],
    anchorPenalty: 0.24,
    avoidPenalty: 0.35,
  },
};

function includesTag(tags: readonly string[] | undefined, tag: string): boolean {
  return tags !== undefined && tags.includes(tag);
}

function tagHits(needles: readonly string[] | undefined, haystack: readonly string[] | undefined): number {
  if (!needles || !haystack || haystack.length === 0) return 0;
  let hits = 0;
  for (const tag of needles) {
    if (includesTag(haystack, tag)) hits++;
  }
  return hits;
}

export function isCarnivoreMonster(kind: MonsterKind | undefined): boolean {
  if (kind === undefined) return false;
  const tags = MONSTER_ECOLOGY_CONTEXT[kind]?.tags;
  if (!tags) return false;
  return tags.includes('meat') || tags.includes('corpse') || tags.includes('predator') || tags.includes('food');
}

function ecologyTagWeight(def: MonsterEcologyDef, query: MonsterEcologyQuery): number {
  const context = MONSTER_ECOLOGY_CONTEXT[def.kind];
  if (!context) return 1;

  const floorHits = tagHits(context.tags, query.floorTags);
  const roomHits = tagHits(context.tags, query.roomTags);
  let weight = 1 + Math.min(4, floorHits) * 0.28 + Math.min(5, roomHits) * 0.42;

  if (context.anchorTags && (query.floorTags?.length || query.roomTags?.length)) {
    const anchorHits = tagHits(context.anchorTags, query.floorTags) + tagHits(context.anchorTags, query.roomTags);
    if (anchorHits > 0) weight *= 1 + Math.min(4, anchorHits) * 0.35;
    else weight *= context.anchorPenalty ?? 0.4;
  }

  const avoidHits = tagHits(context.avoidTags, query.floorTags) + tagHits(context.avoidTags, query.roomTags);
  if (avoidHits > 0) weight *= Math.pow(context.avoidPenalty ?? 0.45, avoidHits);

  return Math.max(0, weight);
}

function excludedFromSpawn(def: MonsterEcologyDef, query: MonsterEcologyQuery): boolean {
  return query.excludeKinds?.includes(def.kind) === true;
}

function monsterFloorAffinityMode(query: MonsterEcologyQuery): 'strict' | 'weighted' | 'none' {
  if (query.floorAffinity) return query.floorAffinity;
  if (query.allowOffFloor === false) return 'strict';
  return 'weighted';
}

function ecologyWaveAllows(def: MonsterEcologyDef, query: MonsterEcologyQuery): boolean {
  const wave = query.samosborCount ?? 1;
  if (wave < def.minSamosborCount) return false;
  if (def.rare && !query.allowRare) return false;
  return true;
}

function floorHasNativePool(query: MonsterEcologyQuery): boolean {
  for (const def of MONSTER_ECOLOGY) {
    if (excludedFromSpawn(def, query)) continue;
    if (!def.floors.includes(query.floor)) continue;
    if (!ecologyWaveAllows(def, query)) continue;
    return true;
  }
  return false;
}

function ecologyFloorWeight(def: MonsterEcologyDef, query: MonsterEcologyQuery): number {
  const floorFits = def.floors.includes(query.floor);
  const mode = monsterFloorAffinityMode(query);
  if (mode === 'none') return 1;
  if (mode === 'strict') return floorFits ? 1 : 0;
  if (!floorHasNativePool(query)) return 1;
  return floorFits ? NATIVE_FLOOR_MULT : 1;
}

function ecologyBiasWeight(def: MonsterEcologyDef, query: MonsterEcologyQuery): number {
  if (!query.biasKinds || query.biasKinds.length === 0) return 1;
  const biasIndex = query.biasKinds.indexOf(def.kind);
  if (biasIndex < 0) return 1;
  return BIAS_KIND_MULT - Math.min(4, biasIndex) * 0.25;
}

function ecologySpawnWeight(def: MonsterEcologyDef, query: MonsterEcologyQuery): number {
  if (excludedFromSpawn(def, query)) return 0;
  if (!ecologyWaveAllows(def, query)) return 0;
  let weight = def.spawnWeight;
  weight *= ecologyFloorWeight(def, query);
  if (weight <= 0) return 0;
  if (query.roomType !== undefined) weight *= def.rooms.includes(query.roomType) ? 1.7 : 0.4;
  weight *= ecologyTagWeight(def, query);
  if (DEEP.includes(query.floor) && def.rooms.includes(RoomType.PRODUCTION)) weight *= 1.15;
  weight *= ecologyBiasWeight(def, query);
  const pressure = Math.max(0, Math.min(4, query.routePressure ?? 0));
  if (pressure > 0) {
    if (def.rooms.includes(RoomType.CORRIDOR)) weight *= 1 + pressure * 0.08;
    if (ROUTE_PRESSURE_KINDS.includes(def.kind)) weight *= 1 + pressure * 0.1;
  }
  return weight;
}

export function rankMonsterEcology(query: MonsterEcologyQuery, limit = MONSTER_ECOLOGY.length): MonsterEcologyRank[] {
  const ranked: MonsterEcologyRank[] = [];
  for (const ecology of MONSTER_ECOLOGY) {
    const weight = ecologySpawnWeight(ecology, query);
    if (weight <= 0) continue;
    ranked.push({ kind: ecology.kind, weight, ecology });
  }
  ranked.sort((a, b) => b.weight - a.weight || a.kind - b.kind);
  return ranked.slice(0, Math.max(0, limit));
}

export function likelyMonsterKinds(query: MonsterEcologyQuery, limit = 5): MonsterKind[] {
  return rankMonsterEcology(query, limit).map(entry => entry.kind);
}

export function chooseFloorMonsterKind(query: MonsterEcologyQuery): MonsterKind {
  const rand = query.rng ?? Math.random;
  let total = 0;
  let chosen: MonsterKind | undefined;

  for (const def of MONSTER_ECOLOGY) {
    const weight = ecologySpawnWeight(def, query);
    if (weight <= 0) continue;
    total += weight;
    if (rand() * total < weight) chosen = def.kind;
  }

  if (chosen !== undefined) return chosen;

  for (const def of MONSTER_ECOLOGY) {
    if (excludedFromSpawn(def, query)) continue;
    if (!ecologyWaveAllows(def, query)) continue;
    if (ecologyFloorWeight(def, query) <= 0) continue;
    return def.kind;
  }
  return MonsterKind.SBORKA;
}

export function chooseMonsterRareDrop(kind: MonsterKind, rand = Math.random): MonsterRareDrop | undefined {
  const def = getMonsterEcology(kind);
  if (!def) return undefined;
  for (const drop of def.rareDrops) {
    if (rand() < drop.chance) return drop;
  }
  return undefined;
}

export function monsterEcologyTags(kind: MonsterKind | undefined): string[] {
  const def = getMonsterEcology(kind);
  if (!def) return [];
  const name = MonsterKind[def.kind].toLowerCase();
  return def.rare ? ['ecology', `monster_${name}`, 'rare_monster'] : ['ecology', `monster_${name}`];
}

export function monsterEcologyEventData(kind: MonsterKind | undefined): Record<string, unknown> | undefined {
  const def = getMonsterEcology(kind);
  if (!def) return undefined;
  return {
    ecologyFloors: def.floors,
    ecologyRooms: def.rooms,
    ecologyLootHint: def.lootHint,
    ecologyCounterplay: def.counterplay,
    ecologyRumorIds: def.rumorIds,
    ecologyRareDrops: def.rareDrops,
    ecologyRare: def.rare,
  };
}
