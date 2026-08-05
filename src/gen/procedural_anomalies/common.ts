import {
  W,
  Cell,
  EntityType,
  Feature,
  type Entity,
  type Room,
} from '../../core/types';
import { World } from '../../core/world';
import type { ProceduralFloorSpec } from '../../data/procedural_floors';
import { Spr } from '../../render/sprite_index';
import {
  buildWalkablePlacementMap,
  isProtectedPlacementCell,
  isValidWalkablePlacementCell,
  isWalkablePlacementCell,
  pickWalkablePlacement,
  type WalkablePlacementMap,
} from '../shared';
import { canSpawnEntityType } from '../../systems/entity_limits';

export interface ProceduralAnomalyGenContext {
  world: World;
  rooms: Room[];
  entities: Entity[];
  nextId: { v: number };
  spec: ProceduralFloorSpec;
  spawnX: number;
  spawnY: number;
  placement: WalkablePlacementMap;
}

const placementByWorld = new WeakMap<World, WalkablePlacementMap>();

export function registerProceduralAnomalyPlacement(world: World, placement: WalkablePlacementMap): void {
  placementByWorld.set(world, placement);
}

function placementForWorld(world: World): WalkablePlacementMap | null {
  return placementByWorld.get(world) ?? null;
}

export function irng(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

export function chance(p: number): boolean {
  return Math.random() < p;
}

export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function roomCenter(room: Room): { x: number; y: number } {
  return {
    x: room.x + Math.floor(room.w / 2),
    y: room.y + Math.floor(room.h / 2),
  };
}

export function roomCell(world: World, room: Room, dx: number, dy: number, requireEmpty = false): { x: number; y: number } | null {
  const x = world.wrap(room.x + Math.max(1, Math.min(room.w - 2, dx)));
  const y = world.wrap(room.y + Math.max(1, Math.min(room.h - 2, dy)));
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR || world.roomMap[ci] !== room.id) return null;
  if (requireEmpty && world.features[ci] !== Feature.NONE) return null;
  return { x, y };
}

export function randomRoomCell(world: World, room: Room, requireEmpty = false): { x: number; y: number } | null {
  const placement = placementForWorld(world);
  if (placement) {
    const center = roomCenter(room);
    const picked = pickWalkablePlacement(world, placement, {
      roomId: room.id,
      requireEmptyFeature: requireEmpty,
      centerX: center.x + 0.5,
      centerY: center.y + 0.5,
      bias: 'near',
    });
    if (picked) return picked;
  }

  if (room.w < 3 || room.h < 3) return null;
  for (let attempt = 0; attempt < 48; attempt++) {
    const pos = roomCell(world, room, irng(1, Math.max(1, room.w - 2)), irng(1, Math.max(1, room.h - 2)), requireEmpty);
    if (pos) return pos;
  }
  return null;
}

export function randomFloorCell(world: World, sx: number, sy: number, minDist2: number, attempts = 4000): { x: number; y: number } | null {
  const placement = placementForWorld(world);
  if (placement) {
    return pickWalkablePlacement(world, placement, {
      centerX: sx,
      centerY: sy,
      minDist2,
      attempts: Math.min(attempts, 256),
    });
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    const x = irng(4, W - 5);
    const y = irng(4, W - 5);
    const ci = world.idx(x, y);
    if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) continue;
    if (isProtectedCell(world, ci)) continue;
    if (minDist2 > 0 && world.dist2(sx, sy, x + 0.5, y + 0.5) < minDist2) continue;
    return { x, y };
  }
  return null;
}

export function isProtectedCell(world: World, ci: number): boolean {
  return isProtectedPlacementCell(world, ci);
}

export function isWalkableCell(world: World, ci: number): boolean {
  const placement = placementForWorld(world);
  if (placement) return isValidWalkablePlacementCell(world, placement, ci);
  return isWalkablePlacementCell(world, ci);
}

function resolveItemDropCell(ctx: ProceduralAnomalyGenContext, x: number, y: number): { x: number; y: number } | null {
  const px = Math.floor(x);
  const py = Math.floor(y);
  const ci = ctx.world.idx(px, py);
  if (isValidWalkablePlacementCell(ctx.world, ctx.placement, ci)) return { x: px, y: py };
  return pickWalkablePlacement(ctx.world, ctx.placement, {
    centerX: px + 0.5,
    centerY: py + 0.5,
    maxRadius: 8,
    bias: 'near',
    attempts: 96,
  }) ?? pickWalkablePlacement(ctx.world, ctx.placement, {
    centerX: ctx.spawnX,
    centerY: ctx.spawnY,
    minRadius: 12,
    bias: 'far',
  }) ?? pickWalkablePlacement(ctx.world, ctx.placement);
}

export function addItemDrop(ctx: ProceduralAnomalyGenContext, x: number, y: number, defId: string, count = 1): void {
  if (!canSpawnEntityType(ctx.entities, EntityType.ITEM_DROP)) return;
  const pos = resolveItemDropCell(ctx, x, y);
  if (!pos) return;
  ctx.entities.push({
    id: ctx.nextId.v++,
    type: EntityType.ITEM_DROP,
    x: pos.x + 0.5,
    y: pos.y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count }],
  });
}

export function rebuildProceduralAnomalyPlacement(ctx: ProceduralAnomalyGenContext): void {
  ctx.placement = buildWalkablePlacementMap(ctx.world, ctx.spawnX, ctx.spawnY);
  registerProceduralAnomalyPlacement(ctx.world, ctx.placement);
}
