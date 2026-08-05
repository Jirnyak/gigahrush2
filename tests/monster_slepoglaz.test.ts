import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, FloorLevel, MonsterKind, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { DEF, generateSprite } from '../src/entities/slepoglaz';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { updateMonster, setEntityMap } from '../src/systems/ai/monster';
import { createWorldEventState } from '../src/systems/events';
import { publishNoise, resetNoiseRecords } from '../src/systems/noise';
import { getEntityIndex, rebuildEntityIndex } from '../src/systems/entity_index';
import { setListenerPos } from '../src/systems/audio';
import { monsterSpr } from '../src/render/sprite_index';
import { S, CLEAR } from '../src/render/pixutil';
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

function slepoglaz(id: number, x: number, y: number): Entity {
  return {
    id,
    type: EntityType.MONSTER,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: DEF.speed,
    sprite: monsterSpr(MonsterKind.SLEPOGLAZ),
    hp: DEF.hp,
    maxHp: DEF.hp,
    monsterKind: MonsterKind.SLEPOGLAZ,
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

function countPixels(sprite: Uint32Array, pred: (px: number, x: number, y: number) => boolean): number {
  let count = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = sprite[y * S + x];
      if (pred(px, x, y)) count++;
    }
  }
  return count;
}

test('Slepoglaz definition, ecology, and sprite verify attributes and generation', () => {
  const ecology = getMonsterEcology(MonsterKind.SLEPOGLAZ);
  const sprite = generateSprite();

  assert.equal(DEF.kind, MonsterKind.SLEPOGLAZ);
  assert.deepEqual(DEF.aiFlags, ['lastSoundBeam']);
  assert.deepEqual(DEF.floors, [FloorLevel.MAINTENANCE, FloorLevel.HELL]);
  assert.equal(ecology?.rare, false);
  assert.match(DEF.counterplay ?? '', /шум|сторон|после|упор/i);
  assert.equal(sprite.length, S * S);

  assert.equal(countPixels(sprite, px => px !== CLEAR && (px >>> 24) !== 0) > 600, true, 'sprite should not be blank');

  const greenPixels = countPixels(sprite, px => {
    const r = px & 0xff;
    const g = (px >>> 8) & 0xff;
    const b = (px >>> 16) & 0xff;
    return (px >>> 24) > 0 && g > 135 && g > r * 1.45 && g > b * 1.35;
  });
  assert.equal(greenPixels > 12, true, 'sprite needs readable green beam/charge pixels');

  const darkSeam = countPixels(sprite, (px, x, y) => {
    const r = px & 0xff;
    const g = (px >>> 8) & 0xff;
    const b = (px >>> 16) & 0xff;
    return x >= 21 && x <= 43 && y >= 24 && y <= 36 && (px >>> 24) > 0 && r < 35 && g < 38 && b < 35;
  });
  assert.equal(darkSeam > 25, true, 'sprite should have a dark sealed central slit');
});

test('Slepoglaz aims at last sound position if present, and performs windup', () => {
  resetNoiseRecords();
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(10, 10);
  const monster = slepoglaz(2, 20, 10);
  const entities = [target, monster];
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];
  state.time = 1;

  // Make a noise at 10, 15
  publishNoise(state, {
    x: 10,
    y: 15,
    radius: 20,
    ttl: 4,
    source: 'weapon_fire',
    severity: 3,
    actorId: target.id,
    itemId: 'shotgun',
    tags: ['weapon', 'shotgun', 'metal'],
  });

  prime(entities);
  // dt = 0.1, time = 1
  updateMonster(world, entities, monster, 0.1, state.time, msgs, target.id, { v: 10 }, state);

  // Slepoglaz should have acquired aim at noise (10, 15) and started windup
  assert.equal(monster.ai!.windupTimer! > 0, true);
  assert.equal(monster.ai!.tx, 10);
  assert.equal(monster.ai!.ty, 15);

  // It shouldn't have fired yet
  assert.equal(target.hp, target.maxHp);
});

test('Slepoglaz aims at old position via sight if no recent loud noise', () => {
  resetNoiseRecords();
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(10, 10);
  const monster = slepoglaz(2, 20, 10);
  const entities = [target, monster];
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];
  state.time = 1;

  prime(entities);
  updateMonster(world, entities, monster, 0.1, state.time, msgs, target.id, { v: 10 }, state);

  // Slepoglaz should have acquired aim at sight (10, 10) and started windup
  assert.equal(monster.ai!.windupTimer! > 0, true);
  assert.equal(monster.ai!.tx, 10);
  assert.equal(monster.ai!.ty, 10);
});

test('Slepoglaz completes windup and fires beam, dealing damage to target in line', () => {
  resetNoiseRecords();
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(10, 10);
  const monster = slepoglaz(2, 20, 10);
  const entities = [target, monster];
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];
  state.time = 1;

  // Aim and start windup
  prime(entities);
  updateMonster(world, entities, monster, 0.1, state.time, msgs, target.id, { v: 10 }, state);
  assert.equal(monster.ai!.windupTimer! > 0, true);

  // Fast forward windupTimer
  const dt = monster.ai!.windupTimer!;
  prime(entities);
  updateMonster(world, entities, monster, dt, state.time + dt, msgs, target.id, { v: 10 }, state);

  // Target should be damaged
  assert.equal(target.hp < target.maxHp, true);
  assert.equal(monster.ai!.windupTimer, undefined);
  assert.equal(monster.ai!.staggerTimer! > 0, true);
});

test('Slepoglaz uses close defense melee attack when target is too close', () => {
  resetNoiseRecords();
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  // Place target very close (distance < 1.4)
  const target = player(10, 10);
  const monster = slepoglaz(2, 11, 10);
  const entities = [target, monster];
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];
  state.time = 1;

  prime(entities);
  updateMonster(world, entities, monster, 0.1, state.time, msgs, target.id, { v: 10 }, state);

  // Since target is close, it shouldn't aim/windup, it should directly melee attack
  assert.equal(monster.ai!.windupTimer, undefined);
  assert.equal(target.hp < target.maxHp, true);
});
