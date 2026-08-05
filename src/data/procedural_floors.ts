/* ── Procedural floor combinatorics definitions ──────────────── */

import {
  ContainerKind,
  Faction,
  FloorLevel,
  MonsterKind,
  RoomType,
  Tex,
  ZoneFaction,
} from '../core/types';
import { hashSeed, seededRandom } from '../core/rand';
import { designFloorAtZ } from './design_floors';
import {
  ECONOMY_PROCEDURAL_LOOT_VALUE_CAP_BY_DANGER,
  proceduralLootValueCap as economyProceduralLootValueCap,
} from './economics';
import type { ProceduralRecipeId } from '../gen/procedural_geometry_recipes';

export type FloorGeometryId =
  | 'living_blocks'
  | 'apartment_pressure'
  | 'communal_knots'
  | 'attic_weatherworks'
  | 'archive_warrens'
  | 'collectors'
  | 'workshops'
  | 'sump_causeways'
  | 'admin_pockets'
  | 'service_spines';

export type FloorMajorityId =
  | 'citizens'
  | 'liquidators'
  | 'cultists'
  | 'wild'
  | 'scientists';

export type FloorAnomalyId =
  | 'none'
  | 'teleport_cells'
  | 'smog'
  | 'samosbor_seed'
  | 'mushroom_mycelium'
  | 'hladon'
  | 'false_safe_block'
  | 'fractal_floor'
  | 'mirror_run'
  | 'radio_chess'
  | 'cement_memory'
  | 'conveyor_sorter'
  | 'wall_snake'
  | 'living_tunnels'
  | 'section_shift'
  | 'conway_life'
  | 'rail_trains'
  | 'bad_apple_world'
  | 'zombie_apocalypse'
  | 'sandpile_perekrytie';

export const FALSE_SAFE_BLOCK_TAG = 'false_safe_block';
export const FALSE_SAFE_BLOCK_ROOM_PREFIX = 'Тихий блок';
export const FALSE_SAFE_BLOCK_DISCOVERED = 'ладонь найдена';
export const FALSE_SAFE_BLOCK_RESOLVED = 'маркер сорван';

export interface FloorGeometryDef {
  id: FloorGeometryId;
  title: string;
  baseFloor: FloorLevel;
  weight: number;
  roomCount: number;
  dangerBias: number;
  minZ?: number;
  maxZ?: number;
  wallTex: Tex;
  floorTex: Tex;
  roomTypes: readonly RoomType[];
  tags: readonly string[];
  recipePool: readonly ProceduralRecipeId[];
}

export interface FloorMajorityDef {
  id: FloorMajorityId;
  title: string;
  weight: number;
  npcFaction: Faction;
  zoneFaction: ZoneFaction;
  minDanger?: number;
  tags: readonly string[];
}

export interface FloorAnomalyDef {
  id: FloorAnomalyId;
  title: string;
  weight: number;
  minDanger: number;
  dangerBias: number;
  tags: readonly string[];
}

export interface ProceduralFloorSpec {
  key: string;
  z: number;
  ordinal: number;
  seed: number;
  depth: number;
  danger: 1 | 2 | 3 | 4 | 5;
  geometryId: FloorGeometryId;
  baseFloor: FloorLevel;
  majorityId: FloorMajorityId;
  anomalyId: FloorAnomalyId;
  title: string;
  lootBiasIds: string[];
  monsterBiasKinds: MonsterKind[];
  monsterBiasTags: string[];
}

export const PROCEDURAL_LOOT_VALUE_CAP_BY_DANGER: Readonly<Record<1 | 2 | 3 | 4 | 5, number>> = {
  ...ECONOMY_PROCEDURAL_LOOT_VALUE_CAP_BY_DANGER,
};

export const PROCEDURAL_LOOT_FACTION_TAGS: Readonly<Record<FloorMajorityId, readonly string[]>> = {
  citizens: ['civil_stock'],
  liquidators: ['liquidator_stock', 'audit_risk'],
  cultists: ['cult_cache', 'theft_risk'],
  wild: ['wild_cache', 'theft_risk'],
  scientists: ['nii_cache', 'sample_audit'],
};

export const PROCEDURAL_LOOT_ANOMALY_TAGS: Readonly<Record<FloorAnomalyId, readonly string[]>> = {
  none: [],
  teleport_cells: ['topology', 'access_cache'],
  smog: ['smog', 'contaminated'],
  samosbor_seed: ['samosbor', 'contaminated'],
  mushroom_mycelium: ['mushroom', 'contaminated'],
  hladon: ['hladon', 'cold_cache'],
  false_safe_block: [FALSE_SAFE_BLOCK_TAG, 'audit_risk'],
  fractal_floor: ['fractal', 'document_cache'],
  mirror_run: ['mirror', 'audit_risk'],
  radio_chess: ['radio', 'timing_cache'],
  cement_memory: ['cement_memory', 'route_pressure'],
  conveyor_sorter: ['conveyor', 'industrial_cache'],
  wall_snake: ['moving_walls', 'crush_risk'],
  living_tunnels: ['living_tunnels', 'topology', 'repair_cache'],
  section_shift: ['section_shift', 'topology'],
  conway_life: ['conway_life', 'cellular'],
  rail_trains: ['rail', 'transit_cache'],
  bad_apple_world: ['bad_apple_world', 'media_cache'],
  zombie_apocalypse: ['zombie', 'quarantine', 'contaminated'],
  sandpile_perekrytie: ['crush_risk', 'repair_cache', 'industrial_cache'],
};

export const PROCEDURAL_LOOT_FACTION_KIND_BIAS: Readonly<Record<FloorMajorityId, readonly ContainerKind[]>> = {
  citizens: [ContainerKind.WOODEN_CHEST, ContainerKind.FRIDGE, ContainerKind.EMERGENCY_BOX, ContainerKind.CASHBOX],
  liquidators: [ContainerKind.WEAPON_CRATE, ContainerKind.METAL_CABINET, ContainerKind.TOOL_LOCKER, ContainerKind.EMERGENCY_BOX],
  cultists: [ContainerKind.SECRET_STASH, ContainerKind.SAFE, ContainerKind.CASHBOX, ContainerKind.WEAPON_CRATE],
  wild: [ContainerKind.SECRET_STASH, ContainerKind.TRASH_BIN, ContainerKind.WOODEN_CHEST, ContainerKind.WEAPON_CRATE],
  scientists: [ContainerKind.FILING_CABINET, ContainerKind.SAFE, ContainerKind.MEDICAL_CABINET, ContainerKind.METAL_CABINET],
};

export const PROCEDURAL_LOOT_ANOMALY_KIND_BIAS: Readonly<Record<FloorAnomalyId, readonly ContainerKind[]>> = {
  none: [],
  teleport_cells: [ContainerKind.SECRET_STASH, ContainerKind.FILING_CABINET],
  smog: [ContainerKind.TOOL_LOCKER, ContainerKind.METAL_CABINET, ContainerKind.SECRET_STASH],
  samosbor_seed: [ContainerKind.EMERGENCY_BOX, ContainerKind.SECRET_STASH, ContainerKind.MEDICAL_CABINET],
  mushroom_mycelium: [ContainerKind.FRIDGE, ContainerKind.TRASH_BIN, ContainerKind.SECRET_STASH],
  hladon: [ContainerKind.EMERGENCY_BOX, ContainerKind.TOOL_LOCKER, ContainerKind.MEDICAL_CABINET],
  false_safe_block: [ContainerKind.EMERGENCY_BOX, ContainerKind.SECRET_STASH, ContainerKind.SAFE],
  fractal_floor: [ContainerKind.FILING_CABINET, ContainerKind.SAFE, ContainerKind.SECRET_STASH],
  mirror_run: [ContainerKind.SECRET_STASH, ContainerKind.SAFE, ContainerKind.FILING_CABINET],
  radio_chess: [ContainerKind.FILING_CABINET, ContainerKind.METAL_CABINET, ContainerKind.TOOL_LOCKER],
  cement_memory: [ContainerKind.FILING_CABINET, ContainerKind.EMERGENCY_BOX, ContainerKind.SECRET_STASH],
  conveyor_sorter: [ContainerKind.METAL_CABINET, ContainerKind.TOOL_LOCKER, ContainerKind.WEAPON_CRATE],
  wall_snake: [ContainerKind.SECRET_STASH, ContainerKind.METAL_CABINET, ContainerKind.EMERGENCY_BOX],
  living_tunnels: [ContainerKind.TOOL_LOCKER, ContainerKind.METAL_CABINET, ContainerKind.SECRET_STASH],
  section_shift: [ContainerKind.SECRET_STASH, ContainerKind.TOOL_LOCKER, ContainerKind.FILING_CABINET],
  conway_life: [ContainerKind.METAL_CABINET, ContainerKind.FILING_CABINET, ContainerKind.SECRET_STASH],
  rail_trains: [ContainerKind.TOOL_LOCKER, ContainerKind.METAL_CABINET, ContainerKind.EMERGENCY_BOX],
  bad_apple_world: [ContainerKind.FILING_CABINET, ContainerKind.SECRET_STASH, ContainerKind.METAL_CABINET],
  zombie_apocalypse: [ContainerKind.MEDICAL_CABINET, ContainerKind.EMERGENCY_BOX, ContainerKind.SECRET_STASH],
  sandpile_perekrytie: [ContainerKind.TOOL_LOCKER, ContainerKind.METAL_CABINET, ContainerKind.EMERGENCY_BOX],
};

export function proceduralLootValueCap(danger: 1 | 2 | 3 | 4 | 5, routeZ?: number): number {
  return economyProceduralLootValueCap(danger, routeZ);
}

export const FLOOR_RUN_MIN_Z = -50;
export const FLOOR_RUN_MAX_Z = 50;
export const FLOOR_RUN_VOID_Z = -50;
export const FLOOR_RUN_NPC_FREE_Z = -48;

const STORY_Z_BY_FLOOR: Readonly<Record<FloorLevel, number>> = {
  [FloorLevel.MINISTRY]: 30,
  [FloorLevel.KVARTIRY]: 14,
  [FloorLevel.LIVING]: 0,
  [FloorLevel.MAINTENANCE]: -26,
  [FloorLevel.HELL]: -36,
  [FloorLevel.VOID]: FLOOR_RUN_VOID_Z,
};

const STORY_FLOOR_BY_Z = new Map<number, FloorLevel>(
  (Object.values(FloorLevel).filter(v => typeof v === 'number') as FloorLevel[])
    .map(floor => [STORY_Z_BY_FLOOR[floor], floor])
);

export function floorRunProfileZ(z: number): number {
  return Math.round(z >= 0 ? z * -44 / 50 : z * -40 / 50);
}

function makeProceduralFloorZs(): readonly number[] {
  const zs: number[] = [];
  for (let z = FLOOR_RUN_MIN_Z; z <= FLOOR_RUN_MAX_Z; z++) {
    if (storyFloorAtZ(z) === undefined && designFloorAtZ(z) === undefined) zs.push(z);
  }
  return zs;
}

export const PROCEDURAL_FLOOR_ZS = makeProceduralFloorZs();
export const PROCEDURAL_FLOOR_COUNT = PROCEDURAL_FLOOR_ZS.length;

export const FLOOR_GEOMETRIES: readonly FloorGeometryDef[] = [
  {
    id: 'living_blocks',
    title: 'типовой жилой блок (класс Г)',
    baseFloor: FloorLevel.LIVING,
    weight: 42,
    roomCount: 86,
    dangerBias: 0,
    minZ: -3,
    maxZ: 7,
    wallTex: Tex.PANEL,
    floorTex: Tex.F_LINO,
    roomTypes: [RoomType.LIVING, RoomType.KITCHEN, RoomType.BATHROOM, RoomType.STORAGE, RoomType.COMMON],
    tags: ['residential', 'civil'],
    recipePool: ['smart_quarter_infill', 'concentric_rings', 'voronoi_partition', 'manhattan_grid', 'dense_room_scatter', 'attractor_courtyards'],
  },
  {
    id: 'apartment_pressure',
    title: 'уплотненный сектор Квартир',
    baseFloor: FloorLevel.KVARTIRY,
    weight: 30,
    roomCount: 104,
    dangerBias: 1,
    minZ: -15,
    maxZ: 3,
    wallTex: Tex.BRICK,
    floorTex: Tex.F_LINO,
    roomTypes: [RoomType.LIVING, RoomType.KITCHEN, RoomType.BATHROOM, RoomType.COMMON, RoomType.STORAGE, RoomType.SMOKING],
    tags: ['residential', 'crowd', 'riot'],
    recipePool: ['smart_quarter_infill', 'voronoi_partition', 'concentric_rings', 'organic_braid', 'manhattan_grid', 'dense_room_scatter'],
  },
  {
    id: 'communal_knots',
    title: 'коммунально-бытовые узлы',
    baseFloor: FloorLevel.KVARTIRY,
    weight: 26,
    roomCount: 112,
    dangerBias: 0,
    minZ: -11,
    maxZ: 11,
    wallTex: Tex.BRICK,
    floorTex: Tex.F_LINO,
    roomTypes: [RoomType.COMMON, RoomType.COMMON, RoomType.KITCHEN, RoomType.BATHROOM, RoomType.LIVING, RoomType.STORAGE, RoomType.SMOKING, RoomType.CORRIDOR],
    tags: ['residential', 'crowd', 'queue', 'canteen', 'civil'],
    recipePool: ['concentric_rings', 'smart_quarter_infill', 'voronoi_partition', 'organic_braid', 'attractor_courtyards', 'dense_room_scatter'],
  },
  {
    id: 'attic_weatherworks',
    title: 'камеры воздухозабора и вентиляции',
    baseFloor: FloorLevel.MINISTRY,
    weight: 30,
    roomCount: 360,
    dangerBias: 1,
    minZ: -43,
    maxZ: -29,
    wallTex: Tex.PIPE,
    floorTex: Tex.F_CONCRETE,
    roomTypes: [RoomType.CORRIDOR, RoomType.CORRIDOR, RoomType.PRODUCTION, RoomType.STORAGE, RoomType.OFFICE, RoomType.COMMON],
    tags: ['admin', 'roofline', 'antenna', 'wind', 'documents'],
    recipePool: ['organic_braid', 'hilbert_fill', 'dark_tunnel_web', 'attractor_courtyards', 'production_islands', 'dense_room_scatter'],
  },
  {
    id: 'archive_warrens',
    title: 'архивы забытых нормативов',
    baseFloor: FloorLevel.MINISTRY,
    weight: 28,
    roomCount: 92,
    dangerBias: 0,
    minZ: -31,
    maxZ: -13,
    wallTex: Tex.MARBLE,
    floorTex: Tex.F_PARQUET,
    roomTypes: [RoomType.OFFICE, RoomType.STORAGE, RoomType.STORAGE, RoomType.CORRIDOR, RoomType.COMMON, RoomType.SMOKING],
    tags: ['admin', 'documents', 'archive', 'paper_dust', 'maze'],
    recipePool: ['hilbert_fill', 'manhattan_grid', 'smart_quarter_infill', 'voronoi_partition', 'organic_braid', 'dense_room_scatter'],
  },
  {
    id: 'collectors',
    title: 'технические коллекторы',
    baseFloor: FloorLevel.MAINTENANCE,
    weight: 32,
    roomCount: 72,
    dangerBias: 1,
    minZ: 1,
    maxZ: 35,
    wallTex: Tex.PIPE,
    floorTex: Tex.F_CONCRETE,
    roomTypes: [RoomType.CORRIDOR, RoomType.PRODUCTION, RoomType.STORAGE, RoomType.COMMON],
    tags: ['industrial', 'water', 'pipes', 'maintenance', 'emergency_panels'],
    recipePool: ['dark_tunnel_web', 'production_islands', 'organic_braid', 'voronoi_partition', 'hilbert_fill', 'dense_room_scatter'],
  },
  {
    id: 'workshops',
    title: 'уровень производственных цехов',
    baseFloor: FloorLevel.MAINTENANCE,
    weight: 26,
    roomCount: 64,
    dangerBias: 1,
    minZ: 5,
    maxZ: 27,
    wallTex: Tex.METAL,
    floorTex: Tex.F_CONCRETE,
    roomTypes: [RoomType.PRODUCTION, RoomType.PRODUCTION, RoomType.STORAGE, RoomType.OFFICE, RoomType.CORRIDOR],
    tags: ['industrial', 'workshop', 'machines', 'maintenance', 'emergency_panels'],
    recipePool: ['production_islands', 'manhattan_grid', 'dark_tunnel_web', 'attractor_courtyards', 'hilbert_fill', 'dense_room_scatter'],
  },
  {
    id: 'service_spines',
    title: 'магистральные сервисные штреки',
    baseFloor: FloorLevel.MAINTENANCE,
    weight: 24,
    roomCount: 176,
    dangerBias: 0,
    minZ: 9,
    maxZ: 23,
    wallTex: Tex.METAL,
    floorTex: Tex.F_CONCRETE,
    roomTypes: [RoomType.CORRIDOR, RoomType.CORRIDOR, RoomType.CORRIDOR, RoomType.PRODUCTION, RoomType.STORAGE, RoomType.OFFICE, RoomType.COMMON],
    tags: ['industrial', 'service', 'transit', 'power', 'pressure', 'maintenance', 'emergency_panels'],
    recipePool: ['dark_tunnel_web', 'manhattan_grid', 'production_islands', 'organic_braid', 'hilbert_fill', 'dense_room_scatter'],
  },
  {
    id: 'sump_causeways',
    title: 'нижние затопленные эстакады',
    baseFloor: FloorLevel.MAINTENANCE,
    weight: 34,
    roomCount: 56,
    dangerBias: 2,
    minZ: 21,
    maxZ: 39,
    wallTex: Tex.PIPE,
    floorTex: Tex.F_CONCRETE,
    roomTypes: [RoomType.CORRIDOR, RoomType.CORRIDOR, RoomType.PRODUCTION, RoomType.STORAGE, RoomType.COMMON],
    tags: ['industrial', 'water', 'sump', 'blackwater', 'transit', 'abyss'],
    recipePool: ['dark_tunnel_web', 'organic_braid', 'production_islands', 'voronoi_partition', 'attractor_courtyards', 'dense_room_scatter'],
  },
  {
    id: 'admin_pockets',
    title: 'канцелярские лабиринты',
    baseFloor: FloorLevel.MINISTRY,
    weight: 16,
    roomCount: 240,
    dangerBias: 0,
    minZ: -43,
    maxZ: -13,
    wallTex: Tex.MARBLE,
    floorTex: Tex.F_PARQUET,
    roomTypes: [RoomType.OFFICE, RoomType.OFFICE, RoomType.COMMON, RoomType.STORAGE, RoomType.STORAGE, RoomType.SMOKING, RoomType.CORRIDOR, RoomType.BATHROOM, RoomType.KITCHEN, RoomType.MEDICAL],
    tags: ['admin', 'documents'],
    recipePool: ['manhattan_grid', 'hilbert_fill', 'smart_quarter_infill', 'concentric_rings', 'voronoi_partition', 'dense_room_scatter'],
  },
];

export const FLOOR_MAJORITY_FACTIONS: readonly FloorMajorityDef[] = [
  {
    id: 'citizens',
    title: 'заселённый сектор',
    weight: 58,
    npcFaction: Faction.CITIZEN,
    zoneFaction: ZoneFaction.CITIZEN,
    tags: ['civil'],
  },
  {
    id: 'liquidators',
    title: 'зона контроля Ликвидаторов',
    weight: 22,
    npcFaction: Faction.LIQUIDATOR,
    zoneFaction: ZoneFaction.LIQUIDATOR,
    minDanger: 2,
    tags: ['armed', 'patrol'],
  },
  {
    id: 'wild',
    title: 'дикий брошенный сектор',
    weight: 14,
    npcFaction: Faction.WILD,
    zoneFaction: ZoneFaction.WILD,
    minDanger: 2,
    tags: ['raiders'],
  },
  {
    id: 'scientists',
    title: 'экспериментальная зона НИИ',
    weight: 10,
    npcFaction: Faction.SCIENTIST,
    zoneFaction: ZoneFaction.SCIENTIST,
    tags: ['lab', 'documents', 'quarantine'],
  },
  {
    id: 'cultists',
    title: 'заражённый сектор (очаг сектантов)',
    weight: 7,
    npcFaction: Faction.CULTIST,
    zoneFaction: ZoneFaction.CULTIST,
    minDanger: 3,
    tags: ['cult', 'psi'],
  },
];

export const FLOOR_ANOMALIES: readonly FloorAnomalyDef[] = [
  { id: 'none', title: 'аномалий нет', weight: 54, minDanger: 1, dangerBias: 0, tags: [] },
  { id: 'smog', title: 'взвесь говняка в воздухе', weight: 18, minDanger: 1, dangerBias: 1, tags: ['fog', 'visibility', 'smog', 'govnyak', 'contraband'] },
  { id: 'teleport_cells', title: 'пространственные разрывы', weight: 10, minDanger: 2, dangerBias: 1, tags: ['topology'] },
  { id: 'mushroom_mycelium', title: 'прорастание слизевика', weight: 14, minDanger: 2, dangerBias: 0, tags: ['mushroom', 'food', 'slime'] },
  { id: 'hladon', title: 'протечка магистрального хладона', weight: 11, minDanger: 2, dangerBias: 1, tags: ['cold', 'heat_counter', 'route_pressure'] },
  { id: 'false_safe_block', title: 'ложный гермоблок', weight: 5, minDanger: 2, dangerBias: 1, tags: ['cult', 'shelter', FALSE_SAFE_BLOCK_TAG] },
  { id: 'mirror_run', title: 'пространственное дублирование', weight: 8, minDanger: 2, dangerBias: 1, tags: ['mirror', 'duality', 'teleport', 'loot'] },
  { id: 'radio_chess', title: 'радиоактивные прострелы', weight: 8, minDanger: 2, dangerBias: 1, tags: ['pattern', 'radio', 'timing', 'movement'] },
  { id: 'conveyor_sorter', title: 'индустриальный сортировщик', weight: 7, minDanger: 2, dangerBias: 1, tags: ['conveyor', 'items', 'industrial', 'movement'] },
  { id: 'fractal_floor', title: 'фрактальное замыкание', weight: 6, minDanger: 3, dangerBias: 1, tags: ['fractal', 'maze', 'topology', 'documents'] },
  { id: 'cement_memory', title: 'маршрутная память бетона', weight: 6, minDanger: 3, dangerBias: 1, tags: ['trail', 'pressure', 'no_backtracking', 'samosbor'] },
  { id: 'wall_snake', title: 'блуждающие перекрытия', weight: 4, minDanger: 2, dangerBias: 2, tags: ['moving_walls', 'predator', 'crush', 'loot_sink'] },
  { id: 'living_tunnels', title: 'биологическое сужение стен', weight: 4, minDanger: 2, dangerBias: 2, tags: ['living_tunnels', 'topology', 'moving_walls', 'repair', 'route_pressure'] },
  { id: 'rail_trains', title: 'рабочие технические дрезины', weight: 8, minDanger: 2, dangerBias: 1, tags: ['rail', 'transit', 'crush', 'industrial'] },
  { id: 'bad_apple_world', title: 'эксперимент BAD_APPLE (отключен)', weight: 0, minDanger: 3, dangerBias: 1, tags: ['video', 'screen', 'topology', 'cult_media'] },
  { id: 'zombie_apocalypse', title: 'массовое психотропное заражение', weight: 4, minDanger: 2, dangerBias: 2, tags: ['zombie', 'crowd', 'infection', 'quarantine', 'residential'] },
  { id: 'sandpile_perekrytie', title: 'оползень песчаных перекрытий', weight: 4, minDanger: 2, dangerBias: 2, tags: ['topology', 'crush', 'pressure', 'industrial', 'route_pressure'] },
  { id: 'section_shift', title: 'сейсмический сдвиг секции', weight: 4, minDanger: 3, dangerBias: 2, tags: ['topology', 'moving_rooms', 'crush', 'toroid'] },
  { id: 'conway_life', title: 'клеточный распад материи', weight: 3, minDanger: 3, dangerBias: 2, tags: ['cellular', 'topology', 'moving_walls', 'math'] },
  { id: 'samosbor_seed', title: 'свежий осадок самосбора', weight: 9, minDanger: 3, dangerBias: 2, tags: ['samosbor', 'meat', 'slime'] },
];

const LOOT_BY_TAG: Record<string, readonly string[]> = {
  civil: ['bread', 'water', 'tea', 'cigs', 'shelter_tally', 'neighbor_complaint', 'emergency_roster'],
  residential: ['bread', 'water', 'tea', 'book', 'cigs', 'cloth_roll', 'neighbor_complaint'],
  crowd: ['ballot', 'ration_registry_extract', 'forged_ration_card', 'bandage'],
  queue: ['ballot', 'ration_registry_extract', 'forged_ration_card', 'siren_instruction'],
  canteen: ['grey_briquette', 'green_briquette', 'kasha', 'kompot', 'ration_stamp_pad'],
  industrial: ['pipe', 'wrench', 'gear', 'spring', 'metal_sheet', 'ammo_nails', 'pressure_logbook'],
  maintenance: ['fuse', 'wire_coil', 'relay_diagram', 'valve_tag', 'sealant_tube', 'asbestos_cord', 'gasmask_filter'],
  emergency_panels: ['fuse', 'wire_coil', 'relay_diagram', 'door_kit', 'lamp_bulb'],
  workshop: ['nailgun', 'ammo_nails', 'circuit_board', 'barrel_part', 'rubber_strip'],
  service: ['fuse', 'relay_diagram', 'duct_tape', 'wire_coil', 'door_kit', 'flashlight'],
  power: ['fuse', 'relay_diagram', 'circuit_board', 'lamp_bulb', 'wire_coil'],
  water: ['metal_water', 'filter_layer', 'sealant_tube', 'harpoon_gun'],
  sump: ['harpoon_gun', 'metal_water', 'filter_layer', 'sealant_tube', 'valve_tag'],
  blackwater: ['metal_water', 'harpoon_gun', 'overexposed_photo', 'void_archive_warrant'],
  abyss: ['void_archive_warrant', 'istotit_candle', 'overexposed_photo', 'psi_dust', 'losyash_rifle', 'rifle_bolt_pack'],
  admin: ['blank_form', 'temp_pass', 'official_permit_slip', 'seal_wax', 'ink_bottle'],
  documents: ['note', 'lift_scheme', 'elevator_access_order', 'missing_record_file'],
  lab: ['nii_sample_container', 'empty_sample_jar', 'sterile_swab', 'sample_chain_form', 'nii_sample_label', 'gas_sample_ampoule', 'mutant_tissue_sample', 'antibiotic'],
  archive: ['personal_file_copy', 'record_exposure_notice', 'passport_stub', 'void_archive_warrant'],
  paper_dust: ['gasmask_filter', 'cloth_roll', 'ink_bottle', 'seal_wax'],
  roofline: ['wire_coil', 'relay_diagram', 'gasmask_filter', 'overexposed_photo'],
  antenna: ['wire_coil', 'circuit_board', 'relay_diagram', 'lamp_bulb'],
  wind: ['cloth_roll', 'gasmask_filter', 'filter_layer', 'duct_tape'],
  mushroom: ['mushroom_mass', 'infected_mushroom', 'spore_print', 'substrate_sack', 'antifungal_ointment'],
  cold: ['boiler_water', 'asbestos_cord', 'sealant_tube', 'cloth_roll', 'valve_tag'],
  samosbor: ['siren_shard', 'samosbor_tally', 'hermodoor_journal', 'meat_rune'],
  cult: ['meat_rune', 'holy_water', 'psi_dust', 'idol_chernobog'],
  shelter: ['water', 'bread', 'bandage', 'siren_instruction', 'emergency_roster'],
  armed: ['ammo_shells', 'chizh3_shotgun', 'granit4u_belt_shotgun'],
  [FALSE_SAFE_BLOCK_TAG]: ['siren_instruction', 'emergency_roster', 'container_key_label', 'meat_rune'],
  smog: ['gasmask_filter', 'cloth_roll', 'filter_layer', 'valve_tag', 'filter_receipt', 'forged_quarantine_clearance'],
  govnyak: ['cigs', 'grey_briquette', 'green_briquette', 'concentrate_coupon'],
  contraband: ['forged_quarantine_clearance', 'filter_receipt', 'fake_pass'],
  mirror: ['inspection_mirror', 'glass_shard', 'container_key_label', 'fake_pass', 'note'],
  duality: ['holy_water', 'psi_dust', 'blank_form'],
  teleport: ['lift_scheme', 'elevator_access_order', 'missing_record_file'],
  pattern: ['relay_diagram', 'circuit_board', 'lamp_bulb', 'note'],
  radio: ['relay_diagram', 'circuit_board', 'lamp_bulb'],
  timing: ['relay_diagram', 'siren_energy', 'flashlight'],
  movement: ['spring', 'rubber_strip', 'gear'],
  conveyor: ['gear', 'spring', 'metal_sheet', 'rubber_strip', 'ammo_nails'],
  fractal: ['lift_scheme', 'elevator_override_form', 'missing_record_file', 'note'],
  maze: ['lift_scheme', 'istotit_candle', 'ink_bottle'],
  trail: ['ink_bottle', 'alcohol_bottle', 'lift_scheme', 'cloth_roll'],
  pressure: ['pressure_logbook', 'valve_tag', 'sealant_tube'],
  moving_walls: ['wrench', 'gear', 'spring', 'metal_sheet'],
  living_tunnels: ['sealant_tube', 'asbestos_cord', 'pressure_logbook', 'relay_diagram', 'lift_scheme'],
  predator: ['meat_rune', 'ammo_nails', 'harpoon_gun'],
  crush: ['bandage', 'tourniquet', 'wrench'],
  rail: ['metro_ticket', 'wrench', 'fuse', 'relay_diagram', 'valve_tag'],
  transit: ['metro_ticket', 'caravan_route', 'lift_scheme', 'pressure_logbook'],
  cellular: ['circuit_board', 'ink_bottle', 'note'],
  math: ['book', 'lift_scheme', 'blank_form'],
  video: ['circuit_board', 'relay_diagram', 'overexposed_photo', 'lamp_bulb'],
  screen: ['circuit_board', 'relay_diagram', 'filter_receipt', 'note'],
  cult_media: ['psi_dust', 'holy_water', 'meat_rune', 'blank_form'],
  zombie: ['bandage', 'tourniquet', 'clean_health_cert', 'forged_quarantine_clearance'],
  infection: ['bandage', 'tourniquet', 'official_quarantine_clearance', 'clean_health_cert'],
  quarantine: ['bandage', 'clean_health_cert', 'official_quarantine_clearance', 'forged_quarantine_clearance'],
};

const MONSTERS_BY_TAG: Record<string, readonly MonsterKind[]> = {
  residential: [MonsterKind.SBORKA, MonsterKind.TVAR, MonsterKind.ZOMBIE, MonsterKind.DIKIY_MERTVYAK, MonsterKind.KRYSNOZHKA, MonsterKind.GREEN_DOG, MonsterKind.NELYUD, MonsterKind.BEZEKHIY, MonsterKind.TRESKOTNIK],
  civil: [MonsterKind.SHOVNIK, MonsterKind.LAMPOVY, MonsterKind.LAMPOGLAZ, MonsterKind.SBORKA, MonsterKind.BEZEKHIY, MonsterKind.TRESKOTNIK],
  crowd: [MonsterKind.ZOMBIE, MonsterKind.DIKIY_MERTVYAK, MonsterKind.KRYSNOZHKA, MonsterKind.GREEN_DOG, MonsterKind.NELYUD, MonsterKind.SHADOW, MonsterKind.TRESKOTNIK],
  riot: [MonsterKind.ZOMBIE, MonsterKind.DIKIY_MERTVYAK, MonsterKind.SHOVNIK, MonsterKind.PECHATEED, MonsterKind.NELYUD],
  queue: [MonsterKind.ZOMBIE, MonsterKind.DIKIY_MERTVYAK, MonsterKind.NELYUD, MonsterKind.KRYSNOZHKA, MonsterKind.SHOVNIK],
  canteen: [MonsterKind.KRYSNOZHKA, MonsterKind.GREEN_DOG, MonsterKind.ZOMBIE, MonsterKind.DIKIY_MERTVYAK, MonsterKind.TVAR],
  industrial: [MonsterKind.REBAR, MonsterKind.RZHAVNIK, MonsterKind.POLZUN, MonsterKind.ROBOT, MonsterKind.TRUBNYY_AVTOMAT, MonsterKind.LAMPOVY, MonsterKind.SAFEGUARD],
  maintenance: [MonsterKind.LAMPOVY, MonsterKind.ROBOT, MonsterKind.TRUBNYY_AVTOMAT, MonsterKind.REBAR, MonsterKind.RZHAVNIK, MonsterKind.TUBE_EEL, MonsterKind.VODYANOY_KOSHMAR, MonsterKind.OLGOY, MonsterKind.BORSHCHEVIK],
  emergency_panels: [MonsterKind.LAMPOVY, MonsterKind.ROBOT, MonsterKind.EYE],
  workshop: [MonsterKind.REBAR, MonsterKind.RZHAVNIK, MonsterKind.ROBOT, MonsterKind.SBORKA],
  service: [MonsterKind.LAMPOVY, MonsterKind.ROBOT, MonsterKind.TRUBNYY_AVTOMAT, MonsterKind.REBAR, MonsterKind.RZHAVNIK, MonsterKind.TUBE_EEL, MonsterKind.VODYANOY_KOSHMAR, MonsterKind.BORSHCHEVIK],
  power: [MonsterKind.LAMPOVY, MonsterKind.LAMPOGLAZ, MonsterKind.ROBOT, MonsterKind.EYE],
  machines: [MonsterKind.ROBOT, MonsterKind.TRUBNYY_AVTOMAT, MonsterKind.LAMPOVY, MonsterKind.REBAR, MonsterKind.RZHAVNIK, MonsterKind.SAFEGUARD],
  pipes: [MonsterKind.TUBE_EEL, MonsterKind.TRUBNYY_AVTOMAT, MonsterKind.VODYANOY_KOSHMAR, MonsterKind.OLGOY, MonsterKind.POLZUN, MonsterKind.REBAR],
  water: [MonsterKind.TUBE_EEL, MonsterKind.TRUBNYY_AVTOMAT, MonsterKind.VODYANOY_KOSHMAR, MonsterKind.OLGOY, MonsterKind.POLZUN, MonsterKind.TVAR],
  sump: [MonsterKind.TUBE_EEL, MonsterKind.TRUBNYY_AVTOMAT, MonsterKind.VODYANOY_KOSHMAR, MonsterKind.OLGOY, MonsterKind.POLZUN, MonsterKind.REBAR, MonsterKind.TVAR],
  blackwater: [MonsterKind.SHADOW, MonsterKind.GLUBINNAYA_TEN, MonsterKind.LISHENNYY, MonsterKind.NIGHTMARE, MonsterKind.NELYUD, MonsterKind.POLZUN],
  abyss: [MonsterKind.SHADOW, MonsterKind.GLUBINNAYA_TEN, MonsterKind.LISHENNYY, MonsterKind.NIGHTMARE, MonsterKind.SPIRIT, MonsterKind.LOZHNYY_DUKH, MonsterKind.BETONNIK],
  admin: [MonsterKind.PECHATEED, MonsterKind.PROTOKOLNIK, MonsterKind.SHOVNIK, MonsterKind.PARAGRAPH, MonsterKind.LOZHNYY_DUKH],
  documents: [MonsterKind.PECHATEED, MonsterKind.PROTOKOLNIK, MonsterKind.PARAGRAPH, MonsterKind.EYE],
  archive: [MonsterKind.PECHATEED, MonsterKind.PROTOKOLNIK, MonsterKind.PARAGRAPH, MonsterKind.SHOVNIK, MonsterKind.EYE],
  paper_dust: [MonsterKind.PECHATEED, MonsterKind.PARAGRAPH, MonsterKind.SHADOW],
  roofline: [MonsterKind.LAMPOVY, MonsterKind.EYE, MonsterKind.SHADOW],
  antenna: [MonsterKind.EYE, MonsterKind.LAMPOVY, MonsterKind.ROBOT],
  wind: [MonsterKind.SHADOW, MonsterKind.NIGHTMARE, MonsterKind.SPIRIT, MonsterKind.LOZHNYY_DUKH],
  armed: [MonsterKind.EYE, MonsterKind.ROBOT, MonsterKind.SHOVNIK],
  patrol: [MonsterKind.EYE, MonsterKind.LAMPOGLAZ, MonsterKind.LAMPOVY, MonsterKind.ROBOT, MonsterKind.SAFEGUARD],
  raiders: [MonsterKind.NELYUD, MonsterKind.SBORKA, MonsterKind.SHADOW],
  lab: [MonsterKind.EYE, MonsterKind.LAMPOGLAZ, MonsterKind.LAMPOVY, MonsterKind.PARAGRAPH],
  fog: [MonsterKind.TUMANNIK, MonsterKind.EYE, MonsterKind.SHADOW, MonsterKind.GLUBINNAYA_TEN, MonsterKind.LISHENNYY, MonsterKind.NIGHTMARE],
  smog: [MonsterKind.TUMANNIK, MonsterKind.NELYUD, MonsterKind.POLZUN, MonsterKind.TVAR, MonsterKind.SHADOW],
  govnyak: [MonsterKind.ZOMBIE, MonsterKind.NELYUD, MonsterKind.TVAR],
  mushroom: [MonsterKind.ZOMBIE, MonsterKind.SBORKA, MonsterKind.POLZUN, MonsterKind.SLIMEVIK, MonsterKind.OLGOY, MonsterKind.BORSHCHEVIK],
  slime: [MonsterKind.SLIMEVIK, MonsterKind.POLZUN, MonsterKind.TUBE_EEL],
  cold: [MonsterKind.SHADOW, MonsterKind.GLUBINNAYA_TEN, MonsterKind.LISHENNYY, MonsterKind.TUBE_EEL, MonsterKind.NELYUD, MonsterKind.LOZHNYY_DUKH],
  heat_counter: [MonsterKind.TUBE_EEL, MonsterKind.VODYANOY_KOSHMAR, MonsterKind.POLZUN, MonsterKind.SHADOW],
  route_pressure: [MonsterKind.EYE, MonsterKind.SHADOW, MonsterKind.GLUBINNAYA_TEN, MonsterKind.LISHENNYY, MonsterKind.VODYANOY_KOSHMAR, MonsterKind.NELYUD, MonsterKind.POLZUN, MonsterKind.DIKIY_MERTVYAK, MonsterKind.BEZEKHIY, MonsterKind.GREEN_DOG, MonsterKind.TRESKOTNIK, MonsterKind.BORSHCHEVIK],
  samosbor: [MonsterKind.SHADOW, MonsterKind.GLUBINNAYA_TEN, MonsterKind.LISHENNYY, MonsterKind.NIGHTMARE, MonsterKind.REBAR, MonsterKind.EYE, MonsterKind.SLIMEVIK, MonsterKind.OLGOY],
  cult: [MonsterKind.SHADOW, MonsterKind.GLUBINNAYA_TEN, MonsterKind.LISHENNYY, MonsterKind.IDOL, MonsterKind.SPIRIT],
  psi: [MonsterKind.SHADOW, MonsterKind.GLUBINNAYA_TEN, MonsterKind.LISHENNYY, MonsterKind.SPIRIT, MonsterKind.IDOL],
  shelter: [MonsterKind.ZOMBIE, MonsterKind.SHADOW],
  [FALSE_SAFE_BLOCK_TAG]: [MonsterKind.IDOL, MonsterKind.SHADOW, MonsterKind.SPIRIT, MonsterKind.LOZHNYY_DUKH, MonsterKind.GREEN_DOG],
  mirror: [MonsterKind.SHADOW, MonsterKind.GLUBINNAYA_TEN, MonsterKind.LISHENNYY, MonsterKind.SPIRIT, MonsterKind.LOZHNYY_DUKH, MonsterKind.EYE],
  duality: [MonsterKind.SHADOW, MonsterKind.GLUBINNAYA_TEN, MonsterKind.LISHENNYY, MonsterKind.NELYUD, MonsterKind.BEZEKHIY],
  teleport: [MonsterKind.SPIRIT, MonsterKind.LOZHNYY_DUKH, MonsterKind.PARAGRAPH, MonsterKind.SAFEGUARD],
  pattern: [MonsterKind.ROBOT, MonsterKind.EYE, MonsterKind.LAMPOVY],
  radio: [MonsterKind.LAMPOVY, MonsterKind.ROBOT],
  conveyor: [MonsterKind.REBAR, MonsterKind.ROBOT, MonsterKind.POLZUN],
  movement: [MonsterKind.POLZUN, MonsterKind.REBAR, MonsterKind.TRESKOTNIK],
  fractal: [MonsterKind.PARAGRAPH, MonsterKind.SHOVNIK, MonsterKind.EYE],
  maze: [MonsterKind.POLZUN, MonsterKind.SHADOW],
  trail: [MonsterKind.NELYUD, MonsterKind.SHADOW, MonsterKind.ZOMBIE, MonsterKind.BEZEKHIY],
  pressure: [MonsterKind.REBAR, MonsterKind.POLZUN],
  moving_walls: [MonsterKind.REBAR, MonsterKind.SBORKA, MonsterKind.TRESKOTNIK],
  living_tunnels: [MonsterKind.POLZUN, MonsterKind.REBAR, MonsterKind.TUBE_EEL, MonsterKind.BETONNIK],
  predator: [MonsterKind.TVAR, MonsterKind.KOSTOREZ, MonsterKind.POLZUN, MonsterKind.SAFEGUARD, MonsterKind.TRESKOTNIK],
  crush: [MonsterKind.REBAR, MonsterKind.KOSTOREZ, MonsterKind.SAFEGUARD],
  rail: [MonsterKind.REBAR, MonsterKind.ROBOT, MonsterKind.TUBE_EEL],
  transit: [MonsterKind.NELYUD, MonsterKind.POLZUN, MonsterKind.BEZEKHIY],
  cellular: [MonsterKind.SBORKA, MonsterKind.PARAGRAPH, MonsterKind.EYE],
  math: [MonsterKind.PARAGRAPH, MonsterKind.PECHATEED],
  video: [MonsterKind.EYE, MonsterKind.LAMPOGLAZ, MonsterKind.LAMPOVY, MonsterKind.PARAGRAPH],
  screen: [MonsterKind.EYE, MonsterKind.ROBOT, MonsterKind.LAMPOGLAZ, MonsterKind.LAMPOVY, MonsterKind.SAFEGUARD],
  cult_media: [MonsterKind.SHADOW, MonsterKind.SPIRIT, MonsterKind.IDOL],
  zombie: [MonsterKind.ZOMBIE, MonsterKind.DIKIY_MERTVYAK, MonsterKind.NELYUD, MonsterKind.KRYSNOZHKA],
  infection: [MonsterKind.ZOMBIE, MonsterKind.DIKIY_MERTVYAK, MonsterKind.TVAR, MonsterKind.NELYUD],
  quarantine: [MonsterKind.ZOMBIE, MonsterKind.DIKIY_MERTVYAK, MonsterKind.EYE, MonsterKind.PECHATEED],
};

function clampDanger(v: number): 1 | 2 | 3 | 4 | 5 {
  return Math.max(1, Math.min(5, Math.round(v))) as 1 | 2 | 3 | 4 | 5;
}

function routeDangerScore(z: number): number {
  // Route pressure is banded so far-up bureaucracy, housing, industrial descent
  // and hell/void gaps keep different rhythms instead of all maxing by |z|.
  if (z <= -13) return 2.05 + Math.min(1, (-13 - z) / 30) * 0.75;
  if (z <= 8) return 1.25 + Math.min(1, Math.abs(z) / 12) * 0.8 + (z > 0 ? 0.2 : 0);
  if (z <= 27) return 2.35 + Math.min(1, (z - 9) / 18) * 0.85;
  return 3.15 + Math.min(1, (z - 29) / 10) * 0.35;
}

function anomalyDangerPressure(anomaly: FloorAnomalyDef): number {
  if (anomaly.dangerBias <= 0) return 0;
  return 0.65 + (anomaly.dangerBias - 1) * 0.55;
}

function zAllowed(def: { minZ?: number; maxZ?: number }, z: number): boolean {
  if (def.minZ !== undefined && z < def.minZ) return false;
  if (def.maxZ !== undefined && z > def.maxZ) return false;
  return true;
}

function pickWeighted<T>(
  defs: readonly T[],
  rng: () => number,
  weightOf: (def: T) => number,
): T {
  let total = 0;
  for (const def of defs) total += Math.max(0, weightOf(def));
  let roll = rng() * total;
  for (const def of defs) {
    roll -= Math.max(0, weightOf(def));
    if (roll <= 0) return def;
  }
  return defs[defs.length - 1];
}

function uniquePicks<T>(pool: readonly T[], rng: () => number, count: number): T[] {
  const out: T[] = [];
  if (pool.length === 0) return out;
  for (let i = 0; i < count * 3 && out.length < count; i++) {
    const picked = pool[Math.floor(rng() * pool.length)];
    if (!out.includes(picked)) out.push(picked);
  }
  return out;
}

const LOOT_BIAS_COMPANION_IDS: readonly (readonly [string, string])[] = [
  ['losyash_rifle', 'rifle_bolt_pack'],
];

function withLootBiasCompanions(ids: string[]): string[] {
  const out = ids.slice();
  for (const [a, b] of LOOT_BIAS_COMPANION_IDS) {
    if (out.includes(a) && !out.includes(b)) out.push(b);
    else if (out.includes(b) && !out.includes(a)) out.push(a);
  }
  return out;
}

function uniqueStrings(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

function collectTagged<T>(tags: readonly string[], table: Record<string, readonly T[]>): T[] {
  const out: T[] = [];
  for (const tag of tags) {
    const vals = table[tag];
    if (vals) out.push(...vals);
  }
  return out;
}

export function storyFloorAtZ(z: number): FloorLevel | undefined {
  return STORY_FLOOR_BY_Z.get(z);
}

export function zForStoryFloor(floor: FloorLevel): number {
  return STORY_Z_BY_FLOOR[floor] ?? 0;
}

export function isProceduralFloorZ(z: number): boolean {
  return z >= FLOOR_RUN_MIN_Z && z <= FLOOR_RUN_MAX_Z && storyFloorAtZ(z) === undefined && designFloorAtZ(z) === undefined;
}

export function floorRunZAllowsNpcs(z: number): boolean {
  return z > FLOOR_RUN_NPC_FREE_Z;
}

export function proceduralFloorKey(z: number): string {
  return `z${z}`;
}

export function proceduralOrdinal(z: number): number {
  const idx = PROCEDURAL_FLOOR_ZS.indexOf(z);
  return idx >= 0 ? idx + 1 : PROCEDURAL_FLOOR_COUNT + Math.abs(z);
}

export function proceduralFloorSourceTags(spec: Pick<ProceduralFloorSpec, 'geometryId' | 'majorityId' | 'anomalyId'>): string[] {
  return uniqueStrings([
    ...geometryById(spec.geometryId).tags,
    ...majorityById(spec.majorityId).tags,
    ...anomalyById(spec.anomalyId).tags,
  ]);
}

export function proceduralFloorMonsterBiasTags(spec: Pick<ProceduralFloorSpec, 'geometryId' | 'majorityId' | 'anomalyId'>): string[] {
  return proceduralFloorSourceTags(spec).filter(tag => MONSTERS_BY_TAG[tag]?.length);
}

export function proceduralMonsterFloor(spec: Pick<ProceduralFloorSpec, 'z' | 'baseFloor'>): FloorLevel {
  const profileZ = floorRunProfileZ(spec.z);
  if (spec.z <= FLOOR_RUN_NPC_FREE_Z) return FloorLevel.VOID;
  if (profileZ >= 25) return FloorLevel.HELL;
  if (profileZ >= 13) return FloorLevel.MAINTENANCE;
  if (profileZ <= -17) return FloorLevel.MINISTRY;
  if (profileZ <= -5) return FloorLevel.KVARTIRY;
  return spec.baseFloor;
}

export function proceduralFloorAnomalyRoutePressure(spec: Pick<ProceduralFloorSpec, 'anomalyId'>): number {
  if (spec.anomalyId === 'samosbor_seed' || spec.anomalyId === 'wall_snake' || spec.anomalyId === 'living_tunnels' || spec.anomalyId === 'section_shift' || spec.anomalyId === 'zombie_apocalypse' || spec.anomalyId === 'sandpile_perekrytie') return 2;
  if (
    spec.anomalyId === 'smog' ||
    spec.anomalyId === 'hladon' ||
    spec.anomalyId === 'cement_memory' ||
    spec.anomalyId === 'conway_life' ||
    spec.anomalyId === 'rail_trains'
  ) return 1;
  return 0;
}

export function proceduralFloorRoutePressureLevel(spec: Pick<ProceduralFloorSpec, 'anomalyId' | 'danger' | 'z' | 'majorityId'>): number {
  let pressure = proceduralFloorAnomalyRoutePressure(spec);
  const profileZ = floorRunProfileZ(spec.z);
  if (spec.danger >= 4) pressure++;
  if (profileZ >= 25 || profileZ <= -24) pressure++;
  if (spec.majorityId === 'cultists' || spec.majorityId === 'wild') pressure++;
  return Math.min(4, pressure);
}

export function makeProceduralFloorSpec(runSeed: number, z: number): ProceduralFloorSpec {
  const seed = hashSeed(`floor:${runSeed}:${z}`, runSeed);
  const rng = seededRandom(seed);
  const depth = Math.abs(z);
  const profileZ = floorRunProfileZ(z);
  const geometry = pickWeighted(
    FLOOR_GEOMETRIES.filter(def => zAllowed(def, profileZ)),
    rng,
    def => {
      let w = def.weight;
      if (profileZ < 0 && def.baseFloor === FloorLevel.MINISTRY) w *= 1.8;
      if (profileZ > 0 && def.baseFloor === FloorLevel.MAINTENANCE) w *= 1.6;
      return w;
    },
  );
  const baseDangerScore = routeDangerScore(profileZ) + geometry.dangerBias * 0.55 + rng() - 0.5;
  const earlyDanger = clampDanger(baseDangerScore);
  const majority = pickWeighted(
    FLOOR_MAJORITY_FACTIONS.filter(def => (def.minDanger ?? 1) <= earlyDanger),
    rng,
    def => def.weight * (earlyDanger >= 4 && def.id === 'cultists' ? 2.2 : 1),
  );
  const anomaly = pickWeighted(
    FLOOR_ANOMALIES.filter(def => def.minDanger <= earlyDanger),
    rng,
    def => def.weight * (earlyDanger >= 4 && def.id !== 'none' ? 1.35 : 1),
  );
  const danger = clampDanger(baseDangerScore + anomalyDangerPressure(anomaly));
  const tags = [...geometry.tags, ...majority.tags, ...anomaly.tags];
  const lootPool = collectTagged(tags, LOOT_BY_TAG);
  const monsterPool = collectTagged(tags, MONSTERS_BY_TAG);
  const lootBiasIds = withLootBiasCompanions(uniquePicks(lootPool, rng, 5));
  const monsterBiasKinds = anomaly.id === 'zombie_apocalypse'
    ? [MonsterKind.ZOMBIE]
    : uniquePicks(monsterPool, rng, 4);
  const monsterBiasTags = uniqueStrings(tags).filter(tag => MONSTERS_BY_TAG[tag]?.length);
  const anomalyPrefix = anomaly.id === 'none' ? '' : `${anomaly.title}: `;

  return {
    key: proceduralFloorKey(z),
    z,
    ordinal: proceduralOrdinal(z),
    seed,
    depth,
    danger,
    geometryId: geometry.id,
    baseFloor: geometry.baseFloor,
    majorityId: majority.id,
    anomalyId: anomaly.id,
    title: `${anomalyPrefix}${geometry.title}, ${majority.title}`,
    lootBiasIds,
    monsterBiasKinds,
    monsterBiasTags,
  };
}

export function geometryById(id: FloorGeometryId): FloorGeometryDef {
  return FLOOR_GEOMETRIES.find(def => def.id === id) ?? FLOOR_GEOMETRIES[0];
}

export function majorityById(id: FloorMajorityId): FloorMajorityDef {
  return FLOOR_MAJORITY_FACTIONS.find(def => def.id === id) ?? FLOOR_MAJORITY_FACTIONS[0];
}

export function anomalyById(id: FloorAnomalyId): FloorAnomalyDef {
  return FLOOR_ANOMALIES.find(def => def.id === id) ?? FLOOR_ANOMALIES[0];
}
