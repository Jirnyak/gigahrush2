import {
  AIGoal,
  DoorState,
  EntityType,
  Faction,
  NpcState,
  RoomType,
  ZoneFaction,
  type Entity,
  type Room,
  Occupation,
} from '../../core/types';
import type { World } from '../../core/world';
import { isPlayerEntity } from '../player_actor';
import { occupationHasAnyProfileTag, occupationHasProfileTag } from '../../data/occupation_profiles';
import { roomSupports } from '../../data/room_affordances';
import { factionToTerritoryOwner } from '../../data/factions';
import { territoryOwnerAt, territoryOwnerAtIndex } from '../territory';

export const NPC_EMERGENCY_DEFAULT_CANDIDATE_CAP = 12;
export const NPC_EMERGENCY_MAX_CANDIDATE_CAP = 24;
export const NPC_EMERGENCY_DEFAULT_NEARBY_RADIUS = 18;
export const NPC_EMERGENCY_MAX_NEARBY_RADIUS = 32;
export const NPC_EMERGENCY_DEFAULT_NEARBY_ROOM_CAP = 8;
export const NPC_EMERGENCY_DEFAULT_SHELTER_SCAN_CAP = 24;
export const NPC_EMERGENCY_DEFAULT_LOCAL_SHELTER_SCAN_CAP = 16;
export const NPC_EMERGENCY_DEFAULT_LOCAL_ACTOR_CAP = 16;
export const NPC_EMERGENCY_ROOM_TARGET_SCAN_CAP = 96;
export const NPC_EMERGENCY_DOOR_SCAN_CAP = 6;

export type NpcEmergencyPhase = 'warning' | 'active';

export type NpcEmergencyRole =
  | 'citizen'
  | 'scientist'
  | 'liquidator'
  | 'cultist'
  | 'wild'
  | 'traveler';

export type NpcEmergencyIntentKind =
  | 'seek_shelter'
  | 'escort_civilians'
  | 'hold_corridor'
  | 'guard_shelter'
  | 'ritual_pressure'
  | 'raid_supplies'
  | 'ambush'
  | 'scatter'
  | 'freeze';

export type NpcEmergencyShelterSource =
  | 'current_room'
  | 'assigned_room'
  | 'home_room'
  | 'samosbor_shelter'
  | 'local_shelter'
  | 'nearby_room';

export interface NpcEmergencyIntent {
  kind: NpcEmergencyIntentKind;
  role: NpcEmergencyRole;
  phase: NpcEmergencyPhase;
  aiGoal: AIGoal;
  npcState?: NpcState;
  urgency: number;
  shelterBias: number;
  defenseBias: number;
  panic: number;
  reason: string;
}

export interface NpcEmergencyShelterCandidate {
  roomId: number;
  source: NpcEmergencyShelterSource;
  sources: readonly NpcEmergencyShelterSource[];
  roomType: RoomType;
  x: number;
  y: number;
  targetCellX: number;
  targetCellY: number;
  dist2: number;
  score: number;
  doorScore: number;
  factionScore: number;
  dangerPenalty: number;
  crowdPenalty: number;
  jitter: number;
  passable: boolean;
  currentRoom: boolean;
  entryOpen: boolean;
  sealed: boolean;
}

export interface NpcEmergencyOptions {
  phase?: NpcEmergencyPhase;
  shelterRoomIds?: readonly number[];
  localShelterRoomIds?: readonly number[];
  preferredRoomIds?: readonly number[];
  homeRoomId?: number;
  candidateCap?: number;
  shelterScanCap?: number;
  localShelterScanCap?: number;
  nearbyRadius?: number;
  nearbyRoomCap?: number;
  includeNearbyRooms?: boolean;
  localActors?: readonly Entity[];
  localActorCap?: number;
  player?: Entity;
  pressureX?: number;
  pressureY?: number;
  seedSalt?: number;
}

export interface NpcEmergencyDecision {
  npcId: number;
  phase: NpcEmergencyPhase;
  role: NpcEmergencyRole;
  intent: NpcEmergencyIntent;
  targetRoomId: number;
  targetX: number;
  targetY: number;
  targetCellX: number;
  targetCellY: number;
  candidates: readonly NpcEmergencyShelterCandidate[];
  jitter: number;
  rethinkAfterSec: number;
}

interface CandidateDraft {
  roomId: number;
  sources: NpcEmergencyShelterSource[];
}

interface DoorProfile {
  score: number;
  entryOpen: boolean;
}

export function npcEmergencyJitter(npc: Entity, salt = 0): number {
  let h = 2166136261 ^ salt;
  h = mixHash(h, npc.id);
  h = mixHash(h, npc.alifeId ?? 0);
  h = mixHash(h, npc.familyId ?? 0);
  h = mixHash(h, npc.faction ?? -1);
  h = mixHash(h, npc.occupation ?? -1);
  h = mixHash(h, npc.playerRelation ?? 0);
  h = mixStringHash(h, npc.persistentNpcId ?? npc.plotNpcId ?? npc.name ?? '');
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function getNpcEmergencyRole(npc: Entity): NpcEmergencyRole {
  switch (npc.faction) {
    case Faction.LIQUIDATOR: return 'liquidator';
    case Faction.CULTIST: return 'cultist';
    case Faction.WILD: return 'wild';
    case Faction.SCIENTIST: return 'scientist';
    default: break;
  }
  if (npc.occupation === Occupation.CIVIL_DEFENSE) {
    return 'liquidator';
  }
  if (npc.isTraveler || occupationHasAnyProfileTag(npc.occupation, ['traveler', 'patrol', 'combat'])) {
    return 'traveler';
  }
  if (occupationHasProfileTag(npc.occupation, 'science') || occupationHasProfileTag(npc.occupation, 'medical')) return 'scientist';
  return 'citizen';
}

export function chooseNpcEmergencyIntent(npc: Entity, options: Pick<NpcEmergencyOptions, 'phase' | 'seedSalt'> = {}): NpcEmergencyIntent {
  const phase = options.phase ?? 'active';
  const role = getNpcEmergencyRole(npc);
  const jitter = npcEmergencyJitter(npc, (options.seedSalt ?? 0) ^ (phase === 'active' ? 0x51f15 : 0x31a7));
  const hpRatio = npc.hp !== undefined && npc.maxHp !== undefined && npc.maxHp > 0 ? npc.hp / npc.maxHp : 1;
  const wounded = hpRatio < 0.45;
  const armed = !!npc.weapon || occupationHasProfileTag(npc.occupation, 'combat') || npc.faction === Faction.LIQUIDATOR;
  const activeBonus = phase === 'active' ? 0.35 : 0;

  if (wounded) {
    return makeIntent('seek_shelter', role, phase, 0.92 + activeBonus, 18, -4, 0.55 + activeBonus, 'wounded');
  }

  switch (role) {
    case 'liquidator':
      if (phase === 'warning' && jitter < 0.42) {
        return makeIntent('escort_civilians', role, phase, 0.72, 10, 10, 0.18, 'liquidator_warning_escort');
      }
      return makeIntent(armed ? 'hold_corridor' : 'seek_shelter', role, phase, armed ? 0.8 + activeBonus : 0.72 + activeBonus, armed ? 4 : 12, armed ? 18 : 2, armed ? 0.1 : 0.34, armed ? 'liquidator_hold' : 'unarmed_liquidator');

    case 'cultist':
      if (phase === 'active' && jitter < 0.58) {
        return makeIntent('ritual_pressure', role, phase, 0.78, 3, 9, 0.08, 'cultist_ritual');
      }
      return makeIntent('guard_shelter', role, phase, 0.68 + activeBonus, 8, 11, 0.16, 'cultist_guard');

    case 'wild':
      if (phase === 'warning' && jitter < 0.52) {
        return makeIntent('raid_supplies', role, phase, 0.62, 3, 3, 0.22, 'wild_raid_warning');
      }
      if (armed && jitter > 0.62) {
        return makeIntent('ambush', role, phase, 0.68 + activeBonus, 2, 8, 0.2, 'wild_ambush');
      }
      return makeIntent('scatter', role, phase, 0.74 + activeBonus, 6, 0, 0.44, 'wild_scatter');

    case 'traveler':
      return makeIntent('seek_shelter', role, phase, 0.84 + activeBonus, 14, 1, 0.38 + activeBonus * 0.6, 'traveler_nearest_safe');

    case 'scientist':
      return makeIntent('seek_shelter', role, phase, 0.8 + activeBonus, 16, 0, 0.42 + activeBonus * 0.7, 'scientist_shelter');

    case 'citizen':
    default:
      if (phase === 'active' && jitter > 0.94) {
        return makeIntent('freeze', role, phase, 0.96, 20, -8, 0.9, 'civilian_freeze');
      }
      return makeIntent('seek_shelter', role, phase, 0.78 + activeBonus, 15, 0, 0.48 + activeBonus * 0.8, 'civilian_shelter');
  }
}

export function collectNpcEmergencyShelterCandidates(world: World, npc: Entity, options: NpcEmergencyOptions = {}): readonly NpcEmergencyShelterCandidate[] {
  const intent = chooseNpcEmergencyIntent(npc, options);
  const drafts = new Map<number, CandidateDraft>();
  const currentRoom = world.roomAt(npc.x, npc.y);

  if (currentRoom) addDraft(drafts, currentRoom.id, 'current_room');
  if (validRoomId(npc.assignedRoomId)) addDraft(drafts, npc.assignedRoomId!, 'assigned_room');
  if (validRoomId(options.homeRoomId)) addDraft(drafts, options.homeRoomId!, 'home_room');
  addRoomIds(drafts, options.preferredRoomIds, 'home_room', options.localShelterScanCap ?? NPC_EMERGENCY_DEFAULT_LOCAL_SHELTER_SCAN_CAP);
  addRoomIds(
    drafts,
    options.localShelterRoomIds,
    'local_shelter',
    options.localShelterScanCap ?? NPC_EMERGENCY_DEFAULT_LOCAL_SHELTER_SCAN_CAP,
    npcEmergencyJitter(npc, (options.seedSalt ?? 0) ^ 0x1c0a15),
  );
  addRoomIds(
    drafts,
    options.shelterRoomIds,
    'samosbor_shelter',
    options.shelterScanCap ?? NPC_EMERGENCY_DEFAULT_SHELTER_SCAN_CAP,
    npcEmergencyJitter(npc, (options.seedSalt ?? 0) ^ 0x5afe),
  );

  if (options.includeNearbyRooms !== false) {
    collectNearbyRooms(world, npc, drafts, options.nearbyRadius, options.nearbyRoomCap);
  }

  const cap = clampInt(options.candidateCap ?? NPC_EMERGENCY_DEFAULT_CANDIDATE_CAP, 1, NPC_EMERGENCY_MAX_CANDIDATE_CAP);
  const candidates: NpcEmergencyShelterCandidate[] = [];
  for (const draft of drafts.values()) {
    const room = world.rooms[draft.roomId];
    if (!room) continue;
    const candidate = scoreNpcEmergencyShelterCandidate(world, npc, room, draft.sources, intent, options, currentRoom?.id ?? -1);
    if (candidate) candidates.push(candidate);
  }

  candidates.sort((a, b) => b.score - a.score || a.dist2 - b.dist2 || a.roomId - b.roomId);
  return candidates.slice(0, cap);
}

export function chooseNpcEmergencyDecision(world: World, npc: Entity, options: NpcEmergencyOptions = {}): NpcEmergencyDecision {
  const phase = options.phase ?? 'active';
  const intent = chooseNpcEmergencyIntent(npc, options);
  const candidates = collectNpcEmergencyShelterCandidates(world, npc, options);
  const best = candidates[0];
  const fallbackX = world.wrap(Math.floor(npc.x));
  const fallbackY = world.wrap(Math.floor(npc.y));
  const jitter = npcEmergencyJitter(npc, (options.seedSalt ?? 0) ^ 0x7249 ^ (phase === 'active' ? 7 : 3));
  return {
    npcId: npc.id,
    phase,
    role: intent.role,
    intent,
    targetRoomId: best?.roomId ?? -1,
    targetX: best?.x ?? npc.x,
    targetY: best?.y ?? npc.y,
    targetCellX: best?.targetCellX ?? fallbackX,
    targetCellY: best?.targetCellY ?? fallbackY,
    candidates,
    jitter,
    rethinkAfterSec: 1.4 + jitter * (phase === 'active' ? 1.8 : 4.2),
  };
}

export function applyNpcEmergencyDecision(npc: Entity, decision: NpcEmergencyDecision): boolean {
  if (npc.type !== EntityType.NPC || !npc.alive || !npc.ai) return false;
  const ai = npc.ai;
  ai.goal = decision.intent.aiGoal;
  if (decision.intent.npcState !== undefined) ai.npcState = decision.intent.npcState;
  ai.tx = decision.targetCellX;
  ai.ty = decision.targetCellY;
  ai.path = [];
  ai.pi = 0;
  ai.stuck = 0;
  ai.timer = 0;
  ai.stateTimer = 0;
  return true;
}

export function scoreNpcEmergencyShelterCandidate(
  world: World,
  npc: Entity,
  room: Room,
  sources: readonly NpcEmergencyShelterSource[],
  intent: NpcEmergencyIntent,
  options: NpcEmergencyOptions = {},
  currentRoomId = world.roomAt(npc.x, npc.y)?.id ?? -1,
): NpcEmergencyShelterCandidate | null {
  if (!isCandidateRoom(room, sources)) return null;

  const target = resolveRoomTarget(world, room);
  const dist2 = world.dist2(npc.x, npc.y, target.x + 0.5, target.y + 0.5);
  const dist = Math.sqrt(dist2);
  const door = roomDoorProfile(world, room, currentRoomId === room.id);
  const factionScore = roomFactionScore(world, npc, room, target.x, target.y);
  const dangerPenalty = roomDangerPenalty(world, room, target.x, target.y, intent, options);
  const crowdPenalty = roomCrowdPenalty(world, room.id, options.localActors, options.localActorCap);
  const sourceScore = sourceBias(sources);
  const roleScore = roleRoomBias(intent, room);
  const playerScore = playerShelterScore(world, npc, room.id, options.player);
  const passableScore = target.passable ? 6 : -18;
  const sealedScore = room.sealed ? (currentRoomId === room.id ? 30 : 6) : 0;
  const inaccessiblePenalty = !door.entryOpen && currentRoomId !== room.id ? 16 : 0;
  const distancePenalty = dist * (intent.kind === 'seek_shelter' || intent.kind === 'freeze' ? 0.72 : 0.48);
  const jitter = (npcEmergencyJitter(npc, (options.seedSalt ?? 0) ^ (room.id * 1103515245)) - 0.5) * 5;

  const score =
    sourceScore +
    roleScore +
    intent.shelterBias +
    door.score +
    factionScore +
    playerScore +
    passableScore +
    sealedScore -
    distancePenalty -
    dangerPenalty -
    crowdPenalty -
    inaccessiblePenalty +
    jitter;

  const primarySource = primaryCandidateSource(sources);
  return {
    roomId: room.id,
    source: primarySource,
    sources: [...sources],
    roomType: room.type,
    x: target.x + 0.5,
    y: target.y + 0.5,
    targetCellX: target.x,
    targetCellY: target.y,
    dist2,
    score,
    doorScore: door.score,
    factionScore,
    dangerPenalty,
    crowdPenalty,
    jitter,
    passable: target.passable,
    currentRoom: currentRoomId === room.id,
    entryOpen: door.entryOpen,
    sealed: room.sealed,
  };
}

function makeIntent(
  kind: NpcEmergencyIntentKind,
  role: NpcEmergencyRole,
  phase: NpcEmergencyPhase,
  urgency: number,
  shelterBias: number,
  defenseBias: number,
  panic: number,
  reason: string,
): NpcEmergencyIntent {
  return {
    kind,
    role,
    phase,
    aiGoal: goalForIntent(kind),
    npcState: npcStateForIntent(kind),
    urgency: Math.min(1, urgency),
    shelterBias,
    defenseBias,
    panic: Math.min(1, panic),
    reason,
  };
}

function goalForIntent(kind: NpcEmergencyIntentKind): AIGoal {
  switch (kind) {
    case 'seek_shelter':
    case 'freeze':
      return AIGoal.HIDE;
    case 'scatter':
      return AIGoal.FLEE;
    case 'hold_corridor':
    case 'ambush':
      return AIGoal.HUNT;
    default:
      return AIGoal.GOTO;
  }
}

function npcStateForIntent(kind: NpcEmergencyIntentKind): NpcState | undefined {
  switch (kind) {
    case 'seek_shelter':
    case 'freeze':
      return NpcState.HIDING;
    case 'hold_corridor':
    case 'guard_shelter':
    case 'escort_civilians':
      return NpcState.PATROL;
    case 'ritual_pressure':
      return NpcState.MEETING;
    case 'raid_supplies':
    case 'ambush':
    case 'scatter':
      return NpcState.TRAVELING;
    default:
      return undefined;
  }
}

function mixHash(h: number, value: number): number {
  h ^= value | 0;
  return Math.imul(h, 16777619);
}

function mixStringHash(h: number, value: string): number {
  for (let i = 0; i < value.length; i++) h = mixHash(h, value.charCodeAt(i));
  return h;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value | 0));
}

function validRoomId(roomId: number | undefined): boolean {
  return roomId !== undefined && roomId >= 0 && Number.isFinite(roomId);
}

function addRoomIds(
  drafts: Map<number, CandidateDraft>,
  roomIds: readonly number[] | undefined,
  source: NpcEmergencyShelterSource,
  scanCap: number,
  offset01 = 0,
): void {
  if (!roomIds || roomIds.length === 0) return;
  const cap = clampInt(scanCap, 0, 128);
  const count = Math.min(roomIds.length, cap);
  const start = roomIds.length > 0 ? Math.floor(Math.max(0, Math.min(0.999999, offset01)) * roomIds.length) % roomIds.length : 0;
  for (let i = 0; i < count; i++) addDraft(drafts, roomIds[(start + i) % roomIds.length], source);
}

function addDraft(drafts: Map<number, CandidateDraft>, roomId: number, source: NpcEmergencyShelterSource): void {
  if (!validRoomId(roomId)) return;
  const draft = drafts.get(roomId);
  if (!draft) {
    drafts.set(roomId, { roomId, sources: [source] });
    return;
  }
  if (!draft.sources.includes(source)) draft.sources.push(source);
}

function collectNearbyRooms(
  world: World,
  npc: Entity,
  drafts: Map<number, CandidateDraft>,
  requestedRadius = NPC_EMERGENCY_DEFAULT_NEARBY_RADIUS,
  requestedCap = NPC_EMERGENCY_DEFAULT_NEARBY_ROOM_CAP,
): void {
  const radius = clampInt(requestedRadius, 0, NPC_EMERGENCY_MAX_NEARBY_RADIUS);
  const cap = clampInt(requestedCap, 0, NPC_EMERGENCY_MAX_CANDIDATE_CAP);
  if (radius <= 0 || cap <= 0) return;
  const cx = world.wrap(Math.floor(npc.x));
  const cy = world.wrap(Math.floor(npc.y));
  let found = 0;
  for (let r = 1; r <= radius && found < cap; r++) {
    for (let dx = -r; dx <= r && found < cap; dx++) {
      found += tryAddNearbyRoom(world, drafts, cx + dx, cy - r);
      if (found >= cap) break;
      found += tryAddNearbyRoom(world, drafts, cx + dx, cy + r);
    }
    for (let dy = -r + 1; dy <= r - 1 && found < cap; dy++) {
      found += tryAddNearbyRoom(world, drafts, cx - r, cy + dy);
      if (found >= cap) break;
      found += tryAddNearbyRoom(world, drafts, cx + r, cy + dy);
    }
  }
}

function tryAddNearbyRoom(world: World, drafts: Map<number, CandidateDraft>, x: number, y: number): 0 | 1 {
  const roomId = world.roomMap[world.idx(x, y)];
  if (roomId < 0) return 0;
  const room = world.rooms[roomId];
  if (!room || !isShelterLikeRoom(room)) return 0;
  const before = drafts.size;
  addDraft(drafts, roomId, 'nearby_room');
  return drafts.size > before ? 1 : 0;
}

function isCandidateRoom(room: Room, sources: readonly NpcEmergencyShelterSource[]): boolean {
  if (sources.includes('current_room') || sources.includes('assigned_room') || sources.includes('home_room')) return true;
  return isShelterLikeRoom(room);
}

function isShelterLikeRoom(room: Room): boolean {
  return roomSupports(room.type, 'shelter');
}

function resolveRoomTarget(world: World, room: Room): { x: number; y: number; passable: boolean } {
  const centerX = world.wrap(room.x + Math.floor(room.w / 2));
  const centerY = world.wrap(room.y + Math.floor(room.h / 2));
  if (roomContainsPassable(world, room, centerX, centerY)) return { x: centerX, y: centerY, passable: true };

  const area = Math.max(1, room.w * room.h);
  const start = Math.floor(npcEmergencyRoomSeed(room.id) * area);
  const scan = Math.min(area, NPC_EMERGENCY_ROOM_TARGET_SCAN_CAP);
  for (let i = 0; i < scan; i++) {
    const offset = (start + i) % area;
    const x = world.wrap(room.x + (offset % room.w));
    const y = world.wrap(room.y + ((offset / room.w) | 0));
    if (roomContainsPassable(world, room, x, y)) return { x, y, passable: true };
  }
  return { x: centerX, y: centerY, passable: false };
}

function npcEmergencyRoomSeed(roomId: number): number {
  let h = 2166136261;
  h = mixHash(h, roomId);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function roomContainsPassable(world: World, room: Room, x: number, y: number): boolean {
  const idx = world.idx(x, y);
  return world.roomMap[idx] === room.id && !world.solid(x, y);
}

function roomDoorProfile(world: World, room: Room, alreadyInside: boolean): DoorProfile {
  if (room.doors.length === 0) return { score: alreadyInside ? 4 : -4, entryOpen: alreadyInside };
  let score = 0;
  let entryOpen = false;
  const cap = Math.min(room.doors.length, NPC_EMERGENCY_DOOR_SCAN_CAP);
  for (let i = 0; i < cap; i++) {
    const door = world.doors.get(room.doors[i]);
    if (!door) continue;
    switch (door.state) {
      case DoorState.HERMETIC_CLOSED:
        score = Math.max(score, alreadyInside ? 26 : 5);
        break;
      case DoorState.HERMETIC_OPEN:
        score = Math.max(score, 20);
        entryOpen = true;
        break;
      case DoorState.CLOSED:
        score = Math.max(score, 10);
        entryOpen = true;
        break;
      case DoorState.LOCKED:
        score = Math.max(score, alreadyInside ? 14 : 2);
        break;
      case DoorState.OPEN:
      default:
        score = Math.max(score, 4);
        entryOpen = true;
        break;
    }
  }
  return { score, entryOpen };
}

function sourceBias(sources: readonly NpcEmergencyShelterSource[]): number {
  let score = 0;
  for (const source of sources) {
    switch (source) {
      case 'local_shelter': score = Math.max(score, 34); break;
      case 'samosbor_shelter': score = Math.max(score, 30); break;
      case 'current_room': score = Math.max(score, 24); break;
      case 'assigned_room': score = Math.max(score, 22); break;
      case 'home_room': score = Math.max(score, 22); break;
      case 'nearby_room': score = Math.max(score, 8); break;
      default: break;
    }
  }
  return score;
}

function primaryCandidateSource(sources: readonly NpcEmergencyShelterSource[]): NpcEmergencyShelterSource {
  const priority: readonly NpcEmergencyShelterSource[] = ['local_shelter', 'samosbor_shelter', 'current_room', 'assigned_room', 'home_room', 'nearby_room'];
  for (const source of priority) if (sources.includes(source)) return source;
  return sources[0] ?? 'nearby_room';
}

function roleRoomBias(intent: NpcEmergencyIntent, room: Room): number {
  const roomBias = baseRoomBias(room.type);
  switch (intent.kind) {
    case 'hold_corridor':
      return roomBias + (room.type === RoomType.HQ ? 10 : 0) + (room.type === RoomType.COMMON ? 7 : 0) + Math.min(8, room.doors.length * 2);
    case 'escort_civilians':
      return roomBias + (room.type === RoomType.LIVING ? 9 : 0) + (room.type === RoomType.MEDICAL ? 5 : 0);
    case 'guard_shelter':
      return roomBias + (room.type === RoomType.HQ ? 10 : 0) + Math.min(10, room.doors.length * 2);
    case 'ritual_pressure':
      return roomBias + (room.type === RoomType.HQ ? 9 : 0) + (room.type === RoomType.COMMON ? 8 : 0) + (room.type === RoomType.LIVING ? -2 : 0);
    case 'raid_supplies':
      return roomBias + (room.type === RoomType.STORAGE ? 16 : 0) + (room.type === RoomType.KITCHEN ? 10 : 0);
    case 'ambush':
      return roomBias + Math.min(12, room.doors.length * 3) + (room.type === RoomType.COMMON ? 6 : 0);
    case 'scatter':
      return roomBias + (room.type === RoomType.COMMON ? 6 : 0) + (room.type === RoomType.LIVING ? 4 : 0);
    case 'freeze':
      return roomBias + (room.type === RoomType.LIVING ? 10 : 0);
    case 'seek_shelter':
    default:
      return roomBias + (room.type === RoomType.LIVING ? 8 : 0) + (room.type === RoomType.MEDICAL ? 4 : 0);
  }
}

function baseRoomBias(type: RoomType): number {
  switch (type) {
    case RoomType.LIVING: return 12;
    case RoomType.HQ: return 11;
    case RoomType.MEDICAL: return 8;
    case RoomType.STORAGE: return 7;
    case RoomType.OFFICE: return 5;
    case RoomType.COMMON: return 3;
    case RoomType.KITCHEN: return -1;
    case RoomType.BATHROOM: return -3;
    case RoomType.PRODUCTION: return -3;
    case RoomType.SMOKING: return -4;
    case RoomType.CORRIDOR: return -12;
    default: return 0;
  }
}

function roomFactionScore(world: World, npc: Entity, room: Room, targetX: number, targetY: number): number {
  void room;
  const owner = territoryOwnerAt(world, targetX, targetY);
  if (owner === ZoneFaction.SAMOSBOR) return npc.faction === Faction.CULTIST ? -4 : -18;
  const own = npc.faction === undefined ? ZoneFaction.CITIZEN : factionToTerritoryOwner(npc.faction);
  if (owner === own) return 11;
  if (npc.faction === Faction.SCIENTIST && owner === ZoneFaction.CITIZEN) return 7;
  if (npc.faction === Faction.CITIZEN && owner === ZoneFaction.WILD) return -12;
  if (npc.faction === Faction.WILD && owner === ZoneFaction.CITIZEN) return -6;
  return -8;
}

function roomDangerPenalty(world: World, room: Room, targetX: number, targetY: number, intent: NpcEmergencyIntent, options: NpcEmergencyOptions): number {
  const idx = world.idx(targetX, targetY);
  const zone = world.zones[world.zoneMap[idx]];
  let penalty = world.fog[idx] / 12;
  if (zone?.fogged) penalty += 8;
  if (territoryOwnerAtIndex(world, idx) === ZoneFaction.SAMOSBOR) penalty += 12;
  if (options.pressureX !== undefined && options.pressureY !== undefined) {
    const d = Math.sqrt(world.dist2(room.x + room.w / 2, room.y + room.h / 2, options.pressureX, options.pressureY));
    penalty += Math.max(0, 24 - d) * 0.45;
  }
  if (intent.kind === 'ritual_pressure') penalty *= 0.35;
  if (intent.kind === 'hold_corridor' || intent.kind === 'guard_shelter') penalty *= 0.75;
  return penalty;
}

function roomCrowdPenalty(world: World, roomId: number, actors: readonly Entity[] | undefined, requestedCap = NPC_EMERGENCY_DEFAULT_LOCAL_ACTOR_CAP): number {
  if (!actors || actors.length === 0) return 0;
  const cap = clampInt(requestedCap, 0, 64);
  if (cap <= 0) return 0;
  let count = 0;
  for (const actor of actors) {
    if (!actor.alive || (!isPlayerEntity(actor) && actor.type !== EntityType.NPC && actor.type !== EntityType.MONSTER)) continue;
    if (world.roomAt(actor.x, actor.y)?.id !== roomId) continue;
    count++;
    if (count >= cap) break;
  }
  return Math.max(0, count - 2) * 4;
}

function playerShelterScore(world: World, npc: Entity, roomId: number, player: Entity | undefined): number {
  if (!player?.alive) return 0;
  const playerRoom = world.roomAt(player.x, player.y);
  if (!playerRoom || playerRoom.id !== roomId) return 0;
  const relation = npc.playerRelation ?? 0;
  if (relation <= -40) return -18 + relation / 10;
  if (relation >= 40) return 6 + relation / 25;
  return -2;
}
