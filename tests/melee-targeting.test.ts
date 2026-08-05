import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, Faction, W, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { selectMeleeTarget } from '../src/systems/melee_targeting';

function actor(overrides: Partial<Entity>): Entity {
  return {
    id: 1,
    type: EntityType.NPC,
    x: 10,
    y: 10,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    faction: Faction.CITIZEN,
    ...overrides,
  };
}

test('melee target selection uses geometry instead of candidate order', () => {
  const world = new World();
  const player = actor({ id: 1, faction: Faction.PLAYER });
  const offLineFirst = actor({ id: 2, type: EntityType.MONSTER, x: 11.9, y: 10.7 });
  const onLineSecond = actor({ id: 9, type: EntityType.MONSTER, x: 11.9, y: 10.05 });
  const reach = 2;

  assert.equal(selectMeleeTarget(world, player, [offLineFirst, onLineSecond], reach)?.id, onLineSecond.id);
  assert.equal(selectMeleeTarget(world, player, [onLineSecond, offLineFirst], reach)?.id, onLineSecond.id);
});

test('melee target selection uses toroidal geometry at world edge', () => {
  const world = new World();
  const player = actor({ id: 1, x: W - 0.5, y: 20, angle: 0, faction: Faction.PLAYER });
  const wrappedTarget = actor({ id: 4, type: EntityType.MONSTER, x: 0.45, y: 20.05 });

  assert.equal(selectMeleeTarget(world, player, [wrappedTarget], 1)?.id, wrappedTarget.id);
});
