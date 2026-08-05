import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, ItemType, RoomType } from '../src/core/types';
import { World } from '../src/core/world';
import { WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateLiquidatorArchive } from '../src/gen/ministry/liquidator_archive';

test('zatychkin pistol is an officer burst sidearm on existing 9mm projectile behavior', () => {
  const def = ITEMS.zatychkin_pistol;
  const stats = WEAPON_STATS.zatychkin_pistol;

  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.OFFICE]);
  assert.ok(def.value > ITEMS.makarov.value);
  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'ammo_9mm');
  assert.equal(stats.projSprite, WEAPON_STATS.makarov.projSprite);
  assert.ok(stats.speed < WEAPON_STATS.makarov.speed, 'Zatychkin must trade ammo for a faster tempo than PM');
  assert.ok((stats.spread ?? 0) > (WEAPON_STATS.makarov.spread ?? 0), 'faster sidearm needs wider spread than PM');
  assert.equal(WEAPON_ROLE_TIERS.zatychkin_pistol, 'pistol_sidegrade');
  assert.equal(resourceForItem(stats.ammoType ?? '')?.id, 'ammo');

  for (const tag of ['liquidator', 'sidearm', 'officer', 'ovb', 'burst']) {
    assert.ok(def.tags?.includes(tag), `zatychkin_pistol item must publish ${tag} tag`);
    assert.ok(ITEM_TAGS.zatychkin_pistol?.includes(tag), `zatychkin_pistol registry must publish ${tag} tag`);
  }
});

test('zatychkin pistol is reachable from the Ministry liquidator officer stash', () => {
  const world = new World();
  const entities = [];

  generateLiquidatorArchive(world, 0, entities, { v: 1 }, 512, 512);

  const stash = world.containers.find(container => container.inventory.some(item => item.defId === 'zatychkin_pistol'));
  assert.ok(stash, 'liquidator archive should expose zatychkin_pistol');
  assert.equal(stash.faction, Faction.LIQUIDATOR);
  assert.equal(stash.access, 'faction');
  for (const tag of ['liquidator', 'officer', 'ovb', 'theft']) {
    assert.ok(stash.tags.includes(tag), `officer stash must publish ${tag} tag`);
  }
});
