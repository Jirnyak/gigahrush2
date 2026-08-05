import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEMS } from '../src/data/catalog';
import { ITEM_TAGS, getStack } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { generateSlimeNiiDesignFloor } from '../src/gen/design_floors/slime_nii';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const LABEL_ID = 'slime_age_label_orange';

test('orange slime age label is dangerous NII cleanup evidence', () => {
  const def = ITEMS[LABEL_ID];

  assert.equal(def.id, LABEL_ID);
  assert.equal(def.name, 'Бирка подростковой слизи');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.OFFICE, RoomType.PRODUCTION]);
  assert.equal(def.spawnW, 0.2);
  assert.equal(getStack(def), 8);
  assert.equal(inventoryItemCategory(def.id), 'documents');
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));

  for (const tag of ['document', 'slime', 'age_label', 'orange_slime', 'evidence', 'nii', 'cleanup', 'audit']) {
    assert.ok(ITEM_TAGS[LABEL_ID]?.includes(tag), `slime_age_label_orange registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `slime_age_label_orange item must carry ${tag}`);
  }
});

test('orange slime age label is stealable from a locked slime NII camera', () => {
  const gen = generateSlimeNiiDesignFloor();

  const camera = gen.world.containers.find(container =>
    container.tags.includes('slime_nii')
    && container.tags.includes('camera')
    && container.inventory.some(item => item.defId === 'slime_sample_contaminated')
    && container.inventory.some(item => item.defId === LABEL_ID),
  );

  assert.ok(camera, 'slime_nii should expose slime_age_label_orange beside a dangerous sample camera');
  assert.equal(camera.access, 'locked');
  assert.equal(camera.inventory.find(item => item.defId === LABEL_ID)?.count, 1);
});

test('orange slime age label can be sold instead of saved as evidence', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 127 });

  assert.equal(addItem(player, LABEL_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter проверить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, LABEL_ID), 0);
  assert.equal(player.money, 38);
  assert.ok(state.msgs.some(line => line.text.includes('Бирка подростковой слизи')));

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['black_market', 'audit_risk'], limit: 1 })[0];
  assert.equal(sale?.itemId, LABEL_ID);
  assert.equal(sale.data?.outcome, 'black_market_document_sale');
});
