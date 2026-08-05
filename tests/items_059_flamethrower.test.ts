import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, ProjType, RoomType } from '../src/core/types';
import { ITEMS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { PHYS_WEAPON_ROLE_TIERS } from '../src/data/weapons';

test('flamethrower remains the generic industrial fire-clear weapon', () => {
  const def = ITEMS.flamethrower;
  const stats = WEAPON_STATS.flamethrower;

  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, [RoomType.PRODUCTION, RoomType.STORAGE]);
  assert.equal(def.spawnW, 0.04);
  assert.deepEqual(def.tags, ITEM_TAGS.flamethrower);
  assert.ok(def.tags?.includes('industrial'));
  assert.ok(def.tags?.includes('cleanup'));
  assert.ok(def.tags?.includes('slime_counterplay'));
  assert.ok(def.tags?.includes('fungus_counterplay'));

  assert.equal(PHYS_WEAPON_ROLE_TIERS.flamethrower, 'fuel_clear');
  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'ammo_fuel');
  assert.equal(stats.projType, ProjType.FLAME);
  assert.equal(stats.dmg, 6);
  assert.equal(stats.pellets, 1);
  assert.equal(resourceForItem('ammo_fuel')?.id, 'fuel');
  assert.equal(resourceForItem(def.id), undefined);
});
