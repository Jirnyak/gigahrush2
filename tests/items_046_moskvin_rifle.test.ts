import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, Faction, ItemType, Occupation, RoomType, type Entity } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { generateNpcTradeItems } from '../src/data/occupation_profiles';
import { resourceForItem } from '../src/data/resources';
import { PHYS_WEAPON_ROLE_TIERS, PHYS_WEAPON_STATS } from '../src/data/weapons';
import { freshRPG } from '../src/systems/rpg';

function makeLiquidatorHunter(level: number): Entity {
  return {
    id: 46046,
    type: EntityType.NPC,
    x: 0,
    y: 0,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    rpg: freshRPG(level),
  };
}

test('moskvin rifle is a distinct slow 7.62 liquidator precision weapon', () => {
  const def = ITEMS.moskvin_rifle;
  const stats = PHYS_WEAPON_STATS.moskvin_rifle;

  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ]);
  assert.equal(resourceForItem(def.id)?.id, 'ammo');
  assert.equal(PHYS_WEAPON_ROLE_TIERS.moskvin_rifle, 'rifle_precision');
  assert.equal(stats.ammoType, 'ammo_762');
  assert.equal(stats.projSprite, PHYS_WEAPON_STATS.nagant.projSprite);
  assert.ok(stats.dmg > PHYS_WEAPON_STATS.nagant.dmg);
  assert.ok(stats.dmg < PHYS_WEAPON_STATS.harpoon_gun.dmg);
  assert.ok(stats.speed > PHYS_WEAPON_STATS.nagant.speed);
  assert.ok(stats.speed < PHYS_WEAPON_STATS.harpoon_gun.speed);
  assert.notEqual(stats.ammoType, PHYS_WEAPON_STATS.nagant.ammoType);
  assert.notEqual(stats.ammoType, PHYS_WEAPON_STATS.harpoon_gun.ammoType);

  for (const tag of ['liquidator', 'rifle', 'precision', 'ammo_762', 'rank3_trade']) {
    assert.ok(ITEM_TAGS.moskvin_rifle?.includes(tag), `moskvin_rifle must publish ${tag} tag`);
  }
});

test('moskvin rifle is sold by rank-three liquidator hunters with ammunition', () => {
  const recruitTrade = generateNpcTradeItems(makeLiquidatorHunter(8));
  assert.equal(recruitTrade.some(item => item.defId === 'moskvin_rifle'), false);

  const rankThreeTrade = generateNpcTradeItems(makeLiquidatorHunter(18));
  assert.equal(rankThreeTrade.some(item => item.defId === 'moskvin_rifle' && item.count === 1), true);
  assert.equal(rankThreeTrade.some(item => item.defId === 'ammo_762' && item.count === 6), true);
});
