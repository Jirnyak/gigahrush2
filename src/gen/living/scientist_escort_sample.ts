/* ── AG72: scientist sample route, escort-like side quest ─────── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal, Cell, ContainerKind, DoorState, EntityType, Faction, Feature,
  FloorLevel, MonsterKind, Occupation, QuestType, RoomType, Tex,
  type ContainerAccess, type Entity, type Room, type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { protectRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

const CONTENT_TAG = 'ag72_scientist_escort_sample';
const SAMPLE_ZONE = 55;
const LAB_W = 19;
const LAB_H = 11;
const SAMPLE_W = 12;
const SAMPLE_H = 11;

const SCIENTIST_ID = 'ag72_scientist_ira_sample';
const CHECKPOINT_ID = 'ag72_checkpoint_pavel_sample';
const BROKER_ID = 'ag72_market_lera_sample';
const FORGER_ID = 'ag72_forger_egor_sample';

const EVENT_TAGS = ['ag72', 'escort', 'sample', 'science'];
const CHECKPOINT_QUEST = 'ag72_checkpoint_trust_route';
const DELIVER_QUEST = 'ag72_deliver_sealed_sample';
const SELL_QUEST = 'ag72_sell_sealed_sample_elsewhere';
const FAKE_QUEST = 'ag72_sell_fake_sample';
const REPORT_QUEST = 'ag72_report_unsealed_sample';
const HIDE_QUEST = 'ag72_hide_unsealed_sample';
const SAMPLE_BRANCH_QUESTS = [DELIVER_QUEST, SELL_QUEST, FAKE_QUEST, REPORT_QUEST, HIDE_QUEST] as const;

function branchBlockers(current: string): string[] {
  return SAMPLE_BRANCH_QUESTS.filter(id => id !== current);
}

const NPC_DEFS: Record<string, PlotNpcDef> = {
  [SCIENTIST_ID]: {
    name: 'Ира Пробиркина',
    isFemale: true,
    faction: Faction.SCIENTIST,
    occupation: Occupation.SCIENTIST,
    sprite: Occupation.SCIENTIST,
    hp: 120,
    maxHp: 120,
    money: 95,
    speed: 0.9,
    inventory: [
      { defId: 'nii_sample_container', count: 1 },
      { defId: 'antidep', count: 1 },
      { defId: 'note', count: 1 },
    ],
    talkLines: [
      'Образец белой слизи лежит в запертой пробной. Я не бегаю быстро, поэтому маршрут сначала проверяете вы.',
      'Павел на пропуске даст ключ, если поверит, что вы не тащите меня в коридор как приманку.',
      'Чистая проба нужна НИИ. Грязная нужна рынку. Поддельная нужна тем, кто путает премию с наукой.',
      'Если меня срежут по дороге, маршрут закрывайте. Образец без свидетеля быстро становится вещдоком без хозяина.',
      'Белая проба в целой пломбе идёт ко мне. Кривая пломба идёт Павлу рапортом или Егору в тайник, если вы решили испортить себе ночь.',
    ],
    talkLinesPost: [
      'Доверие в НИИ измеряют не словами, а тем, кто вернулся с пробой, пломбой и живым свидетелем.',
      'Фальшивку я отличу не сразу. Это, к сожалению, тоже научный результат.',
      'В пробной щель у нижней петли. Быстрее берите контейнер и не стойте под лампой.',
    ],
  },
  [CHECKPOINT_ID]: {
    name: 'Павел Пропускной',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 170,
    maxHp: 170,
    money: 45,
    speed: 1.0,
    inventory: [
      { defId: 'key', count: 1 },
      { defId: 'ammo_9mm', count: 10 },
      { defId: 'bandage', count: 1 },
    ],
    talkLines: [
      'Пропуск к пробной не выдают за любопытство. Учёная идёт только после зачистки маршрута.',
      'Ключ один. Потеряешь - дверь станет умнее нас обоих.',
      'Если сирена завоет, не тащи Иру геройствовать. Живая учёная дороже полной пробирки.',
      'Если найдёшь пробу с сорванной пломбой, не продавай её как чистую. Несёшь мне - будет рапорт, несёшь Егору - будет липовый акт.',
    ],
    talkLinesPost: [
      'Проход отмечен. Ключ у тебя, ответственность тоже.',
      'Слышишь скрежет? Это дверь цепляет нижней петлей, держись правой стены.',
    ],
    talkQuestResponse: 'Ира прислала? Ладно. Ключ бери, но сначала слушай коридор: тварь любит запах спирта и мокрой этикетки.',
  },
  [BROKER_ID]: {
    name: 'Лера Тихая Проба',
    isFemale: true,
    faction: Faction.WILD,
    occupation: Occupation.STOREKEEPER,
    sprite: Occupation.STOREKEEPER,
    hp: 90,
    maxHp: 90,
    money: 180,
    speed: 0.85,
    inventory: [
      { defId: 'nii_market_receipt', count: 1 },
      { defId: 'fake_pass', count: 1 },
      { defId: 'cigs', count: 3 },
    ],
    talkLines: [
      'Настоящую белую пробу НИИ ждёт долго, рынок - молча и сразу.',
      'Если принесёшь запечатанную пробу мне, учёная назовёт это предательством. Я назову это оплатой риска.',
      'Кривую тару я не беру как белую. Сорванная пломба продаёт не пробу, а твоё имя.',
    ],
    talkLinesPost: [
      'Расписка сухая. У НИИ теперь мокро в журнале.',
      'Не задерживайся. Чистые образцы быстро становятся грязными слухами.',
    ],
  },
  [FORGER_ID]: {
    name: 'Егор Бирочник',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 75,
    maxHp: 75,
    money: 50,
    speed: 0.75,
    inventory: [
      { defId: 'slime_sample_fake', count: 1 },
      { defId: 'nii_forged_audit', count: 1 },
      { defId: 'ink_bottle', count: 1 },
    ],
    talkLines: [
      'Фальшивая проба - это не ложь, а экономия на веществе.',
      'Бирка важнее содержимого, пока пробирку не трясут и не задают ей вопросы.',
      'Повреждённую белую пробу можно спрятать под аудитом. Это не спасает науку, зато спасает маршрут до следующей проверки.',
    ],
    talkLinesPost: [
      'Подделку приняли? Значит, не трясли.',
      'Наука любит чистый результат. Бухгалтерия любит результат с печатью.',
    ],
  },
};

registerSideQuest(SCIENTIST_ID, NPC_DEFS[SCIENTIST_ID], [
  {
    id: CHECKPOINT_QUEST,
    giverNpcId: SCIENTIST_ID,
    type: QuestType.TALK,
    desc: 'Ира Пробиркина: «Доведите меня до Павла у пробной. Сначала его допуск и зачистка коридора, потом ключ и пробирки.»',
    targetNpcId: CHECKPOINT_ID,
    targetFloor: FloorLevel.LIVING,
    targetRoomType: RoomType.MEDICAL,
    targetZoneTag: 'ag72_sample_checkpoint',
    targetHint: 'Жилая зона: лабораторный пост НИИ, Павел стоит у запертой пробной.',
    rewardItem: 'key',
    rewardCount: 1,
    extraRewards: [{ defId: 'nii_sample_container', count: 1 }],
    relationDelta: 8,
    xpReward: 45,
    moneyReward: 30,
    spawnMonstersOnAccept: 3,
    failOnNpcDeathPlotId: SCIENTIST_ID,
    eventTags: EVENT_TAGS,
  },
  {
    id: DELIVER_QUEST,
    giverNpcId: SCIENTIST_ID,
    type: QuestType.FETCH,
    desc: 'Ира Пробиркина: «Теперь ключ есть. Вынесите белую пробу из запертой комнаты и верните мне запечатанной. Грязную или липовую можно сдать, но доверие не вернётся.»',
    targetItem: 'slime_sample_white',
    targetCount: 1,
    targetFloor: FloorLevel.LIVING,
    targetRoomType: RoomType.MEDICAL,
    targetZoneTag: 'ag72_sample_site',
    targetHint: 'Жилая зона: запертая пробная НИИ за Павлом; белая проба лежит в холодном боксе.',
    rewardItem: 'psi_stabilizer',
    rewardCount: 1,
    extraRewards: [{ defId: 'filtered_water', count: 2 }, { defId: 'antidep', count: 1 }],
    relationDelta: 18,
    xpReward: 95,
    moneyReward: 180,
    requiresSideQuestDone: CHECKPOINT_QUEST,
    blockedBySideQuestIds: branchBlockers(DELIVER_QUEST),
    abandonsSideQuestIds: branchBlockers(DELIVER_QUEST),
    failOnNpcDeathPlotId: SCIENTIST_ID,
    eventTags: EVENT_TAGS,
    eventData: { branch: 'deliver_white_to_nii', sealed: true, witnessRequired: true, rumorIds: ['lead_living_white_sample_shift'] },
  },
]);

registerSideQuest(CHECKPOINT_ID, NPC_DEFS[CHECKPOINT_ID], [
  {
    id: REPORT_QUEST,
    giverNpcId: CHECKPOINT_ID,
    type: QuestType.FETCH,
    desc: 'Павел Пропускной: «Кривая белая проба не товар. Несите её мне, я закрою доступ рапортом о нарушении хранения, пока коридор не начал спорить голосами.»',
    targetItem: 'slime_sample_contaminated',
    targetCount: 1,
    targetFloor: FloorLevel.LIVING,
    targetRoomType: RoomType.MEDICAL,
    targetZoneTag: 'ag72_sample_site',
    targetHint: 'Жилая зона: запертая пробная НИИ. Криво запечатанную пробу сдайте Павлу как нарушение, не держите под лампой.',
    rewardItem: 'official_quarantine_clearance',
    rewardCount: 1,
    extraRewards: [{ defId: 'seal_wax', count: 1 }],
    requiresSideQuestDone: CHECKPOINT_QUEST,
    blockedBySideQuestIds: branchBlockers(REPORT_QUEST),
    abandonsSideQuestIds: branchBlockers(REPORT_QUEST),
    relationDelta: 9,
    xpReward: 60,
    moneyReward: 70,
    eventTags: ['ag72', 'sample', 'report', 'unsealed', 'white_slime', 'quarantine'],
    eventData: { branch: 'report_unsealed_white', sealed: false, rumorIds: ['nii_white_unsealed_report'] },
  },
]);

registerSideQuest(BROKER_ID, NPC_DEFS[BROKER_ID], [
  {
    id: SELL_QUEST,
    giverNpcId: BROKER_ID,
    type: QuestType.FETCH,
    desc: 'Лера Тихая Проба: «Принесёшь белую пробу мне, а не Ире, получишь деньги и расписку. НИИ потом назовёт это пропажей.»',
    targetItem: 'slime_sample_white',
    targetCount: 1,
    targetFloor: FloorLevel.LIVING,
    targetRoomType: RoomType.MEDICAL,
    targetZoneTag: 'ag72_sample_site',
    targetHint: 'Жилая зона: запертая пробная НИИ; продать можно только чистую белую пробу.',
    rewardItem: 'nii_market_receipt',
    rewardCount: 1,
    extraRewards: [{ defId: 'fake_pass', count: 1 }],
    requiresSideQuestDone: CHECKPOINT_QUEST,
    blockedBySideQuestIds: branchBlockers(SELL_QUEST),
    relationDelta: 5,
    xpReward: 70,
    moneyReward: 260,
    abandonsSideQuestIds: branchBlockers(SELL_QUEST),
    eventTags: ['ag72', 'sample', 'black_market', 'abandonment'],
    eventData: { branch: 'sell_white_black_market', sealed: true, rumorIds: ['market88_white_sample_no_lamp'] },
  },
]);

registerSideQuest(FORGER_ID, NPC_DEFS[FORGER_ID], [
  {
    id: FAKE_QUEST,
    giverNpcId: FORGER_ID,
    type: QuestType.FETCH,
    desc: 'Егор Бирочник: «Принеси липовую пробу с правильной биркой. Я закрою акт так, будто риск был научным.»',
    targetItem: 'slime_sample_fake',
    targetCount: 1,
    targetFloor: FloorLevel.LIVING,
    targetRoomType: RoomType.MEDICAL,
    targetZoneTag: 'ag72_sample_site',
    targetHint: 'Жилая зона: лабораторный стол НИИ; липовая проба лежит среди пустой тары.',
    rewardItem: 'nii_forged_audit',
    rewardCount: 1,
    extraRewards: [{ defId: 'cigs', count: 2 }],
    blockedBySideQuestIds: branchBlockers(FAKE_QUEST),
    abandonsSideQuestIds: branchBlockers(FAKE_QUEST),
    relationDelta: 3,
    xpReward: 35,
    moneyReward: 60,
    eventTags: ['ag72', 'sample', 'fake', 'black_market'],
    eventData: { branch: 'fake_sample_audit', sealed: false, rumorIds: ['nii_sample_hide_or_report'] },
  },
  {
    id: HIDE_QUEST,
    giverNpcId: FORGER_ID,
    type: QuestType.FETCH,
    desc: 'Егор Бирочник: «Кривую белую пробу можно спрятать под аудитом. НИИ увидит бумагу, рынок увидит тишину, а вы увидите, как быстро кончается доверие.»',
    targetItem: 'slime_sample_contaminated',
    targetCount: 1,
    targetFloor: FloorLevel.LIVING,
    targetRoomType: RoomType.MEDICAL,
    targetZoneTag: 'ag72_sample_site',
    targetHint: 'Жилая зона: запертая пробная НИИ. Криво запечатанную пробу можно скрыть у Егора вместо рапорта Павла.',
    rewardItem: 'nii_forged_audit',
    rewardCount: 1,
    extraRewards: [{ defId: 'cigs', count: 3 }],
    requiresSideQuestDone: CHECKPOINT_QUEST,
    blockedBySideQuestIds: branchBlockers(HIDE_QUEST),
    abandonsSideQuestIds: branchBlockers(HIDE_QUEST),
    relationDelta: 2,
    xpReward: 50,
    moneyReward: 90,
    eventTags: ['ag72', 'sample', 'hide', 'concealment', 'unsealed', 'white_slime', 'forgery'],
    eventData: { branch: 'hide_unsealed_white', sealed: false, rumorIds: ['nii_white_unsealed_report'] },
  },
]);

function areaClear(world: World, rx: number, ry: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) return false;
    }
  }
  return true;
}

function findOrigin(world: World, zcx: number, zcy: number): { x: number; y: number } {
  const fullW = LAB_W + 1 + SAMPLE_W;
  const baseX = zcx - Math.floor(fullW / 2);
  const baseY = zcy - Math.floor(LAB_H / 2);
  for (let r = 0; r <= 96; r += 4) {
    for (let k = 0; k < 28; k++) {
      const a = ((k + 5) / 28) * Math.PI * 2;
      const x = world.wrap(baseX + Math.round(Math.cos(a) * r));
      const y = world.wrap(baseY + Math.round(Math.sin(a) * r));
      if (areaClear(world, x, y, fullW, LAB_H)) return { x, y };
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
  type: RoomType,
  name: string,
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
    doors: [],
    sealed: false,
    name,
    apartmentId: -1,
    wallTex: Tex.PANEL,
    floorTex: Tex.F_LINO,
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

function addDoor(world: World, x: number, y: number, roomA: Room, roomB: Room | null, state: DoorState, keyId = ''): void {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.DOOR;
  world.wallTex[ci] = Tex.DOOR_METAL;
  world.floorTex[ci] = roomA.floorTex;
  world.roomMap[ci] = -1;
  world.doors.set(ci, { idx: ci, state, roomA: roomA.id, roomB: roomB?.id ?? -1, keyId, timer: 0 });
  roomA.doors.push(ci);
  if (roomB) roomB.doors.push(ci);
}

function connectSouth(world: World, room: Room): void {
  const doorX = world.wrap(room.x + Math.floor(room.w / 2));
  const doorY = world.wrap(room.y + room.h);
  addDoor(world, doorX, doorY, room, null, DoorState.CLOSED);

  let cy = world.wrap(doorY + 1);
  for (let s = 0; s < 84; s++) {
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

function decorate(world: World, lab: Room, sample: Room): void {
  for (let dx = 2; dx < lab.w - 2; dx += 3) setFeature(world, lab.x + dx, lab.y + 1, Feature.SHELF);
  for (const [x, y, feature] of [
    [lab.x + 2, lab.y + 3, Feature.DESK],
    [lab.x + 3, lab.y + 3, Feature.CHAIR],
    [lab.x + 8, lab.y + 4, Feature.APPARATUS],
    [lab.x + 12, lab.y + 4, Feature.SCREEN],
    [lab.x + lab.w - 3, lab.y + lab.h - 3, Feature.TABLE],
    [sample.x + 2, sample.y + 2, Feature.APPARATUS],
    [sample.x + sample.w - 3, sample.y + 2, Feature.LAMP],
    [sample.x + 3, sample.y + sample.h - 3, Feature.SINK],
    [sample.x + sample.w - 3, sample.y + sample.h - 3, Feature.SHELF],
  ] as const) {
    setFeature(world, x, y, feature);
  }
  world.wallTex[world.idx(lab.x + 12, lab.y - 1)] = Tex.SCREEN_BASE + 5;
  world.wallTex[world.idx(lab.x + 4, lab.y - 1)] = Tex.POSTER_BASE + 37;
  stampSurfaceSplat(world, sample.x + 5, sample.y + 5, 0.5, 0.5, 5, 0.42, 72072, 230, 235, 245, false);
  stampSurfaceSplat(world, sample.x + 8, sample.y + 6, 0.5, 0.5, 5, 0.32, 72073, 70, 120, 80, false);
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
  tags: string[],
  owner?: Entity,
  faction?: Faction,
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
    faction,
    access,
    lockDifficulty: access === 'locked' ? 4 : undefined,
    discovered: true,
    tags: [CONTENT_TAG, 'living', 'sample', ...tags],
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

function spawnMonsterNear(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  x: number,
  y: number,
  kind: MonsterKind,
  salt: number,
): void {
  const def = MONSTERS[kind];
  if (!def) return;
  for (let attempt = 0; attempt < 60; attempt++) {
    const a = salt + attempt * 0.7;
    const d = 4 + (attempt % 5);
    const mx = world.wrap(x + Math.round(Math.cos(a) * d));
    const my = world.wrap(y + Math.round(Math.sin(a) * d));
    const ci = world.idx(mx, my);
    if (world.cells[ci] !== Cell.FLOOR) continue;
    const zid = world.zoneMap[ci];
    const zoneLevel = (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 2) : 2;
    const hp = scaleMonsterHp(def.hp, zoneLevel);
    entities.push({
      id: nextId.v++,
      type: EntityType.MONSTER,
      x: mx + 0.5,
      y: my + 0.5,
      angle: Math.atan2(y - my, x - mx),
      pitch: 0,
      alive: true,
      speed: scaleMonsterSpeed(def.speed, zoneLevel),
      sprite: def.sprite,
      hp,
      maxHp: hp,
      monsterKind: kind,
      attackCd: 0,
      ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
      rpg: randomRPG(zoneLevel),
    });
    return;
  }
}

function seedContainers(world: World, lab: Room, sample: Room, scientist: Entity, broker: Entity, forger: Entity): void {
  addContainer(
    world, lab, 5, lab.h - 3, ContainerKind.MEDICAL_CABINET,
    'Стол пустой тары НИИ', 'public',
    [{ defId: 'nii_sample_container', count: 1 }, { defId: 'slime_sample_fake', count: 1 }, { defId: 'nii_forged_audit', count: 1 }],
    ['public', 'fake_sample', 'nii'],
    forger,
    Faction.CITIZEN,
  );
  addContainer(
    world, sample, sample.w - 3, 3, ContainerKind.METAL_CABINET,
    'Холодный бокс белой пломбы', 'owner',
    [{ defId: 'slime_sample_white', count: 1 }, { defId: 'slime_sample_contaminated', count: 1 }, { defId: 'slime_sample_brown', count: 1 }],
    ['sample_site', 'white_slime', 'sealed', 'unsealed_risk', 'contamination'],
    scientist,
    Faction.SCIENTIST,
  );
  addContainer(
    world, lab, lab.w - 3, lab.h - 3, ContainerKind.CASHBOX,
    'Тихая касса Леры', 'owner',
    [{ defId: 'nii_market_receipt', count: 1 }, { defId: 'fake_pass', count: 1 }, { defId: 'cigs', count: 2 }],
    ['black_market', 'sample_sale'],
    broker,
    Faction.WILD,
  );
}

function generateScientistEscortSample(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zcx: number,
  zcy: number,
): { nextRoomId: number } {
  const pos = findOrigin(world, zcx, zcy);
  const lab = carveRoom(world, nextRoomId++, pos.x, pos.y, LAB_W, LAB_H, RoomType.MEDICAL, 'Маршрутный пост НИИ Слизи');
  const sample = carveRoom(
    world,
    nextRoomId++,
    pos.x + LAB_W + 1,
    pos.y,
    SAMPLE_W,
    SAMPLE_H,
    RoomType.MEDICAL,
    'Запертая пробная белого остатка',
  );
  addDoor(world, pos.x + LAB_W, pos.y + Math.floor(LAB_H / 2), lab, sample, DoorState.LOCKED, 'key');
  connectSouth(world, lab);
  decorate(world, lab, sample);

  const scientist = spawnNpc(world, entities, nextId, lab, SCIENTIST_ID, 3, 4, 0);
  spawnNpc(world, entities, nextId, lab, CHECKPOINT_ID, LAB_W - 4, 5, Math.PI, 'makarov');
  const broker = spawnNpc(world, entities, nextId, lab, BROKER_ID, LAB_W - 5, LAB_H - 3, -Math.PI / 2);
  const forger = spawnNpc(world, entities, nextId, lab, FORGER_ID, 7, LAB_H - 3, -Math.PI / 2);

  seedContainers(world, lab, sample, scientist, broker, forger);
  spawnMonsterNear(world, entities, nextId, sample.x + 5, sample.y + 5, MonsterKind.SBORKA, 0.2);
  spawnMonsterNear(world, entities, nextId, sample.x + 8, sample.y + 4, MonsterKind.POLZUN, 2.4);
  spawnMonsterNear(world, entities, nextId, sample.x + 3, sample.y + 6, MonsterKind.SLIMEVIK, 4.1);

  genLog(`[AG72] ${lab.name} at (${lab.x}, ${lab.y}) room #${lab.id}, sample #${sample.id}`);
  return { nextRoomId };
}

registerZoneContent(SAMPLE_ZONE, 'Маршрут пробы НИИ', generateScientistEscortSample);
