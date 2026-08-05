/* ── AG113 carnivorous fungus room: avoid, salt, burn, feed ───── */

import {
  Cell,
  ContainerKind,
  Feature,
  FloorLevel,
  RoomType,
  Tex,
  type Entity,
  type Room,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { decorateCarnivorousFungusRoom } from '../carnivorous_fungus_room';
import { connectProtectedRoom, protectRoom } from '../shared';
import { genLog } from '../log';
import { registerZoneContent } from './zone_content';

const FUNGUS_ZONE = 61;
const ROOM_W = 17;
const ROOM_H = 13;

function areaClear(world: World, rx: number, ry: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      if (world.aptMask[world.idx(rx + dx, ry + dy)]) return false;
    }
  }
  return true;
}

function findOrigin(world: World, zcx: number, zcy: number): { x: number; y: number } {
  const baseX = zcx - Math.floor(ROOM_W / 2);
  const baseY = zcy - Math.floor(ROOM_H / 2);
  for (let r = 0; r <= 76; r += 4) {
    for (let k = 0; k < 24; k++) {
      const a = ((k + 11) / 24) * Math.PI * 2;
      const x = world.wrap(baseX + Math.round(Math.cos(a) * r));
      const y = world.wrap(baseY + Math.round(Math.sin(a) * r));
      if (areaClear(world, x, y, ROOM_W, ROOM_H)) return { x, y };
    }
  }
  return { x: world.wrap(baseX), y: world.wrap(baseY) };
}

function carveFungusRoom(world: World, roomId: number, rx: number, ry: number): Room {
  for (let dy = -1; dy <= ROOM_H; dy++) {
    for (let dx = -1; dx <= ROOM_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci]) continue;
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.ROTTEN;
      world.floorTex[ci] = Tex.F_TILE;
      world.roomMap[ci] = -1;
    }
  }

  const room: Room = {
    id: roomId,
    type: RoomType.STORAGE,
    x: rx,
    y: ry,
    w: ROOM_W,
    h: ROOM_H,
    doors: [],
    sealed: false,
    name: 'Плотоядная грибница: костяная сушилка',
    apartmentId: -1,
    wallTex: Tex.ROTTEN,
    floorTex: Tex.F_TILE,
  };
  world.rooms[roomId] = room;

  for (let dy = 0; dy < ROOM_H; dy++) {
    for (let dx = 0; dx < ROOM_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci]) continue;
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_TILE;
      world.roomMap[ci] = roomId;
    }
  }

  protectRoom(world, rx, ry, ROOM_W, ROOM_H, Tex.ROTTEN, Tex.F_TILE);
  connectProtectedRoom(world, rx, ry, ROOM_W, ROOM_H);
  return room;
}

function nextContainerId(world: World): number {
  let id = world.containers.reduce((mx, c) => Math.max(mx, c.id), 0) + 1;
  while (world.containerById.has(id)) id++;
  return id;
}

function addFungusContainer(
  world: World,
  room: Room,
  dx: number,
  dy: number,
  name: string,
  inventory: WorldContainer['inventory'],
): void {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) return;
  world.features[ci] = Feature.SHELF;
  world.addContainer({
    id: nextContainerId(world),
    x,
    y,
    floor: FloorLevel.LIVING,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind: ContainerKind.SECRET_STASH,
    name,
    inventory: inventory.map(item => ({ ...item })),
    capacitySlots: Math.max(6, inventory.length + 3),
    access: 'secret',
    discovered: true,
    tags: ['ag113_carnivorous_fungus', 'living_fungal_loop', 'carnivorous_fungus', 'zhelemish', 'salt', 'fire', 'medicine', 'harvest'],
  });
}

function seedFungusRouteCache(world: World, room: Room): void {
  addFungusContainer(
    world,
    room,
    2,
    ROOM_H - 4,
    'Сухой ящик костяной сушилки',
    [
      { defId: 'zhelemish_dried', count: 1 },
      { defId: 'mushroom_mass', count: 1 },
      { defId: 'antifungal_ointment', count: 1 },
    ],
  );
}

function generateCarnivorousFungusRoom(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zcx: number,
  zcy: number,
): { nextRoomId: number } {
  const pos = findOrigin(world, zcx, zcy);
  const room = carveFungusRoom(world, nextRoomId++, pos.x, pos.y);
  decorateCarnivorousFungusRoom(world, entities, nextId, room, {
    seed: 113,
    withCounterplayDrops: true,
    withGuardMonster: true,
  });
  seedFungusRouteCache(world, room);
  genLog(`[AG113] Плотоядная грибница at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId };
}

registerZoneContent(FUNGUS_ZONE, 'Плотоядная грибница: костяная сушилка', generateCarnivorousFungusRoom);
