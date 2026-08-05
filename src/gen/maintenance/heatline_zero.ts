/* ── Теплотрасса Ноль — local static heat hazard slice ───────── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  Tex,
  Feature,
  RoomType,
  Faction,
  Occupation,
  QuestType,
  MonsterKind,
} from '../../core/types';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import {
  type MaintContentCtx, dropItems, findMaintArea, openTile, setFeature, setWater,
  spawnMonstersNear, spawnPlotNpc, stampMaintRoom,
} from './content_helpers';

const ZAKHAR_DEF: PlotNpcDef = {
  name: 'Захар Нулевой',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.MECHANIC,
  sprite: Occupation.MECHANIC,
  hp: 140, maxHp: 140, money: 75, speed: 0.9,
  inventory: [
    { defId: 'manometer', count: 1 },
    { defId: 'asbestos_cord', count: 1 },
    { defId: 'metal_water', count: 1 },
  ],
  talkLines: [
    'Теплотрасса Ноль держится на двух вещах: вентиль не трогать и вентиль трогать вовремя.',
    'Обваренный коридор короткий. Безопасный обход мокрый и длинный. Выбирай сам.',
    'Красные лампы здесь не освещают, а предупреждают.',
    'Манометр, асбестовый шнур и герметик — это полный ремонт. Манометр с одной деталью — только временная доводка.',
    'Уплотнитель сухой? Тогда вентиль ещё можно уважать.',
    'Пар не слушает приказ. Он слушает только закрытый кран и быстрые ноги.',
  ],
  talkLinesPost: [
    'Давление сброшено по документам. По коже пока не проверяй.',
    'Если шипение стало тише, значит авария стала ближе к соседям.',
  ],
};

const MIRA_DEF: PlotNpcDef = {
  name: 'Мира Обводная',
  isFemale: true,
  faction: Faction.SCIENTIST,
  occupation: Occupation.LOCKSMITH,
  sprite: Occupation.LOCKSMITH,
  hp: 110, maxHp: 110, money: 55, speed: 1.0,
  inventory: [
    { defId: 'wrench', count: 1 },
    { defId: 'sealant_tube', count: 1 },
    { defId: 'note', count: 1 },
  ],
  talkLines: [
    'Я веду обход. Не красивый, просто там меньше пара.',
    'Ремонтный ящик открыт. Взять можно все, но потом чинить будет нечем.',
    'Саботаж тоже решение. Только после него не спрашивай, почему трубы поют.',
    'Если полезешь к вентилю без деталей, не стой лицом к лампе. Одна деталь без манометра тоже уходит в пар.',
    'Держи дверь, пока я метку ставлю. Обход любит тех, кто не лезет первым в жар.',
  ],
  talkLinesPost: [
    'Обход отмечен. Если он исчезнет после самосбора, значит дом передумал.',
    'Асбестовый шнур лучше держать в руках, а не в легких.',
  ],
};

registerSideQuest('ag14_zakhar_nulevoy', ZAKHAR_DEF, [
  {
    id: 'ag14_heatline_cool_valve',
    giverNpcId: 'ag14_zakhar_nulevoy',
    type: QuestType.FETCH,
    desc: 'Захар: «Принеси два асбестовых шнура. Обмотаем нулевой вентиль и дадим коридору остыть хотя бы на бумаге.»',
    targetItem: 'asbestos_cord', targetCount: 2,
    rewardItem: 'filtered_water', rewardCount: 2,
    extraRewards: [{ defId: 'bandage', count: 1 }, { defId: 'manometer', count: 1 }],
    relationDelta: 14, xpReward: 60, moneyReward: 45,
  },
  {
    id: 'ag14_heatline_fetch_tool',
    giverNpcId: 'ag14_zakhar_nulevoy',
    type: QuestType.FETCH,
    desc: 'Захар: «Нужен манометр. Без стрелки мы не знаем, это ремонт, последняя экскурсия или труба зовет по фамилии.»',
    targetItem: 'manometer', targetCount: 1,
    rewardItem: 'door_kit', rewardCount: 1,
    extraRewards: [{ defId: 'sealant_tube', count: 2 }],
    relationDelta: 12, xpReward: 50, moneyReward: 35,
  },
]);

registerSideQuest('ag14_mira_obvodnaya', MIRA_DEF, [
  {
    id: 'ag14_heatline_safe_bypass',
    giverNpcId: 'ag14_mira_obvodnaya',
    type: QuestType.VISIT,
    desc: 'Мира: «Проверь безопасный душевой обход {dir}. Если вода еще есть, в обваренный коридор можно не лезть.»',
    targetRoomType: RoomType.BATHROOM,
    rewardItem: 'asbestos_cord', rewardCount: 1,
    extraRewards: [{ defId: 'metal_water', count: 2 }],
    relationDelta: 10, xpReward: 35, moneyReward: 20,
  },
  {
    id: 'ag14_heatline_sabotage',
    giverNpcId: 'ag14_mira_obvodnaya',
    type: QuestType.FETCH,
    desc: 'Мира: «Если хочешь сорвать смену, принеси канистру бензина. Запишем как перегрев, а не как саботаж.»',
    targetItem: 'ammo_fuel', targetCount: 1,
    rewardItem: 'grenade', rewardCount: 1,
    extraRewards: [{ defId: 'cigs', count: 3 }],
    relationDelta: -4, xpReward: 45, moneyReward: 60,
  },
]);

export function generateHeatlineZero(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 30, 20, 95, 190);

  const valve = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.PRODUCTION,
    pos.x, pos.y + 6, 9, 7,
    'Теплотрасса Ноль: вентильная жар 2 давление 2',
    Tex.METAL, Tex.F_CONCRETE,
  );
  const repair = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.STORAGE,
    pos.x + 1, pos.y + 1, 7, 4,
    'Теплотрасса Ноль: ремонтный ящик жар 1',
    Tex.PIPE, Tex.F_CONCRETE,
  );
  const scorch = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.CORRIDOR,
    pos.x + 11, pos.y + 7, 16, 5,
    'Теплотрасса Ноль: обваренный коридор жар 3',
    Tex.PIPE, Tex.F_CONCRETE,
  );
  const bypass = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.BATHROOM,
    pos.x + 11, pos.y + 14, 16, 5,
    'Теплотрасса Ноль: безопасный душевой обход жар 0',
    Tex.TILE_W, Tex.F_TILE,
  );

  const valveY = valve.y + 3;
  for (let x = valve.x + valve.w; x <= scorch.x; x++) openTile(ctx.world, x, valveY);
  for (let y = repair.y + repair.h; y <= valve.y; y++) openTile(ctx.world, repair.x + 3, y);
  for (let y = valve.y + valve.h; y <= bypass.y + 2; y++) openTile(ctx.world, valve.x + 2, y);
  for (let x = valve.x + 2; x <= bypass.x; x++) openTile(ctx.world, x, bypass.y + 2, Tex.F_TILE);
  for (let x = scorch.x + scorch.w - 2; x <= bypass.x + bypass.w - 2; x++) openTile(ctx.world, x, bypass.y + 2, Tex.F_TILE);
  for (let y = scorch.y + scorch.h; y <= bypass.y + 2; y++) openTile(ctx.world, scorch.x + scorch.w - 2, y, Tex.F_TILE);

  for (let dx = 1; dx < valve.w - 1; dx++) {
    if (dx % 2 === 0) setFeature(ctx.world, valve.x + dx, valve.y + 2, Feature.MACHINE);
    if (dx % 3 === 0) setFeature(ctx.world, valve.x + dx, valve.y + 5, Feature.APPARATUS);
  }
  setFeature(ctx.world, valve.x + 1, valve.y + 1, Feature.LAMP);
  setFeature(ctx.world, valve.x + valve.w - 2, valve.y + 1, Feature.LAMP);
  setWater(ctx.world, valve.x + 4, valve.y + 5);

  for (let dx = 1; dx < repair.w - 1; dx += 2) setFeature(ctx.world, repair.x + dx, repair.y + 1, Feature.SHELF);
  setFeature(ctx.world, repair.x + 5, repair.y + 2, Feature.LAMP);

  for (let dx = 1; dx < scorch.w - 1; dx++) {
    const x = scorch.x + dx;
    if (dx % 2 === 0) setFeature(ctx.world, x, scorch.y + 1, Feature.APPARATUS);
    if (dx % 4 === 1) setFeature(ctx.world, x, scorch.y + 3, Feature.LAMP);
    ctx.world.fog[ctx.world.idx(x, scorch.y + 2)] = 105;
    if (dx % 2 === 0) ctx.world.fog[ctx.world.idx(x, scorch.y + 1)] = 45;
    stampSurfaceSplat(ctx.world, x, scorch.y + 2, 0.5, 0.5, 0.34, 160, scorch.id * 31 + dx, 120, 35, 8);
  }
  ctx.world.markFogDirty();

  for (let dx = 1; dx < bypass.w - 1; dx++) {
    if (dx % 3 === 0) setWater(ctx.world, bypass.x + dx, bypass.y + 2);
    if (dx % 4 === 1) setFeature(ctx.world, bypass.x + dx, bypass.y + 1, Feature.SINK);
  }
  setFeature(ctx.world, bypass.x + 2, bypass.y + 3, Feature.LAMP);
  setFeature(ctx.world, bypass.x + bypass.w - 3, bypass.y + 3, Feature.LAMP);

  spawnPlotNpc(ctx, 'ag14_zakhar_nulevoy', ZAKHAR_DEF, valve.x + 4, valve.y + 4, Math.PI);
  spawnPlotNpc(ctx, 'ag14_mira_obvodnaya', MIRA_DEF, repair.x + 3, repair.y + 2, Math.PI / 2);

  dropItems(ctx, repair, ['asbestos_cord', 'asbestos_cord', 'manometer', 'sealant_tube', 'wrench', 'ammo_fuel']);
  dropItems(ctx, bypass, ['metal_water', 'filtered_water', 'bandage']);
  dropItems(ctx, scorch, ['ammo_fuel', 'note']);

  spawnMonstersNear(ctx, scorch.x + Math.floor(scorch.w / 2), scorch.y + 2, [
    MonsterKind.LAMPOVY, MonsterKind.POLZUN, MonsterKind.TVAR, MonsterKind.TUBE_EEL,
  ], 3, 9);
}
