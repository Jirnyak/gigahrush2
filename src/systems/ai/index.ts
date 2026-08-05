/* ── AI system — orchestrator ─────────────────────────────────── */

export { forceHide } from './npc_fsm';
export { getNpcStateText } from './npc_state_text';
export { tryMonsterProjectileStagger } from './monster';

import {
  type Entity, type GameState, type Msg, type GameClock,
  EntityType, FloorLevel, MonsterKind, AIGoal,
  setMsgLocationProvider,
} from '../../core/types';
import { World } from '../../core/world';
import { setPathContext } from './pathfinding';
import { setEntityMap, updateMonster } from './monster';
import { setCombatContext, tryFactionCombat, tryFleeFromMonster, trySimulateNpcAmmoRestock } from './combat';
import { primeNpcAlifeState, setNpcContext, updateNPC } from './npc_fsm';
import { setNpcBarkLogContext } from './barks';
import { actorHasTacticProfile, runActorTactic } from './tactics';
import { expireMonsterBaits } from '../monster_bait';
import { ensureEntityIndex } from '../entity_index';
import { hearingRadiusMetersForActor } from '../hearing';
import { unstuckActorFromBlockers } from '../movement_collision';
import { isPlayerEntity } from '../player_actor';
import { updateSwarmNests } from '../swarm_nests';

export interface AiStats {
  frame: number;
  liveAi: number;
  skipped: number;
  updated: number;
  updatedNpc: number;
  updatedMonster: number;
  plot: number;
  bosses: number;
  activeAttackers: number;
  projectileOwners: number;
  projectiles: number;
}

const projectileOwnerIds = new Set<number>();
let aiStats: AiStats = {
  frame: 0,
  liveAi: 0,
  skipped: 0,
  updated: 0,
  updatedNpc: 0,
  updatedMonster: 0,
  plot: 0,
  bosses: 0,
  activeAttackers: 0,
  projectileOwners: 0,
  projectiles: 0,
};
let aiFrame = 0;

function resetAiStats(frame: number, liveAi: number, projectiles: number): void {
  aiStats = {
    frame,
    liveAi,
    skipped: 0,
    updated: 0,
    updatedNpc: 0,
    updatedMonster: 0,
    plot: 0,
    bosses: 0,
    activeAttackers: 0,
    projectileOwners: 0,
    projectiles,
  };
}

export function getAiStats(): AiStats {
  return { ...aiStats };
}

function isBossActor(e: Entity): boolean {
  if (e.isFogBoss) return true;
  switch (e.monsterKind) {
    case MonsterKind.BETONNIK:
    case MonsterKind.MATKA:
    case MonsterKind.KHOROVAYA_MATKA:
    case MonsterKind.MANCOBUS:
    case MonsterKind.CREATOR:
      return true;
    default:
      return false;
  }
}

function isActiveAttacker(e: Entity, entityById: Map<number, Entity>): boolean {
  const ai = e.ai;
  if (!ai || ai.combatTargetId === undefined) return false;
  const target = entityById.get(ai.combatTargetId);
  if (!target?.alive) return false;
  if ((ai.windupTimer ?? 0) > 0) return true;
  return (e.attackCd ?? 0) > 0;
}

function fillProjectileOwners(entities: readonly Entity[]): void {
  projectileOwnerIds.clear();
  for (const e of entities) {
    if (!e.alive || e.ownerId === undefined || e.type !== EntityType.PROJECTILE) continue;
    projectileOwnerIds.add(e.ownerId);
  }
}

export function updateAI(world: World, entities: Entity[], dt: number, time: number, msgs: Msg[], playerId: number, clock: GameClock, samosborActive: boolean, nextId: { v: number }, currentFloor?: FloorLevel, state?: GameState): void {
  // Push per-frame refs into sub-modules
  setPathContext(msgs, time, samosborActive);
  setCombatContext(msgs, time);
  setNpcContext(msgs, time);
  expireMonsterBaits(state, time);

  // Main rebuilds the runtime broadphase once before simulation; AI only consumes it.
  const entityIndex = ensureEntityIndex(entities);
  setEntityMap(entityIndex.byId);
  fillProjectileOwners(entityIndex.projectiles);

  const isMinistry = currentFloor === FloorLevel.MINISTRY;
  const player = entityIndex.byId.get(playerId);
  setNpcBarkLogContext({
    listener: player,
    radiusMeters: hearingRadiusMetersForActor(player, state?.npcLogRadiusMeters),
    dist2: (x1, y1, x2, y2) => world.dist2(x1, y1, x2, y2),
  });
  updateSwarmNests(world, entities, dt, time, player, nextId, state);
  aiFrame = (aiFrame + 1) & 0x3fffffff;
  resetAiStats(aiFrame, entityIndex.ai.length, entityIndex.projectiles.length);

  let currentMsgActor: Entity | undefined;
  setMsgLocationProvider(() => {
    const actor = currentMsgActor;
    if (!actor) return undefined;
    const ci = world.idx(Math.floor(actor.x), Math.floor(actor.y));
    const roomId = world.roomMap[ci];
    return {
      floor: currentFloor,
      x: actor.x,
      y: actor.y,
      actorId: actor.id,
      roomId: roomId >= 0 ? roomId : undefined,
      zoneId: world.zoneMap[ci],
    };
  });
  try {
    for (const e of entityIndex.ai) {
      if (!e || !e.alive || !e.ai) continue;
      if (isPlayerEntity(e)) {
        aiStats.skipped++;
        continue;
      }
      unstuckActorFromBlockers(world, e);
      if (e.type === EntityType.NPC) {
        if (e.ai.npcState === undefined) {
          primeNpcAlifeState(e, clock, samosborActive, isMinistry ? 'ministry' : 'default');
        }
      } else if (e.type === EntityType.MONSTER && e.ai.goal === AIGoal.IDLE && e.ai.combatTargetId === undefined && e.speed > 0) {
        e.ai.goal = AIGoal.WANDER;
      }
      if (e.plotNpcId !== undefined) aiStats.plot++;
      if (isBossActor(e)) aiStats.bosses++;
      if (isActiveAttacker(e, entityIndex.byId)) aiStats.activeAttackers++;
      if (projectileOwnerIds.has(e.id)) aiStats.projectileOwners++;
      aiStats.updated++;
      currentMsgActor = e;
      if (e.type === EntityType.NPC) {
        aiStats.updatedNpc++;
        trySimulateNpcAmmoRestock(e, dt);
        if (actorHasTacticProfile(e) && runActorTactic(world, e, dt, time, msgs, player, state)) continue;
        if (!tryFactionCombat(world, entities, e, dt, time, msgs, nextId, state, player ?? null, {
          visualProjectiles: true,
          simple: true,
        })) {
          if (!tryFleeFromMonster(world, entities, e, dt, time)) {
            updateNPC(world, entities, e, dt, time, clock, samosborActive, isMinistry ? 'ministry' : 'default', state);
          }
        }
      }
      if (e.type === EntityType.MONSTER) {
        aiStats.updatedMonster++;
        if (actorHasTacticProfile(e) && runActorTactic(world, e, dt, time, msgs, player, state)) continue;
        updateMonster(world, entities, e, dt, time, msgs, playerId, nextId, state);
      }
    }
  } finally {
    currentMsgActor = undefined;
    setMsgLocationProvider();
  }
}
