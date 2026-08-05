/* ── Borrowed Light — Void local-rule chamber ─────────────────── */

import {
  Cell,
  ContainerKind,
  DoorState,
  Feature,
  FloorLevel,
  RoomType,
  Tex,
  type Entity,
  type Item,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { registerVoidBorrowedLightChamber } from '../../systems/void_protocols';
import { carveCorridor, findClearArea, placeDoorAt, stampRoom } from '../shared';

function setVoidRoomTextures(world: World, rx: number, ry: number, rw: number, rh: number): void {
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

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addRuleContainer(
  world: World,
  roomId: number,
  x: number,
  y: number,
  name: string,
  inventory: Item[],
  tags: string[],
): number {
  const id = nextContainerId(world);
  const container: WorldContainer = {
    id,
    x: world.wrap(x),
    y: world.wrap(y),
    floor: FloorLevel.VOID,
    roomId,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind: ContainerKind.SECRET_STASH,
    name,
    inventory,
    capacitySlots: 3,
    access: 'public',
    discovered: true,
    tags,
  };
  world.addContainer(container);
  return id;
}

export function generateBorrowedLightRule(
  world: World,
  entities: Entity[],
  _nextId: { v: number },
  spawnX: number,
  spawnY: number,
): void {
  const sx = Math.floor(spawnX);
  const sy = Math.floor(spawnY);
  const rw = 11;
  const rh = 7;
  const pos = findClearArea(world, sx, sy, rw, rh, 18, 42);
  const rx = pos ? pos.x : world.wrap(sx - 22);
  const ry = pos ? pos.y : world.wrap(sy + 14);
  const room = stampRoom(world, world.rooms.length, RoomType.OFFICE, rx, ry, rw, rh, -1);
  room.name = 'Касса заемного света';
  room.wallTex = Tex.VOID_WALL;
  room.floorTex = Tex.F_VOID;
  setVoidRoomTextures(world, room.x, room.y, room.w, room.h);

  const doorY = world.wrap(room.y + (room.h >> 1));
  placeDoorAt(world, room.x - 1, doorY, room.id);
  carveCorridor(world, sx, sy, room.x - 2, doorY);
  const door = world.doors.get(world.idx(room.x - 1, doorY));
  if (door) {
    door.state = DoorState.OPEN;
    door.timer = 0;
  }

  for (let dx = 2; dx < room.w - 2; dx += 2) {
    world.features[world.idx(room.x + dx, room.y + 2)] = Feature.DESK;
  }
  world.features[world.idx(room.x + 1, room.y + 1)] = Feature.SCREEN;
  world.features[world.idx(room.x + room.w - 2, room.y + 1)] = Feature.APPARATUS;
  world.features[world.idx(room.x + 2, room.y + room.h - 2)] = Feature.LAMP;
  world.features[world.idx(room.x + room.w - 3, room.y + room.h - 2)] = Feature.LAMP;

  const acceptId = addRuleContainer(
    world,
    room.id,
    room.x + 3,
    room.y + (room.h >> 1),
    'Квитанция: потребить заемный свет',
    [{
      defId: 'note',
      count: 1,
      data: { text: 'ПРОТОКОЛ: забрать заемный свет. Сразу получите стабилизатор и две энергоячейки; двери комнаты закроются, здоровье дернет отдачей.' },
    }],
    ['void_rule', 'borrowed_light', 'consume'],
  );
  const rejectId = addRuleContainer(
    world,
    room.id,
    room.x + room.w - 4,
    room.y + (room.h >> 1),
    'Квитанция: оставить свет уликой',
    [{
      defId: 'note',
      count: 1,
      data: { text: 'ВЕЩДОК: лампа остается на месте. Награды нет, зато двери останутся открытыми и долг не появится.' },
    }],
    ['void_rule', 'borrowed_light', 'keep', 'evidence'],
  );

  const ci = world.idx(room.x + (room.w >> 1), room.y + (room.h >> 1));
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = Feature.APPARATUS;
  registerVoidBorrowedLightChamber(world, entities, room.id, acceptId, rejectId);
}
