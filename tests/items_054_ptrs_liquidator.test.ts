import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, FloorLevel, ItemType, MonsterKind } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import { applyMonsterArmorHit, ZAKALENNAYA_ARMATURA_ARMOR_STACKS } from '../src/systems/monster_armor';
import { makeGameState, makeTestEntity, makeTestPlayer } from './helpers';

test('ptrs liquidator is a route-gated anti-armor rifle on existing harpoon projectile rules', () => {
  const def = ITEMS.ptrs_liquidator;
  const stats = WEAPON_STATS.ptrs_liquidator;

  assert.equal(def.name, 'ПТРС ликвидатора');
  assert.equal(def.type, ItemType.WEAPON);
  assert.equal(def.spawnW, 0);
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(resourceForItem(def.id)?.id, 'ammo');
  assert.equal(WEAPON_ROLE_TIERS.ptrs_liquidator, 'rifle_precision');

  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'ammo_harpoon');
  assert.equal(stats.projSprite, WEAPON_STATS.harpoon_gun.projSprite);
  assert.equal(stats.projType, undefined);
  assert.ok(stats.dmg > WEAPON_STATS.losyash_rifle.dmg);
  assert.ok(stats.dmg < WEAPON_STATS.gauss.dmg);
  assert.ok(stats.speed > WEAPON_STATS.losyash_rifle.speed);
  assert.ok((stats.spread ?? 1) <= (WEAPON_STATS.losyash_rifle.spread ?? 0));

  for (const tag of ['liquidator', 'rifle', 'precision', 'anti_armor', 'boss_rifle', 'ammo_harpoon', 'darkness_route']) {
    assert.ok(def.tags?.includes(tag), `ptrs_liquidator item must carry ${tag} tag`);
    assert.ok(ITEM_TAGS.ptrs_liquidator?.includes(tag), `ptrs_liquidator registry must publish ${tag} tag`);
  }
});

test('darkness long-route stash carries ptrs liquidator with scarce harpoons', () => {
  const gen = generateDesignFloor('darkness');
  const stashes = gen.world.containers.filter(container =>
    container.inventory.some(item => item.defId === 'ptrs_liquidator'),
  );

  assert.equal(stashes.length, 1);
  const stash = stashes[0];
  assert.equal(stash.tags.includes('darkness'), true);
  assert.equal(stash.tags.includes('long_route'), true);
  assert.equal(stash.tags.includes('anti_armor_reward'), true);
  assert.equal(stash.inventory.find(item => item.defId === 'ptrs_liquidator')?.count, 1);
  assert.equal(stash.inventory.find(item => item.defId === 'ammo_harpoon')?.count, 2);
});

test('ptrs liquidator strips hardened armor through the generic armor hook', () => {
  const world = new World();
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, time: 1 });
  const target = makeTestEntity({
    type: EntityType.MONSTER,
    monsterKind: MonsterKind.ZAKALENNAYA_ARMATURA,
    monsterArmorStacks: ZAKALENNAYA_ARMATURA_ARMOR_STACKS,
  });

  const hit = applyMonsterArmorHit(world, state, target, {
    damage: WEAPON_STATS.ptrs_liquidator.dmg,
    attacker: makeTestPlayer(),
    weaponId: 'ptrs_liquidator',
  });

  assert.equal(hit.hitKind, 'heavy');
  assert.equal(hit.stripped, true);
  assert.equal(hit.armorStacks, ZAKALENNAYA_ARMATURA_ARMOR_STACKS - 1);
});
