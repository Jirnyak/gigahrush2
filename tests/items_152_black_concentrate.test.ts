import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';

test('black_concentrate is merged into the closed-issue liquidator ration', () => {
  assert.equal(ITEMS.black_concentrate, undefined);

  const def = ITEMS.liquidator_ration;
  assert.equal(def.name, 'Черный сухпай ликвидатора');
  assert.equal(def.type, ItemType.FOOD);
  assert.deepEqual(def.spawnRooms, [RoomType.STORAGE, RoomType.HQ]);
  assert.equal(resourceForItem(def.id)?.id, 'food');
  assert.equal(def.value > ITEMS.grey_briquette.value, true);
  for (const tag of ['concentrate', 'nutritious_concentrate', 'black_concentrate', 'field_ration', 'closed_issue', 'liquidator']) {
    assert.ok(ITEM_TAGS.liquidator_ration?.includes(tag), `liquidator_ration must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `liquidator_ration item must carry ${tag}`);
  }
});
