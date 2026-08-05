import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'shelter_seat_card';

test('shelter seat card is an official reachable shelter document', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Карточка места в укрытии');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.COMMON));
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.equal(def.stack, 4);
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'shelter', 'shelter_tally', 'permit', 'official', 'access', 'samosbor']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `shelter_seat_card must publish ${tag}`);
  }
});

test('shelter seat card can be handed to shelter seniors in the living block', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 113 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter предъявить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.ok(state.msgs.some(line => line.text.includes('Карточка места сдана')));

  const event = getRecentEvents(state, { type: 'player_handoff_item', tags: ['shelter'], limit: 1 })[0];
  assert.equal(event?.itemId, ITEM_ID);
  assert.equal(event.privacy, 'witnessed');
  assert.equal(event.data?.outcome, 'shelter_seat_registered');
  assert.ok(event.tags.includes('samosbor'));
  assert.ok(event.tags.includes('official'));
});

test('shelter seat card is not spent outside living shelter floors', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY, time: 114 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, ITEM_ID), 1);
  assert.ok(state.msgs.some(line => line.text.includes('здесь нет нужного окна выдачи')));
  assert.equal(getRecentEvents(state, { type: 'player_handoff_item', limit: 1 }).length, 0);
});
