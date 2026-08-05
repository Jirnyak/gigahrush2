import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { ITEMS, ITEM_TAGS } from '../src/data/items';
import { RESOURCE_BY_ID, resourceForItem } from '../src/data/resources';
import { BLACK_MARKET_88_STOCK } from '../src/gen/design_floors/black_market_88';

const ITEM_ID = 'moonshine_still_part';

test('moonshine still part is a contraband production input', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Деталь самогонного аппарата');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.PRODUCTION, RoomType.KITCHEN, RoomType.SMOKING]);
  assert.equal(def.spawnW, 0.18);
  assert.equal(def.value, 125);
  assert.equal(def.stack, 2);

  for (const tag of ['brewing', 'contraband', 'production', 'factory_input', 'black_market', 'trade']) {
    assert.ok(def.tags?.includes(tag), `item must carry ${tag}`);
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `tag registry must publish ${tag}`);
  }

  assert.equal(resourceForItem(ITEM_ID)?.id, 'contraband');
  assert.ok(RESOURCE_BY_ID.industrial_slurry.itemIds.includes(ITEM_ID));
});

test('moonshine still part is reachable through theft and Black Market 88', () => {
  assert.ok(
    CONTAINER_DEFS[ContainerKind.SECRET_STASH].itemPool.some(entry => entry.defId === ITEM_ID),
    'secret stashes must expose the steal path',
  );

  const offer = BLACK_MARKET_88_STOCK.find(row => row.itemId === ITEM_ID);
  assert.ok(offer, 'Black Market 88 must sell the still part');
  assert.equal(offer.lane, 'access');
  assert.ok(offer.maxPrice > ITEMS[ITEM_ID].value);
  assert.ok(offer.heatDelta > 0);
});
