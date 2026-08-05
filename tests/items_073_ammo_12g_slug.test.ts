import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, Faction, ItemType } from '../src/core/types';
import { World } from '../src/core/world';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { FACTORY_BY_ID } from '../src/data/factories';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateLiquidatorArchive } from '../src/gen/ministry/liquidator_archive';
import { containerAccessInfo } from '../src/systems/containers';
import { makeTestPlayer } from './helpers';

test('12 gauge slug is explicit scarce shotgun ammunition', () => {
  const def = ITEMS.ammo_12g_slug;

  assert.equal(def.id, 'ammo_12g_slug');
  assert.equal(def.name, 'Пуля 12 калибра');
  assert.equal(def.type, ItemType.AMMO);
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(def.spawnW, 0);
  assert.equal(resourceForItem(def.id)?.id, 'ammo');
  assert.ok(def.value > ITEMS.ammo_shells.value);

  for (const tag of ['ammo', 'shells', 'slug', 'shotgun', 'liquidator', 'precision', 'anti_armor', 'hq_issue', 'armory_bench']) {
    assert.ok(def.tags?.includes(tag), `ammo_12g_slug item must carry ${tag} tag`);
    assert.ok(ITEM_TAGS.ammo_12g_slug?.includes(tag), `ammo_12g_slug registry must publish ${tag} tag`);
  }
});

test('12 gauge slug is reachable through armory and HQ theft paths', () => {
  const armory = FACTORY_BY_ID.armory_bench;
  const recipe = armory.recipes.find(row => row.id === 'cast_12g_slugs');
  assert.ok(recipe, 'armory bench must expose slug production');
  assert.deepEqual(recipe.outputs, [{ defId: 'ammo_12g_slug', count: 4 }]);
  assert.equal(recipe.outputAccess, 'faction');
  assert.ok(recipe.outputTags.includes('ammo'));
  assert.ok(recipe.outputTags.includes('precision'));

  const genericCrate = CONTAINER_DEFS[ContainerKind.WEAPON_CRATE].itemPool.find(row => row.defId === 'ammo_12g_slug');
  assert.ok(genericCrate, 'weapon crates should have rare slug packs');
  assert.equal(genericCrate.min, 1);
  assert.equal(genericCrate.max, 2);

  const world = new World();
  generateLiquidatorArchive(world, 0, [], { v: 1 }, 512, 512);

  const stash = world.containers.find(container => container.inventory.some(item => item.defId === 'ammo_12g_slug'));
  assert.ok(stash, 'liquidator archive should expose ammo_12g_slug');
  assert.equal(stash.faction, Faction.LIQUIDATOR);
  assert.equal(stash.access, 'faction');
  assert.ok(stash.tags.includes('liquidator'));
  assert.ok(stash.tags.includes('issue_stash'));

  const access = containerAccessInfo(stash, makeTestPlayer());
  assert.equal(access.mode, 'steal');
  assert.equal(access.theft, true);
});
