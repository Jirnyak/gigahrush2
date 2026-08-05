/* ── Hermodoor borer: bounded shelter-risk encounter ─────────── */

import {
  W, Cell, DoorState, EntityType, AIGoal, MonsterKind, FloorLevel, RoomType,
  type Entity, type GameState, type Room,
  msg,
} from '../core/types';
import { World } from '../core/world';
import { MONSTERS } from '../entities/monster';
import { monsterSpr } from '../render/sprite_index';
import { stampMark, MarkType } from './surface_marks';
import { equippedToolLightScore } from '../data/tool_lights';
import { playBreak, playDoor, playSoundAt } from './audio';
import { setDoorState } from './door_state';
import { publishEvent } from './events';
import { addItem, hasItem, removeItem } from './inventory';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from './rpg';
import { isPlayerEntity, getCurrentPlayerId } from './player_actor';
import { ensureEntityIndex } from './entity_index';

type BorerSource = 'pre_samosbor' | 'post_samosbor' | 'debug';
type BorerPhase = 'warning' | 'damaged' | 'compromised' | 'repaired' | 'resolved';
type DoorDamagePhase = 'warning' | 'damaged' | 'compromised';

interface BorerTarget {
  doorIdx: number;
  roomId: number;
  roomName: string;
  zoneId: number;
  d2: number;
}

interface BorerDoorRecord {
  doorIdx: number;
  roomId: number;
  roomName: string;
  zoneId: number;
  floor: FloorLevel;
  cycle: number;
  phase: DoorDamagePhase;
  detectedAt: number;
  damageAt: number;
  compromisedAt?: number;
}

interface BorerRuntime {
  id: number;
  floor: FloorLevel;
  cycle: number;
  source: BorerSource;
  targetDoorIdx: number;
  targetRoomId: number;
  targetRoomName: string;
  zoneId: number;
  monsterId: number;
  spawnedAt: number;
  damageAt: number;
  nextPulseAt: number;
  nextLightAt: number;
  nextTrapAt: number;
  lightDelayUsed: number;
  phase: BorerPhase;
}

interface BorerStore {
  active: BorerRuntime | null;
  doorRecords: Map<number, BorerDoorRecord>;
  lastPreCycle: number;
  queuedPostCycle: number;
  lastPostCycle: number;
  nextId: number;
}

const PRE_SAMOSBOR_CHANCE = 0.35;
const POST_SAMOSBOR_CHANCE = 0.22;
const PREWARNING_WINDOW = 18;
const BORER_DAMAGE_DELAY = 18;
const BORER_DEBUG_DAMAGE_DELAY = 9;
const BORER_PULSE_INTERVAL = 4.5;
const BORER_LIGHT_RADIUS2 = 7 * 7;
const BORER_LIGHT_DELAY = 5;
const BORER_MAX_LIGHT_DELAY = 20;
const BORER_TRAP_RADIUS2 = 2.4 * 2.4;
const BORER_TARGET_RADIUS2 = 64 * 64;
const RUBBER_DOOR_WEDGE_ID = 'rubber_door_wedge';

const stores = new WeakMap<World, BorerStore>();

function storeFor(world: World): BorerStore {
  let store = stores.get(world);
  if (!store) {
    store = {
      active: null,
      doorRecords: new Map(),
      lastPreCycle: -1,
      queuedPostCycle: -1,
      lastPostCycle: -1,
      nextId: 1,
    };
    stores.set(world, store);
  }
  return store;
}

function findPlayer(entities: readonly Entity[]): Entity | undefined {
  const pid = getCurrentPlayerId();
  if (pid !== undefined) {
    const e = ensureEntityIndex(entities).byId.get(pid);
    if (e?.alive) return e;
  }
  return entities.find(e => isPlayerEntity(e) && e.alive);
}

function doorX(idx: number): number {
  return idx % W;
}

function doorY(idx: number): number {
  return (idx / W) | 0;
}

function borerFloorsAllowThreat(floor: FloorLevel): boolean {
  return floor !== FloorLevel.HELL && floor !== FloorLevel.VOID;
}

function occupiedApartmentIds(entities: readonly Entity[]): Set<number> {
  const out = new Set<number>();
  for (const e of entities) {
    if (e.type === EntityType.NPC && e.alive && e.familyId !== undefined && e.familyId >= 0) {
      out.add(e.familyId);
    }
  }
  return out;
}

function doorRoomPriority(room: Room, occupied: Set<number>, fallback: boolean): number {
  if (room.apartmentId >= 0) return occupied.has(room.apartmentId) ? 7000 : 5200;
  if (room.type === RoomType.LIVING) return 3600;
  if (room.type === RoomType.COMMON || room.type === RoomType.STORAGE) return fallback ? 1800 : 0;
  if (room.type === RoomType.PRODUCTION || room.type === RoomType.MEDICAL) return fallback ? 1200 : 0;
  return fallback ? 500 : 0;
}

function considerTarget(
  world: World,
  room: Room,
  doorIdx: number,
  player: Entity,
  occupied: Set<number>,
  fallback: boolean,
  best: BorerTarget | null,
): BorerTarget | null {
  const door = world.doors.get(doorIdx);
  if (!door || door.state === DoorState.LOCKED || world.cells[doorIdx] !== Cell.DOOR) return best;
  const priority = doorRoomPriority(room, occupied, fallback);
  if (priority <= 0) return best;
  const x = doorX(doorIdx);
  const y = doorY(doorIdx);
  const d2 = world.dist2(player.x, player.y, x + 0.5, y + 0.5);
  if (!fallback && d2 > BORER_TARGET_RADIUS2) return best;
  const score = priority - Math.sqrt(d2) * 12;
  const bestScore = best ? doorRoomPriority(world.rooms[best.roomId], occupied, true) - Math.sqrt(best.d2) * 12 : -Infinity;
  if (score <= bestScore) return best;
  return {
    doorIdx,
    roomId: room.id,
    roomName: room.name || 'укрытие',
    zoneId: world.zoneMap[doorIdx],
    d2,
  };
}

function chooseTargetDoor(world: World, entities: readonly Entity[], player: Entity): BorerTarget | null {
  const occupied = occupiedApartmentIds(entities);
  let best: BorerTarget | null = null;
  for (const room of world.rooms) {
    if (!room || room.doors.length === 0) continue;
    for (const doorIdx of room.doors) {
      best = considerTarget(world, room, doorIdx, player, occupied, false, best);
    }
  }
  if (best) return best;
  for (const room of world.rooms) {
    if (!room || room.doors.length === 0) continue;
    for (const doorIdx of room.doors) {
      best = considerTarget(world, room, doorIdx, player, occupied, true, best);
    }
  }
  return best;
}

function floorExitNearDoor(world: World, doorIdx: number, preferredRoomId: number, preferOutside: boolean): { x: number; y: number } | null {
  const x = doorX(doorIdx);
  const y = doorY(doorIdx);
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  for (const dir of dirs) {
    const tx = world.wrap(x + dir.dx);
    const ty = world.wrap(y + dir.dy);
    const ti = world.idx(tx, ty);
    if (world.cells[ti] !== Cell.FLOOR && world.cells[ti] !== Cell.WATER) continue;
    if (world.aptMask[ti] && preferOutside) continue;
    const roomId = world.roomMap[ti];
    if (preferOutside && roomId === preferredRoomId) continue;
    if (!preferOutside && roomId !== preferredRoomId) continue;
    return { x: tx, y: ty };
  }
  return null;
}

function walkableNearDoor(world: World, doorIdx: number, preferredRoomId: number): { x: number; y: number } | null {
  const direct = floorExitNearDoor(world, doorIdx, preferredRoomId, true) ?? floorExitNearDoor(world, doorIdx, preferredRoomId, false);
  if (direct) return direct;
  const x = doorX(doorIdx);
  const y = doorY(doorIdx);
  for (let r = 2; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const tx = world.wrap(x + dx);
        const ty = world.wrap(y + dy);
        const ti = world.idx(tx, ty);
        if ((world.cells[ti] === Cell.FLOOR || world.cells[ti] === Cell.WATER) && !world.aptMask[ti]) return { x: tx, y: ty };
      }
    }
  }
  return null;
}

function spawnBorerMonster(
  world: World,
  entities: Entity[],
  nextEntityId: { v: number },
  target: BorerTarget,
): number {
  const pos = walkableNearDoor(world, target.doorIdx, target.roomId) ?? { x: doorX(target.doorIdx), y: doorY(target.doorIdx) };
  const def = MONSTERS[MonsterKind.SHOVNIK];
  const zone = world.zones[target.zoneId];
  const zoneLevel = zone?.level ?? 2;
  const hp = Math.max(26, Math.round(scaleMonsterHp(def.hp, zoneLevel) * 0.85));
  const monster: Entity = {
    id: nextEntityId.v++,
    type: EntityType.MONSTER,
    x: pos.x + 0.5,
    y: pos.y + 0.5,
    angle: Math.atan2((doorY(target.doorIdx) + 0.5) - (pos.y + 0.5), (doorX(target.doorIdx) + 0.5) - (pos.x + 0.5)),
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed * 0.95, zoneLevel),
    sprite: monsterSpr(MonsterKind.SHOVNIK),
    hp,
    maxHp: hp,
    name: 'Гермоточильщик',
    monsterKind: MonsterKind.SHOVNIK,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: doorX(target.doorIdx), ty: doorY(target.doorIdx), path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
  };
  entities.push(monster);
  return monster.id;
}

function markBorerDoor(world: World, doorIdx: number, seed: number, heavy: boolean): void {
  const x = doorX(doorIdx);
  const y = doorY(doorIdx);
  stampMark(world, x, y, 0.5, 0.5, heavy ? 0.48 : 0.32, MarkType.BULLET, seed, 210, 185, 95, heavy ? 230 : 185, true);
  stampMark(world, x, y, 0.45, 0.58, heavy ? 0.55 : 0.38, MarkType.SCORCH, seed + 17, 48, 42, 36, heavy ? 165 : 105, true);
}

function publishBorerEvent(
  state: GameState,
  rec: BorerDoorRecord,
  type: 'hermodoor_borer_detected' | 'hermodoor_borer_damage' | 'hermodoor_borer_repaired' | 'hermodoor_borer_compromised',
  severity: 3 | 4 | 5,
  privacy: 'local' | 'public',
  tags: readonly string[],
  data: Record<string, unknown> = {},
): void {
  publishEvent(state, {
    type,
    zoneId: rec.zoneId >= 0 ? rec.zoneId : undefined,
    roomId: rec.roomId,
    x: doorX(rec.doorIdx),
    y: doorY(rec.doorIdx),
    targetName: 'Гермодверь',
    severity,
    privacy,
    tags: ['hermodoor', 'borer', 'shelter_risk', ...tags].slice(0, 8),
    data: {
      doorIdx: rec.doorIdx,
      roomName: rec.roomName,
      samosborCount: rec.cycle,
      damageAt: rec.damageAt,
      ...data,
    },
  });
}

function startBorer(
  world: World,
  entities: Entity[],
  state: GameState,
  nextEntityId: { v: number },
  source: BorerSource,
): BorerRuntime | null {
  if (!borerFloorsAllowThreat(state.currentFloor)) return null;
  const store = storeFor(world);
  if (store.active && store.active.phase !== 'resolved' && store.active.phase !== 'repaired') return store.active;
  const player = findPlayer(entities);
  if (!player) return null;
  const target = chooseTargetDoor(world, entities, player);
  if (!target) return null;

  const delay = source === 'debug' ? BORER_DEBUG_DAMAGE_DELAY : BORER_DAMAGE_DELAY;
  const monsterId = spawnBorerMonster(world, entities, nextEntityId, target);
  const runtime: BorerRuntime = {
    id: store.nextId++,
    floor: state.currentFloor,
    cycle: state.samosborCount,
    source,
    targetDoorIdx: target.doorIdx,
    targetRoomId: target.roomId,
    targetRoomName: target.roomName,
    zoneId: target.zoneId,
    monsterId,
    spawnedAt: state.time,
    damageAt: state.time + delay,
    nextPulseAt: state.time + 2.5,
    nextLightAt: state.time,
    nextTrapAt: state.time + 1,
    lightDelayUsed: 0,
    phase: 'warning',
  };
  const rec: BorerDoorRecord = {
    doorIdx: target.doorIdx,
    roomId: target.roomId,
    roomName: target.roomName,
    zoneId: target.zoneId,
    floor: state.currentFloor,
    cycle: state.samosborCount,
    phase: 'warning',
    detectedAt: state.time,
    damageAt: runtime.damageAt,
  };
  store.active = runtime;
  store.doorRecords.set(target.doorIdx, rec);

  markBorerDoor(world, target.doorIdx, runtime.id * 1031, false);
  playSoundAt(playBreak, doorX(target.doorIdx) + 0.5, doorY(target.doorIdx) + 0.5);
  state.msgs.push(msg(
    `Гермоточильщик скребёт ${target.roomName}: дверь ещё держит ${Math.ceil(delay)}с.`,
    state.time,
    '#fb6',
  ));
  state.msgs.push(msg('Свет или УФ задержит его. Закройте дверь-ловушку, убейте, чините герметиком или ищите другое укрытие.', state.time, '#da8'));
  publishBorerEvent(state, rec, 'hermodoor_borer_detected', 4, 'local', [source, 'warning'], {
    monsterId,
    secondsToDamage: delay,
  });
  return runtime;
}

function activeMonster(entities: readonly Entity[], runtime: BorerRuntime): Entity | undefined {
  const e = ensureEntityIndex(entities).byId.get(runtime.monsterId);
  if (e) return e;
  return entities.find(e => e.id === runtime.monsterId);
}

function resolveActive(store: BorerStore, runtime: BorerRuntime, phase: BorerPhase): void {
  runtime.phase = phase;
  if (store.active?.id === runtime.id) store.active = null;
}

function applyLightCounterplay(world: World, entities: readonly Entity[], state: GameState, runtime: BorerRuntime, rec: BorerDoorRecord): void {
  if (state.time < runtime.nextLightAt || runtime.lightDelayUsed >= BORER_MAX_LIGHT_DELAY) return;
  const player = findPlayer(entities);
  if (!player || equippedToolLightScore(player.tool) <= 0) return;
  const monster = activeMonster(entities, runtime);
  const dx = doorX(runtime.targetDoorIdx) + 0.5;
  const dy = doorY(runtime.targetDoorIdx) + 0.5;
  const nearDoor = world.dist2(player.x, player.y, dx, dy) <= BORER_LIGHT_RADIUS2;
  const nearMonster = monster?.alive && world.dist2(player.x, player.y, monster.x, monster.y) <= BORER_LIGHT_RADIUS2;
  if (!nearDoor && !nearMonster) return;
  runtime.damageAt += BORER_LIGHT_DELAY;
  runtime.lightDelayUsed += BORER_LIGHT_DELAY;
  runtime.nextLightAt = state.time + 5;
  rec.damageAt = runtime.damageAt;
  state.msgs.push(msg('Свет сбил точильщика с шва. Дверь получила несколько лишних секунд.', state.time, '#fc8'));
  publishBorerEvent(state, rec, 'hermodoor_borer_detected', 3, 'local', ['light_counterplay'], {
    delayAdded: BORER_LIGHT_DELAY,
    totalDelay: runtime.lightDelayUsed,
  });
}

function applyTrapCounterplay(world: World, entities: readonly Entity[], state: GameState, runtime: BorerRuntime, rec: BorerDoorRecord): void {
  if (state.time < runtime.nextTrapAt) return;
  const door = world.doors.get(runtime.targetDoorIdx);
  if (!door || (door.state !== DoorState.CLOSED && door.state !== DoorState.HERMETIC_CLOSED)) return;
  const monster = activeMonster(entities, runtime);
  if (!monster?.alive) return;
  const d2 = world.dist2(monster.x, monster.y, doorX(runtime.targetDoorIdx) + 0.5, doorY(runtime.targetDoorIdx) + 0.5);
  if (d2 > BORER_TRAP_RADIUS2) return;
  runtime.nextTrapAt = state.time + 2.5;
  runtime.damageAt += 4;
  rec.damageAt = runtime.damageAt;
  monster.hp = Math.max(0, (monster.hp ?? 1) - 12);
  state.msgs.push(msg('Гермодверь прищемила точильщика. Он скребёт медленнее.', state.time, '#fc8'));
  playSoundAt(playDoor, doorX(runtime.targetDoorIdx) + 0.5, doorY(runtime.targetDoorIdx) + 0.5);
  if (monster.hp <= 0) {
    monster.alive = false;
    state.msgs.push(msg('Гермоточильщик затих в дверном шве.', state.time, '#9f8'));
    storeFor(world).doorRecords.delete(runtime.targetDoorIdx);
    resolveActive(storeFor(world), runtime, 'resolved');
  }
}

function damageDoor(world: World, state: GameState, runtime: BorerRuntime, rec: BorerDoorRecord): void {
  const door = world.doors.get(runtime.targetDoorIdx);
  if (!door) return;
  rec.phase = 'damaged';
  runtime.phase = 'damaged';
  setDoorState(world, door, door.state === DoorState.HERMETIC_CLOSED || door.state === DoorState.HERMETIC_OPEN
    ? DoorState.HERMETIC_OPEN
    : DoorState.OPEN);
  door.timer = 0;
  markBorerDoor(world, runtime.targetDoorIdx, runtime.id * 2053, true);
  playSoundAt(playBreak, doorX(runtime.targetDoorIdx) + 0.5, doorY(runtime.targetDoorIdx) + 0.5);
  state.msgs.push(msg(`Гермоточильщик испортил ${runtime.targetRoomName}. До закрытия ещё можно чинить.`, state.time, '#f86'));
  publishBorerEvent(state, rec, 'hermodoor_borer_damage', 4, 'local', [runtime.source, 'damaged'], {
    monsterId: runtime.monsterId,
  });
}

function pulseWarning(world: World, state: GameState, runtime: BorerRuntime): void {
  if (state.time < runtime.nextPulseAt) return;
  runtime.nextPulseAt = state.time + BORER_PULSE_INTERVAL;
  markBorerDoor(world, runtime.targetDoorIdx, runtime.id * 4099 + Math.floor(state.time), false);
  playSoundAt(playBreak, doorX(runtime.targetDoorIdx) + 0.5, doorY(runtime.targetDoorIdx) + 0.5);
  if (runtime.phase === 'warning') {
    state.msgs.push(msg(`Скрежет у гермодвери: ${Math.max(0, Math.ceil(runtime.damageAt - state.time))}с до поломки.`, state.time, '#ca8'));
  }
}

function clearStaleRecords(world: World, state: GameState): void {
  const store = storeFor(world);
  for (const [idx, rec] of store.doorRecords) {
    if (rec.floor !== state.currentFloor || !world.doors.has(idx) || world.cells[idx] !== Cell.DOOR) {
      store.doorRecords.delete(idx);
    }
  }
  const runtime = store.active;
  if (runtime && (runtime.floor !== state.currentFloor || !world.doors.has(runtime.targetDoorIdx))) {
    resolveActive(store, runtime, 'resolved');
  }
}

function maybeStartPreSamosbor(world: World, entities: Entity[], state: GameState, nextEntityId: { v: number }): void {
  if (state.samosborActive || state.samosborTimer > PREWARNING_WINDOW || state.samosborTimer <= 0) return;
  const store = storeFor(world);
  if (store.lastPreCycle === state.samosborCount) return;
  store.lastPreCycle = state.samosborCount;
  if (Math.random() > PRE_SAMOSBOR_CHANCE) return;
  startBorer(world, entities, state, nextEntityId, 'pre_samosbor');
}

function maybeStartPostSamosbor(world: World, entities: Entity[], state: GameState, nextEntityId: { v: number }): void {
  if (state.samosborActive) return;
  const store = storeFor(world);
  if (store.queuedPostCycle < 0 || store.lastPostCycle === store.queuedPostCycle) return;
  if (state.samosborCount !== store.queuedPostCycle) return;
  store.lastPostCycle = store.queuedPostCycle;
  store.queuedPostCycle = -1;
  if (Math.random() > POST_SAMOSBOR_CHANCE) return;
  startBorer(world, entities, state, nextEntityId, 'post_samosbor');
}

export function updateHermodoorBorer(
  world: World,
  entities: Entity[],
  state: GameState,
  _dt: number,
  nextEntityId: { v: number },
): void {
  clearStaleRecords(world, state);
  maybeStartPostSamosbor(world, entities, state, nextEntityId);
  maybeStartPreSamosbor(world, entities, state, nextEntityId);

  const store = storeFor(world);
  const runtime = store.active;
  if (!runtime || runtime.phase === 'resolved' || runtime.phase === 'repaired') return;
  const rec = store.doorRecords.get(runtime.targetDoorIdx);
  if (!rec) {
    resolveActive(store, runtime, 'resolved');
    return;
  }
  const monster = activeMonster(entities, runtime);
  if (runtime.phase === 'warning' && (!monster || !monster.alive)) {
    store.doorRecords.delete(runtime.targetDoorIdx);
    state.msgs.push(msg('Гермоточильщик убит до поломки. Дверь держит.', state.time, '#9f8'));
    resolveActive(store, runtime, 'resolved');
    return;
  }
  if (runtime.phase === 'warning') {
    applyLightCounterplay(world, entities, state, runtime, rec);
    applyTrapCounterplay(world, entities, state, runtime, rec);
    if (store.active?.id !== runtime.id) return;
    pulseWarning(world, state, runtime);
    if (state.time >= runtime.damageAt && store.active?.id === runtime.id) damageDoor(world, state, runtime, rec);
    return;
  }
  if (runtime.phase === 'damaged') pulseWarning(world, state, runtime);
}

export function queuePostSamosborHermodoorBorer(world: World, state: GameState): void {
  if (!borerFloorsAllowThreat(state.currentFloor)) return;
  const store = storeFor(world);
  store.queuedPostCycle = state.samosborCount;
}

export function clearHermodoorBorerForRebuild(world: World): void {
  const store = storeFor(world);
  store.active = null;
  store.doorRecords.clear();
}

function seedCompromiseLeak(world: World, rec: BorerDoorRecord): void {
  const x = doorX(rec.doorIdx);
  const y = doorY(rec.doorIdx);
  let touched = false;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy > 5) continue;
      const ci = world.idx(x + dx, y + dy);
      if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.DOOR) continue;
      if (world.fog[ci] < 92) {
        world.fog[ci] = 92;
        touched = true;
      }
    }
  }
  if (touched) world.markFogDirty();
  markBorerDoor(world, rec.doorIdx, rec.doorIdx ^ 0x6b6f72, true);
}

export function blocksHermodoorBorerSeal(world: World, state: GameState, doorIdx: number, roomId: number): boolean {
  const store = storeFor(world);
  const rec = store.doorRecords.get(doorIdx);
  if (!rec || rec.floor !== state.currentFloor || rec.roomId !== roomId) return false;
  if (rec.phase === 'warning') return false;
  const door = world.doors.get(doorIdx);
  if (!door) return false;
  setDoorState(world, door, DoorState.HERMETIC_OPEN);
  door.timer = 0;
  if (rec.phase === 'damaged') {
    rec.phase = 'compromised';
    rec.compromisedAt = state.time;
    const active = store.active;
    if (active?.targetDoorIdx === doorIdx) active.phase = 'compromised';
    seedCompromiseLeak(world, rec);
    state.msgs.push(msg(`Укрытие скомпрометировано: ${rec.roomName}. Ищите другой вход или чините сейчас.`, state.time, '#f44'));
    publishBorerEvent(state, rec, 'hermodoor_borer_compromised', 5, 'public', ['compromised', 'samosbor_seal'], {
      compromisedAt: state.time,
    });
  }
  return true;
}

function clearLeakNearDoor(world: World, doorIdx: number): void {
  const x = doorX(doorIdx);
  const y = doorY(doorIdx);
  let dirty = false;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy > 5) continue;
      const ci = world.idx(x + dx, y + dy);
      if (world.fog[ci] > 0 && world.fog[ci] <= 110) {
        world.fog[ci] = 0;
        dirty = true;
      }
    }
  }
  if (dirty) world.markFogDirty();
}

function repairSupply(player: Entity): { itemId: string; label: string; consume: boolean } | null {
  if (hasItem(player, 'sealant_tube')) return { itemId: 'sealant_tube', label: 'герметик', consume: true };
  if (hasItem(player, 'hermo_gasket')) return { itemId: 'hermo_gasket', label: 'гермоуплотнитель', consume: true };
  if (hasItem(player, RUBBER_DOOR_WEDGE_ID)) return { itemId: RUBBER_DOOR_WEDGE_ID, label: 'резиновый клин', consume: true };
  if (hasItem(player, 'wrench') || player.weapon === 'wrench') return { itemId: 'wrench', label: 'гаечный ключ', consume: false };
  return null;
}

export function tryRepairHermodoorBorerDamage(
  world: World,
  player: Entity,
  state: GameState,
  lookX: number,
  lookY: number,
): boolean {
  const doorIdx = world.idx(Math.floor(lookX), Math.floor(lookY));
  const store = storeFor(world);
  const rec = store.doorRecords.get(doorIdx);
  if (!rec || rec.floor !== state.currentFloor) return false;
  const supply = repairSupply(player);
  if (!supply) {
    if (rec.phase === 'warning') return false;
    state.msgs.push(msg('Нужен герметик, гермоуплотнитель или гаечный ключ.', state.time, '#f84'));
    return true;
  }
  if (supply.consume && !removeItem(player, supply.itemId, 1)) {
    state.msgs.push(msg('Ремонтный предмет не найден.', state.time, '#f84'));
    return true;
  }
  const door = world.doors.get(doorIdx);
  if (state.samosborActive) {
    const room = world.rooms[rec.roomId];
    if (room) {
      room.sealed = true;
      for (const di of room.doors) {
        const roomDoor = world.doors.get(di);
        if (!roomDoor) continue;
        setDoorState(world, roomDoor, DoorState.HERMETIC_CLOSED);
        roomDoor.timer = 0;
      }
    } else if (door) {
      setDoorState(world, door, DoorState.HERMETIC_CLOSED);
      door.timer = 0;
    }
  } else if (door) {
    setDoorState(world, door, DoorState.HERMETIC_OPEN);
    door.timer = 0;
  }
  clearLeakNearDoor(world, doorIdx);
  store.doorRecords.delete(doorIdx);
  const active = store.active;
  if (active?.targetDoorIdx === doorIdx) resolveActive(store, active, 'repaired');
  state.msgs.push(msg(`Гермодверь отремонтирована: ${supply.label}.`, state.time, '#8f8'));
  playSoundAt(playDoor, doorX(doorIdx) + 0.5, doorY(doorIdx) + 0.5);
  publishBorerEvent(state, rec, 'hermodoor_borer_repaired', 4, 'local', ['repaired'], {
    itemId: supply.itemId,
    consumed: supply.consume,
    repairedPhase: rec.phase,
  });
  return true;
}

function movePlayerToDoor(world: World, player: Entity, target: BorerRuntime): boolean {
  const spot = floorExitNearDoor(world, target.targetDoorIdx, target.targetRoomId, true)
    ?? floorExitNearDoor(world, target.targetDoorIdx, target.targetRoomId, false);
  if (!spot) return false;
  player.x = spot.x + 0.5;
  player.y = spot.y + 0.5;
  player.angle = Math.atan2((doorY(target.targetDoorIdx) + 0.5) - player.y, (doorX(target.targetDoorIdx) + 0.5) - player.x);
  player.pitch = 0;
  return true;
}

export function debugForceHermodoorBorer(
  world: World,
  player: Entity,
  entities: Entity[],
  state: GameState,
  nextEntityId: { v: number },
): string[] {
  addItem(player, 'flashlight', 1);
  addItem(player, 'uv_spotlight', 1);
  addItem(player, 'sealant_tube', 2);
  addItem(player, 'hermo_gasket', 1);
  addItem(player, RUBBER_DOOR_WEDGE_ID, 1);
  addItem(player, 'wrench', 1);
  const runtime = startBorer(world, entities, state, nextEntityId, 'debug');
  if (!runtime) return ['no suitable hermodoor target'];
  const rec = storeFor(world).doorRecords.get(runtime.targetDoorIdx);
  if (rec) rec.damageAt = runtime.damageAt;
  state.samosborTimer = Math.min(state.samosborTimer, 12);
  const moved = movePlayerToDoor(world, player, runtime);
  return [
    `target=${runtime.targetRoomName} door=(${doorX(runtime.targetDoorIdx)},${doorY(runtime.targetDoorIdx)}) moved=${moved ? 1 : 0}`,
    'kit=flashlight, uv_spotlight, sealant_tube, hermo_gasket, rubber_door_wedge, wrench; E repairs, closed door traps, killing prevents damage',
  ];
}
