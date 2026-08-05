import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, Occupation, RoomType } from '../src/core/types';
import { generateNpcTradeItems } from '../src/data/occupation_profiles';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory } from '../src/systems/inventory';
import { makeTestNpc, makeTestPlayer } from './helpers';

const ITEM_ID = 'empty_sample_jar';

test('empty sample jar is cheap unofficial sampleware', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Пустая банка для пробы');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.MEDICAL), 'medical rooms must expose cheap sampleware');
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE), 'storage rooms must expose cheap sampleware');
  assert.equal(def.spawnW > 0, true);
  assert.equal(getStack(def), 6);
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');
  assert.equal(inventoryItemCategory(def.id), 'trade');
  assert.equal(def.value < ITEMS.nii_sample_container.value, true, 'unofficial jar must undercut official NII sampleware');

  const documents = RESOURCES.find(resource => resource.id === 'documents');
  assert.equal(documents?.itemIds.includes(def.id), false, 'unofficial jar must not satisfy legal document handoff stock');

  for (const tag of ['sampleware', 'container', 'unofficial', 'trade']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `empty_sample_jar registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `empty_sample_jar item must carry ${tag}`);
  }
  for (const tag of ['sample', 'official', 'document', 'legal_handoff']) {
    assert.equal(ITEM_TAGS[ITEM_ID]?.includes(tag), false, `empty_sample_jar registry must not publish ${tag}`);
    assert.equal(def.tags?.includes(tag), false, `empty_sample_jar item must not carry ${tag}`);
  }
});

test('empty sample jar stays trade goods rather than a usable sample', () => {
  const player = makeTestPlayer();

  assert.equal(addItem(player, ITEM_ID, 1), true);

  const info = getInventorySlotActionInfo(player, 0);
  assert.equal(info?.category, 'trade');
  assert.equal(info?.useLabel, 'Enter нет действия');
  assert.equal(info?.canUse, false);
  assert.equal(info?.sellLabel, 'Справка: базовая цена 12₽');
});

test('scientist trade can expose empty sample jars', () => {
  const savedRandom = Math.random;
  const rolls = [0, (6 + 0.01) / 13, 0];
  Math.random = () => rolls.shift() ?? 0;
  try {
    const npc = makeTestNpc({ occupation: Occupation.SCIENTIST });
    const trade = generateNpcTradeItems(npc);
    assert.ok(trade.some(item => item.defId === ITEM_ID), 'scientists should sell cheap unofficial sampleware');
  } finally {
    Math.random = savedRandom;
  }
});
