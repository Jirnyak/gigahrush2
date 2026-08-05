import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ITEMS } from '../src/data/items';
import {
  CRAFT_MATERIAL_IDS,
  craftMaterialIndex,
  craftVectorTotal,
  validateCraftVector,
  isCraftMaterialId,
} from '../src/data/craft_materials';
import { ITEM_COMPOSITIONS, INTENTIONAL_RARE_MATERIAL_ITEMS } from '../src/data/item_composition';
import { CRAFT_RECIPES, CRAFT_RECIPE_EXCEPTIONS } from '../src/data/craft_recipes';

const ITEM_IDS = Object.keys(ITEMS).sort();
const RARE_MATERIAL_IDS = ['cybernetics', 'psimatter', 'metamatter'] as const;

function recipeId(itemId: string): string {
  return `craft_item_${itemId}`;
}

test('all item ids have exactly one craft composition', () => {
  assert.deepEqual(Object.keys(ITEM_COMPOSITIONS).sort(), ITEM_IDS);
});

test('craft composition vectors are 9 finite non-negative integer counts', () => {
  for (const itemId of ITEM_IDS) {
    const vector = ITEM_COMPOSITIONS[itemId];
    assert.equal(vector.length, CRAFT_MATERIAL_IDS.length, `${itemId} composition must have 9 components`);
    assert.deepEqual(validateCraftVector(vector), [], `${itemId} composition must be valid`);
    assert.ok(craftVectorTotal(vector) >= 1, `${itemId} composition must not be empty`);
  }
});

test('all recipes are item-based, unique, and reference existing item ids', () => {
  const recipeEntries = Object.entries(CRAFT_RECIPES);
  const recipeIds = recipeEntries.map(([id]) => id);

  assert.deepEqual(new Set(recipeIds).size, recipeIds.length, 'recipe ids must be unique');
  assert.deepEqual(recipeIds.sort(), ITEM_IDS.map(recipeId).sort(), 'every item must have a recipe unless explicitly excepted');
  assert.deepEqual(Object.keys(CRAFT_RECIPE_EXCEPTIONS), [], 'kraft_1 currently documents no recipe exceptions');

  for (const [id, recipe] of recipeEntries) {
    assert.equal(id, recipe.id, `${id} must be keyed by recipe id`);
    assert.equal(id, recipeId(recipe.itemId), `${id} must use craft_item_<item_id> format`);
    assert.ok(ITEMS[recipe.itemId], `${id} references missing item ${recipe.itemId}`);
    assert.equal(recipe.resultCount, 1, `${id} must produce one item stack unit`);
    assert.ok(['any', 'workbench', 'lathe', 'lab', 'net_terminal'].includes(recipe.station), `${id} has invalid station`);
    assert.ok(recipe.tier >= 0 && recipe.tier <= 4, `${id} has invalid tier`);
  }
});

test('recipe component vectors equal item compositions', () => {
  for (const recipe of Object.values(CRAFT_RECIPES)) {
    assert.deepEqual(recipe.components, ITEM_COMPOSITIONS[recipe.itemId], `${recipe.id} components must mirror item composition`);
  }
});

test('rare craft material usage is bounded and documented', () => {
  const documented = new Map(Object.entries(INTENTIONAL_RARE_MATERIAL_ITEMS));
  const actualRareUsers = new Map<string, string[]>();

  for (const [itemId, vector] of Object.entries(ITEM_COMPOSITIONS)) {
    const used = RARE_MATERIAL_IDS.filter(material => vector[craftMaterialIndex(material)] > 0);
    if (used.length > 0) actualRareUsers.set(itemId, used);
  }

  assert.ok(actualRareUsers.size <= 45, `rare material user set is too broad: ${actualRareUsers.size}`);

  for (const [itemId, used] of actualRareUsers) {
    assert.deepEqual(used.sort(), [...(documented.get(itemId) ?? [])].sort(), `${itemId} rare materials must be intentional`);
  }

  for (const [itemId, expected] of documented) {
    assert.ok(ITEMS[itemId], `${itemId} rare material documentation references missing item`);
    const vector = ITEM_COMPOSITIONS[itemId];
    for (const material of expected) {
      assert.ok(vector[craftMaterialIndex(material)] > 0, `${itemId} must actually use documented rare material ${material}`);
    }
  }
});

test('isCraftMaterialId correctly identifies valid and invalid material ids', () => {
  // Valid ids
  for (const id of CRAFT_MATERIAL_IDS) {
    assert.equal(isCraftMaterialId(id), true, `${id} should be a valid craft material id`);
  }

  // Invalid strings
  const invalidStrings = ['', 'fake_material', 'mechanic', 'bio_mass', ' '];
  for (const str of invalidStrings) {
    assert.equal(isCraftMaterialId(str), false, `'${str}' should not be a valid craft material id`);
  }

  // Non-string inputs
  const nonStrings = [null, undefined, 123, 0, {}, [], true, false, () => {}];
  for (const val of nonStrings) {
    assert.equal(isCraftMaterialId(val), false, `${String(val)} should not be a valid craft material id`);
  }
});
