/* ── Очередь за пайком — Kvartiry social pressure POI ────────── */

import {
  Tex,
  Feature,
  RoomType,
  Faction,
  Occupation,
  QuestType,
  ContainerKind,
  FloorLevel,
} from '../../core/types';
import { World } from '../../core/world';
import { type Entity, type WorldContainer } from '../../core/types';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import {
  type SocialPoiRoom,
  createSocialPoiRoom,
  placeDropNear,
  roomCell,
  setFeatureIfFloor,
  spawnAmbientNpc,
  spawnSocialNpc,
} from './social_helpers';

export const RATION_QUEUE_TAG = 'ration_queue';
export const RATION_QUEUE_QUEST_IDS = {
  water: 'kv_ration_water',
  audit: 'kv_coupon_audit_registry',
} as const;

const GALINA: PlotNpcDef = {
  name: 'Галина Талонница',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 95, maxHp: 95, money: 35, speed: 0.9,
  inventory: [
    { defId: 'bread', count: 3 },
    { defId: 'water', count: 2 },
    { defId: 'ballot', count: 5 },
    { defId: 'water_coupon', count: 2 },
    { defId: 'ration_registry_extract', count: 1 },
  ],
  talkLines: [
    'Очередь не движется. Она дышит, но не движется.',
    'Воды по ведомости двенадцать бутылок, на полу восемь. Значит, ведомость врёт или пол пьёт.',
    'Ликвидаторы требуют порядок. Дикие требуют сразу. Я требую принести ещё воды.',
    'Пять бутылок воды спасут этот коридор от драки на десять минут. Больше я не обещаю.',
    'Талон без печати не талон. Печать без хлеба тоже не еда.',
    'У окна вода покупает место, хлеб покупает прыжок. Первое помнят добром, второе — локтями.',
  ],
  talkLinesPost: [
    'Воду принесли. Теперь они спорят тише.',
    'Если услышишь сирену, не стой в очереди. Очередь не укрытие.',
  ],
};

registerSideQuest('kv_galina_talonnitsa', GALINA, [{
  id: RATION_QUEUE_QUEST_IDS.water,
  giverNpcId: 'kv_galina_talonnitsa',
  type: QuestType.FETCH,
  desc: 'Галина Талонница: «Принесите пять бутылок воды, пока очередь не стала бунтом.»',
  targetItem: 'water', targetCount: 5,
  rewardItem: 'bread', rewardCount: 4,
  extraRewards: [{ defId: 'canned', count: 1 }, { defId: 'ballot', count: 6 }],
  relationDelta: 12, xpReward: 35, moneyReward: 25,
  targetFloor: FloorLevel.KVARTIRY,
  targetRoomType: RoomType.OFFICE,
  targetZoneTag: RATION_QUEUE_TAG,
  targetHint: 'Квартиры: Пункт выдачи талонов, очередь Галины и касса пайкового реестра.',
  eventSeverity: 4,
  eventPrivacy: 'public',
  eventTargetName: 'Пайковую очередь удержали водой до бунта.',
  eventTags: ['ration_queue', 'water', 'queue', 'resident_relief', 'faction_event'],
  eventData: {
    crisisRoute: 'ration_water_relief',
    localTrace: 'ration_ledger_box',
    rumorIds: ['smoking_water_queue_price', 'kvartiry_queue_unrest', 'floor_kvartiry_riot'],
  },
}, {
  id: RATION_QUEUE_QUEST_IDS.audit,
  giverNpcId: 'kv_galina_talonnitsa',
  type: QuestType.FETCH,
  desc: 'Галина Талонница: «Принесите выписку из пайкового реестра. Если список врёт, очередь начнёт есть друг друга.»',
  targetItem: 'ration_registry_extract', targetCount: 1,
  rewardItem: 'concentrate_coupon', rewardCount: 2,
  extraRewards: [{ defId: 'water_coupon', count: 2 }, { defId: 'bread', count: 2 }],
  relationDelta: 14, xpReward: 55, moneyReward: 35,
  targetFloor: FloorLevel.KVARTIRY,
  targetRoomType: RoomType.OFFICE,
  targetZoneTag: 'ration_coupon_audit',
  targetHint: 'Квартиры: касса Галины у пайковой очереди хранит выписку, талоны и поддельную карточку.',
  eventSeverity: 4,
  eventPrivacy: 'witnessed',
  eventTargetName: 'Пайковый реестр сверили при очереди.',
  eventTags: ['ration_queue', 'ration_audit', 'paper', 'queue', 'faction_event'],
  eventData: {
    crisisRoute: 'ration_coupon_audit',
    localTrace: 'ration_registry_extract',
    rumorIds: ['lead_kvartiry_ration_queue_registry', 'ration_coupon_audit_reported', 'ration_coupon_forgery_risk'],
  },
}]);

function nextContainerId(world: World): number {
  let id = 1;
  for (const c of world.containers) if (c.id >= id) id = c.id + 1;
  return id;
}

function addRationLedgerBox(
  world: World,
  poi: SocialPoiRoom,
  dx: number,
  dy: number,
  ownerId: number,
): void {
  const pos = roomCell(poi, dx, dy);
  const inventory: WorldContainer['inventory'] = [
    { defId: 'water_coupon', count: 4 },
    { defId: 'concentrate_coupon', count: 3 },
    { defId: 'ration_registry_extract', count: 1 },
    { defId: 'forged_ration_card', count: 1 },
  ];
  world.addContainer({
    id: nextContainerId(world),
    x: pos.x,
    y: pos.y,
    floor: FloorLevel.KVARTIRY,
    roomId: poi.room.id,
    zoneId: world.zoneMap[world.idx(pos.x, pos.y)],
    kind: ContainerKind.CASHBOX,
    name: 'Касса пайковых талонов',
    inventory,
    capacitySlots: 8,
    ownerNpcId: ownerId,
    ownerName: GALINA.name,
    faction: Faction.CITIZEN,
    access: 'owner',
    discovered: true,
    tags: [RATION_QUEUE_TAG, 'ration_coupon_audit', 'paper', 'theft'],
  });
}

export function generateRationQueue(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number }, spawnX: number, spawnY: number,
): number {
  const poi = createSocialPoiRoom(world, nextRoomId, spawnX, spawnY, 'Пункт выдачи талонов', RoomType.OFFICE, 15, 7, Tex.PANEL, Tex.F_LINO, 35, 120, 1.3);
  if (!poi) return nextRoomId;

  for (let x = 2; x < poi.w - 2; x += 2) setFeatureIfFloor(world, poi.x + x, poi.y + 2, Feature.TABLE);
  setFeatureIfFloor(world, poi.x + poi.w - 2, poi.y + 1, Feature.SHELF);
  setFeatureIfFloor(world, poi.x + 1, poi.y + 1, Feature.LAMP);

  const galinaId = nextId.v;
  spawnSocialNpc(entities, nextId, GALINA, 'kv_galina_talonnitsa', poi.x + 2, poi.y + 2);
  spawnAmbientNpc(entities, nextId, 'Витя Нормировщик', Faction.LIQUIDATOR, Occupation.HUNTER, poi.x + poi.w - 3, poi.y + 2, [{ defId: 'ammo_9mm', count: 6 }], 'makarov');
  spawnAmbientNpc(entities, nextId, 'Молчун с бидоном', Faction.CITIZEN, Occupation.LOCKSMITH, poi.x + 5, poi.y + 4, [{ defId: 'water', count: 1 }]);
  spawnAmbientNpc(entities, nextId, 'Бабка без номера', Faction.CITIZEN, Occupation.HOUSEWIFE, poi.x + 7, poi.y + 4, [{ defId: 'bread', count: 1 }]);
  spawnAmbientNpc(entities, nextId, 'Очередник с арматурой', Faction.WILD, Occupation.TRAVELER, poi.x + 9, poi.y + 4, [{ defId: 'rebar', count: 1 }], 'rebar');
  addRationLedgerBox(world, poi, poi.w - 2, 1, galinaId);

  for (const defId of ['bread', 'bread', 'bread', 'water', 'water', 'canned', 'water_coupon', 'concentrate_coupon', 'ballot', 'note']) {
    placeDropNear(world, entities, nextId, poi, defId, 1);
  }

  const gap = roomCell(poi, poi.w - 2, poi.h - 2);
  setFeatureIfFloor(world, gap.x, gap.y, Feature.CHAIR);
  return poi.room.id + 1;
}
