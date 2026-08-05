import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, FloorLevel, MonsterKind, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { DEF, generateSprite } from '../src/entities/green_dog';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { GREEN_DOG_PACK_CAP, updateMonster, setEntityMap } from '../src/systems/ai/monster';
import { createWorldEventState, getRecentEvents, publishEvent } from '../src/systems/events';
import { publishNoise, resetNoiseRecords } from '../src/systems/noise';
import { getEntityIndex, rebuildEntityIndex } from '../src/systems/entity_index';
import { setListenerPos } from '../src/systems/audio';
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

function greenDog(id: number, x: number, y: number): Entity {
  return {
    id,
    type: EntityType.MONSTER,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: DEF.speed,
    sprite: monsterSpr(MonsterKind.GREEN_DOG),
    hp: DEF.hp,
    maxHp: DEF.hp,
    monsterKind: MonsterKind.GREEN_DOG,
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

test('green dog definition, ecology, and sprite read as a mossy pack predator', () => {
  const ecology = getMonsterEcology(MonsterKind.GREEN_DOG);
  const sprite = generateSprite();
  let opaque = 0;
  let green = 0;
  for (const px of sprite) {
    if ((px >>> 24) === 0) continue;
    opaque++;
    const r = px & 0xff;
    const g = (px >>> 8) & 0xff;
    const b = (px >>> 16) & 0xff;
    if (g > r + 20 && g > b + 10) green++;
  }

  assert.equal(DEF.kind, MonsterKind.GREEN_DOG);
  assert.deepEqual(DEF.aiFlags, ['packHowl', 'noiseFear', 'foodBait']);
  assert.deepEqual(DEF.floors, [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE]);
  assert.equal(ecology?.rare, false);
  assert.match(DEF.counterplay ?? '', /металл|дроб|шум/i);
  assert.equal(sprite.length, S * S);
  assert.equal(opaque > 360, true, 'green dog sprite should have a readable low body');
  assert.equal(green > 20, true, 'green moss should distinguish it from gray swarms');
});

test('green dog howl shares target only through a bounded pack radius query', () => {
  resetNoiseRecords();
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(10, 10);
  const caller = greenDog(2, 12, 10);
  const packmate = greenDog(3, 22, 10);
  packmate.ai!.combatScanCd = 99;
  const entities = [target, caller, packmate];
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  prime(entities);
  updateMonster(world, entities, caller, 0.1, 1, msgs, target.id, { v: 10 }, state);

  assert.equal(caller.ai?.combatTargetId, target.id);
  assert.equal(packmate.ai?.combatTargetId, target.id);
  const howl = getRecentEvents(state, { type: 'green_dog_howl', tags: ['green_dog'], limit: 1 })[0];
  assert.ok(howl);
  assert.equal(howl.data?.shared, 1);
});

test('green dog pack share is capped and cooldown-gated', () => {
  resetNoiseRecords();
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(10, 10);
  const caller = greenDog(2, 12, 10);
  caller.ai!.combatTargetId = target.id;
  caller.ai!.combatScanCd = 99;
  const pack = Array.from({ length: 18 }, (_, i) => {
    const dog = greenDog(3 + i, 12.4 + (i % 6) * 0.25, 10.4 + Math.floor(i / 6) * 0.25);
    dog.ai!.combatScanCd = 99;
    return dog;
  });
  const entities = [target, caller, ...pack];
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  prime(entities);
  updateMonster(world, entities, caller, 0.1, 5, msgs, target.id, { v: 40 }, state);

  const firstShared = pack.filter(dog => dog.ai?.combatTargetId === target.id).length;
  const howl = getRecentEvents(state, { type: 'green_dog_howl', tags: ['green_dog'], limit: 1 })[0];
  assert.ok(howl);
  assert.equal(firstShared > 0, true);
  assert.equal(firstShared <= GREEN_DOG_PACK_CAP, true);
  assert.equal(howl.data?.shared, firstShared);

  for (const dog of pack) dog.ai!.combatTargetId = undefined;
  prime(entities);
  updateMonster(world, entities, caller, 0.1, 5.25, msgs, target.id, { v: 40 }, state);

  assert.equal(pack.filter(dog => dog.ai?.combatTargetId === target.id).length, 0);
  assert.equal(getRecentEvents(state, { type: 'green_dog_howl', tags: ['green_dog'], limit: 4 }).length, 1);
});

test('green dog drops target and flees from shotgun or loud metal noise', () => {
  resetNoiseRecords();
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(10, 10);
  const dog = greenDog(2, 12, 10);
  dog.ai!.combatTargetId = target.id;
  const entities = [target, dog];
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];
  state.time = 1;
  publishNoise(state, {
    x: target.x,
    y: target.y,
    radius: 20,
    ttl: 4,
    source: 'weapon_fire',
    severity: 3,
    actorId: target.id,
    itemId: 'shotgun',
    tags: ['weapon', 'shotgun', 'metal'],
  });

  prime(entities);
  updateMonster(world, entities, dog, 0.2, state.time, msgs, target.id, { v: 10 }, state);

  assert.equal(dog.ai?.combatTargetId, undefined);
  assert.equal(dog.ai?.goal, AIGoal.WANDER);
  const scared = getRecentEvents(state, { type: 'green_dog_scared', tags: ['green_dog'], limit: 1 })[0];
  assert.ok(scared);
  assert.equal(scared.itemId, 'shotgun');
});

test('green dog treats valve and pipe events as loud metal counterplay', () => {
  resetNoiseRecords();
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(10, 10);
  const dog = greenDog(20, 13, 10);
  dog.ai!.combatTargetId = target.id;
  const entities = [target, dog];
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];
  state.time = 3;

  publishEvent(state, {
    type: 'paritel_valve_changed',
    zoneId: 0,
    x: 11,
    y: 10,
    actorId: target.id,
    actorName: target.name,
    actorFaction: target.faction,
    severity: 3,
    privacy: 'local',
    tags: ['valve', 'pipe', 'metal'],
    data: { pressure: 1 },
  });

  prime(entities);
  updateMonster(world, entities, dog, 0.2, state.time, msgs, target.id, { v: 30 }, state);

  assert.equal(dog.ai?.combatTargetId, undefined);
  assert.equal(dog.ai?.goal, AIGoal.WANDER);
  const scared = getRecentEvents(state, { type: 'green_dog_scared', tags: ['green_dog'], limit: 1 })[0];
  assert.ok(scared);
  assert.equal(scared.data?.noiseSource, 'decoy');
  assert.equal(scared.tags.includes('valve'), true);
});
