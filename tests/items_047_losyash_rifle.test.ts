import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { makeProceduralFloorSpec } from '../src/data/procedural_floors';
import { resourceForItem } from '../src/data/resources';
import { generateProceduralFloor } from '../src/gen/procedural_floor';

test('losyash rifle is a rare anti-elite precision weapon on bolt projectile rules', () => {
  const def = ITEMS.losyash_rifle;
  const stats = WEAPON_STATS.losyash_rifle;

  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, [RoomType.STORAGE, RoomType.HQ]);
  assert.equal(resourceForItem(def.id)?.id, 'ammo');
  assert.equal(WEAPON_ROLE_TIERS.losyash_rifle, 'rifle_precision');
  assert.equal(stats.ammoType, 'rifle_bolt_pack');
  assert.equal(stats.projSprite, WEAPON_STATS.harpoon_gun.projSprite);
  assert.ok(stats.dmg > WEAPON_STATS.harpoon_gun.dmg);
  assert.ok(stats.dmg < WEAPON_STATS.gauss.dmg);
  assert.ok(stats.speed > WEAPON_STATS.harpoon_gun.speed);
  assert.ok((stats.spread ?? 1) <= (WEAPON_STATS.harpoon_gun.spread ?? 0));

  for (const tag of ['liquidator', 'rifle', 'precision', 'anti_elite', 'rifle_bolt_pack', 'deep_recon_stash']) {
    assert.ok(def.tags?.includes(tag), `losyash_rifle item must publish ${tag} tag`);
    assert.ok(ITEM_TAGS.losyash_rifle?.includes(tag), `losyash_rifle registry must publish ${tag} tag`);
  }
});

test('losyash rifle is reachable from a deep procedural recon stash', () => {
  const spec = makeProceduralFloorSpec(1, -49);

  assert.equal(spec.geometryId, 'sump_causeways');
  assert.equal(spec.danger, 5);
  assert.ok(spec.lootBiasIds.includes('losyash_rifle'));
  assert.ok(spec.lootBiasIds.includes('rifle_bolt_pack'));

  const generated = generateProceduralFloor(spec);
  const stash = generated.world.containers.find(container =>
    container.tags.includes('deep_recon_stash')
    && container.inventory.some(item => item.defId === 'losyash_rifle')
  );

  assert.ok(stash, 'deep sump procedural floor should expose losyash_rifle in a stash');
  assert.equal(stash.inventory.find(item => item.defId === 'rifle_bolt_pack')?.count, 3);
  assert.ok(stash.tags.includes('deep_recon_stash'));
  assert.ok(stash.tags.includes('rifle_bolt_pack'));
  assert.ok(stash.tags.includes('stash'));
  assert.ok(stash.tags.includes('sump_causeways'));
  assert.ok(stash.tags.includes('danger_5'));
});
