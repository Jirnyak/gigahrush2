import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, FloorLevel, ItemType, RoomType, type GameState } from '../src/core/types';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { ensureEconomyState } from '../src/systems/economy';
import { getRecentEvents } from '../src/systems/events';
import { getInventorySlotActionInfo, inventoryItemCategory } from '../src/systems/inventory';
import { sellToNpc } from '../src/systems/trade';
import { countInventoryItem, makeGameState, makeTestNpc, makeTestPlayer } from './helpers';

const ITEM_ID = 'water_reservoir_sample';

function resourceStock(state: GameState, floor: FloorLevel, resourceId: string): number {
  const economy = ensureEconomyState(state);
  return economy.floors[floor]?.resources[resourceId]?.stock ?? 0;
}

test('water reservoir sample is reachable water safety evidence', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Проба воды из резервуара');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.BATHROOM, RoomType.KITCHEN, RoomType.PRODUCTION]);
  assert.equal(def.spawnW, 0.45);
  assert.equal(getStack(def), 6);
  assert.equal(inventoryItemCategory(def.id), 'trade');
  assert.equal(resourceForItem(def.id)?.id, 'drink_water');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));

  for (const tag of ['sample', 'water', 'evidence', 'reservoir']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `water_reservoir_sample registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `water_reservoir_sample item must carry ${tag}`);
  }
});

test('water reservoir sample is a save, drop or trade decision', () => {
  const player = makeTestPlayer({ inventory: [{ defId: ITEM_ID, count: 2 }] });
  const info = getInventorySlotActionInfo(player, 0);

  assert.equal(info?.category, 'trade');
  assert.equal(info?.canDrop, true);
  assert.equal(info?.canUse, true);
  assert.equal(info?.useLabel, 'Enter вскрыть пробу');
  assert.equal(info?.sellLabel, 'Справка: базовая цена 38₽/шт · 76₽');
});

test('water reservoir sample sale feeds water economy evidence', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 156 });
  const player = makeTestPlayer({ inventory: [{ defId: ITEM_ID, count: 1 }], money: 0 });
  const buyer = makeTestNpc({
    id: 2,
    name: 'скупщик проб',
    faction: Faction.SCIENTIST,
    inventory: [],
    money: 200,
  });
  const beforeStock = resourceStock(state, FloorLevel.LIVING, 'drink_water');

  const result = sellToNpc(state, player, buyer, 0, { reason: 'water_safety_evidence' });

  assert.equal(result.ok, true);
  assert.equal(result.code, 'sold');
  assert.equal(result.quote?.resourceId, 'drink_water');
  assert.equal(resourceStock(state, FloorLevel.LIVING, 'drink_water'), beforeStock + 1);
  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.equal(countInventoryItem(buyer, ITEM_ID), 1);
  assert.ok((player.money ?? 0) > 0);

  const event = getRecentEvents(state, { type: 'player_sell_item', tags: ['res_drink_water'], limit: 1 })[0];
  assert.equal(event?.itemId, ITEM_ID);
  assert.equal(event?.data?.resourceId, 'drink_water');
});
