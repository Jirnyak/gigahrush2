/* -- AG102 Zhelemish cellar: harvest / steal / burn ethics loop -- */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  Cell, ContainerKind, Faction, Feature, FloorLevel,
  Occupation, QuestType, RoomType, Tex,
  type Entity, type Room, type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { connectProtectedRoom, protectRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

const CONTENT_TAG = 'ag102_zhelemish_cellar';
const ZHELEMISH_ZONE = 33;
const CELLAR_W = 15;
const CELLAR_H = 11;

const OWNER_ID = 'ag102_baba_mavra_zhelemish';
const WITNESS_ID = 'ag102_nikita_san_witness';

const OWNER_DEF: PlotNpcDef = {
  name: 'Баба Мавра Желемышная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 95,
  maxHp: 95,
  money: 54,
  speed: 0.72,
  inventory: [
    { defId: 'zhelemish_dried', count: 2 },
    { defId: 'zhelemish_boiled', count: 1 },
    { defId: 'bread', count: 1 },
  ],
  talkLines: [
    'Тише, милый. Желемыш еда, лекарство и плохая фамилия дома. Все три по чуть-чуть.',
    'Погреб пахнет обедом, мокрым бетоном и лекарством, которое не прошло комиссию.',
    'Срезать можно с общего поддона. В мой ящик лезут только те, кто любит свидетелей.',
    'Хочешь честно - плати долю очереди. Хочешь быстро - Никита уже рядом нюхает.',
  ],
  talkLinesPost: [
    'Разделили по-человечески - значит, погреб сегодня не стал судом.',
    'Не ешь сырой комок первым делом. Сырой лучше сдать, сварить или сжечь.',
  ],
  talkQuestResponse: 'Скажи Никите: общий поддон я отдаю, запертый ящик не трогать. Пусть записывает это сухими словами.',
};

const WITNESS_DEF: PlotNpcDef = {
  name: 'Никита Саннадзор',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.DOCTOR,
  sprite: Occupation.DOCTOR,
  hp: 140,
  maxHp: 140,
  money: 38,
  speed: 0.88,
  inventory: [
    { defId: 'clean_health_cert', count: 1 },
    { defId: 'antifungal_ointment', count: 1 },
    { defId: 'ammo_fuel', count: 1 },
  ],
  talkLines: [
    'Я не против еды. Я против еды, которая прячется в чужом шкафу и растит слухи.',
    'Сырой образец в санитарный ящик. Бензин в жаровню. Герметик к двери. Выбирай, пока запах не выбрал тебя.',
    'Мавра владелица, но стены тут общие. Кража из ее ящика станет разговором быстрее, чем ужином.',
    'Ольга из грибной прачечной ищет коричневый соскоб с живой петли. Здесь берут долю, в сыром погребе - пробу, у костяной сушилки - соль и огонь.',
  ],
  talkLinesPost: [
    'Если погреб закрыт по акту, это не победа. Это пауза для легких.',
    'Партия локальная. По коридору желемыш не ходит, если люди не носят его в карманах.',
  ],
  talkQuestResponse: 'Записал: общий поддон под очередь, запертый ящик под свидетеля. Теперь кража будет не голодом, а выбором.',
};

registerSideQuest(OWNER_ID, OWNER_DEF, [
  {
    id: 'ag102_buy_share_zhelemish',
    giverNpcId: OWNER_ID,
    type: QuestType.FETCH,
    desc: 'Баба Мавра: «Дай двадцать пять рублей в очередь, и я отдам варёный желемыш без воровского запаха.»',
    targetItem: 'money',
    targetCount: 25,
    rewardItem: 'zhelemish_boiled',
    rewardCount: 1,
    extraRewards: [{ defId: 'zhelemish_dried', count: 1 }],
    relationDelta: 8,
    xpReward: 24,
    eventTags: ['zhelemish', 'buy', 'share', 'owner_ok'],
  },
  {
    id: 'ag102_owner_resolution',
    giverNpcId: OWNER_ID,
    type: QuestType.TALK,
    desc: 'Баба Мавра: «Скажи Никите {dir}, что общий поддон я делю, а запертый ящик он сторожит свидетелями.»',
    targetNpcId: WITNESS_ID,
    rewardItem: 'zhelemish_dried',
    rewardCount: 1,
    extraRewards: [{ defId: 'bread', count: 1 }],
    relationDelta: 10,
    xpReward: 30,
    eventTags: ['zhelemish', 'owner_resolution', 'witness', 'share'],
  },
]);

registerSideQuest(WITNESS_ID, WITNESS_DEF, [
  {
    id: 'ag102_report_zhelemish_sample',
    giverNpcId: WITNESS_ID,
    type: QuestType.FETCH,
    desc: 'Никита Саннадзор: «Сдай сырой желемыш как образец. Не съесть, не продать - сдать, пока он свежий и без чужих рук.»',
    targetItem: 'zhelemish_raw',
    targetCount: 1,
    rewardItem: 'clean_health_cert',
    rewardCount: 1,
    extraRewards: [{ defId: 'antifungal_ointment', count: 1 }],
    relationDelta: 9,
    xpReward: 35,
    moneyReward: 18,
    eventTags: ['zhelemish', 'report', 'surrender', 'sample', 'liquidator'],
  },
  {
    id: 'ag102_burn_zhelemish_growth',
    giverNpcId: WITNESS_ID,
    type: QuestType.FETCH,
    desc: 'Никита Саннадзор: «Принеси канистру бензина. Сожжём мокрый угол, оставим еду без плесневой корки.»',
    targetItem: 'ammo_fuel',
    targetCount: 1,
    rewardItem: 'clean_health_cert',
    rewardCount: 1,
    extraRewards: [{ defId: 'filtered_water', count: 1 }],
    relationDelta: 7,
    xpReward: 38,
    eventTags: ['zhelemish', 'burn', 'fire', 'local_contamination'],
  },
  {
    id: 'ag102_seal_zhelemish_cellar',
    giverNpcId: WITNESS_ID,
    type: QuestType.FETCH,
    desc: 'Никита Саннадзор: «Герметик к нижней щели. Не лечит погреб, зато не даёт ему стать коридором.»',
    targetItem: 'sealant_tube',
    targetCount: 1,
    rewardItem: 'gasmask_filter',
    rewardCount: 1,
    relationDelta: 8,
    xpReward: 32,
    moneyReward: 12,
    eventTags: ['zhelemish', 'seal_off', 'quarantine', 'local_contamination'],
  },
]);

function areaClear(world: World, rx: number, ry: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) return false;
    }
  }
  return true;
}

function findOrigin(world: World, zcx: number, zcy: number): { x: number; y: number } {
  const baseX = zcx - Math.floor(CELLAR_W / 2);
  const baseY = zcy - Math.floor(CELLAR_H / 2);
  for (let r = 0; r <= 76; r += 4) {
    for (let k = 0; k < 24; k++) {
      const a = ((k + 5) / 24) * Math.PI * 2;
      const x = world.wrap(baseX + Math.round(Math.cos(a) * r));
      const y = world.wrap(baseY + Math.round(Math.sin(a) * r));
      if (areaClear(world, x, y, CELLAR_W, CELLAR_H)) return { x, y };
    }
  }
  return { x: world.wrap(baseX), y: world.wrap(baseY) };
}

function carveCellar(world: World, roomId: number, rx: number, ry: number): Room {
  for (let dy = -1; dy <= CELLAR_H; dy++) {
    for (let dx = -1; dx <= CELLAR_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.ROTTEN;
      world.floorTex[ci] = Tex.F_TILE;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
  }

  const room: Room = {
    id: roomId,
    type: RoomType.STORAGE,
    x: rx,
    y: ry,
    w: CELLAR_W,
    h: CELLAR_H,
    doors: [],
    sealed: false,
    name: 'Желемышный погреб Мавры',
    apartmentId: -1,
    wallTex: Tex.ROTTEN,
    floorTex: Tex.F_TILE,
  };
  world.rooms[roomId] = room;

  for (let dy = 0; dy < CELLAR_H; dy++) {
    for (let dx = 0; dx < CELLAR_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_TILE;
      world.roomMap[ci] = roomId;
    }
  }

  protectRoom(world, rx, ry, CELLAR_W, CELLAR_H, Tex.ROTTEN, Tex.F_TILE);
  connectProtectedRoom(world, rx, ry, CELLAR_W, CELLAR_H);
  return room;
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER) world.features[ci] = feature;
}

function setWater(world: World, room: Room, dx: number, dy: number): void {
  const ci = world.idx(room.x + dx, room.y + dy);
  world.cells[ci] = Cell.WATER;
  world.floorTex[ci] = Tex.F_WATER;
  world.roomMap[ci] = room.id;
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addCellarContainer(
  world: World,
  room: Room,
  dx: number,
  dy: number,
  kind: ContainerKind,
  name: string,
  access: WorldContainer['access'],
  inventory: WorldContainer['inventory'],
  tags: string[],
  faction?: Faction,
  ownerNpcId?: number,
  ownerName?: string,
): void {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const ci = world.idx(x, y);
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
    capacitySlots: Math.max(6, inventory.length + 3),
    ownerNpcId,
    ownerName,
    faction,
    access,
    lockDifficulty: access === 'locked' ? 3 : undefined,
    discovered: true,
    tags: [CONTENT_TAG, 'living_fungal_loop', 'zhelemish', 'local_contamination', ...tags],
  });
}

function spawnNpc(
  entities: Entity[],
  nextId: { v: number },
  plotNpcId: string,
  x: number,
  y: number,
  angle: number,
  weapon?: string,
): number {
  const existing = entities.find(e => e.alive && e.plotNpcId === plotNpcId);
  if (existing) return existing.id;
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle,
    weapon,
    canGiveQuest: true,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
  });
  return npc.id;
}

function decorateCellar(world: World, room: Room): void {
  const rx = room.x;
  const ry = room.y;
  for (const [dx, dy, feature] of [
    [1, 1, Feature.LAMP],
    [3, 2, Feature.SHELF],
    [5, 2, Feature.SHELF],
    [7, 2, Feature.SHELF],
    [10, 2, Feature.SHELF],
    [12, 2, Feature.LAMP],
    [2, 5, Feature.SINK],
    [4, 5, Feature.APPARATUS],
    [7, 5, Feature.TABLE],
    [8, 5, Feature.CHAIR],
    [11, 5, Feature.MACHINE],
    [12, 8, Feature.CANDLE],
  ] as const) {
    setFeature(world, rx + dx, ry + dy, feature);
  }

  for (const [dx, dy] of [[3, 8], [4, 8], [5, 8], [9, 8], [10, 8], [11, 8]] as const) {
    setWater(world, room, dx, dy);
  }

  world.wallTex[world.idx(rx + Math.floor(CELLAR_W / 2), ry - 1)] = Tex.POSTER_BASE + 44;
  stampSurfaceSplat(world, rx + 4, ry + 7, 0.5, 0.5, 5, 0.58, 10231, 50, 96, 50, false);
  stampSurfaceSplat(world, rx + 10, ry + 4, 0.5, 0.5, 4, 0.5, 10232, 118, 76, 44, false);
  stampSurfaceSplat(world, rx + 12, ry + 8, 0.5, 0.5, 3, 0.42, 10233, 22, 18, 12, false);
}

function seedContainers(world: World, room: Room, ownerId: number, witnessId: number): void {
  addCellarContainer(
    world,
    room,
    4,
    7,
    ContainerKind.WOODEN_CHEST,
    'Общий поддон желемыша',
    'public',
    [
      { defId: 'zhelemish_raw', count: 2 },
      { defId: 'zhelemish_dried', count: 1 },
    ],
    ['harvest', 'food', 'resource'],
  );
  addCellarContainer(
    world,
    room,
    10,
    2,
    ContainerKind.METAL_CABINET,
    'Запертый запас Мавры',
    'owner',
    [
      { defId: 'zhelemish_raw', count: 1 },
      { defId: 'zhelemish_dried', count: 2 },
      { defId: 'zhelemish_boiled', count: 1 },
      { defId: 'antifungal_ointment', count: 1 },
    ],
    ['owner_stock', 'theft', 'witnessed'],
    Faction.CITIZEN,
    ownerId,
    OWNER_DEF.name,
  );
  addCellarContainer(
    world,
    room,
    2,
    8,
    ContainerKind.TRASH_BIN,
    'Общая миска для доли',
    'public',
    [],
    ['share', 'resident_relief'],
  );
  addCellarContainer(
    world,
    room,
    12,
    2,
    ContainerKind.MEDICAL_CABINET,
    'Санитарный ящик сдачи',
    'faction',
    [
      { defId: 'cleaning_kit', count: 1 },
      { defId: 'rock_salt', count: 1 },
      { defId: 'antifungal_ointment', count: 1 },
    ],
    ['report', 'surrender', 'evidence_drop', 'quarantine'],
    Faction.LIQUIDATOR,
    witnessId,
    WITNESS_DEF.name,
  );
  addCellarContainer(
    world,
    room,
    12,
    8,
    ContainerKind.TRASH_BIN,
    'Жаровня мокрой партии',
    'public',
    [{ defId: 'ammo_fuel', count: 1 }],
    ['burn', 'fire', 'sabotage_drop'],
  );
}

function generateZhelemishCellar(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zcx: number,
  zcy: number,
): { nextRoomId: number } {
  const pos = findOrigin(world, zcx, zcy);
  const room = carveCellar(world, nextRoomId++, pos.x, pos.y);
  decorateCellar(world, room);
  const ownerId = spawnNpc(entities, nextId, OWNER_ID, room.x + 7, room.y + 5, Math.PI);
  const witnessId = spawnNpc(entities, nextId, WITNESS_ID, room.x + 11, room.y + 6, -Math.PI / 2, 'makarov');
  seedContainers(world, room, ownerId, witnessId);
  world.bakeLights();
  genLog(`[AG102] Желемышный погреб at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId };
}

registerZoneContent(ZHELEMISH_ZONE, 'Желемышный погреб Мавры', generateZhelemishCellar);
