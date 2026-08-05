import { EntityType, type Entity } from '../core/types';
import type { World } from '../core/world';

import { WEAPON_STATS } from '../data/catalog';

const MELEE_TARGET_EPSILON = 1e-9;

export function selectMeleeTarget(
  world: World,
  attacker: Entity,
  candidates: readonly Entity[],
  reach: number,
  weaponId?: string,
): Entity | undefined {
  const hitRadius = WEAPON_STATS[weaponId || '']?.hitRadius ?? 0.6;

  const dirX = Math.cos(attacker.angle);
  const dirY = Math.sin(attacker.angle);

  let best: Entity | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestId = Number.MAX_SAFE_INTEGER;

  for (const candidate of candidates) {
    if ((candidate.type !== EntityType.MONSTER && candidate.type !== EntityType.NPC) || !candidate.alive) continue;
    if (candidate.id === attacker.id) continue;

    const dx = world.delta(attacker.x, candidate.x);
    const dy = world.delta(attacker.y, candidate.y);

    const forward = dx * dirX + dy * dirY;
    if (forward < -0.2) continue;

    const closestT = Math.max(0, Math.min(reach, forward));
    const distDx = dx - dirX * closestT;
    const distDy = dy - dirY * closestT;
    const dist2 = distDx * distDx + distDy * distDy;

    const targetRadius = candidate.type === EntityType.MONSTER ? 0.18 : 0.16;
    const effectiveRadius = hitRadius + targetRadius;

    if (dist2 > effectiveRadius * effectiveRadius) continue;

    const lateral = Math.abs(dx * dirY - dy * dirX);
    const forwardMiss = Math.abs(reach - forward);
    const score = lateral * 64 + forwardMiss * 8 + dist2;

    if (score + MELEE_TARGET_EPSILON < bestScore
      || (Math.abs(score - bestScore) <= MELEE_TARGET_EPSILON && candidate.id < bestId)) {
      best = candidate;
      bestScore = score;
      bestId = candidate.id;
    }
  }

  return best;
}
