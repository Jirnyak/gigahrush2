import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, FloorLevel, MonsterKind, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { DEF as CREATOR_DEF } from '../src/entities/creator';
import { DEF as MANCOBUS_DEF } from '../src/entities/mancobus';
import { DEF as NIGHTMARE_DEF } from '../src/entities/nightmare';
import { MONSTERS } from '../src/entities/monster';
import { Spr } from '../src/render/sprite_index';
import { setListenerPos } from '../src/systems/audio';
import { setEntityMap, tryMonsterProjectileStagger, updateMonster } from '../src/systems/ai/monster';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { makeGameState } from './helpers';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.zoneMap.fill(0);
  world.zones[0] = {
    id: 0,
    cx: 16,
    cy: 16,
    faction: 0,
    hasLift: false,
    fogged: false,
    level: 1,
    hqRoomId: -1,
  };
  setListenerPos(512, 512, world.dist2.bind(world));
  return world;
}

function aiState(x = 0, y = 0) {
  return { goal: AIGoal.IDLE, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 };
}

function player(x: number, y: number, hp = 220): Entity {
  return {
    id: 1,
    type: EntityType.NPC,
    persistentNpcId: 'player',
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    hp,
    maxHp: hp,
    name: 'Вы',
  };
}

function monster(kind: MonsterKind, x: number, y: number, id = 2): Entity {
  const def = MONSTERS[kind];
  return {
    id,
    type: EntityType.MONSTER,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: def.speed,
    sprite: def.sprite,
    hp: def.hp,
    maxHp: def.hp,
    monsterKind: kind,
    attackCd: 0,
    currentMag: 1,
    ai: aiState(x, y),
  };
}

function prepare(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

test('heavy ranged bosses use their own readable range, windup and counterplay data', () => {
  const world = openWorld();
  const target = player(27.5, 10.5);
  const threat = monster(MonsterKind.CREATOR, 10.5, 10.5);
  const entities = [target, threat];
  const state = makeGameState({ currentFloor: FloorLevel.VOID, worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  prepare(entities);
  updateMonster(world, entities, threat, 0.1, 1, msgs, target.id, { v: 10 }, state);

  assert.equal(threat.ai?.windupTimer, CREATOR_DEF.boss?.windupSec);
  assert.equal(threat.ai?.windupTargetId, target.id);
  assert.equal(msgs.some(m => m.text === CREATOR_DEF.boss?.warningLine), true);

  const sighted = getRecentEvents(state, { type: 'monster_sighted', tags: ['creator', 'boss_line_controller'], limit: 1 })[0];
  assert.ok(sighted);
  assert.equal(sighted.data?.shotRange, CREATOR_DEF.boss?.range);
  assert.equal(sighted.data?.minRange, CREATOR_DEF.boss?.minRange);
  assert.equal(sighted.data?.counterplay, CREATOR_DEF.boss?.counterplay);
  assert.deepEqual(sighted.data?.rumorIds, ['ecology_creator_white']);
});

test('heavy ranged boss windup is interrupted by cover and reports the boss line', () => {
  const world = openWorld();
  const target = player(24.5, 10.5);
  const threat = monster(MonsterKind.CREATOR, 10.5, 10.5);
  const entities = [target, threat];
  const state = makeGameState({ currentFloor: FloorLevel.VOID, worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  prepare(entities);
  updateMonster(world, entities, threat, 0.1, 1, msgs, target.id, { v: 10 }, state);
  assert.equal((threat.ai?.windupTimer ?? 0) > 0, true);

  world.cells[world.idx(17, 10)] = Cell.WALL;
  prepare(entities);
  updateMonster(world, entities, threat, 0.1, 1.1, msgs, target.id, { v: 10 }, state);

  assert.equal(threat.ai?.windupTimer, undefined);
  assert.equal(threat.ai?.windupTargetId, undefined);
  assert.equal((threat.attackCd ?? 0) >= 0.7, true);
  assert.equal(msgs.some(m => m.text === CREATOR_DEF.boss?.interruptLine), true);
  assert.equal(getRecentEvents(state, { type: 'monster_windup_interrupted', tags: ['creator', 'boss_line_controller'], limit: 1 }).length, 1);
});

test('heavy ranged boss phase cues are actor-local and progress one threshold at a time', () => {
  const world = openWorld();
  const target = player(20.5, 10.5);
  const threat = monster(MonsterKind.MANCOBUS, 10.5, 10.5);
  threat.hp = Math.floor(MANCOBUS_DEF.hp * 0.62);
  const entities = [target, threat];
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  prepare(entities);
  updateMonster(world, entities, threat, 0.1, 1, msgs, target.id, { v: 10 }, state);

  assert.equal(threat.ai?.bossPhaseIndex, 0);
  assert.equal(msgs.some(m => m.text === MANCOBUS_DEF.boss?.phases[0].line), true);
  const phase = getRecentEvents(state, { type: 'monster_sighted', tags: ['mancobus', 'boss_phase'], limit: 1 })[0];
  assert.ok(phase);
  assert.equal(phase.data?.phaseTag, MANCOBUS_DEF.boss?.phases[0].tag);
  assert.equal(phase.data?.counterplay, MANCOBUS_DEF.boss?.counterplay);
});

test('nightmare pressure is capped and breaks when the target leaves the room-scale range', () => {
  const world = openWorld();
  const target = player(14.5, 10.5, 1000);
  const threat = monster(MonsterKind.NIGHTMARE, 10.5, 10.5);
  threat.attackCd = 999;
  const entities = [target, threat];
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  for (let i = 0; i < 12; i++) {
    prepare(entities);
    updateMonster(world, entities, threat, 1, i + 1, msgs, target.id, { v: 10 }, state);
  }

  assert.equal(threat.monsterDmgMult, 1 + 4 * 0.1);
  assert.equal((threat.spriteScale ?? 1) <= 1.141, true);
  assert.equal(getRecentEvents(state, { type: 'monster_sighted', tags: ['nightmare', 'pressure'], limit: 1 }).length, 1);

  target.x = 30.5;
  for (let i = 0; i < 3; i++) {
    prepare(entities);
    updateMonster(world, entities, threat, 1, 20 + i, msgs, target.id, { v: 10 }, state);
  }

  assert.equal(threat.monsterDmgMult, undefined);
  assert.equal(getRecentEvents(state, { type: 'monster_windup_interrupted', tags: ['nightmare', 'left_room_or_range'], limit: 1 }).length, 1);
});

test('nightmare pressure drops after heavy early damage', () => {
  const world = openWorld();
  const target = player(15.5, 10.5, 1000);
  const threat = monster(MonsterKind.NIGHTMARE, 10.5, 10.5);
  const entities = [target, threat];
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  prepare(entities);
  updateMonster(world, entities, threat, 3, 1, msgs, target.id, { v: 10 }, state);
  const before = threat.monsterDmgMult ?? 1;

  threat.hp = (threat.hp ?? NIGHTMARE_DEF.hp) - 42;
  prepare(entities);
  updateMonster(world, entities, threat, 0.1, 1.2, msgs, target.id, { v: 10 }, state);

  assert.equal((threat.monsterDmgMult ?? 1) < before, true);
  assert.equal(getRecentEvents(state, { type: 'monster_windup_interrupted', tags: ['nightmare', 'burst_damage'], limit: 1 }).length, 1);
});

test('kostorez windup misses if the target leaves range', () => {
  const world = openWorld();
  const target = player(12.4, 10.5);
  const threat = monster(MonsterKind.KOSTOREZ, 10.5, 10.5);
  const entities = [target, threat];
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  prepare(entities);
  updateMonster(world, entities, threat, 0.1, 1, msgs, target.id, { v: 10 }, state);
  assert.equal((threat.ai?.windupTimer ?? 0) > 0, true);
  assert.equal(threat.ai?.windupTargetId, target.id);

  target.x = 16.5;
  prepare(entities);
  updateMonster(world, entities, threat, 0.1, 1.1, msgs, target.id, { v: 10 }, state);

  assert.equal(threat.ai?.windupTimer, undefined);
  assert.equal(threat.ai?.windupTargetId, undefined);
  assert.equal(threat.attackCd, 0.75);
  const escaped = getRecentEvents(state, { type: 'monster_escaped', tags: ['escaped'], limit: 1 })[0];
  assert.ok(escaped);
  assert.equal(escaped.monsterKind, MonsterKind.KOSTOREZ);
  assert.equal(escaped.data?.reason, 'distance');
});

test('safeguard windup is shotgun-interruptible without any online dependency', () => {
  const world = openWorld();
  const target = player(12.1, 10.5);
  const threat = monster(MonsterKind.SAFEGUARD, 10.5, 10.5);
  const entities = [target, threat];
  const state = makeGameState({ currentFloor: FloorLevel.VOID, worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  prepare(entities);
  updateMonster(world, entities, threat, 0.1, 1, msgs, target.id, { v: 10 }, state);
  assert.equal((threat.ai?.windupTimer ?? 0) > 0, true);
  assert.equal(threat.ai?.windupTargetId, target.id);

  const pellet: Entity = {
    id: 9,
    type: EntityType.PROJECTILE,
    x: 11,
    y: 10.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 10,
    sprite: Spr.PELLET,
    ownerId: target.id,
    projLife: 1,
  };

  assert.equal(tryMonsterProjectileStagger(world, state, threat, pellet, target.id), true);
  assert.equal(threat.ai?.windupTimer, undefined);
  assert.equal((threat.ai?.staggerTimer ?? 0) >= 0.85, true);
  const interrupted = getRecentEvents(state, { type: 'monster_windup_interrupted', tags: ['safeguard', 'shotgun'], limit: 1 })[0];
  assert.ok(interrupted);
  assert.equal(interrupted.data?.reason, 'shotgun_stagger');
});
