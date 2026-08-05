/* ── Ламповая линия: living light-lock turret encounter ─────── */

import {
  AIGoal, Cell, EntityType, Feature, MonsterKind, RoomType, Tex,
  type Entity, type Room,
} from '../../core/types';
import { World } from '../../core/world';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { connectProtectedRoom, findClearArea, protectRoom, stampRoom } from '../shared';
import { genLog } from '../log';
import { registerZoneContent } from './zone_content';

const ZONE_HUD = 5;
const ROOM_NAME = 'Ламповая линия: желтый коридор';
const ROOM_W = 29;
const ROOM_H = 7;

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = feature;
}

function addDrop(entities: Entity[], nextId: { v: number }, x: number, y: number, defId: string, count = 1): void {
  entities.push({
    id: nextId.v++,
    type: EntityType.ITEM_DROP,
    x: x + 0.5,
    y: y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count }],
  });
}

function spawnLampoglaz(world: World, entities: Entity[], nextId: { v: number }, x: number, y: number, name: string): void {
  const def = MONSTERS[MonsterKind.LAMPOGLAZ];
  const ci = world.idx(x, y);
  const zoneLevel = world.zones[world.zoneMap[ci]]?.level ?? 2;
  const hp = Math.round(scaleMonsterHp(def.hp, zoneLevel) * 1.05);
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.PI,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: monsterSpr(MonsterKind.LAMPOGLAZ),
    hp,
    maxHp: hp,
    name,
    monsterKind: MonsterKind.LAMPOGLAZ,
    attackCd: def.attackRate,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
  });
}

function decorateLine(world: World, room: Room): void {
  const cy = room.y + Math.floor(room.h / 2);
  for (let dx = 2; dx < room.w - 2; dx += 4) {
    setFeature(world, room.x + dx, room.y + 1, Feature.LAMP);
  }
  for (let dx = 5; dx < room.w - 4; dx += 7) {
    setFeature(world, room.x + dx, cy - 1, Feature.SHELF);
    setFeature(world, room.x + dx + 1, cy + 1, Feature.TABLE);
  }
  setFeature(world, room.x + 2, room.y + room.h - 2, Feature.SHELF);
  setFeature(world, room.x + room.w - 3, room.y + room.h - 2, Feature.SCREEN);
}

export function generateLampoglazCorridor(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zoneCx: number,
  zoneCy: number,
): { nextRoomId: number } {
  const pos = findClearArea(world, Math.floor(zoneCx), Math.floor(zoneCy), ROOM_W, ROOM_H, 10, 95);
  if (!pos) {
    genLog(`[LIVING_LAMPOGLAZ] failed to place ${ROOM_NAME}`);
    return { nextRoomId };
  }

  const room = stampRoom(world, nextRoomId, RoomType.CORRIDOR, pos.x, pos.y, ROOM_W, ROOM_H, -1);
  room.name = ROOM_NAME;
  room.wallTex = Tex.PANEL;
  room.floorTex = Tex.F_LINO;
  protectRoom(world, room.x, room.y, room.w, room.h, Tex.PANEL, Tex.F_LINO);
  connectProtectedRoom(world, room.x, room.y, room.w, room.h);
  decorateLine(world, room);

  const cy = room.y + Math.floor(room.h / 2);
  spawnLampoglaz(world, entities, nextId, room.x + room.w - 4, cy, 'Лампоглаз жилой линии');
  if ((room.x + room.y) % 2 === 0) spawnLampoglaz(world, entities, nextId, room.x + room.w - 9, cy - 1, 'Лампоглаз запасного плафона');

  addDrop(entities, nextId, room.x + 2, room.y + room.h - 2, 'fuse', 1);
  addDrop(entities, nextId, room.x + room.w - 3, room.y + 1, 'lamp_bulb', 1);
  world.bakeLights();

  genLog(`[LIVING_LAMPOGLAZ] ${room.name} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId: room.id + 1 };
}

registerZoneContent(ZONE_HUD, ROOM_NAME, generateLampoglazCorridor);
