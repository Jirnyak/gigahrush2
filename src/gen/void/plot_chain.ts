/* ── Void main plot room — warning cell near entry ───────────── */

import {
  Cell, Feature,
  type Room, type Entity,
  EntityType,
} from '../../core/types';
import { World } from '../../core/world';
import { PLOT_ROOMS } from '../../data/plot_rooms';
import { stampRoom, protectRoom, connectProtectedRoom, findClearArea } from '../shared';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { Spr } from '../../render/sprite_index';

export function generateVoidPlotChain(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  spawnX: number,
  spawnY: number,
): void {
  const sx = Math.floor(spawnX);
  const sy = Math.floor(spawnY);
  const room = stampWarningRoom(world, sx, sy);
  decorateWarningRoom(world, room);
  spawnVoidWarning(world, room, entities, nextId);
  dropRoomItem(world, room, entities, nextId, room.w - 2, room.h - 2, [
    { defId: 'bottled_voice', count: 1 },
  ]);
}

function stampWarningRoom(world: World, sx: number, sy: number): Room {
  const spec = PLOT_ROOMS['void_warning_cell'];
  const pos = findClearArea(world, sx, sy, spec.w, spec.h, 10, 28);
  const x = pos ? pos.x : world.wrap(sx + 16);
  const y = pos ? pos.y : world.wrap(sy + 4);
  const room = stampRoom(world, world.rooms.length, spec.roomType, x, y, spec.w, spec.h, -1);
  room.name = spec.name;
  room.wallTex = spec.wallTex;
  room.floorTex = spec.floorTex;
  protectRoom(world, room.x, room.y, room.w, room.h, spec.wallTex, spec.floorTex);
  connectProtectedRoom(world, room.x, room.y, room.w, room.h);
  return room;
}

function decorateWarningRoom(world: World, room: Room): void {
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  world.features[world.idx(cx, cy)] = Feature.APPARATUS;
  world.features[world.idx(room.x + 1, room.y + 1)] = Feature.SCREEN;
  world.features[world.idx(room.x + room.w - 2, room.y + 1)] = Feature.LAMP;
  world.features[world.idx(room.x + 1, room.y + room.h - 2)] = Feature.SHELF;
}

function spawnVoidWarning(
  world: World,
  room: Room,
  entities: Entity[],
  nextId: { v: number },
): void {
  const x = world.wrap(room.x + Math.floor(room.w / 2));
  const y = world.wrap(room.y + Math.floor(room.h / 2) + 1);
  requireSpawnedPlotNpcFromPackage(entities, nextId, 'void_warning', x + 0.5, y + 0.5);
}

function dropRoomItem(
  world: World,
  room: Room,
  entities: Entity[],
  nextId: { v: number },
  ox: number,
  oy: number,
  inventory: { defId: string; count: number }[],
): void {
  const x = world.wrap(room.x + ox);
  const y = world.wrap(room.y + oy);
  if (world.cells[world.idx(x, y)] !== Cell.FLOOR) return;
  entities.push({
    id: nextId.v++, type: EntityType.ITEM_DROP,
    x: x + 0.5, y: y + 0.5,
    angle: 0, pitch: 0, alive: true, speed: 0, sprite: Spr.ITEM_DROP,
    inventory,
  });
}
