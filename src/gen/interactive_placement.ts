import { Cell, Feature, W, type Room } from '../core/types';
import { World } from '../core/world';
import { placeInteractive, type InteractiveInstance } from '../systems/interactive';

export interface RoomInteractivePlacementOptions {
  seed?: number;
  attempts?: number;
  tags?: readonly string[];
  forceFeature?: boolean;
}

function roomCandidate(world: World, room: Room, n: number): { x: number; y: number; idx: number } | null {
  const innerW = Math.max(1, room.w - 2);
  const innerH = Math.max(1, room.h - 2);
  const x = world.wrap(room.x + 1 + ((n * 5 + room.id * 3) % innerW));
  const y = world.wrap(room.y + 1 + ((n * 7 + room.id * 11) % innerH));
  const idx = world.idx(x, y);
  if (world.aptMask[idx] || world.hermoWall[idx]) return null;
  if (world.roomMap[idx] !== room.id) return null;
  if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) return null;
  if (world.containerMap.has(idx)) return null;
  return { x, y, idx };
}

export function placeInteractiveInRoom(
  world: World,
  room: Room,
  defId: string,
  options: RoomInteractivePlacementOptions = {},
): InteractiveInstance | null {
  const attempts = Math.max(1, Math.min(128, Math.floor(options.attempts ?? 32)));
  for (let n = 0; n < attempts; n++) {
    const candidate = roomCandidate(world, room, n + (options.seed ?? 0));
    if (!candidate) continue;
    if (!options.forceFeature && world.features[candidate.idx] !== Feature.NONE) continue;
    const placed = placeInteractive(world, {
      defId,
      x: candidate.x,
      y: candidate.y,
      seed: options.seed,
      tags: options.tags,
      forceFeature: options.forceFeature,
    });
    if (placed) return placed;
  }
  return null;
}

export function placeInteractiveAt(
  world: World,
  x: number,
  y: number,
  defId: string,
  options: Omit<RoomInteractivePlacementOptions, 'attempts'> = {},
): InteractiveInstance | null {
  return placeInteractive(world, {
    defId,
    x: world.wrap(x),
    y: world.wrap(y),
    seed: options.seed ?? ((world.wrap(x) + world.wrap(y) * W) >>> 0),
    tags: options.tags,
    forceFeature: options.forceFeature,
  });
}
