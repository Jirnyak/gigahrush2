import test from 'node:test';
import assert from 'node:assert/strict';

import type { CameraView } from '../src/systems/camera';
import { W } from '../src/core/types';
import { buildMeshCameraUniforms, projectMeshPoint } from '../src/render/mesh/camera';
import { MESH_FAR, meshFovScale, meshToroidalDelta } from '../src/render/mesh/math';

function cameraView(overrides: Partial<CameraView> = {}): CameraView {
  return {
    mode: 'player',
    x: 100,
    y: 100,
    angle: 0,
    pitch: 0,
    height: 0.5,
    fovRadians: Math.PI / 2,
    ...overrides,
  };
}

function assertApprox(actual: number, expected: number, epsilon = 1e-9): void {
  assert.equal(Math.abs(actual - expected) <= epsilon, true, `${actual} ~= ${expected}`);
}

test('mesh toroidal delta picks nearest wrapped coordinate', () => {
  assert.equal(meshToroidalDelta(0, W - 1, W), 1);
  assert.equal(meshToroidalDelta(W - 1, 0, W), -1);
  assert.equal(meshToroidalDelta(10, 20, W), -10);
  assert.equal(meshToroidalDelta(20, 10, W), 10);
  assert.equal(meshToroidalDelta(W * 2 + 1, 0, W), 1);
  assert.equal(meshToroidalDelta(0, W * 2 + 1, W), -1);
  assert.equal(meshToroidalDelta(Number.NaN, 0, W), 0);
});

test('mesh projection keeps objects in front at positive forward distance', () => {
  const uniforms = buildMeshCameraUniforms(cameraView({ angle: 0 }));
  const projected = projectMeshPoint(uniforms, 105, 100, 0.5);

  assert.notEqual(projected, null);
  assertApprox(projected!.forward, 5);
  assertApprox(projected!.right, 0);
  assertApprox(projected!.ndcX, 0);
  assertApprox(projected!.ndcY, 0);
});

test('mesh projection uses nearest toroidal delta before camera transform', () => {
  const uniforms = buildMeshCameraUniforms(cameraView({ x: W - 0.25, y: 100, angle: 0 }));
  const projected = projectMeshPoint(uniforms, 0.75, 100, 0.5);

  assert.notEqual(projected, null);
  assertApprox(projected!.forward, 1);
  assertApprox(projected!.right, 0);
});

test('mesh projection rejects objects behind the camera', () => {
  const uniforms = buildMeshCameraUniforms(cameraView({ angle: 0 }));

  assert.equal(projectMeshPoint(uniforms, 95, 100, 0.5), null);
});

test('mesh projection rejects points outside the shared near/far depth range', () => {
  const uniforms = buildMeshCameraUniforms(cameraView({ angle: 0 }));

  assert.equal(projectMeshPoint(uniforms, 100.05, 100, 0.5), null);
  assert.equal(projectMeshPoint(uniforms, 100 + MESH_FAR, 100, 0.5), null);
});

test('mesh fov scaling matches current 60, 90 and 110 degree raycaster scale', () => {
  const fov60 = meshFovScale((60 * Math.PI) / 180);
  const fov90 = meshFovScale(Math.PI / 2);
  const fov110 = meshFovScale((110 * Math.PI) / 180);

  assertApprox(fov60, Math.tan(Math.PI / 6));
  assertApprox(fov90, 1);
  assertApprox(fov110, Math.tan((55 * Math.PI) / 180));
  assert.equal(fov60 < fov90, true);
  assert.equal(fov90 < fov110, true);
});

test('mesh projection rotates local coordinates with camera angle', () => {
  const uniforms = buildMeshCameraUniforms(cameraView({ angle: Math.PI / 2 }));
  const ahead = projectMeshPoint(uniforms, 100, 105, 0.5);
  const side = projectMeshPoint(uniforms, 95, 105, 0.5);

  assert.notEqual(ahead, null);
  assertApprox(ahead!.forward, 5);
  assertApprox(ahead!.right, 0);
  assert.notEqual(side, null);
  assertApprox(side!.forward, 5);
  assert.equal(side!.right > 0, true);
});

test('mesh depth increases monotonically with forward distance', () => {
  const uniforms = buildMeshCameraUniforms(cameraView({ angle: 0 }));
  const near = projectMeshPoint(uniforms, 104, 100, 0.5);
  const far = projectMeshPoint(uniforms, 120, 100, 0.5);

  assert.notEqual(near, null);
  assert.notEqual(far, null);
  assert.equal(near!.depth < far!.depth, true);
  assertApprox(near!.depth, near!.forward / MESH_FAR);
  assertApprox(far!.depth, far!.forward / MESH_FAR);
});

test('mesh clip coordinates preserve the same normalized depth convention', () => {
  const uniforms = buildMeshCameraUniforms(cameraView({ angle: 0 }));
  const projected = projectMeshPoint(uniforms, 110, 105, 0.75);

  assert.notEqual(projected, null);
  assertApprox(projected!.clipX / projected!.clipW, projected!.ndcX);
  assertApprox(projected!.clipY / projected!.clipW, projected!.ndcY);
  assertApprox((projected!.clipZ / projected!.clipW + 1) * 0.5, projected!.depth);
});

test('mesh pitch follows raycaster vertical shear convention', () => {
  const flat = buildMeshCameraUniforms(cameraView({ pitch: 0 }));
  const pitched = buildMeshCameraUniforms(cameraView({ pitch: 0.25 }));
  const flatPoint = projectMeshPoint(flat, 110, 100, 0.5);
  const pitchedPoint = projectMeshPoint(pitched, 110, 100, 0.5);

  assert.notEqual(flatPoint, null);
  assert.notEqual(pitchedPoint, null);
  assertApprox(flatPoint!.ndcY, 0);
  assertApprox(pitchedPoint!.ndcY, -0.5);
});

test('mesh projection rejects non-finite world coordinates', () => {
  const uniforms = buildMeshCameraUniforms(cameraView({ angle: 0 }));

  assert.equal(projectMeshPoint(uniforms, Number.NaN, 100, 0.5), null);
  assert.equal(projectMeshPoint(uniforms, 105, Number.POSITIVE_INFINITY, 0.5), null);
  assert.equal(projectMeshPoint(uniforms, 105, 100, Number.NaN), null);
});
