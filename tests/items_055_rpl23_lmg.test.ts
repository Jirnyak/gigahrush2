import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, ItemType, RoomType } from '../src/core/types';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateProductionBeltDesignFloor } from '../src/gen/design_floors/production_belt';
import { containerAccessInfo } from '../src/systems/containers';
import { makeTestPlayer } from './helpers';

test('rpl23 lmg is a heavy liquidator squad weapon with belt ammo pressure', () => {
  const def = ITEMS.rpl23_lmg;
  const stats = WEAPON_STATS.rpl23_lmg;

  assert.equal(def.name, 'РПЛ-23 Лёшкинского');
  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ]);
  assert.ok(def.value >= 5_000);
  assert.equal(resourceForItem(def.id)?.id, 'ammo');
  assert.equal(WEAPON_ROLE_TIERS.rpl23_lmg, 'ammo_burn');

  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'ammo_belt');
  assert.equal(resourceForItem(stats.ammoType ?? '')?.id, 'ammo');
  assert.equal(stats.dmg, 14);
  assert.ok(stats.speed < WEAPON_STATS.ak47.speed, 'RPL-23 should burn ammo faster than AK-47');
  assert.ok(stats.speed > WEAPON_STATS.machinegun.speed, 'RPL-23 should stay below the generic PKM burn rate');
  assert.ok((stats.spread ?? 0) < (WEAPON_STATS.machinegun.spread ?? 0), 'RPL-23 should be more controlled than PKM');

  for (const tag of ['liquidator', 'lmg', 'ammo_belt', 'ammo_burn', 'engineer_stash', 'deep_route']) {
    assert.ok(def.tags?.includes(tag), `rpl23_lmg item must carry ${tag} tag`);
    assert.ok(ITEM_TAGS.rpl23_lmg?.includes(tag), `rpl23_lmg tag registry must publish ${tag} tag`);
  }
});

test('rpl23 lmg is stealable from the Production Belt ammo line with belt ammo', () => {
  const generated = generateProductionBeltDesignFloor();
  const stash = generated.world.containers.find(container =>
    container.inventory.some(item => item.defId === 'rpl23_lmg')
  );

  assert.ok(stash, 'Production Belt ammo line should expose rpl23_lmg');
  assert.equal(stash.faction, Faction.WILD);
  assert.equal(stash.access, 'faction');
  for (const tag of ['production_output', 'illegal_ammo_smelter', 'ammo', 'weapon', 'theft']) {
    assert.ok(stash.tags.includes(tag), `rpl23_lmg stash must publish ${tag} tag`);
  }
  assert.equal(stash.inventory.some(item => item.defId === 'ammo_belt' && item.count >= 40), true);

  const access = containerAccessInfo(stash, makeTestPlayer());
  assert.equal(access.mode, 'steal');
  assert.equal(access.theft, true);
});
