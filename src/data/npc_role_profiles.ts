import { Faction, Occupation } from '../core/types';

export const NPC_VISUAL_FLOOR69_FEMALE_ID = 'floor_69_female';
import { NPC_VISUAL_WORKER69 } from './art_sprite_manifest';
export const FLOOR_69_WORKER_ROLE_ID = 'floor_69_worker';
export const FLOOR_69_GUARD_ROLE_ID = 'f69_queue_guard';
export const FLOOR_69_PERFORMER_ROLE_ID = 'f69_performer';

export type NpcRoleScope = 'ambient' | 'design_floor' | 'plot';

export interface NpcRoleProfile {
  id: string;
  label: string;
  scope: NpcRoleScope;
  floorKeys?: readonly string[];
  baseOccupations: readonly Occupation[];
  candidateOccupations?: readonly Occupation[];
  outputOccupation?: Occupation;
  candidateFaction?: Faction;
  requiresFemale?: boolean;
  sourceNamePrefix?: string;
  roleNamePrefix?: string;
  promotionRate?: number;
  npcVisualId?: string;
  tags?: readonly string[];
}

export const NPC_ROLE_PROFILES: readonly NpcRoleProfile[] = [
  {
    id: FLOOR_69_WORKER_ROLE_ID,
    label: 'работница этажа 69',
    scope: 'design_floor',
    floorKeys: ['design:floor_69'],
    baseOccupations: [
      Occupation.WORKER69,
    ],
    candidateOccupations: [
      Occupation.WORKER69,
      Occupation.PERFORMER,
      Occupation.TRAVELER,
      Occupation.HOUSEWIFE,
      Occupation.SECRETARY,
      Occupation.STOREKEEPER,
      Occupation.DIRECTOR,
    ],
    outputOccupation: Occupation.WORKER69,
    candidateFaction: Faction.CITIZEN,
    sourceNamePrefix: 'Этаж 69: посетитель ',
    roleNamePrefix: 'Этаж 69: работница ',
    promotionRate: 0.78,
    npcVisualId: NPC_VISUAL_WORKER69,
    tags: ['floor_69', 'adult_service', 'ambient_promotion'],
  },
  {
    id: FLOOR_69_GUARD_ROLE_ID,
    label: 'охранник очереди 69',
    scope: 'design_floor',
    floorKeys: ['design:floor_69'],
    baseOccupations: [Occupation.HUNTER],
    tags: ['floor_69', 'security'],
  },
  {
    id: FLOOR_69_PERFORMER_ROLE_ID,
    label: 'перформер этажа 69',
    scope: 'design_floor',
    floorKeys: ['design:floor_69'],
    baseOccupations: [Occupation.PERFORMER],
    npcVisualId: NPC_VISUAL_FLOOR69_FEMALE_ID,
    tags: ['floor_69', 'performer'],
  },
] as const;

const ROLE_PROFILE_ID_RE = /^[a-z][a-z0-9_]*$/;
const ROLE_PROFILE_SCOPES = new Set<NpcRoleScope>(['ambient', 'design_floor', 'plot']);
const KNOWN_OCCUPATIONS = new Set<Occupation>(
  Object.values(Occupation).filter((value): value is Occupation => typeof value === 'number'),
);
const KNOWN_FACTIONS = new Set<Faction>(
  Object.values(Faction).filter((value): value is Faction => typeof value === 'number'),
);

export function npcRoleProfile(id: string | undefined): NpcRoleProfile | undefined {
  if (!id) return undefined;
  return NPC_ROLE_PROFILES.find(profile => profile.id === id);
}

export function npcRoleProfilesForFloorKey(floorKey: string | undefined): readonly NpcRoleProfile[] {
  if (!floorKey) return [];
  return NPC_ROLE_PROFILES.filter(profile => profile.floorKeys?.includes(floorKey));
}

export function validateNpcRoleProfiles(): readonly string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const profile of NPC_ROLE_PROFILES) {
    if (!profile.id.trim()) errors.push('role profile has empty id');
    if (seen.has(profile.id)) errors.push(`duplicate role profile ${profile.id}`);
    seen.add(profile.id);
    if (!ROLE_PROFILE_ID_RE.test(profile.id)) errors.push(`${profile.id}:id must be lowercase snake_case`);
    if (!ROLE_PROFILE_SCOPES.has(profile.scope)) errors.push(`${profile.id}:unknown scope`);
    if (profile.baseOccupations.length <= 0) errors.push(`${profile.id}:missing base occupations`);
    for (const occupation of profile.baseOccupations) {
      if (!KNOWN_OCCUPATIONS.has(occupation)) errors.push(`${profile.id}:unknown base occupation ${occupation}`);
    }
    for (const occupation of profile.candidateOccupations ?? []) {
      if (!KNOWN_OCCUPATIONS.has(occupation)) errors.push(`${profile.id}:unknown candidate occupation ${occupation}`);
    }
    if (profile.scope === 'design_floor' && (profile.floorKeys?.length ?? 0) <= 0) {
      errors.push(`${profile.id}:design floor role must declare floorKeys`);
    }
    for (const floorKey of profile.floorKeys ?? []) {
      if (!floorKey.trim()) errors.push(`${profile.id}:empty floorKey`);
      if (profile.scope === 'design_floor' && !floorKey.startsWith('design:')) {
        errors.push(`${profile.id}:design floor role must use design: floorKey`);
      }
    }
    if (profile.candidateFaction !== undefined && !KNOWN_FACTIONS.has(profile.candidateFaction)) {
      errors.push(`${profile.id}:unknown candidate faction ${profile.candidateFaction}`);
    }
    if (profile.promotionRate !== undefined && (profile.promotionRate < 0 || profile.promotionRate > 1)) {
      errors.push(`${profile.id}:promotionRate out of range`);
    }
    if (profile.outputOccupation !== undefined && !KNOWN_OCCUPATIONS.has(profile.outputOccupation)) {
      errors.push(`${profile.id}:unknown output occupation ${profile.outputOccupation}`);
    }
    if (profile.outputOccupation !== undefined && !profile.baseOccupations.includes(profile.outputOccupation)) {
      errors.push(`${profile.id}:output occupation must be one of base occupations`);
    }
  }
  return errors;
}
