import { generateLiquidatorBaseDesignFloor } from './liquidatorbase';
import {
  DESIGN_FLOOR_ROUTES,
  designFloorById,
  type DesignFloorId,
} from '../../data/design_floors';
import { territorySharesForDesignFloor } from '../../data/floor_territory';
import { hashSeed, withSeededRandom } from '../../core/rand';
import { floorRunZAllowsNpcs } from '../../data/procedural_floors';
import { initializeCellTerritory } from '../../systems/territory';
import type { FloorGeneration } from '../floor_manifest';
import { withoutNpcEntities } from '../entity_filters';
import { applyDesignFloorObjectProfile } from '../floor_object_placement';
import { fillVisualSlotsForWorldFeatures } from '../visual_cell_slots';
import { rebuildGeneratedFloorPathBlockers } from '../path_blockers';
import { generateAntennaCourtDesignFloor } from './antenna_court';
import { alignAttractorDvorAmbientNpcTerritory, generateAttractorDvorDesignFloor } from './attractor_dvor';
import { generateBankFloorDesignFloor } from './bank_floor';
import { generateBolnichnyKorpusDesignFloor } from './bolnichny_korpus';
import { alignBlackMarket88AmbientNpcTerritory, generateBlackMarket88DesignFloor, reinforceBlackMarket88AuthoredHqTerritory } from './black_market_88';
import { generateCantorPustotyDesignFloor, reinforceCantorPustotyAuthoredHqTerritory } from './cantor_pustoty';
import { generateCayleyByuroDesignFloor } from './cayley_byuro';
import { generateChthonicAtticDesignFloor } from './chthonic_attic';
import { generateCommunalRingDesignFloor } from './communal_ring';
import { generateCriticalLeakArchiveDesignFloor } from './critical_leak_archive';
import { alignDarkMetroAmbientNpcTerritory, generateDarkMetroDesignFloor } from './dark_metro';
import { generateDarknessDesignFloor } from './darkness';
import { generateHorrorFloorDesignFloor } from './horrorfloor';
import { generateFloor69DesignFloor } from './floor_69';
import { alignHarmonicBathhouseAmbientNpcTerritory, generateHarmonicBathhouseDesignFloor } from './harmonic_bathhouse';
import { alignHilbertDepotAmbientNpcTerritory, generateHilbertDepotDesignFloor } from './hilbert_depot';
import { alignHyperbolicSwitchyardAmbientNpcTerritory, generateHyperbolicSwitchyardDesignFloor } from './hyperbolic_switchyard';
import { generateIstinniyLabirintDesignFloor } from './istinniy_labirint';
import { generateManhattanCrossroadsDesignFloor } from './manhattan_crossroads';
import { generateMarkovStairwellDesignFloor, reinforceMarkovStairwellAuthoredHqTerritory } from './markov_stairwell';
import { alignMoebiusPodezdAmbientNpcTerritory, generateMoebiusPodezdDesignFloor } from './moebius_podezd';
import { generateNumberRegistryDesignFloor } from './number_registry';
import { generateObschezhitieSmenyDesignFloor } from './obschezhitie_smeny';
import { alignOranzhereyaBetonaAmbientNpcTerritory, generateOranzhereyaBetonaDesignFloor } from './oranzhereya_betona';
import { generatePenroseLaundryDesignFloor, reinforcePenroseLaundryAuthoredHqTerritory } from './penrose_laundry';
import { generatePioneerCampDesignFloor } from './pioneer_camp';
import { generatePodadDesignFloor, reinforcePodadAuthoredHqTerritory } from './podad';
import {
  alignProductionBeltAmbientNpcTerritory,
  generateProductionBeltDesignFloor,
  reinforceProductionBeltAuthoredHqTerritory,
} from './production_belt';
import { generateRadonExchangeDesignFloor } from './radon_exchange';
import { generateRaionsovetArchiveDesignFloor } from './raionsovet_archive';
import { generateRegistryMorgueDesignFloor } from './registry_morgue';
import { generateRoofDesignFloor } from './roof';
import { alignServiceFloorAmbientNpcTerritory, generateServiceFloorDesignFloor, reinforceServiceFloorAuthoredHqTerritory } from './service_floor';
import { generateShahtaAtriumDesignFloor, reinforceShahtaAtriumAuthoredHqTerritory } from './shahta_atrium';
import { alignSiliconNetWellAmbientNpcTerritory, generateSiliconNetWellDesignFloor } from './silicon_net_well';
import { alignSlimeNiiAmbientNpcTerritory, generateSlimeNiiDesignFloor } from './slime_nii';
import { generateSpetspriemnikDesignFloor } from './spetspriemnik';
import { alignSpectralChasovnyaAmbientNpcTerritory, generateSpectralChasovnyaDesignFloor, reinforceSpectralChasovnyaAuthoredHqTerritory } from './spectral_chasovnya';
import { alignTuringNurseryAmbientNpcTerritory, generateTuringNurseryDesignFloor } from './turing_nursery';
import { alignUnderhellAmbientNpcTerritory, generateUnderhellDesignFloor } from './underhell';
import { generateUpperBureauDesignFloor, reinforceUpperBureauAuthoredHqTerritory } from './upper_bureau';
import { alignVoronoiQuarantineAmbientNpcTerritory, generateVoronoiQuarantineDesignFloor } from './voronoi_quarantine';
import { expandDesignFloorGeneration, retuneDesignFloorAfterCellTerritory } from './full_floor';

const DESIGN_FLOOR_GENERATORS: Record<DesignFloorId, () => FloorGeneration> = {
  liquidatorbase: generateLiquidatorBaseDesignFloor,
  roof: generateRoofDesignFloor,
  chthonic_attic: generateChthonicAtticDesignFloor,
  radon_exchange: generateRadonExchangeDesignFloor,
  antenna_court: generateAntennaCourtDesignFloor,
  spetspriemnik: generateSpetspriemnikDesignFloor,
  cayley_byuro: generateCayleyByuroDesignFloor,
  upper_bureau: generateUpperBureauDesignFloor,
  number_registry: generateNumberRegistryDesignFloor,
  istinniy_labirint: generateIstinniyLabirintDesignFloor,
  bank_floor: generateBankFloorDesignFloor,
  critical_leak_archive: generateCriticalLeakArchiveDesignFloor,
  raionsovet_archive: generateRaionsovetArchiveDesignFloor,
  markov_stairwell: generateMarkovStairwellDesignFloor,
  registry_morgue: generateRegistryMorgueDesignFloor,
  bolnichny_korpus: generateBolnichnyKorpusDesignFloor,
  slime_nii: generateSlimeNiiDesignFloor,
  turing_nursery: generateTuringNurseryDesignFloor,
  manhattan_crossroads: generateManhattanCrossroadsDesignFloor,
  voronoi_quarantine: generateVoronoiQuarantineDesignFloor,
  communal_ring: generateCommunalRingDesignFloor,
  moebius_podezd: generateMoebiusPodezdDesignFloor,
  pioneer_camp: generatePioneerCampDesignFloor,
  oranzhereya_betona: generateOranzhereyaBetonaDesignFloor,
  floor_69: generateFloor69DesignFloor,
  obschezhitie_smeny: generateObschezhitieSmenyDesignFloor,
  penrose_laundry: generatePenroseLaundryDesignFloor,
  black_market_88: generateBlackMarket88DesignFloor,
  production_belt: generateProductionBeltDesignFloor,
  service_floor: generateServiceFloorDesignFloor,
  silicon_net_well: generateSiliconNetWellDesignFloor,
  shahta_atrium: generateShahtaAtriumDesignFloor,
  hyperbolic_switchyard: generateHyperbolicSwitchyardDesignFloor,
  harmonic_bathhouse: generateHarmonicBathhouseDesignFloor,
  hilbert_depot: generateHilbertDepotDesignFloor,
  dark_metro: generateDarkMetroDesignFloor,
  attractor_dvor: generateAttractorDvorDesignFloor,
  underhell: generateUnderhellDesignFloor,
  podad: generatePodadDesignFloor,
  spectral_chasovnya: generateSpectralChasovnyaDesignFloor,
  cantor_pustoty: generateCantorPustotyDesignFloor,
  darkness: generateDarknessDesignFloor,
  horrorfloor: generateHorrorFloorDesignFloor,
};

const DEFAULT_DESIGN_FLOOR_SEED = 0x4453474e;

export function designFloorGenerationSeed(id: DesignFloorId, runSeed = DEFAULT_DESIGN_FLOOR_SEED): number {
  return hashSeed(`design-floor:${id}`, runSeed);
}

export function isDesignFloorId(id: string): id is DesignFloorId {
  return designFloorById(id) !== undefined;
}

export function designFloorGeneratorIds(): readonly DesignFloorId[] {
  return Object.keys(DESIGN_FLOOR_GENERATORS) as DesignFloorId[];
}

export function generateDesignFloor(id: DesignFloorId, runSeed = DEFAULT_DESIGN_FLOOR_SEED): FloorGeneration {
  const route = designFloorById(id);
  const seed = designFloorGenerationSeed(id, runSeed);
  return withSeededRandom(seed, () => {
    const gen = DESIGN_FLOOR_GENERATORS[id]();
    if (!route) return gen;
    const expanded = expandDesignFloorGeneration(gen, route);
    applyDesignFloorObjectProfile(expanded.world, expanded.spawnX, expanded.spawnY, route);
    if (id === 'markov_stairwell') reinforceMarkovStairwellAuthoredHqTerritory(expanded.world);
    if (id === 'service_floor') reinforceServiceFloorAuthoredHqTerritory(expanded.world);
    if (id === 'podad') reinforcePodadAuthoredHqTerritory(expanded.world);
    if (id === 'cantor_pustoty') reinforceCantorPustotyAuthoredHqTerritory(expanded.world);
    initializeCellTerritory(expanded.world, {
      seed,
      targetShares: territorySharesForDesignFloor(id),
    });
    retuneDesignFloorAfterCellTerritory(expanded.world, id);
    if (id === 'attractor_dvor') alignAttractorDvorAmbientNpcTerritory(expanded.world, expanded.entities);
    if (id === 'black_market_88') reinforceBlackMarket88AuthoredHqTerritory(expanded.world);
    if (id === 'shahta_atrium') reinforceShahtaAtriumAuthoredHqTerritory(expanded.world);
    if (id === 'oranzhereya_betona') alignOranzhereyaBetonaAmbientNpcTerritory(expanded.world, expanded.entities);
    if (id === 'slime_nii') alignSlimeNiiAmbientNpcTerritory(expanded.world, expanded.entities);
    if (id === 'moebius_podezd') alignMoebiusPodezdAmbientNpcTerritory(expanded.world, expanded.entities);
    if (id === 'turing_nursery') alignTuringNurseryAmbientNpcTerritory(expanded.world, expanded.entities);
    if (id === 'voronoi_quarantine') alignVoronoiQuarantineAmbientNpcTerritory(expanded.world, expanded.entities);
    if (id === 'harmonic_bathhouse') alignHarmonicBathhouseAmbientNpcTerritory(expanded.world, expanded.entities);
    if (id === 'hilbert_depot') alignHilbertDepotAmbientNpcTerritory(expanded.world, expanded.entities);
    if (id === 'hyperbolic_switchyard') alignHyperbolicSwitchyardAmbientNpcTerritory(expanded.world, expanded.entities);
    if (id === 'black_market_88') alignBlackMarket88AmbientNpcTerritory(expanded.world, expanded.entities);
    if (id === 'service_floor') alignServiceFloorAmbientNpcTerritory(expanded.world, expanded.entities);
    if (id === 'dark_metro') alignDarkMetroAmbientNpcTerritory(expanded.world, expanded.entities);
    if (id === 'silicon_net_well') alignSiliconNetWellAmbientNpcTerritory(expanded.world, expanded.entities);
    if (id === 'underhell') alignUnderhellAmbientNpcTerritory(expanded.world, expanded.entities);
    if (id === 'production_belt') {
      reinforceProductionBeltAuthoredHqTerritory(expanded.world);
      alignProductionBeltAmbientNpcTerritory(expanded.world, expanded.entities);
    }
    if (id === 'spectral_chasovnya') {
      reinforceSpectralChasovnyaAuthoredHqTerritory(expanded.world);
      alignSpectralChasovnyaAmbientNpcTerritory(expanded.world, expanded.entities);
    }
    if (id === 'upper_bureau') reinforceUpperBureauAuthoredHqTerritory(expanded.world);
    if (id === 'penrose_laundry') reinforcePenroseLaundryAuthoredHqTerritory(expanded.world);
    rebuildGeneratedFloorPathBlockers(expanded.world, seed, expanded.spawnX, expanded.spawnY);
    fillVisualSlotsForWorldFeatures(expanded.world, seed);
    return floorRunZAllowsNpcs(route.z) ? expanded : withoutNpcEntities(expanded);
  });
}

export function validateDesignFloorGenerators(): void {
  for (const def of DESIGN_FLOOR_ROUTES) {
    if (!DESIGN_FLOOR_GENERATORS[def.id]) {
      throw new Error(`Missing design floor generator: ${def.id}`);
    }
  }
}
