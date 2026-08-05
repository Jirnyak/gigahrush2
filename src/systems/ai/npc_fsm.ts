/* ── NPC local utility executor: intent scoring + bounded actions ─ */

import {
  type Entity, type Msg,
  EntityType, AIGoal, RoomType, NpcState, Faction,
  ZoneFaction, Occupation, type GameClock, Cell, type TerritoryOwner, type Room,
} from '../../core/types';
import { World } from '../../core/world';
import { msg } from '../../core/types';
import { entityDisplayName } from '../../entities/monster';
import { WEAPON_STATS } from '../../data/catalog';
import { ENTITY_MASK_ACTOR, ensureEntityIndex } from '../entity_index';
import { isHostile } from '../factions';
import { stampUrineTraceCadenced } from '../urination';
import {
  followPath,
  findFamilyRoom,
  gotoNearestRoomOfTypes,
  gotoNearestRoomType,
  gotoRoom,
  tryAssignPathToCell,
  wanderNearby,
  wanderFar,
  wanderInRoom,
} from './pathfinding';
import { evaluateMicroStimuli, tickMicroGoal } from './micro_goals';
import {
  emitMarkovBark,
  BARK_CHANCE_HIDE,
  BARK_CHANCE_GENERIC,
} from './barks';
import { getRecentEvents } from '../events';
import { chooseNpcEmergencyDecision } from './npc_emergency';
import { tickNpcMemoryLowFrequency } from '../npc_memory';
import { tickNpcRumorLowFrequency } from '../rumor';
import { tickNpcSpecialRoutine } from '../npc_special_routines';
import { factionToTerritoryOwner } from '../../data/factions';
import {
  occupationHasAnyRoutineTag,
  occupationHasRoutineTag,
  occupationWorkRoomTypes,
} from '../../data/occupation_profiles';
import { territoryOwnerAtIndex, territoryRoomOwner } from '../territory';
import { cleanSurfaceArea } from '../surface_cleanup';
import { findMeatChunkCell, removeVisualSlotCode } from '../../gen/visual_cell_slots';
import {
  NPC_UTILITY_INTENTS,
  createNpcUtilityScoreBuffer,
  npcUtilityIdentityFromEntity,
  npcUtilityJitter01,
  npcUtilityRoomTypeWeightForIntent,
  scoreNpcUtilityTargetPreference,
  scoreNpcUtilities,
  selectNpcUtilityIntent,
  type NpcUtilityIntentId,
  type NpcUtilityTargetCandidate,
  type NpcUtilityThreatSnapshot,
} from './npc_utility';

export type NpcAiProfile = 'default' | 'ministry';

let _barkMsgs: Msg[] = [];
let _barkTime = 0;

export function setNpcContext(msgs: Msg[], time: number): void {
  _barkMsgs = msgs;
  _barkTime = time;
}

const UTILITY_THREAT_RADIUS = 16;
const UTILITY_THREAT_CAP = 32;
const UTILITY_SWITCH_MARGIN = 7;
const UTILITY_EMERGENCY_SCORE = 58;
const UTILITY_RETHINK_BASE_SEC = 1.5;
const UTILITY_RETHINK_SPREAD_SEC = 2.5;
const TERRITORY_ROOM_TARGET_SCAN_CAP = 96;
const ROUTINE_ROOM_CANDIDATE_CAP = 8;
const ROUTINE_LOCAL_ROOM_DISTANCE = 132;
const ROUTINE_SURVIVAL_ROOM_DISTANCE = 220;
const ROUTINE_TRAVELER_NEED_ROOM_DISTANCE = 280;
const NPC_TOILET_PEE_RATE = 20;
const NPC_TOILET_POO_RATE = 15;
const CLEANER_SURFACE_RADIUS = 1.35;
const CLEANER_SURFACE_RETRY_BASE_SEC = 2.5;
const CLEANER_SURFACE_RETRY_SPREAD_SEC = 2.5;
const emergencyLocalActors: Entity[] = [];
const utilityLocalActors: Entity[] = [];
const utilityScoreBuffer = createNpcUtilityScoreBuffer();
const routineFriendlyRoomCandidates: NpcUtilityTargetCandidate[] = [];
const routineFallbackRoomCandidates: NpcUtilityTargetCandidate[] = [];
const routineSeenRoomIds = new Set<number>();
const utilityIntentByNpc = new WeakMap<Entity, NpcUtilityIntentId>();
const utilityScoreByNpc = new WeakMap<Entity, number>();
const utilityNextDecisionAtByNpc = new WeakMap<Entity, number>();
const cleanerNextSurfaceAtByNpc = new WeakMap<Entity, number>();

function stableUnit(e: Entity, salt: string | number): number {
  return npcUtilityJitter01(npcUtilityIdentityFromEntity(e), salt);
}

function stableTimer(e: Entity, salt: string | number, base: number, spread: number): number {
  return base + stableUnit(e, salt) * spread;
}

function ownTerritoryOwner(e: Entity): TerritoryOwner | undefined {
  return e.faction === undefined ? undefined : factionToTerritoryOwner(e.faction);
}

function territoryFriendlyForNpc(e: Entity, owner: TerritoryOwner): boolean {
  const own = ownTerritoryOwner(e);
  if (own === undefined) return false;
  if (owner === own) return true;
  if (e.faction === Faction.SCIENTIST && owner === ZoneFaction.CITIZEN) return true;
  if (e.faction === Faction.CITIZEN && owner === ZoneFaction.SCIENTIST) return true;
  return false;
}

function usesTravelerRoutine(e: Entity): boolean {
  return e.isTraveler === true ||
    (e.isTraveler !== false && e.assignedRoomId === undefined && e.familyId === undefined && occupationHasRoutineTag(e.occupation, 'traveler'));
}

function isRoutineTrespassRelaxed(e: Entity): boolean {
  return usesTravelerRoutine(e) || occupationHasRoutineTag(e.occupation, 'patrol');
}

function routineIntentAllowsSurvivalTrespass(intent: NpcUtilityIntentId): boolean {
  return intent === 'toilet' || intent === 'drink' || intent === 'eat' || intent === 'sleep' || intent === 'heal';
}

function usesWildOpenUrinationRule(e: Entity): boolean {
  // Intentional rare faction hardcode: Wilds are the design experiment that makes
  // faction identity visible through in-place public urination instead of bathrooms.
  return e.faction === Faction.WILD;
}

function utilityRethinkInterval(e: Entity): number {
  return stableTimer(e, 'utility_rethink', UTILITY_RETHINK_BASE_SEC, UTILITY_RETHINK_SPREAD_SEC);
}

function hasActivePath(e: Entity): boolean {
  const ai = e.ai;
  return !!ai && ai.path.length > 0 && ai.pi < ai.path.length;
}

function canHoldRoutineFrame(e: Entity, intent: NpcUtilityIntentId): boolean {
  const ai = e.ai;
  if (!ai || ai.combatTargetId !== undefined || hasActivePath(e) || ai.timer <= 0) return false;
  return intent === 'work' || intent === 'social' || intent === 'patrol' || intent === 'wander';
}

function utilityIntentInterruptsActivePath(current: NpcUtilityIntentId, selected: NpcUtilityIntentId): boolean {
  if (selected === current) return false;
  if (selected === 'combat' || selected === 'flee') return true;
  if (selected === 'safety' || selected === 'heal') return current !== 'safety' && current !== 'flee' && current !== 'combat';
  return false;
}

function preferredEmergencyRoomId(world: World, e: Entity): number | undefined {
  const familyRoomId = usesTravelerRoutine(e) ? -1 : findFamilyRoom(world, e, RoomType.LIVING);
  if (familyRoomId >= 0) return familyRoomId;
  if (e.assignedRoomId !== undefined && e.assignedRoomId >= 0) return e.assignedRoomId;
  return undefined;
}

function tryAssignEmergencyShelterPath(
  world: World,
  _entities: readonly Entity[],
  e: Entity,
  clock?: GameClock,
  shelterRoomIds?: readonly number[],
): boolean {
  const ai = e.ai!;
  const homeRoomId = preferredEmergencyRoomId(world, e);
  const assignedRoomId = e.assignedRoomId !== undefined && e.assignedRoomId >= 0 ? e.assignedRoomId : undefined;
  const preferredRoomIds = assignedRoomId !== undefined && assignedRoomId !== homeRoomId ? [assignedRoomId] : undefined;
  const nearbyRadius = 18 + Math.floor(stableUnit(e, 'emergency_radius') * 8);
  ensureEntityIndex(_entities).queryRadiusCapped(e.x, e.y, nearbyRadius, emergencyLocalActors, ENTITY_MASK_ACTOR, 64);
  const decision = chooseNpcEmergencyDecision(world, e, {
    phase: 'active',
    homeRoomId,
    preferredRoomIds,
    localActors: emergencyLocalActors,
    localActorCap: 16,
    shelterRoomIds,
    candidateCap: 8,
    nearbyRadius,
    nearbyRoomCap: 8,
    seedSalt: Math.floor((clock?.totalMinutes ?? 0) / 30),
  });
  if (decision.targetRoomId < 0) return false;

  ai.goal = AIGoal.HIDE;
  ai.tx = decision.targetCellX;
  ai.ty = decision.targetCellY;
  ai.path = [];
  ai.pi = 0;
  ai.stuck = 0;
  const status = tryAssignPathToCell(world, e, decision.targetCellX, decision.targetCellY);
  if (status === 'not_found') {
    ai.timer = 0;
    return false;
  }
  ai.timer = Math.max(0.75, decision.rethinkAfterSec);
  return true;
}

function initialIntentForNpc(e: Entity, samosborActive: boolean, profile: NpcAiProfile): NpcUtilityIntentId {
  if (samosborActive && e.faction !== Faction.LIQUIDATOR && e.faction !== Faction.CULTIST && e.faction !== Faction.WILD) {
    return 'safety';
  }
  if (usesTravelerRoutine(e)) return 'wander';
  if (e.faction === Faction.LIQUIDATOR || occupationHasRoutineTag(e.occupation, 'patrol')) return 'patrol';
  if (profile === 'ministry' && (e.assignedRoomId !== undefined || occupationHasAnyRoutineTag(e.occupation, ['admin', 'paperwork']))) {
    return 'work';
  }
  return 'wander';
}

function stateForIntent(intent: NpcUtilityIntentId, e: Entity, profile: NpcAiProfile): NpcState {
  switch (intent) {
    case 'safety':
    case 'flee':
      return NpcState.HIDING;
    case 'sleep':
      return NpcState.SLEEPING;
    case 'toilet':
      return NpcState.MORNING;
    case 'drink':
    case 'eat':
      return NpcState.LUNCH;
    case 'work':
      return NpcState.WORKING;
    case 'social':
      return profile === 'ministry' ? NpcState.MEETING : NpcState.FREE_TIME;
    case 'combat':
    case 'patrol':
      return NpcState.PATROL;
    case 'wander':
      return usesTravelerRoutine(e) ? NpcState.TRAVELING : NpcState.FREE_TIME;
    case 'heal':
      return NpcState.FREE_TIME;
  }
}

function goalForIntent(intent: NpcUtilityIntentId): AIGoal {
  switch (intent) {
    case 'safety': return AIGoal.HIDE;
    case 'flee': return AIGoal.FLEE;
    case 'toilet': return AIGoal.TOILET;
    case 'drink': return AIGoal.DRINK;
    case 'eat': return AIGoal.EAT;
    case 'sleep': return AIGoal.SLEEP;
    case 'work': return AIGoal.WORK;
    case 'heal': return AIGoal.GOTO;
    case 'combat': return AIGoal.HUNT;
    case 'social':
    case 'patrol':
    case 'wander':
      return AIGoal.WANDER;
  }
}

function enterUtilityIntent(e: Entity, intent: NpcUtilityIntentId, score: number, profile: NpcAiProfile): void {
  const ai = e.ai!;
  const previousIntent = utilityIntentByNpc.get(e);
  const nextState = stateForIntent(intent, e, profile);
  const changed = previousIntent !== intent || ai.npcState !== nextState;

  utilityIntentByNpc.set(e, intent);
  utilityScoreByNpc.set(e, score);
  if (!changed) return;

  ai.npcState = nextState;
  ai.stateTimer = 0;
  if (ai.combatTargetId !== undefined) return;

  ai.goal = goalForIntent(intent);
  ai.path = [];
  ai.pi = 0;
  ai.stuck = 0;
  ai.timer = 0;
}

function clearUtilityState(e: Entity): void {
  utilityIntentByNpc.delete(e);
  utilityScoreByNpc.delete(e);
  utilityNextDecisionAtByNpc.delete(e);
}

export function primeNpcAlifeState(
  e: Entity,
  clock: GameClock,
  samosborActive: boolean,
  profile: NpcAiProfile = 'default',
): void {
  const ai = e.ai;
  if (!ai) return;
  const special = tickNpcSpecialRoutine(e, clock);
  if (special.clearUtility) clearUtilityState(e);
  if (special.held) return;
  if (utilityIntentByNpc.get(e) === undefined || ai.npcState === undefined) {
    const intent = initialIntentForNpc(e, samosborActive, profile);
    enterUtilityIntent(e, intent, 0, profile);
  }
}

/* ── NPC behavior: local utility selection with bounded execution ─ */
export function updateNPC(
  world: World,
  entities: Entity[],
  e: Entity,
  dt: number,
  time: number,
  clock: GameClock,
  samosborActive: boolean,
  profile: NpcAiProfile = 'default',
  state?: import('../../core/types').GameState,
): void {
  const ai = e.ai!;

  const special = tickNpcSpecialRoutine(e, clock);
  if (special.clearUtility) {
    ai.stateTimer = 0;
    clearUtilityState(e);
  }

  if (state) {
    const sinceId = ai.lastSeenUrinationId ?? 0;
    const events = getRecentEvents(state, { type: 'player_urinated', sinceId, limit: 1 });
    if (events.length > 0) {
      const event = events[0];
      if (event.id > sinceId) {
        ai.lastSeenUrinationId = event.id;
        if (event.x !== undefined && event.y !== undefined) {
          const dist2 = world.dist2(e.x, e.y, event.x, event.y);
          if (dist2 <= 64 && e.faction !== Faction.WILD) {
            const isBathroom = event.roomId !== undefined && world.rooms[event.roomId]?.type === RoomType.BATHROOM;
            if (!isBathroom) {
              e.playerRelation = (e.playerRelation ?? 0) - 15;
            }
          }
        }
      }
    } else if (state.worldEvents) {
      ai.lastSeenUrinationId = Math.max(sinceId, state.worldEvents.nextId - 1);
    }
  }
  if (special.held) {
    return;
  }

  evaluateMicroStimuli(world, e, time, _barkMsgs);
  if (tickMicroGoal(world, entities, e, dt, time, _barkMsgs)) {
    return;
  }

  if (utilityIntentByNpc.get(e) === undefined || ai.npcState === undefined) {
    enterUtilityIntent(e, initialIntentForNpc(e, samosborActive, profile), 0, profile);
  }

  const decision = selectAndEnterUtilityIntent(world, entities, e, clock, samosborActive, profile);
  const intent = decision.intent;

  ai.timer -= dt;
  ai.stateTimer = (ai.stateTimer ?? 0) + dt;

  if (!decision.rescored && canHoldRoutineFrame(e, intent)) {
    if (intent === 'work') tryCleanerSurfaceWork(world, e);
    tickNpcMemoryLowFrequency(e, time, clock.totalMinutes, samosborActive);
    tickNpcRumorLowFrequency(e, time, clock.totalMinutes, samosborActive);
    tryAmbientBark(e, dt, samosborActive);
    return;
  }

  applyRoomRestoration(world, e, dt, time, profile);

  switch (intent) {
    case 'safety':
    case 'flee':
      handleHiding(world, entities, e, dt, clock, profile);
      break;
    case 'toilet':
      handleToilet(world, e, dt, time);
      break;
    case 'drink':
      handleDrink(world, e, dt);
      break;
    case 'eat':
      handleEat(world, e, dt);
      break;
    case 'sleep':
      handleSleeping(world, e, dt, profile);
      break;
    case 'work':
      handleWorking(world, e, dt, profile);
      break;
    case 'heal':
      handleHeal(world, e, dt);
      break;
    case 'social':
      handleSocial(world, e, dt, profile);
      break;
    case 'combat':
    case 'patrol':
      handlePatrol(world, e, dt);
      break;
    case 'wander':
      handleWander(world, e, dt);
      break;
  }

  tickNpcMemoryLowFrequency(e, time, clock.totalMinutes, samosborActive);
  tickNpcRumorLowFrequency(e, time, clock.totalMinutes, samosborActive);
  tryAmbientBark(e, dt, samosborActive);
}

function selectAndEnterUtilityIntent(
  world: World,
  entities: readonly Entity[],
  e: Entity,
  clock: GameClock,
  samosborActive: boolean,
  profile: NpcAiProfile,
): { intent: NpcUtilityIntentId; rescored: boolean } {
  const currentIntent = utilityIntentByNpc.get(e);
  const now = _barkTime;
  if (currentIntent !== undefined && (utilityNextDecisionAtByNpc.get(e) ?? -Infinity) > now) {
    return { intent: currentIntent, rescored: false };
  }

  const scores = scoreNpcUtilities({
    identity: npcUtilityIdentityFromEntity(e),
    minuteOfDay: clock.hour * 60 + clock.minute,
    totalMinutes: clock.totalMinutes,
    samosborActive,
    currentIntent,
    currentIntentStickiness: 5 + Math.min(7, (e.ai?.stateTimer ?? 0) * 0.18),
    needs: e.needs,
    hp: e.hp,
    maxHp: e.maxHp,
    threat: buildThreatSnapshot(world, entities, e),
    role: {
      faction: e.faction,
      occupation: e.occupation,
      armed: npcIsArmed(e),
      hasRangedWeapon: npcHasRangedWeapon(e),
      isTraveler: usesTravelerRoutine(e),
    },
    local: buildLocalUtilityScores(world, e, samosborActive, profile),
  }, utilityScoreBuffer);
  const selected = selectNpcUtilityIntent(scores, currentIntent, {
    switchMargin: UTILITY_SWITCH_MARGIN,
    emergencyScore: UTILITY_EMERGENCY_SCORE,
  });
  if (
    currentIntent !== undefined &&
    hasActivePath(e) &&
    !utilityIntentInterruptsActivePath(currentIntent, selected.intent)
  ) {
    utilityNextDecisionAtByNpc.set(e, now + utilityRethinkInterval(e));
    return { intent: currentIntent, rescored: true };
  }
  enterUtilityIntent(e, selected.intent, selected.score, profile);
  utilityNextDecisionAtByNpc.set(e, now + utilityRethinkInterval(e));
  return { intent: selected.intent, rescored: true };
}

function buildLocalUtilityScores(
  world: World,
  e: Entity,
  samosborActive: boolean,
  profile: NpcAiProfile,
): Partial<Record<NpcUtilityIntentId, number>> {
  const local: Partial<Record<NpcUtilityIntentId, number>> = {};
  const room = world.roomAt(e.x, e.y);
  const cellOwner = territoryOwnerAtIndex(world, world.idx(Math.floor(e.x), Math.floor(e.y)));
  if (cellOwner === ZoneFaction.SAMOSBOR) {
    addLocalScore(local, 'safety', e.faction === Faction.CULTIST ? -5 : 14);
    addLocalScore(local, 'wander', -10);
    addLocalScore(local, 'work', -8);
    addLocalScore(local, 'social', -6);
  } else if (territoryFriendlyForNpc(e, cellOwner)) {
    addLocalScore(local, 'work', 4);
    addLocalScore(local, 'social', 4);
    addLocalScore(local, 'wander', usesTravelerRoutine(e) ? 0 : 5);
    addLocalScore(local, 'patrol', 5);
  } else if (e.faction !== undefined) {
    addLocalScore(local, 'work', -5);
    addLocalScore(local, 'social', -4);
    addLocalScore(local, 'wander', usesTravelerRoutine(e) ? 4 : -6);
    addLocalScore(local, 'patrol', 7);
  }
  if (room) {
    for (const intent of NPC_UTILITY_INTENTS) {
      const weight = npcUtilityRoomTypeWeightForIntent(intent, room.type, e.occupation);
      if (weight > 0) addLocalScore(local, intent, Math.min(10, weight * 0.18));
    }
    if (room.id === e.assignedRoomId) {
      addLocalScore(local, 'work', profile === 'ministry' ? 14 : 9);
      addLocalScore(local, 'safety', 4);
    }
    if (profile === 'ministry' && (room.type === RoomType.COMMON || room.type === RoomType.HQ)) {
      addLocalScore(local, 'social', 5);
    }
  }

  if (usesTravelerRoutine(e)) {
    addLocalScore(local, 'wander', 12);
    addLocalScore(local, 'work', -8);
  }
  if (e.faction === Faction.LIQUIDATOR || occupationHasRoutineTag(e.occupation, 'patrol')) addLocalScore(local, 'patrol', 10);
  if (e.faction === Faction.WILD) addLocalScore(local, 'wander', 6);
  if (samosborActive) {
    if (e.faction === Faction.LIQUIDATOR) {
      addLocalScore(local, 'patrol', 12);
      addLocalScore(local, 'safety', -8);
    } else if (e.faction === Faction.CULTIST) {
      addLocalScore(local, 'social', 8);
      addLocalScore(local, 'safety', -5);
    } else {
      addLocalScore(local, 'safety', 16);
    }
  }
  return local;
}

function addLocalScore(local: Partial<Record<NpcUtilityIntentId, number>>, intent: NpcUtilityIntentId, amount: number): void {
  local[intent] = (local[intent] ?? 0) + amount;
}

function buildThreatSnapshot(world: World, entities: readonly Entity[], e: Entity): NpcUtilityThreatSnapshot {
  utilityLocalActors.length = 0;
  ensureEntityIndex(entities).queryRadiusCapped(e.x, e.y, UTILITY_THREAT_RADIUS, utilityLocalActors, ENTITY_MASK_ACTOR, UTILITY_THREAT_CAP);
  let visibleHostiles = 0;
  let hostilePower = 0;
  let allyPower = actorPower(e) * 0.35;
  let monsterPressure = 0;
  let nearest = Infinity;

  for (const other of utilityLocalActors) {
    if (other.id === e.id || !other.alive) continue;
    const d = Math.sqrt(world.dist2(e.x, e.y, other.x, other.y));
    if (isHostile(e, other)) {
      visibleHostiles++;
      hostilePower += actorPower(other);
      if (other.type === EntityType.MONSTER) monsterPressure = Math.max(monsterPressure, 1);
      if (d < nearest) nearest = d;
    } else if (other.faction !== undefined && other.faction === e.faction) {
      allyPower += actorPower(other) * 0.25;
    }
  }

  const close = Number.isFinite(nearest) ? clamp01((UTILITY_THREAT_RADIUS - nearest) / UTILITY_THREAT_RADIUS) : 0;
  const danger = clamp01(visibleHostiles * 0.18 + close * 0.42 + monsterPressure * 0.32);
  return {
    danger,
    visibleHostiles,
    hostilePower,
    allyPower,
    distance: Number.isFinite(nearest) ? nearest : undefined,
    monster: monsterPressure,
    strongerHostile: hostilePower > allyPower + 0.15,
  };
}

function actorPower(e: Entity): number {
  const ws = WEAPON_STATS[e.weapon ?? ''] ?? WEAPON_STATS[''];
  const weapon = ws ? (ws.isRanged ? ws.dmg * (ws.pellets ?? 1) * 1.6 : ws.dmg) : 0;
  const hp = Math.max(0, e.hp ?? 20) * 0.22;
  const level = Math.max(1, e.rpg?.level ?? 1) * 3;
  return hp + weapon + level;
}

function npcIsArmed(e: Entity): boolean {
  const ws = WEAPON_STATS[e.weapon ?? ''];
  return !!ws && (ws.dmg > 3 || ws.isRanged);
}

function npcHasRangedWeapon(e: Entity): boolean {
  return WEAPON_STATS[e.weapon ?? '']?.isRanged === true;
}

function applyRoomRestoration(world: World, e: Entity, dt: number, time: number, profile: NpcAiProfile): void {
  const n = e.needs;
  const currentRoom = world.roomAt(e.x, e.y);
  if (!n || !currentRoom) return;

  if (currentRoom.type === RoomType.KITCHEN) {
    n.food = Math.min(100, n.food + 8 * dt);
    n.water = Math.min(100, n.water + 10 * dt);
    n.pendingPoo = (n.pendingPoo ?? 0) + 8 * 0.7 * dt;
    n.pendingPee = (n.pendingPee ?? 0) + 8 * 0.3 * dt + 10 * 0.6 * dt;
  }
  if (currentRoom.type === RoomType.BATHROOM) {
    n.water = Math.min(100, n.water + 12 * dt);
    n.pendingPee = (n.pendingPee ?? 0) + 12 * 0.6 * dt;
    applyNpcUrineRelief(world, e, dt, time, 0.72, 0.18);
    n.poo = Math.max(0, n.poo - NPC_TOILET_POO_RATE * dt);
  }
  if (currentRoom.type === RoomType.MEDICAL && e.hp !== undefined && e.maxHp !== undefined) {
    e.hp = Math.min(e.maxHp, e.hp + 3 * dt);
  }
  if (utilityIntentByNpc.get(e) === 'sleep') {
    const sleepRoom = profile === 'ministry'
      ? currentRoom.type === RoomType.OFFICE || currentRoom.type === RoomType.LIVING
      : currentRoom.type === RoomType.LIVING || currentRoom.type === RoomType.OFFICE;
    if (sleepRoom) n.sleep = Math.min(100, n.sleep + (profile === 'ministry' ? 4 : 6) * dt);
  }
}

function tryAmbientBark(e: Entity, dt: number, samosborActive: boolean): void {
  const ai = e.ai!;
  ai.ambientBarkCd = Math.max(0, (ai.ambientBarkCd ?? (10 + Math.random() * 12)) - dt);
  if (ai.ambientBarkCd > 0) return;

  ai.ambientBarkCd = 18 + Math.random() * 28;
  if (samosborActive) return;
  if (ai.npcState === NpcState.SLEEPING || ai.npcState === NpcState.HIDING) return;
  if (ai.goal === AIGoal.FLEE || ai.goal === AIGoal.HIDE || ai.goal === AIGoal.HUNT) return;

  emitMarkovBark(e, _barkMsgs, _barkTime, 'ambient', '...', BARK_CHANCE_GENERIC, '#9ba');
}

/* ── Intent handlers ─────────────────────────────────────────── */

function handleSleeping(world: World, e: Entity, dt: number, profile: NpcAiProfile): void {
  const ai = e.ai!;
  if (ai.goal === AIGoal.IDLE || ai.timer <= 0) {
    ai.goal = AIGoal.SLEEP;
    if (profile === 'ministry') {
      if (!gotoRoutineRoomOfTypes(world, e, [RoomType.OFFICE, RoomType.LIVING], 'sleep', { preferredRoomId: e.assignedRoomId, allowTrespassFallback: true })) {
        wanderNearby(world, e);
      }
    } else {
      const targetRoom = findFamilyRoom(world, e, RoomType.LIVING);
      if (!gotoRoutineRoomOfTypes(world, e, [RoomType.LIVING, RoomType.OFFICE], 'sleep', { preferredRoomId: targetRoom, allowTrespassFallback: true })) {
        wanderNearby(world, e);
      }
    }
    ai.timer = stableTimer(e, 'sleep_rethink', 8, 5);
  }

  if (ai.goal === AIGoal.SLEEP && ai.path.length === 0) {
    const cr = world.roomAt(e.x, e.y);
    if (cr && (cr.type === RoomType.LIVING || cr.type === RoomType.OFFICE)) {
      wanderInRoom(world, e);
      ai.timer = stableTimer(e, 'sleep_in_room', 8, 12);
    }
  }

  followPath(world, e, dt);
}

function applyNpcUrineRelief(
  world: World,
  e: Entity,
  dt: number,
  time: number,
  streamLength: number,
  intervalSeconds: number,
): void {
  const n = e.needs;
  if (!n || n.pee <= 0) return;
  const before = n.pee;
  if (before > 5) {
    stampUrineTraceCadenced(world, e, time, {
      pressure: before / 100,
      streamLength,
      intervalSeconds,
      streamSteps: before > 60 ? 18 : 14,
      width: 0.05,
      dropCount: 1,
    });
  }
  n.pee = Math.max(0, before - NPC_TOILET_PEE_RATE * dt);
}

function handleWildOpenUrination(world: World, e: Entity, dt: number, time: number): boolean {
  const ai = e.ai!;
  const n = e.needs;
  if (!n || !usesWildOpenUrinationRule(e) || n.pee <= 15) return false;
  ai.goal = AIGoal.IDLE;
  ai.path = [];
  ai.pi = 0;
  ai.stuck = 0;
  ai.timer = 0.25;
  applyNpcUrineRelief(world, e, dt, time, 0.95, 0.16);
  return true;
}

function handleToilet(world: World, e: Entity, dt: number, time: number): void {
  const ai = e.ai!;
  const n = e.needs;
  if (handleWildOpenUrination(world, e, dt, time)) return;
  if (ai.timer <= 0 || ai.goal === AIGoal.IDLE) {
    ai.goal = AIGoal.TOILET;
    if (!gotoRoutineRoomOfTypes(world, e, [RoomType.BATHROOM], 'toilet', { allowTrespassFallback: true })) wanderNearby(world, e);
    ai.timer = stableTimer(e, 'toilet_rethink', 7, 5);
  }
  if (n) {
    const cr = world.roomAt(e.x, e.y);
    if (cr && cr.type === RoomType.BATHROOM && n.pee < 15 && n.poo < 15) {
      ai.goal = AIGoal.IDLE;
      ai.timer = 0.5;
    }
  }

  if (ai.goal === AIGoal.TOILET && ai.path.length === 0) {
    const cr = world.roomAt(e.x, e.y);
    if (cr && cr.type === RoomType.BATHROOM) {
      wanderInRoom(world, e);
      ai.timer = stableTimer(e, 'toilet_in_room', 6, 10);
    }
  }

  followPath(world, e, dt);
}

function handleDrink(world: World, e: Entity, dt: number): void {
  const ai = e.ai!;
  const n = e.needs;
  if (ai.timer <= 0 || ai.goal === AIGoal.IDLE) {
    ai.goal = AIGoal.DRINK;
    if (!gotoRoutineRoomOfTypes(world, e, [RoomType.KITCHEN, RoomType.BATHROOM], 'drink', { allowTrespassFallback: true })) wanderNearby(world, e);
    ai.timer = stableTimer(e, 'drink_rethink', 8, 6);
  }
  if (n) {
    const cr = world.roomAt(e.x, e.y);
    if ((cr?.type === RoomType.KITCHEN || cr?.type === RoomType.BATHROOM) && n.water > 82) {
      ai.goal = AIGoal.IDLE;
      ai.timer = 0.5;
    }
  }

  if (ai.goal === AIGoal.DRINK && ai.path.length === 0) {
    const cr = world.roomAt(e.x, e.y);
    if (cr && (cr.type === RoomType.KITCHEN || cr.type === RoomType.BATHROOM)) {
      wanderInRoom(world, e);
      ai.timer = stableTimer(e, 'drink_in_room', 6, 10);
    }
  }

  followPath(world, e, dt);
}

function handleEat(world: World, e: Entity, dt: number): void {
  const ai = e.ai!;
  const n = e.needs;
  
  if (n && n.food < 15 && (e.faction === Faction.WILD || e.faction === Faction.CULTIST || Math.random() < 0.05)) {
    const chunkCell = findMeatChunkCell(world, e.x, e.y, 16);
    if (chunkCell) {
      ai.goal = AIGoal.EAT;
      if (world.dist2(e.x, e.y, chunkCell.x, chunkCell.y) <= 1.35 * 1.35) {
        removeVisualSlotCode(world, world.idx(chunkCell.x, chunkCell.y), 34);
        n.food = Math.min(100, n.food + 35);
        _barkMsgs.push(msg(`${entityDisplayName(e)} сожрал кусок мяса`, _barkTime, '#c44'));
        ai.path = [];
        ai.pi = 0;
        ai.timer = 2;
        return;
      }
      if (ai.path.length === 0 || ai.tx !== chunkCell.x || ai.ty !== chunkCell.y) {
        tryAssignPathToCell(world, e, chunkCell.x, chunkCell.y);
      }
      followPath(world, e, dt);
      return;
    }
  }

  if (ai.timer <= 0 || ai.goal === AIGoal.IDLE) {
    ai.goal = AIGoal.EAT;
    if (!gotoRoutineRoomOfTypes(world, e, [RoomType.KITCHEN, RoomType.COMMON], 'eat', { allowTrespassFallback: true })) wanderNearby(world, e);
    ai.timer = stableTimer(e, 'eat_rethink', 10, 8);
  }
  if (n) {
    const cr = world.roomAt(e.x, e.y);
    if ((cr?.type === RoomType.KITCHEN || cr?.type === RoomType.COMMON) && n.food > 82) {
      ai.goal = AIGoal.IDLE;
      ai.timer = 0.5;
    }
  }

  if (ai.goal === AIGoal.EAT && ai.path.length === 0) {
    const cr = world.roomAt(e.x, e.y);
    if (cr && (cr.type === RoomType.KITCHEN || cr.type === RoomType.COMMON)) {
      wanderInRoom(world, e);
      ai.timer = stableTimer(e, 'eat_in_room', 8, 12);
    }
  }

  followPath(world, e, dt);
}

function handleWorking(world: World, e: Entity, dt: number, profile: NpcAiProfile): void {
  const ai = e.ai!;
  tryCleanerSurfaceWork(world, e);
  if (ai.timer <= 0 || ai.goal === AIGoal.IDLE) {
    ai.goal = AIGoal.WORK;
    if (profile === 'ministry') {
      if (!tryGotoAssignedWorkRoom(world, e) && !gotoRoutineRoomOfTypes(world, e, [RoomType.OFFICE, RoomType.COMMON], 'work')) {
        wanderNearby(world, e);
      }
    } else if (!tryGotoAssignedWorkRoom(world, e)) {
      const types = occupationWorkRoomTypes(e.occupation);
      if (!gotoRoutineRoomOfTypes(world, e, types, 'work')) wanderNearby(world, e);
    }
    ai.timer = stableTimer(e, 'work_rethink', 14, 18);
  }

  if (ai.goal === AIGoal.WORK && ai.path.length === 0) {
    const cr = world.roomAt(e.x, e.y);
    if (cr && (cr.id === e.assignedRoomId || npcUtilityRoomTypeWeightForIntent('work', cr.type, e.occupation) > 0)) {
      wanderInRoom(world, e);
      ai.timer = stableTimer(e, 'work_in_room', 7, 13);
    }
  }

  followPath(world, e, dt);
}

function cleanerCanCleanCell(world: World, e: Entity, idx: number): boolean {
  if (territoryFriendlyForNpc(e, territoryOwnerAtIndex(world, idx))) return true;
  const roomId = world.roomMap[idx];
  if (roomId < 0) return false;
  if (roomId === e.assignedRoomId) return true;
  const room = world.rooms[roomId];
  return !!room && e.familyId !== undefined && e.familyId >= 0 && room.apartmentId === e.familyId;
}

function tryCleanerSurfaceWork(world: World, e: Entity): void {
  if (e.occupation !== Occupation.CLEANER && !occupationHasRoutineTag(e.occupation, 'cleaning')) return;
  const now = _barkTime;
  if ((cleanerNextSurfaceAtByNpc.get(e) ?? -Infinity) > now) return;
  cleanerNextSurfaceAtByNpc.set(e, now + stableTimer(e, 'cleaner_surface', CLEANER_SURFACE_RETRY_BASE_SEC, CLEANER_SURFACE_RETRY_SPREAD_SEC));
  const cleaned = cleanSurfaceArea(world, e.x, e.y, CLEANER_SURFACE_RADIUS, {
    shouldCleanCell: idx => cleanerCanCleanCell(world, e, idx),
  });
  if (cleaned <= 0 || !e.ai) return;
  e.ai.goal = AIGoal.WORK;
  e.ai.timer = Math.max(e.ai.timer, 0.4);
}

function handleHeal(world: World, e: Entity, dt: number): void {
  const ai = e.ai!;
  if (e.hp !== undefined && e.maxHp !== undefined && e.hp >= e.maxHp * 0.92) {
    ai.goal = AIGoal.IDLE;
    ai.timer = 0.5;
    followPath(world, e, dt);
    return;
  }
  if (ai.timer <= 0 || ai.goal === AIGoal.IDLE) {
    ai.goal = AIGoal.GOTO;
    if (!gotoRoutineRoomOfTypes(world, e, [RoomType.MEDICAL], 'heal', { allowTrespassFallback: true })) wanderNearby(world, e);
    ai.timer = stableTimer(e, 'heal_rethink', 9, 8);
  }

  if (ai.goal === AIGoal.GOTO && ai.path.length === 0) {
    const cr = world.roomAt(e.x, e.y);
    if (cr && cr.type === RoomType.MEDICAL) {
      wanderInRoom(world, e);
      ai.timer = stableTimer(e, 'heal_in_room', 8, 12);
    }
  }

  followPath(world, e, dt);
}

function handleSocial(world: World, e: Entity, dt: number, profile: NpcAiProfile): void {
  const ai = e.ai!;
  if (ai.timer <= 0 || ai.goal === AIGoal.IDLE) {
    ai.goal = AIGoal.WANDER;
    const types = profile === 'ministry'
      ? [RoomType.COMMON, RoomType.HQ, RoomType.OFFICE] as const
      : [RoomType.COMMON, RoomType.SMOKING, RoomType.KITCHEN] as const;
    if (!gotoRoutineRoomOfTypes(world, e, types, 'social')) wanderNearby(world, e);
    ai.timer = stableTimer(e, 'social_rethink', 8, 12);
  }
  if (ai.path.length === 0) {
    const cr = world.roomAt(e.x, e.y);
    if (cr && (cr.type === RoomType.COMMON || cr.type === RoomType.SMOKING || cr.type === RoomType.KITCHEN || cr.type === RoomType.HQ)) {
      wanderInRoom(world, e);
      ai.timer = stableTimer(e, 'social_in_room', 6, 10);
    }
  }
  followPath(world, e, dt);
}

function handlePatrol(world: World, e: Entity, dt: number): void {
  const ai = e.ai!;
  if (ai.timer <= 0 || ai.goal === AIGoal.IDLE) {
    ai.goal = AIGoal.WANDER;
    patrolCorridor(world, e);
    ai.timer = stableTimer(e, 'patrol_rethink', 9, 14);
  }
  followPath(world, e, dt);
}

function handleWander(world: World, e: Entity, dt: number): void {
  const ai = e.ai!;
  if (ai.timer <= 0 || ai.goal === AIGoal.IDLE) {
    ai.goal = AIGoal.WANDER;
    if (usesTravelerRoutine(e)) {
      wanderFar(world, e);
      ai.timer = stableTimer(e, 'traveler_rethink', 10, 20);
    } else {
      const roll = stableUnit(e, `wander:${Math.floor((ai.stateTimer ?? 0) / 15)}`);
      const routed = roll < 0.68 && gotoRoutineRoomOfTypes(world, e, [RoomType.COMMON, RoomType.KITCHEN, RoomType.HQ], 'wander');
      if (!routed) {
        wanderNearby(world, e);
      }
      ai.timer = stableTimer(e, 'wander_rethink', 7, 12);
    }
  }
  followPath(world, e, dt);
}

function gotoAssignedOrNearest(world: World, e: Entity, fallbackType: RoomType): void {
  if (e.assignedRoomId !== undefined && e.assignedRoomId >= 0 && world.rooms[e.assignedRoomId]) {
    gotoRoom(world, e, e.assignedRoomId);
  } else if (!gotoNearestRoomType(world, e, fallbackType)) {
    wanderNearby(world, e);
  }
}

function tryGotoAssignedWorkRoom(world: World, e: Entity): boolean {
  if (e.assignedRoomId === undefined || e.assignedRoomId < 0) return false;
  const room = world.rooms[e.assignedRoomId];
  if (!room) return false;
  if (npcUtilityRoomTypeWeightForIntent('work', room.type, e.occupation) <= 0) return false;
  if (!territoryFriendlyForNpc(e, territoryRoomOwner(world, room.id)) && !isRoutineTrespassRelaxed(e)) return false;
  return tryAssignPathToRoomCenter(world, e, room) !== 'not_found';
}

interface RoutineRoomOptions {
  preferredRoomId?: number;
  allowTrespassFallback?: boolean;
}

function gotoRoutineRoomOfTypes(
  world: World,
  e: Entity,
  types: readonly RoomType[],
  intent: NpcUtilityIntentId,
  options: RoutineRoomOptions = {},
): boolean {
  if (types.length === 0) return false;
  routineFriendlyRoomCandidates.length = 0;
  routineFallbackRoomCandidates.length = 0;
  routineSeenRoomIds.clear();
  const allowFallback = options.allowTrespassFallback === true ||
    routineIntentAllowsSurvivalTrespass(intent) ||
    isRoutineTrespassRelaxed(e);
  const considerRoom = (room: Room | undefined): void => {
    if (!room || routineSeenRoomIds.has(room.id)) return;
    routineSeenRoomIds.add(room.id);
    if (!types.includes(room.type)) return;
    const utility = npcUtilityRoomTypeWeightForIntent(intent, room.type, e.occupation);
    if (utility <= 0 && room.id !== options.preferredRoomId && room.id !== e.assignedRoomId) return;
    const friendly = territoryFriendlyForNpc(e, territoryRoomOwner(world, room.id));
    if (!friendly && !allowFallback) return;
    const cx = room.x + room.w / 2;
    const cy = room.y + room.h / 2;
    const distance = Math.sqrt(world.dist2(e.x, e.y, cx, cy));
    if (distance > routineRoomDistanceLimit(e, room, intent, options.preferredRoomId)) return;
    const target = routineRoomTargetCandidate(world, e, room, intent, friendly, options.preferredRoomId, distance);
    pushRoutineRoomCandidate(friendly ? routineFriendlyRoomCandidates : routineFallbackRoomCandidates, target);
  };

  considerRoom(options.preferredRoomId !== undefined ? world.rooms[options.preferredRoomId] : undefined);
  considerRoom(e.assignedRoomId !== undefined ? world.rooms[e.assignedRoomId] : undefined);
  considerRoom(world.roomAt(e.x, e.y) ?? undefined);

  const roomCount = world.rooms.length;
  const scanCount = Math.min(roomCount, TERRITORY_ROOM_TARGET_SCAN_CAP);
  const scanStart = roomCount > 0
    ? Math.floor(stableUnit(e, `routine_room_scan:${intent}`) * roomCount) % roomCount
    : 0;
  for (let scanned = 0; scanned < scanCount; scanned++) {
    considerRoom(world.rooms[(scanStart + scanned) % roomCount]);
  }
  routineFriendlyRoomCandidates.sort(compareRoutineRoomCandidates);
  if (tryAssignRoutineRoomCandidate(world, e, routineFriendlyRoomCandidates)) return true;
  if (!allowFallback) return false;
  routineFallbackRoomCandidates.sort(compareRoutineRoomCandidates);
  return tryAssignRoutineRoomCandidate(world, e, routineFallbackRoomCandidates);
}

function routineRoomTargetCandidate(
  world: World,
  e: Entity,
  room: Room,
  intent: NpcUtilityIntentId,
  friendly: boolean,
  preferredRoomId: number | undefined,
  distance: number,
): NpcUtilityTargetCandidate {
  const assignedBonus = room.id === e.assignedRoomId ? 14 : 0;
  const preferredBonus = room.id === preferredRoomId ? 12 : 0;
  const territoryUtility = friendly ? 10 : -22;
  const score = scoreNpcUtilityTargetPreference({
    id: room.id,
    roomId: room.id,
    roomType: room.type,
    utility: assignedBonus + preferredBonus + territoryUtility,
    distance,
    factionPenalty: friendly ? 0 : 18,
    danger: world.dangerField[Math.floor(room.y + room.h/2) * 1024 + Math.floor(room.x + room.w/2)] / 255,
  }, {
    identity: npcUtilityIdentityFromEntity(e),
    intent,
    occupation: e.occupation,
    faction: e.faction,
    stableJitter: 2,
    distanceScale: 96,
  });
  return {
    id: room.id,
    roomId: room.id,
    roomType: room.type,
    x: room.x + Math.floor(room.w / 2),
    y: room.y + Math.floor(room.h / 2),
    utility: score,
    distance,
  };
}

function routineRoomDistanceLimit(e: Entity, room: Room, intent: NpcUtilityIntentId, preferredRoomId: number | undefined): number {
  if (room.id === preferredRoomId || room.id === e.assignedRoomId) return Infinity;
  if (usesTravelerRoutine(e)) return routineIntentAllowsSurvivalTrespass(intent) ? ROUTINE_TRAVELER_NEED_ROOM_DISTANCE : Infinity;
  if (routineIntentAllowsSurvivalTrespass(intent)) return ROUTINE_SURVIVAL_ROOM_DISTANCE;
  return ROUTINE_LOCAL_ROOM_DISTANCE;
}

function pushRoutineRoomCandidate(candidates: NpcUtilityTargetCandidate[], candidate: NpcUtilityTargetCandidate): void {
  candidates.push(candidate);
  if (candidates.length <= ROUTINE_ROOM_CANDIDATE_CAP * 2) return;
  candidates.sort(compareRoutineRoomCandidates);
  candidates.length = ROUTINE_ROOM_CANDIDATE_CAP;
}

function compareRoutineRoomCandidates(a: NpcUtilityTargetCandidate, b: NpcUtilityTargetCandidate): number {
  return (b.utility ?? 0) - (a.utility ?? 0) || Number(a.roomId ?? a.id) - Number(b.roomId ?? b.id);
}

function tryAssignRoutineRoomCandidate(world: World, e: Entity, candidates: readonly NpcUtilityTargetCandidate[]): boolean {
  const limit = Math.min(candidates.length, ROUTINE_ROOM_CANDIDATE_CAP);
  const currentRoom = world.roomAt(e.x, e.y);
  for (let i = 0; i < limit; i++) {
    const candidate = candidates[i];
    if (candidate.x === undefined || candidate.y === undefined) continue;
    if (currentRoom && currentRoom.id === candidate.roomId) {
      const ai = e.ai!;
      ai.path = [];
      ai.pi = 0;
      ai.stuck = 0;
      return true;
    }
    if (tryAssignPathToCell(world, e, candidate.x, candidate.y) !== 'not_found') return true;
  }
  return false;
}

function tryAssignPathToRoomCenter(world: World, e: Entity, room: Room) {
  const currentRoom = world.roomAt(e.x, e.y);
  if (currentRoom && currentRoom.id === room.id) {
    const ai = e.ai!;
    ai.path = [];
    ai.pi = 0;
    ai.stuck = 0;
    return 'same';
  }
  return tryAssignPathToCell(world, e,
    room.x + Math.floor(room.w / 2),
    room.y + Math.floor(room.h / 2),
  );
}

function patrolCorridor(world: World, e: Entity): void {
  for (let attempt = 0; attempt < 20; attempt++) {
    const dx = Math.floor(stableUnit(e, `patrol_x:${attempt}:${Math.floor((e.ai?.stateTimer ?? 0) / 10)}`) * 61) - 30;
    const dy = Math.floor(stableUnit(e, `patrol_y:${attempt}:${Math.floor((e.ai?.stateTimer ?? 0) / 10)}`) * 61) - 30;
    const tx = world.wrap(Math.floor(e.x) + dx);
    const ty = world.wrap(Math.floor(e.y) + dy);
    const ci = world.idx(tx, ty);
    if (world.cells[ci] !== Cell.FLOOR) continue;
    if (world.roomMap[ci] >= 0) continue;
    if (!territoryFriendlyForNpc(e, territoryOwnerAtIndex(world, ci)) && attempt < 14) continue;
    const status = tryAssignPathToCell(world, e, tx, ty);
    if (status !== 'not_found') return;
  }
  wanderNearby(world, e);
}

function handleHiding(
  world: World,
  entities: readonly Entity[],
  e: Entity,
  dt: number,
  clock: GameClock,
  profile: NpcAiProfile,
): void {
  const ai = e.ai!;
  if (ai.goal !== AIGoal.HIDE) {
    ai.goal = AIGoal.HIDE;
    ai.timer = 0;
  }
  if (ai.path.length === 0 && ai.timer <= 0) {
    if (!tryAssignEmergencyShelterPath(world, entities, e, clock)) {
      if (profile === 'ministry') {
        gotoAssignedOrNearest(world, e, RoomType.OFFICE);
      } else if (usesTravelerRoutine(e)) {
        gotoNearestRoomType(world, e, RoomType.LIVING);
      } else {
        const targetRoom = findFamilyRoom(world, e, RoomType.LIVING);
        if (targetRoom >= 0) gotoRoom(world, e, targetRoom);
        else gotoNearestRoomOfTypes(world, e, [RoomType.LIVING, RoomType.HQ, RoomType.COMMON]);
      }
      ai.timer = 1.25;
    }
  }
  followPath(world, e, dt);
}

/* ── Force NPCs to hide (called by samosbor) ─────────────────── */
export function forceHide(
  entities: Entity[],
  msgs?: Msg[],
  time?: number,
  world?: World,
  clock?: GameClock,
  shelterRoomIds?: readonly number[],
): void {
  for (const e of entities) {
    if (e.type === EntityType.NPC && e.alive && e.ai) {
      if (e.faction === Faction.LIQUIDATOR || e.faction === Faction.CULTIST || e.faction === Faction.WILD) continue;
      if (msgs) emitMarkovBark(e, msgs, time ?? 0, 'alert', 'Тихо...', BARK_CHANCE_HIDE, '#ff4');
      utilityIntentByNpc.set(e, 'safety');
      utilityScoreByNpc.set(e, UTILITY_EMERGENCY_SCORE);
      e.ai.npcState = NpcState.HIDING;
      e.ai.goal = AIGoal.HIDE;
      e.ai.path = [];
      e.ai.pi = 0;
      e.ai.timer = 0;
      if (world) tryAssignEmergencyShelterPath(world, entities, e, clock, shelterRoomIds);
      utilityNextDecisionAtByNpc.set(e, (time ?? _barkTime) + utilityRethinkInterval(e));
    }
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
