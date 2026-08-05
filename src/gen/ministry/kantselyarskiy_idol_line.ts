/* ── Канцелярская линия — office-field Idol encounter ────────── */

import {
  ContainerKind,
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
import {
  type NextId, addItemDrop, createAdminRoom, setFeature, spawnAdminMonster,
} from '../admin_common';
import { genLog } from '../log';

function nextContainerId(world: World): number {
  let id = world.containers.reduce((mx, c) => Math.max(mx, c.id), 0) + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addPaperCabinet(
  world: World,
  room: Room,
  x: number,
  y: number,
  name: string,
  inventory: WorldContainer['inventory'],
): void {
  const wx = world.wrap(x);
  const wy = world.wrap(y);
  world.addContainer({
    id: nextContainerId(world),
    x: wx,
    y: wy,
    floor: FloorLevel.MINISTRY,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(wx, wy)],
    kind: ContainerKind.FILING_CABINET,
    name,
    inventory,
    capacitySlots: 8,
    access: 'public',
    discovered: true,
    tags: ['kantselyarskiy_idol', 'office_field', 'paper_drop', 'cover'],
  });
  setFeature(world, wx, wy, Feature.SHELF);
}

export function generateKantselyarskiyIdolLine(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: NextId,
  spawnX: number,
  spawnY: number,
): { nextRoomId: number } {
  const room = createAdminRoom(world, nextRoomId, spawnX, spawnY, {
    type: RoomType.OFFICE,
    name: 'Канцелярская линия',
    w: 28,
    h: 13,
    minDist: 120,
    maxDist: 280,
    wallTex: Tex.MARBLE,
    floorTex: Tex.F_PARQUET,
  });
  if (!room) return { nextRoomId };

  const rx = room.x;
  const ry = room.y;
  const cy = ry + Math.floor(room.h / 2);

  for (let dx = 3; dx < room.w - 5; dx += 4) {
    setFeature(world, rx + dx, cy - 3, Feature.DESK);
    setFeature(world, rx + dx + 1, cy + 3, Feature.DESK);
  }
  for (let dx = 6; dx < room.w - 6; dx += 6) {
    setFeature(world, rx + dx, cy - 1, Feature.CHAIR);
    setFeature(world, rx + dx, cy + 1, Feature.CHAIR);
  }

  addPaperCabinet(world, room, rx + 6, cy - 2, 'Картотека для сброса лишних бланков', [
    { defId: 'blank_form', count: 1 },
  ]);
  addPaperCabinet(world, room, rx + 13, cy + 2, 'Шкаф встречных заявлений', []);
  addPaperCabinet(world, room, rx + 20, cy - 2, 'Архивный шкаф линии', [
    { defId: 'note', count: 1, data: { text: 'Укрытие считается действительным, если между гражданином и столом стоит шкаф.' } },
  ]);

  for (let y = cy - 2; y <= cy + 2; y++) setFeature(world, rx + room.w - 4, y, Feature.DESK);
  setFeature(world, rx + room.w - 5, cy - 1, Feature.TABLE);
  setFeature(world, rx + room.w - 5, cy + 1, Feature.TABLE);

  addItemDrop(entities, nextId, rx + 3, cy, 'blank_form', 1);
  addItemDrop(entities, nextId, rx + room.w - 6, cy + 3, 'seal_wax', 1);
  spawnAdminMonster(world, entities, nextId, rx + room.w - 5, cy, MonsterKind.KANTSELYARSKIY_IDOL);

  genLog(`[MINISTRY_KANTSELYARSKIY_IDOL] ${room.name} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId: room.id + 1 };
}
