import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, Feature, FloorLevel, MonsterKind, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { MONSTERS } from '../src/entities/monster';
import { setListenerPos } from '../src/systems/audio';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { lineThreatContext, setEntityMap, updateMonster } from '../src/systems/ai/monster';
import { makeGameState } from './helpers';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.features.fill(Feature.NONE);
  return world;
}

function threat(kind: MonsterKind, x = 6.5, y = 10.5): Entity {
  const def = MONSTERS[kind];
  return {
    id: 2,
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
    ai: { goal: AIGoal.HUNT, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function citizen(id: number, x: number, y: number): Entity {
  return {
    id,
    type: EntityType.NPC,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 2,
    sprite: 0,
    hp: 100,
    maxHp: 100,
    faction: Faction.CITIZEN,
    name: `NPC ${id}`,
  };
}

function player(x: number, y: number): Entity {
  return {
    ...citizen(1, x, y),
    faction: Faction.PLAYER,
    persistentNpcId: 'player',
    name: 'Вы',
  };
}

function prepare(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
  setListenerPos(512, 512, (x1, y1, x2, y2) => {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return dx * dx + dy * dy;
  });
}

test('line threat context exposes bounded range, cover, and light facts', () => {
  const world = openWorld();
  const eye = threat(MonsterKind.EYE);
  const target = citizen(3, 14.5, 10.5);

  let ctx = lineThreatContext(world, eye, target, 15, 1.5);
  assert.equal(ctx.inRange, true);
  assert.equal(ctx.los, true);
  assert.equal(ctx.coverBroken, false);
  assert.equal(ctx.litTarget, false);
  assert.equal(ctx.distance > 7 && ctx.distance < 9, true);

  world.features[world.idx(14, 10)] = Feature.LAMP;
  ctx = lineThreatContext(world, eye, target, 15, 1.5);
  assert.equal(ctx.litTarget, true);
  assert.equal(ctx.targetLight >= 0.24, true);

  world.features[world.idx(10, 10)] = Feature.SHELF;
  ctx = lineThreatContext(world, eye, target, 15, 1.5);
  assert.equal(ctx.inRange, true);
  assert.equal(ctx.los, false);
  assert.equal(ctx.coverBroken, true);
});

test('common line shooters wind up on hostile NPCs and lose shots to cover', () => {
  for (const kind of [MonsterKind.EYE, MonsterKind.PARAGRAPH, MonsterKind.ROBOT, MonsterKind.PAUPSINA]) {
    const world = openWorld();
    const target = citizen(3, 14.5, 10.5);
    const monster = threat(kind);
    const entities = [target, monster];
    const msgs: Msg[] = [];
    const nextId = { v: 10 };

    prepare(entities);
    updateMonster(world, entities, monster, 0.1, 1, msgs, 999, nextId);
    assert.equal(monster.ai?.combatTargetId, target.id, `${MonsterKind[kind]} should target hostile NPCs`);
    assert.equal(monster.ai?.windupTargetId, target.id, `${MonsterKind[kind]} should lock windup to the NPC`);
    assert.equal(entities.some(e => e.type === EntityType.PROJECTILE), false);

    world.features[world.idx(10, 10)] = Feature.SHELF;
    updateMonster(world, entities, monster, 0.1, 1.1, msgs, 999, nextId);
    assert.equal(monster.ai?.windupTimer, undefined, `${MonsterKind[kind]} windup should break on cover`);
    assert.equal(monster.ai?.windupTargetId, undefined, `${MonsterKind[kind]} windup target should clear on cover`);
    assert.equal((monster.attackCd ?? 0) > 0, true, `${MonsterKind[kind]} should enter short recovery after cover break`);
  }
});

test('robot plasma has only local wet-risk amplification', () => {
  function shotDamage(setup?: (world: World) => void): number {
    const world = openWorld();
    setup?.(world);
    const target = player(14.5, 10.5);
    const monster = threat(MonsterKind.ROBOT);
    const entities = [target, monster];
    const nextId = { v: 10 };
    prepare(entities);

    updateMonster(world, entities, monster, 0.1, 1, [], target.id, nextId);
    updateMonster(world, entities, monster, 1.0, 2, [], target.id, nextId);
    const projectile = entities.find(e => e.type === EntityType.PROJECTILE);
    assert.ok(projectile, 'robot windup should fire one real projectile');
    return projectile.projDmg ?? 0;
  }

  const dry = shotDamage();
  const wet = shotDamage(world => {
    world.cells[world.idx(14, 10)] = Cell.WATER;
  });

  assert.equal(wet > dry, true);
});

test('lampovy publishes one local powered cue when combat starts under a lamp', () => {
  const world = openWorld();
  const target = player(9.5, 10.5);
  const monster = threat(MonsterKind.LAMPOVY, 6.5, 10.5);
  const entities = [target, monster];
  const msgs: Msg[] = [];
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });

  world.features[world.idx(6, 10)] = Feature.LAMP;
  prepare(entities);
  updateMonster(world, entities, monster, 0.1, 1, msgs, target.id, { v: 10 }, state);
  updateMonster(world, entities, monster, 0.1, 1.1, msgs, target.id, { v: 10 }, state);

  assert.equal(msgs.filter(m => m.text.includes('Ламповый зазвенел')).length, 1);
  const event = getRecentEvents(state, { type: 'monster_sighted', tags: ['lamp_powered'], limit: 1 })[0];
  assert.equal(event?.monsterKind, MonsterKind.LAMPOVY);
  assert.equal(event?.data?.lampRadius, 3);
});
