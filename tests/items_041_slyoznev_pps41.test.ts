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

test('slyoznev pps41 is an early liquidator SMG with fast ammo burn', () => {
  const def = ITEMS.slyoznev_pps41;
  const stats = WEAPON_STATS.slyoznev_pps41;

  assert.equal(def.type, ItemType.WEAPON);
  assert.equal(def.name, 'ППС-41 Слизнёва');
  assert.ok(def.spawnRooms.includes(RoomType.HQ));
  assert.equal(WEAPON_ROLE_TIERS.slyoznev_pps41, 'ammo_burn');

  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'ammo_9mm');
  assert.equal(stats.dmg, 7);
  assert.ok(stats.speed < WEAPON_STATS.ppsh.speed, 'slyoznev_pps41 should burn ammo faster than ppsh');
  assert.ok((stats.spread ?? 0) > (WEAPON_STATS.ppsh.spread ?? 0), 'slyoznev_pps41 should be less stable than ppsh');
  assert.equal(resourceForItem(stats.ammoType ?? '')?.id, 'ammo');

  for (const tag of ['liquidator', 'smg', 'ammo_9mm', 'ammo_burn', 'recruit_stash']) {
    assert.ok(ITEM_TAGS.slyoznev_pps41?.includes(tag), `slyoznev_pps41 must publish ${tag} tag`);
    assert.ok(def.tags?.includes(tag), `slyoznev_pps41 item must carry ${tag} tag`);
  }
});

test('slyoznev pps41 is reachable from the Ministry liquidator recruit stash', () => {
  const world = new World();
  const entities = [];

  generateLiquidatorArchive(world, 0, entities, { v: 1 }, 512, 512);

  const stash = world.containers.find(container => container.inventory.some(item => item.defId === 'slyoznev_pps41'));
  assert.ok(stash, 'liquidator archive recruit stash should expose slyoznev_pps41');
  assert.equal(stash.faction, Faction.LIQUIDATOR);
  assert.equal(stash.access, 'faction');
  assert.ok(stash.tags.includes('liquidator'));
  assert.ok(stash.tags.includes('recruit_stash'));

  const access = containerAccessInfo(stash, makeTestPlayer());
  assert.equal(access.mode, 'steal');
  assert.equal(access.theft, true);
});
