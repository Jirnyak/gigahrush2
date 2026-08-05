/* -- FLOOR16 collectors pressure reroute: water choice and eel work -- */

import {
  AIGoal, Cell, ContainerKind, EntityType, Faction, Feature, FloorLevel,
  MonsterKind, Occupation, QuestType, RoomType, Tex,
  msg,
  type Entity, type GameState, type Room, type WorldContainer,
} from '../../core/types';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { changeResourceStock } from '../../systems/economy';
import { getRecentEvents, publishEvent, registerWorldEventObserver } from '../../systems/events';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  type MaintContentCtx, dropItems, findMaintArea, openTile, setFeature,
  setWater, spawnMonstersNear, spawnPlotNpc, stampMaintRoom,
} from './content_helpers';

const CHOICE_TAG = 'floor16_collectors_choice';
const DRAIN_LIVING_QUEST = 'floor16_collectors_drain_living';
const DRAIN_KVARTIRY_QUEST = 'floor16_collectors_drain_kvartiry';
const VALVE_ROOM = 'Коллекторный узел 16: развилка стояков';
const MAP_ROOM = 'Мокрая картотека затопленных ходов';
const HUNTER_ROOM = 'Слепой пост охотника на угрей';
const FILTER_ROOM = 'Фильтровый прогон: сухая полка';
const DEBTOR_ROOM = 'Карманы водного должника';

const VARYA_DEF: PlotNpcDef = {
  name: 'Варя Напорная',
  isFemale: true,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.DIRECTOR,
  sprite: Occupation.DIRECTOR,
  hp: 170, maxHp: 170, money: 120, speed: 0.95,
  inventory: [
    { defId: 'official_permit_slip', count: 1 },
    { defId: 'pressure_logbook', count: 1 },
    { defId: 'makarov', count: 1 },
  ],
  talkLines: [
    'Варя Напорная. У меня два стояка и один рычаг: Жилая зона пьет, Квартиры сушатся, или наоборот.',
    'Нужны две бирки вентиля. Без бирок вода считается слухом и течет куда хочет.',
    'Мост давления держит только честный манометр. Принесешь стрелку - открою сухую перемычку по акту.',
  ],
  talkLinesPost: [
    'Первый сброс записан. Второй рычаг теперь только для красивых слов.',
    'Если кто-то наверху ругается на воду, значит давление дошло.',
  ],
};

const CARTOGRAPHER_DEF: PlotNpcDef = {
  name: 'Утонувший Картограф',
  isFemale: false,
  faction: Faction.SCIENTIST,
  occupation: Occupation.TRAVELER,
  sprite: Occupation.TRAVELER,
  hp: 115, maxHp: 115, money: 45, speed: 1.05,
  inventory: [
    { defId: 'caravan_route', count: 1 },
    { defId: 'filter_receipt', count: 1 },
    { defId: 'water', count: 1 },
  ],
  talkLines: [
    'Я картограф. Утонул не весь: руки еще рисуют, ноги уже верят воде.',
    'В мокрой картотеке маршруты всплывают только при лампе. Проверь стенд и не наступай на блеск.',
    'Фильтры нужны наверх. Грязная вода тоже вода, но без фильтра очередь начинает кашлять.',
  ],
  talkLinesPost: [
    'Карта подсохла по краям. Этого хватит, чтобы уйти и вернуться не тем же человеком.',
    'Фильтры дошли до учета. Воду выдали отдельно, по мокрой квитанции.',
  ],
};

const ILYAS_DEF: PlotNpcDef = {
  name: 'Ильяс Угревик',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 185, maxHp: 185, money: 90, speed: 1.15,
  inventory: [
    { defId: 'harpoon_gun', count: 1 },
    { defId: 'ammo_harpoon', count: 3 },
    { defId: 'bandage', count: 1 },
  ],
  talkLines: [
    'Ильяс Угревик. Угорь в воде быстрый, на бетоне злой, но уже честный.',
    'Не лезь за ним в лоток. Вымани к сухой кромке и бей, пока он считает воздух ошибкой.',
    'Три угря - и я отдам гарпуны без спора. Меньше трех - это не охота, это знакомство.',
  ],
  talkLinesPost: [
    'Лоток притих. Значит, или угри кончились, или стали умнее.',
    'Гарпуны береги. Вода любит тех, кто экономит патроны.',
  ],
};

const DEBTOR_DEF: PlotNpcDef = {
  name: 'Федя Срывпломба',
  isFemale: false,
  faction: Faction.WILD,
  occupation: Occupation.LOCKSMITH,
  sprite: Occupation.LOCKSMITH,
  hp: 120, maxHp: 120, money: 35, speed: 1.05,
  inventory: [
    { defId: 'valve_tag', count: 1 },
    { defId: 'sealant_tube', count: 1 },
    { defId: 'water_coupon', count: 1 },
  ],
  talkLines: [
    'Федя Срывпломба. Деталь не украдена, она временно спасена от начальства.',
    'Дашь талоны - перекину напор в квартирный стояк. Жилая зона будет кашлять краном, зато бунт стихнет.',
    'Герметик принесешь - верну часть пломбы. Не всю: мне тоже надо чем-то жить.',
  ],
  talkLinesPost: [
    'Пломба держится на честном слове. Моем, но честном.',
    'Если Варя спросит, я здесь был до аварии и после отчета.',
  ],
};

registerSideQuest('collectors_pressure_boss_varya', VARYA_DEF, [
  {
    id: DRAIN_LIVING_QUEST,
    giverNpcId: 'collectors_pressure_boss_varya',
    type: QuestType.FETCH,
    desc: 'Варя: «Две бирки вентиля - и я открываю Жилую магистраль. Жилая зона получит воду, Квартиры потеряют напор.»',
    targetItem: 'valve_tag', targetCount: 2,
    rewardItem: 'official_permit_slip', rewardCount: 1,
    extraRewards: [{ defId: 'filtered_water', count: 2 }, { defId: 'pressure_logbook', count: 1 }],
    relationDelta: 16, xpReward: 75, moneyReward: 70,
  },
  {
    id: 'floor16_collectors_pressure_bridge',
    giverNpcId: 'collectors_pressure_boss_varya',
    type: QuestType.FETCH,
    desc: 'Варя: «Манометр на мост давления. Без стрелки сухая перемычка считается мокрой легендой.»',
    targetItem: 'manometer', targetCount: 1,
    rewardItem: 'pump_passport', rewardCount: 1,
    extraRewards: [{ defId: 'ammo_harpoon', count: 2 }, { defId: 'sealant_tube', count: 1 }],
    relationDelta: 12, xpReward: 60, moneyReward: 55,
  },
]);

registerSideQuest('collectors_drowned_cartographer', CARTOGRAPHER_DEF, [
  {
    id: 'floor16_collectors_flooded_map',
    giverNpcId: 'collectors_drowned_cartographer',
    type: QuestType.VISIT,
    desc: 'Картограф: «Проверь мокрую картотеку {dir}. Там маршрут всплыл, пока его не съели угри.»',
    targetRoomName: MAP_ROOM,
    rewardItem: 'caravan_route', rewardCount: 1,
    extraRewards: [{ defId: 'water_coupon', count: 1 }],
    relationDelta: 8, xpReward: 35, moneyReward: 20,
  },
  {
    id: 'floor16_collectors_filter_run',
    giverNpcId: 'collectors_drowned_cartographer',
    type: QuestType.FETCH,
    desc: 'Картограф: «Два фильтра в учет. Наверх отнесём чистую выдачу, а не мокрое объяснение.»',
    targetItem: 'gasmask_filter', targetCount: 2,
    rewardItem: 'filtered_water', rewardCount: 3,
    extraRewards: [{ defId: 'filter_receipt', count: 1 }, { defId: 'bandage', count: 1 }],
    relationDelta: 14, xpReward: 70, moneyReward: 60,
  },
]);

registerSideQuest('collectors_tube_hunter_ilyas', ILYAS_DEF, [
  {
    id: 'floor16_collectors_hunt_tube_eel',
    giverNpcId: 'collectors_tube_hunter_ilyas',
    type: QuestType.KILL,
    desc: 'Ильяс: «Три трубных угря в лотке. Стреляй с сухого края, жабры из себя не строй.»',
    targetMonsterKind: MonsterKind.TUBE_EEL,
    killNeeded: 3,
    rewardItem: 'harpoon_gun', rewardCount: 1,
    extraRewards: [{ defId: 'ammo_harpoon', count: 6 }, { defId: 'filtered_water', count: 1 }],
    relationDelta: 16, xpReward: 90, moneyReward: 85,
  },
]);

registerSideQuest('collectors_water_debtor', DEBTOR_DEF, [
  {
    id: DRAIN_KVARTIRY_QUEST,
    giverNpcId: 'collectors_water_debtor',
    type: QuestType.FETCH,
    desc: 'Федя: «Два водных талона - и я перекину напор в Квартиры. Квартиры напьются, Жилая зона потеряет давление.»',
    targetItem: 'water_coupon', targetCount: 2,
    rewardItem: 'valve_tag', rewardCount: 2,
    extraRewards: [{ defId: 'metal_water', count: 2 }, { defId: 'sealant_tube', count: 1 }],
    relationDelta: 10, xpReward: 70, moneyReward: 65,
  },
  {
    id: 'floor16_collectors_stolen_parts',
    giverNpcId: 'collectors_water_debtor',
    type: QuestType.FETCH,
    desc: 'Федя: «Два герметика за украденную пломбу. Назовем это ремонтом, пока Варя не открыла шкаф.»',
    targetItem: 'sealant_tube', targetCount: 2,
    rewardItem: 'pump_passport', rewardCount: 1,
    extraRewards: [{ defId: 'valve_tag', count: 1 }, { defId: 'metal_sheet', count: 1 }],
    relationDelta: 8, xpReward: 50, moneyReward: 45,
  },
]);

interface DrainEffect {
  choiceId: string;
  benefitFloor: FloorLevel;
  benefitFloorId: string;
  benefitName: string;
  shortageFloor: FloorLevel;
  shortageFloorId: string;
  shortageName: string;
  benefitDelta: number;
  shortageDelta: number;
  message: string;
}

function drainEffect(sideQuestId: string): DrainEffect | undefined {
  if (sideQuestId === DRAIN_LIVING_QUEST) {
    return {
      choiceId: 'collectors_to_living',
      benefitFloor: FloorLevel.LIVING,
      benefitFloorId: 'living',
      benefitName: 'Жилая зона',
      shortageFloor: FloorLevel.KVARTIRY,
      shortageFloorId: 'kvartiry',
      shortageName: 'Квартиры',
      benefitDelta: 28,
      shortageDelta: -18,
      message: 'Сброс закреплен: Жилая зона получила воду, Квартиры потеряли напор.',
    };
  }
  if (sideQuestId === DRAIN_KVARTIRY_QUEST) {
    return {
      choiceId: 'collectors_to_kvartiry',
      benefitFloor: FloorLevel.KVARTIRY,
      benefitFloorId: 'kvartiry',
      benefitName: 'Квартиры',
      shortageFloor: FloorLevel.LIVING,
      shortageFloorId: 'living',
      shortageName: 'Жилая зона',
      benefitDelta: 26,
      shortageDelta: -16,
      message: 'Сброс закреплен: Квартиры получили напор, Жилая зона стала суше.',
    };
  }
  return undefined;
}

function drainChoiceAlreadyMade(state: GameState): boolean {
  return getRecentEvents(state, { tags: [CHOICE_TAG], limit: 1 }).length > 0;
}

function applyDrainChoice(state: GameState, sideQuestId: string): void {
  const effect = drainEffect(sideQuestId);
  if (!effect) return;
  if (drainChoiceAlreadyMade(state)) {
    state.msgs.push(msg('Коллекторный сброс уже закреплен: второй рычаг только шумит трубами.', state.time, '#888'));
    return;
  }

  const raised = changeResourceStock(state, 'drink_water', effect.benefitDelta, effect.benefitFloor);
  const lowered = changeResourceStock(state, 'drink_water', effect.shortageDelta, effect.shortageFloor);

  publishEvent(state, {
    type: 'room_lacked_resources',
    floor: effect.shortageFloor,
    targetName: effect.shortageName,
    itemId: 'water',
    itemName: 'питьевая вода',
    severity: 4,
    privacy: 'local',
    tags: [
      'collectors', 'water', 'pressure', 'scarcity', 'access', CHOICE_TAG,
      effect.choiceId, `target_floor:${effect.benefitFloorId}`, `scarcity_floor:${effect.shortageFloorId}`,
    ],
    data: {
      sideQuestId,
      choiceId: effect.choiceId,
      resourceId: 'drink_water',
      benefitFloorId: effect.benefitFloorId,
      benefitFloorName: effect.benefitName,
      shortageFloorId: effect.shortageFloorId,
      shortageFloorName: effect.shortageName,
      benefitDelta: effect.benefitDelta,
      shortageDelta: effect.shortageDelta,
      raised,
      lowered,
    },
  });
  state.msgs.push(msg(effect.message, state.time, '#6cf'));
}

function handleCollectorsDrainChoice(state: GameState, event: { type: string; data?: Record<string, unknown> }): void {
  if (event.type !== 'quest_completed') return;
  const sideQuestId = event.data?.sideQuestId;
  if (typeof sideQuestId === 'string') applyDrainChoice(state, sideQuestId);
}

registerWorldEventObserver(handleCollectorsDrainChoice);

function nextContainerId(ctx: MaintContentCtx & { _maxContainerId?: number }): number {
  if (ctx._maxContainerId === undefined) {
    let max = 0;
    for (const c of ctx.world.containers) if (c.id > max) max = c.id;
    ctx._maxContainerId = max;
  }
  return ++ctx._maxContainerId;
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

function spawnWaterEel(ctx: MaintContentCtx, x: number, y: number): void {
  const ci = ctx.world.idx(x, y);
  if (ctx.world.cells[ci] !== Cell.WATER) return;
  const def = MONSTERS[MonsterKind.TUBE_EEL];
  if (!def) return;
  const zid = ctx.world.zoneMap[ci];
  const zoneLevel = (zid >= 0 && ctx.world.zones[zid]) ? (ctx.world.zones[zid].level ?? 5) : 5;
  const hp = scaleMonsterHp(def.hp, zoneLevel);
  const eel: Entity = {
    id: ctx.nextId.v++, type: EntityType.MONSTER,
    x: x + 0.5, y: y + 0.5,
    angle: Math.random() * Math.PI * 2, pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: def.sprite,
    hp, maxHp: hp,
    monsterKind: MonsterKind.TUBE_EEL,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
  };
  ctx.entities.push(eel);
}

function connectRooms(ctx: MaintContentCtx, valves: Room, map: Room, hunter: Room, filter: Room, debtor: Room): void {
  const upperY = valves.y + 4;
  for (let x = valves.x + valves.w - 1; x <= hunter.x + 2; x++) openTile(ctx.world, x, upperY);

  const lowerY = filter.y + 3;
  for (let y = upperY; y <= lowerY; y++) openTile(ctx.world, map.x + 3, y);
  for (let x = map.x + 3; x <= debtor.x + 2; x++) openTile(ctx.world, x, lowerY);
  for (let y = upperY; y <= lowerY; y++) openTile(ctx.world, hunter.x + 2, y);
}

function dressValveRoom(ctx: MaintContentCtx, room: Room): void {
  for (let dx = 2; dx < room.w - 2; dx += 2) {
    setFeature(ctx.world, room.x + dx, room.y + 2, dx % 4 === 0 ? Feature.MACHINE : Feature.APPARATUS);
    setFeature(ctx.world, room.x + dx, room.y + 6, dx % 4 === 0 ? Feature.APPARATUS : Feature.MACHINE);
  }
  for (let dx = 1; dx < room.w - 1; dx++) {
    if (dx !== 4 && dx !== 10) setWater(ctx.world, room.x + dx, room.y + room.h - 2);
  }
  setFeature(ctx.world, room.x + 2, room.y + 1, Feature.SCREEN);
  setFeature(ctx.world, room.x + 7, room.y + 1, Feature.LAMP);
  setFeature(ctx.world, room.x + 12, room.y + 1, Feature.SCREEN);
  setFeature(ctx.world, room.x + 3, room.y + 4, Feature.LIFT_BUTTON);
  setFeature(ctx.world, room.x + 11, room.y + 4, Feature.LIFT_BUTTON);
}

function dressMapRoom(ctx: MaintContentCtx, room: Room): void {
  for (let dx = 1; dx < room.w - 1; dx++) {
    setFeature(ctx.world, room.x + dx, room.y + 1, dx % 2 === 0 ? Feature.SCREEN : Feature.DESK);
  }
  for (let dx = 2; dx < room.w - 2; dx += 2) setWater(ctx.world, room.x + dx, room.y + room.h - 2);
  setFeature(ctx.world, room.x + 2, room.y + 4, Feature.LAMP);
  setFeature(ctx.world, room.x + room.w - 3, room.y + 4, Feature.SHELF);
}

function dressHunterRoom(ctx: MaintContentCtx, room: Room): void {
  setFeature(ctx.world, room.x + 2, room.y + 2, Feature.DESK);
  setFeature(ctx.world, room.x + 3, room.y + 2, Feature.LAMP);
  for (let dy = 2; dy < room.h - 2; dy++) {
    setFeature(ctx.world, room.x + room.w - 2, room.y + dy, Feature.SHELF);
  }
  setWater(ctx.world, room.x + 1, room.y + room.h - 2);
  setWater(ctx.world, room.x + 2, room.y + room.h - 2);
}

function dressFilterRoom(ctx: MaintContentCtx, room: Room): void {
  for (let dx = 2; dx < room.w - 2; dx += 3) {
    setFeature(ctx.world, room.x + dx, room.y + 2, Feature.APPARATUS);
    setFeature(ctx.world, room.x + dx, room.y + 5, Feature.MACHINE);
  }
  for (let dx = 1; dx < room.w - 1; dx++) {
    if (dx !== 3 && dx !== 8) setWater(ctx.world, room.x + dx, room.y + room.h - 2);
  }
  setFeature(ctx.world, room.x + 1, room.y + 1, Feature.LAMP);
  setFeature(ctx.world, room.x + room.w - 2, room.y + 1, Feature.SHELF);
}

function dressDebtorRoom(ctx: MaintContentCtx, room: Room): void {
  setFeature(ctx.world, room.x + 2, room.y + 2, Feature.SHELF);
  setFeature(ctx.world, room.x + 4, room.y + 2, Feature.DESK);
  setFeature(ctx.world, room.x + 7, room.y + 4, Feature.APPARATUS);
  setFeature(ctx.world, room.x + 2, room.y + room.h - 2, Feature.LAMP);
  setWater(ctx.world, room.x + room.w - 2, room.y + room.h - 2);
}

function addLockers(ctx: MaintContentCtx, valves: Room, hunter: Room, debtor: Room, varyaId: number, ilyasId: number, debtorId: number): void {
  addContainer(ctx, valves, valves.x + 13, valves.y + 2, {
    kind: ContainerKind.FILING_CABINET,
    name: 'Шкаф разрешений узла 16',
    inventory: [
      { defId: 'official_permit_slip', count: 1 },
      { defId: 'pressure_logbook', count: 1 },
      { defId: 'pump_passport', count: 1 },
      { defId: 'valve_tag', count: 1 },
      { defId: 'water_coupon', count: 1 },
    ],
    capacitySlots: 9,
    ownerNpcId: varyaId,
    ownerName: VARYA_DEF.name,
    faction: Faction.LIQUIDATOR,
    access: 'owner',
    discovered: true,
    tags: ['collectors', 'water', 'permit', 'pressure', 'theft'],
  });
  addContainer(ctx, hunter, hunter.x + hunter.w - 2, hunter.y + 2, {
    kind: ContainerKind.WEAPON_CRATE,
    name: 'Сухой ящик гарпунов',
    inventory: [
      { defId: 'ammo_harpoon', count: 5 },
      { defId: 'ammo_9mm', count: 12 },
      { defId: 'bandage', count: 1 },
      { defId: 'gasmask_filter', count: 1 },
    ],
    capacitySlots: 8,
    ownerNpcId: ilyasId,
    ownerName: ILYAS_DEF.name,
    faction: Faction.LIQUIDATOR,
    access: 'owner',
    discovered: true,
    tags: ['collectors', 'eel', 'weapon', 'hunter', 'theft'],
  });
  addContainer(ctx, debtor, debtor.x + 2, debtor.y + 2, {
    kind: ContainerKind.TOOL_LOCKER,
    name: 'Сорванный шкаф пломб',
    inventory: [
      { defId: 'valve_tag', count: 2 },
      { defId: 'sealant_tube', count: 2 },
      { defId: 'water_coupon', count: 1 },
      { defId: 'metal_sheet', count: 1 },
      { defId: 'manometer', count: 1 },
    ],
    capacitySlots: 9,
    ownerNpcId: debtorId,
    ownerName: DEBTOR_DEF.name,
    faction: Faction.WILD,
    access: 'owner',
    discovered: true,
    tags: ['collectors', 'stolen_parts', 'pressure', 'theft'],
  });
}

export function generateCollectorsPressureReroute(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 49, 24, 130, 255);

  const valves = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.PRODUCTION,
    pos.x, pos.y + 5, 15, 10,
    VALVE_ROOM,
    Tex.PIPE, Tex.F_CONCRETE,
  );
  const map = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.OFFICE,
    pos.x + 18, pos.y + 2, 12, 8,
    MAP_ROOM,
    Tex.METAL, Tex.F_CONCRETE,
  );
  const hunter = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.HQ,
    pos.x + 33, pos.y + 2, 12, 8,
    HUNTER_ROOM,
    Tex.PIPE, Tex.F_CONCRETE,
  );
  const filter = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.PRODUCTION,
    pos.x + 18, pos.y + 13, 13, 8,
    FILTER_ROOM,
    Tex.PIPE, Tex.F_CONCRETE,
  );
  const debtor = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.STORAGE,
    pos.x + 34, pos.y + 13, 11, 8,
    DEBTOR_ROOM,
    Tex.METAL, Tex.F_CONCRETE,
  );

  connectRooms(ctx, valves, map, hunter, filter, debtor);
  dressValveRoom(ctx, valves);
  dressMapRoom(ctx, map);
  dressHunterRoom(ctx, hunter);
  dressFilterRoom(ctx, filter);
  dressDebtorRoom(ctx, debtor);

  const varyaId = ctx.nextId.v;
  spawnPlotNpc(ctx, 'collectors_pressure_boss_varya', VARYA_DEF, valves.x + 5, valves.y + 4, 0, {
    weapon: 'makarov',
  });
  spawnPlotNpc(ctx, 'collectors_drowned_cartographer', CARTOGRAPHER_DEF, map.x + 3, map.y + 4, Math.PI / 2);
  const ilyasId = ctx.nextId.v;
  spawnPlotNpc(ctx, 'collectors_tube_hunter_ilyas', ILYAS_DEF, hunter.x + 4, hunter.y + 5, Math.PI, {
    weapon: 'harpoon_gun',
  });
  const debtorId = ctx.nextId.v;
  spawnPlotNpc(ctx, 'collectors_water_debtor', DEBTOR_DEF, debtor.x + 5, debtor.y + 4, -Math.PI / 2);

  addLockers(ctx, valves, hunter, debtor, varyaId, ilyasId, debtorId);

  dropItems(ctx, valves, ['valve_tag', 'pressure_logbook', 'water_coupon', 'filtered_water']);
  dropItems(ctx, map, ['caravan_route', 'filter_receipt', 'gasmask_filter', 'note']);
  dropItems(ctx, filter, ['gasmask_filter', 'gasmask_filter', 'filter_layer', 'metal_water']);
  dropItems(ctx, debtor, ['sealant_tube', 'valve_tag', 'water_coupon', 'metal_sheet']);

  spawnWaterEel(ctx, valves.x + 3, valves.y + valves.h - 2);
  spawnWaterEel(ctx, filter.x + 6, filter.y + filter.h - 2);
  spawnWaterEel(ctx, hunter.x + 1, hunter.y + hunter.h - 2);
  spawnMonstersNear(ctx, filter.x + 8, filter.y + 5, [
    MonsterKind.REBAR, MonsterKind.ROBOT, MonsterKind.POLZUN,
  ], 4, 10);
}
