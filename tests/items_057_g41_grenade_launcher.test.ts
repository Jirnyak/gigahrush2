import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, ItemType } from '../src/core/types';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import { containerAccessInfo } from '../src/systems/containers';
import { makeTestPlayer } from './helpers';

test('g41 grenade launcher is a route-only mounted grenade weapon on existing projectile rules', () => {
  const def = ITEMS.g41_grenade_launcher;
  const stats = WEAPON_STATS.g41_grenade_launcher;

  assert.equal(def.type, ItemType.WEAPON);
  assert.equal(def.name, '5Г41 станковый гранатомёт');
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(def.spawnW, 0);
  assert.equal(resourceForItem(def.id)?.id, 'ammo');
  assert.equal(WEAPON_ROLE_TIERS.g41_grenade_launcher, 'grenade');

  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'grenade');
  assert.equal(stats.projType, WEAPON_STATS.grenade.projType);
  assert.equal(stats.projSprite, WEAPON_STATS.grenade.projSprite);
  assert.ok((stats.aoeRadius ?? 0) > (WEAPON_STATS.party_might_launcher.aoeRadius ?? 0));
  assert.ok(stats.speed > WEAPON_STATS.party_might_launcher.speed);

  for (const tag of ['liquidator', 'grenade', 'mounted', 'stationary', 'production_belt', 'theft']) {
    assert.ok(def.tags?.includes(tag), `g41 item must publish ${tag} tag`);
    assert.ok(ITEM_TAGS.g41_grenade_launcher?.includes(tag), `g41 tag registry must publish ${tag}`);
  }
});

test('production belt exposes the g41 mount as a faction theft decision', () => {
  const gen = generateDesignFloor('production_belt');
  const mounts = gen.world.containers.filter(container =>
    container.inventory.some(item => item.defId === 'g41_grenade_launcher')
  );

  assert.equal(mounts.length, 1);
  const mount = mounts[0];
  assert.equal(mount.faction, Faction.LIQUIDATOR);
  assert.equal(mount.access, 'faction');
  assert.ok(mount.tags.includes('mounted_weapon'));
  assert.ok(mount.tags.includes('stationary'));
  assert.ok(mount.tags.includes('authored_route'));
  assert.equal(mount.inventory.find(item => item.defId === 'g41_grenade_launcher')?.count, 1);
  assert.equal(mount.inventory.find(item => item.defId === 'grenade')?.count, 3);

  const access = containerAccessInfo(mount, makeTestPlayer());
  assert.equal(access.mode, 'steal');
  assert.equal(access.theft, true);
});
