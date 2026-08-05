import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, ItemType, RoomType } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { FACTORY_BY_ID } from '../src/data/factories';
import { ITEM_TAGS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateLiquidatorArchive } from '../src/gen/ministry/liquidator_archive';
import { containerAccessInfo } from '../src/systems/containers';
import { addItem, countAmmo, getWeaponReadiness } from '../src/systems/inventory';
import { makeTestPlayer } from './helpers';

test('roks47 flamethrower is a liquidator napalm weapon with better fuel economy', () => {
  const def = ITEMS.roks47_flamethrower;
  const stats = WEAPON_STATS.roks47_flamethrower;
  const base = WEAPON_STATS.flamethrower;

  assert.equal(def.name, 'РОКС-47');
  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.PRODUCTION]);
  assert.equal(WEAPON_ROLE_TIERS.roks47_flamethrower, 'fuel_clear');

  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'napalm_mix');
  assert.equal(resourceForItem(stats.ammoType ?? '')?.id, 'fuel');
  assert.equal(ITEMS.napalm_mix.type, ItemType.AMMO);
  assert.equal(stats.projType, base.projType);
  assert.equal(stats.pellets, 2);
  assert.ok(def.value > ITEMS.flamethrower.value, 'ROKS should be the heavier-value liquidator variant');
  assert.ok(stats.dmg * (stats.pellets ?? 1) > base.dmg * (base.pellets ?? 1), 'ROKS should spend one fuel unit for a stronger burst');

  for (const tag of ['liquidator', 'flame', 'cleanup', 'slime_counterplay', 'napalm', 'issue_stash']) {
    assert.ok(def.tags?.includes(tag), `roks47_flamethrower item must carry ${tag} tag`);
    assert.ok(ITEM_TAGS.roks47_flamethrower?.includes(tag), `roks47_flamethrower registry must publish ${tag} tag`);
  }
});

test('roks47 flamethrower uses napalm readiness and armory refill pressure', () => {
  const player = makeTestPlayer();
  addItem(player, 'roks47_flamethrower', 1);
  addItem(player, 'napalm_mix', 2);
  player.weapon = 'roks47_flamethrower';

  const readiness = getWeaponReadiness(player);
  assert.equal(readiness.resourceLabel, 'напалм 2');
  assert.equal(readiness.damageLabel, '7x2');
  assert.equal(countAmmo(player), 2);

  const refill = FACTORY_BY_ID.armory_bench.recipes.find(recipe => recipe.id === 'fill_roks_tank');
  assert.ok(refill, 'armory bench should expose the ROKS tank refill decision');
  assert.ok(refill.inputs.some(input => input.id === 'fuel' && input.count >= 3));
  assert.ok(refill.inputItems?.some(input => input.defId === 'empty_roks_tank'));
  assert.ok(refill.outputs.some(output => output.defId === 'napalm_mix' && output.count >= 4));
});

test('roks47 flamethrower is stealable from the liquidator issue stash with napalm', () => {
  const world = new World();
  const entities = [];

  generateLiquidatorArchive(world, 0, entities, { v: 1 }, 512, 512);

  const stash = world.containers.find(container =>
    container.inventory.some(item => item.defId === 'roks47_flamethrower')
    && container.inventory.some(item => item.defId === 'napalm_mix' && item.count >= 2)
  );
  assert.ok(stash, 'liquidator archive issue crate should expose ROKS-47 with a napalm reserve');
  assert.equal(stash.faction, Faction.LIQUIDATOR);
  assert.equal(stash.access, 'faction');
  assert.ok(stash.tags.includes('liquidator'));
  assert.ok(stash.tags.includes('issue_stash'));
  assert.ok(stash.tags.includes('napalm'));

  const access = containerAccessInfo(stash, makeTestPlayer());
  assert.equal(access.mode, 'steal');
  assert.equal(access.theft, true);
});
