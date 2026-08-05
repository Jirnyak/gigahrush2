/* ── Spore carpet cache: domestic rug trap with visible loot ─── */

import {
  AIGoal,
  Cell,
  ContainerKind,
  EntityType,
  FloorLevel,
  Feature,
  MonsterKind,
  RoomType,
  Tex,
  type Entity,
  type Room,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import { MarkType, stampMark } from '../../systems/surface_marks';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { connectProtectedRoom, findClearArea, protectRoom, stampRoom } from '../shared';
import { genLog } from '../log';
import { registerZoneContent } from './zone_content';

export const SPORE_CARPET_CACHE_ZONE_HUD = 36;
export const SPORE_CARPET_CACHE_ROOM_NAME = 'Кладовая висячего ковра';

const ROOM_W = 17;
const ROOM_H = 9;

function nextContainerId(world: World): number {
  let id = world.containers.reduce((mx, c) => Math.max(mx, c.id), 0) + 1;
  while (world.containerById.has(id)) id++;
  return id;
}

function setFeature(world: World, room: Room, dx: number, dy: number, feature: Feature): void {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = feature;
}

function addContainer(
  world: World,
  room: Room,
  dx: number,
  dy: number,
  name: string,
  inventory: WorldContainer['inventory'],
  tags: string[],
): void {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
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
    access: 'public',
    discovered: true,
    tags: ['spore_carpet_cache', 'spore_carpet', 'monster', 'counterplay', ...tags],
  });
}

function stampMoldWarning(world: World, room: Room): void {
  const thresholdX = room.x + 1;
  const thresholdY = room.y + Math.floor(room.h / 2);
  for (let i = 0; i < 11; i++) {
    const x = world.wrap(thresholdX + (i % 4));
    const y = world.wrap(thresholdY - 2 + Math.floor(i / 2));
    if (world.cells[world.idx(x, y)] !== Cell.FLOOR) continue;
    stampMark(world, x, y, 0.5, 0.5, 0.18 + (i % 3) * 0.04, MarkType.SPLAT, 90_900 + room.id * 31 + i, 84, 128, 52, 118);
  }
  stampMark(world, room.x + room.w - 5, room.y + 2, 0.5, 0.5, 0.5, MarkType.SPLAT, 91_700 + room.id, 42, 80, 38, 130);
}

function decorate(world: World, room: Room): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      world.light[ci] = Math.max(world.light[ci], 0.1);
      world.floorTex[ci] = Tex.F_CARPET;
      if (dx === 0 || dy === 0 || dx === room.w - 1 || dy === room.h - 1) world.wallTex[ci] = Tex.ROTTEN;
    }
  }
  setFeature(world, room, 2, 1, Feature.TABLE);
  setFeature(world, room, 3, room.h - 2, Feature.CHAIR);
  setFeature(world, room, room.w - 3, room.h - 3, Feature.SHELF);
  setFeature(world, room, room.w - 6, 2, Feature.BED);
  stampMoldWarning(world, room);
}

function spawnSporeCarpet(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  room: Room,
  dx: number,
  dy: number,
  name: string,
): void {
  const def = MONSTERS[MonsterKind.SPORE_CARPET];
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
  const zoneLevel = world.zones[world.zoneMap[ci]]?.level ?? 2;
  const hp = Math.round(scaleMonsterHp(def.hp, zoneLevel) * 0.95);
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.PI,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: monsterSpr(MonsterKind.SPORE_CARPET),
    hp,
    maxHp: hp,
    name,
    monsterKind: MonsterKind.SPORE_CARPET,
    monsterStage: 0,
    attackCd: def.attackRate,
    ai: { goal: AIGoal.IDLE, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0, sporePuffCd: 5.8 },
    rpg: randomRPG(Math.max(1, zoneLevel)),
  });
}

export function generateSporeCarpetCache(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zoneCx: number,
  zoneCy: number,
): { nextRoomId: number } {
  const pos = findClearArea(world, Math.floor(zoneCx), Math.floor(zoneCy), ROOM_W, ROOM_H, 22, 130);
  if (!pos) {
    genLog(`[SPORE_CARPET] failed to place ${SPORE_CARPET_CACHE_ROOM_NAME}`);
    return { nextRoomId };
  }

  const room = stampRoom(world, nextRoomId, RoomType.STORAGE, pos.x, pos.y, ROOM_W, ROOM_H, -1);
  room.name = SPORE_CARPET_CACHE_ROOM_NAME;
  room.wallTex = Tex.ROTTEN;
  room.floorTex = Tex.F_CARPET;
  protectRoom(world, room.x, room.y, room.w, room.h, Tex.ROTTEN, Tex.F_CARPET);
  connectProtectedRoom(world, room.x, room.y, room.w, room.h);
  decorate(world, room);

  addContainer(world, room, room.w - 3, 1, 'Ящик под висячим ковром', [
    { defId: 'spore_print', count: 1 },
    { defId: 'filter_layer', count: 1 },
    { defId: 'water', count: 1 },
  ], ['loot', 'spores']);
  addContainer(world, room, 2, room.h - 2, 'Сухая миска с солью', [
    { defId: 'rock_salt', count: 2 },
    { defId: 'gasmask_filter', count: 1 },
  ], ['salt', 'filter']);

  spawnSporeCarpet(world, entities, nextId, room, 2, Math.floor(room.h / 2), 'Ковер у порога');
  spawnSporeCarpet(world, entities, nextId, room, room.w - 5, 2, 'Ковер под ящиком');
  world.bakeLights();

  genLog(`[SPORE_CARPET] ${SPORE_CARPET_CACHE_ROOM_NAME} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId: room.id + 1 };
}

registerZoneContent(SPORE_CARPET_CACHE_ZONE_HUD, SPORE_CARPET_CACHE_ROOM_NAME, generateSporeCarpetCache);
