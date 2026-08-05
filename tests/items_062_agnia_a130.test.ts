import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, ItemType, ProjType, RoomType } from '../src/core/types';
import { World } from '../src/core/world';
import { WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateBrownSlimeCleanup } from '../src/gen/maintenance/brown_slime_cleanup';

function itemDropIds(entities: { type: EntityType; inventory?: { defId: string }[] }[]): string[] {
  return entities
    .filter(entity => entity.type === EntityType.ITEM_DROP)
    .flatMap(entity => entity.inventory?.map(item => item.defId) ?? []);
}

test('agnia A-130 is a low-damage liquidator flame cleanup sidegrade', () => {
  const def = ITEMS.agnia_a130;
  const stats = WEAPON_STATS.agnia_a130;
  const base = WEAPON_STATS.flamethrower;

  assert.equal(def.name, 'А-130 «Агния»');
  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, [RoomType.PRODUCTION, RoomType.HQ]);
  assert.equal(WEAPON_ROLE_TIERS.agnia_a130, 'fuel_clear');

  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'ammo_fuel');
  assert.equal(resourceForItem(stats.ammoType ?? '')?.id, 'fuel');
  assert.equal(stats.projType, ProjType.FLAME);
  assert.equal(stats.pellets, 2);
  assert.ok(stats.dmg < base.dmg, 'A-130 should hit softer than the generic flamethrower');
  assert.ok(stats.speed > base.speed, 'A-130 should trade combat DPS for steadier cleanup coverage');
  assert.ok((stats.spread ?? 0) < (base.spread ?? 0), 'A-130 should make a tighter sanitary corridor');

  for (const tag of ['liquidator', 'flame', 'cleanup', 'sanitary', 'slime_counterplay', 'technical_cleanup', 'fuel_clear']) {
    assert.ok(ITEM_TAGS.agnia_a130?.includes(tag), `agnia_a130 registry must publish ${tag} tag`);
    assert.ok(def.tags?.includes(tag), `agnia_a130 item must carry ${tag} tag`);
  }
});

test('agnia A-130 is reachable from the Maintenance brown-slime cleanup room with fuel', () => {
  const world = new World();
  const entities = [];

  generateBrownSlimeCleanup({ world, entities, nextId: { v: 1 }, spawnX: 512, spawnY: 512 });

  const room = world.rooms.find(entry => entry.name === 'Сухой обход: коричневая слизь');
  assert.ok(room, 'brown slime cleanup room should be generated');

  const drops = itemDropIds(entities);
  assert.ok(drops.includes('agnia_a130'), 'cleanup room should expose the A-130 sanitary flamethrower');
  assert.ok(drops.includes('ammo_fuel'), 'cleanup room should expose fuel for the A-130 use decision');
});
