/* ── External Chernobog cell neighbor: domestic recruitment POI ── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  Cell, ContainerKind, DoorState, EntityType, Faction, Feature, FloorLevel, Occupation,
  QuestType, RoomType, Tex,
  type ContainerAccess, type Entity, type GameState, type Room, type WorldContainer, type WorldEvent,
  type WorldEventPrivacy, type WorldEventSeverity,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest, registerSideQuestSteps } from '../../data/plot';
import { addFactionRelMutual } from '../../data/relations';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { Spr } from '../../render/sprite_index';
import { protectRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

const CONTENT_TAG = 'ag77_external_cell_neighbor';
const OUTCOME_EVENT_TAG = 'ag77_external_cell_outcome';
const THEFT_EVENT_TAG = 'ag77_external_cell_theft_seen';
const ZONE_HUD_ID = 57;
const ROOM_W = 15;
const ROOM_H = 10;
const RECRUITER_ID = 'ag77_nina_neighbor';
const WITNESS_ID = 'ag77_tamara_quiet_witness';
const LEAD_QUEST = 'ag77_hear_neighbor_route';
const EXPOSE_QUEST = 'ag77_expose_external_cell';
const TRADE_QUEST = 'ag77_use_route_rumor';
const TRUST_QUEST = 'ag77_accept_quiet_signal';
const BETRAY_QUEST = 'ag77_betray_neighbor_route';
const SILENCE_QUEST = 'ag77_keep_neighbor_route_quiet';
const BRANCH_QUEST_IDS = [EXPOSE_QUEST, TRADE_QUEST, TRUST_QUEST, BETRAY_QUEST, SILENCE_QUEST] as const;

const NPC_DEF: PlotNpcDef = {
  name: 'Нина Павловна',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.HOUSEWIFE,
  sprite: Occupation.HOUSEWIFE,
  hp: 110,
  maxHp: 110,
  money: 38,
  speed: 0.82,
  inventory: [
    { defId: 'bread', count: 1 },
    { defId: 'cigs', count: 2 },
    { defId: 'caravan_route', count: 1 },
    { defId: 'water_coupon', count: 1 },
  ],
  talkLines: [
    'Не стойте в дверях, сосед. Тут сквозит, а сквозняк теперь ходит с вопросами.',
    'Я не из храма. Храм шумный. Я просто знаю, какая дверь после сирены остаётся дверью.',
    'Если пойдёте ниже, не берите левый ход у мокрой батареи. Там ликвидаторы пишут пропажи, а не маршруты.',
    'Черная ладонь на косяке? Сажа с котельной. Только дети такую метку на чужой двери не оставляют.',
    'Можно жить проще: не спрашивать, кто дал маршрут, и возвращаться с водой.',
    'Сержант Баринов всё равно нюхает чужие записки. Хотите сдать меня — сдавайте коротко, пока он не спросил вас первым.',
    'Хлеб возьмите. Потом сами решите, помощь это была или долг.',
    'Календарь висит криво потому, что за ним коробка. Не все тайники надо открывать при соседях.',
    'Маршрут сухой до второй трубы. Дальше не молитесь, считайте шаги.',
    'Ваньке бумажки не показывайте сразу. Он слышит цену раньше смысла.',
    'Если кто спросит, я просто соседка. Просто соседки тоже ведут список долгов.',
    'Не при соседях, милый. У соседей уши общие, а долги личные.',
  ],
  talkLinesPost: [
    'Соседи остаются соседями, даже когда у каждого свой список дверей.',
    'Я сказала только маршрут. Что вы с ним сделали — уже ваша биография.',
    'Не ищите тут алтарь. Под кроватью пыль, квитанции и одна коробка не для обхода.',
    'Тихую дверь не благодарят вслух. Ее потом ищут по вашему голосу.',
    'Квитанцию держите сухой. Мокрая бумага быстрее признается не тем людям.',
    'Большие слова тут ни при чем, милый. Просто кто-то должен помнить, кому вы обязаны.',
  ],
  talkQuestResponse: [
    'Вот и хорошо. Иногда самый крепкий замок - это сосед, который не пошёл на кухню болтать.',
    'Маршрут останется маршрутом, пока его не понесли хвастаться.',
    'Ладонь за календарем не для красоты. Это чтобы свои не стучали громко.',
  ],
};

const WITNESS_DEF: PlotNpcDef = {
  name: 'Тамара Сухая',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.HOUSEWIFE,
  sprite: Occupation.HOUSEWIFE,
  hp: 95,
  maxHp: 95,
  money: 12,
  speed: 0.78,
  inventory: [
    { defId: 'bread', count: 1 },
    { defId: 'water_coupon', count: 1 },
    { defId: 'note', count: 1 },
  ],
  talkLines: [
    'Я не видела ладонь. Я видела календарь, а календарей у всех хватает.',
    'Нина говорит нормально. Это и страшно: нормальные слова лучше прячут долг.',
    'Если бумагу не несете сержанту Баринову, не несите ее и языком.',
    'У тихой двери не стучат дважды. Второй стук уже для тех, кто считает свидетелей.',
  ],
  talkLinesPost: [
    'Сухая квитанция легче мокрого доноса.',
    'Молчание тоже работа. Просто за нее редко благодарят вслух.',
  ],
};

interface OutcomeDef {
  outcome: 'exposed' | 'traded' | 'trusted' | 'betrayed' | 'silent';
  targetName: string;
  severity: WorldEventSeverity;
  privacy: WorldEventPrivacy;
  tags: string[];
  rumorIds: string[];
  containerOutcome: string;
  relationDeltas: { faction: Faction; delta: number }[];
}

const OUTCOMES: Record<string, OutcomeDef> = {
  [EXPOSE_QUEST]: {
    outcome: 'exposed',
    targetName: 'Адрес внешней ячейки передан ликвидаторам',
    severity: 4,
    privacy: 'public',
    tags: ['cult', 'chernobog', 'external_cell', 'exposed', 'liquidator', 'report'],
    rumorIds: ['ag77_external_cell_exposed'],
    containerOutcome: 'route_cabinet_seized',
    relationDeltas: [
      { faction: Faction.LIQUIDATOR, delta: 14 },
      { faction: Faction.CULTIST, delta: -14 },
    ],
  },
  [TRADE_QUEST]: {
    outcome: 'traded',
    targetName: 'Маршрут внешней ячейки обменян на нижнюю водную наводку',
    severity: 3,
    privacy: 'local',
    tags: ['cult', 'chernobog', 'external_cell', 'traded', 'route_rumor'],
    rumorIds: ['ag77_external_cell_traded'],
    containerOutcome: 'route_note_kept_as_trade_copy',
    relationDeltas: [
      { faction: Faction.SCIENTIST, delta: 5 },
      { faction: Faction.CULTIST, delta: -2 },
    ],
  },
  [TRUST_QUEST]: {
    outcome: 'trusted',
    targetName: 'Игрок принял тихий знак внешней ячейки',
    severity: 4,
    privacy: 'secret',
    tags: ['cult', 'chernobog', 'external_cell', 'trusted', 'black_hand'],
    rumorIds: ['ag77_external_cell_trusted'],
    containerOutcome: 'calendar_stash_hint_shared',
    relationDeltas: [
      { faction: Faction.CULTIST, delta: 10 },
      { faction: Faction.LIQUIDATOR, delta: -6 },
      { faction: Faction.SCIENTIST, delta: -2 },
    ],
  },
  [BETRAY_QUEST]: {
    outcome: 'betrayed',
    targetName: 'Тихий маршрут Нины продан громкому культу',
    severity: 4,
    privacy: 'local',
    tags: ['cult', 'chernobog', 'external_cell', 'betrayed', 'black_hand'],
    rumorIds: ['ag77_external_cell_betrayed'],
    containerOutcome: 'calendar_key_label_sold',
    relationDeltas: [
      { faction: Faction.CULTIST, delta: 8 },
      { faction: Faction.CITIZEN, delta: -6 },
      { faction: Faction.LIQUIDATOR, delta: -4 },
    ],
  },
  [SILENCE_QUEST]: {
    outcome: 'silent',
    targetName: 'Маршрут внешней ячейки оставлен без свидетелей',
    severity: 3,
    privacy: 'secret',
    tags: ['cult', 'chernobog', 'external_cell', 'silent', 'concealment', 'social'],
    rumorIds: ['ag77_external_cell_silent'],
    containerOutcome: 'route_note_left_unshown',
    relationDeltas: [
      { faction: Faction.CITIZEN, delta: 4 },
      { faction: Faction.CULTIST, delta: 3 },
      { faction: Faction.LIQUIDATOR, delta: -3 },
    ],
  },
};

registerWorldEventObserver(handleAg77Outcome);

function branchBlockers(id: string): string[] {
  return BRANCH_QUEST_IDS.filter(qid => qid !== id);
}

registerSideQuest(RECRUITER_ID, NPC_DEF, [
  {
    id: LEAD_QUEST,
    giverNpcId: RECRUITER_ID,
    type: QuestType.FETCH,
    desc: 'Нина Павловна: "Хлеб на стол, сосед. Тогда скажу, почему метка за календарем ведет не к вам, а к запасной двери."',
    targetItem: 'bread',
    targetCount: 1,
    rewardItem: 'note',
    rewardCount: 1,
    extraRewards: [{ defId: 'water_coupon', count: 1 }],
    relationDelta: 0,
    xpReward: 18,
    moneyReward: 5,
    eventTargetName: 'Нина Павловна дала тихую маршрутную записку внешней ячейки.',
    eventSeverity: 3,
    eventPrivacy: 'local',
    eventTags: [CONTENT_TAG, 'external_cell', 'lead', 'black_hand'],
    eventData: {
      ag77Outcome: 'lead',
      rumorIds: ['lead_living_external_cell_neighbor'],
      containerHint: 'route_cabinet_and_calendar_stash',
    },
  },
  {
    id: TRUST_QUEST,
    giverNpcId: RECRUITER_ID,
    type: QuestType.FETCH,
    desc: 'Нина Павловна: "Две пачки Примы на общий стол. Кто приносит дым без вопросов, тому показывают дверь без очереди."',
    targetItem: 'cigs',
    targetCount: 2,
    rewardItem: 'temp_pass',
    rewardCount: 1,
    extraRewards: [{ defId: 'caravan_route', count: 1 }, { defId: 'water_coupon', count: 1 }],
    requiresSideQuestDone: LEAD_QUEST,
    blockedBySideQuestIds: [...BRANCH_QUEST_IDS],
    abandonsSideQuestIds: branchBlockers(TRUST_QUEST),
    relationDelta: 0,
    xpReward: 35,
    moneyReward: 15,
    eventTargetName: 'Игрок остался доверенным курьером тихой соседки.',
    eventSeverity: 4,
    eventPrivacy: 'secret',
    eventTags: [CONTENT_TAG, 'external_cell', 'trust', 'black_hand'],
    eventData: {
      ag77Outcome: 'trusted',
      rumorIds: ['ag77_external_cell_trusted'],
      containerHint: 'calendar_stash_hint_shared',
    },
  },
]);

registerSideQuest(WITNESS_ID, WITNESS_DEF, [
  {
    id: SILENCE_QUEST,
    giverNpcId: WITNESS_ID,
    type: QuestType.TALK,
    desc: 'Тамара Сухая: "Если маршрут оставляете себе, скажите Нине одной фразой. Без сержанта Баринова, без Ваньки, без общей кухни."',
    targetNpcId: RECRUITER_ID,
    rewardItem: 'bread',
    rewardCount: 1,
    extraRewards: [{ defId: 'note', count: 1 }],
    requiresSideQuestDone: LEAD_QUEST,
    blockedBySideQuestIds: [...BRANCH_QUEST_IDS],
    abandonsSideQuestIds: branchBlockers(SILENCE_QUEST),
    relationDelta: 0,
    xpReward: 28,
    moneyReward: 0,
    eventTargetName: 'Игрок оставил маршрут тихой соседки без доноса и продажи.',
    eventSeverity: 3,
    eventPrivacy: 'secret',
    eventTags: [CONTENT_TAG, 'external_cell', 'silence', 'concealment'],
    eventData: {
      ag77Outcome: 'silent',
      rumorIds: ['ag77_external_cell_silent'],
      containerHint: 'route_note_left_unshown',
    },
  },
]);

registerSideQuestSteps([
  {
    id: EXPOSE_QUEST,
    giverNpcId: 'barni',
    type: QuestType.FETCH,
    desc: 'Сержант Баринов: "Если соседка торгует тихими дверями, неси маршрутную квитанцию из ее тумбы. Слова потом допишем сами."',
    targetItem: 'caravan_route',
    targetCount: 1,
    rewardItem: 'ammo_9mm',
    rewardCount: 8,
    extraRewards: [{ defId: 'liquidator_ration', count: 1 }],
    requiresSideQuestDone: LEAD_QUEST,
    blockedBySideQuestIds: [...BRANCH_QUEST_IDS],
    abandonsSideQuestIds: branchBlockers(EXPOSE_QUEST),
    relationDelta: 0,
    xpReward: 55,
    moneyReward: 35,
    eventTargetName: 'Маршрутная квитанция Нины передана ликвидаторам как адрес внешней ячейки.',
    eventSeverity: 4,
    eventPrivacy: 'public',
    eventTags: [CONTENT_TAG, 'external_cell', 'expose', 'liquidator'],
    eventData: {
      ag77Outcome: 'exposed',
      rumorIds: ['ag77_external_cell_exposed'],
      containerHint: 'route_cabinet_seized',
    },
  },
  {
    id: TRADE_QUEST,
    giverNpcId: 'yakov',
    type: QuestType.VISIT,
    visitFloor: FloorLevel.MAINTENANCE,
    desc: 'Яков Давидович: "По модели Нины маршрут неполный. Спуститесь в Коллекторы и вернитесь с отметкой, что он вообще выводит вниз."',
    rewardItem: 'caravan_route',
    rewardCount: 1,
    extraRewards: [{ defId: 'filtered_water', count: 1 }, { defId: 'note', count: 1 }],
    requiresSideQuestDone: LEAD_QUEST,
    blockedBySideQuestIds: [...BRANCH_QUEST_IDS],
    abandonsSideQuestIds: branchBlockers(TRADE_QUEST),
    relationDelta: 0,
    xpReward: 45,
    moneyReward: 20,
    eventTargetName: 'Маршрут внешней ячейки обменян на проверенную нижнюю водную наводку.',
    eventSeverity: 4,
    eventPrivacy: 'local',
    eventTags: [CONTENT_TAG, 'external_cell', 'trade', 'route'],
    eventData: {
      ag77Outcome: 'traded',
      rumorIds: ['ag77_external_cell_traded'],
      containerHint: 'route_note_kept_as_trade_copy',
    },
  },
  {
    id: BETRAY_QUEST,
    giverNpcId: 'vanka',
    type: QuestType.FETCH,
    desc: 'Ванька: "Тихая тетка метку прячет? Принеси бирку из коробки за календарем. Только быстро: если метка культовая, я хочу обменять адрес до ночи, а не сидеть рядом и ждать."',
    targetItem: 'container_key_label',
    targetCount: 1,
    rewardItem: 'holy_water',
    rewardCount: 1,
    extraRewards: [{ defId: 'cigs', count: 3 }],
    requiresSideQuestDone: LEAD_QUEST,
    blockedBySideQuestIds: [...BRANCH_QUEST_IDS],
    abandonsSideQuestIds: branchBlockers(BETRAY_QUEST),
    relationDelta: 0,
    xpReward: 50,
    moneyReward: 12,
    eventTargetName: 'Бирка из тайника Нины передана Ваньке; он обменял адрес на защиту и три пачки сигарет.',
    eventSeverity: 4,
    eventPrivacy: 'local',
    eventTags: [CONTENT_TAG, 'external_cell', 'betrayal', 'black_hand'],
    eventData: {
      ag77Outcome: 'betrayed',
      rumorIds: ['ag77_external_cell_betrayed'],
      containerHint: 'calendar_key_label_sold',
    },
  },
]);

function handleAg77Outcome(state: GameState, event: WorldEvent): void {
  if (event.tags.includes(OUTCOME_EVENT_TAG) || event.tags.includes(THEFT_EVENT_TAG)) return;
  if (event.type === 'item_stolen' && event.tags.includes('external_cell') && event.itemId === 'caravan_route') {
    addFactionRelMutual(Faction.PLAYER, Faction.CITIZEN, -4);
    addFactionRelMutual(Faction.PLAYER, Faction.CULTIST, -3);
    publishEvent(state, {
      type: 'faction_relation_changed',
      floor: event.floor,
      zoneId: event.zoneId,
      roomId: event.roomId,
      actorId: event.actorId,
      actorName: event.actorName,
      actorFaction: event.actorFaction,
      targetName: 'Тихая соседка заметила пропажу из маршрутной тумбы',
      severity: 3,
      privacy: event.privacy === 'witnessed' ? 'local' : 'private',
      tags: [OUTCOME_EVENT_TAG, THEFT_EVENT_TAG, 'ag77_external_cell', 'external_cell', 'stolen', 'theft'],
      data: {
        sourceEventId: event.id,
        outcome: 'stolen',
        itemId: event.itemId,
        containerId: event.containerId,
        relationDeltas: [
          { faction: Faction.CITIZEN, delta: -4 },
          { faction: Faction.CULTIST, delta: -3 },
        ],
        rumorIds: ['ag77_external_cell_stolen'],
      },
    });
    return;
  }
  if (event.type !== 'quest_completed') return;
  const sideQuestId = typeof event.data?.sideQuestId === 'string' ? event.data.sideQuestId : '';
  const outcome = OUTCOMES[sideQuestId];
  if (!outcome) return;

  for (const rel of outcome.relationDeltas) {
    addFactionRelMutual(Faction.PLAYER, rel.faction, rel.delta);
  }

  publishEvent(state, {
    type: 'faction_relation_changed',
    floor: event.floor,
    zoneId: event.zoneId,
    roomId: event.roomId,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetName: outcome.targetName,
    severity: outcome.severity,
    privacy: outcome.privacy,
    tags: [OUTCOME_EVENT_TAG, 'ag77_external_cell', ...outcome.tags],
    data: {
      sourceEventId: event.id,
      sideQuestId,
      outcome: outcome.outcome,
      relationDeltas: outcome.relationDeltas.map(rel => ({ faction: rel.faction, delta: rel.delta })),
      materialHook: 'black_hand_mark_and_route_note',
      containerOutcome: outcome.containerOutcome,
      rumorIds: outcome.rumorIds,
    },
  });
}

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
  for (let r = 0; r <= 92; r += 4) {
    for (let k = 0; k < 24; k++) {
      const a = ((k + 5) / 24) * Math.PI * 2;
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
      if (world.cells[ci] === Cell.LIFT) continue;
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.PANEL;
      world.floorTex[ci] = Tex.F_LINO;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
  }

  const room: Room = {
    id: roomId,
    type: RoomType.LIVING,
    x: rx,
    y: ry,
    w: ROOM_W,
    h: ROOM_H,
    doors: [],
    sealed: false,
    name: 'Квартира тихой соседки',
    apartmentId: -1,
    wallTex: Tex.PANEL,
    floorTex: Tex.F_LINO,
  };
  world.rooms[roomId] = room;

  for (let dy = 0; dy < ROOM_H; dy++) {
    for (let dx = 0; dx < ROOM_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
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
  for (let s = 0; s < 76; s++) {
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

function stampBlackHand(world: World, room: Room): void {
  const x = world.wrap(room.x + ROOM_W - 4);
  const y = world.wrap(room.y - 1);
  stampSurfaceSplat(world, x, y, 0.52, 0.68, 0.18, 0.62, 77077, 5, 5, 6, true);
  for (let i = 0; i < 5; i++) {
    stampSurfaceSplat(world, x, y, 0.34 + i * 0.09, 0.44, 0.07, 0.55, 77090 + i, 4, 4, 5, true);
  }
}

function decorateRoom(world: World, room: Room): void {
  const rx = room.x;
  const ry = room.y;
  setFeature(world, rx + 2, ry + 2, Feature.BED);
  setFeature(world, rx + 3, ry + 2, Feature.BED);
  setFeature(world, rx + ROOM_W - 3, ry + 2, Feature.SHELF);
  setFeature(world, rx + ROOM_W - 4, ry + 2, Feature.SHELF);
  setFeature(world, rx + 2, ry + ROOM_H - 3, Feature.STOVE);
  setFeature(world, rx + 3, ry + ROOM_H - 3, Feature.SINK);
  setFeature(world, rx + 6, ry + 5, Feature.TABLE);
  setFeature(world, rx + 5, ry + 5, Feature.CHAIR);
  setFeature(world, rx + 7, ry + 5, Feature.CHAIR);
  setFeature(world, rx + ROOM_W - 4, ry + ROOM_H - 3, Feature.DESK);
  setFeature(world, rx + ROOM_W - 5, ry + ROOM_H - 3, Feature.CHAIR);
  setFeature(world, rx + 1, ry + 1, Feature.LAMP);
  setFeature(world, rx + ROOM_W - 2, ry + ROOM_H - 2, Feature.LAMP);

  world.wallTex[world.idx(rx + 3, ry - 1)] = Tex.POSTER_BASE + 4;
  world.wallTex[world.idx(rx + ROOM_W - 4, ry - 1)] = Tex.POSTER_BASE + 17;
  stampSurfaceSplat(world, rx + 6, ry + 5, 0.5, 0.5, 3, 0.22, 77012, 40, 36, 26, false);
  stampBlackHand(world, room);
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

function addContainer(
  world: World,
  room: Room,
  dx: number,
  dy: number,
  kind: ContainerKind,
  name: string,
  access: ContainerAccess,
  inventory: WorldContainer['inventory'],
  owner?: Entity,
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
    ownerNpcId: owner?.id,
    ownerName: owner?.name,
    faction: Faction.CITIZEN,
    access,
    lockDifficulty: access === 'locked' ? 3 : undefined,
    discovered: access !== 'secret',
    tags: [
      CONTENT_TAG,
      'living',
      'cult',
      'chernobog',
      'external_cell',
      'black_hand',
      'route_rumor',
      access === 'owner' ? 'evidence_drop' : 'secret',
    ],
  });
}

function spawnRecruiter(world: World, entities: Entity[], nextId: { v: number }, room: Room): Entity {
  const existing = entities.find(e => e.alive && e.plotNpcId === RECRUITER_ID);
  if (existing) return existing;
  const x = world.wrap(room.x + 6);
  const y = world.wrap(room.y + 4);
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, RECRUITER_ID, x + 0.5, y + 0.5, {
    angle: Math.PI / 2,
    canGiveQuest: true,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
  });
  return npc;
}

function spawnWitness(world: World, entities: Entity[], nextId: { v: number }, room: Room): Entity {
  const existing = entities.find(e => e.alive && e.plotNpcId === WITNESS_ID);
  if (existing) return existing;
  const x = world.wrap(room.x + 8);
  const y = world.wrap(room.y + 6);
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, WITNESS_ID, x + 0.5, y + 0.5, {
    angle: -Math.PI / 2,
    canGiveQuest: true,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
  });
  return npc;
}

function seedRoom(world: World, room: Room, entities: Entity[], nextId: { v: number }, recruiter: Entity): void {
  addContainer(
    world,
    room,
    ROOM_W - 4,
    ROOM_H - 3,
    ContainerKind.FILING_CABINET,
    'Тумба с маршрутными квитанциями',
    'owner',
    [
      { defId: 'caravan_route', count: 1 },
      { defId: 'temp_pass', count: 1 },
      { defId: 'note', count: 2 },
    ],
    recruiter,
  );
  addContainer(
    world,
    room,
    ROOM_W - 3,
    2,
    ContainerKind.SECRET_STASH,
    'Коробка из-под галош за календарем',
    'secret',
    [
      { defId: 'container_key_label', count: 1 },
      { defId: 'water_coupon', count: 2 },
      { defId: 'cigs', count: 1 },
    ],
    recruiter,
  );
  dropItem(entities, nextId, room.x + 6, room.y + 5, 'note');
  dropItem(entities, nextId, room.x + 2, room.y + ROOM_H - 4, 'bread');
}

function generateExternalCellNeighbor(
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
  const recruiter = spawnRecruiter(world, entities, nextId, room);
  spawnWitness(world, entities, nextId, room);
  seedRoom(world, room, entities, nextId, recruiter);

  genLog(`[AG77] ${room.name} at (${room.x}, ${room.y}) room #${room.id}; zone ${ZONE_HUD_ID}`);
  return { nextRoomId };
}

registerZoneContent(ZONE_HUD_ID, 'Квартира тихой соседки', generateExternalCellNeighbor);
