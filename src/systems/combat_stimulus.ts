import {
  AIGoal,
  EntityType,
  Faction,
  type Entity,
  type GameState,
  type WorldEventSeverity,
} from '../core/types';
import type { World } from '../core/world';
import { WEAPON_STATS } from '../data/catalog';
import { occupationHasAnyProfileTag } from '../data/occupation_profiles';
import { entityDisplayName } from '../entities/monster';
import { getEntityIndex } from './entity_index';
import { publishEvent } from './events';
import { isHostile } from './factions';
import { isPlayerEntity } from './player_actor';

export type CombatStimulusSource =
  | 'player_melee'
  | 'npc_melee'
  | 'npc_ranged'
  | 'monster_melee'
  | 'monster_special'
  | 'projectile'
  | 'explosion';

export type CombatThreatReaction = 'fight' | 'flee' | 'startled';

export interface NpcCombatProfile {
  brave: boolean;
  armed: boolean;
  ranged: boolean;
  threatScore: number;
  hpRatio: number;
}

export interface CombatThreat {
  attacker: Entity;
  attackerId: number;
  lastKnownX: number;
  lastKnownY: number;
  damagePressure: number;
  reaction: CombatThreatReaction;
  source: CombatStimulusSource;
  expiresAt: number;
}

interface CombatThreatMemory {
  attackerId: number;
  lastKnownX: number;
  lastKnownY: number;
  damagePressure: number;
  reaction: CombatThreatReaction;
  source: CombatStimulusSource;
  expiresAt: number;
}

const COMBAT_THREAT_TTL = 5.0;
const COMBAT_THREAT_PRESSURE_CAP = 120;
const PLAYER_HURT_NPC_EVENT_COOLDOWN = 0.7;

let threatMemory = new WeakMap<Entity, CombatThreatMemory>();
const recentEventTimes = new Map<string, number>();
let killedEventTargets = new WeakSet<Entity>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function eventLocation(world: World, entity: Entity): { zoneId: number; roomId?: number } {
  const cell = world.idx(Math.floor(entity.x), Math.floor(entity.y));
  const room = world.roomMap[cell];
  return {
    zoneId: world.zoneMap[cell],
    roomId: room >= 0 ? room : undefined,
  };
}

function cleanSeverity(value: number): WorldEventSeverity {
  return clamp(Math.round(value), 0, 5) as WorldEventSeverity;
}

function displayName(e: Entity): string {
  if (e.name) return e.name;
  if (isPlayerEntity(e)) return 'Вы';
  if (e.type === EntityType.MONSTER) return entityDisplayName(e);
  return 'NPC';
}

function eventAllowed(key: string, time: number, cooldown: number): boolean {
  const prev = recentEventTimes.get(key) ?? -Infinity;
  if (time - prev < cooldown) return false;
  recentEventTimes.set(key, time);
  if (recentEventTimes.size > 256) {
    for (const oldKey of recentEventTimes.keys()) {
      recentEventTimes.delete(oldKey);
      if (recentEventTimes.size <= 192) break;
    }
  }
  return true;
}

export function npcCombatProfile(npc: Entity): NpcCombatProfile {
  const ws = WEAPON_STATS[npc.weapon ?? ''] ?? WEAPON_STATS[''];
  const brave = (npc.psiMadness ?? 0) > 0 ||
    occupationHasAnyProfileTag(npc.occupation, ['combat', 'patrol']) ||
    npc.faction === Faction.LIQUIDATOR ||
    npc.faction === Faction.CULTIST ||
    npc.faction === Faction.WILD;
  const ranged = ws.isRanged === true;
  const armed = ws.dmg > 3 || ranged;
  const hp = Math.max(0, npc.hp ?? 20);
  const maxHp = Math.max(1, npc.maxHp ?? (hp || 20));
  const weaponScore = ranged ? ws.dmg * (ws.pellets ?? 1) * 1.6 : ws.dmg;
  const levelScore = Math.max(1, npc.rpg?.level ?? 1) * 3;
  return {
    brave,
    armed,
    ranged,
    hpRatio: hp / maxHp,
    threatScore: hp * 0.22 + weaponScore + levelScore,
  };
}

function actorThreatScore(actor: Entity): number {
  if (actor.type === EntityType.MONSTER) {
    return Math.max(12, (actor.hp ?? 35) * 0.2 + Math.max(1, actor.rpg?.level ?? 1) * 5);
  }
  if (actor.type === EntityType.NPC) return npcCombatProfile(actor).threatScore;
  return 30;
}

function npcShouldFightThreat(npc: Entity, attacker: Entity): boolean {
  const profile = npcCombatProfile(npc);
  if (profile.hpRatio < 0.24 && !profile.brave) return false;
  if (profile.brave) return true;
  if (!profile.armed) return false;
  return profile.threatScore >= actorThreatScore(attacker) * 0.45;
}

function isCombatRelevantThreat(victim: Entity, attacker: Entity): boolean {
  if (victim.id === attacker.id || !attacker.alive) return false;
  if (victim.type === EntityType.MONSTER && attacker.type === EntityType.MONSTER) return false;
  if ((victim.psiMadness ?? 0) > 0) return true;
  if (isHostile(victim, attacker)) return true;
  return false;
}

function threatReaction(victim: Entity, attacker: Entity, _source: CombatStimulusSource, _damage: number): CombatThreatReaction {
  if (!isCombatRelevantThreat(victim, attacker)) return 'startled';
  if (victim.type === EntityType.NPC && !isPlayerEntity(victim)) {
    return npcShouldFightThreat(victim, attacker) ? 'fight' : 'flee';
  }
  return 'fight';
}

function setThreatMemory(
  victim: Entity,
  attacker: Entity,
  damage: number,
  source: CombatStimulusSource,
  time: number,
  reaction: CombatThreatReaction = threatReaction(victim, attacker, source, damage),
): void {
  const prev = threatMemory.get(victim);
  threatMemory.set(victim, {
    attackerId: attacker.id,
    lastKnownX: attacker.x,
    lastKnownY: attacker.y,
    damagePressure: clamp((prev?.damagePressure ?? 0) + Math.max(1, damage), 0, COMBAT_THREAT_PRESSURE_CAP),
    reaction,
    source,
    expiresAt: time + COMBAT_THREAT_TTL,
  });
}

function applyFightHint(victim: Entity, attacker: Entity): void {
  const ai = victim.ai;
  if (!ai || isPlayerEntity(victim)) return;
  ai.combatTargetId = attacker.id;
  ai.combatScanCd = 0;
  ai.goal = AIGoal.HUNT;
  ai.path = [];
  ai.pi = 0;
  ai.timer = 0;
}

function applyFleeHint(victim: Entity, attacker: Entity): void {
  const ai = victim.ai;
  if (!ai || isPlayerEntity(victim)) return;
  ai.combatTargetId = attacker.id;
  ai.combatScanCd = 0;
  ai.goal = AIGoal.FLEE;
  ai.path = [];
  ai.pi = 0;
  ai.timer = 0;
}

function applyVictimReaction(victim: Entity, attacker: Entity, reaction: CombatThreatReaction): void {
  if (!victim.ai || reaction === 'startled') return;
  if (reaction === 'flee') applyFleeHint(victim, attacker);
  else applyFightHint(victim, attacker);
}

function publishPlayerHurtNpcEvent(world: World, state: GameState | undefined, attacker: Entity, victim: Entity, damage: number, source: CombatStimulusSource, time: number): void {
  if (!state || !isPlayerEntity(attacker) || victim.type !== EntityType.NPC || isPlayerEntity(victim)) return;
  const key = `player_hurt_npc:${attacker.id}:${victim.id}`;
  if (!eventAllowed(key, time, PLAYER_HURT_NPC_EVENT_COOLDOWN) && damage < 18) return;
  const loc = eventLocation(world, victim);
  publishEvent(state, {
    type: 'player_hurt_npc',
    ...loc,
    x: victim.x,
    y: victim.y,
    actorId: attacker.id,
    actorName: displayName(attacker),
    actorFaction: attacker.faction,
    targetId: victim.id,
    targetName: displayName(victim),
    targetFaction: victim.faction,
    severity: cleanSeverity(damage >= 18 ? 4 : 3),
    privacy: 'local',
    tags: ['combat', 'damage', 'npc', source],
    data: { damage: Math.round(damage * 10) / 10, source },
  });
}

function publishActorKillEvent(world: World, state: GameState | undefined, killer: Entity, target: Entity, source: CombatStimulusSource): void {
  if (!state || killedEventTargets.has(target) || isPlayerEntity(killer)) return;
  if (target.type !== EntityType.NPC && target.type !== EntityType.MONSTER) return;
  killedEventTargets.add(target);
  const loc = eventLocation(world, target);
  if (killer.type === EntityType.NPC) {
    publishEvent(state, {
      type: target.type === EntityType.MONSTER ? 'npc_kill_monster' : 'npc_kill_npc',
      ...loc,
      x: target.x,
      y: target.y,
      actorId: killer.id,
      actorName: displayName(killer),
      actorFaction: killer.faction,
      targetId: target.id,
      targetName: displayName(target),
      targetFaction: target.faction,
      monsterKind: target.monsterKind,
      severity: cleanSeverity(target.type === EntityType.NPC ? 4 : 3),
      privacy: 'local',
      tags: target.type === EntityType.MONSTER ? ['combat', 'kill', 'monster'] : ['combat', 'kill', 'npc'],
      data: { source },
    });
    return;
  }
  if (killer.type === EntityType.MONSTER && target.type === EntityType.NPC) {
    publishEvent(state, {
      type: 'death_seen',
      ...loc,
      x: target.x,
      y: target.y,
      actorId: killer.id,
      actorName: displayName(killer),
      actorFaction: killer.faction,
      targetId: target.id,
      targetName: displayName(target),
      targetFaction: target.faction,
      monsterKind: killer.monsterKind,
      severity: 4,
      privacy: 'local',
      tags: ['combat', 'kill', 'npc', 'monster'],
      data: { source },
    });
  }
}

export function notifyActorDamaged(
  world: World,
  victim: Entity,
  attacker: Entity | undefined,
  damage: number,
  source: CombatStimulusSource,
  time: number,
  state?: GameState,
): void {
  if (!victim.alive || damage <= 0) return;
  if (!attacker || attacker.id === victim.id || !attacker.alive) return;
  if (isPlayerEntity(victim)) return;
  if (victim.type === EntityType.MONSTER && attacker.type === EntityType.MONSTER) return;

  const reaction = threatReaction(victim, attacker, source, damage);
  setThreatMemory(victim, attacker, damage, source, time, reaction);
  applyVictimReaction(victim, attacker, reaction);
  publishPlayerHurtNpcEvent(world, state, attacker, victim, damage, source, time);
  if ((victim.hp ?? 1) <= 0) publishActorKillEvent(world, state, attacker, victim, source);
}

export function getRecentCombatThreat(victim: Entity, time: number): CombatThreat | undefined {
  const memory = threatMemory.get(victim);
  if (!memory || memory.expiresAt <= time) return undefined;
  const attacker = getEntityIndex().byId.get(memory.attackerId);
  if (!attacker?.alive) return undefined;
  if (victim.type === EntityType.MONSTER && attacker.type === EntityType.MONSTER) return undefined;
  return {
    attacker,
    attackerId: memory.attackerId,
    lastKnownX: memory.lastKnownX,
    lastKnownY: memory.lastKnownY,
    damagePressure: memory.damagePressure,
    reaction: memory.reaction,
    source: memory.source,
    expiresAt: memory.expiresAt,
  };
}

export function isRecentCombatThreat(victim: Entity, attacker: Entity, time: number): boolean {
  if (victim.type === EntityType.MONSTER && attacker.type === EntityType.MONSTER) return false;
  const memory = threatMemory.get(victim);
  return memory !== undefined &&
    memory.attackerId === attacker.id &&
    memory.expiresAt > time &&
    memory.reaction !== 'startled';
}

export function resetCombatStimulus(): void {
  threatMemory = new WeakMap<Entity, CombatThreatMemory>();
  killedEventTargets = new WeakSet<Entity>();
  recentEventTimes.clear();
}
