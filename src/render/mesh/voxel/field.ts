import { Cell } from '../../../core/types';
import {
  EMPTY_VOXEL_COLLECT_STATS,
  VOXEL_DEFAULT_SOLID_CAP,
  VOXEL_FIELD_BORDER_CELLS,
  VOXEL_FIELD_DEFAULT_CHUNK_SIZE,
  VOXEL_FIELD_MAX_DEPTH,
  VOXEL_FIELD_MAX_HEIGHT,
  VOXEL_FIELD_MAX_WIDTH,
  VoxelMaterial,
  emptyVoxelMesh,
  voxelAt,
  voxelCellIndex,
  voxelOffset,
  voxelWorldSize,
  voxelWrap,
  type VoxelChunkMesh,
  type VoxelCollectContext,
  type VoxelCollectStats,
  type VoxelField,
  type VoxelFieldContext,
} from './types';
import { buildGreedyVoxelMesh } from './greedy_mesh';

const NEIGHBOR_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const raw = Number.isFinite(value) ? Math.floor(value as number) : fallback;
  return Math.max(min, Math.min(max, raw));
}

function hash4(a: number, b: number, c: number, d: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ b, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ c, 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ d, 0x27d4eb2d) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

function isWallLike(cell: number): boolean {
  return cell === Cell.WALL || cell === Cell.LIFT;
}

function isPassableForDecor(cell: number): boolean {
  return cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR;
}

function hasExposedPassableNeighbor(ctx: VoxelFieldContext, x: number, y: number, size: number): boolean {
  const world = ctx.world;
  if (!world) return false;
  for (const [dx, dy] of NEIGHBOR_DIRS) {
    const idx = voxelCellIndex(world, x + dx, y + dy, size);
    const cell = world.cells[idx] ?? Cell.WALL;
    if (isPassableForDecor(cell)) return true;
  }
  return false;
}

function trySetVoxel(field: VoxelField, x: number, y: number, z: number, material: VoxelMaterial, solidCap: number): boolean {
  if (material === VoxelMaterial.EMPTY) return false;
  if (x < 0 || y < 0 || z < 0 || x >= field.width || y >= field.height || z >= field.depth) return false;
  const offset = voxelOffset(field, x, y, z);
  if (field.voxels[offset] !== VoxelMaterial.EMPTY) return false;
  if (field.solidCount >= solidCap) return false;
  field.voxels[offset] = material;
  field.solidCount++;
  return true;
}

function addCeilingRib(field: VoxelField, x: number, y: number, material: VoxelMaterial, solidCap: number): void {
  const z = Math.max(0, field.depth - 1);
  trySetVoxel(field, x, y, z, material, solidCap);
  if ((x + field.seed + y) % 3 === 0) trySetVoxel(field, x, y, Math.max(0, z - 1), material, solidCap);
}

export function createVoxelField(ctx: VoxelFieldContext): VoxelField {
  const profile = ctx.profile;
  const worldSize = voxelWorldSize(ctx.worldSize);
  if (!profile.voxelEnabled) {
    return {
      width: 0,
      height: 0,
      depth: 0,
      originX: voxelWrap(ctx.chunkX, worldSize),
      originY: voxelWrap(ctx.chunkY, worldSize),
      worldSize,
      seed: ctx.seed >>> 0,
      profileKey: profile.key ?? 'off',
      voxels: new Uint8Array(0),
      solidCount: 0,
    };
  }

  const chunkSize = clampInt(
    profile.chunkSize,
    VOXEL_FIELD_DEFAULT_CHUNK_SIZE,
    1,
    Math.min(VOXEL_FIELD_MAX_WIDTH, VOXEL_FIELD_MAX_HEIGHT) - VOXEL_FIELD_BORDER_CELLS * 2,
  );
  const width = chunkSize + VOXEL_FIELD_BORDER_CELLS * 2;
  const height = chunkSize + VOXEL_FIELD_BORDER_CELLS * 2;
  const depth = clampInt(profile.fieldDepth, 8, 1, VOXEL_FIELD_MAX_DEPTH);
  const originX = voxelWrap(ctx.chunkX * chunkSize - VOXEL_FIELD_BORDER_CELLS, worldSize);
  const originY = voxelWrap(ctx.chunkY * chunkSize - VOXEL_FIELD_BORDER_CELLS, worldSize);
  const field: VoxelField = {
    width,
    height,
    depth,
    originX,
    originY,
    worldSize,
    seed: ctx.seed >>> 0,
    profileKey: profile.key ?? profile.style ?? 'voxel',
    voxels: new Uint8Array(width * height * depth),
    solidCount: 0,
  };

  const world = ctx.world;
  const solidCap = clampInt(profile.solidVoxelCap, VOXEL_DEFAULT_SOLID_CAP, 0, width * height * depth);
  if (!world || solidCap <= 0) return field;

  for (let ly = 0; ly < height; ly++) {
    const wy = originY + ly;
    for (let lx = 0; lx < width; lx++) {
      const wx = originX + lx;
      const idx = voxelCellIndex(world, wx, wy, worldSize);
      const cell = world.cells[idx] ?? Cell.WALL;
      const roll = hash4(ctx.seed, idx, lx, ly);

      if (isWallLike(cell)) {
        if (!hasExposedPassableNeighbor(ctx, wx, wy, worldSize)) continue;
        if ((roll & 3) !== 0) trySetVoxel(field, lx, ly, 0, VoxelMaterial.CONCRETE, solidCap);
        if ((roll & 15) === 0) addCeilingRib(field, lx, ly, VoxelMaterial.CEILING, solidCap);
      }
    }
  }

  return field;
}

export function collectVoxelChunks(ctx: VoxelCollectContext, outMeshes: VoxelChunkMesh[]): VoxelCollectStats {
  const profile = ctx.profile;
  if (!profile.voxelEnabled) return { ...EMPTY_VOXEL_COLLECT_STATS };

  const chunkSize = clampInt(
    profile.chunkSize,
    VOXEL_FIELD_DEFAULT_CHUNK_SIZE,
    1,
    Math.min(VOXEL_FIELD_MAX_WIDTH, VOXEL_FIELD_MAX_HEIGHT) - VOXEL_FIELD_BORDER_CELLS * 2,
  );
  const maxChunks = clampInt(profile.maxChunksPerFrame, 1, 1, 16);
  const radius = Math.max(0, profile.voxelRadius ?? chunkSize);
  const chunkRadius = Math.min(3, Math.ceil(radius / chunkSize) - 1);
  const centerChunkX = Math.floor(ctx.cameraX / chunkSize);
  const centerChunkY = Math.floor(ctx.cameraY / chunkSize);
  const stats: VoxelCollectStats = {
    enabled: true,
    chunksConsidered: 0,
    chunksBuilt: 0,
    solidVoxels: 0,
    triangles: 0,
    skippedReason: '',
  };

  for (let ring = 0; ring <= chunkRadius && stats.chunksConsidered < maxChunks; ring++) {
    for (let dy = -ring; dy <= ring && stats.chunksConsidered < maxChunks; dy++) {
      for (let dx = -ring; dx <= ring && stats.chunksConsidered < maxChunks; dx++) {
        if (ring > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const chunkX = centerChunkX + dx;
        const chunkY = centerChunkY + dy;
        stats.chunksConsidered++;
        const field = createVoxelField({
          world: ctx.world,
          seed: ctx.seed,
          floorKey: ctx.floorKey,
          chunkX,
          chunkY,
          profile,
          visualSlots: ctx.visualSlots,
          visualSlotClassifier: ctx.visualSlotClassifier,
          worldSize: ctx.worldSize,
        });
        stats.solidVoxels += field.solidCount;
        if (field.solidCount <= 0) continue;
        const mesh = buildGreedyVoxelMesh(field, { triangleCap: profile.triangleCap });
        if (mesh.triangleCount <= 0) continue;
        stats.chunksBuilt++;
        stats.triangles += mesh.triangleCount;
        outMeshes.push({
          ...mesh,
          chunkX,
          chunkY,
          originX: field.originX,
          originY: field.originY,
          fieldWidth: field.width,
          fieldHeight: field.height,
          fieldDepth: field.depth,
        });
      }
    }
  }

  if (stats.chunksBuilt === 0) stats.skippedReason = stats.solidVoxels > 0 ? 'no_voxel_triangles' : 'no_voxel_geometry';
  return stats;
}

export function countSolidVoxels(field: VoxelField): number {
  let count = 0;
  for (const voxel of field.voxels) if (voxel !== VoxelMaterial.EMPTY) count++;
  return count;
}

export function fieldHasVoxel(field: VoxelField, x: number, y: number, z: number): boolean {
  return voxelAt(field, x, y, z) !== VoxelMaterial.EMPTY;
}

export function emptyVoxelChunkMesh(chunkX: number, chunkY: number): VoxelChunkMesh {
  return {
    ...emptyVoxelMesh('empty_voxel_chunk'),
    chunkX,
    chunkY,
    originX: 0,
    originY: 0,
    fieldWidth: 0,
    fieldHeight: 0,
    fieldDepth: 0,
  };
}
