import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { addItem, useItem } from '../src/systems/inventory';
import {
  activeSporeHaze,
  applySporeHaze,
  sporeHazeAimSpreadMult,
  SPORE_HAZE_AIM_SPREAD_MULT,
} from '../src/systems/status';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'antifungal_ointment';

test('antifungal ointment stays core fungal medicine with resource pressure', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Противогрибковая мазь');
  assert.equal(def.type, ItemType.MEDICINE);
  assert.ok(def.spawnRooms.includes(RoomType.MEDICAL), 'medical rooms must expose fungal medicine');
  assert.ok(def.spawnRooms.includes(RoomType.BATHROOM), 'bathrooms must expose household fungal medicine');
  assert.equal(def.spawnW > 0, true);
  assert.equal(resourceForItem(def.id)?.id, 'medicine');

  for (const tag of ['medicine', 'fungus', 'fungus_counterplay', 'spore_counterplay', 'counterplay']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `item def must carry ${tag}`);
  }
});

test('using antifungal ointment clears active spore haze and spends the dose', () => {
  const player = makeTestPlayer({ hp: 40, maxHp: 100 });
  const state = makeGameState({ time: 134 });

  applySporeHaze(player, 134, state.msgs, state);
  assert.ok(activeSporeHaze(player, 134));
  assert.equal(sporeHazeAimSpreadMult(player, 134), SPORE_HAZE_AIM_SPREAD_MULT);

  assert.equal(addItem(player, ITEM_ID, 1), true);
  useItem(player, 0, state.msgs, 135, state);

  assert.equal(activeSporeHaze(player, 135), undefined);
  assert.equal(player.hp, 60);
  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.ok(state.msgs.some(line => line.text.includes('Мазь связала споры')));

  const curedEvent = getRecentEvents(state, { type: 'player_status_cured', tags: ['spores'], limit: 1 })[0];
  assert.equal(curedEvent?.data?.statusId, 'spore_haze');
  assert.equal(curedEvent?.data?.reason, ITEM_ID);
});
