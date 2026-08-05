import {
  Faction,
  FloorLevel,
  EntityType,
  MonsterKind,
  Occupation,
  RoomType,
  W,
  ZoneFaction,
} from '../core/types';
import { designFloorThemeClass } from './design_floors';
import type { DesignFloorId, DesignFloorRouteDef } from './design_floors';
import {
  DEFAULT_ACTIVE_ACTOR_SOFT_LIMIT,
  activeActorCountAtDefaultSoftLimit,
  activeActorSoftLimit,
  ENTITY_SOFT_LIMITS,
  fitActiveActorCounts,
} from './entity_limits';

export interface DesignPlacementFieldProfile {
  noiseScale: number;
  noiseStrength: number;
  roomWeights?: Partial<Record<RoomType, number>>;
  zoneWeights?: Partial<Record<ZoneFaction, number>>;
  openWeight?: number;
  smoothingPasses?: number;
  smoothingBlend?: number;
  anchors?: readonly DesignPlacementFieldAnchor[];
  bucketSize?: number;
  maxPerBucket?: number;
}

export interface DesignPlacementFieldAnchor {
  x: number;
  y: number;
  radius: number;
  weight: number;
}

export interface WeightedDesignValue<T> {
  value: T;
  weight: number;
}

export interface DesignFloorPopulationProfile {
  routeId: DesignFloorId;
  z: number;
  npcTarget: number;
  monsterTarget: number;
  npcLevel: number;
  monsterLevel: number;
  npcNoun: string;
  npcFactions: readonly WeightedDesignValue<Faction>[];
  npcOccupations: readonly WeightedDesignValue<Occupation>[];
  monsterBiasKinds: readonly MonsterKind[];
  monsterTags: readonly string[];
  npcPlacement: DesignPlacementFieldProfile;
  monsterPlacement: DesignPlacementFieldProfile;
}

interface DesignFloorPopulationOverride {
  /** Numeric targets are authored at DEFAULT_ACTIVE_ACTOR_SOFT_LIMIT and scaled when the route is generated. */
  npcTarget?: number | 'active_actor_cap';
  monsterTarget?: number | 'active_actor_cap';
  npcMult?: number;
  monsterMult?: number;
  npcFactions?: readonly WeightedDesignValue<Faction>[];
  npcOccupations?: readonly WeightedDesignValue<Occupation>[];
  npcNoun?: string;
  monsterBiasKinds?: readonly MonsterKind[];
  monsterTags?: readonly string[];
  npcPlacementKind?: PlacementKind;
  monsterPlacementKind?: PlacementKind;
  npcPlacement?: Partial<DesignPlacementFieldProfile>;
  monsterPlacement?: Partial<DesignPlacementFieldProfile>;
}

type PlacementKind = 'social' | 'communal' | 'floor_69' | 'admin' | 'bank' | 'industrial' | 'silicon' | 'slime' | 'attic' | 'hell' | 'underhell' | 'void' | 'roof' | 'camp' | 'metro' | 'morgue' | 'crossroads';

function entityNpcCap(): number {
  return ENTITY_SOFT_LIMITS[EntityType.NPC] ?? activeActorSoftLimit();
}

function entityMonsterCap(): number {
  return ENTITY_SOFT_LIMITS[EntityType.MONSTER] ?? activeActorSoftLimit();
}

const DARKNESS_CENTER = W >> 1;
const PODAD_CENTER = W >> 1;

const DARKNESS_MONSTER_ANCHORS: readonly DesignPlacementFieldAnchor[] = [
  { x: DARKNESS_CENTER - 30, y: DARKNESS_CENTER + 2, radius: 38, weight: 0.06 },
  { x: DARKNESS_CENTER - 8, y: DARKNESS_CENTER + 2, radius: 42, weight: 0.32 },
  { x: DARKNESS_CENTER + 18, y: DARKNESS_CENTER - 14, radius: 72, weight: 1.55 },
  { x: DARKNESS_CENTER + 52, y: DARKNESS_CENTER + 22, radius: 78, weight: 2.35 },
  { x: DARKNESS_CENTER + 56, y: DARKNESS_CENTER + 42, radius: 64, weight: 1.8 },
  { x: DARKNESS_CENTER + 66, y: DARKNESS_CENTER + 8, radius: 58, weight: 2.15 },
];

const PODAD_MONSTER_ANCHORS: readonly DesignPlacementFieldAnchor[] = [
  { x: PODAD_CENTER - 101, y: PODAD_CENTER - 49, radius: 170, weight: 1.7 },
  { x: PODAD_CENTER - 66, y: PODAD_CENTER + 107, radius: 150, weight: 1.45 },
  { x: PODAD_CENTER + 99, y: PODAD_CENTER + 108, radius: 165, weight: 1.55 },
  { x: PODAD_CENTER + 126, y: PODAD_CENTER - 27, radius: 180, weight: 1.4 },
  { x: PODAD_CENTER + 18, y: PODAD_CENTER + 181, radius: 118, weight: 1.22 },
];

const CITIZEN_MIX: readonly WeightedDesignValue<Faction>[] = [
  { value: Faction.CITIZEN, weight: 82 },
  { value: Faction.LIQUIDATOR, weight: 10 },
  { value: Faction.WILD, weight: 6 },
  { value: Faction.SCIENTIST, weight: 2 },
];

const CAMP_MIX: readonly WeightedDesignValue<Faction>[] = [
  { value: Faction.CITIZEN, weight: 90 },
  { value: Faction.SCIENTIST, weight: 5 },
  { value: Faction.LIQUIDATOR, weight: 5 },
];

const ADMIN_MIX: readonly WeightedDesignValue<Faction>[] = [
  { value: Faction.CITIZEN, weight: 58 },
  { value: Faction.LIQUIDATOR, weight: 27 },
  { value: Faction.SCIENTIST, weight: 10 },
  { value: Faction.WILD, weight: 5 },
];

const UPPER_BUREAU_MIX: readonly WeightedDesignValue<Faction>[] = [
  { value: Faction.CITIZEN, weight: 42 },
  { value: Faction.LIQUIDATOR, weight: 26 },
  { value: Faction.CULTIST, weight: 8 },
  { value: Faction.SCIENTIST, weight: 16 },
  { value: Faction.WILD, weight: 8 },
];

const INDUSTRIAL_MIX: readonly WeightedDesignValue<Faction>[] = [
  { value: Faction.LIQUIDATOR, weight: 42 },
  { value: Faction.CITIZEN, weight: 34 },
  { value: Faction.WILD, weight: 16 },
  { value: Faction.SCIENTIST, weight: 8 },
];

const VETERAN_MIX: readonly WeightedDesignValue<Faction>[] = [
  { value: Faction.LIQUIDATOR, weight: 45 },
  { value: Faction.CULTIST, weight: 32 },
  { value: Faction.WILD, weight: 18 },
  { value: Faction.SCIENTIST, weight: 5 },
];

const SOCIAL_OCCUPATIONS: readonly WeightedDesignValue<Occupation>[] = [
  { value: Occupation.TRAVELER, weight: 24 },
  { value: Occupation.HOUSEWIFE, weight: 17 },
  { value: Occupation.COOK, weight: 11 },
  { value: Occupation.LOCKSMITH, weight: 10 },
  { value: Occupation.STOREKEEPER, weight: 9 },
  { value: Occupation.ALCOHOLIC, weight: 8 },
  { value: Occupation.CLEANER, weight: 6 },
  { value: Occupation.SECRETARY, weight: 7 },
  { value: Occupation.MECHANIC, weight: 6 },
  { value: Occupation.DOCTOR, weight: 4 },
  { value: Occupation.HUNTER, weight: 4 },
];

const FLOOR_69_OCCUPATIONS: readonly WeightedDesignValue<Occupation>[] = [
  { value: Occupation.WORKER69, weight: 48 },
  { value: Occupation.PERFORMER, weight: 14 },
  { value: Occupation.TRAVELER, weight: 16 },
  { value: Occupation.SECRETARY, weight: 20 },
  { value: Occupation.STOREKEEPER, weight: 14 },
  { value: Occupation.HUNTER, weight: 13 },
  { value: Occupation.DOCTOR, weight: 9 },
  { value: Occupation.DIRECTOR, weight: 6 },
  { value: Occupation.HOUSEWIFE, weight: 5 },
  { value: Occupation.LOCKSMITH, weight: 5 },
  { value: Occupation.MECHANIC, weight: 4 },
];

const ADMIN_OCCUPATIONS: readonly WeightedDesignValue<Occupation>[] = [
  { value: Occupation.SECRETARY, weight: 28 },
  { value: Occupation.TRAVELER, weight: 18 },
  { value: Occupation.HUNTER, weight: 14 },
  { value: Occupation.STOREKEEPER, weight: 10 },
  { value: Occupation.SCIENTIST, weight: 9 },
  { value: Occupation.DOCTOR, weight: 6 },
  { value: Occupation.LOCKSMITH, weight: 5 },
  { value: Occupation.DIRECTOR, weight: 3 },
];

const UPPER_BUREAU_OCCUPATIONS: readonly WeightedDesignValue<Occupation>[] = [
  { value: Occupation.SECRETARY, weight: 38 },
  { value: Occupation.TRAVELER, weight: 17 },
  { value: Occupation.HUNTER, weight: 16 },
  { value: Occupation.STOREKEEPER, weight: 10 },
  { value: Occupation.SCIENTIST, weight: 7 },
  { value: Occupation.DIRECTOR, weight: 5 },
  { value: Occupation.DOCTOR, weight: 4 },
  { value: Occupation.LOCKSMITH, weight: 3 },
];

const RAIONSOVET_OCCUPATIONS: readonly WeightedDesignValue<Occupation>[] = [
  { value: Occupation.SECRETARY, weight: 36 },
  { value: Occupation.TRAVELER, weight: 22 },
  { value: Occupation.HOUSEWIFE, weight: 12 },
  { value: Occupation.HUNTER, weight: 12 },
  { value: Occupation.STOREKEEPER, weight: 8 },
  { value: Occupation.LOCKSMITH, weight: 6 },
  { value: Occupation.DIRECTOR, weight: 3 },
  { value: Occupation.SCIENTIST, weight: 1 },
];

const INDUSTRIAL_OCCUPATIONS: readonly WeightedDesignValue<Occupation>[] = [
  { value: Occupation.MECHANIC, weight: 22 },
  { value: Occupation.ELECTRICIAN, weight: 18 },
  { value: Occupation.TURNER, weight: 16 },
  { value: Occupation.HUNTER, weight: 13 },
  { value: Occupation.LOCKSMITH, weight: 12 },
  { value: Occupation.TRAVELER, weight: 8 },
  { value: Occupation.SCIENTIST, weight: 6 },
  { value: Occupation.STOREKEEPER, weight: 5 },
];

const CHILD_CAMP_OCCUPATIONS: readonly WeightedDesignValue<Occupation>[] = [
  { value: Occupation.CHILD, weight: 76 },
  { value: Occupation.COOK, weight: 6 },
  { value: Occupation.DOCTOR, weight: 5 },
  { value: Occupation.SECRETARY, weight: 4 },
  { value: Occupation.ELECTRICIAN, weight: 4 },
  { value: Occupation.TRAVELER, weight: 3 },
  { value: Occupation.HUNTER, weight: 1 },
  { value: Occupation.SCIENTIST, weight: 1 },
];

const CAMP_CENTER = W >> 1;
const CAMP_NPC_ANCHORS: readonly DesignPlacementFieldAnchor[] = [
  { x: CAMP_CENTER, y: CAMP_CENTER, radius: 118, weight: 2.15 },
  { x: CAMP_CENTER + 82, y: CAMP_CENTER + 53, radius: 76, weight: 1.75 },
  { x: CAMP_CENTER - 76, y: CAMP_CENTER + 53, radius: 68, weight: 1.58 },
  { x: CAMP_CENTER - 86, y: CAMP_CENTER - 52, radius: 68, weight: 1.45 },
  { x: CAMP_CENTER + 80, y: CAMP_CENTER - 54, radius: 68, weight: 1.42 },
  { x: CAMP_CENTER, y: CAMP_CENTER + 68, radius: 74, weight: 1.35 },
];

const CAMP_MONSTER_ANCHORS: readonly DesignPlacementFieldAnchor[] = [
  { x: CAMP_CENTER - 197, y: CAMP_CENTER - 137, radius: 160, weight: 2.35 },
  { x: CAMP_CENTER - 126, y: CAMP_CENTER + 140, radius: 118, weight: 1.8 },
  { x: CAMP_CENTER + 108, y: CAMP_CENTER + 144, radius: 128, weight: 1.7 },
  { x: CAMP_CENTER, y: CAMP_CENTER - 380, radius: 132, weight: 1.55 },
  { x: CAMP_CENTER, y: CAMP_CENTER + 376, radius: 142, weight: 1.58 },
  { x: CAMP_CENTER - 352, y: CAMP_CENTER, radius: 132, weight: 1.5 },
  { x: CAMP_CENTER + 352, y: CAMP_CENTER, radius: 132, weight: 1.5 },
  { x: CAMP_CENTER + 278, y: CAMP_CENTER + 278, radius: 148, weight: 1.45 },
  { x: CAMP_CENTER - 274, y: CAMP_CENTER - 274, radius: 148, weight: 1.42 },
];

const VETERAN_OCCUPATIONS: readonly WeightedDesignValue<Occupation>[] = [
  { value: Occupation.HUNTER, weight: 42 },
  { value: Occupation.PILGRIM, weight: 24 },
  { value: Occupation.TRAVELER, weight: 14 },
  { value: Occupation.MECHANIC, weight: 9 },
  { value: Occupation.SCIENTIST, weight: 6 },
  { value: Occupation.PRIEST, weight: 5 },
];

const UNDERHELL_THRESHOLD_MIX: readonly WeightedDesignValue<Faction>[] = [
  { value: Faction.LIQUIDATOR, weight: 58 },
  { value: Faction.CULTIST, weight: 42 },
];

const UNDERHELL_THRESHOLD_OCCUPATIONS: readonly WeightedDesignValue<Occupation>[] = [
  { value: Occupation.HUNTER, weight: 46 },
  { value: Occupation.PILGRIM, weight: 24 },
  { value: Occupation.PRIEST, weight: 12 },
  { value: Occupation.SCIENTIST, weight: 10 },
  { value: Occupation.MECHANIC, weight: 8 },
];

const ANTENNA_CENTER = W >> 1;

const ANTENNA_COURT_ENCLAVE_ANCHORS: readonly DesignPlacementFieldAnchor[] = [
  { x: ANTENNA_CENTER, y: ANTENNA_CENTER, radius: 76, weight: 5.2 },
  { x: ANTENNA_CENTER, y: 154, radius: 70, weight: 3.8 },
  { x: 770, y: 254, radius: 64, weight: 3.2 },
  { x: 870, y: ANTENNA_CENTER, radius: 70, weight: 3.6 },
  { x: 770, y: 770, radius: 64, weight: 3.2 },
  { x: ANTENNA_CENTER, y: 870, radius: 70, weight: 3.8 },
  { x: 254, y: 770, radius: 64, weight: 3.2 },
  { x: 154, y: ANTENNA_CENTER, radius: 70, weight: 3.6 },
  { x: 254, y: 254, radius: 64, weight: 3.2 },
];

const ANTENNA_COURT_MONSTER_ANCHORS: readonly DesignPlacementFieldAnchor[] = [
  { x: ANTENNA_CENTER, y: ANTENNA_CENTER - 92, radius: 92, weight: 2.1 },
  { x: ANTENNA_CENTER + 104, y: ANTENNA_CENTER, radius: 92, weight: 2.0 },
  { x: ANTENNA_CENTER, y: ANTENNA_CENTER + 92, radius: 92, weight: 2.1 },
  { x: ANTENNA_CENTER - 104, y: ANTENNA_CENTER, radius: 92, weight: 2.0 },
  ...ANTENNA_COURT_ENCLAVE_ANCHORS.map(anchor => ({
    x: anchor.x,
    y: anchor.y,
    radius: Math.round(anchor.radius * 1.35),
    weight: 1.45,
  })),
];

const METRO_NPC_ANCHORS: readonly DesignPlacementFieldAnchor[] = [
  { x: 512, y: 520, radius: 78, weight: 2.7 },
  { x: 118, y: 82, radius: 58, weight: 2.4 },
  { x: 820, y: 226, radius: 62, weight: 2.35 },
  { x: 160, y: 751, radius: 58, weight: 2.35 },
  { x: 760, y: 889, radius: 64, weight: 2.4 },
  { x: 398, y: 137, radius: 44, weight: 2.1 },
  { x: 679, y: 137, radius: 44, weight: 2.1 },
  { x: 143, y: 234, radius: 44, weight: 2.1 },
  { x: 667, y: 234, radius: 44, weight: 2.1 },
  { x: 420, y: 421, radius: 44, weight: 2.1 },
  { x: 644, y: 421, radius: 44, weight: 2.1 },
  { x: 165, y: 618, radius: 44, weight: 2.1 },
  { x: 621, y: 618, radius: 44, weight: 2.1 },
  { x: 442, y: 805, radius: 44, weight: 2.1 },
  { x: 598, y: 805, radius: 44, weight: 2.1 },
  { x: 187, y: 894, radius: 44, weight: 2.1 },
  { x: 575, y: 894, radius: 44, weight: 2.1 },
];

const METRO_MONSTER_ANCHORS: readonly DesignPlacementFieldAnchor[] = [
  { x: 176, y: 512, radius: 430, weight: 1.65 },
  { x: 842, y: 512, radius: 430, weight: 1.65 },
  { x: 512, y: 506, radius: 80, weight: 2.0 },
  { x: 512, y: 575, radius: 92, weight: 2.2 },
  { x: 304, y: 260, radius: 110, weight: 1.45 },
  { x: 580, y: 402, radius: 110, weight: 1.45 },
  { x: 304, y: 642, radius: 110, weight: 1.45 },
  { x: 580, y: 786, radius: 110, weight: 1.45 },
];

const COMMUNAL_NPC_ANCHORS: readonly DesignPlacementFieldAnchor[] = [
  { x: 512, y: 452, radius: 126, weight: 1.7 },
  { x: 617, y: 508, radius: 112, weight: 1.48 },
  { x: 514, y: 581, radius: 118, weight: 1.58 },
  { x: 370, y: 496, radius: 96, weight: 1.26 },
  { x: 438, y: 516, radius: 86, weight: 1.18 },
  { x: 512, y: 512, radius: 170, weight: 1.15 },
];

const COMMUNAL_MONSTER_ANCHORS: readonly DesignPlacementFieldAnchor[] = [
  { x: 438, y: 516, radius: 88, weight: 1.9 },
  { x: 618, y: 508, radius: 96, weight: 1.62 },
  { x: 514, y: 581, radius: 88, weight: 1.42 },
  { x: 372, y: 496, radius: 74, weight: 1.25 },
];

const DESIGN_FLOOR_POPULATION_OVERRIDES: Readonly<Record<DesignFloorId, DesignFloorPopulationOverride>> = {
  roof: {
    npcTarget: 0,
    monsterTarget: 'active_actor_cap',
    monsterBiasKinds: [MonsterKind.EYE, MonsterKind.SHADOW, MonsterKind.REBAR, MonsterKind.LAMPOGLAZ, MonsterKind.TONKAYA_TEN],
    monsterTags: ['roof', 'sky', 'antenna', 'signal', 'wind', 'open', 'weather'],
    monsterPlacementKind: 'roof',
  },
  chthonic_attic: {
    npcTarget: 0,
    monsterTarget: 4300,
    monsterBiasKinds: [
      MonsterKind.TUBE_EEL,
      MonsterKind.TRUBNYY_AVTOMAT,
      MonsterKind.PAUPSINA,
      MonsterKind.RZHAVNIK,
      MonsterKind.TUMANNIK,
      MonsterKind.FOG_SHARK,
      MonsterKind.REBAR,
      MonsterKind.POLZUN,
      MonsterKind.SHADOW,
    ],
    monsterTags: ['industrial', 'service', 'pipes', 'cable', 'storage', 'fog', 'smog', 'low', 'roots'],
    monsterPlacementKind: 'attic',
  },
  radon_exchange: {
    npcTarget: 48,
    monsterTarget: 3800,
    npcNoun: 'оператор заслонок',
    npcFactions: [{ value: Faction.SCIENTIST, weight: 58 }, { value: Faction.LIQUIDATOR, weight: 34 }, { value: Faction.CITIZEN, weight: 8 }],
    npcOccupations: [{ value: Occupation.SCIENTIST, weight: 34 }, { value: Occupation.ELECTRICIAN, weight: 24 }, { value: Occupation.HUNTER, weight: 18 }, { value: Occupation.SECRETARY, weight: 14 }, { value: Occupation.MECHANIC, weight: 10 }],
    monsterBiasKinds: [MonsterKind.SLEPOGLAZ, MonsterKind.LAMPOGLAZ, MonsterKind.EYE, MonsterKind.PROTOKOLNIK, MonsterKind.PARAGRAPH, MonsterKind.SAFEGUARD],
    monsterTags: ['radon', 'scanline', 'long_sight', 'shutter', 'projection', 'documents', 'lab'],
    npcPlacementKind: 'admin',
    monsterPlacementKind: 'admin',
    npcPlacement: {
      noiseScale: 70,
      noiseStrength: 0.1,
      openWeight: 0.05,
      roomWeights: { [RoomType.HQ]: 2.6, [RoomType.PRODUCTION]: 2.3, [RoomType.OFFICE]: 1.8, [RoomType.CORRIDOR]: 0.35, [RoomType.COMMON]: 0.28, [RoomType.STORAGE]: 0.2 },
      zoneWeights: { [ZoneFaction.LIQUIDATOR]: 1.45, [ZoneFaction.CITIZEN]: 0.55, [ZoneFaction.WILD]: 0.14, [ZoneFaction.CULTIST]: 0.08, [ZoneFaction.SAMOSBOR]: 0.05 },
      anchors: [
        { x: 512, y: 512, radius: 88, weight: 1.7 },
        { x: 512, y: 260, radius: 70, weight: 1.45 },
        { x: 736, y: 506, radius: 74, weight: 1.4 },
        { x: 636, y: 366, radius: 66, weight: 1.32 },
      ],
      bucketSize: 48,
      maxPerBucket: 5,
      smoothingPasses: 1,
      smoothingBlend: 0.38,
    },
    monsterPlacement: {
      noiseScale: 128,
      noiseStrength: 0.16,
      openWeight: 1.28,
      roomWeights: { [RoomType.CORRIDOR]: 1.74, [RoomType.STORAGE]: 1.52, [RoomType.PRODUCTION]: 1.24, [RoomType.COMMON]: 0.9, [RoomType.OFFICE]: 0.72, [RoomType.HQ]: 0.42 },
      zoneWeights: { [ZoneFaction.SAMOSBOR]: 1.35, [ZoneFaction.WILD]: 1.24, [ZoneFaction.CULTIST]: 1.08, [ZoneFaction.LIQUIDATOR]: 0.74, [ZoneFaction.CITIZEN]: 0.58 },
      anchors: [
        { x: 512, y: 512, radius: 200, weight: 1.25 },
        { x: 512, y: 340, radius: 150, weight: 1.55 },
        { x: 684, y: 512, radius: 160, weight: 1.72 },
        { x: 704, y: 704, radius: 150, weight: 1.5 },
        { x: 192, y: 836, radius: 150, weight: 1.28 },
        { x: 836, y: 188, radius: 150, weight: 1.28 },
      ],
      bucketSize: 28,
      maxPerBucket: 9,
    },
  },
  antenna_court: {
    npcTarget: 60,
    monsterTarget: 3400,
    npcNoun: 'сигнал-специалист',
    npcFactions: [{ value: Faction.SCIENTIST, weight: 64 }, { value: Faction.LIQUIDATOR, weight: 36 }],
    npcOccupations: [{ value: Occupation.SCIENTIST, weight: 42 }, { value: Occupation.HUNTER, weight: 24 }, { value: Occupation.ELECTRICIAN, weight: 22 }, { value: Occupation.MECHANIC, weight: 8 }, { value: Occupation.SECRETARY, weight: 4 }],
    monsterBiasKinds: [MonsterKind.SLIMEVIK, MonsterKind.SLIME_WOMAN, MonsterKind.EYE, MonsterKind.LAMPOVY, MonsterKind.LAMPOGLAZ, MonsterKind.SLEPOGLAZ, MonsterKind.SAFEGUARD, MonsterKind.TRUBNYY_AVTOMAT, MonsterKind.TUBE_EEL, MonsterKind.CHERNOSLIZ],
    monsterTags: ['signal', 'radio', 'screen', 'power', 'lab', 'pipes', 'slime', 'industrial', 'open'],
    npcPlacementKind: 'industrial',
    monsterPlacementKind: 'roof',
    npcPlacement: {
      noiseScale: 72,
      noiseStrength: 0.12,
      openWeight: 0.04,
      roomWeights: { [RoomType.PRODUCTION]: 1.8, [RoomType.HQ]: 1.7, [RoomType.OFFICE]: 1.45, [RoomType.STORAGE]: 1.34, [RoomType.CORRIDOR]: 0.28, [RoomType.COMMON]: 0.18, [RoomType.LIVING]: 0.12 },
      zoneWeights: { [ZoneFaction.LIQUIDATOR]: 1.8, [ZoneFaction.SCIENTIST]: 1.65, [ZoneFaction.CITIZEN]: 0.52, [ZoneFaction.WILD]: 0.18, [ZoneFaction.SAMOSBOR]: 0.06, [ZoneFaction.CULTIST]: 0.08 },
      anchors: ANTENNA_COURT_ENCLAVE_ANCHORS,
      bucketSize: 48,
      maxPerBucket: 6,
      smoothingPasses: 1,
      smoothingBlend: 0.42,
    },
    monsterPlacement: {
      noiseScale: 152,
      noiseStrength: 0.16,
      openWeight: 1.42,
      roomWeights: { [RoomType.PRODUCTION]: 1.24, [RoomType.CORRIDOR]: 1.18, [RoomType.STORAGE]: 1.02, [RoomType.COMMON]: 0.72, [RoomType.OFFICE]: 0.48, [RoomType.HQ]: 0.36, [RoomType.LIVING]: 0.28 },
      zoneWeights: { [ZoneFaction.WILD]: 1.32, [ZoneFaction.SAMOSBOR]: 1.24, [ZoneFaction.CULTIST]: 0.88, [ZoneFaction.CITIZEN]: 0.82, [ZoneFaction.LIQUIDATOR]: 0.58, [ZoneFaction.SCIENTIST]: 0.52 },
      anchors: ANTENNA_COURT_MONSTER_ANCHORS,
      bucketSize: 28,
      maxPerBucket: 9,
    },
  },
  spetspriemnik: {
    npcTarget: 920,
    monsterTarget: 760,
    npcNoun: 'конвоир',
    npcFactions: [
      { value: Faction.LIQUIDATOR, weight: 52 },
      { value: Faction.CITIZEN, weight: 28 },
      { value: Faction.WILD, weight: 15 },
      { value: Faction.SCIENTIST, weight: 5 },
    ],
    npcOccupations: [
      { value: Occupation.HUNTER, weight: 34 },
      { value: Occupation.SECRETARY, weight: 22 },
      { value: Occupation.TRAVELER, weight: 16 },
      { value: Occupation.STOREKEEPER, weight: 10 },
      { value: Occupation.DIRECTOR, weight: 6 },
      { value: Occupation.LOCKSMITH, weight: 6 },
      { value: Occupation.SCIENTIST, weight: 6 },
    ],
    monsterBiasKinds: [MonsterKind.PROTOKOLNIK, MonsterKind.KONTORSHCHIK, MonsterKind.NELYUD, MonsterKind.BEZEKHIY, MonsterKind.SAFEGUARD],
    monsterTags: ['detention', 'cellblock', 'riot', 'documents', 'permit', 'hostage', 'liquidator'],
    npcPlacementKind: 'admin',
    monsterPlacementKind: 'admin',
    npcPlacement: {
      noiseScale: 78,
      noiseStrength: 0.14,
      openWeight: 0.64,
      bucketSize: 34,
      maxPerBucket: 6,
      roomWeights: {
        [RoomType.HQ]: 1.85,
        [RoomType.CORRIDOR]: 1.42,
        [RoomType.OFFICE]: 1.28,
        [RoomType.COMMON]: 1.18,
        [RoomType.LIVING]: 0.92,
        [RoomType.STORAGE]: 0.76,
      },
      zoneWeights: {
        [ZoneFaction.LIQUIDATOR]: 1.55,
        [ZoneFaction.CITIZEN]: 0.92,
        [ZoneFaction.WILD]: 0.78,
        [ZoneFaction.SAMOSBOR]: 0.42,
        [ZoneFaction.CULTIST]: 0.32,
      },
      anchors: [
        { x: 512, y: 326, radius: 132, weight: 1.52 },
        { x: 358, y: 512, radius: 144, weight: 1.24 },
        { x: 660, y: 512, radius: 144, weight: 1.28 },
        { x: 512, y: 730, radius: 118, weight: 1.16 },
      ],
    },
    monsterPlacement: {
      noiseScale: 112,
      noiseStrength: 0.18,
      openWeight: 0.92,
      bucketSize: 30,
      maxPerBucket: 6,
      roomWeights: {
        [RoomType.LIVING]: 1.75,
        [RoomType.CORRIDOR]: 1.36,
        [RoomType.STORAGE]: 1.24,
        [RoomType.COMMON]: 1.08,
        [RoomType.OFFICE]: 0.72,
        [RoomType.HQ]: 0.48,
      },
      zoneWeights: {
        [ZoneFaction.WILD]: 1.36,
        [ZoneFaction.SAMOSBOR]: 1.24,
        [ZoneFaction.LIQUIDATOR]: 0.84,
        [ZoneFaction.CITIZEN]: 0.72,
        [ZoneFaction.CULTIST]: 0.8,
      },
      anchors: [
        { x: 348, y: 512, radius: 150, weight: 1.6 },
        { x: 674, y: 512, radius: 150, weight: 1.58 },
        { x: 512, y: 780, radius: 128, weight: 1.42 },
        { x: 300, y: 720, radius: 118, weight: 1.2 },
      ],
    },
  },
  pioneer_camp: {
    npcTarget: 1100,
    monsterTarget: 900,
    npcNoun: 'участник смены',
    npcFactions: CAMP_MIX,
    npcOccupations: CHILD_CAMP_OCCUPATIONS,
    monsterBiasKinds: [MonsterKind.NELYUD, MonsterKind.SHADOW, MonsterKind.EYE, MonsterKind.TUBE_EEL, MonsterKind.GREEN_DOG],
    monsterTags: ['residential', 'civil', 'corridor', 'storage', 'water', 'wet', 'camp', 'trail', 'old_camp'],
    npcPlacementKind: 'camp',
    monsterPlacementKind: 'camp',
  },
  oranzhereya_betona: {
    npcTarget: 980,
    monsterTarget: 920,
    npcNoun: 'тепличник',
    npcFactions: [
      { value: Faction.CITIZEN, weight: 58 },
      { value: Faction.SCIENTIST, weight: 22 },
      { value: Faction.LIQUIDATOR, weight: 16 },
      { value: Faction.WILD, weight: 4 },
    ],
    npcOccupations: [
      { value: Occupation.STOREKEEPER, weight: 24 },
      { value: Occupation.COOK, weight: 20 },
      { value: Occupation.SCIENTIST, weight: 16 },
      { value: Occupation.MECHANIC, weight: 12 },
      { value: Occupation.TRAVELER, weight: 10 },
      { value: Occupation.HOUSEWIFE, weight: 10 },
      { value: Occupation.HUNTER, weight: 8 },
    ],
    monsterBiasKinds: [
      MonsterKind.BORSHCHEVIK,
      MonsterKind.SPORE_CARPET,
      MonsterKind.MUKHOZHUK_HOST,
      MonsterKind.GREEN_DOG,
      MonsterKind.CHERNOSLIZ,
    ],
    monsterTags: ['greenhouse', 'food', 'water', 'spore', 'fungus', 'garden', 'ration', 'living'],
    npcPlacementKind: 'social',
    monsterPlacementKind: 'social',
    npcPlacement: {
      anchors: [
        { x: 512, y: 512, radius: 150, weight: 1.65 },
        { x: 404, y: 456, radius: 92, weight: 1.35 },
        { x: 626, y: 456, radius: 92, weight: 1.35 },
        { x: 512, y: 628, radius: 118, weight: 1.28 },
      ],
      bucketSize: 36,
      maxPerBucket: 7,
    },
    monsterPlacement: {
      anchors: [
        { x: 386, y: 540, radius: 128, weight: 1.46 },
        { x: 638, y: 540, radius: 128, weight: 1.46 },
        { x: 512, y: 650, radius: 150, weight: 1.62 },
        { x: 512, y: 390, radius: 120, weight: 1.16 },
      ],
      bucketSize: 28,
      maxPerBucket: 8,
    },
  },
  cayley_byuro: {
    npcTarget: 760,
    monsterTarget: 980,
    npcNoun: 'проситель',
    npcFactions: [{ value: Faction.SCIENTIST, weight: 34 }, { value: Faction.CITIZEN, weight: 26 }, { value: Faction.LIQUIDATOR, weight: 20 }, { value: Faction.CULTIST, weight: 10 }, { value: Faction.WILD, weight: 10 }],
    npcOccupations: [{ value: Occupation.SECRETARY, weight: 34 }, { value: Occupation.TRAVELER, weight: 20 }, { value: Occupation.HUNTER, weight: 14 }, { value: Occupation.SCIENTIST, weight: 10 }, { value: Occupation.STOREKEEPER, weight: 10 }, { value: Occupation.DIRECTOR, weight: 7 }, { value: Occupation.LOCKSMITH, weight: 5 }],
    monsterBiasKinds: [MonsterKind.PARAGRAPH, MonsterKind.PECHATEED, MonsterKind.KONTORSHCHIK, MonsterKind.PROTOKOLNIK, MonsterKind.KANTSELYARSKIY_IDOL],
    monsterTags: ['cayley_byuro', 'cayley_graph', 'documents', 'bureaucracy', 'forgery', 'queue'],
    npcPlacementKind: 'admin',
    monsterPlacementKind: 'admin',
    npcPlacement: {
      noiseScale: 88,
      noiseStrength: 0.16,
      openWeight: 0.74,
      zoneWeights: {
        [ZoneFaction.SCIENTIST]: 1.56,
        [ZoneFaction.CITIZEN]: 1.2,
        [ZoneFaction.LIQUIDATOR]: 1.08,
        [ZoneFaction.CULTIST]: 0.86,
        [ZoneFaction.WILD]: 0.86,
        [ZoneFaction.SAMOSBOR]: 0.08,
      },
      anchors: [
        { x: 626, y: 500, radius: 150, weight: 1.62 },
        { x: 176, y: 176, radius: 120, weight: 1.28 },
        { x: 856, y: 184, radius: 118, weight: 1.22 },
        { x: 178, y: 822, radius: 96, weight: 1.08 },
        { x: 856, y: 850, radius: 98, weight: 1.08 },
      ],
    },
    monsterPlacement: {
      noiseScale: 118,
      noiseStrength: 0.18,
      openWeight: 0.98,
      anchors: [
        { x: 480, y: 284, radius: 138, weight: 1.38 },
        { x: 612, y: 558, radius: 132, weight: 1.44 },
        { x: 512, y: 606, radius: 110, weight: 1.26 },
        { x: 790, y: 484, radius: 126, weight: 1.42 },
      ],
    },
  },
  upper_bureau: {
    npcTarget: 650,
    monsterTarget: 1100,
    npcNoun: 'проситель',
    npcFactions: UPPER_BUREAU_MIX,
    npcOccupations: UPPER_BUREAU_OCCUPATIONS,
    monsterBiasKinds: [MonsterKind.PARAGRAPH, MonsterKind.PECHATEED, MonsterKind.KONTORSHCHIK, MonsterKind.PROTOKOLNIK, MonsterKind.KANTSELYARSKIY_IDOL],
    monsterTags: ['documents', 'archive', 'paperwork', 'bureaucracy', 'queue', 'service'],
    npcPlacementKind: 'admin',
    monsterPlacementKind: 'admin',
    npcPlacement: {
      anchors: [
        { x: 260, y: 508, radius: 145, weight: 1.42 },
        { x: 444, y: 508, radius: 118, weight: 1.34 },
        { x: 590, y: 410, radius: 132, weight: 1.22 },
      ],
    },
    monsterPlacement: {
      anchors: [
        { x: 300, y: 508, radius: 170, weight: 0.72 },
        { x: 572, y: 502, radius: 118, weight: 1.42 },
        { x: 760, y: 540, radius: 185, weight: 1.78 },
        { x: 640, y: 720, radius: 210, weight: 1.45 },
      ],
    },
  },
  number_registry: {
    npcTarget: 980,
    monsterTarget: 980,
    npcNoun: 'регистрант',
    npcFactions: [{ value: Faction.CITIZEN, weight: 58 }, { value: Faction.LIQUIDATOR, weight: 25 }, { value: Faction.SCIENTIST, weight: 12 }, { value: Faction.WILD, weight: 5 }],
    npcOccupations: [{ value: Occupation.SECRETARY, weight: 36 }, { value: Occupation.TRAVELER, weight: 20 }, { value: Occupation.STOREKEEPER, weight: 12 }, { value: Occupation.HUNTER, weight: 12 }, { value: Occupation.SCIENTIST, weight: 8 }, { value: Occupation.LOCKSMITH, weight: 7 }, { value: Occupation.DIRECTOR, weight: 5 }],
    monsterBiasKinds: [MonsterKind.PARAGRAPH, MonsterKind.PECHATEED, MonsterKind.KONTORSHCHIK, MonsterKind.PROTOKOLNIK, MonsterKind.SLEPOGLAZ],
    monsterTags: ['number_registry', 'residue', 'modulus', 'prime_corridor', 'documents', 'bureaucracy'],
    npcPlacementKind: 'admin',
    monsterPlacementKind: 'admin',
    npcPlacement: {
      noiseScale: 84,
      noiseStrength: 0.16,
      openWeight: 0.7,
      bucketSize: 28,
      maxPerBucket: 7,
      smoothingPasses: 2,
      smoothingBlend: 0.52,
      roomWeights: {
        [RoomType.COMMON]: 1.72,
        [RoomType.OFFICE]: 1.64,
        [RoomType.HQ]: 1.34,
        [RoomType.CORRIDOR]: 1.05,
        [RoomType.STORAGE]: 0.74,
      },
      anchors: [
        { x: 512, y: 512, radius: 130, weight: 1.65 },
        { x: 442, y: 540, radius: 90, weight: 1.44 },
        { x: 604, y: 548, radius: 110, weight: 1.32 },
        { x: 690, y: 508, radius: 88, weight: 1.2 },
      ],
    },
    monsterPlacement: {
      noiseScale: 112,
      noiseStrength: 0.18,
      openWeight: 0.95,
      roomWeights: {
        [RoomType.CORRIDOR]: 1.72,
        [RoomType.STORAGE]: 1.56,
        [RoomType.HQ]: 1.36,
        [RoomType.OFFICE]: 0.86,
        [RoomType.COMMON]: 0.62,
      },
      zoneWeights: {
        [ZoneFaction.SAMOSBOR]: 1.42,
        [ZoneFaction.WILD]: 1.28,
        [ZoneFaction.LIQUIDATOR]: 0.94,
        [ZoneFaction.CITIZEN]: 0.7,
        [ZoneFaction.CULTIST]: 0.82,
      },
      anchors: [
        { x: 616, y: 466, radius: 120, weight: 2.0 },
        { x: 724, y: 510, radius: 96, weight: 1.72 },
        { x: 720, y: 338, radius: 150, weight: 1.46 },
        { x: 836, y: 428, radius: 130, weight: 1.34 },
      ],
    },
  },
  istinniy_labirint: {
    npcTarget: 900,
    monsterTarget: 1300,
    npcNoun: 'потерявшийся',
    npcFactions: [{ value: Faction.CITIZEN, weight: 46 }, { value: Faction.LIQUIDATOR, weight: 34 }, { value: Faction.SCIENTIST, weight: 12 }, { value: Faction.WILD, weight: 8 }],
    npcOccupations: [{ value: Occupation.TRAVELER, weight: 34 }, { value: Occupation.HUNTER, weight: 22 }, { value: Occupation.SECRETARY, weight: 16 }, { value: Occupation.STOREKEEPER, weight: 10 }, { value: Occupation.SCIENTIST, weight: 8 }, { value: Occupation.LOCKSMITH, weight: 6 }, { value: Occupation.DOCTOR, weight: 4 }],
    monsterBiasKinds: [MonsterKind.SHADOW, MonsterKind.BEZEKHIY, MonsterKind.PECHATEED, MonsterKind.PARAGRAPH, MonsterKind.KONTORSHCHIK, MonsterKind.TONKAYA_TEN],
    monsterTags: ['maze', 'wayfinding', 'chalk_route_mark', 'documents', 'dead_end', 'shortcut', 'low_light'],
    npcPlacementKind: 'admin',
    monsterPlacementKind: 'admin',
    npcPlacement: {
      noiseScale: 92,
      noiseStrength: 0.18,
      openWeight: 0.86,
      roomWeights: { [RoomType.HQ]: 1.52, [RoomType.COMMON]: 1.42, [RoomType.CORRIDOR]: 1.22, [RoomType.OFFICE]: 1.14, [RoomType.STORAGE]: 0.72 },
      anchors: [
        { x: 512, y: 512, radius: 150, weight: 1.7 },
        { x: 508, y: 304, radius: 120, weight: 1.28 },
        { x: 704, y: 516, radius: 140, weight: 1.18 },
      ],
    },
    monsterPlacement: {
      noiseScale: 116,
      noiseStrength: 0.2,
      openWeight: 1.08,
      roomWeights: { [RoomType.CORRIDOR]: 1.68, [RoomType.STORAGE]: 1.62, [RoomType.COMMON]: 0.9, [RoomType.OFFICE]: 0.86, [RoomType.HQ]: 0.62 },
      zoneWeights: { [ZoneFaction.WILD]: 1.42, [ZoneFaction.SAMOSBOR]: 1.22, [ZoneFaction.CULTIST]: 1.12, [ZoneFaction.LIQUIDATOR]: 0.9, [ZoneFaction.CITIZEN]: 0.72 },
      anchors: [
        { x: 140, y: 140, radius: 150, weight: 1.6 },
        { x: 884, y: 136, radius: 160, weight: 1.52 },
        { x: 884, y: 884, radius: 160, weight: 1.64 },
        { x: 512, y: 748, radius: 140, weight: 1.34 },
      ],
    },
  },
  bank_floor: {
    npcTarget: 1400,
    monsterTarget: 650,
    npcFactions: [{ value: Faction.CITIZEN, weight: 62 }, { value: Faction.LIQUIDATOR, weight: 24 }, { value: Faction.WILD, weight: 11 }, { value: Faction.SCIENTIST, weight: 3 }],
    npcOccupations: [{ value: Occupation.SECRETARY, weight: 30 }, { value: Occupation.TRAVELER, weight: 24 }, { value: Occupation.STOREKEEPER, weight: 14 }, { value: Occupation.HUNTER, weight: 14 }, { value: Occupation.ALCOHOLIC, weight: 8 }, { value: Occupation.DIRECTOR, weight: 5 }, { value: Occupation.LOCKSMITH, weight: 5 }],
    monsterBiasKinds: [MonsterKind.PECHATEED, MonsterKind.PARAGRAPH, MonsterKind.KONTORSHCHIK, MonsterKind.PROTOKOLNIK, MonsterKind.SLEPOGLAZ],
    npcPlacementKind: 'bank',
    monsterPlacementKind: 'bank',
  },
  critical_leak_archive: {
    npcTarget: 760,
    monsterTarget: 1050,
    npcNoun: 'архивист протечки',
    npcFactions: [{ value: Faction.CITIZEN, weight: 42 }, { value: Faction.LIQUIDATOR, weight: 34 }, { value: Faction.SCIENTIST, weight: 20 }, { value: Faction.WILD, weight: 4 }],
    npcOccupations: [{ value: Occupation.SECRETARY, weight: 31 }, { value: Occupation.HUNTER, weight: 21 }, { value: Occupation.SCIENTIST, weight: 18 }, { value: Occupation.ELECTRICIAN, weight: 12 }, { value: Occupation.LOCKSMITH, weight: 8 }, { value: Occupation.TRAVELER, weight: 6 }, { value: Occupation.STOREKEEPER, weight: 4 }],
    monsterBiasKinds: [MonsterKind.TUBE_EEL, MonsterKind.VODYANOY_KOSHMAR, MonsterKind.CHERNOSLIZ, MonsterKind.PECHATEED, MonsterKind.PARAGRAPH, MonsterKind.PROTOKOLNIK],
    monsterTags: ['documents', 'archive', 'paperwork', 'water', 'wet', 'floodgate', 'contaminated', 'shortcut'],
    npcPlacementKind: 'admin',
    monsterPlacementKind: 'admin',
    npcPlacement: {
      noiseScale: 82,
      noiseStrength: 0.16,
      openWeight: 0.72,
      bucketSize: 34,
      maxPerBucket: 5,
      roomWeights: {
        [RoomType.OFFICE]: 1.68,
        [RoomType.HQ]: 1.48,
        [RoomType.COMMON]: 1.42,
        [RoomType.PRODUCTION]: 1.2,
        [RoomType.CORRIDOR]: 0.95,
        [RoomType.STORAGE]: 0.72,
        [RoomType.BATHROOM]: 0.48,
      },
      zoneWeights: {
        [ZoneFaction.LIQUIDATOR]: 1.32,
        [ZoneFaction.CITIZEN]: 1.08,
        [ZoneFaction.WILD]: 0.72,
        [ZoneFaction.SAMOSBOR]: 0.55,
        [ZoneFaction.CULTIST]: 0.45,
      },
      anchors: [
        { x: 410, y: 501, radius: 92, weight: 1.42 },
        { x: 506, y: 501, radius: 82, weight: 1.2 },
        { x: 622, y: 714, radius: 86, weight: 1.35 },
        { x: 494, y: 334, radius: 84, weight: 1.18 },
      ],
    },
    monsterPlacement: {
      noiseScale: 108,
      noiseStrength: 0.19,
      openWeight: 1.14,
      bucketSize: 28,
      maxPerBucket: 7,
      roomWeights: {
        [RoomType.BATHROOM]: 2.15,
        [RoomType.STORAGE]: 1.82,
        [RoomType.CORRIDOR]: 1.34,
        [RoomType.PRODUCTION]: 1.24,
        [RoomType.OFFICE]: 0.72,
        [RoomType.COMMON]: 0.62,
        [RoomType.HQ]: 0.45,
      },
      zoneWeights: {
        [ZoneFaction.SAMOSBOR]: 1.36,
        [ZoneFaction.WILD]: 1.22,
        [ZoneFaction.LIQUIDATOR]: 0.94,
        [ZoneFaction.CITIZEN]: 0.72,
        [ZoneFaction.CULTIST]: 1.08,
      },
      anchors: [
        { x: 782, y: 512, radius: 150, weight: 1.9 },
        { x: 742, y: 236, radius: 120, weight: 1.56 },
        { x: 620, y: 714, radius: 110, weight: 1.42 },
        { x: 512, y: 884, radius: 160, weight: 1.24 },
        { x: 884, y: 512, radius: 170, weight: 1.34 },
      ],
    },
  },
  raionsovet_archive: {
    npcTarget: 1200,
    monsterTarget: 820,
    npcNoun: 'проситель',
    npcFactions: [{ value: Faction.CITIZEN, weight: 68 }, { value: Faction.LIQUIDATOR, weight: 24 }, { value: Faction.WILD, weight: 6 }, { value: Faction.SCIENTIST, weight: 2 }],
    npcOccupations: RAIONSOVET_OCCUPATIONS,
    monsterBiasKinds: [MonsterKind.PECHATEED, MonsterKind.PARAGRAPH, MonsterKind.KONTORSHCHIK, MonsterKind.PROTOKOLNIK, MonsterKind.BEZEKHIY],
    monsterTags: ['documents', 'archive', 'paperwork', 'storage', 'bureaucracy'],
    npcPlacementKind: 'admin',
    monsterPlacementKind: 'admin',
    npcPlacement: {
      noiseScale: 88,
      noiseStrength: 0.18,
      openWeight: 0.82,
      bucketSize: 32,
      maxPerBucket: 5,
      smoothingPasses: 2,
      smoothingBlend: 0.52,
      roomWeights: {
        [RoomType.COMMON]: 1.85,
        [RoomType.OFFICE]: 1.78,
        [RoomType.HQ]: 1.42,
        [RoomType.CORRIDOR]: 1.08,
        [RoomType.PRODUCTION]: 0.92,
        [RoomType.STORAGE]: 0.58,
      },
      zoneWeights: {
        [ZoneFaction.CITIZEN]: 1.2,
        [ZoneFaction.LIQUIDATOR]: 1.16,
        [ZoneFaction.WILD]: 0.82,
        [ZoneFaction.CULTIST]: 0.58,
        [ZoneFaction.SAMOSBOR]: 0.5,
      },
    },
    monsterPlacement: {
      noiseScale: 112,
      noiseStrength: 0.2,
      openWeight: 0.92,
      bucketSize: 28,
      maxPerBucket: 6,
      smoothingPasses: 2,
      smoothingBlend: 0.5,
      roomWeights: {
        [RoomType.STORAGE]: 2.05,
        [RoomType.CORRIDOR]: 1.18,
        [RoomType.PRODUCTION]: 1.12,
        [RoomType.HQ]: 0.82,
        [RoomType.OFFICE]: 0.68,
        [RoomType.COMMON]: 0.52,
      },
      zoneWeights: {
        [ZoneFaction.SAMOSBOR]: 1.38,
        [ZoneFaction.WILD]: 1.18,
        [ZoneFaction.CULTIST]: 1.12,
        [ZoneFaction.LIQUIDATOR]: 0.92,
        [ZoneFaction.CITIZEN]: 0.76,
      },
    },
  },
  markov_stairwell: {
    npcTarget: 820,
    monsterTarget: 980,
    npcNoun: 'счётчик маршей',
    npcFactions: [{ value: Faction.CITIZEN, weight: 40 }, { value: Faction.LIQUIDATOR, weight: 24 }, { value: Faction.CULTIST, weight: 10 }, { value: Faction.SCIENTIST, weight: 14 }, { value: Faction.WILD, weight: 12 }],
    npcOccupations: [{ value: Occupation.SECRETARY, weight: 24 }, { value: Occupation.TRAVELER, weight: 22 }, { value: Occupation.HUNTER, weight: 16 }, { value: Occupation.LOCKSMITH, weight: 14 }, { value: Occupation.SCIENTIST, weight: 12 }, { value: Occupation.STOREKEEPER, weight: 8 }, { value: Occupation.ELECTRICIAN, weight: 4 }],
    monsterBiasKinds: [MonsterKind.BEZEKHIY, MonsterKind.SHADOW, MonsterKind.PARAGRAPH, MonsterKind.SLEPOGLAZ, MonsterKind.TONKAYA_TEN],
    monsterTags: ['stairs', 'sequence', 'wayfinding', 'shortcut', 'documents', 'low_light'],
    npcPlacementKind: 'admin',
    monsterPlacementKind: 'admin',
    npcPlacement: {
      noiseScale: 88,
      noiseStrength: 0.16,
      openWeight: 0.78,
      bucketSize: 34,
      maxPerBucket: 5,
      roomWeights: { [RoomType.CORRIDOR]: 1.55, [RoomType.OFFICE]: 1.26, [RoomType.STORAGE]: 1.08, [RoomType.PRODUCTION]: 0.92, [RoomType.KITCHEN]: 0.86, [RoomType.BATHROOM]: 0.58 },
      zoneWeights: { [ZoneFaction.CITIZEN]: 1.28, [ZoneFaction.LIQUIDATOR]: 1.16, [ZoneFaction.SCIENTIST]: 1.08, [ZoneFaction.WILD]: 0.96, [ZoneFaction.CULTIST]: 0.78, [ZoneFaction.SAMOSBOR]: 0.08 },
      anchors: [
        { x: 423, y: 65, radius: 118, weight: 1.34 },
        { x: 818, y: 86, radius: 104, weight: 1.2 },
        { x: 128, y: 86, radius: 88, weight: 1.06 },
        { x: 818, y: 860, radius: 98, weight: 1.12 },
        { x: 128, y: 860, radius: 102, weight: 1.1 },
        { x: 512, y: 512, radius: 150, weight: 1.22 },
        { x: 665, y: 520, radius: 130, weight: 1.12 },
      ],
    },
    monsterPlacement: {
      noiseScale: 110,
      noiseStrength: 0.2,
      openWeight: 1.02,
      bucketSize: 28,
      maxPerBucket: 6,
      roomWeights: { [RoomType.CORRIDOR]: 1.72, [RoomType.STORAGE]: 1.48, [RoomType.PRODUCTION]: 1.22, [RoomType.BATHROOM]: 1.08, [RoomType.OFFICE]: 0.72, [RoomType.KITCHEN]: 0.58 },
      zoneWeights: { [ZoneFaction.WILD]: 1.3, [ZoneFaction.SAMOSBOR]: 1.14, [ZoneFaction.LIQUIDATOR]: 0.92, [ZoneFaction.CITIZEN]: 0.78, [ZoneFaction.CULTIST]: 0.88 },
      anchors: [
        { x: 430, y: 404, radius: 120, weight: 1.4 },
        { x: 594, y: 594, radius: 135, weight: 1.52 },
        { x: 665, y: 520, radius: 150, weight: 1.34 },
      ],
    },
  },
  registry_morgue: {
    npcTarget: 480,
    monsterTarget: 1150,
    npcFactions: [{ value: Faction.CITIZEN, weight: 43 }, { value: Faction.SCIENTIST, weight: 31 }, { value: Faction.LIQUIDATOR, weight: 23 }, { value: Faction.WILD, weight: 3 }],
    npcOccupations: [{ value: Occupation.DOCTOR, weight: 34 }, { value: Occupation.SECRETARY, weight: 23 }, { value: Occupation.HUNTER, weight: 16 }, { value: Occupation.SCIENTIST, weight: 12 }, { value: Occupation.TRAVELER, weight: 10 }],
    monsterBiasKinds: [MonsterKind.DIKIY_MERTVYAK, MonsterKind.BEZEKHIY, MonsterKind.PECHATEED, MonsterKind.PARAGRAPH, MonsterKind.NELYUD],
    npcPlacementKind: 'morgue',
    monsterPlacementKind: 'morgue',
  },
  bolnichny_korpus: {
    npcTarget: 1050,
    monsterTarget: 1350,
    npcNoun: 'санработник',
    npcFactions: [
      { value: Faction.SCIENTIST, weight: 38 },
      { value: Faction.LIQUIDATOR, weight: 30 },
      { value: Faction.CITIZEN, weight: 27 },
      { value: Faction.WILD, weight: 5 },
    ],
    npcOccupations: [
      { value: Occupation.DOCTOR, weight: 34 },
      { value: Occupation.HUNTER, weight: 16 },
      { value: Occupation.SECRETARY, weight: 15 },
      { value: Occupation.STOREKEEPER, weight: 12 },
      { value: Occupation.ELECTRICIAN, weight: 8 },
      { value: Occupation.TRAVELER, weight: 15 },
    ],
    monsterBiasKinds: [MonsterKind.DIKIY_MERTVYAK, MonsterKind.HEAD_SLUG, MonsterKind.CHERNOSLIZ, MonsterKind.BEZEKHIY, MonsterKind.NELYUD],
    monsterTags: ['hospital', 'quarantine', 'infection', 'medical', 'ventilation', 'contaminated', 'ward'],
    npcPlacementKind: 'slime',
    monsterPlacementKind: 'slime',
    npcPlacement: {
      zoneWeights: { [ZoneFaction.SCIENTIST]: 1.46, [ZoneFaction.LIQUIDATOR]: 1.18, [ZoneFaction.CITIZEN]: 1.04, [ZoneFaction.WILD]: 0.68, [ZoneFaction.CULTIST]: 0.5 },
      anchors: [
        { x: 512, y: 720, radius: 116, weight: 1.5 },
        { x: 512, y: 604, radius: 150, weight: 1.35 },
        { x: 690, y: 514, radius: 120, weight: 1.42 },
        { x: 432, y: 492, radius: 110, weight: 1.18 },
      ],
    },
    monsterPlacement: {
      zoneWeights: { [ZoneFaction.WILD]: 1.36, [ZoneFaction.CULTIST]: 1.18, [ZoneFaction.CITIZEN]: 0.82, [ZoneFaction.LIQUIDATOR]: 0.72, [ZoneFaction.SCIENTIST]: 0.66 },
      anchors: [
        { x: 250, y: 548, radius: 130, weight: 1.85 },
        { x: 252, y: 670, radius: 130, weight: 1.65 },
        { x: 708, y: 660, radius: 118, weight: 1.78 },
        { x: 240, y: 708, radius: 150, weight: 1.44 },
      ],
    },
  },
  slime_nii: {
    npcTarget: 1300,
    monsterTarget: 1700,
    npcNoun: 'сотрудник НИИ',
    npcFactions: [
      { value: Faction.SCIENTIST, weight: 48 },
      { value: Faction.LIQUIDATOR, weight: 28 },
      { value: Faction.CITIZEN, weight: 18 },
      { value: Faction.WILD, weight: 6 },
    ],
    npcOccupations: [
      { value: Occupation.SCIENTIST, weight: 42 },
      { value: Occupation.DOCTOR, weight: 18 },
      { value: Occupation.SECRETARY, weight: 12 },
      { value: Occupation.HUNTER, weight: 10 },
      { value: Occupation.ELECTRICIAN, weight: 5 },
      { value: Occupation.LOCKSMITH, weight: 5 },
      { value: Occupation.TRAVELER, weight: 8 },
    ],
    monsterBiasKinds: [MonsterKind.SLIMEVIK, MonsterKind.SLIME_WOMAN, MonsterKind.CHERNOSLIZ, MonsterKind.HEAD_SLUG, MonsterKind.BEZEKHIY],
    monsterTags: ['slime', 'toxic', 'sample', 'quarantine', 'medical', 'lab', 'water', 'sealed'],
    npcPlacementKind: 'slime',
    monsterPlacementKind: 'slime',
    npcPlacement: {
      anchors: [
        { x: 512, y: 548, radius: 150, weight: 1.6 },
        { x: 648, y: 544, radius: 124, weight: 1.42 },
        { x: 372, y: 548, radius: 122, weight: 1.25 },
        { x: 512, y: 404, radius: 112, weight: 1.2 },
      ],
    },
    monsterPlacement: {
      anchors: [
        { x: 306, y: 560, radius: 118, weight: 1.85 },
        { x: 718, y: 560, radius: 118, weight: 1.85 },
        { x: 614, y: 632, radius: 126, weight: 1.48 },
        { x: 512, y: 400, radius: 116, weight: 1.15 },
      ],
    },
  },
  turing_nursery: {
    npcTarget: 1050,
    monsterTarget: 1450,
    npcNoun: 'лаборант яслей',
    npcFactions: [
      { value: Faction.SCIENTIST, weight: 50 },
      { value: Faction.LIQUIDATOR, weight: 26 },
      { value: Faction.CITIZEN, weight: 18 },
      { value: Faction.WILD, weight: 6 },
    ],
    npcOccupations: [
      { value: Occupation.SCIENTIST, weight: 36 },
      { value: Occupation.DOCTOR, weight: 18 },
      { value: Occupation.SECRETARY, weight: 14 },
      { value: Occupation.HUNTER, weight: 12 },
      { value: Occupation.ELECTRICIAN, weight: 8 },
      { value: Occupation.CHILD, weight: 6 },
      { value: Occupation.TRAVELER, weight: 6 },
    ],
    monsterBiasKinds: [
      MonsterKind.SLIMEVIK,
      MonsterKind.SLIME_WOMAN,
      MonsterKind.CHERNOSLIZ,
      MonsterKind.HEAD_SLUG,
      MonsterKind.TRUBNYY_AVTOMAT,
      MonsterKind.BEZEKHIY,
    ],
    monsterTags: ['turing', 'reaction_diffusion', 'nursery', 'slime', 'sample', 'inoculation', 'bridge', 'lab'],
    npcPlacementKind: 'slime',
    monsterPlacementKind: 'slime',
    npcPlacement: {
      anchors: [
        { x: 512, y: 560, radius: 148, weight: 1.58 },
        { x: 626, y: 528, radius: 118, weight: 1.38 },
        { x: 422, y: 438, radius: 112, weight: 1.22 },
        { x: 556, y: 374, radius: 96, weight: 1.12 },
      ],
    },
    monsterPlacement: {
      anchors: [
        { x: 372, y: 512, radius: 132, weight: 1.82 },
        { x: 560, y: 548, radius: 132, weight: 1.62 },
        { x: 632, y: 644, radius: 122, weight: 1.42 },
        { x: 512, y: 404, radius: 110, weight: 1.22 },
      ],
    },
  },
  manhattan_crossroads: {
    npcTarget: 3200,
    monsterTarget: 850,
    npcFactions: [{ value: Faction.CITIZEN, weight: 58 }, { value: Faction.WILD, weight: 25 }, { value: Faction.LIQUIDATOR, weight: 15 }, { value: Faction.SCIENTIST, weight: 2 }],
    npcOccupations: SOCIAL_OCCUPATIONS,
    monsterBiasKinds: [MonsterKind.REBAR, MonsterKind.SHADOW, MonsterKind.NELYUD, MonsterKind.BEZEKHIY, MonsterKind.EYE],
    npcPlacementKind: 'crossroads',
    monsterPlacementKind: 'crossroads',
  },
  voronoi_quarantine: {
    npcTarget: 980,
    monsterTarget: 1420,
    npcNoun: 'санитар ячейки',
    npcFactions: [
      { value: Faction.SCIENTIST, weight: 34 },
      { value: Faction.LIQUIDATOR, weight: 33 },
      { value: Faction.CITIZEN, weight: 25 },
      { value: Faction.WILD, weight: 8 },
    ],
    npcOccupations: [
      { value: Occupation.DOCTOR, weight: 30 },
      { value: Occupation.SECRETARY, weight: 18 },
      { value: Occupation.HUNTER, weight: 18 },
      { value: Occupation.STOREKEEPER, weight: 12 },
      { value: Occupation.TRAVELER, weight: 12 },
      { value: Occupation.ELECTRICIAN, weight: 10 },
    ],
    monsterBiasKinds: [MonsterKind.DIKIY_MERTVYAK, MonsterKind.HEAD_SLUG, MonsterKind.CHERNOSLIZ, MonsterKind.BEZEKHIY, MonsterKind.NELYUD],
    monsterTags: ['quarantine', 'infection', 'medical', 'corpse_pit', 'contaminated', 'border'],
    npcPlacementKind: 'slime',
    monsterPlacementKind: 'slime',
    npcPlacement: {
      anchors: [
        { x: 512, y: 250, radius: 112, weight: 1.48 },
        { x: 402, y: 370, radius: 132, weight: 1.32 },
        { x: 512, y: 512, radius: 146, weight: 1.18 },
        { x: 690, y: 660, radius: 118, weight: 1.3 },
      ],
    },
    monsterPlacement: {
      anchors: [
        { x: 706, y: 508, radius: 136, weight: 1.82 },
        { x: 440, y: 655, radius: 132, weight: 1.68 },
        { x: 270, y: 745, radius: 128, weight: 1.54 },
        { x: 595, y: 785, radius: 126, weight: 1.58 },
      ],
    },
  },
  communal_ring: {
    npcTarget: 3800,
    monsterTarget: 420,
    npcFactions: [{ value: Faction.CITIZEN, weight: 79 }, { value: Faction.WILD, weight: 12 }, { value: Faction.LIQUIDATOR, weight: 8 }, { value: Faction.SCIENTIST, weight: 1 }],
    npcOccupations: SOCIAL_OCCUPATIONS,
    monsterBiasKinds: [MonsterKind.KRYSNOZHKA, MonsterKind.POMOYNY_ROY, MonsterKind.NELYUD, MonsterKind.BEZEKHIY],
    monsterTags: ['residential', 'civil', 'corridor', 'kitchen', 'pantry', 'water', 'smoke', 'laundry', 'queue'],
    npcPlacementKind: 'communal',
    monsterPlacementKind: 'communal',
    npcPlacement: {
      anchors: COMMUNAL_NPC_ANCHORS,
    },
    monsterPlacement: {
      anchors: COMMUNAL_MONSTER_ANCHORS,
    },
  },
  moebius_podezd: {
    npcTarget: 3400,
    monsterTarget: 520,
    npcNoun: 'жилец',
    npcFactions: [{ value: Faction.CITIZEN, weight: 76 }, { value: Faction.WILD, weight: 13 }, { value: Faction.LIQUIDATOR, weight: 10 }, { value: Faction.SCIENTIST, weight: 1 }],
    npcOccupations: SOCIAL_OCCUPATIONS,
    monsterBiasKinds: [MonsterKind.SHOVNIK, MonsterKind.NELYUD, MonsterKind.KRYSNOZHKA, MonsterKind.POMOYNY_ROY, MonsterKind.SHADOW],
    monsterTags: ['residential', 'mirror', 'seam', 'shortcut', 'patrol', 'route_marker'],
    npcPlacementKind: 'communal',
    monsterPlacementKind: 'social',
    npcPlacement: {
      anchors: [
        { x: 256, y: 405, radius: 138, weight: 1.42 },
        { x: 768, y: 405, radius: 138, weight: 1.38 },
        { x: 256, y: 619, radius: 138, weight: 1.35 },
        { x: 768, y: 619, radius: 138, weight: 1.35 },
        { x: 512, y: 512, radius: 96, weight: 0.82 },
      ],
    },
    monsterPlacement: {
      anchors: [
        { x: 512, y: 510, radius: 94, weight: 1.8 },
        { x: 512, y: 548, radius: 120, weight: 1.42 },
        { x: 638, y: 638, radius: 92, weight: 1.22 },
        { x: 844, y: 512, radius: 128, weight: 1.15 },
      ],
    },
  },
  floor_69: {
    npcTarget: 2200,
    monsterTarget: 380,
    npcFactions: [{ value: Faction.CITIZEN, weight: 78 }, { value: Faction.LIQUIDATOR, weight: 14 }, { value: Faction.SCIENTIST, weight: 5 }, { value: Faction.WILD, weight: 3 }],
    npcOccupations: FLOOR_69_OCCUPATIONS,
    npcNoun: 'посетитель',
    monsterBiasKinds: [MonsterKind.NELYUD, MonsterKind.PECHATEED, MonsterKind.BEZEKHIY, MonsterKind.SHADOW],
    monsterTags: ['social', 'debt', 'refuge', 'clinic', 'raid', 'samosbor'],
    npcPlacementKind: 'floor_69',
    monsterPlacementKind: 'floor_69',
  },
  obschezhitie_smeny: {
    npcTarget: 2100,
    monsterTarget: 360,
    npcNoun: 'сменщик',
    npcFactions: [{ value: Faction.CITIZEN, weight: 74 }, { value: Faction.LIQUIDATOR, weight: 14 }, { value: Faction.WILD, weight: 10 }, { value: Faction.SCIENTIST, weight: 2 }],
    npcOccupations: [
      { value: Occupation.TURNER, weight: 26 },
      { value: Occupation.MECHANIC, weight: 20 },
      { value: Occupation.COOK, weight: 14 },
      { value: Occupation.STOREKEEPER, weight: 13 },
      { value: Occupation.LOCKSMITH, weight: 12 },
      { value: Occupation.HOUSEWIFE, weight: 8 },
      { value: Occupation.TRAVELER, weight: 7 },
    ],
    monsterBiasKinds: [MonsterKind.NELYUD, MonsterKind.SHADOW, MonsterKind.KRYSNOZHKA, MonsterKind.POMOYNY_ROY],
    monsterTags: ['residential', 'sleep', 'bunk', 'quiet_loot', 'witness', 'shelter', 'corridor'],
    npcPlacementKind: 'communal',
    monsterPlacementKind: 'social',
    npcPlacement: {
      bucketSize: 28,
      maxPerBucket: 8,
      anchors: [
        { x: 512, y: 510, radius: 170, weight: 1.75 },
        { x: 430, y: 458, radius: 118, weight: 1.35 },
        { x: 594, y: 560, radius: 118, weight: 1.35 },
        { x: 512, y: 608, radius: 96, weight: 1.12 },
      ],
    },
    monsterPlacement: {
      anchors: [
        { x: 690, y: 462, radius: 92, weight: 1.62 },
        { x: 420, y: 495, radius: 98, weight: 1.38 },
        { x: 572, y: 560, radius: 112, weight: 1.24 },
      ],
    },
  },
  penrose_laundry: {
    npcTarget: 1450,
    monsterTarget: 760,
    npcNoun: 'посетитель прачечной',
    npcFactions: [{ value: Faction.CITIZEN, weight: 70 }, { value: Faction.LIQUIDATOR, weight: 16 }, { value: Faction.WILD, weight: 10 }, { value: Faction.SCIENTIST, weight: 4 }],
    npcOccupations: [{ value: Occupation.HOUSEWIFE, weight: 25 }, { value: Occupation.LOCKSMITH, weight: 16 }, { value: Occupation.MECHANIC, weight: 14 }, { value: Occupation.TRAVELER, weight: 14 }, { value: Occupation.STOREKEEPER, weight: 12 }, { value: Occupation.ELECTRICIAN, weight: 8 }, { value: Occupation.SECRETARY, weight: 6 }, { value: Occupation.HUNTER, weight: 5 }],
    monsterBiasKinds: [MonsterKind.TUBE_EEL, MonsterKind.VODYANOY_KOSHMAR, MonsterKind.KRYSNOZHKA, MonsterKind.POLZUN, MonsterKind.BEZEKHIY, MonsterKind.PAUPSINA],
    monsterTags: ['laundry', 'water', 'steam', 'boiler', 'locked_cache', 'symbol_chain', 'service'],
    npcPlacementKind: 'communal',
    monsterPlacementKind: 'industrial',
    npcPlacement: {
      noiseScale: 78,
      noiseStrength: 0.16,
      openWeight: 0.78,
      bucketSize: 34,
      maxPerBucket: 6,
      roomWeights: {
        [RoomType.PRODUCTION]: 1.58,
        [RoomType.BATHROOM]: 1.5,
        [RoomType.STORAGE]: 1.24,
        [RoomType.CORRIDOR]: 0.86,
        [RoomType.COMMON]: 1.08,
        [RoomType.KITCHEN]: 0.84,
      },
      zoneWeights: {
        [ZoneFaction.CITIZEN]: 1.28,
        [ZoneFaction.LIQUIDATOR]: 1.06,
        [ZoneFaction.WILD]: 0.82,
        [ZoneFaction.SAMOSBOR]: 0.58,
      },
      anchors: [
        { x: 530, y: 489, radius: 118, weight: 1.7 },
        { x: 494, y: 565, radius: 110, weight: 1.54 },
        { x: 458, y: 543, radius: 92, weight: 1.28 },
        { x: 566, y: 516, radius: 98, weight: 1.18 },
      ],
    },
    monsterPlacement: {
      noiseScale: 104,
      noiseStrength: 0.22,
      openWeight: 1.1,
      bucketSize: 28,
      maxPerBucket: 8,
      roomWeights: {
        [RoomType.BATHROOM]: 2.05,
        [RoomType.PRODUCTION]: 1.68,
        [RoomType.STORAGE]: 1.42,
        [RoomType.CORRIDOR]: 1.12,
        [RoomType.COMMON]: 0.54,
        [RoomType.KITCHEN]: 0.48,
      },
      zoneWeights: {
        [ZoneFaction.SAMOSBOR]: 1.42,
        [ZoneFaction.WILD]: 1.26,
        [ZoneFaction.LIQUIDATOR]: 0.92,
        [ZoneFaction.CITIZEN]: 0.68,
      },
      anchors: [
        { x: 629, y: 508, radius: 96, weight: 1.82 },
        { x: 601, y: 469, radius: 92, weight: 1.58 },
        { x: 539, y: 546, radius: 104, weight: 1.48 },
        { x: 424, y: 565, radius: 88, weight: 1.38 },
      ],
    },
  },
  black_market_88: {
    npcTarget: 2200,
    monsterTarget: 700,
    npcFactions: [{ value: Faction.CITIZEN, weight: 48 }, { value: Faction.WILD, weight: 31 }, { value: Faction.LIQUIDATOR, weight: 14 }, { value: Faction.SCIENTIST, weight: 7 }],
    npcOccupations: SOCIAL_OCCUPATIONS,
    monsterBiasKinds: [MonsterKind.KRYSNOZHKA, MonsterKind.POMOYNY_ROY, MonsterKind.NELYUD, MonsterKind.BEZEKHIY, MonsterKind.SLIMEVIK],
    monsterTags: ['market', 'contraband', 'storage', 'service', 'smoke', 'crowd'],
    npcNoun: 'покупатель',
    npcPlacementKind: 'social',
    monsterPlacementKind: 'industrial',
    npcPlacement: {
      noiseScale: 72,
      noiseStrength: 0.18,
      openWeight: 0.82,
      roomWeights: {
        [RoomType.COMMON]: 1.72,
        [RoomType.CORRIDOR]: 1.38,
        [RoomType.OFFICE]: 1.46,
        [RoomType.HQ]: 1.24,
        [RoomType.MEDICAL]: 1.32,
        [RoomType.SMOKING]: 1.22,
        [RoomType.LIVING]: 1.02,
        [RoomType.KITCHEN]: 0.96,
        [RoomType.STORAGE]: 0.36,
        [RoomType.PRODUCTION]: 0.28,
      },
      zoneWeights: {
        [ZoneFaction.CITIZEN]: 1.24,
        [ZoneFaction.WILD]: 1.14,
        [ZoneFaction.LIQUIDATOR]: 1.02,
        [ZoneFaction.SAMOSBOR]: 0.62,
        [ZoneFaction.CULTIST]: 0.58,
      },
      anchors: [
        { x: 512, y: 500, radius: 160, weight: 1.35 },
        { x: 512, y: 596, radius: 150, weight: 1.24 },
        { x: 604, y: 448, radius: 92, weight: 1.18 },
        { x: 462, y: 574, radius: 92, weight: 1.18 },
      ],
    },
    monsterPlacement: {
      noiseScale: 96,
      noiseStrength: 0.11,
      openWeight: 0.32,
      smoothingPasses: 1,
      roomWeights: {
        [RoomType.STORAGE]: 6.2,
        [RoomType.PRODUCTION]: 5.8,
        [RoomType.BATHROOM]: 2.1,
        [RoomType.CORRIDOR]: 1.48,
        [RoomType.HQ]: 0.7,
        [RoomType.MEDICAL]: 0.46,
        [RoomType.OFFICE]: 0.34,
        [RoomType.KITCHEN]: 0.34,
        [RoomType.LIVING]: 0.28,
        [RoomType.COMMON]: 0.26,
      },
      zoneWeights: {
        [ZoneFaction.WILD]: 1.58,
        [ZoneFaction.SAMOSBOR]: 1.42,
        [ZoneFaction.LIQUIDATOR]: 1.08,
        [ZoneFaction.CITIZEN]: 0.54,
        [ZoneFaction.CULTIST]: 1.08,
      },
      anchors: [
        { x: 168, y: 626, radius: 120, weight: 2.1 },
        { x: 858, y: 622, radius: 120, weight: 2.1 },
        { x: 684, y: 364, radius: 110, weight: 1.85 },
        { x: 112, y: 512, radius: 150, weight: 1.65 },
        { x: 914, y: 512, radius: 150, weight: 1.65 },
        { x: 512, y: 708, radius: 130, weight: 1.5 },
      ],
    },
  },
  production_belt: {
    npcTarget: 1300,
    monsterTarget: 1250,
    npcFactions: [{ value: Faction.CITIZEN, weight: 48 }, { value: Faction.LIQUIDATOR, weight: 34 }, { value: Faction.WILD, weight: 12 }, { value: Faction.SCIENTIST, weight: 6 }],
    npcOccupations: [
      { value: Occupation.MECHANIC, weight: 24 },
      { value: Occupation.TURNER, weight: 22 },
      { value: Occupation.ELECTRICIAN, weight: 18 },
      { value: Occupation.LOCKSMITH, weight: 14 },
      { value: Occupation.STOREKEEPER, weight: 8 },
      { value: Occupation.HUNTER, weight: 8 },
      { value: Occupation.TRAVELER, weight: 4 },
      { value: Occupation.SCIENTIST, weight: 2 },
    ],
    monsterBiasKinds: [MonsterKind.ROBOT, MonsterKind.TRUBNYY_AVTOMAT, MonsterKind.RZHAVNIK, MonsterKind.TUBE_EEL, MonsterKind.REBAR],
    npcPlacementKind: 'industrial',
    monsterPlacementKind: 'industrial',
  },
  service_floor: {
    npcTarget: 780,
    monsterTarget: 1600,
    npcNoun: 'ремонтник',
    npcFactions: [
      { value: Faction.LIQUIDATOR, weight: 52 },
      { value: Faction.CITIZEN, weight: 28 },
      { value: Faction.WILD, weight: 13 },
      { value: Faction.SCIENTIST, weight: 7 },
    ],
    npcOccupations: [
      { value: Occupation.MECHANIC, weight: 27 },
      { value: Occupation.ELECTRICIAN, weight: 22 },
      { value: Occupation.HUNTER, weight: 16 },
      { value: Occupation.LOCKSMITH, weight: 13 },
      { value: Occupation.TURNER, weight: 10 },
      { value: Occupation.STOREKEEPER, weight: 6 },
      { value: Occupation.TRAVELER, weight: 4 },
      { value: Occupation.SCIENTIST, weight: 2 },
    ],
    monsterBiasKinds: [
      MonsterKind.TUBE_EEL,
      MonsterKind.TRUBNYY_AVTOMAT,
      MonsterKind.RZHAVNIK,
      MonsterKind.PAUPSINA,
      MonsterKind.POLZUN,
      MonsterKind.LOTOCHNIK,
      MonsterKind.VODYANOY_KOSHMAR,
    ],
    monsterTags: ['industrial', 'service', 'pipes', 'pressure', 'water', 'machine', 'cable', 'low'],
    npcPlacementKind: 'industrial',
    monsterPlacementKind: 'industrial',
    npcPlacement: {
      noiseScale: 80,
      noiseStrength: 0.16,
      openWeight: 0.58,
      smoothingPasses: 1,
      bucketSize: 36,
      maxPerBucket: 5,
      roomWeights: {
        [RoomType.PRODUCTION]: 1.48,
        [RoomType.OFFICE]: 1.52,
        [RoomType.KITCHEN]: 1.72,
        [RoomType.STORAGE]: 1.32,
        [RoomType.CORRIDOR]: 0.72,
        [RoomType.HQ]: 1.28,
      },
      zoneWeights: {
        [ZoneFaction.LIQUIDATOR]: 1.42,
        [ZoneFaction.CITIZEN]: 1.05,
        [ZoneFaction.WILD]: 0.54,
        [ZoneFaction.CULTIST]: 0.48,
        [ZoneFaction.SAMOSBOR]: 0.36,
      },
      anchors: [
        { x: 416.5, y: 514.5, radius: 92, weight: 1.75 },
        { x: 503.5, y: 495.5, radius: 82, weight: 1.66 },
        { x: 482.5, y: 533.5, radius: 68, weight: 1.78 },
        { x: 562.5, y: 534.5, radius: 72, weight: 1.68 },
        { x: 448.5, y: 532.5, radius: 58, weight: 1.52 },
      ],
    },
    monsterPlacement: {
      noiseScale: 112,
      noiseStrength: 0.21,
      openWeight: 1.38,
      bucketSize: 28,
      maxPerBucket: 10,
      roomWeights: {
        [RoomType.PRODUCTION]: 1.76,
        [RoomType.STORAGE]: 1.42,
        [RoomType.CORRIDOR]: 1.48,
        [RoomType.BATHROOM]: 1.28,
        [RoomType.OFFICE]: 0.62,
        [RoomType.KITCHEN]: 0.55,
        [RoomType.HQ]: 0.78,
      },
      zoneWeights: {
        [ZoneFaction.SAMOSBOR]: 1.45,
        [ZoneFaction.WILD]: 1.28,
        [ZoneFaction.CULTIST]: 1.12,
        [ZoneFaction.LIQUIDATOR]: 0.86,
        [ZoneFaction.CITIZEN]: 0.64,
      },
      anchors: [
        { x: 520.5, y: 324.5, radius: 170, weight: 1.35 },
        { x: 520.5, y: 700.5, radius: 170, weight: 1.35 },
        { x: 332.5, y: 438.5, radius: 128, weight: 1.54 },
        { x: 704.5, y: 590.5, radius: 128, weight: 1.54 },
        { x: 327.5, y: 680.5, radius: 96, weight: 1.62 },
        { x: 697.5, y: 680.5, radius: 96, weight: 1.62 },
        { x: 548.5, y: 494.5, radius: 74, weight: 1.5 },
        { x: 632.5, y: 514.5, radius: 82, weight: 1.42 },
      ],
    },
  },
  silicon_net_well: {
    npcTarget: 560,
    monsterTarget: 1900,
    npcFactions: [{ value: Faction.SCIENTIST, weight: 52 }, { value: Faction.LIQUIDATOR, weight: 32 }, { value: Faction.CITIZEN, weight: 10 }, { value: Faction.WILD, weight: 6 }],
    npcOccupations: [{ value: Occupation.SCIENTIST, weight: 42 }, { value: Occupation.ELECTRICIAN, weight: 18 }, { value: Occupation.MECHANIC, weight: 15 }, { value: Occupation.HUNTER, weight: 14 }, { value: Occupation.SECRETARY, weight: 6 }],
    npcNoun: 'специалист',
    monsterBiasKinds: [MonsterKind.SAFEGUARD, MonsterKind.SLIMEVIK, MonsterKind.SLIME_WOMAN, MonsterKind.CHERVIE_AVATAR, MonsterKind.CHERNOSLIZ, MonsterKind.HEAD_SLUG],
    monsterTags: ['net', 'silicon', 'slime', 'screen', 'lab', 'sample', 'water', 'industrial'],
    npcPlacementKind: 'silicon',
    monsterPlacementKind: 'silicon',
  },
  shahta_atrium: {
    npcTarget: 620,
    monsterTarget: 2100,
    npcNoun: 'ремонтник шахты',
    npcFactions: [
      { value: Faction.LIQUIDATOR, weight: 50 },
      { value: Faction.CITIZEN, weight: 28 },
      { value: Faction.SCIENTIST, weight: 12 },
      { value: Faction.WILD, weight: 10 },
    ],
    npcOccupations: [
      { value: Occupation.MECHANIC, weight: 30 },
      { value: Occupation.ELECTRICIAN, weight: 24 },
      { value: Occupation.LOCKSMITH, weight: 18 },
      { value: Occupation.HUNTER, weight: 14 },
      { value: Occupation.SCIENTIST, weight: 8 },
      { value: Occupation.TRAVELER, weight: 6 },
    ],
    monsterBiasKinds: [
      MonsterKind.REBAR,
      MonsterKind.TRUBNYY_AVTOMAT,
      MonsterKind.TUBE_EEL,
      MonsterKind.RZHAVNIK,
      MonsterKind.SHADOW,
      MonsterKind.TONKAYA_TEN,
    ],
    monsterTags: ['shaft', 'atrium', 'bridge', 'abyss', 'service_rim', 'cover', 'industrial', 'open_lane'],
    npcPlacementKind: 'industrial',
    monsterPlacementKind: 'industrial',
    npcPlacement: {
      noiseScale: 84,
      noiseStrength: 0.14,
      openWeight: 0.42,
      roomWeights: {
        [RoomType.PRODUCTION]: 2.1,
        [RoomType.OFFICE]: 1.65,
        [RoomType.COMMON]: 1.42,
        [RoomType.STORAGE]: 1.35,
        [RoomType.CORRIDOR]: 0.72,
      },
      zoneWeights: {
        [ZoneFaction.LIQUIDATOR]: 1.55,
        [ZoneFaction.CITIZEN]: 1.02,
        [ZoneFaction.WILD]: 0.58,
        [ZoneFaction.SAMOSBOR]: 0.3,
      },
      anchors: [
        { x: 952, y: 494, radius: 80, weight: 2.2 },
        { x: 512, y: 86, radius: 92, weight: 1.9 },
        { x: 556, y: 950, radius: 88, weight: 1.8 },
        { x: 74, y: 562, radius: 82, weight: 1.7 },
      ],
      bucketSize: 40,
      maxPerBucket: 5,
    },
    monsterPlacement: {
      noiseScale: 128,
      noiseStrength: 0.18,
      openWeight: 1.48,
      roomWeights: {
        [RoomType.CORRIDOR]: 1.82,
        [RoomType.PRODUCTION]: 1.42,
        [RoomType.STORAGE]: 1.18,
        [RoomType.COMMON]: 0.68,
        [RoomType.OFFICE]: 0.55,
      },
      zoneWeights: {
        [ZoneFaction.SAMOSBOR]: 1.65,
        [ZoneFaction.WILD]: 1.28,
        [ZoneFaction.CULTIST]: 1.05,
        [ZoneFaction.LIQUIDATOR]: 0.76,
        [ZoneFaction.CITIZEN]: 0.58,
      },
      anchors: [
        { x: 512, y: 512, radius: 170, weight: 2.3 },
        { x: 512, y: 300, radius: 132, weight: 1.8 },
        { x: 512, y: 724, radius: 132, weight: 1.8 },
        { x: 300, y: 512, radius: 132, weight: 1.72 },
        { x: 724, y: 512, radius: 132, weight: 1.72 },
        { x: 640, y: 382, radius: 118, weight: 1.48 },
      ],
      bucketSize: 28,
      maxPerBucket: 9,
    },
  },
  hyperbolic_switchyard: {
    npcTarget: 520,
    monsterTarget: 2300,
    npcNoun: 'стрелочник',
    npcFactions: [
      { value: Faction.LIQUIDATOR, weight: 48 },
      { value: Faction.CITIZEN, weight: 26 },
      { value: Faction.SCIENTIST, weight: 16 },
      { value: Faction.WILD, weight: 10 },
    ],
    npcOccupations: [
      { value: Occupation.ELECTRICIAN, weight: 28 },
      { value: Occupation.MECHANIC, weight: 22 },
      { value: Occupation.LOCKSMITH, weight: 18 },
      { value: Occupation.HUNTER, weight: 14 },
      { value: Occupation.SCIENTIST, weight: 10 },
      { value: Occupation.TRAVELER, weight: 8 },
    ],
    monsterBiasKinds: [
      MonsterKind.PSEUDOLIFT,
      MonsterKind.TUBE_EEL,
      MonsterKind.RZHAVNIK,
      MonsterKind.TRUBNYY_AVTOMAT,
      MonsterKind.SHADOW,
      MonsterKind.TONKAYA_TEN,
    ],
    monsterTags: ['hyperbolic', 'switchyard', 'arc', 'platform', 'shortcut', 'industrial', 'dark', 'pipe'],
    npcPlacementKind: 'industrial',
    monsterPlacementKind: 'industrial',
    npcPlacement: {
      noiseScale: 72,
      noiseStrength: 0.15,
      openWeight: 0.48,
      bucketSize: 38,
      maxPerBucket: 5,
      roomWeights: {
        [RoomType.HQ]: 2.15,
        [RoomType.OFFICE]: 1.7,
        [RoomType.PRODUCTION]: 1.42,
        [RoomType.COMMON]: 1.18,
        [RoomType.CORRIDOR]: 0.64,
        [RoomType.STORAGE]: 0.72,
      },
      anchors: [
        { x: 512, y: 512, radius: 96, weight: 1.8 },
        { x: 424, y: 470, radius: 70, weight: 1.45 },
        { x: 600, y: 470, radius: 70, weight: 1.45 },
        { x: 512, y: 390, radius: 72, weight: 1.32 },
        { x: 512, y: 634, radius: 72, weight: 1.22 },
      ],
    },
    monsterPlacement: {
      noiseScale: 124,
      noiseStrength: 0.22,
      openWeight: 1.42,
      bucketSize: 26,
      maxPerBucket: 11,
      roomWeights: {
        [RoomType.CORRIDOR]: 1.82,
        [RoomType.STORAGE]: 1.64,
        [RoomType.PRODUCTION]: 1.48,
        [RoomType.BATHROOM]: 1.22,
        [RoomType.COMMON]: 0.74,
        [RoomType.OFFICE]: 0.58,
        [RoomType.HQ]: 0.42,
      },
      zoneWeights: {
        [ZoneFaction.SAMOSBOR]: 1.5,
        [ZoneFaction.WILD]: 1.28,
        [ZoneFaction.CULTIST]: 1.12,
        [ZoneFaction.LIQUIDATOR]: 0.82,
        [ZoneFaction.CITIZEN]: 0.62,
      },
      anchors: [
        { x: 316, y: 512, radius: 150, weight: 1.72 },
        { x: 708, y: 512, radius: 150, weight: 1.72 },
        { x: 512, y: 296, radius: 124, weight: 1.58 },
        { x: 512, y: 728, radius: 124, weight: 1.58 },
        { x: 672, y: 672, radius: 96, weight: 1.94 },
        { x: 352, y: 672, radius: 96, weight: 1.62 },
      ],
    },
  },
  harmonic_bathhouse: {
    npcTarget: 760,
    monsterTarget: 1900,
    npcNoun: 'банный ремонтник',
    npcFactions: [
      { value: Faction.LIQUIDATOR, weight: 46 },
      { value: Faction.CITIZEN, weight: 30 },
      { value: Faction.SCIENTIST, weight: 12 },
      { value: Faction.WILD, weight: 12 },
    ],
    npcOccupations: [
      { value: Occupation.MECHANIC, weight: 28 },
      { value: Occupation.ELECTRICIAN, weight: 22 },
      { value: Occupation.LOCKSMITH, weight: 18 },
      { value: Occupation.DOCTOR, weight: 10 },
      { value: Occupation.HUNTER, weight: 10 },
      { value: Occupation.STOREKEEPER, weight: 7 },
      { value: Occupation.TRAVELER, weight: 5 },
    ],
    monsterBiasKinds: [
      MonsterKind.TUMANNIK,
      MonsterKind.VODYANOY_KOSHMAR,
      MonsterKind.TUBE_EEL,
      MonsterKind.TRUBNYY_AVTOMAT,
      MonsterKind.RZHAVNIK,
      MonsterKind.PAUPSINA,
    ],
    monsterTags: ['bathhouse', 'steam', 'water', 'pressure', 'boiler', 'industrial', 'wet'],
    npcPlacementKind: 'industrial',
    monsterPlacementKind: 'industrial',
    npcPlacement: {
      noiseScale: 78,
      noiseStrength: 0.16,
      openWeight: 0.52,
      bucketSize: 36,
      maxPerBucket: 5,
      roomWeights: {
        [RoomType.PRODUCTION]: 1.72,
        [RoomType.BATHROOM]: 1.48,
        [RoomType.COMMON]: 1.36,
        [RoomType.STORAGE]: 1.18,
        [RoomType.CORRIDOR]: 0.72,
      },
      zoneWeights: {
        [ZoneFaction.LIQUIDATOR]: 1.38,
        [ZoneFaction.CITIZEN]: 1.02,
        [ZoneFaction.WILD]: 0.74,
        [ZoneFaction.SAMOSBOR]: 0.5,
      },
      anchors: [
        { x: 512, y: 604, radius: 118, weight: 1.85 },
        { x: 512, y: 560, radius: 84, weight: 1.65 },
        { x: 430, y: 526, radius: 96, weight: 1.18 },
        { x: 628, y: 526, radius: 88, weight: 1.12 },
      ],
    },
    monsterPlacement: {
      noiseScale: 116,
      noiseStrength: 0.2,
      openWeight: 1.32,
      bucketSize: 28,
      maxPerBucket: 9,
      roomWeights: {
        [RoomType.BATHROOM]: 1.92,
        [RoomType.PRODUCTION]: 1.66,
        [RoomType.CORRIDOR]: 1.42,
        [RoomType.STORAGE]: 1.12,
        [RoomType.COMMON]: 0.64,
        [RoomType.OFFICE]: 0.48,
      },
      zoneWeights: {
        [ZoneFaction.SAMOSBOR]: 1.52,
        [ZoneFaction.WILD]: 1.34,
        [ZoneFaction.CULTIST]: 1.08,
        [ZoneFaction.LIQUIDATOR]: 0.82,
        [ZoneFaction.CITIZEN]: 0.56,
      },
      anchors: [
        { x: 634, y: 520, radius: 120, weight: 1.86 },
        { x: 388, y: 530, radius: 132, weight: 1.78 },
        { x: 512, y: 388, radius: 126, weight: 1.52 },
        { x: 630, y: 688, radius: 100, weight: 1.42 },
        { x: 512, y: 512, radius: 156, weight: 1.24 },
      ],
    },
  },
  hilbert_depot: {
    npcTarget: 520,
    monsterTarget: 1800,
    npcNoun: 'кладовщик индекса',
    npcFactions: [
      { value: Faction.LIQUIDATOR, weight: 46 },
      { value: Faction.CITIZEN, weight: 28 },
      { value: Faction.SCIENTIST, weight: 16 },
      { value: Faction.WILD, weight: 10 },
    ],
    npcOccupations: [
      { value: Occupation.STOREKEEPER, weight: 28 },
      { value: Occupation.MECHANIC, weight: 22 },
      { value: Occupation.ELECTRICIAN, weight: 18 },
      { value: Occupation.HUNTER, weight: 14 },
      { value: Occupation.SCIENTIST, weight: 10 },
      { value: Occupation.TRAVELER, weight: 8 },
    ],
    monsterBiasKinds: [
      MonsterKind.ROBOT,
      MonsterKind.RZHAVNIK,
      MonsterKind.TRUBNYY_AVTOMAT,
      MonsterKind.REBAR,
      MonsterKind.SAFEGUARD,
      MonsterKind.PSEUDOLIFT,
    ],
    monsterTags: ['hilbert', 'depot', 'index', 'storage', 'chord', 'industrial', 'shortcut', 'loot'],
    npcPlacementKind: 'industrial',
    monsterPlacementKind: 'industrial',
    npcPlacement: {
      noiseScale: 74,
      noiseStrength: 0.15,
      openWeight: 0.44,
      bucketSize: 38,
      maxPerBucket: 5,
      roomWeights: {
        [RoomType.STORAGE]: 2.0,
        [RoomType.PRODUCTION]: 1.48,
        [RoomType.CORRIDOR]: 0.82,
        [RoomType.COMMON]: 0.5,
        [RoomType.OFFICE]: 0.38,
      },
      zoneWeights: {
        [ZoneFaction.LIQUIDATOR]: 1.4,
        [ZoneFaction.CITIZEN]: 0.86,
        [ZoneFaction.WILD]: 0.48,
        [ZoneFaction.SAMOSBOR]: 0.32,
      },
      anchors: [
        { x: 260, y: 258, radius: 116, weight: 1.82 },
        { x: 512, y: 258, radius: 94, weight: 1.24 },
        { x: 512, y: 512, radius: 118, weight: 1.58 },
        { x: 766, y: 512, radius: 96, weight: 1.28 },
        { x: 766, y: 766, radius: 110, weight: 1.42 },
      ],
    },
    monsterPlacement: {
      noiseScale: 120,
      noiseStrength: 0.22,
      openWeight: 1.36,
      bucketSize: 28,
      maxPerBucket: 9,
      roomWeights: {
        [RoomType.CORRIDOR]: 1.78,
        [RoomType.STORAGE]: 1.6,
        [RoomType.PRODUCTION]: 1.36,
        [RoomType.BATHROOM]: 0.92,
        [RoomType.COMMON]: 0.6,
        [RoomType.OFFICE]: 0.44,
      },
      zoneWeights: {
        [ZoneFaction.SAMOSBOR]: 1.5,
        [ZoneFaction.WILD]: 1.26,
        [ZoneFaction.LIQUIDATOR]: 0.82,
        [ZoneFaction.CITIZEN]: 0.58,
        [ZoneFaction.CULTIST]: 0.72,
      },
      anchors: [
        { x: 256, y: 256, radius: 142, weight: 1.64 },
        { x: 256, y: 766, radius: 138, weight: 1.56 },
        { x: 512, y: 512, radius: 172, weight: 2.08 },
        { x: 766, y: 256, radius: 132, weight: 1.62 },
        { x: 766, y: 766, radius: 146, weight: 1.72 },
        { x: 640, y: 382, radius: 106, weight: 1.54 },
      ],
    },
  },
  dark_metro: {
    npcTarget: 180,
    monsterTarget: 3400,
    npcFactions: VETERAN_MIX,
    npcOccupations: VETERAN_OCCUPATIONS,
    npcNoun: 'ветеран',
    monsterBiasKinds: [MonsterKind.SHADOW, MonsterKind.TONKAYA_TEN, MonsterKind.GLUBINNAYA_TEN, MonsterKind.NELYUD, MonsterKind.TUBE_EEL],
    monsterTags: ['metro', 'rail', 'train', 'dark', 'tunnel', 'water', 'platform', 'industrial'],
    npcPlacementKind: 'metro',
    monsterPlacementKind: 'metro',
  },
  attractor_dvor: {
    npcTarget: 560,
    monsterTarget: 2100,
    npcNoun: 'дежурный потока',
    npcFactions: [
      { value: Faction.LIQUIDATOR, weight: 52 },
      { value: Faction.CITIZEN, weight: 22 },
      { value: Faction.SCIENTIST, weight: 16 },
      { value: Faction.WILD, weight: 10 },
    ],
    npcOccupations: [
      { value: Occupation.ELECTRICIAN, weight: 28 },
      { value: Occupation.MECHANIC, weight: 24 },
      { value: Occupation.HUNTER, weight: 18 },
      { value: Occupation.LOCKSMITH, weight: 14 },
      { value: Occupation.SCIENTIST, weight: 10 },
      { value: Occupation.TRAVELER, weight: 6 },
    ],
    monsterBiasKinds: [
      MonsterKind.VODYANOY_KOSHMAR,
      MonsterKind.TUBE_EEL,
      MonsterKind.TRUBNYY_AVTOMAT,
      MonsterKind.RZHAVNIK,
      MonsterKind.PSEUDOLIFT,
      MonsterKind.SAFEGUARD,
    ],
    monsterTags: ['attractor', 'flow', 'pump', 'dead_zone', 'patrol_loop', 'industrial', 'water', 'shortcut'],
    npcPlacementKind: 'industrial',
    monsterPlacementKind: 'industrial',
    npcPlacement: {
      anchors: [
        { x: 512, y: 512, radius: 116, weight: 1.72 },
        { x: 512, y: 268, radius: 98, weight: 1.42 },
        { x: 756, y: 512, radius: 96, weight: 1.28 },
        { x: 512, y: 756, radius: 98, weight: 1.36 },
      ],
      bucketSize: 38,
      maxPerBucket: 5,
    },
    monsterPlacement: {
      anchors: [
        { x: 512, y: 512, radius: 180, weight: 2.0 },
        { x: 300, y: 512, radius: 128, weight: 1.44 },
        { x: 724, y: 512, radius: 128, weight: 1.56 },
        { x: 512, y: 300, radius: 128, weight: 1.42 },
        { x: 512, y: 724, radius: 128, weight: 1.5 },
      ],
      bucketSize: 28,
      maxPerBucket: 10,
    },
  },
  underhell: {
    npcTarget: 64,
    monsterTarget: 4032,
    npcFactions: UNDERHELL_THRESHOLD_MIX,
    npcOccupations: UNDERHELL_THRESHOLD_OCCUPATIONS,
    npcNoun: 'ветеран',
    monsterBiasKinds: [
      MonsterKind.KOSTOREZ,
      MonsterKind.OLGOY,
      MonsterKind.POLZUN,
      MonsterKind.ZHORNAYA_TVAR,
      MonsterKind.CHERNOSLIZ,
      MonsterKind.ZAKALENNAYA_ARMATURA,
      MonsterKind.GLUBINNAYA_TEN,
    ],
    monsterTags: ['hell', 'meat', 'gate', 'threshold', 'cage', 'cult', 'liquidator', 'void'],
    npcPlacementKind: 'underhell',
    monsterPlacementKind: 'underhell',
  },
  podad: {
    npcTarget: 0,
    monsterTarget: 'active_actor_cap',
    monsterBiasKinds: [MonsterKind.OLGOY, MonsterKind.KOSTOREZ, MonsterKind.ZHORNAYA_TVAR, MonsterKind.CHERNOSLIZ, MonsterKind.POLZUN],
    monsterTags: ['hell', 'podad', 'meat', 'deep', 'living_tunnels', 'moving_walls', 'section_shift', 'gate'],
    monsterPlacementKind: 'hell',
    monsterPlacement: {
      noiseScale: 112,
      noiseStrength: 0.08,
      openWeight: 1.22,
      roomWeights: {
        [RoomType.CORRIDOR]: 1.38,
        [RoomType.PRODUCTION]: 1.22,
        [RoomType.STORAGE]: 1.18,
        [RoomType.HQ]: 0.82,
      },
      anchors: PODAD_MONSTER_ANCHORS,
      bucketSize: 28,
      maxPerBucket: 14,
    },
  },
  spectral_chasovnya: {
    npcTarget: 180,
    monsterTarget: 3916,
    npcFactions: [{ value: Faction.CULTIST, weight: 72 }, { value: Faction.LIQUIDATOR, weight: 18 }, { value: Faction.WILD, weight: 8 }, { value: Faction.SCIENTIST, weight: 2 }],
    npcOccupations: [{ value: Occupation.PRIEST, weight: 36 }, { value: Occupation.PILGRIM, weight: 28 }, { value: Occupation.HUNTER, weight: 18 }, { value: Occupation.TRAVELER, weight: 10 }, { value: Occupation.SCIENTIST, weight: 8 }],
    npcNoun: 'слушатель',
    monsterBiasKinds: [MonsterKind.SLEPOGLAZ, MonsterKind.TUMANNIK, MonsterKind.SPIRIT, MonsterKind.SHADOW, MonsterKind.TONKAYA_TEN, MonsterKind.GLUBINNAYA_TEN, MonsterKind.KHOROVAYA_MATKA],
    monsterTags: ['hell', 'cult', 'sound', 'noise', 'bell', 'acoustic_shadow', 'standing_wave', 'low_light'],
    npcPlacementKind: 'hell',
    monsterPlacementKind: 'hell',
    npcPlacement: {
      noiseScale: 84,
      noiseStrength: 0.13,
      openWeight: 0.28,
      roomWeights: {
        [RoomType.HQ]: 1.9,
        [RoomType.COMMON]: 1.48,
        [RoomType.OFFICE]: 1.32,
        [RoomType.STORAGE]: 1.1,
        [RoomType.CORRIDOR]: 0.58,
      },
      zoneWeights: {
        [ZoneFaction.CULTIST]: 1.65,
        [ZoneFaction.LIQUIDATOR]: 0.82,
        [ZoneFaction.SAMOSBOR]: 0.64,
        [ZoneFaction.WILD]: 0.74,
        [ZoneFaction.CITIZEN]: 0.24,
      },
      anchors: [
        { x: 512, y: 512, radius: 140, weight: 1.42 },
        { x: 456, y: 475, radius: 84, weight: 1.18 },
      ],
      bucketSize: 36,
      maxPerBucket: 5,
    },
    monsterPlacement: {
      noiseScale: 118,
      noiseStrength: 0.18,
      openWeight: 1.18,
      roomWeights: {
        [RoomType.COMMON]: 1.72,
        [RoomType.HQ]: 1.58,
        [RoomType.CORRIDOR]: 1.36,
        [RoomType.STORAGE]: 1.28,
        [RoomType.MEDICAL]: 1.18,
        [RoomType.PRODUCTION]: 1.12,
      },
      zoneWeights: {
        [ZoneFaction.SAMOSBOR]: 1.48,
        [ZoneFaction.CULTIST]: 1.28,
        [ZoneFaction.WILD]: 1.12,
        [ZoneFaction.LIQUIDATOR]: 0.58,
        [ZoneFaction.CITIZEN]: 0.32,
      },
      anchors: [
        { x: 510, y: 454, radius: 118, weight: 1.72 },
        { x: 552, y: 512, radius: 96, weight: 1.64 },
        { x: 532, y: 548, radius: 112, weight: 1.5 },
        { x: 512, y: 512, radius: 180, weight: 1.2 },
      ],
      bucketSize: 28,
      maxPerBucket: 12,
    },
  },
  cantor_pustoty: {
    npcTarget: 0,
    monsterTarget: 'active_actor_cap',
    monsterBiasKinds: [MonsterKind.SHADOW, MonsterKind.TONKAYA_TEN, MonsterKind.GLUBINNAYA_TEN, MonsterKind.LISHENNYY, MonsterKind.SPIRIT],
    monsterTags: ['void', 'cantor', 'fractal', 'gap_bridge', 'dust_island', 'low_light', 'route_pressure'],
    npcPlacementKind: 'void',
    monsterPlacementKind: 'void',
    monsterPlacement: {
      noiseScale: 112,
      noiseStrength: 0.16,
      openWeight: 0.82,
      roomWeights: {
        [RoomType.CORRIDOR]: 1.84,
        [RoomType.COMMON]: 0.82,
        [RoomType.LIVING]: 0.44,
        [RoomType.HQ]: 0.16,
      },
      zoneWeights: {
        [ZoneFaction.CULTIST]: 1.25,
        [ZoneFaction.WILD]: 1.15,
        [ZoneFaction.SAMOSBOR]: 1.35,
        [ZoneFaction.CITIZEN]: 0.82,
        [ZoneFaction.LIQUIDATOR]: 0.45,
      },
      anchors: METRO_MONSTER_ANCHORS,
      bucketSize: 42,
      maxPerBucket: 5,
    },
  },
  horrorfloor: {
    npcTarget: 0,
    monsterTarget: 0,
    monsterBiasKinds: [MonsterKind.GLUBINNAYA_TEN],
    monsterTags: ['dark', 'void'],
    monsterPlacementKind: 'void',
  },
  darkness: {
    npcTarget: 0,
    monsterTarget: 'active_actor_cap',
    monsterBiasKinds: [MonsterKind.SHADOW, MonsterKind.TONKAYA_TEN, MonsterKind.GLUBINNAYA_TEN, MonsterKind.LISHENNYY, MonsterKind.SLEPOGLAZ],
    monsterTags: ['dark', 'low_light', 'void', 'route_pressure', 'sound', 'noise', 'light', 'lamp', 'protocol'],
    monsterPlacementKind: 'void',
    monsterPlacement: {
      noiseScale: 112,
      noiseStrength: 0.16,
      openWeight: 0.82,
      roomWeights: {
        [RoomType.CORRIDOR]: 1.84,
        [RoomType.COMMON]: 0.82,
        [RoomType.LIVING]: 0.44,
        [RoomType.HQ]: 0.16,
      },
      zoneWeights: {
        [ZoneFaction.CULTIST]: 1.25,
        [ZoneFaction.WILD]: 1.15,
        [ZoneFaction.SAMOSBOR]: 1.35,
        [ZoneFaction.CITIZEN]: 0.82,
        [ZoneFaction.LIQUIDATOR]: 0.45,
      },
      anchors: DARKNESS_MONSTER_ANCHORS,
      bucketSize: 42,
      maxPerBucket: 5,
    },
  },
  liquidatorbase: { npcTarget: 5, monsterTarget: 2, monsterBiasKinds: [], monsterTags: [], monsterPlacementKind: 'roof' },
};

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function resolveActorTarget(value: number | 'active_actor_cap' | undefined, fallback: number): number {
  if (value === 'active_actor_cap') return activeActorSoftLimit();
  return activeActorCountAtDefaultSoftLimit(value ?? fallback);
}

function depth01(z: number): number {
  return Math.max(0, Math.min(1, Math.abs(z) / 50));
}

function baseNpcTarget(route: DesignFloorRouteDef): number {
  if (route.z <= -48 || Math.abs(route.z) >= 44) return 0;
  const cls = designFloorThemeClass(route);
  const habitation = Math.pow(Math.max(0, 1 - Math.abs(route.z) / 44), 1.7);
  const baseFloorMult = cls === FloorLevel.KVARTIRY ? 1.18
    : cls === FloorLevel.LIVING ? 1.08
      : cls === FloorLevel.MINISTRY ? 0.74
        : cls === FloorLevel.MAINTENANCE ? 0.54
          : cls === FloorLevel.HELL ? 0.16
            : 0;
  return clampInt((260 + habitation * 4200) * baseFloorMult, 0, DEFAULT_ACTIVE_ACTOR_SOFT_LIMIT);
}

function baseMonsterTarget(route: DesignFloorRouteDef): number {
  const cls = designFloorThemeClass(route);
  const edgePressure = Math.pow(depth01(route.z), 2.2);
  const baseFloorBonus = cls === FloorLevel.HELL ? 1600
    : cls === FloorLevel.VOID ? 1900
      : cls === FloorLevel.MAINTENANCE ? 420
        : cls === FloorLevel.KVARTIRY ? -180
          : cls === FloorLevel.LIVING ? -120
            : 0;
  return clampInt(220 + route.danger * 120 + edgePressure * 7200 + baseFloorBonus, 0, DEFAULT_ACTIVE_ACTOR_SOFT_LIMIT);
}

function defaultNpcFactions(route: DesignFloorRouteDef): readonly WeightedDesignValue<Faction>[] {
  const cls = designFloorThemeClass(route);
  if (cls === FloorLevel.MAINTENANCE) return INDUSTRIAL_MIX;
  if (cls === FloorLevel.HELL) return VETERAN_MIX;
  if (cls === FloorLevel.MINISTRY) return ADMIN_MIX;
  return CITIZEN_MIX;
}

function defaultNpcOccupations(route: DesignFloorRouteDef): readonly WeightedDesignValue<Occupation>[] {
  const cls = designFloorThemeClass(route);
  if (cls === FloorLevel.MAINTENANCE) return INDUSTRIAL_OCCUPATIONS;
  if (cls === FloorLevel.HELL) return VETERAN_OCCUPATIONS;
  if (cls === FloorLevel.MINISTRY) return ADMIN_OCCUPATIONS;
  return SOCIAL_OCCUPATIONS;
}

function defaultNpcNoun(route: DesignFloorRouteDef): string {
  const cls = designFloorThemeClass(route);
  if (cls === FloorLevel.MAINTENANCE) return 'работник';
  if (cls === FloorLevel.HELL) return 'паломник';
  if (cls === FloorLevel.MINISTRY) return 'служащий';
  return 'житель';
}

function defaultPlacementKind(route: DesignFloorRouteDef): PlacementKind {
  const cls = designFloorThemeClass(route);
  if (cls === FloorLevel.MAINTENANCE) return 'industrial';
  if (cls === FloorLevel.HELL) return 'hell';
  if (cls === FloorLevel.VOID) return 'void';
  if (cls === FloorLevel.MINISTRY) return 'admin';
  return 'social';
}

function placementProfile(kind: PlacementKind, actor: 'npc' | 'monster', target: number): DesignPlacementFieldProfile {
  const maxPerBucket = actor === 'npc'
    ? Math.max(2, Math.min(10, Math.ceil(target / 520)))
    : Math.max(3, Math.min(18, Math.ceil(target / 620)));
  const base: DesignPlacementFieldProfile = {
    noiseScale: actor === 'npc' ? 96 : 128,
    noiseStrength: actor === 'npc' ? 0.22 : 0.18,
    openWeight: actor === 'npc' ? 1.0 : 1.05,
    bucketSize: actor === 'npc' ? 32 : 28,
    maxPerBucket,
    smoothingPasses: 2,
    smoothingBlend: 0.55,
  };
  switch (kind) {
    case 'social':
      return {
        ...base,
        roomWeights: actor === 'npc'
          ? { [RoomType.LIVING]: 1.45, [RoomType.KITCHEN]: 1.5, [RoomType.COMMON]: 1.35, [RoomType.CORRIDOR]: 1.2, [RoomType.SMOKING]: 1.15, [RoomType.STORAGE]: 0.75 }
          : { [RoomType.STORAGE]: 1.45, [RoomType.CORRIDOR]: 1.25, [RoomType.BATHROOM]: 1.15, [RoomType.SMOKING]: 1.1, [RoomType.KITCHEN]: 0.72, [RoomType.LIVING]: 0.65 },
        zoneWeights: actor === 'npc'
          ? { [ZoneFaction.CITIZEN]: 1.18, [ZoneFaction.WILD]: 1.08, [ZoneFaction.LIQUIDATOR]: 0.9, [ZoneFaction.CULTIST]: 0.72 }
          : { [ZoneFaction.WILD]: 1.28, [ZoneFaction.CULTIST]: 1.2, [ZoneFaction.LIQUIDATOR]: 1.04, [ZoneFaction.CITIZEN]: 0.84 },
      };
    case 'floor_69':
      return {
        ...base,
        noiseScale: actor === 'npc' ? 84 : 112,
        noiseStrength: actor === 'npc' ? 0.2 : 0.14,
        maxPerBucket: actor === 'npc' ? Math.max(base.maxPerBucket ?? 0, 7) : base.maxPerBucket,
        roomWeights: actor === 'npc'
          ? {
            [RoomType.COMMON]: 1.62,
            [RoomType.MEDICAL]: 1.48,
            [RoomType.OFFICE]: 1.42,
            [RoomType.HQ]: 1.35,
            [RoomType.LIVING]: 1.26,
            [RoomType.CORRIDOR]: 1.18,
            [RoomType.SMOKING]: 1.08,
            [RoomType.STORAGE]: 0.78,
            [RoomType.PRODUCTION]: 0.62,
            [RoomType.BATHROOM]: 0.68,
          }
          : {
            [RoomType.STORAGE]: 1.45,
            [RoomType.CORRIDOR]: 1.24,
            [RoomType.HQ]: 1.12,
            [RoomType.OFFICE]: 0.96,
            [RoomType.PRODUCTION]: 1.18,
            [RoomType.COMMON]: 0.72,
            [RoomType.LIVING]: 0.62,
            [RoomType.MEDICAL]: 0.55,
          },
        zoneWeights: actor === 'npc'
          ? { [ZoneFaction.CITIZEN]: 1.22, [ZoneFaction.LIQUIDATOR]: 1.08, [ZoneFaction.WILD]: 0.72, [ZoneFaction.CULTIST]: 0.55, [ZoneFaction.SAMOSBOR]: 0.48 }
          : { [ZoneFaction.WILD]: 1.24, [ZoneFaction.SAMOSBOR]: 1.18, [ZoneFaction.CULTIST]: 1.1, [ZoneFaction.LIQUIDATOR]: 0.92, [ZoneFaction.CITIZEN]: 0.78 },
        anchors: actor === 'npc'
          ? [
            { x: 482, y: 503, radius: 44, weight: 1.42 },
            { x: 510, y: 498, radius: 58, weight: 1.36 },
            { x: 538, y: 501, radius: 44, weight: 1.32 },
            { x: 538, y: 522, radius: 50, weight: 1.34 },
            { x: 554, y: 524, radius: 80, weight: 1.22 },
            { x: 790, y: 640, radius: 58, weight: 1.18 },
          ]
          : [
            { x: 554, y: 524, radius: 110, weight: 1.28 },
            { x: 736, y: 552, radius: 150, weight: 1.2 },
            { x: 904, y: 608, radius: 90, weight: 1.16 },
          ],
      };
    case 'communal':
      return {
        ...base,
        roomWeights: actor === 'npc'
          ? {
            [RoomType.KITCHEN]: 1.82,
            [RoomType.COMMON]: 1.72,
            [RoomType.LIVING]: 1.5,
            [RoomType.BATHROOM]: 1.36,
            [RoomType.PRODUCTION]: 1.34,
            [RoomType.CORRIDOR]: 1.24,
            [RoomType.SMOKING]: 1.12,
            [RoomType.OFFICE]: 1.0,
            [RoomType.STORAGE]: 0.78,
            [RoomType.HQ]: 0.62,
          }
          : {
            [RoomType.STORAGE]: 1.72,
            [RoomType.PRODUCTION]: 1.42,
            [RoomType.CORRIDOR]: 1.24,
            [RoomType.BATHROOM]: 1.18,
            [RoomType.SMOKING]: 1.08,
            [RoomType.COMMON]: 0.9,
            [RoomType.KITCHEN]: 0.66,
            [RoomType.LIVING]: 0.58,
            [RoomType.OFFICE]: 0.78,
          },
        zoneWeights: actor === 'npc'
          ? { [ZoneFaction.CITIZEN]: 1.22, [ZoneFaction.WILD]: 1.1, [ZoneFaction.LIQUIDATOR]: 1.02, [ZoneFaction.SAMOSBOR]: 0.76, [ZoneFaction.CULTIST]: 0.62 }
          : { [ZoneFaction.SAMOSBOR]: 1.38, [ZoneFaction.WILD]: 1.24, [ZoneFaction.CULTIST]: 1.08, [ZoneFaction.LIQUIDATOR]: 0.98, [ZoneFaction.CITIZEN]: 0.74 },
      };
	    case 'admin':
      return {
        ...base,
        roomWeights: actor === 'npc'
          ? { [RoomType.OFFICE]: 1.8, [RoomType.COMMON]: 1.55, [RoomType.HQ]: 1.5, [RoomType.CORRIDOR]: 1.08, [RoomType.STORAGE]: 0.78, [RoomType.SMOKING]: 1.05 }
          : { [RoomType.STORAGE]: 2.1, [RoomType.CORRIDOR]: 1.45, [RoomType.HQ]: 1.22, [RoomType.OFFICE]: 1.05, [RoomType.SMOKING]: 1.16, [RoomType.COMMON]: 0.62 },
        zoneWeights: actor === 'npc'
          ? { [ZoneFaction.CITIZEN]: 1.18, [ZoneFaction.LIQUIDATOR]: 1.38, [ZoneFaction.WILD]: 0.68, [ZoneFaction.CULTIST]: 0.56, [ZoneFaction.SAMOSBOR]: 0.42 }
          : { [ZoneFaction.SAMOSBOR]: 1.52, [ZoneFaction.WILD]: 1.28, [ZoneFaction.CULTIST]: 1.16, [ZoneFaction.LIQUIDATOR]: 0.94, [ZoneFaction.CITIZEN]: 0.72 },
      };
    case 'bank':
      return actor === 'npc'
        ? {
          ...base,
          noiseScale: 84,
          noiseStrength: 0.16,
          bucketSize: 24,
          maxPerBucket: Math.max(base.maxPerBucket ?? 0, 7),
          smoothingPasses: 3,
          smoothingBlend: 0.62,
          roomWeights: { [RoomType.COMMON]: 1.82, [RoomType.OFFICE]: 1.62, [RoomType.HQ]: 1.5, [RoomType.CORRIDOR]: 0.98, [RoomType.STORAGE]: 0.82 },
          zoneWeights: { [ZoneFaction.CITIZEN]: 1.12, [ZoneFaction.LIQUIDATOR]: 1.24, [ZoneFaction.WILD]: 0.94, [ZoneFaction.CULTIST]: 0.62, [ZoneFaction.SAMOSBOR]: 0.55 },
          anchors: [
            { x: 514, y: 512, radius: 120, weight: 1.55 },
            { x: 506, y: 548, radius: 62, weight: 2.55 },
            { x: 512, y: 480, radius: 54, weight: 1.95 },
            { x: 573, y: 510, radius: 52, weight: 1.85 },
            { x: 610, y: 512, radius: 58, weight: 1.55 },
            { x: 512, y: 358, radius: 96, weight: 1.5 },
          ],
        }
        : {
          ...base,
          noiseScale: 112,
          noiseStrength: 0.12,
          bucketSize: 26,
          maxPerBucket: Math.max(base.maxPerBucket ?? 0, 5),
          smoothingPasses: 3,
          smoothingBlend: 0.58,
          roomWeights: { [RoomType.STORAGE]: 2.05, [RoomType.CORRIDOR]: 1.38, [RoomType.HQ]: 1.22, [RoomType.OFFICE]: 1.18, [RoomType.COMMON]: 0.66 },
          zoneWeights: { [ZoneFaction.SAMOSBOR]: 1.3, [ZoneFaction.WILD]: 1.16, [ZoneFaction.CULTIST]: 1.12, [ZoneFaction.LIQUIDATOR]: 0.98, [ZoneFaction.CITIZEN]: 0.86 },
          anchors: [
            { x: 603, y: 515, radius: 74, weight: 2.85 },
            { x: 756, y: 294, radius: 82, weight: 2.1 },
            { x: 573, y: 540, radius: 72, weight: 2.0 },
            { x: 528, y: 478, radius: 50, weight: 1.7 },
            { x: 612, y: 552, radius: 72, weight: 1.9 },
            { x: 512, y: 733, radius: 92, weight: 1.85 },
          ],
        };
    case 'industrial':
      return {
        ...base,
        roomWeights: actor === 'npc'
          ? { [RoomType.PRODUCTION]: 1.58, [RoomType.HQ]: 1.38, [RoomType.COMMON]: 1.22, [RoomType.OFFICE]: 1.18, [RoomType.STORAGE]: 1.02, [RoomType.CORRIDOR]: 0.96 }
          : { [RoomType.PRODUCTION]: 1.58, [RoomType.STORAGE]: 1.46, [RoomType.CORRIDOR]: 1.32, [RoomType.BATHROOM]: 1.12, [RoomType.COMMON]: 0.82, [RoomType.OFFICE]: 0.72, [RoomType.HQ]: 0.68 },
        zoneWeights: actor === 'npc'
          ? { [ZoneFaction.LIQUIDATOR]: 1.22, [ZoneFaction.CITIZEN]: 1.0, [ZoneFaction.WILD]: 0.96, [ZoneFaction.CULTIST]: 0.78 }
          : { [ZoneFaction.SAMOSBOR]: 1.24, [ZoneFaction.WILD]: 1.14, [ZoneFaction.CULTIST]: 1.1, [ZoneFaction.LIQUIDATOR]: 0.94 },
      };
    case 'silicon':
      return {
        ...base,
        noiseScale: actor === 'npc' ? 76 : 118,
        noiseStrength: actor === 'npc' ? 0.14 : 0.18,
        openWeight: actor === 'npc' ? 0.78 : 1.18,
        bucketSize: actor === 'npc' ? 30 : 28,
        roomWeights: actor === 'npc'
          ? {
            [RoomType.MEDICAL]: 1.82,
            [RoomType.HQ]: 1.58,
            [RoomType.PRODUCTION]: 1.32,
            [RoomType.OFFICE]: 1.28,
            [RoomType.STORAGE]: 0.88,
            [RoomType.CORRIDOR]: 0.72,
            [RoomType.COMMON]: 0.54,
            [RoomType.BATHROOM]: 0.58,
          }
          : {
            [RoomType.COMMON]: 1.58,
            [RoomType.CORRIDOR]: 1.46,
            [RoomType.STORAGE]: 1.36,
            [RoomType.BATHROOM]: 1.24,
            [RoomType.PRODUCTION]: 1.18,
            [RoomType.OFFICE]: 0.76,
            [RoomType.HQ]: 0.68,
            [RoomType.MEDICAL]: 0.56,
          },
        zoneWeights: actor === 'npc'
          ? { [ZoneFaction.LIQUIDATOR]: 1.46, [ZoneFaction.CITIZEN]: 0.92, [ZoneFaction.CULTIST]: 0.62, [ZoneFaction.WILD]: 0.58, [ZoneFaction.SAMOSBOR]: 0.34 }
          : { [ZoneFaction.SAMOSBOR]: 1.56, [ZoneFaction.WILD]: 1.32, [ZoneFaction.CULTIST]: 1.08, [ZoneFaction.CITIZEN]: 0.78, [ZoneFaction.LIQUIDATOR]: 0.58 },
      };
    case 'slime':
      return {
        ...base,
        noiseScale: actor === 'npc' ? 88 : 112,
        noiseStrength: actor === 'npc' ? 0.18 : 0.14,
        openWeight: actor === 'npc' ? 0.84 : 1.08,
        bucketSize: actor === 'npc' ? 30 : 28,
        maxPerBucket: actor === 'npc'
          ? Math.max(3, Math.min(8, Math.ceil(target / 390)))
          : Math.max(4, Math.min(12, Math.ceil(target / 430))),
        roomWeights: actor === 'npc'
          ? {
            [RoomType.MEDICAL]: 1.78,
            [RoomType.PRODUCTION]: 1.5,
            [RoomType.OFFICE]: 1.36,
            [RoomType.HQ]: 1.3,
            [RoomType.COMMON]: 1.08,
            [RoomType.CORRIDOR]: 0.94,
            [RoomType.STORAGE]: 0.8,
            [RoomType.BATHROOM]: 0.62,
          }
          : {
            [RoomType.MEDICAL]: 1.58,
            [RoomType.PRODUCTION]: 1.54,
            [RoomType.BATHROOM]: 1.42,
            [RoomType.STORAGE]: 1.36,
            [RoomType.CORRIDOR]: 1.24,
            [RoomType.COMMON]: 0.78,
            [RoomType.OFFICE]: 0.64,
            [RoomType.HQ]: 0.58,
          },
        zoneWeights: actor === 'npc'
          ? { [ZoneFaction.LIQUIDATOR]: 1.22, [ZoneFaction.CITIZEN]: 1.04, [ZoneFaction.WILD]: 0.78, [ZoneFaction.CULTIST]: 0.58, [ZoneFaction.SAMOSBOR]: 0.38 }
          : { [ZoneFaction.WILD]: 1.26, [ZoneFaction.SAMOSBOR]: 1.18, [ZoneFaction.LIQUIDATOR]: 1.02, [ZoneFaction.CULTIST]: 0.92, [ZoneFaction.CITIZEN]: 0.76 },
      };
    case 'attic': {
      const atticBase: DesignPlacementFieldProfile = actor === 'monster'
        ? {
          ...base,
          noiseScale: 112,
          noiseStrength: 0.12,
          openWeight: 0.78,
          bucketSize: 16,
          maxPerBucket: Math.max(5, Math.min(8, Math.ceil(target / 700))),
        }
        : base;
      return {
        ...atticBase,
        roomWeights: actor === 'npc'
          ? { [RoomType.HQ]: 1.35, [RoomType.PRODUCTION]: 1.2, [RoomType.STORAGE]: 1.05, [RoomType.CORRIDOR]: 0.9, [RoomType.OFFICE]: 0.72 }
          : { [RoomType.PRODUCTION]: 1.85, [RoomType.CORRIDOR]: 1.62, [RoomType.STORAGE]: 1.46, [RoomType.HQ]: 1.08, [RoomType.COMMON]: 0.74, [RoomType.OFFICE]: 0.42 },
        zoneWeights: actor === 'npc'
          ? { [ZoneFaction.LIQUIDATOR]: 1.18, [ZoneFaction.CULTIST]: 1.0, [ZoneFaction.WILD]: 0.82, [ZoneFaction.CITIZEN]: 0.62, [ZoneFaction.SAMOSBOR]: 0.35 }
          : { [ZoneFaction.SAMOSBOR]: 1.42, [ZoneFaction.CULTIST]: 1.28, [ZoneFaction.WILD]: 1.16, [ZoneFaction.LIQUIDATOR]: 0.82, [ZoneFaction.CITIZEN]: 0.46 },
      };
    }
    case 'hell':
      return {
        ...base,
        noiseStrength: actor === 'npc' ? 0.12 : 0.08,
        roomWeights: actor === 'npc'
          ? { [RoomType.HQ]: 1.65, [RoomType.CORRIDOR]: 1.05, [RoomType.STORAGE]: 0.95 }
          : { [RoomType.CORRIDOR]: 1.28, [RoomType.STORAGE]: 1.16, [RoomType.HQ]: 0.92 },
        zoneWeights: actor === 'npc'
          ? { [ZoneFaction.LIQUIDATOR]: 1.24, [ZoneFaction.CULTIST]: 1.2, [ZoneFaction.WILD]: 0.92, [ZoneFaction.CITIZEN]: 0.64 }
          : { [ZoneFaction.CULTIST]: 1.18, [ZoneFaction.SAMOSBOR]: 1.28, [ZoneFaction.WILD]: 1.06, [ZoneFaction.LIQUIDATOR]: 0.88 },
      };
    case 'underhell':
      return {
        ...base,
        noiseScale: actor === 'npc' ? 112 : 150,
        noiseStrength: actor === 'npc' ? 0.08 : 0.07,
        openWeight: actor === 'npc' ? 0.42 : 1.0,
        bucketSize: actor === 'npc' ? 40 : 28,
        maxPerBucket: actor === 'npc'
          ? Math.max(2, Math.min(4, Math.ceil(target / 34)))
          : Math.max(8, Math.min(16, Math.ceil(target / 560))),
        roomWeights: actor === 'npc'
          ? {
            [RoomType.HQ]: 2.1,
            [RoomType.PRODUCTION]: 1.05,
            [RoomType.STORAGE]: 0.7,
            [RoomType.CORRIDOR]: 0.58,
            [RoomType.COMMON]: 0.45,
          }
          : {
            [RoomType.CORRIDOR]: 1.58,
            [RoomType.STORAGE]: 1.38,
            [RoomType.PRODUCTION]: 1.32,
            [RoomType.COMMON]: 1.08,
            [RoomType.HQ]: 0.74,
          },
        zoneWeights: actor === 'npc'
          ? {
            [ZoneFaction.LIQUIDATOR]: 1.48,
            [ZoneFaction.CULTIST]: 1.34,
            [ZoneFaction.WILD]: 0.35,
            [ZoneFaction.SAMOSBOR]: 0.32,
            [ZoneFaction.CITIZEN]: 0.2,
          }
          : {
            [ZoneFaction.CULTIST]: 1.32,
            [ZoneFaction.SAMOSBOR]: 1.45,
            [ZoneFaction.WILD]: 1.12,
            [ZoneFaction.LIQUIDATOR]: 0.68,
            [ZoneFaction.CITIZEN]: 0.35,
          },
        anchors: actor === 'npc'
          ? [
            { x: 512, y: 565, radius: 86, weight: 1.65 },
            { x: 512, y: 622, radius: 74, weight: 1.45 },
            { x: 443, y: 652, radius: 64, weight: 1.22 },
            { x: 581, y: 652, radius: 64, weight: 1.22 },
            { x: 512, y: 512, radius: 58, weight: 0.42 },
          ]
          : [
            { x: 512, y: 764, radius: 150, weight: 1.75 },
            { x: 512, y: 702, radius: 118, weight: 1.55 },
            { x: 432, y: 644, radius: 106, weight: 1.36 },
            { x: 592, y: 644, radius: 106, weight: 1.36 },
            { x: 512, y: 512, radius: 76, weight: 0.4 },
            { x: 448, y: 526, radius: 64, weight: 0.55 },
          ],
      };
    case 'void':
      return {
        ...base,
        noiseScale: 160,
        noiseStrength: 0.08,
        roomWeights: { [RoomType.CORRIDOR]: 1.25, [RoomType.STORAGE]: 1.1, [RoomType.HQ]: 0.85 },
        zoneWeights: { [ZoneFaction.SAMOSBOR]: 1.35, [ZoneFaction.CULTIST]: 1.08, [ZoneFaction.WILD]: 1.0, [ZoneFaction.CITIZEN]: 0.72 },
      };
    case 'roof':
      return {
        ...base,
        noiseScale: 208,
        noiseStrength: 0.08,
        openWeight: 1.1,
        bucketSize: 18,
        maxPerBucket: Math.max(base.maxPerBucket ?? 0, Math.min(32, Math.ceil(target / 180))),
        roomWeights: { [RoomType.PRODUCTION]: 1.75, [RoomType.HQ]: 1.4, [RoomType.CORRIDOR]: 1.28, [RoomType.STORAGE]: 1.18, [RoomType.COMMON]: 1.05, [RoomType.OFFICE]: 0.72 },
        zoneWeights: { [ZoneFaction.SAMOSBOR]: 1.28, [ZoneFaction.WILD]: 1.22, [ZoneFaction.CITIZEN]: 0.86, [ZoneFaction.LIQUIDATOR]: 0.92 },
      };
    case 'camp':
      return {
        ...base,
        noiseScale: actor === 'npc' ? 82 : 118,
        noiseStrength: actor === 'npc' ? 0.16 : 0.14,
        bucketSize: actor === 'npc' ? 28 : 30,
        maxPerBucket: actor === 'npc'
          ? Math.max(3, Math.min(8, Math.ceil(target / 360)))
          : Math.max(3, Math.min(12, Math.ceil(target / 430))),
        anchors: actor === 'npc' ? CAMP_NPC_ANCHORS : CAMP_MONSTER_ANCHORS,
        roomWeights: actor === 'npc'
          ? { [RoomType.COMMON]: 1.78, [RoomType.KITCHEN]: 1.64, [RoomType.MEDICAL]: 1.5, [RoomType.PRODUCTION]: 1.34, [RoomType.LIVING]: 1.28, [RoomType.CORRIDOR]: 1.08, [RoomType.BATHROOM]: 0.82, [RoomType.STORAGE]: 0.58 }
          : { [RoomType.STORAGE]: 1.68, [RoomType.CORRIDOR]: 1.42, [RoomType.BATHROOM]: 1.34, [RoomType.LIVING]: 1.12, [RoomType.PRODUCTION]: 0.86, [RoomType.COMMON]: 0.58, [RoomType.KITCHEN]: 0.48, [RoomType.MEDICAL]: 0.44 },
        zoneWeights: actor === 'npc'
          ? { [ZoneFaction.CITIZEN]: 1.38, [ZoneFaction.LIQUIDATOR]: 0.78, [ZoneFaction.WILD]: 0.42, [ZoneFaction.SAMOSBOR]: 0.26, [ZoneFaction.CULTIST]: 0.34 }
          : { [ZoneFaction.WILD]: 1.72, [ZoneFaction.SAMOSBOR]: 1.42, [ZoneFaction.LIQUIDATOR]: 1.06, [ZoneFaction.CITIZEN]: 0.48, [ZoneFaction.CULTIST]: 1.04 },
      };
    case 'morgue':
      return {
        ...base,
        noiseScale: actor === 'npc' ? 84 : 142,
        noiseStrength: actor === 'npc' ? 0.16 : 0.1,
        roomWeights: actor === 'npc'
          ? { [RoomType.OFFICE]: 1.72, [RoomType.MEDICAL]: 1.26, [RoomType.CORRIDOR]: 1.05, [RoomType.COMMON]: 0.92, [RoomType.STORAGE]: 0.58 }
          : { [RoomType.STORAGE]: 1.82, [RoomType.MEDICAL]: 1.46, [RoomType.CORRIDOR]: 1.34, [RoomType.COMMON]: 0.74, [RoomType.OFFICE]: 0.68 },
        zoneWeights: actor === 'npc'
          ? { [ZoneFaction.LIQUIDATOR]: 1.24, [ZoneFaction.CITIZEN]: 1.1, [ZoneFaction.WILD]: 0.66, [ZoneFaction.CULTIST]: 0.58, [ZoneFaction.SAMOSBOR]: 0.42 }
          : { [ZoneFaction.SAMOSBOR]: 1.46, [ZoneFaction.CULTIST]: 1.18, [ZoneFaction.WILD]: 1.08, [ZoneFaction.LIQUIDATOR]: 0.92, [ZoneFaction.CITIZEN]: 0.7 },
      };
    case 'crossroads':
      return {
        ...base,
        noiseScale: actor === 'npc' ? 72 : 104,
        noiseStrength: actor === 'npc' ? 0.16 : 0.12,
        bucketSize: actor === 'npc' ? 28 : 30,
        maxPerBucket: actor === 'npc'
          ? Math.max(4, Math.min(8, Math.ceil(target / 620)))
          : Math.max(3, Math.min(10, Math.ceil(target / 700))),
        smoothingPasses: 3,
        smoothingBlend: 0.48,
        roomWeights: actor === 'npc'
          ? {
            [RoomType.CORRIDOR]: 1.55,
            [RoomType.COMMON]: 1.45,
            [RoomType.MEDICAL]: 1.38,
            [RoomType.OFFICE]: 1.24,
            [RoomType.STORAGE]: 1.18,
            [RoomType.PRODUCTION]: 0.92,
            [RoomType.LIVING]: 0.84,
          }
          : {
            [RoomType.STORAGE]: 1.85,
            [RoomType.CORRIDOR]: 1.48,
            [RoomType.PRODUCTION]: 1.32,
            [RoomType.COMMON]: 0.76,
            [RoomType.MEDICAL]: 0.72,
            [RoomType.OFFICE]: 0.8,
            [RoomType.LIVING]: 0.68,
          },
        zoneWeights: actor === 'npc'
          ? {
            [ZoneFaction.CITIZEN]: 1.12,
            [ZoneFaction.LIQUIDATOR]: 1.18,
            [ZoneFaction.WILD]: 1.08,
            [ZoneFaction.CULTIST]: 0.7,
            [ZoneFaction.SAMOSBOR]: 0.62,
          }
          : {
            [ZoneFaction.WILD]: 1.46,
            [ZoneFaction.SAMOSBOR]: 1.16,
            [ZoneFaction.LIQUIDATOR]: 0.82,
            [ZoneFaction.CITIZEN]: 0.72,
            [ZoneFaction.CULTIST]: 1.08,
          },
        anchors: actor === 'npc'
          ? [
            { x: 512, y: 512, radius: 128, weight: 1.75 },
            { x: 512, y: 536, radius: 74, weight: 1.65 },
            { x: 402, y: 552, radius: 82, weight: 1.45 },
            { x: 624, y: 474, radius: 70, weight: 1.32 },
            { x: 344, y: 512, radius: 92, weight: 1.34 },
            { x: 680, y: 512, radius: 96, weight: 1.28 },
            { x: 512, y: 680, radius: 88, weight: 1.22 },
            { x: 920, y: 512, radius: 110, weight: 1.18 },
          ]
          : [
            { x: 574, y: 564, radius: 82, weight: 2.05 },
            { x: 790, y: 622, radius: 118, weight: 2.3 },
            { x: 650, y: 628, radius: 120, weight: 1.86 },
            { x: 920, y: 512, radius: 120, weight: 1.62 },
            { x: 104, y: 676, radius: 118, weight: 1.42 },
            { x: 512, y: 920, radius: 112, weight: 1.36 },
          ],
      };
    case 'metro':
      return {
        ...base,
        noiseScale: actor === 'npc' ? 112 : 144,
        noiseStrength: actor === 'npc' ? 0.12 : 0.2,
        openWeight: actor === 'npc' ? 0.34 : 1.22,
        bucketSize: actor === 'npc' ? 44 : 28,
        maxPerBucket: actor === 'npc' ? Math.max(3, Math.min(5, Math.ceil(target / 64))) : maxPerBucket,
        roomWeights: actor === 'npc'
          ? { [RoomType.HQ]: 4.8, [RoomType.COMMON]: 2.45, [RoomType.PRODUCTION]: 1.7, [RoomType.STORAGE]: 1.25, [RoomType.CORRIDOR]: 0.68 }
          : { [RoomType.CORRIDOR]: 1.62, [RoomType.PRODUCTION]: 1.25, [RoomType.STORAGE]: 1.08, [RoomType.COMMON]: 0.44, [RoomType.HQ]: 0.28 },
        zoneWeights: actor === 'npc'
          ? { [ZoneFaction.LIQUIDATOR]: 1.72, [ZoneFaction.WILD]: 0.7, [ZoneFaction.CITIZEN]: 0.56, [ZoneFaction.CULTIST]: 0.58, [ZoneFaction.SAMOSBOR]: 0.32 }
          : { [ZoneFaction.SAMOSBOR]: 1.48, [ZoneFaction.WILD]: 1.34, [ZoneFaction.CULTIST]: 1.18, [ZoneFaction.LIQUIDATOR]: 0.62, [ZoneFaction.CITIZEN]: 0.58 },
        anchors: actor === 'npc' ? METRO_NPC_ANCHORS : METRO_MONSTER_ANCHORS,
      };
  }
  return base;
}

function mergePlacementProfile(
  base: DesignPlacementFieldProfile,
  override: Partial<DesignPlacementFieldProfile> | undefined,
): DesignPlacementFieldProfile {
  if (!override) return base;
  return {
    ...base,
    ...override,
    roomWeights: override.roomWeights ? { ...base.roomWeights, ...override.roomWeights } : base.roomWeights,
    zoneWeights: override.zoneWeights ? { ...base.zoneWeights, ...override.zoneWeights } : base.zoneWeights,
  };
}

export function designFloorPopulationProfile(route: DesignFloorRouteDef): DesignFloorPopulationProfile {
  const override = DESIGN_FLOOR_POPULATION_OVERRIDES[route.id] ?? {};
  const npcBase = baseNpcTarget(route);
  const monsterBase = baseMonsterTarget(route);
  const rawNpcTarget = clampInt(resolveActorTarget(override.npcTarget, npcBase * (override.npcMult ?? 1)), 0, entityNpcCap());
  const rawMonsterTarget = clampInt(resolveActorTarget(override.monsterTarget, monsterBase * (override.monsterMult ?? 1)), 0, entityMonsterCap());
  const fitted = fitActiveActorCounts(rawNpcTarget, rawMonsterTarget);
  const npcTarget = fitted.npcs;
  const monsterTarget = fitted.monsters;
  const depthLevel = 1 + Math.round(depth01(route.z) * 8);
  const npcPlacementKind = override.npcPlacementKind ?? defaultPlacementKind(route);
  const monsterPlacementKind = override.monsterPlacementKind ?? defaultPlacementKind(route);
  const npcPlacement = mergePlacementProfile(placementProfile(npcPlacementKind, 'npc', npcTarget), override.npcPlacement);
  const monsterPlacement = mergePlacementProfile(placementProfile(monsterPlacementKind, 'monster', monsterTarget), override.monsterPlacement);
  return {
    routeId: route.id,
    z: route.z,
    npcTarget,
    monsterTarget,
    npcLevel: Math.max(1, depthLevel - 1),
    monsterLevel: Math.max(route.danger, depthLevel),
    npcNoun: override.npcNoun ?? defaultNpcNoun(route),
    npcFactions: override.npcFactions ?? defaultNpcFactions(route),
    npcOccupations: override.npcOccupations ?? defaultNpcOccupations(route),
    monsterBiasKinds: override.monsterBiasKinds ?? [],
    monsterTags: override.monsterTags ?? [],
    npcPlacement,
    monsterPlacement,
  };
}
