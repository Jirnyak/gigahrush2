/* -- Пункт сборов вылазки: Living route prep without menu UI ----- */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  Cell, ContainerKind, DoorState, EntityType, Faction, Feature,
  FloorLevel, Occupation, QuestType, RoomType, Tex,
  type ContainerAccess, type Entity, type Room, type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { Spr } from '../../render/sprite_index';
import { protectRoom } from '../shared';
import { genLog } from '../log';
import { placeLivingExpeditionCraftStations } from '../craft_stations';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

const CONTENT_TAG = 'floor11_living_expedition_prep';
const PREP_ZONE = 52;
const ROOM_W = 19;
const ROOM_H = 12;

const ROUTE_KEEPER_ID = 'floor11_lida_route_keeper';
const REPAIR_ID = 'floor11_anya_hermodoor';
const LOST_ID = 'floor11_misha_lost_property';
const WITNESS_ID = 'floor11_vera_return_witness';

const CHECKLIST_NOTE = 'Чек-лист вылазки: Ольга -> Сержант Баринов -> Яков, потом цель, Z, риск, лифт туда и лифт обратно. Вода, еда, бинт, патроны, фильтр или талон. Нет цели - возьми слух или контракт до лифта.';

const NPC_DEFS: Record<string, PlotNpcDef> = {
  [ROUTE_KEEPER_ID]: {
    name: 'Лида Маршрутная',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 95,
    maxHp: 95,
    money: 85,
    speed: 0.8,
    inventory: [
      { defId: 'caravan_route', count: 1 },
      { defId: 'siren_instruction', count: 2 },
      { defId: 'water_coupon', count: 2 },
      { defId: 'water', count: 2 },
      { defId: 'bread', count: 1 },
      { defId: 'bandage', count: 1 },
      { defId: 'ammo_9mm', count: 6 },
    ],
    talkLines: [
      'Пункт сборов не выбирает маршрут за тебя. Он проверяет, что ты не идешь в лифт с пустым горлом.',
      'Общий ящик дает минимум: вода, бинт, хлеб и четыре патрона. Остальное покупай, меняй или воруй уже осознанно.',
      'Вниз к воде: две бутылки, фильтр, фонарь. Если вода поет в трубе, не пей и не стой рядом.',
      'Наверх за бумагой: корешок пропуска, чистые руки, мало лишних записок. Печатеед любит толстые карманы.',
      'Через жилые прослойки бери хлеб, бинт и шесть патронов. Там чаще торгуются, но стреляют без объявления.',
      'Вернулся с уликой - отдай Вере. Она пишет коротко, зато потом люди верят маршруту, а не слуху.',
    ],
    talkLinesPost: [
      'Фильтр не делает маршрут безопасным. Он просто дает дышать, пока решаешь, бежать или воровать.',
      'Вода, бинт, патроны, документ. Остальное - гордость, а гордость плохо закрывает герму.',
      'Следующий лифт не ждет готовых. Он ждет тех, кто хотя бы проверил карманы.',
    ],
  },

  [REPAIR_ID]: {
    name: 'Аня Герма',
    isFemale: true,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.LOCKSMITH,
    sprite: Occupation.LOCKSMITH,
    hp: 135,
    maxHp: 135,
    money: 45,
    speed: 0.85,
    inventory: [
      { defId: 'wrench', count: 1 },
      { defId: 'sealant_tube', count: 1 },
      { defId: 'fuse', count: 1 },
    ],
    talkLines: [
      'Герму чинят до сирены. Во время сирены ее только уговаривают и обычно проигрывают.',
      'Нужен гермоуплотнитель. Один хороший шов превращает комнату из щели в укрытие.',
      'Если дверь хлопает сама, не держи ее рукой. Дай ей петлю, комплект и уважение.',
      'Перед нижним маршрутом проверь фильтр. Перед верхним - бумагу. Перед любым - дверь, за которой будешь прятаться.',
    ],
    talkLinesPost: [
      'Один шов держит. Не весь блок, но один угол теперь можно переждать без сквозняка.',
      'Комплект двери не геройство. Поставил, закрыл, выжил - вот вся инструкция.',
      'После ремонта слушай петли. Скрип раньше сирены иногда честнее.',
      'Если шов сухой после отбоя, подпиши мелом и не трогай до обхода.',
    ],
  },

  [LOST_ID]: {
    name: 'Миша Потеряшка',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.TRAVELER,
    sprite: Occupation.TRAVELER,
    hp: 80,
    maxHp: 80,
    money: 22,
    speed: 1.05,
    inventory: [
      { defId: 'child_map', count: 1 },
      { defId: 'bread', count: 1 },
      { defId: 'cigs', count: 1 },
    ],
    talkLines: [
      'Потерянное имущество не лежит. Оно ходит кругами, пока кто-нибудь не назовет номер бирки.',
      'Найдешь бирку от ключа - не примеряй к каждой двери. Некоторые двери рады любому имени.',
      'Детская карта у меня. Отдам за бирку, потому что дети хотя бы рисуют выходы честно.',
      'Если после вылазки вещь стала твоей, но пахнет чужой квартирой, не храни ее у кровати.',
    ],
    talkLinesPost: [
      'Бирка вернулась. Шкаф снова числится за живым человеком, это уже прогресс.',
      'Карта твоя. Красные кресты на ней не клад, а места, где лучше считать патроны.',
      'Потерял что-то после лифта - приходи быстро. Через день находку заберет домкомовская ведомость.',
    ],
  },

  [WITNESS_ID]: {
    name: 'Вера Возвратная',
    isFemale: true,
    faction: Faction.SCIENTIST,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 90,
    maxHp: 90,
    money: 70,
    speed: 0.75,
    inventory: [
      { defId: 'lift_scheme', count: 1 },
      { defId: 'filtered_water', count: 1 },
      { defId: 'note', count: 2 },
    ],
    talkLines: [
      'Я записываю только возвраты. Выход туда без возврата - это уже не маршрут, а пропажа.',
      'Из нижних труб принесешь журнал давления. Не слух, не мокрую байку, а лист с цифрами.',
      'После доказательства я помечу доску: фильтр перед лифтом, воду не из канала, у трубы не стоять.',
      'Если вернулся без улики, тоже скажи. Иногда отсутствие бумаги честнее, чем чужая печать.',
    ],
    talkLinesPost: [
      'Журнал давления на доске. Нижний маршрут теперь помечен мокрым, бери фильтр до лифта.',
      'Люди читают короткое: вода грязная, у труб не стоять, один бинт мало. Этого достаточно.',
      'Следующий, кто пойдет вниз, хотя бы поймет, почему ты вернулся тяжелее, чем ушел.',
    ],
  },
};

registerSideQuest(ROUTE_KEEPER_ID, NPC_DEFS[ROUTE_KEEPER_ID], [
  {
    id: 'floor11_prepare_expedition_supplies',
    giverNpcId: ROUTE_KEEPER_ID,
    type: QuestType.FETCH,
    desc: 'Лида Маршрутная: «Принеси две бутылки воды перед лифтом. Выдам фильтр, маршрут и шесть патронов: вниз не ходят с пустым горлом.»',
    targetItem: 'water',
    targetCount: 2,
    rewardItem: 'gasmask_filter',
    rewardCount: 1,
    extraRewards: [{ defId: 'caravan_route', count: 1 }, { defId: 'ammo_9mm', count: 6 }],
    relationDelta: 10,
    xpReward: 35,
    moneyReward: 25,
  },
]);

registerSideQuest(REPAIR_ID, NPC_DEFS[REPAIR_ID], [
  {
    id: 'floor11_hermodoor_repair',
    giverNpcId: REPAIR_ID,
    type: QuestType.FETCH,
    desc: 'Аня Герма: «Нужен гермоуплотнитель для ближайшего укрытия. Принесешь - отдам комплект двери и тюбик герметика.»',
    targetItem: 'hermo_gasket',
    targetCount: 1,
    rewardItem: 'door_kit',
    rewardCount: 1,
    extraRewards: [{ defId: 'sealant_tube', count: 1 }, { defId: 'siren_instruction', count: 1 }],
    relationDelta: 14,
    xpReward: 45,
    moneyReward: 35,
  },
]);

registerSideQuest(LOST_ID, NPC_DEFS[LOST_ID], [
  {
    id: 'floor11_lost_property',
    giverNpcId: LOST_ID,
    type: QuestType.FETCH,
    desc: 'Миша Потеряшка: «Принеси бирку от ключа из чужого шкафа. Я верну детскую карту и талон на воду, а вещь перестанет искать хозяина.»',
    targetItem: 'container_key_label',
    targetCount: 1,
    rewardItem: 'child_map',
    rewardCount: 1,
    extraRewards: [{ defId: 'water_coupon', count: 1 }, { defId: 'bread', count: 1 }],
    relationDelta: 9,
    xpReward: 30,
    moneyReward: 15,
  },
]);

registerSideQuest(WITNESS_ID, NPC_DEFS[WITNESS_ID], [
  {
    id: 'floor11_return_evidence',
    giverNpcId: WITNESS_ID,
    type: QuestType.FETCH,
    desc: 'Вера Возвратная: «Принеси журнал давления с нижней вылазки. Я повешу его на доску возвратов: фильтр до лифта, вода не из канала.»',
    targetItem: 'pressure_logbook',
    targetCount: 1,
    rewardItem: 'lift_scheme',
    rewardCount: 1,
    extraRewards: [{ defId: 'filtered_water', count: 1 }, { defId: 'bandage', count: 1 }],
    relationDelta: 12,
    xpReward: 55,
    moneyReward: 55,
  },
]);

function areaClear(world: World, rx: number, ry: number): boolean {
  for (let dy = -1; dy <= ROOM_H; dy++) {
    for (let dx = -1; dx <= ROOM_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) return false;
    }
  }
  return true;
}

function findOrigin(world: World, zcx: number, zcy: number): { x: number; y: number } {
  const baseX = zcx - Math.floor(ROOM_W / 2);
  const baseY = zcy - Math.floor(ROOM_H / 2);
  for (let r = 0; r <= 88; r += 4) {
    for (let k = 0; k < 24; k++) {
      const a = ((k + 3) / 24) * Math.PI * 2;
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
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.PANEL;
      world.floorTex[ci] = Tex.F_LINO;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
  }

  const room: Room = {
    id: roomId,
    type: RoomType.HQ,
    x: rx,
    y: ry,
    w: ROOM_W,
    h: ROOM_H,
    doors: [],
    sealed: false,
    name: 'Пункт сборов вылазки',
    apartmentId: -1,
    wallTex: Tex.PANEL,
    floorTex: Tex.F_LINO,
  };
  world.rooms[roomId] = room;

  for (let dy = 0; dy < ROOM_H; dy++) {
    for (let dx = 0; dx < ROOM_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_LINO;
      world.roomMap[ci] = roomId;
    }
  }

  protectRoom(world, rx, ry, ROOM_W, ROOM_H, Tex.PANEL, Tex.F_LINO);
  return room;
}

function connectSouth(world: World, room: Room): void {
  const doorX = world.wrap(room.x + Math.floor(room.w / 2));
  const doorY = world.wrap(room.y + room.h);
  const doorI = world.idx(doorX, doorY);
  world.cells[doorI] = Cell.DOOR;
  world.floorTex[doorI] = room.floorTex;
  world.roomMap[doorI] = -1;
  world.doors.set(doorI, { idx: doorI, state: DoorState.CLOSED, roomA: room.id, roomB: -1, keyId: '', timer: 0 });
  room.doors.push(doorI);

  let cy = world.wrap(doorY + 1);
  for (let s = 0; s < 72; s++) {
    const ci = world.idx(doorX, cy);
    if (world.cells[ci] === Cell.FLOOR && !world.aptMask[ci]) break;
    if (!world.aptMask[ci] && world.cells[ci] !== Cell.LIFT) {
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

  for (const [dx, dy, feature] of [
    [1, 1, Feature.LAMP],
    [ROOM_W - 2, 1, Feature.LAMP],
    [Math.floor(ROOM_W / 2), ROOM_H - 2, Feature.LAMP],
    [3, 4, Feature.TABLE],
    [4, 4, Feature.CHAIR],
    [ROOM_W - 5, 4, Feature.MACHINE],
    [ROOM_W - 4, 4, Feature.APPARATUS],
    [Math.floor(ROOM_W / 2), 5, Feature.SCREEN],
    [Math.floor(ROOM_W / 2) - 2, 6, Feature.TABLE],
    [Math.floor(ROOM_W / 2) + 2, 6, Feature.TABLE],
  ] as const) {
    setFeature(world, rx + dx, ry + dy, feature);
  }

  world.wallTex[world.idx(rx + Math.floor(ROOM_W / 2), ry - 1)] = Tex.SCREEN_BASE + 6;
  world.wallTex[world.idx(rx + 2, ry - 1)] = Tex.POSTER_BASE + 41;
  world.wallTex[world.idx(rx + ROOM_W - 3, ry - 1)] = Tex.HINT_5;
  stampSurfaceSplat(world, rx + Math.floor(ROOM_W / 2), ry + 6, 0.5, 0.5, 5, 0.38, 11052, 55, 120, 130, false);
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

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function containerFeature(kind: ContainerKind): Feature {
  switch (kind) {
    case ContainerKind.TOOL_LOCKER:
    case ContainerKind.METAL_CABINET:
    case ContainerKind.WEAPON_CRATE:
    case ContainerKind.EMERGENCY_BOX:
      return Feature.SHELF;
    case ContainerKind.FILING_CABINET:
    case ContainerKind.CASHBOX:
      return Feature.DESK;
    default:
      return Feature.SHELF;
  }
}

function addPrepContainer(
  world: World,
  room: Room,
  dx: number,
  dy: number,
  kind: ContainerKind,
  name: string,
  access: ContainerAccess,
  inventory: WorldContainer['inventory'],
  tags: string[],
  owner?: Entity,
  faction?: Faction,
): void {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = containerFeature(kind);
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
    ownerNpcId: owner?.id,
    ownerName: owner?.name,
    faction,
    access,
    lockDifficulty: access === 'locked' ? 4 : undefined,
    discovered: true,
    tags: [CONTENT_TAG, 'living', 'expedition_prep', ...tags],
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
  weapon?: string,
): Entity {
  const existing = entities.find(e => e.alive && e.plotNpcId === plotNpcId);
  if (existing) return existing;
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  return requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle,
    weapon,
    canGiveQuest: true,
    aiTarget: { x, y },
  });
}

function seedRoom(world: World, room: Room, entities: Entity[], nextId: { v: number }, npcs: Entity[]): void {
  const [routeKeeper, repair, lost, witness] = npcs;
  addPrepContainer(
    world,
    room,
    2,
    2,
    ContainerKind.EMERGENCY_BOX,
    'Ящик контрольного набора',
    'public',
    [
      { defId: 'siren_instruction', count: 1 },
      { defId: 'water', count: 1 },
      { defId: 'bread', count: 1 },
      { defId: 'bandage', count: 1 },
      { defId: 'ammo_9mm', count: 4 },
    ],
    ['public', 'prep', 'loadout', 'checklist', 'samosbor'],
    routeKeeper,
    Faction.CITIZEN,
  );
  addPrepContainer(
    world,
    room,
    Math.floor(ROOM_W / 2),
    3,
    ContainerKind.FILING_CABINET,
    'Доска маршрутов у лифта',
    'public',
    [
      { defId: 'note', count: 1, data: CHECKLIST_NOTE },
      { defId: 'filter_receipt', count: 1 },
      { defId: 'water_coupon', count: 1 },
      { defId: 'siren_instruction', count: 1 },
    ],
    ['public', 'prep', 'route_lead', 'contract_board', 'checklist', 'documents'],
    routeKeeper,
    Faction.CITIZEN,
  );
  addPrepContainer(
    world,
    room,
    ROOM_W - 3,
    2,
    ContainerKind.TOOL_LOCKER,
    'Шкаф Ани с уплотнителями',
    'owner',
    [{ defId: 'sealant_tube', count: 1 }, { defId: 'fuse', count: 1 }, { defId: 'lamp_bulb', count: 1 }],
    ['tools', 'hermodoor'],
    repair,
    Faction.LIQUIDATOR,
  );
  addPrepContainer(
    world,
    room,
    2,
    ROOM_H - 3,
    ContainerKind.FILING_CABINET,
    'Картотека возвратов',
    'owner',
    [{ defId: 'caravan_route', count: 1 }, { defId: 'lift_scheme', count: 1 }, { defId: 'note', count: 2 }],
    ['route', 'paper', 'evidence'],
    witness,
    Faction.SCIENTIST,
  );
  addPrepContainer(
    world,
    room,
    ROOM_W - 3,
    ROOM_H - 3,
    ContainerKind.METAL_CABINET,
    'Шкаф потерянного имущества',
    'locked',
    [{ defId: 'child_map', count: 1 }, { defId: 'container_key_label', count: 1 }, { defId: 'cigs', count: 1 }],
    ['lost_property', 'locked'],
    lost,
    Faction.CITIZEN,
  );

  dropItem(entities, nextId, room.x + 5, room.y + ROOM_H - 3, 'siren_instruction');
  dropItem(entities, nextId, room.x + ROOM_W - 6, room.y + ROOM_H - 3, 'note');
}

function generateExpeditionPrep(
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
  placeLivingExpeditionCraftStations(world, room);

  const routeKeeper = spawnNpc(world, entities, nextId, room, ROUTE_KEEPER_ID, 4, 3, Math.PI / 2);
  const repair = spawnNpc(world, entities, nextId, room, REPAIR_ID, ROOM_W - 5, 3, Math.PI, 'wrench');
  const lost = spawnNpc(world, entities, nextId, room, LOST_ID, 5, ROOM_H - 4, -Math.PI / 2);
  const witness = spawnNpc(world, entities, nextId, room, WITNESS_ID, ROOM_W - 6, ROOM_H - 4, -Math.PI / 2);
  seedRoom(world, room, entities, nextId, [routeKeeper, repair, lost, witness]);

  genLog(`[FLOOR11] ${room.name} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId };
}

registerZoneContent(PREP_ZONE, 'Пункт сборов вылазки', generateExpeditionPrep);
