/* ── Паровые вентили — static steam fake, no simulation ───────── */

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
  type MaintContentCtx, dropItems, findMaintArea, setFeature, setWater,
  spawnMonstersNear, spawnPlotNpc, stampMaintRoom,
} from './content_helpers';

const LIDIA_DEF: PlotNpcDef = {
  name: 'Лидия Паровая',
  isFemale: true,
  faction: Faction.SCIENTIST,
  occupation: Occupation.SCIENTIST,
  sprite: Occupation.SCIENTIST,
  hp: 120, maxHp: 120, money: 80, speed: 1.0,
  inventory: [
    { defId: 'antidep', count: 1 },
    { defId: 'pills', count: 2 },
    { defId: 'note', count: 2 },
  ],
  talkLines: [
    'Я Лидия. Пар здесь не рисуют, его оформляют актом.',
    'Красные лампы — перегрев. Лужи — конденсат. Шипение додумывай сам.',
    'Глаза любят теплые тоннели. Два глаза меньше — один маршрут безопаснее.',
  ],
  talkLinesPost: [
    'Паровой коридор условно остыл.',
    'Не стой под лампой, если она стала белой. Это не свет, это предупреждение.',
  ],
};

registerSideQuest('ag04_steam_lidia', LIDIA_DEF, [
  {
    id: 'ag04_steam_eyes',
    giverNpcId: 'ag04_steam_lidia',
    type: QuestType.KILL,
    desc: 'Лидия: «Убей два летающих глаза в паровых проходах. Они греются на лампах.»',
    targetMonsterKind: MonsterKind.EYE,
    killNeeded: 2,
    rewardItem: 'pills', rewardCount: 2,
    extraRewards: [{ defId: 'antidep', count: 1 }, { defId: 'ammo_energy', count: 1 }],
    relationDelta: 15, xpReward: 75, moneyReward: 70,
  },
]);

export function generateSteamValves(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 18, 8, 70, 160);

  const room = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.PRODUCTION,
    pos.x, pos.y, 16, 6,
    'Паровой коридор: красное давление',
    Tex.PIPE, Tex.F_CONCRETE,
  );

  for (let dx = 1; dx < room.w - 1; dx++) {
    if (dx % 2 === 0) setFeature(ctx.world, room.x + dx, room.y + 1, Feature.APPARATUS);
    if (dx % 4 === 1) setFeature(ctx.world, room.x + dx, room.y + 4, Feature.LAMP);
    if (dx % 3 === 0) setWater(ctx.world, room.x + dx, room.y + 3);
  }
  setFeature(ctx.world, room.x + 2, room.y + 2, Feature.MACHINE);
  setFeature(ctx.world, room.x + room.w - 3, room.y + 2, Feature.MACHINE);

  spawnPlotNpc(ctx, 'ag04_steam_lidia', LIDIA_DEF, room.x + 3, room.y + 4, 0);
  dropItems(ctx, room, ['pills', 'antidep', 'water', 'note', 'ammo_energy']);

  spawnMonstersNear(ctx, room.x + Math.floor(room.w / 2), room.y + 3, [
    MonsterKind.EYE, MonsterKind.EYE, MonsterKind.SHADOW, MonsterKind.TVAR,
  ]);
}
