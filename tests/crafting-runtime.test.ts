import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CRAFT_MATERIAL_IDS,
  craftMaterialIndex,
  type CraftMaterialId,
  type CraftVector,
  type MutableCraftVector,
} from '../src/data/craft_materials';
import { MAX_INVENTORY_SLOTS } from '../src/data/inventory_limits';
import { craftRecipeByItemId } from '../src/data/craft_recipes';
import { getRecentEvents } from '../src/systems/events';
import {
  addCraftMaterial,
  canCraftRecipe,
  craftKnownRecipe,
  createCraftingState,
  disassembleInventorySlot,
  ensureCraftingState,
  hasCraftRecipe,
  learnCraftRecipe,
  restoreCraftingState,
  sanitizeCraftingState,
} from '../src/systems/crafting';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

function sequence(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

function firstMaterial(vector: CraftVector): CraftMaterialId {
  const idx = vector.findIndex(value => value > 0);
  assert.notEqual(idx, -1, 'test recipe must have at least one material');
  return CRAFT_MATERIAL_IDS[idx];
}

test('createCraftingState initializes materials, default recipes, and metadata', () => {
  const crafting = createCraftingState();

  assert.equal(crafting.materials.length, 9);
  assert.deepEqual(crafting.materials, [0, 0, 0, 0, 0, 0, 0, 0, 0]);

  assert.equal(crafting.knownRecipes.craft_item_bread, true);
  assert.equal(Object.keys(crafting.knownRecipes).length > 0, true);
  assert.equal(crafting.learnedCount, Object.keys(crafting.knownRecipes).length);
  assert.equal(crafting.lastChangedAt, 0);
});

test('createCraftingState initializes fields to defaults', () => {
  const crafting = createCraftingState();
  assert.deepEqual(crafting.materials, [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(typeof crafting.knownRecipes, 'object');
  assert.equal(crafting.learnedCount, Object.keys(crafting.knownRecipes).length);
  assert.equal(crafting.lastChangedAt, 0);
  assert.ok(crafting.knownRecipes['craft_item_bread']);
  assert.ok(crafting.knownRecipes['craft_item_bandage']);
});

test('sanitizeCraftingState with non-record input creates default state', () => {
  const defaultState = createCraftingState();
  const stringState = sanitizeCraftingState('not a record');
  const numberState = sanitizeCraftingState(123);
  const nullState = sanitizeCraftingState(null);

  assert.deepEqual(stringState, defaultState);
  assert.deepEqual(numberState, defaultState);
  assert.deepEqual(nullState, defaultState);
});

test('adding crafting materials clamps to the material bank cap', () => {
  const state = makeGameState();
  addCraftMaterial(state, 'mechanics', 1_000_005);
  addCraftMaterial(state, 'mechanics', 4);
  addCraftMaterial(state, 'electronics', -2);

  const crafting = ensureCraftingState(state);
  assert.equal(crafting.materials[craftMaterialIndex('mechanics')], 999_999);
  assert.equal(crafting.materials[craftMaterialIndex('electronics')], 0);
  assert.equal(crafting.lastChangedAt, state.time);
});

test('learning a craft recipe returns true once and false on duplicates', () => {
  const state = makeGameState({ time: 12 });
  const recipeId = 'craft_item_breach_charge';

  assert.equal(hasCraftRecipe(state, recipeId), false);
  assert.equal(learnCraftRecipe(state, recipeId, 'test'), true);
  assert.equal(hasCraftRecipe(state, recipeId), true);
  assert.equal(learnCraftRecipe(state, recipeId, 'test'), false);
  assert.equal(ensureCraftingState(state).knownRecipes[recipeId], true);

  const event = getRecentEvents(state, { type: 'craft_recipe_learned', limit: 1 })[0];
  assert.equal(event?.data?.recipeId, recipeId);
});

test('disassembly picks deterministic material, removes one item, and can learn recipe below chance threshold', () => {
  const state = makeGameState({ time: 20 });
  const player = makeTestPlayer({ inventory: [{ defId: 'breach_charge', count: 2 }] });
  const recipe = craftRecipeByItemId('breach_charge');
  assert.ok(recipe, 'breach_charge recipe must exist');
  const materialId = firstMaterial(recipe.components);

  const result = disassembleInventorySlot({
    actor: player,
    state,
    stationKind: 'workbench',
    slotIndex: 0,
    rng: sequence([0, 0.49]),
  });

  assert.equal(result.ok, true);
  assert.equal(result.materialId, materialId);
  assert.equal(result.learnedRecipeId, recipe.id);
  assert.equal(countInventoryItem(player, 'breach_charge'), 1);
  assert.equal(ensureCraftingState(state).materials[craftMaterialIndex(materialId)], 1);
  assert.equal(hasCraftRecipe(state, recipe.id), true);
});

test('disassembly removes the selected slot when duplicate item ids carry different data', () => {
  const state = makeGameState({ time: 20 });
  const player = makeTestPlayer({
    inventory: [
      { defId: 'pipe', count: 1, data: { dur: 1 } },
      { defId: 'pipe', count: 1, data: { dur: 9 } },
    ],
  });
  const recipe = craftRecipeByItemId('pipe');
  assert.ok(recipe, 'pipe recipe must exist');
  const materialId = firstMaterial(recipe.components);

  const result = disassembleInventorySlot({
    actor: player,
    state,
    stationKind: 'workbench',
    slotIndex: 0,
    rng: sequence([0, 0.5]),
  });

  assert.equal(result.ok, true);
  assert.equal(result.materialId, materialId);
  assert.equal(player.inventory?.length, 1);
  assert.equal(player.inventory?.[0]?.defId, 'pipe');
  assert.deepEqual(player.inventory?.[0]?.data, { dur: 9 });
});

test('disassembly learn chance does not learn recipe at or above threshold', () => {
  const state = makeGameState({ time: 21 });
  const player = makeTestPlayer({ inventory: [{ defId: 'breach_charge', count: 1 }] });
  const recipe = craftRecipeByItemId('breach_charge');
  assert.ok(recipe, 'breach_charge recipe must exist');

  const result = disassembleInventorySlot({
    actor: player,
    state,
    stationKind: 'workbench',
    slotIndex: 0,
    rng: sequence([0, 0.5]),
  });

  assert.equal(result.ok, true);
  assert.equal(result.learnedRecipeId, undefined);
  assert.equal(hasCraftRecipe(state, recipe.id), false);
});

test('crafting fails unknown and sanitized unknown learned recipe ids without mutation', () => {
  const state = makeGameState();
  const player = makeTestPlayer();
  state.crafting = restoreCraftingState({
    materials: [999, 999, 999, 999, 999, 999, 999, 999, 999],
    knownRecipes: ['craft_item_not_real'],
  });
  const before = [...ensureCraftingState(state).materials];

  const result = craftKnownRecipe({ actor: player, state, stationKind: 'lathe', recipeId: 'craft_item_not_real' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unknown_recipe');
  assert.deepEqual(ensureCraftingState(state).materials, before);
  assert.equal(player.inventory?.length ?? 0, 0);
});

test('crafting fails with insufficient materials without mutation', () => {
  const state = makeGameState();
  const player = makeTestPlayer();
  const recipe = craftRecipeByItemId('pipe');
  assert.ok(recipe, 'pipe recipe must exist');
  learnCraftRecipe(state, recipe.id, 'test');
  const crafting = ensureCraftingState(state);
  crafting.materials = recipe.components.map(value => Math.max(0, value - 1)) as MutableCraftVector;
  const before = [...crafting.materials];

  const result = craftKnownRecipe({ actor: player, state, stationKind: recipe.station, recipeId: recipe.id });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'insufficient_materials');
  assert.deepEqual(ensureCraftingState(state).materials, before);
  assert.equal(countInventoryItem(player, recipe.itemId), 0);
});

test('crafting checks inventory capacity before consuming materials', () => {
  const state = makeGameState();
  const player = makeTestPlayer({
    inventory: Array.from({ length: MAX_INVENTORY_SLOTS }, () => ({ defId: 'pipe', count: 1 })),
  });
  const recipe = craftRecipeByItemId('pipe');
  assert.ok(recipe, 'pipe recipe must exist');
  learnCraftRecipe(state, recipe.id, 'test');
  ensureCraftingState(state).materials = [...recipe.components] as MutableCraftVector;
  const before = [...ensureCraftingState(state).materials];

  const result = craftKnownRecipe({ actor: player, state, stationKind: recipe.station, recipeId: recipe.id });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'inventory_full');
  assert.deepEqual(ensureCraftingState(state).materials, before);
  assert.equal(player.inventory?.length, MAX_INVENTORY_SLOTS);
});

test('crafting success consumes exact material vector and adds output item atomically', () => {
  const state = makeGameState({ time: 30 });
  const player = makeTestPlayer();
  const recipe = craftRecipeByItemId('pipe');
  assert.ok(recipe, 'pipe recipe must exist');
  learnCraftRecipe(state, recipe.id, 'test');
  const crafting = ensureCraftingState(state);
  crafting.materials = [...recipe.components] as MutableCraftVector;

  const check = canCraftRecipe(player, state, recipe.id, recipe.station);
  assert.equal(check.ok, true, check.message);
  const result = craftKnownRecipe({ actor: player, state, stationKind: recipe.station, recipeId: recipe.id });

  assert.equal(result.ok, true);
  assert.deepEqual(ensureCraftingState(state).materials, [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(countInventoryItem(player, recipe.itemId), recipe.resultCount);
  const event = getRecentEvents(state, { type: 'player_craft_item', limit: 1 })[0];
  assert.equal(event?.data?.recipeId, recipe.id);
});
