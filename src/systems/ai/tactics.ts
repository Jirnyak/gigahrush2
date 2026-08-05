/* ── Generic actor tactic runner ──────────────────────────────── */

import {
  AIGoal,
  Cell,
  EntityType,
  Feature,
  Faction,
  MonsterKind,
  msg,
  type Entity,
  type GameState,
  type Msg,
} from '../../core/types';
import type { World } from '../../core/world';
import { MONSTERS, entityDisplayName } from '../../entities/monster';
import { getRecentCombatThreat, type CombatThreat } from '../combat_stimulus';
import { entityInActiveCellHazard, registerCellHazardSite } from '../cell_hazards';
import { ENTITY_MASK_ACTOR, getEntityIndex } from '../entity_index';
import { publishEvent } from '../events';
import { isHostile } from '../factions';
import { findLocalWetAnchor, wetTerrainCell } from '../monster_terrain';
import { isPlayerEntity } from '../player_actor';
import { MarkType, stampMark } from '../surface_marks';
import { followPath, tryAssignPathToCell } from './pathfinding';

type TacticResult = 'none' | 'passive' | 'handled';

interface ActorTacticContext {
  world: World;
  actor: Entity;
  dt: number;
  time: number;
  msgs: Msg[];
  state?: GameState;
  player?: Entity;
  profile: ActorTacticProfile;
}

interface ActorTacticFacts {
  target?: Entity;
  recentThreat?: CombatThreat;
  targetDist2: number;
  nearbyActors: number;
  nearbyHostiles: number;
  targetNearbyActors: number;
  threatX: number;
  threatY: number;
  wet: boolean;
  dryLit: boolean;
  wetAnchorX?: number;
  wetAnchorY?: number;
  flags: number;
}

interface ActorTactic {
  id: string;
  priority: number;
  run(ctx: ActorTacticContext, facts: ActorTacticFacts): TacticResult;
}

interface RefreshFactsAccumulator {
  nearbyActors: number;
  nearbyHostiles: number;
  bestTarget?: Entity;
  bestDist2: number;
  sawPlayer: boolean;
  sx: number;
  sy: number;
}

export interface ActorTacticProfile {
  id: string;
  monsterKind?: MonsterKind;
  matches?: (actor: Entity) => boolean;
  senseRadius: number;
  senseIntervalSeconds: number;
  senseJitterSeconds: number;
  scanCap: number;
  targetNeighborRadius?: number;
  targetNeighborCap?: number;
  tactics: readonly ActorTactic[];
}

const TACTIC_FLAG_WET = 1 << 0;
const TACTIC_FLAG_DRY_LIT = 1 << 1;
const TACTIC_FLAG_RECENT_THREAT = 1 << 2;
const TACTIC_FLAG_CROWD = 1 << 3;
const TACTIC_FLAG_ISOLATED_TARGET = 1 << 4;
const TACTIC_FLAG_WET_ANCHOR = 1 << 5;

const SLIME_WOMAN_RESIDUE_COOLDOWN_SEC = 2.4;
const SLIME_WOMAN_RESIDUE_DURATION_SEC = 18;
const SLIME_WOMAN_DRY_EVENT_COOLDOWN_SEC = 7;
const SLIME_WOMAN_HAZARD_TAGS = ['slime', 'toxic', 'black_slime', 'green_slime', 'slime_woman'] as const;
const SLIME_WOMAN_CROWD_HOSTILES = 4;
const SLIME_WOMAN_LOW_HP_CROWD_HOSTILES = 3;
const SLIME_WOMAN_FLEE_SECONDS = 2.7;
const SLIME_WOMAN_RETREAT_SECONDS = 2.2;
const SLIME_WOMAN_AMBUSH_SECONDS = 1.4;
const SLIME_WOMAN_GRAB_RESIDUE_SQ = 2.15 * 2.15;

const actorSenseScratch: Entity[] = [];
const targetNeighborScratch: Entity[] = [];
const monsterProfiles = new Map<MonsterKind, ActorTacticProfile>();
const genericProfiles: ActorTacticProfile[] = [];
const refreshAccum: RefreshFactsAccumulator = {
  nearbyActors: 0,
  nearbyHostiles: 0,
  bestDist2: Infinity,
  sawPlayer: false,
  sx: 0,
  sy: 0,
};

const WET_ANCHOR_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [2, 0], [-2, 0], [0, 2], [0, -2],
  [2, 1], [2, -1], [-2, 1], [-2, -1],
  [1, 2], [-1, 2], [1, -2], [-1, -2],
  [3, 0], [-3, 0], [0, 3], [0, -3],
  [4, 0], [-4, 0], [0, 4], [0, -4],
  [4, 2], [4, -2], [-4, 2], [-4, -2],
  [2, 4], [-2, 4], [2, -4], [-2, -4],
  [6, 0], [-6, 0], [0, 6], [0, -6],
];

function hashUnit(a: number, salt: number): number {
  let x = (a ^ salt) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return ((x ^ (x >>> 16)) >>> 0) / 0xffffffff;
}

function profileForActor(actor: Entity): ActorTacticProfile | undefined {
  if (actor.type === EntityType.MONSTER && actor.monsterKind !== undefined) {
    const monsterProfile = monsterProfiles.get(actor.monsterKind);
    if (monsterProfile) return monsterProfile;
  }
  if (genericProfiles.length === 0) return undefined;
  for (const profile of genericProfiles) {
    if (profile.matches?.(actor)) return profile;
  }
  return undefined;
}

export function actorHasTacticProfile(actor: Entity): boolean {
  return profileForActor(actor) !== undefined;
}

export function registerActorTacticProfile(profile: ActorTacticProfile): void {
  const normalized: ActorTacticProfile = {
    ...profile,
    tactics: [...profile.tactics].sort((a, b) => b.priority - a.priority),
  };
  if (normalized.monsterKind !== undefined) {
    monsterProfiles.set(normalized.monsterKind, normalized);
    return;
  }
  genericProfiles.push(normalized);
}

function zoneIdAt(world: World, x: number, y: number): number {
  return world.zoneMap[world.idx(Math.floor(x), Math.floor(y))];
}

function roomIdAt(world: World, x: number, y: number): number | undefined {
  const roomId = world.roomMap[world.idx(Math.floor(x), Math.floor(y))];
  return roomId >= 0 ? roomId : undefined;
}

function actorName(actor: Entity): string {
  if (actor.name) return actor.name;
  if (isPlayerEntity(actor)) return 'Вы';
  if (actor.type === EntityType.MONSTER) return entityDisplayName(actor);
  return 'NPC';
}

function walkableCell(world: World, x: number, y: number): boolean {
  const cell = world.cells[world.idx(x, y)];
  return cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR || cell === Cell.LIFT;
}

function nearFeature(world: World, actor: Entity, feature: Feature, radius: number): boolean {
  const cx = Math.floor(actor.x);
  const cy = Math.floor(actor.y);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (world.features[world.idx(cx + dx, cy + dy)] === feature) return true;
    }
  }
  return false;
}

function slimeWomanWetCell(world: World, actor: Entity): boolean {
  return wetTerrainCell(world, Math.floor(actor.x), Math.floor(actor.y)) ||
    entityInActiveCellHazard(world, actor, SLIME_WOMAN_HAZARD_TAGS);
}

function slimeWomanDryCounterCell(world: World, actor: Entity): boolean {
  if (slimeWomanWetCell(world, actor)) return false;
  const ci = world.idx(Math.floor(actor.x), Math.floor(actor.y));
  if (world.cells[ci] !== Cell.FLOOR) return false;
  return world.light[ci] >= 0.24 || nearFeature(world, actor, Feature.LAMP, 3);
}

function findWetAnchor(world: World, actor: Entity): { x: number; y: number } | undefined {
  return findLocalWetAnchor(world, actor, WET_ANCHOR_OFFSETS);
}

function setFactsCache(actor: Entity, facts: ActorTacticFacts): void {
  const ai = actor.ai;
  if (!ai) return;
  ai.tacticNearbyActors = facts.nearbyActors;
  ai.tacticNearbyHostiles = facts.nearbyHostiles;
  ai.tacticTargetId = facts.target?.id;
  ai.tacticTargetDist2 = Number.isFinite(facts.targetDist2) ? facts.targetDist2 : undefined;
  ai.tacticThreatX = facts.threatX;
  ai.tacticThreatY = facts.threatY;
  ai.tacticAnchorX = facts.wetAnchorX;
  ai.tacticAnchorY = facts.wetAnchorY;
  ai.tacticFlags = facts.flags;
}

function cachedFacts(world: World, actor: Entity, time: number, profile: ActorTacticProfile): ActorTacticFacts {
  const ai = actor.ai!;
  const recentThreat = getRecentCombatThreat(actor, time);
  const index = getEntityIndex();
  let target = ai.tacticTargetId !== undefined ? index.byId.get(ai.tacticTargetId) : undefined;
  if (!target?.alive) target = undefined;
  if (!target && recentThreat && isHostile(actor, recentThreat.attacker)) target = recentThreat.attacker;
  const wet = profile.id === 'slime_woman' ? slimeWomanWetCell(world, actor) : false;
  const dryLit = profile.id === 'slime_woman' ? slimeWomanDryCounterCell(world, actor) : false;
  const targetDist2 = target ? world.dist2(actor.x, actor.y, target.x, target.y) : (ai.tacticTargetDist2 ?? Infinity);
  const flags = ((ai.tacticFlags ?? 0) & (TACTIC_FLAG_CROWD | TACTIC_FLAG_ISOLATED_TARGET | TACTIC_FLAG_WET_ANCHOR)) |
    (wet ? TACTIC_FLAG_WET : 0) |
    (dryLit ? TACTIC_FLAG_DRY_LIT : 0) |
    (recentThreat ? TACTIC_FLAG_RECENT_THREAT : 0);
  return {
    target,
    recentThreat,
    targetDist2,
    nearbyActors: ai.tacticNearbyActors ?? 0,
    nearbyHostiles: ai.tacticNearbyHostiles ?? 0,
    targetNearbyActors: (flags & TACTIC_FLAG_ISOLATED_TARGET) !== 0 ? 0 : 2,
    threatX: ai.tacticThreatX ?? actor.x,
    threatY: ai.tacticThreatY ?? actor.y,
    wet,
    dryLit,
    wetAnchorX: ai.tacticAnchorX,
    wetAnchorY: ai.tacticAnchorY,
    flags,
  };
}

function resetRefreshAccum(): RefreshFactsAccumulator {
  refreshAccum.nearbyActors = 0;
  refreshAccum.nearbyHostiles = 0;
  refreshAccum.bestTarget = undefined;
  refreshAccum.bestDist2 = Infinity;
  refreshAccum.sawPlayer = false;
  refreshAccum.sx = 0;
  refreshAccum.sy = 0;
  return refreshAccum;
}

function considerActorForFacts(
  world: World,
  actor: Entity,
  other: Entity,
  player: Entity | undefined,
  profile: ActorTacticProfile,
  acc: RefreshFactsAccumulator,
): void {
  if (!other.alive || other.id === actor.id || other.type !== EntityType.NPC && other.type !== EntityType.MONSTER) return;
  const d2 = world.dist2(actor.x, actor.y, other.x, other.y);
  if (d2 > profile.senseRadius * profile.senseRadius) return;
  if (player && other.id === player.id) acc.sawPlayer = true;
  acc.nearbyActors++;
  if (!isHostile(actor, other)) return;
  acc.nearbyHostiles++;
  acc.sx += actor.x + world.delta(actor.x, other.x);
  acc.sy += actor.y + world.delta(actor.y, other.y);
  if (d2 < acc.bestDist2) {
    acc.bestDist2 = d2;
    acc.bestTarget = other;
  }
}

function refreshFacts(world: World, actor: Entity, time: number, player: Entity | undefined, profile: ActorTacticProfile): ActorTacticFacts {
  const index = getEntityIndex();
  index.queryRadiusCapped(actor.x, actor.y, profile.senseRadius, actorSenseScratch, ENTITY_MASK_ACTOR, profile.scanCap);

  const acc = resetRefreshAccum();
  for (const other of actorSenseScratch) considerActorForFacts(world, actor, other, player, profile, acc);
  if (player?.alive && !acc.sawPlayer) considerActorForFacts(world, actor, player, player, profile, acc);

  const recentThreat = getRecentCombatThreat(actor, time);
  if (recentThreat && isHostile(actor, recentThreat.attacker)) {
    acc.bestTarget = recentThreat.attacker;
    acc.bestDist2 = world.dist2(actor.x, actor.y, acc.bestTarget.x, acc.bestTarget.y);
    if (acc.nearbyHostiles <= 0) {
      acc.sx = actor.x + world.delta(actor.x, recentThreat.lastKnownX);
      acc.sy = actor.y + world.delta(actor.y, recentThreat.lastKnownY);
    }
  }

  let targetNearbyActors = 0;
  if (acc.bestTarget && profile.targetNeighborRadius !== undefined && profile.targetNeighborRadius > 0) {
    const cap = profile.targetNeighborCap ?? 24;
    index.queryRadiusCapped(acc.bestTarget.x, acc.bestTarget.y, profile.targetNeighborRadius, targetNeighborScratch, ENTITY_MASK_ACTOR, cap);
    for (const other of targetNeighborScratch) {
      if (!other.alive || other.id === actor.id || other.id === acc.bestTarget.id) continue;
      if (other.type === EntityType.NPC || other.type === EntityType.MONSTER) targetNearbyActors++;
    }
  }

  const wet = profile.id === 'slime_woman' ? slimeWomanWetCell(world, actor) : false;
  const dryLit = profile.id === 'slime_woman' ? slimeWomanDryCounterCell(world, actor) : false;
  const wetAnchor = profile.id === 'slime_woman' ? findWetAnchor(world, actor) : undefined;
  let flags = 0;
  if (wet) flags |= TACTIC_FLAG_WET;
  if (dryLit) flags |= TACTIC_FLAG_DRY_LIT;
  if (recentThreat) flags |= TACTIC_FLAG_RECENT_THREAT;
  if (acc.nearbyHostiles >= SLIME_WOMAN_CROWD_HOSTILES) flags |= TACTIC_FLAG_CROWD;
  if (acc.bestTarget && targetNearbyActors <= 0) flags |= TACTIC_FLAG_ISOLATED_TARGET;
  if (wetAnchor) flags |= TACTIC_FLAG_WET_ANCHOR;

  const facts: ActorTacticFacts = {
    target: acc.bestTarget,
    recentThreat,
    targetDist2: acc.bestDist2,
    nearbyActors: acc.nearbyActors,
    nearbyHostiles: acc.nearbyHostiles,
    targetNearbyActors,
    threatX: acc.nearbyHostiles > 0 ? world.wrap(Math.floor(acc.sx / acc.nearbyHostiles)) + 0.5 : actor.x,
    threatY: acc.nearbyHostiles > 0 ? world.wrap(Math.floor(acc.sy / acc.nearbyHostiles)) + 0.5 : actor.y,
    wet,
    dryLit,
    wetAnchorX: wetAnchor ? wetAnchor.x + 0.5 : undefined,
    wetAnchorY: wetAnchor ? wetAnchor.y + 0.5 : undefined,
    flags,
  };
  setFactsCache(actor, facts);
  return facts;
}

function beginTactic(actor: Entity, tacticId: string, phase: string, seconds: number): void {
  const ai = actor.ai!;
  if (ai.tacticId !== tacticId || ai.tacticPhase !== phase || (ai.tacticTimer ?? 0) <= 0) {
    ai.path = [];
    ai.pi = 0;
    ai.timer = 0;
  }
  ai.tacticId = tacticId;
  ai.tacticPhase = phase;
  ai.tacticTimer = Math.max(ai.tacticTimer ?? 0, seconds);
}

function followTacticPath(world: World, actor: Entity, dt: number, speedMult = 1): void {
  if (speedMult === 1) {
    followPath(world, actor, dt);
    return;
  }
  const oldSpeed = actor.speed;
  actor.speed = oldSpeed * speedMult;
  followPath(world, actor, dt);
  actor.speed = oldSpeed;
}

function assignAndFollow(world: World, actor: Entity, tx: number, ty: number, dt: number, speedMult = 1): boolean {
  const ai = actor.ai!;
  ai.timer -= dt;
  const x = world.wrap(Math.floor(tx));
  const y = world.wrap(Math.floor(ty));
  if (ai.path.length === 0 || ai.pi >= ai.path.length || ai.timer <= 0 || ai.tx !== x || ai.ty !== y) {
    tryAssignPathToCell(world, actor, x, y);
    ai.timer = 0.45;
  }
  followTacticPath(world, actor, dt, speedMult);
  return true;
}

function tryFleeFromPoint(world: World, actor: Entity, fromX: number, fromY: number, dt: number): boolean {
  let dx = world.delta(fromX, actor.x);
  let dy = world.delta(fromY, actor.y);
  let d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.001) {
    const a = hashUnit(actor.id, 0x51a7) * Math.PI * 2;
    dx = Math.cos(a);
    dy = Math.sin(a);
    d = 1;
  }
  dx /= d;
  dy /= d;
  const px = -dy;
  const py = dx;
  const side = hashUnit(actor.id, 0x2e31) < 0.5 ? -1 : 1;
  const distances = [9, 7, 5, 3] as const;
  for (const distance of distances) {
    for (const bend of [0, 0.65 * side, -0.65 * side] as const) {
      const tx = Math.floor(actor.x + dx * distance + px * bend * distance);
      const ty = Math.floor(actor.y + dy * distance + py * bend * distance);
      const wx = world.wrap(tx);
      const wy = world.wrap(ty);
      if (!walkableCell(world, wx, wy)) continue;
      return assignAndFollow(world, actor, wx, wy, dt, 1.08);
    }
  }
  return false;
}

function slimeWomanResidueCells(world: World, actor: Entity, target: Entity | undefined): number[] {
  const cells: number[] = [];
  const push = (x: number, y: number): void => {
    const ci = world.idx(x, y);
    if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) return;
    if (!cells.includes(ci)) cells.push(ci);
  };
  const ax = Math.floor(actor.x);
  const ay = Math.floor(actor.y);
  push(ax, ay);
  if (target) push(Math.floor(target.x), Math.floor(target.y));
  push(ax + 1, ay);
  push(ax - 1, ay);
  push(ax, ay + 1);
  push(ax, ay - 1);
  return cells;
}

function dropSlimeWomanResidue(
  world: World,
  actor: Entity,
  target: Entity | undefined,
  time: number,
  state: GameState | undefined,
  reason: string,
): boolean {
  const cells = slimeWomanResidueCells(world, actor, target);
  if (cells.length === 0) return false;
  const x = Math.floor(actor.x);
  const y = Math.floor(actor.y);
  stampMark(world, x, y, 0.5, 0.5, 1.25, MarkType.DRIP, 70_500 + actor.id * 19 + Math.floor(time * 10), 18, 150, 98, 175);
  registerCellHazardSite(world, {
    id: `slime_woman_tactic_residue_${actor.id}_${Math.floor(time * 10)}`,
    kind: 'slime_woman_residue',
    displayName: 'Жижевая токсичная пленка',
    cells,
    tags: ['slime', 'toxic', 'slime_woman', 'green_slime'],
    sticky: false,
    cleanable: true,
    slowMult: 0.72,
    playerDamagePerSecond: 1.25,
    messageCooldownSeconds: 2.8,
    expiresAt: time + SLIME_WOMAN_RESIDUE_DURATION_SEC,
    roomId: roomIdAt(world, actor.x, actor.y),
    zoneId: zoneIdAt(world, actor.x, actor.y),
    centerX: actor.x,
    centerY: actor.y,
    warning: 'Жижевая пленка ест подошву. Чистящий комплект, огонь или сухой обход держат проход.',
    warningColor: '#4f8',
  });

  if (state && target) {
    publishEvent(state, {
      type: 'monster_sighted',
      time,
      zoneId: zoneIdAt(world, actor.x, actor.y),
      roomId: roomIdAt(world, actor.x, actor.y),
      x: actor.x,
      y: actor.y,
      actorId: actor.id,
      actorName: actorName(actor),
      actorFaction: actor.faction ?? Faction.WILD,
      targetId: target.id,
      targetName: actorName(target),
      targetFaction: target.faction,
      monsterKind: MonsterKind.SLIME_WOMAN,
      severity: 3,
      privacy: isPlayerEntity(target) ? 'local' : 'witnessed',
      tags: ['monster', 'slime_woman', 'slime', 'residue', reason],
      data: {
        residueCells: cells.length,
        residueSeconds: SLIME_WOMAN_RESIDUE_DURATION_SEC,
        counterplay: 'cleaning_kit_fire_or_dry_edge',
      },
    });
  }
  return true;
}

function publishSlimeWomanDried(ctx: ActorTacticContext): void {
  const ai = ctx.actor.ai!;
  if ((ai.tacticEventCd ?? 0) > 0) return;
  ai.tacticEventCd = SLIME_WOMAN_DRY_EVENT_COOLDOWN_SEC;
  ctx.msgs.push(msg('Жижевая женщина подсыхает на светлом сухом бетоне. Сейчас её можно держать темпом.', ctx.time, '#8cf'));
  if (!ctx.state) return;
  publishEvent(ctx.state, {
    type: 'slime_humanoid_dried',
    time: ctx.time,
    zoneId: zoneIdAt(ctx.world, ctx.actor.x, ctx.actor.y),
    roomId: roomIdAt(ctx.world, ctx.actor.x, ctx.actor.y),
    x: ctx.actor.x,
    y: ctx.actor.y,
    actorId: ctx.actor.id,
    actorName: actorName(ctx.actor),
    actorFaction: ctx.actor.faction ?? Faction.WILD,
    monsterKind: MonsterKind.SLIME_WOMAN,
    severity: 3,
    privacy: 'local',
    tags: ['monster', 'slime_woman', 'slime', 'dry', 'counterplay'],
    data: {
      reason: 'dry_lit_concrete',
      counterplay: MONSTERS[MonsterKind.SLIME_WOMAN]?.counterplay,
      rumorIds: ['ecology_slime_woman_dry_edge', 'lead_maint_slime_woman_sump'],
    },
  });
}

function slimePassiveCues(ctx: ActorTacticContext, facts: ActorTacticFacts): TacticResult {
  if (facts.dryLit) {
    ctx.actor.spriteScale = 0.88;
    publishSlimeWomanDried(ctx);
  } else if (facts.wet) {
    ctx.actor.spriteScale = Math.max(ctx.actor.spriteScale ?? 1, 1.06);
  } else if (ctx.actor.spriteScale !== undefined && (ctx.actor.spriteScale < 1 || ctx.actor.spriteScale > 1.04)) {
    ctx.actor.spriteScale = undefined;
  }
  return 'passive';
}

function slimeDropResidueOnStimulus(ctx: ActorTacticContext, facts: ActorTacticFacts): TacticResult {
  const ai = ctx.actor.ai!;
  const pressure = facts.recentThreat?.damagePressure ?? 0;
  const closeGrab = facts.target !== undefined &&
    facts.targetNearbyActors <= 0 &&
    facts.targetDist2 <= SLIME_WOMAN_GRAB_RESIDUE_SQ;
  if (pressure <= (ai.tacticPressure ?? 0) && !closeGrab) return 'none';
  if ((ai.tacticActionCd ?? 0) > 0) return 'none';
  const target = facts.recentThreat?.attacker ?? facts.target;
  if (!dropSlimeWomanResidue(ctx.world, ctx.actor, target, ctx.time, ctx.state, pressure > (ai.tacticPressure ?? 0) ? 'damaged' : 'ambush_grab')) return 'none';
  ai.tacticActionCd = SLIME_WOMAN_RESIDUE_COOLDOWN_SEC;
  ai.tacticPressure = Math.max(ai.tacticPressure ?? 0, pressure);
  return 'passive';
}

function slimeFleeCrowd(ctx: ActorTacticContext, facts: ActorTacticFacts): TacticResult {
  const hp = Math.max(0, ctx.actor.hp ?? 1);
  const maxHp = Math.max(1, ctx.actor.maxHp ?? (hp || 1));
  const lowHpCrowd = hp / maxHp < 0.45 && facts.nearbyHostiles >= SLIME_WOMAN_LOW_HP_CROWD_HOSTILES;
  if (facts.nearbyHostiles < SLIME_WOMAN_CROWD_HOSTILES && !lowHpCrowd && ctx.actor.ai?.tacticId !== 'slime_woman_flee_crowd') return 'none';
  beginTactic(ctx.actor, 'slime_woman_flee_crowd', 'flee', SLIME_WOMAN_FLEE_SECONDS);
  const ai = ctx.actor.ai!;
  ai.goal = AIGoal.FLEE;
  ai.combatTargetId = facts.target?.id;
  ai.tacticTimer = Math.max(0, (ai.tacticTimer ?? 0) - ctx.dt);
  if (ai.tacticTimer <= 0 && facts.nearbyHostiles < SLIME_WOMAN_LOW_HP_CROWD_HOSTILES) return 'none';
  return tryFleeFromPoint(ctx.world, ctx.actor, facts.threatX, facts.threatY, ctx.dt) ? 'handled' : 'none';
}

function slimeRetreatWet(ctx: ActorTacticContext, facts: ActorTacticFacts): TacticResult {
  if (!facts.dryLit && ctx.actor.ai?.tacticId !== 'slime_woman_retreat_wet') return 'none';
  if (facts.wetAnchorX === undefined || facts.wetAnchorY === undefined) return 'none';
  beginTactic(ctx.actor, 'slime_woman_retreat_wet', 'wet_retreat', SLIME_WOMAN_RETREAT_SECONDS);
  const ai = ctx.actor.ai!;
  ai.goal = AIGoal.FLEE;
  ai.combatTargetId = facts.target?.id;
  ai.tacticTimer = Math.max(0, (ai.tacticTimer ?? 0) - ctx.dt);
  return assignAndFollow(ctx.world, ctx.actor, facts.wetAnchorX, facts.wetAnchorY, ctx.dt, 1.12) ? 'handled' : 'none';
}

function slimeAmbushIsolated(ctx: ActorTacticContext, facts: ActorTacticFacts): TacticResult {
  if (!facts.target || facts.targetNearbyActors > 0 || facts.nearbyHostiles > 2 || facts.dryLit) return 'none';
  if (facts.targetDist2 <= SLIME_WOMAN_GRAB_RESIDUE_SQ) return 'passive';
  beginTactic(ctx.actor, 'slime_woman_ambush_isolated', facts.wet ? 'wet_ambush' : 'stalk', SLIME_WOMAN_AMBUSH_SECONDS);
  const ai = ctx.actor.ai!;
  ai.goal = AIGoal.HUNT;
  ai.combatTargetId = facts.target.id;
  ai.tacticTimer = Math.max(0, (ai.tacticTimer ?? 0) - ctx.dt);
  return assignAndFollow(ctx.world, ctx.actor, facts.target.x, facts.target.y, ctx.dt, facts.wet ? 1.18 : 0.96) ? 'handled' : 'none';
}

function clearFinishedTactic(actor: Entity, profile: ActorTacticProfile): void {
  const ai = actor.ai;
  if (!ai || (ai.tacticTimer ?? 0) > 0 || ai.tacticId === undefined) return;
  for (const tactic of profile.tactics) {
    if (tactic.id !== ai.tacticId) continue;
    ai.tacticId = undefined;
    ai.tacticPhase = undefined;
    return;
  }
}

export function runActorTactic(
  world: World,
  actor: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  player: Entity | undefined,
  state?: GameState,
): boolean {
  const profile = profileForActor(actor);
  const ai = actor.ai;
  if (!profile || !ai || !actor.alive) return false;

  ai.tacticCooldown = Math.max(0, (ai.tacticCooldown ?? 0) - dt);
  ai.tacticSenseCd = Math.max(0, (ai.tacticSenseCd ?? 0) - dt);
  ai.tacticActionCd = Math.max(0, (ai.tacticActionCd ?? 0) - dt);
  ai.tacticEventCd = Math.max(0, (ai.tacticEventCd ?? 0) - dt);

  const shouldRefresh = ai.tacticSenseCd <= 0;
  const facts = shouldRefresh ? refreshFacts(world, actor, time, player, profile) : cachedFacts(world, actor, time, profile);
  if (shouldRefresh) {
    ai.tacticSenseCd = profile.senseIntervalSeconds +
      hashUnit(actor.id + Math.floor(time * 4), 0x9e37) * profile.senseJitterSeconds;
  }

  const ctx: ActorTacticContext = { world, actor, dt, time, msgs, state, player, profile };
  let handled = false;
  for (const tactic of profile.tactics) {
    const result = tactic.run(ctx, facts);
    if (result === 'handled') {
      handled = true;
      break;
    }
  }
  if (!handled) clearFinishedTactic(actor, profile);
  if (!facts.recentThreat) ai.tacticPressure = 0;
  return handled;
}

registerActorTacticProfile({
  id: 'slime_woman',
  monsterKind: MonsterKind.SLIME_WOMAN,
  senseRadius: 14,
  senseIntervalSeconds: 0.28,
  senseJitterSeconds: 0.12,
  scanCap: 48,
  targetNeighborRadius: 3.4,
  targetNeighborCap: 24,
  tactics: [
    { id: 'slime_woman_passive_cues', priority: 110, run: slimePassiveCues },
    { id: 'slime_woman_drop_residue', priority: 100, run: slimeDropResidueOnStimulus },
    { id: 'slime_woman_flee_crowd', priority: 90, run: slimeFleeCrowd },
    { id: 'slime_woman_retreat_wet', priority: 70, run: slimeRetreatWet },
    { id: 'slime_woman_ambush_isolated', priority: 50, run: slimeAmbushIsolated },
  ],
});
