import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, Faction, ItemType, ProjType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { ITEM_TAGS, getStack } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateLiquidatorArchive } from '../src/gen/ministry/liquidator_archive';
import { containerAccessInfo } from '../src/systems/containers';
import { addItem, consumeAmmo, countAmmo, getWeaponReadiness } from '../src/systems/inventory';
import { makeTestPlayer } from './helpers';

test('foam grenade 6p10 is a self-ammo liquidator control grenade', () => {
  const def = ITEMS.foam_grenade_6p10;
  const stats = WEAPON_STATS.foam_grenade_6p10;

  assert.equal(def.type, ItemType.WEAPON);
  assert.equal(def.name, 'Пенобетонная граната 6П10');
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.PRODUCTION]);
  assert.equal(getStack(def), 6);
  assert.equal(resourceForItem(def.id)?.id, 'ammo');
  assert.equal(WEAPON_ROLE_TIERS.foam_grenade_6p10, 'grenade');

  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, def.id);
  assert.equal(stats.projType, ProjType.GRENADE);
  assert.equal(stats.projSprite, WEAPON_STATS.grenade.projSprite);
  assert.ok((stats.aoeRadius ?? 0) > (WEAPON_STATS.grenade.aoeRadius ?? 0), 'foam should cover a wider control area than a damage grenade');
  assert.ok(stats.dmg < WEAPON_STATS.grenade.dmg, 'foam should control without becoming a stronger explosive');

  for (const tag of ['liquidator', 'foam', 'grenade', 'control', 'self_ammo', 'issue_stash', 'panic_control']) {
    assert.ok(def.tags?.includes(tag), `foam grenade item must carry ${tag} tag`);
    assert.ok(ITEM_TAGS.foam_grenade_6p10?.includes(tag), `foam grenade tag registry must publish ${tag}`);
  }
});

test('foam grenade consumes its own stack as throw ammo', () => {
  const player = makeTestPlayer();

  assert.equal(addItem(player, 'foam_grenade_6p10', 3), true);
  player.weapon = 'foam_grenade_6p10';

  const readiness = getWeaponReadiness(player);
  assert.equal(readiness.resourceLabel, 'пена 3');
  assert.equal(countAmmo(player), 3);
  assert.equal(consumeAmmo(player), true);
  assert.equal(countAmmo(player), 2);
});

test('foam grenade is reachable from liquidator crates as stealable issue gear', () => {
  const weaponCrate = CONTAINER_DEFS[ContainerKind.WEAPON_CRATE].itemPool;
  assert.ok(weaponCrate.some(entry => entry.defId === 'foam_grenade_6p10'), 'generic liquidator weapon crates should expose foam grenades');

  const world = new World();
  const entities: Entity[] = [];
  generateLiquidatorArchive(world, 0, entities, { v: 1 }, 512, 512);

  const stash = world.containers.find(container =>
    container.inventory.some(item => item.defId === 'foam_grenade_6p10' && item.count >= 2)
  );
  assert.ok(stash, 'liquidator archive crate should expose a small foam grenade stack');
  assert.equal(stash.faction, Faction.LIQUIDATOR);
  assert.equal(stash.access, 'faction');
  for (const tag of ['liquidator', 'issue_stash', 'control', 'theft']) {
    assert.ok(stash.tags.includes(tag), `foam grenade stash must publish ${tag} tag`);
  }

  const access = containerAccessInfo(stash, makeTestPlayer());
  assert.equal(access.mode, 'steal');
  assert.equal(access.theft, true);
});
