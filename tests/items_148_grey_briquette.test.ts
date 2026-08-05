import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { FACTORIES } from '../src/data/factories';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'grey_briquette';

test('grey briquette is the common reachable concentrate ration', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Концентрат-беляк');
  assert.equal(def.type, ItemType.FOOD);
  assert.ok(def.spawnRooms.includes(RoomType.KITCHEN));
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE));
  assert.ok(def.spawnRooms.includes(RoomType.COMMON));
  assert.equal(def.spawnW > 0, true);
  assert.equal(resourceForItem(def.id)?.id, 'food');

  for (const tag of ['bait', 'bait_starch', 'concentrate', 'daily_ration']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `grey_briquette registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `grey_briquette item must carry ${tag}`);
  }
});

test('grey briquette can be eaten or produced by the concentrate press', () => {
  const player = makeTestPlayer({
    inventory: [{ defId: ITEM_ID, count: 1 }],
    needs: { food: 40, water: 50, sleep: 50, pee: 0, poo: 0 },
  });
  const state = makeGameState({ time: 148 });

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.equal(player.needs?.food, 58);
  assert.ok(state.msgs.some(line => line.text.includes('Сытость +18')));

  const pressRecipe = FACTORIES
    .find(factory => factory.id === 'concentrate_press')
    ?.recipes.find(recipe => recipe.id === 'press_gray_briquettes');
  assert.deepEqual(pressRecipe?.outputs, [{ defId: ITEM_ID, count: 4 }]);
  assert.equal(pressRecipe?.outputTags.includes('food'), true);
  assert.equal(pressRecipe?.outputTags.includes('concentrate'), true);
});
