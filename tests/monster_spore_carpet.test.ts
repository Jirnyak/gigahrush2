import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, FloorLevel, MonsterKind, ProjType, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { DEF, generateSprite } from '../src/entities/spore_carpet';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { updateMonster, setEntityMap, tryMonsterProjectileStagger } from '../src/systems/ai/monster';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { setListenerPos } from '../src/systems/audio';
import { rebuildEntityIndex } from '../src/systems/entity_index';
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

function sporeCarpet(id: number, x: number, y: number): Entity {
  return {
    id,
    type: EntityType.MONSTER,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: DEF.speed,
    sprite: monsterSpr(MonsterKind.SPORE_CARPET),
    hp: DEF.hp,
    maxHp: DEF.hp,
    monsterKind: MonsterKind.SPORE_CARPET,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function prime(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

test('spore carpet definition, ecology, and sprite read as a domestic lurking rug trap', () => {
  const ecology = getMonsterEcology(MonsterKind.SPORE_CARPET);
  const sprite = generateSprite();
  let opaque = 0;
  for (const px of sprite) {
    if ((px >>> 24) !== 0) opaque++;
  }

  assert.equal(DEF.kind, MonsterKind.SPORE_CARPET);
  assert.deepEqual(DEF.aiFlags, ['lurkingFurniture']);
  assert.deepEqual(DEF.floors, [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE]);
  assert.equal(ecology?.rare, false);
  assert.match(DEF.counterplay ?? '', /углы|жилы|жгите|фильтр/i);
  assert.equal(sprite.length, S * S);
  assert.equal(opaque > 300, true, 'spore carpet sprite should have a readable surface area');
});

test('spore carpet wakes up when a target gets near', () => {
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  // Place target close enough to trigger WAKE_RADIUS_SQ
  const target = player(11, 10);
  const carpet = sporeCarpet(2, 10, 10);
  const entities = [target, carpet];
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  prime(entities);
  updateMonster(world, entities, carpet, 0.1, 1, msgs, target.id, { v: 10 }, state);

  assert.equal(carpet.monsterStage, 1, 'carpet should wake up (stage 1)');
  const woke = getRecentEvents(state, { type: 'spore_carpet_woke', tags: ['spore_carpet'], limit: 1 })[0];
  assert.ok(woke);
  assert.equal(woke.data?.reason, 'near');
});

test('spore carpet burns and recoils from fire damage', () => {
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(10, 15);
  const carpet = sporeCarpet(2, 10, 10);
  const fireProjectile: Entity = {
    id: 3,
    type: EntityType.PROJECTILE,
    x: 10,
    y: 10,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 5,
    sprite: 0,
    projType: ProjType.FLAME,
    ownerId: target.id,
  };

  const entities = [target, carpet, fireProjectile];
  const state = makeGameState({ worldEvents: createWorldEventState(), time: 2 });

  prime(entities);
  const handled = tryMonsterProjectileStagger(world, state, carpet, fireProjectile, target.id);

  assert.equal(handled, true, 'fire projectile should cause stagger recoil');
  assert.equal(carpet.monsterStage, 1, 'carpet should wake up from fire');
  const burned = getRecentEvents(state, { type: 'spore_carpet_burned', tags: ['spore_carpet'], limit: 1 })[0];
  assert.ok(burned, 'should emit spore_carpet_burned event');
  assert.ok(burned.tags.includes('fire'), 'event should be tagged with fire');
});
