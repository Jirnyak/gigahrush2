import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, FloorLevel, ItemType, RoomType } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { generateLiquidatorArchive } from '../src/gen/ministry/liquidator_archive';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'confiscation_tag';

test('confiscation tag is liquidator evidence paperwork', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Бирка конфиската');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.OFFICE]);
  assert.equal(def.spawnW, 0.35);
  assert.equal(def.stack, 6);
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.ok(RESOURCES.find(resource => resource.id === 'contraband')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'confiscation', 'evidence', 'audit', 'liquidator']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `confiscation_tag registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `confiscation_tag item must carry ${tag}`);
  }
});

test('confiscation tag is reachable in the Ministry liquidator archive', () => {
  const world = new World();
  generateLiquidatorArchive(world, 0, [], { v: 1 }, 512, 512);

  const source = world.containers.find(container =>
    container.tags.includes('liquidator_archive')
    && container.tags.includes('audit')
    && container.inventory.some(item => item.defId === ITEM_ID),
  );

  assert.ok(source, 'liquidator archive should expose confiscation_tag');
  assert.equal(source.faction, Faction.LIQUIDATOR);
  assert.equal(source.access, 'faction');
});

test('confiscation tag can be sold as black-market audit evidence', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 91 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter проверить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.equal(player.money, 36);
  assert.ok(state.msgs.some(line => line.text.includes('Бирка конфиската')));

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['confiscation', 'audit_risk'], limit: 1 })[0];
  assert.equal(sale?.itemId, ITEM_ID);
  assert.ok(sale.tags.includes('black_market'));
  assert.equal(sale.data?.outcome, 'black_market_document_sale');
});
