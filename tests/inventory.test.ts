import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { addItem, canAddItem, removeItem, hasItem, consumeDurability } from '../src/systems/inventory';
import { makeTestPlayer, makeGameState } from './helpers';
import { MAX_INVENTORY_SLOTS } from '../src/data/inventory_limits';

test('hasItem returns true if the entity has the item', () => {
  const player = makeTestPlayer({ inventory: [{ defId: 'bread', count: 1 }] });
  assert.equal(hasItem(player, 'bread'), true);
});

test('hasItem returns false if the entity does not have the item', () => {
  const player = makeTestPlayer({ inventory: [{ defId: 'bread', count: 1 }] });
  assert.equal(hasItem(player, 'water'), false);
});

test('hasItem returns false if inventory is undefined', () => {
  const player = makeTestPlayer();
  player.inventory = undefined;
  assert.equal(hasItem(player, 'bread'), false);
});

test('addItem adds item to an empty inventory', () => {
  const player = makeTestPlayer({ inventory: [] });
  assert.equal(addItem(player, 'bread', 1), true);
  assert.equal(player.inventory?.length, 1);
  assert.equal(player.inventory?.[0]?.defId, 'bread');
  assert.equal(player.inventory?.[0]?.count, 1);
});

test('addItem adds item to an existing stack', () => {
  const player = makeTestPlayer({ inventory: [{ defId: 'bread', count: 1 }] });
  assert.equal(addItem(player, 'bread', 1), true);
  assert.equal(player.inventory?.length, 1);
  assert.equal(player.inventory?.[0]?.count, 2);
});

test('addItem creates a new stack if existing stack is full', () => {
  // we assume the max stack size for bread is less than 999.
  // We'll just test that adding an unstackable item works.
  const player = makeTestPlayer({ inventory: [{ defId: 'flashlight', count: 1 }] });
  assert.equal(addItem(player, 'flashlight', 1), true);
  assert.equal(player.inventory?.length, 2);
  assert.equal(player.inventory?.[1]?.defId, 'flashlight');
});

test('canAddItem returns false if inventory is full', () => {
  const inventory = Array.from({ length: MAX_INVENTORY_SLOTS }, () => ({ defId: 'pipe', count: 1 }));
  const player = makeTestPlayer({ inventory });
  assert.equal(canAddItem(player, 'flashlight', 1), false);
});

test('removeItem removes items from the inventory completely if count matches', () => {
  const player = makeTestPlayer({ inventory: [{ defId: 'bread', count: 1 }] });
  assert.equal(removeItem(player, 'bread', 1), true);
  assert.equal(player.inventory?.length, 0);
});

test('removeItem decreases count if more items exist than removed', () => {
  const player = makeTestPlayer({ inventory: [{ defId: 'bread', count: 2 }] });
  assert.equal(removeItem(player, 'bread', 1), true);
  assert.equal(player.inventory?.length, 1);
  assert.equal(player.inventory?.[0]?.count, 1);
});

test('removeItem returns false if the item does not exist', () => {
  const player = makeTestPlayer({ inventory: [{ defId: 'bread', count: 1 }] });
  assert.equal(removeItem(player, 'water', 1), false);
  assert.equal(player.inventory?.length, 1);
});

test('removeItem removes across multiple stacks', () => {
  const player = makeTestPlayer({ inventory: [{ defId: 'bread', count: 1 }, { defId: 'bread', count: 2 }] });
  assert.equal(removeItem(player, 'bread', 2), true);
  // It removes from the last stack backwards. So it removes 2 from the second stack, leaving 1 in the first stack.
  assert.equal(player.inventory?.length, 1);
  assert.equal(player.inventory?.[0]?.count, 1);
});

test('consumeDurability removes durability and breaks item', () => {
  // pipe has durability
  const player = makeTestPlayer({
    inventory: [{ defId: 'pipe', count: 1, data: { dur: 1 } }],
    weapon: 'pipe'
  });
  const msgs: any[] = [];
  const state = makeGameState();
  assert.equal(consumeDurability(player, msgs, 0, state), true);
  assert.equal(player.inventory?.length, 0);
  assert.equal(player.weapon, '');
});

test('consumeDurability does not break item if durability remains', () => {
  // pipe has durability
  const player = makeTestPlayer({
    inventory: [{ defId: 'pipe', count: 1, data: { dur: 200 } }],
    weapon: 'pipe'
  });
  const msgs: any[] = [];
  const state = makeGameState();
  assert.equal(consumeDurability(player, msgs, 0, state), false);
  assert.equal(player.inventory?.length, 1);
  assert.equal(player.weapon, 'pipe');
});
