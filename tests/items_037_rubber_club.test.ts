import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, ItemType, RoomType } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateLiquidatorArchive } from '../src/gen/ministry/liquidator_archive';

test('rubber club is low-damage liquidator control gear', () => {
  const def = ITEMS.rubber_club;
  const stats = WEAPON_STATS.rubber_club;

  assert.equal(def.name, 'Резиновая дубинка');
  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.OFFICE, RoomType.STORAGE]);
  assert.equal(resourceForItem(def.id)?.id, 'tools');
  assert.equal(WEAPON_ROLE_TIERS.rubber_club, 'melee_control');

  assert.equal(stats.isRanged, false);
  assert.equal(stats.dmg, 8);
  assert.equal(stats.durability, 90);
  assert.ok(stats.dmg < WEAPON_STATS.pipe.dmg);
  assert.ok((stats.knockback ?? 0) > (WEAPON_STATS.crowbar.knockback ?? 0));

  for (const tag of ['liquidator', 'control', 'melee_control', 'tool']) {
    assert.ok(ITEM_TAGS.rubber_club?.includes(tag), `rubber_club must publish ${tag} tag`);
    assert.ok(def.tags?.includes(tag), `rubber_club item def must carry ${tag} tag`);
  }
});

test('rubber club is reachable from the Ministry liquidator archive stash', () => {
  const world = new World();
  const entities = [];

  generateLiquidatorArchive(world, 0, entities, { v: 1 }, 512, 512);

  const stash = world.containers.find(container => container.inventory.some(item => item.defId === 'rubber_club'));
  assert.ok(stash, 'liquidator archive should expose rubber_club');
  assert.equal(stash.faction, Faction.LIQUIDATOR);
  assert.equal(stash.access, 'faction');
  assert.ok(stash.tags.includes('liquidator'));
  assert.ok(stash.tags.includes('theft'));
});
