/* ── Runtime floor memory for visited route stops ─────────────── */

import { safeParseJson } from '../core/json';
import {
  Cell,
  ContainerKind,
  DoorState,
  EntityType,
  Feature,
  Faction,
  FloorLevel,
  LiftDirection,
  RoomType,
  Tex,
  W,
  ZoneFaction,
  type Door,
  type Entity,
  type Item,
  type Room,
  type WorldContainer,
  type Zone,
} from '../core/types';
import { World } from '../core/world';
import { type FloorGeneration } from '../gen/floor_manifest';
import { rebuildGeneratedFloorPathBlockers, rebuildPathBlockersFromWorldObjects } from '../gen/path_blockers';
import { cleanFloorKey, floorKeyForStory, floorKeyKnown, type FloorKeyResolveContext } from './floor_keys';
import { isNativePlayerBodyEntity } from './player_actor';

export interface FloorMemoryEntry {
  key: string;
  world: World;
  entities: Entity[];
  spawnX: number;
  spawnY: number;
  capturedAt: number;
  samosborCount: number;
  estimatedBytes: number;
  generationExtras?: FloorMemoryGenerationExtras;
}

export interface FloorMemoryLoad {
  generation: FloorGeneration;
  fromMemory: boolean;
}

export interface FloorLiftAnchor {
  liftIdx: number;
  liftX: number;
  liftY: number;
}

export interface FloorRouteLiftMirror {
  direction: LiftDirection;
  anchors: readonly FloorLiftAnchor[];
}

export interface FloorRouteLiftLayoutResult {
  down: number;
  up: number;
  placed: number;
  demoted: number;
  mirrored: number;
}

export type FloorMemoryGenerationExtras = Record<string, unknown>;

type RleArrayType = 'u8' | 'i16';
type WorldArrayField =
  | 'cells'
  | 'roomMap'
  | 'wallTex'
  | 'floorTex'
  | 'features'
  | 'aptMask'
  | 'hermoWall'
  | 'zoneMap'
  | 'factionControl'
  | 'fog'
  | 'liftDir'
  | 'surfaceFlags';

interface RleArraySave {
  field: WorldArrayField;
  type: RleArrayType;
  length: number;
  data: string;
}

interface FloorMemoryWorldSave {
  arrays: RleArraySave[];
  rooms: unknown[];
  apartmentRoomCount: number;
  zones: unknown[];
  doors: Array<[number, unknown]>;
  containers: unknown[];
  surfaceMap: Array<[number, string]>;
  anomalyTeleports: Array<[number, number]>;
  anomalySmogSource: number;
  anomalySmogCells: number[];
  anomalySmogHandled: boolean;
  railTracks: unknown[];
  railTrains: unknown[];
  railTrainCells: Array<[number, number]>;
  slideCells: number[];
  screenCells: number[];
}

export interface FloorMemorySaveEntry {
  key: string;
  spawnX: number;
  spawnY: number;
  capturedAt: number;
  samosborCount: number;
  world: FloorMemoryWorldSave;
  entities: Entity[];
  estimatedBytes: number;
}

export interface FloorMemorySaveState {
  version: 1;
  entries: FloorMemorySaveEntry[];
  bytes: number;
  byteBudget: number;
}

export interface FloorMemoryRestoreResult {
  restored: number;
  skipped: number;
  keys: string[];
}

type FloorMemoryGenerationExtrasResolver = (key: string) => FloorMemoryGenerationExtras | undefined;

export interface FloorMemoryRestoreOptions {
  generationExtrasForKey?: FloorMemoryGenerationExtrasResolver;
  floorKeyContext?: FloorKeyResolveContext;
  isKnownFloorKey?: (key: string) => boolean;
}

const MAX_FLOOR_MEMORY_ENTRIES = 128;
const MAX_FLOOR_MEMORY_SAVE_ENTRIES = 24;
const MAX_FLOOR_MEMORY_RESTORE_SCAN_ENTRIES = MAX_FLOOR_MEMORY_SAVE_ENTRIES * 4;
const BYTES_PER_MIB = 1024 * 1024;
const FLOOR_MEMORY_DEFAULT_BUDGET_BYTES = 1024 * BYTES_PER_MIB;
const FLOOR_MEMORY_MIN_BUDGET_BYTES = 384 * BYTES_PER_MIB;
const FLOOR_MEMORY_MAX_BUDGET_BYTES = 3072 * BYTES_PER_MIB;
const FLOOR_MEMORY_SAVE_BUDGET_BYTES = 1536 * 1024;
const FLOOR_MEMORY_DEVICE_MEMORY_FRACTION = 0.5;
const FLOOR_MEMORY_ENTRY_OVERHEAD_BYTES = 64 * 1024;
const DEFAULT_ROUTE_LIFTS_PER_DIRECTION = 16;

const CARDINALS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const ROUTE_LIFT_CONNECTOR_MAX = W;
const ROUTE_LIFT_MIN_SPACING = 8;
const ROUTE_LIFT_MAX_SPACING = 96;
const ROUTE_LIFT_SPACING_FACTOR = 0.5;
const ROUTE_LIFT_CANDIDATE_SAMPLE_CAP = 16_384;
const WORLD_ARRAY_FIELDS: readonly { field: WorldArrayField; type: RleArrayType }[] = [
  { field: 'cells', type: 'u8' },
  { field: 'roomMap', type: 'i16' },
  { field: 'wallTex', type: 'u8' },
  { field: 'floorTex', type: 'u8' },
  { field: 'features', type: 'u8' },
  { field: 'aptMask', type: 'u8' },
  { field: 'hermoWall', type: 'u8' },
  { field: 'zoneMap', type: 'u8' },
  { field: 'factionControl', type: 'u8' },
  { field: 'fog', type: 'u8' },
  { field: 'liftDir', type: 'u8' },
  { field: 'surfaceFlags', type: 'u8' },
];

const floorMemory = new Map<string, FloorMemoryEntry>();
const packedFloorMemory = new Map<string, {
  save: FloorMemorySaveEntry;
  estimatedBytes: number;
  generationExtras?: FloorMemoryGenerationExtras;
  generationExtrasForKey?: FloorMemoryGenerationExtrasResolver;
}>();
let floorMemoryBytes = 0;
let packedFloorMemoryBytes = 0;
let floorMemoryBudgetOverride: number | undefined;
let floorMemorySaveBudgetOverride: number | undefined;

export function floorMemoryKeyForStoryFloor(floor: FloorLevel): string {
  return floorKeyForStory(floor);
}

function storableEntity(entity: Entity): boolean {
  return !isNativePlayerBodyEntity(entity) && entity.type !== EntityType.PROJECTILE;
}

function clampBytes(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function defaultFloorMemoryByteBudget(): number {
  const nav = typeof navigator !== 'undefined'
    ? navigator as Navigator & { deviceMemory?: number }
    : undefined;
  const deviceMemoryGb = typeof nav?.deviceMemory === 'number' && Number.isFinite(nav.deviceMemory)
    ? nav.deviceMemory
    : undefined;
  if (deviceMemoryGb !== undefined && deviceMemoryGb > 0) {
    return clampBytes(
      deviceMemoryGb * 1024 * BYTES_PER_MIB * FLOOR_MEMORY_DEVICE_MEMORY_FRACTION,
      FLOOR_MEMORY_MIN_BUDGET_BYTES,
      FLOOR_MEMORY_MAX_BUDGET_BYTES,
    );
  }
  const perf = typeof performance !== 'undefined'
    ? performance as Performance & { memory?: { jsHeapSizeLimit?: number } }
    : undefined;
  const heapLimit = perf?.memory?.jsHeapSizeLimit;
  if (typeof heapLimit === 'number' && Number.isFinite(heapLimit) && heapLimit > 0) {
    return clampBytes(heapLimit * 0.35, FLOOR_MEMORY_MIN_BUDGET_BYTES, FLOOR_MEMORY_MAX_BUDGET_BYTES);
  }
  return FLOOR_MEMORY_DEFAULT_BUDGET_BYTES;
}

function floorMemoryByteBudget(): number {
  return floorMemoryBudgetOverride ?? defaultFloorMemoryByteBudget();
}

function floorMemorySaveByteBudget(): number {
  return floorMemorySaveBudgetOverride ?? FLOOR_MEMORY_SAVE_BUDGET_BYTES;
}

function estimateJsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0;
  }
}

function estimateWorldBytes(world: World): number {
  let bytes =
    world.cells.byteLength +
    world.roomMap.byteLength +
    world.wallTex.byteLength +
    world.floorTex.byteLength +
    world.features.byteLength +
    world.light.byteLength +
    world.visualSlots.byteLength +
    world.pathBlockers.byteLength +
    world.aptMask.byteLength +
    world.hermoWall.byteLength +
    world.zoneMap.byteLength +
    world.factionControl.byteLength +
    world.fog.byteLength +
    world.liftDir.byteLength +
    world.surfaceFlags.byteLength;
  for (const surface of world.surfaceMap.values()) bytes += surface.byteLength + 16;
  bytes += world.rooms.length * 192;
  bytes += world.zones.length * 96;
  bytes += world.doors.size * 80;
  bytes += world.containers.length * 256;
  bytes += world.anomalyTeleports.size * 16;
  bytes += world.anomalySmogCells.length * 4;
  bytes += world.slideCells.length * 4;
  bytes += world.screenCells.length * 4;
  bytes += world.railTracks.length * 256;
  bytes += world.railTrains.length * 256;
  bytes += world.railTrainCells.size * 16;
  return bytes + FLOOR_MEMORY_ENTRY_OVERHEAD_BYTES;
}

function estimateFloorMemoryEntryBytes(world: World, entities: readonly Entity[]): number {
  return estimateWorldBytes(world) + entities.length * 384 + estimateJsonBytes(entities);
}

function cloneJson<T>(value: T): T {
  return safeParseJson(JSON.stringify(value)) as T;
}

function bytesToBase64(bytes: Uint8Array): string {
  const maybeBuffer = (globalThis as { Buffer?: { from(input: Uint8Array): { toString(encoding: 'base64'): string } } }).Buffer;
  if (maybeBuffer) return maybeBuffer.from(bytes).toString('base64');
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(data: string): Uint8Array {
  const maybeBuffer = (globalThis as { Buffer?: { from(input: string, encoding: 'base64'): Uint8Array } }).Buffer;
  if (maybeBuffer) return new Uint8Array(maybeBuffer.from(data, 'base64'));
  const binary = atob(data);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function tryBase64ToBytes(data: unknown): Uint8Array | null {
  if (typeof data !== 'string') return null;
  try {
    return base64ToBytes(data);
  } catch {
    return null;
  }
}

function pushVarUint(out: number[], value: number): void {
  let n = Math.max(0, Math.floor(value)) >>> 0;
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
}

function readVarUint(bytes: Uint8Array, offset: { v: number }): number {
  let shift = 0;
  let value = 0;
  while (offset.v < bytes.length && shift <= 28) {
    const b = bytes[offset.v++];
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return value >>> 0;
    shift += 7;
  }
  return 0;
}

function worldArray(world: World, field: WorldArrayField): Uint8Array | Int16Array {
  return world[field];
}

function pushRleValue(out: number[], type: RleArrayType, value: number): void {
  if (type === 'u8') {
    out.push(value & 0xff);
  } else {
    out.push(value & 0xff, (value >> 8) & 0xff);
  }
}

function readRleValue(bytes: Uint8Array, offset: { v: number }, type: RleArrayType): number | null {
  if (type === 'u8') {
    if (offset.v >= bytes.length) return null;
    return bytes[offset.v++];
  }
  if (offset.v + 1 >= bytes.length) return null;
  const lo = bytes[offset.v++] ?? 0;
  const hi = bytes[offset.v++] ?? 0;
  const value = lo | (hi << 8);
  return value & 0x8000 ? value - 0x10000 : value;
}

function encodeRleArray(array: Uint8Array | Int16Array, field: WorldArrayField, type: RleArrayType): RleArraySave {
  const out: number[] = [];
  let i = 0;
  while (i < array.length) {
    const value = array[i];
    let len = 1;
    while (i + len < array.length && array[i + len] === value) len++;
    pushVarUint(out, len);
    pushRleValue(out, type, value);
    i += len;
  }
  return {
    field,
    type,
    length: array.length,
    data: bytesToBase64(new Uint8Array(out)),
  };
}

function applyRleArray(world: World, saved: RleArraySave): boolean {
  if (!saved || !WORLD_ARRAY_FIELDS.some(def => def.field === saved.field && def.type === saved.type)) return false;
  const target = worldArray(world, saved.field);
  if (saved.length !== target.length || typeof saved.data !== 'string') return false;
  const bytes = tryBase64ToBytes(saved.data);
  if (!bytes) return false;
  const offset = { v: 0 };
  let i = 0;
  while (i < target.length && offset.v < bytes.length) {
    const len = readVarUint(bytes, offset);
    const value = readRleValue(bytes, offset, saved.type);
    if (value === null) return false;
    if (len <= 0 || i + len > target.length) return false;
    target.fill(value, i, i + len);
    i += len;
  }
  return i === target.length;
}

function surfaceMapForSave(world: World): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  for (const [idx, pixels] of world.surfaceMap) out.push([idx, bytesToBase64(pixels)]);
  return out;
}

function restoreSurfaceMap(input: unknown): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  if (!Array.isArray(input)) return out;
  for (const entry of input) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const idx = Math.floor(Number(entry[0]));
    if (!Number.isFinite(idx) || idx < 0 || idx >= W * W || typeof entry[1] !== 'string') continue;
    const pixels = tryBase64ToBytes(entry[1]);
    if (!pixels) continue;
    if (pixels.length !== 16 * 16 * 4) continue;
    out.set(idx, pixels);
  }
  return out;
}

function numberListForSave(input: readonly number[]): number[] {
  return input
    .filter(value => Number.isFinite(value))
    .map(value => Math.floor(value));
}

function numberEntryListForSave(input: Iterable<readonly [number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [a, b] of input) {
    if (Number.isFinite(a) && Number.isFinite(b)) out.push([Math.floor(a), Math.floor(b)]);
  }
  return out;
}

function worldForSave(world: World): FloorMemoryWorldSave {
  return {
    arrays: WORLD_ARRAY_FIELDS.map(def => encodeRleArray(worldArray(world, def.field), def.field, def.type)),
    rooms: cloneJson(world.rooms),
    apartmentRoomCount: finiteIntRange(world.apartmentRoomCount, 0, world.rooms.length, 0),
    zones: cloneJson(world.zones),
    doors: [...world.doors.entries()].map(([idx, door]) => [idx, cloneJson(door)]),
    containers: cloneJson(world.containers),
    surfaceMap: surfaceMapForSave(world),
    anomalyTeleports: numberEntryListForSave(world.anomalyTeleports.entries()),
    anomalySmogSource: Number.isFinite(world.anomalySmogSource) ? Math.floor(world.anomalySmogSource) : -1,
    anomalySmogCells: numberListForSave(world.anomalySmogCells),
    anomalySmogHandled: world.anomalySmogHandled === true,
    railTracks: cloneJson(world.railTracks),
    railTrains: cloneJson(world.railTrains),
    railTrainCells: numberEntryListForSave(world.railTrainCells.entries()),
    slideCells: numberListForSave(world.slideCells),
    screenCells: numberListForSave(world.screenCells),
  };
}

function restoreNumberEntries(input: unknown): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (!Array.isArray(input)) return out;
  for (const entry of input) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const a = Math.floor(Number(entry[0]));
    const b = Math.floor(Number(entry[1]));
    if (Number.isFinite(a) && Number.isFinite(b)) out.push([a, b]);
  }
  return out;
}

function restoreNumberList(input: unknown, min = 0, max = W * W - 1): number[] {
  const out: number[] = [];
  if (!Array.isArray(input)) return out;
  for (const value of input) {
    const n = Math.floor(Number(value));
    if (Number.isFinite(n) && n >= min && n <= max) out.push(n);
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneJsonOr<T>(value: unknown, fallback: T): T {
  try {
    return cloneJson(value) as T;
  } catch {
    return fallback;
  }
}

function finiteInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.floor(value)
    : fallback;
}

function finiteIntRange(value: unknown, min: number, max: number, fallback: number): number {
  const n = finiteInt(value, fallback);
  return n >= min && n <= max ? n : fallback;
}

function enumNumberValues(source: Record<string, string | number>): number[] {
  return Object.values(source).filter((value): value is number => typeof value === 'number');
}

function enumValue(
  value: unknown,
  source: Record<string, string | number>,
  fallback: number,
): number {
  const n = finiteInt(value, fallback);
  return enumNumberValues(source).includes(n) ? n : fallback;
}

function stringValue(value: unknown, fallback = '', maxLength = 160): string {
  if (typeof value !== 'string') return fallback;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function stringListValue(input: unknown, maxEntries: number, maxLength = 96): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const value of input) {
    if (typeof value !== 'string') continue;
    out.push(value.length > maxLength ? value.slice(0, maxLength) : value);
    if (out.length >= maxEntries) break;
  }
  return out;
}

function jsonCloneableValue<T>(value: unknown, fallback: T): T {
  try {
    return cloneJson(value) as T;
  } catch {
    return fallback;
  }
}

function sanitizeItems(input: unknown, maxEntries: number): Item[] {
  if (!Array.isArray(input)) return [];
  const out: Item[] = [];
  for (const raw of input) {
    if (!isRecord(raw)) continue;
    const defId = stringValue(raw.defId, '', 96);
    if (!defId) continue;
    const count = finiteIntRange(raw.count, 1, 999, 1);
    const item: Item = { defId, count };
    if ('data' in raw) item.data = jsonCloneableValue(raw.data, undefined);
    out.push(item);
    if (out.length >= maxEntries) break;
  }
  return out;
}

function sanitizeRooms(input: unknown): Room[] {
  if (!Array.isArray(input)) return [];
  const out: Room[] = [];
  for (const raw of input) {
    if (!isRecord(raw)) continue;
    const id = finiteInt(raw.id, -1);
    if (id !== out.length) continue;
    const w = finiteIntRange(raw.w, 1, W, 1);
    const h = finiteIntRange(raw.h, 1, W, 1);
    out.push({
      id,
      type: enumValue(raw.type, RoomType, RoomType.COMMON) as RoomType,
      x: finiteIntRange(raw.x, 0, W - 1, 0),
      y: finiteIntRange(raw.y, 0, W - 1, 0),
      w,
      h,
      doors: restoreNumberList(raw.doors),
      sealed: raw.sealed === true,
      name: stringValue(raw.name, '', 120),
      apartmentId: finiteIntRange(raw.apartmentId, -1, 32767, -1),
      wallTex: finiteIntRange(raw.wallTex, 0, Tex.COUNT - 1, Tex.CONCRETE) as Tex,
      floorTex: finiteIntRange(raw.floorTex, 0, Tex.COUNT - 1, Tex.F_CONCRETE) as Tex,
    });
    if (out.length >= 32767) break;
  }
  return out;
}

function sanitizeZones(input: unknown): Zone[] {
  if (!Array.isArray(input)) return [];
  const out: Zone[] = [];
  for (const raw of input) {
    if (!isRecord(raw)) continue;
    const id = finiteInt(raw.id, -1);
    if (id !== out.length || id > 255) continue;
    out.push({
      id,
      cx: finiteIntRange(raw.cx, 0, W - 1, 0),
      cy: finiteIntRange(raw.cy, 0, W - 1, 0),
      faction: enumValue(raw.faction, ZoneFaction, ZoneFaction.WILD) as ZoneFaction,
      hasLift: raw.hasLift === true,
      fogged: raw.fogged === true,
      level: finiteIntRange(raw.level, 0, 100, 0),
      hqRoomId: finiteIntRange(raw.hqRoomId, -1, 32767, -1),
    });
  }
  return out;
}

function sanitizeDoorEntries(input: unknown, rooms: readonly Room[], world?: World): Array<[number, Door]> {
  const out: Array<[number, Door]> = [];
  if (!Array.isArray(input)) return out;
  const seen = new Set<number>();
  for (const entry of input) {
    if (!Array.isArray(entry) || entry.length !== 2 || !isRecord(entry[1])) continue;
    const idx = finiteIntRange(entry[0], 0, W * W - 1, -1);
    if (idx < 0 || seen.has(idx)) continue;
    if (world && world.cells[idx] !== Cell.DOOR) continue;
    const raw = entry[1];
    const roomA = finiteIntRange(raw.roomA, -1, rooms.length - 1, -1);
    const roomB = finiteIntRange(raw.roomB, -1, rooms.length - 1, -1);
    out.push([idx, {
      idx,
      state: enumValue(raw.state, DoorState, DoorState.CLOSED) as DoorState,
      roomA,
      roomB,
      keyId: stringValue(raw.keyId, '', 96),
      timer: typeof raw.timer === 'number' && Number.isFinite(raw.timer)
        ? Math.max(0, Math.min(3600, raw.timer))
        : 0,
      hp: typeof raw.hp === 'number' && Number.isFinite(raw.hp) ? raw.hp : undefined,
      maxHp: typeof raw.maxHp === 'number' && Number.isFinite(raw.maxHp) ? raw.maxHp : undefined,
    }]);
    seen.add(idx);
  }
  return out;
}

const CONTAINER_ACCESS_VALUES = new Set(['public', 'room', 'faction', 'owner', 'locked', 'secret']);

function sanitizeContainers(
  input: unknown,
  rooms: readonly Room[],
  zones: readonly Zone[],
): WorldContainer[] {
  if (!Array.isArray(input)) return [];
  const out: WorldContainer[] = [];
  const seen = new Set<number>();
  for (const raw of input) {
    if (!isRecord(raw)) continue;
    const id = finiteInt(raw.id, -1);
    const x = finiteInt(raw.x, -1);
    const y = finiteInt(raw.y, -1);
    if (id < 0 || seen.has(id) || x < 0 || x >= W || y < 0 || y >= W) continue;
    const capacitySlots = finiteIntRange(raw.capacitySlots, 1, 128, 8);
    const access = typeof raw.access === 'string' && CONTAINER_ACCESS_VALUES.has(raw.access)
      ? raw.access as WorldContainer['access']
      : 'public';
    const container: WorldContainer = {
      id,
      x,
      y,
      floor: enumValue(raw.floor, FloorLevel, FloorLevel.LIVING) as FloorLevel,
      roomId: finiteIntRange(raw.roomId, -1, rooms.length - 1, -1),
      zoneId: finiteIntRange(raw.zoneId, 0, Math.max(0, zones.length - 1), 0),
      kind: enumValue(raw.kind, ContainerKind, ContainerKind.METAL_CABINET) as ContainerKind,
      name: stringValue(raw.name, 'контейнер', 120),
      inventory: sanitizeItems(raw.inventory, capacitySlots),
      capacitySlots,
      access,
      discovered: raw.discovered === true,
      tags: stringListValue(raw.tags, 16, 64),
    };
    if (typeof raw.ownerNpcId === 'number' && Number.isFinite(raw.ownerNpcId)) container.ownerNpcId = Math.floor(raw.ownerNpcId);
    if (typeof raw.ownerName === 'string') container.ownerName = stringValue(raw.ownerName, '', 120);
    if (typeof raw.faction === 'number') container.faction = enumValue(raw.faction, Faction, Faction.CITIZEN) as Faction;
    if (typeof raw.lockDifficulty === 'number' && Number.isFinite(raw.lockDifficulty)) {
      container.lockDifficulty = Math.max(0, Math.min(100, Math.floor(raw.lockDifficulty)));
    }
    container.stolenItemIds = stringListValue(raw.stolenItemIds, 64, 96);
    if (typeof raw.lastOpenedBy === 'number' && Number.isFinite(raw.lastOpenedBy)) container.lastOpenedBy = Math.floor(raw.lastOpenedBy);
    if (typeof raw.lastOpenedAt === 'number' && Number.isFinite(raw.lastOpenedAt)) container.lastOpenedAt = raw.lastOpenedAt;
    if (typeof raw.lastAuditAt === 'number' && Number.isFinite(raw.lastAuditAt)) container.lastAuditAt = raw.lastAuditAt;
    if (typeof raw.factoryId === 'string') container.factoryId = stringValue(raw.factoryId, '', 96);
    if (typeof raw.lastProducedAt === 'number' && Number.isFinite(raw.lastProducedAt)) container.lastProducedAt = raw.lastProducedAt;
    if (typeof raw.lastProducedItemId === 'string') container.lastProducedItemId = stringValue(raw.lastProducedItemId, '', 96);
    if (typeof raw.lastProducedCount === 'number' && Number.isFinite(raw.lastProducedCount)) {
      container.lastProducedCount = Math.max(0, Math.min(999, Math.floor(raw.lastProducedCount)));
    }
    if (
      raw.productionBlockedReason === 'no_inputs' ||
      raw.productionBlockedReason === 'container_full' ||
      raw.productionBlockedReason === 'no_container'
    ) {
      container.productionBlockedReason = raw.productionBlockedReason;
    }
    out.push(container);
    seen.add(id);
  }
  return out;
}

function reconcileRoomDoors(world: World): void {
  const validDoorIdx = new Set(world.doors.keys());
  for (const room of world.rooms) {
    room.doors = room.doors.filter(idx => validDoorIdx.has(idx));
  }
  for (const [idx, door] of world.doors) {
    const roomA = door.roomA >= 0 ? world.rooms[door.roomA] : undefined;
    const roomB = door.roomB >= 0 ? world.rooms[door.roomB] : undefined;
    if (roomA && !roomA.doors.includes(idx)) roomA.doors.push(idx);
    if (roomB && !roomB.doors.includes(idx)) roomB.doors.push(idx);
  }
}

function recomputeWorldZoneLiftFlags(world: World): void {
  for (const zone of world.zones) zone.hasLift = false;
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT) continue;
    const zone = world.zones[world.zoneMap[i]];
    if (zone) zone.hasLift = true;
  }
}

function validateRleArray(saved: RleArraySave): boolean {
  if (!saved || !WORLD_ARRAY_FIELDS.some(def => def.field === saved.field && def.type === saved.type)) return false;
  if (saved.length !== W * W || typeof saved.data !== 'string') return false;
  const bytes = tryBase64ToBytes(saved.data);
  if (!bytes) return false;
  const offset = { v: 0 };
  let i = 0;
  while (i < saved.length && offset.v < bytes.length) {
    const len = readVarUint(bytes, offset);
    const value = readRleValue(bytes, offset, saved.type);
    if (value === null) return false;
    if (len <= 0 || i + len > saved.length) return false;
    i += len;
  }
  return i === saved.length && offset.v === bytes.length;
}

function sanitizedRleArray(input: unknown, field: WorldArrayField, type: RleArrayType): RleArraySave | null {
  if (!isRecord(input) || input.field !== field || input.type !== type) return null;
  const saved: RleArraySave = {
    field,
    type,
    length: finiteInt(input.length, -1),
    data: stringValue(input.data, '', Number.MAX_SAFE_INTEGER),
  };
  return validateRleArray(saved) ? saved : null;
}

function sanitizedWorldSave(input: unknown): FloorMemoryWorldSave | null {
  if (!isRecord(input) || !Array.isArray(input.arrays)) return null;
  const arrays: RleArraySave[] = [];
  for (const def of WORLD_ARRAY_FIELDS) {
    const raw = input.arrays.find(candidate => isRecord(candidate) && candidate.field === def.field && candidate.type === def.type);
    const saved = sanitizedRleArray(raw, def.field, def.type);
    if (!saved) return null;
    arrays.push(saved);
  }
  const rooms = sanitizeRooms(input.rooms);
  const apartmentRoomCount = finiteIntRange(input.apartmentRoomCount, 0, rooms.length, -1);
  if (apartmentRoomCount < 0) return null;
  const zones = sanitizeZones(input.zones);
  const surfaceMap: Array<[number, string]> = [];
  for (const [idx, pixels] of restoreSurfaceMap(input.surfaceMap)) surfaceMap.push([idx, bytesToBase64(pixels)]);
  return {
    arrays,
    rooms,
    apartmentRoomCount,
    zones,
    doors: sanitizeDoorEntries(input.doors, rooms),
    containers: sanitizeContainers(input.containers, rooms, zones),
    surfaceMap,
    anomalyTeleports: restoreNumberEntries(input.anomalyTeleports)
      .filter(([a, b]) => a >= 0 && a < W * W && b >= 0 && b < W * W),
    anomalySmogSource: finiteIntRange(input.anomalySmogSource, -1, W * W - 1, -1),
    anomalySmogCells: restoreNumberList(input.anomalySmogCells),
    anomalySmogHandled: input.anomalySmogHandled === true,
    railTracks: Array.isArray(input.railTracks) ? cloneJsonOr<World['railTracks']>(input.railTracks, []) : [],
    railTrains: Array.isArray(input.railTrains) ? cloneJsonOr<World['railTrains']>(input.railTrains, []) : [],
    railTrainCells: restoreNumberEntries(input.railTrainCells)
      .filter(([cell, train]) => cell >= 0 && cell < W * W && train >= 0),
    slideCells: restoreNumberList(input.slideCells),
    screenCells: restoreNumberList(input.screenCells),
  };
}

function worldFromSave(input: unknown, spawnX?: number, spawnY?: number): World | null {
  const savedWorld = sanitizedWorldSave(input);
  if (!savedWorld) return null;
  const world = new World();
  for (const def of WORLD_ARRAY_FIELDS) {
    const saved = savedWorld.arrays.find(candidate => candidate.field === def.field && candidate.type === def.type);
    if (!saved) return null;
    if (!applyRleArray(world, saved)) return null;
  }
  world.rooms = sanitizeRooms(savedWorld.rooms);
  world.apartmentRoomCount = savedWorld.apartmentRoomCount;
  world.zones = sanitizeZones(savedWorld.zones);
  world.doors = new Map(sanitizeDoorEntries(savedWorld.doors, world.rooms, world));
  reconcileRoomDoors(world);
  recomputeWorldZoneLiftFlags(world);
  world.containers = sanitizeContainers(savedWorld.containers, world.rooms, world.zones);
  world.rebuildContainerMap();
  if (Number.isFinite(spawnX) && Number.isFinite(spawnY)) {
    rebuildGeneratedFloorPathBlockers(world, 0, spawnX as number, spawnY as number);
  } else {
    rebuildPathBlockersFromWorldObjects(world);
  }
  world.surfaceMap = restoreSurfaceMap(savedWorld.surfaceMap);
  world.anomalyTeleports = new Map(savedWorld.anomalyTeleports);
  world.anomalySmogSource = savedWorld.anomalySmogSource;
  world.anomalySmogCells = savedWorld.anomalySmogCells;
  world.anomalySmogHandled = savedWorld.anomalySmogHandled;
  world.railTracks = cloneJsonOr<World['railTracks']>(savedWorld.railTracks, []);
  world.railTrains = cloneJsonOr<World['railTrains']>(savedWorld.railTrains, []);
  world.railTrainCells = new Map(savedWorld.railTrainCells);
  world.slideCells = savedWorld.slideCells;
  world.screenCells = savedWorld.screenCells;
  world.markCellsDirty();
  world.markSurfaceDirty();
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFeaturesDirty(true);
  world.markFogDirty();
  return world;
}

function removePackedFloorMemoryEntry(key: string): boolean {
  const existing = packedFloorMemory.get(key);
  if (!existing) return false;
  packedFloorMemory.delete(key);
  packedFloorMemoryBytes = Math.max(0, packedFloorMemoryBytes - existing.estimatedBytes);
  return true;
}

function resolvePackedGenerationExtras(
  key: string,
  packed: { generationExtras?: FloorMemoryGenerationExtras; generationExtrasForKey?: FloorMemoryGenerationExtrasResolver },
): FloorMemoryGenerationExtras | undefined {
  if (packed.generationExtras) return packed.generationExtras;
  if (!packed.generationExtrasForKey) return undefined;
  try {
    return packed.generationExtrasForKey(key);
  } catch {
    return undefined;
  }
}

function archiveFloorMemoryEntry(entry: FloorMemoryEntry): void {
  removePackedFloorMemoryEntry(entry.key);
  const save = entryForSave(entry);
  const estimatedBytes = estimateJsonBytes(save);
  packedFloorMemory.set(entry.key, {
    save,
    estimatedBytes,
    generationExtras: entry.generationExtras,
  });
  packedFloorMemoryBytes += estimatedBytes;
}

function removeFloorMemoryEntry(key: string, archive = false): boolean {
  const existing = floorMemory.get(key);
  if (!existing) return false;
  if (archive) archiveFloorMemoryEntry(existing);
  floorMemory.delete(key);
  floorMemoryBytes = Math.max(0, floorMemoryBytes - existing.estimatedBytes);
  return true;
}

function trimFloorMemory(): void {
  const budget = floorMemoryByteBudget();
  while (floorMemory.size > MAX_FLOOR_MEMORY_ENTRIES || (floorMemoryBytes > budget && floorMemory.size > 1)) {
    const first = floorMemory.keys().next().value;
    if (typeof first !== 'string') break;
    removeFloorMemoryEntry(first, true);
  }
}

function routeLiftWalkable(world: World, idx: number): boolean {
  const cell = world.cells[idx];
  return cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR;
}

function collectReachableRouteCells(world: World, startIdx: number): { cells: Int32Array; count: number; seen: Uint8Array } {
  const seen = new Uint8Array(W * W);
  const cells = new Int32Array(W * W);
  if (startIdx < 0 || !routeLiftWalkable(world, startIdx)) return { cells, count: 0, seen };

  let head = 0;
  let tail = 0;
  seen[startIdx] = 1;
  cells[tail++] = startIdx;
  while (head < tail) {
    const ci = cells[head++];
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const [dx, dy] of CARDINALS) {
      const ni = world.idx(x + dx, y + dy);
      if (seen[ni] || !routeLiftWalkable(world, ni)) continue;
      seen[ni] = 1;
      cells[tail++] = ni;
    }
  }
  return { cells, count: tail, seen };
}

function nearestRouteLiftWalkable(world: World, x: number, y: number, radius: number): number {
  const sx = world.wrap(Math.floor(Number.isFinite(x) ? x : W / 2));
  const sy = world.wrap(Math.floor(Number.isFinite(y) ? y : W / 2));
  const start = world.idx(sx, sy);
  if (routeLiftWalkable(world, start)) return start;
  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const idx = world.idx(sx + dx, sy + dy);
        if (routeLiftWalkable(world, idx)) return idx;
      }
    }
  }
  return -1;
}

function reachableRouteCellsFromPoint(world: World, x: number, y: number): { cells: Int32Array; count: number; seen: Uint8Array } {
  return collectReachableRouteCells(world, nearestRouteLiftWalkable(world, x, y, 64));
}

export function collectFloorLiftAnchors(
  world: World,
  direction: LiftDirection,
  limit = Number.MAX_SAFE_INTEGER,
): FloorLiftAnchor[] {
  const out: FloorLiftAnchor[] = [];
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    if (world.features[i] === Feature.MACHINE) continue; // skip fast-elevator cabins
    out.push({
      liftIdx: i,
      liftX: i % W,
      liftY: (i / W) | 0,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function clearAdjacentLiftButtons(world: World, liftIdx: number): boolean {
  let changed = false;
  const x = liftIdx % W;
  const y = (liftIdx / W) | 0;
  for (const [dx, dy] of CARDINALS) {
    const bi = world.idx(x + dx, y + dy);
    if (world.features[bi] !== Feature.LIFT_BUTTON) continue;
    world.features[bi] = Feature.NONE;
    world.liftDir[bi] = LiftDirection.DOWN;
    changed = true;
  }
  return changed;
}

function adjacentToLift(world: World, idx: number): boolean {
  const x = idx % W;
  const y = (idx / W) | 0;
  for (const [dx, dy] of CARDINALS) {
    if (world.cells[world.idx(x + dx, y + dy)] === Cell.LIFT) return true;
  }
  return false;
}

function demoteRouteLiftCell(world: World, idx: number, floorTex: Tex): boolean {
  if (world.cells[idx] !== Cell.LIFT) return false;
  if (world.features[idx] === Feature.MACHINE) return false; // never demote fast-elevator cabins
  clearAdjacentLiftButtons(world, idx);
  world.cells[idx] = Cell.FLOOR;
  world.roomMap[idx] = -1;
  world.floorTex[idx] = floorTex;
  world.wallTex[idx] = Tex.CONCRETE;
  world.features[idx] = Feature.NONE;
  world.liftDir[idx] = LiftDirection.DOWN;
  return true;
}

function clearRouteLiftButton(world: World, idx: number): boolean {
  if (world.features[idx] !== Feature.LIFT_BUTTON) return false;
  world.features[idx] = Feature.NONE;
  world.liftDir[idx] = LiftDirection.DOWN;
  return true;
}

function canOccupyRouteLift(world: World, idx: number, accessIdx: number): boolean {
  if (idx === accessIdx) return false;
  if (world.aptMask[idx] || world.hermoWall[idx] || world.containerMap.has(idx)) return false;
  return world.cells[idx] !== Cell.ABYSS;
}

function canUseRouteAccess(world: World, idx: number, liftIdx: number): boolean {
  if (idx === liftIdx) return false;
  if (world.aptMask[idx] || world.hermoWall[idx] || world.containerMap.has(idx)) return false;
  if (world.features[idx] !== Feature.NONE && world.features[idx] !== Feature.LIFT_BUTTON) return false;
  return world.cells[idx] !== Cell.LIFT && world.cells[idx] !== Cell.ABYSS;
}

function setRouteAccessFloor(world: World, idx: number, floorTex: Tex): boolean {
  let changed = false;
  if (world.cells[idx] === Cell.DOOR) {
    world.removeDoorAt(idx);
    changed = true;
  }
  if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) {
    world.cells[idx] = Cell.FLOOR;
    world.roomMap[idx] = -1;
    world.floorTex[idx] = floorTex;
    world.wallTex[idx] = Tex.CONCRETE;
    changed = true;
  }
  if (world.features[idx] !== Feature.NONE) {
    world.features[idx] = Feature.NONE;
    changed = true;
  }
  if (world.liftDir[idx] !== LiftDirection.DOWN) {
    world.liftDir[idx] = LiftDirection.DOWN;
    changed = true;
  }
  return changed;
}

function setRouteLiftCell(world: World, idx: number, direction: LiftDirection): void {
  if (world.cells[idx] === Cell.DOOR) world.removeDoorAt(idx);
  world.cells[idx] = Cell.LIFT;
  world.roomMap[idx] = -1;
  world.wallTex[idx] = Tex.LIFT_DOOR;
  world.features[idx] = Feature.NONE;
  world.liftDir[idx] = direction;
}

function routeLiftAccessCandidates(
  world: World,
  liftIdx: number,
  reachable: { cells: Int32Array; count: number; seen: Uint8Array },
): number[] {
  const candidates: number[] = [];
  const x = liftIdx % W;
  const y = (liftIdx / W) | 0;
  for (const [dx, dy] of CARDINALS) {
    const idx = world.idx(x + dx, y + dy);
    if (reachable.seen[idx] && canUseRouteAccess(world, idx, liftIdx)) candidates.push(idx);
  }
  for (const [dx, dy] of CARDINALS) {
    const idx = world.idx(x + dx, y + dy);
    if (!candidates.includes(idx) && canUseRouteAccess(world, idx, liftIdx)) candidates.push(idx);
  }
  return candidates;
}

function routeLiftSpacingTarget(reachableCount: number, targetCount: number): number {
  if (targetCount <= 1 || reachableCount <= 0) return 0;
  const spacing = Math.floor(Math.sqrt(reachableCount / targetCount) * ROUTE_LIFT_SPACING_FACTOR);
  return Math.max(ROUTE_LIFT_MIN_SPACING, Math.min(ROUTE_LIFT_MAX_SPACING, spacing));
}

function routeLiftAnchorsNeedRedistribution(
  world: World,
  anchors: readonly FloorLiftAnchor[],
  spacing: number,
): boolean {
  if (anchors.length < 2 || spacing <= 0) return false;
  const minDist2 = spacing * spacing;
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      if (world.dist2(
        anchors[i].liftX + 0.5,
        anchors[i].liftY + 0.5,
        anchors[j].liftX + 0.5,
        anchors[j].liftY + 0.5,
      ) < minDist2) {
        return true;
      }
    }
  }
  return false;
}

function collectRouteLiftIndices(world: World): number[] {
  const out: number[] = [];
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] === Cell.LIFT) out.push(i);
  }
  return out;
}

function routeLiftPlacementAccess(
  world: World,
  idx: number,
  reachable: { cells: Int32Array; count: number; seen: Uint8Array },
  blockedIdx: number,
): number {
  if (idx === blockedIdx) return -1;
  if (!canOccupyRouteLift(world, idx, -1)) return -1;
  if (world.cells[idx] !== Cell.FLOOR || world.features[idx] !== Feature.NONE) return -1;
  const x = idx % W;
  const y = (idx / W) | 0;
  let adjacentWalkable = 0;
  let accessIdx = -1;
  for (const [dx, dy] of CARDINALS) {
    const bi = world.idx(x + dx, y + dy);
    if (!reachable.seen[bi] || !canUseRouteAccess(world, bi, idx) || world.cells[bi] === Cell.LIFT) continue;
    adjacentWalkable++;
    if (accessIdx < 0) accessIdx = bi;
  }
  return adjacentWalkable >= 2 ? accessIdx : -1;
}

interface RouteLiftPlacementCandidate {
  idx: number;
  accessIdx: number;
  spacingScore: number;
  spawnScore: number;
}

function scoreRouteLiftCandidate(
  world: World,
  idx: number,
  occupiedLifts: readonly number[],
  spawnX: number,
  spawnY: number,
): Pick<RouteLiftPlacementCandidate, 'spacingScore' | 'spawnScore'> {
  const x = (idx % W) + 0.5;
  const y = ((idx / W) | 0) + 0.5;
  const spawnScore = world.dist2(spawnX, spawnY, x, y);
  if (occupiedLifts.length === 0) return { spacingScore: spawnScore, spawnScore };

  let spacingScore = Number.POSITIVE_INFINITY;
  for (const liftIdx of occupiedLifts) {
    const d2 = world.dist2(
      x,
      y,
      (liftIdx % W) + 0.5,
      ((liftIdx / W) | 0) + 0.5,
    );
    if (d2 < spacingScore) spacingScore = d2;
  }
  return { spacingScore, spawnScore };
}

function betterRouteLiftCandidate(
  candidate: RouteLiftPlacementCandidate,
  best: RouteLiftPlacementCandidate | null,
): boolean {
  if (!best) return true;
  if (candidate.spacingScore !== best.spacingScore) return candidate.spacingScore > best.spacingScore;
  if (candidate.spawnScore !== best.spawnScore) return candidate.spawnScore > best.spawnScore;
  return candidate.idx < best.idx;
}

function findDistributedRouteLiftCandidate(
  world: World,
  reachable: { cells: Int32Array; count: number; seen: Uint8Array },
  occupiedLifts: readonly number[],
  spawnX: number,
  spawnY: number,
  blockedIdx: number,
): RouteLiftPlacementCandidate | null {
  let best: RouteLiftPlacementCandidate | null = null;
  const step = Math.max(1, Math.floor(reachable.count / ROUTE_LIFT_CANDIDATE_SAMPLE_CAP));
  for (let n = 0; n < reachable.count; n += step) {
    const idx = reachable.cells[n];
    const accessIdx = routeLiftPlacementAccess(world, idx, reachable, blockedIdx);
    if (accessIdx < 0) continue;
    const score = scoreRouteLiftCandidate(world, idx, occupiedLifts, spawnX, spawnY);
    const candidate = { idx, accessIdx, ...score };
    if (betterRouteLiftCandidate(candidate, best)) best = candidate;
  }
  if (best || step === 1) return best;

  for (let n = 0; n < reachable.count; n++) {
    const idx = reachable.cells[n];
    const accessIdx = routeLiftPlacementAccess(world, idx, reachable, blockedIdx);
    if (accessIdx < 0) continue;
    const score = scoreRouteLiftCandidate(world, idx, occupiedLifts, spawnX, spawnY);
    const candidate = { idx, accessIdx, ...score };
    if (betterRouteLiftCandidate(candidate, best)) best = candidate;
  }
  return best;
}

function rebuildRouteLiftDirection(
  world: World,
  anchors: readonly FloorLiftAnchor[],
  floorTex: Tex,
): number {
  let demoted = 0;
  for (const anchor of anchors) {
    if (demoteRouteLiftCell(world, anchor.liftIdx, floorTex)) demoted++;
  }
  return demoted;
}

function nearestReachableRouteCell(
  world: World,
  fromIdx: number,
  reachable: { cells: Int32Array; count: number; seen: Uint8Array },
  maxDist: number,
): number {
  const fx = fromIdx % W;
  const fy = (fromIdx / W) | 0;
  let best = -1;
  let bestD = maxDist + 1;
  const step = Math.max(1, reachable.count >> 11);
  for (let i = 0; i < reachable.count; i += step) {
    const ci = reachable.cells[i];
    const d = Math.abs(world.delta(fx, ci % W)) + Math.abs(world.delta(fy, (ci / W) | 0));
    if (d < bestD) {
      bestD = d;
      best = ci;
    }
  }
  return bestD <= maxDist ? best : -1;
}

function carveRouteLiftConnector(world: World, fromIdx: number, toIdx: number, floorTex: Tex): { connected: boolean; changed: boolean } {
  let x = fromIdx % W;
  let y = (fromIdx / W) | 0;
  const tx = toIdx % W;
  const ty = (toIdx / W) | 0;
  const dx = world.delta(x, tx);
  const dy = world.delta(y, ty);
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const touched: number[] = [fromIdx];

  for (let s = 0; s < Math.abs(dx); s++) {
    x = world.wrap(x + stepX);
    const idx = world.idx(x, y);
    if (!canUseRouteAccess(world, idx, -1)) return { connected: false, changed: false };
    touched.push(idx);
  }
  for (let s = 0; s < Math.abs(dy); s++) {
    y = world.wrap(y + stepY);
    const idx = world.idx(x, y);
    if (!canUseRouteAccess(world, idx, -1)) return { connected: false, changed: false };
    touched.push(idx);
  }

  let changed = false;
  for (const idx of touched) {
    if (setRouteAccessFloor(world, idx, floorTex)) changed = true;
  }
  return { connected: true, changed };
}

function ensureRouteAccessReachable(
  world: World,
  accessIdx: number,
  reachable: { cells: Int32Array; count: number; seen: Uint8Array },
  floorTex: Tex,
): { connected: boolean; changed: boolean } {
  if (reachable.seen[accessIdx]) return { connected: true, changed: false };
  const target = nearestReachableRouteCell(world, accessIdx, reachable, ROUTE_LIFT_CONNECTOR_MAX);
  if (target < 0) return { connected: false, changed: false };
  return carveRouteLiftConnector(world, accessIdx, target, floorTex);
}

function ensureRouteLiftUsable(
  world: World,
  liftIdx: number,
  direction: LiftDirection,
  reachable: { cells: Int32Array; count: number; seen: Uint8Array },
  floorTex: Tex,
): { usable: boolean; changed: boolean } {
  if (world.cells[liftIdx] !== Cell.LIFT || world.liftDir[liftIdx] !== direction) {
    return { usable: false, changed: false };
  }
  let changed = clearAdjacentLiftButtons(world, liftIdx);
  for (const accessIdx of routeLiftAccessCandidates(world, liftIdx, reachable)) {
    const connected = ensureRouteAccessReachable(world, accessIdx, reachable, floorTex);
    if (!connected.connected) continue;
    if (setRouteAccessFloor(world, accessIdx, floorTex)) changed = true;
    return { usable: true, changed: changed || connected.changed };
  }
  return { usable: false, changed };
}

function placeMirroredRouteLift(
  world: World,
  anchor: FloorLiftAnchor,
  direction: LiftDirection,
  reachable: { cells: Int32Array; count: number; seen: Uint8Array },
  floorTex: Tex,
): boolean {
  const liftIdx = world.idx(anchor.liftX, anchor.liftY);
  for (const accessIdx of routeLiftAccessCandidates(world, liftIdx, reachable)) {
    if (!canOccupyRouteLift(world, liftIdx, accessIdx)) continue;
    if (!canUseRouteAccess(world, accessIdx, liftIdx)) continue;
    setRouteLiftCell(world, liftIdx, direction);
    clearAdjacentLiftButtons(world, liftIdx);
    const connected = ensureRouteAccessReachable(world, accessIdx, reachable, floorTex);
    if (connected.connected) {
      setRouteAccessFloor(world, accessIdx, floorTex);
      return true;
    }
    demoteRouteLiftCell(world, liftIdx, floorTex);
  }
  return false;
}

function fillRouteLift(
  world: World,
  reachable: { cells: Int32Array; count: number; seen: Uint8Array },
  direction: LiftDirection,
  floorTex: Tex,
  spawnX: number,
  spawnY: number,
  blockedIdx = -1,
): boolean {
  if (reachable.count <= 0) return false;
  const candidate = findDistributedRouteLiftCandidate(
    world,
    reachable,
    collectRouteLiftIndices(world),
    spawnX,
    spawnY,
    blockedIdx,
  );
  if (!candidate) return false;
  setRouteLiftCell(world, candidate.idx, direction);
  setRouteAccessFloor(world, candidate.accessIdx, floorTex);
  return true;
}

function routeLiftCount(world: World, direction: LiftDirection): number {
  let count = 0;
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] === Cell.LIFT && world.liftDir[i] === direction && world.features[i] !== Feature.MACHINE) count++;
  }
  return count;
}

function markRouteLiftLayoutDirty(world: World): void {
  world.markCellsDirty();
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFeaturesDirty(true);
}

export function ensureFloorRouteLiftLayout(
  world: World,
  spawnX: number,
  spawnY: number,
  expectedDirections: readonly LiftDirection[],
  options: {
    countPerDirection?: number;
    mirror?: FloorRouteLiftMirror;
    floorTex?: Tex;
  } = {},
): FloorRouteLiftLayoutResult {
  const targetCount = Math.max(0, Math.floor(options.countPerDirection ?? DEFAULT_ROUTE_LIFTS_PER_DIRECTION));
  const expected = new Set(expectedDirections);
  const floorTex = options.floorTex ?? Tex.F_CONCRETE;
  let placed = 0;
  let demoted = 0;
  let mirrored = 0;
  let changed = false;

  for (let i = 0; i < world.cells.length; i++) {
    const dir = world.liftDir[i] as LiftDirection;
    if (world.cells[i] === Cell.LIFT && world.features[i] !== Feature.MACHINE && !expected.has(dir)) {
      if (demoteRouteLiftCell(world, i, floorTex)) {
        demoted++;
        changed = true;
      }
    }
    if (
      world.features[i] === Feature.LIFT_BUTTON &&
      (!expected.has(dir) || adjacentToLift(world, i))
    ) {
      if (clearRouteLiftButton(world, i)) changed = true;
    }
  }

  const mirror = options.mirror && expected.has(options.mirror.direction) ? options.mirror : undefined;
  if (mirror) {
    for (const anchor of collectFloorLiftAnchors(world, mirror.direction)) {
      if (demoteRouteLiftCell(world, anchor.liftIdx, floorTex)) {
        demoted++;
        changed = true;
      }
    }
    let reachable = reachableRouteCellsFromPoint(world, spawnX, spawnY);
    for (const anchor of mirror.anchors.slice(0, targetCount)) {
      if (placeMirroredRouteLift(world, anchor, mirror.direction, reachable, floorTex)) {
        placed++;
        mirrored++;
        changed = true;
        reachable = reachableRouteCellsFromPoint(world, spawnX, spawnY);
      }
    }
  }

  const blockedIdx = world.idx(Math.floor(spawnX), Math.floor(spawnY));
  for (const direction of expected) {
    let reachable = reachableRouteCellsFromPoint(world, spawnX, spawnY);
    let anchors = collectFloorLiftAnchors(world, direction);
    const preservesMirroredAnchors = mirror?.direction === direction;
    const spacingTarget = routeLiftSpacingTarget(reachable.count, targetCount);
    if (
      !preservesMirroredAnchors &&
      (
        anchors.length > targetCount ||
        routeLiftAnchorsNeedRedistribution(world, anchors, spacingTarget)
      )
    ) {
      demoted += rebuildRouteLiftDirection(world, anchors, floorTex);
      changed = true;
      reachable = reachableRouteCellsFromPoint(world, spawnX, spawnY);
    }

    for (const anchor of collectFloorLiftAnchors(world, direction)) {
      const usable = ensureRouteLiftUsable(world, anchor.liftIdx, direction, reachable, floorTex);
      if (usable.usable) {
        if (usable.changed) changed = true;
        reachable = reachableRouteCellsFromPoint(world, spawnX, spawnY);
      } else if (demoteRouteLiftCell(world, anchor.liftIdx, floorTex)) {
        demoted++;
        changed = true;
      }
    }

    anchors = collectFloorLiftAnchors(world, direction);
    while (anchors.length > targetCount) {
      const anchor = anchors.pop();
      if (!anchor) break;
      if (demoteRouteLiftCell(world, anchor.liftIdx, floorTex)) {
        demoted++;
        changed = true;
      }
    }

    reachable = reachableRouteCellsFromPoint(world, spawnX, spawnY);
    while (collectFloorLiftAnchors(world, direction).length < targetCount) {
      if (!fillRouteLift(world, reachable, direction, floorTex, spawnX, spawnY, blockedIdx)) break;
      placed++;
      changed = true;
      reachable = reachableRouteCellsFromPoint(world, spawnX, spawnY);
    }

    for (const anchor of collectFloorLiftAnchors(world, direction)) {
      const usable = ensureRouteLiftUsable(world, anchor.liftIdx, direction, reachableRouteCellsFromPoint(world, spawnX, spawnY), floorTex);
      if (usable.changed) changed = true;
    }
  }

  if (changed) {
    recomputeWorldZoneLiftFlags(world);
    markRouteLiftLayoutDirty(world);
  }

  return {
    down: routeLiftCount(world, LiftDirection.DOWN),
    up: routeLiftCount(world, LiftDirection.UP),
    placed,
    demoted,
    mirrored,
  };
}

export function captureFloorMemory(
  keyInput: string,
  world: World,
  entities: readonly Entity[],
  spawnX: number,
  spawnY: number,
  capturedAt: number,
  samosborCount: number,
  generationExtras?: FloorMemoryGenerationExtras,
): boolean {
  const key = cleanFloorKey(keyInput);
  if (!key) return false;
  const storedEntities = entities.filter(storableEntity);
  removeFloorMemoryEntry(key);
  removePackedFloorMemoryEntry(key);
  const estimatedBytes = estimateFloorMemoryEntryBytes(world, storedEntities);
  floorMemory.set(key, {
    key,
    world,
    entities: storedEntities,
    spawnX,
    spawnY,
    capturedAt,
    samosborCount,
    estimatedBytes,
    generationExtras,
  });
  floorMemoryBytes += estimatedBytes;
  trimFloorMemory();
  return true;
}

export function hasFloorMemory(keyInput: string): boolean {
  const key = cleanFloorKey(keyInput);
  if (!key) return false;
  return floorMemory.has(key) || packedFloorMemory.has(key);
}

export function takeFloorMemory(keyInput: string): FloorMemoryLoad | null {
  const key = cleanFloorKey(keyInput);
  if (!key) return null;
  const entry = floorMemory.get(key);
  if (entry) {
    removeFloorMemoryEntry(key);
    return {
      fromMemory: true,
      generation: {
        world: entry.world,
        entities: entry.entities,
        spawnX: entry.spawnX,
        spawnY: entry.spawnY,
        ...(entry.generationExtras ?? {}),
      } as FloorGeneration,
    };
  }
  const packed = packedFloorMemory.get(key);
  if (!packed) return null;
  removePackedFloorMemoryEntry(key);
  const world = worldFromSave(packed.save.world, packed.save.spawnX, packed.save.spawnY);
  if (!world) return null;
  return {
    fromMemory: true,
    generation: {
      world,
      entities: restoreEntities(packed.save.entities),
      spawnX: packed.save.spawnX,
      spawnY: packed.save.spawnY,
      ...(resolvePackedGenerationExtras(key, packed) ?? {}),
    } as FloorGeneration,
  };
}

function entryForSave(entry: FloorMemoryEntry): FloorMemorySaveEntry {
  return {
    key: entry.key,
    spawnX: Number.isFinite(entry.spawnX) ? entry.spawnX : W / 2,
    spawnY: Number.isFinite(entry.spawnY) ? entry.spawnY : W / 2,
    capturedAt: Number.isFinite(entry.capturedAt) ? entry.capturedAt : 0,
    samosborCount: Number.isFinite(entry.samosborCount) ? Math.max(0, Math.floor(entry.samosborCount)) : 0,
    world: worldForSave(entry.world),
    entities: cloneJson(entry.entities),
    estimatedBytes: entry.estimatedBytes,
  };
}

interface FloorMemorySaveCandidate {
  save: FloorMemorySaveEntry;
  bytes: number;
  importance: number;
}

function floorMemorySaveImportance(save: FloorMemorySaveEntry): number {
  let score = 0;
  if (save.key.startsWith('story:')) score += 10_000;
  if (save.key.startsWith('design:')) score += 5_000;
  score += Math.min(4_000, save.samosborCount * 64);
  score += Math.min(8_000, save.entities.length * 32);
  score += Math.min(8_000, save.world.containers.length * 24);
  score += Math.min(4_000, save.world.surfaceMap.length * 8);
  score += Math.min(4_000, save.world.doors.length * 4);
  return score;
}

function floorMemorySaveStateBytes(
  entries: readonly FloorMemorySaveEntry[],
  byteBudget: number,
  bytes = 0,
): number {
  return estimateJsonBytes({
    version: 1 as const,
    entries,
    bytes,
    byteBudget,
  });
}

function floorMemorySaveCandidates(): FloorMemorySaveCandidate[] {
  const candidates: FloorMemorySaveCandidate[] = [];
  for (const packed of packedFloorMemory.values()) {
    candidates.push({
      save: packed.save,
      bytes: Math.max(0, packed.estimatedBytes),
      importance: floorMemorySaveImportance(packed.save),
    });
  }
  for (const entry of floorMemory.values()) {
    const save = entryForSave(entry);
    candidates.push({
      save,
      bytes: estimateJsonBytes(save),
      importance: floorMemorySaveImportance(save),
    });
  }
  candidates.sort((a, b) => {
    const captured = b.save.capturedAt - a.save.capturedAt;
    if (captured !== 0) return captured;
    const important = b.importance - a.importance;
    if (important !== 0) return important;
    const compact = a.bytes - b.bytes;
    if (compact !== 0) return compact;
    return a.save.key.localeCompare(b.save.key);
  });
  return candidates;
}

export function floorMemoryStateForSave(): FloorMemorySaveState {
  const byteBudget = floorMemorySaveByteBudget();
  const entries: FloorMemorySaveEntry[] = [];
  for (const candidate of floorMemorySaveCandidates()) {
    if (entries.length >= MAX_FLOOR_MEMORY_SAVE_ENTRIES) break;
    if (candidate.bytes <= 0) continue;
    const nextEntries = [...entries, candidate.save];
    if (floorMemorySaveStateBytes(nextEntries, byteBudget) > byteBudget - 64) continue;
    entries.push(candidate.save);
  }
  let bytes = floorMemorySaveStateBytes(entries, byteBudget);
  bytes = floorMemorySaveStateBytes(entries, byteBudget, bytes);
  while (entries.length > 0 && bytes > byteBudget) {
    entries.pop();
    bytes = floorMemorySaveStateBytes(entries, byteBudget);
    bytes = floorMemorySaveStateBytes(entries, byteBudget, bytes);
  }
  return {
    version: 1,
    entries,
    bytes,
    byteBudget,
  };
}

function finiteCoord(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback;
}

function finiteNonNegativeInt(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback;
}

function knownEntityType(value: unknown): value is EntityType {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= EntityType.NPC
    && value <= EntityType.BILLBOARD;
}

function finiteEntityCoord(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return W / 2;
  return ((value % W) + W) % W;
}

function sanitizeRestoredEntity(entity: Entity): Entity | null {
  if (typeof entity.id !== 'number' || !Number.isFinite(entity.id)) return null;
  if (!knownEntityType(entity.type)) return null;
  if (!storableEntity(entity)) return null;
  entity.id = Math.floor(entity.id);
  entity.x = finiteEntityCoord(entity.x);
  entity.y = finiteEntityCoord(entity.y);
  entity.angle = finiteCoord(entity.angle, 0);
  entity.pitch = finiteCoord(entity.pitch, 0);
  entity.speed = finiteCoord(entity.speed, 0);
  entity.sprite = finiteNonNegativeInt(entity.sprite, 0);
  if (entity.spriteScale !== undefined) entity.spriteScale = finiteCoord(entity.spriteScale, 1);
  if (entity.spriteZ !== undefined) entity.spriteZ = finiteCoord(entity.spriteZ, 0);
  if (typeof entity.alive !== 'boolean') entity.alive = true;
  if (entity.type === EntityType.BILLBOARD) entity.inventory = undefined;
  return entity;
}

function restoreEntities(input: unknown): Entity[] {
  if (!Array.isArray(input)) return [];
  const out: Entity[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    let entity: Entity;
    try {
      entity = cloneJson(raw) as Entity;
    } catch {
      continue;
    }
    const sanitized = sanitizeRestoredEntity(entity);
    if (sanitized) out.push(sanitized);
  }
  return out;
}

function sanitizedSaveEntry(raw: Partial<FloorMemorySaveEntry>): FloorMemorySaveEntry | null {
  const key = cleanFloorKey(raw?.key);
  if (!key || !raw?.world) return null;
  const world = sanitizedWorldSave(raw.world);
  if (!world) return null;
  const entities = restoreEntities(raw.entities);
  return {
    key,
    spawnX: finiteCoord(raw.spawnX, W / 2),
    spawnY: finiteCoord(raw.spawnY, W / 2),
    capturedAt: finiteCoord(raw.capturedAt, 0),
    samosborCount: finiteNonNegativeInt(raw.samosborCount),
    world,
    entities,
    estimatedBytes: finiteNonNegativeInt(raw.estimatedBytes),
  };
}

function floorMemoryRestoreKeyKnown(key: string, options: FloorMemoryRestoreOptions): boolean {
  try {
    return options.isKnownFloorKey
      ? options.isKnownFloorKey(key)
      : floorKeyKnown(key, options.floorKeyContext);
  } catch {
    return false;
  }
}

export function restoreFloorMemoryFromSave(
  input: unknown,
  options: FloorMemoryRestoreOptions = {},
): FloorMemoryRestoreResult {
  clearFloorMemory();
  const result: FloorMemoryRestoreResult = { restored: 0, skipped: 0, keys: [] };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
  const state = input as Partial<FloorMemorySaveState>;
  if (state.version !== 1 || !Array.isArray(state.entries)) return result;
  for (const raw of state.entries.slice(0, MAX_FLOOR_MEMORY_RESTORE_SCAN_ENTRIES)) {
    if (result.restored >= MAX_FLOOR_MEMORY_SAVE_ENTRIES) break;
    const key = isRecord(raw) ? cleanFloorKey(raw.key) : '';
    if (!key || !floorMemoryRestoreKeyKnown(key, options)) {
      result.skipped++;
      continue;
    }
    try {
      const save = sanitizedSaveEntry(raw as Partial<FloorMemorySaveEntry>);
      if (!save) {
        result.skipped++;
        continue;
      }
      removePackedFloorMemoryEntry(save.key);
      const estimatedBytes = estimateJsonBytes(save);
      packedFloorMemory.set(save.key, {
        save: { ...save, estimatedBytes },
        estimatedBytes,
        generationExtrasForKey: options.generationExtrasForKey,
      });
      packedFloorMemoryBytes += estimatedBytes;
      result.restored++;
      result.keys.push(save.key);
    } catch {
      result.skipped++;
    }
  }
  return result;
}

export function invalidateFloorMemory(keyInput: string): boolean {
  const key = cleanFloorKey(keyInput);
  return key ? (removeFloorMemoryEntry(key) || removePackedFloorMemoryEntry(key)) : false;
}

export function clearFloorMemory(): void {
  floorMemory.clear();
  packedFloorMemory.clear();
  floorMemoryBytes = 0;
  packedFloorMemoryBytes = 0;
}

export function setFloorMemoryByteBudgetForTests(bytes: number | undefined): void {
  floorMemoryBudgetOverride = bytes === undefined
    ? undefined
    : Math.max(1, Math.floor(bytes));
  trimFloorMemory();
}

export function setFloorMemorySaveByteBudgetForTests(bytes: number | undefined): void {
  floorMemorySaveBudgetOverride = bytes === undefined
    ? undefined
    : Math.max(1024, Math.floor(bytes));
}

export function floorMemoryStats(): {
  count: number;
  fullCount: number;
  packedCount: number;
  cap: number;
  bytes: number;
  packedBytes: number;
  byteBudget: number;
  keys: string[];
} {
  return {
    count: floorMemory.size + packedFloorMemory.size,
    fullCount: floorMemory.size,
    packedCount: packedFloorMemory.size,
    cap: MAX_FLOOR_MEMORY_ENTRIES,
    bytes: floorMemoryBytes,
    packedBytes: packedFloorMemoryBytes,
    byteBudget: floorMemoryByteBudget(),
    keys: [...packedFloorMemory.keys(), ...floorMemory.keys()],
  };
}
