/* -- Design floor: Пионерлагерь ---------------------------------
 * A Soviet summer-camp pocket inside the concrete route. The floor
 * uses generic camp grammar, not copied Everlasting Summer names.
 */

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
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { setTerritoryOwnerAtIndex, syncZoneMetadataFromTerritory } from '../../systems/territory';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { ensureConnectivity, generateZones, sanitizeDoors, stampRoom } from '../shared';
import type { FloorGeneration } from '../floor_manifest';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('pioneer_camp');

export const PIONEER_CAMP_DESIGN_FLOOR_ID = 'pioneer_camp' as const;
export const PIONEER_CAMP_ROUTE_Z = 38;
export const PIONEER_CAMP_BASE_FLOOR = FloorLevel.LIVING;
export const PIONEER_CAMP_DISPLAY_NAME = 'Пионерлагерь';

const CAMP_SEED = hashSeed(PIONEER_CAMP_DESIGN_FLOOR_ID);
const CX = W >> 1;
const CY = W >> 1;
const CAMP_GATE_X = CX - 34;
const CAMP_GATE_Y = CY - 126;
const CAMP_GATE_W = 68;
const CAMP_GATE_H = 20;
const CAMP_SAFE_TRAIL_STEPS = 220;
const CAMP_BUFFER_TRAIL_STEPS = 340;

const NPC_IDS = {
  shift: 'camp_shift_tamara',
  radio: 'camp_radio_egor',
  medic: 'camp_medic_ira',
  cook: 'camp_canteen_zoya',
} as const;

type CampNpcId = (typeof NPC_IDS)[keyof typeof NPC_IDS];

interface CampRooms {
  square: Room;
  gate: Room;
  loudspeaker: Room;
  canteen: Room;
  infirmary: Room;
  library: Room;
  radioClub: Room;
  musicClub: Room;
  storage: Room;
  stage: Room;
  bathhouse: Room;
  boat: Room;
  sport: Room;
  oldCabin: Room;
}

interface CampClusterSpec {
  name: string;
  x: number;
  y: number;
  linkX: number;
  linkY: number;
  floorTex: Tex;
}

interface CampHqSite {
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

interface CampTerritoryTarget {
  owner: TerritoryOwner;
  share: number;
}

interface CampTerritorySeed {
  owner: TerritoryOwner;
  x: number;
  y: number;
  radius: number;
  weight: number;
}

const CAMP_OWNER_BUCKETS = 8;
const CAMP_TERRITORY_ITERATIONS = 8;

const CAMP_TERRITORY_TARGETS: readonly CampTerritoryTarget[] = [
  { owner: ZoneFaction.CITIZEN, share: 0.58 },
  { owner: ZoneFaction.LIQUIDATOR, share: 0.12 },
  { owner: ZoneFaction.CULTIST, share: 0.07 },
  { owner: ZoneFaction.SCIENTIST, share: 0.09 },
  { owner: ZoneFaction.WILD, share: 0.14 },
] as const;

const CAMP_CLUSTER_SPECS: readonly CampClusterSpec[] = [
  { name: 'Северо-западный парк бетонных берёз', x: 238, y: 236, linkX: 210, linkY: 210, floorTex: Tex.F_CONCRETE },
  { name: 'Северная линейка спальных бараков', x: 516, y: 178, linkX: 512, linkY: 132, floorTex: Tex.F_WOOD },
  { name: 'Северо-восточный двор зарядки', x: 778, y: 238, linkX: 800, linkY: 210, floorTex: Tex.F_CONCRETE },
  { name: 'Восточный парк неподвижных качелей', x: 842, y: 520, linkX: 864, linkY: 512, floorTex: Tex.F_CONCRETE },
  { name: 'Юго-восточная костровая поляна', x: 764, y: 784, linkX: 790, linkY: 790, floorTex: Tex.F_WOOD },
  { name: 'Южный двор тихого часа', x: 514, y: 850, linkX: 512, linkY: 888, floorTex: Tex.F_WOOD },
  { name: 'Юго-западный парк мокрых турников', x: 246, y: 800, linkX: 210, linkY: 756, floorTex: Tex.F_CONCRETE },
  { name: 'Западная площадка кружков', x: 154, y: 512, linkX: 160, linkY: 512, floorTex: Tex.F_WOOD },
] as const;

const CAMP_LANDSCAPE_COURTS: readonly { name: string; x: number; y: number; w: number; h: number; linkX: number; linkY: number; floorTex: Tex }[] = [
  { name: 'Большой парк бетонных берёз', x: 124, y: 148, w: 96, h: 72, linkX: 210, linkY: 210, floorTex: Tex.F_CONCRETE },
  { name: 'Двор утренней зарядки', x: 744, y: 132, w: 118, h: 78, linkX: 800, linkY: 210, floorTex: Tex.F_CONCRETE },
  { name: 'Поляна костровой сирены', x: 710, y: 624, w: 136, h: 86, linkX: 790, linkY: 790, floorTex: Tex.F_WOOD },
  { name: 'Парк мокрых качелей', x: 116, y: 690, w: 126, h: 88, linkX: 210, linkY: 756, floorTex: Tex.F_CONCRETE },
] as const;

const CAMP_HQ_SITES: readonly CampHqSite[] = [
  { owner: ZoneFaction.CITIZEN, x: 438, y: 616, w: 30, h: 18, name: 'Штаб гражданской смены', linkX: 512, linkY: 590, wallTex: Tex.PANEL, floorTex: Tex.F_WOOD },
  { owner: ZoneFaction.LIQUIDATOR, x: 804, y: 156, w: 28, h: 18, name: 'Пост ликвидаторов у ворот лагеря', linkX: 800, linkY: 210, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
  { owner: ZoneFaction.SCIENTIST, x: 644, y: 360, w: 28, h: 18, name: 'НИИ-штаб радиосмены', linkX: 602, linkY: 446, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
  { owner: ZoneFaction.WILD, x: 244, y: 326, w: 30, h: 18, name: 'Дикий штаб старшего отряда', linkX: 332, linkY: 375, wallTex: Tex.ROTTEN, floorTex: Tex.F_WOOD },
  { owner: ZoneFaction.CULTIST, x: 164, y: 744, w: 28, h: 18, name: 'Скрытый культовый штаб костра', linkX: 160, linkY: 756, wallTex: Tex.ROTTEN, floorTex: Tex.F_MEAT },
] as const;

const CAMP_TERRITORY_SEEDS: readonly CampTerritorySeed[] = [
  { owner: ZoneFaction.CITIZEN, x: CX, y: CY, radius: 330, weight: 2.8 },
  { owner: ZoneFaction.CITIZEN, x: 438, y: 625, radius: 210, weight: 1.35 },
  { owner: ZoneFaction.CITIZEN, x: 570, y: 552, radius: 180, weight: 1.2 },
  { owner: ZoneFaction.LIQUIDATOR, x: 818, y: 165, radius: 210, weight: 1.4 },
  { owner: ZoneFaction.LIQUIDATOR, x: CX, y: 132, radius: 150, weight: 0.95 },
  { owner: ZoneFaction.SCIENTIST, x: 658, y: 370, radius: 200, weight: 1.35 },
  { owner: ZoneFaction.SCIENTIST, x: 592, y: 458, radius: 150, weight: 0.95 },
  { owner: ZoneFaction.CULTIST, x: 178, y: 752, radius: 180, weight: 1.3 },
  { owner: ZoneFaction.CULTIST, x: 764, y: 784, radius: 150, weight: 0.65 },
  { owner: ZoneFaction.WILD, x: 252, y: 340, radius: 210, weight: 1.45 },
  { owner: ZoneFaction.WILD, x: CX, y: CY - 380, radius: 150, weight: 0.9 },
  { owner: ZoneFaction.WILD, x: CX - 352, y: CY, radius: 150, weight: 0.9 },
  { owner: ZoneFaction.WILD, x: CX + 352, y: CY, radius: 150, weight: 0.8 },
  { owner: ZoneFaction.WILD, x: CX, y: CY + 376, radius: 150, weight: 0.8 },
] as const;

const NPC_DEFS: Record<CampNpcId, PlotNpcDef> = {
  camp_shift_tamara: {
    name: 'Тамара Сменная',
    isFemale: true,
    faction: Faction.SCIENTIST,
    occupation: Occupation.DIRECTOR,
    sprite: Occupation.DIRECTOR,
    hp: 150, maxHp: 150, money: 70, speed: 0.82,
    inventory: [
      { defId: 'blank_form', count: 2 },
      { defId: 'emergency_roster', count: 1 },
      { defId: 'kompot', count: 1 },
    ],
    talkLines: [
      'Смена не заканчивается. По расписанию уже тридцать седьмой тихий час, а дети всё ещё числятся в строю.',
      'Площадь держит лагерь вместе. Если список укрытия врёт, линейка станет очередью в гермодверь.',
      'Не называйте это Совёнком. У нас другая птица, бетонная, и она не спит.',
    ],
    talkLinesPost: [
      'Список сверили. Теперь хотя бы понятно, кого нет, когда все стоят перед нами.',
      'Если услышите горн после сирены, идите не на звук, а к ближайшей двери.',
    ],
  },
  camp_radio_egor: {
    name: 'Егор Радиокружок',
    isFemale: false,
    faction: Faction.SCIENTIST,
    occupation: Occupation.ELECTRICIAN,
    sprite: Occupation.ELECTRICIAN,
    hp: 105, maxHp: 105, money: 44, speed: 0.9,
    inventory: [
      { defId: 'radio', count: 1 },
      { defId: 'wire_coil', count: 1 },
      { defId: 'circuit_board', count: 1 },
    ],
    talkLines: [
      'Радиорубка ловит не эфир, а соседние версии этого лагеря. Все говорят одно и то же с разной задержкой.',
      'Два мотка проволоки, и я заведу громкоговоритель. Можно предупредить столовую, а можно заманить то, что слушает.',
      'Песни лучше не ставить. Последний раз хор подпевал из старого корпуса.',
    ],
    talkLinesPost: [
      'Линия живая. Когда она щёлкает три раза, значит кто-то отвечает из леса.',
      'Громкоговоритель теперь наш. Пока он не решил наоборот.',
    ],
  },
  camp_medic_ira: {
    name: 'Ира Медпункт',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.DOCTOR,
    sprite: Occupation.DOCTOR,
    hp: 115, maxHp: 115, money: 38, speed: 0.88,
    inventory: [
      { defId: 'bandage', count: 2 },
      { defId: 'iodine', count: 1 },
      { defId: 'pills', count: 1 },
    ],
    talkLines: [
      'Ссадины обычные. Следы строем - нет. После отбоя сюда приходят те, кто должен был спать.',
      'Санитарный набор нужен не для героизма. Для выбора: лечить беглеца из леса или держать запас для линейки.',
      'В медпункте тихо, потому что стены здесь слушают пульс.',
    ],
    talkLinesPost: [
      'Перевязочный запас есть. Это не безопасность, но уже не голые руки.',
      'Если кто-то улыбается одинаково долго, ведите ко мне или сразу к Егору.',
    ],
  },
  camp_canteen_zoya: {
    name: 'Зоя Столовая',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.COOK,
    sprite: Occupation.COOK,
    hp: 125, maxHp: 125, money: 58, speed: 0.8,
    inventory: [
      { defId: 'kasha', count: 3 },
      { defId: 'kompot', count: 2 },
      { defId: 'knife', count: 1 },
    ],
    talkLines: [
      'Перловка держит строй лучше вожатых. Главное - не спрашивать, кто стоял в кастрюле до крупы.',
      'Сахар принеси. Сделаю компот для живых или сироп для тех, кто притворяется детьми.',
      'Из столовой проще всего украсть. Потом весь лагерь знает, кто ел слишком тихо.',
    ],
    talkLinesPost: [
      'Компот есть. Дежурные спорят, кому положен первый ковш.',
      'Если в каше что-то шевелится, не мешайте вообще. Зовите дежурного и отходите от котла.',
    ],
  },
};

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, NPC_IDS.shift, NPC_DEFS.camp_shift_tamara, [{
  id: 'camp_verify_roster',
  giverNpcId: NPC_IDS.shift,
  type: QuestType.FETCH,
  desc: 'Тамара Сменная: «Найди список укрытия у старого корпуса. Решим, кого прятать, а кого уже только числить.»',
  targetItem: 'emergency_roster',
  targetCount: 1,
  rewardItem: 'blank_form',
  rewardCount: 2,
  extraRewards: [{ defId: 'child_map', count: 1 }],
  relationDelta: 12,
  xpReward: 55,
  moneyReward: 35,
}]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, NPC_IDS.radio, NPC_DEFS.camp_radio_egor, [{
  id: 'camp_repair_loudspeaker',
  giverNpcId: NPC_IDS.radio,
  type: QuestType.FETCH,
  desc: 'Егор Радиокружок: «Два мотка проволоки - и громкоговоритель будет предупреждать лагерь, а не только повторять лес.»',
  targetItem: 'wire_coil',
  targetCount: 2,
  rewardItem: 'radio',
  rewardCount: 1,
  extraRewards: [{ defId: 'ammo_energy', count: 1 }],
  relationDelta: 10,
  xpReward: 60,
  moneyReward: 30,
}]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, NPC_IDS.medic, NPC_DEFS.camp_medic_ira, [{
  id: 'camp_medpost_choice',
  giverNpcId: NPC_IDS.medic,
  type: QuestType.FETCH,
  desc: 'Ира Медпункт: «Санитарный набор в медпункт. Потом выберем: перевязать беглеца из леса или оставить запас на сирену.»',
  targetItem: 'sanitary_kit',
  targetCount: 1,
  rewardItem: 'bandage',
  rewardCount: 3,
  extraRewards: [{ defId: 'pills', count: 1 }],
  relationDelta: 12,
  xpReward: 50,
  moneyReward: 28,
}]);

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, NPC_IDS.cook, NPC_DEFS.camp_canteen_zoya, [{
  id: 'camp_canteen_compote',
  giverNpcId: NPC_IDS.cook,
  type: QuestType.FETCH,
  desc: 'Зоя Столовая: «Принеси прессованный сахар. Сварю компот: можно накормить отряд, можно купить тишину у очереди.»',
  targetItem: 'pressed_sugar',
  targetCount: 2,
  rewardItem: 'kompot',
  rewardCount: 3,
  extraRewards: [{ defId: 'kasha', count: 2 }],
  relationDelta: 8,
  xpReward: 40,
  moneyReward: 24,
}]);

export function generatePioneerCampDesignFloor(seed = CAMP_SEED): FloorGeneration {
  return withSeededRandom(seed, () => {
    const world = new World();
    const entities: Entity[] = [];
    const nextId = { v: 1 };

    initCampWorld(world);
    const rooms = buildCampCore(world);
    buildCampPaths(world, rooms);
    decorateCampCore(world, rooms);
    placeCampLifts(world, rooms);

    generateZones(world);
    tuneCampZones(world);

    const owners = spawnCampNpcs(entities, nextId, rooms);
    placeCampContainers(world, rooms, owners);
    placeCampDrops(world, entities, nextId, rooms);
    spawnCampThreats(world, entities, nextId, rooms);

    sanitizeDoors(world);
    ensureConnectivity(world, rooms.gate.x + 8.5, rooms.gate.y + 8.5);
    world.rebuildContainerMap();
    world.bakeLights();

    return {
      world,
      entities,
      spawnX: rooms.gate.x + 8.5,
      spawnY: rooms.gate.y + 8.5,
    };
  });
}

export function expandPioneerCampFullFloor(world: World, rng: () => number): void {
  const mask = campProtectedMask(world);
  carveSafeTrailLoop(world, mask, 210, 210, 604, 604, 4, Tex.F_WOOD);
  carveSafeTrailLoop(world, mask, 112, 132, 800, 756, 2, Tex.F_CONCRETE);

  for (const [ax, ay, bx, by] of [
    [CX, CY - 36, 512, 132],
    [CX - 54, CY, 160, 512],
    [CX + 54, CY, 864, 512],
    [CX, CY + 58, 512, 888],
    [420, 468, 238, 238],
    [602, 552, 790, 790],
  ] as const) {
    carveSafeLine(world, mask, ax, ay, bx, by, 3, Tex.F_WOOD);
  }
  connectCampGateToNorthTrail(world, mask);

  const cabinSpecs = [
    [250, 258], [308, 238], [366, 260], [708, 252], [766, 286],
    [238, 704], [306, 754], [696, 716], [762, 748], [830, 704],
  ] as const;
  for (let i = 0; i < cabinSpecs.length; i++) {
    const [x, y] = cabinSpecs[i];
    const room = addCampRoom(world, RoomType.LIVING, x, y, 16, 11, `Спальный домик ${i + 1}`, Tex.PANEL, Tex.F_WOOD);
    const doorX = room.x + (room.w >> 1);
    const doorY = y < CY ? room.y + room.h : room.y - 1;
    addCampDoor(world, room, doorX, doorY, DoorState.CLOSED);
    carveSafeLine(world, mask, doorX, y < CY ? doorY + 1 : doorY - 1, CX, CY, 2, Tex.F_WOOD);
    setFeature(world, room.x + 3, room.y + 3, Feature.BED);
    setFeature(world, room.x + room.w - 4, room.y + 3, Feature.BED);
    setFeature(world, room.x + 7, room.y + room.h - 3, Feature.TABLE);
    if (i % 3 === 0) markPosterWall(world, room.x + 6, room.y - 1, 31 + i);
  }

  buildCampLandscapeCourts(world, mask, rng);
  buildCampMidMicroLayer(world, mask);
  buildCampFactionHqs(world, mask);
  scatterConcreteForestTrailPoints(world, mask, rng);

  for (let i = 0; i < 34; i++) {
    const x = 84 + Math.floor(rng() * 856);
    const y = 92 + Math.floor(rng() * 840);
    const ci = world.idx(x, y);
    if (mask[ci] || world.cells[ci] !== Cell.WALL) continue;
    world.wallTex[ci] = rng() < 0.6 ? Tex.ROTTEN : Tex.PANEL;
    if (rng() < 0.35) stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.8, 0.16, 4100 + i, 42, 88, 52, true);
  }

  for (let i = 0; i < 44; i++) {
    const x = 120 + Math.floor(rng() * 784);
    const y = 120 + Math.floor(rng() * 784);
    const ci = world.idx(x, y);
    if (mask[ci] || world.cells[ci] !== Cell.FLOOR || world.features[ci] !== Feature.NONE) continue;
    world.features[ci] = rng() < 0.72 ? Feature.LAMP : Feature.CANDLE;
  }
}

export function tunePioneerCampPopulationZones(world: World): void {
  const trailDistance = campTrailDistances(world, CX, CY);
  const zoneBestDistance = campZoneBestTrailDistances(world, trailDistance);
  paintPioneerCampTerritory(world, trailDistance);
  syncZoneMetadataFromTerritory(world);

  for (const zone of world.zones) {
    const centerD = world.dist(zone.cx, zone.cy, CX, CY);
    const oldCabinD = world.dist(zone.cx, zone.cy, CX - 197, CY - 137);
    const bathhouseD = world.dist(zone.cx, zone.cy, CX - 126, CY + 140);
    const boatD = world.dist(zone.cx, zone.cy, CX + 108, CY + 144);
    const trailD = zoneBestDistance[zone.id] ?? -1;
    const trailEdgeD = Math.min(
      world.dist(zone.cx, zone.cy, CX, CY - 380),
      world.dist(zone.cx, zone.cy, CX, CY + 376),
      world.dist(zone.cx, zone.cy, CX - 352, CY),
      world.dist(zone.cx, zone.cy, CX + 352, CY),
    );

    const owner = zone.faction;
    if (owner === ZoneFaction.CULTIST || oldCabinD < 150 || trailD < 0 || trailD > CAMP_BUFFER_TRAIL_STEPS || centerD > 430 || trailEdgeD < 110) zone.level = 4;
    else if (owner === ZoneFaction.WILD || owner === ZoneFaction.LIQUIDATOR || owner === ZoneFaction.SCIENTIST || trailD > CAMP_SAFE_TRAIL_STEPS || bathhouseD < 120 || boatD < 130 || centerD > 245) zone.level = 3;
    else zone.level = 2;
    zone.fogged = false;
    zone.hasLift = false;
  }

  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] !== Cell.LIFT) continue;
    const zone = world.zones[world.zoneMap[i]];
    if (zone) zone.hasLift = true;
  }
  ensureCampHqHermeticDoors(world);
  syncZoneMetadataFromTerritory(world);
}

function buildCampLandscapeCourts(world: World, mask: Uint8Array, rng: () => number): void {
  for (let i = 0; i < CAMP_LANDSCAPE_COURTS.length; i++) {
    const spec = CAMP_LANDSCAPE_COURTS[i];
    const court = addOpenArea(world, RoomType.COMMON, spec.x, spec.y, spec.w, spec.h, spec.name, spec.floorTex);
    decorateCampCourt(world, court, rng, i);
    carveSafeLine(world, mask, court.x + (court.w >> 1), court.y + (court.h >> 1), spec.linkX, spec.linkY, 3, spec.floorTex);
  }
}

function decorateCampCourt(world: World, room: Room, rng: () => number, serial: number): void {
  const featureCount = Math.max(14, Math.floor((room.w * room.h) / 360));
  for (let i = 0; i < featureCount; i++) {
    const x = room.x + 4 + Math.floor(rng() * Math.max(1, room.w - 8));
    const y = room.y + 4 + Math.floor(rng() * Math.max(1, room.h - 8));
    const roll = (i + serial) % 5;
    setFeature(world, x, y, roll === 0 ? Feature.SLIDE : roll === 1 ? Feature.LAMP : roll === 2 ? Feature.TABLE : roll === 3 ? Feature.CHAIR : Feature.CANDLE);
  }
  for (let x = room.x + 8; x < room.x + room.w - 8; x += 16) {
    setFeature(world, x, room.y + 6, Feature.LAMP);
    if ((x + serial) % 3 === 0) setFeature(world, x, room.y + room.h - 7, Feature.SLIDE);
  }
}

function buildCampMidMicroLayer(world: World, mask: Uint8Array): void {
  for (let ci = 0; ci < CAMP_CLUSTER_SPECS.length; ci++) {
    const cluster = CAMP_CLUSTER_SPECS[ci];
    const yard = addOpenArea(world, RoomType.COMMON, cluster.x - 24, cluster.y - 18, 48, 36, cluster.name, cluster.floorTex);
    decorateCampClusterYard(world, yard, ci);
    carveSafeLine(world, mask, cluster.x, cluster.y, cluster.linkX, cluster.linkY, 2, cluster.floorTex);
    const specs = campMicroRoomSpecs(ci);
    for (let ri = 0; ri < specs.length; ri++) {
      const spec = specs[ri];
      const room = addCampRoom(
        world,
        spec.type,
        cluster.x + spec.dx,
        cluster.y + spec.dy,
        spec.w,
        spec.h,
        `${cluster.name}: ${spec.name}`,
        spec.wallTex,
        spec.floorTex,
      );
      connectCampRoomToHub(world, room, cluster.x, cluster.y, DoorState.CLOSED, cluster.floorTex);
      decorateCampMicroRoom(world, room, ri + ci * 11);
    }
  }
}

function campMicroRoomSpecs(serial: number): readonly { type: RoomType; dx: number; dy: number; w: number; h: number; name: string; wallTex: Tex; floorTex: Tex }[] {
  const wet = serial % 2 === 0;
  return [
    { type: RoomType.LIVING, dx: -48, dy: -26, w: 16, h: 10, name: 'малая спальня', wallTex: Tex.PANEL, floorTex: Tex.F_WOOD },
    { type: RoomType.STORAGE, dx: 30, dy: -25, w: 13, h: 9, name: 'кладовая инвентаря', wallTex: Tex.BRICK, floorTex: Tex.F_CONCRETE },
    { type: RoomType.BATHROOM, dx: -48, dy: 14, w: 11, h: 9, name: 'умывальная будка', wallTex: Tex.TILE_W, floorTex: wet ? Tex.F_WATER : Tex.F_TILE },
    { type: RoomType.KITCHEN, dx: 31, dy: 13, w: 15, h: 10, name: 'чайная комната', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
    { type: RoomType.COMMON, dx: -12, dy: -43, w: 22, h: 9, name: 'комната совета отряда', wallTex: Tex.PANEL, floorTex: Tex.F_WOOD },
    { type: RoomType.STORAGE, dx: -10, dy: 35, w: 18, h: 9, name: 'шкафы формы', wallTex: Tex.ROTTEN, floorTex: Tex.F_WOOD },
  ] as const;
}

function decorateCampClusterYard(world: World, yard: Room, serial: number): void {
  for (let x = yard.x + 8; x < yard.x + yard.w - 7; x += 12) {
    setFeature(world, x, yard.y + 7, serial % 2 === 0 ? Feature.SLIDE : Feature.CHAIR);
    setFeature(world, x, yard.y + yard.h - 8, Feature.LAMP);
  }
  setFeature(world, yard.x + (yard.w >> 1), yard.y + (yard.h >> 1), serial % 3 === 0 ? Feature.APPARATUS : Feature.TABLE);
}

function decorateCampMicroRoom(world: World, room: Room, serial: number): void {
  switch (room.type) {
    case RoomType.LIVING:
      setFeature(world, room.x + 3, room.y + 3, Feature.BED);
      setFeature(world, room.x + room.w - 4, room.y + 3, Feature.BED);
      setFeature(world, room.x + 5, room.y + room.h - 3, Feature.TABLE);
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
      for (let y = room.y + 3; y < room.y + room.h - 2; y += 4) {
        setFeature(world, room.x + 3, y, Feature.SHELF);
        setFeature(world, room.x + room.w - 4, y, Feature.SHELF);
      }
      break;
    case RoomType.PRODUCTION:
      setFeature(world, room.x + 4, room.y + 4, Feature.MACHINE);
      setFeature(world, room.x + room.w - 5, room.y + 4, Feature.SCREEN);
      break;
    default:
      setFeature(world, room.x + 4, room.y + 4, Feature.TABLE);
      setFeature(world, room.x + room.w - 5, room.y + room.h - 4, serial % 2 === 0 ? Feature.CHAIR : Feature.CANDLE);
      break;
  }
}

function buildCampFactionHqs(world: World, mask: Uint8Array): void {
  for (const site of CAMP_HQ_SITES) {
    const core = addCampRoom(world, RoomType.HQ, site.x, site.y, site.w, site.h, site.name, site.wallTex, site.floorTex);
    core.sealed = true;
    markHermeticCampRoom(world, core);
    connectCampRoomToHub(world, core, site.linkX, site.linkY, DoorState.HERMETIC_OPEN, site.floorTex);
    decorateCampHqCore(world, core, site.owner);
    buildCampHqSupportRooms(world, site);
    carveSafeLine(world, mask, site.x + (site.w >> 1), site.y + (site.h >> 1), site.linkX, site.linkY, 2, site.floorTex);
  }
}

function ensureCampHqHermeticDoors(world: World): void {
  for (const site of CAMP_HQ_SITES) {
    const room = world.rooms.find(candidate => candidate.name === site.name);
    if (!room) continue;
    const hasHermeticDoor = room.doors.some(doorIdx => {
      const door = world.doors.get(doorIdx);
      return door?.state === DoorState.HERMETIC_OPEN || door?.state === DoorState.HERMETIC_CLOSED;
    });
    if (hasHermeticDoor) continue;
    connectCampRoomToHub(world, room, site.linkX, site.linkY, DoorState.HERMETIC_OPEN, site.floorTex);
  }
}

function decorateCampHqCore(world: World, room: Room, owner: TerritoryOwner): void {
  setFeature(world, room.x + 4, room.y + 4, owner === ZoneFaction.CULTIST ? Feature.CANDLE : Feature.DESK);
  setFeature(world, room.x + room.w - 5, room.y + 4, owner === ZoneFaction.SCIENTIST ? Feature.APPARATUS : Feature.SCREEN);
  setFeature(world, room.x + 5, room.y + room.h - 5, Feature.SHELF);
  setFeature(world, room.x + room.w - 6, room.y + room.h - 5, Feature.LAMP);
}

function buildCampHqSupportRooms(world: World, site: CampHqSite): void {
  const supports = campHqSupportSpecs(site.owner);
  const placements = [
    { dx: 2, dy: -15, w: 13, h: 9 },
    { dx: site.w + 8, dy: 2, w: 16, h: 10 },
    { dx: 2, dy: site.h + 8, w: 18, h: 10 },
    { dx: -21, dy: 2, w: 15, h: 10 },
  ] as const;
  const hubX = site.x + (site.w >> 1);
  const hubY = site.y + (site.h >> 1);
  for (let i = 0; i < supports.length; i++) {
    const support = supports[i];
    const place = placements[i];
    const room = addCampRoom(
      world,
      support.type,
      site.x + place.dx,
      site.y + place.dy,
      place.w,
      place.h,
      `${site.name}: ${support.name}`,
      support.wallTex,
      support.floorTex,
    );
    connectCampRoomToHub(world, room, hubX, hubY, DoorState.CLOSED, site.floorTex);
    decorateCampMicroRoom(world, room, i);
  }
}

function campHqSupportSpecs(owner: TerritoryOwner): readonly { type: RoomType; name: string; wallTex: Tex; floorTex: Tex }[] {
  switch (owner) {
    case ZoneFaction.LIQUIDATOR:
      return [
        { type: RoomType.OFFICE, name: 'дежурная', wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
        { type: RoomType.STORAGE, name: 'оружейная ниша', wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
        { type: RoomType.MEDICAL, name: 'перевязочная', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
        { type: RoomType.BATHROOM, name: 'санузел поста', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      ] as const;
    case ZoneFaction.SCIENTIST:
      return [
        { type: RoomType.PRODUCTION, name: 'лабораторный стол', wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
        { type: RoomType.MEDICAL, name: 'изолятор наблюдения', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
        { type: RoomType.STORAGE, name: 'шкаф приборов', wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
        { type: RoomType.OFFICE, name: 'журнал эфира', wallTex: Tex.PANEL, floorTex: Tex.F_WOOD },
      ] as const;
    case ZoneFaction.WILD:
      return [
        { type: RoomType.STORAGE, name: 'свалка трофеев', wallTex: Tex.ROTTEN, floorTex: Tex.F_WOOD },
        { type: RoomType.KITCHEN, name: 'коптилка', wallTex: Tex.ROTTEN, floorTex: Tex.F_CONCRETE },
        { type: RoomType.SMOKING, name: 'лежанки дозора', wallTex: Tex.ROTTEN, floorTex: Tex.F_WOOD },
        { type: RoomType.BATHROOM, name: 'ржавая вода', wallTex: Tex.TILE_W, floorTex: Tex.F_WATER },
      ] as const;
    case ZoneFaction.CULTIST:
      return [
        { type: RoomType.COMMON, name: 'круг шепота', wallTex: Tex.ROTTEN, floorTex: Tex.F_MEAT },
        { type: RoomType.STORAGE, name: 'кладовая масок', wallTex: Tex.ROTTEN, floorTex: Tex.F_WOOD },
        { type: RoomType.MEDICAL, name: 'тихая перевязка', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
        { type: RoomType.BATHROOM, name: 'умывальная золы', wallTex: Tex.TILE_W, floorTex: Tex.F_WATER },
      ] as const;
    case ZoneFaction.CITIZEN:
    default:
      return [
        { type: RoomType.KITCHEN, name: 'чайная штаба', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
        { type: RoomType.STORAGE, name: 'шкаф пайков', wallTex: Tex.BRICK, floorTex: Tex.F_CONCRETE },
        { type: RoomType.MEDICAL, name: 'медицинский угол', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
        { type: RoomType.BATHROOM, name: 'санузел смены', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      ] as const;
  }
}

function markHermeticCampRoom(world: World, room: Room): void {
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.cells[ci] !== Cell.WALL) continue;
      world.hermoWall[ci] = 1;
      world.wallTex[ci] = Tex.HERMO_WALL;
    }
  }
}

function paintPioneerCampTerritory(world: World, trailDistance: Int32Array): void {
  const ownerWeights = new Float64Array(CAMP_OWNER_BUCKETS);
  const counts = new Uint32Array(CAMP_OWNER_BUCKETS);
  ownerWeights.fill(1);
  for (const target of CAMP_TERRITORY_TARGETS) ownerWeights[target.owner] = Math.max(0.1, target.share);

  for (let pass = 0; pass < CAMP_TERRITORY_ITERATIONS; pass++) {
    counts.fill(0);
    for (let ci = 0; ci < W * W; ci++) counts[bestCampTerritoryOwner(world, ci, trailDistance, ownerWeights)]++;
    for (const target of CAMP_TERRITORY_TARGETS) {
      const desired = target.share * W * W;
      const actual = Math.max(1, counts[target.owner]);
      const adjust = Math.max(0.55, Math.min(1.45, Math.sqrt(desired / actual)));
      ownerWeights[target.owner] *= adjust;
    }
  }

  for (let ci = 0; ci < W * W; ci++) {
    setTerritoryOwnerAtIndex(world, ci, bestCampTerritoryOwner(world, ci, trailDistance, ownerWeights));
  }
  reinforceCampTerritoryAnchors(world);
}

function bestCampTerritoryOwner(
  world: World,
  cell: number,
  trailDistance: Int32Array,
  ownerWeights: Float64Array,
): TerritoryOwner {
  const x = cell % W;
  const y = (cell / W) | 0;
  const trailD = trailDistance[cell];
  const room = world.roomMap[cell] >= 0 ? world.rooms[world.roomMap[cell]] : undefined;
  let bestOwner: TerritoryOwner = ZoneFaction.CITIZEN;
  let bestScore = Infinity;
  for (const seed of CAMP_TERRITORY_SEEDS) {
    const ownerWeight = Math.max(0.05, ownerWeights[seed.owner] ?? 1);
    let score = world.dist2(x + 0.5, y + 0.5, seed.x, seed.y) / Math.max(1, seed.radius * seed.radius * seed.weight * ownerWeight);
    if (trailD >= 0) {
      if (seed.owner === ZoneFaction.CITIZEN && trailD <= CAMP_SAFE_TRAIL_STEPS) score *= 0.72;
      else if (seed.owner === ZoneFaction.LIQUIDATOR && trailD > CAMP_SAFE_TRAIL_STEPS && trailD <= CAMP_BUFFER_TRAIL_STEPS) score *= 0.74;
      else if (seed.owner === ZoneFaction.WILD && trailD > CAMP_BUFFER_TRAIL_STEPS) score *= 0.78;
    }
    if (world.cells[cell] === Cell.WATER) {
      if (seed.owner === ZoneFaction.WILD) score *= 0.72;
      if (seed.owner === ZoneFaction.CITIZEN) score *= 1.18;
    }
    if (room) {
      if (seed.owner === ZoneFaction.SCIENTIST && (room.type === RoomType.MEDICAL || room.type === RoomType.PRODUCTION)) score *= 0.78;
      if (seed.owner === ZoneFaction.CITIZEN && (room.type === RoomType.KITCHEN || room.type === RoomType.LIVING || room.type === RoomType.COMMON)) score *= 0.86;
      if (seed.owner === ZoneFaction.LIQUIDATOR && room.type === RoomType.HQ) score *= 0.92;
      if (seed.owner === ZoneFaction.WILD && room.type === RoomType.STORAGE) score *= 0.88;
      if (seed.owner === ZoneFaction.CULTIST && room.floorTex === Tex.F_MEAT) score *= 0.62;
    }
    if (score < bestScore) {
      bestScore = score;
      bestOwner = seed.owner;
    }
  }
  return bestOwner;
}

function reinforceCampTerritoryAnchors(world: World): void {
  for (const site of CAMP_HQ_SITES) {
    stampCampFaction(world, site.x + (site.w >> 1), site.y + (site.h >> 1), 32, site.owner);
    paintCampRoomRectangle(world, site.x, site.y, site.w, site.h, site.owner);
  }
  stampCampFaction(world, CX, CY, 62, ZoneFaction.CITIZEN);
  stampCampFaction(world, CX - 197, CY - 137, 46, ZoneFaction.WILD);
  stampCampFaction(world, 658, 370, 40, ZoneFaction.SCIENTIST);
  stampCampFaction(world, 818, 165, 42, ZoneFaction.LIQUIDATOR);
  stampCampFaction(world, 178, 752, 38, ZoneFaction.CULTIST);
}

function paintCampRoomRectangle(world: World, x: number, y: number, w: number, h: number, owner: TerritoryOwner): void {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      setTerritoryOwnerAtIndex(world, world.idx(x + dx, y + dy), owner);
    }
  }
}

function stampCampFaction(world: World, cx: number, cy: number, radius: number, faction: ZoneFaction): void {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      setTerritoryOwnerAtIndex(world, world.idx(cx + dx, cy + dy), faction);
    }
  }
}

function campTrailDistances(world: World, sx: number, sy: number): Int32Array {
  const distance = new Int32Array(W * W);
  distance.fill(-1);
  const seed = nearestCampWalkableCell(world, sx, sy, 18);
  if (seed < 0) return distance;

  const queue = new Int32Array(W * W);
  let head = 0;
  let tail = 0;
  distance[seed] = 0;
  queue[tail++] = seed;

  while (head < tail) {
    const ci = queue[head++];
    const nextDistance = distance[ci] + 1;
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
      const ni = world.idx(x + dx, y + dy);
      if (distance[ni] >= 0 || !isCampTrailWalkableCell(world, ni)) continue;
      distance[ni] = nextDistance;
      queue[tail++] = ni;
    }
  }

  return distance;
}

function nearestCampWalkableCell(world: World, x: number, y: number, radius: number): number {
  const sx = world.wrap(Math.floor(x));
  const sy = world.wrap(Math.floor(y));
  const start = world.idx(sx, sy);
  if (isCampTrailWalkableCell(world, start)) return start;

  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const ci = world.idx(sx + dx, sy + dy);
        if (isCampTrailWalkableCell(world, ci)) return ci;
      }
    }
  }
  return -1;
}

function isCampTrailWalkableCell(world: World, ci: number): boolean {
  const cell = world.cells[ci];
  return cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.LIFT;
}

function campZoneBestTrailDistances(world: World, trailDistance: Int32Array): Int32Array {
  const out = new Int32Array(world.zones.length);
  out.fill(-1);
  for (let ci = 0; ci < W * W; ci++) {
    const d = trailDistance[ci];
    if (d < 0) continue;
    const zoneId = world.zoneMap[ci];
    if (zoneId < 0 || zoneId >= out.length) continue;
    if (out[zoneId] < 0 || d < out[zoneId]) out[zoneId] = d;
  }
  return out;
}

function scatterConcreteForestTrailPoints(world: World, mask: Uint8Array, rng: () => number): void {
  const candidates: number[] = [];
  const minD2 = 26 * 26;
  for (let ci = 0; ci < W * W; ci++) {
    if (!isConcreteForestTrailCandidate(world, mask, ci)) continue;
    const x = ci % W;
    const y = (ci / W) | 0;
    const centerD2 = world.dist2(x + 0.5, y + 0.5, CX, CY);
    if (centerD2 < 180 * 180 || centerD2 > 470 * 470) continue;
    candidates.push(ci);
  }

  const accepted: number[] = [];
  for (let i = 0; i < candidates.length && accepted.length < 58; i++) {
    const j = i + Math.floor(rng() * (candidates.length - i));
    const picked = candidates[j];
    candidates[j] = candidates[i];
    candidates[i] = picked;
    const x = picked % W;
    const y = (picked / W) | 0;
    let spaced = true;
    for (const other of accepted) {
      if (world.dist2(x, y, other % W, (other / W) | 0) < minD2) {
        spaced = false;
        break;
      }
    }
    if (!spaced) continue;
    accepted.push(picked);
    world.features[picked] = Feature.SLIDE;
    if (rng() < 0.45) world.floorTex[picked] = Tex.F_CONCRETE;
    if (rng() < 0.5) stampSurfaceSplat(world, x, y, 0.5, 0.5, 1.2, 0.18, 5100 + accepted.length, 52, 74, 66, true);
  }
}

function isConcreteForestTrailCandidate(world: World, mask: Uint8Array, ci: number): boolean {
  return !mask[ci] &&
    world.cells[ci] === Cell.FLOOR &&
    world.roomMap[ci] < 0 &&
    world.features[ci] === Feature.NONE;
}

function initCampWorld(world: World): void {
  for (let i = 0; i < W * W; i++) {
    world.wallTex[i] = Tex.PANEL;
    world.floorTex[i] = Tex.F_CONCRETE;
    world.factionControl[i] = ZoneFaction.CITIZEN;
  }
}

function buildCampCore(world: World): CampRooms {
  const square = addOpenArea(world, RoomType.COMMON, CX - 45, CY - 34, 90, 68, 'Площадь обязательной линейки', Tex.F_CONCRETE);
  const gate = addCampRoom(world, RoomType.CORRIDOR, CAMP_GATE_X, CAMP_GATE_Y, CAMP_GATE_W, CAMP_GATE_H, 'Ворота и остановка лагеря', Tex.BRICK, Tex.F_CONCRETE);
  const loudspeaker = addOpenArea(world, RoomType.COMMON, CX - 14, CY - 74, 28, 14, 'Громкоговоритель строевого сбора', Tex.F_CONCRETE);
  const canteen = addCampRoom(world, RoomType.KITCHEN, CX + 58, CY + 40, 48, 26, 'Столовая на три бесконечных обеда', Tex.TILE_W, Tex.F_TILE);
  const infirmary = addCampRoom(world, RoomType.MEDICAL, CX - 92, CY + 42, 32, 22, 'Медпункт тихого часа', Tex.TILE_W, Tex.F_TILE);
  const library = addCampRoom(world, RoomType.COMMON, CX - 108, CY - 64, 42, 24, 'Библиотека обязательного чтения', Tex.PANEL, Tex.F_WOOD);
  const radioClub = addCampRoom(world, RoomType.PRODUCTION, CX + 62, CY - 66, 38, 24, 'Радиокружок с чужим эфиром', Tex.METAL, Tex.F_CONCRETE);
  const musicClub = addCampRoom(world, RoomType.COMMON, CX + 112, CY - 46, 32, 20, 'Музыкальный кружок без припева', Tex.PANEL, Tex.F_WOOD);
  const storage = addCampRoom(world, RoomType.STORAGE, CX + 126, CY + 16, 30, 20, 'Склад смены с чужими бирками', Tex.BRICK, Tex.F_CONCRETE);
  const stage = addOpenArea(world, RoomType.COMMON, CX - 30, CY + 56, 60, 22, 'Сцена вечерней линейки', Tex.F_WOOD);
  const bathhouse = addCampRoom(world, RoomType.BATHROOM, CX - 142, CY + 128, 34, 22, 'Умывальники и банный ряд', Tex.TILE_W, Tex.F_WATER);
  const boat = addCampRoom(world, RoomType.STORAGE, CX + 90, CY + 128, 38, 20, 'Лодочная станция у бетонной воды', Tex.ROTTEN, Tex.F_WOOD);
  const sport = addOpenArea(world, RoomType.COMMON, CX + 132, CY + 80, 58, 34, 'Спортплощадка под сеткой труб', Tex.F_CONCRETE);
  const oldCabin = addCampRoom(world, RoomType.STORAGE, CX - 214, CY - 148, 34, 22, 'Старый корпус за лесной тропой', Tex.ROTTEN, Tex.F_WOOD);
  return { square, gate, loudspeaker, canteen, infirmary, library, radioClub, musicClub, storage, stage, bathhouse, boat, sport, oldCabin };
}

function buildCampPaths(world: World, rooms: CampRooms): void {
  carveLineWidth(world, CX, CY - 34, CX, rooms.gate.y + rooms.gate.h + 1, 4, Tex.F_WOOD);
  carveLineWidth(world, CX - 45, CY, rooms.library.x + rooms.library.w + 1, CY - 52, 3, Tex.F_WOOD);
  carveLineWidth(world, CX + 45, CY, rooms.radioClub.x - 1, CY - 54, 3, Tex.F_WOOD);
  carveLineWidth(world, CX + 45, CY + 4, rooms.storage.x - 1, rooms.storage.y + 10, 3, Tex.F_WOOD);
  carveLineWidth(world, CX + 45, CY + 16, rooms.canteen.x - 1, rooms.canteen.y + 13, 4, Tex.F_WOOD);
  carveLineWidth(world, CX - 45, CY + 18, rooms.infirmary.x + rooms.infirmary.w + 1, rooms.infirmary.y + 12, 3, Tex.F_WOOD);
  carveLineWidth(world, CX, CY + 34, CX, rooms.stage.y - 1, 4, Tex.F_WOOD);
  carveLineWidth(world, rooms.stage.x + 30, rooms.stage.y + rooms.stage.h + 1, CX - 124, rooms.bathhouse.y + 11, 3, Tex.F_WOOD);
  carveLineWidth(world, rooms.stage.x + 32, rooms.stage.y + rooms.stage.h + 1, rooms.boat.x + 2, rooms.boat.y + 10, 3, Tex.F_WOOD);
  carveLineWidth(world, rooms.radioClub.x + rooms.radioClub.w + 1, rooms.radioClub.y + 10, rooms.musicClub.x - 1, rooms.musicClub.y + 10, 2, Tex.F_WOOD);
  carveLineWidth(world, rooms.library.x, rooms.library.y + 12, rooms.oldCabin.x + rooms.oldCabin.w + 1, rooms.oldCabin.y + 11, 2, Tex.F_WOOD);

  connectCampRoom(world, rooms.gate, rooms.gate.x + 34, rooms.gate.y + rooms.gate.h, rooms.gate.x + 34, rooms.gate.y + rooms.gate.h + 1);
  connectCampRoom(world, rooms.library, rooms.library.x + rooms.library.w, rooms.library.y + 12, rooms.library.x + rooms.library.w + 1, rooms.library.y + 12);
  connectCampRoom(world, rooms.radioClub, rooms.radioClub.x, rooms.radioClub.y + 12, rooms.radioClub.x - 1, rooms.radioClub.y + 12);
  connectCampRoom(world, rooms.musicClub, rooms.musicClub.x, rooms.musicClub.y + 10, rooms.musicClub.x - 1, rooms.musicClub.y + 10);
  connectCampRoom(world, rooms.storage, rooms.storage.x, rooms.storage.y + 10, rooms.storage.x - 1, rooms.storage.y + 10);
  connectCampRoom(world, rooms.canteen, rooms.canteen.x, rooms.canteen.y + 13, rooms.canteen.x - 1, rooms.canteen.y + 13);
  connectCampRoom(world, rooms.infirmary, rooms.infirmary.x + rooms.infirmary.w, rooms.infirmary.y + 12, rooms.infirmary.x + rooms.infirmary.w + 1, rooms.infirmary.y + 12);
  connectCampRoom(world, rooms.bathhouse, rooms.bathhouse.x + rooms.bathhouse.w, rooms.bathhouse.y + 11, rooms.bathhouse.x + rooms.bathhouse.w + 1, rooms.bathhouse.y + 11);
  connectCampRoom(world, rooms.boat, rooms.boat.x, rooms.boat.y + 10, rooms.boat.x - 1, rooms.boat.y + 10);
  connectCampRoom(world, rooms.oldCabin, rooms.oldCabin.x + rooms.oldCabin.w, rooms.oldCabin.y + 11, rooms.oldCabin.x + rooms.oldCabin.w + 1, rooms.oldCabin.y + 11, DoorState.LOCKED, 'child_map');

  carveBeachAndWater(world, rooms.boat);
}

function decorateCampCore(world: World, rooms: CampRooms): void {
  setFeature(world, CX, CY, Feature.APPARATUS);
  setFeature(world, CX - 2, CY, Feature.CANDLE);
  setFeature(world, CX + 2, CY, Feature.CANDLE);
  setFeature(world, rooms.loudspeaker.x + 8, rooms.loudspeaker.y + 5, Feature.APPARATUS);
  setFeature(world, rooms.loudspeaker.x + 13, rooms.loudspeaker.y + 5, Feature.SCREEN);
  setFeature(world, rooms.loudspeaker.x + 19, rooms.loudspeaker.y + 7, Feature.LAMP);
  for (let x = rooms.square.x + 10; x < rooms.square.x + rooms.square.w - 8; x += 14) {
    setFeature(world, x, rooms.square.y + 8, Feature.CHAIR);
    setFeature(world, x, rooms.square.y + rooms.square.h - 9, Feature.CHAIR);
  }
  for (let y = rooms.square.y + 12; y < rooms.square.y + rooms.square.h - 8; y += 12) {
    setFeature(world, rooms.square.x + 8, y, Feature.CHAIR);
    setFeature(world, rooms.square.x + rooms.square.w - 9, y, Feature.CHAIR);
  }

  markPosterWall(world, rooms.gate.x + 12, rooms.gate.y - 1, 7);
  markPosterWall(world, rooms.gate.x + 40, rooms.gate.y - 1, 13);
  markPosterWall(world, rooms.radioClub.x + 11, rooms.radioClub.y - 1, 19);
  markPosterWall(world, rooms.canteen.x + 10, rooms.canteen.y - 1, 27);

  setFeature(world, rooms.gate.x + 10, rooms.gate.y + 8, Feature.TABLE);
  setFeature(world, rooms.gate.x + 18, rooms.gate.y + 8, Feature.SCREEN);
  setFeature(world, rooms.gate.x + rooms.gate.w - 8, rooms.gate.y + 8, Feature.SHELF);

  for (let x = rooms.canteen.x + 4; x < rooms.canteen.x + rooms.canteen.w - 4; x += 8) setFeature(world, x, rooms.canteen.y + 4, Feature.STOVE);
  for (let x = rooms.canteen.x + 6; x < rooms.canteen.x + rooms.canteen.w - 6; x += 8) {
    setFeature(world, x, rooms.canteen.y + 13, Feature.TABLE);
    setFeature(world, x + 1, rooms.canteen.y + 16, Feature.CHAIR);
  }
  setFeature(world, rooms.canteen.x + rooms.canteen.w - 4, rooms.canteen.y + 5, Feature.SINK);

  setFeature(world, rooms.infirmary.x + 4, rooms.infirmary.y + 4, Feature.BED);
  setFeature(world, rooms.infirmary.x + 11, rooms.infirmary.y + 4, Feature.BED);
  setFeature(world, rooms.infirmary.x + rooms.infirmary.w - 5, rooms.infirmary.y + 4, Feature.SHELF);
  setFeature(world, rooms.infirmary.x + 4, rooms.infirmary.y + rooms.infirmary.h - 4, Feature.DESK);

  for (let x = rooms.library.x + 4; x < rooms.library.x + rooms.library.w - 4; x += 6) {
    setFeature(world, x, rooms.library.y + 3, Feature.SHELF);
    setFeature(world, x, rooms.library.y + rooms.library.h - 4, Feature.SHELF);
  }
  setFeature(world, rooms.library.x + 8, rooms.library.y + 11, Feature.TABLE);

  setFeature(world, rooms.radioClub.x + 5, rooms.radioClub.y + 5, Feature.SCREEN);
  setFeature(world, rooms.radioClub.x + 12, rooms.radioClub.y + 6, Feature.APPARATUS);
  setFeature(world, rooms.radioClub.x + 21, rooms.radioClub.y + 5, Feature.MACHINE);
  setFeature(world, rooms.radioClub.x + rooms.radioClub.w - 5, rooms.radioClub.y + rooms.radioClub.h - 4, Feature.SHELF);

  setFeature(world, rooms.musicClub.x + 4, rooms.musicClub.y + 5, Feature.TABLE);
  setFeature(world, rooms.musicClub.x + 10, rooms.musicClub.y + 5, Feature.CHAIR);
  setFeature(world, rooms.musicClub.x + 18, rooms.musicClub.y + 6, Feature.APPARATUS);

  for (let y = rooms.storage.y + 4; y < rooms.storage.y + rooms.storage.h - 3; y += 5) {
    setFeature(world, rooms.storage.x + 4, y, Feature.SHELF);
    setFeature(world, rooms.storage.x + rooms.storage.w - 5, y, Feature.SHELF);
  }
  setFeature(world, rooms.storage.x + 13, rooms.storage.y + 9, Feature.TABLE);

  for (let x = rooms.stage.x + 6; x < rooms.stage.x + rooms.stage.w - 5; x += 12) {
    setFeature(world, x, rooms.stage.y + 4, Feature.CANDLE);
    setFeature(world, x + 4, rooms.stage.y + 14, Feature.CHAIR);
  }

  for (let x = rooms.bathhouse.x + 4; x < rooms.bathhouse.x + rooms.bathhouse.w - 3; x += 5) {
    setFeature(world, x, rooms.bathhouse.y + 4, Feature.SINK);
  }
  setFeature(world, rooms.bathhouse.x + 6, rooms.bathhouse.y + rooms.bathhouse.h - 5, Feature.TOILET);
  setFeature(world, rooms.bathhouse.x + rooms.bathhouse.w - 7, rooms.bathhouse.y + rooms.bathhouse.h - 5, Feature.TOILET);

  setFeature(world, rooms.boat.x + 4, rooms.boat.y + 4, Feature.SHELF);
  setFeature(world, rooms.boat.x + 12, rooms.boat.y + 4, Feature.TABLE);
  setFeature(world, rooms.boat.x + 24, rooms.boat.y + 11, Feature.APPARATUS);

  for (let y = rooms.sport.y + 5; y < rooms.sport.y + rooms.sport.h - 4; y += 8) {
    setFeature(world, rooms.sport.x + 4, y, Feature.CHAIR);
    setFeature(world, rooms.sport.x + rooms.sport.w - 5, y, Feature.CHAIR);
  }
  carveLineWidth(world, rooms.sport.x + 12, rooms.sport.y + rooms.sport.h / 2 | 0, rooms.sport.x + rooms.sport.w - 12, rooms.sport.y + rooms.sport.h / 2 | 0, 1, Tex.F_CONCRETE);

  setFeature(world, rooms.oldCabin.x + 4, rooms.oldCabin.y + 4, Feature.BED);
  setFeature(world, rooms.oldCabin.x + 11, rooms.oldCabin.y + 8, Feature.SHELF);
  setFeature(world, rooms.oldCabin.x + rooms.oldCabin.w - 6, rooms.oldCabin.y + rooms.oldCabin.h - 5, Feature.CANDLE);
  stampSurfaceSplat(world, rooms.oldCabin.x + 18, rooms.oldCabin.y + 11, 0.5, 0.5, 3.2, 0.42, 7001, 55, 34, 62);
}

function placeCampLifts(world: World, rooms: CampRooms): void {
  placeLift(world, rooms.gate.x + 8, rooms.gate.y + 9, rooms.gate.x + 11, rooms.gate.y + 9, LiftDirection.UP);
  placeLift(world, rooms.boat.x + rooms.boat.w - 5, rooms.boat.y + rooms.boat.h - 5, rooms.boat.x + rooms.boat.w - 8, rooms.boat.y + rooms.boat.h - 5, LiftDirection.DOWN);
}

function tuneCampZones(world: World): void {
  tunePioneerCampPopulationZones(world);
}

function spawnCampNpcs(
  entities: Entity[],
  nextId: { v: number },
  rooms: CampRooms,
): Record<CampNpcId, number> {
  return {
    camp_shift_tamara: spawnPlotNpc(entities, nextId, NPC_IDS.shift, NPC_DEFS.camp_shift_tamara, rooms.square.x + 46, rooms.square.y + 36, 0),
    camp_radio_egor: spawnPlotNpc(entities, nextId, NPC_IDS.radio, NPC_DEFS.camp_radio_egor, rooms.radioClub.x + 15, rooms.radioClub.y + 12, Math.PI),
    camp_medic_ira: spawnPlotNpc(entities, nextId, NPC_IDS.medic, NPC_DEFS.camp_medic_ira, rooms.infirmary.x + 8, rooms.infirmary.y + 12, 0),
    camp_canteen_zoya: spawnPlotNpc(entities, nextId, NPC_IDS.cook, NPC_DEFS.camp_canteen_zoya, rooms.canteen.x + 12, rooms.canteen.y + 18, Math.PI / 2, 'knife'),
  };
}

function placeCampContainers(world: World, rooms: CampRooms, owners: Record<CampNpcId, number>): void {
  addCampContainer(world, rooms.canteen, rooms.canteen.x + rooms.canteen.w - 5, rooms.canteen.y + 6, ContainerKind.FRIDGE, 'Холодильник столовой с подписанным компотом', 'owner', [
    { defId: 'kompot', count: 3 },
    { defId: 'kasha', count: 3 },
    { defId: 'pressed_sugar', count: 2 },
  ], owners.camp_canteen_zoya, NPC_DEFS.camp_canteen_zoya.name, ['pioneer_camp', 'canteen', 'food']);

  addCampContainer(world, rooms.infirmary, rooms.infirmary.x + rooms.infirmary.w - 4, rooms.infirmary.y + rooms.infirmary.h - 5, ContainerKind.MEDICAL_CABINET, 'Аптечный шкаф тихого часа', 'owner', [
    { defId: 'sanitary_kit', count: 1 },
    { defId: 'iodine', count: 2 },
    { defId: 'bandage', count: 2 },
  ], owners.camp_medic_ira, NPC_DEFS.camp_medic_ira.name, ['pioneer_camp', 'medical']);

  addCampContainer(world, rooms.radioClub, rooms.radioClub.x + rooms.radioClub.w - 4, rooms.radioClub.y + 6, ContainerKind.TOOL_LOCKER, 'Ящик радиокружка с мотками', 'owner', [
    { defId: 'wire_coil', count: 2 },
    { defId: 'circuit_board', count: 1 },
    { defId: 'radio', count: 1 },
  ], owners.camp_radio_egor, NPC_DEFS.camp_radio_egor.name, ['pioneer_camp', 'radio', 'repair']);

  addCampContainer(world, rooms.storage, rooms.storage.x + rooms.storage.w - 5, rooms.storage.y + 10, ContainerKind.TOOL_LOCKER, 'Склад смены с проволокой и сахаром', 'room', [
    { defId: 'wire_coil', count: 1 },
    { defId: 'pressed_sugar', count: 1 },
    { defId: 'blank_form', count: 1 },
  ], undefined, undefined, ['pioneer_camp', 'storage', 'loudspeaker', 'canteen']);

  addCampContainer(world, rooms.library, rooms.library.x + rooms.library.w - 5, rooms.library.y + 5, ContainerKind.FILING_CABINET, 'Картотека отрядных дел', 'room', [
    { defId: 'book', count: 4 },
    { defId: 'blank_form', count: 2 },
    { defId: 'child_map', count: 1 },
  ], undefined, undefined, ['pioneer_camp', 'library', 'documents']);

  addCampContainer(world, rooms.oldCabin, rooms.oldCabin.x + rooms.oldCabin.w - 5, rooms.oldCabin.y + rooms.oldCabin.h - 5, ContainerKind.SECRET_STASH, 'Ржавый сейф старого корпуса', 'locked', [
    { defId: 'emergency_roster', count: 1 },
    { defId: 'siren_instruction', count: 1 },
    { defId: 'meat_rune', count: 1 },
  ], undefined, undefined, ['pioneer_camp', 'old_camp', 'samosbor']);
}

function placeCampDrops(world: World, entities: Entity[], nextId: { v: number }, rooms: CampRooms): void {
  dropItem(world, entities, nextId, rooms.square.x + 18, rooms.square.y + 20, 'child_map', 1);
  dropItem(world, entities, nextId, rooms.stage.x + 20, rooms.stage.y + 10, 'note', 1);
  dropItem(world, entities, nextId, rooms.bathhouse.x + 8, rooms.bathhouse.y + 12, 'toiletpaper', 1);
  dropItem(world, entities, nextId, rooms.boat.x + 9, rooms.boat.y + 13, 'metal_water', 1);
  dropItem(world, entities, nextId, rooms.oldCabin.x + 6, rooms.oldCabin.y + 14, 'emergency_roster', 1);
}

function spawnCampThreats(world: World, entities: Entity[], nextId: { v: number }, rooms: CampRooms): void {
  spawnMonster(world, entities, nextId, MonsterKind.NELYUD, rooms.oldCabin.x + 18, rooms.oldCabin.y + 10, 3);
  spawnMonster(world, entities, nextId, MonsterKind.SHADOW, rooms.oldCabin.x + 7, rooms.oldCabin.y + 6, 3);
  spawnMonster(world, entities, nextId, MonsterKind.EYE, rooms.radioClub.x + rooms.radioClub.w + 8, rooms.radioClub.y + 6, 2);
  spawnMonster(world, entities, nextId, MonsterKind.TUBE_EEL, CX + 112, CY + 188, 3);
}

function addCampRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
): Room {
  const room = stampRoom(world, world.rooms.length, type, Math.floor(x), Math.floor(y), w, h, -1);
  room.name = name;
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  retuneRoom(world, room, wallTex, floorTex);
  return room;
}

function addOpenArea(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  floorTex: Tex,
): Room {
  const room: Room = {
    id: world.rooms.length,
    type,
    x: world.wrap(x),
    y: world.wrap(y),
    w,
    h,
    doors: [],
    sealed: false,
    name,
    apartmentId: -1,
    wallTex: Tex.PANEL,
    floorTex,
  };
  world.rooms.push(room);
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) openTile(world, x + dx, y + dy, floorTex, room.id);
  }
  return room;
}

function retuneRoom(world: World, room: Room, wallTex: Tex, floorTex: Tex): void {
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) {
        world.floorTex[ci] = floorTex;
      } else if (world.cells[ci] === Cell.WALL) {
        world.wallTex[ci] = wallTex;
      }
    }
  }
}

function connectCampRoom(
  world: World,
  room: Room,
  doorX: number,
  doorY: number,
  pathX: number,
  pathY: number,
  state = DoorState.CLOSED,
  keyId = '',
): void {
  addCampDoor(world, room, doorX, doorY, state, keyId);
  carveLineWidth(world, pathX, pathY, pathX + world.delta(pathX, doorX), pathY + world.delta(pathY, doorY), 2, Tex.F_WOOD);
}

function connectCampRoomToHub(
  world: World,
  room: Room,
  hubX: number,
  hubY: number,
  state = DoorState.CLOSED,
  floorTex = Tex.F_WOOD,
): void {
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  let doorX: number;
  let doorY: number;
  let pathX: number;
  let pathY: number;
  if (Math.abs(hubX - cx) >= Math.abs(hubY - cy)) {
    if (hubX < cx) {
      doorX = room.x - 1;
      pathX = doorX - 1;
    } else {
      doorX = room.x + room.w;
      pathX = doorX + 1;
    }
    doorY = cy;
    pathY = doorY;
  } else {
    if (hubY < cy) {
      doorY = room.y - 1;
      pathY = doorY - 1;
    } else {
      doorY = room.y + room.h;
      pathY = doorY + 1;
    }
    doorX = cx;
    pathX = doorX;
  }
  addCampDoor(world, room, doorX, doorY, state);
  carveLineWidth(world, pathX, pathY, hubX, hubY, 1, floorTex);
}

function addCampDoor(world: World, room: Room, x: number, y: number, state: DoorState, keyId = ''): number {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.DOOR;
  if (state === DoorState.HERMETIC_OPEN || state === DoorState.HERMETIC_CLOSED) {
    world.wallTex[idx] = Tex.HERMO_WALL;
    world.hermoWall[idx] = 1;
  } else {
    world.wallTex[idx] = Tex.DOOR_WOOD;
  }
  world.doors.set(idx, {
    idx,
    state,
    roomA: room.id,
    roomB: -1,
    keyId,
    timer: 0,
  });
  room.doors.push(idx);
  return idx;
}

function carveBeachAndWater(world: World, boat: Room): void {
  addOpenArea(world, RoomType.COMMON, CX + 48, CY + 152, 128, 18, 'Бетонный пляж у резервуара', Tex.F_CONCRETE);
  for (let y = CY + 173; y < CY + 210; y++) {
    for (let x = CX + 42; x < CX + 188; x++) {
      const ci = world.idx(x, y);
      world.cells[ci] = Cell.WATER;
      world.roomMap[ci] = -1;
      world.floorTex[ci] = Tex.F_WATER;
      if ((x + y) % 17 === 0) world.features[ci] = Feature.NONE;
    }
  }
  carveLineWidth(world, boat.x + boat.w - 2, boat.y + 13, CX + 78, CY + 160, 2, Tex.F_WOOD);
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
  if (world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR) return;
  world.cells[ci] = Cell.FLOOR;
  world.roomMap[ci] = roomId;
  world.floorTex[ci] = floorTex;
  if (world.features[ci] !== Feature.NONE) world.features[ci] = Feature.NONE;
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER) world.features[ci] = feature;
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

function markPosterWall(world: World, x: number, y: number, n: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.WALL) world.wallTex[ci] = (Tex.POSTER_BASE + (n % 64)) as Tex;
}

function spawnPlotNpc(
  entities: Entity[],
  nextId: { v: number },
  npcId: CampNpcId,
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

function addCampContainer(
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
    floor: PIONEER_CAMP_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind,
    name,
    inventory: inventory.map(item => ({ ...item })),
    capacitySlots: Math.max(8, inventory.length + 4),
    ownerNpcId,
    ownerName,
    access,
    discovered: access !== 'secret',
    tags,
  };
  world.addContainer(container);
  setFeature(world, x, y, kind === ContainerKind.FRIDGE || kind === ContainerKind.MEDICAL_CABINET ? Feature.SHELF : Feature.SHELF);
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
  nextId: { v: number },
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

function spawnMonster(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  kind: MonsterKind,
  x: number,
  y: number,
  level: number,
): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) return;
  const def = MONSTERS[kind];
  if (!def) return;
  const hp = Math.round(def.hp * (1 + level * 0.18));
  const monster: Entity = {
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: def.speed * (1 + level * 0.04),
    sprite: monsterSpr(kind),
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    phasing: kind === MonsterKind.SHADOW,
  };
  entities.push(monster);
}

function campProtectedMask(world: World): Uint8Array {
  const mask = new Uint8Array(W * W);
  for (const room of world.rooms) {
    for (let y = room.y - 1; y <= room.y + room.h; y++) {
      for (let x = room.x - 1; x <= room.x + room.w; x++) mask[world.idx(x, y)] = 1;
    }
  }
  for (const idx of world.doors.keys()) mask[idx] = 1;
  for (const container of world.containers) mask[world.idx(container.x, container.y)] = 1;
  for (let i = 0; i < W * W; i++) if (world.cells[i] === Cell.LIFT) mask[i] = 1;
  return mask;
}

function carveSafeTrailLoop(world: World, mask: Uint8Array, x: number, y: number, w: number, h: number, width: number, floorTex: Tex): void {
  carveSafeLine(world, mask, x, y, x + w, y, width, floorTex);
  carveSafeLine(world, mask, x + w, y, x + w, y + h, width, floorTex);
  carveSafeLine(world, mask, x + w, y + h, x, y + h, width, floorTex);
  carveSafeLine(world, mask, x, y + h, x, y, width, floorTex);
}

function connectCampGateToNorthTrail(world: World, mask: Uint8Array): void {
  const gate = world.rooms.find(room =>
    room.x === CAMP_GATE_X &&
    room.y === CAMP_GATE_Y &&
    room.w === CAMP_GATE_W &&
    room.h === CAMP_GATE_H
  );
  if (!gate) return;
  const doorX = gate.x + (gate.w >> 1);
  const doorY = gate.y - 1;
  addCampDoor(world, gate, doorX, doorY, DoorState.CLOSED);
  carveSafeLine(world, mask, doorX, doorY - 1, doorX, CY - 380, 3, Tex.F_WOOD);
}

function carveSafeLine(world: World, mask: Uint8Array, ax: number, ay: number, bx: number, by: number, width: number, floorTex: Tex): void {
  if (ax !== bx && ay !== by) {
    carveSafeLine(world, mask, ax, ay, bx, ay, width, floorTex);
    carveSafeLine(world, mask, bx, ay, bx, by, width, floorTex);
    return;
  }
  const half = width >> 1;
  const from = ax === bx ? Math.min(ay, by) : Math.min(ax, bx);
  const to = ax === bx ? Math.max(ay, by) : Math.max(ax, bx);
  for (let p = from; p <= to; p++) {
    for (let n = 0; n < width; n++) {
      const o = n - half;
      const x = ax === bx ? ax + o : p;
      const y = ax === bx ? p : ay + o;
      const ci = world.idx(x, y);
      if (mask[ci] || world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR) continue;
      world.cells[ci] = Cell.FLOOR;
      world.roomMap[ci] = -1;
      world.floorTex[ci] = floorTex;
      world.factionControl[ci] = ZoneFaction.CITIZEN;
      if (world.features[ci] !== Feature.NONE) world.features[ci] = Feature.NONE;
    }
  }
}
