import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, FloorLevel, MonsterKind, RoomType, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { DEF, generateSprite } from '../src/entities/glubinnaya_ten';
import { MONSTERS, MONSTER_SPRITES, NEW_MONSTERS_BY_FLOOR } from '../src/entities/monster';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { setListenerPos } from '../src/systems/audio';
import { S } from '../src/render/pixutil';
import { makeGameState } from './helpers';

function openDarkWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.light.fill(0);
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

function glubinnayaTen(x: number, y: number): Entity {
  return {
    id: 33,
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
    monsterKind: MonsterKind.GLUBINNAYA_TEN,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.HUNT, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function syncEntities(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

test('glubinnaya ten is standalone hell and void shadow content', () => {
  assert.equal(DEF.kind, MonsterKind.GLUBINNAYA_TEN);
  assert.deepEqual(DEF.aiFlags, ['secondBeat']);
  assert.deepEqual(DEF.floors, [FloorLevel.HELL, FloorLevel.VOID]);
  assert.match(DEF.counterplay ?? '', /свет|фонар|не догоня/i);
  assert.equal(MONSTERS[MonsterKind.GLUBINNAYA_TEN], DEF);
  assert.equal(MONSTER_SPRITES[MonsterKind.GLUBINNAYA_TEN], generateSprite);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.HELL].includes(MonsterKind.GLUBINNAYA_TEN), true);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.VOID].includes(MonsterKind.GLUBINNAYA_TEN), true);

  const ecology = getMonsterEcology(MonsterKind.GLUBINNAYA_TEN);
  assert.ok(ecology);
  assert.deepEqual(ecology?.floors, [FloorLevel.HELL, FloorLevel.VOID]);
  assert.equal(ecology?.rooms.includes(RoomType.CORRIDOR), true);
  assert.ok((ecology?.spawnWeight ?? 0) > 0);
  assert.equal(ecology?.rumorIds.includes('monster_glubinnaya_ten_second_beat'), true);
  assert.equal(ecology?.rumorIds.includes('ecology_glubinnaya_ten_afterimage'), true);
});

test('glubinnaya ten sprite has a broken body, second silhouette, and pale cuts', () => {
  const sprite = generateSprite();
  let opaque = 0;
  let faintSecondBody = 0;
  let paleCuts = 0;
  let blueEdges = 0;

  for (let i = 0; i < sprite.length; i++) {
    const px = sprite[i];
    const a = px >>> 24;
    if (a === 0) continue;
    opaque++;
    const r = px & 255;
    const g = (px >>> 8) & 255;
    const b = (px >>> 16) & 255;
    const x = i % S;
    if (a < 130 && b > r + 20 && x > S / 2) faintSecondBody++;
    if (r > 170 && g > 180 && b > 190) paleCuts++;
    if (b > r + 25 && b > g + 5) blueEdges++;
  }

  assert.equal(sprite.length, S * S);
  assert.ok(opaque >= 760, 'deep shadow should read as a full broken silhouette');
  assert.ok(faintSecondBody >= 120, 'afterimage must be visible as a separate faint body');
  assert.ok(paleCuts >= 8, 'pale eye/cut marks must remain readable');
  assert.ok(blueEdges >= 90, 'blue-gray edges keep the body readable in dark rooms');
});

test('glubinnaya ten second beat collapses when the player does not chase the afterimage', () => {
  const world = openDarkWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(14.5, 10.5);
  const threat = glubinnayaTen(10.5, 10.5);
  const entities = [target, threat];
  const msgs: Msg[] = [];
  const state = makeGameState({ currentFloor: FloorLevel.HELL, worldEvents: createWorldEventState() });

  syncEntities(entities);
  updateMonster(world, entities, threat, 0.1, 1, msgs, target.id, { v: 100 }, state);
  assert.equal(threat.ai?.secondBeatX !== undefined, true, 'second beat should arm in dark close range');

  syncEntities(entities);
  updateMonster(world, entities, threat, 0.8, 1.8, msgs, target.id, { v: 100 }, state);

  assert.equal(threat.ai?.secondBeatTimer, undefined);
  assert.equal(target.hp, 100);
  assert.equal(msgs.some(m => m.text.includes('потеряла второй темп')), true);
  assert.equal(
    getRecentEvents(state, { type: 'monster_windup_interrupted', tags: ['glubinnaya_ten', 'second_beat'], limit: 1 }).length,
    1,
  );
});

test('glubinnaya ten second beat hits when the player enters the dark afterimage', () => {
  const world = openDarkWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(14.5, 10.5);
  const threat = glubinnayaTen(10.5, 10.5);
  const entities = [target, threat];
  const msgs: Msg[] = [];
  const state = makeGameState({ currentFloor: FloorLevel.VOID, worldEvents: createWorldEventState() });

  syncEntities(entities);
  updateMonster(world, entities, threat, 0.1, 5, msgs, target.id, { v: 100 }, state);
  const afterX = threat.ai?.secondBeatX;
  const afterY = threat.ai?.secondBeatY;
  assert.equal(afterX !== undefined && afterY !== undefined, true);

  target.x = afterX!;
  target.y = afterY!;
  syncEntities(entities);
  updateMonster(world, entities, threat, 0.1, 5.1, msgs, target.id, { v: 100 }, state);

  assert.equal((target.hp ?? 100) < 100, true, 'entering the afterimage should trigger the delayed strike');
  assert.equal(threat.ai?.secondBeatTimer, undefined);
  assert.equal(msgs.some(m => m.text.includes('вторым телом')), true);
  assert.equal(
    getRecentEvents(state, { type: 'monster_sighted', tags: ['glubinnaya_ten', 'second_beat', 'hit'], limit: 1 }).length,
    1,
  );
});
