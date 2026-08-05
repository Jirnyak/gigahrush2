/* ── AG50 lift repair shaft — repair/reroute/loot expedition ─── */

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
  W,
  type Room,
} from '../../core/types';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import {
  type MaintContentCtx, dropItems, findMaintArea, openTile, setFeature,
  setWater, spawnMonstersNear, spawnPlotNpc, stampMaintRoom,
} from './content_helpers';

const SHAFT_ROOM_NAME = 'Ремонтная шахта лифта N-089';
const CONTROL_ROOM_NAME = 'Пульт ремонтной шахты N-089';
const TOOL_ROOM_NAME = 'Инструментальная лифтовой бригады N-089';

const SASHA_DEF: PlotNpcDef = {
  name: 'Саша Тросовая',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.MECHANIC,
  sprite: Occupation.MECHANIC,
  hp: 135, maxHp: 135, money: 80, speed: 0.95,
  inventory: [
    { defId: 'wrench', count: 1 },
    { defId: 'fuse', count: 1 },
    { defId: 'relay_diagram', count: 1 },
  ],
  talkLines: [
    'Шахта N-089 дергает трос так, будто лифт спорит с номером.',
    'Можно заменить предохранители и дать маршруту шанс. Можно снять схему и уйти богаче.',
    'Если лампа над тросом горит ровно, не радуйся. Ламповый просто ест аккуратно.',
    'Кабель теплый — рукавом не гладь. Фаза любит тех, кто торопится.',
    'Лифт пахнет озоном - сначала щиток, потом кнопка, потом уже ругань.',
  ],
  talkLinesPost: [
    'Маршрут держится. Не навсегда, но лифт хотя бы снова едет по кнопке.',
    'Если придет N-1337, не хвастайся ремонтом. Он не любит понятных людей.',
  ],
};

const GUARD_DEF: PlotNpcDef = {
  name: 'Старшина Рельс',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 175, maxHp: 175, money: 95, speed: 1.1,
  inventory: [
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 12 },
    { defId: 'bandage', count: 1 },
  ],
  talkLines: [
    'Рельс. Охрана шахты. Кто лезет в шкаф без акта, тот сам акт.',
    'Номерной лифт любит пустые документы. Бланк обхода иногда дешевле патронов.',
    'Арматура стучит по направляющим. Еще немного, и кабина поедет боком.',
  ],
  talkLinesPost: [
    'Трос чистый. Охрана запишет это как дисциплину, а не как удачу.',
    'Если у тебя есть бланк обхода, держи его сухим. Лифт читает пятна.',
  ],
};

registerSideQuest('ag50_shaft_sasha', SASHA_DEF, [
  {
    id: 'ag50_shaft_inspect',
    giverNpcId: 'ag50_shaft_sasha',
    type: QuestType.VISIT,
    desc: 'Саша: «Проверь шахту N-089 {dir}. Если трос целый и кабель не теплый, будем чинить маршрут, а не хоронить кабину.»',
    targetRoomName: SHAFT_ROOM_NAME,
    rewardItem: 'fuse', rewardCount: 1,
    extraRewards: [{ defId: 'water', count: 1 }],
    relationDelta: 8, xpReward: 35, moneyReward: 25,
  },
  {
    id: 'ag50_shaft_replace_fuses',
    giverNpcId: 'ag50_shaft_sasha',
    type: QuestType.FETCH,
    desc: 'Саша: «Три предохранителя в щиток N-089. Сухими руками. После этого лифт хотя бы перестанет выбирать этаж по запаху.»',
    targetItem: 'fuse', targetCount: 3,
    rewardItem: 'lift_scheme', rewardCount: 1,
    extraRewards: [{ defId: 'elevator_override_form', count: 1 }, { defId: 'gear', count: 1 }],
    relationDelta: 14, xpReward: 70, moneyReward: 70,
  },
  {
    id: 'ag50_shaft_rebar_guides',
    giverNpcId: 'ag50_shaft_sasha',
    type: QuestType.KILL,
    desc: 'Саша: «Две арматуры бьют по направляющим. Убери их, пока кабина не решила стать стеной.»',
    targetMonsterKind: MonsterKind.REBAR,
    killNeeded: 2,
    rewardItem: 'circuit_board', rewardCount: 1,
    extraRewards: [{ defId: 'sealant_tube', count: 2 }],
    relationDelta: 16, xpReward: 85, moneyReward: 80,
  },
]);

registerSideQuest('ag50_shaft_guard', GUARD_DEF, [
  {
    id: 'ag50_shaft_override_form',
    giverNpcId: 'ag50_shaft_guard',
    type: QuestType.FETCH,
    desc: 'Рельс: «Бланк обхода лифта принеси. Ремонт ремонтом, а номерной сбой без бумаги опять сделает нас пассажирами.»',
    targetItem: 'elevator_override_form', targetCount: 1,
    rewardItem: 'ammo_energy', rewardCount: 1,
    extraRewards: [{ defId: 'ammo_9mm', count: 10 }],
    relationDelta: 10, xpReward: 55, moneyReward: 65,
  },
  {
    id: 'ag50_shaft_lampovy',
    giverNpcId: 'ag50_shaft_guard',
    type: QuestType.KILL,
    desc: 'Рельс: «Ламповый жрет свет у аварийной лестницы. Без света ремонтник становится слухом.»',
    targetMonsterKind: MonsterKind.LAMPOVY,
    killNeeded: 1,
    rewardItem: 'gasmask_filter', rewardCount: 1,
    extraRewards: [{ defId: 'bandage', count: 2 }],
    relationDelta: 12, xpReward: 70, moneyReward: 75,
  },
]);

function addOwnerToolLocker(ctx: MaintContentCtx, room: Room, ownerNpcId: number, ownerName: string): void {
  const x = room.x + room.w - 3;
  const y = room.y + 2;
  const ci = ctx.world.idx(x, y);
  ctx.world.addContainer({
    id: nextContainerId(ctx),
    x,
    y,
    floor: FloorLevel.MAINTENANCE,
    roomId: room.id,
    zoneId: ctx.world.zoneMap[ci],
    kind: ContainerKind.TOOL_LOCKER,
    name: 'Личный шкаф лифтовой бригады N-089',
    inventory: [
      { defId: 'lift_scheme', count: 1 },
      { defId: 'elevator_override_form', count: 1 },
      { defId: 'fuse', count: 2 },
      { defId: 'gear', count: 1 },
      { defId: 'relay_diagram', count: 1 },
      { defId: 'inspection_mirror', count: 1 },
      { defId: 'ammo_energy', count: 1 },
    ],
    capacitySlots: 10,
    ownerNpcId,
    ownerName,
    access: 'owner',
    discovered: true,
    tags: ['tools', 'elevator', 'maintenance', 'repair'],
  });
  setFeature(ctx.world, x, y, Feature.SHELF);
}

function nextContainerId(ctx: MaintContentCtx): number {
  let id = 1;
  for (const container of ctx.world.containers) id = Math.max(id, container.id + 1);
  return id;
}

function connectShaftRooms(ctx: MaintContentCtx, control: Room, shaft: Room, tool: Room): void {
  const controlY = control.y + Math.floor(control.h / 2);
  for (let x = control.x + control.w; x <= shaft.x; x++) openTile(ctx.world, x, controlY);

  const shaftY = shaft.y + Math.floor(shaft.h / 2);
  for (let x = shaft.x + shaft.w; x <= tool.x; x++) openTile(ctx.world, x, shaftY);

  const toolY = tool.y + Math.floor(tool.h / 2);
  if (toolY !== shaftY) {
    for (let y = Math.min(toolY, shaftY); y <= Math.max(toolY, shaftY); y++) {
      openTile(ctx.world, shaft.x + shaft.w, y);
    }
  }
}

function dressShaft(ctx: MaintContentCtx, shaft: Room): void {
  for (let dy = 1; dy < shaft.h - 1; dy++) {
    setFeature(ctx.world, shaft.x + 1, shaft.y + dy, dy % 3 === 0 ? Feature.LAMP : Feature.APPARATUS);
    setFeature(ctx.world, shaft.x + shaft.w - 2, shaft.y + dy, dy % 2 === 0 ? Feature.MACHINE : Feature.APPARATUS);
    if (dy > 2 && dy < shaft.h - 3) {
      stampSurfaceSplat(ctx.world, shaft.x + 5, shaft.y + dy, 0.5, 0.5, 0.24, 95, shaft.id * 41 + dy, 28, 28, 28);
    }
  }
  for (let dx = 3; dx < shaft.w - 3; dx++) {
    if (dx % 2 === 0) setWater(ctx.world, shaft.x + dx, shaft.y + shaft.h - 2);
  }
  setFeature(ctx.world, shaft.x + 5, shaft.y + 2, Feature.LIFT_BUTTON);
  setFeature(ctx.world, shaft.x + 5, shaft.y + shaft.h - 3, Feature.LAMP);
}

export function generateLiftRepairShaft(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const found = findMaintArea(ctx.world, cx, cy, 39, 18, 70, 170);
  const pos = { x: Math.min(found.x, W - 45), y: Math.min(found.y, W - 24) };

  const control = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.PRODUCTION,
    pos.x, pos.y + 5, 10, 7,
    CONTROL_ROOM_NAME,
    Tex.METAL, Tex.F_CONCRETE,
  );
  const shaft = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.CORRIDOR,
    pos.x + 12, pos.y + 2, 11, 13,
    SHAFT_ROOM_NAME,
    Tex.PIPE, Tex.F_CONCRETE,
  );
  const tool = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.STORAGE,
    pos.x + 26, pos.y + 5, 10, 7,
    TOOL_ROOM_NAME,
    Tex.METAL, Tex.F_CONCRETE,
  );

  connectShaftRooms(ctx, control, shaft, tool);

  for (let dx = 2; dx < control.w - 1; dx += 3) {
    setFeature(ctx.world, control.x + dx, control.y + 2, Feature.SCREEN);
    setFeature(ctx.world, control.x + dx, control.y + 4, Feature.APPARATUS);
  }
  setFeature(ctx.world, control.x + 1, control.y + 1, Feature.DESK);
  setFeature(ctx.world, control.x + 7, control.y + 5, Feature.LAMP);

  dressShaft(ctx, shaft);

  for (let dy = 1; dy < tool.h - 1; dy++) {
    setFeature(ctx.world, tool.x + 1, tool.y + dy, Feature.SHELF);
    if (dy % 2 === 0) setFeature(ctx.world, tool.x + 4, tool.y + dy, Feature.MACHINE);
  }
  setFeature(ctx.world, tool.x + 6, tool.y + 2, Feature.APPARATUS);
  setFeature(ctx.world, tool.x + 5, tool.y + 5, Feature.LAMP);

  const sashaId = ctx.nextId.v;
  spawnPlotNpc(ctx, 'ag50_shaft_sasha', SASHA_DEF, control.x + 4, control.y + 5, Math.PI);
  spawnPlotNpc(ctx, 'ag50_shaft_guard', GUARD_DEF, shaft.x + 5, shaft.y + 3, Math.PI / 2, {
    weapon: 'makarov',
  });
  addOwnerToolLocker(ctx, tool, sashaId, SASHA_DEF.name);

  dropItems(ctx, control, ['fuse', 'relay_diagram', 'pressure_logbook', 'water']);
  dropItems(ctx, shaft, ['fuse', 'gear', 'circuit_board', 'bandage']);
  dropItems(ctx, tool, ['wrench', 'sealant_tube', 'manometer', 'valve_tag', 'inspection_mirror']);

  spawnMonstersNear(ctx, shaft.x + 5, shaft.y + 8, [
    MonsterKind.REBAR, MonsterKind.REBAR, MonsterKind.LAMPOVY,
    MonsterKind.TUBE_EEL, MonsterKind.SBORKA, MonsterKind.POLZUN,
  ], 4, 10);
}
