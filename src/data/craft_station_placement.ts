import { FloorLevel, RoomType } from '../core/types';
import type { DesignFloorRouteDef } from './design_floors';
import type { ProceduralFloorSpec } from './procedural_floors';

export const CRAFT_LATHE_ID = 'craft_lathe';
export const DISASSEMBLY_WORKBENCH_ID = 'disassembly_workbench';
export const CRAFT_LAB_BENCH_ID = 'craft_lab_bench';
export const RECIPE_BILLBOARD_ID = 'recipe_billboard';

export const CRAFT_STATION_IDS = [
  CRAFT_LATHE_ID,
  DISASSEMBLY_WORKBENCH_ID,
  CRAFT_LAB_BENCH_ID,
  RECIPE_BILLBOARD_ID,
] as const;

export type CraftStationDefId = typeof CRAFT_STATION_IDS[number];

export const CRAFT_STATION_CAPS = {
  livingFixed: 2,
  storyMin: 1,
  storyMax: 4,
  maintenanceMin: 2,
  maintenanceMax: 6,
  proceduralMin: 0,
  proceduralMax: 4,
  story: { min: 1, max: 4 },
  maintenance: { min: 2, max: 6 },
  procedural: { min: 0, max: 4 },
  design: { min: 0, max: 7 },
} as const;

export interface CraftStationPlacementProfile {
  id: string;
  min: number;
  max: number;
  roomDivisor: number;
  stationWeights: Partial<Record<CraftStationDefId, number>>;
  requiredById?: Partial<Record<CraftStationDefId, number>>;
  roomTypeWeights?: Partial<Record<RoomType, number>>;
  tags?: readonly string[];
}

function cloneProfile(profile: CraftStationPlacementProfile): CraftStationPlacementProfile {
  return {
    ...profile,
    stationWeights: { ...profile.stationWeights },
    requiredById: profile.requiredById ? { ...profile.requiredById } : undefined,
    roomTypeWeights: profile.roomTypeWeights ? { ...profile.roomTypeWeights } : undefined,
    tags: profile.tags ? [...profile.tags] : undefined,
  };
}

function mergeProfiles(
  base: CraftStationPlacementProfile,
  extra: Partial<CraftStationPlacementProfile>,
): CraftStationPlacementProfile {
  return {
    ...base,
    ...extra,
    stationWeights: {
      ...base.stationWeights,
      ...extra.stationWeights,
    },
    requiredById: {
      ...(base.requiredById ?? {}),
      ...(extra.requiredById ?? {}),
    },
    roomTypeWeights: {
      ...(base.roomTypeWeights ?? {}),
      ...(extra.roomTypeWeights ?? {}),
    },
    tags: [...(base.tags ?? []), ...(extra.tags ?? [])],
  };
}

const STORY_FLOOR_CRAFT_STATION_PROFILES: Partial<Record<FloorLevel, CraftStationPlacementProfile>> = {
  [FloorLevel.MINISTRY]: {
    id: 'story_ministry',
    min: CRAFT_STATION_CAPS.story.min,
    max: CRAFT_STATION_CAPS.story.max,
    roomDivisor: 12,
    stationWeights: {
      [DISASSEMBLY_WORKBENCH_ID]: 1.1,
      [CRAFT_LATHE_ID]: 0.35,
      [CRAFT_LAB_BENCH_ID]: 0.75,
      [RECIPE_BILLBOARD_ID]: 1.25,
    },
    tags: ['story_floor', 'ministry'],
  },
  [FloorLevel.KVARTIRY]: {
    id: 'story_kvartiry',
    min: CRAFT_STATION_CAPS.story.min,
    max: CRAFT_STATION_CAPS.story.max,
    roomDivisor: 12,
    stationWeights: {
      [DISASSEMBLY_WORKBENCH_ID]: 1.25,
      [CRAFT_LATHE_ID]: 0.55,
      [CRAFT_LAB_BENCH_ID]: 0.45,
      [RECIPE_BILLBOARD_ID]: 0.8,
    },
    tags: ['story_floor', 'kvartiry'],
  },
  [FloorLevel.MAINTENANCE]: {
    id: 'story_maintenance_collectors',
    min: CRAFT_STATION_CAPS.maintenance.min,
    max: CRAFT_STATION_CAPS.maintenance.max,
    roomDivisor: 7,
    stationWeights: {
      [CRAFT_LATHE_ID]: 1.35,
      [DISASSEMBLY_WORKBENCH_ID]: 1.35,
      [RECIPE_BILLBOARD_ID]: 0.35,
    },
    requiredById: {
      [CRAFT_LATHE_ID]: 1,
      [DISASSEMBLY_WORKBENCH_ID]: 1,
    },
    roomTypeWeights: {
      [RoomType.PRODUCTION]: 1.25,
      [RoomType.STORAGE]: 1.15,
      [RoomType.HQ]: 0.85,
    },
    tags: ['story_floor', 'maintenance', 'collectors'],
  },
};

const DESIGN_FLOOR_CRAFT_STATION_PROFILES: Partial<Record<string, CraftStationPlacementProfile>> = {
  bolnichny_korpus: {
    id: 'design_bolnichny_korpus',
    min: 2,
    max: 4,
    roomDivisor: 8,
    stationWeights: {
      [CRAFT_LAB_BENCH_ID]: 1.35,
      [DISASSEMBLY_WORKBENCH_ID]: 1.0,
      [RECIPE_BILLBOARD_ID]: 0.75,
    },
    requiredById: {
      [CRAFT_LAB_BENCH_ID]: 1,
    },
    tags: ['design_floor', 'medical'],
  },
  slime_nii: {
    id: 'design_slime_nii',
    min: 3,
    max: 6,
    roomDivisor: 6,
    stationWeights: {
      [CRAFT_LAB_BENCH_ID]: 1.7,
      [DISASSEMBLY_WORKBENCH_ID]: 1.15,
      [CRAFT_LATHE_ID]: 0.8,
      [RECIPE_BILLBOARD_ID]: 1.1,
    },
    requiredById: {
      [CRAFT_LAB_BENCH_ID]: 1,
      [DISASSEMBLY_WORKBENCH_ID]: 1,
      [CRAFT_LATHE_ID]: 1,
    },
    roomTypeWeights: {
      [RoomType.MEDICAL]: 1.45,
      [RoomType.PRODUCTION]: 1.15,
      [RoomType.STORAGE]: 0.9,
    },
    tags: ['design_floor', 'slime_nii', 'science', 'sample'],
  },
  turing_nursery: {
    id: 'design_turing_nursery',
    min: 2,
    max: 4,
    roomDivisor: 7,
    stationWeights: {
      [CRAFT_LAB_BENCH_ID]: 1.4,
      [DISASSEMBLY_WORKBENCH_ID]: 1.0,
      [RECIPE_BILLBOARD_ID]: 0.7,
    },
    requiredById: {
      [CRAFT_LAB_BENCH_ID]: 1,
    },
    tags: ['design_floor', 'slime', 'lab'],
  },
  black_market_88: {
    id: 'design_black_market_88',
    min: 1,
    max: 3,
    roomDivisor: 10,
    stationWeights: {
      [DISASSEMBLY_WORKBENCH_ID]: 1.2,
      [RECIPE_BILLBOARD_ID]: 1.0,
      [CRAFT_LATHE_ID]: 0.35,
    },
    tags: ['design_floor', 'black_market'],
  },
  production_belt: {
    id: 'design_production_belt',
    min: 4,
    max: CRAFT_STATION_CAPS.design.max,
    roomDivisor: 4,
    stationWeights: {
      [CRAFT_LATHE_ID]: 1.6,
      [DISASSEMBLY_WORKBENCH_ID]: 1.6,
      [RECIPE_BILLBOARD_ID]: 0.45,
    },
    requiredById: {
      [CRAFT_LATHE_ID]: 1,
      [DISASSEMBLY_WORKBENCH_ID]: 1,
    },
    roomTypeWeights: {
      [RoomType.PRODUCTION]: 1.5,
      [RoomType.STORAGE]: 1.2,
      [RoomType.HQ]: 0.8,
    },
    tags: ['design_floor', 'production_belt', 'industrial'],
  },
  service_floor: {
    id: 'design_service_floor',
    min: 2,
    max: 4,
    roomDivisor: 7,
    stationWeights: {
      [CRAFT_LATHE_ID]: 1.15,
      [DISASSEMBLY_WORKBENCH_ID]: 1.35,
      [RECIPE_BILLBOARD_ID]: 0.45,
    },
    requiredById: {
      [DISASSEMBLY_WORKBENCH_ID]: 1,
    },
    tags: ['design_floor', 'service_floor', 'repair'],
  },
  silicon_net_well: {
    id: 'design_silicon_net_well',
    min: 1,
    max: 3,
    roomDivisor: 8,
    stationWeights: {
      [DISASSEMBLY_WORKBENCH_ID]: 1.0,
      [RECIPE_BILLBOARD_ID]: 1.3,
      [CRAFT_LAB_BENCH_ID]: 0.6,
    },
    tags: ['design_floor', 'net', 'silicon'],
  },
};

const PROCEDURAL_GEOMETRY_CRAFT_STATION_PROFILES: Partial<Record<string, CraftStationPlacementProfile>> = {
  collectors: {
    id: 'procedural_collectors',
    min: 1,
    max: 3,
    roomDivisor: 8,
    stationWeights: {
      [DISASSEMBLY_WORKBENCH_ID]: 1.35,
      [CRAFT_LATHE_ID]: 0.85,
      [RECIPE_BILLBOARD_ID]: 0.25,
    },
    requiredById: {
      [DISASSEMBLY_WORKBENCH_ID]: 1,
    },
    tags: ['procedural_floor', 'collectors'],
  },
  workshops: {
    id: 'procedural_workshops',
    min: 2,
    max: CRAFT_STATION_CAPS.procedural.max,
    roomDivisor: 4,
    stationWeights: {
      [CRAFT_LATHE_ID]: 1.45,
      [DISASSEMBLY_WORKBENCH_ID]: 1.45,
      [RECIPE_BILLBOARD_ID]: 0.35,
    },
    requiredById: {
      [CRAFT_LATHE_ID]: 1,
      [DISASSEMBLY_WORKBENCH_ID]: 1,
    },
    tags: ['procedural_floor', 'workshops'],
  },
  service_spines: {
    id: 'procedural_service_spines',
    min: 1,
    max: CRAFT_STATION_CAPS.procedural.max,
    roomDivisor: 5,
    stationWeights: {
      [DISASSEMBLY_WORKBENCH_ID]: 1.25,
      [CRAFT_LATHE_ID]: 1.0,
      [RECIPE_BILLBOARD_ID]: 0.45,
    },
    requiredById: {
      [DISASSEMBLY_WORKBENCH_ID]: 1,
    },
    tags: ['procedural_floor', 'service_spines'],
  },
  sump_causeways: {
    id: 'procedural_sump_causeways',
    min: 1,
    max: 2,
    roomDivisor: 8,
    stationWeights: {
      [DISASSEMBLY_WORKBENCH_ID]: 1.0,
      [CRAFT_LATHE_ID]: 0.35,
    },
    tags: ['procedural_floor', 'sump_causeways'],
  },
  archive_warrens: {
    id: 'procedural_archive_warrens',
    min: 1,
    max: 2,
    roomDivisor: 9,
    stationWeights: {
      [RECIPE_BILLBOARD_ID]: 1.25,
      [DISASSEMBLY_WORKBENCH_ID]: 0.65,
      [CRAFT_LAB_BENCH_ID]: 0.45,
    },
    tags: ['procedural_floor', 'archive_warrens'],
  },
  admin_pockets: {
    id: 'procedural_admin_pockets',
    min: 1,
    max: 2,
    roomDivisor: 10,
    stationWeights: {
      [RECIPE_BILLBOARD_ID]: 1.35,
      [CRAFT_LAB_BENCH_ID]: 0.75,
      [DISASSEMBLY_WORKBENCH_ID]: 0.45,
    },
    tags: ['procedural_floor', 'admin_pockets'],
  },
};

const DEFAULT_PROCEDURAL_CRAFT_STATION_PROFILE: CraftStationPlacementProfile = {
  id: 'procedural_default',
  min: CRAFT_STATION_CAPS.procedural.min,
  max: 2,
  roomDivisor: 12,
  stationWeights: {
    [DISASSEMBLY_WORKBENCH_ID]: 1.0,
    [CRAFT_LATHE_ID]: 0.45,
    [CRAFT_LAB_BENCH_ID]: 0.35,
    [RECIPE_BILLBOARD_ID]: 0.45,
  },
  tags: ['procedural_floor', 'default'],
};

export function craftStationProfileForStoryFloor(floor: FloorLevel): CraftStationPlacementProfile | undefined {
  const profile = STORY_FLOOR_CRAFT_STATION_PROFILES[floor];
  return profile ? cloneProfile(profile) : undefined;
}

export function craftStationProfileForDesignFloor(route: DesignFloorRouteDef): CraftStationPlacementProfile | undefined {
  const profile = DESIGN_FLOOR_CRAFT_STATION_PROFILES[route.id];
  if (!profile) return undefined;
  return mergeProfiles(profile, {
    tags: [route.id, `z_${route.z}`, FloorLevel[route.baseFloor]?.toLowerCase() ?? 'route'],
  });
}

export function craftStationProfileForProceduralFloor(spec: ProceduralFloorSpec): CraftStationPlacementProfile | undefined {
  const base = PROCEDURAL_GEOMETRY_CRAFT_STATION_PROFILES[spec.geometryId] ?? DEFAULT_PROCEDURAL_CRAFT_STATION_PROFILE;
  let profile = cloneProfile(base);
  if (spec.majorityId === 'scientists') {
    profile = mergeProfiles(profile, {
      max: Math.min(CRAFT_STATION_CAPS.procedural.max, profile.max + 1),
      stationWeights: {
        [CRAFT_LAB_BENCH_ID]: Math.max(profile.stationWeights[CRAFT_LAB_BENCH_ID] ?? 0, 1.15),
        [RECIPE_BILLBOARD_ID]: Math.max(profile.stationWeights[RECIPE_BILLBOARD_ID] ?? 0, 0.9),
      },
      tags: ['scientists'],
    });
  }
  return mergeProfiles(profile, {
    tags: [spec.geometryId, spec.majorityId, spec.anomalyId],
  });
}
