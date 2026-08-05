import type { CameraView } from '../../systems/camera';
import type { MeshCameraUniforms, MeshProjectedPoint } from './types';
import {
  MESH_FAR,
  MESH_NEAR,
  MESH_WORLD_SIZE,
  meshFovScale,
  meshToroidalDelta,
  normalizeMeshDepth,
} from './math';

export function buildMeshCameraUniforms(camera: CameraView): MeshCameraUniforms {
  const angle = Number.isFinite(camera.angle) ? camera.angle : 0;
  return {
    camX: Number.isFinite(camera.x) ? camera.x : 0,
    camY: Number.isFinite(camera.y) ? camera.y : 0,
    sinA: Math.sin(angle),
    cosA: Math.cos(angle),
    pitch: Number.isFinite(camera.pitch) ? camera.pitch : 0,
    height: Number.isFinite(camera.height) ? camera.height : 0.5,
    fovScale: meshFovScale(camera.fovRadians),
    near: MESH_NEAR,
    far: MESH_FAR,
  };
}

export function projectMeshPoint(
  camera: MeshCameraUniforms,
  worldX: number,
  worldY: number,
  worldZ = 0,
  worldSize = MESH_WORLD_SIZE,
): MeshProjectedPoint | null {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldY) || !Number.isFinite(worldZ)) return null;
  const dx = meshToroidalDelta(worldX, camera.camX, worldSize);
  const dy = meshToroidalDelta(worldY, camera.camY, worldSize);
  const right = -camera.sinA * dx + camera.cosA * dy;
  const forward = camera.cosA * dx + camera.sinA * dy;
  if (forward <= camera.near || forward >= camera.far) return null;

  const fovScale = camera.fovScale > 0 ? camera.fovScale : 1;
  const up = worldZ - camera.height;
  const ndcX = right / (forward * fovScale);
  const ndcY = 2 * (up / forward - camera.pitch);
  const depth = normalizeMeshDepth(forward, camera.far);
  const ndcZ = depth * 2 - 1;

  // Depth compatibility: the raycaster writes pixelDepth = camera-forward
  // distance / MAX_DRAW, then sprites write the same tyf / MAX_DRAW value with
  // gl.depthFunc(LESS). Mesh depth stays in that linear convention.
  return {
    right,
    forward,
    up,
    ndcX,
    ndcY,
    depth,
    clipX: ndcX * forward,
    clipY: ndcY * forward,
    clipZ: ndcZ * forward,
    clipW: forward,
  };
}
