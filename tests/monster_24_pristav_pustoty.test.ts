import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, FloorLevel, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { generatePristavPustoty } from '../src/gen/void/pristav_pustoty';
import { takeFromContainer } from '../src/systems/containers';
import { getRecentEvents } from '../src/systems/events';
import { routeCueCount } from '../src/systems/route_cues';
import { makeGameState } from './helpers';

function makePlayer(id: number): Entity {
  return {
    id,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: 512.5,
    y: 512.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    hp: 100,
    maxHp: 100,
    money: 20,
    inventory: [
      { defId: 'void_spike', count: 1 },
      { defId: 'water', count: 2 },
    ],
  };
}

function setupPristav(): { world: World; entities: Entity[]; player: Entity } {
  const world = new World();
  const entities: Entity[] = [];
  const player = makePlayer(1);
  entities.push(player);
  generatePristavPustoty(world, entities, { v: 2 }, 512, 512);
  return { world, entities, player };
}

test('Пристав Пустоты states the rule before violation pressure', () => {
  const { world, entities, player } = setupPristav();
  const state = makeGameState({ currentFloor: FloorLevel.VOID });
  const violate = world.containers.find(c => c.tags.includes('pristav_pustoty') && c.tags.includes('violate'));
  assert.ok(violate);
  assert.equal(routeCueCount(world), 1);
  assert.equal(entities.filter(e => e.type === EntityType.MONSTER).length, 0);

  assert.equal(takeFromContainer(violate, player, 0, 1, { state, world, entities }), true);

  const water = player.inventory?.find(item => item.defId === 'water');
  const originalSpike = player.inventory?.find(item => item.defId === 'void_spike');
  assert.equal(water?.count, 1);
  assert.equal(originalSpike?.count, 1);
  assert.ok(entities.some(e => e.type === EntityType.MONSTER && e.name === 'Пристав Пустоты'));

  const events = getRecentEvents(state, { tags: ['pristav_pustoty'], limit: 8 });
  assert.ok(events.some(e => String(e.type) === 'pristav_pustoty_stated'));
  assert.ok(events.some(e => String(e.type) === 'pristav_pustoty_violated'));
});

test('Пристав Пустоты payment resolves without spawning pressure', () => {
  const { world, entities, player } = setupPristav();
  const state = makeGameState({ currentFloor: FloorLevel.VOID });
  const pay = world.containers.find(c => c.tags.includes('pristav_pustoty') && c.tags.includes('pay'));
  assert.ok(pay);

  assert.equal(takeFromContainer(pay, player, 0, 1, { state, world, entities }), true);

  assert.equal(player.money, 15);
  assert.ok(player.inventory?.some(item => item.defId === 'psi_mark'));
  assert.equal(entities.filter(e => e.type === EntityType.MONSTER).length, 0);
  assert.ok(getRecentEvents(state, { tags: ['pristav_pustoty'], limit: 8 }).some(e => String(e.type) === 'pristav_pustoty_paid'));
});

test('Пристав Пустоты anchor break is sabotage with bounded pressure', () => {
  const { world, entities, player } = setupPristav();
  const state = makeGameState({ currentFloor: FloorLevel.VOID });
  const anchor = world.containers.find(c => c.tags.includes('pristav_pustoty') && c.tags.includes('anchor'));
  assert.ok(anchor);

  assert.equal(takeFromContainer(anchor, player, 0, 1, { state, world, entities }), true);

  const spikes = player.inventory?.filter(item => item.defId === 'void_spike').reduce((sum, item) => sum + item.count, 0);
  assert.equal(spikes, 2);
  assert.equal(entities.filter(e => e.type === EntityType.MONSTER).length, 1);
  assert.ok(getRecentEvents(state, { tags: ['pristav_pustoty'], limit: 8 }).some(e => String(e.type) === 'pristav_pustoty_anchor_broken'));
});
