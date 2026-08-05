/* ── Universal AI Micro-Goal System ───────────────────────────── */

import { AIGoal, Entity, EntityType, Msg } from '../../core/types';
import { World } from '../../core/world';
import { emitMarkovBark } from './barks';
import { steerEntityTowardCell, clearEntitySteeringPath } from './pathfinding';
import { aiPathMoveSpeed } from '../rpg';
import { canActorOccupy, actorOccupyRadius, entityIgnoresFineBlockers } from '../movement_collision';
import { findNoiseInvestigationTarget } from '../noise';
import { pickupDrop } from '../inventory';
import { getEntityIndex, ENTITY_MASK_NPC, ENTITY_MASK_ITEM_DROP } from '../entity_index';

const _microQueryOut: Entity[] = new Array(32);

export interface MicroGoalOpts {
  targetX?: number;
  targetY?: number;
  timer: number;
  sourceId?: number;
}

const MICRO_GOAL_PRIORITIES: Record<string, number> = {
  'pack_pulse': 50,
  'search_lkp': 40,
  'investigate_noise': 30,
  'greet': 20,
  'reposition': 10,
  'loot_nearby': 5,
};

export function hasMicroGoal(e: Entity): boolean {
  return e.ai?.microGoalId !== undefined;
}

export function clearMicroGoal(e: Entity): void {
  const ai = e.ai;
  if (!ai) return;
  ai.microGoalId = undefined;
  ai.microTargetX = undefined;
  ai.microTargetY = undefined;
  ai.microTimer = undefined;
  ai.microSourceId = undefined;
  clearEntitySteeringPath(e);
}

export function trySetMicroGoal(e: Entity, id: string, opts: MicroGoalOpts): boolean {
  const ai = e.ai;
  if (!ai) return false;
  
  // Combat supersedes all micro-goals
  if (ai.combatTargetId !== undefined && ai.combatTargetId !== e.id) return false;
  if (ai.goal === AIGoal.FLEE || ai.goal === AIGoal.HIDE) return false;
  
  // Check priority if a micro-goal is already active
  if (ai.microGoalId) {
    const currentPri = MICRO_GOAL_PRIORITIES[ai.microGoalId] ?? 0;
    const newPri = MICRO_GOAL_PRIORITIES[id] ?? 0;
    if (newPri <= currentPri) return false;
  }
  
  ai.microGoalId = id;
  ai.microTargetX = opts.targetX;
  ai.microTargetY = opts.targetY;
  ai.microTimer = opts.timer;
  ai.microSourceId = opts.sourceId;
  clearEntitySteeringPath(e);
  return true;
}

export function tickMicroGoal(world: World, entities: Entity[], e: Entity, dt: number, _time: number, _msgs: Msg[]): boolean {
  const ai = e.ai;
  if (!ai) return false;
  
  if (ai.microCooldowns) {
    let hasDeletes = false;
    const keys = Object.keys(ai.microCooldowns);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const val = ai.microCooldowns[key] - dt;
      ai.microCooldowns[key] = val;
      if (val <= 0) {
        hasDeletes = true;
      }
    }

    if (hasDeletes) {
      const newObj: Record<string, number> = {};
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const val = ai.microCooldowns[key];
        if (val > 0) newObj[key] = val;
      }
      ai.microCooldowns = newObj;
    }
  }

  if (!ai.microGoalId || ai.microTimer === undefined) return false;
  
  ai.microTimer -= dt;
  if (ai.microTimer <= 0) {
    clearMicroGoal(e);
    return false;
  }
  
  // Execution logic based on the specific micro-goal
  switch (ai.microGoalId) {
    case 'investigate_noise':
    case 'search_lkp':
    case 'reposition':
    case 'loot_nearby':
    case 'pack_pulse': {
      if (ai.microTargetX !== undefined && ai.microTargetY !== undefined) {
        const steer = steerEntityTowardCell(world, e, ai.microTargetX, ai.microTargetY);
        if (steer) {
          const speed = aiPathMoveSpeed(e) * dt;
          const r = actorOccupyRadius(e);
          const nx = e.x + steer.x * speed;
          const ny = e.y + steer.y * speed;
          const ignoreFineBlockers = entityIgnoresFineBlockers(e);
          if (canActorOccupy(world, nx, e.y, r, { ignoreFineBlockers })) e.x = world.wrap(nx);
          if (canActorOccupy(world, e.x, ny, r, { ignoreFineBlockers })) e.y = world.wrap(ny);
          e.angle = Math.atan2(steer.y, steer.x);
        } else {
          if (ai.microGoalId === 'loot_nearby' && ai.microSourceId !== undefined) {
            const item = entities.find(x => x.id === ai.microSourceId);
            if (item && item.type === EntityType.ITEM_DROP && item.alive) {
              pickupDrop(world, item, e, _msgs, _time, undefined);
            }
          }
          // Reached target early, clear goal
          clearMicroGoal(e);
          return false;
        }
      }
      return true;
    }
  }
  
  return true;
}

export function evaluateMicroStimuli(world: World, e: Entity, time: number, msgs: Msg[]): void {
  const ai = e.ai;
  if (!ai || hasMicroGoal(e) || ai.combatTargetId !== undefined || ai.goal === AIGoal.FLEE || ai.goal === AIGoal.HIDE) {
    return;
  }
  
  if ((ai.microScanCd ?? 0) > time) return;
  ai.microScanCd = time + 0.3 + Math.random() * 0.3;
  
  // Bounded scan for greet (can happen while walking)
  if (e.type === EntityType.NPC) {
    const index = getEntityIndex();
    const count = index.queryRadiusCapped(e.x, e.y, 4, _microQueryOut, ENTITY_MASK_NPC, 16);
    for (let i = 0; i < count; i++) {
      const near = _microQueryOut[i];
      if (!near.alive) continue;
      
      const dx = near.x - e.x;
      const dy = near.y - e.y;
      const dist2 = dx * dx + dy * dy;
      
      if (dist2 < 9 && dist2 > 0) { // 3 cells squared
        if ((ai.microCooldowns?.['greet'] ?? 0) <= 0) {
          ai.microCooldowns = ai.microCooldowns || {};
          ai.microCooldowns['greet'] = 120; // 2 minutes before greeting anyone again
          emitMarkovBark(e, msgs, time, 'ambient', 'Привет.', 1.0, '#aac');
        }
      }
    }
  }

  // Suppress blocking micro-goals if NPC is traveling a long distance to avoid massive pathing churn
  if (ai.path && (ai.path.length - (ai.pi ?? 0)) > 5) {
    return;
  }
  
  // 1. Investigate Noise
  const noise = findNoiseInvestigationTarget(world, undefined, e, time);
  if (noise && (ai.microCooldowns?.['investigate_noise'] ?? 0) <= 0) {
    if (trySetMicroGoal(e, 'investigate_noise', { targetX: noise.x, targetY: noise.y, timer: 12 })) {
      ai.microCooldowns = ai.microCooldowns || {};
      ai.microCooldowns['investigate_noise'] = 30; // 30 sec cooldown
      emitMarkovBark(e, msgs, time, 'alert', 'Что там?', 1.0, '#aac');
      return;
    }
  }

  // 2. Loot items
  if (e.type === EntityType.NPC) {
    const index = getEntityIndex();
    const count = index.queryRadiusCapped(e.x, e.y, 4, _microQueryOut, ENTITY_MASK_ITEM_DROP, 16);
    for (let i = 0; i < count; i++) {
      const near = _microQueryOut[i];
      if (!near.alive) continue;
      
      const dx = near.x - e.x;
      const dy = near.y - e.y;
      const dist2 = dx * dx + dy * dy;
      
      if (dist2 < 4) {
        if ((ai.microCooldowns?.['loot_nearby'] ?? 0) <= 0) {
          if (trySetMicroGoal(e, 'loot_nearby', { targetX: near.x, targetY: near.y, timer: 5, sourceId: near.id })) {
            ai.microCooldowns = ai.microCooldowns || {};
            ai.microCooldowns['loot_nearby'] = 45; // 45 sec cooldown
            return;
          }
        }
      }
    }
  }
}
