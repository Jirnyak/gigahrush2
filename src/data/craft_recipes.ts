import { ItemType, type ItemDef } from '../core/types';
import { ITEMS } from './items';
import { PHYS_WEAPON_ROLE_TIERS, type WeaponRoleTier } from './weapons';
import { PSI_WEAPON_ROLE_TIERS } from './psi';
import { ITEM_COMPOSITIONS, INTENTIONAL_RARE_MATERIAL_ITEMS } from './item_composition';
import {
  type CraftVector,
  craftMaterialIndex,
  craftVectorTotal,
} from './craft_materials';

export type CraftStationKind = 'any' | 'workbench' | 'lathe' | 'lab' | 'net_terminal';
export type CraftRecipeTier = 0 | 1 | 2 | 3 | 4;

export interface CraftRecipeDef {
  id: string;
  itemId: string;
  resultCount: number;
  components: CraftVector;
  station: CraftStationKind;
  discoverable: boolean;
  knownByDefault: boolean;
  tier: CraftRecipeTier;
  tags: readonly string[];
}

export type CraftRecipeRegistry = Record<string, CraftRecipeDef>
  & Iterable<CraftRecipeDef>
  & Pick<ReadonlyArray<CraftRecipeDef>, 'length' | 'map' | 'filter' | 'flatMap' | 'forEach' | 'some' | 'every' | 'find'>;

export function craftRecipeIdForItem(itemId: string): string {
  return `craft_item_${itemId}`;
}

const WEAPON_ROLE_TIERS: Record<string, WeaponRoleTier> = {
  ...PHYS_WEAPON_ROLE_TIERS,
  ...PSI_WEAPON_ROLE_TIERS,
};

const DEFAULT_KNOWN_RECIPE_IDS = new Set([
  'bread',
  'water',
  'bandage',
  'wet_rag_bundle',
  'knife',
  'pipe',
  'chalk',
  'note',
  'ammo_9mm',
]);

function tagsOf(def: ItemDef): readonly string[] {
  return def.tags ?? [];
}

function hasTag(def: ItemDef, tag: string): boolean {
  return tagsOf(def).includes(tag);
}

function stationForItem(def: ItemDef, components: CraftVector): CraftStationKind {
  const role = WEAPON_ROLE_TIERS[def.id];
  const total = craftVectorTotal(components);
  const rareCyber = components[craftMaterialIndex('cybernetics')] > 0;
  const meta = components[craftMaterialIndex('metamatter')] > 0;
  const psi = components[craftMaterialIndex('psimatter')] > 0;

  if (total <= 2 && (def.type === ItemType.FOOD || def.type === ItemType.DRINK || def.type === ItemType.NOTE || def.id === 'wet_rag_bundle')) return 'any';
  if (meta || rareCyber || hasTag(def, 'net') || hasTag(def, 'terminal') || hasTag(def, 'cybernetics')) return 'net_terminal';
  if (psi || def.type === ItemType.MEDICINE || role === 'psi' || hasTag(def, 'sample') || hasTag(def, 'slime') || hasTag(def, 'reagent')) return 'lab';
  if (def.type === ItemType.AMMO || def.type === ItemType.WEAPON || hasTag(def, 'weapon_part') || hasTag(def, 'metal') || hasTag(def, 'repair_input')) return 'lathe';
  return 'workbench';
}

function tierForComponents(components: CraftVector): CraftRecipeTier {
  const total = craftVectorTotal(components);
  if (components[craftMaterialIndex('metamatter')] > 0) return 4;
  if (total <= 6) return 0;
  if (total <= 12) return 1;
  if (total <= 35) return 2;
  if (total <= 90) return 3;
  return 4;
}

function recipeTags(def: ItemDef, components: CraftVector): readonly string[] {
  const tags = new Set<string>();
  if (def.type === ItemType.FOOD || def.type === ItemType.DRINK) tags.add('survival');
  if (def.type === ItemType.WEAPON) tags.add('weapon');
  if (def.type === ItemType.TOOL) tags.add('tool');
  if (def.type === ItemType.AMMO) tags.add('ammo');
  if (def.type === ItemType.MEDICINE) tags.add('medicine');
  if (def.type === ItemType.NOTE || hasTag(def, 'document') || hasTag(def, 'permit')) tags.add('document');
  if (components[craftMaterialIndex('psimatter')] > 0) tags.add('psi');
  if (components[craftMaterialIndex('cybernetics')] > 0) tags.add('cybernetics');
  if (components[craftMaterialIndex('metamatter')] > 0) tags.add('metamatter');
  if (craftVectorTotal(components) > 90 || hasTag(def, 'deep_route') || hasTag(def, 'darkness_route')) tags.add('deep_route');
  if (hasTag(def, 'unique_reward') || INTENTIONAL_RARE_MATERIAL_ITEMS[def.id]?.includes('metamatter')) tags.add('unique');
  for (const tag of tagsOf(def)) tags.add(tag);
  return [...tags].sort();
}

function recipeForItem(def: ItemDef): CraftRecipeDef {
  const components = ITEM_COMPOSITIONS[def.id];
  return {
    id: craftRecipeIdForItem(def.id),
    itemId: def.id,
    resultCount: 1,
    components,
    station: stationForItem(def, components),
    discoverable: true,
    knownByDefault: DEFAULT_KNOWN_RECIPE_IDS.has(def.id),
    tier: tierForComponents(components),
    tags: recipeTags(def, components),
  };
}

function makeRecipeRegistry(): CraftRecipeRegistry {
  const registry = Object.fromEntries(Object.values(ITEMS).map(def => {
    const recipe = recipeForItem(def);
    return [recipe.id, recipe];
  })) as CraftRecipeRegistry;
  const recipes = Object.freeze(Object.values(registry));
  Object.defineProperties(registry, {
    [Symbol.iterator]: {
      enumerable: false,
      value: function iterateRecipes() {
        return recipes[Symbol.iterator]();
      },
    },
    length: { enumerable: false, value: recipes.length },
    map: { enumerable: false, value: recipes.map.bind(recipes) },
    filter: { enumerable: false, value: recipes.filter.bind(recipes) },
    flatMap: { enumerable: false, value: recipes.flatMap.bind(recipes) },
    forEach: { enumerable: false, value: recipes.forEach.bind(recipes) },
    some: { enumerable: false, value: recipes.some.bind(recipes) },
    every: { enumerable: false, value: recipes.every.bind(recipes) },
    find: { enumerable: false, value: recipes.find.bind(recipes) },
  });
  return Object.freeze(registry);
}

export const CRAFT_RECIPES: CraftRecipeRegistry = makeRecipeRegistry();

export const CRAFT_RECIPE_LIST: readonly CraftRecipeDef[] = Object.freeze(Object.values(CRAFT_RECIPES));

export function craftRecipeById(recipeId: string): CraftRecipeDef | undefined {
  return CRAFT_RECIPES[recipeId];
}

export function craftRecipeByItemId(itemId: string): CraftRecipeDef | undefined {
  return CRAFT_RECIPES[craftRecipeIdForItem(itemId)];
}

export const CRAFT_RECIPE_EXCEPTIONS: Record<string, string> = Object.freeze({});
