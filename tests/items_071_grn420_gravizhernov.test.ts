import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, ItemType, MonsterKind, ProjType } from '../src/core/types';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';

test('grn420 gravizhernov is a rare energy AoE weapon without a new projectile hook', () => {
  const item = ITEMS.grn420_gravizhernov;
  const stats = WEAPON_STATS.grn420_gravizhernov;

  assert.equal(item.type, ItemType.WEAPON);
  assert.equal(item.spawnW, 0);
  assert.deepEqual(item.spawnRooms, []);
  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'ammo_energy');
  assert.equal(stats.projType, ProjType.BFG);
  assert.equal(stats.deletionBeam, undefined);
  assert.ok((stats.aoeRadius ?? 0) >= 7);
  assert.ok(stats.speed > WEAPON_STATS.bfg.speed);
  assert.equal(WEAPON_ROLE_TIERS.grn420_gravizhernov, 'rare_energy');
  assert.equal(resourceForItem('ammo_energy')?.id, 'electronics');

  for (const tag of ['gravity_aoe', 'liquidator', 'veteran', 'silicon_net_well']) {
    assert.ok(ITEM_TAGS.grn420_gravizhernov?.includes(tag), `grn420_gravizhernov must publish ${tag} tag`);
  }
});

test('silicon NET well vault exposes the only grn420 behind a guarded locked route stash', () => {
  const gen = generateDesignFloor('silicon_net_well');
  const stashes = gen.world.containers.filter(container =>
    container.inventory.some(item => item.defId === 'grn420_gravizhernov'),
  );

  assert.equal(stashes.length, 1);
  const stash = stashes[0];
  assert.equal(stash.access, 'locked');
  assert.ok(stash.tags.includes('silicon_net_well'));
  assert.ok(stash.tags.includes('grn420'));
  assert.equal(stash.inventory.find(item => item.defId === 'grn420_gravizhernov')?.count, 1);
  assert.equal(stash.inventory.find(item => item.defId === 'ammo_energy')?.count, 3);

  const guard = gen.entities.find(e =>
    e.type === EntityType.MONSTER &&
    e.monsterKind === MonsterKind.SAFEGUARD &&
    gen.world.dist(e.x, e.y, stash.x, stash.y) < 48,
  );
  assert.ok(guard, 'grn420 vault should stay guarded by a nearby Safeguard');
});
