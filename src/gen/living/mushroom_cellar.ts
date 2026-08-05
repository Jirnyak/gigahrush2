/* -- AG12 Mushroom Shift: first playable cellar slice ----------- */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  Cell, EntityType, Faction, Feature, FloorLevel, Occupation, QuestType, RoomType, Tex,
  type Entity, type Room,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { Spr } from '../../render/sprite_index';
import { connectProtectedRoom, protectRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

const CELLAR_W = 13;
const CELLAR_H = 9;

const NPC_DEFS: Record<string, PlotNpcDef> = {
  ag12_egor_plesen: {
    name: 'Егор Плесень',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.STOREKEEPER,
    sprite: Occupation.STOREKEEPER,
    hp: 90, maxHp: 90, money: 48, speed: 0.8,
    inventory: [
      { defId: 'spore_print', count: 2 },
      { defId: 'substrate_sack', count: 2 },
      { defId: 'mushroom_mass', count: 2 },
    ],
    talkLines: [
      'Тише у стеллажей. Гриб любит, когда его считают пищей, а не санитарной проблемой.',
      'Это прачечная первой смены. Белье ушло, сырость осталась работать.',
      'Споровый отпечаток, мешок субстрата, вода. Больше биологии нам не по пайку.',
      'Вентиляция хрипит. Если ее не заклеить, мокрый самосбор сделает урожай чужим.',
      'Валера прячет мешки под сушилкой. Скажи ему вслух, что очередь знает.',
    ],
    talkLinesPost: [
      'Стеллажи держатся. Сегодня из еды не смотрят глаза.',
      'Бери грибную массу, если голод прижал. Зараженное не ешь без причины.',
    ],
    talkQuestResponse: 'Валера услышал? Хорошо. Когда хозяин краснеет при людях, из тайника иногда выпадает паек.',
  },

  ag12_olga_sanpropusk: {
    name: 'Ольга Санпропуск',
    isFemale: true,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.DOCTOR,
    sprite: Occupation.DOCTOR,
    hp: 130, maxHp: 130, money: 62, speed: 0.9,
    inventory: [
      { defId: 'cleaning_kit', count: 1 },
      { defId: 'antifungal_ointment', count: 2 },
      { defId: 'clean_health_cert', count: 1 },
    ],
    talkLines: [
      'Я не закрываю грибницу. Я закрываю людей, которые делают вид, что плесень не еда.',
      'Чистящий комплект сюда. Без него чистый паек и зараженный выглядят одинаково.',
      'Если партия пошла мясным запахом, это не деликатес. Это протокол.',
      'Егор кормит блок, Валера кормит тайник. Разница санитарная.',
    ],
    talkLinesPost: [
      'После обработки можно выдавать пайки. Не все. Но уже не стыдно.',
      'Мокрый налет держится в этой комнате. По коридору он не ходит без ног.',
    ],
  },

  ag12_valera_meshkov: {
    name: 'Валера Мешков',
    isFemale: false,
    faction: Faction.WILD,
    occupation: Occupation.MECHANIC,
    sprite: Occupation.MECHANIC,
    hp: 105, maxHp: 105, money: 18, speed: 1.0,
    inventory: [
      { defId: 'substrate_sack', count: 4 },
      { defId: 'infected_mushroom', count: 3 },
      { defId: 'knife', count: 1 },
    ],
    talkLines: [
      'Мешки мои. Я их первый испугался.',
      'Зараженный гриб тоже еда, если достаточно темно и некому жаловаться.',
      'Очередь хочет чистое? Очередь пусть сначала принесет сухой воздух.',
      'Не кричи мое имя у стеллажей. Гриб запоминает должников.',
    ],
    talkLinesPost: [
      'Ладно, видел я очередь. Один мешок Егору, один себе. Так честнее, чем вчера.',
      'Если кто спросит, зараженное я держал для культистов. Они не брезгуют.',
    ],
  },
};

registerSideQuest('ag12_egor_plesen', NPC_DEFS.ag12_egor_plesen, [
  {
    id: 'ag12_repair_wet_vent',
    giverNpcId: 'ag12_egor_plesen',
    type: QuestType.FETCH,
    desc: 'Егор Плесень: «Принеси две изоленты. Заклеим мокрый вентиль, пока гриб не решил стать самосбором.»',
    targetItem: 'duct_tape', targetCount: 2,
    rewardItem: 'substrate_sack', rewardCount: 1,
    extraRewards: [{ defId: 'mushroom_mass', count: 2 }],
    relationDelta: 14, xpReward: 40, moneyReward: 20,
  },
  {
    id: 'ag12_expose_hoarder',
    giverNpcId: 'ag12_egor_plesen',
    type: QuestType.TALK,
    desc: 'Егор Плесень: «Скажи Валере Мешкову, что я знаю про мешки под сушилкой. Пусть выбирает: очередь или позор.»',
    targetNpcId: 'ag12_valera_meshkov',
    rewardItem: 'spore_print', rewardCount: 1,
    extraRewards: [{ defId: 'bread', count: 2 }],
    relationDelta: 10, xpReward: 35, moneyReward: 15,
  },
]);

registerSideQuest('ag12_olga_sanpropusk', NPC_DEFS.ag12_olga_sanpropusk, [
  {
    id: 'ag12_fetch_disinfectant',
    giverNpcId: 'ag12_olga_sanpropusk',
    type: QuestType.FETCH,
    desc: 'Ольга Санпропуск: «Нужен чистящий комплект. Тогда часть урожая пойдет в пайки, а не в санитарный ящик.»',
    targetItem: 'cleaning_kit', targetCount: 1,
    rewardItem: 'antifungal_ointment', rewardCount: 1,
    extraRewards: [{ defId: 'mushroom_mass', count: 1 }, { defId: 'clean_health_cert', count: 1 }],
    relationDelta: 12, xpReward: 35, moneyReward: 25,
  },
  {
    id: 'ag12_trace_brown_spore_route',
    giverNpcId: 'ag12_olga_sanpropusk',
    type: QuestType.FETCH,
    desc: 'Ольга Санпропуск: «После чистки нужен коричневый соскоб с живой петли: Маврин поддон, сырой погреб Желемышника, костяная сушилка. Соль к краю, огонь к плотоядной, пробу - мне.»',
    targetItem: 'slime_sample_brown', targetCount: 1,
    targetFloor: FloorLevel.LIVING,
    targetRoomType: RoomType.STORAGE,
    targetZoneTag: 'living_fungal_loop',
    targetHint: 'Жилая зона: начните в грибной прачечной, проверьте желемышный погреб, затем берите коричневую пробу из сырого ядра Погреба Желемышника; плотоядную сушилку проходите с солью или топливом.',
    rewardItem: 'cleaning_kit', rewardCount: 1,
    extraRewards: [
      { defId: 'rock_salt', count: 2 },
      { defId: 'antifungal_ointment', count: 1 },
      { defId: 'ammo_fuel', count: 2 },
    ],
    relationDelta: 15, xpReward: 70, moneyReward: 42,
    requiresSideQuestDone: 'ag12_fetch_disinfectant',
    eventTargetName: 'Ольга связала грибную прачечную, желемышные погреба и плотоядную сушилку в один санитарный маршрут.',
    eventTags: ['living_fungal_loop', 'mushroom', 'zhelemish', 'slime', 'cleaning', 'salt', 'fire', 'medicine'],
    eventData: {
      outcome: 'brown_spore_route_checked',
      routeRooms: ['Грибная прачечная первой смены', 'Желемышный погреб Мавры', 'Погреб Желемышника', 'Плотоядная грибница: костяная сушилка'],
      counterplayItems: ['rock_salt', 'ammo_fuel', 'cleaning_kit', 'antifungal_ointment'],
      rumorIds: ['lead_living_mushroom_cellar_spores', 'lead_living_zhelemish_cellar', 'slime_brown_cleanup'],
    },
  },
]);

registerSideQuest('ag12_valera_meshkov', NPC_DEFS.ag12_valera_meshkov, [
  {
    id: 'ag12_dirty_ration_choice',
    giverNpcId: 'ag12_valera_meshkov',
    type: QuestType.FETCH,
    desc: 'Валера Мешков: «Принеси две зараженные шляпки. Очередь получит еду быстро, а чистый паек пусть ждёт инспектора.»',
    targetItem: 'infected_mushroom', targetCount: 2,
    rewardItem: 'cigs', rewardCount: 3,
    extraRewards: [{ defId: 'canned', count: 1 }],
    relationDelta: -4, xpReward: 30, moneyReward: 35,
  },
]);

function areaClear(world: World, rx: number, ry: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      if (world.aptMask[world.idx(rx + dx, ry + dy)]) return false;
    }
  }
  return true;
}

function findOrigin(world: World, zcx: number, zcy: number): { x: number; y: number } {
  const baseX = zcx - Math.floor(CELLAR_W / 2);
  const baseY = zcy - Math.floor(CELLAR_H / 2);
  for (let r = 0; r <= 72; r += 4) {
    for (let k = 0; k < 20; k++) {
      const a = ((k + 3) / 20) * Math.PI * 2;
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
      if (world.aptMask[ci]) continue;
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.ROTTEN;
      world.floorTex[ci] = Tex.F_TILE;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
  }

  const room: Room = {
    id: roomId,
    type: RoomType.PRODUCTION,
    x: rx, y: ry, w: CELLAR_W, h: CELLAR_H,
    doors: [],
    sealed: false,
    name: 'Грибная прачечная первой смены',
    apartmentId: -1,
    wallTex: Tex.ROTTEN,
    floorTex: Tex.F_TILE,
  };
  world.rooms[roomId] = room;

  for (let dy = 0; dy < CELLAR_H; dy++) {
    for (let dx = 0; dx < CELLAR_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci]) continue;
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

function dropItem(
  entities: Entity[],
  nextId: { v: number },
  x: number,
  y: number,
  defId: string,
  count = 1,
  data?: unknown,
): void {
  entities.push({
    id: nextId.v++,
    type: EntityType.ITEM_DROP,
    x: x + 0.5,
    y: y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count, data }],
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
): void {
  requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle,
    weapon,
    canGiveQuest: true,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
  });
}

function decorateCellar(world: World, entities: Entity[], nextId: { v: number }, room: Room): void {
  const rx = room.x;
  const ry = room.y;

  for (const [x, y, feature] of [
    [rx + 1, ry + 1, Feature.LAMP],
    [rx + 3, ry + 2, Feature.SHELF],
    [rx + 5, ry + 2, Feature.SHELF],
    [rx + 7, ry + 2, Feature.SHELF],
    [rx + 9, ry + 2, Feature.SHELF],
    [rx + 2, ry + 5, Feature.SINK],
    [rx + 4, ry + 5, Feature.MACHINE],
    [rx + 6, ry + 5, Feature.APPARATUS],
    [rx + 9, ry + 5, Feature.TABLE],
    [rx + 10, ry + 5, Feature.CHAIR],
    [rx + 11, ry + 1, Feature.LAMP],
  ] as const) {
    setFeature(world, x, y, feature);
  }

  for (let dx = 3; dx <= 9; dx += 2) {
    const ci = world.idx(rx + dx, ry + CELLAR_H - 2);
    world.cells[ci] = Cell.WATER;
    world.floorTex[ci] = Tex.F_WATER;
    world.roomMap[ci] = room.id;
  }

  world.wallTex[world.idx(rx + Math.floor(CELLAR_W / 2), ry - 1)] = Tex.POSTER_BASE + 41;
  world.wallTex[world.idx(rx + CELLAR_W - 1, ry + 4)] = Tex.ROTTEN;
  stampSurfaceSplat(world, rx + 4, ry + 6, 0.5, 0.5, 5, 0.55, 12012, 42, 110, 54, false);
  stampSurfaceSplat(world, rx + 8, ry + 3, 0.5, 0.5, 4, 0.45, 12013, 120, 68, 42, false);

  dropItem(entities, nextId, rx + 3, ry + 3, 'spore_print', 1);
  dropItem(entities, nextId, rx + 5, ry + 3, 'substrate_sack', 2);
  dropItem(entities, nextId, rx + 8, ry + 4, 'mushroom_mass', 3);
  dropItem(entities, nextId, rx + 10, ry + 7, 'infected_mushroom', 1);
  dropItem(entities, nextId, rx + 2, ry + 7, 'duct_tape', 1);
  dropItem(entities, nextId, rx + 1, ry + 3, 'rock_salt', 1);
  dropItem(
    entities,
    nextId,
    rx + 11,
    ry + 3,
    'note',
    1,
    'Санмаршрут Ольги: сначала чистая прачечная и соль, потом желемышный поддон Мавры, затем сырой погреб Желемышника. Коричневую пробу не есть. Плотоядную сушилку проходить с огнем или обходом.',
  );

  spawnNpc(entities, nextId, 'ag12_egor_plesen', rx + 6, ry + 4, Math.PI);
  spawnNpc(entities, nextId, 'ag12_olga_sanpropusk', rx + 2, ry + 2, Math.PI / 2, 'makarov');
  spawnNpc(entities, nextId, 'ag12_valera_meshkov', rx + 10, ry + 6, -Math.PI / 2, 'knife');
}

function generateMushroomCellar(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zcx: number,
  zcy: number,
): { nextRoomId: number } {
  const pos = findOrigin(world, zcx, zcy);
  const room = carveCellar(world, nextRoomId++, pos.x, pos.y);
  decorateCellar(world, entities, nextId, room);
  genLog(`[AG12] Грибная прачечная at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId };
}

registerZoneContent(32, 'Грибная прачечная первой смены', generateMushroomCellar);
