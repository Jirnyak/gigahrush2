/* ── Коммунальная кухня: фракционная бытовая драка ───────────── */

import {
  Cell,
  ContainerKind,
  Tex,
  Feature,
  FloorLevel,
  RoomType,
  Faction,
  Occupation,
  QuestType,
  type Entity,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import {
  createSocialPoiRoom,
  placeDropNear,
  roomCell,
  setFeatureIfFloor,
  spawnAmbientNpc,
  spawnSocialNpc,
  type SocialPoiRoom,
} from './social_helpers';

const RAYA_ID = 'kv_raya_skovorodkina';
const SANEK_ID = 'kv_sanek_konforka';
const FEOFAN_ID = 'kv_kitchen_feofan';
const WITNESS_ID = 'kv_kitchen_lida_svidetel';
const LIQUIDATOR_ID = 'kv_kitchen_kipyatkov';

export const COMMUNAL_KITCHEN_FEUD_QUEST_IDS = {
  mediateFood: 'kv_kitchen_kasha',
  sideSanek: 'kv_sanek_cigs',
  stealKey: 'kv_kitchen_steal_key',
  exposeCard: 'kv_kitchen_expose_card',
  callLiquidators: 'kv_kitchen_call_liquidators',
} as const;

export const COMMUNAL_KITCHEN_FEUD_FINAL_BRANCH_IDS = [
  COMMUNAL_KITCHEN_FEUD_QUEST_IDS.mediateFood,
  COMMUNAL_KITCHEN_FEUD_QUEST_IDS.sideSanek,
  COMMUNAL_KITCHEN_FEUD_QUEST_IDS.stealKey,
  COMMUNAL_KITCHEN_FEUD_QUEST_IDS.exposeCard,
  COMMUNAL_KITCHEN_FEUD_QUEST_IDS.callLiquidators,
] as const;

function branchBlockers(id: string): string[] {
  return COMMUNAL_KITCHEN_FEUD_FINAL_BRANCH_IDS.filter(qid => qid !== id);
}

const RAYA: PlotNpcDef = {
  name: 'Рая Сковородкина',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.COOK,
  sprite: Occupation.COOK,
  hp: 90, maxHp: 90, money: 26, speed: 0.9,
  inventory: [{ defId: 'kasha', count: 3 }, { defId: 'tea', count: 2 }, { defId: 'knife', count: 1 }],
  talkLines: [
    'Это не кухня. Это переговорная с кипятком.',
    'Санёк крутит газ, Феофан шепчет над ключом, Лида считает свидетелей, ликвидатор нюхает кастрюли.',
    'Принеси пять пачек каши. Я накормлю всех, пока они снова не начали делить плиту и власть.',
    'Крышка от кастрюли сильнее любого протокола, если бить вовремя.',
    'Не трогай левую плиту. Она считает себя начальником сектора.',
  ],
  talkLinesPost: [
    'Каша есть. Теперь спорят о соли, а не о власти.',
    'Садись у стены. У стены меньше летает посуды.',
  ],
};

const SANEK: PlotNpcDef = {
  name: 'Санёк Конфорка',
  isFemale: false,
  faction: Faction.WILD,
  occupation: Occupation.TRAVELER,
  sprite: Occupation.TRAVELER,
  hp: 110, maxHp: 110, money: 7, speed: 1.2,
  inventory: [{ defId: 'pipe', count: 1 }, { defId: 'cigs', count: 2 }],
  talkLines: [
    'Кто держит плиту, тот держит этаж.',
    'Рая добрая, пока нож лежит ручкой к ней.',
    'Мне нужны сигареты. Восемь пачек - и газ сегодня будет на моей стороне, а не на Райиной.',
    'Ликвидатору скажи: очередь на кипяток вне закона не стоит.',
    'Если кастрюля свистит три раза, значит кто-то врёт.',
  ],
  talkLinesPost: [
    'Ладно, газ открыт. Но это не перемирие, это перекур.',
    'Передай Рае, что я её половник не трогал. Сегодня.',
  ],
};

const FEOFAN: PlotNpcDef = {
  name: 'Феофан у кастрюли',
  isFemale: false,
  faction: Faction.CULTIST,
  occupation: Occupation.PRIEST,
  sprite: Occupation.PRIEST,
  hp: 80, maxHp: 80, money: 3, speed: 0.8,
  inventory: [{ defId: 'kasha', count: 1 }, { defId: 'holy_water', count: 1 }],
  talkLines: [
    'Ключ от кухни должен лежать у того, кто держит очередь, а не у того, кто считает порции.',
    'Рая прячет заёмный ключ в тумбе. Принесёшь - будем открывать кухню без ее крика.',
    'Кража тише драки только до первого свидетеля.',
  ],
  talkLinesPost: [
    'Ключ теперь у меня. Рая будет кричать, но дверь откроется с нашей стороны.',
    'Если Рая спросит, ключ ушёл на общий порядок.',
  ],
};

const WITNESS: PlotNpcDef = {
  name: 'Лида Ситечко',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 75, maxHp: 75, money: 14, speed: 0.9,
  inventory: [{ defId: 'inspection_mirror', count: 1 }, { defId: 'sealed_complaint', count: 1 }],
  talkLines: [
    'Я видела, кто подложил карточку, но видела через сито. В суде такое не любят.',
    'В газовом ящике Санька лежит поддельная пайковая карточка. Достанешь её - у меня будет предмет, а не одни слова.',
    'Свидетель без предмета здесь просто шум с именем.',
  ],
  talkLinesPost: [
    'Карточку увидели все. Теперь спорят о подделке, а не о том, кто громче.',
    'Я запомнила твоё лицо с правильной стороны сита.',
  ],
};

const LIQUIDATOR: PlotNpcDef = {
  name: 'Кипятков из обхода',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 130, maxHp: 130, money: 34, speed: 0.95,
  inventory: [{ defId: 'makarov', count: 1 }, { defId: 'ammo_9mm', count: 8 }, { defId: 'liquidator_ration', count: 1 }],
  talkLines: [
    'Кухонная драка без бумаги - быт. С бумагой - вызов наряда.',
    'Нужна жалоба под сургучом. Тогда я закрою плиту, а не глаза.',
    'Ликвидаторы не любят кастрюли. В них слишком часто прячут причины.',
  ],
  talkLinesPost: [
    'Жалоба принята. Наряд любит, когда его вызывают до крови.',
    'Плита опечатана на десять минут. В Гигахруще это уже мир.',
  ],
};

registerSideQuest(RAYA_ID, RAYA, [{
  id: COMMUNAL_KITCHEN_FEUD_QUEST_IDS.mediateFood,
  giverNpcId: RAYA_ID,
  type: QuestType.FETCH,
  desc: 'Рая Сковородкина: «Пять пачек каши на общий стол. Пока люди жуют, они хуже делят власть.»',
  targetItem: 'kasha', targetCount: 5,
  rewardItem: 'kompot', rewardCount: 3,
  extraRewards: [{ defId: 'bread', count: 3 }, { defId: 'tea', count: 2 }],
  relationDelta: 14, xpReward: 45, moneyReward: 20,
  targetFloor: FloorLevel.KVARTIRY,
  targetRoomType: RoomType.KITCHEN,
  targetZoneTag: 'kitchen_feud',
  targetHint: 'Квартиры: Коммунальная кухня раздора, пять порций каши для мирного стола',
  blockedBySideQuestIds: branchBlockers(COMMUNAL_KITCHEN_FEUD_QUEST_IDS.mediateFood),
  abandonsSideQuestIds: branchBlockers(COMMUNAL_KITCHEN_FEUD_QUEST_IDS.mediateFood),
  eventPrivacy: 'witnessed',
  eventTags: ['kitchen_feud', 'mediate', 'food', 'witness', 'pressure'],
  eventTargetName: 'Коммунальную кухню удержали едой вместо драки.',
  eventData: {
    kitchenFeudOutcome: 'mediate_food',
    rumorIds: ['faction_citizen_food', 'kvartiry_kitchen_feud', 'lead_kvartiry_kitchen_kasha'],
  },
}]);

registerSideQuest(SANEK_ID, SANEK, [{
  id: COMMUNAL_KITCHEN_FEUD_QUEST_IDS.sideSanek,
  giverNpcId: SANEK_ID,
  type: QuestType.FETCH,
  desc: 'Санёк Конфорка: «Восемь пачек сигарет, и я держу газ против Райиной кастрюльной власти.»',
  targetItem: 'cigs', targetCount: 8,
  rewardItem: 'pipe', rewardCount: 1,
  extraRewards: [{ defId: 'water', count: 2 }],
  relationDelta: 8, xpReward: 35, moneyReward: 15,
  targetFloor: FloorLevel.KVARTIRY,
  targetRoomType: RoomType.KITCHEN,
  targetZoneTag: 'kitchen_feud',
  targetHint: 'Квартиры: Коммунальная кухня раздора, сигареты для стороны Санька',
  blockedBySideQuestIds: branchBlockers(COMMUNAL_KITCHEN_FEUD_QUEST_IDS.sideSanek),
  abandonsSideQuestIds: branchBlockers(COMMUNAL_KITCHEN_FEUD_QUEST_IDS.sideSanek),
  eventPrivacy: 'witnessed',
  eventTags: ['kitchen_feud', 'side', 'wild', 'gas', 'pressure'],
  eventTargetName: 'Санёк получил сигареты и удержал газовую сторону кухни.',
  eventData: {
    kitchenFeudOutcome: 'side_sanek',
    rumorIds: ['kvartiry_kitchen_feud', 'player_hurt_remembered'],
  },
}]);

registerSideQuest(FEOFAN_ID, FEOFAN, [{
  id: COMMUNAL_KITCHEN_FEUD_QUEST_IDS.stealKey,
  giverNpcId: FEOFAN_ID,
  type: QuestType.FETCH,
    desc: 'Феофан у кастрюли: «Укради заёмный кухонный ключ из Райиной тумбы. Без ключа Рая держит кухню на крике.»',
  targetItem: 'borrowed_kitchen_key', targetCount: 1,
  rewardItem: 'holy_water', rewardCount: 1,
  extraRewards: [{ defId: 'kasha', count: 2 }],
  relationDelta: 10, xpReward: 55, moneyReward: 12,
  targetFloor: FloorLevel.KVARTIRY,
  targetRoomType: RoomType.KITCHEN,
  targetZoneTag: 'kitchen_feud',
  targetHint: 'Квартиры: ключ в Райиной тумбе на Коммунальной кухне, кражу могут увидеть',
  blockedBySideQuestIds: branchBlockers(COMMUNAL_KITCHEN_FEUD_QUEST_IDS.stealKey),
  abandonsSideQuestIds: branchBlockers(COMMUNAL_KITCHEN_FEUD_QUEST_IDS.stealKey),
  eventPrivacy: 'secret',
  eventTags: ['kitchen_feud', 'steal', 'theft', 'cult', 'pressure'],
  eventTargetName: 'Заёмный кухонный ключ вынесли из Райиной тумбы.',
  eventData: {
    kitchenFeudOutcome: 'steal_key',
    rumorIds: ['container_theft_seen', 'kvartiry_kitchen_feud'],
  },
}]);

registerSideQuest(WITNESS_ID, WITNESS, [{
  id: COMMUNAL_KITCHEN_FEUD_QUEST_IDS.exposeCard,
  giverNpcId: WITNESS_ID,
  type: QuestType.FETCH,
  desc: 'Лида Ситечко: «Достаньте поддельную пайковую карточку из газового ящика. С предметом я свидетель, без него - шум.»',
  targetItem: 'forged_ration_card', targetCount: 1,
  rewardItem: 'inspection_mirror', rewardCount: 1,
  extraRewards: [{ defId: 'filtered_water', count: 1 }],
  relationDelta: 12, xpReward: 60, moneyReward: 22,
  targetFloor: FloorLevel.KVARTIRY,
  targetRoomType: RoomType.KITCHEN,
  targetZoneTag: 'kitchen_feud',
  targetHint: 'Квартиры: газовый ящик Санька на Коммунальной кухне, нужна поддельная карточка',
  blockedBySideQuestIds: branchBlockers(COMMUNAL_KITCHEN_FEUD_QUEST_IDS.exposeCard),
  abandonsSideQuestIds: branchBlockers(COMMUNAL_KITCHEN_FEUD_QUEST_IDS.exposeCard),
  eventPrivacy: 'public',
  eventTags: ['kitchen_feud', 'expose', 'witness', 'ration', 'pressure'],
  eventTargetName: 'Свидетельница вынесла поддельную карточку в общий спор кухни.',
  eventData: {
    kitchenFeudOutcome: 'expose_forgery',
    rumorIds: ['ration_coupon_forgery_risk', 'kvartiry_kitchen_feud'],
  },
}]);

registerSideQuest(LIQUIDATOR_ID, LIQUIDATOR, [{
  id: COMMUNAL_KITCHEN_FEUD_QUEST_IDS.callLiquidators,
  giverNpcId: LIQUIDATOR_ID,
  type: QuestType.FETCH,
  desc: 'Кипятков из обхода: «Принеси жалобу под сургучом. Вызову наряд и опечатаю плиту до первой крови.»',
  targetItem: 'sealed_complaint', targetCount: 1,
  rewardItem: 'liquidator_ration', rewardCount: 1,
  extraRewards: [{ defId: 'ammo_9mm', count: 6 }],
  relationDelta: 12, xpReward: 55, moneyReward: 35,
  targetFloor: FloorLevel.KVARTIRY,
  targetRoomType: RoomType.KITCHEN,
  targetZoneTag: 'kitchen_feud',
  targetHint: 'Квартиры: жалоба под сургучом на столе свидетелей Коммунальной кухни',
  blockedBySideQuestIds: branchBlockers(COMMUNAL_KITCHEN_FEUD_QUEST_IDS.callLiquidators),
  abandonsSideQuestIds: branchBlockers(COMMUNAL_KITCHEN_FEUD_QUEST_IDS.callLiquidators),
  eventPrivacy: 'public',
  eventTags: ['kitchen_feud', 'liquidator', 'report', 'witness', 'pressure'],
  eventTargetName: 'Ликвидаторов вызвали на коммунальную кухню до драки.',
  eventData: {
    kitchenFeudOutcome: 'call_liquidators',
    rumorIds: ['faction_liquidator_patrol', 'kvartiry_kitchen_feud'],
  },
}]);

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function findContainerCell(world: World, room: SocialPoiRoom, dx: number, dy: number): { x: number; y: number } {
  const preferred = roomCell(room, dx, dy);
  if (world.cells[world.idx(preferred.x, preferred.y)] === Cell.FLOOR) return preferred;
  for (let y = 1; y < room.h - 1; y++) {
    for (let x = 1; x < room.w - 1; x++) {
      const wx = world.wrap(room.x + x);
      const wy = world.wrap(room.y + y);
      const ci = world.idx(wx, wy);
      if (world.roomMap[ci] === room.room.id && world.cells[ci] === Cell.FLOOR) return { x: wx, y: wy };
    }
  }
  return preferred;
}

function addKitchenContainer(
  world: World,
  room: SocialPoiRoom,
  dx: number,
  dy: number,
  spec: {
    kind: ContainerKind;
    name: string;
    inventory: WorldContainer['inventory'];
    access: WorldContainer['access'];
    ownerId?: number;
    ownerName?: string;
    faction?: Faction;
    tags: string[];
  },
): void {
  const pos = findContainerCell(world, room, dx, dy);
  world.addContainer({
    id: nextContainerId(world),
    x: pos.x,
    y: pos.y,
    floor: FloorLevel.KVARTIRY,
    roomId: room.room.id,
    zoneId: world.zoneMap[world.idx(pos.x, pos.y)],
    kind: spec.kind,
    name: spec.name,
    inventory: spec.inventory,
    capacitySlots: 8,
    ownerNpcId: spec.ownerId,
    ownerName: spec.ownerName,
    faction: spec.faction,
    access: spec.access,
    discovered: true,
    tags: spec.tags,
  });
}

export function generateCommunalKitchenFeud(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number }, spawnX: number, spawnY: number,
): number {
  const poi = createSocialPoiRoom(world, nextRoomId, spawnX, spawnY, 'Коммунальная кухня раздора', RoomType.KITCHEN, 15, 10, Tex.TILE_W, Tex.F_TILE, 65, 210, 2.2);
  if (!poi) return nextRoomId;

  for (let x = 2; x < poi.w - 2; x += 3) setFeatureIfFloor(world, poi.x + x, poi.y + 2, Feature.STOVE);
  for (let x = 3; x < poi.w - 2; x += 4) setFeatureIfFloor(world, poi.x + x, poi.y + 6, Feature.TABLE);
  setFeatureIfFloor(world, poi.x + 1, poi.y + 1, Feature.SINK);
  setFeatureIfFloor(world, poi.x + poi.w - 2, poi.y + 1, Feature.LAMP);
  setFeatureIfFloor(world, poi.x + 2, poi.y + 1, Feature.SHELF);
  setFeatureIfFloor(world, poi.x + poi.w - 3, poi.y + 2, Feature.SHELF);
  setFeatureIfFloor(world, poi.x + 5, poi.y + 7, Feature.TABLE);

  const rayaEntityId = nextId.v;
  spawnSocialNpc(entities, nextId, RAYA, RAYA_ID, poi.x + 3, poi.y + 3, { weapon: 'knife' });
  const sanekEntityId = nextId.v;
  spawnSocialNpc(entities, nextId, SANEK, SANEK_ID, poi.x + poi.w - 4, poi.y + 4, { weapon: 'pipe' });
  const feofanEntityId = nextId.v;
  spawnSocialNpc(entities, nextId, FEOFAN, FEOFAN_ID, poi.x + 7, poi.y + 3);
  spawnSocialNpc(entities, nextId, WITNESS, WITNESS_ID, poi.x + 4, poi.y + 7);
  spawnSocialNpc(entities, nextId, LIQUIDATOR, LIQUIDATOR_ID, poi.x + 10, poi.y + 7, { weapon: 'makarov' });
  spawnAmbientNpc(entities, nextId, 'Соседка с солью', Faction.CITIZEN, Occupation.HOUSEWIFE, poi.x + 6, poi.y + 5, [{ defId: 'rock_salt', count: 1 }]);
  spawnAmbientNpc(entities, nextId, 'Пустой бидонщик', Faction.WILD, Occupation.TRAVELER, poi.x + 11, poi.y + 5, [{ defId: 'water', count: 1 }]);

  addKitchenContainer(world, poi, 2, 1, {
    kind: ContainerKind.FRIDGE,
    name: 'Райина тумба у плиты',
    inventory: [
      { defId: 'kasha', count: 3 },
      { defId: 'kompot', count: 1 },
      { defId: 'borrowed_kitchen_key', count: 1 },
    ],
    access: 'owner',
    ownerId: rayaEntityId,
    ownerName: RAYA.name,
    faction: Faction.CITIZEN,
    tags: ['kitchen_feud', 'food', 'theft', 'resident_relief'],
  });
  addKitchenContainer(world, poi, poi.w - 3, 2, {
    kind: ContainerKind.METAL_CABINET,
    name: 'Саньков газовый ящик',
    inventory: [
      { defId: 'forged_ration_card', count: 1 },
      { defId: 'cigs', count: 3 },
      { defId: 'water_coupon', count: 1 },
    ],
    access: 'owner',
    ownerId: sanekEntityId,
    ownerName: SANEK.name,
    faction: Faction.WILD,
    tags: ['kitchen_feud', 'ration', 'forgery', 'theft'],
  });
  addKitchenContainer(world, poi, 5, 7, {
    kind: ContainerKind.FILING_CABINET,
    name: 'Стол свидетельских жалоб',
    inventory: [
      { defId: 'sealed_complaint', count: 1 },
      { defId: 'note', count: 1 },
      { defId: 'inspection_mirror', count: 1 },
    ],
    access: 'public',
    ownerId: feofanEntityId,
    ownerName: FEOFAN.name,
    faction: Faction.CITIZEN,
    tags: ['kitchen_feud', 'witness', 'paper', 'evidence_drop'],
  });

  for (const defId of ['kasha', 'kasha', 'bread', 'bread', 'water', 'tea', 'kompot', 'knife', 'note', 'sealed_complaint']) {
    placeDropNear(world, entities, nextId, poi, defId, 1);
  }

  return poi.room.id + 1;
}
