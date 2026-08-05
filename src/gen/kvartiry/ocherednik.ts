/* ── Очередник: мутировавшая очередь как социальный монстр ───── */

import {
  AIGoal, Cell, ContainerKind, EntityType, Faction, Feature, FloorLevel,
  MonsterKind, Occupation, QuestType, RoomType, Tex,
  type Entity, type Item, type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  createSocialPoiRoom,
  roomCell,
  setFeatureIfFloor,
  spawnAmbientNpc,
  spawnSocialNpc,
  type SocialPoiRoom,
} from './social_helpers';

const ROOM_NAME = 'Коридор неподвижной очереди';

const LYUBA: PlotNpcDef = {
  name: 'Люба Номерная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 80, maxHp: 80, money: 11, speed: 0.9,
  inventory: [{ defId: 'water_coupon', count: 1 }, { defId: 'note', count: 1 }],
  talkLines: [
    'Номера шепчут по кругу. Первый не первый, он просто стоит ближе всех к чужому хлебу.',
    'Покажешь талон на воду - я проведу тебя боком, без локтей и выстрелов.',
    'Не спорь с очередью громко. Здесь даже свидетели стоят по списку.',
  ],
  talkLinesPost: [
    'Талон сработал. Очередь пропустила тебя как ошибку в ведомости.',
    'Теперь уходи боковым проходом. Если первый номер посмотрит вслед, не отвечай.',
  ],
};

const EFIM: PlotNpcDef = {
  name: 'Ефим Сверщик',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.LOCKSMITH,
  sprite: Occupation.LOCKSMITH,
  hp: 90, maxHp: 90, money: 16, speed: 0.95,
  inventory: [{ defId: 'wrench', count: 1 }, { defId: 'ration_registry_extract', count: 1 }],
  talkLines: [
    'Я считал хвост: в очереди на одного больше, чем людей в коридоре.',
    'У первого номера карточка слишком ровная. Достанешь подделку - толпа сама отодвинется.',
    'Не бей его при детях. Бумага режет тише, а помнят её дольше.',
  ],
  talkLinesPost: [
    'Подделку увидели все. Очередь стала короче не на труп, а на ложь.',
    'Пока они пересчитывают фамилии, проход свободен.',
  ],
};

const YASHA: PlotNpcDef = {
  name: 'Яша Пролом',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.TRAVELER,
  sprite: Occupation.TRAVELER,
  hp: 95, maxHp: 95, money: 6, speed: 1.1,
  inventory: [{ defId: 'pipe', count: 1 }, { defId: 'cigs', count: 1 }],
  talkLines: [
    'Можно стоять. Можно обойти. Можно прорубить. Только потом не говори, что никто не видел.',
    'Первый номер не человек. Но очередь вокруг него - люди.',
    'Ударишь по нему здесь, свидетели запомнят не тварь, а твою руку.',
  ],
  talkLinesPost: [
    'Проход есть. И слух теперь тоже есть.',
    'Деньги держи. Не благодарность - сдача за испорченную тишину.',
  ],
};

registerSideQuest('kv_ocherednik_lyuba', LYUBA, [{
  id: 'kv_ocherednik_show_coupon',
  giverNpcId: 'kv_ocherednik_lyuba',
  type: QuestType.FETCH,
  desc: 'Люба Номерная: «Покажите талон на воду, и я проведу вас через боковой проход без драки.»',
  targetItem: 'water_coupon', targetCount: 1,
  rewardItem: 'bread', rewardCount: 1,
  extraRewards: [{ defId: 'ration_registry_extract', count: 1 }],
  relationDelta: 12, xpReward: 40, moneyReward: 5,
  eventPrivacy: 'witnessed',
  eventTags: ['ocherednik', 'monster', 'queue', 'ration', 'witness', 'coupon'],
  eventTargetName: 'Очередник пропустил по талону без драки',
  eventData: { monsterId: 'ocherednik', route: 'coupon', rumorIds: ['kvartiry_queue_unrest'] },
}]);

registerSideQuest('kv_ocherednik_efim', EFIM, [{
  id: 'kv_ocherednik_expose_leader',
  giverNpcId: 'kv_ocherednik_efim',
  type: QuestType.FETCH,
  desc: 'Ефим Сверщик: «Найдите поддельную пайковую карточку первого номера. Бумагой его из очереди вынесет сама толпа.»',
  targetItem: 'forged_ration_card', targetCount: 1,
  rewardItem: 'water_coupon', rewardCount: 2,
  extraRewards: [{ defId: 'concentrate_coupon', count: 1 }],
  relationDelta: 14, xpReward: 55, moneyReward: 12,
  eventPrivacy: 'witnessed',
  eventTags: ['ocherednik', 'monster', 'queue', 'ration', 'witness', 'expose'],
  eventTargetName: 'Очередник разобран через поддельную карточку',
  eventData: { monsterId: 'ocherednik', route: 'expose', rumorIds: ['ration_coupon_forgery_risk'] },
}]);

registerSideQuest('kv_ocherednik_yasha', YASHA, [{
  id: 'kv_ocherednik_fight_through',
  giverNpcId: 'kv_ocherednik_yasha',
  type: QuestType.KILL,
  desc: 'Яша Пролом: «Сбейте первого номера и проход откроется. Только очередь увидит, как именно.»',
  targetMonsterKind: MonsterKind.NELYUD,
  killNeeded: 1,
  rewardItem: 'pipe', rewardCount: 1,
  extraRewards: [{ defId: 'cigs', count: 2 }],
  relationDelta: -10, xpReward: 55, moneyReward: 12,
  eventPrivacy: 'witnessed',
  eventTags: ['ocherednik', 'monster', 'queue', 'ration', 'witness', 'violence'],
  eventTargetName: 'Очередник прорван силой: свидетели запомнили стрелка',
  eventData: { monsterId: 'ocherednik', route: 'violence', rumorIds: ['player_hurt_remembered'] },
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

function addQueueContainer(
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
    capacitySlots: opts.capacitySlots ?? Math.max(8, inventory.length + 2),
    ownerNpcId: opts.ownerId,
    ownerName: opts.ownerName,
    faction: opts.faction,
    access,
    discovered: true,
    tags: ['ocherednik', 'queue', 'ration', 'witness', ...opts.tags],
  });
}

function setQueueWall(world: World, x: number, y: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
  world.cells[ci] = Cell.WALL;
  world.wallTex[ci] = Tex.CONCRETE;
  world.roomMap[ci] = -1;
  world.features[ci] = Feature.NONE;
}

function buildQueueChoke(world: World, poi: SocialPoiRoom): void {
  const midY = poi.y + Math.floor(poi.h / 2);
  for (let dx = 3; dx < poi.w - 4; dx++) {
    if (dx === poi.w - 7) continue;
    setQueueWall(world, poi.x + dx, midY);
  }
  for (let dx = 3; dx < poi.w - 3; dx += 3) {
    setFeatureIfFloor(world, poi.x + dx, midY - 1, Feature.CHAIR);
    setFeatureIfFloor(world, poi.x + dx + 1, midY + 1, Feature.TABLE);
  }
  for (let dx = 2; dx < poi.w - 2; dx += 5) setFeatureIfFloor(world, poi.x + dx, poi.y + poi.h - 2, Feature.LAMP);
  setFeatureIfFloor(world, poi.x + 1, poi.y + 1, Feature.LAMP);
  setFeatureIfFloor(world, poi.x + poi.w - 2, poi.y + 1, Feature.DESK);
  setFeatureIfFloor(world, poi.x + poi.w - 3, poi.y + 1, Feature.SHELF);
}

function dropItem(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  x: number,
  y: number,
  defId: string,
  count = 1,
  data?: unknown,
): void {
  const wx = world.wrap(x);
  const wy = world.wrap(y);
  if (world.cells[world.idx(wx, wy)] !== Cell.FLOOR) return;
  const item: Item = { defId, count };
  if (data !== undefined) item.data = data;
  entities.push({
    id: nextId.v++,
    type: EntityType.ITEM_DROP,
    x: wx + 0.5,
    y: wy + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [item],
  });
}

function seedRationTrail(world: World, poi: SocialPoiRoom, entities: Entity[], nextId: { v: number }): void {
  const y = poi.y + poi.h - 2;
  dropItem(world, entities, nextId, poi.x + 2, y, 'note', 1, 'Номер 38 зачёркнут. Номер 38 стоит снова. Не спорить вслух.');
  dropItem(world, entities, nextId, poi.x + 5, y, 'water_coupon');
  dropItem(world, entities, nextId, poi.x + 8, y, 'note', 1, 'Боковой проход считается очередью, если идти молча и с талоном.');
  dropItem(world, entities, nextId, poi.x + 12, y, 'concentrate_coupon');
  dropItem(world, entities, nextId, poi.x + poi.w - 6, poi.y + 2, 'bread');
}

function spawnQueueLeader(world: World, entities: Entity[], nextId: { v: number }, x: number, y: number): number {
  const def = MONSTERS[MonsterKind.NELYUD];
  const ci = world.idx(x, y);
  const zid = world.zoneMap[ci];
  const zoneLevel = (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 3) : 3;
  const hp = scaleMonsterHp(def.hp, zoneLevel);
  const leader: Entity = {
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.PI,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: monsterSpr(MonsterKind.NELYUD),
    name: 'Первый номер',
    hp,
    maxHp: hp,
    monsterKind: MonsterKind.NELYUD,
    attackCd: def.attackRate,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
  };
  entities.push(leader);
  return leader.id;
}

function seedQueueContainers(world: World, poi: SocialPoiRoom, lyubaId: number, leaderId: number): void {
  addQueueContainer(
    world, poi, 2, 2, 'Связка пайковых корешков',
    ContainerKind.FILING_CABINET, 'owner',
    [
      { defId: 'water_coupon', count: 2 },
      { defId: 'concentrate_coupon', count: 1 },
      { defId: 'ration_registry_extract', count: 1 },
      { defId: 'note', count: 1, data: 'Свидетельская ведомость: кто стрелял в очереди, того пишут без номера.' },
    ],
    {
      ownerId: lyubaId,
      ownerName: LYUBA.name,
      faction: Faction.CITIZEN,
      tags: ['theft', 'paper', 'ration_coupon_audit'],
      capacitySlots: 8,
    },
  );
  addQueueContainer(
    world, poi, poi.w - 3, 2, 'Портфель первого номера',
    ContainerKind.CASHBOX, 'owner',
    [
      { defId: 'forged_ration_card', count: 1 },
      { defId: 'bread', count: 2 },
      { defId: 'water_coupon', count: 1 },
      { defId: 'cigs', count: 1 },
    ],
    {
      ownerId: leaderId,
      ownerName: 'Первый номер',
      faction: Faction.CITIZEN,
      tags: ['theft', 'forgery', 'paper', 'ration_coupon_audit'],
      capacitySlots: 8,
    },
  );
  addQueueContainer(
    world, poi, 8, poi.h - 2, 'Обходная табуретка',
    ContainerKind.TRASH_BIN, 'public',
    [{ defId: 'note', count: 1, data: 'Обход: вдоль ламп, не через плечи. Талон держать видимым.' }],
    { faction: Faction.CITIZEN, tags: ['public', 'side_route'], capacitySlots: 4 },
  );
}

export function generateOcherednik(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number }, spawnX: number, spawnY: number,
): number {
  const poi = createSocialPoiRoom(
    world, nextRoomId, spawnX, spawnY,
    ROOM_NAME,
    RoomType.CORRIDOR,
    27, 9,
    Tex.PANEL, Tex.F_LINO,
    110, 300,
    2.5,
  );
  if (!poi) return nextRoomId;

  buildQueueChoke(world, poi);

  const leaderId = spawnQueueLeader(world, entities, nextId, poi.x + poi.w - 4, poi.y + 2);

  const lyubaId = nextId.v;
  spawnSocialNpc(entities, nextId, LYUBA, 'kv_ocherednik_lyuba', poi.x + 3, poi.y + 2);
  spawnSocialNpc(entities, nextId, EFIM, 'kv_ocherednik_efim', poi.x + 6, poi.y + 2, { weapon: 'wrench' });
  spawnSocialNpc(entities, nextId, YASHA, 'kv_ocherednik_yasha', poi.x + 4, poi.y + poi.h - 3, { weapon: 'pipe' });

  spawnAmbientNpc(entities, nextId, 'Номер сорок первый', Faction.CITIZEN, Occupation.HOUSEWIFE, poi.x + 8, poi.y + 2, [{ defId: 'bread', count: 1 }]);
  spawnAmbientNpc(entities, nextId, 'Мальчик с пустым бидоном', Faction.CITIZEN, Occupation.CHILD, poi.x + 10, poi.y + 2, [{ defId: 'water_coupon', count: 1 }]);
  spawnAmbientNpc(entities, nextId, 'Свидетель в ватнике', Faction.CITIZEN, Occupation.LOCKSMITH, poi.x + 12, poi.y + 2, [{ defId: 'neighbor_complaint', count: 1 }]);
  spawnAmbientNpc(entities, nextId, 'Ликвидатор у стены', Faction.LIQUIDATOR, Occupation.HUNTER, poi.x + 5, poi.y + poi.h - 3, [{ defId: 'ammo_9mm', count: 6 }], 'makarov');
  spawnAmbientNpc(entities, nextId, 'Бабка без талона', Faction.CITIZEN, Occupation.HOUSEWIFE, poi.x + 11, poi.y + poi.h - 3, [{ defId: 'tea', count: 1 }]);

  seedQueueContainers(world, poi, lyubaId, leaderId);
  seedRationTrail(world, poi, entities, nextId);

  return poi.room.id + 1;
}
