/* ── Герметичный шов — Living tactical monster room ──────────── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal, Cell, EntityType, Feature, MonsterKind, RoomType, Tex,
  type Entity, type Room,
} from '../../core/types';
import { World } from '../../core/world';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { connectProtectedRoom, protectRoom } from '../shared';
import { genLog } from '../log';
import { registerZoneContent } from './zone_content';

const ROOM_W = 15;
const ROOM_H = 10;
export const HERMOSEAM_STATION_ZONE_HUD = 45;
export const HERMOSEAM_STATION_ZONE_ID = HERMOSEAM_STATION_ZONE_HUD - 1;
export const HERMOSEAM_STATION_ROOM_NAME = 'Комната герметичного шва';

function areaClear(world: World, rx: number, ry: number): boolean {
  for (let dy = -1; dy <= ROOM_H; dy++) {
    for (let dx = -1; dx <= ROOM_W; dx++) {
      if (world.aptMask[world.idx(rx + dx, ry + dy)]) return false;
    }
  }
  return true;
}

function findOrigin(world: World, zcx: number, zcy: number): { x: number; y: number } {
  const baseX = zcx - Math.floor(ROOM_W / 2);
  const baseY = zcy - Math.floor(ROOM_H / 2);
  for (let r = 0; r <= 96; r += 4) {
    for (let k = 0; k < 24; k++) {
      const a = ((k + 5) / 24) * Math.PI * 2;
      const x = world.wrap(baseX + Math.round(Math.cos(a) * r));
      const y = world.wrap(baseY + Math.round(Math.sin(a) * r));
      if (areaClear(world, x, y)) return { x, y };
    }
  }
  return { x: world.wrap(baseX), y: world.wrap(baseY) };
}

function carveRoom(world: World, roomId: number, rx: number, ry: number, zoneId: number): Room {
  for (let dy = -1; dy <= ROOM_H; dy++) {
    for (let dx = -1; dx <= ROOM_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci]) continue;
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.HERMO_WALL;
      world.floorTex[ci] = Tex.F_CONCRETE;
      world.roomMap[ci] = -1;
      if (zoneId >= 0) world.zoneMap[ci] = zoneId;
      world.features[ci] = Feature.NONE;
    }
  }

  const room: Room = {
    id: roomId,
    type: RoomType.PRODUCTION,
    x: world.wrap(rx), y: world.wrap(ry), w: ROOM_W, h: ROOM_H,
    doors: [],
    sealed: false,
    name: HERMOSEAM_STATION_ROOM_NAME,
    apartmentId: -1,
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_CONCRETE,
  };
  world.rooms[roomId] = room;

  for (let dy = 0; dy < ROOM_H; dy++) {
    for (let dx = 0; dx < ROOM_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci]) continue;
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_CONCRETE;
      world.roomMap[ci] = roomId;
      if (zoneId >= 0) world.zoneMap[ci] = zoneId;
    }
  }

  protectRoom(world, room.x, room.y, ROOM_W, ROOM_H, Tex.HERMO_WALL, Tex.F_CONCRETE);
  connectProtectedRoom(world, room.x, room.y, ROOM_W, ROOM_H);
  return room;
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = feature;
}

function addDrop(entities: Entity[], nextId: { v: number }, x: number, y: number, defId: string, count = 1): void {
  entities.push({
    id: nextId.v++, type: EntityType.ITEM_DROP,
    x: x + 0.5, y: y + 0.5,
    angle: 0, pitch: 0, alive: true, speed: 0, sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count }],
  });
}

function spawnMonster(world: World, entities: Entity[], nextId: { v: number }, kind: MonsterKind, x: number, y: number): void {
  const def = MONSTERS[kind];
  const ci = world.idx(x, y);
  const zid = world.zoneMap[ci];
  const zoneLevel = (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 2) : 2;
  const hp = scaleMonsterHp(def.hp, zoneLevel);
  const monster: Entity = {
    id: nextId.v++, type: EntityType.MONSTER,
    x: x + 0.5, y: y + 0.5,
    angle: Math.random() * Math.PI * 2, pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: monsterSpr(kind),
    hp, maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
  };
  entities.push(monster);
}

function generateHermoseamStation(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zcx: number,
  zcy: number,
): { nextRoomId: number } {
  const pos = findOrigin(world, zcx, zcy);
  const zoneId = world.zoneMap[world.idx(zcx, zcy)] >= 0
    ? world.zoneMap[world.idx(zcx, zcy)]
    : HERMOSEAM_STATION_ZONE_ID;
  const room = carveRoom(world, nextRoomId++, pos.x, pos.y, zoneId);
  const rx = room.x;
  const ry = room.y;
  const midY = ry + Math.floor(ROOM_H / 2);

  for (let dy = 2; dy < ROOM_H - 2; dy++) {
    const left = world.idx(rx + 3, ry + dy);
    const right = world.idx(rx + ROOM_W - 4, ry + dy);
    if (dy !== 4) {
      world.cells[left] = Cell.WALL;
      world.wallTex[left] = Tex.HERMO_WALL;
      world.roomMap[left] = -1;
    }
    if (dy !== 5) {
      world.cells[right] = Cell.WALL;
      world.wallTex[right] = Tex.HERMO_WALL;
      world.roomMap[right] = -1;
    }
  }

  for (const [x, y, feature] of [
    [rx + 1, ry + 1, Feature.LAMP],
    [rx + ROOM_W - 2, ry + 1, Feature.LAMP],
    [rx + 5, ry + 2, Feature.MACHINE],
    [rx + 7, ry + 2, Feature.APPARATUS],
    [rx + 7, midY, Feature.TABLE],
    [rx + 8, midY, Feature.CHAIR],
    [rx + 2, ry + ROOM_H - 2, Feature.SHELF],
    [rx + ROOM_W - 2, ry + ROOM_H - 2, Feature.SCREEN],
  ] as const) {
    setFeature(world, x, y, feature);
  }
  world.wallTex[world.idx(rx + Math.floor(ROOM_W / 2), ry - 1)] = Tex.SCREEN_BASE + 9;
  stampSurfaceSplat(world, rx + 3, midY, 0.5, 0.5, 4, 0.5, 35035, 82, 82, 82, false);
  stampSurfaceSplat(world, rx + ROOM_W - 4, midY, 0.5, 0.5, 4, 0.45, 35036, 140, 118, 54, false);

  addDrop(entities, nextId, rx + 5, ry + ROOM_H - 2, 'hermo_gasket');
  addDrop(entities, nextId, rx + 6, ry + ROOM_H - 2, 'sealant_tube');
  addDrop(entities, nextId, rx + ROOM_W - 3, ry + 2, 'fuse');
  addDrop(entities, nextId, rx + ROOM_W - 3, ry + 3, 'lamp_bulb');

  spawnMonster(world, entities, nextId, MonsterKind.SHOVNIK, rx + 2, midY);
  spawnMonster(world, entities, nextId, MonsterKind.LAMPOVY, rx + ROOM_W - 3, ry + 2);

  genLog(`[AG35] ${room.name} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId };
}

registerZoneContent(HERMOSEAM_STATION_ZONE_HUD, HERMOSEAM_STATION_ROOM_NAME, generateHermoseamStation);
