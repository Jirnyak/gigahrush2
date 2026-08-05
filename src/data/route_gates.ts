/* ── Story route gate definitions ────────────────────────────── */

import { LiftDirection, MonsterKind } from '../core/types';

export type RouteGatePredicate =
  | {
      kind: 'quest_kill';
      monsterKind: MonsterKind;
      killNeeded: number;
      eventTag?: string;
      doneCounts?: boolean;
    };

export interface RouteGateLiftMutationDef {
  kind: 'ensure_route_lifts';
  direction: LiftDirection;
  directions: readonly LiftDirection[];
  minTargetZ: number;
  maxTargetZ: number;
}

export interface RouteGateDef {
  id: string;
  targetRouteKind: 'design' | 'story' | 'procedural' | 'floor_instance';
  targetRouteId: string;
  targetFloorKey: string;
  blockedDirection: LiftDirection;
  predicate: RouteGatePredicate;
  liftMutation: RouteGateLiftMutationDef;
  tags: readonly string[];
}

export const ROUTE_GATE_DEFS: readonly RouteGateDef[] = [
  {
    id: 'podad_lower_route',
    targetRouteKind: 'design',
    targetRouteId: 'podad',
    targetFloorKey: 'design:podad',
    blockedDirection: LiftDirection.DOWN,
    predicate: {
      kind: 'quest_kill',
      monsterKind: MonsterKind.HERALD,
      killNeeded: 3,
      eventTag: 'herald_gate',
      doneCounts: true,
    },
    liftMutation: {
      kind: 'ensure_route_lifts',
      direction: LiftDirection.DOWN,
      directions: [LiftDirection.DOWN],
      minTargetZ: -50,
      maxTargetZ: -41,
    },
    tags: ['podad', 'herald_gate', 'lower_route'],
  },
];

export const ROUTE_GATES = ROUTE_GATE_DEFS;
