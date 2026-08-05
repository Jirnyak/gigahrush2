/* ── Generic route gate predicates and direction guards ───────── */

import { LiftDirection, QuestType, type GameState, type Quest } from '../core/types';
import { ROUTE_GATE_DEFS, type RouteGateDef, type RouteGatePredicate } from '../data/route_gates';
import { floorKeyForEntry } from './floor_keys';

interface RouteGateEntryLike {
  z?: number;
  baseFloor: number;
  storyFloor?: number;
  designFloorId?: string;
  spec?: { key: string };
}

function questKillPredicateOpen(quest: Quest, predicate: Extract<RouteGatePredicate, { kind: 'quest_kill' }>): boolean {
  if (quest.type !== QuestType.KILL) return false;
  if (quest.targetMonsterKind !== predicate.monsterKind) return false;
  if ((quest.killNeeded ?? 0) < predicate.killNeeded) return false;
  if (predicate.eventTag && !quest.eventTags?.includes(predicate.eventTag)) return false;
  if (quest.done && predicate.doneCounts !== false) return true;
  return (quest.killCount ?? 0) >= predicate.killNeeded;
}

export function routeGatePredicateOpen(state: GameState, predicate: RouteGatePredicate): boolean {
  if (predicate.kind === 'quest_kill') {
    return state.quests.some(quest => questKillPredicateOpen(quest, predicate));
  }
  return false;
}

export function routeGateOpen(state: GameState, gate: RouteGateDef): boolean {
  return routeGatePredicateOpen(state, gate.predicate);
}

export function openRouteGateIds(state: GameState): Set<string> {
  const out = new Set<string>();
  for (const gate of ROUTE_GATE_DEFS) {
    if (routeGateOpen(state, gate)) out.add(gate.id);
  }
  return out;
}

function entryFloorKey(entry: RouteGateEntryLike): string {
  return floorKeyForEntry(entry as Parameters<typeof floorKeyForEntry>[0]);
}

export function routeGateMatchesDirection(gate: RouteGateDef, floorKey: string, direction: number): boolean {
  return gate.targetFloorKey === floorKey && gate.blockedDirection === direction;
}

export function openRouteGateDirectionsForEntry(state: GameState, entry: RouteGateEntryLike): LiftDirection[] {
  const floorKey = entryFloorKey(entry);
  const out: LiftDirection[] = [];
  for (const gate of ROUTE_GATE_DEFS) {
    if (gate.targetFloorKey !== floorKey) continue;
    if (!routeGateOpen(state, gate)) continue;
    for (const direction of gate.liftMutation.directions) {
      if (!out.includes(direction)) out.push(direction);
    }
  }
  return out;
}

export function routeGateBlocksDirection(
  entry: RouteGateEntryLike,
  direction: LiftDirection,
  openGateDirections: readonly LiftDirection[] = [],
): boolean {
  const floorKey = entryFloorKey(entry);
  return ROUTE_GATE_DEFS.some(gate =>
    routeGateMatchesDirection(gate, floorKey, direction) &&
    !openGateDirections.includes(direction));
}

export function routeGateDirectionIsClosed(
  floorKey: string,
  direction: number,
  openGateIds: ReadonlySet<string> | undefined,
): boolean {
  return ROUTE_GATE_DEFS.some(gate =>
    routeGateMatchesDirection(gate, floorKey, direction) &&
    !openGateIds?.has(gate.id));
}

export function routeDirectionBlockedByClosedGate(
  floorKey: string,
  direction: number,
  state: GameState,
): boolean {
  const open = openRouteGateIds(state);
  return routeGateDirectionIsClosed(floorKey, direction, open);
}

export function openRouteGatesForFloor(floorKey: string, state: GameState): RouteGateDef[] {
  const open = openRouteGateIds(state);
  return ROUTE_GATE_DEFS.filter(gate => gate.targetFloorKey === floorKey && open.has(gate.id));
}
