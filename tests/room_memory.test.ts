import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, FloorLevel } from '../src/core/types';
import { createWorldEventState, publishEvent } from '../src/systems/events';
import {
  ROOM_MEMORY_BITS,
  ROOM_MEMORY_CAP,
  clearRoomMemory,
  getRoomMemory,
  getRoomMemoryCount,
  roomMemoryHas,
  tickRoomMemory,
  roomMemoryIsHostile,
  roomMemoryIsHelpful,
  roomMemoryRevealsStash,
  roomMemoryPriceMultiplier,
  roomMemoryShouldRefuseService,
  roomMemoryShouldReportTouch,
} from '../src/systems/room_memory';
import { makeGameState } from './helpers';

test('room memory records public and local player deeds but ignores private events', () => {
  clearRoomMemory();
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  });

  publishEvent(state, {
    type: 'item_stolen',
    roomId: 7,
    zoneId: 1,
    actorId: 12,
    actorName: 'Игрок',
    actorFaction: Faction.PLAYER,
    severity: 4,
    privacy: 'witnessed',
    tags: ['container', 'theft', 'witnessed'],
  });
  publishEvent(state, {
    type: 'item_stolen',
    roomId: 8,
    zoneId: 1,
    actorId: 12,
    actorFaction: Faction.PLAYER,
    severity: 5,
    privacy: 'private',
    tags: ['container', 'theft'],
  });

  const memory = getRoomMemory(FloorLevel.LIVING, 7);
  assert.ok(memory);
  assert.equal(roomMemoryHas(memory, ROOM_MEMORY_BITS.THEFT), true);
  assert.equal(memory.severity, 4);
  assert.equal(getRoomMemory(FloorLevel.LIVING, 8), undefined);
});

test('room memory decays on slow ticks and expires without a save shape', () => {
  clearRoomMemory();
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  });
  publishEvent(state, {
    type: 'item_deposited',
    roomId: 3,
    zoneId: 0,
    actorId: 1,
    actorFaction: Faction.PLAYER,
    severity: 3,
    privacy: 'local',
    tags: ['container', 'resident_relief', 'relief'],
  });

  const before = getRoomMemory(FloorLevel.LIVING, 3);
  assert.ok(before);
  const ttl = before.ttl;
  const severity = before.severity;
  tickRoomMemory(state.time, 181);
  const decayed = getRoomMemory(FloorLevel.LIVING, 3);
  assert.ok(decayed);
  assert.ok(decayed.ttl < ttl);
  assert.ok(decayed.severity < severity || decayed.ttl <= ttl - 181);

  tickRoomMemory(state.time + ttl + 10, ttl + 10);
  assert.equal(getRoomMemory(FloorLevel.LIVING, 3), undefined);
});

test('room memory keeps only the bounded newest/highest records', () => {
  clearRoomMemory();
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  });

  for (let roomId = 0; roomId < ROOM_MEMORY_CAP + 8; roomId++) {
    state.time = roomId;
    publishEvent(state, {
      type: 'player_kill_monster',
      roomId,
      zoneId: roomId % 4,
      actorId: 1,
      actorFaction: Faction.PLAYER,
      severity: 3,
      privacy: 'local',
      tags: ['combat', 'kill', 'monster'],
    });
  }

  assert.equal(getRoomMemoryCount(), ROOM_MEMORY_CAP);
  assert.equal(getRoomMemory(FloorLevel.LIVING, 0), undefined);
  assert.ok(getRoomMemory(FloorLevel.LIVING, ROOM_MEMORY_CAP + 7));
});

test('room memory accumulates bits, max severity and max ttl across multiple events', () => {
  clearRoomMemory();
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  });

  // First event: theft, severity 2
  publishEvent(state, {
    type: 'item_stolen',
    roomId: 10,
    zoneId: 2,
    actorId: 1,
    actorName: 'Игрок',
    actorFaction: Faction.PLAYER,
    severity: 2,
    privacy: 'local',
    tags: ['theft'],
  });

  const memory1 = getRoomMemory(FloorLevel.LIVING, 10);
  assert.ok(memory1);
  assert.equal(memory1.bits, ROOM_MEMORY_BITS.THEFT);
  assert.equal(memory1.severity, 2);
  const ttl1 = memory1.ttl;
  assert.ok(ttl1 > 0);

  // Second event: combat, severity 4
  publishEvent(state, {
    type: 'player_kill_monster',
    roomId: 10,
    zoneId: 2,
    actorId: 1,
    actorFaction: Faction.PLAYER,
    severity: 4,
    privacy: 'local',
    tags: ['combat'],
  });

  const memory2 = getRoomMemory(FloorLevel.LIVING, 10);
  assert.ok(memory2);
  assert.equal(memory2.bits, ROOM_MEMORY_BITS.THEFT | ROOM_MEMORY_BITS.COMBAT);
  assert.equal(memory2.severity, 4);
  assert.ok(memory2.ttl > ttl1); // Combat event with severity 4 should have a higher TTL
});

test('roomMemoryIsHostile and roomMemoryIsHelpful correctly identify record types based on bits', () => {
  assert.equal(roomMemoryIsHostile(undefined), false);
  assert.equal(roomMemoryIsHelpful(undefined), false);

  assert.equal(roomMemoryIsHostile({ bits: ROOM_MEMORY_BITS.THEFT } as any), true);
  assert.equal(roomMemoryIsHostile({ bits: ROOM_MEMORY_BITS.COMBAT } as any), true);
  assert.equal(roomMemoryIsHostile({ bits: ROOM_MEMORY_BITS.SAMOSBOR } as any), false);
  assert.equal(roomMemoryIsHostile({ bits: ROOM_MEMORY_BITS.HELP } as any), false);

  assert.equal(roomMemoryIsHelpful({ bits: ROOM_MEMORY_BITS.HELP } as any), true);
  assert.equal(roomMemoryIsHelpful({ bits: ROOM_MEMORY_BITS.REPAIR } as any), true);
  assert.equal(roomMemoryIsHelpful({ bits: ROOM_MEMORY_BITS.INFORM } as any), true);
  assert.equal(roomMemoryIsHelpful({ bits: ROOM_MEMORY_BITS.COMBAT } as any), false);

  // Mixed bits
  assert.equal(roomMemoryIsHostile({ bits: ROOM_MEMORY_BITS.THEFT | ROOM_MEMORY_BITS.HELP } as any), true);
  assert.equal(roomMemoryIsHelpful({ bits: ROOM_MEMORY_BITS.THEFT | ROOM_MEMORY_BITS.HELP } as any), true);
});

test('room memory outcome helpers compute valid thresholds for interactions', () => {
  assert.equal(roomMemoryRevealsStash(undefined), false);
  assert.equal(roomMemoryRevealsStash({ bits: ROOM_MEMORY_BITS.HELP, severity: 2 } as any), false);
  assert.equal(roomMemoryRevealsStash({ bits: ROOM_MEMORY_BITS.THEFT | ROOM_MEMORY_BITS.HELP, severity: 3 } as any), false); // Hostile overrides
  assert.equal(roomMemoryRevealsStash({ bits: ROOM_MEMORY_BITS.HELP, severity: 3 } as any), true);
  assert.equal(roomMemoryRevealsStash({ bits: ROOM_MEMORY_BITS.REPAIR, severity: 4 } as any), true);
  assert.equal(roomMemoryRevealsStash({ bits: ROOM_MEMORY_BITS.SAMOSBOR, severity: 3 } as any), true);

  assert.equal(roomMemoryPriceMultiplier(undefined), 1);
  assert.equal(roomMemoryPriceMultiplier({ bits: 0, severity: 3 } as any), 1);
  assert.equal(roomMemoryPriceMultiplier({ bits: ROOM_MEMORY_BITS.THEFT, severity: 3 } as any), 1.18);
  assert.equal(roomMemoryPriceMultiplier({ bits: ROOM_MEMORY_BITS.THEFT, severity: 4 } as any), 1.35);
  assert.equal(roomMemoryPriceMultiplier({ bits: ROOM_MEMORY_BITS.THEFT, severity: 5 } as any), 1.35);

  assert.equal(roomMemoryPriceMultiplier({ bits: ROOM_MEMORY_BITS.HELP, severity: 3 } as any), 0.9);
  assert.equal(roomMemoryPriceMultiplier({ bits: ROOM_MEMORY_BITS.HELP, severity: 4 } as any), 0.82);

  assert.equal(roomMemoryPriceMultiplier({ bits: ROOM_MEMORY_BITS.THEFT | ROOM_MEMORY_BITS.HELP, severity: 4 } as any), 1.35); // Hostile wins

  assert.equal(roomMemoryShouldRefuseService(undefined), false);
  assert.equal(roomMemoryShouldRefuseService({ bits: ROOM_MEMORY_BITS.THEFT, severity: 3 } as any), false);
  assert.equal(roomMemoryShouldRefuseService({ bits: ROOM_MEMORY_BITS.THEFT, severity: 4 } as any), true);
  assert.equal(roomMemoryShouldRefuseService({ bits: ROOM_MEMORY_BITS.HELP, severity: 5 } as any), false);

  assert.equal(roomMemoryShouldReportTouch(undefined), false);
  assert.equal(roomMemoryShouldReportTouch({ bits: ROOM_MEMORY_BITS.COMBAT, severity: 2 } as any), false);
  assert.equal(roomMemoryShouldReportTouch({ bits: ROOM_MEMORY_BITS.COMBAT, severity: 3 } as any), true);
  assert.equal(roomMemoryShouldReportTouch({ bits: ROOM_MEMORY_BITS.HELP, severity: 5 } as any), false);
});
