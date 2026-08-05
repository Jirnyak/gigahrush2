import {
  type Entity,
  type GameState,
  type WorldContainer,
} from '../core/types';
import { type World } from '../core/world';
import {
  type InteractiveCraftMenuMode,
  type InteractiveCraftStationKind,
} from '../data/interactive';

export type ContentRuntimePhase = 'pre_ai' | 'post_ai' | 'floor_activity';

export interface ContentRuntimeContext {
  world: World;
  entities: Entity[];
  player: Entity;
  state: GameState;
  nextEntityId: { v: number };
  dt: number;
  phase: ContentRuntimePhase;
  gameOver: boolean;
}

export interface ContentHookResult {
  worldChanged?: boolean;
}

export interface ContentRuntimeHook {
  id: string;
  phases: readonly ContentRuntimePhase[];
  update: (ctx: ContentRuntimeContext) => void | ContentHookResult | boolean;
}

export interface ContentEntityDeathContext {
  world: World;
  entities: Entity[];
  player: Entity;
  state: GameState;
  nextEntityId: { v: number };
  killed: Entity;
  killerIsPlayer: boolean;
}

export interface ContentEntityDeathHook {
  id: string;
  onDeath: (ctx: ContentEntityDeathContext) => void | ContentHookResult | boolean;
}

export interface ContentInteractionContext {
  world: World;
  state: GameState;
  player: Entity;
  entities: Entity[];
  nextEntityId: { v: number };
  lookX: number;
  lookY: number;
  readOnly?: boolean;
  openContainerMenu?: (container: WorldContainer) => void;
  openCraftMenu?: (request: ContentCraftMenuRequest) => void;
  learnRecipe?: (request: ContentRecipeLearnRequest) => boolean;
}

export interface ContentCraftMenuRequest {
  mode: InteractiveCraftMenuMode;
  station: InteractiveCraftStationKind;
  sourceInteractiveId: number;
  sourceDefId: string;
}

export interface ContentRecipeLearnRequest {
  recipeId?: string;
  recipeSourceId?: string;
  sourceInteractiveId: number;
  sourceDefId: string;
}

export interface ContentInteractionTarget {
  id: number;
  targetId: string;
  x: number;
  y: number;
  priority: number;
  prompt: string;
}

export interface ContentInteractionResult extends ContentHookResult {
  handled: boolean;
  openedOverlay?: boolean;
  closeInterface?: boolean;
}

export interface ContentInteractionHook {
  id: string;
  target?: (ctx: ContentInteractionContext) => ContentInteractionTarget | null | undefined;
  use?: (ctx: ContentInteractionContext) => ContentInteractionResult | null | undefined;
}

const runtimeHooks: ContentRuntimeHook[] = [];
const entityDeathHooks: ContentEntityDeathHook[] = [];
const interactionHooks: ContentInteractionHook[] = [];

function upsertById<T extends { id: string }>(list: T[], item: T): void {
  const index = list.findIndex(existing => existing.id === item.id);
  if (index >= 0) list[index] = item;
  else list.push(item);
}

function resultChanged(result: void | ContentHookResult | boolean | null | undefined): boolean {
  return result === true || (typeof result === 'object' && result !== null && result.worldChanged === true);
}

export function registerContentRuntimeHook(hook: ContentRuntimeHook): void {
  upsertById(runtimeHooks, hook);
}

export function updateContentRuntimeHooks(ctx: ContentRuntimeContext): boolean {
  let worldChanged = false;
  for (const hook of runtimeHooks) {
    if (!hook.phases.includes(ctx.phase)) continue;
    worldChanged = resultChanged(hook.update(ctx)) || worldChanged;
  }
  return worldChanged;
}

export function registerContentEntityDeathHook(hook: ContentEntityDeathHook): void {
  upsertById(entityDeathHooks, hook);
}

export function runContentEntityDeathHooks(ctx: ContentEntityDeathContext): ContentHookResult {
  let worldChanged = false;
  for (const hook of entityDeathHooks) {
    worldChanged = resultChanged(hook.onDeath(ctx)) || worldChanged;
  }
  return { worldChanged };
}

export function registerContentInteractionHook(hook: ContentInteractionHook): void {
  upsertById(interactionHooks, hook);
}

export function findContentInteractionTarget(ctx: ContentInteractionContext): ContentInteractionTarget | null {
  let best: ContentInteractionTarget | null = null;
  for (const hook of interactionHooks) {
    const candidate = hook.target?.(ctx) ?? null;
    if (!candidate) continue;
    if (!best || candidate.priority > best.priority) best = candidate;
  }
  return best;
}

export function tryUseContentInteraction(ctx: ContentInteractionContext): ContentInteractionResult {
  for (const hook of interactionHooks) {
    const result = hook.use?.(ctx);
    if (result?.handled) return result;
  }
  return { handled: false };
}
