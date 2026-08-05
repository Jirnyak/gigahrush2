/* ── UI-only map exploration memory ───────────────────────────── */

import { Cell, EntityType, QuestType, W, type Entity, type GameState, type Quest } from '../core/types';
import type { World } from '../core/world';
import { isQuestTargetOnCurrentFloor, resolveQuestTargetRoom } from './contracts';
import { getSamosborWaveDebugSnapshot } from './samosbor_wave';

const LOCAL_TRAIL_RADIUS = 2;
const QUEST_MARKER_REVEAL_RADIUS = 8;
const MAP_FOG_TICK_SECONDS = 4;
const MAP_FOG_START_SECONDS = 36;
const MAP_FOG_FULL_SECONDS = 120;
const MAP_FOG_TICK_WRAP = 0x10000;

interface MapExplorationRuntime {
  explored: Uint8Array;
  seenTick: Uint16Array;
  revealedRooms: Set<number>;
  revealedZones: Set<number>;
  initialized: boolean;
  initialZoneId: number;
  lastCell: number;
  lastSamosborWaveFogKey: string;
  currentTick: number;
  version: number;
}

const explorationByWorld = new WeakMap<World, MapExplorationRuntime>();

function emptyRuntime(): MapExplorationRuntime {
  return {
    explored: new Uint8Array(W * W),
    seenTick: new Uint16Array(W * W),
    revealedRooms: new Set(),
    revealedZones: new Set(),
    initialized: false,
    initialZoneId: -1,
    lastCell: -1,
    lastSamosborWaveFogKey: '',
    currentTick: 1,
    version: 0,
  };
}

function runtimeFor(world: World): MapExplorationRuntime {
  let runtime = explorationByWorld.get(world);
  if (!runtime) {
    runtime = emptyRuntime();
    explorationByWorld.set(world, runtime);
  }
  return runtime;
}

function walkableMapCell(cell: number): boolean {
  return cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.LIFT || cell === Cell.WATER || cell === Cell.ABYSS;
}

function mapFogTick(time: number): number {
  const seconds = Number.isFinite(time) ? Math.max(0, time) : 0;
  const tick = (Math.floor(seconds / MAP_FOG_TICK_SECONDS) + 1) & 0xffff;
  return tick === 0 ? 1 : tick;
}

function tickAgeSeconds(current: number, seen: number): number {
  if (seen === 0) return MAP_FOG_FULL_SECONDS;
  return (((current - seen + MAP_FOG_TICK_WRAP) & 0xffff) * MAP_FOG_TICK_SECONDS);
}

function syncRuntimeTime(runtime: MapExplorationRuntime, time: number): void {
  const tick = mapFogTick(time);
  if (tick === runtime.currentTick) return;
  runtime.currentTick = tick;
  runtime.version = (runtime.version + 1) | 0;
}

function touchCell(runtime: MapExplorationRuntime, idx: number): void {
  if (idx < 0 || idx >= runtime.explored.length) return;
  let changed = false;
  if (!runtime.explored[idx]) {
    runtime.explored[idx] = 1;
    changed = true;
  }
  if (runtime.seenTick[idx] !== runtime.currentTick) {
    runtime.seenTick[idx] = runtime.currentTick;
    changed = true;
  }
  if (changed) runtime.version = (runtime.version + 1) | 0;
}

export function resetMapExploration(world: World): void {
  explorationByWorld.delete(world);
}

export function revealMapRoom(world: World, roomId: number): void {
  const room = world.rooms[roomId];
  if (!room) return;
  const runtime = runtimeFor(world);
  if (runtime.revealedRooms.has(room.id)) return;
  runtime.revealedRooms.add(room.id);
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      const idx = world.idx(x, y);
      if (world.roomMap[idx] === room.id || walkableMapCell(world.cells[idx])) touchCell(runtime, idx);
    }
  }
  for (const doorIdx of room.doors) touchCell(runtime, doorIdx);
}

export function revealMapZone(world: World, zoneId: number): void {
  if (zoneId < 0) return;
  const runtime = runtimeFor(world);
  if (runtime.revealedZones.has(zoneId)) return;
  runtime.revealedZones.add(zoneId);
  for (let idx = 0; idx < runtime.explored.length; idx++) {
    if (world.zoneMap[idx] !== zoneId) continue;
    if (walkableMapCell(world.cells[idx])) touchCell(runtime, idx);
    const roomId = world.roomMap[idx];
    if (roomId >= 0) revealMapRoom(world, roomId);
  }
}

export function revealMapArea(world: World, x: number, y: number, radius: number): void {
  const runtime = runtimeFor(world);
  const cx = world.wrap(Math.floor(x));
  const cy = world.wrap(Math.floor(y));
  const r = Math.max(0, Math.floor(radius));
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const idx = world.idx(cx + dx, cy + dy);
      if (walkableMapCell(world.cells[idx])) touchCell(runtime, idx);
    }
  }
}

export function revealWholeMap(world: World): number {
  const runtime = runtimeFor(world);
  runtime.explored.fill(1);
  runtime.seenTick.fill(runtime.currentTick);
  runtime.version = (runtime.version + 1) | 0;
  runtime.revealedRooms.clear();
  for (const room of world.rooms) if (room) runtime.revealedRooms.add(room.id);
  runtime.revealedZones.clear();
  for (const zone of world.zones) if (zone) runtime.revealedZones.add(zone.id);
  return runtime.explored.length;
}

function hideMapArea(world: World, x: number, y: number, radius: number): void {
  const runtime = explorationByWorld.get(world);
  if (!runtime) return;
  const cx = world.wrap(Math.floor(x));
  const cy = world.wrap(Math.floor(y));
  const r = Math.max(0, Math.floor(radius));
  const r2 = r * r;
  const hiddenRooms = new Set<number>();
  const hiddenZones = new Set<number>();
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const idx = world.idx(cx + dx, cy + dy);
      if (runtime.explored[idx]) {
        runtime.explored[idx] = 0;
        runtime.seenTick[idx] = 0;
        runtime.version = (runtime.version + 1) | 0;
      }
      const roomId = world.roomMap[idx];
      if (roomId >= 0) hiddenRooms.add(roomId);
      hiddenZones.add(world.zoneMap[idx]);
    }
  }
  for (const roomId of hiddenRooms) runtime.revealedRooms.delete(roomId);
  for (const zoneId of hiddenZones) runtime.revealedZones.delete(zoneId);
  runtime.lastCell = -1;
}

function questHasMapRevealTarget(q: Quest): boolean {
  return q.targetRoom !== undefined ||
    q.targetRoomType !== undefined ||
    q.targetRoomName !== undefined ||
    q.targetZoneTag !== undefined ||
    q.targetMarker?.roomType !== undefined ||
    q.targetMarker?.roomName !== undefined ||
    q.targetMarker?.zoneTag !== undefined ||
    q.targetNpcId !== undefined ||
    q.targetPlotNpcId !== undefined ||
    q.targetMonsterKind !== undefined;
}

function questWithMarkerFallback(q: Quest): Quest {
  const marker = q.targetMarker;
  if (!marker) return q;
  return {
    ...q,
    targetRoomType: q.targetRoomType ?? marker.roomType,
    targetRoomName: q.targetRoomName ?? marker.roomName,
    targetZoneTag: q.targetZoneTag ?? marker.zoneTag,
  };
}

function questMarkerTargetOnCurrentFloor(q: Quest, state: GameState): boolean {
  if (!isQuestTargetOnCurrentFloor(q, state)) return false;
  if (
    q.targetFloor === undefined &&
    q.visitFloor === undefined &&
    q.targetRoute === undefined &&
    q.targetMarker?.floor !== undefined
  ) return q.targetMarker.floor === state.currentFloor;
  return true;
}

function revealQuestEntityMarker(world: World, e: Entity): void {
  if (!e.alive) return;
  const room = world.roomAt(e.x, e.y);
  if (room) {
    revealMapRoom(world, room.id);
  } else {
    revealMapArea(world, e.x, e.y, QUEST_MARKER_REVEAL_RADIUS);
  }
}

function revealNearestQuestMonsterMarker(
  world: World,
  player: Entity,
  entities: readonly Entity[],
  q: Quest,
): void {
  if (q.targetMonsterKind === undefined) return;
  let best: Entity | undefined;
  let bestD2 = Infinity;
  for (const e of entities) {
    if (!e.alive || e.type !== EntityType.MONSTER || e.monsterKind !== q.targetMonsterKind) continue;
    const d2 = world.dist2(player.x, player.y, e.x, e.y);
    if (d2 < bestD2) {
      best = e;
      bestD2 = d2;
    }
  }
  if (best) revealQuestEntityMarker(world, best);
}

export function revealQuestTargetOnMap(
  world: World,
  player: Entity,
  state: GameState,
  q: Quest,
  entities?: readonly Entity[],
): void {
  if (q.done || q.failed || !questHasMapRevealTarget(q)) return;
  if (!questMarkerTargetOnCurrentFloor(q, state)) return;

  const roomTarget = resolveQuestTargetRoom(world, questWithMarkerFallback(q), player);
  if (roomTarget) revealMapRoom(world, roomTarget.room.id);

  if (!entities?.length) return;
  const targetEntity = entities.find(e =>
    e.alive &&
    (
      (q.targetNpcId !== undefined && e.id === q.targetNpcId) ||
      (q.targetPlotNpcId !== undefined && e.plotNpcId === q.targetPlotNpcId)
    ),
  );
  if (targetEntity) {
    revealQuestEntityMarker(world, targetEntity);
  } else if (q.type === QuestType.KILL) {
    revealNearestQuestMonsterMarker(world, player, entities, q);
  }
}

export function updateMapExploration(world: World, player: Entity, _state: GameState): void {
  const runtime = runtimeFor(world);
  syncRuntimeTime(runtime, _state.time);
  const px = Math.floor(player.x);
  const py = Math.floor(player.y);
  const cellIdx = world.idx(px, py);
  if (!runtime.initialized) {
    runtime.initialized = true;
    runtime.initialZoneId = world.zoneMap[cellIdx];
    revealMapZone(world, runtime.initialZoneId);
  }
  if (cellIdx !== runtime.lastCell || runtime.seenTick[cellIdx] !== runtime.currentTick) {
    runtime.lastCell = cellIdx;
    revealMapArea(world, px, py, LOCAL_TRAIL_RADIUS);
  }
}

export function syncMapExplorationAfterSamosborWave(world: World, state: GameState): void {
  const snapshot = getSamosborWaveDebugSnapshot();
  if (!snapshot || snapshot.active || !snapshot.finished || snapshot.fieldCells <= 0) return;
  const runtime = explorationByWorld.get(world);
  if (!runtime) return;
  const key = `${state.currentFloor}:${state.samosborCount}:${snapshot.originIdx}:${snapshot.fieldCells}:${snapshot.regeneratedCells}`;
  if (runtime.lastSamosborWaveFogKey === key) return;
  runtime.lastSamosborWaveFogKey = key;
  hideMapArea(world, snapshot.originIdx % W, (snapshot.originIdx / W) | 0, snapshot.fieldRadius + 2);
}

/** Hide specific cells on the map — re-fogs areas changed by samosbor fronts */
export function hideMapExplorationCells(world: World, cells: ReadonlySet<number>): void {
  const runtime = explorationByWorld.get(world);
  if (!runtime || cells.size === 0) return;
  const hiddenRooms = new Set<number>();
  const hiddenZones = new Set<number>();
  for (const idx of cells) {
    if (runtime.explored[idx]) {
      runtime.explored[idx] = 0;
      runtime.seenTick[idx] = 0;
    }
    const roomId = world.roomMap[idx];
    if (roomId >= 0) hiddenRooms.add(roomId);
    const zoneId = world.zoneMap[idx];
    if (zoneId >= 0) hiddenZones.add(zoneId);
  }
  for (const roomId of hiddenRooms) runtime.revealedRooms.delete(roomId);
  for (const zoneId of hiddenZones) runtime.revealedZones.delete(zoneId);
  runtime.version = (runtime.version + 1) | 0;
  runtime.lastCell = -1;
}

export function isMapCellExplored(world: World, idx: number): boolean {
  const runtime = explorationByWorld.get(world);
  return !runtime || runtime.explored[idx] !== 0;
}

export function mapCellFogAmount(world: World, idx: number): number {
  const runtime = explorationByWorld.get(world);
  if (!runtime || runtime.explored[idx] === 0) return 0;
  const age = tickAgeSeconds(runtime.currentTick, runtime.seenTick[idx]);
  if (age <= MAP_FOG_START_SECONDS) return 0;
  if (age >= MAP_FOG_FULL_SECONDS) return 1;
  const t = (age - MAP_FOG_START_SECONDS) / (MAP_FOG_FULL_SECONDS - MAP_FOG_START_SECONDS);
  return t * t * (3 - 2 * t);
}

export function isMapCellFreshForMarkers(world: World, idx: number): boolean {
  return mapCellFogAmount(world, idx) <= 0.05;
}

export function mapExplorationVersion(world: World): number {
  return explorationByWorld.get(world)?.version ?? 0;
}

export function mapExplorationStats(world: World): { cells: number; rooms: number; initialZoneId: number } {
  const runtime = explorationByWorld.get(world);
  if (!runtime) return { cells: W * W, rooms: world.rooms.length, initialZoneId: -1 };
  let cells = 0;
  for (let i = 0; i < runtime.explored.length; i++) if (runtime.explored[i]) cells++;
  return { cells, rooms: runtime.revealedRooms.size, initialZoneId: runtime.initialZoneId };
}
