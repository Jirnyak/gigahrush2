/* ── Story route gates: small floor mutations keyed by plot state ─ */

import { Cell, LiftDirection, type Entity, type GameState } from '../core/types';
import { World } from '../core/world';
import { ensureFloorRouteLiftLayout } from './floor_memory';
import {
  currentFloorRunEntry,
  floorRunEntryFloorKey,
  floorRunEntryLiftDirections,
  ROUTE_LIFTS_PER_DIRECTION,
} from './procedural_floors';
import { openRouteGatesForFloor } from './route_gates';

function hasUsableLift(world: World, direction: LiftDirection): boolean {
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] === Cell.LIFT && world.liftDir[i] === direction) return true;
  }
  return false;
}

export function applyStoryRouteGates(world: World, player: Entity, state: GameState): boolean {
  const entry = currentFloorRunEntry(state);
  const floorKey = floorRunEntryFloorKey(entry);
  const openGates = openRouteGatesForFloor(floorKey, state);
  const openDirections = [...new Set(openGates.flatMap(gate => gate.liftMutation.directions))];
  if (openDirections.length === 0) return false;
  const openGateIds = new Set(openGates.map(gate => gate.id));
  const hadOpenLifts = openDirections.every(direction => hasUsableLift(world, direction));
  ensureFloorRouteLiftLayout(world, player.x, player.y, floorRunEntryLiftDirections(entry, openGateIds), {
    countPerDirection: ROUTE_LIFTS_PER_DIRECTION,
  });
  return !hadOpenLifts && openDirections.every(direction => hasUsableLift(world, direction));
}
