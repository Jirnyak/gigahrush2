/* ── Lift arachna: rare readable shaft ambush ────────────────── */

import {
  AIGoal,
  Cell,
  EntityType,
  Feature,
  FloorLevel,
  LiftDirection,
  MonsterKind,
  type Entity,
  type GameState,
  type WorldEventType,
  msg,
} from '../core/types';
import { World } from '../core/world';
import { hashSeed, randSeed } from '../core/rand';
import { MONSTERS } from '../entities/monster';
import { monsterSpr } from '../render/sprite_index';
import { stampMark, MarkType } from './surface_marks';
import { publishEvent } from './events';
import { randomRPG } from './rpg';
import type { ActiveFloorInstance } from './floor_instances';
import type { FloorRunEntry } from './procedural_floors';

export interface LiftArachnaWarningSnapshot {
  secondsLeft: number;
  zoneId: number;
  secondWarning: boolean;
  baited: boolean;
}

interface ActiveLiftArachna {
  key: string;
  floor: FloorLevel;
  zoneId: number;
  liftX: number;
  liftY: number;
  startedAt: number;
  dropAt: number;
  threatLevel: number;
  secondWarning: boolean;
  direction: 'up' | 'down' | 'unknown';
  lookUpTime: number;
  baited: boolean;
  baitMsg: boolean;
  sprung: boolean;
  monsterId?: number;
}

export interface LiftArachnaState {
  active: ActiveLiftArachna | null;
  resolved: Record<string, string>;
  warnedCount: number;
  sprungCount: number;
  clearedCount: number;
  lastResolvedAt: number;
}

export interface LiftArachnaArrivalCtx {
  direction: LiftDirection;
  runEntry: FloorRunEntry | null;
  activeInstance: ActiveFloorInstance | null;
}

type LiftArachnaHost = GameState & { liftArachna?: LiftArachnaState };

const LIFT_SEARCH_RADIUS = 8;
const MIN_ROLL_GAP_SECONDS = 150;
const RETREAT_DIST2 = 9 * 9;
const LOOK_UP_PITCH = 0.55;
const LOOK_UP_SECONDS = 0.32;

function createLiftArachnaState(): LiftArachnaState {
  return {
    active: null,
    resolved: {},
    warnedCount: 0,
    sprungCount: 0,
    clearedCount: 0,
    lastResolvedAt: -Infinity,
  };
}

function normalizeActive(input: Partial<ActiveLiftArachna> | null | undefined): ActiveLiftArachna | null {
  if (!input || typeof input.key !== 'string') return null;
  return {
    key: input.key,
    floor: typeof input.floor === 'number' ? input.floor : FloorLevel.LIVING,
    zoneId: typeof input.zoneId === 'number' ? input.zoneId : -1,
    liftX: typeof input.liftX === 'number' ? input.liftX : 0,
    liftY: typeof input.liftY === 'number' ? input.liftY : 0,
    startedAt: typeof input.startedAt === 'number' ? input.startedAt : 0,
    dropAt: typeof input.dropAt === 'number' ? input.dropAt : 0,
    threatLevel: Math.max(1, Math.min(5, Math.round(input.threatLevel ?? 2))),
    secondWarning: input.secondWarning === true,
    direction: input.direction === 'up' || input.direction === 'down' ? input.direction : 'unknown',
    lookUpTime: Math.max(0, input.lookUpTime ?? 0),
    baited: input.baited === true,
    baitMsg: input.baitMsg === true,
    sprung: input.sprung === true,
    monsterId: typeof input.monsterId === 'number' ? input.monsterId : undefined,
  };
}

export function normalizeLiftArachnaState(input: Partial<LiftArachnaState> | null | undefined): LiftArachnaState {
  const out = createLiftArachnaState();
  if (!input) return out;
  out.active = normalizeActive(input.active);
  out.warnedCount = Math.max(0, Math.floor(input.warnedCount ?? 0));
  out.sprungCount = Math.max(0, Math.floor(input.sprungCount ?? 0));
  out.clearedCount = Math.max(0, Math.floor(input.clearedCount ?? 0));
  out.lastResolvedAt = typeof input.lastResolvedAt === 'number' ? input.lastResolvedAt : -Infinity;
  const resolved = input.resolved ?? {};
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof key === 'string' && typeof value === 'string') out.resolved[key] = value;
  }
  return out;
}

export function ensureLiftArachnaState(state: GameState): LiftArachnaState {
  const host = state as LiftArachnaHost;
  host.liftArachna = normalizeLiftArachnaState(host.liftArachna);
  return host.liftArachna;
}

export function setLiftArachnaState(
  state: GameState,
  input: Partial<LiftArachnaState> | null | undefined,
): LiftArachnaState {
  const normalized = normalizeLiftArachnaState(input);
  (state as LiftArachnaHost).liftArachna = normalized;
  return normalized;
}

export function liftArachnaStateForSave(state: GameState): LiftArachnaState {
  return normalizeLiftArachnaState((state as LiftArachnaHost).liftArachna);
}

export function clearLiftArachnaActive(state: GameState): void {
  ensureLiftArachnaState(state).active = null;
}

function floorDirection(direction: LiftDirection): 'up' | 'down' {
  return direction === LiftDirection.UP ? 'up' : 'down';
}

function liftArachnaKey(state: GameState, ctx: LiftArachnaArrivalCtx): string {
  const dir = floorDirection(ctx.direction);
  if (ctx.activeInstance) return `instance:${ctx.activeInstance.id}:${ctx.activeInstance.seed}:${dir}`;
  if (ctx.runEntry?.spec) return `proc:${ctx.runEntry.spec.key}:${dir}`;
  if (ctx.runEntry?.designFloorId) return `design:${ctx.runEntry.designFloorId}:${dir}`;
  return `story:${state.currentFloor}:${dir}`;
}

function liftArachnaThreat(ctx: LiftArachnaArrivalCtx): number {
  if (ctx.activeInstance) return Math.max(1, Math.min(5, Math.round(ctx.activeInstance.risk)));
  if (ctx.runEntry?.spec) return ctx.runEntry.spec.danger;
  if (ctx.runEntry?.designFloorId) return 3;
  return 2;
}

function liftArachnaChance(ctx: LiftArachnaArrivalCtx): number {
  const threat = liftArachnaThreat(ctx);
  if (ctx.activeInstance) return Math.min(0.22, 0.09 + threat * 0.025);
  if (ctx.runEntry?.spec) return Math.min(0.18, 0.045 + threat * 0.023);
  if (ctx.runEntry?.designFloorId) return 0.045;
  return 0.025;
}

function passable(world: World, x: number, y: number): boolean {
  const ci = world.idx(x, y);
  const cell = world.cells[ci];
  return (cell === Cell.FLOOR || cell === Cell.WATER) && !world.solid(x, y);
}

function nearestLift(world: World, player: Entity): { x: number; y: number; zoneId: number } | null {
  const px = Math.floor(player.x);
  const py = Math.floor(player.y);
  let best: { x: number; y: number; zoneId: number } | null = null;
  let bestD2 = Infinity;

  for (let dy = -LIFT_SEARCH_RADIUS; dy <= LIFT_SEARCH_RADIUS; dy++) {
    for (let dx = -LIFT_SEARCH_RADIUS; dx <= LIFT_SEARCH_RADIUS; dx++) {
      const x = world.wrap(px + dx);
      const y = world.wrap(py + dy);
      const ci = world.idx(x, y);
      if (world.cells[ci] !== Cell.LIFT && world.features[ci] !== Feature.LIFT_BUTTON) continue;
      const d2 = world.dist2(player.x, player.y, x + 0.5, y + 0.5);
      if (d2 >= bestD2) continue;
      bestD2 = d2;
      best = { x, y, zoneId: world.zoneMap[ci] };
    }
  }
  return best;
}

function stampCeilingShadow(world: World, liftX: number, liftY: number, seed: number): void {
  const dirs = [
    [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
  ] as const;
  for (let i = 0; i < dirs.length; i++) {
    const x = world.wrap(liftX + dirs[i][0]);
    const y = world.wrap(liftY + dirs[i][1]);
    if (world.solid(x, y) && world.cells[world.idx(x, y)] !== Cell.LIFT) continue;
    stampMark(world, x, y, 0.5, 0.5, i === 0 ? 0.55 : 0.28, MarkType.PSI, seed + i, 20, 18, 24, i === 0 ? 150 : 85);
  }
}

function publishLiftArachnaEvent(
  state: GameState,
  active: ActiveLiftArachna,
  type: WorldEventType,
  severity: 3 | 4,
  outcome: string,
  monsterId?: number,
): void {
  publishEvent(state, {
    type,
    zoneId: active.zoneId >= 0 ? active.zoneId : undefined,
    x: active.liftX + 0.5,
    y: active.liftY + 0.5,
    targetId: monsterId,
    targetName: 'Лифтовая арахна',
    monsterKind: MonsterKind.POLZUN,
    severity,
    privacy: 'local',
    tags: ['lift', 'shaft', 'lift_arachna', outcome],
    data: {
      key: active.key,
      direction: active.direction,
      threatLevel: active.threatLevel,
      liftX: active.liftX,
      liftY: active.liftY,
      baited: active.baited,
      outcome,
    },
  });
}

export function tryStartLiftArachnaEncounter(
  world: World,
  player: Entity,
  state: GameState,
  ctx: LiftArachnaArrivalCtx,
): boolean {
  const store = ensureLiftArachnaState(state);
  store.active = null;
  const lift = nearestLift(world, player);
  if (!lift) return false;
  if (state.time - store.lastResolvedAt < MIN_ROLL_GAP_SECONDS) return false;

  const key = liftArachnaKey(state, ctx);
  if (store.resolved[key]) return false;

  const chance = liftArachnaChance(ctx);
  const seed = hashSeed(key, Math.floor(state.time * 1000));
  if (Math.random() >= chance) return false;

  const secondWarning = store.warnedCount > 0;
  const threatLevel = liftArachnaThreat(ctx);
  const active: ActiveLiftArachna = {
    key,
    floor: state.currentFloor,
    zoneId: lift.zoneId,
    liftX: lift.x,
    liftY: lift.y,
    startedAt: state.time,
    dropAt: state.time + (secondWarning ? 5.5 : 4.2),
    threatLevel,
    secondWarning,
    direction: floorDirection(ctx.direction),
    lookUpTime: 0,
    baited: false,
    baitMsg: false,
    sprung: false,
  };
  store.active = active;
  store.warnedCount++;

  stampCeilingShadow(world, lift.x, lift.y, seed);
  state.msgs.push(msg(
    secondWarning
      ? 'ЛИФТОВАЯ АРАХНА: кабина теплая, нить в шахте. Смотрите вверх или уходите от лифта.'
      : 'Лифт привез теплый запах и замолчал. Над кабиной скребет бетон, с потолка свисает тонкая нить.',
    state.time,
    secondWarning ? '#f4a' : '#fa0',
  ));
  publishLiftArachnaEvent(state, active, 'lift_arachna_warned', 4, 'warned');
  return true;
}

function resolveActive(
  world: World,
  state: GameState,
  active: ActiveLiftArachna,
  type: WorldEventType,
  status: string,
  text: string,
  color: string,
): void {
  const store = ensureLiftArachnaState(state);
  store.resolved[active.key] = status;
  store.lastResolvedAt = state.time;
  if (type === 'lift_arachna_cleared') store.clearedCount++;
  state.msgs.push(msg(text, state.time, color));
  stampCeilingShadow(world, active.liftX, active.liftY, randSeed());
  publishLiftArachnaEvent(state, active, type, type === 'lift_arachna_cleared' ? 4 : 3, status, active.monsterId);
  store.active = null;
}

export function resolveLiftArachnaDeparture(world: World, _player: Entity, state: GameState): void {
  const active = ensureLiftArachnaState(state).active;
  if (!active) return;
  if (active.sprung) {
    ensureLiftArachnaState(state).active = null;
    return;
  }
  resolveActive(
    world,
    state,
    active,
    'lift_arachna_avoided',
    'left_by_lift',
    'Лифт увез вас раньше, чем нить выдержала вес. Запах остался в шахте.',
    '#8cf',
  );
}

function findDropSpot(world: World, player: Entity, active: ActiveLiftArachna): { x: number; y: number } | null {
  const fromLift = Math.atan2(player.y - (active.liftY + 0.5), player.x - (active.liftX + 0.5));
  const angles = [
    fromLift,
    fromLift + 0.7,
    fromLift - 0.7,
    player.angle + Math.PI * 0.5,
    player.angle - Math.PI * 0.5,
    player.angle + Math.PI,
  ];
  for (const dist of [2.2, 3.0, 3.8, 4.6]) {
    for (const angle of angles) {
      const x = world.wrap(Math.floor(player.x + Math.cos(angle) * dist));
      const y = world.wrap(Math.floor(player.y + Math.sin(angle) * dist));
      if (!passable(world, x, y)) continue;
      if (world.dist2(player.x, player.y, x + 0.5, y + 0.5) < 2.25) continue;
      return { x: x + 0.5, y: y + 0.5 };
    }
  }
  return null;
}

function spawnLiftArachna(world: World, entities: Entity[], player: Entity, state: GameState, nextId: { v: number }, active: ActiveLiftArachna): void {
  const spot = findDropSpot(world, player, active);
  if (!spot) {
    resolveActive(
      world,
      state,
      active,
      'lift_arachna_avoided',
      'no_drop_cell',
      'В шахте щелкнуло, но арахна не нашла пола под бросок. Кабина осталась теплой и чужой.',
      '#8cf',
    );
    return;
  }

  const def = MONSTERS[MonsterKind.POLZUN];
  const level = Math.max(1, Math.min(6, active.threatLevel + 1));
  const hp = active.baited ? 45 + active.threatLevel * 4 : 70 + active.threatLevel * 8;
  const arachna: Entity = {
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: spot.x,
    y: spot.y,
    angle: Math.atan2(player.y - spot.y, player.x - spot.x),
    pitch: 0,
    alive: true,
    speed: active.baited ? 1.15 : 2.05,
    sprite: monsterSpr(MonsterKind.POLZUN),
    hp,
    maxHp: hp,
    name: 'Лифтовая арахна',
    monsterKind: MonsterKind.POLZUN,
    monsterDmgMult: active.baited ? 0.65 : 0.9,
    attackCd: active.baited ? 2.4 : def.attackRate,
    spriteScale: 0.85,
    ai: {
      goal: AIGoal.HUNT,
      tx: Math.floor(player.x),
      ty: Math.floor(player.y),
      path: [],
      pi: 0,
      stuck: 0,
      timer: 0,
      combatTargetId: player.id,
    },
    rpg: randomRPG(level),
  };
  entities.push(arachna);
  active.sprung = true;
  active.monsterId = arachna.id;
  const store = ensureLiftArachnaState(state);
  store.sprungCount++;
  store.resolved[active.key] = active.baited ? 'baited_drop' : 'drop';
  store.lastResolvedAt = state.time;
  state.msgs.push(msg(
    active.baited
      ? 'Арахна сорвалась на шум и ударилась о поручень кабины.'
      : 'С потолка у лифта падает лифтовая арахна. Двери закрываются слишком поздно.',
    state.time,
    '#f44',
  ));
  stampCeilingShadow(world, active.liftX, active.liftY, randSeed());
  publishLiftArachnaEvent(state, active, 'lift_arachna_sprung', 4, active.baited ? 'baited_drop' : 'drop', arachna.id);
}

function hardCounterWeapon(weaponId: string): boolean {
  return weaponId === 'shotgun' ||
    weaponId === 'toz_shotgun' ||
    weaponId === 'flamethrower' ||
    weaponId === 'grenade' ||
    weaponId === 'bfg' ||
    weaponId === 'plasma' ||
    weaponId === 'gauss';
}

function loudWeapon(weaponId: string): boolean {
  if (hardCounterWeapon(weaponId)) return true;
  return weaponId === 'makarov' ||
    weaponId === 'ppsh' ||
    weaponId === 'ak47' ||
    weaponId === 'machinegun' ||
    weaponId === 'nailgun' ||
    weaponId === 'chainsaw' ||
    weaponId === 'jackhammer' ||
    weaponId === 'tt_pistol' ||
    weaponId === 'nagant' ||
    weaponId === 'homemade_pistol' ||
    weaponId === 'harpoon_gun' ||
    weaponId === 'pipe' ||
    weaponId === 'rebar' ||
    weaponId === 'crowbar' ||
    weaponId === 'sledgehammer' ||
    weaponId === 'metal_chair';
}

export function notifyLiftArachnaNoise(
  world: World,
  player: Entity,
  state: GameState,
  weaponId: string,
): void {
  const active = ensureLiftArachnaState(state).active;
  if (!active || active.sprung || active.floor !== state.currentFloor) return;
  if (!loudWeapon(weaponId)) return;
  if (world.dist2(player.x, player.y, active.liftX + 0.5, active.liftY + 0.5) > RETREAT_DIST2) return;

  if (hardCounterWeapon(weaponId) && player.pitch > 0.3) {
    resolveActive(
      world,
      state,
      active,
      'lift_arachna_cleared',
      `preempt_${weaponId || 'noise'}`,
      'Вы ударили в шахту до броска. Нить оборвалась, арахна ушла выше, туда, где лифт не отвечает.',
      '#4f4',
    );
    return;
  }

  active.baited = true;
  active.dropAt = Math.min(active.dropAt, state.time + 0.75);
  if (!active.baitMsg) {
    active.baitMsg = true;
    state.msgs.push(msg('Шум сорвал арахну с потолка. Теперь она падает неудачно, цепляясь за поручень кабины.', state.time, '#fc4'));
  }
}

export function updateLiftArachnaEncounter(
  world: World,
  entities: Entity[],
  player: Entity,
  state: GameState,
  dt: number,
  nextId: { v: number },
): void {
  const active = ensureLiftArachnaState(state).active;
  if (!active) return;
  if (active.floor !== state.currentFloor) {
    ensureLiftArachnaState(state).active = null;
    return;
  }

  if (active.sprung) {
    const monster = active.monsterId !== undefined ? entities.find(e => e.id === active.monsterId) : undefined;
    if (!monster || !monster.alive) {
      resolveActive(
        world,
        state,
        active,
        'lift_arachna_cleared',
        'monster_down',
        'Лифтовая арахна больше не держит шахту. Кнопка остывает.',
        '#4f4',
      );
    }
    return;
  }

  const d2 = world.dist2(player.x, player.y, active.liftX + 0.5, active.liftY + 0.5);
  if (d2 > RETREAT_DIST2) {
    resolveActive(
      world,
      state,
      active,
      'lift_arachna_avoided',
      'retreated',
      'Вы отошли от шахты. Нить дернулась и ушла обратно в бетон, лифт отказался спорить.',
      '#8cf',
    );
    return;
  }

  if (player.pitch >= LOOK_UP_PITCH) {
    active.lookUpTime += dt;
    if (active.lookUpTime >= LOOK_UP_SECONDS) {
      resolveActive(
        world,
        state,
        active,
        'lift_arachna_avoided',
        'looked_up',
        'Вы засекли движение над кабиной. Арахна не рискнула падать на того, кто смотрит вверх.',
        '#8cf',
      );
      return;
    }
  } else {
    active.lookUpTime = Math.max(0, active.lookUpTime - dt * 0.5);
  }

  if (state.time >= active.dropAt) spawnLiftArachna(world, entities, player, state, nextId, active);
}

export function getLiftArachnaWarningSnapshot(state: GameState): LiftArachnaWarningSnapshot | null {
  const active = ensureLiftArachnaState(state).active;
  if (!active || active.sprung || active.floor !== state.currentFloor) return null;
  return {
    secondsLeft: Math.max(0, Math.ceil(active.dropAt - state.time)),
    zoneId: active.zoneId,
    secondWarning: active.secondWarning,
    baited: active.baited,
  };
}
