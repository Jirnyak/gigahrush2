/* ── Кабинет отказных параграфов — Ministry ranged encounter ─── */

import {
  Cell,
  Feature,
  MonsterKind,
  RoomType,
  Tex,
  type Entity,
} from '../../core/types';
import { World } from '../../core/world';
import {
  type NextId, addItemDrop, createAdminRoom, setFeature, spawnAdminMonster,
} from '../admin_common';
import { genLog } from '../log';

function wallBaffle(world: World, x: number, y: number, len: number, gapA: number, gapB: number): void {
  for (let dx = 0; dx < len; dx++) {
    if (dx === gapA || dx === gapB) continue;
    const ci = world.idx(x + dx, y);
    if (world.cells[ci] !== Cell.FLOOR) continue;
    world.cells[ci] = Cell.WALL;
    world.wallTex[ci] = Tex.MARBLE;
    world.roomMap[ci] = -1;
    world.features[ci] = Feature.NONE;
  }
}

export function generateRefusalClauseOffice(
  world: World, nextRoomId: number, entities: Entity[], nextId: NextId, spawnX: number, spawnY: number,
): { nextRoomId: number } {
  const room = createAdminRoom(world, nextRoomId, spawnX, spawnY, {
    type: RoomType.OFFICE,
    name: 'Кабинет отказных параграфов',
    w: 15, h: 9,
    minDist: 90, maxDist: 210,
    wallTex: Tex.MARBLE,
    floorTex: Tex.F_RED_CARPET,
  });
  if (!room) return { nextRoomId };

  const rx = room.x;
  const ry = room.y;
  const cy = ry + Math.floor(room.h / 2);
  wallBaffle(world, rx + 2, cy - 1, room.w - 4, 3, room.w - 7);
  wallBaffle(world, rx + 2, cy + 1, room.w - 4, 1, room.w - 5);

  for (let dx = 2; dx < room.w - 2; dx += 3) {
    setFeature(world, rx + dx, ry + 2, Feature.DESK);
    setFeature(world, rx + dx, ry + 6, Feature.CHAIR);
  }
  setFeature(world, rx + 1, ry + 1, Feature.LAMP);
  setFeature(world, rx + room.w - 2, ry + 1, Feature.SCREEN);
  setFeature(world, rx + room.w - 2, ry + room.h - 2, Feature.SHELF);
  world.wallTex[world.idx(rx + Math.floor(room.w / 2), ry - 1)] = Tex.SCREEN_BASE + 6;
  world.wallTex[world.idx(rx + room.w, cy)] = Tex.POSTER_BASE + 17;

  addItemDrop(entities, nextId, rx + 2, ry + room.h - 2, 'blank_form', 2);
  addItemDrop(entities, nextId, rx + room.w - 3, ry + 2, 'unsigned_order', 1);
  addItemDrop(entities, nextId, rx + room.w - 3, ry + room.h - 2, 'ink_bottle', 1);

  spawnAdminMonster(world, entities, nextId, rx + room.w - 3, cy, MonsterKind.PARAGRAPH);
  spawnAdminMonster(world, entities, nextId, rx + room.w - 5, cy + 2, MonsterKind.KONTORSHCHIK);

  genLog(`[MINISTRY_ADMIN] ${room.name} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId: room.id + 1 };
}
