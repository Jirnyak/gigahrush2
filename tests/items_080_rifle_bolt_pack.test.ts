import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType } from '../src/core/types';
import { ITEMS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { makeProceduralFloorSpec } from '../src/data/procedural_floors';
import { resourceForItem } from '../src/data/resources';
import { generateProceduralFloor } from '../src/gen/procedural_floor';

test('rifle bolt pack is scarce Losyash rifle ammunition', () => {
  const def = ITEMS.rifle_bolt_pack;

  assert.equal(def.name, 'Полимерные болты');
  assert.equal(def.type, ItemType.AMMO);
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(def.spawnW, 0);
  assert.equal(resourceForItem(def.id)?.id, 'ammo');
  assert.equal(WEAPON_STATS.losyash_rifle.ammoType, def.id);
  assert.equal(WEAPON_STATS.losyash_rifle.projSprite, WEAPON_STATS.harpoon_gun.projSprite);

  for (const tag of ['ammo', 'liquidator', 'rifle', 'polymer_bolt', 'anti_elite', 'deep_recon_stash']) {
    assert.ok(def.tags?.includes(tag), `rifle_bolt_pack item must carry ${tag} tag`);
    assert.ok(ITEM_TAGS.rifle_bolt_pack?.includes(tag), `rifle_bolt_pack registry must publish ${tag} tag`);
  }
});

test('rifle bolt pack is reachable from the deep sump recon stash', () => {
  const spec = makeProceduralFloorSpec(1, -49);

  assert.equal(spec.geometryId, 'sump_causeways');
  assert.ok(spec.lootBiasIds.includes('rifle_bolt_pack'));
  assert.ok(spec.lootBiasIds.includes('losyash_rifle'));

  const generated = generateProceduralFloor(spec);
  const stash = generated.world.containers.find(container =>
    container.tags.includes('deep_recon_stash') &&
    container.inventory.some(item => item.defId === 'rifle_bolt_pack')
  );

  assert.ok(stash, 'deep sump procedural floor should expose rifle_bolt_pack');
  assert.equal(stash.access, 'secret');
  assert.equal(stash.inventory.find(item => item.defId === 'rifle_bolt_pack')?.count, 3);
  assert.equal(stash.inventory.find(item => item.defId === 'losyash_rifle')?.count, 1);
});
