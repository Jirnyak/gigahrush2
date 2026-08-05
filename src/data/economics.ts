import { ContainerKind } from '../core/types';

export type EconomyProgressBand = 'E0' | 'E1' | 'E2' | 'E3' | 'E4';

export interface EconomyMoneyBandDef {
  id: EconomyProgressBand;
  maxLiquidCash: number;
  ordinaryQuestCap: number;
  lootValueCap: number;
  baseQuestCashRate: number;
}

export const ECONOMY_PSI_MIN_VALUE = 10_000;

export const ECONOMY_MAJOR_REWARD_TAGS = [
  'deep_route',
  'jackpot',
  'vault',
  'faction_betrayal',
  'boss',
  'unique_weapon',
  'major_asset',
] as const;

export const ECONOMY_MONEY_BANDS: Record<EconomyProgressBand, EconomyMoneyBandDef> = {
  E0: { id: 'E0', maxLiquidCash: 250, ordinaryQuestCap: 250, lootValueCap: 90, baseQuestCashRate: 35 },
  E1: { id: 'E1', maxLiquidCash: 2_000, ordinaryQuestCap: 800, lootValueCap: 450, baseQuestCashRate: 70 },
  E2: { id: 'E2', maxLiquidCash: 25_000, ordinaryQuestCap: 8_000, lootValueCap: 4_000, baseQuestCashRate: 160 },
  E3: { id: 'E3', maxLiquidCash: 250_000, ordinaryQuestCap: 45_000, lootValueCap: 80_000, baseQuestCashRate: 420 },
  E4: { id: 'E4', maxLiquidCash: 5_000_000, ordinaryQuestCap: 250_000, lootValueCap: 250_000, baseQuestCashRate: 1_200 },
};

export const ECONOMY_PROCEDURAL_LOOT_VALUE_CAP_BY_DANGER: Readonly<Record<1 | 2 | 3 | 4 | 5, number>> = {
  1: ECONOMY_MONEY_BANDS.E0.lootValueCap,
  2: ECONOMY_MONEY_BANDS.E1.lootValueCap,
  3: ECONOMY_MONEY_BANDS.E2.lootValueCap,
  4: 45_000,
  5: ECONOMY_MONEY_BANDS.E4.lootValueCap,
};

const PUBLIC_CONTAINER_CAP_BY_DANGER: Readonly<Record<1 | 2 | 3 | 4 | 5, number>> = {
  1: 40,
  2: 60,
  3: 90,
  4: 120,
  5: 180,
};

const ORDINARY_CONTAINER_CAP_BY_DANGER: Readonly<Record<1 | 2 | 3 | 4 | 5, number>> = {
  1: 90,
  2: 300,
  3: 1_200,
  4: 2_000,
  5: 4_000,
};

const LOCKED_CONTAINER_CAP_BY_DANGER: Readonly<Record<1 | 2 | 3 | 4 | 5, number>> = {
  1: 120,
  2: 450,
  3: 4_000,
  4: 45_000,
  5: 250_000,
};

export const ECONOMY_TOP_GEAR_MIN_VALUES: Readonly<Record<string, number>> = {
  bfg: 120_000,
  grn420_gravizhernov: 120_000,
  gravity_beam_emitter: 500_000,
  ato41_atomic_flamer: 150_000,
};

export const ECONOMY_PSI_WEAPON_IDS = [
  'psi_strike',
  'psi_rupture',
  'psi_storm',
  'psi_brainburn',
  'psi_madness',
  'psi_control',
  'psi_shield',
  'psi_possession',
  'psi_phase',
  'psi_mark',
  'psi_recall',
  'psi_beam',
  'psi_concrete_splinter',
  'psi_shadow_lance',
  'psi_order_seal',
  'psi_void_needle',
  'psi_meat_hook',
  'psi_siren_pulse',
] as const;

export const ECONOMY_RARE_ENERGY_WEAPON_IDS = [
  'gauss',
  'plasma',
  'bfg',
  'gravity_beam_emitter',
  'grn420_gravizhernov',
] as const;

export function economyProgressBandForDepth(routeZ = 0): EconomyProgressBand {
  const depth = Math.abs(Math.trunc(routeZ));
  if (depth >= 44) return 'E4';
  if (depth >= 28) return 'E3';
  if (depth >= 12) return 'E2';
  if (depth >= 4) return 'E1';
  return 'E0';
}

export function economyProgressBandForRoute(danger: number, routeZ = 0): EconomyProgressBand {
  const depthBand = economyProgressBandForDepth(routeZ);
  const dangerBand: EconomyProgressBand = danger >= 5 ? 'E3'
    : danger >= 4 ? 'E2'
      : danger >= 2 ? 'E1'
        : 'E0';
  return ECONOMY_MONEY_BANDS[depthBand].lootValueCap >= ECONOMY_MONEY_BANDS[dangerBand].lootValueCap
    ? depthBand
    : dangerBand;
}

export function proceduralLootValueCap(danger: 1 | 2 | 3 | 4 | 5, routeZ?: number): number {
  const dangerCap = ECONOMY_PROCEDURAL_LOOT_VALUE_CAP_BY_DANGER[danger];
  if (routeZ === undefined) return dangerCap;
  return Math.min(dangerCap, ECONOMY_MONEY_BANDS[economyProgressBandForDepth(routeZ)].lootValueCap);
}

export function proceduralContainerValueCap(kind: ContainerKind, danger: 1 | 2 | 3 | 4 | 5, routeZ?: number): number {
  const depthCap = proceduralLootValueCap(danger, routeZ);
  switch (kind) {
    case ContainerKind.EMERGENCY_BOX:
    case ContainerKind.TRASH_BIN:
    case ContainerKind.FRIDGE:
      return Math.min(PUBLIC_CONTAINER_CAP_BY_DANGER[danger], depthCap);
    case ContainerKind.SAFE:
    case ContainerKind.SECRET_STASH:
    case ContainerKind.WEAPON_CRATE:
      return Math.min(LOCKED_CONTAINER_CAP_BY_DANGER[danger], depthCap);
    default:
      return Math.min(ORDINARY_CONTAINER_CAP_BY_DANGER[danger], depthCap);
  }
}

export function hasMajorRewardTag(tags: readonly string[] | undefined): boolean {
  if (!tags) return false;
  return ECONOMY_MAJOR_REWARD_TAGS.some(tag => tags.includes(tag));
}
