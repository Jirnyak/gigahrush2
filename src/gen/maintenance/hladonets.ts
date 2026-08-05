/* -- Monster 18: Hladonets, a bounded cold-pocket stalker -------- */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal, Cell, EntityType, Feature, FloorLevel, MonsterKind, RoomType, Tex, msg,
  type Entity, type GameState, type Room, type WorldEvent, type WorldEventSeverity,
} from '../../core/types';
import type { World } from '../../core/world';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  type MaintContentCtx, dropItems, findMaintArea, openTile, setFeature, setWater,
  stampMaintRoom,
} from './content_helpers';

const HLADON_ROOM_PREFIX = 'Хладон:';
const SITE_TAG = 'hladonets';
const THREAT_NAME = 'Хладонец';
const MAX_CONTEXTS = 6;

interface HladonetsContext {
  world: World;
  entities: Entity[];
  roomId: number;
  threatId: number;
  exposed: boolean;
  countered: boolean;
  vented: boolean;
  cleared: boolean;
}

const contexts: HladonetsContext[] = [];

function registerHladonetsContext(ctx: HladonetsContext): void {
  const existing = contexts.find(item => item.world === ctx.world && item.roomId === ctx.roomId);
  if (existing) {
    existing.entities = ctx.entities;
    existing.threatId = ctx.threatId;
    return;
  }
  contexts.push(ctx);
  if (contexts.length > MAX_CONTEXTS) contexts.splice(0, contexts.length - MAX_CONTEXTS);
}

function contextByRoom(event: WorldEvent): HladonetsContext | undefined {
  if (event.roomId === undefined) return undefined;
  for (let i = contexts.length - 1; i >= 0; i--) {
    const ctx = contexts[i];
    if (ctx.roomId === event.roomId) return ctx;
  }
  return undefined;
}

function contextByThreat(event: WorldEvent): HladonetsContext | undefined {
  if (event.targetId === undefined) return undefined;
  for (let i = contexts.length - 1; i >= 0; i--) {
    const ctx = contexts[i];
    if (ctx.threatId === event.targetId) return ctx;
  }
  return undefined;
}

function eventDataString(event: WorldEvent, key: string): string | undefined {
  const value = event.data?.[key];
  return typeof value === 'string' ? value : undefined;
}

function center(room: Room): { x: number; y: number } {
  return {
    x: room.x + Math.floor(room.w / 2),
    y: room.y + Math.floor(room.h / 2),
  };
}

function publishHladonetsEvent(
  state: GameState,
  ctx: HladonetsContext,
  source: WorldEvent,
  phase: 'cold_exposure' | 'heat_counter' | 'steam_vented' | 'threat_cleared',
  severity: WorldEventSeverity,
  data: Record<string, unknown> = {},
): void {
  const room = ctx.world.rooms[ctx.roomId];
  publishEvent(state, {
    type: 'rumor_observed',
    floor: FloorLevel.MAINTENANCE,
    zoneId: source.zoneId,
    roomId: ctx.roomId,
    x: source.x,
    y: source.y,
    actorId: source.actorId,
    actorName: source.actorName,
    actorFaction: source.actorFaction,
    targetId: ctx.threatId,
    targetName: THREAT_NAME,
    monsterKind: MonsterKind.SHADOW,
    itemId: source.itemId,
    itemName: source.itemName,
    severity,
    privacy: 'local',
    tags: ['monster', 'cold', 'hladon', 'heat_counter', SITE_TAG, phase, 'maintenance'],
    data: {
      system: SITE_TAG,
      sourceEventId: source.id,
      phase,
      roomName: room?.name,
      ...data,
    },
  });
}

function frostRoom(world: World, room: Room, seedBase: number): void {
  room.name = `${HLADON_ROOM_PREFIX} камера Хладонца паровой вентиль жив`;
  room.wallTex = Tex.TILE_W;
  room.floorTex = Tex.F_TILE;

  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const ci = world.idx(x, y);
      if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) continue;
      world.floorTex[ci] = Tex.F_TILE;
      world.fog[ci] = Math.max(world.fog[ci], 34 + ((dx + dy) % 3) * 8);
      if ((dx * 3 + dy + seedBase) % 6 === 0) {
        stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.32, 0.55, seedBase + dx * 41 + dy * 97, 190, 228, 240, false);
      }
      if ((dx + dy) % 11 === 0) setWater(world, x, y);
    }
  }

  for (let dx = 1; dx < room.w - 1; dx += 2) {
    stampSurfaceSplat(world, room.x + dx, room.y, 0.5, 0.5, 0.42, 0.7, seedBase + dx * 13, 215, 240, 255, true);
    stampSurfaceSplat(world, room.x + dx, room.y + room.h - 1, 0.5, 0.5, 0.36, 0.65, seedBase + dx * 17, 205, 235, 248, true);
  }
  for (let dy = 2; dy < room.h - 2; dy += 3) {
    setFeature(world, room.x + room.w - 3, room.y + dy, Feature.SHELF);
  }

  const valveX = room.x + 2;
  const valveY = room.y + Math.floor(room.h / 2);
  setFeature(world, valveX, valveY, Feature.APPARATUS);
  stampSurfaceSplat(world, valveX, valveY, 0.5, 0.5, 0.75, 0.5, seedBase + 901, 145, 200, 230, false);
  world.markFogDirty();
}

function warmValveRoom(ctx: MaintContentCtx, room: Room, seedBase: number): void {
  for (let dx = 1; dx < room.w - 1; dx++) {
    const x = room.x + dx;
    if (dx % 2 === 0) setFeature(ctx.world, x, room.y + 1, Feature.MACHINE);
    if (dx % 3 === 0) setWater(ctx.world, x, room.y + room.h - 2);
  }
  setFeature(ctx.world, room.x + 2, room.y + 2, Feature.APPARATUS);
  setFeature(ctx.world, room.x + room.w - 3, room.y + 2, Feature.LAMP);
  const c = center(room);
  stampSurfaceSplat(ctx.world, c.x, c.y, 0.5, 0.5, 0.65, 0.38, seedBase + 170, 220, 128, 60, false);
}

function traceRoom(ctx: MaintContentCtx, room: Room, seedBase: number): void {
  for (let dx = 1; dx < room.w - 1; dx += 2) {
    setFeature(ctx.world, room.x + dx, room.y + 1, Feature.SHELF);
  }
  setFeature(ctx.world, room.x + 2, room.y + room.h - 2, Feature.LAMP);
  setFeature(ctx.world, room.x + room.w - 3, room.y + room.h - 2, Feature.MACHINE);
  const c = center(room);
  stampSurfaceSplat(ctx.world, c.x, c.y, 0.5, 0.5, 0.42, 0.42, seedBase + 271, 160, 205, 220, false);
}

function connectRooms(ctx: MaintContentCtx, warm: Room, cold: Room, trace: Room): void {
  const warmY = warm.y + Math.floor(warm.h / 2);
  for (let x = warm.x + warm.w - 1; x <= cold.x + 2; x++) openTile(ctx.world, x, warmY, Tex.F_CONCRETE);

  const serviceX = cold.x + Math.floor(cold.w / 2);
  for (let y = cold.y + cold.h - 1; y <= trace.y + 1; y++) openTile(ctx.world, serviceX, y, Tex.F_CONCRETE);
  for (let x = Math.min(serviceX, trace.x + 2); x <= Math.max(serviceX, trace.x + 2); x++) {
    openTile(ctx.world, x, trace.y + 1, Tex.F_CONCRETE);
  }
}

function spawnHladonets(ctx: MaintContentCtx, room: Room): number {
  const pos = center(room);
  const ci = ctx.world.idx(pos.x, pos.y);
  const zid = ctx.world.zoneMap[ci];
  const zoneLevel = (zid >= 0 && ctx.world.zones[zid]) ? (ctx.world.zones[zid].level ?? 5) : 5;
  const def = MONSTERS[MonsterKind.SHADOW];
  const hp = Math.round(scaleMonsterHp(def.hp, zoneLevel) * 1.45);
  const monster: Entity = {
    id: ctx.nextId.v++,
    type: EntityType.MONSTER,
    x: pos.x + 0.5,
    y: pos.y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel) * 0.92,
    sprite: monsterSpr(MonsterKind.SHADOW),
    hp,
    maxHp: hp,
    name: THREAT_NAME,
    monsterKind: MonsterKind.SHADOW,
    monsterDmgMult: 0.92,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: room.x + 2, ty: room.y + Math.floor(room.h / 2), path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
    spriteScale: 1.1,
  };
  ctx.entities.push(monster);
  return monster.id;
}

function softenColdResidue(world: World, room: Room, seedBase: number): void {
  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      if ((dx + dy) % 4 !== 0) continue;
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const ci = world.idx(x, y);
      if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) continue;
      world.fog[ci] = Math.min(world.fog[ci], 16);
      stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.28, 0.32, seedBase + dx * 31 + dy * 73, 150, 160, 155, false);
    }
  }
  world.markFogDirty();
}

function ventThreat(state: GameState, ctx: HladonetsContext, source: WorldEvent): void {
  if (ctx.vented) return;
  ctx.vented = true;
  const room = ctx.world.rooms[ctx.roomId];
  const threat = ctx.entities.find(e => e.id === ctx.threatId);
  if (room) softenColdResidue(ctx.world, room, source.id * 997 + ctx.roomId);

  if (threat?.alive) {
    const hp = threat.hp ?? 1;
    const maxHp = threat.maxHp ?? hp;
    threat.hp = Math.max(1, Math.floor(hp * 0.46));
    threat.maxHp = Math.max(threat.hp, Math.floor(maxHp * 0.7));
    threat.speed *= 0.58;
    threat.monsterDmgMult = Math.min(threat.monsterDmgMult ?? 1, 0.55);
    threat.spriteScale = Math.min(threat.spriteScale ?? 1, 0.82);
    if (threat.ai) {
      threat.ai.goal = AIGoal.WANDER;
      threat.ai.tx = room ? room.x + room.w - 3 : Math.floor(threat.x);
      threat.ai.ty = room ? room.y + room.h - 3 : Math.floor(threat.y);
      threat.ai.path = [];
      threat.ai.pi = 0;
      threat.ai.timer = 1.6;
      threat.ai.combatTargetId = undefined;
    }
  }

  state.msgs.push(msg('Пар сорвал лед с Хладонца. Он стал ниже, медленнее и ищет дальний угол.', state.time, '#8ff'));
  publishHladonetsEvent(state, ctx, source, 'steam_vented', 4, {
    method: eventDataString(source, 'method') ?? source.itemId ?? 'heat',
    threatAlive: !!threat?.alive,
  });
}

function handleHladonEvent(state: GameState, event: WorldEvent): void {
  if (eventDataString(event, 'system') !== 'hladon_cold_pocket') return;
  const kind = eventDataString(event, 'kind');
  const ctx = contextByRoom(event);
  if (!ctx) return;

  if (kind === 'entered' && !ctx.exposed) {
    ctx.exposed = true;
    state.msgs.push(msg('В инее дернулась тень: Хладонец держит центр холодной камеры.', state.time, '#9cf'));
    publishHladonetsEvent(state, ctx, event, 'cold_exposure', 3, { coldLevel: event.data?.level });
  }

  if (kind === 'countered' && !ctx.countered) {
    ctx.countered = true;
    publishHladonetsEvent(state, ctx, event, 'heat_counter', 3, {
      itemId: event.itemId,
      coldLevel: event.data?.level,
    });
  }

  if (kind === 'cleared') ventThreat(state, ctx, event);
}

function handleKillEvent(state: GameState, event: WorldEvent): void {
  if (event.type !== 'player_kill_monster') return;
  const ctx = contextByThreat(event);
  if (!ctx || ctx.cleared) return;
  ctx.cleared = true;
  publishHladonetsEvent(state, ctx, event, 'threat_cleared', 4, {
    vented: ctx.vented,
    reward: ['boiler_water', 'asbestos_cord', 'valve_tag'],
  });
  state.msgs.push(msg('Хладонец рассыпался сухим инеем. В остатке видны бирки и теплый шнур.', state.time, '#8cf'));
}

registerWorldEventObserver((state, event) => {
  handleHladonEvent(state, event);
  handleKillEvent(state, event);
});

export function generateHladonets(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 33, 23, 150, 270);

  const warm = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.PRODUCTION,
    pos.x, pos.y + 4, 10, 7,
    'Паровой отвод Хладонца: теплый запас',
    Tex.PIPE, Tex.F_CONCRETE,
  );
  const cold = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.PRODUCTION,
    pos.x + 12, pos.y, 19, 14,
    `${HLADON_ROOM_PREFIX} камера Хладонца`,
    Tex.TILE_W, Tex.F_TILE,
  );
  const trace = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.STORAGE,
    pos.x + 13, pos.y + 16, 15, 5,
    'Шкаф оттаявших бирок Хладонца',
    Tex.METAL, Tex.F_CONCRETE,
  );

  connectRooms(ctx, warm, cold, trace);
  warmValveRoom(ctx, warm, pos.x * 13 + pos.y);
  frostRoom(ctx.world, cold, pos.x * 31 + pos.y * 7);
  traceRoom(ctx, trace, pos.x * 17 + pos.y * 23);

  const threatId = spawnHladonets(ctx, cold);
  dropItems(ctx, warm, ['boiler_water', 'asbestos_cord', 'sealant_tube', 'cloth_roll']);
  dropItems(ctx, cold, ['boiler_water']);
  dropItems(ctx, trace, ['valve_tag', 'asbestos_cord', 'boiler_water', 'frozen_item_shard', 'frozen_slime_core', 'note']);

  registerHladonetsContext({
    world: ctx.world,
    entities: ctx.entities,
    roomId: cold.id,
    threatId,
    exposed: false,
    countered: false,
    vented: false,
    cleared: false,
  });
}
