/* ── Expanded Ministry design-floor slice: route papers and clauses ─ */

import {
  Cell, ContainerKind, DoorState, EntityType, Faction, Feature, FloorLevel,
  MonsterKind, Occupation, QuestType, RoomType, Tex,
  type Entity, type Room, type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { storyNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { Spr } from '../../render/sprite_index';
import {
  type NextId, addItemDrop, createAdminRoom, setFeature, spawnAdminMonster,
  spawnAdminNpc,
} from '../admin_common';
import { genLog } from '../log';

const STORY_MINISTRY_NPC_HOME_FLOOR_KEY = storyNpcFloorKey(FloorLevel.MINISTRY);

export const DESIGN_FLOOR_ID = 'ministry' as const;

const ROOM_NAME = 'Бюро маршрутных бумаг';

const ROUTE_CLERK_DEF: PlotNpcDef = {
  name: 'Семен Маршрутный',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 120, maxHp: 120, money: 90, speed: 0.75,
  inventory: [
    { defId: 'official_permit_slip', count: 1 },
    { defId: 'caravan_route', count: 1 },
    { defId: 'note', count: 2 },
  ],
  talkLines: [
    'Маршрутный пропуск не открывает этаж. Он убеждает лифт, что вы не случайность.',
    'Шлюз принимает три довода: официальный корешок, чужой ключ из сейфа или тихий проход через боковую дверь.',
    'Печатеед чует ценные бумаги. Лишние документы лучше оставить в ящике или держать монстра на дистанции.',
  ],
  talkLinesPost: [
    'Маршрут внесен. Если лифт спорит, показывайте бумагу, а не страх.',
    'Ваш корешок уже ходит по журналу быстрее вас.',
  ],
};

const MARKET_INSPECTOR_DEF: PlotNpcDef = {
  name: 'Инспектор Контррынок',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.DIRECTOR,
  sprite: Occupation.DIRECTOR,
  hp: 260, maxHp: 260, money: 180, speed: 0.85,
  inventory: [
    { defId: 'denunciation', count: 1 },
    { defId: 'official_permit_slip', count: 1 },
    { defId: 'makarov', count: 1 },
  ],
  talkLines: [
    'Черный рынок 88 живет на бумаге, которую никто не предъявляет дважды.',
    'Отнесете постановление Марте Восьмой. Поможете проверке или предупредите рынок - журналу важен сам факт маршрута.',
    'Параграф бьет по прямой строке. Сбивайте линию шкафом, углом или дверью.',
  ],
  talkLinesPost: [
    'Рынок получил бумагу. Теперь он шумит тише, но дороже.',
    'Постановление ушло вниз. Значит, обратная бумага тоже придет.',
  ],
};

const SHELTER_COMMISSAR_DEF: PlotNpcDef = {
  name: 'Клавдия Укрытная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 130, maxHp: 130, money: 60, speed: 0.75,
  inventory: [
    { defId: 'emergency_roster', count: 1 },
    { defId: 'siren_instruction', count: 2 },
    { defId: 'water_coupon', count: 2 },
  ],
  talkLines: [
    'Список укрытия всегда длиннее комнаты. Моя работа - решить, чью фамилию пустят первой.',
    'Принесите список до сирены. Подделка спасает место, но потом ревизия ищет фамилию.',
    'Печатеед не любит пустые руки. Если несете список, не бегите с ним рядом с зубами.',
  ],
  talkLinesPost: [
    'Фамилия внесена карандашом. Карандаш пережил уже два самосбора.',
    'Если сирена начнется здесь, ищите дверь, а не справедливость.',
  ],
};

const LIFT_NOTARY_DEF: PlotNpcDef = {
  name: 'Нотарий Кабинный',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.DIRECTOR,
  sprite: Occupation.DIRECTOR,
  hp: 180, maxHp: 180, money: 220, speed: 0.7,
  inventory: [
    { defId: 'key', count: 1 },
    { defId: 'elevator_access_order', count: 1 },
    { defId: 'seal_wax', count: 1 },
  ],
  talkLines: [
    'Лифт признает подпись, печать и иногда выстрелы. Последнее я не заверяю.',
    'В задней строке завелся Параграф. Он стреляет поправками по открытой линии, поэтому не стойте в коридоре как заявление.',
    'Убейте или обойдите его - ордер доступа станет событием, а не слухом.',
  ],
  talkLinesPost: [
    'Кабина заверена. Не спорьте с кнопкой вслух.',
    'Параграф списан. Теперь строка опять просто строка, пока ее не прочли.',
  ],
};

registerFloorSideQuest(STORY_MINISTRY_NPC_HOME_FLOOR_KEY, 'ministry_route_clerk', ROUTE_CLERK_DEF, [
  {
    id: 'ministry_floor_pass',
    giverNpcId: 'ministry_route_clerk',
    type: QuestType.FETCH,
    desc: 'Семен Маршрутный: «Официальный корешок пропуска - и я выдам маршрутную бумагу. Она не отменит опасный этаж, но на посту будет что показать.»',
    targetItem: 'official_permit_slip', targetCount: 1,
    rewardItem: 'caravan_route', rewardCount: 1,
    extraRewards: [{ defId: 'key', count: 1 }, { defId: 'temp_pass', count: 1 }],
    relationDelta: 14, xpReward: 70, moneyReward: 60,
  },
]);

registerFloorSideQuest(STORY_MINISTRY_NPC_HOME_FLOOR_KEY, 'ministry_anti_market_inspector', MARKET_INSPECTOR_DEF, [
  {
    id: 'ministry_market_case',
    giverNpcId: 'ministry_anti_market_inspector',
    type: QuestType.TALK,
    desc: 'Инспектор Контррынок: «Отнесите постановление Марте Восьмой на рынок 88. Предупредите ее или прижмите - бумага все равно изменит маршрут торговли.»',
    targetNpcId: 'ag15_marta_broker',
    rewardItem: 'forged_permit_slip', rewardCount: 1,
    extraRewards: [{ defId: 'denunciation', count: 1 }],
    relationDelta: 8, xpReward: 85, moneyReward: 120,
  },
]);

registerFloorSideQuest(STORY_MINISTRY_NPC_HOME_FLOOR_KEY, 'ministry_shelter_commissar', SHELTER_COMMISSAR_DEF, [
  {
    id: 'ministry_shelter_list',
    giverNpcId: 'ministry_shelter_commissar',
    type: QuestType.FETCH,
    desc: 'Клавдия Укрытная: «Принесите список укрытия. Легально, украденный или переписанный - до сирены важнее место, чем почерк.»',
    targetItem: 'emergency_roster', targetCount: 1,
    rewardItem: 'hermodoor_journal', rewardCount: 1,
    extraRewards: [{ defId: 'water_coupon', count: 3 }, { defId: 'key', count: 1 }],
    relationDelta: 12, xpReward: 65, moneyReward: 45,
  },
]);

registerFloorSideQuest(STORY_MINISTRY_NPC_HOME_FLOOR_KEY, 'ministry_lift_notary', LIFT_NOTARY_DEF, [
  {
    id: 'ministry_monster_clause',
    giverNpcId: 'ministry_lift_notary',
    type: QuestType.KILL,
    desc: 'Нотарий Кабинный: «Зачистите один Параграф или Печатееда у задней строки. Параграф стреляет прямо, Печатеед идет на документы - пользуйтесь углами.»',
    targetMonsterKind: MonsterKind.PARAGRAPH,
    killNeeded: 1,
    rewardItem: 'elevator_access_order', rewardCount: 1,
    extraRewards: [{ defId: 'ammo_9mm', count: 12 }],
    relationDelta: 16, xpReward: 95, moneyReward: 100,
  },
]);

function addGateDoor(world: World, room: Room, gateX: number, y: number, state: DoorState, keyId: string): void {
  const doorIdx = world.idx(gateX, y);
  world.cells[doorIdx] = Cell.DOOR;
  world.wallTex[doorIdx] = Tex.DOOR_METAL;
  world.doors.set(doorIdx, {
    idx: doorIdx,
    state,
    roomA: room.id,
    roomB: room.id,
    keyId,
    timer: 0,
  });
  if (!room.doors.includes(doorIdx)) room.doors.push(doorIdx);
}

function addRouteGate(world: World, room: Room, gateX: number, centerY: number): void {
  for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
    const ci = world.idx(gateX, y);
    world.features[ci] = Feature.NONE;
    world.cells[ci] = Cell.WALL;
    world.wallTex[ci] = Tex.MARBLE;
  }
  addGateDoor(world, room, gateX, centerY, DoorState.LOCKED, 'key');
  addGateDoor(world, room, gateX, room.y + 2, DoorState.CLOSED, '');
}

function addReadableNote(entities: Entity[], nextId: NextId, x: number, y: number, text: string): void {
  entities.push({
    id: nextId.v++, type: EntityType.ITEM_DROP,
    x: x + 0.5, y: y + 0.5, angle: 0, pitch: 0,
    alive: true, speed: 0, sprite: Spr.ITEM_DROP,
    inventory: [{ defId: 'note', count: 1, data: { text } }],
  });
}

function addRouteContainer(
  world: World,
  room: Room,
  x: number,
  y: number,
  ownerNpcId: number,
  ownerName: string,
): void {
  const id = world.containers.reduce((mx, c) => Math.max(mx, c.id), 0) + 1;
  const container: WorldContainer = {
    id,
    x,
    y,
    floor: FloorLevel.MINISTRY,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind: ContainerKind.SAFE,
    name: 'Сейф маршрутных печатей',
    inventory: [
      { defId: 'key', count: 1 },
      { defId: 'official_permit_slip', count: 1 },
      { defId: 'emergency_roster', count: 1 },
      { defId: 'elevator_access_order', count: 1 },
    ],
    capacitySlots: 6,
    ownerNpcId,
    ownerName,
    faction: Faction.CITIZEN,
    access: 'owner',
    discovered: true,
    tags: ['ministry', 'design_floor', 'route_papers', 'access', 'theft'],
  };
  world.addContainer(container);
}

function decorateRouteOffice(world: World, room: Room, gateX: number, centerY: number): void {
  for (let x = room.x + 2; x < gateX - 1; x++) setFeature(world, x, room.y + 2, Feature.DESK);
  for (let x = room.x + 3; x < gateX - 1; x += 3) setFeature(world, x, room.y + 3, Feature.CHAIR);
  for (let y = room.y + 1; y < room.y + room.h - 1; y += 2) {
    setFeature(world, room.x + 1, y, Feature.SHELF);
    setFeature(world, room.x + room.w - 2, y, Feature.SHELF);
  }
  setFeature(world, gateX - 1, centerY, Feature.LAMP);
  setFeature(world, gateX + 2, centerY - 2, Feature.SCREEN);
  setFeature(world, gateX + 4, centerY + 2, Feature.LAMP);
  world.wallTex[world.idx(room.x + 7, room.y - 1)] = Tex.POSTER_BASE + 21;
  world.wallTex[world.idx(gateX + 5, room.y + room.h)] = Tex.PORTRAIT_BASE + 41;
}

export function runMinistryDesignFloorContent(
  world: World,
  entities: Entity[],
  nextRoomId: number,
  nextId: NextId,
  spawnX: number,
  spawnY: number,
): { nextRoomId: number } {
  const room = createAdminRoom(world, nextRoomId, spawnX, spawnY, {
    type: RoomType.OFFICE,
    name: ROOM_NAME,
    w: 23, h: 13,
    minDist: 95, maxDist: 210,
    wallTex: Tex.MARBLE,
    floorTex: Tex.F_MARBLE_TILE,
  });
  if (!room) return { nextRoomId };

  const centerY = room.y + Math.floor(room.h / 2);
  const gateX = room.x + 13;
  addRouteGate(world, room, gateX, centerY);
  decorateRouteOffice(world, room, gateX, centerY);

  addItemDrop(entities, nextId, room.x + 3, room.y + room.h - 2, 'official_permit_slip', 1);
  addItemDrop(entities, nextId, room.x + 5, room.y + room.h - 2, 'emergency_roster', 1);
  addItemDrop(entities, nextId, gateX + 2, room.y + 3, 'caravan_route', 1);
  addItemDrop(entities, nextId, gateX + 4, room.y + 3, 'siren_instruction', 1);
  addReadableNote(
    entities, nextId, gateX + 2, room.y + room.h - 3,
    'Печатеед идет на дорогую бумагу. Параграф стреляет по прямой строке: угол, шкаф, дверь.',
  );

  spawnAdminNpc(entities, nextId, ROUTE_CLERK_DEF, 'ministry_route_clerk', room.x + 3, room.y + 1);
  spawnAdminNpc(entities, nextId, MARKET_INSPECTOR_DEF, 'ministry_anti_market_inspector', room.x + 7, room.y + 1, true, 'makarov');
  spawnAdminNpc(entities, nextId, SHELTER_COMMISSAR_DEF, 'ministry_shelter_commissar', room.x + 4, centerY + 3);
  const notaryId = nextId.v;
  spawnAdminNpc(entities, nextId, LIFT_NOTARY_DEF, 'ministry_lift_notary', gateX - 2, centerY, true);

  addRouteContainer(world, room, gateX - 3, centerY + 2, notaryId, LIFT_NOTARY_DEF.name);
  spawnAdminMonster(world, entities, nextId, gateX + 4, centerY, MonsterKind.PARAGRAPH);
  spawnAdminMonster(world, entities, nextId, gateX + 5, centerY + 3, MonsterKind.PECHATEED);

  genLog(`[FLOOR05_MINISTRY] ${ROOM_NAME} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId: room.id + 1 };
}
