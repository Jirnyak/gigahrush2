import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, FloorLevel, MonsterKind, type Entity, type Msg, type WorldContainer } from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology, MONSTER_ECOLOGY } from '../src/data/monster_ecology';
import { RUMORS } from '../src/data/rumors';
import { DEF, generateSprite } from '../src/entities/chernosliz';
import { MONSTERS, NEW_MONSTERS_BY_FLOOR } from '../src/entities/monster';
import { generateBlackSlimeEyes } from '../src/gen/maintenance/black_slime_eyes';
import { S } from '../src/render/pixutil';
import { setListenerPos } from '../src/systems/audio';
import { isChernoSlizHidden, setEntityMap, updateMonster } from '../src/systems/ai/monster';
import { takeFromContainer } from '../src/systems/containers';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { makeGameState, makeTestPlayer } from './helpers';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  return world;
}

function player(x: number, y: number, tool?: string): Entity {
  return makeTestPlayer({
    id: 1,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    hp: 100,
    maxHp: 100,
    tool,
  });
}

function chernosliz(x: number, y: number): Entity {
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
    monsterKind: MonsterKind.CHERNOSLIZ,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function prepare(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

test('Chernosliz is a standalone maintenance black-water monster', () => {
  const ecology = getMonsterEcology(MonsterKind.CHERNOSLIZ);
  const sprite = generateSprite();
  let opaque = 0;
  let green = 0;

  for (const px of sprite) {
    if ((px >>> 24) === 0) continue;
    opaque++;
    const r = px & 0xff;
    const g = (px >>> 8) & 0xff;
    const b = (px >>> 16) & 0xff;
    if (g > 150 && g > r * 1.8 && g > b * 1.4) green++;
  }

  assert.equal(DEF.kind, MonsterKind.CHERNOSLIZ);
  assert.equal(DEF.name, 'Чернослиз');
  assert.equal(MONSTERS[MonsterKind.CHERNOSLIZ], DEF);
  assert.deepEqual(DEF.aiFlags, ['blackWaterWake']);
  assert.deepEqual(DEF.floors, [FloorLevel.MAINTENANCE]);
  assert.equal(DEF.isRanged, true);
  assert.equal(DEF.hp <= 22, true, 'Chernosliz should stay fragile once exposed');
  assert.equal(DEF.speed <= 0.55, true, 'Chernosliz should stay slow and turret-like');
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.MAINTENANCE]?.includes(MonsterKind.CHERNOSLIZ), true);
  assert.deepEqual(ecology?.rumorIds, ['ecology_chernosliz_wake']);
  assert.equal(sprite.length, S * S);
  assert.equal(opaque > 600, true, 'sprite should read as a half-submerged black eye mass');
  assert.equal(green > 18, true, 'sprite needs a readable toxic green slit');
});

test('Chernosliz retired old black slime eye content hooks', () => {
  const oldVariantId = 'black' + '_slime' + '_eye';
  const oldRumorId = ['variant', oldVariantId].join('_');

  assert.equal(RUMORS.some(r => r.id === oldRumorId), false);
  assert.equal(RUMORS.some(r => r.id === 'ecology_chernosliz_wake'), true);
  for (const ecology of MONSTER_ECOLOGY) {
  }
});

test('Chernosliz stays hidden in dark water until light, damage, close range, or dry ground exposes it', () => {
  const world = openWorld();
  const threat = chernosliz(10.5, 10.5);
  const target = player(20.5, 10.5);

  world.cells[world.idx(10, 10)] = Cell.WATER;
  assert.equal(isChernoSlizHidden(world, threat, target), true, 'dark water should hide an undamaged distant Chernosliz');

  world.light[world.idx(10, 10)] = 0.31;
  assert.equal(isChernoSlizHidden(world, threat, target), false, 'local light should expose the wake');

  world.light[world.idx(10, 10)] = 0;
  threat.hp = DEF.hp - 1;
  assert.equal(isChernoSlizHidden(world, threat, target), false, 'damage should expose the creature');

  threat.hp = DEF.hp;
  target.x = 14.5;
  assert.equal(isChernoSlizHidden(world, threat, target), false, 'close range should expose the creature');

  target.x = 20.5;
  world.cells[world.idx(10, 10)] = Cell.FLOOR;
  assert.equal(isChernoSlizHidden(world, threat, target), false, 'dry ground should remove the hidden state');
});

test('Chernosliz telegraphs first ranged shot only after being revealed', () => {
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(20.5, 10.5);
  const threat = chernosliz(10.5, 10.5);
  const entities = [target, threat];
  const msgs: Msg[] = [];
  const nextId = { v: 3 };

  world.cells[world.idx(10, 10)] = Cell.WATER;
  prepare(entities);
  updateMonster(world, entities, threat, 1, 1, msgs, target.id, nextId);
  assert.equal(threat.ai?.windupTimer, undefined);
  assert.equal(threat.ai?.combatTargetId, undefined);
  assert.equal(threat.spriteScale, 0.58);

  world.light[world.idx(10, 10)] = 0.34;
  threat.ai!.combatScanCd = 0;
  updateMonster(world, entities, threat, 1, 2, msgs, target.id, nextId);
  assert.equal((threat.ai?.windupTimer ?? 0) > 0, true, 'revealed Chernosliz should start a readable first-shot windup');
  assert.equal(threat.ai?.windupTargetId, target.id);
  assert.equal(msgs.some(m => m.text.includes('Чернослиз раскрывает зеленую щель')), true);

  updateMonster(world, entities, threat, 0.6, 2.6, msgs, target.id, nextId);
  assert.equal(entities.some(e => e.type === EntityType.PROJECTILE && e.ownerId === threat.id), true, 'windup should finish as a ranged shot');
});

test('black slime authored encounter spawns Chernosliz directly', () => {
  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 1 };

  generateBlackSlimeEyes({ world, entities, nextId, spawnX: 512, spawnY: 512 });

  const sample = world.containers.find(container =>
    container.tags.includes('ag67_black_slime') &&
    container.tags.includes('sample') &&
    container.tags.includes('lure')) as WorldContainer | undefined;
  assert.ok(sample, 'black slime POI should expose a lure sample container');

  const actor = makeTestPlayer({ id: 99, x: sample.x + 0.5, y: sample.y + 0.5, faction: Faction.PLAYER });
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, worldEvents: createWorldEventState() });

  assert.equal(takeFromContainer(sample, actor, 0, 1, state), true);

  const spawned = entities.filter(entity => entity.type === EntityType.MONSTER && entity.monsterKind === MonsterKind.CHERNOSLIZ);
  assert.equal(spawned.length > 0, true, 'disturbing the sample should spawn Chernosliz');

  const disturbed = getRecentEvents(state, { type: 'black_slime_disturbed', tags: ['black_slime'], limit: 1 })[0];
  assert.ok(disturbed, 'disturbing the POI should publish the local black slime event');
  assert.equal(disturbed.data.spawnedEyesNow, spawned.length);
});
