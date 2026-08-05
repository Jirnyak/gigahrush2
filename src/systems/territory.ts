import {
  AIGoal,
  Cell,
  DoorState,
  EntityType,
  Feature,
  RoomType,
  Tex,
  W,
  ZoneFaction,
  type Entity,
  type GameState,
  type Room,
  type TerritoryOwner,
} from '../core/types';
import { World } from '../core/world';
import { occupationHasProfileTag } from '../data/occupation_profiles';
import {
  HUMAN_TERRITORY_OWNERS,
  TERRITORY_OWNERS,
  factionToTerritoryOwner,
  isTerritoryOwner,
  territoryOwnerToFaction,
} from '../data/factions';
import { setDoorState } from './door_state';
import { ENTITY_MASK_NPC, ensureEntityIndex, getEntityIndex } from './entity_index';
import { publishEvent } from './events';

const OWNER_BUCKETS = 8;
const HQ_PATCH_RADIUS = 5;
const HQ_PATCH_MAX_CELLS = 96;
const AUTO_HQ_MAX_ROOM_SPAN = 96;
const AUTO_HQ_MAX_DOORS = 12;
const TERRITORY_BUCKET_SIZE = 32;
const TERRITORY_BUCKET_SIDE = W / TERRITORY_BUCKET_SIZE;
const ZONE_SAMPLE_RADIUS = 60;
const ZONE_SAMPLE_STEP = 4;
const CAPTURE_INTERVAL_SEC = 2;
const CAPTURE_RADIUS = 3;
const CAPTURE_ACTOR_SCAN_RADIUS = 10;
const CAPTURE_ACTOR_SCAN_CAP = 24;
const CAPTURE_GLOBAL_CELL_CAP = 384;
const CAPTURE_EVENT_LIMIT = 4;

const ownerCountsScratch = new Uint32Array(OWNER_BUCKETS);
const roomCountsScratch = new Uint32Array(OWNER_BUCKETS);
const zoneCountsScratch = new Uint16Array(OWNER_BUCKETS);
const captureQuery: Entity[] = [];
let captureAccum = 0;

export interface TerritoryOwnerCount {
  owner: TerritoryOwner;
  cells: number;
}

export interface TerritoryHqAnchor {
  owner: TerritoryOwner;
  roomId: number;
  x: number;
  y: number;
}

export interface TerritoryTargetShare {
  owner: TerritoryOwner;
  share: number;
}

export interface TerritoryInitializationOptions {
  seed?: number;
  targetShares?: readonly TerritoryTargetShare[];
}

export interface PaintRoomTerritoryOptions {
  includeDoors?: boolean;
  preserveAptMask?: boolean;
}

export interface PaintTerritoryDiscOptions {
  cellCap?: number;
  zoneId?: number;
  preserveSamosbor?: boolean;
  passableOnly?: boolean;
  probability?: number;
  random?: () => number;
  onChange?: (idx: number, previousOwner: TerritoryOwner) => void;
}

function normalizeOwner(value: number): TerritoryOwner {
  return isTerritoryOwner(value) ? value : ZoneFaction.CITIZEN;
}

function walkableForCapture(cell: Cell): boolean {
  return cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.WATER;
}

export function territoryOwnerAtIndex(world: World, idx: number): TerritoryOwner {
  return normalizeOwner(world.factionControl[idx] ?? ZoneFaction.CITIZEN);
}

export function territoryOwnerAt(world: World, x: number, y: number): TerritoryOwner {
  return territoryOwnerAtIndex(world, world.idx(Math.floor(x), Math.floor(y)));
}

export function territoryFactionAt(world: World, x: number, y: number) {
  return territoryOwnerToFaction(territoryOwnerAt(world, x, y));
}

export function setTerritoryOwnerAtIndex(world: World, idx: number, owner: TerritoryOwner): boolean {
  const next = normalizeOwner(owner);
  if (world.factionControl[idx] === next) return false;
  world.factionControl[idx] = next;
  return true;
}

export function setTerritoryOwnerAt(world: World, x: number, y: number, owner: TerritoryOwner): boolean {
  return setTerritoryOwnerAtIndex(world, world.idx(Math.floor(x), Math.floor(y)), owner);
}

export function countTerritoryCells(world: World, step = 1): TerritoryOwnerCount[] {
  ownerCountsScratch.fill(0);
  const stride = Math.max(1, Math.floor(step));
  for (let y = 0; y < W; y += stride) {
    for (let x = 0; x < W; x += stride) {
      const owner = territoryOwnerAtIndex(world, world.idx(x, y));
      ownerCountsScratch[owner]++;
    }
  }
  const multiplier = stride * stride;
  return TERRITORY_OWNERS.map(owner => ({
    owner,
    cells: ownerCountsScratch[owner] * multiplier,
  }));
}

export function dominantTerritoryOwnerInRoom(world: World, roomId: number): TerritoryOwner {
  const room = world.rooms[roomId];
  if (!room) return ZoneFaction.CITIZEN;
  roomCountsScratch.fill(0);
  forEachMappedRoomCell(world, room, idx => {
    const owner = territoryOwnerAtIndex(world, idx);
    if (owner < roomCountsScratch.length) roomCountsScratch[owner]++;
  });
  return dominantOwnerFromCounts(roomCountsScratch, ZoneFaction.CITIZEN);
}

export function territoryRoomOwner(world: World, roomId: number): TerritoryOwner {
  const room = world.rooms[roomId];
  if (!room) return ZoneFaction.CITIZEN;
  if (room.type === RoomType.HQ) {
    const center = world.idx(room.x + (room.w >> 1), room.y + (room.h >> 1));
    return territoryOwnerAtIndex(world, center);
  }
  return dominantTerritoryOwnerInRoom(world, roomId);
}

export function currentTerritoryZoneId(world: World, x: number, y: number): number {
  const idx = world.idx(Math.floor(x), Math.floor(y));
  const zoneId = world.zoneMap[idx] ?? 0;
  return zoneId >= 0 && zoneId < world.zones.length ? zoneId : 0;
}

function currentFieldHasAuthoredTerritory(world: World): boolean {
  let first = -1;
  for (let i = 0; i < world.factionControl.length; i++) {
    const owner = normalizeOwner(world.factionControl[i]);
    if (first < 0) first = owner;
    else if (owner !== first) return true;
  }
  return first !== ZoneFaction.CITIZEN && first >= 0;
}

function sanitizeCurrentTerritory(world: World): void {
  for (let i = 0; i < world.factionControl.length; i++) {
    world.factionControl[i] = normalizeOwner(world.factionControl[i]);
  }
}

function seedTerritoryFromZoneMetadata(world: World): void {
  for (let i = 0; i < W * W; i++) {
    const zone = world.zones[world.zoneMap[i]];
    world.factionControl[i] = normalizeOwner(zone?.faction ?? ZoneFaction.CITIZEN);
  }
}

function dominantOwnerFromCounts<T extends Uint16Array | Uint32Array>(counts: T, fallback: TerritoryOwner): TerritoryOwner {
  let best = fallback;
  let bestCount = -1;
  for (const owner of TERRITORY_OWNERS) {
    const count = counts[owner] ?? 0;
    if (count > bestCount) {
      best = owner;
      bestCount = count;
    }
  }
  return best;
}

function roomCenter(room: Room): { x: number; y: number } {
  return { x: worldWrap(room.x + (room.w >> 1)), y: worldWrap(room.y + (room.h >> 1)) };
}

function worldWrap(v: number): number {
  return ((v % W) + W) % W;
}

function roomArea(room: Room): number {
  return room.w * room.h;
}

function autoHqRoomSpanEligible(room: Room): boolean {
  return room.w > 1 && room.h > 1 && room.w <= AUTO_HQ_MAX_ROOM_SPAN && room.h <= AUTO_HQ_MAX_ROOM_SPAN;
}

function autoHqDoorEligible(room: Room): boolean {
  return room.doors.length > 0 && room.doors.length <= AUTO_HQ_MAX_DOORS;
}

function hqRoomGeometrySane(room: Room): boolean {
  return room.w > 1 && room.h > 1 && room.w < W && room.h < W;
}

function forEachMappedRoomCell(world: World, room: Room, visit: (idx: number) => void): number {
  let count = 0;
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[idx] !== room.id) continue;
      visit(idx);
      count++;
    }
  }
  return count;
}

function roomHasMappedCell(world: World, room: Room): boolean {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[idx] === room.id) return true;
    }
  }
  return false;
}

function hqShellCapacity(world: World, room: Room): number {
  let cells = 0;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.hermoWall[idx]) {
        cells++;
        continue;
      }
      if (!world.aptMask[idx] && world.cells[idx] === Cell.WALL) cells++;
    }
  }
  return cells;
}

function roomMappedAptCells(world: World, room: Room): number {
  let cells = 0;
  forEachMappedRoomCell(world, room, idx => {
    if (world.aptMask[idx]) cells++;
  });
  return cells;
}

function hqAnchorEligible(world: World, room: Room): boolean {
  return room.apartmentId < 0 &&
    hqRoomGeometrySane(room) &&
    roomHasMappedCell(world, room) &&
    roomMappedAptCells(world, room) === 0 &&
    hqShellCapacity(world, room) > 0;
}

function autoHqCandidateEligible(world: World, room: Room): boolean {
  return room.apartmentId < 0 &&
    autoHqRoomSpanEligible(room) &&
    autoHqDoorEligible(room) &&
    roomHasMappedCell(world, room) &&
    roomMappedAptCells(world, room) === 0 &&
    hqShellCapacity(world, room) > 0;
}

function roomHasHermeticDoor(world: World, room: Room): boolean {
  return room.doors.some(idx => {
    const state = world.doors.get(idx)?.state;
    return state === DoorState.HERMETIC_OPEN || state === DoorState.HERMETIC_CLOSED;
  });
}

function authoredHqAnchorEligible(world: World, room: Room): boolean {
  return room.apartmentId < 0 &&
    hqRoomGeometrySane(room) &&
    roomHasMappedCell(world, room) &&
    roomHasHermeticDoor(world, room);
}

function roomOwnerHint(world: World, room: Room): TerritoryOwner {
  roomCountsScratch.fill(0);
  forEachMappedRoomCell(world, room, idx => {
    roomCountsScratch[territoryOwnerAtIndex(world, idx)]++;
  });
  return dominantOwnerFromCounts(roomCountsScratch, ZoneFaction.CITIZEN);
}

function roomPreference(owner: TerritoryOwner, room: Room): number {
  if (room.apartmentId >= 0) return -100;
  if (room.type === RoomType.HQ) return 100;
  if (owner === ZoneFaction.LIQUIDATOR) {
    if (room.type === RoomType.OFFICE || room.type === RoomType.STORAGE) return 40;
    if (room.type === RoomType.CORRIDOR || room.type === RoomType.COMMON) return 20;
  }
  if (owner === ZoneFaction.CULTIST) {
    if (room.type === RoomType.COMMON || room.type === RoomType.STORAGE) return 36;
    if (room.type === RoomType.CORRIDOR) return 12;
  }
  if (owner === ZoneFaction.SCIENTIST) {
    if (room.type === RoomType.MEDICAL || room.type === RoomType.OFFICE || room.type === RoomType.PRODUCTION) return 44;
    if (room.type === RoomType.STORAGE) return 18;
  }
  if (owner === ZoneFaction.WILD) {
    if (room.type === RoomType.STORAGE || room.type === RoomType.SMOKING || room.type === RoomType.CORRIDOR) return 34;
    if (room.type === RoomType.COMMON) return 12;
  }
  if (owner === ZoneFaction.CITIZEN) {
    if (room.type === RoomType.COMMON || room.type === RoomType.KITCHEN || room.type === RoomType.LIVING) return 36;
    if (room.type === RoomType.MEDICAL) return 18;
  }
  return 0;
}

function chooseAnchorRoom(world: World, owner: TerritoryOwner, usedRooms: Set<number>): Room | null {
  let best: Room | null = null;
  let bestScore = -Infinity;
  for (const room of world.rooms) {
    if (!room) continue;
    if (room.id === 0) continue;
    if (usedRooms.has(room.id)) continue;
    if (roomArea(room) > 4096) continue;
    if (!autoHqCandidateEligible(world, room)) continue;
    const hint = roomOwnerHint(world, room);
    const score = roomPreference(owner, room)
      + (hint === owner ? 60 : 0)
      + Math.min(20, Math.floor((room.w * room.h) / 10))
      - Math.abs(room.id * 17 - owner * 31) * 0.001;
    if (score > bestScore) {
      best = room;
      bestScore = score;
    }
  }
  return best;
}

function hqAnchorSelectionScore(world: World, room: Room, owner: TerritoryOwner): number {
  return roomPreference(owner, room)
    + Math.min(60, roomArea(room) * 0.05)
    + Math.min(24, hqShellCapacity(world, room) * 0.02)
    - room.doors.length * 0.5
    - room.id * 0.0001;
}

function chooseExistingHqAnchorRoom(
  world: World,
  owner: TerritoryOwner,
  usedRooms: ReadonlySet<number>,
  eligible: (world: World, room: Room) => boolean,
): Room | null {
  let best: Room | null = null;
  let bestScore = -Infinity;
  for (const room of world.rooms) {
    if (!room || room.type !== RoomType.HQ || usedRooms.has(room.id)) continue;
    if (!eligible(world, room)) continue;
    if (territoryRoomOwner(world, room.id) !== owner) continue;
    const score = hqAnchorSelectionScore(world, room, owner);
    if (score > bestScore) {
      best = room;
      bestScore = score;
    }
  }
  return best;
}

function pushTerritoryHqAnchor(anchors: TerritoryHqAnchor[], room: Room, owner: TerritoryOwner): void {
  const center = roomCenter(room);
  anchors.push({ owner, roomId: room.id, x: center.x, y: center.y });
}

export function paintRoomTerritory(
  world: World,
  roomId: number,
  owner: TerritoryOwner,
  options: PaintRoomTerritoryOptions = {},
): number {
  const room = world.rooms[roomId];
  if (!room) return 0;
  return paintRoomOwner(world, room, owner, options);
}

export function paintTerritoryDisc(
  world: World,
  x: number,
  y: number,
  radius: number,
  owner: TerritoryOwner,
  options: PaintTerritoryDiscOptions = {},
): number {
  const r = Math.max(0, Math.floor(radius));
  const r2 = r * r;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const cap = Math.max(0, Math.floor(options.cellCap ?? Number.MAX_SAFE_INTEGER));
  const preserveSamosbor = options.preserveSamosbor !== false;
  const probability = Math.max(0, Math.min(1, options.probability ?? 1));
  const random = options.random ?? Math.random;
  let changed = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (changed >= cap) return changed;
      if (dx * dx + dy * dy > r2) continue;
      if (probability < 1 && random() > probability) continue;
      const idx = world.idx(cx + dx, cy + dy);
      if (options.zoneId !== undefined && world.zoneMap[idx] !== options.zoneId) continue;
      if (options.passableOnly && !walkableForCapture(world.cells[idx])) continue;
      const previousOwner = territoryOwnerAtIndex(world, idx);
      if (preserveSamosbor && previousOwner === ZoneFaction.SAMOSBOR) continue;
      const roomId = world.roomMap[idx];
      if (roomId > 0 && world.rooms[roomId]?.type === RoomType.HQ && previousOwner !== owner) continue;
      if (!setTerritoryOwnerAtIndex(world, idx, owner)) continue;
      options.onChange?.(idx, previousOwner);
      changed++;
    }
  }
  return changed;
}

function paintRoomOwner(
  world: World,
  room: Room,
  owner: TerritoryOwner,
  options: PaintRoomTerritoryOptions = {},
): number {
  const preserveAptMask = options.preserveAptMask !== false;
  const includeDoors = options.includeDoors !== false;
  if (room.type === RoomType.HQ && dominantTerritoryOwnerInRoom(world, room.id) !== owner) {
    return 0;
  }
  let changed = 0;
  forEachMappedRoomCell(world, room, idx => {
    if (preserveAptMask && world.aptMask[idx]) return;
    if (setTerritoryOwnerAtIndex(world, idx, owner)) changed++;
  });
  if (!includeDoors) return changed;
  for (const idx of room.doors) {
    if (preserveAptMask && world.aptMask[idx]) continue;
    if (setTerritoryOwnerAtIndex(world, idx, owner)) changed++;
  }
  return changed;
}

function paintOwnerPatch(world: World, x: number, y: number, owner: TerritoryOwner): number {
  let changed = 0;
  for (let dy = -HQ_PATCH_RADIUS; dy <= HQ_PATCH_RADIUS; dy++) {
    for (let dx = -HQ_PATCH_RADIUS; dx <= HQ_PATCH_RADIUS; dx++) {
      if (changed >= HQ_PATCH_MAX_CELLS) return changed;
      if (dx * dx + dy * dy > HQ_PATCH_RADIUS * HQ_PATCH_RADIUS) continue;
      const idx = world.idx(x + dx, y + dy);
      if (world.aptMask[idx]) continue;
      if (world.cells[idx] === Cell.ABYSS || world.cells[idx] === Cell.LIFT) continue;
      const roomId = world.roomMap[idx];
      if (roomId > 0 && world.rooms[roomId]?.type === RoomType.HQ && territoryOwnerAtIndex(world, idx) !== owner) continue;
      if (setTerritoryOwnerAtIndex(world, idx, owner)) changed++;
    }
  }
  return changed;
}

function hardenHqRoom(world: World, room: Room, owner: TerritoryOwner): void {
  const existingHq = room.type === RoomType.HQ;
  if ((existingHq && !hqRoomGeometrySane(room)) || (!existingHq && !autoHqCandidateEligible(world, room))) {
    room.sealed = false;
    paintRoomOwner(world, room, owner, { includeDoors: false });
    return;
  }
  room.type = RoomType.HQ;
  room.sealed = true;
  if (!room.name || room.name.startsWith('Комната') || room.name.startsWith('Миништаб')) {
    room.name = `Миништаб ${owner}`;
  }
  room.wallTex = Tex.HERMO_WALL;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      const interior = dx >= 0 && dx < room.w && dy >= 0 && dy < room.h;
      if (interior) {
        if (world.roomMap[idx] === room.id) {
          setTerritoryOwnerAtIndex(world, idx, owner);
          if (world.features[idx] === Feature.NONE && ((dx * 17 + dy * 31 + owner) % 19) === 0) {
            world.features[idx] = Feature.TABLE;
          }
        }
        continue;
      }
      if (world.cells[idx] !== Cell.WALL || world.aptMask[idx]) continue;
      world.hermoWall[idx] = 1;
      world.wallTex[idx] = Tex.HERMO_WALL;
    }
  }
  for (const doorIdx of room.doors) {
    const door = world.doors.get(doorIdx);
    if (door?.state === DoorState.LOCKED && door.keyId) continue;
    setDoorState(world, door, DoorState.HERMETIC_OPEN);
    world.hermoWall[doorIdx] = 1;
    world.wallTex[doorIdx] = Tex.HERMO_WALL;
  }
}

function reinforceHqSupportRooms(world: World, hq: Room, owner: TerritoryOwner): void {
  const center = roomCenter(hq);
  const candidates = world.rooms
    .filter(room => (
      room &&
      room.id !== hq.id &&
      room.type !== RoomType.HQ &&
      room.apartmentId < 0 &&
      autoHqRoomSpanEligible(room) &&
      room.w > 2 &&
      room.h > 2 &&
      roomArea(room) <= 4096 &&
      roomHasMappedCell(world, room)
    ))
    .map(room => ({ room, d2: world.dist2(center.x, center.y, room.x + (room.w >> 1), room.y + (room.h >> 1)) }))
    .sort((a, b) => a.d2 - b.d2);
  let painted = 0;
  for (const candidate of candidates) {
    if (painted >= 4 || candidate.d2 > 96 * 96) break;
    if (
      candidate.room.type !== RoomType.KITCHEN &&
      candidate.room.type !== RoomType.BATHROOM &&
      candidate.room.type !== RoomType.STORAGE &&
      candidate.room.type !== RoomType.MEDICAL &&
      candidate.room.type !== RoomType.OFFICE &&
      candidate.room.type !== RoomType.COMMON
    ) continue;
    paintRoomOwner(world, candidate.room, owner);
    painted++;
  }
}

function reinforceAllHqAnchors(world: World): void {
  for (const anchor of territoryHqAnchors(world)) {
    const room = world.rooms[anchor.roomId];
    if (!room) continue;
    hardenHqRoom(world, room, anchor.owner);
    paintRoomOwner(world, room, anchor.owner);
    paintOwnerPatch(world, anchor.x, anchor.y, anchor.owner);
    reinforceHqSupportRooms(world, room, anchor.owner);
  }
  world.markWallTexDirty();
  world.markFeaturesDirty(false);
}

export function territoryHqAnchors(world: World): TerritoryHqAnchor[] {
  const anchors: TerritoryHqAnchor[] = [];
  const seen = new Set<TerritoryOwner>();
  const usedRooms = new Set<number>();
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    const room = chooseExistingHqAnchorRoom(world, owner, usedRooms, hqAnchorEligible);
    if (!room) continue;
    pushTerritoryHqAnchor(anchors, room, owner);
    seen.add(owner);
    usedRooms.add(room.id);
  }
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    if (seen.has(owner)) continue;
    const room = chooseExistingHqAnchorRoom(world, owner, usedRooms, authoredHqAnchorEligible);
    if (!room) continue;
    pushTerritoryHqAnchor(anchors, room, owner);
    seen.add(owner);
    usedRooms.add(room.id);
  }
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    if (seen.has(owner)) continue;
    const room = chooseAnchorRoom(world, owner, usedRooms);
    if (!room) continue;
    hardenHqRoom(world, room, owner);
    pushTerritoryHqAnchor(anchors, room, owner);
    seen.add(owner);
    usedRooms.add(room.id);
  }
  return anchors;
}

function ensureMiniHqPatches(world: World): void {
  const usedRooms = new Set<number>();
  for (const anchor of territoryHqAnchors(world)) {
    const room = world.rooms[anchor.roomId];
    if (room?.type === RoomType.HQ) usedRooms.add(anchor.roomId);
  }
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    let hasAnchor = false;
    for (const anchor of territoryHqAnchors(world)) {
      if (anchor.owner === owner && world.rooms[anchor.roomId]?.type === RoomType.HQ) {
        hasAnchor = true;
        break;
      }
    }
    if (hasAnchor) continue;
    const room = chooseAnchorRoom(world, owner, usedRooms);
    if (!room) continue;
    usedRooms.add(room.id);
    const center = roomCenter(room);
    hardenHqRoom(world, room, owner);
    paintRoomOwner(world, room, owner);
    paintOwnerPatch(world, center.x, center.y, owner);
    reinforceHqSupportRooms(world, room, owner);
  }
}

function territoryHash01(seed: number, a: number, b: number, c = 0): number {
  let h = seed ^ Math.imul(a + 0x9e37, 0x85ebca6b) ^ Math.imul(b + 0x632b, 0xc2b2ae35) ^ Math.imul(c + 0x27d4, 0x165667b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

function normalizedTargetShares(shares: readonly TerritoryTargetShare[] | undefined): TerritoryTargetShare[] {
  if (!shares || shares.length === 0) return [];
  const rows = shares
    .filter(row => TERRITORY_OWNERS.includes(row.owner) && Number.isFinite(row.share) && row.share > 0)
    .map(row => ({ owner: row.owner, share: row.share }));
  const total = rows.reduce((sum, row) => sum + row.share, 0);
  if (total <= 0) return [];
  for (const row of rows) row.share /= total;
  return rows;
}

function bucketCenter(index: number): { x: number; y: number } {
  const bx = index % TERRITORY_BUCKET_SIDE;
  const by = (index / TERRITORY_BUCKET_SIDE) | 0;
  return {
    x: bx * TERRITORY_BUCKET_SIZE + TERRITORY_BUCKET_SIZE / 2,
    y: by * TERRITORY_BUCKET_SIZE + TERRITORY_BUCKET_SIZE / 2,
  };
}

function ownerBucketScore(world: World, owner: TerritoryOwner, anchors: readonly TerritoryHqAnchor[], bucket: number, seed: number): number {
  const center = bucketCenter(bucket);
  let best = Infinity;
  for (const anchor of anchors) {
    if (anchor.owner !== owner) continue;
    const d2 = world.dist2(center.x, center.y, anchor.x + 0.5, anchor.y + 0.5);
    if (d2 < best) best = d2;
  }
  if (!Number.isFinite(best)) best = world.dist2(center.x, center.y, W / 2, W / 2);
  const bx = bucket % TERRITORY_BUCKET_SIDE;
  const by = (bucket / TERRITORY_BUCKET_SIDE) | 0;
  const noise = territoryHash01(seed, bx >> 1, by >> 1, owner * 19) * 0.22 +
    territoryHash01(seed, bx, by, owner * 29) * 0.08;
  return best * (0.88 + noise);
}

function applyTargetTerritoryShares(world: World, shares: readonly TerritoryTargetShare[], seed: number): void {
  const rows = normalizedTargetShares(shares);
  if (rows.length === 0) return;
  const bucketCount = TERRITORY_BUCKET_SIDE * TERRITORY_BUCKET_SIDE;
  const ownerBuckets = new Uint8Array(bucketCount).fill(255);
  const quota = new Map<TerritoryOwner, number>();
  const assigned = new Map<TerritoryOwner, number>();
  let remaining = bucketCount;
  for (let i = 0; i < rows.length; i++) {
    const target = i === rows.length - 1 ? remaining : Math.max(1, Math.round(rows[i].share * bucketCount));
    quota.set(rows[i].owner, target);
    assigned.set(rows[i].owner, 0);
    remaining -= target;
  }

  const hqRooms = world.rooms
    .filter(room => room?.type === RoomType.HQ)
    .map(room => ({ room, owner: territoryRoomOwner(world, room.id), center: roomCenter(room) }));
  const anchors = territoryHqAnchors(world);
  const candidates: { owner: TerritoryOwner; bucket: number; score: number }[] = [];
  for (const row of rows) {
    for (let bucket = 0; bucket < bucketCount; bucket++) {
      candidates.push({ owner: row.owner, bucket, score: ownerBucketScore(world, row.owner, anchors, bucket, seed) });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  for (const candidate of candidates) {
    if (ownerBuckets[candidate.bucket] !== 255) continue;
    const used = assigned.get(candidate.owner) ?? 0;
    const cap = quota.get(candidate.owner) ?? 0;
    if (used >= cap) continue;
    ownerBuckets[candidate.bucket] = candidate.owner;
    assigned.set(candidate.owner, used + 1);
  }
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    if (ownerBuckets[bucket] !== 255) continue;
    let bestOwner = rows[0].owner;
    let bestOverflow = Infinity;
    for (const row of rows) {
      const used = assigned.get(row.owner) ?? 0;
      const cap = Math.max(1, quota.get(row.owner) ?? 1);
      const overflow = used / cap + ownerBucketScore(world, row.owner, anchors, bucket, seed) * 1e-7;
      if (overflow < bestOverflow) {
        bestOverflow = overflow;
        bestOwner = row.owner;
      }
    }
    ownerBuckets[bucket] = bestOwner;
    assigned.set(bestOwner, (assigned.get(bestOwner) ?? 0) + 1);
  }

  for (let by = 0; by < TERRITORY_BUCKET_SIDE; by++) {
    for (let bx = 0; bx < TERRITORY_BUCKET_SIDE; bx++) {
      const owner = ownerBuckets[by * TERRITORY_BUCKET_SIDE + bx] as TerritoryOwner;
      for (let dy = 0; dy < TERRITORY_BUCKET_SIZE; dy++) {
        for (let dx = 0; dx < TERRITORY_BUCKET_SIZE; dx++) {
          const idx = world.idx(bx * TERRITORY_BUCKET_SIZE + dx, by * TERRITORY_BUCKET_SIZE + dy);
          const roomId = world.roomMap[idx];
          if (roomId > 0 && world.rooms[roomId]?.type === RoomType.HQ) continue;
          world.factionControl[idx] = owner;
        }
      }
    }
  }

  const reinforcedRooms = new Set<number>();
  for (const hq of hqRooms) {
    hardenHqRoom(world, hq.room, hq.owner);
    paintRoomOwner(world, hq.room, hq.owner);
    paintOwnerPatch(world, hq.center.x, hq.center.y, hq.owner);
    reinforceHqSupportRooms(world, hq.room, hq.owner);
    reinforcedRooms.add(hq.room.id);
  }
  for (const anchor of territoryHqAnchors(world)) {
    if (reinforcedRooms.has(anchor.roomId)) continue;
    const room = world.rooms[anchor.roomId];
    if (room) {
      hardenHqRoom(world, room, anchor.owner);
      paintRoomOwner(world, room, anchor.owner);
      reinforceHqSupportRooms(world, room, anchor.owner);
    }
    paintOwnerPatch(world, anchor.x, anchor.y, anchor.owner);
  }
  world.markWallTexDirty();
  world.markFeaturesDirty(false);
}

function nearestZoneHqRoom(world: World, zone: { cx: number; cy: number; faction: TerritoryOwner }): Room | undefined {
  let best: Room | undefined;
  let bestD2 = Infinity;
  for (const room of world.rooms) {
    if (!room || room.type !== RoomType.HQ) continue;
    if (roomOwnerHint(world, room) !== zone.faction) continue;
    const center = roomCenter(room);
    const d2 = world.dist2(zone.cx + 0.5, zone.cy + 0.5, center.x + 0.5, center.y + 0.5);
    if (d2 > bestD2 || (d2 === bestD2 && best !== undefined && room.id >= best.id)) continue;
    best = room;
    bestD2 = d2;
  }
  return best;
}

export function syncZoneMetadataFromTerritory(world: World, zoneIds?: Iterable<number>): void {
  const ids = zoneIds ? [...zoneIds] : world.zones.map(zone => zone.id);
  for (const zoneId of ids) {
    const zone = world.zones[zoneId];
    if (!zone) continue;
    zoneCountsScratch.fill(0);
    for (let dy = -ZONE_SAMPLE_RADIUS; dy <= ZONE_SAMPLE_RADIUS; dy += ZONE_SAMPLE_STEP) {
      for (let dx = -ZONE_SAMPLE_RADIUS; dx <= ZONE_SAMPLE_RADIUS; dx += ZONE_SAMPLE_STEP) {
        const idx = world.idx(zone.cx + dx, zone.cy + dy);
        if (world.zoneMap[idx] !== zoneId) continue;
        zoneCountsScratch[territoryOwnerAtIndex(world, idx)]++;
      }
    }
    zone.territoryCounts = new Uint16Array(zoneCountsScratch);
    zone.faction = dominantOwnerFromCounts(zoneCountsScratch, zone.faction);
    const hq = nearestZoneHqRoom(world, zone);
    zone.hqRoomId = hq?.id ?? zone.hqRoomId;
  }
}

export function initializeCellTerritory(world: World, options: TerritoryInitializationOptions = {}): void {
  if (currentFieldHasAuthoredTerritory(world)) sanitizeCurrentTerritory(world);
  else seedTerritoryFromZoneMetadata(world);
  ensureMiniHqPatches(world);
  reinforceAllHqAnchors(world);
  applyTargetTerritoryShares(world, options.targetShares ?? [], options.seed ?? 0);
  ensureMiniHqPatches(world);
  reinforceAllHqAnchors(world);
  syncZoneMetadataFromTerritory(world);
}

function actorCapturePressure(actor: Entity, owner: TerritoryOwner): boolean {
  if (occupationHasProfileTag(actor.occupation, 'combat') || actor.ai?.goal === AIGoal.HUNT) return true;
  let same = 0;
  let enemy = 0;
  getEntityIndex().queryRadiusCapped(actor.x, actor.y, CAPTURE_ACTOR_SCAN_RADIUS, captureQuery, ENTITY_MASK_NPC, CAPTURE_ACTOR_SCAN_CAP);
  for (const other of captureQuery) {
    if (!other.alive || other.type !== EntityType.NPC || other.faction === undefined) continue;
    const otherOwner = factionToTerritoryOwner(other.faction);
    if (otherOwner === owner) same++;
    else enemy++;
  }
  captureQuery.length = 0;
  return same >= 2 && same > enemy;
}

function capturePatch(world: World, x: number, y: number, owner: TerritoryOwner, cellBudget: number, affectedZones: Set<number>): number {
  let changed = 0;
  for (let dy = -CAPTURE_RADIUS; dy <= CAPTURE_RADIUS; dy++) {
    for (let dx = -CAPTURE_RADIUS; dx <= CAPTURE_RADIUS; dx++) {
      if (changed >= cellBudget) return changed;
      if (dx * dx + dy * dy > CAPTURE_RADIUS * CAPTURE_RADIUS) continue;
      const idx = world.idx(x + dx, y + dy);
      if (!walkableForCapture(world.cells[idx])) continue;
      const prev = territoryOwnerAtIndex(world, idx);
      if (prev === owner || prev === ZoneFaction.SAMOSBOR) continue;
      world.factionControl[idx] = owner;
      affectedZones.add(world.zoneMap[idx]);
      changed++;
    }
  }
  return changed;
}

export function updateTerritoryCapture(world: World, entities: Entity[], state: GameState | undefined, dt: number): number {
  captureAccum += dt;
  if (captureAccum < CAPTURE_INTERVAL_SEC) return 0;
  captureAccum -= CAPTURE_INTERVAL_SEC;

  const affectedZones = new Set<number>();
  let changedCells = 0;
  let published = 0;
  ensureEntityIndex(entities);
  for (const actor of getEntityIndex().actors) {
    if (changedCells >= CAPTURE_GLOBAL_CELL_CAP) break;
    if (!actor.alive || actor.type !== EntityType.NPC || actor.faction === undefined) continue;
    if (!actor.isTraveler && !occupationHasProfileTag(actor.occupation, 'combat') && actor.ai?.goal !== AIGoal.HUNT) continue;
    const owner = factionToTerritoryOwner(actor.faction);
    const x = Math.floor(actor.x);
    const y = Math.floor(actor.y);
    const idx = world.idx(x, y);
    const current = territoryOwnerAtIndex(world, idx);
    if (current === owner || current === ZoneFaction.SAMOSBOR) continue;
    if (!actorCapturePressure(actor, owner)) continue;
    const budget = Math.min(48, CAPTURE_GLOBAL_CELL_CAP - changedCells);
    const changed = capturePatch(world, x, y, owner, budget, affectedZones);
    if (changed <= 0) continue;
    changedCells += changed;
    if (state && published < CAPTURE_EVENT_LIMIT) {
      published++;
      publishEvent(state, {
        type: 'faction_event',
        zoneId: currentTerritoryZoneId(world, x, y),
        x: actor.x,
        y: actor.y,
        actorId: actor.id,
        actorName: actor.name,
        actorFaction: actor.faction,
        targetFaction: territoryOwnerToFaction(current) ?? undefined,
        severity: changed >= 24 ? 4 : 3,
        privacy: 'local',
        tags: ['faction_event', 'territory_capture', 'cell_territory'],
        data: {
          phase: 'territory_capture',
          name: 'Захват клеток',
          text: 'Фракция продавила локальный участок территории.',
          previousOwner: current,
          owner,
          cells: changed,
        },
      });
    }
  }
  if (affectedZones.size > 0) syncZoneMetadataFromTerritory(world, affectedZones);
  return changedCells;
}
