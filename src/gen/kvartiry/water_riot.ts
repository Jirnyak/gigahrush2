/* ── Водяной бунт у стояка — Kvartiry scarcity POI ───────────── */

import {
  Cell,
  ContainerKind,
  Faction,
  Feature,
  FloorLevel,
  Occupation,
  QuestType,
  RoomType,
  Tex,
  msg,
  type Entity,
  type GameState,
  type Item,
  type WorldContainer,
  type WorldEvent,
  type WorldEventPrivacy,
  type WorldEventSeverity,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { changeResourceStock } from '../../systems/economy';
import { getRecentEvents, publishEvent, registerWorldEventObserver } from '../../systems/events';
import { applyFactionRelationDeltas, type FactionRelationDelta } from '../../systems/factions';
import {
  createSocialPoiRoom,
  placeDropNear,
  roomCell,
  setFeatureIfFloor,
  spawnAmbientNpc,
  spawnSocialNpc,
  type SocialPoiRoom,
} from './social_helpers';

export const WATER_RIOT_TAG = 'water_riot';
const OUTCOME_TAG = 'water_riot_outcome';
const ZOYA_ID = 'kv_zoya_stoyak';
const SERGIN_ID = 'kv_sergin_vodouchet';
const KOSTYL_ID = 'kv_kostyl_kanistrovy';
const SURVIVAL_ID = 'kv_sukhoy_karman';

export const WATER_RIOT_QUEST_IDS = {
  residents: 'kv_water_riot_queue_water',
  liquidators: 'kv_water_riot_liquidator_coupons',
  wild: 'kv_water_riot_wild_coupons',
  survival: 'kv_water_riot_selfish_cache',
} as const;

const WATER_RIOT_BRANCH_IDS = [
  WATER_RIOT_QUEST_IDS.residents,
  WATER_RIOT_QUEST_IDS.liquidators,
  WATER_RIOT_QUEST_IDS.wild,
  WATER_RIOT_QUEST_IDS.survival,
] as const;

const RUMOR_IDS = [
  'kvartiry_water_riot_stoyak',
  'kvartiry_water_riot_defense',
  'kvartiry_water_coupon_theft',
] as const;

function rivalQuestIds(id: string): string[] {
  return WATER_RIOT_BRANCH_IDS.filter(other => other !== id);
}

interface WaterRiotOutcome {
  outcome: 'residents' | 'liquidators' | 'wild_looters' | 'survival';
  targetName: string;
  message: string;
  color: string;
  severity: WorldEventSeverity;
  privacy: WorldEventPrivacy;
  relationDeltas: readonly FactionRelationDelta[];
  waterDelta: number;
  couponDelta: number;
  accessOutcome: string;
  tags: readonly string[];
}

const QUEST_OUTCOMES: Record<string, WaterRiotOutcome> = {
  [WATER_RIOT_QUEST_IDS.residents]: {
    outcome: 'residents',
    targetName: 'Очередь у стояка получила воду до драки.',
    message: 'Очередь разошлась с мокрыми руками. Серыгин злится тише, Костыль ищет другую слабость.',
    color: '#6cf',
    severity: 4,
    privacy: 'public',
    relationDeltas: [[Faction.CITIZEN, 8], [Faction.LIQUIDATOR, -4], [Faction.WILD, -7]],
    waterDelta: 4,
    couponDelta: -2,
    accessOutcome: 'public_barrel_kept_open',
    tags: ['residents', 'queue', 'public_access'],
  },
  [WATER_RIOT_QUEST_IDS.liquidators]: {
    outcome: 'liquidators',
    targetName: 'Водные талоны вернулись в ведомость ликвидаторов.',
    message: 'Ведомость снова главнее очереди. У стояка стало тише, но воду теперь выдают через кобуру.',
    color: '#8cf',
    severity: 4,
    privacy: 'local',
    relationDeltas: [[Faction.LIQUIDATOR, 10], [Faction.CITIZEN, -5], [Faction.WILD, -9]],
    waterDelta: 2,
    couponDelta: 6,
    accessOutcome: 'liquidator_token_accounting',
    tags: ['liquidators', 'ledger', 'controlled_access'],
  },
  [WATER_RIOT_QUEST_IDS.wild]: {
    outcome: 'wild_looters',
    targetName: 'Водные талоны ушли диким мимо очереди.',
    message: 'Костыль увел талоны в мокрый черный рынок. Очередь стала суше, зато дикие открывают боковой проход.',
    color: '#fa6',
    severity: 5,
    privacy: 'witnessed',
    relationDeltas: [[Faction.WILD, 13], [Faction.LIQUIDATOR, -12], [Faction.CITIZEN, -8]],
    waterDelta: -4,
    couponDelta: -4,
    accessOutcome: 'wild_looter_shortcut',
    tags: ['wild_looters', 'black_market', 'stolen_access'],
  },
  [WATER_RIOT_QUEST_IDS.survival]: {
    outcome: 'survival',
    targetName: 'Водный спор обошли через личный сухой тайник.',
    message: 'Вы купили себе сухой карман вместо мира у стояка. Все стороны заметили пустое место в очереди.',
    color: '#d8a',
    severity: 4,
    privacy: 'secret',
    relationDeltas: [[Faction.CITIZEN, -6], [Faction.LIQUIDATOR, -5], [Faction.WILD, -3]],
    waterDelta: -2,
    couponDelta: -2,
    accessOutcome: 'private_survival_cache',
    tags: ['survival', 'selfish', 'private_access'],
  },
};

const ZOYA: PlotNpcDef = {
  name: 'Зоя у стояка',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.HOUSEWIFE,
  sprite: Occupation.HOUSEWIFE,
  hp: 90, maxHp: 90, money: 14, speed: 0.9,
  inventory: [{ defId: 'water_coupon', count: 2 }, { defId: 'bread', count: 1 }],
  talkLines: [
    'Стояк шипит, а очередь уже говорит кулаками.',
    'Ликвидатор считает бутылки, Костыль считает спины. Мы считаем детей.',
    'Четыре бутылки воды — и очередь разойдётся без мата и крови. На сегодня.',
    'Талон — это не вода. Но без талона тебя даже к пустому ведру не подпустят.',
    'Можешь уйти. Тут все делают вид, что выбор ещё есть.',
  ],
  talkLinesPost: [
    'Вода пришла. Теперь стояк шипит тише людей.',
    'Если Серыгин спросит — это не милость. Это пожар потушили до дыма.',
  ],
};

const SERGIN: PlotNpcDef = {
  name: 'Серыгин Водоучёт',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 125, maxHp: 125, money: 52, speed: 1.0,
  inventory: [{ defId: 'ammo_9mm', count: 10 }, { defId: 'liquidator_token', count: 1 }, { defId: 'water_coupon', count: 3 }],
  talkLines: [
    'Вода выдаётся по списку. Кто спорит со списком, спорит с кобурой.',
    'Зоя хочет раздать сейчас. Дикие хотят вынести всё. Я хочу, чтобы этаж пережил ночь.',
    'Верни шесть водных талонов в ящик. Потом будем говорить о бутылках.',
    'Если ведомственный ящик тронут без допуска, это кража при свидетелях.',
    'Очередь можно жалеть. Нельзя отдавать ей ключи от стояка.',
  ],
  talkLinesPost: [
    'Талоны снова в учёте. Стрелять пока не требуется.',
    'Зое оставил две бутылки. Не из жалости — из расчёта.',
  ],
};

const KOSTYL: PlotNpcDef = {
  name: 'Костыль Канистровый',
  isFemale: false,
  faction: Faction.WILD,
  occupation: Occupation.TRAVELER,
  sprite: Occupation.TRAVELER,
  hp: 115, maxHp: 115, money: 9, speed: 1.25,
  inventory: [{ defId: 'crowbar', count: 1 }, { defId: 'cigs', count: 2 }],
  talkLines: [
    'Очередь — это когда сильные стоят зря.',
    'Серыгин прячет талоны, Зоя просит по-хорошему. Я предлагаю быстрее.',
    'Четыре талона на воду — и я не вскрою стояк ломом при детях.',
    'Краденое? Тут даже воздух чужой, пока не вдохнул.',
    'Хочешь уйти — уходи. Но сухие руки потом сами вернутся.',
  ],
  talkLinesPost: [
    'Талоны у нас. Очередь стала короче на один страх.',
    'Серыгин злится? Значит, ящик был не пустой.',
  ],
};

registerSideQuest('kv_zoya_stoyak', ZOYA, [{
  id: WATER_RIOT_QUEST_IDS.residents,
  giverNpcId: ZOYA_ID,
  type: QuestType.FETCH,
  desc: 'Зоя у стояка: «Четыре бутылки воды в очередь, пока люди не пошли на ящик ликвидаторов.»',
  targetItem: 'water', targetCount: 4,
  rewardItem: 'water_coupon', rewardCount: 3,
  extraRewards: [{ defId: 'bread', count: 2 }, { defId: 'tea', count: 1 }],
  relationDelta: 8, xpReward: 45, moneyReward: 18,
  targetFloor: FloorLevel.KVARTIRY,
  targetRoomType: RoomType.BATHROOM,
  targetZoneTag: WATER_RIOT_TAG,
  targetHint: 'Квартиры: водораздача у стояка, общая бочка и ведомственный ящик.',
  eventSeverity: 4,
  eventPrivacy: 'public',
  eventTargetName: 'Очередь у стояка получила воду.',
  eventTags: [WATER_RIOT_TAG, 'residents', 'water', 'queue'],
  eventData: { branch: 'residents', waterDelta: 4, rumorIds: RUMOR_IDS },
  abandonsSideQuestIds: rivalQuestIds(WATER_RIOT_QUEST_IDS.residents),
  blockedBySideQuestIds: rivalQuestIds(WATER_RIOT_QUEST_IDS.residents),
}]);

registerSideQuest('kv_sergin_vodouchet', SERGIN, [{
  id: WATER_RIOT_QUEST_IDS.liquidators,
  giverNpcId: SERGIN_ID,
  type: QuestType.FETCH,
  desc: 'Серыгин Водоучёт: «Шесть водных талонов обратно в ведомость. Без учёта стояк станет фронтом.»',
  targetItem: 'water_coupon', targetCount: 6,
  rewardItem: 'ammo_9mm', rewardCount: 12,
  extraRewards: [{ defId: 'liquidator_token', count: 1 }],
  relationDelta: 8, xpReward: 50, moneyReward: 45,
  targetFloor: FloorLevel.KVARTIRY,
  targetRoomType: RoomType.BATHROOM,
  targetZoneTag: WATER_RIOT_TAG,
  targetHint: 'Квартиры: ведомственный ящик воды и учет Серыгина у стояка.',
  eventSeverity: 4,
  eventPrivacy: 'local',
  eventTargetName: 'Водные талоны закреплены за ведомостью ликвидаторов.',
    eventTags: [WATER_RIOT_TAG, 'liquidators', 'water', 'water_coupon', 'ledger'],
  eventData: { branch: 'liquidators', couponDelta: 6, accessOutcome: 'liquidator_token_accounting', rumorIds: RUMOR_IDS },
  abandonsSideQuestIds: rivalQuestIds(WATER_RIOT_QUEST_IDS.liquidators),
  blockedBySideQuestIds: rivalQuestIds(WATER_RIOT_QUEST_IDS.liquidators),
}]);

registerSideQuest('kv_kostyl_kanistrovy', KOSTYL, [{
  id: WATER_RIOT_QUEST_IDS.wild,
  giverNpcId: KOSTYL_ID,
  type: QuestType.FETCH,
  desc: 'Костыль Канистровый: «Четыре водных талона — и я не разнесу стояк ради одной канистры.»',
  targetItem: 'water_coupon', targetCount: 4,
  rewardItem: 'crowbar', rewardCount: 1,
  extraRewards: [{ defId: 'cigs', count: 3 }, { defId: 'metal_water', count: 2 }],
  relationDelta: 8, xpReward: 45, moneyReward: 12,
  targetFloor: FloorLevel.KVARTIRY,
  targetRoomType: RoomType.BATHROOM,
  targetZoneTag: WATER_RIOT_TAG,
  targetHint: 'Квартиры: мокрая очередь и талоны, которые можно унести диким.',
  eventSeverity: 5,
  eventPrivacy: 'witnessed',
  eventTargetName: 'Водные талоны ушли диким лутерам.',
  eventTags: [WATER_RIOT_TAG, 'wild_looters', 'water', 'water_coupon', 'theft'],
  eventData: { branch: 'wild_looters', couponDelta: -4, accessOutcome: 'wild_looter_shortcut', rumorIds: RUMOR_IDS },
  abandonsSideQuestIds: rivalQuestIds(WATER_RIOT_QUEST_IDS.wild),
  blockedBySideQuestIds: rivalQuestIds(WATER_RIOT_QUEST_IDS.wild),
}]);

const SURVIVALIST: PlotNpcDef = {
  name: 'Сухой Карман',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 80, maxHp: 80, money: 31, speed: 0.95,
  inventory: [{ defId: 'filtered_water', count: 1 }, { defId: 'borrowed_kitchen_key', count: 1 }],
  talkLines: [
    'Очередь, кобура, лом — три способа остаться сухим и чужим.',
    'Два талона ко мне, и я покажу сухой карман. Не решение. Выживание.',
    'Зоя назовёт это предательством. Серыгин — недостачей. Костыль — мелкой жадностью.',
    'Зато у тебя будет вода, ключ и время добежать до следующей двери.',
  ],
  talkLinesPost: [
    'Твой сухой карман куплен. Теперь не греми бутылкой у очереди.',
    'Все спорят о справедливости. Живые спорят дольше.',
  ],
};

registerSideQuest(SURVIVAL_ID, SURVIVALIST, [{
  id: WATER_RIOT_QUEST_IDS.survival,
  giverNpcId: SURVIVAL_ID,
  type: QuestType.FETCH,
  desc: 'Сухой Карман: «Два водных талона в личный запас. Очередь, ликвидатор и дикие пусть ищут виноватых друг у друга.»',
  targetItem: 'water_coupon', targetCount: 2,
  rewardItem: 'filtered_water', rewardCount: 2,
  extraRewards: [{ defId: 'borrowed_kitchen_key', count: 1 }, { defId: 'bandage', count: 1 }],
  relationDelta: 0, xpReward: 35, moneyReward: 0,
  targetFloor: FloorLevel.KVARTIRY,
  targetRoomType: RoomType.BATHROOM,
  targetZoneTag: WATER_RIOT_TAG,
  targetHint: 'Квартиры: сухой перекупщик стоит у водяного бунта и продает личный выход.',
  eventSeverity: 4,
  eventPrivacy: 'secret',
  eventTargetName: 'Водные талоны ушли в личный сухой тайник.',
  eventTags: [WATER_RIOT_TAG, 'survival', 'water', 'selfish', 'private_access'],
  eventData: { branch: 'survival', couponDelta: -2, accessOutcome: 'private_survival_cache', rumorIds: RUMOR_IDS },
  abandonsSideQuestIds: rivalQuestIds(WATER_RIOT_QUEST_IDS.survival),
  blockedBySideQuestIds: rivalQuestIds(WATER_RIOT_QUEST_IDS.survival),
}]);

registerWorldEventObserver(handleWaterRiotEvents);

function waterRiotResolved(state: GameState, currentSideQuestId?: string): boolean {
  if (getRecentEvents(state, { tags: [OUTCOME_TAG], limit: 1 }).length > 0) return true;
  return state.quests.some(q => (
    q.sideQuestId !== undefined &&
    q.sideQuestId !== currentSideQuestId &&
    QUEST_OUTCOMES[q.sideQuestId] !== undefined &&
    q.done &&
    !q.failed
  ));
}

function handleWaterRiotEvents(state: GameState, event: WorldEvent): void {
  if (event.type !== 'quest_completed') return;
  const sideQuestId = typeof event.data?.sideQuestId === 'string' ? event.data.sideQuestId : '';
  const outcome = QUEST_OUTCOMES[sideQuestId];
  if (!outcome || waterRiotResolved(state, sideQuestId)) return;
  publishWaterRiotOutcome(state, event, sideQuestId, outcome);
}

function publishWaterRiotOutcome(
  state: GameState,
  event: WorldEvent,
  sideQuestId: string,
  outcome: WaterRiotOutcome,
): void {
  const resourceChanges: Record<string, number> = {};
  if (changeResourceStock(state, 'drink_water', outcome.waterDelta, FloorLevel.KVARTIRY)) {
    resourceChanges.drink_water = outcome.waterDelta;
  }
  const relationDeltas = applyFactionRelationDeltas(outcome.relationDeltas);

  publishEvent(state, {
    type: 'faction_relation_changed',
    floor: FloorLevel.KVARTIRY,
    zoneId: event.zoneId,
    roomId: event.roomId,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetName: outcome.targetName,
    itemId: event.itemId,
    itemName: event.itemName,
    itemCount: event.itemCount,
    severity: outcome.severity,
    privacy: outcome.privacy,
    tags: [OUTCOME_TAG, 'faction_event', WATER_RIOT_TAG, outcome.outcome, 'water', 'coupons', 'access', ...outcome.tags].slice(0, 8),
    data: {
      sourceEventId: event.id,
      sideQuestId,
      outcome: outcome.outcome,
      waterDelta: outcome.waterDelta,
      couponDelta: outcome.couponDelta,
      resourceChanges,
      relationDeltas,
      accessOutcome: outcome.accessOutcome,
      rumorIds: RUMOR_IDS,
      factionEventId: WATER_RIOT_TAG,
      name: outcome.targetName,
    },
  });
  state.msgs.push(msg(outcome.message, state.time, outcome.color));
}

function nextContainerId(world: World): number {
  let id = 1;
  for (const c of world.containers) if (c.id >= id) id = c.id + 1;
  return id;
}

function findContainerCell(world: World, poi: SocialPoiRoom, dx: number, dy: number): { x: number; y: number } | null {
  const preferred = roomCell(poi, dx, dy);
  const pi = world.idx(preferred.x, preferred.y);
  if (world.cells[pi] === Cell.FLOOR || world.cells[pi] === Cell.WATER) return preferred;
  for (let y = 1; y < poi.h - 1; y++) {
    for (let x = 1; x < poi.w - 1; x++) {
      const wx = world.wrap(poi.x + x);
      const wy = world.wrap(poi.y + y);
      const ci = world.idx(wx, wy);
      if (world.roomMap[ci] === poi.room.id && (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER)) return { x: wx, y: wy };
    }
  }
  return null;
}

function addSupplyContainer(
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
    inventory,
    capacitySlots: Math.max(8, inventory.length + 2),
    ownerNpcId: opts.ownerId,
    ownerName: opts.ownerName,
    faction: opts.faction,
    access,
    discovered: true,
    tags: [WATER_RIOT_TAG, ...opts.tags],
  });
}

function setPuddle(world: World, x: number, y: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
  world.cells[ci] = Cell.WATER;
  world.floorTex[ci] = Tex.F_WATER;
}

export function generateWaterRiot(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number }, spawnX: number, spawnY: number,
): number {
  const poi = createSocialPoiRoom(world, nextRoomId, spawnX, spawnY, 'Водораздача у стояка', RoomType.BATHROOM, 16, 9, Tex.TILE_W, Tex.F_TILE, 95, 280, 2.1);
  if (!poi) return nextRoomId;

  setFeatureIfFloor(world, poi.x + 1, poi.y + 1, Feature.LAMP);
  setFeatureIfFloor(world, poi.x + 2, poi.y + 2, Feature.SINK);
  setFeatureIfFloor(world, poi.x + 2, poi.y + 3, Feature.SINK);
  setFeatureIfFloor(world, poi.x + poi.w - 2, poi.y + 1, Feature.SHELF);
  setFeatureIfFloor(world, poi.x + poi.w - 3, poi.y + 1, Feature.DESK);
  for (let y = 2; y < poi.h - 2; y += 2) {
    setFeatureIfFloor(world, poi.x + 6, poi.y + y, Feature.CHAIR);
    setFeatureIfFloor(world, poi.x + 8, poi.y + y, Feature.TABLE);
  }
  for (const p of [[3, 2], [3, 3], [4, 3], [5, 4]] as const) setPuddle(world, poi.x + p[0], poi.y + p[1]);

  spawnSocialNpc(entities, nextId, ZOYA, ZOYA_ID, poi.x + 4, poi.y + 5);
  const authorityId = nextId.v;
  spawnSocialNpc(entities, nextId, SERGIN, SERGIN_ID, poi.x + poi.w - 4, poi.y + 3, { weapon: 'makarov' });
  spawnSocialNpc(entities, nextId, KOSTYL, KOSTYL_ID, poi.x + 10, poi.y + 6, { weapon: 'crowbar' });
  spawnSocialNpc(entities, nextId, SURVIVALIST, SURVIVAL_ID, poi.x + 12, poi.y + 6);
  spawnAmbientNpc(entities, nextId, 'Мать с пустой канистрой', Faction.CITIZEN, Occupation.HOUSEWIFE, poi.x + 5, poi.y + 6, [{ defId: 'water_coupon', count: 1 }]);
  spawnAmbientNpc(entities, nextId, 'Слесарь у сухого вентиля', Faction.CITIZEN, Occupation.LOCKSMITH, poi.x + 3, poi.y + 3, [{ defId: 'wrench', count: 1 }], 'wrench');
  spawnAmbientNpc(entities, nextId, 'Очередник без талона', Faction.CITIZEN, Occupation.TRAVELER, poi.x + 7, poi.y + 5, [{ defId: 'note', count: 1 }]);

  addSupplyContainer(world, poi, poi.w - 3, 2, 'Ведомственный ящик воды', ContainerKind.CASHBOX, 'owner', [
    { defId: 'water', count: 5 },
    { defId: 'filtered_water', count: 1 },
    { defId: 'water_coupon', count: 6 },
    { defId: 'ration_registry_extract', count: 1 },
  ], { ownerId: authorityId, ownerName: SERGIN.name, faction: Faction.LIQUIDATOR, tags: ['liquidator', 'theft', 'water_riot_theft', 'water'] });
  addSupplyContainer(world, poi, 3, poi.h - 2, 'Общая бочка у стояка', ContainerKind.EMERGENCY_BOX, 'public', [
    { defId: 'metal_water', count: 2 },
    { defId: 'water_coupon', count: 1 },
  ], { tags: ['public', 'water'] });

  for (const defId of ['water', 'water', 'metal_water', 'water_coupon', 'water_coupon', 'bread', 'note']) {
    placeDropNear(world, entities, nextId, poi, defId, 1);
  }

  return poi.room.id + 1;
}
