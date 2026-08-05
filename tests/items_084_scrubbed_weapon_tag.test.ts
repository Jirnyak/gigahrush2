import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, FloorLevel, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

test('scrubbed weapon tag is black-market contraband paperwork', () => {
  const def = ITEMS.scrubbed_weapon_tag;

  assert.equal(def.id, 'scrubbed_weapon_tag');
  assert.equal(def.name, 'Сбитая оружейная бирка');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.SMOKING));
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE));
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.ok(RESOURCES.find(resource => resource.id === 'contraband')?.itemIds.includes(def.id));
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'weapon_permit', 'contraband', 'audit', 'forgery']) {
    assert.ok(ITEM_TAGS.scrubbed_weapon_tag?.includes(tag), `scrubbed_weapon_tag must publish ${tag}`);
  }
});

test('scrubbed weapon tag is reachable through black-market stash pools', () => {
  const secretStashIds = new Set(CONTAINER_DEFS[ContainerKind.SECRET_STASH].itemPool.map(item => item.defId));

  assert.ok(secretStashIds.has('scrubbed_weapon_tag'));
});

test('scrubbed weapon tag can be sold as audit-risk contraband in the living block', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 84 });

  assert.equal(addItem(player, 'scrubbed_weapon_tag', 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter проверить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, 'scrubbed_weapon_tag'), 0);
  assert.equal(player.money, 46);
  assert.ok(state.msgs.some(line => line.text.includes('Сбитая оружейная бирка')));

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['contraband', 'audit_risk'], limit: 1 })[0];
  assert.equal(sale?.itemId, 'scrubbed_weapon_tag');
  assert.ok(sale.tags.includes('black_market'));
  assert.equal(sale.data?.outcome, 'black_market_document_sale');
});
