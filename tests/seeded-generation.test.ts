import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, W } from '../src/core/types';
import type { FloorGeneration } from '../src/gen/floor_manifest';
import { generateFloor } from '../src/gen/floor_manifest';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';

const CELL_SAMPLE_STEP = 257;

function mix(h: number, value: number): number {
  h ^= value | 0;
  return Math.imul(h, 0x01000193) >>> 0;
}

function mixString(h: number, value: string | undefined): number {
  if (!value) return mix(h, 0);
  for (let i = 0; i < value.length; i++) h = mix(h, value.charCodeAt(i));
  return h;
}

function generationFingerprint(gen: FloorGeneration): number {
  const { world } = gen;
  let h = 0x811c9dc5;
  h = mix(h, Math.floor(gen.spawnX * 1000));
  h = mix(h, Math.floor(gen.spawnY * 1000));
  h = mix(h, world.rooms.length);
  h = mix(h, world.doors.size);
  h = mix(h, world.containers.length);
  h = mix(h, gen.entities.length);

  const total = W * W;
  for (let i = 0; i < total; i += CELL_SAMPLE_STEP) {
    h = mix(h, world.cells[i]);
    h = mix(h, world.roomMap[i]);
    h = mix(h, world.features[i]);
    h = mix(h, world.wallTex[i]);
    h = mix(h, world.floorTex[i]);
  }
  const last = total - 1;
  h = mix(h, world.cells[last]);
  h = mix(h, world.roomMap[last]);
  h = mix(h, world.features[last]);
  h = mix(h, world.wallTex[last]);
  h = mix(h, world.floorTex[last]);

  for (const room of world.rooms) {
    h = mix(h, room.id);
    h = mix(h, room.type);
    h = mixString(h, room.name);
    h = mix(h, room.x);
    h = mix(h, room.y);
    h = mix(h, room.w);
    h = mix(h, room.h);
  }

  for (const entity of gen.entities) {
    h = mix(h, entity.type);
    h = mix(h, Math.floor(entity.x * 1000));
    h = mix(h, Math.floor(entity.y * 1000));
    h = mix(h, Math.floor(entity.angle * 1000));
    h = mixString(h, entity.name);
    h = mixString(h, entity.weapon);
    h = mix(h, entity.faction ?? 0);
    h = mix(h, entity.occupation ?? 0);
    h = mix(h, entity.monsterKind ?? 0);
  }

  return h >>> 0;
}

test('story floor generation is reproducible from run seed', () => {
  const a = generationFingerprint(generateFloor(FloorLevel.VOID, 12_345));
  const b = generationFingerprint(generateFloor(FloorLevel.VOID, 12_345));
  const c = generationFingerprint(generateFloor(FloorLevel.VOID, 12_346));

  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('design floor generation is reproducible from run seed', () => {
  const a = generationFingerprint(generateDesignFloor('service_floor', 98_765));
  const b = generationFingerprint(generateDesignFloor('service_floor', 98_765));
  const c = generationFingerprint(generateDesignFloor('service_floor', 98_766));

  assert.equal(a, b);
  assert.notEqual(a, c);
});
