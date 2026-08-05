/* -- Istotit communal supply cache: share, steal, guard, report, barter -- */

import {
  AIGoal, Cell, ContainerKind, EntityType, Faction, Feature, FloorLevel,
  MonsterKind, Occupation, QuestType, RoomType, Tex,
  type Entity, type Room, type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { findClearArea, protectRoom, stampRoom, connectProtectedRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

const CONTENT_TAG = 'ag89_istotit_supply';
const OUTCOME_TAG = 'ag89_supply_outcome';
const SUPPLY_ZONE = 4;
const ROOM_W = 15;
const ROOM_H = 10;
const ROOM_NAME = 'Общий свечной запас';

const AGAFA_ID = 'ag89_agafa_svechnaya';
const SAVVA_ID = 'ag89_savva_guard';
const MARKEL_ID = 'ag89_markel_report';
const LIDA_ID = 'ag89_lida_barter';

const NPC_DEFS: Record<string, PlotNpcDef> = {
  [AGAFA_ID]: {
    name: 'Агафья Свечная',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.STOREKEEPER,
    sprite: Occupation.STOREKEEPER,
    hp: 95, maxHp: 95, money: 24, speed: 0.8,
    inventory: [
      { defId: 'istotit_candle', count: 1 },
      { defId: 'bread', count: 1 },
      { defId: 'siren_instruction', count: 1 },
    ],
    talkLines: [
      'Это не лавка. Это общий ящик на тот случай, когда сирена вдруг начнет петь.',
      'Свечи считаем по огаркам, воду - по чужой жажде. Взял тихо - украл у очереди.',
      'Две бутылки воды принесешь - раздадим тем, кто у двери дрожит. Тебе оставлю одну свечу по ведомости.',
      'Истотит Христом Укрыт, а ящик - людьми. Люди быстрее становятся церковными, чем честными.',
    ],
    talkLinesPost: [
      'Воду разнесли. Теперь хоть один спор начнется после отбоя, а не перед ним.',
      'Свечу держи низко. Высоко поднимешь - очередь увидит запас и начнет считать чужое.',
    ],
  },
  [SAVVA_ID]: {
    name: 'Савва Дверной',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 120, maxHp: 120, money: 12, speed: 0.95,
    inventory: [{ defId: 'pipe', count: 1 }, { defId: 'water', count: 1 }],
    talkLines: [
      'Я у двери стою не против веры. Чтобы церковный ящик не вынесли вместе с дверью.',
      'Сборка за стеной уже нюхала воск. Отгони ее - люди поверят, что запас еще общий.',
      'Когда по трубе идет чужой шум, охрана - это кто первым закрывает дверь.',
    ],
    talkLinesPost: [
      'У двери стало тише. Теперь слышно, как соседи считают бутылки.',
      'Если кто полезет в ящик после тебя, он полезет уже при свидетелях.',
    ],
  },
  [MARKEL_ID]: {
    name: 'Маркел Обходной',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 145, maxHp: 145, money: 60, speed: 0.95,
    inventory: [{ defId: 'bandage', count: 1 }, { defId: 'clean_health_cert', count: 1 }, { defId: 'denunciation', count: 1 }],
    talkLines: [
      'Церковный запас без ведомости - это будущая драка с пустой строкой у двери.',
      'Принесешь список укрытия - оформлю как сообщение о сокрытии припасов. Некрасиво, зато по форме.',
      'Не спрашивай, добро это или донос. У нас для обоих один бланк.',
    ],
    talkLinesPost: [
      'Ведомость принята. Теперь ящик общий уже по протоколу, а не по совести.',
      'Жильцы будут шипеть. Зато ликвидаторы придут считать, а не стрелять сразу.',
    ],
  },
  [LIDA_ID]: {
    name: 'Лида Восковая',
    isFemale: true,
    faction: Faction.WILD,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 80, maxHp: 80, money: 44, speed: 1.0,
    inventory: [{ defId: 'istotit_candle', count: 1 }, { defId: 'tea', count: 1 }, { defId: 'cigs', count: 2 }],
    talkLines: [
      'Свеча бесплатно - это кража, свеча за сургуч - уже учет.',
      'Сургуч принесешь, я подпишу огарок как вклад. Смешно, пока очередь не увидела пустой ящик.',
      'Я не торгую обещаниями. Я меняю расходник на расходник, пока очередь не полезла в ящик.',
    ],
    talkLinesPost: [
      'Сургуч пошел на пломбу. Свечу держи, но не обещай ею никого спасать.',
      'Бартер честнее красивых слов, когда у двери очередь.',
    ],
  },
};

registerSideQuest(AGAFA_ID, NPC_DEFS[AGAFA_ID], [{
  id: 'ag89_share_water_with_neighbors',
  giverNpcId: AGAFA_ID,
  type: QuestType.FETCH,
  desc: 'Агафья Свечная: «Принеси две бутылки воды в общий свечной запас. Раздадим у двери тем, кого сирена застала без фляги.»',
  targetItem: 'water', targetCount: 2,
  rewardItem: 'istotit_candle', rewardCount: 1,
  extraRewards: [{ defId: 'bread', count: 1 }],
  relationDelta: 14, xpReward: 45, moneyReward: 10,
}]);

registerSideQuest(SAVVA_ID, NPC_DEFS[SAVVA_ID], [{
  id: 'ag89_guard_supply_door',
  giverNpcId: SAVVA_ID,
  type: QuestType.KILL,
  desc: 'Савва Дверной: «Сборка трется у запасной двери. Убей одну, пока свечи не стали приманкой.»',
  targetMonsterKind: MonsterKind.SBORKA,
  killNeeded: 1,
  rewardItem: 'filtered_water', rewardCount: 1,
  relationDelta: 10, xpReward: 50, moneyReward: 15,
}]);

registerSideQuest(MARKEL_ID, NPC_DEFS[MARKEL_ID], [{
  id: 'ag89_report_supply_hoarding',
  giverNpcId: MARKEL_ID,
  type: QuestType.FETCH,
  desc: 'Маркел Обходной: «Неси список укрытия. Если запас прячут за свечами, будет акт о сокрытии припасов.»',
  targetItem: 'emergency_roster', targetCount: 1,
  rewardItem: 'clean_health_cert', rewardCount: 1,
  extraRewards: [{ defId: 'denunciation', count: 1 }],
  relationDelta: 8, xpReward: 45, moneyReward: 55,
}]);

registerSideQuest(LIDA_ID, NPC_DEFS[LIDA_ID], [{
  id: 'ag89_barter_wax_for_candle',
  giverNpcId: LIDA_ID,
  type: QuestType.FETCH,
  desc: 'Лида Восковая: «Один сургуч - одна истотитная свеча и кружка чая. Без обряда, по обмену.»',
  targetItem: 'seal_wax', targetCount: 1,
  rewardItem: 'istotit_candle', rewardCount: 1,
  extraRewards: [{ defId: 'tea', count: 1 }],
  relationDelta: 5, xpReward: 25, moneyReward: 8,
}]);

const OUTCOME_BY_QUEST: Record<string, { targetName: string; tags: string[]; rumorIds: string[] }> = {
  ag89_share_water_with_neighbors: {
    targetName: 'Вода общего свечного запаса роздана соседям',
    tags: ['istotit', 'share', 'citizen'],
    rumorIds: ['living_istotit_supply_helped'],
  },
  ag89_guard_supply_door: {
    targetName: 'Дверь общего свечного запаса удержана',
    tags: ['istotit', 'guard', 'citizen'],
    rumorIds: ['living_istotit_supply_guarded'],
  },
  ag89_report_supply_hoarding: {
    targetName: 'Общий свечной запас сдан обходу',
    tags: ['istotit', 'report', 'liquidator'],
    rumorIds: ['living_istotit_supply_reported'],
  },
  ag89_barter_wax_for_candle: {
    targetName: 'Свеча получена через учетный бартер',
    tags: ['istotit', 'barter', 'trade'],
    rumorIds: ['living_istotit_supply_bartered'],
  },
};

registerWorldEventObserver((state, event) => {
  if (event.tags.includes(OUTCOME_TAG)) return;

  if (event.type === 'quest_completed') {
    const sideQuestId = typeof event.data?.sideQuestId === 'string' ? event.data.sideQuestId : '';
    const outcome = OUTCOME_BY_QUEST[sideQuestId];
    if (!outcome) return;
    publishEvent(state, {
      type: 'faction_relation_changed',
      floor: FloorLevel.LIVING,
      zoneId: event.zoneId,
      roomId: event.roomId,
      actorId: event.actorId,
      actorName: event.actorName,
      actorFaction: event.actorFaction,
      targetName: outcome.targetName,
      severity: 4,
      privacy: 'local',
      tags: [CONTENT_TAG, OUTCOME_TAG, 'faction_event', ...outcome.tags],
      data: {
        sourceEventId: event.id,
        sideQuestId,
        rumorIds: outcome.rumorIds,
      },
    });
    return;
  }

  if (event.type !== 'item_stolen' || !event.tags.includes(CONTENT_TAG)) return;
  publishEvent(state, {
    type: 'faction_relation_changed',
    floor: FloorLevel.LIVING,
    zoneId: event.zoneId,
    roomId: event.roomId,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetId: event.targetId,
    targetName: event.targetName ?? 'общий свечной запас',
    targetFaction: event.targetFaction,
    itemId: event.itemId,
    itemName: event.itemName,
    itemCount: event.itemCount,
    containerId: event.containerId,
    severity: 5,
    privacy: event.privacy === 'private' ? 'local' : event.privacy,
    tags: [CONTENT_TAG, OUTCOME_TAG, 'faction_event', 'istotit', 'theft', 'witness'],
    data: {
      sourceEventId: event.id,
      containerId: event.containerId,
      rumorIds: ['living_istotit_supply_stolen'],
    },
  });
});

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addSupplyContainer(
  world: World,
  room: Room,
  dx: number,
  dy: number,
  kind: ContainerKind,
  name: string,
  access: WorldContainer['access'],
  inventory: WorldContainer['inventory'],
  tags: string[],
  owner?: { id?: number; name?: string; faction?: Faction },
): void {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
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
    faction: owner?.faction ?? Faction.CITIZEN,
    access,
    lockDifficulty: access === 'locked' ? 3 : undefined,
    discovered: true,
    tags: [CONTENT_TAG, 'istotit', 'church_cache', ...tags],
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
): number {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle,
    weapon,
    canGiveQuest: true,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
  });
  return npc.id;
}

function decorateRoom(world: World, room: Room): void {
  const rx = room.x;
  const ry = room.y;
  for (let dx = 1; dx < ROOM_W - 1; dx += 2) {
    world.features[world.idx(rx + dx, ry + 1)] = Feature.SHELF;
  }
  for (const [dx, dy, feature] of [
    [2, 3, Feature.CANDLE],
    [ROOM_W - 3, 3, Feature.CANDLE],
    [Math.floor(ROOM_W / 2), 2, Feature.LAMP],
    [Math.floor(ROOM_W / 2) - 1, ROOM_H - 3, Feature.TABLE],
    [Math.floor(ROOM_W / 2), ROOM_H - 3, Feature.TABLE],
    [Math.floor(ROOM_W / 2) + 1, ROOM_H - 3, Feature.CHAIR],
    [2, ROOM_H - 3, Feature.DESK],
    [ROOM_W - 3, ROOM_H - 3, Feature.DESK],
    [ROOM_W - 4, ROOM_H - 3, Feature.CHAIR],
  ] as const) {
    world.features[world.idx(rx + dx, ry + dy)] = feature;
  }
}

function findThreatCell(world: World, room: Room): { x: number; y: number } | null {
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  for (let r = 5; r <= 13; r++) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + r * 0.11;
      const x = world.wrap(cx + Math.round(Math.cos(a) * r));
      const y = world.wrap(cy + Math.round(Math.sin(a) * r));
      const ci = world.idx(x, y);
      if (world.cells[ci] === Cell.FLOOR && !world.aptMask[ci]) return { x, y };
    }
  }
  return null;
}

function spawnDoorThreat(world: World, entities: Entity[], nextId: { v: number }, room: Room): void {
  const pos = findThreatCell(world, room);
  const def = MONSTERS[MonsterKind.SBORKA];
  if (!pos || !def) return;
  const zoneId = world.zoneMap[world.idx(pos.x, pos.y)];
  const zoneLevel = zoneId >= 0 && world.zones[zoneId] ? world.zones[zoneId].level : 3;
  const rpg = randomRPG(zoneLevel);
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: pos.x + 0.5,
    y: pos.y + 0.5,
    angle: Math.atan2(room.y + room.h / 2 - pos.y - 0.5, room.x + room.w / 2 - pos.x - 0.5),
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: def.sprite,
    hp: scaleMonsterHp(def.hp, zoneLevel),
    maxHp: scaleMonsterHp(def.hp, zoneLevel),
    monsterKind: MonsterKind.SBORKA,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: room.x + Math.floor(room.w / 2), ty: room.y + Math.floor(room.h / 2), path: [], pi: 0, stuck: 0, timer: 0 },
    rpg,
  });
}

function seedContainers(world: World, room: Room, agafaId: number, markelId: number, lidaId: number): void {
  addSupplyContainer(
    world,
    room,
    ROOM_W - 3,
    2,
    ContainerKind.EMERGENCY_BOX,
    'Опечатанный общий ящик Истотита',
    'faction',
    [
      { defId: 'istotit_candle', count: 2 },
      { defId: 'water', count: 2 },
      { defId: 'bread', count: 2 },
      { defId: 'emergency_roster', count: 1 },
      { defId: 'siren_instruction', count: 1 },
    ],
    ['theft', 'witness', 'emergency', 'paper'],
    { name: 'очередь укрытия', faction: Faction.CITIZEN },
  );
  addSupplyContainer(
    world,
    room,
    2,
    2,
    ContainerKind.CASHBOX,
    'Кружка свечного учета',
    'owner',
    [
      { defId: 'istotit_candle', count: 1 },
      { defId: 'seal_wax', count: 1 },
      { defId: 'note', count: 1 },
    ],
    ['theft', 'trade', 'candle'],
    { id: agafaId, name: NPC_DEFS[AGAFA_ID].name, faction: Faction.CITIZEN },
  );
  addSupplyContainer(
    world,
    room,
    ROOM_W - 4,
    ROOM_H - 3,
    ContainerKind.FILING_CABINET,
    'Папка обхода по свечному запасу',
    'owner',
    [
      { defId: 'emergency_roster', count: 1 },
      { defId: 'denunciation', count: 1 },
      { defId: 'clean_health_cert', count: 1 },
    ],
    ['theft', 'paper', 'report'],
    { id: markelId, name: NPC_DEFS[MARKEL_ID].name, faction: Faction.LIQUIDATOR },
  );
  addSupplyContainer(
    world,
    room,
    4,
    ROOM_H - 3,
    ContainerKind.WOODEN_CHEST,
    'Восковой узел Лиды',
    'owner',
    [
      { defId: 'istotit_candle', count: 1 },
      { defId: 'tea', count: 1 },
      { defId: 'cigs', count: 2 },
    ],
    ['theft', 'barter', 'candle'],
    { id: lidaId, name: NPC_DEFS[LIDA_ID].name, faction: Faction.WILD },
  );
}

function canBuildSupplyRoom(world: World, x: number, y: number): boolean {
  for (let dy = -1; dy <= ROOM_H; dy++) {
    for (let dx = -1; dx <= ROOM_W; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) return false;
    }
  }
  return true;
}

function findSupplyRoomArea(world: World, zcx: number, zcy: number): { x: number; y: number } | null {
  const clear = findClearArea(world, Math.floor(zcx), Math.floor(zcy), ROOM_W, ROOM_H, 14, 64);
  if (clear) return clear;

  const cx = Math.floor(zcx) - Math.floor(ROOM_W / 2);
  const cy = Math.floor(zcy) - Math.floor(ROOM_H / 2);
  for (let r = 0; r <= 96; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = world.wrap(cx + dx);
        const y = world.wrap(cy + dy);
        if (canBuildSupplyRoom(world, x, y)) return { x, y };
      }
    }
  }
  return null;
}

function generateIstotitSupplyCache(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zcx: number,
  zcy: number,
): { nextRoomId: number } {
  const pos = findSupplyRoomArea(world, zcx, zcy);
  if (!pos) {
    genLog(`[AG89] ${ROOM_NAME} skipped: no clear area near zone center (${zcx}, ${zcy})`);
    return { nextRoomId };
  }
  const room = stampRoom(world, nextRoomId++, RoomType.COMMON, pos.x, pos.y, ROOM_W, ROOM_H, -1);
  room.name = ROOM_NAME;
  room.wallTex = Tex.PANEL;
  room.floorTex = Tex.F_TILE;
  protectRoom(world, room.x, room.y, ROOM_W, ROOM_H, Tex.PANEL, Tex.F_TILE);
  connectProtectedRoom(world, room.x, room.y, ROOM_W, ROOM_H);
  decorateRoom(world, room);

  const agafaId = spawnNpc(world, entities, nextId, room, AGAFA_ID, 3, 4, 0);
  spawnNpc(world, entities, nextId, room, SAVVA_ID, ROOM_W - 4, 5, Math.PI, 'pipe');
  const markelId = spawnNpc(world, entities, nextId, room, MARKEL_ID, ROOM_W - 4, ROOM_H - 4, Math.PI, 'pipe');
  const lidaId = spawnNpc(world, entities, nextId, room, LIDA_ID, 5, ROOM_H - 4, -Math.PI / 2);
  seedContainers(world, room, agafaId, markelId, lidaId);
  spawnDoorThreat(world, entities, nextId, room);
  world.bakeLights();

  genLog(`[AG89] ${ROOM_NAME} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId };
}

registerZoneContent(SUPPLY_ZONE, ROOM_NAME, generateIstotitSupplyCache);
