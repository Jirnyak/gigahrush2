/* -- Матка Документов: capped Ministry paper-boss room puzzle --- */

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
import { Spr, monsterSpr } from '../../render/sprite_index';
import { changeResourceStock } from '../../systems/economy';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  type NextId, addItemDrop, createAdminRoom, setFeature, spawnAdminNpc,
} from '../admin_common';
import { genLog } from '../log';

export const MATKA_DOKUMENTOV_ID = 'matka_dokumentov';
export const MATKA_DOKUMENTOV_ROOM = 'Матка Документов: стол размножения';
export const MATKA_DOKUMENTOV_THREAT_CAP = 5;

const MAX_TOTAL_SPAWNS = 5;
const MAX_EMPOWERMENTS = 2;
const QUEST_FIND_ROOM = 'matka_dokumentov_find_room';
const QUEST_BRING_ORDER = 'matka_dokumentov_bring_unsigned_order';
const CLERK_ID = 'matka_dokumentov_cancel_clerk';
const TAG_BURN = 'burn_stack';
const TAG_CABINET = 'cabinet';
const TAG_CANCEL = 'cancellation_form';
const TAG_CORE = 'paper_anchor';
const TAG_DECOY = 'decoy_forms';
const TAG_WRONG = 'wrong_stack';
const BASE_TAGS = [MATKA_DOKUMENTOV_ID, 'monster', 'documents', 'boss', 'ministry'] as const;

const CLERK_DEF: PlotNpcDef = {
  name: 'Нина Отменная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 120, maxHp: 120, money: 75, speed: 0.85,
  inventory: [
    { defId: 'blank_form', count: 2 },
    { defId: 'seal_wax', count: 1 },
    { defId: 'note', count: 2 },
  ],
  talkLines: [
    'Матка Документов не рожает бумагу. Она рожает основания.',
    'Если стол задышал, не спорьте с ним пулями. Закройте шкафы или найдите форму отмены.',
    'Пустой бланк отвлекает ее лучше крика. У пустоты в министерстве высокий приоритет.',
    'Неправильную стопку лучше сжечь, чем читать. Чтение считается согласием.',
  ],
  talkLinesPost: [
    'Стол замолчал. Теперь документы хотя бы делают вид, что лежат.',
    'Печать порядка не лечит порядок. Она делает его громче.',
  ],
};

registerSideQuest(CLERK_ID, CLERK_DEF, [
  {
    id: QUEST_FIND_ROOM,
    giverNpcId: CLERK_ID,
    type: QuestType.VISIT,
    desc: 'Нина Отменная: «Найдите стол Матки Документов {dir}. Бумагу там надо гасить формой, а не очередью.»',
    targetRoomName: MATKA_DOKUMENTOV_ROOM,
    targetRoomType: RoomType.OFFICE,
    targetFloor: FloorLevel.MINISTRY,
    targetZoneTag: 'documents',
    targetHint: 'Министерство: архивный кабинет со шкафами, бланками и центральным столом.',
    rewardItem: 'blank_form', rewardCount: 1,
    relationDelta: 5, xpReward: 35, moneyReward: 20,
    eventTags: [...BASE_TAGS, 'lead'],
    eventData: { monsterId: MATKA_DOKUMENTOV_ID, counterplay: 'cabinets_forms_core' },
  },
  {
    id: QUEST_BRING_ORDER,
    giverNpcId: CLERK_ID,
    type: QuestType.FETCH,
    desc: 'Нина Отменная: «Принесите приказ без подписи из маточного стола. Если сможете, сначала погасите форму отмены.»',
    targetItem: 'unsigned_order', targetCount: 1,
    rewardItem: 'psi_order_seal', rewardCount: 1,
    extraRewards: [{ defId: 'seal_wax', count: 2 }],
    relationDelta: 12, xpReward: 85, moneyReward: 90,
    requiresSideQuestDone: QUEST_FIND_ROOM,
    eventTags: [...BASE_TAGS, 'cleared', 'reward'],
    eventData: { monsterId: MATKA_DOKUMENTOV_ID, rewardTrace: 'psi_order_seal' },
  },
]);

interface MatkaDokumentovContext {
  world: World;
  entities: Entity[];
  roomId: number;
  coreContainerId: number;
  cancelContainerId: number;
  burnContainerId: number;
  decoyContainerId: number;
  cabinetContainerIds: number[];
  closedCabinetIds: number[];
  threatIds: number[];
  awakened: boolean;
  cleared: boolean;
  decoyForms: boolean;
  burnedStack: boolean;
  delayPublished: boolean;
  rewardDropped: boolean;
  totalSpawned: number;
  empowerments: number;
}

const contexts: MatkaDokumentovContext[] = [];
const MAX_CONTEXTS = 4;

function registerContext(ctx: MatkaDokumentovContext): void {
  const existing = contexts.find(item => item.world === ctx.world && item.roomId === ctx.roomId);
  if (existing) {
    existing.entities = ctx.entities;
    existing.coreContainerId = ctx.coreContainerId;
    existing.cancelContainerId = ctx.cancelContainerId;
    existing.burnContainerId = ctx.burnContainerId;
    existing.decoyContainerId = ctx.decoyContainerId;
    existing.cabinetContainerIds = ctx.cabinetContainerIds;
    return;
  }
  contexts.push(ctx);
  if (contexts.length > MAX_CONTEXTS) contexts.splice(0, contexts.length - MAX_CONTEXTS);
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addMatkaContainer(
  world: World,
  room: Room,
  x: number,
  y: number,
  name: string,
  kind: ContainerKind,
  inventory: WorldContainer['inventory'],
  tags: string[],
): number {
  const wx = world.wrap(x);
  const wy = world.wrap(y);
  const ci = world.idx(wx, wy);
  const id = nextContainerId(world);
  world.addContainer({
    id,
    x: wx,
    y: wy,
    floor: FloorLevel.MINISTRY,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind,
    name,
    inventory: inventory.map(item => ({ ...item })),
    capacitySlots: Math.max(4, inventory.length + 1),
    faction: Faction.CITIZEN,
    access: 'public',
    discovered: true,
    tags: [MATKA_DOKUMENTOV_ID, 'documents', 'paper', ...tags],
  });
  setFeature(world, wx, wy, kind === ContainerKind.SAFE ? Feature.APPARATUS : Feature.SHELF);
  return id;
}

function findContextByContainer(event: WorldEvent): MatkaDokumentovContext | undefined {
  if (event.containerId === undefined) return undefined;
  for (let i = contexts.length - 1; i >= 0; i--) {
    const ctx = contexts[i];
    if (
      ctx.coreContainerId === event.containerId ||
      ctx.cancelContainerId === event.containerId ||
      ctx.burnContainerId === event.containerId ||
      ctx.decoyContainerId === event.containerId ||
      ctx.cabinetContainerIds.includes(event.containerId)
    ) return ctx;
  }
  return undefined;
}

function findContextByThreat(event: WorldEvent): MatkaDokumentovContext | undefined {
  if (event.targetId === undefined) return undefined;
  for (let i = contexts.length - 1; i >= 0; i--) {
    if (contexts[i].threatIds.includes(event.targetId)) return contexts[i];
  }
  return undefined;
}

function hasTag(event: WorldEvent, tag: string): boolean {
  return event.tags.includes(tag);
}

function getActiveThreats(ctx: MatkaDokumentovContext): Entity[] {
  const threats: Entity[] = [];
  let foundCount = 0;
  for (let i = 0; i < ctx.entities.length; i++) {
    const e = ctx.entities[i];
    if (ctx.threatIds.includes(e.id)) {
      if (e.alive) threats.push(e);
      foundCount++;
      if (foundCount === ctx.threatIds.length) break;
    }
  }
  return threats;
}

function nextEntityId(entities: Entity[]): number {
  let id = 1;
  for (const e of entities) id = Math.max(id, e.id + 1);
  return id;
}

function publishMatkaEvent(
  state: GameState,
  ctx: MatkaDokumentovContext,
  source: WorldEvent,
  phase: string,
  line: string,
  severity: 2 | 3 | 4 | 5,
  data: Record<string, unknown> = {},
): void {
  const room = ctx.world.rooms[ctx.roomId];
  publishEvent(state, {
    type: `matka_dokumentov_${phase}` as WorldEventType,
    floor: FloorLevel.MINISTRY,
    zoneId: source.zoneId,
    roomId: ctx.roomId,
    x: source.x ?? (room ? room.x + room.w / 2 : undefined),
    y: source.y ?? (room ? room.y + room.h / 2 : undefined),
    actorId: source.actorId,
    actorName: source.actorName,
    actorFaction: source.actorFaction,
    targetId: source.targetId,
    targetName: source.targetName,
    itemId: source.itemId,
    itemName: source.itemName,
    monsterKind: source.monsterKind,
    severity,
    privacy: 'local',
    tags: [...BASE_TAGS, phase, ...source.tags].slice(0, 8),
    data: {
      sourceEventId: source.id,
      roomName: room?.name,
      activeThreats: getActiveThreats(ctx).length,
      totalSpawned: ctx.totalSpawned,
      cap: MATKA_DOKUMENTOV_THREAT_CAP,
      decoyForms: ctx.decoyForms,
      burnedStack: ctx.burnedStack,
      closedCabinets: ctx.closedCabinetIds.length,
      ...data,
    },
  });
  state.msgs.push(msg(line, state.time, severity >= 4 ? '#f8c' : '#d9c38a'));
}

function findThreatSpawnCell(ctx: MatkaDokumentovContext, slot: number): { x: number; y: number } | null {
  const room = ctx.world.rooms[ctx.roomId];
  if (!room) return null;
  const cx = room.x + Math.floor(room.w / 2);
  const anchors: [number, number][] = [
    [room.x + 3, room.y + 3],
    [room.x + room.w - 4, room.y + 3],
    [room.x + 3, room.y + room.h - 4],
    [room.x + room.w - 4, room.y + room.h - 4],
    [cx, room.y + room.h - 3],
  ];
  const [ax, ay] = anchors[slot % anchors.length];
  for (let attempt = 0; attempt < 48; attempt++) {
    const angle = (Math.PI * 2 * (slot + attempt / 9)) / MATKA_DOKUMENTOV_THREAT_CAP;
    const dist = attempt < 4 ? 0 : 1 + (attempt % 4);
    const x = ctx.world.wrap(ax + Math.round(Math.cos(angle) * dist));
    const y = ctx.world.wrap(ay + Math.round(Math.sin(angle) * dist));
    const ci = ctx.world.idx(x, y);
    if (ctx.world.cells[ci] === Cell.FLOOR && ctx.world.roomMap[ci] === room.id) return { x, y };
  }
  return null;
}

function spawnPaperThreats(ctx: MatkaDokumentovContext, desired: number): number {
  if (ctx.cleared) return 0;
  const active = getActiveThreats(ctx).length;
  const availableActive = Math.max(0, MATKA_DOKUMENTOV_THREAT_CAP - active);
  const availableTotal = Math.max(0, MAX_TOTAL_SPAWNS - ctx.totalSpawned);
  const count = Math.min(desired, availableActive, availableTotal);
  let spawned = 0;
  let nextId = nextEntityId(ctx.entities);

  for (let i = 0; i < count; i++) {
    const pos = findThreatSpawnCell(ctx, ctx.totalSpawned + i);
    if (!pos) continue;
    const kind = (ctx.totalSpawned + i) % 2 === 0 ? MonsterKind.PARAGRAPH : MonsterKind.PECHATEED;
    const def = MONSTERS[kind];
    const ci = ctx.world.idx(pos.x, pos.y);
    const zoneLevel = ctx.world.zones[ctx.world.zoneMap[ci]]?.level ?? 3;
    const hp = Math.max(10, Math.round(scaleMonsterHp(def.hp, zoneLevel) * 0.85));
    const threat: Entity = {
      id: nextId++,
      type: EntityType.MONSTER,
      x: pos.x + 0.5,
      y: pos.y + 0.5,
      angle: Math.random() * Math.PI * 2,
      pitch: 0,
      alive: true,
      speed: scaleMonsterSpeed(def.speed, zoneLevel) * 0.9,
      sprite: monsterSpr(kind),
      hp,
      maxHp: hp,
      monsterKind: kind,
      monsterDmgMult: 0.9,
      attackCd: 0.65 + i * 0.2,
      ai: { goal: AIGoal.WANDER, tx: pos.x, ty: pos.y, path: [], pi: 0, stuck: 0, timer: 0 },
      rpg: randomRPG(zoneLevel),
      spriteScale: kind === MonsterKind.PARAGRAPH ? 0.9 : 0.95,
    };
    ctx.entities.push(threat);
    ctx.threatIds.push(threat.id);
    ctx.totalSpawned++;
    spawned++;
  }
  return spawned;
}

function empowerPaperThreats(ctx: MatkaDokumentovContext): number {
  if (ctx.cleared || ctx.empowerments >= MAX_EMPOWERMENTS) return 0;
  const threats = getActiveThreats(ctx).slice(0, 2);
  for (const threat of threats) {
    threat.monsterDmgMult = Math.min(1.25, (threat.monsterDmgMult ?? 1) + 0.12);
    threat.speed *= 1.04;
    if (threat.hp !== undefined && threat.maxHp !== undefined) threat.hp = Math.min(threat.maxHp, threat.hp + 4);
  }
  if (threats.length > 0) ctx.empowerments++;
  return threats.length;
}

function dropSealReward(ctx: MatkaDokumentovContext): void {
  if (ctx.rewardDropped) return;
  const room = ctx.world.rooms[ctx.roomId];
  if (!room) return;
  const id = nextEntityId(ctx.entities);
  ctx.entities.push({
    id,
    type: EntityType.ITEM_DROP,
    x: room.x + Math.floor(room.w / 2) + 0.5,
    y: room.y + Math.floor(room.h / 2) + 1.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{ defId: 'psi_order_seal', count: 1 }],
  });
  ctx.rewardDropped = true;
}

function neutralizeOneThreat(ctx: MatkaDokumentovContext): number {
  const threat = getActiveThreats(ctx)[0];
  if (!threat) return 0;
  threat.alive = false;
  threat.hp = 0;
  return 1;
}

function publishDocumentDelay(state: GameState, ctx: MatkaDokumentovContext, event: WorldEvent): void {
  if (ctx.delayPublished) return;
  ctx.delayPublished = true;
  const changed = changeResourceStock(state, 'documents', -2, FloorLevel.MINISTRY);
  publishMatkaEvent(
    state,
    ctx,
    event,
    'document_delay',
    'Матка Документов внесла задержку: коридор отправляет вас через чужое окно.',
    4,
    { documentsStockDelta: changed ? -2 : 0, forcedRoute: 'permit_office' },
  );
}

function awakenAnchor(state: GameState, ctx: MatkaDokumentovContext, event: WorldEvent, reason: string, desired: number): void {
  if (ctx.cleared) return;
  if (!ctx.awakened) {
    ctx.awakened = true;
    publishMatkaEvent(
      state,
      ctx,
      event,
      'anchor_awakened',
      'Шкафы вдохнули бумагой. На столе печать ударила сама.',
      4,
      { reason },
    );
  }
  const softened = (ctx.decoyForms ? 1 : 0) + (ctx.burnedStack ? 1 : 0);
  const spawned = spawnPaperThreats(ctx, Math.max(1, desired - softened));
  const empowered = spawned > 0 ? 0 : empowerPaperThreats(ctx);
  publishMatkaEvent(
    state,
    ctx,
    event,
    'paper_pressure',
    spawned > 0
      ? `Бумажная угроза поднялась из шкафа: ${spawned}.`
      : empowered > 0
        ? 'Активные бумаги получили новую печать.'
        : 'Матка шуршит, но лимит живой бумаги уже выбран.',
    spawned > 0 || empowered > 0 ? 4 : 3,
    { reason, spawned, empowered },
  );
}

function clearAnchor(
  state: GameState,
  ctx: MatkaDokumentovContext,
  event: WorldEvent,
  method: string,
  killActive: boolean,
): void {
  if (ctx.cleared) return;
  ctx.cleared = true;
  const room = ctx.world.rooms[ctx.roomId];
  if (room) room.sealed = true;

  let neutralized = 0;
  if (killActive) {
    for (const threat of getActiveThreats(ctx)) {
      threat.alive = false;
      threat.hp = 0;
      neutralized++;
    }
    dropSealReward(ctx);
  }

  publishMatkaEvent(
    state,
    ctx,
    event,
    'boss_cleared',
    killActive
      ? 'Форма отмены легла на стол. Бумаги перестали размножаться.'
      : 'Приказ вырван из маточного стола. Бумаги уже поднялись, но новых не будет.',
    5,
    { method, neutralized, rewardDropped: ctx.rewardDropped },
  );
}

function handleContainerEvent(state: GameState, event: WorldEvent): void {
  if (event.type !== 'container_opened' && event.type !== 'item_stolen') return;
  if (!hasTag(event, MATKA_DOKUMENTOV_ID)) return;
  const ctx = findContextByContainer(event);
  if (!ctx) return;

  if (hasTag(event, TAG_DECOY) && !ctx.decoyForms) {
    ctx.decoyForms = true;
    publishMatkaEvent(
      state,
      ctx,
      event,
      'decoy_forms_set',
      'Пустые бланки ушли приманкой: стол считает их заявителями.',
      3,
      { counterplay: TAG_DECOY },
    );
  }

  if (hasTag(event, TAG_BURN) && event.itemId === 'ammo_fuel' && !ctx.burnedStack) {
    ctx.burnedStack = true;
    const neutralized = neutralizeOneThreat(ctx);
    publishMatkaEvent(
      state,
      ctx,
      event,
      'wrong_stack_burned',
      neutralized > 0
        ? 'Неправильная стопка вспыхнула: один бумажный исполнитель осыпался.'
        : 'Неправильная стопка обуглилась. Матке стало труднее размножать основания.',
      3,
      { counterplay: TAG_BURN, neutralized },
    );
  }

  if (hasTag(event, TAG_CABINET) && event.containerId !== undefined && !ctx.closedCabinetIds.includes(event.containerId)) {
    ctx.closedCabinetIds.push(event.containerId);
    const neutralized = neutralizeOneThreat(ctx);
    publishMatkaEvent(
      state,
      ctx,
      event,
      'cabinet_closed',
      neutralized > 0
        ? 'Шкаф захлопнулся. Один лист не успел стать монстром.'
        : 'Шкаф закрыт. Бумажное дыхание стало короче.',
      3,
      { counterplay: TAG_CABINET, neutralized },
    );
    if (ctx.closedCabinetIds.length >= 2) clearAnchor(state, ctx, event, 'cabinets_closed', true);
  }

  if (hasTag(event, TAG_CANCEL)) {
    publishMatkaEvent(
      state,
      ctx,
      event,
      'form_cancelled',
      'Форма отмены прошла без очереди.',
      4,
      { counterplay: TAG_CANCEL },
    );
    clearAnchor(state, ctx, event, 'cancellation_form', true);
    return;
  }

  if (hasTag(event, TAG_CORE)) {
    awakenAnchor(state, ctx, event, 'core_rush', 3);
    clearAnchor(state, ctx, event, 'core_rush', false);
    return;
  }

  if (hasTag(event, TAG_WRONG) && event.itemId !== 'ammo_fuel' && !ctx.burnedStack && !ctx.cleared) {
    publishDocumentDelay(state, ctx, event);
    awakenAnchor(state, ctx, event, 'wrong_stack_read', 2);
  }
}

function handleKillEvent(state: GameState, event: WorldEvent): void {
  if (event.type !== 'player_kill_monster') return;
  const ctx = findContextByThreat(event);
  if (!ctx) return;
  const remaining = getActiveThreats(ctx).length;
  publishMatkaEvent(
    state,
    ctx,
    event,
    'paper_threat_killed',
    remaining > 0
      ? `Бумажная угроза порвана. У стола осталось активных: ${remaining}.`
      : ctx.cleared
        ? 'Последняя поднятая бумага осыпалась после отмены.'
        : 'Последняя бумага порвана, но стол еще требует форму.',
    remaining > 0 ? 3 : 4,
    { remaining },
  );
}

registerWorldEventObserver((state, event) => {
  handleContainerEvent(state, event);
  handleKillEvent(state, event);
});

function decorateRoom(world: World, room: Room): void {
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);

  for (let dx = 2; dx < room.w - 2; dx += 3) {
    setFeature(world, room.x + dx, room.y + 2, Feature.SHELF);
    setFeature(world, room.x + dx, room.y + room.h - 3, Feature.SHELF);
  }
  for (let dy = 3; dy < room.h - 3; dy += 3) {
    setFeature(world, room.x + 1, room.y + dy, Feature.SHELF);
    setFeature(world, room.x + room.w - 2, room.y + dy, Feature.SHELF);
  }
  setFeature(world, cx, cy, Feature.DESK);
  setFeature(world, cx - 1, cy, Feature.TABLE);
  setFeature(world, cx + 1, cy, Feature.TABLE);
  setFeature(world, cx, cy - 2, Feature.LAMP);
  setFeature(world, room.x + 3, room.y + 2, Feature.SCREEN);
  setFeature(world, room.x + room.w - 4, room.y + room.h - 3, Feature.APPARATUS);
  world.wallTex[world.idx(cx, room.y - 1)] = Tex.SCREEN_BASE + 6;
  world.wallTex[world.idx(room.x + room.w, cy)] = Tex.POSTER_BASE + 18;

  stampSurfaceSplat(world, cx, cy, 0.5, 0.5, 5.2, 0.74, 23023, 205, 198, 154, false);
  stampSurfaceSplat(world, cx - 5, cy - 2, 0.5, 0.5, 2.2, 0.58, 23024, 165, 28, 28, true);
  stampSurfaceSplat(world, cx + 6, cy + 3, 0.5, 0.5, 2.6, 0.64, 23025, 210, 205, 170, false);
}

function findGuideSpot(world: World, spawnX: number, spawnY: number, roomId: number): { x: number; y: number } | null {
  const sx = Math.floor(spawnX);
  const sy = Math.floor(spawnY);
  for (let r = 2; r <= 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = world.wrap(sx + dx);
        const y = world.wrap(sy + dy);
        const ci = world.idx(x, y);
        if (world.cells[ci] !== Cell.FLOOR) continue;
        if (world.roomMap[ci] === roomId) continue;
        return { x, y };
      }
    }
  }
  return null;
}

export function generateMatkaDokumentovRoom(
  world: World, nextRoomId: number, entities: Entity[], nextId: NextId, spawnX: number, spawnY: number,
): { nextRoomId: number } {
  const room = createAdminRoom(world, nextRoomId, spawnX, spawnY, {
    type: RoomType.OFFICE,
    name: MATKA_DOKUMENTOV_ROOM,
    w: 15,
    h: 10,
    minDist: 75,
    maxDist: 190,
    wallTex: Tex.MARBLE,
    floorTex: Tex.F_MARBLE_TILE,
  });
  if (!room) return { nextRoomId };

  decorateRoom(world, room);
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);

  const decoyContainerId = addMatkaContainer(
    world,
    room,
    room.x + 3,
    room.y + 3,
    'Лоток пустых бланков-приманок',
    ContainerKind.FILING_CABINET,
    [{ defId: 'blank_form', count: 2 }],
    [TAG_DECOY, 'counterplay'],
  );
  const burnContainerId = addMatkaContainer(
    world,
    room,
    room.x + room.w - 4,
    room.y + 3,
    'Неправильная стопка: на сожжение',
    ContainerKind.TRASH_BIN,
    [
      { defId: 'ammo_fuel', count: 1 },
      { defId: 'note', count: 1, data: 'Если прочитал до конца, документ считает тебя исполнителем.' },
    ],
    [TAG_BURN, TAG_WRONG, 'counterplay'],
  );
  const leftCabinetId = addMatkaContainer(
    world,
    room,
    room.x + 2,
    cy,
    'Левый дышащий шкаф',
    ContainerKind.FILING_CABINET,
    [{ defId: 'ink_bottle', count: 1 }, { defId: 'blank_form', count: 1 }],
    [TAG_CABINET, 'counterplay'],
  );
  const rightCabinetId = addMatkaContainer(
    world,
    room,
    room.x + room.w - 3,
    cy,
    'Правый дышащий шкаф',
    ContainerKind.FILING_CABINET,
    [{ defId: 'seal_wax', count: 1 }, { defId: 'blank_form', count: 1 }],
    [TAG_CABINET, 'counterplay'],
  );
  const cancelContainerId = addMatkaContainer(
    world,
    room,
    cx - 3,
    room.y + room.h - 3,
    'Форма отмены самовольной печати',
    ContainerKind.CASHBOX,
    [{ defId: 'seal_wax', count: 1 }, { defId: 'official_permit_slip', count: 1 }],
    [TAG_CANCEL, 'stamp', 'counterplay'],
  );
  const coreContainerId = addMatkaContainer(
    world,
    room,
    cx,
    cy,
    'Маточный стол неподписанных приказов',
    ContainerKind.SAFE,
    [{ defId: 'unsigned_order', count: 1 }, { defId: 'missing_record_file', count: 1 }],
    [TAG_CORE, 'reward', 'boss_core'],
  );

  addItemDrop(entities, nextId, cx - 2, cy + 2, 'blank_form', 1);
  addItemDrop(entities, nextId, cx + 2, cy + 2, 'seal_wax', 1);
  const guideSpot = findGuideSpot(world, spawnX, spawnY, room.id);
  if (guideSpot) spawnAdminNpc(entities, nextId, CLERK_DEF, CLERK_ID, guideSpot.x, guideSpot.y);

  registerContext({
    world,
    entities,
    roomId: room.id,
    coreContainerId,
    cancelContainerId,
    burnContainerId,
    decoyContainerId,
    cabinetContainerIds: [leftCabinetId, rightCabinetId],
    closedCabinetIds: [],
    threatIds: [],
    awakened: false,
    cleared: false,
    decoyForms: false,
    burnedStack: false,
    delayPublished: false,
    rewardDropped: false,
    totalSpawned: 0,
    empowerments: 0,
  });

  genLog(`[MINISTRY_ADMIN] ${room.name} at (${room.x}, ${room.y}) room #${room.id}; ${MATKA_DOKUMENTOV_ID}`);
  return { nextRoomId: room.id + 1 };
}
