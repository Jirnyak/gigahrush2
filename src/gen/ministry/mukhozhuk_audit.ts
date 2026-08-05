/* -- Кабинет больного приказа: exposed Mukhozhuk authority host -- */

import {
  ContainerKind,
  Faction,
  Feature,
  FloorLevel,
  MonsterKind,
  Occupation,
  RoomType,
  Tex,
  type Entity,
  type Room,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerAuthoredNpc, storyNpcFloorKey } from '../../data/plot';
import {
  type NextId, addItemDrop, createAdminRoom, setFeature, spawnAdminMonster, spawnAdminNpc,
} from '../admin_common';
import { genLog } from '../log';

const HOME_FLOOR_KEY = storyNpcFloorKey(FloorLevel.MINISTRY);
const PLATON_ID = 'mukhozhuk_witness_platon';
const QUARANTINE_SECRETARY_ID = 'mukhozhuk_quarantine_secretary';

const PLATON_DEF: PlotNpcDef = {
  name: 'Ликвидатор-свидетель Платон',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 70, maxHp: 70, money: 15, speed: 0.8,
  weapon: 'makarov',
  inventory: [{ defId: 'liquidator_ration', count: 1 }],
  talkLines: [
    'Я свидетель. Видел достаточно, чтобы не есть из чужого приказа.',
    'Мухожук в документах проходит как санитарная ошибка. Ошибка вооружена голодом.',
  ],
  talkLinesPost: [
    'Показания даны. Теперь бы выжить до подписи.',
  ],
};

const QUARANTINE_SECRETARY_DEF: PlotNpcDef = {
  name: 'Секретарь карантинной ревизии',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 70, maxHp: 70, money: 15, speed: 0.8,
  inventory: [{ defId: 'clean_health_cert', count: 1 }],
  talkLines: [
    'Справка чистая, кабинет нет.',
    'Если приказ закашлялся, ставьте подпись на расстоянии.',
  ],
  talkLinesPost: [
    'Ревизия пережила строку. Редкость.',
  ],
};

registerAuthoredNpc({
  id: PLATON_ID,
  npc: PLATON_DEF,
  homeFloorKey: HOME_FLOOR_KEY,
  tags: ['ministry', 'mukhozhuk_audit', 'liquidator', 'witness'],
});

registerAuthoredNpc({
  id: QUARANTINE_SECRETARY_ID,
  npc: QUARANTINE_SECRETARY_DEF,
  homeFloorKey: HOME_FLOOR_KEY,
  tags: ['ministry', 'mukhozhuk_audit', 'secretary', 'quarantine'],
});

function nextContainerId(world: World): number {
  let id = world.containers.reduce((mx, c) => Math.max(mx, c.id), 0) + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addFoodAuditCabinet(
  world: World,
  room: Room,
  x: number,
  y: number,
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
    kind: ContainerKind.FRIDGE,
    name: 'Запас больного приказа',
    inventory,
    capacitySlots: 8,
    faction: Faction.LIQUIDATOR,
    access: 'faction',
    discovered: true,
    tags: ['mukhozhuk', 'food', 'audit', 'quarantine'],
  });
  setFeature(world, wx, wy, Feature.SHELF);
}

export function generateMukhozhukAudit(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: NextId,
  spawnX: number,
  spawnY: number,
): { nextRoomId: number } {
  const room = createAdminRoom(world, nextRoomId, spawnX, spawnY, {
    type: RoomType.HQ,
    name: 'Кабинет больного приказа',
    w: 22,
    h: 13,
    minDist: 120,
    maxDist: 300,
    wallTex: Tex.MARBLE,
    floorTex: Tex.F_RED_CARPET,
  });
  if (!room) return { nextRoomId };

  const rx = room.x;
  const ry = room.y;
  const cx = rx + Math.floor(room.w / 2);
  const cy = ry + Math.floor(room.h / 2);

  for (let dx = 3; dx < room.w - 3; dx += 4) {
    setFeature(world, rx + dx, cy - 3, Feature.DESK);
    setFeature(world, rx + dx + 1, cy + 3, Feature.CHAIR);
  }
  for (let y = cy - 2; y <= cy + 2; y++) setFeature(world, rx + room.w - 4, y, Feature.DESK);
  setFeature(world, rx + room.w - 3, cy, Feature.SCREEN);

  addFoodAuditCabinet(world, room, rx + 3, cy - 1, [
    { defId: 'liquidator_ration', count: 2 },
    { defId: 'canned', count: 2 },
    { defId: 'alcohol_bottle', count: 1 },
    { defId: 'quarantine_medcard', count: 1 },
  ]);
  addItemDrop(entities, nextId, rx + room.w - 6, cy + 3, 'clean_health_cert', 1);
  addItemDrop(entities, nextId, rx + 5, cy + 3, 'inspection_mirror', 1);

  spawnAdminNpc(entities, nextId, PLATON_DEF, PLATON_ID, rx + 5, cy, false, 'makarov');
  spawnAdminNpc(entities, nextId, QUARANTINE_SECRETARY_DEF, QUARANTINE_SECRETARY_ID, rx + 8, cy - 2, false);
  spawnAdminMonster(world, entities, nextId, cx + 5, cy, MonsterKind.MUKHOZHUK_HOST);

  genLog(`[MINISTRY_MUKHOZHUK] ${room.name} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId: room.id + 1 };
}
