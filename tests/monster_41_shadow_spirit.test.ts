import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, FloorLevel, MonsterKind, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { DEF as SHADOW_DEF } from '../src/entities/shadow';
import { DEF as SPIRIT_DEF } from '../src/entities/spirit';
import { setListenerPos } from '../src/systems/audio';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { makeGameState, makeTestNpc } from './helpers';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.light.fill(0);
  return world;
}

function wallWorld(): World {
  const world = openWorld();
  for (let y = 8; y <= 12; y++) {
    world.cells[world.idx(11, y)] = Cell.WALL;
  }
  return world;
}

function monster(kind: MonsterKind.SHADOW | MonsterKind.SPIRIT, id: number, x: number, y: number): Entity {
  const def = kind === MonsterKind.SHADOW ? SHADOW_DEF : SPIRIT_DEF;
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
    phasing: kind === MonsterKind.SPIRIT,
    ai: { goal: AIGoal.HUNT, tx: Math.floor(x), ty: Math.floor(y), path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function sync(world: World, entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
  setListenerPos(512, 512, world.dist2.bind(world));
}

test('Shadow dark windup can hit an NPC target and light cancels the strike state', () => {
  const world = openWorld();
  const target = makeTestNpc({ id: 7, x: 11.05, y: 10.5, hp: 100, maxHp: 100, faction: Faction.CITIZEN });
  const threat = monster(MonsterKind.SHADOW, 8, 10.5, 10.5);
  const entities = [target, threat];
  const msgs: Msg[] = [];
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });

  sync(world, entities);
  updateMonster(world, entities, threat, 0.1, 1, msgs, 1, { v: 20 }, state);
  assert.equal((threat.ai?.windupTimer ?? 0) > 0, true, 'dark close range should arm the shadow windup against an NPC');

  sync(world, entities);
  updateMonster(world, entities, threat, 0.7, 1.7, msgs, 1, { v: 20 }, state);
  assert.equal((target.hp ?? 100) < 100, true, 'shadow ambush must not be player-only');

  const litWorld = openWorld();
  const litTarget = makeTestNpc({ id: 17, x: 11.05, y: 10.5, hp: 100, maxHp: 100, faction: Faction.CITIZEN });
  const litThreat = monster(MonsterKind.SHADOW, 18, 10.5, 10.5);
  const litEntities = [litTarget, litThreat];
  sync(litWorld, litEntities);
  updateMonster(litWorld, litEntities, litThreat, 0.1, 3, [], 1, { v: 20 }, state);
  assert.equal((litThreat.ai?.windupTimer ?? 0) > 0, true);

  litWorld.light[litWorld.idx(11, 10)] = 0.5;
  sync(litWorld, litEntities);
  updateMonster(litWorld, litEntities, litThreat, 0.7, 3.7, [], 1, { v: 20 }, state);
  assert.equal(litThreat.ai?.windupTimer, undefined, 'local light should cancel the armed strike');
  assert.equal(litTarget.hp, 100, 'cancelled shadow windup should not fall through to melee damage');
});

test('Spirit target scan and wall phase movement do not require the player target', () => {
  const world = wallWorld();
  const target = makeTestNpc({ id: 21, x: 14.5, y: 10.5, hp: 100, maxHp: 100, faction: Faction.CITIZEN });
  const threat = monster(MonsterKind.SPIRIT, 22, 8.5, 10.5);
  const entities = [target, threat];
  const state = makeGameState({ currentFloor: FloorLevel.VOID, worldEvents: createWorldEventState() });

  sync(world, entities);
  updateMonster(world, entities, threat, 0.7, 5, [], 1, { v: 30 }, state);

  assert.equal(threat.ai?.combatTargetId, target.id, 'spirit should keep a non-player hostile target');
  assert.equal(threat.x > 9.0, true, 'phasing pursuit should advance through blocked geometry toward the NPC');
  assert.equal(getRecentEvents(state, { limit: 1 }).length, 0, 'baseline phase pursuit should not emit unbounded readability events');
});
