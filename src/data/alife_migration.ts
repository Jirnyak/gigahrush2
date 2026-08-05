import { Faction, FloorLevel, Occupation } from '../core/types';
import type { WeightedValue } from './alife_generation';
import {
  floorKeyAllowsNpcs,
  floorKeyBaseFloor,
  floorKeyKnown,
} from './floor_keys';

export type AlifeMigrationReason =
  | 'routine'
  | 'market'
  | 'work'
  | 'rest'
  | 'research'
  | 'caravan'
  | 'faction'
  | 'samosbor'
  | 'quest'
  | 'refugee';

export interface AlifeDestinationSelector {
  floorKeys?: readonly string[];
  routeTags?: readonly string[];
  baseFloors?: readonly FloorLevel[];
  minAbsZ?: number;
  maxAbsZ?: number;
  allowsNpcOnly?: boolean;
}

export interface AlifeMigrationIntentDef {
  id: string;
  reason: AlifeMigrationReason;
  weight: number;
  destination: AlifeDestinationSelector;
  factionBias?: readonly WeightedValue<Faction>[];
  occupationBias?: readonly WeightedValue<Occupation>[];
  minLevel?: number;
  maxRisk?: 1 | 2 | 3 | 4 | 5;
  wealthBias?: 'poor' | 'stable' | 'rich' | 'any';
  cooldownSeconds?: number;
  eventTags: readonly string[];
}

export const ALIFE_MIGRATION_INTENTS: readonly AlifeMigrationIntentDef[] = [
  {
    id: 'admin_papers',
    reason: 'work',
    weight: 9,
    destination: {
      floorKeys: [
        'story:ministry',
        'design:upper_bureau',
        'design:cayley_byuro',
        'design:number_registry',
        'design:raionsovet_archive',
        'design:bank_floor',
      ],
      routeTags: ['bureaucracy', 'admin', 'documents'],
    },
    factionBias: [
      { value: Faction.CITIZEN, weight: 6 },
      { value: Faction.LIQUIDATOR, weight: 3 },
      { value: Faction.SCIENTIST, weight: 2 },
    ],
    occupationBias: [
      { value: Occupation.SECRETARY, weight: 7 },
      { value: Occupation.DIRECTOR, weight: 5 },
      { value: Occupation.TRAVELER, weight: 2 },
    ],
    maxRisk: 4,
    wealthBias: 'stable',
    cooldownSeconds: 1800,
    eventTags: ['alife_migration', 'migration', 'admin', 'documents'],
  },
  {
    id: 'research_work',
    reason: 'research',
    weight: 8,
    destination: {
      floorKeys: [
        'design:slime_nii',
        'design:turing_nursery',
        'design:silicon_net_well',
        'design:voronoi_quarantine',
      ],
      routeTags: ['lab', 'science', 'nii', 'quarantine'],
    },
    factionBias: [
      { value: Faction.SCIENTIST, weight: 8 },
      { value: Faction.LIQUIDATOR, weight: 2 },
    ],
    occupationBias: [
      { value: Occupation.SCIENTIST, weight: 8 },
      { value: Occupation.DOCTOR, weight: 3 },
      { value: Occupation.SECRETARY, weight: 1 },
    ],
    minLevel: 4,
    maxRisk: 4,
    wealthBias: 'stable',
    cooldownSeconds: 2400,
    eventTags: ['alife_migration', 'migration', 'research', 'lab'],
  },
  {
    id: 'market_trade',
    reason: 'market',
    weight: 11,
    destination: {
      floorKeys: [
        'design:black_market_88',
        'design:floor_69',
        'design:communal_ring',
        'story:living',
      ],
      routeTags: ['market', 'trade', 'social', 'hub'],
    },
    factionBias: [
      { value: Faction.CITIZEN, weight: 7 },
      { value: Faction.WILD, weight: 4 },
      { value: Faction.LIQUIDATOR, weight: 1 },
    ],
    occupationBias: [
      { value: Occupation.STOREKEEPER, weight: 7 },
      { value: Occupation.COOK, weight: 4 },
      { value: Occupation.TRAVELER, weight: 4 },
      { value: Occupation.ALCOHOLIC, weight: 2 },
    ],
    maxRisk: 3,
    wealthBias: 'any',
    cooldownSeconds: 1200,
    eventTags: ['alife_migration', 'migration', 'market', 'trade'],
  },
  {
    id: 'rest_hide',
    reason: 'rest',
    weight: 8,
    destination: {
      floorKeys: [
        'story:living',
        'story:kvartiry',
        'design:obschezhitie_smeny',
        'design:communal_ring',
        'design:moebius_podezd',
      ],
      routeTags: ['residential', 'rest', 'social'],
    },
    factionBias: [
      { value: Faction.CITIZEN, weight: 8 },
      { value: Faction.WILD, weight: 2 },
    ],
    occupationBias: [
      { value: Occupation.HOUSEWIFE, weight: 6 },
      { value: Occupation.CHILD, weight: 4 },
      { value: Occupation.TRAVELER, weight: 2 },
    ],
    maxRisk: 3,
    wealthBias: 'poor',
    cooldownSeconds: 900,
    eventTags: ['alife_migration', 'migration', 'rest', 'residential'],
  },
  {
    id: 'repair_shift',
    reason: 'work',
    weight: 8,
    destination: {
      floorKeys: [
        'story:maintenance',
        'design:production_belt',
        'design:service_floor',
        'design:hyperbolic_switchyard',
        'design:hilbert_depot',
      ],
      routeTags: ['repair', 'industrial', 'maintenance', 'service'],
    },
    factionBias: [
      { value: Faction.LIQUIDATOR, weight: 4 },
      { value: Faction.CITIZEN, weight: 3 },
      { value: Faction.SCIENTIST, weight: 1 },
    ],
    occupationBias: [
      { value: Occupation.MECHANIC, weight: 7 },
      { value: Occupation.ELECTRICIAN, weight: 6 },
      { value: Occupation.TURNER, weight: 4 },
      { value: Occupation.LOCKSMITH, weight: 3 },
    ],
    maxRisk: 4,
    wealthBias: 'stable',
    cooldownSeconds: 1800,
    eventTags: ['alife_migration', 'migration', 'repair', 'work'],
  },
  {
    id: 'route_circuit',
    reason: 'routine',
    weight: 13,
    destination: {
      routeTags: ['transit', 'hub', 'route_pressure', 'market', 'residential', 'industrial', 'service'],
      minAbsZ: 0,
      maxAbsZ: 45,
    },
    factionBias: [
      { value: Faction.CITIZEN, weight: 4 },
      { value: Faction.WILD, weight: 3 },
      { value: Faction.LIQUIDATOR, weight: 3 },
      { value: Faction.CULTIST, weight: 2 },
      { value: Faction.SCIENTIST, weight: 1 },
    ],
    occupationBias: [
      { value: Occupation.TRAVELER, weight: 9 },
      { value: Occupation.HUNTER, weight: 6 },
      { value: Occupation.PILGRIM, weight: 6 },
      { value: Occupation.STOREKEEPER, weight: 2 },
    ],
    maxRisk: 4,
    wealthBias: 'any',
    cooldownSeconds: 600,
    eventTags: ['alife_migration', 'migration', 'route_circuit'],
  },
  {
    id: 'lower_expedition',
    reason: 'routine',
    weight: 3,
    destination: {
      baseFloors: [FloorLevel.MAINTENANCE, FloorLevel.HELL],
      routeTags: ['route_pressure', 'industrial', 'cult', 'samosbor'],
      minAbsZ: 24,
      maxAbsZ: 47,
    },
    factionBias: [
      { value: Faction.LIQUIDATOR, weight: 6 },
      { value: Faction.CULTIST, weight: 3 },
      { value: Faction.WILD, weight: 2 },
      { value: Faction.SCIENTIST, weight: 1 },
    ],
    occupationBias: [
      { value: Occupation.HUNTER, weight: 6 },
      { value: Occupation.PILGRIM, weight: 4 },
      { value: Occupation.TRAVELER, weight: 2 },
      { value: Occupation.SCIENTIST, weight: 1 },
    ],
    minLevel: 8,
    maxRisk: 5,
    wealthBias: 'any',
    cooldownSeconds: 3600,
    eventTags: ['alife_migration', 'migration', 'lower_route'],
  },
  {
    id: 'caravan_member',
    reason: 'caravan',
    weight: 4,
    destination: {
      floorKeys: [
        'story:living',
        'design:black_market_88',
        'design:service_floor',
        'design:production_belt',
        'design:bank_floor',
      ],
      routeTags: ['market', 'trade', 'transit', 'production'],
    },
    factionBias: [
      { value: Faction.CITIZEN, weight: 5 },
      { value: Faction.WILD, weight: 3 },
      { value: Faction.LIQUIDATOR, weight: 2 },
    ],
    occupationBias: [
      { value: Occupation.TRAVELER, weight: 5 },
      { value: Occupation.STOREKEEPER, weight: 4 },
      { value: Occupation.HUNTER, weight: 2 },
    ],
    maxRisk: 4,
    wealthBias: 'any',
    cooldownSeconds: 1500,
    eventTags: ['alife_migration', 'migration', 'caravan'],
  },
  {
    id: 'refugee_shift',
    reason: 'refugee',
    weight: 5,
    destination: {
      floorKeys: [
        'story:living',
        'story:kvartiry',
        'design:obschezhitie_smeny',
        'design:communal_ring',
        'design:pioneer_camp',
      ],
      routeTags: ['shelter', 'residential', 'hub'],
    },
    factionBias: [
      { value: Faction.CITIZEN, weight: 7 },
      { value: Faction.WILD, weight: 3 },
      { value: Faction.SCIENTIST, weight: 1 },
    ],
    occupationBias: [
      { value: Occupation.HOUSEWIFE, weight: 5 },
      { value: Occupation.CHILD, weight: 4 },
      { value: Occupation.TRAVELER, weight: 3 },
      { value: Occupation.DOCTOR, weight: 1 },
    ],
    maxRisk: 3,
    wealthBias: 'poor',
    cooldownSeconds: 900,
    eventTags: ['alife_migration', 'migration', 'refugee'],
  },
  {
    id: 'home_return',
    reason: 'routine',
    weight: 10,
    destination: {
      floorKeys: [
        'story:living',
        'story:kvartiry',
        'design:communal_ring',
        'design:moebius_podezd',
        'design:obschezhitie_smeny',
        'design:floor_69',
      ],
      routeTags: ['residential', 'social', 'hub'],
    },
    factionBias: [
      { value: Faction.CITIZEN, weight: 8 },
      { value: Faction.WILD, weight: 2 },
    ],
    occupationBias: [
      { value: Occupation.HOUSEWIFE, weight: 6 },
      { value: Occupation.CHILD, weight: 5 },
      { value: Occupation.COOK, weight: 2 },
      { value: Occupation.TRAVELER, weight: 2 },
    ],
    maxRisk: 3,
    wealthBias: 'any',
    cooldownSeconds: 600,
    eventTags: ['alife_migration', 'migration', 'home_return'],
  },
];

const INTENT_ID_RE = /^[a-z][a-z0-9_]*$/;

function selectorEmpty(selector: AlifeDestinationSelector): boolean {
  return !selector.floorKeys?.length &&
    !selector.routeTags?.length &&
    !selector.baseFloors?.length &&
    selector.minAbsZ === undefined &&
    selector.maxAbsZ === undefined;
}

function validateWeighted<T>(errors: string[], label: string, weights: readonly WeightedValue<T>[] | undefined): void {
  if (!weights) return;
  for (const row of weights) {
    if (!(row.weight > 0)) errors.push(`${label} has non-positive weight`);
  }
}

export function validateAlifeMigrationProfiles(): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const intent of ALIFE_MIGRATION_INTENTS) {
    if (!INTENT_ID_RE.test(intent.id)) errors.push(`invalid migration intent id ${intent.id}`);
    if (seen.has(intent.id)) errors.push(`duplicate migration intent ${intent.id}`);
    seen.add(intent.id);
    if (!(intent.weight > 0)) errors.push(`migration intent ${intent.id} has non-positive weight`);
    if (selectorEmpty(intent.destination)) errors.push(`migration intent ${intent.id} has empty destination selector`);
    if (intent.eventTags.length > 8) errors.push(`migration intent ${intent.id} has too many event tags`);
    for (const tag of intent.eventTags) {
      if (!/^[a-z0-9:_-]+$/.test(tag)) errors.push(`migration intent ${intent.id} has invalid event tag ${tag}`);
    }
    validateWeighted(errors, `${intent.id} faction bias`, intent.factionBias);
    validateWeighted(errors, `${intent.id} occupation bias`, intent.occupationBias);
    for (const key of intent.destination.floorKeys ?? []) {
      if (!floorKeyKnown(key)) errors.push(`migration intent ${intent.id} has unknown destination ${key}`);
      const allowsNpc = floorKeyAllowsNpcs(key);
      if (intent.destination.allowsNpcOnly !== false && allowsNpc === false) {
        errors.push(`migration intent ${intent.id} targets NPC-forbidden destination ${key}`);
      }
      if (floorKeyBaseFloor(key) === FloorLevel.VOID) {
        errors.push(`migration intent ${intent.id} targets VOID ordinary destination ${key}`);
      }
    }
    if (intent.destination.baseFloors?.includes(FloorLevel.VOID)) {
      errors.push(`migration intent ${intent.id} targets VOID base floor`);
    }
  }
  return errors;
}
