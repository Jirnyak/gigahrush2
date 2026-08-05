import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { generateSlimeNiiDesignFloor } from '../src/gen/design_floors/slime_nii';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ACT_ID = 'contaminated_sample_act';

test('contaminated sample act is NII failure evidence in the sample economy', () => {
  const def = ITEMS[ACT_ID];

  assert.equal(def.id, ACT_ID);
  assert.equal(def.name, 'Акт испорченной пробы');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.OFFICE]);
  assert.equal(def.spawnW, 0.24);
  assert.equal(getStack(def), 3);
  assert.equal(inventoryItemCategory(def.id), 'documents');
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));

  for (const tag of ['document', 'nii', 'sample', 'contaminated', 'evidence', 'audit']) {
    assert.ok(ITEM_TAGS[ACT_ID]?.includes(tag), `contaminated_sample_act registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `contaminated_sample_act item must carry ${tag}`);
  }
});

test('contaminated sample act is reachable beside failed handling in slime NII', () => {
  const gen = generateSlimeNiiDesignFloor();

  const cameraCabinet = gen.world.containers.find(container =>
    container.tags.includes('slime_nii')
    && container.tags.includes('camera')
    && container.inventory.some(item => item.defId === 'slime_sample_contaminated')
    && container.inventory.some(item => item.defId === ACT_ID),
  );

  assert.ok(cameraCabinet, 'slime_nii should expose contaminated_sample_act beside a contaminated sample camera');
  assert.equal(cameraCabinet.access, 'locked');
});

test('contaminated sample act can be sold as audit-risk sample evidence', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 95 });

  assert.equal(addItem(player, ACT_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter проверить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, ACT_ID), 0);
  assert.equal(player.money, 45);
  assert.ok(state.msgs.some(line => line.text.includes('Акт испорченной пробы')));

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['audit_risk'], limit: 1 })[0];
  assert.equal(sale?.itemId, ACT_ID);
  assert.ok(sale.tags.includes('black_market'));
  assert.ok(sale.tags.includes('nii'));
  assert.equal(sale.data?.outcome, 'black_market_document_sale');
});
