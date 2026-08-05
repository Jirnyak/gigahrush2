import {
  Cell,
  DoorState,
  Feature,
  Tex,
  W,
  type Room,
} from '../core/types';
import { World } from '../core/world';

export interface VoronoiRoomSite<T> {
  id: number;
  parentId: number;
  x: number;
  y: number;
  weight?: number;
  data: T;
}

export interface VoronoiRoomBounds {
  minDx: number;
  minDy: number;
  maxDx: number;
  maxDy: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  count: number;
}

export interface VoronoiRoomBuildResult {
  rooms: number;
  doors: number;
  owner: Int32Array;
  roomIdBySite: Int32Array;
}

export interface VoronoiRoomBuildOptions<T> {
  sites: readonly VoronoiRoomSite<T>[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  seed: number;
  cellParentId: (idx: number, x: number, y: number) => number;
  createRoom: (site: VoronoiRoomSite<T>, bounds: VoronoiRoomBounds, roomId: number) => Room;
  paintCell?: (idx: number, site: VoronoiRoomSite<T>) => void;
  wallTexForCell?: (idx: number, parentId: number) => Tex;
  doorTex?: Tex;
  doorState?: DoorState;
  doorKeyId?: string;
  minRoomCells?: number;
  bucketSize?: number;
  bucketSearchRadius?: number;
  extraDoorRatio?: number;
}

interface SiteBucketGroup<T> {
  sites: readonly VoronoiRoomSite<T>[];
  buckets: Map<number, VoronoiRoomSite<T>[]>;
  bucketSize: number;
  searchRadius: number;
}

interface VoronoiRidgeCandidate {
  a: number;
  b: number;
  x: number;
  y: number;
  nx: number;
  ny: number;
  parentId: number;
  score: number;
}

export function buildVoronoiRoomCells<T>(world: World, options: VoronoiRoomBuildOptions<T>): VoronoiRoomBuildResult {
  const owner = new Int32Array(W * W);
  owner.fill(-1);
  const groups = buildSiteBucketGroups(options);

  for (let y = options.minY; y <= options.maxY; y++) {
    for (let x = options.minX; x <= options.maxX; x++) {
      const idx = world.idx(x, y);
      const parentId = options.cellParentId(idx, x, y);
      if (parentId < 0) continue;
      const group = groups.get(parentId);
      if (!group) continue;
      owner[idx] = nearestVoronoiRoomSiteId(world, x, y, group);
    }
  }

  const boundary = new Uint8Array(W * W);
  const ridges = new Map<string, VoronoiRidgeCandidate>();
  for (let y = options.minY; y <= options.maxY; y++) {
    for (let x = options.minX; x <= options.maxX; x++) {
      const idx = world.idx(x, y);
      const a = owner[idx];
      if (a < 0) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const ni = world.idx(x + dx, y + dy);
        const b = owner[ni];
        if (b < 0 || b === a) continue;
        boundary[idx] = 1;
        recordVoronoiRidge(world, ridges, options.sites, a, b, x, y, x + dx, y + dy, options.seed);
      }
    }
  }

  for (let i = 0; i < boundary.length; i++) {
    if (!boundary[i] || world.doors.has(i) || world.cells[i] === Cell.LIFT) continue;
    const parentId = options.cellParentId(i, i % W, (i / W) | 0);
    if (parentId < 0) continue;
    world.cells[i] = Cell.WALL;
    world.roomMap[i] = -1;
    world.wallTex[i] = options.wallTexForCell?.(i, parentId) ?? Tex.PANEL;
    world.hermoWall[i] = 0;
    world.features[i] = Feature.NONE;
  }

  const roomIdBySite = buildVoronoiRooms(world, owner, options);
  const doors = placeVoronoiDoors(world, options.sites, ridges, roomIdBySite, {
    doorState: options.doorState ?? DoorState.CLOSED,
    doorTex: options.doorTex ?? Tex.DOOR_WOOD,
    keyId: options.doorKeyId ?? '',
    extraDoorRatio: options.extraDoorRatio ?? 0.5,
  });
  let rooms = 0;
  for (const roomId of roomIdBySite) if (roomId >= 0) rooms++;
  return { rooms, doors, owner, roomIdBySite };
}

function buildSiteBucketGroups<T>(options: VoronoiRoomBuildOptions<T>): Map<number, SiteBucketGroup<T>> {
  const byParent = new Map<number, VoronoiRoomSite<T>[]>();
  for (const site of options.sites) {
    const list = byParent.get(site.parentId);
    if (list) list.push(site);
    else byParent.set(site.parentId, [site]);
  }

  const bucketSize = Math.max(4, Math.floor(options.bucketSize ?? 16));
  const searchRadius = Math.max(1, Math.floor(options.bucketSearchRadius ?? 2));
  const groups = new Map<number, SiteBucketGroup<T>>();
  for (const [parentId, sites] of byParent) {
    const buckets = new Map<number, VoronoiRoomSite<T>[]>();
    for (const site of sites) {
      const key = bucketKey(Math.floor(site.x / bucketSize), Math.floor(site.y / bucketSize));
      const bucket = buckets.get(key);
      if (bucket) bucket.push(site);
      else buckets.set(key, [site]);
    }
    groups.set(parentId, { sites, buckets, bucketSize, searchRadius });
  }
  return groups;
}

function nearestVoronoiRoomSiteId<T>(world: World, x: number, y: number, group: SiteBucketGroup<T>): number {
  const bx = Math.floor(x / group.bucketSize);
  const by = Math.floor(y / group.bucketSize);
  const numBuckets = Math.ceil(W / group.bucketSize);
  let best = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let radius = 0; radius <= group.searchRadius; radius++) {
    for (let yy = by - radius; yy <= by + radius; yy++) {
      for (let xx = bx - radius; xx <= bx + radius; xx++) {
        if (Math.abs(xx - bx) !== radius && Math.abs(yy - by) !== radius) continue;
        let wx = xx % numBuckets;
        if (wx < 0) wx += numBuckets;
        let wy = yy % numBuckets;
        if (wy < 0) wy += numBuckets;
        const bucket = group.buckets.get(bucketKey(wx, wy));
        if (!bucket) continue;
        for (const site of bucket) {
          const score = voronoiSiteScore(world, x, y, site);
          if (score < bestScore) {
            bestScore = score;
            best = site.id;
          }
        }
      }
    }
  }

  if (best >= 0) return best;

  for (const site of group.sites) {
    const score = voronoiSiteScore(world, x, y, site);
    if (score < bestScore) {
      bestScore = score;
      best = site.id;
    }
  }
  return best;
}

function voronoiSiteScore<T>(world: World, x: number, y: number, site: VoronoiRoomSite<T>): number {
  const d2 = world.dist2(x, y, site.x, site.y);
  const weight = site.weight ?? 0;
  return d2 - weight * weight;
}

function bucketKey(x: number, y: number): number {
  return x * 2048 + y;
}

function recordVoronoiRidge<T>(
  world: World,
  map: Map<string, VoronoiRidgeCandidate>,
  sites: readonly VoronoiRoomSite<T>[],
  a: number,
  b: number,
  x: number,
  y: number,
  nx: number,
  ny: number,
  seed: number,
): void {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const sa = sites[lo];
  const sb = sites[hi];
  if (!sa || !sb || sa.parentId !== sb.parentId) return;
  const key = `${lo}:${hi}`;
  const mx = world.wrap(sa.x + world.delta(sa.x, sb.x) / 2);
  const my = world.wrap(sa.y + world.delta(sa.y, sb.y) / 2);
  const score = world.dist2(x, y, mx, my) + hash01(seed, lo, hi, x + y) * 0.01;
  const previous = map.get(key);
  if (!previous || score < previous.score) map.set(key, { a: lo, b: hi, x: world.wrap(x), y: world.wrap(y), nx: world.wrap(nx), ny: world.wrap(ny), parentId: sa.parentId, score });
}

function buildVoronoiRooms<T>(world: World, owner: Int32Array, options: VoronoiRoomBuildOptions<T>): Int32Array {
  const bounds: VoronoiRoomBounds[] = options.sites.map(() => ({ minDx: W, minDy: W, maxDx: -W, maxDy: -W, minX: W, minY: W, maxX: -1, maxY: -1, count: 0 }));
  for (let y = options.minY; y <= options.maxY; y++) {
    for (let x = options.minX; x <= options.maxX; x++) {
      const idx = world.idx(x, y);
      const id = owner[idx];
      if (id < 0 || (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER)) continue;
      const b = bounds[id]!;
      const site = options.sites[id];
      if (!site) continue;
      b.count++;
      const dx = world.delta(site.x, x);
      const dy = world.delta(site.y, y);
      if (dx < b.minDx) b.minDx = dx;
      if (dx > b.maxDx) b.maxDx = dx;
      if (dy < b.minDy) b.minDy = dy;
      if (dy > b.maxDy) b.maxDy = dy;
    }
  }

  const roomIdBySite = new Int32Array(options.sites.length);
  roomIdBySite.fill(-1);
  const minRoomCells = Math.max(1, Math.floor(options.minRoomCells ?? 4));
  for (const site of options.sites) {
    const b = bounds[site.id]!;
    if (b.count < minRoomCells) continue;
    b.minX = world.wrap(site.x + b.minDx);
    b.minY = world.wrap(site.y + b.minDy);
    b.maxX = world.wrap(site.x + b.maxDx);
    b.maxY = world.wrap(site.y + b.maxDy);
    const room = options.createRoom(site, b, world.rooms.length);
    world.rooms.push(room);
    roomIdBySite[site.id] = room.id;
  }

  for (let y = options.minY; y <= options.maxY; y++) {
    for (let x = options.minX; x <= options.maxX; x++) {
      const idx = world.idx(x, y);
      const id = owner[idx];
      if (id < 0 || (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER)) continue;
      const roomId = roomIdBySite[id] ?? -1;
      const site = options.sites[id];
      if (roomId < 0 || !site) continue;
      world.roomMap[idx] = roomId;
      options.paintCell?.(idx, site);
    }
  }
  return roomIdBySite;
}

function placeVoronoiDoors<T>(
  world: World,
  sites: readonly VoronoiRoomSite<T>[],
  ridgeMap: Map<string, VoronoiRidgeCandidate>,
  roomIdBySite: Int32Array,
  options: { doorState: DoorState; doorTex: Tex; keyId: string; extraDoorRatio: number },
): number {
  const candidates = [...ridgeMap.values()]
    .filter(candidate => voronoiDoorCandidateOpenable(world, candidate, roomIdBySite))
    .sort((a, b) => a.parentId - b.parentId || a.score - b.score);
  const parent = new Int32Array(sites.length);
  for (let i = 0; i < parent.length; i++) parent[i] = i;

  const selected = new Set<number>();
  const ordered: VoronoiRidgeCandidate[] = [];
  for (const candidate of candidates) {
    let a = candidate.a;
    let b = candidate.b;

    while (a !== parent[a]) a = parent[a] = parent[parent[a]];
    while (b !== parent[b]) b = parent[b] = parent[parent[b]];

    if (a === b) continue;
    parent[a] = b;

    const ca = candidate.a;
    const cb = candidate.b;
    selected.add(ca < cb ? (ca << 16) | cb : (cb << 16) | ca);
    ordered.push(candidate);
  }

  const extraTarget = Math.floor(sites.length * Math.max(0, options.extraDoorRatio));
  let extras = 0;
  for (const candidate of candidates) {
    if (extras >= extraTarget) break;

    const ca = candidate.a;
    const cb = candidate.b;
    const key = ca < cb ? (ca << 16) | cb : (cb << 16) | ca;

    if (selected.has(key)) continue;
    selected.add(key);
    ordered.push(candidate);
    extras++;
  }

  let doors = 0;
  for (const candidate of ordered) {
    if (placeVoronoiDoor(world, candidate, roomIdBySite, options)) doors++;
  }
  return doors;
}

function voronoiDoorCandidateOpenable(world: World, candidate: VoronoiRidgeCandidate, roomIdBySite: Int32Array): boolean {
  const idx = world.idx(candidate.x, candidate.y);
  const roomA = roomIdBySite[candidate.a] ?? -1;
  const roomB = roomIdBySite[candidate.b] ?? -1;
  return roomA >= 0 &&
    roomB >= 0 &&
    world.cells[idx] === Cell.WALL &&
    hasAxisRoomPair(world, candidate, roomA, roomB);
}

function placeVoronoiDoor(
  world: World,
  candidate: VoronoiRidgeCandidate,
  roomIdBySite: Int32Array,
  options: { doorState: DoorState; doorTex: Tex; keyId: string },
): boolean {
  if (!voronoiDoorCandidateOpenable(world, candidate, roomIdBySite)) return false;
  const idx = world.idx(candidate.x, candidate.y);
  const roomA = roomIdBySite[candidate.a]!;
  const roomB = roomIdBySite[candidate.b]!;
  braceDoorJambs(world, candidate);
  world.cells[idx] = Cell.DOOR;
  world.roomMap[idx] = roomA;
  world.hermoWall[idx] = 0;
  world.wallTex[idx] = options.doorTex;
  world.features[idx] = Feature.NONE;
  world.doors.set(idx, { idx, state: options.doorState, roomA, roomB, keyId: options.keyId, timer: 0 });
  const a = world.rooms[roomA];
  const b = world.rooms[roomB];
  if (a && !a.doors.includes(idx)) a.doors.push(idx);
  if (b && !b.doors.includes(idx)) b.doors.push(idx);
  return true;
}

function hasAxisRoomPair(world: World, candidate: VoronoiRidgeCandidate, roomA: number, roomB: number): boolean {
  const horizontal = candidate.nx !== candidate.x;
  const one = horizontal ? world.idx(candidate.x - 1, candidate.y) : world.idx(candidate.x, candidate.y - 1);
  const two = horizontal ? world.idx(candidate.x + 1, candidate.y) : world.idx(candidate.x, candidate.y + 1);
  const oneRoom = world.roomMap[one];
  const twoRoom = world.roomMap[two];
  if (!isWalkableDoorSide(world.cells[one]) || !isWalkableDoorSide(world.cells[two])) return false;
  return (oneRoom === roomA && twoRoom === roomB) || (oneRoom === roomB && twoRoom === roomA);
}

function braceDoorJambs(world: World, candidate: VoronoiRidgeCandidate): void {
  const horizontal = candidate.nx !== candidate.x;
  const offsets = horizontal ? [[0, -1], [0, 1]] as const : [[-1, 0], [1, 0]] as const;
  for (const [dx, dy] of offsets) {
    const idx = world.idx(candidate.x + dx, candidate.y + dy);
    if (world.cells[idx] === Cell.DOOR || world.cells[idx] === Cell.LIFT) continue;
    if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER && world.cells[idx] !== Cell.WALL) continue;
    world.cells[idx] = Cell.WALL;
    world.roomMap[idx] = -1;
    world.hermoWall[idx] = 0;
    world.wallTex[idx] = Tex.PANEL;
    world.features[idx] = Feature.NONE;
  }
}

function isWalkableDoorSide(cell: number): boolean {
  return cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR;
}

function hash01(seed: number, a: number, b: number, c: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(a + 0x632be5ab, 0x27d4eb2d);
  x ^= Math.imul(b + 0x85157af5, 0x165667b1);
  x ^= Math.imul(c + 0x4cf5ad43, 0xd3a2646c);
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  x = Math.imul(x, 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 0x100000000;
}
