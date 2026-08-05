import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { generateLiquidatorArchive } from '../src/gen/ministry/liquidator_archive';

test('bayonet remains an executable liquidator reach melee weapon', () => {
  const def = ITEMS.bayonet;
  const stats = WEAPON_STATS.bayonet;

  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.STORAGE]);
  assert.equal(def.spawnW, 0.75);
  assert.equal(resourceForItem(def.id)?.id, 'metal');
  assert.equal(stats.dmg, 13);
  assert.equal(stats.durability, 65);
  assert.equal(stats.range, 1.8);
  assert.equal(WEAPON_ROLE_TIERS.bayonet, 'melee_reach');

  for (const tag of ['liquidator', 'melee_reach', 'metal']) {
    assert.ok(ITEM_TAGS.bayonet?.includes(tag), `bayonet must publish ${tag} tag`);
    assert.ok(def.tags?.includes(tag), `bayonet item def must publish ${tag} tag`);
  }
});

test('bayonet is reachable from a faction liquidator archive stash', () => {
  const world = new World();
  const entities: Entity[] = [];

  generateLiquidatorArchive(world, 0, entities, { v: 1 }, 512, 512);

  const stash = world.containers.find(container => container.inventory.some(item => item.defId === 'bayonet'));
  assert.ok(stash, 'liquidator archive should expose bayonet');
  assert.equal(stash.faction, Faction.LIQUIDATOR);
  assert.equal(stash.access, 'faction');
  assert.ok(stash.tags.includes('liquidator'));
});
