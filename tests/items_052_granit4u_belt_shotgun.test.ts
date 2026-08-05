import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, ItemType, RoomType } from '../src/core/types';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { makeProceduralFloorSpec, PROCEDURAL_LOOT_VALUE_CAP_BY_DANGER } from '../src/data/procedural_floors';
import { resourceForItem } from '../src/data/resources';
import { generateProceduralFloor } from '../src/gen/procedural_floor';
import { containerAccessInfo } from '../src/systems/containers';
import { makeTestPlayer } from './helpers';

test('granit4u belt shotgun is a slow crowd-control shell weapon', () => {
  const def = ITEMS.granit4u_belt_shotgun;
  const stats = WEAPON_STATS.granit4u_belt_shotgun;

  assert.equal(def.name, '«Гранит»-4у');
  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ]);
  assert.ok(def.value >= 100_000);
  assert.ok(def.value <= PROCEDURAL_LOOT_VALUE_CAP_BY_DANGER[5]);
  assert.ok(def.value > PROCEDURAL_LOOT_VALUE_CAP_BY_DANGER[4]);
  assert.equal(resourceForItem(def.id)?.id, 'ammo');

  assert.equal(WEAPON_ROLE_TIERS.granit4u_belt_shotgun, 'shotgun_corridor_stop');
  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'ammo_shells');
  assert.equal(resourceForItem(stats.ammoType ?? '')?.id, 'ammo');
  assert.equal(stats.pellets, 12);
  assert.ok((stats.spread ?? 0) > (WEAPON_STATS.rb91_auto_shotgun.spread ?? 0));
  assert.ok(stats.speed > WEAPON_STATS.toz_shotgun.speed);
  assert.ok(
    (stats.dmg * (stats.pellets ?? 1)) / stats.speed <
      (WEAPON_STATS.shotgun.dmg * (WEAPON_STATS.shotgun.pellets ?? 1)) / WEAPON_STATS.shotgun.speed,
    'Granit-4u should stop a crowd but lose sustained DPS to the common obrez',
  );

  for (const tag of ['liquidator', 'shotgun', 'ammo_shells', 'belt_feed', 'crowd_control', 'deep_liquidator_reward']) {
    assert.ok(ITEM_TAGS.granit4u_belt_shotgun?.includes(tag), `granit4u_belt_shotgun registry must publish ${tag} tag`);
    assert.ok(def.tags?.includes(tag), `granit4u_belt_shotgun item must carry ${tag} tag`);
  }
});

test('granit4u is reachable as a deep liquidator procedural reward theft', () => {
  const spec = makeProceduralFloorSpec(5, -46);

  assert.equal(spec.danger, 5);
  assert.equal(spec.majorityId, 'liquidators');
  assert.ok(spec.lootBiasIds.includes('granit4u_belt_shotgun'));

  const generated = generateProceduralFloor(spec);
  const stash = generated.world.containers.find(container =>
    container.inventory.some(item => item.defId === 'granit4u_belt_shotgun')
  );

  assert.ok(stash, 'deep liquidator procedural floor should expose granit4u_belt_shotgun in a stash');
  assert.equal(stash.faction, Faction.LIQUIDATOR);
  assert.equal(stash.access, 'faction');
  assert.ok(stash.tags.includes('liquidator_stock'));
  assert.ok(stash.tags.includes('danger_5'));
  assert.ok(stash.tags.includes(`value_cap_${PROCEDURAL_LOOT_VALUE_CAP_BY_DANGER[5]}`));
  assert.equal(stash.inventory.find(item => item.defId === 'granit4u_belt_shotgun')?.count, 1);

  const access = containerAccessInfo(stash, makeTestPlayer());
  assert.equal(access.mode, 'steal');
  assert.equal(access.theft, true);
});
