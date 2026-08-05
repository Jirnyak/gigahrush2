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
import { inventoryItemCategory } from '../src/systems/inventory';

const ITEM_ID = 'aerosol_paint_maiden';
const MARKET_OFFER_ID = 'market88.purchase.maiden_paint_can';

test('aerosol paint maiden is a contraband mark good', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Аэрозольная краска «цвет девства»');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.STORAGE, RoomType.SMOKING, RoomType.PRODUCTION]);
  assert.equal(def.spawnW, 0.2);
  assert.equal(def.stack, 3);
  assert.equal(resourceForItem(def.id)?.id, 'contraband');
  assert.equal(inventoryItemCategory(def.id), 'trade');

  for (const tag of ['paint', 'contraband', 'mark', 'black_market', 'audit', 'trade']) {
    assert.ok(def.tags?.includes(tag), `item must carry ${tag}`);
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `registry must publish ${tag}`);
  }
});

test('aerosol paint maiden is buyable at Black Market 88 and stealable from stashes', () => {
  const offer = BLACK_MARKET_88_STOCK.find(row => row.id === MARKET_OFFER_ID);

  assert.ok(offer, 'Black Market 88 should sell the contraband paint');
  assert.equal(offer.itemId, ITEM_ID);
  assert.equal(offer.lane, 'access');
  assert.equal(offer.traderId, 'market88_zlata_silence');
  assert.equal(offer.count, 2);
  assert.equal(offer.heatDelta > 0, true);

  const state = createBlackMarket88DesignState();
  const quote = quoteBlackMarket88Purchase(state, MARKET_OFFER_ID, 1.15, 0);
  assert.equal(quote?.itemId, ITEM_ID);
  assert.equal(quote?.stock, 2);
  assert.equal(quote?.locked, false);

  const heatBefore = state.heat;
  const result = applyBlackMarket88Purchase(state, MARKET_OFFER_ID, 0);
  assert.equal(result.ok, true);
  assert.equal(state.stock[MARKET_OFFER_ID], 1);
  assert.equal(state.heat > heatBefore, true);

  const stash = CONTAINER_DEFS[ContainerKind.SECRET_STASH].itemPool.find(row => row.defId === ITEM_ID);
  assert.ok(stash, 'secret stashes should expose a stealable paint can');
  assert.equal(stash.min, 1);
  assert.equal(stash.max, 1);
});
