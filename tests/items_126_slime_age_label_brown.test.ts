import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEMS } from '../src/data/catalog';
import { ITEM_TAGS, getStack } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { generateBrownSlimeCleanup } from '../src/gen/maintenance/brown_slime_cleanup';
import { generateSlimeSamplePost } from '../src/gen/maintenance/slime_sample_post';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const LABEL_ID = 'slime_age_label_brown';

function itemDropIds(entities: readonly Entity[]): string[] {
  return entities.flatMap(entity => entity.inventory?.map(item => item.defId) ?? []);
}

test('brown slime age label is sample paperwork with resource pressure', () => {
  const def = ITEMS[LABEL_ID];

  assert.equal(def.id, LABEL_ID);
  assert.equal(def.name, 'Бирка молодой слизи');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.OFFICE, RoomType.PRODUCTION]);
  assert.equal(def.spawnW, 0.32);
  assert.equal(getStack(def), 8);
  assert.equal(inventoryItemCategory(def.id), 'documents');
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));

  for (const tag of ['document', 'slime', 'age_label', 'brown_slime', 'evidence']) {
    assert.ok(ITEM_TAGS[LABEL_ID]?.includes(tag), `ITEM_TAGS must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `item definition must carry ${tag}`);
  }
});

test('brown slime age label is reachable through cleanup and NII post storage', () => {
  const cleanupWorld = new World();
  const cleanupEntities: Entity[] = [];
  generateBrownSlimeCleanup({
    world: cleanupWorld,
    entities: cleanupEntities,
    nextId: { v: 1 },
    spawnX: 512,
    spawnY: 512,
  });

  assert.ok(
    itemDropIds(cleanupEntities).includes(LABEL_ID),
    'brown slime cleanup room should expose the label beside the sample path',
  );

  const postWorld = new World();
  const postEntities: Entity[] = [];
  generateSlimeSamplePost({
    world: postWorld,
    entities: postEntities,
    nextId: { v: 1 },
    spawnX: 512,
    spawnY: 512,
  });

  const cabinet = postWorld.containers.find(container =>
    container.name === 'Шкаф проб Боковой, форма 728/01-Д'
    && container.access === 'owner'
    && container.inventory.some(item => item.defId === LABEL_ID && item.count === 3),
  );
  assert.ok(cabinet, 'Bokova sample cabinet should expose stealable brown age labels');
});

test('brown slime age label can be sold instead of saved as evidence', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 128 });

  assert.equal(addItem(player, LABEL_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter проверить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, LABEL_ID), 0);
  assert.equal(player.money, 18);
  assert.ok(state.msgs.some(line => line.text.includes('Бирка молодой слизи')));

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['black_market', 'audit_risk'], limit: 1 })[0];
  assert.equal(sale?.itemId, LABEL_ID);
  assert.equal(sale.itemValue, ITEMS[LABEL_ID].value);
  assert.equal(sale.data?.outcome, 'black_market_document_sale');
});
