/* ── Design floor: НИИ слизи ─────────────────────────────────── */

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
import { factionToTerritoryOwner } from '../../data/factions';
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { placeEmergencyPanel } from '../../systems/emergency_panels';
import { randomRPG } from '../../systems/rpg';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import {
  ensureConnectivity,
  generateZones,
  sanitizeDoors,
  stampRoom,
} from '../shared';
import type { FloorGeneration } from '../floor_manifest';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('slime_nii');

export const DESIGN_FLOOR_ID = 'slime_nii' as const;
export const SLIME_NII_Z = 12 as const;
export const SLIME_NII_BASE_FLOOR = FloorLevel.KVARTIRY;
export const SLIME_NII_CAMERA_ROOM_PREFIX = 'Гермокамера НИИ слизи';

const SEED = hashSeed(DESIGN_FLOOR_ID);
const CX = W >> 1;
const CY = W >> 1;
const REACTION_GRID = 64;
const REACTION_CELL = W / REACTION_GRID;
const REACTION_CELLS = REACTION_GRID * REACTION_GRID;
const REACTION_STEPS = 26;

type NextId = { v: number };
type DoorSide = 'north' | 'south' | 'west' | 'east';
type SlimeNiiNpcId =
  | 'slime_nii_director_larisa'
  | 'slime_nii_liquidator_voron'
  | 'slime_nii_volunteer_mitya'
  | 'slime_nii_secretary_ada';

interface SlimeNiiRooms {
  entry: Room;
  atrium: Room;
  checkpoint: Room;
  admin: Room;
  secretary: Room;
  cleanLab: Room;
  coldStorage: Room;
  drainWard: Room;
  volunteerWard: Room;
  liquidatorPost: Room;
  lowerLift: Room;
  bypass: Room;
  cameras: Room[];
}

interface DoorSite {
  x: number;
  y: number;
  ox: number;
  oy: number;
}

interface SlimeNiiHqSpec {
  owner: TerritoryOwner;
  x: number;
  y: number;
  name: string;
  supportPrefix: string;
  wallTex: Tex;
  floorTex: Tex;
}

interface SlimeNiiDistrictSpec {
  x: number;
  y: number;
  name: string;
  owner: TerritoryOwner;
  type: RoomType;
  wallTex: Tex;
  floorTex: Tex;
  wet: boolean;
}

interface SlimeNiiCabinetStripSpec {
  x: number;
  y: number;
  cols: number;
  rows: number;
  name: string;
  owner: TerritoryOwner;
  wallTex: Tex;
  floorTex: Tex;
  roomTypes: readonly RoomType[];
}

const NPC_DEFS: Record<SlimeNiiNpcId, PlotNpcDef> = {
  slime_nii_director_larisa: {
    name: 'Лариса Гладкая',
    isFemale: true,
    faction: Faction.SCIENTIST,
    occupation: Occupation.DIRECTOR,
    sprite: Occupation.DIRECTOR,
    hp: 150, maxHp: 150, money: 170, speed: 0.82,
    inventory: [
      { defId: 'nii_sample_container', count: 1 },
      { defId: 'official_quarantine_clearance', count: 1 },
      { defId: 'pills', count: 1 },
    ],
    talkLines: [
      'НИИ слизи не лечит дом. Мы только выясняем, какая его часть уже решила лечить нас.',
      'Камера открывается как вопрос: образец, человек или ошибка. Закрытой она хотя бы честна.',
      'Если проба зелёная, держите её отдельно от еды, ткани и оправданий.',
    ],
    talkLinesPost: [
      'Пломба целая. Значит, сегодня наука пока сильнее коридора.',
      'Ликвидаторы хотят всё сжечь, рынок хочет всё купить. У обоих плохая методика.',
    ],
  },
  slime_nii_liquidator_voron: {
    name: 'Ворон Чистый',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 210, maxHp: 210, money: 90, speed: 1.0,
    weapon: 'makarov',
    inventory: [
      { defId: 'makarov', count: 1 },
      { defId: 'ammo_9mm', count: 18 },
      { defId: 'key', count: 1 },
    ],
    talkLines: [
      'Я не спорю с учёными. Я считаю открытые двери после их споров.',
      'Чёрную камеру не открывайте без отхода. То, что там плавает, стреляет водой лучше человека.',
      'Ключ общий. Ответственность личная.',
    ],
    talkLinesPost: [
      'Один отсек тише. Остальные пока делают вид, что они стены.',
      'Если сирена пошла по влажному полу, не спасайте журнал раньше людей.',
    ],
  },
  slime_nii_volunteer_mitya: {
    name: 'Митя Испытуемый',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.TRAVELER,
    sprite: Occupation.TRAVELER,
    hp: 95, maxHp: 95, money: 16, speed: 0.9,
    inventory: [
      { defId: 'quarantine_medcard', count: 1 },
      { defId: 'slime_sample_contaminated', count: 1 },
    ],
    talkLines: [
      'Меня записали добровольцем после подписи, которую я не помню.',
      'Если откроете камеру, я выйду. Если оставите закрытой, в журнале всё будет аккуратно.',
      'Лариса обещала не отдавать меня ликвидаторам. Ворон обещал не обещать.',
    ],
    talkLinesPost: [
      'Воздух снаружи пахнет коридором. Это лучше, чем стеклом.',
      'Не берите белую пробу руками. Она просит ласково.',
    ],
  },
  slime_nii_secretary_ada: {
    name: 'Ада Журнальная',
    isFemale: true,
    faction: Faction.SCIENTIST,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 105, maxHp: 105, money: 110, speed: 0.86,
    inventory: [
      { defId: 'blank_form', count: 2 },
      { defId: 'nii_contraband_manifest', count: 1 },
      { defId: 'fake_pass', count: 1 },
    ],
    talkLines: [
      'Журнал говорит, что проба ушла в утиль. Рынок говорит, что утиль умеет платить.',
      'Если нужен чистый проход, не ищите чистого человека. Ищите строку без свидетеля.',
      'Я могу выдать обходной талон, но он обидится на первую печать Министерства.',
    ],
    talkLinesPost: [
      'Расписка исчезла. Значит, теперь её будут искать громче.',
      'В лаборатории безопасно только то, что ещё не внесли в журнал.',
    ],
  },
};

const SLIME_NII_HQ_SPECS: readonly SlimeNiiHqSpec[] = [
  {
    owner: ZoneFaction.SCIENTIST,
    x: 602,
    y: 268,
    name: 'Герметичный штаб научного совета НИИ',
    supportPrefix: 'научного совета',
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_TILE,
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    x: 238,
    y: 650,
    name: 'Герметичный штаб карантинной зачистки',
    supportPrefix: 'карантинной зачистки',
    wallTex: Tex.METAL,
    floorTex: Tex.F_CONCRETE,
  },
  {
    owner: ZoneFaction.CITIZEN,
    x: 276,
    y: 250,
    name: 'Герметичный штаб очереди добровольцев',
    supportPrefix: 'очереди добровольцев',
    wallTex: Tex.PANEL,
    floorTex: Tex.F_LINO,
  },
  {
    owner: ZoneFaction.CULTIST,
    x: 742,
    y: 708,
    name: 'Скрытый штаб мокрой молитвы',
    supportPrefix: 'мокрой молитвы',
    wallTex: Tex.BRICK,
    floorTex: Tex.F_WATER,
  },
  {
    owner: ZoneFaction.WILD,
    x: 756,
    y: 292,
    name: 'Разорённый штаб расхитителей проб',
    supportPrefix: 'расхитителей проб',
    wallTex: Tex.BRICK,
    floorTex: Tex.F_CONCRETE,
  },
];

const SLIME_NII_DISTRICTS: readonly SlimeNiiDistrictSpec[] = [
  { x: 126, y: 118, name: 'северо-западный санитарный филиал', owner: ZoneFaction.CITIZEN, type: RoomType.MEDICAL, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE, wet: false },
  { x: 300, y: 112, name: 'кабинетная линия добровольцев', owner: ZoneFaction.CITIZEN, type: RoomType.OFFICE, wallTex: Tex.PANEL, floorTex: Tex.F_LINO, wet: false },
  { x: 482, y: 104, name: 'верхняя клеточная галерея', owner: ZoneFaction.SCIENTIST, type: RoomType.MEDICAL, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE, wet: false },
  { x: 660, y: 116, name: 'северо-восточный опытный филиал', owner: ZoneFaction.SCIENTIST, type: RoomType.PRODUCTION, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE, wet: true },
  { x: 820, y: 130, name: 'архив сухих этикеток', owner: ZoneFaction.WILD, type: RoomType.STORAGE, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE, wet: false },
  { x: 116, y: 328, name: 'блок промывочных кабинетов', owner: ZoneFaction.LIQUIDATOR, type: RoomType.PRODUCTION, wallTex: Tex.PIPE, floorTex: Tex.F_WATER, wet: true },
  { x: 284, y: 356, name: 'длинный кабинет микробиологов', owner: ZoneFaction.SCIENTIST, type: RoomType.MEDICAL, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE, wet: false },
  { x: 688, y: 358, name: 'пост хранения живых чашек', owner: ZoneFaction.SCIENTIST, type: RoomType.STORAGE, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE, wet: false },
  { x: 836, y: 348, name: 'руинированный склад реагентов', owner: ZoneFaction.WILD, type: RoomType.STORAGE, wallTex: Tex.BRICK, floorTex: Tex.F_CONCRETE, wet: true },
  { x: 104, y: 560, name: 'юго-западная промывочная секция', owner: ZoneFaction.LIQUIDATOR, type: RoomType.PRODUCTION, wallTex: Tex.PIPE, floorTex: Tex.F_WATER, wet: true },
  { x: 292, y: 602, name: 'карантинная приёмная ликвидаторов', owner: ZoneFaction.LIQUIDATOR, type: RoomType.OFFICE, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE, wet: false },
  { x: 660, y: 602, name: 'холодная линия белых проб', owner: ZoneFaction.SCIENTIST, type: RoomType.MEDICAL, wallTex: Tex.HERMO_WALL, floorTex: Tex.F_TILE, wet: false },
  { x: 832, y: 582, name: 'закутки мокрой молитвы', owner: ZoneFaction.CULTIST, type: RoomType.COMMON, wallTex: Tex.BRICK, floorTex: Tex.F_WATER, wet: true },
  { x: 118, y: 802, name: 'нижний дренажный архив', owner: ZoneFaction.LIQUIDATOR, type: RoomType.STORAGE, wallTex: Tex.PIPE, floorTex: Tex.F_CONCRETE, wet: true },
  { x: 334, y: 826, name: 'кабинеты журнала утечек', owner: ZoneFaction.SCIENTIST, type: RoomType.OFFICE, wallTex: Tex.MARBLE, floorTex: Tex.F_PARQUET, wet: false },
  { x: 510, y: 830, name: 'нижняя клеточная галерея', owner: ZoneFaction.SCIENTIST, type: RoomType.PRODUCTION, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE, wet: true },
  { x: 690, y: 820, name: 'юго-восточный архив проб', owner: ZoneFaction.SCIENTIST, type: RoomType.STORAGE, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE, wet: false },
  { x: 842, y: 808, name: 'тёмный склад просроченных чашек', owner: ZoneFaction.CULTIST, type: RoomType.STORAGE, wallTex: Tex.BRICK, floorTex: Tex.F_WATER, wet: true },
];

const SLIME_NII_CABINET_STRIPS: readonly SlimeNiiCabinetStripSpec[] = [
  { x: 70, y: 220, cols: 10, rows: 4, name: 'северная линия микрокабинетов', owner: ZoneFaction.CITIZEN, wallTex: Tex.PANEL, floorTex: Tex.F_LINO, roomTypes: [RoomType.OFFICE, RoomType.STORAGE, RoomType.BATHROOM] },
  { x: 392, y: 210, cols: 11, rows: 4, name: 'сухие шкафы верхней галереи', owner: ZoneFaction.SCIENTIST, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE, roomTypes: [RoomType.MEDICAL, RoomType.STORAGE, RoomType.OFFICE] },
  { x: 682, y: 222, cols: 10, rows: 4, name: 'северный архив проб', owner: ZoneFaction.SCIENTIST, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE, roomTypes: [RoomType.STORAGE, RoomType.MEDICAL, RoomType.OFFICE] },
  { x: 74, y: 448, cols: 9, rows: 5, name: 'мокрые шкафы западного слива', owner: ZoneFaction.LIQUIDATOR, wallTex: Tex.PIPE, floorTex: Tex.F_WATER, roomTypes: [RoomType.STORAGE, RoomType.PRODUCTION, RoomType.BATHROOM] },
  { x: 718, y: 452, cols: 9, rows: 5, name: 'тёмные боксы восточного слива', owner: ZoneFaction.WILD, wallTex: Tex.BRICK, floorTex: Tex.F_CONCRETE, roomTypes: [RoomType.STORAGE, RoomType.SMOKING, RoomType.PRODUCTION] },
  { x: 94, y: 722, cols: 11, rows: 4, name: 'нижние шкафы дезраствора', owner: ZoneFaction.LIQUIDATOR, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE, roomTypes: [RoomType.STORAGE, RoomType.PRODUCTION, RoomType.BATHROOM] },
  { x: 384, y: 712, cols: 12, rows: 4, name: 'нижний ряд кабинетов НИИ', owner: ZoneFaction.SCIENTIST, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE, roomTypes: [RoomType.MEDICAL, RoomType.OFFICE, RoomType.STORAGE] },
  { x: 716, y: 704, cols: 10, rows: 4, name: 'культовые кладовые чашек', owner: ZoneFaction.CULTIST, wallTex: Tex.BRICK, floorTex: Tex.F_WATER, roomTypes: [RoomType.STORAGE, RoomType.COMMON, RoomType.SMOKING] },
];

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'slime_nii_director_larisa', NPC_DEFS.slime_nii_director_larisa, [
  {
    id: 'slime_nii_live_green_sample',
    giverNpcId: 'slime_nii_director_larisa',
    type: QuestType.FETCH,
    desc: 'Лариса Гладкая: «Принесите зелёную пробу из гермокамеры. Пломба важнее героизма: открытая банка уже спорит с протоколом.»',
    targetItem: 'slime_sample_green',
    targetCount: 1,
    rewardItem: 'official_quarantine_clearance',
    rewardCount: 1,
    extraRewards: [{ defId: 'nii_sample_container', count: 1 }, { defId: 'pills', count: 1 }],
    relationDelta: 14,
    xpReward: 130,
    moneyReward: 80,
    eventTags: [DESIGN_FLOOR_ID, 'slime', 'sample', 'science'],
    eventPrivacy: 'local',
    eventSeverity: 4,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'slime_nii_liquidator_voron', NPC_DEFS.slime_nii_liquidator_voron, [
  {
    id: 'slime_nii_black_camera_cleanup',
    giverNpcId: 'slime_nii_liquidator_voron',
    type: QuestType.KILL,
    desc: 'Ворон Чистый: «В чёрной камере шевелится ошибка. Откройте отсек, уберите её и не дайте учёным назвать это наблюдением.»',
    targetMonsterKind: MonsterKind.CHERNOSLIZ,
    killNeeded: 1,
    rewardItem: 'key',
    rewardCount: 1,
    extraRewards: [{ defId: 'sanitary_kit', count: 1 }, { defId: 'gasmask_filter', count: 1 }],
    relationDelta: 12,
    xpReward: 150,
    moneyReward: 95,
    eventTags: [DESIGN_FLOOR_ID, 'liquidator', 'containment', 'black_slime'],
    eventPrivacy: 'witnessed',
    eventSeverity: 4,
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'slime_nii_volunteer_mitya', NPC_DEFS.slime_nii_volunteer_mitya, [
  {
    id: 'slime_nii_volunteer_witness',
    giverNpcId: 'slime_nii_volunteer_mitya',
    type: QuestType.TALK,
    desc: 'Митя Испытуемый: «Поговорите с Ларисой. Пусть она скажет вслух, что я человек, а не тара с пульсом.»',
    targetPlotNpcId: 'slime_nii_director_larisa',
    rewardItem: 'clean_health_cert',
    rewardCount: 1,
    relationDelta: 18,
    xpReward: 80,
    moneyReward: 30,
    eventTags: [DESIGN_FLOOR_ID, 'volunteer', 'quarantine', 'witness'],
    eventPrivacy: 'local',
  },
]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, 'slime_nii_secretary_ada', NPC_DEFS.slime_nii_secretary_ada, [
  {
    id: 'slime_nii_manifest_choice',
    giverNpcId: 'slime_nii_secretary_ada',
    type: QuestType.FETCH,
    desc: 'Ада Журнальная: «Верните ведомость утечки НИИ из холодного шкафа. Я дам обходной талон, а рынок потеряет одну красивую ложь.»',
    targetItem: 'nii_contraband_manifest',
    targetCount: 1,
    rewardItem: 'fake_pass',
    rewardCount: 1,
    extraRewards: [{ defId: 'forged_quarantine_clearance', count: 1 }],
    relationDelta: 8,
    xpReward: 95,
    moneyReward: 70,
    eventTags: [DESIGN_FLOOR_ID, 'documents', 'contraband', 'black_market_88'],
    eventPrivacy: 'secret',
    eventSeverity: 3,
  },
]);

export function generateSlimeNiiDesignFloor(seed = SEED): FloorGeneration {
  return withSeededRandom(seed, () => {
    const world = new World();
    const entities: Entity[] = [];
    const nextId = { v: 1 };

    initWorld(world);
    const rooms = buildRooms(world);
    connectCore(world, rooms);
    decorateRooms(world, rooms);
    placeLifts(world, rooms);
    generateZones(world);
    tuneZones(world);
    placeSlimeNiiEmergencyPanels(world, rooms);

    const owners = spawnNpcs(entities, nextId, rooms);
    spawnAmbientNpcs(entities, nextId, rooms);
    placeContainers(world, rooms, owners);
    placeDrops(world, entities, nextId, rooms);
    spawnThreats(world, entities, nextId, rooms);
    stampSlimeReactionBands(world, [
      { x: rooms.drainWard.x + 18, y: rooms.drainWard.y + 28, radius: 78, weight: 1.25 },
      { x: rooms.cleanLab.x + 18, y: rooms.cleanLab.y + 32, radius: 54, weight: 0.52 },
      { x: rooms.cameras[1].x + 14, y: rooms.cameras[1].y + 11, radius: 58, weight: 1.1 },
      { x: rooms.cameras[3].x + 14, y: rooms.cameras[3].y + 11, radius: 66, weight: 1.0 },
      { x: rooms.cameras[5].x + 14, y: rooms.cameras[5].y + 11, radius: 58, weight: 0.9 },
    ], SEED ^ 0x51a1e);

    sanitizeDoors(world);
    ensureConnectivity(world, rooms.entry.x + 18.5, rooms.entry.y + 12.5);
    world.rebuildContainerMap();
    world.bakeLights();

    return {
      world,
      entities,
      spawnX: rooms.entry.x + 18.5,
      spawnY: rooms.entry.y + 12.5,
    };
  });
}

export function expandSlimeNiiRouteGeometry(world: World, rng: () => number): void {
  carveSlimeNiiMacroNetwork(world);
  buildSlimeNiiHqSuites(world);
  buildSlimeNiiResearchDistricts(world, rng);
  buildSlimeNiiCabinetStrips(world, rng);
  buildSlimeNiiOuterAnnexes(world, rng);

  stampSlimeReactionBands(world, [
    { x: 154, y: 162, radius: 96, weight: 0.86 },
    { x: 812, y: 156, radius: 94, weight: 0.84 },
    { x: 146, y: 814, radius: 100, weight: 0.92 },
    { x: 812, y: 818, radius: 102, weight: 0.9 },
    { x: 512, y: 142, radius: 76, weight: 0.72 },
    { x: 512, y: 858, radius: 78, weight: 0.76 },
    { x: 306, y: 526, radius: 132, weight: 0.62 },
    { x: 708, y: 536, radius: 138, weight: 0.64 },
  ], SEED ^ 0x7a551);

  world.markCellsDirty();
  world.markFloorTexDirty();
  world.markWallTexDirty();
  world.markFeaturesDirty(true);
}

function carveSlimeNiiMacroNetwork(world: World): void {
  const ring = [
    { x: 112, y: 168 },
    { x: 512, y: 108 },
    { x: 904, y: 172 },
    { x: 922, y: 512 },
    { x: 892, y: 852 },
    { x: 512, y: 908 },
    { x: 112, y: 846 },
    { x: 88, y: 512 },
    { x: 112, y: 168 },
  ] as const;
  carvePointRoute(world, ring, 7, Tex.F_TILE);
  carvePointRoute(world, [
    { x: 96, y: 512 },
    { x: 308, y: 512 },
    { x: CX, y: CY },
    { x: 716, y: 512 },
    { x: 928, y: 512 },
  ], 5, Tex.F_CONCRETE);
  carvePointRoute(world, [
    { x: 512, y: 104 },
    { x: 512, y: 306 },
    { x: CX, y: CY },
    { x: 512, y: 720 },
    { x: 512, y: 920 },
  ], 5, Tex.F_CONCRETE);
  carvePointRoute(world, [
    { x: 168, y: 168 },
    { x: 336, y: 330 },
    { x: CX, y: CY },
    { x: 692, y: 698 },
    { x: 854, y: 852 },
  ], 3, Tex.F_TILE);
  carvePointRoute(world, [
    { x: 852, y: 170 },
    { x: 686, y: 330 },
    { x: CX, y: CY },
    { x: 330, y: 694 },
    { x: 166, y: 848 },
  ], 3, Tex.F_TILE);
}

function buildSlimeNiiHqSuites(world: World): void {
  for (let i = 0; i < SLIME_NII_HQ_SPECS.length; i++) {
    const spec = SLIME_NII_HQ_SPECS[i];
    const hq = tryAddSlimeRoom(world, RoomType.HQ, spec.x, spec.y, 42, 26, spec.name, spec.wallTex, spec.floorTex, true);
    if (!hq) continue;
    paintRoomTerritory(world, hq, spec.owner);
    decorateHqCore(world, hq, i);
    connectRoomToPoint(world, hq, spec.x < CX ? 'east' : 'west', CX, CY, DoorState.HERMETIC_CLOSED);

    const kitchen = tryAddSlimeRoom(world, RoomType.KITCHEN, spec.x - 34, spec.y + 34, 28, 18, `Кухня ${spec.supportPrefix}`, spec.wallTex, Tex.F_LINO);
    const toilet = tryAddSlimeRoom(world, RoomType.BATHROOM, spec.x + 10, spec.y + 36, 22, 16, `Санузел ${spec.supportPrefix}`, Tex.TILE_W, Tex.F_TILE);
    const store = tryAddSlimeRoom(world, RoomType.STORAGE, spec.x + 48, spec.y + 2, 28, 22, `Склад ${spec.supportPrefix}`, spec.wallTex, Tex.F_CONCRETE);
    const office = tryAddSlimeRoom(world, spec.owner === ZoneFaction.SCIENTIST ? RoomType.MEDICAL : RoomType.OFFICE, spec.x - 40, spec.y + 2, 30, 22, `Рабочая комната ${spec.supportPrefix}`, spec.wallTex, spec.floorTex);
    const support = [kitchen, toilet, store, office];
    for (const room of support) {
      if (!room) continue;
      paintRoomTerritory(world, room, spec.owner);
      decorateSupportRoom(world, room, i);
      connectRooms(world, hq, room.x < hq.x ? 'west' : room.x > hq.x + hq.w ? 'east' : 'south', room, room.y > hq.y ? 'north' : 'east', DoorState.CLOSED);
    }
  }
}

function buildSlimeNiiResearchDistricts(world: World, rng: () => number): void {
  const anchors = [
    { x: 136, y: 148, name: 'северо-западный санитарный филиал', flip: false },
    { x: 770, y: 140, name: 'северо-восточный опытный филиал', flip: true },
    { x: 120, y: 796, name: 'юго-западная промывочная секция', flip: false },
    { x: 774, y: 804, name: 'юго-восточный архив проб', flip: true },
    { x: 478, y: 118, name: 'верхняя клеточная галерея', flip: false },
    { x: 482, y: 840, name: 'нижняя клеточная галерея', flip: true },
  ];

  for (let i = 0; i < SLIME_NII_DISTRICTS.length; i++) {
    const spec = SLIME_NII_DISTRICTS[i];
    const ox = Math.floor((rng() - 0.5) * 22);
    const oy = Math.floor((rng() - 0.5) * 18);
    const lab = tryAddSlimeRoom(
      world,
      spec.type,
      spec.x + ox,
      spec.y + oy,
      62 + (i % 3) * 8,
      34 + (i % 2) * 8,
      `НИИ слизи: ${spec.name}`,
      spec.wallTex,
      spec.floorTex,
    );
    if (!lab) continue;
    paintRoomTerritory(world, lab, spec.owner);
    decorateResearchLab(world, lab, i, spec.wet);
    connectRoomToPoint(world, lab, lab.x < CX ? 'east' : 'west', CX, CY, DoorState.CLOSED);

    const store = tryAddSlimeRoom(world, RoomType.STORAGE, lab.x + lab.w + 10, lab.y + 4, 26, 22, `Склад проб: ${spec.name}`, Tex.METAL, Tex.F_CONCRETE);
    const office = tryAddSlimeRoom(world, RoomType.OFFICE, lab.x - 36, lab.y + 4, 28, 20, `Кабинет наблюдения: ${spec.name}`, spec.wallTex, spec.floorTex);
    const wash = tryAddSlimeRoom(world, RoomType.BATHROOM, lab.x + 8, lab.y + lab.h + 10, 24, 16, `Мокрый шлюз: ${spec.name}`, Tex.TILE_W, Tex.F_WATER);
    const camera = tryAddSlimeRoom(world, RoomType.MEDICAL, lab.x + lab.w - 28, lab.y + lab.h + 10, 30, 20, `${SLIME_NII_CAMERA_ROOM_PREFIX}: ${spec.name}`, Tex.HERMO_WALL, Tex.F_TILE, true);
    for (const room of [store, office, wash, camera]) {
      if (!room) continue;
      paintRoomTerritory(world, room, spec.owner);
      if (room === camera) {
        shapeVoronoiSealedChamber(world, room, 40 + i);
        decorateCamera(world, room, 40 + i);
      } else {
        decorateSupportRoom(world, room, 10 + i);
      }
      connectRooms(world, lab, room.y > lab.y + lab.h ? 'south' : room.x < lab.x ? 'west' : 'east', room, room.y > lab.y + lab.h ? 'north' : room.x < lab.x ? 'east' : 'west', room === camera ? DoorState.HERMETIC_CLOSED : DoorState.CLOSED);
    }
    buildSlimeNiiMicroBlock(world, lab, spec.owner, `микрокабинет ${spec.name}`, 4 + (i % 3), 3 + (i % 2), i);
  }

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const ox = Math.floor((rng() - 0.5) * 34);
    const oy = Math.floor((rng() - 0.5) * 30);
    const lab = tryAddSlimeRoom(
      world,
      i % 2 === 0 ? RoomType.MEDICAL : RoomType.PRODUCTION,
      anchor.x + ox,
      anchor.y + oy,
      54,
      30,
      `НИИ слизи: ${anchor.name}`,
      Tex.TILE_W,
      Tex.F_TILE,
    );
    if (!lab) continue;
    paintRoomTerritory(world, lab, ZoneFaction.SCIENTIST);
    const store = tryAddSlimeRoom(
      world,
      RoomType.STORAGE,
      lab.x + (anchor.flip ? -40 : 62),
      lab.y + 3,
      28,
      24,
      `Шкаф проб: ${anchor.name}`,
      Tex.METAL,
      Tex.F_CONCRETE,
    );
    const camera = tryAddSlimeRoom(
      world,
      RoomType.MEDICAL,
      lab.x + (anchor.flip ? 62 : -42),
      lab.y + 2,
      30,
      24,
      `${SLIME_NII_CAMERA_ROOM_PREFIX}: внешний отсек ${i + 1}`,
      Tex.HERMO_WALL,
      Tex.F_TILE,
      true,
    );
    if (!store || !camera) continue;
    paintRoomTerritory(world, store, ZoneFaction.SCIENTIST);
    paintRoomTerritory(world, camera, ZoneFaction.SCIENTIST);
    shapeVoronoiSealedChamber(world, camera, i);

    connectRooms(world, lab, anchor.flip ? 'west' : 'east', store, anchor.flip ? 'east' : 'west', DoorState.CLOSED);
    connectRooms(world, lab, anchor.flip ? 'east' : 'west', camera, anchor.flip ? 'west' : 'east', DoorState.HERMETIC_CLOSED);
    carveLineWidth(world, lab.x + (lab.w >> 1), lab.y + (lab.h >> 1), CX, CY, 3, Tex.F_TILE);
    decorateLabAnnex(world, lab, store, camera, i);
  }
}

function buildSlimeNiiCabinetStrips(world: World, rng: () => number): void {
  for (let i = 0; i < SLIME_NII_CABINET_STRIPS.length; i++) {
    const spec = SLIME_NII_CABINET_STRIPS[i];
    let stripFirst: Room | null = null;
    let previousRowFirst: Room | null = null;
    for (let row = 0; row < spec.rows; row++) {
      let previous: Room | null = null;
      let rowFirst: Room | null = null;
      for (let col = 0; col < spec.cols; col++) {
        const serial = i * 100 + row * 17 + col;
        const w = 10 + (serial % 4);
        const h = 8 + ((serial + 2) % 4);
        const x = spec.x + col * 18 + Math.floor(rng() * 3);
        const y = spec.y + row * 15 + Math.floor(rng() * 3);
        const type = spec.roomTypes[serial % spec.roomTypes.length];
        const room = tryAddSlimeRoom(world, type, x, y, w, h, `${spec.name}: шкаф ${row + 1}-${col + 1}`, spec.wallTex, spec.floorTex);
        if (!room) continue;
        paintRoomTerritory(world, room, spec.owner);
        decorateMicroRoom(world, room, serial);
        if (!stripFirst) stripFirst = room;
        if (!rowFirst) rowFirst = room;
        if (previous) connectRoomsNarrow(world, previous, 'east', room, 'west', serial % 7 === 0 ? DoorState.CLOSED : DoorState.OPEN);
        previous = room;
      }
      if (rowFirst && previousRowFirst) connectRoomsNarrow(world, previousRowFirst, 'south', rowFirst, 'north', DoorState.CLOSED);
      previousRowFirst = rowFirst;
    }
    if (stripFirst) connectRoomToPoint(world, stripFirst, stripFirst.x < CX ? 'east' : 'west', CX, CY, DoorState.CLOSED);
  }
}

function buildSlimeNiiOuterAnnexes(world: World, rng: () => number): void {
  const annexes = [
    { x: 62, y: 88, cols: 6, rows: 4, owner: ZoneFaction.CITIZEN, name: 'краевой санпропускник' },
    { x: 860, y: 92, cols: 5, rows: 4, owner: ZoneFaction.WILD, name: 'краевой склад украденных проб' },
    { x: 64, y: 850, cols: 6, rows: 4, owner: ZoneFaction.LIQUIDATOR, name: 'нижний пост промывки' },
    { x: 852, y: 852, cols: 5, rows: 4, owner: ZoneFaction.CULTIST, name: 'нижний мокрый скит' },
  ] as const;
  for (let i = 0; i < annexes.length; i++) {
    const annex = annexes[i];
    const anchor = tryAddSlimeRoom(world, RoomType.PRODUCTION, annex.x, annex.y, 50, 28, `НИИ слизи: ${annex.name}`, Tex.PIPE, Tex.F_CONCRETE);
    if (!anchor) continue;
    paintRoomTerritory(world, anchor, annex.owner);
    decorateResearchLab(world, anchor, 80 + i, annex.owner !== ZoneFaction.CITIZEN);
    connectRoomToPoint(world, anchor, annex.x < CX ? 'east' : 'west', CX, CY, DoorState.CLOSED);
    for (let row = 0; row < annex.rows; row++) {
      let prev: Room | null = null;
      for (let col = 0; col < annex.cols; col++) {
        const serial = 500 + i * 64 + row * 9 + col;
        const room = tryAddSlimeRoom(
          world,
          col % 3 === 0 ? RoomType.STORAGE : col % 3 === 1 ? RoomType.OFFICE : RoomType.BATHROOM,
          annex.x + 64 + col * 17 + Math.floor(rng() * 3),
          annex.y + row * 15 + Math.floor(rng() * 3),
          11 + (serial % 3),
          8 + (serial % 4),
          `${annex.name}: малый отсек ${row + 1}-${col + 1}`,
          annex.owner === ZoneFaction.CULTIST ? Tex.BRICK : Tex.METAL,
          annex.owner === ZoneFaction.CULTIST ? Tex.F_WATER : Tex.F_CONCRETE,
        );
        if (!room) continue;
        paintRoomTerritory(world, room, annex.owner);
        decorateMicroRoom(world, room, serial);
        connectRoomsNarrow(world, prev ?? anchor, prev ? 'east' : 'east', room, 'west', DoorState.CLOSED);
        prev = room;
      }
    }
  }
}

function carvePointRoute(world: World, points: readonly { x: number; y: number }[], width: number, floorTex: Tex): void {
  for (let i = 1; i < points.length; i++) {
    carveLineWidth(world, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, width, floorTex);
  }
}

function buildSlimeNiiMicroBlock(
  world: World,
  lab: Room,
  owner: TerritoryOwner,
  name: string,
  cols: number,
  rows: number,
  seed: number,
): void {
  let previousRowFirst: Room | null = null;
  for (let row = 0; row < rows; row++) {
    let previous: Room | null = null;
    let rowFirst: Room | null = null;
    for (let col = 0; col < cols; col++) {
      const serial = seed * 64 + row * 11 + col;
      const room = tryAddSlimeRoom(
        world,
        col % 5 === 0 ? RoomType.BATHROOM : col % 4 === 0 ? RoomType.OFFICE : col % 3 === 0 ? RoomType.MEDICAL : RoomType.STORAGE,
        lab.x - 26 + col * 18,
        lab.y + lab.h + 34 + row * 15,
        10 + (serial % 5),
        8 + ((serial + 3) % 4),
        `${name}: ${row + 1}-${col + 1}`,
        col % 3 === 0 ? Tex.TILE_W : Tex.METAL,
        col % 3 === 0 ? Tex.F_TILE : Tex.F_CONCRETE,
      );
      if (!room) continue;
      paintRoomTerritory(world, room, owner);
      decorateMicroRoom(world, room, serial);
      if (!rowFirst) rowFirst = room;
      if (previous) connectRoomsNarrow(world, previous, 'east', room, 'west', serial % 6 === 0 ? DoorState.CLOSED : DoorState.OPEN);
      previous = room;
    }
    if (rowFirst) {
      connectRoomsNarrow(world, previousRowFirst ?? lab, 'south', rowFirst, 'north', DoorState.CLOSED);
      previousRowFirst = rowFirst;
    }
  }
}

function connectRoomsNarrow(world: World, a: Room, sideA: DoorSide, b: Room, sideB: DoorSide, state: DoorState, keyId = ''): void {
  const da = doorSite(a, sideA);
  const db = doorSite(b, sideB);
  const ai = addDoorAt(world, a, da.x, da.y, state, keyId);
  const bi = addDoorAt(world, b, db.x, db.y, state === DoorState.LOCKED ? DoorState.CLOSED : state, keyId);
  const ad = world.doors.get(ai);
  const bd = world.doors.get(bi);
  if (ad) ad.roomB = b.id;
  if (bd) bd.roomB = a.id;
  carveLineWidth(world, da.ox, da.oy, db.ox, db.oy, 1, a.floorTex);
}

function tryAddSlimeRoom(
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
): Room | null {
  const rx = Math.floor(x);
  const ry = Math.floor(y);
  if (!canStampSlimeRoom(world, rx, ry, w, h)) return null;
  return addRoom(world, type, rx, ry, w, h, name, wallTex, floorTex, sealed);
}

function canStampSlimeRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  if (x < 2 || y < 2 || x + w >= W - 2 || y + h >= W - 2) return false;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const idx = world.idx(x + dx, y + dy);
      if (world.aptMask[idx] || world.hermoWall[idx]) return false;
      if (world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.DOOR) return false;
      if (world.roomMap[idx] >= 0) return false;
    }
  }
  return true;
}

function paintRoomTerritory(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      world.factionControl[world.idx(room.x + dx, room.y + dy)] = owner;
    }
  }
}

function decorateHqCore(world: World, room: Room, serial: number): void {
  setFeature(world, room.x + 8, room.y + 8, Feature.DESK);
  setFeature(world, room.x + room.w - 9, room.y + 8, Feature.SHELF);
  setFeature(world, room.x + 10, room.y + room.h - 8, Feature.TABLE);
  setFeature(world, room.x + room.w - 10, room.y + room.h - 8, Feature.LAMP);
  markScreenWall(world, room.x + (room.w >> 1), room.y - 1, serial + 2);
}

function decorateResearchLab(world: World, room: Room, serial: number, wet: boolean): void {
  for (let y = room.y + 7; y < room.y + room.h - 5; y += 7) {
    for (let x = room.x + 8; x < room.x + room.w - 8; x += 16) {
      setFeature(world, x, y, Feature.APPARATUS);
      if (wet && ((x + y + serial) & 1) === 0) addWetCell(world, x + 2, y);
    }
  }
  if (room.type === RoomType.STORAGE) {
    for (let x = room.x + 7; x < room.x + room.w - 6; x += 12) setFeature(world, x, room.y + 8, Feature.SHELF);
  }
  setFeature(world, room.x + room.w - 8, room.y + room.h - 7, wet ? Feature.SINK : Feature.LAMP);
  markScreenWall(world, room.x + 10 + (serial % Math.max(1, room.w - 20)), room.y - 1, serial);
  if (wet) {
    stampSurfaceSplat(world, room.x + (room.w >> 1), room.y + (room.h >> 1), 0.5, 0.5, 7, 0.22, SEED ^ serial, 35, 145, 82, false);
  }
}

function decorateSupportRoom(world: World, room: Room, serial: number): void {
  switch (room.type) {
    case RoomType.KITCHEN:
      setFeature(world, room.x + 7, room.y + 7, Feature.STOVE);
      setFeature(world, room.x + room.w - 7, room.y + 7, Feature.SINK);
      setFeature(world, room.x + (room.w >> 1), room.y + room.h - 7, Feature.TABLE);
      break;
    case RoomType.BATHROOM:
      setFeature(world, room.x + 6, room.y + 6, Feature.TOILET);
      setFeature(world, room.x + room.w - 7, room.y + room.h - 7, Feature.SINK);
      break;
    case RoomType.STORAGE:
      for (let x = room.x + 6; x < room.x + room.w - 5; x += 9) setFeature(world, x, room.y + 6, Feature.SHELF);
      break;
    case RoomType.MEDICAL:
    case RoomType.PRODUCTION:
      setFeature(world, room.x + 7, room.y + 7, Feature.APPARATUS);
      setFeature(world, room.x + room.w - 7, room.y + room.h - 7, Feature.SINK);
      break;
    case RoomType.OFFICE:
    case RoomType.COMMON:
    default:
      setFeature(world, room.x + 7, room.y + 7, Feature.DESK);
      setFeature(world, room.x + room.w - 8, room.y + 7, Feature.SHELF);
      setFeature(world, room.x + (room.w >> 1), room.y + room.h - 7, Feature.CHAIR);
      break;
  }
  if (serial % 3 === 0) markScreenWall(world, room.x + (room.w >> 1), room.y - 1, serial);
}

function decorateMicroRoom(world: World, room: Room, serial: number): void {
  const primary = room.type === RoomType.BATHROOM ? Feature.SINK
    : room.type === RoomType.MEDICAL || room.type === RoomType.PRODUCTION ? Feature.APPARATUS
      : room.type === RoomType.OFFICE ? Feature.DESK
        : room.type === RoomType.COMMON || room.type === RoomType.SMOKING ? Feature.TABLE
          : Feature.SHELF;
  setFeature(world, room.x + Math.max(2, Math.min(room.w - 3, 3 + (serial % 4))), room.y + Math.max(2, Math.min(room.h - 3, 3 + (serial % 3))), primary);
  if (room.w > 9 && room.h > 7) {
    const secondary = primary === Feature.SHELF ? Feature.APPARATUS : Feature.SHELF;
    setFeature(world, room.x + room.w - 4, room.y + room.h - 4, secondary);
  }
  if (serial % 13 === 0) markScreenWall(world, room.x + (room.w >> 1), room.y - 1, serial);
}

function isSlimeNiiAmbientNpc(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    !entity.plotNpcId &&
    !entity.persistentNpcId &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    entity.faction !== undefined;
}

function slimeNiiTerritorySpawnCells(world: World): Map<TerritoryOwner, number[]> {
  const cells = new Map<TerritoryOwner, number[]>();
  for (const spec of SLIME_NII_HQ_SPECS) cells.set(spec.owner, []);
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

export function alignSlimeNiiAmbientNpcTerritory(world: World, entities: Entity[]): void {
  const cells = slimeNiiTerritorySpawnCells(world);
  const offsets = new Uint16Array(8);
  for (const entity of entities) {
    if (!isSlimeNiiAmbientNpc(entity) || entity.faction === undefined) continue;
    const owner = factionToTerritoryOwner(entity.faction);
    const list = cells.get(owner);
    if (!list || list.length === 0) continue;
    const offset = offsets[owner]++ | 0;
    const cell = list[(entity.id * 113 + offset * 431) % list.length];
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

function initWorld(world: World): void {
  for (let i = 0; i < W * W; i++) {
    world.wallTex[i] = Tex.PANEL;
    world.floorTex[i] = Tex.F_LINO;
    world.factionControl[i] = ZoneFaction.CITIZEN;
    world.fog[i] = 6;
  }
}

function buildRooms(world: World): SlimeNiiRooms {
  const entry = addRoom(world, RoomType.CORRIDOR, CX - 42, CY + 164, 84, 24, 'Верхний санитарный шлюз НИИ слизи', Tex.PIPE, Tex.F_CONCRETE);
  const atrium = addRoom(world, RoomType.COMMON, CX - 92, CY - 8, 184, 102, 'Главный зал НИИ слизи с сухим обходом', Tex.TILE_W, Tex.F_TILE);
  const checkpoint = addRoom(world, RoomType.HQ, CX - 126, CY + 114, 70, 38, 'Пост ликвидаторов у мокрой ведомости', Tex.METAL, Tex.F_CONCRETE);
  const admin = addRoom(world, RoomType.OFFICE, CX - 168, CY - 50, 76, 44, 'Кабинет директора протоколов слизи', Tex.MARBLE, Tex.F_PARQUET);
  const secretary = addRoom(world, RoomType.OFFICE, CX + 96, CY - 50, 72, 44, 'Журнальная комната Ады', Tex.MARBLE, Tex.F_PARQUET);
  const cleanLab = addRoom(world, RoomType.MEDICAL, CX + 106, CY + 20, 78, 52, 'Чистая лаборатория зелёной пробы', Tex.TILE_W, Tex.F_TILE);
  const coldStorage = addRoom(world, RoomType.STORAGE, CX + 102, CY + 102, 82, 46, 'Холодный шкаф проб НИИ', Tex.METAL, Tex.F_CONCRETE);
  const drainWard = addRoom(world, RoomType.PRODUCTION, CX - 184, CY + 28, 78, 58, 'Дренажная промывочная слизи', Tex.PIPE, Tex.F_WATER);
  const volunteerWard = addRoom(world, RoomType.MEDICAL, CX - 78, CY - 112, 156, 46, 'Палата добровольцев после подписи', Tex.TILE_W, Tex.F_TILE);
  const liquidatorPost = addRoom(world, RoomType.HQ, CX - 50, CY - 182, 100, 42, 'Караульная Ворона у чёрной камеры', Tex.METAL, Tex.F_CONCRETE);
  const lowerLift = addRoom(world, RoomType.CORRIDOR, CX - 34, CY - 238, 68, 24, 'Нижняя кабина к перекрёсткам', Tex.PIPE, Tex.F_CONCRETE);
  const bypass = addRoom(world, RoomType.CORRIDOR, CX - 212, CY - 118, 72, 30, 'Старый квартирный обход, занятый НИИ', Tex.BRICK, Tex.F_LINO);
  const cameras = buildCameraBanks(world);
  return { entry, atrium, checkpoint, admin, secretary, cleanLab, coldStorage, drainWard, volunteerWard, liquidatorPost, lowerLift, bypass, cameras };
}

function buildCameraBanks(world: World): Room[] {
  const cameras: Room[] = [];
  const ys = [CY - 38, CY, CY + 38, CY + 76];
  for (let i = 0; i < ys.length; i++) {
    cameras.push(addRoom(world, RoomType.MEDICAL, CX - 236, ys[i], 30, 22, `${SLIME_NII_CAMERA_ROOM_PREFIX}: запад ${i + 1}`, Tex.HERMO_WALL, Tex.F_TILE, true));
    cameras.push(addRoom(world, RoomType.MEDICAL, CX + 206, ys[i], 30, 22, `${SLIME_NII_CAMERA_ROOM_PREFIX}: восток ${i + 1}`, Tex.HERMO_WALL, Tex.F_TILE, true));
  }
  return cameras;
}

function connectCore(world: World, rooms: SlimeNiiRooms): void {
  connectRooms(world, rooms.entry, 'north', rooms.atrium, 'south', DoorState.CLOSED);
  connectRooms(world, rooms.atrium, 'north', rooms.volunteerWard, 'south', DoorState.CLOSED);
  connectRooms(world, rooms.volunteerWard, 'north', rooms.liquidatorPost, 'south', DoorState.CLOSED);
  connectRooms(world, rooms.liquidatorPost, 'north', rooms.lowerLift, 'south', DoorState.CLOSED);
  connectRooms(world, rooms.atrium, 'west', rooms.drainWard, 'east', DoorState.HERMETIC_CLOSED);
  connectRooms(world, rooms.atrium, 'east', rooms.cleanLab, 'west', DoorState.CLOSED);
  connectRooms(world, rooms.cleanLab, 'south', rooms.coldStorage, 'north', DoorState.LOCKED, 'key');
  connectRooms(world, rooms.atrium, 'west', rooms.admin, 'east', DoorState.CLOSED);
  connectRooms(world, rooms.atrium, 'east', rooms.secretary, 'west', DoorState.CLOSED);
  connectRooms(world, rooms.volunteerWard, 'west', rooms.bypass, 'east', DoorState.CLOSED);

  for (let i = 0; i < rooms.cameras.length; i++) {
    const camera = rooms.cameras[i];
    const west = camera.x < CX;
    const targetY = camera.y + (camera.h >> 1);
    const targetX = west ? rooms.drainWard.x + rooms.drainWard.w + 5 : rooms.cleanLab.x - 7;
    const state = i === 1 || i === 4 ? DoorState.LOCKED : i % 3 === 0 ? DoorState.HERMETIC_CLOSED : DoorState.CLOSED;
    connectRoomToPoint(world, camera, west ? 'east' : 'west', targetX, targetY, state, state === DoorState.LOCKED ? 'key' : '');
  }
}

function decorateRooms(world: World, rooms: SlimeNiiRooms): void {
  setFeature(world, rooms.entry.x + 28, rooms.entry.y + 9, Feature.LAMP);
  setFeature(world, rooms.entry.x + 42, rooms.entry.y + 13, Feature.LIFT_BUTTON);
  setFeature(world, rooms.checkpoint.x + 10, rooms.checkpoint.y + 13, Feature.DESK);
  setFeature(world, rooms.checkpoint.x + 26, rooms.checkpoint.y + 13, Feature.SHELF);
  markScreenWall(world, rooms.checkpoint.x + rooms.checkpoint.w - 10, rooms.checkpoint.y - 1, 2);

  setFeature(world, rooms.admin.x + 10, rooms.admin.y + 12, Feature.DESK);
  setFeature(world, rooms.admin.x + 28, rooms.admin.y + 14, Feature.CHAIR);
  setFeature(world, rooms.admin.x + rooms.admin.w - 9, rooms.admin.y + 12, Feature.SHELF);
  markScreenWall(world, rooms.admin.x + 18, rooms.admin.y - 1, 5);

  setFeature(world, rooms.secretary.x + 10, rooms.secretary.y + 12, Feature.DESK);
  setFeature(world, rooms.secretary.x + 30, rooms.secretary.y + 12, Feature.SHELF);
  markScreenWall(world, rooms.secretary.x + rooms.secretary.w - 16, rooms.secretary.y - 1, 1);

  for (let x = rooms.cleanLab.x + 10; x < rooms.cleanLab.x + rooms.cleanLab.w - 8; x += 14) {
    setFeature(world, x, rooms.cleanLab.y + 16, Feature.APPARATUS);
  }
  setFeature(world, rooms.cleanLab.x + rooms.cleanLab.w - 9, rooms.cleanLab.y + rooms.cleanLab.h - 10, Feature.SINK);
  setFeature(world, rooms.cleanLab.x + 9, rooms.cleanLab.y + 8, Feature.APPARATUS);

  for (let x = rooms.coldStorage.x + 8; x < rooms.coldStorage.x + rooms.coldStorage.w - 6; x += 13) {
    setFeature(world, x, rooms.coldStorage.y + 12, Feature.SHELF);
  }

  for (let y = rooms.drainWard.y + 8; y < rooms.drainWard.y + rooms.drainWard.h - 6; y += 7) {
    addWetCell(world, rooms.drainWard.x + 14, y);
    addWetCell(world, rooms.drainWard.x + 15, y);
    setFeature(world, rooms.drainWard.x + 26, y, Feature.APPARATUS);
  }
  stampSurfaceSplat(world, rooms.drainWard.x + 18, rooms.drainWard.y + 29, 0.5, 0.5, 8, 0.28, 12012, 32, 140, 74, false);

  for (let x = rooms.volunteerWard.x + 12; x < rooms.volunteerWard.x + rooms.volunteerWard.w - 10; x += 22) {
    setFeature(world, x, rooms.volunteerWard.y + 16, Feature.BED);
  }
  setFeature(world, rooms.liquidatorPost.x + 12, rooms.liquidatorPost.y + 13, Feature.DESK);
  setFeature(world, rooms.liquidatorPost.x + 34, rooms.liquidatorPost.y + 13, Feature.SHELF);
  setFeature(world, rooms.lowerLift.x + 20, rooms.lowerLift.y + 10, Feature.LAMP);
  setFeature(world, rooms.bypass.x + 14, rooms.bypass.y + 14, Feature.TABLE);

  for (let i = 0; i < rooms.cameras.length; i++) decorateCamera(world, rooms.cameras[i], i);
}

function placeSlimeNiiEmergencyPanels(world: World, rooms: SlimeNiiRooms): void {
  placeEmergencyPanel(world, rooms.checkpoint.x + 8, rooms.checkpoint.y + 8, 'panel_doors', SEED ^ 0xd00d);
  placeEmergencyPanel(world, rooms.drainWard.x + 10, rooms.drainWard.y + 9, 'panel_water', SEED ^ 0xaa77);
  placeEmergencyPanel(world, rooms.cleanLab.x + rooms.cleanLab.w - 12, rooms.cleanLab.y + 9, 'panel_vent', SEED ^ 0x71a6);
  placeEmergencyPanel(world, rooms.liquidatorPost.x + rooms.liquidatorPost.w - 10, rooms.liquidatorPost.y + 12, 'panel_power', SEED ^ 0x9911);
}

function decorateCamera(world: World, room: Room, serial: number): void {
  setFeature(world, room.x + 6, room.y + 6, serial % 2 === 0 ? Feature.APPARATUS : Feature.BED);
  setFeature(world, room.x + room.w - 7, room.y + room.h - 7, serial % 3 === 0 ? Feature.SINK : Feature.SHELF);
  const color = serial % 4;
  stampSurfaceSplat(world,
    room.x + (room.w >> 1),
    room.y + (room.h >> 1),
    0.5,
    0.5,
    4.5,
    0.3,
    12100 + serial * 17,
    color === 0 ? 22 : color === 1 ? 42 : 88,
    color === 2 ? 54 : 165,
    color === 3 ? 110 : 76,
    false,
  );
  markScreenWall(world, room.x + 8, room.y - 1, serial % 8);
}

function decorateLabAnnex(world: World, lab: Room, store: Room, camera: Room, serial: number): void {
  for (let x = lab.x + 8; x < lab.x + lab.w - 8; x += 13) setFeature(world, x, lab.y + 14, Feature.APPARATUS);
  setFeature(world, store.x + 8, store.y + 8, Feature.SHELF);
  setFeature(world, store.x + store.w - 7, store.y + store.h - 7, Feature.SHELF);
  stampDrainageCells(world, lab, serial);
  decorateCamera(world, camera, 20 + serial);
}

function stampDrainageCells(world: World, room: Room, serial: number): void {
  const baseX = room.x + 7 + (serial % 3) * 4;
  for (let y = room.y + 6; y < room.y + room.h - 5; y += 5) {
    addWetCell(world, baseX, y);
    if ((serial + y) % 2 === 0) addWetCell(world, baseX + 1, y);
  }
}

function placeLifts(world: World, rooms: SlimeNiiRooms): void {
  placeLift(world, rooms.entry.x + 9, rooms.entry.y + 12, rooms.entry.x + 15, rooms.entry.y + 12, LiftDirection.UP);
  placeLift(world, rooms.lowerLift.x + rooms.lowerLift.w - 9, rooms.lowerLift.y + 12, rooms.lowerLift.x + rooms.lowerLift.w - 15, rooms.lowerLift.y + 12, LiftDirection.DOWN);
}

function tuneZones(world: World): void {
  for (const zone of world.zones) {
    const d = world.dist(zone.cx, zone.cy, CX, CY);
    zone.faction = d < 220 ? ZoneFaction.LIQUIDATOR : zone.id % 5 === 0 ? ZoneFaction.WILD : ZoneFaction.CITIZEN;
    zone.level = d < 250 ? 4 : 3;
    zone.fogged = false;
    zone.hasLift = false;
  }
  for (let i = 0; i < W * W; i++) {
    world.factionControl[i] = world.zones[world.zoneMap[i]]?.faction ?? ZoneFaction.CITIZEN;
  }
}

function spawnNpcs(entities: Entity[], nextId: NextId, rooms: SlimeNiiRooms): Record<SlimeNiiNpcId, number> {
  return {
    slime_nii_director_larisa: spawnPlotNpc(entities, nextId, 'slime_nii_director_larisa', NPC_DEFS.slime_nii_director_larisa, rooms.admin.x + 18, rooms.admin.y + 20, 0),
    slime_nii_liquidator_voron: spawnPlotNpc(entities, nextId, 'slime_nii_liquidator_voron', NPC_DEFS.slime_nii_liquidator_voron, rooms.liquidatorPost.x + 22, rooms.liquidatorPost.y + 21, Math.PI / 2, 'makarov'),
    slime_nii_volunteer_mitya: spawnPlotNpc(entities, nextId, 'slime_nii_volunteer_mitya', NPC_DEFS.slime_nii_volunteer_mitya, rooms.cameras[0].x + 13, rooms.cameras[0].y + 11, 0),
    slime_nii_secretary_ada: spawnPlotNpc(entities, nextId, 'slime_nii_secretary_ada', NPC_DEFS.slime_nii_secretary_ada, rooms.secretary.x + 18, rooms.secretary.y + 20, Math.PI),
  };
}

function spawnAmbientNpcs(entities: Entity[], nextId: NextId, rooms: SlimeNiiRooms): void {
  spawnAmbientNpc(entities, nextId, 'Врач промывочной смены', Faction.SCIENTIST, Occupation.DOCTOR, rooms.cleanLab.x + 24, rooms.cleanLab.y + 24, [
    { defId: 'bandage', count: 2 },
    { defId: 'filter_layer', count: 1 },
  ]);
  spawnAmbientNpc(entities, nextId, 'Техник гермодверей НИИ', Faction.SCIENTIST, Occupation.ELECTRICIAN, rooms.drainWard.x + 48, rooms.drainWard.y + 20, [
    { defId: 'wire_coil', count: 1 },
    { defId: 'sealant_tube', count: 1 },
  ]);
  spawnAmbientNpc(entities, nextId, 'Секретарь санитарной очереди', Faction.CITIZEN, Occupation.SECRETARY, rooms.checkpoint.x + 44, rooms.checkpoint.y + 18, [
    { defId: 'official_quarantine_clearance', count: 1 },
  ]);
  spawnAmbientNpc(entities, nextId, 'Ликвидатор у нижней кабины', Faction.LIQUIDATOR, Occupation.HUNTER, rooms.lowerLift.x + 16, rooms.lowerLift.y + 12, [
    { defId: 'ammo_9mm', count: 10 },
  ], 'makarov');
}

function placeContainers(world: World, rooms: SlimeNiiRooms, owners: Record<SlimeNiiNpcId, number>): void {
  addContainer(world, rooms.cleanLab, rooms.cleanLab.x + 10, rooms.cleanLab.y + 8, ContainerKind.MEDICAL_CABINET, 'Лоток инокуляции перед гермокамерами', 'public', [
    { defId: 'anti_spore_inhaler', count: 1 },
    { defId: 'sterile_swab', count: 2 },
    { defId: 'decon_fluid', count: 1 },
  ], undefined, undefined, ['slime_nii', 'inoculation', 'medicine', 'sample']);

  addContainer(world, rooms.admin, rooms.admin.x + rooms.admin.w - 8, rooms.admin.y + 12, ContainerKind.FILING_CABINET, 'Картотека директора НИИ слизи', 'owner', [
    { defId: 'nii_sample_container', count: 2 },
    { defId: 'sterile_swab', count: 4 },
    { defId: 'post_samosbor_probe_kit', count: 1 },
    { defId: 'glass_ampoule_empty', count: 4 },
    { defId: 'syringe_empty', count: 6 },
    { defId: 'sample_chain_form', count: 2 },
    { defId: 'nii_sample_label', count: 3 },
    { defId: 'official_quarantine_clearance', count: 1 },
    { defId: 'blank_form', count: 2 },
  ], owners.slime_nii_director_larisa, NPC_DEFS.slime_nii_director_larisa.name, ['slime_nii', 'science', 'documents']);

  addContainer(world, rooms.liquidatorPost, rooms.liquidatorPost.x + rooms.liquidatorPost.w - 10, rooms.liquidatorPost.y + 14, ContainerKind.WEAPON_CRATE, 'Оружейный ящик карантинной охраны', 'faction', [
    { defId: 'ammo_9mm', count: 18 },
    { defId: 'ammo_12g_chemical', count: 1 },
    { defId: 'gasmask_filter', count: 1 },
    { defId: 'key', count: 1 },
  ], owners.slime_nii_liquidator_voron, NPC_DEFS.slime_nii_liquidator_voron.name, ['slime_nii', 'liquidator', 'containment', 'ammo', 'chemical']);

  addContainer(world, rooms.secretary, rooms.secretary.x + rooms.secretary.w - 8, rooms.secretary.y + 12, ContainerKind.FILING_CABINET, 'Журнал утечки проб НИИ', 'owner', [
    { defId: 'nii_market_receipt', count: 1 },
    { defId: 'fake_pass', count: 1 },
    { defId: 'forged_quarantine_clearance', count: 1 },
  ], owners.slime_nii_secretary_ada, NPC_DEFS.slime_nii_secretary_ada.name, ['slime_nii', 'documents', 'black_market_88']);

  addContainer(world, rooms.coldStorage, rooms.coldStorage.x + 12, rooms.coldStorage.y + 12, ContainerKind.MEDICAL_CABINET, 'Холодный шкаф зелёных и белых проб', 'locked', [
    { defId: 'slime_sample_green', count: 1 },
    { defId: 'slime_sample_white', count: 1 },
    { defId: 'gas_sample_ampoule', count: 1 },
    { defId: 'anti_spore_inhaler', count: 1 },
    { defId: 'experimental_concentrate', count: 1 },
    { defId: 'frozen_slime_core', count: 1 },
    { defId: 'boiled_slime_residue', count: 1 },
    { defId: 'slime_calcified_chip', count: 1 },
    { defId: 'slime_motor_node', count: 1 },
    { defId: 'slime_age_label_violet', count: 1 },
    { defId: 'nii_contraband_manifest', count: 1 },
  ], undefined, undefined, ['slime_nii', 'sample', 'cold_storage']);

  for (let i = 0; i < rooms.cameras.length; i++) {
    const room = rooms.cameras[i];
    const item = i % 5 === 0 ? 'slime_sample_green'
      : i % 5 === 1 ? 'slime_sample_black'
        : i % 5 === 2 ? 'slime_sample_red'
          : i % 5 === 3 ? 'slime_sample_contaminated'
            : 'nii_sample_container';
    const inventory = [
      { defId: item, count: 1 },
      { defId: 'filter_layer', count: 1 },
    ];
    if (item === 'slime_sample_contaminated') {
      inventory.push({ defId: 'contaminated_sample_act', count: 1 });
      inventory.push({ defId: 'contaminated_swab', count: 1 });
    }
    if (i === 3) inventory.push({ defId: 'slime_age_label_orange', count: 1 });
    addContainer(world, room, room.x + room.w - 6, room.y + 6, ContainerKind.MEDICAL_CABINET, `Контейнер камеры НИИ ${i + 1}`, 'locked', inventory, undefined, undefined, ['slime_nii', 'camera', 'sample']);
  }
}

function placeDrops(world: World, entities: Entity[], nextId: NextId, rooms: SlimeNiiRooms): void {
  dropItem(world, entities, nextId, rooms.entry.x + 30, rooms.entry.y + 14, 'gasmask_filter', 1);
  dropItem(world, entities, nextId, rooms.cleanLab.x + 12, rooms.cleanLab.y + 34, 'nii_sample_container', 1);
  dropItem(world, entities, nextId, rooms.cameras[2].x + 13, rooms.cameras[2].y + 11, 'slime_sample_green', 1);
  dropItem(world, entities, nextId, rooms.cameras[5].x + 13, rooms.cameras[5].y + 11, 'slime_sample_black', 1);
}

function spawnThreats(world: World, entities: Entity[], nextId: NextId, rooms: SlimeNiiRooms): void {
  spawnMonster(world, entities, nextId, MonsterKind.CHERNOSLIZ, rooms.cameras[1].x + 14, rooms.cameras[1].y + 11, 4, 'Чёрная проба за стеклом');
  spawnMonster(world, entities, nextId, MonsterKind.SLIME_WOMAN, rooms.cameras[3].x + 14, rooms.cameras[3].y + 11, 4, 'Жижевая женщина палаты');
  spawnMonster(world, entities, nextId, MonsterKind.HEAD_SLUG, rooms.cameras[4].x + 14, rooms.cameras[4].y + 11, 3, 'Головной слизень добровольца');
  spawnMonster(world, entities, nextId, MonsterKind.BEZEKHIY, rooms.cameras[6].x + 14, rooms.cameras[6].y + 11, 4, 'Безэхий у гермопорога');
  spawnMonster(world, entities, nextId, MonsterKind.SLIMEVIK, rooms.drainWard.x + 22, rooms.drainWard.y + 30, 3, 'Слизневик дренажной смены');
  spawnMonster(world, entities, nextId, MonsterKind.CHERNOSLIZ, rooms.coldStorage.x + rooms.coldStorage.w - 18, rooms.coldStorage.y + 25, 4, 'Чёрный остаток холодного шкафа');
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
      } else if (world.cells[ci] === Cell.WALL) {
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
  world.wallTex[idx] = state === DoorState.LOCKED || state === DoorState.HERMETIC_CLOSED ? Tex.DOOR_METAL : Tex.DOOR_WOOD;
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

function connectRooms(world: World, a: Room, sideA: DoorSide, b: Room, sideB: DoorSide, state: DoorState, keyId = ''): void {
  const da = doorSite(a, sideA);
  const db = doorSite(b, sideB);
  const ai = addDoorAt(world, a, da.x, da.y, state, keyId);
  const bi = addDoorAt(world, b, db.x, db.y, state === DoorState.LOCKED ? DoorState.CLOSED : state, keyId);
  const ad = world.doors.get(ai);
  const bd = world.doors.get(bi);
  if (ad) ad.roomB = b.id;
  if (bd) bd.roomB = a.id;
  carveLineWidth(world, da.ox, da.oy, db.ox, db.oy, 3, a.floorTex);
}

function connectRoomToPoint(world: World, room: Room, side: DoorSide, tx: number, ty: number, state: DoorState, keyId = ''): void {
  const d = doorSite(room, side);
  addDoorAt(world, room, d.x, d.y, state, keyId);
  carveLineWidth(world, d.ox, d.oy, tx, ty, 3, Tex.F_TILE);
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

interface ReactionSeed {
  x: number;
  y: number;
  radius: number;
  weight: number;
}

function stampSlimeReactionBands(world: World, seeds: readonly ReactionSeed[], salt: number): void {
  const u = new Float32Array(REACTION_CELLS);
  const v = new Float32Array(REACTION_CELLS);
  const nextU = new Float32Array(REACTION_CELLS);
  const nextV = new Float32Array(REACTION_CELLS);
  u.fill(1);

  for (const seed of seeds) seedReactionField(u, v, seed);
  for (let step = 0; step < REACTION_STEPS; step++) {
    for (let y = 0; y < REACTION_GRID; y++) {
      for (let x = 0; x < REACTION_GRID; x++) {
        const i = y * REACTION_GRID + x;
        const uvv = u[i] * v[i] * v[i];
        const feed = 0.034 + hash01(salt, x, y, 7) * 0.012;
        const kill = 0.058 + hash01(salt, x, y, 19) * 0.012;
        nextU[i] = clamp01(u[i] + 0.16 * laplace(u, x, y) - uvv + feed * (1 - u[i]));
        nextV[i] = clamp01(v[i] + 0.08 * laplace(v, x, y) + uvv - (feed + kill) * v[i]);
      }
    }
    u.set(nextU);
    v.set(nextV);
  }

  let changed = 0;
  for (let y = 0; y < REACTION_GRID; y++) {
    for (let x = 0; x < REACTION_GRID; x++) {
      const concentration = v[y * REACTION_GRID + x];
      if (concentration < 0.115 || concentration > 0.46) continue;
      const attempts = concentration > 0.24 ? 4 : 2;
      for (let n = 0; n < attempts; n++) {
        const wx = world.wrap(Math.floor(x * REACTION_CELL + hash01(salt, x, y, 101 + n) * REACTION_CELL));
        const wy = world.wrap(Math.floor(y * REACTION_CELL + hash01(salt, x, y, 301 + n) * REACTION_CELL));
        const idx = world.idx(wx, wy);
        if (!canWetSlimeCell(world, idx)) continue;
        world.cells[idx] = Cell.WATER;
        world.floorTex[idx] = Tex.F_WATER;
        if ((changed & 7) === 0) {
          stampSurfaceSplat(world, wx, wy, 0.5, 0.5, 1.25 + concentration * 6, 0.18, salt ^ idx, 38, 154, 82, false);
        }
        changed++;
        if (changed >= 1800) {
          world.markCellsDirty();
          world.markFloorTexDirty();
          return;
        }
      }
    }
  }
  if (changed > 0) {
    world.markCellsDirty();
    world.markFloorTexDirty();
  }
}

function seedReactionField(u: Float32Array, v: Float32Array, seed: ReactionSeed): void {
  const sx = Math.floor(worldToReaction(seed.x));
  const sy = Math.floor(worldToReaction(seed.y));
  const radius = Math.max(2, seed.radius / REACTION_CELL);
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = reactionWrap(sx + dx);
      const y = reactionWrap(sy + dy);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > radius) continue;
      const i = y * REACTION_GRID + x;
      const k = (1 - d / radius) * seed.weight;
      v[i] = Math.min(0.82, v[i] + k * 0.42);
      u[i] = Math.max(0.18, u[i] - k * 0.24);
    }
  }
}

function canWetSlimeCell(world: World, idx: number): boolean {
  if (world.cells[idx] !== Cell.FLOOR || world.hermoWall[idx]) return false;
  if (world.features[idx] !== Feature.NONE) return false;
  const roomId = world.roomMap[idx];
  const room = roomId >= 0 ? world.rooms[roomId] : undefined;
  if (!room) return true;
  if (room.name.includes('сух') || room.name.includes('Чистая') || room.name.includes('шлюз') || room.name.includes('кабина')) return false;
  return true;
}

function shapeVoronoiSealedChamber(world: World, room: Room, serial: number): void {
  const sites = [
    { x: 7 + (serial % 3), y: 6 },
    { x: room.w - 8, y: 7 + (serial % 4) },
    { x: room.w / 2, y: room.h - 7 },
  ];
  const centerX = room.x + (room.w >> 1);
  const centerY = room.y + (room.h >> 1);
  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      if (Math.abs(room.x + dx - centerX) <= 2 || Math.abs(room.y + dy - centerY) <= 2) continue;
      const nearest = nearestSiteIndex(dx, dy, sites);
      const ridge = Math.abs(siteDistance2(dx, dy, sites[nearest]) - siteDistance2(dx, dy, sites[(nearest + 1) % sites.length]));
      if (ridge > 42 && hash01(SEED ^ serial, dx, dy, 37) > 0.22) continue;
      const idx = world.idx(room.x + dx, room.y + dy);
      world.cells[idx] = Cell.WALL;
      world.wallTex[idx] = Tex.HERMO_WALL;
      world.floorTex[idx] = Tex.F_TILE;
      world.features[idx] = Feature.NONE;
    }
  }
}

function nearestSiteIndex(x: number, y: number, sites: readonly { x: number; y: number }[]): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < sites.length; i++) {
    const d = siteDistance2(x, y, sites[i]);
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

function siteDistance2(x: number, y: number, site: { x: number; y: number }): number {
  const dx = x - site.x;
  const dy = y - site.y;
  return dx * dx + dy * dy;
}

function laplace(values: Float32Array, x: number, y: number): number {
  const center = values[y * REACTION_GRID + x];
  return -center
    + (values[y * REACTION_GRID + reactionWrap(x - 1)] + values[y * REACTION_GRID + reactionWrap(x + 1)] + values[reactionWrap(y - 1) * REACTION_GRID + x] + values[reactionWrap(y + 1) * REACTION_GRID + x]) * 0.2
    + (values[reactionWrap(y - 1) * REACTION_GRID + reactionWrap(x - 1)] + values[reactionWrap(y - 1) * REACTION_GRID + reactionWrap(x + 1)] + values[reactionWrap(y + 1) * REACTION_GRID + reactionWrap(x - 1)] + values[reactionWrap(y + 1) * REACTION_GRID + reactionWrap(x + 1)]) * 0.05;
}

function worldToReaction(value: number): number {
  return (((value % W) + W) % W) / REACTION_CELL;
}

function reactionWrap(value: number): number {
  return ((value % REACTION_GRID) + REACTION_GRID) % REACTION_GRID;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
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

function addWetCell(world: World, x: number, y: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
  world.cells[ci] = Cell.WATER;
  world.floorTex[ci] = Tex.F_WATER;
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
  npcId: SlimeNiiNpcId,
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
    speed: faction === Faction.LIQUIDATOR ? 0.95 : 0.76 + Math.random() * 0.18,
    sprite: occupation,
    name,
    needs: freshNeeds(),
    hp: faction === Faction.LIQUIDATOR ? 150 : 90,
    maxHp: faction === Faction.LIQUIDATOR ? 150 : 90,
    money: 12 + Math.floor(Math.random() * 45),
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
  const hp = Math.round(def.hp * (0.86 + level * 0.16));
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
    floor: SLIME_NII_BASE_FLOOR,
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
