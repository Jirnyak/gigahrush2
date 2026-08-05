import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, ProjType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { PHYS_WEAPON_ROLE_TIERS, PHYS_WEAPON_STATS } from '../src/data/weapons';
import { addItem, consumeAmmo, countAmmo, getWeaponReadiness } from '../src/systems/inventory';
import { makeTestPlayer } from './helpers';

test('concrete breaker grenade is a self-ammo engineer breach explosive', () => {
  const def = ITEMS.concrete_breaker_grenade;
  const stats = PHYS_WEAPON_STATS.concrete_breaker_grenade;

  assert.equal(def.type, ItemType.WEAPON);
  assert.equal(def.name, 'Бетонобойная граната');
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.PRODUCTION]);
  assert.equal(def.stack, 4);
  assert.equal(resourceForItem(def.id)?.id, 'ammo');
  assert.equal(PHYS_WEAPON_ROLE_TIERS.concrete_breaker_grenade, 'grenade');

  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, def.id);
  assert.equal(stats.projType, ProjType.GRENADE);
  assert.equal(stats.projSprite, PHYS_WEAPON_STATS.grenade.projSprite);
  assert.ok(stats.dmg > PHYS_WEAPON_STATS.grenade.dmg);
  assert.ok(stats.dmg < PHYS_WEAPON_STATS.breach_charge.dmg);
  assert.ok((stats.aoeRadius ?? 0) > (PHYS_WEAPON_STATS.breach_charge.aoeRadius ?? 0));
  assert.ok((stats.aoeRadius ?? 0) < (PHYS_WEAPON_STATS.grenade.aoeRadius ?? 0));
  assert.equal(WEAPON_STATS.concrete_breaker_grenade, stats);

  for (const tag of ['grenade', 'breach', 'engineer', 'concrete', 'single_use']) {
    assert.ok(ITEM_TAGS.concrete_breaker_grenade?.includes(tag), `tag registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `item def must carry ${tag}`);
  }
});

test('concrete breaker grenade is reachable from rare engineer crates and spends itself', () => {
  const crateEntry = CONTAINER_DEFS[ContainerKind.WEAPON_CRATE].itemPool
    .find(entry => entry.defId === 'concrete_breaker_grenade');
  assert.ok(crateEntry, 'weapon crates should expose the engineer stash path');
  assert.equal(crateEntry.min, 1);
  assert.equal(crateEntry.max, 1);
  assert.ok((crateEntry.chance ?? 1) <= 0.05);

  const player = makeTestPlayer({ weapon: 'concrete_breaker_grenade' });
  addItem(player, 'concrete_breaker_grenade', 3);

  const readiness = getWeaponReadiness(player);
  assert.equal(readiness.resourceLabel, 'бетонка 3');
  assert.equal(readiness.damageLabel, '105');
  assert.equal(countAmmo(player), 3);
  assert.equal(consumeAmmo(player), true);
  assert.equal(countAmmo(player), 2);
});
