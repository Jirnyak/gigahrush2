import test from 'node:test';
import assert from 'node:assert/strict';

import { EntityType, type Entity } from '../src/core/types';
import { registerRenderAnimationClip } from '../src/render/animations/registry';
import {
  hasRenderAnimationRuntimeEntry,
  renderAnimationRuntimeStats,
  resetRenderAnimationRuntime,
} from '../src/render/animations/runtime';
import { resolveEntityRenderAnimationFrame } from '../src/render/animations/resolver';
import { RENDER_ANIMATION_PRIORITY, type RenderAnimationClipDef } from '../src/render/animations/types';

function actor(id: number, npcVisualId: string, hp = 100): Entity {
  return {
    id,
    type: EntityType.NPC,
    x: 10,
    y: 10,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    npcVisualId,
    hp,
    maxHp: 100,
  };
}

function unregisterAll(unregisters: readonly (() => boolean)[]): void {
  for (const unregister of unregisters) unregister();
}

function clip(def: Omit<RenderAnimationClipDef, 'channel' | 'source'> & { frameCount?: number }): RenderAnimationClipDef {
  const { frameCount, ...rest } = def;
  return {
    ...rest,
    channel: 'entity_sprite',
    source: { kind: 'framePack', framePackId: def.id, frameCount: frameCount ?? 2 },
  };
}

test('render animation resolver gives harm priority over walk', () => {
  resetRenderAnimationRuntime();
  const npc = actor(1, 'animtest_priority');
  const unregisters = [
    registerRenderAnimationClip(clip({
      id: 'animtest_priority_walk',
      selector: { npcVisualId: 'animtest_priority', entityType: EntityType.NPC },
      trigger: { kind: 'moving' },
      playback: { loop: true, fps: 6, phaseByDistance: true },
      priority: RENDER_ANIMATION_PRIORITY.locomotion,
    })),
    registerRenderAnimationClip(clip({
      id: 'animtest_priority_harm',
      selector: { npcVisualId: 'animtest_priority', entityType: EntityType.NPC },
      trigger: { kind: 'damaged' },
      playback: { once: true, fps: 10, durationSec: 0.3 },
      priority: RENDER_ANIMATION_PRIORITY.harm,
      frameCount: 3,
    })),
  ];

  try {
    assert.equal(resolveEntityRenderAnimationFrame({ entity: npc, nowSec: 0 }), undefined);
    npc.hp = 88;
    const frame = resolveEntityRenderAnimationFrame({
      entity: npc,
      nowSec: 0.1,
      movementDelta: { dx: 0.25, dy: 0 },
    });
    assert.equal(frame?.clipId, 'animtest_priority_harm');
    assert.equal(frame?.priority, RENDER_ANIMATION_PRIORITY.harm);
  } finally {
    unregisterAll(unregisters);
  }
});

test('render animation walk loop starts on movement and stops on idle', () => {
  resetRenderAnimationRuntime();
  const npc = actor(2, 'animtest_walk_stop');
  const unregister = registerRenderAnimationClip(clip({
    id: 'animtest_walk_stop_loop',
    selector: { npcVisualId: 'animtest_walk_stop', entityType: EntityType.NPC },
    trigger: { kind: 'moving' },
    playback: { loop: true, fps: 4, phaseByDistance: true },
    priority: RENDER_ANIMATION_PRIORITY.locomotion,
    frameCount: 4,
  }));

  try {
    const moving = resolveEntityRenderAnimationFrame({
      entity: npc,
      nowSec: 0,
      movementDelta: { dx: 0.2, dy: 0 },
    });
    assert.equal(moving?.clipId, 'animtest_walk_stop_loop');

    const idle = resolveEntityRenderAnimationFrame({
      entity: npc,
      nowSec: 0.25,
      movementDelta: { dx: 0, dy: 0 },
    });
    assert.equal(idle, undefined);
  } finally {
    unregister();
  }
});

test('render animation once clip ends after duration', () => {
  resetRenderAnimationRuntime();
  const npc = actor(3, 'animtest_once_end');
  const unregister = registerRenderAnimationClip(clip({
    id: 'animtest_once_end_harm',
    selector: { npcVisualId: 'animtest_once_end', entityType: EntityType.NPC },
    trigger: { kind: 'damaged' },
    playback: { once: true, fps: 10, durationSec: 0.2 },
    priority: RENDER_ANIMATION_PRIORITY.harm,
    frameCount: 2,
  }));

  try {
    assert.equal(resolveEntityRenderAnimationFrame({ entity: npc, nowSec: 0 }), undefined);
    npc.hp = 80;
    assert.equal(resolveEntityRenderAnimationFrame({ entity: npc, nowSec: 0.05 })?.clipId, 'animtest_once_end_harm');
    assert.equal(resolveEntityRenderAnimationFrame({ entity: npc, nowSec: 0.3 }), undefined);
  } finally {
    unregister();
  }
});

test('render animation retrigger cooldown suppresses repeated one-shots', () => {
  resetRenderAnimationRuntime();
  const npc = actor(4, 'animtest_cooldown');
  const unregister = registerRenderAnimationClip(clip({
    id: 'animtest_cooldown_harm',
    selector: { npcVisualId: 'animtest_cooldown', entityType: EntityType.NPC },
    trigger: { kind: 'damaged' },
    playback: { once: true, fps: 10, durationSec: 0.1, retriggerCooldownSec: 1 },
    priority: RENDER_ANIMATION_PRIORITY.harm,
    frameCount: 2,
  }));

  try {
    assert.equal(resolveEntityRenderAnimationFrame({ entity: npc, nowSec: 0 }), undefined);
    npc.hp = 90;
    assert.equal(resolveEntityRenderAnimationFrame({ entity: npc, nowSec: 0.05 })?.clipId, 'animtest_cooldown_harm');
    npc.hp = 70;
    assert.equal(resolveEntityRenderAnimationFrame({ entity: npc, nowSec: 0.25 }), undefined);
    npc.hp = 50;
    assert.equal(resolveEntityRenderAnimationFrame({ entity: npc, nowSec: 1.2 })?.clipId, 'animtest_cooldown_harm');
  } finally {
    unregister();
  }
});

test('render animation runtime trims by last seen time and cap', () => {
  resetRenderAnimationRuntime();
  try {
    for (let i = 1; i <= 3; i++) {
      resolveEntityRenderAnimationFrame({ entity: actor(i, 'animtest_trim'), nowSec: i, runtimeLimit: 3 });
    }
    resolveEntityRenderAnimationFrame({ entity: actor(1, 'animtest_trim'), nowSec: 10, runtimeLimit: 3 });
    resolveEntityRenderAnimationFrame({ entity: actor(4, 'animtest_trim'), nowSec: 4, runtimeLimit: 3 });
    resolveEntityRenderAnimationFrame({ entity: actor(5, 'animtest_trim'), nowSec: 5, runtimeLimit: 3 });

    assert.equal(renderAnimationRuntimeStats().entries, 3);
    assert.equal(hasRenderAnimationRuntimeEntry(1), true);
    assert.equal(hasRenderAnimationRuntimeEntry(2), false);
    assert.equal(hasRenderAnimationRuntimeEntry(3), false);
    assert.equal(hasRenderAnimationRuntimeEntry(4), true);
    assert.equal(hasRenderAnimationRuntimeEntry(5), true);
  } finally {
    resetRenderAnimationRuntime();
  }
});
