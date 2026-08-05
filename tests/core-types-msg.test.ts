import { test, describe, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';

import { msgAt, msg, setMsgClock, setMsgLocationProvider, type MsgLocation, type Msg } from '../src/core/types';

describe('msgAt', () => {
  beforeEach(() => {
    // Reset the internal clock state using setMsgClock
    setMsgClock({ totalMinutes: 1440 * 2, hour: 10, minute: 30 } as any);
    // Reset location provider
    setMsgLocationProvider(undefined);
  });

  test('creates a message object incorporating clock time', () => {
    const loc: MsgLocation = { x: 5, y: 10 };
    const m = msgAt('test text', 500, '#abc', loc);

    // Core msg properties
    assert.equal(m.text, 'test text');
    assert.equal(m.time, 500);
    assert.equal(m.color, '#abc');

    // Properties from the clock state (day = 1440 * 2 / 1440 = 2)
    assert.equal(m.day, 2);
    assert.equal(m.hour, 10);
    assert.equal(m.minute, 30);
  });

  test('merges location properties', () => {
    const loc: MsgLocation = { x: 5, y: 10, actorId: 99, targetId: 44, roomId: 12, zoneId: 3, floor: 'living' };
    const m = msgAt('test text', 500, '#abc', loc);

    assert.equal(m.x, 5);
    assert.equal(m.y, 10);
    assert.equal(m.actorId, 99);
    assert.equal(m.targetId, 44);
    assert.equal(m.roomId, 12);
    assert.equal(m.zoneId, 3);
    assert.equal(m.floor, 'living');
  });

  test('handles distanceMeters correctly', () => {
    const loc: MsgLocation = { x: 1, y: 1 };

    // No distance
    const m1 = msgAt('text', 1, '#111', loc);
    assert.equal(m1.distanceMeters, undefined);

    // Valid distance (should be rounded and >= 0)
    const m2 = msgAt('text', 1, '#111', loc, 4.7);
    assert.equal(m2.distanceMeters, 5);

    const m3 = msgAt('text', 1, '#111', loc, -5.2);
    assert.equal(m3.distanceMeters, 0); // max(0, Math.round(-5.2)) -> 0

    // NaN / Infinity check for distance
    const m4 = msgAt('text', 1, '#111', loc, NaN);
    assert.equal(m4.distanceMeters, undefined);

    const m5 = msgAt('text', 1, '#111', loc, Infinity);
    assert.equal(m5.distanceMeters, undefined);
  });

  test('applies Math.floor to id fields', () => {
    const loc: MsgLocation = {
      x: 10.5,
      y: -20.5,
      actorId: 5.9,
      targetId: -8.1,
      roomId: 42.5,
      zoneId: 3.2,
    };
    const m = msgAt('Test float', 123, '#000', loc);

    // x and y don't have Math.floor applied
    assert.equal(m.x, 10.5);
    assert.equal(m.y, -20.5);
    // id fields are floored
    assert.equal(m.actorId, 5);
    assert.equal(m.targetId, -9);
    assert.equal(m.roomId, 42);
    assert.equal(m.zoneId, 3);
  });

  test('filters out Infinity and -Infinity from location', () => {
    const loc: MsgLocation = {
      x: Infinity,
      y: -Infinity,
      actorId: Infinity,
      targetId: -Infinity,
      roomId: Infinity,
      zoneId: -Infinity,
    };
    const m = msgAt('Test Infinity', 123, '#000', loc);

    assert.equal(m.x, undefined);
    assert.equal(m.y, undefined);
    assert.equal(m.actorId, undefined);
    assert.equal(m.targetId, undefined);
    assert.equal(m.roomId, undefined);
    assert.equal(m.zoneId, undefined);
  });

  test('filters out NaN from location', () => {
    const loc: MsgLocation = {
      x: NaN,
      y: NaN,
      actorId: NaN,
      targetId: NaN,
      roomId: NaN,
      zoneId: NaN,
    };
    const m = msgAt('Test NaN', 123, '#000', loc);

    assert.equal(m.x, undefined);
    assert.equal(m.y, undefined);
    assert.equal(m.actorId, undefined);
    assert.equal(m.targetId, undefined);
    assert.equal(m.roomId, undefined);
    assert.equal(m.zoneId, undefined);
  });

  test('handles missing location properties gracefully', () => {
    const loc: MsgLocation = {};
    const m = msgAt('Test missing', 123, '#000', loc);

    assert.equal(m.x, undefined);
    assert.equal(m.y, undefined);
    assert.equal(m.actorId, undefined);
    assert.equal(m.targetId, undefined);
    assert.equal(m.roomId, undefined);
    assert.equal(m.zoneId, undefined);
    assert.equal(m.floor, undefined);
  });

  test('overrides base location properties from _msgLocationProvider if provided', () => {
    const baseLoc: MsgLocation = { x: 100, y: 100, roomId: 50 };
    setMsgLocationProvider(() => baseLoc);

    const specificLoc: MsgLocation = { x: 50, y: 50, actorId: 10 };
    const m = msgAt('text', 1, '#111', specificLoc);

    // In msgAt, base is created which spreads location provider properties.
    // Then msgAt returns an object spreading base, and then explicitly overriding properties with `specificLoc`.
    // So specificLoc properties should win if they are valid, otherwise baseLoc properties might leak in?
    // Let's verify how msgAt works.
    // return { ...base, floor: location.floor, x, y, actorId, targetId, roomId, zoneId }
    // If specificLoc.roomId is undefined, msgAt explicitly sets roomId to undefined in the returned object,
    // overriding the baseLoc.roomId! Let's assert this behavior.
    assert.equal(m.x, 50); // From specificLoc
    assert.equal(m.y, 50); // From specificLoc
    assert.equal(m.roomId, undefined); // specificLoc.roomId is undefined, so the override explicitly sets it to undefined
    assert.equal(m.actorId, 10); // From specificLoc
  });
});
