import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, ItemType, QuestType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { FACTORIES, productionRouteGoals } from '../src/data/factories';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { METRO_DEPOT_ROOM_NAME } from '../src/data/metro';
import { SIDE_QUESTS } from '../src/data/plot';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { generateMetroErrorLine } from '../src/gen/maintenance/metro_error_line';

const ITEM_ID = 'rail_switch_handle';

test('rail switch handle is a metal transport repair item', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Рукоять стрелочного перевода');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.PRODUCTION));
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE));
  assert.equal(def.stack, 1);
  assert.equal(resourceForItem(def.id)?.id, 'metal');
  assert.ok(RESOURCES.find(resource => resource.id === 'tools')?.itemIds.includes(def.id));

  const tags = new Set([...(ITEM_TAGS[ITEM_ID] ?? []), ...(def.tags ?? [])]);
  for (const tag of ['rail', 'transport', 'repair', 'metal']) {
    assert.ok(tags.has(tag), `rail_switch_handle must publish ${tag}`);
  }
});

test('rail switch handle is reachable from the maintenance metro depot', () => {
  const world = new World();
  const entities: Entity[] = [];
  generateMetroErrorLine({ world, entities, nextId: { v: 1 }, spawnX: 512, spawnY: 512 });

  const depot = world.rooms.find(room => room?.name === METRO_DEPOT_ROOM_NAME);
  assert.ok(depot, 'metro depot room should exist');

  const source = entities.find(entity =>
    entity.type === EntityType.ITEM_DROP
    && entity.inventory?.some(item => item.defId === ITEM_ID)
    && world.roomAt(entity.x, entity.y)?.id === depot.id
  );
  assert.ok(source, 'metro depot should expose a rail_switch_handle drop');
});

test('Borya spends the rail switch handle through the transport repair side quest', () => {
  const quest = SIDE_QUESTS.find(step => step.id === 'ag19_switch_handle');

  assert.ok(quest, 'Borya side quest should be registered');
  assert.equal(quest.giverNpcId, 'ag19_borya_conductor');
  assert.equal(quest.type, QuestType.FETCH);
  assert.equal(quest.targetItem, ITEM_ID);
  assert.equal(quest.targetCount, 1);
  assert.equal(quest.rewardItem, 'metro_ticket');
});

test('metal shop can produce rail switch handles as a repair route', () => {
  const factory = FACTORIES.find(def => def.id === 'metal_shop');
  const recipe = factory?.recipes.find(def => def.id === 'press_rail_repair_pack');

  assert.ok(factory, 'metal_shop factory should exist');
  assert.ok(recipe, 'press_rail_repair_pack recipe should exist');
  assert.ok(recipe.outputs.some(output => output.defId === ITEM_ID && output.count === 1));
  assert.ok(recipe.outputs.some(output => output.defId === 'rail_spike_pack'));
  assert.ok(recipe.outputTags.includes('rail'));
  assert.ok(recipe.outputTags.includes('transport'));
  assert.ok(productionRouteGoals(factory, recipe).includes('repair'));
});
