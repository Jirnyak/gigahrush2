import { Cell, Tex, RoomType, Feature, type Entity, W } from '../../core/types';
import { World } from '../../core/world';
import { rng, stampRoom } from '../shared';

export function generateLiquidatorBaseArena(world: World, entities: Entity[], nextId: number): number {
  const size = 50;
  // Let's find a place for the arena, let's say near the center but avoiding spawn.
  const cx = Math.floor(W / 2) + rng(-50, 50);
  const cy = Math.floor(W / 2) + rng(-50, 50);

  // We need to carve out a room.
  const room = stampRoom(world, world.rooms.length, RoomType.COMMON, cx, cy, size, size, 0);
  room.name = 'Арена';

  const ringSize = 20;
  const rx = cx + Math.floor(size / 2) - Math.floor(ringSize / 2);
  const ry = cy + Math.floor(size / 2) - Math.floor(ringSize / 2);

  for (let yy = -1; yy <= size; yy++) {
    for (let xx = -1; xx <= size; xx++) {
      const px = cx + xx;
      const py = cy + yy;
      const idx = world.idx(px, py);

      if (xx === -1 || xx === size || yy === -1 || yy === size) {
        world.cells[idx] = Cell.WALL;
        world.wallTex[idx] = Tex.METAL;
      } else {
        world.cells[idx] = Cell.FLOOR;
        world.floorTex[idx] = Tex.F_CONCRETE;

        // Ring
        if (px >= rx && px < rx + ringSize && py >= ry && py < ry + ringSize) {
          // Ring bounds
          if (px === rx || px === rx + ringSize - 1 || py === ry || py === ry + ringSize - 1) {
            world.setFeatureAt(idx, Feature.TABLE);
          }
        } else {
           // Tribunes
           if (rng(1, 100) <= 30) {
             world.setFeatureAt(idx, Feature.CHAIR);
           }
        }
      }
    }
  }

  // Actually we need 2 doors for arena
  let doorsAdded = 0;

  for (let yy = -1; yy <= size; yy++) {
    for (let xx = -1; xx <= size; xx++) {
      if (doorsAdded >= 2) break;
      if (xx === -1 || xx === size || yy === -1 || yy === size) {
        const px = cx + xx;
        const py = cy + yy;
        const idx = world.idx(px, py);
        if (world.cells[idx] === Cell.WALL && rng(1, 100) <= 5) {
          world.cells[idx] = Cell.DOOR;
          doorsAdded++;
        }
      }
    }
  }

  if (entities.length > 0) {
    // dummy check to avoid ts warning, usually we do something with entities.
  }

  return nextId;
}
