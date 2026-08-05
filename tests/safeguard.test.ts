import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  Cell,
  EntityType,
  MonsterKind,
  W,
} from '../src/core/types';
import { World } from '../src/core/world';
import { spawnSafeguardHackBacklash } from '../src/systems/safeguard';
import { makeGameState, makeTestPlayer, makeTestEntity } from './helpers';
import { getRecentEvents } from '../src/systems/events';

test('safeguard hack backlash spawn tests', async (t) => {
  await t.test('spawns a safeguard monster successfully', () => {
    const world = new World(1, 100);
    // Fill with floor
    world.cells.fill(Cell.FLOOR);

    const state = makeGameState();
    const entities = [
      makeTestPlayer({ id: 1, x: 50.5, y: 50.5 })
    ];
    const nextId = { v: 2 };

    const safeguard = spawnSafeguardHackBacklash(
      world,
      entities,
      nextId,
      state,
      50,
      50,
      'Test hack failed'
    );

    assert.ok(safeguard, 'Should return a spawned safeguard');
    assert.equal(safeguard.type, EntityType.MONSTER);
    assert.equal(safeguard.monsterKind, MonsterKind.SAFEGUARD);
    assert.equal(entities.length, 2, 'Should add safeguard to entities array');

    const events = getRecentEvents(state, { type: 'net_terminal_hack_failed' });
    assert.equal(events.length, 1, 'Should publish hack failed event');
    assert.equal(events[0].data.reason, 'Test hack failed');
  });

  await t.test('prevents spawn if active safeguard is nearby', () => {
    const world = new World(1, 100);
    world.cells.fill(Cell.FLOOR);
    const state = makeGameState();
    const entities = [
      makeTestPlayer({ id: 1, x: 50.5, y: 50.5 }),
      makeTestEntity({ id: 2, type: EntityType.MONSTER, monsterKind: MonsterKind.SAFEGUARD, x: 51, y: 51, alive: true })
    ];
    const nextId = { v: 3 };

    const safeguard = spawnSafeguardHackBacklash(
      world,
      entities,
      nextId,
      state,
      50,
      50,
      'Test hack failed'
    );

    assert.equal(safeguard, null, 'Should not spawn safeguard if one is nearby');
  });

  await t.test('prevents spawn if terminal cooldown is active', () => {
    const world = new World(1, 100);
    world.cells.fill(Cell.FLOOR);
    const state = makeGameState();
    const entities = [
      makeTestPlayer({ id: 1, x: 50.5, y: 50.5 })
    ];
    const nextId = { v: 2 };

    // Trigger initial failure to set cooldown
    spawnSafeguardHackBacklash(world, entities, nextId, state, 50, 50, 'First failure', { terminalIdx: 0, floorKey: 'test' });

    // Attempt second failure immediately
    const safeguard2 = spawnSafeguardHackBacklash(world, entities, nextId, state, 50, 50, 'Second failure', { terminalIdx: 0, floorKey: 'test' });

    assert.equal(safeguard2, null, 'Should not spawn safeguard if terminal cooldown is active');
  });

  await t.test('prevents spawn if no valid spawn cells are available', () => {
    const world = new World(1, 100);
    world.cells.fill(Cell.WALL); // Fill with walls so no spawn is possible
    const state = makeGameState();
    const entities = [
      makeTestPlayer({ id: 1, x: 50.5, y: 50.5 })
    ];
    const nextId = { v: 2 };

    const safeguard = spawnSafeguardHackBacklash(
      world,
      entities,
      nextId,
      state,
      50,
      50,
      'Test hack failed'
    );

    assert.equal(safeguard, null, 'Should not spawn safeguard if no valid spawn cells');
  });


  await t.test('prevents spawn if entity limit is reached', () => {
    const world = new World(1, 100);
    world.cells.fill(Cell.FLOOR);
    const state = makeGameState();
    const entities = [
      makeTestPlayer({ id: 1, x: 50.5, y: 50.5 })
    ];
    // Add enough entities to hit the DEFAULT_ACTIVE_ACTOR_SOFT_LIMIT (4096)
    for (let i = 0; i < 4096; i++) {
      entities.push(makeTestEntity({ id: 2 + i, type: EntityType.MONSTER, monsterKind: MonsterKind.BLADE, x: 1, y: 1, alive: true }));
    }
    const nextId = { v: 4098 };

    const safeguard = spawnSafeguardHackBacklash(
      world,
      entities,
      nextId,
      state,
      50,
      50,
      'Test hack failed'
    );

    assert.equal(safeguard, null, 'Should not spawn safeguard if entity limit is reached');
  });

  await t.test('prevents spawn if floor cooldown is active', () => {
    const world = new World(1, 100);
    world.cells.fill(Cell.FLOOR);
    const state = makeGameState();
    const entities = [
      makeTestPlayer({ id: 1, x: 50.5, y: 50.5 })
    ];
    const nextId = { v: 2 };

    // Trigger initial failure to set cooldown specifically for a floor key
    spawnSafeguardHackBacklash(world, entities, nextId, state, 50, 50, 'First failure', { floorKey: 'design:test' });

    // Fast forward a tiny bit, but still within cooldown
    state.time += 10;

    // Attempt second failure on the same floor key
    const safeguard2 = spawnSafeguardHackBacklash(world, entities, nextId, state, 50, 50, 'Second failure', { floorKey: 'design:test' });

    assert.equal(safeguard2, null, 'Should not spawn safeguard if floor cooldown is active');
  });

  await t.test('allows spawn if terminal cooldown expired', () => {
    const world = new World(1, 100);
    world.cells.fill(Cell.FLOOR);
    // Explicitly set time to avoid 0s and logic issues when state.time matches event.time exactly.
    const state = makeGameState({ time: 1000 });
    const entities = [
      makeTestPlayer({ id: 1, x: 50.5, y: 50.5 })
    ];
    const nextId = { v: 2 };

    // Trigger initial failure at time 1000
    spawnSafeguardHackBacklash(world, entities, nextId, state, 50, 50, 'First failure', { terminalIdx: 0 });

    // Kill the spawned safeguard so it doesn't block the next spawn due to proximity
    for (const e of entities) {
      if (e.monsterKind === MonsterKind.SAFEGUARD) e.alive = false;
    }

    // Advance time past the 900s terminal cooldown (to 1901)
    state.time += 901;

    // Attempt second failure
    const safeguard2 = spawnSafeguardHackBacklash(world, entities, nextId, state, 50, 50, 'Second failure', { terminalIdx: 0 });

    assert.ok(safeguard2, 'Should spawn safeguard because cooldown expired');
  });
});
