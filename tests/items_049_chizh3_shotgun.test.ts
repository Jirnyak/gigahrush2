import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, ItemType, RoomType } from '../src/core/types';
import { World } from '../src/core/world';
import { WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateLiquidatorArchive } from '../src/gen/ministry/liquidator_archive';
import { containerAccessInfo } from '../src/systems/containers';
import { makeTestPlayer } from './helpers';

test('chizh3 shotgun is an official liquidator pump shotgun using existing shell mechanics', () => {
  const def = ITEMS.chizh3_shotgun;
  const stats = WEAPON_STATS.chizh3_shotgun;

  assert.equal(def.name, 'ЧИЖ-3');
  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.STORAGE]);
  assert.equal(WEAPON_ROLE_TIERS.chizh3_shotgun, 'shotgun_corridor_stop');

  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'ammo_shells');
  assert.equal(resourceForItem(stats.ammoType ?? '')?.id, 'ammo');
  assert.equal(stats.pellets, 8);
  assert.ok(stats.speed < WEAPON_STATS.toz_shotgun.speed, 'Chizh-3 should pump faster than TOZ');
  assert.ok((stats.spread ?? 0) < (WEAPON_STATS.shotgun.spread ?? 0), 'Chizh-3 should be tighter than the obrez');

  for (const tag of ['liquidator', 'shotgun', 'ammo_shells', 'permit', 'issue_stash', 'corridor_stop']) {
    assert.ok(ITEM_TAGS.chizh3_shotgun?.includes(tag), `chizh3_shotgun registry must publish ${tag} tag`);
    assert.ok(def.tags?.includes(tag), `chizh3_shotgun item must carry ${tag} tag`);
  }
});

test('chizh3 shotgun is reachable from a liquidator issue stash with shells', () => {
  const world = new World();
  const entities = [];

  generateLiquidatorArchive(world, 0, entities, { v: 1 }, 512, 512);

  const stash = world.containers.find(container => container.inventory.some(item => item.defId === 'chizh3_shotgun'));
  assert.ok(stash, 'liquidator archive should expose chizh3_shotgun');
  assert.equal(stash.faction, Faction.LIQUIDATOR);
  assert.equal(stash.access, 'faction');
  assert.ok(stash.tags.includes('liquidator'));
  assert.ok(stash.tags.includes('issue_stash'));
  assert.ok(stash.tags.includes('shotgun'));
  assert.equal(stash.inventory.some(item => item.defId === 'ammo_shells' && item.count >= 8), true);

  const access = containerAccessInfo(stash, makeTestPlayer());
  assert.equal(access.mode, 'steal');
  assert.equal(access.theft, true);
});
