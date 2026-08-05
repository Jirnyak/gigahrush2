import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateSlimeNiiDesignFloor } from '../src/gen/design_floors/slime_nii';
import { generateSlimeDeactivationFurnace } from '../src/gen/maintenance/slime_deactivation_furnace';
import { inventoryItemCategory } from '../src/systems/inventory';

const ITEM_ID = 'boiled_slime_residue';

test('boiled slime residue is a heat-counterplay proof sample', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Вываренный остаток слизи');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(def.spawnW, 0);
  assert.equal(getStack(def), 4);
  assert.equal(inventoryItemCategory(def.id), 'trade');
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');

  for (const tag of ['slime', 'sample', 'boiled', 'heat_counter', 'cleanup', 'nii', 'evidence', 'trade', 'reagent']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `boiled_slime_residue registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `boiled_slime_residue item must carry ${tag}`);
  }
});

test('boiled slime residue is reachable from slime NII cold storage', () => {
  const gen = generateSlimeNiiDesignFloor();

  const cabinet = gen.world.containers.find(container =>
    container.tags.includes('slime_nii')
    && container.tags.includes('cold_storage')
    && container.inventory.some(item => item.defId === ITEM_ID),
  );

  assert.ok(cabinet, 'slime_nii should expose boiled_slime_residue through locked sample storage');
  assert.equal(cabinet.access, 'locked');
  assert.equal(cabinet.inventory.find(item => item.defId === ITEM_ID)?.count, 1);
});

test('boiled slime residue is reachable from the cleanup furnace output bin', () => {
  const world = new World();
  const entities: Entity[] = [];

  generateSlimeDeactivationFurnace({ world, entities, nextId: { v: 1 }, spawnX: 512, spawnY: 512 });

  const outputBin = world.containers.find(container =>
    container.tags.includes('deactivation_furnace')
    && container.tags.includes('production_output')
    && container.inventory.some(item => item.defId === ITEM_ID),
  );

  assert.ok(outputBin, 'slime deactivation furnace should expose boiled_slime_residue as cleanup proof');
  assert.equal(outputBin?.access, 'room');
});
