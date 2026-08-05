import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, FloorLevel, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { DOCUMENT_ACCESS_MARKET_VALUES } from '../src/data/documents_access';
import { FACTORY_BY_ID, productionRouteGoals } from '../src/data/factories';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { WEAPON_STATS } from '../src/data/catalog';
import { BLACK_MARKET_88_STOCK } from '../src/gen/design_floors/black_market_88';
import { getRecentEvents } from '../src/systems/events';
import { getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'weapon_blueprint_t2';

test('weapon blueprint t2 is a contraband armory document token', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Чертёж оружия Т2');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.OFFICE, RoomType.STORAGE]);
  assert.equal(def.spawnW, 0.18);
  assert.equal(def.stack, 1);
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.equal(inventoryItemCategory(def.id), 'documents');
  assert.equal(DOCUMENT_ACCESS_MARKET_VALUES[ITEM_ID], 210);
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.ok(RESOURCES.find(resource => resource.id === 'contraband')?.itemIds.includes(def.id));

  const actionInfo = getInventorySlotActionInfo(makeTestPlayer({ inventory: [{ defId: ITEM_ID, count: 1 }] }), 0);
  assert.equal(actionInfo?.useLabel, 'Enter проверить');

  for (const tag of ['document', 'blueprint', 'recipe', 'weapon', 'production', 'access', 'tier2', 'armory', 'contraband', 'audit']) {
    assert.ok(def.tags?.includes(tag), `${ITEM_ID} item must carry ${tag}`);
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `${ITEM_ID} registry must publish ${tag}`);
  }
});

test('weapon blueprint t2 is reachable from Black Market 88 and secret stashes', () => {
  const offer = BLACK_MARKET_88_STOCK.find(row => row.itemId === ITEM_ID);
  assert.ok(offer, 'Black Market 88 should sell the weapon T2 blueprint');
  assert.equal(offer.lane, 'documents');
  assert.equal(offer.count, 1);
  assert.equal(offer.traderId, 'market88_zlata_silence');

  assert.ok(
    CONTAINER_DEFS[ContainerKind.SECRET_STASH].itemPool.some(item => item.defId === ITEM_ID),
    'secret stashes should expose a stealable weapon T2 blueprint',
  );
});

test('weapon blueprint t2 is spent as the armory unlock for a stat-backed weapon', () => {
  const armory = FACTORY_BY_ID.armory_bench;
  const recipe = armory.recipes.find(row => row.id === 'assemble_chizh3');

  assert.ok(recipe, 'armory bench should expose ЧИЖ-3 assembly');
  assert.deepEqual(recipe.inputItems, [
    { defId: ITEM_ID, count: 1 },
    { defId: 'barrel_part', count: 1 },
    { defId: 'magazine_part', count: 1 },
  ]);
  assert.deepEqual(recipe.outputs, [{ defId: 'chizh3_shotgun', count: 1 }]);
  assert.equal(WEAPON_STATS.chizh3_shotgun.isRanged, true);
  assert.equal(recipe.outputAccess, 'faction');
  assert.ok(recipe.outputTags.includes('blueprint'));
  assert.ok(recipe.outputTags.includes('tier2'));
  assert.ok(recipe.eventTags?.includes('recipe_unlock'));
  assert.ok(productionRouteGoals(armory, recipe).includes('repair'));
  assert.ok(productionRouteGoals(armory, recipe).includes('steal'));
});

test('weapon blueprint t2 can be sold instead of saved for armory production', () => {
  const player = makeTestPlayer({ inventory: [{ defId: ITEM_ID, count: 1 }], money: 0 });
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 160 });

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.equal(player.money, 210);
  assert.ok(state.msgs.some(line => line.text.includes('Чертёж оружия Т2')));

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['black_market'], limit: 1 })[0];
  assert.equal(sale?.itemId, ITEM_ID);
  assert.equal(sale.data?.outcome, 'black_market_document_sale');
  assert.equal(sale.data?.rewardMoney, 210);
});
