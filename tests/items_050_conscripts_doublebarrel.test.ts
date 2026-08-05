import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, RoomType } from '../src/core/types';
import { ITEMS, WEAPON_STATS } from '../src/data/catalog';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { resourceForItem } from '../src/data/resources';

test('conscripts doublebarrel is a reachable low-tier shell shotgun', () => {
  const item = ITEMS.conscripts_doublebarrel;
  const stats = WEAPON_STATS.conscripts_doublebarrel;

  assert.equal(item.type, ItemType.WEAPON);
  assert.equal(item.name, 'Двустволка срочника');
  assert.ok(item.spawnRooms.includes(RoomType.STORAGE));
  assert.ok(item.spawnRooms.includes(RoomType.LIVING));
  assert.ok(item.tags?.includes('militia'));
  assert.ok(item.tags?.includes('civilian'));
  assert.equal(resourceForItem(item.id)?.id, 'metal');

  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'ammo_shells');
  assert.equal(stats.pellets, 7);
  assert.ok(stats.dmg * (stats.pellets ?? 1) < WEAPON_STATS.shotgun.dmg * (WEAPON_STATS.shotgun.pellets ?? 1));
  assert.ok(stats.speed > WEAPON_STATS.chizh3_shotgun.speed);
  assert.ok(stats.speed < WEAPON_STATS.toz_shotgun.speed);

  const weaponCrate = CONTAINER_DEFS[ContainerKind.WEAPON_CRATE].itemPool;
  const secretStash = CONTAINER_DEFS[ContainerKind.SECRET_STASH].itemPool;
  assert.ok(weaponCrate.some(entry => entry.defId === item.id));
  assert.ok(secretStash.some(entry => entry.defId === item.id));
});
