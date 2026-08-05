import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, EntityType, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { FACTORIES, productionRouteGoals } from '../src/data/factories';
import { ITEMS } from '../src/data/items';
import { METRO_DEPOT_ROOM_NAME } from '../src/data/metro';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { generateMetroErrorLine } from '../src/gen/maintenance/metro_error_line';

const ITEM_ID = 'rail_spike_pack';

test('rail spike pack is a stackable metal transport repair item', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Пакет костылей');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.PRODUCTION));
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE));
  assert.equal(def.stack, 8);
  assert.equal(resourceForItem(def.id)?.id, 'metal');
  assert.ok(RESOURCES.find(resource => resource.id === 'tools')?.itemIds.includes(def.id));

  const tags = new Set(def.tags ?? []);
  for (const tag of ['rail', 'transport', 'metal', 'repair']) {
    assert.ok(tags.has(tag), `rail_spike_pack must publish ${tag}`);
  }
});

test('rail spike pack is reachable from depot and production surfaces', () => {
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
  assert.ok(source, 'metro depot should expose a rail_spike_pack drop');

  const metalCabinetHasSpikes = CONTAINER_DEFS[ContainerKind.METAL_CABINET].itemPool
    .some(item => item.defId === ITEM_ID);
  assert.ok(metalCabinetHasSpikes, 'metal cabinets should expose stealable rail_spike_pack loot');
});

test('metal shop can produce rail spike packs for transport repair', () => {
  const factory = FACTORIES.find(def => def.id === 'metal_shop');
  const recipe = factory?.recipes.find(def => def.id === 'press_rail_repair_pack');

  assert.ok(factory, 'metal_shop factory should exist');
  assert.ok(recipe, 'press_rail_repair_pack recipe should exist');
  assert.ok(recipe.outputs.some(output => output.defId === ITEM_ID && output.count === 2));
  assert.ok(recipe.outputTags.includes('rail'));
  assert.ok(recipe.outputTags.includes('repair'));
  assert.ok(recipe.outputTags.includes('transport'));
  assert.ok(productionRouteGoals(factory, recipe).includes('repair'));
});
