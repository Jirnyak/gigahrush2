import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';

test('nosin rifle is a slow militia rifle using existing 7.62 pressure', () => {
  const def = ITEMS.nosin_rifle;
  const stats = WEAPON_STATS.nosin_rifle;

  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, [RoomType.STORAGE, RoomType.HQ]);
  assert.ok(def.spawnW > 0);
  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'ammo_762');
  assert.ok(stats.speed > WEAPON_STATS.nagant.speed);
  assert.equal(WEAPON_ROLE_TIERS.nosin_rifle, 'rifle_precision');
  assert.equal(resourceForItem('ammo_762')?.id, 'ammo');

  for (const tag of ['militia', 'civilian_stash', 'rifle', 'ammo_762']) {
    assert.ok(ITEM_TAGS.nosin_rifle?.includes(tag), `nosin_rifle must publish ${tag} tag`);
  }
});

test('nosin rifle is reachable from civilian secret stashes with bounded ammo', () => {
  const stash = CONTAINER_DEFS[ContainerKind.SECRET_STASH];
  const rifle = stash.itemPool.find(item => item.defId === 'nosin_rifle');
  const ammo = stash.itemPool.find(item => item.defId === 'ammo_762');

  assert.ok(stash.roomTypes.includes(RoomType.LIVING));
  assert.equal(stash.defaultAccess, 'secret');
  assert.ok(rifle, 'secret civilian stash should expose nosin_rifle');
  assert.equal(rifle.min, 1);
  assert.equal(rifle.max, 1);
  assert.ok((rifle.chance ?? 0) > 0);
  assert.ok(ammo, 'secret civilian stash should expose a small 7.62 reserve');
  assert.ok(ammo.max <= 5);
});
