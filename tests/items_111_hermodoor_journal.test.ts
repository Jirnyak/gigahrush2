import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { generateHospitalQuarantine } from '../src/gen/living/hospital_quarantine';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'hermodoor_journal';

test('hermodoor journal is a tagged service document with document economy pressure', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Журнал обслуживания гермодверей');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.MEDICAL));
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE));
  assert.ok(def.spawnRooms.includes(RoomType.PRODUCTION));
  assert.equal(def.stack, 2);
  assert.equal(resourceForItem(def.id)?.id, 'documents');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'hermodoor', 'service_log', 'repair', 'audit', 'maintenance', 'official', 'trade']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `hermodoor_journal registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `hermodoor_journal item must carry ${tag}`);
  }
});

test('hermodoor journal is reachable from the hospital quarantine filing cabinet', () => {
  const world = new World();
  const entities: Entity[] = [];
  generateHospitalQuarantine(world, 1, entities, { v: 1 }, 512, 512);

  const source = world.containers.find(container =>
    container.name === 'Картотека зараженных'
    && container.inventory.some(item => item.defId === ITEM_ID)
  );

  assert.ok(source, 'hospital quarantine filing cabinet should expose hermodoor_journal');
  assert.equal(source.access, 'faction');
  assert.ok(source.tags.includes('documents'));
  assert.ok(source.tags.includes('violation'));
});

test('hermodoor journal can be sold as door audit evidence in the living block', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 111 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter проверить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.equal(player.money, 52);
  assert.ok(state.msgs.some(line => line.text.includes('Журнал обслуживания гермодверей')));

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['hermodoor'], limit: 1 })[0];
  assert.equal(sale?.itemId, ITEM_ID);
  assert.ok(sale.tags.includes('black_market'));
  assert.ok(sale.tags.includes('trade'));
  assert.equal(sale.data?.outcome, 'black_market_document_sale');
});
