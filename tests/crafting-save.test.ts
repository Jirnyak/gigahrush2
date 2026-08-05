import test from 'node:test';
import assert from 'node:assert/strict';

import { EntityType, Faction, type Entity } from '../src/core/types';
import { craftRecipeByItemId } from '../src/data/craft_recipes';
import {
  craftMaterialIndex,
} from '../src/data/craft_materials';
import { MAX_ITEM_STACK } from '../src/data/inventory_limits';
import {
  craftingForSave,
  ensureCraftingState,
  learnCraftRecipe,
  restoreCraftingState,
} from '../src/systems/crafting';
import {
  SAVE_SHAPE_VERSION,
  createGameSavePayload,
  saveShapeVersionStatus,
} from '../src/systems/save_runtime';
import { makeGameState, makeTestPlayer } from './helpers';

function savePlayer(overrides: Partial<Entity> = {}): Entity {
  return makeTestPlayer({
    id: 1,
    x: 10,
    y: 11,
    angle: 0.5,
    hp: 80,
    maxHp: 100,
    faction: Faction.PLAYER,
    type: EntityType.NPC,
    ...overrides,
  });
}

test('save payload includes compact crafting section and bumped shape version', () => {
  const state = makeGameState({ time: 40 });
  const player = savePlayer();
  const recipe = craftRecipeByItemId('breach_charge');
  assert.ok(recipe, 'breach_charge recipe must exist');
  learnCraftRecipe(state, recipe.id, 'test');
  ensureCraftingState(state).materials[craftMaterialIndex('metal')] = 7;

  const payload = createGameSavePayload(player, state, []);

  assert.equal(payload.version, SAVE_SHAPE_VERSION);
  assert.equal(payload.player.age, 25);
  assert.equal(payload.player.sex, 'male');
  const crafting = payload.state.crafting as ReturnType<typeof craftingForSave>;
  assert.equal(Array.isArray(crafting.materials), true);
  assert.equal(crafting.materials.length, 9);
  assert.equal(crafting.materials[craftMaterialIndex('metal')], 7);
  assert.equal(crafting.knownRecipes.includes(recipe.id), true);
});

test('save payload splits oversized physical inventory stacks to byte slots', () => {
  const state = makeGameState();
  const player = savePlayer({
    inventory: [{ defId: 'bread', count: MAX_ITEM_STACK * 2 + 90 }],
  });

  const payload = createGameSavePayload(player, state, []);

  assert.deepEqual(payload.player.inventory?.map(item => item.count), [MAX_ITEM_STACK, MAX_ITEM_STACK, 90]);
});

test('restore sanitizes malformed material vector to exactly nine clamped integers', () => {
  const restored = restoreCraftingState({
    materials: [1.8, -5, Number.POSITIVE_INFINITY, '4', undefined, 1_500_000, 2.2],
    knownRecipes: [],
  });

  assert.deepEqual(restored.materials, [1, 0, 0, 4, 0, 999_999, 2, 0, 0]);
});

test('restore drops unknown recipes and collapses duplicate known ids', () => {
  const recipe = craftRecipeByItemId('breach_charge');
  assert.ok(recipe, 'breach_charge recipe must exist');

  const restored = restoreCraftingState({
    materials: [],
    knownRecipes: [recipe.id, 'craft_item_missing', recipe.id, 123],
  });

  assert.equal(restored.knownRecipes[recipe.id], true);
  assert.equal(restored.knownRecipes.craft_item_missing, undefined);
  assert.equal(Object.keys(restored.knownRecipes).filter(id => id === recipe.id).length, 1);
  assert.equal(restored.learnedCount, Object.keys(restored.knownRecipes).length);
});

test('craftingForSave serializes known recipes as ids only', () => {
  const state = makeGameState();
  const recipe = craftRecipeByItemId('breach_charge');
  assert.ok(recipe, 'breach_charge recipe must exist');
  learnCraftRecipe(state, recipe.id, 'test');

  const saved = craftingForSave(state);

  assert.equal(Array.isArray(saved.knownRecipes), true);
  assert.equal(saved.knownRecipes.includes(recipe.id), true);
  assert.equal('learnedCount' in saved, false);
  assert.equal('lastChangedAt' in saved, false);
});

test('old save versions are rejected by existing shape policy', () => {
  assert.equal(saveShapeVersionStatus({ version: SAVE_SHAPE_VERSION - 1 }), 'old');
  assert.equal(saveShapeVersionStatus({ version: SAVE_SHAPE_VERSION }), 'current');
});
