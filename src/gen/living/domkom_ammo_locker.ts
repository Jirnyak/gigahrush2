/* -- Домкомовский патронный шкаф: low-count Living ammo loop ---- */

import {
  Cell, ContainerKind, DoorState, Faction, Feature,
  FloorLevel, Occupation, QuestType, RoomType, Tex,
  type Entity, type Room, type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { protectRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

const CONTENT_TAG = 'ag42_domkom_ammo';
const AMMO_ZONE = 47;
const ROOM_W = 15;
const ROOM_H = 11;

const KEEPER_ID = 'ag42_zoya_ammo_keeper';
const GUARD_ID = 'ag42_semen_seal_guard';

const NPC_DEFS: Record<string, PlotNpcDef> = {
  [KEEPER_ID]: {
    name: 'Зоя Патронная',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.STOREKEEPER,
    sprite: Occupation.STOREKEEPER,
    hp: 120,
    maxHp: 120,
    money: 130,
    speed: 0.8,
    inventory: [
      { defId: 'ammo_9mm', count: 6 },
      { defId: 'ammo_shells', count: 1 },
      { defId: 'bandage', count: 1 },
      { defId: 'cigs', count: 2 },
    ],
    talkLines: [
      'Патроны есть, но поштучно. Домком требует запись, коридор требует тишину.',
      'Хочешь честно - покупай у меня. Хочешь быстро - ящик видишь сам.',
      'Принесешь магазинную пружину или целый магазин - отсыплю без лишних вопросов.',
      'Не путай склад с оружейной. Тут не воюют, тут доживают до следующего обхода.',
    ],
    talkLinesPost: [
      'Считай выстрелы. Зоя записывает расход лучше, чем люди вспоминают долги.',
      'Если берешь из пломбированного ящика, не стой потом рядом с Семеном.',
      'Пока есть учет, есть шанс купить еще один выстрел.',
    ],
  },
  [GUARD_ID]: {
    name: 'Семен Пломба',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 210,
    maxHp: 210,
    money: 35,
    speed: 0.9,
    inventory: [
      { defId: 'pipe', count: 1 },
      { defId: 'liquidator_token', count: 1 },
    ],
    talkLines: [
      'Пломба целая - разговор короткий.',
      'Берешь из гражданского ящика - домком ругается. Берешь из нашего - я запоминаю лицо.',
      'Патроны тут не лежат. Они ждут, кто первым сделает глупость.',
    ],
    talkLinesPost: [
      'Смотри на Зою, не на ящик.',
      'Если сирена начнется, каждый сам считает свои патроны.',
    ],
  },
};

registerSideQuest(KEEPER_ID, NPC_DEFS[KEEPER_ID], [
  {
    id: 'ag42_zoya_magazine_part',
    giverNpcId: KEEPER_ID,
    type: QuestType.FETCH,
    desc: 'Зоя Патронная: «Принеси пустой магазин. За учетную мелочь отдам немного 9мм и одну дробь.»',
    targetItem: 'magazine_part',
    targetCount: 1,
    rewardItem: 'ammo_9mm',
    rewardCount: 8,
    extraRewards: [{ defId: 'ammo_shells', count: 1 }],
    relationDelta: 8,
    xpReward: 30,
    moneyReward: 18,
  },
]);
registerSideQuest(GUARD_ID, NPC_DEFS[GUARD_ID], []);

function areaClear(world: World, rx: number, ry: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) return false;
    }
  }
  return true;
}

function findOrigin(world: World, zcx: number, zcy: number): { x: number; y: number } {
  const baseX = zcx - Math.floor(ROOM_W / 2);
  const baseY = zcy - Math.floor(ROOM_H / 2);
  for (let r = 0; r <= 72; r += 4) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2 + 0.17;
      const x = world.wrap(baseX + Math.round(Math.cos(a) * r));
      const y = world.wrap(baseY + Math.round(Math.sin(a) * r));
      if (areaClear(world, x, y, ROOM_W, ROOM_H)) return { x, y };
    }
  }
  return { x: world.wrap(baseX), y: world.wrap(baseY) };
}

function carveRoom(world: World, roomId: number, rx: number, ry: number): Room {
  for (let dy = -1; dy <= ROOM_H; dy++) {
    for (let dx = -1; dx <= ROOM_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.METAL;
      world.floorTex[ci] = Tex.F_CONCRETE;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
  }

  const room: Room = {
    id: roomId,
    type: RoomType.STORAGE,
    x: rx,
    y: ry,
    w: ROOM_W,
    h: ROOM_H,
    name: 'Патронный шкаф домкома',
    wallTex: Tex.METAL,
    floorTex: Tex.F_CONCRETE,
    doors: [],
    sealed: false,
    apartmentId: -1,
  };
  world.rooms[roomId] = room;

  for (let dy = 0; dy < ROOM_H; dy++) {
    for (let dx = 0; dx < ROOM_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_CONCRETE;
      world.roomMap[ci] = roomId;
    }
  }

  protectRoom(world, rx, ry, ROOM_W, ROOM_H, Tex.METAL, Tex.F_CONCRETE);
  return room;
}

function connectSouth(world: World, room: Room): void {
  const doorX = world.wrap(room.x + Math.floor(room.w / 2));
  const doorY = world.wrap(room.y + room.h);
  const doorI = world.idx(doorX, doorY);
  world.cells[doorI] = Cell.DOOR;
  world.floorTex[doorI] = Tex.F_CONCRETE;
  world.roomMap[doorI] = -1;
  world.doors.set(doorI, { idx: doorI, state: DoorState.CLOSED, roomA: room.id, roomB: -1, keyId: '', timer: 0 });
  room.doors.push(doorI);

  let cy = world.wrap(doorY + 1);
  for (let s = 0; s < 72; s++) {
    const ci = world.idx(doorX, cy);
    if (world.cells[ci] === Cell.FLOOR && !world.aptMask[ci]) break;
    if (!world.aptMask[ci] && world.cells[ci] !== Cell.LIFT) {
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_CONCRETE;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
    cy = world.wrap(cy + 1);
  }
}

function decorateRoom(world: World, room: Room): void {
  const rx = room.x;
  const ry = room.y;
  for (let x = rx + 2; x <= rx + ROOM_W - 3; x += 2) world.features[world.idx(x, ry + 1)] = Feature.SHELF;
  for (let x = rx + 3; x <= rx + ROOM_W - 4; x++) world.features[world.idx(x, ry + 4)] = Feature.DESK;
  world.features[world.idx(rx + 2, ry + 2)] = Feature.LAMP;
  world.features[world.idx(rx + ROOM_W - 3, ry + 2)] = Feature.LAMP;
  world.features[world.idx(rx + Math.floor(ROOM_W / 2), ry + ROOM_H - 2)] = Feature.LAMP;
  world.features[world.idx(rx + 3, ry + ROOM_H - 3)] = Feature.CHAIR;
  world.features[world.idx(rx + ROOM_W - 4, ry + ROOM_H - 3)] = Feature.CHAIR;
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addAmmoContainer(
  world: World,
  room: Room,
  dx: number,
  dy: number,
  kind: ContainerKind,
  name: string,
  access: WorldContainer['access'],
  inventory: WorldContainer['inventory'],
  tags: string[],
  faction?: Faction,
  ownerNpcId?: number,
  ownerName?: string,
): void {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const ci = world.idx(x, y);
  world.addContainer({
    id: nextContainerId(world),
    x,
    y,
    floor: FloorLevel.LIVING,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind,
    name,
    inventory: inventory.map(i => ({ ...i })),
    capacitySlots: Math.max(6, inventory.length + 2),
    ownerNpcId,
    ownerName,
    faction,
    access,
    discovered: true,
    tags: [CONTENT_TAG, 'ammo', 'living', ...tags],
  });
}

function spawnNpc(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  room: Room,
  plotNpcId: string,
  dx: number,
  dy: number,
  angle: number,
  canGiveQuest: boolean,
  weapon?: string,
): number {
  const existing = entities.find(e => e.alive && e.plotNpcId === plotNpcId);
  if (existing) return existing.id;
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle,
    weapon,
    canGiveQuest,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
  });
  return npc.id;
}

function seedContainers(world: World, room: Room, keeperId: number): void {
  addAmmoContainer(
    world,
    room,
    2,
    2,
    ContainerKind.CASHBOX,
    'Учетная касса патронов',
    'owner',
    [
      { defId: 'ammo_9mm', count: 5 },
      { defId: 'ammo_shells', count: 1 },
      { defId: 'magazine_part', count: 1 },
    ],
    ['owner_stock', 'trade', 'theft'],
    Faction.CITIZEN,
    keeperId,
    NPC_DEFS[KEEPER_ID].name,
  );
  addAmmoContainer(
    world,
    room,
    ROOM_W - 3,
    2,
    ContainerKind.WEAPON_CRATE,
    'Пломбированный ящик ликвидатора',
    'faction',
    [
      { defId: 'ammo_9mm', count: 7 },
      { defId: 'ammo_shells', count: 2 },
    ],
    ['faction_risk', 'locked', 'seal', 'theft'],
    Faction.LIQUIDATOR,
  );
}

function generateDomkomAmmoLocker(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zcx: number,
  zcy: number,
): { nextRoomId: number } {
  const pos = findOrigin(world, zcx, zcy);
  const room = carveRoom(world, nextRoomId++, pos.x, pos.y);
  connectSouth(world, room);
  decorateRoom(world, room);

  const keeperId = spawnNpc(world, entities, nextId, room, KEEPER_ID, 5, 6, Math.PI / 2, true);
  spawnNpc(world, entities, nextId, room, GUARD_ID, ROOM_W - 4, 7, Math.PI, false, 'pipe');
  seedContainers(world, room, keeperId);
  world.bakeLights();

  genLog(`[AG42] Патронный шкаф домкома at (${pos.x}, ${pos.y}) room #${room.id}`);
  return { nextRoomId };
}

registerZoneContent(AMMO_ZONE, 'Патронный шкаф домкома', generateDomkomAmmoLocker);
