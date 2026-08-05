import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MESH_FALLBACK_PROFILE,
  createMeshPass,
  createMeshPassStats,
  formatMeshPassStats,
  type MeshPassContext,
} from '../src/render/mesh';

const GL = {} as WebGL2RenderingContext;

function context(mode: MeshPassContext['mode'] = 'off'): MeshPassContext {
  return {
    world: {} as MeshPassContext['world'],
    camera: {
      mode: 'player',
      x: 0,
      y: 0,
      angle: 0,
      pitch: 0,
      height: 0.5,
      fovRadians: Math.PI / 2,
    },
    floorKey: 'test:mesh',
    seed: 1,
    time: 0,
    mode,
    profile: DEFAULT_MESH_FALLBACK_PROFILE,
  };
}

test('mesh pass default stats are disabled and zeroed', () => {
  const stats = createMeshPassStats();
  assert.equal(stats.enabled, false);
  assert.equal(stats.chunksConsidered, 0);
  assert.equal(stats.chunksBuilt, 0);
  assert.equal(stats.instances, 0);
  assert.equal(stats.triangles, 0);
  assert.equal(stats.drawCalls, 0);
  assert.equal(stats.cpuMs, 0);
  assert.equal(stats.skippedReason, 'not_initialized');
});

test('mesh pass off mode skips work', () => {
  const pass = createMeshPass(GL);
  const stats = pass.update(context('off'));
  assert.equal(stats.enabled, false);
  assert.equal(stats.skippedReason, 'mode_off');
  assert.equal(pass.stats().skippedReason, 'mode_off');
});

test('mesh pass dispose is idempotent', () => {
  const pass = createMeshPass(GL);
  pass.dispose(GL);
  pass.dispose(GL);
  const stats = pass.update(context('high'));
  assert.equal(stats.enabled, false);
  assert.equal(stats.skippedReason, 'disposed');
});

test('mesh pass debug string contains bounded counters', () => {
  assert.equal(
    formatMeshPassStats(createMeshPassStats({ skippedReason: 'mode_off', triangles: 12.9, cpuMs: 1.25 })),
    'mesh=off:mode_off chunks=0/0 instances=0 triangles=12 draws=0 cpu=1.25ms',
  );
});
