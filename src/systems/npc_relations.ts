import { Faction, type Entity } from '../core/types';
import { getFactionRel } from '../data/relations';

export const RELATION_MIN = -100;
export const RELATION_MAX = 100;
export const HOSTILE_RELATION_THRESHOLD = -50;
export const FRIENDLY_RELATION_THRESHOLD = 50;
export const NPC_PLAYER_RELATION_FLUCTUATION = 12;
export const QUEST_FACTION_RELATION_DELTA = 1;

export function clampRelation(value: number): number {
  return Math.max(RELATION_MIN, Math.min(RELATION_MAX, Math.trunc(value)));
}

export function getFactionPlayerRelation(faction: Faction | undefined): number {
  return getFactionRel(faction ?? Faction.CITIZEN, Faction.PLAYER);
}

export function getNpcPlayerRelation(npc: Entity): number {
  return npc.playerRelation ?? getFactionPlayerRelation(npc.faction);
}

export function setNpcPlayerRelation(npc: Entity, value: number): number {
  const relation = clampRelation(value);
  npc.playerRelation = relation;
  return relation;
}

export function addNpcPlayerRelation(npc: Entity, delta: number): number {
  return setNpcPlayerRelation(npc, getNpcPlayerRelation(npc) + delta);
}

export function isNpcPlayerHostile(npc: Entity): boolean {
  return getNpcPlayerRelation(npc) <= HOSTILE_RELATION_THRESHOLD;
}

export function completedQuestFactionRelationDelta(authoredDelta: number | undefined): number {
  if (authoredDelta === undefined) return QUEST_FACTION_RELATION_DELTA;
  if (authoredDelta > 0) return QUEST_FACTION_RELATION_DELTA;
  return Math.max(RELATION_MIN, Math.min(0, Math.trunc(authoredDelta)));
}

export function completedQuestGiverRelationDelta(authoredDelta: number | undefined, difficulty: number | undefined): number {
  const source = authoredDelta !== undefined
    ? Math.abs(authoredDelta)
    : 8 + Math.max(0, Math.floor(difficulty ?? 0));
  return Math.max(2, Math.min(8, Math.round(source * 0.45)));
}
