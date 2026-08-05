import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, ItemType, RoomType } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateLiquidatorArchive } from '../src/gen/ministry/liquidator_archive';
import { containerAccessInfo } from '../src/systems/containers';
import { makeTestPlayer } from './helpers';

test('eralashnikov auto is a liquidator 7.62 automatic rifle', () => {
  const def = ITEMS.eralashnikov_auto;
  const stats = WEAPON_STATS.eralashnikov_auto;

  assert.equal(def.type, ItemType.WEAPON);
  assert.equal(def.name, 'Автомат Ералашникова');
  assert.deepEqual(def.spawnRooms, [RoomType.HQ]);
  assert.equal(WEAPON_ROLE_TIERS.eralashnikov_auto, 'ammo_burn');

  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'ammo_762');
  assert.equal(stats.dmg, 23);
  assert.ok(stats.speed < WEAPON_STATS.ak47.speed, 'eralashnikov_auto should cycle faster than ak47');
  assert.ok((stats.spread ?? 0) > (WEAPON_STATS.ak47.spread ?? 0), 'eralashnikov_auto should spread wider than ak47');
  assert.equal(resourceForItem(stats.ammoType ?? '')?.id, 'ammo');

  for (const tag of ['liquidator', 'rifle', 'ammo_762', 'ammo_burn', 'permit', 'issue_stash']) {
    assert.ok(def.tags?.includes(tag), `eralashnikov_auto item must carry ${tag} tag`);
    assert.ok(ITEM_TAGS.eralashnikov_auto?.includes(tag), `eralashnikov_auto tag registry must publish ${tag}`);
  }
});

test('eralashnikov auto is reachable from the liquidator issue crate as theft', () => {
  const world = new World();
  const entities = [];

  generateLiquidatorArchive(world, 0, entities, { v: 1 }, 512, 512);

  const stash = world.containers.find(container =>
    container.inventory.some(item => item.defId === 'eralashnikov_auto')
    && container.inventory.some(item => item.defId === 'ammo_762' && item.count >= 18)
  );
  assert.ok(stash, 'liquidator archive issue crate should expose eralashnikov_auto with 7.62 reserve');
  assert.equal(stash.faction, Faction.LIQUIDATOR);
  assert.equal(stash.access, 'faction');
  assert.ok(stash.tags.includes('liquidator'));
  assert.ok(stash.tags.includes('issue_stash'));

  const access = containerAccessInfo(stash, makeTestPlayer());
  assert.equal(access.mode, 'steal');
  assert.equal(access.theft, true);
});
