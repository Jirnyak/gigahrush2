import { Faction, Occupation } from '../core/types';
import type { DesignFloorId } from './design_floors';
import {
  FLOOR_69_PERFORMER_ROLE_ID,
  FLOOR_69_WORKER_ROLE_ID,
  NPC_VISUAL_FLOOR69_FEMALE_ID,
  npcRoleProfilesForFloorKey,
  type NpcRoleProfile,
} from './npc_role_profiles';

export {
  FLOOR_69_GUARD_ROLE_ID,
  FLOOR_69_PERFORMER_ROLE_ID,
  FLOOR_69_WORKER_ROLE_ID,
  NPC_VISUAL_FLOOR69_FEMALE_ID,
} from './npc_role_profiles';

export interface DesignFloorFactionWeightModifier {
  faction: Faction;
  multiplier: number;
}

export interface DesignFloorOccupationProbability {
  occupation: Occupation;
  probability: number;
}

export interface DesignFloorAgeRange {
  min: number;
  max: number;
}

export interface DesignFloorOccupationAgeRange extends DesignFloorAgeRange {
  occupation: Occupation;
}

export interface DesignFloorDemographicProfile {
  adultOnly?: boolean;
  femaleProbability?: number;
  femaleProbabilityByOccupation?: readonly DesignFloorOccupationProbability[];
  ageRange?: DesignFloorAgeRange;
  ageRangeByOccupation?: readonly DesignFloorOccupationAgeRange[];
}

export type DesignFloorLocalRoleProfile = NpcRoleProfile;

export interface DesignFloorVisualProfile {
  id: string;
  roleIds: readonly string[];
}

export interface DesignFloorNpcPredicateProfile {
  plotNpcIds?: readonly string[];
  exactNames?: readonly string[];
  namePrefixes?: readonly string[];
  npcVisualIds?: readonly string[];
}

export interface DesignFloorNpcInteractionProfile {
  id: string;
  order: number;
  label: string;
  title: string;
  priceRubles?: number;
  requiresCasinoLikePortalAllowance?: boolean;
  npcPredicate: DesignFloorNpcPredicateProfile;
  lines: readonly string[];
  message: string;
}

export interface DesignFloorPortalPolicyProfile {
  strictPortalBlocked?: boolean;
}

export interface DesignFloorRenderProfile {
  ambientLight?: number;
}

export interface DesignFloorPseudoliftProfile {
  chance?: number;
}

export interface DesignFloorProfile {
  routeId: DesignFloorId;
  demographics?: DesignFloorDemographicProfile;
  factionWeightModifiers?: readonly DesignFloorFactionWeightModifier[];
  localRoles?: readonly DesignFloorLocalRoleProfile[];
  visualProfiles?: readonly DesignFloorVisualProfile[];
  npcInteractions?: readonly DesignFloorNpcInteractionProfile[];
  portalPolicy?: DesignFloorPortalPolicyProfile;
  render?: DesignFloorRenderProfile;
  pseudolift?: DesignFloorPseudoliftProfile;
}

export const DESIGN_FLOOR_PROFILES: readonly DesignFloorProfile[] = [
  {
    routeId: 'dark_metro',
    pseudolift: {
      chance: 0.18,
    },
  },
  {
    routeId: 'service_floor',
    pseudolift: {
      chance: 0.18,
    },
  },
  {
    routeId: 'darkness',
    render: {
      ambientLight: 0,
    },
  },
  {
    routeId: 'floor_69',
    demographics: {
      adultOnly: true,
      femaleProbability: 0.72,
      femaleProbabilityByOccupation: [
        { occupation: Occupation.HUNTER, probability: 0.5 },
      ],
      ageRange: { min: 20, max: 34 },
      ageRangeByOccupation: [
        { occupation: Occupation.HUNTER, min: 24, max: 34 },
        { occupation: Occupation.DIRECTOR, min: 20, max: 43 },
        { occupation: Occupation.DOCTOR, min: 20, max: 38 },
      ],
    },
    factionWeightModifiers: [
      { faction: Faction.CITIZEN, multiplier: 1.9 },
    ],
    localRoles: npcRoleProfilesForFloorKey('design:floor_69'),
    visualProfiles: [
      {
        id: NPC_VISUAL_FLOOR69_FEMALE_ID,
        roleIds: [FLOOR_69_WORKER_ROLE_ID, FLOOR_69_PERFORMER_ROLE_ID],
      },
    ],
    npcInteractions: [
      {
        id: 'floor69_entertainment',
        order: 40,
        label: 'Развлечься',
        title: 'ЭТАЖ 69',
        priceRubles: 45,
        requiresCasinoLikePortalAllowance: true,
        npcPredicate: {
          plotNpcIds: ['f69_performer_ira'],
          exactNames: ['Ира Сцена'],
          namePrefixes: ['Этаж 69: работница '],
        },
        lines: [
          '{npc} называет цену и смотрит на дверь.',
          'Цена: ₽{price}.',
          'Закрытая сцена будет реализована позже; сейчас это атмосферный вход в будущий интерфейс.',
        ],
        message: 'Оплата пока не списана: сцена не реализована.',
      },
    ],
    portalPolicy: {
      strictPortalBlocked: true,
    },
  },
] as const;

export function designFloorProfile(id: string | undefined): DesignFloorProfile | undefined {
  if (!id) return undefined;
  return DESIGN_FLOOR_PROFILES.find(profile => profile.routeId === id);
}

export function allDesignFloorProfiles(): readonly DesignFloorProfile[] {
  return DESIGN_FLOOR_PROFILES;
}

export function designFloorProfileForRouteKey(floorKey: string | undefined): DesignFloorProfile | undefined {
  if (!floorKey) return undefined;
  const clean = floorKey.trim();
  if (!clean.startsWith('design:')) return undefined;
  return designFloorProfile(clean.slice('design:'.length));
}

export function designFloorFactionWeightMultiplier(floorKey: string, faction: Faction): number {
  const profile = designFloorProfileForRouteKey(floorKey);
  const modifier = profile?.factionWeightModifiers?.find(item => item.faction === faction);
  return Math.max(0, modifier?.multiplier ?? 1);
}

export function designFloorFemaleProbability(
  floorKey: string,
  occupation: Occupation,
  fallback: number,
): number {
  const demographics = designFloorProfileForRouteKey(floorKey)?.demographics;
  const occupationOverride = demographics?.femaleProbabilityByOccupation
    ?.find(item => item.occupation === occupation)?.probability;
  const probability = occupationOverride ?? demographics?.femaleProbability ?? fallback;
  return Math.max(0, Math.min(1, probability));
}

export function designFloorAgeRange(
  floorKey: string,
  occupation: Occupation,
): DesignFloorAgeRange | undefined {
  const demographics = designFloorProfileForRouteKey(floorKey)?.demographics;
  return demographics?.ageRangeByOccupation?.find(item => item.occupation === occupation)
    ?? demographics?.ageRange;
}

export function designFloorAmbientLight(id: string | undefined, fallback: number): number {
  const value = designFloorProfile(id)?.render?.ambientLight;
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

export function designFloorPseudoliftChance(id: string | undefined): number {
  const value = designFloorProfile(id)?.pseudolift?.chance;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
