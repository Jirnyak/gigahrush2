import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { generateSlimeNiiDesignFloor } from '../src/gen/design_floors/slime_nii';
import { getInventorySlotActionInfo, inventoryItemCategory } from '../src/systems/inventory';
import { makeTestPlayer } from './helpers';

const GAS_SAMPLE_ID = 'gas_sample_ampoule';

test('gas sample ampoule is NII gas evidence in the sample economy', () => {
  const def = ITEMS[GAS_SAMPLE_ID];

  assert.equal(def.id, GAS_SAMPLE_ID);
  assert.equal(def.name, 'Ампула газовой пробы');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.PRODUCTION, RoomType.HQ]);
  assert.equal(def.spawnW, 0.16);
  assert.equal(getStack(def), 3);
  assert.equal(inventoryItemCategory(def.id), 'trade');
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');
  assert.equal(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id), false);

  for (const tag of ['sample', 'ampoule', 'gas', 'nii', 'evidence']) {
    assert.ok(ITEM_TAGS[GAS_SAMPLE_ID]?.includes(tag), `gas_sample_ampoule registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `gas_sample_ampoule item must carry ${tag}`);
  }
});

test('gas sample ampoule is stealable from the slime NII cold storage', () => {
  const gen = generateSlimeNiiDesignFloor();

  const cabinet = gen.world.containers.find(container =>
    container.tags.includes('slime_nii')
    && container.tags.includes('cold_storage')
    && container.inventory.some(item => item.defId === GAS_SAMPLE_ID && item.count === 1),
  );

  assert.ok(cabinet, 'slime_nii should expose gas_sample_ampoule through locked cold storage');
  assert.equal(cabinet.access, 'locked');
});

test('gas sample ampoule is a trade item to save or move through NPC barter', () => {
  const player = makeTestPlayer({ inventory: [{ defId: GAS_SAMPLE_ID, count: 1 }] });
  const info = getInventorySlotActionInfo(player, 0);

  assert.equal(info?.category, 'trade');
  assert.equal(info?.sellLabel, 'Справка: базовая цена 165₽');
  assert.equal(info?.canDrop, true);
  assert.equal(info?.canUse, true);
  assert.equal(info?.useLabel, 'Enter вскрыть пробу');
});
