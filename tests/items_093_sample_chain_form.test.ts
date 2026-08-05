import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEMS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { generateSlimeNiiDesignFloor } from '../src/gen/design_floors/slime_nii';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const FORM_ID = 'sample_chain_form';

test('sample chain form is NII chain-of-custody paperwork', () => {
  const def = ITEMS[FORM_ID];

  assert.equal(def.id, FORM_ID);
  assert.equal(def.name, 'Бланк цепочки пробы');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.OFFICE, RoomType.HQ]);
  assert.equal(def.stack, 6);
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');
  assert.equal(inventoryItemCategory(def.id), 'documents');

  const byId = Object.fromEntries(RESOURCES.map(resource => [resource.id, resource]));
  assert.equal(byId.paper.itemIds.includes(def.id), false, 'sample form is tracked as sample handoff stock, not generic paper');
  assert.ok(byId.documents.itemIds.includes(def.id), 'sample form must pressure document supply');
  assert.ok(byId.slime_samples.itemIds.includes(def.id), 'sample form must pressure sample handoff supply');

  for (const tag of ['document', 'sample_form', 'chain_of_custody', 'nii', 'legal_handoff', 'official', 'audit']) {
    assert.ok(ITEM_TAGS[FORM_ID]?.includes(tag), `sample_chain_form registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `sample_chain_form item must carry ${tag}`);
  }
  assert.equal(ITEM_TAGS[FORM_ID]?.includes('sample'), false, 'paper form must not be treated as an opened sample');
});

test('sample chain form is reachable from the slime NII director archive', () => {
  const gen = generateSlimeNiiDesignFloor();

  const source = gen.world.containers.find(container =>
    container.tags.includes('slime_nii') &&
    container.tags.includes('documents') &&
    container.inventory.some(item => item.defId === FORM_ID && item.count >= 2)
  );

  assert.ok(source, 'slime NII document cabinet should expose sample_chain_form');
});

test('sample chain form can be sold instead of saved for legal handoff', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 93 });

  assert.equal(addItem(player, FORM_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter проверить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, FORM_ID), 0);
  assert.equal(player.money, 34);
  assert.ok(state.msgs.some(line => line.text.includes('Бланк цепочки пробы')));

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['black_market', 'audit_risk'], limit: 1 })[0];
  assert.equal(sale?.itemId, FORM_ID);
  assert.equal(sale.data?.outcome, 'black_market_document_sale');
});
