/* -- Аварийный медпост (AG44) ----------------------------------- */
/* Small finite medical POI: trade, restock, steal, expose, leave.  */

import {
  Cell, ContainerKind, DoorState, Faction, Feature,
  FloorLevel, Occupation, QuestType, RoomType, Tex,
  type ContainerAccess, type Entity, type Room, type WorldContainer, type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { protectRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

const MEDPOST_ZONE = 44;
const ROOM_W = 15;
const ROOM_H = 11;
const CONTENT_TAG = 'emergency_medpost';
const OUTCOME_TAG = 'ag44_medpost_outcome';

const MEDPOST_MEDICINE = new Set([
  'antibiotic',
  'bandage',
  'iodine',
  'morphine_ampoule',
  'pills',
  'sanitary_kit',
  'tourniquet',
]);

const NPC_DEFS: Record<string, PlotNpcDef> = {
  ag44_dr_kruglov: {
    name: 'Доктор Круглов',
    isFemale: false,
    faction: Faction.SCIENTIST,
    occupation: Occupation.DOCTOR,
    sprite: Occupation.DOCTOR,
    hp: 145, maxHp: 145, money: 180, speed: 0.8,
    inventory: [
      { defId: 'bandage', count: 2 },
      { defId: 'pills', count: 1 },
      { defId: 'antibiotic', count: 1 },
      { defId: 'iodine', count: 1 },
    ],
    talkLines: [
      'Медпост аварийный, не больница. Лечим тем, что ещё не украли.',
      'Бинты идут на кровь, антибиотик - по списку, таблетки - за деньги или услугу. Очередь это слышит и злится.',
      'Пополните ящик бинтами, и я отпущу часть запаса без скандала. Один бинт сейчас решает, кто дойдет до гермы.',
      'Чужой шкаф открывается легко. Потом открывается журнал.',
      'Температуру назовите числом. Слово страшно в карту не помещается.',
      'Морфин выдаю только под подпись. Боль громкая, но журнал громче.',
    ],
    talkLinesPost: [
      'Спасибо за бинты. Теперь хотя бы один человек доживет до очереди.',
      'Если нужна медицина, покупайте сейчас. После сирены цена снова поползет.',
      'Санитар считает ампулы громче, чем шаги в коридоре.',
      'После фиолетового тумана спрашиваю не храбрость, а сон и фильтр.',
    ],
  },

  ag44_feldsher_lagunova: {
    name: 'Фельдшер Лагунова',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.DOCTOR,
    sprite: Occupation.DOCTOR,
    hp: 105, maxHp: 105, money: 42, speed: 0.8,
    inventory: [
      { defId: 'tourniquet', count: 1 },
      { defId: 'filter_layer', count: 1 },
    ],
    talkLines: [
      'Сначала давление, потом разговор. Если стоите - уже хорошо.',
      'Фильтр мокрый? Снимайте медленно. Лицо руками не трогать.',
      'Бинт тёплый через час - к столу. Холодный и мокрый - в отдельный пакет, к двери не подходить.',
      'Йод закончится раньше смены. Поэтому льём точно, не красиво.',
      'Антидепрессант не для смелости. Он для сна, когда после тумана не закрываются глаза.',
    ],
    talkLinesPost: [
      'Повязку проверяйте на повороте, не в середине коридора.',
      'Если фиолетовый туман вернётся, сразу к герме. Спорить будете после фильтра.',
    ],
  },

  ag44_sanitar_bort: {
    name: 'Санитар Борт',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 210, maxHp: 210, money: 35, speed: 0.9,
    inventory: [
      { defId: 'pipe', count: 1 },
      { defId: 'bandage', count: 1 },
    ],
    talkLines: [
      'Я не врач. Я слежу, чтобы шкафы не уходили раньше раненых.',
      'Круглов торгует честно, пока очередь не давит дверь.',
      'Украдете из сумки - не спорьте с событием. Оно уже случилось.',
      'Не стойте у прохода. У меня носилки ходят быстрее ваших мыслей.',
      'Санитар злой не потому, что злой. Потому что третью смену считает живых.',
    ],
    talkLinesPost: [
      'Медпост жив, пока запас не стал слухом.',
      'Дверь закрывайте. Йодом тянет в коридор, и очередь сразу лезет внутрь.',
      'Кто трогает лицо после фильтра, тот потом спорит уже с Кругловым.',
    ],
  },

  ag44_queue_patient: {
    name: 'Игорь Очередной',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.TRAVELER,
    sprite: Occupation.TRAVELER,
    hp: 70, maxHp: 95, money: 6, speed: 0.55,
    inventory: [{ defId: 'clean_health_cert', count: 1 }],
    talkLines: [
      'Я в очереди после крови и перед температурой. Хорошее место, если не падать и не кашлять на журнал.',
      'Фельдшер сказала не спать после ОВС. Я бы рад, только сон сам ушёл.',
      'У меня справка чистая, пока я не кашлянул на печать.',
      'Если бинт дадут один, я возьму половину. Вторую оставьте тому, кто идёт к герме.',
    ],
    talkLinesPost: [
      'Очередь сдвинулась на один вдох. В медпосте это почти праздник.',
      'Если меня спросят, вы стояли тут давно и лицо не трогали.',
    ],
  },
};

registerSideQuest('ag44_dr_kruglov', NPC_DEFS.ag44_dr_kruglov, [
  {
    id: 'ag44_medpost_restock_bandages',
    giverNpcId: 'ag44_dr_kruglov',
    type: QuestType.FETCH,
    desc: 'Доктор Круглов: «Принесите три бинта в аварийный медпост. За это выдам таблетки и справку без очереди.»',
    targetItem: 'bandage', targetCount: 3,
    rewardItem: 'pills', rewardCount: 1,
    extraRewards: [{ defId: 'clean_health_cert', count: 1 }],
    relationDelta: 12, xpReward: 45, moneyReward: 55,
    targetFloor: FloorLevel.LIVING,
    targetRoomType: RoomType.MEDICAL,
    targetZoneTag: CONTENT_TAG,
    targetHint: 'Жилая зона: аварийный медпост Круглова и его опечатанный шкаф.',
    eventTargetName: 'Аварийный медпост пополнен бинтами до следующей очереди.',
    eventTags: [CONTENT_TAG, 'medical', 'restock', 'medicine', 'scarcity'],
    eventData: { outcome: 'medpost_restocked', supplyItem: 'bandage', rumorIds: ['room_emergency_medpost'] },
  },
]);
registerSideQuest('ag44_feldsher_lagunova', NPC_DEFS.ag44_feldsher_lagunova, []);
registerSideQuest('ag44_sanitar_bort', NPC_DEFS.ag44_sanitar_bort, []);
registerSideQuest('ag44_queue_patient', NPC_DEFS.ag44_queue_patient, []);

function isMedpostMedicine(itemId: string | undefined): boolean {
  return itemId !== undefined && MEDPOST_MEDICINE.has(itemId);
}

function sideQuestId(event: WorldEvent): string {
  const id = event.data?.sideQuestId;
  return typeof id === 'string' ? id : '';
}

registerWorldEventObserver((state, event) => {
  if (event.tags.includes(OUTCOME_TAG)) return;

  if (event.type === 'quest_completed' && sideQuestId(event) === 'ag44_medpost_restock_bandages') {
    publishEvent(state, {
      type: 'faction_relation_changed',
      floor: FloorLevel.LIVING,
      zoneId: event.zoneId,
      roomId: event.roomId,
      actorId: event.actorId,
      actorName: event.actorName,
      actorFaction: event.actorFaction,
      targetName: 'Круглов получил бинты; медпост удержал очередь без вскрытия шкафа.',
      severity: 4,
      privacy: 'local',
      tags: [CONTENT_TAG, OUTCOME_TAG, 'medical', 'restock', 'scarcity', 'social'],
      data: { sourceEventId: event.id, outcome: 'medpost_restocked', rumorIds: ['room_emergency_medpost'] },
    });
    return;
  }

  if (event.type !== 'item_stolen' || !event.tags.includes(CONTENT_TAG) || !isMedpostMedicine(event.itemId)) return;
  publishEvent(state, {
    type: 'faction_relation_changed',
    floor: FloorLevel.LIVING,
    zoneId: event.zoneId,
    roomId: event.roomId,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetId: event.targetId,
    targetName: event.targetName ?? 'аварийный медпост',
    targetFaction: event.targetFaction,
    itemId: event.itemId,
    itemName: event.itemName,
    itemCount: event.itemCount,
    containerId: event.containerId,
    severity: 5,
    privacy: event.privacy === 'private' ? 'local' : event.privacy,
    tags: [CONTENT_TAG, OUTCOME_TAG, 'medical', 'medicine_stolen', 'scarcity', 'social'],
    data: {
      sourceEventId: event.id,
      outcome: 'medpost_medicine_stolen',
      rumorIds: ['room_emergency_medpost', 'rare_bandage_med'],
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
  for (let r = 0; r <= 84; r += 4) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2 + 0.17;
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
    name: 'Аварийный медпост',
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
    [2, 1, Feature.LAMP], [ROOM_W - 3, 1, Feature.LAMP], [7, ROOM_H - 2, Feature.LAMP],
    [2, 3, Feature.DESK], [3, 3, Feature.DESK], [4, 3, Feature.CHAIR],
    [2, 8, Feature.BED], [4, 8, Feature.BED], [9, 8, Feature.BED],
    [ROOM_W - 3, 3, Feature.SINK], [ROOM_W - 4, 3, Feature.APPARATUS],
    [ROOM_W - 4, 7, Feature.SHELF], [ROOM_W - 3, 7, Feature.SHELF],
    [7, 3, Feature.SHELF], [8, 3, Feature.SHELF], [9, 3, Feature.SHELF],
  ] as const) {
    world.features[world.idx(rx + dx, ry + dy)] = feature;
  }
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addMedContainer(
  world: World,
  room: Room,
  dx: number,
  dy: number,
  name: string,
  access: ContainerAccess,
  inventory: WorldContainer['inventory'],
  tags: string[],
  owner?: Entity,
  faction = Faction.SCIENTIST,
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
    kind: ContainerKind.MEDICAL_CABINET,
    name,
    inventory: inventory.map(i => ({ ...i })),
    capacitySlots: Math.max(6, inventory.length + 2),
    ownerNpcId: owner?.id,
    ownerName: owner?.name,
    faction,
    access,
    lockDifficulty: access === 'locked' ? 4 : undefined,
    discovered: true,
    tags: [CONTENT_TAG, 'medical', 'scarcity', ...tags],
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
    canGiveQuest,
    aiTarget: { x, y },
    extra: { weapon, isTraveler: false },
  });
}

function seedContainers(world: World, room: Room, doctor: Entity): void {
  addMedContainer(
    world, room, 7, 3, 'Сумка доктора Круглова', 'owner',
    [
      { defId: 'bandage', count: 1 },
      { defId: 'pills', count: 1 },
      { defId: 'antibiotic', count: 1 },
    ],
    ['owner', 'theft', 'doctor_bag'],
    doctor,
  );
  addMedContainer(
    world, room, ROOM_W - 4, 7, 'Шкаф аварийного медпоста', 'faction',
    [
      { defId: 'bandage', count: 2 },
      { defId: 'iodine', count: 1 },
      { defId: 'tourniquet', count: 1 },
    ],
    ['faction', 'restock', 'theft'],
  );
  addMedContainer(
    world, room, ROOM_W - 3, 7, 'Опечатанный бокс антибиотиков', 'locked',
    [
      { defId: 'antibiotic', count: 1 },
      { defId: 'morphine_ampoule', count: 1 },
      { defId: 'clean_health_cert', count: 1 },
    ],
    ['locked', 'audit', 'antibiotic'],
  );
}

function generateEmergencyMedpost(
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
  const doctor = spawnNpc(world, entities, nextId, room, 'ag44_dr_kruglov', 3, 4, Math.PI / 2, true);
  spawnNpc(world, entities, nextId, room, 'ag44_feldsher_lagunova', 9, 4, Math.PI, false);
  spawnNpc(world, entities, nextId, room, 'ag44_sanitar_bort', ROOM_W - 4, ROOM_H - 3, Math.PI, false, 'pipe');
  spawnNpc(world, entities, nextId, room, 'ag44_queue_patient', 6, ROOM_H - 3, 0, false);
  seedContainers(world, room, doctor);
  genLog(`[AG44] Аварийный медпост at (${pos.x}, ${pos.y}) room #${room.id}`);
  return { nextRoomId };
}

registerZoneContent(MEDPOST_ZONE, 'Аварийный медпост', generateEmergencyMedpost);
