/* ── AG68 blue glow sample — sealed science trade with risk ───── */

import {
  ContainerKind,
  Faction,
  Feature,
  FloorLevel,
  Occupation,
  QuestType,
  RoomType,
  Tex,
  type Room,
  type WorldContainer,
  type WorldEvent,
} from '../../core/types';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { changeResourceStock } from '../../systems/economy';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { MarkType, stampMark } from '../../systems/surface_marks';
import {
  type MaintContentCtx, dropItems, findMaintArea, setFeature,
  spawnPlotNpc, stampMaintRoom,
} from './content_helpers';

export const BLUE_GLOW_SAMPLE_SEALED = 'blue_glow_sample_sealed';
export const BLUE_GLOW_SAMPLE_OPEN = 'blue_glow_sample_open';

const CONTENT_TAG = 'ag68_blue_glow_sample';
const SELL_QUEST_ID = 'ag68_sell_blue_glow_sample';
const DESTROY_QUEST_ID = 'ag68_destroy_blue_glow_sample';

const BUYER_DEF: PlotNpcDef = {
  name: 'Вера Люминова',
  isFemale: true,
  faction: Faction.SCIENTIST,
  occupation: Occupation.SCIENTIST,
  sprite: Occupation.SCIENTIST,
  hp: 120, maxHp: 120, money: 260, speed: 0.95,
  inventory: [
    { defId: 'psi_stabilizer', count: 1 },
    { defId: 'ammo_energy', count: 1 },
    { defId: 'note', count: 1 },
  ],
  talkLines: [
    'Вера Люминова. Синий свет держит форму, пока герма целая.',
    'Не вскрывайте ампулу в коридоре. Тогда это образец, а не санитарная история.',
    'Принесете герметичный образец — оплачу как научный реагент, без сказок про батарею на всю смену.',
  ],
  talkLinesPost: [
    'Запечатанный материал ушел в учет. Теперь он опасен хотя бы по расписанию.',
    'Если попадется открытый — не несите в руках. Сначала закрыть, потом спорить о цене.',
  ],
};

const CLEANER_DEF: PlotNpcDef = {
  name: 'Кирилл Глушитель',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 165, maxHp: 165, money: 100, speed: 1.1,
  inventory: [
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 10 },
    { defId: 'gasmask_filter', count: 1 },
  ],
  talkLines: [
    'Глушитель. Ученые называют это образцом, пока оно в банке.',
    'Моя работа проще: целую банку в печь, журнал на подпись, коридор снова рабочий.',
    'Если решите уничтожить синий образец, несите запечатанным. Открытый я в руки не беру.',
  ],
  talkLinesPost: [
    'Герма ушла в печь. На сегодня светит только лампа.',
    'Лучший опыт с такой дрянью — тот, который не пришлось повторять.',
  ],
};

registerSideQuest('ag68_blue_sample_buyer', BUYER_DEF, [{
  id: SELL_QUEST_ID,
  giverNpcId: 'ag68_blue_sample_buyer',
  type: QuestType.FETCH,
  desc: 'Люминова: «Запечатанный синий образец нужен НИИ. Не вскрывайте: целая герма стоит дороже любого рассказа.»',
  targetItem: BLUE_GLOW_SAMPLE_SEALED, targetCount: 1,
  rewardItem: 'psi_stabilizer', rewardCount: 1,
  extraRewards: [{ defId: 'ammo_energy', count: 1 }],
  relationDelta: 14, xpReward: 95, moneyReward: 260,
}]);

registerSideQuest('ag68_blue_sample_cleaner', CLEANER_DEF, [{
  id: DESTROY_QUEST_ID,
  giverNpcId: 'ag68_blue_sample_cleaner',
  type: QuestType.FETCH,
  desc: 'Глушитель: «Принеси синий образец в герме. Уничтожим по акту, без светящихся карманов и лишних свидетелей.»',
  targetItem: BLUE_GLOW_SAMPLE_SEALED, targetCount: 1,
  rewardItem: 'cleaning_kit', rewardCount: 1,
  extraRewards: [{ defId: 'gasmask_filter', count: 1 }],
  relationDelta: 12, xpReward: 70, moneyReward: 130,
}]);

function eventDataString(event: WorldEvent, key: string): string | undefined {
  const value = event.data?.[key];
  return typeof value === 'string' ? value : undefined;
}

registerWorldEventObserver((state, event) => {
  if (event.tags.includes(CONTENT_TAG)) return;

  if (event.type === 'player_use_item' && event.itemId === BLUE_GLOW_SAMPLE_SEALED) {
    publishEvent(state, {
      type: 'player_use_item',
      actorId: event.actorId,
      actorName: event.actorName,
      actorFaction: event.actorFaction,
      itemId: BLUE_GLOW_SAMPLE_OPEN,
      itemName: 'Синий образец: герма вскрыта',
      itemCount: 1,
      itemValue: 90,
      severity: 3,
      privacy: 'local',
      tags: [CONTENT_TAG, 'sample', 'blue_glow', 'opened'],
      data: { action: 'sample_opened', sourceItem: BLUE_GLOW_SAMPLE_SEALED },
    });
    const stockChanged = changeResourceStock(state, 'medicine', -2, event.floor);
    publishEvent(state, {
      type: 'player_use_item',
      actorId: event.actorId,
      actorName: event.actorName,
      actorFaction: event.actorFaction,
      itemId: BLUE_GLOW_SAMPLE_OPEN,
      itemName: 'Контаминация синего образца',
      itemCount: 1,
      itemValue: 0,
      severity: 4,
      privacy: 'local',
      tags: [CONTENT_TAG, 'sample', 'blue_glow', 'contaminated', 'quarantine'],
      data: { action: 'local_contamination', medicineStockDelta: stockChanged ? -2 : 0 },
    });
    return;
  }

  if (event.type !== 'quest_completed') return;
  const sideQuestId = eventDataString(event, 'sideQuestId');
  if (sideQuestId === SELL_QUEST_ID) {
    changeResourceStock(state, 'psi', 4, event.floor);
    publishEvent(state, {
      type: 'quest_completed',
      actorId: event.actorId,
      actorName: event.actorName,
      actorFaction: event.actorFaction,
      itemId: BLUE_GLOW_SAMPLE_SEALED,
      itemName: 'Герметичный синий образец',
      targetName: 'Синий образец продан НИИ',
      severity: 4,
      privacy: 'local',
      tags: [CONTENT_TAG, 'sample', 'blue_glow', 'sold', 'sealed'],
      data: { action: 'sample_sold', rewardPath: 'science_buyer' },
    });
  } else if (sideQuestId === DESTROY_QUEST_ID) {
    publishEvent(state, {
      type: 'quest_completed',
      actorId: event.actorId,
      actorName: event.actorName,
      actorFaction: event.actorFaction,
      itemId: BLUE_GLOW_SAMPLE_SEALED,
      itemName: 'Герметичный синий образец',
      targetName: 'Синий образец уничтожен по акту',
      severity: 3,
      privacy: 'local',
      tags: [CONTENT_TAG, 'sample', 'blue_glow', 'destroyed', 'sealed'],
      data: { action: 'sample_destroyed', rewardPath: 'liquidator_burn' },
    });
  }
});

function nextContainerId(ctx: MaintContentCtx): number {
  let id = ctx.world.containers.length + 1;
  while (ctx.world.containerById.has(id) || ctx.world.containers.some(c => c.id === id)) id++;
  return id;
}

function addSampleContainer(ctx: MaintContentCtx, room: Room, x: number, y: number): void {
  const ci = ctx.world.idx(x, y);
  const container: WorldContainer = {
    id: nextContainerId(ctx),
    x,
    y,
    floor: FloorLevel.MAINTENANCE,
    roomId: room.id,
    zoneId: ctx.world.zoneMap[ci],
    kind: ContainerKind.MEDICAL_CABINET,
    name: 'Гермобокс синего образца',
    inventory: [{ defId: BLUE_GLOW_SAMPLE_SEALED, count: 1 }],
    capacitySlots: 4,
    faction: Faction.SCIENTIST,
    access: 'room',
    discovered: true,
    tags: [CONTENT_TAG, 'sample', 'blue_glow', 'sealed', 'quarantine', 'science', 'energy'],
  };
  ctx.world.addContainer(container);
}

function stampBlueGlow(ctx: MaintContentCtx, room: Room, sx: number, sy: number): void {
  setFeature(ctx.world, sx, sy, Feature.APPARATUS);
  setFeature(ctx.world, sx - 2, sy, Feature.LAMP);
  setFeature(ctx.world, sx + 2, sy, Feature.LAMP);
  stampMark(ctx.world, sx, sy, 0.5, 0.5, 1.4, MarkType.PSI, room.id * 977 + 11, 55, 180, 255, 235);
  stampMark(ctx.world, sx - 1, sy + 1, 0.35, 0.45, 0.75, MarkType.PSI, room.id * 977 + 23, 95, 210, 255, 190);
  stampMark(ctx.world, sx + 1, sy - 1, 0.6, 0.55, 0.65, MarkType.PSI, room.id * 977 + 37, 40, 130, 240, 180);
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const ci = ctx.world.idx(sx + dx, sy + dy);
      if (ctx.world.fog[ci] < 42) ctx.world.fog[ci] = 42;
    }
  }
  ctx.world.markFogDirty();
}

export function generateBlueGlowSample(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 24, 11, 85, 210);

  const room = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.MEDICAL,
    pos.x, pos.y, 22, 9,
    'Кэш голубого свечения',
    Tex.METAL, Tex.F_TILE,
  );

  const sx = room.x + Math.floor(room.w / 2);
  const sy = room.y + Math.floor(room.h / 2);

  for (let dx = 2; dx < room.w - 2; dx += 3) {
    setFeature(ctx.world, room.x + dx, room.y + 1, Feature.SHELF);
    if (dx % 2 === 0) setFeature(ctx.world, room.x + dx, room.y + room.h - 2, Feature.APPARATUS);
  }
  setFeature(ctx.world, room.x + 3, room.y + 4, Feature.DESK);
  setFeature(ctx.world, room.x + room.w - 4, room.y + 4, Feature.DESK);
  setFeature(ctx.world, room.x + 1, room.y + 1, Feature.LAMP);
  setFeature(ctx.world, room.x + room.w - 2, room.y + 1, Feature.LAMP);

  stampBlueGlow(ctx, room, sx, sy);
  addSampleContainer(ctx, room, sx, sy);

  spawnPlotNpc(ctx, 'ag68_blue_sample_buyer', BUYER_DEF, room.x + 5, room.y + room.h - 3, 0);
  spawnPlotNpc(ctx, 'ag68_blue_sample_cleaner', CLEANER_DEF, room.x + room.w - 6, room.y + room.h - 3, Math.PI);
  dropItems(ctx, room, ['note', 'official_quarantine_clearance', 'filter_receipt', 'fuse']);
}
