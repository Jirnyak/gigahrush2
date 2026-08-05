/* -- Living cartographer: route clues without full-map omniscience ---- */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  Cell, ContainerKind, DoorState, EntityType, Faction, Feature, FloorLevel, Occupation, QuestType,
  RoomType, Tex,
  type ContainerAccess, type Entity, type Room, type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { Spr } from '../../render/sprite_index';
import { registerRouteCue } from '../../systems/route_cues';
import { protectRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

const ROOM_NAME = 'Комната живой карты';
const ROOM_W = 17;
const ROOM_H = 11;
const CARTOGRAPHER_ID = 'ag43_seva_cartographer';

const NPC_DEF: PlotNpcDef = {
  name: 'Сева Картограф',
  isFemale: false,
  faction: Faction.SCIENTIST,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 90,
  maxHp: 90,
  money: 95,
  speed: 0.75,
  inventory: [
    { defId: 'caravan_route', count: 1 },
    { defId: 'child_map', count: 1 },
    { defId: 'lift_scheme', count: 1 },
    { defId: 'note', count: 3 },
  ],
  talkLines: [],
  talkLinesPost: [
    'Слух без этажа - мусор. Слух с зоной - уже маршрут.',
    'Я не открываю весь этаж. За 100 рублей живая карта снимет один кусок тумана.',
    'Карту покупают, крадут или выверяют ногами. Все три способа оставляют след.',
  ],
};

registerSideQuest(CARTOGRAPHER_ID, NPC_DEF, [
  {
    id: 'ag43_cartographer_maintenance_lead',
    giverNpcId: CARTOGRAPHER_ID,
    type: QuestType.VISIT,
    desc: 'Сева Картограф: «Спустись в Коллекторы и вернись с отметкой нижней зацепки. Если слышишь воду - держи фильтр или фонарь под рукой.»',
    visitFloor: FloorLevel.MAINTENANCE,
    rewardItem: 'caravan_route',
    rewardCount: 1,
    extraRewards: [{ defId: 'water', count: 1 }],
    relationDelta: 10,
    xpReward: 45,
    moneyReward: 35,
  },
  {
    id: 'ag43_cartographer_crosscheck_notes',
    giverNpcId: CARTOGRAPHER_ID,
    type: QuestType.FETCH,
    desc: 'Сева Картограф: «Принеси две чужие записки. Я сверю их с картой и отдам рабочую схему лифтов, без обещаний безопасного маршрута.»',
    targetItem: 'note',
    targetCount: 2,
    rewardItem: 'lift_scheme',
    rewardCount: 1,
    extraRewards: [{ defId: 'child_map', count: 1 }],
    relationDelta: 8,
    xpReward: 30,
    moneyReward: 20,
  },
]);

function areaClear(world: World, rx: number, ry: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      if (world.aptMask[world.idx(rx + dx, ry + dy)]) return false;
    }
  }
  return true;
}

function findOrigin(world: World, zcx: number, zcy: number): { x: number; y: number } {
  const baseX = zcx - Math.floor(ROOM_W / 2);
  const baseY = zcy - Math.floor(ROOM_H / 2);
  for (let r = 8; r <= 72; r += 4) {
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2 + 0.17;
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
      if (world.aptMask[ci]) continue;
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.PANEL;
      world.floorTex[ci] = Tex.F_PARQUET;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
  }

  const room: Room = {
    id: roomId,
    type: RoomType.OFFICE,
    x: rx,
    y: ry,
    w: ROOM_W,
    h: ROOM_H,
    name: ROOM_NAME,
    wallTex: Tex.PANEL,
    floorTex: Tex.F_PARQUET,
    doors: [],
    sealed: false,
    apartmentId: -1,
  };
  world.rooms[roomId] = room;

  for (let dy = 0; dy < ROOM_H; dy++) {
    for (let dx = 0; dx < ROOM_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci]) continue;
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_PARQUET;
      world.roomMap[ci] = roomId;
    }
  }

  protectRoom(world, rx, ry, ROOM_W, ROOM_H, Tex.PANEL, Tex.F_PARQUET);
  return room;
}

function connectSouth(world: World, room: Room): void {
  const doorX = world.wrap(room.x + Math.floor(room.w / 2));
  const doorY = world.wrap(room.y + room.h);
  const doorI = world.idx(doorX, doorY);
  world.cells[doorI] = Cell.DOOR;
  world.floorTex[doorI] = Tex.F_PARQUET;
  world.roomMap[doorI] = -1;
  world.doors.set(doorI, { idx: doorI, state: DoorState.CLOSED, roomA: room.id, roomB: -1, keyId: '', timer: 0 });
  room.doors.push(doorI);

  let cy = world.wrap(doorY + 1);
  for (let s = 0; s < 70; s++) {
    const ci = world.idx(doorX, cy);
    if (world.cells[ci] === Cell.FLOOR && !world.aptMask[ci]) break;
    if (!world.aptMask[ci]) {
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_LINO;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
    cy = world.wrap(cy + 1);
  }
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = feature;
}

function decorateRoom(world: World, room: Room): void {
  const rx = room.x;
  const ry = room.y;
  for (let dx = 2; dx <= ROOM_W - 3; dx += 2) setFeature(world, rx + dx, ry + 1, Feature.SHELF);
  for (let dx = 3; dx <= ROOM_W - 4; dx += 4) setFeature(world, rx + dx, ry + ROOM_H - 2, Feature.DESK);
  for (let dx = 4; dx <= ROOM_W - 5; dx += 4) setFeature(world, rx + dx, ry + ROOM_H - 3, Feature.CHAIR);

  setFeature(world, rx + 2, ry + 2, Feature.LAMP);
  setFeature(world, rx + ROOM_W - 3, ry + 2, Feature.LAMP);
  setFeature(world, rx + Math.floor(ROOM_W / 2), ry + 5, Feature.TABLE);
  setFeature(world, rx + Math.floor(ROOM_W / 2) - 1, ry + 5, Feature.CHAIR);
  setFeature(world, rx + Math.floor(ROOM_W / 2) + 1, ry + 5, Feature.CHAIR);
  setFeature(world, rx + 3, ry + 6, Feature.APPARATUS);
  setFeature(world, rx + ROOM_W - 4, ry + 6, Feature.MACHINE);

  world.wallTex[world.idx(rx + Math.floor(ROOM_W / 2), ry - 1)] = Tex.POSTER_BASE + 37;
  world.wallTex[world.idx(rx + ROOM_W - 1, ry + 4)] = Tex.POSTER_BASE + 12;
  stampSurfaceSplat(world, rx + Math.floor(ROOM_W / 2), ry + 5, 0.5, 0.5, 4, 0.35, 43043, 80, 180, 150, false);
}

function dropItem(entities: Entity[], nextId: { v: number }, x: number, y: number, defId: string, count = 1): void {
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

function spawnCartographer(world: World, entities: Entity[], nextId: { v: number }, room: Room): Entity {
  const existing = entities.find(e => e.alive && e.plotNpcId === CARTOGRAPHER_ID);
  if (existing) return existing;
  const x = world.wrap(room.x + Math.floor(ROOM_W / 2));
  const y = world.wrap(room.y + 3);
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, CARTOGRAPHER_ID, x + 0.5, y + 0.5, {
    angle: Math.PI / 2,
    canGiveQuest: true,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
  });
  return npc;
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addContainer(
  world: World,
  room: Room,
  dx: number,
  dy: number,
  name: string,
  access: ContainerAccess,
  inventory: WorldContainer['inventory'],
  owner?: Entity,
): void {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  world.addContainer({
    id: nextContainerId(world),
    x,
    y,
    floor: FloorLevel.LIVING,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind: ContainerKind.FILING_CABINET,
    name,
    inventory: inventory.map(i => ({ ...i })),
    capacitySlots: 8,
    ownerNpcId: owner?.id,
    ownerName: owner?.name,
    faction: Faction.SCIENTIST,
    access,
    discovered: true,
    tags: ['cartographer', 'route_lead', 'paper', access === 'owner' ? 'theft' : 'trade'],
  });
}

function seedClues(world: World, entities: Entity[], nextId: { v: number }, room: Room, cartographer: Entity): void {
  addContainer(
    world,
    room,
    ROOM_W - 3,
    2,
    'Картотека живых маршрутов',
    'owner',
    [
      { defId: 'caravan_route', count: 1 },
      { defId: 'child_map', count: 1 },
      { defId: 'lift_scheme', count: 1 },
      { defId: 'note', count: 3 },
    ],
    cartographer,
  );
  dropItem(entities, nextId, room.x + 3, room.y + ROOM_H - 3, 'note', 1);
  dropItem(entities, nextId, room.x + ROOM_W - 4, room.y + ROOM_H - 3, 'siren_instruction', 1);
}

function registerPaidRouteAdviceCue(world: World, room: Room): void {
  const tableX = world.wrap(room.x + Math.floor(ROOM_W / 2)) + 0.5;
  const tableY = world.wrap(room.y + 5) + 0.5;
  const markerCell = world.idx(Math.floor(tableX), Math.floor(tableY));
  registerRouteCue(world, {
    id: 'living_cartographer_paid_route_advice',
    x: tableX,
    y: tableY,
    targetX: tableX,
    targetY: tableY,
    floor: FloorLevel.LIVING,
    roomId: room.id,
    targetRoomId: room.id,
    zoneId: world.zoneMap[markerCell],
    label: 'живая карта Севы',
    hint: '100₽: получить короткую маршрутную сводку',
    targetName: 'платная маршрутная сводка',
    color: '#8fd',
    tags: ['living', 'cartographer', 'paid_route_advice', 'route_planning'],
    toneSeed: room.id * 43043 + 57,
    radius: 4,
    targetRadius: 1.8,
    cooldownSec: 9,
    paidRouteAdvice: {
      priceRubles: 100,
      sellerName: NPC_DEF.name,
    },
    heardText: 'На столе живая карта шевелит нитями маршрута. За 100₽ Сева даст короткую сводку без всеведения карты.',
    followedText: 'Живая карта держит открытую бумагу достаточно долго, чтобы сверить вылазку.',
    ignoredText: 'Карта свернулась обратно в бумагу: бесплатного маршрута не получилось.',
  });
}

function generateCartographerZoneMap(
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
  const cartographer = spawnCartographer(world, entities, nextId, room);
  seedClues(world, entities, nextId, room, cartographer);
  registerPaidRouteAdviceCue(world, room);
  genLog(`[AG43] ${ROOM_NAME} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId };
}

registerZoneContent(53, ROOM_NAME, generateCartographerZoneMap);
