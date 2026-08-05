/* ── Procedural quest system ──────────────────────────────────── */

import {
  type Entity, type Quest, type GameState, type Msg, type Room,
  QuestType, EntityType, Occupation, MonsterKind, Faction,
  RoomType, Cell, AIGoal, W, ZoneFaction, FloorLevel,
  msg,
} from '../core/types';
import { World } from '../core/world';
import { secureRandom } from '../core/rand';
import { ITEMS } from '../data/catalog';
import { isSilverSlimeItem, SILVER_SLIME_SEALED_ID } from '../data/items';
import { craftRecipeSourcesForQuest, getCraftRecipeSource } from '../data/craft_recipe_sources';
import {
  occupationHasProfileTag,
  occupationQuestFetchItems,
  occupationQuestRewardItems,
  occupationPreferredVisitRooms,
} from '../data/occupation_profiles';

import { buildContextSnapshot } from './context';
import { addFactionRelMutual, getFactionRel } from '../data/relations';
import { ENTITY_MASK_MONSTER, getEntityIndex } from './entity_index';
import {
  PLOT_CHAIN,
  SIDE_QUESTS,
  hasAvailableQuest,
  isPlotNpc,
  sideQuestPrereqsMet,
  type KillPressureDef,
  type PlotStep,
} from '../data/plot';
import type { StoryQuestOutcomeDef, StoryQuestSelector } from '../data/story_outcomes';
import {
  CONTRACTS,
  GOVNYAK_COURIER_PACKAGE_ITEM,
  type ContractDef,
  type QuestRouteTarget,
  contractToQuest,
  questTargetEventData,
} from '../data/contracts';
import { addItem, removeItem } from './inventory';
import {
  applyContractRewardAtAcceptance,
  canCompleteGovnyakCourierEndpoint,
  govnyakCourierOutcomeEventData,
  handleContractQuestItemOutcome,
  isQuestTargetOnCurrentFloor,
  isContractHiddenForAssignment,
  isGovnyakCourierContractId,
  prepareAcceptedContract,
  resolveQuestTargetRoom,
  resolveGovnyakCourierOutcome,
} from './contracts';
import {
  awardXP, randomRPG, scaleMonsterHp, scaleMonsterSpeed,
  intContractRewardMult, intDocumentRewardMult,
} from './rpg';
import { currentFloorRunEntry, floorRunEntryDanger } from './procedural_floors';
import { calculateQuestReward, scaleAuthoredQuestRewards, type QuestRewardObjectiveKind } from './quest_rewards';
import { MONSTERS } from '../entities/monster';
import { publishEvent } from './events';
import { entitySpawnSlots } from './entity_limits';
import { renderProceduralQuestSpeech, type ProceduralQuestSpeechPhase } from './markov_procedural_quests';
import { routeAdapterSpeech } from './markov_router_adapters';
import {
  assignProceduralQuestDeadline,
  deadlineMessageSuffix,
  ensureQuestDeadline,
  questDeadlineEventData,
  questDeadlineExpired,
  type QuestDeadlineContext,
} from './quest_deadlines';
import {
  addNpcPlayerRelation,
  completedQuestFactionRelationDelta,
  completedQuestGiverRelationDelta,
  getNpcPlayerRelation,
} from './npc_relations';
import {
  activeDemosQuestNoticeForGiver,
  markDemosNoticeFailed,
  recordDemosNoticeQuestCreatedForGiver,
} from './demos_quest_notices';
import { applyDemosRelationDelta } from './demos_social';
import { pushNpcLogMessage } from './ai/barks';
import { hearingRadiusMetersForActor } from './hearing';
import { getAlifeNpcTotalMoney, isPlotNpcDeadKnown } from './alife';
import { revealQuestTargetOnMap } from './map_exploration';
import {
  resolveNpcPackageForEntity,
  selectNpcLockedQuestResponse,
} from './npc_package_speech';
import { getNpcPackageByPlotNpcId, npcPackageDisplayName } from '../data/npc_packages';
import {
  craftRecipeExists,
  craftRecipeLearnedMessage,
  hasCraftRecipe,
  learnCraftRecipe,
  learnCraftRecipesFromSource,
} from './crafting';
import { territoryOwnerAtIndex } from './territory';

type EntityIndex = {
  byId: Map<number, Entity>;
  byPlotLive: Map<string, Entity>;
  byPlotAll: Map<string, Entity>;
  byMonLive: Map<MonsterKind, Entity>;
};

let _currentIndex: EntityIndex | undefined = undefined;

function buildEntityIndex(entities: readonly Entity[]): EntityIndex {
  const index = {
    byId: new Map<number, Entity>(),
    byPlotLive: new Map<string, Entity>(),
    byPlotAll: new Map<string, Entity>(),
    byMonLive: new Map<MonsterKind, Entity>()
  };
  for (const e of entities) {
    index.byId.set(e.id, e);
    if (e.type === EntityType.NPC && e.plotNpcId) {
      if (!index.byPlotAll.has(e.plotNpcId)) index.byPlotAll.set(e.plotNpcId, e);
      if (e.alive && !index.byPlotLive.has(e.plotNpcId)) index.byPlotLive.set(e.plotNpcId, e);
    }
    if (e.type === EntityType.MONSTER && e.alive && e.monsterKind !== undefined && !index.byMonLive.has(e.monsterKind)) {
      index.byMonLive.set(e.monsterKind, e);
    }
  }
  return index;
}

function findById(entities: readonly Entity[], id: number) {
  if (_currentIndex) return _currentIndex.byId.get(id);
  return entities.find(e => e.id === id);
}
function findByPlotLive(entities: readonly Entity[], plotId: string) {
  if (_currentIndex) return _currentIndex.byPlotLive.get(plotId);
  return entities.find(e => e.type === EntityType.NPC && e.plotNpcId === plotId && e.alive);
}
function findByPlotAll(entities: readonly Entity[], plotId: string) {
  if (_currentIndex) return _currentIndex.byPlotAll.get(plotId);
  return entities.find(e => e.type === EntityType.NPC && e.plotNpcId === plotId);
}
function findMonLive(entities: readonly Entity[], kind: MonsterKind) {
  if (_currentIndex) return _currentIndex.byMonLive.get(kind);
  return entities.find(e => e.type === EntityType.MONSTER && e.monsterKind === kind && e.alive);
}


const PROCEDURAL_QUEST_GIVER_CHANCE = 0.10;

export interface CurrentObjective {
  line: string;
  detail?: string;
  source: 'plot_offer' | 'quest';
  questId?: number;
  plotStepIndex?: number;
  targetEntityId?: number;
  targetPlotNpcId?: string;
  color: string;
}

export type NpcQuestMarkerTone = 'authored' | 'procedural';

export interface NpcQuestMarkerState {
  tone: NpcQuestMarkerTone;
  active: boolean;
  showExclamation: boolean;
}

interface AuthoredQuestMeta {
  targetFloor?: FloorLevel;
  targetRoute?: QuestRouteTarget;
  targetRoomType?: number;
  targetRoomName?: string;
  targetZoneTag?: string;
  targetHint?: string;
  eventTags?: string[];
  eventData?: Record<string, unknown>;
  eventPrivacy?: Quest['eventPrivacy'];
  eventSeverity?: Quest['eventSeverity'];
  eventTargetName?: string;
  failOnNpcDeathPlotId?: string;
  abandonsSideQuestIds?: string[];
  timeLimitMinutes?: number;
  holdSeconds?: number;
  holdResetOnExit?: boolean;
  holdSpawnMonsters?: number;
  holdSpawnIntervalSeconds?: number;
  holdSpawnMaxAlive?: number;
}

function authoredQuestMeta(step: AuthoredQuestMeta, state: GameState): Partial<Quest> {
  const meta: Partial<Quest> = {};
  if (step.targetFloor !== undefined) meta.targetFloor = step.targetFloor;
  if (step.targetRoute) meta.targetRoute = { ...step.targetRoute };
  if (step.targetRoomType !== undefined) meta.targetRoomType = step.targetRoomType as RoomType;
  if (step.targetRoomName) meta.targetRoomName = step.targetRoomName;
  if (step.targetZoneTag) meta.targetZoneTag = step.targetZoneTag;
  if (step.targetHint) meta.targetHint = step.targetHint;
  if (step.eventTags?.length) meta.eventTags = [...step.eventTags];
  if (step.eventData) meta.eventData = { ...step.eventData };
  if (step.eventPrivacy) meta.eventPrivacy = step.eventPrivacy;
  if (step.eventSeverity !== undefined) meta.eventSeverity = step.eventSeverity;
  if (step.eventTargetName) meta.eventTargetName = step.eventTargetName;
  if (step.failOnNpcDeathPlotId) meta.failOnNpcDeathPlotId = step.failOnNpcDeathPlotId;
  if (step.abandonsSideQuestIds?.length) meta.abandonsSideQuestIds = [...step.abandonsSideQuestIds];
  if (step.timeLimitMinutes !== undefined) {
    meta.timeLimitMinutes = step.timeLimitMinutes;
    meta.expiresAtMinutes = Math.ceil(state.clock.totalMinutes + step.timeLimitMinutes);
  }
  if (step.holdSeconds !== undefined) {
    meta.holdSeconds = Math.max(1, Math.round(step.holdSeconds));
    meta.holdProgressSeconds = 0;
    meta.holdLastTime = state.time;
  }
  if (step.holdResetOnExit !== undefined) meta.holdResetOnExit = step.holdResetOnExit;
  if (step.holdSpawnMonsters !== undefined) meta.holdSpawnMonsters = Math.max(0, Math.round(step.holdSpawnMonsters));
  if (step.holdSpawnIntervalSeconds !== undefined) meta.holdSpawnIntervalSeconds = Math.max(1, step.holdSpawnIntervalSeconds);
  if (step.holdSpawnMaxAlive !== undefined) meta.holdSpawnMaxAlive = Math.max(1, Math.round(step.holdSpawnMaxAlive));
  return meta;
}

function questTags(q: Quest, phase: string, contractDef?: ContractDef): string[] {
  return q.contractId
    ? ['quest', 'contract', phase, ...(contractDef?.tags ?? []), ...(q.eventTags ?? [])]
    : ['quest', phase, ...(q.eventTags ?? [])];
}

function questSpawnMonstersOnAccept(q: Quest): number {
  if (q.plotStepIndex !== undefined) return PLOT_CHAIN[q.plotStepIndex]?.spawnMonstersOnAccept ?? 0;
  if (q.sideQuestId) return SIDE_QUESTS.find(sq => sq.id === q.sideQuestId)?.spawnMonstersOnAccept ?? 0;
  return 0;
}

function proceduralQuestSpeechLine(
  q: Quest,
  phase: ProceduralQuestSpeechPhase,
  state: GameState,
  npc?: Entity,
  fallback = q.desc,
  contractDef = q.contractId ? CONTRACTS.find(c => c.id === q.contractId) : undefined,
): string {
  if (q.plotStepIndex !== undefined || q.sideQuestId !== undefined) return fallback;
  return renderProceduralQuestSpeech({
    quest: q,
    contractDef,
    phase,
    exactFallback: fallback,
    seed: q.contractId ?? q.id,
    repeatIndex: phase === 'offer' ? 0 : Math.floor(state.clock.totalMinutes),
    nowMinutes: state.clock.totalMinutes,
    routeSpeech: routeAdapterSpeech,
    snapshot: npc ? buildContextSnapshot(npc, { time: state.clock.totalMinutes, state }) : undefined,
  }).text;
}

function visitNeedsConcreteTarget(q: Quest): boolean {
  return q.targetRoom !== undefined || q.targetRoomType !== undefined || q.targetRoomName !== undefined || q.targetZoneTag !== undefined;
}

function checkVisitQuestAtPlayer(q: Quest, player: Entity, world: World, state: GameState): boolean {
  if (visitNeedsConcreteTarget(q)) {
    if (!isQuestTargetOnCurrentFloor(q, state)) return false;
    const resolved = resolveQuestTargetRoom(world, q, player);
    if (resolved) q.targetRoom = resolved.room.id;
    const room = world.roomAt(player.x, player.y);
    return !!room && resolved !== undefined && room.id === resolved.room.id;
  }

  if (q.visitFloor !== undefined) return isQuestTargetOnCurrentFloor(q, state);
  if (q.targetRoom !== undefined) {
    const room = world.roomAt(player.x, player.y);
    return !!room && room.id === q.targetRoom;
  }
  return false;
}

/* ── Assign a contextual slice of living NPCs as quest givers ─── */
export function reassignQuestGivers(entities: Entity[]): void {
  for (const e of entities) {
    if (e.type !== EntityType.NPC || !e.alive) continue;
    if (isPlotNpc(e)) continue;
    if (e.persistentNpcId) continue;
    e.canGiveQuest = secureRandom() < proceduralQuestGiverChance();
  }
}

function proceduralQuestGiverChance(): number {
  return PROCEDURAL_QUEST_GIVER_CHANCE;
}

function plotStepPreviousStepsDone(index: number, quests: readonly Quest[]): boolean {
  for (let i = 0; i < index; i++) {
    if (!quests.some(q => q.plotStepIndex === i && q.done)) return false;
  }
  return true;
}

export function nextAvailablePlotStep(quests: readonly Quest[]): { index: number; step: PlotStep } | undefined {
  for (let i = 0; i < PLOT_CHAIN.length; i++) {
    const step = PLOT_CHAIN[i];
    if (quests.some(q => q.plotStepIndex === i)) continue;
    if (!plotStepPreviousStepsDone(i, quests)) continue;
    return { index: i, step };
  }
  return undefined;
}

export function nextAvailablePlotStepForNpc(npc: Entity, state: Pick<GameState, 'quests'>): { index: number; step: PlotStep } | undefined {
  if (!npc.plotNpcId) return undefined;
  const available = nextAvailablePlotStep(state.quests);
  return available?.step.giverNpcId === npc.plotNpcId ? available : undefined;
}

export function activeTalkQuestForNpc(npc: Entity, state: Pick<GameState, 'quests'>): Quest | undefined {
  return state.quests.find(q => activeTalkQuestMatchesNpc(q, npc));
}

function activeTalkQuestMatchesNpc(q: Quest, npc: Entity): boolean {
  return (
    !q.done &&
    !q.failed &&
    q.type === QuestType.TALK &&
    (q.targetNpcId === npc.id || (npc.plotNpcId !== undefined && q.targetPlotNpcId === npc.plotNpcId))
  );
}

function activeTalkQuestForNpcByTone(
  npc: Entity,
  state: Pick<GameState, 'quests'>,
  tone: NpcQuestMarkerTone,
): Quest | undefined {
  return state.quests.find(q => activeTalkQuestMatchesNpc(q, npc) && questMarkerTone(q) === tone);
}

function questMarkerTone(q: Quest): NpcQuestMarkerTone {
  return q.plotStepIndex !== undefined || q.sideQuestId !== undefined ? 'authored' : 'procedural';
}

function npcHasAcceptedProceduralQuest(npc: Entity, state: Pick<GameState, 'quests'>): boolean {
  return state.quests.some(q => q.giverId === npc.id && questMarkerTone(q) === 'procedural');
}

function npcCanShowProceduralQuestOffer(npc: Entity, state: Pick<GameState, 'quests'>): boolean {
  return npc.type === EntityType.NPC &&
    npc.alive &&
    npc.canGiveQuest === true &&
    npc.plotNpcId === undefined &&
    !npcHasAcceptedProceduralQuest(npc, state);
}

function activeQuestFromNpc(npc: Entity, state: Pick<GameState, 'quests'>): Quest | undefined {
  return state.quests.find(q => !q.done && !q.failed && q.giverId === npc.id);
}

type ActiveQuestState = Pick<GameState, 'quests' | 'activeQuestId'>;

export function isQuestSelectableAsActive(q: Quest): boolean {
  return !q.done && !q.failed;
}

export function getActiveQuest(state: ActiveQuestState): Quest | undefined {
  if (state.activeQuestId === undefined) return undefined;
  return state.quests.find(q => q.id === state.activeQuestId && isQuestSelectableAsActive(q));
}

export function toggleActiveQuest(state: ActiveQuestState, questId: number): Quest | undefined {
  if (state.activeQuestId === questId) {
    state.activeQuestId = undefined;
    return undefined;
  }
  const quest = state.quests.find(q => q.id === questId && isQuestSelectableAsActive(q));
  if (!quest) return getActiveQuest(state);
  state.activeQuestId = quest.id;
  return quest;
}

export function resetNonStoryQuestsForNewPlayer(state: ActiveQuestState, entities: Entity[] = []): number {
  const removedQuestIds = new Set<number>();
  const removedGiverIds = new Set<number>();
  const kept: Quest[] = [];
  for (const quest of state.quests) {
    if (quest.plotStepIndex !== undefined) {
      kept.push(quest);
      continue;
    }
    removedQuestIds.add(quest.id);
    removedGiverIds.add(quest.giverId);
  }
  if (removedQuestIds.size === 0) return 0;
  state.quests = kept;
  if (state.activeQuestId !== undefined && removedQuestIds.has(state.activeQuestId)) {
    state.activeQuestId = undefined;
  }
  for (const entity of entities) {
    if (entity.type !== EntityType.NPC || !removedGiverIds.has(entity.id)) continue;
    if (removedQuestIds.has(entity.questId ?? -1)) entity.questId = -1;
    if (!entity.plotNpcId) entity.canGiveQuest = true;
  }
  return removedQuestIds.size;
}

export function npcHasImportantQuestAction(npc: Entity, state: Pick<GameState, 'quests'>): boolean {
  if (npc.type !== EntityType.NPC || !npc.alive) return false;
  return activeTalkQuestForNpc(npc, state) !== undefined || nextAvailablePlotStepForNpc(npc, state) !== undefined;
}

export function npcCanGiveQuestNow(npc: Entity, state: Pick<GameState, 'quests'>): boolean {
  if (npc.type !== EntityType.NPC || !npc.alive) return false;
  if (npc.canGiveQuest !== true) return false;
  if (npc.plotNpcId) return hasAvailableQuest(npc.plotNpcId, state.quests);
  return !state.quests.some(q => !q.done && q.giverId === npc.id);
}

export function npcHasQuestMarker(npc: Entity, state: Pick<GameState, 'quests'>): boolean {
  const marker = npcQuestMarkerState(npc, state);
  return marker !== null && marker.active;
}

export function npcQuestMarkerState(npc: Entity, state: Pick<GameState, 'quests'>): NpcQuestMarkerState | null {
  if (npc.type !== EntityType.NPC || !npc.alive) return null;

  if (activeTalkQuestForNpcByTone(npc, state, 'authored')) {
    return { tone: 'authored', active: true, showExclamation: true };
  }
  if (npc.plotNpcId && npcCanGiveQuestNow(npc, state)) {
    return { tone: 'authored', active: true, showExclamation: true };
  }
  if (npcCanShowProceduralQuestOffer(npc, state)) {
    return { tone: 'procedural', active: true, showExclamation: true };
  }
  if (activeTalkQuestForNpcByTone(npc, state, 'procedural')) {
    return { tone: 'procedural', active: true, showExclamation: false };
  }
  if (npc.plotNpcId) return { tone: 'authored', active: false, showExclamation: false };
  return null;
}

function withObjectivePrefix(text: string): string {
  return text.startsWith('Цель:') ? text : `Цель: ${text}`;
}

function withoutObjectivePrefix(text: string): string {
  return text.replace(/^Цель:\s*/, '');
}

function questObjectiveLine(q: Quest): string {
  const step = q.plotStepIndex !== undefined ? PLOT_CHAIN[q.plotStepIndex] : undefined;
  if (step?.activeObjective) return step.activeObjective;
  if (q.type === QuestType.TALK && q.targetNpcName) return `Цель: поговорить с ${q.targetNpcName}.`;
  return withObjectivePrefix(q.desc);
}

function objectiveTargetEntity(q: Quest, entities: readonly Entity[]): Entity | undefined {
  if (q.targetNpcId !== undefined) {
    const byLiveId = findById(entities, q.targetNpcId);
    if (byLiveId && byLiveId.alive) return byLiveId;
  }
  if (q.targetPlotNpcId) return findByPlotLive(entities, q.targetPlotNpcId);
  return undefined;
}

function activeObjectiveQuest(state: Pick<GameState, 'quests' | 'activeQuestId'>): Quest | undefined {
  const selected = getActiveQuest(state);
  if (selected) return selected;
  const active = state.quests.filter(q => !q.done && !q.failed);
  return active.find(q => q.plotStepIndex !== undefined) ?? active[0];
}

export function getCurrentObjective(state: Pick<GameState, 'quests' | 'activeQuestId'>, entities: readonly Entity[] = []): CurrentObjective | null {
  const q = activeObjectiveQuest(state);
  if (q) {
    const step = q.plotStepIndex !== undefined ? PLOT_CHAIN[q.plotStepIndex] : undefined;
    const target = objectiveTargetEntity(q, entities);
    return {
      line: questObjectiveLine(q),
      detail: step?.activeObjective ? q.desc : undefined,
      source: 'quest',
      questId: q.id,
      plotStepIndex: q.plotStepIndex,
      targetEntityId: target?.id,
      targetPlotNpcId: q.targetPlotNpcId,
      color: q.plotStepIndex !== undefined ? '#6cf' : q.sideQuestId ? '#f7a7d8' : '#ffd35f',
    };
  }

  const available = nextAvailablePlotStep(state.quests);
  if (!available) return null;
  const giverName = plotNpcDisplayName(available.step.giverNpcId) ?? available.step.giverNpcId;
  const target = findByPlotLive(entities, available.step.giverNpcId);
  return {
    line: available.step.offerObjective ?? `Цель: поговорить с ${giverName}.`,
    detail: available.step.offerObjective ? undefined : available.step.desc,
    source: 'plot_offer',
    plotStepIndex: available.index,
    targetEntityId: target?.id,
    targetPlotNpcId: available.step.giverNpcId,
    color: '#9df',
  };
}

export function npcQuestActionHint(npc: Entity, state: Pick<GameState, 'quests'>): string | undefined {
  const completing = activeTalkQuestForNpc(npc, state);
  if (completing) return `Задание: ${withoutObjectivePrefix(questObjectiveLine(completing))}`;

  const available = nextAvailablePlotStepForNpc(npc, state);
  if (available) return `Задание: ${available.step.desc}`;

  const active = activeQuestFromNpc(npc, state);
  if (active) return `Задание в журнале: ${withoutObjectivePrefix(questObjectiveLine(active))}`;

  return undefined;
}

function pushNpcQuestMessage(
  npc: Entity,
  player: Entity,
  world: World,
  state: GameState,
  msgs: Msg[],
  text: string,
  color: string,
): boolean {
  return pushNpcLogMessage(npc, msgs, state.time, text, color, {
    listener: player,
    radiusMeters: hearingRadiusMetersForActor(player, state.npcLogRadiusMeters),
    dist2: (x1, y1, x2, y2) => world.dist2(x1, y1, x2, y2),
  });
}

/* ── Generate a quest from an NPC (called on interact) ────────── */
export function offerQuest(
  npc: Entity, player: Entity, world: World, entities: Entity[],
  state: GameState, msgs: Msg[], nextEntityId?: { v: number },
): void {
  if (!npc.alive || npc.type !== EntityType.NPC) return;
  if (!npc.canGiveQuest) {
    pushNpcQuestMessage(npc, player, world, state, msgs, `${npc.name}: «Мне нечего тебе поручить.»`, '#888');
    return;
  }
  // Don't give quest if already has one active from this NPC
  if (state.quests.some(q => q.giverId === npc.id && !q.done)) {
    pushNpcQuestMessage(npc, player, world, state, msgs, `${npc.name}: «Ещё не выполнил прошлое задание?»`, '#aaa');
    return;
  }
  // Plot NPCs always give quests — they are not in the relation matrix
  if (!isPlotNpc(npc)) {
    const npcFaction = npc.faction ?? Faction.CITIZEN;
    const rel = getFactionRel(Faction.PLAYER, npcFaction);
    const personalRel = getNpcPlayerRelation(npc);
    if (rel < -10 || personalRel < -10) {
      pushNpcQuestMessage(npc, player, world, state, msgs, `${npc.name} не хочет с вами разговаривать.`, '#a44');
      return;
    }
  }

  const quest = generateQuest(npc, player, world, entities, state);
  if (!quest) {
    if (!isPlotNpc(npc)) npc.canGiveQuest = false;
    pushNpcQuestMessage(npc, player, world, state, msgs, `${npc.name}: «Пока ничего не нужно.»`, '#888');
    return;
  }

  scaleAuthoredQuestRewards(quest);
  state.quests.push(quest);
  npc.questId = quest.id;
  if (!isPlotNpc(npc)) npc.canGiveQuest = false;
  const contractId = quest.contractId;
  const contractDef = contractId ? CONTRACTS.find(c => c.id === contractId) : undefined;
  const offerText = proceduralQuestSpeechLine(quest, 'offer', state, npc, quest.desc, contractDef);
  pushNpcQuestMessage(npc, player, world, state, msgs, `Новое поручение: ${offerText}${deadlineMessageSuffix(quest, state.clock.totalMinutes)}`, '#4af');
  const questEventData = {
    contractId,
    questId: quest.id,
    questType: quest.type,
    plotStepIndex: quest.plotStepIndex,
    sideQuestId: quest.sideQuestId,
    contractFaction: quest.contractFaction,
    contractRank: quest.contractRank,
    rewardResourceId: contractDef?.rewardResourceId,
    timeLimitMinutes: quest.timeLimitMinutes,
    expiresAtMinutes: quest.expiresAtMinutes,
    ...quest.eventData,
    ...questTargetEventData(quest),
  };
  const demosNoticeEvent = recordDemosNoticeQuestCreatedForGiver(state, npc.alifeId, quest, {
    actorId: npc.id,
    actorName: npc.name ?? '???',
    actorFaction: npc.faction,
    targetName: quest.desc,
    severity: quest.eventSeverity ?? 3,
    privacy: quest.eventPrivacy ?? 'local',
    tags: questTags(quest, 'created', contractDef),
    data: questEventData,
  });
  if (!demosNoticeEvent) {
    publishEvent(state, {
      type: contractId ? 'contract_created' : 'quest_created',
      actorId: npc.id,
      actorName: npc.name ?? '???',
      actorFaction: npc.faction,
      targetName: quest.desc,
      severity: quest.eventSeverity ?? 3,
      privacy: quest.eventPrivacy ?? 'local',
      tags: questTags(quest, 'created', contractDef),
      data: questEventData,
    });
  }

  // Spawn monsters around quest giver when authored quest asks for route pressure.
  if (nextEntityId) {
    const spawnCount = questSpawnMonstersOnAccept(quest);
    if (spawnCount > 0) spawnQuestMonsters(npc, world, entities, nextEntityId, spawnCount, msgs, state.time);
  }
  revealQuestTargetOnMap(world, player, state, quest, entities);
}

/* ── Spawn hostile monsters around NPC (for quest defense events) ── */
const SPAWN_KINDS = [
  MonsterKind.TVAR, MonsterKind.SBORKA, MonsterKind.POLZUN,
  MonsterKind.ZOMBIE, MonsterKind.SHADOW, MonsterKind.SBORKA,
  MonsterKind.TVAR, MonsterKind.ZOMBIE,
];

function spawnQuestMonsters(
  npc: Entity, world: World, entities: Entity[],
  nextEntityId: { v: number }, count: number,
  msgs: Msg[], time: number,
): void {
  spawnQuestMonstersAt(npc.x, npc.y, world, entities, nextEntityId, count, msgs, time);
}

function spawnQuestMonstersAt(
  x: number,
  y: number,
  world: World,
  entities: Entity[],
  nextEntityId: { v: number },
  count: number,
  msgs: Msg[],
  time: number,
): void {
  const slots = entitySpawnSlots(entities, EntityType.MONSTER, count);
  let spawned = 0;
  for (let i = 0; i < slots; i++) {
    // Pick random floor cell in radius 3-8 from anchor (tight corridors)
    const angle = (Math.PI * 2 * i) / slots + (Math.random() - 0.5) * 0.5;
    const dist = 3 + Math.random() * 5;
    let found = false;
    let mx = 0, my = 0;
    for (let attempt = 0; attempt < 60; attempt++) {
      const a = angle + (attempt > 0 ? (Math.random() - 0.5) * 1.5 : 0);
      const d = dist + (attempt > 0 ? (Math.random() - 0.5) * 4 : 0);
      const tx = ((Math.floor(x) + Math.round(Math.cos(a) * d)) % W + W) % W;
      const ty = ((Math.floor(y) + Math.round(Math.sin(a) * d)) % W + W) % W;
      if (world.cells[world.idx(tx, ty)] === Cell.FLOOR) {
        mx = tx; my = ty; found = true; break;
      }
    }
    if (!found) continue;

    const kind = SPAWN_KINDS[i % SPAWN_KINDS.length];
    const mdef = MONSTERS[kind];
    if (!mdef) continue;

    const zid = world.zoneMap[world.idx(mx, my)];
    const zoneLevel = (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 5) : 5;
    const rpg = randomRPG(zoneLevel);

    entities.push({
      id: nextEntityId.v++, type: EntityType.MONSTER,
      x: mx + 0.5, y: my + 0.5,
      angle: Math.atan2(y - my - 0.5, x - mx - 0.5),
      pitch: 0, alive: true,
      speed: scaleMonsterSpeed(mdef.speed, zoneLevel),
      sprite: mdef.sprite,
      hp: scaleMonsterHp(mdef.hp, zoneLevel),
      maxHp: scaleMonsterHp(mdef.hp, zoneLevel),
      monsterKind: kind, attackCd: 0,
      ai: { goal: AIGoal.WANDER, tx: Math.floor(x), ty: Math.floor(y), path: [], pi: 0, stuck: 0, timer: 0 },
      rpg,
    });
    spawned++;
  }
  if (spawned > 0) {
    msgs.push(msg('Вы слышите рык и скрежет — маршрут стал громким!', time, '#f44'));
  }
}

function holdAnchor(q: Quest, player: Entity, world: World, state: GameState): { present: boolean; x: number; y: number } {
  const resolved = resolveQuestTargetRoom(world, q, player);
  if (resolved) {
    q.targetRoom = resolved.room.id;
    const room = world.roomAt(player.x, player.y);
    return {
      present: !!room && room.id === resolved.room.id,
      x: resolved.room.x + resolved.room.w / 2,
      y: resolved.room.y + resolved.room.h / 2,
    };
  }
  return { present: checkVisitQuestAtPlayer(q, player, world, state), x: player.x, y: player.y };
}

const countMonstersNearQuery: Entity[] = [];

function countMonstersNear(world: World, _entities: readonly Entity[], x: number, y: number, radius: number, cap: number): number {
  let count = 0;
  const r2 = radius * radius;
  getEntityIndex().queryRadiusCapped(x, y, radius, countMonstersNearQuery, ENTITY_MASK_MONSTER, cap);
  for (const e of countMonstersNearQuery) {
    if (!e.alive) continue;
    if (world.dist2(x, y, e.x, e.y) <= r2) count++;
  }
  countMonstersNearQuery.length = 0;
  return count;
}

const killPressureLastSpawnAt = new Map<number, number>();

function plotStepKillPressure(q: Quest): KillPressureDef | undefined {
  return q.plotStepIndex === undefined ? undefined : PLOT_CHAIN[q.plotStepIndex]?.killPressure;
}

function resolveKillPressureAnchor(def: KillPressureDef, entities: readonly Entity[]): Entity | undefined {
  if (def.anchor.kind === 'plot_npc') {
    return findByPlotLive(entities, def.anchor.plotNpcId);
  }
  return undefined;
}

function spawnKillPressureMonstersAt(
  x: number,
  y: number,
  def: KillPressureDef,
  world: World,
  entities: Entity[],
  nextEntityId: { v: number },
  msgs: Msg[],
  time: number,
): void {
  const min = Math.max(0, Math.floor(def.spawnCountMin));
  const max = Math.max(min, Math.floor(def.spawnCountMax));
  const count = min + Math.floor(Math.random() * (max - min + 1));
  const slots = entitySpawnSlots(entities, EntityType.MONSTER, count);
  let spawned = 0;
  for (let i = 0; i < slots; i++) {
    const angle = (Math.PI * 2 * i) / Math.max(1, slots) + (Math.random() - 0.5) * 0.5;
    const baseDist = 3 + Math.random() * 5;
    let mx = -1;
    let my = -1;
    for (let attempt = 0; attempt < 60; attempt++) {
      const a = angle + (attempt > 0 ? (Math.random() - 0.5) * 1.5 : 0);
      const d = baseDist + (attempt > 0 ? (Math.random() - 0.5) * 4 : 0);
      const tx = ((Math.floor(x) + Math.round(Math.cos(a) * d)) % W + W) % W;
      const ty = ((Math.floor(y) + Math.round(Math.sin(a) * d)) % W + W) % W;
      if (world.cells[world.idx(tx, ty)] === Cell.FLOOR) {
        mx = tx;
        my = ty;
        break;
      }
    }
    if (mx < 0) continue;
    const kind = def.monsterKinds[Math.floor(Math.random() * def.monsterKinds.length)] ?? MonsterKind.TVAR;
    const mdef = MONSTERS[kind];
    if (!mdef) continue;
    const ci = world.idx(mx, my);
    const zid = world.zoneMap[ci];
    const zoneLevel = (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 6) : 6;
    const hp = scaleMonsterHp(mdef.hp, zoneLevel);
    entities.push({
      id: nextEntityId.v++, type: EntityType.MONSTER,
      x: mx + 0.5, y: my + 0.5,
      angle: Math.atan2(y - my - 0.5, x - mx - 0.5),
      pitch: 0, alive: true,
      speed: scaleMonsterSpeed(mdef.speed, zoneLevel),
      sprite: mdef.sprite,
      hp, maxHp: hp,
      monsterKind: kind, attackCd: 0,
      ai: { goal: AIGoal.WANDER, tx: Math.floor(x), ty: Math.floor(y), path: [], pi: 0, stuck: 0, timer: 0 },
      rpg: randomRPG(zoneLevel),
    });
    spawned++;
  }
  if (spawned > 0) msgs.push(msg('В коридорах рвётся новая волна тварей.', time, '#f44'));
}

export function updateKillQuestPressure(
  world: World,
  entities: Entity[],
  state: GameState,
  msgs: Msg[],
  nextEntityId: { v: number },
): boolean {
  let spawned = false;
  const activeQuestIds = new Set<number>();
  for (const q of state.quests) {
    if (q.done || q.failed || q.type !== QuestType.KILL) continue;
    const pressure = plotStepKillPressure(q);
    if (!pressure || pressure.monsterKinds.length <= 0) continue;
    activeQuestIds.add(q.id);
    const anchor = resolveKillPressureAnchor(pressure, entities);
    if (!anchor) continue;
    const last = killPressureLastSpawnAt.get(q.id);
    if (last === undefined) {
      killPressureLastSpawnAt.set(q.id, state.time);
      continue;
    }
    if (state.time - last < pressure.intervalSeconds) continue;
    if (countMonstersNear(world, entities, anchor.x, anchor.y, pressure.radius, pressure.maxAliveNearAnchor) >= pressure.maxAliveNearAnchor) continue;
    killPressureLastSpawnAt.set(q.id, state.time);
    const before = entities.length;
    spawnKillPressureMonstersAt(anchor.x, anchor.y, pressure, world, entities, nextEntityId, msgs, state.time);
    spawned = spawned || entities.length > before;
  }
  for (const questId of Array.from(killPressureLastSpawnAt.keys())) {
    if (!activeQuestIds.has(questId)) killPressureLastSpawnAt.delete(questId);
  }
  return spawned;
}

function updateHoldoutQuest(
  q: Quest,
  player: Entity,
  world: World,
  entities: Entity[],
  state: GameState,
  msgs: Msg[],
  nextEntityId?: { v: number },
): boolean {
  if (q.holdSeconds === undefined) return false;
  if (!isQuestTargetOnCurrentFloor(q, state)) {
    q.holdLastTime = state.time;
    if (q.holdResetOnExit) q.holdProgressSeconds = 0;
    return false;
  }

  const anchor = holdAnchor(q, player, world, state);
  const last = q.holdLastTime ?? state.time;
  const dt = Math.max(0, Math.min(2, state.time - last));
  q.holdLastTime = state.time;

  if (!anchor.present) {
    if (q.holdResetOnExit && (q.holdProgressSeconds ?? 0) > 0) {
      q.holdProgressSeconds = 0;
      msgs.push(msg('Удержание сорвано: зона потеряна, таймер пошёл заново.', state.time, '#fa4'));
    }
    return false;
  }

  q.holdProgressSeconds = Math.min(q.holdSeconds, (q.holdProgressSeconds ?? 0) + dt);

  if (nextEntityId && q.holdSpawnMonsters && q.holdSpawnIntervalSeconds) {
    const maxAlive = q.holdSpawnMaxAlive ?? Math.max(6, q.holdSpawnMonsters * 3);
    const lastSpawn = q.holdSpawnLastTime ?? -Infinity;
    if (state.time - lastSpawn >= q.holdSpawnIntervalSeconds && countMonstersNear(world, entities, anchor.x, anchor.y, 30, maxAlive) < maxAlive) {
      q.holdSpawnLastTime = state.time;
      spawnQuestMonstersAt(anchor.x, anchor.y, world, entities, nextEntityId, q.holdSpawnMonsters, msgs, state.time);
    }
  }

  return q.holdProgressSeconds >= q.holdSeconds;
}

function plotTalkTargetIsDead(q: Quest, entities: readonly Entity[], state: GameState): boolean {
  if (q.plotStepIndex === undefined || q.type !== QuestType.TALK || !q.targetPlotNpcId) return false;
  const target = findByPlotAll(entities, q.targetPlotNpcId);
  if (target) return !target.alive;
  return isPlotNpcDeadKnown(state, q.targetPlotNpcId);
}

/* ── Check all active quests for completion ───────────────────── */
export function checkQuests(
  player: Entity, world: World, entities: Entity[],
  state: GameState, msgs: Msg[], nextEntityId?: { v: number },
): void {
  const previousIndex = _currentIndex;
  _currentIndex = buildEntityIndex(entities);
  for (const q of state.quests) {
    if (q.done) continue;
    ensureQuestDeadline(q, state.clock.totalMinutes, questDeadlineContext(q, player, world, state));
    if (expireQuestIfNeeded(q, player, entities, state, msgs)) continue;
    if (handleContractQuestItemOutcome(q, player, entities, state, msgs)) continue;

    let complete = false;
    const govnyakCourierReady = canCompleteGovnyakCourierEndpoint(q, player, world, state);
    if (govnyakCourierReady !== undefined) {
      if (govnyakCourierReady) complete = true;
      if (complete) completeQuest(q, player, entities, state, msgs);
      continue;
    }

    switch (q.type) {
      case QuestType.FETCH:
        if (q.targetItem === 'money') {
          if ((player.money ?? 0) >= (q.targetCount ?? 1)) complete = true;
        } else if (q.targetItem) {
          const needed = q.targetCount ?? 1;
          const have = (player.inventory ?? []).reduce(
            (sum, s) => s.defId === q.targetItem ? sum + s.count : sum, 0,
          );
          if (have >= needed) complete = true;
        }
        break;

      case QuestType.VISIT:
        complete = q.holdSeconds !== undefined
          ? updateHoldoutQuest(q, player, world, entities, state, msgs, nextEntityId)
          : checkVisitQuestAtPlayer(q, player, world, state);
        break;

      case QuestType.KILL:
        if (q.killCount !== undefined && q.killNeeded !== undefined) {
          if (q.killCount >= q.killNeeded) complete = true;
        }
        break;

      case QuestType.TALK:
        complete = plotTalkTargetIsDead(q, entities, state);
        break;
    }

    if (complete) completeQuest(q, player, entities, state, msgs);
  }
  _currentIndex = previousIndex;
}

/* ── Notify kill for KILL quests ──────────────────────────────── */
export function notifyKill(kind: MonsterKind, state: GameState): void {
  for (const q of state.quests) {
    if (q.done || q.type !== QuestType.KILL) continue;
    if (!isQuestTargetOnCurrentFloor(q, state)) continue;
    const genericMonsterTarget = q.targetMonsterKind === undefined && q.targetNpcId === undefined && q.targetPlotNpcId === undefined;
    if (q.targetMonsterKind === kind || genericMonsterTarget) {
      q.killCount = (q.killCount ?? 0) + 1;
    }
  }
}

/* ── Notify NPC kill for KILL quests targeting plotNpcId ───────── */
export function notifyNpcKill(plotNpcId: string, state: GameState): void {
  for (const q of state.quests) {
    if (q.done || q.type !== QuestType.KILL) continue;
    if (q.targetPlotNpcId === plotNpcId) {
      q.killCount = (q.killCount ?? 0) + 1;
    }
  }
  for (const q of state.quests) {
    if (q.done || q.failOnNpcDeathPlotId !== plotNpcId) continue;
    failQuest(q, [], state, undefined, 'npc_dead', ['npc_dead'], { protectedPlotNpcId: plotNpcId });
  }
}

export function questMatchesStorySelector(q: Quest, selector: StoryQuestSelector | undefined): boolean {
  if (!selector) return true;
  if (selector.questId !== undefined && q.id !== selector.questId) return false;
  if (selector.plotStepIndex !== undefined && q.plotStepIndex !== selector.plotStepIndex) return false;
  if (selector.sideQuestId !== undefined && q.sideQuestId !== selector.sideQuestId) return false;
  if (selector.contractId !== undefined && q.contractId !== selector.contractId) return false;
  if (selector.type !== undefined && q.type !== selector.type) return false;
  if (selector.targetItem !== undefined && q.targetItem !== selector.targetItem) return false;
  if (selector.targetPlotNpcId !== undefined && q.targetPlotNpcId !== selector.targetPlotNpcId) return false;
  if (selector.targetMonsterKind !== undefined && q.targetMonsterKind !== selector.targetMonsterKind) return false;
  return true;
}

export function hasStoryQuest(
  state: Pick<GameState, 'quests'>,
  selector: StoryQuestSelector | undefined,
  mode: 'active' | 'completed',
): boolean {
  return state.quests.some(q => {
    if (!questMatchesStorySelector(q, selector)) return false;
    return mode === 'completed'
      ? q.done && !q.failed
      : !q.done && !q.failed;
  });
}

export function applyStoryQuestOutcome(
  outcome: StoryQuestOutcomeDef,
  player: Entity,
  entities: Entity[],
  state: GameState,
  msgs: Msg[],
  itemId?: string,
): boolean {
  if (outcome.kind !== 'complete_quest') return false;
  const quest = state.quests.find(q => !q.done && !q.failed && questMatchesStorySelector(q, outcome.quest));
  if (!quest) return false;
  const completed = completeQuest(quest, player, entities, state, msgs);
  if (completed && outcome.consumeItem && itemId && !(quest.type === QuestType.FETCH && quest.targetItem === itemId)) {
    removeItem(player, itemId, 1);
  }
  return completed;
}

function failQuest(
  q: Quest,
  entities: Entity[],
  state: GameState,
  msgs: Msg[] | undefined,
  reason: string,
  extraTags: string[] = [],
  extraData: Record<string, unknown> = {},
): void {
  if (q.done) return;

  q.done = true;
  q.failed = true;
  const giver = findById(entities, q.giverId);
  if (giver?.questId === q.id) giver.questId = -1;
  const contractDef = q.contractId ? CONTRACTS.find(c => c.id === q.contractId) : undefined;

  if (msgs) msgs.push(msg(`Поручение сорвано: ${proceduralQuestSpeechLine(q, 'failure', state, giver, q.desc, contractDef)}`, state.time, '#f66'));
  publishEvent(state, {
    type: q.contractId ? 'contract_failed' : 'quest_failed',
    actorId: q.giverId,
    actorName: q.giverName,
    actorFaction: giver?.faction ?? q.contractFaction,
    targetName: q.desc,
    severity: 3,
    privacy: 'local',
    tags: [...questTags(q, 'failed', contractDef), reason, ...extraTags],
    data: {
      questId: q.id,
      questType: q.type,
      targetItem: q.targetItem,
      targetMonsterKind: q.targetMonsterKind,
      targetPlotNpcId: q.targetPlotNpcId,
      sideQuestId: q.sideQuestId,
      contractId: q.contractId,
      contractFaction: q.contractFaction,
      contractRank: q.contractRank,
      rewardResourceId: contractDef?.rewardResourceId,
      ...questDeadlineEventData(q, state.clock.totalMinutes),
      reason,
      ...extraData,
      ...questTargetEventData(q),
    },
  });
}

/* ── Check if talking to target NPC completes a TALK quest ────── */
export function checkTalkQuest(
  targetNpc: Entity, player: Entity, world: World, entities: Entity[],
  state: GameState, msgs: Msg[],
): void {
  for (const q of state.quests) {
    if (q.done || q.type !== QuestType.TALK) continue;
    // Match by entity id OR by plot NPC id (cross-floor quests)
    const matchById = q.targetNpcId === targetNpc.id;
    const matchByPlotId = q.targetPlotNpcId && targetNpc.plotNpcId === q.targetPlotNpcId;
    if (!matchById && !matchByPlotId) continue;
    const pack = resolveNpcPackageForEntity(targetNpc);
    const talkQuestResponse = pack ? selectNpcLockedQuestResponse(pack, q.id) : undefined;
    if (completeQuest(q, player, entities, state, msgs)) {
      if (talkQuestResponse) {
        pushNpcQuestMessage(targetNpc, player, world, state, msgs, `${targetNpc.name}: «${talkQuestResponse.text}»`, '#aaf');
      } else {
        pushNpcQuestMessage(targetNpc, player, world, state, msgs, `${targetNpc.name}: «Передам, спасибо.»`, '#aaf');
      }
    }
  }
}

function contractCompletionTags(contractDef: ContractDef | undefined): string[] {
  if (!contractDef) return ['quest', 'completed'];
  if (!contractDef.tags.includes('cleanup')) return ['quest', 'contract', 'completed', ...contractDef.tags];
  const tags = ['quest', 'contract', 'completed', 'cleanup_completed'];
  for (const tag of ['slime', 'brown_slime', 'cleanup']) {
    if (contractDef.tags.includes(tag)) tags.push(tag);
  }
  for (const tag of contractDef.tags) if (!tags.includes(tag)) tags.push(tag);
  return tags;
}

function questRewardStacks(q: Quest): { defId: string; count: number }[] {
  const rewards: { defId: string; count: number }[] = [];
  if (q.rewardItem) rewards.push({ defId: q.rewardItem, count: q.rewardCount ?? 1 });
  for (const reward of q.extraRewards ?? []) rewards.push({ defId: reward.defId, count: reward.count });
  return rewards;
}

function questRewardsFitAfterHandoff(q: Quest, player: Entity): boolean {
  const rewards = questRewardStacks(q);
  if (rewards.length === 0) return true;
  const probe: Entity = {
    ...player,
    inventory: (player.inventory ?? []).map(item => ({ ...item })),
  };
  if (q.type === QuestType.FETCH && q.targetItem && q.targetItem !== 'money') {
    removeItem(probe, q.targetItem, q.targetCount ?? 1);
  }
  for (const reward of rewards) {
    if (!addItem(probe, reward.defId, reward.count)) return false;
  }
  return true;
}

function questRewardNoSpaceText(q: Quest): string {
  const names = questRewardStacks(q).map(reward => {
    const def = ITEMS[reward.defId];
    return `${def?.name ?? reward.defId} ×${reward.count}`;
  });
  return `Нет места для платы: ${names.join(', ')}. Освободите инвентарь и сдайте поручение снова.`;
}

function questCraftRecipeSourceIds(q: Quest): string[] {
  const ids: string[] = [];
  const fromEvent = q.eventData?.craftRecipeSourceId;
  if (typeof fromEvent === 'string') ids.push(fromEvent);
  if (q.sideQuestId) {
    for (const source of craftRecipeSourcesForQuest(q.sideQuestId)) ids.push(source.id);
  }
  return [...new Set(ids)];
}

function questEventCraftRecipeIds(q: Quest): string[] {
  const raw = q.eventData?.craftRecipeIds;
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const id of raw) {
    if (typeof id === 'string') ids.push(id);
  }
  return [...new Set(ids)];
}

function learnQuestCraftRecipeRewards(q: Quest, state: GameState, msgs: Msg[]): void {
  const announced = new Set<string>();
  for (const sourceId of questCraftRecipeSourceIds(q)) {
    const source = getCraftRecipeSource(sourceId);
    if (!source || source.kind !== 'quest') continue;
    const result = learnCraftRecipesFromSource(state, source);
    for (const recipeId of result.learned) {
      announced.add(recipeId);
      msgs.push(msg(craftRecipeLearnedMessage(recipeId), state.time, '#8cf'));
    }
    if (result.learned.length === 0 && result.unknown.length > 0 && result.duplicate.length === 0) {
      msgs.push(msg('Схема неполная: нужен станок или другой лист', state.time, '#aa8'));
    }
  }
  for (const recipeId of questEventCraftRecipeIds(q)) {
    if (announced.has(recipeId) || !craftRecipeExists(recipeId)) continue;
    if (learnCraftRecipe(state, recipeId, 'quest_event') || hasCraftRecipe(state, recipeId)) {
      announced.add(recipeId);
      msgs.push(msg(craftRecipeLearnedMessage(recipeId), state.time, '#8cf'));
    }
  }
}

/* ── Complete a quest ─────────────────────────────────────────── */
function completeQuest(
  q: Quest, player: Entity, entities: Entity[],
  state: GameState, msgs: Msg[],
): boolean {
  if (!questRewardsFitAfterHandoff(q, player)) {
    msgs.push(msg(questRewardNoSpaceText(q), state.time, '#fa4'));
    return false;
  }

  q.done = true;
  resolveGovnyakCourierOutcome(q, player, state, msgs);

  // FETCH: take the item from player
  if (q.type === QuestType.FETCH && q.targetItem) {
    if (q.targetItem === 'money') {
      player.money = (player.money ?? 0) - (q.targetCount ?? 1);
    } else {
      removeItem(player, q.targetItem, q.targetCount ?? 1);
    }
  }

  // Reward
  if (q.rewardItem) {
    addItem(player, q.rewardItem, q.rewardCount ?? 1);
    const def = ITEMS[q.rewardItem];
    msgs.push(msg(`Плата: ${def?.name ?? q.rewardItem} ×${q.rewardCount ?? 1}`, state.time, '#4f4'));
  }
  if (q.extraRewards) {
    for (const r of q.extraRewards) {
      addItem(player, r.defId, r.count);
      const def = ITEMS[r.defId];
      msgs.push(msg(`Плата: ${def?.name ?? r.defId} ×${r.count}`, state.time, '#4f4'));
    }
  }

  // XP reward
  if (q.xpReward) {
    awardXP(player, q.xpReward, msgs, state.time);
  }

  // Money reward
  if (q.moneyReward) {
    player.money = (player.money ?? 0) + q.moneyReward;
    msgs.push(msg(`+${q.moneyReward}₽`, state.time, '#ee4'));
  }

  learnQuestCraftRecipeRewards(q, state, msgs);

  const giver = findById(entities, q.giverId);
  const giverFaction = giver?.faction ?? q.contractFaction ?? Faction.CITIZEN;
  const factionRelationDelta = completedQuestFactionRelationDelta(q.relationDelta);
  if (factionRelationDelta !== 0) addFactionRelMutual(Faction.PLAYER, giverFaction, factionRelationDelta);
  const giverPlayerRelationDelta = giver?.type === EntityType.NPC
    ? completedQuestGiverRelationDelta(q.relationDelta, q.difficulty)
    : 0;
  const giverPlayerRelation = giverPlayerRelationDelta !== 0 && giver
    ? addNpcPlayerRelation(giver, giverPlayerRelationDelta)
    : undefined;
  if (giverPlayerRelationDelta !== 0 && giver?.type === EntityType.NPC && giver.alifeId !== undefined) {
    applyDemosRelationDelta(state, giver.alifeId, { targetKind: 'player' }, giverPlayerRelationDelta, {
      reasonTag: q.contractId ? 'contract_completed' : 'quest_completed',
    });
  }

  // Clear NPC's questId
  if (giver) {
    giver.questId = -1;
    // Side quest NPC: switch to post-dialogue after completion
    if (q.sideQuestId) giver.plotDone = true;
  }

  const contractDef = q.contractId ? CONTRACTS.find(c => c.id === q.contractId) : undefined;
  msgs.push(msg(`Поручение закрыто: ${proceduralQuestSpeechLine(q, 'completion', state, giver, q.desc, contractDef)}`, state.time, '#4f4'));
  publishEvent(state, {
    type: q.contractId ? 'contract_completed' : 'quest_completed',
    actorId: q.giverId,
    actorName: q.giverName,
    actorFaction: giverFaction,
    targetName: q.eventTargetName ?? q.desc,
    severity: q.eventSeverity ?? 4,
    privacy: q.eventPrivacy ?? 'local',
    tags: q.contractId ? [...contractCompletionTags(contractDef), ...(q.eventTags ?? [])] : questTags(q, 'completed'),
    data: {
      questId: q.id,
      questType: q.type,
      targetItem: q.targetItem,
      targetMonsterKind: q.targetMonsterKind,
      targetPlotNpcId: q.targetPlotNpcId,
      plotStepIndex: q.plotStepIndex,
      sideQuestId: q.sideQuestId,
      contractId: q.contractId,
      contractFaction: q.contractFaction,
      contractRank: q.contractRank,
      rewardResourceId: contractDef?.rewardResourceId,
      xpReward: q.xpReward,
      moneyReward: q.moneyReward,
      factionRelationDelta,
      giverPlayerRelationDelta,
      giverPlayerRelation,
      ...questDeadlineEventData(q, state.clock.totalMinutes),
      ...q.eventData,
      ...govnyakCourierOutcomeEventData(q),
      ...questTargetEventData(q),
    },
  });

  if (q.type === QuestType.FETCH && q.targetItem && isSilverSlimeItem(q.targetItem)) {
    const itemDef = ITEMS[q.targetItem];
    const sealed = q.targetItem === SILVER_SLIME_SEALED_ID;
    const scienceHandoff = sealed && (giverFaction === Faction.SCIENTIST || q.contractFaction === Faction.SCIENTIST || contractDef?.tags.includes('science') === true);
    const blackMarketHandoff = giverFaction === Faction.WILD || giverFaction === Faction.CULTIST || contractDef?.tags.includes('black_market') === true;
    publishEvent(state, {
      type: 'player_handoff_item',
      actorId: player.id,
      actorName: player.name ?? 'Вы',
      actorFaction: player.faction,
      targetId: q.giverId,
      targetName: q.giverName,
      targetFaction: giverFaction,
      itemId: q.targetItem,
      itemName: itemDef?.name ?? q.targetItem,
      itemCount: q.targetCount ?? 1,
      itemValue: itemDef?.value ?? 0,
      severity: 4,
      privacy: 'public',
      tags: ['player', 'handoff', 'slime', 'silver_slime', sealed ? 'sealed' : 'opened', scienceHandoff ? 'science' : blackMarketHandoff ? 'black_market' : 'suspicious'],
      data: {
        questId: q.id,
        contractId: q.contractId,
        outcome: scienceHandoff ? 'science_handoff' : blackMarketHandoff ? 'black_market_sale' : 'sample_handoff',
        rumorIds: [scienceHandoff ? 'silver_slime_science_handoff' : 'silver_slime_sale_suspicion'],
      },
    });
  }

  abandonSideQuests(q, entities, state, msgs);
  return true;
}

function abandonSideQuests(
  completed: Quest,
  entities: Entity[],
  state: GameState,
  msgs: Msg[],
): void {
  if (!completed.abandonsSideQuestIds?.length) return;
  const abandoned = new Set(completed.abandonsSideQuestIds);
  for (const q of state.quests) {
    if (q.done || !q.sideQuestId || !abandoned.has(q.sideQuestId)) continue;
    failQuest(q, entities, state, msgs, 'abandoned', ['abandoned'], {
      abandonedByQuestId: completed.id,
      abandonedBySideQuestId: completed.sideQuestId,
    });
  }
}

function expireQuestIfNeeded(q: Quest, player: Entity, entities: Entity[], state: GameState, msgs: Msg[]): boolean {
  if (!questDeadlineExpired(q, state.clock.totalMinutes)) return false;

  q.done = true;
  q.failed = true;
  const giver = findById(entities, q.giverId);
  if (giver?.questId === q.id) giver.questId = -1;
  const contractDef = q.contractId ? CONTRACTS.find(c => c.id === q.contractId) : undefined;
  if (isGovnyakCourierContractId(q.contractId)) removeItem(player, GOVNYAK_COURIER_PACKAGE_ITEM, 1);

  msgs.push(msg(`Срок вышел: ${proceduralQuestSpeechLine(q, 'failure', state, giver, q.desc, contractDef)}`, state.time, '#f66'));
  publishEvent(state, {
    type: q.contractId ? 'contract_failed' : 'quest_failed',
    actorId: q.giverId,
    actorName: q.giverName,
    actorFaction: giver?.faction ?? q.contractFaction,
    targetName: q.desc,
    severity: 3,
    privacy: 'local',
    tags: [...questTags(q, 'failed', contractDef), 'deadline'],
    data: {
      questId: q.id,
      questType: q.type,
      targetItem: q.targetItem,
      targetMonsterKind: q.targetMonsterKind,
      targetPlotNpcId: q.targetPlotNpcId,
      sideQuestId: q.sideQuestId,
      contractId: q.contractId,
      contractFaction: q.contractFaction,
      contractRank: q.contractRank,
      rewardResourceId: contractDef?.rewardResourceId,
      ...questDeadlineEventData(q, state.clock.totalMinutes),
      reason: 'deadline',
      ...q.eventData,
      ...questTargetEventData(q),
    },
  });
  return true;
}

function questDeadlineContext(q: Quest, player: Entity, world: World, state: GameState): QuestDeadlineContext {
  const targetFloor = q.visitFloor ?? q.targetFloor;
  const ctx: QuestDeadlineContext = {
    samosborDanger: state.samosborActive,
    crossFloor: targetFloor !== undefined && targetFloor !== state.currentFloor,
  };
  if (q.targetRoom !== undefined) {
    const room = world.rooms[q.targetRoom];
    if (room) ctx.distance = world.dist(player.x, player.y, room.x + room.w / 2, room.y + room.h / 2);
  }
  return ctx;
}
/* ── Toroidal direction name (from → to) ─────────────────────── */
function toroidalDirection(world: World, fromX: number, fromY: number, toX: number, toY: number): string {
  const dx = world.delta(Math.floor(fromX), Math.floor(toX));
  const dy = world.delta(Math.floor(fromY), Math.floor(toY));
  // dy<0 = target is above = north; dx>0 = target is right = east
  const ns = dy < -5 ? 'север' : dy > 5 ? 'юг' : '';
  const ew = dx > 5 ? 'восток' : dx < -5 ? 'запад' : '';
  if (ns === 'север' && ew === 'восток') return 'на северо-востоке';
  if (ns === 'север' && ew === 'запад') return 'на северо-западе';
  if (ns === 'юг' && ew === 'восток') return 'на юго-востоке';
  if (ns === 'юг' && ew === 'запад') return 'на юго-западе';
  if (ns === 'север') return 'на севере';
  if (ns === 'юг') return 'на юге';
  if (ew === 'восток') return 'на востоке';
  if (ew === 'запад') return 'на западе';
  return 'недалеко';
}

function nearestRoomOfType(world: World, npc: Entity, roomType: number): Room | null {
  const current = world.roomAt(npc.x, npc.y);
  if (current?.type === roomType) return current;

  let best: Room | null = null;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (const room of world.rooms) {
    if (!room || room.type !== roomType) continue;
    const d2 = world.dist2(npc.x, npc.y, room.x + room.w / 2, room.y + room.h / 2);
    if (d2 < bestD2) {
      best = room;
      bestD2 = d2;
    }
  }
  return best;
}

function nearestRoomByName(world: World, npc: Entity, roomName: string): Room | null {
  const current = world.roomAt(npc.x, npc.y);
  if (current?.name === roomName) return current;

  let best: Room | null = null;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (const room of world.rooms) {
    if (!room || room.name !== roomName) continue;
    const d2 = world.dist2(npc.x, npc.y, room.x + room.w / 2, room.y + room.h / 2);
    if (d2 < bestD2) {
      best = room;
      bestD2 = d2;
    }
  }
  return best;
}

function plotNpcDisplayName(plotNpcId: string): string | undefined {
  const pack = getNpcPackageByPlotNpcId(plotNpcId);
  return pack ? npcPackageDisplayName(pack) : undefined;
}

/* ── Generate plot quest from PLOT_CHAIN ──────────────────────── */
function generatePlotQuest(
  npc: Entity, world: World, entities: Entity[], state: GameState,
): Quest | null {
  const plotId = npc.plotNpcId!;
  for (let i = 0; i < PLOT_CHAIN.length; i++) {
    const step = PLOT_CHAIN[i];
    if (step.giverNpcId !== plotId) continue;
    // Skip if this step already has a quest (active or done)
    if (state.quests.some(q => q.plotStepIndex === i)) continue;
    // All previous steps must be done
    let allPrevDone = true;
    for (let j = 0; j < i; j++) {
      if (!state.quests.some(q => q.plotStepIndex === j && q.done)) { allPrevDone = false; break; }
    }
    if (!allPrevDone) continue;

    const id = state.nextQuestId++;
    let desc = step.desc;

    if (step.type === QuestType.TALK && step.targetNpcId) {
      const target = findByPlotLive(entities, step.targetNpcId);
      if (target && desc.includes('{dir}')) {
        desc = desc.replace('{dir}', toroidalDirection(world, npc.x, npc.y, target.x, target.y));
      } else if (!target) {
        // Target NPC on a different floor — strip {dir} placeholder
        desc = desc.replace('{dir}', 'на другом уровне');
      }
      const targetName = plotNpcDisplayName(step.targetNpcId);
      return {
        id, type: step.type,
        giverId: npc.id, giverName: npc.name ?? '???',
        desc,
        targetNpcId: target?.id, targetNpcName: target?.name ?? targetName,
        targetPlotNpcId: step.targetNpcId,
        rewardItem: step.rewardItem, rewardCount: step.rewardCount,
        extraRewards: step.extraRewards,
        relationDelta: step.relationDelta, xpReward: step.xpReward,
        moneyReward: step.moneyReward,
        plotStepIndex: i,
        ...authoredQuestMeta(step, state),
        done: false,
      };
    }

    if (step.type === QuestType.FETCH) {
      return {
        id, type: step.type,
        giverId: npc.id, giverName: npc.name ?? '???',
        desc,
        targetItem: step.targetItem, targetCount: step.targetCount,
        rewardItem: step.rewardItem, rewardCount: step.rewardCount,
        extraRewards: step.extraRewards,
        relationDelta: step.relationDelta, xpReward: step.xpReward,
        moneyReward: step.moneyReward,
        plotStepIndex: i,
        ...authoredQuestMeta(step, state),
        done: false,
      };
    }

    if (step.type === QuestType.KILL) {
      if (desc.includes('{dir}') && step.targetMonsterKind !== undefined) {
        const targetMon = findMonLive(entities, step.targetMonsterKind);
        desc = desc.replace('{dir}', targetMon
          ? toroidalDirection(world, npc.x, npc.y, targetMon.x, targetMon.y)
          : 'где-то в глубине');
      }
      return {
        id, type: step.type,
        giverId: npc.id, giverName: npc.name ?? '???',
        desc,
        targetMonsterKind: step.targetMonsterKind,
        targetPlotNpcId: step.targetPlotNpcId,
        killCount: 0, killNeeded: step.killNeeded ?? 1,
        rewardItem: step.rewardItem, rewardCount: step.rewardCount,
        extraRewards: step.extraRewards,
        relationDelta: step.relationDelta, xpReward: step.xpReward,
        moneyReward: step.moneyReward,
        plotStepIndex: i,
        ...authoredQuestMeta(step, state),
        done: false,
      };
    }

    if (step.type === QuestType.VISIT && (step.targetRoomType !== undefined || step.targetRoomName !== undefined)) {
      const room = step.targetRoomName
        ? nearestRoomByName(world, npc, step.targetRoomName)
        : nearestRoomOfType(world, npc, step.targetRoomType!);
      return {
        id, type: step.type,
        giverId: npc.id, giverName: npc.name ?? '???',
        desc,
        targetRoom: room?.id,
        rewardItem: step.rewardItem, rewardCount: step.rewardCount,
        extraRewards: step.extraRewards,
        relationDelta: step.relationDelta, xpReward: step.xpReward,
        moneyReward: step.moneyReward,
        plotStepIndex: i,
        ...authoredQuestMeta(step, state),
        done: false,
      };
    }

    if (step.type === QuestType.VISIT && (step as { visitFloor?: number }).visitFloor !== undefined) {
      return {
        id, type: step.type,
        giverId: npc.id, giverName: npc.name ?? '???',
        desc,
        visitFloor: (step as { visitFloor: number }).visitFloor,
        rewardItem: step.rewardItem, rewardCount: step.rewardCount,
        extraRewards: step.extraRewards,
        relationDelta: step.relationDelta, xpReward: step.xpReward,
        moneyReward: step.moneyReward,
        plotStepIndex: i,
        ...authoredQuestMeta(step, state),
        done: false,
      };
    }
  }

  // ── Side quests (no prerequisite chain) ──
  for (const sq of SIDE_QUESTS) {
    if (sq.giverNpcId !== plotId) continue;
    if (state.quests.some(q => q.sideQuestId === sq.id)) continue;
    if (!sideQuestPrereqsMet(sq, state.quests)) continue;

    if (sq.type === QuestType.FETCH) {
      const id = state.nextQuestId++;
      return {
        id, type: sq.type,
        giverId: npc.id, giverName: npc.name ?? '???',
        desc: sq.desc,
        targetItem: sq.targetItem, targetCount: sq.targetCount,
        rewardItem: sq.rewardItem, rewardCount: sq.rewardCount,
        extraRewards: sq.extraRewards,
        relationDelta: sq.relationDelta, xpReward: sq.xpReward,
        moneyReward: sq.moneyReward,
        sideQuestId: sq.id,
        ...authoredQuestMeta(sq, state),
        done: false,
      };
    }
    if (sq.type === QuestType.KILL) {
      const id = state.nextQuestId++;
      return {
        id, type: sq.type,
        giverId: npc.id, giverName: npc.name ?? '???',
        desc: sq.desc,
        targetMonsterKind: sq.targetMonsterKind,
        targetPlotNpcId: sq.targetPlotNpcId,
        killCount: 0, killNeeded: sq.killNeeded ?? 1,
        rewardItem: sq.rewardItem, rewardCount: sq.rewardCount,
        extraRewards: sq.extraRewards,
        relationDelta: sq.relationDelta, xpReward: sq.xpReward,
        moneyReward: sq.moneyReward,
        sideQuestId: sq.id,
        ...authoredQuestMeta(sq, state),
        done: false,
      };
    }
    if (sq.type === QuestType.TALK) {
      const targetPlotNpcId = sq.targetNpcId ?? sq.targetPlotNpcId;
      if (!targetPlotNpcId) continue;
      const id = state.nextQuestId++;
      const target = findByPlotLive(entities, targetPlotNpcId);
      const targetName = plotNpcDisplayName(targetPlotNpcId);
      let desc = sq.desc;
      if (desc.includes('{dir}')) {
        desc = desc.replace('{dir}', target
          ? toroidalDirection(world, npc.x, npc.y, target.x, target.y)
          : 'на другом уровне');
      }
      return {
        id, type: sq.type,
        giverId: npc.id, giverName: npc.name ?? '???',
        desc,
        targetNpcId: target?.id,
        targetNpcName: target?.name ?? targetName ?? targetPlotNpcId,
        targetPlotNpcId,
        rewardItem: sq.rewardItem, rewardCount: sq.rewardCount,
        extraRewards: sq.extraRewards,
        relationDelta: sq.relationDelta, xpReward: sq.xpReward,
        moneyReward: sq.moneyReward,
        sideQuestId: sq.id,
        ...authoredQuestMeta(sq, state),
        done: false,
      };
    }
    if (sq.type === QuestType.VISIT && sq.visitFloor !== undefined) {
      const id = state.nextQuestId++;
      return {
        id, type: sq.type,
        giverId: npc.id, giverName: npc.name ?? '???',
        desc: sq.desc,
        visitFloor: sq.visitFloor,
        rewardItem: sq.rewardItem, rewardCount: sq.rewardCount,
        extraRewards: sq.extraRewards,
        relationDelta: sq.relationDelta, xpReward: sq.xpReward,
        moneyReward: sq.moneyReward,
        sideQuestId: sq.id,
        ...authoredQuestMeta(sq, state),
        done: false,
      };
    }
    if (sq.type === QuestType.VISIT && (sq.targetRoomType !== undefined || sq.targetRoomName !== undefined)) {
      const room = sq.targetRoomName
        ? nearestRoomByName(world, npc, sq.targetRoomName)
        : nearestRoomOfType(world, npc, sq.targetRoomType!);
      if (!room) continue;
      const id = state.nextQuestId++;
      let desc = sq.desc;
      if (desc.includes('{dir}')) {
        desc = desc.replace('{dir}', toroidalDirection(world, npc.x, npc.y, room.x + room.w / 2, room.y + room.h / 2));
      }
      return {
        id, type: sq.type,
        giverId: npc.id, giverName: npc.name ?? '???',
        desc,
        targetRoom: room.id,
        rewardItem: sq.rewardItem, rewardCount: sq.rewardCount,
        extraRewards: sq.extraRewards,
        relationDelta: sq.relationDelta, xpReward: sq.xpReward,
        moneyReward: sq.moneyReward,
        sideQuestId: sq.id,
        ...authoredQuestMeta(sq, state),
        done: false,
      };
    }
  }

  return null;
}

interface QuestContext {
  floor: FloorLevel;
  roomName: string;
  roomType?: RoomType;
  zoneId: number;
  zoneFaction?: ZoneFaction;
  zoneLevel: number;
  samosborDanger: boolean;
  nearbyMonster?: Entity;
}

type QuestChoice = 'fetch' | 'visit' | 'kill' | 'talk';
const PROCEDURAL_FETCH_ITEM_BLOCKLIST = new Set(['idol_chernobog', 'strange_clot']);

function buildQuestContext(npc: Entity, world: World, entities: Entity[], state: GameState): QuestContext {
  const room = world.roomAt(npc.x, npc.y);
  const cellIdx = world.idx(Math.floor(npc.x), Math.floor(npc.y));
  const zoneId = world.zoneMap[cellIdx] ?? 0;
  const zone = world.zones[zoneId];
  const territoryOwner = territoryOwnerAtIndex(world, cellIdx);
  let nearbyMonster: Entity | undefined;
  let bestD2 = 30 * 30;
  for (const e of entities) {
    if (e.type !== EntityType.MONSTER || !e.alive) continue;
    const d2 = world.dist2(npc.x, npc.y, e.x, e.y);
    if (d2 < bestD2) { bestD2 = d2; nearbyMonster = e; }
  }
  return {
    floor: state.currentFloor,
    roomName: room?.name ?? 'коридоре',
    roomType: room?.type,
    zoneId,
    zoneFaction: territoryOwner,
    zoneLevel: zone?.level ?? 1,
    samosborDanger: state.samosborActive || zone?.fogged === true || territoryOwner === ZoneFaction.SAMOSBOR,
    nearbyMonster,
  };
}

function pickQuestChoice(npc: Entity, ctx: QuestContext): QuestChoice {
  const weights: Record<QuestChoice, number> = { fetch: 35, visit: 18, kill: 20, talk: 15 };
  if (ctx.samosborDanger) { weights.kill += 30; weights.fetch += 10; }
  if (ctx.nearbyMonster) weights.kill += 25;
  if (npc.faction === Faction.LIQUIDATOR || occupationHasProfileTag(npc.occupation, 'combat')) weights.kill += 30;
  if (npc.faction === Faction.CULTIST || occupationHasProfileTag(npc.occupation, 'cult')) {
    weights.fetch += 12;
    weights.talk += 8;
  }
  if (occupationHasProfileTag(npc.occupation, 'admin')) {
    weights.visit += 18;
    weights.talk += 12;
  }
  if (occupationHasProfileTag(npc.occupation, 'science') || npc.faction === Faction.SCIENTIST) {
    weights.fetch += 16;
    weights.visit += 10;
  }
  if (
    ctx.roomType === RoomType.KITCHEN ||
    ctx.roomType === RoomType.MEDICAL ||
    ctx.roomType === RoomType.PRODUCTION ||
    ctx.roomType === RoomType.STORAGE ||
    ctx.roomType === RoomType.OFFICE
  ) weights.fetch += 18;
  if (npc.occupation === Occupation.CHILD) weights.kill = Math.max(3, weights.kill - 22);

  const total = weights.fetch + weights.visit + weights.kill + weights.talk;
  let r = Math.random() * total;
  for (const choice of ['fetch', 'visit', 'kill', 'talk'] as QuestChoice[]) {
    r -= weights[choice];
    if (r <= 0) return choice;
  }
  return 'fetch';
}

function contractScore(def: ContractDef, npc: Entity, ctx: QuestContext): number {
  let score = 0;
  if (def.target.floor === ctx.floor) score += 4;
  if (def.target.roomType !== undefined && def.target.roomType === ctx.roomType) score += 3;
  if (npc.faction === def.faction) score += 7;
  if (def.faction === Faction.CITIZEN && (npc.faction === Faction.CITIZEN || npc.faction === undefined)) score += 3;
  if (def.tags.includes('combat') && (ctx.samosborDanger || ctx.nearbyMonster || occupationHasProfileTag(npc.occupation, 'combat'))) score += 5;
  if (def.tags.includes('admin') && ctx.roomType === RoomType.OFFICE) score += 5;
  if (def.tags.includes('paper') && (ctx.roomType === RoomType.OFFICE || occupationHasProfileTag(npc.occupation, 'paper'))) score += 4;
  if (def.tags.includes('food') && ctx.roomType === RoomType.KITCHEN) score += 5;
  if (def.tags.includes('supply') && (ctx.roomType === RoomType.STORAGE || ctx.roomType === RoomType.KITCHEN)) score += 3;
  if (def.tags.includes('maintenance') && (ctx.roomType === RoomType.PRODUCTION || occupationHasProfileTag(npc.occupation, 'maintenance'))) score += 5;
  if (def.tags.includes('science') && (npc.faction === Faction.SCIENTIST || occupationHasProfileTag(npc.occupation, 'science'))) score += 6;
  if (def.tags.includes('cult') && (npc.faction === Faction.CULTIST || occupationHasProfileTag(npc.occupation, 'cult'))) score += 6;
  if (def.tags.includes('wild') && npc.faction === Faction.WILD) score += 6;
  if (def.tags.includes('black_market') && (ctx.roomName.includes('88') || ctx.roomName.includes('Толкучка') || occupationHasProfileTag(npc.occupation, 'black_market'))) score += 7;
  if (def.tags.includes('medicine') && (ctx.roomType === RoomType.MEDICAL || ctx.samosborDanger)) score += 4;
  if (def.rank > Math.max(1, ctx.zoneLevel + 1)) score -= 2;
  return score;
}

function proceduralReward(
  objectiveKind: QuestRewardObjectiveKind,
  npc: Entity,
  player: Entity,
  state: GameState,
  ctx: QuestContext,
  opts: {
    objectiveValue?: number;
    objectiveCount?: number;
    distance?: number;
    risk?: number;
    documentWork?: boolean;
    tags?: readonly string[];
  } = {},
) {
  const entry = currentFloorRunEntry(state);
  const playerRewardMult = player.rpg
    ? opts.documentWork ? intDocumentRewardMult(player.rpg) : intContractRewardMult(player.rpg)
    : 1;
  return calculateQuestReward({
    objectiveKind,
    objectiveValue: opts.objectiveValue,
    objectiveCount: opts.objectiveCount,
    currentZ: entry.z,
    targetZ: entry.z,
    routeDistance: opts.distance ?? 0,
    danger: floorRunEntryDanger(entry),
    plotPhase: 0,
    giverLevel: npc.rpg?.level ?? ctx.zoneLevel,
    giverWealth: getAlifeNpcTotalMoney(state, npc) ?? ((npc.money ?? 0) + (npc.accountRubles ?? 0)),
    giverFaction: npc.faction,
    risk: opts.risk ?? (ctx.samosborDanger ? 2 : 1),
    urgency: ctx.samosborDanger ? 1.2 : 1,
    playerRewardMult,
    tags: opts.tags,
  });
}

function questFromSystemContract(
  picked: ContractDef,
  npc: Entity,
  player: Entity,
  state: GameState,
): Quest {
  const quest = contractToQuest(picked, state.nextQuestId++, { id: npc.id, name: npc.name });
  prepareAcceptedContract(quest, state);
  applyContractRewardAtAcceptance(quest, picked, state, player, npc);
  return quest;
}

function pickSystemQuest(
  npc: Entity,
  player: Entity,
  ctx: QuestContext,
  state: GameState,
  preferredContractId?: string,
): Quest | null {
  if (preferredContractId) {
    const preferred = CONTRACTS.find(c => c.id === preferredContractId);
    if (!preferred || isContractHiddenForAssignment(preferred)) return null;
    if (state.quests.some(q => q.contractId === preferred.id)) return null;
    const quest = questFromSystemContract(preferred, npc, player, state);
    return assignProceduralQuestDeadline(quest, state.clock.totalMinutes, {
      samosborDanger: ctx.samosborDanger,
      nearbyMonster: ctx.nearbyMonster !== undefined,
      crossFloor: quest.targetFloor !== undefined && quest.targetFloor !== state.currentFloor,
    });
  }

  const assignedContracts = new Set<string>();
  for (let i = 0; i < state.quests.length; i++) {
    const q = state.quests[i];
    if (q.contractId) assignedContracts.add(q.contractId);
  }

  const scored: { def: ContractDef; score: number }[] = [];
  for (let i = 0; i < CONTRACTS.length; i++) {
    const c = CONTRACTS[i];
    if (isContractHiddenForAssignment(c)) continue;
    if (assignedContracts.has(c.id)) continue;

    const score = contractScore(c, npc, ctx) + Math.random() * 0.01;
    if (score > 0) {
      scored.push({ def: c, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  const top = scored.slice(0, Math.min(3, scored.length));
  const quest = questFromSystemContract(top[Math.floor(Math.random() * top.length)].def, npc, player, state);
  return assignProceduralQuestDeadline(quest, state.clock.totalMinutes, {
    samosborDanger: ctx.samosborDanger,
    nearbyMonster: ctx.nearbyMonster !== undefined,
    crossFloor: quest.targetFloor !== undefined && quest.targetFloor !== state.currentFloor,
  });
}

function shouldOfferSystemQuest(npc: Entity, ctx: QuestContext): boolean {
  let chance = 0.20;
  if (npc.faction === Faction.LIQUIDATOR || occupationHasProfileTag(npc.occupation, 'combat')) chance += 0.18;
  if (ctx.samosborDanger || ctx.nearbyMonster) chance += 0.12;
  if (ctx.roomType === RoomType.OFFICE || ctx.roomType === RoomType.STORAGE || ctx.roomType === RoomType.PRODUCTION) chance += 0.08;
  return Math.random() < Math.min(0.45, chance);
}

/* ── Generate quest based on NPC context ──────────────────────── */
function generateQuest(
  npc: Entity, player: Entity, world: World, entities: Entity[], state: GameState,
): Quest | null {
  // ── Story quest from PLOT_CHAIN ──
  if (isPlotNpc(npc)) {
    return generatePlotQuest(npc, world, entities, state);
  }

  const occ = npc.occupation;
  const ctx = buildQuestContext(npc, world, entities, state);
  const demosNotice = activeDemosQuestNoticeForGiver(state, npc.alifeId);
  if (demosNotice?.contractId) {
    const noticedQuest = pickSystemQuest(npc, player, ctx, state, demosNotice.contractId);
    if (noticedQuest) return noticedQuest;
    markDemosNoticeFailed(state, demosNotice.id, 'contract_unavailable');
  }
  if ((npc.age !== undefined && npc.age < 16) || npc.occupation === Occupation.CHILD) {
    const familyId = npc.familyId;
    if (familyId) {
      const parent = entities.find(e =>
        e.type === EntityType.NPC &&
        e.id !== npc.id &&
        e.familyId === familyId &&
        (e.age === undefined || e.age >= 16) &&
        e.occupation !== Occupation.CHILD
      );
      if (parent) {
        const dist2 = world.dist2(npc.x, npc.y, parent.x, parent.y);
        if (dist2 > 400) {
          const contract = CONTRACTS.find(c => c.id === 'lostchildescort');
          if (contract && !state.quests.some(q => q.contractId === 'lostchildescort' && !q.done)) {
            const quest = questFromSystemContract(contract, npc, player, state);
            quest.targetNpcId = parent.id;
            return assignProceduralQuestDeadline(quest, state.clock.totalMinutes, {
              samosborDanger: ctx.samosborDanger,
              nearbyMonster: ctx.nearbyMonster !== undefined,
              crossFloor: quest.targetFloor !== undefined && quest.targetFloor !== state.currentFloor,
            });
          }
        }
      }
    }
  }
  if (shouldOfferSystemQuest(npc, ctx)) {
    const systemQuest = pickSystemQuest(npc, player, ctx, state);
    if (systemQuest) return systemQuest;
  }

  const choice = pickQuestChoice(npc, ctx);

  if (choice === 'fetch') {
    const item = pickFetchItem(occ, npc, ctx);
    if (!item) return null;
    const def = ITEMS[item];
    if (!def) return null;
    const count = targetCountForItem(item, ctx);
    const reward = pickRewardItem(occ, ctx);
    const docWork = item === 'note' || item === 'book' || item === 'ballot' || ctx.roomType === RoomType.OFFICE;
    const rewardCalc = proceduralReward('fetch', npc, player, state, ctx, {
      objectiveValue: def.value ?? 10,
      objectiveCount: count,
      distance: 50,
      risk: ctx.samosborDanger ? 2 : 1,
      documentWork: docWork,
      tags: ['procedural', 'fetch'],
    });
    return assignProceduralQuestDeadline({
      id: state.nextQuestId++, type: QuestType.FETCH,
      giverId: npc.id, giverName: npc.name ?? '???',
      desc: `${npc.name}: «Принеси ${def.name} ×${count} в ${ctx.roomName}. Плата после сдачи; не тяни до сирены.»`,
      targetItem: item, targetCount: count,
      rewardItem: reward, rewardCount: 1, relationDelta: 10,
      difficulty: rewardCalc.difficulty, xpReward: rewardCalc.xpReward, moneyReward: rewardCalc.moneyReward,
      done: false,
    }, state.clock.totalMinutes, { samosborDanger: ctx.samosborDanger, nearbyMonster: ctx.nearbyMonster !== undefined });
  }

  if (choice === 'visit') {
    const room = pickVisitRoom(world, npc, preferredVisitRooms(npc, ctx));
    if (!room) return null;
    const dist = world.dist(npc.x, npc.y, room.x, room.y);
    const docWork = room.name.includes('архив') || room.name.includes('кабин') || preferredVisitRooms(npc, ctx).includes(RoomType.OFFICE);
    const rewardCalc = proceduralReward('visit', npc, player, state, ctx, {
      distance: dist,
      risk: ctx.samosborDanger ? 2 : 1,
      documentWork: docWork,
      tags: ['procedural', 'visit'],
    });
    return assignProceduralQuestDeadline({
      id: state.nextQuestId++, type: QuestType.VISIT,
      giverId: npc.id, giverName: npc.name ?? '???',
      desc: `${npc.name}: «Проверь ${room.name} ${toroidalDirection(world, npc.x, npc.y, room.x, room.y)}. Нужна отметка, не рассказ.»`,
      targetRoom: room.id,
      rewardItem: pickRewardItem(occ, ctx), rewardCount: 1, relationDelta: 8,
      difficulty: rewardCalc.difficulty, xpReward: rewardCalc.xpReward, moneyReward: rewardCalc.moneyReward,
      done: false,
    }, state.clock.totalMinutes, {
      samosborDanger: ctx.samosborDanger,
      nearbyMonster: ctx.nearbyMonster !== undefined,
      distance: dist,
    });
  }

  if (choice === 'kill') {
    const kind = pickKillKind(npc, ctx);
    const mdef = MONSTERS[kind];
    const killNeeded = ctx.samosborDanger && kind === MonsterKind.SBORKA ? 2 : 1;
    const rewardCalc = proceduralReward('kill', npc, player, state, ctx, {
      objectiveValue: 90 * monsterQuestScale(kind),
      objectiveCount: killNeeded,
      risk: Math.max(2, monsterQuestScale(kind)),
      tags: ['procedural', 'kill', 'combat'],
    });
    return assignProceduralQuestDeadline({
      id: state.nextQuestId++, type: QuestType.KILL,
      giverId: npc.id, giverName: npc.name ?? '???',
      desc: `${npc.name}: «Убей ${monsterQuestName(kind)}${mdef ? ` у ${ctx.roomName}` : ''}. Плата после тишины.»`,
      targetMonsterKind: kind, killCount: 0, killNeeded,
      rewardItem: pickRewardItem(occ, ctx), rewardCount: 1, relationDelta: 15,
      difficulty: rewardCalc.difficulty, xpReward: rewardCalc.xpReward, moneyReward: rewardCalc.moneyReward,
      done: false,
    }, state.clock.totalMinutes, { samosborDanger: ctx.samosborDanger, nearbyMonster: ctx.nearbyMonster !== undefined });
  }

  const target = pickTalkTarget(npc, world, entities);
  if (!target) return null;
  const dist = world.dist(npc.x, npc.y, target.x, target.y);
  const rewardCalc = proceduralReward('talk', npc, player, state, ctx, {
    distance: dist,
    risk: 1,
    tags: ['procedural', 'talk'],
  });
  return assignProceduralQuestDeadline({
    id: state.nextQuestId++, type: QuestType.TALK,
    giverId: npc.id, giverName: npc.name ?? '???',
    desc: `${npc.name}: «Передай ${target.name} сообщение. Он ${toroidalDirection(world, npc.x, npc.y, target.x, target.y)}; плата после ответа.»`,
    targetNpcId: target.id, targetNpcName: target.name,
    rewardItem: pickRewardItem(occ, ctx), rewardCount: 1, relationDelta: 12,
    difficulty: rewardCalc.difficulty, xpReward: rewardCalc.xpReward, moneyReward: rewardCalc.moneyReward,
    done: false,
  }, state.clock.totalMinutes, {
    samosborDanger: ctx.samosborDanger,
    nearbyMonster: ctx.nearbyMonster !== undefined,
    distance: dist,
  });
}

function pushUnique(pool: string[], items: readonly string[]): void {
  for (const item of items) if (ITEMS[item] && !pool.includes(item)) pool.push(item);
}

function pickFetchItem(occ: Occupation | undefined, npc: Entity, ctx: QuestContext): string | null {
  const pool: string[] = [];
  if (ctx.samosborDanger) pushUnique(pool, ['bandage', 'water', 'ammo_9mm', 'bread']);
  if (ctx.roomType === RoomType.KITCHEN) pushUnique(pool, ['water', 'bread', 'canned', 'kasha']);
  if (ctx.roomType === RoomType.MEDICAL) pushUnique(pool, ['bandage', 'pills', 'antidep', 'water']);
  if (ctx.roomType === RoomType.PRODUCTION) pushUnique(pool, ['pipe', 'wrench', 'rebar', 'door_kit']);
  if (ctx.roomType === RoomType.OFFICE) pushUnique(pool, ['note', 'book', 'ballot']);
  if (ctx.roomType === RoomType.STORAGE) pushUnique(pool, ['canned', 'pipe', 'ammo_9mm', 'flashlight']);
  if (npc.faction === Faction.CULTIST || occupationHasProfileTag(occ, 'cult')) {
    pushUnique(pool, ['idol_chernobog', 'strange_clot', 'cigs', 'govnyak_bad_batch']);
  }
  if (npc.faction === Faction.SCIENTIST || occupationHasProfileTag(occ, 'science')) pushUnique(pool, ['strange_clot', 'note', 'book', 'pills', 'govnyak_sample']);
  if (npc.faction === Faction.LIQUIDATOR || occupationHasProfileTag(occ, 'combat')) pushUnique(pool, ['ammo_9mm', 'bandage', 'canned']);
  pushUnique(pool, occupationQuestFetchItems(occ));
  pushUnique(pool, ['bread', 'water', 'bandage', 'cigs']);
  const available = pool.filter(item => !PROCEDURAL_FETCH_ITEM_BLOCKLIST.has(item));
  return available.length > 0 ? available[Math.floor(Math.random() * available.length)] : null;
}

function targetCountForItem(item: string, ctx: QuestContext): number {
  if (item.startsWith('govnyak_')) return 1;
  if (item === 'water' || item === 'bread' || item === 'cigs') return ctx.samosborDanger ? 3 : 2;
  if (item === 'note' || item === 'ballot') return 3;
  if (item.startsWith('ammo_')) return 10;
  return 1;
}

function pickRewardItem(occ?: Occupation, ctx?: QuestContext): string {
  const pool: string[] = [];
  if (ctx?.samosborDanger) pushUnique(pool, ['bandage', 'ammo_9mm', 'water']);
  if (ctx?.roomType === RoomType.OFFICE) pushUnique(pool, ['note', 'book', 'tea']);
  if (ctx?.roomType === RoomType.PRODUCTION) pushUnique(pool, ['wrench', 'pipe', 'flashlight']);
  pushUnique(pool, occupationQuestRewardItems(occ));
  pushUnique(pool, ['bread', 'water', 'bandage']);
  return pool[Math.floor(Math.random() * pool.length)];
}

function preferredVisitRooms(npc: Entity, ctx: QuestContext): RoomType[] {
  const profileRooms = occupationPreferredVisitRooms(npc.occupation);
  if (profileRooms.length > 0) return [...profileRooms];
  if (npc.faction === Faction.SCIENTIST) return [RoomType.MEDICAL, RoomType.OFFICE];
  if (ctx.samosborDanger) return [RoomType.HQ, RoomType.MEDICAL, RoomType.STORAGE];
  return [];
}

function pickVisitRoom(world: World, npc: Entity, preferred: RoomType[] = []): { id: number; name: string; x: number; y: number } | null {
  const allRooms = world.rooms.filter(r => r != null && r.type !== RoomType.CORRIDOR);
  const rooms = preferred.length > 0 ? allRooms.filter(r => preferred.includes(r.type)) : allRooms;
  if (rooms.length === 0) return null;
  // Pick a room at some distance
  const candidates = rooms.filter(r => world.dist(npc.x, npc.y, r.x + r.w / 2, r.y + r.h / 2) > 15);
  const pool = candidates.length > 0 ? candidates : rooms;
  const r = pool[Math.floor(Math.random() * pool.length)];
  return { id: r.id, name: r.name, x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

function pickKillKind(npc: Entity, ctx: QuestContext): MonsterKind {
  if (ctx.nearbyMonster?.monsterKind !== undefined) return ctx.nearbyMonster.monsterKind;
  if (npc.faction === Faction.LIQUIDATOR || occupationHasProfileTag(npc.occupation, 'combat')) {
    const pool = [MonsterKind.SBORKA, MonsterKind.TVAR, MonsterKind.POLZUN, MonsterKind.SHADOW];
    return pool[Math.floor(Math.random() * pool.length)];
  }
  if (ctx.roomType === RoomType.OFFICE) return MonsterKind.PECHATEED;
  if (ctx.roomType === RoomType.PRODUCTION) return MonsterKind.REBAR;
  if (ctx.samosborDanger) return MonsterKind.SBORKA;
  const pool = [MonsterKind.SBORKA, MonsterKind.TVAR, MonsterKind.POLZUN];
  return pool[Math.floor(Math.random() * pool.length)];
}

function monsterQuestScale(kind: MonsterKind): number {
  if (kind === MonsterKind.POLZUN || kind === MonsterKind.SHADOW || kind === MonsterKind.REBAR || kind === MonsterKind.PECHATEED) return 2.0;
  if (kind === MonsterKind.TVAR) return 1.5;
  return 1.0;
}

function monsterQuestName(kind: MonsterKind): string {
  if (kind === MonsterKind.SBORKA) return 'сборку';
  if (kind === MonsterKind.TVAR) return 'тварь';
  if (kind === MonsterKind.POLZUN) return 'ползуна';
  if (kind === MonsterKind.SHADOW) return 'теневика';
  if (kind === MonsterKind.REBAR) return 'арматуру';
  if (kind === MonsterKind.PECHATEED) return 'печатееда';
  return (MONSTERS[kind]?.name ?? 'монстра').toLowerCase();
}

function pickTalkTarget(npc: Entity, world: World, entities: Entity[]): Entity | null {
  const candidates = entities
    .filter(e => e.type === EntityType.NPC && e.alive && e.id !== npc.id)
    .map(e => {
      const f = e.faction === npc.faction ? -30 : 0;
      return { e, score: world.dist2(npc.x, npc.y, e.x, e.y) + f + Math.random() * 0.99 };
    })
    .sort((a, b) => a.score - b.score);
  if (candidates.length === 0) return null;
  const top = candidates.slice(0, Math.min(12, candidates.length)).map(c => c.e);
  return top[Math.floor(Math.random() * top.length)];
}
