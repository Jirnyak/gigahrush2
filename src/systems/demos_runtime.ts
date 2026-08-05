import {
  type Entity,
  type GameState,
  type WorldEvent,
} from '../core/types';
import type { World } from '../core/world';
import {
  getAlifeNpcRecordSnapshot,
  sampleAlifeFloorRecordIds,
  currentAlifeFloorKey,
  type AlifeNpcSnapshot,
} from './alife';
import { registerContentRuntimeHook } from './content_hooks';
import { createEmptyDemosSocialSaveState, type DemosSocialSaveState } from './demos_save';
import { runDemosSocialDirector } from './demos_social_director';
import { getDemosNpcOnlySocialEdges, applyDemosRelationDelta } from './demos_social';
import type { DemosOutgoingSocialEdge } from './demos_posts';
import { processDemosSocialFeedbackEvents, requestDemosSocialJourney } from './demos_social_feedback';
import { refreshDemosQuestNoticesFromSnapshots } from './demos_quest_notices';
import { getRecentEvents } from './events';
import { DEMOS_EDGE_FAMILY } from '../data/demos_social';

const DEMOS_RUNTIME_TICK_SECONDS = 30;
const DEMOS_RUNTIME_RECORDS_PER_TICK = 64;
const DEMOS_RUNTIME_EVENT_LIMIT = 64;
const DEMOS_RUNTIME_OUTCOMES_PER_TICK = 4;
const DEMOS_RUNTIME_POSTS_PER_TICK = 4;
const DEMOS_RUNTIME_REACTIONS_PER_TICK = 4;

interface DemosRuntimeState {
  version: 1;
  acc: number;
  lastSummary?: {
    posts: number;
    reactions: number;
    notices: number;
    feedback: number;
    journeyRequested: boolean;
  };
}

type DemosRuntimeHost = GameState & {
  demosSocial?: DemosSocialSaveState;
  demosRuntime?: DemosRuntimeState;
};

function ensureDemosSocialState(state: GameState): DemosSocialSaveState {
  const host = state as DemosRuntimeHost;
  if (!host.demosSocial || host.demosSocial.version !== 1) host.demosSocial = createEmptyDemosSocialSaveState();
  return host.demosSocial;
}

function ensureDemosRuntimeState(state: GameState): DemosRuntimeState {
  const host = state as DemosRuntimeHost;
  if (host.demosRuntime?.version === 1) return host.demosRuntime;
  host.demosRuntime = { version: 1, acc: 0 };
  return host.demosRuntime;
}

function liveAlifeIdByEntityId(entities: readonly Entity[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const entity of entities) {
    if (entity.alive && entity.alifeId !== undefined) out.set(entity.id, entity.alifeId);
  }
  return out;
}

function sampleCurrentFloorSnapshots(state: GameState, social: DemosSocialSaveState): AlifeNpcSnapshot[] {
  const floorKey = currentAlifeFloorKey(state);
  const sampled = sampleAlifeFloorRecordIds(state, floorKey, social.cursor, DEMOS_RUNTIME_RECORDS_PER_TICK);
  social.cursor = sampled.nextCursor;
  return sampled.ids
    .map(id => getAlifeNpcRecordSnapshot(state, id))
    .filter((snapshot): snapshot is AlifeNpcSnapshot => !!snapshot);
}

function recentDemosEvents(state: GameState, cursor: number): WorldEvent[] {
  return getRecentEvents(state, {
    sinceId: cursor,
    limit: DEMOS_RUNTIME_EVENT_LIMIT,
  });
}

function requestOneSocialJourney(
  state: GameState,
  world: World,
  entities: Entity[],
  snapshots: readonly AlifeNpcSnapshot[],
): boolean {
  const activeFloorKey = currentAlifeFloorKey(state);
  for (const snapshot of snapshots) {
    for (const edge of getDemosNpcOnlySocialEdges(state, snapshot.id)) {
      const targetId = edge.targetAlifeId;
      if (targetId === undefined) continue;
      const target = getAlifeNpcRecordSnapshot(state, targetId);
      if (!target || target.dead || target.floorKey === snapshot.floorKey) continue;
      const reason = (edge.flags & DEMOS_EDGE_FAMILY) !== 0
        ? 'family_visit'
        : edge.relation < -64
          ? 'conflict_visit'
          : 'social_visit';
      if (requestDemosSocialJourney(state, snapshot.id, target.floorKey, reason, {
        world,
        entities,
        activeFloorKey,
      })) return true;
    }
  }
  return false;
}

function outgoingSocialEdgesForAlifeId(state: GameState, alifeId: number): readonly DemosOutgoingSocialEdge[] {
  return getDemosNpcOnlySocialEdges(state, alifeId)
    .filter((edge): edge is typeof edge & { targetAlifeId: number } => edge.targetAlifeId !== undefined)
    .map(edge => ({
      targetAlifeId: edge.targetAlifeId,
      relation: edge.relation,
      flags: edge.flags,
    }));
}

registerContentRuntimeHook({
  id: 'demos_social_runtime',
  phases: ['floor_activity'],
  update: ({ state, entities, world, dt, gameOver }) => {
    if (gameOver) return;
    const runtime = ensureDemosRuntimeState(state);
    runtime.acc += Math.max(0, dt);
    if (runtime.acc < DEMOS_RUNTIME_TICK_SECONDS) return;
    runtime.acc %= DEMOS_RUNTIME_TICK_SECONDS;

    const social = ensureDemosSocialState(state);
    const liveMap = liveAlifeIdByEntityId(entities);
    const snapshots = sampleCurrentFloorSnapshots(state, social);
    const events = recentDemosEvents(state, social.eventCursor);
    const byId = new Map(snapshots.map(snapshot => [snapshot.id, snapshot]));
    const director = runDemosSocialDirector(social, events, {
      now: state.time,
      seedSalt: state.tick,
      maxEvents: DEMOS_RUNTIME_EVENT_LIMIT,
      maxPosts: DEMOS_RUNTIME_POSTS_PER_TICK,
      maxReactions: DEMOS_RUNTIME_REACTIONS_PER_TICK,
      fallbackAuthorAlifeIds: snapshots.map(snapshot => snapshot.id),
      alifeIdForEntityId: entityId => liveMap.get(entityId),
      snapshotForAlifeId: alifeId => {
        const snapshot = byId.get(alifeId) ?? getAlifeNpcRecordSnapshot(state, alifeId);
        return snapshot ? {
          alifeId: snapshot.id,
          name: snapshot.name,
          faction: snapshot.faction,
          floorKey: snapshot.floorKey,
          dead: snapshot.dead,
        } : undefined;
      },
      outgoingEdgesForAlifeId: alifeId => outgoingSocialEdgesForAlifeId(state, alifeId),
      relationForPair: (fromAlifeId, targetAlifeId) =>
        getDemosNpcOnlySocialEdges(state, fromAlifeId).find(edge => edge.targetAlifeId === targetAlifeId)?.relation,
      applyRelationDelta: (targetState, fromAlifeId, target, delta, meta) => {
        applyDemosRelationDelta(targetState, fromAlifeId, target, delta, {
          reasonTag: meta.reasonTag,
        });
      },
      gameState: state,
    });
    const notices = refreshDemosQuestNoticesFromSnapshots(state, snapshots, {
      floorKey: currentAlifeFloorKey(state),
      seed: state.tick,
      nowMinutes: state.clock.totalMinutes,
    });
    const feedback = processDemosSocialFeedbackEvents(state, {
      events,
      maxEvents: DEMOS_RUNTIME_EVENT_LIMIT,
      maxOutcomes: DEMOS_RUNTIME_OUTCOMES_PER_TICK,
      maxOutcomesPerEvent: DEMOS_RUNTIME_OUTCOMES_PER_TICK,
    });
    const journeyRequested = requestOneSocialJourney(state, world, entities, snapshots);
    runtime.lastSummary = {
      posts: director.postsCreated + director.repliesCreated,
      reactions: director.reactionsCreated,
      notices: notices.length,
      feedback: feedback.relationChanges,
      journeyRequested,
    };
  },
});
