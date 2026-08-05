/* -- Monster 13: Белая Прислушка, local white-slime escort risk -- */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal, Cell, ContainerKind, DoorState, EntityType, Faction, Feature,
  FloorLevel, NpcState, Occupation, QuestType, RoomType, Tex,
  type ContainerAccess, type Entity, type GameState, type Room, type WorldContainer, type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { Spr } from '../../render/sprite_index';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { protectRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

export const BELAYA_PRISLUSHKA_ID = 'belaya_prislushka';
export const BELAYA_PRISLUSHKA_ZONE_HUD = 63;

const CONTENT_TAG = BELAYA_PRISLUSHKA_ID;
const OUTCOME_EVENT_TAG = 'belaya_prislushka_outcome';
const ROOM_NAME = 'Белая Прислушка';
const SOURCE_ROOM_NAME = 'Слуховая кладовая Прислушки';
const MAIN_W = 17;
const ROOM_H = 13;
const SOURCE_W = 7;
const TOTAL_W = MAIN_W + SOURCE_W + 1;
const RESCUE_MINUTES = 30;

const VICTIM_ID = 'm13_anya_prislushka';
const LIQUIDATOR_ID = 'm13_stepan_quiet_door';
const SCIENTIST_ID = 'm13_ira_white_sample';
const WITNESS_ID = 'm13_efim_quiet_act';

const RESCUE_QUEST = 'm13_rescue_anya_from_prislushka';
const CLEAR_QUEST = 'm13_cover_white_source';
const SAMPLE_QUEST = 'm13_take_risky_white_sample';
const LOST_QUEST = 'm13_write_off_prislushka_witness';

export const BELAYA_PRISLUSHKA_QUEST_IDS = {
  rescue: RESCUE_QUEST,
  sourceCleared: CLEAR_QUEST,
  sampled: SAMPLE_QUEST,
  lost: LOST_QUEST,
} as const;

const EVENT_TAGS = ['belaya_prislushka', 'monster', 'slime_white', 'compulsion'];

const NPC_DEFS: Record<string, PlotNpcDef> = {
  [VICTIM_ID]: {
    name: 'Аня Прислушка',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 72,
    maxHp: 80,
    money: 4,
    speed: 0.22,
    inventory: [{ defId: 'sealed_complaint', count: 1 }],
    talkLines: [
      'Тише. Из щели тянет холодом, и я всё время к ней поворачиваюсь.',
      'Фраза короткая. Если я повторяю её третий раз, тащите меня от двери.',
      'Я дойду только до порога. Потом уже не вспомню, зачем.',
      'Не стой перед пятном. Встань передо мной.',
    ],
    talkLinesPost: [
      'Меня вывели от двери. Фраза осталась там, где ей и место.',
      'Если я опять начну слушать стену, закрой мне обзор, не рот.',
    ],
    talkQuestResponse: 'Не громко. Веди к скамейке, спиной к белому. Я пойду, пока слышу свое имя.',
  },
  [LIQUIDATOR_ID]: {
    name: 'Степан Тихая Дверь',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 170,
    maxHp: 170,
    money: 36,
    speed: 0.9,
    inventory: [{ defId: 'pipe', count: 1 }, { defId: 'sealant_tube', count: 1 }],
    talkLines: [
      'Белое давит не на дверь, а на глаза. Поэтому людей разворачиваем спиной.',
      'Герметик на источник, людей в сторону, потом уже акты.',
      'Закрытая створка не спасает навсегда, но дает человеку время отойти и дышать.',
    ],
    talkLinesPost: [
      'Источник прикрыт. Теперь между ним и людьми герметик, железо и подпись.',
      'Если дверь откроется сама, не бей Аню. Уводи её за спину и бей то, что вышло.',
    ],
  },
  [SCIENTIST_ID]: {
    name: 'Ира Матовая Проба',
    isFemale: true,
    faction: Faction.SCIENTIST,
    occupation: Occupation.SCIENTIST,
    sprite: Occupation.SCIENTIST,
    hp: 88,
    maxHp: 88,
    money: 70,
    speed: 0.7,
    inventory: [{ defId: 'inspection_mirror', count: 1 }, { defId: 'antidep', count: 1 }],
    talkLines: [
      'Белую пробу берут быстро: зеркало, крышка, шаг назад.',
      'Если человек еще слушает источник, проба уже не чистая. Сначала спасение, потом стекло.',
      'Риск простой: тронете соскоб - шум пойдёт по вентиляции, и тварь придет на звук.',
    ],
    talkLinesPost: [
      'Проба матовая. Хорошо. Самые опасные вещи не блестят.',
      'Я передам Якову Давидовичу только протокол: вес, цвет, время вскрытия лотка.',
    ],
  },
  [WITNESS_ID]: {
    name: 'Ефим Тихий Акт',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 80,
    maxHp: 80,
    money: 14,
    speed: 0.65,
    inventory: [{ defId: 'blank_form', count: 1 }, { defId: 'cigs', count: 1 }],
    talkLines: [
      'Она повторяет одно и то же: "ещё тише". После третьего раза человек обычно идет к двери.',
      'На столе расписка. Подпишете - человека можно считать ушедшим добровольно.',
      'Я фиксирую выборы, особенно плохие. Домком потом спросит бумагу, а не совесть.',
    ],
    talkLinesPost: [
      'Акт закрыт. За дверью стало теснее, хотя людей там больше не должно быть.',
      'Иногда худшее решение тоже выглядит как порядок.',
    ],
  },
};

registerSideQuest(VICTIM_ID, NPC_DEFS[VICTIM_ID], [
  {
    id: RESCUE_QUEST,
    giverNpcId: VICTIM_ID,
    type: QuestType.TALK,
    desc: 'Аня Прислушка: «У вас полчаса, пока я не дошла до двери. Встаньте между мной и белым следом, назовите меня по имени и уведите от порога.»',
    targetNpcId: VICTIM_ID,
    targetFloor: FloorLevel.LIVING,
    targetRoomType: RoomType.MEDICAL,
    targetZoneTag: CONTENT_TAG,
    targetHint: 'Жилая зона: медико-общий угол Белой Прислушки; Аня медленно идет к слуховой кладовой.',
    rewardItem: 'antidep',
    rewardCount: 1,
    extraRewards: [{ defId: 'water', count: 1 }],
    relationDelta: 16,
    xpReward: 65,
    moneyReward: 18,
    timeLimitMinutes: RESCUE_MINUTES,
    eventTargetName: 'Аню Прислушку отвели от белого источника до того, как она открыла дверь.',
    eventSeverity: 4,
    eventPrivacy: 'witnessed',
    eventTags: [...EVENT_TAGS, 'rescue'],
    eventData: { outcome: 'rescued', rescueWindowMinutes: RESCUE_MINUTES, rumorIds: ['slime_white_look_away'] },
  },
]);

registerSideQuest(LIQUIDATOR_ID, NPC_DEFS[LIQUIDATOR_ID], [
  {
    id: CLEAR_QUEST,
    giverNpcId: LIQUIDATOR_ID,
    type: QuestType.FETCH,
    desc: 'Степан Тихая Дверь: «Закрой белый источник герметиком. Не жги при Ане: сначала убери взгляд, потом закрывай пятно.»',
    targetItem: 'sealant_tube',
    targetCount: 1,
    targetFloor: FloorLevel.LIVING,
    targetRoomType: RoomType.MEDICAL,
    targetZoneTag: CONTENT_TAG,
    targetHint: 'Жилая зона: Белая Прислушка, герметик лежит у инструментальной полки или приносится свой.',
    rewardItem: 'hermo_gasket',
    rewardCount: 1,
    extraRewards: [{ defId: 'bandage', count: 1 }],
    relationDelta: 12,
    xpReward: 50,
    moneyReward: 32,
    eventTargetName: 'Источник Белой Прислушки прикрыт герметиком.',
    eventSeverity: 4,
    eventPrivacy: 'local',
    eventTags: [...EVENT_TAGS, 'source_cleared'],
    eventData: { outcome: 'source_cleared', counterplay: 'sealant_tube', rumorIds: ['slime_white_look_away'] },
  },
]);

registerSideQuest(SCIENTIST_ID, NPC_DEFS[SCIENTIST_ID], [
  {
    id: SAMPLE_QUEST,
    giverNpcId: SCIENTIST_ID,
    type: QuestType.FETCH,
    desc: 'Ира Матовая Проба: «Возьмите белый соскоб из матового лотка и сразу верните мне. Лоток открывайте на вдохе, потом крышка и назад.»',
    targetItem: 'slime_sample_white',
    targetCount: 1,
    targetFloor: FloorLevel.LIVING,
    targetRoomType: RoomType.MEDICAL,
    targetZoneTag: CONTENT_TAG,
    targetHint: 'Жилая зона: Белая Прислушка, матовый лоток стоит у белого следа за внутренней дверью.',
    rewardItem: 'antidep',
    rewardCount: 1,
    extraRewards: [{ defId: 'psi_dust', count: 1 }],
    relationDelta: 10,
    xpReward: 75,
    moneyReward: 80,
    spawnMonstersOnAccept: 1,
    eventTargetName: 'Белая проба Прислушки передана ученым.',
    eventSeverity: 4,
    eventPrivacy: 'local',
    eventTags: [...EVENT_TAGS, 'sampled'],
    eventData: { outcome: 'sampled', riskyHarvest: true, rumorIds: ['slime_white_look_away'] },
  },
]);

registerSideQuest(WITNESS_ID, NPC_DEFS[WITNESS_ID], [
  {
    id: LOST_QUEST,
    giverNpcId: WITNESS_ID,
    type: QuestType.FETCH,
    desc: 'Ефим Тихий Акт: «Принеси расписку со стола. Если бумага подписана, Аня считается ушедшей сама, а мы считаем только последствия.»',
    targetItem: 'voluntary_receipt',
    targetCount: 1,
    targetFloor: FloorLevel.LIVING,
    targetRoomType: RoomType.MEDICAL,
    targetZoneTag: CONTENT_TAG,
    targetHint: 'Жилая зона: Белая Прислушка, расписка лежит на столе у предупреждающего экрана.',
    rewardItem: 'cigs',
    rewardCount: 1,
    relationDelta: -14,
    xpReward: 15,
    moneyReward: 4,
    spawnMonstersOnAccept: 1,
    abandonsSideQuestIds: [RESCUE_QUEST],
    eventTargetName: 'Свидетеля Белой Прислушки списали распиской.',
    eventSeverity: 5,
    eventPrivacy: 'witnessed',
    eventTags: [...EVENT_TAGS, 'lost'],
    eventData: { outcome: 'lost', riskyFailure: true, rumorIds: ['slime_white_look_away'] },
  },
]);

interface OutcomeDef {
  outcome: 'rescued' | 'lost' | 'sampled' | 'source_cleared';
  targetName: string;
  tags: string[];
  severity: 4 | 5;
}

const COMPLETED_OUTCOMES: Record<string, OutcomeDef> = {
  [RESCUE_QUEST]: {
    outcome: 'rescued',
    targetName: 'Белая Прислушка: свидетеля вывели от двери.',
    tags: ['rescue', 'rescued', 'witness'],
    severity: 4,
  },
  [CLEAR_QUEST]: {
    outcome: 'source_cleared',
    targetName: 'Белая Прислушка: источник закрыт герметиком.',
    tags: ['source_cleared', 'sealed'],
    severity: 4,
  },
  [SAMPLE_QUEST]: {
    outcome: 'sampled',
    targetName: 'Белая Прислушка: рискованная проба ушла ученым.',
    tags: ['sampled', 'sample'],
    severity: 4,
  },
  [LOST_QUEST]: {
    outcome: 'lost',
    targetName: 'Белая Прислушка: свидетеля списали у двери.',
    tags: ['lost', 'failure'],
    severity: 5,
  },
};

const FAILED_OUTCOMES: Record<string, OutcomeDef> = {
  [RESCUE_QUEST]: {
    outcome: 'lost',
    targetName: 'Белая Прислушка: срок спасения истек, свидетель дошел до двери.',
    tags: ['lost', 'deadline'],
    severity: 5,
  },
};

registerWorldEventObserver(handleBelayaPrislushkaOutcome);

function handleBelayaPrislushkaOutcome(state: GameState, event: WorldEvent): void {
  if (event.tags.includes(OUTCOME_EVENT_TAG)) return;
  if (event.type !== 'quest_completed' && event.type !== 'quest_failed') return;
  const sideQuestId = typeof event.data?.sideQuestId === 'string' ? event.data.sideQuestId : '';
  const outcome = event.type === 'quest_failed' ? FAILED_OUTCOMES[sideQuestId] : COMPLETED_OUTCOMES[sideQuestId];
  if (!outcome) return;

  publishEvent(state, {
    type: event.type,
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
    privacy: outcome.outcome === 'lost' ? 'witnessed' : 'local',
    tags: [OUTCOME_EVENT_TAG, ...EVENT_TAGS, ...outcome.tags],
    data: {
      sourceEventId: event.id,
      sideQuestId,
      outcome: outcome.outcome,
      roomName: ROOM_NAME,
      rumorIds: ['slime_white_look_away'],
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
    for (let k = 0; k < 28; k++) {
      const a = ((k + 13) / 28) * Math.PI * 2;
      const x = world.wrap(baseX + Math.round(Math.cos(a) * r));
      const y = world.wrap(baseY + Math.round(Math.sin(a) * r));
      if (areaClear(world, x, y)) return { x, y };
    }
  }
  return { x: world.wrap(baseX), y: world.wrap(baseY) };
}

function carveRoom(world: World, roomId: number, rx: number, ry: number, w: number, name: string, type: RoomType): Room {
  const room: Room = {
    id: roomId,
    type,
    x: world.wrap(rx),
    y: world.wrap(ry),
    w,
    h: ROOM_H,
    doors: [],
    sealed: false,
    name,
    apartmentId: -1,
    wallTex: Tex.TILE_W,
    floorTex: Tex.F_TILE,
  };
  world.rooms[room.id] = room;

  for (let dy = 0; dy < ROOM_H; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;
      world.cells[ci] = Cell.FLOOR;
      world.wallTex[ci] = Tex.TILE_W;
      world.floorTex[ci] = Tex.F_TILE;
      world.roomMap[ci] = room.id;
      world.features[ci] = Feature.NONE;
    }
  }

  protectRoom(world, room.x, room.y, room.w, room.h, Tex.TILE_W, Tex.F_TILE);
  return room;
}

function carveShell(world: World, rx: number, ry: number): void {
  for (let dy = -1; dy <= ROOM_H; dy++) {
    for (let dx = -1; dx <= TOTAL_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.TILE_W;
      world.floorTex[ci] = Tex.F_TILE;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
  }
}

function addDoor(world: World, x: number, y: number, roomA: Room, roomB: Room | null, state: DoorState): void {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.DOOR;
  world.wallTex[ci] = Tex.DOOR_METAL;
  world.floorTex[ci] = Tex.F_TILE;
  world.roomMap[ci] = -1;
  world.doors.set(ci, { idx: ci, state, roomA: roomA.id, roomB: roomB?.id ?? -1, keyId: '', timer: 0 });
  roomA.doors.push(ci);
  if (roomB) roomB.doors.push(ci);
}

function connectSouth(world: World, room: Room): void {
  const x = world.wrap(room.x + 5);
  const y = world.wrap(room.y + room.h);
  addDoor(world, x, y, room, null, DoorState.CLOSED);

  let cy = world.wrap(y + 1);
  for (let s = 0; s < 84; s++) {
    const ci = world.idx(x, cy);
    if (world.cells[ci] === Cell.FLOOR && !world.aptMask[ci]) break;
    if (!world.aptMask[ci] && world.cells[ci] !== Cell.LIFT) {
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_TILE;
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

function addDrop(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  x: number,
  y: number,
  defId: string,
  count = 1,
  data?: unknown,
): void {
  const wx = world.wrap(x);
  const wy = world.wrap(y);
  entities.push({
    id: nextId.v++,
    type: EntityType.ITEM_DROP,
    x: wx + 0.5,
    y: wy + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count, data }],
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
  x: number,
  y: number,
  kind: ContainerKind,
  name: string,
  access: ContainerAccess,
  inventory: WorldContainer['inventory'],
  tags: string[],
  owner?: Entity,
  faction = Faction.SCIENTIST,
): void {
  const wx = world.wrap(x);
  const wy = world.wrap(y);
  const ci = world.idx(wx, wy);
  world.addContainer({
    id: nextContainerId(world),
    x: wx,
    y: wy,
    floor: FloorLevel.LIVING,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind,
    name,
    inventory: inventory.map(i => ({ ...i })),
    capacitySlots: Math.max(4, inventory.length + 2),
    ownerNpcId: owner?.id,
    ownerName: owner?.name,
    faction,
    access,
    discovered: true,
    tags: [CONTENT_TAG, 'living', 'slime_white', 'compulsion', ...tags],
  });
}

function pathLine(world: World, sx: number, sy: number, ex: number, ey: number): number[] {
  const path: number[] = [];
  let x = sx;
  let y = sy;
  while (x !== ex) {
    x += x < ex ? 1 : -1;
    path.push(world.idx(x, y));
  }
  while (y !== ey) {
    y += y < ey ? 1 : -1;
    path.push(world.idx(x, y));
  }
  return path;
}

function spawnNpc(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  plotNpcId: string,
  x: number,
  y: number,
  angle: number,
  canGiveQuest: boolean,
  opts: { weapon?: string; compelledPath?: number[] } = {},
): Entity {
  const wx = world.wrap(x);
  const wy = world.wrap(y);
  const ai = {
    goal: opts.compelledPath ? AIGoal.GOTO : AIGoal.IDLE,
    tx: wx,
    ty: wy,
    path: opts.compelledPath ?? [],
    pi: 0,
    stuck: 0,
    timer: opts.compelledPath ? 600 : 0,
    npcState: opts.compelledPath ? NpcState.TRAVELING : undefined,
  };
  return requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, wx + 0.5, wy + 0.5, {
    angle,
    weapon: opts.weapon,
    canGiveQuest,
    extra: { ai, isTraveler: opts.compelledPath !== undefined },
  });
}

function decorate(world: World, main: Room, source: Room, entities: Entity[], nextId: { v: number }): void {
  const rx = main.x;
  const ry = main.y;
  const doorX = rx + MAIN_W;
  const cueY = ry + Math.floor(ROOM_H / 2);
  const sourceX = source.x + 3;
  const sourceY = source.y + Math.floor(ROOM_H / 2);

  for (const [x, y, feature] of [
    [rx + 2, ry + 2, Feature.DESK],
    [rx + 3, ry + 2, Feature.SCREEN],
    [rx + 5, ry + 3, Feature.CHAIR],
    [rx + 4, ry + ROOM_H - 3, Feature.BED],
    [rx + 7, ry + ROOM_H - 3, Feature.BED],
    [rx + 10, ry + 3, Feature.APPARATUS],
    [rx + 12, ry + 3, Feature.SINK],
    [rx + 13, ry + ROOM_H - 3, Feature.SHELF],
    [sourceX, sourceY, Feature.APPARATUS],
    [source.x + SOURCE_W - 2, source.y + 2, Feature.LAMP],
    [source.x + SOURCE_W - 2, source.y + ROOM_H - 3, Feature.SHELF],
  ] as const) {
    setFeature(world, x, y, feature);
  }

  world.wallTex[world.idx(rx + 3, ry - 1)] = Tex.SCREEN_BASE + 8;
  world.wallTex[world.idx(doorX - 1, ry - 1)] = Tex.POSTER_BASE + 41;
  stampSurfaceSplat(world, doorX - 2, cueY, 0.5, 0.5, 1.5, 0.3, 13001, 235, 235, 225, true);
  stampSurfaceSplat(world, doorX - 4, cueY + 1, 0.5, 0.5, 1.1, 0.22, 13002, 218, 222, 214, true);
  stampSurfaceSplat(world, sourceX, sourceY, 0.5, 0.5, 5.4, 0.45, 13003, 238, 240, 232, false);
  stampSurfaceSplat(world, sourceX + 2, sourceY - 2, 0.5, 0.5, 2.0, 0.24, 13004, 245, 245, 238, true);

  addDrop(world, entities, nextId, rx + 2, ry + 4, 'note', 1, {
    text: 'Белая Прислушка: экран просит тише. Если свидетель повторяет одну фразу, закройте ей обзор, уведите от двери, источник закрывайте после людей.',
  });
  addDrop(world, entities, nextId, rx + 3, ry + 3, 'voluntary_receipt');
  addDrop(world, entities, nextId, rx + 13, ry + ROOM_H - 4, 'sealant_tube');
  addDrop(world, entities, nextId, rx + 14, ry + ROOM_H - 4, 'inspection_mirror');
}

function seedContainers(world: World, main: Room, source: Room, scientist: Entity, liquidator: Entity): void {
  addContainer(
    world,
    source,
    source.x + 3,
    source.y + Math.floor(ROOM_H / 2),
    ContainerKind.MEDICAL_CABINET,
    'Матовый лоток белой Прислушки',
    'public',
    [{ defId: 'slime_sample_white', count: 1 }],
    ['sample', 'risky_harvest'],
    scientist,
  );
  addContainer(
    world,
    main,
    main.x + 13,
    main.y + ROOM_H - 3,
    ContainerKind.TOOL_LOCKER,
    'Тихая полка пломбировщика',
    'owner',
    [{ defId: 'sealant_tube', count: 1 }, { defId: 'hermo_gasket', count: 1 }, { defId: 'bandage', count: 1 }],
    ['source_cleared', 'liquidator_tools'],
    liquidator,
    Faction.LIQUIDATOR,
  );
}

function generateBelayaPrislushka(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zcx: number,
  zcy: number,
): { nextRoomId: number } {
  const pos = findOrigin(world, zcx, zcy);
  carveShell(world, pos.x, pos.y);
  const main = carveRoom(world, nextRoomId++, pos.x, pos.y, MAIN_W, ROOM_NAME, RoomType.MEDICAL);
  const source = carveRoom(world, nextRoomId++, pos.x + MAIN_W + 1, pos.y, SOURCE_W, SOURCE_ROOM_NAME, RoomType.STORAGE);
  addDoor(world, pos.x + MAIN_W, pos.y + Math.floor(ROOM_H / 2), main, source, DoorState.CLOSED);
  connectSouth(world, main);
  decorate(world, main, source, entities, nextId);

  const startX = pos.x + 4;
  const startY = pos.y + Math.floor(ROOM_H / 2);
  const path = pathLine(world, startX, startY, pos.x + MAIN_W + 4, startY);
  spawnNpc(world, entities, nextId, VICTIM_ID, startX, startY, 0, true, { compelledPath: path });
  const liquidator = spawnNpc(world, entities, nextId, LIQUIDATOR_ID, main.x + 11, main.y + ROOM_H - 4, -Math.PI / 2, true, { weapon: 'pipe' });
  const scientist = spawnNpc(world, entities, nextId, SCIENTIST_ID, main.x + 10, main.y + 4, 0, true);
  spawnNpc(world, entities, nextId, WITNESS_ID, main.x + 3, main.y + 2, Math.PI / 2, true);
  seedContainers(world, main, source, scientist, liquidator);

  genLog(`[M13] ${ROOM_NAME} at (${main.x}, ${main.y}) room #${main.id}, source #${source.id}`);
  return { nextRoomId };
}

registerZoneContent(BELAYA_PRISLUSHKA_ZONE_HUD, ROOM_NAME, generateBelayaPrislushka);
