import { Feature, RoomType, W } from '../core/types';
import { World } from '../core/world';
import { placeInteractiveAt } from './interactive_placement';

const BROKEN_FIXTURE_BY_FEATURE: Partial<Record<Feature, string>> = {
  [Feature.SINK]: 'sink_broken',
  [Feature.TOILET]: 'toilet_broken',
};

function hashFixture(idx: number, salt: number): number {
  let h = (idx + 1) ^ ((salt + 1) * 0x9e3779b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function fixtureBrokenChance(roomType: RoomType | undefined, baseChance: number): number {
  if (roomType === RoomType.BATHROOM) return Math.min(0.32, baseChance * 1.45);
  if (roomType === RoomType.KITCHEN) return Math.min(0.18, baseChance * 0.8);
  return Math.min(0.12, baseChance * 0.45);
}

export interface BrokenFixturePlacementOptions {
  salt?: number;
  baseChance?: number;
}

export function maybePlaceBrokenFixture(
  world: World,
  x: number,
  y: number,
  options: BrokenFixturePlacementOptions = {},
): boolean {
  const idx = world.idx(x, y);
  const defId = BROKEN_FIXTURE_BY_FEATURE[world.features[idx] as Feature];
  if (!defId) return false;

  const roomId = world.roomMap[idx] ?? -1;
  const room = roomId >= 0 ? world.rooms[roomId] : undefined;
  const chance = fixtureBrokenChance(room?.type, Math.max(0, Math.min(1, options.baseChance ?? 0.08)));
  const roll = hashFixture(idx, options.salt ?? room?.id ?? 0) / 0xffffffff;
  if (roll >= chance) return false;

  return !!placeInteractiveAt(world, idx % W, (idx / W) | 0, defId, {
    seed: hashFixture(idx, (options.salt ?? 0) + 17),
  });
}
