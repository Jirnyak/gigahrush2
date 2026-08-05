/* ── AG41 charge cage — production output with container conflict ─ */

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

const CONTENT_TAG = 'ag41_charge_cage';

const NAZAR_DEF: PlotNpcDef = {
  name: 'Назар Разрядный',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 155, maxHp: 155, money: 110, speed: 1.0,
  inventory: [
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 12 },
    { defId: 'ammo_energy', count: 1 },
  ],
  talkLines: [
    'Назар Разрядный. Ящик заряда не пустой, он под отчетом.',
    'Станция делает ячейки медленно. Руки к ним тянутся быстрее.',
    'Робот у линии перепутал охрану с приемкой. Снесешь его — одну ячейку спишу законно.',
  ],
  talkLinesPost: [
    'Робот молчит. Теперь слышно, как ящик думает о недостаче.',
    'Бери по акту, а не по привычке. Стены тут любят свидетелей.',
  ],
};

const ADA_DEF: PlotNpcDef = {
  name: 'Ада Катушка',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.ELECTRICIAN,
  sprite: Occupation.ELECTRICIAN,
  hp: 105, maxHp: 105, money: 55, speed: 1.0,
  inventory: [
    { defId: 'relay_diagram', count: 1 },
    { defId: 'fuse', count: 2 },
  ],
  talkLines: [
    'Ада Катушка. Зарядка не сложная: плюс к подписи, минус к совести.',
    'Две микросхемы — и я проведу одну ячейку как ремонтный расход.',
    'Ликвидаторы берегут выходной шкаф, дикие ждут за мокрой стеной. Выбирай сторону до шума.',
    'Реле теплое — значит, линия врет. Сначала сухой пол, потом руки к щитку.',
    'Не стой в луже при зарядке. Фаза не смотрит, чей у тебя пропуск.',
  ],
  talkLinesPost: [
    'Микросхемы встали. Теперь линия хотя бы знает, куда течет ток.',
    'Не тяни из шкафа при Назаре. Он считает патроны лучше, чем буквы.',
  ],
};

registerSideQuest('ag41_charge_nazar', NAZAR_DEF, [{
  id: 'ag41_charge_robot_audit',
  giverNpcId: 'ag41_charge_nazar',
  type: QuestType.KILL,
  desc: 'Назар: «Убей робота у зарядной линии. Тогда одну энергоячейку можно будет списать без кражи.»',
  targetMonsterKind: MonsterKind.ROBOT,
  killNeeded: 1,
  rewardItem: 'ammo_energy', rewardCount: 1,
  extraRewards: [{ defId: 'ammo_9mm', count: 14 }],
  relationDelta: 12, xpReward: 70, moneyReward: 85,
}]);

registerSideQuest('ag41_charge_ada', ADA_DEF, [{
  id: 'ag41_charge_circuit_waiver',
  giverNpcId: 'ag41_charge_ada',
  type: QuestType.FETCH,
  desc: 'Ада: «Две микросхемы в диспетчерскую. Сухими руками. Одна ячейка уйдет тебе как ремонтный расход.»',
  targetItem: 'circuit_board', targetCount: 2,
  rewardItem: 'ammo_energy', rewardCount: 1,
  extraRewards: [{ defId: 'fuse', count: 2 }],
  relationDelta: 10, xpReward: 55, moneyReward: 45,
}]);

function nextContainerId(ctx: MaintContentCtx & { _maxContainerId?: number }): number {
  if (ctx._maxContainerId === undefined) {
    ctx._maxContainerId = ctx.world.containers.reduce((m, c) => Math.max(m, c.id), 0);
  }
  ctx._maxContainerId++;
  while (ctx.world.containerById.has(ctx._maxContainerId)) ctx._maxContainerId++;
  return ctx._maxContainerId;
}

function addOutputLocker(ctx: MaintContentCtx, room: Room, ownerNpcId: number): void {
  const x = ctx.world.wrap(room.x + room.w - 3);
  const y = ctx.world.wrap(room.y + 2);
  const ci = ctx.world.idx(x, y);
  const container: WorldContainer = {
    id: nextContainerId(ctx),
    x,
    y,
    floor: FloorLevel.MAINTENANCE,
    roomId: room.id,
    zoneId: ctx.world.zoneMap[ci],
    kind: ContainerKind.TOOL_LOCKER,
    name: 'Выходной шкаф ячеек 089',
    inventory: [
      { defId: 'ammo_energy', count: 1 },
      { defId: 'fuse', count: 2 },
      { defId: 'relay_diagram', count: 1 },
    ],
    capacitySlots: 8,
    ownerNpcId,
    ownerName: NAZAR_DEF.name,
    faction: Faction.LIQUIDATOR,
    access: 'owner',
    discovered: true,
    factoryId: 'utility_room',
    tags: [CONTENT_TAG, 'production_output', 'utility', 'room', 'tools', 'tech', 'theft'],
  };
  ctx.world.addContainer(container);
}

function setDoorMetal(ctx: MaintContentCtx, rooms: Room[]): void {
  for (const room of rooms) {
    for (const doorIdx of room.doors) ctx.world.wallTex[doorIdx] = Tex.DOOR_METAL;
  }
}

export function generateChargeCage(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 30, 11, 70, 185);

  const charge = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.PRODUCTION,
    pos.x, pos.y, 18, 9,
    'Диспетчерская зарядки: ящик 089',
    Tex.PIPE, Tex.F_CONCRETE,
  );
  const relay = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.STORAGE,
    pos.x + 19, pos.y + 1, 8, 6,
    'Сухой склад реле 089',
    Tex.METAL, Tex.F_CONCRETE,
  );

  placeDoor(ctx.world, charge, relay, '', false);
  setDoorMetal(ctx, [charge, relay]);

  for (let dx = 2; dx < charge.w - 4; dx += 3) {
    setFeature(ctx.world, charge.x + dx, charge.y + 2, Feature.APPARATUS);
    setFeature(ctx.world, charge.x + dx, charge.y + 5, Feature.MACHINE);
  }
  setFeature(ctx.world, charge.x + charge.w - 3, charge.y + 2, Feature.SHELF);
  setFeature(ctx.world, charge.x + 3, charge.y + charge.h - 2, Feature.DESK);
  setFeature(ctx.world, charge.x + 7, charge.y + 4, Feature.LAMP);
  setFeature(ctx.world, charge.x + 13, charge.y + 4, Feature.LAMP);
  setWater(ctx.world, charge.x + 1, charge.y + charge.h - 2);
  setWater(ctx.world, charge.x + 2, charge.y + charge.h - 2);

  for (let dy = 1; dy < relay.h - 1; dy++) {
    setFeature(ctx.world, relay.x + 1, relay.y + dy, Feature.SHELF);
    if (dy % 2 === 1) setFeature(ctx.world, relay.x + relay.w - 2, relay.y + dy, Feature.SHELF);
  }
  setFeature(ctx.world, relay.x + 4, relay.y + 2, Feature.APPARATUS);
  setFeature(ctx.world, relay.x + 4, relay.y + 4, Feature.LAMP);

  const nazarId = ctx.nextId.v;
  spawnPlotNpc(ctx, 'ag41_charge_nazar', NAZAR_DEF, charge.x + 4, charge.y + 6, Math.PI, {
    weapon: 'makarov',
  });
  spawnPlotNpc(ctx, 'ag41_charge_ada', ADA_DEF, relay.x + 5, relay.y + 3, -Math.PI / 2);
  addOutputLocker(ctx, charge, nazarId);

  dropItems(ctx, relay, ['circuit_board', 'circuit_board', 'fuse', 'relay_diagram', 'metal_sheet']);
  dropItems(ctx, charge, ['fuse', 'relay_diagram', 'ammo_fuel']);

  spawnMonstersNear(ctx, charge.x + 13, charge.y + 5, [
    MonsterKind.ROBOT, MonsterKind.EYE,
  ], 3, 8);
}
