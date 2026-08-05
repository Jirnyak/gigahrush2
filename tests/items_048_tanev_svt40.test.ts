import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType } from '../src/core/types';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { resourceForItem } from '../src/data/resources';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';

test('tanev_svt40 is a precise 7.62 route weapon without new projectile hooks', () => {
  const def = ITEMS.tanev_svt40;
  assert.equal(def.type, ItemType.WEAPON);
  assert.equal(def.spawnW, 0);
  assert.deepEqual(def.spawnRooms, []);

  const stats = WEAPON_STATS.tanev_svt40;
  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'ammo_762');
  assert.equal(stats.pellets, 1);
  assert.ok((stats.spread ?? 1) <= 0.003);
  assert.equal(stats.projType, undefined);
  assert.equal(stats.deletionBeam, undefined);
  assert.equal(WEAPON_ROLE_TIERS.tanev_svt40, 'rifle_precision');
  assert.equal(resourceForItem('ammo_762')?.id, 'ammo');
});

test('darkness long-route stash carries the only tanev_svt40 reward', () => {
  const gen = generateDesignFloor('darkness');
  const stashes = gen.world.containers.filter(container =>
    container.inventory.some(item => item.defId === 'tanev_svt40'),
  );

  assert.equal(stashes.length, 1);
  const stash = stashes[0];
  assert.equal(stash.tags.includes('darkness'), true);
  assert.equal(stash.tags.includes('long_route'), true);
  assert.equal(stash.tags.includes('sniper_reward'), true);
  assert.equal(stash.inventory.find(item => item.defId === 'tanev_svt40')?.count, 1);
  assert.equal(stash.inventory.find(item => item.defId === 'ammo_762')?.count, 6);
});
