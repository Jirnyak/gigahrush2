/* ── Protocol chamber P-46 — local VOID afterprotocol POI ─────── */

import {
  DoorState, Feature, MonsterKind, RoomType, Tex,
  EntityType, AIGoal,
  type Entity,
} from '../../core/types';
import { World } from '../../core/world';
import { VOID_PROTOCOLS } from '../../data/void_protocols';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { carveCorridor, placeDoorAt, stampRoom } from '../shared';

function setRoomTextures(world: World, rx: number, ry: number, rw: number, rh: number): void {
  for (let dy = -1; dy <= rh; dy++) {
    for (let dx = -1; dx <= rw; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (dx >= 0 && dx < rw && dy >= 0 && dy < rh) {
        world.floorTex[ci] = Tex.F_VOID;
      } else {
        world.wallTex[ci] = Tex.VOID_WALL;
      }
    }
  }
}

function spawnMonster(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  kind: MonsterKind,
  name: string,
  x: number,
  y: number,
): void {
  const def = MONSTERS[kind];
  const zid = world.zoneMap[world.idx(x, y)];
  const level = Math.max(14, world.zones[zid]?.level ?? 14);
  const hp = Math.round(scaleMonsterHp(def.hp, level));
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, level),
    sprite: monsterSpr(kind),
    name,
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
    phasing: kind === MonsterKind.SPIRIT,
  });
}

function dropProtocolNote(entities: Entity[], nextId: { v: number }, x: number, y: number): void {
  const protocolNames = VOID_PROTOCOLS.slice(0, 3).map(def => def.name).join(' / ');
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
    inventory: [{
      defId: 'note',
      count: 1,
      data: { text: `П-46: ${protocolNames}. Применять рядом с целью; не читать у двери, пока не решили платить.` },
    }],
  });
}

export function generateProtocolChamber(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  spawnX: number,
  spawnY: number,
): void {
  const sx = Math.floor(spawnX);
  const sy = Math.floor(spawnY);
  const rw = 13;
  const rh = 9;
  const rx = world.wrap(sx + 28);
  const ry = world.wrap(sy - 4);
  const roomId = world.rooms.length;
  const room = stampRoom(world, roomId, RoomType.OFFICE, rx, ry, rw, rh, -1);
  room.name = 'Протокольная П-46';
  room.wallTex = Tex.VOID_WALL;
  room.floorTex = Tex.F_VOID;
  setRoomTextures(world, rx, ry, rw, rh);

  const doorY = world.wrap(ry + (rh >> 1));
  placeDoorAt(world, rx - 1, doorY, room.id);
  carveCorridor(world, sx, sy, rx - 2, doorY);

  const doorI = world.idx(rx - 1, doorY);
  const door = world.doors.get(doorI);
  if (door) {
    door.state = DoorState.HERMETIC_OPEN;
    door.timer = 0;
  }

  for (let dx = 2; dx < rw - 2; dx += 2) {
    world.features[world.idx(rx + dx, ry + 2)] = Feature.DESK;
  }
  for (let dx = 3; dx < rw - 3; dx += 3) {
    world.features[world.idx(rx + dx, ry + rh - 3)] = Feature.APPARATUS;
  }
  world.features[world.idx(rx + 2, ry + rh - 2)] = Feature.LAMP;
  world.features[world.idx(rx + rw - 3, ry + 1)] = Feature.LAMP;
  world.features[world.idx(rx + rw - 2, ry + (rh >> 1))] = Feature.SCREEN;

  dropProtocolNote(entities, nextId, rx + (rw >> 1), ry + (rh >> 1));
  spawnMonster(world, entities, nextId, MonsterKind.SPIRIT, 'Счетчик пошлины', rx + 3, ry + 5);
  spawnMonster(world, entities, nextId, MonsterKind.PARAGRAPH, 'Параграф П-46', rx + 9, ry + 4);
  spawnMonster(world, entities, nextId, MonsterKind.NELYUD, 'Жилец без памяти', rx + 6, ry + 2);
}
