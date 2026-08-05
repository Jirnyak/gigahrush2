/* ── Ремонтник Без Смены: local shortcut/tool route encounter ─── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal, Cell, ContainerKind, EntityType, Faction, Feature, FloorLevel,
  MonsterKind, Occupation, QuestType, RoomType, Tex, msg,
  type Entity, type GameState, type Room, type WorldContainer, type WorldEvent,
  type WorldEventType,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  type MaintContentCtx, dropItems, findMaintArea, setFeature,
  spawnMonstersNear, spawnPlotNpc, stampMaintRoom,
} from './content_helpers';

const CONTENT_TAG = 'remontnik_bez_smeny';
const WORK_ORDER_QUEST = 'remontnik_bez_smeny_work_order';
const NPC_ID = 'remontnik_bez_smeny';
const NPC_NAME = 'Ремонтник Без Смены';
const LEFT_ROOM = 'Плохая стена без наряда';
const CLOSET_ROOM = 'Кладовка Ремонтника Без Смены';
const RIGHT_ROOM = 'Срезанный ход у сварочного поста';

type RemontnikOutcome = 'preserved' | 'bargained' | 'robbed' | 'killed' | 'welded';

interface RemontnikSite {
  world: World;
  entities: Entity[];
  shortcutCells: number[];
  shortcutX: number;
  shortcutY: number;
  roomId: number;
  zoneId: number;
  npcId: number;
  lockerId: number;
  cartId: number;
  machineX: number;
  machineY: number;
  outcome?: RemontnikOutcome;
  machineryWoken: boolean;
}

const REMONTNIK_DEF: PlotNpcDef = {
  name: NPC_NAME,
  isFemale: false,
  faction: Faction.WILD,
  occupation: Occupation.MECHANIC,
  sprite: Occupation.MECHANIC,
  hp: 95,
  maxHp: 95,
  money: 18,
  speed: 0.82,
  inventory: [
    { defId: 'wrench', count: 1 },
    { defId: 'gear', count: 1 },
    { defId: 'sealant_tube', count: 1 },
  ],
  talkLines: [
    'Смена не кончилась. Кончились люди, которые помнят начало.',
    'Положишь шестерню на тележку - оставлю короткий ход рабочим. Положишь герметик - заварю его по акту.',
    'Бланк обхода покажешь через задание. Без бланка стена считается ошибкой и подлежит исправлению.',
    'Держи дверь, если просишь открыть. Ремонт без второй руки быстро становится некрологом.',
    'Не украл прокладку? Тогда разговор короткий и полезный.',
  ],
  talkLinesPost: [
    'Наряд принят. Стена временно не спорит с маршрутом.',
    'Если тележка стоит не там, значит кто-то уже решил за тебя.',
    'Короткий ход открыт. Не благодари, просто не стой в луже у щитка.',
  ],
};

registerSideQuest(NPC_ID, REMONTNIK_DEF, [
  {
    id: WORK_ORDER_QUEST,
    giverNpcId: NPC_ID,
    type: QuestType.FETCH,
    desc: 'Ремонтник Без Смены: «Бланк обхода лифта на стол. Без бумаги короткий ход опять станет стеной, а ты держи дверь.»',
    targetItem: 'elevator_override_form',
    targetCount: 1,
    rewardItem: 'wrench',
    rewardCount: 1,
    extraRewards: [{ defId: 'sealant_tube', count: 1 }],
    relationDelta: 6,
    xpReward: 55,
    moneyReward: 10,
    eventSeverity: 4,
    eventPrivacy: 'local',
    eventTags: [CONTENT_TAG, 'monster', 'repair', 'route_denial', 'maintenance', 'work_order'],
    eventData: { outcome: 'route_preserved', rumorTags: ['repair', 'maintenance'] },
  },
]);

let activeRemontnik: RemontnikSite | null = null;

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
): number {
  const wx = ctx.world.wrap(x);
  const wy = ctx.world.wrap(y);
  const ci = ctx.world.idx(wx, wy);
  const id = nextContainerId(ctx);
  ctx.world.addContainer({
    id,
    x: wx,
    y: wy,
    floor: FloorLevel.MAINTENANCE,
    roomId: room.id,
    zoneId: ctx.world.zoneMap[ci],
    ...container,
  });
  setFeature(ctx.world, wx, wy, Feature.SHELF);
  return id;
}

function openPassageCell(world: World, x: number, y: number, floorTex = Tex.F_CONCRETE): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT) return;
  const wasWall = world.cells[ci] === Cell.WALL;
  world.cells[ci] = Cell.FLOOR;
  world.floorTex[ci] = floorTex;
  world.features[ci] = Feature.NONE;
  world.aptMask[ci] = 0;
  world.hermoWall[ci] = 0;
  if (wasWall || world.roomMap[ci] < 0) world.roomMap[ci] = -1;
}

function setShortcutOpen(site: RemontnikSite, open: boolean): void {
  for (const ci of site.shortcutCells) {
    if (site.world.cells[ci] === Cell.LIFT) continue;
    site.world.cells[ci] = open ? Cell.FLOOR : Cell.WALL;
    site.world.features[ci] = Feature.NONE;
    site.world.aptMask[ci] = 0;
    site.world.hermoWall[ci] = 0;
    site.world.roomMap[ci] = -1;
    if (open) site.world.floorTex[ci] = Tex.F_CONCRETE;
    else site.world.wallTex[ci] = Tex.METAL;
  }
  site.world.markWallTexDirty();
  site.world.markFloorTexDirty();
}

function connectMainBypass(ctx: MaintContentCtx, left: Room, closet: Room, right: Room): void {
  const leftX = left.x + (left.w >> 1);
  const rightX = right.x + (right.w >> 1);
  const mainY = closet.y + closet.h + 2;
  for (let y = left.y + left.h - 2; y <= mainY; y++) openPassageCell(ctx.world, leftX, y);
  for (let x = leftX; x <= rightX; x++) openPassageCell(ctx.world, x, mainY);
  for (let y = right.y + right.h - 2; y <= mainY; y++) openPassageCell(ctx.world, rightX, y);
  const closetX = closet.x + (closet.w >> 1);
  for (let y = closet.y + closet.h - 2; y <= mainY; y++) openPassageCell(ctx.world, closetX, y);
}

function shortcutCells(world: World, left: Room, closet: Room, right: Room): { cells: number[]; x: number; y: number } {
  const y = closet.y + (closet.h >> 1);
  const cells: number[] = [];
  for (let x = left.x + left.w; x < closet.x; x++) cells.push(world.idx(x, y));
  for (let x = closet.x + closet.w; x < right.x; x++) cells.push(world.idx(x, y));
  return { cells, x: closet.x + closet.w, y };
}

function dressRooms(ctx: MaintContentCtx, left: Room, closet: Room, right: Room): void {
  setFeature(ctx.world, left.x + 2, left.y + 2, Feature.SCREEN);
  setFeature(ctx.world, left.x + 4, left.y + 3, Feature.DESK);
  setFeature(ctx.world, left.x + left.w - 2, left.y + 2, Feature.LAMP);
  setFeature(ctx.world, left.x + left.w - 2, left.y + left.h - 3, Feature.APPARATUS);

  for (let dy = 2; dy < closet.h - 2; dy += 2) {
    setFeature(ctx.world, closet.x + 1, closet.y + dy, Feature.SHELF);
    setFeature(ctx.world, closet.x + closet.w - 2, closet.y + dy, Feature.MACHINE);
  }
  setFeature(ctx.world, closet.x + 4, closet.y + 2, Feature.LAMP);
  setFeature(ctx.world, closet.x + 7, closet.y + 4, Feature.APPARATUS);
  setFeature(ctx.world, closet.x + 6, closet.y + closet.h - 3, Feature.SCREEN);

  setFeature(ctx.world, right.x + 2, right.y + 2, Feature.LAMP);
  setFeature(ctx.world, right.x + 3, right.y + 4, Feature.MACHINE);
  setFeature(ctx.world, right.x + right.w - 3, right.y + 2, Feature.APPARATUS);
  setFeature(ctx.world, right.x + right.w - 2, right.y + right.h - 3, Feature.SHELF);

  stampSurfaceSplat(ctx.world, left.x + left.w - 1, left.y + 4, 0.5, 0.5, 0.75, 120, left.id * 977 + 25, 255, 145, 55, true);
  stampSurfaceSplat(ctx.world, right.x + 1, right.y + 4, 0.5, 0.5, 0.65, 100, right.id * 983 + 17, 255, 170, 65, true);
}

function addRemontnikContainers(ctx: MaintContentCtx, closet: Room, npcId: number): { lockerId: number; cartId: number } {
  const cartId = addContainer(ctx, closet, closet.x + 2, closet.y + 3, {
    kind: ContainerKind.TOOL_LOCKER,
    name: 'Наряд-тележка Ремонтника: положить деталь или герметик',
    inventory: [{ defId: 'note', count: 1 }],
    capacitySlots: 8,
    access: 'public',
    discovered: true,
    tags: [CONTENT_TAG, 'remontnik_cart', 'maintenance', 'repair', 'route_denial', 'tools'],
  });
  const lockerId = addContainer(ctx, closet, closet.x + closet.w - 3, closet.y + 3, {
    kind: ContainerKind.TOOL_LOCKER,
    name: 'Личный шкаф смены, которой нет',
    inventory: [
      { defId: 'wrench', count: 1 },
      { defId: 'gear', count: 2 },
      { defId: 'sealant_tube', count: 2 },
      { defId: 'elevator_override_form', count: 1 },
    ],
    capacitySlots: 8,
    ownerNpcId: npcId,
    ownerName: NPC_NAME,
    faction: Faction.WILD,
    access: 'owner',
    discovered: true,
    tags: [CONTENT_TAG, 'remontnik_locker', 'maintenance', 'repair', 'route_denial', 'tool_reward', 'theft'],
  });
  return { lockerId, cartId };
}

function nextEntityId(entities: readonly Entity[]): number {
  let id = 1;
  for (const entity of entities) id = Math.max(id, entity.id + 1);
  return id;
}

function findSpawnCell(world: World, x: number, y: number): { x: number; y: number } {
  for (let r = 0; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const wx = world.wrap(x + dx);
        const wy = world.wrap(y + dy);
        if (world.cells[world.idx(wx, wy)] === Cell.FLOOR) return { x: wx, y: wy };
      }
    }
  }
  return { x: world.wrap(x), y: world.wrap(y) };
}

function wakeMachinery(site: RemontnikSite, state: GameState, reason: RemontnikOutcome): void {
  if (site.machineryWoken) return;
  site.machineryWoken = true;
  const def = MONSTERS[MonsterKind.ROBOT];
  if (!def) return;
  const pos = findSpawnCell(site.world, site.machineX, site.machineY);
  const ci = site.world.idx(pos.x, pos.y);
  const zoneLevel = site.world.zones[site.world.zoneMap[ci]]?.level ?? 5;
  const hp = scaleMonsterHp(def.hp, zoneLevel);
  const robot: Entity = {
    id: nextEntityId(site.entities),
    type: EntityType.MONSTER,
    x: pos.x + 0.5,
    y: pos.y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: def.sprite,
    hp,
    maxHp: hp,
    monsterKind: MonsterKind.ROBOT,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: site.shortcutX, ty: site.shortcutY, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
  };
  site.entities.push(robot);
  state.msgs.push(msg(
    reason === 'welded'
      ? 'Сварка разбудила автоматику у плохой стены.'
      : 'После смерти Ремонтника автоматика приняла бой за ремонт.',
    state.time,
    '#f84',
  ));
}

function outcomeType(outcome: RemontnikOutcome): WorldEventType {
  if (outcome === 'welded') return 'door_sealed';
  if (outcome === 'killed') return 'death_seen';
  return 'door_opened';
}

function outcomeMessage(outcome: RemontnikOutcome): { text: string; color: string } {
  switch (outcome) {
    case 'preserved':
      return { text: 'Ремонтник сверил бланк: короткий ход оставлен в обходной схеме.', color: '#6cf' };
    case 'bargained':
      return { text: 'Шестерня легла на тележку. Ремонтник отступил от шва, короткий ход открыт.', color: '#6cf' };
    case 'robbed':
      return { text: 'Инструмент вынесен без спроса. Короткий ход вскрыт, но слух о краже пойдет по трубам.', color: '#fa4' };
    case 'killed':
      return { text: 'Ремонтник Без Смены упал у тележки. Короткий ход больше некому заваривать.', color: '#f84' };
    case 'welded':
      return { text: 'Короткий ход заварен по местному акту. Обходной коридор остается открытым.', color: '#fa6' };
  }
}

function publishOutcome(state: GameState, source: WorldEvent, site: RemontnikSite, outcome: RemontnikOutcome, itemId?: string): void {
  const tags = [
    CONTENT_TAG,
    'monster',
    'repair',
    'route_denial',
    'maintenance',
    outcome,
    outcome === 'preserved' ? 'route_preserved' : '',
    outcome === 'bargained' ? 'bargain' : '',
    outcome === 'robbed' ? 'robbed_open' : '',
    outcome === 'welded' ? 'route_welded' : '',
    outcome === 'killed' ? 'killed' : '',
  ].filter(Boolean);
  publishEvent(state, {
    type: outcomeType(outcome),
    floor: FloorLevel.MAINTENANCE,
    zoneId: site.zoneId,
    roomId: site.roomId,
    x: site.shortcutX + 0.5,
    y: site.shortcutY + 0.5,
    actorId: source.actorId,
    actorName: source.actorName,
    actorFaction: source.actorFaction,
    targetId: outcome === 'killed' ? site.npcId : site.shortcutCells[0],
    targetName: outcome === 'killed' ? NPC_NAME : 'локальный короткий ход Ремонтника',
    targetFaction: Faction.WILD,
    itemId: itemId ?? source.itemId,
    itemName: source.itemName,
    itemCount: source.itemCount,
    containerId: source.containerId,
    containerOwnerId: source.containerOwnerId,
    containerFaction: source.containerFaction,
    severity: outcome === 'robbed' || outcome === 'killed' || outcome === 'welded' ? 4 : 3,
    privacy: outcome === 'robbed' ? 'witnessed' : 'local',
    tags,
    data: {
      outcome,
      sourceEventId: source.id,
      sourceType: source.type,
      shortcutCells: site.shortcutCells,
      mainRouteOpen: true,
      roomName: CLOSET_ROOM,
      lockerId: site.lockerId,
      cartId: site.cartId,
      rumorTags: ['repair', 'maintenance', 'route_denial'],
    },
  });
}

function resolveOutcome(state: GameState, source: WorldEvent, outcome: RemontnikOutcome, itemId?: string): void {
  const site = activeRemontnik;
  if (!site || state.currentFloor !== FloorLevel.MAINTENANCE || site.outcome) return;
  site.outcome = outcome;
  setShortcutOpen(site, outcome !== 'welded');
  if (outcome === 'welded' || outcome === 'killed') wakeMachinery(site, state, outcome);
  const message = outcomeMessage(outcome);
  state.msgs.push(msg(message.text, state.time, message.color));
  publishOutcome(state, source, site, outcome, itemId);
}

function handleRemontnikEvent(state: GameState, event: WorldEvent): void {
  const site = activeRemontnik;
  if (!site) return;

  if (event.type === 'quest_completed' && event.data?.sideQuestId === WORK_ORDER_QUEST) {
    resolveOutcome(state, event, 'preserved', 'elevator_override_form');
    return;
  }

  if (event.type === 'item_deposited' && event.containerId === site.cartId) {
    if (event.itemId === 'elevator_override_form') resolveOutcome(state, event, 'preserved', event.itemId);
    else if (event.itemId === 'gear') resolveOutcome(state, event, 'bargained', event.itemId);
    else if (event.itemId === 'sealant_tube') resolveOutcome(state, event, 'welded', event.itemId);
    return;
  }

  if (event.type === 'item_stolen' && event.containerId === site.lockerId) {
    resolveOutcome(state, event, 'robbed', event.itemId);
    return;
  }

  if (event.type === 'player_kill_npc' && (event.targetId === site.npcId || event.targetName === NPC_NAME)) {
    resolveOutcome(state, event, 'killed');
  }
}

registerWorldEventObserver(handleRemontnikEvent);

export function generateRemontnikBezSmeny(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 42, 20, 115, 235);

  const left = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.CORRIDOR,
    pos.x, pos.y + 3, 10, 8,
    LEFT_ROOM,
    Tex.PIPE, Tex.F_CONCRETE,
  );
  const closet = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.STORAGE,
    pos.x + 13, pos.y + 1, 12, 12,
    CLOSET_ROOM,
    Tex.METAL, Tex.F_CONCRETE,
  );
  const right = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.CORRIDOR,
    pos.x + 28, pos.y + 3, 10, 8,
    RIGHT_ROOM,
    Tex.PIPE, Tex.F_CONCRETE,
  );

  connectMainBypass(ctx, left, closet, right);
  const shortcut = shortcutCells(ctx.world, left, closet, right);
  dressRooms(ctx, left, closet, right);

  const npcId = ctx.nextId.v;
  spawnPlotNpc(ctx, NPC_ID, REMONTNIK_DEF, closet.x + 6, closet.y + 6, Math.PI, { weapon: 'wrench' });
  const { lockerId, cartId } = addRemontnikContainers(ctx, closet, npcId);

  dropItems(ctx, left, ['elevator_override_form', 'gear', 'note']);
  dropItems(ctx, closet, ['gear', 'sealant_tube', 'wrench']);
  dropItems(ctx, right, ['sealant_tube', 'ammo_energy', 'bandage']);
  spawnMonstersNear(ctx, right.x + 4, right.y + 4, [MonsterKind.REBAR, MonsterKind.LAMPOVY], 4, 8);

  activeRemontnik = {
    world: ctx.world,
    entities: ctx.entities,
    shortcutCells: shortcut.cells,
    shortcutX: shortcut.x,
    shortcutY: shortcut.y,
    roomId: closet.id,
    zoneId: ctx.world.zoneMap[ctx.world.idx(shortcut.x, shortcut.y)],
    npcId,
    lockerId,
    cartId,
    machineX: right.x + 3,
    machineY: right.y + 4,
    machineryWoken: false,
  };
  setShortcutOpen(activeRemontnik, false);
}
