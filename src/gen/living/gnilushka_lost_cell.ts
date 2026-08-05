/* ── Гнилушка: lost neutral mutant cell ─────────────────────── */

import {
  AIGoal,
  Cell,
  ContainerKind,
  EntityType,
  Faction,
  Feature,
  FloorLevel,
  MonsterKind,
  RoomType,
  Tex,
  type Entity,
  type Room,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { connectProtectedRoom, findClearArea, protectRoom, stampRoom } from '../shared';
import { genLog } from '../log';
import { registerZoneContent } from './zone_content';

const ZONE_HUD = 6;
const ROOM_NAME = 'Потерянная ячейка Гнилушки';
const ROOM_W = 15;
const ROOM_H = 10;

function nextContainerId(world: World): number {
  let id = world.containers.reduce((mx, c) => Math.max(mx, c.id), 0) + 1;
  while (world.containerById.has(id)) id++;
  return id;
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
    tags: ['gnilushka_lost_cell', 'gnilushka', 'monster', 'noncombat', ...tags],
  });
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

function setFeature(world: World, room: Room, dx: number, dy: number, feature: Feature): void {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = feature;
}

function decorate(world: World, room: Room): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      world.light[ci] = Math.max(world.light[ci], 0.08);
      if ((dx === 1 || dx === room.w - 2) && dy > 1 && dy < room.h - 2) world.wallTex[ci] = Tex.ROTTEN;
    }
  }
  setFeature(world, room, 2, 2, Feature.BED);
  setFeature(world, room, 4, 2, Feature.CHAIR);
  setFeature(world, room, room.w - 4, 2, Feature.TABLE);
  setFeature(world, room, room.w - 3, room.h - 3, Feature.SHELF);
  setFeature(world, room, 3, room.h - 3, Feature.APPARATUS);
}

function spawnGnilushka(world: World, entities: Entity[], nextId: { v: number }, room: Room): void {
  const def = MONSTERS[MonsterKind.GNILUSHKA];
  const x = room.x + Math.floor(room.w / 2);
  const y = room.y + Math.floor(room.h / 2);
  const zoneLevel = world.zones[world.zoneMap[world.idx(x, y)]]?.level ?? 2;
  const hp = Math.round(scaleMonsterHp(def.hp, zoneLevel) * 0.92);
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.PI,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: monsterSpr(MonsterKind.GNILUSHKA),
    hp,
    maxHp: hp,
    name: 'Гнилушка без памяти',
    monsterKind: MonsterKind.GNILUSHKA,
    monsterStage: 0,
    attackCd: def.attackRate,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    faction: Faction.WILD,
    rpg: randomRPG(Math.max(1, zoneLevel)),
  });
}

export function generateGnilushkaLostCell(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zoneCx: number,
  zoneCy: number,
): { nextRoomId: number } {
  const pos = findClearArea(world, Math.floor(zoneCx), Math.floor(zoneCy), ROOM_W, ROOM_H, 24, 140);
  if (!pos) {
    genLog(`[GNILUSHKA] failed to place ${ROOM_NAME}`);
    return { nextRoomId };
  }

  const room = stampRoom(world, nextRoomId, RoomType.LIVING, pos.x, pos.y, ROOM_W, ROOM_H, -1);
  room.name = ROOM_NAME;
  room.wallTex = Tex.ROTTEN;
  room.floorTex = Tex.F_LINO;
  protectRoom(world, room.x, room.y, room.w, room.h, Tex.ROTTEN, Tex.F_LINO);
  connectProtectedRoom(world, room.x, room.y, room.w, room.h);
  decorate(world, room);

  addContainer(world, room, 2, room.h - 2, 'Старая сумка без имени', [
    { defId: 'bread', count: 1 },
    { defId: 'water', count: 1 },
    { defId: 'note', count: 1, data: 'Обрывок: "Не загонять. Помнит серый коридор и мягкую дверь".' },
  ], ['personal_items', 'help']);
  addContainer(world, room, room.w - 3, 2, 'Полевой футляр НИИ у порога', [
    { defId: 'nii_sample_container', count: 1 },
    { defId: 'bandage', count: 1 },
  ], ['science', 'handoff', 'counterplay']);
  addDrop(entities, nextId, room.x + room.w - 4, room.y + room.h - 2, 'filtered_water');
  spawnGnilushka(world, entities, nextId, room);
  world.bakeLights();

  genLog(`[GNILUSHKA] ${ROOM_NAME} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId: room.id + 1 };
}

registerZoneContent(ZONE_HUD, ROOM_NAME, generateGnilushkaLostCell);
