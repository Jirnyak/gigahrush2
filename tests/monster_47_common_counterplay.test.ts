import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, Feature, FloorLevel, MonsterKind, RoomType, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { DEF as SBORKA_DEF } from '../src/entities/sborka';
import { DEF as TVAR_DEF } from '../src/entities/tvar';
import { DEF as POLZUN_DEF } from '../src/entities/polzun';
import { MONSTERS } from '../src/entities/monster';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import { setListenerPos } from '../src/systems/audio';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { getRecentEvents } from '../src/systems/events';
import { makeGameState } from './helpers';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
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
  };
}

function monster(kind: MonsterKind, x: number, y: number): Entity {
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
    ai: { goal: AIGoal.HUNT, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function bystander(id: number, x: number, y: number, faction: Faction = Faction.CITIZEN): Entity {
  return {
    id,
    type: EntityType.NPC,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    hp: 40,
    maxHp: 40,
    faction,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function runMonsterHit(kind: MonsterKind, dist: number, setup?: (world: World) => void): number {
  const world = openWorld();
  setup?.(world);
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(10 + dist, 10);
  const threat = monster(kind, 10, 10);
  const entities = [target, threat];
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
  const msgs: Msg[] = [];

  updateMonster(world, entities, threat, 0.2, 10, msgs, target.id, { v: 100 });
  return target.hp ?? 0;
}


function runMonsterTargeting(kind: MonsterKind, dist: number): Entity {
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(10 + dist, 10);
  const threat = monster(kind, 10, 10);
  const entities = [target, threat];
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));

  updateMonster(world, entities, threat, 0.2, 10, [], target.id, { v: 100 });
  return threat;
}

test('common monster role data separates fodder, distance threat, and tank', () => {
  const sborka = getMonsterEcology(MonsterKind.SBORKA);
  const tvar = getMonsterEcology(MonsterKind.TVAR);
  const polzun = getMonsterEcology(MonsterKind.POLZUN);

  assert.equal(SBORKA_DEF.hp <= 10, true, 'SBORKA should stay fragile fodder');
  assert.equal(SBORKA_DEF.speed >= 3, true, 'SBORKA should win the first footrace');
  assert.equal(SBORKA_DEF.dmg <= 4, true, 'SBORKA pressure should come from speed/count, not heavy hits');
  assert.equal(sborka !== undefined && tvar !== undefined && polzun !== undefined, true);
  assert.equal((sborka?.spawnWeight ?? 0) > (tvar?.spawnWeight ?? 0), true, 'SBORKA should be the common fodder pick');

  assert.deepEqual(TVAR_DEF.aiFlags, ['foodBait', 'wallBias']);
  assert.equal(TVAR_DEF.hp >= 45 && TVAR_DEF.hp <= 70, true, 'TVAR should stay medium durability');
  assert.match(TVAR_DEF.counterplay ?? '', /полторы клетки|стен|центр/);
  assert.equal(tvar?.rooms.includes(RoomType.CORRIDOR), true);
  assert.equal(tvar?.floors.includes(FloorLevel.LIVING), true);

  assert.equal(POLZUN_DEF.hp >= 150, true, 'POLZUN should be the slow tank');
  assert.equal(POLZUN_DEF.speed <= 0.9, true, 'POLZUN should be kiteable outside tight passages');
  assert.equal(POLZUN_DEF.attackRate >= 2, true, 'POLZUN should leave a planning window');
  assert.equal(polzun?.rooms.includes(RoomType.BATHROOM), true);
  assert.equal(polzun?.rooms.includes(RoomType.PRODUCTION), true);
});

test('generic melee monsters keep hunting past the old twenty-cell leash', () => {
  const threat = runMonsterTargeting(MonsterKind.SBORKA, 28);

  assert.equal(threat.ai?.combatTargetId, 1);
  assert.equal(threat.ai?.goal, AIGoal.HUNT);
});

test('sborka first sight is a cue, not a custom brain', () => {
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(16, 10);
  const threat = monster(MonsterKind.SBORKA, 10, 10);
  const entities = [target, threat];
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const msgs: Msg[] = [];

  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
  updateMonster(world, entities, threat, 0.2, 10, msgs, target.id, { v: 100 }, state);
  updateMonster(world, entities, threat, 0.2, 10.2, msgs, target.id, { v: 100 }, state);

  assert.equal(threat.ai?.combatTargetId, target.id);
  assert.equal(msgs.filter(m => m.text.includes('Сборка щелкнула проволокой')).length, 1);
  assert.equal(
    getRecentEvents(state, { type: 'monster_sighted', tags: ['sborka', 'cheap_chaser', 'first_sight'], limit: 4 }).length,
    1,
  );
});

test('ranged monsters keep their bounded search radius', () => {
  const threat = runMonsterTargeting(MonsterKind.EYE, 21);

  assert.equal(threat.ai?.combatTargetId, undefined);
});

test('tvar threatens from outside default melee range and punishes wall hugging', () => {
  const sborkaHp = runMonsterHit(MonsterKind.SBORKA, 1.45);
  const tvarOpenHp = runMonsterHit(MonsterKind.TVAR, 1.45);
  const tvarWallHp = runMonsterHit(MonsterKind.TVAR, 1.45, world => {
    world.cells[world.idx(11, 9)] = Cell.WALL;
  });

  assert.equal(sborkaHp, 100, 'SBORKA should not get medium reach for free');
  assert.equal(tvarOpenHp < 100, true, 'TVAR should be a real distance threat');
  assert.equal(tvarWallHp < tvarOpenHp, true, 'TVAR should hit harder when the player hugs a wall');
});

test('polzun stays slow but becomes nastier in doors, bathrooms, and water', () => {
  const openHp = runMonsterHit(MonsterKind.POLZUN, 1.25);
  const tightHp = runMonsterHit(MonsterKind.POLZUN, 1.25, world => {
    world.cells[world.idx(9, 10)] = Cell.WALL;
    world.cells[world.idx(10, 9)] = Cell.WALL;
  });
  const bathroomHp = runMonsterHit(MonsterKind.POLZUN, 1.25, world => {
    world.features[world.idx(11, 10)] = Feature.TOILET;
  });
  const waterHp = runMonsterHit(MonsterKind.POLZUN, 1.25, world => {
    world.cells[world.idx(11, 10)] = Cell.WATER;
  });

  assert.equal(openHp < 100, true, 'POLZUN should still be dangerous if it reaches the player');
  assert.equal(tightHp < openHp, true, 'tight cells should be bad polzun terrain');
  assert.equal(bathroomHp < openHp, true, 'bathroom fixtures should mark polzun terrain');
  assert.equal(waterHp < openHp, true, 'water should mark polzun terrain');
});

