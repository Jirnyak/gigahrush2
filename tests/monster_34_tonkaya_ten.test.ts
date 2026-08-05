import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, FloorLevel, MonsterKind, RoomType, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { MONSTERS } from '../src/entities/monster';
import { DEF as TONKAYA_TEN_DEF, generateSprite } from '../src/entities/tonkaya_ten';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { S } from '../src/render/pixutil';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { setListenerPos } from '../src/systems/audio';

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

function tonkaya(x: number, y: number): Entity {
  return {
    id: 2,
    type: EntityType.MONSTER,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: TONKAYA_TEN_DEF.speed,
    sprite: TONKAYA_TEN_DEF.sprite,
    hp: TONKAYA_TEN_DEF.hp,
    maxHp: TONKAYA_TEN_DEF.hp,
    monsterKind: MonsterKind.TONKAYA_TEN,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.HUNT, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function syncEntities(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

test('tonkaya ten is standalone data, not a shadow variant', () => {
  assert.equal(TONKAYA_TEN_DEF.kind, MonsterKind.TONKAYA_TEN);
  assert.deepEqual(TONKAYA_TEN_DEF.aiFlags, ['baitLine']);
  assert.deepEqual(TONKAYA_TEN_DEF.floors, [FloorLevel.MINISTRY, FloorLevel.LIVING, FloorLevel.VOID]);
  assert.equal(TONKAYA_TEN_DEF.hp < MONSTERS[MonsterKind.SHADOW].hp, true);
  assert.match(TONKAYA_TEN_DEF.counterplay ?? '', /свет|шум|гонитесь/);

  const ecology = getMonsterEcology(MonsterKind.TONKAYA_TEN);
  assert.ok(ecology);
  assert.equal(ecology.rooms.includes(RoomType.CORRIDOR), true, 'Tonkaya Ten should prefer corridor-shaped lines');
  assert.equal(ecology?.rumorIds.includes('monster_tonkaya_ten_follow'), true);
});

test('tonkaya ten sprite is a readable narrow shadow with blue joints', () => {
  const sprite = generateSprite();
  let opaque = 0;
  let blueJoints = 0;
  for (const px of sprite) {
    if ((px >>> 24) !== 0) opaque++;
    const b = (px >>> 16) & 255;
    const g = (px >>> 8) & 255;
    const r = px & 255;
    if (b > r + 35 && b > g + 15) blueJoints++;
  }
  assert.equal(sprite.length, S * S);
  assert.equal(opaque >= 420, true);
  assert.equal(blueJoints >= 8, true);
});

test('tonkaya ten arms a dark bait line and only hits hard when crossed', () => {
  const world = openDarkWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(18.5, 10.5);
  const threat = tonkaya(10.5, 10.5);
  const entities = [target, threat];
  const msgs: Msg[] = [];

  syncEntities(entities);
  updateMonster(world, entities, threat, 0.2, 10, msgs, target.id, { v: 100 });
  const line = threat.ai?.baitLine;
  assert.ok(line, 'Tonkaya Ten should select a radius-capped bait line');

  threat.x = line.x + 0.5;
  threat.y = line.y + 0.5;
  line.armed = true;
  line.nerve = 5;
  target.x = world.wrap(line.x + line.dx * 2) + 0.5;
  target.y = world.wrap(line.y + line.dy * 2) + 0.5;
  syncEntities(entities);
  updateMonster(world, entities, threat, 0.2, 11, msgs, target.id, { v: 100 });

  assert.equal((target.hp ?? 100) <= 85, true, 'crossing the prepared line should trigger the one flank strike');
  assert.equal(threat.ai?.baitLine, undefined, 'flank strike spends the bait line');
});

test('tonkaya ten loses nerve when ignored instead of getting the flank hit', () => {
  const world = openDarkWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(18.5, 10.5);
  const threat = tonkaya(10.5, 10.5);
  const entities = [target, threat];

  syncEntities(entities);
  updateMonster(world, entities, threat, 0.2, 20, [], target.id, { v: 100 });
  const line = threat.ai?.baitLine;
  assert.ok(line);
  threat.x = line.x + 0.5;
  threat.y = line.y + 0.5;
  line.armed = true;
  line.nerve = 0.05;
  target.x = world.wrap(line.x + line.dx * 7) + 0.5;
  target.y = world.wrap(line.y + line.dy + 1) + 0.5;
  syncEntities(entities);
  updateMonster(world, entities, threat, 0.2, 21, [], target.id, { v: 100 });

  assert.equal(threat.ai?.baitLine, undefined);
  assert.equal(target.hp, 100);
});

test('tonkaya ten bait line can punish an NPC target that follows the silhouette', () => {
  const world = openDarkWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = npcTarget(18.5, 10.5);
  const threat = tonkaya(10.5, 10.5);
  const entities = [target, threat];

  syncEntities(entities);
  updateMonster(world, entities, threat, 0.2, 30, [], 1, { v: 100 });
  const line = threat.ai?.baitLine;
  assert.ok(line, 'local bait-line selection should not depend on player identity');

  threat.x = line.x + 0.5;
  threat.y = line.y + 0.5;
  line.armed = true;
  line.nerve = 5;
  target.x = world.wrap(line.x + line.dx * 2) + 0.5;
  target.y = world.wrap(line.y + line.dy * 2) + 0.5;
  syncEntities(entities);
  updateMonster(world, entities, threat, 0.2, 31, [], 1, { v: 100 });

  assert.equal((target.hp ?? 100) < 100, true);
  assert.equal(threat.ai?.baitLine, undefined);
});
