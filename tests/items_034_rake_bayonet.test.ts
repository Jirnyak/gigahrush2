import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateLiquidatorArchive } from '../src/gen/ministry/liquidator_archive';

test('rake bayonet is an executable rare liquidator reach melee fallback', () => {
  const def = ITEMS.rake_bayonet;
  const stats = WEAPON_STATS.rake_bayonet;

  assert.equal(def.name, 'Штык-грабли');
  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.STORAGE]);
  assert.equal(def.spawnW, 0.18);
  assert.equal(resourceForItem(def.id)?.id, 'metal');
  assert.equal(WEAPON_ROLE_TIERS.rake_bayonet, 'melee_reach');

  assert.equal(stats.isRanged, false);
  assert.equal(stats.dmg, 14);
  assert.equal(stats.durability, 55);
  assert.equal(stats.range, 2.0);
  assert.ok(stats.speed < WEAPON_STATS.fire_hook.speed);

  for (const tag of ['liquidator', 'bayonet', 'rake', 'melee_reach', 'rare_stash']) {
    assert.ok(ITEM_TAGS.rake_bayonet?.includes(tag), `rake_bayonet must publish ${tag} tag`);
    assert.ok(def.tags?.includes(tag), `rake_bayonet item def must include ${tag} tag`);
  }
});

test('rake bayonet is reachable from the rare liquidator archive weapon crate', () => {
  const world = new World();
  const entities: Entity[] = [];

  generateLiquidatorArchive(world, 0, entities, { v: 1 }, 512, 512);

  const stash = world.containers.find(container => container.inventory.some(item => item.defId === 'rake_bayonet'));
  assert.ok(stash, 'liquidator archive should expose rake_bayonet');
  assert.equal(stash.faction, Faction.LIQUIDATOR);
  assert.equal(stash.access, 'faction');
  assert.ok(stash.tags.includes('liquidator'));
  assert.ok(stash.tags.includes('recruit_stash'));
});
