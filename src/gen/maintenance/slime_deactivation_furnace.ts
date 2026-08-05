/* ── AG71 slime deactivation furnace — dirty cleanup production ─ */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  ContainerKind,
  Faction,
  Feature,
  FloorLevel,
  MonsterKind,
  Occupation,
  QuestType,
  RoomType,
  Tex,
  type Room,
  type WorldContainer,
} from '../../core/types';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { placeDoor } from '../shared';
import {
  type MaintContentCtx, dropItems, findMaintArea, setFeature, setWater,
  spawnMonstersNear, spawnPlotNpc, stampMaintRoom,
} from './content_helpers';

const CONTENT_TAG = 'ag71_slime_deactivation_furnace';
const FACTORY_ID = 'slime_deactivation_furnace';
const BROWN_SAMPLE_ITEM = 'slime_sample_brown';
const ALKALI_POWDER_ITEM = 'alkali_powder';
const BROWN_CLEANUP_LEAD_QUEST = 'ag84_nii_brown_cleanup_lead';

const OPERATOR_DEF: PlotNpcDef = {
  name: 'Вера Гасильная',
  isFemale: true,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.MECHANIC,
  sprite: Occupation.MECHANIC,
  hp: 145, maxHp: 145, money: 95, speed: 0.95,
  inventory: [
    { defId: 'wrench', count: 1 },
    { defId: 'gasmask_filter', count: 1 },
    { defId: 'deactivated_residue', count: 1 },
  ],
  talkLines: [
    'Вера Гасильная. Печь не чистит, она делает грязь пригодной для подписи.',
    'Пробу и щёлочь в бункер, топливо в ведомость. Без бензина это просто тёплый шкаф с претензией.',
    'Если унесёшь пробу в кармане, не садись потом рядом с людьми.',
  ],
  talkLinesPost: [
    'Партия погашена. Фильтр сухой, акт мокрый.',
    'Печь шумит так, чтобы начальство слышало расход топлива.',
  ],
};

const CLAIMANT_DEF: PlotNpcDef = {
  name: 'Сенька Канистра',
  isFemale: false,
  faction: Faction.WILD,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 115, maxHp: 115, money: 40, speed: 1.05,
  inventory: [
    { defId: 'knife', count: 1 },
    { defId: 'cigs', count: 3 },
  ],
  talkLines: [
    'Сенька Канистра. Ликвидаторы зовут это опасным остатком, рынок зовёт это товаром.',
    'Проба в печи станет сухим остатком. В моих руках — долгом, слухом и деньгами.',
    'Топливо у них под пломбой. Пломба — это такая просьба открыть аккуратно.',
  ],
  talkLinesPost: [
    'Хороший сгусток. Ещё теплый, но уже продаётся.',
    'Пусть печь гудит для отчёта. Мы работаем тише.',
  ],
};

registerSideQuest('ag71_furnace_operator', OPERATOR_DEF, [
  {
    id: 'ag84_furnace_burn_brown_sample',
    giverNpcId: 'ag71_furnace_operator',
    type: QuestType.FETCH,
    desc: 'Вера: «Коричневую пробу из сухого обхода в бункер. Я верну гашёный остаток: хуже товара, лучше живого запаха.»',
    targetItem: BROWN_SAMPLE_ITEM, targetCount: 1,
    targetFloor: FloorLevel.MAINTENANCE,
    targetRoomType: RoomType.PRODUCTION,
    targetZoneTag: 'deactivation_furnace',
    targetHint: 'Коллекторы: сухой обход даёт коричневую пробу и щёлочную присыпку; печь деактивации гасит пробу в сухой остаток, а фильтр выдают по акту.',
    rewardItem: 'deactivated_residue', rewardCount: 2,
    extraRewards: [{ defId: 'gasmask_filter', count: 1 }, { defId: 'filter_receipt', count: 1 }],
    relationDelta: 12, xpReward: 75, moneyReward: 65,
    requiresSideQuestDone: BROWN_CLEANUP_LEAD_QUEST,
    eventTargetName: 'Коричневая проба прожжена в печи деактивации',
    eventSeverity: 4,
    eventPrivacy: 'local',
    eventTags: ['slime_chain', 'furnace', 'burn', 'deactivated_residue', 'liquidator', 'brown_slime'],
    eventData: { route: 'cleanup_sample_burn', outputItem: 'deactivated_residue' },
  },
  {
    id: 'ag71_furnace_fuel_account',
    giverNpcId: 'ag71_furnace_operator',
    type: QuestType.FETCH,
    desc: 'Вера: «Канистру бензина в расход печи. За топливо выдам сухой остаток и фильтр, без красивых слов про чистоту.»',
    targetItem: 'ammo_fuel', targetCount: 1,
    rewardItem: 'deactivated_residue', rewardCount: 2,
    extraRewards: [{ defId: 'gasmask_filter', count: 1 }],
    relationDelta: 10, xpReward: 55, moneyReward: 45,
  },
]);

registerSideQuest('ag71_furnace_claimant', CLAIMANT_DEF, [{
  id: 'ag71_sell_hot_clot',
  giverNpcId: 'ag71_furnace_claimant',
  type: QuestType.FETCH,
  desc: 'Сенька: «Не жги коричневую пробу. Принеси её мне целой — рынок любит то, что официально должно исчезнуть.»',
  targetItem: BROWN_SAMPLE_ITEM, targetCount: 1,
  targetFloor: FloorLevel.MAINTENANCE,
  targetRoomType: RoomType.PRODUCTION,
  targetZoneTag: 'deactivation_furnace',
  targetHint: 'Коллекторы: после сухого обхода Сенька у печи перекупает коричневую пробу до прожига.',
  rewardItem: 'cigs', rewardCount: 5,
  extraRewards: [{ defId: 'acid_bottle', count: 1 }],
  requiresSideQuestDone: BROWN_CLEANUP_LEAD_QUEST,
  relationDelta: 8, xpReward: 45, moneyReward: 85,
  eventTags: ['slime_chain', 'black_market', 'sell', 'furnace', 'brown_slime', 'contraband'],
}]);

function nextContainerId(ctx: MaintContentCtx): number {
  let id = ctx.world.containers.length + 1;
  while (ctx.world.containerById.has(id) || ctx.world.containers.some(c => c.id === id)) id++;
  return id;
}

function addContainer(
  ctx: MaintContentCtx,
  room: Room,
  x: number,
  y: number,
  container: Omit<WorldContainer, 'id' | 'x' | 'y' | 'floor' | 'roomId' | 'zoneId'>,
): void {
  const wx = ctx.world.wrap(x);
  const wy = ctx.world.wrap(y);
  const ci = ctx.world.idx(wx, wy);
  ctx.world.addContainer({
    id: nextContainerId(ctx),
    x: wx,
    y: wy,
    floor: FloorLevel.MAINTENANCE,
    roomId: room.id,
    zoneId: ctx.world.zoneMap[ci],
    ...container,
  });
  setFeature(ctx.world, wx, wy, Feature.SHELF);
}

function setDoorMetal(ctx: MaintContentCtx, rooms: Room[]): void {
  for (const room of rooms) {
    for (const doorIdx of room.doors) ctx.world.wallTex[doorIdx] = Tex.DOOR_METAL;
  }
}

function stainQuarantine(ctx: MaintContentCtx, room: Room): void {
  for (let dy = 2; dy < room.h - 1; dy++) {
    for (let dx = 2; dx < room.w - 2; dx++) {
      if ((dx + dy) % 3 !== 0) continue;
      const x = room.x + dx;
      const y = room.y + dy;
      setWater(ctx.world, x, y);
      const ci = ctx.world.idx(x, y);
      ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 105 + ((dx * 19 + dy * 7) % 70));
    }
  }
  stampSurfaceSplat(ctx.world, room.x + 4, room.y + 4, 0.5, 0.5, 3.2, 0.42, room.id * 71 + 3, 35, 92, 42, false);
  stampSurfaceSplat(ctx.world, room.x + room.w - 4, room.y + room.h - 3, 0.5, 0.5, 2.2, 0.38, room.id * 71 + 9, 80, 120, 54, true);
  ctx.world.markFogDirty();
}

function scorchFurnace(ctx: MaintContentCtx, room: Room): void {
  for (let dx = 3; dx < room.w - 3; dx += 3) {
    stampSurfaceSplat(ctx.world, room.x + dx, room.y + 6, 0.5, 0.5, 0.34, 150, room.id * 41 + dx, 95, 34, 8);
  }
}

function addFurnaceContainers(ctx: MaintContentCtx, intake: Room, furnace: Room, fuel: Room, operatorId: number): void {
  addContainer(ctx, furnace, furnace.x + furnace.w - 3, furnace.y + 2, {
    kind: ContainerKind.METAL_CABINET,
    name: 'Приёмный бункер печи гашения',
    inventory: [
      { defId: BROWN_SAMPLE_ITEM, count: 1 },
      { defId: ALKALI_POWDER_ITEM, count: 1 },
      { defId: 'filter_layer', count: 1 },
      { defId: 'deactivated_residue', count: 1 },
      { defId: 'boiled_slime_residue', count: 1 },
    ],
    capacitySlots: 10,
    ownerNpcId: operatorId,
    ownerName: OPERATOR_DEF.name,
    faction: Faction.LIQUIDATOR,
    access: 'room',
    discovered: true,
    factoryId: FACTORY_ID,
    tags: [CONTENT_TAG, 'production_output', 'cleanup', 'slime', 'sample', 'deactivation_furnace'],
  });
  addContainer(ctx, fuel, fuel.x + fuel.w - 2, fuel.y + 2, {
    kind: ContainerKind.TOOL_LOCKER,
    name: 'Опломбированный шкаф топлива печи',
    inventory: [
      { defId: 'ammo_fuel', count: 2 },
      { defId: 'liquidator_rake', count: 1 },
      { defId: 'cleaning_kit', count: 1 },
      { defId: 'gasmask_filter', count: 1 },
    ],
    capacitySlots: 8,
    ownerNpcId: operatorId,
    ownerName: OPERATOR_DEF.name,
    faction: Faction.LIQUIDATOR,
    access: 'faction',
    lockDifficulty: 3,
    discovered: true,
    tags: [CONTENT_TAG, 'fuel', 'locked', 'liquidator', 'theft', 'slime'],
  });
  addContainer(ctx, intake, intake.x + 2, intake.y + intake.h - 2, {
    kind: ContainerKind.METAL_CABINET,
    name: 'Мокрая тара до гашения',
    inventory: [
      { defId: 'acid_bottle', count: 1 },
      { defId: ALKALI_POWDER_ITEM, count: 1 },
      { defId: 'green_briquette', count: 1 },
      { defId: 'filter_receipt', count: 1 },
    ],
    capacitySlots: 7,
    ownerNpcId: operatorId,
    ownerName: OPERATOR_DEF.name,
    faction: Faction.LIQUIDATOR,
    access: 'room',
    discovered: true,
    tags: [CONTENT_TAG, 'quarantine', 'slime', 'sample', 'cleanup'],
  });
}

export function generateSlimeDeactivationFurnace(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 36, 16, 85, 205);

  const intake = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.STORAGE,
    pos.x, pos.y + 4, 8, 7,
    'Карантинная приёмка слизи',
    Tex.ROTTEN, Tex.F_WATER,
  );
  const furnace = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.PRODUCTION,
    pos.x + 9, pos.y + 2, 16, 11,
    'Печь деактивации слизи: шумный пуск',
    Tex.PIPE, Tex.F_CONCRETE,
  );
  const fuel = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.STORAGE,
    pos.x + 26, pos.y + 4, 8, 7,
    'Пломбированная топливная клетка печи',
    Tex.METAL, Tex.F_CONCRETE,
  );

  placeDoor(ctx.world, intake, furnace, '', false);
  placeDoor(ctx.world, furnace, fuel, '', false);
  setDoorMetal(ctx, [intake, furnace, fuel]);

  for (let dy = 1; dy < intake.h - 1; dy++) setFeature(ctx.world, intake.x + intake.w - 2, intake.y + dy, Feature.SHELF);
  setFeature(ctx.world, intake.x + 2, intake.y + 2, Feature.APPARATUS);
  setFeature(ctx.world, intake.x + 4, intake.y + 2, Feature.LAMP);
  stainQuarantine(ctx, intake);

  for (let dx = 2; dx < furnace.w - 2; dx += 3) {
    setFeature(ctx.world, furnace.x + dx, furnace.y + 3, Feature.MACHINE);
    setFeature(ctx.world, furnace.x + dx, furnace.y + 7, Feature.APPARATUS);
  }
  setFeature(ctx.world, furnace.x + 2, furnace.y + furnace.h - 2, Feature.DESK);
  setFeature(ctx.world, furnace.x + 7, furnace.y + 5, Feature.LAMP);
  setFeature(ctx.world, furnace.x + 12, furnace.y + 5, Feature.LAMP);
  setWater(ctx.world, furnace.x + 1, furnace.y + furnace.h - 2);
  scorchFurnace(ctx, furnace);

  for (let dy = 1; dy < fuel.h - 1; dy++) {
    setFeature(ctx.world, fuel.x + 1, fuel.y + dy, Feature.SHELF);
    if (dy % 2 === 0) setFeature(ctx.world, fuel.x + fuel.w - 2, fuel.y + dy, Feature.SHELF);
  }
  setFeature(ctx.world, fuel.x + 4, fuel.y + 3, Feature.LAMP);

  const operatorId = ctx.nextId.v;
  spawnPlotNpc(ctx, 'ag71_furnace_operator', OPERATOR_DEF, furnace.x + 3, furnace.y + furnace.h - 3, Math.PI / 2);
  spawnPlotNpc(ctx, 'ag71_furnace_claimant', CLAIMANT_DEF, fuel.x + 3, fuel.y + 4, -Math.PI / 2);
  addFurnaceContainers(ctx, intake, furnace, fuel, operatorId);

  dropItems(ctx, intake, ['filter_layer', ALKALI_POWDER_ITEM, 'filter_receipt', 'acid_bottle']);
  dropItems(ctx, furnace, ['cleaning_kit', 'gasmask_filter', 'note']);
  dropItems(ctx, fuel, ['ammo_fuel']);

  spawnMonstersNear(ctx, furnace.x + 12, furnace.y + 6, [
    MonsterKind.ROBOT, MonsterKind.EYE, MonsterKind.REBAR,
  ], 5, 11);
}
