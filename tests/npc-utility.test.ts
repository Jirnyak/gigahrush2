import test from 'node:test';
import assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, NpcState, Occupation, RoomType, type Entity, type GameClock } from '../src/core/types';
import { World } from '../src/core/world';
import {
  chooseStableNpcUtilityTarget,
  createNpcUtilityScoreBuffer,
  getNpcUtilityScore,
  npcUtilityIdentitySeed,
  npcUtilityJitter01,
  npcUtilityRhythmBias,
  npcUtilityWorkRoomTypeWeight,
  scoreNpcUtilities,
  scoreNpcUtilityTargetPreference,
  selectNpcUtilityIntent,
  setNpcUtilityScore,
  shouldSwitchNpcUtilityIntent,
  type NpcUtilityTargetCandidate,
} from '../src/systems/ai/npc_utility';
import { forceHide, updateNPC } from '../src/systems/ai/npc_fsm';
import { getEntityIndex, rebuildEntityIndexForSimulation } from '../src/systems/entity_index';
import { addTestRoom, makeTestPlayer } from './helpers';

function makeUtilityWorld(): World {
  const world = new World();
  for (let y = 0; y < 80; y++) {
    for (let x = 0; x < 80; x++) world.set(x, y, Cell.FLOOR);
  }
  addTestRoom(world, { id: 0, type: RoomType.LIVING, x: 5, y: 5, w: 8, h: 8 });
  addTestRoom(world, { id: 1, type: RoomType.KITCHEN, x: 20, y: 5, w: 8, h: 8 });
  addTestRoom(world, { id: 2, type: RoomType.BATHROOM, x: 35, y: 5, w: 8, h: 8 });
  addTestRoom(world, { id: 3, type: RoomType.PRODUCTION, x: 50, y: 5, w: 8, h: 8 });
  addTestRoom(world, { id: 4, type: RoomType.COMMON, x: 20, y: 25, w: 8, h: 8 });
  return world;
}

function makeUtilityNpc(id: number, needs: Entity['needs'], extra: Partial<Entity> = {}): Entity {
  return {
    id,
    type: EntityType.NPC,
    x: 8,
    y: 8,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    hp: 50,
    maxHp: 50,
    faction: Faction.CITIZEN,
    occupation: Occupation.MECHANIC,
    alifeId: id,
    needs,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    ...extra,
  };
}

function tickUtilityNpc(world: World, entities: Entity[], npc: Entity, clock: GameClock): void {
  rebuildEntityIndexForSimulation(entities, clock.totalMinutes);
  updateNPC(world, entities, npc, 1, clock.totalMinutes, clock, false);
}

test('NPC utility identity seed prefers stable A-Life identity over transient entity id', () => {
  const a = { entityId: 10, alifeId: 777 };
  const b = { entityId: 999, alifeId: 777 };
  const c = { entityId: 10, alifeId: 778 };

  assert.equal(npcUtilityIdentitySeed(a), npcUtilityIdentitySeed(b));
  assert.notEqual(npcUtilityIdentitySeed(a), npcUtilityIdentitySeed(c));
  assert.equal(npcUtilityJitter01(a, 'work'), npcUtilityJitter01(b, 'work'));
});

test('NPC utility scores urgent water over routine work without a hard schedule', () => {
  const scores = scoreNpcUtilities({
    identity: { alifeId: 42 },
    minuteOfDay: 630,
    needs: { food: 90, water: 5, sleep: 92, pee: 8, poo: 6 },
    role: {
      faction: Faction.CITIZEN,
      occupation: Occupation.LOCKSMITH,
      duty: 0.9,
      riskTolerance: 0.2,
    },
  });

  assert.equal(selectNpcUtilityIntent(scores).intent, 'drink');
  assert.ok(getNpcUtilityScore(scores, 'drink') > getNpcUtilityScore(scores, 'work'));
});

test('NPC utility rhythm is soft pressure rather than zero-or-one schedule state', () => {
  const identity = { alifeId: 1234 };
  const workHour = npcUtilityRhythmBias('work', 630, identity);
  const midnight = npcUtilityRhythmBias('work', 0, identity);
  const scores = scoreNpcUtilities({
    identity,
    minuteOfDay: 0,
    needs: { food: 100, water: 100, sleep: 100, pee: 0, poo: 0 },
    role: { faction: Faction.CITIZEN, occupation: Occupation.MECHANIC, duty: 0.8 },
  });

  assert.ok(workHour > midnight);
  assert.ok(getNpcUtilityScore(scores, 'work') > 10);
});

test('NPC utility hysteresis keeps close routine winners but yields to emergency intents', () => {
  const scores = createNpcUtilityScoreBuffer();
  setNpcUtilityScore(scores, 'work', 50);
  setNpcUtilityScore(scores, 'social', 55);

  const held = selectNpcUtilityIntent(scores, 'work', { switchMargin: 8 });
  assert.equal(held.intent, 'work');
  assert.equal(held.switched, false);
  assert.equal(shouldSwitchNpcUtilityIntent('social', 55, 'work', 50, { switchMargin: 8 }), false);

  setNpcUtilityScore(scores, 'flee', 59);
  const fled = selectNpcUtilityIntent(scores, 'work', { emergencyScore: 58 });
  assert.equal(fled.intent, 'flee');
  assert.equal(fled.switched, true);
  assert.equal(fled.emergency, true);
});

test('NPC utility threat scoring can choose flee over routine needs', () => {
  const scores = scoreNpcUtilities({
    identity: { alifeId: 91 },
    minuteOfDay: 640,
    hp: 30,
    maxHp: 100,
    needs: { food: 80, water: 80, sleep: 80, pee: 5, poo: 5 },
    threat: { danger: 1, visibleHostiles: 2, monster: 1, distance: 4, strongerHostile: true },
    role: {
      faction: Faction.CITIZEN,
      occupation: Occupation.SECRETARY,
      riskTolerance: 0.05,
      panicBias: 0.85,
      armed: false,
    },
  });

  const selected = selectNpcUtilityIntent(scores, 'work');
  assert.equal(selected.intent, 'flee');
  assert.equal(selected.emergency, true);
});

test('NPC utility target preference is stable across candidate order and respects work room affinity', () => {
  const targets: NpcUtilityTargetCandidate[] = [
    { id: 1, roomType: RoomType.PRODUCTION, utility: 10, distance: 12 },
    { id: 2, roomType: RoomType.PRODUCTION, utility: 10, distance: 12 },
    { id: 3, roomType: RoomType.OFFICE, utility: 10, distance: 12 },
  ];
  const context = {
    identity: { alifeId: 555 },
    intent: 'work' as const,
    occupation: Occupation.MECHANIC,
    faction: Faction.CITIZEN,
  };

  const forward = chooseStableNpcUtilityTarget(targets, context);
  const reversed = chooseStableNpcUtilityTarget([...targets].reverse(), context);
  assert.equal(forward?.id, reversed?.id);
  assert.ok(npcUtilityWorkRoomTypeWeight(Occupation.COOK, RoomType.KITCHEN) > npcUtilityWorkRoomTypeWeight(Occupation.COOK, RoomType.PRODUCTION));
  assert.ok(scoreNpcUtilityTargetPreference(targets[0], context) > scoreNpcUtilityTargetPreference(targets[2], context));
});

test('NPC runtime utility lets urgent thirst beat work at working hours', () => {
  const world = makeUtilityWorld();
  const player = makeTestPlayer({ id: 1, x: 70, y: 70 });
  const thirsty = makeUtilityNpc(10, { food: 90, water: 5, sleep: 90, pee: 5, poo: 5 });
  const worker = makeUtilityNpc(11, { food: 90, water: 90, sleep: 90, pee: 5, poo: 5 });
  const entities = [player, thirsty, worker];
  const clock = { hour: 9, minute: 0, totalMinutes: 9 * 60 };

  tickUtilityNpc(world, entities, thirsty, clock);
  tickUtilityNpc(world, entities, worker, clock);

  assert.equal(thirsty.ai?.goal, AIGoal.DRINK);
  assert.equal(thirsty.ai?.npcState, NpcState.LUNCH);
  assert.equal(worker.ai?.goal, AIGoal.WORK);
  assert.equal(worker.ai?.npcState, NpcState.WORKING);
});

test('NPC runtime utility does not force lunch from the noon clock edge', () => {
  const world = makeUtilityWorld();
  const player = makeTestPlayer({ id: 1, x: 70, y: 70 });
  const npc = makeUtilityNpc(12, { food: 100, water: 100, sleep: 100, pee: 0, poo: 0 });
  const entities = [player, npc];

  tickUtilityNpc(world, entities, npc, { hour: 12, minute: 0, totalMinutes: 12 * 60 });

  assert.notEqual(npc.ai?.goal, AIGoal.EAT);
  assert.notEqual(npc.ai?.npcState, NpcState.LUNCH);
});

test('samosbor forceHide enters shelter state without bypassing utility cadence', () => {
  const world = makeUtilityWorld();
  const player = makeTestPlayer({ id: 1, x: 70, y: 70 });
  const npc = makeUtilityNpc(13, { food: 100, water: 100, sleep: 100, pee: 0, poo: 0 });
  const entities = [player, npc];
  const clock = { hour: 5, minute: 0, totalMinutes: 5 * 60 };

  rebuildEntityIndexForSimulation(entities, 1);
  forceHide(entities, [], 100, world, clock);

  assert.equal(npc.ai?.goal, AIGoal.HIDE);
  assert.equal(npc.ai?.npcState, NpcState.HIDING);

  getEntityIndex().beginTelemetryFrame();
  updateNPC(world, entities, npc, 1 / 60, 100.016, clock, true);

  assert.equal(getEntityIndex().getDebugStats().queries.radiusCount, 0);
  assert.equal(npc.ai?.goal, AIGoal.HIDE);
  assert.equal(npc.ai?.npcState, NpcState.HIDING);
});
