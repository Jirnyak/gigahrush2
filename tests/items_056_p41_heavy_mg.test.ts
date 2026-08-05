import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, ItemType } from '../src/core/types';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateProductionBeltDesignFloor } from '../src/gen/design_floors/production_belt';
import { containerAccessInfo } from '../src/systems/containers';
import { makeTestPlayer } from './helpers';

test('p41 heavy machine gun is a stationary belt-fed liquidator weapon', () => {
  const def = ITEMS.p41_heavy_mg;
  const stats = WEAPON_STATS.p41_heavy_mg;

  assert.equal(def.id, 'p41_heavy_mg');
  assert.equal(def.name, '6П41 пулемёт');
  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(def.spawnW, 0);
  assert.equal(resourceForItem(def.id)?.id, 'ammo');
  assert.equal(WEAPON_ROLE_TIERS.p41_heavy_mg, 'ammo_burn');

  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'ammo_belt');
  assert.equal(stats.dmg > WEAPON_STATS.rpl23_lmg.dmg, true);
  assert.equal(stats.speed < WEAPON_STATS.machinegun.speed, true);
  assert.equal((stats.spread ?? 0) > (WEAPON_STATS.rpl23_lmg.spread ?? 0), true);

  for (const tag of ['liquidator', 'heavy_mg', 'ammo_belt', 'ammo_burn', 'mounted', 'stationary', 'production_belt', 'theft']) {
    assert.ok(def.tags?.includes(tag), `p41 item must carry ${tag}`);
    assert.ok(ITEM_TAGS.p41_heavy_mg?.includes(tag), `p41 tag registry must publish ${tag}`);
  }
});

test('production belt exposes p41 as a liquidator station theft decision', () => {
  const generated = generateProductionBeltDesignFloor();
  const mount = generated.world.containers.find(container =>
    container.inventory.some(item => item.defId === 'p41_heavy_mg')
  );

  assert.ok(mount, 'Production Belt should expose the p41 station');
  assert.equal(mount.faction, Faction.LIQUIDATOR);
  assert.equal(mount.access, 'faction');
  assert.equal(mount.inventory.some(item => item.defId === 'ammo_belt' && item.count >= 80), true);
  for (const tag of ['mounted_weapon', 'p41_heavy_mg', 'heavy_mg', 'stationary', 'authored_route', 'theft']) {
    assert.ok(mount.tags.includes(tag), `p41 mount must publish ${tag}`);
  }

  const access = containerAccessInfo(mount, makeTestPlayer());
  assert.equal(access.mode, 'steal');
  assert.equal(access.theft, true);
});
