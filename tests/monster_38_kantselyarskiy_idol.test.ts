import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Feature, FloorLevel, MonsterKind, RoomType, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { RUMORS } from '../src/data/rumors';
import { DEF, generateSprite } from '../src/entities/kantselyarskiy_idol';
import { MONSTERS, NEW_MONSTERS_BY_FLOOR } from '../src/entities/monster';
import { S } from '../src/render/pixutil';
import { setListenerPos } from '../src/systems/audio';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import { addTestRoom, makeGameState } from './helpers';

function officeWorld(): World {
  const world = new World();
  addTestRoom(world, {
    id: 1,
    type: RoomType.OFFICE,
    name: 'Тестовая канцелярская линия',
    x: 8,
    y: 8,
    w: 24,
    h: 7,
  });
  return world;
}

function player(x: number, y: number, carriesPaper = true): Entity {
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
    inventory: carriesPaper ? [{ defId: 'blank_form', count: 1 }] : [],
  };
}

function idol(x: number, y: number): Entity {
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
    monsterKind: MonsterKind.KANTSELYARSKIY_IDOL,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function prepare(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

function addOfficeFieldFurniture(world: World): void {
  world.features[world.idx(10, 9)] = Feature.DESK;
  world.features[world.idx(10, 11)] = Feature.DESK;
  world.features[world.idx(9, 10)] = Feature.SHELF;
}

test('Kantselyarskiy Idol is standalone office-field monster content', () => {
  const ecology = getMonsterEcology(MonsterKind.KANTSELYARSKIY_IDOL);
  const sprite = generateSprite();
  let opaque = 0;
  let paperPixels = 0;
  let stampPixels = 0;
  for (const px of sprite) {
    if ((px >>> 24) !== 0) opaque++;
    const r = px & 255;
    const g = (px >>> 8) & 255;
    const b = (px >>> 16) & 255;
    if (r > 150 && g > 120 && b < 150) paperPixels++;
    if (r > 130 && g < 55 && b < 60) stampPixels++;
  }

  assert.equal(DEF.kind, MonsterKind.KANTSELYARSKIY_IDOL);
  assert.equal(MONSTERS[MonsterKind.KANTSELYARSKIY_IDOL], DEF);
  assert.deepEqual(DEF.aiFlags, ['officeField']);
  assert.deepEqual(DEF.floors, [FloorLevel.MINISTRY]);
  assert.equal(DEF.speed <= 0.05, true, 'Idol should be stationary or effectively stationary');
  assert.equal(DEF.isRanged, true);
  assert.equal(DEF.attackRate >= 2.8, true, 'office-field shots need a recovery window');
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.MINISTRY]?.includes(MonsterKind.KANTSELYARSKIY_IDOL), true);
  assert.deepEqual(ecology?.rumorIds, ['monster_kantselyarskiy_idol_line', 'ecology_kantselyarskiy_idol_office_field']);
  assert.equal(RUMORS.some(r => r.id === 'ecology_kantselyarskiy_idol_office_field'), true);
  assert.equal(sprite.length, S * S);
  assert.equal(opaque > 650, true, 'sprite should read as desk-idol plus paper halo');
  assert.equal(paperPixels > 70, true, 'paper halo should be visible');
  assert.equal(stampPixels > 15, true, 'red stamp false-face should be visible');
});

test('office field extends the shot through desks and carried papers, then cover interrupts it', () => {
  const world = officeWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  addOfficeFieldFurniture(world);
  const target = player(26.5, 10.5, true);
  const threat = idol(10.5, 10.5);
  const entities = [target, threat];
  const msgs: Msg[] = [];
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY, worldEvents: createWorldEventState() });

  prepare(entities);
  updateMonster(world, entities, threat, 0.1, 1, msgs, target.id, { v: 3 }, state);
  assert.equal((threat.ai?.windupTimer ?? 0) > 0, true, 'office-field pressure should reach beyond the generic 15-cell range');

  const sighted = getRecentEvents(state, { type: 'monster_sighted', tags: ['office_field'], limit: 1 })[0];
  assert.equal(sighted?.monsterKind, MonsterKind.KANTSELYARSKIY_IDOL);
  assert.equal(sighted?.data?.systemTag, 'office_field');
  assert.equal(sighted?.data?.targetCarriesPaper, true);
  assert.equal(typeof sighted?.data?.officeFieldPressure, 'number');

  world.features[world.idx(18, 10)] = Feature.SHELF;
  updateMonster(world, entities, threat, 0.1, 1.1, msgs, target.id, { v: 3 }, state);
  assert.equal(threat.ai?.windupTimer, undefined);
  assert.equal(threat.ai?.windupTargetId, undefined);
  assert.equal((threat.attackCd ?? 0) >= 0.7, true, 'cover break should create a short recovery window');
  assert.equal(msgs.some(m => m.text.includes('Офисное поле Идола')), true);
  assert.equal(getRecentEvents(state, { type: 'monster_windup_interrupted', tags: ['office_field'], limit: 1 }).length, 1);
});

test('Kantselyarskiy Idol fires only after windup and then enters recovery', () => {
  const world = officeWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  addOfficeFieldFurniture(world);
  const target = player(24.5, 10.5, true);
  const threat = idol(10.5, 10.5);
  const entities = [target, threat];
  const msgs: Msg[] = [];
  const nextId = { v: 3 };

  prepare(entities);
  updateMonster(world, entities, threat, 0.1, 5, msgs, target.id, nextId);
  const beforeShot = entities.length;
  assert.equal((threat.ai?.windupTimer ?? 0) > 0, true);

  updateMonster(world, entities, threat, 1.3, 6.3, msgs, target.id, nextId);
  assert.equal(entities.length, beforeShot + 1, 'windup completion should emit one projectile');
  assert.equal((threat.attackCd ?? 0) >= DEF.attackRate - 0.01, true, 'shot should start the readable recovery window');

  updateMonster(world, entities, threat, 0.2, 6.5, msgs, target.id, nextId);
  assert.equal(entities.length, beforeShot + 1, 'recovery should prevent immediate second shot');
});
