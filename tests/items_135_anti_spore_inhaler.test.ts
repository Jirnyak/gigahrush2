import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateSlimeNiiDesignFloor } from '../src/gen/design_floors/slime_nii';
import { getRecentEvents } from '../src/systems/events';
import { addItem, useItem } from '../src/systems/inventory';
import {
  activeSporeHaze,
  applySporeHaze,
  sporeHazeAimSpreadMult,
  SPORE_HAZE_AIM_SPREAD_MULT,
} from '../src/systems/status';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'anti_spore_inhaler';

test('anti-spore inhaler is reachable respiratory medicine', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Противоспоровый ингалятор');
  assert.equal(def.type, ItemType.MEDICINE);
  assert.ok(def.spawnRooms.includes(RoomType.MEDICAL), 'medical rooms must expose respiratory medicine');
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE), 'storage rooms must expose field inhalers');
  assert.equal(def.spawnW > 0, true);
  assert.equal(resourceForItem(def.id)?.id, 'medicine');

  for (const tag of ['medicine', 'spore_counterplay', 'respiratory']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `item def must carry ${tag}`);
  }
});

test('using anti-spore inhaler clears active spore haze and spends the dose', () => {
  const player = makeTestPlayer({ hp: 40, maxHp: 100 });
  const state = makeGameState({ time: 135 });

  applySporeHaze(player, 135, state.msgs, state);
  assert.ok(activeSporeHaze(player, 135));
  assert.equal(sporeHazeAimSpreadMult(player, 135), SPORE_HAZE_AIM_SPREAD_MULT);

  assert.equal(addItem(player, ITEM_ID, 1), true);
  useItem(player, 0, state.msgs, 136, state);

  assert.equal(activeSporeHaze(player, 136), undefined);
  assert.equal(player.hp, 64);
  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.ok(state.msgs.some(line => line.text.includes('Ингалятор выбил споры')));

  const curedEvent = getRecentEvents(state, { type: 'player_status_cured', tags: ['spores'], limit: 1 })[0];
  assert.equal(curedEvent?.data?.statusId, 'spore_haze');
  assert.equal(curedEvent?.data?.reason, ITEM_ID);
});

test('anti-spore inhaler is stealable from the slime NII cold storage', () => {
  const gen = generateSlimeNiiDesignFloor();

  const cabinet = gen.world.containers.find(container =>
    container.tags.includes('slime_nii')
    && container.tags.includes('cold_storage')
    && container.inventory.some(item => item.defId === ITEM_ID && item.count === 1),
  );

  assert.ok(cabinet, 'slime_nii should expose anti_spore_inhaler through locked cold storage');
  assert.equal(cabinet.access, 'locked');
});
