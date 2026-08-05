import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';

test('daily_concentrate is merged into the existing grey briquette ration', () => {
  assert.equal(ITEMS.daily_concentrate, undefined);

  const def = ITEMS.grey_briquette;
  assert.equal(def.name, 'Концентрат-беляк');
  assert.equal(def.type, ItemType.FOOD);
  assert.ok(def.spawnRooms.includes(RoomType.KITCHEN));
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE));
  assert.equal(resourceForItem(def.id)?.id, 'food');
  for (const tag of ['concentrate', 'daily_ration']) {
    assert.ok(ITEM_TAGS.grey_briquette?.includes(tag), `grey_briquette must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `grey_briquette item must carry ${tag}`);
  }
});
