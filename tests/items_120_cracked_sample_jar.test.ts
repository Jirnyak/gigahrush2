import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory } from '../src/systems/inventory';
import { makeTestPlayer } from './helpers';

const ITEM_ID = 'cracked_sample_jar';

test('cracked sample jar is bad low-value sampleware', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Треснувшая банка для пробы');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.STORAGE, RoomType.PRODUCTION, RoomType.BATHROOM]);
  assert.equal(def.spawnW, 0.5);
  assert.equal(def.value, 3);
  assert.equal(getStack(def), 6);
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');
  assert.equal(inventoryItemCategory(def.id), 'trade');
  assert.equal(def.value < ITEMS.empty_sample_jar.value, true, 'cracked jar must be worse than clean unofficial sampleware');
  assert.equal(def.value < ITEMS.nii_sample_container.value, true, 'cracked jar must be far below official NII sampleware');

  const documents = RESOURCES.find(resource => resource.id === 'documents');
  assert.equal(documents?.itemIds.includes(def.id), false, 'cracked jar must not satisfy legal document handoff stock');

  for (const tag of ['sampleware', 'container', 'damaged', 'contaminant', 'aftermath', 'trade']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `cracked_sample_jar registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `cracked_sample_jar item must carry ${tag}`);
  }
  for (const tag of ['sample', 'official', 'document', 'legal_handoff']) {
    assert.equal(ITEM_TAGS[ITEM_ID]?.includes(tag), false, `cracked_sample_jar registry must not publish ${tag}`);
    assert.equal(def.tags?.includes(tag), false, `cracked_sample_jar item must not carry ${tag}`);
  }
});

test('cracked sample jar is a sell/drop decision, not a usable sample', () => {
  const player = makeTestPlayer();

  assert.equal(addItem(player, ITEM_ID, 1), true);

  const info = getInventorySlotActionInfo(player, 0);
  assert.equal(info?.category, 'trade');
  assert.equal(info?.useLabel, 'Enter нет действия');
  assert.equal(info?.canUse, false);
  assert.equal(info?.canDrop, true);
  assert.equal(info?.sellLabel, 'Справка: базовая цена 3₽');
});
