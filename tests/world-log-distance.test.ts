import test from 'node:test';
import assert from 'node:assert/strict';

import { FloorLevel, msg, setMsgLocationProvider } from '../src/core/types';
import { createWorldEventState, getRecentEvents, publishEvent } from '../src/systems/events';
import { setWorldLogSpatialContext, worldLogDistanceForLocation } from '../src/systems/world_log';
import { makeGameState } from './helpers';

test('localized world log events carry distance from event coordinates', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });
  setWorldLogSpatialContext({
    floor: FloorLevel.LIVING,
    playerX: 10,
    playerY: 10,
    dist2: (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2,
  });

  try {
    publishEvent(state, {
      type: 'door_opened',
      x: 34,
      y: 10,
      severity: 3,
      privacy: 'local',
      tags: [],
    });

    assert.equal(state.msgLog.at(-1)?.distanceMeters, 24);
    assert.equal(state.msgs.at(-1)?.distanceMeters, 24);
  } finally {
    setWorldLogSpatialContext();
  }
});

test('localized world log events fall back to actor coordinates', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });
  setWorldLogSpatialContext({
    floor: FloorLevel.LIVING,
    playerX: 10,
    playerY: 10,
    dist2: (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2,
    entityPosition: entityId => entityId === 91 ? { x: 34, y: 10 } : undefined,
  });

  try {
    publishEvent(state, {
      type: 'npc_kill_npc',
      actorId: 91,
      actorName: 'Теневик',
      targetId: 92,
      targetName: 'Павел Подзалог',
      severity: 4,
      privacy: 'local',
      tags: ['combat', 'kill'],
    });

    assert.equal(state.msgLog.at(-1)?.text, 'Теневик убил Павел Подзалог.');
    assert.equal(state.msgLog.at(-1)?.distanceMeters, 24);
    assert.equal(state.msgs.at(-1)?.distanceMeters, 24);
  } finally {
    setWorldLogSpatialContext();
  }
});

test('death world log facts dedupe by target id after unrelated events', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });

  publishEvent(state, {
    type: 'npc_kill_monster',
    actorId: 91,
    actorName: 'Светлана Петрова',
    targetId: 92,
    targetName: 'Тень',
    severity: 3,
    privacy: 'local',
    tags: ['combat', 'kill', 'monster'],
  });
  publishEvent(state, {
    type: 'door_opened',
    zoneId: 3,
    severity: 3,
    privacy: 'local',
    tags: [],
  });
  state.time = 70;
  state.clock.totalMinutes = 1;
  state.clock.minute = 1;
  publishEvent(state, {
    type: 'npc_kill_monster',
    actorId: 91,
    actorName: 'Светлана Петрова',
    targetId: 92,
    targetName: 'Тень',
    severity: 3,
    privacy: 'local',
    tags: ['combat', 'kill', 'monster'],
  });
  publishEvent(state, {
    type: 'npc_kill_monster',
    actorId: 91,
    actorName: 'Светлана Петрова',
    targetId: 93,
    targetName: 'Тень',
    severity: 3,
    privacy: 'local',
    tags: ['combat', 'kill', 'monster'],
  });

  const killLogs = state.msgLog.filter(entry => entry.text === 'Светлана Петрова убил Тень.');
  const killMsgs = state.msgs.filter(entry => entry.text === 'Светлана Петрова убил Тень.');
  assert.equal(killLogs.length, 2);
  assert.equal(killMsgs.length, 2);
});

test('localized world log events fall back to zone center distance', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });
  setWorldLogSpatialContext({
    floor: FloorLevel.LIVING,
    playerX: 10,
    playerY: 10,
    dist2: (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2,
    zoneCenter: zoneId => zoneId === 54 ? { x: 65, y: 10 } : undefined,
  });

  try {
    publishEvent(state, {
      type: 'faction_relation_changed',
      zoneId: 54,
      severity: 3,
      privacy: 'local',
      tags: [],
    });

    assert.match(state.msgLog.at(-1)?.text ?? '', /Фракционный сдвиг: зона 55/);
    assert.equal(state.msgLog.at(-1)?.distanceMeters, 55);
    assert.equal(state.msgs.at(-1)?.distanceMeters, 55);
    assert.equal(worldLogDistanceForLocation({ floor: FloorLevel.KVARTIRY, zoneId: 54 }), undefined);
  } finally {
    setWorldLogSpatialContext();
  }
});

test('territory capture faction events stay out of HUD and full log', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });
  setWorldLogSpatialContext({
    floor: FloorLevel.LIVING,
    playerX: 10,
    playerY: 10,
    dist2: (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2,
  });

  try {
    publishEvent(state, {
      type: 'faction_event',
      zoneId: 36,
      x: 12,
      y: 10,
      severity: 4,
      privacy: 'local',
      tags: ['faction_event', 'territory_capture', 'cell_territory'],
      data: { phase: 'territory_capture', name: 'Захват клеток', cells: 24 },
    });

    assert.equal(state.msgLog.length, 0);
    assert.equal(state.msgs.length, 0);
    assert.equal(getRecentEvents(state, { tags: ['territory_capture'], limit: 1 }).length, 1);
  } finally {
    setWorldLogSpatialContext();
  }
});

test('localized world log events fall back to room center distance', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });
  setWorldLogSpatialContext({
    floor: FloorLevel.LIVING,
    playerX: 10,
    playerY: 10,
    dist2: (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2,
    roomCenter: roomId => roomId === 7 ? { x: 10, y: 31 } : undefined,
  });

  try {
    publishEvent(state, {
      type: 'room_lacked_resources',
      roomId: 7,
      severity: 3,
      privacy: 'local',
      tags: [],
    });

    assert.equal(state.msgLog.at(-1)?.distanceMeters, 21);
    assert.equal(state.msgs.at(-1)?.distanceMeters, 21);
  } finally {
    setWorldLogSpatialContext();
  }
});

test('localized world log events beyond hearing radius stay out of HUD and log', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });
  setWorldLogSpatialContext({
    floor: FloorLevel.LIVING,
    playerX: 10,
    playerY: 10,
    audibleRadiusMeters: 50,
    dist2: (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2,
    zoneCenter: zoneId => zoneId === 54 ? { x: 65, y: 10 } : undefined,
  });

  try {
    publishEvent(state, {
      type: 'faction_relation_changed',
      zoneId: 54,
      severity: 3,
      privacy: 'local',
      tags: [],
    });

    assert.equal(state.msgLog.length, 0);
    assert.equal(state.msgs.length, 0);
  } finally {
    setWorldLogSpatialContext();
  }
});

test('plain messages inherit active AI actor location before log stamping', () => {
  setMsgLocationProvider(() => ({ floor: FloorLevel.LIVING, x: 42, y: 10, actorId: 777 }));
  const line = msg('Теневик убил Павел Подзалог', 1, '#f44');
  setMsgLocationProvider();

  assert.equal(line.x, 42);
  assert.equal(line.y, 10);
  assert.equal(line.actorId, 777);
});
