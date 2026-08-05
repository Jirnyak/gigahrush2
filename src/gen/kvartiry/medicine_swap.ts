/* ── Аптечный разменник — household medicine crisis POI ─────── */

import {
  Cell,
  ContainerKind,
  FloorLevel,
  Tex,
  Feature,
  RoomType,
  Faction,
  Occupation,
  QuestType,
  type Entity,
  type Item,
  type WorldContainer,
  type WorldEventPrivacy,
  type WorldEventSeverity,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import {
  KV_MEDICINE_TRUST_TAG,
  LOST_CHILD_MEDICINE_TRUST_QUEST_ID,
  LOST_CHILD_RATIONS_QUEST_ID,
} from './lost_child_corner';
import {
  createSocialPoiRoom,
  placeDropNear,
  roomCell,
  setFeatureIfFloor,
  spawnAmbientNpc,
  spawnSocialNpc,
  type SocialPoiRoom,
} from './social_helpers';

const MEDICINE_SWAP_ROOM_NAME = 'Аптечный разменник';
export const MEDICINE_SWAP_TAG = 'kv_medicine_swap';
const MEDICINE_ROUTE_TAG = 'medicine_trust';
const MEDICINE_CHILDREN_QUEST_ID = 'kv_medicine_children';
const LIQUIDATOR_BANDAGES_QUEST_ID = 'kv_liquidator_bandages';
const WILD_ANTIDEP_QUEST_ID = 'kv_wild_antidep_swap';
const CULTIST_PILLS_QUEST_ID = 'kv_cultist_silent_pills';
const MEDICINE_DECISION_QUEST_IDS = [
  MEDICINE_CHILDREN_QUEST_ID,
  LIQUIDATOR_BANDAGES_QUEST_ID,
  WILD_ANTIDEP_QUEST_ID,
  CULTIST_PILLS_QUEST_ID,
];
export const MEDICINE_SWAP_QUEST_IDS = {
  children: MEDICINE_CHILDREN_QUEST_ID,
  liquidators: LIQUIDATOR_BANDAGES_QUEST_ID,
  wild: WILD_ANTIDEP_QUEST_ID,
  cult: CULTIST_PILLS_QUEST_ID,
} as const;

function branchBlockers(id: string): string[] {
  return MEDICINE_DECISION_QUEST_IDS.filter(q => q !== id);
}

interface TrustChainOutcome {
  targetName: string;
  outcome: string;
  tags: string[];
  rumorIds: string[];
  severity: WorldEventSeverity;
  privacy: WorldEventPrivacy;
}

const TRUST_CHAIN_OUTCOMES: Record<string, TrustChainOutcome> = {
  [LOST_CHILD_RATIONS_QUEST_ID]: {
    targetName: 'Детский угол спасён водой и начинает доверять аптечному разменнику.',
    outcome: 'lost_child_rescue',
    tags: ['rescue', 'children', 'water', 'trust'],
    rumorIds: ['lead_kvartiry_lost_child_map'],
    severity: 4,
    privacy: 'witnessed',
  },
  [LOST_CHILD_MEDICINE_TRUST_QUEST_ID]: {
    targetName: 'Вера поручилась за игрока; Нина открыла разговор о детских лекарствах.',
    outcome: 'medicine_trust_opened',
    tags: ['talk', 'medicine', 'children', 'trust'],
    rumorIds: ['lead_kvartiry_medicine_swap_bandage'],
    severity: 3,
    privacy: 'witnessed',
  },
  [MEDICINE_CHILDREN_QUEST_ID]: {
    targetName: 'Таблетки ушли детям через Нину, а не в учет или перепродажу.',
    outcome: 'children_medicine_rescue',
    tags: ['rescue', 'medicine', 'children', 'trust'],
    rumorIds: ['rare_pills_trade', 'lead_kvartiry_lost_child_map'],
    severity: 4,
    privacy: 'witnessed',
  },
  [LIQUIDATOR_BANDAGES_QUEST_ID]: {
    targetName: 'Медицинский запас возвращён ликвидаторскому посту по учету.',
    outcome: 'liquidator_medicine_trade',
    tags: ['trade', 'liquidator', 'bandage', 'medicine'],
    rumorIds: ['rare_bandage_med'],
    severity: 4,
    privacy: 'local',
  },
  [WILD_ANTIDEP_QUEST_ID]: {
    targetName: 'Антидепрессанты ушли в дикий обмен за проход и тишину.',
    outcome: 'wild_medicine_trade',
    tags: ['trade', 'wild', 'black_market', 'medicine'],
    rumorIds: ['rare_pills_trade'],
    severity: 4,
    privacy: 'local',
  },
  [CULTIST_PILLS_QUEST_ID]: {
    targetName: 'Таблетки отданы шептунье; больные стали тише, но дети помощи не получили.',
    outcome: 'cult_medicine_trade',
    tags: ['trade', 'cult', 'psi', 'medicine'],
    rumorIds: ['rare_pills_trade'],
    severity: 4,
    privacy: 'secret',
  },
};

registerWorldEventObserver((state, event) => {
  if (event.type === 'quest_completed') {
    const sideQuestId = typeof event.data?.sideQuestId === 'string' ? event.data.sideQuestId : '';
    const outcome = TRUST_CHAIN_OUTCOMES[sideQuestId];
    if (!outcome) return;
    publishEvent(state, {
      type: 'faction_relation_changed',
      floor: FloorLevel.KVARTIRY,
      actorId: event.actorId,
      actorName: event.actorName,
      actorFaction: event.actorFaction,
      targetName: outcome.targetName,
      severity: outcome.severity,
      privacy: outcome.privacy,
      tags: [KV_MEDICINE_TRUST_TAG, MEDICINE_SWAP_TAG, 'faction_event', ...outcome.tags],
      data: {
        sourceEventId: event.id,
        sideQuestId,
        outcome: outcome.outcome,
        rumorIds: outcome.rumorIds,
      },
    });
    return;
  }

  if (event.type !== 'item_stolen' || !event.tags.includes(KV_MEDICINE_TRUST_TAG)) return;
  const medicine = event.tags.includes(MEDICINE_SWAP_TAG) || event.tags.includes('medical');
  const severity: WorldEventSeverity = event.severity >= 5 ? 5 : 4;
  publishEvent(state, {
    type: 'faction_relation_changed',
    floor: FloorLevel.KVARTIRY,
    zoneId: event.zoneId,
    roomId: event.roomId,
    x: event.x,
    y: event.y,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetId: event.targetId,
    targetName: medicine
      ? 'Аптечное доверие просело после кражи лекарств.'
      : 'Детский угол запомнил кражу из карты и пайка.',
    targetFaction: event.targetFaction,
    itemId: event.itemId,
    itemName: event.itemName,
    itemCount: event.itemCount,
    containerId: event.containerId,
    containerOwnerId: event.containerOwnerId,
    containerFaction: event.containerFaction,
    severity,
    privacy: event.privacy,
    tags: [KV_MEDICINE_TRUST_TAG, MEDICINE_SWAP_TAG, 'faction_event', 'theft', medicine ? 'medicine' : 'children'],
    data: {
      sourceEventId: event.id,
      outcome: medicine ? 'medicine_theft' : 'lost_child_theft',
      containerName: event.data?.containerName,
      ownerName: event.data?.ownerName,
      rumorIds: medicine ? ['container_theft_seen', 'rare_pills_trade'] : ['container_theft_seen', 'lead_kvartiry_lost_child_map'],
    },
  });
});

const NINA: PlotNpcDef = {
  name: 'Нина Таблеткина',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.DOCTOR,
  sprite: Occupation.DOCTOR,
  hp: 90, maxHp: 90, money: 28, speed: 0.9,
  inventory: [{ defId: 'bandage', count: 2 }, { defId: 'tea', count: 1 }],
  talkLines: [
    'Это не медпункт, это обмен телесными сроками.',
    'У ликвидаторов бинты, у диких таблетки, у детей температура. И все называют это порядком.',
    'Четыре упаковки таблеток дадут нам ночь без крика из сорок шестой.',
    'Если отдашь таблетки Рудневу, он закроет шкаф. Если отдашь мне, он закроет лицо.',
    'Я не спрашиваю, откуда лекарство. Я спрашиваю, кому оно успеет помочь.',
  ],
  talkLinesPost: [
    'Дети уснули. Теперь можно услышать, как спорят взрослые.',
    'Руднев злится тише обычного. Значит, считает.',
  ],
};

const RUDNEV: PlotNpcDef = {
  name: 'Руднев Перевязочный',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.DOCTOR,
  sprite: Occupation.DOCTOR,
  hp: 120, maxHp: 120, money: 45, speed: 1.0,
  inventory: [{ defId: 'ammo_9mm', count: 8 }, { defId: 'bandage', count: 1 }],
  talkLines: [
    'Медикаменты идут по списку. Кто не в списке, тот терпит.',
    'Нина раздаёт таблетки по жалости, Лёха продаёт по страху. Оба портят учёт.',
    'Верни четыре бинта в пост. После сирены я буду помнить, кто держал перевязку.',
    'Если шкаф пустой, коридор лечится прикладом.',
    'Доступ к запасу не право, а дисциплина.',
  ],
  talkLinesPost: [
    'Бинты на месте. Пост сегодня стреляет не в каждого кашляющего.',
    'Нине скажи: жалость не стерильна.',
  ],
};

const LEKHA: PlotNpcDef = {
  name: 'Лёха Меняла',
  isFemale: false,
  faction: Faction.WILD,
  occupation: Occupation.TRAVELER,
  sprite: Occupation.TRAVELER,
  hp: 105, maxHp: 105, money: 13, speed: 1.2,
  inventory: [{ defId: 'pipe', count: 1 }, { defId: 'cigs', count: 3 }],
  talkLines: [
    'Таблетка в руке честнее талона в кармане.',
    'Мне нужны два антидепрессанта. Не для души, для переговоров.',
    'Ликвидатор держит шкаф, Нина держит детей, я держу дверь. Выбирай, кому веришь.',
    'Если принёс лекарство сюда, назад оно уже идёт по другой цене.',
    'Не бойся слова "краденое". В хруще всё когда-то было чьим-то.',
  ],
  talkLinesPost: [
    'Дверь пока наша. Проходи быстро, пока цена не проснулась.',
    'Нина смотрит как врач. Руднев смотрит как протокол. Я смотрю как человек с трубой.',
  ],
};

const SERAFIMA: PlotNpcDef = {
  name: 'Серафима Шептунья',
  isFemale: true,
  faction: Faction.CULTIST,
  occupation: Occupation.PRIEST,
  sprite: Occupation.PRIEST,
  hp: 95, maxHp: 95, money: 9, speed: 0.9,
  inventory: [{ defId: 'note', count: 2 }, { defId: 'tea', count: 1 }],
  talkLines: [
    'Стена принимает боль, но таблетки делают её разговорчивой.',
    'Три упаковки таблеток, и я уговорю больных молчать до следующей сирены.',
    'Нина лечит тело. Руднев лечит порядок. Лёха лечит цену.',
    'Если лекарство ушло детям, стена голодна. Если стене, дети слышат её лучше.',
    'Не каждый обмен виден в журнале. Некоторые пишут на коже.',
  ],
  talkLinesPost: [
    'Тише стало. Значит, стена жуёт.',
    'Руднев думает, что это кража. Он не слышал, как лекарство само просилось.',
  ],
};

registerSideQuest('kv_nina_tabletkina', NINA, [{
  id: MEDICINE_CHILDREN_QUEST_ID,
  giverNpcId: 'kv_nina_tabletkina',
  type: QuestType.FETCH,
  desc: 'Нина Таблеткина: «Четыре упаковки таблеток детям. Иначе этот коридор будет слушать их жар всю ночь.»',
  targetItem: 'pills', targetCount: 4,
  rewardItem: 'bandage', rewardCount: 2,
  extraRewards: [{ defId: 'water', count: 2 }, { defId: 'bread', count: 2 }],
  relationDelta: 16, xpReward: 45, moneyReward: 25,
  requiresSideQuestDone: LOST_CHILD_MEDICINE_TRUST_QUEST_ID,
  blockedBySideQuestIds: branchBlockers(MEDICINE_CHILDREN_QUEST_ID),
  abandonsSideQuestIds: branchBlockers(MEDICINE_CHILDREN_QUEST_ID),
	  targetFloor: FloorLevel.KVARTIRY,
	  targetRoomType: RoomType.MEDICAL,
	  targetRoomName: MEDICINE_SWAP_ROOM_NAME,
	  targetZoneTag: MEDICINE_ROUTE_TAG,
  targetHint: 'Квартиры: Нина доверяет детский запрос только после воды у Веры и личной передачи.',
  eventPrivacy: 'witnessed',
  eventSeverity: 4,
  eventTargetName: 'Нина получила таблетки для детей после поручительства Веры.',
  eventTags: [KV_MEDICINE_TRUST_TAG, MEDICINE_SWAP_TAG, 'rescue', 'medicine', 'children', 'trust'],
  eventData: {
    outcome: 'children_medicine_rescue',
    medicineAccess: 'nina_child_stock',
    rumorIds: ['rare_pills_trade', 'lead_kvartiry_lost_child_map'],
  },
}]);

registerSideQuest('kv_rudnev_perevyazochny', RUDNEV, [{
  id: LIQUIDATOR_BANDAGES_QUEST_ID,
  giverNpcId: 'kv_rudnev_perevyazochny',
  type: QuestType.FETCH,
  desc: 'Руднев Перевязочный: «Четыре бинта обратно в пост. Без перевязки зачистка станет расстрелом.»',
  targetItem: 'bandage', targetCount: 4,
  rewardItem: 'ammo_9mm', rewardCount: 12,
  extraRewards: [{ defId: 'canned', count: 1 }, { defId: 'water', count: 1 }],
  relationDelta: 12, xpReward: 50, moneyReward: 45,
  blockedBySideQuestIds: branchBlockers(LIQUIDATOR_BANDAGES_QUEST_ID),
  abandonsSideQuestIds: [...branchBlockers(LIQUIDATOR_BANDAGES_QUEST_ID), LOST_CHILD_MEDICINE_TRUST_QUEST_ID],
	  targetFloor: FloorLevel.KVARTIRY,
	  targetRoomType: RoomType.MEDICAL,
	  targetRoomName: MEDICINE_SWAP_ROOM_NAME,
	  targetZoneTag: MEDICINE_ROUTE_TAG,
  targetHint: 'Квартиры: Руднев у аптечного шкафа принимает бинты в обмен на патроны и учет.',
  eventPrivacy: 'local',
  eventSeverity: 4,
  eventTargetName: 'Руднев вернул бинты в ликвидаторский учет и закрыл детский доступ к запасу.',
  eventTags: [KV_MEDICINE_TRUST_TAG, MEDICINE_SWAP_TAG, 'trade', 'liquidator', 'bandage', 'medicine'],
  eventData: {
    outcome: 'liquidator_medicine_trade',
    medicineAccess: 'liquidator_cabinet',
    rumorIds: ['rare_bandage_med'],
  },
}]);

registerSideQuest('kv_lekha_menyala', LEKHA, [{
  id: WILD_ANTIDEP_QUEST_ID,
  giverNpcId: 'kv_lekha_menyala',
  type: QuestType.FETCH,
    desc: 'Лёха Меняла: «Два антидепрессанта - и я не буду мешать тебе у двери.»',
  targetItem: 'antidep', targetCount: 2,
  rewardItem: 'pipe', rewardCount: 1,
  extraRewards: [{ defId: 'cigs', count: 4 }, { defId: 'water', count: 1 }],
  relationDelta: 10, xpReward: 40, moneyReward: 20,
  blockedBySideQuestIds: branchBlockers(WILD_ANTIDEP_QUEST_ID),
  abandonsSideQuestIds: [...branchBlockers(WILD_ANTIDEP_QUEST_ID), LOST_CHILD_MEDICINE_TRUST_QUEST_ID],
	  targetFloor: FloorLevel.KVARTIRY,
	  targetRoomType: RoomType.MEDICAL,
	  targetRoomName: MEDICINE_SWAP_ROOM_NAME,
	  targetZoneTag: MEDICINE_ROUTE_TAG,
  targetHint: 'Квартиры: Лёха держит черный обмен у двери Аптечного разменника.',
  eventPrivacy: 'local',
  eventSeverity: 4,
  eventTargetName: 'Лёха получил антидепрессанты и оставил проход за игроком.',
  eventTags: [KV_MEDICINE_TRUST_TAG, MEDICINE_SWAP_TAG, 'trade', 'wild', 'black_market', 'medicine'],
  eventData: {
    outcome: 'wild_medicine_trade',
    medicineAccess: 'wild_swap',
    rumorIds: ['rare_pills_trade'],
  },
}]);

registerSideQuest('kv_serafima_sheptunya', SERAFIMA, [{
  id: CULTIST_PILLS_QUEST_ID,
  giverNpcId: 'kv_serafima_sheptunya',
  type: QuestType.FETCH,
  desc: 'Серафима Шептунья: «Три упаковки таблеток для тех, кто слышит стену слишком громко.»',
  targetItem: 'pills', targetCount: 3,
  rewardItem: 'psi_stabilizer', rewardCount: 1,
  extraRewards: [{ defId: 'tea', count: 2 }, { defId: 'note', count: 2 }],
  relationDelta: 8, xpReward: 55, moneyReward: 10,
  blockedBySideQuestIds: branchBlockers(CULTIST_PILLS_QUEST_ID),
  abandonsSideQuestIds: [...branchBlockers(CULTIST_PILLS_QUEST_ID), LOST_CHILD_MEDICINE_TRUST_QUEST_ID],
	  targetFloor: FloorLevel.KVARTIRY,
	  targetRoomType: RoomType.MEDICAL,
	  targetRoomName: MEDICINE_SWAP_ROOM_NAME,
	  targetZoneTag: MEDICINE_ROUTE_TAG,
  targetHint: 'Квартиры: Серафима просит таблетки в стороне от Нины и ликвидаторского учета.',
  eventPrivacy: 'secret',
  eventSeverity: 4,
  eventTargetName: 'Серафима забрала таблетки в культовую тишину вместо детского запаса.',
  eventTags: [KV_MEDICINE_TRUST_TAG, MEDICINE_SWAP_TAG, 'trade', 'cult', 'psi', 'medicine'],
  eventData: {
    outcome: 'cult_medicine_trade',
    medicineAccess: 'cult_silence',
    rumorIds: ['rare_pills_trade'],
  },
}]);

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function findContainerCell(world: World, poi: SocialPoiRoom, dx: number, dy: number): { x: number; y: number } | null {
  const preferred = roomCell(poi, dx, dy);
  const pi = world.idx(preferred.x, preferred.y);
  if (world.cells[pi] === Cell.FLOOR) return preferred;
  for (let y = 1; y < poi.h - 1; y++) {
    for (let x = 1; x < poi.w - 1; x++) {
      const wx = world.wrap(poi.x + x);
      const wy = world.wrap(poi.y + y);
      const ci = world.idx(wx, wy);
      if (world.roomMap[ci] === poi.room.id && world.cells[ci] === Cell.FLOOR) return { x: wx, y: wy };
    }
  }
  return null;
}

function addMedicineContainer(
  world: World,
  poi: SocialPoiRoom,
  dx: number,
  dy: number,
  name: string,
  kind: ContainerKind,
  access: WorldContainer['access'],
  inventory: Item[],
  opts: { ownerId?: number; ownerName?: string; faction?: Faction; tags: string[] },
): void {
  const pos = findContainerCell(world, poi, dx, dy);
  if (!pos) return;
  world.addContainer({
    id: nextContainerId(world),
    x: pos.x,
    y: pos.y,
    floor: FloorLevel.KVARTIRY,
    roomId: poi.room.id,
    zoneId: world.zoneMap[world.idx(pos.x, pos.y)],
    kind,
    name,
    inventory: inventory.map(i => ({ ...i })),
    capacitySlots: Math.max(8, inventory.length + 2),
    ownerNpcId: opts.ownerId,
    ownerName: opts.ownerName,
    faction: opts.faction,
    access,
    discovered: true,
    tags: [KV_MEDICINE_TRUST_TAG, MEDICINE_ROUTE_TAG, MEDICINE_SWAP_TAG, 'medical', ...opts.tags],
  });
}

export function generateMedicineSwap(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number }, spawnX: number, spawnY: number,
): number {
  const poi = createSocialPoiRoom(world, nextRoomId, spawnX, spawnY, MEDICINE_SWAP_ROOM_NAME, RoomType.MEDICAL, 14, 9, Tex.TILE_W, Tex.F_TILE, 85, 260, 1.9);
  if (!poi) return nextRoomId;

  for (let x = 2; x < poi.w - 2; x += 3) setFeatureIfFloor(world, poi.x + x, poi.y + 2, Feature.SHELF);
  setFeatureIfFloor(world, poi.x + 1, poi.y + 1, Feature.LAMP);
  setFeatureIfFloor(world, poi.x + poi.w - 2, poi.y + 1, Feature.LAMP);
  setFeatureIfFloor(world, poi.x + 3, poi.y + 5, Feature.BED);
  setFeatureIfFloor(world, poi.x + 5, poi.y + 5, Feature.TABLE);
  setFeatureIfFloor(world, poi.x + 6, poi.y + 5, Feature.CHAIR);
  setFeatureIfFloor(world, poi.x + poi.w - 3, poi.y + 6, Feature.DESK);
  setFeatureIfFloor(world, poi.x + poi.w - 4, poi.y + 6, Feature.CHAIR);

  const ninaId = nextId.v;
  spawnSocialNpc(entities, nextId, NINA, 'kv_nina_tabletkina', poi.x + 2, poi.y + 4);
  const rudnevId = nextId.v;
  spawnSocialNpc(entities, nextId, RUDNEV, 'kv_rudnev_perevyazochny', poi.x + poi.w - 3, poi.y + 3, { weapon: 'makarov' });
  const lekhaId = nextId.v;
  spawnSocialNpc(entities, nextId, LEKHA, 'kv_lekha_menyala', poi.x + 7, poi.y + 6, { weapon: 'pipe' });
  const serafimaId = nextId.v;
  spawnSocialNpc(entities, nextId, SERAFIMA, 'kv_serafima_sheptunya', poi.x + 10, poi.y + 5);
  spawnAmbientNpc(entities, nextId, 'Пациент без талона', Faction.CITIZEN, Occupation.TRAVELER, poi.x + 4, poi.y + 6, [{ defId: 'note', count: 1 }]);
  spawnAmbientNpc(entities, nextId, 'Дежурный у шкафа', Faction.LIQUIDATOR, Occupation.HUNTER, poi.x + poi.w - 5, poi.y + 2, [{ defId: 'ammo_9mm', count: 6 }], 'makarov');
  spawnAmbientNpc(entities, nextId, 'Носильщик с пустой сумкой', Faction.WILD, Occupation.LOCKSMITH, poi.x + 8, poi.y + 2, [{ defId: 'wrench', count: 1 }], 'wrench');

  addMedicineContainer(world, poi, 2, 2, 'Открытый лоток Нины', ContainerKind.MEDICAL_CABINET, 'public', [
    { defId: 'bandage', count: 1 },
    { defId: 'calm_brew', count: 1 },
    { defId: 'tea', count: 1 },
  ], { ownerId: ninaId, ownerName: NINA.name, faction: Faction.CITIZEN, tags: ['public', 'triage', 'trade'] });
  addMedicineContainer(world, poi, 4, 2, 'Детский аптечный запас', ContainerKind.MEDICAL_CABINET, 'owner', [
    { defId: 'pills', count: 4 },
    { defId: 'bandage', count: 2 },
    { defId: 'water', count: 1 },
  ], { ownerId: ninaId, ownerName: NINA.name, faction: Faction.CITIZEN, tags: ['children', 'rescue', 'theft', 'trust'] });
  addMedicineContainer(world, poi, poi.w - 3, 2, 'Перевязочный шкаф Руднева', ContainerKind.MEDICAL_CABINET, 'faction', [
    { defId: 'bandage', count: 4 },
    { defId: 'pills', count: 2 },
    { defId: 'antibiotic', count: 1 },
  ], { ownerId: rudnevId, ownerName: RUDNEV.name, faction: Faction.LIQUIDATOR, tags: ['liquidator', 'bandage', 'theft', 'audit'] });
  addMedicineContainer(world, poi, 8, 2, 'Сумка Лёхи с обменом', ContainerKind.SECRET_STASH, 'owner', [
    { defId: 'antidep', count: 2 },
    { defId: 'pills', count: 1 },
    { defId: 'cigs', count: 3 },
  ], { ownerId: lekhaId, ownerName: LEKHA.name, faction: Faction.WILD, tags: ['wild', 'black_market', 'theft', 'trade'] });
  addMedicineContainer(world, poi, 10, 6, 'Шкатулка шептуньи', ContainerKind.SECRET_STASH, 'owner', [
    { defId: 'pills', count: 3 },
    { defId: 'psi_stabilizer', count: 1 },
    { defId: 'note', count: 1 },
  ], { ownerId: serafimaId, ownerName: SERAFIMA.name, faction: Faction.CULTIST, tags: ['cult', 'psi', 'theft', 'trade'] });

  for (const defId of [
    'bandage', 'water', 'bread', 'note', 'cigs',
  ]) {
    placeDropNear(world, entities, nextId, poi, defId, 1);
  }

  return poi.room.id + 1;
}
