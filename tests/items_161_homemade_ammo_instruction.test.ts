import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { FACTORY_BY_ID } from '../src/data/factories';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCE_BY_ID, resourceForItem } from '../src/data/resources';
import { BLACK_MARKET_88_STOCK } from '../src/gen/design_floors/black_market_88';

const ITEM_ID = 'homemade_ammo_instruction';

function containerPoolIds(kind: ContainerKind): Set<string> {
  return new Set(CONTAINER_DEFS[kind].itemPool.map(item => item.defId));
}

test('homemade ammo instruction is a contraband paper recipe item', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Инструкция кустарных патронов');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.PRODUCTION));
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE));
  assert.equal(def.stack, 2);
  assert.equal(resourceForItem(ITEM_ID)?.id, 'paper');
  assert.ok(RESOURCE_BY_ID.contraband.itemIds.includes(ITEM_ID));
  assert.ok(RESOURCE_BY_ID.documents.itemIds.includes(ITEM_ID));

  for (const tag of ['document', 'instruction', 'ammo', 'homemade', 'contraband', 'black_market', 'production', 'recipe', 'paper', 'audit']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `${ITEM_ID} registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `${ITEM_ID} item must carry ${tag}`);
  }
});

test('homemade ammo instruction is reachable from cabinets and Black Market 88', () => {
  assert.ok(containerPoolIds(ContainerKind.FILING_CABINET).has(ITEM_ID));

  const stockRow = BLACK_MARKET_88_STOCK.find(row => row.itemId === ITEM_ID);
  assert.ok(stockRow);
  assert.equal(stockRow.lane, 'documents');
  assert.ok(stockRow.heatDelta > 0);
});

test('homemade ammo instruction gates illegal ammo production', () => {
  const smelter = FACTORY_BY_ID.illegal_ammo_smelter;
  const recipeIds = ['recycle_pistol_rounds', 'cast_black_market_shells', 'cast_homemade_9mm'];

  for (const recipeId of recipeIds) {
    const recipe = smelter.recipes.find(row => row.id === recipeId);
    assert.ok(recipe, `${recipeId} must exist`);
    assert.ok(recipe.inputItems?.some(item => item.defId === ITEM_ID), `${recipeId} must require ${ITEM_ID}`);
    assert.ok(recipe.outputTags.includes('illegal'), `${recipeId} must stay illegal`);
  }
});
