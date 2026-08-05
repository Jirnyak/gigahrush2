import { stampBadAppleWorld, findBadAppleSiteNear } from '../../systems/procedural_anomalies/bad_apple_world';
import type { ProceduralAnomalyGenContext } from './common';

export function applyBadAppleWorld(ctx: ProceduralAnomalyGenContext): void {
  const site = findBadAppleSiteNear(ctx.world, ctx.spawnX, ctx.spawnY);
  stampBadAppleWorld(ctx.world, site.x, site.y, { x: ctx.spawnX, y: ctx.spawnY });
}
