/* -- AG67 black slime eyes: one capped residue lure encounter -- */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal, Cell, ContainerKind, EntityType, Feature, FloorLevel,
  MonsterKind, RoomType, Tex, msg,
  type Entity, type GameState, type Room, type WorldContainer, type WorldEvent,
  type WorldEventType,
} from '../../core/types';
import type { World } from '../../core/world';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  type MaintContentCtx, findMaintArea, openTile, setFeature, setWater, stampMaintRoom,
} from './content_helpers';

const TAG_SITE = 'ag67_black_slime';
const TAG_SLIME = 'black_slime';
const TAG_SAMPLE = 'sample';
const TAG_LURE = 'lure';
const TAG_SEAL = 'seal';
const TAG_COUNTERPLAY = 'counterplay';
const SAMPLE_ITEM = 'slime_sample_black';
const ROOM_W = 24;
const ROOM_H = 15;
const ENTRY_W = 7;
const ENTRY_H = 7;
const MAX_RUNTIME_CONTEXTS = 4;
const MAX_GENERATED_SITES_PER_RUNTIME = 1;
const MAX_EYES_PER_SITE = 3;

interface BlackSlimeContext {
  world: World;
  entities: Entity[];
  roomId: number;
  sampleContainerId: number;
  sealContainerId: number;
  kitContainerId: number;
  eyeIds: number[];
  disturbed: boolean;
  sealed: boolean;
  sampleRecovered: boolean;
  aftermathPublished: boolean;
}

let generatedSites = 0;
const contexts: BlackSlimeContext[] = [];

function registerBlackSlimeContext(ctx: BlackSlimeContext): void {
  const existing = contexts.find(item => item.world === ctx.world && item.roomId === ctx.roomId);
  if (existing) {
    existing.entities = ctx.entities;
    existing.sampleContainerId = ctx.sampleContainerId;
    existing.sealContainerId = ctx.sealContainerId;
    existing.kitContainerId = ctx.kitContainerId;
    return;
  }
  contexts.push(ctx);
  if (contexts.length > MAX_RUNTIME_CONTEXTS) contexts.splice(0, contexts.length - MAX_RUNTIME_CONTEXTS);
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addBlackSlimeContainer(
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
    tags: [TAG_SITE, TAG_SLIME, ...tags],
  });
  setFeature(ctx.world, wx, wy, Feature.SHELF);
  return id;
}

function findContextByContainer(event: WorldEvent): BlackSlimeContext | undefined {
  if (event.containerId === undefined) return undefined;
  for (let i = contexts.length - 1; i >= 0; i--) {
    const ctx = contexts[i];
    if (
      ctx.sampleContainerId === event.containerId ||
      ctx.sealContainerId === event.containerId ||
      ctx.kitContainerId === event.containerId
    ) return ctx;
  }
  return undefined;
}

function findContextByEye(event: WorldEvent): BlackSlimeContext | undefined {
  if (event.targetId === undefined) return undefined;
  for (let i = contexts.length - 1; i >= 0; i--) {
    if (contexts[i].eyeIds.includes(event.targetId)) return contexts[i];
  }
  return undefined;
}

function hasTags(event: WorldEvent, ...tags: string[]): boolean {
  return tags.every(tag => event.tags.includes(tag));
}

function pushHud(state: GameState, line: string, color: string): void {
  state.msgs.push(msg(line, state.time, color));
}

function publishBlackSlimeEvent(
  state: GameState,
  ctx: BlackSlimeContext,
  source: WorldEvent,
  phase: 'disturbed' | 'sample_recovered' | 'threat_killed' | 'threat_sealed' | 'afteraction',
  line: string,
  severity: 2 | 3 | 4 | 5,
  data: Record<string, unknown> = {},
): void {
  const room = ctx.world.rooms[ctx.roomId];
  publishEvent(state, {
    type: `black_slime_${phase}` as WorldEventType,
    floor: FloorLevel.MAINTENANCE,
    zoneId: source.zoneId,
    roomId: ctx.roomId,
    x: source.x,
    y: source.y,
    actorId: source.actorId,
    actorName: source.actorName,
    actorFaction: source.actorFaction,
    targetId: source.targetId,
    targetName: source.targetName,
    monsterKind: source.monsterKind,
    itemId: source.itemId,
    itemName: source.itemName,
    severity,
    privacy: 'local',
    tags: [TAG_SITE, TAG_SLIME, 'slime', phase, 'maintenance', ...source.tags].slice(0, 8),
    data: {
      sourceEventId: source.id,
      roomName: room?.name,
      spawnedEyes: ctx.eyeIds.length,
      sealed: ctx.sealed,
      sampleRecovered: ctx.sampleRecovered,
      ...data,
    },
  });
  pushHud(state, line, severity >= 4 ? '#f8c' : '#8cf');
}

function nextEntityId(entities: Entity[]): number {
  let id = 1;
  for (const e of entities) id = Math.max(id, e.id + 1);
  return id;
}

function findEyeSpawnCell(ctx: BlackSlimeContext, room: Room, slot: number): { x: number; y: number } | null {
  const anchors: [number, number][] = [
    [room.x + room.w - 5, room.y + 4],
    [room.x + room.w - 6, room.y + room.h - 5],
    [room.x + Math.floor(room.w / 2) + 3, room.y + room.h - 4],
  ];
  const [ax, ay] = anchors[slot % anchors.length];

  for (let attempt = 0; attempt < 80; attempt++) {
    const angle = (Math.PI * 2 * (slot + attempt / 11)) / MAX_EYES_PER_SITE;
    const dist = attempt < 3 ? 0 : 1 + (attempt % 4);
    const x = ctx.world.wrap(ax + Math.round(Math.cos(angle) * dist));
    const y = ctx.world.wrap(ay + Math.round(Math.sin(angle) * dist));
    const ci = ctx.world.idx(x, y);
    if (ctx.world.cells[ci] === Cell.WATER && ctx.world.roomMap[ci] === room.id) return { x, y };
  }

  for (let attempt = 0; attempt < 80; attempt++) {
    const angle = (Math.PI * 2 * (slot + attempt / 11)) / MAX_EYES_PER_SITE;
    const dist = 1 + (attempt % 4);
    const x = ctx.world.wrap(ax + Math.round(Math.cos(angle) * dist));
    const y = ctx.world.wrap(ay + Math.round(Math.sin(angle) * dist));
    const ci = ctx.world.idx(x, y);
    if ((ctx.world.cells[ci] === Cell.FLOOR || ctx.world.cells[ci] === Cell.WATER) && ctx.world.roomMap[ci] === room.id) return { x, y };
  }
  return null;
}

function spawnBlackSlimeEyes(ctx: BlackSlimeContext, source: WorldEvent): number {
  if (ctx.eyeIds.length > 0) return 0;
  const room = ctx.world.rooms[ctx.roomId];
  if (!room) return 0;
  const count = 1 + ((source.id + ctx.roomId) % MAX_EYES_PER_SITE);
  let nextId = nextEntityId(ctx.entities);
  let spawned = 0;
  const def = MONSTERS[MonsterKind.CHERNOSLIZ];

  for (let i = 0; i < count; i++) {
    const pos = findEyeSpawnCell(ctx, room, i);
    if (!pos) continue;
    const ci = ctx.world.idx(pos.x, pos.y);
    const zoneLevel = ctx.world.zones[ctx.world.zoneMap[ci]]?.level ?? 4;
    const baseHp = scaleMonsterHp(def.hp, zoneLevel);
    const hp = Math.max(6, Math.round(baseHp * 0.55));
    const eye: Entity = {
      id: nextId++,
      type: EntityType.MONSTER,
      x: pos.x + 0.5,
      y: pos.y + 0.5,
      angle: Math.random() * Math.PI * 2,
      pitch: 0,
      alive: true,
      speed: scaleMonsterSpeed(def.speed, zoneLevel),
      sprite: monsterSpr(MonsterKind.CHERNOSLIZ),
      hp,
      maxHp: hp,
      monsterKind: MonsterKind.CHERNOSLIZ,
      attackCd: 0.35 + i * 0.25,
      ai: { goal: AIGoal.WANDER, tx: room.x + 3, ty: room.y + 3, path: [], pi: 0, stuck: 0, timer: 0 },
      rpg: randomRPG(zoneLevel),
      spriteScale: 0.72,
    };
    ctx.entities.push(eye);
    ctx.eyeIds.push(eye.id);
    spawned++;
  }
  return spawned;
}

function publishAfteraction(state: GameState, ctx: BlackSlimeContext, source: WorldEvent, outcome: string): void {
  if (ctx.aftermathPublished) return;
  ctx.aftermathPublished = true;
  publishBlackSlimeEvent(
    state,
    ctx,
    source,
    'afteraction',
    'После смены пойдет слух: черный остаток не отражает свет, он смотрит обратно.',
    3,
    { outcome, afteraction: 'black_residue_watches_back' },
  );
}

function disturbBlackSlime(state: GameState, ctx: BlackSlimeContext, event: WorldEvent): void {
  if (ctx.disturbed || ctx.sealed) return;
  ctx.disturbed = true;
  const spawned = spawnBlackSlimeEyes(ctx, event);
  publishBlackSlimeEvent(
    state,
    ctx,
    event,
    'disturbed',
    spawned > 0
      ? 'Черная слизь моргнула: из пятна поднялся чернослиз.'
      : 'Черная слизь дрогнула, но новых глаз не стало.',
    spawned > 0 ? 4 : 3,
    { spawnedEyesNow: spawned, cap: MAX_EYES_PER_SITE },
  );
}

function sealBlackSlime(state: GameState, ctx: BlackSlimeContext, event: WorldEvent): void {
  if (ctx.sealed) {
    pushHud(state, 'Пломба уже держит черный остаток.', '#888');
    return;
  }
  ctx.sealed = true;
  const room = ctx.world.rooms[ctx.roomId];
  if (room) room.sealed = true;

  let sealedEyes = 0;
  if (ctx.eyeIds.length > 0) {
    const entityMap = new Map();
    for (const e of ctx.entities) {
      entityMap.set(e.id, e);
    }
    for (const id of ctx.eyeIds) {
      const eye = entityMap.get(id);
      if (eye?.alive) {
        eye.alive = false;
        eye.hp = 0;
        sealedEyes++;
      }
    }
  }

  publishBlackSlimeEvent(
    state,
    ctx,
    event,
    'threat_sealed',
    sealedEyes > 0
      ? 'Герметик схватился: чернослиз осел в черной пленке.'
      : 'Герметик закрыл остаток до того, как он успел вырастить чернослиз.',
    sealedEyes > 0 ? 4 : 3,
    { sealedEyes, cap: MAX_EYES_PER_SITE },
  );
  publishAfteraction(state, ctx, event, sealedEyes > 0 ? 'sealed_after_disturbance' : 'sealed_before_disturbance');
}

function handleContainerEvent(state: GameState, event: WorldEvent): void {
  if (event.type !== 'container_opened' && event.type !== 'item_stolen') return;
  if (!hasTags(event, TAG_SITE, TAG_SLIME)) return;
  const ctx = findContextByContainer(event);
  if (!ctx) return;

  if (hasTags(event, TAG_SEAL)) {
    sealBlackSlime(state, ctx, event);
    return;
  }

  if (hasTags(event, TAG_SAMPLE, TAG_LURE)) {
    if (!ctx.sampleRecovered) {
      ctx.sampleRecovered = true;
      publishBlackSlimeEvent(
        state,
        ctx,
        event,
        'sample_recovered',
        ctx.sealed
          ? 'Образец черной слизи вынут из-под пломбы.'
          : 'Образец черной слизи взят. Остаток понял, что на него смотрят.',
        ctx.sealed ? 3 : 4,
        { sampleItemId: event.itemId ?? SAMPLE_ITEM },
      );
    }
    disturbBlackSlime(state, ctx, event);
  }
}

function handleKillEvent(state: GameState, event: WorldEvent): void {
  if (event.type !== 'player_kill_monster' || event.monsterKind !== MonsterKind.CHERNOSLIZ) return;
  const ctx = findContextByEye(event);
  if (!ctx) return;
  const entityMap = new Map();
  for (const e of ctx.entities) {
    entityMap.set(e.id, e);
  }
  const remaining = ctx.eyeIds.filter(id => {
    const e = entityMap.get(id);
    return e && e.alive;
  }).length;
  publishBlackSlimeEvent(
    state,
    ctx,
    event,
    'threat_killed',
    remaining > 0
      ? `Чернослиз лопнул. В пятне осталось еще ${remaining}.`
      : 'Последний чернослиз лопнул. Пятно стало плоским.',
    remaining > 0 ? 3 : 4,
    { remainingEyes: remaining, cap: MAX_EYES_PER_SITE },
  );
  if (remaining === 0) publishAfteraction(state, ctx, event, 'all_eyes_killed');
}

function handleBlackSlimeEvents(state: GameState, event: WorldEvent): void {
  handleContainerEvent(state, event);
  handleKillEvent(state, event);
}

registerWorldEventObserver(handleBlackSlimeEvents);

function decorateBlackSlimeSite(ctx: MaintContentCtx, entry: Room, nest: Room): void {
  for (let dx = 1; dx < entry.w - 1; dx++) {
    setFeature(ctx.world, entry.x + dx, entry.y + 1, dx % 2 === 0 ? Feature.LAMP : Feature.SHELF);
  }
  setFeature(ctx.world, entry.x + 2, entry.y + entry.h - 2, Feature.APPARATUS);
  setFeature(ctx.world, entry.x + entry.w - 2, entry.y + entry.h - 2, Feature.MACHINE);

  const cx = nest.x + Math.floor(nest.w / 2);
  const cy = nest.y + Math.floor(nest.h / 2);
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -9; dx <= 9; dx++) {
      if ((dx * dx) / 81 + (dy * dy) / 25 > 1) continue;
      const x = cx + dx;
      const y = cy + dy;
      const ci = ctx.world.idx(x, y);
      if (ctx.world.roomMap[ci] === nest.id) setWater(ctx.world, x, y);
    }
  }
  stampSurfaceSplat(ctx.world, cx, cy, 0.5, 0.5, 5.2, 0.92, 67001, 3, 5, 7, false);
  stampSurfaceSplat(ctx.world, cx + 4, cy - 3, 0.5, 0.5, 2.2, 0.8, 67002, 10, 12, 18, true);
  stampSurfaceSplat(ctx.world, cx - 5, cy + 3, 0.5, 0.5, 2.7, 0.74, 67003, 5, 8, 10, false);

  for (let dx = 2; dx < nest.w - 2; dx += 4) {
    setFeature(ctx.world, nest.x + dx, nest.y + 2, Feature.APPARATUS);
    if (dx % 8 === 2) setFeature(ctx.world, nest.x + dx, nest.y + nest.h - 3, Feature.LAMP);
  }
  for (let dy = 3; dy < nest.h - 2; dy += 3) {
    setFeature(ctx.world, nest.x + 2, nest.y + dy, Feature.SHELF);
    const ci = ctx.world.idx(cx, nest.y + dy);
    ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 42);
  }
  ctx.world.markFogDirty();
}

function connectRooms(ctx: MaintContentCtx, entry: Room, nest: Room): void {
  const y = entry.y + Math.floor(entry.h / 2);
  for (let x = entry.x + entry.w - 1; x <= nest.x + 1; x++) openTile(ctx.world, x, y, Tex.F_CONCRETE);
  const targetY = nest.y + Math.floor(nest.h / 2);
  for (let y2 = Math.min(y, targetY); y2 <= Math.max(y, targetY); y2++) {
    openTile(ctx.world, nest.x + 1, y2, Tex.F_CONCRETE);
  }
}

export function generateBlackSlimeEyes(ctx: MaintContentCtx): void {
  if (generatedSites >= MAX_GENERATED_SITES_PER_RUNTIME) return;
  generatedSites++;

  const pos = findMaintArea(
    ctx.world,
    Math.floor(ctx.spawnX),
    Math.floor(ctx.spawnY),
    ROOM_W + ENTRY_W + 3,
    ROOM_H + 2,
    120,
    230,
  );

  const entry = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.CORRIDOR,
    pos.x, pos.y + 4, ENTRY_W, ENTRY_H,
    'Предбанник черной слизи: огонь УФ герметик',
    Tex.PIPE, Tex.F_CONCRETE,
  );
  const nest = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.STORAGE,
    pos.x + ENTRY_W + 2, pos.y, ROOM_W, ROOM_H,
    'Черная слизь: остаток смотрит назад',
    Tex.DARK, Tex.F_CONCRETE,
  );

  connectRooms(ctx, entry, nest);
  decorateBlackSlimeSite(ctx, entry, nest);

  const kitContainerId = addBlackSlimeContainer(
    ctx,
    entry,
    entry.x + 2,
    entry.y + 3,
    'Аварийный ящик огня и света',
    ContainerKind.EMERGENCY_BOX,
    [
      { defId: 'flashlight', count: 1 },
      { defId: 'fire_hook', count: 1 },
      { defId: 'ammo_fuel', count: 1 },
      { defId: 'lamp_bulb', count: 1 },
    ],
    [TAG_COUNTERPLAY, 'fire', 'light'],
  );
  const sealContainerId = addBlackSlimeContainer(
    ctx,
    entry,
    entry.x + entry.w - 2,
    entry.y + 3,
    'Пломба герметизации черного остатка',
    ContainerKind.TOOL_LOCKER,
    [
      { defId: 'sealant_tube', count: 1 },
      { defId: 'hermo_gasket', count: 1 },
    ],
    [TAG_COUNTERPLAY, TAG_SEAL],
  );
  const sampleContainerId = addBlackSlimeContainer(
    ctx,
    nest,
    nest.x + Math.floor(nest.w / 2),
    nest.y + Math.floor(nest.h / 2),
    'Ложная банка НИИ: черный образец',
    ContainerKind.SECRET_STASH,
    [{ defId: SAMPLE_ITEM, count: 1 }],
    [TAG_SAMPLE, TAG_LURE, 'science'],
  );

  registerBlackSlimeContext({
    world: ctx.world,
    entities: ctx.entities,
    roomId: nest.id,
    sampleContainerId,
    sealContainerId,
    kitContainerId,
    eyeIds: [],
    disturbed: false,
    sealed: false,
    sampleRecovered: false,
    aftermathPublished: false,
  });
}
