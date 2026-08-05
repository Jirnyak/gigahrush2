/* -- Липовый медугол желемыша (AG104) -------------------------- */
/* Counterfeit treatment POI: warn, report, buy in, profit, steal. */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  Cell, ContainerKind, DoorState, EntityType, Faction, Feature,
  FloorLevel, Occupation, QuestType, RoomType, Tex,
  type ContainerAccess, type Entity, type Room, type WorldContainer,
  type WorldEvent, type WorldEventPrivacy, type WorldEventSeverity,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { Spr } from '../../render/sprite_index';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { protectRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

const FAKE_MEDPOST_ZONE = 59;
const ROOM_W = 17;
const ROOM_H = 12;
const CONTENT_TAG = 'ag104_fake_medpost';

const DOCTOR_ID = 'ag104_levin_maznik';
const PATIENT_ID = 'ag104_darya_patient';
const RELATIVE_ID = 'ag104_lina_relative';
const RUNNER_ID = 'ag104_klim_stock';

const QUEST_BUY_TREATMENT = 'ag104_buy_zhelemish_course';
const QUEST_TAKE_CUT = 'ag104_take_cut';
const QUEST_WARN_PATIENT = 'ag104_warn_patient';
const QUEST_REPORT_MINISTRY = 'ag104_report_ministry';

const NPC_DEFS: Record<string, PlotNpcDef> = {
  [DOCTOR_ID]: {
    name: 'Левин Мазник',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.DOCTOR,
    sprite: Occupation.DOCTOR,
    hp: 120, maxHp: 120, money: 220, speed: 0.75,
    inventory: [
      { defId: 'antifungal_ointment', count: 2 },
      { defId: 'pills', count: 1 },
      { defId: 'infected_mushroom', count: 2 },
      { defId: 'forged_quarantine_clearance', count: 1 },
    ],
    talkLines: [
      'Желемыш сушеный, перетертый, на кипятке. Дешево, пока очередь не спросила сертификат.',
      'Круглов лечит по ведомости. Я снимаю боль сейчас, без окна и подписи.',
      'Кто хочет чистый диагноз, пусть сперва доживет до чистого коридора.',
      'Не называйте это грибом при пациенте. Пациент слышит цену, не состав.',
    ],
    talkLinesPost: [
      'Блок платит за быстрое решение. Потом блок платит еще раз.',
      'Если придет проверка, вы покупали мазь для себя. Так всем легче писать.',
      'Желемыш не лекарство. Он повод подождать настоящего лекарства.',
    ],
  },

  [PATIENT_ID]: {
    name: 'Даша Подмарлевая',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.HOUSEWIFE,
    sprite: Occupation.HOUSEWIFE,
    hp: 42, maxHp: 85, money: 9, speed: 0.45,
    inventory: [{ defId: 'filter_receipt', count: 1 }],
    talkLines: [
      'Мазь холодит под бинтом. Левин говорит, так выходит жар.',
      'Настоящий антибиотик стоит как неделя воды. У меня нет недели.',
      'Если это обман, скажите не мне первой. Я уже почти поверила.',
      'В справке написано "местное средство". Место болит всё равно.',
    ],
    talkLinesPost: [
      'Меня сняли с желемыша. Запах остался, жар стал ниже.',
      'Если проверка придет поздно, всё равно пусть придет.',
      'Я теперь верю бумаге меньше, но дышу ровнее.',
    ],
  },

  [RELATIVE_ID]: {
    name: 'Лина Подмарлевая',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 95, maxHp: 95, money: 38, speed: 0.8,
    inventory: [
      { defId: 'bandage', count: 1 },
      { defId: 'sealed_complaint', count: 1 },
    ],
    talkLines: [
      'Даша верит халату. Халат у Левина чище, чем журнал.',
      'Я видела, как он соскреб желемыш с банки и назвал это курсом.',
      'Предупредите её. Она от меня уже слышит только страх.',
      'Если понесете жалобу наверх, не отдавайте её первому окну без имени.',
    ],
    talkLinesPost: [
      'Она вас услышала. От меня Даша ждала паники, от вас получила состав мази.',
      'Жалоба подана или нет, но Даша больше не мажет эту серую дрянь.',
    ],
  },

  [RUNNER_ID]: {
    name: 'Клим Заготовщик',
    isFemale: false,
    faction: Faction.WILD,
    occupation: Occupation.STOREKEEPER,
    sprite: Occupation.STOREKEEPER,
    hp: 150, maxHp: 150, money: 115, speed: 0.95,
    inventory: [
      { defId: 'infected_mushroom', count: 1 },
      { defId: 'fake_pass', count: 1 },
      { defId: 'cigs', count: 2 },
    ],
    talkLines: [
      'Я не лечу. Я знаю, где желемыш растет без вопросов.',
      'Левин платит за сырой запас. Пациенты платят за слово "курс".',
      'Принесете зараженную шляпку - получите долю. Не приносите фамилию.',
    ],
    talkLinesPost: [
      'Доля у вас. Остальное пусть объясняет халат.',
      'Чем дешевле лечение, тем дороже молчание рядом с койкой.',
    ],
  },
};

registerSideQuest(DOCTOR_ID, NPC_DEFS[DOCTOR_ID], [
  {
    id: QUEST_BUY_TREATMENT,
    giverNpcId: DOCTOR_ID,
    type: QuestType.FETCH,
    desc: 'Левин Мазник: «Тридцать пять рублей за курс желемышной мази. Не лечение, но очередь до утра вы не выдержите.»',
    targetItem: 'money', targetCount: 35,
    rewardItem: 'antifungal_ointment', rewardCount: 1,
    extraRewards: [{ defId: 'forged_quarantine_clearance', count: 1 }],
    relationDelta: -4, xpReward: 20,
  },
]);

registerSideQuest(RUNNER_ID, NPC_DEFS[RUNNER_ID], [
  {
    id: QUEST_TAKE_CUT,
    giverNpcId: RUNNER_ID,
    type: QuestType.FETCH,
    desc: 'Клим Заготовщик: «Принесите зараженный гриб. Левин пустит его в мазь, а я отдам вашу долю без лишних фамилий.»',
    targetItem: 'infected_mushroom', targetCount: 1,
    rewardItem: 'fake_pass', rewardCount: 1,
    relationDelta: -8, xpReward: 25, moneyReward: 95,
  },
]);

registerSideQuest(RELATIVE_ID, NPC_DEFS[RELATIVE_ID], [
  {
    id: QUEST_WARN_PATIENT,
    giverNpcId: RELATIVE_ID,
    type: QuestType.TALK,
    desc: 'Лина Подмарлевая: «Скажите Даше, что мазь желемышная. От меня она слышит только панику.»',
    targetNpcId: PATIENT_ID,
    rewardItem: 'bandage', rewardCount: 1,
    relationDelta: 12, xpReward: 45, moneyReward: 20,
  },
]);

registerSideQuest(PATIENT_ID, NPC_DEFS[PATIENT_ID], [
  {
    id: QUEST_REPORT_MINISTRY,
    giverNpcId: PATIENT_ID,
    type: QuestType.TALK,
    desc: 'Даша Подмарлевая: «Если справка липовая, отнесите жалобу Вере Пропусковой. Пусть окно хотя бы спросит состав.»',
    targetNpcId: 'vera_propuskova',
    rewardItem: 'official_quarantine_clearance', rewardCount: 1,
    extraRewards: [{ defId: 'bandage', count: 2 }],
    relationDelta: 18, xpReward: 70, moneyReward: 35,
  },
]);

interface QuestOutcome {
  eventType: 'quest_completed' | 'quest_failed';
  targetName: string;
  outcome: string;
  severity: WorldEventSeverity;
  privacy: WorldEventPrivacy;
  tags: string[];
}

const QUEST_OUTCOMES: Record<string, QuestOutcome> = {
  [QUEST_WARN_PATIENT]: {
    eventType: 'quest_completed',
    targetName: 'Пациентку предупредили о желемышной мази; она отказалась от липового курса.',
    outcome: 'patient_saved',
    severity: 4,
    privacy: 'local',
    tags: ['patient_saved', 'warned'],
  },
  [QUEST_REPORT_MINISTRY]: {
    eventType: 'quest_completed',
    targetName: 'Жалоба на желемышный медугол ушла в пропускное бюро; липовое лечение раскрыто.',
    outcome: 'fraud_exposed',
    severity: 5,
    privacy: 'public',
    tags: ['fraud_exposed', 'patient_saved'],
  },
  [QUEST_BUY_TREATMENT]: {
    eventType: 'quest_failed',
    targetName: 'После покупки желемышного курса пациентке стало хуже; медугол списал это на очередь.',
    outcome: 'patient_harmed',
    severity: 4,
    privacy: 'local',
    tags: ['patient_harmed', 'buy_treatment'],
  },
  [QUEST_TAKE_CUT]: {
    eventType: 'quest_completed',
    targetName: 'Доля с липового медугла взята; новая партия желемыша пошла в лечение.',
    outcome: 'profit_taken',
    severity: 4,
    privacy: 'local',
    tags: ['profit_taken', 'patient_harmed'],
  },
};

function sourceSideQuestId(event: WorldEvent): string {
  const id = event.data?.sideQuestId;
  return typeof id === 'string' ? id : '';
}

registerWorldEventObserver((state, event) => {
  if (event.type !== 'quest_completed') return;
  const sideQuestId = sourceSideQuestId(event);
  const outcome = QUEST_OUTCOMES[sideQuestId];
  if (!outcome) return;

  publishEvent(state, {
    type: outcome.eventType,
    floor: FloorLevel.LIVING,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetName: outcome.targetName,
    severity: outcome.severity,
    privacy: outcome.privacy,
    tags: [CONTENT_TAG, 'zhelemish', 'medical_fraud', ...outcome.tags],
    data: {
      sourceQuestId: sideQuestId,
      outcome: outcome.outcome,
      rumorIds: ['room_medical_safe'],
    },
  });
});

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
  for (let r = 0; r <= 88; r += 4) {
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2 + 1.04;
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
      world.floorTex[ci] = Tex.F_TILE;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
  }

  const room: Room = {
    id: roomId,
    type: RoomType.MEDICAL,
    x: rx,
    y: ry,
    w: ROOM_W,
    h: ROOM_H,
    name: 'Липовый медугол желемыша',
    wallTex: Tex.TILE_W,
    floorTex: Tex.F_TILE,
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
      world.floorTex[ci] = Tex.F_TILE;
      world.roomMap[ci] = roomId;
    }
  }

  protectRoom(world, rx, ry, ROOM_W, ROOM_H, Tex.TILE_W, Tex.F_TILE);
  return room;
}

function addDoor(world: World, room: Room, x: number, y: number): void {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.DOOR;
  world.floorTex[ci] = Tex.F_TILE;
  world.roomMap[ci] = -1;
  world.doors.set(ci, { idx: ci, state: DoorState.CLOSED, roomA: room.id, roomB: -1, keyId: '', timer: 0 });
  room.doors.push(ci);
}

function connectSouth(world: World, room: Room): void {
  const doorX = world.wrap(room.x + Math.floor(room.w / 2));
  const doorY = world.wrap(room.y + room.h);
  addDoor(world, room, doorX, doorY);

  let cy = world.wrap(doorY + 1);
  for (let s = 0; s < 72; s++) {
    const ci = world.idx(doorX, cy);
    if (world.cells[ci] === Cell.FLOOR && !world.aptMask[ci]) break;
    if (!world.aptMask[ci]) {
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_TILE;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
    cy = world.wrap(cy + 1);
  }
}

function decorateRoom(world: World, room: Room): void {
  const rx = room.x;
  const ry = room.y;
  for (const [dx, dy, feature] of [
    [2, 1, Feature.LAMP], [ROOM_W - 3, 1, Feature.LAMP],
    [2, 3, Feature.DESK], [3, 3, Feature.DESK], [4, 3, Feature.CHAIR],
    [2, ROOM_H - 3, Feature.BED], [4, ROOM_H - 3, Feature.BED],
    [7, 4, Feature.TABLE], [8, 4, Feature.CHAIR],
    [ROOM_W - 4, 3, Feature.SINK], [ROOM_W - 3, 3, Feature.APPARATUS],
    [ROOM_W - 5, 7, Feature.SHELF], [ROOM_W - 4, 7, Feature.SHELF], [ROOM_W - 3, 7, Feature.SHELF],
    [10, ROOM_H - 3, Feature.SHELF], [11, ROOM_H - 3, Feature.SHELF],
  ] as const) {
    world.features[world.idx(rx + dx, ry + dy)] = feature;
  }
  world.wallTex[world.idx(rx + 6, ry - 1)] = Tex.POSTER_BASE + 18;
  stampSurfaceSplat(world, rx + ROOM_W - 5, ry + 8, 0.5, 0.5, 5, 0.35, 10446, 78, 112, 74, false);
}

function nextContainerId(world: World): number {
  let id = world.containers.reduce((mx, c) => Math.max(mx, c.id), 0) + 1;
  while (world.containerById.has(id)) id++;
  return id;
}

function addFakeMedContainer(
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
    inventory: inventory.map(i => ({ ...i })),
    capacitySlots: Math.max(6, inventory.length + 2),
    ownerNpcId: owner?.id,
    ownerName: owner?.name,
    faction,
    access,
    lockDifficulty: access === 'locked' ? 3 : undefined,
    discovered: true,
    tags: [CONTENT_TAG, 'zhelemish_stock', 'medical_fraud', ...tags],
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
  weapon?: string,
): Entity {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  return requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle,
    weapon,
    canGiveQuest: true,
    aiTarget: { x, y },
    extra: { isTraveler: false },
  });
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

function seedRoom(world: World, room: Room, entities: Entity[], nextId: { v: number }, doctor: Entity): void {
  addFakeMedContainer(
    world, room, ROOM_W - 5, 7, ContainerKind.MEDICAL_CABINET, 'Ящик желемышной мази', 'owner',
    [
      { defId: 'infected_mushroom', count: 2 },
      { defId: 'antifungal_ointment', count: 1 },
      { defId: 'iodine', count: 1 },
      { defId: 'forged_quarantine_clearance', count: 1 },
    ],
    ['counterfeit', 'theft', 'ointment'],
    doctor,
  );
  addFakeMedContainer(
    world, room, ROOM_W - 3, 7, ContainerKind.CASHBOX, 'Касса липового медугла', 'owner',
    [
      { defId: 'fake_pass', count: 1 },
      { defId: 'forged_quarantine_clearance', count: 2 },
      { defId: 'ration_stamp_pad', count: 1 },
    ],
    ['profit', 'theft', 'papers'],
    doctor,
  );
  addFakeMedContainer(
    world, room, 10, ROOM_H - 3, ContainerKind.SECRET_STASH, 'Серый пакет под каталкой', 'secret',
    [
      { defId: 'infected_mushroom', count: 1 },
      { defId: 'pills', count: 1 },
      { defId: 'filter_receipt', count: 1 },
    ],
    ['secret', 'sample'],
  );

  dropItem(entities, nextId, room.x + 3, room.y + 5, 'sealed_complaint');
  dropItem(entities, nextId, room.x + 8, room.y + 8, 'filter_receipt');
}

function generateFakeMedpostZhelemish(
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

  const doctor = spawnNpc(world, entities, nextId, room, DOCTOR_ID, 3, 4, Math.PI / 2);
  spawnNpc(world, entities, nextId, room, PATIENT_ID, 3, ROOM_H - 4, -Math.PI / 2);
  spawnNpc(world, entities, nextId, room, RELATIVE_ID, 7, ROOM_H - 4, -Math.PI / 2);
  spawnNpc(world, entities, nextId, room, RUNNER_ID, ROOM_W - 4, 4, Math.PI, 'knife');
  seedRoom(world, room, entities, nextId, doctor);

  genLog(`[AG104] Липовый медугол желемыша at (${pos.x}, ${pos.y}) room #${room.id}`);
  return { nextRoomId };
}

registerZoneContent(FAKE_MEDPOST_ZONE, 'Липовый медугол желемыша', generateFakeMedpostZhelemish);
