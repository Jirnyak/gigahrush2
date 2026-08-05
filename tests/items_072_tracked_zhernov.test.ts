import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, ItemType, RoomType } from '../src/core/types';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import { getRouteCueMarkers } from '../src/systems/route_cues';
import { containerAccessInfo } from '../src/systems/containers';
import { makeTestPlayer } from './helpers';

test('tracked zhernov is a route-only heavy finisher on existing melee rules', () => {
  const def = ITEMS.tracked_zhernov;
  const stats = WEAPON_STATS.tracked_zhernov;

  assert.equal(def.type, ItemType.WEAPON);
  assert.equal(def.name, 'Гусеничный жернов');
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(def.spawnW, 0);
  assert.equal(resourceForItem(def.id)?.id, 'metal');
  assert.equal(WEAPON_ROLE_TIERS.tracked_zhernov, 'melee_heavy');

  assert.equal(stats.isRanged, false);
  assert.equal(stats.dmg, 96);
  assert.ok(stats.dmg > WEAPON_STATS.sledgehammer.dmg);
  assert.ok(stats.speed > WEAPON_STATS.sledgehammer.speed);
  assert.ok(stats.durability < WEAPON_STATS.sledgehammer.durability);
  assert.ok((stats.knockback ?? 0) > (WEAPON_STATS.sledgehammer.knockback ?? 0));

  for (const tag of ['liquidator', 'stationary', 'production_belt', 'regenerator_finisher', 'sobrannyy_counterplay', 'theft']) {
    assert.ok(def.tags?.includes(tag), `tracked_zhernov item must publish ${tag} tag`);
    assert.ok(ITEM_TAGS.tracked_zhernov?.includes(tag), `tracked_zhernov tag registry must publish ${tag}`);
  }
});

test('production belt exposes tracked zhernov as an authored route machine theft', () => {
  const gen = generateDesignFloor('production_belt');
  const machines = gen.world.containers.filter(container =>
    container.inventory.some(item => item.defId === 'tracked_zhernov')
  );

  assert.equal(machines.length, 1);
  const machine = machines[0];
  const room = gen.world.rooms[machine.roomId ?? -1];
  assert.equal(room?.type, RoomType.PRODUCTION);
  assert.equal(machine.faction, Faction.LIQUIDATOR);
  assert.equal(machine.access, 'faction');
  assert.ok(machine.tags.includes('mounted_weapon'));
  assert.ok(machine.tags.includes('stationary'));
  assert.ok(machine.tags.includes('authored_route'));
  assert.ok(machine.tags.includes('regenerator_finisher'));
  assert.equal(machine.inventory.find(item => item.defId === 'tracked_zhernov')?.count, 1);

  const cues = getRouteCueMarkers(gen.world);
  const cue = cues.find(marker => marker.id === 'production_belt_tracked_zhernov');
  assert.ok(cue, 'production belt should advertise the tracked zhernov machine');
  assert.ok(cue.tags.includes('tracked_zhernov'));
  assert.equal(cue.targetName, machine.name);

  const access = containerAccessInfo(machine, makeTestPlayer());
  assert.equal(access.mode, 'steal');
  assert.equal(access.theft, true);
});
