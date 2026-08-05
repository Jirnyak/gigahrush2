import type { World } from '../core/world';
import { EntityType, W, type Entity } from '../core/types';
import { MONSTERS } from '../entities/monster';
import { pathBlockedAt } from '../core/path_blockers';

export interface ActorOccupyOptions {
  ignoreFineBlockers?: boolean;
  ignoreCoarseSolids?: boolean;
}

export interface ActorOccupyPosition {
  x: number;
  y: number;
}

export interface ActorUnstuckOptions {
  radius?: number;
  maxCellRadius?: number;
}

const ACTOR_UNSTUCK_OFFSETS = [
  [0.5, 0.5],
  [0.25, 0.5],
  [0.75, 0.5],
  [0.5, 0.25],
  [0.5, 0.75],
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
] as const;

export function entityIgnoresFineBlockers(e: Pick<Entity, 'type' | 'monsterKind'>): boolean {
  if (e.type !== EntityType.MONSTER || e.monsterKind === undefined) return false;
  const flags = MONSTERS[e.monsterKind]?.aiFlags;
  return flags !== undefined && (flags.includes('flying') || flags.includes('noclip') || flags.includes('falsePhase'));
}

export function actorOccupyRadius(e: Pick<Entity, 'type' | 'height' | 'radius' | 'monsterKind'>): number {
  if (e.radius !== undefined) return e.radius;
  if (e.type === EntityType.MONSTER && e.monsterKind !== undefined) {
    const override = MONSTERS[e.monsterKind]?.radius;
    if (override !== undefined) return override;
    return 0.18;
  }
  if (e.height !== undefined) return 0.16 * (e.height / 1.8);
  return 0.16;
}

export function canActorOccupyCoarse(world: World, x: number, y: number, radius: number): boolean {
  return !world.solid(Math.floor(x + radius), Math.floor(y + radius)) &&
    !world.solid(Math.floor(x + radius), Math.floor(y - radius)) &&
    !world.solid(Math.floor(x - radius), Math.floor(y + radius)) &&
    !world.solid(Math.floor(x - radius), Math.floor(y - radius));
}

export function canActorOccupyFine(world: World, x: number, y: number, radius: number): boolean {
  void radius;
  return !pathBlockedAt(world, x, y);
}

export function canActorOccupy(
  world: World,
  x: number,
  y: number,
  radius: number,
  options: ActorOccupyOptions = {},
): boolean {
  if (!options.ignoreCoarseSolids && !canActorOccupyCoarse(world, x, y, radius)) return false;
  if (!options.ignoreFineBlockers && !canActorOccupyFine(world, x, y, radius)) return false;
  return true;
}

export function findNearestActorOccupyPosition(
  world: World,
  x: number,
  y: number,
  radius: number,
  maxCellRadius = 6,
  options: ActorOccupyOptions = {},
): ActorOccupyPosition | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (canActorOccupy(world, x, y, radius, options)) return { x: world.wrap(x), y: world.wrap(y) };

  const baseX = Math.floor(x);
  const baseY = Math.floor(y);
  const maxR = Math.max(0, Math.min(W >> 1, Math.floor(maxCellRadius)));

  for (let r = 0; r <= maxR; r++) {
    let best: ActorOccupyPosition | null = null;
    let bestD2 = Infinity;

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const cellX = world.wrap(baseX + dx);
        const cellY = world.wrap(baseY + dy);
        for (const [ox, oy] of ACTOR_UNSTUCK_OFFSETS) {
          const px = cellX + ox;
          const py = cellY + oy;
          if (!canActorOccupy(world, px, py, radius, options)) continue;
          const d2 = world.dist2(x, y, px, py);
          if (d2 >= bestD2) continue;
          bestD2 = d2;
          best = { x: px, y: py };
        }
      }
    }

    if (best) return best;
  }

  return null;
}

export function unstuckActorFromBlockers(
  world: World,
  e: Entity,
  options: ActorUnstuckOptions = {},
): boolean {
  // If the entity is directly inside a solid block, do not unstuck so it takes crush damage
  if (world.solid(Math.floor(e.x), Math.floor(e.y))) return false;

  const radius = options.radius ?? actorOccupyRadius(e);
  const ignoreFineBlockers = entityIgnoresFineBlockers(e);
  if (canActorOccupy(world, e.x, e.y, radius, { ignoreFineBlockers })) return false;

  const pos = findNearestActorOccupyPosition(world, e.x, e.y, radius, options.maxCellRadius, { ignoreFineBlockers });
  if (!pos) return false;

  e.x = pos.x;
  e.y = pos.y;
  if (e.ai) {
    e.ai.path = [];
    e.ai.pi = 0;
    e.ai.stuck = 0;
    e.ai.tx = Math.floor(pos.x);
    e.ai.ty = Math.floor(pos.y);
  }
  return true;
}
