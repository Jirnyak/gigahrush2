import { Feature, FloorLevel, RoomType, Tex } from '../core/types';
import type { DesignFloorRouteDef } from './design_floors';
import type { ProceduralFloorSpec } from './procedural_floors';
import {
  craftStationProfileForDesignFloor,
  craftStationProfileForProceduralFloor,
  craftStationProfileForStoryFloor,
  type CraftStationPlacementProfile,
} from './craft_station_placement';

export interface RoomWeightedPlacementRule {
  id: string;
  min: number;
  max: number;
  roomDivisor: number;
  roomTypeWeights: Partial<Record<RoomType, number>>;
  tags?: readonly string[];
}

export interface FeaturePlacementRule extends RoomWeightedPlacementRule {
  kind: 'feature';
  feature: Feature;
  allowWater?: boolean;
}

export interface InteractivePlacementRule extends RoomWeightedPlacementRule {
  kind: 'interactive';
  defId: string;
  forceFeature?: boolean;
}

export interface BrokenFixturePlacementRule {
  id: string;
  baseChance: number;
  max: number;
  features: readonly Feature[];
  roomTypeWeights?: Partial<Record<RoomType, number>>;
  tags?: readonly string[];
}

export interface RoomTextureRule extends RoomWeightedPlacementRule {
  kind: 'room_texture';
  wallTex?: Tex;
  floorTex?: Tex;
  allowSpecialReplace?: boolean;
}

export type WallDecorKind = 'poster' | 'portrait' | 'sign' | 'screen';

export interface WallDecorPlacementRule extends RoomWeightedPlacementRule {
  kind: 'wall_decor';
  decor: WallDecorKind;
  textureBase: Tex;
  variantCount: number;
  variantOffset?: number;
  maxPerRoom?: number;
  allowSpecialReplace?: boolean;
}

export interface FloorObjectPlacementDensity {
  features?: number;
  interactives?: number;
  brokenFixtures?: number;
  wallDecor?: number;
  screens?: number;
  maxPerRoom?: number;
}

export interface FloorObjectPlacementProfile {
  id: string;
  tags: readonly string[];
  density?: FloorObjectPlacementDensity;
  roomTextureRules?: readonly RoomTextureRule[];
  wallDecorRules?: readonly WallDecorPlacementRule[];
  featureRules?: readonly FeaturePlacementRule[];
  interactiveRules?: readonly InteractivePlacementRule[];
  brokenFixtures?: readonly BrokenFixturePlacementRule[];
  craftStations?: CraftStationPlacementProfile;
}

function featureRule(
  id: string,
  feature: Feature,
  min: number,
  max: number,
  roomDivisor: number,
  roomTypeWeights: Partial<Record<RoomType, number>>,
  tags: readonly string[],
  allowWater = false,
): FeaturePlacementRule {
  return { id, kind: 'feature', feature, min, max, roomDivisor, roomTypeWeights, tags, allowWater };
}

function roomTextureRule(
  id: string,
  min: number,
  max: number,
  roomDivisor: number,
  roomTypeWeights: Partial<Record<RoomType, number>>,
  textures: Pick<RoomTextureRule, 'wallTex' | 'floorTex' | 'allowSpecialReplace'>,
  tags: readonly string[],
): RoomTextureRule {
  return { id, kind: 'room_texture', min, max, roomDivisor, roomTypeWeights, tags, ...textures };
}

function wallDecorRule(
  id: string,
  decor: WallDecorKind,
  textureBase: Tex,
  min: number,
  max: number,
  roomDivisor: number,
  roomTypeWeights: Partial<Record<RoomType, number>>,
  tags: readonly string[],
  options: Pick<WallDecorPlacementRule, 'variantCount' | 'variantOffset' | 'maxPerRoom' | 'allowSpecialReplace'>,
): WallDecorPlacementRule {
  return { id, kind: 'wall_decor', decor, textureBase, min, max, roomDivisor, roomTypeWeights, tags, ...options };
}

function productionWeights(multiplier = 1): Partial<Record<RoomType, number>> {
  return {
    [RoomType.PRODUCTION]: 1.4 * multiplier,
    [RoomType.STORAGE]: 1.0 * multiplier,
    [RoomType.HQ]: 0.75 * multiplier,
  };
}

function scienceWeights(multiplier = 1): Partial<Record<RoomType, number>> {
  return {
    [RoomType.MEDICAL]: 1.5 * multiplier,
    [RoomType.PRODUCTION]: 1.0 * multiplier,
    [RoomType.STORAGE]: 0.8 * multiplier,
    [RoomType.OFFICE]: 0.45 * multiplier,
  };
}

function publicRoomWeights(multiplier = 1): Partial<Record<RoomType, number>> {
  return {
    [RoomType.COMMON]: 1.25 * multiplier,
    [RoomType.OFFICE]: 1.0 * multiplier,
    [RoomType.MEDICAL]: 0.85 * multiplier,
    [RoomType.PRODUCTION]: 0.75 * multiplier,
    [RoomType.SMOKING]: 0.7 * multiplier,
    [RoomType.STORAGE]: 0.45 * multiplier,
  };
}

function householdWeights(multiplier = 1): Partial<Record<RoomType, number>> {
  return {
    [RoomType.KITCHEN]: 1.15 * multiplier,
    [RoomType.COMMON]: 1.0 * multiplier,
    [RoomType.LIVING]: 0.75 * multiplier,
    [RoomType.SMOKING]: 0.7 * multiplier,
    [RoomType.STORAGE]: 0.55 * multiplier,
    [RoomType.BATHROOM]: 0.35 * multiplier,
  };
}

function sanitaryBrokenFixtures(id: string, baseChance: number, max: number): BrokenFixturePlacementRule {
  return {
    id,
    baseChance,
    max,
    features: [Feature.SINK, Feature.TOILET],
    roomTypeWeights: {
      [RoomType.BATHROOM]: 1.45,
      [RoomType.KITCHEN]: 0.85,
      [RoomType.MEDICAL]: 0.7,
      [RoomType.PRODUCTION]: 0.35,
    },
    tags: ['sanitary', 'broken_fixture'],
  };
}

function pumpMachineryRules(prefix: string, min: number, max: number): readonly FeaturePlacementRule[] {
  return [
    {
      id: `${prefix}_pump_machines`,
      kind: 'feature',
      feature: Feature.MACHINE,
      min,
      max,
      roomDivisor: 4,
      roomTypeWeights: productionWeights(1.2),
      tags: [prefix, 'pump', 'machine'],
    },
    {
      id: `${prefix}_pump_apparatus`,
      kind: 'feature',
      feature: Feature.APPARATUS,
      min: Math.max(1, Math.floor(min * 0.75)),
      max: Math.max(1, Math.floor(max * 0.75)),
      roomDivisor: 5,
      roomTypeWeights: productionWeights(),
      tags: [prefix, 'pump', 'apparatus'],
    },
  ];
}

function publicFurnitureRules(prefix: string, min: number, max: number): readonly FeaturePlacementRule[] {
  return [
    featureRule(`${prefix}_public_tables`, Feature.TABLE, min, max, 8, publicRoomWeights(), [prefix, 'table', 'public']),
    featureRule(`${prefix}_public_shelves`, Feature.SHELF, Math.max(1, min - 1), Math.max(1, max - 2), 10, publicRoomWeights(0.85), [prefix, 'shelf', 'public']),
    featureRule(`${prefix}_public_lamps`, Feature.LAMP, Math.max(1, min - 1), Math.max(1, max - 3), 12, publicRoomWeights(0.75), [prefix, 'lamp', 'public']),
  ];
}

function routeTags(route: DesignFloorRouteDef): readonly string[] {
  return [route.id, `z_${route.z}`, FloorLevel[route.baseFloor]?.toLowerCase() ?? 'route'];
}

const BASE_FLOOR_OBJECT_PROFILE_LAYERS: Record<FloorLevel, Partial<FloorObjectPlacementProfile>> = {
  [FloorLevel.MINISTRY]: {
    tags: ['base_floor', 'ministry', 'bureaucratic'],
    density: { features: 46, brokenFixtures: 6, wallDecor: 34, screens: 6, maxPerRoom: 2 },
    roomTextureRules: [
      roomTextureRule('ministry_office_paper_bias', 6, 26, 5, {
        [RoomType.OFFICE]: 1.25,
        [RoomType.COMMON]: 0.8,
        [RoomType.STORAGE]: 0.55,
      }, { wallTex: Tex.MARBLE, floorTex: Tex.F_PARQUET }, ['ministry', 'office', 'paper']),
    ],
    featureRules: [
      featureRule('ministry_desks', Feature.DESK, 5, 18, 7, { [RoomType.OFFICE]: 1.4, [RoomType.COMMON]: 0.45, [RoomType.HQ]: 0.8 }, ['ministry', 'desk']),
      featureRule('ministry_waiting_chairs', Feature.CHAIR, 6, 20, 6, { [RoomType.COMMON]: 1.25, [RoomType.OFFICE]: 0.65, [RoomType.MEDICAL]: 0.45 }, ['ministry', 'queue', 'chair']),
      featureRule('ministry_archive_shelves', Feature.SHELF, 4, 16, 8, { [RoomType.STORAGE]: 1.3, [RoomType.OFFICE]: 0.95, [RoomType.HQ]: 0.65 }, ['ministry', 'archive', 'shelf']),
    ],
    wallDecorRules: [
      wallDecorRule('ministry_portraits', 'portrait', Tex.PORTRAIT_BASE, 5, 18, 6, { [RoomType.OFFICE]: 1.25, [RoomType.COMMON]: 0.85, [RoomType.HQ]: 0.65 }, ['ministry', 'portrait'], { variantCount: 64 }),
      wallDecorRule('ministry_queue_signs', 'sign', Tex.POSTER_BASE, 3, 12, 8, { [RoomType.COMMON]: 1.2, [RoomType.OFFICE]: 0.75, [RoomType.MEDICAL]: 0.55 }, ['ministry', 'queue', 'sign'], { variantCount: 16, variantOffset: 0 }),
    ],
    brokenFixtures: [sanitaryBrokenFixtures('ministry_sanitary_decay', 0.03, 6)],
  },
  [FloorLevel.KVARTIRY]: {
    tags: ['base_floor', 'kvartiry', 'residential'],
    density: { features: 52, brokenFixtures: 14, wallDecor: 28, screens: 4, maxPerRoom: 2 },
    roomTextureRules: [
      roomTextureRule('kvartiry_kitchen_bath_decay', 8, 28, 5, {
        [RoomType.KITCHEN]: 1.2,
        [RoomType.BATHROOM]: 1.15,
        [RoomType.COMMON]: 0.45,
      }, { wallTex: Tex.TILE_W, floorTex: Tex.F_TILE }, ['kvartiry', 'wet', 'decay']),
    ],
    featureRules: [
      featureRule('kvartiry_household_tables', Feature.TABLE, 8, 22, 7, householdWeights(), ['kvartiry', 'household', 'table']),
      featureRule('kvartiry_household_shelves', Feature.SHELF, 6, 18, 8, householdWeights(0.85), ['kvartiry', 'household', 'shelf']),
      featureRule('kvartiry_corridor_lamps', Feature.LAMP, 4, 13, 11, { [RoomType.COMMON]: 1.0, [RoomType.SMOKING]: 0.65, [RoomType.KITCHEN]: 0.45 }, ['kvartiry', 'lamp']),
    ],
    wallDecorRules: [
      wallDecorRule('kvartiry_worn_posters', 'poster', Tex.POSTER_BASE, 4, 18, 7, householdWeights(), ['kvartiry', 'poster', 'worn'], { variantCount: 64 }),
      wallDecorRule('kvartiry_ration_signs', 'sign', Tex.POSTER_BASE, 2, 8, 11, { [RoomType.COMMON]: 1.0, [RoomType.KITCHEN]: 0.75, [RoomType.SMOKING]: 0.55 }, ['kvartiry', 'ration', 'sign'], { variantCount: 16, variantOffset: 8 }),
    ],
    brokenFixtures: [sanitaryBrokenFixtures('kvartiry_sanitary_decay', 0.055, 14)],
  },
  [FloorLevel.LIVING]: {
    tags: ['base_floor', 'living', 'residential', 'public'],
    density: { features: 42, brokenFixtures: 8, wallDecor: 24, screens: 6, maxPerRoom: 2 },
    roomTextureRules: [
      roomTextureRule('living_public_linoleum_bias', 6, 24, 7, publicRoomWeights(), { wallTex: Tex.PANEL, floorTex: Tex.F_LINO }, ['living', 'public', 'linoleum']),
    ],
    featureRules: [
      ...publicFurnitureRules('living', 4, 16),
      featureRule('living_public_desks', Feature.DESK, 2, 8, 14, { [RoomType.OFFICE]: 1.0, [RoomType.MEDICAL]: 0.85, [RoomType.PRODUCTION]: 0.55 }, ['living', 'desk']),
    ],
    wallDecorRules: [
      wallDecorRule('living_public_posters', 'poster', Tex.POSTER_BASE, 3, 14, 8, publicRoomWeights(), ['living', 'poster', 'public'], { variantCount: 64 }),
      wallDecorRule('living_public_screens', 'screen', Tex.SCREEN_BASE, 1, 6, 12, { [RoomType.COMMON]: 1.0, [RoomType.MEDICAL]: 0.8, [RoomType.PRODUCTION]: 0.7 }, ['living', 'screen', 'warning'], { variantCount: 8 }),
    ],
  },
  [FloorLevel.MAINTENANCE]: {
    tags: ['base_floor', 'maintenance', 'collectors'],
    density: { features: 54, brokenFixtures: 5, wallDecor: 22, screens: 10, maxPerRoom: 2 },
    roomTextureRules: [
      roomTextureRule('maintenance_pipe_wet_bias', 7, 24, 5, {
        [RoomType.PRODUCTION]: 1.15,
        [RoomType.STORAGE]: 0.85,
        [RoomType.BATHROOM]: 0.75,
        [RoomType.MEDICAL]: 0.45,
      }, { wallTex: Tex.PIPE, floorTex: Tex.F_CONCRETE }, ['maintenance', 'pipe', 'wet']),
    ],
    featureRules: [
      ...pumpMachineryRules('collectors', 5, 16),
      featureRule('maintenance_warning_lamps', Feature.LAMP, 3, 11, 12, productionWeights(0.75), ['maintenance', 'lamp', 'warning']),
    ],
    wallDecorRules: [
      wallDecorRule('maintenance_warning_screens', 'screen', Tex.SCREEN_BASE, 2, 9, 8, { [RoomType.PRODUCTION]: 1.2, [RoomType.OFFICE]: 0.75, [RoomType.COMMON]: 0.55 }, ['maintenance', 'screen', 'warning'], { variantCount: 8 }),
      wallDecorRule('maintenance_pipe_signs', 'sign', Tex.POSTER_BASE, 2, 9, 10, { [RoomType.PRODUCTION]: 1.0, [RoomType.STORAGE]: 0.8, [RoomType.COMMON]: 0.45 }, ['maintenance', 'sign', 'pipe'], { variantCount: 16, variantOffset: 16 }),
    ],
    brokenFixtures: [sanitaryBrokenFixtures('collectors_sanitary_decay', 0.045, 5)],
  },
  [FloorLevel.HELL]: {
    tags: ['base_floor', 'hell', 'meat_low'],
    density: { features: 28, brokenFixtures: 2, wallDecor: 14, screens: 2, maxPerRoom: 1 },
    roomTextureRules: [
      roomTextureRule('hell_meaningful_gut_rooms', 2, 10, 9, {
        [RoomType.PRODUCTION]: 1.0,
        [RoomType.HQ]: 0.85,
        [RoomType.STORAGE]: 0.5,
        [RoomType.MEDICAL]: 0.45,
      }, { wallTex: Tex.GUT, floorTex: Tex.F_GUT }, ['hell', 'gut', 'meaningful']),
    ],
    featureRules: [
      featureRule('hell_work_candles', Feature.CANDLE, 3, 12, 9, { [RoomType.PRODUCTION]: 1.0, [RoomType.HQ]: 0.85, [RoomType.MEDICAL]: 0.6, [RoomType.STORAGE]: 0.45 }, ['hell', 'candle']),
      featureRule('hell_flesh_apparatus', Feature.APPARATUS, 1, 7, 12, { [RoomType.PRODUCTION]: 1.1, [RoomType.MEDICAL]: 0.75, [RoomType.HQ]: 0.55 }, ['hell', 'apparatus']),
    ],
    wallDecorRules: [
      wallDecorRule('hell_ritual_posters', 'poster', Tex.POSTER_BASE, 2, 10, 11, { [RoomType.HQ]: 1.0, [RoomType.PRODUCTION]: 0.8, [RoomType.MEDICAL]: 0.55 }, ['hell', 'ritual', 'poster'], { variantCount: 16, variantOffset: 32 }),
    ],
  },
  [FloorLevel.VOID]: {
    tags: ['base_floor', 'void', 'protocol'],
    density: { features: 16, brokenFixtures: 0, wallDecor: 12, screens: 6, maxPerRoom: 1 },
    roomTextureRules: [
      roomTextureRule('void_dry_protocol_rooms', 3, 14, 8, {
        [RoomType.OFFICE]: 1.0,
        [RoomType.HQ]: 0.85,
        [RoomType.COMMON]: 0.5,
        [RoomType.PRODUCTION]: 0.45,
      }, { wallTex: Tex.VOID_WALL, floorTex: Tex.F_VOID }, ['void', 'protocol', 'dry']),
    ],
    featureRules: [
      featureRule('void_sparse_apparatus', Feature.APPARATUS, 1, 6, 12, { [RoomType.OFFICE]: 1.0, [RoomType.HQ]: 0.8, [RoomType.PRODUCTION]: 0.55 }, ['void', 'apparatus']),
    ],
    wallDecorRules: [
      wallDecorRule('void_protocol_screens', 'screen', Tex.SCREEN_BASE, 1, 6, 9, { [RoomType.OFFICE]: 1.0, [RoomType.HQ]: 0.8, [RoomType.COMMON]: 0.45 }, ['void', 'screen', 'protocol'], { variantCount: 8 }),
      wallDecorRule('void_proof_signs', 'sign', Tex.POSTER_BASE, 1, 6, 12, { [RoomType.OFFICE]: 1.0, [RoomType.HQ]: 0.75, [RoomType.COMMON]: 0.4 }, ['void', 'proof', 'sign'], { variantCount: 12, variantOffset: 48 }),
    ],
  },
};

const DESIGN_OBJECT_PROFILE_OVERRIDES: Partial<Record<string, Partial<FloorObjectPlacementProfile>>> = {
  bolnichny_korpus: {
    tags: ['design_floor', 'medical'],
    density: { features: 12, wallDecor: 8, screens: 4, maxPerRoom: 2 },
    roomTextureRules: [
      roomTextureRule('hospital_tile_room_bias', 3, 12, 6, scienceWeights(0.8), { wallTex: Tex.TILE_W, floorTex: Tex.F_TILE }, ['hospital', 'tile', 'medical']),
    ],
    featureRules: [
      {
        id: 'hospital_lab_apparatus',
        kind: 'feature',
        feature: Feature.APPARATUS,
        min: 2,
        max: 7,
        roomDivisor: 5,
        roomTypeWeights: scienceWeights(),
        tags: ['hospital', 'lab', 'apparatus'],
      },
    ],
    wallDecorRules: [
      wallDecorRule('hospital_quarantine_signs', 'sign', Tex.POSTER_BASE, 2, 8, 7, { [RoomType.MEDICAL]: 1.25, [RoomType.OFFICE]: 0.65, [RoomType.COMMON]: 0.45 }, ['hospital', 'quarantine', 'sign'], { variantCount: 16, variantOffset: 16 }),
      wallDecorRule('hospital_protocol_screens', 'screen', Tex.SCREEN_BASE, 1, 4, 9, { [RoomType.MEDICAL]: 1.2, [RoomType.OFFICE]: 0.6 }, ['hospital', 'screen', 'protocol'], { variantCount: 8 }),
    ],
    brokenFixtures: [sanitaryBrokenFixtures('hospital_sanitary_decay', 0.035, 4)],
  },
  slime_nii: {
    tags: ['design_floor', 'slime_nii', 'science'],
    density: { features: 14, wallDecor: 8, screens: 5, maxPerRoom: 2 },
    roomTextureRules: [
      roomTextureRule('slime_nii_wet_lab_bias', 3, 10, 7, scienceWeights(0.9), { wallTex: Tex.TILE_W, floorTex: Tex.F_TILE }, ['slime_nii', 'wet_lab']),
    ],
    featureRules: [
      {
        id: 'slime_nii_sample_apparatus',
        kind: 'feature',
        feature: Feature.APPARATUS,
        min: 3,
        max: 9,
        roomDivisor: 4,
        roomTypeWeights: scienceWeights(1.15),
        tags: ['slime_nii', 'sample', 'apparatus'],
      },
      {
        id: 'slime_nii_protocol_screens',
        kind: 'feature',
        feature: Feature.SCREEN,
        min: 1,
        max: 4,
        roomDivisor: 9,
        roomTypeWeights: {
          [RoomType.MEDICAL]: 1.2,
          [RoomType.OFFICE]: 1.0,
          [RoomType.HQ]: 0.8,
        },
        tags: ['slime_nii', 'screen', 'protocol'],
      },
    ],
    wallDecorRules: [
      wallDecorRule('slime_nii_sample_posters', 'poster', Tex.POSTER_BASE, 2, 7, 8, scienceWeights(0.8), ['slime_nii', 'poster', 'sample'], { variantCount: 16, variantOffset: 40 }),
      wallDecorRule('slime_nii_protocol_wall_screens', 'screen', Tex.SCREEN_BASE, 1, 5, 8, { [RoomType.MEDICAL]: 1.0, [RoomType.OFFICE]: 0.75, [RoomType.HQ]: 0.55 }, ['slime_nii', 'screen', 'protocol'], { variantCount: 8 }),
    ],
    brokenFixtures: [sanitaryBrokenFixtures('slime_nii_sanitary_decay', 0.035, 5)],
  },
  turing_nursery: {
    tags: ['design_floor', 'turing_nursery', 'slime'],
    density: { features: 10, wallDecor: 5, screens: 3, maxPerRoom: 2 },
    featureRules: [
      {
        id: 'turing_basin_apparatus',
        kind: 'feature',
        feature: Feature.APPARATUS,
        min: 2,
        max: 6,
        roomDivisor: 5,
        roomTypeWeights: scienceWeights(),
        tags: ['turing_nursery', 'basin', 'apparatus'],
      },
    ],
    wallDecorRules: [
      wallDecorRule('turing_nursery_protocol_screens', 'screen', Tex.SCREEN_BASE, 1, 3, 10, scienceWeights(0.6), ['turing_nursery', 'screen'], { variantCount: 8 }),
    ],
  },
  production_belt: {
    tags: ['design_floor', 'production_belt', 'industrial'],
    density: { features: 26, wallDecor: 12, screens: 6, maxPerRoom: 2 },
    featureRules: [
      ...pumpMachineryRules('production_belt', 8, 24),
      {
        id: 'production_status_screens',
        kind: 'feature',
        feature: Feature.SCREEN,
        min: 1,
        max: 5,
        roomDivisor: 8,
        roomTypeWeights: {
          [RoomType.PRODUCTION]: 1.1,
          [RoomType.HQ]: 1.0,
          [RoomType.OFFICE]: 0.9,
        },
        tags: ['production_belt', 'screen', 'status'],
      },
    ],
    wallDecorRules: [
      wallDecorRule('production_belt_warning_screens', 'screen', Tex.SCREEN_BASE, 1, 6, 8, productionWeights(0.9), ['production_belt', 'warning', 'screen'], { variantCount: 8 }),
      wallDecorRule('production_belt_shift_signs', 'sign', Tex.POSTER_BASE, 2, 8, 10, productionWeights(0.7), ['production_belt', 'shift', 'sign'], { variantCount: 16, variantOffset: 16 }),
    ],
  },
  service_floor: {
    tags: ['design_floor', 'service_floor', 'repair'],
    density: { features: 20, wallDecor: 10, screens: 5, maxPerRoom: 2 },
    featureRules: pumpMachineryRules('service_floor', 6, 18),
    wallDecorRules: [
      wallDecorRule('service_floor_warning_screens', 'screen', Tex.SCREEN_BASE, 1, 5, 8, productionWeights(0.75), ['service_floor', 'warning', 'screen'], { variantCount: 8 }),
    ],
    brokenFixtures: [sanitaryBrokenFixtures('service_floor_sanitary_decay', 0.05, 6)],
  },
  silicon_net_well: {
    tags: ['design_floor', 'silicon_net_well', 'net'],
    density: { features: 9, wallDecor: 9, screens: 7, maxPerRoom: 2 },
    featureRules: [
      {
        id: 'silicon_net_screens',
        kind: 'feature',
        feature: Feature.SCREEN,
        min: 2,
        max: 6,
        roomDivisor: 6,
        roomTypeWeights: {
          [RoomType.PRODUCTION]: 1.0,
          [RoomType.MEDICAL]: 0.9,
          [RoomType.HQ]: 0.8,
        },
        tags: ['silicon_net_well', 'screen', 'net'],
      },
    ],
    wallDecorRules: [
      wallDecorRule('silicon_net_wall_screens', 'screen', Tex.SCREEN_BASE, 2, 7, 7, { [RoomType.PRODUCTION]: 1.0, [RoomType.MEDICAL]: 0.8, [RoomType.HQ]: 0.7, [RoomType.OFFICE]: 0.55 }, ['silicon_net_well', 'net', 'screen'], { variantCount: 8 }),
    ],
  },
};

const PROCEDURAL_GEOMETRY_OBJECT_PROFILE_OVERRIDES: Partial<Record<string, Partial<FloorObjectPlacementProfile>>> = {
  collectors: {
    tags: ['procedural_floor', 'collectors'],
    density: { features: 14, brokenFixtures: 4, wallDecor: 8, screens: 4, maxPerRoom: 2 },
    featureRules: pumpMachineryRules('procedural_collectors', 4, 13),
    wallDecorRules: [
      wallDecorRule('procedural_collectors_warning_screens', 'screen', Tex.SCREEN_BASE, 1, 4, 10, productionWeights(0.7), ['procedural_collectors', 'warning', 'screen'], { variantCount: 8 }),
    ],
    brokenFixtures: [sanitaryBrokenFixtures('procedural_collectors_sanitary_decay', 0.045, 4)],
  },
  workshops: {
    tags: ['procedural_floor', 'workshops'],
    density: { features: 20, wallDecor: 8, screens: 4, maxPerRoom: 2 },
    featureRules: pumpMachineryRules('procedural_workshops', 7, 20),
    wallDecorRules: [
      wallDecorRule('procedural_workshop_shift_signs', 'sign', Tex.POSTER_BASE, 1, 6, 12, productionWeights(0.65), ['procedural_workshops', 'shift', 'sign'], { variantCount: 16, variantOffset: 16 }),
    ],
  },
  service_spines: {
    tags: ['procedural_floor', 'service_spines'],
    density: { features: 16, brokenFixtures: 4, wallDecor: 8, screens: 5, maxPerRoom: 2 },
    featureRules: pumpMachineryRules('procedural_service_spines', 5, 15),
    wallDecorRules: [
      wallDecorRule('procedural_service_warning_screens', 'screen', Tex.SCREEN_BASE, 1, 5, 9, productionWeights(0.65), ['procedural_service_spines', 'warning', 'screen'], { variantCount: 8 }),
    ],
    brokenFixtures: [sanitaryBrokenFixtures('procedural_service_spines_sanitary_decay', 0.04, 4)],
  },
  sump_causeways: {
    tags: ['procedural_floor', 'sump_causeways'],
    density: { features: 10, brokenFixtures: 3, wallDecor: 6, screens: 2, maxPerRoom: 1 },
    roomTextureRules: [
      roomTextureRule('procedural_sump_wet_bias', 2, 9, 8, productionWeights(0.65), { wallTex: Tex.PIPE, floorTex: Tex.F_WATER }, ['procedural_sump_causeways', 'wet']),
    ],
    featureRules: pumpMachineryRules('procedural_sump_causeways', 3, 9),
    brokenFixtures: [sanitaryBrokenFixtures('procedural_sump_sanitary_decay', 0.035, 3)],
  },
  apartment_pressure: {
    tags: ['procedural_floor', 'apartment_pressure'],
    density: { brokenFixtures: 9, wallDecor: 10, screens: 2, maxPerRoom: 1 },
    wallDecorRules: [
      wallDecorRule('procedural_apartment_pressure_posters', 'poster', Tex.POSTER_BASE, 1, 8, 16, householdWeights(0.55), ['procedural_apartment_pressure', 'poster'], { variantCount: 64 }),
    ],
    brokenFixtures: [sanitaryBrokenFixtures('procedural_apartment_sanitary_decay', 0.055, 9)],
  },
  communal_knots: {
    tags: ['procedural_floor', 'communal_knots'],
    density: { brokenFixtures: 8, wallDecor: 12, screens: 2, maxPerRoom: 2 },
    featureRules: [
      featureRule('procedural_communal_tables', Feature.TABLE, 3, 10, 10, householdWeights(0.8), ['procedural_communal_knots', 'table']),
    ],
    wallDecorRules: [
      wallDecorRule('procedural_communal_ration_signs', 'sign', Tex.POSTER_BASE, 1, 8, 12, householdWeights(0.6), ['procedural_communal_knots', 'ration', 'sign'], { variantCount: 16, variantOffset: 8 }),
    ],
    brokenFixtures: [sanitaryBrokenFixtures('procedural_communal_sanitary_decay', 0.05, 8)],
  },
  living_blocks: {
    tags: ['procedural_floor', 'living_blocks'],
    density: { brokenFixtures: 7, wallDecor: 10, screens: 2, maxPerRoom: 1 },
    featureRules: [
      featureRule('procedural_living_block_shelves', Feature.SHELF, 2, 9, 12, householdWeights(0.6), ['procedural_living_blocks', 'shelf']),
    ],
    wallDecorRules: [
      wallDecorRule('procedural_living_block_posters', 'poster', Tex.POSTER_BASE, 1, 8, 14, householdWeights(0.55), ['procedural_living_blocks', 'poster'], { variantCount: 64 }),
    ],
    brokenFixtures: [sanitaryBrokenFixtures('procedural_living_sanitary_decay', 0.04, 7)],
  },
};

const PROCEDURAL_MAJORITY_OBJECT_PROFILE_OVERRIDES: Partial<Record<string, Partial<FloorObjectPlacementProfile>>> = {
  citizens: {
    tags: ['majority_citizens', 'civil'],
    density: { features: 8, wallDecor: 8, screens: 2, maxPerRoom: 1 },
    featureRules: [
      featureRule('majority_citizen_household_clutter', Feature.TABLE, 1, 7, 18, householdWeights(0.45), ['majority_citizens', 'household']),
    ],
    wallDecorRules: [
      wallDecorRule('majority_citizen_water_ration_signs', 'sign', Tex.POSTER_BASE, 1, 7, 16, { [RoomType.COMMON]: 1.0, [RoomType.KITCHEN]: 0.8, [RoomType.MEDICAL]: 0.45 }, ['majority_citizens', 'water', 'ration'], { variantCount: 16, variantOffset: 8 }),
    ],
  },
  liquidators: {
    tags: ['majority_liquidators', 'service', 'armed'],
    density: { features: 10, wallDecor: 8, screens: 4, maxPerRoom: 1 },
    featureRules: [
      featureRule('majority_liquidator_metal_cabinets', Feature.SHELF, 1, 8, 14, { [RoomType.STORAGE]: 1.1, [RoomType.OFFICE]: 0.75, [RoomType.HQ]: 0.65, [RoomType.PRODUCTION]: 0.55 }, ['majority_liquidators', 'cabinet']),
    ],
    wallDecorRules: [
      wallDecorRule('majority_liquidator_warning_screens', 'screen', Tex.SCREEN_BASE, 1, 4, 13, { [RoomType.HQ]: 1.0, [RoomType.PRODUCTION]: 0.85, [RoomType.OFFICE]: 0.55 }, ['majority_liquidators', 'warning', 'screen'], { variantCount: 8 }),
    ],
  },
  scientists: {
    tags: ['majority_scientists', 'lab'],
    density: { features: 10, wallDecor: 8, screens: 4, maxPerRoom: 1 },
    featureRules: [
      featureRule('majority_scientist_lab_apparatus', Feature.APPARATUS, 1, 8, 14, scienceWeights(0.6), ['majority_scientists', 'apparatus']),
    ],
    wallDecorRules: [
      wallDecorRule('majority_scientist_protocol_screens', 'screen', Tex.SCREEN_BASE, 1, 4, 13, scienceWeights(0.55), ['majority_scientists', 'protocol', 'screen'], { variantCount: 8 }),
    ],
  },
  cultists: {
    tags: ['majority_cultists', 'cult'],
    density: { features: 8, wallDecor: 8, screens: 1, maxPerRoom: 1 },
    featureRules: [
      featureRule('majority_cultist_candles', Feature.CANDLE, 1, 8, 13, { [RoomType.HQ]: 1.0, [RoomType.COMMON]: 0.7, [RoomType.PRODUCTION]: 0.55, [RoomType.STORAGE]: 0.45 }, ['majority_cultists', 'candle']),
    ],
    wallDecorRules: [
      wallDecorRule('majority_cultist_false_shelter_posters', 'poster', Tex.POSTER_BASE, 1, 7, 15, { [RoomType.HQ]: 1.0, [RoomType.COMMON]: 0.65, [RoomType.STORAGE]: 0.45 }, ['majority_cultists', 'false_shelter'], { variantCount: 16, variantOffset: 32 }),
    ],
  },
  wild: {
    tags: ['majority_wild', 'looted'],
    density: { brokenFixtures: 5, wallDecor: 6, screens: 1, maxPerRoom: 1 },
    roomTextureRules: [
      roomTextureRule('majority_wild_dirty_room_bias', 2, 8, 18, { [RoomType.STORAGE]: 1.0, [RoomType.COMMON]: 0.65, [RoomType.SMOKING]: 0.6, [RoomType.KITCHEN]: 0.45 }, { wallTex: Tex.ROTTEN, floorTex: Tex.F_CONCRETE }, ['majority_wild', 'dirty']),
    ],
    brokenFixtures: [sanitaryBrokenFixtures('majority_wild_sanitary_decay', 0.03, 5)],
  },
};

const PROCEDURAL_ANOMALY_OBJECT_PROFILE_OVERRIDES: Partial<Record<string, Partial<FloorObjectPlacementProfile>>> = {
  smog: {
    tags: ['anomaly_smog'],
    density: { wallDecor: 5, screens: 2, maxPerRoom: 1 },
    wallDecorRules: [
      wallDecorRule('anomaly_smog_warning_signs', 'sign', Tex.POSTER_BASE, 1, 5, 18, { [RoomType.COMMON]: 1.0, [RoomType.PRODUCTION]: 0.85, [RoomType.OFFICE]: 0.55 }, ['anomaly_smog', 'warning'], { variantCount: 16, variantOffset: 16 }),
    ],
  },
  mushroom_mycelium: {
    tags: ['anomaly_mushroom', 'wet'],
    density: { wallDecor: 4, maxPerRoom: 1 },
    roomTextureRules: [
      roomTextureRule('anomaly_mushroom_wet_room_bias', 1, 6, 20, { [RoomType.STORAGE]: 1.0, [RoomType.KITCHEN]: 0.8, [RoomType.MEDICAL]: 0.55, [RoomType.PRODUCTION]: 0.45 }, { wallTex: Tex.ROTTEN, floorTex: Tex.F_WATER }, ['anomaly_mushroom', 'wet']),
    ],
  },
  false_safe_block: {
    tags: ['anomaly_false_safe_block', 'black_hand'],
    density: { wallDecor: 5, maxPerRoom: 1 },
    wallDecorRules: [
      wallDecorRule('anomaly_false_safe_black_hand_cues', 'poster', Tex.POSTER_BASE, 1, 5, 18, { [RoomType.COMMON]: 1.0, [RoomType.LIVING]: 0.7, [RoomType.OFFICE]: 0.55, [RoomType.STORAGE]: 0.45 }, ['anomaly_false_safe_block', 'black_hand'], { variantCount: 16, variantOffset: 32 }),
    ],
  },
  rail_trains: {
    tags: ['anomaly_rail'],
    density: { wallDecor: 6, screens: 2, maxPerRoom: 1 },
    wallDecorRules: [
      wallDecorRule('anomaly_rail_platform_signs', 'sign', Tex.POSTER_BASE, 1, 6, 16, { [RoomType.COMMON]: 1.0, [RoomType.PRODUCTION]: 0.7, [RoomType.STORAGE]: 0.45 }, ['anomaly_rail', 'sign'], { variantCount: 16, variantOffset: 16 }),
    ],
  },
  zombie_apocalypse: {
    tags: ['anomaly_zombie', 'quarantine'],
    density: { wallDecor: 7, screens: 2, maxPerRoom: 1 },
    wallDecorRules: [
      wallDecorRule('anomaly_zombie_quarantine_signs', 'sign', Tex.POSTER_BASE, 1, 7, 15, { [RoomType.MEDICAL]: 1.1, [RoomType.COMMON]: 0.9, [RoomType.OFFICE]: 0.5 }, ['anomaly_zombie', 'quarantine'], { variantCount: 16, variantOffset: 16 }),
    ],
  },
  samosbor_seed: {
    tags: ['anomaly_samosbor_seed'],
    density: { wallDecor: 4, screens: 1, maxPerRoom: 1 },
    roomTextureRules: [
      roomTextureRule('anomaly_samosbor_gut_room_bias', 1, 5, 22, { [RoomType.PRODUCTION]: 0.8, [RoomType.STORAGE]: 0.65, [RoomType.HQ]: 0.55 }, { wallTex: Tex.GUT, floorTex: Tex.F_GUT }, ['anomaly_samosbor_seed', 'gut']),
    ],
  },
};

function dangerDepthObjectProfileLayer(spec: ProceduralFloorSpec): Partial<FloorObjectPlacementProfile> | undefined {
  const depth = Math.abs(spec.z);
  if (spec.danger < 3 && depth < 30) return undefined;
  const warningMax = spec.danger >= 5 || depth >= 45 ? 5 : spec.danger >= 4 || depth >= 35 ? 3 : 2;
  return {
    tags: ['danger_depth_bias', `danger_${spec.danger}`],
    density: { wallDecor: warningMax, screens: spec.danger >= 4 ? 1 : 0, maxPerRoom: 1 },
    wallDecorRules: [
      wallDecorRule('danger_depth_warning_signs', 'sign', Tex.POSTER_BASE, 1, warningMax, 22, {
        [RoomType.COMMON]: 1.0,
        [RoomType.OFFICE]: 0.65,
        [RoomType.PRODUCTION]: 0.6,
        [RoomType.MEDICAL]: 0.45,
      }, ['danger_depth', 'warning'], { variantCount: 16, variantOffset: 16 }),
    ],
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function addDensity(
  a: FloorObjectPlacementDensity | undefined,
  b: FloorObjectPlacementDensity | undefined,
): FloorObjectPlacementDensity | undefined {
  if (!a) return b ? { ...b } : undefined;
  if (!b) return { ...a };
  return {
    features: (a.features ?? 0) + (b.features ?? 0) || undefined,
    interactives: (a.interactives ?? 0) + (b.interactives ?? 0) || undefined,
    brokenFixtures: (a.brokenFixtures ?? 0) + (b.brokenFixtures ?? 0) || undefined,
    wallDecor: (a.wallDecor ?? 0) + (b.wallDecor ?? 0) || undefined,
    screens: (a.screens ?? 0) + (b.screens ?? 0) || undefined,
    maxPerRoom: Math.max(a.maxPerRoom ?? 0, b.maxPerRoom ?? 0) || undefined,
  };
}

function profileLayerHasContent(layer: Partial<FloorObjectPlacementProfile> | undefined): layer is Partial<FloorObjectPlacementProfile> {
  return !!layer && (
    !!layer.density ||
    !!layer.roomTextureRules?.length ||
    !!layer.wallDecorRules?.length ||
    !!layer.featureRules?.length ||
    !!layer.interactiveRules?.length ||
    !!layer.brokenFixtures?.length
  );
}

function composeProfile(
  id: string,
  tags: readonly string[],
  craftStations: CraftStationPlacementProfile | undefined,
  layers: readonly (Partial<FloorObjectPlacementProfile> | undefined)[],
): FloorObjectPlacementProfile | undefined {
  const activeLayers = layers.filter(profileLayerHasContent);
  if (!craftStations && activeLayers.length === 0) return undefined;
  let density: FloorObjectPlacementDensity | undefined;
  const profileTags: string[] = [...tags];
  const roomTextureRules: RoomTextureRule[] = [];
  const wallDecorRules: WallDecorPlacementRule[] = [];
  const featureRules: FeaturePlacementRule[] = [];
  const interactiveRules: InteractivePlacementRule[] = [];
  const brokenFixtures: BrokenFixturePlacementRule[] = [];

  for (const layer of activeLayers) {
    profileTags.push(...(layer.tags ?? []));
    density = addDensity(density, layer.density);
    roomTextureRules.push(...(layer.roomTextureRules ?? []));
    wallDecorRules.push(...(layer.wallDecorRules ?? []));
    featureRules.push(...(layer.featureRules ?? []));
    interactiveRules.push(...(layer.interactiveRules ?? []));
    brokenFixtures.push(...(layer.brokenFixtures ?? []));
  }

  return {
    id,
    tags: uniqueStrings(profileTags),
    density,
    roomTextureRules: roomTextureRules.length > 0 ? roomTextureRules : undefined,
    wallDecorRules: wallDecorRules.length > 0 ? wallDecorRules : undefined,
    featureRules: featureRules.length > 0 ? featureRules : undefined,
    interactiveRules: interactiveRules.length > 0 ? interactiveRules : undefined,
    brokenFixtures: brokenFixtures.length > 0 ? brokenFixtures : undefined,
    craftStations,
  };
}

export function floorObjectProfileDuplicateRuleIds(profile: FloorObjectPlacementProfile): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const add = (rules: readonly { id: string }[] | undefined): void => {
    for (const rule of rules ?? []) {
      if (seen.has(rule.id)) duplicates.add(rule.id);
      else seen.add(rule.id);
    }
  };
  add(profile.roomTextureRules);
  add(profile.wallDecorRules);
  add(profile.featureRules);
  add(profile.interactiveRules);
  add(profile.brokenFixtures);
  return [...duplicates].sort();
}

export function floorObjectProfileForStoryFloor(floor: FloorLevel): FloorObjectPlacementProfile | undefined {
  return composeProfile(
    `story_${FloorLevel[floor]?.toLowerCase() ?? floor}_objects`,
    ['story_floor', FloorLevel[floor]?.toLowerCase() ?? 'story'],
    craftStationProfileForStoryFloor(floor),
    [BASE_FLOOR_OBJECT_PROFILE_LAYERS[floor]],
  );
}

export function floorObjectProfileForDesignFloor(route: DesignFloorRouteDef): FloorObjectPlacementProfile | undefined {
  return composeProfile(
    `design_${route.id}_objects`,
    ['design_floor', ...routeTags(route)],
    craftStationProfileForDesignFloor(route),
    [
      BASE_FLOOR_OBJECT_PROFILE_LAYERS[route.baseFloor],
      DESIGN_OBJECT_PROFILE_OVERRIDES[route.id],
    ],
  );
}

export function floorObjectProfileForProceduralFloor(spec: ProceduralFloorSpec): FloorObjectPlacementProfile | undefined {
  return composeProfile(
    `procedural_${spec.geometryId}_objects`,
    ['procedural_floor', spec.geometryId, spec.majorityId, spec.anomalyId],
    craftStationProfileForProceduralFloor(spec),
    [
      BASE_FLOOR_OBJECT_PROFILE_LAYERS[spec.baseFloor],
      PROCEDURAL_GEOMETRY_OBJECT_PROFILE_OVERRIDES[spec.geometryId],
      PROCEDURAL_MAJORITY_OBJECT_PROFILE_OVERRIDES[spec.majorityId],
      PROCEDURAL_ANOMALY_OBJECT_PROFILE_OVERRIDES[spec.anomalyId],
      dangerDepthObjectProfileLayer(spec),
    ],
  );
}
