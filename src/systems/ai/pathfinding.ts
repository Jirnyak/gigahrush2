/* ── BFS pathfinding + movement helpers ───────────────────────── */

import {
  W, Cell, DoorState,
  type Entity, type Msg,
  EntityType,  AIGoal, RoomType,
} from '../../core/types';
import { World } from '../../core/world';
import { PATH_BLOCKER_SUBDIV, PATH_BLOCKER_BYTES_PER_CELL } from '../../core/path_blockers';
import { getCellHazardMoveMultiplier } from '../cell_hazards';
import { actorOccupyRadius, canActorOccupy, entityIgnoresFineBlockers } from '../movement_collision';
import { setDoorState } from '../door_state';
import { aiPathMoveSpeed } from '../rpg';
import { emitMarkovBark, BARK_CHANCE_ARRIVE } from './barks';

let _barkMsgs: Msg[] = [];
let _barkTime = 0;

/** Call once per frame from updateAI to set bark context for followPath arrival barks */
export function setPathContext(msgs: Msg[], time: number, _samosborActive = false): void {
  _barkMsgs = msgs;
  _barkTime = time;
  beginPathFrame(time);
}

/* ── Baked navigation tree (toroidal, ordinary doors are openable) */

const NAV_UNKNOWN = -3;
const NAV_BLOCKED = -2;
const FLOW_UNREACHED = -1;
const FLOW_BLOCKED = -2;
const PATH_CHUNK_LIMIT = 1024;
const PATH_DESCEND_SEARCH_LIMIT = 2048;
const PATH_LOOKAHEAD_CELLS = 6;
const PATH_DIRECT_GOAL_RANGE = 12;
const PATH_LINE_SAMPLE_STEP = 0.35;
const PATH_WAYPOINT_REACH = 0.18;
const PATH_WAYPOINT_REACH_SQ = PATH_WAYPOINT_REACH * PATH_WAYPOINT_REACH;
const PATH_WAYPOINT_OFFSET = 0.08;
const BEHAVIOR_FLOW_FIELD_CACHE_MAX = 16;
const ROUTINE_WANDER_ATTEMPTS = 4;
const ROUTINE_FAR_ATTEMPTS = 5;
const SW = W * PATH_BLOCKER_SUBDIV;
const SW2 = SW * SW;
const _navParent = new Int32Array(SW2);
const _navDepth = new Int32Array(SW2);
const _navComponent = new Int32Array(SW2);
const _navQueue = new Int32Array(SW2);
const _flowSourceScratch: number[] = [];
let _navWorld: World | null = null;
let _navCellVersion = -1;
let _navPathBlockerVersion = -1;
let _navComponents = 0;
let _navReachable = 0;
let _frozenNavWorld: World | null = null;
let _frozenNavCellVersion = -1;
let _frozenNavPathBlockerVersion = -1;
let _frozenNavRoomCount = -1;
let _frozenNavRefCount = 0;
let _flowFieldTouch = 0;
let _routinePathUsed = 0;
let _routinePathDenied = 0;
let _routinePathDeferred = 0;
let _pathCacheHits = 0;
let _bfsCalls = 0;
let _bfsFound = 0;
let _bfsMiss = 0;
let _bfsLimitHits = 0;
let _bfsVisited = 0;

export type BehaviorFlowFieldSourceProvider = (world: World, out: number[]) => void;

interface BehaviorFlowField {
  key: string;
  world: World;
  cellVersion: number;
  pathBlockerVersion: number;
  roomCount: number;
  next: Int32Array;
  sourceCount: number;
  reachable: number;
  lastUsed: number;
}

interface FlowPathAssignment {
  key: string;
  sourceProvider: BehaviorFlowFieldSourceProvider;
}

export interface PathSteering {
  x: number;
  y: number;
  distance: number;
  nextCell: number;
  targetCell: number;
}

interface SteeringPathAssignment {
  world: World;
  cellVersion: number;
  pathBlockerVersion: number;
  target: number;
  path: number[];
  pi: number;
}

interface PathWaypoint {
  cell: number;
  index: number;
  x: number;
  y: number;
}

interface PathWaypointCache {
  world: World;
  cellVersion: number;
  pathBlockerVersion: number;
  path: readonly number[];
  pathLength: number;
  pi: number;
  sourceCell: number;
  goalCell: number;
  radius: number;
  waypoint: PathWaypoint;
}

export interface PathfindingStats {
  routineUsed: number;
  routineDenied: number;
  routineDeferred: number;
  cacheHits: number;
  cacheSize: number;
  bfsCalls: number;
  bfsFound: number;
  bfsMiss: number;
  bfsLimitHits: number;
  bfsVisited: number;
}

type AssignPathStatus = 'assigned' | 'same' | 'not_found';

const _behaviorFlowFields = new Map<string, BehaviorFlowField>();
const _flowPathAssignments = new WeakMap<Entity, FlowPathAssignment>();
const _steeringPathAssignments = new WeakMap<Entity, SteeringPathAssignment>();
const _pathWaypointCache = new WeakMap<Entity, PathWaypointCache>();
const _roomTypeSourceProviders = new Map<string, BehaviorFlowFieldSourceProvider>();

function beginPathFrame(time: number): void {
  void time;
  _routinePathUsed = 0;
  _routinePathDenied = 0;
  _routinePathDeferred = 0;
  _pathCacheHits = 0;
  _bfsCalls = 0;
  _bfsFound = 0;
  _bfsMiss = 0;
  _bfsLimitHits = 0;
  _bfsVisited = 0;
}

export function getPathfindingStats(out?: PathfindingStats): PathfindingStats {
  const stats = out ?? {
    routineUsed: 0,
    routineDenied: 0,
    routineDeferred: 0,
    cacheHits: 0,
    cacheSize: 0,
    bfsCalls: 0,
    bfsFound: 0,
    bfsMiss: 0,
    bfsLimitHits: 0,
    bfsVisited: 0,
  };
  stats.routineUsed = _routinePathUsed;
  stats.routineDenied = _routinePathDenied;
  stats.routineDeferred = _routinePathDeferred;
  stats.cacheHits = _pathCacheHits;
  stats.cacheSize = _navComponents;
  stats.bfsCalls = _bfsCalls;
  stats.bfsFound = _bfsFound;
  stats.bfsMiss = _bfsMiss;
  stats.bfsLimitHits = _bfsLimitHits;
  stats.bfsVisited = _bfsVisited;
  return stats;
}

export function bfsPath(world: World, sx: number, sy: number, ex: number, ey: number): number[] {
  sx = world.wrap(sx); sy = world.wrap(sy);
  ex = world.wrap(ex); ey = world.wrap(ey);

  if (sx === ex && sy === ey) return [];

  const start = subcellIdx(sx, sy);
  const end = subcellIdx(ex, ey);
  return buildBakedTreePath(world, start, end);
}

function navigationCacheCellVersion(world: World): number {
  return _frozenNavWorld === world ? _frozenNavCellVersion : world.cellVersion;
}

function navigationCachePathBlockerVersion(world: World): number {
  return _frozenNavWorld === world ? _frozenNavPathBlockerVersion : world.pathBlockerVersion;
}

function navigationCacheRoomCount(world: World): number {
  return _frozenNavWorld === world ? _frozenNavRoomCount : world.rooms.length;
}

export function freezeNavigationCacheForWorld(world: World): void {
  if (_frozenNavWorld === world) {
    _frozenNavRefCount++;
    return;
  }
  const frozenCellVersion = world.cellVersion;
  const frozenPathBlockerVersion = world.pathBlockerVersion;
  if (_navWorld !== world || _navCellVersion !== frozenCellVersion || _navPathBlockerVersion !== frozenPathBlockerVersion) {
    bakeNavigationTree(world, frozenCellVersion, frozenPathBlockerVersion);
  }
  _frozenNavWorld = world;
  _frozenNavCellVersion = frozenCellVersion;
  _frozenNavPathBlockerVersion = frozenPathBlockerVersion;
  _frozenNavRoomCount = world.rooms.length;
  _frozenNavRefCount = 1;
}

export function unfreezeNavigationCacheForWorld(world?: World): void {
  if (!world) {
    _frozenNavWorld = null;
    _frozenNavCellVersion = -1;
    _frozenNavPathBlockerVersion = -1;
    _frozenNavRoomCount = -1;
    _frozenNavRefCount = 0;
    _navWorld = null;
    _behaviorFlowFields.clear();
    return;
  }
  if (_frozenNavWorld && _frozenNavWorld !== world) return;
  if (_frozenNavRefCount > 1) {
    _frozenNavRefCount--;
    return;
  }
  _frozenNavWorld = null;
  _frozenNavCellVersion = -1;
  _frozenNavPathBlockerVersion = -1;
  _frozenNavRoomCount = -1;
  _frozenNavRefCount = 0;
  _navWorld = null;
  _behaviorFlowFields.clear();
}

export function subcellIdx(worldX: number, worldY: number): number {
  const cellX = Math.floor(worldX);
  const cellY = Math.floor(worldY);
  const subX = Math.floor((worldX - cellX) * PATH_BLOCKER_SUBDIV);
  const subY = Math.floor((worldY - cellY) * PATH_BLOCKER_SUBDIV);
  const sx = ((cellX % W + W) % W) * PATH_BLOCKER_SUBDIV + Math.max(0, Math.min(PATH_BLOCKER_SUBDIV - 1, subX));
  const sy = ((cellY % W + W) % W) * PATH_BLOCKER_SUBDIV + Math.max(0, Math.min(PATH_BLOCKER_SUBDIV - 1, subY));
  return sy * SW + sx;
}

export function subcellToWorld(si: number): [number, number] {
  const sx = si % SW;
  const sy = (si / SW) | 0;
  return [sx / PATH_BLOCKER_SUBDIV + 0.5 / PATH_BLOCKER_SUBDIV, sy / PATH_BLOCKER_SUBDIV + 0.5 / PATH_BLOCKER_SUBDIV];
}

export function subcellToCell(si: number): number {
  const sx = si % SW;
  const sy = (si / SW) | 0;
  return ((sy / PATH_BLOCKER_SUBDIV) | 0) * W + ((sx / PATH_BLOCKER_SUBDIV) | 0);
}

function isMacroCellPassable(world: World, ci: number, c: number): boolean {
  if (c !== Cell.FLOOR && c !== Cell.WATER && c !== Cell.DOOR) return false;
  if (c === Cell.DOOR) {
    const door = world.doors.get(ci);
    if (door && (door.state === DoorState.LOCKED || door.state === DoorState.HERMETIC_CLOSED)) return false;
  }
  return true;
}

function isClearanceBlocker(world: World, ci: number, c: number): boolean {
  if (isMacroCellPassable(world, ci, c)) return false;
  if (c === Cell.DOOR) {
    const door = world.doors.get(ci);
    if (door && door.state === DoorState.CLOSED) return false;
  }
  return true;
}

function isSubcellNavPassable(world: World, si: number): boolean {
  const sx = si % SW;
  const sy = (si / SW) | 0;
  const cellX = (sx / PATH_BLOCKER_SUBDIV) | 0;
  const cellY = (sy / PATH_BLOCKER_SUBDIV) | 0;
  const cellI = cellY * W + cellX;
  const cell = world.cells[cellI];

  if (!isMacroCellPassable(world, cellI, cell)) return false;

  const rx = sx % PATH_BLOCKER_SUBDIV;
  const ry = sy % PATH_BLOCKER_SUBDIV;

  if (rx === 0) {
    const nx = (cellX - 1 + W) & (W - 1);
    const nci = cellY * W + nx;
    if (isClearanceBlocker(world, nci, world.cells[nci])) return false;
  } else if (rx === PATH_BLOCKER_SUBDIV - 1) {
    const nx = (cellX + 1) & (W - 1);
    const nci = cellY * W + nx;
    if (isClearanceBlocker(world, nci, world.cells[nci])) return false;
  }

  if (ry === 0) {
    const ny = (cellY - 1 + W) & (W - 1);
    const nci = ny * W + cellX;
    if (isClearanceBlocker(world, nci, world.cells[nci])) return false;
  } else if (ry === PATH_BLOCKER_SUBDIV - 1) {
    const ny = (cellY + 1) & (W - 1);
    const nci = ny * W + cellX;
    if (isClearanceBlocker(world, nci, world.cells[nci])) return false;
  }

  const mask = world.pathBlockers[cellI * PATH_BLOCKER_BYTES_PER_CELL + ry] ?? 0;
  return (mask & (1 << rx)) === 0;
}

function checkNavPassable(world: World, cell: number): boolean {
  const p = _navParent[cell];
  if (p !== NAV_UNKNOWN) return p !== NAV_BLOCKED;
  const pass = isSubcellNavPassable(world, cell);
  if (!pass) _navParent[cell] = NAV_BLOCKED;
  return pass;
}

function checkFlowPassable(world: World, next: Int32Array, cell: number): boolean {
  const n = next[cell];
  if (n !== FLOW_UNREACHED) return n !== FLOW_BLOCKED;
  const pass = isSubcellNavPassable(world, cell);
  if (!pass) next[cell] = FLOW_BLOCKED;
  return pass;
}

function bakeNavigationTree(
  world: World,
  cacheCellVersion = world.cellVersion,
  cachePathBlockerVersion = world.pathBlockerVersion,
): void {
  _bfsCalls++;
  _navParent.fill(NAV_UNKNOWN);
  _navDepth.fill(0);
  _navComponent.fill(-1);
  _navWorld = world;
  _navCellVersion = cacheCellVersion;
  _navPathBlockerVersion = cachePathBlockerVersion;
  _navComponents = 0;
  _navReachable = 0;

  for (let root = 0; root < SW2; root++) {
    if (_navParent[root] !== NAV_UNKNOWN) continue;
    if (!isSubcellNavPassable(world, root)) {
      _navParent[root] = NAV_BLOCKED;
      continue;
    }

    const componentId = _navComponents++;
    _navParent[root] = root;
    _navComponent[root] = componentId;
    _navDepth[root] = 0;
    _navQueue[0] = root;
    let head = 0;
    let tail = 1;

    while (head < tail) {
      const cur = _navQueue[head++];
      const cx = cur % SW;
      const cy = (cur / SW) | 0;

      const nW = cy * SW + (cx === 0 ? SW - 1 : cx - 1);
      const nE = cy * SW + (cx === SW - 1 ? 0 : cx + 1);
      const nN = (cy === 0 ? SW - 1 : cy - 1) * SW + cx;
      const nS = (cy === SW - 1 ? 0 : cy + 1) * SW + cx;
      const nNW = (cy === 0 ? SW - 1 : cy - 1) * SW + (cx === 0 ? SW - 1 : cx - 1);
      const nNE = (cy === 0 ? SW - 1 : cy - 1) * SW + (cx === SW - 1 ? 0 : cx + 1);
      const nSW = (cy === SW - 1 ? 0 : cy + 1) * SW + (cx === 0 ? SW - 1 : cx - 1);
      const nSE = (cy === SW - 1 ? 0 : cy + 1) * SW + (cx === SW - 1 ? 0 : cx + 1);

      const passW = checkNavPassable(world, nW);
      const passE = checkNavPassable(world, nE);
      const passN = checkNavPassable(world, nN);
      const passS = checkNavPassable(world, nS);

      if (passW) tail = visitNavNeighbor(world, nW, cur, componentId, tail);
      if (passE) tail = visitNavNeighbor(world, nE, cur, componentId, tail);
      if (passN) tail = visitNavNeighbor(world, nN, cur, componentId, tail);
      if (passS) tail = visitNavNeighbor(world, nS, cur, componentId, tail);
      
      if (passW && passN) tail = visitNavNeighbor(world, nNW, cur, componentId, tail);
      if (passE && passN) tail = visitNavNeighbor(world, nNE, cur, componentId, tail);
      if (passW && passS) tail = visitNavNeighbor(world, nSW, cur, componentId, tail);
      if (passE && passS) tail = visitNavNeighbor(world, nSE, cur, componentId, tail);
    }
    _navReachable += tail;
  }

  _bfsVisited += _navReachable;
}

function visitNavNeighbor(world: World, cell: number, parent: number, componentId: number, tail: number): number {
  if (_navParent[cell] !== NAV_UNKNOWN) return tail;
  if (!checkNavPassable(world, cell)) return tail;
  _navParent[cell] = parent;
  _navDepth[cell] = _navDepth[parent] + 1;
  _navComponent[cell] = componentId;
  _navQueue[tail] = cell;
  return tail + 1;
}

function ensureNavigationTree(world: World): void {
  if (_navWorld === world) {
    _pathCacheHits++;
    return;
  }
  bakeNavigationTree(world, world.cellVersion, world.pathBlockerVersion);
}

function flowFieldValid(field: BehaviorFlowField, world: World): boolean {
  return field.world === world && field.roomCount === navigationCacheRoomCount(world);
}

function ensureBehaviorFlowField(
  world: World,
  key: string,
  sourceProvider: BehaviorFlowFieldSourceProvider,
): BehaviorFlowField | null {
  const cached = _behaviorFlowFields.get(key);
  if (cached && flowFieldValid(cached, world)) {
    cached.lastUsed = ++_flowFieldTouch;
    _pathCacheHits++;
    return cached;
  }

  _flowSourceScratch.length = 0;
  sourceProvider(world, _flowSourceScratch);
  if (_flowSourceScratch.length === 0) {
    _behaviorFlowFields.delete(key);
    return null;
  }

  const next = cached?.next ?? new Int32Array(SW2);
  next.fill(FLOW_UNREACHED);
  let head = 0;
  let tail = 0;
  for (const source of _flowSourceScratch) {
    if (source < 0 || source >= SW2) continue;
    if (next[source] === source) continue;
      if (!isSubcellNavPassable(world, source)) continue;
    next[source] = source;
    _navQueue[tail++] = source;
  }

  while (head < tail) {
    const cur = _navQueue[head++];
    const cx = cur % SW;
    const cy = (cur / SW) | 0;

    const nW = cy * SW + (cx === 0 ? SW - 1 : cx - 1);
    const nE = cy * SW + (cx === SW - 1 ? 0 : cx + 1);
    const nN = (cy === 0 ? SW - 1 : cy - 1) * SW + cx;
    const nS = (cy === SW - 1 ? 0 : cy + 1) * SW + cx;
    const nNW = (cy === 0 ? SW - 1 : cy - 1) * SW + (cx === 0 ? SW - 1 : cx - 1);
    const nNE = (cy === 0 ? SW - 1 : cy - 1) * SW + (cx === SW - 1 ? 0 : cx + 1);
    const nSW = (cy === SW - 1 ? 0 : cy + 1) * SW + (cx === 0 ? SW - 1 : cx - 1);
    const nSE = (cy === SW - 1 ? 0 : cy + 1) * SW + (cx === SW - 1 ? 0 : cx + 1);

    const passW = checkFlowPassable(world, next, nW);
    const passE = checkFlowPassable(world, next, nE);
    const passN = checkFlowPassable(world, next, nN);
    const passS = checkFlowPassable(world, next, nS);

    if (passW) tail = visitFlowNeighbor(world, next, nW, cur, tail);
    if (passE) tail = visitFlowNeighbor(world, next, nE, cur, tail);
    if (passN) tail = visitFlowNeighbor(world, next, nN, cur, tail);
    if (passS) tail = visitFlowNeighbor(world, next, nS, cur, tail);
    
    if (passW && passN) tail = visitFlowNeighbor(world, next, nNW, cur, tail);
    if (passE && passN) tail = visitFlowNeighbor(world, next, nNE, cur, tail);
    if (passW && passS) tail = visitFlowNeighbor(world, next, nSW, cur, tail);
    if (passE && passS) tail = visitFlowNeighbor(world, next, nSE, cur, tail);
  }

  _bfsCalls++;
  _bfsVisited += tail;
  const field: BehaviorFlowField = {
    key,
    world,
    cellVersion: navigationCacheCellVersion(world),
    pathBlockerVersion: navigationCachePathBlockerVersion(world),
    roomCount: navigationCacheRoomCount(world),
    next,
    sourceCount: _flowSourceScratch.length,
    reachable: tail,
    lastUsed: ++_flowFieldTouch,
  };
  _behaviorFlowFields.set(key, field);
  trimBehaviorFlowFieldCache();
  return field;
}

function visitFlowNeighbor(world: World, next: Int32Array, cell: number, parent: number, tail: number): number {
  if (next[cell] !== FLOW_UNREACHED) return tail;
  if (!checkFlowPassable(world, next, cell)) return tail;
  next[cell] = parent;
  _navQueue[tail] = cell;
  return tail + 1;
}

function trimBehaviorFlowFieldCache(): void {
  while (_behaviorFlowFields.size > BEHAVIOR_FLOW_FIELD_CACHE_MAX) {
    let oldestKey = '';
    let oldestUsed = Infinity;
    for (const field of _behaviorFlowFields.values()) {
      if (field.lastUsed >= oldestUsed) continue;
      oldestUsed = field.lastUsed;
      oldestKey = field.key;
    }
    if (!oldestKey) return;
    _behaviorFlowFields.delete(oldestKey);
  }
}

function buildBakedTreePath(world: World, start: number, end: number): number[] {
  ensureNavigationTree(world);
  if (start === end) return [];
  if (_navParent[start] < 0 || _navParent[end] < 0 || _navComponent[start] !== _navComponent[end]) {
    _bfsMiss++;
    return [];
  }

  let a = start;
  let b = end;
  const forward: number[] = [];
  const reverse: number[] = [];

  let descendSearch = 0;
  while (_navDepth[b] > _navDepth[a] && descendSearch < PATH_DESCEND_SEARCH_LIMIT) {
    reverse.push(b);
    b = _navParent[b];
    descendSearch++;
  }

  if (_navDepth[b] > _navDepth[a]) {
    const path = climbFromStart(start);
    if (path.length > 0) _bfsFound++;
    else _bfsMiss++;
    _bfsLimitHits++;
    return path;
  }

  if (a === b) {
    for (let i = reverse.length - 1; i >= 0 && forward.length < PATH_CHUNK_LIMIT; i--) {
      forward.push(reverse[i]);
    }
    if (forward.length > 0) _bfsFound++;
    else _bfsMiss++;
    if (reverse.length > PATH_CHUNK_LIMIT) _bfsLimitHits++;
    return forward;
  }

  while (_navDepth[a] > _navDepth[b] && forward.length < PATH_CHUNK_LIMIT) {
    a = _navParent[a];
    forward.push(a);
  }
  while (a !== b && forward.length < PATH_CHUNK_LIMIT) {
    a = _navParent[a];
    forward.push(a);
    reverse.push(b);
    b = _navParent[b];
  }

  let chunked = false;
  if (a === b) {
    chunked = forward.length + reverse.length > PATH_CHUNK_LIMIT;
    for (let i = reverse.length - 1; i >= 0 && forward.length < PATH_CHUNK_LIMIT; i--) {
      forward.push(reverse[i]);
    }
  } else {
    chunked = true;
  }
  if (forward.length > 0) _bfsFound++;
  else _bfsMiss++;
  if (chunked) _bfsLimitHits++;
  return forward;
}

function climbFromStart(start: number): number[] {
  const path: number[] = [];
  let cell = start;
  while (path.length < PATH_CHUNK_LIMIT) {
    const parent = _navParent[cell];
    if (parent < 0 || parent === cell) break;
    path.push(parent);
    cell = parent;
  }
  return path;
}

function buildFlowFieldPath(field: BehaviorFlowField, start: number): number[] {
  let cell = start;
  const path: number[] = [];
  while (path.length < PATH_CHUNK_LIMIT) {
    const next = field.next[cell];
    if (next < 0) break;
    if (next === cell) break;
    path.push(next);
    cell = next;
  }
  if (path.length > 0) _bfsFound++;
  else _bfsMiss++;
  if (path.length >= PATH_CHUNK_LIMIT) _bfsLimitHits++;
  return path;
}

export function tryAssignBehaviorFlowPath(
  world: World,
  e: Entity,
  key: string,
  sourceProvider: BehaviorFlowFieldSourceProvider,
): AssignPathStatus {
  const ai = e.ai!;
  const start = subcellIdx(e.x, e.y);
  const field = ensureBehaviorFlowField(world, key, sourceProvider);
  if (!field || field.next[start] < 0) {
    ai.path = [];
    ai.pi = 0;
    _flowPathAssignments.delete(e);
    return 'not_found';
  }

  const cellPath = buildFlowFieldPath(field, start);
  if (cellPath.length === 0) {
    e.ai!.path = [];
    e.ai!.pi = 0;
    e.ai!.stuck = 0;
    e.ai!.tx = e.x;
    e.ai!.ty = e.y;
    _flowPathAssignments.delete(e);
    return 'same';
  }

  const targetCell = cellPath[cellPath.length - 1];
  const [tx, ty] = subcellToWorld(targetCell);
  const status = tryAssignPathToCell(world, e, tx, ty);
  if (status !== 'not_found') {
    _flowPathAssignments.set(e, { key, sourceProvider });
  } else {
    _flowPathAssignments.delete(e);
  }
  return status;
}

function continueBehaviorFlowPath(world: World, e: Entity): AssignPathStatus {
  const assignment = _flowPathAssignments.get(e);
  if (!assignment) return 'not_found';
  return tryAssignBehaviorFlowPath(world, e, assignment.key, assignment.sourceProvider);
}

export function tryAssignPathToCell(world: World, e: Entity, tx: number, ty: number): AssignPathStatus {
  const ai = e.ai!;
  _flowPathAssignments.delete(e);
  tx = world.wrap(tx);
  ty = world.wrap(ty);
  if (Number.isInteger(tx)) tx += 0.5;
  if (Number.isInteger(ty)) ty += 0.5;

  const start = subcellIdx(e.x, e.y);
  const target = subcellIdx(tx, ty);

  if (start === target) {
    ai.path = [];
    ai.pi = 0;
    ai.stuck = 0;
    ai.tx = tx;
    ai.ty = ty;
    return 'same';
  }

  const path = buildBakedTreePath(world, start, target);

  if (path.length === 0) {
    ai.path = [];
    ai.pi = 0;
    ai.tx = tx;
    ai.ty = ty;
    return 'not_found';
  }

  ai.path = path;
  ai.pi = 0;
  ai.stuck = 0;
  ai.tx = tx;
  ai.ty = ty;
  return 'assigned';
}

function openPathDoor(world: World, subcell: number): void {
  const ci = subcellToCell(subcell);
  if (world.cells[ci] !== Cell.DOOR) return;
  const door = world.doors.get(ci);
  if (door && door.state === DoorState.CLOSED) {
    setDoorState(world, door, DoorState.OPEN);
    door.timer = 5;
  }
}

/** Open a door at world coordinates (not subcell). Used proactively during movement. */
function openPathDoorAtWorld(world: World, wx: number, wy: number): void {
  const ci = world.idx(Math.floor(wx), Math.floor(wy));
  if (world.cells[ci] !== Cell.DOOR) return;
  const door = world.doors.get(ci);
  if (door && door.state === DoorState.CLOSED) {
    setDoorState(world, door, DoorState.OPEN);
    door.timer = 5;
  }
}

function validSteeringAssignment(assignment: SteeringPathAssignment, world: World, target: number): boolean {
  return assignment.world === world && assignment.target === target;
}

export function clearEntitySteeringPath(e: Entity): void {
  _steeringPathAssignments.delete(e);
}

export function steerEntityTowardCell(world: World, e: Entity, tx: number, ty: number): { x: number; y: number; nextCell: number } | null {
  tx = world.wrap(tx);
  ty = world.wrap(ty);
  if (Number.isInteger(tx)) tx += 0.5;
  if (Number.isInteger(ty)) ty += 0.5;

  const start = subcellIdx(e.x, e.y);
  const target = subcellIdx(tx, ty);
  const targetDistance = world.dist(e.x, e.y, tx, ty);
  if (start === target || targetDistance < 0.35) {
    _steeringPathAssignments.delete(e);
    return null;
  }

  let assignment = _steeringPathAssignments.get(e);
  if (!assignment || !validSteeringAssignment(assignment, world, target) || assignment.pi >= assignment.path.length) {
    const path = buildBakedTreePath(world, start, target);
    if (path.length === 0) {
      _steeringPathAssignments.delete(e);
      return null;
    }
    assignment = {
      world,
      cellVersion: world.cellVersion,
      pathBlockerVersion: world.pathBlockerVersion,
      target,
      path,
      pi: 0,
    };
    _steeringPathAssignments.set(e, assignment);
  }

  while (assignment.pi < assignment.path.length) {
    const cell = assignment.path[assignment.pi];
    const [cx, cy] = subcellToWorld(cell);
    if (world.dist(e.x, e.y, cx, cy) >= 0.3) break;
    assignment.pi++;
  }

  if (assignment.pi >= assignment.path.length) {
    const path = buildBakedTreePath(world, start, target);
    if (path.length === 0) {
      _steeringPathAssignments.delete(e);
      return null;
    }
    assignment.path = path;
    assignment.pi = 0;
    assignment.cellVersion = world.cellVersion;
    assignment.pathBlockerVersion = world.pathBlockerVersion;
  }

  const nextCell = assignment.path[assignment.pi];
  openPathDoor(world, nextCell);
  const [nextX, nextY] = subcellToWorld(nextCell);
  const dx = world.delta(e.x, nextX);
  const dy = world.delta(e.y, nextY);
  const stepDistance = Math.sqrt(dx * dx + dy * dy);
  if (stepDistance < 0.01) return null;
  return {
    x: dx / stepDistance,
    y: dy / stepDistance,
    nextCell,
  };
}

function wrapFloat(v: number): number {
  return ((v % W) + W) % W;
}

function pathNoiseUnit(id: number, cell: number, salt: number): number {
  let h = Math.imul(id | 0, 374761393) ^ Math.imul(cell | 0, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

function centeredPathWaypoint(si: number, index: number): PathWaypoint {
  const [x, y] = subcellToWorld(si);
  return { cell: si, index, x, y };
}

function pathWaypointForCell(world: World, e: Entity, si: number, index: number, r: number, ignoreFineBlockers: boolean): PathWaypoint {
  const center = centeredPathWaypoint(si, index);
  const dx = world.delta(e.x, center.x);
  const dy = world.delta(e.y, center.y);
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.01) return center;
  if (world.cells[subcellToCell(si)] === Cell.DOOR) return center;

  const ox = (pathNoiseUnit(e.id, si, 1) - 0.5) * PATH_WAYPOINT_OFFSET * 2;
  const oy = (pathNoiseUnit(e.id, si, 2) - 0.5) * PATH_WAYPOINT_OFFSET * 2;
  const x = center.x + ox;
  const y = center.y + oy;
  if (canActorOccupy(world, x, y, r, { ignoreFineBlockers })) return { cell: si, index, x, y };
  return center;
}

function pathSegmentClear(world: World, x1: number, y1: number, x2: number, y2: number, r: number, ignoreFineBlockers: boolean): boolean {
  const dx = world.delta(x1, x2);
  const dy = world.delta(y1, y2);
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.01) return true;

  const steps = Math.max(1, Math.ceil(dist / PATH_LINE_SAMPLE_STEP));
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const x = wrapFloat(x1 + dx * t);
    const y = wrapFloat(y1 + dy * t);
    if (!canActorOccupy(world, x, y, r, { ignoreFineBlockers })) return false;
  }
  return true;
}

function computePathWaypoint(world: World, e: Entity, r: number, goalCell: number): PathWaypoint {
  const ai = e.ai!;
  const ignoreFineBlockers = entityIgnoresFineBlockers(e);
  let fallback = pathWaypointForCell(world, e, ai.path[ai.pi], ai.pi, r, ignoreFineBlockers);
  const goal = pathWaypointForCell(world, e, goalCell, ai.path.length - 1, r, ignoreFineBlockers);
  if (
    world.dist2(e.x, e.y, goal.x, goal.y) <= PATH_DIRECT_GOAL_RANGE * PATH_DIRECT_GOAL_RANGE &&
    pathSegmentClear(world, e.x, e.y, goal.x, goal.y, r, ignoreFineBlockers)
  ) {
    return goal;
  }
  const centeredGoal = centeredPathWaypoint(goalCell, ai.path.length - 1);
  if (
    world.dist2(e.x, e.y, centeredGoal.x, centeredGoal.y) <= PATH_DIRECT_GOAL_RANGE * PATH_DIRECT_GOAL_RANGE &&
    pathSegmentClear(world, e.x, e.y, centeredGoal.x, centeredGoal.y, r, ignoreFineBlockers)
  ) {
    return centeredGoal;
  }

  const last = Math.min(ai.path.length - 1, ai.pi + PATH_LOOKAHEAD_CELLS);

  for (let index = last; index > ai.pi; index--) {
    const waypoint = pathWaypointForCell(world, e, ai.path[index], index, r, ignoreFineBlockers);
    if (pathSegmentClear(world, e.x, e.y, waypoint.x, waypoint.y, r, ignoreFineBlockers)) return waypoint;
    const centered = centeredPathWaypoint(ai.path[index], index);
    if (pathSegmentClear(world, e.x, e.y, centered.x, centered.y, r, ignoreFineBlockers)) return centered;
  }

  if (pathSegmentClear(world, e.x, e.y, fallback.x, fallback.y, r, ignoreFineBlockers)) return fallback;
  return centeredPathWaypoint(ai.path[ai.pi], ai.pi);
}

function selectPathWaypoint(world: World, e: Entity, r: number): PathWaypoint {
  const ai = e.ai!;
  const sourceCell = subcellIdx(e.x, e.y);
  const goalCell = subcellIdx(ai.tx, ai.ty);
  const cellVersion = navigationCacheCellVersion(world);
  const pathBlockerVersion = world.pathBlockerVersion;
  const cached = _pathWaypointCache.get(e);
  if (
    cached &&
    cached.world === world &&
    cached.cellVersion === cellVersion &&
    cached.pathBlockerVersion === pathBlockerVersion &&
    cached.path === ai.path &&
    cached.pathLength === ai.path.length &&
    cached.pi === ai.pi &&
    cached.sourceCell === sourceCell &&
    cached.goalCell === goalCell &&
    cached.radius === r
  ) {
    return cached.waypoint;
  }

  const waypoint = computePathWaypoint(world, e, r, goalCell);
  _pathWaypointCache.set(e, {
    world,
    cellVersion,
    pathBlockerVersion,
    path: ai.path,
    pathLength: ai.path.length,
    pi: ai.pi,
    sourceCell,
    goalCell,
    radius: r,
    waypoint,
  });
  return waypoint;
}

/* ── Follow path ──────────────────────────────────────────────── */
export function followPath(world: World, e: Entity, dt: number): void {
  const ai = e.ai!;
  if (ai.pi >= ai.path.length) {
    if (ai.path.length > 0) {
      const current = world.idx(Math.floor(e.x), Math.floor(e.y));
      const destination = world.idx(Math.floor(ai.tx), Math.floor(ai.ty));
      ai.path = []; ai.pi = 0; ai.stuck = 0;
      if (_flowPathAssignments.has(e)) {
        const status = continueBehaviorFlowPath(world, e);
        if (status === 'assigned') return;
      }
      if (current !== destination) {
        const status = tryAssignPathToCell(world, e, ai.tx, ai.ty);
        if (status === 'assigned') return;
      }
      // Bark: arrived at destination (very rare)
      if (e.type === EntityType.NPC && ai.goal === AIGoal.WORK) {
        emitMarkovBark(e, _barkMsgs, _barkTime, 'ambient', 'Пришли.', BARK_CHANCE_ARRIVE, '#aac');
      }
    }
    if (e.type === EntityType.NPC && ai.goal !== AIGoal.HIDE && ai.goal !== AIGoal.FLEE) {
      ai.stuck += dt;
      // Higher threshold reduces corridor ping-pong: NPCs linger longer before re-wandering
      if (ai.stuck > 3 + Math.random() * 2) {
        wanderInRoom(world, e);
        // Fallback: if wanderInRoom found nothing (no room or tiny room), try wanderNearby
        if (ai.path.length === 0) wanderNearby(world, e);
        ai.stuck = 0;
      }
    }
    return;
  }

  const r = actorOccupyRadius(e);

  while (ai.pi < ai.path.length) {
    const cell = ai.path[ai.pi];
    const [cx, cy] = subcellToWorld(cell);
    if (world.dist2(e.x, e.y, cx, cy) >= PATH_WAYPOINT_REACH_SQ) break;
    ai.pi++;
    ai.stuck = 0;
  }

  if (ai.pi >= ai.path.length) return;

  // Proactively open doors: current cell, next path cell, and waypoint cell
  openPathDoorAtWorld(world, e.x, e.y);
  openPathDoor(world, ai.path[ai.pi]);
  const waypoint = selectPathWaypoint(world, e, r);

  let dx = world.delta(e.x, waypoint.x);
  let dy = world.delta(e.y, waypoint.y);
  const distSq = dx * dx + dy * dy;

  if (distSq < PATH_WAYPOINT_REACH_SQ) {
    ai.pi = Math.max(ai.pi + 1, waypoint.index + 1);
    ai.stuck = 0;
    return;
  }
  const dist = Math.sqrt(distSq);

  // Open doors in the way (never open hermetic doors — they protect apartments during samosbor)
  openPathDoor(world, waypoint.cell);

  // Move toward target
  const speed = aiPathMoveSpeed(e) * getCellHazardMoveMultiplier(world, e) * dt;
  const beforeCell = world.idx(Math.floor(e.x), Math.floor(e.y));
  const nx = e.x + (dx / dist) * speed;
  const ny = e.y + (dy / dist) * speed;
  let moved = false;

  // Open door ahead of movement if the next position is on a door cell
  openPathDoorAtWorld(world, nx, ny);

  const ignoreFineBlockers = entityIgnoresFineBlockers(e);
  if (canActorOccupy(world, nx, e.y, r, { ignoreFineBlockers })) {
    e.x = ((nx % W) + W) % W;
    moved = true;
  }
  if (canActorOccupy(world, e.x, ny, r, { ignoreFineBlockers })) {
    e.y = ((ny % W) + W) % W;
    moved = true;
  }

  // Stuck detection
  const afterDx = world.delta(e.x, waypoint.x);
  const afterDy = world.delta(e.y, waypoint.y);
  const afterDistSq = afterDx * afterDx + afterDy * afterDy;
  const afterCell = world.idx(Math.floor(e.x), Math.floor(e.y));
  const progressed = moved && (afterDistSq < distSq - 0.0001 || afterCell !== beforeCell);
  ai.stuck = progressed ? Math.max(0, ai.stuck - dt * 2) : ai.stuck + dt;
  if (ai.stuck > 3) {
    ai.path = [];
    ai.pi = 0;
    ai.stuck = 0;
    ai.goal = AIGoal.IDLE;
    ai.timer = 2;
  }
}

/* ── Find nearest room of type ────────────────────────────────── */
interface RoomTypeCache {
  cellVersion: number;
  roomCount: number;
  roomsByType: Map<RoomType, number[]>;
}

const roomTypeCaches = new WeakMap<World, RoomTypeCache>();

function roomsOfType(world: World, type: RoomType): number[] {
  let cache = roomTypeCaches.get(world);
  if (!cache || cache.cellVersion !== world.cellVersion || cache.roomCount !== world.rooms.length) {
    const roomsByType = new Map<RoomType, number[]>();
    for (const room of world.rooms) {
      if (!room) continue;
      let ids = roomsByType.get(room.type);
      if (!ids) {
        ids = [];
        roomsByType.set(room.type, ids);
      }
      ids.push(room.id);
    }
    cache = { cellVersion: world.cellVersion, roomCount: world.rooms.length, roomsByType };
    roomTypeCaches.set(world, cache);
  }
  return cache.roomsByType.get(type) ?? [];
}

export function findNearest(world: World, e: Entity, type: RoomType): number {
  let best = -1, bestD = Infinity;
  for (const roomId of roomsOfType(world, type)) {
    const room = world.rooms[roomId];
    if (!room) continue;
    const d = world.dist2(e.x, e.y, room.x + room.w / 2, room.y + room.h / 2);
    if (d < bestD) { bestD = d; best = room.id; }
  }
  return best;
}

function roomTypeFieldKey(types: readonly RoomType[]): string {
  const unique = [...new Set(types)].sort((a, b) => a - b);
  return `room:${unique.join(',')}`;
}

function roomTypeSourceProvider(types: readonly RoomType[]): BehaviorFlowFieldSourceProvider {
  const unique = [...new Set(types)].sort((a, b) => a - b);
  const key = roomTypeFieldKey(unique);
  const cached = _roomTypeSourceProviders.get(key);
  if (cached) return cached;
  const provider = (world: World, out: number[]): void => {
    for (const type of unique) {
      for (const roomId of roomsOfType(world, type)) {
        const room = world.rooms[roomId];
        if (!room) continue;
        const cx = room.x + Math.floor(room.w / 2);
        const cy = room.y + Math.floor(room.h / 2);
        const cell = subcellIdx(cx + 0.5, cy + 0.5);
        if (isSubcellNavPassable(world, cell)) out.push(cell);
      }
    }
  };
  _roomTypeSourceProviders.set(key, provider);
  return provider;
}

export function gotoNearestRoomType(world: World, e: Entity, type: RoomType): boolean {
  return gotoNearestRoomOfTypes(world, e, [type]);
}

export function gotoNearestRoomOfTypes(world: World, e: Entity, types: readonly RoomType[]): boolean {
  if (types.length === 0) return false;
  const key = roomTypeFieldKey(types);
  const status = tryAssignBehaviorFlowPath(world, e, key, roomTypeSourceProvider(types));
  return status !== 'not_found';
}

/* ── Find family's room of type ───────────────────────────────── */
export function findFamilyRoom(world: World, e: Entity, type: RoomType): number {
  if (e.familyId !== undefined) {
    for (const roomId of roomsOfType(world, type)) {
      const room = world.rooms[roomId];
      if (!room || room.apartmentId !== e.familyId) continue;
      return room.id;
    }
  }
  return findNearest(world, e, type);
}

/* ── Helper: set path to room center ──────────────────────────── */
export function gotoRoom(world: World, e: Entity, targetRoomType: RoomType): AssignPathStatus {
  if (e.y < 0 || e.y >= 1024) return 'not_found';
  
  const ids = roomsOfType(world, targetRoomType);
  if (ids.length === 0) return 'not_found';
  
  const room = world.rooms[ids[0]];
  const tx = room.x + Math.floor(room.w / 2) + 0.5;
  const ty = room.y + Math.floor(room.h / 2) + 0.5;
  return tryAssignPathToCell(world, e, tx, ty);
}

/* ── Helper: wander randomly nearby ───────────────────────────── */

export function wanderNearby(world: World, e: Entity): void {
  const ai = e.ai!;
  for (let attempt = 0; attempt < ROUTINE_WANDER_ATTEMPTS; attempt++) {
    const wx = Math.floor(e.x) + Math.floor(Math.random() * 20 - 10);
    const wy = Math.floor(e.y) + Math.floor(Math.random() * 20 - 10);
    const tx = world.wrap(wx);
    const ty = world.wrap(wy);
    if (world.solid(tx, ty)) continue;

    const status = tryAssignPathToCell(world, e, tx, ty);
    if (status !== 'not_found') return;
  }

  ai.path = [];
  ai.pi = 0;
}

/* ── Helper: roam randomly within the current room ────────────── */
export function wanderInRoom(world: World, e: Entity): void {
  const room = world.roomAt(e.x, e.y);
  if (!room || room.w < 3 || room.h < 3) return;
  for (let attempt = 0; attempt < ROUTINE_WANDER_ATTEMPTS; attempt++) {
    const rx = room.x + 1 + Math.floor(Math.random() * (room.w - 2));
    const ry = room.y + 1 + Math.floor(Math.random() * (room.h - 2));
    if (!world.solid(rx, ry)) {
      const status = tryAssignPathToCell(world, e, rx, ry);
      if (status !== 'not_found') return;
    }
  }
}

/* ── Helper: wander far across the maze (for travelers) ───────── */
export function wanderFar(world: World, e: Entity): void {
  if (world.rooms.length > 0) {
    for (let attempt = 0; attempt < ROUTINE_FAR_ATTEMPTS; attempt++) {
      const room = world.rooms[Math.floor(Math.random() * world.rooms.length)];
      if (!room || room.w < 2 || room.h < 2) continue;
      const tx = room.x + Math.floor(room.w / 2);
      const ty = room.y + Math.floor(room.h / 2);
      const status = tryAssignPathToCell(world, e, tx, ty);
      if (status !== 'not_found') return;
    }
  }
  // Fallback: wander nearby
  wanderNearby(world, e);
}
