/* ── Faction warfare system — cell territory control ─────────── */
/*   Cell-based territory map, local capture AI, faction events,   */
/*   and faction strength from territory.                          */

import {
  type Entity, type GameState,
  EntityType, AIGoal, Faction, ZoneFaction,
  type FloorLevel, type WorldEventSeverity, type WorldEventType,
} from '../core/types';
import { World } from '../core/world';
import { ITEMS } from '../data/catalog';
import { MAX_ACTIVE_MACRO_GOALS } from '../data/entity_limits';
import { occupationHasAnyProfileTag, occupationHasProfileTag } from '../data/occupation_profiles';
import {
  HUMAN_TERRITORY_OWNERS,
} from '../data/factions';
import { getFactionRel, addFactionRelMutual } from '../data/relations';
import { isPsiMad, isPsiAlly } from './psi';
import { isPlayerEntity } from './player_actor';
import { updateFactionEvents } from './faction_events';
import { MAX_CARAVAN_LANES_PER_TICK, tickCaravans } from './caravans';
import { getRecentEvents, publishEvent } from './events';
import { getRecentNoiseRecords, type NoiseRecord } from './noise';
import { tryAssignPathToCell } from './ai/pathfinding';
import { ENTITY_MASK_NPC, getEntityIndex } from './entity_index';
import {
  countTerritoryCells,
  currentTerritoryZoneId,
  initializeCellTerritory,
  territoryOwnerAt,
  updateTerritoryCapture,
} from './territory';
import {
  HOSTILE_RELATION_THRESHOLD,
  addNpcPlayerRelation,
  isNpcPlayerHostile,
} from './npc_relations';
import { applyDemosRelationDelta } from './demos_social';
import { addKarma } from './alife_rating';
import { isPassiveDefensiveNeutralMonster } from './monster_traits';

/* ── Faction relation accessors (dynamic — reads live matrix) ─── */
// Monsters use a fixed attitude, not tracked in the matrix
const FACTION_VS_MONSTER: number[] = [
  /* CITIZEN */ -100,
  /* LIQUID. */ -100,
  /* CULTIST */   50,
  /* SCIENTIST*/ -80,
  /* WILD    */ -100,
  /* PLAYER  */ -100,
];

export type FactionRelationDelta = readonly [Faction, number];

/** Get dynamic faction-to-faction relation */
export function getFactionRelation(a: Faction, b: Faction): number {
  return getFactionRel(a, b);
}

/** Get faction-to-monster relation */
export function getFactionMonsterRelation(f: Faction): number {
  return FACTION_VS_MONSTER[f] ?? -100;
}

/** Check if two factions are hostile (base relation) */
export function areFactionsHostile(a: Faction, b: Faction): boolean {
  return getFactionRelation(a, b) <= HOSTILE_RELATION_THRESHOLD;
}

export function applyFactionRelationDeltas(
  deltas: readonly FactionRelationDelta[],
  actor: Faction = Faction.PLAYER,
): Record<string, number> {
  const applied: Record<string, number> = {};
  for (const [faction, delta] of deltas) {
    if (delta === 0) continue;
    addFactionRelMutual(actor, faction, delta);
    applied[Faction[faction] ?? String(faction)] = (applied[Faction[faction] ?? String(faction)] ?? 0) + delta;
  }
  return applied;
}

/** Check if entity considers another entity hostile */
export function isHostile(attacker: Entity, target: Entity): boolean {
  // PSI control: controlled entities don't attack their controller (and vice-versa)
  if (isPsiAlly(attacker, target)) return false;
  // Monsters are one ecology faction. They can compete through movement/space, but not through combat hostility.
  if (attacker.type === EntityType.MONSTER && target.type === EntityType.MONSTER) return false;
  // PSI madness: mad entities attack everyone
  if (isPsiMad(attacker)) return target.id !== attacker.id;
  if (isPassiveDefensiveNeutralMonster(attacker) || isPassiveDefensiveNeutralMonster(target)) return false;
  if (isPlayerEntity(target) && attacker.id !== target.id) {
    if (attacker.type === EntityType.MONSTER) return getFactionMonsterRelation(Faction.PLAYER) <= HOSTILE_RELATION_THRESHOLD;
    if (attacker.type === EntityType.NPC && isNpcPlayerHostile(attacker)) return true;
    return areFactionsHostile(attacker.faction ?? Faction.CITIZEN, Faction.PLAYER);
  }
  // Monsters: use faction-vs-monster table
  if (attacker.type === EntityType.MONSTER) {
    // Monsters are hostile to everyone except cultists
    const tFaction = target.faction ?? Faction.CITIZEN;
    return getFactionMonsterRelation(tFaction) <= HOSTILE_RELATION_THRESHOLD;
  }
  if (target.type === EntityType.MONSTER) {
    const aFaction = attacker.faction ?? Faction.CITIZEN;
    return getFactionMonsterRelation(aFaction) <= HOSTILE_RELATION_THRESHOLD;
  }
  if (attacker.type === EntityType.NPC && isPlayerEntity(target) && isNpcPlayerHostile(attacker)) {
    return true;
  }
  // NPC vs NPC / Player
  const aFaction = attacker.faction ?? Faction.CITIZEN;
  const bFaction = target.faction ?? Faction.CITIZEN;
  return areFactionsHostile(aFaction, bFaction);
}

/* ── Territory counting per owner ────────────────────────────── */
export interface FactionStats {
  cells: number;
}

export interface FactionZoneUiSnapshot {
  zoneId: number;
  x: number;
  y: number;
  level: number;
  owner: ZoneFaction;
  dominant: ZoneFaction;
  ownerShare: number;
  dominantShare: number;
  pressure: number;
  contested: boolean;
  recentEventCount: number;
  lastEventSeverity: WorldEventSeverity;
  lastEventTime: number;
}

export interface FactionOwnerUiSnapshot {
  faction: ZoneFaction;
  cells: number;
  fronts: number;
}

export interface FactionRecentEventUiSnapshot {
  id: number;
  time: number;
  floor: FloorLevel;
  zoneId: number;
  x: number;
  y: number;
  type: WorldEventType;
  severity: WorldEventSeverity;
  name: string;
  phase: string;
  text: string;
  actorFaction?: Faction;
  targetFaction?: Faction;
}

export interface FactionUiSnapshot {
  time: number;
  floor: FloorLevel;
  zones: FactionZoneUiSnapshot[];
  zoneById: (FactionZoneUiSnapshot | undefined)[];
  owners: FactionOwnerUiSnapshot[];
  contestedZones: number;
  recentEvents: FactionRecentEventUiSnapshot[];
}

const ZONE_UI_FACTIONS = [
  ZoneFaction.CITIZEN,
  ZoneFaction.LIQUIDATOR,
  ZoneFaction.CULTIST,
  ZoneFaction.SCIENTIST,
  ZoneFaction.WILD,
  ZoneFaction.SAMOSBOR,
] as const;
const UI_CONTESTED_PRESSURE = 0.22;
const UI_DOMINANT_CONTESTED_SHARE = 0.28;
const UI_RECENT_EVENT_LIMIT = 8;
const UI_IDLE_REFRESH_SEC = 4;
const UI_OPEN_REFRESH_SEC = 1;
let factionUiSnapshot: FactionUiSnapshot | undefined;
let factionUiSnapshotAccum = 0;

export function getFactionUiSnapshot(): FactionUiSnapshot | undefined {
  return factionUiSnapshot;
}

export function countFactionTerritory(world: World): Map<ZoneFaction, FactionStats> {
  const stats = new Map<ZoneFaction, FactionStats>();
  for (const zf of HUMAN_TERRITORY_OWNERS) {
    stats.set(zf, { cells: 0 });
  }
  for (const row of countTerritoryCells(world)) {
    if (row.owner === ZoneFaction.SAMOSBOR) continue;
    const s = stats.get(row.owner);
    if (s) s.cells = row.cells;
  }

  return stats;
}

function factionEventString(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key];
  return typeof value === 'string' ? value : '';
}

function refreshFactionUiSnapshot(world: World, state: GameState): void {
  const zones: FactionZoneUiSnapshot[] = [];
  const zoneById: (FactionZoneUiSnapshot | undefined)[] = [];
  const ownerCounts = new Map<ZoneFaction, FactionOwnerUiSnapshot>();
  for (const faction of ZONE_UI_FACTIONS) ownerCounts.set(faction, { faction, cells: 0, fronts: 0 });

  let contestedZones = 0;
  for (const row of countTerritoryCells(world, 4)) {
    const owner = ownerCounts.get(row.owner);
    if (owner) owner.cells = row.cells;
  }
  for (const zone of world.zones) {
    if (!zone) continue;

    const counts = zone.territoryCounts;
    let owner = territoryOwnerAt(world, zone.cx, zone.cy);
    let ownerCount = counts && owner < counts.length ? counts[owner] : 0;
    let strongest = owner;
    let strongestCount = ownerCount;
    let pressureOwner = owner;
    let pressureCount = 0;
    let sampled = 0;

    if (counts) {
      for (let i = 0; i < counts.length; i++) {
        const count = counts[i];
        sampled += count;
        if (count > strongestCount) {
          strongestCount = count;
          strongest = i as ZoneFaction;
        }
        if (i !== owner && count > pressureCount) {
          pressureCount = count;
          pressureOwner = i as ZoneFaction;
        }
      }

      if (sampled > 0 && ownerCount === 0) {
        owner = strongest;
        ownerCount = strongestCount;
        pressureOwner = owner;
        pressureCount = 0;
        for (let i = 0; i < counts.length; i++) {
          const count = counts[i];
          if (i !== owner && count > pressureCount) {
            pressureCount = count;
            pressureOwner = i as ZoneFaction;
          }
        }
      }
    }

    const ownerShare = sampled > 0 ? ownerCount / sampled : 1;
    const dominantShare = sampled > 0 ? pressureCount / sampled : 0;
    const pressure = dominantShare;
    const contested = owner !== ZoneFaction.SAMOSBOR
      && sampled > 0
      && (pressure >= UI_CONTESTED_PRESSURE || (pressureOwner !== owner && dominantShare >= UI_DOMINANT_CONTESTED_SHARE));

    const row: FactionZoneUiSnapshot = {
      zoneId: zone.id,
      x: zone.cx,
      y: zone.cy,
      level: zone.level ?? 1,
      owner,
      dominant: pressureOwner,
      ownerShare,
      dominantShare,
      pressure,
      contested,
      recentEventCount: 0,
      lastEventSeverity: 0,
      lastEventTime: -Infinity,
    };
    zones.push(row);
    zoneById[zone.id] = row;
    const ownerRow = ownerCounts.get(owner);
    if (ownerRow) {
      if (contested) ownerRow.fronts++;
    }
    if (contested) contestedZones++;
  }

  const recentEvents = getRecentEvents(state, { tags: ['faction_event'], limit: UI_RECENT_EVENT_LIMIT }).map(event => {
    const zoneId = event.zoneId ?? -1;
    const zone = zoneId >= 0 ? zoneById[zoneId] : undefined;
    if (event.floor === state.currentFloor && zone) {
      zone.recentEventCount++;
      if (event.severity > zone.lastEventSeverity) zone.lastEventSeverity = event.severity;
      if (event.time >= zone.lastEventTime) zone.lastEventTime = event.time;
    }
    return {
      id: event.id,
      time: event.time,
      floor: event.floor,
      zoneId,
      x: event.x ?? zone?.x ?? 0,
      y: event.y ?? zone?.y ?? 0,
      type: event.type,
      severity: event.severity,
      name: factionEventString(event.data, 'name'),
      phase: factionEventString(event.data, 'phase'),
      text: factionEventString(event.data, 'residueText') || factionEventString(event.data, 'text'),
      actorFaction: event.actorFaction,
      targetFaction: event.targetFaction,
    };
  });

  factionUiSnapshot = {
    time: state.time,
    floor: state.currentFloor,
    zones,
    zoneById,
    owners: ZONE_UI_FACTIONS.map(faction => ownerCounts.get(faction) ?? { faction, cells: 0, fronts: 0 }),
    contestedZones,
    recentEvents,
  };
}

/* ── Initialize per-cell faction control ─────────────────────── */
export function initFactionControl(world: World): void {
  initializeCellTerritory(world);
}

let activityAccum = 0;
const NOISE_PATROL_EVENT_LIMIT = 6;
const NOISE_PATROL_COOLDOWN_S = 8;
const NOISE_PATROL_RADIUS = 44;
const NOISE_PATROL_RESPONDERS_PER_EVENT = 3;
const NOISE_PATROL_ENTITY_SCAN_CAP = 360;
const lastNoisePatrolResponseAt = new Map<string, number>();
const noisePatrolQuery: Entity[] = [];

export function updateFactionCapture(world: World, entities: Entity[], dt: number, state?: GameState): void {
  updateTerritoryCapture(world, entities, state, dt);
}

export function updateFactionActivity(
  world: World,
  entities: Entity[],
  player: Entity,
  state: GameState,
  nextId: { v: number },
  dt: number,
  allowSpawns = true,
): void {
  activityAccum += dt;
  if (activityAccum < 1) return;
  const elapsed = activityAccum;
  activityAccum = 0;
  updateNoisePatrolResponse(world, entities, state);
  evaluateMacroGoalsGC(state, elapsed, entities);
  updateFactionEvents(state, world, player, entities, nextId, elapsed, allowSpawns);
  tickCaravans(state, elapsed, false, MAX_CARAVAN_LANES_PER_TICK, world, entities, player, nextId);
  factionUiSnapshotAccum += elapsed;
  const uiRefreshSec = state.showFactions ? UI_OPEN_REFRESH_SEC : UI_IDLE_REFRESH_SEC;
  if (!factionUiSnapshot || factionUiSnapshot.floor !== state.currentFloor || factionUiSnapshotAccum >= uiRefreshSec) {
    factionUiSnapshotAccum = 0;
    refreshFactionUiSnapshot(world, state);
  }
}

function canRespondToNoise(e: Entity): boolean {
  if (!e.alive || e.type !== EntityType.NPC || !e.ai || e.faction === undefined) return false;
  return e.faction === Faction.LIQUIDATOR ||
    e.faction === Faction.CULTIST ||
    e.faction === Faction.WILD ||
    occupationHasAnyProfileTag(e.occupation, ['combat', 'patrol']) ||
    e.isTraveler === true ||
    occupationHasProfileTag(e.occupation, 'traveler');
}

function noiseZoneId(world: World, record: NoiseRecord): number {
  return currentTerritoryZoneId(world, record.x, record.y);
}

function shouldRespondToNoise(state: GameState, zoneId: number, record: NoiseRecord): boolean {
  const key = `${state.currentFloor}:${zoneId}:${record.source}`;
  const last = lastNoisePatrolResponseAt.get(key) ?? -Infinity;
  if (state.time - last < NOISE_PATROL_COOLDOWN_S) return false;
  lastNoisePatrolResponseAt.set(key, state.time);
  return true;
}

function sendNoisePatrol(world: World, _entities: Entity[], record: NoiseRecord): number {
  let responders = 0;
  const tx = Math.floor(record.x);
  const ty = Math.floor(record.y);
  getEntityIndex().queryRadiusCapped(record.x, record.y, NOISE_PATROL_RADIUS, noisePatrolQuery, ENTITY_MASK_NPC, NOISE_PATROL_ENTITY_SCAN_CAP);
  for (const e of noisePatrolQuery) {
    if (responders >= NOISE_PATROL_RESPONDERS_PER_EVENT) break;
    if (!canRespondToNoise(e)) continue;
    if (record.actorId !== undefined && e.id === record.actorId) continue;
    const ai = e.ai!;
    ai.goal = AIGoal.HUNT;
    ai.combatScanCd = 0;
    ai.timer = 4 + responders;
    tryAssignPathToCell(world, e, tx, ty);
    responders++;
  }
  noisePatrolQuery.length = 0;
  return responders;
}

function updateNoisePatrolResponse(world: World, entities: Entity[], state: GameState): void {
  const records = getRecentNoiseRecords(state, { minSeverity: 3, limit: NOISE_PATROL_EVENT_LIMIT }, state.time);
  for (const record of records) {
    if (record.source === 'footstep') continue;
    const zoneId = noiseZoneId(world, record);
    if (!shouldRespondToNoise(state, zoneId, record)) continue;
    const responders = sendNoisePatrol(world, entities, record);
    if (responders <= 0) continue;
    publishEvent(state, {
      type: 'faction_event',
      zoneId,
      x: record.x,
      y: record.y,
      actorId: record.actorId,
      actorFaction: record.actorFaction,
      itemId: record.itemId,
      itemName: record.itemId ? ITEMS[record.itemId]?.name ?? record.itemId : undefined,
      severity: record.severity,
      privacy: 'local',
      tags: ['faction_event', 'noise_response', record.source, 'patrol'],
      data: {
        name: 'Патруль на шум',
        phase: 'patrol_response',
        text: 'Патруль пошёл на шум.',
        source: record.source,
        responders,
        noiseId: record.id,
      },
    });
  }
}

/** Recalculate which faction owns each zone based on cell majority.
 *  Only checks zones in the given set (those that had cells flipped). */
/* ── Apply damage relation penalty between factions ──────────── */
export function applyDamageRelationPenalty(
  attackerFaction: Faction | undefined, targetFaction: Faction | undefined,
  damage: number,
  target?: Entity,
  attacker?: Entity,
  state?: GameState,
): void {
  if (attackerFaction === undefined || targetFaction === undefined) return;
  if (attackerFaction === targetFaction) return;

  const wasFactionEnemy = areFactionsHostile(attackerFaction, targetFaction);
  const wasPersonalEnemy = attackerFaction === Faction.PLAYER && target?.type === EntityType.NPC && isNpcPlayerHostile(target);
  const wasNonEnemy = !wasFactionEnemy && !wasPersonalEnemy;
  // Penalty proportional to damage: -1 per 5 damage, min -1
  const penalty = -Math.max(1, Math.floor(damage / 5));
  if (attackerFaction === Faction.PLAYER && target?.type === EntityType.NPC) {
    addNpcPlayerRelation(target, penalty);
    if (state && target.alifeId !== undefined) {
      applyDemosRelationDelta(state, target.alifeId, { targetKind: 'player' }, penalty, {
        reasonTag: 'damage',
      });
    }
  } else if (state && target?.type === EntityType.NPC && attacker?.type === EntityType.NPC && target.alifeId !== undefined && attacker.alifeId !== undefined) {
    applyDemosRelationDelta(state, target.alifeId, { targetKind: 'alife', targetAlifeId: attacker.alifeId }, penalty, {
      reasonTag: 'damage',
    });
  }
  // Only penalize factions if they are NOT hostile (hitting allies/neutrals)
  if (wasNonEnemy) {
    addFactionRelMutual(attackerFaction, targetFaction, penalty);
    if (attacker) addKarma(attacker, -Math.max(1, Math.min(4, Math.floor(damage / 20) || 1)));
  }
}

/* ── Apply narrow social penalty for witnessed/audited theft ─── */
export function applyTheftRelationPenalty(
  victimFaction: Faction | undefined,
  witnessed: boolean,
  audited: boolean,
): number {
  if (victimFaction === undefined || victimFaction === Faction.PLAYER) return 0;
  if (!witnessed && !audited) return 0;

  const penalty = witnessed ? -4 : -2;
  addFactionRelMutual(victimFaction, Faction.PLAYER, penalty);
  return penalty;
}

export function applyRoomMemoryRelationPenalty(victimFaction: Faction | undefined, severity: number): number {
  if (victimFaction === undefined || victimFaction === Faction.PLAYER) return 0;
  const penalty = severity >= 5 ? -2 : -1;
  addFactionRelMutual(victimFaction, Faction.PLAYER, penalty);
  return penalty;
}

export function applyInfrastructureRelationResponse(
  ownerFaction: Faction | null | undefined,
  action: 'repair' | 'shutdown' | 'force' | 'overload',
): number {
  if (ownerFaction === null || ownerFaction === undefined || ownerFaction === Faction.PLAYER) return 0;
  const delta = action === 'repair'
    ? (ownerFaction === Faction.WILD ? 0 : 1)
    : action === 'shutdown'
      ? -1
      : action === 'force'
        ? -2
        : -4;
  if (delta !== 0) addFactionRelMutual(Faction.PLAYER, ownerFaction, delta);
  return delta;
}

export function canCreateMacroGoal(state: GameState): boolean {
  return (state.factionGoals?.length ?? 0) < MAX_ACTIVE_MACRO_GOALS;
}

export function evaluateMacroGoalsGC(state: GameState, dt: number, entities: Entity[]): void {
  if (state.factionGoalsTimer === undefined) state.factionGoalsTimer = 0;
  state.factionGoalsTimer += dt;
  if (state.factionGoalsTimer < 60) return;
  state.factionGoalsTimer = 0;

  if (!state.factionGoals) return;

  const activeGoals = [];
  const entitiesById = new Map<number, Entity>();
  for (let i = 0; i < entities.length; i++) {
    entitiesById.set(entities[i].id, entities[i]);
  }
  for (const goal of state.factionGoals) {
    let hasAliveMembers = false;
    for (const memberId of goal.members) {
      const e = entitiesById.get(memberId);
      if (e && e.alive) {
        hasAliveMembers = true;
        break;
      }
    }
    if (hasAliveMembers) {
      activeGoals.push(goal);
    }
  }
  state.factionGoals = activeGoals;
}
