/* ── Seeded combinatoric procedural floors ───────────────────── */

import { stampSurfaceSplat } from '../systems/surface_marks';
import {
  W,
  Cell,
  ContainerKind,
  DoorState,
  Feature,
  FloorLevel,
  LiftDirection,
  EntityType,
  AIGoal,
  Faction,
  MonsterKind,
  Occupation,
  RoomType,
  Tex,
  ZoneFaction,
  type Entity,
  type Item,
  type ItemDef,
  type RailTrainTrack,
  type Room,
  type TerritoryOwner,
  type ContainerAccess,
  type WorldContainer,
} from '../core/types';
import { World } from '../core/world';
import { withSeededRandom, xorshift32 } from '../core/rand';
import { ITEMS, NOTES, freshNeeds, randomName } from '../data/catalog';
import { ITEM_TAGS, getStack, spawnCount } from '../data/items';
import { CONTAINER_DEFS, containerKindsForRoom } from '../data/container_defs';
import { proceduralContainerValueCap as economyProceduralContainerValueCap } from '../data/economics';
import { emergencyPanelDefsForGeometry, type EmergencyPanelDef } from '../data/emergency_panels';
import { factionToTerritoryOwner, territoryOwnerName, territoryOwnerToFaction } from '../data/factions';
import { chooseFloorMonsterKind, getMonsterEcology } from '../data/monster_ecology';
import {
  proceduralPopulationBudget,
  proceduralPopulationProfileId,
} from '../data/population_profiles';
import {
  FACTORY_BY_ID,
  productionRewardTargetTags,
  productionRouteGoalTags,
  type FactoryDef,
  type FactoryRecipeDef,
} from '../data/factories';
import {
  FALSE_SAFE_BLOCK_ROOM_PREFIX,
  FALSE_SAFE_BLOCK_TAG,
  PROCEDURAL_LOOT_ANOMALY_KIND_BIAS,
  PROCEDURAL_LOOT_ANOMALY_TAGS,
  PROCEDURAL_LOOT_FACTION_KIND_BIAS,
  PROCEDURAL_LOOT_FACTION_TAGS,
  floorRunZAllowsNpcs,
  geometryById,
  majorityById,
  proceduralFloorAnomalyRoutePressure,
  proceduralFloorRoutePressureLevel,
  proceduralMonsterFloor,
  proceduralLootValueCap,
  type ProceduralFloorSpec,
  type FloorGeometryDef,
} from '../data/procedural_floors';
import { territorySharesForProceduralSpec } from '../data/floor_territory';
import { MONSTERS } from '../entities/monster';
import { monsterSpr, Spr } from '../render/sprite_index';
import { MarkType, stampMark } from '../systems/surface_marks';
import { setDoorState } from '../systems/door_state';
import {
  initializeCellTerritory,
  syncZoneMetadataFromTerritory,
  territoryOwnerAtIndex,
} from '../systems/territory';
import { gaussianLevel, getMaxHp, randomRPG } from '../systems/rpg';
import { canSpawnEntityType, entitySpawnSlots } from '../systems/entity_limits';
import { addRailTrainRoute } from '../systems/rail_trains';
import { registerRouteCue } from '../systems/route_cues';
import { placeEmergencyPanel } from '../systems/emergency_panels';
import { HLADON_COLD_SHELL_RADIUS } from '../systems/hladon';
import { relightBadAppleWorld } from '../systems/procedural_anomalies/bad_apple_world';
import {
  buildWalkablePlacementMap,
  canPlaceRoom,
  carveCorridor,
  connectToNetwork,
  connectRoomsMST,
  decorateRoom,
  ensureConnectivity,
  generateZones,
  isConnectivityWalkable,
  placeDoorAt,
  placeLifts,
  roomExit,
  sanitizeDoors,
  shapeRoom,
  stampRoom,
  type WalkablePlacementMap,
} from './shared';
import type { FloorGeneration } from './floor_manifest';
import { decorateCarnivorousFungusRoom } from './carnivorous_fungus_room';
import { applyProceduralFloorObjectProfile } from './floor_object_placement';
import { fillVisualSlotsForWorldFeatures } from './visual_cell_slots';
import { rebuildGeneratedFloorPathBlockers } from './path_blockers';
import { applyProceduralAnomalyProfile } from './procedural_anomalies';
import { applyProceduralStructureLibrary } from './procedural_structure_library';
import { ensureZombieApocalypseQuarantineDoor } from './procedural_anomalies/zombie_apocalypse';
import { removeNpcEntities } from './entity_filters';
import { registerProceduralAnomalyPlacement } from './procedural_anomalies/common';
import { sampleNaturalPopulationCells, type NaturalPopulationProfile, type PlacementFieldAnchor } from './population_placement';
import { measureAndRecordGeometryMetrics, type GeometryAnchor } from './geometry_metrics';
import { generateWilsonMaze, validateMazeGraph, type MazeGraph, type MazeGraphEdge, type MazeGraphNode } from './maze_graph';
import { placeDecisionTriangle } from './decision_triangles';
import { maybePlaceBrokenFixture } from './interactive_fixtures';
import {
  createProxyGrid,
  proxyIndex,
  proxySample01,
  worldToProxy,
  type ProxyGrid,
} from './proxy_grid';
import {
  executeRecipe,
  divideTorus,
  pickSectorStrategy,
  type RecipeContext,
  type ProceduralRecipeId,
  type RecipeRegion,
} from './procedural_geometry_recipes';

const EXCLUDE_GNILUSHKA = [MonsterKind.GNILUSHKA] as const;
const O15_ENGINEER_FLAMER_ID = 'o15_multijet_flamer';
const O15_ENGINEER_STASH_MIN_DEPTH = 30;
const LOSYASH_RIFLE_ID = 'losyash_rifle';
const RIFLE_BOLT_PACK_ID = 'rifle_bolt_pack';
const DEEP_RECON_STASH_MIN_DEPTH = 45;
const GRANIT4U_BELT_SHOTGUN_ID = 'granit4u_belt_shotgun';
const DEEP_LIQUIDATOR_REWARD_MIN_DEPTH = 45;
const WILD_MAJORITY_REWARD_TAG = 'wild_reward_leaf';
const WILD_MAJORITY_RISK_TAG = 'wild_risk_cue';
const WILD_MAJORITY_SHORTCUT_TAG = 'wild_unsafe_shortcut';
const WILD_MAJORITY_AMBUSH_TAG = 'wild_ambush_chord';
const WORKSHOP_CLUSTER_TARGET = 42;
const WORKSHOP_MICRO_ROOM_TARGET = 260;
const WORKSHOP_CLUSTER_MIN_SPACING = 24 * 24;
const COLLECTOR_PROXY_SIZE = 32;
const COLLECTOR_PROXY_CELL = W / COLLECTOR_PROXY_SIZE;
const COLLECTOR_VALVE_ROOM_PREFIX = 'Вентильная седловина';
const COLLECTOR_STATION_CLUSTER_TARGET = 44;
const COLLECTOR_STATION_MICRO_ROOM_TARGET = 210;
const COLLECTOR_STATION_CLUSTER_MIN_SPACING = 22 * 22;
const COLLECTOR_MIRROR_GALLERY_TARGET = 18;
const COLLECTOR_MIRROR_MICRO_ROOM_TARGET = 162;
const COLLECTOR_MIRROR_CLUSTER_MIN_SPACING = 34 * 34;
const COLLECTOR_REPAIR_ITEMS: readonly Item[] = [
  { defId: 'valve_tag', count: 1 },
  { defId: 'sealant_tube', count: 1 },
  { defId: 'metal_sheet', count: 1 },
];
const WORKSHOP_FACTORY_IDS = ['metal_shop', 'utility_room', 'illegal_ammo_smelter', 'armory_bench'] as const;
const ATTIC_PROXY_SIZE = 64;
const ATTIC_PROXY_CELL = W / ATTIC_PROXY_SIZE;
const ATTIC_SPINE_START = 42;
const ATTIC_SPINE_END = W - 43;
const ATTIC_MID_CLUSTER_TARGET = 18;
const ATTIC_MICRO_ROOM_TARGET = 72;
const ATTIC_LIVING_TUNNEL_MICRO_BONUS = 32;
const ATTIC_CLUSTER_MIN_SPACING = 42 * 42;
const PROCEDURAL_HQ_OWNERS = [
  ZoneFaction.CITIZEN,
  ZoneFaction.LIQUIDATOR,
  ZoneFaction.CULTIST,
  ZoneFaction.SCIENTIST,
  ZoneFaction.WILD,
] as const;
const ATTIC_HQ_OWNERS = PROCEDURAL_HQ_OWNERS;
const MYCELIUM_PROXY_SIZE = 64;
const MYCELIUM_PROXY_CELL = W / MYCELIUM_PROXY_SIZE;
const MYCELIUM_ROOM_PREFIX = 'Грибничный карман';
const ATTIC_DOCUMENT_CACHE_ITEMS: readonly Item[] = [
  { defId: 'blueprint_t2_folder', count: 1 },
  { defId: 'hermodoor_journal', count: 1 },
  { defId: 'filter_receipt', count: 2 },
  { defId: 'ministry_clean_stamp', count: 1 },
];
const ATTIC_REPAIR_CACHE_ITEMS: readonly Item[] = [
  { defId: 'vent_damper_plate', count: 1 },
  { defId: 'relay_diagram', count: 1 },
  { defId: 'wire_coil', count: 1 },
  { defId: 'duct_tape', count: 2 },
];
const ARCHIVE_WARREN_GRID = 15;
const ARCHIVE_WARREN_ORIGIN = 64;
const ARCHIVE_WARREN_CELL = 64;
const ARCHIVE_WARREN_KEY_ID = 'container_key_label';
const ARCHIVE_WARREN_MICRO_OFFSETS = [
  { dx: -22, dy: -22 },
  { dx: 18, dy: -22 },
  { dx: -22, dy: 18 },
  { dx: 18, dy: 18 },
] as const;
const ARCHIVE_WARREN_EDGE_ALCOVE_OFFSETS = [0.36, 0.64] as const;
const ARCHIVE_WARREN_HQ_OWNERS = [
  ZoneFaction.CITIZEN,
  ZoneFaction.LIQUIDATOR,
  ZoneFaction.CULTIST,
  ZoneFaction.SCIENTIST,
  ZoneFaction.WILD,
] as const;
const ARCHIVE_WARREN_HQ_TARGETS: Readonly<Record<TerritoryOwner, { gx: number; gy: number }>> = {
  [ZoneFaction.CITIZEN]: { gx: 7, gy: 7 },
  [ZoneFaction.LIQUIDATOR]: { gx: 2, gy: 2 },
  [ZoneFaction.CULTIST]: { gx: 12, gy: 12 },
  [ZoneFaction.SAMOSBOR]: { gx: 7, gy: 12 },
  [ZoneFaction.WILD]: { gx: 2, gy: 12 },
  [ZoneFaction.SCIENTIST]: { gx: 12, gy: 2 },
};
const ARCHIVE_WARREN_LANDMARK_NAMES = [
  'Портретная опись',
  'Клетка клерка',
  'Копировальная яма',
  'Шкаф печатей',
  'Окно жалоб',
  'Папочная биржа',
  'Стол отказов',
  'Картотека без лица',
] as const;
const SCIENTIST_SAMPLE_CACHE_ITEMS: readonly Item[] = [
  { defId: 'nii_sample_container', count: 1 },
  { defId: 'sterile_swab', count: 2 },
  { defId: 'sample_chain_form', count: 1 },
  { defId: 'gas_sample_ampoule', count: 1 },
];
const SCIENTIST_MEDICINE_CACHE_ITEMS: readonly Item[] = [
  { defId: 'antibiotic', count: 1 },
  { defId: 'bandage', count: 2 },
  { defId: 'clean_health_cert', count: 1 },
];
const SCIENTIST_OBSERVATION_CACHE_ITEMS: readonly Item[] = [
  { defId: 'sample_chain_form', count: 1 },
  { defId: 'nii_sample_label', count: 2 },
  { defId: 'official_quarantine_clearance', count: 1 },
];
const CULT_MAJORITY_RITUAL_TAG = 'cult_ritual_ring';
const CULT_MAJORITY_FALSE_SHELTER_TAG = 'cult_false_shelter';
const CULT_MAJORITY_TRIBUTE_GATE_TAG = 'cult_tribute_gate';
const CULT_MAJORITY_PHASE_BOUNDARY_TAG = 'cult_phase_boundary';
const CULT_MAJORITY_EVIDENCE_TAG = 'cult_evidence';
const SMOG_PROXY_SIZE = 64;
const SMOG_MAX_CELLS = 13_500;
const SMOG_COUNTERPLAY_DROPS = ['wet_rag_bundle', 'cloth_roll', 'gasmask_filter', 'filter_canister'] as const;
const WALL_SNAKE_FIELD_COLUMNS = 16;
const WALL_SNAKE_FIELD_ROWS = 8;
const WALL_SNAKE_FIELD_TARGET = WALL_SNAKE_FIELD_COLUMNS * WALL_SNAKE_FIELD_ROWS;
const WALL_SNAKE_MEAT_BLOCK_THRESHOLD = 0.57;
const WALL_SNAKE_SPHINCTER_GRID = 64;
const WALL_SNAKE_SPHINCTER_SEARCH = 18;
const WALL_SNAKE_CONNECT_MIN_COMPONENT = 1536;
const LIFE_FIELD_SAFE_ROOM_COUNT = 12;
const LIFE_FIELD_NOISE_DENSITY = 0.27;
const LIFE_FIELD_NOISE_BAND_BONUS = 0.08;

export interface CollectorDecisionMetrics {
  wetBasinCells: number;
  dryCausewayCells: number;
  repairCrossingCells: number;
  valveRoomCount: number;
  wetRouteLength: number;
  dryRouteLength: number;
  actualWetPathLength: number;
  actualDryPathLength: number;
  dryReachableUpLifts: number;
  dryReachableDownLifts: number;
  waterAdjacentLiftCount: number;
}

interface CollectorProxyField {
  height: Float32Array;
  flow: Uint16Array;
  basin: Int8Array;
  wet: Uint8Array;
  saddles: number[];
  basinCenters: { px: number; py: number }[];
}

interface CollectorMetricsDraft {
  wetCells: Set<number>;
  dryCausewayCells: Set<number>;
  repairCrossingCells: Set<number>;
  valveRoomIds: number[];
  wetRouteLength: number;
  dryRouteLength: number;
}

const collectorDecisionMetricsByWorld = new WeakMap<World, CollectorDecisionMetrics>();
const collectorDraftMetricsByWorld = new WeakMap<World, CollectorMetricsDraft>();

interface WorkshopNetwork {
  loopRooms: Room[];
  toolRooms: Room[];
  factoryRooms: Room[];
  dockLoopCount: number;
  toolChordCount: number;
}

interface ArchiveWarrenIntent {
  graph: MazeGraph;
  roomsByNode: Room[];
  microRoomsByNode: Room[][];
  landmarkAnchors: GeometryAnchor[];
  keyDropRoomIds: number[];
}

const archiveWarrenIntents = new WeakMap<World, ArchiveWarrenIntent>();

interface AtticTensorField {
  cos: Float32Array;
  sin: Float32Array;
}

interface AtticTrace {
  id: number;
  horizontal: boolean;
  cells: number[];
}

interface AtticJunction {
  x: number;
  y: number;
  score: number;
}

interface AtticWindLane {
  line: number;
  cells: number[];
  start: number;
  end: number;
}

function irng(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function chance(p: number): boolean {
  return Math.random() < p;
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function cloneItems(items: readonly Item[]): Item[] {
  return items.map(item => ({ ...item }));
}

function isIndustrialGeometry(id: ProceduralFloorSpec['geometryId']): boolean {
  return id === 'collectors'
    || id === 'workshops'
    || id === 'service_spines'
    || id === 'attic_weatherworks'
    || id === 'sump_causeways';
}

// @ts-expect-error TS6133 — preserved as reference; replaced by recipe system
function roomSize(type: RoomType, industrial: boolean): { w: number; h: number } {
  if (type === RoomType.CORRIDOR) {
    return chance(0.5)
      ? { w: irng(18, 42), h: irng(3, 5) }
      : { w: irng(3, 5), h: irng(18, 42) };
  }
  if (type === RoomType.PRODUCTION) return { w: irng(12, industrial ? 30 : 22), h: irng(9, industrial ? 24 : 18) };
  if (type === RoomType.COMMON) return { w: irng(10, 24), h: irng(8, 20) };
  if (type === RoomType.OFFICE) return { w: irng(7, 14), h: irng(6, 12) };
  if (type === RoomType.BATHROOM) return { w: irng(4, 7), h: irng(4, 7) };
  if (type === RoomType.KITCHEN) return { w: irng(5, 9), h: irng(5, 9) };
  return { w: irng(5, 12), h: irng(5, 11) };
}

interface ProceduralMacroProfile {
  hallCount: number;
  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
  trunkWidth: number;
  branchWidth: number;
  branchCount: number;
  namePrefix: string;
  hallTypes: readonly RoomType[];
  corridorFloorTex: Tex;
  corridorWallTex: Tex;
  featureStep: number;
  elongated?: 'horizontal' | 'vertical' | 'mixed';
}

interface ProceduralMacroLayer {
  profile: ProceduralMacroProfile;
  halls: Room[];
}

function proceduralMacroProfile(spec: ProceduralFloorSpec, industrial: boolean): ProceduralMacroProfile | null {
  const geom = geometryById(spec.geometryId);
  if (
    spec.geometryId === 'living_blocks'
    || spec.geometryId === 'archive_warrens'
    || spec.geometryId === 'apartment_pressure'
    || spec.geometryId === 'sump_causeways'
  ) return null;

  if (spec.geometryId === 'collectors') {
    return {
      hallCount: 6 + Math.floor(spec.danger / 2),
      minW: 24,
      maxW: 58,
      minH: 12,
      maxH: 30,
      trunkWidth: 2,
      branchWidth: 1,
      branchCount: 16,
      namePrefix: 'Насосный зал',
      hallTypes: [RoomType.PRODUCTION, RoomType.COMMON, RoomType.STORAGE],
      corridorFloorTex: Tex.F_CONCRETE,
      corridorWallTex: Tex.PIPE,
      featureStep: 23,
      elongated: 'mixed',
    };
  }
  if (spec.geometryId === 'workshops') {
    return {
      hallCount: 9 + Math.floor(spec.danger / 2),
      minW: 24,
      maxW: 56,
      minH: 16,
      maxH: 34,
      trunkWidth: 2,
      branchWidth: 1,
      branchCount: 22 + spec.danger * 2,
      namePrefix: 'Цеховой пролет',
      hallTypes: [RoomType.PRODUCTION, RoomType.PRODUCTION, RoomType.STORAGE],
      corridorFloorTex: Tex.F_CONCRETE,
      corridorWallTex: Tex.METAL,
      featureStep: 19,
      elongated: 'mixed',
    };
  }
  if (spec.geometryId === 'service_spines') {
    return {
      hallCount: 7,
      minW: 20,
      maxW: 54,
      minH: 9,
      maxH: 22,
      trunkWidth: 2,
      branchWidth: 1,
      branchCount: 30,
      namePrefix: 'Сервисный узел',
      hallTypes: [RoomType.CORRIDOR, RoomType.PRODUCTION, RoomType.STORAGE],
      corridorFloorTex: Tex.F_CONCRETE,
      corridorWallTex: Tex.METAL,
      featureStep: 17,
      elongated: 'mixed',
    };
  }
  if (spec.geometryId === 'attic_weatherworks') {
    return {
      hallCount: 5,
      minW: 26,
      maxW: 64,
      minH: 7,
      maxH: 17,
      trunkWidth: 1,
      branchWidth: 1,
      branchCount: 12,
      namePrefix: 'Ветровой короб',
      hallTypes: [RoomType.CORRIDOR, RoomType.PRODUCTION, RoomType.STORAGE],
      corridorFloorTex: Tex.F_CONCRETE,
      corridorWallTex: Tex.PIPE,
      featureStep: 13,
      elongated: 'horizontal',
    };
  }
  if (spec.geometryId === 'admin_pockets') {
    return {
      hallCount: 5,
      minW: 18,
      maxW: 42,
      minH: 12,
      maxH: 28,
      trunkWidth: 2,
      branchWidth: 1,
      branchCount: 12,
      namePrefix: 'Приемный зал',
      hallTypes: [RoomType.COMMON, RoomType.OFFICE, RoomType.STORAGE],
      corridorFloorTex: Tex.F_MARBLE_TILE,
      corridorWallTex: Tex.MARBLE,
      featureStep: 21,
    };
  }
  if (spec.geometryId === 'communal_knots') {
    return {
      hallCount: 6 + Math.floor(spec.danger / 2),
      minW: 18,
      maxW: 44,
      minH: 12,
      maxH: 28,
      trunkWidth: 2,
      branchWidth: 1,
      branchCount: 18 + spec.danger * 2,
      namePrefix: 'Общий тамбур',
      hallTypes: [RoomType.COMMON, RoomType.KITCHEN, RoomType.SMOKING],
      corridorFloorTex: Tex.F_LINO,
      corridorWallTex: Tex.BRICK,
      featureStep: 19,
    };
  }

  return {
    hallCount: industrial ? 6 : 5,
    minW: industrial ? 22 : 16,
    maxW: industrial ? 52 : 38,
    minH: industrial ? 12 : 10,
    maxH: industrial ? 28 : 24,
    trunkWidth: industrial ? 2 : 1,
    branchWidth: 1,
    branchCount: industrial ? 14 : 12,
    namePrefix: geom.tags.includes('residential') ? 'Большой общий зал' : 'Опорный зал',
    hallTypes: industrial
      ? [RoomType.PRODUCTION, RoomType.COMMON, RoomType.STORAGE]
      : [RoomType.COMMON, RoomType.LIVING, RoomType.KITCHEN],
    corridorFloorTex: geom.floorTex,
    corridorWallTex: geom.wallTex,
    featureStep: industrial ? 23 : 19,
  };
}

function macroRoomSize(profile: ProceduralMacroProfile, index: number): { w: number; h: number } {
  let w = irng(profile.minW, profile.maxW);
  let h = irng(profile.minH, profile.maxH);
  if (profile.elongated === 'horizontal' || (profile.elongated === 'mixed' && index % 2 === 0)) {
    w = Math.max(w, h + irng(12, 28));
    h = Math.min(h, irng(profile.minH, Math.max(profile.minH, profile.minH + 8)));
  } else if (profile.elongated === 'vertical' || (profile.elongated === 'mixed' && index % 2 === 1)) {
    h = Math.max(h, w + irng(10, 24));
    w = Math.min(w, irng(profile.minW, Math.max(profile.minW, profile.minW + 10)));
  }
  return {
    w: Math.max(8, Math.min(72, w)),
    h: Math.max(7, Math.min(48, h)),
  };
}

function decorateProceduralMacroHall(world: World, room: Room, spec: ProceduralFloorSpec, profile: ProceduralMacroProfile, serial: number): void {
  applyRoomTexture(world, room, profile.corridorWallTex, profile.corridorFloorTex);
  const center = roomCenter(room);
  const columnStrideX = Math.max(7, Math.min(13, Math.floor(room.w / 4)));
  const columnStrideY = Math.max(5, Math.min(11, Math.floor(room.h / 3)));

  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.cells[ci] !== Cell.FLOOR || world.roomMap[ci] !== room.id) continue;
      const nearCenter = Math.abs(room.x + dx - center.x) <= 2 && Math.abs(room.y + dy - center.y) <= 2;
      if (!nearCenter && room.w >= 18 && room.h >= 12 && dx % columnStrideX === 0 && dy % columnStrideY === 0 && ((dx + dy + serial) % 3) !== 0) {
        world.cells[ci] = Cell.WALL;
        world.wallTex[ci] = profile.corridorWallTex;
        continue;
      }
      if (world.features[ci] === Feature.NONE && ((dx * 17 + dy * 31 + serial + spec.seed) % profile.featureStep) === 0) {
        world.features[ci] = room.type === RoomType.PRODUCTION
          ? Feature.MACHINE
          : room.type === RoomType.OFFICE
            ? Feature.DESK
            : (serial + dx + dy) % 4 === 0 ? Feature.SCREEN : Feature.LAMP;
      }
    }
  }
  world.features[world.idx(center.x, center.y)] = room.type === RoomType.PRODUCTION ? Feature.APPARATUS : Feature.TABLE;
}

function tryPlaceMacroHall(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  nextRoomId: { v: number },
  profile: ProceduralMacroProfile,
  halls: Room[],
  usedSlots: Set<number>,
  cols: number,
  rows: number,
  slotW: number,
  slotH: number,
  margin: number,
  serial: number,
): boolean {
  for (let attempt = 0; attempt < 64; attempt++) {
    const slotCount = cols * rows;
    const slot = (serial * 5 + (spec.seed & 15) + attempt) % slotCount;
    if (usedSlots.has(slot) && attempt < slotCount) continue;
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    const size = macroRoomSize(profile, serial + attempt);
    const jitterX = irng(4, Math.max(5, slotW - size.w - 6));
    const jitterY = irng(4, Math.max(5, slotH - size.h - 6));
    const x = margin + col * slotW + jitterX;
    const y = margin + row * slotH + jitterY;
    if (!canPlaceRoom(world, x, y, size.w, size.h) && !canPlaceAtticSupportRoom(world, x, y, size.w, size.h)) continue;

    const type = profile.hallTypes[(serial + attempt + spec.danger) % profile.hallTypes.length];
    const room = stampRoom(world, nextRoomId.v++, type, x, y, size.w, size.h, -1);
    room.name = `${profile.namePrefix} ${serial + 1}`;
    decorateProceduralMacroHall(world, room, spec, profile, serial + 1);
    rooms.push(room);
    halls.push(room);
    usedSlots.add(slot);
    return true;
  }
  return false;
}

function buildProceduralMacroLayer(world: World, rooms: Room[], spec: ProceduralFloorSpec, nextRoomId: { v: number }, industrial: boolean): ProceduralMacroLayer | null {
  const profile = proceduralMacroProfile(spec, industrial);
  if (!profile) return null;

  const halls: Room[] = [];
  const cols = Math.max(2, Math.ceil(Math.sqrt(profile.hallCount * 1.45)));
  const rows = Math.max(2, Math.ceil(profile.hallCount / cols));
  const margin = 28;
  const slotW = Math.floor((W - margin * 2) / cols);
  const slotH = Math.floor((W - margin * 2) / rows);
  const usedSlots = new Set<number>();

  for (let serial = 0; serial < profile.hallCount; serial++) {
    tryPlaceMacroHall(
      world, rooms, spec, nextRoomId, profile, halls, usedSlots,
      cols, rows, slotW, slotH, margin, serial,
    );
  }

  return halls.length > 0 ? { profile, halls } : null;
}

function canOverwriteForMacroRoute(world: World, ci: number): boolean {
  if (world.cells[ci] === Cell.LIFT) return false;
  if (world.features[ci] === Feature.LIFT_BUTTON || world.hermoWall[ci] || world.aptMask[ci] || world.containerMap.has(ci)) return false;
  return true;
}

function carveProceduralMacroCell(
  world: World,
  x: number,
  y: number,
  profile: ProceduralMacroProfile,
  step: number,
  centerLine: boolean,
): boolean {
  const ci = world.idx(x, y);
  if (!canOverwriteForMacroRoute(world, ci)) return false;
  const before = world.cells[ci];
  if (before === Cell.DOOR) return false;
  if (before !== Cell.FLOOR && before !== Cell.WATER) {
    world.cells[ci] = Cell.FLOOR;
    world.roomMap[ci] = -1;
  }
  if (world.roomMap[ci] < 0) {
    world.floorTex[ci] = profile.corridorFloorTex;
    world.wallTex[ci] = profile.corridorWallTex;
  }
  if (centerLine && world.features[ci] === Feature.NONE && step > 0 && step % profile.featureStep === 0) {
    world.features[ci] = step % (profile.featureStep * 2) === 0 ? Feature.LAMP : Feature.APPARATUS;
  }
  return before !== world.cells[ci] || world.roomMap[ci] < 0;
}

function carveProceduralMacroSegment(
  world: World,
  profile: ProceduralMacroProfile,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  stepBase: number,
): number {
  const horizontal = Math.abs(world.delta(ax, bx)) >= Math.abs(world.delta(ay, by));
  const delta = horizontal ? world.delta(ax, bx) : world.delta(ay, by);
  const stepDir = delta >= 0 ? 1 : -1;
  const steps = Math.abs(delta);
  let x = world.wrap(ax);
  let y = world.wrap(ay);

  for (let s = 0; s <= steps; s++) {
    const step = stepBase + s;
    for (let side = -width; side <= width; side++) {
      if (horizontal) carveProceduralMacroCell(world, x, y + side, profile, step, side === 0);
      else carveProceduralMacroCell(world, x + side, y, profile, step, side === 0);
    }
    if (s < steps) {
      if (horizontal) x = world.wrap(x + stepDir);
      else y = world.wrap(y + stepDir);
    }
  }

  return stepBase + steps + 1;
}

function connectProceduralMacroPoints(
  world: World,
  profile: ProceduralMacroProfile,
  a: { x: number; y: number },
  b: { x: number; y: number },
  width: number,
  seed: number,
): void {
  const horizontalFirst = (seed & 1) === 0;
  let step = Math.abs(seed % 997);
  if (horizontalFirst) {
    step = carveProceduralMacroSegment(world, profile, a.x, a.y, b.x, a.y, width, step);
    carveProceduralMacroSegment(world, profile, b.x, a.y, b.x, b.y, width, step);
  } else {
    step = carveProceduralMacroSegment(world, profile, a.x, a.y, a.x, b.y, width, step);
    carveProceduralMacroSegment(world, profile, a.x, b.y, b.x, b.y, width, step);
  }
}

function roomMacroAnchor(world: World, room: Room, target: Room): { x: number; y: number } {
  const targetCenter = roomCenter(target);
  const exit = roomExit(world, room, targetCenter.x, targetCenter.y);
  placeDoorAt(world, exit.wx, exit.wy, room.id);
  return { x: exit.ox, y: exit.oy };
}

function macroRoomDistance(world: World, a: Room, b: Room): number {
  const ac = roomCenter(a);
  const bc = roomCenter(b);
  return world.dist(ac.x, ac.y, bc.x, bc.y);
}

function applyProceduralMacroNetwork(world: World, rooms: Room[], spec: ProceduralFloorSpec, layer: ProceduralMacroLayer | null, spawnX: number, spawnY: number): void {
  if (!layer || layer.halls.length === 0) return;
  const { profile, halls } = layer;
  const ordered = halls.slice().sort((a, b) => {
    const ac = roomCenter(a);
    const bc = roomCenter(b);
    const aa = Math.atan2(world.delta(spawnY, ac.y), world.delta(spawnX, ac.x));
    const ba = Math.atan2(world.delta(spawnY, bc.y), world.delta(spawnX, bc.x));
    return aa - ba;
  });

  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i];
    const b = ordered[(i + 1) % ordered.length];
    if (!a || !b || a.id === b.id) continue;
    connectProceduralMacroPoints(
      world,
      profile,
      roomMacroAnchor(world, a, b),
      roomMacroAnchor(world, b, a),
      profile.trunkWidth,
      spec.seed + i * 311,
    );
  }

  if (ordered.length >= 4) {
    for (let i = 0; i < Math.min(3, ordered.length); i++) {
      const a = ordered[i];
      const b = ordered[(i + Math.floor(ordered.length / 2)) % ordered.length];
      if (!a || !b || a.id === b.id) continue;
      connectProceduralMacroPoints(
        world,
        profile,
        roomMacroAnchor(world, a, b),
        roomMacroAnchor(world, b, a),
        Math.max(1, profile.trunkWidth - 1),
        spec.seed ^ (0x5100 + i * 971),
      );
    }
  }

  const hallIds = new Set(halls.map(room => room.id));
  const localRooms = rooms.filter(room => !hallIds.has(room.id) && room.w >= 4 && room.h >= 4);
  for (let i = 0; i < profile.branchCount && localRooms.length > 0; i++) {
    const hall = halls[i % halls.length];
    const candidates = localRooms
      .map((room, idx) => ({ room, d: macroRoomDistance(world, hall, room), idx }))
      .sort((a, b) => a.d - b.d);
    const picked = candidates[(spec.seed + i * 7) % Math.min(candidates.length, 6)];
    if (!picked) continue;
    localRooms.splice(picked.idx, 1);
    connectProceduralMacroPoints(
      world,
      profile,
      roomMacroAnchor(world, hall, picked.room),
      roomMacroAnchor(world, picked.room, hall),
      profile.branchWidth,
      spec.seed ^ (0xb41 + i * 101),
    );
  }

  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  if (first && last) {
    const firstCenter = roomCenter(first);
    const lastCenter = roomCenter(last);
    registerRouteCue(world, {
      id: `procedural_${spec.key}_macro_spine`,
      x: firstCenter.x + 0.5,
      y: firstCenter.y + 0.5,
      targetX: lastCenter.x + 0.5,
      targetY: lastCenter.y + 0.5,
      floor: spec.baseFloor,
      roomId: first.id,
      targetRoomId: last.id,
      zoneId: world.zoneMap[world.idx(firstCenter.x, firstCenter.y)],
      label: 'широкая магистраль',
      hint: 'крупные залы связаны широким ходом, локальные комнаты уходят ветками',
      targetName: last.name,
      color: '#9ec8d8',
      tags: ['procedural_floor', 'macro_spine', 'multi_scale', spec.geometryId, spec.majorityId],
      toneSeed: (spec.seed ^ 0x5ca1e) >>> 0,
      radius: 12,
      targetRadius: 5,
      cooldownSec: 60,
      heardText: 'За стеной слышен широкий проход: гул идет не из комнаты, а из целой магистрали.',
      followedText: 'Широкая магистраль вывела к другому масштабу этажа.',
      ignoredText: 'Магистраль осталась сбоку, мелкие двери снова забрали внимание.',
    });
  }

  world.markCellsDirty();
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFeaturesDirty(true);
}

function applyRoomTexture(world: World, room: Room, wallTex: Tex, floorTex: Tex): void {
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const i = world.idx(room.x + dx, room.y + dy);
      if (world.cells[i] === Cell.WALL) world.wallTex[i] = wallTex;
    }
  }
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      world.floorTex[world.idx(room.x + dx, room.y + dy)] = floorTex;
    }
  }
}

function decorateProceduralRoom(world: World, room: Room, spec: ProceduralFloorSpec): void {
  const industrial = isIndustrialGeometry(spec.geometryId);
  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      if (Math.random() > 0.025) continue;
      const i = world.idx(room.x + dx, room.y + dy);
      if (world.cells[i] !== Cell.FLOOR) continue;
      if (room.type === RoomType.PRODUCTION) world.features[i] = industrial ? Feature.MACHINE : Feature.TABLE;
      else if (room.type === RoomType.KITCHEN) world.features[i] = chance(0.5) ? Feature.STOVE : Feature.SINK;
      else if (room.type === RoomType.BATHROOM) world.features[i] = chance(0.5) ? Feature.TOILET : Feature.SINK;
      else if (room.type === RoomType.OFFICE) world.features[i] = chance(0.5) ? Feature.DESK : Feature.SHELF;
      else if (room.type === RoomType.STORAGE) world.features[i] = Feature.SHELF;
      else if (chance(0.25)) world.features[i] = Feature.LAMP;
      maybePlaceBrokenFixture(world, room.x + dx, room.y + dy, { salt: room.id * 37 + dx * 7 + dy });
    }
  }
}

function workshopMicroRoomSize(type: RoomType, seed: number): { w: number; h: number } {
  const n = seed >>> 0;
  if (type === RoomType.BATHROOM) return { w: 4 + (n & 1), h: 4 + ((n >>> 1) & 1) };
  if (type === RoomType.KITCHEN) return { w: 5 + (n % 3), h: 5 + ((n >>> 2) % 3) };
  if (type === RoomType.OFFICE) return { w: 6 + (n % 5), h: 5 + ((n >>> 3) % 4) };
  if (type === RoomType.STORAGE) return { w: 5 + (n % 6), h: 5 + ((n >>> 4) % 5) };
  if (type === RoomType.PRODUCTION) return { w: 9 + (n % 8), h: 7 + ((n >>> 5) % 6) };
  return { w: 7 + (n % 7), h: 5 + ((n >>> 6) % 5) };
}

function workshopSupportRoomName(type: RoomType, id: number, cluster: number): string {
  if (type === RoomType.BATHROOM) return `Цеховой туалет ${cluster}.${id}`;
  if (type === RoomType.KITCHEN) return `Комната кипятка цеха ${cluster}.${id}`;
  if (type === RoomType.OFFICE) return `Мастерская контора ${cluster}.${id}`;
  if (type === RoomType.STORAGE) return `Инструментальная ячейка ${cluster}.${id}`;
  if (type === RoomType.PRODUCTION) return `Малый станочный бокс ${cluster}.${id}`;
  return `Бытовка цеха ${cluster}.${id}`;
}

function decorateWorkshopClusterRoom(world: World, room: Room, spec: ProceduralFloorSpec, seed: number): void {
  applyRoomTexture(world, room, Tex.METAL, Tex.F_CONCRETE);
  if (room.type === RoomType.PRODUCTION) {
    decorateWorkshopMachineLine(world, room, workshopFactoryForIndex(seed), spec.seed ^ seed);
    return;
  }
  decorateProceduralRoom(world, room, spec);
  const center = roomCenter(room);
  const centerIdx = world.idx(center.x, center.y);
  if (world.roomMap[centerIdx] !== room.id) return;
  if (room.type === RoomType.STORAGE) world.features[centerIdx] = Feature.SHELF;
  else if (room.type === RoomType.OFFICE) world.features[centerIdx] = Feature.DESK;
  else if (room.type === RoomType.KITCHEN) world.features[centerIdx] = Feature.SINK;
  else if (room.type === RoomType.BATHROOM) world.features[centerIdx] = Feature.TOILET;
  else world.features[centerIdx] = Feature.TABLE;
}

function connectWorkshopLocalRooms(world: World, a: Room, b: Room, spec: ProceduralFloorSpec, seed: number): void {
  const ac = roomCenter(a);
  const bc = roomCenter(b);
  const exitA = roomExit(world, a, bc.x, bc.y);
  const exitB = roomExit(world, b, ac.x, ac.y);
  placeDoorAt(world, exitA.wx, exitA.wy, a.id);
  placeDoorAt(world, exitB.wx, exitB.wy, b.id);
  carveWorkshopL(world, spec, exitA.ox, exitA.oy, exitB.ox, exitB.oy, seed);
}

function tryPlaceWorkshopSupportRoom(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  nextRoomId: { v: number },
  hub: Room,
  type: RoomType,
  size: { w: number; h: number },
  cluster: number,
  ordinal: number,
  seed: number,
): Room | null {
  const dirs = [0, 1, 2, 3].sort((a, b) =>
    fieldHash01(seed, a, ordinal, 0x5820) - fieldHash01(seed, b, ordinal, 0x5820),
  );
  for (const dir of dirs) {
    const span = dir < 2 ? hub.w : hub.h;
    const roomSpan = dir < 2 ? size.w : size.h;
    const maxOffset = Math.max(0, span - roomSpan);
    for (let step = 0; step < 5; step++) {
      const gap = 3 + step * 4 + ((seed >>> (step + dir)) & 3);
      const offset = Math.floor(maxOffset * fieldHash01(seed, dir * 11 + step, ordinal, 0x5821));
      let x = dir < 2 ? hub.x + offset : hub.x + (dir === 2 ? -size.w - gap : hub.w + gap);
      let y = dir < 2 ? hub.y + (dir === 0 ? -size.h - gap : hub.h + gap) : hub.y + offset;
      if (x < 18 || y < 18 || x + size.w >= W - 18 || y + size.h >= W - 18) continue;
      if (!canPlaceRoom(world, x, y, size.w, size.h)) continue;
      nextRoomId.v = Math.max(nextRoomId.v, world.rooms.length);
      const room = stampRoom(world, nextRoomId.v++, type, x, y, size.w, size.h, -1);
      room.name = workshopSupportRoomName(type, room.id, cluster);
      decorateWorkshopClusterRoom(world, room, spec, seed + ordinal * 101);
      rooms.push(room);
      connectWorkshopLocalRooms(world, hub, room, spec, seed + ordinal * 313);
      return room;
    }
  }
  return null;
}

function applyWorkshopClusterRooms(world: World, rooms: Room[], spec: ProceduralFloorSpec, nextRoomId: { v: number }): void {
  if (spec.geometryId !== 'workshops') return;
  const cols = 10;
  const rows = 10;
  const slotW = Math.floor(W / cols);
  const slotH = Math.floor(W / rows);
  const clusterCandidates = Array.from({ length: cols * rows }, (_, slot) => ({
    slot,
    score: fieldHash01(spec.seed, slot, spec.ordinal, 0x5801),
  })).sort((a, b) => a.score - b.score);
  const centers: { x: number; y: number }[] = [];
  const supportTypes = [
    RoomType.STORAGE,
    RoomType.OFFICE,
    RoomType.PRODUCTION,
    RoomType.BATHROOM,
    RoomType.KITCHEN,
    RoomType.STORAGE,
    RoomType.COMMON,
    RoomType.OFFICE,
    RoomType.STORAGE,
    RoomType.PRODUCTION,
  ] as const;
  let clusters = 0;
  let microRooms = 0;

  for (const candidate of clusterCandidates) {
    if (clusters >= WORKSHOP_CLUSTER_TARGET || microRooms >= WORKSHOP_MICRO_ROOM_TARGET) break;
    const col = candidate.slot % cols;
    const row = Math.floor(candidate.slot / cols);
    const seed = (spec.seed ^ Math.imul(candidate.slot + 1, 0x45d9f3b)) >>> 0;
    const horizontal = (seed & 1) === 0;
    const hubW = horizontal ? 22 + Math.floor(fieldHash01(seed, col, row, 0x5802) * 22) : 5 + (seed % 4);
    const hubH = horizontal ? 5 + ((seed >> 3) % 4) : 22 + Math.floor(fieldHash01(seed, row, col, 0x5803) * 22);
    const cx = Math.floor(col * slotW + slotW * (0.34 + fieldHash01(seed, col, row, 0x5804) * 0.32));
    const cy = Math.floor(row * slotH + slotH * (0.34 + fieldHash01(seed, row, col, 0x5805) * 0.32));
    let collision = false;
    for (let j = 0; j < centers.length; j++) {
      const center = centers[j];
      if (world.dist2(center.x, center.y, cx, cy) < WORKSHOP_CLUSTER_MIN_SPACING) {
        collision = true;
        break;
      }
    }
    if (collision) continue;
    const hx = Math.max(20, Math.min(W - hubW - 20, cx - (hubW >> 1)));
    const hy = Math.max(20, Math.min(W - hubH - 20, cy - (hubH >> 1)));
    if (!canPlaceRoom(world, hx, hy, hubW, hubH)) continue;

    const hubType = clusters % 4 === 0 ? RoomType.PRODUCTION : RoomType.CORRIDOR;
    const hub = stampRoom(world, nextRoomId.v++, hubType, hx, hy, hubW, hubH, -1);
    hub.name = hubType === RoomType.PRODUCTION
      ? `Цеховой остров ${clusters + 1}: станция`
      : `Цеховой остров ${clusters + 1}: боковой ход`;
    decorateWorkshopClusterRoom(world, hub, spec, seed);
    rooms.push(hub);
    centers.push({ x: cx, y: cy });

    const localTarget = 5 + (seed % 5);
    let localPlaced = 0;
    for (let i = 0; i < supportTypes.length && localPlaced < localTarget && microRooms < WORKSHOP_MICRO_ROOM_TARGET; i++) {
      const type = supportTypes[(i + clusters + spec.danger) % supportTypes.length];
      const size = workshopMicroRoomSize(type, seed + i * 97);
      const room = tryPlaceWorkshopSupportRoom(world, rooms, spec, nextRoomId, hub, type, size, clusters + 1, i, seed);
      if (!room) continue;
      localPlaced++;
      microRooms++;
    }

    if (localPlaced >= 2) clusters++;
  }
}

function fieldHash01(seed: number, x: number, y: number, salt = 0): number {
  let h = seed ^ Math.imul(x + 0x9e37, 0x85ebca6b) ^ Math.imul(y + 0x632b, 0xc2b2ae35) ^ Math.imul(salt + 0x27d4, 0x165667b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

function smooth01(v: number): number {
  const t = Math.max(0, Math.min(1, v));
  return t * t * (3 - 2 * t);
}

function smoothField01(seed: number, x: number, y: number, scale: number, salt = 0): number {
  const gx = Math.floor(x / scale);
  const gy = Math.floor(y / scale);
  const fx = smooth01((x - gx * scale) / scale);
  const fy = smooth01((y - gy * scale) / scale);
  const wrap = Math.max(1, Math.ceil(W / scale));
  const x0 = ((gx % wrap) + wrap) % wrap;
  const y0 = ((gy % wrap) + wrap) % wrap;
  const x1 = (x0 + 1) % wrap;
  const y1 = (y0 + 1) % wrap;
  const a = fieldHash01(seed, x0, y0, salt);
  const b = fieldHash01(seed, x1, y0, salt);
  const c = fieldHash01(seed, x0, y1, salt);
  const d = fieldHash01(seed, x1, y1, salt);
  const ab = a + (b - a) * fx;
  const cd = c + (d - c) * fx;
  return ab + (cd - ab) * fy;
}

function clearWorldToField(world: World, floorTex: Tex, wallTex: Tex, fog = 0): void {
  world.doors.clear();
  world.rooms.length = 0;
  for (let i = 0; i < world.cells.length; i++) {
    world.cells[i] = Cell.FLOOR;
    world.roomMap[i] = -1;
    world.wallTex[i] = wallTex;
    world.floorTex[i] = floorTex;
    world.features[i] = Feature.NONE;
    world.fog[i] = fog;
    world.hermoWall[i] = 0;
    world.aptMask[i] = 0;
  }
}

function protectedFieldCell(world: World, ci: number): boolean {
  return world.cells[ci] === Cell.LIFT || world.hermoWall[ci] !== 0 || world.aptMask[ci] !== 0 || world.containerMap.has(ci);
}

function carveFieldCell(world: World, x: number, y: number, floorTex: Tex, wallTex: Tex, fog = 0): boolean {
  const ci = world.idx(x, y);
  if (protectedFieldCell(world, ci)) return false;
  if (world.cells[ci] === Cell.DOOR && world.doors.has(ci)) return false;
  world.cells[ci] = Cell.FLOOR;
  world.floorTex[ci] = floorTex;
  world.wallTex[ci] = wallTex;
  if (world.roomMap[ci] < 0) world.roomMap[ci] = -1;
  if (world.features[ci] !== Feature.LIFT_BUTTON) world.features[ci] = Feature.NONE;
  world.fog[ci] = Math.min(world.fog[ci], fog);
  return true;
}

function carveFieldSegment(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  floorTex: Tex,
  wallTex: Tex,
  fog = 0,
): void {
  const horizontal = Math.abs(world.delta(ax, bx)) >= Math.abs(world.delta(ay, by));
  const delta = horizontal ? world.delta(ax, bx) : world.delta(ay, by);
  const dir = delta >= 0 ? 1 : -1;
  const steps = Math.abs(delta);
  let x = world.wrap(ax);
  let y = world.wrap(ay);
  for (let step = 0; step <= steps; step++) {
    for (let side = -width; side <= width; side++) {
      if (horizontal) carveFieldCell(world, x, y + side, floorTex, wallTex, fog);
      else carveFieldCell(world, x + side, y, floorTex, wallTex, fog);
    }
    if (step < steps) {
      if (horizontal) x = world.wrap(x + dir);
      else y = world.wrap(y + dir);
    }
  }
}

function carveFieldRoute(
  world: World,
  a: { x: number; y: number },
  b: { x: number; y: number },
  width: number,
  floorTex: Tex,
  wallTex: Tex,
  seed: number,
  fog = 0,
): void {
  if ((seed & 1) === 0) {
    carveFieldSegment(world, a.x, a.y, b.x, a.y, width, floorTex, wallTex, fog);
    carveFieldSegment(world, b.x, a.y, b.x, b.y, width, floorTex, wallTex, fog);
  } else {
    carveFieldSegment(world, a.x, a.y, a.x, b.y, width, floorTex, wallTex, fog);
    carveFieldSegment(world, a.x, b.y, b.x, b.y, width, floorTex, wallTex, fog);
  }
}

function carveWallSnakePoreDisk(world: World, cx: number, cy: number, radius: number, seed: number, fog = 6): void {
  const r = Math.max(1, Math.ceil(radius));
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = world.wrap(cx + dx);
      const y = world.wrap(cy + dy);
      const d = Math.sqrt(dx * dx + dy * dy);
      const ragged = (fieldHash01(seed, x, y, 0x51d1) - 0.5) * 0.9;
      if (d > radius + ragged) continue;
      carveFieldCell(world, x, y, Tex.F_GUT, Tex.MEAT, fog);
      const ci = world.idx(x, y);
      if (fieldHash01(seed, x, y, 0x51d2) > 0.94) {
        world.floorTex[ci] = Tex.F_MEAT;
        world.fog[ci] = Math.min(world.fog[ci], 4);
      }
    }
  }
}

function carveWallSnakeOrganicRoute(
  world: World,
  a: { x: number; y: number },
  b: { x: number; y: number },
  width: number,
  seed: number,
  fog = 6,
): void {
  const dx = world.delta(a.x, b.x);
  const dy = world.delta(a.y, b.y);
  const len = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / len;
  const ny = dx / len;
  const steps = Math.max(8, Math.ceil(len * 1.35));
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const envelope = Math.sin(Math.PI * t);
    const waveA = smoothField01(seed, step * 3, 0, 19, 0x51d3) - 0.5;
    const waveB = smoothField01(seed, step * 5, 0, 11, 0x51d4) - 0.5;
    const wobble = (waveA * 13 + waveB * 5) * envelope;
    const x = world.wrap(Math.round(a.x + dx * t + nx * wobble));
    const y = world.wrap(Math.round(a.y + dy * t + ny * wobble));
    const pore = width + 1.15 + fieldHash01(seed, step, 0, 0x51d5) * 1.65;
    carveWallSnakePoreDisk(world, x, y, pore, seed ^ Math.imul(step + 1, 0x45d9f3b), fog);
    if (step % 17 === 8) {
      const side = fieldHash01(seed, step, 1, 0x51d6) < 0.5 ? -1 : 1;
      const pocketX = world.wrap(Math.round(x + nx * side * (pore + 2.5)));
      const pocketY = world.wrap(Math.round(y + ny * side * (pore + 2.5)));
      carveWallSnakePoreDisk(world, pocketX, pocketY, pore + 1.5, seed ^ Math.imul(step + 17, 0x27d4eb2d), fog + 2);
    }
  }
}

function ensureWallSnakeConnectivity(world: World, spawnX: number, spawnY: number, seed: number): void {
  const start = world.idx(Math.floor(spawnX), Math.floor(spawnY));
  if (!isConnectivityWalkable(world, start)) return;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  const size = W * W;
  for (let pass = 0; pass < 4; pass++) {
    const label = new Int32Array(size).fill(-1);
    const queue = new Int32Array(size);
    let head = 0;
    let tail = 0;
    label[start] = 0;
    queue[tail++] = start;
    while (head < tail) {
      const ci = queue[head++];
      const cx = ci % W;
      const cy = (ci / W) | 0;
      for (const [dx, dy] of dirs) {
        const ni = world.idx(cx + dx, cy + dy);
        if (label[ni] >= 0 || !isConnectivityWalkable(world, ni)) continue;
        label[ni] = 0;
        queue[tail++] = ni;
      }
    }

    const mainCells: { x: number; y: number }[] = [];
    const mainStep = Math.max(1, tail >> 10);
    for (let i = 0; i < tail; i += mainStep) {
      const ci = queue[i];
      mainCells.push({ x: ci % W, y: (ci / W) | 0 });
    }

    let components = 0;
    let connected = 0;
    for (let i = 0; i < size; i++) {
      if (label[i] >= 0 || !isConnectivityWalkable(world, i)) continue;
      components++;
      const comp: number[] = [i];
      label[i] = components;
      for (let h = 0; h < comp.length; h++) {
        const ci = comp[h];
        const cx = ci % W;
        const cy = (ci / W) | 0;
        for (const [dx, dy] of dirs) {
          const ni = world.idx(cx + dx, cy + dy);
          if (label[ni] >= 0 || !isConnectivityWalkable(world, ni)) continue;
          label[ni] = components;
          comp.push(ni);
        }
      }

      let critical = comp.length >= WALL_SNAKE_CONNECT_MIN_COMPONENT;
      for (let c = 0; !critical && c < comp.length; c++) {
        const ci = comp[c];
        critical = world.cells[ci] === Cell.LIFT ||
          world.cells[ci] === Cell.DOOR ||
          (world.features[ci] as Feature) === Feature.SCREEN ||
          (world.features[ci] as Feature) === Feature.LIFT_BUTTON ||
          world.containerMap.has(ci);
      }
      if (!critical) {
        for (const ci of comp) label[ci] = 0;
        continue;
      }

      let src = comp[0];
      let dst = mainCells[0] ?? { x: spawnX | 0, y: spawnY | 0 };
      let bestD = Infinity;
      const compStep = Math.max(1, comp.length >> 3);
      for (let c = 0; c < comp.length; c += compStep) {
        const ci = comp[c];
        const cx = ci % W;
        const cy = (ci / W) | 0;
        for (const main of mainCells) {
          const d = Math.abs(world.delta(cx, main.x)) + Math.abs(world.delta(cy, main.y));
          if (d >= bestD) continue;
          bestD = d;
          src = ci;
          dst = main;
        }
      }
      const sx = src % W;
      const sy = (src / W) | 0;
      carveWallSnakeOrganicRoute(world, { x: sx, y: sy }, dst, 2, seed ^ Math.imul(components + pass * 97, 0x51a7), 8);
      mainCells.push({ x: sx, y: sy });
      connected++;
    }
    if (components === 0 || connected === 0) break;
  }
}

function hermeticDoorForIsland(world: World, room: Room, side: 0 | 1 | 2 | 3): { x: number; y: number } {
  const midX = room.x + Math.floor(room.w / 2);
  const midY = room.y + Math.floor(room.h / 2);
  let wx = midX;
  let wy = room.y - 1;
  let ox = midX;
  let oy = room.y - 2;
  if (side === 1) {
    wx = room.x + room.w;
    wy = midY;
    ox = room.x + room.w + 1;
    oy = midY;
  } else if (side === 2) {
    wx = midX;
    wy = room.y + room.h;
    ox = midX;
    oy = room.y + room.h + 1;
  } else if (side === 3) {
    wx = room.x - 1;
    wy = midY;
    ox = room.x - 2;
    oy = midY;
  }
  const idx = world.idx(wx, wy);
  world.cells[idx] = Cell.DOOR;
  world.wallTex[idx] = Tex.DOOR_METAL;
  world.hermoWall[idx] = 1;
  world.doors.set(idx, { idx, state: DoorState.HERMETIC_OPEN, roomA: room.id, roomB: -1, keyId: '', timer: 0 });
  if (!room.doors.includes(idx)) room.doors.push(idx);
  return { x: world.wrap(ox), y: world.wrap(oy) };
}

function stampFieldIslandRoom(
  world: World,
  rooms: Room[],
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
  side: 0 | 1 | 2 | 3,
): { room: Room; doorOutside: { x: number; y: number } } {
  const room = stampRoom(world, rooms.length, type, x, y, w, h, -1);
  room.name = name;
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  applyRoomTexture(world, room, wallTex, floorTex);
  room.sealed = true;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.cells[ci] !== Cell.DOOR) {
        world.hermoWall[ci] = 1;
        world.wallTex[ci] = Tex.HERMO_WALL;
      }
    }
  }
  const center = roomCenter(room);
  world.features[world.idx(center.x, center.y)] = type === RoomType.PRODUCTION ? Feature.MACHINE : Feature.TABLE;
  const doorOutside = hermeticDoorForIsland(world, room, side);
  rooms.push(room);
  return { room, doorOutside };
}

function buildConwayLifeField(world: World, spec: ProceduralFloorSpec): void {
  clearWorldToField(world, Tex.F_CONCRETE, Tex.CONCRETE, 6);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const band = ((x + spec.seed) % 17 === 0 || (y + spec.ordinal * 5) % 19 === 0)
        ? LIFE_FIELD_NOISE_BAND_BONUS
        : 0;
      if (fieldHash01(spec.seed, x, y, 0x1a1f) >= LIFE_FIELD_NOISE_DENSITY + band) continue;
      const ci = world.idx(x, y);
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.DARK;
      world.floorTex[ci] = Tex.F_VOID;
      world.fog[ci] = 34;
    }
  }
}

function buildConwayLifeFieldRooms(world: World, spec: ProceduralFloorSpec): { rooms: Room[]; spawnX: number; spawnY: number } {
  world.doors.clear();
  world.rooms.length = 0;
  buildConwayLifeField(world, spec);
  const rooms: Room[] = [];
  const cols = 4;
  const rows = 3;
  const cellW = Math.floor(W / cols);
  const cellH = Math.floor(W / rows);
  const exits: { x: number; y: number }[] = [];

  for (let i = 0; i < LIFE_FIELD_SAFE_ROOM_COUNT; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const w = 20 + Math.floor(fieldHash01(spec.seed, i, row, 0x7101) * 14);
    const h = 16 + Math.floor(fieldHash01(spec.seed, i, col, 0x7102) * 12);
    const x = Math.floor(col * cellW + cellW * 0.38 + fieldHash01(spec.seed, i, col, 0x7103) * Math.max(1, cellW * 0.22));
    const y = Math.floor(row * cellH + cellH * 0.34 + fieldHash01(spec.seed, i, row, 0x7104) * Math.max(1, cellH * 0.22));
    const side = (i + spec.seed) & 3;
    const type = i % 5 === 0 ? RoomType.PRODUCTION : i % 3 === 0 ? RoomType.STORAGE : RoomType.COMMON;
    const placed = stampFieldIslandRoom(
      world,
      rooms,
      type,
      Math.max(8, Math.min(W - w - 9, x)),
      Math.max(8, Math.min(W - h - 9, y)),
      w,
      h,
      `Остров игры жизнь ${i + 1}`,
      Tex.HERMO_WALL,
      i % 4 === 0 ? Tex.F_VOID : Tex.F_CONCRETE,
      side as 0 | 1 | 2 | 3,
    );
    exits.push(placed.doorOutside);
    const c = roomCenter(placed.room);
    carveFieldSegment(world, c.x - 3, c.y, c.x + 3, c.y, 1, Tex.F_CONCRETE, Tex.CONCRETE, 0);
    carveFieldSegment(world, c.x, c.y - 3, c.x, c.y + 3, 1, Tex.F_CONCRETE, Tex.CONCRETE, 0);
  }

  for (let i = 1; i < exits.length; i++) {
    carveFieldRoute(world, exits[i - 1], exits[i], 2, Tex.F_CONCRETE, Tex.CONCRETE, spec.seed + i * 613, 0);
  }
  if (exits.length > 4) carveFieldRoute(world, exits[0], exits[exits.length - 1], 1, Tex.F_VOID, Tex.VOID_WALL, spec.seed ^ 0x71fe, 0);

  const spawnRoom = rooms[0];
  const spawn = spawnRoom ? roomCenter(spawnRoom) : { x: W / 2, y: W / 2 };
  const target = rooms[rooms.length - 1] ? roomCenter(rooms[rooms.length - 1]) : { x: world.wrap(spawn.x + 120), y: spawn.y };
  registerRouteCue(world, {
    id: `procedural_${spec.key}_life_field_macro`,
    x: spawn.x + 0.5,
    y: spawn.y + 0.5,
    targetX: target.x + 0.5,
    targetY: target.y + 0.5,
    floor: spec.baseFloor,
    roomId: spawnRoom?.id,
    targetRoomId: rooms[rooms.length - 1]?.id,
    zoneId: world.zoneMap[world.idx(spawn.x, spawn.y)],
    label: 'поле игры жизнь',
    hint: 'живые стены уже собрали весь этаж; безопасны только гермоострова и прорезанные ходы',
    targetName: 'дальний гермоостров',
    color: '#6ee0b6',
    tags: ['procedural_floor', 'conway_life', 'cellular', 'visible_anomaly', 'route_pressure', 'macro_geometry'],
    toneSeed: spec.seed ^ 0x71fe,
    radius: 16,
    targetRadius: 4,
    cooldownSec: 45,
    heardText: 'Весь этаж щелкает как клеточное поле. Живые стены не похожи на коридорную нарезку.',
    followedText: 'Гермоостров найден между поколениями клеток.',
    ignoredText: 'Клеточное поле осталось шевелиться за спиной.',
  });
  ensureConnectivity(world, spawn.x + 0.5, spawn.y + 0.5);
  sanitizeDoors(world);
  world.markCellsDirty();
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFeaturesDirty(true);
  world.markFogDirty();
  return { rooms, spawnX: spawn.x + 0.5, spawnY: spawn.y + 0.5 };
}

function wallSnakePerimeterPoint(world: World, x0: number, y0: number, w: number, h: number, step: number): { x: number; y: number } {
  const len = Math.max(1, (w + h) * 2 - 4);
  let t = ((step % len) + len) % len;
  if (t < w) return { x: world.wrap(x0 + t), y: world.wrap(y0) };
  t -= w;
  if (t < h - 1) return { x: world.wrap(x0 + w - 1), y: world.wrap(y0 + 1 + t) };
  t -= h - 1;
  if (t < w - 1) return { x: world.wrap(x0 + w - 2 - t), y: world.wrap(y0 + h - 1) };
  t -= w - 1;
  return { x: world.wrap(x0), y: world.wrap(y0 + h - 2 - t) };
}

function paintWallSnakeMeatField(world: World, spec: ProceduralFloorSpec): void {
  clearWorldToField(world, Tex.F_GUT, Tex.MEAT, 18);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const ci = world.idx(x, y);
      const lacuna = smoothField01(spec.seed, x, y, 104, 0x51f1);
      const merge = smoothField01(spec.seed, x, y, 43, 0x51f2);
      const membrane = smoothField01(spec.seed, x, y, 19, 0x51f3);
      const pore = smoothField01(spec.seed, x, y, 13, 0x51f7);
      const grain = fieldHash01(spec.seed, x, y, 0x51f8);
      const tissue = lacuna * 0.54 + merge * 0.29 + membrane * 0.17;
      const rim = Math.abs(tissue - WALL_SNAKE_MEAT_BLOCK_THRESHOLD);
      const poreCut = (pore > 0.68 && membrane < 0.72) || grain > 0.988;
      const capillaryA = Math.abs(merge - 0.5) < 0.034 && pore < 0.64;
      const capillaryB = Math.abs(membrane - 0.54) < 0.026 && lacuna > 0.34 && pore < 0.6;
      const trabecula = (rim < 0.028 && membrane > 0.36 && pore < 0.86) || capillaryA || capillaryB;
      const smallBridge = tissue > WALL_SNAKE_MEAT_BLOCK_THRESHOLD - 0.035 && membrane > 0.75 && pore < 0.7;
      if ((tissue > WALL_SNAKE_MEAT_BLOCK_THRESHOLD || smallBridge || trabecula) && !poreCut) {
        world.cells[ci] = Cell.WALL;
        world.wallTex[ci] = rim < 0.06 || membrane > 0.78 ? Tex.GUT : Tex.MEAT;
        world.floorTex[ci] = Tex.F_MEAT;
        world.fog[ci] = 12 + Math.floor(fieldHash01(spec.seed, x, y, 0x51f4) * 16);
      } else {
        world.cells[ci] = Cell.FLOOR;
        world.wallTex[ci] = Tex.MEAT;
        world.floorTex[ci] = tissue < WALL_SNAKE_MEAT_BLOCK_THRESHOLD - 0.12 || pore > 0.72 ? Tex.F_GUT : Tex.F_MEAT;
        world.fog[ci] = 2 + Math.floor(fieldHash01(spec.seed, x, y, 0x51f6) * 10);
      }
    }
  }
}

function placeWallSnakeSphincterLights(world: World, spec: ProceduralFloorSpec): void {
  for (let gy = WALL_SNAKE_SPHINCTER_GRID / 2; gy < W; gy += WALL_SNAKE_SPHINCTER_GRID) {
    for (let gx = WALL_SNAKE_SPHINCTER_GRID / 2; gx < W; gx += WALL_SNAKE_SPHINCTER_GRID) {
      if (fieldHash01(spec.seed, gx, gy, 0x51fa) > 0.46) continue;
      const cx = world.wrap(Math.round(gx + (fieldHash01(spec.seed, gx, gy, 0x51fb) - 0.5) * 34));
      const cy = world.wrap(Math.round(gy + (fieldHash01(spec.seed, gx, gy, 0x51fc) - 0.5) * 34));
      let best = -1;
      let bestScore = -Infinity;
      for (let dy = -WALL_SNAKE_SPHINCTER_SEARCH; dy <= WALL_SNAKE_SPHINCTER_SEARCH; dy++) {
        for (let dx = -WALL_SNAKE_SPHINCTER_SEARCH; dx <= WALL_SNAKE_SPHINCTER_SEARCH; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 > WALL_SNAKE_SPHINCTER_SEARCH * WALL_SNAKE_SPHINCTER_SEARCH) continue;
          const x = world.wrap(cx + dx);
          const y = world.wrap(cy + dy);
          const ci = world.idx(x, y);
          if (world.cells[ci] !== Cell.FLOOR || world.features[ci] !== Feature.NONE) continue;
          if (world.hermoWall[ci] || world.aptMask[ci] || world.containerMap.has(ci) || world.doors.has(ci)) continue;
          const tissue = smoothField01(spec.seed, x, y, 92, 0x51f1) * 0.62 +
            smoothField01(spec.seed, x, y, 47, 0x51f2) * 0.27 +
            smoothField01(spec.seed, x, y, 23, 0x51f3) * 0.11;
          const rim = 1 - Math.min(1, Math.abs(tissue - WALL_SNAKE_MEAT_BLOCK_THRESHOLD) / 0.12);
          const score = rim * 3 - d2 * 0.004 + fieldHash01(spec.seed, x, y, 0x51fd) * 0.2;
          if (score <= bestScore) continue;
          bestScore = score;
          best = ci;
        }
      }
      if (best < 0) continue;
      const x = best % W;
      const y = (best / W) | 0;
      world.features[best] = Feature.LAMP;
      world.floorTex[best] = Tex.F_GUT;
      world.wallTex[best] = Tex.GUT;
      world.fog[best] = 0;
      stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.42, 0.58, spec.seed ^ (x * 131 + y * 17), 160, 36, 32, false);
    }
  }
}

function paintWallSnakeLoop(world: World, spec: ProceduralFloorSpec, x0: number, y0: number, w: number, h: number, index: number): { head: { x: number; y: number }; bait: { x: number; y: number } } {
  const perimeter = Math.max(1, Math.min(192, (w + h) * 2 - 4));
  for (let step = 0; step < perimeter; step++) {
    const p = wallSnakePerimeterPoint(world, x0, y0, w, h, step);
    const ci = world.idx(p.x, p.y);
    if (world.hermoWall[ci] || world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;
    const flesh = world.cells[ci] === Cell.WALL || fieldHash01(spec.seed, index, step, 0x51c1) < 0.34;
    world.cells[ci] = flesh ? Cell.WALL : Cell.FLOOR;
    world.floorTex[ci] = flesh ? Tex.F_MEAT : Tex.F_GUT;
    world.wallTex[ci] = fieldHash01(spec.seed, step, index, 0x51c2) < 0.18 ? Tex.GUT : Tex.MEAT;
    world.fog[ci] = Math.max(world.fog[ci], 28);
    if (world.features[ci] !== Feature.LIFT_BUTTON) world.features[ci] = Feature.NONE;
  }
  const head = wallSnakePerimeterPoint(world, x0, y0, w, h, 0);
  const bait = wallSnakePerimeterPoint(world, x0, y0, w, h, Math.floor(perimeter * 0.62));
  const headIdx = world.idx(head.x, head.y);
  if (!world.hermoWall[headIdx] && world.cells[headIdx] !== Cell.LIFT) world.features[headIdx] = Feature.SCREEN;
  const baitIdx = world.idx(bait.x, bait.y);
  if (!world.hermoWall[baitIdx] && world.cells[baitIdx] !== Cell.LIFT) {
    world.cells[baitIdx] = Cell.FLOOR;
    world.floorTex[baitIdx] = Tex.F_GUT;
    world.wallTex[baitIdx] = Tex.MEAT;
  }
  stampSurfaceSplat(world, bait.x, bait.y, 0.5, 0.5, 0.28, 0.42, spec.seed ^ (index * 611), 188, 214, 206, false);
  return { head, bait };
}

function appendWallSnakeTag(room: Room, x0: number, y0: number, w: number, h: number): void {
  room.name = `${room.name} [wall_snake:${x0},${y0},${w},${h}]`;
}

interface WallSnakeFieldLoop {
  index: number;
  roomId?: number;
  x0: number;
  y0: number;
  w: number;
  h: number;
  head: { x: number; y: number };
  bait: { x: number; y: number };
}

function registerWallSnakeFieldCue(
  world: World,
  spec: ProceduralFloorSpec,
  cueId: string,
  loop: WallSnakeFieldLoop,
  head: { x: number; y: number },
): void {
  const headIdx = world.idx(head.x, head.y);
  if (!world.hermoWall[headIdx] && !world.aptMask[headIdx] && world.cells[headIdx] !== Cell.LIFT) {
    world.cells[headIdx] = Cell.FLOOR;
    world.floorTex[headIdx] = Tex.F_GUT;
    world.wallTex[headIdx] = Tex.MEAT;
    world.features[headIdx] = Feature.SCREEN;
  }
  registerRouteCue(world, {
    id: cueId,
    x: head.x + 0.5,
    y: head.y + 0.5,
    targetX: loop.bait.x + 0.5,
    targetY: loop.bait.y + 0.5,
    floor: spec.baseFloor,
    roomId: loop.roomId,
    targetRoomId: loop.roomId,
    zoneId: world.zoneMap[headIdx],
    label: 'пористое мясо личинок',
    hint: 'белые личинки едят мясные блоки и оставляют каверны; гермоострова не отрастают',
    targetName: 'светлая приманка за петлей',
    color: '#f4efe2',
    tags: ['procedural_floor', 'wall_snake', 'moving_walls', 'larva', 'meat_growth', 'visible_anomaly', 'route_pressure', 'macro_geometry'],
    toneSeed: (spec.seed ^ loop.index * 977 ^ 0x51a4e) >>> 0,
    radius: 14,
    targetRadius: 4,
    cooldownSec: 42,
    heardText: 'На карте рядом видно пористое мясо: белые блоки идут цепочкой, черные головы режут новый ход.',
    followedText: 'Личиночное поле читается: мясо отрастает медленнее, чем его можно обойти.',
    ignoredText: 'Белые личинки остались жевать этаж за спиной.',
  });
}

function nearestWallSnakeFieldPoint(world: World, loop: WallSnakeFieldLoop, x: number, y: number): { x: number; y: number } {
  const perimeter = Math.max(1, Math.min(192, (loop.w + loop.h) * 2 - 4));
  let best = loop.head;
  let bestD2 = world.dist2(x + 0.5, y + 0.5, best.x + 0.5, best.y + 0.5);
  for (let step = 0; step < perimeter; step += 4) {
    const p = wallSnakePerimeterPoint(world, loop.x0, loop.y0, loop.w, loop.h, step);
    const ci = world.idx(p.x, p.y);
    if (world.hermoWall[ci] || world.cells[ci] === Cell.LIFT) continue;
    const d2 = world.dist2(x + 0.5, y + 0.5, p.x + 0.5, p.y + 0.5);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = p;
    }
  }
  return best;
}

function buildWallSnakeFieldRooms(world: World, spec: ProceduralFloorSpec): { rooms: Room[]; spawnX: number; spawnY: number } {
  paintWallSnakeMeatField(world, spec);
  const rooms: Room[] = [];
  const islandCols = 4;
  const islandRows = 4;
  const islandCell = W / islandCols;
  const exits: { x: number; y: number }[] = [];
  const loops: WallSnakeFieldLoop[] = [];

  for (let i = 0; i < islandCols * islandRows; i++) {
    const col = i % islandCols;
    const row = Math.floor(i / islandCols);
    const w = 18 + Math.floor(fieldHash01(spec.seed, i, row, 0x51a1) * 10);
    const h = 14 + Math.floor(fieldHash01(spec.seed, i, col, 0x51a2) * 8);
    const x = Math.floor(col * islandCell + islandCell * 0.42 + fieldHash01(spec.seed, i, col, 0x51a3) * 28);
    const y = Math.floor(row * islandCell + islandCell * 0.38 + fieldHash01(spec.seed, i, row, 0x51a4) * 34);
    const type = i % 4 === 0 ? RoomType.STORAGE : i % 5 === 0 ? RoomType.PRODUCTION : RoomType.COMMON;
    const placed = stampFieldIslandRoom(
      world,
      rooms,
      type,
      Math.max(8, Math.min(W - w - 9, x)),
      Math.max(8, Math.min(W - h - 9, y)),
      w,
      h,
      `Гермоостров личинок ${i + 1}`,
      Tex.HERMO_WALL,
      Tex.F_CONCRETE,
      ((i + spec.seed) & 3) as 0 | 1 | 2 | 3,
    );
    exits.push(placed.doorOutside);
  }

  for (let i = 1; i < exits.length; i++) {
    carveWallSnakeOrganicRoute(world, exits[i - 1], exits[i], 1, spec.seed + i * 307, 8);
  }

  let cueCount = 0;
  for (let row = 0; row < WALL_SNAKE_FIELD_ROWS; row++) {
    for (let col = 0; col < WALL_SNAKE_FIELD_COLUMNS; col++) {
      const index = row * WALL_SNAKE_FIELD_COLUMNS + col;
      const slotW = W / WALL_SNAKE_FIELD_COLUMNS;
      const slotH = W / WALL_SNAKE_FIELD_ROWS;
      const w = 34 + Math.floor(fieldHash01(spec.seed, index, col, 0x51b1) * 12);
      const h = 34 + Math.floor(fieldHash01(spec.seed, index, row, 0x51b2) * 18);
      const x0 = Math.floor(col * slotW + 8 + fieldHash01(spec.seed, index, col, 0x51b3) * Math.max(1, slotW - w - 14));
      const y0 = Math.floor(row * slotH + 18 + fieldHash01(spec.seed, index, row, 0x51b4) * Math.max(1, slotH - h - 24));
      const painted = paintWallSnakeLoop(world, spec, x0, y0, w, h, index);
      const room = rooms[index % rooms.length];
      appendWallSnakeTag(room, x0, y0, w, h);
      const loop = { index, roomId: room?.id, x0, y0, w, h, head: painted.head, bait: painted.bait };
      loops.push(loop);
      if (cueCount < 8 && (index % 16 === 0 || index === WALL_SNAKE_FIELD_TARGET - 1)) {
        const anchor = exits[index % exits.length] ?? painted.head;
        carveWallSnakeOrganicRoute(world, anchor, painted.head, 1, spec.seed ^ (index * 719), 8);
        carveWallSnakeOrganicRoute(world, painted.head, painted.bait, 1, spec.seed ^ (index * 733), 8);
        registerWallSnakeFieldCue(world, spec, `procedural_${spec.key}_wall_snake_field_${cueCount}`, loop, painted.head);
        cueCount++;
      }
    }
  }

  const spawnRoom = rooms[0];
  const spawn = roomCenter(spawnRoom);
  const nearest = loops.reduce<WallSnakeFieldLoop | null>((best, loop) => {
    if (!best) return loop;
    const bestPoint = nearestWallSnakeFieldPoint(world, best, spawn.x, spawn.y);
    const point = nearestWallSnakeFieldPoint(world, loop, spawn.x, spawn.y);
    return world.dist2(spawn.x + 0.5, spawn.y + 0.5, point.x + 0.5, point.y + 0.5)
      < world.dist2(spawn.x + 0.5, spawn.y + 0.5, bestPoint.x + 0.5, bestPoint.y + 0.5)
      ? loop
      : best;
  }, null);
  if (nearest) {
    const nearestPoint = nearestWallSnakeFieldPoint(world, nearest, spawn.x, spawn.y);
    carveWallSnakeOrganicRoute(world, spawn, nearestPoint, 1, spec.seed ^ 0x51a751, 8);
    carveWallSnakeOrganicRoute(world, nearestPoint, nearest.bait, 1, spec.seed ^ 0x51a752, 8);
    registerWallSnakeFieldCue(
      world,
      spec,
      `procedural_${spec.key}_wall_snake_field_start`,
      nearest,
      nearestPoint,
    );
  }
  ensureWallSnakeConnectivity(world, spawn.x + 0.5, spawn.y + 0.5, spec.seed ^ 0x51a4e);
  sanitizeDoors(world);
  placeWallSnakeSphincterLights(world, spec);
  world.markCellsDirty();
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFeaturesDirty(true);
  world.markFogDirty();
  return { rooms, spawnX: spawn.x + 0.5, spawnY: spawn.y + 0.5 };
}

function archiveGridDelta(size: number, from: number, to: number): number {
  let delta = to - from;
  if (delta > size / 2) delta -= size;
  if (delta < -size / 2) delta += size;
  return delta;
}

function archiveRoomType(node: MazeGraphNode, landmarkIndex: number): RoomType {
  if (landmarkIndex >= 0) return landmarkIndex % 3 === 1 ? RoomType.COMMON : RoomType.OFFICE;
  if (node.degree <= 1) return RoomType.STORAGE;
  if (node.degree >= 3) return RoomType.COMMON;
  return RoomType.CORRIDOR;
}

function archiveRoomSize(type: RoomType, landmarkIndex: number): { w: number; h: number } {
  if (landmarkIndex >= 0) return type === RoomType.COMMON ? { w: 17, h: 13 } : { w: 15, h: 11 };
  if (type === RoomType.COMMON) return { w: 13, h: 11 };
  if (type === RoomType.STORAGE) return { w: 9, h: 9 };
  return { w: 7, h: 7 };
}

function decorateArchiveWarrenRoom(world: World, room: Room, node: MazeGraphNode, landmarkIndex: number): void {
  room.wallTex = Tex.MARBLE;
  room.floorTex = landmarkIndex >= 0 ? Tex.F_GREEN_CARPET : Tex.F_PARQUET;
  applyRoomTexture(world, room, room.wallTex, room.floorTex);

  if (landmarkIndex >= 0) {
    room.name = `${ARCHIVE_WARREN_LANDMARK_NAMES[landmarkIndex % ARCHIVE_WARREN_LANDMARK_NAMES.length]} ${room.id}`;
    placeRoomFeature(world, room, Feature.DESK, Math.floor(room.w / 2), Math.floor(room.h / 2));
    placeRoomFeature(world, room, Feature.SCREEN, 1, 1);
    placeRoomFeature(world, room, Feature.LAMP, room.w - 2, 1);
    placeRoomFeature(world, room, Feature.SHELF, 1, room.h - 2);
    const center = roomCenter(room);
    stampSurfaceSplat(world, center.x, center.y, 0.5, 0.5, 0.34, 0.68, node.id * 701 + room.id, 205, 190, 142, false);
    return;
  }

  room.name = node.degree <= 1
    ? `Тупиковый фонд ${room.id}`
    : node.degree >= 3
      ? `Развилка описей ${room.id}`
      : `Архивный ход ${room.id}`;
  const midX = Math.floor(room.w / 2);
  const midY = Math.floor(room.h / 2);
  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      if (dx === midX || dy === midY) continue;
      if (((dx + node.gx) % 3 !== 0) && ((dy + node.gy) % 4 !== 0)) continue;
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.features[ci] === Feature.NONE) world.features[ci] = Feature.SHELF;
    }
  }
  if (node.degree <= 1) placeRoomFeature(world, room, Feature.TABLE, midX, midY);
}

function ensureArchiveLockedChords(graph: MazeGraph, targetCount: number): void {
  let locked = graph.edges.filter(edge => edge.tag === 'locked_optional').length;
  if (locked >= targetCount) return;
  const candidates = graph.edges
    .filter(edge => edge.tag === 'chord')
    .sort((a, b) => {
      const ad = Math.max(graph.nodes[a.a].depth, graph.nodes[a.b].depth);
      const bd = Math.max(graph.nodes[b.a].depth, graph.nodes[b.b].depth);
      return bd - ad;
    });
  for (const edge of candidates) {
    edge.tag = 'locked_optional';
    locked++;
    if (locked >= targetCount) break;
  }
}

function archiveDoorPoint(world: World, room: Room, dirX: number, dirY: number): { wx: number; wy: number; ox: number; oy: number } {
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  if (dirX > 0) return { wx: world.wrap(room.x + room.w), wy: world.wrap(cy), ox: world.wrap(room.x + room.w + 1), oy: world.wrap(cy) };
  if (dirX < 0) return { wx: world.wrap(room.x - 1), wy: world.wrap(cy), ox: world.wrap(room.x - 2), oy: world.wrap(cy) };
  if (dirY > 0) return { wx: world.wrap(cx), wy: world.wrap(room.y + room.h), ox: world.wrap(cx), oy: world.wrap(room.y + room.h + 1) };
  return { wx: world.wrap(cx), wy: world.wrap(room.y - 1), ox: world.wrap(cx), oy: world.wrap(room.y - 2) };
}

function openArchiveDoor(world: World, room: Room, wx: number, wy: number, state: DoorState, keyId: string): void {
  const idx = world.idx(wx, wy);
  if (world.aptMask[idx] || world.hermoWall[idx] || world.cells[idx] === Cell.LIFT) return;
  world.cells[idx] = Cell.DOOR;
  world.wallTex[idx] = state === DoorState.LOCKED ? Tex.DOOR_METAL : Tex.DOOR_WOOD;
  world.features[idx] = Feature.NONE;
  const existing = world.doors.get(idx);
  if (existing) {
    existing.state = state;
    existing.roomA = room.id;
    existing.keyId = keyId;
  } else {
    world.doors.set(idx, { idx, state, roomA: room.id, roomB: -1, keyId, timer: 0 });
  }
  if (!room.doors.includes(idx)) room.doors.push(idx);
}

function carveArchiveMazeCell(world: World, x: number, y: number): void {
  const idx = world.idx(x, y);
  if (world.aptMask[idx] || world.hermoWall[idx] || world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.DOOR) return;
  if (world.roomMap[idx] >= 0) return;
  world.cells[idx] = Cell.FLOOR;
  world.roomMap[idx] = -1;
  world.floorTex[idx] = Tex.F_PARQUET;
  world.wallTex[idx] = Tex.MARBLE;
  world.features[idx] = Feature.NONE;
}

function carveArchiveMazeLine(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  dirX: number,
  _dirY: number,
  edgeIndex: number,
): void {
  const horizontal = dirX !== 0;
  const delta = horizontal ? world.delta(ax, bx) : world.delta(ay, by);
  const step = delta >= 0 ? 1 : -1;
  const steps = Math.abs(delta);
  let x = world.wrap(ax);
  let y = world.wrap(ay);
  const side = (edgeIndex & 1) === 0 ? 1 : -1;

  for (let i = 0; i <= steps; i++) {
    carveArchiveMazeCell(world, x, y);
    if (i > 2 && i + 2 < steps) {
      if (horizontal) carveArchiveMazeCell(world, x, y + side);
      else carveArchiveMazeCell(world, x + side, y);
    }
    if (i >= steps) continue;
    if (horizontal) x = world.wrap(x + step);
    else y = world.wrap(y + step);
  }
}

function connectArchiveWarrenRooms(
  world: World,
  graph: MazeGraph,
  edge: MazeGraphEdge,
  edgeIndex: number,
  roomsByNode: readonly Room[],
  keyDropRoomIds: number[],
): void {
  const nodeA = graph.nodes[edge.a];
  const nodeB = graph.nodes[edge.b];
  const roomA = roomsByNode[edge.a];
  const roomB = roomsByNode[edge.b];
  if (!nodeA || !nodeB || !roomA || !roomB) return;
  const dx = archiveGridDelta(graph.width, nodeA.gx, nodeB.gx);
  const dy = archiveGridDelta(graph.height, nodeA.gy, nodeB.gy);
  const dirX = dx === 0 ? 0 : dx > 0 ? 1 : -1;
  const dirY = dirX === 0 ? (dy > 0 ? 1 : -1) : 0;
  const a = archiveDoorPoint(world, roomA, dirX, dirY);
  const b = archiveDoorPoint(world, roomB, -dirX, -dirY);
  const locked = edge.tag === 'locked_optional';
  const state = locked ? DoorState.LOCKED : DoorState.CLOSED;
  const keyId = locked ? ARCHIVE_WARREN_KEY_ID : '';
  openArchiveDoor(world, roomA, a.wx, a.wy, state, keyId);
  openArchiveDoor(world, roomB, b.wx, b.wy, locked ? DoorState.CLOSED : state, locked ? '' : keyId);
  carveArchiveMazeLine(world, a.ox, a.oy, b.ox, b.oy, dirX, dirY, edgeIndex);
  if (locked) {
    const keyNodeId = nodeA.depth <= nodeB.depth ? nodeA.id : nodeB.id;
    keyDropRoomIds.push(roomsByNode[keyNodeId].id);
  }
}

function archiveOwnerLabel(owner: TerritoryOwner): string {
  if (owner === ZoneFaction.LIQUIDATOR) return 'ликвидаторов';
  if (owner === ZoneFaction.CULTIST) return 'культистов';
  if (owner === ZoneFaction.SCIENTIST) return 'НИИ';
  if (owner === ZoneFaction.WILD) return 'диких';
  return 'граждан';
}

function archiveRoomHasLandmarkName(room: Room): boolean {
  return ARCHIVE_WARREN_LANDMARK_NAMES.some(name => room.name.includes(name));
}

function archiveSupportRoomType(owner: TerritoryOwner, index: number): RoomType {
  if (owner === ZoneFaction.LIQUIDATOR) return [RoomType.OFFICE, RoomType.STORAGE, RoomType.MEDICAL, RoomType.PRODUCTION][index % 4];
  if (owner === ZoneFaction.CULTIST) return [RoomType.COMMON, RoomType.STORAGE, RoomType.MEDICAL, RoomType.OFFICE][index % 4];
  if (owner === ZoneFaction.SCIENTIST) return [RoomType.MEDICAL, RoomType.OFFICE, RoomType.PRODUCTION, RoomType.STORAGE][index % 4];
  if (owner === ZoneFaction.WILD) return [RoomType.STORAGE, RoomType.COMMON, RoomType.SMOKING, RoomType.KITCHEN][index % 4];
  return [RoomType.KITCHEN, RoomType.COMMON, RoomType.BATHROOM, RoomType.STORAGE][index % 4];
}

function archiveMicroRoomType(node: MazeGraphNode, index: number): RoomType {
  if (node.degree <= 1 && index < 2) return RoomType.STORAGE;
  if (node.degree >= 3 && index === 0) return RoomType.COMMON;
  return index % 3 === 1 ? RoomType.OFFICE : RoomType.STORAGE;
}

function decorateArchiveMicroRoom(world: World, room: Room, seed: number): void {
  applyRoomTexture(world, room, Tex.MARBLE, room.type === RoomType.OFFICE ? Tex.F_GREEN_CARPET : Tex.F_PARQUET);
  const midX = Math.floor(room.w / 2);
  const midY = Math.floor(room.h / 2);
  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.features[ci] !== Feature.NONE) continue;
      if (room.type === RoomType.OFFICE && (dx === midX || dy === midY)) {
        if (((seed + dx * 13 + dy * 17) & 3) === 0) world.features[ci] = Feature.DESK;
        continue;
      }
      if ((dx + dy + seed) % 3 === 0) world.features[ci] = Feature.SHELF;
    }
  }
  if (room.type === RoomType.STORAGE) placeRoomFeature(world, room, Feature.SHELF, midX, midY);
  else if (room.type === RoomType.OFFICE) placeRoomFeature(world, room, Feature.DESK, midX, midY);
  else placeRoomFeature(world, room, Feature.TABLE, midX, midY);
}

function decorateArchiveSupportRoom(world: World, room: Room, owner: TerritoryOwner, seed: number): void {
  const wallTex = room.type === RoomType.HQ ? Tex.HERMO_WALL : Tex.MARBLE;
  const floorTex = room.type === RoomType.BATHROOM ? Tex.F_TILE : room.type === RoomType.MEDICAL ? Tex.F_GREEN_CARPET : Tex.F_PARQUET;
  applyRoomTexture(world, room, wallTex, floorTex);
  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.features[ci] !== Feature.NONE) continue;
      if (((seed + dx * 19 + dy * 23) % 5) !== 0) continue;
      if (room.type === RoomType.KITCHEN) world.features[ci] = dx & 1 ? Feature.STOVE : Feature.SINK;
      else if (room.type === RoomType.BATHROOM) world.features[ci] = dx & 1 ? Feature.TOILET : Feature.SINK;
      else if (room.type === RoomType.MEDICAL || room.type === RoomType.OFFICE) world.features[ci] = Feature.DESK;
      else if (room.type === RoomType.PRODUCTION) world.features[ci] = Feature.MACHINE;
      else if (room.type === RoomType.COMMON) world.features[ci] = Feature.TABLE;
      else world.features[ci] = Feature.SHELF;
    }
  }
  const center = roomCenter(room);
  stampSurfaceSplat(
    world,
    center.x,
    center.y,
    0.5,
    0.5,
    room.type === RoomType.HQ ? 0.42 : 0.24,
    0.62,
    seed ^ owner * 997,
    owner === ZoneFaction.LIQUIDATOR ? 84 : owner === ZoneFaction.CULTIST ? 118 : owner === ZoneFaction.SCIENTIST ? 78 : 164,
    owner === ZoneFaction.WILD ? 102 : 154,
    owner === ZoneFaction.CITIZEN ? 112 : 142,
    false,
  );
}

function paintArchiveRoomTerritory(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.aptMask[ci]) continue;
      world.factionControl[ci] = owner;
    }
  }
}

function markArchiveHermeticShell(world: World, room: Room): void {
  room.sealed = true;
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

function connectArchiveRoomToRoom(world: World, from: Room, to: Room): void {
  const fromCenter = roomCenter(from);
  const toCenter = roomCenter(to);
  const a = roomExit(world, from, toCenter.x, toCenter.y);
  const b = roomExit(world, to, fromCenter.x, fromCenter.y);
  placeDoorAt(world, a.wx, a.wy, from.id);
  placeDoorAt(world, b.wx, b.wy, to.id);
  carveCorridor(world, a.ox, a.oy, b.ox, b.oy);
}

function connectArchiveRoomToPoint(world: World, room: Room, tx: number, ty: number): void {
  const exit = roomExit(world, room, tx, ty);
  placeDoorAt(world, exit.wx, exit.wy, room.id);
  carveCorridor(world, exit.ox, exit.oy, tx, ty);
}

function tryStampArchiveRoom(
  world: World,
  rooms: Room[],
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  seed: number,
): Room | null {
  const sx = world.wrap(x);
  const sy = world.wrap(y);
  if (!canPlaceRoom(world, sx, sy, w, h)) return null;
  const room = stampRoom(world, rooms.length, type, sx, sy, w, h, -1);
  room.name = name;
  decorateArchiveMicroRoom(world, room, seed);
  rooms.push(room);
  return room;
}

function addArchiveNodeMicroRooms(
  world: World,
  rooms: Room[],
  node: MazeGraphNode,
  main: Room,
  spec: ProceduralFloorSpec,
): Room[] {
  const out: Room[] = [];
  const count = 3 + Math.min(2, spec.danger);
  for (let i = 0; i < count; i++) {
    const offset = ARCHIVE_WARREN_MICRO_OFFSETS[i % ARCHIVE_WARREN_MICRO_OFFSETS.length];
    const type = archiveMicroRoomType(node, i);
    const w = 5 + ((spec.seed + node.id * 11 + i) % 3);
    const h = 5 + ((spec.seed + node.id * 17 + i * 3) % 3);
    const x = node.x + offset.dx - Math.floor(w / 2);
    const y = node.y + offset.dy - Math.floor(h / 2);
    const room = tryStampArchiveRoom(
      world,
      rooms,
      type,
      x,
      y,
      w,
      h,
      `${type === RoomType.OFFICE ? 'Архивная будка' : 'Архивная ячейка'} ${node.id}-${i + 1}`,
      spec.seed ^ node.id * 193 ^ i * 2003,
    );
    if (!room) continue;
    connectArchiveRoomToRoom(world, room, main);
    out.push(room);
  }
  return out;
}

function addArchiveEdgeAlcoveRooms(
  world: World,
  rooms: Room[],
  graph: MazeGraph,
  edge: MazeGraphEdge,
  edgeIndex: number,
  spec: ProceduralFloorSpec,
): void {
  const nodeA = graph.nodes[edge.a];
  const nodeB = graph.nodes[edge.b];
  if (!nodeA || !nodeB) return;
  const dx = archiveGridDelta(graph.width, nodeA.gx, nodeB.gx);
  const horizontal = dx !== 0;
  const worldDelta = horizontal ? world.delta(nodeA.x, nodeB.x) : world.delta(nodeA.y, nodeB.y);
  for (let i = 0; i < ARCHIVE_WARREN_EDGE_ALCOVE_OFFSETS.length; i++) {
    const t = ARCHIVE_WARREN_EDGE_ALCOVE_OFFSETS[i];
    const side = ((edgeIndex + i) & 1) === 0 ? 1 : -1;
    const px = horizontal ? world.wrap(Math.round(nodeA.x + worldDelta * t)) : nodeA.x;
    const py = horizontal ? nodeA.y : world.wrap(Math.round(nodeA.y + worldDelta * t));
    const w = 5 + ((spec.seed + edgeIndex * 5 + i) % 2);
    const h = 5 + ((spec.seed + edgeIndex * 7 + i) % 2);
    const x = horizontal ? px - Math.floor(w / 2) : px + side * 11 - Math.floor(w / 2);
    const y = horizontal ? py + side * 11 - Math.floor(h / 2) : py - Math.floor(h / 2);
    const room = tryStampArchiveRoom(
      world,
      rooms,
      RoomType.STORAGE,
      x,
      y,
      w,
      h,
      `Боковой регистр ${edgeIndex}-${i + 1}`,
      spec.seed ^ edgeIndex * 811 ^ i * 131,
    );
    if (!room) continue;
    connectArchiveRoomToPoint(world, room, px, py);
  }
}

function archiveClosestNode(
  world: World,
  graph: MazeGraph,
  owner: TerritoryOwner,
  used: Set<number>,
  landmarks: ReadonlySet<number>,
): MazeGraphNode {
  const target = ARCHIVE_WARREN_HQ_TARGETS[owner];
  let best = graph.nodes[0];
  let bestScore = Infinity;
  for (const node of graph.nodes) {
    if (used.has(node.id) || landmarks.has(node.id)) continue;
    const score = world.dist2(node.gx, node.gy, target.gx, target.gy) + node.id * 0.0001;
    if (score < bestScore) {
      best = node;
      bestScore = score;
    }
  }
  used.add(best.id);
  return best;
}

function configureArchiveHqRoom(world: World, room: Room, owner: TerritoryOwner, seed: number, outpost = false): void {
  room.type = RoomType.HQ;
  const role = outpost ? `форпост ${archiveOwnerLabel(owner)}` : `гермоштаб ${archiveOwnerLabel(owner)}`;
  room.name = archiveRoomHasLandmarkName(room) ? `${room.name}: ${role}` : `Архивный ${role}${outpost ? ` ${room.id}` : ''}`;
  decorateArchiveSupportRoom(world, room, owner, seed);
  markArchiveHermeticShell(world, room);
  paintArchiveRoomTerritory(world, room, owner);
}

function configureArchiveSupportRoom(world: World, room: Room, owner: TerritoryOwner, index: number, seed: number): void {
  room.type = archiveSupportRoomType(owner, index);
  room.name = `Архивная опора ${archiveOwnerLabel(owner)} ${index + 1}`;
  decorateArchiveSupportRoom(world, room, owner, seed ^ index * 977);
  paintArchiveRoomTerritory(world, room, owner);
}

function placeArchiveFactionHqClusters(
  world: World,
  graph: MazeGraph,
  roomsByNode: readonly Room[],
  microRoomsByNode: readonly Room[][],
  spec: ProceduralFloorSpec,
): void {
  const used = new Set<number>();
  const landmarks = new Set(graph.landmarkIds);
  const majorityOwner = majorityById(spec.majorityId).zoneFaction;
  for (const owner of ARCHIVE_WARREN_HQ_OWNERS) {
    const node = archiveClosestNode(world, graph, owner, used, landmarks);
    const hq = roomsByNode[node.id];
    if (!hq) continue;
    configureArchiveHqRoom(world, hq, owner, spec.seed ^ owner * 1009);
    const supports = microRoomsByNode[node.id] ?? [];
    for (let i = 0; i < Math.min(4, supports.length); i++) {
      configureArchiveSupportRoom(world, supports[i], owner, i, spec.seed ^ node.id * 307 ^ owner * 571);
    }
  }
  let best1: MazeGraphNode | null = null;
  let best2: MazeGraphNode | null = null;
  let dist1 = Infinity;
  let dist2 = Infinity;
  const target = ARCHIVE_WARREN_HQ_TARGETS[majorityOwner];

  for (let i = 0; i < graph.nodes.length; i++) {
    const node = graph.nodes[i];
    if (used.has(node.id) || landmarks.has(node.id)) continue;
    const d2 = world.dist2(node.gx, node.gy, target.gx, target.gy);
    if (d2 < dist1) {
      best2 = best1;
      dist2 = dist1;
      best1 = node;
      dist1 = d2;
    } else if (d2 < dist2) {
      best2 = node;
      dist2 = d2;
    }
  }

  const majorityNodes: MazeGraphNode[] = [];
  if (best1) majorityNodes.push(best1);
  if (best2) majorityNodes.push(best2);
  for (let i = 0; i < Math.min(2, majorityNodes.length); i++) {
    const room = roomsByNode[majorityNodes[i].id];
    if (!room) continue;
    configureArchiveHqRoom(world, room, majorityOwner, spec.seed ^ majorityNodes[i].id * 811, true);
  }
}

function restoreArchiveLandmarkNames(roomsByNode: readonly Room[], landmarkOrder: ReadonlyMap<number, number>): void {
  for (const [nodeId, order] of landmarkOrder) {
    const room = roomsByNode[nodeId];
    if (!room || archiveRoomHasLandmarkName(room)) continue;
    const landmarkName = `${ARCHIVE_WARREN_LANDMARK_NAMES[order % ARCHIVE_WARREN_LANDMARK_NAMES.length]} ${room.id}`;
    room.name = room.type === RoomType.HQ ? `${landmarkName}: ${room.name}` : landmarkName;
  }
}

// @ts-expect-error TS6133 — preserved as reference; replaced by recipe system
function buildArchiveWarrenRooms(world: World, spec: ProceduralFloorSpec): { rooms: Room[]; spawnX: number; spawnY: number } {
  const graph = generateWilsonMaze({
    width: ARCHIVE_WARREN_GRID,
    height: ARCHIVE_WARREN_GRID,
    originX: ARCHIVE_WARREN_ORIGIN,
    originY: ARCHIVE_WARREN_ORIGIN,
    cellSize: ARCHIVE_WARREN_CELL,
    startGx: Math.floor(ARCHIVE_WARREN_GRID / 2),
    startGy: Math.floor(ARCHIVE_WARREN_GRID / 2),
    endGx: ARCHIVE_WARREN_GRID - 2,
    endGy: ARCHIVE_WARREN_GRID - 2,
    braidChance: 0.3 + spec.danger * 0.04,
    extraChordCount: 14 + spec.danger * 3,
    lockedChordChance: 0.12 + spec.danger * 0.025,
    rewardLeafChance: 0.56,
    landmarkCount: 7 + spec.danger,
    rand: xorshift32((spec.seed ^ 0x39039) >>> 0),
  });
  ensureArchiveLockedChords(graph, Math.min(4, 1 + Math.floor(spec.danger / 2)));
  const validation = validateMazeGraph(graph);
  if (!validation.liftBackboneUngated || !validation.optionalLocksValid) {
    for (const edge of graph.edges) if (edge.tag === 'locked_optional') edge.tag = 'chord';
  }

  const rooms: Room[] = [];
  const roomsByNode: Room[] = new Array(graph.nodes.length);
  const landmarkOrder = new Map<number, number>();
  for (let i = 0; i < graph.landmarkIds.length; i++) landmarkOrder.set(graph.landmarkIds[i], i);

  for (const node of graph.nodes) {
    const landmarkIndex = landmarkOrder.get(node.id) ?? -1;
    const type = archiveRoomType(node, landmarkIndex);
    const size = archiveRoomSize(type, landmarkIndex);
    const x = world.wrap(node.x - Math.floor(size.w / 2));
    const y = world.wrap(node.y - Math.floor(size.h / 2));
    const room = stampRoom(world, rooms.length, type, x, y, size.w, size.h, -1);
    decorateArchiveWarrenRoom(world, room, node, landmarkIndex);
    rooms.push(room);
    roomsByNode[node.id] = room;
  }

  const microRoomsByNode: Room[][] = Array.from({ length: graph.nodes.length }, () => []);
  for (const node of graph.nodes) {
    const main = roomsByNode[node.id];
    if (!main) continue;
    microRoomsByNode[node.id] = addArchiveNodeMicroRooms(world, rooms, node, main, spec);
  }
  for (let i = 0; i < graph.edges.length; i++) {
    addArchiveEdgeAlcoveRooms(world, rooms, graph, graph.edges[i], i, spec);
  }
  placeArchiveFactionHqClusters(world, graph, roomsByNode, microRoomsByNode, spec);
  restoreArchiveLandmarkNames(roomsByNode, landmarkOrder);

  const keyDropRoomIds: number[] = [];
  for (let i = 0; i < graph.edges.length; i++) {
    connectArchiveWarrenRooms(world, graph, graph.edges[i], i, roomsByNode, keyDropRoomIds);
  }

  const landmarkAnchors = graph.landmarkIds.map((id, order) => {
    const room = roomsByNode[id];
    const center = roomCenter(room);
    return { id: `archive_landmark_${order}`, x: center.x, y: center.y };
  });
  archiveWarrenIntents.set(world, { graph, roomsByNode, microRoomsByNode, landmarkAnchors, keyDropRoomIds });

  const start = roomsByNode[graph.startId];
  const center = roomCenter(start);
  sanitizeDoors(world);
  ensureConnectivity(world, center.x + 0.5, center.y + 0.5);
  return { rooms, spawnX: center.x + 0.5, spawnY: center.y + 0.5 };
}

function adminMicroRoomSize(type: RoomType): { w: number; h: number } {
  if (type === RoomType.BATHROOM) return { w: irng(4, 6), h: irng(4, 6) };
  if (type === RoomType.KITCHEN) return { w: irng(5, 8), h: irng(5, 8) };
  if (type === RoomType.MEDICAL) return { w: irng(6, 9), h: irng(5, 8) };
  if (type === RoomType.STORAGE) return { w: irng(5, 9), h: irng(4, 8) };
  return { w: irng(6, 11), h: irng(5, 9) };
}

function connectAdminMicroRoom(world: World, hub: Room, room: Room, salt: number): void {
  const hc = roomCenter(hub);
  const rc = roomCenter(room);
  const exitA = roomExit(world, hub, rc.x, rc.y);
  const exitB = roomExit(world, room, hc.x, hc.y);
  placeDoorAt(world, exitA.wx, exitA.wy, hub.id);
  placeDoorAt(world, exitB.wx, exitB.wy, room.id);
  if ((salt & 1) === 0) carveCorridor(world, exitA.ox, exitA.oy, exitB.ox, exitB.oy);
  else carveCorridor(world, exitB.ox, exitB.oy, exitA.ox, exitA.oy);
}

function applyAdminPocketMicroClusters(world: World, rooms: Room[], spec: ProceduralFloorSpec, nextRoomId: { v: number }): void {
  if (spec.geometryId !== 'admin_pockets') return;
  const cols = 8;
  const rows = 8;
  const slotW = Math.floor(W / cols);
  const slotH = Math.floor(W / rows);
  const sideTypes = [RoomType.OFFICE, RoomType.STORAGE, RoomType.BATHROOM, RoomType.KITCHEN, RoomType.OFFICE, RoomType.MEDICAL] as const;
  let clusters = 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (clusters >= 52 + spec.danger * 4) break;
      const seed = spec.seed ^ Math.imul(row * cols + col + 1, 0x45d9f3b);
      if (fieldHash01(seed, row, col, 0xa11) < 0.18) continue;
      const horizontal = (seed & 1) === 0;
      const hubW = horizontal ? irng(18, 30) : irng(4, 6);
      const hubH = horizontal ? irng(4, 6) : irng(18, 30);
      const cx = col * slotW + Math.floor(slotW * (0.34 + fieldHash01(seed, col, row, 0xa12) * 0.32));
      const cy = row * slotH + Math.floor(slotH * (0.34 + fieldHash01(seed, col, row, 0xa13) * 0.32));
      const hx = world.wrap(cx - (hubW >> 1));
      const hy = world.wrap(cy - (hubH >> 1));
      if (!canPlaceRoom(world, hx, hy, hubW, hubH)) continue;

      const hub = stampRoom(world, nextRoomId.v++, RoomType.COMMON, hx, hy, hubW, hubH, -1);
      hub.name = `Очередной остров ${hub.id}`;
      applyRoomTexture(world, hub, Tex.MARBLE, (clusters & 1) === 0 ? Tex.F_RED_CARPET : Tex.F_MARBLE_TILE);
      decorateAdminQueueRoom(world, hub, clusters + 2, spec);
      rooms.push(hub);

      let localRooms = 0;
      for (let i = 0; i < sideTypes.length; i++) {
        const type = sideTypes[(i + clusters) % sideTypes.length];
        const size = adminMicroRoomSize(type);
        const side = (i & 1) === 0 ? -1 : 1;
        const lane = Math.floor(i / 2) - 1;
        const x = horizontal
          ? world.wrap(hx + Math.max(0, Math.min(hubW - size.w, 2 + lane * 9 + ((seed >> (i + 2)) & 3))))
          : world.wrap(hx + (side < 0 ? -size.w - 3 : hubW + 3));
        const y = horizontal
          ? world.wrap(hy + (side < 0 ? -size.h - 3 : hubH + 3))
          : world.wrap(hy + Math.max(0, Math.min(hubH - size.h, 2 + lane * 9 + ((seed >> (i + 3)) & 3))));
        if (!canPlaceRoom(world, x, y, size.w, size.h)) continue;
        const room = stampRoom(world, nextRoomId.v++, type, x, y, size.w, size.h, -1);
        room.name = type === RoomType.BATHROOM
          ? `Туалет очереди ${room.id}`
          : type === RoomType.KITCHEN
            ? `Комната кипятка ${room.id}`
            : type === RoomType.MEDICAL
              ? `Кабинет справки о здоровье ${room.id}`
              : type === RoomType.STORAGE
                ? `Архивная ячейка ${room.id}`
                : `Кабина справки ${room.id}`;
        applyRoomTexture(world, room, Tex.MARBLE, type === RoomType.STORAGE ? Tex.F_MARBLE_TILE : Tex.F_PARQUET);
        if (type === RoomType.OFFICE || type === RoomType.STORAGE || type === RoomType.MEDICAL) {
          decorateAdminOfficeSlab(world, room, seed ^ i * 193);
        } else {
          decorateProceduralRoom(world, room, spec);
        }
        rooms.push(room);
        connectAdminMicroRoom(world, hub, room, seed + i);
        localRooms++;
      }
      if (localRooms >= 2) clusters++;
    }
  }
}
/* ── Void-fill pass ────────────────────────────────────────── */
/*                                                              */
/*  Scans a coarse grid for tiles with low floor coverage and   */
/*  aggressively scatters rooms + corridors into the gaps.      */

const VOID_TILE = 32;  // coarse grid tile size
const VOID_TILES_PER_AXIS = W / VOID_TILE; // 1024/32 = 32
const VOID_COVERAGE_THRESHOLD = 0.25; // tiles below 25% coverage are voids
const VOID_FILL_ATTEMPTS_PER_TILE = 120;

function measureTileCoverage(world: World, tileX: number, tileY: number): number {
  const x0 = tileX * VOID_TILE;
  const y0 = tileY * VOID_TILE;
  let floor = 0;
  for (let dy = 0; dy < VOID_TILE; dy++) {
    for (let dx = 0; dx < VOID_TILE; dx++) {
      const ci = world.idx(x0 + dx, y0 + dy);
      const c = world.cells[ci];
      if (c === Cell.FLOOR || c === Cell.DOOR || c === Cell.WATER) floor++;
    }
  }
  return floor / (VOID_TILE * VOID_TILE);
}

function voidFillRoomSize(seed: number, industrial: boolean): { w: number; h: number; type: RoomType } {
  const variant = (seed >>> 0) % 8;
  switch (variant) {
    case 0: return { w: 5 + (seed >>> 8 & 3), h: 5 + (seed >>> 10 & 3), type: RoomType.COMMON };
    case 1: return { w: 7 + (seed >>> 8 & 5), h: 6 + (seed >>> 11 & 4), type: RoomType.STORAGE };
    case 2: return { w: 4 + (seed >>> 8 & 3), h: 4 + (seed >>> 10 & 3), type: RoomType.BATHROOM };
    case 3: return { w: 8 + (seed >>> 8 & 7), h: 6 + (seed >>> 11 & 5), type: RoomType.OFFICE };
    case 4: return { w: 10 + (seed >>> 8 & 7), h: 8 + (seed >>> 11 & 5), type: industrial ? RoomType.PRODUCTION : RoomType.LIVING };
    case 5: return { w: 6 + (seed >>> 8 & 4), h: 5 + (seed >>> 10 & 3), type: RoomType.KITCHEN };
    case 6: return { w: 6 + (seed >>> 8 & 5), h: 6 + (seed >>> 10 & 5), type: RoomType.SMOKING };
    default: return { w: 12 + (seed >>> 8 & 9), h: 4 + (seed >>> 12 & 2), type: RoomType.CORRIDOR };
  }
}

function fillVoidGaps(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  geom: FloorGeometryDef,
  nextRoomId: { v: number },
  industrial: boolean,
): void {
  // Scan coarse grid for void tiles
  const voidTiles: { tx: number; ty: number; coverage: number }[] = [];
  for (let ty = 0; ty < VOID_TILES_PER_AXIS; ty++) {
    for (let tx = 0; tx < VOID_TILES_PER_AXIS; tx++) {
      const cov = measureTileCoverage(world, tx, ty);
      if (cov < VOID_COVERAGE_THRESHOLD) {
        voidTiles.push({ tx, ty, coverage: cov });
      }
    }
  }

  if (voidTiles.length === 0) return;

  // Sort by coverage ascending — fill emptiest first
  voidTiles.sort((a, b) => a.coverage - b.coverage);

  let st = (spec.seed ^ 0xDEAD_BEEF) >>> 0;
  let filled = 0;
  const maxFill = Math.min(voidTiles.length * 6, 800); // cap total void-fill rooms

  for (const tile of voidTiles) {
    if (filled >= maxFill) break;
    const baseX = tile.tx * VOID_TILE;
    const baseY = tile.ty * VOID_TILE;

    for (let attempt = 0; attempt < VOID_FILL_ATTEMPTS_PER_TILE && filled < maxFill; attempt++) {
      st ^= st << 13; st ^= st >>> 17; st ^= st << 5; st = st >>> 0;
      const rs = voidFillRoomSize(st, industrial);
      st ^= st << 13; st ^= st >>> 17; st ^= st << 5; st = st >>> 0;

      // Place within the void tile, with a small margin to allow some overlap into neighbors
      const margin = 2;
      const rangeW = Math.max(1, VOID_TILE - rs.w + margin * 2);
      const rangeH = Math.max(1, VOID_TILE - rs.h + margin * 2);
      const x = baseX - margin + ((st >>> 0) % rangeW);
      const y = baseY - margin + ((st >>> 16) % rangeH);

      const wx = world.wrap(x);
      const wy = world.wrap(y);

      if (!canPlaceRoom(world, wx, wy, rs.w, rs.h)) continue;

      nextRoomId.v = Math.max(nextRoomId.v, world.rooms.length);
      const room = stampRoom(world, nextRoomId.v++, rs.type, wx, wy, rs.w, rs.h, -1);
      room.name = proceduralRoomName(spec, room);
      applyRoomTexture(world, room, geom.wallTex, geom.floorTex);
      if (rs.type === RoomType.COMMON || rs.type === RoomType.PRODUCTION || rs.type === RoomType.CORRIDOR) {
        if (chance(0.45)) shapeRoom(world, room);
        decorateRoom(world, room);
      }
      decorateProceduralRoom(world, room, spec);
      rooms.push(room);
      filled++;
    }
  }
}

/* ── Composite recipe-based room generation ────────────────── */
/*                                                              */
/*  Divides the torus into 2-4 sectors and fills each with a    */
/*  different geometry recipe from the FloorGeometryDef's pool.  */
/*  This produces heterogeneous, dense, non-repetitive floors.  */

function pickRecipesForSpec(
  _spec: ProceduralFloorSpec,
  geom: { recipePool: readonly ProceduralRecipeId[] },
  sectorCount: number,
  seed: number,
): ProceduralRecipeId[] {
  const pool = geom.recipePool;
  if (pool.length === 0) return Array(sectorCount).fill('dense_room_scatter' as ProceduralRecipeId);
  const result: ProceduralRecipeId[] = [];
  let st = seed >>> 0;
  const used = new Set<number>();
  for (let i = 0; i < sectorCount; i++) {
    // Prefer variety — avoid repeats when pool allows
    let pickIdx: number;
    for (let attempt = 0; attempt < 20; attempt++) {
      st ^= st << 13; st ^= st >>> 17; st ^= st << 5; st = st >>> 0;
      pickIdx = (st & 0x7FFFFFFF) % pool.length;
      if (!used.has(pickIdx) || used.size >= pool.length) break;
    }
    pickIdx = (st & 0x7FFFFFFF) % pool.length;
    used.add(pickIdx);
    result.push(pool[pickIdx]);
  }
  return result;
}

function buildCompositeRooms(world: World, spec: ProceduralFloorSpec): { rooms: Room[]; spawnX: number; spawnY: number } {
  const geom = geometryById(spec.geometryId);
  const industrial = geom.tags.includes('industrial');
  const nextRoomId = { v: 0 };
  const allRooms: Room[] = [];

  // Phase 1: Macro layer (large anchor halls — preserves existing behaviour)
  const macroLayer = buildProceduralMacroLayer(world, allRooms, spec, nextRoomId, industrial);
  if (spec.geometryId === 'communal_knots') {
    const hqAnchor = allRooms[0];
    const hqSpawnX = hqAnchor ? hqAnchor.x + Math.floor(hqAnchor.w / 2) + 0.5 : W / 2 + 0.5;
    const hqSpawnY = hqAnchor ? hqAnchor.y + Math.floor(hqAnchor.h / 2) + 0.5 : W / 2 + 0.5;
    placeProceduralMiniHqClusters(world, allRooms, spec, hqSpawnX, hqSpawnY);
    nextRoomId.v = Math.max(nextRoomId.v, world.rooms.length);
  }

  // Phase 2: Composite recipe-based sector generation
  const strategy = pickSectorStrategy(spec.seed);
  const sectors = divideTorus(strategy, spec.seed);
  const recipes = pickRecipesForSpec(spec, geom, sectors.length, spec.seed ^ 0xC0DE);

  for (let si = 0; si < sectors.length; si++) {
    const sector = sectors[si];
    const recipeId = recipes[si];
    const sectorSeed = (spec.seed ^ (si * 0x9E3779B9)) >>> 0;
    const ctx: RecipeContext = {
      world,
      region: sector,
      seed: sectorSeed,
      tex: {
        wallTex: geom.wallTex,
        floorTex: geom.floorTex,
        roomTypes: geom.roomTypes,
      },
      nextRoomId,
      industrial,
    };
    const result = executeRecipe(recipeId, ctx);
    for (const room of result.rooms) {
      // Set naming consistent with geometry
      if (!room.name || room.name.startsWith('Помещение') || room.name.startsWith('Ячейка')) {
        room.name = proceduralRoomName(spec, room);
      }
      allRooms.push(room);
    }
  }

  // Phase 2.5: Void-fill pass — fill large black gaps left by sparse recipes
  fillVoidGaps(world, allRooms, spec, geom, nextRoomId, industrial);

  // Phase 3: Specialist micro-cluster overlays (preserve existing detail passes)
  applyAdminPocketMicroClusters(world, allRooms, spec, nextRoomId);
  applyWorkshopClusterRooms(world, allRooms, spec, nextRoomId);
  applyCollectorStationClusters(world, allRooms, spec, nextRoomId);
  const firstRoom = allRooms[0];
  const earlySpawnX = firstRoom ? firstRoom.x + Math.floor(firstRoom.w / 2) + 0.5 : W / 2 + 0.5;
  const earlySpawnY = firstRoom ? firstRoom.y + Math.floor(firstRoom.h / 2) + 0.5 : W / 2 + 0.5;
  applyCollectorMirrorInfill(world, allRooms, spec, nextRoomId, earlySpawnX, earlySpawnY);
  applyCommunalKnotClusterRooms(world, allRooms, spec, nextRoomId, earlySpawnX, earlySpawnY);

  // Phase 4: Connectivity
  stitchSectorBoundaries(world, sectors, spec.seed ^ 0x9999);
  connectRoomsMST(world, allRooms);
  const first = allRooms[0];
  const spawnX = first ? first.x + Math.floor(first.w / 2) + 0.5 : W / 2 + 0.5;
  const spawnY = first ? first.y + Math.floor(first.h / 2) + 0.5 : W / 2 + 0.5;
  applyProceduralStructureLibrary(world, allRooms, spec, spawnX, spawnY);
  applyProceduralMacroNetwork(world, allRooms, spec, macroLayer, spawnX, spawnY);
  ensureConnectivity(world, spawnX, spawnY);
  sanitizeDoors(world);
  return { rooms: allRooms, spawnX, spawnY };
}

function buildRooms(world: World, spec: ProceduralFloorSpec): { rooms: Room[]; spawnX: number; spawnY: number } {
  // Anomaly overrides — completely replace geometry
  if (spec.anomalyId === 'conway_life') return buildConwayLifeFieldRooms(world, spec);
  if (spec.anomalyId === 'wall_snake') return buildWallSnakeFieldRooms(world, spec);

  // Universal composite recipe-based generation for all geometry IDs
  return buildCompositeRooms(world, spec);
}

import { carveOrganicCorridor } from './shared';

function stitchSectorBoundaries(world: World, sectors: RecipeRegion[], seed: number): void {
  let st = seed >>> 0;
  for (let i = 0; i < sectors.length; i++) {
    for (let j = i + 1; j < sectors.length; j++) {
      const A = sectors[i];
      const B = sectors[j];
      
      let sharedX = -1;
      let sharedY = -1;
      let minCross = 0;
      let maxCross = 0;
      let isVerticalEdge = false;

      // Horizontal adjacency
      if (A.x0 + A.w === B.x0 || B.x0 + B.w === A.x0 || (A.x0 + A.w === W && B.x0 === 0) || (B.x0 + B.w === W && A.x0 === 0)) {
        sharedX = (A.x0 + A.w === B.x0 || (A.x0 + A.w === W && B.x0 === 0)) ? B.x0 : A.x0;
        isVerticalEdge = true;
        const yStart = Math.max(A.y0, B.y0);
        const yEnd = Math.min(A.y0 + A.h, B.y0 + B.h);
        if (yStart < yEnd) { minCross = yStart; maxCross = yEnd; }
      } else if (A.y0 + A.h === B.y0 || B.y0 + B.h === A.y0 || (A.y0 + A.h === W && B.y0 === 0) || (B.y0 + B.h === W && A.y0 === 0)) {
        // Vertical adjacency
        sharedY = (A.y0 + A.h === B.y0 || (A.y0 + A.h === W && B.y0 === 0)) ? B.y0 : A.y0;
        isVerticalEdge = false;
        const xStart = Math.max(A.x0, B.x0);
        const xEnd = Math.min(A.x0 + A.w, B.x0 + B.w);
        if (xStart < xEnd) { minCross = xStart; maxCross = xEnd; }
      }

      if (minCross < maxCross) {
        const count = 2; // Punch 2 corridors per boundary
        for (let c = 0; c < count; c++) {
          st ^= st << 13; st ^= st >>> 17; st ^= st << 5; st = st >>> 0;
          const cross = minCross + 2 + (st % Math.max(1, maxCross - minCross - 4));
          
          let ax = isVerticalEdge ? world.wrap(sharedX - 1) : cross;
          let ay = isVerticalEdge ? cross : world.wrap(sharedY - 1);
          let bx = isVerticalEdge ? sharedX : cross;
          let by = isVerticalEdge ? cross : sharedY;

          // Which sector is A and which is B relative to ax, ay?
          // If we stepped left to ax, then ax is inside the left sector.
          // Direction to walk into ax's sector is -1 on X.
          let dxA = 0, dyA = 0;
          if (isVerticalEdge) {
            dxA = (ax === world.wrap(A.x0 + A.w - 1) || ax === world.wrap(A.x0 - 1)) ? -1 : 1;
            // Actually, simply: the boundary is at sharedX. ax is sharedX - 1. So walking "away" from boundary is -1.
            dxA = -1;
          } else {
            dyA = -1;
          }
          
          let validA = false;
          let cxA = ax, cyA = ay;
          const pathA: number[] = [];
          for (let step = 0; step < 40; step++) {
            const ci = world.idx(cxA, cyA);
            pathA.push(ci);
            if (!world.aptMask[ci] && (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.DOOR)) {
              validA = true; break;
            }
            cxA = world.wrap(cxA + dxA);
            cyA = world.wrap(cyA + dyA);
          }

          let validB = false;
          let cxB = bx, cyB = by;
          const dxB = -dxA;
          const dyB = -dyA;
          const pathB: number[] = [];
          for (let step = 0; step < 40; step++) {
            const ci = world.idx(cxB, cyB);
            pathB.push(ci);
            if (!world.aptMask[ci] && (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.DOOR)) {
              validB = true; break;
            }
            cxB = world.wrap(cxB + dxB);
            cyB = world.wrap(cyB + dyB);
          }

          if (validA && validB) {
            carveOrganicCorridor(world, cxA, cyA, cxB, cyB, st ^ 0x9B1A, true);
          }
        }
      }
    }
  }
}

function proceduralRoomName(spec: ProceduralFloorSpec, room: Room): string {
  const prefix = spec.geometryId === 'workshops'
    ? 'Цех'
    : spec.geometryId === 'collectors'
      ? 'Канал'
      : spec.geometryId === 'sump_causeways'
        ? 'Эстакада'
        : spec.geometryId === 'service_spines'
          ? 'Штрек'
          : spec.geometryId === 'attic_weatherworks'
            ? 'Венткамера'
            : spec.geometryId === 'archive_warrens'
              ? 'Стеллаж'
              : spec.geometryId === 'admin_pockets'
                ? 'Кабинет'
                : spec.geometryId === 'communal_knots'
                  ? 'Узел'
                  : 'Комната';
  if (room.type === RoomType.PRODUCTION) return `${prefix} ${room.id}`;
  if (room.type === RoomType.CORRIDOR) return `Ход ${room.id}`;
  if (room.type === RoomType.STORAGE) return `Кладовая ${room.id}`;
  if (room.type === RoomType.OFFICE) return `Контора ${room.id}`;
  return `${prefix} ${room.id}`;
}

function collectorStationRoomType(index: number): RoomType {
  if (index % 5 === 0) return RoomType.PRODUCTION;
  if (index % 5 === 1) return RoomType.STORAGE;
  if (index % 5 === 2) return RoomType.OFFICE;
  if (index % 5 === 3) return RoomType.BATHROOM;
  return RoomType.COMMON;
}

function collectorStationRoomSize(type: RoomType, seed: number): { w: number; h: number } {
  if (type === RoomType.BATHROOM) return { w: 4 + (seed & 1), h: 4 + ((seed >> 1) & 1) };
  if (type === RoomType.OFFICE) return { w: 6 + (seed % 4), h: 5 + ((seed >> 2) % 4) };
  if (type === RoomType.STORAGE) return { w: 6 + (seed % 5), h: 5 + ((seed >> 3) % 4) };
  if (type === RoomType.PRODUCTION) return { w: 10 + (seed % 8), h: 7 + ((seed >> 4) % 6) };
  return { w: 7 + (seed % 5), h: 6 + ((seed >> 5) % 4) };
}

function collectorStationRoomName(type: RoomType, id: number, cluster: number): string {
  if (type === RoomType.PRODUCTION) return `Насосная станция коллектора ${cluster}.${id}`;
  if (type === RoomType.STORAGE) return `Кладовая вентилей коллектора ${cluster}.${id}`;
  if (type === RoomType.OFFICE) return `Смотровая будка коллектора ${cluster}.${id}`;
  if (type === RoomType.BATHROOM) return `Санузел смены коллектора ${cluster}.${id}`;
  return `Сухая бытовка коллектора ${cluster}.${id}`;
}

function decorateCollectorStationRoom(world: World, room: Room, spec: ProceduralFloorSpec, salt: number): void {
  applyRoomTexture(world, room, Tex.PIPE, room.type === RoomType.BATHROOM ? Tex.F_TILE : Tex.F_CONCRETE);
  if (room.type === RoomType.PRODUCTION || room.type === RoomType.COMMON) shapeRoom(world, room);
  decorateRoom(world, room);
  decorateProceduralRoom(world, room, spec);
  if (room.type === RoomType.PRODUCTION) placeRoomFeature(world, room, (salt & 1) === 0 ? Feature.MACHINE : Feature.APPARATUS, Math.floor(room.w / 2), Math.floor(room.h / 2));
  else if (room.type === RoomType.STORAGE) placeRoomFeature(world, room, Feature.SHELF, Math.floor(room.w / 2), Math.floor(room.h / 2));
  else if (room.type === RoomType.OFFICE) placeRoomFeature(world, room, Feature.SCREEN, Math.floor(room.w / 2), Math.floor(room.h / 2));
  else if (room.type === RoomType.BATHROOM) {
    placeRoomFeature(world, room, Feature.TOILET, 1, 1);
    placeRoomFeature(world, room, Feature.SINK, room.w - 2, 1);
  } else {
    placeRoomFeature(world, room, (salt & 1) === 0 ? Feature.TABLE : Feature.LAMP, Math.floor(room.w / 2), Math.floor(room.h / 2));
  }
}

function roomAreaScore(room: Room): number {
  return room.w * room.h;
}

function collectorStationClusterTarget(spec: ProceduralFloorSpec): number {
  return COLLECTOR_STATION_CLUSTER_TARGET
    + (spec.anomalyId === 'smog' ? 8 : 0)
    + (spec.majorityId === 'liquidators' ? 4 : 0);
}

function collectorStationMicroRoomTarget(spec: ProceduralFloorSpec): number {
  return COLLECTOR_STATION_MICRO_ROOM_TARGET
    + (spec.anomalyId === 'smog' ? 42 : 0)
    + (spec.majorityId === 'liquidators' ? 14 : 0);
}

function tryPlaceCollectorStationRoom(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  source: Room,
  nextRoomId: { v: number },
  cluster: number,
  index: number,
): Room | null {
  const type = collectorStationRoomType(index);
  const seed = spec.seed ^ (source.id * 173 + cluster * 457 + index * 811);
  const size = collectorStationRoomSize(type, seed);
  const center = roomCenter(source);
  const dirs = [0, 1, 2, 3].sort((a, b) =>
    fieldHash01(seed, a, source.id, 0x6101) - fieldHash01(seed, b, source.id, 0x6101),
  );
  for (const dir of dirs) {
    for (let gap = 5; gap <= 22; gap += 4) {
      let x = Math.floor(center.x - size.w / 2);
      let y = Math.floor(center.y - size.h / 2);
      if (dir === 0) x = source.x + source.w + gap;
      else if (dir === 1) x = source.x - gap - size.w;
      else if (dir === 2) y = source.y + source.h + gap;
      else y = source.y - gap - size.h;
      if (x < 18 || y < 18 || x + size.w >= W - 18 || y + size.h >= W - 18) continue;
      if (!canPlaceRoom(world, x, y, size.w, size.h)) continue;
      nextRoomId.v = Math.max(nextRoomId.v, world.rooms.length);
      const room = stampRoom(world, nextRoomId.v++, type, x, y, size.w, size.h, -1);
      room.name = collectorStationRoomName(type, room.id, cluster);
      decorateCollectorStationRoom(world, room, spec, seed);
      rooms.push(room);
      connectRoomsMST(world, [source, room]);
      return room;
    }
  }
  return null;
}

function applyCollectorStationClusters(world: World, rooms: Room[], spec: ProceduralFloorSpec, nextRoomId: { v: number }): void {
  if (spec.geometryId !== 'collectors') return;
  const clusterTarget = collectorStationClusterTarget(spec);
  const microRoomTarget = collectorStationMicroRoomTarget(spec);
  const sources = rooms
    .filter(room => (
      room.id !== 0 &&
      room.apartmentId < 0 &&
      (room.type === RoomType.PRODUCTION || room.type === RoomType.STORAGE || room.type === RoomType.COMMON || room.type === RoomType.CORRIDOR)
    ))
    .sort((a, b) => roomAreaScore(b) - roomAreaScore(a));
  const centers: { x: number; y: number }[] = [];
  let clusters = 0;
  let microRooms = 0;
  for (const source of sources) {
    if (clusters >= clusterTarget || microRooms >= microRoomTarget) break;
    const center = roomCenter(source);
    if (centers.some(item => world.dist2(item.x, item.y, center.x, center.y) < COLLECTOR_STATION_CLUSTER_MIN_SPACING)) continue;
    const localTarget = 4 + (clusters % 3);
    let localPlaced = 0;
    for (let i = 0; i < localTarget && microRooms < microRoomTarget; i++) {
      const room = tryPlaceCollectorStationRoom(world, rooms, spec, source, nextRoomId, clusters + 1, i);
      if (!room) continue;
      localPlaced++;
      microRooms++;
    }
    if (localPlaced === 0) continue;
    centers.push(center);
    clusters++;
  }
  if (clusters > 0) {
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFeaturesDirty(true);
  }
}

type MirrorAxis = 'x' | 'y';

function collectorMirrorCoord(v: number, axisValue: number): number {
  return (axisValue * 2 - v + W) & (W - 1);
}

function collectorMirrorAxis(spec: ProceduralFloorSpec, spawnX: number, spawnY: number): { axis: MirrorAxis; value: number } {
  const axis: MirrorAxis = (spec.seed & 1) === 0 ? 'x' : 'y';
  const base = axis === 'x' ? Math.floor(spawnX) : Math.floor(spawnY);
  return {
    axis,
    value: (base + 192 + Math.floor(fieldHash01(spec.seed, spec.ordinal, spec.z, 0x5a88) * 128)) & (W - 1),
  };
}

function collectorMirrorRoomType(index: number, gallery: boolean): RoomType {
  if (gallery) return index % 3 === 0 ? RoomType.PRODUCTION : RoomType.COMMON;
  if (index % 6 === 0) return RoomType.BATHROOM;
  if (index % 6 === 1) return RoomType.STORAGE;
  if (index % 6 === 2) return RoomType.OFFICE;
  if (index % 6 === 3) return RoomType.KITCHEN;
  if (index % 6 === 4) return RoomType.PRODUCTION;
  return RoomType.COMMON;
}

function collectorMirrorRoomSize(type: RoomType, seed: number, gallery: boolean, horizontal: boolean): { w: number; h: number } {
  if (gallery) {
    const long = 34 + (seed % 19);
    const short = 14 + ((seed >>> 4) % 8);
    return horizontal ? { w: long, h: short } : { w: short, h: long };
  }
  if (type === RoomType.BATHROOM) return { w: 4 + (seed & 1), h: 4 + ((seed >>> 1) & 1) };
  if (type === RoomType.KITCHEN) return { w: 6 + (seed % 4), h: 5 + ((seed >>> 2) % 3) };
  if (type === RoomType.PRODUCTION) return { w: 9 + (seed % 7), h: 6 + ((seed >>> 3) % 5) };
  if (type === RoomType.OFFICE || type === RoomType.STORAGE) return { w: 6 + (seed % 5), h: 5 + ((seed >>> 4) % 4) };
  return { w: 7 + (seed % 5), h: 6 + ((seed >>> 5) % 4) };
}

function collectorMirrorRoomName(type: RoomType, id: number, pair: number, side: 'A' | 'B', gallery: boolean): string {
  if (gallery) return `Зеркальная галерея коллектора ${pair}${side}.${id}`;
  if (type === RoomType.BATHROOM) return `Санузел зеркальной смены ${pair}${side}.${id}`;
  if (type === RoomType.KITCHEN) return `Кухня сухой проводки ${pair}${side}.${id}`;
  if (type === RoomType.PRODUCTION) return `Кабельная насосная зеркала ${pair}${side}.${id}`;
  if (type === RoomType.OFFICE) return `Будка сверки зеркала ${pair}${side}.${id}`;
  if (type === RoomType.STORAGE) return `Склад зеркального кабеля ${pair}${side}.${id}`;
  return `Бытовка зеркальной проводки ${pair}${side}.${id}`;
}

function decorateCollectorMirrorRoom(world: World, room: Room, spec: ProceduralFloorSpec, seed: number, gallery: boolean): void {
  applyRoomTexture(world, room, Tex.PIPE, gallery ? Tex.F_CONCRETE : (room.type === RoomType.BATHROOM ? Tex.F_TILE : Tex.F_LINO));
  if (gallery || room.type === RoomType.PRODUCTION || room.type === RoomType.COMMON) shapeRoom(world, room);
  decorateRoom(world, room);
  decorateProceduralRoom(world, room, spec);
  if (gallery) {
    placeRoomFeature(world, room, Feature.SCREEN, 1, 1);
    placeRoomFeature(world, room, Feature.LAMP, room.w - 2, room.h - 2);
    placeRoomFeature(world, room, Feature.MACHINE, Math.floor(room.w / 2), Math.floor(room.h / 2));
  } else if (room.type === RoomType.BATHROOM) {
    placeRoomFeature(world, room, Feature.TOILET, 1, 1);
    placeRoomFeature(world, room, Feature.SINK, room.w - 2, 1);
  } else if (room.type === RoomType.KITCHEN) {
    placeRoomFeature(world, room, Feature.STOVE, 1, 1);
    placeRoomFeature(world, room, Feature.SINK, room.w - 2, 1);
  } else if (room.type === RoomType.PRODUCTION) {
    placeRoomFeature(world, room, Feature.APPARATUS, Math.floor(room.w / 2), Math.floor(room.h / 2));
  } else if (room.type === RoomType.OFFICE) {
    placeRoomFeature(world, room, Feature.SCREEN, Math.floor(room.w / 2), Math.floor(room.h / 2));
  } else if (room.type === RoomType.STORAGE) {
    placeRoomFeature(world, room, Feature.SHELF, Math.floor(room.w / 2), Math.floor(room.h / 2));
  } else {
    placeRoomFeature(world, room, (seed & 1) === 0 ? Feature.TABLE : Feature.LAMP, Math.floor(room.w / 2), Math.floor(room.h / 2));
  }
}

function tryPlaceCollectorMirrorRoom(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  nextRoomId: { v: number },
  center: { x: number; y: number },
  pair: number,
  side: 'A' | 'B',
  index: number,
  gallery: boolean,
  horizontal: boolean,
): Room | null {
  const seed = spec.seed ^ Math.imul(pair + 1, 0x45d9f3b) ^ Math.imul(index + (side === 'A' ? 11 : 73), 0x119de1f3);
  const type = collectorMirrorRoomType(index, gallery);
  const size = collectorMirrorRoomSize(type, seed, gallery, horizontal);
  const offsets = [
    { x: 0, y: 0 },
    { x: 18, y: 0 },
    { x: -18, y: 0 },
    { x: 0, y: 18 },
    { x: 0, y: -18 },
    { x: 28, y: 18 },
    { x: -28, y: -18 },
  ];
  for (const offset of offsets) {
    const x = Math.max(18, Math.min(W - size.w - 18, Math.floor(center.x - size.w / 2 + offset.x)));
    const y = Math.max(18, Math.min(W - size.h - 18, Math.floor(center.y - size.h / 2 + offset.y)));
    if (!canPlaceRoom(world, x, y, size.w, size.h)) continue;
    nextRoomId.v = Math.max(nextRoomId.v, world.rooms.length);
    const room = stampRoom(world, nextRoomId.v++, type, x, y, size.w, size.h, -1);
    room.name = collectorMirrorRoomName(type, room.id, pair + 1, side, gallery);
    decorateCollectorMirrorRoom(world, room, spec, seed, gallery);
    rooms.push(room);
    return room;
  }
  return null;
}

function collectorMirrorSupportCenter(hub: Room, seed: number, index: number): { x: number; y: number } {
  const side = index & 3;
  const gap = 7 + ((seed >>> (index & 7)) % 13);
  const center = roomCenter(hub);
  if (side === 0) return { x: center.x + ((index % 3) - 1) * 9, y: hub.y - gap };
  if (side === 1) return { x: center.x + ((index % 3) - 1) * 9, y: hub.y + hub.h + gap };
  if (side === 2) return { x: hub.x - gap, y: center.y + ((index % 3) - 1) * 8 };
  return { x: hub.x + hub.w + gap, y: center.y + ((index % 3) - 1) * 8 };
}

function placeCollectorMirrorSupports(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  nextRoomId: { v: number },
  hub: Room,
  pair: number,
  side: 'A' | 'B',
  microBudget: { v: number },
): number {
  let placed = 0;
  const localTarget = 6 + (pair % 3);
  const horizontal = hub.w >= hub.h;
  for (let i = 0; i < localTarget && microBudget.v < COLLECTOR_MIRROR_MICRO_ROOM_TARGET; i++) {
    const center = collectorMirrorSupportCenter(hub, spec.seed ^ pair * 977 ^ i * 131, i);
    const room = tryPlaceCollectorMirrorRoom(world, rooms, spec, nextRoomId, center, pair, side, i + 1, false, !horizontal);
    if (!room) continue;
    connectRoomsMST(world, [hub, room]);
    placed++;
    microBudget.v++;
  }
  return placed;
}

function registerCollectorMirrorInfillCue(world: World, spec: ProceduralFloorSpec, first: Room, target: Room): void {
  const a = roomCenter(first);
  const b = roomCenter(target);
  const ci = world.idx(a.x, a.y);
  registerRouteCue(world, {
    id: `procedural_${spec.key}_collector_mirror_infill`,
    x: a.x + 0.5,
    y: a.y + 0.5,
    targetX: b.x + 0.5,
    targetY: b.y + 0.5,
    floor: spec.baseFloor,
    roomId: first.id,
    targetRoomId: target.id,
    zoneId: world.zoneMap[ci],
    label: 'зеркальная проводка коллектора',
    hint: 'пары галерей и бытовок заполняют пустые пролеты вокруг зеркальной оси',
    targetName: target.name,
    color: '#76d7ff',
    tags: ['procedural_floor', 'collectors', 'mirror_run', 'collector_mirror_infill', 'multi_scale'],
    toneSeed: (spec.seed ^ 0x88c011ec) >>> 0,
    radius: 14,
    targetRadius: 6,
    cooldownSec: 44,
    heardText: 'За водой тянется зеркальная проводка: галереи повторяются не идеально, но читаемо.',
    followedText: 'Зеркальная галерея дала сухой обход и мелкие служебные двери.',
    ignoredText: 'Зеркальная проводка осталась рядом с водой, но не закрыла маршрут.',
  });
}

function applyCollectorMirrorInfill(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  nextRoomId: { v: number },
  spawnX: number,
  spawnY: number,
): void {
  if (spec.geometryId !== 'collectors' || spec.anomalyId !== 'mirror_run') return;
  const axis = collectorMirrorAxis(spec, spawnX, spawnY);
  const candidates: { x: number; y: number; score: number }[] = [];
  for (let gy = 1; gy <= 6; gy++) {
    for (let gx = 1; gx <= 6; gx++) {
      const x = 70 + gx * 132 + Math.floor((fieldHash01(spec.seed, gx, gy, 0x881) - 0.5) * 54);
      const y = 70 + gy * 132 + Math.floor((fieldHash01(spec.seed, gx, gy, 0x882) - 0.5) * 54);
      const axisDelta = axis.axis === 'x' ? Math.abs(world.delta(x, axis.value)) : Math.abs(world.delta(y, axis.value));
      if (axisDelta < 58 || world.dist2(spawnX, spawnY, x + 0.5, y + 0.5) < 72 * 72) continue;
      const score = fieldHash01(spec.seed, gx, gy, 0x883) + Math.min(0.42, axisDelta / W);
      candidates.push({ x: world.wrap(x), y: world.wrap(y), score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const placedCenters: { x: number; y: number }[] = [];
  const galleryRooms: Room[] = [];
  const microBudget = { v: 0 };
  let pairCount = 0;
  for (const candidate of candidates) {
    if (pairCount >= COLLECTOR_MIRROR_GALLERY_TARGET || microBudget.v >= COLLECTOR_MIRROR_MICRO_ROOM_TARGET) break;
    if (placedCenters.some(center => world.dist2(center.x, center.y, candidate.x, candidate.y) < COLLECTOR_MIRROR_CLUSTER_MIN_SPACING)) continue;
    const mirrored = axis.axis === 'x'
      ? { x: collectorMirrorCoord(candidate.x, axis.value), y: candidate.y }
      : { x: candidate.x, y: collectorMirrorCoord(candidate.y, axis.value) };
    if (world.dist2(candidate.x, candidate.y, mirrored.x, mirrored.y) < 52 * 52) continue;
    const horizontal = axis.axis === 'y' ? (pairCount & 1) === 0 : (pairCount & 1) !== 0;
    const a = tryPlaceCollectorMirrorRoom(world, rooms, spec, nextRoomId, candidate, pairCount, 'A', 0, true, horizontal);
    const b = tryPlaceCollectorMirrorRoom(world, rooms, spec, nextRoomId, mirrored, pairCount, 'B', 0, true, horizontal);
    if (!a && !b) continue;
    if (a) {
      galleryRooms.push(a);
      placedCenters.push(roomCenter(a));
      placeCollectorMirrorSupports(world, rooms, spec, nextRoomId, a, pairCount, 'A', microBudget);
    }
    if (b) {
      galleryRooms.push(b);
      placedCenters.push(roomCenter(b));
      placeCollectorMirrorSupports(world, rooms, spec, nextRoomId, b, pairCount, 'B', microBudget);
    }
    if (a && b) connectRoomsMST(world, [a, b]);
    pairCount++;
  }

  if (galleryRooms.length === 0) return;
  if (galleryRooms.length > 1) registerCollectorMirrorInfillCue(world, spec, galleryRooms[0], galleryRooms[galleryRooms.length - 1]);
  world.markCellsDirty();
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFeaturesDirty(true);
}

function applyZones(world: World, spec: ProceduralFloorSpec): void {
  const majority = majorityById(spec.majorityId);
  const alternatives: ZoneFaction[] = [majority.zoneFaction, majority.zoneFaction, majority.zoneFaction];
  if (majority.zoneFaction !== ZoneFaction.CITIZEN) alternatives.push(ZoneFaction.CITIZEN);
  alternatives.push(ZoneFaction.LIQUIDATOR, ZoneFaction.CULTIST, ZoneFaction.SCIENTIST, ZoneFaction.WILD);
  for (const zone of world.zones) {
    zone.level = Math.max(1, Math.min(5, spec.danger + irng(-1, 1)));
    zone.fogged = false;
    zone.faction = chance(0.68) ? majority.zoneFaction : pick(alternatives);
  }
}

function initializeProceduralTerritory(world: World, spec: ProceduralFloorSpec): void {
  initializeCellTerritory(world, {
    seed: spec.seed ^ Math.imul(spec.z + 101, 0x6d2b79f5),
    targetShares: territorySharesForProceduralSpec(spec),
  });
}

function proceduralHqBase(owner: ZoneFaction): { x: number; y: number } {
  switch (owner) {
    case ZoneFaction.LIQUIDATOR: return { x: Math.floor(W * 0.78), y: Math.floor(W * 0.22) };
    case ZoneFaction.CULTIST: return { x: Math.floor(W * 0.22), y: Math.floor(W * 0.76) };
    case ZoneFaction.SCIENTIST: return { x: Math.floor(W * 0.76), y: Math.floor(W * 0.76) };
    case ZoneFaction.WILD: return { x: Math.floor(W * 0.50), y: Math.floor(W * 0.54) };
    default: return { x: Math.floor(W * 0.22), y: Math.floor(W * 0.22) };
  }
}

function proceduralHqSupportType(owner: ZoneFaction, index: number): RoomType {
  if (owner === ZoneFaction.SCIENTIST) return [RoomType.MEDICAL, RoomType.OFFICE, RoomType.PRODUCTION, RoomType.STORAGE][index] ?? RoomType.OFFICE;
  if (owner === ZoneFaction.LIQUIDATOR) return [RoomType.STORAGE, RoomType.PRODUCTION, RoomType.OFFICE, RoomType.MEDICAL][index] ?? RoomType.STORAGE;
  if (owner === ZoneFaction.CULTIST) return [RoomType.COMMON, RoomType.STORAGE, RoomType.SMOKING, RoomType.KITCHEN][index] ?? RoomType.COMMON;
  if (owner === ZoneFaction.WILD) return [RoomType.STORAGE, RoomType.SMOKING, RoomType.KITCHEN, RoomType.COMMON][index] ?? RoomType.STORAGE;
  return [RoomType.KITCHEN, RoomType.COMMON, RoomType.STORAGE, RoomType.MEDICAL][index] ?? RoomType.COMMON;
}

function proceduralHqTextures(owner: ZoneFaction): { wall: Tex; floor: Tex } {
  if (owner === ZoneFaction.SCIENTIST) return { wall: Tex.MARBLE, floor: Tex.F_TILE };
  if (owner === ZoneFaction.LIQUIDATOR) return { wall: Tex.METAL, floor: Tex.F_CONCRETE };
  if (owner === ZoneFaction.CULTIST) return { wall: Tex.BRICK, floor: Tex.F_GUT };
  if (owner === ZoneFaction.WILD) return { wall: Tex.BRICK, floor: Tex.F_CONCRETE };
  return { wall: Tex.PANEL, floor: Tex.F_LINO };
}

function proceduralHqRoomName(owner: ZoneFaction, type: RoomType, index: number, dominant: boolean): string {
  const ownerName = territoryOwnerName(owner).toLowerCase();
  if (type === RoomType.HQ) return dominant ? `Сильный гермоштаб: ${ownerName}` : `Миништаб: ${ownerName}`;
  if (type === RoomType.KITCHEN) return `Кухня штаба: ${ownerName}`;
  if (type === RoomType.MEDICAL) return `Медпункт штаба: ${ownerName}`;
  if (type === RoomType.PRODUCTION) return `Мастерская штаба: ${ownerName}`;
  if (type === RoomType.OFFICE) return `Канцелярия штаба: ${ownerName}`;
  if (type === RoomType.SMOKING) return `Дымная штаба: ${ownerName}`;
  if (type === RoomType.STORAGE) return `Склад штаба: ${ownerName}`;
  return `Опора штаба ${index + 1}: ${ownerName}`;
}

function paintProceduralRoomTerritory(world: World, room: Room, owner: ZoneFaction): void {
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.aptMask[ci]) continue;
      world.factionControl[ci] = owner;
    }
  }
}

function proceduralHqHasHermeticDoor(world: World, room: Room): boolean {
  return room.doors.some(doorIdx => world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN);
}

function proceduralHqDoorOffsets(length: number): number[] {
  const offsets: number[] = [];
  const center = Math.max(1, Math.floor(length / 2));
  for (let step = 0; step < Math.max(1, length - 2); step++) {
    const offset = step === 0 ? 0 : (step & 1 ? Math.ceil(step / 2) : -Math.ceil(step / 2));
    const value = center + offset;
    if (value > 0 && value < length - 1) offsets.push(value);
  }
  return offsets;
}

function ensureProceduralHqHermeticDoor(world: World, room: Room): void {
  if (proceduralHqHasHermeticDoor(world, room)) return;
  const candidates: { wx: number; wy: number; ox: number; oy: number }[] = [];
  for (const yOffset of proceduralHqDoorOffsets(room.h)) {
    const y = room.y + yOffset;
    candidates.push(
      { wx: room.x + room.w, wy: y, ox: room.x + room.w + 1, oy: y },
      { wx: room.x - 1, wy: y, ox: room.x - 2, oy: y },
    );
  }
  for (const xOffset of proceduralHqDoorOffsets(room.w)) {
    const x = room.x + xOffset;
    candidates.push(
      { wx: x, wy: room.y + room.h, ox: x, oy: room.y + room.h + 1 },
      { wx: x, wy: room.y - 1, ox: x, oy: room.y - 2 },
    );
  }

  for (const candidate of candidates) {
    const doorIdx = world.idx(candidate.wx, candidate.wy);
    const outsideIdx = world.idx(candidate.ox, candidate.oy);
    if (world.aptMask[doorIdx] || world.aptMask[outsideIdx]) continue;
    if (world.cells[doorIdx] !== Cell.WALL && world.cells[doorIdx] !== Cell.DOOR) continue;
    if (world.cells[outsideIdx] === Cell.LIFT || world.cells[outsideIdx] === Cell.ABYSS || world.hermoWall[outsideIdx]) continue;
    if (world.cells[outsideIdx] !== Cell.FLOOR && world.cells[outsideIdx] !== Cell.DOOR) {
      world.cells[outsideIdx] = Cell.FLOOR;
      world.roomMap[outsideIdx] = -1;
      world.features[outsideIdx] = Feature.NONE;
      world.floorTex[outsideIdx] = world.floorTex[world.idx(room.x + 1, room.y + 1)] || Tex.F_CONCRETE;
      world.wallTex[outsideIdx] = Tex.HERMO_WALL;
    }
    if (world.cells[doorIdx] !== Cell.DOOR) placeDoorAt(world, candidate.wx, candidate.wy, room.id);
    const door = world.doors.get(doorIdx);
    if (!door) continue;
    if (!room.doors.includes(doorIdx)) room.doors.push(doorIdx);
    setDoorState(world, door, DoorState.HERMETIC_OPEN);
    world.hermoWall[doorIdx] = 1;
    world.wallTex[doorIdx] = Tex.HERMO_WALL;
    return;
  }
}

function markProceduralHqShell(world: World, room: Room): void {
  room.sealed = true;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.cells[ci] !== Cell.WALL) continue;
      world.hermoWall[ci] = 1;
      world.wallTex[ci] = Tex.HERMO_WALL;
    }
  }
  for (const doorIdx of room.doors) {
    setDoorState(world, world.doors.get(doorIdx), DoorState.HERMETIC_OPEN);
    world.hermoWall[doorIdx] = 1;
  }
  ensureProceduralHqHermeticDoor(world, room);
}

function proceduralHqLayout(owner: ZoneFaction, dominant: boolean): { type: RoomType; x: number; y: number; w: number; h: number }[] {
  const hqW = dominant ? 20 : 14;
  const hqH = dominant ? 14 : 10;
  const gap = 4;
  const supportW = dominant ? 12 : 10;
  const supportH = dominant ? 9 : 8;
  const layout = [
    { type: RoomType.HQ, x: 0, y: 0, w: hqW, h: hqH },
    { type: proceduralHqSupportType(owner, 0), x: hqW + gap, y: 0, w: supportW, h: supportH },
    { type: proceduralHqSupportType(owner, 1), x: 0, y: hqH + gap, w: supportW + 2, h: supportH },
    { type: proceduralHqSupportType(owner, 2), x: hqW + gap, y: hqH + gap, w: supportW, h: supportH },
  ];
  if (dominant) {
    layout.push({ type: proceduralHqSupportType(owner, 3), x: Math.floor(hqW * 0.45), y: hqH + gap + supportH + gap, w: supportW + 2, h: supportH });
  }
  return layout;
}

function canReclaimProceduralHqRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.cells[ci] === Cell.LIFT || world.aptMask[ci] || world.hermoWall[ci]) return false;
      if (world.features[ci] === Feature.LIFT_BUTTON || world.containerMap.has(ci)) return false;
      const roomId = world.roomMap[ci];
      if (roomId >= 0 && world.rooms[roomId]?.type === RoomType.HQ) return false;
    }
  }
  return true;
}

function canPlaceProceduralHqLayout(
  world: World,
  layout: readonly { x: number; y: number; w: number; h: number }[],
  x: number,
  y: number,
  reclaim: boolean,
): boolean {
  for (const item of layout) {
    const rx = x + item.x;
    const ry = y + item.y;
    if (canPlaceRoom(world, rx, ry, item.w, item.h)) continue;
    if (!reclaim || !canReclaimProceduralHqRoom(world, rx, ry, item.w, item.h)) return false;
  }
  return true;
}

function clearProceduralHqFootprint(world: World, x: number, y: number, w: number, h: number): void {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.doors.has(ci) || world.cells[ci] === Cell.DOOR) world.removeDoorAt(ci);
      if (world.features[ci] !== Feature.LIFT_BUTTON) world.features[ci] = Feature.NONE;
      world.hermoWall[ci] = 0;
    }
  }
}

function findProceduralHqOrigin(
  world: World,
  owner: ZoneFaction,
  dominant: boolean,
  spec: ProceduralFloorSpec,
  spawnX: number,
  spawnY: number,
): { x: number; y: number } | null {
  const base = proceduralHqBase(owner);
  const layout = proceduralHqLayout(owner, dominant);
  const groupW = Math.max(...layout.map(item => item.x + item.w));
  const groupH = Math.max(...layout.map(item => item.y + item.h));
  for (let pass = 0; pass < 2; pass++) {
    const reclaim = pass === 1;
    const attempts = reclaim ? 320 : 220;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const ring = Math.floor(attempt / 16);
      const jitter = 18 + ring * 18;
      const jx = Math.round((fieldHash01(spec.seed, owner, attempt, 0x71) - 0.5) * jitter * 2);
      const jy = Math.round((fieldHash01(spec.seed, owner, attempt, 0x72) - 0.5) * jitter * 2);
      const x = Math.max(24, Math.min(W - groupW - 24, base.x - Math.floor(groupW / 2) + jx));
      const y = Math.max(24, Math.min(W - groupH - 24, base.y - Math.floor(groupH / 2) + jy));
      if (world.dist2(spawnX, spawnY, x + groupW / 2, y + groupH / 2) < 56 * 56) continue;
      if (canPlaceProceduralHqLayout(world, layout, x, y, reclaim)) return { x, y };
    }
  }
  return null;
}

function nearestExistingRoom(world: World, rooms: readonly Room[], source: Room, clusterIds: ReadonlySet<number>): Room | null {
  const sc = roomCenter(source);
  let best: Room | null = null;
  let bestD2 = Infinity;
  for (const room of rooms) {
    if (!room || clusterIds.has(room.id)) continue;
    const c = roomCenter(room);
    const d2 = world.dist2(sc.x + 0.5, sc.y + 0.5, c.x + 0.5, c.y + 0.5);
    if (d2 < bestD2) {
      best = room;
      bestD2 = d2;
    }
  }
  return best;
}

function stampProceduralHqCluster(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  owner: ZoneFaction,
  dominant: boolean,
  origin: { x: number; y: number },
): Room[] {
  const layout = proceduralHqLayout(owner, dominant);
  const textures = proceduralHqTextures(owner);
  const cluster: Room[] = [];
  for (let i = 0; i < layout.length; i++) {
    const item = layout[i];
    const x = origin.x + item.x;
    const y = origin.y + item.y;
    clearProceduralHqFootprint(world, x, y, item.w, item.h);
    const room = stampRoom(world, world.rooms.length, item.type, x, y, item.w, item.h, -1);
    room.name = proceduralHqRoomName(owner, item.type, i, dominant);
    applyRoomTexture(world, room, item.type === RoomType.HQ ? Tex.HERMO_WALL : textures.wall, textures.floor);
    decorateRoom(world, room);
    decorateProceduralRoom(world, room, spec);
    paintProceduralRoomTerritory(world, room, owner);
    rooms.push(room);
    cluster.push(room);
  }
  connectRoomsMST(world, cluster);
  const hq = cluster[0];
  if (hq) markProceduralHqShell(world, hq);
  return cluster;
}

function existingProceduralHqOwners(world: World): Set<ZoneFaction> {
  const owners = new Set<ZoneFaction>();
  for (const room of world.rooms) {
    if (!room || room.type !== RoomType.HQ) continue;
    const center = world.idx(room.x + (room.w >> 1), room.y + (room.h >> 1));
    owners.add(territoryOwnerAtIndex(world, center));
  }
  return owners;
}

function placeProceduralMiniHqClusters(world: World, rooms: Room[], spec: ProceduralFloorSpec, spawnX: number, spawnY: number): void {
  const dominantOwner = factionToTerritoryOwner(majorityById(spec.majorityId).npcFaction);
  const existingOwners = existingProceduralHqOwners(world);
  const placed: Room[] = [];
  const clusterIds = new Set<number>();
  for (const owner of PROCEDURAL_HQ_OWNERS) {
    if (existingOwners.has(owner)) continue;
    const dominant = owner === dominantOwner;
    const origin = findProceduralHqOrigin(world, owner, dominant, spec, spawnX, spawnY);
    if (!origin) continue;
    const cluster = stampProceduralHqCluster(world, rooms, spec, owner, dominant, origin);
    placed.push(...cluster);
    const hq = cluster[0];
    if (!hq) continue;
    for (const room of cluster) clusterIds.add(room.id);
    const nearest = nearestExistingRoom(world, rooms, hq, clusterIds);
    if (nearest) connectRoomsMST(world, [hq, nearest]);
    else connectToNetwork(world, hq);
    markProceduralHqShell(world, hq);
    existingOwners.add(owner);
  }
  if (placed.length > 0) {
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFeaturesDirty(true);
  }
}

function randomRoomCell(room: Room): { x: number; y: number } {
  return {
    x: room.x + irng(1, Math.max(1, room.w - 2)),
    y: room.y + irng(1, Math.max(1, room.h - 2)),
  };
}

const ITEMS_BY_ROOM = new Map<RoomType, ItemDef[]>();
for (const def of Object.values(ITEMS)) {
  for (const rType of def.spawnRooms) {
    let arr = ITEMS_BY_ROOM.get(rType);
    if (!arr) {
      arr = [];
      ITEMS_BY_ROOM.set(rType, arr);
    }
    arr.push(def);
  }
}

const lootBiasCache = new WeakMap<string[], Set<string>>();

function chooseItem(room: Room, spec: ProceduralFloorSpec, maxValue = Number.POSITIVE_INFINITY): ItemDef | null {
  let total = 0;
  const weighted: { def: ItemDef; weight: number }[] = [];
  const roomItems = ITEMS_BY_ROOM.get(room.type);
  if (!roomItems) return null;

  let biasSet = lootBiasCache.get(spec.lootBiasIds);
  if (!biasSet) {
    biasSet = new Set(spec.lootBiasIds);
    lootBiasCache.set(spec.lootBiasIds, biasSet);
  }

  for (const def of roomItems) {
    if (def.value > maxValue) continue;
    let weight = def.spawnW * (1000 / (def.value + 10));
    if (biasSet.has(def.id)) weight *= 4.5;
    if (spec.danger >= 4 && def.value > 80) weight *= 1.5;
    if (weight <= 0) continue;
    weighted.push({ def, weight });
    total += weight;
  }
  if (weighted.length === 0 || total <= 0) return null;
  let roll = Math.random() * total;
  for (const item of weighted) {
    roll -= item.weight;
    if (roll <= 0) return item.def;
  }
  return weighted[weighted.length - 1].def;
}

function dropItem(entities: Entity[], nextId: { v: number }, x: number, y: number, defId: string, count = 1): void {
  if (!canSpawnEntityType(entities, EntityType.ITEM_DROP)) return;
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
    inventory: [{
      defId,
      count,
      data: defId === 'note' ? pick(NOTES) : undefined,
    }],
  });
}

function itemTags(defId: string): readonly string[] {
  return ITEMS[defId]?.tags ?? ITEM_TAGS[defId] ?? [];
}

function inventoryValue(items: readonly Item[]): number {
  let value = 0;
  for (const item of items) value += (ITEMS[item.defId]?.value ?? 0) * item.count;
  return value;
}

function addCappedItem(inv: Item[], item: Item, valueCap: number, capacitySlots: number): boolean {
  const def = ITEMS[item.defId];
  if (!def || item.count <= 0 || inv.length >= capacitySlots) return false;
  const roomLeft = valueCap - inventoryValue(inv);
  let count = Math.min(item.count, getStack(def));
  if (def.value > 0) count = Math.min(count, Math.floor(roomLeft / def.value));
  if (count <= 0) return false;
  inv.push({
    defId: item.defId,
    count,
    data: item.data ?? (item.defId === 'note' ? pick(NOTES) : undefined),
  });
  return true;
}

function proceduralContainerValueCap(kind: ContainerKind, spec: ProceduralFloorSpec): number {
  return Math.min(proceduralLootValueCap(spec.danger, spec.z), economyProceduralContainerValueCap(kind, spec.danger, spec.z));
}

function seedProceduralLootInventory(room: Room, kind: ContainerKind, spec: ProceduralFloorSpec): Item[] {
  const def = CONTAINER_DEFS[kind];
  const valueCap = proceduralContainerValueCap(kind, spec);
  const inv: Item[] = [];
  const targetSlots = Math.min(def.capacitySlots, 2 + Math.floor(spec.danger / 2) + (kind === ContainerKind.SAFE || kind === ContainerKind.SECRET_STASH ? 1 : 0));
  const bias = spec.lootBiasIds[(room.id + kind + spec.danger) % Math.max(1, spec.lootBiasIds.length)];
  if (bias && chance(0.72)) addCappedItem(inv, { defId: bias, count: 1 }, valueCap, def.capacitySlots);

  for (let attempt = 0; attempt < targetSlots * 4 && inv.length < targetSlots; attempt++) {
    const remaining = valueCap - inventoryValue(inv);
    if (remaining <= 0) break;
    const picked = chooseItem(room, spec, remaining);
    if (!picked) break;
    const count = irng(1, Math.max(1, Math.min(spawnCount(picked), spec.danger + 2)));
    addCappedItem(inv, { defId: picked.id, count }, valueCap, def.capacitySlots);
  }


  return inv;
}

function uniqueTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function inventoryHasContamination(inv: readonly Item[]): boolean {
  for (const item of inv) {
    const tags = itemTags(item.defId);
    if (
      tags.includes('contaminant') ||
      tags.includes('contaminated') ||
      tags.includes('bad_batch') ||
      tags.includes('bait_risky') ||
      tags.includes('toxic') ||
      tags.includes('infection')
    ) return true;
  }
  return false;
}

function proceduralOwnerName(spec: ProceduralFloorSpec): string {
  if (spec.majorityId === 'liquidators') return 'пост ликвидаторов';
  if (spec.majorityId === 'cultists') return 'черная ладонь';
  if (spec.majorityId === 'scientists') return 'смена НИИ';
  if (spec.majorityId === 'wild') return 'дикие жильцы';
  return 'местные жильцы';
}

function proceduralLootAccess(kind: ContainerKind, spec: ProceduralFloorSpec): WorldContainer['access'] {
  const base = CONTAINER_DEFS[kind].defaultAccess;
  if (kind === ContainerKind.SECRET_STASH) return 'secret';
  if (kind === ContainerKind.SAFE) return 'locked';
  if (kind === ContainerKind.WEAPON_CRATE) return 'faction';
  if (base === 'public') return 'public';
  if (spec.majorityId === 'liquidators' || spec.majorityId === 'cultists' || spec.majorityId === 'scientists') return 'faction';
  if (spec.majorityId === 'wild' && spec.danger >= 2) return chance(0.55) ? 'owner' : 'secret';
  if (spec.danger >= 4 && base !== 'room') return 'locked';
  return base;
}

function proceduralLootTags(kind: ContainerKind, spec: ProceduralFloorSpec, access: WorldContainer['access'], inventory: readonly Item[], extra: readonly string[] = []): string[] {
  const valueCap = proceduralContainerValueCap(kind, spec);
  return uniqueTags([
    'procedural_floor',
    'loot',
    'stash',
    `danger_${spec.danger}`,
    spec.geometryId,
    spec.majorityId,
    spec.anomalyId,
    ...PROCEDURAL_LOOT_FACTION_TAGS[spec.majorityId],
    ...PROCEDURAL_LOOT_ANOMALY_TAGS[spec.anomalyId],
    ...(access === 'owner' || access === 'faction' || access === 'locked' ? ['theft', 'audit_risk'] : []),
    ...(access === 'secret' ? ['secret'] : []),
    ...(inventoryHasContamination(inventory) ? ['contaminated'] : []),
    `value_cap_${valueCap}`,
    ...CONTAINER_DEFS[kind].tags,
    ...extra,
  ]);
}

function addProceduralLootContainer(
  world: World,
  spec: ProceduralFloorSpec,
  room: Room,
  pos: { x: number; y: number },
  kind: ContainerKind,
  inventory: Item[],
  extraTags: readonly string[] = [],
  name?: string,
): WorldContainer | null {
  if (inventory.length === 0 || world.containersAt(pos.x, pos.y).length > 0) return null;
  const def = CONTAINER_DEFS[kind];
  const access = proceduralLootAccess(kind, spec);
  const container: WorldContainer = {
    id: nextContainerId(world),
    x: pos.x,
    y: pos.y,
    floor: spec.baseFloor,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(pos.x, pos.y)],
    kind,
    name: name ?? `${def.name}: ${room.name}`,
    inventory,
    capacitySlots: def.capacitySlots,
    ownerName: access === 'owner' ? proceduralOwnerName(spec) : undefined,
    faction: access === 'faction' || access === 'locked' ? majorityById(spec.majorityId).npcFaction : undefined,
    access,
    lockDifficulty: access === 'locked' ? Math.min(5, 1 + spec.danger) : undefined,
    discovered: access !== 'secret',
    tags: proceduralLootTags(kind, spec, access, inventory, extraTags),
  };
  world.addContainer(container);
  return container;
}

interface ReachableLootCell {
  room: Room;
  x: number;
  y: number;
  dist2FromSpawn: number;
}

function isLootCell(world: World, ci: number, reachable: Uint8Array): boolean {
  if (!reachable[ci]) return false;
  if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) return false;
  if (world.features[ci] !== Feature.NONE && world.features[ci] !== Feature.SHELF && world.features[ci] !== Feature.TABLE) return false;
  return true;
}

function collectReachableLootCells(world: World, rooms: Room[], reachable: Uint8Array, spawnX: number, spawnY: number): ReachableLootCell[] {
  const cells: ReachableLootCell[] = [];
  for (const room of rooms) {
    if (room.w < 3 || room.h < 3) continue;
    for (let dy = 1; dy < room.h - 1; dy++) {
      for (let dx = 1; dx < room.w - 1; dx++) {
        const x = world.wrap(room.x + dx);
        const y = world.wrap(room.y + dy);
        const ci = world.idx(x, y);
        if (world.roomMap[ci] !== room.id || !isLootCell(world, ci, reachable)) continue;
        if (world.containersAt(x, y).length > 0) continue;
        cells.push({ room, x, y, dist2FromSpawn: world.dist2(spawnX, spawnY, x + 0.5, y + 0.5) });
      }
    }
  }
  return cells;
}

interface ReachablePanelCell {
  room: Room;
  x: number;
  y: number;
  weight: number;
}

function panelRoomWeight(room: Room, def: EmergencyPanelDef, spec: ProceduralFloorSpec): number {
  let weight = def.roomTypes.includes(room.type) ? 4 : 0.4;
  if (room.type === RoomType.PRODUCTION) weight += 3;
  if (room.type === RoomType.STORAGE) weight += 2;
  if (room.type === RoomType.CORRIDOR) weight += spec.geometryId === 'service_spines' ? 3 : 1;
  if (room.type === RoomType.OFFICE && def.id === 'panel_doors') weight += 2;
  if (room.type === RoomType.BATHROOM && def.id === 'panel_water') weight += 3;
  if (room.id === 0) weight *= 0.18;
  return weight;
}

function collectReachablePanelCells(
  world: World,
  rooms: Room[],
  reachable: Uint8Array,
  spec: ProceduralFloorSpec,
  def: EmergencyPanelDef,
  used: Set<number>,
): ReachablePanelCell[] {
  const cells: ReachablePanelCell[] = [];
  for (const room of rooms) {
    if (room.w < 4 || room.h < 4) continue;
    const baseWeight = panelRoomWeight(room, def, spec);
    if (baseWeight <= 0) continue;
    for (let dy = 1; dy < room.h - 1; dy++) {
      for (let dx = 1; dx < room.w - 1; dx++) {
        const x = world.wrap(room.x + dx);
        const y = world.wrap(room.y + dy);
        const ci = world.idx(x, y);
        if (used.has(ci) || !reachable[ci]) continue;
        if (world.cells[ci] !== Cell.FLOOR) continue;
        if (world.roomMap[ci] !== room.id) continue;
        if (world.features[ci] !== Feature.NONE && world.features[ci] !== Feature.SHELF && world.features[ci] !== Feature.TABLE) continue;
        if (world.containersAt(x, y).length > 0) continue;
        const edge = dx <= 1 || dy <= 1 || dx >= room.w - 2 || dy >= room.h - 2;
        cells.push({ room, x, y, weight: edge ? baseWeight * 1.25 : baseWeight });
      }
    }
  }
  return cells;
}

function pickEmergencyPanelDef(spec: ProceduralFloorSpec, placed: number): EmergencyPanelDef | null {
  const defs = emergencyPanelDefsForGeometry(spec.geometryId);
  if (defs.length === 0) return null;
  if ((spec.geometryId === 'collectors' || spec.geometryId === 'sump_causeways') && placed === 0) {
    return defs.find(def => def.id === 'panel_water') ?? defs[0];
  }
  let total = 0;
  for (const def of defs) total += def.weight * (def.geometryWeights[spec.geometryId] ?? 0);
  let roll = ((spec.seed + placed * 7919) % 100000) / 100000 * total;
  for (const def of defs) {
    roll -= def.weight * (def.geometryWeights[spec.geometryId] ?? 0);
    if (roll <= 0) return def;
  }
  return defs[defs.length - 1];
}

function placeSumpCausewayRepairPanels(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  reachable: Uint8Array,
  used: Set<number>,
): number {
  if (spec.geometryId !== 'sump_causeways') return 0;
  const waterDef = emergencyPanelDefsForGeometry(spec.geometryId).find(def => def.id === 'panel_water');
  if (!waterDef) return 0;
  const repairRooms = rooms.filter(room => room.name.startsWith(SUMP_REPAIR_ROOM_PREFIX));
  let placed = 0;
  for (const room of repairRooms) {
    if (placed >= 2) break;
    const cells = collectReachablePanelCells(world, [room], reachable, spec, waterDef, used);
    const cell = pickReachablePanelCell(cells);
    if (!cell) continue;
    const ci = world.idx(cell.x, cell.y);
    used.add(ci);
    if (placeEmergencyPanel(world, cell.x, cell.y, waterDef.id, spec.seed ^ (cell.room.id * 193) ^ 0x5a47)) placed++;
  }
  return placed;
}

function pickReachablePanelCell(cells: readonly ReachablePanelCell[]): ReachablePanelCell | null {
  let total = 0;
  for (const cell of cells) total += cell.weight;
  if (cells.length === 0 || total <= 0) return null;
  let roll = Math.random() * total;
  for (const cell of cells) {
    roll -= cell.weight;
    if (roll <= 0) return cell;
  }
  return cells[cells.length - 1];
}

function placeProceduralEmergencyPanels(world: World, rooms: Room[], spec: ProceduralFloorSpec, reachable: Uint8Array): void {
  const defs = emergencyPanelDefsForGeometry(spec.geometryId);
  if (defs.length === 0) return;
  const baseCount = spec.geometryId === 'service_spines' || spec.geometryId === 'collectors' || spec.geometryId === 'sump_causeways' ? 2 : 1;
  const target = Math.min(3, baseCount + (spec.danger >= 3 ? 1 : 0));
  const used = new Set<number>();
  const explicitPanels = placeSumpCausewayRepairPanels(world, rooms, spec, reachable, used);

  for (let placed = explicitPanels; placed < target; placed++) {
    const def = pickEmergencyPanelDef(spec, placed);
    if (!def) break;
    const cells = collectReachablePanelCells(world, rooms, reachable, spec, def, used);
    const cell = pickReachablePanelCell(cells);
    if (!cell) break;
    const ci = world.idx(cell.x, cell.y);
    used.add(ci);
    placeEmergencyPanel(world, cell.x, cell.y, def.id, spec.seed ^ (cell.room.id * 193) ^ placed);
  }
}

function roomLootWeight(room: Room, spec: ProceduralFloorSpec): number {
  if (room.type === RoomType.STORAGE) return 5;
  if (room.type === RoomType.PRODUCTION) return spec.geometryId === 'workshops' || spec.geometryId === 'collectors' ? 4.5 : 3.2;
  if (room.type === RoomType.OFFICE) return spec.majorityId === 'scientists' || spec.geometryId === 'admin_pockets' ? 4.4 : 2.6;
  if (room.type === RoomType.KITCHEN) return spec.majorityId === 'citizens' ? 3.2 : 1.8;
  if (room.type === RoomType.COMMON) return 2.2;
  if (room.type === RoomType.CORRIDOR) return spec.anomalyId === 'teleport_cells' || spec.anomalyId === 'rail_trains' ? 2.6 : 0.8;
  return 1.2;
}

function pickReachableLootCell(cells: readonly ReachableLootCell[], used: Set<number>, spec: ProceduralFloorSpec): ReachableLootCell | null {
  let total = 0;
  const weighted: { cell: ReachableLootCell; weight: number }[] = [];
  const nearLimit = (18 + spec.danger * 3) ** 2;
  for (const cell of cells) {
    if (used.has(cell.x + cell.y * W)) continue;
    let weight = roomLootWeight(cell.room, spec);
    if (cell.dist2FromSpawn < nearLimit) weight *= 0.18;
    if (cell.dist2FromSpawn > nearLimit * 4) weight *= 1.35;
    weighted.push({ cell, weight });
    total += weight;
  }
  if (weighted.length === 0 || total <= 0) return null;
  let roll = Math.random() * total;
  for (const item of weighted) {
    roll -= item.weight;
    if (roll <= 0) return item.cell;
  }
  return weighted[weighted.length - 1].cell;
}

function chooseProceduralContainerKind(room: Room, spec: ProceduralFloorSpec, index: number): ContainerKind {
  const roomType = room.type;
  const anomalyBias = PROCEDURAL_LOOT_ANOMALY_KIND_BIAS[spec.anomalyId];
  const factionBias = PROCEDURAL_LOOT_FACTION_KIND_BIAS[spec.majorityId];
  const roomKinds = containerKindsForRoom(roomType);

  const fitting: ContainerKind[] = [];

  for (let i = 0; i < anomalyBias.length; i++) {
    const kind = anomalyBias[i];
    const roomTypes = CONTAINER_DEFS[kind].roomTypes;
    for (let j = 0; j < roomTypes.length; j++) {
      if (roomTypes[j] === roomType) {
        fitting.push(kind);
        break;
      }
    }
  }

  for (let i = 0; i < factionBias.length; i++) {
    const kind = factionBias[i];
    const roomTypes = CONTAINER_DEFS[kind].roomTypes;
    for (let j = 0; j < roomTypes.length; j++) {
      if (roomTypes[j] === roomType) {
        fitting.push(kind);
        break;
      }
    }
  }

  for (let i = 0; i < roomKinds.length; i++) {
    fitting.push(roomKinds[i]);
  }

  const pool = fitting.length > 0 ? fitting : roomKinds;
  return pool[(spec.seed + room.id * 17 + index * 7) % pool.length];
}

function spawnLoot(world: World, rooms: Room[], spec: ProceduralFloorSpec, spawnX: number, spawnY: number, reachable: Uint8Array): void {
  const cells = collectReachableLootCells(world, rooms, reachable, spawnX, spawnY);
  const used = new Set<number>();
  const anomalyBonus = spec.anomalyId === 'none' ? 0 : 1;
  const target = Math.min(24, 5 + spec.danger * 2 + anomalyBonus + (spec.majorityId === 'wild' || spec.majorityId === 'cultists' ? 1 : 0));
  for (let n = 0; n < target; n++) {
    const cell = pickReachableLootCell(cells, used, spec);
    if (!cell) break;
    used.add(cell.x + cell.y * W);
    const kind = chooseProceduralContainerKind(cell.room, spec, n);
    const inventory = seedProceduralLootInventory(cell.room, kind, spec);
    addProceduralLootContainer(world, spec, cell.room, cell, kind, inventory);
  }
}

function addDeepEngineerStash(world: World, rooms: Room[], spec: ProceduralFloorSpec, reachable: Uint8Array): void {
  if (spec.depth < O15_ENGINEER_STASH_MIN_DEPTH || spec.danger < 4 || spec.majorityId !== 'liquidators') return;
  if (spec.geometryId !== 'workshops' && spec.geometryId !== 'service_spines') return;
  const candidates = rooms.filter(room =>
    room.id !== 0 &&
    (room.type === RoomType.PRODUCTION || room.type === RoomType.STORAGE),
  );
  if (candidates.length === 0) return;
  const preferred = candidates[(spec.seed + spec.depth) % candidates.length];
  const target = findReachableContainerCell(world, candidates, reachable, spec.seed ^ 0x6015, preferred);
  if (!target) return;
  addProceduralLootContainer(
    world,
    spec,
    target.room,
    target,
    ContainerKind.WEAPON_CRATE,
    [
      { defId: O15_ENGINEER_FLAMER_ID, count: 1 },
      { defId: 'napalm_mix', count: 3 },
      { defId: 'empty_roks_tank', count: 1 },
    ],
    ['deep_engineer_stash', 'engineer', 'breach', 'napalm', 'fuel'],
    'Инженерный тайник 6О15-УТТХ',
  );
}

function addDeepReconStash(world: World, rooms: Room[], spec: ProceduralFloorSpec, reachable: Uint8Array): void {
  if (spec.depth < DEEP_RECON_STASH_MIN_DEPTH || spec.danger < 5 || spec.geometryId !== 'sump_causeways') return;
  const preferredRooms = rooms.filter(room =>
    room.id !== 0 &&
    (room.type === RoomType.STORAGE || room.type === RoomType.PRODUCTION || room.type === RoomType.HQ),
  );
  const candidates = preferredRooms.length > 0 ? preferredRooms : rooms.filter(room => room.id !== 0);
  if (candidates.length === 0) return;
  const preferred = candidates[(spec.seed + spec.depth * 13) % candidates.length];
  const target = findReachableContainerCell(world, candidates, reachable, spec.seed ^ 0x1047, preferred);
  if (!target) return;
  addProceduralLootContainer(
    world,
    spec,
    target.room,
    target,
    ContainerKind.SECRET_STASH,
    [
      { defId: LOSYASH_RIFLE_ID, count: 1 },
      { defId: RIFLE_BOLT_PACK_ID, count: 3 },
      { defId: 'filtered_water', count: 1 },
    ],
    ['deep_recon_stash', 'anti_elite', LOSYASH_RIFLE_ID, RIFLE_BOLT_PACK_ID],
    'Глубинный разведтайник Лосяша',
  );
}

function addSumpIslandStashes(world: World, rooms: Room[], spec: ProceduralFloorSpec, reachable: Uint8Array): void {
  if (spec.geometryId !== 'sump_causeways') return;
  const islands = rooms.filter(room => room.name.startsWith(SUMP_STASH_ROOM_PREFIX));
  const target = Math.min(2, islands.length);
  const occupied = new Set<number>();
  for (let i = 0; i < target; i++) {
    const room = islands[(spec.seed + i * 7) % islands.length];
    const pos = findReachableContainerCell(world, [room], reachable, spec.seed ^ 0x5a5a ^ i, room, occupied);
    if (!pos) continue;
    occupied.add(world.idx(pos.x, pos.y));
    addProceduralLootContainer(
      world,
      spec,
      room,
      pos,
      ContainerKind.SECRET_STASH,
      [
        { defId: 'filtered_water', count: 1 },
        { defId: i % 2 === 0 ? 'sealant_tube' : 'valve_tag', count: 1 },
        { defId: 'wet_rag_bundle', count: 2 },
      ],
      ['sump_island_stash', 'blackwater_crossing', 'contaminated_route', 'repair_cache'],
      `Тайник сухого острова ${i + 1}`,
    );
  }
}

function addDeepLiquidatorRewardStash(world: World, rooms: Room[], spec: ProceduralFloorSpec, reachable: Uint8Array): void {
  if (spec.depth < DEEP_LIQUIDATOR_REWARD_MIN_DEPTH || spec.danger < 5 || spec.majorityId !== 'liquidators') return;
  if (!spec.lootBiasIds.includes(GRANIT4U_BELT_SHOTGUN_ID)) return;
  const candidates = rooms.filter(room =>
    room.id !== 0 &&
    (room.type === RoomType.HQ || room.type === RoomType.STORAGE || room.type === RoomType.PRODUCTION),
  );
  if (candidates.length === 0) return;
  const preferred = candidates[(spec.seed + spec.depth * 19) % candidates.length];
  const target = findReachableContainerCell(world, candidates, reachable, spec.seed ^ 0x4704, preferred);
  if (!target) return;
  addProceduralLootContainer(
    world,
    spec,
    target.room,
    target,
    ContainerKind.WEAPON_CRATE,
    [
      { defId: GRANIT4U_BELT_SHOTGUN_ID, count: 1 },
      { defId: 'ammo_shells', count: 3 },
    ],
    ['deep_liquidator_reward', GRANIT4U_BELT_SHOTGUN_ID, 'ammo_shells'],
    'Глубинный ликвидаторский ящик «Гранит»-4у',
  );
}

function occupationForFaction(faction: Faction, roomType: RoomType): Occupation {
  if (faction === Faction.LIQUIDATOR) return Occupation.HUNTER;
  if (faction === Faction.CULTIST) return Occupation.PILGRIM;
  if (faction === Faction.SCIENTIST) return Occupation.SCIENTIST;
  if (faction === Faction.WILD) return chance(0.5) ? Occupation.ALCOHOLIC : Occupation.TRAVELER;
  if (roomType === RoomType.PRODUCTION) return chance(0.5) ? Occupation.MECHANIC : Occupation.TURNER;
  if (roomType === RoomType.MEDICAL) return Occupation.DOCTOR;
  if (roomType === RoomType.OFFICE) return Occupation.SECRETARY;
  return pick([Occupation.HOUSEWIFE, Occupation.LOCKSMITH, Occupation.COOK, Occupation.TRAVELER]);
}

function npcLoadout(faction: Faction, danger: number): { weapon?: string; tool?: string; inventory: { defId: string; count: number }[] } {
  if (faction === Faction.LIQUIDATOR) {
    if (danger >= 4 && chance(0.35)) return { weapon: 'ak47', inventory: [{ defId: 'ak47', count: 1 }, { defId: 'ammo_762', count: irng(12, 32) }] };
    return { weapon: 'makarov', inventory: [{ defId: 'makarov', count: 1 }, { defId: 'ammo_9mm', count: irng(8, 24) }] };
  }
  if (faction === Faction.CULTIST) return chance(0.35)
    ? { weapon: 'knife', tool: 'psi_strike', inventory: [{ defId: 'knife', count: 1 }, { defId: 'psi_strike', count: 1 }] }
    : { weapon: 'knife', inventory: [{ defId: 'knife', count: 1 }] };
  if (faction === Faction.WILD) return { weapon: 'pipe', inventory: [{ defId: 'pipe', count: 1 }] };
  if (chance(0.2 + danger * 0.03)) return { weapon: 'knife', inventory: [{ defId: 'knife', count: 1 }] };
  return { inventory: [] };
}

function spawnNpcs(world: World, rooms: Room[], entities: Entity[], nextId: { v: number }, spec: ProceduralFloorSpec): void {
  const majority = majorityById(spec.majorityId);
  const count = entitySpawnSlots(entities, EntityType.NPC, proceduralPopulationBudgetForSpec(spec, true).npcs);
  const cells = sampleNaturalPopulationCells(
    world,
    count,
    proceduralNpcPlacementProfile(spec, citizenServiceAnchors(rooms, spec)),
    proceduralNpcPopulationSeed(spec, nextId.v),
  );
  for (const cell of cells) {
    const room = rooms[world.roomMap[cell]];
    const roomType = room?.type ?? RoomType.CORRIDOR;
    const ownerFaction = territoryOwnerToFaction(territoryOwnerAtIndex(world, cell));
    const faction = ownerFaction !== null && chance(0.72)
      ? ownerFaction
      : chance(0.78) ? majority.npcFaction : pick([Faction.CITIZEN, Faction.LIQUIDATOR, Faction.WILD, Faction.CULTIST, Faction.SCIENTIST]);
    const occupation = occupationForFaction(faction, roomType);
    const zoneLevel = world.zones[world.zoneMap[cell]]?.level ?? spec.danger;
    const rpg = randomRPG(gaussianLevel(zoneLevel, 2));
    const maxHp = getMaxHp(rpg);
    const nm = randomName(faction);
    const loadout = npcLoadout(faction, spec.danger);
    entities.push({
      id: nextId.v++,
      type: EntityType.NPC,
      x: (cell % W) + 0.5,
      y: ((cell / W) | 0) + 0.5,
      angle: Math.random() * Math.PI * 2,
      pitch: 0,
      alive: true,
      speed: occupation === Occupation.CHILD ? 0.8 : 1.15,
      sprite: occupation,
      name: nm.name,
      firstName: nm.firstName,
      lastName: nm.lastName,
      isFemale: nm.female,
      needs: freshNeeds(),
      hp: maxHp,
      maxHp,
      money: irng(5, 80 + spec.danger * 30),
      ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
      faction,
      occupation,
      isTraveler: true,
      questId: -1,
      rpg,
      inventory: loadout.inventory,
      weapon: loadout.weapon,
      tool: loadout.tool,
    });
  }
}

function citizenServiceAnchors(rooms: readonly Room[], spec: ProceduralFloorSpec): PlacementFieldAnchor[] {
  if (spec.majorityId !== 'citizens' || spec.anomalyId === 'zombie_apocalypse') return [];
  return rooms
    .filter(room =>
      room.name.startsWith('Общая кухня') ||
      room.name.startsWith('Пайковая кухня') ||
      room.name.startsWith('Гражданское укрытие') ||
      room.name.startsWith('Тихая ниша укрытия') ||
      room.name.startsWith('Свидетельский карман') ||
      room.type === RoomType.KITCHEN ||
      room.type === RoomType.COMMON,
    )
    .sort((a, b) => (b.w * b.h) - (a.w * a.h))
    .slice(0, 12)
    .map(room => {
      const center = roomCenter(room);
      const shelter = room.name.startsWith('Гражданское укрытие') || room.name.startsWith('Тихая ниша укрытия');
      const kitchen = room.type === RoomType.KITCHEN || room.name.startsWith('Общая кухня') || room.name.startsWith('Пайковая кухня');
      return {
        x: center.x + 0.5,
        y: center.y + 0.5,
        radius: shelter ? 62 : kitchen ? 54 : 44,
        weight: shelter ? 1.58 : kitchen ? 1.45 : 1.28,
      };
    });
}

function proceduralNpcPlacementProfile(spec: ProceduralFloorSpec, anchors: readonly PlacementFieldAnchor[] = []): NaturalPopulationProfile {
  const majority = majorityById(spec.majorityId);
  const highDensity = spec.anomalyId === 'zombie_apocalypse';
  const zoneWeights: Partial<Record<ZoneFaction, number>> = {
    [ZoneFaction.CITIZEN]: highDensity ? 1.0 : 0.98,
    [ZoneFaction.LIQUIDATOR]: highDensity ? 1.0 : 0.98,
    [ZoneFaction.CULTIST]: highDensity ? 1.0 : 0.98,
    [ZoneFaction.SCIENTIST]: highDensity ? 1.0 : 0.98,
    [ZoneFaction.WILD]: highDensity ? 1.0 : 0.98,
  };
  zoneWeights[majority.zoneFaction] = highDensity ? 1.04 : 1.14;
  if (spec.geometryId === 'communal_knots' && !highDensity) {
    if (spec.majorityId === 'citizens') zoneWeights[ZoneFaction.CITIZEN] = 1.22;
    return {
      noiseScale: 104,
      noiseStrength: 0.14,
      openWeight: 1.0,
      anchors,
      roomWeights: {
        [RoomType.KITCHEN]: 1.65,
        [RoomType.COMMON]: 1.55,
        [RoomType.BATHROOM]: 1.42,
        [RoomType.SMOKING]: 1.32,
        [RoomType.LIVING]: 1.22,
        [RoomType.CORRIDOR]: 1.08,
        [RoomType.STORAGE]: 0.78,
        [RoomType.PRODUCTION]: 0.72,
        [RoomType.OFFICE]: 0.72,
        [RoomType.MEDICAL]: 0.72,
        [RoomType.HQ]: 0.66,
      },
      zoneWeights,
    };
  }
  if (spec.majorityId === 'citizens' && !highDensity) {
    zoneWeights[ZoneFaction.CITIZEN] = 1.22;
    return {
      noiseScale: 112,
      noiseStrength: 0.08,
      openWeight: 1.08,
      smoothingPasses: 3,
      smoothingBlend: 0.62,
      bucketSize: 32,
      maxPerBucket: 16,
      anchors,
      roomWeights: {
        [RoomType.KITCHEN]: 1.52,
        [RoomType.COMMON]: 1.38,
        [RoomType.LIVING]: 1.18,
        [RoomType.SMOKING]: 1.12,
        [RoomType.CORRIDOR]: 1.08,
        [RoomType.STORAGE]: 0.78,
        [RoomType.PRODUCTION]: 0.74,
        [RoomType.OFFICE]: 0.84,
        [RoomType.MEDICAL]: 0.88,
        [RoomType.BATHROOM]: 0.72,
        [RoomType.HQ]: 0.68,
      },
      zoneWeights,
    };
  }
  return {
    noiseScale: highDensity ? 160 : 128,
    noiseStrength: highDensity ? 0.02 : 0.1,
    openWeight: 1.0,
    bucketSize: highDensity ? 32 : undefined,
    maxPerBucket: highDensity ? 20 : undefined,
    roomWeights: highDensity
      ? {
          [RoomType.LIVING]: 1.0,
          [RoomType.KITCHEN]: 1.0,
          [RoomType.COMMON]: 1.0,
          [RoomType.CORRIDOR]: 1.0,
          [RoomType.PRODUCTION]: 1.0,
          [RoomType.OFFICE]: 1.0,
          [RoomType.MEDICAL]: 1.0,
          [RoomType.STORAGE]: 1.0,
          [RoomType.SMOKING]: 1.0,
          [RoomType.BATHROOM]: 1.0,
          [RoomType.HQ]: 1.0,
        }
      : {
          [RoomType.LIVING]: 1.08,
          [RoomType.KITCHEN]: 1.06,
          [RoomType.COMMON]: 1.05,
          [RoomType.CORRIDOR]: 1.0,
          [RoomType.PRODUCTION]: 0.98,
          [RoomType.OFFICE]: 0.98,
          [RoomType.MEDICAL]: 0.96,
          [RoomType.STORAGE]: 0.94,
          [RoomType.SMOKING]: 0.94,
          [RoomType.BATHROOM]: 0.9,
          [RoomType.HQ]: 0.9,
        },
    zoneWeights,
  };
}

function proceduralNpcPopulationSeed(spec: ProceduralFloorSpec, nextId: number): number {
  return (spec.seed ^ Math.imul(spec.z + 97, 0x45d9f3b) ^ Math.imul(nextId + 1, 0x27d4eb2d)) >>> 0;
}

function randomFloorCell(world: World, sx: number, sy: number, minDist2: number): { x: number; y: number } | null {
  for (let attempt = 0; attempt < 5000; attempt++) {
    const x = irng(4, W - 5);
    const y = irng(4, W - 5);
    const ci = world.idx(x, y);
    if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) continue;
    if (minDist2 > 0 && world.dist2(sx, sy, x + 0.5, y + 0.5) < minDist2) continue;
    return { x, y };
  }
  return null;
}

function anomalyRoutePressure(spec: ProceduralFloorSpec): number {
  return proceduralFloorAnomalyRoutePressure(spec);
}

function proceduralPopulationBudgetForSpec(spec: ProceduralFloorSpec, npcAllowed: boolean) {
  return proceduralPopulationBudget({
    z: spec.z,
    danger: spec.danger,
    anomalyPressure: anomalyRoutePressure(spec),
    industrial: isIndustrialGeometry(spec.geometryId),
    npcAllowed,
    profileId: proceduralPopulationProfileId(spec.anomalyId),
  });
}

function routePressureLevel(spec: ProceduralFloorSpec): number {
  return proceduralFloorRoutePressureLevel(spec);
}

function proceduralMonsterCount(spec: ProceduralFloorSpec): number {
  return proceduralPopulationBudgetForSpec(spec, floorRunZAllowsNpcs(spec.z)).monsters;
}

function rareMonsterLimit(spec: ProceduralFloorSpec): number {
  if (spec.danger >= 5) return 2;
  if (spec.danger >= 3) return 1;
  return 0;
}

function rareMonsterChance(spec: ProceduralFloorSpec): number {
  return Math.min(0.08, 0.012 + spec.danger * 0.008 + routePressureLevel(spec) * 0.005);
}

function proceduralAllowsGnilushka(spec: ProceduralFloorSpec): boolean {
  return spec.anomalyId === 'samosbor_seed'
    || spec.anomalyId === 'false_safe_block'
    || spec.anomalyId === 'mushroom_mycelium';
}

function roomTypeAt(world: World, x: number, y: number): RoomType | undefined {
  const rid = world.roomMap[world.idx(x, y)];
  if (rid >= 0) return world.rooms[rid]?.type;
  return RoomType.CORRIDOR;
}

function canPlaceBezekhiyAt(world: World, x: number, y: number): boolean {
  const idx = world.idx(x, y);
  return world.cells[idx] === Cell.FLOOR && !world.solid(x, y);
}

function bezekhiyDoorSpawn(world: World, pos: { x: number; y: number }): { x: number; y: number } | null {
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  let best: { x: number; y: number } | null = null;
  let bestD2 = 18 * 18;
  for (let dy = -18; dy <= 18; dy++) {
    for (let dx = -18; dx <= 18; dx++) {
      const x = world.wrap(pos.x + dx);
      const y = world.wrap(pos.y + dy);
      const idx = world.idx(x, y);
      if (world.cells[idx] !== Cell.DOOR || !world.doors.has(idx)) continue;
      const d2 = world.dist2(pos.x + 0.5, pos.y + 0.5, x + 0.5, y + 0.5);
      if (d2 >= bestD2) continue;
      for (const [ox, oy] of dirs) {
        const sx = world.wrap(x + ox);
        const sy = world.wrap(y + oy);
        if (!canPlaceBezekhiyAt(world, sx, sy)) continue;
        best = { x: sx, y: sy };
        bestD2 = d2;
        break;
      }
    }
  }
  return best;
}

function tumannikFogSpawn(world: World, pos: { x: number; y: number }): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD2 = 30 * 30;
  for (let dy = -30; dy <= 30; dy++) {
    for (let dx = -30; dx <= 30; dx++) {
      const x = world.wrap(pos.x + dx);
      const y = world.wrap(pos.y + dy);
      const ci = world.idx(x, y);
      if (world.fog[ci] < 36) continue;
      if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) continue;
      if (world.solid(x, y)) continue;
      const d2 = world.dist2(pos.x + 0.5, pos.y + 0.5, x + 0.5, y + 0.5);
      if (d2 >= bestD2) continue;
      bestD2 = d2;
      best = { x, y };
    }
  }
  return best;
}

function spawnMonster(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  spec: ProceduralFloorSpec,
  sx: number,
  sy: number,
  allowRare: boolean,
): MonsterKind | null {
  if (!canSpawnEntityType(entities, EntityType.MONSTER)) return null;
  const pos = randomFloorCell(world, sx, sy, 90 * 90);
  if (!pos) return null;
  const kind = chooseFloorMonsterKind({
    floor: proceduralMonsterFloor(spec),
    roomType: roomTypeAt(world, pos.x, pos.y),
    floorTags: spec.monsterBiasTags,
    samosborCount: spec.danger,
    allowRare,
    excludeKinds: proceduralAllowsGnilushka(spec) ? undefined : EXCLUDE_GNILUSHKA,
    biasKinds: spec.monsterBiasKinds,
    routePressure: routePressureLevel(spec),
  });
  const def = MONSTERS[kind];
  const spawnPos = kind === MonsterKind.BEZEKHIY
    ? bezekhiyDoorSpawn(world, pos) ?? pos
    : kind === MonsterKind.TUMANNIK
      ? tumannikFogSpawn(world, pos)
      : pos;
  if (!spawnPos) return null;
  const zoneLevel = world.zones[world.zoneMap[world.idx(spawnPos.x, spawnPos.y)]]?.level ?? spec.danger;
  const hp = Math.round(def.hp * (0.75 + zoneLevel * 0.18));
  const monster: Entity = {
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: spawnPos.x + 0.5,
    y: spawnPos.y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: def.speed * (0.9 + spec.danger * 0.04),
    sprite: monsterSpr(kind),
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: spawnPos.x, ty: spawnPos.y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(Math.max(1, zoneLevel)),
    phasing: kind === MonsterKind.SPIRIT,
  };
  if (kind === MonsterKind.PAUPSINA) stampPaupsinaWebWarning(world, spawnPos.x, spawnPos.y, spec.seed ^ nextId.v);
  entities.push(monster);
  return kind;
}

function stampPaupsinaWebWarning(world: World, cx: number, cy: number, seed: number): void {
  for (let i = 0; i < 5; i++) {
    const a = seed * 0.017 + i * 1.77;
    const d = i === 0 ? 0 : 1 + (i % 3);
    const x = world.wrap(cx + Math.round(Math.cos(a) * d));
    const y = world.wrap(cy + Math.round(Math.sin(a) * d));
    if (world.solid(x, y)) continue;
    stampMark(world, x, y, 0.5, 0.5, i === 0 ? 0.54 : 0.32, MarkType.WEB, seed + i * 91, 226, 226, 202, i === 0 ? 175 : 120);
  }
}

function spawnMonsters(world: World, entities: Entity[], nextId: { v: number }, spec: ProceduralFloorSpec, sx: number, sy: number): void {
  const count = entitySpawnSlots(entities, EntityType.MONSTER, proceduralMonsterCount(spec));
  const rareLimit = rareMonsterLimit(spec);
  let rareSpawned = 0;
  for (let i = 0; i < count; i++) {
    const allowRare = rareSpawned < rareLimit && chance(rareMonsterChance(spec));
    const kind = spawnMonster(world, entities, nextId, spec, sx, sy, allowRare);
    if (kind !== null && getMonsterEcology(kind)?.rare) rareSpawned++;
  }
}

function roomCenter(room: Room): { x: number; y: number } {
  return {
    x: room.x + Math.floor(room.w / 2),
    y: room.y + Math.floor(room.h / 2),
  };
}

function chooseSmogSourceRoom(rooms: Room[]): Room | null {
  const preferred = rooms.filter(room => (
    room.id !== 0 &&
    (room.type === RoomType.PRODUCTION ||
      room.type === RoomType.SMOKING ||
      room.type === RoomType.STORAGE ||
      room.type === RoomType.CORRIDOR ||
      room.type === RoomType.COMMON)
  ));
  if (preferred.length > 0) return pick(preferred);
  return rooms.length > 1 ? pick(rooms.slice(1)) : rooms[0] ?? null;
}

function nearbySmogRooms(world: World, rooms: Room[], source: Room, spec: ProceduralFloorSpec): Room[] {
  const sourceCenter = roomCenter(source);
  const serviceSpineBonus = spec.geometryId === 'service_spines' ? 4 : 0;
  const limit = Math.min(rooms.length, 5 + spec.danger * 2 + serviceSpineBonus);
  const radius = 74 + spec.danger * 18 + serviceSpineBonus * 6;
  const weighted = rooms
    .filter(room => room.id !== source.id && room.id !== 0)
    .map(room => {
      const c = roomCenter(room);
      let priority = world.dist2(sourceCenter.x, sourceCenter.y, c.x, c.y);
      if (room.type === RoomType.CORRIDOR || room.type === RoomType.SMOKING) priority *= 0.55;
      if (room.type === RoomType.PRODUCTION || room.type === RoomType.STORAGE) priority *= 0.75;
      return { room, priority };
    })
    .filter(item => item.priority <= radius * radius || item.room.type === RoomType.CORRIDOR)
    .sort((a, b) => a.priority - b.priority);
  const out = [source];
  for (const item of weighted) {
    if (out.length >= limit) break;
    out.push(item.room);
  }
  return out;
}

interface SmogProxyField {
  grid: ProxyGrid;
}

function smogProxyDelta(size: number, from: number, to: number): number {
  let d = to - from;
  if (d > size / 2) d -= size;
  if (d < -size / 2) d += size;
  return d;
}

function smogHash01(seed: number, x: number, y: number, salt: number): number {
  let h = seed ^ Math.imul(x + 0x6d2b, 0x85ebca6b) ^ Math.imul(y + 0x4c15, 0xc2b2ae35) ^ Math.imul(salt + 0x27d4, 0x165667b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function smoothSmogProxyField(grid: ProxyGrid, passes: number): void {
  const scratch = new Float32Array(grid.values.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < grid.size; y++) {
      for (let x = 0; x < grid.size; x++) {
        const i = proxyIndex(grid, x, y);
        const n = grid.values[proxyIndex(grid, x, y - 1)];
        const s = grid.values[proxyIndex(grid, x, y + 1)];
        const w = grid.values[proxyIndex(grid, x - 1, y)];
        const e = grid.values[proxyIndex(grid, x + 1, y)];
        const nw = grid.values[proxyIndex(grid, x - 1, y - 1)];
        const se = grid.values[proxyIndex(grid, x + 1, y + 1)];
        scratch[i] = grid.values[i] * 0.58 + (n + s + w + e) * 0.075 + (nw + se) * 0.06;
      }
    }
    grid.values.set(scratch);
  }
}

function buildSmogProxyField(source: Room, spec: ProceduralFloorSpec): SmogProxyField {
  const grid = createProxyGrid(SMOG_PROXY_SIZE, spec.seed ^ 0x510f00d);
  const center = roomCenter(source);
  const sourceProxy = worldToProxy(grid, center.x, center.y);
  const radius = 4.7 + spec.danger * 1.25;
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      const dx = smogProxyDelta(grid.size, sourceProxy.x, x);
      const dy = smogProxyDelta(grid.size, sourceProxy.y, y);
      const d = Math.sqrt(dx * dx + dy * dy);
      const radial = Math.max(0, 1 - d / radius);
      if (radial <= 0) continue;
      const angle = Math.atan2(dy, dx);
      const n1 = proxySample01(grid, x + dy, y - dx, 11);
      const n2 = proxySample01(grid, x - dy * 2, y + dx * 2, 17);
      const curl = 0.5 + 0.5 * Math.sin(angle * 3.0 + d * 1.28 + (n1 - n2) * Math.PI * 3);
      const plume = Math.max(0, 1 - Math.abs(Math.sin(angle * 1.7 - d * 0.92 + n2 * Math.PI * 2)));
      grid.values[proxyIndex(grid, x, y)] = clamp01(radial * (0.56 + curl * 0.34) + radial * plume * 0.22);
    }
  }
  smoothSmogProxyField(grid, 2);
  return { grid };
}

function smogPotentialAt(field: SmogProxyField, x: number, y: number, spec: ProceduralFloorSpec): number {
  const p = worldToProxy(field.grid, x, y);
  const localX = Math.floor(p.localX / Math.max(1, field.grid.cellSize / 4));
  const localY = Math.floor(p.localY / Math.max(1, field.grid.cellSize / 4));
  const base = field.grid.values[p.index];
  const filament = proxySample01(field.grid, p.x + localY, p.y - localX, 29);
  const vein = Math.max(0, Math.sin((p.localX - p.localY) * 0.39 + filament * Math.PI * 2));
  return clamp01(base * 0.9 + vein * base * 0.16 + smogHash01(spec.seed, x, y, 41) * 0.035);
}

function addSmogCell(world: World, set: Set<number>, x: number, y: number, density: number, maxCells = SMOG_MAX_CELLS): void {
  const ci = world.idx(x, y);
  if (!set.has(ci) && set.size >= maxCells) return;
  if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) return;
  if (world.features[ci] === Feature.LIFT_BUTTON) return;
  world.fog[ci] = Math.max(world.fog[ci], Math.max(0, Math.min(235, density)));
  set.add(ci);
}

function fillSmogRoom(world: World, set: Set<number>, room: Room, source: Room, spec: ProceduralFloorSpec, field: SmogProxyField): void {
  const sourceRoom = room.id === source.id;
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const ci = world.idx(x, y);
      if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) continue;
      const potential = smogPotentialAt(field, x, y, spec);
      const roomBias = sourceRoom ? 0.28 : room.type === RoomType.CORRIDOR ? 0.12 : room.type === RoomType.SMOKING ? 0.16 : 0.05;
      const jitter = smogHash01(spec.seed, x, y, room.id + 57) * 0.16;
      const threshold = sourceRoom ? 0.18 : room.type === RoomType.CORRIDOR ? 0.3 : 0.36;
      if (potential + roomBias + jitter < threshold) continue;
      const edge = dx === 0 || dy === 0 || dx === room.w - 1 || dy === room.h - 1;
      const density = (sourceRoom ? 92 : 48) + potential * 162 + roomBias * 96 + spec.danger * 6;
      addSmogCell(world, set, x, y, Math.floor(edge ? density * 0.66 : density));
    }
  }
}

function seedSmogCorridorPockets(world: World, set: Set<number>, source: Room, spec: ProceduralFloorSpec, field: SmogProxyField): void {
  const c = roomCenter(source);
  const radius = 58 + spec.danger * 22;
  const samples = 1100 + spec.danger * 320;
  for (let i = 0; i < samples; i++) {
    const baseAngle = i * 2.399963 + smogHash01(spec.seed, i, source.id, 83) * 0.72;
    const dist = Math.sqrt(smogHash01(spec.seed, i, source.id, 89)) * radius;
    const curl = Math.sin(dist * 0.087 + baseAngle * 2.1 + spec.seed * 0.00011);
    const angle = baseAngle + curl * 0.72;
    const side = Math.sin(dist * 0.13 + baseAngle) * 7.5;
    const x = Math.floor(c.x + Math.cos(angle) * dist + Math.cos(angle + Math.PI / 2) * side);
    const y = Math.floor(c.y + Math.sin(angle) * dist + Math.sin(angle + Math.PI / 2) * side);
    const ci = world.idx(x, y);
    if (world.roomMap[ci] >= 0 && world.roomMap[ci] !== source.id) continue;
    const potential = smogPotentialAt(field, x, y, spec);
    if (potential < 0.16 && smogHash01(spec.seed, x, y, i) < 0.65) continue;
    addSmogCell(world, set, x, y, Math.floor(52 + potential * 138 + spec.danger * 4));
    if (smogHash01(spec.seed, x, y, i + 101) < 0.075) {
      stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.38, 0.36, spec.seed + i, 86, 76, 52, false);
    }
  }
}

function bestSmogRoomCell(world: World, room: Room, field: SmogProxyField, spec: ProceduralFloorSpec, preferClear: boolean): { x: number; y: number } | null {
  let best: { x: number; y: number; score: number } | null = null;
  for (let dy = 1; dy < Math.max(2, room.h - 1); dy++) {
    for (let dx = 1; dx < Math.max(2, room.w - 1); dx++) {
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const ci = world.idx(x, y);
      if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) continue;
      if (world.features[ci] === Feature.LIFT_BUTTON) continue;
      const potential = smogPotentialAt(field, x, y, spec);
      const fog = world.fog[ci];
      const centerScore = 1 / (1 + Math.abs(dx - room.w / 2) + Math.abs(dy - room.h / 2));
      const noise = smogHash01(spec.seed, x, y, room.id + (preferClear ? 131 : 137));
      const score = preferClear
        ? (fog < 76 ? 1.2 : 0) + (1 - potential) * 0.75 + centerScore * 0.25 + noise * 0.12
        : potential * 1.2 + centerScore * 0.3 + noise * 0.12;
      if (!best || score > best.score) best = { x, y, score };
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

function placeSmogSource(world: World, source: Room, spec: ProceduralFloorSpec, set: Set<number>, field: SmogProxyField): { x: number; y: number } {
  const pos = bestSmogRoomCell(world, source, field, spec, false) ?? randomRoomCell(source);
  const ci = world.idx(pos.x, pos.y);
  world.features[ci] = Feature.APPARATUS;
  world.anomalySmogSource = ci;
  world.anomalySmogHandled = false;
  addSmogCell(world, set, pos.x, pos.y, 235, Number.POSITIVE_INFINITY);
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (dx * dx + dy * dy > 10) continue;
      addSmogCell(world, set, pos.x + dx, pos.y + dy, irng(176, 235), Number.POSITIVE_INFINITY);
    }
  }
  stampSurfaceSplat(world, pos.x, pos.y, 0.5, 0.5, 0.72, 0.92, spec.seed ^ 0x51f00d, 92, 76, 44, false);
  return pos;
}

function clearSmogFilterPocket(world: World, set: Set<number>, x: number, y: number, spec: ProceduralFloorSpec, pocketIndex: number): void {
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > 10) continue;
      const px = world.wrap(x + dx);
      const py = world.wrap(y + dy);
      const ci = world.idx(px, py);
      if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) continue;
      if (world.features[ci] === Feature.LIFT_BUTTON) continue;
      const target = 10 + Math.floor(Math.sqrt(d2) * 5) + Math.floor(smogHash01(spec.seed, px, py, pocketIndex + 149) * 9);
      world.fog[ci] = Math.min(world.fog[ci], target);
      set.add(ci);
    }
  }
  const center = world.idx(x, y);
  if (world.features[center] === Feature.NONE) world.features[center] = Feature.APPARATUS;
  stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.46, 0.48, spec.seed + pocketIndex * 313, 62, 108, 82, false);
}

function smogDropCellNear(world: World, x: number, y: number): { x: number; y: number } | null {
  for (let radius = 0; radius <= 7; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const px = world.wrap(x + dx);
        const py = world.wrap(y + dy);
        const ci = world.idx(px, py);
        if (world.solid(px, py)) continue;
        if (world.features[ci] === Feature.LIFT_BUTTON) continue;
        return { x: px, y: py };
      }
    }
  }
  return null;
}

function dropSmogItemNear(world: World, entities: Entity[], nextId: { v: number }, x: number, y: number, defId: string, count = 1): void {
  const pos = smogDropCellNear(world, x, y);
  if (!pos) return;
  dropItem(entities, nextId, pos.x, pos.y, defId, count);
}

function placeSmogFilterPockets(
  world: World,
  rooms: Room[],
  entities: Entity[],
  nextId: { v: number },
  source: Room,
  affectedRooms: readonly Room[],
  field: SmogProxyField,
  spec: ProceduralFloorSpec,
  set: Set<number>,
): void {
  const candidates = affectedRooms.filter(room => room.id !== source.id && room.type !== RoomType.CORRIDOR);
  const fallback = rooms.filter(room => room.id !== source.id && room.id !== 0);
  const pool = (candidates.length > 0 ? candidates : fallback).slice();
  if (pool.length === 0) pool.push(source);
  pool.sort((a, b) => {
    const ac = roomCenter(a);
    const bc = roomCenter(b);
    const ap = smogPotentialAt(field, ac.x, ac.y, spec) + smogHash01(spec.seed, a.id, source.id, 167) * 0.08;
    const bp = smogPotentialAt(field, bc.x, bc.y, spec) + smogHash01(spec.seed, b.id, source.id, 167) * 0.08;
    return ap - bp;
  });

  const count = Math.min(pool.length, 2 + (spec.danger >= 3 ? 1 : 0) + (spec.danger >= 5 ? 1 : 0));
  for (let i = 0; i < count; i++) {
    const room = pool[(i * 3) % pool.length];
    const pos = bestSmogRoomCell(world, room, field, spec, true);
    if (!pos) continue;
    clearSmogFilterPocket(world, set, pos.x, pos.y, spec, i);
    dropSmogItemNear(world, entities, nextId, pos.x + 1, pos.y, SMOG_COUNTERPLAY_DROPS[i % SMOG_COUNTERPLAY_DROPS.length], 1);
    if (i === 0 || spec.danger >= 4) dropSmogItemNear(world, entities, nextId, pos.x - 1, pos.y, i === 0 ? 'valve_tag' : 'filter_layer', 1);
  }
}

function spawnSmogLooter(world: World, room: Room, entities: Entity[], nextId: { v: number }, spec: ProceduralFloorSpec): void {
  if (!canSpawnEntityType(entities, EntityType.NPC)) return;
  const pos = randomRoomCell(room);
  const ci = world.idx(pos.x, pos.y);
  const zoneLevel = world.zones[world.zoneMap[ci]]?.level ?? spec.danger;
  const rpg = randomRPG(gaussianLevel(zoneLevel, 2));
  const maxHp = getMaxHp(rpg);
  const nm = randomName(Faction.WILD);
  const weapon = chance(0.55) ? 'pipe' : 'knife';
  entities.push({
    id: nextId.v++,
    type: EntityType.NPC,
    x: pos.x + 0.5,
    y: pos.y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: 1.15,
    sprite: chance(0.45) ? Occupation.ALCOHOLIC : Occupation.TRAVELER,
    name: nm.name,
    firstName: nm.firstName,
    lastName: nm.lastName,
    isFemale: nm.female,
    needs: freshNeeds(),
    hp: maxHp,
    maxHp,
    money: irng(12, 55 + spec.danger * 22),
    ai: { goal: AIGoal.WANDER, tx: pos.x, ty: pos.y, path: [], pi: 0, stuck: 0, timer: 0 },
    faction: Faction.WILD,
    occupation: Occupation.TRAVELER,
    isTraveler: true,
    questId: -1,
    rpg,
    inventory: [
      { defId: weapon, count: 1 },
      { defId: chance(0.55) ? 'cigs' : 'filter_receipt', count: 1 },
      { defId: chance(0.3) ? 'forged_quarantine_clearance' : 'grey_briquette', count: 1 },
    ],
    weapon,
  });
}

function spawnSmogMonster(world: World, room: Room, entities: Entity[], nextId: { v: number }, spec: ProceduralFloorSpec): void {
  if (!canSpawnEntityType(entities, EntityType.MONSTER)) return;
  const pos = randomRoomCell(room);
  const kind = pick([MonsterKind.POLZUN, MonsterKind.TVAR, MonsterKind.NELYUD, MonsterKind.SHADOW]);
  const def = MONSTERS[kind];
  const zoneLevel = world.zones[world.zoneMap[world.idx(pos.x, pos.y)]]?.level ?? spec.danger;
  const hp = Math.round(def.hp * (0.78 + zoneLevel * 0.16));
  const monster: Entity = {
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: pos.x + 0.5,
    y: pos.y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: def.speed * (0.95 + spec.danger * 0.035),
    sprite: monsterSpr(kind),
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: pos.x, ty: pos.y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(Math.max(1, zoneLevel)),
    phasing: kind === MonsterKind.SPIRIT,
  };
  entities.push(monster);
}

function newCollectorMetricsDraft(): CollectorMetricsDraft {
  return {
    wetCells: new Set<number>(),
    dryCausewayCells: new Set<number>(),
    repairCrossingCells: new Set<number>(),
    valveRoomIds: [],
    wetRouteLength: 0,
    dryRouteLength: 0,
  };
}

function collectorProxyIdx(px: number, py: number): number {
  return ((py + COLLECTOR_PROXY_SIZE) % COLLECTOR_PROXY_SIZE) * COLLECTOR_PROXY_SIZE +
    ((px + COLLECTOR_PROXY_SIZE) % COLLECTOR_PROXY_SIZE);
}

function collectorProxyDelta(a: number, b: number): number {
  let d = b - a;
  if (d > COLLECTOR_PROXY_SIZE / 2) d -= COLLECTOR_PROXY_SIZE;
  if (d < -COLLECTOR_PROXY_SIZE / 2) d += COLLECTOR_PROXY_SIZE;
  return d;
}

function collectorHash01(seed: number, a: number, b: number, salt: number): number {
  let h = seed ^ Math.imul(a + 0x9e37, 0x85ebca6b) ^ Math.imul(b + 0x632b, 0xc2b2ae35) ^ Math.imul(salt + 0x27d4, 0x165667b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

function clampCollectorProxyCoord(value: number): number {
  return Math.max(3, Math.min(COLLECTOR_PROXY_SIZE - 4, value));
}

function collectorBasinCenters(spec: ProceduralFloorSpec): { px: number; py: number }[] {
  const base = [
    { px: 8, py: 8 },
    { px: 23, py: 9 },
    { px: 9, py: 23 },
    { px: 24, py: 24 },
    { px: 16, py: 16 },
  ];
  const count = Math.min(base.length, 4 + (spec.danger >= 4 ? 1 : 0));
  const centers: { px: number; py: number }[] = [];
  for (let i = 0; i < count; i++) {
    const jx = Math.floor(collectorHash01(spec.seed, i, spec.ordinal, 11) * 7) - 3;
    const jy = Math.floor(collectorHash01(spec.seed, i, spec.z, 17) * 7) - 3;
    centers.push({
      px: clampCollectorProxyCoord(base[i].px + jx),
      py: clampCollectorProxyCoord(base[i].py + jy),
    });
  }
  return centers;
}

function nearestCollectorBasin(px: number, py: number, centers: readonly { px: number; py: number }[], height: number): number {
  let best = 0;
  let bestScore = Infinity;
  for (let i = 0; i < centers.length; i++) {
    const dx = collectorProxyDelta(px, centers[i].px);
    const dy = collectorProxyDelta(py, centers[i].py);
    const score = dx * dx + dy * dy + Math.max(0, height) * 5;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function buildCollectorProxyField(spec: ProceduralFloorSpec): CollectorProxyField {
  const size = COLLECTOR_PROXY_SIZE;
  const n = size * size;
  const centers = collectorBasinCenters(spec);
  const height = new Float32Array(n);
  const scratch = new Float32Array(n);
  const basin = new Int8Array(n);
  const wet = new Uint8Array(n);
  const flow = new Uint16Array(n);
  const flowTo = new Int16Array(n);
  const order = new Int32Array(n);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let h = 0.58 + py * 0.008 - px * 0.003;
      h += Math.sin((px + spec.seed % 31) * 0.43) * 0.035;
      h += Math.cos((py + spec.ordinal * 3) * 0.39) * 0.04;
      h += (collectorHash01(spec.seed, px, py, 23) - 0.5) * 0.14;
      for (const center of centers) {
        const dx = collectorProxyDelta(px, center.px);
        const dy = collectorProxyDelta(py, center.py);
        const d2 = dx * dx + dy * dy;
        h -= 0.72 * Math.exp(-d2 / 25);
      }
      height[collectorProxyIdx(px, py)] = h;
    }
  }

  for (let pass = 0; pass < 2; pass++) {
    scratch.set(height);
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const idx = collectorProxyIdx(px, py);
        height[idx] = (
          scratch[idx] * 4 +
          scratch[collectorProxyIdx(px + 1, py)] +
          scratch[collectorProxyIdx(px - 1, py)] +
          scratch[collectorProxyIdx(px, py + 1)] +
          scratch[collectorProxyIdx(px, py - 1)]
        ) / 8;
      }
    }
  }

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const idx = collectorProxyIdx(px, py);
      basin[idx] = nearestCollectorBasin(px, py, centers, height[idx]);
      order[idx] = idx;
      flow[idx] = 1;
    }
  }
  order.sort((a, b) => height[b] - height[a]);
  flowTo.fill(-1);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const idx = collectorProxyIdx(px, py);
      let best = idx;
      let bestH = height[idx];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ni = collectorProxyIdx(px + dx, py + dy);
        if (height[ni] < bestH - 0.004) {
          bestH = height[ni];
          best = ni;
        }
      }
      if (best !== idx) flowTo[idx] = best;
    }
  }

  for (const idx of order) {
    const to = flowTo[idx];
    if (to < 0) continue;
    flow[to] = Math.min(65535, flow[to] + flow[idx]);
  }

  const sortedHeights = Array.from(height).sort((a, b) => a - b);
  const lowCut = sortedHeights[Math.floor(sortedHeights.length * (0.24 + spec.danger * 0.015))];
  const flowCut = 7 + Math.max(0, 4 - spec.danger);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const idx = collectorProxyIdx(px, py);
      let centerD2 = Infinity;
      for (const center of centers) {
        const dx = collectorProxyDelta(px, center.px);
        const dy = collectorProxyDelta(py, center.py);
        centerD2 = Math.min(centerD2, dx * dx + dy * dy);
      }
      if (height[idx] <= lowCut || flow[idx] >= flowCut || centerD2 <= 5) wet[idx] = 1;
    }
  }

  const saddleScores: { idx: number; score: number }[] = [];
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const idx = collectorProxyIdx(px, py);
      if (wet[idx]) continue;
      let mask = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          mask |= 1 << basin[collectorProxyIdx(px + dx, py + dy)];
        }
      }
      if ((mask & (mask - 1)) === 0) continue;
      saddleScores.push({ idx, score: height[idx] * 100 - flow[idx] * 0.45 + collectorHash01(spec.seed, px, py, 31) });
    }
  }
  saddleScores.sort((a, b) => a.score - b.score);

  const saddles: number[] = [];
  for (const item of saddleScores) {
    const px = item.idx % size;
    const py = (item.idx / size) | 0;
    let tooClose = false;
    for (const existing of saddles) {
      const ex = existing % size;
      const ey = (existing / size) | 0;
      const dx = collectorProxyDelta(px, ex);
      const dy = collectorProxyDelta(py, ey);
      if (dx * dx + dy * dy < 25) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    saddles.push(item.idx);
    if (saddles.length >= 5) break;
  }

  return { height, flow, basin, wet, saddles, basinCenters: centers };
}

function collectorProxyWorldPoint(idx: number): { x: number; y: number } {
  const px = idx % COLLECTOR_PROXY_SIZE;
  const py = (idx / COLLECTOR_PROXY_SIZE) | 0;
  return {
    x: Math.floor(px * COLLECTOR_PROXY_CELL + COLLECTOR_PROXY_CELL / 2),
    y: Math.floor(py * COLLECTOR_PROXY_CELL + COLLECTOR_PROXY_CELL / 2),
  };
}

function collectorBasinWorldPoint(center: { px: number; py: number }): { x: number; y: number } {
  return {
    x: Math.floor(center.px * COLLECTOR_PROXY_CELL + COLLECTOR_PROXY_CELL / 2),
    y: Math.floor(center.py * COLLECTOR_PROXY_CELL + COLLECTOR_PROXY_CELL / 2),
  };
}

function collectorCellMutable(world: World, ci: number): boolean {
  return world.cells[ci] !== Cell.LIFT &&
    world.hermoWall[ci] === 0 &&
    world.aptMask[ci] === 0 &&
    world.features[ci] !== Feature.LIFT_BUTTON &&
    !world.containerMap.has(ci);
}

function carveCollectorWetCell(world: World, x: number, y: number, spec: ProceduralFloorSpec, draft: CollectorMetricsDraft): boolean {
  const ci = world.idx(x, y);
  if (!collectorCellMutable(world, ci) || world.cells[ci] === Cell.DOOR) return false;
  if (world.roomMap[ci] >= 0 && world.features[ci] !== Feature.NONE) return false;
  const keepRoom = world.roomMap[ci] >= 0;
  world.cells[ci] = Cell.WATER;
  world.floorTex[ci] = Tex.F_WATER;
  world.wallTex[ci] = Tex.PIPE;
  if (!keepRoom) world.roomMap[ci] = -1;
  if (!keepRoom) world.features[ci] = Feature.NONE;
  draft.wetCells.add(ci);
  if (((x * 13 + y * 17 + spec.seed) & 63) === 0) {
    stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.34, 0.46, spec.seed ^ (x * 31 + y * 7), 25, 50, 48, false);
  }
  return true;
}

function carveCollectorDryCell(
  world: World,
  x: number,
  y: number,
  spec: ProceduralFloorSpec,
  draft: CollectorMetricsDraft,
  repairCrossing: boolean,
): boolean {
  const ci = world.idx(x, y);
  if (!collectorCellMutable(world, ci)) return false;
  if (world.cells[ci] === Cell.DOOR) return false;
  if (world.roomMap[ci] >= 0 && world.features[ci] !== Feature.NONE && world.cells[ci] !== Cell.WATER) return false;
  const wasWater = world.cells[ci] === Cell.WATER;
  const keepRoom = world.roomMap[ci] >= 0;
  world.cells[ci] = Cell.FLOOR;
  world.floorTex[ci] = Tex.F_CONCRETE;
  world.wallTex[ci] = Tex.PIPE;
  if (!keepRoom) world.roomMap[ci] = -1;
  if (!keepRoom || wasWater) world.features[ci] = Feature.NONE;
  draft.dryCausewayCells.add(ci);
  if (repairCrossing && wasWater) draft.repairCrossingCells.add(ci);
  if (repairCrossing && ((x * 19 + y * 23 + spec.seed) & 31) === 0) {
    stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.22, 0.34, spec.seed ^ (x * 11 + y * 41), 120, 108, 82, false);
  }
  return true;
}

function carveCollectorWetPatch(world: World, spec: ProceduralFloorSpec, field: CollectorProxyField, idx: number, draft: CollectorMetricsDraft): void {
  const point = collectorProxyWorldPoint(idx);
  const flow = field.flow[idx];
  const height = field.height[idx];
  const radius = 5 + Math.min(9, Math.floor(Math.sqrt(flow) * 0.9)) + (height < -0.2 ? 2 : 0);
  const rx = radius + Math.floor(collectorHash01(spec.seed, idx, flow, 41) * 5);
  const ry = radius + Math.floor(collectorHash01(spec.seed, idx, flow, 43) * 5);
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      const shape = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
      if (shape > 1 + collectorHash01(spec.seed, point.x + dx, point.y + dy, 47) * 0.18) continue;
      carveCollectorWetCell(world, point.x + dx, point.y + dy, spec, draft);
    }
  }
}

function carveCollectorLine(
  world: World,
  spec: ProceduralFloorSpec,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  wet: boolean,
  draft: CollectorMetricsDraft,
  repairCrossing = false,
): number {
  const horizontal = ay === by;
  const delta = horizontal ? world.delta(ax, bx) : world.delta(ay, by);
  const dir = delta >= 0 ? 1 : -1;
  const steps = Math.abs(delta);
  const beforeWet = draft.wetCells.size;
  const beforeDry = draft.dryCausewayCells.size;
  let x = world.wrap(ax);
  let y = world.wrap(ay);

  for (let s = 0; s <= steps; s++) {
    for (let side = -width; side <= width; side++) {
      const cx = horizontal ? x : x + side;
      const cy = horizontal ? y + side : y;
      if (wet) carveCollectorWetCell(world, cx, cy, spec, draft);
      else carveCollectorDryCell(world, cx, cy, spec, draft, repairCrossing);
    }
    if (s < steps) {
      if (horizontal) x = world.wrap(x + dir);
      else y = world.wrap(y + dir);
    }
  }

  return wet ? draft.wetCells.size - beforeWet : draft.dryCausewayCells.size - beforeDry;
}

function carveCollectorPath(
  world: World,
  spec: ProceduralFloorSpec,
  points: readonly { x: number; y: number }[],
  width: number,
  wet: boolean,
  draft: CollectorMetricsDraft,
  repairCrossing = false,
): number {
  let carved = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const horizontalFirst = ((spec.seed + i * 17 + (wet ? 5 : 0)) & 1) === 0;
    const mid = horizontalFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    carved += carveCollectorLine(world, spec, a.x, a.y, mid.x, mid.y, width, wet, draft, repairCrossing);
    carved += carveCollectorLine(world, spec, mid.x, mid.y, b.x, b.y, width, wet, draft, repairCrossing);
  }
  return carved;
}

function roomDist2(world: World, x: number, y: number, room: Room): number {
  const c = roomCenter(room);
  return world.dist2(x, y, c.x, c.y);
}

function chooseCollectorRouteTarget(world: World, rooms: Room[], spawnX: number, spawnY: number): { x: number; y: number } {
  const candidates = rooms
    .filter(room => room.type === RoomType.PRODUCTION || room.type === RoomType.STORAGE || room.type === RoomType.CORRIDOR || room.type === RoomType.COMMON)
    .sort((a, b) => roomDist2(world, spawnX, spawnY, b) - roomDist2(world, spawnX, spawnY, a));
  return candidates.length > 0 ? roomCenter(candidates[0]) : { x: world.wrap(spawnX + 360), y: world.wrap(spawnY + 240) };
}

function chooseCollectorSaddlePoints(field: CollectorProxyField): { x: number; y: number }[] {
  const saddles = field.saddles.length > 0
    ? field.saddles
    : field.basinCenters.map(center => collectorProxyIdx(center.px, center.py));
  return saddles.slice(0, 4).map(collectorProxyWorldPoint);
}

function markCollectorValveRooms(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  saddlePoints: readonly { x: number; y: number }[],
  draft: CollectorMetricsDraft,
): void {
  const used = new Set<number>();
  const candidates = rooms.filter(room =>
    room.id !== 0 &&
    room.w >= 5 &&
    room.h >= 5 &&
    (room.type === RoomType.PRODUCTION || room.type === RoomType.STORAGE || room.type === RoomType.COMMON || room.type === RoomType.CORRIDOR),
  );

  for (let i = 0; i < Math.min(saddlePoints.length, 2 + Math.floor(spec.danger / 2)); i++) {
    const saddle = saddlePoints[i];
    let best: Room | null = null;
    let bestD2 = Infinity;
    for (const room of candidates) {
      if (used.has(room.id)) continue;
      const d2 = roomDist2(world, saddle.x, saddle.y, room);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = room;
      }
    }
    if (!best) continue;
    used.add(best.id);
    draft.valveRoomIds.push(best.id);
    best.name = `${COLLECTOR_VALVE_ROOM_PREFIX} ${best.id}`;
    best.wallTex = Tex.PIPE;
    best.floorTex = Tex.F_CONCRETE;
    for (let dy = 0; dy < best.h; dy++) {
      for (let dx = 0; dx < best.w; dx++) {
        const ci = world.idx(best.x + dx, best.y + dy);
        if (world.roomMap[ci] !== best.id) continue;
        if (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER) world.floorTex[ci] = Tex.F_CONCRETE;
        if (world.cells[ci] === Cell.WALL) world.wallTex[ci] = Tex.PIPE;
      }
    }
    const c = roomCenter(best);
    const center = world.idx(c.x, c.y);
    if (world.roomMap[center] === best.id) world.features[center] = i % 2 === 0 ? Feature.MACHINE : Feature.APPARATUS;
    carveCollectorPath(world, spec, [saddle, c], 1, false, draft);
  }
}

function decorateCollectorRepairCrossing(world: World, point: { x: number; y: number }, spec: ProceduralFloorSpec): void {
  const ci = world.idx(point.x, point.y);
  if (world.cells[ci] !== Cell.FLOOR || world.features[ci] !== Feature.NONE) return;
  world.features[ci] = Feature.APPARATUS;
  stampSurfaceSplat(world, point.x, point.y, 0.5, 0.5, 0.48, 0.58, spec.seed ^ 0xc011ec, 126, 116, 86, false);
}

function applyWaterAndMachines(world: World, rooms: Room[], spec: ProceduralFloorSpec, spawnX: number, spawnY: number): void {
  if (spec.geometryId !== 'collectors') return;
  const draft = newCollectorMetricsDraft();
  const field = buildCollectorProxyField(spec);
  const saddlePoints = chooseCollectorSaddlePoints(field);
  const sx = Math.floor(spawnX);
  const sy = Math.floor(spawnY);
  const target = chooseCollectorRouteTarget(world, rooms, sx, sy);
  const basinPoints = field.basinCenters.map(collectorBasinWorldPoint);

  for (let idx = 0; idx < field.wet.length; idx++) {
    if (field.wet[idx]) carveCollectorWetPatch(world, spec, field, idx, draft);
  }

  const wetStart = basinPoints.reduce((best, point) =>
    world.dist2(sx, sy, point.x, point.y) < world.dist2(sx, sy, best.x, best.y) ? point : best,
  basinPoints[0] ?? { x: sx, y: sy });
  const wetEnd = basinPoints.reduce((best, point) =>
    world.dist2(target.x, target.y, point.x, point.y) < world.dist2(target.x, target.y, best.x, best.y) ? point : best,
  basinPoints[basinPoints.length - 1] ?? target);
  draft.wetRouteLength += carveCollectorPath(world, spec, [wetStart, wetEnd], 2, true, draft);

  const firstSaddle = saddlePoints[0] ?? { x: world.wrap(sx + 160), y: world.wrap(sy + 96) };
  const secondSaddle = saddlePoints[1] ?? { x: world.wrap(target.x - 128), y: world.wrap(target.y + 144) };
  draft.dryRouteLength += carveCollectorPath(world, spec, [{ x: sx, y: sy }, firstSaddle, secondSaddle, target], 2, false, draft);
  for (let i = 1; i < saddlePoints.length; i++) {
    draft.dryRouteLength += carveCollectorPath(world, spec, [saddlePoints[i - 1], saddlePoints[i]], 1, false, draft);
  }

  const repairIndex = basinPoints.length > 0
    ? ((spec.seed + spec.ordinal) % basinPoints.length + basinPoints.length) % basinPoints.length
    : -1;
  const repairCenter = repairIndex >= 0 ? basinPoints[repairIndex] : wetEnd;
  const repairA = { x: world.wrap(repairCenter.x - 30), y: world.wrap(repairCenter.y + 8) };
  const repairB = { x: world.wrap(repairCenter.x + 30), y: world.wrap(repairCenter.y - 8) };
  draft.dryRouteLength += carveCollectorPath(world, spec, [repairA, repairB], 1, false, draft, true);
  decorateCollectorRepairCrossing(world, repairCenter, spec);

  markCollectorValveRooms(world, rooms, spec, saddlePoints, draft);
  collectorDraftMetricsByWorld.set(world, draft);
}

function workshopFactoryForIndex(index: number): FactoryDef {
  const id = WORKSHOP_FACTORY_IDS[((index % WORKSHOP_FACTORY_IDS.length) + WORKSHOP_FACTORY_IDS.length) % WORKSHOP_FACTORY_IDS.length];
  const factory = FACTORY_BY_ID[id] ?? FACTORY_BY_ID.metal_shop;
  if (!factory) throw new Error(`missing workshop factory ${id}`);
  return factory;
}

function workshopPrimaryRecipe(factory: FactoryDef): FactoryRecipeDef | null {
  return factory.recipes[0] ?? null;
}

function workshopFactoryRoomName(factory: FactoryDef, room: Room): string {
  if (factory.id === 'illegal_ammo_smelter') return `Плавильня гильз ${room.id}: док выдачи`;
  if (factory.id === 'armory_bench') return `Оружейная мастерская ${room.id}: верстак смены`;
  if (factory.id === 'utility_room') return `Технический склад ${room.id}: ремонтная линия`;
  return `Цех металла ${room.id}: станочная линия`;
}

function decorateWorkshopMachineLine(world: World, room: Room, factory: FactoryDef, seed: number): void {
  room.name = workshopFactoryRoomName(factory, room);
  room.wallTex = Tex.METAL;
  room.floorTex = Tex.F_CONCRETE;
  const horizontal = room.w >= room.h;
  const along = Math.max(1, horizontal ? room.w - 2 : room.h - 2);
  const cross = Math.max(1, horizontal ? room.h - 2 : room.w - 2);
  const lane = 1 + (seed % cross);
  for (let step = 1; step <= along; step++) {
    if (step % 3 === 0) continue;
    const dx = horizontal ? step : lane;
    const dy = horizontal ? lane : step;
    const ci = world.idx(room.x + dx, room.y + dy);
    if (world.cells[ci] !== Cell.FLOOR || world.roomMap[ci] !== room.id) continue;
    world.floorTex[ci] = Tex.F_CONCRETE;
    if (world.features[ci] === Feature.NONE || world.features[ci] === Feature.TABLE || world.features[ci] === Feature.SHELF) {
      world.features[ci] = step % 5 === 0 ? Feature.APPARATUS : Feature.MACHINE;
    }
  }
  const center = roomCenter(room);
  stampSurfaceSplat(world, center.x, center.y, 0.5, 0.5, 0.34, 0.48, seed ^ (room.id * 101), 86, 82, 70, false);
}

function carveWorkshopRun(
  world: World,
  spec: ProceduralFloorSpec,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  horizontal: boolean,
  stepBase: number,
): number {
  const delta = horizontal ? world.delta(ax, bx) : world.delta(ay, by);
  const stepDir = delta >= 0 ? 1 : -1;
  const steps = Math.abs(delta);
  let x = world.wrap(ax);
  let y = world.wrap(ay);

  for (let s = 0; s <= steps; s++) {
    const step = stepBase + s;
    if (forceProceduralFloor(world, x, y, -1, Tex.F_CONCRETE)) {
      const ci = world.idx(x, y);
      world.wallTex[ci] = Tex.METAL;
      if (world.features[ci] === Feature.NONE && step % 17 === 0) {
        world.features[ci] = step % 34 === 0 ? Feature.SHELF : Feature.LAMP;
      }
      if (step % 31 === 0) {
        stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.18, 0.34, spec.seed + step * 47, 118, 108, 86, false);
      }
    }
    if (s < steps) {
      if (horizontal) x = world.wrap(x + stepDir);
      else y = world.wrap(y + stepDir);
    }
  }
  return stepBase + steps + 1;
}

function carveWorkshopL(world: World, spec: ProceduralFloorSpec, ax: number, ay: number, bx: number, by: number, seed: number): void {
  const horizontalFirst = (seed & 1) === 0;
  if (horizontalFirst) {
    const next = carveWorkshopRun(world, spec, ax, ay, bx, ay, true, seed);
    carveWorkshopRun(world, spec, bx, ay, bx, by, false, next);
  } else {
    const next = carveWorkshopRun(world, spec, ax, ay, ax, by, false, seed);
    carveWorkshopRun(world, spec, ax, by, bx, by, true, next);
  }
}

function carveWorkshopDockLoop(world: World, room: Room, spec: ProceduralFloorSpec, index: number): boolean {
  const margin = 4 + (index % 2);
  const left = room.x - margin;
  const right = room.x + room.w + margin;
  const top = room.y - margin;
  const bottom = room.y + room.h + margin;
  let step = index * 1501 + 41;
  step = carveWorkshopRun(world, spec, left, top, right, top, true, step);
  step = carveWorkshopRun(world, spec, right, top, right, bottom, false, step);
  step = carveWorkshopRun(world, spec, right, bottom, left, bottom, true, step);
  carveWorkshopRun(world, spec, left, bottom, left, top, false, step);

  const center = roomCenter(room);
  carveCorridor(world, center.x, center.y, world.wrap(left), world.wrap(top + Math.floor((bottom - top) / 2)));
  carveCorridor(world, center.x, center.y, world.wrap(right), world.wrap(bottom - Math.floor((bottom - top) / 2)));
  room.name = `${room.name}: доковая петля`;
  return true;
}

function connectWorkshopFactoryChain(world: World, rooms: readonly Room[], spec: ProceduralFloorSpec, chain: number): boolean {
  if (rooms.length < 2) return false;
  for (let i = 0; i < rooms.length - 1; i++) {
    const a = roomCenter(rooms[i]);
    const b = roomCenter(rooms[i + 1]);
    carveWorkshopL(world, spec, a.x, a.y, b.x, b.y, spec.seed + chain * 1009 + i * 131);
  }
  if (rooms.length >= 3) {
    const a = roomCenter(rooms[rooms.length - 1]);
    const b = roomCenter(rooms[0]);
    carveWorkshopL(world, spec, a.x, a.y, b.x, b.y, spec.seed ^ (chain * 173 + 0x4100));
  }
  return true;
}

function decorateWorkshopToolRoom(world: World, room: Room, index: number): void {
  room.name = `Инструментальная хорда ${room.id}: ремонтный склад`;
  room.floorTex = Tex.F_CONCRETE;
  room.wallTex = Tex.METAL;
  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      if (dx % 3 !== 1 && dy % 3 !== 1) continue;
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.cells[ci] !== Cell.FLOOR || world.roomMap[ci] !== room.id) continue;
      world.floorTex[ci] = Tex.F_CONCRETE;
      if (world.features[ci] === Feature.NONE || world.features[ci] === Feature.TABLE) {
        world.features[ci] = (dx + dy + index) % 4 === 0 ? Feature.APPARATUS : Feature.SHELF;
      }
    }
  }
}

function connectWorkshopToolChord(world: World, tool: Room, a: Room, b: Room, spec: ProceduralFloorSpec, index: number): void {
  decorateWorkshopToolRoom(world, tool, index);
  const tc = roomCenter(tool);
  const ac = roomCenter(a);
  carveWorkshopL(world, spec, tc.x, tc.y, ac.x, ac.y, spec.seed + index * 557);
  if (a.id !== b.id) {
    const bc = roomCenter(b);
    carveWorkshopL(world, spec, tc.x, tc.y, bc.x, bc.y, spec.seed ^ (index * 811 + 0x7d00));
  }
}

function applyWorkshops(world: World, rooms: Room[], spec: ProceduralFloorSpec, spawnX: number, spawnY: number): WorkshopNetwork | null {
  if (spec.geometryId !== 'workshops') return null;
  const production = rooms
    .filter(room => room.type === RoomType.PRODUCTION && room.id !== 0 && room.w >= 6 && room.h >= 5)
    .sort((a, b) => {
      const ac = roomCenter(a);
      const bc = roomCenter(b);
      const ad = world.dist2(spawnX, spawnY, ac.x, ac.y);
      const bd = world.dist2(spawnX, spawnY, bc.x, bc.y);
      return bd - ad;
    });
  const factoryRooms = production.slice(0, Math.min(production.length, 8 + spec.danger * 2));
  for (let i = 0; i < factoryRooms.length; i++) {
    decorateWorkshopMachineLine(world, factoryRooms[i], workshopFactoryForIndex(i), spec.seed + i * 233);
  }

  const loopRooms: Room[] = [];
  let dockLoopCount = 0;
  const loopRoomLimit = Math.min(factoryRooms.length, 6);
  for (let i = 0; i < loopRoomLimit; i++) loopRooms.push(factoryRooms[i]);
  for (let chain = 0; chain < Math.min(2, Math.ceil(loopRooms.length / 3)); chain++) {
    connectWorkshopFactoryChain(world, loopRooms.slice(chain * 3, chain * 3 + 3), spec, chain);
  }
  for (let i = 0; i < Math.min(2, factoryRooms.length); i++) {
    if (carveWorkshopDockLoop(world, factoryRooms[i], spec, i)) dockLoopCount++;
  }

  const toolCandidates = rooms
    .filter(room => room.id !== 0 && (room.type === RoomType.STORAGE || room.type === RoomType.OFFICE) && room.w >= 4 && room.h >= 4)
    .sort((a, b) => (b.w * b.h) - (a.w * a.h));
  const toolRooms: Room[] = [];
  let toolChordCount = 0;
  const toolTarget = Math.min(toolCandidates.length, Math.max(1, Math.min(3, Math.floor(factoryRooms.length / 3))));
  for (let i = 0; i < toolTarget && factoryRooms.length > 0; i++) {
    const tool = toolCandidates[i];
    const a = factoryRooms[i % factoryRooms.length];
    const b = factoryRooms[(i * 2 + 1) % factoryRooms.length] ?? a;
    if (!tool || !a) continue;
    connectWorkshopToolChord(world, tool, a, b, spec, i);
    toolRooms.push(tool);
    toolChordCount++;
  }

  return { loopRooms, toolRooms, factoryRooms, dockLoopCount, toolChordCount };
}

function collectWorkshopDecisionCandidates(world: World, rooms: Room[], reachable: Uint8Array): number[] {
  const roomIds = new Set<number>();
  for (const room of rooms) {
    if (
      room.type === RoomType.PRODUCTION ||
      room.type === RoomType.STORAGE ||
      room.type === RoomType.CORRIDOR ||
      room.name.startsWith('Инструментальная хорда')
    ) roomIds.add(room.id);
  }
  const candidates: number[] = [];
  for (let i = 0; i < world.cells.length; i++) {
    if (!reachable[i] || world.aptMask[i]) continue;
    const roomId = world.roomMap[i];
    if (roomId < 0 || !roomIds.has(roomId)) continue;
    if (world.cells[i] !== Cell.FLOOR && world.cells[i] !== Cell.DOOR && world.cells[i] !== Cell.WATER) continue;
    candidates.push(i);
  }
  return candidates;
}

function collectWorkshopExitTargets(world: World, reachable: Uint8Array): number[] {
  const targets: number[] = [];
  for (let i = 0; i < world.cells.length; i++) {
    if (!reachable[i]) continue;
    if (world.features[i] === Feature.LIFT_BUTTON || world.cells[i] === Cell.LIFT) targets.push(i);
  }
  return targets;
}

function roomAtDecisionCell(world: World, cell: number, fallback: Room | undefined): Room | null {
  const roomId = world.roomMap[cell];
  if (roomId >= 0 && world.rooms[roomId]) return world.rooms[roomId];
  return fallback ?? null;
}

function markWorkshopFactoryContainer(
  container: WorldContainer | null,
  factory: FactoryDef,
  recipe: FactoryRecipeDef,
  tags: readonly string[],
): void {
  if (!container) return;
  container.factoryId = factory.id;
  container.tags = uniqueTags([
    ...container.tags,
    factory.id,
    recipe.id,
    ...productionRouteGoalTags(factory, recipe),
    ...productionRewardTargetTags(factory, recipe),
    ...tags,
  ]);
}

function placeWorkshopDecisionTriangle(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  reachable: Uint8Array,
  spawnX: number,
  spawnY: number,
): void {
  if (spec.geometryId !== 'workshops') return;
  const candidates = collectWorkshopDecisionCandidates(world, rooms, reachable);
  if (candidates.length < 3) return;
  const focusRoom = rooms.find(room => room.name.includes('доковая петля')) ??
    rooms.find(room => room.type === RoomType.PRODUCTION);
  if (!focusRoom) return;
  const focus = roomCenter(focusRoom);
  const placement = placeDecisionTriangle(world, {
    candidates,
    poi: { x: focus.x + 0.5, y: focus.y + 0.5 },
    seed: spec.seed ^ 0x410041,
    sampleCount: 240,
    minSeparation: 10,
    escapeReachable: reachable,
    exitTargets: collectWorkshopExitTargets(world, reachable),
    spawn: { at: { x: spawnX, y: spawnY }, radius: 32, penalty: 8 },
    roles: {
      risk: {
        baseScore: 2,
        roomWeights: { [RoomType.PRODUCTION]: 5, [RoomType.CORRIDOR]: 2 },
        distanceBand: { min: 7, max: 32, ideal: 14, score: 5, outsidePenalty: 5 },
      },
      reward: {
        baseScore: 3,
        roomWeights: { [RoomType.STORAGE]: 5, [RoomType.PRODUCTION]: 3 },
        distanceBand: { min: 5, max: 28, ideal: 12, score: 5, outsidePenalty: 4 },
      },
      escape: {
        baseScore: 2,
        roomWeights: { [RoomType.CORRIDOR]: 5, [RoomType.STORAGE]: 2 },
        distanceBand: { min: 14, max: 56, ideal: 30, score: 5, outsidePenalty: 4 },
        exitWeight: 4,
      },
    },
  });
  if (!placement) return;

  const factory = workshopFactoryForIndex(spec.seed);
  const recipe = workshopPrimaryRecipe(factory);
  if (!recipe) return;
  const riskRoom = roomAtDecisionCell(world, placement.risk.cell, focusRoom);
  const rewardRoom = roomAtDecisionCell(world, placement.reward.cell, focusRoom);
  const escapeRoom = roomAtDecisionCell(world, placement.escape.cell, focusRoom);
  const riskPos = { x: placement.risk.cell % W, y: (placement.risk.cell / W) | 0 };
  const rewardPos = { x: placement.reward.cell % W, y: (placement.reward.cell / W) | 0 };
  const escapePos = { x: placement.escape.cell % W, y: (placement.escape.cell / W) | 0 };

  world.features[placement.risk.cell] = Feature.APPARATUS;
  world.features[placement.escape.cell] = Feature.LAMP;
  stampSurfaceSplat(world, riskPos.x, riskPos.y, 0.5, 0.5, 0.36, 0.62, spec.seed ^ 0x41aa, 144, 46, 36, false);
  stampSurfaceSplat(world, escapePos.x, escapePos.y, 0.5, 0.5, 0.24, 0.5, spec.seed ^ 0x41ee, 208, 190, 120, false);

  if (riskRoom) {
    markWorkshopFactoryContainer(
      addProceduralLootContainer(
        world,
        spec,
        riskRoom,
        riskPos,
        ContainerKind.SECRET_STASH,
        [
          { defId: 'fuse', count: 1 },
          { defId: 'wire_coil', count: 1 },
        ],
        ['workshop_decision', 'decision_risk', 'sabotage', 'factory_sabotage'],
        `Саботажный щиток: ${factory.name}`,
      ),
      factory,
      recipe,
      ['sabotage'],
    );
  }
  if (rewardRoom) {
    markWorkshopFactoryContainer(
      addProceduralLootContainer(
        world,
        spec,
        rewardRoom,
        rewardPos,
        ContainerKind.METAL_CABINET,
        recipe.outputs.map(item => ({ ...item })),
        ['workshop_decision', 'decision_reward', 'steal_output', 'factory_output'],
        `Выдача цеха: ${recipe.name}`,
      ),
      factory,
      recipe,
      ['steal_output'],
    );
  }
  if (escapeRoom) {
    markWorkshopFactoryContainer(
      addProceduralLootContainer(
        world,
        spec,
        escapeRoom,
        escapePos,
        ContainerKind.TOOL_LOCKER,
        [
          { defId: 'gear', count: 2 },
          { defId: 'electrode_pack', count: 1 },
          { defId: 'sealant_tube', count: 1 },
        ],
        ['workshop_decision', 'decision_escape', 'repair_line', 'tool_room_chord'],
        'Ремонтная тележка у отхода',
      ),
      factory,
      recipe,
      ['repair_line'],
    );
  }
}

function roofDuctFeature(step: number, line: number): Feature {
  const mode = (step + line * 5) % 5;
  if (mode === 0) return Feature.LAMP;
  if (mode === 1) return Feature.SCREEN;
  if (mode === 2) return Feature.APPARATUS;
  if (mode === 3) return Feature.MACHINE;
  return Feature.SHELF;
}

function carveRoofDuctCell(world: World, x: number, y: number): boolean {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT || world.hermoWall[ci] || world.aptMask[ci]) return false;
  world.cells[ci] = Cell.FLOOR;
  world.floorTex[ci] = Tex.F_CONCRETE;
  world.wallTex[ci] = Tex.PIPE;
  world.features[ci] = Feature.NONE;
  world.roomMap[ci] = -1;
  world.fog[ci] = Math.max(world.fog[ci], 8);
  return true;
}

function decorateRoofDuctEdge(world: World, x: number, y: number, feature: Feature, spec: ProceduralFloorSpec, step: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR || world.features[ci] !== Feature.NONE) return;
  world.features[ci] = feature;
  stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.24, 0.46, spec.seed ^ (step * 41), 88, 100, 104, false);
}

function atticHash01(seed: number, a: number, b: number, c = 0): number {
  let x = (seed ^ Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0xc2b2ae35, 0x27d4eb2d) ^ Math.imul(c + 0x165667b1, 0x9e3779b1)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function atticProxyCoord(value: number): number {
  const v = Math.floor(value / ATTIC_PROXY_CELL);
  return Math.max(0, Math.min(ATTIC_PROXY_SIZE - 1, v));
}

function atticProxyIndex(px: number, py: number): number {
  const x = ((px % ATTIC_PROXY_SIZE) + ATTIC_PROXY_SIZE) % ATTIC_PROXY_SIZE;
  const y = ((py % ATTIC_PROXY_SIZE) + ATTIC_PROXY_SIZE) % ATTIC_PROXY_SIZE;
  return y * ATTIC_PROXY_SIZE + x;
}

function buildAtticTensorField(spec: ProceduralFloorSpec): AtticTensorField {
  const n = ATTIC_PROXY_SIZE * ATTIC_PROXY_SIZE;
  const cos = new Float32Array(n);
  const sin = new Float32Array(n);
  const seedPhase = (spec.seed & 8191) / 8192;
  const baseAngle = (((spec.seed >>> 3) & 3) * Math.PI) / 4;

  for (let py = 0; py < ATTIC_PROXY_SIZE; py++) {
    for (let px = 0; px < ATTIC_PROXY_SIZE; px++) {
      const ductWave = Math.sin((px + seedPhase * 97) * 0.17) * 0.42;
      const cableWave = Math.cos((py - seedPhase * 131) * 0.13) * 0.34;
      const shear = (atticHash01(spec.seed, px >> 2, py >> 2, 38) - 0.5) * 0.48;
      const angle = baseAngle + ductWave + cableWave + shear;
      const idx = atticProxyIndex(px, py);
      cos[idx] = Math.cos(angle);
      sin[idx] = Math.sin(angle);
    }
  }

  return { cos, sin };
}

function atticTensorDrift(field: AtticTensorField, worldX: number, worldY: number, horizontal: boolean): number {
  const idx = atticProxyIndex(atticProxyCoord(worldX), atticProxyCoord(worldY));
  const v = horizontal ? field.sin[idx] : field.cos[idx];
  if (v > 0.36) return 1;
  if (v < -0.36) return -1;
  return 0;
}

function clampAtticCoord(value: number): number {
  return Math.max(ATTIC_SPINE_START, Math.min(ATTIC_SPINE_END, Math.floor(value)));
}

function collectRoofDuctBand(world: World, x: number, y: number, horizontal: boolean, cells?: number[]): void {
  for (let side = 0; side <= 1; side++) {
    const cx = horizontal ? x : x + side;
    const cy = horizontal ? y + side : y;
    if (carveRoofDuctCell(world, cx, cy)) cells?.push(world.idx(cx, cy));
  }
}

function carveRoofDuctSegment(
  world: World,
  spec: ProceduralFloorSpec,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  horizontal: boolean,
  line: number,
  stepBase: number,
  cells?: number[],
): number {
  const delta = horizontal ? world.delta(ax, bx) : world.delta(ay, by);
  const stepDir = delta >= 0 ? 1 : -1;
  const steps = Math.abs(delta);
  let x = world.wrap(ax);
  let y = world.wrap(ay);

  for (let s = 0; s <= steps; s++) {
    collectRoofDuctBand(world, x, y, horizontal, cells);

    const absoluteStep = stepBase + s;
    if (absoluteStep % 23 === 0) {
      const side = ((absoluteStep / 23 + line) & 1) === 0 ? -1 : 2;
      const fx = horizontal ? x : x + side;
      const fy = horizontal ? y + side : y;
      decorateRoofDuctEdge(world, fx, fy, roofDuctFeature(absoluteStep, line), spec, absoluteStep);
    }
    if (absoluteStep % 43 === 0) {
      stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.18, 0.34, spec.seed + absoluteStep * 59 + line * 7, 210, 220, 218, true);
    }

    if (s < steps) {
      if (horizontal) x = world.wrap(x + stepDir);
      else y = world.wrap(y + stepDir);
    }
  }

  return stepBase + steps + 1;
}

function traceAtticTensorSpine(
  world: World,
  spec: ProceduralFloorSpec,
  field: AtticTensorField,
  line: number,
  horizontal: boolean,
  lane: number,
): AtticTrace {
  const cells: number[] = [];
  let driftCoord = clampAtticCoord(lane);
  let step = line * 557;

  for (let p = ATTIC_SPINE_START; p <= ATTIC_SPINE_END; p++) {
    if ((p - ATTIC_SPINE_START) % ATTIC_PROXY_CELL === 0) {
      const drift = atticTensorDrift(field, horizontal ? p : driftCoord, horizontal ? driftCoord : p, horizontal);
      const jitter = atticHash01(spec.seed, line, p >> 4, horizontal ? 137 : 139) > 0.78 ? (line % 2 === 0 ? 1 : -1) : 0;
      driftCoord = clampAtticCoord(driftCoord + drift + jitter);
    }

    const x = horizontal ? p : driftCoord;
    const y = horizontal ? driftCoord : p;
    collectRoofDuctBand(world, x, y, horizontal, cells);

    if (step % 29 === 0) {
      const side = ((step / 29 + line) & 1) === 0 ? -1 : 2;
      const fx = horizontal ? x : x + side;
      const fy = horizontal ? y + side : y;
      decorateRoofDuctEdge(world, fx, fy, roofDuctFeature(step, line), spec, step);
    }
    if (step % 53 === 0) {
      stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.16, 0.32, spec.seed ^ (step * 83 + line * 19), 198, 218, 215, true);
    }
    step++;
  }

  return { id: line, horizontal, cells };
}

function atticLaneDistance(a: number, b: number): number {
  return Math.abs(a - b);
}

function pushAtticLane(lanes: number[], lane: number, minSpacing: number): void {
  const clamped = clampAtticCoord(lane);
  if (lanes.some(existing => atticLaneDistance(existing, clamped) < minSpacing)) return;
  lanes.push(clamped);
}

function selectAtticLanes(seed: number, primary: number, anchors: readonly Room[], horizontal: boolean, count: number): number[] {
  const lanes: number[] = [];
  pushAtticLane(lanes, primary, 88);
  for (const room of anchors) {
    const c = roomCenter(room);
    pushAtticLane(lanes, horizontal ? c.y : c.x, 88);
    if (lanes.length >= count) break;
  }
  for (let i = 0; lanes.length < count && i < count * 8; i++) {
    const lane = ATTIC_SPINE_START + Math.floor(atticHash01(seed, i, count, horizontal ? 141 : 143) * (ATTIC_SPINE_END - ATTIC_SPINE_START));
    pushAtticLane(lanes, lane, 88);
  }
  return lanes;
}

function nearestAtticTraceBridge(world: World, a: AtticTrace, b: AtticTrace): { a: number; b: number; d2: number } | null {
  let bestA = -1;
  let bestB = -1;
  let bestD2 = Infinity;
  const stepA = Math.max(1, Math.floor(a.cells.length / 144));
  const stepB = Math.max(1, Math.floor(b.cells.length / 144));

  for (let ai = 0; ai < a.cells.length; ai += stepA) {
    const ac = a.cells[ai];
    const ax = ac % W;
    const ay = (ac / W) | 0;
    for (let bi = 0; bi < b.cells.length; bi += stepB) {
      const bc = b.cells[bi];
      const d2 = world.dist2(ax + 0.5, ay + 0.5, (bc % W) + 0.5, ((bc / W) | 0) + 0.5);
      if (d2 < bestD2) {
        bestD2 = d2;
        bestA = ac;
        bestB = bc;
      }
    }
  }

  return bestA >= 0 && bestB >= 0 ? { a: bestA, b: bestB, d2: bestD2 } : null;
}

function bridgeAtticTraces(
  world: World,
  spec: ProceduralFloorSpec,
  a: AtticTrace,
  b: AtticTrace,
  line: number,
  junctions: AtticJunction[],
): void {
  const bridge = nearestAtticTraceBridge(world, a, b);
  if (!bridge) return;

  const ax = bridge.a % W;
  const ay = (bridge.a / W) | 0;
  const bx = bridge.b % W;
  const by = (bridge.b / W) | 0;
  let step = line * 1709;
  const horizontalFirst = ((spec.seed + a.id * 31 + b.id * 37 + line) & 1) === 0;
  if (horizontalFirst) {
    step = carveRoofDuctSegment(world, spec, ax, ay, bx, ay, true, line, step, a.cells);
    carveRoofDuctSegment(world, spec, bx, ay, bx, by, false, line, step, b.cells);
  } else {
    step = carveRoofDuctSegment(world, spec, ax, ay, ax, by, false, line, step, a.cells);
    carveRoofDuctSegment(world, spec, ax, by, bx, by, true, line, step, b.cells);
  }

  const score = 12_000 - Math.min(10_000, bridge.d2);
  junctions.push({ x: ax, y: ay, score });
  junctions.push({ x: bx, y: by, score: score * 0.9 });
}

function decorateAtticPocketRoom(world: World, room: Room, seed: number): void {
  room.wallTex = Tex.PIPE;
  room.floorTex = Tex.F_CONCRETE;
  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      if ((dx + dy + seed) % 3 !== 0) continue;
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.cells[ci] !== Cell.FLOOR || world.roomMap[ci] !== room.id) continue;
      world.floorTex[ci] = Tex.F_CONCRETE;
      world.features[ci] = (dx + dy + seed) % 5 === 0 ? Feature.APPARATUS : Feature.SHELF;
    }
  }
  const c = roomCenter(room);
  stampSurfaceSplat(world, c.x, c.y, 0.5, 0.5, 0.3, 0.42, seed ^ (room.id * 97), 84, 100, 100, false);
}

function tryPlaceAtticServicePocket(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  junction: AtticJunction,
  index: number,
): Room | null {
  const w = 5 + ((spec.seed + index) % 3);
  const h = 4 + ((spec.seed >> (index % 7)) % 3);
  const offsets = [
    { x: junction.x + 4, y: junction.y - Math.floor(h / 2) },
    { x: junction.x - w - 4, y: junction.y - Math.floor(h / 2) },
    { x: junction.x - Math.floor(w / 2), y: junction.y + 4 },
    { x: junction.x - Math.floor(w / 2), y: junction.y - h - 4 },
  ];

  for (const offset of offsets) {
    const x = world.wrap(offset.x);
    const y = world.wrap(offset.y);
    if (!canPlaceRoom(world, x, y, w, h)) continue;
    const room = stampRoom(world, world.rooms.length, index % 2 === 0 ? RoomType.STORAGE : RoomType.PRODUCTION, x, y, w, h, -1);
    room.name = index % 2 === 0
      ? `Чердачный карман документов ${room.id}`
      : `Чердачный ремонтный карман ${room.id}`;
    applyRoomTexture(world, room, Tex.PIPE, Tex.F_CONCRETE);
    decorateAtticPocketRoom(world, room, spec.seed + index * 173);
    const exit = roomExit(world, room, junction.x, junction.y);
    placeDoorAt(world, exit.wx, exit.wy, room.id);
    const horizontalFirst = ((spec.seed + index * 17) & 1) === 0;
    if (horizontalFirst) {
      const step = carveRoofDuctSegment(world, spec, exit.ox, exit.oy, junction.x, exit.oy, true, index + 31, index * 211);
      carveRoofDuctSegment(world, spec, junction.x, exit.oy, junction.x, junction.y, false, index + 31, step);
    } else {
      const step = carveRoofDuctSegment(world, spec, exit.ox, exit.oy, exit.ox, junction.y, false, index + 31, index * 211);
      carveRoofDuctSegment(world, spec, exit.ox, junction.y, junction.x, junction.y, true, index + 31, step);
    }
    rooms.push(room);
    return room;
  }

  return null;
}

function placeAtticServicePockets(world: World, rooms: Room[], spec: ProceduralFloorSpec, junctions: readonly AtticJunction[]): void {
  const sorted = [...junctions].sort((a, b) => b.score - a.score);
  const target = Math.min(sorted.length, 2 + Math.floor(spec.danger / 2));
  let placed = 0;
  for (const junction of sorted) {
    if (placed >= target) break;
    if (tryPlaceAtticServicePocket(world, rooms, spec, junction, placed)) placed++;
  }
}

interface AtticClusterAnchor {
  x: number;
  y: number;
  score: number;
}

interface AtticSupportPlan {
  type: RoomType;
  name: string;
  w: number;
  h: number;
}

function clampAtticRoomOrigin(x: number, y: number, w: number, h: number): { x: number; y: number } {
  return {
    x: Math.max(10, Math.min(W - w - 11, Math.floor(x))),
    y: Math.max(10, Math.min(W - h - 11, Math.floor(y))),
  };
}

function decorateAtticSupportRoom(world: World, room: Room, spec: ProceduralFloorSpec, serial: number): void {
  applyRoomTexture(world, room, Tex.PIPE, Tex.F_CONCRETE);
  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.cells[ci] !== Cell.FLOOR || world.roomMap[ci] !== room.id) continue;
      if (room.type === RoomType.BATHROOM) {
        if (dx === 1 && dy === 1) world.features[ci] = Feature.TOILET;
        else if (dx === room.w - 2 && dy === 1) world.features[ci] = Feature.SINK;
      } else if (room.type === RoomType.KITCHEN) {
        if (dx === 1 && dy === 1) world.features[ci] = Feature.STOVE;
        else if (dx === room.w - 2 && dy === 1) world.features[ci] = Feature.SINK;
        else if ((dx + dy + serial) % 5 === 0) world.features[ci] = Feature.TABLE;
      } else if (room.type === RoomType.PRODUCTION) {
        if ((dx + dy + serial) % 3 === 0) world.features[ci] = Feature.MACHINE;
        else if ((dx * 3 + dy + serial) % 7 === 0) world.features[ci] = Feature.APPARATUS;
      } else if (room.type === RoomType.OFFICE) {
        if ((dx + dy + serial) % 4 === 0) world.features[ci] = Feature.DESK;
        else if ((dx * 5 + dy + serial) % 9 === 0) world.features[ci] = Feature.SCREEN;
      } else if (room.type === RoomType.COMMON) {
        if ((dx + dy + serial) % 4 === 0) world.features[ci] = Feature.TABLE;
        else if ((dx * 7 + dy + serial) % 11 === 0) world.features[ci] = Feature.CHAIR;
      } else if ((dx + dy + serial) % 3 === 0) {
        world.features[ci] = Feature.SHELF;
      }
    }
  }
  const c = roomCenter(room);
  stampSurfaceSplat(world, c.x, c.y, 0.5, 0.5, 0.22, 0.36, spec.seed ^ (room.id * 193 + serial * 17), 104, 130, 128, false);
}

function canPlaceAtticSupportRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.aptMask[ci] || world.hermoWall[ci] || world.doors.has(ci) || world.containerMap.has(ci)) return false;
      if (world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.ABYSS || world.cells[ci] === Cell.WATER) return false;
      if (world.roomMap[ci] >= 0) return false;
      if (world.cells[ci] !== Cell.WALL && world.cells[ci] !== Cell.FLOOR) return false;
    }
  }
  return true;
}

function stampAtticSupportRoom(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  serial: number,
): Room | null {
  const origin = clampAtticRoomOrigin(x, y, w, h);
  if (!canPlaceRoom(world, origin.x, origin.y, w, h) && !canPlaceAtticSupportRoom(world, origin.x, origin.y, w, h)) return null;
  const room = stampRoom(world, world.rooms.length, type, origin.x, origin.y, w, h, -1);
  room.name = `${name} ${room.id}`;
  decorateAtticSupportRoom(world, room, spec, serial);
  rooms.push(room);
  return room;
}

function connectAtticRoomToPoint(world: World, spec: ProceduralFloorSpec, room: Room, x: number, y: number, serial: number): void {
  const exit = roomExit(world, room, x, y);
  placeDoorAt(world, exit.wx, exit.wy, room.id);
  const horizontalFirst = ((spec.seed + room.id * 31 + serial * 17) & 1) === 0;
  if (horizontalFirst) {
    const step = carveRoofDuctSegment(world, spec, exit.ox, exit.oy, x, exit.oy, true, serial + 71, serial * 503);
    carveRoofDuctSegment(world, spec, x, exit.oy, x, y, false, serial + 71, step);
  } else {
    const step = carveRoofDuctSegment(world, spec, exit.ox, exit.oy, exit.ox, y, false, serial + 71, serial * 503);
    carveRoofDuctSegment(world, spec, exit.ox, y, x, y, true, serial + 71, step);
  }
}

function pushAtticClusterAnchor(anchors: AtticClusterAnchor[], seen: Set<string>, x: number, y: number, score: number): void {
  const cx = Math.floor(x / 56);
  const cy = Math.floor(y / 56);
  const key = `${cx}:${cy}`;
  if (seen.has(key)) return;
  for (const anchor of anchors) {
    const dx = x - anchor.x;
    const dy = y - anchor.y;
    if (dx * dx + dy * dy < ATTIC_CLUSTER_MIN_SPACING) return;
  }
  seen.add(key);
  anchors.push({ x: Math.max(12, Math.min(W - 13, Math.floor(x))), y: Math.max(12, Math.min(W - 13, Math.floor(y))), score });
}

function collectAtticClusterAnchors(
  spec: ProceduralFloorSpec,
  traces: readonly AtticTrace[],
  junctions: readonly AtticJunction[],
  targets: readonly Room[],
): AtticClusterAnchor[] {
  const anchors: AtticClusterAnchor[] = [];
  const seen = new Set<string>();
  for (const junction of junctions) pushAtticClusterAnchor(anchors, seen, junction.x, junction.y, 20_000 + junction.score);
  for (const room of targets) {
    const c = roomCenter(room);
    pushAtticClusterAnchor(anchors, seen, c.x, c.y, 12_000 + room.w * room.h);
  }
  for (const trace of traces) {
    const step = Math.max(48, Math.floor(trace.cells.length / 10));
    for (let i = (spec.seed + trace.id * 23) % step; i < trace.cells.length; i += step) {
      const ci = trace.cells[i];
      pushAtticClusterAnchor(anchors, seen, ci % W, (ci / W) | 0, 8_000 - i + trace.cells.length);
    }
  }
  for (let i = 0; i < 36; i++) {
    const x = 48 + Math.floor(atticHash01(spec.seed, i, 0, 0x7711) * (W - 96));
    const y = 48 + Math.floor(atticHash01(spec.seed, i, 1, 0x7722) * (W - 96));
    pushAtticClusterAnchor(anchors, seen, x, y, 3_000 - i);
  }
  return anchors.sort((a, b) => b.score - a.score);
}

const ATTIC_SUPPORT_PLANS: readonly AtticSupportPlan[] = [
  { type: RoomType.STORAGE, name: 'Чердачная фильтровая кладовая', w: 5, h: 5 },
  { type: RoomType.PRODUCTION, name: 'Чердачная моторная будка', w: 7, h: 5 },
  { type: RoomType.COMMON, name: 'Чердачный дежурный закуток', w: 6, h: 5 },
  { type: RoomType.BATHROOM, name: 'Чердачный санузел у тяги', w: 4, h: 4 },
  { type: RoomType.OFFICE, name: 'Чердачный журнал ветрового поста', w: 6, h: 5 },
  { type: RoomType.KITCHEN, name: 'Чердачная чайная будка', w: 5, h: 5 },
] as const;

function placeAtticSupportAroundCore(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  core: Room,
  serial: number,
  supportBudget: { v: number },
): number {
  const coreCenter = roomCenter(core);
  let placed = 0;
  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ] as const;
  for (let i = 0; i < ATTIC_SUPPORT_PLANS.length && supportBudget.v > 0; i++) {
    const plan = ATTIC_SUPPORT_PLANS[(i + serial) % ATTIC_SUPPORT_PLANS.length];
    const dir = directions[(i + serial) & 3];
    let room: Room | null = null;
    for (let attempt = 0; attempt < 10 && !room; attempt++) {
      const spread = 11 + attempt * 4 + (i % 2) * 3;
      const lateral = ((attempt % 3) - 1) * 5;
      const x = coreCenter.x + dir.x * (Math.floor(core.w / 2) + spread) + (dir.y ? lateral : 0) - Math.floor(plan.w / 2);
      const y = coreCenter.y + dir.y * (Math.floor(core.h / 2) + spread) + (dir.x ? lateral : 0) - Math.floor(plan.h / 2);
      room = stampAtticSupportRoom(world, rooms, spec, plan.type, x, y, plan.w, plan.h, plan.name, serial * 13 + i * 17 + attempt);
    }
    if (!room) continue;
    connectAtticRoomToPoint(world, spec, room, coreCenter.x, coreCenter.y, serial * 19 + i);
    supportBudget.v--;
    placed++;
  }
  return placed;
}

function tryPlaceAtticCluster(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  anchor: AtticClusterAnchor,
  serial: number,
  supportBudget: { v: number },
): number {
  const coreW = 9 + ((spec.seed + serial * 3) % 5);
  const coreH = 7 + ((spec.seed >> (serial % 11)) % 4);
  let core: Room | null = null;
  for (let attempt = 0; attempt < 32 && !core; attempt++) {
    const angleSlot = (serial * 5 + attempt * 3) & 15;
    const angle = (angleSlot * Math.PI) / 8;
    const radius = 10 + (attempt % 8) * 7 + Math.floor(attempt / 8) * 9;
    const x = anchor.x + Math.cos(angle) * radius - Math.floor(coreW / 2);
    const y = anchor.y + Math.sin(angle) * radius - Math.floor(coreH / 2);
    core = stampAtticSupportRoom(
      world,
      rooms,
      spec,
      serial % 3 === 0 ? RoomType.PRODUCTION : serial % 3 === 1 ? RoomType.STORAGE : RoomType.COMMON,
      x,
      y,
      coreW,
      coreH,
      serial % 3 === 0 ? 'Чердачный узел вентмашин' : serial % 3 === 1 ? 'Чердачный склад решеток' : 'Чердачная станция обхода',
      serial * 101 + attempt,
    );
  }
  if (!core) return 0;
  connectAtticRoomToPoint(world, spec, core, anchor.x, anchor.y, serial * 29);
  const supportCount = placeAtticSupportAroundCore(world, rooms, spec, core, serial, supportBudget);
  return 1 + supportCount;
}

function placeAtticWeatherworksClusters(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  traces: readonly AtticTrace[],
  junctions: readonly AtticJunction[],
  targets: readonly Room[],
): void {
  const anchors = collectAtticClusterAnchors(spec, traces, junctions, targets);
  const clusterTarget = Math.min(anchors.length, ATTIC_MID_CLUSTER_TARGET + spec.danger * 5);
  const supportBudget = { v: ATTIC_MICRO_ROOM_TARGET + spec.danger * 10 + (spec.anomalyId === 'living_tunnels' ? ATTIC_LIVING_TUNNEL_MICRO_BONUS : 0) };
  let clusters = 0;
  for (const anchor of anchors) {
    if (clusters >= clusterTarget || supportBudget.v <= 0) break;
    const placed = tryPlaceAtticCluster(world, rooms, spec, anchor, clusters, supportBudget);
    if (placed > 0) clusters++;
  }
}

function atticOwnerLabel(owner: ZoneFaction): string {
  switch (owner) {
    case ZoneFaction.LIQUIDATOR: return 'ликвидаторов';
    case ZoneFaction.CULTIST: return 'культистов';
    case ZoneFaction.SCIENTIST: return 'ученых';
    case ZoneFaction.WILD: return 'диких';
    default: return 'граждан';
  }
}

function atticSupportRoomType(owner: ZoneFaction, index: number): RoomType {
  if (index === 0) return RoomType.COMMON;
  if (index === 1) return owner === ZoneFaction.SCIENTIST ? RoomType.MEDICAL : RoomType.STORAGE;
  if (index === 2) return owner === ZoneFaction.CULTIST ? RoomType.COMMON : RoomType.PRODUCTION;
  return owner === ZoneFaction.CITIZEN ? RoomType.KITCHEN : RoomType.OFFICE;
}

function atticRoomSize(type: RoomType, seed: number, index: number, scale: 'micro' | 'mid' | 'hq'): { w: number; h: number } {
  if (scale === 'hq') return { w: 9 + ((seed + index) & 1), h: 7 + ((seed >>> (index & 7)) & 1) };
  if (scale === 'mid') {
    if (type === RoomType.PRODUCTION) return { w: 13 + (index % 5), h: 9 + ((seed + index) % 4) };
    if (type === RoomType.COMMON) return { w: 12 + (index % 4), h: 8 + ((seed >>> 3) % 4) };
    return { w: 10 + (index % 4), h: 7 + ((seed + index) % 3) };
  }
  if (type === RoomType.CORRIDOR) return (index & 1) === 0 ? { w: 9 + (index % 5), h: 3 } : { w: 3, h: 9 + (index % 5) };
  if (type === RoomType.PRODUCTION) return { w: 7 + (index % 4), h: 6 + ((seed + index) % 3) };
  if (type === RoomType.COMMON) return { w: 7 + (index % 3), h: 6 + ((seed >>> 4) % 3) };
  if (type === RoomType.OFFICE) return { w: 6 + (index % 3), h: 5 + ((seed + index) % 2) };
  return { w: 5 + (index % 3), h: 5 + ((seed >>> (index & 7)) % 3) };
}

function paintAtticRoomTerritory(world: World, room: Room, owner: ZoneFaction): void {
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.aptMask[ci]) continue;
      world.factionControl[ci] = owner;
    }
  }
}

function markAtticHermeticShell(world: World, room: Room): void {
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

function decorateAtticServiceRoom(world: World, room: Room, spec: ProceduralFloorSpec, seed: number): void {
  applyRoomTexture(world, room, room.type === RoomType.HQ ? Tex.HERMO_WALL : Tex.PIPE, Tex.F_CONCRETE);
  decorateAtticPocketRoom(world, room, seed);
  decorateProceduralRoom(world, room, spec);
}

function tryPlaceAtticAttachedRoom(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  anchor: { x: number; y: number },
  type: RoomType,
  size: { w: number; h: number },
  name: string,
  index: number,
  owner?: ZoneFaction,
  hermetic = false,
): Room | null {
  const dirs = [
    { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 },
  ];
  const start = (spec.seed + index * 3) % dirs.length;
  const baseRadius = Math.max(6, Math.ceil(Math.max(size.w, size.h) / 2) + 4);
  for (let ring = 0; ring < 6; ring++) {
    const radius = baseRadius + ring * 4;
    for (let n = 0; n < dirs.length; n++) {
      const dir = dirs[(start + n) % dirs.length];
      const x = world.wrap(Math.round(anchor.x + dir.x * radius - size.w / 2));
      const y = world.wrap(Math.round(anchor.y + dir.y * radius - size.h / 2));
      if (!canPlaceRoom(world, x, y, size.w, size.h)) continue;
      const room = stampRoom(world, world.rooms.length, type, x, y, size.w, size.h, -1);
      room.name = name;
      decorateAtticServiceRoom(world, room, spec, spec.seed ^ index * 193);
      if (hermetic) markAtticHermeticShell(world, room);
      if (hermetic) room.sealed = true;
      if (owner !== undefined) paintAtticRoomTerritory(world, room, owner);
      const exit = roomExit(world, room, anchor.x, anchor.y);
      placeDoorAt(world, exit.wx, exit.wy, room.id);
      const doorIdx = world.idx(exit.wx, exit.wy);
      if (world.cells[doorIdx] !== Cell.DOOR && !world.aptMask[doorIdx] && world.cells[doorIdx] !== Cell.LIFT) {
        world.cells[doorIdx] = Cell.DOOR;
        world.wallTex[doorIdx] = hermetic ? Tex.DOOR_METAL : room.wallTex;
        world.features[doorIdx] = Feature.NONE;
        world.doors.set(doorIdx, { idx: doorIdx, state: hermetic ? DoorState.HERMETIC_OPEN : DoorState.CLOSED, roomA: room.id, roomB: -1, keyId: '', timer: 0 });
        if (!room.doors.includes(doorIdx)) room.doors.push(doorIdx);
      }
      const door = world.doors.get(doorIdx);
      if (hermetic && door) {
        door.state = DoorState.HERMETIC_OPEN;
        world.hermoWall[doorIdx] = 1;
      }
      const horizontalFirst = ((spec.seed + index * 17 + ring) & 1) === 0;
      if (horizontalFirst) {
        const step = carveRoofDuctSegment(world, spec, exit.ox, exit.oy, anchor.x, exit.oy, true, index + 101, index * 331);
        carveRoofDuctSegment(world, spec, anchor.x, exit.oy, anchor.x, anchor.y, false, index + 101, step);
      } else {
        const step = carveRoofDuctSegment(world, spec, exit.ox, exit.oy, exit.ox, anchor.y, false, index + 101, index * 331);
        carveRoofDuctSegment(world, spec, exit.ox, anchor.y, anchor.x, anchor.y, true, index + 101, step);
      }
      rooms.push(room);
      return room;
    }
  }
  return null;
}

function atticTraceAnchors(traces: readonly AtticTrace[], junctions: readonly AtticJunction[], seed: number): { x: number; y: number }[] {
  const anchors: { x: number; y: number; score: number }[] = [];
  for (const junction of junctions) anchors.push({ x: junction.x, y: junction.y, score: junction.score + 20_000 });
  for (const trace of traces) {
    const step = Math.max(12, Math.floor(trace.cells.length / 44));
    for (let i = (trace.id * 7) % step; i < trace.cells.length; i += step) {
      const ci = trace.cells[i];
      const x = ci % W;
      const y = (ci / W) | 0;
      anchors.push({
        x,
        y,
        score: atticHash01(seed, x >> 3, y >> 3, trace.id) * 10_000 + trace.cells.length * 0.01,
      });
    }
  }
  anchors.sort((a, b) => b.score - a.score);
  return anchors.map(({ x, y }) => ({ x, y }));
}

function selectAtticHqAnchor(
  world: World,
  anchors: readonly { x: number; y: number }[],
  ownerIndex: number,
  used: readonly { x: number; y: number }[],
  seed: number,
): { x: number; y: number } {
  const preferred = [
    { x: W * 0.20, y: W * 0.22 },
    { x: W * 0.80, y: W * 0.22 },
    { x: W * 0.22, y: W * 0.78 },
    { x: W * 0.78, y: W * 0.78 },
    { x: W * 0.52, y: W * 0.50 },
  ][ownerIndex];
  let best = anchors[0] ?? { x: Math.floor(preferred.x), y: Math.floor(preferred.y) };
  let bestScore = Infinity;
  for (const anchor of anchors) {
    const d2 = world.dist2(anchor.x + 0.5, anchor.y + 0.5, preferred.x, preferred.y);
    const spacingPenalty = used.some(prev => world.dist2(prev.x + 0.5, prev.y + 0.5, anchor.x + 0.5, anchor.y + 0.5) < 150 * 150) ? 80_000 : 0;
    const noise = atticHash01(seed, anchor.x >> 4, anchor.y >> 4, ownerIndex) * 900;
    const score = d2 + spacingPenalty + noise;
    if (score < bestScore) {
      bestScore = score;
      best = anchor;
    }
  }
  return best;
}

function placeAtticFactionHqClusters(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  traces: readonly AtticTrace[],
  junctions: readonly AtticJunction[],
): void {
  const anchors = atticTraceAnchors(traces, junctions, spec.seed ^ 0xfac710);
  const used: { x: number; y: number }[] = [];
  for (let i = 0; i < ATTIC_HQ_OWNERS.length; i++) {
    const owner = ATTIC_HQ_OWNERS[i];
    const anchor = selectAtticHqAnchor(world, anchors, i, used, spec.seed ^ 0x8a7c);
    const label = atticOwnerLabel(owner);
    const hq = tryPlaceAtticAttachedRoom(
      world,
      rooms,
      spec,
      anchor,
      RoomType.HQ,
      atticRoomSize(RoomType.HQ, spec.seed, i, 'hq'),
      `Чердачный гермоштаб ${label}`,
      3000 + i,
      owner,
      true,
    );
    const supportAnchor = hq ? roomCenter(hq) : anchor;
    used.push(supportAnchor);
    for (let s = 0; s < 4; s++) {
      const type = atticSupportRoomType(owner, s);
      const support = tryPlaceAtticAttachedRoom(
        world,
        rooms,
        spec,
        supportAnchor,
        type,
        atticRoomSize(type, spec.seed + i * 37, s, 'micro'),
        `Чердачная опора ${label} ${s + 1}`,
        3100 + i * 10 + s,
        owner,
      );
      if (!support) continue;
      if (type === RoomType.KITCHEN) {
        const ci = world.idx(support.x + Math.floor(support.w / 2), support.y + Math.floor(support.h / 2));
        if (world.features[ci] === Feature.NONE) world.features[ci] = Feature.STOVE;
      }
    }
  }
}

function carveAtticWindLane(world: World, spec: ProceduralFloorSpec, line: number, anchor: { x: number; y: number }): AtticWindLane | null {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]] as const;
  const dir = dirs[(spec.seed + line * 11) & 3];
  const length = 142 + spec.danger * 24 + line * 17;
  let x = world.wrap(anchor.x - Math.floor(dir[0] * length / 2));
  let y = world.wrap(anchor.y - Math.floor(dir[1] * length / 2));
  const cells: number[] = [];

  for (let step = 0; step <= length; step++) {
    if (carveRoofDuctCell(world, x, y)) {
      const ci = world.idx(x, y);
      world.fog[ci] = Math.max(world.fog[ci], 18 + spec.danger * 5);
      cells.push(ci);
    }
    if (step % 31 === 0) {
      const sx = world.wrap(x + (dir[1] === 0 ? 0 : dir[1]));
      const sy = world.wrap(y + (dir[0] === 0 ? 0 : -dir[0]));
      decorateRoofDuctEdge(world, sx, sy, step % 62 === 0 ? Feature.SCREEN : Feature.LAMP, spec, step + line * 5003);
    }
    if (step % 47 === 0) {
      stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.16, 0.46, spec.seed ^ (line * 5003 + step * 71), 210, 225, 224, true);
    }
    x = world.wrap(x + dir[0]);
    y = world.wrap(y + dir[1]);
  }

  if (cells.length < 84) return null;
  return { line, cells, start: cells[0], end: cells[cells.length - 1] };
}

function registerAtticWindCue(world: World, spec: ProceduralFloorSpec, lane: AtticWindLane): void {
  const startX = lane.start % W;
  const startY = (lane.start / W) | 0;
  const endX = lane.end % W;
  const endY = (lane.end / W) | 0;
  registerRouteCue(world, {
    id: `procedural_${spec.key}_attic_wind_${lane.line}`,
    x: startX + 0.5,
    y: startY + 0.5,
    targetX: endX + 0.5,
    targetY: endY + 0.5,
    floor: spec.baseFloor,
    label: 'ветровой ход',
    hint: 'открытая чердачная прямая: быстрее, но слышно дальше',
    targetName: 'дальний шум вентиляции',
    color: '#bfe8e2',
    tags: ['procedural_floor', 'attic_weatherworks', 'wind_lane', 'signal_lane', 'exposed_service_run'],
    toneSeed: spec.seed ^ lane.line * 0x51a7,
    radius: 13,
    targetRadius: 4,
    cooldownSec: 34,
    heardText: 'Вентиляция тянет холодной прямой. Можно бежать по открытому сервисному ходу или искать лаз сбоку.',
    followedText: 'Ветровая прямая пройдена. Теперь ясно, где шумит дальний контур.',
    ignoredText: 'Холодная тяга ушла за стену. Открытый сервисный ход остался не проверен.',
    routeGroup: {
      id: `procedural_${spec.key}_attic_wind_group_${lane.line}`,
      lead: 'ветер показывает прямую',
      risk: 'на открытой линии проще заметить и догнать',
      decision: 'идти быстро по тяге или обходить crawl-лазом',
      reward: 'дальний контур и документы читаются раньше',
      mapLabel: 'ветровой ход',
      mapHint: 'открытая чердачная линия',
    },
  });
}

function applyAtticWindSignalLanes(
  world: World,
  rooms: readonly Room[],
  spec: ProceduralFloorSpec,
  targets: readonly Room[],
  sx: number,
  sy: number,
): void {
  const anchors = targets.length > 0 ? targets : rooms.filter(room => room.id !== 0 && room.type !== RoomType.BATHROOM).slice(0, 3);
  const count = Math.min(4, 2 + (spec.danger >= 3 ? 1 : 0) + (spec.danger >= 4 ? 1 : 0));
  for (let i = 0; i < count; i++) {
    const room = anchors[i % Math.max(1, anchors.length)];
    const anchor = room ? roomCenter(room) : { x: sx, y: sy };
    const lane = carveAtticWindLane(world, spec, i, anchor);
    if (lane) registerAtticWindCue(world, spec, lane);
  }
}

function chooseRoofDuctTargets(world: World, rooms: Room[], sx: number, sy: number, spec: ProceduralFloorSpec): Room[] {
  const candidates = rooms
    .filter(room => room.id !== 0 && room.type !== RoomType.BATHROOM && room.w >= 5 && room.h >= 5)
    .map(room => ({ room, d2: world.dist2(sx, sy, roomCenter(room).x, roomCenter(room).y) }))
    .filter(item => item.d2 > 50 * 50)
    .sort((a, b) => b.d2 - a.d2);
  const window = candidates.slice(0, Math.min(candidates.length, 14));
  const targetCount = Math.min(window.length, 4 + Math.floor(spec.danger / 2));
  const picked: Room[] = [];
  const pickedSet = new Set<Room>();
  for (let i = 0; i < window.length && picked.length < targetCount; i++) {
    const index = (spec.seed + i * 5) % window.length;
    const room = window[index].room;
    if (!pickedSet.has(room)) {
      picked.push(room);
      pickedSet.add(room);
    }
  }
  return picked;
}

function applyAtticWeatherworks(world: World, rooms: Room[], spec: ProceduralFloorSpec, spawnX: number, spawnY: number): void {
  if (spec.geometryId !== 'attic_weatherworks') return;
  const sx = Math.floor(spawnX);
  const sy = Math.floor(spawnY);
  const targets = chooseRoofDuctTargets(world, rooms, sx, sy, spec);
  const field = buildAtticTensorField(spec);
  const horizontalCount = 4 + (spec.danger >= 4 ? 1 : 0);
  const verticalCount = 3 + (spec.danger >= 3 ? 1 : 0);
  const horizontalLanes = selectAtticLanes(spec.seed ^ 0x3811, sy, targets, true, horizontalCount);
  const verticalLanes = selectAtticLanes(spec.seed ^ 0x3822, sx, targets, false, verticalCount);
  const traces: AtticTrace[] = [];
  const junctions: AtticJunction[] = [];

  for (let i = 0; i < horizontalLanes.length; i++) {
    traces.push(traceAtticTensorSpine(world, spec, field, i, true, horizontalLanes[i]));
  }
  for (let i = 0; i < verticalLanes.length; i++) {
    traces.push(traceAtticTensorSpine(world, spec, field, i + traces.length, false, verticalLanes[i]));
  }

  for (let i = 0; i < traces.length - 1; i++) bridgeAtticTraces(world, spec, traces[i], traces[i + 1], i, junctions);
  if (traces.length >= 3) bridgeAtticTraces(world, spec, traces[0], traces[traces.length - 1], traces.length, junctions);

  for (let i = 0; i < targets.length; i++) {
    const end = roomCenter(targets[i]);
    const horizontalFirst = ((spec.seed >> (i % 12)) & 1) === 0;
    let step = i * 701;
    if (horizontalFirst) {
      step = carveRoofDuctSegment(world, spec, sx, sy, end.x, sy, true, i, step);
      carveRoofDuctSegment(world, spec, end.x, sy, end.x, end.y, false, i, step);
    } else {
      step = carveRoofDuctSegment(world, spec, sx, sy, sx, end.y, false, i, step);
      carveRoofDuctSegment(world, spec, sx, end.y, end.x, end.y, true, i, step);
    }
    targets[i].name = `${targets[i].name} у шумной тяги`;
  }
  placeAtticServicePockets(world, rooms, spec, junctions);
  placeAtticFactionHqClusters(world, rooms, spec, traces, junctions);
  placeAtticWeatherworksClusters(world, rooms, spec, traces, junctions, targets);
  applyAtticWindSignalLanes(world, rooms, spec, targets, sx, sy);
  world.markCellsDirty();
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFeaturesDirty(true);
  world.markFogDirty();
}

function atticPreferredRooms(rooms: readonly Room[], kind: 'repair' | 'documents'): Room[] {
  const preferredName = kind === 'repair' ? 'Чердачный ремонтный карман' : 'Чердачный карман документов';
  const preferred = rooms.filter(room => room.name.startsWith(preferredName));
  const typed = rooms.filter(room => kind === 'repair'
    ? room.type === RoomType.PRODUCTION || room.type === RoomType.STORAGE || room.type === RoomType.CORRIDOR
    : room.type === RoomType.OFFICE || room.type === RoomType.STORAGE || room.type === RoomType.COMMON);
  return [...preferred, ...typed.filter(room => !preferred.includes(room))];
}

function registerAtticDecisionCue(
  world: World,
  spec: ProceduralFloorSpec,
  repair: { room: Room; x: number; y: number },
  cache: { room: Room; x: number; y: number },
): void {
  registerRouteCue(world, {
    id: `procedural_${spec.key}_attic_repair_cache`,
    x: repair.x + 0.5,
    y: repair.y + 0.5,
    targetX: cache.x + 0.5,
    targetY: cache.y + 0.5,
    floor: spec.baseFloor,
    roomId: repair.room.id,
    targetRoomId: cache.room.id,
    zoneId: world.zoneMap[world.idx(repair.x, repair.y)],
    label: 'чердачный контур',
    hint: 'починить тягу, пройти crawl-обходом или украсть ведомость',
    targetName: 'документный карман',
    color: '#9ee6c4',
    tags: ['procedural_floor', 'attic_weatherworks', 'duct_repair', 'document_cache', 'crawl_bypass'],
    toneSeed: spec.seed ^ 0x380038,
    radius: 11,
    targetRadius: 3,
    cooldownSec: 32,
    heardText: 'Щиток вытяжки хрустит рядом с лазом. Починка даст тихий ход, кража даст бумаги.',
    followedText: 'Чердачный контур найден: здесь можно чинить воздух, обходить шум или выносить ведомость.',
    ignoredText: 'Щиток вытяжки остался позади. Документный карман пока шумит без свидетелей.',
    routeGroup: {
      id: `procedural_${spec.key}_attic_repair_cache_group`,
      lead: 'сервисный лаз ведет к документам',
      risk: 'открытая тяга шумит и собирает угрозы',
      decision: 'починить контур, ползти обходом или красть шкаф',
      reward: 'ремонтные детали и министерская ведомость',
      mapLabel: 'чердачный контур',
      mapHint: 'ремонт, обход, документы',
    },
  });
}

function placeAtticWeatherworksLandmarks(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  spawnX: number,
  spawnY: number,
  reachable: Uint8Array,
): void {
  if (spec.geometryId !== 'attic_weatherworks') return;
  const occupied = new Set<number>();
  const repairRooms = atticPreferredRooms(rooms, 'repair');
  const documentRooms = atticPreferredRooms(rooms, 'documents')
    .sort((a, b) => world.dist2(spawnX, spawnY, roomCenter(b).x, roomCenter(b).y) - world.dist2(spawnX, spawnY, roomCenter(a).x, roomCenter(a).y));
  const repair = findReachableContainerCell(world, repairRooms, reachable, spec.seed ^ 0x3831, repairRooms[0], occupied);
  if (repair) {
    const ci = world.idx(repair.x, repair.y);
    occupied.add(ci);
    world.features[ci] = Feature.APPARATUS;
    stampSurfaceSplat(world, repair.x, repair.y, 0.5, 0.5, 0.42, 0.58, spec.seed ^ 0x3832, 82, 120, 108, false);
    addProceduralLootContainer(
      world,
      spec,
      repair.room,
      repair,
      ContainerKind.TOOL_LOCKER,
      cloneItems(ATTIC_REPAIR_CACHE_ITEMS),
      ['attic_weatherworks', 'duct_repair', 'crawl_bypass', 'repair_cache'],
      'Чердачный ремонтный шкаф вытяжки',
    );
  }

  const cache = findReachableContainerCell(world, documentRooms, reachable, spec.seed ^ 0x3833, documentRooms[0], occupied);
  if (cache) {
    const ci = world.idx(cache.x, cache.y);
    occupied.add(ci);
    if (world.features[ci] === Feature.NONE || world.features[ci] === Feature.SHELF) world.features[ci] = Feature.SHELF;
    stampSurfaceSplat(world, cache.x, cache.y, 0.5, 0.5, 0.34, 0.5, spec.seed ^ 0x3834, 180, 172, 142, false);
    addProceduralLootContainer(
      world,
      spec,
      cache.room,
      cache,
      ContainerKind.FILING_CABINET,
      cloneItems(ATTIC_DOCUMENT_CACHE_ITEMS),
      ['attic_weatherworks', 'document_cache', 'steal_document_cache', 'audit_risk'],
      'Чердачный документный шкаф вентиляции',
    );
  }

  if (repair && cache) registerAtticDecisionCue(world, spec, repair, cache);
  world.markFeaturesDirty(true);
}

function applyArchiveWarrens(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  entities: Entity[],
  nextId: { v: number },
): void {
  if (spec.geometryId !== 'archive_warrens') return;
  const intent = archiveWarrenIntents.get(world);
  if (intent) {
    const used = new Set<number>();
    for (const roomId of intent.keyDropRoomIds) {
      if (used.has(roomId)) continue;
      const room = world.rooms[roomId];
      if (!room) continue;
      const pos = findFreeRoomCell(world, room, spec.seed + roomId * 271)
        ?? roomCell(world, room, Math.floor(room.w / 2), Math.floor(room.h / 2));
      if (!pos) continue;
      dropItem(entities, nextId, pos.x, pos.y, ARCHIVE_WARREN_KEY_ID, 1);
      used.add(roomId);
    }
    return;
  }
  const candidates = rooms
    .filter(room => room.type === RoomType.STORAGE || room.type === RoomType.OFFICE || room.type === RoomType.COMMON)
    .sort((a, b) => (b.w * b.h) - (a.w * a.h));
  const limit = Math.min(candidates.length, 10 + spec.danger * 3);

  for (let i = 0; i < limit; i++) {
    const room = candidates[i];
    room.name = room.type === RoomType.OFFICE
      ? `Опись ${room.id}: столы доступа`
      : `Архивная нора ${room.id}`;
    room.floorTex = room.type === RoomType.OFFICE ? Tex.F_GREEN_CARPET : Tex.F_PARQUET;
    for (let dy = 1; dy < room.h - 1; dy++) {
      for (let dx = 1; dx < room.w - 1; dx++) {
        if (dy % 3 === 0 && dx % 4 !== 0) continue;
        if (dy % 3 !== 0 && dx % 5 !== 0) continue;
        const ci = world.idx(room.x + dx, room.y + dy);
        if (world.cells[ci] !== Cell.FLOOR || world.roomMap[ci] !== room.id || world.features[ci] !== Feature.NONE) continue;
        world.features[ci] = room.type === RoomType.OFFICE && chance(0.35) ? Feature.DESK : Feature.SHELF;
        world.floorTex[ci] = room.floorTex;
      }
    }
    const center = roomCenter(room);
    if (i % 3 === 0) stampSurfaceSplat(world, center.x, center.y, 0.5, 0.5, 0.32, 0.58, spec.seed + i * 113, 210, 198, 168, false);
  }
}

const COMMUNAL_PANTRY_ITEMS: readonly Item[] = [
  { defId: 'bread', count: 3 },
  { defId: 'water', count: 2 },
  { defId: 'toiletpaper', count: 2 },
  { defId: 'ration_registry_extract', count: 1 },
];
const COMMUNAL_NOTICE_ITEMS: readonly Item[] = [
  { defId: 'neighbor_complaint', count: 1 },
  { defId: 'denunciation', count: 1 },
  { defId: 'sealed_complaint', count: 1 },
  { defId: 'record_exposure_notice', count: 1 },
];
const COMMUNAL_THROUGH_FLAT_ITEMS: readonly Item[] = [
  { defId: 'resident_identity_stub', count: 1 },
  { defId: 'bread', count: 1 },
  { defId: 'cigs', count: 1 },
];
interface CommunalClusterLayout {
  type: RoomType;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

const COMMUNAL_CLUSTER_LAYOUT: readonly CommunalClusterLayout[] = [
  { type: RoomType.COMMON, x: 0, y: 0, w: 16, h: 10, label: 'общий предбанник' },
  { type: RoomType.KITCHEN, x: 21, y: 0, w: 9, h: 7, label: 'комната кипятка' },
  { type: RoomType.BATHROOM, x: 0, y: 15, w: 7, h: 5, label: 'туалет очереди' },
  { type: RoomType.STORAGE, x: 10, y: 15, w: 6, h: 5, label: 'чулан пайков' },
  { type: RoomType.LIVING, x: 20, y: 13, w: 8, h: 7, label: 'жилая ячейка' },
  { type: RoomType.SMOKING, x: 34, y: 2, w: 7, h: 5, label: 'курительная ниша' },
  { type: RoomType.STORAGE, x: 34, y: 11, w: 5, h: 4, label: 'шкаф общака' },
];
const COMMUNAL_CLUSTER_GROUP_W = 42;
const COMMUNAL_CLUSTER_GROUP_H = 21;
const COMMUNAL_CLUSTER_MIN_SPACING = 34 * 34;

function communalServiceRoomName(room: Room): string {
  if (room.type === RoomType.KITCHEN) return `Общая кухня ${room.id}`;
  if (room.type === RoomType.BATHROOM) return `Водяная очередь ${room.id}`;
  if (room.type === RoomType.STORAGE) return `Кладовая общака ${room.id}`;
  if (room.type === RoomType.SMOKING) return `Очередь у курилки ${room.id}`;
  return `Коммунальная очередь ${room.id}`;
}

function firstAdjacentRoomId(world: World, x: number, y: number): number {
  for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const roomId = world.roomMap[world.idx(x + ox, y + oy)];
    if (roomId >= 0) return roomId;
  }
  return -1;
}

function carveCommunalLoopCell(world: World, x: number, y: number, spec: ProceduralFloorSpec, step: number, bypass: boolean): boolean {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT || world.hermoWall[ci] || world.aptMask[ci]) return false;
  if (world.features[ci] === Feature.LIFT_BUTTON || world.containerMap.has(ci)) return false;

  if (world.cells[ci] === Cell.WALL) {
    const roomId = firstAdjacentRoomId(world, x, y);
    if (roomId >= 0) placeDoorAt(world, x, y, roomId);
    else world.cells[ci] = Cell.FLOOR;
  } else if (world.cells[ci] !== Cell.DOOR) {
    world.cells[ci] = Cell.FLOOR;
  }

  if (world.cells[ci] !== Cell.DOOR) {
    world.floorTex[ci] = bypass ? Tex.F_WOOD : Tex.F_LINO;
    world.wallTex[ci] = Tex.BRICK;
    if (world.roomMap[ci] < 0) world.roomMap[ci] = -1;
  }

  if (step % 23 === 0 && world.cells[ci] === Cell.FLOOR && world.features[ci] === Feature.NONE) {
    world.features[ci] = bypass
      ? (step % 46 === 0 ? Feature.BED : Feature.CHAIR)
      : (step % 46 === 0 ? Feature.LAMP : Feature.TABLE);
  }
  if (step % 41 === 0) {
    stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.26, 0.44, spec.seed ^ (step * 97), bypass ? 126 : 150, bypass ? 96 : 108, bypass ? 76 : 66, false);
  }
  return true;
}

function carveCommunalSegment(
  world: World,
  spec: ProceduralFloorSpec,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  horizontal: boolean,
  stepBase: number,
  bypass: boolean,
): number {
  const delta = horizontal ? world.delta(ax, bx) : world.delta(ay, by);
  const stepDir = delta >= 0 ? 1 : -1;
  const steps = Math.abs(delta);
  let x = world.wrap(ax);
  let y = world.wrap(ay);

  for (let s = 0; s <= steps; s++) {
    const step = stepBase + s;
    for (let side = 0; side <= (bypass ? 0 : 1); side++) {
      carveCommunalLoopCell(world, horizontal ? x : x + side, horizontal ? y + side : y, spec, step, bypass);
    }
    if (s < steps) {
      if (horizontal) x = world.wrap(x + stepDir);
      else y = world.wrap(y + stepDir);
    }
  }

  return stepBase + steps + 1;
}

function carveCommunalChord(world: World, spec: ProceduralFloorSpec, a: Room, b: Room, index: number, bypass: boolean): void {
  const ac = roomCenter(a);
  const bc = roomCenter(b);
  const horizontalFirst = ((spec.seed + index * 37 + (bypass ? 11 : 0)) & 1) === 0;
  let step = index * 1201 + (bypass ? 7000 : 0);
  if (horizontalFirst) {
    step = carveCommunalSegment(world, spec, ac.x, ac.y, bc.x, ac.y, true, step, bypass);
    carveCommunalSegment(world, spec, bc.x, ac.y, bc.x, bc.y, false, step, bypass);
  } else {
    step = carveCommunalSegment(world, spec, ac.x, ac.y, ac.x, bc.y, false, step, bypass);
    carveCommunalSegment(world, spec, ac.x, bc.y, bc.x, bc.y, true, step, bypass);
  }
}

function pickCommunalServiceRooms(rooms: Room[]): Room[] {
  const used = new Set<number>();
  const out: Room[] = [];

  let bestByType: Partial<Record<RoomType, Room>> = {};

  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i];
    if (r.w >= 4 && r.h >= 4) {
      const existing = bestByType[r.type];
      if (!existing || (r.w * r.h) > (existing.w * existing.h)) {
        bestByType[r.type] = r;
      }
    }
  }

  const typesToFind = [RoomType.KITCHEN, RoomType.BATHROOM, RoomType.STORAGE, RoomType.SMOKING, RoomType.COMMON];
  for (let i = 0; i < typesToFind.length; i++) {
    const type = typesToFind[i];
    const room = bestByType[type];
    if (room && !used.has(room.id)) {
      used.add(room.id);
      out.push(room);
    }
  }

  if (out.length < 5) {
    const sortedRooms = [...rooms].sort((a, b) => (b.w * b.h) - (a.w * a.h));
    for (let i = 0; i < sortedRooms.length; i++) {
      if (out.length >= 5) break;
      const room = sortedRooms[i];
      if (used.has(room.id) || room.type === RoomType.CORRIDOR) continue;
      used.add(room.id);
      out.push(room);
    }
  }

  return out;
}

function pickCommunalBypassRooms(world: World, rooms: Room[], serviceRooms: readonly Room[], spawnX: number, spawnY: number): Room[] {
  const serviceIds = new Set(serviceRooms.map(room => room.id));
  const candidates = rooms
    .filter(room => !serviceIds.has(room.id) && (room.type === RoomType.LIVING || room.type === RoomType.COMMON) && room.w >= 5 && room.h >= 5)
    .map(room => ({ room, d2: world.dist2(spawnX, spawnY, roomCenter(room).x, roomCenter(room).y) }))
    .sort((a, b) => b.d2 - a.d2)
    .map(item => item.room);
  return candidates.slice(0, Math.min(candidates.length, 4));
}

function decorateCommunalServiceRoom(world: World, room: Room, spec: ProceduralFloorSpec, index: number): void {
  room.name = communalServiceRoomName(room);
  if (room.type === RoomType.STORAGE) room.floorTex = Tex.F_WOOD;
  if (room.type === RoomType.BATHROOM) room.floorTex = Tex.F_TILE;
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[ci] === room.id && (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER)) world.floorTex[ci] = room.floorTex;
    }
  }
  const cx = Math.floor(room.w / 2);
  const cy = Math.floor(room.h / 2);
  placeRoomFeature(world, room, room.type === RoomType.BATHROOM ? Feature.SINK : Feature.TABLE, cx, cy);
  if (room.type === RoomType.KITCHEN || room.type === RoomType.COMMON) {
    placeRoomFeature(world, room, Feature.STOVE, 1, 1);
    placeRoomFeature(world, room, Feature.SINK, room.w - 2, 1);
  } else if (room.type === RoomType.STORAGE) {
    placeRoomFeature(world, room, Feature.SHELF, 1, 1);
    placeRoomFeature(world, room, Feature.SHELF, room.w - 2, room.h - 2);
  } else if (room.type === RoomType.SMOKING) {
    placeRoomFeature(world, room, Feature.CHAIR, 1, room.h - 2);
    placeRoomFeature(world, room, Feature.CHAIR, room.w - 2, room.h - 2);
  }
  const center = roomCenter(room);
  stampSurfaceSplat(world, center.x, center.y, 0.5, 0.5, 0.34, 0.52, spec.seed + index * 211, 120, 92, 70, false);
}

function decorateCommunalBypassRoom(world: World, room: Room, spec: ProceduralFloorSpec, index: number): void {
  room.name = `Сквозная коммуналка ${room.id}`;
  placeRoomFeature(world, room, Feature.BED, 1, room.h - 2);
  placeRoomFeature(world, room, Feature.CHAIR, room.w - 2, room.h - 2);
  placeRoomFeature(world, room, index % 2 === 0 ? Feature.TABLE : Feature.SHELF, Math.floor(room.w / 2), Math.floor(room.h / 2));
  const center = roomCenter(room);
  stampSurfaceSplat(world, center.x, center.y, 0.5, 0.5, 0.28, 0.44, spec.seed ^ (0x7b00 + index * 173), 126, 96, 76, false);
}

function decorateCommunalGrievanceDomains(world: World, rooms: readonly Room[], spec: ProceduralFloorSpec): void {
  const candidates = rooms.filter(room =>
    room.name.startsWith('Коммунальная очередь') ||
    room.name.startsWith('Очередь у курилки') ||
    room.name.startsWith('Сквозная коммуналка') ||
    room.type === RoomType.COMMON,
  );
  const limit = Math.min(3, candidates.length);
  const used = new Set<number>();
  for (let attempt = 0, placed = 0; attempt < candidates.length * 2 && placed < limit; attempt++) {
    const room = candidates[(spec.seed + attempt * 5) % candidates.length];
    if (used.has(room.id)) continue;
    used.add(room.id);
    room.name = `Домен жалобы ${placed + 1}: ${room.name}`;
    const pos = placeRoomFeature(world, room, placed === 0 ? Feature.SCREEN : Feature.DESK, Math.floor(room.w / 2), 1);
    const center = roomCenter(room);
    stampSurfaceSplat(world, pos?.x ?? center.x, pos?.y ?? center.y, 0.5, 0.5, 0.42, 0.58, spec.seed ^ (0x9047 + placed * 271), 160, 42, 36, false);
    placed++;
  }
}

function communalClusterRoomName(cluster: number, item: CommunalClusterLayout, room: Room): string {
  return `Очередной блок ${cluster + 1}: ${item.label} ${room.id}`;
}

function decorateCommunalClusterRoom(world: World, room: Room, item: CommunalClusterLayout, spec: ProceduralFloorSpec, cluster: number): void {
  applyRoomTexture(world, room, item.type === RoomType.BATHROOM ? Tex.BRICK : Tex.PANEL, item.type === RoomType.BATHROOM ? Tex.F_TILE : Tex.F_LINO);
  if (item.type === RoomType.KITCHEN) {
    placeRoomFeature(world, room, Feature.STOVE, 1, 1);
    placeRoomFeature(world, room, Feature.SINK, room.w - 2, 1);
    placeRoomFeature(world, room, Feature.TABLE, Math.floor(room.w / 2), Math.floor(room.h / 2));
  } else if (item.type === RoomType.BATHROOM) {
    placeRoomFeature(world, room, Feature.SINK, 1, 1);
    placeRoomFeature(world, room, Feature.TOILET, room.w - 2, room.h - 2);
  } else if (item.type === RoomType.STORAGE) {
    placeRoomFeature(world, room, Feature.SHELF, 1, 1);
    placeRoomFeature(world, room, Feature.SHELF, room.w - 2, room.h - 2);
  } else if (item.type === RoomType.LIVING) {
    placeRoomFeature(world, room, Feature.BED, 1, room.h - 2);
    placeRoomFeature(world, room, Feature.TABLE, room.w - 2, 1);
  } else if (item.type === RoomType.SMOKING) {
    placeRoomFeature(world, room, Feature.CHAIR, 1, room.h - 2);
    placeRoomFeature(world, room, Feature.CHAIR, room.w - 2, room.h - 2);
  } else {
    placeRoomFeature(world, room, Feature.TABLE, Math.floor(room.w / 2), Math.floor(room.h / 2));
    placeRoomFeature(world, room, Feature.LAMP, 1, 1);
  }
  const center = roomCenter(room);
  if ((room.id + cluster) % 3 === 0) {
    stampSurfaceSplat(world, center.x, center.y, 0.5, 0.5, 0.24, 0.4, spec.seed ^ (room.id * 193) ^ 0x4040, 116, 90, 66, false);
  }
}

function canPlaceCommunalCluster(world: World, x: number, y: number): boolean {
  for (const item of COMMUNAL_CLUSTER_LAYOUT) {
    if (!canPlaceRoom(world, x + item.x, y + item.y, item.w, item.h)) return false;
  }
  return true;
}

function findCommunalClusterOrigin(
  world: World,
  spec: ProceduralFloorSpec,
  clusterIndex: number,
  centers: readonly { x: number; y: number }[],
  spawnX: number,
  spawnY: number,
): { x: number; y: number } | null {
  const maxX = W - COMMUNAL_CLUSTER_GROUP_W - 24;
  const maxY = W - COMMUNAL_CLUSTER_GROUP_H - 24;
  for (let attempt = 0; attempt < 160; attempt++) {
    const salt = clusterIndex * 131 + attempt * 17;
    const x = 24 + Math.floor(fieldHash01(spec.seed, salt, spec.z, 0x4041) * Math.max(1, maxX - 23));
    const y = 24 + Math.floor(fieldHash01(spec.seed, spec.ordinal, salt, 0x4042) * Math.max(1, maxY - 23));
    const cx = x + (COMMUNAL_CLUSTER_GROUP_W >> 1);
    const cy = y + (COMMUNAL_CLUSTER_GROUP_H >> 1);
    if (world.dist2(spawnX, spawnY, cx + 0.5, cy + 0.5) < 48 * 48) continue;
    if (centers.some(center => world.dist2(center.x, center.y, cx, cy) < COMMUNAL_CLUSTER_MIN_SPACING)) continue;
    if (canPlaceCommunalCluster(world, x, y)) return { x, y };
  }
  return null;
}

function stampCommunalClusterRooms(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  nextRoomId: { v: number },
  origin: { x: number; y: number },
  clusterIndex: number,
): Room[] {
  const cluster: Room[] = [];
  for (const item of COMMUNAL_CLUSTER_LAYOUT) {
    const room = stampRoom(world, nextRoomId.v++, item.type, origin.x + item.x, origin.y + item.y, item.w, item.h, -1);
    room.name = communalClusterRoomName(clusterIndex, item, room);
    decorateRoom(world, room);
    decorateProceduralRoom(world, room, spec);
    decorateCommunalClusterRoom(world, room, item, spec, clusterIndex);
    rooms.push(room);
    cluster.push(room);
  }
  connectRoomsMST(world, cluster);
  return cluster;
}

function carveCommunalClusterQueueRing(
  world: World,
  spec: ProceduralFloorSpec,
  origin: { x: number; y: number },
  clusterIndex: number,
): void {
  const left = origin.x - 3;
  const right = origin.x + COMMUNAL_CLUSTER_GROUP_W + 2;
  const top = origin.y - 3;
  const bottom = origin.y + COMMUNAL_CLUSTER_GROUP_H + 2;
  let step = clusterIndex * 1709 + 0x4c40;
  step = carveCommunalSegment(world, spec, left, top, right, top, true, step, false);
  step = carveCommunalSegment(world, spec, right, top, right, bottom, false, step, false);
  step = carveCommunalSegment(world, spec, right, bottom, left, bottom, true, step, false);
  carveCommunalSegment(world, spec, left, bottom, left, top, false, step, false);
}

function applyCommunalKnotClusterRooms(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  nextRoomId: { v: number },
  spawnX: number,
  spawnY: number,
): void {
  if (spec.geometryId !== 'communal_knots') return;
  const conveyorBonus = spec.anomalyId === 'conveyor_sorter' ? 6 : 0;
  const targetClusters = 18 + spec.danger * 4 + conveyorBonus;
  const centers: { x: number; y: number }[] = [];
  let placedRooms = 0;
  for (let cluster = 0; cluster < targetClusters; cluster++) {
    const origin = findCommunalClusterOrigin(world, spec, cluster, centers, spawnX, spawnY);
    if (!origin) continue;
    const stamped = stampCommunalClusterRooms(world, rooms, spec, nextRoomId, origin, cluster);
    if (stamped.length === 0) continue;
    centers.push({
      x: origin.x + (COMMUNAL_CLUSTER_GROUP_W >> 1),
      y: origin.y + (COMMUNAL_CLUSTER_GROUP_H >> 1),
    });
    placedRooms += stamped.length;
    carveCommunalClusterQueueRing(world, spec, origin, cluster);
  }
  if (placedRooms > 0) {
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFeaturesDirty(true);
  }
}

function applyCommunalKnots(world: World, rooms: Room[], spec: ProceduralFloorSpec, spawnX: number, spawnY: number): void {
  if (spec.geometryId !== 'communal_knots') return;
  const serviceRooms = pickCommunalServiceRooms(rooms);
  const bypassRooms = pickCommunalBypassRooms(world, rooms, serviceRooms, spawnX, spawnY);

  for (let i = 0; i < serviceRooms.length; i++) decorateCommunalServiceRoom(world, serviceRooms[i], spec, i);
  if (serviceRooms.length >= 2) {
    for (let i = 0; i < serviceRooms.length; i++) carveCommunalChord(world, spec, serviceRooms[i], serviceRooms[(i + 1) % serviceRooms.length], i, false);
  }

  for (let i = 0; i < bypassRooms.length; i++) decorateCommunalBypassRoom(world, bypassRooms[i], spec, i);
  if (bypassRooms.length >= 2) {
    for (let i = 0; i < bypassRooms.length; i++) carveCommunalChord(world, spec, bypassRooms[i], bypassRooms[(i + 1) % bypassRooms.length], i, true);
  }
  if (bypassRooms.length >= 2 && serviceRooms.length >= 2) {
    carveCommunalChord(world, spec, bypassRooms[0], serviceRooms[0], 20, true);
    carveCommunalChord(world, spec, bypassRooms[bypassRooms.length - 1], serviceRooms[Math.floor(serviceRooms.length / 2)], 21, true);
  }

  decorateCommunalGrievanceDomains(world, [...serviceRooms, ...bypassRooms], spec);
}

function placeCommunalKnotLandmarks(world: World, rooms: Room[], spec: ProceduralFloorSpec, reachable: Uint8Array): void {
  if (spec.geometryId !== 'communal_knots') return;
  const pantryRoom = rooms.find(room => room.name.startsWith('Кладовая общака')) ?? rooms.find(room => room.type === RoomType.STORAGE);
  const noticeRoom = rooms.find(room => room.name.startsWith('Домен жалобы')) ?? rooms.find(room => room.type === RoomType.COMMON);
  const throughRoom = rooms.find(room => room.name.includes('Сквозная коммуналка'));

  const pantry = pantryRoom ? findReachableContainerCell(world, rooms, reachable, spec.seed ^ 0x3701, pantryRoom) : null;
  if (pantry) {
    addProceduralLootContainer(
      world,
      spec,
      pantry.room,
      pantry,
      ContainerKind.WOODEN_CHEST,
      COMMUNAL_PANTRY_ITEMS.map(item => ({ ...item })),
      ['service_loop', 'communal_pantry', 'steal_pantry', 'queue', 'theft'],
      'Кладовая общака: чужая пайка',
    );
  }

  const notice = noticeRoom ? findReachableContainerCell(world, rooms, reachable, spec.seed ^ 0x3702, noticeRoom) : null;
  if (notice) {
    addProceduralLootContainer(
      world,
      spec,
      notice.room,
      notice,
      ContainerKind.FILING_CABINET,
      COMMUNAL_NOTICE_ITEMS.map(item => ({ ...item })),
      ['service_loop', 'grievance', 'potts_domain', 'expose_notice', 'evidence'],
      'Доска жалоб: сорванное объявление',
    );
  }

  const through = throughRoom ? findReachableContainerCell(world, rooms, reachable, spec.seed ^ 0x3703, throughRoom) : null;
  if (through) {
    addProceduralLootContainer(
      world,
      spec,
      through.room,
      through,
      ContainerKind.SECRET_STASH,
      COMMUNAL_THROUGH_FLAT_ITEMS.map(item => ({ ...item })),
      ['bypass_loop', 'through_flat', 'small_world_shortcut', 'hide'],
      'Ниша сквозной коммуналки',
    );
  }
}

const CITIZEN_PUBLIC_SUPPLY_ITEMS: readonly Item[] = [
  { defId: 'water', count: 2 },
  { defId: 'bread', count: 2 },
  { defId: 'bandage', count: 1 },
  { defId: 'siren_instruction', count: 1 },
];
const CITIZEN_TRADE_ITEMS: readonly Item[] = [
  { defId: 'tea', count: 2 },
  { defId: 'cigs', count: 2 },
  { defId: 'ration_registry_extract', count: 1 },
];
const CITIZEN_WITNESS_THEFT_ITEMS: readonly Item[] = [
  { defId: 'shelter_tally', count: 1 },
  { defId: 'forged_ration_card', count: 1 },
  { defId: 'neighbor_complaint', count: 1 },
];

function citizenMajorityCandidates(rooms: Room[]): Room[] {
  return rooms
    .filter(room => room.id !== 0 && room.w >= 4 && room.h >= 4)
    .filter(room => !(
      room.name.startsWith('Окно приема') ||
      room.name.startsWith('Юридическая очередь') ||
      room.name.startsWith('Кабинет-слэб') ||
      room.name.startsWith('Документный карман') ||
      room.name.startsWith('Служебная хорда')
    ))
    .filter(room =>
      room.type === RoomType.KITCHEN ||
      room.type === RoomType.COMMON ||
      room.type === RoomType.LIVING ||
      room.type === RoomType.SMOKING ||
      room.type === RoomType.STORAGE ||
      room.type === RoomType.CORRIDOR ||
      room.type === RoomType.OFFICE,
    )
    .sort((a, b) => {
      const ap = a.type === RoomType.KITCHEN ? 90 : a.type === RoomType.COMMON ? 78 : a.type === RoomType.LIVING ? 58 : a.type === RoomType.SMOKING ? 48 : 24;
      const bp = b.type === RoomType.KITCHEN ? 90 : b.type === RoomType.COMMON ? 78 : b.type === RoomType.LIVING ? 58 : b.type === RoomType.SMOKING ? 48 : 24;
      return (bp + b.w * b.h * 0.04) - (ap + a.w * a.h * 0.04);
    });
}

function citizenPickRooms(candidates: readonly Room[], count: number, used: Set<number>): Room[] {
  const out: Room[] = [];
  for (const room of candidates) {
    if (out.length >= count) break;
    if (used.has(room.id)) continue;
    used.add(room.id);
    out.push(room);
  }
  return out;
}

function placeCitizenSeating(world: World, room: Room, cx: number, cy: number): void {
  placeRoomFeature(world, room, Feature.CHAIR, cx - 1, cy);
  placeRoomFeature(world, room, Feature.CHAIR, cx + 1, cy);
  placeRoomFeature(world, room, Feature.CHAIR, cx, cy - 1);
  placeRoomFeature(world, room, Feature.CHAIR, cx, cy + 1);
}

function decorateCitizenKitchen(world: World, room: Room, index: number, spec: ProceduralFloorSpec): void {
  room.type = RoomType.KITCHEN;
  room.name = index === 0 ? `Общая кухня ${room.id}` : `Пайковая кухня ${room.id}`;
  const cx = Math.floor(room.w / 2);
  const cy = Math.floor(room.h / 2);
  placeRoomFeature(world, room, Feature.STOVE, 1, 1);
  placeRoomFeature(world, room, Feature.SINK, room.w - 2, 1);
  placeRoomFeature(world, room, Feature.TABLE, cx, cy);
  placeCitizenSeating(world, room, cx, cy);
  const center = roomCenter(room);
  stampSurfaceSplat(world, center.x, center.y, 0.5, 0.5, 0.3, 0.48, spec.seed + room.id * 97, 155, 126, 78, false);
}

function decorateCitizenShelter(world: World, room: Room, index: number, spec: ProceduralFloorSpec): void {
  room.name = index === 0 ? `Гражданское укрытие ${room.id}` : `Тихая ниша укрытия ${room.id}`;
  placeRoomFeature(world, room, Feature.BED, 1, room.h - 2);
  placeRoomFeature(world, room, Feature.TABLE, Math.floor(room.w / 2), Math.floor(room.h / 2));
  placeRoomFeature(world, room, Feature.LAMP, room.w - 2, 1);
  placeRoomFeature(world, room, Feature.SCREEN, 1, 1);
  const center = roomCenter(room);
  stampSurfaceSplat(world, center.x, center.y, 0.5, 0.5, 0.34, 0.52, spec.seed + room.id * 113, 92, 128, 86, false);
}

function decorateCitizenWitnessPocket(world: World, room: Room, index: number, spec: ProceduralFloorSpec): void {
  room.name = index === 0 ? `Свидетельский карман ${room.id}` : `Общий зал свидетелей ${room.id}`;
  const cx = Math.floor(room.w / 2);
  const cy = Math.floor(room.h / 2);
  placeRoomFeature(world, room, Feature.TABLE, cx, cy);
  placeCitizenSeating(world, room, cx, cy);
  placeRoomFeature(world, room, index % 2 === 0 ? Feature.LAMP : Feature.SCREEN, 1, 1);
  const center = roomCenter(room);
  stampSurfaceSplat(world, center.x, center.y, 0.5, 0.5, 0.26, 0.44, spec.seed + room.id * 131, 132, 116, 96, false);
}


function applyVoidFillers(world: World, rooms: Room[]): void {
  const blockSize = 11;
  const roomW = 7;
  const roomH = 7;
  const step = 8;
  const maxVoids = 30;
  let filled = 0;

  for (let y = 10; y < W - 10 - blockSize; y += step) {
    for (let x = 10; x < W - 10 - blockSize; x += step) {
      if (filled >= maxVoids) return;

      let isVoid = true;
      for (let dy = 0; dy < blockSize; dy++) {
        for (let dx = 0; dx < blockSize; dx++) {
          const ci = world.idx(x + dx, y + dy);
          if (world.cells[ci] !== Cell.WALL || world.aptMask[ci] || world.roomMap[ci] !== -1) {
            isVoid = false;
            break;
          }
        }
        if (!isVoid) break;
      }

      if (isVoid) {
        const cx = x + Math.floor(blockSize / 2);
        const cy = y + Math.floor(blockSize / 2);

        let nearestRoom: Room | null = null;
        let bestDist = Infinity;
        for (const room of rooms) {
          const rx = room.x + Math.floor(room.w / 2);
          const ry = room.y + Math.floor(room.h / 2);
          const d = Math.abs(cx - rx) + Math.abs(cy - ry);
          if (d < bestDist) {
            bestDist = d;
            nearestRoom = room;
          }
        }

        if (nearestRoom && bestDist < W / 2) {
          const rx = x + Math.floor((blockSize - roomW) / 2);
          const ry = y + Math.floor((blockSize - roomH) / 2);
          const roomType = chance(0.5) ? RoomType.STORAGE : RoomType.CORRIDOR;
          const room = stampRoom(world, rooms.length, roomType, rx, ry, roomW, roomH, -1);
          rooms.push(room);
          carveCorridor(world, cx, cy, nearestRoom.x + Math.floor(nearestRoom.w / 2), nearestRoom.y + Math.floor(nearestRoom.h / 2));
          filled++;
        }
      }
    }
  }
}

function applyCitizenMajorityPublicLayer(world: World, rooms: Room[], spec: ProceduralFloorSpec): void {
  if (spec.majorityId !== 'citizens') return;
  const candidates = citizenMajorityCandidates(rooms);
  const used = new Set<number>();
  const kitchens = citizenPickRooms(
    [
      ...candidates.filter(room => room.type === RoomType.KITCHEN),
      ...candidates.filter(room => room.type === RoomType.COMMON || room.type === RoomType.LIVING || room.type === RoomType.STORAGE),
    ],
    Math.min(4, Math.max(2, Math.floor(candidates.length / 14))),
    used,
  );
  const shelters = citizenPickRooms(
    candidates.filter(room => room.type === RoomType.COMMON || room.type === RoomType.LIVING || room.type === RoomType.STORAGE),
    Math.min(3, Math.max(1, Math.floor(candidates.length / 24))),
    used,
  );
  const witnesses = citizenPickRooms(
    candidates.filter(room => room.type === RoomType.COMMON || room.type === RoomType.SMOKING || room.type === RoomType.CORRIDOR || room.type === RoomType.LIVING),
    Math.min(5, Math.max(2, Math.floor(candidates.length / 16))),
    used,
  );

  for (let i = 0; i < kitchens.length; i++) decorateCitizenKitchen(world, kitchens[i], i, spec);
  for (let i = 0; i < shelters.length; i++) decorateCitizenShelter(world, shelters[i], i, spec);
  for (let i = 0; i < witnesses.length; i++) decorateCitizenWitnessPocket(world, witnesses[i], i, spec);

  const loopRooms = [...kitchens, ...shelters, ...witnesses];
  if (loopRooms.length >= 2) {
    const edges = Math.min(6, Math.max(2, Math.floor(loopRooms.length / 2)));
    const offset = Math.max(1, Math.floor(loopRooms.length / 2));
    for (let i = 0; i < edges; i++) {
      const a = loopRooms[(i * 2 + spec.seed) % loopRooms.length];
      const b = loopRooms[(i * 2 + offset + spec.danger) % loopRooms.length];
      if (!a || !b || a.id === b.id) continue;
      carveCommunalChord(world, spec, a, b, 40 + i, true);
    }
  }
}

function addCitizenMajorityContainer(
  world: World,
  spec: ProceduralFloorSpec,
  room: Room,
  pos: { x: number; y: number },
  kind: ContainerKind,
  inventory: readonly Item[],
  name: string,
  access: WorldContainer['access'],
  tags: readonly string[],
): void {
  if (inventory.length === 0 || world.containersAt(pos.x, pos.y).length > 0) return;
  const def = CONTAINER_DEFS[kind];
  world.addContainer({
    id: nextContainerId(world),
    x: pos.x,
    y: pos.y,
    floor: spec.baseFloor,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(pos.x, pos.y)],
    kind,
    name,
    inventory: cloneItems(inventory),
    capacitySlots: def.capacitySlots,
    ownerName: access === 'owner' ? 'соседская очередь' : undefined,
    faction: access === 'owner' || access === 'faction' ? Faction.CITIZEN : undefined,
    access,
    discovered: access !== 'secret',
    tags: uniqueTags(['procedural_floor', 'citizens', spec.geometryId, spec.anomalyId, ...tags]),
  });
}

function citizenCueCell(world: World, room: Room): { x: number; y: number } | null {
  const cx = Math.floor(room.w / 2);
  const cy = Math.floor(room.h / 2);
  let best: { x: number; y: number; d2: number } | null = null;
  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const ci = world.idx(x, y);
      if (world.cells[ci] !== Cell.FLOOR || world.roomMap[ci] !== room.id) continue;
      const d2 = (dx - cx) * (dx - cx) + (dy - cy) * (dy - cy);
      if (!best || d2 < best.d2) best = { x, y, d2 };
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

function registerCitizenEscortCue(world: World, spec: ProceduralFloorSpec, markerRoom: Room, targetRoom: Room): void {
  const marker = citizenCueCell(world, markerRoom);
  const target = citizenCueCell(world, targetRoom);
  if (!marker || !target) return;
  const markerCell = world.idx(marker.x, marker.y);
  if (world.features[markerCell] === Feature.NONE) world.features[markerCell] = Feature.LAMP;
  registerRouteCue(world, {
    id: `procedural_${spec.key}_citizen_escort`,
    x: marker.x + 0.5,
    y: marker.y + 0.5,
    targetX: target.x + 0.5,
    targetY: target.y + 0.5,
    floor: spec.baseFloor,
    roomId: markerRoom.id,
    targetRoomId: targetRoom.id,
    zoneId: world.zoneMap[markerCell],
    label: 'соседская цепочка',
    hint: 'жильцы зовут к общему укрытию',
    targetName: targetRoom.name,
    color: '#ffd38a',
    tags: ['procedural_floor', 'citizens', 'escort', 'shelter', 'public_loop', spec.geometryId, spec.anomalyId],
    toneSeed: (spec.seed ^ markerRoom.id * 67 ^ targetRoom.id * 131) >>> 0,
    radius: 10,
    targetRadius: 3,
    cooldownSec: 45,
    heardText: 'Соседи стучат по батарее: кто-то собирает цепочку до общего укрытия.',
    followedText: 'Соседская цепочка вывела к укрытию. Здесь можно переждать, помочь запасом или уйти дальше.',
    ignoredText: 'Соседская цепочка осталась за стеной. Укрытие дождется другого проводника.',
  });
}

function placeCitizenMajorityLandmarks(world: World, rooms: Room[], spec: ProceduralFloorSpec, reachable: Uint8Array): void {
  if (spec.majorityId !== 'citizens') return;
  const kitchenRoom = rooms.find(room => room.name.startsWith('Общая кухня') || room.name.startsWith('Пайковая кухня'))
    ?? rooms.find(room => room.type === RoomType.KITCHEN)
    ?? rooms[0];
  const shelterRoom = rooms.find(room => room.name.startsWith('Гражданское укрытие') || room.name.startsWith('Тихая ниша укрытия'))
    ?? rooms.find(room => room.type === RoomType.COMMON)
    ?? kitchenRoom;
  const witnessRoom = rooms.find(room =>
    room.id !== shelterRoom?.id &&
    (room.name.startsWith('Свидетельский карман') || room.name.startsWith('Общий зал свидетелей')))
    ?? rooms.find(room => room.id !== shelterRoom?.id && (room.type === RoomType.COMMON || room.type === RoomType.SMOKING))
    ?? rooms.find(room => room.id !== shelterRoom?.id && room.id !== 0)
    ?? kitchenRoom;

  const supply = shelterRoom ? findReachableContainerCell(world, rooms, reachable, spec.seed ^ 0xc171, shelterRoom) : null;
  if (supply) addCitizenMajorityContainer(
    world,
    spec,
    supply.room,
    supply,
    ContainerKind.EMERGENCY_BOX,
    CITIZEN_PUBLIC_SUPPLY_ITEMS,
    'Общий запас гражданского укрытия',
    'public',
    ['shelter', 'hide', 'share_supplies', 'resident_relief', 'public_supply'],
  );

  const trade = kitchenRoom ? findReachableContainerCell(world, rooms, reachable, spec.seed ^ 0xc172, kitchenRoom) : null;
  if (trade) addCitizenMajorityContainer(
    world,
    spec,
    trade.room,
    trade,
    ContainerKind.CASHBOX,
    CITIZEN_TRADE_ITEMS,
    'Стол обмена жильцов',
    'owner',
    ['trade', 'buyable', 'witness', 'public_service'],
  );

  const theft = witnessRoom ? findReachableContainerCell(world, rooms, reachable, spec.seed ^ 0xc173, witnessRoom) : null;
  if (theft) addCitizenMajorityContainer(
    world,
    spec,
    theft.room,
    theft,
    ContainerKind.WOODEN_CHEST,
    CITIZEN_WITNESS_THEFT_ITEMS,
    'Чужой сундук под взглядами',
    'owner',
    ['theft', 'witness', 'audit_risk', 'steal_with_witnesses'],
  );

  if (witnessRoom && shelterRoom && witnessRoom.id !== shelterRoom.id) registerCitizenEscortCue(world, spec, witnessRoom, shelterRoom);
}

function scientistMajorityRoomScore(world: World, room: Room, spawnX: number, spawnY: number, seed: number): number {
  const center = roomCenter(room);
  const area = room.w * room.h;
  const distance = Math.min(240 * 240, world.dist2(spawnX, spawnY, center.x, center.y)) / 900;
  const typeBonus = room.type === RoomType.OFFICE ? 70
    : room.type === RoomType.STORAGE ? 58
      : room.type === RoomType.PRODUCTION ? 52
        : room.type === RoomType.COMMON ? 36
          : room.type === RoomType.CORRIDOR ? 18
            : 0;
  return area + distance + typeBonus + serviceHash01(seed, room.id, area, 48) * 24;
}

function scientistMajorityLabRooms(world: World, rooms: Room[], spec: ProceduralFloorSpec, spawnX: number, spawnY: number): Room[] {
  return rooms
    .filter(room => room.id !== 0 && room.w >= 6 && room.h >= 5 && room.type !== RoomType.BATHROOM)
    .sort((a, b) =>
      scientistMajorityRoomScore(world, b, spawnX, spawnY, spec.seed) -
      scientistMajorityRoomScore(world, a, spawnX, spawnY, spec.seed),
    );
}

function setScientistRoomTextures(world: World, room: Room, wallTex: Tex, floorTex: Tex): void {
  applyRoomTexture(world, room, wallTex, floorTex);
  for (const doorIdx of room.doors) {
    if (world.cells[doorIdx] === Cell.DOOR) world.wallTex[doorIdx] = Tex.DOOR_METAL;
  }
}

function decorateScientistCleanDirtyRoom(world: World, room: Room, spec: ProceduralFloorSpec, index: number, sealed: boolean): void {
  const vertical = ((spec.seed + room.id + index) & 1) === 0;
  const cleanLimit = vertical
    ? Math.max(2, Math.min(room.w - 2, Math.floor(room.w * (0.42 + serviceHash01(spec.seed, room.id, index, 51) * 0.18))))
    : Math.max(2, Math.min(room.h - 2, Math.floor(room.h * (0.42 + serviceHash01(spec.seed, room.id, index, 53) * 0.18))));
  const dirtyFloor = sealed || ((room.id + spec.seed) & 1) === 0 ? Tex.F_CONCRETE : Tex.F_GUT;

  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const ci = world.idx(x, y);
      if (world.roomMap[ci] !== room.id || (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER)) continue;
      const clean = vertical ? dx < cleanLimit : dy < cleanLimit;
      world.floorTex[ci] = clean ? Tex.F_TILE : dirtyFloor;

      const border = vertical ? Math.abs(dx - cleanLimit) <= 1 : Math.abs(dy - cleanLimit) <= 1;
      if (border && world.features[ci] === Feature.NONE && ((dx + dy + index) & 1) === 0) {
        world.features[ci] = clean ? Feature.SCREEN : Feature.APPARATUS;
      } else if (world.features[ci] === Feature.NONE && ((dx * 17 + dy * 31 + spec.seed + index) % 29 === 0)) {
        world.features[ci] = clean
          ? (room.type === RoomType.OFFICE ? Feature.DESK : Feature.SHELF)
          : Feature.APPARATUS;
      }

      if (!clean && ((dx * 19 + dy * 23 + spec.seed + room.id) % 23 === 0)) {
        stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.25, 0.48, spec.seed + room.id * 113 + dx * 7 + dy, 72, 116, 86, false);
      }
    }
  }
}

function canSealScientistOptionalRoom(room: Room): boolean {
  return room.doors.length > 0 && room.doors.length <= 1;
}

function sealScientistOptionalRoom(world: World, room: Room): void {
  room.sealed = true;
  for (const doorIdx of room.doors) {
    const door = world.doors.get(doorIdx);
    setDoorState(world, door, DoorState.HERMETIC_CLOSED);
    if (world.cells[doorIdx] === Cell.DOOR) world.wallTex[doorIdx] = Tex.DOOR_METAL;
  }
}

function decorateScientistSampleCorridors(world: World, rooms: Room[], spec: ProceduralFloorSpec): void {
  const corridorRooms = rooms
    .filter(room => room.type === RoomType.CORRIDOR && room.w >= 5 && room.h >= 5)
    .sort((a, b) => (b.w * b.h) - (a.w * a.h));
  const fallbackRooms = rooms
    .filter(room =>
      room.id !== 0 &&
      !room.name.includes('НИИ') &&
      !room.sealed &&
      room.w >= 7 &&
      room.h >= 5 &&
      room.type !== RoomType.BATHROOM,
    )
    .sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));
  const corridors = corridorRooms.length > 0 ? corridorRooms : fallbackRooms;
  const count = Math.min(corridors.length, 2 + Math.floor(spec.danger / 2));

  for (let i = 0; i < count; i++) {
    const room = corridors[(spec.seed + i * 3) % corridors.length];
    room.name = `Пробный коридор НИИ ${room.id}`;
    setScientistRoomTextures(world, room, Tex.TILE_W, Tex.F_CONCRETE);
    const horizontal = room.w >= room.h;
    const lane = horizontal ? Math.floor(room.h / 2) : Math.floor(room.w / 2);
    const length = horizontal ? room.w : room.h;
    for (let p = 1; p < length - 1; p++) {
      const x = world.wrap(room.x + (horizontal ? p : lane));
      const y = world.wrap(room.y + (horizontal ? lane : p));
      const ci = world.idx(x, y);
      if (world.roomMap[ci] !== room.id || world.cells[ci] !== Cell.FLOOR) continue;
      world.floorTex[ci] = p % 5 === 0 ? Tex.F_TILE : Tex.F_CONCRETE;
      if (p % 9 === 0 && world.features[ci] === Feature.NONE) world.features[ci] = Feature.APPARATUS;
      if (p % 13 === 0) stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.22, 0.4, spec.seed + i * 997 + p, 96, 132, 110, false);
    }
  }
}

function applyScientistMajority(world: World, rooms: Room[], spec: ProceduralFloorSpec, spawnX: number, spawnY: number): void {
  if (spec.majorityId !== 'scientists') return;
  const candidates = scientistMajorityLabRooms(world, rooms, spec, spawnX, spawnY);
  const target = Math.min(candidates.length, 5 + spec.danger);
  let sealedCount = 0;

  for (let i = 0; i < target; i++) {
    const room = candidates[i];
    const seal = sealedCount < 2 && i > 0 && canSealScientistOptionalRoom(room);
    const mode = i % 4;
    if (mode === 0) {
      room.type = RoomType.MEDICAL;
      room.name = `Чистая лабораторная ячейка ${room.id}`;
      setScientistRoomTextures(world, room, Tex.TILE_W, Tex.F_TILE);
    } else if (mode === 1) {
      room.type = RoomType.MEDICAL;
      room.name = seal ? `Гермоклетка НИИ ${room.id}` : `Карантинная ячейка НИИ ${room.id}`;
      setScientistRoomTextures(world, room, Tex.TILE_W, Tex.F_TILE);
    } else if (mode === 2) {
      room.type = RoomType.PRODUCTION;
      room.name = `Грязная пробная НИИ ${room.id}`;
      setScientistRoomTextures(world, room, Tex.PIPE, Tex.F_CONCRETE);
    } else {
      room.type = RoomType.OFFICE;
      room.name = `Обзорная НИИ ${room.id}`;
      setScientistRoomTextures(world, room, Tex.METAL, Tex.F_TILE);
    }
    if (seal) {
      room.type = RoomType.MEDICAL;
      room.name = `Гермоклетка НИИ ${room.id}`;
      setScientistRoomTextures(world, room, Tex.TILE_W, Tex.F_TILE);
    }
    decorateScientistCleanDirtyRoom(world, room, spec, i, seal);
    if (seal) {
      sealScientistOptionalRoom(world, room);
      sealedCount++;
    }
  }

  decorateScientistSampleCorridors(world, rooms, spec);
}

function placeScientistMajorityLandmarks(world: World, rooms: Room[], spec: ProceduralFloorSpec, reachable: Uint8Array): void {
  if (spec.majorityId !== 'scientists') return;
  const labs = rooms.filter(room =>
    room.name.startsWith('Чистая лабораторная ячейка') ||
    room.name.startsWith('Карантинная ячейка') ||
    room.name.startsWith('Гермоклетка') ||
    room.name.startsWith('Грязная пробная') ||
    room.name.startsWith('Обзорная НИИ'),
  );
  const sampleRoom = labs.find(room => room.name.startsWith('Гермоклетка')) ?? labs.find(room => room.type === RoomType.MEDICAL) ?? labs[0];
  const medicineRoom = labs.find(room => room.name.startsWith('Чистая лабораторная')) ?? sampleRoom;
  const observationRoom = labs.find(room => room.name.startsWith('Обзорная НИИ')) ?? labs[labs.length - 1] ?? sampleRoom;

  const sample = sampleRoom ? findReachableContainerCell(world, rooms, reachable, spec.seed ^ 0x4801, sampleRoom) : null;
  if (sample) {
    addProceduralLootContainer(
      world,
      spec,
      sample.room,
      sample,
      ContainerKind.MEDICAL_CABINET,
      SCIENTIST_SAMPLE_CACHE_ITEMS.map(item => ({ ...item })),
      ['scientist_majority_lab', 'harvest_sample', 'expose_lab', 'sample_audit'],
      'Карантинный шкаф проб НИИ',
    );
  }

  const medicine = medicineRoom ? findReachableContainerCell(world, rooms, reachable, spec.seed ^ 0x4802, medicineRoom) : null;
  if (medicine) {
    addProceduralLootContainer(
      world,
      spec,
      medicine.room,
      medicine,
      ContainerKind.MEDICAL_CABINET,
      SCIENTIST_MEDICINE_CACHE_ITEMS.map(item => ({ ...item })),
      ['scientist_majority_lab', 'steal_medicine', 'sample_audit', 'medicine_theft'],
      'Медицинский шкаф смены НИИ',
    );
  }

  const observation = observationRoom ? findReachableContainerCell(world, rooms, reachable, spec.seed ^ 0x4803, observationRoom) : null;
  if (observation) {
    addProceduralLootContainer(
      world,
      spec,
      observation.room,
      observation,
      ContainerKind.FILING_CABINET,
      SCIENTIST_OBSERVATION_CACHE_ITEMS.map(item => ({ ...item })),
      ['scientist_majority_lab', 'observation_log', 'expose_lab', 'sample_audit'],
      'Журнал обзорной НИИ',
    );
  }
}

const LIVING_BLOCK_PROXY_SIZE = 64;
const LIVING_BLOCK_PROXY_CELL = W / LIVING_BLOCK_PROXY_SIZE;
const LIVING_BLOCK_MARGIN = 48;
const LIVING_BLOCK_GRID_COLUMNS = 8;
const LIVING_BLOCK_MIN_TARGET_ROOMS = 940;
const LIVING_BLOCK_TARGET_ROOMS_PER_DANGER = 110;
const LIVING_BLOCK_HQ_RESERVE_RADIUS2 = 82 * 82;

interface LivingBlock {
  id: number;
  corridorStartX: number;
  corridorEndX: number;
  corridorY: number;
  centerX: number;
  centerY: number;
  rooms: Room[];
  homeRoom?: Room;
  publicRoom?: Room;
  serviceRoom?: Room;
  shelterRoom?: Room;
}

interface LivingRoutePoint {
  x: number;
  y: number;
}

interface LivingHeapNode {
  idx: number;
  priority: number;
}

function livingHeapPush(heap: LivingHeapNode[], node: LivingHeapNode): void {
  heap.push(node);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p].priority <= node.priority) break;
    heap[i] = heap[p];
    i = p;
  }
  heap[i] = node;
}

function livingHeapPop(heap: LivingHeapNode[]): LivingHeapNode | undefined {
  if (heap.length === 0) return undefined;
  const top = heap[0];
  const last = heap.pop()!;
  if (heap.length === 0) return top;
  let i = 0;
  while (true) {
    const l = i * 2 + 1;
    const r = l + 1;
    if (l >= heap.length) break;
    const child = r < heap.length && heap[r].priority < heap[l].priority ? r : l;
    if (heap[child].priority >= last.priority) break;
    heap[i] = heap[child];
    i = child;
  }
  heap[i] = last;
  return top;
}

function livingProxyCoord(value: number): number {
  return Math.max(0, Math.min(LIVING_BLOCK_PROXY_SIZE - 1, Math.floor(value / LIVING_BLOCK_PROXY_CELL)));
}

function livingProxyIndex(px: number, py: number): number {
  return py * LIVING_BLOCK_PROXY_SIZE + px;
}

function livingProxyWorld(px: number): number {
  return Math.max(2, Math.min(W - 3, Math.floor(px * LIVING_BLOCK_PROXY_CELL + LIVING_BLOCK_PROXY_CELL / 2)));
}

function livingMutableCell(world: World, ci: number): boolean {
  return world.cells[ci] !== Cell.LIFT &&
    world.hermoWall[ci] === 0 &&
    world.aptMask[ci] === 0 &&
    world.features[ci] !== Feature.LIFT_BUTTON &&
    !world.containerMap.has(ci);
}

function livingProxyCost(world: World, px: number, py: number): number {
  const cx = livingProxyWorld(px);
  const cy = livingProxyWorld(py);
  let cost = 1.2;
  let sampled = 0;
  for (const [dx, dy] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]] as const) {
    const ci = world.idx(cx + dx, cy + dy);
    if (!livingMutableCell(world, ci)) return Number.POSITIVE_INFINITY;
    sampled++;
    const cell = world.cells[ci];
    if (world.roomMap[ci] >= 0) cost += 8.5;
    else if (cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.WATER) cost += 2.3;
    else cost += 0.6;
  }
  return cost / Math.max(1, sampled);
}

function livingWeightedProxyPath(world: World, from: LivingRoutePoint, to: LivingRoutePoint): LivingRoutePoint[] {
  const size = LIVING_BLOCK_PROXY_SIZE;
  const n = size * size;
  const startX = livingProxyCoord(from.x);
  const startY = livingProxyCoord(from.y);
  const goalX = livingProxyCoord(to.x);
  const goalY = livingProxyCoord(to.y);
  const start = livingProxyIndex(startX, startY);
  const goal = livingProxyIndex(goalX, goalY);
  const dist = new Float32Array(n);
  const prev = new Int32Array(n);
  const closed = new Uint8Array(n);
  dist.fill(Number.POSITIVE_INFINITY);
  prev.fill(-1);
  dist[start] = 0;
  const heap: LivingHeapNode[] = [];
  livingHeapPush(heap, { idx: start, priority: Math.abs(startX - goalX) + Math.abs(startY - goalY) });

  while (heap.length > 0) {
    const current = livingHeapPop(heap)!;
    const ci = current.idx;
    if (closed[ci]) continue;
    closed[ci] = 1;
    if (ci === goal) break;
    const cx = ci % size;
    const cy = (ci / size) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const ni = livingProxyIndex(nx, ny);
      if (closed[ni]) continue;
      const stepCost = livingProxyCost(world, nx, ny);
      if (!Number.isFinite(stepCost)) continue;
      const nextDist = dist[ci] + stepCost;
      if (nextDist >= dist[ni]) continue;
      dist[ni] = nextDist;
      prev[ni] = ci;
      const heuristic = Math.abs(nx - goalX) + Math.abs(ny - goalY);
      livingHeapPush(heap, { idx: ni, priority: nextDist + heuristic });
    }
  }

  if (!Number.isFinite(dist[goal])) return [from, to];
  const reversed: number[] = [];
  for (let at = goal; at >= 0; at = prev[at]) {
    reversed.push(at);
    if (at === start) break;
  }
  const points: LivingRoutePoint[] = [from];
  for (let i = reversed.length - 2; i > 0; i--) {
    const idx = reversed[i];
    points.push({ x: livingProxyWorld(idx % size), y: livingProxyWorld((idx / size) | 0) });
  }
  points.push(to);
  return points;
}

function carveLivingRouteCell(world: World, x: number, y: number, floorTex: Tex, wallTex: Tex): boolean {
  const ci = world.idx(x, y);
  if (!livingMutableCell(world, ci)) return false;
  if (world.cells[ci] === Cell.DOOR || world.doors.has(ci)) return true;
  world.cells[ci] = Cell.FLOOR;
  world.floorTex[ci] = floorTex;
  world.wallTex[ci] = wallTex;
  world.roomMap[ci] = -1;
  world.features[ci] = Feature.NONE;
  return true;
}

function carveLivingRouteBand(
  world: World,
  x: number,
  y: number,
  horizontal: boolean,
  radius: number,
  floorTex: Tex,
  wallTex: Tex,
  spec: ProceduralFloorSpec,
  step: number,
  service: boolean,
): void {
  let opened = false;
  for (let side = -radius; side <= radius; side++) {
    const cx = horizontal ? x : x + side;
    const cy = horizontal ? y + side : y;
    opened = carveLivingRouteCell(world, cx, cy, floorTex, wallTex) || opened;
  }
  if (!opened) return;
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR || world.features[ci] !== Feature.NONE) return;
  if (service && step % 31 === 0) world.features[ci] = step % 62 === 0 ? Feature.APPARATUS : Feature.SCREEN;
  else if (!service && step % 43 === 0) world.features[ci] = Feature.LAMP;
  if (step % 59 === 0) {
    stampSurfaceSplat(world, x, y, 0.5, 0.5, service ? 0.22 : 0.3, service ? 0.38 : 0.44, spec.seed ^ (step * 97), service ? 84 : 164, service ? 92 : 130, service ? 98 : 92, false);
  }
}

function carveLivingRouteSegment(
  world: World,
  spec: ProceduralFloorSpec,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  horizontal: boolean,
  radius: number,
  floorTex: Tex,
  wallTex: Tex,
  stepBase: number,
  service: boolean,
): number {
  const delta = horizontal ? world.delta(ax, bx) : world.delta(ay, by);
  const stepDir = delta >= 0 ? 1 : -1;
  const steps = Math.abs(delta);
  let x = world.wrap(ax);
  let y = world.wrap(ay);
  for (let s = 0; s <= steps; s++) {
    carveLivingRouteBand(world, x, y, horizontal, radius, floorTex, wallTex, spec, stepBase + s, service);
    if (s < steps) {
      if (horizontal) x = world.wrap(x + stepDir);
      else y = world.wrap(y + stepDir);
    }
  }
  return stepBase + steps + 1;
}

function carveLivingWeightedRoute(
  world: World,
  spec: ProceduralFloorSpec,
  from: LivingRoutePoint,
  to: LivingRoutePoint,
  radius: number,
  floorTex: Tex,
  wallTex: Tex,
  seed: number,
  service: boolean,
): void {
  const points = livingWeightedProxyPath(world, from, to);
  let step = seed & 4095;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const horizontalFirst = Math.abs(world.delta(a.x, b.x)) >= Math.abs(world.delta(a.y, b.y));
    if (horizontalFirst) {
      step = carveLivingRouteSegment(world, spec, a.x, a.y, b.x, a.y, true, radius, floorTex, wallTex, step, service);
      step = carveLivingRouteSegment(world, spec, b.x, a.y, b.x, b.y, false, radius, floorTex, wallTex, step, service);
    } else {
      step = carveLivingRouteSegment(world, spec, a.x, a.y, a.x, b.y, false, radius, floorTex, wallTex, step, service);
      step = carveLivingRouteSegment(world, spec, a.x, b.y, b.x, b.y, true, radius, floorTex, wallTex, step, service);
    }
  }
}

function livingBlockRoomType(column: number, south: boolean): RoomType {
  const north = [RoomType.LIVING, RoomType.KITCHEN, RoomType.LIVING, RoomType.BATHROOM, RoomType.STORAGE, RoomType.COMMON] as const;
  const southRow = [RoomType.LIVING, RoomType.STORAGE, RoomType.KITCHEN, RoomType.LIVING, RoomType.BATHROOM, RoomType.COMMON] as const;
  const row = south ? southRow : north;
  return row[column % row.length];
}

function livingBlockRoomName(blockId: number, type: RoomType, ordinal: number): string {
  if (type === RoomType.KITCHEN) return `Домовой блок ${blockId}: кухня ${ordinal}`;
  if (type === RoomType.BATHROOM) return `Домовой блок ${blockId}: санузел ${ordinal}`;
  if (type === RoomType.STORAGE) return `Домовой блок ${blockId}: кладовая ${ordinal}`;
  if (type === RoomType.COMMON) return `Домовой блок ${blockId}: общий тамбур ${ordinal}`;
  return `Домовой блок ${blockId}: квартира ${ordinal}`;
}

function stampLivingBlockRoom(
  world: World,
  rooms: Room[],
  block: LivingBlock,
  spec: ProceduralFloorSpec,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  ordinal: number,
): Room | null {
  if (!canPlaceRoom(world, x, y, w, h)) return null;
  const room = stampRoom(world, rooms.length, type, x, y, w, h, -1);
  room.name = livingBlockRoomName(block.id, type, ordinal);
  applyRoomTexture(world, room, Tex.PANEL, Tex.F_LINO);
  decorateProceduralRoom(world, room, spec);
  if (type === RoomType.LIVING) {
    placeRoomFeature(world, room, Feature.BED, 1, h - 2);
    placeRoomFeature(world, room, Feature.CHAIR, w - 2, h - 2);
    block.homeRoom ??= room;
  } else if (type === RoomType.KITCHEN) {
    placeRoomFeature(world, room, Feature.STOVE, 1, 1);
    placeRoomFeature(world, room, Feature.SINK, w - 2, 1);
  } else if (type === RoomType.BATHROOM) {
    placeRoomFeature(world, room, Feature.TOILET, 1, 1);
    placeRoomFeature(world, room, Feature.SINK, w - 2, 1);
  } else if (type === RoomType.STORAGE) {
    placeRoomFeature(world, room, Feature.SHELF, 1, 1);
    block.serviceRoom ??= room;
    block.shelterRoom ??= room;
  } else if (type === RoomType.COMMON) {
    placeRoomFeature(world, room, Feature.TABLE, Math.floor(w / 2), Math.floor(h / 2));
    block.publicRoom ??= room;
  }
  rooms.push(room);
  block.rooms.push(room);
  return room;
}

function carveLivingInternalCorridor(world: World, block: LivingBlock, spec: ProceduralFloorSpec): void {
  for (let x = block.corridorStartX; x <= block.corridorEndX; x++) {
    for (let y = block.corridorY; y < block.corridorY + 3; y++) {
      carveLivingRouteCell(world, x, y, Tex.F_TILE, Tex.PANEL);
    }
    if ((x + block.id * 17) % 47 === 0) {
      const ci = world.idx(x, block.corridorY + 1);
      if (world.cells[ci] === Cell.FLOOR && world.features[ci] === Feature.NONE) world.features[ci] = Feature.LAMP;
      stampSurfaceSplat(world, x, block.corridorY + 1, 0.5, 0.5, 0.22, 0.34, spec.seed + block.id * 911 + x, 156, 124, 88, false);
    }
  }
}

function connectLivingBlockRoomsToCorridor(world: World, block: LivingBlock): void {
  for (const room of block.rooms) {
    const doorX = room.x + Math.floor(room.w / 2);
    if (room.y < block.corridorY) placeDoorAt(world, doorX, room.y + room.h, room.id);
    else placeDoorAt(world, doorX, room.y - 1, room.id);
  }
}

function buildLivingBlockAt(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  id: number,
  x: number,
  y: number,
  targetColumns: number,
): LivingBlock {
  const topH = irng(7, 9);
  const bottomH = irng(7, 10);
  const corridorY = y + topH + 1;
  const block: LivingBlock = {
    id,
    corridorStartX: x,
    corridorEndX: x,
    corridorY,
    centerX: x,
    centerY: corridorY + 1,
    rooms: [],
  };
  let cx = x;
  let ordinal = 1;
  for (let col = 0; col < targetColumns; col++) {
    const rw = irng(8, 13);
    stampLivingBlockRoom(world, rooms, block, spec, livingBlockRoomType(col, false), cx, y, rw, topH, ordinal++);
    stampLivingBlockRoom(world, rooms, block, spec, livingBlockRoomType(col + id, true), cx, corridorY + 4, rw, bottomH, ordinal++);
    cx += rw + irng(3, 4);
  }
  block.corridorStartX = x - 2;
  block.corridorEndX = cx - 2;
  block.centerX = Math.floor((block.corridorStartX + block.corridorEndX) / 2);
  carveLivingInternalCorridor(world, block, spec);
  connectLivingBlockRoomsToCorridor(world, block);
  return block;
}

function livingHqReserveCenters(): readonly { x: number; y: number }[] {
  return PROCEDURAL_HQ_OWNERS.map(owner => proceduralHqBase(owner));
}

function livingSlotReservedForHq(world: World, x: number, y: number): boolean {
  for (const reserve of livingHqReserveCenters()) {
    if (world.dist2(x + 0.5, y + 0.5, reserve.x + 0.5, reserve.y + 0.5) <= LIVING_BLOCK_HQ_RESERVE_RADIUS2) return true;
  }
  return false;
}

function chooseLivingShelterBlock(blocks: readonly LivingBlock[], spawn: LivingRoutePoint, world: World): LivingBlock | undefined {
  let best: LivingBlock | undefined;
  let bestD2 = -1;
  for (const block of blocks) {
    if (!block.shelterRoom) continue;
    const d2 = world.dist2(spawn.x, spawn.y, block.centerX + 0.5, block.centerY + 0.5);
    if (d2 > bestD2) {
      bestD2 = d2;
      best = block;
    }
  }
  return best;
}

function farthestLivingBlockPair(blocks: readonly LivingBlock[], world: World): [LivingBlock, LivingBlock] | null {
  let best: [LivingBlock, LivingBlock] | null = null;
  let bestD2 = -1;
  for (let a = 0; a < blocks.length; a++) {
    for (let b = a + 1; b < blocks.length; b++) {
      const d2 = world.dist2(blocks[a].centerX + 0.5, blocks[a].centerY + 0.5, blocks[b].centerX + 0.5, blocks[b].centerY + 0.5);
      if (d2 > bestD2) {
        bestD2 = d2;
        best = [blocks[a], blocks[b]];
      }
    }
  }
  return best;
}

function roomPoint(room: Room): LivingRoutePoint {
  return { x: room.x + Math.floor(room.w / 2), y: room.y + Math.floor(room.h / 2) };
}

function decorateLivingShelterSpur(world: World, room: Room, spec: ProceduralFloorSpec): void {
  room.name = `Убежищный отросток блока ${room.id}`;
  placeRoomFeature(world, room, Feature.BED, 1, room.h - 2);
  placeRoomFeature(world, room, Feature.APPARATUS, Math.floor(room.w / 2), Math.floor(room.h / 2));
  placeRoomFeature(world, room, Feature.LAMP, room.w - 2, 1);
  const center = roomCenter(room);
  stampSurfaceSplat(world, center.x, center.y, 0.5, 0.5, 0.36, 0.52, spec.seed ^ (room.id * 733), 112, 132, 116, false);
}

function registerLivingCue(
  world: World,
  spec: ProceduralFloorSpec,
  id: string,
  marker: LivingRoutePoint,
  target: LivingRoutePoint,
  targetRoom: Room | undefined,
  label: string,
  hint: string,
  targetName: string,
  color: string,
  tags: readonly string[],
): void {
  registerRouteCue(world, {
    id: `procedural_${spec.key}_${id}`,
    x: marker.x + 0.5,
    y: marker.y + 0.5,
    targetX: target.x + 0.5,
    targetY: target.y + 0.5,
    floor: spec.baseFloor,
    roomId: targetRoom?.id,
    targetRoomId: targetRoom?.id,
    label,
    hint,
    targetName,
    color,
    tags: ['procedural_floor', 'living_blocks', ...tags],
    toneSeed: (spec.seed ^ (id.length * 1709) ^ (targetRoom?.id ?? 0)) >>> 0,
    radius: 10,
    targetRadius: 3,
    cooldownSec: 28,
    heardText: `${label}: слышно, куда ведет ${hint}.`,
    followedText: `${targetName}: маршрут найден, решение за вами.`,
    ignoredText: `${label}: бетонная развилка осталась позади.`,
    routeGroup: {
      id,
      lead: label,
      risk: spec.danger <= 2 ? 'низкий бытовой риск' : 'жилая толчея с чужими замками',
      decision: hint,
      reward: targetName,
    },
  });
}

function registerLivingBlockRouteCues(world: World, blocks: readonly LivingBlock[], spec: ProceduralFloorSpec, spawn: LivingRoutePoint): void {
  if (blocks.length === 0) return;
  const first = blocks[0];
  const farPair = farthestLivingBlockPair(blocks, world);
  const last = blocks[blocks.length - 1];
  const publicTargetRoom = last.publicRoom ?? last.homeRoom ?? last.rooms[0];
  const serviceA = farPair?.[0].serviceRoom ?? first.serviceRoom ?? first.rooms[0];
  const serviceB = farPair?.[1].serviceRoom ?? last.serviceRoom ?? last.rooms[0];
  const shelterRoom = blocks.find(block => block.shelterRoom?.name.startsWith('Убежищный отросток'))?.shelterRoom;
  const homeRoom = first.homeRoom ?? first.rooms[0];

  if (homeRoom) registerLivingCue(world, spec, 'home_route', spawn, roomPoint(homeRoom), homeRoom, 'домовой ход', 'идти через квартиры', 'квартира с бытовым лутом', '#ffd39a', ['home_route']);
  if (publicTargetRoom) registerLivingCue(world, spec, 'public_route', { x: first.centerX, y: first.centerY }, roomPoint(publicTargetRoom), publicTargetRoom, 'общий проход', 'держаться широкого коридора', 'дальний общий тамбур', '#f2c47a', ['public_route']);
  if (serviceA && serviceB) registerLivingCue(world, spec, 'service_cut', roomPoint(serviceA), roomPoint(serviceB), serviceB, 'служебный срез', 'срезать через бетонную технину', 'кладовая у сервисной хорды', '#9ec6d8', ['service_cut']);
  if (shelterRoom) registerLivingCue(world, spec, 'shelter_spur', { x: last.centerX, y: last.centerY }, roomPoint(shelterRoom), shelterRoom, 'убежищный отросток', 'уйти в короткий тупик укрытия', 'кладовая с шансом переждать давление', '#b8d7a2', ['shelter_spur']);
}

// @ts-expect-error TS6133 — preserved as reference; replaced by recipe system
function buildLivingBlockRooms(world: World, spec: ProceduralFloorSpec): { rooms: Room[]; spawnX: number; spawnY: number } {
  const geom = geometryById(spec.geometryId);
  const rooms: Room[] = [];
  const blocks: LivingBlock[] = [];
  const targetRooms = Math.max(
    geom.roomCount + spec.danger * 6,
    LIVING_BLOCK_MIN_TARGET_ROOMS + spec.danger * LIVING_BLOCK_TARGET_ROOMS_PER_DANGER,
  );
  const blockCount = Math.max(72, Math.min(132, Math.ceil(targetRooms / 10)));
  const gridCols = LIVING_BLOCK_GRID_COLUMNS;
  const gridRows = Math.ceil((blockCount + PROCEDURAL_HQ_OWNERS.length * 2) / gridCols);
  const cellW = Math.floor((W - LIVING_BLOCK_MARGIN * 2) / gridCols);
  const cellH = Math.floor((W - LIVING_BLOCK_MARGIN * 2) / gridRows);

  for (let slot = 0; blocks.length < blockCount && slot < gridCols * gridRows; slot++) {
    const col = slot % gridCols;
    const row = Math.floor(slot / gridCols);
    const slotCenterX = LIVING_BLOCK_MARGIN + col * cellW + Math.floor(cellW / 2);
    const slotCenterY = LIVING_BLOCK_MARGIN + row * cellH + Math.floor(cellH / 2);
    if (livingSlotReservedForHq(world, slotCenterX, slotCenterY)) continue;
    const remainingBlocks = Math.max(1, blockCount - blocks.length);
    const wantedColumns = Math.ceil((targetRooms - rooms.length) / Math.max(1, remainingBlocks * 2));
    const maxColumnsForCell = Math.max(3, Math.min(6, Math.floor((cellW - 14) / 15)));
    const columns = Math.max(3, Math.min(6, maxColumnsForCell, wantedColumns));
    const x = LIVING_BLOCK_MARGIN + col * cellW + irng(6, Math.max(7, Math.floor(cellW * 0.13)));
    const y = LIVING_BLOCK_MARGIN + row * cellH + irng(5, Math.max(6, Math.floor(cellH * 0.16)));
    const block = buildLivingBlockAt(world, rooms, spec, blocks.length + 1, x, y, columns);
    if (block.rooms.length > 0) blocks.push(block);
  }

  const ordered = blocks
    .slice()
    .sort((a, b) => a.corridorY === b.corridorY ? a.centerX - b.centerX : a.corridorY - b.corridorY);
  for (let i = 1; i < ordered.length; i++) {
    carveLivingWeightedRoute(world, spec, { x: ordered[i - 1].centerX, y: ordered[i - 1].centerY }, { x: ordered[i].centerX, y: ordered[i].centerY }, 1, Tex.F_TILE, Tex.PANEL, spec.seed + i * 577, false);
  }

  const pair = farthestLivingBlockPair(blocks, world);
  if (pair) {
    const a = pair[0].serviceRoom ?? pair[0].rooms[0];
    const b = pair[1].serviceRoom ?? pair[1].rooms[0];
    if (a && b) carveLivingWeightedRoute(world, spec, roomPoint(a), roomPoint(b), 0, Tex.F_CONCRETE, Tex.PIPE, spec.seed ^ 0x515e, true);
  }

  const first = blocks[0];
  const spawnRoom = first?.homeRoom ?? first?.rooms[0];
  const spawn = spawnRoom ? roomPoint(spawnRoom) : { x: W / 2, y: W / 2 };
  const shelterBlock = chooseLivingShelterBlock(blocks, spawn, world);
  const shelterRoom = shelterBlock?.shelterRoom;
  if (shelterBlock && shelterRoom) {
    decorateLivingShelterSpur(world, shelterRoom, spec);
    carveLivingWeightedRoute(world, spec, { x: shelterBlock.centerX, y: shelterBlock.centerY }, roomPoint(shelterRoom), 0, Tex.F_CONCRETE, Tex.PANEL, spec.seed ^ 0x5afe, true);
  }

  const spawnX = spawn.x + 0.5;
  const spawnY = spawn.y + 0.5;
  ensureConnectivity(world, spawnX, spawnY);
  sanitizeDoors(world);
  registerLivingBlockRouteCues(world, blocks, spec, spawn);
  return { rooms, spawnX, spawnY };
}

const ADMIN_LEGAL_ITEMS: readonly Item[] = [
  { defId: 'official_permit_slip', count: 1 },
  { defId: 'sealed_complaint', count: 1 },
  { defId: 'ration_registry_extract', count: 1 },
];
const ADMIN_STAFF_ITEMS: readonly Item[] = [
  { defId: 'permanent_pass', count: 1 },
  { defId: 'filter_receipt', count: 1 },
  { defId: 'cleanup_order_stub', count: 1 },
];
const ADMIN_THEFT_ITEMS: readonly Item[] = [
  { defId: 'elevator_access_order', count: 1 },
  { defId: 'confiscation_warrant', count: 1 },
  { defId: 'raionsovet_floor_pass', count: 1 },
];
const ADMIN_BRIBE_ITEMS: readonly Item[] = [
  { defId: 'ration_stamp_pad', count: 1 },
  { defId: 'debt_settlement_receipt', count: 1 },
  { defId: 'cigs', count: 2 },
];

type ApartmentPressureRouteKind = 'legal_door' | 'crowd_route' | 'cut_through' | 'barricade_detour';

interface ApartmentPressureAnchor {
  id: string;
  label: string;
  x: number;
  y: number;
  accessX: number;
  accessY: number;
  roomId?: number;
  zoneId: number;
}

const APARTMENT_PRESSURE_LEGAL_KEY = 'resident_identity_stub';
const APARTMENT_PRESSURE_CUT_KEY = 'key';
const APARTMENT_PRESSURE_INFILL_GRID = 20;
const APARTMENT_PRESSURE_INFILL_MAX_BLOCKS = 360;
const APARTMENT_PRESSURE_INFILL_LINK_RADIUS = 132;
const APARTMENT_PRESSURE_CEMENT_MEMORY_GRID = 12;
const APARTMENT_PRESSURE_CEMENT_MEMORY_COURTS = 24;
const APARTMENT_PRESSURE_DOMAINS = [
  { label: 'Домен очереди', floorTex: Tex.F_LINO, feature: Feature.CHAIR },
  { label: 'Домен домкома', floorTex: Tex.F_TILE, feature: Feature.TABLE },
  { label: 'Домен тихого среза', floorTex: Tex.F_WOOD, feature: Feature.SHELF },
  { label: 'Домен баррикады', floorTex: Tex.F_CONCRETE, feature: Feature.TABLE },
] as const;

const APARTMENT_PRESSURE_ROUTE_LABELS: Record<ApartmentPressureRouteKind, {
  label: string;
  hint: string;
  targetName: string;
  color: string;
  decision: string;
  risk: string;
  reward: string;
}> = {
  legal_door: {
    label: 'законная дверь',
    hint: 'корешок жильца открывает короткий спокойный ход',
    targetName: 'проверяемая дверь',
    color: '#ffd47a',
    decision: 'показать корешок или искать другой проход',
    risk: 'без документа дверь держит маршрут закрытым',
    reward: 'тихий проход без толпы',
  },
  crowd_route: {
    label: 'толповый маршрут',
    hint: 'очереди дают широкий, шумный, но законный обход',
    targetName: 'очередной карман',
    color: '#f6a44b',
    decision: 'идти через толпу или срезать квартирой',
    risk: 'шум и плотный контакт',
    reward: 'нет замка и меньше подозрений',
  },
  cut_through: {
    label: 'квартирный срез',
    hint: 'запертая комната режет путь, если есть ключ или отмычка',
    targetName: 'чужая квартира',
    color: '#91c7ff',
    decision: 'вскрыть дверь или остаться в очереди',
    risk: 'свидетели и закрытая створка',
    reward: 'короткий ход через жилую ячейку',
  },
  barricade_detour: {
    label: 'баррикадный обход',
    hint: 'полки и столы оставляют ремонтный зигзаг к лифтам',
    targetName: 'баррикадный пролёт',
    color: '#8de0c8',
    decision: 'обойти, разобрать, драться или отступить',
    risk: 'узкий контакт у мебели',
    reward: 'ход к шахтам без одной главной двери',
  },
};

function setAdminRoomFloor(world: World, room: Room, floorTex: Tex): void {
  room.floorTex = floorTex;
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[ci] === room.id && (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER)) {
        world.floorTex[ci] = floorTex;
      }
    }
  }
}

function setAdminInteriorWall(world: World, room: Room, dx: number, dy: number): void {
  const ci = world.idx(room.x + dx, room.y + dy);
  if (world.cells[ci] !== Cell.FLOOR || world.roomMap[ci] !== room.id || world.features[ci] !== Feature.NONE) return;
  if (world.containerMap.has(ci)) return;
  world.cells[ci] = Cell.WALL;
  world.wallTex[ci] = Tex.MARBLE;
}

function decorateAdminOfficeSlab(world: World, room: Room, seed: number): void {
  const vertical = room.w >= room.h;
  const along = vertical ? room.w : room.h;
  const cross = vertical ? room.h : room.w;
  const stride = Math.max(4, Math.min(7, Math.floor(along / 4)));

  for (let line = stride; line < along - 2; line += stride) {
    const gap = 1 + ((seed + line * 3) % Math.max(1, cross - 2));
    for (let t = 1; t < cross - 1; t++) {
      if (Math.abs(t - gap) <= 1) continue;
      setAdminInteriorWall(world, room, vertical ? line : t, vertical ? t : line);
    }
  }

  for (let y = 2; y < room.h - 1; y += 4) {
    for (let x = 2 + ((seed + y) & 1); x < room.w - 1; x += 5) {
      const ci = world.idx(room.x + x, room.y + y);
      if (world.cells[ci] !== Cell.FLOOR || world.roomMap[ci] !== room.id || world.features[ci] !== Feature.NONE) continue;
      world.features[ci] = chance(0.72) ? Feature.DESK : Feature.SHELF;
    }
  }
}

function decorateAdminQueueRoom(world: World, room: Room, index: number, spec: ProceduralFloorSpec): void {
  room.name = index === 0 ? `Окно приема ${room.id}` : `Юридическая очередь ${room.id}`;
  setAdminRoomFloor(world, room, index === 0 ? Tex.F_MARBLE_TILE : Tex.F_RED_CARPET);
  const counterY = Math.max(1, Math.min(room.h - 2, 2 + (index % Math.max(1, room.h - 4))));
  for (let dx = 1; dx < room.w - 1; dx++) {
    if (dx % 5 === 0) continue;
    const ci = world.idx(room.x + dx, room.y + counterY);
    if (world.cells[ci] !== Cell.FLOOR || world.roomMap[ci] !== room.id) continue;
    world.features[ci] = dx % 4 === 0 ? Feature.SCREEN : Feature.DESK;
  }
  const laneX = Math.max(1, Math.min(room.w - 2, Math.floor(room.w / 2)));
  for (let dy = counterY + 2; dy < room.h - 1; dy += 2) {
    for (const ox of [-1, 1] as const) {
      const ci = world.idx(room.x + laneX + ox, room.y + dy);
      if (world.cells[ci] === Cell.FLOOR && world.roomMap[ci] === room.id && world.features[ci] === Feature.NONE) {
        world.features[ci] = Feature.CHAIR;
      }
    }
  }
  const center = roomCenter(room);
  stampSurfaceSplat(world, center.x, center.y, 0.5, 0.5, 0.4, 0.58, spec.seed + index * 353, 168, 38, 34, false);
}

function carveAdminStaffCell(world: World, x: number, y: number, spec: ProceduralFloorSpec, step: number): boolean {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT || world.hermoWall[ci] || world.aptMask[ci]) return false;
  if (world.features[ci] === Feature.LIFT_BUTTON || world.containerMap.has(ci)) return false;
  world.cells[ci] = Cell.FLOOR;
  world.floorTex[ci] = Tex.F_GREEN_CARPET;
  world.wallTex[ci] = Tex.MARBLE;
  world.features[ci] = Feature.NONE;
  world.roomMap[ci] = -1;
  world.removeDoorAt(ci);
  if (step % 29 === 0) {
    stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.24, 0.42, spec.seed + step * 31, 56, 86, 64, false);
  }
  return true;
}

function carveAdminStaffSegment(
  world: World,
  spec: ProceduralFloorSpec,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  horizontal: boolean,
  stepBase: number,
): number {
  const delta = horizontal ? world.delta(ax, bx) : world.delta(ay, by);
  const stepDir = delta >= 0 ? 1 : -1;
  const steps = Math.abs(delta);
  let x = world.wrap(ax);
  let y = world.wrap(ay);

  for (let s = 0; s <= steps; s++) {
    const step = stepBase + s;
    for (let side = -1; side <= 0; side++) {
      const cx = horizontal ? x : x + side;
      const cy = horizontal ? y + side : y;
      carveAdminStaffCell(world, cx, cy, spec, step);
    }
    if (step % 23 === 0) {
      const fx = horizontal ? x : x + 1;
      const fy = horizontal ? y + 1 : y;
      const fi = world.idx(fx, fy);
      if (world.cells[fi] === Cell.FLOOR && world.features[fi] === Feature.NONE) {
        world.features[fi] = step % 46 === 0 ? Feature.LAMP : Feature.SCREEN;
      }
    }
    if (s < steps) {
      if (horizontal) x = world.wrap(x + stepDir);
      else y = world.wrap(y + stepDir);
    }
  }

  return stepBase + steps + 1;
}

function carveAdminStaffChord(world: World, a: Room, b: Room, spec: ProceduralFloorSpec, index: number): void {
  const ac = roomCenter(a);
  const bc = roomCenter(b);
  const horizontalFirst = ((spec.seed + index * 17) & 1) === 0;
  let step = index * 1201;
  if (horizontalFirst) {
    step = carveAdminStaffSegment(world, spec, ac.x, ac.y, bc.x, ac.y, true, step);
    carveAdminStaffSegment(world, spec, bc.x, ac.y, bc.x, bc.y, false, step);
  } else {
    step = carveAdminStaffSegment(world, spec, ac.x, ac.y, ac.x, bc.y, false, step);
    carveAdminStaffSegment(world, spec, ac.x, bc.y, bc.x, bc.y, true, step);
  }
  a.name = `Служебная хорда ${a.id}`;
  b.name = `Служебная хорда ${b.id}`;
  setAdminRoomFloor(world, a, Tex.F_GREEN_CARPET);
  setAdminRoomFloor(world, b, Tex.F_GREEN_CARPET);
}

interface AdminPocketCorridorAnchor {
  x: number;
  y: number;
  dir: 0 | 1 | 2 | 3;
  score: number;
}

const ADMIN_POCKET_CLUSTER_ROOM_TYPES = [
  RoomType.OFFICE,
  RoomType.STORAGE,
  RoomType.OFFICE,
  RoomType.COMMON,
  RoomType.BATHROOM,
  RoomType.KITCHEN,
  RoomType.MEDICAL,
] as const;

function adminPocketClusterRoomSize(type: RoomType, seed: number): { w: number; h: number } {
  if (type === RoomType.BATHROOM) return { w: 4 + (seed & 1), h: 4 + ((seed >>> 1) & 1) };
  if (type === RoomType.KITCHEN) return { w: 5 + (seed % 3), h: 5 + ((seed >>> 3) % 3) };
  if (type === RoomType.MEDICAL) return { w: 6 + (seed % 4), h: 5 + ((seed >>> 4) % 3) };
  if (type === RoomType.STORAGE) return { w: 5 + (seed % 5), h: 4 + ((seed >>> 5) % 4) };
  if (type === RoomType.COMMON) return { w: 8 + (seed % 6), h: 6 + ((seed >>> 6) % 5) };
  return { w: 6 + (seed % 7), h: 5 + ((seed >>> 7) % 5) };
}

function decorateAdminClusterRoom(world: World, room: Room, type: RoomType, serial: number, spec: ProceduralFloorSpec): void {
  const cluster = 1 + Math.floor(serial / 5);
  if (type === RoomType.STORAGE) room.name = `Архивная кладовая грозди ${cluster}`;
  else if (type === RoomType.COMMON) room.name = `Комната ожидания грозди ${cluster}`;
  else if (type === RoomType.BATHROOM) room.name = `Туалет при очереди ${cluster}`;
  else if (type === RoomType.KITCHEN) room.name = `Чайная при коридоре ${cluster}`;
  else if (type === RoomType.MEDICAL) room.name = `Медкабинет ликвидаторской грозди ${cluster}`;
  else room.name = `Кабинетная гроздь ${cluster}-${serial % 5 + 1}`;

  applyRoomTexture(world, room, Tex.MARBLE, type === RoomType.COMMON ? Tex.F_RED_CARPET : Tex.F_PARQUET);
  if (type === RoomType.OFFICE || type === RoomType.STORAGE) decorateAdminOfficeSlab(world, room, spec.seed + serial * 97);
  else decorateProceduralRoom(world, room, spec);

  const center = roomCenter(room);
  const centerIdx = world.idx(center.x, center.y);
  if (world.cells[centerIdx] === Cell.FLOOR && world.roomMap[centerIdx] === room.id) {
    world.features[centerIdx] = type === RoomType.KITCHEN
      ? Feature.TABLE
      : type === RoomType.BATHROOM
        ? Feature.SINK
        : type === RoomType.MEDICAL
          ? Feature.SHELF
          : Feature.DESK;
  }
  if (type === RoomType.KITCHEN) {
    const sink = roomCell(world, room, Math.max(1, room.w - 2), 1);
    const stove = roomCell(world, room, 1, Math.max(1, room.h - 2));
    if (sink) world.features[world.idx(sink.x, sink.y)] = Feature.SINK;
    if (stove) world.features[world.idx(stove.x, stove.y)] = Feature.STOVE;
  } else if (type === RoomType.BATHROOM) {
    const toilet = roomCell(world, room, 1, Math.max(1, room.h - 2));
    if (toilet) world.features[world.idx(toilet.x, toilet.y)] = Feature.TOILET;
  }
}

function adminPocketSideRoomPlacement(
  cx: number,
  cy: number,
  dir: 0 | 1 | 2 | 3,
  w: number,
  h: number,
  seed: number,
): { x: number; y: number; doorX: number; doorY: number } {
  if (dir === 0) {
    const doorY = cy;
    const y = cy - (1 + (seed % Math.max(1, h - 2)));
    return { x: cx + 2, y, doorX: cx + 1, doorY };
  }
  if (dir === 1) {
    const doorY = cy;
    const y = cy - (1 + (seed % Math.max(1, h - 2)));
    return { x: cx - w - 1, y, doorX: cx - 1, doorY };
  }
  if (dir === 2) {
    const doorX = cx;
    const x = cx - (1 + (seed % Math.max(1, w - 2)));
    return { x, y: cy + 2, doorX, doorY: cy + 1 };
  }
  const doorX = cx;
  const x = cx - (1 + (seed % Math.max(1, w - 2)));
  return { x, y: cy - h - 1, doorX, doorY: cy - 1 };
}

function tryPlaceAdminPocketSideRoom(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  cx: number,
  cy: number,
  dir: 0 | 1 | 2 | 3,
  serial: number,
): Room | null {
  const corridorIdx = world.idx(cx, cy);
  if (world.cells[corridorIdx] !== Cell.FLOOR || world.roomMap[corridorIdx] >= 0) return null;
  const type = ADMIN_POCKET_CLUSTER_ROOM_TYPES[(serial + dir) % ADMIN_POCKET_CLUSTER_ROOM_TYPES.length];
  const size = adminPocketClusterRoomSize(type, spec.seed + serial * 131 + dir * 17);
  const p = adminPocketSideRoomPlacement(cx, cy, dir, size.w, size.h, spec.seed + serial * 19 + dir);
  if (p.x < 4 || p.y < 4 || p.x + size.w + 4 >= W || p.y + size.h + 4 >= W) return null;
  const doorIdx = world.idx(p.doorX, p.doorY);
  if (world.cells[doorIdx] !== Cell.WALL || world.hermoWall[doorIdx] || world.aptMask[doorIdx]) return null;
  if (!canPlaceRoom(world, p.x, p.y, size.w, size.h)) return null;

  const room = stampRoom(world, rooms.length, type, p.x, p.y, size.w, size.h, -1);
  rooms.push(room);
  decorateAdminClusterRoom(world, room, type, serial, spec);
  placeDoorAt(world, p.doorX, p.doorY, room.id);
  return room;
}

function collectAdminPocketCorridorAnchors(world: World, spec: ProceduralFloorSpec): AdminPocketCorridorAnchor[] {
  const anchors: AdminPocketCorridorAnchor[] = [];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  for (let y = 12; y < W - 12; y += 2) {
    for (let x = 12; x < W - 12; x += 2) {
      const ci = world.idx(x, y);
      if (world.cells[ci] !== Cell.FLOOR || world.roomMap[ci] >= 0) continue;
      if (world.features[ci] === Feature.LIFT_BUTTON || world.containerMap.has(ci)) continue;
      for (let dir = 0; dir < dirs.length; dir++) {
        const [dx, dy] = dirs[dir];
        const wallIdx = world.idx(x + dx, y + dy);
        const openIdx = world.idx(x - dx, y - dy);
        if (world.cells[wallIdx] !== Cell.WALL || world.hermoWall[wallIdx] || world.aptMask[wallIdx]) continue;
        if (world.cells[openIdx] === Cell.WALL && fieldHash01(spec.seed, x, y, dir + 0x606) < 0.55) continue;
        anchors.push({
          x,
          y,
          dir: dir as 0 | 1 | 2 | 3,
          score: fieldHash01(spec.seed, x >> 2, y >> 2, dir + 0xa06) + anchors.length * 1e-8,
        });
      }
    }
  }
  anchors.sort((a, b) => a.score - b.score);
  return anchors;
}

function placeAdminPocketSideRoomClusters(world: World, rooms: Room[], spec: ProceduralFloorSpec): number {
  const target = Math.min(124, 44
    + spec.danger * 14
    + (spec.anomalyId === 'smog' ? 14 : 0)
    + (spec.anomalyId === 'mirror_run' ? 18 : 0));
  const anchors = collectAdminPocketCorridorAnchors(world, spec);
  const offsets = [
    [0, 0],
    [6, 0],
    [-6, 0],
    [0, 6],
    [0, -6],
    [11, 0],
    [-11, 0],
    [0, 11],
    [0, -11],
  ] as const;
  let placed = 0;
  for (let ai = 0; ai < anchors.length && placed < target; ai++) {
    const anchor = anchors[ai];
    const clusterTarget = 3 + ((spec.seed + ai) % 4);
    let clusterPlaced = 0;
    for (let oi = 0; oi < offsets.length && clusterPlaced < clusterTarget && placed < target; oi++) {
      const [ox, oy] = offsets[(oi + ai) % offsets.length];
      const cx = anchor.x + ox;
      const cy = anchor.y + oy;
      for (let turn = 0; turn < 4; turn++) {
        const dir = ((anchor.dir + turn + oi) & 3) as 0 | 1 | 2 | 3;
        const room = tryPlaceAdminPocketSideRoom(world, rooms, spec, cx, cy, dir, placed);
        if (!room) continue;
        placed++;
        clusterPlaced++;
        break;
      }
    }
  }
  if (placed > 0) {
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFeaturesDirty(true);
  }
  return placed;
}

function nextProceduralRoomId(world: World): number {
  let id = world.rooms.length;
  while (world.rooms[id]) id++;
  return id;
}

function fallbackAdminMicroRoomType(serial: number): RoomType {
  const cycle = [
    RoomType.OFFICE,
    RoomType.STORAGE,
    RoomType.OFFICE,
    RoomType.BATHROOM,
    RoomType.COMMON,
    RoomType.KITCHEN,
    RoomType.MEDICAL,
    RoomType.STORAGE,
  ] as const;
  return cycle[serial % cycle.length];
}

function fallbackAdminMicroRoomSize(type: RoomType, serial: number): { w: number; h: number } {
  if (type === RoomType.BATHROOM) return { w: 3 + (serial & 1), h: 3 + ((serial >>> 1) & 1) };
  if (type === RoomType.KITCHEN) return { w: 5 + (serial % 2), h: 4 + ((serial >>> 1) % 2) };
  if (type === RoomType.MEDICAL) return { w: 5 + (serial % 3), h: 4 + ((serial >>> 2) % 2) };
  if (type === RoomType.COMMON) return { w: 6 + (serial % 3), h: 4 + ((serial >>> 2) % 3) };
  if (type === RoomType.STORAGE) return { w: 4 + (serial % 3), h: 3 + ((serial >>> 1) % 3) };
  return { w: 5 + (serial % 4), h: 4 + ((serial >>> 2) % 3) };
}

function decorateFallbackAdminMicroRoom(world: World, room: Room, type: RoomType, serial: number, spec: ProceduralFloorSpec): void {
  if (type === RoomType.STORAGE) room.name = `Архивный шкаф-карман ${room.id}`;
  else if (type === RoomType.BATHROOM) room.name = `Служебный туалет ${room.id}`;
  else if (type === RoomType.KITCHEN) room.name = `Чайная в кармане ${room.id}`;
  else if (type === RoomType.MEDICAL) room.name = `Пункт холодной помощи ${room.id}`;
  else if (type === RoomType.COMMON) room.name = `Малая очередь ${room.id}`;
  else room.name = `Малый кабинет ${room.id}`;

  const floor = type === RoomType.BATHROOM || type === RoomType.MEDICAL
    ? Tex.F_TILE
    : type === RoomType.COMMON
      ? Tex.F_RED_CARPET
      : type === RoomType.STORAGE
        ? Tex.F_MARBLE_TILE
        : Tex.F_PARQUET;
  applyRoomTexture(world, room, Tex.MARBLE, floor);
  if (type === RoomType.OFFICE || type === RoomType.STORAGE) decorateAdminOfficeSlab(world, room, spec.seed + serial * 137);
  else decorateProceduralRoom(world, room, spec);

  const center = roomCenter(room);
  const ci = world.idx(center.x, center.y);
  if (world.cells[ci] === Cell.FLOOR && world.roomMap[ci] === room.id) {
    world.features[ci] = type === RoomType.BATHROOM
      ? Feature.SINK
      : type === RoomType.KITCHEN
        ? Feature.TABLE
        : type === RoomType.MEDICAL
          ? Feature.APPARATUS
          : type === RoomType.COMMON
            ? Feature.CHAIR
            : Feature.DESK;
  }
}

function tryPlaceFallbackAdminMicroRoom(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  anchor: Room,
  serial: number,
): Room | null {
  const type = fallbackAdminMicroRoomType(serial);
  const size = fallbackAdminMicroRoomSize(type, serial);
  const ac = roomCenter(anchor);
  for (let attempt = 0; attempt < 96; attempt++) {
    const salt = spec.seed ^ (serial * 0x45d9f3b) ^ (attempt * 0x27d4eb2d);
    const side = salt & 3;
    const gap = 3 + ((salt >>> 4) % 11);
    let x = 0;
    let y = 0;
    if (side === 0) {
      x = ac.x - Math.floor(size.w / 2) + (((salt >>> 8) % 11) - 5);
      y = anchor.y - size.h - gap;
    } else if (side === 1) {
      x = ac.x - Math.floor(size.w / 2) + (((salt >>> 8) % 11) - 5);
      y = anchor.y + anchor.h + gap;
    } else if (side === 2) {
      x = anchor.x - size.w - gap;
      y = ac.y - Math.floor(size.h / 2) + (((salt >>> 8) % 11) - 5);
    } else {
      x = anchor.x + anchor.w + gap;
      y = ac.y - Math.floor(size.h / 2) + (((salt >>> 8) % 11) - 5);
    }
    x = world.wrap(x);
    y = world.wrap(y);
    if (!canPlaceRoom(world, x, y, size.w, size.h)) continue;
    const room = stampRoom(world, nextProceduralRoomId(world), type, x, y, size.w, size.h, -1);
    rooms.push(room);
    decorateFallbackAdminMicroRoom(world, room, type, serial, spec);
    const cc = roomCenter(room);
    carveCorridor(world, ac.x, ac.y, cc.x, cc.y);
    return room;
  }
  return null;
}

function placeFallbackAdminMicroRooms(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  adminRooms: readonly Room[],
  alreadyPlaced: number,
): number {
  const target = 34
    + spec.danger * 8
    + (spec.anomalyId === 'hladon' ? 12 : 0)
    + (spec.anomalyId === 'mirror_run' ? 12 : 0)
    + (spec.majorityId === 'wild' ? 8 : 0);
  if (alreadyPlaced >= target) return 0;
  const anchors = adminRooms
    .filter(room => room.w >= 7 && room.h >= 5)
    .sort((a, b) => (b.w * b.h) - (a.w * a.h))
    .slice(0, 12 + spec.danger * 2);
  let placed = 0;
  for (let i = alreadyPlaced; i < target && anchors.length > 0; i++) {
    const anchor = anchors[(i * 5 + spec.ordinal + (spec.seed & 7)) % anchors.length];
    if (tryPlaceFallbackAdminMicroRoom(world, rooms, spec, anchor, i)) placed++;
  }
  if (placed > 0) {
    registerRouteCue(world, {
      id: `procedural_${spec.key}_admin_micro_pockets`,
      x: spawnCueX(anchors[0]),
      y: spawnCueY(anchors[0]),
      targetX: spawnCueX(anchors[anchors.length - 1]),
      targetY: spawnCueY(anchors[anchors.length - 1]),
      floor: spec.baseFloor,
      roomId: anchors[0]?.id,
      targetRoomId: anchors[anchors.length - 1]?.id,
      zoneId: world.zoneMap[world.idx(roomCenter(anchors[0]).x, roomCenter(anchors[0]).y)],
      label: 'мелкие кабинеты',
      hint: 'крупные приемные залы обросли тесными служебными карманами',
      targetName: anchors[anchors.length - 1]?.name,
      color: '#d7c899',
      tags: ['procedural_floor', 'admin_pockets', 'micro_rooms', 'document_landmark'],
      toneSeed: (spec.seed ^ 0xad11) >>> 0,
      radius: 10,
      targetRadius: 5,
      cooldownSec: 55,
      heardText: 'За стойкой дробно хлопают мелкие двери. Административный карман не заканчивается одним залом.',
      followedText: 'Мелкие кабинеты дали обход, тайник и место переждать холод.',
      ignoredText: 'Служебные карманы остались сбоку, за рядом одинаковых дверей.',
    });
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFeaturesDirty(true);
  }
  return placed;
}

function spawnCueX(room: Room | undefined): number {
  return room ? roomCenter(room).x + 0.5 : W / 2 + 0.5;
}

function spawnCueY(room: Room | undefined): number {
  return room ? roomCenter(room).y + 0.5 : W / 2 + 0.5;
}

function applyAdminPockets(world: World, rooms: Room[], spec: ProceduralFloorSpec, spawnX: number, spawnY: number): void {
  if (spec.geometryId !== 'admin_pockets') return;
  const sideRooms = placeAdminPocketSideRoomClusters(world, rooms, spec);
  const adminRooms = rooms
    .filter(room => room.id !== 0 && room.w >= 6 && room.h >= 5)
    .sort((a, b) => (b.w * b.h) - (a.w * a.h));
  placeFallbackAdminMicroRooms(world, rooms, spec, adminRooms, sideRooms);
  const desiredQueueRooms = 4 + Math.floor(spec.danger / 2);
  const queueRooms = adminRooms
    .filter(room => room.type === RoomType.COMMON || room.type === RoomType.CORRIDOR || room.type === RoomType.SMOKING)
    .slice(0, desiredQueueRooms);
  const queueRoomsSet = new Set(queueRooms);
  if (queueRooms.length < 2) {
    for (const room of adminRooms) {
      if (queueRoomsSet.has(room)) continue;
      queueRooms.push(room);
      queueRoomsSet.add(room);
      if (queueRooms.length >= Math.min(2, desiredQueueRooms)) break;
    }
  }
  const officeRooms = adminRooms
    .filter(room => !queueRoomsSet.has(room))
    .filter(room => room.type === RoomType.OFFICE || room.type === RoomType.STORAGE)
    .slice(0, 12 + spec.danger * 2);

  for (let i = 0; i < officeRooms.length; i++) {
    const room = officeRooms[i];
    room.name = room.type === RoomType.STORAGE ? `Документный карман ${room.id}` : `Кабинет-слэб ${room.id}`;
    setAdminRoomFloor(world, room, room.type === RoomType.STORAGE ? Tex.F_MARBLE_TILE : Tex.F_PARQUET);
    decorateAdminOfficeSlab(world, room, spec.seed + i * 41);
  }

  for (let i = 0; i < queueRooms.length; i++) decorateAdminQueueRoom(world, queueRooms[i], i, spec);

  const staffCandidates = adminRooms
    .filter(room => !queueRoomsSet.has(room))
    .filter(room => room.type === RoomType.OFFICE || room.type === RoomType.STORAGE || room.type === RoomType.CORRIDOR)
    .filter(room => world.dist2(spawnX, spawnY, roomCenter(room).x, roomCenter(room).y) > 46 * 46);
  const chordCount = Math.min(3, Math.floor(staffCandidates.length / 2));
  for (let i = 0; i < chordCount; i++) {
    const a = staffCandidates[(spec.seed + i * 5) % staffCandidates.length];
    const b = staffCandidates[(spec.seed + i * 7 + Math.floor(staffCandidates.length / 2)) % staffCandidates.length];
    if (!a || !b || a.id === b.id) continue;
    carveAdminStaffChord(world, a, b, spec, i);
  }
}

function placeAdminPocketLandmarks(world: World, rooms: Room[], spec: ProceduralFloorSpec, reachable: Uint8Array): void {
  if (spec.geometryId !== 'admin_pockets') return;
  const queueRooms = rooms.filter(room => room.name.startsWith('Юридическая очередь') || room.name.startsWith('Окно приема'));
  const officeRooms = rooms.filter(room => room.name.startsWith('Кабинет-слэб') || room.name.startsWith('Документный карман'));
  const staffRooms = rooms.filter(room => room.name.startsWith('Служебная хорда'));

  const legalRoom = queueRooms[0] ?? officeRooms[0] ?? rooms[0];
  const legal = legalRoom ? findReachableContainerCell(world, rooms, reachable, spec.seed ^ 0x4301, legalRoom) : null;
  if (legal) {
    addProceduralLootContainer(
      world,
      spec,
      legal.room,
      legal,
      ContainerKind.FILING_CABINET,
      ADMIN_LEGAL_ITEMS.map(item => ({ ...item })),
      ['legal_queue', 'document_landmark', 'counter_landmark'],
      'Окно приема: папка законной очереди',
    );
  }

  const bribeRoom = queueRooms[1] ?? legalRoom;
  const bribe = bribeRoom ? findReachableContainerCell(world, rooms, reachable, spec.seed ^ 0x4302, bribeRoom) : null;
  if (bribe) {
    addProceduralLootContainer(
      world,
      spec,
      bribe.room,
      bribe,
      ContainerKind.CASHBOX,
      ADMIN_BRIBE_ITEMS.map(item => ({ ...item })),
      ['bribe_checkpoint', 'counter_landmark', 'audit_risk'],
      'Касса проверки: взнос без квитанции',
    );
  }

  const theftRoom = officeRooms[0] ?? staffRooms[0] ?? legalRoom;
  const theft = theftRoom ? findReachableContainerCell(world, rooms, reachable, spec.seed ^ 0x4303, theftRoom) : null;
  if (theft) {
    addProceduralLootContainer(
      world,
      spec,
      theft.room,
      theft,
      ContainerKind.SAFE,
      ADMIN_THEFT_ITEMS.map(item => ({ ...item })),
      ['document_theft', 'locked_paper', 'audit_risk'],
      'Сейф чужого решения',
    );
  }

  const staffRoom = staffRooms[0] ?? officeRooms[1] ?? legalRoom;
  const staff = staffRoom ? findReachableContainerCell(world, rooms, reachable, spec.seed ^ 0x4304, staffRoom) : null;
  if (staff) {
    addProceduralLootContainer(
      world,
      spec,
      staff.room,
      staff,
      ContainerKind.SECRET_STASH,
      ADMIN_STAFF_ITEMS.map(item => ({ ...item })),
      ['staff_stealth', 'staff_route', 'document_landmark'],
      'Служебная ниша с обходными бумагами',
    );
  }
}

function placeCollectorValveLandmarks(world: World, rooms: Room[], spec: ProceduralFloorSpec, reachable: Uint8Array): void {
  if (spec.geometryId !== 'collectors') return;
  const valveRooms = rooms.filter(room => room.name.startsWith(COLLECTOR_VALVE_ROOM_PREFIX));
  for (let i = 0; i < Math.min(3, valveRooms.length); i++) {
    const target = findReachableContainerCell(world, rooms, reachable, spec.seed ^ 0xc011ec ^ (i * 401), valveRooms[i]);
    if (!target) continue;
    addProceduralLootContainer(
      world,
      spec,
      target.room,
      target,
      ContainerKind.TOOL_LOCKER,
      COLLECTOR_REPAIR_ITEMS.map(item => ({ ...item })),
      ['collector_valve', 'valve_reroute', 'repair_crossing', 'tool_repair'],
      `Шкаф ремонта у ${valveRooms[i].name}`,
    );
  }
}

interface LiquidatorCheckpoint {
  cell: number;
  room: Room;
  x: number;
  y: number;
  zoneId: number;
  score: number;
}

interface LiquidatorPatrolTriangle {
  checkpoint: LiquidatorCheckpoint;
  riskCell: number;
  rewardCell: number;
  escapeCell: number;
}

interface LiquidatorControlProfile {
  checkpoints: LiquidatorCheckpoint[];
  triangles: LiquidatorPatrolTriangle[];
}

const EMPTY_LIQUIDATOR_CONTROL_PROFILE: LiquidatorControlProfile = { checkpoints: [], triangles: [] };

const LIQUIDATOR_PERMIT_GATE_ITEMS: readonly Item[] = [
  { defId: 'liquidator_field_roster', count: 1 },
  { defId: 'cleanup_order_stub', count: 1 },
];
const LIQUIDATOR_BRIBE_ITEMS: readonly Item[] = [
  { defId: 'cigs', count: 3 },
  { defId: 'ration_stamp_pad', count: 1 },
];
const LIQUIDATOR_STAFF_ROUTE_ITEMS: readonly Item[] = [
  { defId: 'forged_permit_slip', count: 1 },
  { defId: 'fake_pass', count: 1 },
  { defId: 'flashlight', count: 1 },
];
const LIQUIDATOR_WEAPON_ROOM_ITEMS: readonly Item[] = [
  { defId: 'makarov', count: 1 },
  { defId: 'ammo_9mm', count: 18 },
  { defId: 'foam_grenade_6p10', count: 1 },
];
const LIQUIDATOR_ABUSE_EVIDENCE_ITEMS: readonly Item[] = [
  { defId: 'confiscation_tag', count: 1 },
  { defId: 'weapon_checkout_tag', count: 1 },
];

function liquidatorCheckpointTarget(spec: ProceduralFloorSpec): number {
  return Math.min(5, Math.max(3, 2 + spec.danger));
}

function liquidatorBoundaryScore(world: World, ci: number): number {
  const zoneId = world.zoneMap[ci];
  const zone = world.zones[zoneId];
  if (!zone) return 0;
  const x = ci % W;
  const y = (ci / W) | 0;
  let score = zone.faction === ZoneFaction.LIQUIDATOR ? 2 : 0;
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
    const ni = world.idx(x + dx, y + dy);
    const other = world.zones[world.zoneMap[ni]];
    if (!other || other.id === zone.id) continue;
    const liquidatorSide = zone.faction === ZoneFaction.LIQUIDATOR || other.faction === ZoneFaction.LIQUIDATOR;
    if (!liquidatorSide) continue;
    score += zone.faction === other.faction ? 2 : 9;
    if (other.faction === ZoneFaction.CULTIST || other.faction === ZoneFaction.WILD || other.faction === ZoneFaction.SAMOSBOR) score += 3;
  }
  return score;
}

function liquidatorRoomControlWeight(room: Room): number {
  if (room.type === RoomType.CORRIDOR) return 8;
  if (room.type === RoomType.COMMON) return 6;
  if (room.type === RoomType.OFFICE) return 5;
  if (room.type === RoomType.PRODUCTION || room.type === RoomType.STORAGE) return 4;
  return 1;
}

function collectLiquidatorCheckpointCandidates(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  reachable: Uint8Array,
  spawnX: number,
  spawnY: number,
): LiquidatorCheckpoint[] {
  const out: LiquidatorCheckpoint[] = [];
  const seen = new Set<number>();
  const pushCandidate = (ci: number, fallback: boolean): void => {
    if (seen.has(ci) || !reachable[ci]) return;
    if (world.cells[ci] !== Cell.FLOOR) return;
    if (world.features[ci] === Feature.LIFT_BUTTON || world.containerMap.has(ci) || world.aptMask[ci] || world.hermoWall[ci]) return;
    const roomId = world.roomMap[ci];
    const room = rooms[roomId];
    if (!room || room.id === 0 || room.w < 4 || room.h < 4) return;
    const boundary = liquidatorBoundaryScore(world, ci);
    const zoneId = world.zoneMap[ci];
    const zone = world.zones[zoneId];
    if (!fallback && boundary <= 0) return;
    if (fallback && zone?.faction !== ZoneFaction.LIQUIDATOR) return;
    const x = ci % W;
    const y = (ci / W) | 0;
    const fromSpawn = Math.sqrt(world.dist2(spawnX, spawnY, x + 0.5, y + 0.5));
    const score = boundary * 9
      + liquidatorRoomControlWeight(room)
      + (zone?.level ?? spec.danger) * 2
      + Math.min(6, fromSpawn / 48)
      + (((ci ^ spec.seed ^ (room.id * 1103)) & 1023) / 1024);
    seen.add(ci);
    out.push({ cell: ci, room, x, y, zoneId, score });
  };

  for (let ci = 0; ci < world.cells.length; ci++) pushCandidate(ci, false);
  if (out.length >= liquidatorCheckpointTarget(spec) * 3) return out;
  for (let ci = 0; ci < world.cells.length; ci++) pushCandidate(ci, true);
  return out;
}

function selectLiquidatorCheckpoints(
  world: World,
  candidates: LiquidatorCheckpoint[],
  target: number,
): LiquidatorCheckpoint[] {
  candidates.sort((a, b) => b.score - a.score);
  const selected: LiquidatorCheckpoint[] = [];
  for (const minSep of [72, 44, 24]) {
    const minD2 = minSep * minSep;
    for (const candidate of candidates) {
      if (selected.length >= target) break;
      if (selected.some(existing => world.dist2(existing.x + 0.5, existing.y + 0.5, candidate.x + 0.5, candidate.y + 0.5) < minD2)) continue;
      selected.push(candidate);
    }
    if (selected.length >= target) break;
  }
  return selected;
}

function setLiquidatorCheckpointFloor(world: World, x: number, y: number, seed: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > 18) continue;
      const ci = world.idx(x + dx, y + dy);
      if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.DOOR && world.cells[ci] !== Cell.WATER) continue;
      if (world.features[ci] === Feature.LIFT_BUTTON) continue;
      world.floorTex[ci] = d2 <= 5 ? Tex.F_RED_CARPET : Tex.F_CONCRETE;
      if (((seed + dx * 31 + dy * 17) & 15) === 0) {
        stampSurfaceSplat(world, x + dx, y + dy, 0.5, 0.5, 0.26, 0.5, seed + dx * 101 + dy * 43, 140, 28, 24, false);
      }
    }
  }
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
    const ci = world.idx(x + dx, y + dy);
    if (world.cells[ci] === Cell.WALL) world.wallTex[ci] = Tex.METAL;
  }
}

function placeLiquidatorFixture(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR || world.features[ci] !== Feature.NONE || world.containerMap.has(ci)) return;
  world.features[ci] = feature;
}

function stampLiquidatorCheckpoint(world: World, checkpoint: LiquidatorCheckpoint, spec: ProceduralFloorSpec, index: number): void {
  const checkpointName = index === 0
    ? `Главный пост ликвидаторов ${checkpoint.room.id}`
    : `Контрольный пост ликвидаторов ${checkpoint.room.id}`;
  checkpoint.room.name = archiveRoomHasLandmarkName(checkpoint.room)
    ? `${checkpoint.room.name}: ${checkpointName}`
    : checkpointName;
  setLiquidatorCheckpointFloor(world, checkpoint.x, checkpoint.y, spec.seed ^ (index * 0x4c11));
  placeLiquidatorFixture(world, checkpoint.x, checkpoint.y, Feature.SCREEN);
  placeLiquidatorFixture(world, checkpoint.x + 1, checkpoint.y, Feature.DESK);
  placeLiquidatorFixture(world, checkpoint.x - 1, checkpoint.y, Feature.TABLE);
  placeLiquidatorFixture(world, checkpoint.x, checkpoint.y + 1, Feature.LAMP);
  placeLiquidatorFixture(world, checkpoint.x, checkpoint.y - 1, Feature.SHELF);
  stampMark(world, checkpoint.x, checkpoint.y, 0.5, 0.5, 0.42, MarkType.BULLET, spec.seed + index * 277, 172, 36, 30, 185);
}

function collectReachableLiftExitTargets(world: World, reachable: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT) continue;
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
      const ni = world.idx(x + dx, y + dy);
      if (reachable[ni] && !out.includes(ni)) out.push(ni);
    }
  }
  return out;
}

function stampLiquidatorTrianglePoint(world: World, cell: number, role: 'risk' | 'reward' | 'escape', seed: number): void {
  const x = cell % W;
  const y = (cell / W) | 0;
  if (world.cells[cell] !== Cell.FLOOR && world.cells[cell] !== Cell.WATER && world.cells[cell] !== Cell.DOOR) return;
  if (role === 'escape') world.floorTex[cell] = Tex.F_GREEN_CARPET;
  else if (role === 'reward') world.floorTex[cell] = Tex.F_CONCRETE;
  else world.floorTex[cell] = Tex.F_RED_CARPET;
  if (world.cells[cell] === Cell.FLOOR && world.features[cell] === Feature.NONE) {
    world.features[cell] = role === 'risk' ? Feature.LAMP : role === 'reward' ? Feature.SHELF : Feature.SCREEN;
  }
  const mark = role === 'escape' ? MarkType.SPLAT : role === 'reward' ? MarkType.BULLET : MarkType.SCORCH;
  const [r, g, b] = role === 'escape' ? [58, 92, 58] : role === 'reward' ? [168, 34, 30] : [46, 46, 42];
  stampMark(world, x, y, 0.5, 0.5, role === 'risk' ? 0.34 : 0.28, mark, seed, r, g, b, 150);
}

function placeLiquidatorPatrolTriangles(
  world: World,
  spec: ProceduralFloorSpec,
  checkpoints: readonly LiquidatorCheckpoint[],
  reachable: Uint8Array,
  candidates: readonly number[],
): LiquidatorPatrolTriangle[] {
  const out: LiquidatorPatrolTriangle[] = [];
  const exitTargets = collectReachableLiftExitTargets(world, reachable);
  for (let i = 0; i < checkpoints.length; i++) {
    const checkpoint = checkpoints[i];
    const triangle = placeDecisionTriangle(world, {
      candidates,
      poi: checkpoint.cell,
      seed: spec.seed ^ (checkpoint.cell * 33) ^ (i * 0x51),
      sampleCount: 180,
      minSeparation: 10,
      spacingWeight: 2.2,
      escapeReachable: reachable,
      exitTargets,
      spawn: { at: checkpoint.cell, radius: i === 0 ? 6 : 3, penalty: i === 0 ? 5 : 2 },
      roles: {
        risk: {
          baseScore: 4,
          roomWeights: { [RoomType.CORRIDOR]: 5, [RoomType.COMMON]: 3, [RoomType.OFFICE]: 2 },
          zoneWeights: { [ZoneFaction.LIQUIDATOR]: 4, [ZoneFaction.WILD]: 1.5, [ZoneFaction.CULTIST]: 1.5 },
          distanceBand: { min: 8, max: 30, ideal: 14, score: 5, outsidePenalty: 4 },
        },
        reward: {
          baseScore: 3,
          roomWeights: { [RoomType.STORAGE]: 5, [RoomType.PRODUCTION]: 4, [RoomType.OFFICE]: 3 },
          zoneWeights: { [ZoneFaction.LIQUIDATOR]: 3 },
          distanceBand: { min: 5, max: 32, ideal: 14, score: 5, outsidePenalty: 4 },
        },
        escape: {
          baseScore: 2,
          roomWeights: { [RoomType.CORRIDOR]: 4, [RoomType.COMMON]: 2, [RoomType.OFFICE]: 1 },
          zoneWeights: { [ZoneFaction.CITIZEN]: 3, [ZoneFaction.LIQUIDATOR]: 1 },
          distanceBand: { min: 16, max: 56, ideal: 30, score: 5, outsidePenalty: 5 },
          exitTargetBand: { min: 2, max: 72, ideal: 18, score: 5, outsidePenalty: 6 },
        },
      },
    });
    if (!triangle) continue;
    stampLiquidatorTrianglePoint(world, triangle.risk.cell, 'risk', spec.seed + i * 1009 + 1);
    stampLiquidatorTrianglePoint(world, triangle.reward.cell, 'reward', spec.seed + i * 1009 + 2);
    stampLiquidatorTrianglePoint(world, triangle.escape.cell, 'escape', spec.seed + i * 1009 + 3);
    out.push({
      checkpoint,
      riskCell: triangle.risk.cell,
      rewardCell: triangle.reward.cell,
      escapeCell: triangle.escape.cell,
    });
  }
  return out;
}

function findContainerCellNear(
  world: World,
  rooms: Room[],
  reachable: Uint8Array,
  preferredCell: number,
  seed: number,
  occupied: Set<number>,
): { room: Room; x: number; y: number } | null {
  const cx = preferredCell % W;
  const cy = (preferredCell / W) | 0;
  for (let radius = 0; radius <= 12; radius++) {
    for (let step = 0; step < Math.max(8, radius * 8); step++) {
      const angle = (seed * 0.011 + step * 2.399963) % (Math.PI * 2);
      const x = world.wrap(cx + Math.round(Math.cos(angle) * radius));
      const y = world.wrap(cy + Math.round(Math.sin(angle) * radius));
      const ci = world.idx(x, y);
      if (occupied.has(ci) || !containerCellValidForReachability(world, ci, reachable)) continue;
      if (world.features[ci] !== Feature.NONE && world.features[ci] !== Feature.SHELF && world.features[ci] !== Feature.TABLE) continue;
      if (world.containersAt(x, y).length > 0) continue;
      const room = rooms[world.roomMap[ci]];
      if (!room) continue;
      return { room, x, y };
    }
  }
  const preferredRoom = rooms[world.roomMap[preferredCell]];
  return findReachableContainerCell(world, rooms, reachable, seed, preferredRoom, occupied);
}

function addLiquidatorControlContainer(
  world: World,
  spec: ProceduralFloorSpec,
  pos: { room: Room; x: number; y: number },
  kind: ContainerKind,
  name: string,
  inventory: readonly Item[],
  access: ContainerAccess,
  tags: readonly string[],
  lockDifficulty?: number,
  discovered = true,
): WorldContainer {
  const def = CONTAINER_DEFS[kind];
  const container: WorldContainer = {
    id: nextContainerId(world),
    x: pos.x,
    y: pos.y,
    floor: spec.baseFloor,
    roomId: pos.room.id,
    zoneId: world.zoneMap[world.idx(pos.x, pos.y)],
    kind,
    name,
    inventory: inventory.map(item => ({ ...item })),
    capacitySlots: def.capacitySlots,
    ownerName: access === 'owner' ? 'дежурный поста ликвидаторов' : undefined,
    faction: access === 'faction' || access === 'locked' ? Faction.LIQUIDATOR : undefined,
    access,
    lockDifficulty,
    discovered,
    tags: uniqueTags([
      'procedural_floor',
      'liquidators',
      'liquidator_checkpoint',
      'majority_liquidators',
      spec.geometryId,
      spec.anomalyId,
      ...tags,
    ]),
  };
  world.addContainer(container);
  return container;
}

function placeLiquidatorControlContainers(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  reachable: Uint8Array,
  profile: LiquidatorControlProfile,
): void {
  const occupied = new Set<number>(world.containers.map(container => world.idx(container.x, container.y)));
  const preferredCells = [
    profile.checkpoints[0]?.cell,
    profile.triangles[0]?.rewardCell,
    profile.triangles[0]?.escapeCell,
    profile.triangles[1]?.rewardCell,
    profile.triangles[2]?.riskCell,
  ].filter((cell): cell is number => cell !== undefined);
  const place = (
    offset: number,
    kind: ContainerKind,
    name: string,
    inventory: readonly Item[],
    access: ContainerAccess,
    tags: readonly string[],
    lockDifficulty?: number,
    discovered = true,
  ): void => {
    const cell = preferredCells[offset] ?? preferredCells[0];
    if (cell === undefined) return;
    const pos = findContainerCellNear(world, rooms, reachable, cell, spec.seed ^ (offset * 0x671), occupied);
    if (!pos) return;
    occupied.add(world.idx(pos.x, pos.y));
    addLiquidatorControlContainer(world, spec, pos, kind, name, inventory, access, tags, lockDifficulty, discovered);
  };

  place(
    0,
    ContainerKind.FILING_CABINET,
    'Журнал пропускного поста',
    LIQUIDATOR_PERMIT_GATE_ITEMS,
    'locked',
    ['permit_gate', 'show_permit', 'document', 'permit', 'paper', 'general_admin', 'readable_bypass', 'access'],
    Math.min(5, 1 + spec.danger),
  );
  place(
    1,
    ContainerKind.CASHBOX,
    'Касса негласного взноса',
    LIQUIDATOR_BRIBE_ITEMS,
    'owner',
    ['bribe_checkpoint', 'buyable', 'bribe', 'trade', 'permit_bypass', 'readable_bypass', 'audit_risk'],
  );
  place(
    2,
    ContainerKind.SECRET_STASH,
    'Служебная щель обхода поста',
    LIQUIDATOR_STAFF_ROUTE_ITEMS,
    'secret',
    ['staff_route', 'sneak_staff_route', 'secret', 'forged', 'permit_bypass', 'readable_bypass'],
    undefined,
    true,
  );
  place(
    3,
    ContainerKind.WEAPON_CRATE,
    'Оружейная клетка поста',
    LIQUIDATOR_WEAPON_ROOM_ITEMS,
    'faction',
    ['weapon_room', 'attack_checkpoint', 'weapon', 'ammo', 'liquidator_stock', 'theft', 'combat'],
  );
  place(
    4,
    ContainerKind.FILING_CABINET,
    'Папка превышений поста',
    LIQUIDATOR_ABUSE_EVIDENCE_ITEMS,
    'locked',
    ['expose_abuse', 'liquidator_audit', 'evidence', 'document', 'permit', 'paper', 'readable_bypass'],
    Math.min(5, 2 + spec.danger),
  );
}

function registerLiquidatorControlCues(world: World, spec: ProceduralFloorSpec, profile: LiquidatorControlProfile): void {
  for (let i = 0; i < Math.min(3, profile.checkpoints.length); i++) {
    const checkpoint = profile.checkpoints[i];
    const triangle = profile.triangles[i];
    const targetCell = triangle?.escapeCell ?? triangle?.rewardCell ?? checkpoint.cell;
    const targetRoomId = world.roomMap[targetCell] >= 0 ? world.roomMap[targetCell] : undefined;
    registerRouteCue(world, {
      id: `procedural_${spec.key}_liquidator_checkpoint_${i}`,
      x: checkpoint.x + 0.5,
      y: checkpoint.y + 0.5,
      targetX: (targetCell % W) + 0.5,
      targetY: ((targetCell / W) | 0) + 0.5,
      floor: spec.baseFloor,
      roomId: checkpoint.room.id,
      targetRoomId,
      zoneId: checkpoint.zoneId,
      label: 'пост ликвидаторов',
      hint: 'пропуск, взнос, служебная щель или бой читаются по разметке поста',
      targetName: triangle ? 'обходной угол патрульного треугольника' : checkpoint.room.name,
      color: '#e44',
      tags: [
        'procedural_floor',
        'liquidator_checkpoint',
        'majority_liquidators',
        'permit_gate',
        'bribe_checkpoint',
        'staff_route',
        'patrol_triangle',
        ...(routePressureLevel(spec) > 0 ? ['route_pressure'] : []),
        spec.geometryId,
        spec.anomalyId,
      ],
      toneSeed: (spec.seed ^ (checkpoint.cell * 1109) ^ i) >>> 0,
      radius: 12,
      targetRadius: 3,
      cooldownSec: 32,
      heardText: 'Впереди сухо щелкает пост ликвидаторов: бумага, взнос или боковой проход решают быстрее выстрела.',
      followedText: 'Патрульный треугольник прочитан: пост, оружейная клетка и служебная щель оказались в одной связке.',
      ignoredText: 'Пост остался за стеной. Ликвидаторская разметка не ушла, только стала тише.',
      routeGroup: {
        id: `liquidator_control_${spec.key}_${i}`,
        lead: 'контрольный пост слышен по щелчкам рации',
        risk: 'нападение поднимает вооруженный пост',
        decision: 'показать пропуск, заплатить, пройти служебной щелью или ударить первым',
        reward: 'доступ к ведомости, оружейной клетке или улике превышений',
        mapLabel: 'пост',
        mapHint: 'ликвидаторский контрольный фронт',
      },
    });
  }
}

function applyLiquidatorMajorityProfile(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  reachable: Uint8Array,
  candidateCells: readonly number[],
  spawnX: number,
  spawnY: number,
): LiquidatorControlProfile {
  if (spec.majorityId !== 'liquidators') return EMPTY_LIQUIDATOR_CONTROL_PROFILE;
  const candidates = collectLiquidatorCheckpointCandidates(world, rooms, spec, reachable, spawnX, spawnY);
  const checkpoints = selectLiquidatorCheckpoints(world, candidates, liquidatorCheckpointTarget(spec));
  for (let i = 0; i < checkpoints.length; i++) stampLiquidatorCheckpoint(world, checkpoints[i], spec, i);
  const triangles = placeLiquidatorPatrolTriangles(world, spec, checkpoints, reachable, candidateCells);
  const profile = { checkpoints, triangles };
  placeLiquidatorControlContainers(world, rooms, spec, reachable, profile);
  registerLiquidatorControlCues(world, spec, profile);
  return profile;
}

function entityNearCell(entities: readonly Entity[], x: number, y: number): boolean {
  for (const entity of entities) {
    if (!entity.alive || entity.type !== EntityType.NPC) continue;
    const dx = entity.x - (x + 0.5);
    const dy = entity.y - (y + 0.5);
    if (dx * dx + dy * dy < 2.25) return true;
  }
  return false;
}

function findLiquidatorGuardCell(world: World, entities: readonly Entity[], checkpoint: LiquidatorCheckpoint, seed: number): number {
  for (let radius = 0; radius <= 6; radius++) {
    for (let step = 0; step < Math.max(8, radius * 8); step++) {
      const angle = (seed * 0.019 + step * 2.399963) % (Math.PI * 2);
      const x = world.wrap(checkpoint.x + Math.round(Math.cos(angle) * radius));
      const y = world.wrap(checkpoint.y + Math.round(Math.sin(angle) * radius));
      const ci = world.idx(x, y);
      if (world.cells[ci] !== Cell.FLOOR || world.features[ci] === Feature.LIFT_BUTTON || entityNearCell(entities, x, y)) continue;
      return ci;
    }
  }
  return checkpoint.cell;
}

function spawnLiquidatorCheckpointGuards(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  spec: ProceduralFloorSpec,
  profile: LiquidatorControlProfile,
): void {
  if (spec.majorityId !== 'liquidators' || profile.checkpoints.length === 0) return;
  const perCheckpoint = spec.danger >= 4 ? 2 : 1;
  const target = Math.min(8, profile.checkpoints.length * perCheckpoint);
  for (let i = 0; i < target; i++) {
    if (!canSpawnEntityType(entities, EntityType.NPC)) return;
    const checkpoint = profile.checkpoints[i % profile.checkpoints.length];
    const ci = findLiquidatorGuardCell(world, entities, checkpoint, spec.seed + i * 211);
    const x = ci % W;
    const y = (ci / W) | 0;
    const zoneLevel = world.zones[world.zoneMap[ci]]?.level ?? spec.danger;
    const rpg = randomRPG(gaussianLevel(zoneLevel + 1, 1));
    const maxHp = getMaxHp(rpg);
    const loadout = npcLoadout(Faction.LIQUIDATOR, spec.danger);
    entities.push({
      id: nextId.v++,
      type: EntityType.NPC,
      x: x + 0.5,
      y: y + 0.5,
      angle: Math.random() * Math.PI * 2,
      pitch: 0,
      alive: true,
      speed: 1.1,
      sprite: Occupation.HUNTER,
      name: `Постовой ликвидатор ${spec.ordinal}-${i + 1}`,
      isFemale: false,
      needs: freshNeeds(),
      hp: maxHp,
      maxHp,
      money: irng(18, 90 + spec.danger * 35),
      ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
      faction: Faction.LIQUIDATOR,
      occupation: Occupation.HUNTER,
      isTraveler: true,
      questId: -1,
      rpg,
      inventory: [...loadout.inventory, { defId: 'liquidator_token', count: 1 }],
      weapon: loadout.weapon,
      tool: loadout.tool,
    });
  }
}

const SUMP_PROXY_SIZE = 32;
const SUMP_PROXY_CELL = W / SUMP_PROXY_SIZE;
const SUMP_REPAIR_ROOM_PREFIX = 'Ремонтный пролет эстакады';
const SUMP_STASH_ROOM_PREFIX = 'Сухой остров черной воды';
const SUMP_STATION_ROOM_PREFIX = 'Сухая станция эстакады';
const SUMP_MICRO_ROOM_PREFIX = 'Боковая будка эстакады';
const SUMP_LIFE_STATION_ROOM_PREFIX = 'Клеточная станция эстакады';
const SUMP_LIFE_MICRO_ROOM_PREFIX = 'Клеточная будка эстакады';
const SUMP_EDGE_BOOTH_ROOM_PREFIX = 'Боковой отсек эстакады';
const SUMP_HQ_RESERVE_RADIUS2 = 96 * 96;
const SUMP_NONE_STATION_BONUS = 20;
const SUMP_NONE_MICRO_BONUS = 70;
const SUMP_FRACTAL_STATION_BONUS = 14;
const SUMP_FRACTAL_MICRO_BONUS = 38;
const SUMP_MYCELIUM_STATION_BONUS = 14;
const SUMP_MYCELIUM_MICRO_BONUS = 64;
const SUMP_DEEP_STATION_BONUS = 8;
const SUMP_DEEP_MICRO_BONUS = 32;

interface SumpProxyComponents {
  dry: Uint8Array;
  labels: Int16Array;
  components: number[][];
  largest: number;
}

function sumpHash01(seed: number, a: number, b: number, c = 0): number {
  let x = (seed ^ Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0xc2b2ae35, 0x27d4eb2d) ^ Math.imul(c + 0x165667b1, 0x9e3779b1)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function sumpProxyIndex(x: number, y: number): number {
  const px = ((x % SUMP_PROXY_SIZE) + SUMP_PROXY_SIZE) % SUMP_PROXY_SIZE;
  const py = ((y % SUMP_PROXY_SIZE) + SUMP_PROXY_SIZE) % SUMP_PROXY_SIZE;
  return py * SUMP_PROXY_SIZE + px;
}

function buildSumpProxyComponents(spec: ProceduralFloorSpec): SumpProxyComponents {
  const total = SUMP_PROXY_SIZE * SUMP_PROXY_SIZE;
  const dry = new Uint8Array(total);
  const labels = new Int16Array(total).fill(-1);

  for (let y = 0; y < SUMP_PROXY_SIZE; y++) {
    for (let x = 0; x < SUMP_PROXY_SIZE; x++) {
      let n = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) n += sumpHash01(spec.seed, x + ox, y + oy, 0x5042);
      }
      const smooth = n / 9;
      const ridge = Math.abs(((x * 5 + y * 3 + spec.seed) % 19) - 9) / 9;
      const threshold = 0.49 + spec.danger * 0.012;
      dry[sumpProxyIndex(x, y)] = smooth > threshold || ridge > 0.9 ? 1 : 0;
    }
  }

  const components: number[][] = [];
  let largest = -1;
  for (let i = 0; i < total; i++) {
    if (!dry[i] || labels[i] >= 0) continue;
    const componentId = components.length;
    const cells: number[] = [];
    const queue = [i];
    labels[i] = componentId;
    let head = 0;
    while (head < queue.length) {
      const ci = queue[head++];
      cells.push(ci);
      const x = ci % SUMP_PROXY_SIZE;
      const y = (ci / SUMP_PROXY_SIZE) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ni = sumpProxyIndex(x + dx, y + dy);
        if (!dry[ni] || labels[ni] >= 0) continue;
        labels[ni] = componentId;
        queue.push(ni);
      }
    }
    components.push(cells);
    if (largest < 0 || cells.length > components[largest].length) largest = componentId;
  }

  return { dry, labels, components, largest };
}

function sortedSumpProxyCells(cells: readonly number[], spec: ProceduralFloorSpec, salt: number): number[] {
  return [...cells].sort((a, b) =>
    sumpHash01(spec.seed, a, salt, 0x71) - sumpHash01(spec.seed, b, salt, 0x71));
}

function allSortedSumpProxyCells(spec: ProceduralFloorSpec, salt: number): number[] {
  const cells: number[] = [];
  for (let i = 0; i < SUMP_PROXY_SIZE * SUMP_PROXY_SIZE; i++) cells.push(i);
  return sortedSumpProxyCells(cells, spec, salt);
}

function clampSumpRoomStart(v: number, size: number): number {
  return Math.max(8, Math.min(W - size - 9, v));
}

function canPlaceSumpPlatform(world: World, x: number, y: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.aptMask[ci] || world.hermoWall[ci] || world.cells[ci] === Cell.LIFT) return false;
      if (world.roomMap[ci] >= 0 || world.doors.has(ci) || world.containerMap.has(ci)) return false;
    }
  }
  return true;
}

function carveSumpCell(world: World, x: number, y: number, water: boolean, spec: ProceduralFloorSpec): boolean {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT || world.hermoWall[ci] || world.aptMask[ci]) return false;
  if (world.cells[ci] === Cell.DOOR) {
    world.floorTex[ci] = water ? Tex.F_WATER : Tex.F_CONCRETE;
    world.wallTex[ci] = Tex.PIPE;
    world.features[ci] = Feature.NONE;
    return true;
  }
  world.cells[ci] = water ? Cell.WATER : Cell.FLOOR;
  world.floorTex[ci] = water ? Tex.F_WATER : Tex.F_CONCRETE;
  world.wallTex[ci] = Tex.PIPE;
  world.features[ci] = Feature.NONE;
  world.roomMap[ci] = -1;
  if (water && ((x * 13 + y * 17 + spec.seed) & 31) === 0) {
    stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.32, 0.44, spec.seed ^ (x * 31 + y * 7), 30, 54, 48, false);
  }
  return true;
}

function carveSumpRoute(
  world: World,
  spec: ProceduralFloorSpec,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  water: boolean,
  width: number,
): void {
  let x = world.wrap(Math.floor(fromX));
  let y = world.wrap(Math.floor(fromY));
  const dx = world.delta(x, Math.floor(toX));
  const dy = world.delta(y, Math.floor(toY));
  const stepX = dx === 0 ? 0 : dx > 0 ? 1 : -1;
  const stepY = dy === 0 ? 0 : dy > 0 ? 1 : -1;

  const stamp = (cx: number, cy: number): void => {
    for (let oy = -width; oy <= width; oy++) {
      for (let ox = -width; ox <= width; ox++) {
        if (Math.abs(ox) + Math.abs(oy) > width) continue;
        carveSumpCell(world, cx + ox, cy + oy, water, spec);
      }
    }
  };

  for (let i = 0; i <= Math.abs(dx); i++) {
    stamp(x, y);
    if (i < Math.abs(dx)) x = world.wrap(x + stepX);
  }
  for (let i = 0; i <= Math.abs(dy); i++) {
    stamp(x, y);
    if (i < Math.abs(dy)) y = world.wrap(y + stepY);
  }
}

function carveSumpMoat(world: World, room: Room, spec: ProceduralFloorSpec): void {
  for (let dy = -4; dy <= room.h + 3; dy++) {
    for (let dx = -4; dx <= room.w + 3; dx++) {
      if (dx >= -1 && dx <= room.w && dy >= -1 && dy <= room.h) continue;
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[ci] >= 0 || world.hermoWall[ci] || world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;
      carveSumpCell(world, room.x + dx, room.y + dy, true, spec);
    }
  }
}

function placeSumpDoorToward(
  world: World,
  room: Room,
  targetX: number,
  targetY: number,
  outsideWater: boolean,
  spec: ProceduralFloorSpec,
): { x: number; y: number } | null {
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  const dx = world.delta(cx, targetX);
  const dy = world.delta(cy, targetY);
  let doorX = cx;
  let doorY = cy;
  let outX = cx;
  let outY = cy;

  if (Math.abs(dx) >= Math.abs(dy)) {
    const side = dx >= 0 ? 1 : -1;
    doorX = world.wrap(side > 0 ? room.x + room.w : room.x - 1);
    doorY = cy;
    outX = world.wrap(doorX + side);
    outY = doorY;
  } else {
    const side = dy >= 0 ? 1 : -1;
    doorX = cx;
    doorY = world.wrap(side > 0 ? room.y + room.h : room.y - 1);
    outX = doorX;
    outY = world.wrap(doorY + side);
  }

  placeDoorAt(world, doorX, doorY, room.id);
  const doorIdx = world.idx(doorX, doorY);
  if (world.cells[doorIdx] !== Cell.DOOR) return null;
  carveSumpCell(world, outX, outY, outsideWater, spec);
  return { x: outX, y: outY };
}

function createSumpPlatformRoom(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  proxyIdx: number,
  name: string,
  type: RoomType,
  targetX: number,
  targetY: number,
  outsideWater: boolean,
  sizeOverride?: { w: number; h: number },
): { room: Room; doorOutside: { x: number; y: number } } | null {
  const gx = proxyIdx % SUMP_PROXY_SIZE;
  const gy = (proxyIdx / SUMP_PROXY_SIZE) | 0;
  const w = sizeOverride?.w ?? Math.max(7, Math.min(11, 7 + Math.floor(sumpHash01(spec.seed, proxyIdx, 0x77, 0x11) * 5)));
  const h = sizeOverride?.h ?? Math.max(6, Math.min(9, 6 + Math.floor(sumpHash01(spec.seed, proxyIdx, 0x78, 0x12) * 4)));
  const baseX = Math.floor(gx * SUMP_PROXY_CELL + SUMP_PROXY_CELL / 2 - w / 2);
  const baseY = Math.floor(gy * SUMP_PROXY_CELL + SUMP_PROXY_CELL / 2 - h / 2);

  for (let attempt = 0; attempt < 14; attempt++) {
    const ox = Math.floor((sumpHash01(spec.seed, proxyIdx, attempt, 0x31) - 0.5) * 18);
    const oy = Math.floor((sumpHash01(spec.seed, proxyIdx, attempt, 0x32) - 0.5) * 18);
    const x = clampSumpRoomStart(baseX + ox, w);
    const y = clampSumpRoomStart(baseY + oy, h);
    if (!canPlaceSumpPlatform(world, x, y, w, h)) continue;
    const room = stampRoom(world, world.rooms.length, type, x, y, w, h, -1);
    room.name = name;
    applyRoomTexture(world, room, Tex.PIPE, Tex.F_CONCRETE);
    carveSumpMoat(world, room, spec);
    const doorOutside = placeSumpDoorToward(world, room, targetX, targetY, outsideWater, spec);
    if (!doorOutside) continue;
    const center = roomCenter(room);
    const featureIdx = world.idx(center.x, center.y);
    world.features[featureIdx] = type === RoomType.PRODUCTION ? Feature.MACHINE : Feature.SHELF;
    stampSurfaceSplat(world, center.x, center.y, 0.5, 0.5, 0.44, 0.5, spec.seed ^ proxyIdx, 54, 78, 72, false);
    rooms.push(room);
    return { room, doorOutside };
  }
  return null;
}

function findNearestSumpWater(world: World, x: number, y: number, maxRadius: number, reachable?: Uint8Array): { x: number; y: number } | null {
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const wx = world.wrap(x + dx);
        const wy = world.wrap(y + dy);
        const ci = world.idx(wx, wy);
        if (world.cells[ci] === Cell.WATER && (!reachable || reachable[ci])) return { x: wx, y: wy };
      }
    }
  }
  return null;
}

function findNearestSumpDryReachable(world: World, x: number, y: number, maxRadius: number, reachable: Uint8Array): { x: number; y: number } | null {
  for (let r = 2; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const wx = world.wrap(x + dx);
        const wy = world.wrap(y + dy);
        const ci = world.idx(wx, wy);
        if (reachable[ci] && isSumpDryWalkable(world, ci)) return { x: wx, y: wy };
      }
    }
  }
  return null;
}

function isSumpDryWalkable(world: World, idx: number): boolean {
  return world.cells[idx] === Cell.FLOOR || world.cells[idx] === Cell.DOOR;
}

function reachableSumpDryCells(world: World, spawnX: number, spawnY: number): Uint8Array {
  const out = new Uint8Array(W * W);
  const queue = new Int32Array(W * W);
  const start = world.idx(Math.floor(spawnX), Math.floor(spawnY));
  if (!isSumpDryWalkable(world, start)) return out;
  let head = 0;
  let tail = 0;
  out[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const ci = queue[head++];
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = world.idx(x + dx, y + dy);
      if (out[ni] || !isSumpDryWalkable(world, ni)) continue;
      out[ni] = 1;
      queue[tail++] = ni;
    }
  }
  return out;
}

function liftHasDryAccess(world: World, reachable: Uint8Array, liftIdx: number): boolean {
  const x = liftIdx % W;
  const y = (liftIdx / W) | 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (reachable[world.idx(x + dx, y + dy)]) return true;
  }
  return false;
}

function connectSumpRoomToDryRoute(world: World, room: Room, spec: ProceduralFloorSpec, spawnX: number, spawnY: number): boolean {
  const candidates: { wx: number; wy: number; ox: number; oy: number; score: number }[] = [];
  for (let i = 0; i < room.w; i++) {
    const x = world.wrap(room.x + i);
    candidates.push(
      { wx: x, wy: world.wrap(room.y - 1), ox: x, oy: world.wrap(room.y - 2), score: world.dist2(spawnX, spawnY, x, room.y - 2) },
      { wx: x, wy: world.wrap(room.y + room.h), ox: x, oy: world.wrap(room.y + room.h + 1), score: world.dist2(spawnX, spawnY, x, room.y + room.h + 1) },
    );
  }
  for (let i = 0; i < room.h; i++) {
    const y = world.wrap(room.y + i);
    candidates.push(
      { wx: world.wrap(room.x - 1), wy: y, ox: world.wrap(room.x - 2), oy: y, score: world.dist2(spawnX, spawnY, room.x - 2, y) },
      { wx: world.wrap(room.x + room.w), wy: y, ox: world.wrap(room.x + room.w + 1), oy: y, score: world.dist2(spawnX, spawnY, room.x + room.w + 1, y) },
    );
  }
  candidates.sort((a, b) => a.score - b.score);

  for (const candidate of candidates) {
    const wallIdx = world.idx(candidate.wx, candidate.wy);
    if (world.cells[wallIdx] === Cell.LIFT || world.hermoWall[wallIdx] || world.aptMask[wallIdx]) continue;
    if (world.cells[wallIdx] === Cell.WALL) placeDoorAt(world, candidate.wx, candidate.wy, room.id);
    if (world.cells[wallIdx] !== Cell.DOOR) {
      world.cells[wallIdx] = Cell.FLOOR;
      world.floorTex[wallIdx] = Tex.F_CONCRETE;
      world.wallTex[wallIdx] = Tex.PIPE;
      world.features[wallIdx] = Feature.NONE;
      world.roomMap[wallIdx] = -1;
    }
    carveSumpCell(world, candidate.ox, candidate.oy, false, spec);
    carveSumpRoute(world, spec, candidate.ox, candidate.oy, Math.floor(spawnX), Math.floor(spawnY), false, 1);
    const reachable = reachableSumpDryCells(world, spawnX, spawnY);
    const c = roomCenter(room);
    if (reachable[world.idx(c.x, c.y)]) return true;
  }
  return false;
}

function ensureSumpRepairDryAccess(world: World, rooms: Room[], spec: ProceduralFloorSpec, spawnX: number, spawnY: number): void {
  if (spec.geometryId !== 'sump_causeways') return;
  let reachable = reachableSumpDryCells(world, spawnX, spawnY);
  for (const room of rooms) {
    if (!room.name.startsWith(SUMP_REPAIR_ROOM_PREFIX)) continue;
    const c = roomCenter(room);
    if (reachable[world.idx(c.x, c.y)]) continue;
    if (connectSumpRoomToDryRoute(world, room, spec, spawnX, spawnY)) {
      reachable = reachableSumpDryCells(world, spawnX, spawnY);
    }
  }
}

function ensureSumpLiftDryAccess(world: World, spec: ProceduralFloorSpec, spawnX: number, spawnY: number): void {
  if (spec.geometryId !== 'sump_causeways') return;
  let reachable = reachableSumpDryCells(world, spawnX, spawnY);
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || liftHasDryAccess(world, reachable, i)) continue;
    const x = i % W;
    const y = (i / W) | 0;
    let access: { x: number; y: number } | null = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = world.idx(x + dx, y + dy);
      if (world.cells[ni] === Cell.LIFT || world.hermoWall[ni] || world.aptMask[ni]) continue;
      access = { x: world.wrap(x + dx), y: world.wrap(y + dy) };
      break;
    }
    if (!access) continue;
    carveSumpRoute(world, spec, access.x, access.y, Math.floor(spawnX), Math.floor(spawnY), false, 1);
    reachable = reachableSumpDryCells(world, spawnX, spawnY);
  }
}

function decorateSumpEdge(world: World, x: number, y: number, feature: Feature, spec: ProceduralFloorSpec, step: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR || world.features[ci] !== Feature.NONE) return;
  world.features[ci] = feature;
  if (feature === Feature.MACHINE || feature === Feature.APPARATUS) {
    stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.42, 0.5, spec.seed + step * 97, 76, 96, 90, false);
  }
}

function carveSumpBand(world: World, spec: ProceduralFloorSpec, line: number, horizontal: boolean, coord: number): void {
  const start = 54 + line * 17;
  const end = W - 55 - line * 19;
  for (let p = start; p <= end; p++) {
    for (let side = -4; side <= 4; side++) {
      const x = horizontal ? p : coord + side;
      const y = horizontal ? coord + side : p;
      const dryLane = Math.abs(side) <= 1 || ((p + line * 13) % 47 === 0 && Math.abs(side) <= 3);
      carveSumpCell(world, x, y, !dryLane, spec);
    }
    if ((p + line * 11) % 31 === 0) {
      const side = ((p + line) & 1) === 0 ? -5 : 5;
      const fx = horizontal ? p : coord + side;
      const fy = horizontal ? coord + side : p;
      decorateSumpEdge(world, fx, fy, (p & 1) === 0 ? Feature.LAMP : Feature.MACHINE, spec, p + line * 1000);
    }
  }
}

function canCarveSumpAmbientCell(world: World, idx: number): boolean {
  if (world.cells[idx] !== Cell.WALL) return false;
  if (world.doors.has(idx) || world.hermoWall[idx] || world.aptMask[idx]) return false;
  if (world.roomMap[idx] >= 0 || world.containerMap.has(idx)) return false;
  if (world.features[idx] === Feature.LIFT_BUTTON) return false;
  return true;
}

function carveSumpAmbientCell(world: World, spec: ProceduralFloorSpec, x: number, y: number, water: boolean): number {
  const idx = world.idx(x, y);
  if (!canCarveSumpAmbientCell(world, idx)) return 0;
  const cell = water ? Cell.WATER : Cell.FLOOR;
  const floor = water ? Tex.F_WATER : Tex.F_CONCRETE;
  const changed = world.cells[idx] !== cell || world.floorTex[idx] !== floor || world.wallTex[idx] !== Tex.PIPE;
  world.cells[idx] = cell;
  world.floorTex[idx] = floor;
  world.wallTex[idx] = Tex.PIPE;
  world.roomMap[idx] = -1;
  if (world.features[idx] !== Feature.LIFT_BUTTON) world.features[idx] = Feature.NONE;
  if (water && ((x * 19 + y * 23 + spec.seed) & 63) === 0) {
    stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.28, 0.38, spec.seed ^ (x * 37 + y * 11), 28, 48, 45, false);
  }
  return changed ? 1 : 0;
}

function carveSumpAmbientField(world: World, spec: ProceduralFloorSpec): number {
  const proxy = buildSumpProxyComponents(spec);
  let changed = 0;
  for (let cell = 0; cell < SUMP_PROXY_SIZE * SUMP_PROXY_SIZE; cell++) {
    const dry = proxy.dry[cell] === 1;
    const cx = Math.floor((cell % SUMP_PROXY_SIZE) * SUMP_PROXY_CELL + SUMP_PROXY_CELL / 2);
    const cy = Math.floor(((cell / SUMP_PROXY_SIZE) | 0) * SUMP_PROXY_CELL + SUMP_PROXY_CELL / 2);
    const radius = dry ? 8 + (spec.danger >> 1) : 11 + (spec.danger >> 1);
    const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const n = sumpHash01(spec.seed, cell + dx * 31, dy * 17, dry ? 0xa31 : 0xa32);
        if (dry) {
          const lane = Math.abs(dx) <= 1 || Math.abs(dy) <= 1 || (Math.abs(dx - dy) <= 1 && n > 0.64);
          const pad = d2 < r2 * 0.38 && n > 0.7;
          if (!lane && !pad) continue;
          changed += carveSumpAmbientCell(world, spec, cx + dx, cy + dy, false);
        } else {
          if (d2 > r2 * (0.78 + n * 0.22)) continue;
          changed += carveSumpAmbientCell(world, spec, cx + dx, cy + dy, true);
        }
      }
    }
  }
  return changed;
}

type SumpServiceScale = 'mid' | 'micro';

function sumpServiceRoomType(scale: SumpServiceScale, serial: number): RoomType {
  if (scale === 'mid') {
    return [RoomType.PRODUCTION, RoomType.STORAGE, RoomType.COMMON, RoomType.OFFICE][serial % 4];
  }
  return [RoomType.STORAGE, RoomType.OFFICE, RoomType.STORAGE, RoomType.COMMON, RoomType.PRODUCTION][serial % 5];
}

function sumpServiceRoomSize(spec: ProceduralFloorSpec, proxyIdx: number, serial: number, scale: SumpServiceScale): { w: number; h: number } {
  if (scale === 'mid') {
    return {
      w: 12 + Math.floor(sumpHash01(spec.seed, proxyIdx, serial, 0x8a) * 9),
      h: 8 + Math.floor(sumpHash01(spec.seed, proxyIdx, serial, 0x8b) * 7),
    };
  }
  return {
    w: 5 + Math.floor(sumpHash01(spec.seed, proxyIdx, serial, 0x8c) * 6),
    h: 4 + Math.floor(sumpHash01(spec.seed, proxyIdx, serial, 0x8d) * 5),
  };
}

function sumpServiceRoomName(scale: SumpServiceScale, type: RoomType, serial: number): string {
  const prefix = scale === 'mid' ? SUMP_STATION_ROOM_PREFIX : SUMP_MICRO_ROOM_PREFIX;
  const suffix = type === RoomType.PRODUCTION
    ? 'привод'
    : type === RoomType.OFFICE
      ? 'журнал'
      : type === RoomType.COMMON
        ? 'дежурка'
        : 'склад';
  return `${prefix} ${serial + 1}: ${suffix}`;
}

function sumpCellReservedForHq(world: World, spec: ProceduralFloorSpec, x: number, y: number): boolean {
  const dominantOwner = factionToTerritoryOwner(majorityById(spec.majorityId).npcFaction);
  for (const owner of PROCEDURAL_HQ_OWNERS) {
    const base = proceduralHqBase(owner);
    const radius2 = owner === dominantOwner ? SUMP_HQ_RESERVE_RADIUS2 * 1.35 : SUMP_HQ_RESERVE_RADIUS2;
    if (world.dist2(x, y, base.x, base.y) <= radius2) return true;
  }
  return false;
}

function decorateSumpServiceRoom(world: World, room: Room, spec: ProceduralFloorSpec, scale: SumpServiceScale, serial: number): void {
  const wall = room.type === RoomType.PRODUCTION ? Tex.METAL : Tex.PIPE;
  const floor = scale === 'mid' || room.type === RoomType.PRODUCTION ? Tex.F_CONCRETE : Tex.F_TILE;
  applyRoomTexture(world, room, wall, floor);
  decorateRoom(world, room);
  decorateProceduralRoom(world, room, spec);
  const center = roomCenter(room);
  const ci = world.idx(center.x, center.y);
  if (world.cells[ci] === Cell.FLOOR) {
    world.features[ci] = room.type === RoomType.OFFICE
      ? Feature.SCREEN
      : room.type === RoomType.COMMON
        ? Feature.TABLE
        : room.type === RoomType.PRODUCTION
          ? Feature.MACHINE
          : Feature.SHELF;
  }
  if ((serial & 3) === 0) {
    stampSurfaceSplat(world, center.x, center.y, 0.5, 0.5, scale === 'mid' ? 0.54 : 0.34, 0.48, spec.seed ^ serial * 911, 64, 84, 76, false);
  }
}

function decorateSumpLifeRoom(world: World, room: Room, spec: ProceduralFloorSpec, scale: SumpServiceScale, serial: number): void {
  decorateSumpServiceRoom(world, room, spec, scale, serial);
  const center = roomCenter(room);
  const ci = world.idx(center.x, center.y);
  if (world.cells[ci] === Cell.FLOOR) {
    world.features[ci] = scale === 'mid' ? Feature.APPARATUS : Feature.SCREEN;
    world.floorTex[ci] = Tex.F_VOID;
    stampSurfaceSplat(world, center.x, center.y, 0.5, 0.5, scale === 'mid' ? 0.72 : 0.42, 0.58, spec.seed ^ serial * 1201, 42, 198, 146, false);
  }
}

function sumpLifeRoomType(scale: SumpServiceScale, serial: number): RoomType {
  if (scale === 'mid') return [RoomType.PRODUCTION, RoomType.COMMON, RoomType.STORAGE, RoomType.OFFICE][serial % 4];
  return [RoomType.STORAGE, RoomType.OFFICE, RoomType.STORAGE, RoomType.COMMON][serial % 4];
}

function sumpLifeRoomSize(spec: ProceduralFloorSpec, proxyIdx: number, serial: number, scale: SumpServiceScale): { w: number; h: number } {
  if (scale === 'mid') {
    return {
      w: 14 + Math.floor(sumpHash01(spec.seed, proxyIdx, serial, 0xa4) * 8),
      h: 9 + Math.floor(sumpHash01(spec.seed, proxyIdx, serial, 0xa5) * 6),
    };
  }
  return {
    w: 6 + Math.floor(sumpHash01(spec.seed, proxyIdx, serial, 0xa6) * 5),
    h: 5 + Math.floor(sumpHash01(spec.seed, proxyIdx, serial, 0xa7) * 4),
  };
}

function registerSumpLifeRaftCue(world: World, spec: ProceduralFloorSpec, room: Room, cluster: number): void {
  const c = roomCenter(room);
  registerRouteCue(world, {
    id: `procedural_${spec.key}_sump_life_raft_${cluster}`,
    x: c.x + 0.5,
    y: c.y + 0.5,
    targetX: c.x + 0.5,
    targetY: c.y + 0.5,
    floor: spec.baseFloor,
    roomId: room.id,
    targetRoomId: room.id,
    zoneId: world.zoneMap[world.idx(c.x, c.y)],
    label: 'клеточная насосная',
    hint: 'сухая станция держит клеточное поле над черной водой; рядом идут короткие будки обхода',
    targetName: 'клеточная станция эстакады',
    color: '#6ee0b6',
    tags: ['procedural_floor', 'sump_causeways', 'conway_life', 'cellular', 'mid_geometry', 'micro_geometry', 'route_pressure'],
    toneSeed: spec.seed ^ cluster * 1543 ^ 0x5a6d,
    radius: 15,
    targetRadius: 5,
    cooldownSec: 45,
    heardText: 'Над черной водой щелкает клеточная насосная. Сухие будки расходятся от нее короткими обходами.',
    followedText: 'Клеточная станция держит сухую развязку среди эстакад.',
    ignoredText: 'Клеточная насосная осталась щелкать под шумом воды.',
  });
}

function connectSumpServiceRoom(
  world: World,
  spec: ProceduralFloorSpec,
  placed: { room: Room; doorOutside: { x: number; y: number } },
  reachable: Uint8Array,
  spawnX: number,
  spawnY: number,
  scale: SumpServiceScale,
): void {
  const target = findNearestSumpDryReachable(
    world,
    placed.doorOutside.x,
    placed.doorOutside.y,
    scale === 'mid' ? 160 : 96,
    reachable,
  ) ?? { x: Math.floor(spawnX), y: Math.floor(spawnY) };
  carveSumpRoute(world, spec, placed.doorOutside.x, placed.doorOutside.y, target.x, target.y, false, scale === 'mid' ? 1 : 0);
}

function sumpEdgeBoothType(serial: number): RoomType {
  return [RoomType.STORAGE, RoomType.OFFICE, RoomType.BATHROOM, RoomType.COMMON, RoomType.STORAGE, RoomType.PRODUCTION][serial % 6];
}

function sumpEdgeBoothSize(type: RoomType, seed: number): { w: number; h: number } {
  if (type === RoomType.BATHROOM) return { w: 4 + (seed & 1), h: 4 + ((seed >>> 1) & 1) };
  if (type === RoomType.PRODUCTION) return { w: 7 + (seed % 4), h: 5 + ((seed >>> 2) % 3) };
  if (type === RoomType.COMMON) return { w: 6 + (seed % 4), h: 5 + ((seed >>> 3) % 3) };
  return { w: 5 + (seed % 4), h: 4 + ((seed >>> 4) % 3) };
}

function sumpEdgeBoothName(type: RoomType, serial: number): string {
  const suffix = type === RoomType.PRODUCTION
    ? 'насос'
    : type === RoomType.BATHROOM
      ? 'санузел'
      : type === RoomType.OFFICE
        ? 'журнал'
        : type === RoomType.COMMON
          ? 'дежурка'
          : 'шкаф';
  return `${SUMP_EDGE_BOOTH_ROOM_PREFIX} ${serial + 1}: ${suffix}`;
}

function decorateSumpEdgeBooth(world: World, room: Room, spec: ProceduralFloorSpec, serial: number): void {
  const floor = room.type === RoomType.BATHROOM ? Tex.F_TILE : Tex.F_CONCRETE;
  applyRoomTexture(world, room, room.type === RoomType.PRODUCTION ? Tex.METAL : Tex.PIPE, floor);
  decorateRoom(world, room);
  decorateProceduralRoom(world, room, spec);
  const center = roomCenter(room);
  const ci = world.idx(center.x, center.y);
  if (world.cells[ci] !== Cell.FLOOR) return;
  world.features[ci] = room.type === RoomType.PRODUCTION
    ? Feature.MACHINE
    : room.type === RoomType.OFFICE
      ? Feature.SCREEN
      : room.type === RoomType.BATHROOM
        ? Feature.SINK
        : room.type === RoomType.COMMON
          ? Feature.TABLE
          : Feature.SHELF;
  if ((serial & 7) === 0) {
    stampSurfaceSplat(world, center.x, center.y, 0.5, 0.5, 0.28, 0.42, spec.seed ^ serial * 1307, 56, 76, 70, false);
  }
}

function addSumpServiceRoomsForScale(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  spawnX: number,
  spawnY: number,
  scale: SumpServiceScale,
): number {
  const conveyorBonus = spec.anomalyId === 'conveyor_sorter' ? (scale === 'mid' ? 12 : 48) : 0;
  const fractalBonus = spec.anomalyId === 'fractal_floor'
    ? (scale === 'mid' ? SUMP_FRACTAL_STATION_BONUS : SUMP_FRACTAL_MICRO_BONUS)
    : 0;
  const badAppleBonus = spec.anomalyId === 'bad_apple_world' ? (scale === 'mid' ? 30 : 120) : 0;
  const wildBonus = spec.majorityId === 'wild' ? (scale === 'mid' ? 8 : 32) : 0;
  const myceliumBonus = spec.anomalyId === 'mushroom_mycelium'
    ? (scale === 'mid' ? SUMP_MYCELIUM_STATION_BONUS : SUMP_MYCELIUM_MICRO_BONUS)
    : 0;
  const deepBonus = spec.depth >= 40
    ? (scale === 'mid' ? SUMP_DEEP_STATION_BONUS : SUMP_DEEP_MICRO_BONUS)
    : 0;
  const noAnomalyBonus = spec.anomalyId === 'none'
    ? (scale === 'mid' ? SUMP_NONE_STATION_BONUS : SUMP_NONE_MICRO_BONUS)
    : 0;
  const railBonus = spec.anomalyId === 'rail_trains' ? (scale === 'mid' ? 10 : 44) : 0;
  const target = scale === 'mid'
    ? 28 + spec.danger * 6 + conveyorBonus + fractalBonus + badAppleBonus + wildBonus + myceliumBonus + deepBonus + noAnomalyBonus + railBonus
    : 112 + spec.danger * 16 + conveyorBonus + fractalBonus + badAppleBonus + wildBonus + myceliumBonus + deepBonus + noAnomalyBonus + railBonus;
  const candidates = allSortedSumpProxyCells(spec, scale === 'mid' ? 0x920 : 0x921);
  let reachable = reachableSumpDryCells(world, spawnX, spawnY);
  let placed = 0;
  for (const cell of candidates) {
    if (placed >= target) break;
    const center = {
      x: (cell % SUMP_PROXY_SIZE) * SUMP_PROXY_CELL + SUMP_PROXY_CELL / 2,
      y: ((cell / SUMP_PROXY_SIZE) | 0) * SUMP_PROXY_CELL + SUMP_PROXY_CELL / 2,
    };
    const minDist2 = scale === 'mid' ? 74 * 74 : 42 * 42;
    if (world.dist2(spawnX, spawnY, center.x, center.y) < minDist2) continue;
    if (sumpCellReservedForHq(world, spec, center.x, center.y)) continue;
    const type = sumpServiceRoomType(scale, placed);
    const size = sumpServiceRoomSize(spec, cell, placed, scale);
    const created = createSumpPlatformRoom(
      world,
      rooms,
      spec,
      cell,
      sumpServiceRoomName(scale, type, placed),
      type,
      Math.floor(spawnX),
      Math.floor(spawnY),
      false,
      size,
    );
    if (!created) continue;
    decorateSumpServiceRoom(world, created.room, spec, scale, placed);
    connectSumpServiceRoom(world, spec, created, reachable, spawnX, spawnY, scale);
    placed++;
    if ((placed & 7) === 0) reachable = reachableSumpDryCells(world, spawnX, spawnY);
  }
  return placed;
}

function addSumpCausewayServiceRooms(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  spawnX: number,
  spawnY: number,
): void {
  const mid = addSumpServiceRoomsForScale(world, rooms, spec, spawnX, spawnY, 'mid');
  const micro = addSumpServiceRoomsForScale(world, rooms, spec, spawnX, spawnY, 'micro');
  if (mid + micro <= 0) return;
  world.markCellsDirty();
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFeaturesDirty(true);
}

function sumpEdgeBoothTarget(spec: ProceduralFloorSpec): number {
  return 72 +
    spec.danger * 12 +
    (spec.anomalyId === 'none' ? 42 : 0) +
    (spec.depth >= 40 ? 24 : 0) +
    (spec.anomalyId === 'conveyor_sorter' ? 18 : 0) +
    (spec.anomalyId === 'bad_apple_world' ? 42 : 0) +
    (spec.anomalyId === 'mushroom_mycelium' ? 24 : 0) +
    (spec.anomalyId === 'fractal_floor' ? 20 : 0) +
    (spec.anomalyId === 'rail_trains' ? 16 : 0);
}

function tryPlaceSumpEdgeBooth(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  route: { x: number; y: number },
  serial: number,
): Room | null {
  const seed = spec.seed ^ Math.imul(serial + 1, 0x45d9f3b);
  const type = sumpEdgeBoothType(serial);
  const size = sumpEdgeBoothSize(type, seed);
  const dirs = [0, 1, 2, 3].sort((a, b) =>
    sumpHash01(seed, a, serial, 0x65) - sumpHash01(seed, b, serial, 0x65));
  for (const dir of dirs) {
    const gap = 3 + Math.floor(sumpHash01(seed, dir, serial, 0x66) * 7);
    const jitter = Math.floor((sumpHash01(seed, dir, serial, 0x67) - 0.5) * 12);
    let x = Math.floor(route.x - size.w / 2);
    let y = Math.floor(route.y - size.h / 2);
    if (dir === 0) {
      x = route.x + gap;
      y += jitter;
    } else if (dir === 1) {
      x = route.x - gap - size.w;
      y += jitter;
    } else if (dir === 2) {
      y = route.y + gap;
      x += jitter;
    } else {
      y = route.y - gap - size.h;
      x += jitter;
    }
    x = clampSumpRoomStart(x, size.w);
    y = clampSumpRoomStart(y, size.h);
    if (sumpCellReservedForHq(world, spec, x + size.w / 2, y + size.h / 2)) continue;
    if (!canPlaceSumpPlatform(world, x, y, size.w, size.h)) continue;
    const room = stampRoom(world, world.rooms.length, type, x, y, size.w, size.h, -1);
    room.name = sumpEdgeBoothName(type, serial);
    applyRoomTexture(world, room, Tex.PIPE, Tex.F_CONCRETE);
    carveSumpMoat(world, room, spec);
    const doorOutside = placeSumpDoorToward(world, room, route.x, route.y, false, spec);
    if (!doorOutside) continue;
    carveSumpRoute(world, spec, doorOutside.x, doorOutside.y, route.x, route.y, false, 0);
    decorateSumpEdgeBooth(world, room, spec, serial);
    rooms.push(room);
    return room;
  }
  return null;
}

function addSumpEdgeBoothRooms(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  spawnX: number,
  spawnY: number,
): number {
  if (spec.geometryId !== 'sump_causeways') return 0;
  const target = sumpEdgeBoothTarget(spec);
  const candidates = allSortedSumpProxyCells(spec, 0x932);
  let reachable = reachableSumpDryCells(world, spawnX, spawnY);
  let placed = 0;
  for (const cell of candidates) {
    if (placed >= target) break;
    const center = {
      x: (cell % SUMP_PROXY_SIZE) * SUMP_PROXY_CELL + SUMP_PROXY_CELL / 2,
      y: ((cell / SUMP_PROXY_SIZE) | 0) * SUMP_PROXY_CELL + SUMP_PROXY_CELL / 2,
    };
    if (world.dist2(spawnX, spawnY, center.x, center.y) < 52 * 52) continue;
    if (sumpCellReservedForHq(world, spec, center.x, center.y)) continue;
    const route = findNearestSumpDryReachable(world, center.x, center.y, 84, reachable);
    if (!route) continue;
    if (!tryPlaceSumpEdgeBooth(world, rooms, spec, route, placed)) continue;
    placed++;
    if ((placed & 15) === 0) reachable = reachableSumpDryCells(world, spawnX, spawnY);
  }
  if (placed > 0) {
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFeaturesDirty(true);
  }
  return placed;
}

function addSumpConwayLifeRaftClusters(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  spawnX: number,
  spawnY: number,
): void {
  if (spec.geometryId !== 'sump_causeways' || spec.anomalyId !== 'conway_life') return;
  const targetClusters = 18 + spec.danger * 3;
  const satellitesPerCluster = spec.danger >= 5 ? 3 : 2;
  const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const;
  const candidates = allSortedSumpProxyCells(spec, 0x985);
  let reachable = reachableSumpDryCells(world, spawnX, spawnY);
  let clusters = 0;
  let placedRooms = 0;

  for (const cell of candidates) {
    if (clusters >= targetClusters) break;
    const gx = cell % SUMP_PROXY_SIZE;
    const gy = (cell / SUMP_PROXY_SIZE) | 0;
    const center = {
      x: gx * SUMP_PROXY_CELL + SUMP_PROXY_CELL / 2,
      y: gy * SUMP_PROXY_CELL + SUMP_PROXY_CELL / 2,
    };
    if (world.dist2(spawnX, spawnY, center.x, center.y) < 96 * 96) continue;
    if (sumpCellReservedForHq(world, spec, center.x, center.y)) continue;

    const midType = sumpLifeRoomType('mid', clusters);
    const main = createSumpPlatformRoom(
      world,
      rooms,
      spec,
      cell,
      `${SUMP_LIFE_STATION_ROOM_PREFIX} ${clusters + 1}`,
      midType,
      Math.floor(spawnX),
      Math.floor(spawnY),
      false,
      sumpLifeRoomSize(spec, cell, clusters, 'mid'),
    );
    if (!main) continue;

    decorateSumpLifeRoom(world, main.room, spec, 'mid', clusters);
    connectSumpServiceRoom(world, spec, main, reachable, spawnX, spawnY, 'mid');
    if (clusters < 3) registerSumpLifeRaftCue(world, spec, main.room, clusters + 1);
    placedRooms++;

    const localRooms = [main];
    for (let i = 0; i < satellitesPerCluster; i++) {
      const offset = offsets[(clusters + i * 3) % offsets.length];
      const proxy = sumpProxyIndex(gx + offset[0], gy + offset[1]);
      const px = (proxy % SUMP_PROXY_SIZE) * SUMP_PROXY_CELL + SUMP_PROXY_CELL / 2;
      const py = ((proxy / SUMP_PROXY_SIZE) | 0) * SUMP_PROXY_CELL + SUMP_PROXY_CELL / 2;
      if (sumpCellReservedForHq(world, spec, px, py)) continue;
      const serial = clusters * satellitesPerCluster + i;
      const micro = createSumpPlatformRoom(
        world,
        rooms,
        spec,
        proxy,
        `${SUMP_LIFE_MICRO_ROOM_PREFIX} ${clusters + 1}.${i + 1}`,
        sumpLifeRoomType('micro', serial),
        main.doorOutside.x,
        main.doorOutside.y,
        false,
        sumpLifeRoomSize(spec, proxy, serial, 'micro'),
      );
      if (!micro) continue;
      decorateSumpLifeRoom(world, micro.room, spec, 'micro', serial);
      carveSumpRoute(world, spec, micro.doorOutside.x, micro.doorOutside.y, main.doorOutside.x, main.doorOutside.y, false, i === 0 ? 1 : 0);
      localRooms.push(micro);
      placedRooms++;
    }

    if (localRooms.length >= 2) clusters++;
    if ((clusters & 3) === 0) reachable = reachableSumpDryCells(world, spawnX, spawnY);
  }

  if (placedRooms > 0) {
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFeaturesDirty(true);
  }
}

function addSumpPercolationRooms(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  spawnX: number,
  spawnY: number,
): void {
  const proxy = buildSumpProxyComponents(spec);
  const mainCells = proxy.largest >= 0 ? sortedSumpProxyCells(proxy.components[proxy.largest], spec, 0x901) : [];
  const repairCandidates = [...mainCells, ...allSortedSumpProxyCells(spec, 0x903)];
  let repairRooms = 0;
  for (const cell of repairCandidates) {
    if (repairRooms >= 2) break;
    const center = {
      x: (cell % SUMP_PROXY_SIZE) * SUMP_PROXY_CELL + SUMP_PROXY_CELL / 2,
      y: ((cell / SUMP_PROXY_SIZE) | 0) * SUMP_PROXY_CELL + SUMP_PROXY_CELL / 2,
    };
    if (world.dist2(spawnX, spawnY, center.x, center.y) < 92 * 92) continue;
    const placed = createSumpPlatformRoom(
      world,
      rooms,
      spec,
      cell,
      `${SUMP_REPAIR_ROOM_PREFIX} ${repairRooms + 1}`,
      RoomType.PRODUCTION,
      Math.floor(spawnX),
      Math.floor(spawnY),
      false,
    );
    if (!placed) continue;
    carveSumpRoute(world, spec, placed.doorOutside.x, placed.doorOutside.y, Math.floor(spawnX), Math.floor(spawnY), false, 1);
    repairRooms++;
  }

  const sideCells: number[] = [];
  for (let id = 0; id < proxy.components.length; id++) {
    if (id === proxy.largest || proxy.components[id].length < 2) continue;
    sideCells.push(...proxy.components[id]);
  }
  let stashRooms = 0;
  const stashCandidates = [
    ...sortedSumpProxyCells(sideCells, spec, 0x902),
    ...allSortedSumpProxyCells(spec, 0x904),
  ];
  for (const cell of stashCandidates) {
    if (stashRooms >= 3) break;
    const center = {
      x: (cell % SUMP_PROXY_SIZE) * SUMP_PROXY_CELL + SUMP_PROXY_CELL / 2,
      y: ((cell / SUMP_PROXY_SIZE) | 0) * SUMP_PROXY_CELL + SUMP_PROXY_CELL / 2,
    };
    if (world.dist2(spawnX, spawnY, center.x, center.y) < 130 * 130) continue;
    const placed = createSumpPlatformRoom(
      world,
      rooms,
      spec,
      cell,
      `${SUMP_STASH_ROOM_PREFIX} ${stashRooms + 1}`,
      RoomType.STORAGE,
      Math.floor(spawnX),
      Math.floor(spawnY),
      true,
    );
    if (!placed) continue;
    const reachable = reachableCellsFrom(world, spawnX, spawnY);
    const water = findNearestSumpWater(world, placed.doorOutside.x, placed.doorOutside.y, 320, reachable)
      ?? { x: world.wrap(Math.floor(spawnX) + 9 + stashRooms * 2), y: world.wrap(Math.floor(spawnY) + 7) };
    carveSumpRoute(world, spec, placed.doorOutside.x, placed.doorOutside.y, water.x, water.y, true, 1);
    stashRooms++;
  }
}

function applySumpCauseways(world: World, rooms: Room[], spec: ProceduralFloorSpec, spawnX: number, spawnY: number): void {
  if (spec.geometryId !== 'sump_causeways') return;
  const anchors = rooms
    .filter(room => room.type === RoomType.CORRIDOR || room.type === RoomType.PRODUCTION || room.type === RoomType.COMMON)
    .filter(room => {
      const c = roomCenter(room);
      return world.dist2(spawnX, spawnY, c.x, c.y) > 48 * 48;
    });
  const sourceRooms = anchors.length > 0 ? anchors : rooms;
  if (sourceRooms.length === 0) return;
  const lineCount = Math.min(
    spec.anomalyId === 'bad_apple_world' ? 7 : 6,
    3 + Math.floor(spec.danger / 2) + (
      spec.anomalyId === 'fractal_floor' || spec.anomalyId === 'mushroom_mycelium' || spec.anomalyId === 'bad_apple_world' || spec.depth >= 40 ? 1 : 0
    ),
  );
  const ambientChanged = carveSumpAmbientField(world, spec);

  for (let i = 0; i < lineCount; i++) {
    const room = sourceRooms[(spec.seed + i * 17) % sourceRooms.length];
    const c = roomCenter(room);
    const horizontal = i % 2 === 0;
    const coord = world.wrap(horizontal ? c.y + (i - 1) * 23 : c.x + (i - 1) * 23);
    carveSumpBand(world, spec, i, horizontal, coord);
    room.name = `${room.name} у черной воды`;
  }
  addSumpCausewayServiceRooms(world, rooms, spec, spawnX, spawnY);
  addSumpEdgeBoothRooms(world, rooms, spec, spawnX, spawnY);
  addSumpConwayLifeRaftClusters(world, rooms, spec, spawnX, spawnY);
  addSumpPercolationRooms(world, rooms, spec, spawnX, spawnY);
  if (ambientChanged > 0) {
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFeaturesDirty(true);
  }
}

function serviceSpineFeature(step: number, line: number): Feature {
  const mode = (step + line * 3) % 4;
  if (mode === 0) return Feature.LAMP;
  if (mode === 1) return Feature.SCREEN;
  if (mode === 2) return Feature.APPARATUS;
  return Feature.MACHINE;
}

const SERVICE_SPINE_PROXY_SIZE = 128;
const SERVICE_SPINE_PROXY_CELL = W / SERVICE_SPINE_PROXY_SIZE;
const SERVICE_SPINE_START = 48;
const SERVICE_SPINE_END = W - 49;
const SERVICE_SPINE_STATION_BASE_TARGET = 14;
const SERVICE_SPINE_SIDE_ROOM_BASE_TARGET = 44;
const SERVICE_SPINE_STATION_MIN_SPACING = 44 * 44;
const SERVICE_SPINE_MICRO_BAY_MIN_SPACING = 16 * 16;

interface ServiceTensorField {
  cos: Float32Array;
  sin: Float32Array;
}

interface ServiceSpineTrace {
  id: number;
  horizontal: boolean;
  cells: number[];
}

interface ServiceSpineJunction {
  x: number;
  y: number;
  score: number;
}

function carveServiceSpineCell(world: World, x: number, y: number): boolean {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT || world.hermoWall[ci] || world.aptMask[ci]) return false;
  if (world.cells[ci] === Cell.DOOR || world.doors.has(ci)) world.removeDoorAt(ci);
  world.cells[ci] = Cell.FLOOR;
  world.floorTex[ci] = Tex.F_CONCRETE;
  world.wallTex[ci] = Tex.METAL;
  world.features[ci] = Feature.NONE;
  world.roomMap[ci] = -1;
  return true;
}

function decorateServiceSpineEdge(world: World, x: number, y: number, feature: Feature, spec: ProceduralFloorSpec, step: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR || world.features[ci] !== Feature.NONE) return;
  world.features[ci] = feature;
  if (feature === Feature.APPARATUS || feature === Feature.MACHINE) {
    stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.34, 0.52, spec.seed + step * 29, 72, 88, 86, false);
  }
}

function serviceHash01(seed: number, a: number, b: number, c = 0): number {
  let x = (seed ^ Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0xc2b2ae35, 0x27d4eb2d) ^ Math.imul(c + 0x165667b1, 0x9e3779b1)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x / 4294967296;
}

function serviceProxyCoord(value: number): number {
  const v = Math.floor(value / SERVICE_SPINE_PROXY_CELL);
  return Math.max(0, Math.min(SERVICE_SPINE_PROXY_SIZE - 1, v));
}

function serviceProxyIndex(px: number, py: number): number {
  const x = ((px % SERVICE_SPINE_PROXY_SIZE) + SERVICE_SPINE_PROXY_SIZE) % SERVICE_SPINE_PROXY_SIZE;
  const y = ((py % SERVICE_SPINE_PROXY_SIZE) + SERVICE_SPINE_PROXY_SIZE) % SERVICE_SPINE_PROXY_SIZE;
  return y * SERVICE_SPINE_PROXY_SIZE + x;
}

function buildServiceTensorField(spec: ProceduralFloorSpec): ServiceTensorField {
  const n = SERVICE_SPINE_PROXY_SIZE * SERVICE_SPINE_PROXY_SIZE;
  const cos = new Float32Array(n);
  const sin = new Float32Array(n);
  const seedPhase = (spec.seed & 4095) / 4096;
  const baseAngle = ((spec.seed >>> 5) & 1) === 0 ? 0 : Math.PI / 2;

  for (let py = 0; py < SERVICE_SPINE_PROXY_SIZE; py++) {
    for (let px = 0; px < SERVICE_SPINE_PROXY_SIZE; px++) {
      const waveA = Math.sin((px + seedPhase * 113) * 0.095) * 0.32;
      const waveB = Math.cos((py - seedPhase * 89) * 0.073) * 0.28;
      const shear = (serviceHash01(spec.seed, px >> 3, py >> 3, 44) - 0.5) * 0.34;
      const angle = baseAngle + waveA + waveB + shear;
      const idx = serviceProxyIndex(px, py);
      cos[idx] = Math.cos(angle);
      sin[idx] = Math.sin(angle);
    }
  }

  return { cos, sin };
}

function serviceTensorDrift(field: ServiceTensorField, worldX: number, worldY: number, horizontal: boolean): number {
  const idx = serviceProxyIndex(serviceProxyCoord(worldX), serviceProxyCoord(worldY));
  const v = horizontal ? field.sin[idx] : field.cos[idx];
  if (v > 0.42) return 1;
  if (v < -0.42) return -1;
  return 0;
}

function clampServiceCoord(value: number): number {
  return Math.max(SERVICE_SPINE_START, Math.min(SERVICE_SPINE_END, Math.floor(value)));
}

function collectServiceSpineBand(world: World, x: number, y: number, horizontal: boolean, cells?: number[]): void {
  for (let side = -1; side <= 1; side++) {
    const cx = horizontal ? x : x + side;
    const cy = horizontal ? y + side : y;
    if (carveServiceSpineCell(world, cx, cy)) cells?.push(world.idx(cx, cy));
  }
}

function carveServiceSpineSegment(
  world: World,
  spec: ProceduralFloorSpec,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  horizontal: boolean,
  line: number,
  stepBase: number,
  cells?: number[],
): number {
  const delta = horizontal ? world.delta(ax, bx) : world.delta(ay, by);
  const stepDir = delta >= 0 ? 1 : -1;
  const steps = Math.abs(delta);
  let x = world.wrap(ax);
  let y = world.wrap(ay);

  for (let s = 0; s <= steps; s++) {
    collectServiceSpineBand(world, x, y, horizontal, cells);

    const absoluteStep = stepBase + s;
    if (absoluteStep % 19 === 0) {
      const side = ((absoluteStep / 19 + line) & 1) === 0 ? -2 : 2;
      const fx = horizontal ? x : x + side;
      const fy = horizontal ? y + side : y;
      decorateServiceSpineEdge(world, fx, fy, serviceSpineFeature(absoluteStep, line), spec, absoluteStep);
    }
    if (absoluteStep % 37 === 0) {
      stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.28, 0.36, spec.seed ^ (absoluteStep * 131 + line * 17), 58, 68, 65, false);
    }

    if (s < steps) {
      if (horizontal) x = world.wrap(x + stepDir);
      else y = world.wrap(y + stepDir);
    }
  }

  return stepBase + steps + 1;
}

function traceServiceTensorSpine(
  world: World,
  spec: ProceduralFloorSpec,
  field: ServiceTensorField,
  line: number,
  horizontal: boolean,
  lane: number,
): ServiceSpineTrace {
  const cells: number[] = [];
  let driftCoord = clampServiceCoord(lane);
  let step = line * 409;

  for (let p = SERVICE_SPINE_START; p <= SERVICE_SPINE_END; p++) {
    if ((p - SERVICE_SPINE_START) % SERVICE_SPINE_PROXY_CELL === 0) {
      const drift = serviceTensorDrift(field, horizontal ? p : driftCoord, horizontal ? driftCoord : p, horizontal);
      const jitter = serviceHash01(spec.seed, line, p >> 3, horizontal ? 71 : 73) > 0.82 ? (line % 2 === 0 ? 1 : -1) : 0;
      driftCoord = clampServiceCoord(driftCoord + drift + jitter);
    }

    const x = horizontal ? p : driftCoord;
    const y = horizontal ? driftCoord : p;
    collectServiceSpineBand(world, x, y, horizontal, cells);

    if (step % 23 === 0) {
      const side = ((step / 23 + line) & 1) === 0 ? -2 : 2;
      const fx = horizontal ? x : x + side;
      const fy = horizontal ? y + side : y;
      decorateServiceSpineEdge(world, fx, fy, serviceSpineFeature(step, line), spec, step);
    }
    if (step % 47 === 0) {
      stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.28, 0.36, spec.seed ^ (step * 131 + line * 17), 58, 68, 65, false);
    }
    step++;
  }

  return { id: line, horizontal, cells };
}

function chooseServiceSpineTargets(world: World, rooms: Room[], sx: number, sy: number, spec: ProceduralFloorSpec): Room[] {
  const candidates = rooms
    .filter(room => room.id !== 0 && room.type !== RoomType.BATHROOM && room.w >= 5 && room.h >= 5)
    .map(room => ({ room, d2: world.dist2(sx, sy, roomCenter(room).x, roomCenter(room).y) }))
    .filter(item => item.d2 > 42 * 42)
    .sort((a, b) => b.d2 - a.d2);
  const window = candidates.slice(0, Math.min(candidates.length, 18));
  const targetCount = Math.min(window.length, 6 + spec.danger);
  const picked: Room[] = [];

  for (let attempt = 0; attempt < targetCount * 10 && picked.length < targetCount; attempt++) {
    const candidate = pick(window).room;
    if (picked.includes(candidate)) continue;
    const c = roomCenter(candidate);
    const tooClose = picked.some(room => world.dist2(c.x, c.y, roomCenter(room).x, roomCenter(room).y) < 80 * 80);
    if (tooClose && attempt < targetCount * 6) continue;
    picked.push(candidate);
  }

  for (const item of window) {
    if (picked.length >= targetCount) break;
    if (!picked.includes(item.room)) picked.push(item.room);
  }
  return picked;
}

function serviceLaneDistance(a: number, b: number): number {
  return Math.abs(a - b);
}

function pushServiceLane(lanes: number[], lane: number, minSpacing: number): void {
  const clamped = clampServiceCoord(lane);
  if (lanes.some(existing => serviceLaneDistance(existing, clamped) < minSpacing)) return;
  lanes.push(clamped);
}

function selectServiceLanes(seed: number, primary: number, anchors: readonly Room[], horizontal: boolean, count: number): number[] {
  const lanes: number[] = [];
  pushServiceLane(lanes, primary, 74);
  for (const room of anchors) {
    const c = roomCenter(room);
    pushServiceLane(lanes, horizontal ? c.y : c.x, 74);
    if (lanes.length >= count) break;
  }
  for (let i = 0; lanes.length < count && i < count * 5; i++) {
    const lane = SERVICE_SPINE_START + Math.floor(serviceHash01(seed, i, count, horizontal ? 81 : 83) * (SERVICE_SPINE_END - SERVICE_SPINE_START));
    pushServiceLane(lanes, lane, 74);
  }
  return lanes;
}

function nearestTraceBridge(world: World, a: ServiceSpineTrace, b: ServiceSpineTrace): { a: number; b: number; d2: number } | null {
  let bestA = -1;
  let bestB = -1;
  let bestD2 = Infinity;
  const stepA = Math.max(1, Math.floor(a.cells.length / 160));
  const stepB = Math.max(1, Math.floor(b.cells.length / 160));

  for (let ai = 0; ai < a.cells.length; ai += stepA) {
    const ac = a.cells[ai];
    const ax = ac % W;
    const ay = (ac / W) | 0;
    for (let bi = 0; bi < b.cells.length; bi += stepB) {
      const bc = b.cells[bi];
      const d2 = world.dist2(ax + 0.5, ay + 0.5, (bc % W) + 0.5, ((bc / W) | 0) + 0.5);
      if (d2 < bestD2) {
        bestD2 = d2;
        bestA = ac;
        bestB = bc;
      }
    }
  }

  return bestA >= 0 && bestB >= 0 ? { a: bestA, b: bestB, d2: bestD2 } : null;
}

function bridgeServiceTraces(
  world: World,
  spec: ProceduralFloorSpec,
  a: ServiceSpineTrace,
  b: ServiceSpineTrace,
  line: number,
  junctions: ServiceSpineJunction[],
): void {
  const bridge = nearestTraceBridge(world, a, b);
  if (!bridge) return;

  const ax = bridge.a % W;
  const ay = (bridge.a / W) | 0;
  const bx = bridge.b % W;
  const by = (bridge.b / W) | 0;
  let step = line * 1301;
  const horizontalFirst = ((spec.seed + a.id * 17 + b.id * 23 + line) & 1) === 0;
  if (horizontalFirst) {
    step = carveServiceSpineSegment(world, spec, ax, ay, bx, ay, true, line, step, a.cells);
    carveServiceSpineSegment(world, spec, bx, ay, bx, by, false, line, step, b.cells);
  } else {
    step = carveServiceSpineSegment(world, spec, ax, ay, ax, by, false, line, step, a.cells);
    carveServiceSpineSegment(world, spec, ax, by, bx, by, true, line, step, b.cells);
  }

  const score = 10_000 - Math.min(9_000, bridge.d2);
  junctions.push({ x: ax, y: ay, score });
  junctions.push({ x: bx, y: by, score: score * 0.9 });
}

function serviceCellIsUtilityMutable(world: World, x: number, y: number): boolean {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT || world.hermoWall[ci] || world.aptMask[ci]) return false;
  if (world.roomMap[ci] >= 0 || world.containerMap.has(ci)) return false;
  return true;
}

function carveServiceUtilityCell(world: World, x: number, y: number): boolean {
  if (!serviceCellIsUtilityMutable(world, x, y)) return false;
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.DOOR || world.doors.has(ci)) world.removeDoorAt(ci);
  world.cells[ci] = Cell.FLOOR;
  world.floorTex[ci] = Tex.F_CONCRETE;
  world.wallTex[ci] = Tex.METAL;
  world.features[ci] = Feature.NONE;
  world.roomMap[ci] = -1;
  return true;
}

function carveServiceUtilityLine(world: World, ax: number, ay: number, bx: number, by: number, horizontal: boolean): void {
  const delta = horizontal ? world.delta(ax, bx) : world.delta(ay, by);
  const stepDir = delta >= 0 ? 1 : -1;
  const steps = Math.abs(delta);
  let x = world.wrap(ax);
  let y = world.wrap(ay);
  for (let s = 0; s <= steps; s++) {
    carveServiceUtilityCell(world, x, y);
    if (s < steps) {
      if (horizontal) x = world.wrap(x + stepDir);
      else y = world.wrap(y + stepDir);
    }
  }
}

function carveServiceRoomCell(world: World, room: Room, x: number, y: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT || world.hermoWall[ci] || world.aptMask[ci] || world.containerMap.has(ci)) return;
  const wasWall = world.cells[ci] === Cell.WALL;
  if (world.cells[ci] === Cell.DOOR || world.doors.has(ci)) world.removeDoorAt(ci);
  world.cells[ci] = Cell.FLOOR;
  world.floorTex[ci] = room.floorTex ?? Tex.F_CONCRETE;
  world.wallTex[ci] = room.wallTex ?? Tex.METAL;
  world.roomMap[ci] = room.id;
  if (wasWall) world.features[ci] = Feature.NONE;
}

function carveServiceRoomLine(world: World, room: Room, ax: number, ay: number, bx: number, by: number, horizontal: boolean): void {
  const delta = horizontal ? world.delta(ax, bx) : world.delta(ay, by);
  const stepDir = delta >= 0 ? 1 : -1;
  const steps = Math.abs(delta);
  let x = world.wrap(ax);
  let y = world.wrap(ay);
  for (let s = 0; s <= steps; s++) {
    carveServiceRoomCell(world, room, x, y);
    if (s < steps) {
      if (horizontal) x = world.wrap(x + stepDir);
      else y = world.wrap(y + stepDir);
    }
  }
}

function ensureServiceRoomCenterSpine(world: World, room: Room): void {
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  for (let dx = 1; dx < room.w - 1; dx++) carveServiceRoomCell(world, room, room.x + dx, cy);
  for (let dy = 1; dy < room.h - 1; dy++) carveServiceRoomCell(world, room, cx, room.y + dy);
}

function connectServiceSideChamber(world: World, room: Room, junction: ServiceSpineJunction): void {
  const center = roomCenter(room);
  const dx = world.delta(junction.x, center.x);
  const dy = world.delta(junction.y, center.y);
  let doorX: number;
  let doorY: number;
  let outsideX: number;
  let outsideY: number;
  let insideX: number;
  let insideY: number;

  if (Math.abs(dx) >= Math.abs(dy)) {
    const fromLeft = dx >= 0;
    doorX = fromLeft ? room.x - 1 : room.x + room.w;
    doorY = Math.max(room.y, Math.min(room.y + room.h - 1, junction.y));
    outsideX = fromLeft ? doorX - 1 : doorX + 1;
    outsideY = doorY;
    insideX = fromLeft ? room.x : room.x + room.w - 1;
    insideY = doorY;
  } else {
    const fromTop = dy >= 0;
    doorX = Math.max(room.x, Math.min(room.x + room.w - 1, junction.x));
    doorY = fromTop ? room.y - 1 : room.y + room.h;
    outsideX = doorX;
    outsideY = fromTop ? doorY - 1 : doorY + 1;
    insideX = doorX;
    insideY = fromTop ? room.y : room.y + room.h - 1;
  }

  const horizontalFirst = Math.abs(world.delta(junction.x, outsideX)) >= Math.abs(world.delta(junction.y, outsideY));
  if (horizontalFirst) {
    carveServiceUtilityLine(world, junction.x, junction.y, outsideX, junction.y, true);
    carveServiceUtilityLine(world, outsideX, junction.y, outsideX, outsideY, false);
  } else {
    carveServiceUtilityLine(world, junction.x, junction.y, junction.x, outsideY, false);
    carveServiceUtilityLine(world, junction.x, outsideY, outsideX, outsideY, true);
  }
  const cx = Math.floor(center.x);
  const cy = Math.floor(center.y);
  const roomHorizontalFirst = Math.abs(world.delta(insideX, cx)) >= Math.abs(world.delta(insideY, cy));
  if (roomHorizontalFirst) {
    carveServiceRoomLine(world, room, insideX, insideY, cx, insideY, true);
    carveServiceRoomLine(world, room, cx, insideY, cx, cy, false);
  } else {
    carveServiceRoomLine(world, room, insideX, insideY, insideX, cy, false);
    carveServiceRoomLine(world, room, insideX, cy, cx, cy, true);
  }
  placeDoorAt(world, doorX, doorY, room.id);
}

function nearestServiceTraceJunction(world: World, traces: readonly ServiceSpineTrace[], room: Room): ServiceSpineJunction | null {
  const center = roomCenter(room);
  let bestIdx = -1;
  let bestD2 = Infinity;
  for (const trace of traces) {
    const step = Math.max(1, Math.floor(trace.cells.length / 180));
    for (let i = 0; i < trace.cells.length; i += step) {
      const ci = trace.cells[i];
      const d2 = world.dist2(center.x, center.y, (ci % W) + 0.5, ((ci / W) | 0) + 0.5);
      if (d2 < bestD2) {
        bestD2 = d2;
        bestIdx = ci;
      }
    }
  }
  return bestIdx >= 0 ? { x: bestIdx % W, y: (bestIdx / W) | 0, score: Math.max(0, 10_000 - bestD2) } : null;
}

function connectServiceTargetRooms(world: World, targetRooms: readonly Room[], traces: readonly ServiceSpineTrace[]): void {
  for (const room of targetRooms) {
    const junction = nearestServiceTraceJunction(world, traces, room);
    if (junction) connectServiceSideChamber(world, room, junction);
  }
}

function serviceStationRoomType(spec: ProceduralFloorSpec, index: number): RoomType {
  if (spec.majorityId === 'scientists') {
    return [RoomType.MEDICAL, RoomType.OFFICE, RoomType.PRODUCTION, RoomType.STORAGE][index % 4];
  }
  if (spec.majorityId === 'liquidators') {
    return [RoomType.PRODUCTION, RoomType.STORAGE, RoomType.OFFICE, RoomType.COMMON][index % 4];
  }
  if (spec.majorityId === 'cultists') {
    return [RoomType.COMMON, RoomType.STORAGE, RoomType.SMOKING, RoomType.PRODUCTION][index % 4];
  }
  if (spec.majorityId === 'wild') {
    return [RoomType.STORAGE, RoomType.COMMON, RoomType.SMOKING, RoomType.PRODUCTION][index % 4];
  }
  return [RoomType.COMMON, RoomType.KITCHEN, RoomType.STORAGE, RoomType.OFFICE][index % 4];
}

function serviceSupportRoomType(spec: ProceduralFloorSpec, index: number): RoomType {
  if (spec.majorityId === 'scientists') {
    return [RoomType.OFFICE, RoomType.MEDICAL, RoomType.STORAGE, RoomType.PRODUCTION, RoomType.BATHROOM][index % 5];
  }
  return [RoomType.STORAGE, RoomType.OFFICE, RoomType.BATHROOM, RoomType.KITCHEN, RoomType.COMMON][index % 5];
}

function serviceMicroBayType(spec: ProceduralFloorSpec, index: number): RoomType {
  if (spec.majorityId === 'scientists') return [RoomType.OFFICE, RoomType.STORAGE, RoomType.MEDICAL, RoomType.PRODUCTION][index % 4];
  return [RoomType.STORAGE, RoomType.OFFICE, RoomType.BATHROOM, RoomType.COMMON][index % 4];
}

function serviceRoomName(spec: ProceduralFloorSpec, type: RoomType, roomId: number, index: number, role: 'station' | 'support' | 'micro'): string {
  const science = spec.majorityId === 'scientists';
  if (role === 'station') {
    if (science && type === RoomType.MEDICAL) return `Полевой пост НИИ сервисного штрека ${roomId}`;
    if (type === RoomType.PRODUCTION) return `Станция насосов сервисного штрека ${roomId}`;
    if (type === RoomType.OFFICE) return `Диспетчерская сервисного штрека ${roomId}`;
    return `Сервисная станция штрека ${roomId}`;
  }
  if (role === 'micro') {
    if (type === RoomType.BATHROOM) return `Микротуалет сервисного штрека ${roomId}`;
    if (type === RoomType.MEDICAL) return `Пробный бокс сервисного штрека ${roomId}`;
    if (type === RoomType.OFFICE) return `Пультовая ниша сервисного штрека ${roomId}`;
    if (type === RoomType.PRODUCTION) return `Аппаратная ниша сервисного штрека ${roomId}`;
    return `Кладовая ниша сервисного штрека ${roomId}`;
  }
  if (type === RoomType.BATHROOM) return `Туалет при станции штрека ${roomId}.${index}`;
  if (type === RoomType.KITCHEN) return `Кипяток при станции штрека ${roomId}.${index}`;
  if (type === RoomType.MEDICAL) return `Медбокс при станции штрека ${roomId}.${index}`;
  if (type === RoomType.PRODUCTION) return `Аппаратная при станции штрека ${roomId}.${index}`;
  if (type === RoomType.OFFICE) return `Сменная контора при станции штрека ${roomId}.${index}`;
  return `Склад при станции штрека ${roomId}.${index}`;
}

function decorateServiceUtilityRoom(world: World, room: Room, spec: ProceduralFloorSpec, seed: number): void {
  const wall = spec.majorityId === 'scientists' && (room.type === RoomType.MEDICAL || room.type === RoomType.OFFICE)
    ? Tex.TILE_W
    : Tex.METAL;
  const floor = spec.majorityId === 'scientists' && room.type === RoomType.MEDICAL
    ? Tex.F_TILE
    : Tex.F_CONCRETE;
  applyRoomTexture(world, room, wall, floor);
  if (room.type === RoomType.PRODUCTION || room.type === RoomType.COMMON || room.type === RoomType.STORAGE) shapeRoom(world, room);
  decorateRoom(world, room);
  decorateProceduralRoom(world, room, spec);
  ensureServiceRoomCenterSpine(world, room);
  const feature = room.type === RoomType.BATHROOM
    ? Feature.TOILET
    : room.type === RoomType.KITCHEN
      ? Feature.SINK
      : room.type === RoomType.OFFICE
        ? Feature.SCREEN
        : room.type === RoomType.STORAGE
          ? Feature.SHELF
          : room.type === RoomType.MEDICAL
            ? Feature.APPARATUS
            : Feature.MACHINE;
  placeRoomFeatureFallback(world, room, feature, Math.floor(room.w / 2), Math.floor(room.h / 2), seed);
}

function tryPlaceServiceSupportRoom(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  hub: Room,
  index: number,
): Room | null {
  const type = serviceSupportRoomType(spec, index);
  const seed = spec.seed ^ (hub.id * 131 + index * 811);
  const width = type === RoomType.BATHROOM ? 5 + (seed & 1) : 6 + Math.floor(serviceHash01(seed, hub.id, index, 109) * 8);
  const height = type === RoomType.BATHROOM ? 5 + ((seed >> 1) & 1) : 5 + Math.floor(serviceHash01(seed, index, hub.id, 111) * 7);
  const dirOrder = [0, 1, 2, 3].sort((a, b) =>
    serviceHash01(seed, hub.id + index, a, 113) - serviceHash01(seed, hub.id + index, b, 113),
  );

  for (const dir of dirOrder) {
    for (let gap = 3; gap <= 12; gap += 3) {
      const lane = 2 + Math.floor(serviceHash01(seed, dir, gap, 115) * Math.max(2, dir < 2 ? hub.h - 4 : hub.w - 4));
      const x = dir === 0
        ? hub.x + hub.w + gap
        : dir === 1
          ? hub.x - gap - width
          : hub.x + lane;
      const y = dir === 2
        ? hub.y + hub.h + gap
        : dir === 3
          ? hub.y - gap - height
          : hub.y + lane;
      if (x < 20 || y < 20 || x + width >= W - 20 || y + height >= W - 20) continue;
      if (!canPlaceRoom(world, x, y, width, height)) continue;
      const room = stampRoom(world, rooms.length, type, x, y, width, height, -1);
      room.name = serviceRoomName(spec, type, hub.id, index + 1, 'support');
      decorateServiceUtilityRoom(world, room, spec, seed);
      rooms.push(room);
      return room;
    }
  }
  return null;
}

function tryPlaceServiceStationCluster(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  junction: ServiceSpineJunction,
  index: number,
): Room[] {
  const seed = spec.seed ^ (junction.x * 17 + junction.y * 31 + index * 127);
  const type = serviceStationRoomType(spec, index);
  const width = 18 + Math.floor(serviceHash01(seed, index, junction.x, 117) * 18);
  const height = 12 + Math.floor(serviceHash01(seed, index, junction.y, 119) * 12);
  const dirOrder = [0, 1, 2, 3].sort((a, b) =>
    serviceHash01(seed, junction.x + index, junction.y, a) - serviceHash01(seed, junction.x + index, junction.y, b),
  );

  for (const dir of dirOrder) {
    for (let gap = 12; gap <= 34; gap += 5) {
      let x = junction.x;
      let y = junction.y;
      if (dir === 0) {
        x = junction.x + gap;
        y = junction.y - Math.floor(height / 2);
      } else if (dir === 1) {
        x = junction.x - gap - width;
        y = junction.y - Math.floor(height / 2);
      } else if (dir === 2) {
        x = junction.x - Math.floor(width / 2);
        y = junction.y + gap;
      } else {
        x = junction.x - Math.floor(width / 2);
        y = junction.y - gap - height;
      }
      x = Math.max(SERVICE_SPINE_START, Math.min(SERVICE_SPINE_END - width, x));
      y = Math.max(SERVICE_SPINE_START, Math.min(SERVICE_SPINE_END - height, y));
      if (!canPlaceRoom(world, x, y, width, height)) continue;

      const hub = stampRoom(world, rooms.length, type, x, y, width, height, -1);
      hub.name = serviceRoomName(spec, type, hub.id, index + 1, 'station');
      decorateServiceUtilityRoom(world, hub, spec, seed);
      rooms.push(hub);

      const cluster = [hub];
      const supportTarget = 3 + (index % 2) + (spec.majorityId === 'scientists' ? 1 : 0);
      for (let support = 0; support < supportTarget; support++) {
        const room = tryPlaceServiceSupportRoom(world, rooms, spec, hub, support + index * 5);
        if (room) cluster.push(room);
      }
      if (cluster.length > 1) connectRoomsMST(world, cluster);
      connectServiceSideChamber(world, hub, junction);
      return cluster;
    }
  }

  return [];
}

function placeServiceStationClusters(world: World, rooms: Room[], spec: ProceduralFloorSpec, junctions: readonly ServiceSpineJunction[]): number {
  const sorted = sortedServiceJunctions(world, junctions, spec.seed ^ 0x51a7);
  const target = Math.min(sorted.length, 8 + spec.danger * 2);
  const centers: { x: number; y: number }[] = [];
  let placed = 0;
  let placedRooms = 0;

  for (const junction of sorted) {
    if (placed >= target) break;
    if (centers.some(center => world.dist2(center.x + 0.5, center.y + 0.5, junction.x + 0.5, junction.y + 0.5) < SERVICE_SPINE_STATION_MIN_SPACING)) continue;
    const cluster = tryPlaceServiceStationCluster(world, rooms, spec, junction, placed);
    if (cluster.length === 0) continue;
    centers.push({ x: junction.x, y: junction.y });
    placed++;
    placedRooms += cluster.length;
  }
  return placedRooms;
}

function tryPlaceServiceMicroBay(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  trace: ServiceSpineTrace,
  cellIdx: number,
  index: number,
): Room | null {
  const type = serviceMicroBayType(spec, index);
  const seed = spec.seed ^ (cellIdx * 37 + index * 151);
  const width = type === RoomType.BATHROOM ? 4 + (seed & 1) : 5 + Math.floor(serviceHash01(seed, trace.id, index, 121) * 6);
  const height = type === RoomType.BATHROOM ? 4 + ((seed >> 1) & 1) : 4 + Math.floor(serviceHash01(seed, index, trace.id, 123) * 6);
  const x0 = cellIdx % W;
  const y0 = (cellIdx / W) | 0;
  const side = serviceHash01(seed, x0, y0, 125) < 0.5 ? -1 : 1;
  const gap = 4 + Math.floor(serviceHash01(seed, x0, y0, 127) * 8);
  const x = trace.horizontal
    ? x0 - Math.floor(width / 2)
    : x0 + side * gap + (side < 0 ? -width : 0);
  const y = trace.horizontal
    ? y0 + side * gap + (side < 0 ? -height : 0)
    : y0 - Math.floor(height / 2);
  if (x < SERVICE_SPINE_START || y < SERVICE_SPINE_START || x + width >= SERVICE_SPINE_END || y + height >= SERVICE_SPINE_END) return null;
  if (!canPlaceRoom(world, x, y, width, height)) return null;

  const room = stampRoom(world, rooms.length, type, x, y, width, height, -1);
  room.name = serviceRoomName(spec, type, room.id, index + 1, 'micro');
  decorateServiceUtilityRoom(world, room, spec, seed);
  connectServiceSideChamber(world, room, { x: x0, y: y0, score: 5000 });
  rooms.push(room);
  return room;
}

function placeServiceMicroBays(world: World, rooms: Room[], spec: ProceduralFloorSpec, traces: readonly ServiceSpineTrace[]): number {
  if (traces.length === 0) return 0;
  const target = Math.min(136, 48 + spec.danger * 16 + (spec.anomalyId === 'conveyor_sorter' ? 24 : 0));
  const centers: { x: number; y: number }[] = [];
  let placed = 0;

  for (let attempt = 0; placed < target && attempt < target * 16; attempt++) {
    const trace = traces[(spec.seed + attempt * 7) % traces.length];
    if (!trace || trace.cells.length === 0) continue;
    const cellIdx = trace.cells[(spec.seed + attempt * 193) % trace.cells.length];
    const x = cellIdx % W;
    const y = (cellIdx / W) | 0;
    if (centers.some(center => world.dist2(center.x + 0.5, center.y + 0.5, x + 0.5, y + 0.5) < SERVICE_SPINE_MICRO_BAY_MIN_SPACING)) continue;
    const room = tryPlaceServiceMicroBay(world, rooms, spec, trace, cellIdx, placed);
    if (!room) continue;
    const center = roomCenter(room);
    centers.push(center);
    placed++;
  }
  return placed;
}

function sortedServiceJunctions(world: World, junctions: readonly ServiceSpineJunction[], seed: number): ServiceSpineJunction[] {
  const out: ServiceSpineJunction[] = [];
  const cellSize = 32;
  const gridW = W / cellSize; // 32
  const grid = new Map<number, ServiceSpineJunction[]>();

  for (const j of junctions) {
    // The coordinate system wraps over W
    let jx = j.x % W;
    if (jx < 0) jx += W;
    let jy = j.y % W;
    if (jy < 0) jy += W;

    const gx = Math.floor(jx / cellSize);
    const gy = Math.floor(jy / cellSize);

    let existing: ServiceSpineJunction | undefined;

    outer: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        let nx = gx + dx;
        let ny = gy + dy;

        // Wrap around
        if (nx < 0) nx += gridW;
        else if (nx >= gridW) nx -= gridW;
        if (ny < 0) ny += gridW;
        else if (ny >= gridW) ny -= gridW;

        const key = ny * gridW + nx;
        const cellItems = grid.get(key);
        if (cellItems) {
          for (const item of cellItems) {
            if (world.dist2(item.x + 0.5, item.y + 0.5, j.x + 0.5, j.y + 0.5) < 676) { // 26 * 26
              existing = item;
              break outer;
            }
          }
        }
      }
    }

    if (existing) {
      existing.score = Math.max(existing.score, j.score);
      continue;
    }

    const newItem = { ...j };
    out.push(newItem);

    const key = gy * gridW + gx;
    let cellItems = grid.get(key);
    if (!cellItems) {
      cellItems = [];
      grid.set(key, cellItems);
    }
    cellItems.push(newItem);
  }

  out.sort((a, b) => (b.score + serviceHash01(seed, b.x, b.y, 91)) - (a.score + serviceHash01(seed, a.x, a.y, 91)));
  return out;
}

function tryPlaceServiceSideChamber(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  junction: ServiceSpineJunction,
  index: number,
): Room | null {
  const width = 8 + Math.floor(serviceHash01(spec.seed, junction.x, index, 101) * 8);
  const height = 7 + Math.floor(serviceHash01(spec.seed, junction.y, index, 103) * 7);
  const type = index % 4 === 0
    ? RoomType.PRODUCTION
    : index % 4 === 1
      ? RoomType.STORAGE
      : index % 4 === 2
        ? RoomType.OFFICE
        : RoomType.COMMON;
  const dirOrder = [0, 1, 2, 3].sort((a, b) =>
    serviceHash01(spec.seed, junction.x + index, junction.y, a) - serviceHash01(spec.seed, junction.x + index, junction.y, b),
  );

  for (const dir of dirOrder) {
    for (let gap = 8; gap <= 22; gap += 4) {
      let x = junction.x;
      let y = junction.y;
      if (dir === 0) {
        x = junction.x + gap;
        y = junction.y - Math.floor(height / 2);
      } else if (dir === 1) {
        x = junction.x - gap - width;
        y = junction.y - Math.floor(height / 2);
      } else if (dir === 2) {
        x = junction.x - Math.floor(width / 2);
        y = junction.y + gap;
      } else {
        x = junction.x - Math.floor(width / 2);
        y = junction.y - gap - height;
      }
      x = Math.max(SERVICE_SPINE_START, Math.min(SERVICE_SPINE_END - width, x));
      y = Math.max(SERVICE_SPINE_START, Math.min(SERVICE_SPINE_END - height, y));
      if (!canPlaceRoom(world, x, y, width, height)) continue;

      const room = stampRoom(world, rooms.length, type, x, y, width, height, -1);
      room.name = type === RoomType.STORAGE
        ? `Щитовой карман сервисного штрека ${room.id}`
        : type === RoomType.PRODUCTION
          ? `Насосный байпас сервисного штрека ${room.id}`
          : `Боковая камера сервисного штрека ${room.id}`;
      applyRoomTexture(world, room, Tex.METAL, Tex.F_CONCRETE);
      if (type === RoomType.PRODUCTION || type === RoomType.COMMON) shapeRoom(world, room);
      decorateRoom(world, room);
      decorateProceduralRoom(world, room, spec);
      ensureServiceRoomCenterSpine(world, room);
      const feature = type === RoomType.OFFICE ? Feature.SCREEN : type === RoomType.STORAGE ? Feature.APPARATUS : Feature.MACHINE;
      placeRoomFeature(world, room, feature, Math.floor(room.w / 2), Math.floor(room.h / 2));
      connectServiceSideChamber(world, room, junction);
      rooms.push(room);
      return room;
    }
  }

  return null;
}

const SERVICE_STATION_ROOM_TYPES = [
  RoomType.PRODUCTION,
  RoomType.STORAGE,
  RoomType.OFFICE,
  RoomType.BATHROOM,
  RoomType.KITCHEN,
  RoomType.COMMON,
] as const;

function serviceStationRoomSize(type: RoomType, spec: ProceduralFloorSpec, serial: number): { w: number; h: number } {
  const hash = Math.floor(serviceHash01(spec.seed, serial, type, 0x510) * 10_000);
  if (type === RoomType.BATHROOM) return { w: 4 + (hash & 1), h: 4 + ((hash >> 1) & 1) };
  if (type === RoomType.KITCHEN) return { w: 5 + (hash % 3), h: 5 + ((hash >> 2) % 3) };
  if (type === RoomType.OFFICE) return { w: 6 + (hash % 4), h: 5 + ((hash >> 3) % 3) };
  if (type === RoomType.STORAGE) return { w: 6 + (hash % 5), h: 5 + ((hash >> 4) % 4) };
  if (type === RoomType.PRODUCTION) return { w: 10 + (hash % 7), h: 8 + ((hash >> 5) % 5) };
  return { w: 7 + (hash % 5), h: 6 + ((hash >> 6) % 4) };
}

function serviceStationRoomName(type: RoomType, id: number, block: number, micro: boolean): string {
  const scale = micro ? 'инспекционная клетка' : 'станция';
  if (type === RoomType.PRODUCTION) return `${scale} насосов сервисного штрека ${block}.${id}`;
  if (type === RoomType.STORAGE) return `${scale} склада сервисного штрека ${block}.${id}`;
  if (type === RoomType.OFFICE) return `${scale} пульта сервисного штрека ${block}.${id}`;
  if (type === RoomType.BATHROOM) return `${scale} санузла сервисного штрека ${block}.${id}`;
  if (type === RoomType.KITCHEN) return `${scale} кипятка сервисного штрека ${block}.${id}`;
  return `${scale} отдыха сервисного штрека ${block}.${id}`;
}

function decorateServiceStationRoom(world: World, room: Room, spec: ProceduralFloorSpec, serial: number): void {
  applyRoomTexture(world, room, Tex.METAL, room.type === RoomType.BATHROOM || room.type === RoomType.KITCHEN ? Tex.F_TILE : Tex.F_CONCRETE);
  decorateRoom(world, room);
  decorateProceduralRoom(world, room, spec);
  ensureServiceRoomCenterSpine(world, room);
  if (room.type === RoomType.PRODUCTION) placeRoomFeature(world, room, Feature.MACHINE, Math.floor(room.w / 2), Math.floor(room.h / 2));
  else if (room.type === RoomType.STORAGE) placeRoomFeature(world, room, Feature.SHELF, Math.floor(room.w / 2), Math.floor(room.h / 2));
  else if (room.type === RoomType.OFFICE) placeRoomFeature(world, room, Feature.SCREEN, Math.floor(room.w / 2), Math.floor(room.h / 2));
  else if (room.type === RoomType.BATHROOM) {
    placeRoomFeature(world, room, Feature.TOILET, 1, 1);
    placeRoomFeature(world, room, Feature.SINK, room.w - 2, 1);
  } else if (room.type === RoomType.KITCHEN) {
    placeRoomFeature(world, room, Feature.SINK, 1, 1);
    placeRoomFeature(world, room, Feature.STOVE, room.w - 2, 1);
  } else {
    placeRoomFeature(world, room, serial % 2 === 0 ? Feature.TABLE : Feature.LAMP, Math.floor(room.w / 2), Math.floor(room.h / 2));
  }
}

function serviceClampRoomOrigin(value: number, size: number): number {
  return Math.max(SERVICE_SPINE_START, Math.min(SERVICE_SPINE_END - size, Math.floor(value)));
}

function serviceStationLayout(spec: ProceduralFloorSpec, block: number): { type: RoomType; x: number; y: number; w: number; h: number }[] {
  const main = serviceStationRoomSize(RoomType.PRODUCTION, spec, block * 11 + 1);
  const storage = serviceStationRoomSize(RoomType.STORAGE, spec, block * 11 + 2);
  const office = serviceStationRoomSize(RoomType.OFFICE, spec, block * 11 + 3);
  const utilityType = block % 3 === 0 ? RoomType.KITCHEN : block % 3 === 1 ? RoomType.BATHROOM : RoomType.COMMON;
  const utility = serviceStationRoomSize(utilityType, spec, block * 11 + 4);
  const gap = 3;
  const layout = [
    { type: RoomType.PRODUCTION, x: 0, y: 0, w: main.w, h: main.h },
    { type: RoomType.STORAGE, x: main.w + gap, y: 0, w: storage.w, h: storage.h },
    { type: RoomType.OFFICE, x: 0, y: main.h + gap, w: office.w, h: office.h },
    { type: utilityType, x: main.w + gap, y: main.h + gap, w: utility.w, h: utility.h },
  ];
  if (spec.anomalyId === 'samosbor_seed' || spec.danger >= 4) {
    const microType = block % 2 === 0 ? RoomType.BATHROOM : RoomType.STORAGE;
    const micro = serviceStationRoomSize(microType, spec, block * 11 + 5);
    layout.push({ type: microType, x: Math.floor(main.w * 0.45), y: main.h + gap + Math.max(office.h, utility.h) + gap, w: micro.w, h: micro.h });
  }
  return layout;
}

function canPlaceServiceStationLayout(
  world: World,
  layout: readonly { x: number; y: number; w: number; h: number }[],
  x: number,
  y: number,
): boolean {
  for (const item of layout) {
    if (!canPlaceRoom(world, x + item.x, y + item.y, item.w, item.h)) return false;
  }
  return true;
}

function stampServiceStationBlock(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  junction: ServiceSpineJunction,
  layout: readonly { type: RoomType; x: number; y: number; w: number; h: number }[],
  x: number,
  y: number,
  block: number,
): Room[] {
  const cluster: Room[] = [];
  for (let i = 0; i < layout.length; i++) {
    const item = layout[i];
    const room = stampRoom(world, world.rooms.length, item.type, x + item.x, y + item.y, item.w, item.h, -1);
    room.name = serviceStationRoomName(item.type, room.id, block, false);
    decorateServiceStationRoom(world, room, spec, block * 13 + i);
    rooms.push(room);
    cluster.push(room);
  }
  connectRoomsMST(world, cluster);
  if (cluster[0]) connectServiceSideChamber(world, cluster[0], junction);
  return cluster;
}

function tryPlaceServiceStationBlock(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  junction: ServiceSpineJunction,
  block: number,
): Room[] {
  const layout = serviceStationLayout(spec, block);
  const groupW = Math.max(...layout.map(item => item.x + item.w));
  const groupH = Math.max(...layout.map(item => item.y + item.h));
  const directions = [0, 1, 2, 3].sort((a, b) =>
    serviceHash01(spec.seed, junction.x + block, junction.y, a + 0x620) -
    serviceHash01(spec.seed, junction.x + block, junction.y, b + 0x620),
  );

  for (const dir of directions) {
    for (let gap = 12; gap <= 42; gap += 6) {
      let x = junction.x - Math.floor(groupW / 2);
      let y = junction.y - Math.floor(groupH / 2);
      if (dir === 0) x = junction.x + gap;
      else if (dir === 1) x = junction.x - gap - groupW;
      else if (dir === 2) y = junction.y + gap;
      else y = junction.y - gap - groupH;
      x = serviceClampRoomOrigin(x, groupW);
      y = serviceClampRoomOrigin(y, groupH);
      if (!canPlaceServiceStationLayout(world, layout, x, y)) continue;
      return stampServiceStationBlock(world, rooms, spec, junction, layout, x, y, block);
    }
  }
  return [];
}

function placeServiceStationBlocks(world: World, rooms: Room[], spec: ProceduralFloorSpec, junctions: readonly ServiceSpineJunction[]): number {
  const sorted = sortedServiceJunctions(world, junctions, spec.seed ^ 0x5ab10c);
  const target = Math.min(sorted.length, SERVICE_SPINE_STATION_BASE_TARGET + spec.danger * 2 + (spec.anomalyId === 'samosbor_seed' ? 4 : 0) + (spec.anomalyId === 'conveyor_sorter' ? 6 : 0));
  let placedRooms = 0;
  let placedBlocks = 0;
  for (const junction of sorted) {
    if (placedBlocks >= target) break;
    const cluster = tryPlaceServiceStationBlock(world, rooms, spec, junction, placedBlocks);
    if (cluster.length === 0) continue;
    placedBlocks++;
    placedRooms += cluster.length;
  }
  return placedRooms;
}

function nearestServiceTracePoint(world: World, traces: readonly ServiceSpineTrace[], x: number, y: number): ServiceSpineJunction | null {
  let bestIdx = -1;
  let bestD2 = Infinity;
  for (const trace of traces) {
    const step = Math.max(1, Math.floor(trace.cells.length / 220));
    for (let i = 0; i < trace.cells.length; i += step) {
      const ci = trace.cells[i];
      const d2 = world.dist2(x + 0.5, y + 0.5, (ci % W) + 0.5, ((ci / W) | 0) + 0.5);
      if (d2 < bestD2) {
        bestD2 = d2;
        bestIdx = ci;
      }
    }
  }
  return bestIdx >= 0 ? { x: bestIdx % W, y: (bestIdx / W) | 0, score: Math.max(0, 12_000 - bestD2) } : null;
}

function placeServiceSpanStations(world: World, rooms: Room[], spec: ProceduralFloorSpec, traces: readonly ServiceSpineTrace[]): number {
  const cols = 10;
  const rows = 10;
  const span = SERVICE_SPINE_END - SERVICE_SPINE_START;
  const slotW = span / cols;
  const slotH = span / rows;
  const candidates = Array.from({ length: cols * rows }, (_, slot) => ({
    slot,
    score: serviceHash01(spec.seed, slot, spec.ordinal, 0x7a11),
  })).sort((a, b) => a.score - b.score);
  const target = SERVICE_SPINE_STATION_BASE_TARGET + spec.danger * 3 + (spec.anomalyId === 'samosbor_seed' ? 7 : 0);
  const centers: { x: number; y: number }[] = [];
  let placedBlocks = 0;
  let placedRooms = 0;

  for (const candidate of candidates) {
    if (placedBlocks >= target) break;
    const col = candidate.slot % cols;
    const row = (candidate.slot / cols) | 0;
    const cx = Math.floor(SERVICE_SPINE_START + col * slotW + slotW * (0.22 + serviceHash01(spec.seed, col, row, 0x7a12) * 0.56));
    const cy = Math.floor(SERVICE_SPINE_START + row * slotH + slotH * (0.22 + serviceHash01(spec.seed, row, col, 0x7a13) * 0.56));
    if (centers.some(center => world.dist2(center.x, center.y, cx, cy) < 42 * 42)) continue;
    const trace = nearestServiceTracePoint(world, traces, cx, cy);
    if (!trace) continue;
    const traceDistance2 = world.dist2(cx + 0.5, cy + 0.5, trace.x + 0.5, trace.y + 0.5);
    if (traceDistance2 < 24 * 24 || traceDistance2 > 180 * 180) continue;

    const layout = serviceStationLayout(spec, 100 + placedBlocks);
    const groupW = Math.max(...layout.map(item => item.x + item.w));
    const groupH = Math.max(...layout.map(item => item.y + item.h));
    const x = serviceClampRoomOrigin(cx - Math.floor(groupW / 2), groupW);
    const y = serviceClampRoomOrigin(cy - Math.floor(groupH / 2), groupH);
    if (!canPlaceServiceStationLayout(world, layout, x, y)) continue;
    const cluster = stampServiceStationBlock(world, rooms, spec, trace, layout, x, y, 100 + placedBlocks);
    if (cluster.length === 0) continue;
    centers.push({ x: cx, y: cy });
    placedBlocks++;
    placedRooms += cluster.length;
  }
  return placedRooms;
}

function serviceMicroRoomType(spec: ProceduralFloorSpec, serial: number): RoomType {
  const pool = spec.anomalyId === 'samosbor_seed'
    ? [RoomType.STORAGE, RoomType.BATHROOM, RoomType.OFFICE, RoomType.COMMON, RoomType.PRODUCTION, RoomType.KITCHEN]
    : SERVICE_STATION_ROOM_TYPES;
  return pool[serial % pool.length];
}

function tryPlaceServiceMicroRoom(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  junction: ServiceSpineJunction,
  serial: number,
): Room | null {
  const type = serviceMicroRoomType(spec, serial);
  const size = serviceStationRoomSize(type, spec, serial + 1000);
  const directions = [0, 1, 2, 3].sort((a, b) =>
    serviceHash01(spec.seed, junction.x + serial, junction.y, a + 0x710) -
    serviceHash01(spec.seed, junction.x + serial, junction.y, b + 0x710),
  );
  for (const dir of directions) {
    for (let gap = 6; gap <= 28; gap += 4) {
      let x = junction.x - Math.floor(size.w / 2);
      let y = junction.y - Math.floor(size.h / 2);
      if (dir === 0) x = junction.x + gap;
      else if (dir === 1) x = junction.x - gap - size.w;
      else if (dir === 2) y = junction.y + gap;
      else y = junction.y - gap - size.h;
      x = serviceClampRoomOrigin(x, size.w);
      y = serviceClampRoomOrigin(y, size.h);
      if (!canPlaceRoom(world, x, y, size.w, size.h)) continue;
      const room = stampRoom(world, world.rooms.length, type, x, y, size.w, size.h, -1);
      room.name = serviceStationRoomName(type, room.id, serial, true);
      decorateServiceStationRoom(world, room, spec, serial + 2000);
      connectServiceSideChamber(world, room, junction);
      rooms.push(room);
      return room;
    }
  }
  return null;
}

function placeServiceMicroRooms(world: World, rooms: Room[], spec: ProceduralFloorSpec, junctions: readonly ServiceSpineJunction[]): number {
  const sorted = sortedServiceJunctions(world, junctions, spec.seed ^ 0xc1a55);
  if (sorted.length === 0) return 0;
  const target = Math.min(128, SERVICE_SPINE_SIDE_ROOM_BASE_TARGET + spec.danger * 10 + (spec.anomalyId === 'samosbor_seed' ? 16 : 0) + (spec.anomalyId === 'conveyor_sorter' ? 28 : 0));
  let placed = 0;
  for (let attempt = 0; attempt < target * 8 && placed < target; attempt++) {
    const source = sorted[(attempt * 5 + spec.ordinal + (spec.seed & 7)) % sorted.length];
    const junction = {
      x: world.wrap(source.x + Math.round((serviceHash01(spec.seed, attempt, source.x, 0x716) - 0.5) * 30)),
      y: world.wrap(source.y + Math.round((serviceHash01(spec.seed, attempt, source.y, 0x717) - 0.5) * 30)),
      score: source.score,
    };
    if (tryPlaceServiceMicroRoom(world, rooms, spec, junction, placed + attempt)) placed++;
  }
  return placed;
}

function placeServiceSideChambers(world: World, rooms: Room[], spec: ProceduralFloorSpec, junctions: readonly ServiceSpineJunction[]): void {
  const sorted = sortedServiceJunctions(world, junctions, spec.seed);
  const target = Math.min(sorted.length, Math.floor(SERVICE_SPINE_SIDE_ROOM_BASE_TARGET * 0.5) + spec.danger * 3 + (spec.anomalyId === 'samosbor_seed' ? 5 : 0) + (spec.anomalyId === 'conveyor_sorter' ? 10 : 0));
  let placed = 0;
  for (const junction of sorted) {
    if (placed >= target) break;
    if (tryPlaceServiceSideChamber(world, rooms, spec, junction, placed)) placed++;
  }
}

function appendServiceTraceJunctions(junctions: ServiceSpineJunction[], traces: readonly ServiceSpineTrace[], spec: ProceduralFloorSpec): void {
  const spacing = Math.max(52, 94 - spec.danger * 6);
  for (const trace of traces) {
    if (trace.cells.length === 0) continue;
    const start = Math.floor(spacing * (0.3 + serviceHash01(spec.seed, trace.id, trace.cells.length, 0x811) * 0.45));
    for (let i = start; i < trace.cells.length; i += spacing) {
      const ci = trace.cells[i];
      const x = ci % W;
      const y = (ci / W) | 0;
      junctions.push({
        x,
        y,
        score: 2_400 + serviceHash01(spec.seed, x, y, trace.id + 0x812) * 1_600,
      });
    }
  }
}

function applyServiceSpines(world: World, rooms: Room[], spec: ProceduralFloorSpec, spawnX: number, spawnY: number): void {
  if (spec.geometryId !== 'service_spines') return;
  const sx = Math.floor(spawnX);
  const sy = Math.floor(spawnY);
  const targets = chooseServiceSpineTargets(world, rooms, sx, sy, spec);
  const field = buildServiceTensorField(spec);
  const conveyorBonus = spec.anomalyId === 'conveyor_sorter' ? 1 : 0;
  const horizontalCount = 3 + (spec.danger >= 3 ? 1 : 0) + (spec.danger >= 5 ? 1 : 0) + conveyorBonus;
  const verticalCount = 3 + (spec.danger >= 3 ? 1 : 0) + conveyorBonus;
  const horizontalLanes = selectServiceLanes(spec.seed, sy, targets, true, horizontalCount);
  const verticalLanes = selectServiceLanes(spec.seed ^ 0x5eeda11, sx, targets, false, verticalCount);
  const horizontal: ServiceSpineTrace[] = [];
  const vertical: ServiceSpineTrace[] = [];
  const junctions: ServiceSpineJunction[] = [];

  for (let i = 0; i < horizontalLanes.length; i++) {
    horizontal.push(traceServiceTensorSpine(world, spec, field, i, true, horizontalLanes[i]));
  }
  for (let i = 0; i < verticalLanes.length; i++) {
    vertical.push(traceServiceTensorSpine(world, spec, field, i + horizontal.length, false, verticalLanes[i]));
  }

  let bridgeLine = 0;
  for (const h of horizontal) {
    for (const v of vertical) {
      bridgeServiceTraces(world, spec, h, v, bridgeLine++, junctions);
    }
  }
  for (let i = 0; i < horizontal.length - 1; i++) bridgeServiceTraces(world, spec, horizontal[i], horizontal[i + 1], bridgeLine++, junctions);
  for (let i = 0; i < vertical.length - 1; i++) bridgeServiceTraces(world, spec, vertical[i], vertical[i + 1], bridgeLine++, junctions);
  const traces = [...horizontal, ...vertical];
  appendServiceTraceJunctions(junctions, traces, spec);

  const traceRooms = targets.slice(0, Math.min(targets.length, horizontal.length + vertical.length));
  connectServiceTargetRooms(world, traceRooms, traces);
  for (let i = 0; i < traceRooms.length; i++) {
    targets[i].name = `${targets[i].name} у магистрали сервисного штрека`;
  }
  placeServiceSideChambers(world, rooms, spec, junctions);
  const stationClusterRooms = placeServiceStationClusters(world, rooms, spec, junctions);
  const microBayRooms = placeServiceMicroBays(world, rooms, spec, traces);
  const extraRooms = stationClusterRooms +
    microBayRooms +
    placeServiceStationBlocks(world, rooms, spec, junctions) +
    placeServiceSpanStations(world, rooms, spec, traces) +
    placeServiceMicroRooms(world, rooms, spec, junctions);
  if (extraRooms > 0) {
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFeaturesDirty(true);
  }
}

function applySmog(
  world: World,
  rooms: Room[],
  entities: Entity[],
  nextId: { v: number },
  spec: ProceduralFloorSpec,
  allowNpcs: boolean,
): void {
  if (spec.anomalyId === 'smog') {
    const source = chooseSmogSourceRoom(rooms);
    if (!source) return;
    const set = new Set<number>();
    const field = buildSmogProxyField(source, spec);
    const affectedRooms = nearbySmogRooms(world, rooms, source, spec);
    for (const room of affectedRooms) {
      fillSmogRoom(world, set, room, source, spec, field);
      const center = roomCenter(room);
      const zid = world.zoneMap[world.idx(Math.floor(center.x), Math.floor(center.y))];
      const zone = world.zones[zid];
      if (zone) zone.fogged = true;
    }
    seedSmogCorridorPockets(world, set, source, spec, field);
    const sourcePos = placeSmogSource(world, source, spec, set, field);
    dropSmogItemNear(world, entities, nextId, sourcePos.x + 1, sourcePos.y, 'valve_tag', 1);
    dropSmogItemNear(world, entities, nextId, sourcePos.x - 1, sourcePos.y, chance(0.5) ? 'filter_receipt' : 'gasmask_filter', 1);
    placeSmogFilterPockets(world, rooms, entities, nextId, source, affectedRooms, field, spec, set);
    const pressureRooms = affectedRooms.length > 0 ? affectedRooms : [source];
    if (allowNpcs) {
      for (let i = 0; i < Math.min(5, 2 + spec.danger); i++) spawnSmogLooter(world, pick(pressureRooms), entities, nextId, spec);
    }
    for (let i = 0; i < 2 + spec.danger; i++) spawnSmogMonster(world, pick(pressureRooms), entities, nextId, spec);
    world.anomalySmogCells = [...set];
    world.markFogDirty();
    return;
  }

  if (spec.anomalyId !== 'samosbor_seed') return;
  const amount = 16000;
  for (let i = 0; i < amount; i++) {
    const x = irng(0, W - 1);
    const y = irng(0, W - 1);
    const ci = world.idx(x, y);
    if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) continue;
    world.fog[ci] = Math.max(world.fog[ci], irng(45, 120));
  }
  world.markFogDirty();
}

function canPaintSamosborSeedCell(world: World, ci: number): boolean {
  return world.aptMask[ci] === 0 &&
    world.hermoWall[ci] === 0 &&
    world.cells[ci] !== Cell.LIFT &&
    world.features[ci] !== Feature.LIFT_BUTTON;
}

function chooseSamosborSeedBreachRoom(world: World, rooms: Room[], spec: ProceduralFloorSpec, sx: number, sy: number): Room | null {
  const candidates = rooms
    .filter(room => room.id !== 0 && !room.sealed && room.w >= 5 && room.h >= 5 && room.type !== RoomType.BATHROOM)
    .map(room => {
      const c = roomCenter(room);
      const d2 = world.dist2(sx, sy, c.x + 0.5, c.y + 0.5);
      const size = room.w * room.h;
      const typeScore = room.type === RoomType.PRODUCTION || room.type === RoomType.STORAGE ? 80 : room.type === RoomType.COMMON ? 48 : 0;
      return { room, score: Math.min(180, Math.sqrt(d2)) + size * 0.18 + typeScore + ((spec.seed + room.id * 17) % 23) };
    })
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.room ?? rooms.find(room => room.id !== 0) ?? null;
}

function chooseSamosborSeedShelterRoom(world: World, rooms: Room[], breach: Room | null, sx: number, sy: number): Room | null {
  const breachCenter = breach ? roomCenter(breach) : { x: sx, y: sy };
  const candidates = rooms
    .filter(room => room.id !== 0 && room.id !== breach?.id && room.w >= 5 && room.h >= 5)
    .map(room => {
      const c = roomCenter(room);
      const nameShelter = room.name.startsWith('Гражданское укрытие') ||
        room.name.startsWith('Тихая ниша укрытия') ||
        room.name.startsWith('Убежищный отросток');
      const cleanType = room.type === RoomType.COMMON || room.type === RoomType.STORAGE || room.type === RoomType.LIVING || room.type === RoomType.OFFICE;
      const spawnDist = Math.sqrt(world.dist2(sx, sy, c.x + 0.5, c.y + 0.5));
      const breachDist = Math.sqrt(world.dist2(breachCenter.x + 0.5, breachCenter.y + 0.5, c.x + 0.5, c.y + 0.5));
      return {
        room,
        score: (nameShelter ? 220 : 0) + (cleanType ? 70 : 0) + Math.min(100, breachDist) - Math.min(80, spawnDist * 0.35),
      };
    })
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.room ?? null;
}

function paintSamosborSeedBreach(world: World, room: Room, spec: ProceduralFloorSpec): { x: number; y: number } | null {
  const center = roomCenter(room);
  const rx = Math.max(3, room.w * 0.48);
  const ry = Math.max(3, room.h * 0.48);
  let painted = 0;
  room.name = `Семя самосбора ${room.id}: мясной разлом`;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const ci = world.idx(x, y);
      if (!canPaintSamosborSeedCell(world, ci)) continue;
      const nx = (x - center.x) / rx;
      const ny = (y - center.y) / ry;
      const d2 = nx * nx + ny * ny;
      if (world.cells[ci] === Cell.WALL && d2 <= 1.12) {
        world.wallTex[ci] = d2 < 0.72 ? Tex.MEAT : Tex.GUT;
        continue;
      }
      if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) continue;
      if (world.roomMap[ci] !== room.id && d2 > 0.78) continue;
      world.floorTex[ci] = d2 < 0.5 ? Tex.F_MEAT : Tex.F_GUT;
      world.fog[ci] = Math.max(world.fog[ci], Math.round(82 + Math.max(0, 1 - d2) * 72));
      if (world.features[ci] === Feature.NONE && !world.containerMap.has(ci) && ((dx * 13 + dy * 7 + spec.seed) & 31) === 0) {
        world.features[ci] = Feature.APPARATUS;
      }
      if ((painted % 17) === 0) {
        stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.42, 0.72, spec.seed ^ (painted * 97 + room.id), 116, 30, 42, false);
      }
      painted++;
    }
  }
  const zone = world.zones[world.zoneMap[world.idx(center.x, center.y)]];
  if (zone) {
    zone.faction = ZoneFaction.SAMOSBOR;
    zone.level = Math.max(zone.level, Math.min(5, spec.danger + 1));
    zone.fogged = true;
  }
  const centerIdx = world.idx(center.x, center.y);
  if (world.cells[centerIdx] === Cell.FLOOR && world.features[centerIdx] === Feature.NONE && !world.containerMap.has(centerIdx)) {
    world.features[centerIdx] = Feature.APPARATUS;
  }
  stampSurfaceSplat(world, center.x, center.y, 0.5, 0.5, 0.75, 0.88, spec.seed ^ 0x5a0b0, 135, 20, 34, false);
  stampSurfaceSplat(world, center.x, center.y, 0.5, 0.5, 0.52, 0.58, spec.seed ^ 0x51e, 42, 105, 76, false);
  return roomCell(world, room, Math.floor(room.w / 2), Math.floor(room.h / 2)) ?? center;
}

function paintSamosborSeedTrail(world: World, spec: ProceduralFloorSpec, from: { x: number; y: number }, to: { x: number; y: number }): void {
  const dx = world.delta(from.x, to.x);
  const dy = world.delta(from.y, to.y);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = world.wrap(Math.round(from.x + dx * t));
    const y = world.wrap(Math.round(from.y + dy * t));
    for (let side = -1; side <= 1; side++) {
      const sx = world.wrap(x + (Math.abs(dx) >= Math.abs(dy) ? 0 : side));
      const sy = world.wrap(y + (Math.abs(dx) >= Math.abs(dy) ? side : 0));
      const ci = world.idx(sx, sy);
      if (!canPaintSamosborSeedCell(world, ci) || (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER)) continue;
      if ((i + side + spec.seed) % 3 !== 0) continue;
      world.floorTex[ci] = i % 4 === 0 ? Tex.F_GUT : world.floorTex[ci];
      world.fog[ci] = Math.max(world.fog[ci], 42 + Math.round((1 - t) * 34));
      if (i % 13 === 0) stampSurfaceSplat(world, sx, sy, 0.5, 0.5, 0.28, 0.5, spec.seed ^ (i * 131 + side), 92, 24, 36, false);
    }
  }
}

function paintSamosborSeedProtectedShell(world: World, room: Room, spec: ProceduralFloorSpec): { x: number; y: number } | null {
  const center = roomCenter(room);
  if (!room.name.startsWith('Гражданское укрытие') && !room.name.startsWith('Тихая ниша укрытия') && !room.name.startsWith('Убежищный отросток')) {
    room.name = `Чистый отступ ${room.id}`;
  }
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const ci = world.idx(x, y);
      if (!canPaintSamosborSeedCell(world, ci)) continue;
      if (world.cells[ci] === Cell.WALL && world.roomMap[world.idx(center.x, center.y)] === room.id) {
        world.wallTex[ci] = Tex.HERMO_WALL;
      } else if ((world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER) && world.roomMap[ci] === room.id) {
        world.floorTex[ci] = ((dx + dy + spec.seed) & 3) === 0 ? Tex.F_TILE : Tex.F_CONCRETE;
        world.fog[ci] = Math.min(world.fog[ci], 18);
      }
    }
  }
  const zone = world.zones[world.zoneMap[world.idx(center.x, center.y)]];
  if (zone) {
    zone.faction = ZoneFaction.CITIZEN;
    zone.fogged = false;
  }
  placeRoomFeature(world, room, Feature.LAMP, 1, 1);
  placeRoomFeature(world, room, Feature.SCREEN, room.w - 2, 1);
  stampSurfaceSplat(world, center.x, center.y, 0.5, 0.5, 0.32, 0.36, spec.seed ^ 0xafe, 105, 146, 118, false);
  return roomCell(world, room, Math.floor(room.w / 2), Math.floor(room.h / 2)) ?? center;
}

function registerSamosborSeedRetreatCue(
  world: World,
  spec: ProceduralFloorSpec,
  breach: Room,
  shelter: Room,
  breachPos: { x: number; y: number },
  shelterPos: { x: number; y: number },
): void {
  registerRouteCue(world, {
    id: `procedural_${spec.key}_samosbor_retreat`,
    x: breachPos.x + 0.5,
    y: breachPos.y + 0.5,
    targetX: shelterPos.x + 0.5,
    targetY: shelterPos.y + 0.5,
    floor: spec.baseFloor,
    roomId: breach.id,
    targetRoomId: shelter.id,
    zoneId: world.zoneMap[world.idx(breachPos.x, breachPos.y)],
    label: 'чистый отступ',
    hint: 'отступить от мясного семени к сухому карману',
    targetName: shelter.name,
    color: '#b8d7a2',
    tags: ['procedural_floor', 'samosbor_seed', 'samosbor', 'retreat', 'shelter', 'protected_shell'],
    toneSeed: (spec.seed ^ breach.id * 313 ^ shelter.id * 977) >>> 0,
    radius: 13,
    targetRadius: 4,
    cooldownSec: 28,
    heardText: 'Сирена в мясе щелкает не в ритм. Чистый отступ еще читается по сухому полу.',
    followedText: 'Чистый отступ найден. Давка осталась за спиной, но герму все равно надо готовить руками.',
    ignoredText: 'Чистый отступ ушел за шумом. Мясной очаг остался между маршрутами.',
    routeGroup: {
      id: `procedural_${spec.key}_samosbor_seed_retreat`,
      lead: 'сирена показывает очаг',
      risk: 'туман и мясной пол предупреждают о раннем самосборном давлении',
      decision: 'зайти за лутом, отойти к чистому карману или держать основной маршрут',
      reward: 'чистая комната дает ориентир для подготовки гермы',
      mapLabel: 'чистый отступ',
      mapHint: 'сухой карман у самосборного семени',
    },
  });
}

function applySamosborSeed(world: World, rooms: Room[], spec: ProceduralFloorSpec, spawnX: number, spawnY: number): void {
  if (spec.anomalyId !== 'samosbor_seed') return;
  for (const zone of world.zones) {
    if (chance(0.22 + spec.danger * 0.04)) zone.faction = ZoneFaction.SAMOSBOR;
  }
  const breach = chooseSamosborSeedBreachRoom(world, rooms, spec, Math.floor(spawnX), Math.floor(spawnY));
  const shelter = chooseSamosborSeedShelterRoom(world, rooms, breach, Math.floor(spawnX), Math.floor(spawnY));
  const breachPos = breach ? paintSamosborSeedBreach(world, breach, spec) : null;
  const shelterPos = shelter ? paintSamosborSeedProtectedShell(world, shelter, spec) : null;
  if (breach && shelter && breachPos && shelterPos) {
    paintSamosborSeedTrail(world, spec, shelterPos, breachPos);
    registerSamosborSeedRetreatCue(world, spec, breach, shelter, breachPos, shelterPos);
  }
  for (let i = 0; i < 1400; i++) {
    const pos = randomFloorCell(world, W / 2, W / 2, 0);
    if (!pos) continue;
    const ci = world.idx(pos.x, pos.y);
    if (!canPaintSamosborSeedCell(world, ci)) continue;
    world.floorTex[ci] = chance(0.5) ? Tex.F_GUT : Tex.F_MEAT;
    if (chance(0.2)) stampSurfaceSplat(world, pos.x, pos.y, 0.5, 0.5, 0.45, 0.8, spec.seed + i, 120, 15, 28, false);
  }
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFogDirty();
  world.markFeaturesDirty(true);
}

interface MyceliumSite {
  room: Room;
  x: number;
  y: number;
  score: number;
}

function myceliumProxyIndex(gx: number, gy: number): number {
  const x = ((gx % MYCELIUM_PROXY_SIZE) + MYCELIUM_PROXY_SIZE) % MYCELIUM_PROXY_SIZE;
  const y = ((gy % MYCELIUM_PROXY_SIZE) + MYCELIUM_PROXY_SIZE) % MYCELIUM_PROXY_SIZE;
  return y * MYCELIUM_PROXY_SIZE + x;
}

function myceliumProxyCoord(v: number): number {
  return Math.max(0, Math.min(MYCELIUM_PROXY_SIZE - 1, Math.floor(((v % W) + W) % W / MYCELIUM_PROXY_CELL)));
}

function hashUnit(n: number): number {
  n = (n ^ 61) ^ (n >>> 16);
  n = Math.imul(n + (n << 3), 0x45d9f3b);
  n ^= n >>> 15;
  return (n >>> 0) / 4294967295;
}

function seedMyceliumReactionPatch(field: Float32Array, room: Room, strength: number): void {
  const center = roomCenter(room);
  const gx = myceliumProxyCoord(center.x);
  const gy = myceliumProxyCoord(center.y);
  for (let py = -2; py <= 2; py++) {
    for (let px = -2; px <= 2; px++) {
      const d2 = px * px + py * py;
      if (d2 > 6) continue;
      const idx = myceliumProxyIndex(gx + px, gy + py);
      field[idx] = Math.max(field[idx], strength * (1 - d2 / 9));
    }
  }
}

function buildMyceliumReactionField(rooms: Room[], spec: ProceduralFloorSpec): Float32Array {
  const total = MYCELIUM_PROXY_SIZE * MYCELIUM_PROXY_SIZE;
  const u = new Float32Array(total);
  const v = new Float32Array(total);
  const nextU = new Float32Array(total);
  const nextV = new Float32Array(total);
  u.fill(1);

  const candidates = rooms.filter(room => room.id !== 0 && room.w >= 5 && room.h >= 5);
  if (candidates.length === 0) return v;
  const rand = xorshift32((spec.seed ^ 0x6d795c) >>> 0);
  const seeds = Math.min(candidates.length, 5 + spec.danger * 2);
  for (let i = 0; i < seeds; i++) {
    const room = candidates[Math.floor(rand() * candidates.length)];
    seedMyceliumReactionPatch(v, room, 0.42 + rand() * 0.22);
  }

  const feed = 0.028 + spec.danger * 0.0025;
  const kill = 0.055 + spec.danger * 0.0015;
  for (let step = 0; step < 14; step++) {
    for (let gy = 0; gy < MYCELIUM_PROXY_SIZE; gy++) {
      for (let gx = 0; gx < MYCELIUM_PROXY_SIZE; gx++) {
        const idx = myceliumProxyIndex(gx, gy);
        const uv = u[idx] * v[idx] * v[idx];
        const lapU = (
          u[myceliumProxyIndex(gx - 1, gy)] +
          u[myceliumProxyIndex(gx + 1, gy)] +
          u[myceliumProxyIndex(gx, gy - 1)] +
          u[myceliumProxyIndex(gx, gy + 1)] -
          u[idx] * 4
        );
        const lapV = (
          v[myceliumProxyIndex(gx - 1, gy)] +
          v[myceliumProxyIndex(gx + 1, gy)] +
          v[myceliumProxyIndex(gx, gy - 1)] +
          v[myceliumProxyIndex(gx, gy + 1)] -
          v[idx] * 4
        );
        nextU[idx] = Math.max(0, Math.min(1, u[idx] + lapU * 0.19 - uv + feed * (1 - u[idx])));
        nextV[idx] = Math.max(0, Math.min(1, v[idx] + lapV * 0.08 + uv - (feed + kill) * v[idx]));
      }
    }
    u.set(nextU);
    v.set(nextV);
  }
  return v;
}

function reachableRoomInteriorCell(world: World, room: Room, reachable: Uint8Array, seed: number): { x: number; y: number } | null {
  if (room.w < 3 || room.h < 3) return null;
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  const centerIdx = world.idx(cx, cy);
  if (reachable[centerIdx] && (world.cells[centerIdx] === Cell.FLOOR || world.cells[centerIdx] === Cell.WATER)) return { x: world.wrap(cx), y: world.wrap(cy) };
  const samples = Math.max(24, Math.min(160, (room.w - 2) * (room.h - 2)));
  for (let i = 0; i < samples; i++) {
    const x = world.wrap(room.x + 1 + ((seed + i * 5) % Math.max(1, room.w - 2)));
    const y = world.wrap(room.y + 1 + ((seed * 3 + i * 7) % Math.max(1, room.h - 2)));
    const ci = world.idx(x, y);
    if (!reachable[ci]) continue;
    if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) continue;
    return { x, y };
  }
  return null;
}

function myceliumRoomWeight(room: Room): number {
  if (room.type === RoomType.KITCHEN) return 1.32;
  if (room.type === RoomType.STORAGE) return 1.28;
  if (room.type === RoomType.PRODUCTION) return 1.24;
  if (room.type === RoomType.BATHROOM) return 1.18;
  if (room.type === RoomType.COMMON) return 1.08;
  if (room.type === RoomType.CORRIDOR) return 0.62;
  return 0.9;
}

function chooseMyceliumSites(world: World, rooms: Room[], spec: ProceduralFloorSpec, reachable: Uint8Array): MyceliumSite[] {
  const field = buildMyceliumReactionField(rooms, spec);
  const scored: MyceliumSite[] = [];
  for (const room of rooms) {
    if (room.id === 0 || room.w < 4 || room.h < 4) continue;
    const pos = reachableRoomInteriorCell(world, room, reachable, spec.seed ^ (room.id * 193));
    if (!pos) continue;
    const center = roomCenter(room);
    const proxy = field[myceliumProxyIndex(myceliumProxyCoord(center.x), myceliumProxyCoord(center.y))];
    const area = Math.min(1.4, Math.sqrt(room.w * room.h) / 18);
    const jitter = hashUnit(spec.seed ^ Math.imul(room.id + 1, 0x9e3779b9)) * 0.34;
    const score = proxy * 5 + area + myceliumRoomWeight(room) + jitter;
    scored.push({ room, x: pos.x, y: pos.y, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.min(scored.length, 7 + spec.danger * 3));
}

function stampMyceliumCell(world: World, x: number, y: number, intensity: number, seed: number, red: boolean): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) return;
  if (world.features[ci] === Feature.LIFT_BUTTON) return;
  if (world.floorTex[ci] !== Tex.F_ABYSS && intensity > 0.48) world.floorTex[ci] = intensity > 0.72 ? Tex.F_GUT : Tex.F_TILE;
  world.fog[ci] = Math.max(world.fog[ci], Math.floor(12 + intensity * 54));
  if (((x * 13 + y * 17 + seed) & 7) === 0) {
    stampSurfaceSplat(
      world,
      x,
      y,
      0.5,
      0.5,
      0.28 + intensity * 0.42,
      0.38 + intensity * 0.42,
      seed,
      red ? 150 : 66,
      red ? 38 : 126,
      red ? 36 : 58,
      false,
    );
  }
}

function paintMyceliumRoom(world: World, site: MyceliumSite, spec: ProceduralFloorSpec, index: number): void {
  const room = site.room;
  if (!room.name.startsWith(MYCELIUM_ROOM_PREFIX)) room.name = `${MYCELIUM_ROOM_PREFIX} ${index + 1}: ${room.name}`;
  room.wallTex = Tex.ROTTEN;
  room.floorTex = Tex.F_GUT;
  const radius = Math.max(5, Math.min(18, Math.max(room.w, room.h) * 0.62));
  const radius2 = radius * radius;
  const risky = index % 3 === 0 || site.score > 3.6;
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const ci = world.idx(x, y);
      if (world.roomMap[ci] !== room.id) continue;
      if (world.cells[ci] === Cell.WALL) {
        if ((dx + dy + index) % 3 !== 0) world.wallTex[ci] = Tex.ROTTEN;
        continue;
      }
      const d2 = world.dist2(site.x + 0.5, site.y + 0.5, x + 0.5, y + 0.5);
      const radial = Math.max(0, 1 - d2 / radius2);
      const noise = hashUnit(spec.seed ^ Math.imul(x + 17, 1103515245) ^ Math.imul(y + 31, 12345));
      const intensity = site.score * 0.13 + radial * 0.72 + noise * 0.22;
      if (intensity < 0.46) continue;
      stampMyceliumCell(world, x, y, Math.min(1, intensity), spec.seed ^ (index * 4099) ^ (x * 17) ^ y, risky);
      if (world.features[ci] === Feature.NONE && intensity > 0.92 && noise > 0.82) world.features[ci] = Feature.SHELF;
    }
  }
  const anchor = world.idx(site.x, site.y);
  if (world.features[anchor] === Feature.NONE || world.features[anchor] === Feature.SHELF || world.features[anchor] === Feature.TABLE) {
    world.features[anchor] = Feature.APPARATUS;
  }
  stampSurfaceSplat(world, site.x, site.y, 0.5, 0.5, risky ? 1.15 : 0.9, 0.78, spec.seed ^ (room.id * 2654435761), risky ? 158 : 52, risky ? 42 : 138, risky ? 34 : 64, false);
}

function traceMyceliumRoot(world: World, from: MyceliumSite, to: MyceliumSite, spec: ProceduralFloorSpec, index: number): void {
  const dx = world.delta(from.x, to.x);
  const dy = world.delta(from.y, to.y);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  for (let step = 0; step <= steps; step++) {
    if (step % 2 !== 0) continue;
    const t = step / steps;
    const x = world.wrap(Math.round(from.x + dx * t));
    const y = world.wrap(Math.round(from.y + dy * t));
    const ci = world.idx(x, y);
    if (world.roomMap[ci] >= 0 && world.roomMap[ci] !== from.room.id && world.roomMap[ci] !== to.room.id && world.cells[ci] !== Cell.FLOOR) continue;
    stampMyceliumCell(world, x, y, 0.56 + (step % 6) * 0.035, spec.seed ^ 0x5f00d ^ (index * 919) ^ step, index % 2 === 0);
  }
}

function placeMyceliumBasin(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  reachable: Uint8Array,
  site: MyceliumSite,
  index: number,
  occupied: Set<number>,
): void {
  const spore = index % 2 === 1;
  const target = findReachableContainerCell(world, rooms, reachable, spec.seed ^ (site.room.id * 811) ^ index, site.room, occupied);
  if (!target) return;
  occupied.add(world.idx(target.x, target.y));
  const inventory: Item[] = spore
    ? [
        { defId: 'spore_print', count: 1 },
        { defId: 'infected_mushroom', count: Math.max(1, Math.min(3, spec.danger)) },
        { defId: 'antifungal_ointment', count: 1 },
      ]
    : [
        { defId: 'mushroom_mass', count: 2 + spec.danger },
        { defId: 'infected_mushroom', count: 1 },
      ];
  const kind = spore ? ContainerKind.SECRET_STASH : (target.room.type === RoomType.KITCHEN ? ContainerKind.FRIDGE : ContainerKind.TRASH_BIN);
  const container = addProceduralLootContainer(
    world,
    spec,
    target.room,
    target,
    kind,
    inventory,
    ['mycelium_basin', spore ? 'spore_reward' : 'food_reward', 'visible_risk_cue', 'contaminated'],
    spore ? 'Споровая ванна грибницы' : 'Съедобная бахрома грибницы',
  );
  if (!container) return;
  const ci = world.idx(target.x, target.y);
  if (world.features[ci] === Feature.NONE) world.features[ci] = spore ? Feature.APPARATUS : Feature.SHELF;
  world.fog[ci] = Math.max(world.fog[ci], spore ? 82 : 42);
  stampSurfaceSplat(world, target.x, target.y, 0.5, 0.5, spore ? 1.05 : 0.75, 0.86, spec.seed ^ (index * 1223), spore ? 154 : 62, spore ? 44 : 142, spore ? 36 : 66, false);
}

function spawnMyceliumAnchorMonster(world: World, entities: Entity[], nextId: { v: number }, spec: ProceduralFloorSpec, site: MyceliumSite, index: number): void {
  if (!canSpawnEntityType(entities, EntityType.MONSTER)) return;
  const ci = world.idx(site.x, site.y);
  if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) return;
  const kind = index % 2 === 0 ? MonsterKind.BORSHCHEVIK : MonsterKind.SLIMEVIK;
  const def = MONSTERS[kind];
  const zoneLevel = world.zones[world.zoneMap[ci]]?.level ?? spec.danger;
  const hp = Math.round(def.hp * (0.82 + zoneLevel * 0.15));
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: site.x + 0.5,
    y: site.y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: def.speed * (0.86 + spec.danger * 0.03),
    sprite: monsterSpr(kind),
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: site.x, ty: site.y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(Math.max(1, zoneLevel)),
  });
}

function applyMushrooms(
  world: World,
  rooms: Room[],
  entities: Entity[],
  nextId: { v: number },
  spec: ProceduralFloorSpec,
  reachable: Uint8Array,
  spawnX: number,
  spawnY: number,
): void {
  if (spec.anomalyId !== 'mushroom_mycelium') return;
  const sites = chooseMyceliumSites(world, rooms, spec, reachable);
  if (sites.length === 0) return;
  const occupied = new Set<number>();
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    paintMyceliumRoom(world, site, spec, i);
    if (i > 0 && i <= 10) traceMyceliumRoot(world, sites[i - 1], site, spec, i);
    if (i < 6) placeMyceliumBasin(world, rooms, spec, reachable, site, i, occupied);
    if (i < Math.min(3, 1 + Math.floor(spec.danger / 2)) && world.dist2(spawnX, spawnY, site.x + 0.5, site.y + 0.5) > 36 * 36) {
      spawnMyceliumAnchorMonster(world, entities, nextId, spec, site, i);
    }
    if (i < 10) dropItem(entities, nextId, site.x, site.y, chance(0.72) ? 'mushroom_mass' : 'infected_mushroom', irng(1, 2 + Math.floor(spec.danger / 2)));
  }
  world.markFloorTexDirty();
  world.markWallTexDirty();
  world.markFeaturesDirty(true);
  world.markFogDirty();
}

function applyCarnivorousFungusRooms(world: World, rooms: Room[], entities: Entity[], nextId: { v: number }, spec: ProceduralFloorSpec, reachable: Uint8Array): void {
  if (spec.anomalyId !== 'mushroom_mycelium') return;
  const candidates = rooms.filter(room => (
    room.type !== RoomType.CORRIDOR &&
    room.w >= 12 &&
    room.h >= 10 &&
    reachableRoomInteriorCell(world, room, reachable, spec.seed ^ (room.id * 571)) !== null
  ));
  if (candidates.length === 0) return;

  const count = Math.min(spec.danger >= 4 ? 2 : 1, candidates.length);
  const used = new Set<number>();
  for (let i = 0; i < count; i++) {
    let room = pick(candidates);
    for (let guard = 0; guard < 12 && used.has(room.id); guard++) room = pick(candidates);
    if (used.has(room.id)) continue;
    used.add(room.id);
    decorateCarnivorousFungusRoom(world, entities, nextId, room, {
      seed: spec.seed + 1130 + i * 17,
      withCounterplayDrops: i === 0,
      withGuardMonster: spec.danger >= 3,
    });
  }
}

const HLADON_ROOM_PREFIX = 'Хладон:';
const HLADON_KIT_ITEMS = ['boiler_water', 'asbestos_cord', 'sealant_tube', 'cloth_roll'] as const;

function isHladonShellWalkable(world: World, ci: number): boolean {
  if (world.aptMask[ci] || world.hermoWall[ci]) return false;
  const cell = world.cells[ci] as Cell;
  return cell !== Cell.WALL && cell !== Cell.LIFT && cell !== Cell.ABYSS;
}

function stampHladonShell(world: World, room: Room, seedBase: number, danger: number): void {
  const seen = new Set<number>();
  const queue: number[] = [];
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[ci] !== room.id || !isHladonShellWalkable(world, ci)) continue;
      seen.add(ci);
      queue.push(ci);
    }
  }

  let head = 0;
  for (let depth = 1; depth <= HLADON_COLD_SHELL_RADIUS; depth++) {
    const layerEnd = queue.length;
    while (head < layerEnd) {
      const ci = queue[head++];
      const x = ci % W;
      const y = (ci / W) | 0;
      for (const [dx, dy] of CONNECTIVITY_DIRS) {
        const ni = world.idx(x + dx, y + dy);
        if (seen.has(ni) || !isHladonShellWalkable(world, ni)) continue;
        seen.add(ni);
        queue.push(ni);
        const sx = ni % W;
        const sy = (ni / W) | 0;
        world.fog[ni] = Math.max(world.fog[ni], 7 + danger * 3 + Math.max(0, HLADON_COLD_SHELL_RADIUS - depth));
        if (world.cells[ni] === Cell.FLOOR && (depth === 1 || ((sx * 13 + sy * 17 + seedBase) % 5) === 0)) {
          world.floorTex[ni] = Tex.F_TILE;
        }
        if (depth === 1 || depth === HLADON_COLD_SHELL_RADIUS || ((sx * 31 + sy * 7 + seedBase) % 9) === 0) {
          const alpha = depth === 1 ? 0.48 : depth === HLADON_COLD_SHELL_RADIUS ? 0.34 : 0.2;
          stampSurfaceSplat(world, sx, sy, 0.5, 0.5, 0.22 + depth * 0.035, alpha, seedBase + depth * 409 + sx * 23 + sy * 47, 170, 220, 240, false);
        }
      }
    }
  }
}

function roomShellGap(world: World, a: Room, b: Room): number {
  const ac = roomCenter(a);
  const bc = roomCenter(b);
  const dx = Math.max(0, Math.abs(world.delta(ac.x, bc.x)) - (a.w + b.w) * 0.5);
  const dy = Math.max(0, Math.abs(world.delta(ac.y, bc.y)) - (a.h + b.h) * 0.5);
  return Math.hypot(dx, dy);
}

function outsideHladonDeepShell(world: World, room: Room, coldRooms: readonly Room[]): boolean {
  return coldRooms.every(coldRoom => roomShellGap(world, coldRoom, room) > HLADON_COLD_SHELL_RADIUS + 1);
}

function stampHladonFrost(world: World, room: Room, seedBase: number, danger: number): void {
  room.name = `${HLADON_ROOM_PREFIX} холодный карман ${room.id} граница ${danger}`;
  room.wallTex = Tex.TILE_W;
  room.floorTex = Tex.F_TILE;

  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const ci = world.idx(x, y);
      if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) continue;
      world.floorTex[ci] = Tex.F_TILE;
      world.fog[ci] = Math.max(world.fog[ci], 18 + danger * 5);
      const feature = world.features[ci] as Feature;
      if (feature === Feature.LAMP || feature === Feature.CANDLE || feature === Feature.STOVE || feature === Feature.MACHINE) {
        world.features[ci] = Feature.NONE;
      }
      if ((dx + dy + seedBase) % 5 === 0) {
        stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.28, 0.45, seedBase + dx * 37 + dy * 101, 185, 220, 235, false);
      }
    }
  }

  for (let dx = 0; dx < room.w; dx += 2) {
    for (const y of [room.y, room.y + room.h - 1]) {
      stampSurfaceSplat(world, room.x + dx, y, 0.5, 0.5, 0.38, 0.75, seedBase + dx * 17 + y, 210, 238, 255, true);
    }
  }
  for (let dy = 0; dy < room.h; dy += 2) {
    for (const x of [room.x, room.x + room.w - 1]) {
      stampSurfaceSplat(world, x, room.y + dy, 0.5, 0.5, 0.38, 0.75, seedBase + dy * 23 + x, 210, 238, 255, true);
    }
  }

  const control = roomCell(world, room, Math.floor(room.w / 2), Math.floor(room.h / 2));
  if (control) {
    world.features[world.idx(control.x, control.y)] = Feature.APPARATUS;
    stampSurfaceSplat(world, control.x, control.y, 0.5, 0.5, 0.7, 0.5, seedBase + 909, 150, 205, 240, false);
  }
  stampHladonShell(world, room, seedBase, danger);
}

function pickHladonRooms(world: World, rooms: Room[], spec: ProceduralFloorSpec, sx: number, sy: number): Room[] {
  const candidates = rooms.filter(room => {
    if (room.type === RoomType.CORRIDOR || room.w < 6 || room.h < 6) return false;
    const c = roomCenter(room);
    return world.dist2(sx, sy, c.x, c.y) > 52 * 52;
  });
  if (candidates.length === 0) return [];

  const target = Math.min(candidates.length, 2 + Math.floor(spec.danger / 2));
  const picked: Room[] = [];
  for (let attempt = 0; attempt < target * 24 && picked.length < target; attempt++) {
    const room = pick(candidates);
    if (picked.includes(room)) continue;
    const c = roomCenter(room);
    const tooClose = picked.some(other => {
      const oc = roomCenter(other);
      return world.dist2(c.x, c.y, oc.x, oc.y) < 36 * 36;
    });
    if (tooClose && attempt < target * 12) continue;
    picked.push(room);
  }
  return picked;
}

function seedHladonCounterplay(
  world: World,
  rooms: Room[],
  coldRooms: Room[],
  entities: Entity[],
  nextId: { v: number },
  spec: ProceduralFloorSpec,
  sx: number,
  sy: number,
): void {
  const reachable = reachableFromSpawn(world, sx, sy);
  const warmRooms = rooms.filter(room => (
    !coldRooms.includes(room) &&
    room.type !== RoomType.CORRIDOR &&
    room.w >= 5 &&
    room.h >= 5 &&
    reachable[world.idx(roomCenter(room).x, roomCenter(room).y)] === 1
  ));
  if (warmRooms.length === 0) return;

  const firstCold = roomCenter(coldRooms[0]);
  const warmCandidates = warmRooms.filter(room => outsideHladonDeepShell(world, room, coldRooms));
  const kitCandidates = warmCandidates.length > 0 ? warmCandidates : warmRooms;
  let kitRoom = kitCandidates[0];
  let best = Infinity;
  for (const room of kitCandidates) {
    const c = roomCenter(room);
    const d2 = world.dist2(firstCold.x, firstCold.y, c.x, c.y);
    if (d2 < best) {
      best = d2;
      kitRoom = room;
    }
  }

  kitRoom.name = `${kitRoom.name} теплый запас`;
  const warmSpot = roomCell(world, kitRoom, Math.floor(kitRoom.w / 2), Math.floor(kitRoom.h / 2));
  if (warmSpot) {
    world.features[world.idx(warmSpot.x, warmSpot.y)] = isIndustrialGeometry(spec.geometryId)
      ? Feature.MACHINE
      : Feature.STOVE;
    stampSurfaceSplat(world, warmSpot.x, warmSpot.y, 0.5, 0.5, 0.6, 0.38, spec.seed + 7301, 225, 120, 45, false);
  }

  const kitCount = Math.min(HLADON_KIT_ITEMS.length, 2 + Math.floor(spec.danger / 2));
  for (let i = 0; i < kitCount; i++) {
    const pos = randomRoomCell(kitRoom);
    dropItem(entities, nextId, pos.x, pos.y, HLADON_KIT_ITEMS[i], 1);
  }
}

function addDeepFrozenBlueprintCache(world: World, coldRooms: Room[], spec: ProceduralFloorSpec): void {
  const itemId = 'blueprint_t3_folder';
  const minDepth = 35;
  if (spec.depth < minDepth || spec.danger < 4) return;
  for (let attempt = 0; attempt < coldRooms.length; attempt++) {
    const room = coldRooms[(spec.seed + attempt * 7) % coldRooms.length];
    const pos = roomCell(
      world,
      room,
      1 + ((spec.seed + attempt * 3) % Math.max(1, room.w - 2)),
      1 + ((spec.seed * 3 + attempt * 5) % Math.max(1, room.h - 2)),
    );
    if (!pos || world.containersAt(pos.x, pos.y).length > 0) continue;
    world.features[world.idx(pos.x, pos.y)] = Feature.APPARATUS;
    addProceduralLootContainer(
      world,
      spec,
      room,
      pos,
      ContainerKind.SAFE,
      [
        { defId: itemId, count: 1 },
        { defId: 'frozen_item_shard', count: 1 },
      ],
      [itemId, 'frozen_item', 'deep_route', 'rare_recipe_unlock'],
      'Замороженный сейф чертежей Т3',
    );
    return;
  }
}

function applyHladon(world: World, rooms: Room[], entities: Entity[], nextId: { v: number }, spec: ProceduralFloorSpec, sx: number, sy: number): void {
  if (spec.anomalyId !== 'hladon') return;
  const coldRooms = pickHladonRooms(world, rooms, spec, sx, sy);
  if (coldRooms.length === 0) return;

  for (let i = 0; i < coldRooms.length; i++) {
    stampHladonFrost(world, coldRooms[i], spec.seed + 9100 + i * 997, spec.danger);
  }
  addDeepFrozenBlueprintCache(world, coldRooms, spec);
  seedHladonCounterplay(world, rooms, coldRooms, entities, nextId, spec, sx, sy);
  world.markFogDirty();
  world.markFloorTexDirty();
}

const TELEPORT_ENDPOINT_LIFT_CLEARANCE = 10;
const TELEPORT_ENDPOINT_SPACING2 = 24 * 24;
const TELEPORT_PAIR_MIN_DIST2 = 180 * 180;

function nearLiftBackbone(world: World, x: number, y: number, radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.cells[ci] === Cell.LIFT || world.features[ci] === Feature.LIFT_BUTTON) return true;
    }
  }
  return false;
}

function farFromTeleportEndpoints(world: World, ci: number, used: ReadonlySet<number>, minDist2: number): boolean {
  const x = ci % W;
  const y = (ci / W) | 0;
  for (const other of used) {
    const ox = other % W;
    const oy = (other / W) | 0;
    if (world.dist2(x + 0.5, y + 0.5, ox + 0.5, oy + 0.5) < minDist2) return false;
  }
  return true;
}

function teleportEndpointCandidate(
  world: World,
  placement: WalkablePlacementMap,
  ci: number,
  used: ReadonlySet<number>,
): boolean {
  if (used.has(ci) || world.anomalyTeleports.has(ci) || !placement.reachable[ci]) return false;
  if (world.cells[ci] !== Cell.FLOOR) return false;
  if (world.features[ci] !== Feature.NONE) return false;
  if (world.aptMask[ci] || world.hermoWall[ci] || world.doors.has(ci) || world.containerMap.has(ci)) return false;
  const x = ci % W;
  const y = (ci / W) | 0;
  if (nearLiftBackbone(world, x, y, TELEPORT_ENDPOINT_LIFT_CLEARANCE)) return false;
  return farFromTeleportEndpoints(world, ci, used, TELEPORT_ENDPOINT_SPACING2);
}

function pickTeleportEndpoint(
  world: World,
  placement: WalkablePlacementMap,
  used: ReadonlySet<number>,
  centerX: number,
  centerY: number,
  minDist2: number,
): number {
  const candidates = placement.candidates;
  for (let attempt = 0; attempt < 384 && candidates.length > 0; attempt++) {
    const ci = candidates[Math.floor(Math.random() * candidates.length)];
    if (!teleportEndpointCandidate(world, placement, ci, used)) continue;
    const x = ci % W;
    const y = (ci / W) | 0;
    if (minDist2 > 0 && world.dist2(centerX, centerY, x + 0.5, y + 0.5) < minDist2) continue;
    return ci;
  }
  for (const ci of candidates) {
    if (!teleportEndpointCandidate(world, placement, ci, used)) continue;
    const x = ci % W;
    const y = (ci / W) | 0;
    if (minDist2 > 0 && world.dist2(centerX, centerY, x + 0.5, y + 0.5) < minDist2) continue;
    return ci;
  }
  return -1;
}

function markTeleportLight(world: World, x: number, y: number, used: ReadonlySet<number>, seed: number): void {
  const offsets = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [2, 0], [-2, 0], [0, 2], [0, -2],
    [1, 1], [-1, 1], [1, -1], [-1, -1],
  ] as const;
  const start = Math.abs(seed) % offsets.length;
  for (let i = 0; i < offsets.length; i++) {
    const [dx, dy] = offsets[(start + i) % offsets.length];
    const ci = world.idx(x + dx, y + dy);
    if (used.has(ci)) continue;
    if (world.cells[ci] !== Cell.FLOOR || world.features[ci] !== Feature.NONE) continue;
    if (world.aptMask[ci] || world.hermoWall[ci] || world.doors.has(ci) || world.containerMap.has(ci)) continue;
    world.setFeatureAt(ci, Feature.LAMP, false);
    return;
  }
}

function markTeleportEndpoint(world: World, ci: number, seed: number, used: ReadonlySet<number>): void {
  const x = ci % W;
  const y = (ci / W) | 0;
  world.setFeatureAt(ci, Feature.SCREEN, false);
  world.floorTex[ci] = Tex.F_VOID;
  stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.78, 0.72, seed, 96, 190, 235, false);
  stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.44, 0.62, seed ^ 0x52a11, 190, 90, 235, false);
  markTeleportLight(world, x, y, used, seed);
}

function applyTeleports(world: World, spec: ProceduralFloorSpec, placement: WalkablePlacementMap): void {
  if (spec.anomalyId !== 'teleport_cells') return;
  const pairs = 4 + spec.danger;
  const used = new Set<number>();
  for (let i = 0; i < pairs; i++) {
    const ai = pickTeleportEndpoint(world, placement, used, W / 2 + 0.5, W / 2 + 0.5, 0);
    if (ai < 0) continue;
    used.add(ai);
    const ax = ai % W;
    const ay = (ai / W) | 0;
    const bi = pickTeleportEndpoint(world, placement, used, ax + 0.5, ay + 0.5, TELEPORT_PAIR_MIN_DIST2);
    if (bi < 0) {
      used.delete(ai);
      continue;
    }
    used.add(bi);
    world.anomalyTeleports.set(ai, bi);
    world.anomalyTeleports.set(bi, ai);
    markTeleportEndpoint(world, ai, spec.seed + i * 977, used);
    markTeleportEndpoint(world, bi, spec.seed ^ (i * 1777 + 0x052052), used);
  }
}

interface ProceduralRailStation {
  platformCell: number;
  trackCell: number;
}

function carveRailCenter(world: World, x: number, y: number): boolean {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT || world.hermoWall[ci] || world.aptMask[ci]) return false;
  world.cells[ci] = Cell.WATER;
  world.floorTex[ci] = Tex.F_WATER;
  world.features[ci] = Feature.NONE;
  world.roomMap[ci] = -1;
  return true;
}

function carveRailBed(world: World, x: number, y: number, horizontal: boolean, spec: ProceduralFloorSpec): boolean {
  let centerOpen = false;
  for (let side = -1; side <= 1; side++) {
    const rx = horizontal ? x : x + side;
    const ry = horizontal ? y + side : y;
    const opened = carveRailCenter(world, rx, ry);
    if (side === 0) centerOpen = opened;
  }
  if (centerOpen && ((x * 17 + y * 31 + spec.seed) & 15) === 0) {
    stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.32, 0.5, spec.seed ^ (x * 13 + y * 29), 92, 92, 84, false);
  }
  return centerOpen;
}

function carveRailPlatform(
  world: World,
  platformCells: number[],
  x: number,
  y: number,
  horizontal: boolean,
  side: number,
  spec: ProceduralFloorSpec,
): ProceduralRailStation | null {
  let markerCell = -1;
  for (let along = -12; along <= 12; along++) {
    for (let depth = 2; depth <= 5; depth++) {
      const px = horizontal ? x + along : x + side * depth;
      const py = horizontal ? y + side * depth : y + along;
      const ci = world.idx(px, py);
      if (world.cells[ci] === Cell.LIFT || world.hermoWall[ci] || world.aptMask[ci]) continue;
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = spec.geometryId === 'admin_pockets' ? Tex.F_MARBLE_TILE : Tex.F_CONCRETE;
      world.roomMap[ci] = -1;
      platformCells.push(ci);
      if (markerCell < 0 && Math.abs(along) <= 2 && depth >= 3) markerCell = ci;
      if (depth === 4 && Math.abs(along) % 10 === 0) world.features[ci] = Feature.LAMP;
      if (depth === 2 && Math.abs(along) % 5 === 0) {
        stampSurfaceSplat(world, px, py, 0.5, 0.5, 0.24, 0.46, spec.seed ^ (x * 31 + y * 17 + along * 5), 224, 190, 74, true);
      }
    }
  }

  const screenX = horizontal ? x : x + side * 4;
  const screenY = horizontal ? y + side * 4 : y;
  const screen = world.idx(screenX, screenY);
  if (world.cells[screen] !== Cell.LIFT) world.features[screen] = Feature.SCREEN;
  const lampX = horizontal ? x - 7 : x + side * 4;
  const lampY = horizontal ? y + side * 4 : y - 7;
  const lamp = world.idx(lampX, lampY);
  if (world.cells[lamp] !== Cell.LIFT) world.features[lamp] = Feature.LAMP;

  for (let depth = 5; depth <= 18; depth++) {
    const ax = horizontal ? x : x + side * depth;
    const ay = horizontal ? y + side * depth : y;
    const ci = world.idx(ax, ay);
    if (world.cells[ci] === Cell.LIFT || world.hermoWall[ci] || world.aptMask[ci]) continue;
    world.cells[ci] = Cell.FLOOR;
    world.floorTex[ci] = Tex.F_CONCRETE;
    world.roomMap[ci] = -1;
    if (depth === 9 || depth === 15) world.features[ci] = Feature.LAMP;
  }
  const trackCell = world.idx(x, y);
  return markerCell >= 0 ? { platformCell: markerCell, trackCell } : null;
}

function nearestTrackOffsetByCell(track: RailTrainTrack, ci: number): number {
  const direct = track.cells.indexOf(ci);
  return direct >= 0 ? direct : Math.floor(track.cells.length / 2);
}

function cellPoint(ci: number): { x: number; y: number } {
  return { x: ci % W, y: (ci / W) | 0 };
}

function registerRailPlatformCue(
  world: World,
  spec: ProceduralFloorSpec,
  track: RailTrainTrack,
  line: number,
  stationIndex: number,
  station: ProceduralRailStation,
): void {
  const marker = cellPoint(station.platformCell);
  const target = cellPoint(station.trackCell);
  registerRouteCue(world, {
    id: `procedural_${spec.key}_rail_${line}_platform_${stationIndex}`,
    x: marker.x + 0.5,
    y: marker.y + 0.5,
    targetX: target.x + 0.5,
    targetY: target.y + 0.5,
    floor: spec.baseFloor,
    label: 'свет платформы',
    hint: 'стойте за лампами: рельсовая вода принадлежит составу',
    targetName: track.label,
    color: '#f2c65c',
    tags: ['procedural_floor', 'rail_trains', 'rail_graph', 'platform', 'safe_shell', 'route_pressure'],
    toneSeed: spec.seed ^ (line * 0x6301) ^ (stationIndex * 0x45d9),
    radius: 13,
    targetRadius: 3.5,
    cooldownSec: 35,
    zoneId: world.zoneMap[station.platformCell],
    heardText: 'Лампы платформы режут рельсовую воду. Ждать безопасно у стены; на путях поезд не уступает.',
    followedText: 'Платформа прочитана: здесь можно переждать состав, сесть или перейти по светлому краю.',
    ignoredText: 'Платформа осталась за спиной. Рельсы снова звучат как коридор, но коридором не являются.',
    routeGroup: {
      id: `procedural_${spec.key}_rail_platform_group_${line}`,
      lead: 'платформенный свет виден издалека',
      risk: 'на рельсовой воде состав давит без предупреждения',
      decision: 'ждать у стены, сесть в остановившийся поезд или искать переход',
      reward: 'быстрый транзит по опасной линии',
      mapLabel: 'платформа',
      mapHint: 'безопасная кромка железнодорожной аномалии',
    },
  });
}

function carveProceduralRailLine(
  world: World,
  spec: ProceduralFloorSpec,
  line: number,
  horizontal: boolean,
  coord: number,
): RailTrainTrack | null {
  const cells: number[] = [];
  const platformCells: number[] = [];
  const stationOffsets: number[] = [];
  const start = 70 + line * 11;
  const end = W - 72 - line * 13;
  for (let p = start; p <= end; p++) {
    const x = horizontal ? p : coord;
    const y = horizontal ? coord : p;
    if (carveRailBed(world, x, y, horizontal, spec)) cells.push(world.idx(x, y));
  }
  if (cells.length < 64) return null;

  const stations = [start + 96, Math.floor((start + end) / 2), end - 96];
  const stationSites: ProceduralRailStation[] = [];
  const offsetLookup: RailTrainTrack = { id: '', label: '', cells, stationOffsets: [], platformCells: [], loop: true };
  for (let i = 0; i < stations.length; i++) {
    const p = Math.max(start + 12, Math.min(end - 12, stations[i]));
    const x = horizontal ? p : coord;
    const y = horizontal ? coord : p;
    const side = ((line + i) & 1) === 0 ? -1 : 1;
    const offset = nearestTrackOffsetByCell(offsetLookup, world.idx(x, y));
    const station = carveRailPlatform(world, platformCells, x, y, horizontal, side, spec);
    stationOffsets.push(offset);
    if (station) stationSites.push(station);
  }

  const track: RailTrainTrack = {
    id: `procedural_${spec.key}_rail_${line}`,
    label: line === 0 ? 'Серая линия' : line === 1 ? 'Ржавая линия' : 'Обратная линия',
    cells,
    stationOffsets,
    platformCells,
    loop: true,
  };
  for (let i = 0; i < stationSites.length; i++) {
    if (i !== 0 && i !== stationSites.length - 1) continue;
    registerRailPlatformCue(world, spec, track, line, i, stationSites[i]);
  }
  return track;
}

function clampProceduralRailCoord(coord: number): number {
  return Math.max(96, Math.min(W - 97, coord));
}

function preserveRailTransferCell(world: World, ci: number): boolean {
  return world.cells[ci] === Cell.LIFT ||
    world.hermoWall[ci] !== 0 ||
    world.aptMask[ci] !== 0 ||
    world.features[ci] === Feature.LIFT_BUTTON ||
    world.containerMap.has(ci);
}

function carveRailTransferShell(world: World, spec: ProceduralFloorSpec, center: number, serial: number): number {
  const cx = center % W;
  const cy = (center / W) | 0;
  let markerCell = -1;
  for (let dy = -6; dy <= 6; dy++) {
    for (let dx = -6; dx <= 6; dx++) {
      const ci = world.idx(cx + dx, cy + dy);
      if (preserveRailTransferCell(world, ci)) continue;
      const onRailAxis = Math.abs(dx) <= 1 || Math.abs(dy) <= 1;
      if (!onRailAxis) {
        world.cells[ci] = Cell.FLOOR;
        world.floorTex[ci] = Tex.F_CONCRETE;
        world.roomMap[ci] = -1;
        if (markerCell < 0 && Math.abs(dx) >= 3 && Math.abs(dy) >= 3) markerCell = ci;
      }
      if (Math.abs(dx) === 5 && Math.abs(dy) === 5) world.features[ci] = Feature.LAMP;
      if ((Math.abs(dx) === 4 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 4)) {
        stampSurfaceSplat(world, cx + dx, cy + dy, 0.5, 0.5, 0.28, 0.5, spec.seed ^ serial * 7919 ^ dx * 73 ^ dy * 89, 229, 179, 67, true);
      }
    }
  }
  const screen = world.idx(cx - 4, cy - 4);
  if (!preserveRailTransferCell(world, screen) && world.cells[screen] === Cell.FLOOR) world.features[screen] = Feature.SCREEN;
  return markerCell;
}

function sharedRailCells(tracks: readonly RailTrainTrack[]): number[] {
  const owner = new Map<number, number>();
  const out: number[] = [];
  const seen = new Set<number>();
  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
    for (const ci of tracks[trackIndex].cells) {
      const prev = owner.get(ci);
      if (prev === undefined) {
        owner.set(ci, trackIndex);
      } else if (prev !== trackIndex && !seen.has(ci)) {
        seen.add(ci);
        out.push(ci);
      }
    }
  }
  return out;
}

function registerRailTransferCue(world: World, spec: ProceduralFloorSpec, center: number, markerCell: number, serial: number): void {
  const marker = cellPoint(markerCell);
  const target = cellPoint(center);
  registerRouteCue(world, {
    id: `procedural_${spec.key}_rail_transfer_${serial}`,
    x: marker.x + 0.5,
    y: marker.y + 0.5,
    targetX: target.x + 0.5,
    targetY: target.y + 0.5,
    floor: spec.baseFloor,
    label: 'пересадочный свет',
    hint: 'рельсовый крест: переходить по светлой кромке или ждать',
    targetName: 'пересечение линий',
    color: '#ffd16a',
    tags: ['procedural_floor', 'rail_trains', 'rail_graph', 'transfer', 'crossing', 'safe_shell', 'route_pressure'],
    toneSeed: spec.seed ^ 0x630063 ^ serial * 0x9e37,
    radius: 14,
    targetRadius: 4,
    cooldownSec: 38,
    zoneId: world.zoneMap[markerCell],
    heardText: 'На пересечении щелкают стрелки. Светлая кромка безопаснее воды между рельсами.',
    followedText: 'Пересадочный крест найден. Теперь понятно, где линии встречаются и где лучше переждать.',
    ignoredText: 'Стрелки отщелкали в стороне. Пересадка осталась шуметь без вас.',
    routeGroup: {
      id: `procedural_${spec.key}_rail_transfer_group_${serial}`,
      lead: 'стрелки ведут к пересечению линий',
      risk: 'два состава могут закрыть путь сразу',
      decision: 'переждать, пересечь по светлой кромке или использовать поезд',
      reward: 'быстрый переход между линиями',
      mapLabel: 'рельсовый крест',
      mapHint: 'пересадка железнодорожной аномалии',
    },
  });
}

function registerRailCrossings(world: World, spec: ProceduralFloorSpec, tracks: readonly RailTrainTrack[]): void {
  const crossings = sharedRailCells(tracks).slice(0, 6);
  for (let i = 0; i < crossings.length; i++) {
    const markerCell = carveRailTransferShell(world, spec, crossings[i], i);
    if (markerCell >= 0) registerRailTransferCue(world, spec, crossings[i], markerCell, i);
  }
}

function chooseRailAnchorRooms(world: World, rooms: Room[], sx: number, sy: number): Room[] {
  const candidates = rooms
    .filter(room => room.type === RoomType.CORRIDOR || room.type === RoomType.PRODUCTION || room.type === RoomType.COMMON)
    .filter(room => {
      const c = roomCenter(room);
      return world.dist2(sx, sy, c.x, c.y) > 42 * 42;
    });
  return candidates.length > 0 ? candidates : rooms;
}

function railTrackIsHorizontal(track: RailTrainTrack): boolean {
  const first = track.cells[0];
  const last = track.cells[track.cells.length - 1];
  if (first === undefined || last === undefined) return true;
  const firstPoint = cellPoint(first);
  const lastPoint = cellPoint(last);
  return Math.abs(firstPoint.x - lastPoint.x) >= Math.abs(firstPoint.y - lastPoint.y);
}

function railServiceRoomType(spec: ProceduralFloorSpec, serial: number): RoomType {
  if (spec.geometryId === 'admin_pockets') {
    const cycle = [
      RoomType.OFFICE,
      RoomType.STORAGE,
      RoomType.OFFICE,
      RoomType.BATHROOM,
      RoomType.KITCHEN,
      RoomType.MEDICAL,
      RoomType.COMMON,
    ] as const;
    return cycle[serial % cycle.length];
  }
  if (isIndustrialGeometry(spec.geometryId)) {
    const cycle = [RoomType.PRODUCTION, RoomType.STORAGE, RoomType.OFFICE, RoomType.COMMON] as const;
    return cycle[serial % cycle.length];
  }
  return serial % 3 === 0 ? RoomType.STORAGE : RoomType.COMMON;
}

function railServiceRoomSize(type: RoomType, spec: ProceduralFloorSpec, serial: number): { w: number; h: number } {
  if (type === RoomType.BATHROOM) return { w: 4 + (serial & 1), h: 4 + ((serial >>> 1) & 1) };
  if (type === RoomType.KITCHEN) return { w: 6 + (serial % 3), h: 5 + ((serial >>> 2) % 3) };
  if (type === RoomType.MEDICAL) return { w: 7 + (serial % 4), h: 6 + ((serial >>> 3) % 3) };
  if (type === RoomType.PRODUCTION) return { w: 11 + (serial % 5), h: 8 + ((serial >>> 2) % 4) };
  if (type === RoomType.STORAGE) return { w: 6 + (serial % 4), h: 5 + ((serial >>> 2) % 4) };
  if (type === RoomType.COMMON) return { w: 9 + (serial % 5), h: 7 + ((serial >>> 2) % 4) };
  return {
    w: 7 + (serial % 5) + (spec.majorityId === 'liquidators' ? 1 : 0),
    h: 6 + ((serial >>> 2) % 4),
  };
}

function railServiceRoomLimit(spec: ProceduralFloorSpec): number {
  if (spec.geometryId === 'sump_causeways') return spec.anomalyId === 'rail_trains' ? 72 : 36;
  if (spec.geometryId === 'admin_pockets') return 44;
  if (isIndustrialGeometry(spec.geometryId)) return 40;
  return 24;
}

function railServiceOffsets(track: RailTrainTrack, spec: ProceduralFloorSpec): number[] {
  const fractions = spec.geometryId === 'sump_causeways'
    ? [0.10, 0.18, 0.28, 0.38, 0.50, 0.62, 0.72, 0.82, 0.90]
    : [0.22, 0.36, 0.50, 0.64, 0.78];
  const out = new Set<number>();
  for (const offset of track.stationOffsets) out.add(offset);
  for (const fraction of fractions) out.add(Math.floor(track.cells.length * fraction));
  return [...out]
    .map(offset => Math.max(0, Math.min(track.cells.length - 1, offset)))
    .sort((a, b) => a - b);
}

function decorateRailServiceRoom(world: World, room: Room, type: RoomType, spec: ProceduralFloorSpec, serial: number, trackLabel: string): void {
  if (spec.geometryId === 'admin_pockets') {
    if (spec.majorityId === 'liquidators' && (type === RoomType.OFFICE || type === RoomType.STORAGE)) {
      room.name = type === RoomType.STORAGE
        ? `Платформенный склад ликвидаторов ${room.id}`
        : `Платформенный пост ликвидаторов ${room.id}`;
    } else if (type === RoomType.BATHROOM) room.name = `Платформенный туалет ${room.id}`;
    else if (type === RoomType.KITCHEN) room.name = `Чайная платформы ${room.id}`;
    else if (type === RoomType.MEDICAL) room.name = `Медпункт платформы ${room.id}`;
    else if (type === RoomType.STORAGE) room.name = `Архив платформы ${room.id}`;
    else if (type === RoomType.COMMON) room.name = `Зал ожидания платформы ${room.id}`;
    else room.name = `Платформенный кабинет ${room.id}`;
    applyRoomTexture(world, room, Tex.MARBLE, type === RoomType.COMMON ? Tex.F_RED_CARPET : Tex.F_MARBLE_TILE);
    if (type === RoomType.OFFICE || type === RoomType.STORAGE) decorateAdminOfficeSlab(world, room, spec.seed + serial * 173);
    else decorateProceduralRoom(world, room, spec);
  } else {
    room.name = type === RoomType.PRODUCTION
      ? `Служба пути ${trackLabel} ${room.id}`
      : `Карман платформы ${trackLabel} ${room.id}`;
    applyRoomTexture(world, room, isIndustrialGeometry(spec.geometryId) ? Tex.METAL : Tex.MARBLE, isIndustrialGeometry(spec.geometryId) ? Tex.F_CONCRETE : Tex.F_MARBLE_TILE);
    decorateProceduralRoom(world, room, spec);
  }

  const center = roomCenter(room);
  const ci = world.idx(center.x, center.y);
  if (world.cells[ci] !== Cell.FLOOR || world.roomMap[ci] !== room.id) return;
  world.features[ci] = type === RoomType.PRODUCTION
    ? Feature.MACHINE
    : type === RoomType.BATHROOM
      ? Feature.SINK
      : type === RoomType.KITCHEN
        ? Feature.TABLE
        : type === RoomType.MEDICAL
          ? Feature.APPARATUS
          : type === RoomType.STORAGE
            ? Feature.SHELF
            : Feature.DESK;
}

function carveRailServiceSpur(world: World, ax: number, ay: number, bx: number, by: number, spec: ProceduralFloorSpec): void {
  const horizontal = Math.abs(world.delta(ax, bx)) >= Math.abs(world.delta(ay, by));
  const delta = horizontal ? world.delta(ax, bx) : world.delta(ay, by);
  const dir = delta >= 0 ? 1 : -1;
  const steps = Math.abs(delta);
  let x = world.wrap(ax);
  let y = world.wrap(ay);
  for (let step = 0; step <= steps; step++) {
    const ci = world.idx(x, y);
    if (
      world.cells[ci] !== Cell.WATER &&
      world.cells[ci] !== Cell.LIFT &&
      world.cells[ci] !== Cell.ABYSS &&
      !world.hermoWall[ci] &&
      !world.aptMask[ci] &&
      !world.containerMap.has(ci) &&
      world.features[ci] !== Feature.LIFT_BUTTON
    ) {
      if (world.cells[ci] === Cell.WALL) {
        world.cells[ci] = Cell.FLOOR;
        world.roomMap[ci] = -1;
      }
      if (world.roomMap[ci] < 0 && world.cells[ci] === Cell.FLOOR) {
        world.floorTex[ci] = spec.geometryId === 'admin_pockets' ? Tex.F_MARBLE_TILE : Tex.F_CONCRETE;
        if (world.features[ci] === Feature.NONE && step % 9 === 0) world.features[ci] = Feature.LAMP;
      }
    }
    if (step < steps) {
      if (horizontal) x = world.wrap(x + dir);
      else y = world.wrap(y + dir);
    }
  }
}

function tryPlaceRailServiceRoom(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  track: RailTrainTrack,
  horizontal: boolean,
  offset: number,
  side: -1 | 1,
  serial: number,
): Room | null {
  const trackCell = track.cells[Math.max(0, Math.min(track.cells.length - 1, offset))];
  if (trackCell === undefined) return null;
  const point = cellPoint(trackCell);
  const type = railServiceRoomType(spec, serial);
  const size = railServiceRoomSize(type, spec, serial);
  const baseJitter = ((spec.seed >>> (serial % 13)) & 7) - 3;

  for (let attempt = 0; attempt < 12; attempt++) {
    const swing = attempt === 0 ? 0 : (attempt & 1 ? 1 : -1) * (5 + Math.floor(attempt / 2) * 4);
    const alongJitter = baseJitter + swing;
    const distance = 21 + (serial % 3) * 3 + Math.floor(attempt / 4) * 5;
    let x = 0;
    let y = 0;
    let doorX = 0;
    let doorY = 0;
    let outsideX = 0;
    let outsideY = 0;
    let platformX = 0;
    let platformY = 0;

    if (horizontal) {
      x = point.x - Math.floor(size.w / 2) + alongJitter;
      y = side > 0 ? point.y + distance : point.y - distance - size.h;
      doorX = Math.max(x + 1, Math.min(x + size.w - 2, point.x + alongJitter));
      doorY = side > 0 ? y - 1 : y + size.h;
      outsideX = doorX;
      outsideY = side > 0 ? doorY - 1 : doorY + 1;
      platformX = point.x + alongJitter;
      platformY = point.y + side * 5;
    } else {
      x = side > 0 ? point.x + distance : point.x - distance - size.w;
      y = point.y - Math.floor(size.h / 2) + alongJitter;
      doorX = side > 0 ? x - 1 : x + size.w;
      doorY = Math.max(y + 1, Math.min(y + size.h - 2, point.y + alongJitter));
      outsideX = side > 0 ? doorX - 1 : doorX + 1;
      outsideY = doorY;
      platformX = point.x + side * 5;
      platformY = point.y + alongJitter;
    }

    if (x < 8 || y < 8 || x + size.w >= W - 8 || y + size.h >= W - 8) continue;
    if (!canPlaceRoom(world, x, y, size.w, size.h)) continue;
    const room = stampRoom(world, nextProceduralRoomId(world), type, x, y, size.w, size.h, -1);
    rooms.push(room);
    decorateRailServiceRoom(world, room, type, spec, serial, track.label);
    placeDoorAt(world, doorX, doorY, room.id);
    carveRailServiceSpur(world, platformX, platformY, outsideX, outsideY, spec);
    return room;
  }
  return null;
}

function placeRailServicePockets(world: World, rooms: Room[], spec: ProceduralFloorSpec, tracks: readonly RailTrainTrack[]): number {
  if (tracks.length === 0) return 0;
  const maxRooms = railServiceRoomLimit(spec);
  const doubleSided = spec.geometryId === 'sump_causeways' || (isIndustrialGeometry(spec.geometryId) && spec.danger >= 4);
  let placed = 0;
  for (let trackIndex = 0; trackIndex < tracks.length && placed < maxRooms; trackIndex++) {
    const track = tracks[trackIndex];
    const horizontal = railTrackIsHorizontal(track);
    const offsets = railServiceOffsets(track, spec);
    for (let i = 0; i < offsets.length && placed < maxRooms; i++) {
      const side: -1 | 1 = ((trackIndex + i) & 1) === 0 ? 1 : -1;
      const sides: (-1 | 1)[] = doubleSided ? [side, side > 0 ? -1 : 1] : [side];
      for (const candidateSide of sides) {
        if (placed >= maxRooms) break;
        const primary = tryPlaceRailServiceRoom(world, rooms, spec, track, horizontal, offsets[i], candidateSide, placed);
        if (primary) {
          placed++;
          if (spec.geometryId === 'admin_pockets' && placed < maxRooms && tryPlaceRailServiceRoom(world, rooms, spec, track, horizontal, offsets[i] + 9, candidateSide > 0 ? -1 : 1, placed)) {
            placed++;
          }
        }
      }
    }
  }
  if (placed > 0) {
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFeaturesDirty(true);
  }
  return placed;
}

function preserveRailYardCell(world: World, ci: number): boolean {
  return world.cells[ci] === Cell.LIFT ||
    world.cells[ci] === Cell.DOOR ||
    world.hermoWall[ci] !== 0 ||
    world.aptMask[ci] !== 0 ||
    world.roomMap[ci] >= 0 ||
    world.features[ci] === Feature.LIFT_BUTTON ||
    world.containerMap.has(ci);
}

function carveRailYardCell(world: World, spec: ProceduralFloorSpec, x: number, y: number, water: boolean): number {
  const ci = world.idx(x, y);
  if (preserveRailYardCell(world, ci)) return 0;
  if (world.cells[ci] === Cell.ABYSS) return 0;
  const nextCell = water ? Cell.WATER : Cell.FLOOR;
  const changed = world.cells[ci] !== nextCell || world.floorTex[ci] !== (water ? Tex.F_WATER : Tex.F_CONCRETE);
  world.cells[ci] = nextCell;
  world.floorTex[ci] = water ? Tex.F_WATER : Tex.F_CONCRETE;
  world.wallTex[ci] = isIndustrialGeometry(spec.geometryId) ? Tex.PIPE : Tex.MARBLE;
  world.roomMap[ci] = -1;
  if (world.features[ci] !== Feature.SCREEN && world.features[ci] !== Feature.LAMP) world.features[ci] = Feature.NONE;
  return changed ? 1 : 0;
}

function carveRailWalkwayLine(
  world: World,
  spec: ProceduralFloorSpec,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
): number {
  let carved = 0;
  let x = world.wrap(Math.floor(ax));
  let y = world.wrap(Math.floor(ay));
  const dx = world.delta(x, Math.floor(bx));
  const dy = world.delta(y, Math.floor(by));
  const stepX = dx === 0 ? 0 : dx > 0 ? 1 : -1;
  const stepY = dy === 0 ? 0 : dy > 0 ? 1 : -1;
  const stamp = (cx: number, cy: number): void => {
    for (let oy = -width; oy <= width; oy++) {
      for (let ox = -width; ox <= width; ox++) {
        if (Math.abs(ox) + Math.abs(oy) > width) continue;
        carved += carveRailYardCell(world, spec, cx + ox, cy + oy, false);
      }
    }
  };

  for (let i = 0; i <= Math.abs(dx); i++) {
    stamp(x, y);
    if (i < Math.abs(dx)) x = world.wrap(x + stepX);
  }
  for (let i = 0; i <= Math.abs(dy); i++) {
    stamp(x, y);
    if (i < Math.abs(dy)) y = world.wrap(y + stepY);
  }
  return carved;
}

function carveRailStationYard(
  world: World,
  spec: ProceduralFloorSpec,
  x: number,
  y: number,
  horizontal: boolean,
  serial: number,
): number {
  const alongRadius = spec.geometryId === 'sump_causeways' ? 42 : 30;
  const sideRadius = spec.geometryId === 'sump_causeways' ? 15 : 10;
  let carved = 0;
  for (let along = -alongRadius; along <= alongRadius; along++) {
    for (let side = -sideRadius; side <= sideRadius; side++) {
      if (Math.abs(side) === sideRadius && Math.abs(along) > alongRadius - 8) continue;
      const px = horizontal ? x + along : x + side;
      const py = horizontal ? y + side : y + along;
      const railWater = Math.abs(side) <= 1;
      carved += carveRailYardCell(world, spec, px, py, railWater);
      const ci = world.idx(px, py);
      if (world.cells[ci] !== Cell.FLOOR || world.features[ci] !== Feature.NONE) continue;
      if (Math.abs(side) === sideRadius - 1 && Math.abs(along + serial * 3) % 13 === 0) world.features[ci] = Feature.LAMP;
      else if (Math.abs(side) === 5 && Math.abs(along) <= 2) world.features[ci] = Feature.SCREEN;
      else if (Math.abs(side) >= sideRadius - 3 && Math.abs(along + serial) % 17 === 0) world.features[ci] = Feature.SHELF;
    }
  }
  return carved;
}

function applyRailTransitYards(world: World, spec: ProceduralFloorSpec, tracks: readonly RailTrainTrack[]): number {
  if (tracks.length === 0) return 0;
  let carved = 0;
  const stations: { x: number; y: number; trackIndex: number }[] = [];
  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
    const track = tracks[trackIndex];
    const horizontal = railTrackIsHorizontal(track);
    const offsets = railServiceOffsets(track, spec).filter((_, i) => i % 2 === 0);
    for (let i = 0; i < offsets.length; i++) {
      const point = cellPoint(track.cells[offsets[i]]);
      if (!point) continue;
      carved += carveRailStationYard(world, spec, point.x, point.y, horizontal, trackIndex * 17 + i);
      if (i < 4 || track.stationOffsets.includes(offsets[i])) stations.push({ x: point.x, y: point.y, trackIndex });
    }
  }

  if (spec.geometryId === 'sump_causeways') {
    const usedPairs = new Set<string>();
    let bridges = 0;
    for (const station of stations) {
      if (bridges >= 14) break;
      let best: typeof station | undefined;
      let bestD2 = Infinity;
      for (const other of stations) {
        if (other.trackIndex === station.trackIndex) continue;
        const d2 = world.dist2(station.x, station.y, other.x, other.y);
        if (d2 < bestD2) {
          best = other;
          bestD2 = d2;
        }
      }
      if (!best || bestD2 > 360 * 360) continue;
      const key = station.trackIndex < best.trackIndex
        ? `${station.trackIndex}:${best.trackIndex}:${station.x >> 5}:${station.y >> 5}:${best.x >> 5}:${best.y >> 5}`
        : `${best.trackIndex}:${station.trackIndex}:${best.x >> 5}:${best.y >> 5}:${station.x >> 5}:${station.y >> 5}`;
      if (usedPairs.has(key)) continue;
      usedPairs.add(key);
      carved += carveRailWalkwayLine(world, spec, station.x, station.y, best.x, best.y, 2);
      bridges++;
    }
  }

  if (carved > 0) {
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFeaturesDirty(true);
  }
  return carved;
}

function applyRailTrains(
  world: World,
  rooms: Room[],
  entities: Entity[],
  nextId: { v: number },
  spec: ProceduralFloorSpec,
  sx: number,
  sy: number,
): void {
  if (spec.anomalyId !== 'rail_trains') return;
  const anchors = chooseRailAnchorRooms(world, rooms, sx, sy);
  if (anchors.length === 0) return;
  const lineCount = isIndustrialGeometry(spec.geometryId)
    ? Math.min(3, 2 + Math.floor(spec.danger / 3))
    : 2;
  const tracks: RailTrainTrack[] = [];
  for (let i = 0; i < lineCount; i++) {
    const room = anchors[(spec.seed + i * 7) % anchors.length];
    const center = roomCenter(room);
    const horizontal = i % 2 === 0;
    const coord = clampProceduralRailCoord(world.wrap(horizontal ? center.y + (i - 1) * 18 : center.x + (i - 1) * 18));
    const track = carveProceduralRailLine(world, spec, i, horizontal, coord);
    if (!track) continue;
    addRailTrainRoute(world, entities, nextId, track, {
      id: `${track.id}_train`,
      label: `${track.label} ${spec.ordinal}`,
      speed: 3.3 + spec.danger * 0.45 + i * 0.35,
      length: Math.min(16, 8 + spec.danger + i * 2),
      initialOffset: track.stationOffsets[0],
      stopSeconds: 3.5,
      direction: i % 2 === 0 ? 1 : -1,
    });
    tracks.push(track);
  }
  registerRailCrossings(world, spec, tracks);
  placeRailServicePockets(world, rooms, spec, tracks);
  applyRailTransitYards(world, spec, tracks);
  if (tracks.length > 0) {
    world.markCellsDirty();
    world.markFloorTexDirty();
    world.markFeaturesDirty(false);
  }
}

function roomCell(world: World, room: Room, dx: number, dy: number): { x: number; y: number } | null {
  const x = world.wrap(room.x + Math.max(1, Math.min(room.w - 2, dx)));
  const y = world.wrap(room.y + Math.max(1, Math.min(room.h - 2, dy)));
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR || world.roomMap[ci] !== room.id) return null;
  return { x, y };
}

function placeRoomFeature(world: World, room: Room, feature: Feature, dx: number, dy: number): { x: number; y: number } | null {
  const pos = roomCell(world, room, dx, dy);
  if (!pos) return null;
  world.features[world.idx(pos.x, pos.y)] = feature;
  return pos;
}

function placeRoomFeatureFallback(world: World, room: Room, feature: Feature, dx: number, dy: number, seed: number): { x: number; y: number } | null {
  const preferred = placeRoomFeature(world, room, feature, dx, dy);
  if (preferred) return preferred;
  const fallback = findFreeRoomCell(world, room, seed);
  if (!fallback) return null;
  world.features[world.idx(fallback.x, fallback.y)] = feature;
  return fallback;
}

function apartmentPressureBounds(rooms: readonly Room[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = W;
  let minY = W;
  let maxX = 0;
  let maxY = 0;
  for (const room of rooms) {
    minX = Math.min(minX, room.x);
    minY = Math.min(minY, room.y);
    maxX = Math.max(maxX, room.x + room.w);
    maxY = Math.max(maxY, room.y + room.h);
  }
  if (minX > maxX || minY > maxY) return { minX: 32, minY: 32, maxX: W - 32, maxY: W - 32 };
  return {
    minX: Math.max(8, minX - 10),
    minY: Math.max(8, minY - 10),
    maxX: Math.min(W - 9, maxX + 10),
    maxY: Math.min(W - 9, maxY + 10),
  };
}

function apartmentPressureCuts(lo: number, hi: number, depth: number, seed: number): number[] {
  const span = hi - lo;
  if (depth <= 0 || span < 96) return [];
  const wobble = (((seed >>> (depth * 5)) & 31) - 15) / 120;
  const mid = Math.max(lo + 24, Math.min(hi - 24, Math.round(lo + span * (0.5 + wobble))));
  return [
    mid,
    ...apartmentPressureCuts(lo, mid, depth - 1, seed ^ Math.imul(mid + 11, 0x45d9f3b)),
    ...apartmentPressureCuts(mid, hi, depth - 1, seed ^ Math.imul(mid + 37, 0x27d4eb2d)),
  ];
}

function adjacentApartmentPressureRoomId(world: World, x: number, y: number): number {
  for (const [dx, dy] of CONNECTIVITY_DIRS) {
    const roomId = world.roomMap[world.idx(x + dx, y + dy)];
    if (roomId >= 0) return roomId;
  }
  return -1;
}

function carveApartmentPressureCell(
  world: World,
  x: number,
  y: number,
  floorTex: Tex,
  changed: Set<number>,
  doorState: DoorState = DoorState.CLOSED,
  keyId = '',
): void {
  const ci = world.idx(x, y);
  const cell = world.cells[ci];
  if (world.aptMask[ci] || world.hermoWall[ci] || cell === Cell.LIFT || cell === Cell.ABYSS) return;
  if (cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR) return;
  if (cell !== Cell.WALL) return;

  const adjacentRoom = adjacentApartmentPressureRoomId(world, x, y);
  if (adjacentRoom >= 0) {
    world.cells[ci] = Cell.DOOR;
    world.wallTex[ci] = doorState === DoorState.LOCKED ? Tex.DOOR_METAL : Tex.DOOR_WOOD;
    let door = world.doors.get(ci);
    if (!door) {
      door = { idx: ci, state: doorState, roomA: adjacentRoom, roomB: -1, keyId, timer: 0 };
      world.doors.set(ci, door);
      const room = world.rooms[adjacentRoom];
      if (room && !room.doors.includes(ci)) room.doors.push(ci);
    } else {
      setDoorState(world, door, doorState);
      door.keyId = keyId;
    }
  } else {
    world.cells[ci] = Cell.FLOOR;
    world.roomMap[ci] = -1;
    world.floorTex[ci] = floorTex;
  }
  world.features[ci] = Feature.NONE;
  changed.add(ci);
}

function carveApartmentPressureSegment(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  floorTex: Tex,
  changed: Set<number>,
  doorState: DoorState = DoorState.CLOSED,
  keyId = '',
): void {
  let cx = world.wrap(ax);
  let cy = world.wrap(ay);
  const dx = world.delta(cx, world.wrap(bx));
  const dy = world.delta(cy, world.wrap(by));
  const stepX = dx >= 0 ? 1 : -1;
  const stepY = dy >= 0 ? 1 : -1;
  const nx = Math.abs(dx);
  const ny = Math.abs(dy);
  for (let i = 0; i <= nx; i++) {
    carveApartmentPressureCell(world, cx, cy, floorTex, changed, doorState, keyId);
    if (i < nx) cx = world.wrap(cx + stepX);
  }
  for (let i = 0; i <= ny; i++) {
    carveApartmentPressureCell(world, cx, cy, floorTex, changed, doorState, keyId);
    if (i < ny) cy = world.wrap(cy + stepY);
  }
}

function carveApartmentPressureWideSegment(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  floorTex: Tex,
  changed: Set<number>,
  width: number,
): void {
  const horizontal = Math.abs(world.delta(ax, bx)) >= Math.abs(world.delta(ay, by));
  const offsetMax = Math.max(0, width - 1);
  for (let offset = 0; offset <= offsetMax; offset++) {
    carveApartmentPressureSegment(
      world,
      horizontal ? ax : ax + offset,
      horizontal ? ay + offset : ay,
      horizontal ? bx : bx + offset,
      horizontal ? by + offset : by,
      floorTex,
      changed,
    );
  }
}

function carveApartmentPressureSlabs(world: World, rooms: readonly Room[], spec: ProceduralFloorSpec): number {
  const bounds = apartmentPressureBounds(rooms);
  const changed = new Set<number>();
  const cutsX = apartmentPressureCuts(bounds.minX, bounds.maxX, 2, spec.seed ^ 0x3600);
  const cutsY = apartmentPressureCuts(bounds.minY, bounds.maxY, 2, spec.seed ^ 0x3601);
  for (const x of cutsX) carveApartmentPressureWideSegment(world, x, bounds.minY, x, bounds.maxY, Tex.F_LINO, changed, 2);
  for (const y of cutsY) carveApartmentPressureWideSegment(world, bounds.minX, y, bounds.maxX, y, Tex.F_CONCRETE, changed, 2);
  return changed.size;
}

function apartmentPressureInfillRoomType(seed: number, serial: number, row: number): RoomType {
  const types = [
    RoomType.LIVING,
    RoomType.LIVING,
    RoomType.KITCHEN,
    RoomType.BATHROOM,
    RoomType.STORAGE,
    RoomType.COMMON,
    RoomType.SMOKING,
  ] as const;
  return types[Math.abs(seed + serial * 5 + row * 11) % types.length];
}

function apartmentPressureInfillTargetRooms(spec: ProceduralFloorSpec): number {
  const anomalyBonus = spec.anomalyId === 'samosbor_seed' ? 440 : spec.anomalyId === 'zombie_apocalypse' ? 320 : 0;
  return 2250 + spec.danger * 170 + anomalyBonus;
}

function carveApartmentPressureInfillFloor(
  world: World,
  x: number,
  y: number,
  floorTex: Tex,
  changed: Set<number>,
): boolean {
  const ci = world.idx(x, y);
  if (world.aptMask[ci] || world.hermoWall[ci] || world.containerMap.has(ci)) return false;
  if (world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.ABYSS || world.cells[ci] === Cell.DOOR) return false;
  if (world.roomMap[ci] >= 0) return false;
  if (world.features[ci] === Feature.LIFT_BUTTON) return false;
  const changedCell = world.cells[ci] !== Cell.FLOOR || world.floorTex[ci] !== floorTex;
  world.cells[ci] = Cell.FLOOR;
  world.roomMap[ci] = -1;
  world.floorTex[ci] = floorTex;
  world.wallTex[ci] = Tex.BRICK;
  if (world.features[ci] !== Feature.SCREEN) world.features[ci] = Feature.NONE;
  if (changedCell) changed.add(ci);
  return true;
}

function carveApartmentPressureInfillCorridor(
  world: World,
  x1: number,
  x2: number,
  y: number,
  changed: Set<number>,
): void {
  for (let x = x1; x <= x2; x++) {
    carveApartmentPressureInfillFloor(world, x, y, Tex.F_LINO, changed);
    if (((x + y) & 31) === 0) {
      const ci = world.idx(x, y);
      if (world.cells[ci] === Cell.FLOOR && world.features[ci] === Feature.NONE) world.features[ci] = Feature.LAMP;
    }
  }
}

function carveApartmentPressureInfillSegment(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  floorTex: Tex,
  changed: Set<number>,
): void {
  let cx = world.wrap(ax);
  let cy = world.wrap(ay);
  const dx = world.delta(cx, world.wrap(bx));
  const dy = world.delta(cy, world.wrap(by));
  const stepX = dx >= 0 ? 1 : -1;
  const stepY = dy >= 0 ? 1 : -1;
  const nx = Math.abs(dx);
  const ny = Math.abs(dy);
  for (let i = 0; i <= nx; i++) {
    carveApartmentPressureInfillFloor(world, cx, cy, floorTex, changed);
    if (i < nx) cx = world.wrap(cx + stepX);
  }
  for (let i = 0; i <= ny; i++) {
    carveApartmentPressureInfillFloor(world, cx, cy, floorTex, changed);
    if (i < ny) cy = world.wrap(cy + stepY);
  }
}

function stampApartmentPressureInfillRoom(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  row: number,
  serial: number,
): Room | null {
  if (x < 3 || y < 3 || x + w >= W - 3 || y + h >= W - 3) return null;
  if (!canPlaceRoom(world, x, y, w, h)) return null;
  const room = stampRoom(world, world.rooms.length, type, x, y, w, h, -1);
  room.name = `Квартирная давка ${room.id}`;
  applyRoomTexture(world, room, Tex.BRICK, type === RoomType.BATHROOM ? Tex.F_TILE : Tex.F_LINO);
  decorateProceduralRoom(world, room, spec);
  if (type === RoomType.KITCHEN) placeRoomFeatureFallback(world, room, Feature.STOVE, Math.floor(w / 2), Math.floor(h / 2), spec.seed ^ room.id);
  else if (type === RoomType.BATHROOM) placeRoomFeatureFallback(world, room, Feature.TOILET, Math.floor(w / 2), Math.floor(h / 2), spec.seed ^ room.id);
  else if (type === RoomType.STORAGE) placeRoomFeatureFallback(world, room, Feature.SHELF, Math.max(1, w - 2), Math.max(1, h - 2), spec.seed ^ room.id);
  else if ((serial + row) % 5 === 0) placeRoomFeatureFallback(world, room, Feature.TABLE, Math.floor(w / 2), Math.floor(h / 2), spec.seed ^ room.id);
  rooms.push(room);
  return room;
}

function connectApartmentPressureInfillRoom(world: World, room: Room, corridorY: number, seed: number): number {
  const doorX = world.wrap(room.x + 1 + Math.abs(seed) % Math.max(1, room.w - 2));
  const aboveCorridor = room.y + room.h < corridorY;
  const doorY = aboveCorridor ? room.y + room.h : room.y - 1;
  const before = world.cells[world.idx(doorX, doorY)];
  placeDoorAt(world, doorX, doorY, room.id);
  const door = world.doors.get(world.idx(doorX, doorY));
  if (door && (seed & 15) === 0) setDoorState(world, door, DoorState.CLOSED);
  return before === Cell.DOOR ? 0 : world.cells[world.idx(doorX, doorY)] === Cell.DOOR ? 1 : 0;
}

function tryStampApartmentPressureInfillBlock(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  originX: number,
  originY: number,
  blockW: number,
  blockH: number,
  serial: number,
): { rooms: number; cells: number; doors: number; anchor: { x: number; y: number } | null } {
  const corridorYs = blockH >= 54
    ? [originY + 12, originY + Math.floor(blockH / 2), originY + blockH - 13]
    : blockH >= 38
      ? [originY + 13, originY + blockH - 14]
      : [Math.max(originY + 10, Math.min(originY + blockH - 10, originY + Math.floor(blockH / 2)))];
  const corridorStart = originX + 3;
  const corridorEnd = originX + blockW - 4;
  const connector = nearestApartmentPressureWalkable(world, originX + Math.floor(blockW / 2), corridorYs[0], APARTMENT_PRESSURE_INFILL_LINK_RADIUS);
  const made: { room: Room; corridorY: number }[] = [];

  for (let row = 0; row < corridorYs.length; row++) {
    const corridorY = corridorYs[row];
    let cursor = corridorStart + 2 + ((serial + row) % 3);
    let roomSerial = 0;
    while (cursor <= corridorEnd - 8) {
      const seed = spec.seed ^
        Math.imul(serial + 1, 0x45d9f3b) ^
        Math.imul(row + 1, 0x7feb352d) ^
        Math.imul(roomSerial + 1, 0x27d4eb2d);
      const rw = 6 + Math.abs(seed % 5);
      const upperH = 4 + Math.abs((seed >>> 4) % 4);
      const lowerH = 4 + Math.abs((seed >>> 9) % 4);
      const upperY = corridorY - upperH - 1;
      const lowerY = corridorY + 2;
      const upperType = apartmentPressureInfillRoomType(seed, roomSerial, row * 2);
      const lowerType = apartmentPressureInfillRoomType(seed >>> 1, roomSerial, row * 2 + 1);
      if (upperY >= originY + 2) {
        const upper = stampApartmentPressureInfillRoom(world, rooms, spec, upperType, cursor, upperY, rw, upperH, row * 2, roomSerial);
        if (upper) made.push({ room: upper, corridorY });
      }
      if (lowerY + lowerH <= originY + blockH - 2) {
        const lower = stampApartmentPressureInfillRoom(world, rooms, spec, lowerType, cursor, lowerY, rw, lowerH, row * 2 + 1, roomSerial);
        if (lower) made.push({ room: lower, corridorY });
      }
      cursor += rw + 2 + Math.abs((seed >>> 13) % 2);
      roomSerial++;
    }
  }

  if (made.length < 4) return { rooms: made.length, cells: 0, doors: 0, anchor: null };

  const changed = new Set<number>();
  for (const corridorY of corridorYs) carveApartmentPressureInfillCorridor(world, corridorStart, corridorEnd, corridorY, changed);
  const midX = world.wrap(originX + Math.floor(blockW / 2));
  for (let i = 1; i < corridorYs.length; i++) {
    carveApartmentPressureSegment(world, midX, corridorYs[i - 1], midX, corridorYs[i], Tex.F_LINO, changed);
  }
  let doors = 0;
  for (const item of made) doors += connectApartmentPressureInfillRoom(world, item.room, item.corridorY, spec.seed ^ item.room.id * 733);
  const mid = { x: midX, y: world.wrap(corridorYs[Math.floor(corridorYs.length / 2)]) };
  if (connector && world.dist2(mid.x, mid.y, connector.x, connector.y) > 8 * 8) {
    carveCorridor(world, mid.x, mid.y, connector.x, connector.y);
  }
  return { rooms: made.length, cells: changed.size, doors, anchor: mid };
}

function apartmentPressureMemoryRoomType(seed: number, serial: number): RoomType {
  const types = [
    RoomType.LIVING,
    RoomType.LIVING,
    RoomType.STORAGE,
    RoomType.KITCHEN,
    RoomType.BATHROOM,
    RoomType.COMMON,
    RoomType.SMOKING,
  ] as const;
  return types[Math.abs(seed + serial * 13) % types.length];
}

function placeApartmentPressureCourtDoor(
  world: World,
  room: Room,
  side: 'top' | 'bottom' | 'left' | 'right',
  seed: number,
  cx: number,
  cy: number,
  changed: Set<number>,
): number {
  const doorX = side === 'left'
    ? room.x + room.w
    : side === 'right'
      ? room.x - 1
      : room.x + 1 + Math.abs(seed % Math.max(1, room.w - 2));
  const doorY = side === 'top'
    ? room.y + room.h
    : side === 'bottom'
      ? room.y - 1
      : room.y + 1 + Math.abs((seed >>> 4) % Math.max(1, room.h - 2));
  const outsideX = side === 'left' ? doorX + 1 : side === 'right' ? doorX - 1 : doorX;
  const outsideY = side === 'top' ? doorY + 1 : side === 'bottom' ? doorY - 1 : doorY;
  placeDoorAt(world, doorX, doorY, room.id);
  carveApartmentPressureInfillSegment(world, outsideX, outsideY, cx, cy, Tex.F_CONCRETE, changed);
  return world.cells[world.idx(doorX, doorY)] === Cell.DOOR ? 1 : 0;
}

function tryStampApartmentPressureCementMemoryCourt(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  originX: number,
  originY: number,
  courtW: number,
  courtH: number,
  serial: number,
): { rooms: number; cells: number; doors: number; anchor: { x: number; y: number } | null } {
  const cx = world.wrap(originX + Math.floor(courtW / 2));
  const cy = world.wrap(originY + Math.floor(courtH / 2));
  const seed = spec.seed ^ Math.imul(serial + 1, 0x9e3779b1);
  const plans: { x: number; y: number; w: number; h: number; side: 'top' | 'bottom' | 'left' | 'right'; type: RoomType }[] = [];
  const topY = originY + 3;
  const bottomY = originY + courtH - 12;
  let cursor = originX + 4 + (serial % 3);
  let planIndex = 0;
  while (cursor <= originX + courtW - 13) {
    const localSeed = seed ^ Math.imul(planIndex + 1, 0x45d9f3b);
    const w = 7 + Math.abs(localSeed % 4);
    const topH = 6 + Math.abs((localSeed >>> 5) % 4);
    const bottomH = 6 + Math.abs((localSeed >>> 9) % 4);
    plans.push({ x: cursor, y: topY, w, h: topH, side: 'top', type: apartmentPressureMemoryRoomType(localSeed, planIndex) });
    plans.push({ x: cursor, y: bottomY, w, h: bottomH, side: 'bottom', type: apartmentPressureMemoryRoomType(localSeed >>> 1, planIndex + 7) });
    cursor += w + 5;
    planIndex++;
  }
  for (let row = 0; row < 3; row++) {
    const localSeed = seed ^ Math.imul(row + 19, 0x27d4eb2d);
    const h = 7 + Math.abs((localSeed >>> 3) % 4);
    const y = originY + 15 + row * 11 + Math.abs((localSeed >>> 8) % 3);
    plans.push({ x: originX + 3, y, w: 7 + Math.abs(localSeed % 3), h, side: 'left', type: apartmentPressureMemoryRoomType(localSeed, row + 13) });
    plans.push({ x: originX + courtW - 11, y, w: 7 + Math.abs((localSeed >>> 11) % 3), h, side: 'right', type: apartmentPressureMemoryRoomType(localSeed >>> 1, row + 17) });
  }

  const made: Room[] = [];
  const changed = new Set<number>();
  let doors = 0;
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    if (!canPlaceRoom(world, plan.x, plan.y, plan.w, plan.h)) continue;
    const room = stampRoom(world, world.rooms.length, plan.type, plan.x, plan.y, plan.w, plan.h, -1);
    room.name = `Цементный двор памяти ${serial + 1}.${made.length + 1}`;
    applyRoomTexture(world, room, Tex.BRICK, plan.type === RoomType.BATHROOM ? Tex.F_TILE : Tex.F_LINO);
    decorateProceduralRoom(world, room, spec);
    if (plan.type === RoomType.KITCHEN) placeRoomFeatureFallback(world, room, Feature.STOVE, Math.floor(room.w / 2), Math.floor(room.h / 2), seed ^ i);
    else if (plan.type === RoomType.BATHROOM) placeRoomFeatureFallback(world, room, Feature.TOILET, Math.floor(room.w / 2), Math.floor(room.h / 2), seed ^ i);
    else if (plan.type === RoomType.STORAGE) placeRoomFeatureFallback(world, room, Feature.SHELF, Math.max(1, room.w - 2), Math.max(1, room.h - 2), seed ^ i);
    else if ((i + serial) % 4 === 0) placeRoomFeatureFallback(world, room, Feature.TABLE, Math.floor(room.w / 2), Math.floor(room.h / 2), seed ^ i);
    rooms.push(room);
    made.push(room);
    doors += placeApartmentPressureCourtDoor(world, room, plan.side, seed ^ i * 733, cx, cy, changed);
  }

  if (made.length < 4) return { rooms: made.length, cells: changed.size, doors, anchor: null };

  carveApartmentPressureInfillSegment(world, originX + 5, cy, originX + courtW - 6, cy, Tex.F_CONCRETE, changed);
  carveApartmentPressureInfillSegment(world, cx, originY + 8, cx, originY + courtH - 9, Tex.F_CONCRETE, changed);
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      carveApartmentPressureInfillFloor(world, cx + dx, cy + dy, Tex.F_CONCRETE, changed);
    }
  }
  const connector = nearestApartmentPressureWalkable(world, cx, cy, APARTMENT_PRESSURE_INFILL_LINK_RADIUS);
  if (connector && world.dist2(cx, cy, connector.x, connector.y) > 7 * 7) {
    carveApartmentPressureInfillSegment(world, cx, cy, connector.x, connector.y, Tex.F_LINO, changed);
  }
  const centerIdx = world.idx(cx, cy);
  if (world.cells[centerIdx] === Cell.FLOOR) world.features[centerIdx] = Feature.APPARATUS;
  return { rooms: made.length, cells: changed.size, doors, anchor: { x: cx, y: cy } };
}

function applyApartmentPressureCementMemoryCourts(world: World, rooms: Room[], spec: ProceduralFloorSpec): number {
  if (spec.anomalyId !== 'cement_memory') return 0;
  const margin = 22;
  const step = Math.floor((W - margin * 2) / APARTMENT_PRESSURE_CEMENT_MEMORY_GRID);
  const candidates: { x: number; y: number; w: number; h: number; score: number }[] = [];
  for (let gy = 0; gy < APARTMENT_PRESSURE_CEMENT_MEMORY_GRID; gy++) {
    for (let gx = 0; gx < APARTMENT_PRESSURE_CEMENT_MEMORY_GRID; gx++) {
      const seed = spec.seed ^ Math.imul(gx + 43, 0x85ebca6b) ^ Math.imul(gy + 59, 0xc2b2ae35);
      const w = Math.min(step - 5, 58 + Math.abs((seed >>> 4) % 15));
      const h = Math.min(step - 5, 48 + Math.abs((seed >>> 10) % 13));
      const x = Math.max(8, Math.min(W - w - 8, margin + gx * step + Math.floor((step - w) / 2) + Math.round((fieldHash01(seed, gx, gy, 0x671) - 0.5) * 16)));
      const y = Math.max(8, Math.min(W - h - 8, margin + gy * step + Math.floor((step - h) / 2) + Math.round((fieldHash01(seed, gx, gy, 0x672) - 0.5) * 16)));
      const diagonalBias = gx === gy || gx + gy === APARTMENT_PRESSURE_CEMENT_MEMORY_GRID - 1 ? 0.2 : 0;
      candidates.push({ x, y, w, h, score: fieldHash01(spec.seed, gx, gy, 0x673) + diagonalBias });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  let changed = 0;
  let courts = 0;
  const anchors: { x: number; y: number }[] = [];
  for (const candidate of candidates) {
    if (courts >= APARTMENT_PRESSURE_CEMENT_MEMORY_COURTS) break;
    const result = tryStampApartmentPressureCementMemoryCourt(world, rooms, spec, candidate.x, candidate.y, candidate.w, candidate.h, courts);
    if (result.rooms < 4 || !result.anchor) continue;
    changed += result.cells + result.doors + result.rooms;
    if (anchors.length > 0 && (courts % 3) === 2) {
      const prev = anchors[Math.max(0, anchors.length - 1 - (courts % Math.min(4, anchors.length)))];
      const linkChanged = new Set<number>();
      carveApartmentPressureInfillSegment(world, result.anchor.x, result.anchor.y, prev.x, prev.y, Tex.F_LINO, linkChanged);
      changed += linkChanged.size;
    }
    anchors.push(result.anchor);
    courts++;
  }
  return changed;
}

function applyApartmentPressureInfill(world: World, rooms: Room[], spec: ProceduralFloorSpec): number {
  const targetRooms = apartmentPressureInfillTargetRooms(spec);
  const beforeRooms = rooms.length;
  const candidates: { x: number; y: number; w: number; h: number; score: number }[] = [];
  const margin = 18;
  const step = Math.floor((W - margin * 2) / APARTMENT_PRESSURE_INFILL_GRID);
  for (let gy = 0; gy < APARTMENT_PRESSURE_INFILL_GRID; gy++) {
    for (let gx = 0; gx < APARTMENT_PRESSURE_INFILL_GRID; gx++) {
      const seed = spec.seed ^ Math.imul(gx + 17, 0x85ebca6b) ^ Math.imul(gy + 31, 0xc2b2ae35);
      const w = Math.min(step - 4, 70 + Math.abs((seed >>> 3) % 18));
      const h = Math.min(step - 4, 58 + Math.abs((seed >>> 9) % 16));
      const jitterX = Math.round((fieldHash01(seed, gx, gy, 0x341) - 0.5) * 12);
      const jitterY = Math.round((fieldHash01(seed, gx, gy, 0x342) - 0.5) * 12);
      const x = Math.max(8, Math.min(W - w - 8, margin + gx * step + Math.floor((step - w) / 2) + jitterX));
      const y = Math.max(8, Math.min(W - h - 8, margin + gy * step + Math.floor((step - h) / 2) + jitterY));
      const score = fieldHash01(spec.seed, gx, gy, 0x343) + (gx === gy || gx + gy === APARTMENT_PRESSURE_INFILL_GRID - 1 ? 0.22 : 0);
      candidates.push({ x, y, w, h, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  let changed = 0;
  let blocks = 0;
  const anchors: { x: number; y: number }[] = [];
  for (const candidate of candidates) {
    if (blocks >= APARTMENT_PRESSURE_INFILL_MAX_BLOCKS || rooms.length - beforeRooms >= targetRooms) break;
    const result = tryStampApartmentPressureInfillBlock(world, rooms, spec, candidate.x, candidate.y, candidate.w, candidate.h, blocks);
    if (result.rooms < 4) continue;
    changed += result.cells + result.doors;
    blocks++;
    if (result.anchor) {
      if (anchors.length > 0 && (blocks % 5 === 0 || result.rooms >= 10)) {
        const prev = anchors[Math.max(0, anchors.length - 1 - (blocks % Math.min(3, anchors.length)))];
        carveCorridor(world, result.anchor.x, result.anchor.y, prev.x, prev.y);
      }
      anchors.push(result.anchor);
    }
  }
  return changed + Math.max(0, rooms.length - beforeRooms);
}

function nearestApartmentPressureWalkable(world: World, sx: number, sy: number, radius: number): { x: number; y: number } | null {
  const startX = world.wrap(Math.floor(sx));
  const startY = world.wrap(Math.floor(sy));
  for (let r = 0; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = world.wrap(startX + dx);
        const y = world.wrap(startY + dy);
        const ci = world.idx(x, y);
        if (world.aptMask[ci] || world.hermoWall[ci]) continue;
        if (isConnectivityWalkable(world, ci)) return { x, y };
      }
    }
  }
  return null;
}

function apartmentPressureAnchorForRoom(world: World, id: string, label: string, room: Room | null): ApartmentPressureAnchor | null {
  if (!room) return null;
  const center = roomCenter(room);
  const access = nearestApartmentPressureWalkable(world, center.x, center.y, 28) ?? center;
  return {
    id,
    label,
    x: center.x + 0.5,
    y: center.y + 0.5,
    accessX: access.x + 0.5,
    accessY: access.y + 0.5,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(access.x, access.y)],
  };
}

function pickApartmentPressureRoom(
  world: World,
  rooms: readonly Room[],
  used: Set<number>,
  refX: number,
  refY: number,
  filter: (room: Room) => boolean,
  preferFar: boolean,
): Room | null {
  let best: Room | null = null;
  let bestScore = -Infinity;
  for (const room of rooms) {
    if (!room || used.has(room.id) || !filter(room)) continue;
    const center = roomCenter(room);
    const d2 = world.dist2(refX, refY, center.x + 0.5, center.y + 0.5);
    const size = Math.min(80, room.w * room.h) * 2;
    const score = (preferFar ? Math.min(280 * 280, d2) / 600 : -d2 / 900) + size;
    if (score > bestScore) {
      bestScore = score;
      best = room;
    }
  }
  if (best) used.add(best.id);
  return best;
}

function findApartmentPressureLiftAnchor(
  world: World,
  direction: LiftDirection,
  id: string,
  refX: number,
  refY: number,
): ApartmentPressureAnchor | null {
  let bestCell = -1;
  let bestAccess: { x: number; y: number } | null = null;
  let bestD2 = Infinity;
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of CONNECTIVITY_DIRS) {
      const ax = world.wrap(x + dx);
      const ay = world.wrap(y + dy);
      const ai = world.idx(ax, ay);
      if (!isConnectivityWalkable(world, ai)) continue;
      const d2 = world.dist2(refX, refY, ax + 0.5, ay + 0.5);
      if (d2 < bestD2) {
        bestD2 = d2;
        bestCell = i;
        bestAccess = { x: ax, y: ay };
      }
    }
  }
  if (bestCell < 0 || !bestAccess) return null;
  return {
    id,
    label: direction === LiftDirection.UP ? 'верхняя шахта' : 'нижняя шахта',
    x: (bestCell % W) + 0.5,
    y: ((bestCell / W) | 0) + 0.5,
    accessX: bestAccess.x + 0.5,
    accessY: bestAccess.y + 0.5,
    zoneId: world.zoneMap[world.idx(bestAccess.x, bestAccess.y)],
  };
}

function applyApartmentPressureDomains(world: World, rooms: readonly Room[], spec: ProceduralFloorSpec): void {
  const counts = new Int32Array(APARTMENT_PRESSURE_DOMAINS.length);
  for (const room of rooms) {
    if (
      room.type !== RoomType.LIVING &&
      room.type !== RoomType.KITCHEN &&
      room.type !== RoomType.BATHROOM &&
      room.type !== RoomType.COMMON &&
      room.type !== RoomType.STORAGE &&
      room.type !== RoomType.SMOKING
    ) continue;
    const center = roomCenter(room);
    const domainIndex = Math.abs((Math.floor(center.x / 64) + Math.floor(center.y / 64) * 3 + room.id * 17 + spec.seed) % APARTMENT_PRESSURE_DOMAINS.length);
    const domain = APARTMENT_PRESSURE_DOMAINS[domainIndex];
    counts[domainIndex]++;
    if (counts[domainIndex] <= 10) room.name = `${domain.label} ${room.id}`;
    if (room.type === RoomType.KITCHEN || room.type === RoomType.COMMON || room.type === RoomType.SMOKING) {
      placeRoomFeature(world, room, domain.feature, Math.floor(room.w / 2), Math.floor(room.h / 2));
    }
    if ((room.id + spec.seed) % 5 === 0) setAdminRoomFloor(world, room, domain.floorTex);
  }
}

function carveApartmentPressureQueueLoop(world: World, anchor: ApartmentPressureAnchor, seed: number): number {
  const base = nearestApartmentPressureWalkable(world, Math.floor(anchor.accessX), Math.floor(anchor.accessY), 16);
  if (!base) return 0;
  const rx = 5 + (seed % 3);
  const ry = 4 + ((seed >> 3) % 3);
  const corners = [
    { x: world.wrap(base.x - rx), y: world.wrap(base.y - ry) },
    { x: world.wrap(base.x + rx), y: world.wrap(base.y - ry) },
    { x: world.wrap(base.x + rx), y: world.wrap(base.y + ry) },
    { x: world.wrap(base.x - rx), y: world.wrap(base.y + ry) },
  ];
  const changed = new Set<number>();
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    carveApartmentPressureSegment(world, a.x, a.y, b.x, b.y, Tex.F_LINO, changed);
  }
  let n = 0;
  for (const ci of changed) {
    if (world.cells[ci] !== Cell.FLOOR || world.features[ci] !== Feature.NONE) continue;
    if (n++ % 6 === 0) world.features[ci] = n % 2 === 0 ? Feature.CHAIR : Feature.TABLE;
  }
  return changed.size;
}

function openApartmentPressureRouteDoor(
  world: World,
  room: Room,
  targetX: number,
  targetY: number,
  state: DoorState,
  keyId: string,
): number {
  const exit = apartmentPressureDoorExit(world, room, Math.floor(targetX), Math.floor(targetY));
  const doorCell = world.idx(exit.wx, exit.wy);
  if (!world.aptMask[doorCell] && world.cells[doorCell] !== Cell.WALL && world.cells[doorCell] !== Cell.DOOR) {
    world.cells[doorCell] = Cell.WALL;
    world.roomMap[doorCell] = -1;
    world.wallTex[doorCell] = room.wallTex;
    world.features[doorCell] = Feature.NONE;
  }
  reinforceApartmentPressureDoorJambs(world, exit, room.wallTex);
  placeDoorAt(world, exit.wx, exit.wy, room.id);
  const doorIdx = doorCell;
  const outside = nearestApartmentPressureWalkable(world, exit.ox, exit.oy, 36);
  if (outside) carveCorridor(world, exit.ox, exit.oy, outside.x, outside.y);
  else {
    const changed = new Set<number>();
    carveApartmentPressureCell(world, exit.ox, exit.oy, Tex.F_LINO, changed);
  }
  const door = world.doors.get(doorIdx);
  if (door) {
    braceApartmentPressureDoor(world, room, doorIdx);
    setDoorState(world, door, state);
    door.keyId = keyId;
    world.wallTex[doorIdx] = state === DoorState.LOCKED ? Tex.DOOR_METAL : Tex.DOOR_WOOD;
    return doorIdx;
  }
  return -1;
}

function reinforceApartmentPressureDoorJambs(
  world: World,
  exit: { wx: number; wy: number; ox: number; oy: number },
  wallTex: Tex,
): void {
  const horizontalPass = world.wrap(exit.ox) !== world.wrap(exit.wx);
  const jambs = horizontalPass
    ? [{ x: exit.wx, y: exit.wy - 1 }, { x: exit.wx, y: exit.wy + 1 }]
    : [{ x: exit.wx - 1, y: exit.wy }, { x: exit.wx + 1, y: exit.wy }];
  for (const jamb of jambs) {
    const idx = world.idx(jamb.x, jamb.y);
    if (world.aptMask[idx] || world.hermoWall[idx] || world.cells[idx] === Cell.LIFT || world.doors.has(idx) || world.containerMap.has(idx)) continue;
    if (world.roomMap[idx] >= 0) continue;
    world.cells[idx] = Cell.WALL;
    world.roomMap[idx] = -1;
    world.wallTex[idx] = wallTex;
    world.features[idx] = Feature.NONE;
  }
}

function apartmentPressureDoorExit(world: World, room: Room, targetX: number, targetY: number): { wx: number; wy: number; ox: number; oy: number } {
  const preferred = roomExit(world, room, targetX, targetY);
  if (!world.aptMask[world.idx(preferred.wx, preferred.wy)]) return preferred;

  let best = preferred;
  let bestD2 = Number.POSITIVE_INFINITY;
  const consider = (wx: number, wy: number, ox: number, oy: number): void => {
    const idx = world.idx(wx, wy);
    if (world.aptMask[idx]) return;
    const d2 = world.dist2(wx, wy, targetX, targetY);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = { wx: world.wrap(wx), wy: world.wrap(wy), ox: world.wrap(ox), oy: world.wrap(oy) };
    }
  };

  for (let dx = 0; dx < room.w; dx++) {
    const x = room.x + dx;
    consider(x, room.y - 1, x, room.y - 2);
    consider(x, room.y + room.h, x, room.y + room.h + 1);
  }
  for (let dy = 0; dy < room.h; dy++) {
    const y = room.y + dy;
    consider(room.x - 1, y, room.x - 2, y);
    consider(room.x + room.w, y, room.x + room.w + 1, y);
  }
  return best;
}

function braceApartmentPressureDoor(world: World, room: Room, doorIdx: number): void {
  const x = doorIdx % W;
  const y = (doorIdx / W) | 0;
  const horizontalDoor = x >= room.x && x < room.x + room.w;
  const braces = horizontalDoor ? [[-1, 0], [1, 0]] as const : [[0, -1], [0, 1]] as const;
  for (const [dx, dy] of braces) {
    const idx = world.idx(x + dx, y + dy);
    if (world.aptMask[idx] || world.cells[idx] === Cell.DOOR) continue;
    world.cells[idx] = Cell.WALL;
    world.roomMap[idx] = -1;
    world.wallTex[idx] = room.wallTex;
    world.features[idx] = Feature.NONE;
  }
}

function lockExistingApartmentPressureDoor(world: World, room: Room, keyId: string): number {
  const existing = room.doors.find(idx => {
    const door = world.doors.get(idx);
    return door && door.state !== DoorState.HERMETIC_CLOSED && door.state !== DoorState.HERMETIC_OPEN;
  });
  if (existing !== undefined) {
    const door = world.doors.get(existing);
    if (door) {
      braceApartmentPressureDoor(world, room, existing);
      setDoorState(world, door, DoorState.LOCKED);
      door.keyId = keyId;
      world.wallTex[existing] = Tex.DOOR_METAL;
      return existing;
    }
  }
  const center = roomCenter(room);
  return openApartmentPressureRouteDoor(world, room, center.x + 24, center.y, DoorState.LOCKED, keyId);
}

function carveApartmentPressureBraid(
  world: World,
  from: ApartmentPressureAnchor,
  to: ApartmentPressureAnchor,
  route: ApartmentPressureRouteKind,
  spec: ProceduralFloorSpec,
): number {
  const sx = Math.floor(from.accessX);
  const sy = Math.floor(from.accessY);
  const tx = Math.floor(to.accessX);
  const ty = Math.floor(to.accessY);
  const dx = world.delta(sx, tx);
  const dy = world.delta(sy, ty);
  const bend = route === 'crowd_route' ? 18 : route === 'barricade_detour' ? 14 : 10;
  const side = ((spec.seed + from.id.length * 13 + to.id.length * 7) & 1) === 0 ? 1 : -1;
  const changed = new Set<number>();
  const midX = world.wrap(Math.round(sx + dx / 2 + side * Math.sign(dy || 1) * bend));
  const midY = world.wrap(Math.round(sy + dy / 2 - side * Math.sign(dx || 1) * bend));
  carveApartmentPressureSegment(world, sx, sy, midX, midY, Tex.F_LINO, changed);
  carveApartmentPressureSegment(world, midX, midY, tx, ty, Tex.F_LINO, changed);
  if (route === 'crowd_route') {
    const altX = world.wrap(Math.round(sx + dx / 2 - side * Math.sign(dy || 1) * (bend + 6)));
    const altY = world.wrap(Math.round(sy + dy / 2 + side * Math.sign(dx || 1) * (bend + 6)));
    carveApartmentPressureSegment(world, sx, sy, altX, altY, Tex.F_CONCRETE, changed);
    carveApartmentPressureSegment(world, altX, altY, tx, ty, Tex.F_CONCRETE, changed);
  }
  return changed.size;
}

function decorateApartmentPressureBarricade(world: World, anchor: ApartmentPressureAnchor, spec: ProceduralFloorSpec): number {
  const cx = Math.floor(anchor.accessX);
  const cy = Math.floor(anchor.accessY);
  let placed = 0;
  for (let i = -5; i <= 5; i++) {
    const x = world.wrap(cx + i);
    const y = world.wrap(cy + ((i + spec.seed) & 1));
    const ci = world.idx(x, y);
    if (world.cells[ci] !== Cell.FLOOR || world.features[ci] !== Feature.NONE) continue;
    world.features[ci] = i % 3 === 0 ? Feature.SHELF : Feature.TABLE;
    placed++;
  }
  return placed;
}

function registerApartmentPressureCue(
  world: World,
  spec: ProceduralFloorSpec,
  route: ApartmentPressureRouteKind,
  from: ApartmentPressureAnchor,
  to: ApartmentPressureAnchor,
): void {
  const profile = APARTMENT_PRESSURE_ROUTE_LABELS[route];
  registerRouteCue(world, {
    id: `procedural_${spec.key}_apartment_pressure_${route}`,
    x: from.accessX,
    y: from.accessY,
    targetX: to.accessX,
    targetY: to.accessY,
    floor: spec.baseFloor,
    roomId: from.roomId,
    targetRoomId: to.roomId,
    zoneId: from.zoneId,
    label: profile.label,
    hint: profile.hint,
    targetName: to.label || profile.targetName,
    color: profile.color,
    tags: ['procedural_floor', 'apartment_pressure', 'route_choice', route, spec.majorityId],
    toneSeed: (spec.seed ^ from.id.length * 4099 ^ to.id.length * 131) >>> 0,
    radius: 10,
    targetRadius: 3,
    cooldownSec: 34,
    heardText: `Квартирная давка подсказывает: ${profile.hint}.`,
    followedText: `Вы выбрали ${profile.label}.`,
    ignoredText: `${profile.label} осталась шуметь за стеной.`,
    routeGroup: {
      id: `apartment_pressure_${route}`,
      lead: profile.hint,
      risk: profile.risk,
      decision: profile.decision,
      reward: profile.reward,
      mapLabel: profile.label,
    },
  });
}

function applyApartmentPressure(world: World, rooms: Room[], spec: ProceduralFloorSpec, spawnX: number, spawnY: number): void {
  if (spec.geometryId !== 'apartment_pressure') return;

  const used = new Set<number>();
  const carvedInfill = applyApartmentPressureInfill(world, rooms, spec);
  const carvedSlabs = carveApartmentPressureSlabs(world, rooms, spec);
  applyApartmentPressureDomains(world, rooms, spec);
  const carvedMemoryCourts = applyApartmentPressureCementMemoryCourts(world, rooms, spec);

  const legalRoom = pickApartmentPressureRoom(
    world,
    rooms,
    used,
    spawnX,
    spawnY,
    room => room.type === RoomType.COMMON || room.type === RoomType.STORAGE || room.type === RoomType.SMOKING,
    false,
  );
  const crowdRoom = pickApartmentPressureRoom(
    world,
    rooms,
    used,
    spawnX,
    spawnY,
    room => room.type === RoomType.KITCHEN || room.type === RoomType.COMMON || room.type === RoomType.BATHROOM,
    true,
  );
  const cutRoom = pickApartmentPressureRoom(
    world,
    rooms,
    used,
    spawnX,
    spawnY,
    room => room.type === RoomType.LIVING && room.w <= 14 && room.h <= 14,
    false,
  ) ?? pickApartmentPressureRoom(world, rooms, used, spawnX, spawnY, room => room.type === RoomType.LIVING, false);
  const barricadeRoom = pickApartmentPressureRoom(
    world,
    rooms,
    used,
    spawnX,
    spawnY,
    room => room.type === RoomType.STORAGE || room.type === RoomType.SMOKING || room.type === RoomType.COMMON,
    true,
  );

  const legal = apartmentPressureAnchorForRoom(world, 'legal', 'дверь домкома', legalRoom);
  const crowd = apartmentPressureAnchorForRoom(world, 'crowd', 'очередной карман', crowdRoom);
  const cut = apartmentPressureAnchorForRoom(world, 'cut', 'чужая квартира', cutRoom);
  const barricade = apartmentPressureAnchorForRoom(world, 'barricade', 'баррикадный пролёт', barricadeRoom);
  const liftDown = findApartmentPressureLiftAnchor(world, LiftDirection.DOWN, 'lift_down', spawnX, spawnY);
  const liftUp = findApartmentPressureLiftAnchor(world, LiftDirection.UP, 'lift_up', spawnX, spawnY);

  let changed = carvedInfill + carvedSlabs + carvedMemoryCourts;
  for (const anchor of [legal, crowd, cut, barricade]) {
    if (anchor) changed += carveApartmentPressureQueueLoop(world, anchor, spec.seed ^ anchor.id.length * 733);
  }

  if (legalRoom) {
    const doorIdx = lockExistingApartmentPressureDoor(world, legalRoom, APARTMENT_PRESSURE_LEGAL_KEY);
    if (doorIdx >= 0) changed++;
    placeRoomFeature(world, legalRoom, Feature.SCREEN, Math.floor(legalRoom.w / 2), Math.floor(legalRoom.h / 2));
  }
  if (cutRoom && crowd && barricade) {
    const first = openApartmentPressureRouteDoor(world, cutRoom, crowd.accessX, crowd.accessY, DoorState.LOCKED, APARTMENT_PRESSURE_CUT_KEY);
    const second = openApartmentPressureRouteDoor(world, cutRoom, barricade.accessX, barricade.accessY, DoorState.CLOSED, '');
    if (first >= 0) changed++;
    if (second >= 0 && second !== first) changed++;
  }
  if (barricade) changed += decorateApartmentPressureBarricade(world, barricade, spec);

  if (legal && crowd) {
    changed += carveApartmentPressureBraid(world, legal, crowd, 'crowd_route', spec);
    registerApartmentPressureCue(world, spec, 'legal_door', legal, crowd);
    registerApartmentPressureCue(world, spec, 'crowd_route', crowd, legal);
  }
  if (crowd && cut) {
    changed += carveApartmentPressureBraid(world, crowd, cut, 'cut_through', spec);
    registerApartmentPressureCue(world, spec, 'cut_through', crowd, cut);
  }
  if (barricade && (liftDown ?? liftUp)) {
    const target = liftDown ?? liftUp!;
    changed += carveApartmentPressureBraid(world, barricade, target, 'barricade_detour', spec);
    registerApartmentPressureCue(world, spec, 'barricade_detour', barricade, target);
  }

  if (changed > 0) {
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFeaturesDirty(true);
  }
}

function applyCollectorZombieResidentialInfill(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  spawnX: number,
  spawnY: number,
): void {
  if (spec.geometryId !== 'collectors' || spec.anomalyId !== 'zombie_apocalypse') return;
  const beforeRooms = rooms.length;
  const changed = applyApartmentPressureInfill(world, rooms, spec);
  const addedRooms = rooms.slice(beforeRooms);
  if (addedRooms.length === 0 && changed === 0) return;

  for (const room of addedRooms) {
    if (room.name.startsWith('Квартирная давка')) room.name = `Зараженный жилблок ${room.id}`;
  }

  const nearest = addedRooms
    .slice()
    .sort((a, b) => roomDist2(world, spawnX, spawnY, a) - roomDist2(world, spawnX, spawnY, b))[0];
  const farthest = addedRooms
    .slice()
    .sort((a, b) => roomDist2(world, spawnX, spawnY, b) - roomDist2(world, spawnX, spawnY, a))[0];
  if (nearest && farthest) {
    const from = roomCenter(nearest);
    const to = roomCenter(farthest);
    registerRouteCue(world, {
      id: `procedural_${spec.key}_collector_zombie_residential_infill`,
      x: from.x + 0.5,
      y: from.y + 0.5,
      targetX: to.x + 0.5,
      targetY: to.y + 0.5,
      floor: spec.baseFloor,
      roomId: nearest.id,
      targetRoomId: farthest.id,
      zoneId: world.zoneMap[world.idx(from.x, from.y)],
      label: 'зараженный жилой рукав',
      hint: 'коллектор раскрывается в плотные жилые карманы между мокрыми магистралями',
      targetName: farthest.name,
      color: '#d1b06a',
      tags: ['procedural_floor', 'collectors', 'zombie_apocalypse', 'residential_infill', 'multi_scale'],
      toneSeed: (spec.seed ^ 0x62c011ec) >>> 0,
      radius: 12,
      targetRadius: 4,
      cooldownSec: 45,
      heardText: 'За трубами слышны квартирные двери: заражение ушло не в круг, а в жилую толщу.',
      followedText: 'Жилой рукав вывел к другому масштабу зараженного коллектора.',
      ignoredText: 'Жилой рукав остался за влажной магистралью.',
    });
  }

  world.markCellsDirty();
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFeaturesDirty(true);
}

interface WildMajorityLeaf {
  room: Room;
  sourceRoom: Room;
  markerX: number;
  markerY: number;
}

interface WildMajorityChord {
  fromRoom: Room;
  toRoom: Room;
  markerX: number;
  markerY: number;
  targetX: number;
  targetY: number;
}

interface WildMajorityLayout {
  leaves: WildMajorityLeaf[];
  chords: WildMajorityChord[];
}

interface WildRewardSite {
  room: Room;
  sourceRoom: Room;
  markerX: number;
  markerY: number;
  containerId?: number;
}

function emptyWildMajorityLayout(): WildMajorityLayout {
  return { leaves: [], chords: [] };
}

function wildMajorityRoomScore(world: World, room: Room, spec: ProceduralFloorSpec, spawnX: number, spawnY: number): number {
  const center = roomCenter(room);
  let score = hashUnit3(spec.seed, room.id, room.type) * 100;
  score += Math.min(64, world.dist(spawnX, spawnY, center.x, center.y) * 0.42);
  if (room.type === RoomType.STORAGE) score += 44;
  if (room.type === RoomType.CORRIDOR) score += 34;
  if (room.type === RoomType.PRODUCTION) score += 24;
  if (room.type === RoomType.COMMON) score += 16;
  if (room.doors.length <= 1) score += 20;
  score += Math.min(26, room.w * room.h / 12);
  return score;
}

function wildMajorityCandidateRooms(world: World, rooms: readonly Room[], spec: ProceduralFloorSpec, spawnX: number, spawnY: number): Room[] {
  const far = rooms
    .filter(room => (
      room.id !== 0 &&
      room.w >= 5 &&
      room.h >= 5 &&
      room.type !== RoomType.BATHROOM &&
      room.type !== RoomType.KITCHEN &&
      world.dist2(spawnX, spawnY, roomCenter(room).x, roomCenter(room).y) >= 38 * 38
    ))
    .sort((a, b) => wildMajorityRoomScore(world, b, spec, spawnX, spawnY) - wildMajorityRoomScore(world, a, spec, spawnX, spawnY));
  if (far.length > 0) return far;
  return rooms
    .filter(room => room.id !== 0 && room.w >= 5 && room.h >= 5 && room.type !== RoomType.BATHROOM)
    .sort((a, b) => wildMajorityRoomScore(world, b, spec, spawnX, spawnY) - wildMajorityRoomScore(world, a, spec, spawnX, spawnY));
}

function wildLeafPlacementOptions(source: Room, leafW: number, leafH: number, seed: number): { x: number; y: number }[] {
  const options: { x: number; y: number }[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    const side = (seed + attempt) & 3;
    const gap = 4 + ((seed >>> (attempt % 7)) & 7);
    const jitterX = ((seed + attempt * 13) % Math.max(1, source.w)) - Math.floor(source.w / 2);
    const jitterY = ((seed + attempt * 17) % Math.max(1, source.h)) - Math.floor(source.h / 2);
    if (side === 0) {
      options.push({
        x: source.x + source.w + gap,
        y: source.y + Math.floor((source.h - leafH) / 2) + Math.floor(jitterY / 3),
      });
    } else if (side === 1) {
      options.push({
        x: source.x - gap - leafW,
        y: source.y + Math.floor((source.h - leafH) / 2) + Math.floor(jitterY / 3),
      });
    } else if (side === 2) {
      options.push({
        x: source.x + Math.floor((source.w - leafW) / 2) + Math.floor(jitterX / 3),
        y: source.y - gap - leafH,
      });
    } else {
      options.push({
        x: source.x + Math.floor((source.w - leafW) / 2) + Math.floor(jitterX / 3),
        y: source.y + source.h + gap,
      });
    }
  }
  return options;
}

function connectWildRooms(world: World, from: Room, to: Room): { markerX: number; markerY: number; targetX: number; targetY: number } {
  const fromCenter = roomCenter(from);
  const toCenter = roomCenter(to);
  const fromExit = roomExit(world, from, toCenter.x, toCenter.y);
  const toExit = roomExit(world, to, fromCenter.x, fromCenter.y);
  placeDoorAt(world, fromExit.wx, fromExit.wy, from.id);
  placeDoorAt(world, toExit.wx, toExit.wy, to.id);
  carveCorridor(world, fromExit.ox, fromExit.oy, toExit.ox, toExit.oy);
  return {
    markerX: fromExit.ox,
    markerY: fromExit.oy,
    targetX: toExit.ox,
    targetY: toExit.oy,
  };
}

function decorateWildRewardLeaf(world: World, room: Room, spec: ProceduralFloorSpec, index: number): void {
  room.name = `Дикая тупиковая закладка ${room.id}`;
  applyRoomTexture(world, room, Tex.ROTTEN, Tex.F_CONCRETE);
  decorateRoom(world, room);
  decorateProceduralRoom(world, room, spec);
  placeRoomFeature(world, room, Feature.SHELF, 1, 1);
  placeRoomFeature(world, room, Feature.TABLE, room.w - 2, room.h - 2);
  placeRoomFeature(world, room, Feature.LAMP, Math.floor(room.w / 2), 1);
  const center = roomCenter(room);
  stampMark(world, center.x, center.y, 0.5, 0.5, 0.45, MarkType.SPLAT, spec.seed ^ (room.id * 1103) ^ index, 112, 21, 12, 190, false);
  for (let i = 0; i < 5; i++) {
    const px = world.wrap(room.x + 1 + ((spec.seed + index * 19 + i * 5) % Math.max(1, room.w - 2)));
    const py = world.wrap(room.y + 1 + ((spec.seed + index * 23 + i * 7) % Math.max(1, room.h - 2)));
    stampSurfaceSplat(world, px, py, 0.5, 0.5, 0.2 + (i % 3) * 0.04, 135, spec.seed ^ (room.id * 541) ^ i, 71, 54, 31, i % 2 === 0);
  }
}

function tryCreateWildRewardLeaf(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  source: Room,
  index: number,
): WildMajorityLeaf | null {
  const seed = (spec.seed ^ (source.id * 0x45d9) ^ (index * 0x27d4)) >>> 0;
  const leafW = 5 + (seed % 3);
  const leafH = 5 + ((seed >>> 5) % 3);
  for (const option of wildLeafPlacementOptions(source, leafW, leafH, seed)) {
    if (!canPlaceRoom(world, option.x, option.y, leafW, leafH)) continue;
    const leaf = stampRoom(world, rooms.length, RoomType.STORAGE, option.x, option.y, leafW, leafH, -1);
    rooms[leaf.id] = leaf;
    decorateWildRewardLeaf(world, leaf, spec, index);
    const link = connectWildRooms(world, source, leaf);
    return { room: leaf, sourceRoom: source, markerX: link.markerX, markerY: link.markerY };
  }
  return null;
}

function registerWildShortcutCue(world: World, spec: ProceduralFloorSpec, chord: WildMajorityChord, index: number): void {
  registerRouteCue(world, {
    id: `procedural_${spec.key}_wild_shortcut_${index}`,
    x: chord.markerX + 0.5,
    y: chord.markerY + 0.5,
    targetX: chord.targetX + 0.5,
    targetY: chord.targetY + 0.5,
    floor: spec.baseFloor,
    roomId: chord.fromRoom.id,
    targetRoomId: chord.toRoom.id,
    zoneId: world.zoneMap[world.idx(chord.markerX, chord.markerY)],
    label: 'дикий короткий ход',
    hint: 'новый пролом режет путь, но шумит и пахнет засадой',
    targetName: chord.toRoom.name,
    color: '#d08b3e',
    tags: ['procedural_floor', 'majority_wild', WILD_MAJORITY_SHORTCUT_TAG, WILD_MAJORITY_RISK_TAG, WILD_MAJORITY_AMBUSH_TAG, spec.geometryId, spec.anomalyId],
    toneSeed: (spec.seed ^ chord.fromRoom.id * 379 ^ chord.toRoom.id * 733 ^ index) >>> 0,
    radius: 12,
    targetRadius: 4,
    cooldownSec: 31,
    heardText: 'Из бокового пролома тянет табаком и железом. Это коротко, но там ждут не маршрут, а ошибку.',
    followedText: 'Дикий короткий ход срезал петлю. Шум за спиной остался платой за скорость.',
    ignoredText: 'Боковой пролом остался темным. Основной ход никуда не делся.',
    routeGroup: {
      id: `wild_shortcut_${spec.key}_${index}`,
      lead: 'пролом показывает короткий путь',
      risk: 'шумный проход выводит к засаде',
      decision: 'идти коротко, обойти, спрятаться или отступить',
      reward: 'быстрый выход к дальнему блоку',
      mapLabel: 'дикий пролом',
      mapHint: 'рискованный короткий ход',
    },
  });
}

function applyWildMajorityGeometry(world: World, rooms: Room[], spec: ProceduralFloorSpec, spawnX: number, spawnY: number): WildMajorityLayout {
  if (spec.majorityId !== 'wild') return emptyWildMajorityLayout();
  const candidates = wildMajorityCandidateRooms(world, rooms, spec, spawnX, spawnY);
  if (candidates.length === 0) return emptyWildMajorityLayout();

  const leaves: WildMajorityLeaf[] = [];
  const leafTarget = Math.min(candidates.length, Math.max(2, Math.min(4, 2 + Math.floor(spec.danger / 2))));
  const usedSources = new Set<number>();
  for (const source of candidates) {
    if (leaves.length >= leafTarget) break;
    if (usedSources.has(source.id)) continue;
    const leaf = tryCreateWildRewardLeaf(world, rooms, spec, source, leaves.length);
    if (!leaf) continue;
    usedSources.add(source.id);
    leaves.push(leaf);
  }

  const chords: WildMajorityChord[] = [];
  const chordTarget = Math.min(3, Math.max(1, Math.floor(spec.danger / 2)), Math.floor(candidates.length / 2));
  for (let i = 0; i < chordTarget; i++) {
    const from = candidates[i];
    const to = candidates[candidates.length - 1 - i];
    if (!from || !to || from.id === to.id) continue;
    const fromCenter = roomCenter(from);
    const toCenter = roomCenter(to);
    if (world.dist2(fromCenter.x, fromCenter.y, toCenter.x, toCenter.y) < 54 * 54) continue;
    const link = connectWildRooms(world, from, to);
    const chord: WildMajorityChord = { fromRoom: from, toRoom: to, ...link };
    chords.push(chord);
    registerWildShortcutCue(world, spec, chord, i);
    stampSurfaceSplat(world, link.markerX, link.markerY, 0.5, 0.5, 0.34, 180, spec.seed ^ (i * 991), 94, 43, 19, true);
    stampSurfaceSplat(world, link.targetX, link.targetY, 0.5, 0.5, 0.22, 135, spec.seed ^ (i * 1301), 63, 54, 42, false);
  }

  if (leaves.length > 0 || chords.length > 0) {
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFeaturesDirty(true);
  }
  return { leaves, chords };
}

function wildMajorityRewardInventory(room: Room, kind: ContainerKind, spec: ProceduralFloorSpec, index: number): Item[] {
  const def = CONTAINER_DEFS[kind];
  const valueCap = Math.floor(proceduralContainerValueCap(kind, spec) * 1.35);
  const inv: Item[] = [];
  const staples: readonly Item[] = [
    { defId: 'filtered_water', count: 1 },
    { defId: 'gasmask_filter', count: 1 },
    { defId: 'bandage', count: 1 },
    { defId: index % 2 === 0 ? 'ammo_nails' : 'grey_briquette', count: index % 2 === 0 ? 4 : 2 },
    { defId: index % 3 === 0 ? 'filter_receipt' : 'water_coupon', count: 1 },
  ];
  for (const item of staples) addCappedItem(inv, item, valueCap, def.capacitySlots);
  for (const item of seedProceduralLootInventory(room, kind, spec)) {
    if (inv.length >= Math.min(def.capacitySlots, 5 + spec.danger)) break;
    addCappedItem(inv, item, valueCap, def.capacitySlots);
  }
  return inv;
}

function placeWildMajorityRewards(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  layout: WildMajorityLayout,
  reachable: Uint8Array,
  spawnX: number,
  spawnY: number,
): WildRewardSite[] {
  if (spec.majorityId !== 'wild') return [];
  const occupied = new Set<number>(world.containers.map(container => world.idx(container.x, container.y)));
  const sites: WildRewardSite[] = layout.leaves.map(leaf => ({
    room: leaf.room,
    sourceRoom: leaf.sourceRoom,
    markerX: leaf.markerX,
    markerY: leaf.markerY,
  }));
  const fallbackRooms = wildMajorityCandidateRooms(world, rooms, spec, spawnX, spawnY)
    .filter(room => !sites.some(site => site.room.id === room.id));
  for (const room of fallbackRooms) {
    if (sites.length >= 3) break;
    const center = roomCenter(room);
    sites.push({ room, sourceRoom: room, markerX: center.x, markerY: center.y });
  }

  const placed: WildRewardSite[] = [];
  for (const site of sites) {
    if (placed.length >= 3) break;
    const kind = placed.length % 3 === 1 ? ContainerKind.WEAPON_CRATE : ContainerKind.SECRET_STASH;
    const pos = findReachableContainerCell(world, rooms, reachable, spec.seed ^ (site.room.id * 811) ^ placed.length, site.room, occupied);
    if (!pos) continue;
    occupied.add(world.idx(pos.x, pos.y));
    const container = addProceduralLootContainer(
      world,
      spec,
      pos.room,
      { x: pos.x, y: pos.y },
      kind,
      wildMajorityRewardInventory(pos.room, kind, spec, placed.length),
      [WILD_MAJORITY_REWARD_TAG, WILD_MAJORITY_RISK_TAG, WILD_MAJORITY_AMBUSH_TAG, 'reward_dead_end', 'raid_stash', 'negotiate_or_fight'],
      placed.length % 3 === 1 ? `Оружейный схрон диких жильцов ${pos.room.id}` : `Закладка диких жильцов ${pos.room.id}`,
    );
    if (!container) continue;
    container.discovered = true;
    placed.push({ ...site, room: pos.room, containerId: container.id });
  }
  return placed;
}

function findWildAmbushCell(
  world: World,
  room: Room,
  reachable: Uint8Array,
  spawnX: number,
  spawnY: number,
  seed: number,
): { x: number; y: number } | null {
  const samples = Math.max(24, Math.min(96, (room.w - 2) * (room.h - 2)));
  for (let a = 0; a < samples; a++) {
    const x = world.wrap(room.x + 1 + ((seed + a * 7) % Math.max(1, room.w - 2)));
    const y = world.wrap(room.y + 1 + ((seed * 3 + a * 11) % Math.max(1, room.h - 2)));
    const ci = world.idx(x, y);
    if (!reachable[ci]) continue;
    if (world.roomMap[ci] !== room.id || world.cells[ci] !== Cell.FLOOR) continue;
    if (world.features[ci] !== Feature.NONE && world.features[ci] !== Feature.SHELF && world.features[ci] !== Feature.TABLE) continue;
    if (world.containersAt(x, y).length > 0) continue;
    if (world.dist2(spawnX, spawnY, x + 0.5, y + 0.5) < 36 * 36) continue;
    return { x, y };
  }
  return null;
}

function spawnWildMajorityAmbusher(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  spec: ProceduralFloorSpec,
  site: WildRewardSite,
  reachable: Uint8Array,
  spawnX: number,
  spawnY: number,
): boolean {
  if (!canSpawnEntityType(entities, EntityType.NPC)) return false;
  const pos = findWildAmbushCell(world, site.room, reachable, spawnX, spawnY, spec.seed ^ (site.room.id * 1597) ^ nextId.v)
    ?? (site.sourceRoom.id !== site.room.id ? findWildAmbushCell(world, site.sourceRoom, reachable, spawnX, spawnY, spec.seed ^ (site.sourceRoom.id * 1741) ^ nextId.v) : null);
  if (!pos) return false;
  const ci = world.idx(pos.x, pos.y);
  const zoneLevel = world.zones[world.zoneMap[ci]]?.level ?? spec.danger;
  const rpg = randomRPG(gaussianLevel(zoneLevel, 2));
  const maxHp = getMaxHp(rpg);
  const nm = randomName(Faction.WILD);
  const weapon = chance(0.35 + spec.danger * 0.05) ? 'knife' : 'pipe';
  entities.push({
    id: nextId.v++,
    type: EntityType.NPC,
    x: pos.x + 0.5,
    y: pos.y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: 1.2,
    sprite: chance(0.5) ? Occupation.ALCOHOLIC : Occupation.TRAVELER,
    name: `Сторож закладки ${nm.name}`,
    firstName: nm.firstName,
    lastName: nm.lastName,
    isFemale: nm.female,
    needs: freshNeeds(),
    hp: maxHp,
    maxHp,
    money: irng(2, 30 + spec.danger * 12),
    ai: { goal: AIGoal.IDLE, tx: site.markerX, ty: site.markerY, path: [], pi: 0, stuck: 0, timer: 0 },
    faction: Faction.WILD,
    occupation: Occupation.TRAVELER,
    playerRelation: -35,
    isTraveler: true,
    assignedRoomId: site.room.id,
    questId: -1,
    rpg,
    inventory: [
      { defId: weapon, count: 1 },
      { defId: chance(0.55) ? 'cigs' : 'grey_briquette', count: 1 },
      { defId: chance(0.45) ? 'filter_receipt' : 'water_coupon', count: 1 },
    ],
    weapon,
  });
  return true;
}

function spawnWildMajorityAmbushes(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  spec: ProceduralFloorSpec,
  sites: readonly WildRewardSite[],
  reachable: Uint8Array,
  spawnX: number,
  spawnY: number,
): void {
  if (spec.majorityId !== 'wild' || sites.length === 0) return;
  const target = Math.min(sites.length, Math.max(2, 1 + Math.floor(spec.danger / 2)));
  let spawned = 0;
  for (const site of sites) {
    if (spawned >= target) break;
    if (spawnWildMajorityAmbusher(world, entities, nextId, spec, site, reachable, spawnX, spawnY)) spawned++;
  }
}

function registerWildMajorityRewardCues(world: World, spec: ProceduralFloorSpec, sites: readonly WildRewardSite[]): void {
  if (spec.majorityId !== 'wild' || sites.length === 0) return;

  const siteContainerIds = new Set<number>();
  for (let i = 0; i < sites.length; i++) {
    if (sites[i].containerId !== undefined) {
      siteContainerIds.add(sites[i].containerId!);
    }
  }

  const containerMap = new Map<number, typeof world.containers[0]>();
  for (let i = 0; i < world.containers.length; i++) {
    const c = world.containers[i];
    if (siteContainerIds.has(c.id)) {
      containerMap.set(c.id, c);
      if (containerMap.size === siteContainerIds.size) break;
    }
  }

  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    const container = site.containerId !== undefined ? containerMap.get(site.containerId) : undefined;
    if (!container) continue;
    registerRouteCue(world, {
      id: `procedural_${spec.key}_wild_reward_${container.id}`,
      x: site.markerX + 0.5,
      y: site.markerY + 0.5,
      targetX: container.x + 0.5,
      targetY: container.y + 0.5,
      floor: spec.baseFloor,
      roomId: site.sourceRoom.id,
      targetRoomId: container.roomId,
      zoneId: container.zoneId,
      label: 'дикая закладка',
      hint: 'следы ведут в тупик с добычей и засадой',
      targetName: container.name,
      color: '#d99137',
      tags: ['procedural_floor', 'majority_wild', WILD_MAJORITY_REWARD_TAG, WILD_MAJORITY_RISK_TAG, WILD_MAJORITY_AMBUSH_TAG, 'reward_dead_end', 'raid_stash', spec.geometryId, spec.anomalyId],
      toneSeed: (spec.seed ^ container.id * 1667 ^ site.room.id * 919) >>> 0,
      radius: 13,
      targetRadius: 3,
      cooldownSec: 29,
      heardText: 'Под стеной свежие царапины и табачный пепел. Закладка рядом, но кто-то считает шаги.',
      followedText: 'Дикая закладка найдена. Теперь решай: забрать, торговаться, драться или отойти живым.',
      ignoredText: 'Следы к закладке растворились в бетоне. Тайник остался чужим.',
      routeGroup: {
        id: `wild_reward_${spec.key}_${container.id}`,
        lead: 'пепел и царапины ведут в тупик',
        risk: 'тайник сторожат дикие жильцы',
        decision: 'ограбить закладку, договориться, драться или уйти',
        reward: 'вода, фильтр, оружие или талон для дальнего маршрута',
        mapLabel: 'закладка',
        mapHint: 'рискованный тупиковый тайник',
        logLine: 'Дикая закладка не нужна для лифта, но дает ресурс за риск.',
      },
    });
  }
}

function hashUnit3(seed: number, a: number, b = 0): number {
  let n = (seed ^ Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0xc2b2ae35, 0x27d4eb2d)) >>> 0;
  n ^= n >>> 16;
  n = Math.imul(n, 0x7feb352d) >>> 0;
  n ^= n >>> 15;
  n = Math.imul(n, 0x846ca68b) >>> 0;
  n ^= n >>> 16;
  return n / 0xffffffff;
}

function cultMajorityCandidateRooms(world: World, rooms: Room[], spec: ProceduralFloorSpec, spawnX: number, spawnY: number): Room[] {
  return rooms
    .filter(room => (
      room.id !== 0 &&
      room.w >= 6 &&
      room.h >= 6 &&
      room.type !== RoomType.BATHROOM &&
      world.dist2(spawnX, spawnY, roomCenter(room).x, roomCenter(room).y) > 34 * 34
    ))
    .sort((a, b) => cultMajorityRoomScore(world, b, spec) - cultMajorityRoomScore(world, a, spec));
}

function cultMajorityRoomScore(world: World, room: Room, spec: ProceduralFloorSpec): number {
  let score = hashUnit3(spec.seed, room.id, room.type) * 100;
  if (room.type === RoomType.COMMON) score += 45;
  if (room.type === RoomType.STORAGE) score += 28;
  if (room.type === RoomType.CORRIDOR) score += 22;
  if (room.type === RoomType.LIVING || room.type === RoomType.OFFICE) score += 16;
  score += Math.min(36, (room.w * room.h) / 8);
  const center = roomCenter(room);
  const zone = world.zones[world.zoneMap[world.idx(center.x, center.y)]];
  if (zone?.faction === ZoneFaction.CULTIST) score += 18;
  return score;
}

function placeCultRoomFeature(world: World, room: Room, feature: Feature, x: number, y: number): boolean {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR || world.roomMap[ci] !== room.id) return false;
  if (world.features[ci] !== Feature.NONE || world.containerMap.has(ci)) return false;
  world.features[ci] = feature;
  return true;
}

function stampCultAltarNook(world: World, room: Room, spec: ProceduralFloorSpec): { x: number; y: number } {
  room.name = `Культовый алтарь ${room.id}`;
  
  // Find a good corner or wall cell for the altar
  let bestX = room.x + Math.floor(room.w / 2);
  let bestY = room.y + Math.floor(room.h / 2);
  
  let found = false;
  for (let dy = 1; dy < room.h - 1 && !found; dy++) {
    for (let dx = 1; dx < room.w - 1 && !found; dx++) {
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const ci = world.idx(x, y);
      if (world.roomMap[ci] === room.id && world.cells[ci] === Cell.FLOOR) {
        let walls = 0;
        if (world.cells[world.idx(x - 1, y)] === Cell.WALL) walls++;
        if (world.cells[world.idx(x + 1, y)] === Cell.WALL) walls++;
        if (world.cells[world.idx(x, y - 1)] === Cell.WALL) walls++;
        if (world.cells[world.idx(x, y + 1)] === Cell.WALL) walls++;
        
        if (walls >= 2) {
          bestX = x;
          bestY = y;
          found = true;
        }
      }
    }
  }

  // Place altar
  placeCultRoomFeature(world, room, Feature.APPARATUS, bestX, bestY);
  stampMark(world, bestX, bestY, 0.5, 0.5, 0.78, MarkType.BLACK_HAND, spec.seed ^ (room.id * 199), 132, 34, 168, 210, false);
  
  // Place a couple of candles nearby
  const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [dx, dy] of offsets) {
    const x = world.wrap(bestX + dx);
    const y = world.wrap(bestY + dy);
    if (world.cells[world.idx(x, y)] === Cell.FLOOR) {
      if (placeCultRoomFeature(world, room, Feature.CANDLE, x, y)) {
         world.floorTex[world.idx(x, y)] = spec.baseFloor === FloorLevel.HELL ? Tex.F_MEAT : Tex.F_CARPET;
      }
    }
  }

  const zone = world.zones[world.zoneMap[world.idx(bestX, bestY)]];
  if (zone) {
    zone.faction = ZoneFaction.CULTIST;
    zone.level = Math.max(zone.level, Math.min(5, spec.danger + 1));
  }
  
  return { x: bestX, y: bestY };
}

function addCultMajorityContainer(
  world: World,
  spec: ProceduralFloorSpec,
  room: Room,
  pos: { x: number; y: number },
  kind: ContainerKind,
  name: string,
  inventory: Item[],
  tags: readonly string[],
  access: WorldContainer['access'],
): void {
  if (world.containersAt(pos.x, pos.y).length > 0) return;
  world.addContainer({
    id: nextContainerId(world),
    x: pos.x,
    y: pos.y,
    floor: spec.baseFloor,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(pos.x, pos.y)],
    kind,
    name,
    inventory,
    capacitySlots: CONTAINER_DEFS[kind].capacitySlots,
    ownerName: 'Черная ладонь',
    faction: Faction.CULTIST,
    access,
    lockDifficulty: access === 'locked' || access === 'owner' ? Math.min(5, 2 + spec.danger) : undefined,
    discovered: access !== 'secret',
    tags: uniqueTags(['procedural_floor', 'cult', spec.majorityId, CULT_MAJORITY_RITUAL_TAG, ...tags]),
  });
}

function addCultEvidenceStash(world: World, spec: ProceduralFloorSpec, room: Room, seed: number): void {
  const pos = findFreeRoomCell(world, room, seed);
  if (!pos) return;
  addCultMajorityContainer(
    world,
    spec,
    room,
    pos,
    ContainerKind.SECRET_STASH,
    'Ниша с черновиками Черной ладони',
    [
      { defId: 'meat_rune', count: 1 },
      { defId: 'holy_water', count: 1 },
      { defId: 'blank_form', count: 1 },
    ],
    [CULT_MAJORITY_EVIDENCE_TAG, 'evidence', 'black_hand', 'forbidden_shortcut'],
    'secret',
  );
}

function applyCultFalseShelter(world: World, spec: ProceduralFloorSpec, room: Room, seed: number): void {
  room.name = `Ложное убежище Черной ладони ${room.id}`;
  room.floorTex = Tex.F_TILE;
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const ci = world.idx(x, y);
      if (world.roomMap[ci] !== room.id || world.cells[ci] !== Cell.FLOOR) continue;
      world.floorTex[ci] = Tex.F_TILE;
      world.fog[ci] = 0;
    }
  }
  placeRoomFeature(world, room, Feature.BED, Math.floor(room.w / 2), Math.floor(room.h / 2));
  placeRoomFeature(world, room, Feature.SCREEN, 1, 1);
  placeRoomFeature(world, room, Feature.CANDLE, room.w - 2, room.h - 2);
  const center = roomCenter(room);
  stampMark(world, center.x, center.y, 0.5, 0.5, 0.66, MarkType.BLACK_HAND, seed ^ 0x51e17e, 8, 7, 7, 220, false);
  const supply = findFreeRoomCell(world, room, seed ^ 0x5411);
  if (supply) addCultMajorityContainer(
    world,
    spec,
    room,
    supply,
    ContainerKind.EMERGENCY_BOX,
    'Плата за тихую койку',
    [
      { defId: 'water', count: 1 },
      { defId: 'bread', count: 1 },
      { defId: 'siren_instruction', count: 1 },
      { defId: 'meat_rune', count: 1 },
    ],
    [CULT_MAJORITY_FALSE_SHELTER_TAG, FALSE_SAFE_BLOCK_TAG, 'shelter', 'tribute'],
    'owner',
  );
}

function stampCultPhaseBoundary(
  world: World,
  spec: ProceduralFloorSpec,
  anchors: readonly { x: number; y: number }[],
): void {
  if (anchors.length < 2) return;
  let marks = 0;
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const b = anchors[(i + 1) % anchors.length];
    const dx = world.delta(a.x, b.x);
    const dy = world.delta(a.y, b.y);
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    for (let step = 0; step <= steps && marks < 180; step += 3) {
      const x = world.wrap(Math.round(a.x + dx * step / steps));
      const y = world.wrap(Math.round(a.y + dy * step / steps));
      const ci = world.idx(x, y);
      if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) continue;
      stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.24, 118, spec.seed + marks * 193, 66, 18, 38, false);
      world.factionControl[ci] = ZoneFaction.CULTIST;
      if ((marks & 3) === 0) world.floorTex[ci] = spec.baseFloor === FloorLevel.HELL ? Tex.F_MEAT : Tex.F_CARPET;
      marks++;
    }
  }
  for (let y = 4; y < W && marks < 180; y += 8) {
    for (let x = 4; x < W && marks < 180; x += 8) {
      const ci = world.idx(x, y);
      if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) continue;
      let best = Infinity;
      let second = Infinity;
      for (const anchor of anchors) {
        const d = world.dist2(x + 0.5, y + 0.5, anchor.x + 0.5, anchor.y + 0.5);
        if (d < best) {
          second = best;
          best = d;
        } else if (d < second) {
          second = d;
        }
      }
      if (best > 210 * 210 || Math.abs(Math.sqrt(second) - Math.sqrt(best)) > 18) continue;
      stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.28, 128, spec.seed + marks * 313, 66, 18, 38, false);
      world.factionControl[ci] = ZoneFaction.CULTIST;
      if ((marks & 3) === 0) world.floorTex[ci] = spec.baseFloor === FloorLevel.HELL ? Tex.F_MEAT : Tex.F_CARPET;
      marks++;
    }
  }
}

function registerCultTributeCue(
  world: World,
  spec: ProceduralFloorSpec,
  markerRoom: Room,
  targetRoom: Room,
  markerPos: { x: number; y: number },
  targetPos: { x: number; y: number },
): void {
  registerRouteCue(world, {
    id: `procedural_${spec.key}_cult_tribute_gate`,
    x: markerPos.x + 0.5,
    y: markerPos.y + 0.5,
    targetX: targetPos.x + 0.5,
    targetY: targetPos.y + 0.5,
    floor: spec.baseFloor,
    roomId: markerRoom.id,
    targetRoomId: targetRoom.id,
    zoneId: world.zoneMap[world.idx(markerPos.x, markerPos.y)],
    label: 'дань-ворота',
    hint: 'черная ладонь показывает необязательный короткий ход',
    targetName: 'запретный обход',
    color: '#d57aff',
    tags: ['procedural_floor', 'cult', CULT_MAJORITY_TRIBUTE_GATE_TAG, CULT_MAJORITY_PHASE_BOUNDARY_TAG, 'forbidden_shortcut'],
    toneSeed: (spec.seed ^ markerRoom.id * 733 ^ targetRoom.id * 1187) >>> 0,
    radius: 12,
    targetRadius: 4,
    cooldownSec: 34,
    heardText: 'На полу сложена ладонь из копоти. Она указывает на ход, где платят данью, а не жизнью.',
    followedText: 'Дань-ворота вывели к запретному обходу. Это не основной маршрут; лифты остаются доступны без платы.',
    ignoredText: 'Черная ладонь осталась на полу. Основной путь не требует дани.',
    routeGroup: {
      id: 'cult_tribute_gate',
      lead: 'культовая ладонь указывает на обход',
      risk: 'дань, кража или разоблачение злят культ',
      decision: 'заплатить, сорвать ритуал, спрятаться или уйти',
      reward: 'короткий ход, улика или безопасный отход',
      mapLabel: 'дань-ворота',
      mapHint: 'необязательный культовый обход',
      logLine: 'Дань-ворота не закрывают основной маршрут.',
    },
  });
}

function applyCultistMajorityProfile(
  world: World,
  rooms: Room[],
  spec: ProceduralFloorSpec,
  spawnX: number,
  spawnY: number,
  reachable: Uint8Array,
): void {
  if (spec.majorityId !== 'cultists') return;
  const candidates = cultMajorityCandidateRooms(world, rooms, spec, spawnX, spawnY);
  if (candidates.length === 0) return;
  const ritualCount = Math.min(1, candidates.length); // Only 1 subtle altar nook
  const ritualRooms = candidates.slice(0, ritualCount);
  const anchors = ritualRooms.map((room) => {
    const anchor = stampCultAltarNook(world, room, spec);
    addCultEvidenceStash(world, spec, room, spec.seed ^ room.id * 491);
    return anchor;
  });

  stampCultPhaseBoundary(world, spec, anchors);

  const falseShelterCount = Math.min(2, Math.max(1, Math.floor(spec.danger / 3)), Math.max(0, candidates.length - ritualRooms.length));
  for (let i = 0; i < falseShelterCount; i++) {
    const room = candidates[ritualRooms.length + i];
    if (room) applyCultFalseShelter(world, spec, room, spec.seed ^ (room.id * 997) ^ i);
  }

  const markerRoom = ritualRooms[0];
  const targetRoom = candidates.find(room => !ritualRooms.includes(room) && room.doors.length > 0) ?? ritualRooms[ritualRooms.length - 1];
  const marker = roomCell(world, markerRoom, Math.max(1, Math.floor(markerRoom.w / 2) - 1), Math.floor(markerRoom.h / 2));
  const target = roomCell(world, targetRoom, Math.floor(targetRoom.w / 2), Math.floor(targetRoom.h / 2));
  if (marker && target && reachable[world.idx(marker.x, marker.y)] && reachable[world.idx(target.x, target.y)]) {
    placeCultRoomFeature(world, markerRoom, Feature.CANDLE, marker.x, marker.y);
    stampMark(world, marker.x, marker.y, 0.5, 0.5, 0.46, MarkType.BLACK_HAND, spec.seed ^ 0x4718, 5, 4, 4, 220, false);
    addCultMajorityContainer(
      world,
      spec,
      markerRoom,
      marker,
      ContainerKind.CASHBOX,
      'Чаша дани у необязательного хода',
      [
        { defId: 'holy_water', count: 1 },
        { defId: 'psi_dust', count: 1 },
      ],
      [CULT_MAJORITY_TRIBUTE_GATE_TAG, 'tribute', 'optional_shortcut'],
      'owner',
    );
    registerCultTributeCue(world, spec, markerRoom, targetRoom, marker, target);
  }
}

function pressureCueProfile(floor: FloorLevel, spec: ProceduralFloorSpec): {
  label: string;
  hint: string;
  targetName: string;
  color: string;
  heardText: string;
  followedText: string;
  ignoredText: string;
} {
  if (spec.majorityId === 'cultists') {
    return {
      label: 'черная ладонь',
      hint: 'копоть ведет к культовой границе',
      targetName: 'ритуальная граница',
      color: '#d57aff',
      heardText: 'На полу проступает черная ладонь. Впереди ритуальная граница, но основной ход не закрыт.',
      followedText: 'Ладонь вывела к культовой границе. Можно платить, ломать ритуал, искать улику или отступить.',
      ignoredText: 'Черная ладонь осталась позади. Культовый обход не был обязательным.',
    };
  }
  if (spec.anomalyId === 'hladon') {
    return {
      label: 'холодный стык',
      hint: 'иней шуршит в сторону хищного кармана',
      targetName: 'холодный карман с тварями',
      color: '#9df',
      heardText: 'Вентиляция хрустит инеем. HUD ловит холодный ход, где лучше держать дистанцию.',
      followedText: 'Холодный след вывел к карману. Твари здесь слышны раньше, чем видны.',
      ignoredText: 'Иней остался за спиной. Холодный карман пока ждет без свидетелей.',
    };
  }
  if (spec.anomalyId === 'samosbor_seed') {
    return {
      label: 'сиренный налет',
      hint: 'сирена ведет к свежей мясной давке',
      targetName: 'самосборный карман',
      color: '#f79',
      heardText: 'В стене щелкает старая сирена. Маршрут к давке лучше считать заранее.',
      followedText: 'Сиренный след вывел к мясной давке. Здесь решает отход, а не лишний выстрел.',
      ignoredText: 'Сиренный след затих позади. Давка осталась на чужом маршруте.',
    };
  }
  if (spec.anomalyId === 'zombie_apocalypse') {
    return {
      label: 'очаг ноль',
      hint: 'толпа шумит вокруг первого мертвяка',
      targetName: 'очаг заражения',
      color: '#9f6',
      heardText: 'За стеной толпа говорит слишком ровно. Один голос уже не дышит.',
      followedText: 'Шум вывел к очагу. Здесь решение простое: изолировать, стрелять или уходить.',
      ignoredText: 'Толпа осталась за стеной. Очаг ноль получил еще минуту.',
    };
  }
  if (floor === FloorLevel.MINISTRY) {
    return {
      label: 'шорох папок',
      hint: 'бумаги ведут к живой канцелярии',
      targetName: 'опасная канцелярия',
      color: '#bdc7ff',
      heardText: 'За стеной шуршат папки. По звуку ясно: впереди не очередь, а охота на документы.',
      followedText: 'Шорох папок вывел к живой канцелярии. Укрытия здесь важнее прямой линии.',
      ignoredText: 'Папки шуршат дальше без вас. Бумажная угроза осталась в стороне.',
    };
  }
  if (floor === FloorLevel.MAINTENANCE) {
    return {
      label: 'трубный стук',
      hint: 'трубы считают мокрый обход',
      targetName: 'давящий трубный проход',
      color: '#8cf',
      heardText: 'Трубы простукивают обход. Впереди слышны вода, металл и короткая засада.',
      followedText: 'Трубный стук вывел к давящему проходу. Сухой угол здесь дороже патрона.',
      ignoredText: 'Трубный стук ушел в бетон. Засада осталась шуметь в стороне.',
    };
  }
  if (floor === FloorLevel.HELL) {
    return {
      label: 'мясной зов',
      hint: 'стены дышат в сторону плотного боя',
      targetName: 'мясной проход',
      color: '#f87',
      heardText: 'Стена дышит теплым ритмом. Впереди плотный бой, но не обязательный.',
      followedText: 'Мясной зов вывел к проходу. Отступление здесь нужно держать открытым.',
      ignoredText: 'Мясной зов стих за спиной. Проход остался кормить тишину.',
    };
  }
  if (floor === FloorLevel.VOID) {
    return {
      label: 'пустой тон',
      hint: 'тишина показывает опасную прямую',
      targetName: 'пустотная линия',
      color: '#8fdbbd',
      heardText: 'Тишина взяла ноту. HUD отмечает прямую, где лучше не стоять открыто.',
      followedText: 'Пустой тон вывел к линии огня. Стена нужна ближе, чем цель.',
      ignoredText: 'Пустой тон пропал. Опасная прямая осталась вне маршрута.',
    };
  }
  return {
    label: 'дворовый шорох',
    hint: 'стены ведут к шумной комнате',
    targetName: 'шумная комната',
    color: '#fc9',
    heardText: 'В стенах идет соседский шорох. Это не толпа, а место, где лучше выбрать угол.',
    followedText: 'Шорох вывел к шумной комнате. Решайте: обойти, зачистить или быстро забрать лут.',
    ignoredText: 'Соседский шорох остался позади. Комната подождет другой вылазки.',
  };
}

function choosePressureTargetRoom(world: World, rooms: Room[], spec: ProceduralFloorSpec, sx: number, sy: number): Room | null {
  const preferredTypes = isIndustrialGeometry(spec.geometryId)
    ? [RoomType.PRODUCTION, RoomType.STORAGE, RoomType.CORRIDOR, RoomType.COMMON]
    : spec.geometryId === 'admin_pockets' || spec.geometryId === 'archive_warrens'
      ? [RoomType.OFFICE, RoomType.STORAGE, RoomType.CORRIDOR, RoomType.COMMON]
      : [RoomType.COMMON, RoomType.STORAGE, RoomType.CORRIDOR, RoomType.LIVING];
  let best: Room | null = null;
  let bestScore = -Infinity;
  for (const room of rooms) {
    if (room.id === 0 || room.w < 4 || room.h < 4) continue;
    const c = roomCenter(room);
    const d2 = world.dist2(sx, sy, c.x, c.y);
    if (d2 < 42 * 42) continue;
    let score = Math.min(150 * 150, d2) / 900;
    const pref = preferredTypes.indexOf(room.type);
    if (pref >= 0) score += 80 - pref * 12;
    if (room.type === RoomType.CORRIDOR) score += routePressureLevel(spec) * 8;
    if (room.type === RoomType.PRODUCTION && proceduralMonsterFloor(spec) === FloorLevel.MAINTENANCE) score += 20;
    if (score > bestScore) {
      bestScore = score;
      best = room;
    }
  }
  return best;
}

function choosePressureMarkerRoom(world: World, rooms: Room[], target: Room, sx: number, sy: number): Room | null {
  let best: Room | null = null;
  let bestD2 = Infinity;
  const tc = roomCenter(target);
  for (const room of rooms) {
    if (room.id === target.id || room.w < 4 || room.h < 4) continue;
    const c = roomCenter(room);
    if (world.dist2(c.x, c.y, tc.x, tc.y) < 20 * 20) continue;
    const d2 = world.dist2(sx, sy, c.x, c.y);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = room;
    }
  }
  return best ?? rooms.find(room => room.id !== target.id) ?? null;
}

function registerProceduralMonsterPressureCue(world: World, rooms: Room[], spec: ProceduralFloorSpec, sx: number, sy: number): void {
  const pressure = routePressureLevel(spec);
  if (pressure <= 0) return;
  const target = choosePressureTargetRoom(world, rooms, spec, sx, sy);
  if (!target) return;
  const markerRoom = choosePressureMarkerRoom(world, rooms, target, sx, sy);
  if (!markerRoom) return;
  const marker = roomCell(world, markerRoom, Math.floor(markerRoom.w / 2), Math.floor(markerRoom.h / 2));
  const targetPos = roomCell(world, target, Math.floor(target.w / 2), Math.floor(target.h / 2));
  if (!marker || !targetPos) return;

  const markerCell = world.idx(marker.x, marker.y);
  if (world.features[markerCell] === Feature.NONE) world.features[markerCell] = Feature.SCREEN;
  stampSurfaceSplat(world, marker.x, marker.y, 0.5, 0.5, 0.34, 0.72, spec.seed ^ 0x5111, 84, 124, 116, true);
  const profile = pressureCueProfile(proceduralMonsterFloor(spec), spec);
  registerRouteCue(world, {
    id: `procedural_${spec.key}_monster_pressure`,
    x: marker.x + 0.5,
    y: marker.y + 0.5,
    targetX: targetPos.x + 0.5,
    targetY: targetPos.y + 0.5,
    floor: spec.baseFloor,
    roomId: markerRoom.id,
    targetRoomId: target.id,
    zoneId: world.zoneMap[markerCell],
    label: profile.label,
    hint: profile.hint,
    targetName: profile.targetName,
    color: profile.color,
    tags: ['procedural_floor', 'route_pressure', 'monster_pressure', spec.geometryId, spec.majorityId, spec.anomalyId],
    toneSeed: (spec.seed ^ (target.id * 1103) ^ (markerRoom.id * 67)) >>> 0,
    radius: 11,
    targetRadius: 3,
    cooldownSec: 30,
    heardText: profile.heardText,
    followedText: profile.followedText,
    ignoredText: profile.ignoredText,
  });
}

function cleanFalseSafeRoom(world: World, room: Room): void {
  room.floorTex = Tex.F_TILE;
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const ci = world.idx(x, y);
      if (world.roomMap[ci] !== room.id) continue;
      if (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER) {
        world.floorTex[ci] = Tex.F_TILE;
        world.fog[ci] = 0;
      }
    }
  }
}

function nextContainerId(world: World & { _nextContainerId?: number }): number {
  if (world._nextContainerId === undefined) {
    world._nextContainerId = world.containers.reduce((mx, c) => Math.max(mx, c.id), 0) + 1;
  }
  const id = world._nextContainerId;
  world._nextContainerId++;
  return id;
}

function addFalseSafeContainer(
  world: World,
  spec: ProceduralFloorSpec,
  room: Room,
  pos: { x: number; y: number },
  kind: ContainerKind,
  name: string,
  secret: boolean,
): void {
  world.addContainer({
    id: nextContainerId(world),
    x: pos.x,
    y: pos.y,
    floor: spec.baseFloor,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(pos.x, pos.y)],
    kind,
    name,
    inventory: secret
      ? [
        { defId: 'meat_rune', count: 1 },
        { defId: 'psi_dust', count: 1 },
        { defId: 'container_key_label', count: 1 },
      ]
      : [
        { defId: 'water', count: 1 },
        { defId: 'bread', count: 1 },
        { defId: 'bandage', count: 1 },
        { defId: 'siren_instruction', count: 1 },
      ],
    capacitySlots: secret ? 8 : 10,
    ownerName: secret ? undefined : 'Черная ладонь',
    faction: Faction.CULTIST,
    access: secret ? 'secret' : 'owner',
    lockDifficulty: secret ? undefined : 4,
    discovered: !secret,
    tags: [
      FALSE_SAFE_BLOCK_TAG,
      'cult',
      secret ? 'marker_evidence' : 'locked_supply',
      secret ? 'secret' : 'shelter',
      secret ? 'evidence' : 'audit',
    ],
  });
}

function findFreeRoomCell(world: World, room: Room, seed: number): { x: number; y: number } | null {
  for (let a = 0; a < 24; a++) {
    const x = world.wrap(room.x + 1 + ((seed + a * 5) % Math.max(1, room.w - 2)));
    const y = world.wrap(room.y + 1 + ((seed * 3 + a * 7) % Math.max(1, room.h - 2)));
    const ci = world.idx(x, y);
    if (world.cells[ci] === Cell.FLOOR && world.roomMap[ci] === room.id && world.features[ci] === Feature.NONE) return { x, y };
  }
  return null;
}

function spawnFalseSafeCaretaker(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  room: Room,
  spec: ProceduralFloorSpec,
): void {
  if (!canSpawnEntityType(entities, EntityType.NPC)) return;
  const pos = findFreeRoomCell(world, room, nextId.v + room.id * 17);
  if (!pos) return;
  const ci = world.idx(pos.x, pos.y);
  const zoneLevel = world.zones[world.zoneMap[ci]]?.level ?? spec.danger;
  const rpg = randomRPG(gaussianLevel(zoneLevel, 2));
  const maxHp = getMaxHp(rpg);
  const nm = randomName(Faction.CULTIST);
  const loadout = npcLoadout(Faction.CULTIST, spec.danger);
  entities.push({
    id: nextId.v++,
    type: EntityType.NPC,
    x: pos.x + 0.5,
    y: pos.y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: 1.05,
    sprite: Occupation.PILGRIM,
    name: nm.name,
    firstName: nm.firstName,
    lastName: nm.lastName,
    isFemale: nm.female,
    needs: freshNeeds(),
    hp: maxHp,
    maxHp,
    money: irng(10, 70 + spec.danger * 25),
    ai: { goal: AIGoal.IDLE, tx: pos.x, ty: pos.y, path: [], pi: 0, stuck: 0, timer: 0 },
    faction: Faction.CULTIST,
    occupation: Occupation.PILGRIM,
    isTraveler: true,
    questId: -1,
    rpg,
    inventory: loadout.inventory,
    weapon: loadout.weapon,
    tool: loadout.tool,
  });
}

function roomHasHermeticBoundary(world: World, room: Room): boolean {
  if (room.sealed) return true;
  for (const doorIdx of room.doors) {
    const state = world.doors.get(doorIdx)?.state;
    if (state === DoorState.HERMETIC_CLOSED || state === DoorState.HERMETIC_OPEN) return true;
  }
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const border = dx === -1 || dy === -1 || dx === room.w || dy === room.h;
      if (!border) continue;
      if (world.hermoWall[world.idx(room.x + dx, room.y + dy)]) return true;
    }
  }
  return false;
}

function roomHasExistingShelterIdentity(room: Room): boolean {
  const name = room.name.toLowerCase();
  return name.includes('укрыт') || name.includes('герм');
}

function chooseFalseSafeShelter(world: World, rooms: Room[]): Room | null {
  const candidates = rooms.filter(room => (
    room.w >= 7
    && room.h >= 6
    && room.type !== RoomType.CORRIDOR
    && room.type !== RoomType.BATHROOM
    && room.doors.length > 0
    && !roomHasExistingShelterIdentity(room)
    && !roomHasHermeticBoundary(world, room)
  ));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const ac = roomCenter(a);
    const bc = roomCenter(b);
    return world.dist2(W / 2, W / 2, ac.x, ac.y) - world.dist2(W / 2, W / 2, bc.x, bc.y);
  });
  return pick(candidates.slice(0, Math.min(18, candidates.length)));
}

function applyFalseSafeBlock(
  world: World,
  rooms: Room[],
  entities: Entity[],
  nextId: { v: number },
  spec: ProceduralFloorSpec,
  allowNpcs: boolean,
): void {
  if (spec.anomalyId !== 'false_safe_block') return;
  const shelter = chooseFalseSafeShelter(world, rooms);
  if (!shelter) return;
  const center = roomCenter(shelter);
  shelter.name = `${FALSE_SAFE_BLOCK_ROOM_PREFIX}: чистое укрытие без сирены`;
  cleanFalseSafeRoom(world, shelter);
  paintProceduralRoomTerritory(world, shelter, ZoneFaction.CULTIST);
  const shelterZoneId = world.zoneMap[world.idx(center.x, center.y)];
  const shelterZone = world.zones[shelterZoneId];
  if (shelterZone) {
    shelterZone.faction = ZoneFaction.CULTIST;
    shelterZone.level = Math.max(shelterZone.level, Math.min(5, spec.danger + 1));
    shelterZone.fogged = false;
  }

  const quietCorridors = rooms
    .filter(room => room.type === RoomType.CORRIDOR)
    .map(room => ({ room, d2: world.dist2(center.x, center.y, room.x + room.w / 2, room.y + room.h / 2) }))
    .sort((a, b) => a.d2 - b.d2)
    .slice(0, 3)
    .map(row => row.room);
  for (const room of quietCorridors) {
    room.name = `${FALSE_SAFE_BLOCK_ROOM_PREFIX}: тихий ход ${room.id}`;
    cleanFalseSafeRoom(world, room);
    paintProceduralRoomTerritory(world, room, ZoneFaction.CULTIST);
  }

  const screen = placeRoomFeatureFallback(world, shelter, Feature.SCREEN, 2, 1, spec.seed + 43);
  const marker = placeRoomFeatureFallback(world, shelter, Feature.APPARATUS, shelter.w - 3, Math.floor(shelter.h / 2), spec.seed + 44);
  placeRoomFeatureFallback(world, shelter, Feature.BED, Math.floor(shelter.w / 2), Math.floor(shelter.h / 2), spec.seed + 45);
  placeRoomFeatureFallback(world, shelter, Feature.LAMP, 1, shelter.h - 2, spec.seed + 46);
  placeRoomFeatureFallback(world, shelter, Feature.LAMP, shelter.w - 2, 1, spec.seed + 47);
  if (screen) stampSurfaceSplat(world, screen.x, screen.y, 0.5, 0.5, 0.2, 160, spec.seed + 4401, 6, 6, 6, true);
  if (marker) {
    stampSurfaceSplat(world, marker.x, marker.y, 0.5, 0.5, 0.52, 220, spec.seed + 4402, 4, 4, 3, true);
    stampSurfaceSplat(world, marker.x, marker.y, 0.5, 0.5, 0.28, 190, spec.seed + 4403, 80, 12, 48, false);
  }

  for (let i = 0; i < 7; i++) {
    const room = i < quietCorridors.length ? quietCorridors[i] : shelter;
    const pos = roomCell(world, room, 1 + ((i * 5) % Math.max(1, room.w - 2)), 1 + ((i * 7) % Math.max(1, room.h - 2)));
    if (!pos) continue;
    stampSurfaceSplat(world, pos.x, pos.y, 0.5, 0.5, 0.24 + (i % 3) * 0.04, 150, spec.seed + 4500 + i, 2, 2, 2, i % 2 === 0);
  }

  const supplyPos = findFreeRoomCell(world, shelter, spec.seed + 51);
  if (supplyPos) addFalseSafeContainer(
    world,
    spec,
    shelter,
    supplyPos,
    ContainerKind.EMERGENCY_BOX,
    'Опломбированный запас тихого блока',
    false,
  );
  const stashPos = findFreeRoomCell(world, shelter, spec.seed + 83);
  if (stashPos) addFalseSafeContainer(
    world,
    spec,
    shelter,
    stashPos,
    ContainerKind.SECRET_STASH,
    'Ниша черной ладони под чистым полом',
    true,
  );

  if (allowNpcs) {
    const caretakers = Math.min(4, 2 + Math.floor(spec.danger / 2));
    for (let i = 0; i < caretakers; i++) spawnFalseSafeCaretaker(world, entities, nextId, shelter, spec);
  }
}

function reachableCellsFrom(world: World, spawnX: number, spawnY: number): Uint8Array {
  const out = new Uint8Array(W * W);
  const queue = new Int32Array(W * W);
  let head = 0;
  let tail = 0;
  const start = world.idx(Math.floor(spawnX), Math.floor(spawnY));
  out[start] = 1;
  queue[tail++] = start;

  while (head < tail) {
    const ci = queue[head++];
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = world.idx(x + dx, y + dy);
      if (out[ni]) continue;
      if (!isConnectivityWalkable(world, ni)) continue;
      out[ni] = 1;
      queue[tail++] = ni;
    }
  }

  return out;
}

function containerCellValidForReachability(world: World, ci: number, reachable: Uint8Array): boolean {
  if (!reachable[ci]) return false;
  return world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER;
}

function findReachableContainerCell(
  world: World,
  rooms: Room[],
  reachable: Uint8Array,
  seed: number,
  preferredRoom?: Room,
  occupied?: Set<number>,
): { room: Room; x: number; y: number } | null {
  const roomPool = preferredRoom ? [preferredRoom, ...rooms.filter(room => room.id !== preferredRoom.id)] : rooms;
  for (const room of roomPool) {
    if (room.w < 3 || room.h < 3) continue;
    const samples = Math.max(18, Math.min(80, (room.w - 2) * (room.h - 2)));
    for (let a = 0; a < samples; a++) {
      const x = world.wrap(room.x + 1 + ((seed + a * 5) % Math.max(1, room.w - 2)));
      const y = world.wrap(room.y + 1 + ((seed * 3 + a * 7) % Math.max(1, room.h - 2)));
      const ci = world.idx(x, y);
      if (world.roomMap[ci] !== room.id || !containerCellValidForReachability(world, ci, reachable)) continue;
      if (occupied?.has(ci) || world.containersAt(x, y).length > 0) continue;
      return { room, x, y };
    }
  }
  return null;
}

function convertDropInventory(drop: Entity, kind: ContainerKind, spec: ProceduralFloorSpec): Item[] {
  const inv: Item[] = [];
  const valueCap = proceduralContainerValueCap(kind, spec);
  const capacitySlots = CONTAINER_DEFS[kind].capacitySlots;
  for (const item of drop.inventory ?? []) addCappedItem(inv, item, valueCap, capacitySlots);
  return inv;
}

function kindForConvertedDrop(drop: Entity, room: Room | undefined, spec: ProceduralFloorSpec): ContainerKind {
  const firstId = drop.inventory?.[0]?.defId;
  const tags = firstId ? itemTags(firstId) : [];
  if (tags.includes('medicine') || tags.includes('triage') || firstId === 'bandage' || firstId === 'antifungal_ointment') return ContainerKind.MEDICAL_CABINET;
  if (tags.includes('tool') || firstId === 'rock_salt' || firstId === 'valve_tag' || firstId === 'filter_receipt') return ContainerKind.TOOL_LOCKER;
  if (tags.includes('contaminant') || tags.includes('bait_risky') || spec.anomalyId === 'mushroom_mycelium') return ContainerKind.SECRET_STASH;
  if (room?.type === RoomType.KITCHEN) return ContainerKind.FRIDGE;
  return ContainerKind.EMERGENCY_BOX;
}

function containerizeLooseProceduralDrops(
  world: World,
  rooms: Room[],
  entities: Entity[],
  spec: ProceduralFloorSpec,
  reachable: Uint8Array,
): void {
  let write = 0;
  for (const entity of entities) {
    if (entity.type !== EntityType.ITEM_DROP || !entity.inventory || entity.inventory.length === 0) {
      entities[write++] = entity;
      continue;
    }
    const x = world.wrap(Math.floor(entity.x));
    const y = world.wrap(Math.floor(entity.y));
    const ci = world.idx(x, y);
    const room = world.roomMap[ci] >= 0 ? world.rooms[world.roomMap[ci]] : undefined;
    const kind = kindForConvertedDrop(entity, room, spec);
    const inventory = convertDropInventory(entity, kind, spec);
    const sameCellOk = room && containerCellValidForReachability(world, ci, reachable) && world.containersAt(x, y).length === 0;
    const target = sameCellOk
      ? { room, x, y }
      : findReachableContainerCell(world, rooms, reachable, entity.id * 37 + spec.seed, room);
    if (target && inventory.length > 0) {
      addProceduralLootContainer(world, spec, target.room, target, kind, inventory, ['converted_drop'], `${CONTAINER_DEFS[kind].name}: найденная закладка`);
      continue;
    }
    entities[write++] = entity;
  }
  entities.length = write;
}

function ensureContainersReachable(world: World, rooms: Room[], spec: ProceduralFloorSpec, reachable: Uint8Array): void {
  const occupied = new Set<number>();
  for (const container of world.containers) {
    const ci = world.idx(container.x, container.y);
    if (containerCellValidForReachability(world, ci, reachable) && !occupied.has(ci)) occupied.add(ci);
  }

  let changed = false;
  for (const container of world.containers) {
    const ci = world.idx(container.x, container.y);
    if (containerCellValidForReachability(world, ci, reachable) && occupied.has(ci)) continue;
    occupied.delete(ci);
    const room = world.rooms[container.roomId];
    const target = findReachableContainerCell(world, rooms, reachable, container.id * 53 + spec.seed, room, occupied);
    if (!target) continue;
    container.x = target.x;
    container.y = target.y;
    container.roomId = target.room.id;
    container.zoneId = world.zoneMap[world.idx(target.x, target.y)];
    occupied.add(world.idx(target.x, target.y));
    changed = true;
  }
  if (changed) world.rebuildContainerMap();
}

function resolveProceduralSpawn(world: World, spawnX: number, spawnY: number): { spawnX: number; spawnY: number } {
  const sx = Math.floor(spawnX);
  const sy = Math.floor(spawnY);
  const startCell = world.cells[world.idx(sx, sy)];
  if (startCell === Cell.FLOOR || startCell === Cell.WATER) return { spawnX, spawnY };

  for (let r = 1; r <= 48; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = sx + dx;
        const y = sy + dy;
        const cell = world.cells[world.idx(x, y)];
        if (cell === Cell.FLOOR || cell === Cell.WATER) return { spawnX: x + 0.5, spawnY: y + 0.5 };
      }
    }
  }

  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] !== Cell.FLOOR && world.cells[i] !== Cell.WATER) continue;
    return { spawnX: (i % W) + 0.5, spawnY: ((i / W) | 0) + 0.5 };
  }
  return { spawnX, spawnY };
}

const CONNECTIVITY_DIRS = [[1,0],[-1,0],[0,1],[0,-1]] as const;

function reachableFromSpawn(world: World, spawnX: number, spawnY: number): Uint8Array {
  const out = new Uint8Array(W * W);
  const start = world.idx(Math.floor(spawnX), Math.floor(spawnY));
  if (!isConnectivityWalkable(world, start)) return out;

  const queue = new Int32Array(W * W);
  let head = 0;
  let tail = 0;
  out[start] = 1;
  queue[tail++] = start;

  while (head < tail) {
    const ci = queue[head++];
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const [dx, dy] of CONNECTIVITY_DIRS) {
      const ni = world.idx(x + dx, y + dy);
      if (out[ni] || !isConnectivityWalkable(world, ni)) continue;
      out[ni] = 1;
      queue[tail++] = ni;
    }
  }

  return out;
}

function canForceProceduralFloor(world: World, ci: number): boolean {
  return world.cells[ci] !== Cell.LIFT &&
    world.hermoWall[ci] === 0 &&
    world.aptMask[ci] === 0 &&
    world.features[ci] !== Feature.LIFT_BUTTON &&
    !world.containerMap.has(ci);
}

function forceProceduralFloor(world: World, x: number, y: number, roomId: number, floorTex: Tex): boolean {
  const ci = world.idx(x, y);
  if (!canForceProceduralFloor(world, ci)) return false;
  world.cells[ci] = Cell.FLOOR;
  world.floorTex[ci] = floorTex;
  world.features[ci] = Feature.NONE;
  world.roomMap[ci] = roomId;
  world.removeDoorAt(ci);
  return true;
}

function roomHasWalkableCell(world: World, room: Room): boolean {
  let owned = false;
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[ci] !== room.id) continue;
      owned = true;
      if (isConnectivityWalkable(world, ci)) return true;
    }
  }
  return !owned;
}

function openRoomAnchor(world: World, room: Room): boolean {
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  if (world.roomMap[world.idx(cx, cy)] === room.id && forceProceduralFloor(world, cx, cy, room.id, room.floorTex)) return true;

  for (let r = 1; r <= Math.max(room.w, room.h); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = world.wrap(cx + dx);
        const y = world.wrap(cy + dy);
        const ci = world.idx(x, y);
        if (world.roomMap[ci] !== room.id) continue;
        if (forceProceduralFloor(world, x, y, room.id, room.floorTex)) return true;
      }
    }
  }
  return false;
}

function repairProceduralRoomAnchors(world: World): boolean {
  let changed = false;
  for (const room of world.rooms) {
    if (!room || room.sealed || room.w <= 0 || room.h <= 0) continue;
    if (roomHasWalkableCell(world, room)) continue;
    if (openRoomAnchor(world, room)) changed = true;
  }
  return changed;
}

function liftDirectionHasReachableAccess(world: World, reachable: Uint8Array, direction: LiftDirection): boolean {
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of CONNECTIVITY_DIRS) {
      if (reachable[world.idx(x + dx, y + dy)]) return true;
    }
  }
  return false;
}

function firstLiftCell(world: World, direction: LiftDirection): number {
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] === Cell.LIFT && world.liftDir[i] === direction) return i;
  }
  return -1;
}

function liftButtonCellUsable(world: World, ci: number, direction: LiftDirection): boolean {
  return world.features[ci] === Feature.NONE ||
    (world.features[ci] === Feature.LIFT_BUTTON && world.liftDir[ci] === direction);
}

function openLiftAccessCell(world: World, liftIdx: number, direction: LiftDirection): boolean {
  const x = liftIdx % W;
  const y = (liftIdx / W) | 0;
  for (const [dx, dy] of CONNECTIVITY_DIRS) {
    const ni = world.idx(x + dx, y + dy);
    if (!isConnectivityWalkable(world, ni) || !liftButtonCellUsable(world, ni, direction)) continue;
    world.features[ni] = Feature.LIFT_BUTTON;
    world.liftDir[ni] = direction;
    return true;
  }

  for (const [dx, dy] of CONNECTIVITY_DIRS) {
    const nx = world.wrap(x + dx);
    const ny = world.wrap(y + dy);
    const ni = world.idx(nx, ny);
    if (!liftButtonCellUsable(world, ni, direction)) continue;
    if (!forceProceduralFloor(world, nx, ny, -1, Tex.F_CONCRETE)) continue;
    world.features[ni] = Feature.LIFT_BUTTON;
    world.liftDir[ni] = direction;
    return true;
  }
  return false;
}

function placeFallbackLift(world: World, reachable: Uint8Array, direction: LiftDirection): boolean {
  for (let pass = 0; pass < 2; pass++) {
    for (let bi = 0; bi < reachable.length; bi++) {
      if (!reachable[bi] || !isConnectivityWalkable(world, bi)) continue;
      if (pass === 0 && world.roomMap[bi] >= 0) continue;
      if (world.features[bi] !== Feature.NONE) continue;
      const bx = bi % W;
      const by = (bi / W) | 0;
      for (const [dx, dy] of CONNECTIVITY_DIRS) {
        const li = world.idx(bx + dx, by + dy);
        if (world.cells[li] !== Cell.WALL || world.aptMask[li] || world.hermoWall[li] || world.doors.has(li)) continue;
        world.cells[li] = Cell.LIFT;
        world.wallTex[li] = Tex.LIFT_DOOR;
        world.roomMap[li] = -1;
        world.features[li] = Feature.NONE;
        world.liftDir[li] = direction;
        world.features[bi] = Feature.LIFT_BUTTON;
        world.liftDir[bi] = direction;
        return true;
      }
    }
  }
  return false;
}

function ensureProceduralConnectivity(world: World, spawnX: number, spawnY: number, spec: ProceduralFloorSpec): void {
  if (spec.anomalyId === 'wall_snake') {
    ensureWallSnakeConnectivity(world, spawnX, spawnY, spec.seed ^ 0x51c0ffee);
    return;
  }
  ensureConnectivity(world, spawnX, spawnY);
}

function ensureProceduralLiftAccess(world: World, spawnX: number, spawnY: number, spec: ProceduralFloorSpec): void {
  let reachable = reachableFromSpawn(world, spawnX, spawnY);
  for (const direction of [LiftDirection.UP, LiftDirection.DOWN] as const) {
    if (liftDirectionHasReachableAccess(world, reachable, direction)) continue;
    const liftIdx = firstLiftCell(world, direction);
    if (liftIdx >= 0) {
      openLiftAccessCell(world, liftIdx, direction);
    } else {
      placeFallbackLift(world, reachable, direction);
    }
    ensureProceduralConnectivity(world, spawnX, spawnY, spec);
    reachable = reachableFromSpawn(world, spawnX, spawnY);
  }
}

function repairFinalProceduralConnectivity(world: World, spawnX: number, spawnY: number, spec: ProceduralFloorSpec): { spawnX: number; spawnY: number } {
  let spawn = resolveProceduralSpawn(world, spawnX, spawnY);
  sanitizeDoors(world);
  repairProceduralRoomAnchors(world);
  ensureProceduralConnectivity(world, spawn.spawnX, spawn.spawnY, spec);
  ensureProceduralLiftAccess(world, spawn.spawnX, spawn.spawnY, spec);
  ensureProceduralConnectivity(world, spawn.spawnX, spawn.spawnY, spec);
  sanitizeDoors(world);
  ensureProceduralConnectivity(world, spawn.spawnX, spawn.spawnY, spec);
  spawn = resolveProceduralSpawn(world, spawn.spawnX, spawn.spawnY);
  return spawn;
}

function collectorMetricWalkable(world: World, idx: number, allowWater: boolean): boolean {
  const cell = world.cells[idx];
  return cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.LIFT || (allowWater && cell === Cell.WATER);
}

function collectorDistanceField(world: World, spawnX: number, spawnY: number, allowWater: boolean): Int32Array {
  const distance = new Int32Array(W * W);
  distance.fill(-1);
  const start = world.idx(Math.floor(spawnX), Math.floor(spawnY));
  if (!collectorMetricWalkable(world, start, allowWater)) return distance;

  const queue = new Int32Array(W * W);
  let head = 0;
  let tail = 0;
  distance[start] = 0;
  queue[tail++] = start;
  while (head < tail) {
    const ci = queue[head++];
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const [dx, dy] of CONNECTIVITY_DIRS) {
      const ni = world.idx(x + dx, y + dy);
      if (distance[ni] >= 0 || !collectorMetricWalkable(world, ni, allowWater)) continue;
      distance[ni] = distance[ci] + 1;
      queue[tail++] = ni;
    }
  }
  return distance;
}

function collectorRoomAnchorIdx(world: World, room: Room): number {
  const center = world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2));
  if (world.roomMap[center] === room.id && collectorMetricWalkable(world, center, true)) return center;
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[ci] === room.id && collectorMetricWalkable(world, ci, true)) return ci;
    }
  }
  return center;
}

function collectorMetricTargetIdx(world: World, spawnX: number, spawnY: number, wetDistance: Int32Array): number {
  let best = -1;
  let bestD = -1;
  for (const room of world.rooms) {
    if (!room || !room.name.startsWith(COLLECTOR_VALVE_ROOM_PREFIX)) continue;
    const ci = collectorRoomAnchorIdx(world, room);
    if (wetDistance[ci] < 0) continue;
    const d2 = world.dist2(spawnX, spawnY, (ci % W) + 0.5, ((ci / W) | 0) + 0.5);
    if (d2 > bestD) {
      bestD = d2;
      best = ci;
    }
  }
  if (best >= 0) return best;

  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || wetDistance[i] < 0) continue;
    const d2 = world.dist2(spawnX, spawnY, (i % W) + 0.5, ((i / W) | 0) + 0.5);
    if (d2 > bestD) {
      bestD = d2;
      best = i;
    }
  }
  return best;
}

function collectorLiftAccessCounts(world: World, dryDistance: Int32Array): {
  up: number;
  down: number;
  waterAdjacent: number;
} {
  let up = 0;
  let down = 0;
  let waterAdjacent = 0;
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT) continue;
    const x = i % W;
    const y = (i / W) | 0;
    let dry = dryDistance[i] >= 0;
    let water = false;
    for (const [dx, dy] of CONNECTIVITY_DIRS) {
      const ni = world.idx(x + dx, y + dy);
      if (dryDistance[ni] >= 0) dry = true;
      if (world.cells[ni] === Cell.WATER) water = true;
    }
    if (water) waterAdjacent++;
    if (!dry) continue;
    if (world.liftDir[i] === LiftDirection.UP) up++;
    else if (world.liftDir[i] === LiftDirection.DOWN) down++;
  }
  return { up, down, waterAdjacent };
}

function collectorFallbackDryCausewayCells(world: World): number {
  let count = 0;
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.FLOOR || world.floorTex[i] !== Tex.F_CONCRETE || world.roomMap[i] >= 0) continue;
    const x = i % W;
    const y = (i / W) | 0;
    if (
      world.cells[world.idx(x + 1, y)] === Cell.WATER ||
      world.cells[world.idx(x - 1, y)] === Cell.WATER ||
      world.cells[world.idx(x, y + 1)] === Cell.WATER ||
      world.cells[world.idx(x, y - 1)] === Cell.WATER
    ) count++;
  }
  return count;
}

function collectorLiftAccessIdx(world: World, liftIdx: number): number {
  const x = liftIdx % W;
  const y = (liftIdx / W) | 0;
  for (const [dx, dy] of CONNECTIVITY_DIRS) {
    const ni = world.idx(x + dx, y + dy);
    if (collectorMetricWalkable(world, ni, true)) return ni;
  }
  for (const [dx, dy] of CONNECTIVITY_DIRS) {
    const ni = world.idx(x + dx, y + dy);
    if (!canForceProceduralFloor(world, ni)) continue;
    forceProceduralFloor(world, x + dx, y + dy, -1, Tex.F_CONCRETE);
    return ni;
  }
  return -1;
}

function ensureCollectorDryLiftAccess(world: World, spec: ProceduralFloorSpec, spawnX: number, spawnY: number): void {
  if (spec.geometryId !== 'collectors') return;
  const draft = collectorDraftMetricsByWorld.get(world) ?? newCollectorMetricsDraft();
  let dryDistance = collectorDistanceField(world, spawnX, spawnY, false);
  let counts = collectorLiftAccessCounts(world, dryDistance);
  for (const direction of [LiftDirection.UP, LiftDirection.DOWN] as const) {
    if ((direction === LiftDirection.UP ? counts.up : counts.down) > 0) continue;
    const liftIdx = firstLiftCell(world, direction);
    if (liftIdx < 0) continue;
    const access = collectorLiftAccessIdx(world, liftIdx);
    if (access < 0) continue;
    const target = { x: access % W, y: (access / W) | 0 };
    draft.dryRouteLength += carveCollectorPath(
      world,
      spec,
      [{ x: Math.floor(spawnX), y: Math.floor(spawnY) }, target],
      2,
      false,
      draft,
    );
    dryDistance = collectorDistanceField(world, spawnX, spawnY, false);
    counts = collectorLiftAccessCounts(world, dryDistance);
  }
  collectorDraftMetricsByWorld.set(world, draft);
}

function measureCollectorDecisionMetricsFromWorld(world: World, spawnX: number, spawnY: number): CollectorDecisionMetrics {
  const draft = collectorDraftMetricsByWorld.get(world);
  const wetDistance = collectorDistanceField(world, spawnX, spawnY, true);
  const dryDistance = collectorDistanceField(world, spawnX, spawnY, false);
  const target = collectorMetricTargetIdx(world, spawnX, spawnY, wetDistance);
  const liftCounts = collectorLiftAccessCounts(world, dryDistance);
  let wetCells = 0;
  for (const cell of world.cells) if (cell === Cell.WATER) wetCells++;
  const valveRoomCount = world.rooms.filter(room => room?.name.startsWith(COLLECTOR_VALVE_ROOM_PREFIX)).length;

  return {
    wetBasinCells: wetCells,
    dryCausewayCells: draft?.dryCausewayCells.size ?? collectorFallbackDryCausewayCells(world),
    repairCrossingCells: draft?.repairCrossingCells.size ?? 0,
    valveRoomCount,
    wetRouteLength: draft?.wetRouteLength ?? (target >= 0 ? wetDistance[target] : -1),
    dryRouteLength: draft?.dryRouteLength ?? (target >= 0 ? dryDistance[target] : -1),
    actualWetPathLength: target >= 0 ? wetDistance[target] : -1,
    actualDryPathLength: target >= 0 ? dryDistance[target] : -1,
    dryReachableUpLifts: liftCounts.up,
    dryReachableDownLifts: liftCounts.down,
    waterAdjacentLiftCount: liftCounts.waterAdjacent,
  };
}

export function measureCollectorDecisionMetrics(generation: FloorGeneration): CollectorDecisionMetrics {
  return collectorDecisionMetricsByWorld.get(generation.world) ??
    measureCollectorDecisionMetricsFromWorld(generation.world, generation.spawnX, generation.spawnY);
}

function recordProceduralGeometryMetrics(world: World, spec: ProceduralFloorSpec, spawnX: number, spawnY: number): void {
  if (spec.geometryId === 'collectors') {
    collectorDecisionMetricsByWorld.set(world, measureCollectorDecisionMetricsFromWorld(world, spawnX, spawnY));
    return;
  }
  if (spec.geometryId !== 'archive_warrens') return;
  const intent = archiveWarrenIntents.get(world);
  const metrics = measureAndRecordGeometryMetrics(world, {
    id: spec.geometryId,
    spawn: { x: spawnX, y: spawnY },
    anchors: intent?.landmarkAnchors,
    coarseSize: 64,
    densityBucketSize: 32,
    losSampleCount: 16,
    losMaxDistance: 48,
  });
  if (!intent) return;
  metrics.landmarkCount = intent.landmarkAnchors.length;
  metrics.pathEntropy = intent.graph.pathEntropy;
  metrics.loopCount = intent.graph.loopCount;
  metrics.nodeCount = intent.graph.nodes.length;
  metrics.edgeCount = intent.graph.edges.length;
}

export function generateProceduralFloor(spec: ProceduralFloorSpec): FloorGeneration {
  return withSeededRandom(spec.seed, () => {
    const world = new World();
    const entities: Entity[] = [];
    const nextId = { v: 1 };
    const allowNpcs = floorRunZAllowsNpcs(spec.z);
    const { rooms, spawnX, spawnY } = buildRooms(world, spec);

    applyAtticWeatherworks(world, rooms, spec, spawnX, spawnY);
    applyArchiveWarrens(world, rooms, spec, entities, nextId);
    applyCommunalKnots(world, rooms, spec, spawnX, spawnY);
    applyAdminPockets(world, rooms, spec, spawnX, spawnY);
    applyWorkshops(world, rooms, spec, spawnX, spawnY);
    applyServiceSpines(world, rooms, spec, spawnX, spawnY);
    applySumpCauseways(world, rooms, spec, spawnX, spawnY);
    applyCitizenMajorityPublicLayer(world, rooms, spec);
    applyScientistMajority(world, rooms, spec, spawnX, spawnY);
    const wildLayout = applyWildMajorityGeometry(world, rooms, spec, spawnX, spawnY);
    placeProceduralMiniHqClusters(world, rooms, spec, spawnX, spawnY);
    applyVoidFillers(world, rooms);
    generateZones(world);
    applyZones(world, spec);
    applyWaterAndMachines(world, rooms, spec, spawnX, spawnY);
    placeLifts(world, 8, LiftDirection.UP);
    placeLifts(world, 8, LiftDirection.DOWN);
    ensureSumpLiftDryAccess(world, spec, spawnX, spawnY);
    ensureCollectorDryLiftAccess(world, spec, spawnX, spawnY);
    applyRailTrains(world, rooms, entities, nextId, spec, spawnX, spawnY);
    applyApartmentPressure(world, rooms, spec, spawnX, spawnY);
    applyCollectorZombieResidentialInfill(world, rooms, spec, spawnX, spawnY);
    const placement = buildWalkablePlacementMap(world, spawnX, spawnY);
    const liquidatorControl = applyLiquidatorMajorityProfile(world, rooms, spec, placement.reachable, placement.candidates, spawnX, spawnY);
    registerProceduralAnomalyPlacement(world, placement);

    placeProceduralEmergencyPanels(world, rooms, spec, placement.reachable);
    placeAtticWeatherworksLandmarks(world, rooms, spec, spawnX, spawnY, placement.reachable);
    placeAdminPocketLandmarks(world, rooms, spec, placement.reachable);
    placeCollectorValveLandmarks(world, rooms, spec, placement.reachable);
    placeCommunalKnotLandmarks(world, rooms, spec, placement.reachable);
    placeCitizenMajorityLandmarks(world, rooms, spec, placement.reachable);
    placeWorkshopDecisionTriangle(world, rooms, spec, placement.reachable, spawnX, spawnY);
    placeScientistMajorityLandmarks(world, rooms, spec, placement.reachable);
    applyCultistMajorityProfile(world, rooms, spec, spawnX, spawnY, placement.reachable);
    const wildRewardSites = placeWildMajorityRewards(world, rooms, spec, wildLayout, placement.reachable, spawnX, spawnY);
    spawnLoot(world, rooms, spec, spawnX, spawnY, placement.reachable);
    addSumpIslandStashes(world, rooms, spec, placement.reachable);
    addDeepEngineerStash(world, rooms, spec, placement.reachable);
    addDeepReconStash(world, rooms, spec, placement.reachable);
    addDeepLiquidatorRewardStash(world, rooms, spec, placement.reachable);
    applyProceduralFloorObjectProfile(world, rooms, spec, placement.reachable);
    initializeProceduralTerritory(world, spec);
    if (allowNpcs) {
      spawnWildMajorityAmbushes(world, entities, nextId, spec, wildRewardSites, placement.reachable, spawnX, spawnY);
      spawnNpcs(world, rooms, entities, nextId, spec);
      spawnLiquidatorCheckpointGuards(world, entities, nextId, spec, liquidatorControl);
    }
    spawnMonsters(world, entities, nextId, spec, spawnX, spawnY);

    applySmog(world, rooms, entities, nextId, spec, allowNpcs);
    applySamosborSeed(world, rooms, spec, spawnX, spawnY);
    applyMushrooms(world, rooms, entities, nextId, spec, placement.reachable, spawnX, spawnY);
    applyCarnivorousFungusRooms(world, rooms, entities, nextId, spec, placement.reachable);
    applyHladon(world, rooms, entities, nextId, spec, spawnX, spawnY);
    applyTeleports(world, spec, placement);
    applyFalseSafeBlock(world, rooms, entities, nextId, spec, allowNpcs);
    applyProceduralAnomalyProfile({ world, rooms, entities, nextId, spec, spawnX, spawnY, placement });
    const spawn = repairFinalProceduralConnectivity(world, spawnX, spawnY, spec);
    ensureZombieApocalypseQuarantineDoor(world, rooms, spec);
    ensureSumpRepairDryAccess(world, rooms, spec, spawn.spawnX, spawn.spawnY);
    ensureSumpLiftDryAccess(world, spec, spawn.spawnX, spawn.spawnY);
    ensureCollectorDryLiftAccess(world, spec, spawn.spawnX, spawn.spawnY);
    const reachable = reachableCellsFrom(world, spawn.spawnX, spawn.spawnY);
    ensureContainersReachable(world, rooms, spec, reachable);
    containerizeLooseProceduralDrops(world, rooms, entities, spec, reachable);
    registerWildMajorityRewardCues(world, spec, wildRewardSites);
    registerProceduralMonsterPressureCue(world, rooms, spec, spawn.spawnX, spawn.spawnY);
    if (!allowNpcs) removeNpcEntities(entities);
    recordProceduralGeometryMetrics(world, spec, spawn.spawnX, spawn.spawnY);
    syncZoneMetadataFromTerritory(world);
    rebuildGeneratedFloorPathBlockers(world, spec.seed, spawn.spawnX, spawn.spawnY);
    fillVisualSlotsForWorldFeatures(world, spec.seed);
    world.initializeLampBlinks(spec.seed);

    world.bakeLights();
    relightBadAppleWorld(world);
    return { world, entities, spawnX: spawn.spawnX, spawnY: spawn.spawnY };
  });
}
