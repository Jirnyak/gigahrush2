import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  AIGoal,
  Cell,
  DoorState,
  Faction,
  NpcState,
  Occupation,
  RoomType,
  Tex,
  type Room,
  ZoneFaction,
} from '../src/core/types';
import { World } from '../src/core/world';
import {
  applyNpcEmergencyDecision,
  chooseNpcEmergencyDecision,
  chooseNpcEmergencyIntent,
  collectNpcEmergencyShelterCandidates,
} from '../src/systems/ai/npc_emergency';
import { addTestRoom, makeTestNpc, makeTestPlayer } from './helpers';

function makeAi() {
  return { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [] as number[], pi: 0, stuck: 0, timer: 5 };
}

function addDoor(world: World, room: Room, state: DoorState): number {
  const x = world.wrap(room.x + room.w);
  const y = world.wrap(room.y + Math.max(1, Math.floor(room.h / 2)));
  const idx = world.idx(x, y);
  world.set(x, y, Cell.DOOR);
  world.roomMap[idx] = room.id;
  world.zoneMap[idx] = world.zoneMap[world.idx(room.x, room.y)];
  world.wallTex[idx] = Tex.CONCRETE;
  world.floorTex[idx] = room.floorTex;
  world.doors.set(idx, { idx, state, roomA: room.id, roomB: -1, keyId: '', timer: 0 });
  room.doors.push(idx);

  const hallX = world.wrap(x + 1);
  const hallIdx = world.idx(hallX, y);
  world.set(hallX, y, Cell.FLOOR);
  world.zoneMap[hallIdx] = world.zoneMap[idx];
  return idx;
}

test('citizen warning picks bounded deterministic local shelter candidates', () => {
  const world = new World();
  const current = addTestRoom(world, { id: 1, x: 10, y: 10, w: 5, h: 5, type: RoomType.COMMON, zoneFaction: ZoneFaction.CITIZEN });
  const local = addTestRoom(world, { id: 2, x: 18, y: 10, w: 5, h: 5, type: RoomType.LIVING, zoneFaction: ZoneFaction.CITIZEN });
  const far = addTestRoom(world, { id: 3, x: 70, y: 70, w: 5, h: 5, type: RoomType.LIVING, zoneFaction: ZoneFaction.CITIZEN });
  const unreachable = addTestRoom(world, { id: 90, x: 200, y: 200, w: 5, h: 5, type: RoomType.LIVING, zoneFaction: ZoneFaction.CITIZEN });
  addDoor(world, current, DoorState.OPEN);
  addDoor(world, local, DoorState.HERMETIC_OPEN);
  addDoor(world, far, DoorState.HERMETIC_OPEN);
  addDoor(world, unreachable, DoorState.HERMETIC_OPEN);
  for (let i = 0; i < 14; i++) {
    const room = addTestRoom(world, { id: 20 + i, x: 24 + i * 2, y: 12, w: 2, h: 2, type: RoomType.LIVING, zoneFaction: ZoneFaction.CITIZEN });
    addDoor(world, room, DoorState.CLOSED);
  }

  const npc = makeTestNpc({
    id: 10,
    x: 12,
    y: 12,
    faction: Faction.CITIZEN,
    ai: makeAi(),
  });

  const options = {
    phase: 'warning' as const,
    localShelterRoomIds: [local.id],
    shelterRoomIds: [far.id],
    candidateCap: 5,
    nearbyRadius: 18,
    seedSalt: 42,
  };
  const first = chooseNpcEmergencyDecision(world, npc, options);
  const second = chooseNpcEmergencyDecision(world, npc, options);

  assert.equal(first.intent.kind, 'seek_shelter');
  assert.equal(first.targetRoomId, local.id);
  assert.ok(first.candidates.length <= 5);
  assert.equal(first.candidates.some(candidate => candidate.roomId === unreachable.id), false);
  assert.deepEqual(
    first.candidates.map(candidate => [candidate.roomId, candidate.score.toFixed(4)]),
    second.candidates.map(candidate => [candidate.roomId, candidate.score.toFixed(4)]),
  );
});

test('liquidator intent is role based and wounded responders stop holding', () => {
  const healthy = makeTestNpc({
    id: 21,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    weapon: 'pistol',
    hp: 90,
    maxHp: 100,
  });
  const wounded = makeTestNpc({
    id: 22,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    weapon: 'pistol',
    hp: 30,
    maxHp: 100,
  });

  const healthyIntent = chooseNpcEmergencyIntent(healthy, { phase: 'active' });
  const woundedIntent = chooseNpcEmergencyIntent(wounded, { phase: 'active' });

  assert.equal(healthyIntent.role, 'liquidator');
  assert.equal(healthyIntent.kind, 'hold_corridor');
  assert.equal(healthyIntent.aiGoal, AIGoal.HUNT);
  assert.equal(woundedIntent.kind, 'seek_shelter');
  assert.equal(woundedIntent.aiGoal, AIGoal.HIDE);
});

test('shelter scoring respects faction ownership without scanning all rooms', () => {
  const world = new World();
  const citizenShelter = addTestRoom(world, { id: 1, x: 12, y: 12, w: 5, h: 5, type: RoomType.LIVING, zoneId: 1, zoneFaction: ZoneFaction.CITIZEN });
  const cultShelter = addTestRoom(world, { id: 2, x: 12, y: 20, w: 5, h: 5, type: RoomType.LIVING, zoneId: 2, zoneFaction: ZoneFaction.CULTIST });
  const unlisted = addTestRoom(world, { id: 99, x: 22, y: 16, w: 5, h: 5, type: RoomType.LIVING, zoneId: 3, zoneFaction: ZoneFaction.CULTIST });
  addDoor(world, citizenShelter, DoorState.HERMETIC_OPEN);
  addDoor(world, cultShelter, DoorState.HERMETIC_OPEN);
  addDoor(world, unlisted, DoorState.HERMETIC_OPEN);

  const cultist = makeTestNpc({
    id: 31,
    x: 10,
    y: 18,
    faction: Faction.CULTIST,
    occupation: Occupation.PILGRIM,
    ai: makeAi(),
  });
  const citizen = makeTestNpc({
    id: 32,
    x: 10,
    y: 18,
    faction: Faction.CITIZEN,
    ai: makeAi(),
  });

  const baseOptions = {
    phase: 'active' as const,
    shelterRoomIds: [citizenShelter.id, cultShelter.id],
    includeNearbyRooms: false,
    seedSalt: 3,
  };
  assert.equal(chooseNpcEmergencyDecision(world, cultist, baseOptions).targetRoomId, cultShelter.id);
  assert.equal(chooseNpcEmergencyDecision(world, citizen, baseOptions).targetRoomId, citizenShelter.id);
  assert.equal(
    collectNpcEmergencyShelterCandidates(world, cultist, baseOptions).some(candidate => candidate.roomId === unlisted.id),
    false,
  );
});

test('samosbor shelter scans rotate per NPC instead of using one shared prefix', () => {
  const world = new World();
  const shelterIds: number[] = [];
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const room = addTestRoom(world, {
      id: 100 + i,
      x: 80 + Math.round(Math.cos(angle) * 32),
      y: 80 + Math.round(Math.sin(angle) * 32),
      w: 5,
      h: 5,
      type: RoomType.LIVING,
      zoneId: i,
      zoneFaction: ZoneFaction.CITIZEN,
    });
    addDoor(world, room, DoorState.HERMETIC_OPEN);
    shelterIds.push(room.id);
  }

  const candidateSets = new Set<string>();
  const targetRooms = new Set<number>();
  for (let i = 0; i < 8; i++) {
    const npc = makeTestNpc({
      id: 500 + i * 37,
      x: 80,
      y: 80,
      faction: Faction.CITIZEN,
      ai: makeAi(),
    });
    const options = {
      phase: 'active' as const,
      shelterRoomIds: shelterIds,
      shelterScanCap: 3,
      candidateCap: 3,
      includeNearbyRooms: false,
      seedSalt: 77,
    };
    candidateSets.add(collectNpcEmergencyShelterCandidates(world, npc, options).map(candidate => candidate.roomId).join(','));
    targetRooms.add(chooseNpcEmergencyDecision(world, npc, options).targetRoomId);
  }

  assert.equal(candidateSets.size > 1, true, `candidate sets ${[...candidateSets].join(' | ')}`);
  assert.equal(targetRooms.size > 1, true, `target rooms ${[...targetRooms].join(',')}`);
});

test('shelter crowd penalty counts room actors after unrelated local actors', () => {
  const world = new World();
  const crowded = addTestRoom(world, { id: 11, x: 22, y: 10, w: 5, h: 5, type: RoomType.LIVING, zoneFaction: ZoneFaction.CITIZEN });
  const empty = addTestRoom(world, { id: 12, x: 22, y: 22, w: 5, h: 5, type: RoomType.LIVING, zoneFaction: ZoneFaction.CITIZEN });
  addDoor(world, crowded, DoorState.HERMETIC_OPEN);
  addDoor(world, empty, DoorState.HERMETIC_OPEN);
  const npc = makeTestNpc({
    id: 50,
    x: 12,
    y: 16,
    faction: Faction.CITIZEN,
    ai: makeAi(),
  });
  const unrelated = Array.from({ length: 16 }, (_, i) => makeTestNpc({ id: 100 + i, x: 80 + i, y: 80 }));
  const inCrowded = Array.from({ length: 5 }, (_, i) => makeTestNpc({ id: 200 + i, x: crowded.x + 1 + i * 0.25, y: crowded.y + 1 }));

  const options = {
    phase: 'active' as const,
    shelterRoomIds: [crowded.id, empty.id],
    includeNearbyRooms: false,
    localActors: [...unrelated, ...inCrowded],
    localActorCap: 16,
    seedSalt: 9,
  };
  const candidates = collectNpcEmergencyShelterCandidates(world, npc, options);
  const crowdedCandidate = candidates.find(candidate => candidate.roomId === crowded.id);
  const emptyCandidate = candidates.find(candidate => candidate.roomId === empty.id);

  assert.ok(crowdedCandidate);
  assert.ok(emptyCandidate);
  assert.ok(crowdedCandidate.crowdPenalty > 0);
  assert.ok(crowdedCandidate.score < emptyCandidate.score);
  assert.equal(chooseNpcEmergencyDecision(world, npc, options).targetRoomId, empty.id);
});

test('apply emergency decision only stamps one NPC AI target', () => {
  const world = new World();
  const shelter = addTestRoom(world, { id: 7, x: 30, y: 30, w: 5, h: 5, type: RoomType.LIVING, zoneFaction: ZoneFaction.CITIZEN });
  addDoor(world, shelter, DoorState.HERMETIC_OPEN);
  const npc = makeTestNpc({
    id: 44,
    x: 28,
    y: 31,
    faction: Faction.CITIZEN,
    playerRelation: 70,
    ai: makeAi(),
  });
  const player = makeTestPlayer({ id: 1, x: 31, y: 31 });
  const decision = chooseNpcEmergencyDecision(world, npc, {
    phase: 'active',
    localShelterRoomIds: [shelter.id],
    player,
    includeNearbyRooms: false,
  });

  assert.equal(applyNpcEmergencyDecision(npc, decision), true);
  assert.equal(npc.ai?.goal, AIGoal.HIDE);
  assert.equal(npc.ai?.npcState, NpcState.HIDING);
  assert.equal(npc.ai?.tx, decision.targetCellX);
  assert.equal(npc.ai?.ty, decision.targetCellY);
  assert.deepEqual(npc.ai?.path, []);
});
