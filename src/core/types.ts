/* ── ГИГАХРУЩ — core type definitions ─────────────────────────── */

export const W = 1024;           // toroidal world size
export const TEX = 64;           // texture size (px)
export const MAX_DRAW = 40;      // max raycaster distance
export const TICK_S = 1 / 60;    // seconds per logic tick

// ── Cells ────────────────────────────────────────────────────────
export const enum Cell {
  FLOOR   = 0,
  WALL    = 1,
  DOOR    = 2,
  ABYSS   = 3,
  LIFT    = 4,
  WATER   = 5,
}



// ── Texture indices ──────────────────────────────────────────────
export const enum Tex {
  CONCRETE  = 0,
  BRICK     = 1,
  PANEL     = 2,
  TILE_W    = 3,
  METAL     = 4,
  ROTTEN    = 5,
  CURTAIN   = 6,
  DARK      = 7,
  // floors 8-15
  F_CONCRETE = 8,
  F_LINO     = 9,
  F_TILE     = 10,
  F_WOOD     = 11,
  F_CARPET   = 12,
  // ceiling
  CEIL       = 13,
  // doors
  DOOR_WOOD  = 14,
  DOOR_METAL = 15,
  // abyss
  F_ABYSS    = 16,
  // lift
  LIFT_DOOR  = 17,
  // maintenance
  PIPE       = 18,
  F_WATER    = 19,
  // hell
  MEAT       = 20,
  F_MEAT     = 21,
  // start room
  DESK       = 22,
  SLIDE_1    = 23,
  SLIDE_2    = 24,
  SLIDE_3    = 25,
  SLIDE_4    = 26,
  SLIDE_5    = 27,
  SLIDE_6    = 28,
  SLIDE_7    = 29,
  SLIDE_8    = 30,
  TARGET     = 31,
  // keybind hint posters (tutorial room) — 2 hints per texture + lore poster
  HINT_1 = 32, HINT_2 = 33, HINT_3 = 34, HINT_4 = 35,
  HINT_5 = 36, HINT_6 = 37, HINT_7 = 38, HINT_LORE = 39,
  HERMO_WALL = 40,
  GUT        = 41,
  F_GUT      = 42,
  VOID_WALL  = 43,
  F_VOID     = 44,
  PORTAL     = 45,
  CROSS      = 46,
  ICON       = 47,
  // ministry (stalinist empire)
  MARBLE          = 48,
  F_RED_CARPET    = 49,
  F_GREEN_CARPET  = 50,
  F_MARBLE_TILE   = 51,
  // portraits — 64 procedural variants (coordinate-hash like posters)
  PORTRAIT_BASE   = 52,  // 64 procedural portraits: 52..115
  // agitprop posters — 64 procedural variants
  POSTER_BASE     = 116, // 64 procedural posters: 116..179
  // parquet floor
  F_PARQUET       = 180,
  // red carpet edge-aware tiling: 16 variants by 4-bit edge mask (NESW)
  F_CARPET_EDGE_BASE = 181, // 16 variants: 181..196
  // procedural wall-mounted screens: 8 program variants × 4 animation frames
  SCREEN_BASE     = 197, // 32 variants: 197..228
  // wall-snake larva body block
  LARVA_BODY      = 229,
  DOOR_HERMETIC   = 230,
  COUNT           = 231,
}

// ── Floor levels (Z-axis) ────────────────────────────────────────
export enum FloorLevel {
  MINISTRY     = 0,   // министерство (-2) — сталинский ампир, чиновники, ковры
  KVARTIRY     = 1,   // квартиры (-1) — плотная жилая зона, 5к гражданских, протесты
  LIVING       = 2,   // жилая зона (0) — квартиры, цеха, залы
  MAINTENANCE  = 3,   // коллекторы — трубы, туннели, каналы с водой
  HELL         = 4,   // ад — мясо, постоянный самосбор, культисты
  VOID         = 5,   // пустота — абстрактный фрактальный уровень, финальный босс
}

// ── Lift direction ───────────────────────────────────────────────
export const enum LiftDirection {
  DOWN = 0,   // ведёт на этаж ниже
  UP   = 1,   // ведёт на этаж выше
}

// ── Rooms ────────────────────────────────────────────────────────
export enum RoomType {
  LIVING,      // personal room — sleep, hide
  KITCHEN,     // eat, drink
  BATHROOM,    // toilet, shower
  STORAGE,     // items
  MEDICAL,     // healing
  COMMON,      // hall
  PRODUCTION,  // work
  CORRIDOR,    // passage
  SMOKING,     // курилка — free time
  OFFICE,      // бухгалтерия — paperwork
  HQ,          // штаб фракции — spawn + охрана
  CLASSROOM,   // класс/ясли
}

export interface Room {
  id: number;
  type: RoomType;
  x: number; y: number; w: number; h: number;
  doors: number[];          // door cell indices
  sealed: boolean;          // hermetically sealed during samosbor
  name: string;
  apartmentId: number;      // -1 = not apartment
  wallTex: Tex;
  floorTex: Tex;
  ceilingTier?: number;     // optional custom ceiling tier
}

// ── Cell features (one per cell) ─────────────────────────────────
export const enum Feature {
  NONE         = 0,
  LAMP         = 1,
  TABLE        = 2,
  CHAIR        = 3,
  BED          = 4,
  STOVE        = 5,
  SINK         = 6,
  TOILET       = 7,
  SHELF        = 8,
  MACHINE      = 9,
  APPARATUS    = 10,
  LIFT_BUTTON  = 11,
  DESK         = 12,
  SLIDE        = 13,
  CANDLE       = 14,
  SCREEN       = 15,
}

// ── Doors ────────────────────────────────────────────────────────
export enum DoorState {
  OPEN,
  CLOSED,
  LOCKED,
  HERMETIC_OPEN,
  HERMETIC_CLOSED,
}

export interface Door {
  idx: number;             // cell index
  state: DoorState;
  roomA: number;           // room id or -1
  roomB: number;
  keyId: string;           // item def id needed ("" = no key)
  timer: number;           // auto-close timer
  hp?: number;
  maxHp?: number;
}

// ── Entities ─────────────────────────────────────────────────────
export enum EntityType {
  NPC,
  MONSTER,
  ITEM_DROP,
  PROJECTILE,
  BILLBOARD, // non-interactive visible prop entity: desks, train cars, large decor
  EFFECT,
  LIGHT,
}

/** Special projectile behaviour tags */
export enum ProjType {
  NORMAL,       // default: straight-line, single-hit
  GRENADE,      // arc physics, explodes on timer/impact, scorch decal
  FLAME,        // short range, leaves fire trail on floor
  BFG,          // slow orb, on impact huge AoE + green screen flash
  BEAM,         // continuous beam (psi kamehameha)
  WEB,          // sticky monster shot, applies bounded web slow/root
}

export enum DamageType { KINETIC = 0, BUCKSHOT = 1, ENERGY = 2, FIRE = 3, PSI = 4 }

export enum MonsterKind {
  SBORKA,     // fast, weak               — бегает быстро
  TVAR,       // medium                   — ходит за стенами
  POLZUN,     // slow, strong, creepy     — вылезает из-под пола
  BETONNIK,   // rare boss, very strong   — бетонная тварь
  ZOMBIE,     // humanoid undead          — мертвяк
  EYE,        // flying eye, ranged       — глаз (стреляет)
  NIGHTMARE,  // procedural horror        — кошмарище
  SHADOW,     // dark silhouette          — теневик
  REBAR,      // inorganic rebar monster  — арматура
  MATKA,      // spawner boss             — матка
  IDOL,       // immobile psi monolith    — идол
  MANCOBUS,   // fat boss controller      — манкобус (управляет тварями)
  HERALD,     // thin tree-like watcher   — вестник (свисающие глаза)
  CREATOR,    // final boss               — творец (белый силуэт)
  SPIRIT,     // ghostly skull face       — дух (летает сквозь стены)
  ROBOT,      // industrial automaton     — робот (стреляет плазмой)
  SHOVNIK,    // seam hunter              — шовник (сильнее у стен)
  LAMPOVY,    // light-fed threat         — ламповый (сильнее у ламп)
  PECHATEED,  // document eater           — печатеед (чует бумаги)
  TUBE_EEL,   // water/pipe ambusher      — трубный угорь (быстрее в воде)
  PARAGRAPH,  // hostile document         — параграф (дальний бой)
  NELYUD,     // false human              — нелюдь (ждёт близкой дистанции)
  KRYSNOZHKA, // food/garbage swarm       — крысоножка (идёт на приманку)
  KOSTOREZ,   // melee elite              — косторез (читабельный рывок)
  SAFEGUARD,  // NET/BLAME blade guard    — сейфгард (быстрый охранитель)
  BLACK_LIQUIDATOR, // false cleanup patrol — черный ликвидатор
  KHOROVAYA_MATKA, // choir countdown spawner — хоровая матка
  SLIMEVIK,   // neutral slime scavenger  — слизневик (бартер и риск контакта)
  SOBRANNYY,  // post-samosbor composite  — собранный человек (растет от боя)
  ZHORNAYA_TVAR, // scent-lunge predator  — жорная тварь (уходит на еду)
  BEZEKHIY,   // door-threshold ambusher  — безэхий (спина к проему)
  PSEUDOLIFT, // elevator mimic trap      — псевдолифт (ловушка маршрута)
  SLEPOGLAZ,  // blind last-sound turret  — слепоглаз (стреляет туда, где шумели)
  OLGOY,      // collector meat worm      — олгой-хорхой (мясо, трубы, рывок)
  VODYANOY_KOSHMAR, // water-line PSI predator — водяной кошмар (давление по мокрой линии)
  LAMPOGLAZ,  // light-linked turret      — лампоглаз (стреляет по свету)
  TUMANNIK,   // fog-pocket ambusher      — туманник (ложный силуэт)
  CHERNOSLIZ, // black-water ambush eye   — чернослиз (первый выстрел из воды)
  RZHAVNIK,   // scrap-disguise ambusher  — ржавник (первый рывок из металлолома)
  BETONOED,   // weak-wall breacher       — бетоноед (прогрызает слабые стены)
  PANELNIK,   // wall-braced slab bruiser — панельник (силён у стены)
  PAUPSINA,   // web-spitting service spider — паупсина
  BORSHCHEVIK, // rooted hostile plant    — борщевик (сок, семена, корни)
  OBZHIVALSHCHIK, // room-bound resident aberration — комнатный обживальщик
  HEAD_SLUG,  // host parasite            — головной слизень (ворует носителя)
  PROTOKOLNIK, // document-pressure horror — протокольник (давит бумагами)
  DIKIY_MERTVYAK, // fragile crowd-runner — дикий мертвяк (дверной затор)
  KONTORSHCHIK, // document-scent undead  — конторщик (идет на бумаги)

  TONKAYA_TEN, // bait-line shadow lure   — тонкая тень (отступает к темной линии)
  KANTSELYARSKIY_IDOL, // office-field psi hazard — канцелярский идол
  LOZHNYY_DUKH, // door phaser            — ложный дух (один проход через дверь)
  CHERVIE_AVATAR, // net-borne AI avatar  — Червие (экранный импульс)
  POMOYNY_ROY, // food-attracted garbage swarm — помойный рой (окружает по запаху)
  SCULPTURE, // SCP-173 weeping angel
  TRUBNYY_AVTOMAT, // wet-line machine    — трубный автомат (заряжает мокрую прямую)
  LOTOCHNIK,  // wet-service crawler      — лоточник (броня в воде)
  TRESKOTNIK, // brittle crack sprinter    — трескотник (сбиваемый рывок)
  ZAKALENNAYA_ARMATURA, // armored rebar elite — закаленная арматура
  GLUBINNAYA_TEN, // delayed second-beat shadow — глубинная тень
  GREEN_DOG,  // mossy door-pack predator — зеленая собака (боится громкого металла)
  SLIME_WOMAN, // toxic slime humanoid    — жижевая женщина (вода сильнее, сухой свет слабит)
  GNILUSHKA,  // defensive neutral mutant  — гнилушка (говорит, бежит, дерется в углу)
  MUKHOZHUK_HOST, // parasite authority host — мухожук-носитель (локальные дурные приказы)
  FOG_SHARK,  // fog-swimming pack predator — туманная акула (горит взрывом)
  BLOOD_PLANT, // rooted red-mold hive source — кровавое растение
  SWARM,      // vent/void source swarm   — рой (источник в щели или вентиляции)
  SPORE_CARPET, // lurking domestic spore rug — ковер (просыпается у лута)
  LISHENNYY,  // deep light-following shadow guardian — лишенный
  GNOME,      // small fast humanoid mutant — гном
}

export type CharacterSex = 'male' | 'female';

export type PlayerDamageSourceKind = 'monster' | 'npc' | 'projectile' | 'hazard' | 'need' | 'samosbor' | 'void' | 'unknown';

export interface PlayerDamageRecord {
  time: number;
  tick: number;
  amount: number;
  sourceKind: PlayerDamageSourceKind;
  sourceId?: number;
  sourceName: string;
  monsterKind?: MonsterKind;
  weaponId?: string;
  detail: string;
}

// ── Factions ─────────────────────────────────────────────────────
export interface FactionMacroGoal {
  id: number;
  type: 'attack' | 'defend';
  targetZone: number;
  members: number[];
  factionId: Faction;
}

export enum Faction {
  CITIZEN,     // граждане
  LIQUIDATOR,  // ликвидаторы
  CULTIST,     // культисты
  SCIENTIST,   // учёные
  WILD,        // дикие
  PLAYER,      // игрок (отдельная фракция в системе отношений)
}

// ── Zone control factions ────────────────────────────────────────
export enum ZoneFaction {
  CITIZEN,     // граждане
  LIQUIDATOR,  // ликвидаторы
  CULTIST,     // культисты
  SAMOSBOR,    // самосбор (захваченная зона)
  WILD,        // дикие
  SCIENTIST,   // ученые / НИИ
}

export type TerritoryOwner = ZoneFaction;

// ── Zones (64 macro-regions ~128×128) ────────────────────────────
export interface Zone {
  id: number;
  cx: number; cy: number;     // center cell
  faction: ZoneFaction;
  hasLift: boolean;
  fogged: boolean;            // фиолетовый туман active
  level: number;              // zone danger level (scales monsters & loot)
  hqRoomId: number;           // room id of faction HQ in this zone (-1 = none)
  territoryCounts?: Uint16Array;
}

// ── Occupations ──────────────────────────────────────────────────
export enum Occupation {
  HOUSEWIFE,   // домохозяйка
  LOCKSMITH,   // слесарь
  SECRETARY,   // секретарь
  ELECTRICIAN, // электрик
  COOK,        // повар
  DOCTOR,      // врач
  TURNER,      // токарь
  MECHANIC,    // механик
  STOREKEEPER, // кладовщик
  ALCOHOLIC,   // алкоголик
  SCIENTIST,   // учёный
  CHILD,       // ребёнок
  DIRECTOR,    // директор
  TRAVELER,    // путник — бродит по лабиринту
  PILGRIM,     // паломник — бродит по лабиринту (культист)
  HUNTER,      // охотник — бродит по лабиринту (ликвидатор)
  PRIEST,      // батюшка — священник в храме
  PERFORMER,   // перформер — сцена, слухи, служебные двери
  CLEANER,     // уборщица — чистит следы и быт
  WORKER69,    // работница этажа 69 — служебные комнаты, долги, сцена
  ENGINEER,    // инженер
  TEACHER,     // учитель
  CIVIL_DEFENSE, // гражданская оборона
}

export interface Needs {
  food:  number;   // 0‥100   lower = hungrier
  water: number;
  sleep: number;
  pee:   number;   // 0‥100   higher = more urgent
  poo:   number;
  pendingPee?: number;  // pending digestion → passive pee growth
  pendingPoo?: number;  // pending digestion → passive poo growth
}

// ── RPG stats (level, XP, attributes, PSI) ───────────────────────
export interface RPGStats {
  level: number;
  xp: number;
  attrPoints: number;      // unspent attribute points
  str: number;             // сила: melee dmg + maxHP scaling
  agi: number;             // ловкость: movement/attack/spread scaling
  int: number;             // интеллект: maxPsi, XP, reward and PSI cost scaling
  psi: number;             // current PSI (mana)
  maxPsi: number;          // base max PSI (scaled by INT)
}

export type PlayerStatusId = 'zhelemish_skin' | 'govnyak_relief' | 'govnyak_cough' | 'govnyak_debt' | 'paupsina_web' | 'spore_haze';
export type PlayerStatusSource =
  | 'zhelemish_raw'
  | 'zhelemish_treated'
  | 'govnyak_roll'
  | 'govnyak_brick'
  | 'govnyak_sample'
  | 'govnyak_bad_batch'
  | 'paupsina_web'
  | 'spore_carpet'
  | 'debug';

export interface PlayerStatus {
  id: PlayerStatusId;
  source: PlayerStatusSource;
  startedAt: number;
  expiresAt: number;
  intensity?: number;
  badReaction?: boolean;
}

export enum AIGoal {
  IDLE, GOTO, EAT, DRINK, SLEEP, TOILET, WORK, HIDE, HUNT, FLEE, WANDER,
}

// ── NPC visible/debug states derived from local utility intents ───
export enum NpcState {
  SLEEPING,    // sleep/rest intent
  MORNING,     // toilet/personal upkeep intent
  WORKING,     // work/profession intent
  LUNCH,       // eat/drink intent
  FREE_TIME,   // social/wander/low-pressure intent
  HIDING,      // safety/flee intent
  TRAVELING,   // traveler movement intent
  MEETING,     // social/coordination intent
  PATROL,      // patrol/combat-readiness intent
  BREAK,       // legacy display label for short rest
}



export interface MonsterBaitLineState {
  x: number;
  y: number;
  dx: number;
  dy: number;
  nerve: number;
  armed: boolean;
  spent: boolean;
}

export interface AIState {
  goal: AIGoal;
  tx: number; ty: number;     // target position
  path: number[];             // cell indices
  pi: number;                 // path index
  stuck: number;
  timer: number;
  npcState?: NpcState;        // visible/debug state derived from the current NPC intent
  stateTimer?: number;        // elapsed time in current sub-activity
  combatTargetId?: number;    // cached hostile target entity id
  combatScanCd?: number;      // cooldown until next full hostile scan
  windupTimer?: number;       // generic readable attack windup countdown
  windupTargetId?: number;    // target locked by current windup
  windupStartHp?: number;     // HP snapshot for interruptible windups
  staggerTimer?: number;      // temporary interrupt / stagger lockout
  lastSeenTargetId?: number;  // event throttle for first sight / escape beats
  lastSeenUrinationId?: number;
  microScanCd?: number;       // cooldown until next micro stimulus scan
  sprintTimer?: number;       // straight-line special burst countdown
  sprintDx?: number;          // normalized burst direction X
  sprintDy?: number;          // normalized burst direction Y
  bossPhaseIndex?: number;    // last announced boss phase cue
  baitMarkerId?: number;      // cached monster bait marker id
  baitScanCd?: number;        // cooldown until next bounded bait scan
  baitLine?: MonsterBaitLineState; // Tonkaya Ten prepared dark corridor/door line
  secondBeatX?: number;       // Glubinnaya Ten delayed afterimage anchor
  secondBeatY?: number;
  secondBeatTargetX?: number; // target position when the afterimage was armed
  secondBeatTargetY?: number;
  secondBeatDx?: number;      // offset strike direction, normalized
  secondBeatDy?: number;
  secondBeatTimer?: number;
  secondBeatHold?: number;    // target stood still long enough to collapse bait
  lightScanCd?: number;       // Лишенный bounded light-source scan cooldown
  lightTargetX?: number;
  lightTargetY?: number;
  lightTargetId?: number;
  lightTargetKind?: 'actor' | 'drop' | 'feature';
  lightAvoidTimer?: number;   // short UV/bright-cell repulsion window
  lightCueAt?: number;
  parasiteRehostCd?: number;  // Head slug bounded corpse/stunned-host scan cooldown
  parasiteScanOffset?: number; // Head slug rotating corpse scan cursor; avoids full entity scans
  parasiteQuarantineCd?: number; // Head slug sealed-room event throttle
  meatTargetId?: number;      // Olgoy cached corpse target id
  meatScanCd?: number;        // Olgoy bounded corpse scent scan cooldown
  meatScanOffset?: number;    // Olgoy rotating corpse scan offset
  choirCountdown?: number;    // хоровая матка: seconds until wet choir spawn
  choirCueStep?: number;      // last announced countdown step
  choirChildIds?: number[];   // capped child ids owned by a spawner encounter
  choirLastChildCount?: number;
  choirSpawnedChildren?: number;
  choirVulnerableTimer?: number;
  choirLastHp?: number;       // damage gate memory while membranes are closed
  sourceChildIds?: number[];  // generic source/hive-owned children, cleaned when source resolves
  sourceEntityId?: number;    // child backlink to its source entity
  sourceSpawnedChildren?: number; // deterministic spawn slot cursor for source/hive children
  protocolPressure?: number;  // Протокольник PSI pressure, capped and HUD-readable
  protocolExposure?: number;  // seconds spent in the current protocol chase
  protocolPressurePulseCd?: number;
  protocolPressureWarnAt?: number;
  waterPressure?: number;     // Водяной кошмар: capped wet-line PSI pressure
  waterLineScanCd?: number;   // slow bounded wet-connectivity scan cooldown
  waterLineBreakTimer?: number; // dry concrete interruption grace
  waterLinePulseCd?: number;  // readable pressure damage/drain cadence
  waterLineTargetId?: number; // target id validated by the last wet-line scan
  waterLineConnected?: boolean;
  waterLineCueCd?: number;    // visual ripple cue cooldown
  homeRoomId?: number;        // local-room leash anchor for room-bound actors
  anger?: number;             // bounded local pressure/hostility meter
  growthCount?: number;       // bounded local residue/growth marks placed
  growthCd?: number;          // cooldown for local residue/growth
  scratchCd?: number;         // cooldown for local audible/readable room beats
  lastNoiseId?: number;       // last processed bounded noise record
  lastRoomMemoryEventId?: number; // last processed communal room-memory fact
  breached?: boolean;         // room-bound actor has crossed its leash
  ambientBarkCd?: number;     // cooldown for rare generic A-Life chatter
  wanderAngle?: number;        // phasing monster drift direction
  netPulseCd?: number;         // Chervie/net possessor local mind pulse cooldown
  netPowered?: boolean;        // last readable local NET power state
  netAnchorX?: number;         // local compromised server/terminal anchor
  netAnchorY?: number;
  slimeScanCd?: number;        // Slimevik cached local slime search cooldown
  slimeTargetX?: number;       // Slimevik cached slime mark/room target
  slimeTargetY?: number;
  slimeContactTimer?: number;  // Slimevik close-contact exposure timer
  slimeContactCd?: number;     // Slimevik contact risk cooldown
  compositeDormant?: boolean;  // Sobrannyy idle state before room/contact wakeup
  compositeArmorUntil?: number; // short wake window that ignores small damage
  compositeIsolatedUntil?: number; // isolation feedback throttle
  meatGrowthStacks?: number;   // bounded temporary composite growth
  meatGrowthUntil?: number;    // time when growth stacks expire
  meatGrowthHitWindowUntil?: number; // repeated-hit window end
  meatGrowthHitPressure?: number; // accumulated hit pressure in current window
  deadEchoHold?: number;        // Bezekhiy direct-look reveal hold
  deadEchoRevealed?: boolean;   // Bezekhiy has become audible/ordinary
  deadEchoSpent?: boolean;      // Bezekhiy one-shot threshold bonus spent
  deadEchoDoorIdx?: number;     // Bezekhiy cached nearest door threshold
  deadEchoDoorSide?: number;    // Last player side of cached threshold
  wallBraceWasActive?: boolean; // Panelnik touched a wall on a previous brace tick
  wallBraceSlowTimer?: number;  // brief slowdown after wall-brace is broken in open floor
  wallBraceCueAt?: number;      // next allowed wall-brace readability message time
  wallBiasWasActive?: boolean;  // wall-edge monsters had a wall/corner advantage recently
  wallBiasCueAt?: number;       // next allowed wall-edge readability message time
  scrapWake?: number;           // Rzhavnik: 0 dormant, 1 first leap, 2 fragile walker
  scrapWakeTimer?: number;      // Rzhavnik first-leap timebox
  plantPuffCd?: number;         // rooted plant seed/sap burst cooldown
  plantRootCd?: number;         // sparse authored root-structure cooldown
  sporePuffCd?: number;         // Spore Carpet bounded local puff cooldown
  sporeRecoilTimer?: number;    // Spore Carpet fire recoil window
  sporeContainerScanCd?: number; // Spore Carpet throttled nearby-container event scan
  sporeLastContainerEventId?: number;
  sporeBurnedAt?: number;       // fire event throttle
  shoveCharge?: number;         // Dikiy Mertvyak crowd shove momentum
  shoveCooldown?: number;       // cooldown after a crowd shove burst
  shoveStartHp?: number;        // initial HP snapshot; any early damage cancels shove
  falsePhaseCd?: number;        // Ложный Дух: cooldown before next local door phase
  falsePhaseActive?: number;    // Ложный Дух: brief interruptible post-crossing reveal
  falsePhaseDoorIdx?: number;   // Ложный Дух: closed door used by the queued local phase
  falsePhaseX?: number;         // Ложный Дух: queued local door landing x
  falsePhaseY?: number;         // Ложный Дух: queued local door landing y
  fogOffsetX?: number;          // Туманник: fake visible silhouette offset from real body
  fogOffsetY?: number;
  fogOffsetUntil?: number;      // time when the fake silhouette expires without refresh
  fogOffsetCollapsedUntil?: number; // short reveal window after light/fire/leaving fog
  fogOffsetNoiseId?: number;    // last noise record used to bias the displaced origin
  fogOffsetCueAt?: number;      // throttle for local readability messages
  falsePatrolRevealed?: boolean; // Черный ликвидатор: fake cleanup phase has broken
  falsePatrolDoorIdx?: number;   // Черный ликвидатор: cached local door waypoint
  falsePatrolScanCd?: number;    // Черный ликвидатор: bounded local door scan cooldown
  falsePatrolKnockCd?: number;   // Черный ликвидатор: door-knock event cooldown
  parasiteExposed?: boolean;    // Мухожук: reveal/readability beat already published
  parasiteCommandCd?: number;   // Мухожук: bounded local command pulse cooldown
  parasiteFoodScanCd?: number;  // Мухожук: throttled container appetite scan
  parasiteFoodScanOffset?: number; // Мухожук: rotating container scan start
  parasiteFoodTargetContainerId?: number;
  tacticId?: string;             // generic actor tactic profile state, transient
  tacticPhase?: string;          // current tactic sub-phase
  tacticTimer?: number;          // current tactic remaining seconds
  tacticCooldown?: number;       // cooldown before selecting another tactic
  tacticSenseCd?: number;        // cooldown before bounded local fact refresh
  tacticActionCd?: number;       // tactic-local action/event cooldown
  tacticEventCd?: number;        // tactic-local readable event/message cooldown
  tacticPressure?: number;       // last processed bounded stimulus pressure
  tacticNearbyHostiles?: number; // cached bounded local hostile count
  tacticNearbyActors?: number;   // cached bounded local actor count
  tacticTargetId?: number;       // cached tactic target id
  tacticTargetDist2?: number;    // cached squared target distance
  tacticThreatX?: number;        // cached local pressure/centroid X
  tacticThreatY?: number;        // cached local pressure/centroid Y
  tacticAnchorX?: number;        // cached local terrain/anchor X
  tacticAnchorY?: number;        // cached local terrain/anchor Y
  tacticFlags?: number;          // compact tactic fact/debug bitset
  // ── Micro-goal (temporary interruption of macro routine) ──────
  microGoalId?: string;            // active micro-goal: 'greet', 'investigate_noise', 'search_lkp', 'pack_pulse', 'reposition'
  microTargetX?: number;           // local target world coordinate
  microTargetY?: number;
  microTimer?: number;             // remaining seconds; when ≤ 0, micro-goal is cleared
  microSourceId?: number;          // optional: entity id that triggered the micro-goal
  microCooldowns?: Record<string, number>; // remaining seconds before a micro-goal type can trigger again
}

export interface Entity {
  id: number;
  type: EntityType;
  x: number; y: number;
  angle: number;
  pitch: number;              // vertical look: -1..1 (y-shearing)
  alive: boolean;
  speed: number;
  sprite: number;             // sprite sheet index
  spriteSeed?: number;        // deterministic per-entity procedural visual seed
  npcVisualId?: string;        // optional special NPC visual generator family
  // optional components
  needs?: Needs;
  hp?: number;
  maxHp?: number;
  ai?: AIState;
  inventory?: Item[];
  name?: string;
  firstName?: string;
  lastName?: string;
  staggerTimer?: number;       // hit stagger lock/stun duration
  monsterKind?: MonsterKind;
  monsterDmgMult?: number;     // authored temporary monster damage multiplier
  monsterArmorStacks?: number;  // stripped armor state for standalone armored monsters
  monsterArmorChip?: number;    // bounded weak-hit chip progress toward armor strip
  monsterArmorLastStripAt?: number;
  monsterArmorLastMsgAt?: number;
  monsterStage?: number;       // monster-specific compact stage/state
  parasiteHostSkill?: number;  // Head slug copied host movement skill
  attackCd?: number;
  familyId?: number;
  weapon?: string;            // equipped item def id
  currentMag?: number;        // ammo remaining in current magazine
  reloading?: boolean;        // true if currently reloading
  reloadTimer?: number;       // seconds remaining until reload completes
  tool?: string;              // equipped tool def id
  armorDefId?: string;
  faction?: Faction;
  occupation?: Occupation;
  originalOccupation?: Occupation; // remembered profession when changed during emergency
  age?: number;                // compact character age; cold A-Life stores it as one byte
  sex?: CharacterSex;          // social/gameplay sex code; isFemale remains the grammar mirror
  playerRelation?: number;    // personal attitude to player, -100..100; below hostile threshold attacks
  karma?: number;             // A-Life moral/social charge, -127..127; player starts at 0
  kills?: number;             // total actor kills for A-Life ranking
  npcKills?: number;          // NPC kills for A-Life ranking
  monsterKills?: number;      // monster kills for A-Life ranking
  isTraveler?: boolean;       // путник/паломник/охотник — бродит по лабиринту
  assignedRoomId?: number;    // назначенный кабинет (министерство)
  questId?: number;           // active quest given by this NPC (-1 = none)
  canGiveQuest?: boolean;     // authored/current quest affordance; persistent A-Life NPCs are valid quest candidates
  alifeId?: number;           // persistent procedural NPC identity
  persistentNpcId?: string;   // stable non-plot NPC key, e.g. alife:123
  money?: number;             // наличные рубли
  accountRubles?: number;     // банковский счет; у игрока основной счет хранится в GameState.banking
  height?: number;            // base physical height in meters (human adults ~ 1.8)
  radius?: number;            // physical collision boundary radius override
  spriteScale?: number;       // sprite size multiplier (child = 0.6)
  spriteZ?: number;           // vertical offset: 0=ground, 0.5=eye level (projectiles)
  plotNpcId?: string;         // story NPC key (e.g. 'olga', 'barni', 'yakov') — see data/plot.ts
  plotDone?: boolean;         // story phase ended, NPC switches to post-plot dialogue
  _plotTalkIdx?: number;      // internal: sequential dialogue line counter
  // projectile fields
  vx?: number; vy?: number;   // velocity (cells/sec)
  vz?: number;                // vertical velocity (units/sec, affects spriteZ)
  projDmg?: number;           // projectile damage
  projLife?: number;          // remaining lifetime (seconds)
  ownerId?: number;           // entity that fired this
  aoeRadius?: number;         // AoE explosion radius on impact
  aoeDmg?: number;            // AoE damage on impact
  projType?: ProjType;        // special projectile behaviour
  projGore?: number;          // gore intensity 1-3 (1=clean, 3=messy)
  burnTimer?: number;         // fire: remaining burn time on floor cell
  rpg?: RPGStats;             // RPG stats (level, XP, attributes)
  statuses?: PlayerStatus[];  // bounded timed player/NPC conditions
  isFemale?: boolean;          // gender for kill message grammar
  isFogBoss?: boolean;         // fog boss — killing stops fog in zone
  fogBossZone?: number;        // zone id this boss guards
  matkaTimer?: number;         // матка spawn timer (seconds until next spawn)
  psiMadness?: number;         // remaining seconds of PSI madness (attacks everyone)
  psiControlledBy?: number;    // entity id of PSI controller (ally override)
  phasing?: boolean;           // can move through walls (spirit)
  protocolPressureTier?: number; // quantized sprite cue for Протокольник pressure
  activeBark?: { text: string; until: number; color: string; }; // UI: active world speech bubble
}

export type PlayerAlife = Pick<Entity, 'persistentNpcId' | 'age' | 'sex' | 'isFemale' | 'playerRelation' | 'karma' | 'kills' | 'npcKills' | 'monsterKills' | 'height'>;

// ── Items ────────────────────────────────────────────────────────

export enum ItemType { FOOD, DRINK, MEDICINE, WEAPON, TOOL, KEY, NOTE, MISC, AMMO }

export interface ItemDef {
  id: string;
  name: string;
  type: ItemType;
  desc: string;
  spawnRooms: RoomType[];
  spawnW: number;             // spawn weight
  value: number;              // price in рубли (0 = worthless)
  resistances?: Partial<Record<DamageType, number>>;
  tags?: readonly string[];   // small content labels for events/economy hooks
  scienceValue?: number;      // 0-100: value to NII/scientists; scales special handoff interactions
  contrabandScore?: number;   // 0-100: degree of illegality; scales liquidator confiscation chance/severity
  deceptiveScore?: number;    // 0-100: how dangerous/fake the item looks (e.g. silver slime); creates suspicion
  stack?: number;             // override max stack size
  durability?: number;        // max durability for tools/consumable kits

  use?: (e: Entity) => string; // returns message
}

export interface Item {
  defId: string;
  count: number;
  data?: unknown;              // key roomId, note text, etc.
}

export type MutableCraftVector = [number, number, number, number, number, number, number, number, number];

export interface CraftingState {
  materials: MutableCraftVector;
  knownRecipes: Record<string, true>;
  learnedCount: number;
  lastChangedAt: number;
}

// ── Containers ──────────────────────────────────────────────────
export enum ContainerKind {
  WOODEN_CHEST,
  METAL_CABINET,
  MEDICAL_CABINET,
  WEAPON_CRATE,
  FRIDGE,
  SAFE,
  FILING_CABINET,
  CASHBOX,
  SECRET_STASH,
  EMERGENCY_BOX,
  TRASH_BIN,
  TOOL_LOCKER,
}

export type ContainerAccess = 'public' | 'room' | 'faction' | 'owner' | 'locked' | 'secret';

export interface WorldContainer {
  id: number;
  x: number;
  y: number;
  floor: FloorLevel;
  roomId: number;
  zoneId: number;
  kind: ContainerKind;
  name: string;
  inventory: Item[];
  capacitySlots: number;
  ownerNpcId?: number;
  ownerName?: string;
  faction?: Faction;
  access: ContainerAccess;
  lockDifficulty?: number;
  discovered: boolean;
  stolenItemIds?: string[];
  lastOpenedBy?: number;
  lastOpenedAt?: number;
  lastAuditAt?: number;
  factoryId?: string;
  lastProducedAt?: number;
  lastProducedItemId?: string;
  lastProducedCount?: number;
  productionBlockedReason?: 'no_inputs' | 'container_full' | 'no_container';
  tags: string[];
}

// ── Rail trains ─────────────────────────────────────────────────
export interface RailTrainTrack {
  id: string;
  label: string;
  cells: number[];
  stationOffsets: number[];
  platformCells: number[];
  loop: boolean;
}

export interface RailTrain {
  id: string;
  label: string;
  trackId: string;
  offset: number;
  speed: number;
  length: number;
  direction: 1 | -1;
  stopSeconds: number;
  stopUntil: number;
  passengerId: number;
  passengerSeat: number;
  entityIds: number[];
  lastStopOffset: number;
  nextWarnAt: number;
  nextCrushAt: number;
  nextDoorMsgAt: number;
}

// ── Quests ────────────────────────────────────────────────────────
export enum QuestType { FETCH, VISIT, KILL, TALK }

export interface QuestTargetMarker {
  floor?: FloorLevel;
  roomType?: RoomType;
  roomName?: string;
  zoneTag?: string;
  designFloorId?: string;
  proceduralTag?: string;
  routeZ?: number;
  risk?: number;
}

export interface Quest {
  id: number;
  type: QuestType;
  giverId: number;            // NPC entity id
  giverName: string;
  desc: string;
  // FETCH: targetItem + targetCount
  targetItem?: string;        // item def id
  targetCount?: number;
  // VISIT: targetRoom
  targetRoom?: number;        // room id
  // Generic route target metadata; unlike visitFloor, targetFloor is only a hint.
  targetFloor?: FloorLevel;
  targetRoomType?: RoomType;
  targetRoomName?: string;
  targetZoneTag?: string;
  targetMarker?: QuestTargetMarker;
  targetRoute?: {
    designFloorId?: string;
    z?: number;
    anomalyId?: string;
    proceduralTag?: string;
    tags?: readonly string[];
    label?: string;
    risk?: number;
  };
  targetHint?: string;
  // KILL: targetMonsterKind + killCount/killNeeded
  targetMonsterKind?: MonsterKind;
  killCount?: number;
  killNeeded?: number;
  // TALK: targetNpcId
  targetNpcId?: number;
  targetNpcName?: string;
  targetPlotNpcId?: string;  // plot NPC key for cross-floor TALK quests
  // reward
  rewardItem?: string;
  rewardCount?: number;
  extraRewards?: {defId: string; count: number}[];  // additional rewards
  relationDelta?: number;     // how much relation changes on completion
  difficulty?: number;        // difficulty modifier (scales XP & rewards)
  xpReward?: number;          // XP reward on completion
  moneyReward?: number;       // money reward on completion
  plotStepIndex?: number;     // index into PLOT_CHAIN (story quests only)
  sideQuestId?: string;       // id from SIDE_QUESTS (hand-designed side quests)
  contractId?: string;        // AG10 contract wrapper id
  contractFaction?: Faction;  // issuer faction for generated contracts
  contractRank?: number;      // license/difficulty tier
  visitFloor?: FloorLevel;    // auto-complete VISIT quest when entering this floor
  holdSeconds?: number;       // VISIT: remain at target this many real seconds
  holdProgressSeconds?: number;
  holdLastTime?: number;
  holdResetOnExit?: boolean;
  holdSpawnMonsters?: number; // VISIT holdout: monsters per pressure wave
  holdSpawnIntervalSeconds?: number;
  holdSpawnMaxAlive?: number;
  holdSpawnLastTime?: number;
  eventTags?: string[];       // extra tags for authored quest events
  eventData?: Record<string, unknown>; // extra compact data for authored quest events
  eventPrivacy?: WorldEventPrivacy; // privacy override for authored quest events
  eventSeverity?: WorldEventSeverity; // severity override for authored quest events
  eventTargetName?: string;   // completed event summary override
  failOnNpcDeathPlotId?: string; // fail when this plot NPC dies
  abandonsSideQuestIds?: string[]; // completing this quest fails these active side quests
  timeLimitMinutes?: number;  // procedural quests, or authored quests that explicitly opt into a deadline
  expiresAtMinutes?: number;  // absolute GameClock.totalMinutes deadline
  failed?: boolean;           // true when a timed procedural quest expired
  done: boolean;
}

// ── World events / context facts ────────────────────────────────
export const WORLD_EVENT_RECENT_CAPACITY = 512;
export const WORLD_EVENT_IMPORTANT_CAPACITY = 128;
export const WORLD_EVENT_ZONE_CAPACITY = 32;
export const WORLD_EVENT_ZONE_COUNT = 64;

export const WORLD_EVENT_TYPES = [
  'npc_enter_zone',
  'npc_leave_zone',
  'npc_enter_room',
  'npc_need_low',
  'npc_pick_item',
  'npc_drop_item',
  'npc_store_item',
  'npc_take_from_container',
  'container_looted',
  'container_opened',
  'interactive_used',
  'item_stolen',
  'item_deposited',
  'room_produced_items',
  'room_lacked_resources',
  'room_blocked_production',
  'urination_public',
  'npc_kill_monster',
  'npc_kill_npc',
  'player_kill_monster',
  'player_kill_npc',
  'player_hurt_npc',
  'player_pick_item',
  'player_drop_item',
  'player_use_item',
  'player_disassemble_item',
  'player_craft_item',
  'craft_recipe_learned',
  'player_sell_item',
  'player_handoff_item',
  'player_destroy_item',
  'player_urinated',
  'permit_forged',
  'permit_exposed',
  'access_granted',
  'player_status_applied',
  'player_status_expired',
  'player_status_cured',
  'player_status_bad_reaction',
  'tool_broke',
  'ammo_consumed',
  'gravity_beam_fired',
  'uv_spotlight_used',
  'uv_spotlight_target_affected',
  'uv_spotlight_depleted',
  'monster_bait_placed',
  'monster_bait_attracted',
  'monster_bait_consumed',
  'monster_bait_expired',
  'samosbor_warning',
  'samosbor_started',
  'samosbor_zone_captured',
  'samosbor_ended',
  'hermodoor_borer_detected',
  'hermodoor_borer_damage',
  'hermodoor_borer_repaired',
  'hermodoor_borer_compromised',
  'fog_boss_spawned',
  'fog_boss_killed',
  'monster_sighted',
  'lishennyy_lured',
  'lishennyy_contact_decay',
  'monster_windup_interrupted',
  'monster_armor_cut',
  'monster_escaped',
  'false_liquidator_knock',
  'false_liquidator_revealed',
  'green_dog_howl',
  'green_dog_scared',
  'fog_shark_pack_sighted',
  'fog_shark_ignited',
  'borshchevik_cut',
  'borshchevik_burned',
  'borshchevik_seed_puff',
  'blood_plant_root_cut',
  'blood_plant_burned',
  'red_mold_exposed',
  'spore_carpet_woke',
  'spore_carpet_burned',
  'spore_carpet_puff',
  'paupsina_webbed',
  'paupsina_web_cut',
  'olgoy_burrowed',
  'olgoy_fed',
  'olgoy_dragged_target',
  'composite_woke',
  'composite_growth',
  'composite_isolated',
  'smog_entered',
  'smog_source_found',
  'smog_source_handled',
  'bad_apple_spawned',
  'bad_apple_toggled',
  'metro_route_taken',
  'metro_wrong_stop',
  'rail_train_boarded',
  'rail_train_exited',
  'rail_train_crush',
  'emergency_panel_used',
  'gambling_bet',
  'gambling_win',
  'gambling_loss',
  'computer_data_stolen',
  'net_terminal_hacked',
  'net_terminal_hack_failed',
  'chervie_signal',
  'chervie_server_cut',
  'chervie_false_order',
  'quest_created',
  'quest_completed',
  'quest_failed',
  'contract_created',
  'contract_completed',
  'contract_failed',
  'ration_coupon_spent',
  'ration_coupon_stolen',
  'ration_coupon_forged',
  'ration_coupon_reported',
  'ration_audit_resolved',
  'shelter_tally_handled',
  'rumor_observed',
  'rumor_spread',
  'faction_event',
  'faction_patrol_clash',
  'mugging_start',
  'mugging_payment',
  'mugging_refusal',
  'mugging_end',
  'floor_transition',
  'alife_migration',
  'elevator_anomaly',
  'elevator_loop_exit',
  'lift_arachna_warned',
  'lift_arachna_sprung',
  'lift_arachna_avoided',
  'lift_arachna_cleared',
  'pseudolift_suspected',
  'pseudolift_revealed',
  'pseudolift_fed',
  'paritel_valve_changed',
  'paritel_bridge_crossed',
  'paritel_threat_neutralized',
  'paritel_steam_injury',
  'paritel_steam_avoided',
  'faction_relation_changed',
  'door_opened',
  'door_sealed',
  'room_regrown',
  'hazard_trapped',
  'hazard_escaped',
  'hazard_cleaned',
  'burn_cleanup',
  'fuel_empty',
  'collateral_damage',
  'void_protocol_obtained',
  'void_protocol_started',
  'void_protocol_ended',
  'void_protocol_backlash',
  'void_protocol_rejected',
  'krysnozhka_swarm_triggered',
  'krysnozhka_baited',
  'krysnozhka_dispersed',
  'krysnozhka_nest_cleared',
  'slimevik_bargain',
  'slimevik_harvested',
  'slimevik_killed',
  'slime_humanoid_sampled',
  'slime_humanoid_dried',
  'gnilushka_spared',
  'gnilushka_hurt',
  'gnilushka_delivered',
  'mukhozhuk_exposed',
  'mukhozhuk_food_spoiled',
  'head_slug_detached',
  'head_slug_rehosted',
  'head_slug_quarantined',
  'bezekhiy_revealed',
  'bezekhiy_lunge',
  'obzhivalshchik_scratched',
  'obzhivalshchik_calmed',
  'obzhivalshchik_breached',
  'matka_child_spawned',
  'swarm_source_sealed',
  'swarm_source_burned',
  'death_seen',
] as const;

export type WorldEventType = typeof WORLD_EVENT_TYPES[number];

export type WorldEventSeverity = 0 | 1 | 2 | 3 | 4 | 5;
export type WorldEventPrivacy = 'public' | 'local' | 'witnessed' | 'private' | 'secret';

export interface WorldEvent {
  id: number;
  type: WorldEventType;
  time: number;
  day: number;
  hour: number;
  minute: number;
  floor: FloorLevel;
  zoneId?: number;
  roomId?: number;
  x?: number;
  y?: number;
  actorId?: number;
  actorName?: string;
  actorFaction?: Faction;
  targetId?: number;
  targetName?: string;
  targetFaction?: Faction;
  itemId?: string;
  itemName?: string;
  itemCount?: number;
  itemValue?: number;
  monsterKind?: MonsterKind;
  containerId?: number;
  containerOwnerId?: number;
  containerFaction?: Faction;
  severity: WorldEventSeverity;
  privacy: WorldEventPrivacy;
  truth: 'fact';
  tags: string[];
  data?: Record<string, unknown>;
}

export type WorldEventDraft = Omit<WorldEvent, 'id' | 'time' | 'day' | 'hour' | 'minute' | 'floor' | 'truth'> & {
  time?: number;
  day?: number;
  hour?: number;
  minute?: number;
  floor?: FloorLevel;
  truth?: 'fact';
};

export interface ContextFact {
  id: number;
  eventId: number;
  kind: 'danger' | 'shortage' | 'theft' | 'death' | 'production' | 'need' | 'quest_hook' | 'social' | 'territory';
  subjectId?: number;
  subjectName?: string;
  zoneId?: number;
  roomId?: number;
  itemId?: string;
  faction?: Faction;
  score: number;
  expiresAt?: number;
  tags: string[];
}

export interface EventFilter {
  type?: WorldEventType;
  zoneId?: number;
  floor?: FloorLevel;
  minSeverity?: WorldEventSeverity;
  privacy?: WorldEventPrivacy;
  actorId?: number;
  targetId?: number;
  sinceId?: number;
  tags?: string[];
  limit?: number;
}

export interface WorldEventBuffer {
  capacity: number;
  start: number;
  count: number;
  items: (WorldEvent | null)[];
}

export interface WorldEventState {
  nextId: number;
  recentEvents: WorldEventBuffer;
  importantEvents: WorldEventBuffer;
  zoneEvents: WorldEventBuffer[];
  facts: ContextFact[];
  nextFactId: number;
  lastLogKey: string;
  lastLogTime: number;
}

// ── Game state ───────────────────────────────────────────────────
// ── Game clock (24h cycle) ────────────────────────────────────────
// 1 game hour = 60 real seconds, 1 game minute = 1 real second
// gameHour: 0-23, gameMinute: 0-59
export interface GameClock {
  hour: number;
  minute: number;
  totalMinutes: number;     // total minutes elapsed since game start
}

export type CraftMenuMode = 'craft' | 'disassemble';
export type CraftStationKind = 'any' | 'workbench' | 'lathe' | 'lab' | 'net_terminal';

export interface GameState {
  tick: number;
  time: number;
  clock: GameClock;
  samosborActive: boolean;
  samosborTimer: number;
  samosborCount: number;
  paused: boolean;
  gameOver: boolean;
  trailerMode?: boolean;
  tutorialMode?: boolean;
  tutorialStep?: number;
  showInventory: boolean;
  mapMode: number;          // 0=closed, 2=full map overlay; minimap is a UI setting
  fullMapRadius?: number;   // transient full-map zoom radius in cells; not part of save shape
  showQuests: boolean;
  invSel: number;
  msgs: Msg[];
  quests: Quest[];
  activeQuestId?: number;    // one player-selected quest for map guidance/current objective
  nextQuestId: number;
  currentFloor: FloorLevel;
  fogSpreadTimer: number;     // ticks between fog spread steps
  // ── Game menu (Enter) ──
  showMenu: boolean;
  menuSel: number;            // selected entry in the game menu
  // ── NPC interaction menu ──
  showNpcMenu: boolean;
  npcMenuSel: number;         // 0=talk, 1=quest, 2=trade
  npcMenuTarget: number;      // entity id
  npcMenuTab: string;         // 'main'|'talk'|'quest'|'trade'
  npcTalkText: string;
  questPage: number;
  tradeCursorX: number;       // column in active trade grid
  tradeCursorY: number;       // row in active trade grid
  tradeSide: string;          // 'player'|'player_offer'|'npc_offer'|'npc'|'deal'
  // ── Container interaction menu ──
  showContainerMenu: boolean;
  containerMenuTarget: number; // world container id
  containerCursorX: number;    // column in container grid
  containerCursorY: number;    // row in container grid
  containerSide: string;       // 'player'|'container'
  showCraftMenu: boolean;
  craftMode: CraftMenuMode;
  craftCursor: number;
  craftFilter: string;
  craftStationKind: CraftStationKind;
  showDebug: boolean;
  debugSel: number;
  showFactions: boolean;       // faction relations matrix (F key)
  factionRankScroll: number;   // A-Life leaderboard scroll inside F menu
  showDemos: boolean;           // read-only NPC infoset profile browser
  showFeedback: boolean;        // feedback and credits menu
  demosCursor: number;          // zero-based A-Life profile cursor
  demosSearch: string;          // transient in-menu search query
  demosSearchActive: boolean;   // text input focus for Demos search
  demosTab: 'profile' | 'links' | 'feed' | 'post' | 'quests';
  demosFeedScroll: number;
  demosPostCursor: number;
  showLog: boolean;            // message log menu (L key)
  logScroll: number;           // scroll offset in log menu
  showHelp: boolean;           // one-page HELP poster (F1 by default)
  showControls: boolean;       // hotkey / rebind screen (Tab by default)
  controlView: 'keys' | 'buttons';
  controlSel: number;
  controlScroll: number;
  showUiSettings: boolean;      // configurable HUD element screen
  uiSettingsView: 'interface' | 'graphics';
  uiSettingsSel: number;
  uiSettingsScroll: number;
  showMapLegend: boolean;       // separate full-map legend/settings screen
  mapLegendSel: number;
  mapLegendScroll: number;
  npcLogRadiusMeters?: number;  // audible NPC bark/log radius; default supplied by AI bark context
  msgLog: LogEntry[];          // persistent message log with timestamps
  dmgFlash: number;           // damage vignette intensity 0..1, decays over time
  dmgSeed: number;            // random seed for vein pattern per hit
  lastDamage?: PlayerDamageRecord;
  deathTimer: number;         // seconds since player death (for camera drop)
  sleeping: boolean;          // player is holding Z to sleep
  beamFx: number;            // PSI beam visual timer (seconds remaining)
  beamAngle: number;         // beam direction (radians)
  beamLen: number;           // beam length (cells)
  uvBeamFx: number;          // UV spotlight visual timer (seconds remaining)
  uvBeamLen: number;         // UV spotlight reach (cells)
  gameWon: boolean;          // end-screen victory flag; return portal now continues freeplay
  crafting: CraftingState;    // persistent player craft materials and known recipes
  worldEvents?: WorldEventState; // bounded structured event history; old saves may omit it
  factionGoals?: FactionMacroGoal[];
  factionGoalsTimer?: number;
}

export interface MsgLocation {
  floor?: FloorLevel;
  x?: number;
  y?: number;
  actorId?: number;
  targetId?: number;
  roomId?: number;
  zoneId?: number;
}

export interface Msg extends MsgLocation {
  text: string;
  time: number;
  color: string;
  day: number;
  hour: number;
  minute: number;
  distanceMeters?: number;
  hud?: boolean;              // transient display hint; msgLog/save payload ignores it
  hudPriority?: number;       // higher recent messages win the bounded HUD lane
}
export interface LogEntry extends MsgLocation {
  text: string;
  color: string;
  day: number;
  hour: number;
  minute: number;
  distanceMeters?: number;
}

/* ── Global msg factory — stores current clock, call setMsgClock each frame ── */
let _msgDay = 0, _msgHour = 8, _msgMin = 0;
let _msgLocationProvider: (() => MsgLocation | undefined) | undefined;
export function setMsgClock(clock: GameClock): void {
  _msgDay = Math.floor(clock.totalMinutes / 1440);
  _msgHour = clock.hour;
  _msgMin = clock.minute;
}
export function setMsgLocationProvider(provider?: () => MsgLocation | undefined): void {
  _msgLocationProvider = provider;
}
export function msg(text: string, time: number, color: string, distanceMeters?: number): Msg {
  const distance = Number.isFinite(distanceMeters) ? Math.max(0, Math.round(distanceMeters!)) : undefined;
  const location = _msgLocationProvider?.();
  return { ...location, text, time, color, day: _msgDay, hour: _msgHour, minute: _msgMin, distanceMeters: distance };
}
export function msgAt(text: string, time: number, color: string, location: MsgLocation, distanceMeters?: number): Msg {
  const base = msg(text, time, color, distanceMeters);
  const x = Number.isFinite(location.x) ? location.x : undefined;
  const y = Number.isFinite(location.y) ? location.y : undefined;
  const actorId = Number.isFinite(location.actorId) ? Math.floor(location.actorId!) : undefined;
  const targetId = Number.isFinite(location.targetId) ? Math.floor(location.targetId!) : undefined;
  const roomId = Number.isFinite(location.roomId) ? Math.floor(location.roomId!) : undefined;
  const zoneId = Number.isFinite(location.zoneId) ? Math.floor(location.zoneId!) : undefined;
  return {
    ...base,
    floor: location.floor,
    x,
    y,
    actorId,
    targetId,
    roomId,
    zoneId,
  };
}

// ── Input ────────────────────────────────────────────────────────
export interface InputState {
  fwd: boolean; back: boolean; left: boolean; right: boolean;
  strafeL: boolean; strafeR: boolean;
  sprint: boolean;              // Shift by default — movement speed burst
  attack: boolean; interact: boolean; pickup: boolean; reload: boolean;
  interactHeld: boolean;       // raw hold state for pressure/resistance mechanics
  map: boolean; mapLegend: boolean; inv: boolean;
  invUp: boolean; invDn: boolean; invLeft: boolean; invRight: boolean;
  use: boolean;
  escape: boolean;
  questLog: boolean;
  mouseAttack: boolean;
  mouseUse: boolean;
  menuAccept: boolean;          // latched LMB accept/select while a canvas menu is open
  menuClose: boolean;           // latched RMB back/close while a canvas menu is open
  menuWheel: number;            // latched wheel menu navigation, negative=up, positive=down
  textInput: string;            // transient printable chars for focused canvas text fields
  attrStr: boolean; attrAgi: boolean; attrInt: boolean;  // 1,2,3 keys for attribute spending
  debugScreen: boolean;
  pee: boolean;                 // P key — urinate
  drop: boolean;                // D key — drop item (inventory)
  factionMenu: boolean;         // F key — faction relations matrix
  logMenu: boolean;             // L key — message log
  help: boolean;                // F1 by default — one-page HELP poster
  sleep: boolean;               // Z key — hold to sleep
  controls: boolean;            // Tab by default — hotkey / rebind screen
  uiSettings: boolean;          // U key — configurable HUD element screen
  controlEdit: boolean;         // reserved command slot for hotkey screens
  controlReset: boolean;        // selected-bind clear command from current controls
  controlClose: boolean;        // keyboard close/back command from current controls
  mouse: { dx: number; dy: number; locked: boolean; };
  touch: { moveX: number; moveY: number; lookX: number; lookY: number; active: boolean; };
}
