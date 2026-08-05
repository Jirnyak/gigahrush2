import { EntityType } from '../core/types';

export const DEFAULT_ACTIVE_ACTOR_SOFT_LIMIT = 4_096;
export const MIN_ACTIVE_ACTOR_SOFT_LIMIT = 1_024;
export const MAX_ACTIVE_ACTOR_SOFT_LIMIT = 16_384;
export const ACTIVE_ACTOR_SOFT_LIMIT_STEP = 1_024;
export let ACTIVE_ACTOR_SOFT_LIMIT = DEFAULT_ACTIVE_ACTOR_SOFT_LIMIT;
export const FLOOR_OBJECT_SOFT_LIMIT = 65_536;
export const MAX_ACTIVE_MACRO_GOALS = 3;

export const ENTITY_SOFT_LIMITS: Partial<Record<EntityType, number>> = {
  [EntityType.NPC]: ACTIVE_ACTOR_SOFT_LIMIT,
  [EntityType.MONSTER]: ACTIVE_ACTOR_SOFT_LIMIT,
  [EntityType.ITEM_DROP]: FLOOR_OBJECT_SOFT_LIMIT,
  [EntityType.PROJECTILE]: FLOOR_OBJECT_SOFT_LIMIT,
  [EntityType.BILLBOARD]: FLOOR_OBJECT_SOFT_LIMIT,
};

export function normalizeActiveActorSoftLimit(value: unknown): number {
  if (value === null || value === undefined || value === '') return DEFAULT_ACTIVE_ACTOR_SOFT_LIMIT;
  const raw = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(raw)) return DEFAULT_ACTIVE_ACTOR_SOFT_LIMIT;
  const stepped = Math.round(raw / ACTIVE_ACTOR_SOFT_LIMIT_STEP) * ACTIVE_ACTOR_SOFT_LIMIT_STEP;
  return Math.max(MIN_ACTIVE_ACTOR_SOFT_LIMIT, Math.min(MAX_ACTIVE_ACTOR_SOFT_LIMIT, stepped));
}

export function setActiveActorSoftLimit(value: unknown): number {
  const next = normalizeActiveActorSoftLimit(value);
  ACTIVE_ACTOR_SOFT_LIMIT = next;
  ENTITY_SOFT_LIMITS[EntityType.NPC] = next;
  ENTITY_SOFT_LIMITS[EntityType.MONSTER] = next;
  return next;
}

export function activeActorSoftLimit(): number {
  return ACTIVE_ACTOR_SOFT_LIMIT;
}

export function activeActorSoftLimitScale(cap = activeActorSoftLimit()): number {
  return Math.max(0, cap) / DEFAULT_ACTIVE_ACTOR_SOFT_LIMIT;
}

// Generation densities are authored as "count at default cap" and resolved at generation time.
export function activeActorCountAtDefaultSoftLimit(countAtDefault: number, cap = activeActorSoftLimit()): number {
  if (!Number.isFinite(countAtDefault) || countAtDefault <= 0) return 0;
  return Math.max(0, Math.round(countAtDefault * activeActorSoftLimitScale(cap)));
}

export function fitActiveActorCounts(npcs: number, monsters: number, cap = activeActorSoftLimit()): { npcs: number; monsters: number } {
  const npcTarget = Math.max(0, Math.round(npcs));
  const monsterTarget = Math.max(0, Math.round(monsters));
  const total = npcTarget + monsterTarget;
  const actorCap = Math.max(0, Math.floor(cap));
  if (total <= actorCap) return { npcs: npcTarget, monsters: monsterTarget };
  if (actorCap <= 0 || total <= 0) return { npcs: 0, monsters: 0 };

  const scaledNpc = npcTarget * actorCap / total;
  const scaledMonster = monsterTarget * actorCap / total;
  let fitNpcs = Math.floor(scaledNpc);
  let fitMonsters = Math.floor(scaledMonster);

  if (npcTarget > 0 && fitNpcs === 0 && actorCap > fitMonsters) fitNpcs = 1;
  if (monsterTarget > 0 && fitMonsters === 0 && actorCap > fitNpcs) fitMonsters = 1;

  while (fitNpcs + fitMonsters > actorCap) {
    if (fitMonsters >= fitNpcs && fitMonsters > 0) fitMonsters--;
    else if (fitNpcs > 0) fitNpcs--;
    else break;
  }

  let remainder = actorCap - fitNpcs - fitMonsters;
  const npcFrac = scaledNpc - Math.floor(scaledNpc);
  const monsterFrac = scaledMonster - Math.floor(scaledMonster);
  while (remainder > 0) {
    if ((monsterTarget > 0 && monsterFrac >= npcFrac) || npcTarget <= 0) fitMonsters++;
    else fitNpcs++;
    remainder--;
  }

  return { npcs: fitNpcs, monsters: fitMonsters };
}
