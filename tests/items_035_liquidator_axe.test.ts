import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, ItemType, RoomType } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateLiquidatorArchive } from '../src/gen/ministry/liquidator_archive';
import { isBloodPlantCuttingWeapon } from '../src/systems/blood_plant';
import { isBorshchevikCuttingWeapon } from '../src/systems/borshchevik';
import { isPaupsinaWebCuttingWeapon } from '../src/systems/status';

test('liquidator axe is a slow durable cleanup sidegrade to axe', () => {
  const def = ITEMS.liquidator_axe;
  const stats = WEAPON_STATS.liquidator_axe;
  const baseAxe = WEAPON_STATS.axe;

  assert.equal(def.name, 'Топор ликвидатора');
  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.PRODUCTION]);
  assert.equal(resourceForItem(def.id)?.id, 'metal');
  assert.equal(WEAPON_ROLE_TIERS.liquidator_axe, 'melee_heavy');

  assert.equal(stats.dmg, 38);
  assert.equal(stats.durability, 110);
  assert.ok(stats.durability > baseAxe.durability);
  assert.ok(stats.speed > baseAxe.speed);
  assert.equal(stats.isRanged, false);

  for (const tag of ['liquidator', 'cleanup', 'slime_counterplay', 'door_work']) {
    assert.ok(ITEM_TAGS.liquidator_axe?.includes(tag), `liquidator_axe must publish ${tag} tag`);
    assert.ok(def.tags?.includes(tag), `liquidator_axe item def must include ${tag} tag`);
  }
});

test('liquidator axe is reachable from a liquidator weapon crate and works as an axe counter', () => {
  const world = new World();
  const entities = [];

  generateLiquidatorArchive(world, 0, entities, { v: 1 }, 512, 512);

  const stash = world.containers.find(container => container.inventory.some(item => item.defId === 'liquidator_axe'));
  assert.ok(stash, 'liquidator archive should expose liquidator_axe');
  assert.equal(stash.faction, Faction.LIQUIDATOR);
  assert.equal(stash.access, 'faction');
  assert.ok(stash.tags.includes('liquidator'));

  assert.equal(isBorshchevikCuttingWeapon('liquidator_axe'), true);
  assert.equal(isBloodPlantCuttingWeapon('liquidator_axe'), true);
  assert.equal(isPaupsinaWebCuttingWeapon('liquidator_axe'), true);
});
