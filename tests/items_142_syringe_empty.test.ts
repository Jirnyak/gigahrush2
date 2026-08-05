import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, Occupation, RoomType } from '../src/core/types';
import { generateNpcTradeItems } from '../src/data/occupation_profiles';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { generateSlimeNiiDesignFloor } from '../src/gen/design_floors/slime_nii';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory } from '../src/systems/inventory';
import { makeTestNpc, makeTestPlayer } from './helpers';

const ITEM_ID = 'syringe_empty';

test('empty syringe is reachable medical NII injection component', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Пустой шприц');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.STORAGE]);
  assert.equal(def.spawnW, 0.7);
  assert.equal(def.value, 18);
  assert.equal(getStack(def), 12);
  assert.equal(resourceForItem(def.id)?.id, 'medicine');
  assert.equal(inventoryItemCategory(def.id), 'trade');

  assert.ok(RESOURCES.find(resource => resource.id === 'medicine')?.itemIds.includes(ITEM_ID));
  assert.equal(RESOURCES.find(resource => resource.id === 'slime_samples')?.itemIds.includes(ITEM_ID), false);

  for (const tag of ['medical', 'nii', 'component', 'injection', 'trade']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `syringe_empty registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `syringe_empty item must carry ${tag}`);
  }
  for (const tag of ['sample', 'document', 'official', 'legal_handoff', 'contraband']) {
    assert.equal(ITEM_TAGS[ITEM_ID]?.includes(tag), false, `syringe_empty registry must not publish ${tag}`);
    assert.equal(def.tags?.includes(tag), false, `syringe_empty item must not carry ${tag}`);
  }
});

test('empty syringe is trade goods until serum or poison use exists', () => {
  const player = makeTestPlayer();

  assert.equal(addItem(player, ITEM_ID, 1), true);

  const info = getInventorySlotActionInfo(player, 0);
  assert.equal(info?.category, 'trade');
  assert.equal(info?.useLabel, 'Enter нет действия');
  assert.equal(info?.canUse, false);
  assert.equal(info?.sellLabel, 'Справка: базовая цена 18₽');
});

test('slime NII and scientist trade expose empty syringes', () => {
  const gen = generateSlimeNiiDesignFloor();
  const cabinet = gen.world.containers.find(container =>
    container.tags.includes('slime_nii')
    && container.tags.includes('science')
    && container.inventory.some(item => item.defId === ITEM_ID && item.count >= 6),
  );

  assert.ok(cabinet, 'slime_nii director storage should expose syringe_empty as stealable medical component');
  assert.equal(cabinet.access, 'owner');

  const savedRandom = Math.random;
  const rolls = [0, (13 + 0.01) / 14, 0];
  Math.random = () => rolls.shift() ?? 0;
  try {
    const npc = makeTestNpc({ occupation: Occupation.SCIENTIST });
    const trade = generateNpcTradeItems(npc);
    assert.ok(trade.some(item => item.defId === ITEM_ID), 'scientists should sell empty syringes');
  } finally {
    Math.random = savedRandom;
  }
});
