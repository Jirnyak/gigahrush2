import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { BLACK_MARKET_88_STOCK } from '../src/gen/design_floors/black_market_88';
import { getRecentEvents } from '../src/systems/events';
import { getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ID = 'sleeping_pills';

test('sleeping pills are reachable risky medicine for medical rooms and black market stock', () => {
  const def = ITEMS[ID];

  assert.equal(def.id, ID);
  assert.equal(def.name, 'Снотворное «Попобава»');
  assert.equal(def.type, ItemType.MEDICINE);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.SMOKING]);
  assert.equal(def.spawnW, 0.35);
  assert.equal(def.value, 62);
  assert.equal(resourceForItem(def.id)?.id, 'medicine');
  assert.equal(inventoryItemCategory(def.id), 'medicine');

  assert.ok(RESOURCES.find(resource => resource.id === 'medicine')?.itemIds.includes(ID));
  assert.ok(RESOURCES.find(resource => resource.id === 'contraband')?.itemIds.includes(ID));

  for (const tag of ['medicine', 'sleep', 'forced_rest', 'risk', 'black_market', 'controlled']) {
    assert.ok(ITEM_TAGS[ID]?.includes(tag), `sleeping pills registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `sleeping pills item must carry ${tag}`);
  }

  const stock = BLACK_MARKET_88_STOCK.find(row => row.itemId === ID);
  assert.equal(stock?.traderId, 'market88_marta_broker');
  assert.equal(stock?.lane, 'medicine');
});

test('sleeping pills force rest while spending survival reserves and publishing risk', () => {
  const player = makeTestPlayer({
    id: 138,
    hp: 30,
    maxHp: 100,
    needs: { food: 50, water: 40, sleep: 20, pee: 0, poo: 0 },
    inventory: [{ defId: ID, count: 1 }],
  });
  const state = makeGameState({ time: 138 });

  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter применить');

  useItem(player, 0, state.msgs, state.time, state, 12);

  assert.equal(player.needs?.sleep, 65);
  assert.equal(player.needs?.water, 24);
  assert.equal(player.needs?.food, 42);
  assert.equal(player.hp, 26);
  assert.equal(countInventoryItem(player, ID), 0);
  assert.ok(state.msgs.some(line => line.text.includes('Сон +45')));

  const event = getRecentEvents(state, { type: 'player_use_item', tags: ['forced_rest', 'black_market'], limit: 1 })[0];
  assert.equal(event?.itemId, ID);
  assert.equal(event?.zoneId, 12);
});
