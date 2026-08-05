/* ── Станция давления — pumps, valves, pressure bureaucracy ───── */

import {
  Cell,
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
  type MaintContentCtx, dropItems, findMaintArea, openTile, setFeature,
  setWater, spawnAmbientNpc, spawnMonstersNear, spawnPlotNpc, stampMaintRoom,
} from './content_helpers';

const BORIS_DEF: PlotNpcDef = {
  name: 'Борис Давленко',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.MECHANIC,
  sprite: Occupation.MECHANIC,
  hp: 150, maxHp: 150, money: 65, speed: 0.9,
  inventory: [
    { defId: 'wrench', count: 1 },
    { defId: 'pipe', count: 1 },
    { defId: 'water', count: 1 },
  ],
  talkLines: [
    'Диспетчер давления Борис. Зеленая лампа — живем. Красная — пишем объяснительную посмертно.',
    'Манометр врет на две атмосферы, но стабильно. Значит, это уже стандарт.',
    'Принеси ключи. Секция держится на одной гайке и моей подписи.',
    'Прокладку держи сухой. Мокрая прокладка — это не деталь, а обещание потопа.',
    'Труба стучит по фамилии? Не отвечай. Ключ на вентиль и шаг назад.',
  ],
  talkLinesPost: [
    'Давление принято условно нормальным.',
    'Если лампы мигают — не верь глазам. Верь полу: сухой пол значит можно идти.',
  ],
  talkQuestResponse: 'Сава прислал? Передай: водомер крутится даже без воды. Это не авария, это план.',
};

registerSideQuest('ag04_pressure_boris', BORIS_DEF, [
  {
    id: 'ag04_pressure_wrenches',
    giverNpcId: 'ag04_pressure_boris',
    type: QuestType.FETCH,
    desc: 'Борис: «Три гаечных ключа. Один на работу, второй дверь держать, третий на комиссию после аварии.»',
    targetItem: 'wrench', targetCount: 3,
    rewardItem: 'ammo_fuel', rewardCount: 2,
    extraRewards: [{ defId: 'water', count: 2 }, { defId: 'bandage', count: 1 }],
    relationDelta: 12, xpReward: 55, moneyReward: 45,
  },
  {
    id: 'ag04_pressure_rebar',
    giverNpcId: 'ag04_pressure_boris',
    type: QuestType.KILL,
    desc: 'Борис: «Арматура скребет по насосам. Две штуки убери, пока они не стали частью схемы.»',
    targetMonsterKind: MonsterKind.REBAR,
    killNeeded: 2,
    rewardItem: 'rebar', rewardCount: 1,
    extraRewards: [{ defId: 'ammo_nails', count: 12 }],
    relationDelta: 14, xpReward: 70, moneyReward: 60,
  },
]);

export function generatePressureStation(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 26, 10, 35, 115);

  const pump = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.PRODUCTION,
    pos.x, pos.y, 11, 8,
    'Насосная давления: зеленый режим',
    Tex.METAL, Tex.F_CONCRETE,
  );
  const valves = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.CORRIDOR,
    pos.x + 14, pos.y + 1, 10, 5,
    'Коридор вентилей: ручное давление',
    Tex.PIPE, Tex.F_CONCRETE,
  );

  for (let x = pump.x + pump.w; x <= valves.x - 1; x++) {
    openTile(ctx.world, x, pump.y + 4);
  }
  openTile(ctx.world, valves.x - 1, pump.y + 4);

  for (let dx = 2; dx < pump.w - 1; dx += 3) {
    setFeature(ctx.world, pump.x + dx, pump.y + 2, Feature.MACHINE);
    setFeature(ctx.world, pump.x + dx, pump.y + 5, Feature.APPARATUS);
  }
  setFeature(ctx.world, pump.x + 5, pump.y + 4, Feature.LAMP);
  setFeature(ctx.world, pump.x + 1, pump.y + 1, Feature.SHELF);
  setFeature(ctx.world, pump.x + 9, pump.y + 6, Feature.DESK);

  for (let dx = 1; dx < valves.w - 1; dx++) {
    const x = valves.x + dx;
    setFeature(ctx.world, x, valves.y + 1, dx % 2 === 0 ? Feature.MACHINE : Feature.APPARATUS);
    if (dx % 3 === 0) setWater(ctx.world, x, valves.y + 3);
  }
  setFeature(ctx.world, valves.x + 1, valves.y + 3, Feature.LAMP);
  setFeature(ctx.world, valves.x + valves.w - 2, valves.y + 3, Feature.LAMP);

  for (let dx = 1; dx < pump.w - 1; dx += 4) setWater(ctx.world, pump.x + dx, pump.y + pump.h - 2);

  spawnPlotNpc(ctx, 'ag04_pressure_boris', BORIS_DEF, pump.x + 5, pump.y + 5, Math.PI);
  spawnAmbientNpc(
    ctx, 'Раиса Клапанная', Faction.CITIZEN, Occupation.ELECTRICIAN,
    valves.x + 2, valves.y + 2,
    [{ defId: 'flashlight', count: 1 }, { defId: 'note', count: 1 }],
  );

  dropItems(ctx, pump, ['wrench', 'pipe', 'ammo_fuel', 'water', 'bandage', 'note']);
  dropItems(ctx, valves, ['wrench', 'ammo_nails', 'flashlight', 'water']);

  spawnMonstersNear(ctx, pump.x + 5, pump.y + 4, [
    MonsterKind.REBAR, MonsterKind.POLZUN, MonsterKind.SBORKA,
  ]);

  // Keep pressure story visible even if the room is inspected only via map.
  for (const room of [pump, valves]) {
    for (const doorIdx of room.doors) {
      if (ctx.world.cells[doorIdx] === Cell.DOOR) ctx.world.wallTex[doorIdx] = Tex.PIPE;
    }
  }
}
