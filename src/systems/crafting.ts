import {
  type CraftingState,
  type Entity,
  type GameState,
  type MutableCraftVector,
  msg,
} from '../core/types';
import { ITEMS } from '../data/catalog';
import {
  CRAFT_MATERIAL_COUNT,
  CRAFT_MATERIAL_DEFS,
  CRAFT_MATERIAL_IDS,
  craftMaterialIndex,
  emptyCraftVector,
  isCraftMaterialId,
  type CraftMaterialId,
  type CraftStationKind,
  type CraftVector,
} from '../data/craft_materials';
import {
  CRAFT_RECIPES,
  craftRecipeById,
  craftRecipeByItemId,
  type CraftRecipeDef,
} from '../data/craft_recipes';
import {
  craftRecipeItemId,
  type CraftRecipeSourceDef,
} from '../data/craft_recipe_sources';
import { itemComposition } from '../data/item_composition';
import { addItem, canAddItem } from './inventory';
import { publishEvent } from './events';

export type { CraftingState, MutableCraftVector };
export type { CraftMaterialId, CraftStationKind, CraftVector };

const MAX_CRAFT_MATERIAL = 999_999;
const MAX_KNOWN_RECIPES = 2048;

export interface CraftingSavePayload {
  materials: MutableCraftVector;
  knownRecipes: string[];
}

export interface CraftRecipeLearnResult {
  sourceId?: string;
  learned: string[];
  duplicate: string[];
  unknown: string[];
}

export type CraftFailureReason =
  | 'invalid_slot'
  | 'unknown_item'
  | 'no_composition'
  | 'invalid_station'
  | 'unknown_recipe'
  | 'recipe_not_learned'
  | 'station_mismatch'
  | 'insufficient_materials'
  | 'inventory_full'
  | 'inventory_remove_failed'
  | 'inventory_add_failed';

export interface CraftCheck {
  ok: boolean;
  reason?: CraftFailureReason;
  message: string;
  recipe?: CraftRecipeDef;
}

export interface CraftingActionContext {
  actor: Entity;
  state: GameState;
  station?: CraftStationKind;
  stationKind?: CraftStationKind;
  recipeId?: string;
  slotIndex?: number;
  rng?: () => number;
}

export interface CraftingActionResult {
  ok: boolean;
  reason?: CraftFailureReason;
  message: string;
  itemId?: string;
  recipeId?: string;
  materialId?: CraftMaterialId;
  learnedRecipeId?: string;
}

export interface CraftMenuSnapshotContext {
  actor: Entity;
  state: GameState;
  mode?: 'craft' | 'disassemble';
  station?: CraftStationKind;
  stationKind?: CraftStationKind;
  filter?: string;
}

export interface CraftMenuRecipeEntry {
  kind: 'recipe';
  id: string;
  recipeId: string;
  itemId: string;
  itemName: string;
  name: string;
  description: string;
  resultCount: number;
  components: CraftVector;
  station: CraftStationKind;
  tier: 0 | 1 | 2 | 3 | 4;
  tags: readonly string[];
  canCraft: boolean;
  craftable: boolean;
  missing: MutableCraftVector;
  missingMaterials: Partial<Record<CraftMaterialId, number>>;
  blockedReason?: CraftFailureReason;
}

export interface CraftMenuDisassembleEntry {
  kind: 'disassemble';
  slotIndex: number;
  itemId: string;
  itemName: string;
  name: string;
  description: string;
  count: number;
  components: CraftVector;
  canDisassemble: boolean;
  possibleOutputs: readonly { materialId: CraftMaterialId; label: string; weight: number }[];
  blockedReason?: CraftFailureReason;
}

export interface CraftMenuSnapshot {
  mode: 'craft' | 'disassemble';
  stationKind: CraftStationKind;
  materials: MutableCraftVector;
  recipes: CraftMenuRecipeEntry[];
  inventory: CraftMenuDisassembleEntry[];
  knownRecipes: CraftMenuRecipeSnapshot[];
  disassemblyItems: CraftMenuDisassemblySnapshot[];
}

export type CraftMenuRecipeSnapshot = Omit<CraftMenuRecipeEntry, 'kind'>;
export type CraftMenuDisassemblySnapshot = Omit<CraftMenuDisassembleEntry, 'kind'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cleanMaterialCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_CRAFT_MATERIAL, Math.floor(n)));
}

function cleanTime(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function cloneVector(vector: CraftVector | MutableCraftVector): MutableCraftVector {
  return [
    cleanMaterialCount(vector[0]),
    cleanMaterialCount(vector[1]),
    cleanMaterialCount(vector[2]),
    cleanMaterialCount(vector[3]),
    cleanMaterialCount(vector[4]),
    cleanMaterialCount(vector[5]),
    cleanMaterialCount(vector[6]),
    cleanMaterialCount(vector[7]),
    cleanMaterialCount(vector[8]),
  ];
}

function sanitizeMaterialVector(input: unknown): MutableCraftVector {
  const out = emptyCraftVector();
  if (!Array.isArray(input)) return out;
  for (let i = 0; i < CRAFT_MATERIAL_COUNT; i++) out[i] = cleanMaterialCount(input[i]);
  return out;
}

let _cachedDefaultKnownRecipes: Record<string, true> | null = null;

function defaultKnownRecipes(): Record<string, true> {
  if (!_cachedDefaultKnownRecipes) {
    _cachedDefaultKnownRecipes = {};
    for (const recipe of Object.values(CRAFT_RECIPES)) {
      if (recipe.knownByDefault) _cachedDefaultKnownRecipes[recipe.id] = true;
    }
  }
  return { ..._cachedDefaultKnownRecipes };
}

function sanitizeKnownRecipes(input: unknown): Record<string, true> {
  const out = defaultKnownRecipes();
  let used = Object.keys(out).length;
  const add = (rawId: unknown): void => {
    if (used >= MAX_KNOWN_RECIPES || typeof rawId !== 'string') return;
    const id = rawId.slice(0, 96);
    const recipe = craftRecipeById(id);
    if (!recipe || out[id]) return;
    out[id] = true;
    used++;
  };

  if (Array.isArray(input)) {
    for (const rawId of input) add(rawId);
  } else if (isRecord(input)) {
    for (const [rawId, known] of Object.entries(input)) {
      if (known === true) add(rawId);
    }
  }
  return out;
}

function stateTime(state: GameState): number {
  return Number.isFinite(state.time) ? Math.max(0, state.time) : 0;
}

function touchCrafting(state: GameState, crafting = ensureCraftingState(state)): void {
  crafting.learnedCount = Object.keys(crafting.knownRecipes).length;
  crafting.lastChangedAt = stateTime(state);
}

function fail(reason: CraftFailureReason, message: string): CraftingActionResult {
  return { ok: false, reason, message };
}

function checkFail(reason: CraftFailureReason, message: string): CraftCheck {
  return { ok: false, reason, message };
}

function stationFromContext(ctx: Pick<CraftingActionContext | CraftMenuSnapshotContext, 'station' | 'stationKind'>): CraftStationKind {
  return ctx.stationKind ?? ctx.station ?? 'any';
}

function stationMatches(recipe: CraftRecipeDef, station: CraftStationKind): boolean {
  return recipe.station === 'any' || recipe.station === station;
}

function randomUnit(rng?: () => number): number {
  const n = rng ? Number(rng()) : Math.random();
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(0.999999, n));
}

function removeInventorySlotItem(actor: Entity, slotIndex: number, defId: string): boolean {
  const inventory = actor.inventory;
  const slot = inventory?.[slotIndex];
  if (!slot || slot.defId !== defId || slot.count <= 0) return false;
  slot.count--;
  if (slot.count <= 0) inventory.splice(slotIndex, 1);
  return true;
}

function weightedMaterial(components: CraftVector, rng?: () => number): CraftMaterialId | undefined {
  let total = 0;
  for (const count of components) total += cleanMaterialCount(count);
  if (total <= 0) return undefined;
  let roll = randomUnit(rng) * total;
  for (let i = 0; i < CRAFT_MATERIAL_COUNT; i++) {
    roll -= cleanMaterialCount(components[i]);
    if (roll < 0) return CRAFT_MATERIAL_IDS[i];
  }
  return CRAFT_MATERIAL_IDS[CRAFT_MATERIAL_COUNT - 1];
}

function canDisassembleAtStation(station: CraftStationKind): boolean {
  return station === 'workbench';
}

function materialTags(vector: CraftVector, limit: number): string[] {
  const tags: string[] = [];
  for (let i = 0; i < CRAFT_MATERIAL_COUNT && tags.length < limit; i++) {
    if (vector[i] > 0) tags.push(`material_${CRAFT_MATERIAL_IDS[i]}`);
  }
  return tags;
}

function missingMaterials(materials: CraftVector | MutableCraftVector, components: CraftVector): MutableCraftVector {
  const out = emptyCraftVector();
  for (let i = 0; i < CRAFT_MATERIAL_COUNT; i++) out[i] = Math.max(0, components[i] - materials[i]);
  return out;
}

function missingMaterialRecord(missing: CraftVector | MutableCraftVector): Partial<Record<CraftMaterialId, number>> {
  const out: Partial<Record<CraftMaterialId, number>> = {};
  for (let i = 0; i < CRAFT_MATERIAL_COUNT; i++) {
    if (missing[i] > 0) out[CRAFT_MATERIAL_IDS[i]] = missing[i];
  }
  return out;
}

function vectorHasAny(vector: CraftVector | MutableCraftVector): boolean {
  return vector.some(value => value > 0);
}

function materialLabel(materialId: CraftMaterialId): string {
  return CRAFT_MATERIAL_DEFS[craftMaterialIndex(materialId)]?.shortName ?? materialId;
}

export function createCraftingState(): CraftingState {
  const knownRecipes = defaultKnownRecipes();
  return {
    materials: emptyCraftVector(),
    knownRecipes,
    learnedCount: Object.keys(knownRecipes).length,
    lastChangedAt: 0,
  };
}

export function sanitizeCraftingState(input: unknown): CraftingState {
  if (!isRecord(input)) return createCraftingState();
  const knownRecipes = sanitizeKnownRecipes(input.knownRecipes);
  return {
    materials: sanitizeMaterialVector(input.materials),
    knownRecipes,
    learnedCount: Object.keys(knownRecipes).length,
    lastChangedAt: cleanTime(input.lastChangedAt),
  };
}

export function ensureCraftingState(state: GameState): CraftingState {
  state.crafting = sanitizeCraftingState(state.crafting);
  return state.crafting;
}

export function craftingForSave(state: GameState): CraftingSavePayload {
  const crafting = ensureCraftingState(state);
  return {
    materials: cloneVector(crafting.materials),
    knownRecipes: Object.keys(crafting.knownRecipes).filter(id => !!craftRecipeById(id)).slice(0, MAX_KNOWN_RECIPES),
  };
}

export function restoreCraftingState(input: unknown): CraftingState {
  return sanitizeCraftingState(input);
}

export function craftRecipeExists(recipeId: string): boolean {
  return !!craftRecipeById(recipeId);
}

export function craftRecipeDisplayName(recipeId: string): string {
  const recipe = craftRecipeById(recipeId);
  if (recipe) return ITEMS[recipe.itemId]?.name ?? recipe.itemId;
  const itemId = craftRecipeItemId(recipeId);
  return itemId ? ITEMS[itemId]?.name ?? itemId : recipeId;
}

export function learnCraftRecipe(state: GameState, recipeId: string, source?: string): boolean {
  const recipe = craftRecipeById(recipeId);
  if (!recipe || !recipe.discoverable) return false;
  const crafting = ensureCraftingState(state);
  if (crafting.knownRecipes[recipeId]) return false;
  crafting.knownRecipes[recipeId] = true;
  touchCrafting(state, crafting);
  publishEvent(state, {
    type: 'craft_recipe_learned',
    itemId: recipe.itemId,
    itemName: ITEMS[recipe.itemId]?.name,
    severity: 2,
    privacy: 'private',
    tags: ['crafting', 'recipe', ...recipe.tags.slice(0, 4)],
    data: { itemId: recipe.itemId, recipeId, source },
  });
  return true;
}

export function isCraftRecipeKnown(state: GameState, recipeId: string): boolean {
  return hasCraftRecipe(state, recipeId);
}

export function hasCraftRecipe(state: GameState, recipeId: string): boolean {
  return !!craftRecipeById(recipeId) && ensureCraftingState(state).knownRecipes[recipeId] === true;
}

export function addCraftMaterial(state: GameState, materialId: CraftMaterialId, count: number): void {
  if (!isCraftMaterialId(materialId)) return;
  const amount = cleanMaterialCount(count);
  if (amount <= 0) return;
  const crafting = ensureCraftingState(state);
  const idx = craftMaterialIndex(materialId);
  crafting.materials[idx] = Math.min(MAX_CRAFT_MATERIAL, crafting.materials[idx] + amount);
  touchCrafting(state, crafting);
}

export function canCraftRecipe(actor: Entity, state: GameState, recipeId: string, station: CraftStationKind): CraftCheck {
  const recipe = craftRecipeById(recipeId);
  if (!recipe) return checkFail('unknown_recipe', 'Рецепт не найден.');
  if (!hasCraftRecipe(state, recipeId)) return checkFail('recipe_not_learned', 'Рецепт не изучен.');
  if (!stationMatches(recipe, station)) return checkFail('station_mismatch', 'Здесь этот рецепт не собрать.');
  if (!ITEMS[recipe.itemId]) return checkFail('unknown_item', 'Предмет рецепта не найден.');
  const crafting = ensureCraftingState(state);
  for (let i = 0; i < CRAFT_MATERIAL_COUNT; i++) {
    if (crafting.materials[i] < recipe.components[i]) return checkFail('insufficient_materials', 'Не хватает материалов.');
  }
  if (!canAddItem(actor, recipe.itemId, recipe.resultCount)) return checkFail('inventory_full', 'Нет места в инвентаре.');
  return { ok: true, message: 'Можно собрать.', recipe };
}

export function craftKnownRecipe(ctx: CraftingActionContext): CraftingActionResult {
  const recipeId = ctx.recipeId ?? '';
  const station = stationFromContext(ctx);
  const check = canCraftRecipe(ctx.actor, ctx.state, recipeId, station);
  if (!check.ok || !check.recipe) return fail(check.reason ?? 'unknown_recipe', check.message);
  const recipe = check.recipe;
  const crafting = ensureCraftingState(ctx.state);

  for (let i = 0; i < CRAFT_MATERIAL_COUNT; i++) crafting.materials[i] -= recipe.components[i];
  if (!addItem(ctx.actor, recipe.itemId, recipe.resultCount)) {
    for (let i = 0; i < CRAFT_MATERIAL_COUNT; i++) {
      crafting.materials[i] = Math.min(MAX_CRAFT_MATERIAL, crafting.materials[i] + recipe.components[i]);
    }
    return fail('inventory_add_failed', 'Инвентарь отказал уже после проверки.');
  }

  touchCrafting(ctx.state, crafting);
  const itemName = ITEMS[recipe.itemId]?.name ?? recipe.itemId;
  publishEvent(ctx.state, {
    type: 'player_craft_item',
    actorId: ctx.actor.id,
    actorName: ctx.actor.name,
    actorFaction: ctx.actor.faction,
    itemId: recipe.itemId,
    itemName,
    itemCount: recipe.resultCount,
    severity: 2,
    privacy: 'private',
    tags: ['crafting', 'recipe', ...materialTags(recipe.components, 5)],
    data: { itemId: recipe.itemId, recipeId: recipe.id, stationKind: station },
  });

  const message = `Собрано: ${itemName}.`;
  ctx.state.msgs.push(msg(message, ctx.state.time, '#8cf'));
  return { ok: true, message, itemId: recipe.itemId, recipeId: recipe.id };
}

export function disassembleInventorySlot(ctx: CraftingActionContext): CraftingActionResult {
  const slotIndex = Math.floor(Number(ctx.slotIndex));
  const station = stationFromContext(ctx);
  const inventory = ctx.actor.inventory ?? [];
  if (!Number.isFinite(slotIndex) || slotIndex < 0 || slotIndex >= inventory.length) return fail('invalid_slot', 'Слот разборки пуст.');
  if (!canDisassembleAtStation(station)) return fail('invalid_station', 'Нужен верстак разборки.');

  const slot = inventory[slotIndex];
  const itemDef = ITEMS[slot.defId];
  if (!itemDef) return fail('unknown_item', 'Предмет не найден.');
  const composition = itemComposition(slot.defId);
  if (!composition) return fail('no_composition', 'У предмета нет состава.');
  const materialId = weightedMaterial(composition.components, ctx.rng);
  if (!materialId) return fail('no_composition', 'У предмета пустой состав.');
  if (!removeInventorySlotItem(ctx.actor, slotIndex, slot.defId)) return fail('inventory_remove_failed', 'Не удалось снять предмет со слота.');

  addCraftMaterial(ctx.state, materialId, 1);
  const recipe = craftRecipeByItemId(slot.defId);
  let learnedRecipeId: string | undefined;
  if (recipe && recipe.discoverable && randomUnit(ctx.rng) < 0.5) {
    if (learnCraftRecipe(ctx.state, recipe.id, 'disassembly')) learnedRecipeId = recipe.id;
  }

  publishEvent(ctx.state, {
    type: 'player_disassemble_item',
    actorId: ctx.actor.id,
    actorName: ctx.actor.name,
    actorFaction: ctx.actor.faction,
    itemId: slot.defId,
    itemName: itemDef.name,
    itemCount: 1,
    severity: learnedRecipeId ? 3 : 2,
    privacy: 'private',
    tags: ['crafting', 'disassembly', 'recipe', `material_${materialId}`],
    data: { itemId: slot.defId, recipeId: recipe?.id, materialId, stationKind: station, source: 'disassembly' },
  });

  const learnedText = learnedRecipeId ? ' Рецепт всплыл в голове.' : '';
  const message = `Разобрано: ${itemDef.name}. Материал: ${materialLabel(materialId)}.${learnedText}`;
  ctx.state.msgs.push(msg(message, ctx.state.time, learnedRecipeId ? '#8cf' : '#ccc'));
  return { ok: true, message, itemId: slot.defId, recipeId: recipe?.id, materialId, learnedRecipeId };
}

export function learnCraftRecipesFromSource(state: GameState, source: CraftRecipeSourceDef): CraftRecipeLearnResult {
  const result: CraftRecipeLearnResult = {
    sourceId: source.id,
    learned: [],
    duplicate: [],
    unknown: [],
  };
  for (const recipeId of source.recipeIds) {
    if (!craftRecipeExists(recipeId)) {
      result.unknown.push(recipeId);
      continue;
    }
    if (learnCraftRecipe(state, recipeId, source.id)) result.learned.push(recipeId);
    else result.duplicate.push(recipeId);
  }
  return result;
}

export function craftRecipeLearnedMessage(recipeId: string): string {
  return `Рецепт изучен: ${craftRecipeDisplayName(recipeId)}`;
}

function entryMatchesFilter(text: string, filter: string | undefined): boolean {
  const clean = filter?.trim().toLowerCase();
  return !clean || text.toLowerCase().includes(clean);
}

function possibleOutputs(components: CraftVector): { materialId: CraftMaterialId; label: string; weight: number }[] {
  const out: { materialId: CraftMaterialId; label: string; weight: number }[] = [];
  for (let i = 0; i < CRAFT_MATERIAL_COUNT; i++) {
    const weight = components[i];
    if (weight <= 0) continue;
    const materialId = CRAFT_MATERIAL_IDS[i];
    out.push({ materialId, label: materialLabel(materialId), weight });
  }
  return out;
}

export function craftMenuSnapshot(ctx: CraftMenuSnapshotContext): CraftMenuSnapshot {
  const mode = ctx.mode ?? 'craft';
  const stationKind = stationFromContext(ctx);
  const crafting = ensureCraftingState(ctx.state);
  const recipes: CraftMenuRecipeEntry[] = [];
  const inventory: CraftMenuDisassembleEntry[] = [];
  const filter = ctx.filter;

  for (const recipe of Object.values(CRAFT_RECIPES)) {
    if (!crafting.knownRecipes[recipe.id]) continue;
    const itemDef = ITEMS[recipe.itemId];
    if (!itemDef) continue;
    if (!entryMatchesFilter(`${itemDef.name} ${recipe.id} ${recipe.tags.join(' ')}`, filter)) continue;
    const check = canCraftRecipe(ctx.actor, ctx.state, recipe.id, stationKind);
    const missing = missingMaterials(crafting.materials, recipe.components);
    recipes.push({
      kind: 'recipe',
      id: recipe.id,
      recipeId: recipe.id,
      itemId: recipe.itemId,
      itemName: itemDef.name,
      name: itemDef.name,
      description: itemDef.desc,
      resultCount: recipe.resultCount,
      components: recipe.components,
      station: recipe.station,
      tier: recipe.tier,
      tags: recipe.tags,
      canCraft: check.ok,
      craftable: check.ok,
      missing,
      missingMaterials: missingMaterialRecord(missing),
      blockedReason: check.reason,
    });
  }

  for (let slotIndex = 0; slotIndex < (ctx.actor.inventory?.length ?? 0); slotIndex++) {
    const slot = ctx.actor.inventory![slotIndex];
    const itemDef = ITEMS[slot.defId];
    if (!itemDef) continue;
    const composition = itemComposition(slot.defId);
    const components = composition?.components ?? emptyCraftVector();
    if (!entryMatchesFilter(`${itemDef.name} ${slot.defId}`, filter)) continue;
    inventory.push({
      kind: 'disassemble',
      slotIndex,
      itemId: slot.defId,
      itemName: itemDef.name,
      name: itemDef.name,
      description: itemDef.desc,
      count: slot.count,
      components,
      canDisassemble: canDisassembleAtStation(stationKind) && !!composition && vectorHasAny(components),
      possibleOutputs: composition ? possibleOutputs(composition.components) : [],
      blockedReason: composition ? canDisassembleAtStation(stationKind) ? undefined : 'invalid_station' : 'no_composition',
    });
  }

  return {
    mode,
    stationKind,
    materials: cloneVector(crafting.materials),
    recipes,
    inventory,
    knownRecipes: recipes,
    disassemblyItems: inventory,
  };
}

export function craftMenuEntries(snapshot: CraftMenuSnapshot): readonly (CraftMenuRecipeEntry | CraftMenuDisassembleEntry)[] {
  return snapshot.mode === 'craft' ? snapshot.recipes : snapshot.inventory;
}

export function craftMaterialLine(vector: CraftVector | MutableCraftVector): string {
  const parts: string[] = [];
  for (let i = 0; i < CRAFT_MATERIAL_COUNT; i++) {
    const value = cleanMaterialCount(vector[i]);
    if (value <= 0) continue;
    parts.push(`${CRAFT_MATERIAL_DEFS[i]?.shortName ?? CRAFT_MATERIAL_IDS[i]} ${value}`);
  }
  return parts.length > 0 ? parts.join('  ') : 'нет';
}

export function craftEntryMissingLine(entry: CraftMenuRecipeEntry): string {
  return vectorHasAny(entry.missing) ? craftMaterialLine(entry.missing) : 'ничего';
}
