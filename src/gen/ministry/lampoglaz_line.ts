/* ── Ламповая линия учета — Ministry light-lock encounter ────── */

import { Feature, MonsterKind, RoomType, Tex, type Entity } from '../../core/types';
import { World } from '../../core/world';
import {
  type NextId, addItemDrop, createAdminRoom, setFeature, spawnAdminMonster,
} from '../admin_common';
import { genLog } from '../log';

export function generateLampoglazLine(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: NextId,
  spawnX: number,
  spawnY: number,
): { nextRoomId: number } {
  const room = createAdminRoom(world, nextRoomId, spawnX, spawnY, {
    type: RoomType.CORRIDOR,
    name: 'Ламповая линия учета',
    w: 25,
    h: 7,
    minDist: 80,
    maxDist: 220,
    wallTex: Tex.MARBLE,
    floorTex: Tex.F_RED_CARPET,
  });
  if (!room) return { nextRoomId };

  const rx = room.x;
  const ry = room.y;
  const cy = ry + Math.floor(room.h / 2);
  for (let dx = 2; dx < room.w - 2; dx += 4) setFeature(world, rx + dx, ry + 1, Feature.LAMP);
  for (let dx = 5; dx < room.w - 4; dx += 6) {
    setFeature(world, rx + dx, cy - 1, Feature.SHELF);
    setFeature(world, rx + dx + 1, cy + 1, Feature.DESK);
  }
  setFeature(world, rx + room.w - 2, ry + 1, Feature.SCREEN);
  world.wallTex[world.idx(rx + Math.floor(room.w / 2), ry - 1)] = Tex.SCREEN_BASE + 11;

  addItemDrop(entities, nextId, rx + 2, ry + room.h - 2, 'fuse', 1);
  addItemDrop(entities, nextId, rx + room.w - 3, ry + 2, 'lamp_bulb', 1);
  spawnAdminMonster(world, entities, nextId, rx + room.w - 4, cy, MonsterKind.LAMPOGLAZ);
  spawnAdminMonster(world, entities, nextId, rx + room.w - 9, cy - 1, MonsterKind.LAMPOGLAZ);

  genLog(`[MINISTRY_LAMPOGLAZ] ${room.name} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId: room.id + 1 };
}
