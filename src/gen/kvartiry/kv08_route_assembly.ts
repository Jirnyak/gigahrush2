/* ── Маршрутный сход: три спорных выхода с этажа Квартир ─────── */

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
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import {
  createSocialPoiRoom,
  placeDropNear,
  roomCell,
  setFeatureIfFloor,
  spawnAmbientNpc,
  spawnSocialNpc,
  type SocialPoiRoom,
} from './social_helpers';

interface RouteOutcome {
  targetName: string;
  routeImpact: string;
  tags: string[];
  rumorIds: string[];
}

const ROUTE_OUTCOMES: Record<string, RouteOutcome> = {
  kv08_open_manhattan_crossroads: {
    targetName: 'Прорез к Манхэттенским перекрёсткам',
    routeImpact: 'manhattan_crossroads_patrol_cut',
    tags: ['route_manhattan_crossroads', 'liquidator', 'documents'],
    rumorIds: ['rare_elevator_order'],
  },
  kv08_hold_communal_ring: {
    targetName: 'Тихая цепочка к Коммунальному кольцу',
    routeImpact: 'communal_ring_safe_chain',
    tags: ['route_communal_ring', 'citizen', 'food'],
    rumorIds: ['lead_kvartiry_lost_child_map'],
  },
  kv08_sell_market_88_lane: {
    targetName: 'Проданный обход рынка 88',
    routeImpact: 'market_88_caravan_lane',
    tags: ['route_market_88', 'black_market', 'documents'],
    rumorIds: ['contract_black_market_88_counter'],
  },
};

registerWorldEventObserver((state, event) => {
  if (event.type !== 'quest_completed') return;
  const sideQuestId = typeof event.data?.sideQuestId === 'string' ? event.data.sideQuestId : '';
  const outcome = ROUTE_OUTCOMES[sideQuestId];
  if (!outcome) return;
  publishEvent(state, {
    type: 'faction_relation_changed',
    floor: FloorLevel.KVARTIRY,
    zoneId: event.zoneId,
    roomId: event.roomId,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetName: outcome.targetName,
    severity: 4,
    privacy: 'public',
    tags: ['kv08_route_outcome', 'faction_event', ...outcome.tags],
    data: {
      sourceEventId: event.id,
      sideQuestId,
      routeImpact: outcome.routeImpact,
      rumorIds: outcome.rumorIds,
    },
  });
});

const BORYA: PlotNpcDef = {
  name: 'Боря Прорез',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 130, maxHp: 130, money: 54, speed: 1.0,
  inventory: [{ defId: 'ammo_9mm', count: 10 }, { defId: 'pipe', count: 1 }, { defId: 'lift_scheme', count: 1 }],
  talkLines: [
    'Перекрёстки Манхэттена не улица. Это коридор, который научился давить людей полосами.',
    'Откроем прорез — патруль пойдёт быстрее, но толпа услышит сапоги раньше сирены.',
    'Три трубы на распорки. Без железа проход станет горлом, а не маршрутом.',
    'Кольцо хочет тишины, рынок хочет процента. Я хочу проход, где можно стрелять в линию.',
    'Выбор простой: узкий порядок или широкая давка.',
  ],
  talkLinesPost: [
    'Распорки встали. Прорез на Перекрёстки будет шумным, зато не схлопнется сразу.',
    'Если увидишь мел на полу стрелкой наружу — это наш ход. Если стрелка мокрая, не иди.',
  ],
};

const MARINA: PlotNpcDef = {
  name: 'Марина Кольцевая',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.HOUSEWIFE,
  sprite: Occupation.HOUSEWIFE,
  hp: 85, maxHp: 85, money: 18, speed: 0.9,
  inventory: [{ defId: 'bread', count: 2 }, { defId: 'child_map', count: 1 }, { defId: 'water', count: 1 }],
  talkLines: [
    'Коммунальное кольцо держится не стенами, а людьми, которые помнят чужие двери.',
    'Отдадим проход Бориному патрулю — дети пойдут в обход через давку.',
    'Четыре буханки в цепочку соседей. Накормленные держат дверь дольше голодных.',
    'Рынок восемьдесят восемь купит любой маршрут, а потом продаст обратно твою фамилию.',
    'Кольцо медленнее, зато там спрашивают имя до выстрела.',
  ],
  talkLinesPost: [
    'Хлеб пошёл по цепочке. Коммунальное кольцо сегодня держит тихий обход.',
    'Карта у тебя не для красоты. На ней отмечены двери, где сначала стучат.',
  ],
};

const SONYA: PlotNpcDef = {
  name: 'Соня Восьмая',
  isFemale: true,
  faction: Faction.WILD,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 95, maxHp: 95, money: 88, speed: 1.15,
  inventory: [{ defId: 'caravan_route', count: 1 }, { defId: 'fake_pass', count: 1 }, { defId: 'cigs', count: 4 }],
  talkLines: [
    'Рынок восемьдесят восемь не просит открыть дорогу. Он спрашивает, сколько стоит молчать о ней.',
    'Двенадцать бюллетеней — и я проведу караван так, будто это просто очередь за крупой.',
    'Боря даст сапоги, Марина даст соседей. Я дам цену и выход без лишних свидетелей.',
    'Если бумага голосует правильно, дверь делает вид, что знала тебя с детства.',
    'На Перекрёстках стреляют, на Кольце помнят, на рынке считают. Выбирай, где тебе жить дальше.',
  ],
  talkLinesPost: [
    'Бюллетени ушли в счёт. Маршрут на восемьдесят восемь теперь знает твоё имя.',
    'Если рыночный курьер спросит пароль, скажи: "очередь короче, когда платят заранее".',
  ],
};

registerSideQuest('kv08_borya_prorez', BORYA, [{
  id: 'kv08_open_manhattan_crossroads',
  giverNpcId: 'kv08_borya_prorez',
  type: QuestType.FETCH,
  desc: 'Исход: открыть шумный прорез к Манхэттенским перекрёсткам. Боря Прорез просит три трубы на распорки.',
  targetItem: 'pipe', targetCount: 3,
  rewardItem: 'elevator_access_order', rewardCount: 1,
  extraRewards: [{ defId: 'ammo_9mm', count: 10 }, { defId: 'lift_scheme', count: 1 }],
  relationDelta: 12, xpReward: 60, moneyReward: 45,
}]);

registerSideQuest('kv08_marina_ring', MARINA, [{
  id: 'kv08_hold_communal_ring',
  giverNpcId: 'kv08_marina_ring',
  type: QuestType.FETCH,
  desc: 'Исход: удержать тихую цепочку к Коммунальному кольцу. Марина Кольцевая просит четыре буханки для соседей у дверей.',
  targetItem: 'bread', targetCount: 4,
  rewardItem: 'child_map', rewardCount: 1,
  extraRewards: [{ defId: 'door_kit', count: 1 }, { defId: 'filtered_water', count: 2 }],
  relationDelta: 16, xpReward: 55, moneyReward: 20,
}]);

registerSideQuest('kv08_sonya_88', SONYA, [{
  id: 'kv08_sell_market_88_lane',
  giverNpcId: 'kv08_sonya_88',
  type: QuestType.FETCH,
  desc: 'Исход: продать обход рынку 88. Соня Восьмая просит двенадцать бюллетеней для караванной очереди.',
  targetItem: 'ballot', targetCount: 12,
  rewardItem: 'caravan_route', rewardCount: 1,
  extraRewards: [{ defId: 'fake_pass', count: 1 }, { defId: 'cigs', count: 3 }],
  relationDelta: 8, xpReward: 60, moneyReward: 88,
}]);

function nextContainerId(world: World): number {
  let id = 1;
  for (const c of world.containers) if (c.id >= id) id = c.id + 1;
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

function addRouteContainer(
  world: World,
  poi: SocialPoiRoom,
  dx: number,
  dy: number,
  name: string,
  kind: ContainerKind,
  inventory: Item[],
  opts: { ownerId?: number; ownerName?: string; faction?: Faction; access: WorldContainer['access']; tags: string[] },
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
    access: opts.access,
    discovered: true,
    tags: ['kv08_route_assembly', ...opts.tags],
  });
}

function setRouteWall(world: World, x: number, y: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
  world.cells[ci] = Cell.WALL;
  world.wallTex[ci] = Tex.METAL;
  world.roomMap[ci] = -1;
}

export function generateKv08RouteAssembly(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number }, spawnX: number, spawnY: number,
): number {
  const poi = createSocialPoiRoom(world, nextRoomId, spawnX, spawnY, 'Маршрутный сход Три Двери', RoomType.COMMON, 21, 11, Tex.PANEL, Tex.F_LINO, 115, 320, 2.3);
  if (!poi) return nextRoomId;

  const railY = poi.y + 5;
  const gaps = [poi.x + 4, poi.x + 10, poi.x + 16];
  for (let dx = 2; dx < poi.w - 2; dx++) {
    const x = poi.x + dx;
    if (gaps.some(g => Math.abs(g - x) <= 1)) continue;
    setRouteWall(world, x, railY);
  }

  for (const x of gaps) {
    setFeatureIfFloor(world, x, railY - 1, Feature.TABLE);
    setFeatureIfFloor(world, x, railY + 1, Feature.CHAIR);
  }
  setFeatureIfFloor(world, poi.x + 1, poi.y + 1, Feature.LAMP);
  setFeatureIfFloor(world, poi.x + 3, poi.y + 2, Feature.DESK);
  setFeatureIfFloor(world, poi.x + 10, poi.y + 2, Feature.SHELF);
  setFeatureIfFloor(world, poi.x + 17, poi.y + 2, Feature.DESK);
  setFeatureIfFloor(world, poi.x + 6, poi.y + 8, Feature.SHELF);
  setFeatureIfFloor(world, poi.x + 14, poi.y + 8, Feature.CANDLE);

  const boryaId = nextId.v;
  spawnSocialNpc(entities, nextId, BORYA, 'kv08_borya_prorez', poi.x + 3, poi.y + 3, { weapon: 'makarov' });
  const marinaId = nextId.v;
  spawnSocialNpc(entities, nextId, MARINA, 'kv08_marina_ring', poi.x + 10, poi.y + 3);
  const sonyaId = nextId.v;
  spawnSocialNpc(entities, nextId, SONYA, 'kv08_sonya_88', poi.x + 17, poi.y + 3, { weapon: 'knife' });
  spawnAmbientNpc(entities, nextId, 'Ликвидатор с мелом', Faction.LIQUIDATOR, Occupation.HUNTER, poi.x + 5, poi.y + 8, [{ defId: 'ammo_9mm', count: 5 }], 'makarov');
  spawnAmbientNpc(entities, nextId, 'Соседка у цепочки', Faction.CITIZEN, Occupation.HOUSEWIFE, poi.x + 10, poi.y + 8, [{ defId: 'bread', count: 1 }]);
  spawnAmbientNpc(entities, nextId, 'Бегунок восемьдесят восемь', Faction.WILD, Occupation.TRAVELER, poi.x + 15, poi.y + 8, [{ defId: 'cigs', count: 2 }], 'pipe');

  addRouteContainer(world, poi, 3, 2, 'Папка прореза к Перекрёсткам', ContainerKind.FILING_CABINET, [
    { defId: 'elevator_access_order', count: 1 },
    { defId: 'lift_scheme', count: 1 },
    { defId: 'ammo_9mm', count: 8 },
  ], { ownerId: boryaId, ownerName: BORYA.name, faction: Faction.LIQUIDATOR, access: 'owner', tags: ['route_manhattan_crossroads', 'liquidator', 'documents', 'theft'] });
  addRouteContainer(world, poi, 10, 2, 'Общая сумка Коммунального кольца', ContainerKind.EMERGENCY_BOX, [
    { defId: 'child_map', count: 1 },
    { defId: 'bread', count: 2 },
    { defId: 'water', count: 2 },
  ], { ownerId: marinaId, ownerName: MARINA.name, faction: Faction.CITIZEN, access: 'owner', tags: ['route_communal_ring', 'citizen', 'food', 'theft'] });
  addRouteContainer(world, poi, 17, 2, 'Курьерский сейф рынка 88', ContainerKind.SAFE, [
    { defId: 'caravan_route', count: 1 },
    { defId: 'fake_pass', count: 1 },
    { defId: 'cigs', count: 6 },
  ], { ownerId: sonyaId, ownerName: SONYA.name, faction: Faction.WILD, access: 'owner', tags: ['route_market_88', 'black_market', 'documents', 'theft'] });

  for (const defId of ['pipe', 'pipe', 'bread', 'bread', 'ballot', 'ballot', 'ballot', 'cigs', 'note']) {
    placeDropNear(world, entities, nextId, poi, defId, 1);
  }

  return poi.room.id + 1;
}
