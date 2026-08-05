import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, FloorLevel, MonsterKind, RoomType, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { RUMORS } from '../src/data/rumors';
import { DEF, generateSprite } from '../src/entities/tumannik';
import { MONSTERS, MONSTER_SPRITES, NEW_MONSTERS_BY_FLOOR } from '../src/entities/monster';
import { S } from '../src/render/pixutil';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import { setListenerPos } from '../src/systems/audio';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { makeGameState } from './helpers';

function fogWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.fog.fill(92);
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

function npcTarget(x: number, y: number): Entity {
  return {
    id: 7,
    type: EntityType.NPC,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    hp: 100,
    maxHp: 100,
    faction: Faction.CITIZEN,
    name: 'Случайный жилец',
  };
}

function tumannik(x: number, y: number): Entity {
  return {
    id: 21,
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
    monsterKind: MonsterKind.TUMANNIK,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.HUNT, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function sync(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

test('Tumannik is standalone fog-offset monster content', () => {
  const ecology = getMonsterEcology(MonsterKind.TUMANNIK);

  assert.equal(DEF.kind, MonsterKind.TUMANNIK);
  assert.equal(MONSTERS[MonsterKind.TUMANNIK], DEF);
  assert.equal(MONSTER_SPRITES[MonsterKind.TUMANNIK], generateSprite);
  assert.deepEqual(DEF.aiFlags, ['fogOffset']);
  assert.deepEqual(DEF.floors, [FloorLevel.LIVING, FloorLevel.HELL]);
  assert.equal(DEF.hp >= 50 && DEF.hp <= 80, true);
  assert.equal(DEF.dmg <= 10, true);
  assert.match(DEF.counterplay ?? '', /силуэт|свет|огонь|fog/);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.LIVING].includes(MonsterKind.TUMANNIK), true);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.HELL].includes(MonsterKind.TUMANNIK), true);

  assert.ok(ecology);
  assert.deepEqual(ecology?.floors, [FloorLevel.LIVING, FloorLevel.HELL]);
  assert.equal(ecology?.rooms.includes(RoomType.CORRIDOR), true);
  assert.equal(ecology?.rumorIds.includes('monster_tumannik_side_sound'), true);
  assert.equal(ecology?.rumorIds.includes('ecology_tumannik_light_commit'), true);
  assert.equal(RUMORS.some(rumor => rumor.id === 'monster_tumannik_side_sound'), true);
  assert.equal(RUMORS.some(rumor => rumor.id === 'ecology_tumannik_light_commit'), true);
});

test('Tumannik sprite keeps a fake silhouette and black-red real joints readable', () => {
  const sprite = generateSprite();
  let opaque = 0;
  let faintRightGhost = 0;
  let redJoints = 0;
  let transparentCore = 0;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = sprite[y * S + x];
      const a = px >>> 24;
      if (a === 0) {
        if (x >= 28 && x <= 36 && y >= 25 && y <= 42) transparentCore++;
        continue;
      }
      opaque++;
      const r = px & 255;
      const g = (px >>> 8) & 255;
      const b = (px >>> 16) & 255;
      if (x > 38 && a > 25 && a < 100 && b >= r) faintRightGhost++;
      if (r > 90 && g < 35 && b < 40) redJoints++;
    }
  }

  assert.equal(sprite.length, S * S);
  assert.equal(opaque > 560, true);
  assert.equal(faintRightGhost > 70, true, 'offset ghost silhouette should be visible to the side');
  assert.equal(redJoints >= 6, true, 'real core needs black-red joint pixels');
  assert.equal(transparentCore > 45, true, 'missing center mass should stay open');
});

test('Tumannik arms a local fog offset and light collapses it', () => {
  const world = fogWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(16.5, 10.5);
  const threat = tumannik(10.5, 10.5);
  const entities = [target, threat];
  const msgs: Msg[] = [];
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });

  sync(entities);
  updateMonster(world, entities, threat, 0.1, 1, msgs, target.id, { v: 100 }, state);

  assert.equal(Math.abs(threat.ai?.fogOffsetX ?? 0) > 0.5, true, 'dense fog should produce a displaced visible origin');
  assert.equal(msgs.some(m => m.text.includes('звучит сбоку')), true);
  assert.equal(getRecentEvents(state, { type: 'monster_sighted', tags: ['tumannik', 'fog_offset'], limit: 1 }).length, 1);

  world.light[world.idx(Math.floor(target.x), Math.floor(target.y))] = 0.72;
  sync(entities);
  updateMonster(world, entities, threat, 0.1, 1.2, msgs, target.id, { v: 100 }, state);

  assert.equal(threat.ai?.fogOffsetX, undefined);
  assert.equal((threat.ai?.fogOffsetCollapsedUntil ?? 0) > 1.2, true);
  assert.equal(msgs.some(m => m.text.includes('Свет вытащил настоящий сустав')), true);
});

test('Tumannik can hit from the displaced fog origin before its real body reaches melee', () => {
  const world = fogWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(12.35, 10.5);
  const threat = tumannik(10.5, 10.5);
  const entities = [target, threat];
  const msgs: Msg[] = [];
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });

  sync(entities);
  updateMonster(world, entities, threat, 0.1, 2, msgs, target.id, { v: 100 }, state);

  assert.equal((target.hp ?? 100) < 100, true, 'offset origin should be able to land the ambush hit');
  assert.equal(world.dist2(threat.x, threat.y, target.x, target.y) > 1.2 * 1.2, true, 'real body should still be outside ordinary close contact');
  assert.equal(threat.ai?.fogOffsetX, undefined, 'the real body commits after the side hit');
  assert.equal(msgs.some(m => m.text.includes('не из центра силуэта')), true);
  assert.equal(getRecentEvents(state, { type: 'monster_sighted', tags: ['tumannik', 'side_hit'], limit: 1 }).length, 1);
});

test('Tumannik fog offset collapses for a lit NPC target too', () => {
  const world = fogWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = npcTarget(16.5, 10.5);
  const threat = tumannik(10.5, 10.5);
  const entities = [target, threat];
  const state = makeGameState({ currentFloor: FloorLevel.HELL, worldEvents: createWorldEventState() });

  sync(entities);
  updateMonster(world, entities, threat, 0.1, 5, [], 1, { v: 100 }, state);
  assert.equal(Math.abs(threat.ai?.fogOffsetX ?? 0) > 0.5, true);

  world.light[world.idx(Math.floor(target.x), Math.floor(target.y))] = 0.72;
  sync(entities);
  updateMonster(world, entities, threat, 0.1, 5.2, [], 1, { v: 100 }, state);

  assert.equal(threat.ai?.fogOffsetX, undefined);
  assert.equal(getRecentEvents(state, { type: 'monster_windup_interrupted', tags: ['tumannik', 'light'], limit: 1 }).length, 1);
});
