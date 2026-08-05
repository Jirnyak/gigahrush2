/* -- Голос За Дверью: bounded Living threshold encounter -------- */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal, Cell, ContainerKind, DoorState, EntityType, Faction, Feature,
  FloorLevel, MonsterKind, Occupation, QuestType, RoomType, Tex,
  type Entity, type GameState, type Room, type WorldContainer, type WorldEvent, type WorldEventType,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { Spr, monsterSpr } from '../../render/sprite_index';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { protectRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

export const GOLOS_CONTENT_TAG = 'golos_za_dveryu';
export const GOLOS_ROOM_NAME = 'Порог знакомого голоса';
export const GOLOS_BACK_ROOM_NAME = 'Квартира за голосом';
export const GOLOS_ZONE_HUD = 56;
export const GOLOS_MARK_QUEST = 'golos_mark_lure_door';
export const GOLOS_REPAIR_QUEST = 'golos_repair_lure_seal';
export const GOLOS_REPORT_QUEST = 'golos_leave_for_liquidators';
export const GOLOS_CLEAR_QUEST = 'golos_clear_lure_body';

const OUTCOME_TAG = 'golos_voice_outcome';
const FRONT_W = 11;
const BACK_W = 8;
const ROOM_H = 12;
const TOTAL_W = FRONT_W + 1 + BACK_W;

const MARKER_ID = 'golos_lenya_marker';
const LIQUIDATOR_ID = 'golos_yuriy_plomba';
const REPORTER_ID = 'golos_zoya_sosedka';
const HUNTER_ID = 'golos_klava_sluhachka';

const NPC_DEFS: Record<string, PlotNpcDef> = {
  [MARKER_ID]: {
    name: 'Лёня Меточный',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.LOCKSMITH,
    sprite: Occupation.LOCKSMITH,
    hp: 95,
    maxHp: 95,
    money: 18,
    speed: 0.78,
    inventory: [{ defId: 'duct_tape', count: 1 }, { defId: 'note', count: 1 }],
    talkLines: [
      'Голос за дверью знает имя, но путает кухню, отчество и год самосбора. Живые так не ошибаются.',
      'Я пометил косяк лентой. Если очень надо слушать - слушай с шага назад.',
      'Дверь дергается на третий стук. Первые два она делает для доверия.',
    ],
    talkLinesPost: [
      'Метка держится. Теперь хотя бы видно, какую дверь не надо жалеть.',
      'Если метку сорвали, снова вешай ленту. Без метки кто-нибудь поверит голосу и сунет руку к ручке.',
    ],
  },
  [LIQUIDATOR_ID]: {
    name: 'Юрий Пломба',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 170,
    maxHp: 170,
    money: 54,
    speed: 0.92,
    inventory: [{ defId: 'wrench', count: 1 }, { defId: 'siren_shard', count: 1 }],
    talkLines: [
      'Не открывайте на знакомый голос. Знакомые стучат руками, а это стучит мясом в петлю.',
      'Герметик по петле, лента по косяку, акт на стол. Потом уже ликвидаторы спорят с тем, что осталось внутри.',
      'Если все же откроете, отходите в общий угол. Нелюдь любит, когда человек сам сокращает дистанцию.',
    ],
    talkLinesPost: [
      'Пломба не лечит дверь. Она фиксирует петлю, чтобы никто не дернул ручку по глупости.',
      'За этой створкой теперь тише. Не идеально, но тише.',
    ],
  },
  [REPORTER_ID]: {
    name: 'Зоя Соседка',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.HOUSEWIFE,
    sprite: Occupation.HOUSEWIFE,
    hp: 85,
    maxHp: 85,
    money: 16,
    speed: 0.82,
    inventory: [{ defId: 'water_coupon', count: 1 }, { defId: 'bread', count: 1 }],
    talkLines: [
      'Он зовет голосом моего брата. Брата нет с прошлого мокрого самосбора, а голос просит открыть как после смены.',
      'Отойдите от двери. Если надо помочь - позовите Юрия. Если надо доказать - оставьте записку, а не руку.',
      'Запах сырого мяса идет снизу. В нормальной квартире так пахнет только после плохой кастрюли, а кастрюли там нет.',
    ],
    talkLinesPost: [
      'Ликвидатор видел метку. Значит, я не одна слышала чужой голос.',
      'Теперь, когда стучат, я сначала смотрю на косяк.',
    ],
  },
  [HUNTER_ID]: {
    name: 'Клава Слухачка',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 80,
    maxHp: 80,
    money: 22,
    speed: 0.75,
    inventory: [{ defId: 'inspection_mirror', count: 1 }, { defId: 'bandage', count: 1 }],
    talkLines: [
      'Я слушала через зеркало. За дверью кто-то улыбается до того, как слышит вопрос.',
      'Если решите чистить, не стойте в проеме. Открыли - назад, угол, свет, потом стреляйте.',
      'В банке с голосом иногда остается кусок правды. Брать ее лучше после выстрела, а не до.',
    ],
    talkLinesPost: [
      'Банка закрыта и подписана. Теперь это не голос в коридоре, а вещдок на полке.',
      'После зачистки дверь не трогайте до обхода. Петля мокрая, ручку может закусить.',
    ],
  },
};

registerSideQuest(MARKER_ID, NPC_DEFS[MARKER_ID], [{
  id: GOLOS_MARK_QUEST,
  giverNpcId: MARKER_ID,
  type: QuestType.FETCH,
  desc: 'Лёня Меточный: «Дай изоленту. Пометим дверь, чтобы следующий не открывал на родной голос и сырой запах.»',
  targetItem: 'duct_tape',
  targetCount: 1,
  rewardItem: 'siren_instruction',
  rewardCount: 1,
  extraRewards: [{ defId: 'water_coupon', count: 1 }],
  relationDelta: 8,
  xpReward: 35,
  moneyReward: 15,
  eventSeverity: 4,
  eventTargetName: 'Дверь с чужим голосом помечена до вскрытия.',
  eventTags: [GOLOS_CONTENT_TAG, 'monster', 'door_lure', 'samosbor_aftermath', 'marked'],
  eventData: { outcome: 'marked', rumorIds: ['samosbor_doors_lie', 'ecology_nelyud_close'] },
}]);

registerSideQuest(LIQUIDATOR_ID, NPC_DEFS[LIQUIDATOR_ID], [{
  id: GOLOS_REPAIR_QUEST,
  giverNpcId: LIQUIDATOR_ID,
  type: QuestType.FETCH,
  desc: 'Юрий Пломба: «Один тюбик герметика - и я дожму петлю. Открывать не надо, если можно зафиксировать ручку и сдать дверь обходу.»',
  targetItem: 'sealant_tube',
  targetCount: 1,
  rewardItem: 'hermo_gasket',
  rewardCount: 1,
  extraRewards: [{ defId: 'siren_shard', count: 1 }],
  relationDelta: 12,
  xpReward: 55,
  moneyReward: 35,
  eventSeverity: 4,
  eventTargetName: 'Петля двери с чужим голосом закрыта герметиком.',
  eventTags: [GOLOS_CONTENT_TAG, 'monster', 'door_lure', 'samosbor_aftermath', 'repaired'],
  eventData: { outcome: 'repaired', rumorIds: ['samosbor_airlock_truth', 'ecology_nelyud_close'] },
}]);

registerSideQuest(REPORTER_ID, NPC_DEFS[REPORTER_ID], [{
  id: GOLOS_REPORT_QUEST,
  giverNpcId: REPORTER_ID,
  type: QuestType.TALK,
  targetPlotNpcId: LIQUIDATOR_ID,
  desc: 'Зоя Соседка: «Скажите Юрию Пломбе, что голос за дверью зовет моим братом. Пусть это останется работой ликвидаторов, а не нашей ошибкой.»',
  rewardItem: 'water_coupon',
  rewardCount: 1,
  extraRewards: [{ defId: 'note', count: 1 }],
  relationDelta: 9,
  xpReward: 30,
  moneyReward: 20,
  eventSeverity: 4,
  eventTargetName: 'Дверь с чужим голосом оставлена ликвидаторам.',
  eventTags: [GOLOS_CONTENT_TAG, 'monster', 'door_lure', 'samosbor_aftermath', 'reported'],
  eventData: { outcome: 'reported', rumorIds: ['samosbor_doors_lie', 'samosbor_airlock_truth'] },
}]);

registerSideQuest(HUNTER_ID, NPC_DEFS[HUNTER_ID], [{
  id: GOLOS_CLEAR_QUEST,
  giverNpcId: HUNTER_ID,
  type: QuestType.KILL,
  desc: 'Клава Слухачка: «Если откроете, делайте это нарочно. Убейте нелюдь за дверью и заберите банку, пока она не заговорила вашим голосом.»',
  targetMonsterKind: MonsterKind.NELYUD,
  killNeeded: 1,
  rewardItem: 'bottled_voice',
  rewardCount: 1,
  extraRewards: [{ defId: 'siren_shard', count: 1 }],
  relationDelta: 11,
  xpReward: 90,
  moneyReward: 45,
  eventSeverity: 5,
  eventTargetName: 'Голос За Дверью выпущен и зачищен.',
  eventTags: [GOLOS_CONTENT_TAG, 'monster', 'door_lure', 'samosbor_aftermath', 'cleared'],
  eventData: { outcome: 'cleared', rumorIds: ['ecology_nelyud_close', 'lead_hell_contact_cell_voice'] },
}]);

interface OutcomeDef {
  type: WorldEventType;
  outcome: string;
  targetName: string;
  severity: 3 | 4 | 5;
  tags: string[];
  rumorIds: string[];
  itemId?: string;
  monsterKind?: MonsterKind;
}

const OUTCOMES: Record<string, OutcomeDef> = {
  [GOLOS_MARK_QUEST]: {
    type: 'door_sealed',
    outcome: 'marked',
    targetName: 'Голос За Дверью: порог помечен.',
    severity: 4,
    tags: ['marked', 'warning'],
    rumorIds: ['samosbor_doors_lie', 'ecology_nelyud_close'],
    itemId: 'duct_tape',
    monsterKind: MonsterKind.NELYUD,
  },
  [GOLOS_REPAIR_QUEST]: {
    type: 'door_sealed',
    outcome: 'repaired',
    targetName: 'Голос За Дверью: петля загерметизирована.',
    severity: 4,
    tags: ['repaired', 'counterplay'],
    rumorIds: ['samosbor_airlock_truth', 'ecology_nelyud_close'],
    itemId: 'sealant_tube',
    monsterKind: MonsterKind.NELYUD,
  },
  [GOLOS_REPORT_QUEST]: {
    type: 'door_sealed',
    outcome: 'reported',
    targetName: 'Голос За Дверью: оставлен ликвидаторам.',
    severity: 4,
    tags: ['reported', 'avoided'],
    rumorIds: ['samosbor_doors_lie', 'samosbor_airlock_truth'],
    monsterKind: MonsterKind.NELYUD,
  },
  [GOLOS_CLEAR_QUEST]: {
    type: 'door_opened',
    outcome: 'cleared',
    targetName: 'Голос За Дверью: нелюдь раскрыта.',
    severity: 5,
    tags: ['opened', 'cleared'],
    rumorIds: ['ecology_nelyud_close', 'lead_hell_contact_cell_voice'],
    itemId: 'bottled_voice',
    monsterKind: MonsterKind.NELYUD,
  },
};

registerWorldEventObserver(handleGolosOutcome);

function handleGolosOutcome(state: GameState, event: WorldEvent): void {
  if (event.type !== 'quest_completed' || event.tags.includes(OUTCOME_TAG)) return;
  const sideQuestId = typeof event.data?.sideQuestId === 'string' ? event.data.sideQuestId : '';
  const outcome = OUTCOMES[sideQuestId];
  if (!outcome) return;

  publishEvent(state, {
    type: outcome.type,
    floor: FloorLevel.LIVING,
    zoneId: event.zoneId,
    roomId: event.roomId,
    x: event.x,
    y: event.y,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetName: outcome.targetName,
    itemId: outcome.itemId,
    monsterKind: outcome.monsterKind,
    severity: outcome.severity,
    privacy: 'local',
    tags: [OUTCOME_TAG, GOLOS_CONTENT_TAG, 'monster', 'door_lure', 'samosbor_aftermath', ...outcome.tags],
    data: {
      sourceEventId: event.id,
      sideQuestId,
      outcome: outcome.outcome,
      encounterId: GOLOS_CONTENT_TAG,
      rumorIds: outcome.rumorIds,
    },
  });
}

function areaClear(world: World, rx: number, ry: number): boolean {
  for (let dy = -1; dy <= ROOM_H; dy++) {
    for (let dx = -1; dx <= TOTAL_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) return false;
    }
  }
  return true;
}

function findOrigin(world: World, zcx: number, zcy: number): { x: number; y: number } {
  const baseX = zcx - Math.floor(TOTAL_W / 2);
  const baseY = zcy - Math.floor(ROOM_H / 2);
  for (let r = 0; r <= 96; r += 4) {
    for (let k = 0; k < 24; k++) {
      const a = ((k + 7) / 24) * Math.PI * 2;
      const x = world.wrap(baseX + Math.round(Math.cos(a) * r));
      const y = world.wrap(baseY + Math.round(Math.sin(a) * r));
      if (areaClear(world, x, y)) return { x, y };
    }
  }
  return { x: world.wrap(baseX), y: world.wrap(baseY) };
}

function carveRooms(world: World, nextRoomId: number, rx: number, ry: number): { front: Room; back: Room; nextRoomId: number } {
  for (let dy = -1; dy <= ROOM_H; dy++) {
    for (let dx = -1; dx <= TOTAL_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.cells[ci] === Cell.LIFT) continue;
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.PANEL;
      world.floorTex[ci] = Tex.F_CONCRETE;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
  }

  const front: Room = {
    id: nextRoomId++,
    type: RoomType.COMMON,
    x: world.wrap(rx),
    y: world.wrap(ry),
    w: FRONT_W,
    h: ROOM_H,
    doors: [],
    sealed: false,
    name: GOLOS_ROOM_NAME,
    apartmentId: -1,
    wallTex: Tex.PANEL,
    floorTex: Tex.F_CONCRETE,
  };
  const back: Room = {
    id: nextRoomId++,
    type: RoomType.LIVING,
    x: world.wrap(rx + FRONT_W + 1),
    y: world.wrap(ry),
    w: BACK_W,
    h: ROOM_H,
    doors: [],
    sealed: true,
    name: GOLOS_BACK_ROOM_NAME,
    apartmentId: -1,
    wallTex: Tex.PANEL,
    floorTex: Tex.F_LINO,
  };
  world.rooms[front.id] = front;
  world.rooms[back.id] = back;

  for (let dy = 0; dy < ROOM_H; dy++) {
    for (let dx = 0; dx < FRONT_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_CONCRETE;
      world.roomMap[ci] = front.id;
    }
    for (let dx = 0; dx < BACK_W; dx++) {
      const ci = world.idx(rx + FRONT_W + 1 + dx, ry + dy);
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_LINO;
      world.roomMap[ci] = back.id;
    }
  }

  protectRoom(world, rx, ry, TOTAL_W, ROOM_H, Tex.PANEL, Tex.F_CONCRETE);
  addLureDoor(world, front, back);
  connectSouth(world, front);
  return { front, back, nextRoomId };
}

function addLureDoor(world: World, front: Room, back: Room): void {
  const x = world.wrap(front.x + FRONT_W);
  const y = world.wrap(front.y + Math.floor(ROOM_H / 2));
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.DOOR;
  world.floorTex[ci] = Tex.F_CONCRETE;
  world.roomMap[ci] = -1;
  world.aptMask[ci] = 1;
  world.doors.set(ci, { idx: ci, state: DoorState.HERMETIC_CLOSED, roomA: front.id, roomB: back.id, keyId: '', timer: 0 });
  front.doors.push(ci);
  back.doors.push(ci);
}

function connectSouth(world: World, room: Room): void {
  const doorX = world.wrap(room.x + Math.floor(room.w / 2));
  const doorY = world.wrap(room.y + room.h);
  const doorI = world.idx(doorX, doorY);
  world.cells[doorI] = Cell.DOOR;
  world.floorTex[doorI] = Tex.F_CONCRETE;
  world.roomMap[doorI] = -1;
  world.aptMask[doorI] = 1;
  world.doors.set(doorI, { idx: doorI, state: DoorState.CLOSED, roomA: room.id, roomB: -1, keyId: '', timer: 0 });
  room.doors.push(doorI);

  let cy = world.wrap(doorY + 1);
  for (let s = 0; s < 78; s++) {
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

function addVoiceTraceContainer(world: World, room: Room): void {
  const x = world.wrap(room.x + room.w - 2);
  const y = world.wrap(room.y + room.h - 3);
  const container: WorldContainer = {
    id: nextContainerId(world),
    x,
    y,
    floor: FloorLevel.LIVING,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind: ContainerKind.SECRET_STASH,
    name: 'Банка под половицей за голосом',
    inventory: [
      { defId: 'bottled_voice', count: 1 },
      { defId: 'siren_shard', count: 1 },
      { defId: 'note', count: 1 },
    ],
    capacitySlots: 5,
    faction: Faction.CITIZEN,
    access: 'secret',
    discovered: false,
    tags: [GOLOS_CONTENT_TAG, 'living', 'monster', 'door_lure', 'bottled_voice', 'threshold'],
  };
  world.addContainer(container);
  setFeature(world, x, y, Feature.SHELF);
}

function spawnNpc(
  entities: Entity[],
  nextId: { v: number },
  plotNpcId: string,
  x: number,
  y: number,
  angle: number,
  weapon?: string,
): void {
  requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle,
    weapon,
    canGiveQuest: true,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
  });
}

function spawnGolosMonster(world: World, entities: Entity[], nextId: { v: number }, x: number, y: number): void {
  const def = MONSTERS[MonsterKind.NELYUD];
  const ci = world.idx(x, y);
  const zid = world.zoneMap[ci];
  const zoneLevel = (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 2) : 2;
  const hp = scaleMonsterHp(def.hp, zoneLevel);
  const monster: Entity = {
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.PI,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: monsterSpr(MonsterKind.NELYUD),
    name: 'Голос За Дверью',
    hp,
    maxHp: hp,
    monsterKind: MonsterKind.NELYUD,
    attackCd: 0,
    ai: { goal: AIGoal.IDLE, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
  };
  entities.push(monster);
}

function decorate(world: World, front: Room, back: Room, entities: Entity[], nextId: { v: number }): void {
  const fx = front.x;
  const fy = front.y;
  const bx = back.x;
  const by = back.y;
  const doorX = fx + FRONT_W;
  const doorY = fy + Math.floor(ROOM_H / 2);

  for (const [x, y, feature] of [
    [fx + 1, fy + 1, Feature.LAMP],
    [fx + 2, fy + 3, Feature.TABLE],
    [fx + 3, fy + 3, Feature.CHAIR],
    [fx + 6, fy + 3, Feature.SCREEN],
    [fx + 4, fy + ROOM_H - 3, Feature.DESK],
    [fx + 7, fy + ROOM_H - 3, Feature.CHAIR],
    [bx + 1, by + 2, Feature.BED],
    [bx + 2, by + 2, Feature.BED],
    [bx + BACK_W - 3, by + 3, Feature.SINK],
    [bx + BACK_W - 3, by + ROOM_H - 4, Feature.SHELF],
  ] as const) {
    setFeature(world, x, y, feature);
  }

  world.wallTex[world.idx(fx + 6, fy - 1)] = Tex.SCREEN_BASE + 12;
  world.wallTex[world.idx(doorX, doorY - 2)] = Tex.POSTER_BASE + 31;
  stampSurfaceSplat(world, doorX - 1, doorY, 0.5, 0.5, 3.8, 0.48, 101101, 92, 28, 26, false);
  stampSurfaceSplat(world, doorX, doorY, 0.54, 0.38, 0.6, 0.72, 101102, 9, 8, 8, true);
  stampSurfaceSplat(world, doorX, doorY - 1, 0.5, 0.7, 0.5, 0.58, 101103, 130, 32, 32, true);
  stampSurfaceSplat(world, bx + 2, by + ROOM_H - 3, 0.5, 0.5, 3.2, 0.36, 101104, 70, 22, 24, false);

  addDrop(entities, nextId, fx + 2, fy + ROOM_H - 3, 'duct_tape');
  addDrop(entities, nextId, fx + 3, fy + ROOM_H - 3, 'sealant_tube');
  addDrop(entities, nextId, fx + 4, fy + ROOM_H - 3, 'inspection_mirror');
  addDrop(entities, nextId, fx + 7, fy + 4, 'note');
  addVoiceTraceContainer(world, back);

  spawnNpc(entities, nextId, MARKER_ID, fx + 2, fy + 2, Math.PI / 2);
  spawnNpc(entities, nextId, LIQUIDATOR_ID, fx + 8, fy + 2, Math.PI, 'pipe');
  spawnNpc(entities, nextId, REPORTER_ID, fx + 2, fy + ROOM_H - 4, -Math.PI / 2);
  spawnNpc(entities, nextId, HUNTER_ID, fx + 8, fy + ROOM_H - 4, -Math.PI / 2);
  spawnGolosMonster(world, entities, nextId, bx + BACK_W - 3, by + Math.floor(ROOM_H / 2));
}

export function generateGolosZaDveryu(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zcx: number,
  zcy: number,
): { nextRoomId: number } {
  const pos = findOrigin(world, zcx, zcy);
  const rooms = carveRooms(world, nextRoomId, pos.x, pos.y);
  decorate(world, rooms.front, rooms.back, entities, nextId);

  genLog(`[MONSTER_01] ${GOLOS_ROOM_NAME} at (${rooms.front.x}, ${rooms.front.y}) rooms #${rooms.front.id}/#${rooms.back.id}`);
  return { nextRoomId: rooms.nextRoomId };
}

registerZoneContent(GOLOS_ZONE_HUD, GOLOS_ROOM_NAME, generateGolosZaDveryu);
