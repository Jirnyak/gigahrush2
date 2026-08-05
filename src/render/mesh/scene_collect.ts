import {
  Cell,
  ContainerKind,
  DoorState,
  EntityType,
  Feature,
  MAX_DRAW,
  type Room,
  RoomType,
  Tex,
  W,
  type Entity,
  type WorldContainer,
} from '../../core/types';
import {
  EMPTY_VISUAL_CELL_CODE,
  VISUAL_SLOTS_PER_CELL,
  type World,
} from '../../core/world';
import {
  VISUAL_CELL_DEFS,
  visualCellDefByCode,
  visualCellDefById,
  type VisualCellDef,
  type VisualCellZBand,
} from '../../data/visual_cell_slots';
import {
  visualCorridorCoveringById,
  type FloorScatterPackage,
  type VisualCorridorCoveringDef,
  type VisualCorridorCoveringId,
  type VisualCorridorVolumeStyle,
} from '../../data/visual_corridor_coverings';
import { VISUAL_GEOMETRY_MODE_BUDGETS } from '../../data/visual_geometry_profiles';
import type { CameraView } from '../../systems/camera';
import { ENTITY_MASK_BILLBOARD, type EntityIndex } from '../../systems/entity_index';

export type VisualModelId = string;
export type MeshGraphicsMode = 'off' | 'low' | 'medium' | 'high';
export { EMPTY_VISUAL_CELL_CODE, VISUAL_SLOTS_PER_CELL } from '../../core/world';

export const MeshInstanceFlag = {
  VisualSlot: 1 << 0,
  Feature: 1 << 1,
  Container: 1 << 2,
  Entity: 1 << 3,
  Merged: 1 << 4,
  WallMount: 1 << 5,
  Emissive: 1 << 6,
  CorridorVolume: 1 << 7,
} as const;

export interface MeshInstance {
  modelId: VisualModelId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  seed: number;
  tint?: number;
  flags: number;
}

export interface MeshSourceAdapter {
  collect(context: MeshPassContext, out: MeshInstance[]): void;
}

export interface MeshSceneProfile {
  enabled?: boolean;
  radius?: number;
  proceduralFieldRadius?: number;
  proceduralFieldInstanceCap?: number;
  instanceCap?: number;
  visualSlotScanCap?: number;
  visualSlotInstanceCap?: number;
  visualSlotMergeCap?: number;
  includeVisualSlots?: boolean;
  includeFeatures?: boolean;
  includeContainers?: boolean;
  includeEntities?: boolean;
  includeCorridorVolumes?: boolean;
  ceilingDetail?: number;
  furnitureDetail?: number;
  corridorVolumeDetail?: number;
  organicVolumeDetail?: number;
  corridorVolumeStyle?: VisualCorridorVolumeStyle;
  corridorCoveringId?: VisualCorridorCoveringId;
  chunkSize?: number;
  maxChunksPerFrame?: number;
}

export interface ResolvedMeshSceneProfile {
  enabled: boolean;
  radius: number;
  meshDrawRadius: number;
  radiusCells: number;
  proceduralFieldRadius: number;
  proceduralFieldInstanceCap: number;
  instanceCap: number;
  visualSlotScanCap: number;
  visualSlotInstanceCap: number;
  visualSlotMergeCap: number;
  includeVisualSlots: boolean;
  includeFeatures: boolean;
  includeContainers: boolean;
  includeEntities: boolean;
  includeCorridorVolumes: boolean;
  corridorVolumeDetail: number;
  organicVolumeDetail: number;
  corridorVolumeStyle: VisualCorridorVolumeStyle;
  corridorCoveringId: VisualCorridorCoveringId;
  chunkSize: number;
  maxChunksPerFrame: number;
}

export interface MeshPassContext {
  world: World;
  camera: CameraView;
  floorKey: string;
  seed: number;
  time: number;
  mode?: MeshGraphicsMode;
  profile?: MeshSceneProfile | null;
  fogDensity?: number;
  entityIndex?: Pick<EntityIndex, 'queryRadiusCapped'>;
}

export interface MeshSceneCollectStats {
  cellsScanned: number;
  visualSlotsRead: number;
  unknownVisualCodes: number;
  instancesBeforeCap: number;
  instancesAfterCap: number;
}

export interface MeshSceneCollectResult {
  instances: MeshInstance[];
  stats: MeshSceneCollectStats;
}

function visualCode(id: string): number {
  const def = visualCellDefById(id);
  if (!def) throw new Error(`missing visual cell id: ${id}`);
  return def.code;
}

export const VISUAL_CELL_CODES = {
  PIPE_WALL_SMALL: visualCode('pipe_wall_small'),
  PIPE_WALL_LARGE: visualCode('pipe_wall_large'),
  BUTTON_PANEL: visualCode('button_panel'),
  CABLE_WALL_LOOSE: visualCode('cable_wall_loose'),
  CEILING_CABLE: visualCode('ceiling_cable'),
  CEILING_BEAM: visualCode('ceiling_beam'),
  CEILING_PIPE_BUNDLE: visualCode('ceiling_pipe_bundle'),
  CEILING_CABLE_BUNDLE: visualCode('ceiling_cable_bundle'),
  CEILING_BULB: visualCode('ceiling_bulb'),
  CEILING_LIGHT_PANEL: visualCode('ceiling_light_panel'),
  WALL_PANEL_SCREEN: visualCode('wall_panel_screen'),
  RUBBLE_CHUNK: visualCode('rubble_chunk'),
  COLUMN_HINT: visualCode('column_hint'),
  COLUMN_CONCRETE_SQUARE: visualCode('column_concrete_square'),
  FURNITURE_TABLE_HINT: visualCode('furniture_table_hint'),
  FURNITURE_DESK_HINT: visualCode('furniture_desk_hint'),
  FURNITURE_CHAIR_HINT: visualCode('furniture_chair_hint'),
  FURNITURE_BED_HINT: visualCode('furniture_bed_hint'),
  FURNITURE_SHELF_HINT: visualCode('furniture_shelf_hint'),
  MACHINE_BODY: visualCode('machine_body'),
  MACHINE_PANEL: visualCode('machine_panel'),
  APPARATUS_FRAME: visualCode('apparatus_frame'),
  LAMP_STAND_HINT: visualCode('lamp_stand_hint'),
  CANDLE_STUB_HINT: visualCode('candle_stub_hint'),
} as const;

const FEATURE_PRIMARY_VISUAL_CODES: Partial<Record<Feature, readonly number[]>> = {
  [Feature.CANDLE]: [VISUAL_CELL_CODES.CANDLE_STUB_HINT],
  [Feature.TABLE]: [VISUAL_CELL_CODES.FURNITURE_TABLE_HINT],
  [Feature.CHAIR]: [VISUAL_CELL_CODES.FURNITURE_CHAIR_HINT],
  [Feature.BED]: [VISUAL_CELL_CODES.FURNITURE_BED_HINT],
  [Feature.STOVE]: [VISUAL_CELL_CODES.MACHINE_BODY],
  [Feature.MACHINE]: [VISUAL_CELL_CODES.MACHINE_BODY],
  [Feature.APPARATUS]: [VISUAL_CELL_CODES.APPARATUS_FRAME],
  [Feature.LIFT_BUTTON]: [VISUAL_CELL_CODES.BUTTON_PANEL],
  [Feature.DESK]: [VISUAL_CELL_CODES.FURNITURE_DESK_HINT],
  [Feature.SCREEN]: [VISUAL_CELL_CODES.WALL_PANEL_SCREEN],
  [Feature.LAMP]: [VISUAL_CELL_CODES.CEILING_BULB],
};

interface FeatureMeshDef {
  modelId: VisualModelId;
  priority: number;
  z: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  yawSalt: number;
  flags?: number;
}

const FEATURE_MESH_DEFS: Partial<Record<Feature, FeatureMeshDef>> = {
  [Feature.CANDLE]: { modelId: 'candle_stub', priority: 98, z: 0, scaleX: 0.3, scaleY: 0.3, scaleZ: 0.45, yawSalt: 12, flags: MeshInstanceFlag.Emissive },
  [Feature.TABLE]: { modelId: 'table_slab', priority: 62, z: 0, scaleX: 0.82, scaleY: 0.62, scaleZ: 0.42, yawSalt: 21 },
  [Feature.CHAIR]: { modelId: 'chair_simple', priority: 54, z: 0, scaleX: 0.42, scaleY: 0.42, scaleZ: 0.65, yawSalt: 22 },
  [Feature.BED]: { modelId: 'bed_frame', priority: 68, z: 0, scaleX: 1.05, scaleY: 0.72, scaleZ: 0.42, yawSalt: 23 },
  [Feature.STOVE]: { modelId: 'stove_block', priority: 64, z: 0, scaleX: 0.72, scaleY: 0.68, scaleZ: 0.9, yawSalt: 24 },
  [Feature.SINK]: { modelId: 'sink_basin', priority: 66, z: 0, scaleX: 0.72, scaleY: 0.72, scaleZ: 0.82, yawSalt: 25 },
  [Feature.TOILET]: { modelId: 'toilet_bowl', priority: 58, z: 0, scaleX: 0.76, scaleY: 0.76, scaleZ: 0.82, yawSalt: 26 },
  [Feature.SHELF]: { modelId: 'shelf_block', priority: 70, z: 0, scaleX: 0.72, scaleY: 0.35, scaleZ: 0.95, yawSalt: 27 },
  [Feature.MACHINE]: { modelId: 'machine_box', priority: 74, z: 0, scaleX: 0.82, scaleY: 0.72, scaleZ: 0.9, yawSalt: 28 },
  [Feature.APPARATUS]: { modelId: 'apparatus_cage', priority: 72, z: 0, scaleX: 0.72, scaleY: 0.72, scaleZ: 0.9, yawSalt: 29 },
  [Feature.LIFT_BUTTON]: { modelId: 'button_panel', priority: 98, z: zForBand('midWall'), scaleX: 0.3, scaleY: 0.2, scaleZ: 0.3, yawSalt: 30, flags: MeshInstanceFlag.WallMount },
  [Feature.DESK]: { modelId: 'desk_slab', priority: 62, z: 0, scaleX: 0.88, scaleY: 0.58, scaleZ: 0.48, yawSalt: 31 },
  [Feature.SCREEN]: { modelId: 'wall_panel_screen', priority: 92, z: zForBand('midWall'), scaleX: 0.52, scaleY: 0.08, scaleZ: 0.42, yawSalt: 33, flags: MeshInstanceFlag.WallMount | MeshInstanceFlag.Emissive },
  [Feature.LAMP]: { modelId: 'ceiling_bulb', priority: 94, z: zForBand('ceiling'), scaleX: 1, scaleY: 1, scaleZ: 1, yawSalt: 13, flags: MeshInstanceFlag.Emissive },
};

const MODEL_PRIORITY_CACHE = new Map<string, number>();

for (const def of VISUAL_CELL_DEFS) {
  if (!MODEL_PRIORITY_CACHE.has(def.modelId)) MODEL_PRIORITY_CACHE.set(def.modelId, def.priority);
  if (!MODEL_PRIORITY_CACHE.has(def.id)) MODEL_PRIORITY_CACHE.set(def.id, def.priority);
}

for (const def of Object.values(FEATURE_MESH_DEFS)) {
  if (def?.modelId && !MODEL_PRIORITY_CACHE.has(def.modelId)) {
    MODEL_PRIORITY_CACHE.set(def.modelId, def.priority);
  }
}

export const MESH_FEATURE_MODEL_IDS: Readonly<Partial<Record<Feature, string>>> = Object.freeze(
  Object.fromEntries(Object.entries(FEATURE_MESH_DEFS).map(([feature, def]) => [feature, def?.modelId])),
);

const ENTITY_QUERY_SCRATCH: Entity[] = [];
const MAX_MERGE_RUN = 16;
const MAX_CLUSTER_CELLS = 16;
const MAX_CORRIDOR_CEILING_RUN = 14;
const FIELD_COVERAGE_RING_COUNT = 4;
const DEFAULT_CHUNK_SIZE = 8;
const DEFAULT_MAX_CHUNKS_PER_FRAME = 8;
const DEFAULT_VISUAL_SLOT_SCAN_CAP = 24_000;

type FaceDir = 0 | 1 | 2 | 3;
type Axis = 'x' | 'y';

interface FaceInfo {
  dir: FaceDir;
  nx: number;
  ny: number;
  tangentDx: number;
  tangentDy: number;
  tangentAxis: Axis;
  yaw: number;
}

interface ResolvedWallFace extends FaceInfo {
  x: number;
  y: number;
  z: number;
  wallX: number;
  wallY: number;
  wallIdx: number;
  roomId: number;
}

interface CellScanScope {
  kind: 'radius' | 'chunk';
  centerX: number;
  centerY: number;
  radius: number;
  chunkX?: number;
  chunkY?: number;
  chunkSize?: number;
}

interface PipeNetworkCandidate {
  modelId: VisualModelId;
  x: number;
  y: number;
  yaw: number;
  length: number;
  z: number;
  scaleY: number;
  scaleZ: number;
  seed: number;
  d2: number;
}

interface FloorScatterCandidate {
  modelId: VisualModelId;
  x: number;
  y: number;
  yaw: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  seed: number;
  d2: number;
}

interface StableFieldCandidate {
  d2: number;
  seed: number;
}

const FACE_INFOS: readonly FaceInfo[] = [
  { dir: 0, nx: 1, ny: 0, tangentDx: 0, tangentDy: 1, tangentAxis: 'y', yaw: Math.PI / 2 },
  { dir: 1, nx: -1, ny: 0, tangentDx: 0, tangentDy: 1, tangentAxis: 'y', yaw: Math.PI / 2 },
  { dir: 2, nx: 0, ny: 1, tangentDx: 1, tangentDy: 0, tangentAxis: 'x', yaw: 0 },
  { dir: 3, nx: 0, ny: -1, tangentDx: 1, tangentDy: 0, tangentAxis: 'x', yaw: Math.PI },
];

function zForBand(band: VisualCellZBand | undefined): number {
  switch (band) {
    case 'lowWall': return 0.28;
    case 'midWall': return 0.55;
    case 'highWall': return 0.78;
    case 'ceiling': return 1;
    case 'fullHeight': return 0;
    case 'floor':
    default: return 0;
  }
}

function newStats(): MeshSceneCollectStats {
  return {
    cellsScanned: 0,
    visualSlotsRead: 0,
    unknownVisualCodes: 0,
    instancesBeforeCap: 0,
    instancesAfterCap: 0,
  };
}

function mixHash(seed: number, a: number, b = 0, c = 0, d = 0): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (a + 0x85ebca6b), 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ (b + 0x27d4eb2d), 0x165667b1) >>> 0;
  h = Math.imul(h ^ (c + 0xd3a2646c), 0x9e3779b1) >>> 0;
  h = Math.imul(h ^ (d + 0x27d4eb2f), 0x85ebca77) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

function stringHash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function meshInstanceSeed(seed: number, x: number, y: number, source: number, modelId: string, roomId = -1): number {
  return mixHash(
    seed,
    Math.floor(x * 1024),
    Math.floor(y * 1024),
    source ^ stringHash(modelId),
    roomId,
  );
}

function wrapFloat(value: number): number {
  return ((value % W) + W) % W;
}

function cameraCellCenter(context: MeshPassContext): { x: number; y: number } {
  return {
    x: wrapFloat(Math.floor(context.camera.x) + 0.5),
    y: wrapFloat(Math.floor(context.camera.y) + 0.5),
  };
}

function wrappedDelta(from: number, to: number): number {
  let d = to - from;
  if (d > W / 2) d -= W;
  if (d < -W / 2) d += W;
  return d;
}

function isPassableVisualCell(world: World, idx: number): boolean {
  const cell = world.cells[idx];
  if (cell === Cell.FLOOR || cell === Cell.WATER) return true;
  if (cell !== Cell.DOOR) return false;
  const door = world.doors.get(idx);
  return door?.state === DoorState.OPEN || door?.state === DoorState.HERMETIC_OPEN;
}

function isWallLikeVisualCell(world: World, idx: number): boolean {
  const cell = world.cells[idx];
  if (cell === Cell.WALL || cell === Cell.LIFT || cell === Cell.ABYSS) return true;
  if (cell !== Cell.DOOR) return false;
  const door = world.doors.get(idx);
  return !door || (door.state !== DoorState.OPEN && door.state !== DoorState.HERMETIC_OPEN);
}

function facePosition(world: World, wallX: number, wallY: number, face: FaceInfo, z: number): ResolvedWallFace {
  const wallIdx = world.idx(wallX, wallY);
  const eps = 0.018;
  let x = wallX + 0.5;
  let y = wallY + 0.5;
  if (face.nx > 0) x = wallX + 1 + eps;
  else if (face.nx < 0) x = wallX - eps;
  if (face.ny > 0) y = wallY + 1 + eps;
  else if (face.ny < 0) y = wallY - eps;
  return {
    ...face,
    x: wrapFloat(x),
    y: wrapFloat(y),
    z,
    wallX: world.wrap(wallX),
    wallY: world.wrap(wallY),
    wallIdx,
    roomId: world.roomMap[wallIdx] ?? -1,
  };
}

function faceFromNormal(nx: number, ny: number): FaceInfo {
  if (nx === 1 && ny === 0) return FACE_INFOS[0];
  if (nx === -1 && ny === 0) return FACE_INFOS[1];
  if (nx === 0 && ny === 1) return FACE_INFOS[2];
  if (nx === 0 && ny === -1) return FACE_INFOS[3];
  return FACE_INFOS[0];
}

function chooseFace(faces: readonly FaceInfo[], seed: number, x: number, y: number, slot: number, code: number): FaceInfo | undefined {
  if (faces.length <= 0) return undefined;
  if (faces.length === 1) return faces[0];
  const h = mixHash(seed, x, y, slot, code);
  return faces[h % faces.length];
}

function resolveWallCellFace(world: World, x: number, y: number, def: VisualCellDef, slot: number, seed: number): ResolvedWallFace | null {
  const idx = world.idx(x, y);
  if (!isWallLikeVisualCell(world, idx)) return null;
  const exposed: FaceInfo[] = [];
  for (const face of FACE_INFOS) {
    const ni = world.idx(x + face.nx, y + face.ny);
    if (isPassableVisualCell(world, ni)) exposed.push(face);
  }
  const face = chooseFace(exposed, seed, x, y, slot, def.code);
  return face ? facePosition(world, x, y, face, zForBand(def.zBand)) : null;
}

function resolveAdjacentWallFace(world: World, x: number, y: number, def: VisualCellDef, slot: number, seed: number): ResolvedWallFace | null {
  const idx = world.idx(x, y);
  if (!isPassableVisualCell(world, idx)) return null;
  const exposed: FaceInfo[] = [];
  const walls: Array<{ face: FaceInfo; wallX: number; wallY: number }> = [];
  for (const dir of FACE_INFOS) {
    const wx = x + dir.nx;
    const wy = y + dir.ny;
    const ni = world.idx(wx, wy);
    if (!isWallLikeVisualCell(world, ni)) continue;
    const face = faceFromNormal(-dir.nx, -dir.ny);
    exposed.push(face);
    walls.push({ face, wallX: wx, wallY: wy });
  }
  const face = chooseFace(exposed, seed, x, y, slot, def.code);
  if (!face) return null;
  const wall = walls.find(row => row.face.dir === face.dir);
  return wall ? facePosition(world, wall.wallX, wall.wallY, face, zForBand(def.zBand)) : null;
}

function resolveWallFace(world: World, x: number, y: number, def: VisualCellDef, slot: number, seed: number): ResolvedWallFace | null {
  if (def.source === 'wallCell') return resolveWallCellFace(world, x, y, def, slot, seed);
  if (def.source === 'adjacentWallCell') return resolveAdjacentWallFace(world, x, y, def, slot, seed);
  if (def.source === 'any') {
    const wallFace = resolveWallCellFace(world, x, y, def, slot, seed);
    if (wallFace) return wallFace;
    return resolveAdjacentWallFace(world, x, y, def, slot, seed);
  }
  return null;
}

export function visualCellDefForCode(code: number): VisualCellDef | undefined {
  return visualCellDefByCode(code);
}

interface WorldWithVisualSlots {
  visualSlots?: Uint8Array;
  visualSlotVersion?: number;
}

export function visualSlotsForWorld(world: World): Uint8Array | undefined {
  const slots = (world as WorldWithVisualSlots).visualSlots;
  return slots && slots.length >= W * W * VISUAL_SLOTS_PER_CELL ? slots : undefined;
}

export function visualSlotVersionForWorld(world: World): number {
  return (world as WorldWithVisualSlots).visualSlotVersion ?? 0;
}

export function resolveMeshSceneProfile(context: MeshPassContext): ResolvedMeshSceneProfile {
  const source = context.profile ?? {};
  const mode = context.mode ?? 'medium';
  const budget = VISUAL_GEOMETRY_MODE_BUDGETS[mode] ?? VISUAL_GEOMETRY_MODE_BUDGETS.medium;
  const radius = Math.max(0, Math.min(MAX_DRAW, Math.floor(source.radius ?? budget.radius)));
  const dynamicDrawRadius = context.fogDensity !== undefined && context.fogDensity > 0.0
    ? Math.max(radius, Math.ceil(2.0 / context.fogDensity))
    : radius;
  const meshDrawRadius = Math.max(0, Math.min(MAX_DRAW, Math.floor(dynamicDrawRadius)));
  const proceduralFieldRadius = Math.max(
    0,
    Math.min(MAX_DRAW, Math.floor(source.proceduralFieldRadius ?? budget.proceduralFieldRadius)),
  );
  const instanceCap = Math.max(0, Math.min(4096, Math.floor(source.instanceCap ?? budget.instanceCap)));
  const proceduralFieldInstanceCap = Math.max(
    0,
    Math.min(instanceCap, Math.floor(source.proceduralFieldInstanceCap ?? budget.proceduralFieldInstanceCap)),
  );
  const visualSlotScanCap = Math.max(
    0,
    Math.min(W * W * VISUAL_SLOTS_PER_CELL, Math.floor(source.visualSlotScanCap ?? DEFAULT_VISUAL_SLOT_SCAN_CAP)),
  );
  const visualSlotInstanceCap = Math.max(0, Math.min(instanceCap, Math.floor(source.visualSlotInstanceCap ?? instanceCap)));
  const visualSlotMergeCap = Math.max(0, Math.min(visualSlotInstanceCap, Math.floor(source.visualSlotMergeCap ?? visualSlotInstanceCap)));
  const enabled = mode !== 'off' && source.enabled !== false && radius > 0 && instanceCap > 0;
  const sourceStyle = source.corridorVolumeStyle ?? 'concrete';
  const sourceCoveringId = source.corridorCoveringId
    ?? (sourceStyle === 'organic'
      ? 'meat'
      : sourceStyle === 'service'
        ? 'technical'
        : sourceStyle === 'void'
          ? 'void'
          : 'concrete');
  return {
    enabled,
    radius,
    meshDrawRadius,
    radiusCells: Math.ceil(meshDrawRadius),
    proceduralFieldRadius,
    proceduralFieldInstanceCap,
    instanceCap,
    visualSlotScanCap,
    visualSlotInstanceCap,
    visualSlotMergeCap,
    includeVisualSlots: source.includeVisualSlots !== false,
    includeFeatures: source.includeFeatures !== false,
    includeContainers: source.includeContainers !== false,
    includeEntities: source.includeEntities !== false,
    includeCorridorVolumes: source.includeCorridorVolumes !== false,
    corridorVolumeDetail: Math.max(0, Math.min(1, source.corridorVolumeDetail ?? 0)),
    organicVolumeDetail: Math.max(0, Math.min(1, source.organicVolumeDetail ?? 0)),
    corridorVolumeStyle: sourceStyle,
    corridorCoveringId: sourceCoveringId,
    chunkSize: Math.max(4, Math.min(32, Math.floor(source.chunkSize ?? DEFAULT_CHUNK_SIZE))),
    maxChunksPerFrame: Math.max(1, Math.min(64, Math.floor(source.maxChunksPerFrame ?? DEFAULT_MAX_CHUNKS_PER_FRAME))),
  };
}

function cellInScope(world: World, scope: CellScanScope, x: number, y: number): boolean {
  if (scope.kind === 'chunk') {
    const size = scope.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const cx = (world.wrap(x) / size) | 0;
    const cy = (world.wrap(y) / size) | 0;
    return cx === scope.chunkX && cy === scope.chunkY;
  }
  const dx = wrappedDelta(scope.centerX, x + 0.5);
  const dy = wrappedDelta(scope.centerY, y + 0.5);
  return Math.abs(dx) <= scope.radius + 0.75 && Math.abs(dy) <= scope.radius + 0.75;
}

function visualSlotBase(idx: number): number {
  return idx * VISUAL_SLOTS_PER_CELL;
}

function cellHasVisualCode(slots: Uint8Array, idx: number, code: number): boolean {
  const base = visualSlotBase(idx);
  for (let slot = 0; slot < VISUAL_SLOTS_PER_CELL; slot++) {
    if (slots[base + slot] === code) return true;
  }
  return false;
}

function cellHasAnyVisualSlot(slots: Uint8Array, idx: number): boolean {
  const base = visualSlotBase(idx);
  for (let slot = 0; slot < VISUAL_SLOTS_PER_CELL; slot++) {
    if (slots[base + slot] !== EMPTY_VISUAL_CELL_CODE) return true;
  }
  return false;
}

function earlierSlotHasCode(slots: Uint8Array, idx: number, slot: number, code: number): boolean {
  const base = visualSlotBase(idx);
  for (let i = 0; i < slot; i++) {
    if (slots[base + i] === code) return true;
  }
  return false;
}

function emitInstance(out: MeshInstance[], instance: MeshInstance): void {
  out.push(instance);
}

function contextualVisualModelId(context: MeshPassContext, modelId: string, cellX?: number, cellY?: number): string {
  if (modelId === 'ceiling_bulb' || modelId === 'ceiling_light_panel') {
    const coveringId = context.profile?.corridorCoveringId;
    let isOrganic = coveringId === 'meat' || coveringId === 'cave';

    if (!isOrganic && cellX !== undefined && cellY !== undefined) {
      const idx = context.world.idx(cellX, cellY);
      const wallTex = context.world.wallTex[idx];
      const floorTex = context.world.floorTex[idx];
      isOrganic = wallTex === 20 /* Tex.MEAT */ || wallTex === 41 /* Tex.GUT */ || wallTex === 5 /* Tex.ROTTEN */ ||
                  floorTex === 21 /* Tex.F_MEAT */ || floorTex === 42 /* Tex.F_GUT */;
    }

    if (isOrganic) {
      return 'meat_ceiling_lamp';
    }

    if (coveringId === 'ministry') {
      return 'chandelier_ornate';
    }

    const hash = (cellX !== undefined && cellY !== undefined) ? ((cellX * 73856093) ^ (cellY * 19349663)) : 0;

    if (coveringId === 'residential') {
      return (hash & 1) === 0 ? 'ceiling_bulb' : 'ceiling_light_panel';
    }

    if (coveringId === 'technical' || coveringId === 'collector') {
      return 'ceiling_bulb';
    }

    return (hash & 3) === 0 ? 'ceiling_light_panel' : 'ceiling_bulb';
  }
  return modelId;
}

function visualVolumeScale(modelId: string): { x: number; y: number; z: number } {
  switch (modelId) {
    case 'furniture_table_hint':
    case 'table_slab':
      return { x: 0.82, y: 0.62, z: 0.42 };
    case 'desk_slab':
      return { x: 0.88, y: 0.58, z: 0.48 };
    case 'chair_simple':
      return { x: 0.42, y: 0.42, z: 0.65 };
    case 'bed_frame':
      return { x: 1.05, y: 0.72, z: 0.42 };
    default:
      return { x: 0.78, y: 0.78, z: 1 };
  }
}

function emitVisualInstance(
  context: MeshPassContext,
  def: VisualCellDef,
  x: number,
  y: number,
  slot: number,
  out: MeshInstance[],
  options: {
    face?: ResolvedWallFace;
    length?: number;
    merged?: boolean;
    axis?: Axis;
    sourceX?: number;
    sourceY?: number;
  } = {},
): void {
  const modelId = contextualVisualModelId(context, def.modelId ?? def.id, Math.floor(options.sourceX ?? x), Math.floor(options.sourceY ?? y));
  const face = options.face;
  const length = Math.max(1, options.length ?? 1);
  const axis = options.axis;
  const cellX = Math.floor(options.sourceX ?? x);
  const cellY = Math.floor(options.sourceY ?? y);
  let ix = x + 0.5;
  let iy = y + 0.5;
  let z = zForBand(def.zBand);
  let yaw = 0;
  let scaleX = 1;
  let scaleY = 1;
  let scaleZ = 1;
  let flags = MeshInstanceFlag.VisualSlot;
  if (options.merged) flags |= MeshInstanceFlag.Merged;
  if (def.family === 'lamp') flags |= MeshInstanceFlag.Emissive;
  if (face) {
    ix = face.x;
    iy = face.y;
    z = face.z;
    yaw = face.yaw;
    flags |= MeshInstanceFlag.WallMount;
    scaleX = length;
  } else {
    ix = wrapFloat(ix);
    iy = wrapFloat(iy);
    if (def.mount === 'ceiling') {
      z = 1;
      const ceilingAxis = axis ?? openAxis(context.world, cellX, cellY);
      const roomId = context.world.roomMap[context.world.idx(cellX, cellY)] ?? -1;
      const lane = serviceCeilingLanePosition(context, cellX, cellY, ceilingAxis, length, roomId);
      if (lane && isServiceCeilingModel(modelId)) {
        ix = lane.x;
        iy = lane.y;
      }
      scaleX = ceilingAxis === 'x' ? length : 1;
      scaleY = ceilingAxis === 'y' ? length : 1;
      yaw = ceilingAxis === 'y' ? Math.PI / 2 : 0;
    } else if (def.mount === 'volume') {
      const scale = visualVolumeScale(modelId);
      scaleX = scale.x;
      scaleY = scale.y;
      scaleZ = scale.z;
    } else if (def.merge === 'cluster') {
      const h = mixHash(context.seed, x, y, slot, def.code);
      scaleX = 0.45 + (h & 7) * 0.035;
      scaleY = 0.45 + ((h >>> 4) & 7) * 0.035;
      scaleZ = 0.18 + ((h >>> 8) & 3) * 0.04;
    } else if (def.family === 'clutter') {
      const h = mixHash(context.seed, x, y, slot, def.code);
      const ox = (((h >>> 12) & 255) / 255 - 0.5) * 0.75;
      const oy = (((h >>> 20) & 255) / 255 - 0.5) * 0.75;
      ix += ox;
      iy += oy;
      yaw = (((h >>> 28) & 7) * Math.PI) / 4;
      scaleX = 0.8 + (h & 7) * 0.05;
      scaleY = 0.8 + ((h >>> 4) & 7) * 0.05;
      scaleZ = 0.8 + ((h >>> 8) & 3) * 0.05;
    }
  }
  emitInstance(out, {
    modelId,
    x: wrapFloat(ix),
    y: wrapFloat(iy),
    z,
    yaw,
    scaleX,
    scaleY,
    scaleZ,
    seed: meshInstanceSeed(context.seed, cellX, cellY, def.code, modelId, context.world.roomMap[context.world.idx(cellX, cellY)] ?? -1),
    flags,
  });
}

function compatibleLineNeighbor(
  context: MeshPassContext,
  slots: Uint8Array,
  def: VisualCellDef,
  x: number,
  y: number,
  slot: number,
  dx: number,
  dy: number,
  face?: ResolvedWallFace,
): boolean {
  const world = context.world;
  const nx = world.wrap(x + dx);
  const ny = world.wrap(y + dy);
  const ni = world.idx(nx, ny);
  if (!cellHasVisualCode(slots, ni, def.code)) return false;
  if (!face || def.merge !== 'wallLine') return true;
  const nextFace = resolveWallFace(world, nx, ny, def, slot, context.seed);
  return !!nextFace && nextFace.dir === face.dir && nextFace.tangentAxis === face.tangentAxis;
}

function emitMergedWallLine(
  context: MeshPassContext,
  slots: Uint8Array,
  def: VisualCellDef,
  x: number,
  y: number,
  slot: number,
  scope: CellScanScope,
  out: MeshInstance[],
): void {
  const face = resolveWallFace(context.world, x, y, def, slot, context.seed);
  if (!face) return;
  const prevX = context.world.wrap(x - face.tangentDx);
  const prevY = context.world.wrap(y - face.tangentDy);
  if (
    cellInScope(context.world, scope, prevX, prevY) &&
    compatibleLineNeighbor(context, slots, def, x, y, slot, -face.tangentDx, -face.tangentDy, face)
  ) {
    return;
  }
  let length = 1;
  while (length < MAX_MERGE_RUN) {
    const nx = context.world.wrap(x + face.tangentDx * length);
    const ny = context.world.wrap(y + face.tangentDy * length);
    if (!cellInScope(context.world, scope, nx, ny)) break;
    if (!compatibleLineNeighbor(context, slots, def, x, y, slot, face.tangentDx * length, face.tangentDy * length, face)) break;
    length++;
  }
  const midX = wrapFloat(x + 0.5 + face.tangentDx * ((length - 1) * 0.5));
  const midY = wrapFloat(y + 0.5 + face.tangentDy * ((length - 1) * 0.5));
  const mergedFace = { ...face, x: face.tangentAxis === 'x' ? midX : face.x, y: face.tangentAxis === 'y' ? midY : face.y };
  emitVisualInstance(context, def, x, y, slot, out, { face: mergedFace, length, merged: length > 1 });
}

function chooseLineAxis(context: MeshPassContext, slots: Uint8Array, def: VisualCellDef, x: number, y: number): Axis {
  const world = context.world;
  const horizontal =
    cellHasVisualCode(slots, world.idx(x - 1, y), def.code) ||
    cellHasVisualCode(slots, world.idx(x + 1, y), def.code);
  const vertical =
    cellHasVisualCode(slots, world.idx(x, y - 1), def.code) ||
    cellHasVisualCode(slots, world.idx(x, y + 1), def.code);
  if (horizontal && !vertical) return 'x';
  if (vertical && !horizontal) return 'y';
  return (mixHash(context.seed, x, y, def.code) & 1) === 0 ? 'x' : 'y';
}

function emitMergedLine4(
  context: MeshPassContext,
  slots: Uint8Array,
  def: VisualCellDef,
  x: number,
  y: number,
  slot: number,
  scope: CellScanScope,
  out: MeshInstance[],
): void {
  const world = context.world;
  const idx = world.idx(x, y);
  if (!isPassableVisualCell(world, idx)) return;
  const axis = chooseLineAxis(context, slots, def, x, y);
  const dx = axis === 'x' ? 1 : 0;
  const dy = axis === 'y' ? 1 : 0;
  const prevX = world.wrap(x - dx);
  const prevY = world.wrap(y - dy);
  if (cellInScope(world, scope, prevX, prevY) && cellHasVisualCode(slots, world.idx(prevX, prevY), def.code)) return;
  let length = 1;
  while (length < MAX_MERGE_RUN) {
    const nx = world.wrap(x + dx * length);
    const ny = world.wrap(y + dy * length);
    if (!cellInScope(world, scope, nx, ny)) break;
    const ni = world.idx(nx, ny);
    if (!isPassableVisualCell(world, ni) || !cellHasVisualCode(slots, ni, def.code)) break;
    length++;
  }
  const midX = wrapFloat(x + 0.5 + dx * ((length - 1) * 0.5));
  const midY = wrapFloat(y + 0.5 + dy * ((length - 1) * 0.5));
  emitVisualInstance(context, def, midX - 0.5, midY - 0.5, slot, out, {
    length,
    axis,
    merged: length > 1,
    sourceX: x,
    sourceY: y,
  });
}

function clusterCellValid(context: MeshPassContext, slots: Uint8Array, def: VisualCellDef, x: number, y: number, slot: number): boolean {
  const world = context.world;
  const idx = world.idx(x, y);
  if (!cellHasVisualCode(slots, idx, def.code)) return false;
  if (def.mount === 'wallFace') return !!resolveWallFace(world, x, y, def, slot, context.seed);
  if ((def.source === 'floorCell' || def.source === 'any') && !isPassableVisualCell(world, idx)) return false;
  if (def.source === 'wallCell' && !isWallLikeVisualCell(world, idx)) return false;
  if (def.source === 'adjacentWallCell' && !resolveAdjacentWallFace(world, x, y, def, slot, context.seed)) return false;
  return true;
}

function clusterHasPriorNeighbor(
  context: MeshPassContext,
  slots: Uint8Array,
  def: VisualCellDef,
  x: number,
  y: number,
  slot: number,
  scope: CellScanScope,
): boolean {
  const westX = context.world.wrap(x - 1);
  const northY = context.world.wrap(y - 1);
  return (
    cellInScope(context.world, scope, westX, y) &&
    clusterCellValid(context, slots, def, westX, y, slot)
  ) || (
    cellInScope(context.world, scope, x, northY) &&
    clusterCellValid(context, slots, def, x, northY, slot)
  );
}

function emitMergedCluster(
  context: MeshPassContext,
  slots: Uint8Array,
  def: VisualCellDef,
  x: number,
  y: number,
  slot: number,
  scope: CellScanScope,
  out: MeshInstance[],
): void {
  if (!clusterCellValid(context, slots, def, x, y, slot)) return;
  if (clusterHasPriorNeighbor(context, slots, def, x, y, slot, scope)) return;

  const world = context.world;
  const queueX = new Int16Array(MAX_CLUSTER_CELLS);
  const queueY = new Int16Array(MAX_CLUSTER_CELLS);
  let head = 0;
  let tail = 1;
  let count = 0;
  let sumDx = 0;
  let sumDy = 0;
  queueX[0] = x;
  queueY[0] = y;

  while (head < tail && count < MAX_CLUSTER_CELLS) {
    const cx = world.wrap(queueX[head]);
    const cy = world.wrap(queueY[head]);
    head++;
    let seen = false;
    for (let i = 0; i < count; i++) {
      if (world.wrap(queueX[i]) === cx && world.wrap(queueY[i]) === cy) {
        seen = true;
        break;
      }
    }
    if (seen) continue;
    if (!cellInScope(world, scope, cx, cy) || !clusterCellValid(context, slots, def, cx, cy, slot)) continue;
    queueX[count] = cx;
    queueY[count] = cy;
    sumDx += world.delta(x, cx);
    sumDy += world.delta(y, cy);
    count++;

    const dirs = FACE_INFOS;
    for (const dir of dirs) {
      if (tail >= MAX_CLUSTER_CELLS) break;
      const nx = world.wrap(cx + dir.nx);
      const ny = world.wrap(cy + dir.ny);
      let queued = false;
      for (let i = 0; i < tail; i++) {
        if (world.wrap(queueX[i]) === nx && world.wrap(queueY[i]) === ny) {
          queued = true;
          break;
        }
      }
      if (!queued) {
        queueX[tail] = nx;
        queueY[tail] = ny;
        tail++;
      }
    }
  }

  if (count <= 0) return;
  const before = out.length;
  const emitX = wrapFloat(x + sumDx / count);
  const emitY = wrapFloat(y + sumDy / count);
  emitVisualInstance(context, def, emitX, emitY, slot, out, { merged: count > 1 });
  const instance = out[before];
  if (!instance) return;
  const spread = Math.min(2.6, 0.75 + Math.sqrt(count) * 0.34);
  instance.scaleX *= spread;
  instance.scaleY *= spread;
  if (def.mount === 'volume') instance.scaleZ *= Math.min(1.45, 0.82 + count * 0.08);
  else instance.scaleZ *= Math.min(1.25, 0.9 + count * 0.04);
}

function emitVisualSlot(
  context: MeshPassContext,
  slots: Uint8Array,
  def: VisualCellDef,
  x: number,
  y: number,
  slot: number,
  scope: CellScanScope,
  out: MeshInstance[],
): void {
  if (def.merge === 'wallLine') {
    emitMergedWallLine(context, slots, def, x, y, slot, scope, out);
    return;
  }
  if (def.merge === 'line4') {
    emitMergedLine4(context, slots, def, x, y, slot, scope, out);
    return;
  }
  if (def.merge === 'cluster') {
    emitMergedCluster(context, slots, def, x, y, slot, scope, out);
    return;
  }
  const world = context.world;
  const idx = world.idx(x, y);
  if (def.mount === 'wallFace') {
    const face = resolveWallFace(world, x, y, def, slot, context.seed);
    if (!face) return;
    emitVisualInstance(context, def, x, y, slot, out, { face });
    return;
  }
  if ((def.source === 'floorCell' || def.source === 'any') && !isPassableVisualCell(world, idx)) return;
  emitVisualInstance(context, def, x, y, slot, out);
}

function collectVisualSlotsAtCell(
  context: MeshPassContext,
  slots: Uint8Array | undefined,
  idx: number,
  x: number,
  y: number,
  scope: CellScanScope,
  profile: ResolvedMeshSceneProfile,
  out: MeshInstance[],
  stats?: MeshSceneCollectStats,
): void {
  if (!slots) return;
  const base = visualSlotBase(idx);
  for (let slot = 0; slot < VISUAL_SLOTS_PER_CELL; slot++) {
    const code = slots[base + slot];
    if (code === EMPTY_VISUAL_CELL_CODE) continue;
    if (stats && stats.visualSlotsRead >= profile.visualSlotScanCap) return;
    if (stats) stats.visualSlotsRead++;
    const def = visualCellDefForCode(code);
    if (!def) {
      if (stats) stats.unknownVisualCodes++;
      continue;
    }
    if (earlierSlotHasCode(slots, idx, slot, code)) continue;
    emitVisualSlot(context, slots, def, x, y, slot, scope, out);
  }
}

function deterministicYaw(seed: number, x: number, y: number, salt: number): number {
  return ((mixHash(seed, x, y, salt) & 3) * Math.PI) / 2;
}

function collectFeatureAtCell(context: MeshPassContext, idx: number, x: number, y: number, out: MeshInstance[]): void {
  const feature = context.world.features[idx] as Feature;
  if (feature === Feature.NONE) return;
  const coveredCodes = FEATURE_PRIMARY_VISUAL_CODES[feature];
  const slots = coveredCodes ? visualSlotsForWorld(context.world) : undefined;
  if (slots && coveredCodes?.some(code => cellHasVisualCode(slots, idx, code))) return;
  const def = FEATURE_MESH_DEFS[feature];
  if (!def) return;
  const cell = context.world.cells[idx];
  if (cell !== Cell.FLOOR && cell !== Cell.WATER) {
    if ((def.flags ?? 0) & MeshInstanceFlag.WallMount) {
      const visualDef = VISUAL_CELL_DEFS.find(row => row.modelId === def.modelId && row.mount === 'wallFace');
      const face = visualDef ? resolveWallFace(context.world, x, y, visualDef, 0, context.seed) : null;
      if (!face) return;
      emitInstance(out, {
        modelId: def.modelId,
        x: face.x,
        y: face.y,
        z: def.z,
        yaw: face.yaw,
        scaleX: def.scaleX,
        scaleY: def.scaleY,
        scaleZ: def.scaleZ,
        seed: meshInstanceSeed(context.seed, x, y, feature + 1000, def.modelId, context.world.roomMap[idx] ?? -1),
        flags: MeshInstanceFlag.Feature | MeshInstanceFlag.WallMount | (def.flags ?? 0),
      });
    }
    return;
  }
  emitInstance(out, {
    modelId: def.modelId,
    x: x + 0.5,
    y: y + 0.5,
    z: def.z,
    yaw: deterministicYaw(context.seed, x, y, def.yawSalt),
    scaleX: def.scaleX,
    scaleY: def.scaleY,
    scaleZ: def.scaleZ,
    seed: meshInstanceSeed(context.seed, x, y, feature + 1000, def.modelId, context.world.roomMap[idx] ?? -1),
    flags: MeshInstanceFlag.Feature | (def.flags ?? 0),
  });
}

function containerModelDef(container: WorldContainer): FeatureMeshDef {
  switch (container.kind) {
    case ContainerKind.CASHBOX:
    case ContainerKind.SECRET_STASH:
      return { modelId: 'container_small_box', priority: 76, z: 0, scaleX: 0.44, scaleY: 0.34, scaleZ: 0.28, yawSalt: 41 };
    case ContainerKind.TRASH_BIN:
      return { modelId: 'trash_bin', priority: 56, z: 0, scaleX: 0.44, scaleY: 0.44, scaleZ: 0.68, yawSalt: 42 };
    case ContainerKind.FRIDGE:
    case ContainerKind.SAFE:
    case ContainerKind.METAL_CABINET:
    case ContainerKind.MEDICAL_CABINET:
    case ContainerKind.FILING_CABINET:
    case ContainerKind.TOOL_LOCKER:
      return { modelId: 'container_tall_cabinet', priority: 70, z: 0, scaleX: 0.62, scaleY: 0.5, scaleZ: 0.96, yawSalt: 43 };
    default:
      return { modelId: 'container_crate', priority: 62, z: 0, scaleX: 0.58, scaleY: 0.5, scaleZ: 0.46, yawSalt: 44 };
  }
}

function collectContainersAtCell(context: MeshPassContext, idx: number, x: number, y: number, out: MeshInstance[]): void {
  const ids = context.world.containerMap.get(idx);
  if (!ids) return;
  for (const id of ids) {
    const container = context.world.containerById.get(id);
    if (!container || (container.access === 'secret' && !container.discovered)) continue;
    const def = containerModelDef(container);
    emitInstance(out, {
      modelId: def.modelId,
      x: x + 0.5,
      y: y + 0.5,
      z: def.z,
      yaw: deterministicYaw(context.seed, x, y, def.yawSalt + container.id),
      scaleX: def.scaleX,
      scaleY: def.scaleY,
      scaleZ: def.scaleZ,
      seed: meshInstanceSeed(context.seed, x, y, container.id + 2000, def.modelId, container.roomId),
      flags: MeshInstanceFlag.Container,
    });
  }
}

function numericProfileDetail(
  context: MeshPassContext,
  key: 'ceilingDetail' | 'furnitureDetail' | 'corridorVolumeDetail' | 'organicVolumeDetail',
): number {
  const value = (context.profile as {
    ceilingDetail?: number;
    furnitureDetail?: number;
    corridorVolumeDetail?: number;
    organicVolumeDetail?: number;
  } | null | undefined)?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function corridorVolumeStyle(context: MeshPassContext): VisualCorridorVolumeStyle {
  const value = (context.profile as { corridorVolumeStyle?: unknown } | null | undefined)?.corridorVolumeStyle;
  return value === 'service' || value === 'organic' || value === 'void' ? value : 'concrete';
}

function corridorCovering(context: MeshPassContext, profile?: ResolvedMeshSceneProfile): VisualCorridorCoveringDef {
  const explicit = profile?.corridorCoveringId ?? context.profile?.corridorCoveringId;
  if (explicit) return visualCorridorCoveringById(explicit);
  const style = profile?.corridorVolumeStyle ?? corridorVolumeStyle(context);
  if (style === 'organic') return visualCorridorCoveringById('meat');
  if (style === 'service') return visualCorridorCoveringById('technical');
  if (style === 'void') return visualCorridorCoveringById('void');
  return visualCorridorCoveringById('concrete');
}

function roomForCell(world: World, idx: number): Room | undefined {
  const roomId = world.roomMap[idx] ?? -1;
  if (roomId < 0) return undefined;
  return world.rooms[roomId];
}

function localRoomCoord(room: { x: number; y: number; w: number; h: number }, x: number, y: number): { lx: number; ly: number } | null {
  const lx = x - room.x;
  const ly = y - room.y;
  if (lx < 0 || ly < 0 || lx >= room.w || ly >= room.h) return null;
  return { lx, ly };
}

function doorNear(world: World, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const idx = world.idx(x + dx, y + dy);
      if (world.cells[idx] === Cell.DOOR || world.doors.has(idx)) return true;
    }
  }
  return false;
}

function openAxis(world: World, x: number, y: number): Axis {
  const eastWest = isPassableVisualCell(world, world.idx(x + 1, y)) || isPassableVisualCell(world, world.idx(x - 1, y));
  const northSouth = isPassableVisualCell(world, world.idx(x, y + 1)) || isPassableVisualCell(world, world.idx(x, y - 1));
  if (eastWest && !northSouth) return 'x';
  if (northSouth && !eastWest) return 'y';
  return (x ^ y) & 1 ? 'y' : 'x';
}

function localTopologyCounts(world: World, x: number, y: number): { passable: number; wallLike: number } {
  let passable = 0;
  let wallLike = 0;
  for (const dir of FACE_INFOS) {
    const idx = world.idx(x + dir.nx, y + dir.ny);
    if (isPassableVisualCell(world, idx)) passable++;
    else if (isWallLikeVisualCell(world, idx)) wallLike++;
  }
  return { passable, wallLike };
}

function adjacentWallFaces(world: World, x: number, y: number, z: number): ResolvedWallFace[] {
  const out: ResolvedWallFace[] = [];
  for (const dir of FACE_INFOS) {
    const wx = x + dir.nx;
    const wy = y + dir.ny;
    const idx = world.idx(wx, wy);
    if (!isWallLikeVisualCell(world, idx)) continue;
    out.push(facePosition(world, wx, wy, faceFromNormal(-dir.nx, -dir.ny), z));
  }
  return out;
}

function smoothStep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hashUnit(seed: number, x: number, y: number, roomId: number, salt: number): number {
  return ((mixHash(seed ^ salt, x, y, roomId, salt) >>> 8) & 1023) / 1023;
}

function valueNoise2d(seed: number, x: number, y: number, roomId: number, salt: number, scale: number): number {
  const safeScale = Math.max(1, scale);
  const gx = Math.floor(x / safeScale);
  const gy = Math.floor(y / safeScale);
  const fx = smoothStep(x / safeScale - gx);
  const fy = smoothStep(y / safeScale - gy);
  const a = hashUnit(seed, gx, gy, roomId, salt);
  const b = hashUnit(seed, gx + 1, gy, roomId, salt);
  const c = hashUnit(seed, gx, gy + 1, roomId, salt);
  const d = hashUnit(seed, gx + 1, gy + 1, roomId, salt);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

function corridorNoise(seed: number, x: number, y: number, roomId: number, salt: number): number {
  const micro = valueNoise2d(seed, x + 0.37, y + 0.61, roomId, salt, 1.7);
  const meso = valueNoise2d(seed, x + 1.13, y + 0.29, roomId, salt ^ 0x4f1bbcdc, 4.5);
  const grain = hashUnit(seed, x, y, roomId, salt ^ 0x9e3779b9);
  return grain * 0.34 + micro * 0.42 + meso * 0.24;
}

function corridorRunNoise(seed: number, x: number, y: number, roomId: number, salt: number): number {
  const broad = valueNoise2d(seed, x + 0.11, y + 0.83, roomId, salt ^ 0x736372, 6.5);
  const meso = valueNoise2d(seed, x + 1.71, y + 0.47, roomId, salt ^ 0x706970, 3.25);
  const grain = hashUnit(seed, x, y, roomId, salt ^ 0x636f6e);
  return broad * 0.44 + meso * 0.4 + grain * 0.16;
}

function corridorContextSalt(context: MeshPassContext, salt: number): number {
  return salt ^ stringHash(context.floorKey) ^ stringHash(context.profile?.corridorCoveringId ?? '');
}

function signedHash(seed: number, x: number, y: number, roomId: number, salt: number): number {
  return corridorNoise(seed, x, y, roomId, salt) * 2 - 1;
}

function selectStableFieldCoverage<T extends StableFieldCandidate>(
  candidates: readonly T[],
  cap: number,
  radius: number,
): T[] {
  const limit = Math.max(0, Math.floor(cap));
  if (limit <= 0 || candidates.length <= 0) return [];
  if (candidates.length <= limit) return [...candidates];
  const safeRadius = Math.max(0.001, radius);
  const buckets: T[][] = Array.from({ length: FIELD_COVERAGE_RING_COUNT }, () => []);
  for (const candidate of candidates) {
    const distance = Math.sqrt(Math.max(0, candidate.d2));
    const ring = Math.min(
      FIELD_COVERAGE_RING_COUNT - 1,
      Math.max(0, Math.floor((distance / safeRadius) * FIELD_COVERAGE_RING_COUNT)),
    );
    buckets[ring].push(candidate);
  }
  for (const bucket of buckets) {
    bucket.sort((a, b) => a.seed - b.seed || a.d2 - b.d2);
  }
  const selected: T[] = [];
  const cursors = new Uint16Array(FIELD_COVERAGE_RING_COUNT);
  while (selected.length < limit) {
    let advanced = false;
    for (let ring = 0; ring < FIELD_COVERAGE_RING_COUNT && selected.length < limit; ring++) {
      const bucket = buckets[ring];
      const cursor = cursors[ring];
      if (cursor >= bucket.length) continue;
      selected.push(bucket[cursor]);
      cursors[ring] = cursor + 1;
      advanced = true;
    }
    if (!advanced) break;
  }
  return selected;
}

function corridorVolumeCellEligible(context: MeshPassContext, idx: number, x: number, y: number): boolean {
  const world = context.world;
  if (!isPassableVisualCell(world, idx) || doorNear(world, x, y)) return false;
  const counts = localTopologyCounts(world, x, y);
  if (counts.wallLike <= 0) return false;
  const room = roomForCell(world, idx);
  const style = corridorVolumeStyle(context);
  if (room?.type === RoomType.CORRIDOR) return true;
  if (style === 'organic') return true;
  if (!room) return counts.wallLike >= 2 && counts.passable <= 2;
  return (room.w <= 3 || room.h <= 3) && counts.wallLike >= 1;
}

function weightedCorridorWallModel(context: MeshPassContext, covering: VisualCorridorCoveringDef, x: number, y: number, h: number): VisualModelId {
  const idx = context.world.idx(x, y);
  const wallTex = context.world.wallTex[idx];
  
  // Overrides based on wall texture
  const isOrganicTex = wallTex === 20 /* Tex.MEAT */ || wallTex === 41 /* Tex.GUT */ || wallTex === 5 /* Tex.ROTTEN */;
  const isPipeTex = wallTex === 18 /* Tex.PIPE */;

  const roll = ((h >>> 9) & 1023) / 1023;
  let cursor = 0;

  if (isOrganicTex) {
    cursor += covering.weights.bulge;
    if (roll < cursor) return 'organic_wall_bulge';
    cursor += covering.weights.fold;
    if (roll < cursor) return 'meat_wall_fold';
    cursor += covering.weights.stalactite;
    if (roll < cursor) return 'cave_wall_protrusion';
  } else if (!isPipeTex) {
    cursor += covering.weights.ledge;
    if (roll < cursor) return 'corridor_side_ledge';
    cursor += covering.weights.pipe;
    if (roll < cursor) return 'pipe_wall_large';
    cursor += covering.weights.cable;
    if (roll < cursor) return 'cable_wall_loose';
    cursor += covering.weights.bulge;
    if (roll < cursor) return 'organic_wall_bulge';
    cursor += covering.weights.fold;
    if (roll < cursor) return 'meat_wall_fold';
    cursor += covering.weights.stalactite;
    if (roll < cursor) return 'cave_wall_protrusion';
  }
  
  return corridorReliefVariant(covering, h);
}

function corridorReliefVariant(covering: VisualCorridorCoveringDef, h: number): VisualModelId {
  const selector = (h >>> 21) & 15;
  const reliefSet = covering.wallReliefSet ?? 'concrete';
  
  if (reliefSet === 'organic') {
    return covering.id === 'cave' ? 'cave_wall_protrusion' : 'organic_wall_bulge';
  }
  if (reliefSet === 'pipe') {
    return 'pipe_wall_large';
  }
  if (reliefSet === 'technical') {
    if (selector <= 3) return 'wall_panel_flat';
    if (selector <= 5) return 'wall_panel_screen';
    if (selector <= 7) return 'button_panel';
  }
  if (reliefSet === 'concrete' && selector <= 2) return 'wall_panel_flat';
  return 'corridor_wall_relief';
}

function corridorCoverageGate(seed: number, x: number, y: number, roomId: number, salt: number, detail: number, weight: number): boolean {
  if (detail <= 0 || weight <= 0) return false;
  const value = corridorNoise(seed, x, y, roomId, salt);
  return value <= Math.min(0.86, detail * weight);
}

function corridorRunCoverageGate(seed: number, x: number, y: number, roomId: number, salt: number, detail: number, weight: number): boolean {
  if (detail <= 0 || weight <= 0) return false;
  const value = corridorRunNoise(seed, x, y, roomId, salt);
  return value <= Math.min(0.82, detail * weight);
}

function corridorVolumeCellAvailable(context: MeshPassContext, idx: number, x: number, y: number): boolean {
  const world = context.world;
  if (world.features[idx] !== Feature.NONE || world.containerMap.has(idx)) return false;
  const slots = visualSlotsForWorld(world);
  if (slots && cellHasAnyVisualSlot(slots, idx)) return false;
  return corridorVolumeCellEligible(context, idx, x, y);
}

function emitCorridorWallVolume(
  context: MeshPassContext,
  idx: number,
  x: number,
  y: number,
  covering: VisualCorridorCoveringDef,
  detail: number,
  out: MeshInstance[],
): void {
  const world = context.world;
  const style = covering.style;
  const faces = adjacentWallFaces(world, x, y, style === 'organic' ? 0.58 : 0.5);
  if (faces.length <= 0) return;
  const roomId = world.roomMap[idx] ?? -1;
  const h = mixHash(context.seed, x, y, roomId, 0x766f6c);
  const wallBaseWeight = covering.weights.ledge + covering.weights.pipe + covering.weights.cable + covering.weights.bulge + covering.weights.fold + covering.weights.stalactite;
  const wallWeight = covering.weights.relief + wallBaseWeight;
  if (!corridorCoverageGate(context.seed, x, y, roomId, 0x77616c, detail, style === 'organic' ? wallWeight * 0.8 : wallWeight * 0.58)) return;
  const face = faces[h % faces.length];
  const isOrganicTex = world.wallTex[idx] === 20 /* Tex.MEAT */ || world.wallTex[idx] === 41 /* Tex.GUT */ || world.wallTex[idx] === 5 /* Tex.ROTTEN */;
  const organic = style === 'organic' || covering.id === 'meat' || covering.id === 'cave' || isOrganicTex;
  const modelId = weightedCorridorWallModel(context, covering, x, y, h);
  const tangentJitter = signedHash(context.seed, x, y, roomId, 0x6a6974 ^ h) * (organic ? 0.14 : 0.11);
  const ix = wrapFloat(face.x + face.tangentDx * tangentJitter);
  const iy = wrapFloat(face.y + face.tangentDy * tangentJitter);
  const isServiceRun = modelId === 'pipe_wall_large' || modelId === 'cable_wall_loose';
  const isWallDevice = modelId === 'wall_panel_flat' || modelId === 'wall_panel_screen' || modelId === 'button_panel';
  const length = isServiceRun
    ? 0.84 + ((h >>> 20) & 3) * 0.055
    : isWallDevice
      ? 0.58 + ((h >>> 20) & 3) * 0.025
    : modelId === 'corridor_side_ledge'
      ? 0.68 + ((h >>> 20) & 3) * 0.035
      : organic
        ? (covering.id === 'meat' ? 1.8 : 1.18) + ((h >>> 20) & 3) * 0.08
        : 0.72 + ((h >>> 20) & 3) * 0.03;
  const depthScale = isServiceRun ? 0.48 : isWallDevice ? 0.32 : organic ? 0.54 + covering.smoothness * 0.08 : 0.46;
  const heightScale = isWallDevice
    ? 0.38 + ((h >>> 26) & 3) * 0.01
    : organic
      ? (covering.id === 'meat' ? 1.0 : 0.82) + covering.smoothness * 0.12 + ((h >>> 26) & 3) * 0.035
      : 0.74 + ((h >>> 26) & 3) * 0.025;
  emitInstance(out, {
    modelId,
    x: ix,
    y: iy,
    z: organic ? 0.22 + covering.smoothness * 0.08 + ((h >>> 24) & 3) * 0.02 : 0.2 + ((h >>> 24) & 3) * 0.025,
    yaw: face.yaw,
    scaleX: length,
    scaleY: depthScale,
    scaleZ: heightScale,
    seed: meshInstanceSeed(context.seed, x, y, 0x766f6c, modelId, roomId),
    flags: MeshInstanceFlag.CorridorVolume | MeshInstanceFlag.WallMount |
      (modelId === 'wall_panel_screen' || modelId === 'button_panel' ? MeshInstanceFlag.Emissive : 0),
  });
}

function emitCorridorThreshold(
  context: MeshPassContext,
  idx: number,
  x: number,
  y: number,
  covering: VisualCorridorCoveringDef,
  detail: number,
  organicDetail: number,
  out: MeshInstance[],
): void {
  if (detail <= 0) return;
  const world = context.world;
  const roomId = world.roomMap[idx] ?? -1;
  const h = mixHash(context.seed, x, y, roomId, 0x746872);
  const gutter = corridorCoverageGate(context.seed, x, y, roomId, 0x677574, detail, covering.weights.gutter * 0.72);
  const threshold = corridorCoverageGate(context.seed, x, y, roomId, 0x746872, detail, covering.weights.threshold * 0.9);
  const organicFloorWeight = covering.weights.bulge + covering.weights.fold;
  const organicFloor = covering.style === 'organic' &&
    corridorCoverageGate(context.seed, x, y, roomId, 0x666c64, organicDetail, organicFloorWeight * 0.72);
  if (!gutter && !threshold && !organicFloor) return;
  const axis = openAxis(world, x, y);
  const modelId = organicFloor ? 'meat_floor_fold' : gutter ? 'collector_gutter' : 'corridor_floor_threshold';
  const floorFaces = organicFloor ? adjacentWallFaces(world, x, y, 0) : [];
  const face = floorFaces.length > 0 ? floorFaces[h % floorFaces.length] : undefined;
  const tangentJitter = signedHash(context.seed, x, y, roomId, 0x666a74 ^ h) * 0.15;
  const edgeInset = organicFloor ? 0.08 : 0;
  const ix = face ? wrapFloat(face.x + face.nx * edgeInset + face.tangentDx * tangentJitter) : x + 0.5;
  const iy = face ? wrapFloat(face.y + face.ny * edgeInset + face.tangentDy * tangentJitter) : y + 0.5;
  emitInstance(out, {
    modelId,
    x: ix,
    y: iy,
    z: 0,
    yaw: face ? face.yaw : axis === 'y' ? Math.PI * 0.5 : 0,
    scaleX: organicFloor ? 1.55 + ((h >>> 18) & 3) * 0.08 : gutter ? 0.74 + ((h >>> 18) & 3) * 0.035 : 0.46 + ((h >>> 18) & 3) * 0.025,
    scaleY: organicFloor ? 1.08 : gutter ? 0.72 : 0.46,
    scaleZ: organicFloor ? 0.95 + ((h >>> 23) & 3) * 0.045 : 0.5,
    seed: meshInstanceSeed(context.seed, x, y, 0x746872, modelId, roomId),
    flags: MeshInstanceFlag.CorridorVolume,
  });
}

function isServiceCeilingModel(modelId: string): boolean {
  return modelId === 'ceiling_pipe_bundle' ||
    modelId === 'ceiling_cable_bundle' ||
    modelId === 'ceiling_cable';
}

function serviceCeilingGate(
  context: MeshPassContext,
  idx: number,
  x: number,
  y: number,
  covering: VisualCorridorCoveringDef,
  detail: number,
  axis: Axis,
): boolean {
  if (covering.style !== 'service') return false;
  if (!corridorVolumeCellAvailable(context, idx, x, y)) return false;
  if (openAxis(context.world, x, y) !== axis) return false;
  if (covering.id === 'collector') return detail > 0;
  const roomId = context.world.roomMap[idx] ?? -1;
  const salt = corridorContextSalt(context, 0x636570 ^ (axis === 'x' ? 0x7811 : 0x7911));
  const weight = covering.weights.pipe + covering.weights.cable;
  return corridorRunCoverageGate(context.seed, x, y, roomId, salt, detail, weight);
}

function serviceCeilingRunLength(
  context: MeshPassContext,
  x: number,
  y: number,
  covering: VisualCorridorCoveringDef,
  detail: number,
  axis: Axis,
): number {
  const dx = axis === 'x' ? 1 : 0;
  const dy = axis === 'y' ? 1 : 0;
  let length = 1;
  while (length < MAX_CORRIDOR_CEILING_RUN) {
    const nx = context.world.wrap(x + dx * length);
    const ny = context.world.wrap(y + dy * length);
    const ni = context.world.idx(nx, ny);
    if (!serviceCeilingGate(context, ni, nx, ny, covering, detail, axis)) break;
    length++;
  }
  return length;
}

function serviceCeilingRunCoord(context: MeshPassContext, x: number, y: number, axis: Axis): number {
  const room = roomForCell(context.world, context.world.idx(x, y));
  if (room) {
    const local = localRoomCoord(room, x, y);
    if (local) return axis === 'x' ? local.lx : local.ly;
  }
  return axis === 'x' ? x : y;
}

function positiveModulo(value: number, mod: number): number {
  return ((value % mod) + mod) % mod;
}

function serviceCeilingRunSegmentStart(
  context: MeshPassContext,
  x: number,
  y: number,
  axis: Axis,
  covering: VisualCorridorCoveringDef,
  roomId: number,
): boolean {
  const coord = serviceCeilingRunCoord(context, x, y, axis);
  const phase = covering.id === 'collector'
    ? 0
    : mixHash(context.seed, roomId, axis === 'x' ? 0x7861 : 0x7961, corridorContextSalt(context, 0x736567)) % MAX_CORRIDOR_CEILING_RUN;
  return positiveModulo(coord - phase, MAX_CORRIDOR_CEILING_RUN) === 0;
}

function serviceCeilingLateralRoomWidth(world: World, x: number, y: number, axis: Axis): number {
  const room = roomForCell(world, world.idx(x, y));
  if (!room) return 1;
  return axis === 'x' ? Math.max(1, room.h) : Math.max(1, room.w);
}

function serviceCeilingPathOffset(
  context: MeshPassContext,
  x: number,
  y: number,
  axis: Axis,
  length: number,
  roomId: number,
): number {
  const longitudinalMid = axis === 'x' ? x + (length - 1) * 0.5 : y + (length - 1) * 0.5;
  const cross = axis === 'x' ? y : x;
  const laneSalt = corridorContextSalt(context, 0x706174 ^ (axis === 'x' ? 0x786c : 0x796c));
  const driftSalt = corridorContextSalt(context, 0x647266 ^ (axis === 'x' ? 0x7864 : 0x7964));
  const lane = valueNoise2d(context.seed, longitudinalMid, cross + roomId * 0.17, roomId, laneSalt, 9.5) * 2 - 1;
  const drift = valueNoise2d(context.seed, longitudinalMid + 2.3, cross + 5.1, roomId, driftSalt, 3.75) * 2 - 1;
  const roomWidth = serviceCeilingLateralRoomWidth(context.world, x, y, axis);
  const laneRange = Math.min(0.42, Math.max(0.12, roomWidth * 0.18));
  return Math.max(-laneRange, Math.min(laneRange, lane * laneRange + drift * laneRange * 0.22));
}

function serviceCeilingLaneFaces(world: World, x: number, y: number, axis: Axis): ResolvedWallFace[] {
  return adjacentWallFaces(world, x, y, 1).filter(face => face.tangentAxis === axis);
}

function serviceCeilingLanePosition(
  context: MeshPassContext,
  x: number,
  y: number,
  axis: Axis,
  length: number,
  roomId: number,
): { x: number; y: number } | null {
  const dx = axis === 'x' ? 1 : 0;
  const dy = axis === 'y' ? 1 : 0;
  const tangentMid = (length - 1) * 0.5;
  const faces = serviceCeilingLaneFaces(context.world, x, y, axis);
  if (faces.length > 0) {
    const laneSalt = corridorContextSalt(context, 0x6c616e ^ (axis === 'x' ? 0x7866 : 0x7966));
    const driftSalt = corridorContextSalt(context, 0x696e73 ^ (axis === 'x' ? 0x7869 : 0x7969));
    const laneCoord = axis === 'x' ? x + tangentMid : y + tangentMid;
    const crossCoord = axis === 'x' ? y : x;
    const strip = Math.floor(crossCoord);
    const selectorValue = hashUnit(context.seed, roomId, strip, axis === 'x' ? 0x7866 : 0x7966, laneSalt);
    const selector = Math.min(
      faces.length - 1,
      Math.floor(selectorValue * faces.length),
    );
    const face = faces[Math.max(0, selector)];
    const insetNoise = valueNoise2d(context.seed, laneCoord + 1.7, crossCoord + roomId * 0.11, roomId, driftSalt, 22);
    const inset = 0.095 + insetNoise * 0.07;
    return {
      x: wrapFloat(face.x + face.tangentDx * tangentMid + face.nx * inset),
      y: wrapFloat(face.y + face.tangentDy * tangentMid + face.ny * inset),
    };
  }

  const laneOffset = serviceCeilingPathOffset(context, x, y, axis, length, roomId);
  return {
    x: wrapFloat(x + 0.5 + dx * tangentMid + (axis === 'y' ? laneOffset : 0)),
    y: wrapFloat(y + 0.5 + dy * tangentMid + (axis === 'x' ? laneOffset : 0)),
  };
}

function emitCorridorCeilingVolume(
  context: MeshPassContext,
  idx: number,
  x: number,
  y: number,
  covering: VisualCorridorCoveringDef,
  organicDetail: number,
  out: MeshInstance[],
): void {
  const world = context.world;
  const roomId = world.roomMap[idx] ?? -1;
  const h = mixHash(context.seed, x, y, roomId, 0x737461);
  const axis = openAxis(world, x, y);
  const serviceDetail = organicDetail;
  const serviceCeiling = serviceCeilingGate(context, idx, x, y, covering, serviceDetail, axis);
  if (serviceCeiling) {
    const dx = axis === 'x' ? 1 : 0;
    const dy = axis === 'y' ? 1 : 0;
    const px = world.wrap(x - dx);
    const py = world.wrap(y - dy);
    const pi = world.idx(px, py);
    if (
      serviceCeilingGate(context, pi, px, py, covering, serviceDetail, axis) &&
      !serviceCeilingRunSegmentStart(context, x, y, axis, covering, roomId)
    ) return;

    const length = serviceCeilingRunLength(context, x, y, covering, serviceDetail, axis);
    const modelId: VisualModelId = ((h >>> 19) & 1) === 0 ? 'ceiling_pipe_bundle' : 'ceiling_cable_bundle';
    const lane = serviceCeilingLanePosition(context, x, y, axis, length, roomId);
    emitInstance(out, {
      modelId,
      x: lane?.x ?? x + 0.5,
      y: lane?.y ?? y + 0.5,
      z: 1,
      yaw: axis === 'y' ? Math.PI * 0.5 : 0,
      scaleX: Math.max(1.05, length * (1 + ((h >>> 20) & 1) * 0.012)),
      scaleY: covering.id === 'collector' ? 0.62 : 0.52,
      scaleZ: 0.52,
      seed: meshInstanceSeed(context.seed, x, y, 0x737461, modelId, roomId),
      flags: MeshInstanceFlag.CorridorVolume,
    });
    return;
  }

  const organicCeilingWeight = covering.weights.stalactite;
  const organicCeiling = corridorCoverageGate(context.seed, x, y, roomId, 0x737461, organicDetail, organicCeilingWeight);
  if (!organicCeiling) return;
  const modelId: VisualModelId = organicCeiling
    ? (covering.id === 'cave' ? 'cave_stalactite' : 'organic_stalactite')
    : 'organic_stalactite';
  const ix = x + 0.5 + ((((h >>> 17) & 15) - 7.5) / 15) * 0.18;
  const iy = y + 0.5 + ((((h >>> 21) & 15) - 7.5) / 15) * 0.18;
  emitInstance(out, {
    modelId,
    x: ix,
    y: iy,
    z: 1,
    yaw: ((h >>> 25) & 3) * Math.PI * 0.5,
    scaleX: covering.id === 'meat' ? 0.62 + (h & 7) * 0.035 : 0.42 + (h & 7) * 0.025,
    scaleY: covering.id === 'meat' ? 0.58 + ((h >>> 3) & 7) * 0.03 : 0.4 + ((h >>> 3) & 7) * 0.025,
    scaleZ: covering.id === 'meat' ? 0.56 + ((h >>> 6) & 7) * 0.045 : 0.38 + ((h >>> 6) & 7) * 0.035,
    seed: meshInstanceSeed(context.seed, x, y, 0x737461, modelId, roomId),
    flags: MeshInstanceFlag.CorridorVolume,
  });
}

function collectCorridorVolumeAtCell(
  context: MeshPassContext,
  idx: number,
  x: number,
  y: number,
  profile: ResolvedMeshSceneProfile,
  out: MeshInstance[],
): void {
  if (!profile.includeCorridorVolumes || profile.corridorVolumeDetail <= 0) return;
  if (!corridorVolumeCellAvailable(context, idx, x, y)) return;
  const covering = corridorCovering(context, profile);
  const detail = covering.style === 'void' ? profile.corridorVolumeDetail * 0.55 : profile.corridorVolumeDetail;
  emitCorridorWallVolume(context, idx, x, y, covering, detail, out);
  emitCorridorThreshold(context, idx, x, y, covering, detail, Math.max(detail, profile.organicVolumeDetail), out);
  emitCorridorCeilingVolume(context, idx, x, y, covering, Math.max(detail, profile.organicVolumeDetail), out);
}

function pipeNetworkEnabled(profile: ResolvedMeshSceneProfile, covering: VisualCorridorCoveringDef): boolean {
  return profile.includeCorridorVolumes &&
    profile.corridorVolumeDetail > 0 &&
    covering.style === 'service' &&
    (covering.id === 'collector' || covering.id === 'technical');
}

function pipeNetworkLayerCount(context: MeshPassContext, covering: VisualCorridorCoveringDef): number {
  const mode = context.mode ?? 'medium';
  const base = mode === 'high' ? 4 : mode === 'medium' ? 3 : 2;
  return covering.id === 'collector' ? base : Math.max(1, base - 1);
}

function pipeNetworkCap(profile: ResolvedMeshSceneProfile): number {
  return profile.proceduralFieldInstanceCap;
}

function pipeNetworkNode(context: MeshPassContext, gx: number, gy: number, layer: number): { x: number; y: number } {
  const salt = corridorContextSalt(context, 0x706e64 ^ (layer * 0x45d9f3));
  const ox = 0.16 + hashUnit(context.seed, gx, gy, layer, salt) * 0.68;
  const oy = 0.16 + hashUnit(context.seed, gx, gy, layer, salt ^ 0x6e6f64) * 0.68;
  return { x: wrapFloat(gx + ox), y: wrapFloat(gy + oy) };
}

function pipeNetworkEdgeGate(
  context: MeshPassContext,
  gx: number,
  gy: number,
  layer: number,
  axis: Axis,
  covering: VisualCorridorCoveringDef,
  detail: number,
): boolean {
  const strip = axis === 'x' ? gy : gx;
  const mainSalt = corridorContextSalt(context, 0x706d61 ^ (axis === 'x' ? 0x786d : 0x796d));
  const branchSalt = corridorContextSalt(context, 0x706272 ^ (axis === 'x' ? 0x7862 : 0x7962));
  const mainDensity = (covering.id === 'collector' ? 0.7 : 0.42) * (0.45 + detail * 0.7);
  const branchDensity = (covering.id === 'collector' ? 0.26 : 0.12) * (0.4 + detail * 0.8);
  const main = hashUnit(context.seed, strip, layer, covering.id === 'collector' ? 1 : 2, mainSalt) < mainDensity;
  const branch = hashUnit(context.seed, gx, gy, layer, branchSalt) < branchDensity;
  return main || branch;
}

function pipeNetworkModelId(context: MeshPassContext, gx: number, gy: number, layer: number, axis: Axis): VisualModelId {
  const h = mixHash(context.seed, gx, gy, layer, axis === 'x' ? 0x787069 : 0x797069);
  if (layer % 3 === 2 || (h & 7) === 0) return 'ceiling_cable';
  if (layer % 3 === 1 || (h & 3) === 0) return 'ceiling_cable_bundle';
  return 'ceiling_pipe_bundle';
}

function addPipeNetworkEdgeCandidate(
  context: MeshPassContext,
  candidates: PipeNetworkCandidate[],
  centerX: number,
  centerY: number,
  gx: number,
  gy: number,
  layer: number,
  axis: Axis,
  covering: VisualCorridorCoveringDef,
  detail: number,
  r2: number,
): void {
  if (!pipeNetworkEdgeGate(context, gx, gy, layer, axis, covering, detail)) return;
  const a = pipeNetworkNode(context, gx, gy, layer);
  const b = axis === 'x'
    ? pipeNetworkNode(context, gx + 1, gy, layer)
    : pipeNetworkNode(context, gx, gy + 1, layer);
  const dx = wrappedDelta(a.x, b.x);
  const dy = wrappedDelta(a.y, b.y);
  const length = Math.hypot(dx, dy);
  if (length < 0.42 || length > 1.75) return;
  const x = wrapFloat(a.x + dx * 0.5);
  const y = wrapFloat(a.y + dy * 0.5);
  const cdx = wrappedDelta(centerX, x);
  const cdy = wrappedDelta(centerY, y);
  const d2 = cdx * cdx + cdy * cdy;
  if (d2 > r2) return;
  const h = mixHash(context.seed, gx, gy, layer, axis === 'x' ? 0x706878 : 0x706879);
  candidates.push({
    modelId: pipeNetworkModelId(context, gx, gy, layer, axis),
    x,
    y,
    yaw: Math.atan2(dy, dx),
    length: length * (0.92 + ((h >>> 12) & 3) * 0.018),
    z: 1 - layer * 0.026 - ((h >>> 8) & 3) * 0.006,
    scaleY: covering.id === 'collector' ? 0.42 + layer * 0.035 : 0.34 + layer * 0.03,
    scaleZ: covering.id === 'collector' ? 0.48 + layer * 0.04 : 0.38 + layer * 0.035,
    seed: meshInstanceSeed(context.seed, gx, gy, 0x706970 + layer, 'ceiling_pipe_bundle'),
    d2,
  });
}

function collectProceduralCeilingPipeNetwork(
  context: MeshPassContext,
  profile: ResolvedMeshSceneProfile,
  out: MeshInstance[],
): void {
  const covering = corridorCovering(context, profile);
  if (!pipeNetworkEnabled(profile, covering)) return;
  const cap = pipeNetworkCap(profile);
  if (cap <= 0) return;
  const radius = Math.max(2, Math.ceil(profile.proceduralFieldRadius));
  const cx = Math.floor(context.camera.x);
  const cy = Math.floor(context.camera.y);
  const center = cameraCellCenter(context);
  const r2 = profile.proceduralFieldRadius * profile.proceduralFieldRadius;
  const detail = profile.corridorVolumeDetail;
  const layers = pipeNetworkLayerCount(context, covering);
  const candidates: PipeNetworkCandidate[] = [];

  for (let layer = 0; layer < layers; layer++) {
    for (let oy = -radius - 1; oy <= radius; oy++) {
      const gy = cy + oy;
      for (let ox = -radius - 1; ox <= radius; ox++) {
        const gx = cx + ox;
        addPipeNetworkEdgeCandidate(context, candidates, center.x, center.y, gx, gy, layer, 'x', covering, detail, r2);
        addPipeNetworkEdgeCandidate(context, candidates, center.x, center.y, gx, gy, layer, 'y', covering, detail, r2);
      }
    }
  }

  const selected = selectStableFieldCoverage(candidates, cap, profile.proceduralFieldRadius);
  for (const candidate of selected) {
    emitInstance(out, {
      modelId: candidate.modelId,
      x: candidate.x,
      y: candidate.y,
      z: candidate.z,
      yaw: candidate.yaw,
      scaleX: candidate.length,
      scaleY: candidate.scaleY,
      scaleZ: candidate.scaleZ,
      seed: candidate.seed,
      flags: MeshInstanceFlag.CorridorVolume,
    });
  }
}

function floorScatterCap(profile: ResolvedMeshSceneProfile): number {
  return profile.proceduralFieldInstanceCap;
}

function nearbyFloorTex(world: World, cx: number, cy: number, tex: Tex): boolean {
  for (let oy = -1; oy <= 1; oy++) {
    const y = world.wrap(cy + oy);
    for (let ox = -1; ox <= 1; ox++) {
      const x = world.wrap(cx + ox);
      if (world.floorTex[world.idx(x, y)] === tex) return true;
    }
  }
  return false;
}

function floorScatterPackageForField(
  context: MeshPassContext,
  profile: ResolvedMeshSceneProfile,
  covering: VisualCorridorCoveringDef,
): FloorScatterPackage | null {
  if (!profile.includeCorridorVolumes || profile.corridorVolumeDetail <= 0) return null;
  if (covering.floorScatter) return covering.floorScatter;
  const cx = Math.floor(context.camera.x);
  const cy = Math.floor(context.camera.y);
  const cameraIdx = context.world.idx(cx, cy);
  if (context.world.floorTex[cameraIdx] === Tex.F_LINO) return 'linoleum';
  const room = roomForCell(context.world, cameraIdx);
  if (room?.floorTex === Tex.F_LINO) return 'linoleum';
  if (nearbyFloorTex(context.world, cx, cy, Tex.F_LINO)) return 'linoleum';
  return null;
}

function floorScatterGate(
  context: MeshPassContext,
  x: number,
  y: number,
  roomId: number,
  pkg: FloorScatterPackage,
  detail: number,
): boolean {
  const salt = pkg === 'collector' ? 0x636c75 : pkg === 'organic' ? 0x6f7267 : 0x6c696e;
  const noise = valueNoise2d(context.seed, x + 0.41, y + 0.73, roomId, corridorContextSalt(context, salt), 5.5);
  const grain = hashUnit(context.seed, x, y, roomId, salt ^ 0x66736c);
  const density = pkg === 'collector'
    ? 0.09 + detail * 0.24
    : pkg === 'organic'
      ? 0.14 + detail * 0.32
      : 0.12 + detail * 0.28;
  return noise * 0.46 + grain * 0.54 < density;
}

function floorScatterModelId(context: MeshPassContext, x: number, y: number, roomId: number, pkg: FloorScatterPackage): VisualModelId {
  const h = mixHash(context.seed, x, y, roomId, pkg === 'collector' ? 0x636d6f : pkg === 'organic' ? 0x6f726d : 0x6c6d6f);
  const roll = (h >>> 12) & 255;
  if (pkg === 'organic') {
    if (roll < 90) return 'organic_meat_lump';
    if (roll < 160) return 'organic_bone_shard';
    if (roll < 210) return 'organic_pustule';
    return 'organic_rib_cage';
  }
  if (pkg === 'linoleum') {
    if (roll < 92) return 'linoleum_peel';
    if (roll < 150) return 'linoleum_scrap';
    if (roll < 192) return 'paper_sheet';
    if (roll < 222) return 'newspaper_sheet';
    return 'floor_crumb';
  }
  if (roll < 34) return 'collector_floor_pipe';
  if (roll < 86) return 'floor_tile_shard';
  if (roll < 126) return 'brick_fragment';
  if (roll < 152) return 'paper_sheet';
  if (roll < 176) return 'newspaper_sheet';
  if (roll < 210) return 'floor_crumb';
  return 'rubble_chunk';
}

function floorScatterScale(modelId: VisualModelId, h: number): { x: number; y: number; z: number } {
  switch (modelId) {
    case 'organic_meat_lump':
      return { x: 0.7 + ((h >>> 8) & 7) * 0.06, y: 0.7 + ((h >>> 12) & 7) * 0.06, z: 0.8 + ((h >>> 14) & 3) * 0.1 };
    case 'organic_bone_shard':
      return { x: 0.8 + ((h >>> 8) & 7) * 0.06, y: 0.8 + ((h >>> 12) & 7) * 0.06, z: 0.9 + ((h >>> 14) & 3) * 0.15 };
    case 'organic_pustule':
      return { x: 0.8 + ((h >>> 8) & 7) * 0.08, y: 0.8 + ((h >>> 12) & 7) * 0.08, z: 0.8 + ((h >>> 14) & 3) * 0.08 };
    case 'organic_rib_cage':
      return { x: 0.8 + ((h >>> 8) & 7) * 0.05, y: 0.8 + ((h >>> 12) & 7) * 0.05, z: 0.8 + ((h >>> 14) & 3) * 0.05 };
    case 'collector_floor_pipe':
      return { x: 0.72 + ((h >>> 8) & 7) * 0.08, y: 0.65 + ((h >>> 12) & 3) * 0.06, z: 0.75 };
    case 'floor_tile_shard':
      return { x: 0.78 + ((h >>> 8) & 7) * 0.055, y: 0.72 + ((h >>> 12) & 3) * 0.06, z: 0.7 };
    case 'brick_fragment':
      return { x: 0.74 + ((h >>> 8) & 7) * 0.05, y: 0.72 + ((h >>> 12) & 3) * 0.04, z: 0.74 + ((h >>> 14) & 3) * 0.05 };
    case 'linoleum_peel':
      return { x: 0.78 + ((h >>> 8) & 7) * 0.1, y: 0.5 + ((h >>> 12) & 7) * 0.07, z: 0.74 };
    case 'linoleum_scrap':
      return { x: 0.42 + ((h >>> 8) & 7) * 0.07, y: 0.28 + ((h >>> 12) & 7) * 0.05, z: 0.7 };
    case 'paper_sheet':
      return { x: 0.46 + ((h >>> 8) & 7) * 0.06, y: 0.34 + ((h >>> 12) & 7) * 0.05, z: 0.54 };
    case 'newspaper_sheet':
      return { x: 0.58 + ((h >>> 8) & 7) * 0.07, y: 0.4 + ((h >>> 12) & 7) * 0.055, z: 0.56 };
    case 'floor_crumb':
      return { x: 0.34 + ((h >>> 8) & 7) * 0.035, y: 0.3 + ((h >>> 12) & 7) * 0.035, z: 0.45 };
    default:
      return { x: 0.56 + ((h >>> 8) & 7) * 0.045, y: 0.56 + ((h >>> 12) & 7) * 0.04, z: 0.6 };
  }
}

function addFloorScatterCandidate(
  context: MeshPassContext,
  candidates: FloorScatterCandidate[],
  profile: ResolvedMeshSceneProfile,
  centerX: number,
  centerY: number,
  x: number,
  y: number,
  pkg: FloorScatterPackage,
  fieldSalt: number,
  r2: number,
): void {
  const detail = profile.corridorVolumeDetail;
  if (!floorScatterGate(context, x, y, fieldSalt, pkg, detail)) return;
  const salt = pkg === 'collector' ? 0x66636f : pkg === 'organic' ? 0x6f7267 : 0x666c69;
  const h = mixHash(context.seed, x, y, fieldSalt, salt);
  const ix = wrapFloat(x + 0.12 + hashUnit(context.seed, x, y, fieldSalt, h ^ 0x7866) * 0.76);
  const iy = wrapFloat(y + 0.12 + hashUnit(context.seed, x, y, fieldSalt, h ^ 0x7966) * 0.76);
  const dx = wrappedDelta(centerX, ix);
  const dy = wrappedDelta(centerY, iy);
  const d2 = dx * dx + dy * dy;
  if (d2 > r2) return;
  const modelId = floorScatterModelId(context, x, y, fieldSalt, pkg);
  const scale = floorScatterScale(modelId, h);
  candidates.push({
    modelId,
    x: ix,
    y: iy,
    yaw: (((h >>> 16) & 1023) / 1023) * Math.PI * 2,
    scaleX: scale.x,
    scaleY: scale.y,
    scaleZ: scale.z,
    seed: meshInstanceSeed(context.seed, x, y, salt, modelId, fieldSalt),
    d2,
  });
}

function collectProceduralFloorScatter(
  context: MeshPassContext,
  profile: ResolvedMeshSceneProfile,
  out: MeshInstance[],
): void {
  const covering = corridorCovering(context, profile);
  if (!profile.includeCorridorVolumes || profile.corridorVolumeDetail <= 0) return;
  const pkg = floorScatterPackageForField(context, profile, covering);
  if (!pkg) return;
  const salt = pkg === 'collector' ? 0x66636f : pkg === 'organic' ? 0x6f7267 : 0x666c69;
  const fieldSalt = corridorContextSalt(context, salt);
  const radius = Math.max(2, Math.ceil(profile.proceduralFieldRadius));
  const cx = Math.floor(context.camera.x);
  const cy = Math.floor(context.camera.y);
  const center = cameraCellCenter(context);
  const r2 = profile.proceduralFieldRadius * profile.proceduralFieldRadius;
  const candidates: FloorScatterCandidate[] = [];

  for (let oy = -radius; oy <= radius; oy++) {
    const y = cy + oy;
    for (let ox = -radius; ox <= radius; ox++) {
      const x = cx + ox;
      addFloorScatterCandidate(context, candidates, profile, center.x, center.y, x, y, pkg, fieldSalt, r2);
    }
  }

  const selected = selectStableFieldCoverage(candidates, floorScatterCap(profile), profile.proceduralFieldRadius);
  for (const candidate of selected) {
    emitInstance(out, {
      modelId: candidate.modelId,
      x: candidate.x,
      y: candidate.y,
      z: 0.006,
      yaw: candidate.yaw,
      scaleX: candidate.scaleX,
      scaleY: candidate.scaleY,
      scaleZ: candidate.scaleZ,
      seed: candidate.seed,
      flags: MeshInstanceFlag.CorridorVolume,
    });
  }
}

function optionalColumnModelId(floorKey: string): string {
  if (floorKey.includes('maintenance')) return 'column_concrete_round';
  return 'column_concrete_square';
}

function collectOptionalColumnAtCell(context: MeshPassContext, idx: number, x: number, y: number, out: MeshInstance[]): void {
  const world = context.world;
  if (!isPassableVisualCell(world, idx) || world.features[idx] !== Feature.NONE || world.containerMap.has(idx) || doorNear(world, x, y)) return;
  const slots = visualSlotsForWorld(world);
  if (
    slots &&
    (cellHasVisualCode(slots, idx, VISUAL_CELL_CODES.COLUMN_HINT) ||
      cellHasVisualCode(slots, idx, VISUAL_CELL_CODES.COLUMN_CONCRETE_SQUARE))
  ) return;
  const room = roomForCell(world, idx);
  if (!room || room.type === RoomType.CORRIDOR || room.w < 8 || room.h < 8) return;
  const local = localRoomCoord(room, x, y);
  if (!local || local.lx < 2 || local.ly < 2 || local.lx >= room.w - 2 || local.ly >= room.h - 2) return;

  const detail = numericProfileDetail(context, 'furnitureDetail');
  if (detail <= 0) return;
  const h = mixHash(context.seed, x, y, room.id, 0x6c6f6e);
  const spacing = context.mode === 'high' ? 5 : 6;
  const ox = h % spacing;
  const oy = (h >>> 4) % spacing;
  if ((local.lx + ox) % spacing !== 0 || (local.ly + oy) % spacing !== 0) return;
  if (((h >>> 12) & 255) / 255 > detail * 0.62) return;

  const modelId = optionalColumnModelId(context.floorKey);
  emitInstance(out, {
    modelId,
    x: x + 0.5,
    y: y + 0.5,
    z: 0,
    yaw: ((h >>> 20) & 3) * Math.PI * 0.5,
    scaleX: modelId === 'column_concrete_round' ? 0.82 : 0.72,
    scaleY: modelId === 'column_concrete_round' ? 0.82 : 0.72,
    scaleZ: 1,
    seed: meshInstanceSeed(context.seed, x, y, 0x636f6c, modelId, room.id),
    flags: MeshInstanceFlag.VisualSlot,
  });
}

function collectOptionalCeilingAtCell(context: MeshPassContext, idx: number, x: number, y: number, out: MeshInstance[]): void {
  const world = context.world;
  if (!isPassableVisualCell(world, idx) || doorNear(world, x, y)) return;
  if (world.features[idx] !== Feature.NONE || world.containerMap.has(idx)) return;
  const slots = visualSlotsForWorld(world);
  if (slots && cellHasAnyVisualSlot(slots, idx)) return;
  const room = roomForCell(world, idx);
  if (!room) return;
  const detail = numericProfileDetail(context, 'ceilingDetail');
  if (detail <= 0) return;
  const local = localRoomCoord(room, x, y);
  if (!local) return;
  const structuralRoom = room.type === RoomType.CORRIDOR ||
    room.type === RoomType.COMMON ||
    room.type === RoomType.PRODUCTION ||
    room.type === RoomType.STORAGE ||
    room.type === RoomType.OFFICE ||
    room.type === RoomType.HQ;
  if (!structuralRoom) return;
  const h = mixHash(context.seed, x, y, room.id, 0x636569);
  const spacing = room.type === RoomType.CORRIDOR ? 4 : context.mode === 'high' ? 6 : 8;
  if ((local.lx + ((h >>> 3) % spacing)) % spacing !== 0 && (local.ly + ((h >>> 7) % spacing)) % spacing !== 0) return;
  if (((h >>> 14) & 255) / 255 > detail * 0.72) return;

  const axis = openAxis(world, x, y);
  const industrial = context.floorKey.includes('maintenance') || context.floorKey.includes('industrial');
  const modelId = industrial
    ? (((h >>> 22) & 1) ? 'ceiling_pipe_bundle' : 'ceiling_cable_bundle')
    : 'ceiling_beam';
  emitInstance(out, {
    modelId,
    x: x + 0.5,
    y: y + 0.5,
    z: 1,
    yaw: axis === 'y' ? Math.PI * 0.5 : 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
    seed: meshInstanceSeed(context.seed, x, y, 0x636569, modelId, room.id),
    flags: MeshInstanceFlag.VisualSlot,
  });
}

function scanCell(
  context: MeshPassContext,
  idx: number,
  x: number,
  y: number,
  profile: ResolvedMeshSceneProfile,
  scope: CellScanScope,
  out: MeshInstance[],
  stats?: MeshSceneCollectStats,
): void {
  if (stats) stats.cellsScanned++;
  const slots = profile.includeVisualSlots ? visualSlotsForWorld(context.world) : undefined;
  collectVisualSlotsAtCell(context, slots, idx, x, y, scope, profile, out, stats);
  if (profile.includeFeatures) collectFeatureAtCell(context, idx, x, y, out);
  if (profile.includeContainers) collectContainersAtCell(context, idx, x, y, out);
  collectOptionalColumnAtCell(context, idx, x, y, out);
  collectOptionalCeilingAtCell(context, idx, x, y, out);
  collectCorridorVolumeAtCell(context, idx, x, y, profile, out);
}

function scanLocalRadiusCells(
  context: MeshPassContext,
  profile: ResolvedMeshSceneProfile,
  out: MeshInstance[],
  stats?: MeshSceneCollectStats,
): void {
  const cx = Math.floor(context.camera.x);
  const cy = Math.floor(context.camera.y);
  const center = cameraCellCenter(context);
  const radius = profile.radiusCells;
  const r2 = profile.radius * profile.radius;
  const scope: CellScanScope = {
    kind: 'radius',
    centerX: center.x,
    centerY: center.y,
    radius: profile.radius,
  };
  for (let oy = -radius; oy <= radius; oy++) {
    const y = context.world.wrap(cy + oy);
    for (let ox = -radius; ox <= radius; ox++) {
      const x = context.world.wrap(cx + ox);
      const dx = wrappedDelta(center.x, x + 0.5);
      const dy = wrappedDelta(center.y, y + 0.5);
      if (dx * dx + dy * dy > r2 + 1) continue;
      scanCell(context, context.world.idx(x, y), x, y, profile, scope, out, stats);
    }
  }
}

export function collectMeshChunk(
  context: MeshPassContext,
  chunkX: number,
  chunkY: number,
  out: MeshInstance[] = [],
  stats?: MeshSceneCollectStats,
): MeshInstance[] {
  const profile = resolveMeshSceneProfile(context);
  if (!profile.enabled) return out;
  const size = profile.chunkSize;
  const center = cameraCellCenter(context);
  const chunksPerAxis = W / size;
  const cx = ((chunkX % chunksPerAxis) + chunksPerAxis) % chunksPerAxis;
  const cy = ((chunkY % chunksPerAxis) + chunksPerAxis) % chunksPerAxis;
  const startX = cx * size;
  const startY = cy * size;
  const scope: CellScanScope = {
    kind: 'chunk',
    centerX: center.x,
    centerY: center.y,
    radius: profile.radius,
    chunkX: cx,
    chunkY: cy,
    chunkSize: size,
  };
  const r2 = profile.radius * profile.radius;
  for (let dy = 0; dy < size; dy++) {
    const y = context.world.wrap(startY + dy);
    for (let dx = 0; dx < size; dx++) {
      const x = context.world.wrap(startX + dx);
      const ddx = wrappedDelta(center.x, x + 0.5);
      const ddy = wrappedDelta(center.y, y + 0.5);
      if (ddx * ddx + ddy * ddy > r2 + size) continue;
      scanCell(context, context.world.idx(x, y), x, y, profile, scope, out, stats);
    }
  }
  return out;
}

export function collectStaticEntityMeshes(context: MeshPassContext, out: MeshInstance[]): void {
  const profile = resolveMeshSceneProfile(context);
  if (!profile.enabled || !profile.includeEntities || !context.entityIndex) return;
  ENTITY_QUERY_SCRATCH.length = 0;
  context.entityIndex.queryRadiusCapped(
    context.camera.x,
    context.camera.y,
    profile.radius,
    ENTITY_QUERY_SCRATCH,
    ENTITY_MASK_BILLBOARD,
    Math.min(profile.instanceCap, 128),
  );
  for (const e of ENTITY_QUERY_SCRATCH) {
    if (!e.alive || e.type !== EntityType.BILLBOARD) continue;
    emitInstance(out, {
      modelId: 'billboard_prop',
      x: e.x,
      y: e.y,
      z: e.spriteZ ?? 0,
      yaw: e.angle ?? 0,
      scaleX: e.spriteScale ?? 1,
      scaleY: e.spriteScale ?? 1,
      scaleZ: e.spriteScale ?? 1,
      seed: meshInstanceSeed(context.seed, e.x, e.y, e.id + 3000, 'billboard_prop'),
      flags: MeshInstanceFlag.Entity,
    });
  }
}

function priorityForModel(modelId: string, flags: number): number {
  if ((flags & MeshInstanceFlag.Emissive) !== 0) return 120;
  if (
    modelId === 'linoleum_peel' ||
    modelId === 'linoleum_scrap' ||
    modelId === 'paper_sheet' ||
    modelId === 'newspaper_sheet' ||
    modelId === 'floor_crumb' ||
    modelId === 'collector_floor_pipe' ||
    modelId === 'floor_tile_shard' ||
    modelId === 'brick_fragment' ||
    modelId === 'rubble_chunk'
  ) return 96;

  const priority = MODEL_PRIORITY_CACHE.get(modelId);
  if (priority !== undefined) return priority;

  if ((flags & MeshInstanceFlag.Container) !== 0) return 64;
  if ((flags & MeshInstanceFlag.CorridorVolume) !== 0) return modelId.includes('organic') ? 66 : 58;
  if ((flags & MeshInstanceFlag.Entity) !== 0) return 54;
  return 40;
}

// Full-height models that span floor-to-ceiling and should stretch with a taller
// ceiling. Ordinary furniture keeps its authored height.
const CEILING_SPAN_MODELS = new Set<string>(['column_hint', 'column_concrete_square', 'column_concrete_round']);

// Render-only: lift ceiling-mounted fixtures and stretch full-height columns to
// the per-cell ceiling height (tier t -> ceilZ = 1 + t*0.5, matching the
// raycaster). Standard cells (tier 0) are untouched.
function applyCeilingHeight(world: World, instance: MeshInstance): void {
  const tier = world.ceilHeight[world.idx(world.wrap(Math.floor(instance.x)), world.wrap(Math.floor(instance.y)))];
  const ceilZ = 1 + Math.max(0, tier) * 0.5;
  if (instance.z >= 0.9) {
    // Nudge ceiling-mounted meshes slightly below the raycaster ceiling plane
    // so they reliably pass the depth test after the variable-height ceiling march.
    // This must happen even on standard tier=0 ceilings to avoid Z-fighting/depth culling.
    instance.z += ceilZ - 1 - 0.02;
  } else if (tier > 0 && CEILING_SPAN_MODELS.has(instance.modelId)) {
    instance.scaleZ *= ceilZ;
  }
}

export function capMeshInstances(
  context: MeshPassContext,
  raw: readonly MeshInstance[],
  out: MeshInstance[] = [],
  profile = resolveMeshSceneProfile(context),
): MeshInstance[] {
  out.length = 0;
  if (!profile.enabled || raw.length <= 0) return out;
  const capCenter = cameraCellCenter(context);
  const scored = raw.map((instance, order) => {
    const stableDx = wrappedDelta(capCenter.x, instance.x);
    const stableDy = wrappedDelta(capCenter.y, instance.y);
    const stableD2 = stableDx * stableDx + stableDy * stableDy;
    const radius = (instance.flags & MeshInstanceFlag.CorridorVolume) !== 0
      ? Math.max(profile.radius, profile.proceduralFieldRadius)
      : profile.radius;
    return {
      instance,
      order,
      stableD2,
      radius,
      priority: priorityForModel(instance.modelId, instance.flags),
      seed: instance.seed >>> 0,
    };
  }).filter(row => row.stableD2 <= row.radius * row.radius + 2);
  scored.sort((a, b) =>
    b.priority - a.priority ||
    a.stableD2 - b.stableD2 ||
    a.seed - b.seed ||
    a.instance.modelId.localeCompare(b.instance.modelId) ||
    a.order - b.order,
  );
  let visualSlotCount = 0;
  let visualSlotMergeCount = 0;
  for (const row of scored) {
    if (out.length >= profile.instanceCap) break;
    if ((row.instance.flags & MeshInstanceFlag.VisualSlot) !== 0) {
      if (visualSlotCount >= profile.visualSlotInstanceCap) continue;
      if ((row.instance.flags & MeshInstanceFlag.Merged) !== 0) {
        if (visualSlotMergeCount >= profile.visualSlotMergeCap) continue;
        visualSlotMergeCount++;
      }
      visualSlotCount++;
    }
    applyCeilingHeight(context.world, row.instance);
    out.push(row.instance);
  }
  return out;
}

export const visualSlotSourceAdapter: MeshSourceAdapter = {
  collect(context, out) {
    const profile = resolveMeshSceneProfile(context);
    if (!profile.enabled || !profile.includeVisualSlots) return;
    const resolvedContext = { ...context, profile };
    scanLocalRadiusCells(resolvedContext, { ...profile, includeFeatures: false, includeContainers: false, includeCorridorVolumes: false }, out);
  },
};

export const featureSourceAdapter: MeshSourceAdapter = {
  collect(context, out) {
    const profile = resolveMeshSceneProfile(context);
    if (!profile.enabled || !profile.includeFeatures) return;
    const resolvedContext = { ...context, profile };
    scanLocalRadiusCells(resolvedContext, { ...profile, includeVisualSlots: false, includeContainers: false, includeCorridorVolumes: false }, out);
  },
};

export const containerSourceAdapter: MeshSourceAdapter = {
  collect(context, out) {
    const profile = resolveMeshSceneProfile(context);
    if (!profile.enabled || !profile.includeContainers) return;
    const resolvedContext = { ...context, profile };
    scanLocalRadiusCells(resolvedContext, { ...profile, includeVisualSlots: false, includeFeatures: false, includeCorridorVolumes: false }, out);
  },
};

export const staticEntitySourceAdapter: MeshSourceAdapter = {
  collect(context, out) {
    collectStaticEntityMeshes(context, out);
  },
};

export function collectMeshSceneWithStats(context: MeshPassContext, out: MeshInstance[] = []): MeshSceneCollectResult {
  out.length = 0;
  const profile = resolveMeshSceneProfile(context);
  const stats = newStats();
  if (!profile.enabled) return { instances: out, stats };
  const resolvedContext = { ...context, profile };
  const raw: MeshInstance[] = [];
  scanLocalRadiusCells(resolvedContext, profile, raw, stats);
  collectProceduralCeilingPipeNetwork(resolvedContext, profile, raw);
  collectProceduralFloorScatter(resolvedContext, profile, raw);
  collectStaticEntityMeshes(resolvedContext, raw);
  stats.instancesBeforeCap = raw.length;
  capMeshInstances(resolvedContext, raw, out, profile);
  stats.instancesAfterCap = out.length;
  return { instances: out, stats };
}

export function collectMeshScene(context: MeshPassContext, out: MeshInstance[] = []): MeshInstance[] {
  return collectMeshSceneWithStats(context, out).instances;
}
