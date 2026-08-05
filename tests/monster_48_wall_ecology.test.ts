import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  AIGoal, Cell, EntityType, Feature, FloorLevel, MonsterKind, RoomType, type Entity, type Msg,
} from '../src/core/types';
import { World } from '../src/core/world';
import { MONSTERS } from '../src/entities/monster';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import { setListenerPos } from '../src/systems/audio';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { getRecentEvents } from '../src/systems/events';
import { monsterWallContext } from '../src/systems/monster_traits';
import { addTestRoom, makeGameState } from './helpers';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  return world;
}

function player(x: number, y: number): Entity {
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
    hp: 100,
    maxHp: 100,
    name: 'Вы',
  };
}

function monster(kind: MonsterKind, x: number, y: number): Entity {
  const def = MONSTERS[kind];
  return {
    id: 48,
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
    ai: { goal: AIGoal.HUNT, tx: Math.floor(x), ty: Math.floor(y), path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function sync(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

function runWallHit(kind: MonsterKind, setup?: (world: World) => void): { hp: number; msgs: Msg[]; state: ReturnType<typeof makeGameState> } {
  const world = openWorld();
  setup?.(world);
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(11.1, 10.5);
  const threat = monster(kind, 10.5, 10.5);
  const entities = [target, threat];
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  state.time = 10;
  sync(entities);

  updateMonster(world, entities, threat, 0.2, state.time, state.msgs, target.id, { v: 100 }, state);
  return { hp: target.hp ?? 0, msgs: state.msgs, state };
}

test('shared monster wall context is toroidal, local, and marks open floor', () => {
  const world = openWorld();
  const actor = monster(MonsterKind.TVAR, 0.5, 20.5);
  const center = monster(MonsterKind.SHOVNIK, 30.5, 20.5);
  world.cells[world.idx(1023, 20)] = Cell.WALL;
  world.features[world.idx(31, 20)] = Feature.SHELF;

  const edge = monsterWallContext(world, actor);
  const open = monsterWallContext(world, center);

  assert.equal(edge.adjacentWall, true, 'left edge wall should be read through toroidal wrap');
  assert.equal(edge.weakWallNearby?.idx, world.idx(1023, 20), 'thin non-hermetic wall candidates stay local');
  assert.equal(edge.openFloorScore < open.openFloorScore, true, 'wall pressure should reduce open-floor score');
  assert.equal(open.adjacentWall, false);
  assert.equal(open.debrisNearby, true, 'shelf debris should be a local terrain fact');
});

test('tvar and shovnik share wall-bias cue and target-wall damage pressure', () => {
  const tvarOpen = runWallHit(MonsterKind.TVAR);
  const tvarWall = runWallHit(MonsterKind.TVAR, world => {
    world.cells[world.idx(11, 9)] = Cell.WALL;
  });
  const shovnikOpen = runWallHit(MonsterKind.SHOVNIK);
  const shovnikWall = runWallHit(MonsterKind.SHOVNIK, world => {
    world.cells[world.idx(11, 9)] = Cell.WALL;
  });

  assert.equal(tvarWall.hp < tvarOpen.hp, true, 'TVAR should hit harder when the target hugs a wall');
  assert.equal(shovnikWall.hp < shovnikOpen.hp, true, 'SHOVNIK should use the same wall target pressure');
  assert.equal(tvarWall.msgs.some(entry => /Тварь.*панел|центр комнаты/.test(entry.text)), true);
  assert.equal(shovnikWall.msgs.some(entry => /Шовник.*шв|центр/.test(entry.text)), true);
  assert.equal(getRecentEvents(shovnikWall.state, { type: 'monster_sighted', tags: ['shovnik', 'wall_bias'] }).length, 1);
});

test('rebar debris lurker uses only local scrap context for extended detection', () => {
  const world = openWorld();
  addTestRoom(world, { id: 1, type: RoomType.COMMON, x: 5, y: 5, w: 36, h: 12 });
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(26.5, 10.5);
  const threat = monster(MonsterKind.REBAR, 10.5, 10.5);
  const entities = [target, threat];

  sync(entities);
  updateMonster(world, entities, threat, 0.2, 1, [], target.id, { v: 100 });
  assert.equal(threat.ai?.combatTargetId, undefined, 'open floor keeps rebar at exposed detection range');

  world.features[world.idx(11, 10)] = Feature.SHELF;
  threat.ai!.combatScanCd = 0;
  sync(entities);
  updateMonster(world, entities, threat, 0.2, 2, [], target.id, { v: 100 });
  assert.equal(threat.ai?.combatTargetId, target.id, 'nearby shelf should extend only local debris-lurker detection');
});
