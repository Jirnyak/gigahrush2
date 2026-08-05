import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  EntityType, Faction, Feature, FloorLevel,
  type Entity,
} from '../src/core/types';
import { World } from '../src/core/world';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { takeFromContainer } from '../src/systems/containers';
import { routeCueCount } from '../src/systems/route_cues';
import { freshRPG } from '../src/systems/rpg';
import {
  generateSeryySmotritel,
  SERYY_SMOTRITEL_ID,
} from '../src/gen/void/seryy_smotritel';
import { makeGameState } from './helpers';

function angleTo(world: World, fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.atan2(world.delta(fromY, toY), world.delta(fromX, toX));
}

function makePlayer(world: World, x: number, y: number, sourceX: number, sourceY: number): Entity {
  return {
    id: 1000,
    type: EntityType.NPC, persistentNpcId: 'player',
    x,
    y,
    angle: angleTo(world, x, y, sourceX + 0.5, sourceY + 0.5),
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    hp: 100,
    maxHp: 100,
    inventory: [],
    faction: Faction.PLAYER,
    rpg: freshRPG(12),
  };
}

test('Seryy Smotritel chamber teaches no-look route and punishes direct watching on interaction', () => {
  const world = new World();
  const entities: Entity[] = [];
  const generated = generateSeryySmotritel(world, entities, { v: 1 }, 512, 512);
  assert.ok(generated);

  const sourceCell = world.idx(generated.sourceX, generated.sourceY);
  assert.equal(world.features[sourceCell], Feature.APPARATUS);
  assert.equal(routeCueCount(world), 1);
  assert.equal(world.containers.some(c => c.tags.includes(SERYY_SMOTRITEL_ID) && c.tags.includes('avoided')), true);
  assert.equal(world.containers.some(c => c.tags.includes(SERYY_SMOTRITEL_ID) && c.tags.includes('sample')), true);

  const watched = world.containerById.get(generated.watchContainerId);
  assert.ok(watched);
  const player = makePlayer(world, watched.x + 0.5, watched.y + 0.5, generated.sourceX, generated.sourceY);
  entities.push(player);
  const state = makeGameState({
    currentFloor: FloorLevel.VOID,
    worldEvents: createWorldEventState(),
  });

  assert.equal(takeFromContainer(watched, player, 0, 1, { state, world, entities }), true);
  assert.equal((player.hp ?? 0) < 100, true);
  assert.equal(entities.some(e => e.type === EntityType.MONSTER && e.name === 'Тень Серого Смотрителя'), true);
  assert.equal(getRecentEvents(state, { type: 'rumor_observed', tags: [SERYY_SMOTRITEL_ID, 'watched'] }).length, 1);
});

test('Seryy Smotritel source can be disabled through the side interaction', () => {
  const world = new World();
  const entities: Entity[] = [];
  const generated = generateSeryySmotritel(world, entities, { v: 1 }, 512, 512);
  assert.ok(generated);

  const disable = world.containerById.get(generated.disableContainerId);
  assert.ok(disable);
  const player = makePlayer(world, disable.x + 0.5, disable.y + 0.5, generated.sourceX, generated.sourceY);
  entities.push(player);
  const state = makeGameState({
    currentFloor: FloorLevel.VOID,
    worldEvents: createWorldEventState(),
  });

  assert.equal(takeFromContainer(disable, player, 0, 1, { state, world, entities }), true);
  assert.equal(world.features[world.idx(generated.sourceX, generated.sourceY)], Feature.TABLE);
  assert.equal(getRecentEvents(state, { type: 'player_use_item', tags: [SERYY_SMOTRITEL_ID, 'disabled'] }).length, 1);
});
