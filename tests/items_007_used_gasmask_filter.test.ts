import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { addItem, getInventorySlotActionInfo, useItem } from '../src/systems/inventory';
import { getRecentEvents } from '../src/systems/events';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

test('used gasmask filter is cheap contamination evidence produced outside loot tables', () => {
  const def = ITEMS.used_gasmask_filter;

  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(def.spawnW, 0);
  assert.equal(def.stack, 6);
  assert.equal(def.value < ITEMS.gasmask_filter.value, true);
  assert.equal(resourceForItem(def.id), undefined, 'spent contaminated waste is not a stock resource input');

  for (const tag of ['filter', 'gasmask', 'evidence', 'contaminant', 'audit', 'trade']) {
    assert.ok(ITEM_TAGS.used_gasmask_filter?.includes(tag), `used_gasmask_filter must publish ${tag} tag`);
  }
  assert.ok(ITEM_TAGS.gasmask_filter?.includes('ppe'), 'clean filter should be marked as PPE');
});

test('using a clean gasmask filter turns it into used evidence and publishes audit tags', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ time: 12 });

  assert.equal(addItem(player, 'gasmask_filter', 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter отработать');

  useItem(player, 0, state.msgs, 12, state, 7);

  assert.equal(countInventoryItem(player, 'gasmask_filter'), 0);
  assert.equal(countInventoryItem(player, 'used_gasmask_filter'), 1);
  assert.ok(state.msgs.some(line => line.text.includes('мокрая улика')));

  const event = getRecentEvents(state, { type: 'player_use_item', tags: ['gasmask', 'audit'], limit: 1 })[0];
  assert.equal(event?.itemId, 'gasmask_filter');
  assert.equal(event.data?.producedItemId, 'used_gasmask_filter');
});

test('using one filter from a stack leaves the remaining clean filters intact', () => {
  const player = makeTestPlayer({ inventory: [{ defId: 'gasmask_filter', count: 2 }] });
  const state = makeGameState({ time: 15 });

  useItem(player, 0, state.msgs, 15, state);

  assert.equal(countInventoryItem(player, 'gasmask_filter'), 1);
  assert.equal(countInventoryItem(player, 'used_gasmask_filter'), 1);
});
