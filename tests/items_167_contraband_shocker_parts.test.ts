import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { FACTORY_BY_ID, productionOutputResourceIds, productionRouteGoals } from '../src/data/factories';
import { ITEMS, ITEM_TAGS } from '../src/data/items';
import { RESOURCE_BY_ID, resourceForItem } from '../src/data/resources';
import { BLACK_MARKET_88_STOCK } from '../src/gen/design_floors/black_market_88';

test('contraband shocker parts are reachable black-market electronics', () => {
  const def = ITEMS.contraband_shocker_parts;

  assert.equal(def.id, 'contraband_shocker_parts');
  assert.equal(def.name, 'Детали шокера');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.PRODUCTION, RoomType.OFFICE, RoomType.SMOKING]);
  assert.equal(def.spawnW, 0.25);
  assert.equal(resourceForItem(def.id)?.id, 'electronics');
  assert.ok(RESOURCE_BY_ID.contraband.itemIds.includes(def.id));

  for (const tag of ['electronics', 'weapon_part', 'shock_baton', 'contraband', 'production', 'black_market']) {
    assert.ok(def.tags?.includes(tag), `item must carry ${tag}`);
    assert.ok(ITEM_TAGS.contraband_shocker_parts?.includes(tag), `tag registry must publish ${tag}`);
  }

  assert.ok(
    CONTAINER_DEFS[ContainerKind.SECRET_STASH].itemPool.some(entry => entry.defId === def.id),
    'secret stashes must expose the contraband path',
  );
  assert.ok(
    BLACK_MARKET_88_STOCK.some(row => row.itemId === def.id && row.lane === 'weapons'),
    'Black Market 88 must sell shocker parts through a weapons lane',
  );
});

test('contraband shocker parts can be spent on a secret shock baton recipe', () => {
  const utilityRoom = FACTORY_BY_ID.utility_room;
  const recipe = utilityRoom.recipes.find(row => row.id === 'assemble_contraband_shocker');

  assert.ok(recipe);
  assert.deepEqual(recipe.inputItems, [
    { defId: 'contraband_shocker_parts', count: 1 },
    { defId: 'krona_battery', count: 1 },
  ]);
  assert.deepEqual(recipe.outputs, [{ defId: 'shock_baton', count: 1 }]);
  assert.equal(recipe.outputAccess, 'secret');
  assert.ok(recipe.outputTags.includes('illegal'));
  assert.ok(recipe.eventTags?.includes('audit_risk'));
  assert.ok(productionRouteGoals(utilityRoom, recipe).includes('steal'));
  assert.ok(productionRouteGoals(utilityRoom, recipe).includes('repair'));
  assert.ok(productionOutputResourceIds(utilityRoom, recipe).includes('contraband'));
  assert.ok(productionOutputResourceIds(utilityRoom, recipe).includes('electronics'));
});
