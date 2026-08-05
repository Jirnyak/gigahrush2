import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, Feature, FloorLevel, MonsterKind, RoomType, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { RUMORS } from '../src/data/rumors';
import { DEF, generateSprite } from '../src/entities/treskotnik';
import { MONSTERS, MONSTER_SPRITES, NEW_MONSTERS_BY_FLOOR } from '../src/entities/monster';
import { S } from '../src/render/pixutil';
import { setListenerPos } from '../src/systems/audio';
import { setEntityMap, TRESKOTNIK_STAGGER_SEC, TRESKOTNIK_WINDUP_SEC, updateMonster } from '../src/systems/ai/monster';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { makeGameState } from './helpers';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.features.fill(Feature.NONE);
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

function npcTarget(id: number, x: number, y: number): Entity {
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
    hp: 100,
    maxHp: 100,
    faction: Faction.CITIZEN,
    ai: { goal: AIGoal.IDLE, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    name: 'Сосед',
  };
}

function treskotnik(x: number, y: number): Entity {
  return {
    id: 20,
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
    monsterKind: MonsterKind.TRESKOTNIK,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.HUNT, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function syncEntities(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

test('treskotnik is standalone brittle crack-sprinter content', () => {
  const ecology = getMonsterEcology(MonsterKind.TRESKOTNIK);
  const retiredVariantId = ['cracked', 'sborka'].join('_');

  assert.equal(DEF.kind, MonsterKind.TRESKOTNIK);
  assert.deepEqual(DEF.aiFlags, ['fractureSprint']);
  assert.deepEqual(DEF.floors, [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.HELL]);
  assert.equal(MONSTERS[MonsterKind.TRESKOTNIK], DEF);
  assert.equal(MONSTER_SPRITES[MonsterKind.TRESKOTNIK], generateSprite);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.KVARTIRY].includes(MonsterKind.TRESKOTNIK), true);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.LIVING].includes(MonsterKind.TRESKOTNIK), true);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.HELL].includes(MonsterKind.TRESKOTNIK), true);

  assert.ok(ecology);
  assert.deepEqual(ecology?.floors, [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.HELL]);
  assert.equal(ecology?.rooms.includes(RoomType.CORRIDOR), true);
  assert.equal(ecology?.rumorIds.includes('monster_treskotnik_crack_pulse'), true);
  assert.equal(ecology?.rumorIds.includes('ecology_treskotnik_corner'), true);
  assert.equal(ecology?.rumorIds.some(id => id.includes(retiredVariantId)), false);
  assert.equal(RUMORS.some(r => r.id === 'monster_treskotnik_crack_pulse'), true);
  assert.match(DEF.counterplay ?? '', /красный треск|дверь/i);
  assert.match(DEF.lootHint ?? '', /бетонная крошка|красная пыль/i);
});

test('treskotnik sprite reads as gray plates with red fracture lines', () => {
  const sprite = generateSprite();
  let opaque = 0;
  let redCracks = 0;
  let grayPlate = 0;

  for (const px of sprite) {
    if ((px >>> 24) === 0) continue;
    opaque++;
    const r = px & 255;
    const g = (px >>> 8) & 255;
    const b = (px >>> 16) & 255;
    if (r > 150 && g < 110 && b < 90) redCracks++;
    if (r > 65 && r < 145 && Math.abs(r - g) < 18 && Math.abs(g - b) < 18) grayPlate++;
  }

  assert.equal(sprite.length, S * S);
  assert.ok(opaque > 520, 'narrow concrete body should still be readable in the atlas');
  assert.ok(grayPlate > 360, 'cold concrete plates should dominate the silhouette');
  assert.ok(redCracks >= 28, 'red fracture pixels must telegraph the windup');
});

test('treskotnik windup is cancelled by damage and emits an interrupt event', () => {
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(14.5, 10.5);
  const threat = treskotnik(10.5, 10.5);
  const entities = [target, threat];
  const msgs: Msg[] = [];
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });

  syncEntities(entities);
  updateMonster(world, entities, threat, 0.1, 1, msgs, target.id, { v: 100 }, state);

  assert.ok((threat.ai?.windupTimer ?? 0) > 0, 'clear corridor should start the red crack pulse');
  assert.equal(threat.ai?.windupTargetId, target.id);

  threat.hp = (threat.hp ?? DEF.hp) - 1;
  syncEntities(entities);
  updateMonster(world, entities, threat, 0.05, 1.05, msgs, target.id, { v: 100 }, state);

  assert.equal(threat.ai?.windupTimer, undefined);
  assert.equal((threat.ai?.staggerTimer ?? 0) >= TRESKOTNIK_STAGGER_SEC - 0.1, true);
  assert.equal(msgs.some(m => m.text.includes('раскрошило красный рывок')), true);
  assert.equal(
    getRecentEvents(state, { type: 'monster_windup_interrupted', tags: ['treskotnik', 'fracture_sprint', 'hit'], limit: 1 }).length,
    1,
  );
});

test('treskotnik straight sprint damages the target and itself', () => {
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(13.2, 10.5);
  const threat = treskotnik(10.5, 10.5);
  const entities = [target, threat];
  const msgs: Msg[] = [];
  const state = makeGameState({ currentFloor: FloorLevel.KVARTIRY, worldEvents: createWorldEventState() });

  syncEntities(entities);
  updateMonster(world, entities, threat, 0.1, 3, msgs, target.id, { v: 100 }, state);
  assert.ok((threat.ai?.windupTimer ?? 0) > 0);

  syncEntities(entities);
  updateMonster(world, entities, threat, TRESKOTNIK_WINDUP_SEC + 0.01, 3.4, msgs, target.id, { v: 100 }, state);
  assert.ok((threat.ai?.sprintTimer ?? 0) > 0, 'windup completion should arm a straight sprint');

  syncEntities(entities);
  updateMonster(world, entities, threat, 0.2, 3.6, msgs, target.id, { v: 100 }, state);

  assert.ok((target.hp ?? 100) < 100, 'sprint contact should hurt the player');
  assert.ok((threat.hp ?? DEF.hp) < DEF.hp, 'contact burst should chip the brittle monster');
  assert.equal(threat.ai?.sprintTimer, undefined);
  assert.equal(
    getRecentEvents(state, { type: 'monster_sighted', tags: ['treskotnik', 'fracture_sprint', 'hit'], limit: 1 }).length,
    1,
  );
});

test('treskotnik fracture sprint works against a non-player target', () => {
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const distantPlayer = player(80, 80);
  const target = npcTarget(2, 13.2, 10.5);
  const threat = treskotnik(10.5, 10.5);
  const entities = [distantPlayer, target, threat];
  const msgs: Msg[] = [];
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });

  syncEntities(entities);
  updateMonster(world, entities, threat, 0.1, 5, msgs, distantPlayer.id, { v: 100 }, state);
  assert.equal(threat.ai?.windupTargetId, target.id);

  syncEntities(entities);
  updateMonster(world, entities, threat, TRESKOTNIK_WINDUP_SEC + 0.01, 5.4, msgs, distantPlayer.id, { v: 100 }, state);

  syncEntities(entities);
  updateMonster(world, entities, threat, 0.2, 5.6, msgs, distantPlayer.id, { v: 100 }, state);

  assert.equal((target.hp ?? 100) < 100, true, 'NPC target should take the same readable sprint hit');
  assert.equal(
    getRecentEvents(state, { type: 'monster_sighted', tags: ['treskotnik', 'fracture_sprint', 'hit'], targetId: target.id, limit: 1 }).length,
    1,
  );
});
