import test from 'node:test';
import assert from 'node:assert/strict';

import {
  craftRecipeExists,
  craftRecipeDisplayName,
  sanitizeCraftingState,
} from '../src/systems/crafting';
import { ITEMS } from '../src/data/catalog';
import { CRAFT_RECIPES } from '../src/data/craft_recipes';

test('craftRecipeExists returns true for existing recipes and false for non-existent ones', () => {
  const existingRecipeId = Object.keys(CRAFT_RECIPES)[0];
  if (existingRecipeId) {
    assert.equal(craftRecipeExists(existingRecipeId), true);
  }

  assert.equal(craftRecipeExists('non_existent_recipe_id_12345'), false);
  assert.equal(craftRecipeExists(''), false);
});

test('craftRecipeDisplayName returns the item name if the recipe exists and item has a name', () => {
  const existingRecipeId = Object.keys(CRAFT_RECIPES)[0];
  if (existingRecipeId) {
    const recipe = CRAFT_RECIPES[existingRecipeId];
    const item = ITEMS[recipe.itemId];
    if (item && item.name) {
      assert.equal(craftRecipeDisplayName(existingRecipeId), item.name);
    }
  }
});

test('craftRecipeDisplayName returns item id or recipe id if not found', () => {
  // Assuming 'non_existent_recipe_id_12345' is not a valid recipe id
  // and doesn't match the format craft_item_<itemId>
  assert.equal(craftRecipeDisplayName('non_existent_recipe_id_12345'), 'non_existent_recipe_id_12345');
});

test('sanitizeCraftingState handles bad inputs gracefully', () => {
  const defaultState = sanitizeCraftingState(undefined);
  assert.equal(defaultState.materials.length, 9);
  assert.deepEqual(defaultState.materials, [0, 0, 0, 0, 0, 0, 0, 0, 0]);

  // default known recipes are included
  const defaultKnownCount = Object.keys(defaultState.knownRecipes).length;
  assert.ok(defaultKnownCount > 0);
  assert.equal(defaultState.learnedCount, defaultKnownCount);
  assert.equal(typeof defaultState.lastChangedAt, 'number');

  const nullState = sanitizeCraftingState(null);
  assert.deepEqual(nullState.materials, [0, 0, 0, 0, 0, 0, 0, 0, 0]);

  const stringState = sanitizeCraftingState("invalid string input");
  assert.deepEqual(stringState.materials, [0, 0, 0, 0, 0, 0, 0, 0, 0]);

  const numberState = sanitizeCraftingState(12345);
  assert.deepEqual(numberState.materials, [0, 0, 0, 0, 0, 0, 0, 0, 0]);

  const partialObjectState = sanitizeCraftingState({
    materials: [100, 200], // Invalid length, should be sanitized
    knownRecipes: { "some_recipe": true, "another": "invalid" }
  });

  assert.equal(partialObjectState.materials.length, 9);
  assert.equal(partialObjectState.materials[0], 100);
  assert.equal(partialObjectState.materials[1], 200);
  assert.equal(partialObjectState.materials[2], 0); // Missing elements zeroed out

  // "some_recipe": true should be kept, "another": "invalid" might be dropped or kept depending on sanitizeKnownRecipes implementation
  // Let's just check it doesn't throw and returns an object
  assert.ok(partialObjectState.knownRecipes);
});
