import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType } from '../src/core/types';
import { FACTORY_BY_ID, productionRouteGoals } from '../src/data/factories';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { PHYS_WEAPON_STATS } from '../src/data/weapons';

test('napalm mix is explicit ROKS fuel with no generic ammo spawn', () => {
  const def = ITEMS.napalm_mix;

  assert.equal(def.id, 'napalm_mix');
  assert.equal(def.name, 'Напалмовая смесь');
  assert.equal(def.type, ItemType.AMMO);
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(def.spawnW, 0);
  assert.equal(def.stack, 3);
  assert.equal(resourceForItem(def.id)?.id, 'fuel');

  for (const tag of ['ammo', 'fuel', 'napalm', 'cleanup', 'fire', 'liquidator']) {
    assert.ok(ITEM_TAGS.napalm_mix?.includes(tag), `napalm_mix registry must publish ${tag} tag`);
    assert.ok(def.tags?.includes(tag), `napalm_mix item must carry ${tag} tag`);
  }
});

test('napalm mix is consumed by ROKS and produced through guarded factory work', () => {
  const stats = PHYS_WEAPON_STATS.roks47_flamethrower;
  assert.equal(stats.ammoType, 'napalm_mix');
  assert.equal(stats.projType, PHYS_WEAPON_STATS.flamethrower.projType);
  assert.ok((stats.pellets ?? 0) > (PHYS_WEAPON_STATS.flamethrower.pellets ?? 0));

  const factory = FACTORY_BY_ID.armory_bench;
  const recipe = factory.recipes.find(row => row.id === 'fill_roks_tank');
  assert.ok(recipe, 'armory bench must expose the ROKS refill route');
  assert.deepEqual(recipe.inputItems, [{ defId: 'empty_roks_tank', count: 1 }]);
  assert.deepEqual(recipe.outputs, [{ defId: 'napalm_mix', count: 4 }]);
  assert.equal(recipe.outputAccess, 'faction');
  assert.ok(recipe.eventTags?.includes('napalm'));
  assert.ok(productionRouteGoals(factory, recipe).includes('steal'));
  assert.ok(productionRouteGoals(factory, recipe).includes('repair'));
});
