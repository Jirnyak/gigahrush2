import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import '../src/gen/living/content_manifest';
import { ItemType } from '../src/core/types';
import { FACTORY_BY_ID, productionRouteGoals } from '../src/data/factories';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { SIDE_QUESTS } from '../src/data/plot';
import { resourceForItem } from '../src/data/resources';

test('magazine part is a reachable weapon component for armory decisions', () => {
  const item = ITEMS.magazine_part;
  assert.equal(item.id, 'magazine_part');
  assert.equal(item.name, 'Детали магазина');
  assert.equal(item.type, ItemType.MISC);
  assert.equal(getStack(item), 4);
  assert.equal(resourceForItem(item.id)?.id, 'metal');

  for (const tag of ['weapon_component', 'weapon_part', 'magazine', 'production', 'repair_input', 'armory_bench', 'trade']) {
    assert.ok(item.tags?.includes(tag), `magazine_part item must carry ${tag}`);
    assert.ok(ITEM_TAGS.magazine_part?.includes(tag), `magazine_part registry must publish ${tag}`);
  }

  const armory = FACTORY_BY_ID.armory_bench;
  const recipes = armory.recipes.filter(recipe =>
    recipe.inputItems?.some(input => input.defId === 'magazine_part'),
  );
  assert.deepEqual(recipes.map(recipe => recipe.id).sort(), ['assemble_chizh3', 'recondition_eralashnikov']);
  assert.ok(recipes.every(recipe => productionRouteGoals(armory, recipe).includes('repair')));
  assert.ok(recipes.every(recipe => productionRouteGoals(armory, recipe).includes('steal')));

  const livingQuest = SIDE_QUESTS.find(quest => quest.id === 'ag42_zoya_magazine_part');
  assert.equal(livingQuest?.targetItem, 'magazine_part');
  assert.equal(livingQuest?.rewardItem, 'ammo_9mm');
});
