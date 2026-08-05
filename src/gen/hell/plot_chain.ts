/* ── Hell main plot rooms — contact + Herald threshold ───────── */

import {
  W, Cell, Feature, FloorLevel,
  type Room, type Entity, type Item,
  EntityType,
} from '../../core/types';
import { World } from '../../core/world';
import { PLOT_ROOMS } from '../../data/plot_rooms';
import { registerRouteCue } from '../../systems/route_cues';
import { stampRoom, protectRoom, connectProtectedRoom, findClearArea } from '../shared';
import { Spr } from '../../render/sprite_index';

export function generateHellPlotChain(
  world: World, entities: Entity[], nextId: { v: number },
): void {
  const sx = W >> 1;
  const sy = W >> 1;

  const anchorRoom = stampPlotRoom(world, 'hell_anchor_zone', sx, sy, 24, 90, 36);
  decorateAnchorRoom(world, anchorRoom);
  registerAnchorCue(world, anchorRoom);
  dropRoomItem(world, anchorRoom, entities, nextId, anchorRoom.w - 2, anchorRoom.h - 2, [
    { defId: 'bandage', count: 2 },
    { defId: 'water', count: 1 },
    { defId: 'ammo_762', count: 12 },
  ]);
  dropRoomNote(world, anchorRoom, entities, nextId, 1, anchorRoom.h - 2,
    'Зона закрепления: пять минут держать центр, не отходить за створки, лифт слушать после отбоя.');
}

function registerAnchorCue(world: World, anchorRoom: Room): void {
  const x = world.wrap(anchorRoom.x + Math.floor(anchorRoom.w / 2)) + 0.5;
  const y = world.wrap(anchorRoom.y + Math.floor(anchorRoom.h / 2)) + 0.5;
  registerRouteCue(world, {
    id: 'hell_anchor_zone_holdout',
    x,
    y,
    targetX: x,
    targetY: y,
    floor: FloorLevel.HELL,
    roomId: anchorRoom.id,
    targetRoomId: anchorRoom.id,
    label: 'зона закрепления',
    hint: 'держи центр до прихода ликвидаторов; выход за створки сбросит удержание',
    targetName: 'Зона закрепления',
    color: '#f66',
    tags: ['hell', 'holdout', 'liquidator', 'anchor'],
    toneSeed: anchorRoom.id * 7301 + 47,
    radius: 12,
    targetRadius: 7,
    cooldownSec: 45,
    heardText: 'Металлическая створка отмечает место для закрепления: держи центр и не уходи за порог.',
    followedText: 'Зона закрепления отмечена. Пять минут давления, потом лифт приведет своих.',
    ignoredText: 'Зона закрепления осталась позади. Таймер не держит пустое место.',
  });
}

function stampPlotRoom(
  world: World,
  roomId: 'hell_anchor_zone',
  ax: number,
  ay: number,
  minDist: number,
  maxDist: number,
  fallbackShift: number,
): Room {
  const spec = PLOT_ROOMS[roomId];
  const pos = findClearArea(world, ax, ay, spec.w, spec.h, minDist, maxDist);
  const x = pos ? pos.x : world.wrap(ax + fallbackShift);
  const y = pos ? pos.y : world.wrap(ay + fallbackShift);
  const room = stampRoom(world, world.rooms.length, spec.roomType, x, y, spec.w, spec.h, -1);
  room.name = spec.name;
  room.wallTex = spec.wallTex;
  room.floorTex = spec.floorTex;
  protectRoom(world, room.x, room.y, room.w, room.h, spec.wallTex, spec.floorTex);
  connectProtectedRoom(world, room.x, room.y, room.w, room.h);
  return room;
}

function decorateAnchorRoom(world: World, room: Room): void {
  world.features[world.idx(room.x + 1, room.y + 1)] = Feature.CANDLE;
  world.features[world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2))] = Feature.LAMP;
  world.features[world.idx(room.x + room.w - 2, room.y + 1)] = Feature.SHELF;
  world.features[world.idx(room.x + Math.floor(room.w / 2), room.y + room.h - 2)] = Feature.APPARATUS;
}

function dropRoomItem(
  world: World,
  room: Room,
  entities: Entity[],
  nextId: { v: number },
  ox: number,
  oy: number,
  inventory: Item[],
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

function dropRoomNote(
  world: World,
  room: Room,
  entities: Entity[],
  nextId: { v: number },
  ox: number,
  oy: number,
  text: string,
): void {
  dropRoomItem(world, room, entities, nextId, ox, oy, [{ defId: 'note', count: 1, data: { text } }]);
}
