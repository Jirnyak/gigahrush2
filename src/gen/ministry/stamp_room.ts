/* ── Комната печатей — Ministry admin POI ─────────────────────── */

import {
  ContainerKind,
  Tex,
  Feature,
  FloorLevel,
  RoomType,
  Faction,
  Occupation,
  QuestType,
  msg,
  type Entity,
  type GameState,
  type WorldContainer,
  type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerAuthoredNpc, registerSideQuest, storyNpcFloorKey } from '../../data/plot';
import { addFactionRelMutual } from '../../data/relations';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import {
  type NextId, createAdminRoom, setFeature, addItemDrop, spawnAdminNpc,
} from '../admin_common';
import { genLog } from '../log';

const QUEST_WITNESSED_FORGERY = 'stamp_room_witnessed_forgery';
const STAMP_ROOM_FORGERY_TAG = 'stamp_room_forgery';
const FORGED_STAMP_SHEET = 'forged_stamp_sheet';
const HOME_FLOOR_KEY = storyNpcFloorKey(FloorLevel.MINISTRY);
const GUARD_MATVEY_ID = 'stamp_room_guard_matvey';
const WITNESS_RAISA_ID = 'stamp_room_witness_raisa';
const FORGERY_USE_PATHS = [
  'archive_forged_stamp_supply',
  'ministry_weapon_permit_forgery',
  'raionsovet_archive_forged_gate',
] as const;

const ZOYA_DEF: PlotNpcDef = {
  name: 'Зоя Сургучная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 180, maxHp: 180, money: 140, speed: 0.75,
  inventory: [
    { defId: 'note', count: 5 },
    { defId: 'cigs', count: 2 },
    { defId: 'knife', count: 1 },
  ],
  talkLines: [
    'Не дышите на печати. Они сегодня липкие и нервные.',
    'Я Зоя Сургучная. Ставлю отметки на бумагу, людей и иногда на двери.',
    'Штамп не подтверждает истину. Он подтверждает, что истина стала удобной для шкафа.',
    'Для пропуска нужен корешок, свидетель и что-нибудь красное. Чернила есть, но штамп держится на сургуче.',
    'Принесите записки. Из них выйдут прокладки под печать, чтобы стол не вопил.',
    'Охрана думает, что сторожит меня. На самом деле она сторожит штамп от меня.',
    'Красная дорожка здесь не для красоты. Она показывает, куда печать ползла ночью.',
    'Если услышите хлопок без бумаги, значит кто-то получил отказ заранее.',
  ],
  talkLinesPost: [
    'Печать легла ровно. Это тревожно.',
    'Если бумага начнет греться, не кладите ее к сердцу.',
    'Вера получит отметку. Очередь получит повод.',
  ],
  talkQuestResponse: 'Корешок принят. Скажите Вере: печать не спорила, только шипела.',
};

const GUARD_MATVEY_DEF: PlotNpcDef = {
  name: 'Охранник Матвей Пломба',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 70, maxHp: 70, money: 15, speed: 0.8,
  weapon: 'makarov',
  inventory: [
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 8 },
    { defId: 'note', count: 1 },
  ],
  talkLines: [
    'Пломба стоит, пока печать не решила ползти сама.',
    'Поддельная бумага здесь пахнет не чернилами, а будущим протоколом.',
  ],
  talkLinesPost: [
    'Штамп прошел. Я этого не одобрил, только видел.',
  ],
};

const WITNESS_RAISA_DEF: PlotNpcDef = {
  name: 'Понятая Раиса Подпись',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 70, maxHp: 70, money: 15, speed: 0.8,
  inventory: [
    { defId: 'neighbor_complaint', count: 1 },
    { defId: 'note', count: 1 },
  ],
  talkLines: [
    'Я подпись. Раисой меня называют до журнала.',
    'Свидетель видит не правду, а момент, когда ее прижимают печатью.',
  ],
  talkLinesPost: [
    'Печать легла при мне. Этого достаточно, чтобы потом не спать.',
  ],
};

registerSideQuest('zoya_surguchnaya', ZOYA_DEF, [
  {
    id: 'stamp_room_padding',
    giverNpcId: 'zoya_surguchnaya',
    type: QuestType.FETCH,
    desc: 'Зоя Сургучная: «Пять записок. Подложим под печать, чтобы она не прожгла стол.»',
    targetItem: 'note', targetCount: 5,
    rewardItem: 'psi_mark', rewardCount: 1,
    extraRewards: [{ defId: 'cigs', count: 3 }],
    relationDelta: 16, xpReward: 80, moneyReward: 120,
  },
  {
    id: 'stamp_archive_route',
    giverNpcId: 'zoya_surguchnaya',
    type: QuestType.TALK,
    desc: 'Зоя Сургучная: «Передайте Осипу Карточному, что печать признала его ящик существующим.»',
    targetNpcId: 'osip_kartochny',
    rewardItem: 'book', rewardCount: 1,
    relationDelta: 10, xpReward: 35, moneyReward: 30,
  },
  {
    id: QUEST_WITNESSED_FORGERY,
    giverNpcId: 'zoya_surguchnaya',
    type: QuestType.FETCH,
    desc: 'Зоя Сургучная: «Два куска сургуча. Поставим поддельную печать при понятой: лист пройдет в архив, но журнал тоже проснется.»',
    targetItem: 'seal_wax', targetCount: 2,
    rewardItem: FORGED_STAMP_SHEET, rewardCount: 1,
    extraRewards: [{ defId: 'blank_form', count: 1 }],
    relationDelta: -5, xpReward: 70, moneyReward: 0,
    eventTargetName: 'Зоя поставила поддельную печать при свидетеле; лист годится для архивного окна, липового оружейного разрешения и скупки подделок.',
    eventSeverity: 5,
    eventPrivacy: 'witnessed',
    eventTags: ['ministry', 'stamp_room', STAMP_ROOM_FORGERY_TAG, 'forgery', 'witnessed', 'audit', 'document_gate', 'weapon_permit'],
    eventData: {
      outputItemId: FORGED_STAMP_SHEET,
      outputItemCount: 1,
      sourceRoom: 'Комната печатей',
      auditRisk: 'witnessed_stamp_room_entry',
      failureRisk: 'steal_or_cash_in_under_witness_and_local_audit',
      usePaths: FORGERY_USE_PATHS,
      rumorIds: ['player_forged_stamp_risk', 'ministry_document_gate_n3'],
    },
  },
]);

registerAuthoredNpc({
  id: GUARD_MATVEY_ID,
  npc: GUARD_MATVEY_DEF,
  homeFloorKey: HOME_FLOOR_KEY,
  tags: ['ministry', 'stamp_room', 'guard'],
});

registerAuthoredNpc({
  id: WITNESS_RAISA_ID,
  npc: WITNESS_RAISA_DEF,
  homeFloorKey: HOME_FLOOR_KEY,
  tags: ['ministry', 'stamp_room', 'witness'],
});

function nextContainerId(world: World): number {
  let id = world.containers.reduce((mx, c) => Math.max(mx, c.id), 0) + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addStampAuditContainer(
  world: World,
  roomId: number,
  x: number,
  y: number,
  ownerNpcId: number,
): void {
  const inventory: WorldContainer['inventory'] = [
    { defId: FORGED_STAMP_SHEET, count: 1 },
    { defId: 'ministry_clean_stamp', count: 1 },
    { defId: 'seal_wax', count: 2 },
    { defId: 'blank_form', count: 1 },
    { defId: 'ink_bottle', count: 1 },
  ];
  world.addContainer({
    id: nextContainerId(world),
    x,
    y,
    floor: FloorLevel.MINISTRY,
    roomId,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind: ContainerKind.FILING_CABINET,
    name: 'Журнал подштамповки Зои',
    inventory,
    capacitySlots: 6,
    ownerNpcId,
    ownerName: ZOYA_DEF.name,
    faction: Faction.CITIZEN,
    access: 'owner',
    lockDifficulty: 2,
    discovered: true,
    tags: ['ministry', 'stamp_room', STAMP_ROOM_FORGERY_TAG, 'paper', 'forgery', 'audit', 'witness', 'document_gate'],
  });
}

function sideQuestIdFrom(event: WorldEvent): string {
  return typeof event.data?.sideQuestId === 'string' ? event.data.sideQuestId : '';
}

function publishStampAudit(
  state: GameState,
  event: WorldEvent,
  outcome: 'witnessed_forgery' | 'stolen_sheet',
): void {
  if (outcome === 'witnessed_forgery') {
    addFactionRelMutual(Faction.PLAYER, Faction.LIQUIDATOR, -2);
    addFactionRelMutual(Faction.PLAYER, Faction.WILD, 1);
  } else {
    addFactionRelMutual(Faction.PLAYER, Faction.CITIZEN, -2);
    addFactionRelMutual(Faction.PLAYER, Faction.LIQUIDATOR, -2);
  }

  publishEvent(state, {
    type: 'faction_relation_changed',
    zoneId: event.zoneId,
    roomId: event.roomId,
    x: event.x,
    y: event.y,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetId: event.targetId,
    targetName: outcome === 'witnessed_forgery' ? 'Понятая штамп-комнаты' : 'Ревизия штамп-комнаты',
    targetFaction: outcome === 'stolen_sheet' ? event.targetFaction ?? Faction.CITIZEN : Faction.LIQUIDATOR,
    itemId: FORGED_STAMP_SHEET,
    itemName: 'Лист с поддельной печатью',
    itemCount: 1,
    itemValue: 70,
    containerId: event.containerId,
    containerOwnerId: event.containerOwnerId,
    containerFaction: event.containerFaction,
    severity: outcome === 'stolen_sheet' && event.privacy === 'witnessed' ? 5 : 4,
    privacy: outcome === 'stolen_sheet' ? event.privacy : 'local',
    tags: ['ministry', 'stamp_room', STAMP_ROOM_FORGERY_TAG, 'forgery', 'audit', outcome, 'faction'],
    data: {
      sourceEventId: event.id,
      outcome,
      usePaths: FORGERY_USE_PATHS,
      witnessCount: event.data?.witnessCount,
      auditAt: event.data?.auditAt,
      rumorIds: ['player_forged_stamp_risk', 'container_theft_seen'],
    },
  });
}

function handleStampRoomForgeryEvent(state: GameState, event: WorldEvent): void {
  if (event.type === 'quest_completed' && sideQuestIdFrom(event) === QUEST_WITNESSED_FORGERY) {
    publishStampAudit(state, event, 'witnessed_forgery');
    state.msgs.push(msg('Понятая кивнула, журнал дернулся. Поддельный лист теперь работает, но понятая видела лицо.', state.time, '#fa8'));
    return;
  }
  if (event.type !== 'item_stolen') return;
  if (event.itemId !== FORGED_STAMP_SHEET) return;
  const containerTags = Array.isArray(event.data?.containerTags) ? event.data.containerTags : [];
  if (!event.tags.includes(STAMP_ROOM_FORGERY_TAG) && !containerTags.includes(STAMP_ROOM_FORGERY_TAG)) return;
  publishStampAudit(state, event, 'stolen_sheet');
  state.msgs.push(msg('Ревизия штамп-комнаты подняла строку о поддельном листе. Польза есть, тишины нет.', state.time, '#f84'));
}

registerWorldEventObserver(handleStampRoomForgeryEvent);

export function generateStampRoom(
  world: World, nextRoomId: number, entities: Entity[], nextId: NextId, spawnX: number, spawnY: number,
): { nextRoomId: number } {
  const room = createAdminRoom(world, nextRoomId, spawnX, spawnY, {
    type: RoomType.STORAGE,
    name: 'Комната печатей',
    w: 9, h: 7,
    minDist: 45, maxDist: 125,
    wallTex: Tex.MARBLE,
    floorTex: Tex.F_RED_CARPET,
  });
  if (!room) return { nextRoomId };

  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  setFeature(world, cx, cy, Feature.DESK);
  setFeature(world, cx - 1, cy, Feature.TABLE);
  setFeature(world, cx + 1, cy, Feature.TABLE);
  setFeature(world, cx, cy + 1, Feature.CHAIR);
  for (let dx = 1; dx < room.w - 1; dx += 2) {
    setFeature(world, room.x + dx, room.y + 1, Feature.SHELF);
    setFeature(world, room.x + dx, room.y + room.h - 2, Feature.SHELF);
  }
  setFeature(world, cx, room.y + 1, Feature.LAMP);
  setFeature(world, room.x + 1, cy, Feature.LAMP);
  world.wallTex[world.idx(room.x - 1, cy)] = Tex.POSTER_BASE;
  world.wallTex[world.idx(room.x + room.w, cy)] = Tex.PORTRAIT_BASE;

  addItemDrop(entities, nextId, cx - 2, cy - 1, 'note', 1);
  addItemDrop(entities, nextId, cx + 2, cy - 1, 'ballot', 1);
  addItemDrop(entities, nextId, cx - 2, cy + 1, 'seal_wax', 1);
  addItemDrop(entities, nextId, cx + 2, cy + 1, 'ink_bottle', 1);
  const zoyaId = nextId.v;
  spawnAdminNpc(entities, nextId, ZOYA_DEF, 'zoya_surguchnaya', cx, cy - 1);
  spawnAdminNpc(entities, nextId, GUARD_MATVEY_DEF, GUARD_MATVEY_ID, room.x + 1, room.y + room.h - 2, false, 'makarov');
  spawnAdminNpc(entities, nextId, WITNESS_RAISA_DEF, WITNESS_RAISA_ID, room.x + room.w - 2, cy + 1, false);
  addStampAuditContainer(world, room.id, room.x + room.w - 2, cy, zoyaId);

  genLog(`[MINISTRY_ADMIN] ${room.name} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId: room.id + 1 };
}
