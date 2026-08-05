/* ── Рой: sparse vent/source spawner and counterplay ─────────── */

import {
  AIGoal,
  EntityType,
  Faction,
  MonsterKind,
  ProjType,
  msg,
  type Entity,
  type GameState,
} from '../core/types';
import { World } from '../core/world';
import { MONSTERS, entityDisplayName } from '../entities/monster';
import { ITEMS } from '../data/items';
import { Spr, monsterSpr } from '../render/sprite_index';
import { MarkType, stampMark } from './surface_marks';
import { publishEvent } from './events';
import { registerInventoryUseHandler, type InventoryUseHandlerContext } from './inventory';
import { ENTITY_MASK_ACTOR, ensureEntityIndex, getEntityIndex } from './entity_index';
import { canSpawnEntityType } from './entity_limits';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from './rpg';
import { isPlayerEntity } from './player_actor';

export const SWARM_SOURCE_STAGE = 1;
export const SWARM_BODY_STAGE = 0;
export const SWARM_NEST_MAX_CHILDREN = 9;
export const SWARM_NEST_SPAWN_COOLDOWN_SEC = 2.8;
export const SWARM_BODY_TTL_SEC = 18;
export const SWARM_SOURCE_SEAL_RADIUS = 2.8;
export const SWARM_SOURCE_BURN_RADIUS = 3.2;

const SWARM_NEST_ACTIVATION_RADIUS = 34;
const SWARM_NEST_SPAWN_RADIUS = 4.5;
const SWARM_SOURCE_HP = 48;
const SWARM_SEAL_ITEMS = new Set(['duct_tape', 'sealant_tube', 'hermetic_tape', 'vent_damper_plate']);
const SWARM_RUMOR_IDS = ['monster_swarm_source'] as const;
const spawnBlockQuery: Entity[] = [];

export interface SwarmNestSourceDraft {
  id: string;
  x: number;
  y: number;
  sourceEntityId?: number;
  roomId?: number;
  zoneId?: number;
  activationRadius?: number;
  spawnRadius?: number;
  spawnCooldown?: number;
  maxChildren?: number;
  childTtl?: number;
}

export interface SwarmNestSource {
  id: string;
  x: number;
  y: number;
  sourceEntityId?: number;
  roomId?: number;
  zoneId?: number;
  activationRadius: number;
  spawnRadius: number;
  spawnCooldown: number;
  maxChildren: number;
  childTtl: number;
  cooldown: number;
  sealed: boolean;
  burned: boolean;
  childIds: number[];
}

interface Runtime {
  sources: SwarmNestSource[];
  childExpiresAt: Map<number, number>;
}

const runtimes = new WeakMap<World, Runtime>();

function ensureRuntime(world: World): Runtime {
  let runtime = runtimes.get(world);
  if (!runtime) {
    runtime = { sources: [], childExpiresAt: new Map() };
    runtimes.set(world, runtime);
  }
  return runtime;
}

function compactSourceId(id: string): string {
  return id.trim().slice(0, 64) || 'swarm_nest';
}

function cellZoneId(world: World, x: number, y: number): number | undefined {
  const zid = world.zoneMap[world.idx(Math.floor(x), Math.floor(y))];
  return zid >= 0 ? zid : undefined;
}

function cellRoomId(world: World, x: number, y: number): number | undefined {
  const rid = world.roomMap[world.idx(Math.floor(x), Math.floor(y))];
  return rid >= 0 ? rid : undefined;
}

function actorName(actor: Entity | undefined): string | undefined {
  if (!actor) return undefined;
  if (actor.name) return actor.name;
  if (isPlayerEntity(actor)) return 'Вы';
  return actor.monsterKind !== undefined ? entityDisplayName(actor) : undefined;
}

function stampSourceTrail(world: World, x: number, y: number, seed: number): void {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = ((x % 1) + 1) % 1;
  const fy = ((y % 1) + 1) % 1;
  stampMark(world, ix, iy, fx, fy, 0.64, MarkType.SPLAT, seed, 29, 18, 10, 145);
  stampMark(world, ix, iy, fx + 0.12, fy - 0.08, 0.28, MarkType.BURN, seed ^ 0x5151, 82, 46, 14, 90);
}

export function registerSwarmNestSource(world: World, draft: SwarmNestSourceDraft): SwarmNestSource {
  const source: SwarmNestSource = {
    id: compactSourceId(draft.id),
    x: world.wrap(draft.x),
    y: world.wrap(draft.y),
    sourceEntityId: draft.sourceEntityId,
    roomId: draft.roomId ?? cellRoomId(world, draft.x, draft.y),
    zoneId: draft.zoneId ?? cellZoneId(world, draft.x, draft.y),
    activationRadius: Math.max(8, Math.min(60, draft.activationRadius ?? SWARM_NEST_ACTIVATION_RADIUS)),
    spawnRadius: Math.max(1.5, Math.min(8, draft.spawnRadius ?? SWARM_NEST_SPAWN_RADIUS)),
    spawnCooldown: Math.max(0.3, Math.min(12, draft.spawnCooldown ?? SWARM_NEST_SPAWN_COOLDOWN_SEC)),
    maxChildren: Math.max(1, Math.min(24, Math.floor(draft.maxChildren ?? SWARM_NEST_MAX_CHILDREN))),
    childTtl: Math.max(3, Math.min(60, draft.childTtl ?? SWARM_BODY_TTL_SEC)),
    cooldown: 0,
    sealed: false,
    burned: false,
    childIds: [],
  };
  const runtime = ensureRuntime(world);
  runtime.sources = runtime.sources.filter(existing => existing.id !== source.id);
  runtime.sources.push(source);
  stampSourceTrail(world, source.x, source.y, source.id.length * 997);
  return source;
}

export function getSwarmNestSources(world: World): readonly SwarmNestSource[] {
  return runtimes.get(world)?.sources ?? [];
}

export function isSwarmSourceEntity(e: Entity | undefined): boolean {
  return e?.monsterKind === MonsterKind.SWARM && e.monsterStage === SWARM_SOURCE_STAGE;
}

export function isSwarmBodyEntity(e: Entity | undefined): boolean {
  return e?.monsterKind === MonsterKind.SWARM && e.monsterStage !== SWARM_SOURCE_STAGE;
}

export function createSwarmSourceEntity(id: number, x: number, y: number, zoneLevel = 1): Entity {
  const hp = Math.round(SWARM_SOURCE_HP * (0.9 + Math.max(1, zoneLevel) * 0.08));
  return {
    id,
    type: EntityType.MONSTER,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: monsterSpr(MonsterKind.SWARM),
    spriteSeed: id * 17,
    hp,
    maxHp: hp,
    name: 'Источник роя',
    monsterKind: MonsterKind.SWARM,
    monsterStage: SWARM_SOURCE_STAGE,
    attackCd: 0,
    faction: Faction.WILD,
    rpg: randomRPG(Math.max(1, zoneLevel)),
    spriteScale: 1.28,
  };
}

function createSwarmBodyEntity(id: number, x: number, y: number, target: Entity, zoneLevel: number, ttl: number): Entity {
  const def = MONSTERS[MonsterKind.SWARM];
  const hp = scaleMonsterHp(def.hp, zoneLevel);
  return {
    id,
    type: EntityType.MONSTER,
    x,
    y,
    angle: Math.atan2(target.y - y, target.x - x),
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: monsterSpr(MonsterKind.SWARM),
    spriteSeed: id * 31,
    hp,
    maxHp: hp,
    monsterKind: MonsterKind.SWARM,
    monsterStage: SWARM_BODY_STAGE,
    attackCd: 0,
    faction: Faction.WILD,
    ai: { goal: AIGoal.HUNT, tx: Math.floor(target.x), ty: Math.floor(target.y), path: [], pi: 0, stuck: 0, timer: 0, combatTargetId: target.id, stateTimer: ttl },
    rpg: randomRPG(zoneLevel),
    spriteScale: 0.78 + ((id & 3) * 0.05),
  };
}

function sourceActive(nest: SwarmNestSource): boolean {
  return !nest.sealed && !nest.burned;
}

function cleanupChildren(nest: SwarmNestSource, runtime: Runtime, byId: ReadonlyMap<number, Entity>): number {
  let cleaned = 0;
  for (const id of nest.childIds) {
    runtime.childExpiresAt.delete(id);
    const child = byId.get(id);
    if (!child || !child.alive) continue;
    child.alive = false;
    child.hp = 0;
    cleaned++;
  }
  nest.childIds.length = 0;
  return cleaned;
}

function liveChildCount(nest: SwarmNestSource, runtime: Runtime, byId: ReadonlyMap<number, Entity>, time: number): number {
  let write = 0;
  for (let i = 0; i < nest.childIds.length; i++) {
    const id = nest.childIds[i];
    const child = byId.get(id);
    const expiresAt = runtime.childExpiresAt.get(id) ?? -Infinity;
    if (expiresAt <= time) {
      if (child?.alive) {
        child.alive = false;
        child.hp = 0;
      }
      runtime.childExpiresAt.delete(id);
      continue;
    }
    if (child && !child.alive) {
      runtime.childExpiresAt.delete(id);
      continue;
    }
    nest.childIds[write++] = id;
  }
  nest.childIds.length = write;
  return write;
}

function findSpawnCell(world: World, nest: SwarmNestSource, ordinal: number): { x: number; y: number } | null {
  const entityIndex = getEntityIndex();
  for (let attempt = 0; attempt < 32; attempt++) {
    const a = ordinal * 2.399963 + attempt * 0.83;
    const d = 1.25 + (attempt % 5) * (nest.spawnRadius / 5);
    const x = world.wrap(Math.floor(nest.x + Math.cos(a) * d));
    const y = world.wrap(Math.floor(nest.y + Math.sin(a) * d));
    if (world.solid(x, y)) continue;
    entityIndex.queryRadiusCapped(x + 0.5, y + 0.5, 0.72, spawnBlockQuery, ENTITY_MASK_ACTOR, 1);
    if (spawnBlockQuery.length > 0) continue;
    return { x: x + 0.5, y: y + 0.5 };
  }
  return null;
}

function publishSourceResolved(
  world: World,
  state: GameState,
  nest: SwarmNestSource,
  type: 'swarm_source_sealed' | 'swarm_source_burned',
  actor?: Entity,
  itemId?: string,
  cleanedChildren = 0,
): void {
  const item = itemId ? ITEMS[itemId] : undefined;
  publishEvent(state, {
    type,
    zoneId: nest.zoneId,
    roomId: nest.roomId,
    x: nest.x,
    y: nest.y,
    actorId: actor?.id,
    actorName: actorName(actor),
    actorFaction: actor?.faction,
    targetId: nest.sourceEntityId,
    targetName: 'Источник роя',
    itemId,
    itemName: item?.name,
    itemCount: item ? 1 : undefined,
    itemValue: item?.value,
    monsterKind: MonsterKind.SWARM,
    severity: 4,
    privacy: isPlayerEntity(actor) ? 'local' : 'witnessed',
    tags: ['monster', 'swarm', 'source', type === 'swarm_source_burned' ? 'fire' : 'sealed', 'counterplay'],
    data: {
      sourceId: nest.id,
      cleanedChildren,
      maxChildren: nest.maxChildren,
      rumorIds: [...SWARM_RUMOR_IDS],
      counterplay: type === 'swarm_source_burned' ? 'fire_source' : 'seal_vent',
      worldCell: world.idx(Math.floor(nest.x), Math.floor(nest.y)),
    },
  });
}

function resolveNest(
  world: World,
  state: GameState,
  nest: SwarmNestSource,
  byId: ReadonlyMap<number, Entity>,
  type: 'swarm_source_sealed' | 'swarm_source_burned',
  actor?: Entity,
  itemId?: string,
): boolean {
  if (!sourceActive(nest)) return false;
  if (type === 'swarm_source_burned') nest.burned = true;
  else nest.sealed = true;
  const source = nest.sourceEntityId !== undefined ? byId.get(nest.sourceEntityId) : undefined;
  if (source) {
    source.alive = false;
    source.hp = 0;
    source.spriteScale = 0.72;
  }
  const runtime = ensureRuntime(world);
  const cleanedChildren = cleanupChildren(nest, runtime, byId);
  stampSourceTrail(world, nest.x, nest.y, type === 'swarm_source_burned' ? 49_013 : 49_211);
  publishSourceResolved(world, state, nest, type, actor, itemId, cleanedChildren);
  return true;
}

export function sealSwarmNestNear(
  world: World,
  state: GameState,
  actor: Entity,
  itemId: string,
  radius = SWARM_SOURCE_SEAL_RADIUS,
): SwarmNestSource | null {
  const runtime = ensureRuntime(world);
  const byId = getEntityIndex().byId;
  let best: SwarmNestSource | null = null;
  let bestD2 = radius * radius;
  for (const nest of runtime.sources) {
    if (!sourceActive(nest)) continue;
    const d2 = world.dist2(actor.x, actor.y, nest.x, nest.y);
    if (d2 > bestD2) continue;
    bestD2 = d2;
    best = nest;
  }
  if (!best) return null;
  return resolveNest(world, state, best, byId, 'swarm_source_sealed', actor, itemId) ? best : null;
}

export function burnSwarmNestsNear(
  world: World,
  state: GameState,
  x: number,
  y: number,
  actor?: Entity,
  radius = SWARM_SOURCE_BURN_RADIUS,
): number {
  const runtime = ensureRuntime(world);
  const byId = getEntityIndex().byId;
  let burned = 0;
  const r2 = radius * radius;
  for (const nest of runtime.sources) {
    if (!sourceActive(nest)) continue;
    if (world.dist2(x, y, nest.x, nest.y) > r2) continue;
    if (resolveNest(world, state, nest, byId, 'swarm_source_burned', actor)) burned++;
  }
  return burned;
}

function spawnSwarmChild(
  world: World,
  entities: Entity[],
  nest: SwarmNestSource,
  runtime: Runtime,
  target: Entity,
  nextId: { v: number },
  time: number,
): boolean {
  if (!canSpawnEntityType(entities, EntityType.MONSTER)) return false;
  const spot = findSpawnCell(world, nest, nextId.v + nest.childIds.length);
  if (!spot) return false;
  const zid = nest.zoneId ?? cellZoneId(world, nest.x, nest.y);
  const zoneLevel = zid !== undefined && world.zones[zid] ? Math.max(1, world.zones[zid].level ?? 1) : 1;
  const child = createSwarmBodyEntity(nextId.v++, spot.x, spot.y, target, zoneLevel, nest.childTtl);
  entities.push(child);
  nest.childIds.push(child.id);
  runtime.childExpiresAt.set(child.id, time + nest.childTtl);
  stampSourceTrail(world, spot.x, spot.y, child.id * 13);
  return true;
}

export function updateSwarmNests(
  world: World,
  entities: Entity[],
  dt: number,
  time: number,
  player: Entity | undefined,
  nextId: { v: number },
  state?: GameState,
): void {
  const runtime = runtimes.get(world);
  if (!runtime || runtime.sources.length === 0) return;
  const entityIndex = ensureEntityIndex(entities);
  const byId = entityIndex.byId;

  for (const nest of runtime.sources) {
    const liveChildren = liveChildCount(nest, runtime, byId, time);
    if (!sourceActive(nest)) continue;
    const source = nest.sourceEntityId !== undefined ? byId.get(nest.sourceEntityId) : undefined;
    if (nest.sourceEntityId !== undefined && !source?.alive) {
      nest.sealed = true;
      cleanupChildren(nest, runtime, byId);
      continue;
    }
    if (!player?.alive) continue;
    if (world.dist2(player.x, player.y, nest.x, nest.y) > nest.activationRadius * nest.activationRadius) {
      if (liveChildren > 0) cleanupChildren(nest, runtime, byId);
      continue;
    }
    nest.cooldown = Math.max(0, nest.cooldown - dt);
    if (nest.cooldown > 0 || liveChildren >= nest.maxChildren) continue;
    if (spawnSwarmChild(world, entities, nest, runtime, player, nextId, time)) {
      nest.cooldown = nest.spawnCooldown;
      if (state && liveChildren === 0) {
        state.msgs.push(msg('Из щели пошел рой. Источник надо заклеить или выжечь.', time, '#ca6'));
      }
    } else {
      nest.cooldown = Math.max(0.5, nest.spawnCooldown * 0.5);
    }
  }
}

export function isSwarmFireProjectile(projectile: Entity): boolean {
  return (projectile.projType ?? ProjType.NORMAL) === ProjType.FLAME ||
    projectile.sprite === Spr.FLAME_BOLT ||
    projectile.sprite === Spr.HOSTILE_FLAME_BOLT;
}

export function swarmProjectileDamage(target: Entity, projectile: Entity, baseDamage: number): number {
  if (target.monsterKind !== MonsterKind.SWARM || !isSwarmFireProjectile(projectile)) return baseDamage;
  return Math.max(baseDamage, target.hp ?? MONSTERS[MonsterKind.SWARM].hp);
}

export function recordSwarmFireDeath(world: World, state: GameState, target: Entity, actor?: Entity): void {
  if (!isSwarmSourceEntity(target)) return;
  burnSwarmNestsNear(world, state, target.x, target.y, actor, SWARM_SOURCE_BURN_RADIUS);
}

function consumeInventorySlot(actor: Entity, slotIdx: number): void {
  const inv = actor.inventory;
  if (!inv || slotIdx < 0 || slotIdx >= inv.length) return;
  inv[slotIdx].count--;
  if (inv[slotIdx].count <= 0) inv.splice(slotIdx, 1);
}

function handleSwarmNestInventoryUse(ctx: InventoryUseHandlerContext): boolean {
  if (!ctx.world || !ctx.state || !SWARM_SEAL_ITEMS.has(ctx.def.id)) return false;
  const sealed = sealSwarmNestNear(ctx.world, ctx.state, ctx.actor, ctx.def.id);
  if (!sealed) return false;
  consumeInventorySlot(ctx.actor, ctx.slotIdx);
  ctx.msgs.push(msg(`${ctx.def.name} лег на щель. Рой потерял источник.`, ctx.time, '#9cf'));
  return true;
}

registerInventoryUseHandler(handleSwarmNestInventoryUse);
