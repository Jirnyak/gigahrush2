/* -- Design floor: bolnichny_korpus - triage, quarantine and ward choices -- */

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
  MonsterKind,
  Occupation,
  QuestType,
  RoomType,
  Tex,
  W,
  ZoneFaction,
  type Entity,
  type Item,
  type Room,
  type TerritoryOwner,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { hashSeed, withSeededRandom } from '../../core/rand';
import { freshNeeds } from '../../data/catalog';
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { placeEmergencyPanel } from '../../systems/emergency_panels';
import { randomRPG } from '../../systems/rpg';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { ensureConnectivity, generateZones, sanitizeDoors, stampRoom } from '../shared';
import type { FloorGeneration } from '../floor_manifest';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('bolnichny_korpus');

export const BOLNICHNY_KORPUS_ROUTE_ID = 'bolnichny_korpus' as const;
export const BOLNICHNY_KORPUS_Z = 16 as const;
export const BOLNICHNY_KORPUS_BASE_FLOOR = FloorLevel.KVARTIRY;

export const BOLNICHNY_KORPUS_META = {
  routeId: BOLNICHNY_KORPUS_ROUTE_ID,
  displayName: 'Больничный корпус',
  z: BOLNICHNY_KORPUS_Z,
  baseFloor: BOLNICHNY_KORPUS_BASE_FLOOR,
  // The corpus is a converted apartment/ward band: beds, queues and patient
  // bypasses drive the route, while Ministry-style control appears as papers.
  baseReason: 'kvartiry_converted_residential_hospital',
  debugEntry: 'generateBolnichnyKorpusDesignFloor()',
} as const;

export const BOLNICHNY_ROOM_NAMES = {
  triageEntrance: 'Сортировочный вход больничного корпуса',
  checkpoint: 'Карантинный пост чистой петли',
  cleanLoopSouth: 'Южная чистая петля каталок',
  cleanLoopWest: 'Западная чистая петля перевязок',
  cleanLoopNorth: 'Северная чистая петля холодного света',
  cleanLoopEast: 'Восточная чистая петля аптек',
  lowerLift: 'Нижняя больничная кабина к квартирам',
  cleanWard: 'Чистая палата ожидания лечения',
  surgery: 'Операционная тёплой сортировки',
  pharmacy: 'Запертая аптека строгого учёта',
  coldStore: 'Холодная кладовая вакцин и фильтров',
  feverWard: 'Инфекционная палата жёлтой температуры',
  redWard: 'Красная палата мокрых простыней',
  blackWard: 'Чёрная палата закрытых историй',
  papers: 'Кабинет заражённых бумаг',
  ventilationIntake: 'Вентиляционный лаз у приёмника',
  ventilationSpine: 'Вентиляционный позвоночник больницы',
  ventilationOutlet: 'Вентиляционный выход к нижней кабине',
} as const;

type NextId = { v: number };
type DoorSide = 'north' | 'south' | 'west' | 'east';
type BolnichnyNpcId =
  | 'bolnichny_doctor_galina'
  | 'bolnichny_pharmacist_ira'
  | 'bolnichny_liquidator_sazan'
  | 'bolnichny_patient_grisha'
  | 'bolnichny_clerk_nina';

interface BolnichnyRooms {
  triageEntrance: Room;
  checkpoint: Room;
  cleanLoopSouth: Room;
  cleanLoopWest: Room;
  cleanLoopNorth: Room;
  cleanLoopEast: Room;
  lowerLift: Room;
  cleanWard: Room;
  surgery: Room;
  pharmacy: Room;
  coldStore: Room;
  feverWard: Room;
  redWard: Room;
  blackWard: Room;
  papers: Room;
  ventilationIntake: Room;
  ventilationSpine: Room;
  ventilationOutlet: Room;
}

interface DoorSite {
  x: number;
  y: number;
  ox: number;
  oy: number;
}

interface BolnichnyMicroBlockSpec {
  name: string;
  x: number;
  y: number;
  cols: number;
  rows: number;
  linkX: number;
  linkY: number;
  dirty: boolean;
  owner: TerritoryOwner;
  wallTex: Tex;
  floorTex: Tex;
}

interface BolnichnyHqSite {
  owner: TerritoryOwner;
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  linkX: number;
  linkY: number;
  wallTex: Tex;
  floorTex: Tex;
}

const SEED = hashSeed(BOLNICHNY_KORPUS_ROUTE_ID);
const CX = W >> 1;
const CY = W >> 1;
const MICRO_ROOM_W = 15;
const MICRO_ROOM_H = 10;
const MICRO_GAP_X = 8;
const MICRO_GAP_Y = 4;
const MICRO_SPINE_H = 8;

const BOLNICHNY_HQ_SITES: readonly BolnichnyHqSite[] = [
  { owner: ZoneFaction.SCIENTIST, x: 626, y: 352, w: 38, h: 22, name: 'НИИ-штаб стерильных допусков', linkX: 632, linkY: 420, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
  { owner: ZoneFaction.LIQUIDATOR, x: 580, y: 628, w: 34, h: 22, name: 'Штаб ликвидаторов санитарного поста', linkX: 548, linkY: 662, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
  { owner: ZoneFaction.CITIZEN, x: 604, y: 704, w: 32, h: 20, name: 'Гражданский штаб очереди выздоровления', linkX: 572, linkY: 735, wallTex: Tex.PANEL, floorTex: Tex.F_LINO },
  { owner: ZoneFaction.WILD, x: 132, y: 626, w: 32, h: 18, name: 'Дикий штаб мокрой палаты', linkX: 244, linkY: 650, wallTex: Tex.ROTTEN, floorTex: Tex.F_WOOD },
  { owner: ZoneFaction.CULTIST, x: 824, y: 620, w: 28, h: 18, name: 'Скрытый культовый штаб анамнеза', linkX: 738, linkY: 668, wallTex: Tex.ROTTEN, floorTex: Tex.F_MEAT },
] as const;

const BOLNICHNY_MICRO_BLOCKS: readonly BolnichnyMicroBlockSpec[] = [
  { name: 'Северо-западный корпус обходных палат', x: 86, y: 228, cols: 4, rows: 4, linkX: 222, linkY: 268, dirty: true, owner: ZoneFaction.WILD, wallTex: Tex.BRICK, floorTex: Tex.F_LINO },
  { name: 'Северная лабораторная очередь', x: 374, y: 178, cols: 5, rows: 4, linkX: 512, linkY: 420, dirty: false, owner: ZoneFaction.SCIENTIST, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
  { name: 'Северо-восточные аптечные боксы', x: 712, y: 230, cols: 4, rows: 4, linkX: 646, linkY: 512, dirty: false, owner: ZoneFaction.SCIENTIST, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
  { name: 'Западный жёлтый карантин', x: 78, y: 470, cols: 4, rows: 5, linkX: 248, linkY: 544, dirty: true, owner: ZoneFaction.WILD, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
  { name: 'Восточный хирургический сервис', x: 768, y: 452, cols: 4, rows: 4, linkX: 598, linkY: 526, dirty: false, owner: ZoneFaction.SCIENTIST, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
  { name: 'Юго-западный коридор кашля', x: 148, y: 724, cols: 5, rows: 4, linkX: 264, linkY: 706, dirty: true, owner: ZoneFaction.CITIZEN, wallTex: Tex.BRICK, floorTex: Tex.F_LINO },
  { name: 'Южная приёмная мелких процедур', x: 414, y: 790, cols: 5, rows: 4, linkX: 512, linkY: 752, dirty: false, owner: ZoneFaction.CITIZEN, wallTex: Tex.PANEL, floorTex: Tex.F_LINO },
  { name: 'Юго-восточный склад каталок', x: 740, y: 742, cols: 4, rows: 4, linkX: 806, linkY: 828, dirty: false, owner: ZoneFaction.LIQUIDATOR, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
] as const;

const NPC_DEFS: Record<BolnichnyNpcId, PlotNpcDef> = {
  bolnichny_doctor_galina: {
    name: 'Галина Сортировочная',
    isFemale: true,
    faction: Faction.SCIENTIST,
    occupation: Occupation.DOCTOR,
    sprite: Occupation.DOCTOR,
    hp: 130, maxHp: 130, money: 120, speed: 0.82,
    inventory: [
      { defId: 'official_quarantine_clearance', count: 1 },
      { defId: 'antibiotic', count: 1 },
      { defId: 'pills', count: 1 },
    ],
    talkLines: [
      'Сначала сортировка, потом жалость. Если перепутать порядок, корпус сам выберет за нас.',
      'Чистая петля ведёт к лифту без гермодверей. Грязная ведёт быстрее, если вы не спорите с кашлем.',
      'Аптека закрыта не от больных. От здоровых она закрыта надёжнее.',
    ],
    talkLinesPost: [
      'Одна палата получила набор. Остальные теперь знают, что выбор был настоящим.',
      'Заражённые бумаги опаснее мокрых простыней: их носят сухими руками.',
    ],
  },
  bolnichny_pharmacist_ira: {
    name: 'Ира Аптечная',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.STOREKEEPER,
    sprite: Occupation.STOREKEEPER,
    hp: 100, maxHp: 100, money: 210, speed: 0.78,
    inventory: [
      { defId: 'sanitary_kit', count: 1 },
      { defId: 'morphine_ampoule', count: 1 },
      { defId: 'forged_quarantine_clearance', count: 1 },
    ],
    talkLines: [
      'Лекарства не пропадают. Они меняют фамилию в журнале.',
      'Чистый допуск открывает дверь. Липовый открывает её медленнее, зато с выражением лица.',
      'Если шкаф пустой, значит кто-то уже сделал медицинский выбор.',
    ],
    talkLinesPost: [
      'Аптечный журнал любит правду, но принимает исправления.',
      'Морфин строгого учёта. В больнице это значит: за ним придут раньше, чем за человеком.',
    ],
  },
  bolnichny_liquidator_sazan: {
    name: 'Сазан Санпропуск',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 200, maxHp: 200, money: 64, speed: 0.96,
    weapon: 'makarov',
    inventory: [
      { defId: 'makarov', count: 1 },
      { defId: 'ammo_9mm', count: 20 },
      { defId: 'gasmask_filter', count: 1 },
    ],
    talkLines: [
      'Карантин не запирает оба лифта. Это правило. Второе правило: не спрашивайте, какой лифт грязный.',
      'Вентиляция годится для обхода. Для алиби она слишком узкая.',
      'У кого справка мокрая, тот идёт в мокрую палату.',
    ],
    talkLinesPost: [
      'Пост стоит. Значит, корпус ещё делает вид, что лечит.',
      'Если бумага заражена, сжигать надо не только бумагу.',
    ],
  },
  bolnichny_patient_grisha: {
    name: 'Гриша Температурный',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.TRAVELER,
    sprite: Occupation.TRAVELER,
    hp: 72, maxHp: 92, money: 11, speed: 0.68,
    inventory: [
      { defId: 'quarantine_medcard', count: 1 },
      { defId: 'contaminated_swab', count: 1 },
    ],
    talkLines: [
      'Я ещё человек. В карточке это зачёркнуто карандашом, значит можно стереть.',
      'Если донесёте набор к красной палате, нас хотя бы перестанут считать очередью на мешки.',
      'Чистая петля пахнет йодом. Грязная пахнет правдой.',
    ],
    talkLinesPost: [
      'Температура спала до коридора. Это почти нормально.',
      'Справка говорит, что я не опасен. Я ей пока верю.',
    ],
  },
  bolnichny_clerk_nina: {
    name: 'Нина Бумажная',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 96, maxHp: 96, money: 88, speed: 0.82,
    inventory: [
      { defId: 'blank_form', count: 2 },
      { defId: 'clean_health_cert', count: 1 },
      { defId: 'record_exposure_notice', count: 1 },
    ],
    talkLines: [
      'Заражённая бумага не кашляет. Она просто меняет маршрут пациента.',
      'Липовую справку можно сделать из пустого бланка, если не жалеть йода и чужую фамилию.',
      'Если акт испорченной пробы всплывёт, чистая петля станет очень узкой.',
    ],
    talkLinesPost: [
      'Акт ушёл наверх. Теперь санитарный журнал делает вид, что удивлён.',
      'Справка готова. Не держите её рядом с мокрой перчаткой.',
    ],
  },
};

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'bolnichny_doctor_galina', NPC_DEFS.bolnichny_doctor_galina, [
  {
    id: 'bolnichny_treat_clean_ward',
    giverNpcId: 'bolnichny_doctor_galina',
    type: QuestType.FETCH,
    desc: 'Галина Сортировочная: «Принесите санитарный набор в чистую палату. Тогда аптека отдаст настоящий допуск, а корпус сохранит лицо.»',
    targetItem: 'sanitary_kit',
    targetCount: 1,
    rewardItem: 'official_quarantine_clearance',
    rewardCount: 1,
    extraRewards: [{ defId: 'antibiotic', count: 1 }],
    relationDelta: 12,
    xpReward: 90,
    moneyReward: 55,
    eventTags: [BOLNICHNY_KORPUS_ROUTE_ID, 'medicine', 'clean_ward', 'treatment_choice'],
    eventPrivacy: 'local',
    eventData: { treatmentWard: 'clean' },
    abandonsSideQuestIds: ['bolnichny_treat_infected_ward'],
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'bolnichny_pharmacist_ira', NPC_DEFS.bolnichny_pharmacist_ira, [
  {
    id: 'bolnichny_steal_morphine',
    giverNpcId: 'bolnichny_pharmacist_ira',
    type: QuestType.FETCH,
    desc: 'Ира Аптечная: «Если ампула морфина уйдёт из шкафа без записи, я дам липовый карантинный допуск. Это не лечение, это маршрут.»',
    targetItem: 'morphine_ampoule',
    targetCount: 1,
    rewardItem: 'forged_quarantine_clearance',
    rewardCount: 1,
    extraRewards: [{ defId: 'fake_pass', count: 1 }],
    relationDelta: -4,
    xpReward: 70,
    moneyReward: 80,
    eventTags: [BOLNICHNY_KORPUS_ROUTE_ID, 'pharmacy', 'theft', 'forgery'],
    eventPrivacy: 'witnessed',
    eventSeverity: 4,
    eventData: { pharmacyTheft: true, forgedClearance: true },
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'bolnichny_liquidator_sazan', NPC_DEFS.bolnichny_liquidator_sazan, [
  {
    id: 'bolnichny_kill_black_ward',
    giverNpcId: 'bolnichny_liquidator_sazan',
    type: QuestType.KILL,
    desc: 'Сазан Санпропуск: «В чёрной палате уже не пациент, а причина. Уберите чернослиз, пока он не научился нажимать кнопку лифта.»',
    targetMonsterKind: MonsterKind.CHERNOSLIZ,
    killNeeded: 1,
    rewardItem: 'gasmask_filter',
    rewardCount: 1,
    extraRewards: [{ defId: 'ammo_9mm', count: 12 }],
    relationDelta: 9,
    xpReward: 115,
    moneyReward: 65,
    eventTags: [BOLNICHNY_KORPUS_ROUTE_ID, 'black_ward', 'liquidator', 'cleanup'],
    eventPrivacy: 'witnessed',
    eventSeverity: 4,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'bolnichny_patient_grisha', NPC_DEFS.bolnichny_patient_grisha, [
  {
    id: 'bolnichny_treat_infected_ward',
    giverNpcId: 'bolnichny_patient_grisha',
    type: QuestType.FETCH,
    desc: 'Гриша Температурный: «Отнесите санитарный набор в красную палату. Чистые уже в очереди, а мы пока ещё говорим.»',
    targetItem: 'sanitary_kit',
    targetCount: 1,
    rewardItem: 'clean_health_cert',
    rewardCount: 1,
    extraRewards: [{ defId: 'quarantine_medcard', count: 1 }],
    relationDelta: 18,
    xpReward: 100,
    moneyReward: 22,
    eventTags: [BOLNICHNY_KORPUS_ROUTE_ID, 'medicine', 'infected_ward', 'treatment_choice'],
    eventPrivacy: 'local',
    eventData: { treatmentWard: 'infected' },
    abandonsSideQuestIds: ['bolnichny_treat_clean_ward'],
  },
  {
    id: 'bolnichny_escort_infected_patient',
    giverNpcId: 'bolnichny_patient_grisha',
    type: QuestType.TALK,
    desc: 'Гриша Температурный: «Доведите меня словом до Галины. Пусть врач скажет, что я пациент, а не запасной мешок.»',
    targetPlotNpcId: 'bolnichny_doctor_galina',
    rewardItem: 'sterile_bandage',
    rewardCount: 1,
    relationDelta: 14,
    xpReward: 65,
    moneyReward: 15,
    eventTags: [BOLNICHNY_KORPUS_ROUTE_ID, 'escort', 'infected_patient', 'triage'],
    eventPrivacy: 'local',
    failOnNpcDeathPlotId: 'bolnichny_patient_grisha',
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'bolnichny_clerk_nina', NPC_DEFS.bolnichny_clerk_nina, [
  {
    id: 'bolnichny_forge_clearance',
    giverNpcId: 'bolnichny_clerk_nina',
    type: QuestType.FETCH,
    desc: 'Нина Бумажная: «Принесите пустой бланк. Я сделаю карантинную справку, которая выдержит один пост и два чужих взгляда.»',
    targetItem: 'blank_form',
    targetCount: 1,
    rewardItem: 'forged_quarantine_clearance',
    rewardCount: 1,
    relationDelta: 6,
    xpReward: 45,
    moneyReward: 20,
    eventTags: [BOLNICHNY_KORPUS_ROUTE_ID, 'forgery', 'clearance', 'documents'],
    eventPrivacy: 'secret',
    eventData: { forgedClearance: true },
  },
  {
    id: 'bolnichny_expose_contaminated_papers',
    giverNpcId: 'bolnichny_clerk_nina',
    type: QuestType.FETCH,
    desc: 'Нина Бумажная: «Достаньте акт испорченной пробы из кабинета заражённых бумаг. Пусть корпус узнает, какая палата стала грязной на бумаге.»',
    targetItem: 'contaminated_sample_act',
    targetCount: 1,
    rewardItem: 'record_exposure_notice',
    rewardCount: 1,
    extraRewards: [{ defId: 'clean_health_cert', count: 1 }],
    relationDelta: 10,
    xpReward: 85,
    moneyReward: 45,
    eventTags: [BOLNICHNY_KORPUS_ROUTE_ID, 'contaminated_papers', 'expose', 'audit'],
    eventPrivacy: 'witnessed',
    eventSeverity: 4,
    eventData: { contaminatedPapersExposed: true },
  },
]);

export function generateBolnichnyKorpusDesignFloor(seed = SEED): FloorGeneration {
  return withSeededRandom(seed, () => {
    const world = new World();
    const entities: Entity[] = [];
    const nextId = { v: 1 };

    initWorld(world);
    const rooms = buildRooms(world);
    connectRoomsGraph(world, rooms);
    decorateRooms(world, rooms);
    placeLifts(world, rooms);
    generateZones(world);
    tuneBolnichnyKorpusRouteZones(world);
    placeBolnichnyEmergencyPanels(world, rooms);

    const owners = spawnNpcs(entities, nextId, rooms);
    spawnAmbientNpcs(entities, nextId, rooms);
    placeContainers(world, rooms, owners);
    placeDrops(world, entities, nextId, rooms);
    spawnThreats(world, entities, nextId, rooms);
    stampInfectionVoronoi(world, rooms, SEED ^ 0xb071);
    applyColdWarmShells(world, rooms);

    sanitizeDoors(world);
    ensureConnectivity(world, rooms.triageEntrance.x + 58.5, rooms.triageEntrance.y + 17.5);
    reinforceBolnichnyKorpusGates(world);
    world.rebuildContainerMap();
    world.bakeLights();

    return {
      world,
      entities,
      spawnX: rooms.triageEntrance.x + 58.5,
      spawnY: rooms.triageEntrance.y + 17.5,
    };
  });
}

export function expandBolnichnyKorpusRouteGeometry(world: World, rng: () => number): void {
  const annexes = [
    { x: 120, y: 154, name: 'северо-западный лазарет обхода', dirty: true },
    { x: 792, y: 150, name: 'северо-восточная перевязочная', dirty: false },
    { x: 106, y: 804, name: 'юго-западная палата кашля', dirty: true },
    { x: 786, y: 804, name: 'юго-восточный склад каталок', dirty: false },
    { x: 466, y: 112, name: 'верхний вентиляционный фильтр', dirty: true },
    { x: 458, y: 866, name: 'нижняя санитарная очередь', dirty: false },
  ];

  for (let i = 0; i < annexes.length; i++) {
    const anchor = annexes[i]!;
    const ox = Math.floor((rng() - 0.5) * 30);
    const oy = Math.floor((rng() - 0.5) * 24);
    const ward = addRoom(
      world,
      anchor.dirty ? RoomType.MEDICAL : RoomType.COMMON,
      anchor.x + ox,
      anchor.y + oy,
      58,
      28,
      `Больничный корпус: ${anchor.name}`,
      anchor.dirty ? Tex.TILE_W : Tex.PANEL,
      anchor.dirty ? Tex.F_TILE : Tex.F_LINO,
    );
    const store = addRoom(
      world,
      anchor.dirty ? RoomType.STORAGE : RoomType.MEDICAL,
      ward.x + (i % 2 === 0 ? 66 : -42),
      ward.y + 2,
      32,
      22,
      `Шкаф больничного корпуса: ${anchor.name}`,
      Tex.METAL,
      Tex.F_CONCRETE,
    );
    connectRooms(world, ward, i % 2 === 0 ? 'east' : 'west', store, i % 2 === 0 ? 'west' : 'east', anchor.dirty ? DoorState.LOCKED : DoorState.CLOSED, anchor.dirty ? 'official_quarantine_clearance' : '');
    carveLineWidth(world, ward.x + (ward.w >> 1), ward.y + (ward.h >> 1), CX, CY, 3, anchor.dirty ? Tex.F_TILE : Tex.F_LINO);
    decorateAnnex(world, ward, store, i, anchor.dirty);
  }

  buildBolnichnyFactionHqs(world);
  buildBolnichnyMidMicroLayer(world, rng);
  applyBolnichnyAuthoredTerritory(world);
}

export function tuneBolnichnyKorpusRouteZones(world: World): void {
  for (const zone of world.zones) {
    const d = world.dist(zone.cx, zone.cy, CX, CY);
    const inCleanCross = (zone.cx >= 360 && zone.cx <= 668 && zone.cy >= 404 && zone.cy <= 650)
      || (zone.cx >= 438 && zone.cx <= 586 && zone.cy >= 318 && zone.cy <= 748);
    const inDirtyWest = zone.cx < 380 && zone.cy >= 450 && zone.cy <= 760;
    const inDirtyEast = zone.cx > 650 && zone.cy >= 545 && zone.cy <= 730;
    if (inDirtyWest || inDirtyEast || d > 390) {
      zone.faction = zone.id % 3 === 0 ? ZoneFaction.SAMOSBOR : ZoneFaction.WILD;
      zone.level = Math.max(zone.level, d > 390 ? 4 : 3);
    } else if (inCleanCross || d < 230) {
      zone.faction = zone.id % 4 === 0 ? ZoneFaction.CITIZEN : ZoneFaction.LIQUIDATOR;
      zone.level = Math.max(zone.level, 3);
    } else {
      zone.faction = ZoneFaction.CITIZEN;
      zone.level = Math.max(zone.level, 2);
    }
    zone.fogged = false;
  }

  for (let i = 0; i < W * W; i++) {
    world.factionControl[i] = world.zones[world.zoneMap[i]]?.faction ?? ZoneFaction.CITIZEN;
  }
  applyBolnichnyAuthoredTerritory(world);
}

export function reinforceBolnichnyKorpusGates(world: World): void {
  const pharmacy = world.rooms.find(room => room.name === BOLNICHNY_ROOM_NAMES.pharmacy);
  const coldStore = world.rooms.find(room => room.name === BOLNICHNY_ROOM_NAMES.coldStore);
  const fever = world.rooms.find(room => room.name === BOLNICHNY_ROOM_NAMES.feverWard);
  const black = world.rooms.find(room => room.name === BOLNICHNY_ROOM_NAMES.blackWard);
  const papers = world.rooms.find(room => room.name === BOLNICHNY_ROOM_NAMES.papers);
  if (pharmacy) {
    restoreBolnichnyGatedRoomShell(world, pharmacy, false, 'official_quarantine_clearance');
    placeGateLine(world, pharmacy.x - 8, pharmacy.y + (pharmacy.h >> 1) - 4, 'vertical', DoorState.LOCKED, 'official_quarantine_clearance', pharmacy);
    placeGateLine(world, pharmacy.x + (pharmacy.w >> 1), pharmacy.y - 8, 'horizontal', DoorState.LOCKED, 'forged_quarantine_clearance', pharmacy);
  }
  if (coldStore) restoreBolnichnyGatedRoomShell(world, coldStore, false, 'official_quarantine_clearance');
  if (papers) {
    restoreBolnichnyGatedRoomShell(world, papers, false, 'forged_quarantine_clearance');
    placeGateLine(world, papers.x + papers.w + 7, papers.y + (papers.h >> 1), 'vertical', DoorState.LOCKED, 'forged_quarantine_clearance', papers);
  }
  if (fever) {
    restoreBolnichnyGatedRoomShell(world, fever, true);
    placeGateLine(world, fever.x + fever.w + 8, fever.y + (fever.h >> 1), 'vertical', DoorState.HERMETIC_CLOSED, '', fever);
  }
  if (black) {
    restoreBolnichnyGatedRoomShell(world, black, true);
    placeGateLine(world, black.x + (black.w >> 1), black.y - 8, 'horizontal', DoorState.HERMETIC_CLOSED, '', black);
  }
}

function initWorld(world: World): void {
  for (let i = 0; i < W * W; i++) {
    world.wallTex[i] = Tex.PANEL;
    world.floorTex[i] = Tex.F_LINO;
    world.factionControl[i] = ZoneFaction.CITIZEN;
    world.fog[i] = 4;
  }
}

function buildRooms(world: World): BolnichnyRooms {
  const triageEntrance = addRoom(world, RoomType.COMMON, CX - 60, CY + 208, 120, 34, BOLNICHNY_ROOM_NAMES.triageEntrance, Tex.PANEL, Tex.F_LINO);
  const checkpoint = addRoom(world, RoomType.OFFICE, CX - 36, CY + 148, 72, 42, BOLNICHNY_ROOM_NAMES.checkpoint, Tex.METAL, Tex.F_CONCRETE);
  const cleanLoopSouth = addRoom(world, RoomType.CORRIDOR, CX - 142, CY + 92, 284, 26, BOLNICHNY_ROOM_NAMES.cleanLoopSouth, Tex.TILE_W, Tex.F_TILE);
  const cleanLoopWest = addRoom(world, RoomType.CORRIDOR, CX - 142, CY - 92, 28, 210, BOLNICHNY_ROOM_NAMES.cleanLoopWest, Tex.TILE_W, Tex.F_TILE);
  const cleanLoopNorth = addRoom(world, RoomType.CORRIDOR, CX - 142, CY - 92, 284, 26, BOLNICHNY_ROOM_NAMES.cleanLoopNorth, Tex.TILE_W, Tex.F_TILE);
  const cleanLoopEast = addRoom(world, RoomType.CORRIDOR, CX + 114, CY - 92, 28, 210, BOLNICHNY_ROOM_NAMES.cleanLoopEast, Tex.TILE_W, Tex.F_TILE);
  const lowerLift = addRoom(world, RoomType.CORRIDOR, CX - 42, CY - 174, 84, 28, BOLNICHNY_ROOM_NAMES.lowerLift, Tex.PIPE, Tex.F_CONCRETE);
  const cleanWard = addRoom(world, RoomType.MEDICAL, CX - 88, CY - 26, 76, 54, BOLNICHNY_ROOM_NAMES.cleanWard, Tex.TILE_W, Tex.F_TILE);
  const surgery = addRoom(world, RoomType.MEDICAL, CX + 16, CY - 22, 76, 52, BOLNICHNY_ROOM_NAMES.surgery, Tex.TILE_W, Tex.F_TILE);
  const pharmacy = addRoom(world, RoomType.MEDICAL, CX + 162, CY - 10, 84, 54, BOLNICHNY_ROOM_NAMES.pharmacy, Tex.METAL, Tex.F_CONCRETE);
  const coldStore = addRoom(world, RoomType.STORAGE, CX + 258, CY - 6, 50, 46, BOLNICHNY_ROOM_NAMES.coldStore, Tex.METAL, Tex.F_CONCRETE);
  const feverWard = addRoom(world, RoomType.MEDICAL, CX - 266, CY - 34, 90, 62, BOLNICHNY_ROOM_NAMES.feverWard, Tex.TILE_W, Tex.F_TILE, true);
  const redWard = addRoom(world, RoomType.MEDICAL, CX - 270, CY + 58, 94, 58, BOLNICHNY_ROOM_NAMES.redWard, Tex.TILE_W, Tex.F_TILE, true);
  const blackWard = addRoom(world, RoomType.MEDICAL, CX + 178, CY + 126, 94, 58, BOLNICHNY_ROOM_NAMES.blackWard, Tex.HERMO_WALL, Tex.F_TILE, true);
  const papers = addRoom(world, RoomType.OFFICE, CX - 96, CY + 146, 70, 40, BOLNICHNY_ROOM_NAMES.papers, Tex.MARBLE, Tex.F_PARQUET);
  const ventilationIntake = addRoom(world, RoomType.CORRIDOR, CX - 176, CY + 202, 48, 22, BOLNICHNY_ROOM_NAMES.ventilationIntake, Tex.PIPE, Tex.F_CONCRETE);
  const ventilationSpine = addRoom(world, RoomType.CORRIDOR, CX - 286, CY + 42, 30, 190, BOLNICHNY_ROOM_NAMES.ventilationSpine, Tex.PIPE, Tex.F_CONCRETE);
  const ventilationOutlet = addRoom(world, RoomType.CORRIDOR, CX - 260, CY - 132, 82, 24, BOLNICHNY_ROOM_NAMES.ventilationOutlet, Tex.PIPE, Tex.F_CONCRETE);
  return {
    triageEntrance,
    checkpoint,
    cleanLoopSouth,
    cleanLoopWest,
    cleanLoopNorth,
    cleanLoopEast,
    lowerLift,
    cleanWard,
    surgery,
    pharmacy,
    coldStore,
    feverWard,
    redWard,
    blackWard,
    papers,
    ventilationIntake,
    ventilationSpine,
    ventilationOutlet,
  };
}

function connectRoomsGraph(world: World, rooms: BolnichnyRooms): void {
  connectRooms(world, rooms.triageEntrance, 'north', rooms.checkpoint, 'south', DoorState.CLOSED);
  connectRooms(world, rooms.checkpoint, 'north', rooms.cleanLoopSouth, 'south', DoorState.CLOSED);
  connectRooms(world, rooms.cleanLoopSouth, 'west', rooms.cleanLoopWest, 'south', DoorState.CLOSED);
  connectRooms(world, rooms.cleanLoopWest, 'north', rooms.cleanLoopNorth, 'west', DoorState.CLOSED);
  connectRooms(world, rooms.cleanLoopNorth, 'east', rooms.cleanLoopEast, 'north', DoorState.CLOSED);
  connectRooms(world, rooms.cleanLoopEast, 'south', rooms.cleanLoopSouth, 'east', DoorState.CLOSED);
  connectRooms(world, rooms.cleanLoopNorth, 'north', rooms.lowerLift, 'south', DoorState.CLOSED);

  connectRooms(world, rooms.cleanLoopWest, 'east', rooms.cleanWard, 'west', DoorState.CLOSED);
  connectRooms(world, rooms.cleanLoopEast, 'west', rooms.surgery, 'east', DoorState.CLOSED);
  connectRooms(world, rooms.cleanLoopEast, 'east', rooms.pharmacy, 'west', DoorState.LOCKED, 'official_quarantine_clearance');
  connectRooms(world, rooms.pharmacy, 'east', rooms.coldStore, 'west', DoorState.LOCKED, 'official_quarantine_clearance');
  connectRooms(world, rooms.cleanLoopSouth, 'south', rooms.papers, 'east', DoorState.LOCKED, 'forged_quarantine_clearance');

  connectRooms(world, rooms.cleanLoopWest, 'west', rooms.feverWard, 'east', DoorState.HERMETIC_CLOSED);
  connectRooms(world, rooms.feverWard, 'south', rooms.redWard, 'north', DoorState.CLOSED);
  connectRooms(world, rooms.cleanLoopEast, 'south', rooms.blackWard, 'north', DoorState.HERMETIC_CLOSED);

  connectRooms(world, rooms.triageEntrance, 'west', rooms.ventilationIntake, 'east', DoorState.CLOSED);
  connectRooms(world, rooms.ventilationIntake, 'west', rooms.ventilationSpine, 'south', DoorState.CLOSED);
  connectRooms(world, rooms.ventilationSpine, 'north', rooms.ventilationOutlet, 'west', DoorState.CLOSED);
  connectRooms(world, rooms.ventilationOutlet, 'east', rooms.lowerLift, 'west', DoorState.CLOSED);
  connectRooms(world, rooms.ventilationSpine, 'east', rooms.feverWard, 'west', DoorState.CLOSED);
  connectRooms(world, rooms.ventilationOutlet, 'east', rooms.pharmacy, 'north', DoorState.LOCKED, 'forged_quarantine_clearance');
}

function decorateRooms(world: World, rooms: BolnichnyRooms): void {
  setFeature(world, rooms.triageEntrance.x + 18, rooms.triageEntrance.y + 14, Feature.DESK);
  setFeature(world, rooms.triageEntrance.x + 42, rooms.triageEntrance.y + 16, Feature.CHAIR);
  setFeature(world, rooms.triageEntrance.x + 72, rooms.triageEntrance.y + 12, Feature.BED);
  setFeature(world, rooms.triageEntrance.x + 94, rooms.triageEntrance.y + 16, Feature.LIFT_BUTTON);

  setFeature(world, rooms.checkpoint.x + 10, rooms.checkpoint.y + 15, Feature.DESK);
  setFeature(world, rooms.checkpoint.x + 26, rooms.checkpoint.y + 15, Feature.SCREEN);
  setFeature(world, rooms.checkpoint.x + rooms.checkpoint.w - 10, rooms.checkpoint.y + 13, Feature.SHELF);

  for (const loop of [rooms.cleanLoopSouth, rooms.cleanLoopWest, rooms.cleanLoopNorth, rooms.cleanLoopEast]) {
    for (let n = 8; n < Math.max(loop.w, loop.h) - 6; n += 28) {
      const x = loop.w >= loop.h ? loop.x + n : loop.x + (loop.w >> 1);
      const y = loop.w >= loop.h ? loop.y + (loop.h >> 1) : loop.y + n;
      setFeature(world, x, y, n % 56 === 0 ? Feature.LAMP : Feature.CHAIR);
    }
  }

  decorateWard(world, rooms.cleanWard, false);
  decorateWard(world, rooms.feverWard, true);
  decorateWard(world, rooms.redWard, true);
  decorateWard(world, rooms.blackWard, true);

  for (let x = rooms.surgery.x + 8; x < rooms.surgery.x + rooms.surgery.w - 8; x += 16) {
    setFeature(world, x, rooms.surgery.y + 15, Feature.APPARATUS);
  }
  setFeature(world, rooms.surgery.x + 18, rooms.surgery.y + rooms.surgery.h - 12, Feature.BED);
  setFeature(world, rooms.surgery.x + rooms.surgery.w - 12, rooms.surgery.y + rooms.surgery.h - 10, Feature.SINK);

  for (let x = rooms.pharmacy.x + 8; x < rooms.pharmacy.x + rooms.pharmacy.w - 7; x += 10) {
    setFeature(world, x, rooms.pharmacy.y + 10, Feature.SHELF);
  }
  setFeature(world, rooms.pharmacy.x + rooms.pharmacy.w - 10, rooms.pharmacy.y + rooms.pharmacy.h - 10, Feature.DESK);
  setFeature(world, rooms.coldStore.x + 9, rooms.coldStore.y + 9, Feature.APPARATUS);
  setFeature(world, rooms.coldStore.x + rooms.coldStore.w - 8, rooms.coldStore.y + rooms.coldStore.h - 8, Feature.SHELF);

  setFeature(world, rooms.papers.x + 10, rooms.papers.y + 12, Feature.DESK);
  setFeature(world, rooms.papers.x + 27, rooms.papers.y + 13, Feature.SHELF);
  markScreenWall(world, rooms.papers.x + rooms.papers.w - 16, rooms.papers.y - 1, 4);

  for (const vent of [rooms.ventilationIntake, rooms.ventilationSpine, rooms.ventilationOutlet]) {
    setFeature(world, vent.x + (vent.w >> 1), vent.y + (vent.h >> 1), Feature.APPARATUS);
    setFeature(world, vent.x + 4, vent.y + 4, Feature.LAMP);
  }
  setFeature(world, rooms.lowerLift.x + 18, rooms.lowerLift.y + 12, Feature.LAMP);
  setFeature(world, rooms.lowerLift.x + rooms.lowerLift.w - 18, rooms.lowerLift.y + 12, Feature.LIFT_BUTTON);
}

function decorateWard(world: World, room: Room, dirty: boolean): void {
  for (let x = room.x + 10; x < room.x + room.w - 8; x += 22) {
    setFeature(world, x, room.y + 14, Feature.BED);
    setFeature(world, x + 3, room.y + room.h - 12, dirty ? Feature.SINK : Feature.CHAIR);
  }
  setFeature(world, room.x + room.w - 9, room.y + 10, dirty ? Feature.APPARATUS : Feature.SHELF);
}

function decorateAnnex(world: World, ward: Room, store: Room, serial: number, dirty: boolean): void {
  decorateWard(world, ward, dirty);
  setFeature(world, store.x + 7, store.y + 7, Feature.SHELF);
  setFeature(world, store.x + store.w - 8, store.y + store.h - 7, dirty ? Feature.APPARATUS : Feature.LAMP);
  if (dirty) stampWardSurface(world, ward, serial + 20, 5);
}

function buildBolnichnyFactionHqs(world: World): void {
  for (const site of BOLNICHNY_HQ_SITES) {
    const core = addRoom(world, RoomType.HQ, site.x, site.y, site.w, site.h, site.name, site.wallTex, site.floorTex);
    core.sealed = true;
    markBolnichnyHermeticRoom(world, core);
    decorateBolnichnyHqCore(world, core, site.owner);
    connectRoomToPoint(world, core, site.linkX, site.linkY, DoorState.HERMETIC_OPEN, site.floorTex);
    buildBolnichnyHqSupportRooms(world, site, core);
  }
}

function buildBolnichnyHqSupportRooms(world: World, site: BolnichnyHqSite, core: Room): void {
  const supports = bolnichnyHqSupportSpecs(site.owner);
  const placements = [
    { dx: 3, dy: -16, w: 17, h: 10 },
    { dx: site.w + 8, dy: 2, w: 18, h: 10 },
    { dx: 4, dy: site.h + 8, w: 18, h: 10 },
    { dx: -23, dy: 2, w: 16, h: 10 },
  ] as const;
  const hubX = core.x + (core.w >> 1);
  const hubY = core.y + (core.h >> 1);
  for (let i = 0; i < supports.length; i++) {
    const support = supports[i]!;
    const placement = placements[i]!;
    const room = addRoom(
      world,
      support.type,
      site.x + placement.dx,
      site.y + placement.dy,
      placement.w,
      placement.h,
      `${site.name}: ${support.name}`,
      support.wallTex,
      support.floorTex,
    );
    const supportSide = sideToward(world, room, hubX, hubY);
    connectRooms(world, room, supportSide, core, oppositeSide(supportSide), DoorState.CLOSED);
    decorateBolnichnyMicroRoom(world, room, i, support.dirty);
  }
}

function bolnichnyHqSupportSpecs(owner: TerritoryOwner): readonly { type: RoomType; name: string; wallTex: Tex; floorTex: Tex; dirty: boolean }[] {
  switch (owner) {
    case ZoneFaction.LIQUIDATOR:
      return [
        { type: RoomType.OFFICE, name: 'дежурная допусков', wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE, dirty: false },
        { type: RoomType.STORAGE, name: 'оружейная фильтров', wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE, dirty: false },
        { type: RoomType.MEDICAL, name: 'перевязочная досмотра', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE, dirty: false },
        { type: RoomType.BATHROOM, name: 'санузел поста', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE, dirty: false },
      ] as const;
    case ZoneFaction.SCIENTIST:
      return [
        { type: RoomType.PRODUCTION, name: 'лабораторный стол', wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE, dirty: false },
        { type: RoomType.MEDICAL, name: 'изолятор наблюдения', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE, dirty: false },
        { type: RoomType.STORAGE, name: 'шкаф приборов', wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE, dirty: false },
        { type: RoomType.OFFICE, name: 'журнал чистой петли', wallTex: Tex.PANEL, floorTex: Tex.F_LINO, dirty: false },
      ] as const;
    case ZoneFaction.WILD:
      return [
        { type: RoomType.STORAGE, name: 'свалка тумбочек', wallTex: Tex.ROTTEN, floorTex: Tex.F_WOOD, dirty: true },
        { type: RoomType.KITCHEN, name: 'коптилка бинтов', wallTex: Tex.ROTTEN, floorTex: Tex.F_CONCRETE, dirty: true },
        { type: RoomType.SMOKING, name: 'лежанки кашля', wallTex: Tex.ROTTEN, floorTex: Tex.F_WOOD, dirty: true },
        { type: RoomType.BATHROOM, name: 'ржавая вода', wallTex: Tex.TILE_W, floorTex: Tex.F_WATER, dirty: true },
      ] as const;
    case ZoneFaction.CULTIST:
      return [
        { type: RoomType.COMMON, name: 'круг анамнеза', wallTex: Tex.ROTTEN, floorTex: Tex.F_MEAT, dirty: true },
        { type: RoomType.STORAGE, name: 'кладовая масок', wallTex: Tex.ROTTEN, floorTex: Tex.F_WOOD, dirty: true },
        { type: RoomType.MEDICAL, name: 'тихая перевязка', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE, dirty: true },
        { type: RoomType.BATHROOM, name: 'умывальная золы', wallTex: Tex.TILE_W, floorTex: Tex.F_WATER, dirty: true },
      ] as const;
    case ZoneFaction.CITIZEN:
    default:
      return [
        { type: RoomType.KITCHEN, name: 'чайная выздоравливающих', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE, dirty: false },
        { type: RoomType.STORAGE, name: 'шкаф пайков', wallTex: Tex.BRICK, floorTex: Tex.F_CONCRETE, dirty: false },
        { type: RoomType.MEDICAL, name: 'медицинский угол', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE, dirty: false },
        { type: RoomType.BATHROOM, name: 'санузел очереди', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE, dirty: false },
      ] as const;
  }
}

function buildBolnichnyMidMicroLayer(world: World, rng: () => number): void {
  for (const block of BOLNICHNY_MICRO_BLOCKS) buildBolnichnyMicroBlock(world, block, rng);
}

function buildBolnichnyMicroBlock(world: World, spec: BolnichnyMicroBlockSpec, rng: () => number): void {
  const topRows = Math.ceil(spec.rows / 2);
  const blockW = spec.cols * MICRO_ROOM_W + (spec.cols - 1) * MICRO_GAP_X + 10;
  const spineY = spec.y + topRows * (MICRO_ROOM_H + MICRO_GAP_Y) + 2;
  const spine = tryAddBolnichnyRoom(world, RoomType.CORRIDOR, spec.x, spineY, blockW, MICRO_SPINE_H, `${spec.name}: коридор микроблоков`, spec.wallTex, spec.floorTex);
  if (!spine) return;

  let serial = 0;
  for (let row = 0; row < spec.rows; row++) {
    const aboveSpine = row < topRows;
    const localRow = aboveSpine ? row : row - topRows;
    const y = aboveSpine
      ? spec.y + localRow * (MICRO_ROOM_H + MICRO_GAP_Y)
      : spine.y + spine.h + 6 + localRow * (MICRO_ROOM_H + MICRO_GAP_Y);
    for (let col = 0; col < spec.cols; col++) {
      const x = spec.x + 5 + col * (MICRO_ROOM_W + MICRO_GAP_X);
      const type = bolnichnyMicroRoomType(spec.dirty, row, col);
      const room = tryAddBolnichnyRoom(
        world,
        type,
        x,
        y,
        MICRO_ROOM_W,
        MICRO_ROOM_H,
        `${spec.name}: ${bolnichnyMicroRoomName(type, spec.dirty)} ${serial + 1}`,
        type === RoomType.STORAGE || type === RoomType.PRODUCTION ? Tex.METAL : spec.wallTex,
        type === RoomType.BATHROOM ? Tex.F_TILE : spec.floorTex,
      );
      if (!room) continue;
      connectRoomToPoint(world, room, room.x + (room.w >> 1), spine.y + (spine.h >> 1), DoorState.CLOSED, spec.floorTex);
      decorateBolnichnyMicroRoom(world, room, serial, spec.dirty);
      if (spec.dirty && rng() < 0.28) stampWardSurface(world, room, serial + 40, 3);
      serial++;
    }
  }
  connectRoomToPoint(world, spine, spec.linkX, spec.linkY, DoorState.CLOSED, spec.floorTex);
}

function bolnichnyMicroRoomType(dirty: boolean, row: number, col: number): RoomType {
  const clean = [RoomType.MEDICAL, RoomType.OFFICE, RoomType.STORAGE, RoomType.BATHROOM, RoomType.MEDICAL, RoomType.KITCHEN] as const;
  const contaminated = [RoomType.MEDICAL, RoomType.STORAGE, RoomType.BATHROOM, RoomType.SMOKING, RoomType.COMMON, RoomType.MEDICAL] as const;
  const list = dirty ? contaminated : clean;
  return list[(row * 3 + col * 5) % list.length];
}

function bolnichnyMicroRoomName(type: RoomType, dirty: boolean): string {
  if (type === RoomType.STORAGE) return dirty ? 'шкаф заражённых простыней' : 'шкаф стерильных тележек';
  if (type === RoomType.BATHROOM) return dirty ? 'грязный санузел' : 'санпропуск';
  if (type === RoomType.KITCHEN) return 'чайная медсестёр';
  if (type === RoomType.OFFICE) return 'кабинет малых карт';
  if (type === RoomType.SMOKING) return 'закуток ожидания кашля';
  if (type === RoomType.COMMON) return dirty ? 'тёмный бокс очереди' : 'бокс ожидания';
  return dirty ? 'микропалата температуры' : 'микропалата осмотра';
}

function decorateBolnichnyMicroRoom(world: World, room: Room, serial: number, dirty: boolean): void {
  switch (room.type) {
    case RoomType.MEDICAL:
      setFeature(world, room.x + 3, room.y + 3, Feature.BED);
      setFeature(world, room.x + room.w - 4, room.y + 3, dirty ? Feature.APPARATUS : Feature.SINK);
      break;
    case RoomType.BATHROOM:
      setFeature(world, room.x + 3, room.y + 3, Feature.SINK);
      setFeature(world, room.x + room.w - 4, room.y + room.h - 3, Feature.TOILET);
      break;
    case RoomType.KITCHEN:
      setFeature(world, room.x + 3, room.y + 3, Feature.STOVE);
      setFeature(world, room.x + room.w - 4, room.y + 3, Feature.SINK);
      setFeature(world, room.x + 5, room.y + room.h - 3, Feature.TABLE);
      break;
    case RoomType.STORAGE:
      setFeature(world, room.x + 3, room.y + 3, Feature.SHELF);
      setFeature(world, room.x + room.w - 4, room.y + 3, Feature.SHELF);
      break;
    case RoomType.PRODUCTION:
      setFeature(world, room.x + 4, room.y + 4, Feature.MACHINE);
      setFeature(world, room.x + room.w - 5, room.y + 4, Feature.SCREEN);
      break;
    case RoomType.OFFICE:
      setFeature(world, room.x + 3, room.y + 3, Feature.DESK);
      setFeature(world, room.x + room.w - 4, room.y + 3, Feature.SHELF);
      break;
    default:
      setFeature(world, room.x + 4, room.y + 4, dirty || serial % 3 === 0 ? Feature.CANDLE : Feature.CHAIR);
      setFeature(world, room.x + room.w - 5, room.y + room.h - 4, Feature.TABLE);
      break;
  }
}

function decorateBolnichnyHqCore(world: World, room: Room, owner: TerritoryOwner): void {
  setFeature(world, room.x + 4, room.y + 4, owner === ZoneFaction.CULTIST ? Feature.CANDLE : Feature.DESK);
  setFeature(world, room.x + room.w - 5, room.y + 4, owner === ZoneFaction.SCIENTIST ? Feature.APPARATUS : Feature.SCREEN);
  setFeature(world, room.x + 5, room.y + room.h - 5, Feature.SHELF);
  setFeature(world, room.x + room.w - 6, room.y + room.h - 5, Feature.LAMP);
}

function tryAddBolnichnyRoom(
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
  if (!canStampBolnichnyRoom(world, x, y, w, h)) return null;
  return addRoom(world, type, x, y, w, h, name, wallTex, floorTex);
}

function canStampBolnichnyRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const idx = world.idx(x + dx, y + dy);
      if (world.aptMask[idx] || world.hermoWall[idx] || world.cells[idx] === Cell.LIFT) return false;
      if (world.cells[idx] === Cell.DOOR || world.roomMap[idx] >= 0) return false;
      if (world.cells[idx] !== Cell.WALL && world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) return false;
    }
  }
  return true;
}

function markBolnichnyHermeticRoom(world: World, room: Room): void {
  room.sealed = true;
  room.wallTex = Tex.HERMO_WALL;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.cells[idx] !== Cell.WALL || world.aptMask[idx]) continue;
      world.hermoWall[idx] = 1;
      world.wallTex[idx] = Tex.HERMO_WALL;
    }
  }
}

function connectRoomToPoint(world: World, room: Room, x: number, y: number, state: DoorState, floorTex: Tex): void {
  const side = sideToward(world, room, x, y);
  const site = doorSite(room, side);
  addDoorAt(world, room, site.x, site.y, state);
  carveLineWidth(world, site.ox, site.oy, Math.floor(x), Math.floor(y), 3, floorTex);
}

function sideToward(world: World, room: Room, x: number, y: number): DoorSide {
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h / 2;
  const dx = world.delta(cx, x);
  const dy = world.delta(cy, y);
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}

function oppositeSide(side: DoorSide): DoorSide {
  if (side === 'north') return 'south';
  if (side === 'south') return 'north';
  if (side === 'west') return 'east';
  return 'west';
}

function applyBolnichnyAuthoredTerritory(world: World): void {
  for (const site of BOLNICHNY_HQ_SITES) {
    for (const room of world.rooms) {
      if (!room || (room.name !== site.name && !room.name.startsWith(`${site.name}:`))) continue;
      if (room.name === site.name) {
        room.type = RoomType.HQ;
        markBolnichnyHermeticRoom(world, room);
      }
      paintBolnichnyRoomOwner(world, room, site.owner);
    }
    stampBolnichnyOwnerPatch(world, site.x + (site.w >> 1), site.y + (site.h >> 1), 38, site.owner);
  }

  for (const block of BOLNICHNY_MICRO_BLOCKS) {
    for (const room of world.rooms) {
      if (!room || !room.name.startsWith(`${block.name}:`)) continue;
      paintBolnichnyRoomOwner(world, room, block.owner);
    }
    const topRows = Math.ceil(block.rows / 2);
    const centerX = block.x + Math.floor((block.cols * MICRO_ROOM_W + (block.cols - 1) * MICRO_GAP_X) / 2);
    const centerY = block.y + topRows * (MICRO_ROOM_H + MICRO_GAP_Y) + 6;
    stampBolnichnyOwnerPatch(world, centerX, centerY, 52, block.owner);
  }
}

function paintBolnichnyRoomOwner(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.aptMask[idx]) continue;
      world.factionControl[idx] = owner;
    }
  }
}

function stampBolnichnyOwnerPatch(world: World, cx: number, cy: number, radius: number, owner: TerritoryOwner): void {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const idx = world.idx(cx + dx, cy + dy);
      if (world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.ABYSS || world.aptMask[idx]) continue;
      world.factionControl[idx] = owner;
    }
  }
}

function placeLifts(world: World, rooms: BolnichnyRooms): void {
  placeLift(world, rooms.triageEntrance.x + 100, rooms.triageEntrance.y + 17, rooms.triageEntrance.x + 94, rooms.triageEntrance.y + 16, LiftDirection.UP);
  placeLift(world, rooms.lowerLift.x + rooms.lowerLift.w - 12, rooms.lowerLift.y + 14, rooms.lowerLift.x + rooms.lowerLift.w - 18, rooms.lowerLift.y + 12, LiftDirection.DOWN);
}

function placeBolnichnyEmergencyPanels(world: World, rooms: BolnichnyRooms): void {
  placeEmergencyPanel(world, rooms.checkpoint.x + 8, rooms.checkpoint.y + 9, 'panel_doors', SEED ^ 0x51c0);
  placeEmergencyPanel(world, rooms.pharmacy.x + rooms.pharmacy.w - 12, rooms.pharmacy.y + 9, 'panel_power', SEED ^ 0x51c1);
  placeEmergencyPanel(world, rooms.ventilationIntake.x + 8, rooms.ventilationIntake.y + 6, 'panel_vent', SEED ^ 0x51c2);
  placeEmergencyPanel(world, rooms.redWard.x + 10, rooms.redWard.y + 10, 'panel_water', SEED ^ 0x51c3);
}

function spawnNpcs(entities: Entity[], nextId: NextId, rooms: BolnichnyRooms): Record<BolnichnyNpcId, number> {
  return {
    bolnichny_doctor_galina: spawnPlotNpc(entities, nextId, 'bolnichny_doctor_galina', NPC_DEFS.bolnichny_doctor_galina, rooms.surgery.x + 16, rooms.surgery.y + 24, Math.PI),
    bolnichny_pharmacist_ira: spawnPlotNpc(entities, nextId, 'bolnichny_pharmacist_ira', NPC_DEFS.bolnichny_pharmacist_ira, rooms.pharmacy.x + 18, rooms.pharmacy.y + 24, Math.PI),
    bolnichny_liquidator_sazan: spawnPlotNpc(entities, nextId, 'bolnichny_liquidator_sazan', NPC_DEFS.bolnichny_liquidator_sazan, rooms.checkpoint.x + 38, rooms.checkpoint.y + 22, Math.PI / 2, 'makarov'),
    bolnichny_patient_grisha: spawnPlotNpc(entities, nextId, 'bolnichny_patient_grisha', NPC_DEFS.bolnichny_patient_grisha, rooms.feverWard.x + 30, rooms.feverWard.y + 34, 0),
    bolnichny_clerk_nina: spawnPlotNpc(entities, nextId, 'bolnichny_clerk_nina', NPC_DEFS.bolnichny_clerk_nina, rooms.papers.x + 18, rooms.papers.y + 22, Math.PI),
  };
}

function spawnAmbientNpcs(entities: Entity[], nextId: NextId, rooms: BolnichnyRooms): void {
  spawnAmbientNpc(entities, nextId, 'Санитар чистой петли', Faction.CITIZEN, Occupation.DOCTOR, rooms.cleanWard.x + 20, rooms.cleanWard.y + 24, [
    { defId: 'bandage', count: 2 },
    { defId: 'sterile_bandage', count: 1 },
  ]);
  spawnAmbientNpc(entities, nextId, 'Вентиляционный фельдшер', Faction.SCIENTIST, Occupation.ELECTRICIAN, rooms.ventilationOutlet.x + 30, rooms.ventilationOutlet.y + 12, [
    { defId: 'gasmask_filter', count: 1 },
    { defId: 'wire_coil', count: 1 },
  ]);
  spawnAmbientNpc(entities, nextId, 'Ликвидатор у чёрной палаты', Faction.LIQUIDATOR, Occupation.HUNTER, rooms.blackWard.x + 18, rooms.blackWard.y + 22, [
    { defId: 'ammo_9mm', count: 12 },
  ], 'makarov');
}

function placeContainers(world: World, rooms: BolnichnyRooms, owners: Record<BolnichnyNpcId, number>): void {
  addContainer(world, rooms.triageEntrance, rooms.triageEntrance.x + 15, rooms.triageEntrance.y + 11, ContainerKind.MEDICAL_CABINET, 'Открытая тележка сортировки', 'public', [
    { defId: 'bandage', count: 2 },
    { defId: 'pills', count: 1 },
    { defId: 'cotton_wool', count: 3 },
  ], undefined, undefined, ['bolnichny_korpus', 'triage', 'medicine', 'public']);

  addContainer(world, rooms.pharmacy, rooms.pharmacy.x + 10, rooms.pharmacy.y + 10, ContainerKind.MEDICAL_CABINET, 'Аптечный шкаф строгого учёта', 'locked', [
    { defId: 'sanitary_kit', count: 2 },
    { defId: 'morphine_ampoule', count: 1 },
    { defId: 'antibiotic', count: 2 },
    { defId: 'sterile_bandage', count: 2 },
    { defId: 'official_quarantine_clearance', count: 1 },
  ], owners.bolnichny_pharmacist_ira, NPC_DEFS.bolnichny_pharmacist_ira.name, ['bolnichny_korpus', 'pharmacy', 'medicine', 'theft', 'gated']);

  addContainer(world, rooms.coldStore, rooms.coldStore.x + 10, rooms.coldStore.y + 10, ContainerKind.METAL_CABINET, 'Холодный шкаф вакцин', 'locked', [
    { defId: 'anti_spore_inhaler', count: 1 },
    { defId: 'burn_gel', count: 1 },
    { defId: 'decon_fluid', count: 1 },
    { defId: 'gasmask_filter', count: 1 },
  ], undefined, undefined, ['bolnichny_korpus', 'cold_store', 'medicine', 'filters']);

  addContainer(world, rooms.papers, rooms.papers.x + rooms.papers.w - 9, rooms.papers.y + 12, ContainerKind.FILING_CABINET, 'Картотека заражённых бумаг', 'owner', [
    { defId: 'contaminated_sample_act', count: 1 },
    { defId: 'record_exposure_notice', count: 1 },
    { defId: 'blank_form', count: 2 },
    { defId: 'forged_quarantine_clearance', count: 1 },
  ], owners.bolnichny_clerk_nina, NPC_DEFS.bolnichny_clerk_nina.name, ['bolnichny_korpus', 'contaminated_papers', 'documents', 'forgery', 'expose']);

  addContainer(world, rooms.redWard, rooms.redWard.x + rooms.redWard.w - 12, rooms.redWard.y + 12, ContainerKind.MEDICAL_CABINET, 'Тумба красной палаты', 'secret', [
    { defId: 'contaminated_swab', count: 2 },
    { defId: 'quarantine_medcard', count: 1 },
    { defId: 'contaminated_gloves', count: 1 },
  ], undefined, undefined, ['bolnichny_korpus', 'infected_ward', 'contaminated', 'evidence']);
}

function placeDrops(world: World, entities: Entity[], nextId: NextId, rooms: BolnichnyRooms): void {
  dropItem(world, entities, nextId, rooms.ventilationIntake.x + 18, rooms.ventilationIntake.y + 12, 'blank_form', 1);
  dropItem(world, entities, nextId, rooms.cleanWard.x + 22, rooms.cleanWard.y + 36, 'sterile_bandage', 1);
  dropItem(world, entities, nextId, rooms.redWard.x + 38, rooms.redWard.y + 36, 'contaminated_swab', 1);
}

function spawnThreats(world: World, entities: Entity[], nextId: NextId, rooms: BolnichnyRooms): void {
  spawnMonster(world, entities, nextId, MonsterKind.DIKIY_MERTVYAK, rooms.redWard.x + 62, rooms.redWard.y + 32, 3, 'Температурный мертвяк палаты');
  spawnMonster(world, entities, nextId, MonsterKind.HEAD_SLUG, rooms.feverWard.x + 62, rooms.feverWard.y + 28, 3, 'Головной слизень у койки');
  spawnMonster(world, entities, nextId, MonsterKind.CHERNOSLIZ, rooms.blackWard.x + 50, rooms.blackWard.y + 30, 4, 'Чернослиз закрытой истории');
  spawnMonster(world, entities, nextId, MonsterKind.BEZEKHIY, rooms.ventilationSpine.x + 15, rooms.ventilationSpine.y + 96, 3, 'Безэхий в вентиляции');
}

function addRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
  sealed = false,
): Room {
  const room = stampRoom(world, world.rooms.length, type, Math.floor(x), Math.floor(y), w, h, -1);
  room.name = name;
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  room.sealed = sealed;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) {
        world.floorTex[ci] = floorTex;
      } else {
        world.wallTex[ci] = wallTex;
        if (sealed) world.hermoWall[ci] = 1;
      }
    }
  }
  return room;
}

function doorSite(room: Room, side: DoorSide): DoorSite {
  switch (side) {
    case 'north': {
      const x = room.x + (room.w >> 1);
      const y = room.y - 1;
      return { x, y, ox: x, oy: room.y };
    }
    case 'south': {
      const x = room.x + (room.w >> 1);
      const y = room.y + room.h;
      return { x, y, ox: x, oy: room.y + room.h - 1 };
    }
    case 'west': {
      const x = room.x - 1;
      const y = room.y + (room.h >> 1);
      return { x, y, ox: room.x, oy: y };
    }
    case 'east': {
      const x = room.x + room.w;
      const y = room.y + (room.h >> 1);
      return { x, y, ox: room.x + room.w - 1, oy: y };
    }
  }
}

function addDoorAt(world: World, room: Room, x: number, y: number, state: DoorState, keyId = ''): number {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.DOOR;
  world.hermoWall[idx] = 0;
  const metalDoor = state === DoorState.LOCKED || state === DoorState.HERMETIC_OPEN || state === DoorState.HERMETIC_CLOSED;
  world.wallTex[idx] = metalDoor ? Tex.DOOR_METAL : Tex.DOOR_WOOD;
  const existing = world.doors.get(idx);
  if (existing) {
    existing.state = state;
    existing.keyId = keyId;
  } else {
    world.doors.set(idx, {
      idx,
      state,
      roomA: room.id,
      roomB: -1,
      keyId,
      timer: 0,
    });
  }
  if (!room.doors.includes(idx)) room.doors.push(idx);
  return idx;
}

function restoreBolnichnyGatedRoomShell(world: World, room: Room, hermetic: boolean, keyId = ''): void {
  const doors = new Set(room.doors);
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.cells[idx] === Cell.LIFT) continue;
      const door = world.doors.get(idx);
      if (door || doors.has(idx)) {
        world.cells[idx] = Cell.DOOR;
        world.hermoWall[idx] = 0;
        world.wallTex[idx] = Tex.DOOR_METAL;
        if (door) {
          door.state = hermetic ? DoorState.HERMETIC_CLOSED : DoorState.LOCKED;
          door.keyId = hermetic ? '' : (door.keyId || keyId);
          if (door.roomA < 0) door.roomA = room.id;
        } else {
          world.doors.set(idx, {
            idx,
            state: hermetic ? DoorState.HERMETIC_CLOSED : DoorState.LOCKED,
            roomA: room.id,
            roomB: -1,
            keyId: hermetic ? '' : keyId,
            timer: 0,
          });
        }
        if (!room.doors.includes(idx)) room.doors.push(idx);
        continue;
      }
      world.cells[idx] = Cell.WALL;
      world.roomMap[idx] = -1;
      world.features[idx] = Feature.NONE;
      world.hermoWall[idx] = hermetic ? 1 : 0;
      world.wallTex[idx] = hermetic ? Tex.HERMO_WALL : room.wallTex;
    }
  }
}

function placeGateLine(
  world: World,
  x: number,
  y: number,
  orientation: 'vertical' | 'horizontal',
  state: DoorState,
  keyId: string,
  room: Room,
): void {
  for (let offset = -1; offset <= 1; offset++) {
    const wx = orientation === 'vertical' ? x : x + offset;
    const wy = orientation === 'vertical' ? y + offset : y;
    const idx = world.idx(wx, wy);
    world.cells[idx] = Cell.WALL;
    world.roomMap[idx] = -1;
    world.features[idx] = Feature.NONE;
    world.hermoWall[idx] = state === DoorState.HERMETIC_CLOSED ? 1 : 0;
    world.wallTex[idx] = state === DoorState.HERMETIC_CLOSED ? Tex.HERMO_WALL : Tex.DOOR_METAL;
  }
  const doorIdx = world.idx(x, y);
  world.cells[doorIdx] = Cell.DOOR;
  world.hermoWall[doorIdx] = 0;
  world.wallTex[doorIdx] = state === DoorState.HERMETIC_CLOSED ? Tex.DOOR_METAL : Tex.DOOR_METAL;
  world.doors.set(doorIdx, {
    idx: doorIdx,
    state,
    roomA: room.id,
    roomB: -1,
    keyId,
    timer: 0,
  });
  if (!room.doors.includes(doorIdx)) room.doors.push(doorIdx);
}

function connectRooms(world: World, a: Room, sideA: DoorSide, b: Room, sideB: DoorSide, state: DoorState, keyId = ''): void {
  const da = doorSite(a, sideA);
  const db = doorSite(b, sideB);
  const ai = addDoorAt(world, a, da.x, da.y, state, keyId);
  const bi = addDoorAt(world, b, db.x, db.y, state, keyId);
  const ad = world.doors.get(ai);
  const bd = world.doors.get(bi);
  if (ad) ad.roomB = b.id;
  if (bd) bd.roomB = a.id;
  carveLineWidth(world, da.ox, da.oy, db.ox, db.oy, 3, a.floorTex);
}

function carveLineWidth(world: World, ax: number, ay: number, bx: number, by: number, width: number, floorTex: Tex): void {
  if (ax !== bx && ay !== by) {
    carveLineWidth(world, ax, ay, bx, ay, width, floorTex);
    carveLineWidth(world, bx, ay, bx, by, width, floorTex);
    return;
  }
  const half = width >> 1;
  const from = ax === bx ? Math.min(ay, by) : Math.min(ax, bx);
  const to = ax === bx ? Math.max(ay, by) : Math.max(ax, bx);
  for (let p = from; p <= to; p++) {
    for (let n = 0; n < width; n++) {
      const o = n - half;
      openTile(world, ax === bx ? ax + o : p, ax === bx ? p : ay + o, floorTex, -1);
    }
  }
}

function openTile(world: World, x: number, y: number, floorTex: Tex, roomId: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR || world.hermoWall[ci]) return;
  world.cells[ci] = Cell.FLOOR;
  if (roomId >= 0 || world.roomMap[ci] < 0) world.roomMap[ci] = roomId;
  world.floorTex[ci] = floorTex;
  if (world.features[ci] !== Feature.NONE) world.features[ci] = Feature.NONE;
}

function stampInfectionVoronoi(world: World, rooms: BolnichnyRooms, salt: number): void {
  const seeds = [
    { x: rooms.feverWard.x + 22, y: rooms.feverWard.y + 18, radius: 74, r: 142, g: 128, b: 34 },
    { x: rooms.redWard.x + 54, y: rooms.redWard.y + 32, radius: 86, r: 170, g: 44, b: 34 },
    { x: rooms.blackWard.x + 44, y: rooms.blackWard.y + 28, radius: 72, r: 38, g: 72, b: 64 },
    { x: rooms.ventilationSpine.x + 14, y: rooms.ventilationSpine.y + 98, radius: 92, r: 94, g: 118, b: 72 },
  ];
  const dirtyRooms = [rooms.feverWard, rooms.redWard, rooms.blackWard, rooms.ventilationSpine];
  for (const room of dirtyRooms) {
    for (let y = room.y + 2; y < room.y + room.h - 2; y++) {
      for (let x = room.x + 2; x < room.x + room.w - 2; x++) {
        const ci = world.idx(x, y);
        if (world.cells[ci] !== Cell.FLOOR || world.features[ci] !== Feature.NONE) continue;
        let best = 0;
        let bestD = Number.POSITIVE_INFINITY;
        let secondD = Number.POSITIVE_INFINITY;
        for (let i = 0; i < seeds.length; i++) {
          const seed = seeds[i]!;
          const d = world.dist2(x, y, seed.x, seed.y) / (seed.radius * seed.radius);
          if (d < bestD) {
            secondD = bestD;
            bestD = d;
            best = i;
          } else if (d < secondD) {
            secondD = d;
          }
        }
        if (bestD > 1.15) continue;
        const ridge = Math.abs(secondD - bestD);
        const wet = ridge < 0.18 || hash01(salt, x, y, best) > 0.86;
        if (wet) {
          world.cells[ci] = Cell.WATER;
          world.floorTex[ci] = Tex.F_WATER;
        }
        world.fog[ci] = Math.max(world.fog[ci], Math.floor(22 + (1 - Math.min(1, bestD)) * 82));
      }
    }
  }
  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i]!;
    stampSurfaceSplat(world, seed.x, seed.y, 0.5, 0.5, 7 + i * 1.5, 0.22, salt ^ i, seed.r, seed.g, seed.b, false);
  }
}

function applyColdWarmShells(world: World, rooms: BolnichnyRooms): void {
  for (const room of [rooms.pharmacy, rooms.coldStore, rooms.cleanLoopNorth]) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        const ci = world.idx(x, y);
        if (world.cells[ci] === Cell.FLOOR) world.light[ci] = Math.max(world.light[ci], 0.34);
      }
    }
  }
  for (const room of [rooms.feverWard, rooms.redWard, rooms.blackWard]) {
    stampWardSurface(world, room, room.id, room === rooms.blackWard ? 7 : 5);
  }
}

function stampWardSurface(world: World, room: Room, serial: number, radius: number): void {
  stampSurfaceSplat(
    world,
    room.x + (room.w >> 1),
    room.y + (room.h >> 1),
    0.5,
    0.5,
    radius,
    0.24,
    SEED ^ serial,
    serial % 2 === 0 ? 144 : 78,
    serial % 3 === 0 ? 42 : 112,
    serial % 2 === 0 ? 36 : 68,
    false,
  );
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER) world.features[ci] = feature;
}

function markScreenWall(world: World, x: number, y: number, frame: number): void {
  const idx = world.idx(x, y);
  if (world.cells[idx] !== Cell.WALL) return;
  world.features[idx] = Feature.SCREEN;
  world.wallTex[idx] = (Tex.SCREEN_BASE + (frame % 8) * 4) as Tex;
  if (!world.screenCells.includes(idx)) world.screenCells.push(idx);
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

function spawnPlotNpc(
  entities: Entity[],
  nextId: NextId,
  npcId: BolnichnyNpcId,
  _def: PlotNpcDef,
  x: number,
  y: number,
  angle: number,
  weapon?: string,
): number {
  const px = x + 0.5;
  const py = y + 0.5;
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, npcId, px, py, {
    angle,
    weapon,
    aiTarget: { x: px, y: py },
  });
  return npc.id;
}

function spawnAmbientNpc(
  entities: Entity[],
  nextId: NextId,
  name: string,
  faction: Faction,
  occupation: Occupation,
  x: number,
  y: number,
  inventory: Item[],
  weapon?: string,
): void {
  entities.push({
    id: nextId.v++,
    type: EntityType.NPC,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: faction === Faction.LIQUIDATOR ? 0.94 : 0.72 + Math.random() * 0.16,
    sprite: occupation,
    name,
    needs: freshNeeds(),
    hp: faction === Faction.LIQUIDATOR ? 145 : 86,
    maxHp: faction === Faction.LIQUIDATOR ? 145 : 86,
    money: 10 + Math.floor(Math.random() * 42),
    ai: { goal: AIGoal.IDLE, tx: x + 0.5, ty: y + 0.5, path: [], pi: 0, stuck: 0, timer: 0 },
    inventory: inventory.map(item => ({ ...item })),
    weapon,
    faction,
    occupation,
    questId: -1,
  });
}

function spawnMonster(
  world: World,
  entities: Entity[],
  nextId: NextId,
  kind: MonsterKind,
  x: number,
  y: number,
  level: number,
  name?: string,
): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) return;
  const def = MONSTERS[kind];
  if (!def) return;
  const hp = Math.round(def.hp * (0.82 + level * 0.17));
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: def.speed * (0.95 + level * 0.04),
    sprite: monsterSpr(kind),
    name,
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
    phasing: kind === MonsterKind.SHADOW || kind === MonsterKind.SPIRIT,
  });
}

function addContainer(
  world: World,
  room: Room,
  x: number,
  y: number,
  kind: ContainerKind,
  name: string,
  access: WorldContainer['access'],
  inventory: Item[],
  ownerNpcId: number | undefined,
  ownerName: string | undefined,
  tags: string[],
): WorldContainer {
  const container: WorldContainer = {
    id: nextContainerId(world),
    x: world.wrap(x),
    y: world.wrap(y),
    floor: BOLNICHNY_KORPUS_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind,
    name,
    inventory: inventory.map(item => ({ ...item })),
    capacitySlots: Math.max(8, inventory.length + 4),
    ownerNpcId,
    ownerName,
    faction: access === 'faction' ? Faction.LIQUIDATOR : undefined,
    access,
    lockDifficulty: access === 'locked' ? 4 : undefined,
    discovered: access !== 'secret',
    tags,
  };
  world.addContainer(container);
  setFeature(world, x, y, kind === ContainerKind.MEDICAL_CABINET ? Feature.APPARATUS : Feature.SHELF);
  return container;
}

function nextContainerId(world: World): number {
  let id = 1;
  for (const container of world.containers) id = Math.max(id, container.id + 1);
  return id;
}

function dropItem(
  world: World,
  entities: Entity[],
  nextId: NextId,
  x: number,
  y: number,
  defId: string,
  count: number,
): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) return;
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

function hash01(seed: number, x: number, y: number, salt: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul((x + 0x632be5ab) | 0, 0x27d4eb2d);
  h ^= Math.imul((y + 0x85157af5) | 0, 0x165667b1);
  h ^= Math.imul((salt + 0x94d049bb) | 0, 0xd3a2646c);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 0x100000000;
}
