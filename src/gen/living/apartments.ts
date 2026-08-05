/* ── Permanent apartment clusters ─────────────────────────────── */
/*   128 clusters on a 16×16 supergrid. Five layout variants.    */
/*   Protected by aptMask — never destroyed during samosbor.     */

import {
  W,
  Cell,
  RoomType,
  Feature,
  DoorState,
  Tex,
  type Room,
} from '../../core/types';
import { World } from '../../core/world';
import {
  rng, shuffle, stampRoom, placeDoor,
} from '../shared';
import { maybePlaceBrokenFixture } from '../interactive_fixtures';

export interface AptPlan { rooms: Room[]; living: Room; }

const CONNECTOR_MAX_COST = 180;
const CONNECTOR_DIRS = [[1,0],[-1,0],[0,1],[0,-1]] as const;

/* ── Layout variants ─────────────────────────────────────────────
   Classic:     жилая + кухня + санузел  (35%)
   Communal:    2-4 жилых + общий санузел (20%)
   Studio:      одна жилая              (15%)
   Extended:    жилая + кухня + санузел + жилая  (15%)
   Barrack:     3-5 маленьких жилых в ряд + санузел (15%)
   ──────────────────────────────────────────────────────────────── */
function generateApartmentLayout(world: World, bx: number, by: number, a: number, startRoomId: number, roll: number): { rooms: Room[], primary: Room, nextRoomId: number } {
  let nextRoomId = startRoomId;
  const allRooms: Room[] = [];
  let primary: Room;

  if (roll < 0.35) {
    /* ── Classic: жилая + кухня + санузел ────────── */
    const lw = rng(5, 8), lh = rng(5, 7);
    primary = stampRoom(world, nextRoomId++, RoomType.LIVING, bx, by, lw, lh, a);
    allRooms.push(primary);
    const kw = rng(4, 6), kh = rng(4, 5);
    const kr = stampRoom(world, nextRoomId++, RoomType.KITCHEN, bx + lw + 1, by, kw, kh, a);
    allRooms.push(kr);
    const bww = rng(3, 4), bhh = rng(3, 4);
    const br = stampRoom(world, nextRoomId++, RoomType.BATHROOM, bx, by + lh + 1, bww, bhh, a);
    allRooms.push(br);
    placeDoor(world, primary, kr, '', true);
    placeDoor(world, primary, br, '', true);

  } else if (roll < 0.55) {
    /* ── Communal: 2-4 жилых в ряд + общий санузел ── */
    const count = rng(2, 4);
    let cx = bx;
    for (let c = 0; c < count; c++) {
      const lw = rng(4, 6), lh = rng(4, 6);
      const lr = stampRoom(world, nextRoomId++, RoomType.LIVING, cx, by, lw, lh, a);
      allRooms.push(lr);
      if (c === 0) primary = lr;
      if (c > 0) placeDoor(world, allRooms[c - 1], lr, '', true);
      cx += lw + 1;
    }
    primary = allRooms[0];
    const bww = rng(3, 5), bhh = rng(3, 4);
    const br = stampRoom(world, nextRoomId++, RoomType.BATHROOM, bx, by + allRooms[0].h + 1, bww, bhh, a);
    allRooms.push(br);
    placeDoor(world, allRooms[0], br, '', true);

  } else if (roll < 0.70) {
    /* ── Studio: одна жилая ──────────────────────── */
    const lw = rng(5, 9), lh = rng(5, 8);
    primary = stampRoom(world, nextRoomId++, RoomType.LIVING, bx, by, lw, lh, a);
    allRooms.push(primary);

  } else if (roll < 0.85) {
    /* ── Extended: жилая + кухня + санузел + жилая ── */
    const lw = rng(5, 7), lh = rng(5, 7);
    primary = stampRoom(world, nextRoomId++, RoomType.LIVING, bx, by, lw, lh, a);
    allRooms.push(primary);
    const kw = rng(4, 6), kh = rng(4, 5);
    const kr = stampRoom(world, nextRoomId++, RoomType.KITCHEN, bx + lw + 1, by, kw, kh, a);
    allRooms.push(kr);
    const bww = rng(3, 4), bhh = rng(3, 4);
    const br = stampRoom(world, nextRoomId++, RoomType.BATHROOM, bx, by + lh + 1, bww, bhh, a);
    allRooms.push(br);
    const lw2 = rng(4, 6), lh2 = rng(4, 6);
    const lr2 = stampRoom(world, nextRoomId++, RoomType.LIVING, bx + lw + 1, by + kh + 1, lw2, lh2, a);
    allRooms.push(lr2);
    placeDoor(world, primary, kr, '', true);
    placeDoor(world, primary, br, '', true);
    placeDoor(world, kr, lr2, '', true);

  } else {
    /* ── Barrack: 3-5 маленьких жилых + санузел ──── */
    const count = rng(3, 5);
    let cy = by;
    for (let c = 0; c < count; c++) {
      const lw = rng(4, 5), lh = rng(3, 5);
      const lr = stampRoom(world, nextRoomId++, RoomType.LIVING, bx, cy, lw, lh, a);
      allRooms.push(lr);
      if (c > 0) placeDoor(world, allRooms[c - 1], lr, '', true);
      cy += lh + 1;
    }
    primary = allRooms[0];
    const bww = rng(3, 5), bhh = rng(3, 4);
    const br = stampRoom(world, nextRoomId++, RoomType.BATHROOM, bx + allRooms[0].w + 1, by, bww, bhh, a);
    allRooms.push(br);
    placeDoor(world, allRooms[0], br, '', true);
  }

  return { rooms: allRooms, primary: primary!, nextRoomId };
}

function buildApartmentProtectionMask(world: World, maxRoomId: number): void {
  for (let i = 0; i < maxRoomId; i++) {
    const room = world.rooms[i];
    if (!room) continue;
    for (let dy = -1; dy <= room.h; dy++)
      for (let dx = -1; dx <= room.w; dx++)
        world.aptMask[world.idx(room.x + dx, room.y + dy)] = 1;
  }
}

function markShelterWalls(world: World, maxRoomId: number): void {
  for (let i = 0; i < maxRoomId; i++) {
    const room = world.rooms[i];
    if (!room) continue;
    if (room.type !== RoomType.LIVING) continue;
    for (let dy = -1; dy <= room.h; dy++) {
      for (let dx = -1; dx <= room.w; dx++) {
        if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
        const ci = world.idx(room.x + dx, room.y + dy);
        if (world.cells[ci] !== Cell.WALL) continue;
        world.hermoWall[ci] = 1;
        world.wallTex[ci] = Tex.HERMO_WALL;
      }
    }
  }
}

function placeApartmentFeatures(world: World, apartments: AptPlan[]): void {
  const APT_FEATURES: Partial<Record<RoomType, Feature[]>> = {
    [RoomType.LIVING]:   [Feature.LAMP, Feature.BED, Feature.TABLE, Feature.CHAIR, Feature.SHELF],
    [RoomType.KITCHEN]:  [Feature.LAMP, Feature.STOVE, Feature.TABLE, Feature.SINK, Feature.SHELF],
    [RoomType.BATHROOM]: [Feature.LAMP, Feature.TOILET, Feature.SINK],
  };
  for (const apt of apartments) {
    for (const room of apt.rooms) {
      world.features[world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2))] = Feature.LAMP;
      const feats = APT_FEATURES[room.type] ?? [Feature.LAMP];
      for (const feat of feats) {
        if (feat === Feature.LAMP) continue;
        for (let tries = 0; tries < 10; tries++) {
          const fx = room.x + rng(1, Math.max(1, room.w - 2));
          const fy = room.y + rng(1, Math.max(1, room.h - 2));
          const fi = world.idx(fx, fy);
          if (world.features[fi] === Feature.NONE && world.cells[fi] === Cell.FLOOR) {
            world.features[fi] = feat;
            maybePlaceBrokenFixture(world, fx, fy, { salt: room.apartmentId * 257 + room.id * 17 + tries });
            break;
          }
        }
      }
      for (let dy = 0; dy < room.h; dy++)
        for (let dx = 0; dx < room.w; dx++)
          world.floorTex[world.idx(room.x + dx, room.y + dy)] = room.floorTex;
    }
  }
}

export function generateApartments(world: World): AptPlan[] {
  let nextRoomId = 0;
  const apartments: AptPlan[] = [];

  const SGRID = 16;
  const SCELL = Math.floor(W / SGRID);
  const superCells: [number, number][] = [];
  for (let sx = 0; sx < SGRID; sx++)
    for (let sy = 0; sy < SGRID; sy++)
      superCells.push([sx, sy]);
  shuffle(superCells);

  for (let a = 0; a < 128 && a < superCells.length; a++) {
    const [sx, sy] = superCells[a];
    const bx = sx * SCELL + rng(4, SCELL - 24);
    const by = sy * SCELL + rng(4, SCELL - 20);
    const roll = Math.random();

    const result = generateApartmentLayout(world, bx, by, a, nextRoomId, roll);
    nextRoomId = result.nextRoomId;
    apartments.push({ rooms: result.rooms, living: result.primary });
  }

  world.apartmentRoomCount = nextRoomId;

  buildApartmentProtectionMask(world, nextRoomId);
  markShelterWalls(world, nextRoomId);
  placeApartmentFeatures(world, apartments);

  return apartments;
}

/* ── Connect each apartment cluster to the volatile maze ──────── */
export function connectApartmentsToMaze(world: World): void {
  const aptCount = world.apartmentRoomCount;

  const clusters = new Map<number, Room[]>();
  for (let i = 0; i < aptCount; i++) {
    const room = world.rooms[i];
    if (!room) continue;
    const aid = room.apartmentId;
    if (!clusters.has(aid)) clusters.set(aid, []);
    clusters.get(aid)!.push(room);
  }

  for (const [aptId, rooms] of clusters) {
    const groups = aptId < 0 ? rooms.map(room => [room]) : [rooms];
    for (const group of groups) {
      if (connectClusterDirect(world, group, aptCount)) continue;
      if (connectClusterWeightedPath(world, group)) continue;
      connectClusterCarve(world, group, aptCount);
    }
  }
}

function connectClusterDirect(world: World, rooms: Room[], aptCount: number): boolean {
  for (const room of rooms) {
    for (let dy = -1; dy <= room.h; dy++) {
      for (let dx = -1; dx <= room.w; dx++) {
        if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
        const wx = world.wrap(room.x + dx);
        const wy = world.wrap(room.y + dy);
        const ci = world.idx(wx, wy);
        if (world.cells[ci] !== Cell.WALL) continue;

        for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
          const ox = world.wrap(wx + ddx);
          const oy = world.wrap(wy + ddy);
          const oi = world.idx(ox, oy);
          if (world.aptMask[oi]) continue;
          if (world.cells[oi] !== Cell.FLOOR && world.cells[oi] !== Cell.DOOR) continue;
          const ix = world.wrap(wx - ddx);
          const iy = world.wrap(wy - ddy);
          if (world.roomMap[world.idx(ix, iy)] !== room.id) continue;

          const p1 = world.idx(world.wrap(wx + ddy), world.wrap(wy + ddx));
          const p2 = world.idx(world.wrap(wx - ddy), world.wrap(wy - ddx));
          if (world.cells[p1] !== Cell.WALL || world.cells[p2] !== Cell.WALL) continue;

          const volRoom = world.roomMap[oi] >= aptCount ? world.roomMap[oi] : -1;
          world.cells[ci] = Cell.DOOR;
          world.doors.set(ci, {
            idx: ci, state: DoorState.HERMETIC_OPEN,
            roomA: room.id, roomB: volRoom, keyId: '', timer: 0,
          });
          room.doors.push(ci);
          if (volRoom >= 0) {
            const vr = world.rooms[volRoom];
            if (vr) vr.doors.push(ci);
          }
          return true;
        }
      }
    }
  }
  return false;
}

interface DoorCandidate {
  doorIdx: number;
  outIdx: number;
  room: Room;
}

interface HeapNode {
  idx: number;
  cost: number;
}

function connectClusterWeightedPath(world: World, rooms: Room[]): boolean {
  const candidates = collectDoorCandidates(world, rooms);
  if (candidates.length === 0) return false;

  const costs = new Map<number, number>();
  const prev = new Map<number, number>();
  const source = new Map<number, number>();
  const heap: HeapNode[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const outIdx = candidates[i].outIdx;
    if (!canUseConnectorCell(world, outIdx)) continue;
    costs.set(outIdx, 0);
    source.set(outIdx, i);
    heapPush(heap, { idx: outIdx, cost: 0 });
  }

  while (heap.length > 0) {
    const node = heapPop(heap)!;
    if (node.cost !== costs.get(node.idx)) continue;
    if (node.cost > CONNECTOR_MAX_COST) continue;
    if (isPublicConnectorTarget(world, node.idx)) {
      carveWeightedConnector(world, candidates[source.get(node.idx)!], node.idx, prev);
      return true;
    }

    const x = node.idx % W;
    const y = (node.idx / W) | 0;
    for (const [dx, dy] of CONNECTOR_DIRS) {
      const ni = world.idx(x + dx, y + dy);
      if (!canUseConnectorCell(world, ni)) continue;
      if (world.cells[ni] === Cell.WALL && touchesRoomInterior(world, ni)) continue;
      const nextCost = node.cost + connectorStepCost(world, ni);
      if (nextCost > CONNECTOR_MAX_COST) continue;
      const oldCost = costs.get(ni);
      if (oldCost !== undefined && oldCost <= nextCost) continue;
      costs.set(ni, nextCost);
      prev.set(ni, node.idx);
      source.set(ni, source.get(node.idx)!);
      heapPush(heap, { idx: ni, cost: nextCost });
    }
  }

  return false;
}

function collectDoorCandidates(world: World, rooms: Room[]): DoorCandidate[] {
  const candidates: DoorCandidate[] = [];
  const seen = new Set<number>();
  for (const room of rooms) {
    for (let dy = -1; dy <= room.h; dy++) {
      for (let dx = -1; dx <= room.w; dx++) {
        if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
        const wx = world.wrap(room.x + dx);
        const wy = world.wrap(room.y + dy);
        const wi = world.idx(wx, wy);
        if (world.cells[wi] !== Cell.WALL || seen.has(wi)) continue;

        for (const [ddx, ddy] of CONNECTOR_DIRS) {
          const inside = world.idx(wx - ddx, wy - ddy);
          if (world.roomMap[inside] !== room.id) continue;
          const outIdx = world.idx(wx + ddx, wy + ddy);
          if (!canUseConnectorCell(world, outIdx)) continue;
          const flankA = world.idx(wx + ddy, wy + ddx);
          const flankB = world.idx(wx - ddy, wy - ddx);
          if (world.cells[flankA] !== Cell.WALL || world.cells[flankB] !== Cell.WALL) continue;
          candidates.push({ doorIdx: wi, outIdx, room });
          seen.add(wi);
          break;
        }
      }
    }
  }
  return candidates;
}

function canUseConnectorCell(world: World, idx: number): boolean {
  if (world.aptMask[idx] || world.hermoWall[idx]) return false;
  if (world.roomMap[idx] >= 0) return false;
  const cell = world.cells[idx];
  return cell === Cell.WALL || cell === Cell.FLOOR || (cell === Cell.DOOR && world.doors.has(idx));
}

function isPublicConnectorTarget(world: World, idx: number): boolean {
  if (world.aptMask[idx] || world.hermoWall[idx]) return false;
  if (world.roomMap[idx] >= 0) return false;
  const cell = world.cells[idx];
  return cell === Cell.FLOOR || (cell === Cell.DOOR && world.doors.has(idx));
}

function touchesRoomInterior(world: World, idx: number): boolean {
  const x = idx % W;
  const y = (idx / W) | 0;
  for (const [dx, dy] of CONNECTOR_DIRS) {
    if (world.roomMap[world.idx(x + dx, y + dy)] >= 0) return true;
  }
  return false;
}

function connectorStepCost(world: World, idx: number): number {
  if (world.cells[idx] === Cell.FLOOR) {
    if (world.floorTex[idx] === Tex.F_TILE || world.floorTex[idx] === Tex.F_CONCRETE || world.floorTex[idx] === Tex.F_LINO) return 1;
    return 2;
  }
  if (world.cells[idx] === Cell.DOOR) return 2;
  return 6;
}

function carveWeightedConnector(world: World, candidate: DoorCandidate, targetIdx: number, prev: Map<number, number>): void {
  const path: number[] = [];
  let cursor = targetIdx;
  path.push(cursor);
  while (cursor !== candidate.outIdx) {
    const next = prev.get(cursor);
    if (next === undefined) break;
    cursor = next;
    path.push(cursor);
  }
  const floorTex = world.floorTex[targetIdx] || Tex.F_LINO;
  for (const ci of path) {
    if (world.aptMask[ci] || world.hermoWall[ci]) continue;
    if (world.cells[ci] === Cell.DOOR && world.doors.has(ci)) continue;
    world.cells[ci] = Cell.FLOOR;
    world.roomMap[ci] = -1;
    world.floorTex[ci] = floorTex;
    if (world.features[ci] !== Feature.LIFT_BUTTON) world.features[ci] = Feature.NONE;
  }
  world.cells[candidate.doorIdx] = Cell.DOOR;
  world.wallTex[candidate.doorIdx] = Tex.DOOR_METAL;
  world.floorTex[candidate.doorIdx] = floorTex;
  world.doors.set(candidate.doorIdx, {
    idx: candidate.doorIdx,
    state: DoorState.HERMETIC_OPEN,
    roomA: candidate.room.id,
    roomB: -1,
    keyId: '',
    timer: 0,
  });
  if (!candidate.room.doors.includes(candidate.doorIdx)) candidate.room.doors.push(candidate.doorIdx);
}

function heapPush(heap: HeapNode[], node: HeapNode): void {
  heap.push(node);
  for (let i = heap.length - 1; i > 0;) {
    const p = (i - 1) >> 1;
    if (heap[p].cost <= node.cost) break;
    heap[i] = heap[p];
    i = p;
    heap[i] = node;
  }
}

function heapPop(heap: HeapNode[]): HeapNode | undefined {
  if (heap.length === 0) return undefined;
  const out = heap[0];
  const last = heap.pop()!;
  if (heap.length > 0) {
    heap[0] = last;
    for (let i = 0;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      if (l >= heap.length) break;
      let c = l;
      if (r < heap.length && heap[r].cost < heap[l].cost) c = r;
      if (heap[i].cost <= heap[c].cost) break;
      const tmp = heap[i];
      heap[i] = heap[c];
      heap[c] = tmp;
      i = c;
    }
  }
  return out;
}

function connectClusterCarve(world: World, rooms: Room[], _aptCount: number): void {
  const room = rooms[0];
  const sides = shuffle([0, 1, 2, 3]);
  for (const side of sides) {
    let wx: number, wy: number, sdx: number, sdy: number;
    if (side === 0) {
      wx = world.wrap(room.x + room.w);
      wy = world.wrap(room.y + Math.floor(room.h / 2));
      sdx = 1; sdy = 0;
    } else if (side === 1) {
      wx = world.wrap(room.x - 1);
      wy = world.wrap(room.y + Math.floor(room.h / 2));
      sdx = -1; sdy = 0;
    } else if (side === 2) {
      wx = world.wrap(room.x + Math.floor(room.w / 2));
      wy = world.wrap(room.y + room.h);
      sdx = 0; sdy = 1;
    } else {
      wx = world.wrap(room.x + Math.floor(room.w / 2));
      wy = world.wrap(room.y - 1);
      sdx = 0; sdy = -1;
    }

    const wi = world.idx(wx, wy);
    if (world.cells[wi] !== Cell.WALL) continue;

    const carved: number[] = [];
    let ex = world.wrap(wx + sdx), ey = world.wrap(wy + sdy);
    let found = false;
    for (let d = 0; d < 50; d++) {
      const fi = world.idx(ex, ey);
      if (world.aptMask[fi]) break;
      if (world.cells[fi] === Cell.FLOOR || world.cells[fi] === Cell.DOOR) {
        found = true;
        break;
      }
      carved.push(fi);
      ex = world.wrap(ex + sdx);
      ey = world.wrap(ey + sdy);
    }
    if (!found) continue;

    world.cells[wi] = Cell.DOOR;
    world.doors.set(wi, {
      idx: wi, state: DoorState.HERMETIC_OPEN,
      roomA: room.id, roomB: -1, keyId: '', timer: 0,
    });
    room.doors.push(wi);
    for (const ci of carved) {
      world.cells[ci] = Cell.FLOOR;
    }
    return;
  }
}
