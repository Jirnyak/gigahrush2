import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, FloorLevel, MonsterKind, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { DEF, generateSprite } from '../src/entities/sculpture';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { updateMonster, setEntityMap } from '../src/systems/ai/monster';
import { getEntityIndex, rebuildEntityIndex } from '../src/systems/entity_index';
import { monsterSpr } from '../src/render/sprite_index';
import { S } from '../src/render/pixutil';
import { makeGameState } from './helpers';

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

function player(x: number, y: number, angle: number): Entity {
  return {
    id: 1,
    type: EntityType.NPC, persistentNpcId: 'player',
    x,
    y,
    angle,
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

function sculpture(id: number, x: number, y: number): Entity {
  return {
    id,
    type: EntityType.MONSTER,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: DEF.speed,
    sprite: monsterSpr(MonsterKind.SCULPTURE),
    hp: DEF.hp,
    maxHp: DEF.hp,
    monsterKind: MonsterKind.SCULPTURE,
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

test('sculpture definition, ecology, and sprite read as a concrete anomaly', () => {
  const ecology = getMonsterEcology(MonsterKind.SCULPTURE);
  const sprite = generateSprite();
  let opaque = 0;
  for (const px of sprite) {
    if ((px >>> 24) === 0) continue;
    opaque++;
  }

  assert.equal(DEF.kind, MonsterKind.SCULPTURE);
  assert.deepEqual(DEF.aiFlags, ['weepingAngel']);
  assert.deepEqual(DEF.floors, [FloorLevel.MAINTENANCE, FloorLevel.HELL, FloorLevel.VOID]);
  assert.equal(ecology?.rare, true);
  assert.match(DEF.counterplay ?? '', /Двигается только/i);
  assert.equal(sprite.length, S * S);
  assert.equal(opaque > 100, true, 'sculpture sprite should have a readable body');
});

test('sculpture freezes when an actor is looking at it within 45 degrees', () => {
  const world = openWorld();
  // Sculpture at (10, 10), Player at (10, 15) looking at (10, 10)
  // Angle from player to sculpture: dx = 0, dy = -5. atan2(-5, 0) = -PI/2.
  const target = player(10, 15, -Math.PI / 2);
  const monster = sculpture(2, 10, 10);
  monster.ai!.goal = AIGoal.WANDER;
  monster.ai!.tx = 15;
  monster.ai!.ty = 10;

  const entities = [target, monster];
  const state = makeGameState();
  const msgs: Msg[] = [];

  const initialX = monster.x;
  const initialY = monster.y;

  prime(entities);
  updateMonster(world, entities, monster, 0.1, 1, msgs, target.id, { v: 10 }, state);

  assert.equal(monster.x, initialX, 'Sculpture should not move when looked at');
  assert.equal(monster.y, initialY, 'Sculpture should not move when looked at');
});

test('sculpture does not freeze when an actor is looking away', () => {
  const world = openWorld();
  // Sculpture at (10, 10), Player at (10, 15) looking away (PI/2 = down)
  const target = player(10, 15, Math.PI / 2);
  const monster = sculpture(2, 10, 10);
  monster.ai!.goal = AIGoal.WANDER;
  monster.ai!.tx = 15;
  monster.ai!.ty = 10;
  // Make sure it has a valid path to follow, otherwise it just stands still
  monster.ai!.path = [10, 10, 15, 10];
  monster.ai!.pi = 0;

  const entities = [target, monster];
  const state = makeGameState();
  const msgs: Msg[] = [];

  const initialX = monster.x;
  const initialY = monster.y;

  prime(entities);
  updateMonster(world, entities, monster, 0.1, 1, msgs, target.id, { v: 10 }, state);

  assert.equal(monster.x !== initialX || monster.y !== initialY, true, 'Sculpture should move when looked away');
});

test('sculpture does not freeze if actor is out of 25 radius', () => {
  const world = openWorld();
  // Sculpture at (10, 10), Player at (10, 40) looking at (10, 10) (Distance = 30)
  const target = player(10, 40, -Math.PI / 2);
  const monster = sculpture(2, 10, 10);
  monster.ai!.goal = AIGoal.WANDER;
  monster.ai!.tx = 15;
  monster.ai!.ty = 10;
  monster.ai!.path = [10, 10, 15, 10];
  monster.ai!.pi = 0;

  const entities = [target, monster];
  const state = makeGameState();
  const msgs: Msg[] = [];

  const initialX = monster.x;
  const initialY = monster.y;

  prime(entities);
  updateMonster(world, entities, monster, 0.1, 1, msgs, target.id, { v: 10 }, state);

  assert.equal(monster.x !== initialX || monster.y !== initialY, true, 'Sculpture should move when actor is out of radius');
});
