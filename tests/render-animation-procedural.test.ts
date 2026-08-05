import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rgba } from '../src/render/pixutil';
import {
  clearRenderAnimationProceduralSources,
  RenderAnimationProceduralFrameCache,
  proceduralAnimationFrameCacheKey,
  proceduralAnimationPhaseBucket,
  registerRenderAnimationProceduralSource,
  renderAnimationProceduralSourceById,
  resolveProceduralAnimationSource,
  type RenderAnimationProceduralInput,
} from '../src/render/animations/procedural';
import type { RenderAnimationProceduralCpuFrameSource } from '../src/render/animations/types';

const BASE_INPUT: RenderAnimationProceduralInput = {
  clipId: 'test_idle_pulse',
  visualKey: 'synthetic_npc:seed_17',
  seed: 17,
  width: 4,
  height: 4,
};

function pulseSource(onMutate: () => void = () => undefined): RenderAnimationProceduralCpuFrameSource {
  const base = new Uint32Array(16).fill(rgba(12, 16, 20, 255));
  return {
    kind: 'procedural_cpu_frame',
    width: 4,
    height: 4,
    phaseBuckets: 4,
    baseFrame: base,
    mutate: (ctx, frame) => {
      onMutate();
      const glow = 40 + ctx.phaseBucket * 30 + ctx.frameIndex;
      frame[5] = rgba(glow, 80, 96, 255);
    },
  };
}

test('procedural CPU frame cache reuses the same clip visual phase key', () => {
  let calls = 0;
  const cache = new RenderAnimationProceduralFrameCache({ maxEntries: 8 });
  const source = pulseSource(() => { calls++; });

  const input = { ...BASE_INPUT, frameIndex: 0, phase: 0.1 };
  const a = resolveProceduralAnimationSource(source, input, cache);
  const b = resolveProceduralAnimationSource(source, input, cache);

  assert.equal(a?.kind, 'frame');
  assert.equal(b?.kind, 'frame');
  assert.equal(calls, 1);
  assert.equal(a?.kind === 'frame' ? a.frame.pixels : null, b?.kind === 'frame' ? b.frame.pixels : null);
  assert.equal(cache.size, 1);
});

test('different procedural phase buckets can produce different frames', () => {
  const cache = new RenderAnimationProceduralFrameCache({ maxEntries: 8 });
  const source = pulseSource();

  const a = resolveProceduralAnimationSource(source, { ...BASE_INPUT, phase: 0.1 }, cache);
  const b = resolveProceduralAnimationSource(source, { ...BASE_INPUT, phase: 0.6 }, cache);

  assert.equal(a?.kind, 'frame');
  assert.equal(b?.kind, 'frame');
  assert.notEqual(
    a?.kind === 'frame' ? a.frame.pixels[5] : 0,
    b?.kind === 'frame' ? b.frame.pixels[5] : 0,
  );
  assert.equal(cache.size, 2);
});

test('procedural frame cache trims oldest entries at cap', () => {
  const cache = new RenderAnimationProceduralFrameCache({ maxEntries: 2 });
  const source = pulseSource();
  const firstKey = proceduralAnimationFrameCacheKey({
    clipId: BASE_INPUT.clipId,
    visualKey: BASE_INPUT.visualKey,
    frameIndex: 0,
    phaseBucket: 0,
  });

  resolveProceduralAnimationSource(source, { ...BASE_INPUT, phaseBucket: 0 }, cache);
  resolveProceduralAnimationSource(source, { ...BASE_INPUT, phaseBucket: 1 }, cache);
  resolveProceduralAnimationSource(source, { ...BASE_INPUT, phaseBucket: 2 }, cache);

  assert.equal(cache.size, 2);
  assert.equal(cache.has(firstKey), false);
});

test('procedural source falls back cleanly when generator fails', () => {
  const cache = new RenderAnimationProceduralFrameCache({ maxEntries: 8 });
  const source: RenderAnimationProceduralCpuFrameSource = {
    kind: 'procedural_cpu_frame',
    width: 4,
    height: 4,
    mutate: () => {
      throw new Error('synthetic generator failure');
    },
  };

  const result = resolveProceduralAnimationSource(source, BASE_INPUT, cache);

  assert.equal(result, null);
  assert.equal(cache.size, 0);
});

test('phase-only procedural source returns shader params without frame generation', () => {
  const result = resolveProceduralAnimationSource({
    kind: 'procedural_phase',
    phaseBuckets: 8,
    resolve: ctx => ({
      pulse: ctx.phaseBucket / 7,
      seed: ctx.seed,
    }),
  }, { ...BASE_INPUT, phase: 0.75 });

  assert.equal(result?.kind, 'phase');
  assert.deepEqual(result?.kind === 'phase' ? result.params : {}, {
    pulse: proceduralAnimationPhaseBucket(0.75, 8) / 7,
    seed: 17,
  });
});

test('procedural animation sources register by stable id for runtime resolution', () => {
  clearRenderAnimationProceduralSources();
  const source = pulseSource();
  const unregister = registerRenderAnimationProceduralSource('test_idle_pulse', source);

  assert.equal(renderAnimationProceduralSourceById('test_idle_pulse'), source);
  assert.throws(() => registerRenderAnimationProceduralSource('test_idle_pulse', source), /duplicate/);
  assert.equal(unregister(), true);
  assert.equal(renderAnimationProceduralSourceById('test_idle_pulse'), undefined);
});
