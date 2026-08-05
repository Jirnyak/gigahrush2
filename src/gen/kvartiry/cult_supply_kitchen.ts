/* ── Кухня снабжения ячейки: бытовая культовая логистика ─────── */

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

const ROOM_NAME = 'Кухня снабжения ячейки';

const ZINA: PlotNpcDef = {
  name: 'Зина Кладовая',
  isFemale: true,
  faction: Faction.CULTIST,
  occupation: Occupation.COOK,
  sprite: Occupation.COOK,
  hp: 90, maxHp: 90, money: 18, speed: 0.9,
  inventory: [
    { defId: 'bread', count: 2 },
    { defId: 'kasha', count: 1 },
    { defId: 'borrowed_kitchen_key', count: 1 },
  ],
  talkLines: [
    'Не алтарь это, а кухня. Хлеб сам себя по списку не разнесёт.',
    'Ключи на гвоздике, кастрюли по соседям, фамилии не перепутай.',
    'Липовая пайковая карточка подойдёт. Я внесу тебя в ведомость, будто ты всегда носил мешок.',
    'Украдёшь из шкафа при Нюре — она молчит громче ликвидатора.',
    'Чернобог не моет котлы. Поэтому моем мы.',
  ],
  talkLinesPost: [
    'Карточка ровная. Бери хлеб и не спрашивай, чья там кастрюля.',
    'Если кто спросит, ты возвращал пустые банки. Это звучит почти свято.',
  ],
};

const NYURA: PlotNpcDef = {
  name: 'Нюра Вдверях',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.HOUSEWIFE,
  sprite: Occupation.HOUSEWIFE,
  hp: 75, maxHp: 75, money: 9, speed: 0.9,
  inventory: [{ defId: 'neighbor_complaint', count: 1 }, { defId: 'tea', count: 1 }],
  talkLines: [
    'Я не вхожу. От двери видно больше, чем от плиты.',
    'Зина носит хлеб не детям, а тем, кто шепчет под лестницей.',
    'Принесёшь их кухонный список — я отдам его тем, кто умеет читать вслух.',
    'Можно украсть хлеб. Можно вернуть хлеб. Самый страшный вариант — сделать вид, что кухни нет.',
    'Кастрюля с синей крышкой моя. Они её "одолжили до знака".',
  ],
  talkLinesPost: [
    'Список ушёл из кухни. Теперь дверь смотрит уже не только на тебя.',
    'Если они спросят, я скажу, что считала ложки.',
  ],
};

registerSideQuest('kv_zina_kladovaya', ZINA, [{
  id: 'kv_cult_supply_negotiate',
  giverNpcId: 'kv_zina_kladovaya',
  type: QuestType.FETCH,
  desc: 'Зина Кладовая: «Липовую пайковую карточку, и я внесу тебя в кухонную ведомость без драки.»',
  targetItem: 'forged_ration_card', targetCount: 1,
  rewardItem: 'bread', rewardCount: 3,
  extraRewards: [{ defId: 'kasha', count: 2 }, { defId: 'cult_supply_list', count: 1 }],
  relationDelta: 6, xpReward: 45, moneyReward: 8,
}]);

registerSideQuest('kv_nyura_vdveryah', NYURA, [{
  id: 'kv_cult_supply_expose',
  giverNpcId: 'kv_nyura_vdveryah',
  type: QuestType.FETCH,
  desc: 'Нюра Вдверях: «Кухонный список ячейки на стол. Пусть хлеб считают при людях.»',
  targetItem: 'cult_supply_list', targetCount: 1,
  rewardItem: 'filtered_water', rewardCount: 2,
  extraRewards: [{ defId: 'bread', count: 2 }, { defId: 'neighbor_complaint', count: 1 }],
  relationDelta: 14, xpReward: 55, moneyReward: 18,
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

function addKitchenContainer(
  world: World,
  poi: SocialPoiRoom,
  dx: number,
  dy: number,
  name: string,
  kind: ContainerKind,
  access: WorldContainer['access'],
  inventory: Item[],
  opts: { ownerId?: number; ownerName?: string; faction?: Faction; tags: string[]; capacitySlots?: number },
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
    capacitySlots: opts.capacitySlots ?? Math.max(8, inventory.length + 3),
    ownerNpcId: opts.ownerId,
    ownerName: opts.ownerName,
    faction: opts.faction,
    access,
    discovered: true,
    tags: ['cult', 'supply', 'witness', 'kvartiry', ...opts.tags],
  });
}

function seedKitchenContainers(world: World, poi: SocialPoiRoom, zinaId: number): void {
  addKitchenContainer(
    world, poi, poi.w - 3, 2, 'Паёчный шкаф Зины',
    ContainerKind.FRIDGE, 'owner',
    [
      { defId: 'bread', count: 5 },
      { defId: 'kasha', count: 3 },
      { defId: 'water', count: 2 },
      { defId: 'canned', count: 1 },
      { defId: 'cult_supply_list', count: 1 },
      { defId: 'borrowed_kitchen_key', count: 1 },
      { defId: 'voluntary_receipt', count: 1 },
    ],
    {
      ownerId: zinaId,
      ownerName: ZINA.name,
      faction: Faction.CULTIST,
      tags: ['evidence_drop', 'sabotage_drop', 'theft', 'food', 'paper'],
      capacitySlots: 11,
    },
  );
  addKitchenContainer(
    world, poi, 2, poi.h - 3, 'Общая кастрюля жильцов',
    ContainerKind.EMERGENCY_BOX, 'public',
    [{ defId: 'tea', count: 1 }],
    { faction: Faction.CITIZEN, tags: ['resident_relief', 'food', 'public'], capacitySlots: 10 },
  );
  addKitchenContainer(
    world, poi, 2, 2, 'Жалобная сумка у двери',
    ContainerKind.FILING_CABINET, 'public',
    [{ defId: 'neighbor_complaint', count: 1 }],
    { faction: Faction.LIQUIDATOR, tags: ['evidence_drop', 'paper', 'public'], capacitySlots: 8 },
  );
}

export function generateCultSupplyKitchen(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number }, spawnX: number, spawnY: number,
): number {
  const poi = createSocialPoiRoom(world, nextRoomId, spawnX, spawnY, ROOM_NAME, RoomType.KITCHEN, 14, 9, Tex.TILE_W, Tex.F_LINO, 120, 320, 2.0);
  if (!poi) return nextRoomId;

  for (let x = 2; x < poi.w - 2; x += 3) setFeatureIfFloor(world, poi.x + x, poi.y + 2, Feature.STOVE);
  for (let x = 3; x < poi.w - 2; x += 4) setFeatureIfFloor(world, poi.x + x, poi.y + 5, Feature.TABLE);
  setFeatureIfFloor(world, poi.x + 1, poi.y + 1, Feature.SINK);
  setFeatureIfFloor(world, poi.x + poi.w - 2, poi.y + 1, Feature.SHELF);
  setFeatureIfFloor(world, poi.x + poi.w - 3, poi.y + 1, Feature.CANDLE);
  setFeatureIfFloor(world, poi.x + 2, poi.y + poi.h - 2, Feature.TABLE);
  setFeatureIfFloor(world, poi.x + 1, poi.y + poi.h - 2, Feature.CHAIR);
  setFeatureIfFloor(world, poi.x + poi.w - 2, poi.y + poi.h - 2, Feature.LAMP);

  const zinaId = nextId.v;
  spawnSocialNpc(entities, nextId, ZINA, 'kv_zina_kladovaya', poi.x + poi.w - 4, poi.y + 3, { weapon: 'knife' });
  spawnSocialNpc(entities, nextId, NYURA, 'kv_nyura_vdveryah', poi.x + 2, poi.y + poi.h - 3);
  spawnAmbientNpc(entities, nextId, 'Паломник с авоськой', Faction.CULTIST, Occupation.PILGRIM, poi.x + 7, poi.y + 3, [{ defId: 'bread', count: 1 }]);
  spawnAmbientNpc(entities, nextId, 'Мальчик у порога', Faction.CITIZEN, Occupation.CHILD, poi.x + 4, poi.y + poi.h - 3, [{ defId: 'water_coupon', count: 1 }]);
  spawnAmbientNpc(entities, nextId, 'Ликвидатор без протокола', Faction.LIQUIDATOR, Occupation.HUNTER, poi.x + poi.w - 5, poi.y + 6, [{ defId: 'denunciation', count: 1 }], 'makarov');

  seedKitchenContainers(world, poi, zinaId);

  for (const defId of [
    'bread', 'kasha', 'water', 'soup_cube',
    'voluntary_receipt', 'note', 'borrowed_kitchen_key', 'idol_chernobog',
  ]) {
    placeDropNear(world, entities, nextId, poi, defId, 1);
  }

  return poi.room.id + 1;
}
