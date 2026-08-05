import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { WORLD_EVENT_TYPES } from '../src/core/types';
import { ITEMS } from '../src/data/catalog';
import { CRAFT_MATERIAL_IDS } from '../src/data/craft_materials';
import { ITEM_COMPOSITIONS } from '../src/data/item_composition';
import { CRAFT_RECIPES } from '../src/data/craft_recipes';
import { CRAFT_RECIPE_SOURCES } from '../src/data/craft_recipe_sources';
import { allInteractiveDefs } from '../src/data/interactive';

type CraftVectorLike = readonly number[];

interface CraftRecipeLike {
  id: string;
  itemId: string;
  resultCount: number;
  components: CraftVectorLike;
  knownByDefault: boolean;
  stationInteractiveId?: string;
  stationInteractiveIds?: readonly string[];
  interactiveId?: string;
  interactiveIds?: readonly string[];
  interactiveDefId?: string;
  interactiveDefIds?: readonly string[];
}

interface CraftRecipeSourceLike {
  id: string;
  recipeId?: string;
  recipeIds?: readonly string[];
  unlockRecipeIds?: readonly string[];
  recipeUnlockIds?: readonly string[];
  knownRecipeIds?: readonly string[];
  stationInteractiveId?: string;
  stationInteractiveIds?: readonly string[];
  interactiveId?: string;
  interactiveIds?: readonly string[];
  interactiveDefId?: string;
  interactiveDefIds?: readonly string[];
}

const EXPECTED_MATERIAL_IDS = [
  'mechanics',
  'electronics',
  'consumables',
  'bio',
  'chemical',
  'metal',
  'cybernetics',
  'psimatter',
  'metamatter',
] as const;

const REQUIRED_CRAFTING_EVENT_TYPES = [
  'player_disassemble_item',
  'player_craft_item',
  'craft_recipe_learned',
] as const;

const recipes = Array.from(CRAFT_RECIPES as Iterable<CraftRecipeLike>);
const recipeSources = CRAFT_RECIPE_SOURCES as readonly CraftRecipeSourceLike[];
const compositions = ITEM_COMPOSITIONS as Record<string, CraftVectorLike>;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function duplicateIds(ids: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id).sort();
}

function recipeRefs(source: CraftRecipeSourceLike): string[] {
  return [
    source.recipeId,
    ...(source.recipeIds ?? []),
    ...(source.unlockRecipeIds ?? []),
    ...(source.recipeUnlockIds ?? []),
    ...(source.knownRecipeIds ?? []),
  ].filter((id): id is string => typeof id === 'string' && id.length > 0);
}

function interactiveRefs(value: CraftRecipeLike | CraftRecipeSourceLike): string[] {
  return [
    value.stationInteractiveId,
    value.interactiveId,
    value.interactiveDefId,
    ...(value.stationInteractiveIds ?? []),
    ...(value.interactiveIds ?? []),
    ...(value.interactiveDefIds ?? []),
  ].filter((id): id is string => typeof id === 'string' && id.length > 0);
}

test('craft material ids keep the shared nine-slot order', () => {
  assert.deepEqual([...CRAFT_MATERIAL_IDS], [...EXPECTED_MATERIAL_IDS]);
});

test('craft recipes and compositions resolve item ids', () => {
  const itemIds = new Set(Object.keys(ITEMS));
  const recipeIds = recipes.map(recipe => recipe.id);

  assert.deepEqual(duplicateIds(recipeIds), [], 'craft recipe ids must be unique');

  const missingCompositions = Object.keys(ITEMS).filter(itemId => !compositions[itemId]);
  assert.deepEqual(missingCompositions, [], 'every item must have a craft composition');

  const compositionWithoutItem = Object.keys(compositions).filter(itemId => !itemIds.has(itemId));
  assert.deepEqual(compositionWithoutItem, [], 'craft compositions must not reference missing items');

  const missingRecipeItems = recipes
    .filter(recipe => !itemIds.has(recipe.itemId))
    .map(recipe => `${recipe.id}:${recipe.itemId}`);
  assert.deepEqual(missingRecipeItems, [], 'craft recipes must reference existing items');

  const badResultCounts = recipes
    .filter(recipe => !Number.isInteger(recipe.resultCount) || recipe.resultCount <= 0)
    .map(recipe => `${recipe.id}:${recipe.resultCount}`);
  assert.deepEqual(badResultCounts, [], 'craft recipe result counts must be positive integers');

  const compositionMismatches = recipes
    .filter(recipe => compositions[recipe.itemId])
    .filter(recipe => JSON.stringify(recipe.components) !== JSON.stringify(compositions[recipe.itemId]))
    .map(recipe => recipe.id);
  assert.deepEqual(compositionMismatches, [], 'recipe components must match item composition registry');
});

test('recipe source definitions resolve recipes', () => {
  const recipeIds = new Set(recipes.map(recipe => recipe.id));
  const sourceIds = recipeSources.map(source => source.id);
  assert.deepEqual(duplicateIds(sourceIds), [], 'craft recipe source ids must be unique');

  const missingRefs: string[] = [];
  const emptySources: string[] = [];
  for (const source of recipeSources) {
    const refs = recipeRefs(source);
    if (refs.length === 0) emptySources.push(source.id);
    for (const recipeId of refs) {
      if (!recipeIds.has(recipeId)) missingRefs.push(`${source.id}:${recipeId}`);
    }
  }

  assert.deepEqual(emptySources, [], 'every recipe source must reference at least one recipe id');
  assert.deepEqual(missingRefs, [], 'recipe source recipe refs must resolve');
});

test('craft station interactive references resolve', () => {
  const interactiveIds = new Set(allInteractiveDefs().map(def => def.id));
  const missing = [
    ...recipes.flatMap(recipe => interactiveRefs(recipe).map(id => `recipe:${recipe.id}:${id}`)),
    ...recipeSources.flatMap(source => interactiveRefs(source).map(id => `source:${source.id}:${id}`)),
  ].filter(ref => !interactiveIds.has(ref.slice(ref.lastIndexOf(':') + 1)));

  assert.deepEqual(missing, [], 'craft station interactive refs must resolve to InteractiveDef ids');
});

test('crafting event types are registered as world events', () => {
  const worldEventTypes = new Set(WORLD_EVENT_TYPES);
  const missing = REQUIRED_CRAFTING_EVENT_TYPES.filter(type => !worldEventTypes.has(type));
  assert.deepEqual(missing, [], 'crafting event types must exist in WORLD_EVENT_TYPES');
});

test('known-by-default recipes resolve to item-backed recipes', () => {
  const itemIds = new Set(Object.keys(ITEMS));
  const knownDefaultRecipes = recipes.filter(recipe => recipe.knownByDefault);
  const missingItems = knownDefaultRecipes
    .filter(recipe => !itemIds.has(recipe.itemId))
    .map(recipe => `${recipe.id}:${recipe.itemId}`);

  assert.deepEqual(unique(knownDefaultRecipes.map(recipe => recipe.id)), knownDefaultRecipes.map(recipe => recipe.id).sort());
  assert.deepEqual(missingItems, [], 'known-by-default recipes must reference existing items');
});
