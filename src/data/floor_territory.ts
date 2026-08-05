import { FloorLevel, ZoneFaction, type TerritoryOwner } from '../core/types';
import type { DesignFloorId } from './design_floors';
import type { FloorMajorityId, ProceduralFloorSpec } from './procedural_floors';

export interface FloorTerritoryShare {
  owner: TerritoryOwner;
  share: number;
}

function shares(
  citizen: number,
  liquidator: number,
  cultist: number,
  scientist: number,
  wild: number,
  samosbor = 0,
): readonly FloorTerritoryShare[] {
  const rows: FloorTerritoryShare[] = [
    { owner: ZoneFaction.CITIZEN, share: citizen },
    { owner: ZoneFaction.LIQUIDATOR, share: liquidator },
    { owner: ZoneFaction.CULTIST, share: cultist },
    { owner: ZoneFaction.SCIENTIST, share: scientist },
    { owner: ZoneFaction.WILD, share: wild },
  ];
  if (samosbor > 0) rows.push({ owner: ZoneFaction.SAMOSBOR, share: samosbor });
  return rows;
}

const PROCEDURAL_MAJORITIES: Readonly<Record<FloorMajorityId, readonly FloorTerritoryShare[]>> = {
  citizens: shares(56, 17, 7, 8, 12),
  liquidators: shares(17, 56, 7, 8, 12),
  cultists: shares(16, 12, 40, 8, 24),
  scientists: shares(22, 16, 8, 42, 12),
  wild: shares(17, 13, 12, 8, 50),
};

const STORY_TERRITORY: Readonly<Record<FloorLevel, readonly FloorTerritoryShare[]>> = {
  [FloorLevel.MINISTRY]: shares(48, 24, 8, 14, 6),
  [FloorLevel.KVARTIRY]: shares(66, 12, 6, 7, 9),
  [FloorLevel.LIVING]: shares(64, 14, 6, 7, 9),
  [FloorLevel.MAINTENANCE]: shares(16, 58, 5, 7, 14),
  [FloorLevel.HELL]: shares(6, 8, 40, 4, 28, 14),
  [FloorLevel.VOID]: shares(4, 8, 24, 6, 34, 24),
};

const DESIGN_TERRITORY: Readonly<Record<DesignFloorId, readonly FloorTerritoryShare[]>> = {
  roof: shares(28, 38, 8, 14, 12),
  chthonic_attic: shares(18, 24, 14, 10, 34),
  radon_exchange: shares(16, 36, 10, 26, 12),
  antenna_court: shares(18, 36, 8, 24, 14),
  spetspriemnik: shares(24, 44, 10, 8, 14),
  pioneer_camp: shares(58, 12, 7, 9, 14),
  cayley_byuro: shares(26, 20, 10, 34, 10),
  upper_bureau: shares(42, 26, 8, 16, 8),
  number_registry: shares(30, 18, 10, 34, 8),
  istinniy_labirint: shares(24, 16, 16, 10, 34),
  bank_floor: shares(42, 28, 8, 10, 12),
  critical_leak_archive: shares(28, 34, 8, 18, 12),
  raionsovet_archive: shares(44, 22, 8, 14, 12),
  markov_stairwell: shares(34, 24, 10, 14, 18),
  registry_morgue: shares(28, 34, 12, 18, 8),
  bolnichny_korpus: shares(24, 22, 6, 38, 10),
  slime_nii: shares(14, 12, 6, 60, 8),
  turing_nursery: shares(16, 14, 8, 50, 12),
  manhattan_crossroads: shares(44, 22, 10, 10, 14),
  voronoi_quarantine: shares(18, 28, 8, 34, 12),
  communal_ring: shares(54, 18, 7, 9, 12),
  moebius_podezd: shares(52, 18, 8, 12, 10),
  oranzhereya_betona: shares(46, 10, 6, 24, 14),
  floor_69: shares(18, 9, 8, 7, 58),
  obschezhitie_smeny: shares(56, 16, 7, 8, 13),
  penrose_laundry: shares(56, 17, 7, 8, 12),
  black_market_88: shares(16, 9, 8, 7, 60),
  production_belt: shares(14, 50, 6, 18, 12),
  service_floor: shares(16, 52, 6, 12, 14),
  hyperbolic_switchyard: shares(12, 44, 8, 16, 20),
  silicon_net_well: shares(12, 18, 8, 48, 14),
  shahta_atrium: shares(14, 44, 10, 10, 22),
  harmonic_bathhouse: shares(24, 38, 10, 14, 14),
  hilbert_depot: shares(14, 42, 8, 20, 16),
  dark_metro: shares(14, 24, 14, 8, 40),
  attractor_dvor: shares(14, 36, 10, 16, 24),
  underhell: shares(7, 10, 38, 5, 28, 12),
  podad: shares(6, 9, 38, 5, 28, 14),
  spectral_chasovnya: shares(10, 8, 46, 6, 22, 8),
  cantor_pustoty: shares(6, 8, 24, 8, 34, 20),
  darkness: shares(6, 8, 24, 8, 36, 18),
  liquidatorbase: [{ owner: ZoneFaction.LIQUIDATOR, share: 1.0 }],
  horrorfloor: shares(6, 8, 24, 8, 36, 18),
};

export function territorySharesForStoryFloor(floor: FloorLevel): readonly FloorTerritoryShare[] {
  return STORY_TERRITORY[floor];
}

export function territorySharesForDesignFloor(id: DesignFloorId): readonly FloorTerritoryShare[] {
  return DESIGN_TERRITORY[id];
}

export function territorySharesForProceduralSpec(spec: ProceduralFloorSpec): readonly FloorTerritoryShare[] {
  if (spec.majorityId === 'citizens' && spec.anomalyId === 'false_safe_block') {
    return shares(53, 16, 12, 8, 11);
  }
  if (spec.majorityId === 'liquidators' && spec.anomalyId === 'false_safe_block') {
    return shares(16, 53, 12, 8, 11);
  }
  if (spec.anomalyId === 'samosbor_seed') {
    if (spec.majorityId === 'cultists') return shares(15, 11, 36, 7, 22, 9);
    if (spec.majorityId === 'citizens') return shares(51, 15, 6, 7, 11, 10);
    return shares(15, 11, 26, 7, 31, 10);
  }
  if (spec.anomalyId === 'zombie_apocalypse') return shares(25, 12, 12, 9, 42);
  return PROCEDURAL_MAJORITIES[spec.majorityId];
}
