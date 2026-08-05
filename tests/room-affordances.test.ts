import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Feature, RoomType } from '../src/core/types';
import {
  ROOM_AFFORDANCES,
  roomAffordanceDef,
  roomAffordanceTags,
  roomAffordanceWeight,
  roomExpectedFeatures,
  roomSupports,
} from '../src/data/room_affordances';
import { npcUtilityRoomTypeWeightForIntent } from '../src/systems/ai/npc_utility';

const ALL_ROOM_TYPES = Object.values(RoomType).filter(value => typeof value === 'number') as RoomType[];

test('every RoomType has a room affordance registry row', () => {
  for (const type of ALL_ROOM_TYPES) {
    assert.equal(ROOM_AFFORDANCES[type]?.roomType, type, `${RoomType[type]} should have affordance metadata`);
    assert.ok(roomAffordanceTags(type).length > 0, `${RoomType[type]} should expose tags`);
  }
});

test('core living affordances are centralized by room type', () => {
  assert.equal(roomSupports(RoomType.KITCHEN, 'eat'), true);
  assert.equal(roomSupports(RoomType.KITCHEN, 'drink'), true);
  assert.equal(roomSupports(RoomType.BATHROOM, 'toilet'), true);
  assert.equal(roomSupports(RoomType.BATHROOM, 'drink'), true);
  assert.equal(roomSupports(RoomType.LIVING, 'sleep'), true);
  assert.equal(roomSupports(RoomType.LIVING, 'hide'), true);
  assert.equal(roomSupports(RoomType.LIVING, 'shelter'), true);
  assert.equal(roomSupports(RoomType.PRODUCTION, 'work'), true);
  assert.equal(roomSupports(RoomType.OFFICE, 'work'), true);
  assert.equal(roomSupports(RoomType.MEDICAL, 'heal'), true);
  assert.equal(roomSupports(RoomType.STORAGE, 'store'), true);
  assert.equal(roomSupports(RoomType.STORAGE, 'shelter'), true);
  assert.equal(roomSupports(RoomType.MEDICAL, 'shelter'), true);
  assert.equal(roomSupports(RoomType.OFFICE, 'shelter'), true);
  assert.equal(roomSupports(RoomType.COMMON, 'social'), true);
  assert.equal(roomSupports(RoomType.SMOKING, 'social'), true);
  assert.equal(roomSupports(RoomType.HQ, 'patrol'), true);
  assert.equal(roomSupports(RoomType.HQ, 'shelter'), true);
});

test('room expected features describe feature-first interactable surfaces', () => {
  assert.equal(roomExpectedFeatures(RoomType.KITCHEN).includes(Feature.STOVE), true);
  assert.equal(roomExpectedFeatures(RoomType.BATHROOM).includes(Feature.TOILET), true);
  assert.equal(roomExpectedFeatures(RoomType.PRODUCTION).includes(Feature.MACHINE), true);
  assert.equal(roomExpectedFeatures(RoomType.OFFICE).includes(Feature.DESK), true);
});

test('NPC utility target scoring consumes room affordance weights for base intents', () => {
  assert.equal(npcUtilityRoomTypeWeightForIntent('eat', RoomType.KITCHEN), roomAffordanceWeight(RoomType.KITCHEN, 'eat'));
  assert.equal(npcUtilityRoomTypeWeightForIntent('drink', RoomType.BATHROOM), roomAffordanceWeight(RoomType.BATHROOM, 'drink'));
  assert.equal(npcUtilityRoomTypeWeightForIntent('sleep', RoomType.LIVING), roomAffordanceWeight(RoomType.LIVING, 'sleep'));
  assert.equal(npcUtilityRoomTypeWeightForIntent('patrol', RoomType.CORRIDOR), roomAffordanceWeight(RoomType.CORRIDOR, 'patrol'));
});

test('routine safety keeps its narrower pre-registry room scoring', () => {
  assert.equal(npcUtilityRoomTypeWeightForIntent('safety', RoomType.LIVING), roomAffordanceWeight(RoomType.LIVING, 'shelter'));
  assert.equal(npcUtilityRoomTypeWeightForIntent('safety', RoomType.HQ), roomAffordanceWeight(RoomType.HQ, 'shelter'));
  assert.equal(npcUtilityRoomTypeWeightForIntent('safety', RoomType.COMMON), roomAffordanceWeight(RoomType.COMMON, 'shelter'));
  assert.equal(npcUtilityRoomTypeWeightForIntent('safety', RoomType.STORAGE), 0);
  assert.equal(npcUtilityRoomTypeWeightForIntent('flee', RoomType.MEDICAL), 0);
  assert.equal(npcUtilityRoomTypeWeightForIntent('flee', RoomType.OFFICE), 0);
});

test('room affordance def returns the full definition for a room type', () => {
  const livingDef = roomAffordanceDef(RoomType.LIVING);
  assert.deepEqual(livingDef, ROOM_AFFORDANCES[RoomType.LIVING]);

  const hqDef = roomAffordanceDef(RoomType.HQ);
  assert.deepEqual(hqDef, ROOM_AFFORDANCES[RoomType.HQ]);
});
