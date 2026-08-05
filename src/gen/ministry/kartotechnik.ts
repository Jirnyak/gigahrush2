/* -- Картотечник: bounded Ministry document-objective harassment -- */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  Cell, ContainerKind, DoorState, EntityType, Faction, Feature, FloorLevel,
  MonsterKind, Occupation, QuestType, RoomType, Tex, msg,
  type Entity, type GameState, type Room, type WorldContainer, type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { Spr } from '../../render/sprite_index';
import { getRecentEvents, publishEvent, registerWorldEventObserver } from '../../systems/events';
import {
  type NextId, addItemDrop, createAdminRoom, setFeature, spawnAdminMonster, spawnAdminNpc,
} from '../admin_common';
import { genLog } from '../log';

const ROOM_NAME = 'Картотека невозможного алфавита';
const DECOY_QUEST = 'kartotechnik_blank_decoy';
const RECOVER_QUEST = 'kartotechnik_relocated_record';
const BURN_QUEST = 'kartotechnik_burn_wrong_index';
const BASE_TAGS = ['monster', 'documents', 'archive', 'kartotechnik', 'relocated_objective'] as const;
const RUMOR_IDS = ['ecology_pechateed_docs', 'ecology_paragraph_clause'] as const;

const LIDIA_DEF: PlotNpcDef = {
  name: 'Лидия Алфавитная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 105, maxHp: 105, money: 55, speed: 0.75,
  inventory: [
    { defId: 'blank_form', count: 2 },
    { defId: 'ink_bottle', count: 1 },
  ],
  talkLines: [
    'Картотечник не ест дело сразу. Сначала он убеждает шкаф, что дело лежит не там.',
    'Пустой бланк можно подсунуть в жертвенный ящик. Тогда полка на минуту считает, что уже победила.',
    'Не стойте в прямой строке: Параграф стреляет лучше любого инспектора.',
    'Если ящики щелкают по алфавиту, которого нет, бегите к дальнему шкафу или открывайте средний проход ключом.',
  ],
  talkLinesPost: [
    'Пустота в бланке отвлекла полку. Теперь она сердится по инструкции.',
    'Ключ от среднего прохода ваш. Не спорьте с ним у живого шкафа.',
  ],
};

const PAVEL_DEF: PlotNpcDef = {
  name: 'Павел Недоописанный',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 115, maxHp: 115, money: 40, speed: 0.7,
  inventory: [
    { defId: 'denunciation', count: 1 },
    { defId: 'temp_pass', count: 1 },
  ],
  talkLines: [
    'Мое личное дело пошло в дальний ящик без ног. Это хуже кражи: кражу хотя бы видно.',
    'Найдите пропавшую папку. Она должна быть в шкафу невозможной буквы, если Картотечник не передумал.',
    'Берите по дороге бланки, но помните: печатеед считает человека папкой, если бумаги слишком много.',
  ],
  talkLinesPost: [
    'Дело вернулось. Теперь я снова числюсь ошибкой, а не пустым местом.',
    'Архив потерял уверенность. Это почти победа.',
  ],
};

const SEMYON_DEF: PlotNpcDef = {
  name: 'Семен Пепельный',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.DIRECTOR,
  sprite: Occupation.DIRECTOR,
  hp: 125, maxHp: 125, money: 70, speed: 0.68,
  inventory: [
    { defId: 'record_exposure_notice', count: 1 },
    { defId: 'cigs', count: 1 },
  ],
  talkLines: [
    'Неправильный индекс можно сжечь, пока он не стал правильным. Бумага ненавидит такую свободу.',
    'Акт о пропавшей записи нужен мне целым. Гореть должен указатель, а не доказательство.',
    'Чернила после такого пахнут дымом, зато Параграфы читают их медленнее.',
  ],
  talkLinesPost: [
    'Индекс сожжен. В шкафу осталась дырка, но по ней уже не найти нужную полку.',
    'Если услышите шелест, это уже не мой экземпляр.',
  ],
};

registerSideQuest('kartotechnik_lidia_alphabetnaya', LIDIA_DEF, [
  {
    id: DECOY_QUEST,
    giverNpcId: 'kartotechnik_lidia_alphabetnaya',
    type: QuestType.FETCH,
    desc: 'Лидия Алфавитная: «Подсуньте пустой бланк вместо живого дела. Дам ключ от среднего банка ящиков, пока Картотечник занят пустышкой.»',
    targetItem: 'blank_form', targetCount: 1,
    rewardItem: 'key', rewardCount: 1,
    extraRewards: [{ defId: 'ink_bottle', count: 1 }],
    relationDelta: 8, xpReward: 45, moneyReward: 25,
    targetFloor: FloorLevel.MINISTRY,
    targetRoomType: RoomType.OFFICE,
    targetZoneTag: 'archive',
    targetHint: `${ROOM_NAME}: пустой бланк лежит у переднего стола или в жертвенном ящике.`,
    eventSeverity: 4,
    eventTags: [...BASE_TAGS, 'protected'],
    eventData: {
      kartotechnik: true,
      outcome: 'protected',
      counterplay: 'blank_form_decoy',
      objectiveItem: 'missing_record_file',
      roomName: ROOM_NAME,
      rumorIds: RUMOR_IDS,
    },
  },
]);

registerSideQuest('kartotechnik_pavel_nedoopisanny', PAVEL_DEF, [
  {
    id: RECOVER_QUEST,
    giverNpcId: 'kartotechnik_pavel_nedoopisanny',
    type: QuestType.FETCH,
    desc: 'Павел Недоописанный: «Верните пропавшее личное дело из дальнего шкафа невозможной буквы. Если затянете, маршрут станет на один ящик длиннее.»',
    targetItem: 'missing_record_file', targetCount: 1,
    rewardItem: 'archive_access_permit', rewardCount: 1,
    extraRewards: [{ defId: 'blank_form', count: 1 }, { defId: 'ink_bottle', count: 1 }],
    relationDelta: 14, xpReward: 90, moneyReward: 100,
    targetFloor: FloorLevel.MINISTRY,
    targetRoomType: RoomType.OFFICE,
    targetZoneTag: 'archive',
    targetHint: `${ROOM_NAME}: дело переставлено в дальнюю картотеку рядом с Параграфом.`,
    timeLimitMinutes: 4 * 60,
    eventSeverity: 4,
    eventTags: [...BASE_TAGS, 'recovered'],
    eventData: {
      kartotechnik: true,
      outcome: 'relocated',
      objectiveItem: 'missing_record_file',
      localOnly: true,
      softlockGuard: 'objective remains in reachable container after deadline',
      roomName: ROOM_NAME,
      rumorIds: RUMOR_IDS,
    },
  },
]);

registerSideQuest('kartotechnik_semyon_pepelny', SEMYON_DEF, [
  {
    id: BURN_QUEST,
    giverNpcId: 'kartotechnik_semyon_pepelny',
    type: QuestType.FETCH,
    desc: 'Семен Пепельный: «Принесите акт о пропавшей записи из пепельницы. Неправильный индекс уже сожжен; теперь нужен след, а не пожар.»',
    targetItem: 'record_exposure_notice', targetCount: 1,
    rewardItem: 'ink_bottle', rewardCount: 2,
    extraRewards: [{ defId: 'blank_form', count: 1 }],
    relationDelta: 6, xpReward: 55, moneyReward: 45,
    targetFloor: FloorLevel.MINISTRY,
    targetRoomType: RoomType.OFFICE,
    targetZoneTag: 'archive',
    targetHint: `${ROOM_NAME}: акт лежит в пепельнице неправильного индекса.`,
    eventSeverity: 3,
    eventTags: [...BASE_TAGS, 'burned'],
    eventData: {
      kartotechnik: true,
      outcome: 'burned_wrong_index',
      counterplay: 'burn_wrong_index',
      objectiveItem: 'missing_record_file',
      roomName: ROOM_NAME,
      rumorIds: RUMOR_IDS,
    },
  },
]);

type KartotechnikOutcome = 'relocated' | 'recovered' | 'protected' | 'burned' | 'delayed';

const OUTCOME_TEXT: Record<KartotechnikOutcome, string> = {
  relocated: 'Картотечник переставил дело в дальний шкаф. Маршрут стал на один ящик длиннее.',
  recovered: 'Пропавшее дело вернулось из невозможной буквы. Архив потерял добычу, но запомнил руки.',
  protected: 'Пустой бланк принял удар на себя. Ключ от среднего банка ящиков выдан.',
  burned: 'Неправильный индекс сожжен до маршрута. В архиве остался только акт о пропаже.',
  delayed: 'Срок дела истек. Папка не исчезла, но Картотечник успел переписать путь к ней.',
};

function outcomeTags(outcome: KartotechnikOutcome): string[] {
  return [...BASE_TAGS, outcome].slice(0, 8);
}

function sideQuestIdFrom(event: WorldEvent): string | undefined {
  const id = event.data?.sideQuestId;
  return typeof id === 'string' ? id : undefined;
}

function alreadyPublished(state: GameState, sideQuestId: string, outcome: KartotechnikOutcome): boolean {
  return getRecentEvents(state, { tags: ['kartotechnik', outcome], limit: 8 })
    .some(event => event.data?.sideQuestId === sideQuestId);
}

function publishKartotechnikOutcome(
  state: GameState,
  sideQuestId: string,
  outcome: KartotechnikOutcome,
  sourceEventId: number,
): void {
  if (alreadyPublished(state, sideQuestId, outcome)) return;
  const severity = outcome === 'delayed' || outcome === 'relocated' ? 4 : 3;
  publishEvent(state, {
    type: 'rumor_observed',
    floor: FloorLevel.MINISTRY,
    actorName: 'Картотечник',
    targetName: OUTCOME_TEXT[outcome],
    itemId: 'missing_record_file',
    monsterKind: outcome === 'protected' ? MonsterKind.PECHATEED : MonsterKind.PARAGRAPH,
    severity,
    privacy: 'local',
    tags: outcomeTags(outcome),
    data: {
      sideQuestId,
      outcome,
      sourceEventId,
      objectiveItem: 'missing_record_file',
      roomName: ROOM_NAME,
      localOnly: true,
      rumorIds: RUMOR_IDS,
    },
  });
  state.msgs.push(msg(OUTCOME_TEXT[outcome], state.time, outcome === 'delayed' ? '#fa8' : '#d8a'));
}

function handleKartotechnikEvent(state: GameState, event: WorldEvent): void {
  const sideQuestId = sideQuestIdFrom(event);
  if (!sideQuestId) return;
  if (event.type === 'quest_created' && sideQuestId === RECOVER_QUEST) {
    publishKartotechnikOutcome(state, sideQuestId, 'relocated', event.id);
    return;
  }
  if (event.type === 'quest_completed') {
    if (sideQuestId === DECOY_QUEST) publishKartotechnikOutcome(state, sideQuestId, 'protected', event.id);
    if (sideQuestId === RECOVER_QUEST) publishKartotechnikOutcome(state, sideQuestId, 'recovered', event.id);
    if (sideQuestId === BURN_QUEST) publishKartotechnikOutcome(state, sideQuestId, 'burned', event.id);
    return;
  }
  if (event.type === 'quest_failed' && sideQuestId === RECOVER_QUEST) {
    publishKartotechnikOutcome(state, sideQuestId, 'delayed', event.id);
  }
}

registerWorldEventObserver(handleKartotechnikEvent);

function addDoor(world: World, room: Room, x: number, y: number, state: DoorState, keyId: string): void {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.DOOR;
  world.wallTex[idx] = Tex.DOOR_METAL;
  world.features[idx] = Feature.NONE;
  world.doors.set(idx, {
    idx,
    state,
    roomA: room.id,
    roomB: room.id,
    keyId,
    timer: 0,
  });
  if (!room.doors.includes(idx)) room.doors.push(idx);
}

function addDrawerBank(world: World, room: Room, gateX: number, centerY: number): void {
  for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
    const ci = world.idx(gateX, y);
    world.cells[ci] = Cell.WALL;
    world.wallTex[ci] = Tex.MARBLE;
    world.features[ci] = Feature.NONE;
  }
  addDoor(world, room, gateX, room.y + 2, DoorState.CLOSED, '');
  addDoor(world, room, gateX, centerY, DoorState.LOCKED, 'key');
  addDoor(world, room, gateX, room.y + room.h - 3, DoorState.CLOSED, '');
}

function addReadableNote(entities: Entity[], nextId: NextId, x: number, y: number, text: string): void {
  entities.push({
    id: nextId.v++, type: EntityType.ITEM_DROP,
    x: x + 0.5, y: y + 0.5, angle: 0, pitch: 0,
    alive: true, speed: 0, sprite: Spr.ITEM_DROP,
    inventory: [{ defId: 'note', count: 1, data: { text } }],
  });
}

function nextContainerId(world: World): number {
  let id = world.containers.reduce((mx, c) => Math.max(mx, c.id), 0) + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addKartotechnikContainer(
  world: World,
  room: Room,
  x: number,
  y: number,
  kind: ContainerKind,
  name: string,
  access: WorldContainer['access'],
  inventory: WorldContainer['inventory'],
  tags: string[],
  opts: { faction?: Faction; ownerNpcId?: number; ownerName?: string; capacitySlots?: number } = {},
): void {
  const wx = world.wrap(x);
  const wy = world.wrap(y);
  const container: WorldContainer = {
    id: nextContainerId(world),
    x: wx,
    y: wy,
    floor: FloorLevel.MINISTRY,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(wx, wy)],
    kind,
    name,
    inventory,
    capacitySlots: opts.capacitySlots ?? Math.max(6, inventory.length + 2),
    ownerNpcId: opts.ownerNpcId,
    ownerName: opts.ownerName,
    faction: opts.faction,
    access,
    discovered: true,
    tags,
  };
  world.addContainer(container);
  setFeature(world, wx, wy, kind === ContainerKind.TRASH_BIN ? Feature.TABLE : Feature.SHELF);
}

function decorateKartotechnikRoom(world: World, room: Room, gateX: number, centerY: number): void {
  for (let x = room.x + 2; x < gateX - 2; x++) setFeature(world, x, room.y + 3, Feature.DESK);
  for (let x = room.x + 3; x < gateX - 2; x += 3) setFeature(world, x, room.y + 4, Feature.CHAIR);
  for (let y = room.y + 1; y < room.y + room.h - 1; y += 2) {
    setFeature(world, room.x + 1, y, Feature.SHELF);
    setFeature(world, room.x + room.w - 2, y, Feature.SHELF);
  }
  for (let i = 0; i < 5; i++) {
    setFeature(world, gateX + 2 + i, room.y + 2 + i, Feature.SHELF);
  }
  for (let x = gateX + 3; x < room.x + room.w - 3; x += 3) {
    setFeature(world, x, room.y + room.h - 3, Feature.SHELF);
  }
  setFeature(world, gateX - 2, centerY, Feature.LAMP);
  setFeature(world, gateX + 3, centerY - 2, Feature.LAMP);
  setFeature(world, gateX + 6, centerY + 3, Feature.SCREEN);
  world.wallTex[world.idx(room.x + 6, room.y - 1)] = Tex.POSTER_BASE + 34;
  world.wallTex[world.idx(room.x + room.w, centerY)] = Tex.PORTRAIT_BASE + 44;
  stampSurfaceSplat(world, gateX + 4, centerY, 0.5, 0.55, 0.65, 115, room.id * 1009 + 5, 44, 36, 24, false);
}

export function generateKartotechnikArchive(
  world: World, nextRoomId: number, entities: Entity[], nextId: NextId, spawnX: number, spawnY: number,
): { nextRoomId: number } {
  const room = createAdminRoom(world, nextRoomId, spawnX, spawnY, {
    type: RoomType.OFFICE,
    name: ROOM_NAME,
    w: 21, h: 13,
    minDist: 75, maxDist: 190,
    wallTex: Tex.MARBLE,
    floorTex: Tex.F_PARQUET,
  });
  if (!room) return { nextRoomId };

  const centerY = room.y + Math.floor(room.h / 2);
  const gateX = room.x + 11;
  addDrawerBank(world, room, gateX, centerY);
  decorateKartotechnikRoom(world, room, gateX, centerY);

  addItemDrop(entities, nextId, room.x + 2, room.y + room.h - 2, 'blank_form', 1);
  addItemDrop(entities, nextId, room.x + 4, room.y + room.h - 2, 'ink_bottle', 1);
  addReadableNote(
    entities, nextId, gateX - 3, room.y + 2,
    'Ящики открываются по невозможному алфавиту. Пустой бланк отвлекает полку; дальний шкаф держит переставленное дело.',
  );

  const lidiaId = nextId.v;
  spawnAdminNpc(entities, nextId, LIDIA_DEF, 'kartotechnik_lidia_alphabetnaya', room.x + 3, room.y + 2);
  const pavelId = nextId.v;
  spawnAdminNpc(entities, nextId, PAVEL_DEF, 'kartotechnik_pavel_nedoopisanny', gateX - 2, centerY + 3);
  spawnAdminNpc(entities, nextId, SEMYON_DEF, 'kartotechnik_semyon_pepelny', room.x + 6, room.y + 2);

  addKartotechnikContainer(
    world, room, room.x + 2, centerY + 2,
    ContainerKind.FILING_CABINET,
    'Жертвенный ящик пустых бланков',
    'public',
    [
      { defId: 'blank_form', count: 2 },
      { defId: 'ink_bottle', count: 1 },
    ],
    ['monster', 'documents', 'archive', 'kartotechnik', 'decoy', 'protected_objective'],
    { ownerNpcId: lidiaId, ownerName: LIDIA_DEF.name },
  );
  addKartotechnikContainer(
    world, room, gateX + 2, room.y + room.h - 3,
    ContainerKind.TRASH_BIN,
    'Пепельница неправильного индекса',
    'public',
    [
      { defId: 'record_exposure_notice', count: 1 },
      { defId: 'denunciation', count: 1 },
    ],
    ['monster', 'documents', 'archive', 'kartotechnik', 'burned_wrong_index', 'counterplay'],
  );
  addKartotechnikContainer(
    world, room, room.x + room.w - 3, centerY - 2,
    ContainerKind.FILING_CABINET,
    'Шкаф невозможной буквы',
    'owner',
    [
      { defId: 'missing_record_file', count: 1 },
      { defId: 'blank_form', count: 1 },
      { defId: 'ink_bottle', count: 1 },
    ],
    ['monster', 'documents', 'archive', 'kartotechnik', 'relocated_objective', 'paper', 'theft'],
    { faction: Faction.CITIZEN, ownerNpcId: pavelId, ownerName: PAVEL_DEF.name },
  );

  spawnAdminMonster(world, entities, nextId, gateX + 3, centerY, MonsterKind.PARAGRAPH);
  spawnAdminMonster(world, entities, nextId, gateX + 6, centerY + 3, MonsterKind.PECHATEED);

  genLog(`[MONSTER_05_KARTOTECHNIK] ${ROOM_NAME} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId: room.id + 1 };
}
