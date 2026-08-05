import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { FACTORIES } from '../src/data/factories';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';

const ITEM_ID = 'sound_emitter';

function containerPoolIds(kind: ContainerKind): Set<string> {
  return new Set(CONTAINER_DEFS[kind].itemPool.map(item => item.defId));
}

test('sound emitter is a compact electronics repair good, not a duplicate active lure', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Звукоизлучатель');
  assert.equal(def.type, ItemType.MISC);
  assert.equal(getStack(def), 4);
  assert.ok(def.desc.includes('Не приманка'));
  assert.ok(resourceForItem(ITEM_ID));

  for (const tag of ['electronics', 'noise', 'production', 'repair', 'trade']) {
    assert.ok(def.tags?.includes(tag), `sound_emitter item must carry ${tag}`);
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `sound_emitter registry must publish ${tag}`);
  }
});

test('sound emitter is reachable through cabinets and utility-room assembly', () => {
  assert.ok(containerPoolIds(ContainerKind.METAL_CABINET).has(ITEM_ID));
  assert.ok(containerPoolIds(ContainerKind.TOOL_LOCKER).has(ITEM_ID));

  const recipe = FACTORIES
    .find(factory => factory.id === 'utility_room')
    ?.recipes.find(entry => entry.id === 'assemble_sound_emitter');

  assert.ok(recipe);
  assert.deepEqual(recipe.inputItems, [
    { defId: 'junior_tech_case', count: 1 },
    { defId: 'krona_battery', count: 1 },
  ]);
  assert.deepEqual(recipe.outputs, [{ defId: ITEM_ID, count: 1 }]);
  assert.ok(recipe.eventTags?.includes(ITEM_ID));

  const tools = RESOURCES.find(resource => resource.id === 'tools');
  const electronics = RESOURCES.find(resource => resource.id === 'electronics');
  assert.ok(tools?.itemIds.includes(ITEM_ID));
  assert.ok(electronics?.itemIds.includes(ITEM_ID));
});
