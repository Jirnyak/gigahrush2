import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, Occupation, RoomType } from '../src/core/types';
import { generateNpcTradeItems } from '../src/data/occupation_profiles';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { generateSlimeNiiDesignFloor } from '../src/gen/design_floors/slime_nii';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory } from '../src/systems/inventory';
import { makeTestNpc, makeTestPlayer } from './helpers';

const ITEM_ID = 'glass_ampoule_empty';

test('empty glass ampoule is medical NII sampleware', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Пустая ампула');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.PRODUCTION]);
  assert.equal(def.spawnW, 0.75);
  assert.equal(getStack(def), 12);
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');
  assert.equal(inventoryItemCategory(def.id), 'trade');
  assert.equal(def.value > ITEMS.empty_sample_jar.value, true, 'ampoule glass should cost more than an unofficial jar');

  const documents = RESOURCES.find(resource => resource.id === 'documents');
  assert.equal(documents?.itemIds.includes(def.id), false, 'empty ampoule must not satisfy legal document handoff stock');

  for (const tag of ['sampleware', 'ampoule', 'medical', 'component', 'trade']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `glass_ampoule_empty registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `glass_ampoule_empty item must carry ${tag}`);
  }
  for (const tag of ['sample', 'document', 'official', 'legal_handoff']) {
    assert.equal(ITEM_TAGS[ITEM_ID]?.includes(tag), false, `glass_ampoule_empty registry must not publish ${tag}`);
    assert.equal(def.tags?.includes(tag), false, `glass_ampoule_empty item must not carry ${tag}`);
  }
});

test('empty glass ampoule stays trade goods rather than a usable sample', () => {
  const player = makeTestPlayer();

  assert.equal(addItem(player, ITEM_ID, 1), true);

  const info = getInventorySlotActionInfo(player, 0);
  assert.equal(info?.category, 'trade');
  assert.equal(info?.useLabel, 'Enter нет действия');
  assert.equal(info?.canUse, false);
  assert.equal(info?.sellLabel, 'Справка: базовая цена 14₽');
});

test('slime NII and scientist trade expose empty glass ampoules', () => {
  const gen = generateSlimeNiiDesignFloor();
  const cabinet = gen.world.containers.find(container =>
    container.tags.includes('slime_nii')
    && container.tags.includes('science')
    && container.inventory.some(item => item.defId === ITEM_ID && item.count >= 4),
  );

  assert.ok(cabinet, 'slime_nii director storage should expose glass_ampoule_empty as stealable sampleware');
  assert.equal(cabinet.access, 'owner');

  const savedRandom = Math.random;
  const rolls = [0, (10 + 0.01) / 13, 0];
  Math.random = () => rolls.shift() ?? 0;
  try {
    const npc = makeTestNpc({ occupation: Occupation.SCIENTIST });
    const trade = generateNpcTradeItems(npc);
    assert.ok(trade.some(item => item.defId === ITEM_ID), 'scientists should sell empty glass ampoules');
  } finally {
    Math.random = savedRandom;
  }
});
