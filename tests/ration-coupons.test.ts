import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, FloorLevel } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEMS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { RESOURCES } from '../src/data/resources';
import { ensureEconomyState } from '../src/systems/economy';
import { createWorldEventState, getRecentEvents, publishEvent } from '../src/systems/events';
import { useItem } from '../src/systems/inventory';
import { RATION_COUPON_ITEM_IDS } from '../src/systems/ration_coupons';
import { addTestRoom, cloneItems, countInventoryItem, makeGameState, makeTestContainer, makeTestPlayer } from './helpers';

function queueWorld(tag = 'ration_queue'): World {
  const world = new World();
  const room = addTestRoom(world, { id: 3, x: 10, y: 12, w: 8, h: 5, zoneId: 7, name: 'Тестовая пайковая очередь' });
  world.addContainer(makeTestContainer({
    id: 1,
    x: 12,
    y: 14,
    floor: FloorLevel.KVARTIRY,
    roomId: room.id,
    zoneId: 7,
    name: 'Тестовая касса',
    tags: [tag],
  }));
  return world;
}

test('ration coupon ids resolve through items, resources, and tags', () => {
  const paper = RESOURCES.find(resource => resource.id === 'paper')!;
  const documents = RESOURCES.find(resource => resource.id === 'documents')!;
  for (const id of RATION_COUPON_ITEM_IDS) {
    assert.ok(ITEMS[id], `${id} item must exist`);
    assert.ok(ITEM_TAGS[id]?.includes('ration'), `${id} must be tagged as ration content`);
    assert.ok(paper.itemIds.includes(id), `${id} must affect paper scarcity`);
    assert.ok(documents.itemIds.includes(id), `${id} must affect document scarcity`);
  }
});

test('using a fair ration coupon spends stock and grants ration output', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });
  const actor = makeTestPlayer({ id: 0, inventory: cloneItems([{ defId: 'water_coupon', count: 1 }]), money: 0 });

  useItem(actor, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(actor, 'water_coupon'), 0);
  assert.equal(countInventoryItem(actor, 'water'), 1);
  const economy = ensureEconomyState(state);
  assert.equal(economy.floors[FloorLevel.LIVING]?.resources.drink_water.stock, 119);
  assert.equal(getRecentEvents(state)[0].type, 'ration_coupon_spent');
});

test('water trades for a queue place only inside a ration queue room', () => {
  const state = makeGameState({ currentFloor: FloorLevel.KVARTIRY, worldEvents: createWorldEventState() });
  const world = queueWorld();
  const actor = makeTestPlayer({ id: 0, x: 12.5, y: 14.5, inventory: cloneItems([{ defId: 'water', count: 1 }]), money: 0 });

  useItem(actor, 0, state.msgs, state.time, state, 7, world);

  assert.equal(countInventoryItem(actor, 'water'), 0);
  assert.equal(countInventoryItem(actor, 'bread'), 1);
  const economy = ensureEconomyState(state);
  assert.equal(economy.floors[FloorLevel.KVARTIRY]?.resources.drink_water.stock, 121);
  assert.equal(economy.floors[FloorLevel.KVARTIRY]?.resources.food.stock, 139);
  const event = getRecentEvents(state)[0];
  assert.equal(event.type, 'player_use_item');
  assert.equal(event.data?.outcome, 'water_for_place_trade');
  assert.equal(event.tags.includes('crowd_relief'), true);
});

test('bread can jump the ration queue at crowd risk', () => {
  const state = makeGameState({ currentFloor: FloorLevel.KVARTIRY, worldEvents: createWorldEventState() });
  const world = queueWorld('ocherednik');
  const actor = makeTestPlayer({ id: 0, x: 12.5, y: 14.5, inventory: cloneItems([{ defId: 'bread', count: 1 }]), money: 0 });

  useItem(actor, 0, state.msgs, state.time, state, 7, world);

  assert.equal(countInventoryItem(actor, 'bread'), 0);
  assert.equal(countInventoryItem(actor, 'water_coupon'), 1);
  const economy = ensureEconomyState(state);
  assert.equal(economy.floors[FloorLevel.KVARTIRY]?.resources.food.stock, 141);
  assert.equal(economy.floors[FloorLevel.KVARTIRY]?.resources.drink_water.stock, 119);
  const event = getRecentEvents(state)[0];
  assert.equal(event.type, 'player_use_item');
  assert.equal(event.severity, 4);
  assert.equal(event.data?.outcome, 'queue_jump_for_coupon');
  assert.equal(event.tags.includes('crowd_risk'), true);
});

test('ration queue item trades are capped per local room window', () => {
  const state = makeGameState({ currentFloor: FloorLevel.KVARTIRY, worldEvents: createWorldEventState() });
  const world = queueWorld();
  const actor = makeTestPlayer({ id: 0, x: 12.5, y: 14.5, inventory: cloneItems([{ defId: 'water', count: 4 }]), money: 0 });

  for (let i = 0; i < 4; i++) {
    state.time = i;
    useItem(actor, 0, state.msgs, state.time, state, 7, world);
  }

  assert.equal(countInventoryItem(actor, 'water'), 1);
  assert.equal(countInventoryItem(actor, 'bread'), 3);
  assert.equal(getRecentEvents(state, { tags: ['ration_queue_trade'] }).length, 3);
  assert.equal(state.msgs[state.msgs.length - 1].text.includes('перестала менять места'), true);
});

test('using a ration stamp pad forges a dangerous ration card', () => {
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY, worldEvents: createWorldEventState() });
  const actor = makeTestPlayer({
    id: 0,
    inventory: cloneItems([{ defId: 'ration_stamp_pad', count: 1 }, { defId: 'blank_form', count: 1 }]),
    money: 0,
  });

  useItem(actor, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(actor, 'ration_stamp_pad'), 0);
  assert.equal(countInventoryItem(actor, 'blank_form'), 0);
  assert.equal(countInventoryItem(actor, 'forged_ration_card'), 1);
  assert.equal(getRecentEvents(state)[0].type, 'ration_coupon_forged');
});

test('reporting a forged ration card resolves the audit into Kvartiry stock', () => {
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY, worldEvents: createWorldEventState() });
  const actor = makeTestPlayer({
    id: 0,
    inventory: cloneItems([{ defId: 'ration_registry_extract', count: 1 }, { defId: 'forged_ration_card', count: 1 }]),
    money: 0,
  });

  useItem(actor, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(actor, 'ration_registry_extract'), 0);
  assert.equal(countInventoryItem(actor, 'forged_ration_card'), 0);
  assert.equal(actor.money, 18);
  const economy = ensureEconomyState(state);
  assert.equal(economy.floors[FloorLevel.KVARTIRY]?.resources.food.stock, 144);
  assert.equal(economy.floors[FloorLevel.KVARTIRY]?.resources.drink_water.stock, 122);
  assert.deepEqual(getRecentEvents(state).slice(0, 2).map(event => event.type), ['ration_audit_resolved', 'ration_coupon_reported']);
});

test('stolen coupon events publish a ration-specific theft consequence', () => {
  const state = makeGameState({ currentFloor: FloorLevel.KVARTIRY, worldEvents: createWorldEventState() });

  publishEvent(state, {
    type: 'item_stolen',
    actorId: 0,
    actorName: 'Вы',
    actorFaction: Faction.PLAYER,
    itemId: 'water_coupon',
    itemName: ITEMS.water_coupon.name,
    itemCount: 2,
    severity: 4,
    privacy: 'local',
    tags: ['container', 'theft'],
  });

  const recent = getRecentEvents(state);
  assert.equal(recent[0].type, 'ration_coupon_stolen');
  assert.equal(recent[0].itemCount, 2);
  const economy = ensureEconomyState(state);
  assert.equal(economy.floors[FloorLevel.KVARTIRY]?.resources.drink_water.stock, 118);
});
