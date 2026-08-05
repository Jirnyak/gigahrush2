/* ── Угол потерянного ребёнка — Kvartiry social pressure POI ─── */

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

export const LOST_CHILD_RATIONS_QUEST_ID = 'kv_lost_child_rations';
export const LOST_CHILD_MEDICINE_TRUST_QUEST_ID = 'kv_lost_child_medicine_trust';
export const KV_MEDICINE_TRUST_TAG = 'kv_medicine_trust_chain';
export const LOST_CHILD_ROOM_NAME = 'Угол потерянного ребёнка';

const LOST_CHILD_TAG = 'kv_lost_child_corner';

const VERA: PlotNpcDef = {
  name: 'Вера Потеряшкина',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.HOUSEWIFE,
  sprite: Occupation.HOUSEWIFE,
  hp: 85, maxHp: 85, money: 12, speed: 0.9,
  inventory: [{ defId: 'tea', count: 1 }, { defId: 'bandage', count: 1 }],
  talkLines: [
    'Тут собирают детей, которых коридор вернул без родителей.',
    'Женя молчит с прошлой сирены. Ему нужна вода и хлеб, не вопросы.',
    'Принесите две бутылки воды. Хлеб я ещё наскребу, без воды дети сдаются быстрее.',
    'Я записываю имена на стене. Стена стирает только тех, кого уже никто не ищет.',
    'Ликвидаторы говорят: эвакуация потом. У детей потом короче, чем у взрослых.',
  ],
  talkLinesPost: [
    'Женя поел. Теперь смотрит на дверь, а не сквозь неё.',
    'Если найдёшь детскую карту, не смейся. Дети рисуют выходы точнее взрослых.',
  ],
};

registerSideQuest('kv_vera_poteryashkina', VERA, [{
  id: LOST_CHILD_RATIONS_QUEST_ID,
  giverNpcId: 'kv_vera_poteryashkina',
  type: QuestType.FETCH,
  desc: 'Вера Потеряшкина: «Две бутылки воды для детей, пока коридор их не забрал.»',
  targetItem: 'water', targetCount: 2,
  rewardItem: 'bandage', rewardCount: 2,
  extraRewards: [{ defId: 'bread', count: 2 }, { defId: 'child_map', count: 1 }, { defId: 'note', count: 2 }],
  relationDelta: 18, xpReward: 45, moneyReward: 10,
  eventPrivacy: 'witnessed',
  eventSeverity: 4,
  eventTargetName: 'Дети у Веры получили воду; Женя пережил жар и доверил карандашный маршрут.',
  eventTags: [KV_MEDICINE_TRUST_TAG, LOST_CHILD_TAG, 'rescue', 'children', 'water', 'trust'],
  eventData: {
    outcome: 'lost_child_rescued',
    trustDelta: 1,
    unlocksSideQuestId: LOST_CHILD_MEDICINE_TRUST_QUEST_ID,
    rumorIds: ['lead_kvartiry_lost_child_map'],
  },
}, {
  id: LOST_CHILD_MEDICINE_TRUST_QUEST_ID,
  giverNpcId: 'kv_vera_poteryashkina',
  type: QuestType.TALK,
  desc: 'Вера Потеряшкина: «Скажите Нине {dir}: Женя пьёт и может дойти. Без этого она не откроет детский аптечный запас.»',
  targetNpcId: 'kv_nina_tabletkina',
  targetFloor: FloorLevel.KVARTIRY,
  targetRoomName: 'Аптечный разменник',
  targetZoneTag: KV_MEDICINE_TRUST_TAG,
  targetHint: 'Квартиры: от угла потерянного ребёнка дойдите до Аптечного разменника и поговорите с Ниной.',
  rewardItem: 'bandage', rewardCount: 1,
  relationDelta: 8, xpReward: 30,
  requiresSideQuestDone: LOST_CHILD_RATIONS_QUEST_ID,
  eventPrivacy: 'witnessed',
  eventSeverity: 3,
  eventTargetName: 'Вера поручилась за игрока перед Ниной Таблеткиной.',
  eventTags: [KV_MEDICINE_TRUST_TAG, LOST_CHILD_TAG, 'talk', 'medicine', 'children', 'trust'],
  eventData: {
    outcome: 'medicine_trust_opened',
    unlocksSideQuestId: 'kv_medicine_children',
    rumorIds: ['lead_kvartiry_medicine_swap_bandage'],
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

function addLostChildContainer(
  world: World,
  poi: SocialPoiRoom,
  dx: number,
  dy: number,
  name: string,
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
    kind: ContainerKind.SECRET_STASH,
    name,
    inventory: inventory.map(i => ({ ...i })),
    capacitySlots: Math.max(8, inventory.length + 2),
    ownerNpcId: opts.ownerId,
    ownerName: opts.ownerName,
    faction: opts.faction,
    access,
    discovered: true,
    tags: [KV_MEDICINE_TRUST_TAG, LOST_CHILD_TAG, ...opts.tags],
  });
}

export function generateLostChildCorner(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number }, spawnX: number, spawnY: number,
): number {
  const poi = createSocialPoiRoom(world, nextRoomId, spawnX, spawnY, LOST_CHILD_ROOM_NAME, RoomType.COMMON, 10, 8, Tex.PANEL, Tex.F_CARPET, 75, 230, 1.4);
  if (!poi) return nextRoomId;

  setFeatureIfFloor(world, poi.x + 1, poi.y + 1, Feature.LAMP);
  setFeatureIfFloor(world, poi.x + 2, poi.y + 2, Feature.TABLE);
  setFeatureIfFloor(world, poi.x + 3, poi.y + 2, Feature.CHAIR);
  setFeatureIfFloor(world, poi.x + 6, poi.y + 5, Feature.BED);
  setFeatureIfFloor(world, poi.x + 7, poi.y + 5, Feature.CHAIR);
  setFeatureIfFloor(world, poi.x + poi.w - 2, poi.y + 1, Feature.SHELF);

  const veraId = nextId.v;
  spawnSocialNpc(entities, nextId, VERA, 'kv_vera_poteryashkina', poi.x + 2, poi.y + 3);
  spawnAmbientNpc(entities, nextId, 'Женя из сорок третьей', Faction.CITIZEN, Occupation.CHILD, poi.x + 6, poi.y + 4, [{ defId: 'note', count: 1 }]);
  spawnAmbientNpc(entities, nextId, 'Девочка с картой', Faction.CITIZEN, Occupation.CHILD, poi.x + 7, poi.y + 3, [{ defId: 'bread', count: 1 }]);
  spawnAmbientNpc(entities, nextId, 'Сосед-дежурный', Faction.CITIZEN, Occupation.LOCKSMITH, poi.x + 4, poi.y + 5, [{ defId: 'wrench', count: 1 }], 'wrench');

  addLostChildContainer(world, poi, poi.w - 2, 2, 'Картонка детских карт', 'owner', [
    { defId: 'child_map', count: 1 },
    { defId: 'water', count: 1 },
    { defId: 'bread', count: 1 },
  ], { ownerId: veraId, ownerName: VERA.name, faction: Faction.CITIZEN, tags: ['children', 'child_map', 'theft', 'trust'] });

  for (const defId of ['bread', 'bread', 'water', 'tea', 'bandage', 'note']) {
    placeDropNear(world, entities, nextId, poi, defId, 1);
  }

  return poi.room.id + 1;
}
