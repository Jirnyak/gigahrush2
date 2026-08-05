import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateSlimeNiiDesignFloor } from '../src/gen/design_floors/slime_nii';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const SWAB_ID = 'contaminated_swab';

test('contaminated swab is low-value failed sample evidence', () => {
  const def = ITEMS[SWAB_ID];

  assert.equal(def.id, SWAB_ID);
  assert.equal(def.name, 'Загрязнённый мазок');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.STORAGE, RoomType.SMOKING]);
  assert.equal(def.spawnW, 0.45);
  assert.equal(def.value, 5);
  assert.equal(getStack(def), 12);
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');
  assert.equal(inventoryItemCategory(def.id), 'trade');

  for (const tag of ['sample', 'swab', 'contaminated', 'failed_sample', 'evidence', 'trade', 'audit']) {
    assert.ok(ITEM_TAGS[SWAB_ID]?.includes(tag), `contaminated_swab registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `contaminated_swab item must carry ${tag}`);
  }
});

test('contaminated swab is reachable beside failed handling in slime NII', () => {
  const gen = generateSlimeNiiDesignFloor();

  const failedCamera = gen.world.containers.find(container =>
    container.tags.includes('slime_nii')
    && container.tags.includes('camera')
    && container.inventory.some(item => item.defId === 'slime_sample_contaminated')
    && container.inventory.some(item => item.defId === SWAB_ID),
  );

  assert.ok(failedCamera, 'slime_nii failed sample camera should expose contaminated_swab');
  assert.equal(failedCamera.access, 'locked');
});

test('contaminated swab can be reported or sold from inventory', () => {
  const reporter = makeTestPlayer();
  const ministry = makeGameState({ currentFloor: FloorLevel.MINISTRY, time: 122 });

  assert.equal(addItem(reporter, SWAB_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(reporter, 0)?.useLabel, 'Enter сдать/сбыть');

  useItem(reporter, 0, ministry.msgs, ministry.time, ministry);

  assert.equal(countInventoryItem(reporter, SWAB_ID), 0);
  assert.equal(reporter.money, 8);
  const report = getRecentEvents(ministry, { type: 'player_handoff_item', tags: ['failed_sample', 'report'], limit: 1 })[0];
  assert.equal(report?.itemId, SWAB_ID);
  assert.equal(report?.data?.outcome, 'contaminated_swab_reported');

  const seller = makeTestPlayer();
  const living = makeGameState({ currentFloor: FloorLevel.LIVING, time: 123 });

  assert.equal(addItem(seller, SWAB_ID, 1), true);
  useItem(seller, 0, living.msgs, living.time, living);

  assert.equal(countInventoryItem(seller, SWAB_ID), 0);
  assert.equal(seller.money, 6);
  const sale = getRecentEvents(living, { type: 'player_sell_item', tags: ['failed_sample', 'black_market'], limit: 1 })[0];
  assert.equal(sale?.itemId, SWAB_ID);
  assert.equal(sale?.data?.outcome, 'contaminated_swab_sold');
});
