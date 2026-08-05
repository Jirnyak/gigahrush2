import {
  Cell,
  Feature,
  W,
  msg,
  type Faction,
  type FloorLevel,
  type GameState,
  type WorldContainer,
} from '../core/types';
import { World } from '../core/world';
import {
  getInteractiveDef,
  interactiveDefIdForSurfaceFlags,
  type InteractiveActionDef,
  type InteractiveDef,
  type InteractiveSurfaceLayer,
} from '../data/interactive';
import { makeFeatureLootContainer } from './containers';
import { calcZoneLevel } from './rpg';
import {
  registerContentInteractionHook,
  type ContentInteractionContext,
  type ContentInteractionResult,
  type ContentInteractionTarget,
} from './content_hooks';
import { logTutorialMsg, TutorialStep } from './tutorial';
import { publishEvent } from './events';

export interface InteractiveInstanceState {
  status?: string;
  charges?: number;
  cooldownUntil?: number;
  usedAt?: number;
  flags?: number;
  small?: Record<string, string | number | boolean>;
}

export interface InteractiveInstance {
  id: number;
  defId: string;
  idx: number;
  x: number;
  y: number;
  roomId: number;
  zoneId: number;
  seed: number;
  layer: InteractiveSurfaceLayer;
  state: InteractiveInstanceState;
  ownerNpcId?: number;
  faction?: Faction;
  containerId?: number;
  doorIdx?: number;
  entityId?: number;
  tags: string[];
}

export interface PlaceInteractiveDraft {
  defId: string;
  x: number;
  y: number;
  seed?: number;
  state?: InteractiveInstanceState;
  ownerNpcId?: number;
  faction?: Faction;
  containerId?: number;
  doorIdx?: number;
  entityId?: number;
  tags?: readonly string[];
  forceFeature?: boolean;
}

interface InteractiveWorldState {
  nextId: number;
  byIdx: Map<number, InteractiveInstance[]>;
  byId: Map<number, InteractiveInstance>;
}

interface ResolvedInteractive {
  instance: InteractiveInstance;
  def: InteractiveDef;
  container?: WorldContainer;
}

const states = new WeakMap<World, InteractiveWorldState>();
const autoFeatureDefs = new Map<Feature, string>([
  [Feature.SINK, 'sink_drink'],
  [Feature.TOILET, 'toilet_relief'],
]);

// Decorative features that lazily become lootable containers when nothing else
// is bound to them. Excludes structural/light/interactive features (lamp,
// candle, lift button, slide, sink, toilet, screen).
const LOOTABLE_DECOR_FEATURES: ReadonlySet<Feature> = new Set<Feature>([
  Feature.TABLE,
  Feature.CHAIR,
  Feature.BED,
  Feature.STOVE,
  Feature.SHELF,
  Feature.MACHINE,
  Feature.APPARATUS,
  Feature.DESK,
]);

// A bare decorative feature has a lootable type, sits on ordinary floor (so a
// fast-elevator MACHINE on a LIFT cell is excluded), carries no flagged or
// instanced interactive (craft station / broken fixture), is not a sink/toilet,
// and has no container yet.
function isBareLootableFeature(world: World, idx: number, feature: Feature): boolean {
  if (!LOOTABLE_DECOR_FEATURES.has(feature)) return false;
  if (world.cells[idx] !== Cell.FLOOR) return false;
  if ((world.surfaceFlags[idx] ?? 0) !== 0) return false;
  if (autoFeatureDefs.has(feature)) return false;
  if (world.containersAt(idx % W, (idx / W) | 0).length > 0) return false;
  // Any non-container interactive instance (craft station, recipe billboard,
  // broken fixture, authored device) means the feature already has an action.
  const instances = states.get(world)?.byIdx.get(idx);
  if (instances && instances.some(inst => inst.defId !== 'container_adapter')) return false;
  return true;
}

function featureLootSeed(idx: number, floor: FloorLevel): number {
  let s = (((idx + 1) * 2654435761) ^ ((floor + 1) * 40503)) >>> 0;
  s = (s ^ (s >>> 15)) >>> 0;
  return s;
}

function worldState(world: World): InteractiveWorldState {
  let state = states.get(world);
  if (!state) {
    state = { nextId: 1, byIdx: new Map(), byId: new Map() };
    states.set(world, state);
  }
  return state;
}

function instanceSeed(idx: number, defId: string): number {
  let seed = (idx + 1) * 2654435761;
  for (let i = 0; i < defId.length; i++) seed = ((seed << 5) - seed + defId.charCodeAt(i)) | 0;
  return seed >>> 0;
}

function idxRoom(world: World, idx: number): number {
  return world.roomMap[idx] ?? -1;
}

function idxZone(world: World, idx: number): number {
  return world.zoneMap[idx] ?? 0;
}

function canPlaceFeature(world: World, idx: number, feature: Feature, forceFeature: boolean): boolean {
  if (world.hermoWall[idx]) return false;
  if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) return false;
  if (world.features[idx] === feature) return true;
  if (world.aptMask[idx]) return false;
  return forceFeature || world.features[idx] === Feature.NONE;
}

function attachInstance(world: World, instance: InteractiveInstance): InteractiveInstance {
  const state = worldState(world);
  state.byId.set(instance.id, instance);
  const list = state.byIdx.get(instance.idx);
  if (list) list.push(instance);
  else state.byIdx.set(instance.idx, [instance]);
  return instance;
}

function markSurfaceFlag(world: World, idx: number, def: InteractiveDef): void {
  if (!def.surfaceFlag) return;
  const before = world.surfaceFlags[idx];
  const after = before | def.surfaceFlag;
  if (after === before) return;
  world.surfaceFlags[idx] = after;
  world.markSurfaceDirty();
}

function existingAt(world: World, idx: number, defId: string, containerId?: number): InteractiveInstance | undefined {
  return worldState(world).byIdx.get(idx)?.find(instance =>
    instance.defId === defId && (containerId === undefined || instance.containerId === containerId),
  );
}

export function placeInteractive(world: World, draft: PlaceInteractiveDraft): InteractiveInstance | null {
  const def = getInteractiveDef(draft.defId);
  if (!def) return null;
  const idx = world.idx(draft.x, draft.y);
  const existing = existingAt(world, idx, def.id, draft.containerId);
  if (existing) return existing;

  if (def.visual.kind === 'feature') {
    if (!canPlaceFeature(world, idx, def.visual.feature, draft.forceFeature === true)) return null;
    if (world.features[idx] !== def.visual.feature) world.setFeatureAt(idx, def.visual.feature);
  }
  markSurfaceFlag(world, idx, def);

  const state = worldState(world);
  return attachInstance(world, {
    id: state.nextId++,
    defId: def.id,
    idx,
    x: idx % W,
    y: (idx / W) | 0,
    roomId: idxRoom(world, idx),
    zoneId: idxZone(world, idx),
    seed: draft.seed ?? instanceSeed(idx, def.id),
    layer: def.layer,
    state: { ...(draft.state ?? {}) },
    ownerNpcId: draft.ownerNpcId,
    faction: draft.faction,
    containerId: draft.containerId,
    doorIdx: draft.doorIdx,
    entityId: draft.entityId,
    tags: [...def.tags, ...(draft.tags ?? [])],
  });
}

export function removeInteractiveAt(
  world: World,
  idx: number,
  filter?: (instance: InteractiveInstance) => boolean,
): number {
  const state = worldState(world);
  const list = state.byIdx.get(idx);
  if (!list || list.length === 0) return 0;
  const kept: InteractiveInstance[] = [];
  let removed = 0;
  for (const instance of list) {
    if (!filter || filter(instance)) {
      state.byId.delete(instance.id);
      removed++;
    } else {
      kept.push(instance);
    }
  }
  if (kept.length > 0) state.byIdx.set(idx, kept);
  else state.byIdx.delete(idx);
  return removed;
}

function ensureAutoFeatureInstance(world: World, idx: number): void {
  const flaggedDefId = interactiveDefIdForSurfaceFlags(world.surfaceFlags[idx] ?? 0);
  if (flaggedDefId && !existingAt(world, idx, flaggedDefId)) {
    const def = getInteractiveDef(flaggedDefId);
    if (!def || def.visual.kind !== 'feature' || world.features[idx] === def.visual.feature) {
      placeInteractive(world, { defId: flaggedDefId, x: idx % W, y: (idx / W) | 0 });
    }
  }

  const feature = world.features[idx] as Feature;
  const defId = autoFeatureDefs.get(feature);
  if (!defId || existingAt(world, idx, defId)) return;
  placeInteractive(world, { defId, x: idx % W, y: (idx / W) | 0 });
}

function visibleContainerAt(world: World, x: number, y: number): WorldContainer | undefined {
  return world.containersAt(x, y).find(container => container.discovered || container.access !== 'secret');
}

function ensureContainerInstance(ctx: ContentInteractionContext, idx: number): void {
  const container = visibleContainerAt(ctx.world, idx % W, (idx / W) | 0);
  if (!container || existingAt(ctx.world, idx, 'container_adapter', container.id)) return;
  placeInteractive(ctx.world, {
    defId: 'container_adapter',
    x: container.x,
    y: container.y,
    containerId: container.id,
    seed: instanceSeed(idx, `container:${container.id}`),
    tags: container.tags,
  });
}

// Lazily attach a deterministic, floor-level-scaled loot container to a bare
// decorative feature so it becomes lootable through the existing container
// adapter. The container is tagged `feature_loot` and excluded from save, so it
// regenerates deterministically each session and never spends the persistent
// container budget.
function ensureFeatureLootContainer(ctx: ContentInteractionContext, idx: number): void {
  const world = ctx.world;
  const feature = world.features[idx] as Feature;
  if (!isBareLootableFeature(world, idx, feature)) return;
  const x = idx % W;
  const y = (idx / W) | 0;
  const floor = ctx.state.currentFloor;
  const level = calcZoneLevel(x, y, floor);
  const seed = featureLootSeed(idx, floor);
  const id = world.containers.reduce((mx, c) => Math.max(mx, c.id), 0) + 1;
  const container = makeFeatureLootContainer(id, world, x, y, floor, feature, level, seed);
  if (container) world.addContainer(container);
}

function containerForInstance(world: World, instance: InteractiveInstance): WorldContainer | undefined {
  if (instance.containerId === undefined) return undefined;
  const container = world.containerById.get(instance.containerId);
  if (!container) return undefined;
  return world.idx(container.x, container.y) === instance.idx ? container : undefined;
}

function validInstance(world: World, instance: InteractiveInstance, def: InteractiveDef): boolean {
  if (def.visual.kind === 'feature') return world.features[instance.idx] === def.visual.feature;
  if (def.layer === 'container') return containerForInstance(world, instance) !== undefined;
  return true;
}

function targetInRange(ctx: ContentInteractionContext, instance: InteractiveInstance, def: InteractiveDef): boolean {
  const range = Math.max(0.5, def.target.range);
  return ctx.world.dist2(ctx.player.x, ctx.player.y, instance.x + 0.5, instance.y + 0.5) <= range * range;
}

function transientInstance(
  world: World,
  idx: number,
  def: InteractiveDef,
  container?: WorldContainer,
): InteractiveInstance {
  return {
    id: -((idx & 0x7fffff) + 1),
    defId: def.id,
    idx,
    x: idx % W,
    y: (idx / W) | 0,
    roomId: idxRoom(world, idx),
    zoneId: idxZone(world, idx),
    seed: instanceSeed(idx, def.id),
    layer: def.layer,
    state: {},
    containerId: container?.id,
    tags: [...def.tags],
  };
}

function readOnlyResolved(ctx: ContentInteractionContext, idx: number): ResolvedInteractive | null {
  const candidates: ResolvedInteractive[] = [];
  const flaggedDefId = interactiveDefIdForSurfaceFlags(ctx.world.surfaceFlags[idx] ?? 0);
  if (flaggedDefId && !existingAt(ctx.world, idx, flaggedDefId)) {
    const def = getInteractiveDef(flaggedDefId);
    if (def && (def.visual.kind !== 'feature' || ctx.world.features[idx] === def.visual.feature)) {
      candidates.push({ instance: transientInstance(ctx.world, idx, def), def });
    }
  }

  const featureDefId = autoFeatureDefs.get(ctx.world.features[idx] as Feature);
  if (featureDefId && !existingAt(ctx.world, idx, featureDefId)) {
    const def = getInteractiveDef(featureDefId);
    if (def) candidates.push({ instance: transientInstance(ctx.world, idx, def), def });
  }

  const container = visibleContainerAt(ctx.world, idx % W, (idx / W) | 0);
  if (container && !existingAt(ctx.world, idx, 'container_adapter', container.id)) {
    const def = getInteractiveDef('container_adapter');
    if (def) candidates.push({ instance: transientInstance(ctx.world, idx, def, container), def, container });
  } else if (!container && isBareLootableFeature(ctx.world, idx, ctx.world.features[idx] as Feature)) {
    // Preview a lazy feature-loot container so the aim prompt shows on bare
    // decorative features before the real container is created on use.
    const def = getInteractiveDef('container_adapter');
    if (def) {
      const x = idx % W;
      const y = (idx / W) | 0;
      const floor = ctx.state.currentFloor;
      const preview = makeFeatureLootContainer(
        -1, ctx.world, x, y, floor, ctx.world.features[idx] as Feature,
        calcZoneLevel(x, y, floor), featureLootSeed(idx, floor),
      );
      if (preview) candidates.push({ instance: transientInstance(ctx.world, idx, def, preview), def, container: preview });
    }
  }

  let best: ResolvedInteractive | null = null;
  for (const candidate of candidates) {
    if (!targetInRange(ctx, candidate.instance, candidate.def)) continue;
    if (!best || candidate.def.target.priority > best.def.target.priority) best = candidate;
  }
  return best;
}

function resolveInteractive(ctx: ContentInteractionContext): ResolvedInteractive | null {
  const x = Math.floor(ctx.lookX);
  const y = Math.floor(ctx.lookY);
  const idx = ctx.world.idx(x, y);
  if (!ctx.readOnly) {
    ensureAutoFeatureInstance(ctx.world, idx);
    ensureFeatureLootContainer(ctx, idx);
    ensureContainerInstance(ctx, idx);
  }

  const list = worldState(ctx.world).byIdx.get(idx);
  if (!list || list.length === 0) {
    return ctx.readOnly ? readOnlyResolved(ctx, idx) : null;
  }

  let best: ResolvedInteractive | null = null;
  for (const instance of list.slice()) {
    const def = getInteractiveDef(instance.defId);
    if (!def || !validInstance(ctx.world, instance, def)) {
      if (!ctx.readOnly) removeInteractiveAt(ctx.world, instance.idx, item => item.id === instance.id);
      continue;
    }
    if (!targetInRange(ctx, instance, def)) continue;
    const container = containerForInstance(ctx.world, instance);
    if (!best || def.target.priority > best.def.target.priority) best = { instance, def, container };
  }
  if (best) return best;
  return ctx.readOnly ? readOnlyResolved(ctx, idx) : null;
}

function promptForResolved(resolved: ResolvedInteractive): string {
  if (resolved.container) return ` ${resolved.container.name}`;
  return resolved.def.prompt;
}

export function findInteractiveTarget(ctx: ContentInteractionContext): ContentInteractionTarget | null {
  const resolved = resolveInteractive(ctx);
  if (!resolved) return null;
  return {
    id: resolved.instance.id + 700000,
    targetId: resolved.def.id,
    x: resolved.instance.x,
    y: resolved.instance.y,
    priority: resolved.def.target.priority,
    prompt: promptForResolved(resolved),
  };
}

function pushMsg(state: GameState, text: string, color = '#aaa'): void {
  state.msgs.push(msg(text, state.time, color));
}

function publishInteractiveEvent(
  ctx: ContentInteractionContext,
  resolved: ResolvedInteractive,
  action: InteractiveActionDef,
): void {
  publishEvent(ctx.state, {
    type: action.eventType ?? 'interactive_used',
    zoneId: resolved.instance.zoneId,
    roomId: resolved.instance.roomId >= 0 ? resolved.instance.roomId : undefined,
    x: resolved.instance.x + 0.5,
    y: resolved.instance.y + 0.5,
    actorId: ctx.player.id,
    actorName: ctx.player.name,
    actorFaction: ctx.player.faction,
    targetName: resolved.container?.name ?? resolved.def.label,
    containerId: resolved.container?.id,
    severity: action.eventSeverity ?? 0,
    privacy: 'local',
    tags: ['interactive', resolved.def.id, action.kind, ...resolved.def.tags].slice(0, 8),
    data: {
      interactiveId: resolved.instance.id,
      interactiveDefId: resolved.def.id,
      actionId: action.id,
      recipeId: action.recipeId,
      recipeSourceId: action.recipeSourceId,
      containerId: resolved.container?.id,
    },
  });
}

function applyCooldown(instance: InteractiveInstance, action: InteractiveActionDef, state: GameState): void {
  instance.state.usedAt = state.time;
  if (action.cooldownSeconds && action.cooldownSeconds > 0) {
    instance.state.cooldownUntil = state.time + action.cooldownSeconds;
  }
}

function cooldownBlocks(instance: InteractiveInstance, state: GameState): boolean {
  return instance.state.cooldownUntil !== undefined && instance.state.cooldownUntil > state.time;
}

function runDrinkWater(ctx: ContentInteractionContext, resolved: ResolvedInteractive, action: InteractiveActionDef): ContentInteractionResult {
  const needs = ctx.player.needs;
  if (!needs) {
    pushMsg(ctx.state, 'Вы пробуете воду. Организм не ведет учет.', '#888');
    return { handled: true };
  }
  const before = needs.water;
  needs.water = Math.min(100, needs.water + Math.max(0, action.waterDelta ?? 0));
  if (action.peeDelta && action.peeDelta > 0) needs.pendingPee = (needs.pendingPee ?? 0) + action.peeDelta;
  pushMsg(
    ctx.state,
    before >= 98 ? 'Вода больше не лезет.' : action.message ?? 'Вы пьете воду.',
    before >= 98 ? '#888' : action.color,
  );
  publishInteractiveEvent(ctx, resolved, action);

  if (ctx.state.tutorialMode && ctx.state.tutorialStep === TutorialStep.DRINK) {
    ctx.state.tutorialStep = TutorialStep.TOILET;
    logTutorialMsg(ctx.state, '-нужно в туалет, соседняя комната похожа на сан узел', ctx.state.time + 15);
  }

  return { handled: true };
}

function runRelieve(ctx: ContentInteractionContext, resolved: ResolvedInteractive, action: InteractiveActionDef): ContentInteractionResult {
  const needs = ctx.player.needs;
  if (!needs) {
    pushMsg(ctx.state, action.message ?? 'Вы пользуетесь туалетом.', action.color);
    publishInteractiveEvent(ctx, resolved, action);
    return { handled: true };
  }
  needs.pee = Math.max(0, needs.pee + Math.min(0, action.peeDelta ?? 0));
  needs.poo = Math.max(0, needs.poo + Math.min(0, action.pooDelta ?? 0));
  pushMsg(ctx.state, action.message ?? 'Стало легче.', action.color);
  publishInteractiveEvent(ctx, resolved, action);

  return { handled: true };
}

function runMessage(ctx: ContentInteractionContext, resolved: ResolvedInteractive, action: InteractiveActionDef): ContentInteractionResult {
  pushMsg(ctx.state, action.message ?? resolved.def.label, action.color);
  publishInteractiveEvent(ctx, resolved, action);
  return { handled: true };
}

function runOpenContainer(ctx: ContentInteractionContext, resolved: ResolvedInteractive, action: InteractiveActionDef): ContentInteractionResult {
  if (!resolved.container || !ctx.openContainerMenu) return { handled: false };
  ctx.openContainerMenu(resolved.container);
  publishInteractiveEvent(ctx, resolved, action);
  return { handled: true, openedOverlay: true };
}

function runOpenCraftMenu(ctx: ContentInteractionContext, resolved: ResolvedInteractive, action: InteractiveActionDef): ContentInteractionResult {
  if (!action.craftMode || !action.craftStation) return runMessage(ctx, resolved, action);
  if (!ctx.openCraftMenu) {
    pushMsg(ctx.state, action.kind === 'open_disassembly_menu'
      ? 'Верстак найден, но меню разборки еще не подключено.'
      : 'Станок найден, но меню крафта еще не подключено.', '#888');
    publishInteractiveEvent(ctx, resolved, action);
    return { handled: true };
  }
  ctx.openCraftMenu({
    mode: action.craftMode,
    station: action.craftStation,
    sourceInteractiveId: resolved.instance.id,
    sourceDefId: resolved.def.id,
  });
  publishInteractiveEvent(ctx, resolved, action);
  return { handled: true, openedOverlay: true };
}

function runLearnRecipe(ctx: ContentInteractionContext, resolved: ResolvedInteractive, action: InteractiveActionDef): ContentInteractionResult {
  if (!ctx.learnRecipe) {
    pushMsg(ctx.state, action.message ?? 'Вы читаете рецепт.', action.color);
    publishInteractiveEvent(ctx, resolved, action);
    return { handled: true };
  }
  const learned = ctx.learnRecipe({
    recipeId: action.recipeId,
    recipeSourceId: action.recipeSourceId,
    sourceInteractiveId: resolved.instance.id,
    sourceDefId: resolved.def.id,
  });
  pushMsg(
    ctx.state,
    learned ? (action.message ?? 'Рецепт записан.') : 'Рецепт уже известен',
    learned ? action.color : '#888',
  );
  publishInteractiveEvent(ctx, resolved, action);
  return { handled: true };
}

function runAction(ctx: ContentInteractionContext, resolved: ResolvedInteractive, action: InteractiveActionDef): ContentInteractionResult {
  if (cooldownBlocks(resolved.instance, ctx.state)) {
    pushMsg(ctx.state, 'Объект еще не готов.', '#888');
    return { handled: true };
  }

  let result: ContentInteractionResult;
  if (action.kind === 'drink_water') result = runDrinkWater(ctx, resolved, action);
  else if (action.kind === 'relieve') result = runRelieve(ctx, resolved, action);
  else if (action.kind === 'repair_pending') result = runMessage(ctx, resolved, action);
  else if (action.kind === 'open_container') result = runOpenContainer(ctx, resolved, action);
  else if (action.kind === 'open_craft_menu' || action.kind === 'open_disassembly_menu') result = runOpenCraftMenu(ctx, resolved, action);
  else if (action.kind === 'learn_recipe') result = runLearnRecipe(ctx, resolved, action);
  else result = runMessage(ctx, resolved, action);

  if (result.handled) applyCooldown(resolved.instance, action, ctx.state);
  return result;
}

export function useInteractive(ctx: ContentInteractionContext): ContentInteractionResult {
  const resolved = resolveInteractive(ctx);
  if (!resolved) return { handled: false };
  for (const action of resolved.def.actions) {
    const result = runAction(ctx, resolved, action);
    if (result.handled) return result;
  }
  return { handled: false };
}

export function interactiveAt(world: World, x: number, y: number): InteractiveInstance[] {
  const idx = world.idx(x, y);
  ensureAutoFeatureInstance(world, idx);
  const list = worldState(world).byIdx.get(idx) ?? [];
  return list.filter(instance => {
    const def = getInteractiveDef(instance.defId);
    return !!def && validInstance(world, instance, def);
  });
}

export function interactiveDebugSummary(world: World): string {
  const state = worldState(world);
  return `[INTERACTIVE] cells=${state.byIdx.size} instances=${state.byId.size} next=${state.nextId}`;
}

registerContentInteractionHook({
  id: 'interactive_surfaces',
  target: findInteractiveTarget,
  use(ctx) {
    const result = useInteractive(ctx);
    return result.handled ? result : undefined;
  },
});
