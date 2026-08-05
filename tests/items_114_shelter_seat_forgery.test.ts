import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'shelter_seat_forgery';

test('shelter seat forgery is a reachable forged shelter document', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Поддельная карточка укрытия');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.SMOKING, RoomType.OFFICE, RoomType.COMMON]);
  assert.equal(def.spawnW, 0.2);
  assert.equal(def.stack, 4);
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.ok(RESOURCES.find(resource => resource.id === 'contraband')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'shelter', 'permit', 'forged', 'forgery', 'contraband', 'audit']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `shelter_seat_forgery must publish ${tag}`);
  }
});

test('shelter seat forgery can be presented at living-block shelter queues', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 114 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter предъявить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.equal(player.money ?? 0, 0);
  assert.ok(state.msgs.some(line => line.text.includes('Липовая карточка укрытия')));

  const event = getRecentEvents(state, { type: 'player_handoff_item', tags: ['forgery'], limit: 1 })[0];
  assert.equal(event?.itemId, ITEM_ID);
  assert.equal(event?.targetName, 'очередь у гермодвери');
  assert.equal(event?.data?.outcome, 'shelter_forgery_presented');
});
