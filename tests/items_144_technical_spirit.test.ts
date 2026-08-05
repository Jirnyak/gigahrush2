import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ID = 'technical_spirit';

test('technical spirit is reachable medical fuel contraband', () => {
  const def = ITEMS[ID];

  assert.equal(def.id, ID);
  assert.equal(def.name, 'Технический спирт');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.PRODUCTION]);
  assert.equal(def.spawnW, 0.42);
  assert.equal(def.value, 44);
  assert.equal(def.stack, 4);
  assert.equal(resourceForItem(def.id)?.id, 'medicine');
  assert.equal(inventoryItemCategory(def.id), 'trade');
  assert.ok(RESOURCES.find(resource => resource.id === 'medicine')?.itemIds.includes(ID));
  assert.ok(RESOURCES.find(resource => resource.id === 'fuel')?.itemIds.includes(ID));
  assert.ok(RESOURCES.find(resource => resource.id === 'contraband')?.itemIds.includes(ID));

  for (const tag of ['medical', 'sterilization', 'fuel', 'contraband', 'reagent', 'brewing', 'trade']) {
    assert.ok(ITEM_TAGS[ID]?.includes(tag), `technical spirit registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `technical spirit item must carry ${tag}`);
  }
});

test('technical spirit can be spent as rough sterilization', () => {
  const player = makeTestPlayer({
    hp: 40,
    maxHp: 100,
    needs: { food: 50, water: 30, sleep: 50, pee: 0, poo: 0 },
    inventory: [{ defId: ID, count: 1 }],
  });
  const state = makeGameState({ time: 44 });

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(player.hp, 46);
  assert.equal(player.needs?.water, 25);
  assert.equal(countInventoryItem(player, ID), 0);
  assert.ok(state.msgs.some(line => line.text.includes('Стерилизация +6 HP')));
});
