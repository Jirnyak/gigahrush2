import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { DoorState, FloorLevel, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { generateDocumentGate } from '../src/gen/ministry/document_gate';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'rail_switch_order';

test('rail switch order is official rail route access paperwork', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Ордер стрелочного перевода');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.ok(def.spawnRooms.includes(RoomType.PRODUCTION));
  assert.equal(def.spawnW, 0.12);
  assert.equal(def.stack, 2);
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'order', 'official', 'rail', 'transport', 'route_permit', 'access', 'document_gate']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `rail_switch_order registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `rail_switch_order item must carry ${tag}`);
  }

  const player = makeTestPlayer();
  assert.equal(addItem(player, ITEM_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter предъявить');
});

test('rail switch order opens the Ministry N3 service passage without consuming the order', () => {
  const world = new World();
  const entities: Entity[] = [];
  generateDocumentGate(world, 1, entities, { v: 1 }, 512, 512);
  const room = world.rooms.find(item => item?.name === 'Проверочный коридор N3');
  assert.ok(room, 'document gate room must exist');

  const gateDoorIdx = room.doors.find(idx => world.doors.get(idx)?.state === DoorState.LOCKED);
  assert.notEqual(gateDoorIdx, undefined, 'document gate should have a locked internal door');
  const player = makeTestPlayer({
    x: room.x + 8.5,
    y: room.y + Math.floor(room.h / 2) + 0.5,
  });
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY, time: 109 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  useItem(player, 0, state.msgs, state.time, state, undefined, world);

  assert.equal(countInventoryItem(player, ITEM_ID), 1);
  assert.equal(world.doors.get(gateDoorIdx!)?.state, DoorState.OPEN);
  assert.ok(state.msgs.some(line => line.text.includes('Ордер стрелочного перевода открыл')));

  const event = getRecentEvents(state, { type: 'document_gate_access_success', tags: ['legal'], limit: 1 })[0];
  assert.equal(event?.itemId, ITEM_ID);
  assert.equal(event?.data?.method, 'legal');
  assert.equal(event?.data?.legal, true);
  assert.ok((event?.data?.itemTags as string[] | undefined)?.includes('route_permit'));
});

test('rail switch order can be sold instead of saved for route access', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 110 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.equal(player.money, 85);

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['black_market'], limit: 1 })[0];
  assert.equal(sale?.itemId, ITEM_ID);
  assert.equal(sale?.data?.outcome, 'black_market_document_sale');
  assert.equal(sale?.data?.rewardMoney, 85);
});
