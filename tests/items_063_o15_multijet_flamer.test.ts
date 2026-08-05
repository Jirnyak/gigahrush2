import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, ItemType, ProjType, RoomType } from '../src/core/types';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { makeProceduralFloorSpec } from '../src/data/procedural_floors';
import { resourceForItem } from '../src/data/resources';
import { generateProceduralFloor } from '../src/gen/procedural_floor';
import { containerAccessInfo } from '../src/systems/containers';
import { makeTestPlayer } from './helpers';

test('o15 multijet flamer is a focused engineer napalm weapon without new projectile hooks', () => {
  const def = ITEMS.o15_multijet_flamer;
  const stats = WEAPON_STATS.o15_multijet_flamer;

  assert.equal(def.name, '6О15-УТТХ');
  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.PRODUCTION]);
  assert.equal(resourceForItem(def.id)?.id, 'fuel');
  assert.equal(WEAPON_ROLE_TIERS.o15_multijet_flamer, 'fuel_clear');

  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'napalm_mix');
  assert.equal(resourceForItem(stats.ammoType ?? '')?.id, 'fuel');
  assert.equal(stats.projType, ProjType.FLAME);
  assert.equal(stats.projSprite, WEAPON_STATS.roks47_flamethrower.projSprite);
  assert.equal(stats.dmg, 6);
  assert.equal(stats.pellets, 3);
  assert.ok(stats.speed > WEAPON_STATS.roks47_flamethrower.speed, '6О15 should not out-DPS the ROKS-47');
  assert.ok((stats.spread ?? 1) < (WEAPON_STATS.roks47_flamethrower.spread ?? 0), 'breach jets should be narrower than ROKS spray');

  for (const tag of ['liquidator', 'engineer', 'flame', 'breach', 'napalm', 'deep_engineer_stash']) {
    assert.ok(def.tags?.includes(tag), `o15_multijet_flamer item must carry ${tag} tag`);
    assert.ok(ITEM_TAGS.o15_multijet_flamer?.includes(tag), `o15_multijet_flamer registry must publish ${tag} tag`);
  }
});

test('o15 multijet flamer is reachable from a deep engineer stash with napalm', () => {
  const spec = makeProceduralFloorSpec(1, -34);

  assert.equal(spec.geometryId, 'workshops');
  assert.equal(spec.majorityId, 'liquidators');
  assert.ok(spec.depth >= 30);
  assert.ok(spec.danger >= 4);

  const generated = generateProceduralFloor(spec);
  const stash = generated.world.containers.find(container =>
    container.inventory.some(item => item.defId === 'o15_multijet_flamer'),
  );

  assert.ok(stash, 'deep liquidator workshop should expose o15_multijet_flamer');
  assert.equal(stash.faction, Faction.LIQUIDATOR);
  assert.equal(stash.access, 'faction');
  for (const tag of ['deep_engineer_stash', 'engineer', 'breach', 'napalm', 'fuel', 'theft']) {
    assert.ok(stash.tags.includes(tag), `engineer stash must publish ${tag} tag`);
  }
  assert.equal(stash.inventory.find(item => item.defId === 'o15_multijet_flamer')?.count, 1);
  assert.equal(stash.inventory.find(item => item.defId === 'napalm_mix')?.count, 3);

  const access = containerAccessInfo(stash, makeTestPlayer());
  assert.equal(access.mode, 'steal');
  assert.equal(access.theft, true);
});
