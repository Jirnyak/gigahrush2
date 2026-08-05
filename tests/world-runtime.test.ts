import test from 'node:test';
import assert from 'node:assert/strict';

import { Cell, DoorState, Feature, RoomType, Tex } from '../src/core/types';
import { World } from '../src/core/world';

test('runtime feature writes bump feature version and rebake feature light', () => {
  const world = new World();
  const idx = world.idx(10, 10);
  const near = world.idx(11, 10);
  world.cells[idx] = Cell.FLOOR;
  world.cells[near] = Cell.FLOOR;

  const before = world.featureVersion;
  assert.equal(world.setFeatureAt(idx, Feature.LAMP), true);
  assert.notEqual(world.featureVersion, before);
  assert.equal(world.features[idx], Feature.LAMP);
  assert.ok(world.light[near] > 0);

  const afterLamp = world.featureVersion;
  assert.equal(world.setFeatureAt(idx, Feature.NONE), true);
  assert.notEqual(world.featureVersion, afterLamp);
  assert.equal(world.features[idx], Feature.NONE);
  assert.equal(world.light[near], 0);
});

test('runtime door removal clears cell, textures, door map and all room door metadata', () => {
  const world = new World();
  const idx = world.idx(20, 20);
  world.cells[idx] = Cell.DOOR;
  world.wallTex[idx] = Tex.DOOR_METAL;
  world.rooms[1] = {
    id: 1,
    type: RoomType.LIVING,
    x: 18,
    y: 18,
    w: 4,
    h: 4,
    doors: [idx],
    sealed: false,
    name: 'A',
    apartmentId: -1,
    wallTex: Tex.CONCRETE,
    floorTex: Tex.F_CONCRETE,
  };
  world.rooms[2] = {
    id: 2,
    type: RoomType.CORRIDOR,
    x: 21,
    y: 18,
    w: 4,
    h: 4,
    doors: [idx],
    sealed: false,
    name: 'B',
    apartmentId: -1,
    wallTex: Tex.CONCRETE,
    floorTex: Tex.F_CONCRETE,
  };
  world.rooms[3] = {
    id: 3,
    type: RoomType.STORAGE,
    x: 25,
    y: 18,
    w: 4,
    h: 4,
    doors: [idx],
    sealed: false,
    name: 'stale',
    apartmentId: -1,
    wallTex: Tex.CONCRETE,
    floorTex: Tex.F_CONCRETE,
  };
  world.doors.set(idx, { idx, state: DoorState.CLOSED, roomA: 1, roomB: 2, keyId: '', timer: 0 });

  assert.equal(world.removeDoorAt(idx), true);
  assert.equal(world.cells[idx], Cell.FLOOR);
  assert.equal(world.wallTex[idx], Tex.CONCRETE);
  assert.equal(world.solid(20, 20), false);
  assert.equal(world.doors.has(idx), false);
  assert.deepEqual(world.rooms[1].doors, []);
  assert.deepEqual(world.rooms[2].doors, []);
  assert.deepEqual(world.rooms[3].doors, []);
});

test('runtime door removal cleans stale door cells without a door record', () => {
  const world = new World();
  const idx = world.idx(21, 20);
  world.cells[idx] = Cell.DOOR;
  world.wallTex[idx] = Tex.DOOR_WOOD;

  assert.equal(world.removeDoorAt(idx), true);
  assert.equal(world.cells[idx], Cell.FLOOR);
  assert.equal(world.wallTex[idx], Tex.CONCRETE);
  assert.equal(world.doors.has(idx), false);
  assert.equal(world.solid(21, 20), false);
});
