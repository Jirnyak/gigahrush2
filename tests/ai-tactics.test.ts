import test from 'node:test';
import assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, FloorLevel, Faction, MonsterKind, type Entity, type GameClock } from '../src/core/types';
import { World } from '../src/core/world';
import { updateAI } from '../src/systems/ai';
import { getCellHazardMoveMultiplier } from '../src/systems/cell_hazards';
import { notifyActorDamaged, resetCombatStimulus } from '../src/systems/combat_stimulus';
import { rebuildEntityIndexForSimulation } from '../src/systems/entity_index';
import { makeGameState, makeTestNpc, makeTestPlayer } from './helpers';

function makeOpenWorld(): World {
  const world = new World();
  for (let y = 0; y < 80; y++) {
    for (let x = 0; x < 80; x++) world.set(x, y, Cell.FLOOR);
  }
  return world;
}

function aiState() {
  return { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 };
}

function slimeWoman(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 2,
    type: EntityType.MONSTER,
    x: 20.5,
    y: 20.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 2.2,
    sprite: 0,
    hp: 80,
    maxHp: 80,
    monsterKind: MonsterKind.SLIME_WOMAN,
    attackCd: 1,
    ai: aiState(),
    ...overrides,
  };
}

function tick(world: World, entities: Entity[], player: Entity, time: number, clock: GameClock): void {
  const state = makeGameState({ time, clock, currentFloor: FloorLevel.MAINTENANCE });
  rebuildEntityIndexForSimulation(entities, Math.floor(time * 1000));
  updateAI(world, entities, 0.12, time, state.msgs, player.id, clock, false, { v: 10_000 }, FloorLevel.MAINTENANCE, state);
}

test('actor tactic profile lets slime woman drop bounded residue after combat stimulus', () => {
  resetCombatStimulus();
  const world = makeOpenWorld();
  const clock = { hour: 8, minute: 0, totalMinutes: 8 * 60 };
  const player = makeTestPlayer({ id: 1, x: 19.5, y: 20.5, hp: 100, maxHp: 100 });
  const slime = slimeWoman();
  const entities = [player, slime];
  const state = makeGameState({ time: 4, clock, currentFloor: FloorLevel.MAINTENANCE });

  notifyActorDamaged(world, slime, player, 8, 'player_melee', 4, state);
  rebuildEntityIndexForSimulation(entities, 4_000);
  updateAI(world, entities, 0.12, 4, state.msgs, player.id, clock, false, { v: 10_000 }, FloorLevel.MAINTENANCE, state);

  const probe = makeTestPlayer({ id: 99, x: 20.5, y: 20.5 });
  assert.equal(getCellHazardMoveMultiplier(world, probe) < 1, true);
  assert.equal((slime.ai?.tacticActionCd ?? 0) > 0, true);
  assert.equal(((slime.ai?.tacticFlags ?? 0) & (1 << 2)) !== 0, true);
});

test('actor tactic profile makes slime woman flee local hostile crowd without full-map scan', () => {
  resetCombatStimulus();
  const world = makeOpenWorld();
  const clock = { hour: 8, minute: 0, totalMinutes: 8 * 60 };
  const player = makeTestPlayer({ id: 1, x: 5.5, y: 5.5, hp: 100, maxHp: 100 });
  const slime = slimeWoman({ x: 24.5, y: 24.5 });
  const crowd = [
    makeTestNpc({ id: 3, x: 23.5, y: 24.5, faction: Faction.CITIZEN }),
    makeTestNpc({ id: 4, x: 25.5, y: 24.5, faction: Faction.CITIZEN }),
    makeTestNpc({ id: 5, x: 24.5, y: 23.5, faction: Faction.CITIZEN }),
    makeTestNpc({ id: 6, x: 24.5, y: 25.5, faction: Faction.CITIZEN }),
  ];
  const entities = [player, slime, ...crowd];

  tick(world, entities, player, 8, clock);

  assert.equal(slime.ai?.tacticId, 'slime_woman_flee_crowd');
  assert.equal(slime.ai?.goal, AIGoal.FLEE);
  assert.equal((slime.ai?.tacticNearbyHostiles ?? 0) >= 4, true);
});
