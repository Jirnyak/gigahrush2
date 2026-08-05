/* Non-explicit adult figure-study gallery: procedural sprite POI. */

import {
  Cell, DoorState, Tex, Feature, RoomType,
  type Room, type Entity, EntityType,
} from '../../core/types';
import { World } from '../../core/world';
import { Spr } from '../../render/sprite_index';
import { genLog } from '../log';
import { registerZoneContent } from './zone_content';

const ROOM_W = 13;
const ROOM_H = 9;

function canStamp(world: World, rx: number, ry: number): boolean {
  for (let dy = -1; dy <= ROOM_H; dy++) {
    for (let dx = -1; dx <= ROOM_W; dx++) {
      if (world.aptMask[world.idx(rx + dx, ry + dy)]) return false;
    }
  }
  return true;
}

function findOrigin(world: World, zcx: number, zcy: number): { x: number; y: number } | null {
  const baseX = zcx - Math.floor(ROOM_W / 2);
  const baseY = zcy - Math.floor(ROOM_H / 2);
  for (let r = 0; r <= 24; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const rx = world.wrap(baseX + dx);
        const ry = world.wrap(baseY + dy);
        if (canStamp(world, rx, ry)) return { x: rx, y: ry };
      }
    }
  }
  return null;
}

function setWallPosterBand(world: World, rx: number, ry: number): void {
  for (let dx = 2; dx < ROOM_W - 2; dx += 4) {
    const north = world.idx(rx + dx, ry - 1);
    const south = world.idx(rx + dx, ry + ROOM_H);
    if (world.cells[north] === Cell.WALL) world.wallTex[north] = (Tex.PORTRAIT_BASE + dx) as Tex;
    if (world.cells[south] === Cell.WALL) world.wallTex[south] = (Tex.POSTER_BASE + 40 + dx) as Tex;
  }
}

function spawnStudySprite(entities: Entity[], nextId: { v: number }, x: number, y: number, sprite: number): void {
  entities.push({
    id: nextId.v++, type: EntityType.BILLBOARD,
    x: x + 0.5, y: y + 0.5,
    angle: 0, pitch: 0, alive: true, speed: 0,
    sprite, spriteScale: 0.88,
  });
}

function generateArtStudies(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zcx: number,
  zcy: number,
): { nextRoomId: number } {
  const origin = findOrigin(world, zcx, zcy);
  if (!origin) {
    console.warn('[ART_STUDIES] no clean place for gallery');
    return { nextRoomId };
  }
  const { x: rx, y: ry } = origin;

  for (let dy = -1; dy <= ROOM_H; dy++) {
    for (let dx = -1; dx <= ROOM_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.PANEL;
      world.floorTex[ci] = Tex.F_PARQUET;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
  }

  const roomId = nextRoomId++;
  const room: Room = {
    id: roomId,
    type: RoomType.COMMON,
    x: rx, y: ry, w: ROOM_W, h: ROOM_H,
    doors: [], sealed: false,
    name: 'Зал учебных этюдов',
    apartmentId: -1,
    wallTex: Tex.PANEL,
    floorTex: Tex.F_PARQUET,
  };
  world.rooms[roomId] = room;

  for (let dy = 0; dy < ROOM_H; dy++) {
    for (let dx = 0; dx < ROOM_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_PARQUET;
      world.roomMap[ci] = roomId;
    }
  }

  for (let dy = -1; dy <= ROOM_H; dy++) {
    for (let dx = -1; dx <= ROOM_W; dx++) {
      world.aptMask[world.idx(rx + dx, ry + dy)] = 1;
    }
  }

  const doorX = rx + Math.floor(ROOM_W / 2);
  const doorY = ry + ROOM_H;
  const doorI = world.idx(doorX, doorY);
  world.cells[doorI] = Cell.DOOR;
  world.doors.set(doorI, {
    idx: doorI,
    state: DoorState.CLOSED,
    roomA: roomId,
    roomB: -1,
    keyId: '',
    timer: 0,
  });
  room.doors.push(doorI);

  let cx = doorX;
  let cy = world.wrap(doorY + 1);
  for (let s = 0; s < 60; s++) {
    const ci = world.idx(cx, cy);
    if (world.cells[ci] === Cell.FLOOR && !world.aptMask[ci]) break;
    if (!world.aptMask[ci]) {
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_LINO;
      world.roomMap[ci] = -1;
    }
    cy = world.wrap(cy + 1);
  }

  world.features[world.idx(rx + 2, ry + 2)] = Feature.LAMP;
  world.features[world.idx(rx + ROOM_W - 3, ry + 2)] = Feature.LAMP;
  world.features[world.idx(rx + Math.floor(ROOM_W / 2), ry + ROOM_H - 3)] = Feature.LAMP;
  world.features[world.idx(rx + 2, ry + ROOM_H - 2)] = Feature.CHAIR;
  world.features[world.idx(rx + ROOM_W - 3, ry + ROOM_H - 2)] = Feature.CHAIR;
  world.features[world.idx(rx + Math.floor(ROOM_W / 2), ry + ROOM_H - 2)] = Feature.TABLE;

  setWallPosterBand(world, rx, ry);

  spawnStudySprite(entities, nextId, rx + 3, ry + 3, Spr.ART_NUDE_0);
  spawnStudySprite(entities, nextId, rx + ROOM_W - 4, ry + 3, Spr.ART_NUDE_1);
  spawnStudySprite(entities, nextId, rx + 4, ry + ROOM_H - 4, Spr.ART_NUDE_2);
  spawnStudySprite(entities, nextId, rx + ROOM_W - 5, ry + ROOM_H - 4, Spr.ART_NUDE_3);

  genLog(`[ART_STUDIES] gallery at (${rx}, ${ry}) room #${roomId}`);
  return { nextRoomId };
}

registerZoneContent(14, 'Зал учебных этюдов', generateArtStudies);
