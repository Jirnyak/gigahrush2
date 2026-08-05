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

const ITEM_ID = 'ovb_search_warrant';

test('ovb search warrant is rare official HQ access paperwork', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Ордер ОВБ на обыск');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.OFFICE]);
  assert.equal(def.spawnW, 0.06);
  assert.equal(def.stack, 1);
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'warrant', 'ovb', 'official', 'evidence', 'audit', 'access', 'document_gate']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `ovb_search_warrant must publish ${tag}`);
  }
});

test('ovb search warrant can be sold as high-risk document leverage', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 117 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter предъявить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.equal(player.money, 140);
  assert.ok(state.msgs.some(line => line.text.includes('Ордер ОВБ на обыск продан')));

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['black_market', 'audit_risk'], limit: 1 })[0];
  assert.equal(sale?.itemId, ITEM_ID);
  assert.equal(sale?.data?.outcome, 'black_market_document_sale');
});

test('ovb search warrant exposes legal force at Ministry N3', () => {
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
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY, time: 117 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  useItem(player, 0, state.msgs, state.time, state, undefined, world);

  assert.equal(countInventoryItem(player, ITEM_ID), 1);
  assert.equal(world.doors.get(gateDoorIdx!)?.state, DoorState.OPEN);
  assert.ok(state.msgs.some(line => line.text.includes('Ордер ОВБ открыл проход')));

  const event = getRecentEvents(state, { type: 'document_gate_access_success', tags: ['expose', 'evidence'], limit: 1 })[0];
  assert.equal(event?.itemId, ITEM_ID);
  assert.equal(event?.data?.method, 'expose');
  assert.equal(event?.data?.legal, true);
  assert.ok((event?.data?.itemTags as string[] | undefined)?.includes('ovb'));
});
