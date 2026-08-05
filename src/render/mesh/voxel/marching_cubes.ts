import { emptyVoxelMesh, type VoxelField, type VoxelMeshBuildOptions, type VoxelMeshData } from './types';

export interface MarchingCubesOptions extends VoxelMeshBuildOptions {
  enabled?: boolean;
}

export const MARCHING_CUBES_AVAILABLE = false;

export function buildMarchingCubesMesh(field: VoxelField, options: MarchingCubesOptions = {}): VoxelMeshData {
  if (!options.enabled) return emptyVoxelMesh('marching_cubes_disabled');
  if (field.solidCount <= 0) return emptyVoxelMesh('empty_voxel_field');
  return emptyVoxelMesh('marching_cubes_planned');
}
