import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { RoomType } from '../src/core/types';
import { World } from '../src/core/world';
import {
  BAD_APPLE_HEIGHT,
  BAD_APPLE_PROJECTOR_SOUND_RADIUS,
  BAD_APPLE_WIDTH,
  badAppleScreenSoundPosition,
} from '../src/systems/procedural_anomalies/bad_apple_world';
import { getSamosborRoomSirenSourcesForTests } from '../src/systems/samosbor';
import { addTestRoom } from './helpers';

test('Bad Apple projector audio is sourced from the frame rectangle center', () => {
  const pos = badAppleScreenSoundPosition({ x: 100, y: 200, w: BAD_APPLE_WIDTH, h: BAD_APPLE_HEIGHT });

  assert.equal(pos.x, 100 + BAD_APPLE_WIDTH * 0.5);
  assert.equal(pos.y, 200 + BAD_APPLE_HEIGHT * 0.5);
});

test('Bad Apple projector audio reaches just outside the frame border', () => {
  const halfDiagonal = Math.hypot(BAD_APPLE_WIDTH, BAD_APPLE_HEIGHT) * 0.5;

  assert.equal(BAD_APPLE_PROJECTOR_SOUND_RADIUS > halfDiagonal, true);
});

test('samosbor room siren sources use centers of living rooms only', () => {
  const world = new World();
  const living = addTestRoom(world, {
    id: 1,
    type: RoomType.LIVING,
    x: 20,
    y: 30,
    w: 8,
    h: 6,
  });
  addTestRoom(world, {
    id: 2,
    type: RoomType.COMMON,
    x: 50,
    y: 60,
    w: 8,
    h: 6,
  });

  const sources = getSamosborRoomSirenSourcesForTests(world);

  assert.equal(sources.length, 1);
  assert.equal(sources[0].roomId, living.id);
  assert.equal(sources[0].x, living.x + living.w * 0.5);
  assert.equal(sources[0].y, living.y + living.h * 0.5);
});
