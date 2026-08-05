/* ── Аварийный сброс — repair/steal/flee pressure loop ───────── */

import {
  AIGoal, Cell, EntityType, Tex, Feature, RoomType, Faction, Occupation, QuestType,
  MonsterKind,
  type Entity,
} from '../../core/types';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { registerCellHazardSite } from '../../systems/cell_hazards';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  type MaintContentCtx, dropItems, findMaintArea, openTile, setFeature,
  setWater, spawnMonstersNear, spawnPlotNpc, stampMaintRoom,
} from './content_helpers';

const WET_ROUTE_HAZARD_ID = 'overflow_sluice_wet_route';

const MARFA_DEF: PlotNpcDef = {
  name: 'Марфа Помпова',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.MECHANIC,
  sprite: Occupation.MECHANIC,
  hp: 135, maxHp: 135, money: 75, speed: 0.95,
  inventory: [
    { defId: 'wrench', count: 1 },
    { defId: 'pipe', count: 1 },
    { defId: 'metal_water', count: 1 },
  ],
  talkLines: [
    'Марфа Помпова. Насосная жива, пока пломба держится и кто-то держит ключ.',
    'Можно чинить помпу, можно сорвать аварийный шкаф. Только потом беги через воду быстро.',
    'Принеси дверной комплект. Я закрою обратный ход, а ты получишь сухую тропу хотя бы на бумаге.',
    'Не стой в луже, пока лампа моргает. Это не совет, это остаток опыта.',
    'Вода пошла вверх — закрывай не глаза, а кран. И дверь держи, пока я лезу к прокладке.',
  ],
  talkLinesPost: [
    'Помпа подлатана. Не навсегда, но навсегда здесь никто и не просил.',
    'Если вода пошла назад — не стой и не спорь с манометром.',
  ],
};

const EGOR_DEF: PlotNpcDef = {
  name: 'Егор Шунтов',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 120, maxHp: 120, money: 95, speed: 1.0,
  inventory: [
    { defId: 'ammo_9mm', count: 10 },
    { defId: 'harpoon_gun', count: 1 },
    { defId: 'ammo_harpoon', count: 4 },
    { defId: 'govnyak_roll', count: 1 },
    { defId: 'flashlight', count: 1 },
    { defId: 'note', count: 1 },
  ],
  talkLines: [
    'Егор Шунтов, аварийный склад. Что взял без акта — то уже спасательное имущество.',
    'В обводном лазе есть ящик. За ящиком вода. В воде угри. Гарпун дорогой, хлеб дешевле, сухой край бесплатный.',
    'Нужны два ключа. Сорвать шкаф легко, закрыть его обратно труднее.',
  ],
  talkLinesPost: [
    'Шкаф опять на учете. Почти.',
    'Если Марфа спросит, я ничего не видел. Особенно тебя.',
  ],
};

const TOMA_DEF: PlotNpcDef = {
  name: 'Тома Сливная',
  isFemale: true,
  faction: Faction.SCIENTIST,
  occupation: Occupation.ELECTRICIAN,
  sprite: Occupation.ELECTRICIAN,
  hp: 105, maxHp: 105, money: 70, speed: 1.05,
  inventory: [
    { defId: 'ammo_energy', count: 1 },
    { defId: 'pills', count: 1 },
  ],
  talkLines: [
    'Тома Сливная. Я включаю лампы над водой, чтобы тьма хотя бы расписалась.',
    'Ламповый стоит у рубильника. Пока он там, аварийный проход только для смелых или глупых.',
    'Энергоячейка оживит щиток. Или продай ее Егору, если совесть водонепроницаемая.',
    'Реле мокрое не трогай. Мокрое реле сначала просит руку, потом фамилию.',
  ],
  talkLinesPost: [
    'Щиток держит нагрузку. Лампы честно показывают, где нельзя стоять.',
    'Вода блестит — значит, путь виден. Это уже почти безопасность.',
  ],
};

registerSideQuest('ag04_sluice_marfa', MARFA_DEF, [
  {
    id: 'ag04_sluice_repair_pump',
    giverNpcId: 'ag04_sluice_marfa',
    type: QuestType.FETCH,
    desc: 'Марфа: «Принеси дверь-комплект для обратного клапана. Починим помпу, держи дверь и не стой в луже.»',
    targetItem: 'door_kit', targetCount: 1,
    rewardItem: 'filtered_water', rewardCount: 2,
    extraRewards: [{ defId: 'pipe', count: 1 }, { defId: 'bandage', count: 1 }],
    relationDelta: 14, xpReward: 65, moneyReward: 55,
  },
  {
    id: 'ag04_sluice_eels',
    giverNpcId: 'ag04_sluice_marfa',
    type: QuestType.KILL,
    desc: 'Марфа: «Два трубных угря грызут обратку. Убери их или беги, когда вода пойдет вверх.»',
    targetMonsterKind: MonsterKind.TUBE_EEL,
    killNeeded: 2,
    rewardItem: 'wrench', rewardCount: 1,
    extraRewards: [{ defId: 'metal_water', count: 2 }],
    relationDelta: 16, xpReward: 80, moneyReward: 70,
  },
]);

registerSideQuest('ag04_sluice_egor', EGOR_DEF, [
  {
    id: 'ag04_sluice_loot_clamps',
    giverNpcId: 'ag04_sluice_egor',
    type: QuestType.FETCH,
    desc: 'Егор: «Два гаечных ключа с аварийного шкафа. Формально это кража, практически — перераспределение сухости.»',
    targetItem: 'wrench', targetCount: 2,
    rewardItem: 'ammo_energy', rewardCount: 1,
    extraRewards: [{ defId: 'ammo_9mm', count: 8 }],
    relationDelta: 10, xpReward: 55, moneyReward: 80,
  },
  {
    id: 'ag04_sluice_lampovy',
    giverNpcId: 'ag04_sluice_egor',
    type: QuestType.KILL,
    desc: 'Егор: «Убей лампового у мокрого рубильника. Он свет ест, а нам свет нужен для отчета.»',
    targetMonsterKind: MonsterKind.LAMPOVY,
    killNeeded: 1,
    rewardItem: 'flashlight', rewardCount: 1,
    extraRewards: [{ defId: 'ammo_nails', count: 16 }],
    relationDelta: 12, xpReward: 70, moneyReward: 65,
  },
]);

registerSideQuest('ag04_sluice_toma', TOMA_DEF, [
  {
    id: 'ag04_sluice_power_panel',
    giverNpcId: 'ag04_sluice_toma',
    type: QuestType.FETCH,
    desc: 'Тома: «Неси энергоячейку в щиток. Лампы покажут, где обводной лаз еще не съел пол.»',
    targetItem: 'ammo_energy', targetCount: 1,
    rewardItem: 'fog_detector', rewardCount: 1,
    extraRewards: [{ defId: 'pills', count: 1 }],
    relationDelta: 12, xpReward: 60, moneyReward: 45,
  },
]);

function addWetRouteCell(ctx: MaintContentCtx, wetCells: number[], x: number, y: number): void {
  setWater(ctx.world, x, y);
  const ci = ctx.world.idx(x, y);
  if (ctx.world.cells[ci] === Cell.WATER && !wetCells.includes(ci)) wetCells.push(ci);
}

function spawnWaterEel(ctx: MaintContentCtx, x: number, y: number, targetX: number, targetY: number): void {
  const ci = ctx.world.idx(x, y);
  if (ctx.world.cells[ci] !== Cell.WATER) return;

  const def = MONSTERS[MonsterKind.TUBE_EEL];
  if (!def) return;
  const zid = ctx.world.zoneMap[ci];
  const zoneLevel = (zid >= 0 && ctx.world.zones[zid]) ? (ctx.world.zones[zid].level ?? 5) : 5;
  const hp = scaleMonsterHp(def.hp, zoneLevel);

  const monster: Entity = {
    id: ctx.nextId.v++, type: EntityType.MONSTER,
    x: x + 0.5, y: y + 0.5,
    angle: Math.atan2(targetY - y, targetX - x), pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: def.sprite,
    hp, maxHp: hp,
    monsterKind: MonsterKind.TUBE_EEL, attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: targetX, ty: targetY, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
  };
  ctx.entities.push(monster);
}

export function generateOverflowSluice(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 29, 13, 105, 220);
  const wetCells: number[] = [];

  const pump = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.PRODUCTION,
    pos.x, pos.y, 12, 8,
    'Аварийная насосная: ручной ремонт',
    Tex.METAL, Tex.F_CONCRETE,
  );
  const bypass = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.STORAGE,
    pos.x + 16, pos.y + 1, 10, 9,
    'Затопленный обводной склад: пломба сорвана',
    Tex.PIPE, Tex.F_WATER,
  );

  const dryY = pump.y + 4;
  const wetY = pump.y + 5;
  for (let x = pump.x + pump.w; x < bypass.x; x++) {
    openTile(ctx.world, x, dryY, Tex.F_CONCRETE);
    addWetRouteCell(ctx, wetCells, x, wetY);
  }

  for (let dx = 2; dx < pump.w - 1; dx += 3) {
    setFeature(ctx.world, pump.x + dx, pump.y + 2, Feature.MACHINE);
    setFeature(ctx.world, pump.x + dx, pump.y + 5, Feature.APPARATUS);
  }
  setFeature(ctx.world, pump.x + 1, pump.y + 1, Feature.LAMP);
  setFeature(ctx.world, pump.x + 6, pump.y + 1, Feature.LAMP);
  setFeature(ctx.world, pump.x + 10, pump.y + 6, Feature.SHELF);
  addWetRouteCell(ctx, wetCells, pump.x + 1, pump.y + 6);
  addWetRouteCell(ctx, wetCells, pump.x + 2, pump.y + 6);
  addWetRouteCell(ctx, wetCells, pump.x + 3, pump.y + 6);

  for (let dy = 1; dy < bypass.h - 1; dy++) {
    for (let dx = 1; dx < bypass.w - 1; dx++) {
      if (dy === 2 || (dx === 5 && dy < bypass.h - 2)) continue;
      addWetRouteCell(ctx, wetCells, bypass.x + dx, bypass.y + dy);
    }
  }
  setFeature(ctx.world, bypass.x + 2, bypass.y + 2, Feature.SHELF);
  setFeature(ctx.world, bypass.x + 5, bypass.y + 2, Feature.LAMP);
  setFeature(ctx.world, bypass.x + 8, bypass.y + 4, Feature.APPARATUS);
  setFeature(ctx.world, bypass.x + 5, bypass.y + 6, Feature.LAMP);

  spawnPlotNpc(ctx, 'ag04_sluice_marfa', MARFA_DEF, pump.x + 3, pump.y + 5, 0);
  spawnPlotNpc(ctx, 'ag04_sluice_toma', TOMA_DEF, pump.x + 8, pump.y + 2, Math.PI);
  spawnPlotNpc(ctx, 'ag04_sluice_egor', EGOR_DEF, bypass.x + 2, bypass.y + 2, Math.PI / 2, {
    weapon: 'makarov',
  });

  dropItems(ctx, pump, ['pipe', 'wrench', 'metal_water', 'bandage', 'note']);
  dropItems(ctx, bypass, [
    'door_kit', 'wrench', 'wrench', 'ammo_energy', 'filtered_water',
    'metal_water', 'pipe', 'flashlight', 'ammo_9mm', 'ammo_harpoon',
    'bread', 'govnyak_roll',
  ]);

  registerCellHazardSite(ctx.world, {
    id: `${WET_ROUTE_HAZARD_ID}_${bypass.id}`,
    kind: 'eel_water',
    displayName: 'Угревый мокрый ход',
    cells: wetCells,
    tags: ['maintenance', 'water', 'wet_route', 'tube_eel', 'overflow_sluice', 'harpoon', 'bait'],
    sticky: false,
    cleanable: false,
    slowMult: 0.68,
    trappedMult: 0.68,
    roomId: bypass.id,
    zoneId: ctx.world.zoneMap[ctx.world.idx(bypass.x + 5, bypass.y + 5)],
    centerX: bypass.x + 5.5,
    centerY: bypass.y + 5.5,
    warning: 'Вода режет шаг, угорь ускоряется. Сухая кромка, гарпун или приманка.',
    warningColor: '#57d7df',
  });

  spawnWaterEel(ctx, bypass.x + 3, bypass.y + 5, bypass.x + 5, bypass.y + 2);
  spawnWaterEel(ctx, bypass.x + 7, bypass.y + 6, bypass.x + 5, bypass.y + 2);
  spawnMonstersNear(ctx, bypass.x + 6, bypass.y + 5, [
    MonsterKind.LAMPOVY, MonsterKind.POLZUN, MonsterKind.SBORKA,
  ], 3, 9);
}
