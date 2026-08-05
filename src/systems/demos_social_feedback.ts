import {
  EntityType,
  type Entity,
  type FloorLevel,
  type GameState,
  type WorldEvent,
} from '../core/types';
import type { World } from '../core/world';
import type { AlifeMigrationReason } from '../data/alife_migration';
import {
  DEMOS_EDGE_DEBT,
  DEMOS_EDGE_ENEMY,
  DEMOS_EDGE_FAMILY,
  DEMOS_EDGE_FRIEND,
  DEMOS_RELATION_FRIENDLY_THRESHOLD,
} from '../data/demos_social';
import { DEMOS_EDGE_QUEST } from '../data/demos_posts';
import {
  demosSocialVisitIntent,
  type DemosSocialVisitReason,
} from '../data/demos_social_visits';
import {
  getAlifeNpcRecordSnapshot,
  type AlifeNpcSnapshot,
  currentAlifeFloorKey,
} from './alife';
import {
  ensureAlifeMobilityState,
  startActiveAlifeDeparture,
  type AlifeJourney,
} from './alife_migration';
import {
  cleanFloorKey,
  floorKeyAllowsNpcs,
  floorKeyKnown,
} from './floor_keys';
import {
  applyDemosRelationDelta,
  getDemosNpcOnlySocialEdges,
  type DemosRelationDeltaResult,
} from './demos_social';
import { getRecentEvents, publishEvent } from './events';
import { isNativePlayerBodyEntity, isPlayerEntity } from './player_actor';

export interface DemosSocialFeedbackSummary {
  processedEvents: number;
  relationChanges: number;
  publishedEvents: number;
  lastEventId: number;
}

export interface DemosSocialFeedbackOptions {
  events?: readonly WorldEvent[];
  maxEvents?: number;
  maxOutcomes?: number;
  maxOutcomesPerEvent?: number;
  maxDeathEdges?: number;
  ignoreCursor?: boolean;
}

export interface DemosSocialJourneyOptions {
  world?: World;
  entities?: Entity[];
  activeFloorKey?: string;
  allowPlotOrReserved?: boolean;
  preferredX?: number;
  preferredY?: number;
  travelSeconds?: number;
}

interface DemosSocialFeedbackState {
  version: 1;
  lastEventId: number;
  lastJourneyTick: number;
  lastSummary?: DemosSocialFeedbackSummary;
}

type DemosSocialFeedbackHost = GameState & {
  demosSocialFeedback?: DemosSocialFeedbackState;
  floorRun?: { specs?: Record<string, { z?: number; baseFloor?: FloorLevel }> };
};

const DEFAULT_EVENT_LIMIT = 24;
const DEFAULT_OUTCOME_LIMIT = 8;
const DEFAULT_OUTCOME_PER_EVENT = 4;
const DEFAULT_DEATH_EDGE_LIMIT = 6;

function ensureFeedbackState(state: GameState): DemosSocialFeedbackState {
  const host = state as DemosSocialFeedbackHost;
  if (host.demosSocialFeedback?.version === 1) return host.demosSocialFeedback;
  host.demosSocialFeedback = {
    version: 1,
    lastEventId: 0,
    lastJourneyTick: -1,
  };
  return host.demosSocialFeedback;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function positiveId(value: unknown): number | undefined {
  const id = clampInt(value, 0, 1, 0x7fffffff);
  return id > 0 ? id : undefined;
}

function eventData(event: WorldEvent): Record<string, unknown> {
  return event.data ?? {};
}

function dataId(event: WorldEvent, key: string): number | undefined {
  return positiveId(eventData(event)[key]);
}

function actorAlifeId(event: WorldEvent): number | undefined {
  return dataId(event, 'actorAlifeId')
    ?? dataId(event, 'killerAlifeId')
    ?? dataId(event, 'helperAlifeId')
    ?? dataId(event, 'giverAlifeId');
}

function targetAlifeId(event: WorldEvent): number | undefined {
  return dataId(event, 'targetAlifeId')
    ?? dataId(event, 'victimAlifeId')
    ?? dataId(event, 'ownerAlifeId')
    ?? dataId(event, 'giverAlifeId')
    ?? dataId(event, 'reactorAlifeId');
}

function hasTag(event: WorldEvent, ...tags: string[]): boolean {
  return tags.some(tag => event.tags.includes(tag));
}

function isDeathEvent(event: WorldEvent): boolean {
  return event.type === 'npc_kill_npc' || event.type === 'player_kill_npc' || event.type === 'death_seen';
}

function isTheftOrDebtEvent(event: WorldEvent): boolean {
  return event.type === 'item_stolen' ||
    event.type === 'container_looted' ||
    event.type === 'ration_coupon_stolen' ||
    hasTag(event, 'theft', 'debt', 'witness');
}

function isHelpEvent(event: WorldEvent): boolean {
  return hasTag(event, 'help', 'rescue', 'shelter') ||
    event.type === 'gnilushka_delivered' ||
    event.type === 'shelter_tally_handled';
}

function isPositiveReactionEvent(event: WorldEvent): boolean {
  return hasTag(event, 'positive_reaction', 'thanks', 'gratitude');
}

function isThreatReactionEvent(event: WorldEvent): boolean {
  return hasTag(event, 'mock', 'threat', 'revenge');
}

function importantDelta(delta: number, relation: number, previous: number): boolean {
  if (Math.abs(delta) >= 8) return true;
  if (previous < DEMOS_RELATION_FRIENDLY_THRESHOLD && relation >= DEMOS_RELATION_FRIENDLY_THRESHOLD) return true;
  return false;
}

function publishSocialConsequence(
  state: GameState,
  event: WorldEvent,
  result: DemosRelationDeltaResult,
  reason: string,
): boolean {
  if (!result.changed || !importantDelta(result.delta, result.relation, result.previous)) return false;
  publishEvent(state, {
    type: 'rumor_observed',
    severity: Math.abs(result.delta) >= 12 ? 3 : 2,
    privacy: 'private',
    tags: ['demos_social', 'social_consequence', reason],
    data: {
      sourceEventId: event.id,
      fromAlifeId: result.fromAlifeId,
      targetAlifeId: result.targetAlifeId,
      delta: result.delta,
      relation: result.relation,
      reason,
    },
  });
  return true;
}

function applyFeedbackDelta(
  state: GameState,
  event: WorldEvent,
  fromAlifeId: number | undefined,
  toAlifeId: number | undefined,
  delta: number,
  flags: number,
  reason: string,
  budget: { remaining: number; published: number },
): number {
  if (budget.remaining <= 0 || fromAlifeId === undefined || toAlifeId === undefined || fromAlifeId === toAlifeId) return 0;
  const result = applyDemosRelationDelta(state, fromAlifeId, { targetKind: 'alife', targetAlifeId: toAlifeId }, delta, {
    flags,
    reasonTag: reason,
  });
  if (!result?.changed) return 0;
  budget.remaining--;
  if (publishSocialConsequence(state, event, result, reason)) budget.published++;
  return 1;
}

function processDeathFeedback(
  state: GameState,
  event: WorldEvent,
  budget: { remaining: number; published: number },
  maxDeathEdges: number,
): number {
  const killerAlifeId = actorAlifeId(event);
  const victimAlifeId = targetAlifeId(event);
  if (killerAlifeId === undefined || victimAlifeId === undefined) return 0;
  let changed = 0;
  let scanned = 0;
  for (const edge of getDemosNpcOnlySocialEdges(state, victimAlifeId)) {
    if (scanned >= maxDeathEdges || budget.remaining <= 0) break;
    scanned++;
    if (edge.targetAlifeId === undefined || edge.targetAlifeId === killerAlifeId) continue;
    const close = (edge.flags & (DEMOS_EDGE_FAMILY | DEMOS_EDGE_FRIEND)) !== 0 || edge.relation >= DEMOS_RELATION_FRIENDLY_THRESHOLD;
    if (!close) continue;
    const family = (edge.flags & DEMOS_EDGE_FAMILY) !== 0;
    changed += applyFeedbackDelta(
      state,
      event,
      edge.targetAlifeId,
      killerAlifeId,
      family ? -16 : -10,
      DEMOS_EDGE_ENEMY,
      family ? 'family_revenge' : 'friend_revenge',
      budget,
    );
  }
  return changed;
}

function processEventFeedback(
  state: GameState,
  event: WorldEvent,
  budget: { remaining: number; published: number },
  opts: Required<Pick<DemosSocialFeedbackOptions, 'maxOutcomesPerEvent' | 'maxDeathEdges'>>,
): number {
  if (event.tags.includes('demos_social')) return 0;
  const before = budget.remaining;
  const localBudget = {
    remaining: Math.min(budget.remaining, opts.maxOutcomesPerEvent),
    published: 0,
  };
  let changed = 0;
  const actor = actorAlifeId(event);
  const target = targetAlifeId(event);

  if (isDeathEvent(event)) changed += processDeathFeedback(state, event, localBudget, opts.maxDeathEdges);
  if (event.type === 'quest_completed' || event.type === 'contract_completed') {
    changed += applyFeedbackDelta(state, event, target, actor, 6, DEMOS_EDGE_QUEST | DEMOS_EDGE_FRIEND, 'quest_gratitude', localBudget);
  }
  if (isHelpEvent(event)) {
    changed += applyFeedbackDelta(state, event, target, actor, 5, DEMOS_EDGE_FRIEND, 'help_gratitude', localBudget);
  }
  if (isPositiveReactionEvent(event)) {
    changed += applyFeedbackDelta(state, event, actor, target, 3, DEMOS_EDGE_FRIEND, 'positive_reaction', localBudget);
  }
  if (isTheftOrDebtEvent(event)) {
    changed += applyFeedbackDelta(state, event, target, actor, -6, DEMOS_EDGE_DEBT | DEMOS_EDGE_ENEMY, 'theft_debt', localBudget);
  }
  if (isThreatReactionEvent(event)) {
    changed += applyFeedbackDelta(state, event, actor, target, -5, DEMOS_EDGE_ENEMY, 'threat_reaction', localBudget);
  }

  budget.remaining = before - changed;
  budget.published += localBudget.published;
  return changed;
}

export function processDemosSocialFeedbackEvents(
  state: GameState,
  opts: DemosSocialFeedbackOptions = {},
): DemosSocialFeedbackSummary {
  const feedback = ensureFeedbackState(state);
  const maxEvents = clampInt(opts.maxEvents, DEFAULT_EVENT_LIMIT, 1, 64);
  const budget = {
    remaining: clampInt(opts.maxOutcomes, DEFAULT_OUTCOME_LIMIT, 1, 32),
    published: 0,
  };
  const events = (opts.events ?? getRecentEvents(state, { limit: maxEvents }))
    .slice()
    .sort((a, b) => a.id - b.id);
  let processedEvents = 0;
  let relationChanges = 0;
  let lastEventId = feedback.lastEventId;
  for (const event of events) {
    if (processedEvents >= maxEvents || budget.remaining <= 0) break;
    if (!opts.ignoreCursor && event.id <= feedback.lastEventId) continue;
    processedEvents++;
    relationChanges += processEventFeedback(state, event, budget, {
      maxOutcomesPerEvent: clampInt(opts.maxOutcomesPerEvent, DEFAULT_OUTCOME_PER_EVENT, 1, 16),
      maxDeathEdges: clampInt(opts.maxDeathEdges, DEFAULT_DEATH_EDGE_LIMIT, 1, 16),
    });
    if (event.id > lastEventId) lastEventId = event.id;
  }
  feedback.lastEventId = Math.max(feedback.lastEventId, lastEventId);
  feedback.lastSummary = {
    processedEvents,
    relationChanges,
    publishedEvents: budget.published,
    lastEventId: feedback.lastEventId,
  };
  return feedback.lastSummary;
}

function proceduralSpecsContext(state: GameState): { proceduralSpecs?: Readonly<Record<string, { z?: number; baseFloor?: FloorLevel }>> } {
  const specs = (state as DemosSocialFeedbackHost).floorRun?.specs;
  return { proceduralSpecs: specs as Readonly<Record<string, { z?: number; baseFloor?: FloorLevel }>> | undefined };
}

function activeEntityForAlifeId(entities: readonly Entity[] | undefined, alifeId: number): Entity | undefined {
  return entities?.find(entity => entity.alive && entity.type === EntityType.NPC && entity.alifeId === alifeId);
}

function routeAllowsNpcDestination(state: GameState, floorKey: string): boolean {
  const context = proceduralSpecsContext(state);
  if (!floorKeyKnown(floorKey, context)) return false;
  return floorKeyAllowsNpcs(floorKey, context) !== false;
}

function ordinaryRecordAllowed(record: AlifeNpcSnapshot, allowPlotOrReserved: boolean): boolean {
  if (record.dead) return false;
  if (!allowPlotOrReserved && (record.plotNpcId || record.reservedKind || record.reservedIdentityId === 'player')) return false;
  return true;
}

function activeEntityAllowed(state: GameState, entity: Entity | undefined): boolean {
  if (!entity) return true;
  if (isPlayerEntity(entity) || isNativePlayerBodyEntity(entity) || entity.persistentNpcId === 'player') return false;
  if (entity.plotNpcId) return false;
  if (entity.questId !== undefined && entity.questId !== -1) return false;
  if (entity.canGiveQuest === true) return false;
  if (state.showNpcMenu && state.npcMenuTarget === entity.id) return false;
  return true;
}

function migrationRiskForReason(reason: AlifeMigrationReason): 1 | 2 | 3 | 4 | 5 {
  if (reason === 'refugee' || reason === 'samosbor') return 4;
  if (reason === 'faction' || reason === 'quest') return 3;
  return 2;
}

function journeyAlreadyExists(state: GameState, alifeId: number): boolean {
  const mobility = ensureAlifeMobilityState(state);
  if (mobility.activeDepartures.some(item => item.alifeId === alifeId)) return true;
  if (mobility.pendingArrivals.some(item => item.alifeId === alifeId)) return true;
  return Object.values(mobility.journeys).some(item => item.alifeId === alifeId && item.status === 'in_transit');
}

function travelSecondsFor(record: AlifeNpcSnapshot, def: ReturnType<typeof demosSocialVisitIntent>, opts: DemosSocialJourneyOptions): number {
  if (opts.travelSeconds !== undefined) return clampInt(opts.travelSeconds, def.minTravelSeconds, 1, 3600);
  const span = Math.max(0, def.maxTravelSeconds - def.minTravelSeconds);
  const jitter = span > 0 ? (record.id * 1103515245 >>> 0) % (span + 1) : 0;
  return def.minTravelSeconds + jitter;
}

function enqueueDemosJourney(
  state: GameState,
  record: AlifeNpcSnapshot,
  toFloorKey: string,
  reason: DemosSocialVisitReason,
  opts: DemosSocialJourneyOptions,
): boolean {
  const def = demosSocialVisitIntent(reason);
  const mobility = ensureAlifeMobilityState(state);
  const id = `demos_social_${mobility.nextJourneySeq++}`;
  const risk = migrationRiskForReason(def.migrationReason);
  const journey: AlifeJourney = {
    id,
    alifeId: record.id,
    fromFloorKey: record.floorKey,
    toFloorKey,
    intentId: def.intentId,
    reason: def.migrationReason,
    laneId: `${record.floorKey}->${toFloorKey}`,
    risk,
    startedAt: state.time,
    etaAt: state.time + travelSecondsFor(record, def, opts),
    status: 'in_transit',
  };
  mobility.journeys[id] = journey;
  publishEvent(state, {
    type: 'alife_migration',
    severity: 2,
    privacy: 'private',
    actorName: record.name,
    actorFaction: record.faction,
    tags: [...def.tags, 'alife_migration', 'migration'].slice(0, 8),
    data: {
      alifeId: record.id,
      fromFloorKey: record.floorKey,
      toFloorKey,
      intentId: def.intentId,
      reason: def.migrationReason,
      journeyId: id,
      source: 'demos_social',
    },
  });
  return true;
}

export function requestDemosSocialJourney(
  state: GameState,
  fromAlifeId: number,
  toFloorKeyInput: string,
  reason: DemosSocialVisitReason,
  opts: DemosSocialJourneyOptions = {},
): boolean {
  const feedback = ensureFeedbackState(state);
  if (feedback.lastJourneyTick === state.tick) return false;
  const toFloorKey = cleanFloorKey(toFloorKeyInput);
  if (!toFloorKey || !routeAllowsNpcDestination(state, toFloorKey)) return false;
  const def = demosSocialVisitIntent(reason);
  if (state.samosborActive && !def.allowDuringSamosbor) return false;
  const record = getAlifeNpcRecordSnapshot(state, fromAlifeId);
  if (!record || !ordinaryRecordAllowed(record, opts.allowPlotOrReserved === true)) return false;
  if (record.floorKey === toFloorKey) return false;
  if (journeyAlreadyExists(state, record.id)) return false;

  const activeFloorKey = cleanFloorKey(opts.activeFloorKey) || currentAlifeFloorKey(state);
  const activeEntity = activeEntityForAlifeId(opts.entities, record.id);
  if (!activeEntityAllowed(state, activeEntity)) return false;
  let ok = false;
  if (record.floorKey === activeFloorKey) {
    if (!activeEntity || !opts.world) return false;
    ok = startActiveAlifeDeparture(state, opts.world, activeEntity, toFloorKey, def.intentId, def.migrationReason);
  } else {
    ok = enqueueDemosJourney(state, record, toFloorKey, reason, opts);
  }
  if (!ok) return false;
  feedback.lastJourneyTick = state.tick;
  return true;
}
