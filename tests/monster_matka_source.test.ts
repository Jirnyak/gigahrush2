import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, FloorLevel, MonsterKind, ZoneFaction, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { MONSTERS } from '../src/entities/monster';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { MATKA_CHILD_CAP } from '../src/systems/matka_source';
import { makeGameState, makeTestPlayer } from './helpers';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.zoneMap.fill(0);
  world.zones[0] = {
    id: 0,
    cx: 12,
    cy: 12,
    faction: ZoneFaction.WILD,
    hasLift: false,
    fogged: false,
    level: 2,
    hqRoomId: -1,
  };
  return world;
}

function matka(id: number, x: number, y: number): Entity {
  const def = MONSTERS[MonsterKind.MATKA];
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
    monsterKind: MonsterKind.MATKA,
    attackCd: def.attackRate,
    matkaTimer: 0.01,
    faction: Faction.WILD,
    ai: { goal: AIGoal.IDLE, tx: Math.floor(x), ty: Math.floor(y), path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function prime(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(entity => [entity.id, entity])));
}

function matkaChildren(entities: readonly Entity[], sourceId: number): Entity[] {
  return entities.filter(entity =>
    entity.alive &&
    entity.type === EntityType.MONSTER &&
    entity.ai?.sourceEntityId === sourceId);
}

function forceMatkaSpawn(
  world: World,
  entities: Entity[],
  source: Entity,
  state: ReturnType<typeof makeGameState>,
  nextId: { v: number },
  time: number,
  msgs: Msg[] = state.msgs,
): void {
  source.matkaTimer = 0.01;
  prime(entities);
  updateMonster(world, entities, source, 0.02, time, msgs, 1, nextId, state);
}

test('Matka source owns a capped child budget instead of nearby refill pressure', () => {
  const world = openWorld();
  const player = makeTestPlayer({ id: 1, x: 240, y: 240 });
  const source = matka(2, 12.5, 12.5);
  const entities = [player, source];
  const state = makeGameState({ currentFloor: FloorLevel.HELL, worldEvents: createWorldEventState(), time: 1 });
  const nextId = { v: 10 };

  for (let i = 0; i < MATKA_CHILD_CAP + 5; i++) {
    forceMatkaSpawn(world, entities, source, state, nextId, 1 + i * 0.1);
  }

  const children = matkaChildren(entities, source.id);
  assert.equal(children.length, MATKA_CHILD_CAP);
  assert.equal(source.ai?.sourceChildIds?.length, MATKA_CHILD_CAP);
  assert.ok(children.every(child => child.name === 'Приплод Матки'));

  const spawnEvent = getRecentEvents(state, { type: 'matka_child_spawned', tags: ['source_hive'], limit: 1 })[0];
  assert.ok(spawnEvent);
  assert.equal(spawnEvent.monsterKind, MonsterKind.MATKA);
  assert.equal(spawnEvent.data?.maxChildren, MATKA_CHILD_CAP);
});

test('killing Matka source leaves owned children alive but stops later source ticks', () => {
  const world = openWorld();
  const player = makeTestPlayer({ id: 1, x: 13.5, y: 12.5 });
  const source = matka(2, 12.5, 12.5);
  const entities = [player, source];
  const state = makeGameState({ currentFloor: FloorLevel.HELL, worldEvents: createWorldEventState(), time: 2 });
  const nextId = { v: 10 };

  for (let i = 0; i < 3; i++) {
    forceMatkaSpawn(world, entities, source, state, nextId, 2 + i * 0.1);
  }
  assert.equal(matkaChildren(entities, source.id).length, 3);

  source.alive = false;
  source.hp = 0;

  assert.equal(matkaChildren(entities, source.id).length, 3);
  assert.equal(source.ai?.sourceChildIds?.length, 3);

  forceMatkaSpawn(world, entities, source, state, nextId, 3);
  assert.equal(matkaChildren(entities, source.id).length, 3);
});

test('Matka source sanitizes malformed saved child ids before accounting', () => {
  const world = openWorld();
  const player = makeTestPlayer({ id: 1, x: 240, y: 240 });
  const source = matka(2, 12.5, 12.5);
  source.ai!.sourceChildIds = [
    0,
    -3,
    Number.NaN,
    'bad',
    ...Array.from({ length: MATKA_CHILD_CAP + 8 }, (_, i) => 10 + i),
  ] as unknown as number[];
  const entities = [player, source];
  const state = makeGameState({ currentFloor: FloorLevel.HELL, worldEvents: createWorldEventState(), time: 4 });
  const nextId = { v: 100 };

  forceMatkaSpawn(world, entities, source, state, nextId, 4);

  assert.equal(source.ai?.sourceChildIds?.length, 1);
  assert.equal(matkaChildren(entities, source.id).length, 1);
});
