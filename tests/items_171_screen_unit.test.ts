import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { FACTORY_BY_ID } from '../src/data/factories';
import { ITEMS } from '../src/data/items';
import { RESOURCE_BY_ID, resourceForItem } from '../src/data/resources';

test('screen unit is a reachable electronics repair part', () => {
  const def = ITEMS.screen_unit;

  assert.equal(def.id, 'screen_unit');
  assert.equal(def.name, 'Экран');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.ok(def.spawnRooms.includes(RoomType.LIVING));
  assert.equal(resourceForItem(def.id)?.id, 'electronics');
  assert.ok(RESOURCE_BY_ID.electronics.itemIds.includes(def.id));
  assert.equal(RESOURCE_BY_ID.tools.itemIds.includes(def.id), false);

  for (const tag of ['electronics', 'screen', 'terminal', 'repair']) {
    assert.ok(def.tags?.includes(tag), `screen_unit must carry ${tag}`);
  }
});

test('screen unit can be looted or produced for terminal repair decisions', () => {
  const toolLocker = CONTAINER_DEFS[ContainerKind.TOOL_LOCKER];
  const utilityRoom = FACTORY_BY_ID.utility_room;
  const stripRecipe = utilityRoom.recipes.find(recipe => recipe.id === 'strip_terminal_units');

  assert.ok(toolLocker.itemPool.some(item => item.defId === 'screen_unit'));
  assert.ok(stripRecipe);
  assert.ok(stripRecipe.outputs.some(output => output.defId === 'screen_unit' && output.count === 1));
  assert.ok(stripRecipe.outputTags.includes('terminal'));
  assert.ok(stripRecipe.outputTags.includes('repair'));
});
