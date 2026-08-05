import {
  EntityType,
  type Entity,
  type GameState,
  type Item,
  type Msg,
  msg,
} from '../core/types';
import { ITEMS } from '../data/catalog';
import {
  MAX_STORY_DROPS_PER_FACT,
  MAX_STORY_ITEM_OUTCOMES_PER_TRIGGER,
  STORY_DROP_RULES,
  STORY_ITEM_OUTCOME_RULES,
  type StoryDropRule,
  type StoryItemOutcomeRule,
  type StoryOutcomeCondition,
  type StoryOutcomeTrigger,
} from '../data/story_outcomes';
import { Spr } from '../render/sprite_index';
import { canSpawnEntityType } from './entity_limits';
import { publishEvent } from './events';
import {
  applyStoryQuestOutcome,
  hasStoryQuest,
} from './quests';
import {
  currentFloorRunEntry,
  floorRunEntryFloorKey,
  floorRunEntryKind,
  floorRunEntryRouteId,
} from './procedural_floors';

interface StoryDeathContext {
  killed: Entity;
  killerIsPlayer: boolean;
  state: GameState;
}

interface StoryDropCandidate {
  rule: StoryDropRule;
  itemId: string;
  count: number;
  data?: unknown;
}

interface StoryItemOutcomeContext {
  trigger: StoryOutcomeTrigger;
  item: Item;
  player: Entity;
  entities: Entity[];
  state: GameState;
  msgs: Msg[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringArrayIncludes(values: unknown, value: string | undefined): boolean {
  return value !== undefined && Array.isArray(values) && values.includes(value);
}

function numericArrayIncludes<T extends number>(values: unknown, value: T | undefined): boolean {
  return value !== undefined && Array.isArray(values) && values.includes(value);
}

function entityPackageId(entity: Entity): string | undefined {
  const record = entity as Entity & { npcPackageId?: unknown; packageId?: unknown };
  const direct = typeof record.npcPackageId === 'string'
    ? record.npcPackageId
    : typeof record.packageId === 'string'
      ? record.packageId
      : undefined;
  if (direct) return direct;
  const persistent = entity.persistentNpcId ?? '';
  return persistent.startsWith('npc:') ? persistent.slice(4) : undefined;
}

function routeTags(state: GameState): string[] {
  const tags: string[] = [`floor:${state.currentFloor}`];
  try {
    const entry = currentFloorRunEntry(state);
    tags.push(`route:${floorRunEntryRouteId(entry)}`);
    tags.push(`route_key:${floorRunEntryFloorKey(entry)}`);
    tags.push(`route_kind:${floorRunEntryKind(entry)}`);
    tags.push(`z:${entry.z}`);
    tags.push(`base_floor:${entry.baseFloor}`);
    if (entry.designFloorId) tags.push(`design:${entry.designFloorId}`);
    const spec = entry.spec;
    if (spec && typeof spec === 'object') {
      if (spec.anomalyId) tags.push(`anomaly:${spec.anomalyId}`);
      if (spec.geometryId) tags.push(`geometry:${spec.geometryId}`);
    }
  } catch {
    // Unit fixtures may not have FloorRun state; base floor tags still work.
  }
  return tags;
}

function conditionMatches(condition: StoryOutcomeCondition | undefined, state: GameState, player?: Entity): boolean {
  if (!condition) return true;
  if (condition.floorLevels?.length && !condition.floorLevels.includes(state.currentFloor)) return false;
  if (condition.routeTags?.length) {
    const actual = routeTags(state);
    if (!condition.routeTags.every(tag => actual.includes(tag))) return false;
  }
  if (condition.activeQuest && !hasStoryQuest(state, condition.activeQuest, 'active')) return false;
  if (condition.completedQuest && !hasStoryQuest(state, condition.completedQuest, 'completed')) return false;
  if (condition.ownedItemId && !player?.inventory?.some(item => item.defId === condition.ownedItemId && item.count > 0)) return false;
  return true;
}

function dropRuleMatches(raw: unknown, ctx: StoryDeathContext): raw is StoryDropRule {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !isRecord(raw.source) || !Array.isArray(raw.drops)) return false;
  const source = raw.source;
  if (source.kind !== 'death') return false;
  if (source.killer === 'player' && !ctx.killerIsPlayer) return false;
  if (Array.isArray(source.entityTypes) && !source.entityTypes.includes(ctx.killed.type)) return false;
  if (Array.isArray(source.monsterKinds) && !numericArrayIncludes(source.monsterKinds, ctx.killed.monsterKind)) return false;
  if (Array.isArray(source.plotNpcIds) && !stringArrayIncludes(source.plotNpcIds, ctx.killed.plotNpcId)) return false;
  if (Array.isArray(source.actorPackageIds) && !stringArrayIncludes(source.actorPackageIds, entityPackageId(ctx.killed))) return false;
  if (Array.isArray(source.factions) && !numericArrayIncludes(source.factions, ctx.killed.faction)) return false;
  return conditionMatches(raw.condition as StoryOutcomeCondition | undefined, ctx.state);
}

export function storyDeathDropCandidates(
  ctx: StoryDeathContext,
  rules: readonly unknown[] = STORY_DROP_RULES,
): StoryDropCandidate[] {
  const out: StoryDropCandidate[] = [];
  for (const raw of rules) {
    if (out.length >= MAX_STORY_DROPS_PER_FACT) break;
    if (!dropRuleMatches(raw, ctx)) continue;
    for (const rawDrop of raw.drops) {
      if (out.length >= MAX_STORY_DROPS_PER_FACT) break;
      if (!isRecord(rawDrop) || typeof rawDrop.itemId !== 'string' || !ITEMS[rawDrop.itemId]) continue;
      const count = Math.max(1, Math.min(99, Math.floor(Number(rawDrop.count) || 1)));
      out.push({ rule: raw, itemId: rawDrop.itemId, count, data: rawDrop.data });
    }
  }
  return out;
}

export function spawnStoryDeathDrops(
  killed: Entity,
  killerIsPlayer: boolean,
  entities: Entity[],
  nextId: { v: number },
  state: GameState,
  msgs: Msg[],
  rand = Math.random,
): number {
  if (!killerIsPlayer && killed.type !== EntityType.NPC && killed.type !== EntityType.MONSTER) return 0;
  let spawned = 0;
  for (const drop of storyDeathDropCandidates({ killed, killerIsPlayer, state })) {
    if (!canSpawnEntityType(entities, EntityType.ITEM_DROP)) break;
    entities.push({
      id: nextId.v++,
      type: EntityType.ITEM_DROP,
      x: killed.x + (rand() - 0.5) * 0.3,
      y: killed.y + (rand() - 0.5) * 0.3,
      angle: 0,
      pitch: 0,
      alive: true,
      speed: 0,
      sprite: Spr.ITEM_DROP,
      inventory: [{ defId: drop.itemId, count: drop.count, data: drop.data }],
    });
    spawned++;
    if (drop.rule.message) msgs.push(msg(drop.rule.message, state.time, drop.rule.messageColor ?? '#c8f'));
  }
  return spawned;
}

function itemRuleMatches(rule: StoryItemOutcomeRule, ctx: StoryItemOutcomeContext): boolean {
  return rule.itemId === ctx.item.defId
    && rule.triggers.includes(ctx.trigger)
    && conditionMatches(rule.condition, ctx.state, ctx.player);
}

export function applyStoryItemOutcomes(
  ctx: StoryItemOutcomeContext,
  rules: readonly StoryItemOutcomeRule[] = STORY_ITEM_OUTCOME_RULES,
): number {
  let applied = 0;
  for (const rule of rules) {
    if (applied >= MAX_STORY_ITEM_OUTCOMES_PER_TRIGGER) break;
    if (!itemRuleMatches(rule, ctx)) continue;
    if (!applyStoryQuestOutcome(rule.outcome, ctx.player, ctx.entities, ctx.state, ctx.msgs, ctx.item.defId)) continue;
    applied++;
    if (rule.message) ctx.msgs.push(msg(rule.message, ctx.state.time, rule.messageColor ?? '#c8f'));
    if (ctx.trigger !== 'pickup') {
      const def = ITEMS[ctx.item.defId];
      publishEvent(ctx.state, {
        type: ctx.trigger === 'handoff' ? 'player_handoff_item' : 'player_use_item',
        actorId: ctx.player.id,
        actorName: ctx.player.name ?? 'Вы',
        actorFaction: ctx.player.faction,
        itemId: ctx.item.defId,
        itemName: def?.name ?? ctx.item.defId,
        itemCount: Math.max(1, ctx.item.count),
        itemValue: def?.value ?? 0,
        severity: rule.severity ?? 3,
        privacy: rule.privacy ?? 'local',
        tags: ['player', 'story_outcome', ctx.trigger, ...(rule.eventTags ?? [])],
        data: { ruleId: rule.id, outcome: rule.outcome.kind },
      });
    }
  }
  return applied;
}

export function applyPickedStoryItemOutcomes(
  pickedItems: readonly Item[],
  player: Entity,
  entities: Entity[],
  state: GameState,
  msgs: Msg[],
): number {
  let applied = 0;
  for (const item of pickedItems) {
    if (applied >= MAX_STORY_ITEM_OUTCOMES_PER_TRIGGER) break;
    applied += applyStoryItemOutcomes({ trigger: 'pickup', item, player, entities, state, msgs });
  }
  return applied;
}
