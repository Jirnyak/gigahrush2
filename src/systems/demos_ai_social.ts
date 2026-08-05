import {
  type Entity,
  type GameState,
  W,
} from '../core/types';
import {
  DEMOS_EDGE_ENEMY,
  DEMOS_EDGE_FAMILY,
  DEMOS_EDGE_FRIEND,
  DEMOS_RELATION_FRIENDLY_THRESHOLD,
  DEMOS_RELATION_HOSTILE_THRESHOLD,
} from '../data/demos_social';
import { getDemosNpcOnlySocialEdges } from './demos_social';

export interface DemosAiSocialContext {
  actorAlifeId: number;
  friendNearby: boolean;
  familyNearby: boolean;
  enemyNearby: boolean;
  strongestFriendEntityId?: number;
  strongestEnemyEntityId?: number;
  escortBias: number;
  fleeBias: number;
  talkBias: number;
  targetHostilityBias: number;
}

const SOCIAL_NEARBY_RADIUS = 24;
const SOCIAL_NEARBY_RADIUS2 = SOCIAL_NEARBY_RADIUS * SOCIAL_NEARBY_RADIUS;

function wrappedDelta(from: number, to: number): number {
  return ((to - from + W / 2) % W + W) % W - W / 2;
}

function toroidalDist2(a: Entity, b: Entity): number {
  const dx = wrappedDelta(a.x, b.x);
  const dy = wrappedDelta(a.y, b.y);
  return dx * dx + dy * dy;
}

function clampBias(value: number): number {
  return Math.max(-24, Math.min(24, Math.round(value * 10) / 10));
}

export function buildDemosAiSocialContext(
  state: GameState,
  actor: Entity,
  liveByAlifeId: ReadonlyMap<number, Entity>,
): DemosAiSocialContext | undefined {
  const actorAlifeId = actor.alifeId;
  if (!Number.isInteger(actorAlifeId) || actorAlifeId! <= 0) return undefined;
  const context: DemosAiSocialContext = {
    actorAlifeId: actorAlifeId!,
    friendNearby: false,
    familyNearby: false,
    enemyNearby: false,
    escortBias: 0,
    fleeBias: 0,
    talkBias: 0,
    targetHostilityBias: 0,
  };

  let strongestFriendRelation = Number.NEGATIVE_INFINITY;
  let strongestEnemyRelation = Number.POSITIVE_INFINITY;
  for (const edge of getDemosNpcOnlySocialEdges(state, actorAlifeId!)) {
    const targetAlifeId = edge.targetAlifeId;
    if (targetAlifeId === undefined) continue;
    const target = liveByAlifeId.get(targetAlifeId);
    if (!target?.alive || target.id === actor.id) continue;
    const near = toroidalDist2(actor, target) <= SOCIAL_NEARBY_RADIUS2;
    if (!near) continue;

    const family = (edge.flags & DEMOS_EDGE_FAMILY) !== 0;
    const friend = family || (edge.flags & DEMOS_EDGE_FRIEND) !== 0 || edge.relation >= DEMOS_RELATION_FRIENDLY_THRESHOLD;
    const enemy = (edge.flags & DEMOS_EDGE_ENEMY) !== 0 || edge.relation <= DEMOS_RELATION_HOSTILE_THRESHOLD;
    if (family) {
      context.familyNearby = true;
      context.escortBias += 7;
      context.talkBias += 4;
    }
    if (friend) {
      context.friendNearby = true;
      context.escortBias += Math.max(2, edge.relation / 18);
      context.talkBias += Math.max(2, edge.relation / 16);
      if (edge.relation > strongestFriendRelation) {
        strongestFriendRelation = edge.relation;
        context.strongestFriendEntityId = target.id;
      }
    }
    if (enemy) {
      context.enemyNearby = true;
      context.fleeBias += Math.max(2, Math.abs(edge.relation) / 14);
      context.targetHostilityBias += Math.max(3, Math.abs(edge.relation) / 10);
      if (edge.relation < strongestEnemyRelation) {
        strongestEnemyRelation = edge.relation;
        context.strongestEnemyEntityId = target.id;
      }
    }
  }

  context.escortBias = clampBias(context.escortBias);
  context.fleeBias = clampBias(context.fleeBias);
  context.talkBias = clampBias(context.talkBias);
  context.targetHostilityBias = clampBias(context.targetHostilityBias);
  return context;
}
