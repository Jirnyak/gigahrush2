/* -- AG65 white compulsion room: quiet NPC decision POI --------- */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal, Cell, ContainerKind, DoorState, EntityType, Faction, Feature,
  FloorLevel, NpcState, Occupation, QuestType, RoomType, Tex,
  type Entity, type GameState, type Room, type WorldContainer, type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { Spr } from '../../render/sprite_index';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { protectRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

const ROOM_W = 15;
const ROOM_H = 11;
const WHITE_ROOM_ZONE = 60;

const VICTIM_ID = 'ag65_tonya_belaya';
const NEIGHBOR_ID = 'ag65_dasha_porog';
const LIQUIDATOR_ID = 'ag65_klim_plomba';
const SCIENTIST_ID = 'ag65_mark_probnik';
const WATCHER_ID = 'ag65_efim_akt';

const RESCUE_QUEST = 'ag65_pull_tonya_away';
const SEAL_QUEST = 'ag65_seal_white_room';
const SAMPLE_QUEST = 'ag65_deliver_white_sample';
const LOST_QUEST = 'ag65_write_room_off';
const OUTCOME_TAG = 'ag65_white_outcome';
const SAMPLE_CONTAINER_TAG = 'ag65_white_sample';

const NPC_DEFS: Record<string, PlotNpcDef> = {
  [VICTIM_ID]: {
    name: 'Тоня Белая',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 70, maxHp: 90, money: 6, speed: 0.35,
    inventory: [{ defId: 'sealed_complaint', count: 1 }],
    talkLines: [
      'Тише. Там белый налет на стене, от него глаза не отлипают.',
      'Если смотреть в пол, легче сделать шаг назад.',
      'Я сейчас отойду. Сейчас. Только досчитаю плитки до стены.',
      'Рука холодная не моя. Моя бы давно ушла.',
    ],
    talkLinesPost: [
      'Меня отвели от пятна. Теперь я вижу дверь, а не только стену.',
      'Если я снова пойду к стене, назови меня по имени, но не громко.',
    ],
    talkQuestResponse: 'Да. Руку держи крепче. Если отпустишь у порога, я вернусь не ногами.',
  },

  [NEIGHBOR_ID]: {
    name: 'Даша У Порога',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.HOUSEWIFE,
    sprite: Occupation.HOUSEWIFE,
    hp: 95, maxHp: 95, money: 18, speed: 0.85,
    inventory: [{ defId: 'water', count: 1 }, { defId: 'bread', count: 1 }],
    talkLines: [
      'Тоня стоит у белого следа и не слышит, что её зовут.',
      'Не бейте её. Просто встаньте между ней и пятном, скажите имя, выведите к двери.',
      'Если закрывать комнату, сначала людей наружу. Потом уже бумага.',
    ],
    talkLinesPost: [
      'Тоня сидит у порога. Взгляд ещё липнет к стене, но ноги слушаются.',
      'Спасибо. Когда человек молчит у такой стены, это хуже крика.',
    ],
  },

  [LIQUIDATOR_ID]: {
    name: 'Клим Пломба',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 190, maxHp: 190, money: 42, speed: 0.95,
    inventory: [{ defId: 'pipe', count: 1 }, { defId: 'bandage', count: 1 }],
    talkLines: [
      'Дверь должна закрыться до того, как к стене подойдет ещё кто-нибудь.',
      'Герметик на петлю, уплотнитель в паз. Не геройство, а закрытая створка.',
      'Образцы пусть учёные берут. Я считаю людей, которые вышли.',
    ],
    talkLinesPost: [
      'Шов принял герметик. Теперь к налету не подойдешь без ключа и свидетеля.',
      'Если кто-то стучит изнутри после пломбы, сначала сверяем имя.',
    ],
  },

  [SCIENTIST_ID]: {
    name: 'Марк Пробник',
    isFemale: false,
    faction: Faction.SCIENTIST,
    occupation: Occupation.SCIENTIST,
    sprite: Occupation.SCIENTIST,
    hp: 90, maxHp: 90, money: 85, speed: 0.75,
    inventory: [{ defId: 'antidep', count: 1 }, { defId: 'inspection_mirror', count: 1 }],
    talkLines: [
      'Белый остаток не берут пальцами. Он липнет к перчатке, к коже - тем более.',
      'В лотке есть стекло. Соскоб, крышка, шаг назад. Без объяснений у стены.',
      'Если человека не вывести, проба будет грязной. Наука иногда умеет стыдиться.',
    ],
    talkLinesPost: [
      'Образец закрыт. Пока пломба сухая, его можно донести Якову Давидовичу в лабораторию НИИ.',
      'Я отнесу пробу Якову Давидовичу. В отчёте будут вес, цвет, время контакта и кто стоял слишком близко.',
    ],
  },

  [WATCHER_ID]: {
    name: 'Ефим Актовый',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 85, maxHp: 85, money: 25, speed: 0.7,
    inventory: [{ defId: 'blank_form', count: 1 }, { defId: 'cigs', count: 2 }],
    talkLines: [
      'Можно ничего не делать. Домком такие решения быстро превращает в акт.',
      'Пустая расписка на столе. Подпишете - комнату спишут вместе с человеком.',
      'Я не советую. Я фиксирую, чтобы потом все говорили тише.',
    ],
    talkLinesPost: [
      'Акт принят. Тоня теперь строка в журнале и закрытая дверь.',
      'Белые пятна любят бумагу. На бумаге проще не видеть человека.',
    ],
  },
};

registerSideQuest(VICTIM_ID, NPC_DEFS[VICTIM_ID], []);

registerSideQuest(NEIGHBOR_ID, NPC_DEFS[NEIGHBOR_ID], [
  {
    id: RESCUE_QUEST,
    giverNpcId: NEIGHBOR_ID,
    type: QuestType.TALK,
    desc: 'Даша У Порога: «Подойди к Тоне и выведи её от белого остатка. Говори по имени, смотри на неё, не на стену.»',
    targetNpcId: VICTIM_ID,
    rewardItem: 'water',
    rewardCount: 2,
    extraRewards: [{ defId: 'bread', count: 1 }],
    relationDelta: 16,
    xpReward: 55,
    moneyReward: 25,
  },
]);

registerSideQuest(LIQUIDATOR_ID, NPC_DEFS[LIQUIDATOR_ID], [
  {
    id: SEAL_QUEST,
    giverNpcId: LIQUIDATOR_ID,
    type: QuestType.FETCH,
    desc: 'Клим Пломба: «Один тюбик герметика - и я закрою белую комнату по шву. Без герметика это просто створка на честном слове.»',
    targetItem: 'sealant_tube',
    targetCount: 1,
    rewardItem: 'hermo_gasket',
    rewardCount: 1,
    extraRewards: [{ defId: 'bandage', count: 1 }],
    relationDelta: 12,
    xpReward: 45,
    moneyReward: 35,
  },
]);

registerSideQuest(SCIENTIST_ID, NPC_DEFS[SCIENTIST_ID], [
  {
    id: SAMPLE_QUEST,
    giverNpcId: SCIENTIST_ID,
    type: QuestType.FETCH,
    desc: 'Марк Пробник: «Возьми из лотка белый соскоб и сразу принеси мне. Не клади к еде, документам и своим оправданиям.»',
    targetItem: 'psi_dust',
    targetCount: 1,
    rewardItem: 'antidep',
    rewardCount: 1,
    extraRewards: [{ defId: 'inspection_mirror', count: 1 }],
    relationDelta: 10,
    xpReward: 60,
    moneyReward: 60,
  },
]);

registerSideQuest(WATCHER_ID, NPC_DEFS[WATCHER_ID], [
  {
    id: LOST_QUEST,
    giverNpcId: WATCHER_ID,
    type: QuestType.FETCH,
    desc: 'Ефим Актовый: «Принеси расписку со стола. Если подпись есть, комната считается оставленной. Иногда это тоже выбор.»',
    targetItem: 'voluntary_receipt',
    targetCount: 1,
    rewardItem: 'cigs',
    rewardCount: 3,
    relationDelta: -8,
    xpReward: 20,
    moneyReward: 10,
  },
]);

interface OutcomeDef {
  outcome: string;
  targetName: string;
  tags: string[];
  rumorIds: string[];
  severity: 3 | 4 | 5;
}

const OUTCOMES: Record<string, OutcomeDef> = {
  [RESCUE_QUEST]: {
    outcome: 'rescued',
    targetName: 'Белая комната: Тоню отвели от остатка.',
    tags: ['rescued', 'witness', 'citizen'],
    rumorIds: ['ag65_white_slime_rescued'],
    severity: 4,
  },
  [SEAL_QUEST]: {
    outcome: 'sealed',
    targetName: 'Белая комната: шов закрыт герметиком.',
    tags: ['sealed', 'containment', 'liquidator'],
    rumorIds: ['ag65_white_slime_sealed'],
    severity: 4,
  },
  [SAMPLE_QUEST]: {
    outcome: 'sampled',
    targetName: 'Белая комната: соскоб передан учёным.',
    tags: ['sampled', 'sample', 'science'],
    rumorIds: ['ag65_white_slime_sampled'],
    severity: 4,
  },
  [LOST_QUEST]: {
    outcome: 'lost',
    targetName: 'Белая комната: жильца списали вместе с помещением.',
    tags: ['lost', 'abandoned', 'witness'],
    rumorIds: ['ag65_white_slime_lost'],
    severity: 5,
  },
};

registerWorldEventObserver(handleWhiteCompulsionOutcome);

function handleWhiteCompulsionOutcome(state: GameState, event: WorldEvent): void {
  if (event.type !== 'quest_completed' || event.tags.includes(OUTCOME_TAG)) return;
  const sideQuestId = typeof event.data?.sideQuestId === 'string' ? event.data.sideQuestId : '';
  const outcome = OUTCOMES[sideQuestId];
  if (!outcome) return;

  publishEvent(state, {
    type: 'quest_completed',
    floor: FloorLevel.LIVING,
    zoneId: event.zoneId,
    roomId: event.roomId,
    x: event.x,
    y: event.y,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetName: outcome.targetName,
    severity: outcome.severity,
    privacy: 'local',
    tags: [OUTCOME_TAG, 'slime', 'white_slime', 'compulsion', ...outcome.tags],
    data: {
      sourceEventId: event.id,
      sideQuestId,
      outcome: outcome.outcome,
      rumorIds: outcome.rumorIds,
    },
  });
}

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
  for (let r = 0; r <= 92; r += 4) {
    for (let k = 0; k < 24; k++) {
      const a = ((k + 11) / 24) * Math.PI * 2;
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
      world.wallTex[ci] = Tex.TILE_W;
      world.floorTex[ci] = Tex.F_CONCRETE;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
  }

  const room: Room = {
    id: roomId,
    type: RoomType.LIVING,
    x: world.wrap(rx),
    y: world.wrap(ry),
    w: ROOM_W,
    h: ROOM_H,
    doors: [],
    sealed: false,
    name: 'Комната белого остатка',
    apartmentId: -1,
    wallTex: Tex.TILE_W,
    floorTex: Tex.F_CONCRETE,
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

  protectRoom(world, room.x, room.y, ROOM_W, ROOM_H, Tex.TILE_W, Tex.F_CONCRETE);
  return room;
}

function addHermeticDoor(world: World, room: Room): void {
  const x = world.wrap(room.x + Math.floor(room.w / 2));
  const y = world.wrap(room.y + room.h);
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.DOOR;
  world.floorTex[ci] = Tex.F_CONCRETE;
  world.roomMap[ci] = -1;
  world.aptMask[ci] = 1;
  world.doors.set(ci, { idx: ci, state: DoorState.HERMETIC_OPEN, roomA: room.id, roomB: -1, keyId: '', timer: 0 });
  room.doors.push(ci);

  let cy = world.wrap(y + 1);
  for (let s = 0; s < 74; s++) {
    const path = world.idx(x, cy);
    if (world.cells[path] === Cell.FLOOR && !world.aptMask[path]) break;
    if (!world.aptMask[path]) {
      world.cells[path] = Cell.FLOOR;
      world.floorTex[path] = Tex.F_CONCRETE;
      world.roomMap[path] = -1;
      world.features[path] = Feature.NONE;
    }
    cy = world.wrap(cy + 1);
  }
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = feature;
}

function addDrop(entities: Entity[], nextId: { v: number }, x: number, y: number, defId: string, count = 1): void {
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

function addSampleTray(world: World, room: Room): void {
  const x = world.wrap(room.x + 10);
  const y = world.wrap(room.y + 5);
  const container: WorldContainer = {
    id: nextContainerId(world),
    x,
    y,
    floor: FloorLevel.LIVING,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind: ContainerKind.MEDICAL_CABINET,
    name: 'Стеклянный лоток белого соскоба',
    inventory: [{ defId: 'psi_dust', count: 1 }],
    capacitySlots: 3,
    faction: Faction.SCIENTIST,
    access: 'public',
    discovered: true,
    tags: ['ag65_white_compulsion', SAMPLE_CONTAINER_TAG, 'slime', 'white_slime', 'sample'],
  };
  world.addContainer(container);
  setFeature(world, x, y, Feature.APPARATUS);
}

function spawnNpc(
  entities: Entity[],
  nextId: { v: number },
  plotNpcId: string,
  x: number,
  y: number,
  angle: number,
  canGiveQuest: boolean,
  opts: { weapon?: string; held?: boolean } = {},
): void {
  const ai = {
    goal: opts.held ? AIGoal.GOTO : AIGoal.IDLE,
    tx: x + (opts.held ? 1.5 : 0.5),
    ty: y + 0.5,
    path: [],
    pi: 0,
    stuck: 0,
    timer: opts.held ? 999 : 0,
    npcState: opts.held ? NpcState.WORKING : undefined,
  };
  requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle,
    weapon: opts.weapon,
    canGiveQuest,
    extra: { ai, isTraveler: false },
  });
}

function decorateRoom(world: World, room: Room, entities: Entity[], nextId: { v: number }): void {
  const rx = room.x;
  const ry = room.y;
  const residueX = rx + ROOM_W - 3;
  const residueY = ry + Math.floor(ROOM_H / 2);

  for (const [dx, dy, feature] of [
    [1, 1, Feature.LAMP],
    [ROOM_W - 2, 1, Feature.LAMP],
    [2, 3, Feature.DESK],
    [3, 3, Feature.CHAIR],
    [2, ROOM_H - 3, Feature.SHELF],
    [5, ROOM_H - 3, Feature.TABLE],
    [6, ROOM_H - 3, Feature.CHAIR],
    [8, 3, Feature.SINK],
    [10, 5, Feature.APPARATUS],
    [ROOM_W - 4, ROOM_H - 2, Feature.BED],
  ] as const) {
    setFeature(world, rx + dx, ry + dy, feature);
  }

  stampSurfaceSplat(world, residueX, residueY, 0.5, 0.5, 4.8, 0.42, 65065, 230, 232, 218, false);
  stampSurfaceSplat(world, residueX - 2, residueY + 2, 0.5, 0.5, 2.3, 0.28, 65066, 215, 220, 210, false);
  stampSurfaceSplat(world, residueX, residueY - 2, 0.5, 0.5, 1.4, 0.2, 65067, 245, 245, 236, true);
  world.wallTex[world.idx(residueX, ry - 1)] = Tex.TILE_W;
  world.floorTex[world.idx(residueX, residueY)] = Tex.F_TILE;

  addDrop(entities, nextId, rx + 4, ry + 8, 'sealant_tube', 1);
  addDrop(entities, nextId, rx + 2, ry + 4, 'voluntary_receipt', 1);
  addDrop(entities, nextId, rx + 6, ry + 8, 'antidep', 1);
  addSampleTray(world, room);

  spawnNpc(entities, nextId, VICTIM_ID, residueX - 1, residueY, 0, false, { held: true });
  spawnNpc(entities, nextId, NEIGHBOR_ID, rx + 4, ry + ROOM_H - 2, -Math.PI / 2, true);
  spawnNpc(entities, nextId, LIQUIDATOR_ID, rx + 7, ry + ROOM_H - 2, -Math.PI / 2, true, { weapon: 'pipe' });
  spawnNpc(entities, nextId, SCIENTIST_ID, rx + 9, ry + 4, 0, true);
  spawnNpc(entities, nextId, WATCHER_ID, rx + 2, ry + 2, Math.PI / 2, true);
}

function generateWhiteCompulsionRoom(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zcx: number,
  zcy: number,
): { nextRoomId: number } {
  const pos = findOrigin(world, zcx, zcy);
  const room = carveRoom(world, nextRoomId++, pos.x, pos.y);
  addHermeticDoor(world, room);
  decorateRoom(world, room, entities, nextId);
  genLog(`[AG65] ${room.name} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId };
}

registerZoneContent(WHITE_ROOM_ZONE, 'Комната белого остатка', generateWhiteCompulsionRoom);
