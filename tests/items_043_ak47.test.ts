import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType } from '../src/core/types';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { PLOT_CHAIN } from '../src/data/plot';
import { resourceForItem } from '../src/data/resources';

test('ak47 remains the old-world 7.62 automatic rifle', () => {
  const def = ITEMS.ak47;
  const stats = WEAPON_STATS.ak47;

  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(def.spawnW, 0);
  assert.equal(stats.ammoType, 'ammo_762');
  assert.equal(WEAPON_ROLE_TIERS.ak47, 'ammo_burn');
  assert.equal(resourceForItem('ammo_762')?.id, 'ammo');

  for (const tag of ['old_world', 'rifle', 'ammo_burn', 'story_reward']) {
    assert.ok(def.tags?.includes(tag), `ak47 item must publish ${tag} tag`);
    assert.ok(ITEM_TAGS.ak47?.includes(tag), `ak47 tag registry must publish ${tag}`);
  }
});

test('ak47 is distinct from the liquidator automatic rifle when both exist', () => {
  const ak = WEAPON_STATS.ak47;
  const eralash = WEAPON_STATS.eralashnikov_auto;
  if (!eralash) return;

  assert.equal(ak.ammoType, eralash.ammoType);
  assert.ok(ak.dmg > eralash.dmg, 'ak47 should hit harder than the liquidator service auto');
  assert.ok(ak.speed > eralash.speed, 'ak47 should cycle slower than the liquidator service auto');
  assert.ok((ak.spread ?? 0) < (eralash.spread ?? 0), 'ak47 should be tighter than the liquidator service auto');
});

test('ak47 is reachable through Major Grom outpost defense with 7.62 pressure', () => {
  const rewardStep = PLOT_CHAIN.find(step =>
    step.rewardItem === 'ak47'
    && step.extraRewards?.some(reward => reward.defId === 'ammo_762' && reward.count >= 30)
  );

  assert.ok(rewardStep, 'story chain should reward ak47 with a starting 7.62 reserve');
  assert.equal(rewardStep.killNeeded, 10);
  assert.ok(rewardStep.desc.toLowerCase().includes('форпост'));
});
