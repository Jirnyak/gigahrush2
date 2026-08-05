/* ── Generic executor for authored NPC special routines ──────── */

import { type Entity, type GameClock } from '../core/types';
import { getNpcPackageByPlotNpcId } from '../data/npc_packages';
import { getNpcSpecialRoutine, type NpcSpecialRoutineDef } from '../data/npc_special_routines';

export interface NpcSpecialRoutineTick {
  routineId?: string;
  held: boolean;
  expired: boolean;
  clearUtility: boolean;
}

function routineForEntity(e: Entity): NpcSpecialRoutineDef | undefined {
  const plotNpcId = e.plotNpcId;
  if (!plotNpcId) return undefined;
  return getNpcSpecialRoutine(getNpcPackageByPlotNpcId(plotNpcId)?.runtime?.specialRoutineId);
}

export function tickNpcSpecialRoutine(e: Entity, clock: GameClock): NpcSpecialRoutineTick {
  const def = routineForEntity(e);
  if (!def) return { held: false, expired: false, clearUtility: false };
  if (def.activeUntilPlotDone && e.plotDone) {
    return { routineId: def.id, held: false, expired: false, clearUtility: false };
  }

  if (def.expireAtTotalMinutes !== undefined && clock.totalMinutes >= def.expireAtTotalMinutes) {
    if (def.setPlotDoneOnExpire) e.plotDone = true;
    return {
      routineId: def.id,
      held: false,
      expired: true,
      clearUtility: def.clearUtilityOnExpire === true,
    };
  }

  const ai = e.ai;
  if (ai) {
    if (def.holdGoal !== undefined) ai.goal = def.holdGoal;
    if (def.holdNpcState !== undefined) ai.npcState = def.holdNpcState;
    ai.path = [];
    ai.pi = 0;
    ai.timer = def.holdTimerSec ?? 1;
  }
  return { routineId: def.id, held: true, expired: false, clearUtility: false };
}
