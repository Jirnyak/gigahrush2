import { W } from '../../../core/types';

export const VOXEL_FIELD_MAX_WIDTH = 24;
export const VOXEL_FIELD_MAX_HEIGHT = 24;
export const VOXEL_FIELD_MAX_DEPTH = 10;
export const VOXEL_FIELD_DEFAULT_CHUNK_SIZE = 16;
export const VOXEL_FIELD_BORDER_CELLS = 1;
export const VOXEL_DEFAULT_TRIANGLE_CAP = 1400;
export const VOXEL_DEFAULT_SOLID_CAP = 512;

export const enum VoxelMaterial {
  EMPTY = 0,
  CONCRETE = 1,
  METAL = 2,
  ORGANIC = 3,
  RUBBLE = 4,
  PIPE = 5,
  CEILING = 6,
}

export type VoxelVisualFamily = 'pipe' | 'cable' | 'organic' | 'rubble' | 'ceiling';

export interface VoxelWorldLike {
  cells: Uint8Array;
  features?: Uint8Array;
  wallTex?: Uint8Array;
  floorTex?: Uint8Array;
  surfaceFlags?: Uint8Array;
  surfaceMap?: Map<number, Uint8Array>;
  visualSlots?: Uint8Array;
  idx?(x: number, y: number): number;
  wrap?(v: number): number;
}

export type VoxelVisualSlotClassifier = (code: number) => VoxelVisualFamily | undefined;

export interface VoxelProfile {
  voxelEnabled: boolean;
  key?: string;
  chunkSize?: number;
  fieldDepth?: number;
  triangleCap?: number;
  solidVoxelCap?: number;
  maxChunksPerFrame?: number;
  voxelRadius?: number;
  visualSlotsPerCell?: number;
  style?: 'concrete' | 'maintenance' | 'hell' | 'void';
}

export interface VoxelFieldContext {
  world?: VoxelWorldLike;
  seed: number;
  floorKey?: string;
  chunkX: number;
  chunkY: number;
  profile: VoxelProfile;
  visualSlots?: Uint8Array;
  visualSlotClassifier?: VoxelVisualSlotClassifier;
  worldSize?: number;
}

export interface VoxelField {
  width: number;
  height: number;
  depth: number;
  originX: number;
  originY: number;
  worldSize: number;
  seed: number;
  profileKey: string;
  voxels: Uint8Array;
  solidCount: number;
}

export interface VoxelMeshBuildOptions {
  triangleCap?: number;
}

export interface VoxelMeshData {
  vertices: Float32Array;
  normals: Float32Array;
  colors: Uint8Array;
  indices: Uint32Array;
  triangleCount: number;
  truncated: boolean;
  skippedReason: string;
}

export interface VoxelCollectContext {
  world: VoxelWorldLike;
  cameraX: number;
  cameraY: number;
  seed: number;
  floorKey?: string;
  profile: VoxelProfile;
  visualSlots?: Uint8Array;
  visualSlotClassifier?: VoxelVisualSlotClassifier;
  worldSize?: number;
}

export interface VoxelCollectStats {
  enabled: boolean;
  chunksConsidered: number;
  chunksBuilt: number;
  solidVoxels: number;
  triangles: number;
  skippedReason: string;
}

export interface VoxelChunkMesh extends VoxelMeshData {
  chunkX: number;
  chunkY: number;
  originX: number;
  originY: number;
  fieldWidth: number;
  fieldHeight: number;
  fieldDepth: number;
}

export const EMPTY_VOXEL_COLLECT_STATS: VoxelCollectStats = {
  enabled: false,
  chunksConsidered: 0,
  chunksBuilt: 0,
  solidVoxels: 0,
  triangles: 0,
  skippedReason: 'voxel_off',
};

export function voxelWorldSize(size = W): number {
  return Number.isFinite(size) && size > 0 ? Math.floor(size) : W;
}

export function voxelWrap(v: number, size: number): number {
  return ((v % size) + size) % size;
}

export function voxelCellIndex(world: VoxelWorldLike | undefined, x: number, y: number, size: number): number {
  if (world?.idx) return world.idx(x, y);
  const wx = world?.wrap ? world.wrap(x) : voxelWrap(x, size);
  const wy = world?.wrap ? world.wrap(y) : voxelWrap(y, size);
  return wy * size + wx;
}

export function voxelOffset(field: Pick<VoxelField, 'width' | 'height'>, x: number, y: number, z: number): number {
  return (z * field.height + y) * field.width + x;
}

export function voxelAt(field: VoxelField, x: number, y: number, z: number): number {
  if (x < 0 || y < 0 || z < 0 || x >= field.width || y >= field.height || z >= field.depth) return VoxelMaterial.EMPTY;
  return field.voxels[voxelOffset(field, x, y, z)];
}

export function emptyVoxelMesh(skippedReason: string): VoxelMeshData {
  return {
    vertices: new Float32Array(0),
    normals: new Float32Array(0),
    colors: new Uint8Array(0),
    indices: new Uint32Array(0),
    triangleCount: 0,
    truncated: false,
    skippedReason,
  };
}
