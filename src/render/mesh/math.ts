import { MAX_DRAW, W } from '../../core/types';

export const MESH_WORLD_SIZE = W;
export const MESH_NEAR = 0.1;
export const MESH_FAR = MAX_DRAW;
export const MESH_DEFAULT_FOV_RADIANS = Math.PI / 2;
export const MESH_MIN_FOV_RADIANS = Math.PI / 3;
export const MESH_MAX_FOV_RADIANS = (110 * Math.PI) / 180;

export function meshToroidalDelta(value: number, origin: number, size: number): number {
  const safeSize = Number.isFinite(size) && size > 0 ? size : MESH_WORLD_SIZE;
  if (!Number.isFinite(value) || !Number.isFinite(origin)) return 0;
  let d = (value - origin) % safeSize;
  const half = safeSize * 0.5;
  if (d > half) d -= safeSize;
  if (d < -half) d += safeSize;
  return d;
}

export function clampMeshFovRadians(fovRadians: number): number {
  const fov = Number.isFinite(fovRadians) ? fovRadians : MESH_DEFAULT_FOV_RADIANS;
  return Math.max(MESH_MIN_FOV_RADIANS, Math.min(MESH_MAX_FOV_RADIANS, fov));
}

export function meshFovScale(fovRadians: number): number {
  return Math.tan(clampMeshFovRadians(fovRadians) * 0.5);
}

export function normalizeMeshDepth(forward: number, far = MESH_FAR): number {
  const safeFar = Number.isFinite(far) && far > 0 ? far : MESH_FAR;
  return Math.max(0, Math.min(1, forward / safeFar));
}
