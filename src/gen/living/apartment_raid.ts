/* -- Living apartment raid: steal, fight, flee, or bargain ------- */

import {
  Cell, ContainerKind, DoorState, Faction, Feature,
  FloorLevel, Occupation, QuestType, RoomType, Tex,
  type ContainerAccess, type Entity, type GameState, type Room, type WorldContainer, type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { protectRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

const ZONE_HUD = 54;
const RAID_ROOM_W = 17;
const RAID_ROOM_H = 11;
const EXIT_ROOM_W = 9;
const EXIT_ROOM_H = 5;
const MODULE_TAG = 'living_apartment_raid';
const OUTCOME_TAG = 'living_apartment_raid_outcome';
const RAID_ROOM_NAME = 'Квартира коридорного налета';
const EXIT_ROOM_NAME = 'Коридорный выход рейда';

const RESIDENT_ID = 'ag61_mira_under_table';
const RUNNER_ID = 'ag61_vika_exit_runner';
const RAIDER_ID = 'ag61_stepan_nalet';
const LIQUIDATOR_ID = 'ag61_tamara_raid';

const QUEST_STEAL = 'ag61_steal_raid_list';
const QUEST_FLEE = 'ag61_flee_through_exit';
const QUEST_NEGOTIATE = 'ag61_pay_stepan_off';
const QUEST_FIGHT = 'ag61_stop_stepan_raid';
const CHOICE_QUESTS = [QUEST_STEAL, QUEST_FLEE, QUEST_NEGOTIATE, QUEST_FIGHT] as const;

interface RaidOutcome {
  choice: 'steal' | 'flee' | 'negotiate' | 'fight' | 'theft';
  targetName: string;
  tags: string[];
  rumorIds: string[];
  severity: 3 | 4 | 5;
  privacy: 'local' | 'public' | 'witnessed';
}

const QUEST_OUTCOMES: Record<string, RaidOutcome> = {
  [QUEST_STEAL]: {
    choice: 'steal',
    targetName: 'Список квартир вынесли из сумки налетчиков',
    tags: ['steal', 'evidence'],
    rumorIds: ['container_theft_seen'],
    severity: 4,
    privacy: 'local',
  },
  [QUEST_FLEE]: {
    choice: 'flee',
    targetName: 'Запасной коридорный выход проверен без драки',
    tags: ['flee', 'non_combat'],
    rumorIds: ['player_quest_chain'],
    severity: 3,
    privacy: 'local',
  },
  [QUEST_NEGOTIATE]: {
    choice: 'negotiate',
    targetName: 'Налетчики взяли отступные и отложили рейд',
    tags: ['negotiate', 'payoff'],
    rumorIds: ['player_quest_chain'],
    severity: 4,
    privacy: 'local',
  },
  [QUEST_FIGHT]: {
    choice: 'fight',
    targetName: 'Главарь квартирного налета убит',
    tags: ['fight', 'violence'],
    rumorIds: ['player_hurt_remembered'],
    severity: 5,
    privacy: 'public',
  },
};

function otherChoices(id: string): string[] {
  return CHOICE_QUESTS.filter(choiceId => choiceId !== id);
}

const MIRA: PlotNpcDef = {
  name: 'Мира Под Столом',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.HOUSEWIFE,
  sprite: Occupation.HOUSEWIFE,
  hp: 70, maxHp: 70, money: 9, speed: 0.75,
  inventory: [{ defId: 'bread', count: 1 }, { defId: 'sealed_complaint', count: 1 }],
  talkLines: [
    'Они вошли как соседи, только сразу спросили, где вода и кто еще дома.',
    'В сумке у главного список квартир. Если вынести список, они не поймут, кого брать следующим.',
    'Можно стрелять. Можно платить. Можно просто найти выход. Только не стой в дверях.',
  ],
  talkLinesPost: [
    'Список уже не у них. Теперь хотя бы следующий адрес молчит.',
    'Не называй это спасением. Просто сегодня дверь закрылась раньше.',
  ],
};

const VIKA: PlotNpcDef = {
  name: 'Вика У Выхода',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.CHILD,
  sprite: Occupation.CHILD,
  hp: 50, maxHp: 50, money: 0, speed: 1.0,
  inventory: [{ defId: 'water_coupon', count: 1 }],
  talkLines: [
    'Там за шкафом короткий коридор. Если он открыт, можно уйти, пока взрослые спорят.',
    'Я не хочу, чтобы кто-то стрелял. Я хочу знать, что дверь с той стороны не стала стеной.',
  ],
  talkLinesPost: [
    'Выход есть. Значит, можно дышать тише.',
    'Я запомнила: иногда победа - это не оставаться в комнате.',
  ],
};

const STEPAN: PlotNpcDef = {
  name: 'Степан Налет',
  isFemale: false,
  faction: Faction.WILD,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 135, maxHp: 135, money: 31, speed: 1.0,
  weapon: 'pipe',
  inventory: [{ defId: 'pipe', count: 1 }, { defId: 'cigs', count: 2 }],
  talkLines: [
    'Не геройствуй. Двадцать два рубля - и я делаю вид, что квартира уже пустая.',
    'Сумку не трогать. В сумке адреса, а адреса кормят лучше хлеба.',
    'Драться можно. Только потом никто не будет спорить, кто начал.',
  ],
  talkLinesPost: [
    'Деньги взял. Сегодня эта дверь нам не нужна.',
    'Скажи своим, что торговаться дешевле, чем хоронить мебель.',
  ],
};

const TAMARA: PlotNpcDef = {
  name: 'Тамара Рейдовая',
  isFemale: true,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 145, maxHp: 145, money: 24, speed: 1.0,
  weapon: 'makarov',
  inventory: [{ defId: 'makarov', count: 1 }, { defId: 'ammo_9mm', count: 8 }],
  talkLines: [
    'Главный с трубой держит список. Уберешь его - рейд распадется на беготню.',
    'Можно договориться. Можно вывести людей. Я предлагаю самый короткий отчет.',
    'Если полезешь в сумку, делай это до выстрелов. После выстрелов все бумаги становятся уликами.',
  ],
  talkLinesPost: [
    'Главарь лежит, список больше никого не ведет. Рейд закрыт грязно, но закрыт.',
    'Не путай порядок с тишиной. Тут просто стало меньше команд.',
  ],
};

registerSideQuest(RESIDENT_ID, MIRA, [{
  id: QUEST_STEAL,
  giverNpcId: RESIDENT_ID,
  type: QuestType.FETCH,
  desc: 'Мира Под Столом: «Укради из сумки налетчиков жалобу со списком квартир. Без списка они не поймут, куда идти дальше.»',
  targetItem: 'neighbor_complaint', targetCount: 1,
  rewardItem: 'water_coupon', rewardCount: 1,
  extraRewards: [{ defId: 'bandage', count: 1 }],
  relationDelta: 7, xpReward: 35, moneyReward: 12,
  blockedBySideQuestIds: otherChoices(QUEST_STEAL),
  abandonsSideQuestIds: otherChoices(QUEST_STEAL),
  failOnNpcDeathPlotId: RESIDENT_ID,
  eventTags: [MODULE_TAG, 'raid_choice', 'steal'],
  eventData: { raidChoice: 'steal', rumorIds: ['container_theft_seen'] },
  eventTargetName: 'Список квартир вынесли из сумки налетчиков.',
  eventSeverity: 4,
  eventPrivacy: 'local',
}]);

registerSideQuest(RUNNER_ID, VIKA, [{
  id: QUEST_FLEE,
  giverNpcId: RUNNER_ID,
  type: QuestType.VISIT,
  desc: 'Вика У Выхода: «Проверь запасной коридорный выход {dir}. Если путь живой, можно уйти без драки.»',
  targetRoomName: EXIT_ROOM_NAME,
  rewardItem: 'bread', rewardCount: 1,
  extraRewards: [{ defId: 'water', count: 1 }],
  relationDelta: 5, xpReward: 25,
  blockedBySideQuestIds: otherChoices(QUEST_FLEE),
  abandonsSideQuestIds: otherChoices(QUEST_FLEE),
  eventTags: [MODULE_TAG, 'raid_choice', 'flee'],
  eventData: { raidChoice: 'flee', rumorIds: ['player_quest_chain'] },
  eventTargetName: 'Запасной выход квартирного рейда проверен.',
  eventSeverity: 3,
  eventPrivacy: 'local',
}]);

registerSideQuest(RAIDER_ID, STEPAN, [{
  id: QUEST_NEGOTIATE,
  giverNpcId: RAIDER_ID,
  type: QuestType.FETCH,
  desc: 'Степан Налет: «Двадцать два рубля за тишину. Платишь - мы уходим позже и не с этой двери.»',
  targetItem: 'money', targetCount: 22,
  relationDelta: 3, xpReward: 20,
  blockedBySideQuestIds: otherChoices(QUEST_NEGOTIATE),
  abandonsSideQuestIds: otherChoices(QUEST_NEGOTIATE),
  failOnNpcDeathPlotId: RAIDER_ID,
  eventTags: [MODULE_TAG, 'raid_choice', 'negotiate'],
  eventData: { raidChoice: 'negotiate', rumorIds: ['player_quest_chain'] },
  eventTargetName: 'Квартирный рейд отложили за отступные.',
  eventSeverity: 4,
  eventPrivacy: 'local',
}]);

registerSideQuest(LIQUIDATOR_ID, TAMARA, [{
  id: QUEST_FIGHT,
  giverNpcId: LIQUIDATOR_ID,
  type: QuestType.KILL,
  desc: 'Тамара Рейдовая: «Убей Степана Налета. Без главаря его люди побегут по коридору, а не по квартирам.»',
  targetPlotNpcId: RAIDER_ID,
  killNeeded: 1,
  rewardItem: 'ammo_9mm', rewardCount: 8,
  extraRewards: [{ defId: 'liquidator_token', count: 1 }],
  relationDelta: 9, xpReward: 45, moneyReward: 28,
  blockedBySideQuestIds: otherChoices(QUEST_FIGHT),
  abandonsSideQuestIds: otherChoices(QUEST_FIGHT),
  eventTags: [MODULE_TAG, 'raid_choice', 'fight'],
  eventData: { raidChoice: 'fight', rumorIds: ['player_hurt_remembered'] },
  eventTargetName: 'Главарь квартирного налета убит.',
  eventSeverity: 5,
  eventPrivacy: 'public',
}]);

function publishRaidOutcome(state: GameState, event: WorldEvent, outcome: RaidOutcome): void {
  publishEvent(state, {
    type: 'faction_relation_changed',
    floor: FloorLevel.LIVING,
    zoneId: event.zoneId,
    roomId: event.roomId,
    x: event.x,
    y: event.y,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetId: event.targetId,
    targetName: outcome.targetName,
    targetFaction: event.targetFaction,
    itemId: event.itemId,
    itemName: event.itemName,
    itemCount: event.itemCount,
    containerId: event.containerId,
    containerOwnerId: event.containerOwnerId,
    containerFaction: event.containerFaction,
    severity: outcome.severity,
    privacy: outcome.privacy,
    tags: [OUTCOME_TAG, MODULE_TAG, 'raid', 'faction_event', ...outcome.tags],
    data: {
      sourceEventId: event.id,
      raidChoice: outcome.choice,
      rumorIds: outcome.rumorIds,
    },
  });
}

function handleRaidEvents(state: GameState, event: WorldEvent): void {
  if (event.tags.includes(OUTCOME_TAG)) return;
  if (event.type === 'quest_completed') {
    const sideQuestId = typeof event.data?.sideQuestId === 'string' ? event.data.sideQuestId : '';
    const outcome = QUEST_OUTCOMES[sideQuestId];
    if (outcome) publishRaidOutcome(state, event, outcome);
    return;
  }
  if (event.type !== 'item_stolen' || !event.tags.includes(MODULE_TAG)) return;
  const witnessed = event.tags.includes('witnessed');
  publishRaidOutcome(state, event, {
    choice: 'theft',
    targetName: witnessed ? 'Кражу из сумки налетчиков заметили' : 'Сумка налетчиков недосчиталась вещей',
    tags: ['steal', 'theft'],
    rumorIds: ['container_theft_seen'],
    severity: witnessed ? 5 : 4,
    privacy: witnessed ? 'witnessed' : 'local',
  });
}

registerWorldEventObserver(handleRaidEvents);

function footprintClear(world: World, rx: number, ry: number): boolean {
  const footprintW = RAID_ROOM_W + 2;
  const footprintH = RAID_ROOM_H + EXIT_ROOM_H + 3;
  for (let dy = -1; dy <= footprintH; dy++) {
    for (let dx = -1; dx <= footprintW; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) return false;
    }
  }
  return true;
}

function findOrigin(world: World, zcx: number, zcy: number): { x: number; y: number } {
  const baseX = zcx - Math.floor(RAID_ROOM_W / 2);
  const baseY = zcy - Math.floor((RAID_ROOM_H + EXIT_ROOM_H + 1) / 2);
  for (let r = 4; r <= 76; r += 4) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2 + 0.31;
      const x = world.wrap(baseX + Math.round(Math.cos(a) * r));
      const y = world.wrap(baseY + Math.round(Math.sin(a) * r));
      if (footprintClear(world, x, y)) return { x, y };
    }
  }
  return { x: world.wrap(baseX), y: world.wrap(baseY) };
}

function carveRoom(
  world: World,
  roomId: number,
  rx: number,
  ry: number,
  w: number,
  h: number,
  name: string,
  type: RoomType,
): Room {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
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
    type,
    x: rx,
    y: ry,
    w,
    h,
    name,
    wallTex: Tex.PANEL,
    floorTex: Tex.F_LINO,
    doors: [],
    sealed: false,
    apartmentId: -1,
  };
  world.rooms[roomId] = room;

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_LINO;
      world.roomMap[ci] = roomId;
    }
  }

  protectRoom(world, rx, ry, w, h, Tex.PANEL, Tex.F_LINO);
  return room;
}

function addDoor(world: World, room: Room, x: number, y: number, state = DoorState.CLOSED, roomB = -1): void {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.DOOR;
  world.floorTex[ci] = Tex.F_LINO;
  world.roomMap[ci] = -1;
  world.doors.set(ci, { idx: ci, state, roomA: room.id, roomB, keyId: '', timer: 0 });
  room.doors.push(ci);
}

function connectRooms(world: World, raidRoom: Room, exitRoom: Room): void {
  const doorX = world.wrap(raidRoom.x + Math.floor(raidRoom.w / 2));
  const doorY = world.wrap(raidRoom.y + raidRoom.h);
  addDoor(world, raidRoom, doorX, doorY, DoorState.CLOSED, exitRoom.id);
  exitRoom.doors.push(world.idx(doorX, doorY));
}

function connectExitToMaze(world: World, exitRoom: Room): void {
  const doorX = world.wrap(exitRoom.x + Math.floor(exitRoom.w / 2));
  const doorY = world.wrap(exitRoom.y + exitRoom.h);
  addDoor(world, exitRoom, doorX, doorY);

  let cy = world.wrap(doorY + 1);
  for (let s = 0; s < 80; s++) {
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

function decorateRaidRoom(world: World, room: Room): void {
  const rx = room.x;
  const ry = room.y;
  world.features[world.idx(rx + 2, ry + 2)] = Feature.TABLE;
  world.features[world.idx(rx + 3, ry + 2)] = Feature.CHAIR;
  world.features[world.idx(rx + 2, ry + 7)] = Feature.BED;
  world.features[world.idx(rx + 3, ry + 7)] = Feature.BED;
  world.features[world.idx(rx + 6, ry + 1)] = Feature.SHELF;
  world.features[world.idx(rx + 7, ry + 1)] = Feature.SHELF;
  world.features[world.idx(rx + 11, ry + 3)] = Feature.DESK;
  world.features[world.idx(rx + 12, ry + 3)] = Feature.DESK;
  world.features[world.idx(rx + 13, ry + 7)] = Feature.CHAIR;
  world.features[world.idx(rx + 1, ry + 1)] = Feature.LAMP;
  world.features[world.idx(rx + RAID_ROOM_W - 2, ry + 1)] = Feature.LAMP;
}

function decorateExitRoom(world: World, room: Room): void {
  world.features[world.idx(room.x + 1, room.y + 1)] = Feature.SHELF;
  world.features[world.idx(room.x + 2, room.y + 1)] = Feature.SHELF;
  world.features[world.idx(room.x + room.w - 3, room.y + 2)] = Feature.CHAIR;
  world.features[world.idx(room.x + room.w - 2, room.y + 2)] = Feature.CHAIR;
  world.features[world.idx(room.x + Math.floor(room.w / 2), room.y + room.h - 2)] = Feature.LAMP;
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addRaidContainer(
  world: World,
  room: Room,
  dx: number,
  dy: number,
  name: string,
  kind: ContainerKind,
  access: ContainerAccess,
  inventory: WorldContainer['inventory'],
  tags: string[],
  owner?: Entity,
  faction = Faction.CITIZEN,
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
    inventory: inventory.map(item => ({ ...item })),
    capacitySlots: Math.max(7, inventory.length + 3),
    ownerNpcId: owner?.id,
    ownerName: owner?.name,
    faction,
    access,
    discovered: true,
    tags: [MODULE_TAG, 'raid', ...tags],
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
): Entity {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  return requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle,
    canGiveQuest,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
  });
}

function seedContainers(world: World, raidRoom: Room, exitRoom: Room, resident: Entity, raider: Entity): void {
  addRaidContainer(
    world, raidRoom, 5, 2, 'Сумка налетчиков со списком',
    ContainerKind.SECRET_STASH, 'owner',
    [
      { defId: 'neighbor_complaint', count: 1 },
      { defId: 'forged_ration_card', count: 1 },
      { defId: 'water_coupon', count: 1 },
      { defId: 'cigs', count: 2 },
    ],
    ['theft', 'raid_list', 'contraband', 'evidence'],
    raider,
    Faction.WILD,
  );
  addRaidContainer(
    world, raidRoom, 2, 8, 'Тумбочка жильцов под простыней',
    ContainerKind.WOODEN_CHEST, 'owner',
    [
      { defId: 'bread', count: 2 },
      { defId: 'water', count: 1 },
      { defId: 'sealed_complaint', count: 1 },
    ],
    ['resident_stock', 'theft'],
    resident,
    Faction.CITIZEN,
  );
  addRaidContainer(
    world, exitRoom, EXIT_ROOM_W - 3, 1, 'Аварийная коробка у выхода',
    ContainerKind.EMERGENCY_BOX, 'public',
    [
      { defId: 'bandage', count: 1 },
      { defId: 'water', count: 1 },
    ],
    ['flee', 'public', 'samosbor'],
  );
}

function generateApartmentRaid(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zcx: number,
  zcy: number,
): { nextRoomId: number } {
  const pos = findOrigin(world, zcx, zcy);
  const raidRoom = carveRoom(world, nextRoomId++, pos.x, pos.y, RAID_ROOM_W, RAID_ROOM_H, RAID_ROOM_NAME, RoomType.LIVING);
  const exitX = world.wrap(pos.x + 4);
  const exitY = world.wrap(pos.y + RAID_ROOM_H + 1);
  const exitRoom = carveRoom(world, nextRoomId++, exitX, exitY, EXIT_ROOM_W, EXIT_ROOM_H, EXIT_ROOM_NAME, RoomType.CORRIDOR);
  connectRooms(world, raidRoom, exitRoom);
  connectExitToMaze(world, exitRoom);
  decorateRaidRoom(world, raidRoom);
  decorateExitRoom(world, exitRoom);

  const resident = spawnNpc(world, entities, nextId, raidRoom, RESIDENT_ID, 3, 5, 0, true);
  spawnNpc(world, entities, nextId, raidRoom, RUNNER_ID, 4, 8, 0, true);
  const raider = spawnNpc(world, entities, nextId, raidRoom, RAIDER_ID, RAID_ROOM_W - 5, 4, Math.PI, true);
  spawnNpc(world, entities, nextId, exitRoom, LIQUIDATOR_ID, EXIT_ROOM_W - 3, 2, Math.PI, true);
  seedContainers(world, raidRoom, exitRoom, resident, raider);
  world.bakeLights();

  genLog(`[AG61] ${RAID_ROOM_NAME} at (${pos.x}, ${pos.y}) room #${raidRoom.id}; zone ${ZONE_HUD}`);
  return { nextRoomId };
}

registerZoneContent(ZONE_HUD, RAID_ROOM_NAME, generateApartmentRaid);
