import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, ProjType, RoomType } from '../src/core/types';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { ITEM_TAGS, getStack } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { addItem, consumeAmmo, countAmmo, getWeaponReadiness } from '../src/systems/inventory';
import { makeTestPlayer } from './helpers';

test('shmk disposable is a single-use fuel panic clear weapon', () => {
  const def = ITEMS.shmk_disposable;
  const stats = WEAPON_STATS.shmk_disposable;

  assert.equal(def.id, 'shmk_disposable');
  assert.equal(def.name, 'ШМК');
  assert.equal(def.type, ItemType.WEAPON);
  assert.equal(getStack(def), 1);
  assert.ok(def.spawnRooms.includes(RoomType.HQ));
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE));
  assert.equal(resourceForItem(def.id)?.id, 'fuel');
  assert.equal(WEAPON_ROLE_TIERS.shmk_disposable, 'fuel_clear');

  for (const tag of ['liquidator', 'flame', 'cleanup', 'single_use', 'panic_clear', 'fuel', 'collateral', 'rare_crate']) {
    assert.ok(def.tags?.includes(tag), `shmk_disposable item must carry ${tag}`);
    assert.ok(ITEM_TAGS.shmk_disposable?.includes(tag), `shmk_disposable tag registry must publish ${tag}`);
  }

  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, def.id);
  assert.equal(stats.projType, ProjType.FLAME);
  assert.equal(stats.pellets, 8);
  assert.ok((stats.spread ?? 0) > (WEAPON_STATS.flamethrower.spread ?? 0));
  assert.ok(stats.speed > WEAPON_STATS.flamethrower.speed);
});

test('shmk disposable is reachable from rare faction weapon crates and consumes itself as ammo', () => {
  const crateEntry = CONTAINER_DEFS[ContainerKind.WEAPON_CRATE].itemPool.find(entry => entry.defId === 'shmk_disposable');
  assert.ok(crateEntry, 'rare weapon crates should expose SHMK');
  assert.equal(crateEntry.min, 1);
  assert.equal(crateEntry.max, 1);
  assert.ok((crateEntry.chance ?? 1) <= 0.05);

  const player = makeTestPlayer();
  assert.equal(addItem(player, 'shmk_disposable', 2), true);
  player.weapon = 'shmk_disposable';

  const readiness = getWeaponReadiness(player);
  assert.equal(readiness.resourceLabel, 'ШМК 2');
  assert.equal(readiness.damageLabel, '11x8');
  assert.equal(consumeAmmo(player), true);
  assert.equal(countAmmo(player), 1);
});
