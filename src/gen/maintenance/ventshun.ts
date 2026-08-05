/* ── Monster_07 Ventshun: warned vent predator encounter ──────── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal, Cell, ContainerKind, EntityType, Feature, FloorLevel,
  MonsterKind, RoomType, Tex, W, msg,
  type Entity, type GameState, type Room, type WorldContainer, type WorldEvent,
} from '../../core/types';
import type { World } from '../../core/world';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { registerRouteCue } from '../../systems/route_cues';
import {
  type MaintContentCtx, findMaintArea, setFeature, setWater, stampMaintRoom,
} from './content_helpers';

const CUE_ID = 'maintenance_ventshun_warning';
const TAG_SITE = 'ventshun';
const TAG_MONSTER = 'monster';
const TAG_VENT = 'vent';
const TAG_AMBUSH = 'ambush';
const TAG_MAINT = 'maintenance';
const TAG_VALVE = 'valve';
const TAG_REWARD = 'reward';
const ROOM_W = 22;
const ROOM_H = 13;
const MAX_CONTEXTS = 4;
const MAX_THREATS = 3;

interface VentshunContext {
  world: World;
  entities: Entity[];
  roomId: number;
  warningX: number;
  warningY: number;
  targetX: number;
  targetY: number;
  valveContainerId: number;
  rewardContainerId: number;
  ventCells: number[];
  threatIds: number[];
  warned: boolean;
  triggered: boolean;
  sealed: boolean;
  cleared: boolean;
}

const contexts: VentshunContext[] = [];

function registerVentshunContext(ctx: VentshunContext): void {
  const existing = contexts.find(item => item.world === ctx.world && item.roomId === ctx.roomId);
  if (existing) {
    existing.entities = ctx.entities;
    existing.valveContainerId = ctx.valveContainerId;
    existing.rewardContainerId = ctx.rewardContainerId;
    existing.ventCells = ctx.ventCells;
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

function addVentshunContainer(
  ctx: MaintContentCtx,
  room: Room,
  x: number,
  y: number,
  name: string,
  kind: ContainerKind,
  inventory: WorldContainer['inventory'],
  tags: string[],
): number {
  const wx = ctx.world.wrap(x);
  const wy = ctx.world.wrap(y);
  const id = nextContainerId(ctx.world);
  ctx.world.addContainer({
    id,
    x: wx,
    y: wy,
    floor: FloorLevel.MAINTENANCE,
    roomId: room.id,
    zoneId: ctx.world.zoneMap[ctx.world.idx(wx, wy)],
    kind,
    name,
    inventory: inventory.map(item => ({ ...item })),
    capacitySlots: Math.max(4, inventory.length + 1),
    access: 'public',
    discovered: true,
    tags: [TAG_SITE, TAG_MONSTER, TAG_VENT, TAG_AMBUSH, TAG_MAINT, ...tags],
  });
  setFeature(ctx.world, wx, wy, Feature.SHELF);
  return id;
}

function findContextByCue(event: WorldEvent): VentshunContext | undefined {
  if (event.data?.cueId !== CUE_ID) return undefined;
  for (let i = contexts.length - 1; i >= 0; i--) {
    const ctx = contexts[i];
    if (event.roomId === ctx.roomId || event.zoneId === ctx.world.zoneMap[ctx.world.idx(Math.floor(ctx.warningX), Math.floor(ctx.warningY))]) return ctx;
  }
  return undefined;
}

function findContextByContainer(event: WorldEvent): VentshunContext | undefined {
  if (event.containerId === undefined) return undefined;
  for (let i = contexts.length - 1; i >= 0; i--) {
    const ctx = contexts[i];
    if (ctx.valveContainerId === event.containerId || ctx.rewardContainerId === event.containerId) return ctx;
  }
  return undefined;
}

function findContextByThreat(event: WorldEvent): VentshunContext | undefined {
  if (event.targetId === undefined) return undefined;
  for (let i = contexts.length - 1; i >= 0; i--) {
    if (contexts[i].threatIds.includes(event.targetId)) return contexts[i];
  }
  return undefined;
}

function routeCueAction(event: WorldEvent): string {
  const action = event.data?.action;
  return typeof action === 'string' ? action : '';
}

function pushHud(state: GameState, line: string, color: string): void {
  state.msgs.push(msg(line, state.time, color));
}

function eventTags(phase: string, source: WorldEvent): string[] {
  const tags = [TAG_MONSTER, TAG_VENT, TAG_AMBUSH, TAG_MAINT, TAG_SITE, phase];
  for (const tag of source.tags) {
    if (tags.length >= 8) break;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

function publishVentshunEvent(
  state: GameState,
  ctx: VentshunContext,
  source: WorldEvent,
  phase: string,
  line: string,
  severity: 2 | 3 | 4,
  data: Record<string, unknown> = {},
): void {
  const room = ctx.world.rooms[ctx.roomId];
  publishEvent(state, {
    type: phase === 'sprung' ? 'monster_sighted' : 'rumor_observed',
    floor: FloorLevel.MAINTENANCE,
    zoneId: source.zoneId,
    roomId: ctx.roomId,
    x: source.x ?? ctx.targetX,
    y: source.y ?? ctx.targetY,
    actorId: source.actorId,
    actorName: source.actorName,
    actorFaction: source.actorFaction,
    targetName: 'Вентшун',
    monsterKind: phase === 'sprung' ? MonsterKind.TUBE_EEL : undefined,
    severity,
    privacy: 'local',
    tags: eventTags(phase, source),
    data: {
      sourceEventId: source.id,
      roomName: room?.name,
      cueId: CUE_ID,
      spawnedThreats: ctx.threatIds.length,
      cap: MAX_THREATS,
      sealed: ctx.sealed,
      cleared: ctx.cleared,
      ...data,
    },
  });
  pushHud(state, line, severity >= 4 ? '#f97' : '#9cf');
}

function nextEntityId(entities: Entity[]): number {
  let id = 1;
  for (const e of entities) id = Math.max(id, e.id + 1);
  return id;
}

function findSpawnCell(ctx: VentshunContext, slot: number): { x: number; y: number } | null {
  const cell = ctx.ventCells[slot % ctx.ventCells.length];
  const bx = cell % W;
  const by = (cell / W) | 0;
  for (let attempt = 0; attempt < 90; attempt++) {
    const angle = (Math.PI * 2 * (slot + attempt / 9)) / MAX_THREATS;
    const dist = attempt < 3 ? 0 : 1 + (attempt % 4);
    const x = ctx.world.wrap(bx + Math.round(Math.cos(angle) * dist));
    const y = ctx.world.wrap(by + Math.round(Math.sin(angle) * dist));
    const ci = ctx.world.idx(x, y);
    if ((ctx.world.cells[ci] === Cell.FLOOR || ctx.world.cells[ci] === Cell.WATER) && ctx.world.roomMap[ci] === ctx.roomId) return { x, y };
  }
  return null;
}

function thickenVentSmog(ctx: VentshunContext): void {
  for (const cell of ctx.ventCells) {
    const x = cell % W;
    const y = (cell / W) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ci = ctx.world.idx(x + dx, y + dy);
        ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 72);
      }
    }
  }
  ctx.world.markFogDirty();
}

function spawnVentshunThreats(ctx: VentshunContext, source: WorldEvent): number {
  if (ctx.threatIds.length > 0 || ctx.ventCells.length === 0) return 0;
  const kinds = [MonsterKind.TUBE_EEL, MonsterKind.SBORKA, MonsterKind.SBORKA];
  const count = 2 + ((source.id + ctx.roomId) % 2);
  let nextId = nextEntityId(ctx.entities);
  let spawned = 0;
  thickenVentSmog(ctx);

  for (let i = 0; i < Math.min(count, MAX_THREATS); i++) {
    const kind = kinds[i];
    const def = MONSTERS[kind];
    const pos = findSpawnCell(ctx, i);
    if (!def || !pos) continue;
    const ci = ctx.world.idx(pos.x, pos.y);
    const zoneLevel = ctx.world.zones[ctx.world.zoneMap[ci]]?.level ?? 5;
    const hp = scaleMonsterHp(def.hp, zoneLevel);
    const threat: Entity = {
      id: nextId++,
      type: EntityType.MONSTER,
      x: pos.x + 0.5,
      y: pos.y + 0.5,
      angle: Math.atan2((source.y ?? ctx.warningY) - pos.y, (source.x ?? ctx.warningX) - pos.x),
      pitch: 0,
      alive: true,
      speed: scaleMonsterSpeed(def.speed, zoneLevel),
      sprite: monsterSpr(kind),
      hp,
      maxHp: hp,
      monsterKind: kind,
      attackCd: 0.25 + i * 0.2,
      ai: { goal: AIGoal.HUNT, tx: source.x ?? ctx.warningX, ty: source.y ?? ctx.warningY, path: [], pi: 0, stuck: 0, timer: 0 },
      rpg: randomRPG(zoneLevel),
      spriteScale: kind === MonsterKind.SBORKA ? 0.72 : 0.95,
    };
    ctx.entities.push(threat);
    ctx.threatIds.push(threat.id);
    spawned++;
  }
  return spawned;
}

function triggerVentshun(state: GameState, ctx: VentshunContext, event: WorldEvent, reason: string): void {
  if (ctx.triggered || ctx.sealed || ctx.cleared) return;
  ctx.triggered = true;
  const spawned = spawnVentshunThreats(ctx, event);
  publishVentshunEvent(
    state,
    ctx,
    event,
    'sprung',
    spawned > 0
      ? 'Вентшун кашлянул металлом: из отмеченной решетки полезли твари.'
      : 'Вентшун дернул решетку, но труба осталась пустой.',
    spawned > 0 ? 4 : 3,
    { reason, spawnedNow: spawned },
  );
}

function sealVentshun(state: GameState, ctx: VentshunContext, event: WorldEvent, reason: string): void {
  if (ctx.cleared) return;
  ctx.sealed = true;
  let stopped = 0;
  const entityMap = new Map<number, Entity>();
  for (let i = 0; i < ctx.entities.length; i++) {
    const e = ctx.entities[i];
    entityMap.set(e.id, e);
  }
  for (const id of ctx.threatIds) {
    const threat = entityMap.get(id);
    if (threat?.alive) {
      threat.alive = false;
      threat.hp = 0;
      stopped++;
    }
  }
  ctx.cleared = true;
  publishVentshunEvent(
    state,
    ctx,
    event,
    'cleared',
    reason === 'ignored'
      ? 'Игрок ушел из-под решетки. Вентшун простучал по пустому бетону и затих.'
      : stopped > 0
        ? 'Клапан ударил по стояку: Вентшун захлебнулся в трубе.'
        : 'Клапан отсек кашляющую решетку до броска.',
    stopped > 0 ? 4 : 3,
    { reason, stoppedThreats: stopped },
  );
}

function handleCueEvent(state: GameState, event: WorldEvent): void {
  if (event.type !== 'rumor_observed') return;
  const ctx = findContextByCue(event);
  if (!ctx) return;
  const action = routeCueAction(event);
  if (action === 'heard' || action === 'inspected' || action === 'debug') {
    ctx.warned = true;
    return;
  }
  if (action === 'ignored') {
    ctx.warned = true;
    sealVentshun(state, ctx, event, 'ignored');
    return;
  }
  if (action === 'followed') {
    ctx.warned = true;
    triggerVentshun(state, ctx, event, 'warning_zone_crossed');
  }
}

function handleContainerEvent(state: GameState, event: WorldEvent): void {
  if (event.type !== 'container_opened' && event.type !== 'item_stolen') return;
  if (!event.tags.includes(TAG_SITE)) return;
  const ctx = findContextByContainer(event);
  if (!ctx) return;

  if (event.containerId === ctx.valveContainerId) {
    sealVentshun(state, ctx, event, 'valve');
    return;
  }

  if (event.containerId === ctx.rewardContainerId) {
    if (!ctx.warned) {
      ctx.warned = true;
      publishVentshunEvent(
        state,
        ctx,
        event,
        'warning',
        'Пыль с решетки попала на руки. Вентшун предупредил, но еще не бросился.',
        3,
        { reason: 'loot_before_cue' },
      );
      return;
    }
    triggerVentshun(state, ctx, event, 'reward_loot');
  }
}

function handleKillEvent(state: GameState, event: WorldEvent): void {
  if (event.type !== 'player_kill_monster') return;
  const ctx = findContextByThreat(event);
  if (!ctx || ctx.cleared) return;
  const remaining = ctx.threatIds.filter(id => ctx.entities.some(e => e.id === id && e.alive)).length;
  if (remaining > 0) {
    publishVentshunEvent(
      state,
      ctx,
      event,
      'wounded',
      `Вентшун дернулся в трубе. Под решеткой осталось еще ${remaining}.`,
      3,
      { remainingThreats: remaining },
    );
    return;
  }
  ctx.cleared = true;
  publishVentshunEvent(
    state,
    ctx,
    event,
    'cleared',
    'Последняя тварь из решетки упала. Вентшун оставил только фильтровую пыль.',
    4,
    { reason: 'all_threats_killed' },
  );
}

function handleVentshunEvents(state: GameState, event: WorldEvent): void {
  handleCueEvent(state, event);
  handleContainerEvent(state, event);
  handleKillEvent(state, event);
}

registerWorldEventObserver(handleVentshunEvents);

function markVent(ctx: MaintContentCtx, room: Room, x: number, y: number, seed: number): number {
  const ci = ctx.world.idx(x, y);
  stampSurfaceSplat(ctx.world, x, y, 0.5, 0.45, 0.45, 80, seed, 136, 128, 106);
  ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 42);
  setFeature(ctx.world, x, y, Feature.APPARATUS);
  if (seed % 2 === 0) setWater(ctx.world, x, y + 1);
  ctx.world.roomMap[ci] = room.id;
  return ci;
}

function decorateVentshunRoom(ctx: MaintContentCtx, room: Room): number[] {
  const vents = [
    markVent(ctx, room, room.x + 5, room.y + 3, 70107),
    markVent(ctx, room, room.x + 11, room.y + 3, 70108),
    markVent(ctx, room, room.x + 17, room.y + 4, 70109),
  ];

  for (let x = room.x + 2; x < room.x + room.w - 2; x++) {
    if (x % 3 === 0) stampSurfaceSplat(ctx.world, x, room.y + 2, 0.5, 0.5, 0.2, 55, 70200 + x, 96, 92, 82);
  }
  for (let x = room.x + 3; x < room.x + room.w - 3; x += 4) {
    setFeature(ctx.world, x, room.y + room.h - 3, Feature.LAMP);
  }
  setFeature(ctx.world, room.x + 2, room.y + room.h - 4, Feature.MACHINE);
  setFeature(ctx.world, room.x + room.w - 3, room.y + room.h - 3, Feature.SHELF);
  ctx.world.markFogDirty();
  return vents;
}

function placeVentshunRoom(ctx: MaintContentCtx): Room {
  const pos = findMaintArea(
    ctx.world,
    Math.floor(ctx.spawnX),
    Math.floor(ctx.spawnY),
    ROOM_W,
    ROOM_H,
    90,
    190,
  );

  return stampMaintRoom(
    ctx.world,
    ctx.world.rooms.length,
    RoomType.CORRIDOR,
    pos.x,
    pos.y,
    ROOM_W,
    ROOM_H,
    'Вентшун: кашляющие решетки и безопасная полоса у клапана',
    Tex.PIPE,
    Tex.F_CONCRETE,
  );
}

function placeVentshunContainers(ctx: MaintContentCtx, room: Room): { valveContainerId: number; rewardContainerId: number } {
  const valveContainerId = addVentshunContainer(
    ctx,
    room,
    room.x + 2,
    room.y + room.h - 4,
    'Клапан отсечки Вентшуна: дернуть и отойти',
    ContainerKind.TOOL_LOCKER,
    [
      { defId: 'valve_tag', count: 1, data: 'Бирка: вентшун слышит только стоячих.' },
      { defId: 'duct_tape', count: 1 },
    ],
    [TAG_VALVE, 'counterplay'],
  );
  setFeature(ctx.world, room.x + 2, room.y + room.h - 4, Feature.MACHINE);

  const rewardContainerId = addVentshunContainer(
    ctx,
    room,
    room.x + room.w - 3,
    room.y + 3,
    'Пыльная ниша под решеткой Вентшуна',
    ContainerKind.SECRET_STASH,
    [
      { defId: 'filter_layer', count: 2 },
      { defId: 'gasmask_filter', count: 1 },
      { defId: 'pipe', count: 1 },
      { defId: 'note', count: 1, data: 'Сначала кашель решетки, потом бросок. Не стой под трубой.' },
    ],
    [TAG_REWARD, 'trace', 'loot'],
  );

  return { valveContainerId, rewardContainerId };
}

function registerVentshunCueAndContext(
  ctx: MaintContentCtx,
  room: Room,
  valveContainerId: number,
  rewardContainerId: number,
  ventCells: number[]
): void {
  const warningX = room.x + 4.5;
  const warningY = room.y + room.h - 4.5;
  const targetX = room.x + 11.5;
  const targetY = room.y + 3.5;

  registerRouteCue(ctx.world, {
    id: CUE_ID,
    x: warningX,
    y: warningY,
    targetX,
    targetY,
    floor: FloorLevel.MAINTENANCE,
    roomId: room.id,
    targetRoomId: room.id,
    zoneId: ctx.world.zoneMap[ctx.world.idx(Math.floor(warningX), Math.floor(warningY))],
    label: 'кашляющая решетка',
    hint: 'пыль сыплется с трех труб',
    targetName: 'гнездо Вентшуна',
    color: '#fc9',
    tags: [TAG_MONSTER, TAG_VENT, TAG_AMBUSH, TAG_MAINT, TAG_SITE, 'warning'],
    toneSeed: room.id * 107 + 70107,
    radius: 10,
    targetRadius: 2.4,
    cooldownSec: 24,
    heardText: 'С потолка сыплется пыль: решетка кашляет металлом. Под трубами лучше не стоять.',
    followedText: 'Вы вошли под отмеченные трубы. Вентшун отвечает из потолка.',
    ignoredText: 'Металлический кашель стих за спиной. Вентшун простучал по пустому бетону.',
  });

  registerVentshunContext({
    world: ctx.world,
    entities: ctx.entities,
    roomId: room.id,
    warningX,
    warningY,
    targetX,
    targetY,
    valveContainerId,
    rewardContainerId,
    ventCells,
    threatIds: [],
    warned: false,
    triggered: false,
    sealed: false,
    cleared: false,
  });
}

export function generateVentshun(ctx: MaintContentCtx): void {
  const room = placeVentshunRoom(ctx);
  const ventCells = decorateVentshunRoom(ctx, room);
  const { valveContainerId, rewardContainerId } = placeVentshunContainers(ctx, room);
  registerVentshunCueAndContext(ctx, room, valveContainerId, rewardContainerId, ventCells);
}
