import { Faction, FloorLevel, Occupation, type Item } from '../core/types';

export interface WeightedValue<T> {
  value: T;
  weight: number;
}

export interface AlifeFactionProfile {
  faction: Faction;
  id: string;
  baseWeight: number;
  dangerBias: number;
  wealthMult: number;
  floorWeights: Partial<Record<FloorLevel, number>>;
  occupations: readonly WeightedValue<Occupation>[];
}

export interface AlifePocketProfile {
  faction?: Faction;
  occupation?: Occupation;
  minDanger?: number;
  chance: number;
  items: readonly WeightedValue<Item>[];
}

export const ALIFE_MAX_LEVEL = 100;

export const ALIFE_FACTION_PROFILES: readonly AlifeFactionProfile[] = [
  {
    id: 'citizens',
    faction: Faction.CITIZEN,
    baseWeight: 100,
    dangerBias: -0.06,
    wealthMult: 1,
    floorWeights: {
      [FloorLevel.LIVING]: 1.25,
      [FloorLevel.KVARTIRY]: 1.15,
      [FloorLevel.MINISTRY]: 0.75,
      [FloorLevel.MAINTENANCE]: 0.62,
      [FloorLevel.HELL]: 0.04,
    },
    occupations: [
      { value: Occupation.HOUSEWIFE, weight: 18 },
      { value: Occupation.LOCKSMITH, weight: 12 },
      { value: Occupation.COOK, weight: 10 },
      { value: Occupation.STOREKEEPER, weight: 8 },
      { value: Occupation.CLEANER, weight: 6 },
      { value: Occupation.TRAVELER, weight: 18 },
      { value: Occupation.CHILD, weight: 8 },
      { value: Occupation.SECRETARY, weight: 6 },
      { value: Occupation.DOCTOR, weight: 3 },
      { value: Occupation.PERFORMER, weight: 2 },
    ],
  },
  {
    id: 'liquidators',
    faction: Faction.LIQUIDATOR,
    baseWeight: 14,
    dangerBias: 0.18,
    wealthMult: 1.8,
    floorWeights: {
      [FloorLevel.LIVING]: 0.6,
      [FloorLevel.KVARTIRY]: 0.95,
      [FloorLevel.MINISTRY]: 1.75,
      [FloorLevel.MAINTENANCE]: 1.55,
      [FloorLevel.HELL]: 2.1,
    },
    occupations: [
      { value: Occupation.HUNTER, weight: 30 },
      { value: Occupation.TRAVELER, weight: 5 },
      { value: Occupation.MECHANIC, weight: 3 },
    ],
  },
  {
    id: 'wild',
    faction: Faction.WILD,
    baseWeight: 16,
    dangerBias: 0.12,
    wealthMult: 0.65,
    floorWeights: {
      [FloorLevel.LIVING]: 0.5,
      [FloorLevel.KVARTIRY]: 1.8,
      [FloorLevel.MINISTRY]: 0.45,
      [FloorLevel.MAINTENANCE]: 1.15,
      [FloorLevel.HELL]: 0.28,
    },
    occupations: [
      { value: Occupation.TRAVELER, weight: 16 },
      { value: Occupation.ALCOHOLIC, weight: 13 },
      { value: Occupation.LOCKSMITH, weight: 3 },
      { value: Occupation.HUNTER, weight: 2 },
    ],
  },
  {
    id: 'scientists',
    faction: Faction.SCIENTIST,
    baseWeight: 7,
    dangerBias: 0.04,
    wealthMult: 2.4,
    floorWeights: {
      [FloorLevel.LIVING]: 0.2,
      [FloorLevel.KVARTIRY]: 0.18,
      [FloorLevel.MINISTRY]: 1.85,
      [FloorLevel.MAINTENANCE]: 1.35,
      [FloorLevel.HELL]: 0.2,
    },
    occupations: [
      { value: Occupation.SCIENTIST, weight: 20 },
      { value: Occupation.DOCTOR, weight: 5 },
      { value: Occupation.SECRETARY, weight: 3 },
      { value: Occupation.TRAVELER, weight: 2 },
    ],
  },
  {
    id: 'cultists',
    faction: Faction.CULTIST,
    baseWeight: 4,
    dangerBias: 0.28,
    wealthMult: 0.9,
    floorWeights: {
      [FloorLevel.LIVING]: 0.08,
      [FloorLevel.KVARTIRY]: 0.18,
      [FloorLevel.MINISTRY]: 0.55,
      [FloorLevel.MAINTENANCE]: 0.85,
      [FloorLevel.HELL]: 9.5,
    },
    occupations: [
      { value: Occupation.PILGRIM, weight: 20 },
      { value: Occupation.PRIEST, weight: 3 },
      { value: Occupation.TRAVELER, weight: 2 },
    ],
  },
];

export const ALIFE_COMMON_POCKETS: readonly AlifePocketProfile[] = [
  {
    chance: 0.46,
    items: [
      { value: { defId: 'bread', count: 1 }, weight: 16 },
      { value: { defId: 'water', count: 1 }, weight: 16 },
      { value: { defId: 'tea', count: 1 }, weight: 13 },
      { value: { defId: 'cigs', count: 1 }, weight: 9 },
      { value: { defId: 'note', count: 1 }, weight: 8 },
      { value: { defId: 'book', count: 1 }, weight: 4 },
      { value: { defId: 'chalk', count: 1 }, weight: 3 },
    ],
  },
  {
    occupation: Occupation.DOCTOR,
    chance: 0.55,
    items: [
      { value: { defId: 'bandage', count: 1 }, weight: 12 },
      { value: { defId: 'pills', count: 1 }, weight: 7 },
      { value: { defId: 'antibiotic', count: 1 }, weight: 2 },
    ],
  },
  {
    faction: Faction.SCIENTIST,
    chance: 0.42,
    items: [
      { value: { defId: 'temp_pass', count: 1 }, weight: 7 },
      { value: { defId: 'blank_form', count: 1 }, weight: 5 },
      { value: { defId: 'nii_sample_container', count: 1 }, weight: 2 },
    ],
  },
  {
    faction: Faction.LIQUIDATOR,
    chance: 0.5,
    items: [
      { value: { defId: 'liquidator_ration', count: 1 }, weight: 9 },
      { value: { defId: 'ammo_9mm', count: 8 }, weight: 7 },
      { value: { defId: 'bandage', count: 1 }, weight: 4 },
      { value: { defId: 'weapon_permit_signed', count: 1 }, weight: 1 },
    ],
  },
  {
    faction: Faction.CULTIST,
    chance: 0.38,
    items: [
      { value: { defId: 'istotit_candle', count: 1 }, weight: 7 },
      { value: { defId: 'holy_water', count: 1 }, weight: 2 },
      { value: { defId: 'psi_dust', count: 1 }, weight: 1 },
    ],
  },
  {
    faction: Faction.WILD,
    chance: 0.44,
    items: [
      { value: { defId: 'govnyak_roll', count: 1 }, weight: 9 },
      { value: { defId: 'knife', count: 1 }, weight: 4 },
      { value: { defId: 'cigs', count: 1 }, weight: 5 },
    ],
  },
  {
    minDanger: 4,
    chance: 0.2,
    items: [
      { value: { defId: 'gasmask_filter', count: 1 }, weight: 6 },
      { value: { defId: 'bandage', count: 1 }, weight: 6 },
      { value: { defId: 'pills', count: 1 }, weight: 3 },
    ],
  },
];
