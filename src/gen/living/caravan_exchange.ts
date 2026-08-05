/* ── Caravan exchange: tariffs, route handoff, and cargo theft ── */

import {
  Cell, ContainerKind, DoorState, Faction, Feature,
  FloorLevel, Occupation, QuestType, RoomType, Tex,
  type ContainerAccess, type Entity, type Item, type Room, type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { protectRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

const ZONE_HUD = 48;
const ROOM_W = 19;
const ROOM_H = 11;
const LANE_QUEUE = 'kvartiry_living_food_water';
const LANE_NET = 'net_exchange_data';
const LANE_MARKET = 'production_black_market_88';

const DISPATCHER_ID = 'ag108_nina_tariff';
const BROKER_ID = 'ag108_ira_net_route';
const INSPECTOR_ID = 'ag108_potap_lane_audit';

const NINA: PlotNpcDef = {
  name: 'Нина Тарифная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 90, maxHp: 90, money: 44, speed: 0.85,
  inventory: [{ defId: 'water_coupon', count: 2 }, { defId: 'bread', count: 1 }],
  talkLines: [
    'Очередь не исчезает. Ее можно только сделать предсказуемой.',
    'Восемнадцать рублей - и квартальный караван идет без лишних дверных сборов.',
    'Не платишь тариф - платишь водой. Просто позже и всем этажом.',
  ],
  talkLinesPost: [
    'Тариф проведен. Очередь сегодня спорит тише.',
    'Если ящик тронут без ведомости, караван пересчитает не только товар.',
  ],
};

const IRA: PlotNpcDef = {
  name: 'Ира НЕТ-маршрут',
  isFemale: true,
  faction: Faction.SCIENTIST,
  occupation: Occupation.SCIENTIST,
  sprite: Occupation.SCIENTIST,
  hp: 80, maxHp: 80, money: 62, speed: 0.9,
  inventory: [{ defId: 'radio', count: 1 }, { defId: 'relay_diagram', count: 1 }],
  talkLines: [
    'НЕТ-терминал видит не двери, а задержки. Задержка тоже товар.',
    'Отдай маршрут каравана - откроем обменную линию данных без нового лифта.',
    'Документы дешевеют только там, где сигнал не врет о дороге.',
  ],
  talkLinesPost: [
    'Линия данных открыта. Теперь бумаги идут не быстрее, а точнее.',
    'Если терминал спросит отправителя, называй не имя, а этаж.',
  ],
};

const POTAP: PlotNpcDef = {
  name: 'Потап Ревизор',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 135, maxHp: 135, money: 38, speed: 1.0,
  weapon: 'makarov',
  inventory: [{ defId: 'ammo_9mm', count: 10 }, { defId: 'liquidator_token', count: 1 }],
  talkLines: [
    'Рынок восемьдесят восемь любит называть пошлину добровольной.',
    'Маршрут на черный рынок сдаешь мне - линию закрываем, патроны остаются у закона.',
    'Не всякий караван надо спасать. Некоторые надо считать до закрытия.',
  ],
  talkLinesPost: [
    'Маршрут лег в папку. Рыночный караван получит дверь с вопросами.',
    'Если Нина ворчит, значит ведомость сработала.',
  ],
};

registerSideQuest(DISPATCHER_ID, NINA, [{
  id: 'ag108_pay_queue_tariff',
  giverNpcId: DISPATCHER_ID,
  type: QuestType.FETCH,
  desc: 'Нина Тарифная: «Оплати 18 рублей за квартальную водно-хлебную линию. Очередь станет стабильнее, цена - тише.»',
  targetItem: 'money', targetCount: 18,
  rewardItem: 'water_coupon', rewardCount: 2,
  relationDelta: 6, xpReward: 25,
  eventTags: ['caravan', 'tariff', 'supply_lane', LANE_QUEUE],
  eventData: { caravanAction: 'pay_tariff', laneId: LANE_QUEUE, rumorIds: ['economy_water_price'] },
  eventTargetName: 'Тариф квартальной очереди оплачен',
  eventSeverity: 4,
  eventPrivacy: 'public',
}]);

registerSideQuest(BROKER_ID, IRA, [{
  id: 'ag108_open_net_lane',
  giverNpcId: BROKER_ID,
  type: QuestType.FETCH,
  desc: 'Ира НЕТ-маршрут: «Отдай маршрут каравана. Откроем линию обменных данных между терминалом и жилой очередью.»',
  targetItem: 'caravan_route', targetCount: 1,
  rewardItem: 'relay_diagram', rewardCount: 1,
  extraRewards: [{ defId: 'filtered_water', count: 1 }],
  relationDelta: 10, xpReward: 45, moneyReward: 18,
  eventTags: ['caravan', 'tariff', 'supply_lane', LANE_NET],
  eventData: { caravanAction: 'open_lane', laneId: LANE_NET, rumorIds: ['economy_factory_tick'] },
  eventTargetName: 'НЕТ-линия обменных данных открыта',
  eventSeverity: 4,
  eventPrivacy: 'public',
}]);

registerSideQuest(INSPECTOR_ID, POTAP, [{
  id: 'ag108_close_market_lane',
  giverNpcId: INSPECTOR_ID,
  type: QuestType.FETCH,
  desc: 'Потап Ревизор: «Сдай маршрут каравана на рынок 88. Линию закроем, контрабандный тариф перестанет кормить рынок.»',
  targetItem: 'caravan_route', targetCount: 1,
  rewardItem: 'ammo_9mm', rewardCount: 8,
  extraRewards: [{ defId: 'liquidator_token', count: 1 }],
  relationDelta: 8, xpReward: 45, moneyReward: 32,
  eventTags: ['caravan', 'tariff', 'supply_lane', LANE_MARKET],
  eventData: { caravanAction: 'close_lane', laneId: LANE_MARKET, rumorIds: ['contract_black_market_88_counter'] },
  eventTargetName: 'Маршрут рынка 88 сдан ревизору',
  eventSeverity: 4,
  eventPrivacy: 'public',
}]);

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
  for (let r = 6; r <= 76; r += 5) {
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2 + 0.21;
      const x = world.wrap(baseX + Math.round(Math.cos(a) * r));
      const y = world.wrap(baseY + Math.round(Math.sin(a) * r));
      if (areaClear(world, x, y)) return { x, y };
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
      world.wallTex[ci] = Tex.METAL;
      world.floorTex[ci] = Tex.F_CONCRETE;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
  }

  const room: Room = {
    id: roomId,
    type: RoomType.OFFICE,
    x: rx, y: ry, w: ROOM_W, h: ROOM_H,
    name: 'Караванная касса и очередь',
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
      if (world.aptMask[ci]) continue;
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_CONCRETE;
      world.roomMap[ci] = roomId;
    }
  }

  protectRoom(world, rx, ry, ROOM_W, ROOM_H, Tex.METAL, Tex.F_CONCRETE);
  return room;
}

function addDoor(world: World, room: Room, x: number, y: number): void {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.DOOR;
  world.floorTex[ci] = Tex.F_CONCRETE;
  world.roomMap[ci] = -1;
  world.doors.set(ci, { idx: ci, state: DoorState.CLOSED, roomA: room.id, roomB: -1, keyId: '', timer: 0 });
  room.doors.push(ci);
}

function connectSouth(world: World, room: Room): void {
  const doorX = world.wrap(room.x + Math.floor(room.w / 2));
  const doorY = world.wrap(room.y + room.h);
  addDoor(world, room, doorX, doorY);
  let cy = world.wrap(doorY + 1);
  for (let s = 0; s < 88; s++) {
    const ci = world.idx(doorX, cy);
    if (world.cells[ci] === Cell.FLOOR && !world.aptMask[ci]) break;
    if (!world.aptMask[ci]) {
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_CONCRETE;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
    cy = world.wrap(cy + 1);
  }
}

function decorateRoom(world: World, room: Room): void {
  for (let x = room.x + 2; x <= room.x + ROOM_W - 3; x += 4) {
    world.features[world.idx(x, room.y + 1)] = Feature.SHELF;
  }
  for (let x = room.x + 2; x <= room.x + ROOM_W - 3; x += 3) {
    world.features[world.idx(x, room.y + 5)] = Feature.CHAIR;
  }
  world.features[world.idx(room.x + 2, room.y + 3)] = Feature.DESK;
  world.features[world.idx(room.x + 3, room.y + 3)] = Feature.DESK;
  world.features[world.idx(room.x + ROOM_W - 4, room.y + 3)] = Feature.TABLE;
  world.features[world.idx(room.x + ROOM_W - 3, room.y + 3)] = Feature.TABLE;
  world.features[world.idx(room.x + 1, room.y + ROOM_H - 2)] = Feature.LAMP;
  world.features[world.idx(room.x + ROOM_W - 2, room.y + ROOM_H - 2)] = Feature.LAMP;
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
): Entity {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  return requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle,
    canGiveQuest: true,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
  });
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addExchangeContainer(
  world: World,
  room: Room,
  dx: number,
  dy: number,
  name: string,
  kind: ContainerKind,
  access: ContainerAccess,
  inventory: Item[],
  laneId: string,
  owner?: Entity,
  faction = Faction.CITIZEN,
): void {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const container: WorldContainer = {
    id: nextContainerId(world),
    x,
    y,
    floor: FloorLevel.LIVING,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind,
    name,
    inventory: inventory.map(item => ({ ...item })),
    capacitySlots: Math.max(8, inventory.length + 3),
    ownerNpcId: owner?.id,
    ownerName: owner?.name,
    faction,
    access,
    discovered: true,
    tags: ['caravan', 'tariff', 'supply_lane', laneId, 'caravan_cargo'],
  };
  world.addContainer(container);
}

function seedContainers(world: World, room: Room, dispatcher: Entity, inspector: Entity): void {
  addExchangeContainer(
    world, room, 2, ROOM_H - 3, 'Караванный ящик очереди',
    ContainerKind.WOODEN_CHEST, 'owner',
    [{ defId: 'water', count: 3 }, { defId: 'bread', count: 3 }, { defId: 'water_coupon', count: 2 }],
    LANE_QUEUE, dispatcher, Faction.CITIZEN,
  );
  addExchangeContainer(
    world, room, ROOM_W - 4, ROOM_H - 3, 'Опечатанный рыночный тюк',
    ContainerKind.SECRET_STASH, 'owner',
    [{ defId: 'ammo_9mm', count: 8 }, { defId: 'govnyak_roll', count: 2 }, { defId: 'cigs', count: 3 }],
    LANE_MARKET, inspector, Faction.LIQUIDATOR,
  );
  addExchangeContainer(
    world, room, ROOM_W - 3, 2, 'Касса тарифных квитанций',
    ContainerKind.CASHBOX, 'faction',
    [{ defId: 'caravan_route', count: 1 }, { defId: 'blank_form', count: 2 }, { defId: 'note', count: 1 }],
    LANE_NET, dispatcher, Faction.CITIZEN,
  );
}

function generateCaravanExchange(
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
  const dispatcher = spawnNpc(world, entities, nextId, room, DISPATCHER_ID, 4, 3, Math.PI / 2);
  spawnNpc(world, entities, nextId, room, BROKER_ID, ROOM_W - 5, 3, Math.PI);
  const inspector = spawnNpc(world, entities, nextId, room, INSPECTOR_ID, ROOM_W - 4, ROOM_H - 3, Math.PI);
  seedContainers(world, room, dispatcher, inspector);
  genLog(`[AG108] ${room.name} at (${pos.x}, ${pos.y}) room #${room.id}`);
  return { nextRoomId };
}

registerZoneContent(ZONE_HUD, 'Караванная касса и очередь', generateCaravanExchange);
