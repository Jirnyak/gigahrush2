import {
  AIGoal,
  Cell,
  DoorState,
  EntityType,
  Feature,
  FloorLevel,
  MonsterKind,
  RoomType,
  Tex,
  W,
  ZoneFaction,
  type Entity,
  type Room,
  type TerritoryOwner,
  type Zone,
} from '../../core/types';
import { World } from '../../core/world';
import { hashSeed, seededRandom } from '../../core/rand';
import type { DesignFloorId, DesignFloorRouteDef } from '../../data/design_floors';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import { ensureConnectivity, generateZones, sanitizeDoors } from '../shared';
import type { FloorGeneration } from '../floor_manifest';
import { blackoutDarknessLights, expandDarknessRouteGeometry, reinforceDarknessAuthoredHqTerritory } from './darkness';
import { applyFloor69AmbientSpriteTemplates, applyFloor69OwnershipVisibilityHeatmap, expandFloor69FullFloor } from './floor_69';
import { expandManhattanCrossroadsRouteShell, reinforceManhattanCrossroadsAuthoredHqTerritory } from './manhattan_crossroads';
import { expandServiceFloorMachineMaze, placeServiceFloorEmergencyPanels, reinforceServiceFloorAuthoredHqTerritory } from './service_floor';
import { alignNumberRegistryAmbientNpcTerritory, expandNumberRegistryGeometry, retuneNumberRegistryZones } from './number_registry';
import { expandChthonicAtticRootNetwork, retuneExpandedChthonicAtticEcology } from './chthonic_attic';
import { expandUpperBureauGeometry, retuneUpperBureauZones } from './upper_bureau';
import { expandAntennaCourtRouteGeometry, retuneAntennaCourtRouteZones } from './antenna_court';
import { expandAttractorDvorRouteGeometry, placeAttractorDvorEmergencyPanels, tuneAttractorDvorRouteZones } from './attractor_dvor';
import { applyBankFloorTerritorySeeds, expandBankFloorRouteGeometry } from './bank_floor';
import { expandBolnichnyKorpusRouteGeometry, reinforceBolnichnyKorpusGates, tuneBolnichnyKorpusRouteZones } from './bolnichny_korpus';
import { CANTOR_PUSTOTY_ROOM_NAMES } from './cantor_pustoty';
import { retuneCayleyByuroTerritory } from './cayley_byuro';
import { HYPERBOLIC_SWITCHYARD_ROOM_NAMES, reinforceHyperbolicSwitchyardAuthoredHqTerritory } from './hyperbolic_switchyard';
import { MOEBIUS_PODEZD_ROOM_NAMES, expandMoebiusPodezdRouteGeometry, reinforceMoebiusPodezdAuthoredTerritory } from './moebius_podezd';
import { applyRoofLosShelterPockets, expandRoofArchipelago, retuneRoofPressureZones } from './roof';
import { expandBlackMarket88Bazaar } from './black_market_88';
import { expandDarkMetroFullFloorGeometry, reinforceDarkMetroAuthoredHqTerritory, tuneDarkMetroRouteZone } from './dark_metro';
import { expandHarmonicBathhouseRouteGeometry } from './harmonic_bathhouse';
import { applyHilbertDepotTerritorySeeds, expandHilbertDepotRouteGeometry } from './hilbert_depot';
import { expandOranzhereyaBetonaRouteGeometry, reinforceOranzhereyaBetonaAuthoredTerritory } from './oranzhereya_betona';
import { expandPioneerCampFullFloor, tunePioneerCampPopulationZones } from './pioneer_camp';
import { expandProductionBeltGeometry } from './production_belt';
import { applyRadonExchangeTerritory } from './radon_exchange';
import { expandRaionsovetArchiveGeometry, reinforceRaionsovetArchiveAuthoredHqTerritory } from './raionsovet_archive';
import { expandRegistryMorgueGeometry, reinforceRegistryMorgueAuthoredTerritory } from './registry_morgue';
import { expandSiliconNetWellRouteGeometry, tuneSiliconNetWellRouteZones } from './silicon_net_well';
import { expandSlimeNiiRouteGeometry } from './slime_nii';
import { expandSpetspriemnikRouteGeometry, reinforceSpetspriemnikRouteGates, tuneSpetspriemnikRouteZones } from './spetspriemnik';
import { expandTuringNurseryRouteGeometry, reinforceTuringNurseryAuthoredHqTerritory } from './turing_nursery';
import { tuneVoronoiQuarantineRouteZones } from './voronoi_quarantine';
import { reinforceIstinniyLabirintTerritorySeeds } from './istinniy_labirint';
import { expandPodadRouteGeometry } from './podad';
import { ensureRouteWideFootprint } from './route_shell';
import { applyDesignFloorPopulationField } from './population';

interface FloorStyle {
  wallTex: Tex;
  floorTex: Tex;
  faction: ZoneFaction;
  danger: number;
}

interface Point {
  x: number;
  y: number;
}

type CommunalSide = 'north' | 'south' | 'west' | 'east';

interface CommunalServiceLoopSpec {
  name: string;
  type: RoomType;
  left: number;
  top: number;
  right: number;
  bottom: number;
  floorTex: Tex;
  wallTex: Tex;
  faction: ZoneFaction;
  level: number;
}

type CommunalRoomDoorSide = 'north' | 'south' | 'west' | 'east';

interface CommunalMicroRoomSpec {
  type: RoomType;
  x: number;
  y: number;
  w: number;
  h: number;
  doorSide: CommunalRoomDoorSide;
  targetX: number;
  targetY: number;
}

interface CommunalHqRoomSpec {
  type: RoomType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  doorSide: CommunalRoomDoorSide;
  targetX: number;
  targetY: number;
}

interface CommunalHqCompoundSpec {
  owner: TerritoryOwner;
  hall: readonly [number, number, number, number];
  rooms: readonly CommunalHqRoomSpec[];
}

const COMMUNAL_SERVICE_LOOPS: readonly CommunalServiceLoopSpec[] = [
  { name: 'Петля кухонного кипятка', type: RoomType.KITCHEN, left: 426, top: 424, right: 596, bottom: 480, floorTex: Tex.F_TILE, wallTex: Tex.TILE_W, faction: ZoneFaction.CITIZEN, level: 2 },
  { name: 'Петля водяной очереди', type: RoomType.BATHROOM, left: 574, top: 464, right: 660, bottom: 552, floorTex: Tex.F_WATER, wallTex: Tex.TILE_W, faction: ZoneFaction.LIQUIDATOR, level: 3 },
  { name: 'Петля паечной кладовой', type: RoomType.STORAGE, left: 438, top: 550, right: 590, bottom: 612, floorTex: Tex.F_CONCRETE, wallTex: Tex.PANEL, faction: ZoneFaction.WILD, level: 3 },
  { name: 'Петля курилки свидетелей', type: RoomType.SMOKING, left: 330, top: 456, right: 410, bottom: 536, floorTex: Tex.F_LINO, wallTex: Tex.PANEL, faction: ZoneFaction.WILD, level: 2 },
  { name: 'Петля прачечной пропажи', type: RoomType.PRODUCTION, left: 396, top: 484, right: 478, bottom: 548, floorTex: Tex.F_TILE, wallTex: Tex.TILE_W, faction: ZoneFaction.SAMOSBOR, level: 3 },
  { name: 'Петля скрытой ведомости', type: RoomType.COMMON, left: 692, top: 596, right: 804, bottom: 688, floorTex: Tex.F_LINO, wallTex: Tex.PANEL, faction: ZoneFaction.CITIZEN, level: 3 },
];

const COMMUNAL_MICRO_TYPES: readonly RoomType[] = [
  RoomType.LIVING,
  RoomType.STORAGE,
  RoomType.KITCHEN,
  RoomType.BATHROOM,
  RoomType.COMMON,
  RoomType.OFFICE,
  RoomType.SMOKING,
  RoomType.LIVING,
  RoomType.STORAGE,
];

const COMMUNAL_HQ_COMPOUNDS: readonly CommunalHqCompoundSpec[] = [
  {
    owner: ZoneFaction.CITIZEN,
    hall: [438, 318, 526, 318],
    rooms: [
      { type: RoomType.HQ, name: 'Гражданский штаб очереди', x: 474, y: 324, w: 30, h: 15, doorSide: 'north', targetX: 488, targetY: 318 },
      { type: RoomType.KITCHEN, name: 'Кухня гражданского штаба', x: 438, y: 300, w: 22, h: 11, doorSide: 'south', targetX: 449, targetY: 318 },
      { type: RoomType.STORAGE, name: 'Склад общих талонов', x: 506, y: 324, w: 20, h: 11, doorSide: 'north', targetX: 516, targetY: 318 },
      { type: RoomType.MEDICAL, name: 'Медпункт очереди', x: 462, y: 294, w: 20, h: 10, doorSide: 'south', targetX: 472, targetY: 318 },
      { type: RoomType.COMMON, name: 'Комната старших жильцов', x: 438, y: 326, w: 24, h: 12, doorSide: 'north', targetX: 450, targetY: 318 },
    ],
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    hall: [704, 190, 784, 190],
    rooms: [
      { type: RoomType.HQ, name: 'Пост ликвидаторов у душевой дуги', x: 734, y: 196, w: 24, h: 13, doorSide: 'north', targetX: 746, targetY: 190 },
      { type: RoomType.STORAGE, name: 'Оружейный шкаф душевой дуги', x: 710, y: 172, w: 20, h: 11, doorSide: 'south', targetX: 720, targetY: 190 },
      { type: RoomType.BATHROOM, name: 'Санитарный шлюз ликвидаторов', x: 760, y: 196, w: 20, h: 11, doorSide: 'north', targetX: 770, targetY: 190 },
      { type: RoomType.OFFICE, name: 'Журнал напора ликвидаторов', x: 732, y: 170, w: 22, h: 11, doorSide: 'south', targetX: 743, targetY: 190 },
    ],
  },
  {
    owner: ZoneFaction.SCIENTIST,
    hall: [244, 190, 320, 190],
    rooms: [
      { type: RoomType.HQ, name: 'НИИ жалобной доски', x: 260, y: 196, w: 24, h: 13, doorSide: 'north', targetX: 272, targetY: 190 },
      { type: RoomType.OFFICE, name: 'Кабинет протоколов жалоб', x: 244, y: 172, w: 22, h: 11, doorSide: 'south', targetX: 255, targetY: 190 },
      { type: RoomType.MEDICAL, name: 'Измерительная медкомната', x: 286, y: 196, w: 20, h: 11, doorSide: 'north', targetX: 296, targetY: 190 },
      { type: RoomType.STORAGE, name: 'Архив купонов НИИ', x: 270, y: 170, w: 20, h: 11, doorSide: 'south', targetX: 280, targetY: 190 },
    ],
  },
  {
    owner: ZoneFaction.WILD,
    hall: [704, 740, 784, 740],
    rooms: [
      { type: RoomType.HQ, name: 'Дикий штаб паечной кладовой', x: 734, y: 746, w: 24, h: 13, doorSide: 'north', targetX: 746, targetY: 740 },
      { type: RoomType.STORAGE, name: 'Разобранная кладовая диких', x: 710, y: 778, w: 22, h: 11, doorSide: 'north', targetX: 721, targetY: 740 },
      { type: RoomType.SMOKING, name: 'Курилка диких свидетелей', x: 760, y: 746, w: 20, h: 11, doorSide: 'north', targetX: 770, targetY: 740 },
      { type: RoomType.COMMON, name: 'Общий угол самозахвата', x: 732, y: 720, w: 22, h: 11, doorSide: 'south', targetX: 743, targetY: 740 },
    ],
  },
  {
    owner: ZoneFaction.CULTIST,
    hall: [236, 740, 360, 740],
    rooms: [
      { type: RoomType.HQ, name: 'Скрытый культовый штаб курилки', x: 288, y: 746, w: 24, h: 13, doorSide: 'north', targetX: 300, targetY: 740 },
      { type: RoomType.COMMON, name: 'Тихая комната следа', x: 236, y: 720, w: 22, h: 11, doorSide: 'south', targetX: 247, targetY: 740 },
      { type: RoomType.STORAGE, name: 'Кладовая свечей курилки', x: 336, y: 746, w: 20, h: 11, doorSide: 'north', targetX: 346, targetY: 740 },
      { type: RoomType.KITCHEN, name: 'Кухня ритуального кипятка', x: 288, y: 778, w: 22, h: 11, doorSide: 'north', targetX: 299, targetY: 740 },
    ],
  },
];

export function expandDesignFloorGeneration<T extends FloorGeneration>(
  generation: T,
  route: DesignFloorRouteDef,
): T {
  const rng = seededRandom(hashSeed(`design-full:${route.id}:${route.z}`, route.z));
  switch (route.id) {
    case 'roof':
      expandRoof(generation.world, rng);
      break;
    case 'floor_69':
      expandFloor69FullFloor(generation, rng);
      break;
    case 'manhattan_crossroads':
      expandCrossroads(generation.world, rng, style(route));
      break;
    case 'communal_ring':
      expandCommunalRing(generation.world, rng, style(route));
      break;
    case 'moebius_podezd':
      expandMoebiusPodezdRouteGeometry(generation.world, rng);
      break;
    case 'pioneer_camp':
      expandPioneerCampFullFloor(generation.world, rng);
      break;
    case 'oranzhereya_betona':
      expandOranzhereyaBetonaRouteGeometry(generation.world, rng);
      break;
    case 'dark_metro':
      expandDarkMetroFullFloorGeometry(generation.world, rng, style(route), generation.entities);
      break;
    case 'attractor_dvor':
      expandAttractorDvorRouteGeometry(generation.world, rng);
      break;
    case 'production_belt':
      expandProductionBeltGeometry(generation.world, rng);
      break;
    case 'service_floor':
      expandServiceFloor(generation, rng, style(route));
      break;
    case 'silicon_net_well':
      expandSiliconNetWellRouteGeometry(generation.world, rng);
      break;
    case 'underhell':
      expandUnderhell(generation.world, generation.entities, rng);
      break;
    case 'darkness':
      expandDarkness(generation.world, generation.entities, rng);
      break;
    case 'chthonic_attic':
      expandChthonicAtticRootNetwork(generation.world, generation.entities, rng);
      break;
    case 'antenna_court':
      expandAntennaCourtRouteGeometry(generation.world, rng);
      break;
    case 'raionsovet_archive':
      expandRaionsovetArchiveGeometry(generation.world, rng);
      break;
    case 'registry_morgue':
      expandRegistryMorgueGeometry(generation.world, rng);
      break;
    case 'bolnichny_korpus':
      expandBolnichnyKorpusRouteGeometry(generation.world, rng);
      break;
    case 'slime_nii':
      expandSlimeNiiRouteGeometry(generation.world, rng);
      break;
    case 'turing_nursery':
      expandTuringNurseryRouteGeometry(generation.world, rng);
      break;
    case 'black_market_88':
      expandBlackMarket88Bazaar(generation.world, rng);
      break;
    case 'upper_bureau':
      expandUpperBureauGeometry(generation.world, rng);
      break;
    case 'number_registry':
      expandNumberRegistryGeometry(generation.world, rng);
      break;
    case 'bank_floor':
      expandBankFloorRouteGeometry(generation.world, rng);
      break;
    case 'spetspriemnik':
      expandSpetspriemnikRouteGeometry(generation.world, rng);
      break;
    case 'harmonic_bathhouse':
      expandHarmonicBathhouseRouteGeometry(generation.world, rng);
      break;
    case 'hilbert_depot':
      expandHilbertDepotRouteGeometry(generation.world, rng);
      break;
    case 'podad':
      expandPodadRouteGeometry(generation.world, rng);
      break;
  }
  ensureRouteWideFootprint(generation.world, route, rng);
  if (route.id === 'roof') applyRoofLosShelterPockets(generation.world, rng);
  if (route.id === 'communal_ring') labelCommunalRingPopulationRooms(generation.world);
  finalizeExpandedFloor(generation, route, rng);
  if (route.id === 'bolnichny_korpus') reinforceBolnichnyKorpusGates(generation.world);
  if (route.id === 'service_floor') placeServiceFloorEmergencyPanels(generation.world);
  if (route.id === 'attractor_dvor') placeAttractorDvorEmergencyPanels(generation.world);
  if (route.id === 'chthonic_attic') retuneExpandedChthonicAtticEcology(generation.world);
  if (route.id === 'pioneer_camp') tunePioneerCampPopulationZones(generation.world);
  if (route.id === 'radon_exchange') applyRadonExchangeTerritory(generation.world);
  if (route.id === 'registry_morgue') reinforceRegistryMorgueAuthoredTerritory(generation.world);
  if (route.id === 'bank_floor') applyBankFloorTerritorySeeds(generation.world);
  if (route.id === 'hilbert_depot') applyHilbertDepotTerritorySeeds(generation.world);
  if (route.id === 'istinniy_labirint') reinforceIstinniyLabirintTerritorySeeds(generation.world);
  if (route.id === 'moebius_podezd') reinforceMoebiusPodezdAuthoredTerritory(generation.world);
  if (route.id === 'oranzhereya_betona') reinforceOranzhereyaBetonaAuthoredTerritory(generation.world);
  if (route.id === 'darkness') reinforceDarknessAuthoredHqTerritory(generation.world);
  applyDesignFloorPopulationField(generation, route);
  if (route.id === 'number_registry') alignNumberRegistryAmbientNpcTerritory(generation.world, generation.entities);
  if (route.id === 'floor_69') applyFloor69AmbientSpriteTemplates(generation.entities);
  return generation;
}

export function retuneDesignFloorAfterCellTerritory(world: World, routeId: DesignFloorId): void {
  if (routeId === 'attractor_dvor') {
    tuneAttractorDvorRouteZones(world, false);
    return;
  }
  if (routeId === 'communal_ring') {
    reinforceCommunalRingAuthoredHqTerritory(world);
    for (const zone of world.zones) tuneCommunalRingZone(world, zone, 3);
    return;
  }
  if (routeId === 'cantor_pustoty') {
    preserveCantorPustotyAuthoredRooms(world);
    return;
  }
  if (routeId === 'floor_69') {
    applyFloor69OwnershipVisibilityHeatmap(world, false);
    return;
  }
  if (routeId === 'manhattan_crossroads') {
    reinforceManhattanCrossroadsAuthoredHqTerritory(world);
    return;
  }
  if (routeId === 'underhell') {
    reinforceUnderhellAuthoredHqTerritory(world);
    return;
  }
  if (routeId === 'hyperbolic_switchyard') {
    reinforceHyperbolicSwitchyardAuthoredHqTerritory(world);
    restoreAuthoredRoomShell(world, HYPERBOLIC_SWITCHYARD_ROOM_NAMES.shortcut, RoomType.STORAGE, Tex.PIPE, Tex.F_TILE);
    return;
  }
  if (routeId === 'moebius_podezd') {
    restoreAuthoredRoomShell(world, MOEBIUS_PODEZD_ROOM_NAMES.lostMarker, RoomType.STORAGE, Tex.PANEL, Tex.F_CONCRETE);
    return;
  }
  if (routeId === 'voronoi_quarantine') {
    tuneVoronoiQuarantineRouteZones(world);
    return;
  }
  if (routeId === 'upper_bureau') {
    retuneUpperBureauZones(world);
    return;
  }
  if (routeId === 'silicon_net_well') {
    tuneSiliconNetWellRouteZones(world);
    return;
  }
  if (routeId === 'service_floor') {
    reinforceServiceFloorAuthoredHqTerritory(world);
    return;
  }
  if (routeId === 'black_market_88') {
    for (const zone of world.zones) tuneBlackMarket88Zone(world, zone, 3);
  }
  if (routeId === 'dark_metro') {
    reinforceDarkMetroAuthoredHqTerritory(world);
  }
  if (routeId === 'darkness') {
    reinforceDarknessAuthoredHqTerritory(world);
  }
}

function style(route: DesignFloorRouteDef): FloorStyle {
  switch (route.baseFloor) {
    case FloorLevel.MINISTRY:
      return { wallTex: Tex.MARBLE, floorTex: Tex.F_PARQUET, faction: ZoneFaction.CITIZEN, danger: 2 };
    case FloorLevel.KVARTIRY:
      return { wallTex: Tex.BRICK, floorTex: Tex.F_LINO, faction: ZoneFaction.CITIZEN, danger: 3 };
    case FloorLevel.MAINTENANCE:
      return { wallTex: Tex.PIPE, floorTex: Tex.F_CONCRETE, faction: ZoneFaction.LIQUIDATOR, danger: 4 };
    case FloorLevel.HELL:
      return { wallTex: Tex.MEAT, floorTex: Tex.F_MEAT, faction: ZoneFaction.CULTIST, danger: 5 };
    case FloorLevel.VOID:
      return { wallTex: Tex.VOID_WALL, floorTex: Tex.F_VOID, faction: ZoneFaction.SAMOSBOR, danger: 5 };
    case FloorLevel.LIVING:
    default:
      return { wallTex: Tex.PANEL, floorTex: Tex.F_CARPET, faction: ZoneFaction.CITIZEN, danger: 3 };
  }
}

function finalizeExpandedFloor<T extends FloorGeneration>(
  generation: T,
  route: DesignFloorRouteDef,
  rng: () => number,
): void {
  generateZones(generation.world);
  tuneZones(generation.world, style(route), route.id);
  if (route.id === 'roof') retuneRoofPressureZones(generation.world);
  if (route.id === 'antenna_court') retuneAntennaCourtRouteZones(generation.world);
  if (route.id !== 'roof' && route.id !== 'darkness' && route.id !== 'cantor_pustoty') {
    const lightCount = route.id === 'dark_metro' ? 130 : 260;
    scatterAmbientLights(generation.world, rng, lightCount);
  }
  ensureConnectivity(generation.world, generation.spawnX, generation.spawnY);
  if (route.id === 'spetspriemnik') reinforceSpetspriemnikRouteGates(generation.world);
  sanitizeDoors(generation.world);
  generation.world.rebuildContainerMap();
  if (route.id === 'roof') applyUniformSkyLight(generation.world);
  else if (route.id === 'darkness') blackoutDarknessLights(generation.world);
  else generation.world.bakeLights();
}

function tuneZones(world: World, s: FloorStyle, routeId: string): void {
  if (routeId === 'silicon_net_well') {
    tuneSiliconNetWellRouteZones(world);
    return;
  }
  if (routeId === 'bolnichny_korpus') {
    tuneBolnichnyKorpusRouteZones(world);
    return;
  }
  if (routeId === 'spetspriemnik') {
    tuneSpetspriemnikRouteZones(world);
    return;
  }
  if (routeId === 'voronoi_quarantine') {
    tuneVoronoiQuarantineRouteZones(world);
    return;
  }
  if (routeId === 'attractor_dvor') {
    tuneAttractorDvorRouteZones(world);
    return;
  }
  if (routeId === 'cayley_byuro') {
    retuneCayleyByuroTerritory(world);
    return;
  }
  if (routeId === 'turing_nursery') {
    reinforceTuringNurseryAuthoredHqTerritory(world);
    return;
  }
  for (const zone of world.zones) {
    const d = world.dist(zone.cx, zone.cy, W / 2, W / 2);
    zone.level = Math.max(1, Math.min(5, Math.round(s.danger + d / 420)));
    zone.faction = s.faction;
    if (routeId === 'floor_69' && zone.id % 9 === 0) zone.faction = ZoneFaction.LIQUIDATOR;
    if (routeId === 'black_market_88') tuneBlackMarket88Zone(world, zone, s.danger);
    if (routeId === 'slime_nii') zone.faction = d < 250 ? ZoneFaction.LIQUIDATOR : zone.id % 5 === 0 ? ZoneFaction.WILD : ZoneFaction.CITIZEN;
    if (routeId === 'turing_nursery') {
      zone.faction = d < 240 ? ZoneFaction.LIQUIDATOR : zone.id % 4 === 0 ? ZoneFaction.WILD : ZoneFaction.CITIZEN;
      zone.level = Math.max(zone.level, d < 240 ? 4 : 3);
    }
    if (routeId === 'communal_ring') {
      tuneCommunalRingZone(world, zone, s.danger);
    }
    if (routeId === 'underhell') {
      const lowerGate = zone.cy > W * 0.62;
      zone.level = Math.min(8, zone.level + (lowerGate ? 2 : 1));
      zone.faction = lowerGate ? ZoneFaction.SAMOSBOR : zone.id % 5 === 0 ? ZoneFaction.LIQUIDATOR : ZoneFaction.CULTIST;
    }
    if (routeId === 'dark_metro') tuneDarkMetroRouteZone(zone);
    if (routeId === 'service_floor') tuneServiceFloorZone(world, zone, s.danger);
    if (routeId === 'registry_morgue') {
      const coldRows = zone.cy >= 250 && zone.cy <= 790 && (zone.cy < 455 || zone.cy > 585) && zone.cx >= 60 && zone.cx <= 965;
      const registryCore = zone.cx >= 300 && zone.cx <= 725 && zone.cy >= 455 && zone.cy <= 585;
      if (coldRows) {
        zone.faction = ZoneFaction.SAMOSBOR;
        zone.level = Math.max(zone.level, 4);
      } else if (registryCore) {
        zone.faction = zone.id % 3 === 0 ? ZoneFaction.LIQUIDATOR : ZoneFaction.CITIZEN;
        zone.level = Math.max(zone.level, 3);
      }
    }
    if (routeId === 'manhattan_crossroads') tuneManhattanCrossroadsZone(world, zone, s.danger);
    if (routeId === 'cantor_pustoty') {
      zone.faction = ZoneFaction.SAMOSBOR;
      zone.level = Math.max(5, zone.level);
      zone.fogged = true;
    } else {
      zone.fogged = false;
    }
  }

  if (routeId === 'raionsovet_archive') retuneRaionsovetArchiveZones(world);

  if (routeId === 'upper_bureau') {
    retuneUpperBureauZones(world);
    return;
  }

  if (routeId === 'number_registry') {
    retuneNumberRegistryZones(world);
    return;
  }

  for (let i = 0; i < W * W; i++) {
    const zone = world.zones[world.zoneMap[i]];
    world.factionControl[i] = zone?.faction ?? s.faction;
  }

  if (routeId === 'raionsovet_archive') reinforceRaionsovetArchiveAuthoredHqTerritory(world);
  if (routeId === 'floor_69') applyFloor69OwnershipVisibilityHeatmap(world);
  if (routeId === 'turing_nursery') reinforceTuringNurseryAuthoredHqTerritory(world);
}

function tuneManhattanCrossroadsZone(world: World, zone: Zone, baseDanger: number): void {
  const d = world.dist(zone.cx, zone.cy, W / 2, W / 2);
  const centralControl = d < 158 || (zone.cx >= 448 && zone.cx <= 608 && zone.cy >= 432 && zone.cy <= 592);
  const wrongExit = zone.cx >= 640 && zone.cy >= 512 && zone.cy <= 760;
  const falseRoad = zone.cx <= 176 || zone.cx >= 848 || zone.cy <= 176 || zone.cy >= 848;
  const gangRoad = wrongExit || falseRoad || (zone.cx >= 610 && zone.cy >= 610) || (zone.cx <= 304 && zone.cy >= 610);
  const marketQueue = zone.cx >= 320 && zone.cx <= 560 && zone.cy >= 480 && zone.cy <= 620;

  if (gangRoad) {
    zone.faction = ZoneFaction.WILD;
    zone.level = Math.max(zone.level, wrongExit ? 4 : 3);
  } else if (centralControl) {
    zone.faction = ZoneFaction.LIQUIDATOR;
    zone.level = Math.max(zone.level, baseDanger);
  } else if (marketQueue) {
    zone.faction = zone.cx > 500 ? ZoneFaction.LIQUIDATOR : ZoneFaction.CITIZEN;
    zone.level = Math.max(zone.level, baseDanger);
  } else {
    zone.faction = ZoneFaction.CITIZEN;
    zone.level = Math.max(2, Math.min(5, zone.level));
  }

  if (falseRoad && (zone.cx <= 176 || zone.cx >= 848) && (zone.cy <= 176 || zone.cy >= 848)) {
    zone.level = Math.max(zone.level, 5);
  }
  zone.hasLift = zone.hasLift || d < 330 || wrongExit;
}

function tuneBlackMarket88Zone(world: World, zone: Zone, baseDanger: number): void {
  const inBazaar = zone.cx >= 260 && zone.cx <= 764 && zone.cy >= 328 && zone.cy <= 696;
  const debtAndPapers = zone.cx >= 420 && zone.cx <= 660 && zone.cy >= 420 && zone.cy <= 620;
  const guardPosts = (zone.cx >= 386 && zone.cx <= 476 && zone.cy >= 456 && zone.cy <= 536)
    || (zone.cx >= 552 && zone.cx <= 646 && zone.cy >= 412 && zone.cy <= 570);

  if (isBlackMarket88ServiceGutZone(zone)) {
    zone.faction = zone.id % 5 === 0 ? ZoneFaction.SAMOSBOR : ZoneFaction.WILD;
    zone.level = Math.max(zone.level, baseDanger + 1);
  } else if (guardPosts) {
    zone.faction = ZoneFaction.LIQUIDATOR;
    zone.level = Math.max(zone.level, baseDanger);
  } else if (debtAndPapers) {
    zone.faction = zone.id % 3 === 0 ? ZoneFaction.WILD : ZoneFaction.CITIZEN;
    zone.level = Math.max(zone.level, baseDanger);
  } else if (inBazaar) {
    zone.faction = zone.id % 7 === 0 ? ZoneFaction.WILD : ZoneFaction.CITIZEN;
    zone.level = Math.max(zone.level, baseDanger - 1);
  } else if (zone.id % 7 === 0) {
    zone.faction = ZoneFaction.WILD;
  }
  void world;
}

function isBlackMarket88ServiceGutZone(zone: Zone): boolean {
  const northSouthGuts = zone.cx >= 180 && zone.cx <= 844 &&
    ((zone.cy >= 286 && zone.cy <= 356) || (zone.cy >= 676 && zone.cy <= 736));
  const westEastGuts = zone.cy >= 344 && zone.cy <= 660 &&
    (zone.cx <= 180 || zone.cx >= 844);
  return northSouthGuts || westEastGuts;
}

function retuneRaionsovetArchiveZones(world: World): void {
  const storage = new Int32Array(world.zones.length);
  const office = new Int32Array(world.zones.length);
  const common = new Int32Array(world.zones.length);
  const hq = new Int32Array(world.zones.length);
  const production = new Int32Array(world.zones.length);

  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] !== Cell.FLOOR) continue;
    const zoneId = world.zoneMap[i];
    if (zoneId < 0 || zoneId >= world.zones.length) continue;
    const room = world.rooms[world.roomMap[i]];
    if (!room) continue;
    switch (room.type) {
      case RoomType.STORAGE:
        storage[zoneId]++;
        break;
      case RoomType.OFFICE:
        office[zoneId]++;
        break;
      case RoomType.COMMON:
        common[zoneId]++;
        break;
      case RoomType.HQ:
        hq[zoneId]++;
        break;
      case RoomType.PRODUCTION:
        production[zoneId]++;
        break;
    }
  }

  for (const zone of world.zones) {
    const z = zone.id;
    const archiveScore = storage[z] + production[z] * 0.8;
    const adminScore = office[z] + hq[z] * 1.2;
    const queueScore = common[z];
    if (archiveScore > 220 && archiveScore > adminScore + queueScore) {
      zone.faction = z % 5 === 0 ? ZoneFaction.WILD : ZoneFaction.SAMOSBOR;
      zone.level = Math.max(zone.level, archiveScore > 520 ? 5 : 4);
    } else if (adminScore > 150) {
      zone.faction = z % 4 === 0 ? ZoneFaction.LIQUIDATOR : ZoneFaction.CITIZEN;
      zone.level = Math.max(zone.level, 3);
    } else if (queueScore > 150) {
      zone.faction = ZoneFaction.CITIZEN;
      zone.level = Math.max(zone.level, 2);
    }
  }
}

function tuneServiceFloorZone(world: World, zone: Zone, baseDanger: number): void {
  const centralStaff = zone.cx >= 384 && zone.cx <= 650 && zone.cy >= 448 && zone.cy <= 578;
  const pumpBelt = zone.cy >= 620 && zone.cy <= 744 && zone.cx >= 245 && zone.cx <= 780;
  const compressorBelt = zone.cy >= 250 && zone.cy <= 360 && zone.cx >= 245 && zone.cx <= 780;
  const cableSpine = Math.abs(world.delta(zone.cx, 332)) <= 54 || Math.abs(world.delta(zone.cx, 704)) <= 54 ||
    Math.abs(world.delta(zone.cy, 438)) <= 54 || Math.abs(world.delta(zone.cy, 590)) <= 54;
  const remoteCore = zone.cx <= 260 || zone.cx >= 760 || zone.cy <= 230 || zone.cy >= 790;

  if (centralStaff) {
    zone.faction = ZoneFaction.LIQUIDATOR;
    zone.level = Math.max(zone.level, baseDanger);
    zone.hasLift = true;
  } else if (pumpBelt || compressorBelt) {
    zone.faction = zone.id % 2 === 0 ? ZoneFaction.SAMOSBOR : ZoneFaction.WILD;
    zone.level = Math.max(zone.level, 4);
  } else if (remoteCore || cableSpine) {
    zone.faction = zone.id % 3 === 0 ? ZoneFaction.WILD : ZoneFaction.SAMOSBOR;
    zone.level = Math.max(zone.level, remoteCore ? 5 : 4);
  } else {
    zone.faction = ZoneFaction.LIQUIDATOR;
    zone.level = Math.max(3, Math.min(5, zone.level));
  }
}

function tuneCommunalRingZone(world: World, zone: Zone, baseDanger: number): void {
  let best = COMMUNAL_SERVICE_LOOPS[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < COMMUNAL_SERVICE_LOOPS.length; i++) {
    const spec = COMMUNAL_SERVICE_LOOPS[i]!;
    const cx = (spec.left + spec.right) / 2;
    const cy = (spec.top + spec.bottom) / 2;
    const rx = Math.max(1, spec.right - spec.left);
    const ry = Math.max(1, spec.bottom - spec.top);
    const radius = Math.max(rx, ry) * 1.35;
    const domainJitter = (((zone.id * 1103515245 + i * 1013904223) >>> 0) % 1024) / 1024;
    const d2 = world.dist2(zone.cx, zone.cy, cx, cy);
    const score = d2 / (radius * radius) + domainJitter * 0.42 - spec.level * 0.1;
    if (score < bestScore) {
      best = spec;
      bestScore = score;
    }
  }

  zone.faction = best.faction;
  zone.level = Math.max(zone.level, Math.min(5, Math.max(baseDanger, best.level)));
  zone.hasLift = zone.hasLift || best.type === RoomType.BATHROOM || best.type === RoomType.STORAGE;
}

function preserveCantorPustotyAuthoredRooms(world: World): void {
  restoreAuthoredRoomShell(world, CANTOR_PUSTOTY_ROOM_NAMES.repair, RoomType.PRODUCTION, Tex.VOID_WALL, Tex.F_CONCRETE);

  const hasCitizenHq = world.rooms.some(room => (
    room.type === RoomType.HQ &&
    room.name !== CANTOR_PUSTOTY_ROOM_NAMES.repair &&
    world.factionControl[world.idx(room.x + (room.w >> 1), room.y + (room.h >> 1))] === ZoneFaction.CITIZEN
  ));
  if (hasCitizenHq) return;

  const fallback = world.rooms.find(room => (
    room.name.startsWith('Темный карман') &&
    room.type === RoomType.STORAGE &&
    room.w > 2 &&
    room.h > 2
  ));
  if (!fallback) return;
  fallback.type = RoomType.HQ;
  fallback.sealed = true;
  fallback.wallTex = Tex.HERMO_WALL;
  for (let dy = 0; dy < fallback.h; dy++) {
    for (let dx = 0; dx < fallback.w; dx++) {
      const idx = world.idx(fallback.x + dx, fallback.y + dy);
      if (world.roomMap[idx] === fallback.id) world.factionControl[idx] = ZoneFaction.CITIZEN;
    }
  }
  for (let dy = -1; dy <= fallback.h; dy++) {
    for (let dx = -1; dx <= fallback.w; dx++) {
      if (dx >= 0 && dx < fallback.w && dy >= 0 && dy < fallback.h) continue;
      const idx = world.idx(fallback.x + dx, fallback.y + dy);
      if (world.cells[idx] !== Cell.WALL) continue;
      world.hermoWall[idx] = 1;
      world.wallTex[idx] = Tex.HERMO_WALL;
    }
  }
  world.markWallTexDirty();
}

function restoreAuthoredRoomShell(world: World, name: string, type: RoomType, wallTex: Tex, floorTex: Tex): Room | undefined {
  const room = world.rooms.find(candidate => candidate.name === name);
  if (!room) return undefined;
  room.type = type;
  room.sealed = false;
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      const interior = dx >= 0 && dx < room.w && dy >= 0 && dy < room.h;
      if (interior) {
        if (world.roomMap[idx] === room.id) world.floorTex[idx] = floorTex;
        continue;
      }
      if (world.cells[idx] !== Cell.WALL) continue;
      world.hermoWall[idx] = 0;
      world.wallTex[idx] = wallTex;
    }
  }
  world.markWallTexDirty();
  world.markFloorTexDirty();
  return room;
}

function protectedMask(world: World): Uint8Array {
  const mask = new Uint8Array(W * W);
  for (const room of world.rooms) {
    for (let y = room.y - 1; y <= room.y + room.h; y++) {
      for (let x = room.x - 1; x <= room.x + room.w; x++) {
        mask[world.idx(x, y)] = 1;
      }
    }
  }
  for (const idx of world.doors.keys()) mask[idx] = 1;
  for (const container of world.containers) mask[world.idx(container.x, container.y)] = 1;
  for (let i = 0; i < W * W; i++) if (world.cells[i] === Cell.LIFT) mask[i] = 1;
  return mask;
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
    wallTex,
    floorTex,
  };
  world.rooms.push(room);
  carveRect(world, room.x, room.y, w, h, room.id, floorTex);
  wallRing(world, room.x, room.y, w, h, wallTex);
  return room;
}

function carveRect(world: World, x: number, y: number, w: number, h: number, roomId: number, floorTex: Tex): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      world.cells[ci] = Cell.FLOOR;
      world.roomMap[ci] = roomId;
      world.floorTex[ci] = floorTex;
    }
  }
}

function wallRing(world: World, x: number, y: number, w: number, h: number, wallTex: Tex): void {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      if (dx >= 0 && dx < w && dy >= 0 && dy < h) continue;
      const ci = world.idx(x + dx, y + dy);
      if (world.cells[ci] === Cell.WALL || world.cells[ci] === Cell.ABYSS) {
        world.cells[ci] = Cell.WALL;
        world.wallTex[ci] = wallTex;
      }
    }
  }
}

function carveLine(world: World, ax: number, ay: number, bx: number, by: number, width: number, floorTex: Tex): void {
  let x = ax;
  let y = ay;
  const sx = bx === ax ? 0 : bx > ax ? 1 : -1;
  const sy = by === ay ? 0 : by > ay ? 1 : -1;
  while (x !== bx) {
    carveDisc(world, x, y, width, floorTex);
    x += sx;
  }
  while (y !== by) {
    carveDisc(world, x, y, width, floorTex);
    y += sy;
  }
  carveDisc(world, x, y, width, floorTex);
}

function carveDisc(world: World, cx: number, cy: number, r: number, floorTex: Tex, roomId = -1): void {
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const ci = world.idx(cx + dx, cy + dy);
      world.cells[ci] = Cell.FLOOR;
      world.roomMap[ci] = roomId;
      world.floorTex[ci] = floorTex;
    }
  }
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER) world.features[ci] = feature;
}

function scatterAmbientLights(world: World, rng: () => number, count: number): void {
  for (let attempt = 0, placed = 0; attempt < count * 20 && placed < count; attempt++) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    const ci = world.idx(x, y);
    if (world.cells[ci] !== Cell.FLOOR || world.features[ci] !== Feature.NONE) continue;
    if (rng() < 0.7) world.features[ci] = Feature.LAMP;
    else world.features[ci] = Feature.CANDLE;
    placed++;
  }
}

function applyUniformSkyLight(world: World): void {
  for (let i = 0; i < W * W; i++) {
    if (world.features[i] === Feature.LAMP || world.features[i] === Feature.CANDLE) {
      world.features[i] = Feature.NONE;
    }
  }
  world.light.fill(0.94);
}

function randomFloorCell(world: World, rng: () => number): Point | null {
  for (let attempt = 0; attempt < 2000; attempt++) {
    const x = Math.floor(rng() * W);
    const y = Math.floor(rng() * W);
    if (world.cells[world.idx(x, y)] === Cell.FLOOR) return { x, y };
  }
  return null;
}

function expandRoof(world: World, rng: () => number): void {
  expandRoofArchipelago(world, rng);
}

function expandCrossroads(world: World, rng: () => number, s: FloorStyle): void {
  void s;
  expandManhattanCrossroadsRouteShell(world, rng);
}

function expandCommunalRing(world: World, rng: () => number, s: FloorStyle): void {
  const mask = communalProtectedMask(world);
  const rings = [132, 252, 372, 456];
  for (const r of rings) carveCommunalRing(world, mask, r, r === 132 ? 3 : 4, s.floorTex);

  for (const x of [192, 320, 512, 704, 832]) {
    carveSafeLine(world, mask, x, 512 - 456, x, 512 - 132, 3, s.floorTex);
    carveSafeLine(world, mask, x, 512 + 132, x, 512 + 456, 3, s.floorTex);
  }
  for (const y of [192, 320, 512, 704, 832]) {
    carveSafeLine(world, mask, 512 - 456, y, 512 - 132, y, 3, s.floorTex);
    carveSafeLine(world, mask, 512 + 132, y, 512 + 456, y, 3, s.floorTex);
  }

  carveSafeLine(world, mask, 512, 512 - 132, 512, 460, 2, s.floorTex);
  carveSafeLine(world, mask, 512, 564, 512, 512 + 132, 2, s.floorTex);
  addCommunalServiceShafts(world, mask);
  addCommunalDomesticServiceLoops(world, mask);
  addCommunalBottlenecks(world, mask, s.wallTex);
  addCommunalHqCompounds(world, mask);

  const serviceTypes = [
    RoomType.KITCHEN,
    RoomType.COMMON,
    RoomType.BATHROOM,
    RoomType.PRODUCTION,
    RoomType.STORAGE,
    RoomType.SMOKING,
    RoomType.OFFICE,
    RoomType.LIVING,
  ];
  const sides: CommunalSide[] = ['north', 'east', 'south', 'west'];
  for (let ri = 1; ri < rings.length; ri++) {
    const r = rings[ri];
    const offsets = [-r + 72, Math.round(-r * 0.32), Math.round(r * 0.32), r - 72];
    for (let si = 0; si < sides.length; si++) {
      for (let oi = 0; oi < offsets.length; oi++) {
        const type = serviceTypes[(ri + si + oi) % serviceTypes.length];
        addCommunalKnot(world, mask, rng, s, sides[si], r, offsets[oi], type);
      }
    }
  }
  addCommunalMicroRoomBands(world, mask, rng, s);
}

function labelCommunalRingPopulationRooms(world: World): void {
  for (const room of world.rooms) {
    switch (room.name) {
      case 'Радиальная общая кухня':
        room.type = RoomType.KITCHEN;
        break;
      case 'Банный ряд кольца':
        room.type = RoomType.BATHROOM;
        break;
      case 'Прачечный узел':
        room.type = RoomType.PRODUCTION;
        break;
      case 'Кладовая у спицы':
        room.type = RoomType.STORAGE;
        break;
      case 'Дежурная доска':
        room.type = RoomType.OFFICE;
        break;
      case 'Курилка у кольца':
        room.type = RoomType.SMOKING;
        break;
      case 'Коммунальная тесная комната':
        room.type = RoomType.LIVING;
        break;
    }
  }

  for (const spec of COMMUNAL_SERVICE_LOOPS) {
    labelCommunalLogicalRoom(
      world,
      spec.type,
      spec.name,
      spec.left,
      spec.top,
      spec.right - spec.left + 1,
      spec.bottom - spec.top + 1,
      spec.floorTex,
      spec.wallTex,
    );
  }

  const storageLines: readonly [string, number, number, number, number][] = [
    ['Мусорный сервисный ход северо-запада', 56, 220, 380, 220],
    ['Мусорный сервисный ход северо-востока', 644, 284, 968, 284],
    ['Прачечный сервисный ход юго-запада', 212, 644, 212, 968],
    ['Водяной сервисный ход востока', 812, 56, 812, 380],
    ['Пищевой сервисный ход юга', 140, 812, 388, 812],
    ['Сухой сервисный ход юго-востока', 636, 720, 884, 720],
  ];
  for (const [name, ax, ay, bx, by] of storageLines) {
    labelCommunalLineRoom(world, RoomType.STORAGE, name, ax, ay, bx, by, 5, Tex.F_CONCRETE, Tex.PIPE);
  }

  const commonRooms: readonly [string, number, number, number, number][] = [
    ['Очередь северной общей кухни', 470, 454, 86, 17],
    ['Очередь паечной кладовой', 466, 552, 92, 21],
    ['Спорный угол прачечной', 416, 486, 32, 38],
    ['Мокрая очередь душевой', 574, 486, 33, 40],
    ['Доска жалоб у внешнего кольца', 520, 466, 54, 24],
    ['Протестный узел северо-запада', 174, 176, 44, 30],
    ['Протестный узел северо-востока', 806, 174, 48, 32],
    ['Протестный узел юго-запада', 176, 806, 46, 34],
    ['Протестный узел юго-востока', 804, 804, 50, 34],
    ['Общий разворот внутреннего кольца', 478, 488, 74, 46],
  ];
  for (const [name, x, y, w, h] of commonRooms) {
    labelCommunalLogicalRoom(world, RoomType.COMMON, name, x, y, w, h, Tex.F_LINO, Tex.PANEL);
  }

  for (const r of [132, 252, 372, 456]) {
    const width = r === 132 ? 6 : 8;
    labelCommunalLogicalRoom(world, RoomType.CORRIDOR, `Северное кольцо коммуналки R${r}`, 512 - r, 512 - r - 2, r * 2 + width, width + 4, Tex.F_LINO, Tex.PANEL);
    labelCommunalLogicalRoom(world, RoomType.CORRIDOR, `Южное кольцо коммуналки R${r}`, 512 - r, 512 + r - 2, r * 2 + width, width + 4, Tex.F_LINO, Tex.PANEL);
    labelCommunalLogicalRoom(world, RoomType.CORRIDOR, `Западное кольцо коммуналки R${r}`, 512 - r - 2, 512 - r, width + 4, r * 2 + width, Tex.F_LINO, Tex.PANEL);
    labelCommunalLogicalRoom(world, RoomType.CORRIDOR, `Восточное кольцо коммуналки R${r}`, 512 + r - 2, 512 - r, width + 4, r * 2 + width, Tex.F_LINO, Tex.PANEL);
  }

  for (const x of [192, 320, 512, 704, 832]) {
    labelCommunalLogicalRoom(world, RoomType.CORRIDOR, `Северная коммунальная спица ${x}`, x - 3, 56, 7, 324, Tex.F_LINO, Tex.PANEL);
    labelCommunalLogicalRoom(world, RoomType.CORRIDOR, `Южная коммунальная спица ${x}`, x - 3, 644, 7, 324, Tex.F_LINO, Tex.PANEL);
  }
  for (const y of [192, 320, 512, 704, 832]) {
    labelCommunalLogicalRoom(world, RoomType.CORRIDOR, `Западная коммунальная спица ${y}`, 56, y - 3, 324, 7, Tex.F_LINO, Tex.PANEL);
    labelCommunalLogicalRoom(world, RoomType.CORRIDOR, `Восточная коммунальная спица ${y}`, 644, y - 3, 324, 7, Tex.F_LINO, Tex.PANEL);
  }
}

function labelCommunalLineRoom(
  world: World,
  type: RoomType,
  name: string,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  floorTex: Tex,
  wallTex: Tex,
): void {
  const half = Math.floor(width / 2);
  const x = Math.min(ax, bx) - half;
  const y = Math.min(ay, by) - half;
  const w = Math.abs(ax - bx) + width;
  const h = Math.abs(ay - by) + width;
  labelCommunalLogicalRoom(world, type, name, x, y, w, h, floorTex, wallTex);
}

function labelCommunalLogicalRoom(
  world: World,
  type: RoomType,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  floorTex: Tex,
  wallTex: Tex,
): void {
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
    wallTex,
    floorTex,
  };
  let mapped = 0;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.cells[ci] !== Cell.FLOOR || world.roomMap[ci] >= 0) continue;
      if (mapped === 0) world.rooms.push(room);
      world.roomMap[ci] = room.id;
      mapped++;
    }
  }
}

function communalProtectedMask(world: World): Uint8Array {
  return protectedMask(world);
}

function carveCommunalRing(world: World, mask: Uint8Array, r: number, width: number, floorTex: Tex): void {
  carveSafeRect(world, mask, 512 - r, 512 - r, r * 2, width, floorTex);
  carveSafeRect(world, mask, 512 - r, 512 + r, r * 2, width, floorTex);
  carveSafeRect(world, mask, 512 - r, 512 - r, width, r * 2, floorTex);
  carveSafeRect(world, mask, 512 + r, 512 - r, width, r * 2 + width, floorTex);
}

function carveSafeRect(world: World, mask: Uint8Array, x: number, y: number, w: number, h: number, floorTex: Tex): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) carveSafeCell(world, mask, x + dx, y + dy, floorTex);
  }
}

function carveSafeLine(world: World, mask: Uint8Array, ax: number, ay: number, bx: number, by: number, width: number, floorTex: Tex): void {
  if (ax !== bx && ay !== by) {
    carveSafeLine(world, mask, ax, ay, bx, ay, width, floorTex);
    carveSafeLine(world, mask, bx, ay, bx, by, width, floorTex);
    return;
  }
  const half = Math.floor(width / 2);
  const from = ax === bx ? Math.min(ay, by) : Math.min(ax, bx);
  const to = ax === bx ? Math.max(ay, by) : Math.max(ax, bx);
  for (let p = from; p <= to; p++) {
    for (let n = 0; n < width; n++) {
      const o = n - half;
      carveSafeCell(world, mask, ax === bx ? ax + o : p, ax === bx ? p : ay + o, floorTex);
    }
  }
}

function carveSafeCell(world: World, mask: Uint8Array, x: number, y: number, floorTex: Tex): void {
  const ci = world.idx(x, y);
  if (mask[ci] || world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR) return;
  world.cells[ci] = Cell.FLOOR;
  world.roomMap[ci] = -1;
  world.floorTex[ci] = floorTex;
  world.factionControl[ci] = ZoneFaction.CITIZEN;
}

function addCommunalKnot(
  world: World,
  mask: Uint8Array,
  rng: () => number,
  s: FloorStyle,
  side: CommunalSide,
  radius: number,
  offset: number,
  type: RoomType,
): void {
  const size = communalKnotSize(type, rng);
  const center = 512 + offset;
  let x = 0;
  let y = 0;
  let doorX = 0;
  let doorY = 0;
  let ringX = 0;
  let ringY = 0;

  if (side === 'north' || side === 'south') {
    x = Math.round(center - size.w / 2);
    y = side === 'north' ? 512 - radius - size.h - 9 : 512 + radius + 9;
    doorX = Math.round(center);
    doorY = side === 'north' ? y + size.h : y - 1;
    ringX = doorX;
    ringY = side === 'north' ? 512 - radius + 1 : 512 + radius + 2;
  } else {
    x = side === 'west' ? 512 - radius - size.w - 9 : 512 + radius + 9;
    y = Math.round(center - size.h / 2);
    doorX = side === 'west' ? x + size.w : x - 1;
    doorY = Math.round(center);
    ringX = side === 'west' ? 512 - radius + 1 : 512 + radius + 2;
    ringY = doorY;
  }

  if (!canPlaceCommunalRoom(world, mask, x, y, size.w, size.h)) return;
  const tileRoom = type === RoomType.BATHROOM || type === RoomType.KITCHEN;
  const room = addRoom(world, type, x, y, size.w, size.h, communalKnotName(type), tileRoom ? Tex.TILE_W : s.wallTex, tileRoom ? Tex.F_TILE : s.floorTex);
  carveSafeLine(world, mask, doorX, doorY, ringX, ringY, 2, s.floorTex);
  decorateCommunalKnot(world, room, rng);
  placeCommunalQueueMarker(world, ringX, ringY, type);
}

function communalKnotSize(type: RoomType, rng: () => number): { w: number; h: number } {
  switch (type) {
    case RoomType.KITCHEN: return { w: 32 + Math.floor(rng() * 8), h: 16 + Math.floor(rng() * 4) };
    case RoomType.BATHROOM: return { w: 28 + Math.floor(rng() * 6), h: 15 + Math.floor(rng() * 4) };
    case RoomType.PRODUCTION: return { w: 30 + Math.floor(rng() * 8), h: 16 + Math.floor(rng() * 6) };
    case RoomType.STORAGE: return { w: 24 + Math.floor(rng() * 8), h: 14 + Math.floor(rng() * 5) };
    case RoomType.SMOKING: return { w: 22 + Math.floor(rng() * 6), h: 12 + Math.floor(rng() * 4) };
    case RoomType.OFFICE: return { w: 24 + Math.floor(rng() * 7), h: 13 + Math.floor(rng() * 4) };
    default: return { w: 22 + Math.floor(rng() * 8), h: 13 + Math.floor(rng() * 5) };
  }
}

function canPlaceCommunalRoom(world: World, mask: Uint8Array, x: number, y: number, w: number, h: number): boolean {
  if (x < 6 || y < 6 || x + w >= W - 6 || y + h >= W - 6) return false;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (mask[ci] || world.cells[ci] !== Cell.WALL) return false;
    }
  }
  return true;
}

function communalKnotName(type: RoomType): string {
  switch (type) {
    case RoomType.KITCHEN: return 'Радиальная общая кухня';
    case RoomType.BATHROOM: return 'Банный ряд кольца';
    case RoomType.PRODUCTION: return 'Прачечный узел';
    case RoomType.STORAGE: return 'Кладовая у спицы';
    case RoomType.SMOKING: return 'Курилка у кольца';
    case RoomType.OFFICE: return 'Дежурная доска';
    default: return 'Коммунальная тесная комната';
  }
}

function decorateCommunalKnot(world: World, room: Room, rng: () => number): void {
  if (room.type === RoomType.KITCHEN) {
    for (let x = room.x + 3; x < room.x + room.w - 3; x += 6) setFeature(world, x, room.y + 2, Feature.STOVE);
    setFeature(world, room.x + 2, room.y + room.h - 3, Feature.SINK);
    setFeature(world, room.x + room.w - 5, room.y + room.h - 4, Feature.TABLE);
    return;
  }
  if (room.type === RoomType.BATHROOM) {
    for (let x = room.x + 3; x < room.x + room.w - 3; x += 5) {
      setFeature(world, x, room.y + 2, Feature.SINK);
      setFeature(world, x + 1, room.y + room.h - 3, Feature.TOILET);
    }
    const water = world.idx(room.x + (room.w >> 1), room.y + (room.h >> 1));
    world.cells[water] = Cell.WATER;
    world.floorTex[water] = Tex.F_WATER;
    return;
  }
  if (room.type === RoomType.PRODUCTION) {
    for (let x = room.x + 3; x < room.x + room.w - 3; x += 7) setFeature(world, x, room.y + 3, Feature.MACHINE);
    setFeature(world, room.x + room.w - 4, room.y + room.h - 4, Feature.SHELF);
    setFeature(world, room.x + 4, room.y + room.h - 4, Feature.SINK);
    return;
  }
  if (room.type === RoomType.STORAGE) {
    for (let x = room.x + 3; x < room.x + room.w - 3; x += 4) setFeature(world, x, room.y + 3, Feature.SHELF);
    for (let x = room.x + 5; x < room.x + room.w - 3; x += 6) setFeature(world, x, room.y + room.h - 4, Feature.SHELF);
    return;
  }
  if (room.type === RoomType.SMOKING) {
    setFeature(world, room.x + 3, room.y + 3, Feature.TABLE);
    setFeature(world, room.x + 6, room.y + 3, Feature.CHAIR);
    setFeature(world, room.x + room.w - 4, room.y + 3, Feature.CANDLE);
    setFeature(world, room.x + room.w - 5, room.y + room.h - 4, Feature.SHELF);
    return;
  }
  if (room.type === RoomType.OFFICE) {
    setFeature(world, room.x + 3, room.y + 3, Feature.DESK);
    setFeature(world, room.x + 8, room.y + 3, Feature.SCREEN);
    setFeature(world, room.x + room.w - 4, room.y + room.h - 4, Feature.SHELF);
    return;
  }
  setFeature(world, room.x + 3, room.y + 3, Feature.BED);
  setFeature(world, room.x + room.w - 4, room.y + room.h - 4, rng() < 0.5 ? Feature.TABLE : Feature.CHAIR);
}

function placeCommunalQueueMarker(world: World, x: number, y: number, type: RoomType): void {
  setFeature(world, x + 2, y, type === RoomType.STORAGE ? Feature.SHELF : Feature.TABLE);
  setFeature(world, x - 2, y, type === RoomType.BATHROOM ? Feature.SINK : Feature.CHAIR);
}

function addCommunalDomesticServiceLoops(world: World, mask: Uint8Array): void {
  for (const spec of COMMUNAL_SERVICE_LOOPS) {
    carveCommunalServiceLoop(world, mask, spec);
    placeCommunalLoopMarkers(world, spec);
  }
}

function carveCommunalServiceLoop(world: World, mask: Uint8Array, spec: CommunalServiceLoopSpec): void {
  carveSafeLine(world, mask, spec.left, spec.top, spec.right, spec.top, 2, spec.floorTex);
  carveSafeLine(world, mask, spec.right, spec.top, spec.right, spec.bottom, 2, spec.floorTex);
  carveSafeLine(world, mask, spec.right, spec.bottom, spec.left, spec.bottom, 2, spec.floorTex);
  carveSafeLine(world, mask, spec.left, spec.bottom, spec.left, spec.top, 2, spec.floorTex);
}

function placeCommunalLoopMarkers(world: World, spec: CommunalServiceLoopSpec): void {
  const cx = Math.round((spec.left + spec.right) / 2);
  const cy = Math.round((spec.top + spec.bottom) / 2);
  if (spec.type === RoomType.KITCHEN) {
    setFeature(world, cx - 8, spec.top, Feature.STOVE);
    setFeature(world, cx + 8, spec.top, Feature.SINK);
    setFeature(world, cx, spec.bottom, Feature.TABLE);
    return;
  }
  if (spec.type === RoomType.BATHROOM) {
    setFeature(world, cx, spec.top, Feature.SINK);
    setFeature(world, spec.right, cy, Feature.TOILET);
    const ci = world.idx(cx, spec.bottom);
    if (world.cells[ci] === Cell.FLOOR) {
      world.cells[ci] = Cell.WATER;
      world.floorTex[ci] = Tex.F_WATER;
    }
    return;
  }
  if (spec.type === RoomType.STORAGE) {
    setFeature(world, spec.left, cy, Feature.SHELF);
    setFeature(world, spec.right, cy, Feature.SHELF);
    setFeature(world, cx, spec.bottom, Feature.TABLE);
    return;
  }
  if (spec.type === RoomType.PRODUCTION) {
    setFeature(world, spec.left, cy, Feature.MACHINE);
    setFeature(world, cx, spec.top, Feature.SINK);
    setFeature(world, spec.right, cy, Feature.APPARATUS);
    return;
  }
  if (spec.type === RoomType.SMOKING) {
    setFeature(world, spec.left, cy, Feature.CHAIR);
    setFeature(world, cx, spec.top, Feature.CANDLE);
    setFeature(world, spec.right, cy, Feature.TABLE);
    return;
  }
  if (spec.type === RoomType.COMMON) {
    setFeature(world, spec.left, cy, Feature.TABLE);
    setFeature(world, cx, spec.top, Feature.CHAIR);
    setFeature(world, spec.right, cy, Feature.LAMP);
  }
}

function addCommunalServiceShafts(world: World, mask: Uint8Array): void {
  const shafts: [number, number, number, number][] = [
    [56, 220, 380, 220],
    [644, 284, 968, 284],
    [212, 644, 212, 968],
    [812, 56, 812, 380],
    [140, 812, 388, 812],
    [636, 720, 884, 720],
  ];
  for (const [ax, ay, bx, by] of shafts) {
    carveSafeLine(world, mask, ax, ay, bx, by, 1, Tex.F_CONCRETE);
    setFeature(world, ax, ay, Feature.APPARATUS);
    setFeature(world, bx, by, Feature.LAMP);
  }
}

function addCommunalBottlenecks(world: World, mask: Uint8Array, wallTex: Tex): void {
  addHorizontalPinch(world, mask, 248, 56, 4, 2, wallTex);
  addHorizontalPinch(world, mask, 696, 884, 4, 1, wallTex);
  addHorizontalPinch(world, mask, 396, 260, 4, 1, wallTex);
  addHorizontalPinch(world, mask, 612, 764, 4, 2, wallTex);
  addVerticalPinch(world, mask, 56, 628, 4, 1, wallTex);
  addVerticalPinch(world, mask, 884, 356, 4, 2, wallTex);
  addVerticalPinch(world, mask, 260, 436, 4, 2, wallTex);
  addVerticalPinch(world, mask, 764, 596, 4, 1, wallTex);
}

function addHorizontalPinch(world: World, mask: Uint8Array, x: number, y: number, width: number, gapOffset: number, wallTex: Tex): void {
  for (let dy = 0; dy < width; dy++) if (dy !== gapOffset) setCommunalWall(world, mask, x, y + dy, wallTex);
}

function addVerticalPinch(world: World, mask: Uint8Array, x: number, y: number, width: number, gapOffset: number, wallTex: Tex): void {
  for (let dx = 0; dx < width; dx++) if (dx !== gapOffset) setCommunalWall(world, mask, x + dx, y, wallTex);
}

function setCommunalWall(world: World, mask: Uint8Array, x: number, y: number, wallTex: Tex): void {
  const ci = world.idx(x, y);
  if (mask[ci] || world.cells[ci] !== Cell.FLOOR) return;
  world.cells[ci] = Cell.WALL;
  world.roomMap[ci] = -1;
  world.wallTex[ci] = wallTex;
  world.features[ci] = Feature.NONE;
}

function addCommunalMicroRoomBands(world: World, mask: Uint8Array, rng: () => number, s: FloorStyle): void {
  const rings = [132, 252, 372, 456] as const;
  const sides: CommunalSide[] = ['north', 'east', 'south', 'west'];
  for (const radius of rings) {
    const step = radius === 132 ? 28 : radius === 252 ? 32 : 36;
    for (let offset = -radius + 34; offset <= radius - 34; offset += step) {
      for (let si = 0; si < sides.length; si++) {
        const side = sides[si];
        const noise = Math.floor(rng() * 9) - 4;
        const type = COMMUNAL_MICRO_TYPES[(radius + offset + si * 3 + COMMUNAL_MICRO_TYPES.length * 16) % COMMUNAL_MICRO_TYPES.length];
        addCommunalMicroRoom(world, mask, rng, s, communalMicroRoomSpec(side, radius, offset + noise, false, type, rng));
        if (radius !== 132 && (Math.abs(offset) > 58 || radius >= 372)) {
          const innerType = COMMUNAL_MICRO_TYPES[(radius + offset + si * 5 + 3 + COMMUNAL_MICRO_TYPES.length * 16) % COMMUNAL_MICRO_TYPES.length];
          addCommunalMicroRoom(world, mask, rng, s, communalMicroRoomSpec(side, radius, offset - noise, true, innerType, rng));
        }
      }
    }
  }
}

function communalMicroRoomSpec(
  side: CommunalSide,
  radius: number,
  offset: number,
  inward: boolean,
  type: RoomType,
  rng: () => number,
): CommunalMicroRoomSpec {
  const horizontal = side === 'north' || side === 'south';
  const size = communalMicroRoomSize(type, horizontal, rng);
  const ringWidth = radius === 132 ? 3 : 4;
  const gap = 5 + Math.floor(rng() * 4);
  const center = 512 + offset;
  if (side === 'north') {
    const targetY = 512 - radius + 1;
    return {
      type,
      x: Math.round(center - size.w / 2),
      y: inward ? 512 - radius + ringWidth + gap : 512 - radius - gap - size.h,
      w: size.w,
      h: size.h,
      doorSide: inward ? 'north' : 'south',
      targetX: Math.round(center),
      targetY,
    };
  }
  if (side === 'south') {
    const targetY = 512 + radius + 1;
    return {
      type,
      x: Math.round(center - size.w / 2),
      y: inward ? 512 + radius - gap - size.h : 512 + radius + ringWidth + gap,
      w: size.w,
      h: size.h,
      doorSide: inward ? 'south' : 'north',
      targetX: Math.round(center),
      targetY,
    };
  }
  if (side === 'west') {
    const targetX = 512 - radius + 1;
    return {
      type,
      x: inward ? 512 - radius + ringWidth + gap : 512 - radius - gap - size.w,
      y: Math.round(center - size.h / 2),
      w: size.w,
      h: size.h,
      doorSide: inward ? 'west' : 'east',
      targetX,
      targetY: Math.round(center),
    };
  }
  const targetX = 512 + radius + 1;
  return {
    type,
    x: inward ? 512 + radius - gap - size.w : 512 + radius + ringWidth + gap,
    y: Math.round(center - size.h / 2),
    w: size.w,
    h: size.h,
    doorSide: inward ? 'east' : 'west',
    targetX,
    targetY: Math.round(center),
  };
}

function communalMicroRoomSize(type: RoomType, horizontal: boolean, rng: () => number): { w: number; h: number } {
  const along = 7 + Math.floor(rng() * 5);
  const across = 5 + Math.floor(rng() * 3);
  let w = horizontal ? along : across;
  let h = horizontal ? across : along;
  if (type === RoomType.KITCHEN || type === RoomType.BATHROOM) {
    w += horizontal ? 2 : 1;
    h += horizontal ? 1 : 2;
  } else if (type === RoomType.COMMON || type === RoomType.LIVING) {
    w += 1;
    h += 1;
  }
  return { w, h };
}

function addCommunalMicroRoom(
  world: World,
  mask: Uint8Array,
  rng: () => number,
  s: FloorStyle,
  spec: CommunalMicroRoomSpec,
): boolean {
  if (!canPlaceCommunalRoom(world, mask, spec.x, spec.y, spec.w, spec.h)) return false;
  const room = addRoom(
    world,
    spec.type,
    spec.x,
    spec.y,
    spec.w,
    spec.h,
    communalMicroRoomName(spec.type),
    communalWallTex(spec.type, s),
    communalFloorTex(spec.type, s),
  );
  decorateCommunalMicroRoom(world, room, rng);
  return connectCommunalRoomToCorridor(world, mask, room, spec.doorSide, spec.targetX, spec.targetY, DoorState.CLOSED);
}

function communalMicroRoomName(type: RoomType): string {
  switch (type) {
    case RoomType.KITCHEN: return 'Микрокухня между коридорами';
    case RoomType.BATHROOM: return 'Микросанузел между коридорами';
    case RoomType.STORAGE: return 'Кладовка между коридорами';
    case RoomType.SMOKING: return 'Курительная ниша между коридорами';
    case RoomType.OFFICE: return 'Кабинет жалоб между коридорами';
    case RoomType.COMMON: return 'Общая микрокомната';
    default: return 'Тесная проходная комната';
  }
}

function communalWallTex(type: RoomType, s: FloorStyle): Tex {
  if (type === RoomType.BATHROOM || type === RoomType.KITCHEN || type === RoomType.MEDICAL) return Tex.TILE_W;
  if (type === RoomType.PRODUCTION) return Tex.PIPE;
  if (type === RoomType.HQ) return Tex.HERMO_WALL;
  return s.wallTex;
}

function communalFloorTex(type: RoomType, s: FloorStyle): Tex {
  if (type === RoomType.BATHROOM || type === RoomType.KITCHEN || type === RoomType.MEDICAL) return Tex.F_TILE;
  if (type === RoomType.STORAGE || type === RoomType.PRODUCTION || type === RoomType.HQ) return Tex.F_CONCRETE;
  if (type === RoomType.LIVING) return Tex.F_WOOD;
  return s.floorTex;
}

function decorateCommunalMicroRoom(world: World, room: Room, rng: () => number): void {
  switch (room.type) {
    case RoomType.KITCHEN:
      setFeature(world, room.x + 2, room.y + 2, Feature.STOVE);
      setFeature(world, room.x + room.w - 3, room.y + 2, Feature.SINK);
      setFeature(world, room.x + (room.w >> 1), room.y + room.h - 3, Feature.TABLE);
      break;
    case RoomType.BATHROOM:
      setFeature(world, room.x + 2, room.y + 2, Feature.TOILET);
      setFeature(world, room.x + room.w - 3, room.y + 2, Feature.SINK);
      break;
    case RoomType.STORAGE:
      setFeature(world, room.x + 2, room.y + 2, Feature.SHELF);
      setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.SHELF);
      break;
    case RoomType.OFFICE:
      setFeature(world, room.x + 2, room.y + 2, Feature.DESK);
      setFeature(world, room.x + room.w - 3, room.y + 2, Feature.SCREEN);
      break;
    case RoomType.SMOKING:
      setFeature(world, room.x + 2, room.y + 2, Feature.CHAIR);
      setFeature(world, room.x + room.w - 3, room.y + 2, Feature.CANDLE);
      break;
    case RoomType.MEDICAL:
      setFeature(world, room.x + 2, room.y + 2, Feature.SINK);
      setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.SHELF);
      break;
    default:
      setFeature(world, room.x + 2, room.y + 2, Feature.BED);
      setFeature(world, room.x + room.w - 3, room.y + room.h - 3, rng() < 0.55 ? Feature.TABLE : Feature.SHELF);
      break;
  }
}

function addCommunalHqCompounds(world: World, mask: Uint8Array): void {
  for (const compound of COMMUNAL_HQ_COMPOUNDS) {
    carveSafeLine(world, mask, compound.hall[0], compound.hall[1], compound.hall[2], compound.hall[3], 2, Tex.F_CONCRETE);
    for (const spec of compound.rooms) {
      if (!canPlaceCommunalRoom(world, mask, spec.x, spec.y, spec.w, spec.h)) continue;
      const room = addRoom(
        world,
        spec.type,
        spec.x,
        spec.y,
        spec.w,
        spec.h,
        spec.name,
        spec.type === RoomType.HQ ? Tex.HERMO_WALL : communalWallTex(spec.type, { wallTex: Tex.PANEL, floorTex: Tex.F_LINO, faction: ZoneFaction.CITIZEN, danger: 2 }),
        communalFloorTex(spec.type, { wallTex: Tex.PANEL, floorTex: Tex.F_LINO, faction: ZoneFaction.CITIZEN, danger: 2 }),
      );
      paintCommunalRoomTerritory(world, room, compound.owner);
      if (spec.type === RoomType.HQ) hardenCommunalHqShell(world, room, compound.owner);
      else decorateCommunalMicroRoom(world, room, () => 0.5);
      connectCommunalRoomToCorridor(
        world,
        mask,
        room,
        spec.doorSide,
        spec.targetX,
        spec.targetY,
        spec.type === RoomType.HQ ? DoorState.HERMETIC_CLOSED : DoorState.CLOSED,
      );
    }
  }
  world.markWallTexDirty();
  world.markFeaturesDirty(false);
}

function connectCommunalRoomToCorridor(
  world: World,
  mask: Uint8Array,
  room: Room,
  side: CommunalRoomDoorSide,
  targetX: number,
  targetY: number,
  state: DoorState,
  keyId = '',
): boolean {
  let doorX = room.x + (room.w >> 1);
  let doorY = room.y + (room.h >> 1);
  let outX = doorX;
  let outY = doorY;
  if (side === 'north') {
    doorY = room.y - 1;
    outY = doorY - 1;
  } else if (side === 'south') {
    doorY = room.y + room.h;
    outY = doorY + 1;
  } else if (side === 'west') {
    doorX = room.x - 1;
    outX = doorX - 1;
  } else {
    doorX = room.x + room.w;
    outX = doorX + 1;
  }
  if (side === 'north' || side === 'south') outX = doorX;
  else outY = doorY;

  const doorIdx = world.idx(doorX, doorY);
  if (mask[doorIdx] || world.cells[doorIdx] === Cell.LIFT) return false;
  world.cells[doorIdx] = Cell.DOOR;
  world.wallTex[doorIdx] = state === DoorState.HERMETIC_CLOSED || state === DoorState.HERMETIC_OPEN ? Tex.HERMO_WALL : Tex.DOOR_WOOD;
  world.floorTex[doorIdx] = room.floorTex;
  world.factionControl[doorIdx] = world.factionControl[world.idx(room.x + (room.w >> 1), room.y + (room.h >> 1))];
  world.doors.set(doorIdx, {
    idx: doorIdx,
    state,
    roomA: room.id,
    roomB: -1,
    keyId,
    timer: 0,
  });
  room.doors.push(doorIdx);
  carveSafeLine(world, mask, outX, outY, targetX, targetY, 1, room.floorTex);
  return true;
}

function connectCommunalRoomToCorridorLoose(
  world: World,
  room: Room,
  side: CommunalRoomDoorSide,
  targetX: number,
  targetY: number,
  state: DoorState,
): boolean {
  let doorX = room.x + (room.w >> 1);
  let doorY = room.y + (room.h >> 1);
  let outX = doorX;
  let outY = doorY;
  if (side === 'north') {
    doorY = room.y - 1;
    outY = doorY - 1;
  } else if (side === 'south') {
    doorY = room.y + room.h;
    outY = doorY + 1;
  } else if (side === 'west') {
    doorX = room.x - 1;
    outX = doorX - 1;
  } else {
    doorX = room.x + room.w;
    outX = doorX + 1;
  }
  if (side === 'north' || side === 'south') outX = doorX;
  else outY = doorY;

  const doorIdx = world.idx(doorX, doorY);
  if (world.cells[doorIdx] === Cell.LIFT) return false;
  world.cells[doorIdx] = Cell.DOOR;
  world.wallTex[doorIdx] = state === DoorState.HERMETIC_CLOSED || state === DoorState.HERMETIC_OPEN ? Tex.HERMO_WALL : Tex.DOOR_WOOD;
  world.floorTex[doorIdx] = room.floorTex;
  world.factionControl[doorIdx] = world.factionControl[world.idx(room.x + (room.w >> 1), room.y + (room.h >> 1))];
  world.doors.set(doorIdx, {
    idx: doorIdx,
    state,
    roomA: room.id,
    roomB: -1,
    keyId: '',
    timer: 0,
  });
  room.doors.push(doorIdx);
  carveLine(world, outX, outY, targetX, targetY, 1, room.floorTex);
  return true;
}

function paintCommunalRoomTerritory(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[idx] === room.id) world.factionControl[idx] = owner;
    }
  }
  for (const idx of room.doors) world.factionControl[idx] = owner;
}

function hardenCommunalHqShell(world: World, room: Room, owner: TerritoryOwner): void {
  room.sealed = true;
  room.wallTex = Tex.HERMO_WALL;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      const interior = dx >= 0 && dx < room.w && dy >= 0 && dy < room.h;
      if (interior) {
        if (world.roomMap[idx] === room.id) world.factionControl[idx] = owner;
        continue;
      }
      if (world.cells[idx] !== Cell.WALL && world.cells[idx] !== Cell.DOOR) continue;
      world.hermoWall[idx] = 1;
      world.wallTex[idx] = Tex.HERMO_WALL;
    }
  }
  setFeature(world, room.x + 2, room.y + 2, Feature.SCREEN);
  setFeature(world, room.x + room.w - 3, room.y + 2, Feature.SHELF);
  setFeature(world, room.x + (room.w >> 1), room.y + room.h - 3, Feature.TABLE);
}

function reinforceCommunalRingAuthoredHqTerritory(world: World): void {
  for (const room of world.rooms) {
    if (room.type !== RoomType.HQ) continue;
    if (communalAuthoredOwnerForRoomName(room.name) !== undefined) continue;
    demoteCommunalFallbackHq(world, room);
  }

  const roomByName = new Map<string, Room>();
  for (const room of world.rooms) {
    if (room.name && !roomByName.has(room.name)) {
      roomByName.set(room.name, room);
    }
  }

  for (const compound of COMMUNAL_HQ_COMPOUNDS) {
    for (const spec of compound.rooms) {
      const room = roomByName.get(spec.name);
      if (!room) continue;
      room.type = spec.type;
      room.sealed = spec.type === RoomType.HQ;
      room.wallTex = spec.type === RoomType.HQ ? Tex.HERMO_WALL : communalWallTex(spec.type, { wallTex: Tex.PANEL, floorTex: Tex.F_LINO, faction: ZoneFaction.CITIZEN, danger: 2 });
      room.floorTex = communalFloorTex(spec.type, { wallTex: Tex.PANEL, floorTex: Tex.F_LINO, faction: ZoneFaction.CITIZEN, danger: 2 });
      paintCommunalRoomTerritory(world, room, compound.owner);
      if (spec.type === RoomType.HQ) {
        hardenCommunalHqShell(world, room, compound.owner);
        if (room.doors.length === 0) {
          connectCommunalRoomToCorridorLoose(world, room, spec.doorSide, spec.targetX, spec.targetY, DoorState.HERMETIC_CLOSED);
        }
        for (const idx of room.doors) {
          const door = world.doors.get(idx);
          if (door) door.state = DoorState.HERMETIC_CLOSED;
          world.wallTex[idx] = Tex.HERMO_WALL;
          world.factionControl[idx] = compound.owner;
        }
      } else if (room.doors.length === 0) {
        connectCommunalRoomToCorridorLoose(world, room, spec.doorSide, spec.targetX, spec.targetY, DoorState.CLOSED);
      }
    }
  }
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFeaturesDirty(false);
}

const COMMUNAL_AUTHORED_OWNER_MAP = new Map<string, TerritoryOwner>();
for (const compound of COMMUNAL_HQ_COMPOUNDS) {
  for (const room of compound.rooms) {
    if (room.type === RoomType.HQ) {
      COMMUNAL_AUTHORED_OWNER_MAP.set(room.name, compound.owner);
    }
  }
}

function communalAuthoredOwnerForRoomName(name: string): TerritoryOwner | undefined {
  return COMMUNAL_AUTHORED_OWNER_MAP.get(name);
}

function demoteCommunalFallbackHq(world: World, room: Room): void {
  room.type = demotedCommunalRoomType(room.name);
  room.sealed = false;
  room.wallTex = communalWallTex(room.type, { wallTex: Tex.PANEL, floorTex: Tex.F_LINO, faction: ZoneFaction.CITIZEN, danger: 2 });
  room.floorTex = communalFloorTex(room.type, { wallTex: Tex.PANEL, floorTex: Tex.F_LINO, faction: ZoneFaction.CITIZEN, danger: 2 });
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      const interior = dx >= 0 && dx < room.w && dy >= 0 && dy < room.h;
      if (interior) {
        if (world.roomMap[idx] === room.id) world.floorTex[idx] = room.floorTex;
        continue;
      }
      if (world.cells[idx] !== Cell.WALL && world.cells[idx] !== Cell.DOOR) continue;
      world.hermoWall[idx] = 0;
      world.wallTex[idx] = room.wallTex;
    }
  }
}

function demotedCommunalRoomType(name: string): RoomType {
  if (name.includes('Клад') || name.includes('клад') || name.includes('Паёч')) return RoomType.STORAGE;
  if (name.includes('душ') || name.includes('Душ') || name.includes('сан')) return RoomType.BATHROOM;
  if (name.includes('кух') || name.includes('Кух')) return RoomType.KITCHEN;
  if (name.includes('кур') || name.includes('Кур')) return RoomType.SMOKING;
  if (name.includes('НИИ') || name.includes('кабин') || name.includes('Кабин')) return RoomType.OFFICE;
  return RoomType.COMMON;
}

function expandServiceFloor(generation: FloorGeneration, rng: () => number, s: FloorStyle): void {
  expandServiceFloorMachineMaze(generation.world, rng, s, generation.entities);
}

type UnderhellDoorSide = 'north' | 'south' | 'west' | 'east';

interface UnderhellLineSpec {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  width: number;
  floorTex: Tex;
  owner: TerritoryOwner;
}

interface UnderhellStationSpec {
  x: number;
  y: number;
  owner: TerritoryOwner;
  type: RoomType;
  name: string;
  radius: number;
}

interface UnderhellHqCompoundSpec {
  owner: TerritoryOwner;
  corridor: readonly [number, number, number, number];
  route: readonly [number, number, number, number];
  core: readonly [number, number, number, number, string];
  supportPrefix: string;
}

interface UnderhellMicroRowSpec {
  label: string;
  owner: TerritoryOwner;
  horizontal: boolean;
  corridor: number;
  start: number;
  end: number;
  side: -1 | 1;
  step: number;
}

const UNDERHELL_RIB_LINES: readonly UnderhellLineSpec[] = [
  { ax: 76, ay: 168, bx: 944, by: 168, width: 3, floorTex: Tex.F_CONCRETE, owner: ZoneFaction.LIQUIDATOR },
  { ax: 92, ay: 304, bx: 928, by: 304, width: 2, floorTex: Tex.F_GUT, owner: ZoneFaction.CULTIST },
  { ax: 64, ay: 448, bx: 960, by: 448, width: 3, floorTex: Tex.F_MEAT, owner: ZoneFaction.WILD },
  { ax: 96, ay: 608, bx: 928, by: 608, width: 3, floorTex: Tex.F_GUT, owner: ZoneFaction.CULTIST },
  { ax: 80, ay: 760, bx: 944, by: 760, width: 3, floorTex: Tex.F_CONCRETE, owner: ZoneFaction.WILD },
  { ax: 104, ay: 904, bx: 920, by: 904, width: 2, floorTex: Tex.F_VOID, owner: ZoneFaction.SAMOSBOR },
  { ax: 112, ay: 112, bx: 112, by: 916, width: 2, floorTex: Tex.F_CONCRETE, owner: ZoneFaction.CITIZEN },
  { ax: 256, ay: 96, bx: 256, by: 928, width: 2, floorTex: Tex.F_GUT, owner: ZoneFaction.CULTIST },
  { ax: 416, ay: 112, bx: 416, by: 916, width: 2, floorTex: Tex.F_MEAT, owner: ZoneFaction.WILD },
  { ax: 576, ay: 96, bx: 576, by: 928, width: 2, floorTex: Tex.F_GUT, owner: ZoneFaction.CULTIST },
  { ax: 736, ay: 112, bx: 736, by: 916, width: 2, floorTex: Tex.F_CONCRETE, owner: ZoneFaction.LIQUIDATOR },
  { ax: 896, ay: 96, bx: 896, by: 928, width: 2, floorTex: Tex.F_MEAT, owner: ZoneFaction.WILD },
];

const UNDERHELL_HQ_COMPOUNDS: readonly UnderhellHqCompoundSpec[] = [
  {
    owner: ZoneFaction.CITIZEN,
    corridor: [96, 224, 240, 224],
    route: [240, 224, 256, 304],
    core: [144, 196, 30, 14, 'Гражданский гермокор нижнего пайка'],
    supportPrefix: 'Гражданский нижний паек',
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    corridor: [704, 224, 900, 224],
    route: [736, 224, 736, 168],
    core: [784, 194, 34, 15, 'Гермопост ликвидаторов у мясного ребра'],
    supportPrefix: 'Пост ликвидаторов мясного ребра',
  },
  {
    owner: ZoneFaction.SCIENTIST,
    corridor: [72, 560, 238, 560],
    route: [238, 560, 256, 608],
    core: [128, 532, 30, 14, 'Скрытая НИИ-камера пропускника'],
    supportPrefix: 'НИИ-камера пропускника',
  },
  {
    owner: ZoneFaction.WILD,
    corridor: [732, 812, 932, 812],
    route: [896, 812, 896, 760],
    core: [816, 784, 34, 15, 'Разбитый гермокор диких снизу'],
    supportPrefix: 'Дикий нижний разворот',
  },
  {
    owner: ZoneFaction.CULTIST,
    corridor: [234, 812, 430, 812],
    route: [256, 812, 256, 760],
    core: [306, 784, 36, 16, 'Культовый гермокор списка крови'],
    supportPrefix: 'Культовый список крови',
  },
  {
    owner: ZoneFaction.CULTIST,
    corridor: [592, 656, 760, 656],
    route: [576, 656, 576, 608],
    core: [646, 626, 34, 15, 'Второй культовый пост нижней пошлины'],
    supportPrefix: 'Вторая нижняя пошлина',
  },
];

const UNDERHELL_STATIONS: readonly UnderhellStationSpec[] = [
  { x: 112, y: 168, owner: ZoneFaction.CITIZEN, type: RoomType.COMMON, name: 'Корневая станция пайка', radius: 34 },
  { x: 256, y: 168, owner: ZoneFaction.CULTIST, type: RoomType.STORAGE, name: 'Кладовая свечных ребер', radius: 32 },
  { x: 416, y: 168, owner: ZoneFaction.LIQUIDATOR, type: RoomType.OFFICE, name: 'Пост счета проходящих', radius: 34 },
  { x: 576, y: 168, owner: ZoneFaction.CULTIST, type: RoomType.COMMON, name: 'Передняя мокрого журнала', radius: 36 },
  { x: 736, y: 168, owner: ZoneFaction.LIQUIDATOR, type: RoomType.STORAGE, name: 'Оружейный зуб верхнего ребра', radius: 34 },
  { x: 896, y: 168, owner: ZoneFaction.WILD, type: RoomType.SMOKING, name: 'Дымный зуб верхней скобы', radius: 30 },
  { x: 112, y: 304, owner: ZoneFaction.SCIENTIST, type: RoomType.OFFICE, name: 'НИИ-пульт нижнего давления', radius: 32 },
  { x: 256, y: 304, owner: ZoneFaction.CULTIST, type: RoomType.PRODUCTION, name: 'Станция мокрой печати', radius: 38 },
  { x: 416, y: 304, owner: ZoneFaction.WILD, type: RoomType.STORAGE, name: 'Свалочная кладовая ребра', radius: 34 },
  { x: 736, y: 304, owner: ZoneFaction.CULTIST, type: RoomType.COMMON, name: 'Культовый обходной зуб', radius: 40 },
  { x: 896, y: 304, owner: ZoneFaction.WILD, type: RoomType.COMMON, name: 'Дикий боковой судок', radius: 36 },
  { x: 112, y: 448, owner: ZoneFaction.WILD, type: RoomType.STORAGE, name: 'Слепой склад мясной кромки', radius: 36 },
  { x: 256, y: 448, owner: ZoneFaction.CULTIST, type: RoomType.SMOKING, name: 'Курилка свидетелей снизу', radius: 34 },
  { x: 416, y: 448, owner: ZoneFaction.CULTIST, type: RoomType.PRODUCTION, name: 'Печь мелкой пошлины', radius: 38 },
  { x: 576, y: 448, owner: ZoneFaction.CULTIST, type: RoomType.COMMON, name: 'Передняя трех оплат сбоку', radius: 40 },
  { x: 736, y: 448, owner: ZoneFaction.LIQUIDATOR, type: RoomType.OFFICE, name: 'Караульная боковой скобы', radius: 34 },
  { x: 896, y: 448, owner: ZoneFaction.WILD, type: RoomType.STORAGE, name: 'Пошлинная боковая скоба', radius: 36 },
  { x: 112, y: 608, owner: ZoneFaction.SCIENTIST, type: RoomType.MEDICAL, name: 'Медкомната кислого мяса', radius: 32 },
  { x: 256, y: 608, owner: ZoneFaction.WILD, type: RoomType.COMMON, name: 'Лагерь у нижнего ребра', radius: 38 },
  { x: 416, y: 608, owner: ZoneFaction.CULTIST, type: RoomType.STORAGE, name: 'Архив липкой платы', radius: 36 },
  { x: 576, y: 608, owner: ZoneFaction.CULTIST, type: RoomType.PRODUCTION, name: 'Станция крови и корешков', radius: 42 },
  { x: 736, y: 608, owner: ZoneFaction.WILD, type: RoomType.STORAGE, name: 'Разорванная кладовая снизу', radius: 36 },
  { x: 896, y: 608, owner: ZoneFaction.WILD, type: RoomType.COMMON, name: 'Дикий общий костер', radius: 38 },
  { x: 112, y: 760, owner: ZoneFaction.WILD, type: RoomType.SMOKING, name: 'Обратный карниз стоянки', radius: 36 },
  { x: 256, y: 760, owner: ZoneFaction.CULTIST, type: RoomType.PRODUCTION, name: 'Нижняя свечная мойка', radius: 40 },
  { x: 416, y: 760, owner: ZoneFaction.WILD, type: RoomType.STORAGE, name: 'Кладовая костяной проволоки', radius: 36 },
  { x: 576, y: 760, owner: ZoneFaction.CULTIST, type: RoomType.COMMON, name: 'Середина нижнего списка', radius: 42 },
  { x: 736, y: 760, owner: ZoneFaction.WILD, type: RoomType.PRODUCTION, name: 'Разборочный низовой станок', radius: 38 },
  { x: 896, y: 760, owner: ZoneFaction.WILD, type: RoomType.COMMON, name: 'Нижний костяной разворот', radius: 40 },
  { x: 256, y: 904, owner: ZoneFaction.SAMOSBOR, type: RoomType.STORAGE, name: 'Самосборная слепая кладовая', radius: 34 },
  { x: 576, y: 904, owner: ZoneFaction.SAMOSBOR, type: RoomType.PRODUCTION, name: 'Мясной рубец самосбора', radius: 42 },
  { x: 896, y: 904, owner: ZoneFaction.SAMOSBOR, type: RoomType.COMMON, name: 'Ложный выход к Пустоте', radius: 40 },
];

const UNDERHELL_MICRO_ROWS: readonly UnderhellMicroRowSpec[] = [
  { label: 'верхний шкаф ликвидаторов', owner: ZoneFaction.LIQUIDATOR, horizontal: true, corridor: 168, start: 132, end: 884, side: -1, step: 34 },
  { label: 'верхняя культовая ячейка', owner: ZoneFaction.CULTIST, horizontal: true, corridor: 168, start: 160, end: 856, side: 1, step: 38 },
  { label: 'ребро малой платы', owner: ZoneFaction.CULTIST, horizontal: true, corridor: 304, start: 116, end: 892, side: -1, step: 36 },
  { label: 'дикая полка свидетелей', owner: ZoneFaction.WILD, horizontal: true, corridor: 448, start: 112, end: 900, side: 1, step: 34 },
  { label: 'нижняя культовая ниша', owner: ZoneFaction.CULTIST, horizontal: true, corridor: 608, start: 140, end: 876, side: -1, step: 36 },
  { label: 'нижний дикий шкаф', owner: ZoneFaction.WILD, horizontal: true, corridor: 760, start: 120, end: 904, side: 1, step: 34 },
  { label: 'самосборный карман', owner: ZoneFaction.SAMOSBOR, horizontal: true, corridor: 904, start: 156, end: 880, side: -1, step: 42 },
  { label: 'западный пайковый чулан', owner: ZoneFaction.CITIZEN, horizontal: false, corridor: 112, start: 190, end: 732, side: -1, step: 42 },
  { label: 'западная культовая камера', owner: ZoneFaction.CULTIST, horizontal: false, corridor: 256, start: 190, end: 884, side: 1, step: 38 },
  { label: 'средняя дикая кладовая', owner: ZoneFaction.WILD, horizontal: false, corridor: 416, start: 190, end: 884, side: -1, step: 38 },
  { label: 'средняя культовая будка', owner: ZoneFaction.CULTIST, horizontal: false, corridor: 576, start: 190, end: 884, side: 1, step: 38 },
  { label: 'восточный караул', owner: ZoneFaction.LIQUIDATOR, horizontal: false, corridor: 736, start: 190, end: 732, side: -1, step: 42 },
  { label: 'восточная дикая ниша', owner: ZoneFaction.WILD, horizontal: false, corridor: 896, start: 190, end: 884, side: 1, step: 38 },
];

function expandUnderhell(world: World, entities: Entity[], rng: () => number): void {
  const specs = [
    { x: 146, y: 146, w: 38, h: 24, r: 34, name: 'Остров бездонной кости' },
    { x: 360, y: 104, w: 34, h: 22, r: 30, name: 'Корневой верхний уступ' },
    { x: 620, y: 118, w: 42, h: 24, r: 36, name: 'Пустая плита моста' },
    { x: 842, y: 204, w: 36, h: 26, r: 32, name: 'Сторожевой бетонный зуб' },
    { x: 884, y: 452, w: 34, h: 28, r: 31, name: 'Пошлинная боковая скоба' },
    { x: 820, y: 722, w: 44, h: 24, r: 37, name: 'Нижний костяной разворот' },
    { x: 604, y: 864, w: 42, h: 26, r: 38, name: 'Ложный выход к Пустоте' },
    { x: 368, y: 852, w: 34, h: 24, r: 30, name: 'Плита отступления' },
    { x: 142, y: 742, w: 40, h: 25, r: 35, name: 'Обратный карниз' },
    { x: 104, y: 496, w: 36, h: 24, r: 32, name: 'Слепой боковой мост' },
    { x: 210, y: 308, w: 34, h: 23, r: 31, name: 'Остров старого ребра' },
    { x: 724, y: 340, w: 36, h: 24, r: 32, name: 'Культовый обходной зуб' },
  ];
  const points: Point[] = [];
  for (const spec of specs) {
    const x = spec.x + Math.floor((rng() - 0.5) * 12);
    const y = spec.y + Math.floor((rng() - 0.5) * 12);
    const cx = x + (spec.w >> 1);
    const cy = y + (spec.h >> 1);
    carveDisc(world, cx, cy, spec.r, Tex.F_MEAT);
    const room = addRoom(world, RoomType.COMMON, x, y, spec.w, spec.h, spec.name, Tex.MEAT, Tex.F_MEAT);
    points.push({ x: room.x + (room.w >> 1), y: room.y + (room.h >> 1) });
    for (let i = 0; i < 3; i++) {
      setFeature(world, room.x + 4 + Math.floor(rng() * Math.max(1, room.w - 8)), room.y + 3 + Math.floor(rng() * Math.max(1, room.h - 6)), rng() < 0.5 ? Feature.CANDLE : Feature.APPARATUS);
    }
  }

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    carveLine(world, a.x, a.y, b.x, b.y, i % 3 === 0 ? 2 : 1, i % 2 === 0 ? Tex.F_CONCRETE : Tex.F_GUT);
  }
  carveLine(world, 512, 500, points[10].x, points[10].y, 2, Tex.F_CONCRETE);
  carveLine(world, 512, 500, points[11].x, points[11].y, 2, Tex.F_GUT);
  carveLine(world, 512, 784, points[6].x, points[6].y, 2, Tex.F_CONCRETE);
  carveLine(world, 452, 716, points[8].x, points[8].y, 1, Tex.F_CONCRETE);
  addUnderhellRibLattice(world);
  addUnderhellHqCompounds(world);
  addUnderhellStations(world, rng);
  addUnderhellMicroRows(world, rng);
  sinkExpandedUnderhellAbyss(world);
  spawnAmbientMonsters(world, entities, rng, 64, [MonsterKind.SHADOW, MonsterKind.IDOL, MonsterKind.SPIRIT, MonsterKind.REBAR, MonsterKind.KOSTOREZ]);
}

function addUnderhellRibLattice(world: World): void {
  for (const line of UNDERHELL_RIB_LINES) {
    carveLine(world, line.ax, line.ay, line.bx, line.by, line.width, line.floorTex);
    paintUnderhellLineTerritory(world, line, line.owner);
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(line.bx - line.ax), Math.abs(line.by - line.ay)) / 72));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = Math.round(line.ax + (line.bx - line.ax) * t);
      const y = Math.round(line.ay + (line.by - line.ay) * t);
      setFeature(world, x, y, i % 3 === 0 ? Feature.LAMP : Feature.CANDLE);
    }
  }
  for (let i = 0; i < UNDERHELL_RIB_LINES.length; i += 2) {
    const a = UNDERHELL_RIB_LINES[i];
    const b = UNDERHELL_RIB_LINES[(i + 5) % UNDERHELL_RIB_LINES.length];
    carveLine(world, a.ax, a.ay, b.bx, b.by, 1, i % 4 === 0 ? Tex.F_VOID : Tex.F_GUT);
  }
}

function addUnderhellHqCompounds(world: World): void {
  for (const compound of UNDERHELL_HQ_COMPOUNDS) {
    const [cx1, cy1, cx2, cy2] = compound.corridor;
    const [rx1, ry1, rx2, ry2] = compound.route;
    carveLine(world, cx1, cy1, cx2, cy2, 2, Tex.F_CONCRETE);
    carveLine(world, rx1, ry1, rx2, ry2, 2, Tex.F_CONCRETE);
    paintUnderhellRectTerritory(world, Math.min(cx1, cx2) - 4, Math.min(cy1, cy2) - 4, Math.abs(cx2 - cx1) + 9, Math.abs(cy2 - cy1) + 9, compound.owner);
    const [x, y, w, h, name] = compound.core;
    const core = addUnderhellConnectedRoom(world, RoomType.HQ, x, y, w, h, name, compound.owner, Tex.HERMO_WALL, Tex.F_CONCRETE, cx1 + ((cx2 - cx1) >> 1), cy1 + ((cy2 - cy1) >> 1), DoorState.HERMETIC_CLOSED);
    if (core) hardenUnderhellHqCore(world, core, compound.owner);
    const support = underhellSupportRooms(compound, core);
    for (const spec of support) {
      const room = addUnderhellConnectedRoom(world, spec.type, spec.x, spec.y, spec.w, spec.h, spec.name, compound.owner, underhellWallTex(spec.type), underhellFloorTex(spec.type), spec.targetX, spec.targetY, DoorState.CLOSED);
      if (room) decorateUnderhellRoom(world, room);
    }
  }
}

function underhellSupportRooms(compound: UnderhellHqCompoundSpec, core: Room | null): {
  type: RoomType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  targetX: number;
  targetY: number;
}[] {
  const [cx1, cy1, cx2, cy2] = compound.corridor;
  const yOffset = core && core.y < cy1 ? 8 : -20;
  const roomY = cy1 + yOffset;
  const prefix = compound.supportPrefix;
  return [
    { type: RoomType.KITCHEN, name: `${prefix}: кухня`, x: cx1 + 8, y: roomY, w: 24, h: 11, targetX: cx1 + 18, targetY: cy1 },
    { type: RoomType.STORAGE, name: `${prefix}: склад`, x: cx2 - 34, y: roomY, w: 24, h: 11, targetX: cx2 - 18, targetY: cy2 },
    { type: RoomType.MEDICAL, name: `${prefix}: медниша`, x: (core?.x ?? cx1 + 46) - 30, y: core?.y ?? roomY, w: 22, h: 10, targetX: cx1 + ((cx2 - cx1) >> 1), targetY: cy1 },
    { type: RoomType.OFFICE, name: `${prefix}: журнал`, x: (core?.x ?? cx1 + 46) + (core?.w ?? 30) + 8, y: core?.y ?? roomY, w: 22, h: 10, targetX: cx1 + ((cx2 - cx1) >> 1), targetY: cy1 },
    { type: RoomType.COMMON, name: `${prefix}: общая`, x: cx1 + Math.max(18, Math.floor((cx2 - cx1) / 2) - 12), y: roomY + (yOffset > 0 ? 16 : -14), w: 28, h: 11, targetX: cx1 + ((cx2 - cx1) >> 1), targetY: cy1 },
  ];
}

function addUnderhellStations(world: World, rng: () => number): void {
  for (const spec of UNDERHELL_STATIONS) {
    carveDisc(world, spec.x, spec.y, spec.radius, underhellFloorTex(spec.type));
    paintUnderhellTerritoryPatch(world, spec.x, spec.y, spec.radius + 4, spec.owner);
    const w = 24 + Math.floor(rng() * 10);
    const h = 12 + Math.floor(rng() * 6);
    const room = addUnderhellConnectedRoom(
      world,
      spec.type,
      spec.x - (w >> 1),
      spec.y - (h >> 1),
      w,
      h,
      spec.name,
      spec.owner,
      underhellWallTex(spec.type),
      underhellFloorTex(spec.type),
      nearestUnderhellRibCoord(spec.x),
      nearestUnderhellRibCoord(spec.y),
      DoorState.CLOSED,
    );
    if (room) {
      decorateUnderhellRoom(world, room);
      addUnderhellStationSideRooms(world, rng, room, spec.owner);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rng() * 0.32;
      const px = spec.x + Math.round(Math.cos(a) * (spec.radius - 6));
      const py = spec.y + Math.round(Math.sin(a) * (spec.radius - 6));
      setFeature(world, px, py, rng() < 0.6 ? Feature.CANDLE : Feature.SHELF);
    }
  }
}

function addUnderhellStationSideRooms(world: World, rng: () => number, room: Room, owner: TerritoryOwner): void {
  const centerX = room.x + (room.w >> 1);
  const centerY = room.y + (room.h >> 1);
  const specs = [
    { type: RoomType.STORAGE, x: room.x - 18, y: centerY - 5, w: 12, h: 9, tx: room.x - 2, ty: centerY },
    { type: RoomType.BATHROOM, x: room.x + room.w + 6, y: centerY - 5, w: 11, h: 9, tx: room.x + room.w + 1, ty: centerY },
    { type: RoomType.OFFICE, x: centerX - 7, y: room.y - 16, w: 14, h: 9, tx: centerX, ty: room.y - 2 },
    { type: RoomType.COMMON, x: centerX - 8, y: room.y + room.h + 7, w: 16, h: 10, tx: centerX, ty: room.y + room.h + 1 },
  ];
  for (let i = 0; i < specs.length; i++) {
    if (rng() < 0.18) continue;
    const spec = specs[i];
    const side = addUnderhellConnectedRoom(world, spec.type, spec.x, spec.y, spec.w, spec.h, underhellMicroName(spec.type, `боковая ${i + 1}`), owner, underhellWallTex(spec.type), underhellFloorTex(spec.type), spec.tx, spec.ty, DoorState.CLOSED);
    if (side) decorateUnderhellRoom(world, side);
  }
}

function addUnderhellMicroRows(world: World, rng: () => number): void {
  for (const row of UNDERHELL_MICRO_ROWS) {
    let serial = 0;
    for (let p = row.start; p <= row.end; p += row.step) {
      if (rng() < 0.14) continue;
      const type = underhellMicroType(row.owner, serial++);
      const horizontal = row.horizontal;
      const along = 8 + Math.floor(rng() * 5);
      const across = 6 + Math.floor(rng() * 4);
      const w = horizontal ? along : across;
      const h = horizontal ? across : along;
      const gap = 5 + Math.floor(rng() * 4);
      const x = horizontal ? p - (w >> 1) : row.corridor + row.side * gap + (row.side < 0 ? -w : 0);
      const y = horizontal ? row.corridor + row.side * gap + (row.side < 0 ? -h : 0) : p - (h >> 1);
      const targetX = horizontal ? p : row.corridor;
      const targetY = horizontal ? row.corridor : p;
      const room = addUnderhellConnectedRoom(world, type, x, y, w, h, `${row.label}: ${underhellMicroName(type, `${serial}`)}`, row.owner, underhellWallTex(type), underhellFloorTex(type), targetX, targetY, DoorState.CLOSED);
      if (room) decorateUnderhellRoom(world, room);
    }
  }
}

function reinforceUnderhellAuthoredHqTerritory(world: World): void {
  for (const room of world.rooms) {
    const owner = underhellAuthoredHqOwner(room.name);
    if (owner === undefined) continue;
    room.type = RoomType.HQ;
    recarveUnderhellHqInterior(world, room, owner);
    paintUnderhellRoomTerritory(world, room, owner);
    hardenUnderhellHqCore(world, room, owner);
    for (const idx of room.doors) {
      const door = world.doors.get(idx);
      if (door) door.state = DoorState.HERMETIC_CLOSED;
      world.factionControl[idx] = owner;
      world.hermoWall[idx] = 1;
      world.wallTex[idx] = Tex.HERMO_WALL;
    }
  }
  world.markWallTexDirty();
  world.markFeaturesDirty(false);
}

function underhellAuthoredHqOwner(name: string): TerritoryOwner | undefined {
  if (name === 'Пост трех оплат' || name === 'Культовая пошлинная палата' || name === 'Палата якоря') return ZoneFaction.CULTIST;
  for (const compound of UNDERHELL_HQ_COMPOUNDS) {
    if (name === compound.core[4]) return compound.owner;
  }
  return undefined;
}

function recarveUnderhellHqInterior(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      world.cells[idx] = Cell.FLOOR;
      world.roomMap[idx] = room.id;
      world.floorTex[idx] = room.floorTex;
      world.wallTex[idx] = 0;
      world.features[idx] = Feature.NONE;
      world.factionControl[idx] = owner;
    }
  }
  if (room.doors.length === 0) {
    connectUnderhellRoomToPoint(world, room, nearestUnderhellRibCoord(room.x + (room.w >> 1)), nearestUnderhellRibCoord(room.y + (room.h >> 1)), DoorState.HERMETIC_CLOSED);
  }
}

function nearestUnderhellRibCoord(value: number): number {
  const ribs = [112, 168, 256, 304, 416, 448, 576, 608, 736, 760, 896, 904];
  let best = ribs[0];
  let bestDist = Math.abs(value - best);
  for (let i = 1; i < ribs.length; i++) {
    const dist = Math.abs(value - ribs[i]);
    if (dist < bestDist) {
      best = ribs[i];
      bestDist = dist;
    }
  }
  return best;
}

function addUnderhellConnectedRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  owner: TerritoryOwner,
  wallTex: Tex,
  floorTex: Tex,
  targetX: number,
  targetY: number,
  state: DoorState,
): Room | null {
  if (!canPlaceUnderhellRoom(world, x, y, w, h)) return null;
  const room = addRoom(world, type, x, y, w, h, name, wallTex, floorTex);
  paintUnderhellRoomTerritory(world, room, owner);
  connectUnderhellRoomToPoint(world, room, targetX, targetY, state);
  paintUnderhellRoomTerritory(world, room, owner);
  paintUnderhellTerritoryPatch(world, room.x + (room.w >> 1), room.y + (room.h >> 1), Math.max(room.w, room.h) + 3, owner);
  return room;
}

function canPlaceUnderhellRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  if (x < 6 || y < 6 || x + w >= W - 6 || y + h >= W - 6) return false;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const idx = world.idx(x + dx, y + dy);
      if (world.cells[idx] === Cell.LIFT || world.doors.has(idx) || world.containerMap.has(idx)) return false;
      const interior = dx >= 0 && dx < w && dy >= 0 && dy < h;
      if (interior && world.roomMap[idx] >= 0) return false;
    }
  }
  return true;
}

function connectUnderhellRoomToPoint(world: World, room: Room, targetX: number, targetY: number, state: DoorState): void {
  const side = underhellDoorSideToward(world, room, targetX, targetY);
  let doorX = room.x + (room.w >> 1);
  let doorY = room.y + (room.h >> 1);
  let outX = doorX;
  let outY = doorY;
  if (side === 'north') {
    doorY = room.y - 1;
    outY = doorY - 1;
  } else if (side === 'south') {
    doorY = room.y + room.h;
    outY = doorY + 1;
  } else if (side === 'west') {
    doorX = room.x - 1;
    outX = doorX - 1;
  } else {
    doorX = room.x + room.w;
    outX = doorX + 1;
  }
  if (side === 'north' || side === 'south') outX = doorX;
  else outY = doorY;
  const doorIdx = world.idx(doorX, doorY);
  carveLine(world, outX, outY, targetX, targetY, 1, room.floorTex);
  world.cells[doorIdx] = Cell.DOOR;
  world.wallTex[doorIdx] = state === DoorState.HERMETIC_CLOSED || state === DoorState.HERMETIC_OPEN ? Tex.HERMO_WALL : Tex.DOOR_WOOD;
  world.floorTex[doorIdx] = room.floorTex;
  world.doors.set(doorIdx, { idx: doorIdx, state, roomA: room.id, roomB: -1, keyId: '', timer: 0 });
  if (!room.doors.includes(doorIdx)) room.doors.push(doorIdx);
  if (state === DoorState.HERMETIC_CLOSED || state === DoorState.HERMETIC_OPEN) world.hermoWall[doorIdx] = 1;
  reinforceUnderhellDoorSlot(world, side, doorX, doorY, state);
}

function underhellDoorSideToward(world: World, room: Room, targetX: number, targetY: number): UnderhellDoorSide {
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  const dx = world.delta(cx, targetX);
  const dy = world.delta(cy, targetY);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}

function hardenUnderhellHqCore(world: World, room: Room, owner: TerritoryOwner): void {
  room.type = RoomType.HQ;
  room.sealed = true;
  room.wallTex = Tex.HERMO_WALL;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      const interior = dx >= 0 && dx < room.w && dy >= 0 && dy < room.h;
      if (interior) {
        if (world.roomMap[idx] === room.id) world.factionControl[idx] = owner;
        continue;
      }
      if (world.cells[idx] !== Cell.WALL && world.cells[idx] !== Cell.DOOR) continue;
      world.hermoWall[idx] = 1;
      world.wallTex[idx] = Tex.HERMO_WALL;
    }
  }
  setFeature(world, room.x + 2, room.y + 2, Feature.SCREEN);
  setFeature(world, room.x + room.w - 3, room.y + 2, Feature.SHELF);
  setFeature(world, room.x + (room.w >> 1), room.y + room.h - 3, Feature.TABLE);
}

function reinforceUnderhellDoorSlot(world: World, side: UnderhellDoorSide, doorX: number, doorY: number, state: DoorState): void {
  const wallTex = state === DoorState.HERMETIC_CLOSED || state === DoorState.HERMETIC_OPEN ? Tex.HERMO_WALL : Tex.MEAT;
  const flank = side === 'north' || side === 'south'
    ? [[-1, 0], [1, 0]] as const
    : [[0, -1], [0, 1]] as const;
  for (const [dx, dy] of flank) {
    const idx = world.idx(doorX + dx, doorY + dy);
    if (world.cells[idx] === Cell.LIFT) continue;
    world.cells[idx] = Cell.WALL;
    world.wallTex[idx] = wallTex;
    world.features[idx] = Feature.NONE;
    if (wallTex === Tex.HERMO_WALL) world.hermoWall[idx] = 1;
  }
}

function underhellMicroType(owner: TerritoryOwner, serial: number): RoomType {
  const cult = [RoomType.STORAGE, RoomType.SMOKING, RoomType.COMMON, RoomType.PRODUCTION, RoomType.BATHROOM] as const;
  const wild = [RoomType.STORAGE, RoomType.SMOKING, RoomType.COMMON, RoomType.BATHROOM, RoomType.PRODUCTION] as const;
  const liquidator = [RoomType.STORAGE, RoomType.OFFICE, RoomType.COMMON, RoomType.MEDICAL, RoomType.BATHROOM] as const;
  const scientist = [RoomType.OFFICE, RoomType.MEDICAL, RoomType.STORAGE, RoomType.PRODUCTION, RoomType.BATHROOM] as const;
  const citizen = [RoomType.KITCHEN, RoomType.COMMON, RoomType.STORAGE, RoomType.BATHROOM, RoomType.MEDICAL] as const;
  const samosbor = [RoomType.STORAGE, RoomType.PRODUCTION, RoomType.CORRIDOR, RoomType.SMOKING] as const;
  const list =
    owner === ZoneFaction.CULTIST ? cult
      : owner === ZoneFaction.WILD ? wild
        : owner === ZoneFaction.LIQUIDATOR ? liquidator
          : owner === ZoneFaction.SCIENTIST ? scientist
            : owner === ZoneFaction.SAMOSBOR ? samosbor
              : citizen;
  return list[serial % list.length];
}

function underhellWallTex(type: RoomType): Tex {
  if (type === RoomType.HQ) return Tex.HERMO_WALL;
  if (type === RoomType.BATHROOM || type === RoomType.KITCHEN || type === RoomType.MEDICAL) return Tex.TILE_W;
  if (type === RoomType.PRODUCTION) return Tex.GUT;
  if (type === RoomType.OFFICE) return Tex.PANEL;
  return Tex.MEAT;
}

function underhellFloorTex(type: RoomType): Tex {
  if (type === RoomType.BATHROOM || type === RoomType.KITCHEN || type === RoomType.MEDICAL) return Tex.F_TILE;
  if (type === RoomType.OFFICE || type === RoomType.HQ) return Tex.F_CONCRETE;
  if (type === RoomType.PRODUCTION) return Tex.F_GUT;
  if (type === RoomType.CORRIDOR) return Tex.F_VOID;
  return Tex.F_MEAT;
}

function underhellMicroName(type: RoomType, suffix: string): string {
  switch (type) {
    case RoomType.KITCHEN: return `микрокухня ${suffix}`;
    case RoomType.BATHROOM: return `микросанузел ${suffix}`;
    case RoomType.MEDICAL: return `медниша ${suffix}`;
    case RoomType.OFFICE: return `журнал ${suffix}`;
    case RoomType.PRODUCTION: return `мокрый станок ${suffix}`;
    case RoomType.SMOKING: return `курилка ${suffix}`;
    case RoomType.COMMON: return `общая будка ${suffix}`;
    default: return `кладовая ${suffix}`;
  }
}

function decorateUnderhellRoom(world: World, room: Room): void {
  if (room.type === RoomType.KITCHEN) {
    setFeature(world, room.x + 2, room.y + 2, Feature.STOVE);
    setFeature(world, room.x + room.w - 3, room.y + 2, Feature.SINK);
    setFeature(world, room.x + (room.w >> 1), room.y + room.h - 3, Feature.TABLE);
  } else if (room.type === RoomType.BATHROOM) {
    setFeature(world, room.x + 2, room.y + 2, Feature.TOILET);
    setFeature(world, room.x + room.w - 3, room.y + 2, Feature.SINK);
  } else if (room.type === RoomType.MEDICAL) {
    setFeature(world, room.x + 2, room.y + 2, Feature.SINK);
    setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.SHELF);
  } else if (room.type === RoomType.OFFICE) {
    setFeature(world, room.x + 2, room.y + 2, Feature.DESK);
    setFeature(world, room.x + room.w - 3, room.y + 2, Feature.SCREEN);
  } else if (room.type === RoomType.PRODUCTION) {
    setFeature(world, room.x + 2, room.y + 2, Feature.MACHINE);
    setFeature(world, room.x + room.w - 3, room.y + 2, Feature.APPARATUS);
  } else if (room.type === RoomType.SMOKING) {
    setFeature(world, room.x + 2, room.y + 2, Feature.CHAIR);
    setFeature(world, room.x + room.w - 3, room.y + 2, Feature.CANDLE);
  } else {
    setFeature(world, room.x + 2, room.y + 2, Feature.SHELF);
    setFeature(world, room.x + room.w - 3, room.y + room.h - 3, Feature.TABLE);
  }
}

function paintUnderhellLineTerritory(world: World, line: UnderhellLineSpec, owner: TerritoryOwner): void {
  let x = line.ax;
  let y = line.ay;
  const sx = line.bx === line.ax ? 0 : line.bx > line.ax ? 1 : -1;
  const sy = line.by === line.ay ? 0 : line.by > line.ay ? 1 : -1;
  while (x !== line.bx) {
    paintUnderhellTerritoryPatch(world, x, y, line.width + 2, owner);
    x += sx;
  }
  while (y !== line.by) {
    paintUnderhellTerritoryPatch(world, x, y, line.width + 2, owner);
    y += sy;
  }
  paintUnderhellTerritoryPatch(world, x, y, line.width + 2, owner);
}

function paintUnderhellRectTerritory(world: World, x: number, y: number, w: number, h: number, owner: TerritoryOwner): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const idx = world.idx(x + dx, y + dy);
      if (world.cells[idx] === Cell.ABYSS || world.cells[idx] === Cell.LIFT) continue;
      world.factionControl[idx] = owner;
    }
  }
}

function paintUnderhellTerritoryPatch(world: World, x: number, y: number, radius: number, owner: TerritoryOwner): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const idx = world.idx(x + dx, y + dy);
      if (world.cells[idx] === Cell.ABYSS || world.cells[idx] === Cell.LIFT) continue;
      world.factionControl[idx] = owner;
    }
  }
}

function paintUnderhellRoomTerritory(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[idx] === room.id) world.factionControl[idx] = owner;
    }
  }
  for (const idx of room.doors) world.factionControl[idx] = owner;
}

function sinkExpandedUnderhellAbyss(world: World): void {
  const mask = protectedMask(world);
  for (let i = 0; i < W * W; i++) {
    if (mask[i]) continue;
    const cell = world.cells[i];
    if (cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.LIFT) continue;
    world.cells[i] = Cell.ABYSS;
    world.roomMap[i] = -1;
    world.wallTex[i] = Tex.DARK;
    world.floorTex[i] = Tex.F_ABYSS;
    world.features[i] = Feature.NONE;
  }
}

function expandDarkness(world: World, entities: Entity[], rng: () => number): void {
  expandDarknessRouteGeometry(world, entities, rng);
}

function spawnAmbientMonsters(
  world: World,
  entities: Entity[],
  rng: () => number,
  count: number,
  kinds: MonsterKind[],
): void {
  let nextId = entities.reduce((mx, e) => Math.max(mx, e.id), 0) + 1;
  for (let i = 0; i < count; i++) {
    const p = randomFloorCell(world, rng);
    if (!p) break;
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const def = MONSTERS[kind];
    const monster: Entity = {
      id: nextId++,
      type: EntityType.MONSTER,
      x: p.x + 0.5,
      y: p.y + 0.5,
      angle: rng() * Math.PI * 2,
      pitch: 0,
      alive: true,
      speed: def.speed,
      sprite: monsterSpr(kind),
      hp: def.hp,
      maxHp: def.hp,
      monsterKind: kind,
      attackCd: 0,
      ai: { goal: AIGoal.WANDER, tx: p.x, ty: p.y, path: [], pi: 0, stuck: 0, timer: 0 },
      phasing: kind === MonsterKind.SPIRIT,
    };
    entities.push(monster);
  }
}
