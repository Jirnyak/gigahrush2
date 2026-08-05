import {
  Cell,
  ContainerKind,
  Faction,
  Feature,
  FloorLevel,
  type ContainerAccess,
  type Entity,
  type GameState,
  type Room,
  type WorldContainer,
  type WorldEventPrivacy,
  type WorldEventSeverity,
  msg,
} from '../core/types';
import { World } from '../core/world';
import {
  FACTORIES,
  factoryForRoom,
  productionRecipeImportant,
  productionRewardTargetTags,
  type FactoryBadBatchDef,
  type FactoryDef,
  type FactoryRecipeDef,
  type ItemStackDef,
} from '../data/factories';
import { MAX_INVENTORY_SLOTS } from '../data/inventory_limits';
import { ITEMS } from '../data/catalog';
import { CONTAINER_DEFS } from '../data/container_defs';
import { getStack } from '../data/items';
import { ensureRoomContainers } from './containers';
import { canSpendResources, spendResources } from './economy';
import { publishEvent } from './events';
import { territoryOwnerToFaction } from '../data/factions';
import { territoryRoomOwner } from './territory';

export interface ProductionState {
  floor: FloorLevel;
  roomId: number;
  factoryId: string;
  recipeId: string;
  progressSec: number;
  nextTickAt: number;
  outputContainerId: number;
  cycleCount?: number;
  jammed?: boolean;
  blockedReason?: 'no_inputs' | 'container_full' | 'no_container';
}

export interface ProductionRewardTargetQuery {
  factoryId?: string;
  recipeId?: string;
  itemId?: string;
  resourceId?: string;
  preferBlocked?: boolean;
}

export interface ProductionRewardTarget {
  production: ProductionState;
  container: WorldContainer;
  factory: FactoryDef;
  recipe: FactoryRecipeDef;
  score: number;
}

type ProductionGameState = GameState & { production?: ProductionState[] };
const MAX_PRODUCTION_ROOMS = 64;
const MAX_PRODUCTION_STATES = 128;
export const PRODUCTION_SAVE_STATE_CAP = MAX_PRODUCTION_STATES;
const MAX_OUTPUT_CONTAINERS = 128;
const AUTO_OUTPUT_TAG = 'auto_production_output';
const MAX_SAVED_TIME = 365 * 24 * 60 * 60;
const BLOCKED_REASONS = ['no_inputs', 'container_full', 'no_container'] as const;
type ProductionBlockedReason = typeof BLOCKED_REASONS[number];

function isFloorLevel(value: unknown): value is FloorLevel {
  return typeof value === 'number' && Number.isInteger(value) && FloorLevel[value] !== undefined;
}

function cleanFinite(value: unknown, fallback: number, min = 0, max = MAX_SAVED_TIME): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function cleanInt(value: unknown, fallback: number, min = 0, max = 1_000_000): number {
  return Math.floor(cleanFinite(value, fallback, min, max));
}

function cleanBlockedReason(value: unknown): ProductionState['blockedReason'] | undefined {
  const reason = value as ProductionBlockedReason;
  return BLOCKED_REASONS.includes(reason)
    ? reason
    : undefined;
}

function normalizeProductionEntry(raw: unknown, fallbackFloor: FloorLevel): ProductionState | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Partial<ProductionState>;
  const factory = typeof src.factoryId === 'string'
    ? FACTORIES.find(f => f.id === src.factoryId)
    : undefined;
  const recipe = factory && typeof src.recipeId === 'string'
    ? factory.recipes.find(r => r.id === src.recipeId)
    : undefined;
  if (!factory || !recipe) return null;
  const cycleSec = Math.max(30, recipe.cycleSec);
  const out: ProductionState = {
    floor: isFloorLevel(src.floor) ? src.floor : fallbackFloor,
    roomId: cleanInt(src.roomId, -1, 0, 100_000),
    factoryId: factory.id,
    recipeId: recipe.id,
    progressSec: cleanFinite(src.progressSec, 0, 0, cycleSec),
    nextTickAt: cleanFinite(src.nextTickAt, 0),
    outputContainerId: cleanInt(src.outputContainerId, 0, 0),
  };
  const cycleCount = cleanInt(src.cycleCount, 0, 0, 1_000_000);
  if (cycleCount > 0) out.cycleCount = cycleCount;
  if (src.jammed === true) out.jammed = true;
  const blockedReason = cleanBlockedReason(src.blockedReason);
  if (blockedReason) out.blockedReason = blockedReason;
  return out;
}

export function setProductionState(
  state: GameState,
  input: unknown,
  fallbackFloor = state.currentFloor,
): ProductionState[] {
  const normalized = normalizeProductionStateList(input, fallbackFloor);
  (state as ProductionGameState).production = normalized;
  return normalized;
}

function productionList(state: GameState): ProductionState[] {
  const s = state as ProductionGameState;
  if (!s.production) s.production = [];
  return s.production;
}

export function normalizeProductionStateList(
  input: unknown,
  fallbackFloor: FloorLevel,
  cap = PRODUCTION_SAVE_STATE_CAP,
): ProductionState[] {
  if (!Array.isArray(input)) return [];
  const out: ProductionState[] = [];
  const used = new Set<string>();
  for (const raw of input) {
    const normalized = normalizeProductionEntry(raw, fallbackFloor);
    if (!normalized) continue;
    const key = `${normalized.floor}:${normalized.roomId}:${normalized.factoryId}`;
    if (used.has(key)) continue;
    used.add(key);
    out.push(normalized);
  }
  const max = Math.max(0, Math.floor(cap));
  if (max <= 0) return [];
  if (out.length <= max) return out;
  const currentFloor = out.filter(p => p.floor === fallbackFloor).slice(-max);
  const slotsLeft = Math.max(0, max - currentFloor.length);
  const otherFloors = out.filter(p => p.floor !== fallbackFloor).slice(-slotsLeft);
  return [...otherFloors, ...currentFloor];
}

export function productionForSave(state: GameState): ProductionState[] {
  return normalizeProductionStateList(productionList(state), state.currentFloor);
}

function productionFloor(state: GameState, p: ProductionState): FloorLevel {
  const saved = p as ProductionState & { floor?: FloorLevel };
  if (saved.floor === undefined) saved.floor = state.currentFloor;
  return saved.floor;
}

function productionCountForCurrentFloor(state: GameState): number {
  let count = 0;
  for (const p of productionList(state)) {
    if (productionFloor(state, p) === state.currentFloor) count++;
  }
  return count;
}

function productionRoomCountForCurrentFloor(state: GameState): number {
  const rooms = new Set<string>();
  for (const p of productionList(state)) {
    if (productionFloor(state, p) === state.currentFloor) rooms.add(`${p.roomId}:${p.factoryId}`);
  }
  return rooms.size;
}

function outputContainer(world: World, id: number): WorldContainer | undefined {
  return world.containerById.get(id);
}

function productionValidForWorld(state: GameState, world: World, p: ProductionState): boolean {
  if (productionFloor(state, p) !== state.currentFloor) return true;
  const room = world.rooms[p.roomId];
  if (!room) return false;
  const factory = FACTORIES.find(f => f.id === p.factoryId);
  if (!factory || !factory.recipes.some(r => r.id === p.recipeId)) return false;
  if (factoryForRoom(room.type, room.name)?.id !== factory.id) return false;
  if (p.outputContainerId <= 0) return true;
  const container = outputContainer(world, p.outputContainerId);
  return !!container && container.floor === state.currentFloor && container.roomId === p.roomId;
}

export function pruneProductionForWorld(state: GameState, world: World): number {
  const list = productionList(state);
  let write = 0;
  let removed = 0;
  for (let read = 0; read < list.length; read++) {
    const production = list[read];
    if (productionValidForWorld(state, world, production)) {
      list[write++] = production;
    } else {
      removed++;
    }
  }
  list.length = write;
  return removed;
}

function addTag(tags: string[], tag: string | undefined): void {
  if (tag && !tags.includes(tag)) tags.push(tag);
}

function recipeOutputTags(factory: FactoryDef, recipe: FactoryRecipeDef): string[] {
  const tags: string[] = [];
  for (const tag of [
    'production_output',
    factory.id,
    recipe.id,
    ...factory.outputTags,
    ...recipe.outputTags,
    ...productionRewardTargetTags(factory, recipe),
  ]) addTag(tags, tag);
  return tags;
}

function markProductionContainer(
  container: WorldContainer,
  factory: FactoryDef,
  recipe: FactoryRecipeDef,
  autoManaged: boolean,
): void {
  container.factoryId = factory.id;
  for (const tag of recipeOutputTags(factory, recipe)) addTag(container.tags, tag);
  if (autoManaged) addTag(container.tags, AUTO_OUTPUT_TAG);
}

function observerNearContainer(world: World, observer: Entity | undefined, container: WorldContainer): boolean {
  return observer !== undefined && world.dist2(observer.x, observer.y, container.x + 0.5, container.y + 0.5) <= 64;
}

function roomZoneId(world: World, roomId: number): number | undefined {
  const room = world.rooms[roomId];
  if (!room) return undefined;
  return world.zoneMap[world.idx(room.x + (room.w >> 1), room.y + (room.h >> 1))];
}

function canFitOutputs(
  container: WorldContainer,
  outputs: readonly ItemStackDef[],
  inputItems: readonly ItemStackDef[] = [],
  maxOutputItemCount?: number,
): boolean {
  const slots = container.inventory.map(i => ({ defId: i.defId, count: i.count, data: i.data }));
  for (const input of inputItems) {
    let left = input.count;
    for (const slot of slots) {
      if (left <= 0) break;
      if (slot.defId !== input.defId) continue;
      const take = Math.min(left, slot.count);
      slot.count -= take;
      left -= take;
    }
    if (left > 0) return false;
  }
  for (let i = slots.length - 1; i >= 0; i--) {
    if (slots[i].count <= 0) slots.splice(i, 1);
  }
  for (const out of outputs) {
    const def = ITEMS[out.defId];
    if (!def) return false;
    const stackMax = getStack(def);
    let left = Math.floor(out.count);
    if (!Number.isFinite(left) || left <= 0) continue;
    if (maxOutputItemCount !== undefined) {
      let total = left;
      for (const slot of slots) if (slot.defId === out.defId) total += Math.max(0, slot.count);
      if (total > maxOutputItemCount) return false;
    }
    for (const slot of slots) {
      if (left <= 0) break;
      if (slot.defId !== out.defId || slot.data !== undefined || slot.count >= stackMax) continue;
      const add = Math.min(left, stackMax - slot.count);
      slot.count += add;
      left -= add;
    }
    while (left > 0) {
      if (slots.length >= MAX_INVENTORY_SLOTS) return false;
      const add = Math.min(left, stackMax);
      slots.push({ defId: out.defId, count: add, data: undefined });
      left -= add;
    }
  }
  return true;
}

function hasRequiredInputItems(container: WorldContainer, recipe: FactoryRecipeDef): boolean {
  const inputs = recipe.inputItems ?? [];
  if (inputs.length === 0) return false;
  return missingItemStackIds(container, inputs).length === 0;
}

function outputAccessFor(factory: FactoryDef, recipe: FactoryRecipeDef): ContainerAccess {
  if (recipe.outputAccess) return recipe.outputAccess;
  const tags = recipeOutputTags(factory, recipe);
  if (tags.includes('public')) return 'public';
  if (tags.includes('illegal') || tags.includes('faction') || factory.ownerFaction !== undefined) return 'faction';
  return 'room';
}

function outputKindFor(factory: FactoryDef, recipe: FactoryRecipeDef): ContainerKind {
  const tags = recipeOutputTags(factory, recipe);
  if (tags.includes('medical')) return ContainerKind.MEDICAL_CABINET;
  if (tags.includes('weapon') || tags.includes('ammo') || tags.includes('locked')) return ContainerKind.WEAPON_CRATE;
  if (tags.includes('paper') || tags.includes('bureaucracy')) return ContainerKind.FILING_CABINET;
  if (tags.includes('food') && !tags.includes('tools')) return ContainerKind.FRIDGE;
  if (tags.includes('tools') || tags.includes('utility') || tags.includes('cleanup') || tags.includes('fuel')) return ContainerKind.TOOL_LOCKER;
  return ContainerKind.METAL_CABINET;
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function roomFaction(world: World, room: Room): Faction | undefined {
  return territoryOwnerToFaction(territoryRoomOwner(world, room.id)) ?? undefined;
}

function recipeSalt(recipeId: string): number {
  let n = 0;
  for (let i = 0; i < recipeId.length; i++) n = (n * 33 + recipeId.charCodeAt(i)) >>> 0;
  return n;
}

function findOutputCell(world: World, room: Room, recipeId: string): { x: number; y: number } | null {
  const salt = recipeSalt(recipeId);
  for (let a = 0; a < 32; a++) {
    const x = world.wrap(room.x + 1 + ((salt + a * 5) % Math.max(1, room.w - 2)));
    const y = world.wrap(room.y + 1 + (((salt >>> 5) + a * 7) % Math.max(1, room.h - 2)));
    const i = world.idx(x, y);
    if (world.cells[i] !== Cell.FLOOR) continue;
    if (world.roomMap[i] !== room.id) continue;
    if (world.containersAt(x, y).length > 0) continue;
    return { x, y };
  }
  return null;
}

function createOutputContainer(
  state: GameState,
  world: World,
  room: Room,
  factory: FactoryDef,
  recipe: FactoryRecipeDef,
): WorldContainer | undefined {
  if (world.containers.length >= MAX_OUTPUT_CONTAINERS) return undefined;
  const pos = findOutputCell(world, room, recipe.id);
  if (!pos) return undefined;
  const kind = outputKindFor(factory, recipe);
  const def = CONTAINER_DEFS[kind];
  const ci = world.idx(pos.x, pos.y);
  if (world.features[ci] === Feature.NONE) world.setFeatureAt(ci, Feature.SHELF);
  const access = outputAccessFor(factory, recipe);
  const container: WorldContainer = {
    id: nextContainerId(world),
    x: pos.x,
    y: pos.y,
    floor: state.currentFloor,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind,
    name: `${def.name}: ${recipe.name}`,
    inventory: [],
    capacitySlots: Math.max(def.capacitySlots, recipe.outputs.length + (recipe.inputItems?.length ?? 0) + 2),
    faction: factory.ownerFaction ?? roomFaction(world, room),
    access,
    lockDifficulty: access === 'locked' ? 2 + (room.id % 4) : undefined,
    discovered: access !== 'secret',
    factoryId: factory.id,
    tags: [...def.tags],
  };
  markProductionContainer(container, factory, recipe, true);
  world.addContainer(container);
  return container;
}

function sameFactoryOutput(container: WorldContainer, factory: FactoryDef): boolean {
  return container.factoryId === factory.id || container.tags.includes(factory.id);
}

function isOtherFactoryOutput(container: WorldContainer, factory: FactoryDef): boolean {
  return container.factoryId !== undefined && !sameFactoryOutput(container, factory);
}

function tagOverlap(container: WorldContainer, tags: readonly string[]): number {
  let score = 0;
  for (const tag of tags) if (container.tags.includes(tag)) score++;
  return score;
}

function bestContainer(
  containers: readonly WorldContainer[],
  recipe: FactoryRecipeDef,
  tags: readonly string[],
  predicate: (container: WorldContainer) => boolean,
): WorldContainer | undefined {
  let best: WorldContainer | undefined;
  let bestScore = -1;
  for (const container of containers) {
    if (!predicate(container)) continue;
    let score = tagOverlap(container, tags);
    if (canFitOutputs(container, recipe.outputs, recipe.inputItems, recipe.maxOutputItemCount)) score += 100;
    if (hasRequiredInputItems(container, recipe)) score += 40;
    if (container.tags.includes(recipe.id)) score += 30;
    if (container.tags.includes('production_output')) score += 8;
    if (score > bestScore) {
      best = container;
      bestScore = score;
    }
  }
  return best;
}

function resolveOutputContainer(
  state: GameState,
  world: World,
  room: Room,
  factory: FactoryDef,
  recipe: FactoryRecipeDef,
): WorldContainer | undefined {
  const containers = world.containers.filter(c => c.floor === state.currentFloor && c.roomId === room.id);
  const tags = recipeOutputTags(factory, recipe);
  const exact = bestContainer(containers, recipe, tags, c => sameFactoryOutput(c, factory) && c.tags.includes(recipe.id));
  if (exact) return exact;
  const authored = bestContainer(containers, recipe, tags, c =>
    !isOtherFactoryOutput(c, factory)
    && c.tags.includes('production_output')
    && !c.tags.includes(AUTO_OUTPUT_TAG)
    && tagOverlap(c, tags) > 0);
  if (authored) return authored;
  const inputContainer = bestContainer(containers, recipe, tags, c => !isOtherFactoryOutput(c, factory) && hasRequiredInputItems(c, recipe));
  if (inputContainer) return inputContainer;
  const matching = bestContainer(containers, recipe, tags, c =>
    !isOtherFactoryOutput(c, factory)
    && !c.tags.includes('production_output')
    && tagOverlap(c, recipe.outputTags) > 0
    && canFitOutputs(c, recipe.outputs, recipe.inputItems, recipe.maxOutputItemCount));
  if (matching) return matching;
  const fallback = bestContainer(containers, recipe, tags, c =>
    !isOtherFactoryOutput(c, factory)
    && !c.tags.includes('production_output')
    && canFitOutputs(c, recipe.outputs, recipe.inputItems, recipe.maxOutputItemCount));
  if (fallback) return fallback;
  return createOutputContainer(state, world, room, factory, recipe)
    ?? bestContainer(containers, recipe, tags, c => !isOtherFactoryOutput(c, factory));
}

function missingResourceIds(state: GameState, recipe: FactoryRecipeDef, floor: FloorLevel): string[] {
  const missing: string[] = [];
  for (const input of recipe.inputs) {
    if (!canSpendResources(state, [input], floor)) missing.push(input.id);
  }
  return missing;
}

function missingItemStackIds(container: WorldContainer, inputItems: readonly ItemStackDef[] = []): string[] {
  const missing: string[] = [];
  for (const input of inputItems) {
    let count = 0;
    for (const item of container.inventory) {
      if (item.defId === input.defId) count += item.count;
    }
    if (count < input.count) missing.push(input.defId);
  }
  return missing;
}

function missingInputItemIds(container: WorldContainer, recipe: FactoryRecipeDef): string[] {
  return missingItemStackIds(container, recipe.inputItems);
}

function consumeItemStacks(container: WorldContainer, inputItems: readonly ItemStackDef[] = []): void {
  for (const input of inputItems) {
    let left = input.count;
    for (let i = 0; i < container.inventory.length && left > 0; i++) {
      const item = container.inventory[i];
      if (item.defId !== input.defId) continue;
      const take = Math.min(left, item.count);
      item.count -= take;
      left -= take;
      if (item.count <= 0) {
        container.inventory.splice(i, 1);
        i--;
      }
    }
  }
}

function consumeInputItems(container: WorldContainer, recipe: FactoryRecipeDef): void {
  consumeItemStacks(container, recipe.inputItems);
}

function addOutputStacks(container: WorldContainer, outputs: readonly ItemStackDef[]): void {
  for (const out of outputs) {
    const def = ITEMS[out.defId];
    if (!def) continue;
    const stackMax = getStack(def);
    let left = Math.floor(out.count);
    if (!Number.isFinite(left) || left <= 0) continue;
    for (const item of container.inventory) {
      if (left <= 0) break;
      if (item.defId !== out.defId || item.data !== undefined || item.count >= stackMax) continue;
      const add = Math.min(left, stackMax - item.count);
      item.count += add;
      left -= add;
    }
    while (left > 0 && container.inventory.length < MAX_INVENTORY_SLOTS) {
      const add = Math.min(left, stackMax);
      container.inventory.push({ defId: out.defId, count: add });
      left -= add;
    }
  }
}

function registerFactoryRoom(
  state: GameState,
  factory: FactoryDef,
  recipe: FactoryRecipeDef,
  roomId: number,
  containerId: number,
): void {
  const list = productionList(state);
  if (list.some(p => productionFloor(state, p) === state.currentFloor && p.roomId === roomId && p.factoryId === factory.id)) return;
  if (productionRoomCountForCurrentFloor(state) >= MAX_PRODUCTION_ROOMS) return;
  if (productionCountForCurrentFloor(state) >= MAX_PRODUCTION_STATES) return;
  list.push({
    floor: state.currentFloor,
    roomId,
    factoryId: factory.id,
    recipeId: recipe.id,
    progressSec: 0,
    nextTickAt: state.time + 30 + ((roomId * 17) % 90),
    outputContainerId: containerId,
  });
}

function productionTags(base: string[], recipe: FactoryRecipeDef, extra: string[] = []): string[] {
  const tags: string[] = [];
  for (const tag of [...base, ...extra, ...(recipe.eventTags ?? [])]) {
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

function badBatchTags(base: string[], recipe: FactoryRecipeDef, badBatch: FactoryBadBatchDef, extra: string[] = []): string[] {
  return productionTags(base, recipe, [...(badBatch.eventTags ?? []), ...extra]);
}

function productionSeverity(
  world: World,
  observer: Entity | undefined,
  container: WorldContainer | undefined,
  factory: FactoryDef,
  recipe: FactoryRecipeDef,
  minSeverity: WorldEventSeverity = 2,
  urgent = false,
): WorldEventSeverity {
  let severity = minSeverity;
  if (container && observerNearContainer(world, observer, container)) severity = Math.max(severity, 3) as WorldEventSeverity;
  if (productionRecipeImportant(factory, recipe)) severity = Math.max(severity, urgent ? 4 : 3) as WorldEventSeverity;
  return Math.min(5, severity) as WorldEventSeverity;
}

function productionPrivacy(factory: FactoryDef, recipe: FactoryRecipeDef, severity: WorldEventSeverity): WorldEventPrivacy {
  return productionRecipeImportant(factory, recipe) && severity >= 4 ? 'public' : 'local';
}

function productionEventData(
  factory: FactoryDef,
  recipe: FactoryRecipeDef,
  container: WorldContainer | undefined,
  data: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    factoryId: factory.id,
    recipeId: recipe.id,
    recipeName: recipe.name,
    containerName: container?.name,
    ...data,
  };
}

function shouldMakeBadBatch(p: ProductionState, recipe: FactoryRecipeDef): FactoryBadBatchDef | undefined {
  const badBatch = recipe.badBatch;
  if (!badBatch || badBatch.everyCycles <= 0) return undefined;
  const cycle = (p.cycleCount ?? 0) + 1;
  return cycle > 0 && cycle % badBatch.everyCycles === 0 ? badBatch : undefined;
}

function firstOutput(outputs: readonly ItemStackDef[]): ItemStackDef | undefined {
  return outputs[0];
}

function stackItemIds(stacks: readonly ItemStackDef[] | undefined, limit = 4): string[] | undefined {
  if (!stacks || stacks.length === 0) return undefined;
  return stacks.slice(0, limit).map(item => item.defId);
}

function publishProductionOutput(
  state: GameState,
  world: World,
  p: ProductionState,
  factory: FactoryDef,
  recipe: FactoryRecipeDef,
  container: WorldContainer,
  outputs: readonly ItemStackDef[],
  tags: string[],
  data: Record<string, unknown>,
  observer?: Entity,
  minSeverity: WorldEventSeverity = 2,
): void {
  const first = firstOutput(outputs);
  const severity = productionSeverity(world, observer, container, factory, recipe, minSeverity, minSeverity >= 4);
  publishEvent(state, {
    type: 'room_produced_items',
    zoneId: container.zoneId,
    roomId: p.roomId,
    containerId: container.id,
    x: container.x + 0.5,
    y: container.y + 0.5,
    targetName: `${factory.name}: ${recipe.name}`,
    severity,
    privacy: productionPrivacy(factory, recipe, severity),
    itemId: first?.defId,
    itemName: first ? ITEMS[first.defId]?.name : undefined,
    itemCount: first?.count,
    tags,
    data: productionEventData(factory, recipe, container, data),
  });
}

export function ensureProductionRooms(state: GameState, world: World): number {
  ensureRoomContainers(world, state.currentFloor);
  pruneProductionForWorld(state, world);
  let added = 0;
  for (const room of world.rooms) {
    if (!room) continue;
    const factory = factoryForRoom(room.type, room.name);
    if (!factory) continue;
    const recipe = factory.recipes[0];
    if (!recipe) continue;
    const container = resolveOutputContainer(state, world, room, factory, recipe);
    if (!container) continue;
    markProductionContainer(container, factory, recipe, container.tags.includes(AUTO_OUTPUT_TAG));
    const before = productionList(state).length;
    registerFactoryRoom(state, factory, recipe, room.id, container.id);
    if (productionList(state).length > before) added++;
    if (
      added >= 48
      || productionRoomCountForCurrentFloor(state) >= MAX_PRODUCTION_ROOMS
      || productionCountForCurrentFloor(state) >= MAX_PRODUCTION_STATES
    ) break;
  }
  return added;
}

function handleMissingContainer(state: GameState, world: World, p: ProductionState, factory: FactoryDef, recipe: FactoryRecipeDef, observer?: Entity): void {
  p.blockedReason = 'no_container';
  const severity = productionSeverity(world, observer, undefined, factory, recipe, 2);
  publishEvent(state, {
    type: 'room_blocked_production',
    zoneId: roomZoneId(world, p.roomId),
    roomId: p.roomId,
    targetName: `${factory.name}: ${recipe.name}`,
    severity,
    privacy: productionPrivacy(factory, recipe, severity),
    tags: ['production', 'blocked', factory.id, 'no_container'],
    data: productionEventData(factory, recipe, undefined, { blockedReason: 'no_container' }),
  });
  p.nextTickAt = state.time + 60;
}

function handleJammedProduction(
  state: GameState,
  world: World,
  p: ProductionState,
  factory: FactoryDef,
  recipe: FactoryRecipeDef,
  container: WorldContainer,
  observer?: Entity,
): boolean {
  if (!p.jammed) return false;
  const badBatch = recipe.badBatch;
  if (!badBatch) {
    p.jammed = false;
    return false;
  }
  const repairOutputs = badBatch.repairOutputs ?? [];
  const missingRepairItems = missingItemStackIds(container, badBatch.repairItems);
  if (missingRepairItems.length === 0 && canFitOutputs(container, repairOutputs, badBatch.repairItems)) {
    consumeItemStacks(container, badBatch.repairItems);
    addOutputStacks(container, repairOutputs);
    container.factoryId = factory.id;
    container.lastProducedAt = state.time;
    container.lastProducedItemId = repairOutputs[0]?.defId;
    container.lastProducedCount = repairOutputs[0]?.count;
    container.productionBlockedReason = undefined;
    p.progressSec = 0;
    p.blockedReason = undefined;
    p.jammed = false;
    p.nextTickAt = state.time + Math.max(30, badBatch.jammedCycleSec);
    publishProductionOutput(
      state,
      world,
      p,
      factory,
      recipe,
      container,
      repairOutputs,
      badBatchTags(['production', 'output', factory.id, 'repair', 'jam_repaired'], recipe, badBatch),
      { action: 'repair_jam', repairItems: badBatch.repairItems, outputs: repairOutputs.slice(0, 4) },
      observer,
      3,
    );
    return true; // was repaired, treated as a successful production action
  }
  p.blockedReason = 'no_inputs';
  container.productionBlockedReason = 'no_inputs';
  const nearObserver = observerNearContainer(world, observer, container);
  publishEvent(state, {
    type: 'room_blocked_production',
    zoneId: container.zoneId,
    roomId: p.roomId,
    containerId: container.id,
    severity: nearObserver ? 4 : 3,
    privacy: 'local',
    tags: badBatchTags(
      nearObserver ? ['production', 'blocked', 'near_player', factory.id, 'bad_batch', 'jammed'] : ['production', 'blocked', factory.id, 'bad_batch', 'jammed'],
      recipe,
      badBatch,
    ),
    data: {
      recipeId: recipe.id,
      blockedReason: 'jammed',
      repairItems: badBatch.repairItems,
      repairOutputs,
      missingRepairItems,
    },
  });
  p.nextTickAt = state.time + Math.max(30, badBatch.jammedCycleSec);
  return false; // Still jammed
}

function handleMissingInputs(
  state: GameState,
  world: World,
  p: ProductionState,
  factory: FactoryDef,
  recipe: FactoryRecipeDef,
  container: WorldContainer,
  observer?: Entity,
): boolean {
  const missingResources = missingResourceIds(state, recipe, p.floor);
  const missingItems = missingInputItemIds(container, recipe);
  if (missingResources.length > 0 || missingItems.length > 0) {
    p.blockedReason = 'no_inputs';
    container.productionBlockedReason = 'no_inputs';
    const nearObserver = observerNearContainer(world, observer, container);
    const missingTags = [
      ...missingResources.map(id => `${id}_missing`),
      ...missingItems.map(id => `${id}_missing`),
    ];
    publishEvent(state, {
      type: 'room_lacked_resources',
      zoneId: container.zoneId,
      roomId: p.roomId,
      containerId: container.id,
      severity: nearObserver ? 3 : 2,
      privacy: 'local',
      tags: productionTags(
        nearObserver ? ['production', 'shortage', 'near_player', factory.id] : ['production', 'shortage', factory.id],
        recipe,
        missingTags,
      ),
      data: {
        recipeId: recipe.id,
        blockedReason: 'no_inputs',
        inputs: recipe.inputs,
        inputItems: recipe.inputItems,
        inputItemIds: stackItemIds(recipe.inputItems),
        missingResources,
        missingItems,
      },
    });
    p.nextTickAt = state.time + Math.max(30, recipe.cycleSec / 2);
    return true; // Inputs missing, tick delayed
  }
  return false;
}

function handleFullContainer(
  state: GameState,
  world: World,
  p: ProductionState,
  factory: FactoryDef,
  recipe: FactoryRecipeDef,
  container: WorldContainer,
  outputs: readonly ItemStackDef[],
  badBatch: FactoryBadBatchDef | undefined,
  observer?: Entity,
): boolean {
  if (!canFitOutputs(container, outputs, recipe.inputItems, badBatch ? undefined : recipe.maxOutputItemCount)) {
    p.blockedReason = 'container_full';
    container.productionBlockedReason = 'container_full';
    const nearObserver = observerNearContainer(world, observer, container);
    publishEvent(state, {
      type: 'room_blocked_production',
      zoneId: container.zoneId,
      roomId: p.roomId,
      containerId: container.id,
      severity: nearObserver ? 3 : 2,
      privacy: 'local',
      tags: productionTags(
        nearObserver ? ['production', 'blocked', 'near_player', factory.id, 'container_full'] : ['production', 'blocked', factory.id, 'container_full'],
        recipe,
        badBatch ? ['bad_batch'] : [],
      ),
      data: {
        recipeId: recipe.id,
        blockedReason: 'container_full',
        outputs: outputs.slice(0, 4),
        outputItemIds: stackItemIds(outputs),
      },
    });
    p.nextTickAt = state.time + 60;
    return true; // Container full, tick delayed
  }
  return false;
}

function processSuccessfulProduction(
  state: GameState,
  world: World,
  p: ProductionState,
  factory: FactoryDef,
  recipe: FactoryRecipeDef,
  container: WorldContainer,
  outputs: readonly ItemStackDef[],
  badBatch: FactoryBadBatchDef | undefined,
  observer?: Entity,
): void {
  spendResources(state, recipe.inputs, p.floor);
  consumeInputItems(container, recipe);
  addOutputStacks(container, outputs);
  container.factoryId = factory.id;
  container.lastProducedAt = state.time;
  container.lastProducedItemId = outputs[0]?.defId;
  container.lastProducedCount = outputs[0]?.count;
  container.productionBlockedReason = badBatch ? 'no_inputs' : undefined;
  p.progressSec = 0;
  p.cycleCount = (p.cycleCount ?? 0) + 1;
  p.blockedReason = badBatch ? 'no_inputs' : undefined;
  p.jammed = !!badBatch;
  p.nextTickAt = state.time + Math.max(30, badBatch?.jammedCycleSec ?? recipe.cycleSec);

  const nearObserver = observerNearContainer(world, observer, container);
  publishProductionOutput(
    state,
    world,
    p,
    factory,
    recipe,
    container,
    outputs,
    badBatch
      ? badBatchTags(nearObserver ? ['production', 'output', 'near_player', factory.id, 'bad_batch'] : ['production', 'output', factory.id, 'bad_batch'], recipe, badBatch)
      : productionTags(nearObserver ? ['production', 'output', 'near_player', factory.id] : ['production', 'output', factory.id], recipe),
    {
      inputItems: recipe.inputItems,
      inputItemIds: stackItemIds(recipe.inputItems),
      outputs: outputs.slice(0, 4),
      outputItemIds: stackItemIds(outputs),
      cycleCount: p.cycleCount,
    },
    observer,
    badBatch ? 4 : 2,
  );
  if (badBatch) {
    publishEvent(state, {
      type: 'room_blocked_production',
      zoneId: container.zoneId,
      roomId: p.roomId,
      containerId: container.id,
      severity: nearObserver ? 4 : 3,
      privacy: 'local',
      tags: badBatchTags(
        nearObserver ? ['production', 'blocked', 'near_player', factory.id, 'bad_batch', 'jammed'] : ['production', 'blocked', factory.id, 'bad_batch', 'jammed'],
        recipe,
        badBatch,
      ),
      data: {
        recipeId: recipe.id,
        blockedReason: 'jammed',
        repairItems: badBatch.repairItems,
        repairOutputs: badBatch.repairOutputs,
        cycleCount: p.cycleCount,
      },
    });
  }
}

export function tickProduction(state: GameState, world: World, force = false, observer?: Entity): number {
  ensureProductionRooms(state, world);
  let made = 0;
  for (const p of productionList(state)) {
    if (productionFloor(state, p) !== state.currentFloor) continue;
    if (!force && state.time < p.nextTickAt) continue;
    const factory = FACTORIES.find(f => f.id === p.factoryId);
    const recipe = factory?.recipes.find(r => r.id === p.recipeId);
    if (!factory || !recipe) continue;
    const container = outputContainer(world, p.outputContainerId);
    if (!container) {
      handleMissingContainer(state, world, p, factory, recipe, observer);
      continue;
    }
    if (p.jammed) {
      if (handleJammedProduction(state, world, p, factory, recipe, container, observer)) made++;
      continue;
    }
    if (handleMissingInputs(state, world, p, factory, recipe, container, observer)) continue;

    const badBatch = shouldMakeBadBatch(p, recipe);
    const outputs = badBatch ? badBatch.outputs : recipe.outputs;
    if (handleFullContainer(state, world, p, factory, recipe, container, outputs, badBatch, observer)) continue;

    processSuccessfulProduction(state, world, p, factory, recipe, container, outputs, badBatch, observer);
    made++;
  }
  if (force) state.msgs.push(msg(`[PROD] тик: партий ${made}`, state.time, made > 0 ? '#4f4' : '#888'));
  return made;
}

export function summarizeProduction(state: GameState, limit = 6): string[] {
  return productionList(state).filter(p => productionFloor(state, p) === state.currentFloor).slice(0, limit).map(p => {
    const blocked = p.blockedReason ? ` ${p.blockedReason}` : '';
    const jammed = p.jammed ? ' jammed' : '';
    return `room ${p.roomId}: ${p.factoryId}/${p.recipeId} next ${Math.max(0, Math.round(p.nextTickAt - state.time))}s${blocked}${jammed}`;
  });
}
