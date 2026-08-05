import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, ItemType, ProjType } from '../src/core/types';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateProductionBeltDesignFloor } from '../src/gen/design_floors/production_belt';
import { addItem, consumeAmmo, countAmmo, getWeaponReadiness } from '../src/systems/inventory';
import { containerAccessInfo } from '../src/systems/containers';
import { makeTestPlayer } from './helpers';

test('pbrog1 foam launcher is an executable one-shot foam launcher', () => {
  const def = ITEMS.pbrog1_foam_launcher;
  const stats = WEAPON_STATS.pbrog1_foam_launcher;

  assert.equal(def.name, 'ПБРОГ-1');
  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(def.spawnW, 0);
  assert.equal(resourceForItem(def.id)?.id, 'ammo');
  assert.equal(WEAPON_ROLE_TIERS.pbrog1_foam_launcher, 'grenade');

  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'pbrog1_foam_launcher');
  assert.equal(stats.projType, ProjType.GRENADE);
  assert.equal(stats.aoeRadius, 4.8);
  assert.ok((stats.projSpeed ?? 0) > (WEAPON_STATS.foam_grenade_6p10.projSpeed ?? 0));
  assert.ok((stats.aoeRadius ?? 0) < (WEAPON_STATS.foam_grenade_6p10.aoeRadius ?? 0));

  for (const tag of ['foam', 'launcher', 'engineer', 'single_use', 'control', 'rare_engineer_crate']) {
    assert.ok(ITEM_TAGS.pbrog1_foam_launcher?.includes(tag), `pbrog1 tag registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `pbrog1 item must carry ${tag}`);
  }
});

test('pbrog1 foam launcher consumes itself as the one shot', () => {
  const player = makeTestPlayer();
  addItem(player, 'pbrog1_foam_launcher', 1);
  player.weapon = 'pbrog1_foam_launcher';

  const readiness = getWeaponReadiness(player);
  assert.equal(readiness.resourceLabel, 'ПБРОГ 1');
  assert.equal(readiness.damageLabel, '24');
  assert.equal(countAmmo(player), 1);
  assert.equal(consumeAmmo(player), true);
  assert.equal(countAmmo(player), 0);
  assert.equal(player.inventory?.some(item => item.defId === 'pbrog1_foam_launcher'), false);
});

test('pbrog1 foam launcher is reachable from a rare engineer crate as theft', () => {
  const gen = generateProductionBeltDesignFloor();
  const stash = gen.world.containers.find(container =>
    container.inventory.some(item => item.defId === 'pbrog1_foam_launcher')
  );

  assert.ok(stash, 'production belt should expose a rare engineer foam crate');
  assert.equal(stash.faction, Faction.WILD);
  assert.equal(stash.access, 'faction');
  for (const tag of ['engineer', 'foam', 'rare_engineer_crate', 'theft']) {
    assert.ok(stash.tags.includes(tag), `pbrog1 stash must publish ${tag}`);
  }

  const access = containerAccessInfo(stash, makeTestPlayer());
  assert.equal(access.mode, 'steal');
  assert.equal(access.theft, true);
});
