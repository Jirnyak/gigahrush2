import { AIGoal, type Entity } from '../../core/types';
import { ENTITY_MASK_MONSTER, getEntityIndex } from '../entity_index';

export type LocalTargetSharePredicate<TContext = undefined> = (
  candidate: Entity,
  actor: Entity,
  target: Entity,
  context: TContext,
) => boolean;

export interface LocalTargetShareOptions<TContext = undefined> {
  radius: number;
  cap: number;
  scratch: Entity[];
  typeMask?: number;
  context: TContext;
  predicate?: LocalTargetSharePredicate<TContext>;
}

export function shareLocalTarget<TContext = undefined>(
  actor: Entity,
  target: Entity,
  options: LocalTargetShareOptions<TContext>,
): number {
  getEntityIndex().queryRadiusCapped(
    actor.x,
    actor.y,
    options.radius,
    options.scratch,
    options.typeMask ?? ENTITY_MASK_MONSTER,
    options.cap,
  );

  let shared = 0;
  for (const candidate of options.scratch) {
    if (candidate.id === actor.id || !candidate.alive || !candidate.ai) continue;
    if (options.predicate && !options.predicate(candidate, actor, target, options.context)) continue;
    candidate.ai.combatTargetId = target.id;
    candidate.ai.goal = AIGoal.HUNT;
    candidate.ai.timer = Math.min(candidate.ai.timer, 0.1);
    shared++;
  }
  return shared;
}
