/* ── Пристав Пустоты — local VOID rule enforcer chamber ───────── */

import {
  AIGoal, Cell, ContainerKind, DoorState, EntityType, Feature, FloorLevel, ItemType,
  MonsterKind, RoomType, Tex, msg,
  type Entity, type GameState, type Item, type WorldContainer, type WorldEvent, type WorldEventType,
} from '../../core/types';
import { World } from '../../core/world';
import { ITEMS } from '../../data/catalog';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import { publishEvent, registerWorldEventObserver as observeWorldEvents } from '../../systems/events';
import { addItem } from '../../systems/inventory';
import { registerRouteCue } from '../../systems/route_cues';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { carveCorridor, findClearArea, placeDoorAt, stampRoom } from '../shared';
import { isPlayerEntity } from '../../systems/player_actor';

const PROTOCOL_ID = 'pristav_pustoty';
const PROTOCOL_NAME = 'Пристав Пустоты';
const TAG_RULE = 'void_rule';
const TAG_PROTOCOL = 'pristav_pustoty';
const TAG_STATED = 'stated';
const TAG_OBEY = 'obey';
const TAG_PAY = 'pay';
const TAG_VIOLATE = 'violate';
const TAG_ANCHOR = 'anchor';
const TAG_DONE = 'resolved';
const TAG_RULE_STATED = 'rule_stated';
const CONTEXT_CAP = 8;
const TOLL_RUBLES = 5;

const SAFE_TAX_IDS = new Set([
  'water',
  'tea',
  'kompot',
  'bread',
  'kasha',
  'canned',
  'grey_briquette',
  'soup_cube',
  'pressed_sugar',
  'bandage',
  'duct_tape',
  'ammo_9mm',
  'ammo_shells',
  'ammo_nails',
  'ammo_762tt',
  'ammo_nagant',
]);

interface PristavContext {
  world: World;
  entities: Entity[];
  roomId: number;
  ruleContainerId: number;
  obeyContainerId: number;
  payContainerId: number;
  violateContainerId: number;
  anchorContainerId: number;
  penaltyDoorIdx: number;
  anchorX: number;
  anchorY: number;
}

const pristavContexts: PristavContext[] = [];

function registerPristavContext(ctx: PristavContext): void {
  const existing = pristavContexts.find(item => item.world === ctx.world && item.roomId === ctx.roomId);
  if (existing) {
    existing.entities = ctx.entities;
    existing.ruleContainerId = ctx.ruleContainerId;
    existing.obeyContainerId = ctx.obeyContainerId;
    existing.payContainerId = ctx.payContainerId;
    existing.violateContainerId = ctx.violateContainerId;
    existing.anchorContainerId = ctx.anchorContainerId;
    existing.penaltyDoorIdx = ctx.penaltyDoorIdx;
    existing.anchorX = ctx.anchorX;
    existing.anchorY = ctx.anchorY;
    return;
  }
  pristavContexts.push(ctx);
  if (pristavContexts.length > CONTEXT_CAP) pristavContexts.splice(0, pristavContexts.length - CONTEXT_CAP);
}

function eventHasTags(event: WorldEvent, ...tags: string[]): boolean {
  return tags.every(tag => event.tags.includes(tag));
}

function findPristavContext(event: WorldEvent): PristavContext | undefined {
  if (event.containerId === undefined) return undefined;
  for (let i = pristavContexts.length - 1; i >= 0; i--) {
    const ctx = pristavContexts[i];
    if (
      ctx.ruleContainerId === event.containerId
      || ctx.obeyContainerId === event.containerId
      || ctx.payContainerId === event.containerId
      || ctx.violateContainerId === event.containerId
      || ctx.anchorContainerId === event.containerId
    ) return ctx;
  }
  return undefined;
}

function addContainerTag(container: WorldContainer | undefined, tag: string): void {
  if (container && !container.tags.includes(tag)) container.tags.push(tag);
}

function contextContainers(ctx: PristavContext): WorldContainer[] {
  const out: WorldContainer[] = [];
  for (const id of [
    ctx.ruleContainerId,
    ctx.obeyContainerId,
    ctx.payContainerId,
    ctx.violateContainerId,
    ctx.anchorContainerId,
  ]) {
    const container = ctx.world.containerById.get(id);
    if (container) out.push(container);
  }
  return out;
}

function ruleAlreadyStated(ctx: PristavContext): boolean {
  return contextContainers(ctx).some(container => container.tags.includes(TAG_RULE_STATED));
}

function markRuleStated(ctx: PristavContext): void {
  for (const container of contextContainers(ctx)) addContainerTag(container, TAG_RULE_STATED);
}

function choiceAlreadyMade(ctx: PristavContext): boolean {
  return contextContainers(ctx).some(container => container.tags.includes(TAG_DONE));
}

function markChoice(ctx: PristavContext, tag: string): void {
  for (const container of contextContainers(ctx)) {
    addContainerTag(container, TAG_DONE);
    addContainerTag(container, tag);
  }
}

function pushHud(state: GameState, line: string, color: string): void {
  state.msgs.push(msg(line, state.time, color));
}

function publishPristavEvent(
  state: GameState,
  ctx: PristavContext,
  event: WorldEvent,
  phase: 'stated' | 'obeyed' | 'paid' | 'violated' | 'anchor_broken' | 'rejected',
  line: string,
  severity: 2 | 3 | 4,
  data: Record<string, unknown> = {},
): void {
  publishEvent(state, {
    type: `${PROTOCOL_ID}_${phase}` as WorldEventType,
    severity,
    privacy: phase === 'rejected' ? 'private' : 'local',
    zoneId: event.zoneId,
    roomId: ctx.roomId,
    x: event.x,
    y: event.y,
    actorId: event.actorId ?? 0,
    actorName: event.actorName ?? 'Вы',
    tags: ['monster', 'void', 'protocol', 'rule', PROTOCOL_ID, phase].slice(0, 8),
    data: {
      protocolId: PROTOCOL_ID,
      protocolName: PROTOCOL_NAME,
      sourceContainerId: event.containerId,
      ...data,
    },
  });
  pushHud(state, line, phase === 'violated' || phase === 'anchor_broken' ? '#f8c' : '#8ff');
}

function playerInContext(ctx: PristavContext): Entity | undefined {
  return ctx.entities.find(e => isPlayerEntity(e) && e.alive);
}

function nextEntityId(entities: Entity[]): number {
  let id = 1;
  for (const entity of entities) id = Math.max(id, entity.id + 1);
  return id;
}

function nearestLevel(world: World, x: number, y: number): number {
  const zoneId = world.zoneMap[world.idx(x, y)];
  return Math.max(14, world.zones[zoneId]?.level ?? 14);
}

function findRoomSpawn(ctx: PristavContext, preferX: number, preferY: number): { x: number; y: number } | null {
  const room = ctx.world.rooms[ctx.roomId];
  if (!room) return null;
  const firstX = ctx.world.wrap(preferX);
  const firstY = ctx.world.wrap(preferY);
  if (ctx.world.cells[ctx.world.idx(firstX, firstY)] === Cell.FLOOR) return { x: firstX, y: firstY };
  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      const x = ctx.world.wrap(room.x + dx);
      const y = ctx.world.wrap(room.y + dy);
      if (ctx.world.cells[ctx.world.idx(x, y)] === Cell.FLOOR) return { x, y };
    }
  }
  return null;
}

function spawnPristavMonster(ctx: PristavContext, kind: MonsterKind, name: string, x: number, y: number): void {
  const cell = findRoomSpawn(ctx, x, y);
  const def = MONSTERS[kind];
  if (!cell || !def) return;
  const level = nearestLevel(ctx.world, cell.x, cell.y);
  const hp = Math.round(scaleMonsterHp(def.hp, level));
  ctx.entities.push({
    id: nextEntityId(ctx.entities),
    type: EntityType.MONSTER,
    x: cell.x + 0.5,
    y: cell.y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, level),
    sprite: monsterSpr(kind),
    name,
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
    phasing: kind === MonsterKind.SPIRIT,
  });
}

function spawnViolationPressure(ctx: PristavContext): void {
  const room = ctx.world.rooms[ctx.roomId];
  if (!room) return;
  spawnPristavMonster(ctx, MonsterKind.SPIRIT, PROTOCOL_NAME, room.x + room.w - 4, room.y + 3);
  spawnPristavMonster(ctx, MonsterKind.PARAGRAPH, 'Исполнитель пустотной нормы', room.x + room.w - 5, room.y + room.h - 4);
}

function spawnAnchorPressure(ctx: PristavContext): void {
  const room = ctx.world.rooms[ctx.roomId];
  if (!room) return;
  spawnPristavMonster(ctx, MonsterKind.PARAGRAPH, 'Акт о сломанном якоре', room.x + room.w - 4, room.y + 2);
}

function applyRoutePenalty(ctx: PristavContext): void {
  const door = ctx.world.doors.get(ctx.penaltyDoorIdx);
  if (door) {
    door.state = DoorState.CLOSED;
    door.timer = 0;
  }
  const room = ctx.world.rooms[ctx.roomId];
  if (!room) return;
  for (let dx = 2; dx < room.w - 2; dx++) {
    const ci = ctx.world.idx(room.x + dx, room.y + (room.h >> 1));
    if (ctx.world.fog[ci] < 24) ctx.world.fog[ci] = 24;
  }
  ctx.world.markFogDirty();
}

function taxSmallSafeItem(player: Entity): { itemId?: string; itemName?: string; moneyRubles?: number } {
  if (!player.inventory) return {};
  for (let i = 0; i < player.inventory.length; i++) {
    const slot = player.inventory[i];
    const def = ITEMS[slot.defId];
    if (!def || slot.count <= 0 || slot.data !== undefined) continue;
    if (!SAFE_TAX_IDS.has(slot.defId)) continue;
    if (def.type === ItemType.WEAPON || def.type === ItemType.TOOL || def.type === ItemType.KEY || def.type === ItemType.NOTE) continue;
    slot.count--;
    if (slot.count <= 0) player.inventory = player.inventory.filter((_, index) => index !== i);
    return { itemId: def.id, itemName: def.name };
  }
  if (player.money !== undefined && player.money > 0) {
    const moneyRubles = Math.min(3, player.money);
    player.money -= moneyRubles;
    return { itemName: moneyRubles === 1 ? '1 рубль' : `${moneyRubles} рубля`, moneyRubles };
  }
  return {};
}

function stateRuleIfNeeded(ctx: PristavContext, state: GameState, event: WorldEvent): void {
  if (ruleAlreadyStated(ctx)) return;
  markRuleStated(ctx);
  publishPristavEvent(
    state,
    ctx,
    event,
    'stated',
    'Правило Пристава: перед прямым выходом нужна отметка — обойти, заплатить или сломать якорь.',
    3,
  );
}

function applyObey(ctx: PristavContext, state: GameState, event: WorldEvent): void {
  markChoice(ctx, TAG_OBEY);
  publishPristavEvent(state, ctx, event, 'obeyed', 'Отметка принята: Пристав не входит в комнату.', 3);
}

function applyPay(ctx: PristavContext, state: GameState, event: WorldEvent): void {
  const player = playerInContext(ctx);
  if (!player) return;
  if ((player.money ?? 0) < TOLL_RUBLES) {
    publishPristavEvent(state, ctx, event, 'rejected', 'Пошлина не принята: не хватает 5 рублей.', 2);
    return;
  }
  player.money = Math.max(0, (player.money ?? 0) - TOLL_RUBLES);
  markChoice(ctx, TAG_PAY);
  const rewarded = addItem(player, 'psi_mark', 1);
  publishPristavEvent(
    state,
    ctx,
    event,
    'paid',
    rewarded ? 'Пошлина принята: на ладони осталась ПСИ-метка.' : 'Пошлина принята: рюкзак не принял ПСИ-метку.',
    3,
    { paidRubles: TOLL_RUBLES, rewardItem: rewarded ? 'psi_mark' : undefined },
  );
}

function applyViolation(ctx: PristavContext, state: GameState, event: WorldEvent): void {
  const player = playerInContext(ctx);
  markChoice(ctx, TAG_VIOLATE);
  const taxed = player ? taxSmallSafeItem(player) : {};
  const taxData = taxed.itemId
    ? { taxedItemId: taxed.itemId, taxedItemName: taxed.itemName }
    : taxed.moneyRubles !== undefined
      ? { taxedMoneyRubles: taxed.moneyRubles, taxedItemName: taxed.itemName }
      : {};
  applyRoutePenalty(ctx);
  spawnViolationPressure(ctx);
  publishPristavEvent(
    state,
    ctx,
    event,
    'violated',
    taxed.itemName
      ? `Нарушение принято: Пристав забрал ${taxed.itemName} и закрыл прямую линию.`
      : 'Нарушение принято: Пристав закрыл прямую линию и пришел лично.',
    4,
    taxData,
  );
}

function applyAnchorBreak(ctx: PristavContext, state: GameState, event: WorldEvent): void {
  markChoice(ctx, TAG_ANCHOR);
  const ci = ctx.world.idx(ctx.anchorX, ctx.anchorY);
  ctx.world.features[ci] = Feature.NONE;
  spawnAnchorPressure(ctx);
  publishPristavEvent(
    state,
    ctx,
    event,
    'anchor_broken',
    'Якорь протокола сломан. Правило снято, но Параграф уже несет акт о поломке.',
    4,
    { rewardItem: event.itemId === 'void_spike' ? 'void_spike' : undefined },
  );
}

function handlePristavEvent(state: GameState, event: WorldEvent): void {
  if (event.type !== 'container_opened' && event.type !== 'item_stolen') return;
  if (!eventHasTags(event, TAG_RULE, TAG_PROTOCOL)) return;
  const ctx = findPristavContext(event);
  if (!ctx) return;

  if (eventHasTags(event, TAG_STATED)) {
    stateRuleIfNeeded(ctx, state, event);
    return;
  }

  stateRuleIfNeeded(ctx, state, event);
  if (choiceAlreadyMade(ctx)) {
    publishPristavEvent(state, ctx, event, 'rejected', 'Дело Пристава уже закрыто.', 2);
    return;
  }
  if (eventHasTags(event, TAG_OBEY)) applyObey(ctx, state, event);
  else if (eventHasTags(event, TAG_PAY)) applyPay(ctx, state, event);
  else if (eventHasTags(event, TAG_VIOLATE)) applyViolation(ctx, state, event);
  else if (eventHasTags(event, TAG_ANCHOR)) applyAnchorBreak(ctx, state, event);
}

observeWorldEvents(handlePristavEvent);

function setVoidRoomTextures(world: World, rx: number, ry: number, rw: number, rh: number): void {
  for (let dy = -1; dy <= rh; dy++) {
    for (let dx = -1; dx <= rw; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (dx >= 0 && dx < rw && dy >= 0 && dy < rh) {
        world.floorTex[ci] = Tex.F_VOID;
      } else {
        world.wallTex[ci] = Tex.VOID_WALL;
      }
    }
  }
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addPristavContainer(
  world: World,
  roomId: number,
  x: number,
  y: number,
  name: string,
  inventory: Item[],
  tags: string[],
): number {
  const id = nextContainerId(world);
  const container: WorldContainer = {
    id,
    x: world.wrap(x),
    y: world.wrap(y),
    floor: FloorLevel.VOID,
    roomId,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind: ContainerKind.SECRET_STASH,
    name,
    inventory,
    capacitySlots: 3,
    access: 'public',
    discovered: true,
    tags,
  };
  world.addContainer(container);
  return id;
}

export function generatePristavPustoty(
  world: World,
  entities: Entity[],
  _nextId: { v: number },
  spawnX: number,
  spawnY: number,
): void {
  const sx = Math.floor(spawnX);
  const sy = Math.floor(spawnY);
  const rw = 17;
  const rh = 11;
  const pos = findClearArea(world, sx, sy, rw, rh, 46, 76);
  const rx = pos ? pos.x : world.wrap(sx + 58);
  const ry = pos ? pos.y : world.wrap(sy - 24);
  const room = stampRoom(world, world.rooms.length, RoomType.OFFICE, rx, ry, rw, rh, -1);
  room.name = 'Линия Пристава Пустоты';
  room.wallTex = Tex.VOID_WALL;
  room.floorTex = Tex.F_VOID;
  setVoidRoomTextures(world, room.x, room.y, room.w, room.h);

  const entranceY = world.wrap(room.y + (room.h >> 1));
  placeDoorAt(world, room.x - 1, entranceY, room.id);
  carveCorridor(world, sx, sy, room.x - 2, entranceY);
  const entrance = world.doors.get(world.idx(room.x - 1, entranceY));
  if (entrance) {
    entrance.state = DoorState.OPEN;
    entrance.timer = 0;
  }

  const exitY = world.wrap(room.y + (room.h >> 1));
  placeDoorAt(world, room.x + room.w, exitY, room.id);
  carveCorridor(world, room.x + room.w + 1, exitY, sx, sy);
  const penaltyDoorIdx = world.idx(room.x + room.w, exitY);
  const exit = world.doors.get(penaltyDoorIdx);
  if (exit) {
    exit.state = DoorState.OPEN;
    exit.timer = 0;
  }

  for (let dx = 2; dx < room.w - 2; dx += 3) {
    world.features[world.idx(room.x + dx, room.y + 2)] = Feature.DESK;
  }
  for (let dx = 3; dx < room.w - 3; dx += 4) {
    world.features[world.idx(room.x + dx, room.y + room.h - 3)] = Feature.APPARATUS;
  }
  world.features[world.idx(room.x + 1, room.y + 1)] = Feature.SCREEN;
  world.features[world.idx(room.x + room.w - 2, room.y + 1)] = Feature.SCREEN;
  world.features[world.idx(room.x + 2, room.y + room.h - 2)] = Feature.LAMP;
  world.features[world.idx(room.x + room.w - 3, room.y + room.h - 2)] = Feature.LAMP;
  const anchorX = world.wrap(room.x + (room.w >> 1));
  const anchorY = world.wrap(room.y + (room.h >> 1));
  world.features[world.idx(anchorX, anchorY)] = Feature.APPARATUS;

  const baseTags = [TAG_RULE, TAG_PROTOCOL];
  const ruleContainerId = addPristavContainer(
    world,
    room.id,
    room.x + (room.w >> 1),
    room.y + 1,
    'Табличка Пристава: сначала правило',
    [{
      defId: 'note',
      count: 1,
      data: {
        text: 'ПРАВИЛО: перед прямым выходом нужна отметка. Обойти линию, заплатить 5 рублей или сломать якорь. Прямой проход без отметки считается нарушением.',
      },
    }],
    [...baseTags, TAG_STATED],
  );
  const obeyContainerId = addPristavContainer(
    world,
    room.id,
    room.x + 3,
    room.y + room.h - 3,
    'Отметка: обойти линию',
    [{
      defId: 'note',
      count: 1,
      data: { text: 'ОБХОД: отметка ставится без платы. Пристав не появляется, прямой выход остается обычной дверью.' },
    }],
    [...baseTags, TAG_OBEY],
  );
  const payContainerId = addPristavContainer(
    world,
    room.id,
    room.x + 6,
    room.y + room.h - 3,
    'Блюдце пошлины: 5 рублей',
    [{
      defId: 'note',
      count: 1,
      data: { text: 'ПОШЛИНА: снять 5 рублей и получить ПСИ-метку. Предметы не облагаются.' },
    }],
    [...baseTags, TAG_PAY],
  );
  const violateContainerId = addPristavContainer(
    world,
    room.id,
    room.x + room.w - 7,
    room.y + room.h - 3,
    'Прямой порог: нарушить',
    [{
      defId: 'note',
      count: 1,
      data: { text: 'НАРУШЕНИЕ: идти прямо без отметки. Пристав берет только дешевую расходную вещь и закрывает линию, но дверь не запирает навсегда.' },
    }],
    [...baseTags, TAG_VIOLATE],
  );
  const anchorContainerId = addPristavContainer(
    world,
    room.id,
    anchorX,
    anchorY,
    'Якорь протокола: сломать',
    [{
      defId: 'void_spike',
      count: 1,
    }],
    [...baseTags, TAG_ANCHOR],
  );

  registerRouteCue(world, {
    id: 'void_pristav_pustoty_rule',
    x: room.x + 1.5,
    y: entranceY + 0.5,
    targetX: room.x + (room.w >> 1) + 0.5,
    targetY: room.y + 1.5,
    floor: FloorLevel.VOID,
    roomId: room.id,
    targetRoomId: room.id,
    zoneId: world.zoneMap[world.idx(room.x + 1, entranceY)],
    label: 'линия Пристава',
    hint: 'сначала правило: обход, пошлина или якорь',
    targetName: 'табличка правила Пристава',
    color: '#8ff',
    tags: [PROTOCOL_ID, 'void', 'rule', 'bypass', 'late_hazard'],
    toneSeed: room.id * 997 + 46019,
    radius: 9,
    targetRadius: 2.4,
    cooldownSec: 30,
    heardText: 'Линия Пристава звенит как канцелярский звонок: сначала отметка, потом прямой выход.',
    followedText: 'Вы дошли до таблички Пристава. Теперь выбор явный: обойти, заплатить, нарушить или ломать якорь.',
    ignoredText: 'Линия Пристава осталась без отметки. Прямой порог будет считать это нарушением.',
  });

  registerPristavContext({
    world,
    entities,
    roomId: room.id,
    ruleContainerId,
    obeyContainerId,
    payContainerId,
    violateContainerId,
    anchorContainerId,
    penaltyDoorIdx,
    anchorX,
    anchorY,
  });
}
