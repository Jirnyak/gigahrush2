import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, Occupation, RoomType } from '../src/core/types';
import { generateNpcTradeItems } from '../src/data/occupation_profiles';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { hearingRadiusMetersForActor } from '../src/systems/hearing';
import { makeTestNpc, makeTestPlayer } from './helpers';

test('liquidator radio headset is reachable radio-class tool gear', () => {
  const def = ITEMS.radio_headset_liquidator;

  assert.equal(def.type, ItemType.TOOL);
  assert.equal(def.durability, 90);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.OFFICE, RoomType.STORAGE]);
  assert.equal(resourceForItem(def.id)?.id, 'tools');

  const electronics = RESOURCES.find(resource => resource.id === 'electronics');
  assert.ok(electronics?.itemIds.includes(def.id));
  for (const tag of ['liquidator', 'radio', 'hearing_boost', 'electronics', 'trade']) {
    assert.ok(ITEM_TAGS.radio_headset_liquidator?.includes(tag), `radio_headset_liquidator must publish ${tag}`);
  }
});

test('equipped liquidator headset expands localized hearing radius', () => {
  const player = makeTestPlayer({ tool: 'radio_headset_liquidator' });

  assert.equal(hearingRadiusMetersForActor(player, 100), 175);
  assert.equal(hearingRadiusMetersForActor(makeTestPlayer({ tool: 'radio' }), 100), 100);
});

test('hunter trade can expose the liquidator headset', () => {
  const savedRandom = Math.random;
  Math.random = () => 0.999;
  try {
    const npc = makeTestNpc({ occupation: Occupation.HUNTER });
    const trade = generateNpcTradeItems(npc);
    assert.ok(trade.some(item => item.defId === 'radio_headset_liquidator'));
  } finally {
    Math.random = savedRandom;
  }
});
