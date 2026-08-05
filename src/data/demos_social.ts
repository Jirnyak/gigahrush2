import {
  DEMOS_EDGE_DEBT,
  DEMOS_EDGE_ENEMY,
  DEMOS_EDGE_FACTION,
  DEMOS_EDGE_FAMILY,
  DEMOS_EDGE_FRIEND,
  DEMOS_EDGE_HIDDEN,
  DEMOS_EDGE_QUEST,
  DEMOS_EDGE_WORK,
} from './demos_posts';

export const DEMOS_SOCIAL_PLAYER_SLOT = 0;
export const DEMOS_SOCIAL_NPC_SLOT_START = 1;
export const DEMOS_PLAYER_SOCIAL_SLOT = DEMOS_SOCIAL_PLAYER_SLOT;
export const DEMOS_SOCIAL_NPC_SLOTS = 9;
export const DEMOS_SOCIAL_INITIAL_NPC_SLOTS = 4;
export const DEMOS_SOCIAL_PUBLIC_SLOTS = 10;
export const DEMOS_SOCIAL_SLOTS = DEMOS_SOCIAL_PUBLIC_SLOTS;
export const DEMOS_SOCIAL_CANDIDATE_TRIES = 24;
export const DEMOS_RELATION_EMPTY = -128;
export const DEMOS_RELATION_MIN = -127;
export const DEMOS_RELATION_MAX = 127;
export const DEMOS_RELATION_HOSTILE_THRESHOLD = -64;
export const DEMOS_RELATION_FRIENDLY_THRESHOLD = 64;
export const DEMOS_SOCIAL_OVERRIDE_CAP = 8192;

export {
  DEMOS_EDGE_DEBT,
  DEMOS_EDGE_ENEMY,
  DEMOS_EDGE_FACTION,
  DEMOS_EDGE_FAMILY,
  DEMOS_EDGE_FRIEND,
  DEMOS_EDGE_HIDDEN,
  DEMOS_EDGE_QUEST,
  DEMOS_EDGE_WORK,
};

export type DemosRelationBandId = 'enemy' | 'cold' | 'neutral' | 'warm' | 'friend';

export enum DemosSocialRoleId {
  ACQUAINTANCE = 0,
  FRIEND = 1,
  RIVAL = 2,
  ENEMY = 3,
  PARENT = 4,
  CHILD = 5,
  PARTNER = 6,
  WORK = 7,
  DEBT = 8,
  QUEST = 9,
}

export type DemosSocialEdgeFlagId =
  | 'family'
  | 'friend'
  | 'enemy'
  | 'work'
  | 'faction'
  | 'debt'
  | 'quest'
  | 'hidden';

export const DEMOS_SOCIAL_EDGE_FLAG_BY_ID: Readonly<Record<DemosSocialEdgeFlagId, number>> = {
  family: DEMOS_EDGE_FAMILY,
  friend: DEMOS_EDGE_FRIEND,
  enemy: DEMOS_EDGE_ENEMY,
  work: DEMOS_EDGE_WORK,
  faction: DEMOS_EDGE_FACTION,
  debt: DEMOS_EDGE_DEBT,
  quest: DEMOS_EDGE_QUEST,
  hidden: DEMOS_EDGE_HIDDEN,
};

export const DEMOS_SOCIAL_ROLE_BY_ID: Readonly<Record<string, DemosSocialRoleId>> = {
  acquaintance: DemosSocialRoleId.ACQUAINTANCE,
  friend: DemosSocialRoleId.FRIEND,
  rival: DemosSocialRoleId.RIVAL,
  enemy: DemosSocialRoleId.ENEMY,
  parent: DemosSocialRoleId.PARENT,
  child: DemosSocialRoleId.CHILD,
  partner: DemosSocialRoleId.PARTNER,
  work: DemosSocialRoleId.WORK,
  debt: DemosSocialRoleId.DEBT,
  quest: DemosSocialRoleId.QUEST,
};

export function demosSocialRoleIdById(input: unknown, fallback = DemosSocialRoleId.ACQUAINTANCE): DemosSocialRoleId {
  if (typeof input === 'number' && Number.isInteger(input) && input >= DemosSocialRoleId.ACQUAINTANCE && input <= DemosSocialRoleId.QUEST) {
    return input as DemosSocialRoleId;
  }
  if (typeof input !== 'string') return fallback;
  return DEMOS_SOCIAL_ROLE_BY_ID[input] ?? fallback;
}

export function demosSocialFlagsFromIds(input: readonly string[] | undefined): number {
  let out = 0;
  for (const raw of input ?? []) {
    out |= DEMOS_SOCIAL_EDGE_FLAG_BY_ID[raw as DemosSocialEdgeFlagId] ?? 0;
  }
  return out & 0xff;
}

export interface DemosAuthoredRelationDef {
  fromPlotNpcId: string;
  toPlotNpcId: string;
  relation: number;
  role: DemosSocialRoleId;
  flags?: number;
  bidirectional?: boolean;
}

export const DEMOS_AUTHORED_RELATIONS: readonly DemosAuthoredRelationDef[] = [
  {
    fromPlotNpcId: 'olga',
    toPlotNpcId: 'yakov',
    relation: 88,
    role: DemosSocialRoleId.FRIEND,
    flags: DEMOS_EDGE_FRIEND,
    bidirectional: true,
  },
  {
    fromPlotNpcId: 'barni',
    toPlotNpcId: 'olga',
    relation: 98,
    role: DemosSocialRoleId.PARTNER,
    flags: DEMOS_EDGE_FRIEND,
    bidirectional: true,
  },
  {
    fromPlotNpcId: 'vanka',
    toPlotNpcId: 'yakov',
    relation: 22,
    role: DemosSocialRoleId.ACQUAINTANCE,
    bidirectional: true,
  },
  {
    fromPlotNpcId: 'major_grom',
    toPlotNpcId: 'yakov',
    relation: 34,
    role: DemosSocialRoleId.ACQUAINTANCE,
    flags: DEMOS_EDGE_WORK,
    bidirectional: true,
  },
  {
    fromPlotNpcId: 'rotenbergov',
    toPlotNpcId: 'f69_accountant_nil',
    relation: -96,
    role: DemosSocialRoleId.ENEMY,
    flags: DEMOS_EDGE_ENEMY | DEMOS_EDGE_DEBT,
    bidirectional: true,
  },
] as const;
