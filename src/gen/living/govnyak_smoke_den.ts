/* -- Govnyak smoke den: finite stock, debt pressure, witnesses ---- */

import {
  Cell, ContainerKind, DoorState, Faction, Feature,
  FloorLevel, Occupation, QuestType, RoomType, Tex,
  type ContainerAccess, type Entity, type GameState, type Room, type WorldContainer, type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { ITEMS } from '../../data/items';
import { changeResourceStock } from '../../systems/economy';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { protectRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

const DEN_ZONE = 37;
const ROOM_W = 17;
const ROOM_H = 10;
const MODULE_TAG = 'govnyak_den';
const OUTCOME_EVENT_TAG = 'ag97_govnyak_outcome';

interface DenEconomyDelta {
  resourceId: string;
  count: number;
  floor: FloorLevel;
}

interface DenOutcome {
  targetName: string;
  outcome: string;
  denState: 'cleared' | 'left_open' | 'pressured';
  tags: string[];
  rumorIds: string[];
  severity: 3 | 4 | 5;
  privacy: 'local' | 'public' | 'witnessed';
  itemId?: string;
  itemCount?: number;
  economyDeltas: readonly DenEconomyDelta[];
}

const QUEST_OUTCOMES: Record<string, DenOutcome> = {
  ag97_buy_cash: {
    targetName: 'Покупка в дымной комнате оплачена без записи долга',
    outcome: 'purchase',
    denState: 'left_open',
    tags: ['purchase', 'trade', 'left_open'],
    rumorIds: ['event_govnyak_den_purchase', 'lead_living_govnyak_smoke_den'],
    severity: 3,
    privacy: 'local',
    itemId: 'govnyak_roll',
    itemCount: 3,
    economyDeltas: [{ resourceId: 'contraband', count: -3, floor: FloorLevel.LIVING }],
  },
  ag97_settle_debt: {
    targetName: 'Чужой долг в дымной комнате закрыт деньгами',
    outcome: 'debt_settled',
    denState: 'left_open',
    tags: ['debt', 'settled', 'protect', 'left_open'],
    rumorIds: ['event_govnyak_den_debt'],
    severity: 4,
    privacy: 'local',
    itemId: 'voluntary_receipt',
    itemCount: 1,
    economyDeltas: [
      { resourceId: 'contraband', count: -1, floor: FloorLevel.LIVING },
      { resourceId: 'documents', count: 1, floor: FloorLevel.LIVING },
    ],
  },
  ag97_refuse_credit: {
    targetName: 'Должника вывели из кредитного дыма разговором',
    outcome: 'refusal_protection',
    denState: 'left_open',
    tags: ['refuse', 'protect', 'non_combat', 'left_open'],
    rumorIds: ['event_govnyak_den_refusal'],
    severity: 4,
    privacy: 'local',
    economyDeltas: [{ resourceId: 'contraband', count: -1, floor: FloorLevel.LIVING }],
  },
  ag97_report_den: {
    targetName: 'Дымная комната сдана по ведомости ликвидаторам',
    outcome: 'reported',
    denState: 'cleared',
    tags: ['report', 'liquidator', 'den_cleared'],
    rumorIds: ['event_govnyak_den_report'],
    severity: 5,
    privacy: 'public',
    itemId: 'denunciation',
    itemCount: 1,
    economyDeltas: [
      { resourceId: 'contraband', count: -5, floor: FloorLevel.LIVING },
      { resourceId: 'documents', count: 1, floor: FloorLevel.MINISTRY },
    ],
  },
  ag97_turn_dealer_science: {
    targetName: 'Дилера перевели под научный учет вместо рейда',
    outcome: 'turned_to_science',
    denState: 'cleared',
    tags: ['turn_dealer', 'science', 'non_combat', 'den_cleared'],
    rumorIds: ['event_govnyak_den_report', 'event_govnyak_den_debt'],
    severity: 4,
    privacy: 'public',
    itemId: 'voluntary_receipt',
    itemCount: 1,
    economyDeltas: [
      { resourceId: 'contraband', count: -4, floor: FloorLevel.LIVING },
      { resourceId: 'slime_samples', count: 1, floor: FloorLevel.LIVING },
    ],
  },
};

function economyDeltaSummary(outcome: DenOutcome): string[] {
  const out: string[] = [];
  for (const delta of outcome.economyDeltas) {
    out.push(`${delta.floor}:${delta.resourceId}${delta.count >= 0 ? '+' : ''}${delta.count}`);
  }
  return out;
}

function applyDenEconomy(state: GameState, outcome: DenOutcome, event: WorldEvent): string[] {
  const applied: string[] = [];
  for (const delta of outcome.economyDeltas) {
    if (!changeResourceStock(state, delta.resourceId, delta.count, delta.floor, {
      zoneId: event.zoneId,
      roomId: event.roomId,
      reason: `govnyak_den_${outcome.outcome}`,
      tags: [MODULE_TAG, 'govnyak', 'contraband', outcome.outcome],
    })) continue;
    applied.push(`${delta.floor}:${delta.resourceId}${delta.count >= 0 ? '+' : ''}${delta.count}`);
  }
  return applied;
}

function publishDenOutcome(state: GameState, event: WorldEvent, sideQuestId: string, outcome: DenOutcome): void {
  const appliedEconomyDeltas = applyDenEconomy(state, outcome, event);
  const itemId = outcome.itemId ?? event.itemId;
  const itemDef = itemId ? ITEMS[itemId] : undefined;
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
    targetName: outcome.targetName,
    itemId,
    itemName: itemDef?.name,
    itemCount: outcome.itemCount,
    itemValue: itemDef?.value,
    severity: outcome.severity,
    privacy: outcome.privacy,
    tags: [OUTCOME_EVENT_TAG, MODULE_TAG, 'faction_event', ...outcome.tags],
    data: {
      sourceEventId: event.id,
      sideQuestId,
      govnyakOutcome: outcome.outcome,
      denState: outcome.denState,
      economyDeltas: appliedEconomyDeltas.length > 0 ? appliedEconomyDeltas : economyDeltaSummary(outcome),
      rumorIds: outcome.rumorIds,
    },
  });
}

function handleGovnyakOutcome(state: GameState, event: WorldEvent): void {
  if (event.tags.includes(OUTCOME_EVENT_TAG)) return;
  if (event.type === 'quest_completed') {
    const sideQuestId = typeof event.data?.sideQuestId === 'string' ? event.data.sideQuestId : '';
    const outcome = QUEST_OUTCOMES[sideQuestId];
    if (outcome) publishDenOutcome(state, event, sideQuestId, outcome);
    return;
  }
  if (event.type !== 'item_stolen' || !event.tags.includes(MODULE_TAG)) return;
  const witnessed = event.tags.includes('witnessed');
  const economyDeltas = changeResourceStock(state, 'contraband', -1, FloorLevel.LIVING, {
    zoneId: event.zoneId,
    roomId: event.roomId,
    reason: 'govnyak_den_theft',
    tags: [MODULE_TAG, 'govnyak', 'contraband', 'theft'],
  }) ? [`${FloorLevel.LIVING}:contraband-1`] : [];
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
    targetName: witnessed ? event.targetName : 'Ревизия дымной комнаты',
    targetFaction: event.targetFaction,
    itemId: event.itemId,
    itemName: event.itemName,
    itemCount: event.itemCount,
    containerId: event.containerId,
    containerOwnerId: event.containerOwnerId,
    containerFaction: event.containerFaction,
    severity: witnessed ? 5 : 4,
    privacy: witnessed ? 'witnessed' : 'local',
    tags: [OUTCOME_EVENT_TAG, MODULE_TAG, 'faction_event', 'theft', 'debt', 'left_open'],
    data: {
      sourceEventId: event.id,
      govnyakOutcome: 'theft',
      denState: 'pressured',
      economyDeltas,
      rumorIds: ['event_govnyak_den_theft', 'lead_living_govnyak_smoke_den'],
    },
  });
}

registerWorldEventObserver(handleGovnyakOutcome);

const TROFIM: PlotNpcDef = {
  name: 'Трофим Дымарь',
  isFemale: false,
  faction: Faction.WILD,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 120, maxHp: 120, money: 76, speed: 0.8,
  inventory: [{ defId: 'govnyak_roll', count: 6 }, { defId: 'cigs', count: 2 }, { defId: 'tea', count: 1 }],
  talkLines: [
    'Тут не отдыхают. Тут платят за пять минут без вопросов из коридора.',
    'Берешь за деньги - уходишь без фамилии в тетради. Берешь в долг - фамилия остается тут.',
    'Курить никто не заставляет. Отказ дешевле любой затяжки.',
    'Ящик трогают только мои руки. Остальные руки потом показывают свидетелям.',
  ],
  talkLinesPost: [
    'Сегодня без записи долга. Это не милость, просто касса сошлась.',
    'Если пришел отказаться, дверь там же. За отказ денег не берут.',
  ],
};

const PAVEL: PlotNpcDef = {
  name: 'Павел Подзалог',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.ALCOHOLIC,
  sprite: Occupation.ALCOHOLIC,
  hp: 70, maxHp: 70, money: 1, speed: 0.75,
  inventory: [{ defId: 'voluntary_receipt', count: 1 }],
  talkLines: [
    'Я не курил для веселья. Я хотел перестать слышать детей за стеной.',
    'Тридцать шесть рублей - это не цена. Это повод прийти за мной вечером.',
    'Если кто-то скажет уйти сейчас, я уйду. Только скажите громко, при свидетелях.',
  ],
  talkLinesPost: [
    'Долг закрыт или хотя бы назван вслух. В груди все равно дымно.',
    'Я пойду к соседям. Здесь даже молчание стоит денег.',
  ],
};

const KLAVA: PlotNpcDef = {
  name: 'Клава Свидетельница',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 85, maxHp: 85, money: 18, speed: 0.9,
  inventory: [{ defId: 'neighbor_complaint', count: 1 }, { defId: 'note', count: 2 }],
  talkLines: [
    'Я сижу у двери не из любопытства. Кто-то должен помнить, кто вошел без долга.',
    'Павел еще может уйти. Ему нужен голос со стороны, не геройство.',
    'Можно просто отказаться и вывести человека. Это тоже решение.',
    'Если полезешь в коробку, знай: я видела, где она стоит.',
  ],
  talkLinesPost: [
    'Он вышел. Комната осталась, но один человек не лег в тетрадь.',
    'Слух пошел тихий. Такой иногда лучше выстрела.',
  ],
};

const MARKOV: PlotNpcDef = {
  name: 'Маркелов из рейда',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 145, maxHp: 145, money: 42, speed: 1.0,
  inventory: [{ defId: 'ammo_9mm', count: 8 }, { defId: 'bandage', count: 1 }],
  talkLines: [
    'Без бумаги это дым. С бумагой это точка рейда.',
    'Принесешь донос или расписку - я закрою комнату без стрельбы.',
    'Должников жалеть можно. Тетради - нельзя.',
    'Если купил сам, не рассказывай мне как о подвиге.',
  ],
  talkLinesPost: [
    'Комната в ведомости. Кто был внутри, теперь говорит тише.',
    'Рейд без стрельбы - редкость. Не делай из нее праздник.',
  ],
};

const RITA: PlotNpcDef = {
  name: 'Рита Лаборантка',
  isFemale: true,
  faction: Faction.SCIENTIST,
  occupation: Occupation.SCIENTIST,
  sprite: Occupation.SCIENTIST,
  hp: 90, maxHp: 90, money: 58, speed: 0.9,
  inventory: [{ defId: 'clean_health_cert', count: 1 }, { defId: 'antidep', count: 1 }],
  talkLines: [
    'Нам нужен не дым, а ведомость: кто продает, кому должен, кто кашляет после.',
    'Если отдашь расписку мне, Трофим станет образцом под наблюдением, а не поводом для рейда.',
    'Это не оправдание. Это способ убрать давление без драки в коридоре.',
    'Запас конечный. Люди почему-то ведут себя так, будто конечные только другие.',
  ],
  talkLinesPost: [
    'Ведомость у нас. Дымная комната уже не рынок, а протокол.',
    'Павлу дадут воду и осмотр. Трофиму - учет. Лучше, чем ночной рейд.',
  ],
};

registerSideQuest('ag97_trofim_dymar', TROFIM, [{
  id: 'ag97_buy_cash',
  giverNpcId: 'ag97_trofim_dymar',
  type: QuestType.FETCH,
  desc: 'Трофим Дымарь: «Двадцать четыре рубля сразу - три самокрута без записи в тетрадь. Не куришь - просто уйди.»',
  targetItem: 'money', targetCount: 24,
  rewardItem: 'govnyak_roll', rewardCount: 3,
  relationDelta: 2, xpReward: 10,
}]);

registerSideQuest('ag97_pavel_podzalog', PAVEL, [{
  id: 'ag97_settle_debt',
  giverNpcId: 'ag97_pavel_podzalog',
  type: QuestType.FETCH,
  desc: 'Павел Подзалог: «Закрой мои тридцать шесть рублей. Я уйду отсюда без новой записи.»',
  targetItem: 'money', targetCount: 36,
  rewardItem: 'voluntary_receipt', rewardCount: 1,
  extraRewards: [{ defId: 'bread', count: 1 }, { defId: 'water', count: 1 }],
  relationDelta: 10, xpReward: 30,
}]);

registerSideQuest('ag97_klava_witness', KLAVA, [{
  id: 'ag97_refuse_credit',
  giverNpcId: 'ag97_klava_witness',
  type: QuestType.TALK,
  desc: 'Клава Свидетельница: «Скажи Павлу при людях: не бери в долг, выходи сейчас. Он {dir}.»',
  targetPlotNpcId: 'ag97_pavel_podzalog',
  rewardItem: 'neighbor_complaint', rewardCount: 1,
  extraRewards: [{ defId: 'water', count: 1 }],
  relationDelta: 9, xpReward: 25,
}]);

registerSideQuest('ag97_markov_report', MARKOV, [{
  id: 'ag97_report_den',
  giverNpcId: 'ag97_markov_report',
  type: QuestType.FETCH,
  desc: 'Маркелов из рейда: «Нужен донос из долговой кассы. С бумагой закроем без стрельбы.»',
  targetItem: 'denunciation', targetCount: 1,
  rewardItem: 'ammo_9mm', rewardCount: 10,
  extraRewards: [{ defId: 'bandage', count: 1 }],
  relationDelta: 12, xpReward: 45, moneyReward: 50,
}]);

registerSideQuest('ag97_rita_lab', RITA, [{
  id: 'ag97_turn_dealer_science',
  giverNpcId: 'ag97_rita_lab',
  type: QuestType.FETCH,
  desc: 'Рита Лаборантка: «Принеси расписку из тетради. Мы заберем Трофима под учет и уведем должников без рейда.»',
  targetItem: 'voluntary_receipt', targetCount: 1,
  rewardItem: 'clean_health_cert', rewardCount: 1,
  extraRewards: [{ defId: 'antidep', count: 1 }],
  relationDelta: 11, xpReward: 45, moneyReward: 35,
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
  for (let r = 8; r <= 80; r += 4) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2 + 0.43;
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
      world.wallTex[ci] = Tex.ROTTEN;
      world.floorTex[ci] = Tex.F_CONCRETE;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
  }

  const room: Room = {
    id: roomId,
    type: RoomType.SMOKING,
    x: rx,
    y: ry,
    w: ROOM_W,
    h: ROOM_H,
    name: 'Дымная комната за мусоропроводом',
    wallTex: Tex.ROTTEN,
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

  protectRoom(world, rx, ry, ROOM_W, ROOM_H, Tex.ROTTEN, Tex.F_CONCRETE);
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
  for (let s = 0; s < 80; s++) {
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
  for (let x = rx + 2; x <= rx + ROOM_W - 3; x += 3) world.features[world.idx(x, ry + 1)] = Feature.SHELF;
  for (let x = rx + 3; x <= rx + ROOM_W - 4; x += 2) world.features[world.idx(x, ry + 4)] = Feature.CHAIR;
  world.features[world.idx(rx + 2, ry + 3)] = Feature.TABLE;
  world.features[world.idx(rx + 3, ry + 3)] = Feature.TABLE;
  world.features[world.idx(rx + ROOM_W - 4, ry + 3)] = Feature.DESK;
  world.features[world.idx(rx + ROOM_W - 3, ry + 3)] = Feature.DESK;
  world.features[world.idx(rx + 2, ry + ROOM_H - 2)] = Feature.SINK;
  world.features[world.idx(rx + ROOM_W - 3, ry + ROOM_H - 2)] = Feature.APPARATUS;
  world.features[world.idx(rx + 1, ry + 1)] = Feature.LAMP;
  world.features[world.idx(rx + ROOM_W - 2, ry + 1)] = Feature.LAMP;
  world.features[world.idx(rx + Math.floor(ROOM_W / 2), ry + ROOM_H - 2)] = Feature.CANDLE;
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addDenContainer(
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
  owner?: Entity,
  faction = Faction.WILD,
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
    inventory: inventory.map(i => ({ ...i })),
    capacitySlots,
    ownerNpcId: owner?.id,
    ownerName: owner?.name,
    faction,
    access,
    lockDifficulty: access === 'locked' ? 3 : undefined,
    discovered: true,
    tags: [MODULE_TAG, 'finite_stock', ...tags],
  };
  world.addContainer(container);
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
): Entity {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  return requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle,
    weapon,
    canGiveQuest,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
  });
}

function spawnDenNpcs(world: World, entities: Entity[], nextId: { v: number }, room: Room): Entity {
  const dealer = spawnNpc(world, entities, nextId, room, 'ag97_trofim_dymar', 8, 3, Math.PI / 2, true, 'knife');
  spawnNpc(world, entities, nextId, room, 'ag97_pavel_podzalog', 3, ROOM_H - 3, 0, true);
  spawnNpc(world, entities, nextId, room, 'ag97_klava_witness', 2, 3, 0, true);
  spawnNpc(world, entities, nextId, room, 'ag97_markov_report', ROOM_W - 3, ROOM_H - 3, Math.PI, true, 'makarov');
  spawnNpc(world, entities, nextId, room, 'ag97_rita_lab', ROOM_W - 4, 3, Math.PI, true);
  return dealer;
}

function seedContainers(world: World, room: Room, dealer: Entity): void {
  addDenContainer(
    world, room, ROOM_W - 4, 2, ContainerKind.SECRET_STASH, 'Картонная коробка Трофима',
    'owner', 7,
    [
      { defId: 'govnyak_roll', count: 5 },
      { defId: 'cigs', count: 2 },
      { defId: 'grey_briquette', count: 1 },
    ],
    ['stock', 'contraband', 'theft', 'dealer'],
    dealer,
    Faction.WILD,
  );
  addDenContainer(
    world, room, ROOM_W - 5, ROOM_H - 3, ContainerKind.CASHBOX, 'Жестяная касса долгов',
    'owner', 8,
    [
      { defId: 'voluntary_receipt', count: 2 },
      { defId: 'denunciation', count: 1 },
      { defId: 'neighbor_complaint', count: 1 },
      { defId: 'govnyak_roll', count: 1 },
    ],
    ['debt', 'ledger', 'paper', 'theft', 'report_evidence'],
    dealer,
    Faction.WILD,
  );
  addDenContainer(
    world, room, 4, ROOM_H - 2, ContainerKind.WOODEN_CHEST, 'Пакет у свидетелей',
    'faction', 6,
    [
      { defId: 'water', count: 1 },
      { defId: 'bread', count: 1 },
      { defId: 'note', count: 1 },
    ],
    ['witness', 'mercy_stock', 'theft'],
    undefined,
    Faction.CITIZEN,
  );
}

function generateGovnyakSmokeDen(
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
  const dealer = spawnDenNpcs(world, entities, nextId, room);
  seedContainers(world, room, dealer);
  genLog(`[AG97] ${room.name} at (${pos.x}, ${pos.y}) room #${room.id}`);
  return { nextRoomId };
}

registerZoneContent(DEN_ZONE, 'Дымная комната за мусоропроводом', generateGovnyakSmokeDen);
