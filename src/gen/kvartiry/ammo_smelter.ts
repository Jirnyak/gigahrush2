/* -- Podpolnaya ammo smelter: contested Kvartiry ammo route ------- */

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
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import {
  createSocialPoiRoom,
  placeDropNear,
  setFeatureIfFloor,
  spawnAmbientNpc,
  spawnSocialNpc,
  type SocialPoiRoom,
} from './social_helpers';

const ROOM_NAME = 'Гильзоплавка сорок шестой';

const GESHA: PlotNpcDef = {
  name: 'Геша Гильза',
  isFemale: false,
  faction: Faction.WILD,
  occupation: Occupation.TURNER,
  sprite: Occupation.TURNER,
  hp: 105, maxHp: 105, money: 36, speed: 1.0,
  inventory: [{ defId: 'ammo_9mm', count: 6 }, { defId: 'ammo_nails', count: 6 }, { defId: 'homemade_pistol', count: 1 }],
  talkLines: [
    'Патроны не рождаются. Мы плавим гильзы, гвозди и чужое молчание.',
    'Купить можно тихо. Помочь можно металлом. Сдать можно ликвидатору за дверью.',
    'Горячий ящик не трогай. Там не запас, а причина драки.',
    'Лист металла и инструкцию в горячий ящик принесёшь — отсыплю девятки, пока обход не вернулся.',
    'Если сирена начнёт петь, беги. Плавилка не убежище.',
  ],
  talkLinesPost: [
    'Металл пошёл в дело. Теперь у нас есть шесть честных выстрелов и новая причина молчать.',
    'Патроны бери с умом. ППШ съест их быстрее, чем ты успеешь пожалеть.',
  ],
};

const POLINA: PlotNpcDef = {
  name: 'Полина Обходная',
  isFemale: true,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 115, maxHp: 115, money: 42, speed: 1.0,
  inventory: [{ defId: 'ammo_9mm', count: 6 }, { defId: 'denunciation', count: 1 }, { defId: 'bandage', count: 1 }],
  talkLines: [
    'Я не вижу плавилку. Я вижу незаконный шум, пока нет бумаги.',
    'Принесёшь донос или тетрадь сбыта — закрою шкаф по протоколу.',
    'Купишь у Геши — станешь покупателем. Украдёшь — станешь целью.',
    'Горячие патроны клинят оружие и разговоры. Оба случая лечатся приказом.',
    'Если здесь начнут стрелять, я сначала закрою дверь, потом список.',
  ],
  talkLinesPost: [
    'Бумага есть. Теперь это не слух, а проверка.',
    'Патроны за отчёт выданы. Не трать их на свидетелей.',
  ],
};

registerSideQuest('kv_gesha_gilza', GESHA, [{
  id: 'kv_smelter_metal_help',
  giverNpcId: 'kv_gesha_gilza',
  type: QuestType.FETCH,
  desc: 'Геша Гильза: «Лист металла в горячий ящик. Патроны будут, но тихо.»',
  targetItem: 'metal_sheet', targetCount: 1,
  rewardItem: 'ammo_9mm', rewardCount: 6,
  extraRewards: [{ defId: 'ammo_nails', count: 4 }, { defId: 'cigs', count: 1 }],
  relationDelta: 8, xpReward: 45, moneyReward: 15,
}]);

registerSideQuest('kv_polina_obhodnaya', POLINA, [{
  id: 'kv_smelter_report',
  giverNpcId: 'kv_polina_obhodnaya',
  type: QuestType.FETCH,
  desc: 'Полина Обходная: «Нужен донос на гильзоплавку. Без бумаги я слышу только ремонт.»',
  targetItem: 'denunciation', targetCount: 1,
  rewardItem: 'ammo_shells', rewardCount: 3,
  extraRewards: [{ defId: 'bandage', count: 1 }],
  relationDelta: 11, xpReward: 50, moneyReward: 55,
}]);

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addSmelterContainer(
  world: World,
  poi: SocialPoiRoom,
  dx: number,
  dy: number,
  kind: ContainerKind,
  name: string,
  access: WorldContainer['access'],
  capacitySlots: number,
  inventory: WorldContainer['inventory'],
  tags: string[],
  owner?: { id?: number; name?: string; faction?: Faction; factoryId?: string },
): void {
  const x = world.wrap(poi.x + dx);
  const y = world.wrap(poi.y + dy);
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
  world.addContainer({
    id: nextContainerId(world),
    x,
    y,
    floor: FloorLevel.KVARTIRY,
    roomId: poi.room.id,
    zoneId: world.zoneMap[ci],
    kind,
    name,
    inventory: inventory.map(i => ({ ...i })),
    capacitySlots,
    ownerNpcId: owner?.id,
    ownerName: owner?.name,
    faction: owner?.faction,
    access,
    discovered: true,
    factoryId: owner?.factoryId,
    tags: ['kv_ammo_smelter', ...tags],
  });
}

function seedSmelterContainers(world: World, poi: SocialPoiRoom, geshaId: number): void {
  addSmelterContainer(
    world, poi, poi.w - 3, 2, ContainerKind.WEAPON_CRATE, 'Горячий ящик гильзоплавки',
    'owner', 5,
    [
      { defId: 'ammo_9mm', count: 4 },
      { defId: 'metal_sheet', count: 1 },
      { defId: 'homemade_ammo_instruction', count: 1 },
    ],
    ['ammo', 'weapon', 'production_output', 'illegal', 'theft', 'faction_risk', 'contested_output', 'repair_input'],
    { id: geshaId, name: GESHA.name, faction: Faction.WILD, factoryId: 'illegal_ammo_smelter' },
  );
  addSmelterContainer(
    world, poi, 2, poi.h - 3, ContainerKind.METAL_CABINET, 'Бочка патронного лома',
    'faction', 8,
    [
      { defId: 'metal_sheet', count: 1 },
      { defId: 'pipe', count: 1 },
      { defId: 'spring', count: 1 },
    ],
    ['metal', 'tools', 'recycling', 'theft', 'repair_input'],
    { faction: Faction.WILD },
  );
  addSmelterContainer(
    world, poi, Math.floor(poi.w / 2), poi.h - 2, ContainerKind.SECRET_STASH, 'Тетрадь сбыта гильз',
    'owner', 5,
    [
      { defId: 'denunciation', count: 1 },
      { defId: 'homemade_ammo_instruction', count: 1 },
      { defId: 'voluntary_receipt', count: 1 },
      { defId: 'cigs', count: 2 },
    ],
    ['paper', 'evidence', 'theft', 'liquidator'],
    { id: geshaId, name: GESHA.name, faction: Faction.WILD },
  );
}

export function generateAmmoSmelter(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number }, spawnX: number, spawnY: number,
): number {
  const poi = createSocialPoiRoom(world, nextRoomId, spawnX, spawnY, ROOM_NAME, RoomType.PRODUCTION, 13, 8, Tex.METAL, Tex.F_CONCRETE, 110, 280, 2.2);
  if (!poi) return nextRoomId;

  const furnaceX = poi.x + Math.floor(poi.w / 2);
  setFeatureIfFloor(world, furnaceX, poi.y + 2, Feature.MACHINE);
  setFeatureIfFloor(world, furnaceX + 1, poi.y + 2, Feature.APPARATUS);
  setFeatureIfFloor(world, furnaceX - 1, poi.y + 2, Feature.APPARATUS);
  setFeatureIfFloor(world, poi.x + 2, poi.y + 2, Feature.TABLE);
  setFeatureIfFloor(world, poi.x + 3, poi.y + 2, Feature.CHAIR);
  setFeatureIfFloor(world, poi.x + poi.w - 3, poi.y + 2, Feature.SHELF);
  setFeatureIfFloor(world, poi.x + 2, poi.y + poi.h - 3, Feature.SHELF);
  setFeatureIfFloor(world, poi.x + 1, poi.y + 1, Feature.LAMP);
  setFeatureIfFloor(world, poi.x + poi.w - 2, poi.y + 1, Feature.LAMP);

  const geshaId = nextId.v;
  spawnSocialNpc(entities, nextId, GESHA, 'kv_gesha_gilza', poi.x + 3, poi.y + 3, { weapon: 'homemade_pistol' });
  spawnSocialNpc(entities, nextId, POLINA, 'kv_polina_obhodnaya', poi.x + poi.w - 4, poi.y + 5, { weapon: 'makarov' });
  spawnAmbientNpc(entities, nextId, 'Тимур на стрёме', Faction.WILD, Occupation.TRAVELER, poi.x + 2, poi.y + 5, [{ defId: 'pipe', count: 1 }], 'pipe');
  spawnAmbientNpc(entities, nextId, 'Соседка с мокрым платком', Faction.CITIZEN, Occupation.HOUSEWIFE, poi.x + 7, poi.y + 5, [{ defId: 'note', count: 1 }]);
  spawnAmbientNpc(entities, nextId, 'Ученик у тигля', Faction.WILD, Occupation.LOCKSMITH, poi.x + 8, poi.y + 3, [{ defId: 'spring', count: 1 }], 'wrench');

  seedSmelterContainers(world, poi, geshaId);

  for (const defId of ['spring', 'glass_shard', 'note', 'cigs']) {
    placeDropNear(world, entities, nextId, poi, defId, 1);
  }

  return poi.room.id + 1;
}
