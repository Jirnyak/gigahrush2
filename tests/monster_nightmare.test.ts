import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, FloorLevel, MonsterKind, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { DEF, generateSprite, generateNightmareSprite } from '../src/entities/nightmare';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { updateMonster, setEntityMap } from '../src/systems/ai/monster';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { getEntityIndex, rebuildEntityIndex } from '../src/systems/entity_index';
import { monsterSpr } from '../src/render/sprite_index';
import { S } from '../src/render/pixutil';
import { makeGameState, addTestRoom } from './helpers';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.zoneMap.fill(0);
  world.zones[0] = {
    id: 0,
    cx: 10,
    cy: 10,
    faction: 0,
    hasLift: false,
    fogged: false,
    level: 1,
    hqRoomId: -1,
  };
  return world;
}

function player(x: number, y: number): Entity {
  return {
    id: 1,
    type: EntityType.NPC, persistentNpcId: 'player',
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    hp: 100,
    maxHp: 100,
    name: 'Вы',
    faction: Faction.PLAYER,
  };
}

function nightmare(id: number, x: number, y: number): Entity {
  return {
    id,
    type: EntityType.MONSTER,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: DEF.speed,
    sprite: monsterSpr(MonsterKind.NIGHTMARE),
    hp: DEF.hp,
    maxHp: DEF.hp,
    monsterKind: MonsterKind.NIGHTMARE,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function prime(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  getEntityIndex().beginTelemetryFrame();
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

test('nightmare definition, ecology, and sprite generation', () => {
  const ecology = getMonsterEcology(MonsterKind.NIGHTMARE);

  assert.equal(DEF.kind, MonsterKind.NIGHTMARE);
  assert.equal(DEF.hp, 260);
  assert.deepEqual(DEF.floors, [FloorLevel.MINISTRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL, FloorLevel.VOID]);
  assert.equal(ecology?.rare, true);

  const sprite1 = generateNightmareSprite(123);
  const sprite2 = generateNightmareSprite(456);

  assert.equal(sprite1.length, 128 * 128);
  assert.equal(sprite2.length, 128 * 128);

  let opaque1 = 0;
  for (const px of sprite1) {
    if ((px >>> 24) > 0) opaque1++;
  }
  assert.ok(opaque1 > 100, 'nightmare sprite should have generated opaque body pixels');

  let differentPixels = 0;
  for (let i = 0; i < sprite1.length; i++) {
    if (sprite1[i] !== sprite2[i]) differentPixels++;
  }
  assert.ok(differentPixels > 0, 'nightmare sprites with different seeds should differ');
});

test('nightmare pressure builds up when player is in range and same room', () => {
  const world = openWorld();
  addTestRoom(world, { x: 5, y: 5, w: 10, h: 10 });
  const target = player(10, 10);
  const beast = nightmare(2, 11, 11);
  const entities = [target, beast];
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];
  state.time = 1;

  prime(entities);
  updateMonster(world, entities, beast, 1.0, state.time, msgs, target.id, { v: 10 }, state);

  assert.ok((beast.monsterDmgMult ?? 1) > 1, 'monsterDmgMult should increase from pressure buildup');

  const sighted = getRecentEvents(state, { type: 'monster_sighted', tags: ['nightmare'], limit: 1 })[0];
  assert.ok(sighted, 'monster_sighted event with pressure warning should be emitted');
  assert.equal(sighted.tags.includes('warning'), true);
});

test('nightmare pressure decays when player leaves the room', () => {
  const world = openWorld();
  addTestRoom(world, { x: 5, y: 5, w: 10, h: 10 });
  const target = player(10, 10);
  const beast = nightmare(2, 11, 11);
  const entities = [target, beast];
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];
  state.time = 1;

  prime(entities);
  updateMonster(world, entities, beast, 2.0, state.time, msgs, target.id, { v: 10 }, state);
  assert.ok((beast.monsterDmgMult ?? 1) > 1, 'pressure should be built');

  // Move target outside the room
  target.x = 1;
  target.y = 1;

  state.time = 2;
  prime(entities);
  updateMonster(world, entities, beast, 2.0, state.time, msgs, target.id, { v: 10 }, state);

  assert.equal(beast.monsterDmgMult, undefined, 'pressure should have decayed fully');

  const interrupted = getRecentEvents(state, { type: 'monster_windup_interrupted', limit: 1 })[0];
  assert.ok(interrupted, 'monster_windup_interrupted event should be emitted');
  assert.equal(interrupted.data?.reason, 'left_room_or_range');
});

test('nightmare pressure breaks from heavy burst damage', () => {
  const world = openWorld();
  addTestRoom(world, { x: 5, y: 5, w: 10, h: 10 });
  const target = player(10, 10);
  const beast = nightmare(2, 11, 11);
  const entities = [target, beast];
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];
  state.time = 1;

  prime(entities);
  updateMonster(world, entities, beast, 2.0, state.time, msgs, target.id, { v: 10 }, state);
  assert.ok((beast.monsterDmgMult ?? 1) > 1, 'pressure should be built');

  beast.hp = 200; // Simulated heavy burst damage (260 -> 200 = 60 dmg, threshold is 34)
  state.time = 2;
  prime(entities);
  updateMonster(world, entities, beast, 0.1, state.time, msgs, target.id, { v: 10 }, state);

  assert.ok((beast.attackCd ?? 0) >= 0.55, 'attackCd should be increased from stagger');
  // In the same frame, the scaling is overridden by the > 0 pressure branch
  // So we only assert on attackCd and events.

  const interrupted = getRecentEvents(state, { type: 'monster_windup_interrupted', limit: 1 })[0];
  assert.ok(interrupted, 'monster_windup_interrupted event should be emitted');
  assert.equal(interrupted.data?.reason, 'burst_damage');
});
