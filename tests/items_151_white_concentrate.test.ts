import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';

test('white_concentrate is merged into the existing grey briquette ration', () => {
  assert.equal(ITEMS.white_concentrate, undefined);

  const def = ITEMS.grey_briquette;
  assert.equal(def.name, 'Концентрат-беляк');
  assert.equal(def.type, ItemType.FOOD);
  assert.equal(resourceForItem(def.id)?.id, 'food');
  assert.equal(def.value < ITEMS.red_concentrate.value, true);
  assert.equal(def.value < ITEMS.liquidator_ration.value, true);
  for (const tag of ['bait_starch', 'concentrate', 'daily_ration']) {
    assert.ok(ITEM_TAGS.grey_briquette?.includes(tag), `grey_briquette must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `grey_briquette item must carry ${tag}`);
  }
});
