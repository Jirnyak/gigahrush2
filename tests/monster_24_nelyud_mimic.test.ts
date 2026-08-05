import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, FloorLevel, MonsterKind, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { DEF } from '../src/entities/nelyud';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import { makeGameState, makeTestNpc, makeTestPlayer } from './helpers';

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

function nelyud(x: number, y: number): Entity {
  return {
    id: 2,
    type: EntityType.MONSTER,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: DEF.speed,
    sprite: DEF.sprite,
    hp: DEF.hp,
    maxHp: DEF.hp,
    monsterKind: MonsterKind.NELYUD,
    attackCd: DEF.attackRate,
    ai: { goal: AIGoal.WANDER, tx: Math.floor(x), ty: Math.floor(y), path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function prime(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

test('Nelyud stays unrevealed outside close mimic threshold', () => {
  const world = openWorld();
  const player = makeTestPlayer({ id: 1, x: 80, y: 80 });
  const threat = nelyud(10.5, 10.5);
  const neighbor = makeTestNpc({ id: 3, x: 17.2, y: 10.5, faction: Faction.CITIZEN });
  const entities = [player, threat, neighbor];
  const state = makeGameState({ currentFloor: FloorLevel.KVARTIRY, worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  prime(entities);
  updateMonster(world, entities, threat, 0.2, 1, msgs, player.id, { v: 4 }, state);

  assert.equal(threat.ai?.combatTargetId, undefined);
  assert.equal(getRecentEvents(state, { type: 'monster_sighted', tags: ['nelyud'], limit: 1 }).length, 0);
});

test('Nelyud close reveal publishes cue and can target a non-player NPC', () => {
  const world = openWorld();
  world.light[world.idx(10, 10)] = 0.62;
  const player = makeTestPlayer({ id: 1, x: 80, y: 80 });
  const threat = nelyud(10.5, 10.5);
  const neighbor = makeTestNpc({ id: 3, x: 15.6, y: 10.5, faction: Faction.CITIZEN });
  const entities = [player, threat, neighbor];
  const state = makeGameState({ currentFloor: FloorLevel.KVARTIRY, worldEvents: createWorldEventState() });

  assert.equal(getMonsterEcology(MonsterKind.NELYUD)?.counterplay.includes('дистанц'), true);

  prime(entities);
  updateMonster(world, entities, threat, 0.2, 2, [], player.id, { v: 4 }, state);

  assert.equal(threat.ai?.goal, AIGoal.HUNT);
  assert.equal(threat.ai?.combatTargetId, neighbor.id);
  const reveal = getRecentEvents(state, { type: 'monster_sighted', tags: ['nelyud', 'close_reveal'], limit: 1 })[0];
  assert.ok(reveal);
  assert.equal(reveal.monsterKind, MonsterKind.NELYUD);
  assert.equal(reveal.targetId, neighbor.id);
  assert.equal(reveal.data?.counterplay, 'distance_light_witness_exit');
  assert.equal(reveal.data?.reason, 'close_distance_reveal');
});
