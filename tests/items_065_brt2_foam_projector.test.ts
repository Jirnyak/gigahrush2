import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, ItemType, ProjType } from '../src/core/types';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS, getStack } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateProductionBeltDesignFloor } from '../src/gen/design_floors/production_belt';
import { addItem, consumeAmmo, countAmmo, getWeaponReadiness } from '../src/systems/inventory';
import { containerAccessInfo } from '../src/systems/containers';
import { makeTestPlayer } from './helpers';

test('brt2 foam projector is a rare reusable engineer foam weapon', () => {
  const def = ITEMS.brt2_foam_projector;
  const stats = WEAPON_STATS.brt2_foam_projector;

  assert.equal(def.name, 'БРТ-2 бетономёт');
  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(def.spawnW, 0);
  assert.equal(getStack(def), 1);
  assert.equal(resourceForItem(def.id)?.id, 'ammo');
  assert.equal(WEAPON_ROLE_TIERS.brt2_foam_projector, 'grenade');

  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'foam_grenade_6p10');
  assert.equal(stats.projType, ProjType.GRENADE);
  assert.equal(stats.projSprite, WEAPON_STATS.grenade.projSprite);
  assert.ok((stats.projSpeed ?? 0) > (WEAPON_STATS.foam_grenade_6p10.projSpeed ?? 0));
  assert.ok((stats.aoeRadius ?? 0) < (WEAPON_STATS.foam_grenade_6p10.aoeRadius ?? 0));
  assert.ok(stats.dmg < WEAPON_STATS.foam_grenade_6p10.dmg);

  for (const tag of ['foam', 'projector', 'engineer', 'control', 'immobilizer', 'foam_grenade_ammo', 'rare_engineer_crate']) {
    assert.ok(ITEM_TAGS.brt2_foam_projector?.includes(tag), `brt2 tag registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `brt2 item must carry ${tag}`);
  }
});

test('brt2 consumes 6p10 foam grenade charges instead of itself', () => {
  const player = makeTestPlayer();
  addItem(player, 'brt2_foam_projector', 1);
  addItem(player, 'foam_grenade_6p10', 3);
  player.weapon = 'brt2_foam_projector';

  const readiness = getWeaponReadiness(player);
  assert.equal(readiness.resourceLabel, 'пена 3');
  assert.equal(readiness.damageLabel, '12');
  assert.equal(countAmmo(player), 3);
  assert.equal(consumeAmmo(player), true);
  assert.equal(countAmmo(player), 2);
  assert.equal(player.inventory?.some(item => item.defId === 'brt2_foam_projector'), true);
});

test('brt2 is reachable from the production belt engineer crate as theft', () => {
  const gen = generateProductionBeltDesignFloor();
  const stash = gen.world.containers.find(container =>
    container.inventory.some(item => item.defId === 'brt2_foam_projector') &&
    container.inventory.some(item => item.defId === 'foam_grenade_6p10' && item.count >= 3)
  );

  assert.ok(stash, 'production belt should expose BRT-2 with foam charges');
  assert.equal(stash.faction, Faction.WILD);
  assert.equal(stash.access, 'faction');
  for (const tag of ['engineer', 'foam', 'rare_engineer_crate', 'theft']) {
    assert.ok(stash.tags.includes(tag), `brt2 stash must publish ${tag}`);
  }

  const access = containerAccessInfo(stash, makeTestPlayer());
  assert.equal(access.mode, 'steal');
  assert.equal(access.theft, true);
});
