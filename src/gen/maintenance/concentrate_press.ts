/* ── AG18 concentrate press — factory loop without factory sim ── */

import {
  Cell,
  ContainerKind,
  Feature,
  FloorLevel,
  Faction,
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

const CONTENT_TAG = 'concentrate_press';
const OUTPUT_TAG = 'concentrate_press_output';
const QUARANTINE_TAG = 'concentrate_press_quarantine';

const MASTER_DEF: PlotNpcDef = {
  name: 'Инна Прессова',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.MECHANIC,
  sprite: Occupation.MECHANIC,
  hp: 135, maxHp: 135, money: 80, speed: 0.95,
  inventory: [
    { defId: 'wrench', count: 1 },
    { defId: 'gear', count: 1 },
    { defId: 'grey_briquette', count: 1 },
  ],
  talkLines: [
    'Инна Прессова. Линия не сломалась, она выразила отношение к плану.',
    'Слева сырье, справа брикеты. Между ними шум, пар и люди с плохими зубами.',
    'Принеси шестерни. Без них пресс давит только пальцы.',
  ],
  talkLinesPost: [
    'Пресс держит ритм. Пока он стучит, очередь наверху ест.',
    'Не бери брак из карантина. Он теплый не от печи.',
  ],
};

const INPUT_DEF: PlotNpcDef = {
  name: 'Роман Дозатор',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.COOK,
  sprite: Occupation.COOK,
  hp: 105, maxHp: 105, money: 45, speed: 1.0,
  inventory: [
    { defId: 'filter_layer', count: 1 },
    { defId: 'metal_water', count: 1 },
  ],
  talkLines: [
    'Роман Дозатор. Меряю массу ковшом, потому что весы боятся правды.',
    'Фильтрующий слой нужен не для чистоты. Он чтобы брикет держал форму.',
    'Если вода пахнет железом, значит годится для концентрата.',
  ],
  talkLinesPost: [
    'Слой пошел в дозатор. Теперь брикет хотя бы выглядит законно.',
    'Отдел качества сказал: меньше смотреть на цвет.',
  ],
};

const GUARD_DEF: PlotNpcDef = {
  name: 'Старшина Клин',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 180, maxHp: 180, money: 90, speed: 1.15,
  inventory: [
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 10 },
    { defId: 'bandage', count: 1 },
  ],
  talkLines: [
    'Клин. Ликвидаторы держат пресс, потому что голодные люди дерутся хуже вооруженных.',
    'В брак-зоне скребет арматура. Если она дойдет до валов, пайки станут осколками.',
    'Хочешь помочь — бей то, что шевелится против смены.',
  ],
  talkLinesPost: [
    'Линия отбилась. Охрана считает это победой, бухгалтерия — задержкой.',
    'Патроны дешевле голодного бунта.',
  ],
};

const THIEF_DEF: PlotNpcDef = {
  name: 'Лёва Бракованный',
  isFemale: false,
  faction: Faction.WILD,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 120, maxHp: 120, money: 25, speed: 1.05,
  inventory: [
    { defId: 'knife', count: 1 },
    { defId: 'cigs', count: 2 },
  ],
  talkLines: [
    'Лёва Бракованный. У хорошего склада есть два выхода: официальный и мой.',
    'Серые брикеты все равно уйдут тем, кто громче кричит. Мы просто кричим ножом.',
    'Принесешь партию — расскажу, где смена закрывает глаза.',
  ],
  talkLinesPost: [
    'Вот теперь склад дышит свободнее.',
    'Не трогай зеленые. Они иногда трогают в ответ.',
  ],
};

function contentTags(extra: readonly string[] = []): string[] {
  const tags = [CONTENT_TAG];
  for (const tag of extra) if (!tags.includes(tag)) tags.push(tag);
  return tags;
}

registerSideQuest('ag18_press_master', MASTER_DEF, [{
  id: 'ag18_repair_concentrate_line',
  giverNpcId: 'ag18_press_master',
  type: QuestType.FETCH,
  desc: 'Инна: «Две шестерни на главный вал. Починим линию, пока ее не закрыли как опасный объект.»',
  targetItem: 'gear', targetCount: 2,
  rewardItem: 'door_kit', rewardCount: 1,
  extraRewards: [{ defId: 'grey_briquette', count: 3 }],
  relationDelta: 12, xpReward: 55, moneyReward: 65,
}]);

registerSideQuest('ag18_press_input', INPUT_DEF, [{
  id: 'ag18_deliver_filter_input',
  giverNpcId: 'ag18_press_input',
  type: QuestType.FETCH,
  desc: 'Роман: «Четыре фильтрующих слоя в дозатор. Без них масса расползается как протокол без подписи.»',
  targetItem: 'filter_layer', targetCount: 4,
  rewardItem: 'grey_briquette', rewardCount: 4,
  extraRewards: [{ defId: 'filtered_water', count: 1 }],
  relationDelta: 10, xpReward: 45, moneyReward: 35,
}]);

registerSideQuest('ag18_press_guard', GUARD_DEF, [{
  id: 'ag18_defend_press_rebar',
  giverNpcId: 'ag18_press_guard',
  type: QuestType.KILL,
  desc: 'Клин: «Арматура идет к валам. Одну убери, пока она не стала деталью пресса.»',
  targetMonsterKind: MonsterKind.REBAR,
  killNeeded: 1,
  rewardItem: 'gasmask_filter', rewardCount: 1,
  extraRewards: [{ defId: 'ammo_9mm', count: 12 }],
  relationDelta: 14, xpReward: 65, moneyReward: 80,
}]);

registerSideQuest('ag18_press_thief', THIEF_DEF, [{
  id: 'ag18_steal_press_output',
  giverNpcId: 'ag18_press_thief',
  type: QuestType.FETCH,
  desc: 'Лёва: «Четыре серых брикета со склада выхода. Назовем это перераспределением шума.»',
  targetItem: 'grey_briquette', targetCount: 4,
  rewardItem: 'knife', rewardCount: 1,
  extraRewards: [{ defId: 'cigs', count: 3 }],
  relationDelta: 8, xpReward: 45, moneyReward: 40,
}]);

function setDoorMetal(ctx: MaintContentCtx, rooms: { doors: number[] }[]): void {
  for (const room of rooms) {
    for (const doorIdx of room.doors) {
      if (ctx.world.cells[doorIdx] === Cell.DOOR) ctx.world.wallTex[doorIdx] = Tex.DOOR_METAL;
    }
  }
}

function contaminateWaste(ctx: MaintContentCtx, x: number, y: number): void {
  let dirty = false;
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = 0; dx < 4; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      setWater(ctx.world, tx, ty);
      const ci = ctx.world.idx(tx, ty);
      ctx.world.fog[ci] = 150 + ((dx + dy * 3) % 80);
      dirty = true;
    }
  }
  if (dirty) ctx.world.markFogDirty();
}

function nextContainerId(ctx: MaintContentCtx & { _nextContainerId?: number }): number {
  if (ctx._nextContainerId === undefined) {
    let maxId = 0;
    for (const id of ctx.world.containerById.keys()) {
      if (id > maxId) maxId = id;
    }
    for (const c of ctx.world.containers) {
      if (c.id > maxId) maxId = c.id;
    }
    ctx._nextContainerId = maxId + 1;
  } else {
    ctx._nextContainerId++;
  }
  return ctx._nextContainerId;
}

function addPressContainer(
  ctx: MaintContentCtx,
  room: Room,
  x: number,
  y: number,
  container: Omit<WorldContainer, 'id' | 'x' | 'y' | 'floor' | 'roomId' | 'zoneId'>,
): WorldContainer {
  const wx = ctx.world.wrap(x);
  const wy = ctx.world.wrap(y);
  const ci = ctx.world.idx(wx, wy);
  const full: WorldContainer = {
    id: nextContainerId(ctx),
    x: wx,
    y: wy,
    floor: FloorLevel.MAINTENANCE,
    roomId: room.id,
    zoneId: ctx.world.zoneMap[ci],
    ...container,
  };
  ctx.world.addContainer(full);
  setFeature(ctx.world, wx, wy, Feature.SHELF);
  return full;
}

function addPressContainers(ctx: MaintContentCtx, press: Room, waste: Room, masterId: number, guardId: number): void {
  addPressContainer(ctx, press, press.x + press.w - 3, press.y + 2, {
    kind: ContainerKind.METAL_CABINET,
    name: 'Выходной шкаф линии концентрата',
    inventory: [
      { defId: 'grey_briquette', count: 4 },
      { defId: 'concentrate_coupon', count: 1 },
      { defId: 'gasmask_filter', count: 1 },
    ],
    capacitySlots: 10,
    ownerNpcId: masterId,
    ownerName: MASTER_DEF.name,
    faction: Faction.CITIZEN,
    access: 'owner',
    discovered: true,
    factoryId: 'concentrate_press',
    tags: contentTags([OUTPUT_TAG, 'production_output', 'food', 'legal_output', 'theft']),
  });

  addPressContainer(ctx, waste, waste.x + waste.w - 2, waste.y + 1, {
    kind: ContainerKind.METAL_CABINET,
    name: 'Карантинный шкаф зелёной партии',
    inventory: [
      { defId: 'green_briquette', count: 2 },
      { defId: 'experimental_concentrate', count: 1 },
      { defId: 'acid_bottle', count: 1 },
      { defId: 'rawmeat', count: 1 },
    ],
    capacitySlots: 8,
    ownerNpcId: guardId,
    ownerName: GUARD_DEF.name,
    faction: Faction.LIQUIDATOR,
    access: 'owner',
    discovered: true,
    tags: contentTags([QUARANTINE_TAG, 'quarantine', 'bad_batch', 'food', 'theft']),
  });
}

export function generateConcentratePress(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 39, 14, 55, 155);

  const input = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.STORAGE,
    pos.x, pos.y + 2, 9, 7,
    'Сырьевой склад концентрата',
    Tex.METAL, Tex.F_CONCRETE,
  );
  const press = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.PRODUCTION,
    pos.x + 10, pos.y, 18, 11,
    'Брикетный цех: линия концентрата',
    Tex.PIPE, Tex.F_CONCRETE,
  );
  const waste = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.STORAGE,
    pos.x + 29, pos.y + 3, 8, 6,
    'Брак после самосбора: карантин линии',
    Tex.ROTTEN, Tex.F_WATER,
  );

  placeDoor(ctx.world, input, press, '', false);
  placeDoor(ctx.world, press, waste, '', false);
  setDoorMetal(ctx, [input, press, waste]);

  for (let dy = 1; dy < input.h - 1; dy++) {
    setFeature(ctx.world, input.x + 1, input.y + dy, Feature.SHELF);
    if (dy % 2 === 0) setFeature(ctx.world, input.x + input.w - 2, input.y + dy, Feature.SHELF);
  }
  setFeature(ctx.world, input.x + 4, input.y + 3, Feature.LAMP);

  for (let dx = 2; dx < press.w - 2; dx += 3) {
    setFeature(ctx.world, press.x + dx, press.y + 3, Feature.MACHINE);
    setFeature(ctx.world, press.x + dx, press.y + 6, Feature.APPARATUS);
  }
  setFeature(ctx.world, press.x + 2, press.y + press.h - 2, Feature.DESK);
  setFeature(ctx.world, press.x + press.w - 3, press.y + 2, Feature.SHELF);
  setFeature(ctx.world, press.x + press.w - 3, press.y + 7, Feature.SHELF);
  setFeature(ctx.world, press.x + 5, press.y + 5, Feature.LAMP);
  setFeature(ctx.world, press.x + 12, press.y + 5, Feature.LAMP);
  setWater(ctx.world, press.x + 8, press.y + 8);
  setWater(ctx.world, press.x + 9, press.y + 8);

  setFeature(ctx.world, waste.x + 1, waste.y + 1, Feature.APPARATUS);
  setFeature(ctx.world, waste.x + waste.w - 2, waste.y + 1, Feature.SHELF);
  setFeature(ctx.world, waste.x + 4, waste.y + 4, Feature.LAMP);
  contaminateWaste(ctx, waste.x + 2, waste.y + 2);

  const masterId = ctx.nextId.v;
  spawnPlotNpc(ctx, 'ag18_press_master', MASTER_DEF, press.x + 3, press.y + 8, 0);
  spawnPlotNpc(ctx, 'ag18_press_input', INPUT_DEF, input.x + 5, input.y + 4, Math.PI / 2);
  const guardId = ctx.nextId.v;
  spawnPlotNpc(ctx, 'ag18_press_guard', GUARD_DEF, press.x + 14, press.y + 8, Math.PI);
  spawnPlotNpc(ctx, 'ag18_press_thief', THIEF_DEF, waste.x + 5, waste.y + 4, -Math.PI / 2);

  addPressContainers(ctx, press, waste, masterId, guardId);

  dropItems(ctx, input, [
    'filter_layer', 'filter_layer', 'metal_water', 'rawmeat',
    'water', 'fuse', 'gear', 'concentrate_coupon',
  ]);
  dropItems(ctx, press, [
    'grey_briquette', 'grey_briquette', 'grey_briquette', 'grey_briquette',
    'wrench', 'gear', 'gasmask_filter', 'note',
  ]);
  dropItems(ctx, waste, [
    'green_briquette', 'rawmeat', 'acid_bottle', 'strange_clot', 'meat_rune',
  ]);

  spawnMonstersNear(ctx, press.x + 13, press.y + 6, [
    MonsterKind.ROBOT, MonsterKind.REBAR, MonsterKind.SBORKA,
  ], 4, 9);
}
