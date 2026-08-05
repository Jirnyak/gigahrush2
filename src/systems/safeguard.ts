/* ── Safeguard terminal backlash spawn ───────────────────────── */

import {
  AIGoal,
  Cell,
  EntityType,
  Feature,
  MonsterKind,
  msg,
  type Entity,
  type GameState,
} from '../core/types';
import { World } from '../core/world';
import { MONSTERS, entityDisplayName } from '../entities/monster';
import { monsterSpr } from '../render/sprite_index';
import { getRecentEvents, publishEvent } from './events';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from './rpg';
import { canSpawnEntityType } from './entity_limits';
import { isPlayerEntity } from './player_actor';

const HACK_FLOOR_COOLDOWN_S = 480;
const HACK_TERMINAL_COOLDOWN_S = 900;
const ACTIVE_SAFEGUARD_RADIUS_SQ = 36 * 36;
const SPAWN_MIN_RADIUS = 2;
const SPAWN_MAX_RADIUS = 12;

export interface SafeguardHackBacklashOptions {
  terminalIdx?: number;
  floorKey?: string;
}

function designRouteTag(floorKey: string | undefined): string | undefined {
  const prefix = 'design:';
  return floorKey?.startsWith(prefix) ? floorKey.slice(prefix.length) : undefined;
}

function zoneIdAt(world: World, x: number, y: number): number | undefined {
  const zid = world.zoneMap[world.idx(Math.floor(x), Math.floor(y))];
  return zid >= 0 ? zid : undefined;
}

function zoneLevelAt(world: World, x: number, y: number): number {
  const zid = zoneIdAt(world, x, y);
  return zid !== undefined ? world.zones[zid]?.level ?? 1 : 1;
}

function terminalCooldownActive(state: GameState, terminalIdx: number | undefined, floorKey: string | undefined): boolean {
  const events = getRecentEvents(state, { type: 'net_terminal_hack_failed', tags: ['safeguard'], limit: 32 });
  for (const event of events) {
    const age = state.time - event.time;
    if (age < 0) continue;
    if (floorKey && event.data?.floorKey === floorKey && age < HACK_FLOOR_COOLDOWN_S) return true;
    if (terminalIdx !== undefined && event.data?.terminalIdx === terminalIdx && age < HACK_TERMINAL_COOLDOWN_S) return true;
    if (!floorKey && event.floor === state.currentFloor && age < HACK_FLOOR_COOLDOWN_S) return true;
  }
  return false;
}

function activeSafeguardNear(world: World, entities: readonly Entity[], x: number, y: number): boolean {
  for (const entity of entities) {
    if (!entity.alive || entity.type !== EntityType.MONSTER || entity.monsterKind !== MonsterKind.SAFEGUARD) continue;
    if (world.dist2(entity.x, entity.y, x, y) <= ACTIVE_SAFEGUARD_RADIUS_SQ) return true;
  }
  return false;
}

function blocksSpawnFeature(feature: Feature): boolean {
  return feature === Feature.TABLE ||
    feature === Feature.CHAIR ||
    feature === Feature.BED ||
    feature === Feature.STOVE ||
    feature === Feature.SINK ||
    feature === Feature.TOILET ||
    feature === Feature.SHELF ||
    feature === Feature.MACHINE ||
    feature === Feature.APPARATUS ||
    feature === Feature.DESK;
}

function canSpawnAt(world: World, entities: readonly Entity[], x: number, y: number): boolean {
  const wx = world.wrap(x);
  const wy = world.wrap(y);
  const idx = world.idx(wx, wy);
  const cell = world.cells[idx];
  if (cell !== Cell.FLOOR && cell !== Cell.WATER) return false;
  if (world.solid(wx, wy)) return false;
  if (blocksSpawnFeature(world.features[idx] as Feature)) return false;
  for (const entity of entities) {
    if (!entity.alive) continue;
    if (!isPlayerEntity(entity) && entity.type !== EntityType.NPC && entity.type !== EntityType.MONSTER) continue;
    if (world.dist2(entity.x, entity.y, wx + 0.5, wy + 0.5) < 0.9) return false;
  }
  return true;
}

function findSafeguardSpawnCell(world: World, entities: readonly Entity[], x: number, y: number): { x: number; y: number } | null {
  const cx = world.wrap(Math.floor(x));
  const cy = world.wrap(Math.floor(y));
  for (let r = SPAWN_MIN_RADIUS; r <= SPAWN_MAX_RADIUS; r++) {
    for (let dx = -r; dx <= r; dx++) {
      const topX = world.wrap(cx + dx);
      const botX = topX;
      const topY = world.wrap(cy - r);
      const botY = world.wrap(cy + r);
      if (canSpawnAt(world, entities, topX, topY)) return { x: topX + 0.5, y: topY + 0.5 };
      if (canSpawnAt(world, entities, botX, botY)) return { x: botX + 0.5, y: botY + 0.5 };
    }
    for (let dy = -r + 1; dy <= r - 1; dy++) {
      const leftX = world.wrap(cx - r);
      const rightX = world.wrap(cx + r);
      const yy = world.wrap(cy + dy);
      if (canSpawnAt(world, entities, leftX, yy)) return { x: leftX + 0.5, y: yy + 0.5 };
      if (canSpawnAt(world, entities, rightX, yy)) return { x: rightX + 0.5, y: yy + 0.5 };
    }
  }
  return null;
}

export function spawnSafeguardHackBacklash(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  state: GameState,
  x: number,
  y: number,
  reason: string,
  options: SafeguardHackBacklashOptions = {},
): Entity | null {
  if (terminalCooldownActive(state, options.terminalIdx, options.floorKey)) return null;
  if (activeSafeguardNear(world, entities, x, y)) return null;
  if (!canSpawnEntityType(entities, EntityType.MONSTER)) return null;

  const spawn = findSafeguardSpawnCell(world, entities, x, y);
  if (!spawn) return null;

  const def = MONSTERS[MonsterKind.SAFEGUARD];
  const level = Math.max(4, zoneLevelAt(world, spawn.x, spawn.y));
  const rpg = randomRPG(level);
  const hp = Math.round(scaleMonsterHp(def.hp, level) * (1 + 0.08 * rpg.str));
  const target = entities.find(entity => entity.alive && isPlayerEntity(entity));
  const safeguard: Entity = {
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: spawn.x,
    y: spawn.y,
    angle: target ? Math.atan2(world.delta(spawn.y, target.y), world.delta(spawn.x, target.x)) : 0,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, level),
    sprite: monsterSpr(MonsterKind.SAFEGUARD),
    name: 'Сейфгард отказа',
    hp,
    maxHp: hp,
    monsterKind: MonsterKind.SAFEGUARD,
    attackCd: 0.25,
    ai: {
      goal: AIGoal.HUNT,
      tx: Math.floor(x),
      ty: Math.floor(y),
      path: [],
      pi: 0,
      stuck: 0,
      timer: 0,
      combatTargetId: target?.id,
    },
    rpg,
  };

  state.msgs.push(msg('НЕТ-терминал: ACCESS DENIED. Белый охранитель ищет ближайший проход.', state.time, '#f66'));
  publishEvent(state, {
    type: 'net_terminal_hack_failed',
    zoneId: zoneIdAt(world, x, y),
    x,
    y,
    actorId: target?.id,
    actorName: target ? entityDisplayName(target) : 'Игрок',
    targetId: safeguard.id,
    targetName: safeguard.name,
    monsterKind: MonsterKind.SAFEGUARD,
    severity: 5,
    privacy: 'local',
    tags: [
      'net',
      'net_terminal',
      'hack_failed',
      ...(designRouteTag(options.floorKey) ? [designRouteTag(options.floorKey)!] : []),
      'hack_error',
      'safeguard',
      'blade',
      'monster',
      'safeguard_spawned',
    ],
    data: {
      reason,
      floorKey: options.floorKey,
      terminalIdx: options.terminalIdx,
      spawnX: Math.round(spawn.x * 10) / 10,
      spawnY: Math.round(spawn.y * 10) / 10,
      rumorIds: ['monster_safeguard_access_denied', 'ecology_safeguard_windup'],
    },
  });

  entities.push(safeguard);
  state.msgs.push(msg('Сейфгард отказа появился рядом с терминалом.', state.time, '#fa4'));
  return safeguard;
}
