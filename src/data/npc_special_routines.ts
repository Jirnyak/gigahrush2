/* ── Authored NPC special-routine definitions ───────────────── */

import { AIGoal, NpcState } from '../core/types';

export interface NpcSpecialRoutineDef {
  id: string;
  label: string;
  activeUntilPlotDone?: boolean;
  expireAtTotalMinutes?: number;
  setPlotDoneOnExpire?: boolean;
  clearUtilityOnExpire?: boolean;
  holdGoal?: AIGoal;
  holdNpcState?: NpcState;
  holdTimerSec?: number;
}

export const NPC_SPECIAL_ROUTINES: readonly NpcSpecialRoutineDef[] = [
  {
    id: 'tutorial_lock_one_hour',
    label: 'tutorial lock until 4 hours expire',
    activeUntilPlotDone: true,
    expireAtTotalMinutes: 240,
    setPlotDoneOnExpire: true,
    clearUtilityOnExpire: true,
    holdGoal: AIGoal.IDLE,
    holdNpcState: NpcState.FREE_TIME,
    holdTimerSec: 1,
  },
] as const;

const ROUTINES_BY_ID = new Map(NPC_SPECIAL_ROUTINES.map(def => [def.id, def]));

export function getNpcSpecialRoutine(id: string | undefined): NpcSpecialRoutineDef | undefined {
  return id ? ROUTINES_BY_ID.get(id) : undefined;
}
