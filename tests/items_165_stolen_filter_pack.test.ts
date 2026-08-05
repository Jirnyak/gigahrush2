import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import {
  BLACK_MARKET_88_STOCK,
  applyBlackMarket88Purchase,
  createBlackMarket88DesignState,
  quoteBlackMarket88Purchase,
} from '../src/gen/design_floors/black_market_88';
import { getRecentEvents } from '../src/systems/events';
import { addItem, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'stolen_filter_pack';

test('stolen filter pack is cheap contraband PPE supply', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Краденая пачка фильтров');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.STORAGE, RoomType.HQ, RoomType.SMOKING]);
  assert.equal(def.spawnW, 0.35);
  assert.equal(def.stack, 3);
  assert.equal(def.value < ITEMS.gasmask_filter.value * 2, true, 'pack should undercut two clean filters before market heat');
  assert.equal(resourceForItem(def.id)?.id, 'contraband');
  assert.equal(inventoryItemCategory(def.id), 'trade');

  for (const tag of ['filter', 'gasmask', 'ppe', 'contraband', 'stolen', 'black_market', 'audit']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `item must carry ${tag}`);
  }
});

test('stolen filter pack is buyable at Black Market 88 and stealable from secret stashes', () => {
  const offer = BLACK_MARKET_88_STOCK.find(row => row.itemId === ITEM_ID);
  assert.ok(offer, 'Black Market 88 should sell stolen filters');
  assert.equal(offer.lane, 'survival');
  assert.equal(offer.heatDelta > 0, true, 'buying stolen filters should increase market heat');

  const state = createBlackMarket88DesignState();
  const quote = quoteBlackMarket88Purchase(state, offer.id, 1.1, 0);
  assert.equal(quote?.itemId, ITEM_ID);
  assert.equal(quote?.locked, false);

  const heatBefore = state.heat;
  const result = applyBlackMarket88Purchase(state, offer.id, 0);
  assert.equal(result.ok, true);
  assert.equal(state.stock[offer.id], offer.count - 1);
  assert.equal(state.heat > heatBefore, true);

  const stash = CONTAINER_DEFS[ContainerKind.SECRET_STASH].itemPool.find(row => row.defId === ITEM_ID);
  assert.ok(stash, 'generic stolen crates/secret stashes should expose stolen filters');
  assert.equal(stash.min, 1);
  assert.equal(stash.max, 1);
});

test('using a stolen filter pack unpacks clean filters and publishes audit risk', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ time: 165 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.equal(countInventoryItem(player, 'gasmask_filter'), 2);
  assert.ok(state.msgs.some(line => line.text.includes('два сухих фильтра')));

  const event = getRecentEvents(state, { type: 'player_use_item', tags: ['contraband', 'audit'], limit: 1 })[0];
  assert.equal(event?.itemId, ITEM_ID);
  assert.ok(event.tags.includes('black_market'));
});
