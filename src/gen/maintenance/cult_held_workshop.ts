/* ── AG83 cult-held workshop: repair, bargain, clear, sabotage ── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  Cell,
  ContainerKind,
  Faction,
  Feature,
  FloorLevel,
  MonsterKind,
  Occupation,
  QuestType,
  RoomType,
  Tex,
  ZoneFaction,
  msg,
  type GameState,
  type Room,
  type WorldContainer,
  type WorldEvent,
} from '../../core/types';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { changeResourceStock } from '../../systems/economy';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { placeDoor } from '../shared';
import {
  type MaintContentCtx, dropItems, findMaintArea, setFeature, setWater,
  spawnAmbientNpc, spawnMonstersNear, spawnPlotNpc, stampMaintRoom,
} from './content_helpers';

const AG83_TAG = 'ag83_cult_workshop';
const OUTCOME_TAG = 'ag83_outcome';
const WORKSHOP_ROOM = 'Захваченная мастерская: станок дверных комплектов';
const OUTPUT_ROOM = 'Клетка готовых дверей под охраной';

const MECHANIC_ID = 'ag83_hostage_mechanic_klava';
const FOREMAN_ID = 'ag83_cult_foreman_omeljan';
const SABOTEUR_ID = 'ag83_null_phase_electrician';

const REPAIR_QUEST = 'ag83_repair_bargain_machine';
const CAPTURE_QUEST = 'ag83_clear_cult_workshop';
const TRIBUTE_QUEST = 'ag83_pay_cult_tribute';
const SABOTAGE_QUEST = 'ag83_sabotage_drive_belt';

const MECHANIC_DEF: PlotNpcDef = {
  name: 'Клава Реверс',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.MECHANIC,
  sprite: Occupation.MECHANIC,
  hp: 120,
  maxHp: 120,
  money: 48,
  speed: 0.95,
  inventory: [
    { defId: 'wrench', count: 1 },
    { defId: 'relay_diagram', count: 1 },
  ],
  talkLines: [
    'Клава Реверс. Это не вывеска для верующих, это станок. Он делает дверные комплекты, если не лить бред в ремень.',
    'Черноременные держат выходной ящик. Рабочие делают вид, что чинят, чтобы их не положили под пресс.',
    'Две шестерни в подачу - и я запущу линию. Пусть Омилян потом объясняет это как хочет.',
  ],
  talkLinesPost: [
    'Станок снова режет металл, не людей. Уже прогресс.',
    'Если услышишь ровный стук - это не культ. Это станок снова работает как цех, а не как молельня.',
  ],
};

const FOREMAN_DEF: PlotNpcDef = {
  name: 'Омилян Черноремень',
  isFemale: false,
  faction: Faction.CULTIST,
  occupation: Occupation.PRIEST,
  sprite: Occupation.PRIEST,
  hp: 210,
  maxHp: 210,
  money: 96,
  speed: 0.9,
  inventory: [
    { defId: 'meat_rune', count: 1 },
    { defId: 'green_briquette', count: 2 },
  ],
  talkLines: [
    'Станок идет от ремня, ремень идет от рубильника, а у рубильника сегодня стою я.',
    'Три серых брикета в ящик - и получишь комплект двери без драки. Это не торговля, это сменный сбор.',
    'Не трогай готовые комплекты без отметки. Ворованный металл громко звенит на выходе.',
  ],
  talkLinesPost: [
    'Сбор принят. Станок будет делать вид, что ты свой.',
    'Иди с дверью. Закрывать проемы полезнее, чем спорить с ними.',
  ],
};

const SABOTEUR_DEF: PlotNpcDef = {
  name: 'Петя Нулевая Фаза',
  isFemale: false,
  faction: Faction.WILD,
  occupation: Occupation.ELECTRICIAN,
  sprite: Occupation.ELECTRICIAN,
  hp: 105,
  maxHp: 105,
  money: 32,
  speed: 1.05,
  inventory: [
    { defId: 'fuse', count: 1 },
    { defId: 'cigs', count: 1 },
  ],
  talkLines: [
    'Петя Нулевая Фаза. Я не против станков. Я против станков, у которых охрана вместо мастера.',
    'Два предохранителя в обратную цепь - и ремень встанет без стрельбы. Рабочие переживут, охрана потеряет смену.',
    'Потом можно украсть, можно уйти. Главное - не стой рядом, когда рубильник встретится с фазой.',
  ],
  talkLinesPost: [
    'Линия заглохла. Хорошая тишина: в ней не считают людей сырьем.',
    'Культ будет искать виноватого. У них очередь длинная, можно успеть уйти.',
  ],
};

registerSideQuest(MECHANIC_ID, MECHANIC_DEF, [
  {
    id: REPAIR_QUEST,
    giverNpcId: MECHANIC_ID,
    type: QuestType.FETCH,
    desc: 'Клава Реверс: «Две шестерни в подачу. Запустим станок как цех, а не как кормушку черноременных.»',
    targetItem: 'gear',
    targetCount: 2,
    rewardItem: 'door_kit',
    rewardCount: 1,
    extraRewards: [{ defId: 'grey_briquette', count: 3 }, { defId: 'relay_diagram', count: 1 }],
    relationDelta: 14,
    xpReward: 75,
    moneyReward: 45,
  },
  {
    id: CAPTURE_QUEST,
    giverNpcId: MECHANIC_ID,
    type: QuestType.KILL,
    desc: 'Клава Реверс: «Омилян держит выходной ящик и людей. Убери его - смена заберет станок обратно.»',
    targetPlotNpcId: FOREMAN_ID,
    killNeeded: 1,
    rewardItem: 'pump_passport',
    rewardCount: 1,
    extraRewards: [{ defId: 'metal_sheet', count: 2 }, { defId: 'grey_briquette', count: 4 }],
    relationDelta: 18,
    xpReward: 105,
    moneyReward: 85,
  },
]);

registerSideQuest(FOREMAN_ID, FOREMAN_DEF, [
  {
    id: TRIBUTE_QUEST,
    giverNpcId: FOREMAN_ID,
    type: QuestType.FETCH,
    desc: 'Омилян Черноремень: «Три серых брикета как сбор за станок. Получишь дверной комплект и проход без очереди к ремню.»',
    targetItem: 'grey_briquette',
    targetCount: 3,
    rewardItem: 'door_kit',
    rewardCount: 1,
    extraRewards: [{ defId: 'concentrate_coupon', count: 2 }],
    relationDelta: 6,
    xpReward: 55,
    moneyReward: 0,
  },
]);

registerSideQuest(SABOTEUR_ID, SABOTEUR_DEF, [
  {
    id: SABOTAGE_QUEST,
    giverNpcId: SABOTEUR_ID,
    type: QuestType.FETCH,
    desc: 'Петя Нулевая Фаза: «Два предохранителя в обратную цепь. Станок встанет, охрана останется у пустого ремня.»',
    targetItem: 'fuse',
    targetCount: 2,
    rewardItem: 'relay_diagram',
    rewardCount: 1,
    extraRewards: [{ defId: 'ammo_energy', count: 1 }, { defId: 'cigs', count: 2 }],
    relationDelta: 10,
    xpReward: 70,
    moneyReward: 40,
  },
]);

interface QuestOutcome {
  kind: 'repaired' | 'captured' | 'tribute' | 'sabotaged';
  targetName: string;
  message: string;
  type: 'room_produced_items' | 'room_blocked_production' | 'faction_relation_changed';
  severity: 3 | 4 | 5;
  tags: string[];
  itemId?: string;
  itemName?: string;
  itemCount?: number;
  resourceDeltas: readonly [string, number][];
}

const QUEST_OUTCOMES: Record<string, QuestOutcome> = {
  [REPAIR_QUEST]: {
    kind: 'repaired',
    targetName: 'Станок дверных комплектов запущен рабочими.',
    message: 'Захваченная мастерская снова дает дверные комплекты смене.',
    type: 'room_produced_items',
    severity: 4,
    tags: ['repaired', 'production', 'metal_shop', 'workers'],
    itemId: 'door_kit',
    itemName: 'Комплект двери',
    itemCount: 1,
    resourceDeltas: [['tools', 8], ['metal', 5], ['labor', 6]],
  },
  [CAPTURE_QUEST]: {
    kind: 'captured',
    targetName: 'Мастерская отбита у черноременных.',
    message: 'Смена забрала станок обратно; культовый пост у линии рассыпался.',
    type: 'faction_relation_changed',
    severity: 5,
    tags: ['captured', 'cult_displaced', 'workers', 'liquidator_interest'],
    resourceDeltas: [['tools', 6], ['metal', 4], ['labor', 10], ['psi', -2]],
  },
  [TRIBUTE_QUEST]: {
    kind: 'tribute',
    targetName: 'Сбор мастерской уплачен без боя.',
    message: 'Охрана пропустила тебя к партии дверных комплектов за брикеты.',
    type: 'room_produced_items',
    severity: 3,
    tags: ['tribute', 'negotiated', 'cult_access', 'production'],
    itemId: 'door_kit',
    itemName: 'Комплект двери',
    itemCount: 1,
    resourceDeltas: [['food', -3], ['tools', 2], ['labor', 2]],
  },
  [SABOTAGE_QUEST]: {
    kind: 'sabotaged',
    targetName: 'Привод станка заглушен обратной фазой.',
    message: 'Ремень мастерской встал; охрана потеряла выпуск, но цех тоже замолчал.',
    type: 'room_blocked_production',
    severity: 4,
    tags: ['sabotaged', 'blocked', 'production', 'stealth'],
    resourceDeltas: [['tools', -7], ['metal', -4], ['labor', -5], ['electronics', -2]],
  },
};

registerWorldEventObserver(handleCultWorkshopEvents);

export function generateCultHeldWorkshop(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 43, 16, 95, 260);

  const post = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.HQ,
    pos.x, pos.y + 3, 8, 8,
    'Пост Черной ладони у мастерской',
    Tex.DARK, Tex.F_CONCRETE,
  );
  const shop = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.PRODUCTION,
    pos.x + 9, pos.y, 22, 14,
    WORKSHOP_ROOM,
    Tex.PIPE, Tex.F_CONCRETE,
  );
  const output = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.STORAGE,
    pos.x + 32, pos.y + 3, 9, 8,
    OUTPUT_ROOM,
    Tex.METAL, Tex.F_CONCRETE,
  );

  placeDoor(ctx.world, post, shop, '', false);
  placeDoor(ctx.world, shop, output, '', false);
  setDoorMetal(ctx, [post, shop, output]);
  claimWorkshopForCult(ctx, [post, shop, output]);

  decoratePost(ctx, post);
  decorateShop(ctx, shop);
  decorateOutputCage(ctx, output);

  const foremanId = spawnWorkshopNpcs(ctx, post, shop, output);
  addWorkshopContainers(ctx, shop, output, foremanId);
  dropItems(ctx, shop, ['gear', 'fuse', 'metal_sheet', 'grey_briquette', 'pipe', 'wrench']);
  dropItems(ctx, output, ['grey_briquette', 'green_briquette', 'concentrate_coupon']);
  spawnMonstersNear(ctx, shop.x + 15, shop.y + 6, [MonsterKind.ROBOT], 2, 4);
}

function handleCultWorkshopEvents(state: GameState, event: WorldEvent): void {
  if (event.type === 'quest_completed') {
    const sideQuestId = event.data?.sideQuestId;
    if (typeof sideQuestId !== 'string') return;
    const outcome = QUEST_OUTCOMES[sideQuestId];
    if (!outcome) return;
    publishQuestOutcome(state, event, sideQuestId, outcome);
    return;
  }

  if (event.type !== 'item_stolen' || !event.tags.includes(AG83_TAG)) return;
  publishEvent(state, {
    type: 'container_looted',
    floor: event.floor,
    zoneId: event.zoneId,
    roomId: event.roomId,
    x: event.x,
    y: event.y,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetFaction: Faction.CULTIST,
    itemId: event.itemId,
    itemName: event.itemName,
    itemCount: event.itemCount,
    containerId: event.containerId,
    containerFaction: event.containerFaction,
    severity: Math.max(3, event.severity) as 3 | 4 | 5,
    privacy: event.privacy,
    targetName: 'Готовая партия культовой мастерской вынесена без разрешения.',
    tags: [OUTCOME_TAG, AG83_TAG, 'looted', 'steal', 'production_output', 'cult_access'],
    data: {
      sourceEventId: event.id,
      sourceType: event.type,
      containerName: event.data?.containerName,
      stolenItemKnown: event.data?.stolenItemKnown,
      witnessCount: event.data?.witnessCount,
    },
  });
}

function publishQuestOutcome(
  state: GameState,
  event: WorldEvent,
  sideQuestId: string,
  outcome: QuestOutcome,
): void {
  const resourceChanges: Record<string, number> = {};
  for (const [resourceId, delta] of outcome.resourceDeltas) {
    if (changeResourceStock(state, resourceId, delta, FloorLevel.MAINTENANCE)) resourceChanges[resourceId] = delta;
  }

  publishEvent(state, {
    type: outcome.type,
    floor: FloorLevel.MAINTENANCE,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetFaction: outcome.kind === 'captured' || outcome.kind === 'sabotaged' ? Faction.CULTIST : undefined,
    targetName: outcome.targetName,
    itemId: outcome.itemId,
    itemName: outcome.itemName,
    itemCount: outcome.itemCount,
    severity: outcome.severity,
    privacy: outcome.kind === 'sabotaged' ? 'local' : 'public',
    tags: [OUTCOME_TAG, AG83_TAG, outcome.kind, ...outcome.tags],
    data: {
      sideQuestId,
      sourceEventId: event.id,
      roomName: WORKSHOP_ROOM,
      factoryId: 'metal_shop',
      blockedReason: outcome.kind === 'sabotaged' ? 'sabotage' : undefined,
      resourceChanges,
    },
  });
  state.msgs.push(msg(outcome.message, state.time, outcome.kind === 'sabotaged' ? '#fa6' : '#6cf'));
}

function setDoorMetal(ctx: MaintContentCtx, rooms: Room[]): void {
  for (const room of rooms) {
    for (const doorIdx of room.doors) {
      if (ctx.world.cells[doorIdx] === Cell.DOOR) ctx.world.wallTex[doorIdx] = Tex.DOOR_METAL;
    }
  }
}

function claimWorkshopForCult(ctx: MaintContentCtx, rooms: Room[]): void {
  const zoneId = ctx.world.zoneMap[ctx.world.idx(rooms[1].x + (rooms[1].w >> 1), rooms[1].y + (rooms[1].h >> 1))];
  const zone = ctx.world.zones[zoneId];
  if (zone) zone.faction = ZoneFaction.CULTIST;

  for (const room of rooms) {
    for (let dy = 0; dy < room.h; dy++) {
      for (let dx = 0; dx < room.w; dx++) {
        const ci = ctx.world.idx(room.x + dx, room.y + dy);
        if (ctx.world.cells[ci] === Cell.FLOOR || ctx.world.cells[ci] === Cell.WATER || ctx.world.cells[ci] === Cell.DOOR) {
          ctx.world.factionControl[ci] = ZoneFaction.CULTIST;
        }
      }
    }
  }
}

function decoratePost(ctx: MaintContentCtx, room: Room): void {
  setFeature(ctx.world, room.x + 2, room.y + 2, Feature.CANDLE);
  setFeature(ctx.world, room.x + room.w - 3, room.y + 2, Feature.CANDLE);
  setFeature(ctx.world, room.x + 3, room.y + 4, Feature.TABLE);
  setFeature(ctx.world, room.x + 5, room.y + 5, Feature.SHELF);
  stampSurfaceSplat(ctx.world, room.x + 4, room.y + 1, 0.5, 0.5, 2.2, 170, room.id * 97 + 11, 10, 8, 8, true);
  stampSurfaceSplat(ctx.world, room.x + 4, room.y + 4, 0.5, 0.5, 1.1, 140, room.id * 101 + 3, 55, 12, 8, false);
}

function decorateShop(ctx: MaintContentCtx, room: Room): void {
  for (let dx = 3; dx < room.w - 3; dx += 4) {
    setFeature(ctx.world, room.x + dx, room.y + 4, Feature.MACHINE);
    setFeature(ctx.world, room.x + dx + 1, room.y + 8, Feature.APPARATUS);
  }
  setFeature(ctx.world, room.x + 2, room.y + room.h - 3, Feature.DESK);
  setFeature(ctx.world, room.x + room.w - 3, room.y + 2, Feature.SCREEN);
  setFeature(ctx.world, room.x + 5, room.y + 2, Feature.LAMP);
  setFeature(ctx.world, room.x + 14, room.y + 2, Feature.LAMP);
  setFeature(ctx.world, room.x + 7, room.y + room.h - 3, Feature.SHELF);
  setWater(ctx.world, room.x + 11, room.y + room.h - 2);
  setWater(ctx.world, room.x + 12, room.y + room.h - 2);
  stampSurfaceSplat(ctx.world, room.x + 15, room.y + 6, 0.5, 0.5, 3.0, 115, room.id * 113 + 17, 20, 20, 18, false);
  stampSurfaceSplat(ctx.world, room.x + 16, room.y + 7, 0.5, 0.5, 1.5, 130, room.id * 127 + 5, 70, 8, 8, false);
}

function decorateOutputCage(ctx: MaintContentCtx, room: Room): void {
  const fenceX = room.x + 2;
  const gateY = room.y + (room.h >> 1);
  for (let dy = 1; dy < room.h - 1; dy++) {
    const y = room.y + dy;
    if (y === gateY) continue;
    const ci = ctx.world.idx(fenceX, y);
    if (ctx.world.cells[ci] !== Cell.FLOOR) continue;
    ctx.world.cells[ci] = Cell.WALL;
    ctx.world.wallTex[ci] = Tex.METAL;
    ctx.world.features[ci] = Feature.NONE;
  }
  for (let dy = 1; dy < room.h - 1; dy += 2) {
    setFeature(ctx.world, room.x + room.w - 2, room.y + dy, Feature.SHELF);
  }
  setFeature(ctx.world, room.x + 4, room.y + 2, Feature.LAMP);
  setFeature(ctx.world, room.x + 4, room.y + room.h - 3, Feature.SHELF);
}

function spawnWorkshopNpcs(ctx: MaintContentCtx, post: Room, shop: Room, output: Room): number {
  spawnPlotNpc(ctx, MECHANIC_ID, MECHANIC_DEF, shop.x + 3, shop.y + shop.h - 3, 0, { weapon: 'wrench' });
  spawnPlotNpc(ctx, SABOTEUR_ID, SABOTEUR_DEF, shop.x + shop.w - 4, shop.y + shop.h - 3, Math.PI, { weapon: 'wrench' });
  const foremanId = ctx.nextId.v;
  spawnPlotNpc(ctx, FOREMAN_ID, FOREMAN_DEF, post.x + 4, post.y + 4, Math.PI / 2, { weapon: 'knife' });
  spawnAmbientNpc(
    ctx,
    'Черноременный у ремня',
    Faction.CULTIST,
    Occupation.PILGRIM,
    shop.x + 11,
    shop.y + 5,
    [{ defId: 'pipe', count: 1 }, { defId: 'grey_briquette', count: 1 }],
  );
  spawnAmbientNpc(
    ctx,
    'Сторож готовой партии',
    Faction.CULTIST,
    Occupation.HUNTER,
    output.x + 4,
    output.y + 4,
    [{ defId: 'wrench', count: 1 }, { defId: 'green_briquette', count: 1 }],
  );
  return foremanId;
}

function addWorkshopContainers(ctx: MaintContentCtx, shop: Room, output: Room, ownerNpcId: number): void {
  addContainer(ctx, shop, shop.x + 7, shop.y + shop.h - 3, {
    kind: ContainerKind.TOOL_LOCKER,
    name: 'Выходной бункер станка под надзором',
    inventory: [
      { defId: 'door_kit', count: 1 },
      { defId: 'gear', count: 1 },
      { defId: 'fuse', count: 1 },
      { defId: 'metal_sheet', count: 1 },
    ],
    capacitySlots: 8,
    ownerNpcId,
    ownerName: FOREMAN_DEF.name,
    faction: Faction.CULTIST,
    access: 'faction',
    lockDifficulty: 3,
    discovered: true,
    factoryId: 'metal_shop',
    tags: ['tools', 'faction', 'production_output', 'metal_shop', AG83_TAG, 'cult_access'],
  });
  addContainer(ctx, output, output.x + output.w - 3, output.y + 2, {
    kind: ContainerKind.TOOL_LOCKER,
    name: 'Культовый выходной ящик станка',
    inventory: [
      { defId: 'door_kit', count: 1 },
      { defId: 'pipe', count: 2 },
      { defId: 'grey_briquette', count: 4 },
      { defId: 'green_briquette', count: 2 },
    ],
    capacitySlots: 10,
    ownerNpcId,
    ownerName: FOREMAN_DEF.name,
    faction: Faction.CULTIST,
    access: 'faction',
    lockDifficulty: 4,
    discovered: true,
    factoryId: 'metal_shop',
    tags: ['tools', 'faction', 'production_output', 'metal_shop', AG83_TAG, 'cult_access'],
  });
}

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
  if (ctx.world.cells[ci] === Cell.FLOOR || ctx.world.cells[ci] === Cell.WATER) ctx.world.features[ci] = Feature.SHELF;
}
