import { FloorLevel, RoomType, ZoneFaction } from '../core/types';
import { activeActorCountAtDefaultSoftLimit, DEFAULT_ACTIVE_ACTOR_SOFT_LIMIT, fitActiveActorCounts } from './entity_limits';

export interface NpcPopulationProfile {
  /** Authored count at DEFAULT_ACTIVE_ACTOR_SOFT_LIMIT; resolve through activeActorCountAtDefaultSoftLimit(). */
  initial: number;
  noiseScale: number;
  noiseStrength: number;
  openWeight: number;
  roomWeights: Partial<Record<RoomType, number>>;
  zoneWeights: Partial<Record<ZoneFaction, number>>;
  preferredTerritory?: ZoneFaction;
  preferredTerritoryShare?: number;
}

export interface MonsterPopulationProfile {
  /** Authored count at DEFAULT_ACTIVE_ACTOR_SOFT_LIMIT; resolve through activeActorCountAtDefaultSoftLimit(). */
  initial: number;
  noiseScale: number;
  noiseStrength: number;
  openWeight: number;
  roomWeights?: Partial<Record<RoomType, number>>;
  zoneWeights?: Partial<Record<ZoneFaction, number>>;
}

export const KVARTIRY_POPULATION_PROFILE = {
  id: 'kvartiry_lively',
  floor: FloorLevel.KVARTIRY,
  citizens: {
    initial: 2381,
    noiseScale: 96,
    noiseStrength: 0.2,
    openWeight: 0.95,
    roomWeights: {
      [RoomType.LIVING]: 1.75,
      [RoomType.KITCHEN]: 1.65,
      [RoomType.COMMON]: 1.35,
      [RoomType.SMOKING]: 1.2,
      [RoomType.CORRIDOR]: 1.05,
      [RoomType.OFFICE]: 0.95,
      [RoomType.BATHROOM]: 0.85,
      [RoomType.STORAGE]: 0.75,
      [RoomType.HQ]: 0.55,
    },
    zoneWeights: {
      [ZoneFaction.CITIZEN]: 1.45,
      [ZoneFaction.WILD]: 0.62,
      [ZoneFaction.LIQUIDATOR]: 0.58,
      [ZoneFaction.CULTIST]: 0.5,
      [ZoneFaction.SCIENTIST]: 0.72,
    },
    preferredTerritory: ZoneFaction.CITIZEN,
    preferredTerritoryShare: 0.72,
  },
  wild: {
    initial: 1349,
    noiseScale: 72,
    noiseStrength: 0.26,
    openWeight: 1.15,
    roomWeights: {
      [RoomType.CORRIDOR]: 1.65,
      [RoomType.COMMON]: 1.45,
      [RoomType.SMOKING]: 1.4,
      [RoomType.STORAGE]: 1.25,
      [RoomType.KITCHEN]: 1.1,
      [RoomType.LIVING]: 0.95,
      [RoomType.BATHROOM]: 0.8,
      [RoomType.OFFICE]: 0.8,
      [RoomType.HQ]: 0.75,
    },
    zoneWeights: {
      [ZoneFaction.WILD]: 4.6,
      [ZoneFaction.CITIZEN]: 0.58,
      [ZoneFaction.CULTIST]: 1.65,
      [ZoneFaction.LIQUIDATOR]: 0.95,
      [ZoneFaction.SCIENTIST]: 0.82,
    },
    preferredTerritory: ZoneFaction.WILD,
    preferredTerritoryShare: 0.38,
  },
  liquidators: {
    initial: 238,
    noiseScale: 128,
    noiseStrength: 0.18,
    openWeight: 1.1,
    roomWeights: {
      [RoomType.HQ]: 2.6,
      [RoomType.CORRIDOR]: 1.55,
      [RoomType.COMMON]: 1.35,
      [RoomType.OFFICE]: 1.3,
      [RoomType.STORAGE]: 1.1,
      [RoomType.KITCHEN]: 0.85,
      [RoomType.SMOKING]: 0.75,
      [RoomType.BATHROOM]: 0.65,
      [RoomType.LIVING]: 0.55,
    },
    zoneWeights: {
      [ZoneFaction.LIQUIDATOR]: 5.8,
      [ZoneFaction.WILD]: 1.35,
      [ZoneFaction.CULTIST]: 1.3,
      [ZoneFaction.CITIZEN]: 0.55,
      [ZoneFaction.SCIENTIST]: 0.9,
    },
    preferredTerritory: ZoneFaction.LIQUIDATOR,
    preferredTerritoryShare: 0.45,
  },
  uprising: {
    intervalSec: 24,
    radius: 38,
    responseRadius: 78,
    ambientChance: 0.12,
    minCitizens: 16,
    maxConverted: 12,
    maxResponders: 8,
  },
} as const;

export const HELL_POPULATION_PROFILE = {
  id: 'hell_lively',
  floor: FloorLevel.HELL,
  monsters: {
    initial: 3387,
    noiseScale: 160,
    noiseStrength: 0.05,
    openWeight: 1.0,
    roomWeights: {
      [RoomType.HQ]: 0.9,
      [RoomType.STORAGE]: 0.9,
    },
    zoneWeights: {
      [ZoneFaction.WILD]: 1.06,
      [ZoneFaction.CULTIST]: 1.03,
      [ZoneFaction.LIQUIDATOR]: 0.97,
      [ZoneFaction.CITIZEN]: 1.0,
    },
  },
  cultists: {
    initial: 565,
    noiseScale: 128,
    noiseStrength: 0.08,
    openWeight: 1.0,
    roomWeights: {
      [RoomType.HQ]: 1.05,
      [RoomType.STORAGE]: 0.95,
    },
    zoneWeights: {
      [ZoneFaction.CULTIST]: 1.24,
      [ZoneFaction.WILD]: 1.04,
      [ZoneFaction.LIQUIDATOR]: 0.86,
      [ZoneFaction.CITIZEN]: 0.95,
    },
  },
  liquidators: {
    initial: 80,
    noiseScale: 144,
    noiseStrength: 0.06,
    openWeight: 1.0,
    roomWeights: {
      [RoomType.HQ]: 1.08,
      [RoomType.STORAGE]: 0.95,
    },
    zoneWeights: {
      [ZoneFaction.LIQUIDATOR]: 1.28,
      [ZoneFaction.CULTIST]: 1.08,
      [ZoneFaction.WILD]: 0.9,
      [ZoneFaction.CITIZEN]: 0.96,
    },
  },
} as const;

export const VOID_POPULATION_PROFILE = {
  id: 'void_lively',
  floor: FloorLevel.VOID,
  guardians: 1600,
  lootDrops: 160,
} as const;

export type ProceduralPopulationProfileId = 'normal' | 'highDensity';
export type ProceduralPopulationBand = 'shallow' | 'middle' | 'deep' | 'voidRoute';

export interface ProceduralPopulationScale {
  /** All counts are authored at DEFAULT_ACTIVE_ACTOR_SOFT_LIMIT and scaled at generation time. */
  base: number;
  perDanger: number;
  perAnomalyPressure: number;
  bandBonus: Readonly<Record<ProceduralPopulationBand, number>>;
  cap: number;
}

export interface ProceduralMonsterPopulationScale extends ProceduralPopulationScale {
  industrialBonus: number;
}

export interface ProceduralPopulationProfile {
  id: ProceduralPopulationProfileId;
  npcs: ProceduralPopulationScale;
  monsters: ProceduralMonsterPopulationScale;
}

export interface ProceduralPopulationBudgetInput {
  z: number;
  danger: number;
  anomalyPressure: number;
  industrial: boolean;
  npcAllowed: boolean;
  profileId: ProceduralPopulationProfileId;
}

export interface ProceduralPopulationBudget {
  profileId: ProceduralPopulationProfileId;
  band: ProceduralPopulationBand;
  npcs: number;
  monsters: number;
  npcCap: number;
  monsterCap: number;
}

export const PROCEDURAL_HIGH_DENSITY_ANOMALIES = ['zombie_apocalypse'] as const;

export const PROCEDURAL_POPULATION_PROFILES = {
  normal: {
    id: 'normal',
    npcs: {
      base: 260,
      perDanger: 150,
      perAnomalyPressure: 80,
      bandBonus: {
        shallow: 0,
        middle: 120,
        deep: 220,
        voidRoute: 0,
      },
      cap: 1250,
    },
    monsters: {
      base: 120,
      perDanger: 110,
      perAnomalyPressure: 70,
      bandBonus: {
        shallow: 0,
        middle: 80,
        deep: 140,
        voidRoute: 220,
      },
      industrialBonus: 70,
      cap: 1100,
    },
  },
  highDensity: {
    id: 'highDensity',
    npcs: {
      base: 3400,
      perDanger: 180,
      perAnomalyPressure: 140,
      bandBonus: {
        shallow: 0,
        middle: 160,
        deep: 300,
        voidRoute: 0,
      },
      cap: DEFAULT_ACTIVE_ACTOR_SOFT_LIMIT,
    },
    monsters: {
      base: 260,
      perDanger: 130,
      perAnomalyPressure: 90,
      bandBonus: {
        shallow: 0,
        middle: 80,
        deep: 160,
        voidRoute: 240,
      },
      industrialBonus: 80,
      cap: 1500,
    },
  },
} as const satisfies Readonly<Record<ProceduralPopulationProfileId, ProceduralPopulationProfile>>;

export const PROCEDURAL_POPULATION_PROFILE = PROCEDURAL_POPULATION_PROFILES.normal;

export function proceduralPopulationProfileId(anomalyId: string): ProceduralPopulationProfileId {
  for (const id of PROCEDURAL_HIGH_DENSITY_ANOMALIES) {
    if (id === anomalyId) return 'highDensity';
  }
  return 'normal';
}

export function proceduralAnomalyPressure(anomalyId: string): number {
  if (anomalyId === 'samosbor_seed' || anomalyId === 'wall_snake' || anomalyId === 'living_tunnels' || anomalyId === 'section_shift' || anomalyId === 'zombie_apocalypse' || anomalyId === 'sandpile_perekrytie') return 2;
  if (
    anomalyId === 'smog' ||
    anomalyId === 'hladon' ||
    anomalyId === 'cement_memory' ||
    anomalyId === 'conway_life' ||
    anomalyId === 'rail_trains'
  ) return 1;
  return 0;
}

export function proceduralPopulationBand(z: number): ProceduralPopulationBand {
  if (z >= 36) return 'voidRoute';
  const depth = Math.abs(z);
  if (depth >= 25) return 'deep';
  if (depth >= 13) return 'middle';
  return 'shallow';
}

function scaledPopulationCount(
  scale: ProceduralPopulationScale,
  band: ProceduralPopulationBand,
  danger: number,
  anomalyPressure: number,
): number {
  const boundedDanger = Math.max(1, Math.min(5, Math.round(danger)));
  const boundedPressure = Math.max(0, Math.min(4, Math.round(anomalyPressure)));
  const raw = activeActorCountAtDefaultSoftLimit(scale.base) +
    boundedDanger * activeActorCountAtDefaultSoftLimit(scale.perDanger) +
    boundedPressure * activeActorCountAtDefaultSoftLimit(scale.perAnomalyPressure) +
    activeActorCountAtDefaultSoftLimit(scale.bandBonus[band]);
  return Math.min(effectivePopulationCap(scale), Math.max(0, Math.round(raw)));
}

function effectivePopulationCap(scale: ProceduralPopulationScale): number {
  return activeActorCountAtDefaultSoftLimit(scale.cap);
}

export function proceduralPopulationBudget(input: ProceduralPopulationBudgetInput): ProceduralPopulationBudget {
  const profile = PROCEDURAL_POPULATION_PROFILES[input.profileId];
  const band = proceduralPopulationBand(input.z);
  const monsterRaw = scaledPopulationCount(profile.monsters, band, input.danger, input.anomalyPressure);
  const rawNpcs = input.npcAllowed ? scaledPopulationCount(profile.npcs, band, input.danger, input.anomalyPressure) : 0;
  const rawMonsters = Math.min(effectivePopulationCap(profile.monsters), monsterRaw + (input.industrial ? activeActorCountAtDefaultSoftLimit(profile.monsters.industrialBonus) : 0));
  const fitted = fitActiveActorCounts(rawNpcs, rawMonsters);
  return {
    profileId: profile.id,
    band,
    npcs: fitted.npcs,
    monsters: fitted.monsters,
    npcCap: effectivePopulationCap(profile.npcs),
    monsterCap: effectivePopulationCap(profile.monsters),
  };
}
