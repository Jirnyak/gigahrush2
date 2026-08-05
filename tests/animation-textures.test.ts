import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  animatedEntityTextureCacheKey,
  clearAnimatedEntityTextureResolvers,
  hasAnimatedEntityTextureResolvers,
  registerAnimatedEntityTextureResolver,
  selectAnimatedTextureLruEvictionKeys,
  type AnimatedEntityTextureFrame,
} from '../src/render/animations/textures';

function frame(cacheKey: string, width: number, height: number): AnimatedEntityTextureFrame {
  return {
    cacheKey,
    width,
    height,
    pixels: new Uint32Array(width * height),
  };
}

test('animated texture cache key includes frame identity and dimensions', () => {
  assert.equal(animatedEntityTextureCacheKey(frame('olga_walk:0', 64, 77)), 'olga_walk:0|64x77');
  assert.notEqual(
    animatedEntityTextureCacheKey(frame('olga_walk:0', 64, 77)),
    animatedEntityTextureCacheKey(frame('olga_walk:0', 64, 64)),
  );
  assert.notEqual(
    animatedEntityTextureCacheKey(frame('olga_walk:0', 64, 77)),
    animatedEntityTextureCacheKey(frame('olga_walk:1', 64, 77)),
  );
});

test('animated texture LRU eviction trims oldest entries to target size', () => {
  const keys = selectAnimatedTextureLruEvictionKeys([
    ['newest', { usedAt: 30 }],
    ['oldest', { usedAt: 1 }],
    ['middle', { usedAt: 12 }],
    ['fresh', { usedAt: 20 }],
  ], 2);

  assert.deepEqual(keys, ['oldest', 'middle']);
});

test('animated texture resolver registry is explicit and resettable', () => {
  clearAnimatedEntityTextureResolvers();
  assert.equal(hasAnimatedEntityTextureResolvers(), true, 'built-in registered clips keep the animation hook active');

  const unregister = registerAnimatedEntityTextureResolver(() => null);
  assert.equal(hasAnimatedEntityTextureResolvers(), true);

  unregister();
  assert.equal(hasAnimatedEntityTextureResolvers(), true, 'unregistering custom resolvers keeps built-in clips available');
});
