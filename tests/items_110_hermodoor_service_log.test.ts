import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { CONTRACTS } from '../src/data/contracts';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { generateHospitalQuarantine } from '../src/gen/living/hospital_quarantine';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const SERVICE_LOG_ID = 'hermodoor_journal';

test('hermodoor_service_log is deduped into the existing hermodoor journal', () => {
  assert.equal(ITEMS.hermodoor_service_log, undefined);

  const def = ITEMS[SERVICE_LOG_ID];
  assert.equal(def.id, SERVICE_LOG_ID);
  assert.equal(def.name, 'Журнал обслуживания гермодверей');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE));
  assert.ok(def.spawnRooms.includes(RoomType.PRODUCTION));
  assert.equal(def.stack, 2);
  assert.equal(resourceForItem(def.id)?.id, 'documents');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'hermodoor', 'service_log', 'repair', 'audit', 'maintenance', 'official', 'trade']) {
    assert.ok(ITEM_TAGS[SERVICE_LOG_ID]?.includes(tag), `hermodoor_journal must publish ${tag}`);
  }
});

test('hermodoor journal has theft and black-market document decisions', () => {
  const contract = CONTRACTS.find(item => item.id === 'hospital_hermodoor_journal_theft');
  assert.equal(contract?.targetItem, SERVICE_LOG_ID);
  assert.equal(contract?.target.floor, FloorLevel.LIVING);
  assert.equal(contract?.target.roomType, RoomType.MEDICAL);

  const world = new World();
  const entities: Entity[] = [];
  generateHospitalQuarantine(world, 1, entities, { v: 1 }, 512, 512);

  const source = world.containers.find(container =>
    container.name === 'Картотека зараженных'
    && container.inventory.some(item => item.defId === SERVICE_LOG_ID)
  );
  assert.ok(source, 'hospital quarantine filing cabinet should expose hermodoor_journal');
  assert.equal(source.access, 'faction');
  assert.ok(source.tags.includes('documents'));
  assert.ok(source.tags.includes('violation'));

  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 110 });
  assert.equal(addItem(player, SERVICE_LOG_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter проверить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, SERVICE_LOG_ID), 0);
  assert.equal(player.money, 52);
  assert.ok(state.msgs.some(line => line.text.includes('Журнал обслуживания гермодверей')));

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['black_market'], limit: 1 })[0];
  assert.equal(sale?.itemId, SERVICE_LOG_ID);
  assert.ok(sale.tags.includes('hermodoor'));
  assert.ok(sale.tags.includes('audit_risk'));
  assert.equal(sale.data?.outcome, 'black_market_document_sale');
});
