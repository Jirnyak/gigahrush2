/* ── BetoNoed weak-wall shortcut: bounded concrete eater set-piece ── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal, Cell, DoorState, EntityType, Feature, FloorLevel,
  MonsterKind, ProjType, RoomType, Tex, W,
  msg,
  type Entity, type GameState, type Room,
} from '../../core/types';
import { World } from '../../core/world';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import { registerContentInteractionHook, registerContentRuntimeHook } from '../../systems/content_hooks';
import { publishEvent } from '../../systems/events';
import { hasItem, removeItem } from '../../systems/inventory';
import { findNoiseForActor } from '../../systems/noise';
import { randomRPG } from '../../systems/rpg';
import {
  type MaintContentCtx, dropItems, findMaintArea, setFeature, stampMaintRoom,
} from './content_helpers';

const ROOM_PREFIX = 'Бетоноед';
const NOISE_BAIT_IDS = new Set(['noise_can', 'radio', 'bottled_voice', 'siren_shard']);
const BREACH_NEAR_SQ = 16 * 16;
const BREACH_KEEPALIVE_SQ = 24 * 24;
const NOISE_BAIT_SQ = 5 * 5;
const NOISE_LURE_SQ = 9 * 9;
const FIRE_DRIVE_OFF_SECONDS = 1.1;

export interface BetonoedRuntimeResult {
  handled: boolean;
  worldChanged: boolean;
}

interface BetonoedState {
  weakIdx: number;
  weakX: number;
  weakY: number;
  nearRoomId: number;
  farRoomId: number;
  monsterId: number;
  breached: boolean;
  sealed: boolean;
  used: boolean;
  drivenOff: boolean;
  warned: boolean;
  noiseBaitSeen: boolean;
  breachAt: number;
  scanAt: number;
  fireExposure: number;
  lastHp: number;
  damageNoticeAt: number;
  lastNoiseId: number;
  lureNoticeAt: number;
}

let activeBetonoed: BetonoedState | null = null;

function ok(world: World, x: number, y: number): number {
  return world.idx(world.wrap(x), world.wrap(y));
}

function cellX(idx: number): number {
  return idx % W;
}

function cellY(idx: number): number {
  return (idx / W) | 0;
}

function roomById(world: World, id: number): Room | null {
  return world.rooms[id] ?? null;
}

function inWrappedSpan(world: World, value: number, start: number, len: number): boolean {
  const d = (world.wrap(Math.floor(value)) - world.wrap(start) + W) % W;
  return d >= 0 && d < len;
}

function pointInRoom(world: World, room: Room, x: number, y: number): boolean {
  return inWrappedSpan(world, x, room.x, room.w) && inWrappedSpan(world, y, room.y, room.h);
}

function findBetonoed(entities: Entity[], encounter: BetonoedState): Entity | null {
  return entities.find(e => e.id === encounter.monsterId && e.type === EntityType.MONSTER) ?? null;
}

function weakRoomZone(world: World, encounter: BetonoedState): number {
  return world.zoneMap[encounter.weakIdx];
}

function setWeakWall(world: World, encounter: BetonoedState, wall: boolean): void {
  const ci = encounter.weakIdx;
  world.cells[ci] = wall ? Cell.WALL : Cell.FLOOR;
  world.features[ci] = Feature.NONE;
  world.aptMask[ci] = 0;
  world.hermoWall[ci] = wall ? 1 : 0;
  world.roomMap[ci] = -1;
  if (wall) {
    world.wallTex[ci] = Tex.CONCRETE;
  } else {
    world.floorTex[ci] = Tex.F_CONCRETE;
  }
  world.markWallTexDirty();
  world.markFloorTexDirty();
}

function weakPassageClosed(world: World, encounter: BetonoedState): boolean {
  const cell = world.cells[encounter.weakIdx];
  if (cell === Cell.WALL) return true;
  if (cell !== Cell.DOOR) return false;
  const door = world.doors.get(encounter.weakIdx);
  return !door ||
    door.state === DoorState.CLOSED ||
    door.state === DoorState.HERMETIC_CLOSED ||
    door.state === DoorState.LOCKED;
}

function publishBetonoedEvent(
  world: World,
  state: GameState,
  encounter: BetonoedState,
  type: 'door_opened' | 'door_sealed' | 'death_seen',
  tags: string[],
  severity: 3 | 4 | 5,
  data: Record<string, unknown>,
): void {
  publishEvent(state, {
    type,
    zoneId: weakRoomZone(world, encounter),
    roomId: encounter.nearRoomId,
    x: encounter.weakX + 0.5,
    y: encounter.weakY + 0.5,
    actorId: type === 'death_seen' ? encounter.monsterId : undefined,
    targetId: type === 'door_opened' && !tags.includes('shortcut_used') ? encounter.monsterId : encounter.weakIdx,
    targetName: 'слабая бетонная стена',
    itemId: tags.includes('sealant') ? 'sealant_tube' : tags.includes('block_kit') ? 'block_kit' : undefined,
    monsterKind: MonsterKind.BETONOED,
    severity,
    privacy: 'local',
    tags: ['maintenance', 'betonoed', 'shortcut', ...tags],
    data: {
      system: 'betonoed_shortcut',
      weakCell: encounter.weakIdx,
      weakX: encounter.weakX,
      weakY: encounter.weakY,
      nearRoomId: encounter.nearRoomId,
      farRoomId: encounter.farRoomId,
      ...data,
    },
  });
}

function warnBreach(state: GameState, encounter: BetonoedState, reason: string): void {
  if (encounter.warned) return;
  encounter.warned = true;
  state.msgs.push(msg(
    reason === 'noise'
      ? 'Бетоноед пошёл на шум. Слабая стена скоро станет проходом.'
      : 'За слабой стеной хрустит бетон. Герметик, блок-комплект, шумовая приманка или огонь решат исход.',
    state.time,
    '#fa4',
  ));
}

function breachWall(world: World, player: Entity, state: GameState, encounter: BetonoedState, reason: string): boolean {
  if (encounter.breached || encounter.sealed) return false;
  setWeakWall(world, encounter, false);
  encounter.breached = true;
  encounter.breachAt = 0;
  state.msgs.push(msg('Бетоноед прогрыз бетон. Открылся короткий ход, но он не пустой.', state.time, '#f84'));
  publishBetonoedEvent(world, state, encounter, 'door_opened', ['wall_breached', reason], 5, {
    reason,
    playerX: player.x,
    playerY: player.y,
  });
  return true;
}

function sealWeakWall(world: World, player: Entity, state: GameState, encounter: BetonoedState, reason: string): boolean {
  if (encounter.sealed) return false;
  setWeakWall(world, encounter, true);
  encounter.sealed = true;
  encounter.breachAt = 0;
  state.msgs.push(msg(
    encounter.breached
      ? 'Проход запечатан. Бетоноед скребёт бетон с другой стороны.'
      : 'Слабый шов запечатан. Бетоноед потерял короткий выход.',
    state.time,
    '#6cf',
  ));
  publishBetonoedEvent(world, state, encounter, 'door_sealed', ['sealed', reason], 4, {
    reason,
    playerX: player.x,
    playerY: player.y,
  });
  return true;
}

function driveOffBetonoed(world: World, monster: Entity, state: GameState, encounter: BetonoedState, reason: string): void {
  if (encounter.drivenOff) return;
  encounter.drivenOff = true;
  monster.alive = false;
  monster.hp = 0;
  state.msgs.push(msg(
    reason === 'fire'
      ? 'Огонь выгнал Бетоноеда в трещину. Проход остался, тварь ушла.'
      : 'Бетоноед ушёл глубже в бетон.',
    state.time,
    reason === 'fire' ? '#fc4' : '#8cf',
  ));
  publishBetonoedEvent(world, state, encounter, 'death_seen', ['driven_off', reason], 4, { reason });
}

function seesWeakWall(world: World, encounter: BetonoedState, lookX: number, lookY: number): boolean {
  return world.dist2(lookX, lookY, encounter.weakX + 0.5, encounter.weakY + 0.5) <= 2.25;
}

function noiseBaitNear(world: World, entities: Entity[], encounter: BetonoedState): boolean {
  for (const drop of entities) {
    if (drop.type !== EntityType.ITEM_DROP || !drop.alive || !drop.inventory) continue;
    if (world.dist2(drop.x, drop.y, encounter.weakX + 0.5, encounter.weakY + 0.5) > NOISE_BAIT_SQ) continue;
    for (const item of drop.inventory) {
      if (NOISE_BAIT_IDS.has(item.defId)) return true;
    }
  }
  return false;
}

function flameNear(world: World, entities: Entity[], monster: Entity): boolean {
  for (const e of entities) {
    if (e.type !== EntityType.PROJECTILE || !e.alive) continue;
    if (e.projType !== ProjType.FLAME) continue;
    if (world.dist2(e.x, e.y, monster.x, monster.y) <= 3.2 * 3.2) return true;
  }
  return false;
}

function applyNoiseLure(world: World, monster: Entity, state: GameState, encounter: BetonoedState): boolean {
  const noise = findNoiseForActor(world, state, monster, state.time, {
    minSeverity: 2,
    scanInterval: 0.35,
    hearingMult: 1.35,
  });
  if (!noise || noise.id === encounter.lastNoiseId) return false;
  encounter.lastNoiseId = noise.id;
  if (noise.actorId === monster.id) return false;

  const nearWeakWall = world.dist2(noise.x, noise.y, encounter.weakX + 0.5, encounter.weakY + 0.5) <= NOISE_LURE_SQ;
  if (nearWeakWall) {
    encounter.noiseBaitSeen = true;
    encounter.breachAt = Math.min(encounter.breachAt || Infinity, state.time + 0.8);
    monster.ai = {
      ...(monster.ai ?? { goal: AIGoal.WANDER, tx: encounter.weakX, ty: encounter.weakY, path: [], pi: 0, stuck: 0, timer: 0 }),
      goal: AIGoal.GOTO,
      tx: encounter.weakX,
      ty: encounter.weakY,
      path: [],
      pi: 0,
      timer: 0,
    };
    warnBreach(state, encounter, 'noise');
    return true;
  }

  if (encounter.breachAt > 0) {
    encounter.breachAt = Math.max(encounter.breachAt, state.time + 1.8);
  }
  monster.ai = {
    ...(monster.ai ?? { goal: AIGoal.WANDER, tx: Math.floor(noise.x), ty: Math.floor(noise.y), path: [], pi: 0, stuck: 0, timer: 0 }),
    goal: AIGoal.GOTO,
    tx: Math.floor(noise.x),
    ty: Math.floor(noise.y),
    path: [],
    pi: 0,
    timer: 0,
  };
  if (state.time >= encounter.lureNoticeAt) {
    state.msgs.push(msg('Бетоноед ушёл на шум. Слабая стена получила короткую паузу.', state.time, '#fc8'));
    encounter.lureNoticeAt = state.time + 2.8;
  }
  return true;
}

function spawnBetonoed(ctx: MaintContentCtx, room: Room, weakX: number, weakY: number): number {
  const def = MONSTERS[MonsterKind.BETONOED];
  const pos = worldFloorCell(ctx.world, room, weakX - 2, weakY);
  const x = pos.x;
  const y = pos.y;
  const zoneLevel = ctx.world.zones[ctx.world.zoneMap[ctx.world.idx(x, y)]]?.level ?? 4;
  const hp = Math.round(def.hp * (0.74 + zoneLevel * 0.04));
  const monster: Entity = {
    id: ctx.nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: def.speed,
    sprite: monsterSpr(MonsterKind.BETONOED),
    hp,
    maxHp: hp,
    name: 'Бетоноед',
    monsterKind: MonsterKind.BETONOED,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: weakX, ty: weakY, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
  };
  ctx.entities.push(monster);
  return monster.id;
}

function worldFloorCell(world: World, room: Room, preferredX: number, preferredY: number): { x: number; y: number } {
  const px = world.wrap(preferredX);
  const py = world.wrap(preferredY);
  if (world.cells[world.idx(px, py)] === Cell.FLOOR) return { x: px, y: py };
  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      if (world.cells[world.idx(x, y)] === Cell.FLOOR) return { x, y };
    }
  }
  return { x: world.wrap(room.x + 1), y: world.wrap(room.y + 1) };
}

export function generateBetonoedShortcut(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 32, 18, 85, 170);
  const y = pos.y + 4;

  const bait = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.STORAGE,
    pos.x, y, 13, 9,
    `${ROOM_PREFIX}: шумная кладовая у слабой стены`,
    Tex.CONCRETE, Tex.F_CONCRETE,
  );
  const shortcut = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.CORRIDOR,
    pos.x + bait.w + 1, y, 13, 9,
    `${ROOM_PREFIX}: короткий ход за съедаемой стеной`,
    Tex.PIPE, Tex.F_CONCRETE,
  );

  const weakX = ctx.world.wrap(bait.x + bait.w);
  const weakY = ctx.world.wrap(bait.y + Math.floor(bait.h / 2));
  const weakIdx = ok(ctx.world, weakX, weakY);
  ctx.world.cells[weakIdx] = Cell.WALL;
  ctx.world.wallTex[weakIdx] = Tex.CONCRETE;
  ctx.world.features[weakIdx] = Feature.NONE;
  ctx.world.aptMask[weakIdx] = 0;
  ctx.world.hermoWall[weakIdx] = 0;
  ctx.world.roomMap[weakIdx] = -1;

  for (let dy = -2; dy <= 2; dy++) {
    const left = ok(ctx.world, weakX - 1, weakY + dy);
    const right = ok(ctx.world, weakX + 1, weakY + dy);
    if (ctx.world.cells[left] === Cell.FLOOR) ctx.world.floorTex[left] = Tex.F_CONCRETE;
    if (ctx.world.cells[right] === Cell.FLOOR) ctx.world.floorTex[right] = Tex.F_CONCRETE;
  }

  setFeature(ctx.world, bait.x + 2, bait.y + 2, Feature.SHELF);
  setFeature(ctx.world, bait.x + 5, bait.y + 2, Feature.SCREEN);
  setFeature(ctx.world, bait.x + 9, bait.y + 2, Feature.LAMP);
  setFeature(ctx.world, weakX - 1, weakY - 1, Feature.APPARATUS);
  setFeature(ctx.world, shortcut.x + 2, shortcut.y + 2, Feature.CANDLE);
  setFeature(ctx.world, shortcut.x + 5, shortcut.y + 4, Feature.MACHINE);
  setFeature(ctx.world, shortcut.x + shortcut.w - 3, shortcut.y + 2, Feature.SHELF);

  stampSurfaceSplat(ctx.world, weakX - 1, weakY, 0.5, 0.5, 0.4, 80, weakIdx, 120, 120, 115);
  stampSurfaceSplat(ctx.world, weakX + 1, weakY, 0.5, 0.5, 0.35, 75, weakIdx + 1, 95, 82, 62);

  dropItems(ctx, bait, ['noise_can', 'bottled_voice', 'sealant_tube', 'block_kit', 'flamethrower', 'ammo_fuel']);
  dropItems(ctx, shortcut, ['rebar', 'ammo_fuel', 'psi_concrete_splinter']);

  const monsterId = spawnBetonoed(ctx, bait, weakX, weakY);
  activeBetonoed = {
    weakIdx,
    weakX,
    weakY,
    nearRoomId: bait.id,
    farRoomId: shortcut.id,
    monsterId,
    breached: false,
    sealed: false,
    used: false,
    drivenOff: false,
    warned: false,
    noiseBaitSeen: false,
    breachAt: 0,
    scanAt: 0,
    fireExposure: 0,
    lastHp: 0,
    damageNoticeAt: 0,
    lastNoiseId: 0,
    lureNoticeAt: 0,
  };
}

export function tryUseBetonoedShortcut(
  world: World,
  player: Entity,
  state: GameState,
  lookX: number,
  lookY: number,
): BetonoedRuntimeResult {
  const encounter = activeBetonoed;
  if (!encounter || state.currentFloor !== FloorLevel.MAINTENANCE) return { handled: false, worldChanged: false };
  if (!seesWeakWall(world, encounter, lookX, lookY)) return { handled: false, worldChanged: false };

  if (encounter.sealed) {
    state.msgs.push(msg('Слабая стена уже запечатана.', state.time, '#8cf'));
    return { handled: true, worldChanged: false };
  }

  if (hasItem(player, 'sealant_tube')) {
    removeItem(player, 'sealant_tube', 1);
    const changed = sealWeakWall(world, player, state, encounter, 'sealant');
    return { handled: true, worldChanged: changed };
  }

  if (hasItem(player, 'block_kit')) {
    removeItem(player, 'block_kit', 1);
    const changed = sealWeakWall(world, player, state, encounter, 'block_kit');
    return { handled: true, worldChanged: changed };
  }

  state.msgs.push(msg(
    encounter.breached
      ? 'Открытый прогрыз можно закрыть комплектом блока или герметиком.'
      : 'Слабый шов. Герметик запечатает его, шумовая приманка ускорит прогрыз, огонь отгонит Бетоноеда.',
    state.time,
    '#fa4',
  ));
  return { handled: true, worldChanged: false };
}

export function updateBetonoedShortcut(
  world: World,
  entities: Entity[],
  player: Entity,
  state: GameState,
  dt: number,
): boolean {
  const encounter = activeBetonoed;
  if (!encounter || state.currentFloor !== FloorLevel.MAINTENANCE) return false;

  const monster = findBetonoed(entities, encounter);
  if (!monster?.alive) {
    if (encounter.breached && !encounter.used) return maybeMarkShortcutUsed(world, player, state, encounter);
    return false;
  }

  if (flameNear(world, entities, monster)) {
    encounter.fireExposure += dt;
    monster.speed = Math.max(0.25, monster.speed * 0.985);
    if (encounter.fireExposure >= FIRE_DRIVE_OFF_SECONDS) {
      driveOffBetonoed(world, monster, state, encounter, 'fire');
      return false;
    }
  } else {
    encounter.fireExposure = Math.max(0, encounter.fireExposure - dt * 0.5);
  }

  applyNoiseLure(world, monster, state, encounter);

  if (!encounter.breached && !encounter.sealed && monster.hp !== undefined) {
    if (encounter.lastHp <= 0) encounter.lastHp = monster.hp;
    if (monster.hp < encounter.lastHp - 0.5) {
      if (encounter.breachAt > 0) encounter.breachAt = Math.max(encounter.breachAt, state.time + 1.4);
      if (state.time >= encounter.damageNoticeAt) {
        state.msgs.push(msg('Бетоноед сбился с прогрыза и отступил от шва.', state.time, '#fc4'));
        encounter.damageNoticeAt = state.time + 2.4;
      }
    }
    encounter.lastHp = monster.hp;
  }

  if (encounter.breached && !encounter.sealed && weakPassageClosed(world, encounter)) {
    encounter.sealed = true;
    publishBetonoedEvent(world, state, encounter, 'door_sealed', ['sealed', 'construction'], 4, {
      reason: 'player_construction',
    });
  }

  if (encounter.breached) return maybeMarkShortcutUsed(world, player, state, encounter);
  if (encounter.sealed) return false;

  const nearWeak = world.dist2(player.x, player.y, encounter.weakX + 0.5, encounter.weakY + 0.5) <= BREACH_NEAR_SQ;
  let bait = false;
  encounter.scanAt -= dt;
  if (encounter.scanAt <= 0) {
    encounter.scanAt = 0.45;
    bait = noiseBaitNear(world, entities, encounter);
  }

  const nearEncounter = world.dist2(player.x, player.y, encounter.weakX + 0.5, encounter.weakY + 0.5) <= BREACH_KEEPALIVE_SQ;
  if (bait && nearEncounter && !encounter.noiseBaitSeen) {
    encounter.noiseBaitSeen = true;
    encounter.breachAt = Math.min(encounter.breachAt || Infinity, state.time + 0.8);
    warnBreach(state, encounter, 'noise');
  } else if (nearWeak && encounter.breachAt <= 0) {
    encounter.breachAt = state.time + 2.8;
    warnBreach(state, encounter, 'proximity');
  }

  if (encounter.breachAt > 0 && !encounter.noiseBaitSeen) {
    const stillNear = world.dist2(player.x, player.y, encounter.weakX + 0.5, encounter.weakY + 0.5) <= BREACH_KEEPALIVE_SQ;
    if (!stillNear) {
      encounter.breachAt = 0;
      encounter.warned = false;
      state.msgs.push(msg('Стена затихла. Бетоноед потерял интерес к этому шву.', state.time, '#888'));
    }
  }

  if (encounter.breachAt > 0 && state.time >= encounter.breachAt) {
    return breachWall(world, player, state, encounter, encounter.noiseBaitSeen ? 'noise' : 'proximity');
  }

  return false;
}

function maybeMarkShortcutUsed(world: World, player: Entity, state: GameState, encounter: BetonoedState): boolean {
  if (encounter.used || encounter.sealed) return false;
  const farRoom = roomById(world, encounter.farRoomId);
  if (!farRoom || !pointInRoom(world, farRoom, player.x, player.y)) return false;
  encounter.used = true;
  state.msgs.push(msg('Вы проскочили через ход Бетоноеда. Маршрут стал короче, воздух - хуже.', state.time, '#6cf'));
  publishBetonoedEvent(world, state, encounter, 'door_opened', ['shortcut_used', 'player'], 4, {
    playerX: player.x,
    playerY: player.y,
  });
  return false;
}

export function summarizeBetonoedShortcut(): string[] {
  const encounter = activeBetonoed;
  if (!encounter) return ['[BETONOED] encounter=none'];
  return [
    `[BETONOED] weak=${cellX(encounter.weakIdx)},${cellY(encounter.weakIdx)} monster=${encounter.monsterId} breached=${encounter.breached ? 1 : 0} sealed=${encounter.sealed ? 1 : 0} used=${encounter.used ? 1 : 0} drivenOff=${encounter.drivenOff ? 1 : 0}`,
  ];
}

registerContentInteractionHook({
  id: 'maint_betonoed_shortcut',
  use(ctx) {
    const result = tryUseBetonoedShortcut(ctx.world, ctx.player, ctx.state, ctx.lookX, ctx.lookY);
    return result.handled ? { handled: true, worldChanged: result.worldChanged } : undefined;
  },
});

registerContentRuntimeHook({
  id: 'maint_betonoed_shortcut',
  phases: ['pre_ai'],
  update(ctx) {
    return { worldChanged: updateBetonoedShortcut(ctx.world, ctx.entities, ctx.player, ctx.state, ctx.dt) };
  },
});
