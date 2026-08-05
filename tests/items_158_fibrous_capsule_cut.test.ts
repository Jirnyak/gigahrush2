import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, MonsterKind } from '../src/core/types';
import { FACTORY_BY_ID, productionOutputResourceIds, productionRouteGoals } from '../src/data/factories';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { MONSTER_ECOLOGY } from '../src/data/monster_ecology';
import { resourceForItem } from '../src/data/resources';
import { SAMOSBOR_AFTERMATH_BEATS, getSamosborAftermathBeats } from '../src/data/samosbor_variants';
import { getInventorySlotActionInfo, inventoryItemCategory } from '../src/systems/inventory';
import { makeTestPlayer } from './helpers';

const ITEM_ID = 'fibrous_capsule_cut';

test('fibrous capsule cut is samosbor meat-block sample loot', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Срез фиброзной капсулы');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(def.spawnW, 0);
  assert.equal(def.value, 145);
  assert.equal(getStack(def), 3);
  assert.equal(inventoryItemCategory(def.id), 'trade');
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');

  for (const tag of ['sample', 'samosbor', 'aftermath', 'meat', 'capsule', 'evidence', 'trade', 'factory_input', 'blueprint']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `fibrous_capsule_cut registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `fibrous_capsule_cut item must carry ${tag}`);
  }
});

test('fibrous capsule cut is reachable from meat samosbor aftermath and meat monsters', () => {
  const beat = SAMOSBOR_AFTERMATH_BEATS.find(def => def.id === 'aftermath_fibrous_capsule_cut');

  assert.ok(beat);
  assert.equal(beat.itemId, ITEM_ID);
  assert.equal(beat.effect, 'item_residue');
  assert.equal(beat.floors.includes(FloorLevel.HELL), true);
  assert.deepEqual(beat.variants, ['meat']);
  assert.equal(beat.maxRuns, 2);
  assert.ok(beat.weight < 10, 'fibrous capsule aftermath should stay rare');
  for (const tag of ['meat', 'sample', 'samosbor', 'aftermath', 'factory_input']) {
    assert.ok(beat.tags.includes(tag), `aftermath beat must publish ${tag}`);
  }

  assert.equal(
    getSamosborAftermathBeats('meat', FloorLevel.HELL).some(def => def.id === 'aftermath_fibrous_capsule_cut'),
    true,
  );
  assert.ok(
    MONSTER_ECOLOGY.some(def =>
      (def.kind === MonsterKind.KHOROVAYA_MATKA || def.kind === MonsterKind.OLGOY)
      && def.rareDrops.some(drop => drop.itemId === ITEM_ID && drop.chance > 0),
    ),
    'meat-block monsters should expose fibrous capsule cuts as rare drops',
  );
});

test('fibrous capsule cut can be saved or spent on a utility-room blueprint recipe', () => {
  const player = makeTestPlayer({ inventory: [{ defId: ITEM_ID, count: 1 }] });
  const info = getInventorySlotActionInfo(player, 0);

  assert.equal(info?.category, 'trade');
  assert.equal(info?.canDrop, true);
  assert.equal(info?.canUse, true);
  assert.equal(info?.useLabel, 'Enter вскрыть пробу');
  assert.equal(info?.sellLabel, 'Справка: базовая цена 145₽');

  const factory = FACTORY_BY_ID.utility_room;
  const recipe = factory.recipes.find(row => row.id === 'decode_fibrous_t2_blueprint');

  assert.ok(recipe, 'utility room must decode fibrous capsule cuts into T2 blueprints');
  assert.deepEqual(recipe.inputItems, [{ defId: ITEM_ID, count: 1 }]);
  assert.deepEqual(recipe.outputs, [{ defId: 'blueprint_t2_folder', count: 1 }]);
  assert.equal(recipe.outputAccess, 'locked');
  assert.equal(recipe.maxOutputItemCount, 1);
  assert.ok(recipe.outputTags.includes('blueprint'));
  assert.ok(recipe.eventTags?.includes('fibrous_capsule'));
  assert.ok(productionRouteGoals(factory, recipe).includes('steal'));
  assert.ok(productionRouteGoals(factory, recipe).includes('repair'));
  assert.ok(productionOutputResourceIds(factory, recipe).includes('paper'));
});
