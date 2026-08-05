/* ── Толкучка — чёрный рынок (zone 12 content module) ─────────── */
/* Открытый зал-цех со столами-прилавками. Барыга торгует оружием  */
/* в обмен на патроны. Self-contained: NPC + FETCH quest + room.   */

import {
  Cell, DoorState, Tex, Feature, RoomType,
  type Room, type Entity, EntityType, Faction, Occupation, QuestType,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';
import { Spr } from '../../render/sprite_index';

const NPC_DEF: PlotNpcDef = {
  name: 'Шурик Барыга',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 250, maxHp: 250, money: 400, speed: 0.9,
  inventory: [
    { defId: 'shotgun', count: 1 },
    { defId: 'ammo_shells', count: 6 },
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 20 },
    { defId: 'cigs', count: 5 },
    { defId: 'flashlight', count: 1 },
  ],
  talkLines: [
    'Тише, клиент. На Толкучке за тонкой стенкой сидит сосед с блокнотом.',
    'Берём всё: патроны, бинты, жетоны, чужие исповеди. Деньги тоже, но они тут быстро плесневеют.',
    'Обрез лежит под столом, завёрнут в газету. Десять патронов 9мм — и он твой, без свидетелей.',
    'Если услышишь "плановая проверка", падай за прилавок. Проверяют обычно очередями.',
  ],
  talkLinesPost: [
    'Нормально занёс. Шурик любит людей, которые помнят цену и не трясут пустым магазином.',
    'Ищи меня по запаху масла, сырости и дешёвых сигарет.',
    'Кинешь Шурика — хрущ сам найдёт твою дверь. Я только подскажу этаж.',
  ],
};

registerSideQuest('shurik_baryga', NPC_DEF, [
  {
    id: 'shurik_ammo',
    giverNpcId: 'shurik_baryga',
    type: QuestType.FETCH,
    desc: 'Шурик: «Занеси десять патронов 9мм. Получишь обрез, шесть дробовых и две сигареты на отходняк. У прилавка не задерживайся: сосед считает сделки.»',
    targetItem: 'ammo_9mm', targetCount: 10,
    rewardItem: 'shotgun', rewardCount: 1,
    extraRewards: [
      { defId: 'ammo_shells', count: 6 },
      { defId: 'cigs', count: 2 },
    ],
    relationDelta: 12, xpReward: 40, moneyReward: 60,
  },
]);

const GUARD_DEFS: Record<string, PlotNpcDef> = {
  market_guard_lysyy: {
    name: 'Охранник Лысый',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 200, maxHp: 200, money: 30, speed: 1.0,
    weapon: 'pipe',
    inventory: [{ defId: 'pipe', count: 1 }],
    talkLines: ['У прилавка не толпись. Купил, отошёл.'],
    talkLinesPost: ['Шурик доволен - значит, пока все живы.'],
  },
  market_guard_kaban: {
    name: 'Охранник Кабан',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 200, maxHp: 200, money: 30, speed: 1.0,
    weapon: 'pipe',
    inventory: [{ defId: 'pipe', count: 1 }],
    talkLines: ['Соседа с блокнотом видишь? Вот и не ори.'],
    talkLinesPost: ['Толкучка стоит, пока дверь закрывается быстрее языка.'],
  },
};

for (const [id, def] of Object.entries(GUARD_DEFS)) registerSideQuest(id, def, []);

const MKT_W = 17;
const MKT_H = 13;

function generateMarket(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number },
  zcx: number, zcy: number,
): { nextRoomId: number } {
  const rx = world.wrap(zcx - Math.floor(MKT_W / 2));
  const ry = world.wrap(zcy - Math.floor(MKT_H / 2));

  // Phase 1: bulldoze
  for (let dy = -1; dy <= MKT_H; dy++) {
    for (let dx = -1; dx <= MKT_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci]) continue;
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.METAL;
      world.floorTex[ci] = Tex.F_CONCRETE;
      world.roomMap[ci] = -1;
      world.features[ci] = 0;
    }
  }

  // Phase 2: carve
  const roomId = nextRoomId++;
  const room: Room = {
    id: roomId, type: RoomType.COMMON,
    x: rx, y: ry, w: MKT_W, h: MKT_H,
    name: 'Толкучка',
    wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE,
    doors: [], sealed: false, apartmentId: -1,
  };
  world.rooms[roomId] = room;

  for (let dy = 0; dy < MKT_H; dy++) {
    for (let dx = 0; dx < MKT_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci]) continue;
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_CONCRETE;
      world.roomMap[ci] = roomId;
    }
  }

  // Phase 3: protect
  for (let dy = -1; dy <= MKT_H; dy++) {
    for (let dx = -1; dx <= MKT_W; dx++) {
      world.aptMask[world.idx(rx + dx, ry + dy)] = 1;
    }
  }

  // Phase 4: stalls — desks arranged as 3 rows of pairs
  for (let row = 0; row < 3; row++) {
    const sy = ry + 2 + row * 4;
    for (let col = 0; col < 4; col++) {
      const sx = rx + 2 + col * 4;
      world.features[world.idx(sx, sy)]     = Feature.DESK;
      world.features[world.idx(sx + 1, sy)] = Feature.DESK;
    }
  }
  // Lamps
  world.features[world.idx(rx + 2, ry + 1)]                = Feature.LAMP;
  world.features[world.idx(rx + MKT_W - 3, ry + 1)]        = Feature.LAMP;
  world.features[world.idx(rx + 2, ry + MKT_H - 2)]        = Feature.LAMP;
  world.features[world.idx(rx + MKT_W - 3, ry + MKT_H - 2)] = Feature.LAMP;
  world.features[world.idx(rx + Math.floor(MKT_W / 2), ry + Math.floor(MKT_H / 2))] = Feature.LAMP;

  // Phase 5: two doors — north and south
  const doorN = world.idx(rx + Math.floor(MKT_W / 2), ry - 1);
  const doorS = world.idx(rx + Math.floor(MKT_W / 2), ry + MKT_H);
  world.cells[doorN] = Cell.DOOR; world.aptMask[doorN] = 1;
  world.cells[doorS] = Cell.DOOR; world.aptMask[doorS] = 1;
  world.doors.set(doorN, { idx: doorN, state: DoorState.CLOSED, roomA: roomId, roomB: -1, keyId: '', timer: 0 });
  world.doors.set(doorS, { idx: doorS, state: DoorState.CLOSED, roomA: roomId, roomB: -1, keyId: '', timer: 0 });
  room.doors.push(doorN, doorS);

  // Phase 6: connect to maze (south)
  {
    let cx = rx + Math.floor(MKT_W / 2), cy = world.wrap(ry + MKT_H + 1);
    for (let s = 0; s < 60; s++) {
      const ci = world.idx(cx, cy);
      if (world.cells[ci] === Cell.FLOOR && !world.aptMask[ci]) break;
      if (!world.aptMask[ci]) {
        world.cells[ci] = Cell.FLOOR;
        world.floorTex[ci] = Tex.F_CONCRETE;
        world.roomMap[ci] = -1;
      }
      cy = world.wrap(cy + 1);
    }
  }
  // (north)
  {
    let cx = rx + Math.floor(MKT_W / 2), cy = world.wrap(ry - 2);
    for (let s = 0; s < 60; s++) {
      const ci = world.idx(cx, cy);
      if (world.cells[ci] === Cell.FLOOR && !world.aptMask[ci]) break;
      if (!world.aptMask[ci]) {
        world.cells[ci] = Cell.FLOOR;
        world.floorTex[ci] = Tex.F_CONCRETE;
        world.roomMap[ci] = -1;
      }
      cy = world.wrap(cy - 1);
    }
  }

  // Phase 7: scatter loot near stalls
  const lootPool = ['ammo_9mm', 'ammo_shells', 'cigs', 'bandage', 'note', 'kompot', 'flashlight', 'pipe'];
  for (let i = 0; i < 10; i++) {
    const lx = rx + 1 + Math.floor(Math.random() * (MKT_W - 2));
    const ly = ry + 1 + Math.floor(Math.random() * (MKT_H - 2));
    if (world.features[world.idx(lx, ly)]) continue;
    entities.push({
      id: nextId.v++, type: EntityType.ITEM_DROP,
      x: lx + 0.5, y: ly + 0.5, angle: 0, pitch: 0, alive: true, speed: 0, sprite: Spr.ITEM_DROP,
      inventory: [{ defId: lootPool[Math.floor(Math.random() * lootPool.length)], count: 1 }],
    });
  }

  // Phase 8: barker NPC — Шурик in center
  requireSpawnedPlotNpcFromPackage(
    entities,
    nextId,
    'shurik_baryga',
    rx + Math.floor(MKT_W / 2) + 0.5,
    ry + Math.floor(MKT_H / 2) + 0.5,
    { angle: Math.PI / 2, weapon: 'makarov', canGiveQuest: true },
  );

  // Phase 9: a couple of "guards" — wandering hunters near the entrance
  for (let g = 0; g < 2; g++) {
    requireSpawnedPlotNpcFromPackage(
      entities,
      nextId,
      g === 0 ? 'market_guard_lysyy' : 'market_guard_kaban',
      rx + 2 + g * (MKT_W - 4) + 0.5,
      ry + MKT_H - 2 + 0.5,
      { angle: Math.PI, weapon: 'pipe', canGiveQuest: false },
    );
  }

  genLog(`[MARKET] Толкучка at (${rx}, ${ry}) room #${roomId}`);
  return { nextRoomId };
}

registerZoneContent(12, 'Толкучка (чёрный рынок)', generateMarket);
