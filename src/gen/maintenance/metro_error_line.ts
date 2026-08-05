/* ── AG19 Metro Error Line — platform pocket in maintenance ───── */

import {
  W,
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
  METRO_DEPOT_ROOM_NAME,
  METRO_ERROR_ROOM_NAME,
  METRO_STATION_ROOM_NAME,
  metroRoutesForRoom,
} from '../../data/metro';
import {
  type MaintContentCtx, dropItems, findMaintArea, openTile, setFeature,
  setWater, spawnMonstersNear, spawnPlotNpc, stampMaintRoom,
} from './content_helpers';

const ZHANNA_DEF: PlotNpcDef = {
  name: 'Жанна Жетонная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 130, maxHp: 130, money: 90, speed: 0.9,
  inventory: [
    { defId: 'metro_ticket', count: 4 },
    { defId: 'tea', count: 1 },
    { defId: 'fake_pass', count: 1 },
  ],
  talkLines: [
    'Билет не покупают. Билет доказывают.',
    'Смотри на табло, не слушай голос. Голос иногда идет с другой станции.',
    'Схема лифтов снижает ошибку, но не отменяет характер линии.',
  ],
  talkLinesPost: [
    'Жетоны звенят громче, когда поезд врет.',
    'Если турникет остывает, не спорь. Жди.',
  ],
};

const BORYA_DEF: PlotNpcDef = {
  name: 'Боря Сцепщик',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.MECHANIC,
  sprite: Occupation.MECHANIC,
  hp: 160, maxHp: 160, money: 55, speed: 0.95,
  inventory: [
    { defId: 'wrench', count: 1 },
    { defId: 'fuse', count: 1 },
    { defId: 'metro_ticket', count: 2 },
  ],
  talkLines: [
    'Я сцепщик без состава. Тут это нормальная должность.',
    'Красная нижняя ходит быстрее всех. Поэтому чаще всего приезжает не туда.',
    'Рукоять стрелки тяжелее предохранителя. Без неё маршрут спорит с рукой.',
  ],
  talkLinesPost: [
    'Если лампа над третьим табло моргнула дважды — держи оружие ближе.',
    'Депо без рельсов есть. Рельсы туда не согласились.',
  ],
  talkQuestResponse: 'Пассажир дошел? Хорошо. Теперь пусть стоит у стены и не повторяет номер вагона вслух.',
};

const LOST_DEF: PlotNpcDef = {
  name: 'Лида Не-та',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.TRAVELER,
  sprite: Occupation.TRAVELER,
  hp: 90, maxHp: 90, money: 12, speed: 1.1,
  inventory: [
    { defId: 'child_map', count: 1 },
    { defId: 'water', count: 1 },
  ],
  talkLines: [
    'Я ехала к кухне, а вышла к трубам. Или наоборот.',
    'На билете станция была написана моим почерком. Я точно не писала.',
    'Отведите меня к сцепщику. Он хотя бы делает вид, что понимает расписание.',
  ],
  talkLinesPost: [
    'Я больше не читаю табло вслух.',
    'Если поезд спросит имя, молчите.',
  ],
};

registerSideQuest('ag19_zhanna_ticket', ZHANNA_DEF, [
  {
    id: 'ag19_ticket_proof',
    giverNpcId: 'ag19_zhanna_ticket',
    type: QuestType.FETCH,
    desc: 'Жанна: «Два билета метро принеси. Один примет турникет, второй докажет, что первый был не сном.»',
    targetItem: 'metro_ticket', targetCount: 2,
    rewardItem: 'lift_scheme', rewardCount: 1,
    extraRewards: [{ defId: 'fake_pass', count: 1 }],
    relationDelta: 10, xpReward: 45, moneyReward: 30,
  },
]);

registerSideQuest('ag19_borya_conductor', BORYA_DEF, [
  {
    id: 'ag19_switch_handle',
    giverNpcId: 'ag19_borya_conductor',
    type: QuestType.FETCH,
    desc: 'Боря: «Рукоять стрелочного перевода принеси. Предохранитель найдём, а без рукояти поезд сам выбирает, кого наказать.»',
    targetItem: 'rail_switch_handle', targetCount: 1,
    rewardItem: 'metro_ticket', rewardCount: 3,
    extraRewards: [{ defId: 'clean_health_cert', count: 1 }, { defId: 'wrench', count: 1 }],
    relationDelta: 12, xpReward: 55, moneyReward: 45,
  },
  {
    id: 'ag19_signal_lamp',
    giverNpcId: 'ag19_borya_conductor',
    type: QuestType.FETCH,
    desc: 'Боря: «Сигнальную лампу депо принеси. Белый обратный огонь без неё моргает как чужой глаз.»',
    targetItem: 'rail_signal_lamp', targetCount: 1,
    rewardItem: 'fuse', rewardCount: 1,
    extraRewards: [{ defId: 'metro_ticket', count: 1 }],
    relationDelta: 8, xpReward: 35, moneyReward: 25,
    requiresSideQuestDone: 'ag19_switch_handle',
    eventTags: ['metro_error_line', 'rail_signal_lamp', 'repair', 'transport'],
    eventData: { repair: 'depot_signal_lamp' },
  },
]);

registerSideQuest('ag19_lost_passenger', LOST_DEF, [
  {
    id: 'ag19_lost_passenger_to_conductor',
    giverNpcId: 'ag19_lost_passenger',
    type: QuestType.TALK,
    desc: 'Лида: «Проведите меня к Боре Сцепщику. Я больше не хочу быть остановкой.»',
    targetNpcId: 'ag19_borya_conductor',
    rewardItem: 'metro_ticket', rewardCount: 1,
    extraRewards: [{ defId: 'water', count: 1 }],
    relationDelta: 10, xpReward: 40, moneyReward: 20,
  },
]);

export function generateMetroErrorLine(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const found = findMaintArea(ctx.world, cx, cy, 36, 18, 55, 145);
  const pos = { x: Math.min(found.x, W - 42), y: Math.min(found.y, W - 24) };

  const platform = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.CORRIDOR,
    pos.x, pos.y, 17, 9,
    METRO_STATION_ROOM_NAME,
    Tex.METAL, Tex.F_CONCRETE,
  );
  const depot = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.PRODUCTION,
    pos.x + 21, pos.y + 1, 12, 7,
    METRO_DEPOT_ROOM_NAME,
    Tex.PIPE, Tex.F_CONCRETE,
  );
  const errorPocket = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.COMMON,
    pos.x + 3, pos.y + 12, 13, 5,
    METRO_ERROR_ROOM_NAME,
    Tex.DARK, Tex.F_CONCRETE,
  );

  for (let x = platform.x + platform.w; x <= depot.x; x++) openTile(ctx.world, x, platform.y + 4);
  for (let y = platform.y + platform.h; y <= errorPocket.y; y++) openTile(ctx.world, platform.x + 8, y);

  for (const route of metroRoutesForRoom(METRO_STATION_ROOM_NAME)) {
    const slot = route.panelSlot;
    const x = platform.x + 2 + slot * 3;
    setFeature(ctx.world, x, platform.y + 2, Feature.SCREEN);
    setFeature(ctx.world, x, platform.y + 3, Feature.APPARATUS);
  }

  for (let dx = 1; dx < platform.w - 1; dx += 4) setFeature(ctx.world, platform.x + dx, platform.y + 6, Feature.CHAIR);
  setFeature(ctx.world, platform.x + 8, platform.y + 1, Feature.LAMP);
  setFeature(ctx.world, platform.x + 14, platform.y + 6, Feature.LAMP);
  setFeature(ctx.world, depot.x + 2, depot.y + 2, Feature.MACHINE);
  setFeature(ctx.world, depot.x + 5, depot.y + 2, Feature.APPARATUS);
  setFeature(ctx.world, depot.x + 8, depot.y + 4, Feature.DESK);
  setFeature(ctx.world, depot.x + 10, depot.y + 2, Feature.LAMP);
  setFeature(ctx.world, errorPocket.x + 2, errorPocket.y + 2, Feature.SCREEN);
  setFeature(ctx.world, errorPocket.x + 10, errorPocket.y + 2, Feature.LAMP);

  for (let dx = 1; dx < platform.w - 1; dx++) {
    const ci = ctx.world.idx(platform.x + dx, platform.y + platform.h - 2);
    if (ctx.world.cells[ci] !== Cell.LIFT) setWater(ctx.world, platform.x + dx, platform.y + platform.h - 2);
  }

  spawnPlotNpc(ctx, 'ag19_zhanna_ticket', ZHANNA_DEF, platform.x + 3, platform.y + 5, Math.PI);
  spawnPlotNpc(ctx, 'ag19_borya_conductor', BORYA_DEF, depot.x + 5, depot.y + 4, Math.PI * 0.5);
  spawnPlotNpc(ctx, 'ag19_lost_passenger', LOST_DEF, errorPocket.x + 5, errorPocket.y + 2, 0);

  dropItems(ctx, platform, ['metro_ticket', 'metro_ticket', 'note', 'water', 'cigs']);
  dropItems(ctx, depot, ['fuse', 'fuse', 'wrench', 'pipe', 'clean_health_cert', 'rail_depot_pass', 'track_diagram_scrap', 'rail_switch_handle', 'rail_signal_lamp', 'rail_spike_pack']);
  dropItems(ctx, errorPocket, ['metro_ticket', 'child_map', 'bandage']);
  spawnMonstersNear(ctx, errorPocket.x + 6, errorPocket.y + 2, [
    MonsterKind.POLZUN, MonsterKind.REBAR, MonsterKind.SBORKA,
  ], 5, 11);
}
