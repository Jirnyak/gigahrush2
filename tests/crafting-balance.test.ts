import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType } from '../src/core/types';
import { ITEMS } from '../src/data/catalog';
import { CRAFT_MATERIAL_IDS } from '../src/data/craft_materials';
import { ITEM_COMPOSITIONS } from '../src/data/item_composition';
import { CRAFT_RECIPES } from '../src/data/craft_recipes';
import { PSI_WEAPON_STATS } from '../src/data/psi';
import { PHYS_WEAPON_ROLE_TIERS } from '../src/data/weapons';

type CraftVectorLike = readonly number[];

interface CraftRecipeLike {
  id: string;
  itemId: string;
  components: CraftVectorLike;
  tier: 0 | 1 | 2 | 3 | 4;
  tags: readonly string[];
}

const MATERIAL_INDEX = new Map(CRAFT_MATERIAL_IDS.map((id, index) => [id, index]));
const compositions = ITEM_COMPOSITIONS as Record<string, CraftVectorLike>;
const recipes = Array.from(CRAFT_RECIPES as Iterable<CraftRecipeLike>);

function material(vector: CraftVectorLike, id: string): number {
  const index = MATERIAL_INDEX.get(id);
  assert.notEqual(index, undefined, `missing craft material id ${id}`);
  return vector[index as number] ?? 0;
}

function total(vector: CraftVectorLike): number {
  return vector.reduce((sum, value) => sum + value, 0);
}

function tagsFor(itemId: string): Set<string> {
  return new Set(ITEMS[itemId]?.tags ?? []);
}

function hasAnyTag(itemId: string, tags: readonly string[]): boolean {
  const itemTags = tagsFor(itemId);
  return tags.some(tag => itemTags.has(tag));
}

function composition(itemId: string): CraftVectorLike {
  const vector = compositions[itemId];
  assert.ok(vector, `missing craft composition for ${itemId}`);
  return vector;
}

const TRIVIAL_TYPES = new Set<ItemType>([ItemType.FOOD, ItemType.DRINK, ItemType.NOTE]);
const TRIVIAL_EXCEPTION_TAGS = [
  'unique',
  'rare',
  'deep_route',
  'void',
  'hell',
  'psi',
  'sample',
  'contraband',
  'quest',
  'story',
  'official',
  'permit',
  'weapon_permit',
  'audit',
  'black_market',
];

const STARTER_DOCUMENT_TAGS = ['document', 'paper', 'ration', 'coupon', 'identity', 'receipt'];
const RARE_MATERIAL_IDS = ['cybernetics', 'psimatter', 'metamatter'] as const;
const WEAPON_MATERIAL_IDS = ['metal', 'mechanics', 'electronics', 'psimatter', 'metamatter'] as const;
const HIGH_TECH_WEAPON_TAGS = [
  'energy',
  'electronics',
  'cybernetics',
  'terminal',
  'net',
  'beam',
  'ammo_energy',
  'rare_energy',
];
const HIGH_TECH_WEAPON_IDS = new Set(['gauss', 'plasma', 'bfg', 'gravity_beam_emitter', 'grn420_gravizhernov']);

function isTrivialItem(itemId: string): boolean {
  const def = ITEMS[itemId];
  return !!def
    && def.value <= 60
    && TRIVIAL_TYPES.has(def.type)
    && !hasAnyTag(itemId, TRIVIAL_EXCEPTION_TAGS);
}

function isCommonStarterFoodDrinkOrDocument(itemId: string): boolean {
  const def = ITEMS[itemId];
  if (!def || def.value > 80 || hasAnyTag(itemId, TRIVIAL_EXCEPTION_TAGS)) return false;
  return def.type === ItemType.FOOD
    || def.type === ItemType.DRINK
    || (def.type === ItemType.NOTE && hasAnyTag(itemId, STARTER_DOCUMENT_TAGS));
}

function isHighTechOrEnergyWeapon(itemId: string): boolean {
  return HIGH_TECH_WEAPON_IDS.has(itemId)
    || PHYS_WEAPON_ROLE_TIERS[itemId] === 'rare_energy'
    || hasAnyTag(itemId, HIGH_TECH_WEAPON_TAGS);
}

test('trivial food, drink and document compositions stay cheap', () => {
  const tooExpensive = Object.keys(ITEMS)
    .filter(isTrivialItem)
    .filter(itemId => total(composition(itemId)) > 6)
    .map(itemId => `${itemId}:${total(composition(itemId))}`);

  assert.deepEqual(tooExpensive, [], 'trivial item craft totals must stay <= 6 unless tagged as exceptional');
});

test('metamatter recipes are endgame, deep, or unique', () => {
  const invalid = recipes
    .filter(recipe => material(recipe.components, 'metamatter') > 0)
    .filter(recipe => recipe.tier !== 4 && !recipe.tags.some(tag => ['deep_route', 'unique', 'endgame', 'void', 'hell', 'e4', 'metamatter'].includes(tag)))
    .map(recipe => `${recipe.id}:tier${recipe.tier}:${recipe.tags.join(',')}`);

  assert.deepEqual(invalid, [], 'metamatter recipes must be tier 4 or explicitly deep/unique/endgame tagged');
});

test('common starter food, drink and documents do not use rare materials', () => {
  const invalid = Object.keys(ITEMS)
    .filter(isCommonStarterFoodDrinkOrDocument)
    .filter(itemId => RARE_MATERIAL_IDS.some(materialId => material(composition(itemId), materialId) > 0))
    .map(itemId => itemId);

  assert.deepEqual(invalid, [], 'starter food, drink and document compositions must not use rare craft materials');
});

test('PSI weapon items require psimatter', () => {
  const missingPsimatter = Object.keys(PSI_WEAPON_STATS)
    .filter(itemId => material(composition(itemId), 'psimatter') <= 0);

  assert.deepEqual(missingPsimatter, [], 'PSI weapon compositions must include psimatter');
});

test('high-tech and energy weapons require electronics or cybernetics', () => {
  const invalid = Object.keys(ITEMS)
    .filter(itemId => ITEMS[itemId].type === ItemType.WEAPON)
    .filter(isHighTechOrEnergyWeapon)
    .filter(itemId => material(composition(itemId), 'electronics') + material(composition(itemId), 'cybernetics') <= 0);

  assert.deepEqual(invalid, [], 'high-tech and energy weapon compositions must include electronics or cybernetics');
});

test('ammo compositions include chemical or metal material', () => {
  const invalid = Object.keys(ITEMS)
    .filter(itemId => ITEMS[itemId].type === ItemType.AMMO)
    .filter(itemId => material(composition(itemId), 'chemical') + material(composition(itemId), 'metal') <= 0);

  assert.deepEqual(invalid, [], 'ammo compositions must include chemical or metal');
});

test('weapon compositions include at least one weapon-relevant material', () => {
  const invalid = Object.keys(ITEMS)
    .filter(itemId => ITEMS[itemId].type === ItemType.WEAPON)
    .filter(itemId => WEAPON_MATERIAL_IDS.every(materialId => material(composition(itemId), materialId) <= 0));

  assert.deepEqual(invalid, [], 'weapon compositions must include a weapon-relevant material');
});
