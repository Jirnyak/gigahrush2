/* ── NPC combat: faction fights + fleeing ─────────────────────── */

import {
  type Entity, type GameState, type Msg,
  EntityType, AIGoal, ProjType,
} from '../../core/types';
import { World } from '../../core/world';
import { WEAPON_STATS, type WeaponStats } from '../../data/catalog';
import {
  playAttack, playHostileEnergyShot, playHostileFlame, playHostileGunshot, playHostileNailgun,
  playHostilePsiCast, playHostileShotgun, playSoundAt,
} from '../audio';
import { applyDamageRelationPenalty, isHostile } from '../factions';
import { calculateDamage, applyHitStaggerAndKnockback } from '../combat';
import { clearFogInZone } from '../samosbor';
import { agiAttackSpeedMult, meleeDamage } from '../rpg';
import { zhelemishIncomingMeleeDamage } from '../status';
import { spawnBloodHit, spawnDeathPool } from '../blood_fx';
import { consumeDurability, getWeaponStats, removeItem, addItem } from '../inventory';
import { ITEMS } from '../../data/items';
import { isDebugOnePunchManEnabled, keepDebugOnePunchManAlive } from '../debug_cheats';
import { entityDisplayName } from '../../entities/monster';
import { followPath, tryAssignPathToCell } from './pathfinding';
import { Spr, hostileProjectileSprite } from '../../render/sprite_index';
import { findCombatTarget, dropNpcInventory, deterministicScanCd, hasClearLineOfFire } from './monster';
import { recordEntityKill } from '../alife_rating';
import { recordPlayerDamage } from '../damage';
import { ENTITY_MASK_MONSTER, ENTITY_MASK_ACTOR, getEntityIndex } from '../entity_index';
import { applyMonsterIncomingDamage } from '../monster_traits';
import { publishWeaponNoise } from '../noise';
import { getCurrentPlayerEntity, isPlayerEntity } from '../player_actor';
import { getRecentCombatThreat, notifyActorDamaged, npcCombatProfile } from '../combat_stimulus';
import { canActorOccupy, entityIgnoresFineBlockers } from '../movement_collision';
import {
  emitMarkovBark,
  BARK_CHANCE_COMBAT,
  BARK_CHANCE_FLEE,
  BARK_CHANCE_KILL,
  BARK_CHANCE_WOUNDED,
  pushNpcLogMessage,
} from './barks';
import { selectMeleeTarget } from '../melee_targeting';

/* ── Module-level bark refs (set each frame) ─────────────────── */
let _barkMsgs: Msg[] = [];
let _barkTime = 0;
export function setCombatContext(msgs: Msg[], time: number): void {
  _barkMsgs = msgs;
  _barkTime = time;
}

/* ── NPC flee from monsters (non-combatants) ─────────────────── */
const NPC_FLEE_DETECT_SQ = 10 * 10;
const NPC_FLEE_SCAN_CD = 1.5;
const NPC_FLEE_MONSTER_SCAN_CAP = 32;
const fleeMonsterQuery: Entity[] = [];
const npcMeleeHitQuery: Entity[] = [];

export function trySimulateNpcAmmoRestock(e: Entity, dt: number): void {
  if (Math.random() > 0.02 * dt) return;

  const weaponId = e.weapon;
  if (!weaponId) return;

  const ws = getWeaponStats(e, weaponId);
  if (!ws || !ws.ammoType) return;

  const hasAmmo = e.inventory?.some(s => s.defId === ws.ammoType && s.count > 0);
  if (hasAmmo) return;

  const ammoDef = ITEMS[ws.ammoType];
  if (!ammoDef) return;

  const price = Math.max(1, ammoDef.value || 1);
  const count = Math.max(1, Math.floor(40 / price));
  addItem(e, ws.ammoType, count);
}

export function tryFleeFromMonster(
  world: World, _entities: Entity[], e: Entity, dt: number, time = _barkTime,
): boolean {
  const isCombatant = npcIsBrave(e);
  if (isCombatant) return false;

  const ws = getWeaponStats(e, npcCombatItemId(e));
  if (ws && (ws.dmg > 3 || ws.isRanged)) return false;

  const ai = e.ai!;

  if (ai.goal === AIGoal.FLEE && ai.timer > 0) {
    return continueFlee(world, e, dt);
  }
  const damageThreat = getRecentCombatThreat(e, time);
  if (damageThreat?.reaction === 'flee' && damageThreat.attacker.alive) {
    return startFleeFromThreat(world, e, damageThreat.attacker, dt);
  }

  ai.combatScanCd = (ai.combatScanCd ?? 0) - dt;
  if (ai.combatScanCd! > 0 && ai.goal !== AIGoal.FLEE) return false;
  ai.combatScanCd = NPC_FLEE_SCAN_CD;

  let nearestMonster: Entity | null = null;
  let nearestD2 = NPC_FLEE_DETECT_SQ;
  getEntityIndex().queryRadiusCapped(e.x, e.y, 10, fleeMonsterQuery, ENTITY_MASK_MONSTER, NPC_FLEE_MONSTER_SCAN_CAP);
  for (const other of fleeMonsterQuery) {
    if (!other.alive || other.type !== EntityType.MONSTER) continue;
    const d2 = world.dist2(e.x, e.y, other.x, other.y);
    if (d2 < nearestD2) {
      nearestD2 = d2;
      nearestMonster = other;
    }
  }

  if (!nearestMonster) {
    if (ai.goal === AIGoal.FLEE) {
      ai.goal = AIGoal.IDLE;
      ai.path = [];
      ai.pi = 0;
      ai.timer = 1;
    }
    return false;
  }

  return startFleeFromThreat(world, e, nearestMonster, dt);
}

/* ── NPC faction combat: attack nearby hostile entities ────────── */
const NPC_COMBAT_RANGE = 8;
const NPC_CHASE_RANGE = 18;
const NPC_ATTACK_RANGE = 1.3;
const NPC_COMBAT_CD = 1.2;
const NPC_RANGED_MAX = 12;
const NPC_RANGED_MIN = 1.5;
const NPC_RANGED_LOS_BREAK_CD = 0.45;
const MELEE_KNOCKBACK_CAP = 0.65;
const MELEE_STAGGER_CAP = 0.35;
const KNOCKBACK_BODY_R = 0.16;
const NPC_FLEE_THREAT_RATIO = 0.65;
const NPC_FLEE_ANGLE_OFFSETS = [0, 0.55, -0.55, 1.1, -1.1, 1.75, -1.75, Math.PI] as const;
const NPC_FLEE_DISTANCES = [20, 14, 8] as const;

interface NpcRangedProfile {
  minRange: number;
  maxRange: number;
}

interface FactionCombatOptions {
  visualProjectiles?: boolean;
  simple?: boolean;
}

function continueFlee(world: World, e: Entity, dt: number): boolean {
  const ai = e.ai!;
  if (ai.path.length === 0 || ai.pi >= ai.path.length) return false;
  ai.timer -= dt;
  const savedSpeed = e.speed;
  e.speed *= 1.3;
  followPath(world, e, dt);
  e.speed = savedSpeed;
  return ai.path.length > 0 && ai.timer > 0;
}

function startFleeFromThreat(world: World, e: Entity, threat: Entity, dt: number): boolean {
  const ai = e.ai!;
  emitMarkovBark(e, _barkMsgs, _barkTime, 'flee', 'Отходим!', BARK_CHANCE_FLEE, '#ff8');
  ai.goal = AIGoal.FLEE;
  const dx = world.delta(threat.x, e.x);
  const dy = world.delta(threat.y, e.y);
  const len = Math.sqrt(dx * dx + dy * dy);
  let nx: number, ny: number;
  if (len > 0.1) {
    nx = dx / len; ny = dy / len;
  } else {
    const a = Math.random() * Math.PI * 2;
    nx = Math.cos(a); ny = Math.sin(a);
  }
  const baseAngle = Math.atan2(ny, nx);
  for (const dist of NPC_FLEE_DISTANCES) {
    for (const offset of NPC_FLEE_ANGLE_OFFSETS) {
      const a = baseAngle + offset;
      const fleeX = world.wrap(Math.floor(e.x + Math.cos(a) * dist));
      const fleeY = world.wrap(Math.floor(e.y + Math.sin(a) * dist));
      if (world.solid(fleeX, fleeY)) continue;
      if (tryAssignPathToCell(world, e, fleeX, fleeY) !== 'assigned') continue;
      ai.timer = 2.4 + dist * 0.05;
      return continueFlee(world, e, dt);
    }
  }

  const step = Math.max(0.25, Math.min(0.9, e.speed * 1.5 * dt));
  const sx = world.wrap(e.x + nx * step);
  const sy = world.wrap(e.y + ny * step);
  let moved = false;
  const ignoreFineBlockers = entityIgnoresFineBlockers(e);
  if (canActorOccupy(world, sx, e.y, KNOCKBACK_BODY_R, { ignoreFineBlockers })) e.x = sx;
  if (e.x === sx) moved = true;
  if (canActorOccupy(world, e.x, sy, KNOCKBACK_BODY_R, { ignoreFineBlockers })) {
    e.y = sy;
    moved = true;
  }
  ai.path = [];
  ai.pi = 0;
  ai.timer = 0;
  return moved;
}

function npcIsBrave(e: Entity): boolean {
  return npcCombatProfile(e).brave;
}

function npcCombatItemScore(e: Entity, itemId: string | undefined): number {
  const id = itemId ?? '';
  if (!id) return 0;
  const ws = getWeaponStats(e, id);
  if (!ws) return 0;
  if (ws.psiCost && (!e.rpg || e.rpg.psi < ws.psiCost)) return 0;
  if (ws.isRanged && ws.ammoType && e.inventory?.some(slot => slot.defId === ws.ammoType && slot.count > 0) !== true) return 0;
  return ws.isRanged ? ws.dmg * (ws.pellets ?? 1) * 1.6 + (ws.aoeRadius ? 30 : 0) : ws.dmg;
}

function npcCombatItemId(e: Entity): string {
  const weaponId = e.weapon ?? '';
  const toolId = e.tool ?? '';
  const toolWs = getWeaponStats(e, toolId);
  const toolScore = toolWs?.psiCost ? npcCombatItemScore(e, toolId) : 0;
  const weaponScore = npcCombatItemScore(e, weaponId);
  return toolScore > weaponScore ? toolId : weaponId;
}

function npcThreatScore(e: Entity): number {
  const ws = getWeaponStats(e, npcCombatItemId(e));
  const weapon = ws.isRanged ? ws.dmg * (ws.pellets ?? 1) * 1.6 : ws.dmg;
  const hp = Math.max(0, e.hp ?? 20) * 0.22;
  const level = Math.max(1, e.rpg?.level ?? 1) * 3;
  return hp + weapon + level;
}

function npcShouldFleeTarget(e: Entity, target: Entity): boolean {
  if (npcIsBrave(e)) return false;
  return npcThreatScore(e) < npcThreatScore(target) * NPC_FLEE_THREAT_RATIO;
}

function livePlayerTarget(entities: readonly Entity[]): Entity | undefined {
  return getCurrentPlayerEntity(entities);
}

export function tryFactionCombat(
  world: World, entities: Entity[], e: Entity, dt: number, _time: number, msgs: Msg[], nextId: { v: number }, state?: GameState, player?: Entity | null, options?: FactionCombatOptions,
): boolean {
  const weaponId = npcCombatItemId(e);
  const ws = getWeaponStats(e, weaponId);
  const rangedProfile = ws.isRanged ? npcRangedProfile(ws) : undefined;
  const isArmed = ws.dmg > 3 || ws.isRanged;
  const visualProjectiles = options?.visualProjectiles ?? true;
  const simple = options?.simple === true;

  const isCombatant = npcIsBrave(e) ||
    isArmed;
  const playerTarget = player === null
    ? undefined
    : player?.alive && isPlayerEntity(player)
      ? player
      : livePlayerTarget(entities);
  const hostileToPlayer = playerTarget !== undefined && isHostile(e, playerTarget);
  const ai = e.ai!;
  if (ai.goal === AIGoal.FLEE && ai.timer > 0) return continueFlee(world, e, dt);
  const damageThreat = getRecentCombatThreat(e, _time);
  const forcedTarget = damageThreat?.reaction !== 'startled' ? damageThreat?.attacker : undefined;
  if (!isCombatant && !hostileToPlayer && !forcedTarget) return false;

  const detectRange = forcedTarget ? Math.max(NPC_CHASE_RANGE, rangedProfile?.maxRange ?? NPC_COMBAT_RANGE)
    : hostileToPlayer ? NPC_CHASE_RANGE : rangedProfile ? rangedProfile.maxRange : NPC_COMBAT_RANGE;
  if ((ai.staggerTimer ?? 0) > 0) {
    ai.staggerTimer = Math.max(0, (ai.staggerTimer ?? 0) - dt);
    e.attackCd = Math.max(e.attackCd ?? 0, 0.12);
    return true;
  }
  const prevTarget = ai.combatTargetId;
  const target = forcedTarget?.alive
    ? forcedTarget
    : findCombatTarget(
      world, entities, e, dt,
      detectRange * detectRange, deterministicScanCd(e.id, 0.8, 0.4),
      o => o.type === EntityType.NPC || o.type === EntityType.MONSTER || isPlayerEntity(o),
    );

  if (!target) {
    if (ai.combatTargetId !== undefined) {
      ai.combatTargetId = undefined;
      ai.goal = AIGoal.WANDER;
      ai.timer = 5;
      ai.combatScanCd = 5; // Suppress combat scanning briefly while searching
    }
    return false;
  }
  if (damageThreat?.reaction === 'flee' || (damageThreat?.reaction !== 'fight' && npcShouldFleeTarget(e, target))) {
    ai.combatTargetId = target.id;
    return startFleeFromThreat(world, e, target, dt);
  }
  if (ai.combatTargetId !== target.id || prevTarget === undefined) {
    emitMarkovBark(e, msgs, _time, 'combat', 'В бой!', BARK_CHANCE_COMBAT, '#fa8');
  }
  ai.combatTargetId = target.id;
  ai.goal = AIGoal.HUNT;

  const bestDist = Math.sqrt(world.dist2(e.x, e.y, target.x, target.y));
  const atkSpeedMod = e.rpg ? agiAttackSpeedMult(e.rpg) : 1;

  // Reload logic for NPC
  if (e.reloading) {
    e.reloadTimer = Math.max(0, (e.reloadTimer ?? 0) - dt);
    if (e.reloadTimer <= 0) {
      e.currentMag = ws.magazineSize ?? 1;
      e.reloading = false;
    }
    return true; // Block actions while reloading
  }
  if (!ws.psiCost && (e.currentMag ?? 0) <= 0 && ws.magazineSize !== Infinity) {
    e.reloading = true;
    e.reloadTimer = (ws.reloadTime ?? 1) / (e.rpg ? (1 + e.rpg.agi * 0.05) : 1);
    return true;
  }
  if (
    simple &&
    ws.isRanged &&
    rangedProfile &&
    bestDist < rangedProfile.maxRange &&
    bestDist > rangedProfile.minRange &&
    hasClearLineOfFire(world, e, target, rangedProfile.maxRange)
  ) {
    e.attackCd = (e.attackCd ?? 0) - dt;
    if (e.attackCd! <= 0) {
      if (npcCommitRangedShot(world, e, target, weaponId, ws, entities, nextId, atkSpeedMod, true, _time, state)) return true;
      npcAutoEquipBestWeapon(e);
      e.attackCd = Math.max(e.attackCd ?? 0, 0.35);
    }
    return true;
  }

  // Ranged NPC: telegraph line-of-fire before committing the shot.
  if (ws.isRanged && rangedProfile && bestDist < rangedProfile.maxRange && bestDist > rangedProfile.minRange) {
    const currentTarget = ai.windupTargetId === undefined || ai.windupTargetId === target.id;
    const lineClear = currentTarget && target.alive && hasClearLineOfFire(world, e, target, rangedProfile.maxRange);

    if ((ai.windupTimer ?? 0) > 0) {
      ai.windupTimer = Math.max(0, (ai.windupTimer ?? 0) - dt);
      const dx = world.delta(e.x, target.x);
      const dy = world.delta(e.y, target.y);
      e.angle = Math.atan2(dy, dx);
      if (!lineClear) {
        ai.windupTimer = undefined;
        ai.windupTargetId = undefined;
        e.attackCd = Math.max(e.attackCd ?? 0, NPC_RANGED_LOS_BREAK_CD);
        if (isPlayerEntity(target)) {
          pushNpcLogMessage(e, msgs, _time, `${entityDisplayName(e)} потерял линию огня. Укрытие сработало.`, '#9cf');
        }

        // If we lose line of sight, try to find a cover position or slightly adjust angle instead of just walking into them
        // We can't do full navigation easily here, so we will assign a path, but the existing pathfinding handles doors/corridors
        if (ai.path.length === 0 || ai.timer <= 0) {
          tryAssignPathToCell(world, e, target.x, target.y);
          ai.timer = 2;
        }
        followPath(world, e, dt);

        return true;
      }

      if (ai.windupTimer <= 0) {
        if (npcCommitRangedShot(world, e, target, weaponId, ws, entities, nextId, atkSpeedMod, visualProjectiles, _time, state)) return true;
        npcAutoEquipBestWeapon(e);
        e.attackCd = Math.max(e.attackCd ?? 0, 0.35);
      }
      return true;
    }

    if (lineClear) {
      e.attackCd = (e.attackCd ?? 0) - dt;
      if (e.attackCd! <= 0) {
        if (npcCanStartRangedWindup(e, ws)) {
          ai.windupTimer = npcRangedWindupSec(ws);
          ai.windupTargetId = target.id;
          if (isPlayerEntity(target) && npcRangedShouldLog(ws)) {
            pushNpcLogMessage(e, msgs, _time, `${entityDisplayName(e)} целится: ${npcRangedThreatLabel(ws)}. Сбейте линию или дождитесь залпа.`, npcRangedCueColor(ws));
          }
          return true;
        }
        npcAutoEquipBestWeapon(e);
      } else {
        return true;
      }
    }
  }

  // Move toward target if too far for melee
  const meleeWs = ws;
  const meleeRange = meleeWs.range || NPC_ATTACK_RANGE;
  const effectiveReach = meleeRange + (meleeWs.hitRadius ?? 0.6);
  if (bestDist > effectiveReach) {
    if (ai.path.length === 0 || ai.timer <= 0) {
      tryAssignPathToCell(world, e, target.x, target.y);
      ai.timer = 2;
    }
    followPath(world, e, dt);
    return true;
  }

  // Melee attack
  e.attackCd = (e.attackCd ?? 0) - dt;
  if (e.attackCd! <= 0) {
    const dx = world.delta(e.x, target.x);
    const dy = world.delta(e.y, target.y);
    e.angle = Math.atan2(dy, dx); // ensure we face target before swinging
    
    getEntityIndex().queryRadius(e.x, e.y, effectiveReach, npcMeleeHitQuery, ENTITY_MASK_ACTOR);
    const hitTarget = selectMeleeTarget(world, e, npcMeleeHitQuery, meleeRange, weaponId);
    
    if (hitTarget) {
      const baseDmg = meleeWs.dmg > 0 ? meleeWs.dmg : (5 + Math.floor(Math.random() * 8));
      const rawDmg = meleeDamage(e.rpg, weaponId, baseDmg);
      let dmg = zhelemishIncomingMeleeDamage(hitTarget, _time, rawDmg);
      if (hitTarget.type === EntityType.MONSTER) dmg = applyMonsterIncomingDamage(world, hitTarget, dmg);
      if (hitTarget.hp !== undefined) {
        const debugImmortalPlayerHit = isPlayerEntity(hitTarget) && isDebugOnePunchManEnabled();
        if (debugImmortalPlayerHit) {
          keepDebugOnePunchManAlive(hitTarget);
        } else {
          const actualDmg = calculateDamage(dmg, ws.damageType, hitTarget);
          hitTarget.hp -= actualDmg;
          applyHitStaggerAndKnockback(hitTarget, e.x, e.y, actualDmg);
          notifyActorDamaged(world, hitTarget, e, dmg, 'npc_melee', _time, state);
          if (isPlayerEntity(hitTarget)) recordPlayerDamage(state, e, dmg, `${entityDisplayName(e)} задел тебя: -${dmg}`);
          if (hitTarget.type === EntityType.NPC) {
            applyDamageRelationPenalty(e.faction, hitTarget.faction, dmg, hitTarget, e, state);
            if (hitTarget.hp > 0 && hitTarget.hp < (hitTarget.maxHp ?? 100) * 0.5) {
              emitMarkovBark(hitTarget, msgs, _time, 'wounded', 'Задело!', BARK_CHANCE_WOUNDED, '#f88');
            }
          }
          const hitAng = Math.atan2(hitTarget.y - e.y, hitTarget.x - e.x);
          spawnBloodHit(world, hitTarget.x, hitTarget.y, hitAng, dmg, hitTarget.type === EntityType.MONSTER);
          applyMeleeKnockback(world, e, hitTarget, meleeWs);
          if (hitTarget.hp <= 0) {
            recordEntityKill(e, hitTarget);
            hitTarget.alive = false;
            spawnDeathPool(world, hitTarget.x, hitTarget.y, hitTarget.type === EntityType.MONSTER);
            if (hitTarget.type === EntityType.NPC) dropNpcInventory(hitTarget, entities, nextId);
            emitMarkovBark(e, msgs, _time, 'combat', 'Готов.', BARK_CHANCE_KILL, '#da4');
            if (hitTarget.isFogBoss && hitTarget.fogBossZone !== undefined) {
              clearFogInZone(world, hitTarget.fogBossZone, msgs, _time);
            }
          }
        }
      }
    }
    if (!meleeWs.isRanged && meleeWs.durability > 0) {
      consumeDurability(e, msgs, _time, state, weaponId);
      if (!e.weapon || (weaponId === e.tool && !e.tool)) npcAutoEquipBestWeapon(e);
    }
    playSoundAt(playAttack, e.x, e.y);
    publishWeaponNoise(state, e, weaponId, meleeWs);
    e.attackCd = (meleeWs.speed || NPC_COMBAT_CD) * atkSpeedMod;
  }
  return true;
}

function applyMeleeKnockback(world: World, source: Entity, target: Entity, ws: WeaponStats): void {
  const force = Math.min(MELEE_KNOCKBACK_CAP, Math.max(0, ws.knockback ?? 0));
  if (force <= 0) return;

  let dx = world.delta(source.x, target.x);
  let dy = world.delta(source.y, target.y);
  let len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) {
    dx = Math.cos(source.angle);
    dy = Math.sin(source.angle);
    len = 1;
  }

  const nx = world.wrap(target.x + dx / len * force);
  const targetIgnoreFineBlockers = entityIgnoresFineBlockers(target);
  if (canActorOccupy(world, nx, target.y, KNOCKBACK_BODY_R, { ignoreFineBlockers: targetIgnoreFineBlockers })) target.x = nx;
  const ny = world.wrap(target.y + dy / len * force);
  if (canActorOccupy(world, target.x, ny, KNOCKBACK_BODY_R, { ignoreFineBlockers: targetIgnoreFineBlockers })) target.y = ny;

  const stagger = Math.min(MELEE_STAGGER_CAP, 0.08 + force * 0.35);
  if (target.ai) target.ai.staggerTimer = Math.max(target.ai.staggerTimer ?? 0, stagger);
  if (!isPlayerEntity(target)) target.attackCd = Math.max(target.attackCd ?? 0, stagger);
}

function npcRangedProfile(ws: WeaponStats): NpcRangedProfile {
  const pellets = ws.pellets ?? 1;
  const isShotgunLike = pellets > 1 || (ws.spread ?? 0) > 0.18;
  const isFlame = ws.projType === ProjType.FLAME;
  const isHeavy = ws.aoeRadius !== undefined || ws.projType === ProjType.BFG;
  const fastProjectile = (ws.projSpeed ?? 0) >= 20;
  const maxRange = isHeavy ? 11
    : fastProjectile ? 15
      : isShotgunLike || isFlame ? 9
        : NPC_RANGED_MAX;
  const minRange = isHeavy ? 4.2
    : isFlame ? 2.7
      : isShotgunLike ? 2.3
        : NPC_RANGED_MIN;
  return {
    minRange,
    maxRange,
  };
}

function npcRangedDamageScore(ws: WeaponStats): number {
  return ws.dmg * (ws.pellets ?? 1) + (ws.aoeRadius ? 45 : 0);
}

function npcRangedWindupSec(ws: WeaponStats): number {
  const score = npcRangedDamageScore(ws);
  if (ws.aoeRadius || score >= 70) return 0.62;
  if (ws.psiCost || score >= 35) return 0.42;
  if (ws.speed <= 0.2) return 0.06;
  return 0.22;
}

function npcRangedShouldLog(ws: WeaponStats): boolean {
  return ws.psiCost !== undefined || ws.aoeRadius !== undefined || npcRangedDamageScore(ws) >= 20 || ws.speed > 0.2;
}

function npcRangedThreatLabel(ws: WeaponStats): string {
  if (ws.psiCost) return 'ПСИ';
  if (ws.aoeRadius) return 'взрыв';
  if ((ws.pellets ?? 1) > 1) return 'дробь';
  if (ws.projType === ProjType.FLAME) return 'огонь';
  if (ws.projType === ProjType.BFG || (ws.projSprite === Spr.GAUSS_BOLT || ws.projSprite === Spr.PLASMA_BOLT)) return 'энергия';
  return 'выстрел';
}

function npcRangedCueColor(ws: WeaponStats): string {
  if (ws.psiCost) return '#c8f';
  if (ws.aoeRadius) return '#fa4';
  if (ws.projSprite === Spr.PLASMA_BOLT || ws.projSprite === Spr.GAUSS_BOLT) return '#6cf';
  return '#fc8';
}

function npcCanStartRangedWindup(e: Entity, ws: WeaponStats): boolean {
  if (ws.psiCost) return !!e.rpg && e.rpg.psi >= ws.psiCost;
  if (!ws.ammoType) return true;
  return e.inventory?.some(slot => slot.defId === ws.ammoType && slot.count > 0) === true;
}

function npcCommitRangedShot(
  world: World,
  e: Entity,
  target: Entity,
  weaponId: string,
  ws: WeaponStats,
  entities: Entity[],
  nextId: { v: number },
  atkSpeedMod: number,
  visualProjectiles: boolean,
  time: number,
  state?: GameState,
): boolean {
  if (ws.psiCost) {
    if (!e.rpg || e.rpg.psi < ws.psiCost) return false;
    e.rpg.psi -= ws.psiCost;
    if (visualProjectiles) {
      npcFireProjectile(world, e, target, weaponId, ws, entities, nextId);
      playSoundAt(playHostilePsiCast, e.x, e.y);
      publishWeaponNoise(state, e, weaponId, ws);
    } else {
      npcApplyDistantRangedDamage(world, e, target, ws, entities, nextId, time, state);
    }
    e.attackCd = ws.speed * atkSpeedMod;
    e.ai!.windupTimer = undefined;
    e.ai!.windupTargetId = undefined;
    return true;
  }
  if (ws.ammoType) {
    if (!removeItem(e, ws.ammoType, 1)) return false;
  }
  if (ws.magazineSize !== Infinity) {
    e.currentMag = Math.max(0, (e.currentMag ?? 0) - 1);
  }
  if (visualProjectiles) {
    npcFireProjectile(world, e, target, weaponId, ws, entities, nextId);
    playSoundAt(hostileWeaponSound(weaponId), e.x, e.y);
    publishWeaponNoise(state, e, weaponId, ws);
  } else {
    npcApplyDistantRangedDamage(world, e, target, ws, entities, nextId, time, state);
  }
  e.attackCd = ws.speed * atkSpeedMod;
  e.ai!.windupTimer = undefined;
  e.ai!.windupTargetId = undefined;
  return true;
}

function hostileWeaponSound(weaponId: string): () => void {
  switch (weaponId) {
    case 'shotgun':
    case 'toz_shotgun':
      return playHostileShotgun;
    case 'nailgun':
    case 'harpoon_gun':
      return playHostileNailgun;
    case 'flamethrower':
      return playHostileFlame;
    case 'gauss':
    case 'plasma':
    case 'bfg':
      return playHostileEnergyShot;
    default:
      return playHostileGunshot;
  }
}

function npcApplyDistantRangedDamage(
  world: World,
  e: Entity,
  target: Entity,
  ws: WeaponStats,
  entities: Entity[],
  nextId: { v: number },
  time: number,
  state?: GameState,
): void {
  if (target.hp === undefined || !target.alive) return;
  const pelletFactor = Math.max(1, ws.pellets ?? 1);
  let dmg = Math.max(1, Math.round(ws.dmg * pelletFactor));
  if (target.type === EntityType.MONSTER) dmg = applyMonsterIncomingDamage(world, target, dmg);
  const actualDmg = calculateDamage(dmg, ws.damageType, target);
  target.hp -= actualDmg;
  applyHitStaggerAndKnockback(target, e.x, e.y, actualDmg);
  notifyActorDamaged(world, target, e, dmg, 'npc_ranged', time, state);
  if (isPlayerEntity(target)) recordPlayerDamage(state, e, dmg, `${entityDisplayName(e)} попал: -${dmg}`);
  if (target.type === EntityType.NPC) applyDamageRelationPenalty(e.faction, target.faction, dmg, target, e, state);
  if (target.hp > 0) return;

  recordEntityKill(e, target);
  target.alive = false;
  target.hp = 0;
  if (target.type === EntityType.NPC) dropNpcInventory(target, entities, nextId);
  if (target.isFogBoss && target.fogBossZone !== undefined) clearFogInZone(world, target.fogBossZone, _barkMsgs, time);
}

/* ── NPC: fire ranged projectile ──────────────────────────────── */
function npcFireProjectile(
  world: World, e: Entity, target: Entity, weaponId: string, ws: typeof WEAPON_STATS[string],
  entities: Entity[], nextId: { v: number },
): void {
  const dx = world.delta(e.x, target.x);
  const dy = world.delta(e.y, target.y);
  const ang = Math.atan2(dy, dx);
  const pellets = ws.pellets ?? 1;
  const spread = ws.spread ?? 0;
  const spd = ws.projSpeed ?? 15;
  for (let p = 0; p < pellets; p++) {
    const a = ang + (Math.random() - 0.5) * spread;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const proj: Entity = {
      id: nextId.v++,
      type: EntityType.PROJECTILE,
      x: world.wrap(e.x + Math.cos(ang) * 0.85),
      y: world.wrap(e.y + Math.sin(ang) * 0.85),
      angle: a,
      pitch: 0,
      alive: true,
      speed: 0,
      sprite: hostileProjectileSprite(ws.projSprite ?? Spr.BULLET),
      vx: cos * spd,
      vy: sin * spd,
      projDmg: ws.dmg,
      projLife: ws.projType === ProjType.FLAME ? 0.7 : 3.0,
      ownerId: e.id,
      weapon: weaponId,
      spriteScale: ws.projType === ProjType.FLAME ? 0.55 : 0.25,
      spriteZ: 0.5,
      projType: ws.projType,
    };
    if (ws.aoeRadius) {
      proj.aoeRadius = ws.aoeRadius;
      proj.aoeDmg = ws.dmg;
    }
    entities.push(proj);
  }
}

/* ── NPC: auto-equip best weapon from inventory ───────────────── */
function npcAutoEquipBestWeapon(e: Entity): void {
  if (!e.inventory) {
    e.weapon = '';
    if (getWeaponStats(e, e.tool ?? '')?.psiCost) e.tool = '';
    return;
  }
  let bestWeaponScore = 0;
  let bestWeaponId = '';
  let bestPsiScore = 0;
  let bestPsiId = '';
  for (const slot of e.inventory) {
    const w = getWeaponStats(e, slot.defId);
    if (!w) continue;
    if (w.isRanged && w.ammoType) {
      const hasAmmo = e.inventory.some(s => s.defId === w.ammoType && s.count > 0);
      if (!hasAmmo) continue;
    }
    if (w.psiCost && (!e.rpg || e.rpg.psi < w.psiCost)) continue;
    const effectiveDmg = w.isRanged ? w.dmg * (w.pellets ?? 1) * 2 : w.dmg;
    if (w.psiCost) {
      if (effectiveDmg > bestPsiScore) {
        bestPsiScore = effectiveDmg;
        bestPsiId = slot.defId;
      }
    } else if (effectiveDmg > bestWeaponScore) {
      bestWeaponScore = effectiveDmg;
      bestWeaponId = slot.defId;
    }
  }
  e.weapon = bestWeaponId;
  if (bestPsiId) e.tool = bestPsiId;
  else if (getWeaponStats(e, e.tool ?? '')?.psiCost) e.tool = '';
}
