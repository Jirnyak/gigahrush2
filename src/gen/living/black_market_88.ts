/* -- Счетная 88: hidden debt counter for the living black market ---- */

import {
  Cell, ContainerKind, DoorState, Feature, FloorLevel, RoomType, Tex,
  type ContainerAccess, type Entity, Faction, Occupation, QuestType,
  type Room, type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { protectRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

const ROOM_W = 21;
const ROOM_H = 13;

const NPC_DEFS: Record<string, PlotNpcDef> = {
  ag15_marta_broker: {
    name: 'Марта Восьмая',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.STOREKEEPER,
    sprite: Occupation.STOREKEEPER,
    hp: 120, maxHp: 120, money: 260, speed: 0.75,
    inventory: [
      { defId: 'pills', count: 2 },
      { defId: 'sleeping_pills', count: 1 },
      { defId: 'antibiotic', count: 1 },
      { defId: 'fake_pass', count: 1 },
      { defId: 'cigs', count: 4 },
      { defId: 'govnyak_roll', count: 3 },
      { defId: 'govnyak_brick', count: 1 },
    ],
    talkLines: [
      'Тише. Здесь считают не рубли, а тех, кто дожил до расплаты.',
      'Лекарство есть. Цена двигается вместе с дефицитом: медпосту один антибиотик, рынку две очереди.',
      'Нужен пропуск — принесешь чистый бланк или чужую подпись.',
      'Сейфы видишь? Там не товар. Там расписки, жетоны и причины, по которым люди возвращаются до сирены.',
    ],
    talkLinesPost: [
      'Сегодня ты платишь сразу. Это почти доверие.',
      'Если лекарство подорожало, значит кто-то не успел до медпункта.',
      'Не бери из ящика без спроса. Охрана любит простые события.',
    ],
  },

  ag15_ilya_debtor: {
    name: 'Илья Долговой',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.ALCOHOLIC,
    sprite: Occupation.ALCOHOLIC,
    hp: 70, maxHp: 70, money: 3, speed: 0.8,
    inventory: [
      { defId: 'voluntary_receipt', count: 1 },
      { defId: 'bread', count: 1 },
    ],
    talkLines: [
      'Я взял таблетки до самосбора. После самосбора цена стала другой, а долг остался с моей фамилией.',
      'Восемьдесят восемь рублей — не сумма. Это дверь между мной и охраной.',
      'Если заплачу сегодня, завтра меня будут искать по имени, а не по долгу у двери.',
    ],
    talkLinesPost: [
      'Дышится тише. Долг ушел, но место под него осталось.',
      'Марта улыбнулась. Я не знаю, хорошо ли это.',
    ],
  },

  ag15_ryzhiy_guard: {
    name: 'Рыжий Пост',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 220, maxHp: 220, money: 40, speed: 0.9,
    inventory: [
      { defId: 'makarov', count: 1 },
      { defId: 'ammo_9mm', count: 10 },
      { defId: 'liquidator_token', count: 1 },
    ],
    talkLines: [
      'Руки из ящика вынул — живешь дальше.',
      'Я тут не охраняю рынок. Я охраняю список должников от сокращения.',
      'Кража здесь звучит громче выстрела. Выстрел хотя бы честный.',
    ],
    talkLinesPost: [
      'Смотри на прилавок, не на сейф.',
      'Если Марта сказала можно, значит пока можно.',
    ],
  },

  ag15_lena_supplier: {
    name: 'Лена Подвал',
    isFemale: true,
    faction: Faction.WILD,
    occupation: Occupation.TRAVELER,
    sprite: Occupation.TRAVELER,
    hp: 95, maxHp: 95, money: 70, speed: 1.1,
    inventory: [
      { defId: 'ammo_energy', count: 1 },
      { defId: 'gasmask_filter', count: 1 },
      { defId: 'metro_ticket', count: 1 },
    ],
    talkLines: [
      'Поставка пришла через люк. Люк ушел обратно без проводника.',
      'Жетон ликвидатора стоит дорого, потому что его редко отдают живым.',
      'Ящики не заперты. Они просто принадлежат людям с ключами, пистолетами и свободным вечером.',
    ],
    talkLinesPost: [
      'Жетон настоящий. Значит, у кого-то теперь нет номера.',
      'Следующий люк будет мокрым. Бери фильтр, если есть чем платить.',
    ],
  },

  ag15_nina_informer: {
    name: 'Нина Шептунья',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 80, maxHp: 80, money: 45, speed: 0.85,
    inventory: [
      { defId: 'denunciation', count: 1 },
      { defId: 'note', count: 3 },
      { defId: 'blank_form', count: 1 },
    ],
    talkLines: [
      'Донос без подписи дешевле хлеба. Донос с подписью покупают молча.',
      'В рынке есть стукач. Не ищи человека — ищи бумагу.',
      'Фальшивый пропуск пахнет чернилами только первые пять минут.',
    ],
    talkLinesPost: [
      'Бумага сказала достаточно. Люди теперь будут молчать громче.',
      'Если кто спросит — мы говорили о погоде в коридоре.',
    ],
  },
};

registerSideQuest('ag15_marta_broker', NPC_DEFS.ag15_marta_broker, [
  {
    id: 'ag15_marta_medicine_bid',
    giverNpcId: 'ag15_marta_broker',
    type: QuestType.FETCH,
    desc: 'Марта Восьмая: «Нужен антибиотик. Выкупи, выкради, вымоли — дефицит сам решит цену.»',
    targetItem: 'antibiotic', targetCount: 1,
    rewardItem: 'fake_pass', rewardCount: 1,
    extraRewards: [{ defId: 'cigs', count: 2 }],
    relationDelta: 12, xpReward: 45, moneyReward: 110,
  },
  {
    id: 'ag15_marta_fake_permit',
    giverNpcId: 'ag15_marta_broker',
    type: QuestType.FETCH,
    desc: 'Марта Восьмая: «Принеси фальшивый пропуск. Я передам его тому, кто не должен выйти официально.»',
    targetItem: 'fake_pass', targetCount: 1,
    rewardItem: 'key', rewardCount: 1,
    extraRewards: [{ defId: 'tea', count: 2 }],
    relationDelta: 10, xpReward: 35, moneyReward: 88,
  },
]);

registerSideQuest('ag15_ilya_debtor', NPC_DEFS.ag15_ilya_debtor, [
  {
    id: 'ag15_ilya_pay_debt',
    giverNpcId: 'ag15_ilya_debtor',
    type: QuestType.FETCH,
    desc: 'Илья Долговой: «Закрой за меня восемьдесят восемь рублей. Иначе Рыжий запишет меня в расход.»',
    targetItem: 'money', targetCount: 88,
    rewardItem: 'bread', rewardCount: 2,
    extraRewards: [{ defId: 'water', count: 2 }, { defId: 'voluntary_receipt', count: 1 }],
    relationDelta: 8, xpReward: 25,
  },
]);

registerSideQuest('ag15_lena_supplier', NPC_DEFS.ag15_lena_supplier, [
  {
    id: 'ag15_lena_stolen_token',
    giverNpcId: 'ag15_lena_supplier',
    type: QuestType.FETCH,
    desc: 'Лена Подвал: «В долговом ящике лежит жетон ликвидатора. Принесешь — получишь энергоячейку. Услышат — беги.»',
    targetItem: 'liquidator_token', targetCount: 1,
    rewardItem: 'ammo_energy', rewardCount: 1,
    extraRewards: [{ defId: 'ammo_9mm', count: 12 }],
    relationDelta: 10, xpReward: 50, moneyReward: 120,
  },
]);

registerSideQuest('ag15_nina_informer', NPC_DEFS.ag15_nina_informer, [
  {
    id: 'ag15_nina_expose_snitch',
    giverNpcId: 'ag15_nina_informer',
    type: QuestType.FETCH,
    desc: 'Нина Шептунья: «Найди донос из сейфа. Стукача не надо убивать, его надо прочитать вслух.»',
    targetItem: 'denunciation', targetCount: 1,
    rewardItem: 'cigs', rewardCount: 4,
    extraRewards: [{ defId: 'blank_form', count: 1 }],
    relationDelta: 12, xpReward: 40, moneyReward: 65,
  },
]);

registerSideQuest('ag15_ryzhiy_guard', NPC_DEFS.ag15_ryzhiy_guard, []);

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
  for (let r = 10; r <= 72; r += 4) {
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2 + 0.31;
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
      world.wallTex[ci] = Tex.METAL;
      world.floorTex[ci] = Tex.F_CONCRETE;
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
    name: 'Счетная 88',
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
  for (let s = 0; s < 70; s++) {
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
  const rx = room.x;
  const ry = room.y;
  for (let x = rx + 3; x <= rx + ROOM_W - 4; x++) world.features[world.idx(x, ry + 4)] = Feature.DESK;
  for (let x = rx + 2; x <= rx + ROOM_W - 3; x += 3) world.features[world.idx(x, ry + 1)] = Feature.SHELF;
  for (let x = rx + 3; x <= rx + ROOM_W - 4; x += 4) world.features[world.idx(x, ry + ROOM_H - 3)] = Feature.CHAIR;
  world.features[world.idx(rx + 2, ry + 2)] = Feature.LAMP;
  world.features[world.idx(rx + ROOM_W - 3, ry + 2)] = Feature.LAMP;
  world.features[world.idx(rx + Math.floor(ROOM_W / 2), ry + ROOM_H - 2)] = Feature.LAMP;
  world.features[world.idx(rx + 5, ry + 7)] = Feature.APPARATUS;
  world.features[world.idx(rx + ROOM_W - 6, ry + 7)] = Feature.MACHINE;
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addMarketContainer(
  world: World,
  room: Room,
  dx: number,
  dy: number,
  kind: ContainerKind,
  name: string,
  access: ContainerAccess,
  capacitySlots: number,
  inventory: WorldContainer['inventory'],
  tags: string[],
  faction?: Faction,
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
    kind,
    name,
    inventory: inventory.map(i => ({ ...i })),
    capacitySlots,
    faction,
    access,
    discovered: true,
    tags: ['black_market_88', ...tags],
  });
}

function seedContainers(world: World, room: Room): void {
  addMarketContainer(
    world, room, 4, 2, ContainerKind.MEDICAL_CABINET, 'Прилавок дефицита 88',
    'owner', 8,
    [
      { defId: 'pills', count: 2 },
      { defId: 'antibiotic', count: 1 },
      { defId: 'bandage', count: 3 },
      { defId: 'sanitary_kit', count: 1 },
    ],
    ['stock', 'medicine', 'scarcity'],
    Faction.CITIZEN,
  );
  addMarketContainer(
    world, room, ROOM_W - 5, 2, ContainerKind.WEAPON_CRATE, 'Долговой ящик 88',
    'faction', 8,
    [
      { defId: 'liquidator_token', count: 1 },
      { defId: 'denunciation', count: 1 },
      { defId: 'fake_pass', count: 1 },
      { defId: 'morphine_ampoule', count: 1 },
    ],
    ['debt', 'theft', 'faction_risk', 'locked'],
    Faction.LIQUIDATOR,
  );
  addMarketContainer(
    world, room, Math.floor(ROOM_W / 2), ROOM_H - 3, ContainerKind.CASHBOX, 'Касса расписок 88',
    'owner', 6,
    [
      { defId: 'voluntary_receipt', count: 2 },
      { defId: 'blank_form', count: 2 },
      { defId: 'cigs', count: 3 },
      { defId: 'govnyak_roll', count: 2 },
      { defId: 'govnyak_bad_batch', count: 1 },
    ],
    ['debt', 'paper', 'trade'],
    Faction.CITIZEN,
  );
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
): void {
  if (entities.some(e => e.alive && e.plotNpcId === plotNpcId)) return;
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle,
    weapon,
    canGiveQuest,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
  });
}

function spawnMarketNpcs(world: World, entities: Entity[], nextId: { v: number }, room: Room): void {
  spawnNpc(world, entities, nextId, room, 'ag15_marta_broker', 10, 3, Math.PI / 2, true);
  spawnNpc(world, entities, nextId, room, 'ag15_ilya_debtor', 3, 9, 0, true);
  spawnNpc(world, entities, nextId, room, 'ag15_ryzhiy_guard', ROOM_W - 3, 8, Math.PI, false, 'makarov');
  spawnNpc(world, entities, nextId, room, 'ag15_lena_supplier', 5, 6, 0, true, 'knife');
  spawnNpc(world, entities, nextId, room, 'ag15_nina_informer', ROOM_W - 6, 6, Math.PI, true);
}

function generateBlackMarket88(
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
  seedContainers(world, room);
  spawnMarketNpcs(world, entities, nextId, room);
  genLog(`[AG15] Счетная 88 at (${pos.x}, ${pos.y}) room #${room.id}`);
  return { nextRoomId };
}

registerZoneContent(13, 'Счетная 88 (долговой черный рынок)', generateBlackMarket88);
