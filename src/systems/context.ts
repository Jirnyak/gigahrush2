/* ── Cheap NPC context snapshot builder ───────────────────────── */

import {
  type Entity,
  type GameState,
  type Needs,
  type Faction,
  type ZoneFaction,
  type ContextFact,
  type WorldEventType,
  FloorLevel,
  RoomType,
  W,
} from '../core/types';
import { World } from '../core/world';
import { screenSignalForTexture } from '../data/screen_signals';
import { ROOM_MEMORY_BITS, getRoomMemory, roomMemoryHas, type RoomMemoryRecord } from './room_memory';
import { factionToTerritoryOwner } from '../data/factions';
import { territoryOwnerAtIndex } from './territory';

export interface ContextSnapshot {
  floor?: FloorLevel;
  zoneId?: number;
  zoneFaction?: ZoneFaction;
  zoneLevel?: number;
  roomType?: RoomType;
  roomName?: string;
  npcFaction?: Faction;
  npcOccupation?: number;
  npcNeeds?: Needs;
  npcHpRatio?: number;
  playerDistance?: number;
  samosborActive?: boolean;
  hasActiveContract: boolean;
  hasRecentPlayerTheft: boolean;
  hasRecentSamosborWarning: boolean;
  hasRecentMetroEvent: boolean;
  hasRecentLiftAnomaly: boolean;
  hasRecentFactionClash: boolean;
  hasRecentMonsterKill: boolean;
  hasRecentContainerOpen: boolean;
  roomMemoryBits: number;
  roomMemorySeverity: number;
  hasRoomMemoryTheft: boolean;
  hasRoomMemoryHelp: boolean;
  hasRoomMemoryInform: boolean;
  hasRoomMemoryCombat: boolean;
  hasRoomMemoryRepair: boolean;
  hasRoomMemorySamosbor: boolean;
  hasRecentSamosborAftermath: boolean;
  hasRecentProductionOutput: boolean;
  hasRecentProductionShortage: boolean;
  nearbyContainer: boolean;
  nearbyScreenRumorIds: readonly string[];
  nearbyProduction: boolean;
  isDangerousZone: boolean;
  isSafeOwnZone: boolean;
  isHungry: boolean;
  isThirsty: boolean;
  isTired: boolean;
  isWounded: boolean;
  isCritical: boolean;
}

export interface ContextBuildOptions {
  world?: World;
  state?: Pick<GameState, 'currentFloor' | 'samosborActive'> & Partial<Pick<GameState, 'quests' | 'time' | 'worldEvents'>>;
  player?: Entity;
  time?: number;
}

const SCREEN_RUMOR_RADIUS = 8;
const SCREEN_RUMOR_MAX_IDS = 6;

export function buildContextSnapshot(npc: Entity, options: ContextBuildOptions = {}): ContextSnapshot {
  const n = npc.needs;
  let zoneId: number | undefined;
  let zoneFaction: ZoneFaction | undefined;
  let zoneLevel: number | undefined;
  let roomType: RoomType | undefined;
  let roomName: string | undefined;
  let roomMemory: RoomMemoryRecord | undefined;
  let playerDistance: number | undefined;
  let nearbyContainer = false;
  let nearbyScreenRumorIds: readonly string[] = [];

  const world = options.world;
  if (world) {
    const x = Math.floor(npc.x);
    const y = Math.floor(npc.y);
    const idx = world.idx(x, y);
    zoneId = world.zoneMap[idx];
    const zone = world.zones[zoneId];
    if (zone) {
      zoneFaction = territoryOwnerAtIndex(world, idx);
      zoneLevel = zone.level;
    }
    const room = world.roomAt(npc.x, npc.y);
    if (room) {
      roomType = room.type;
      roomName = room.name;
      roomMemory = getRoomMemory(options.state?.currentFloor, room.id);
    }
    nearbyContainer = hasNearbyContainer(world, x, y);
    nearbyScreenRumorIds = screenRumorsNear(world, x, y);
    if (options.player) playerDistance = world.dist(npc.x, npc.y, options.player.x, options.player.y);
  } else if (options.player) {
    const dx = shortestDelta(npc.x, options.player.x);
    const dy = shortestDelta(npc.y, options.player.y);
    playerDistance = Math.sqrt(dx * dx + dy * dy);
  }

  const hp = npc.hp ?? npc.maxHp ?? 100;
  const maxHp = Math.max(1, npc.maxHp ?? hp);
  const hpRatio = hp / maxHp;
  const ownZone = npc.faction === undefined ? -1 : factionToTerritoryOwner(npc.faction);
  const isSafeOwnZone = zoneFaction !== undefined && ownZone === zoneFaction && (zoneLevel ?? 1) <= 3;
  const state = options.state;
  const now = options.time ?? state?.time ?? 0;
  const playerId = options.player?.id;

  return {
    floor: options.state?.currentFloor,
    zoneId,
    zoneFaction,
    zoneLevel,
    roomType,
    roomName,
    npcFaction: npc.faction,
    npcOccupation: npc.occupation,
    npcNeeds: n,
    npcHpRatio: hpRatio,
    playerDistance,
    samosborActive: state?.samosborActive,
    hasActiveContract: (state?.quests?.some(q => !q.done && q.contractId !== undefined) ?? false)
      || hasRecentFact(state, 'quest_hook', now, undefined, 12, ['contract']),
    hasRecentPlayerTheft: hasRecentEvent(state, 'item_stolen', now, playerId, 10)
      || hasRecentFact(state, 'theft', now, playerId, 10),
    hasRecentSamosborWarning: hasRecentEvent(state, 'samosbor_warning', now, undefined, 12)
      || hasRecentEvent(state, 'samosbor_started', now, undefined, 12)
      || hasRecentEvent(state, 'samosbor_zone_captured', now, undefined, 12)
      || hasRecentFact(state, 'danger', now, undefined, 12, ['samosbor_warning'])
      || hasRecentFact(state, 'danger', now, undefined, 12, ['samosbor_started'])
      || hasRecentFact(state, 'danger', now, undefined, 12, ['samosbor_zone_captured']),
    hasRecentSamosborAftermath: hasRecentEvent(state, 'samosbor_ended', now, undefined, 8)
      || hasRecentFact(state, 'danger', now, undefined, 8, ['samosbor_ended']),
    hasRecentProductionOutput: hasRecentEvent(state, 'room_produced_items', now, undefined, 12),
    hasRecentProductionShortage: hasRecentEvent(state, 'room_lacked_resources', now, undefined, 12)
      || hasRecentEvent(state, 'room_blocked_production', now, undefined, 12),
    hasRecentMetroEvent: hasRecentEvent(state, 'metro_route_taken', now, undefined, 12)
      || hasRecentEvent(state, 'metro_wrong_stop', now, undefined, 12)
      || hasRecentEvent(state, 'elevator_anomaly', now, undefined, 12)
      || hasRecentEvent(state, 'elevator_loop_exit', now, undefined, 12),
    hasRecentLiftAnomaly: hasRecentEvent(state, 'elevator_anomaly', now, undefined, 12)
      || hasRecentEvent(state, 'elevator_loop_exit', now, undefined, 12)
      || hasRecentEvent(state, 'lift_arachna_warned', now, undefined, 12)
      || hasRecentEvent(state, 'lift_arachna_sprung', now, undefined, 12)
      || hasRecentEvent(state, 'lift_arachna_avoided', now, undefined, 12)
      || hasRecentEvent(state, 'lift_arachna_cleared', now, undefined, 12),
    hasRecentFactionClash: hasRecentEvent(state, 'faction_patrol_clash', now, undefined, 12)
      || hasRecentEvent(state, 'faction_relation_changed', now, undefined, 12)
      || hasRecentFact(state, 'territory', now, undefined, 12, ['faction_event']),
    hasRecentMonsterKill: hasRecentEvent(state, 'player_kill_monster', now, undefined, 12)
      || hasRecentEvent(state, 'npc_kill_monster', now, undefined, 12)
      || hasRecentEvent(state, 'fog_boss_killed', now, undefined, 12)
      || hasRecentFact(state, 'death', now, undefined, 12, ['monster']),
    hasRecentContainerOpen: hasRecentEvent(state, 'container_opened', now, playerId, 12)
      || hasRecentEvent(state, 'container_looted', now, undefined, 12)
      || hasRecentEvent(state, 'item_stolen', now, undefined, 12),
    roomMemoryBits: roomMemory?.bits ?? 0,
    roomMemorySeverity: roomMemory?.severity ?? 0,
    hasRoomMemoryTheft: roomMemoryHas(roomMemory, ROOM_MEMORY_BITS.THEFT),
    hasRoomMemoryHelp: roomMemoryHas(roomMemory, ROOM_MEMORY_BITS.HELP),
    hasRoomMemoryInform: roomMemoryHas(roomMemory, ROOM_MEMORY_BITS.INFORM),
    hasRoomMemoryCombat: roomMemoryHas(roomMemory, ROOM_MEMORY_BITS.COMBAT),
    hasRoomMemoryRepair: roomMemoryHas(roomMemory, ROOM_MEMORY_BITS.REPAIR),
    hasRoomMemorySamosbor: roomMemoryHas(roomMemory, ROOM_MEMORY_BITS.SAMOSBOR),
    nearbyContainer,
    nearbyScreenRumorIds,
    nearbyProduction: roomType === RoomType.PRODUCTION,
    isDangerousZone: (zoneLevel ?? 0) >= 6 || zoneFaction === 3 || state?.samosborActive === true,
    isSafeOwnZone,
    isHungry: (n?.food ?? 100) < 20,
    isThirsty: (n?.water ?? 100) < 20,
    isTired: (n?.sleep ?? 100) < 20,
    isWounded: hpRatio < 0.5,
    isCritical: hpRatio < 0.25,
  };
}

function hasNearbyContainer(world: World, x: number, y: number): boolean {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (world.containerMap.has(world.idx(cx + dx, cy + dy))) return true;
    }
  }
  return false;
}

function screenRumorsNear(world: World, x: number, y: number): readonly string[] {
  if (world.screenCells.length === 0) return [];
  const ids: string[] = [];
  const r2 = SCREEN_RUMOR_RADIUS * SCREEN_RUMOR_RADIUS;
  for (const ci of world.screenCells) {
    const sx = ci % W;
    const sy = (ci / W) | 0;
    if (world.dist2(x + 0.5, y + 0.5, sx + 0.5, sy + 0.5) > r2) continue;
    const signal = screenSignalForTexture(world.wallTex[ci]);
    if (!signal) continue;
    for (const id of signal.rumorIds) {
      if (ids.includes(id)) continue;
      ids.push(id);
      if (ids.length >= SCREEN_RUMOR_MAX_IDS) return ids;
    }
  }
  return ids;
}

function hasRecentEvent(
  state: ContextBuildOptions['state'] | undefined,
  type: WorldEventType,
  now: number,
  actorId: number | undefined,
  limit: number,
): boolean {
  const buffer = state?.worldEvents?.recentEvents;
  if (!buffer || buffer.capacity <= 0) return false;
  const total = Math.min(buffer.count, limit);
  for (let i = 0; i < total; i++) {
    const idx = (buffer.start + buffer.count - 1 - i + buffer.capacity) % buffer.capacity;
    const event = buffer.items[idx];
    if (!event || event.type !== type) continue;
    if (actorId !== undefined && event.actorId !== actorId) continue;
    if (now > 0 && event.time > 0 && now - event.time > 360) continue;
    return true;
  }
  return false;
}

function hasRecentFact(
  state: ContextBuildOptions['state'] | undefined,
  kind: ContextFact['kind'],
  now: number,
  subjectId: number | undefined,
  limit: number,
  tags: readonly string[] = [],
): boolean {
  const facts = state?.worldEvents?.facts;
  if (!facts || facts.length === 0) return false;
  let checked = 0;
  for (let i = facts.length - 1; i >= 0 && checked < limit; i--) {
    const fact = facts[i];
    checked++;
    if (fact.kind !== kind) continue;
    if (subjectId !== undefined && fact.subjectId !== subjectId) continue;
    if (fact.expiresAt !== undefined && now > 0 && now > fact.expiresAt) continue;
    if (tags.length > 0 && !tags.every(tag => fact.tags.includes(tag))) continue;
    return true;
  }
  return false;
}

function shortestDelta(a: number, b: number): number {
  let d = b - a;
  if (d > W / 2) d -= W;
  if (d < -W / 2) d += W;
  return d;
}
