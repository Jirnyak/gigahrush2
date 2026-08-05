import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, EntityType, FloorLevel, MonsterKind, AIGoal, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { DEF, generateSprite } from '../src/entities/trubnyy_avtomat';
import {
  TRUBNYY_WET_LINE_MAX_CELLS,
  TRUBNYY_WET_LINE_RECOVERY_SEC,
  TRUBNYY_WET_LINE_WINDUP_SEC,
  getTrubnyyWetLineShot,
  updateTrubnyyWetLineShot,
} from '../src/systems/ai/monster';

function carveWetLineWorld(): World {
  const world = new World();
  const y = 20;
  for (let x = 8; x <= 32; x++) {
    world.cells[world.idx(x, y)] = Cell.FLOOR;
    world.cells[world.idx(x, y - 1)] = Cell.FLOOR;
    world.cells[world.idx(x, y + 1)] = Cell.FLOOR;
  }
  for (let x = 12; x <= 25; x++) {
    world.cells[world.idx(x, y)] = Cell.WATER;
  }
  return world;
}

function monster(): Entity {
  return {
    id: 1,
    type: EntityType.MONSTER,
    x: 10.5,
    y: 20.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: DEF.speed,
    sprite: 0,
    hp: DEF.hp,
    maxHp: DEF.hp,
    monsterKind: MonsterKind.TRUBNYY_AVTOMAT,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.HUNT, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function player(x: number, y: number): Entity {
  return {
    id: 2,
    type: EntityType.NPC, persistentNpcId: 'player',
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    hp: 100,
    maxHp: 100,
  };
}

test('trubnyy avtomat is a standalone maintenance wet-line monster', () => {
  assert.equal(DEF.kind, MonsterKind.TRUBNYY_AVTOMAT);
  assert.equal(DEF.isRanged, true);
  assert.deepEqual(DEF.aiFlags, ['wetLineShot']);
  assert.deepEqual(DEF.floors, [FloorLevel.MAINTENANCE]);
  assert.equal(DEF.hp >= 140, true, 'machine should be armored by durability');
  assert.equal(DEF.speed < 1, true, 'machine should be slow enough to flank');
  assert.equal(DEF.attackRate >= TRUBNYY_WET_LINE_RECOVERY_SEC, true, 'definition should expose a long recovery window');

  const ecology = getMonsterEcology(MonsterKind.TRUBNYY_AVTOMAT);
  assert.ok(ecology, 'ecology entry is required for direct spawn weighting');
  assert.deepEqual(ecology?.floors, [FloorLevel.MAINTENANCE]);
  assert.match(ecology?.counterplay ?? '', /мокр|остыв|фланг|сух/);

  const opaque = [...generateSprite()].filter(px => (px >>> 24) !== 0).length;
  assert.equal(opaque > 450, true, 'sprite should be readable in the atlas');
});

test('trubnyy wet-line targeting is bounded and denied by stepping off line', () => {
  const world = carveWetLineWorld();
  const m = monster();
  const wetTarget = player(20.5, 20.5);
  const drySideTarget = player(20.5, 21.5);
  const farTarget = player(40.5, 20.5);

  const shot = getTrubnyyWetLineShot(world, m, wetTarget);
  assert.ok(shot, 'wet row should be a valid shot line');
  assert.equal(shot.cells <= TRUBNYY_WET_LINE_MAX_CELLS, true);
  assert.equal(shot.waterCells >= 4, true);
  assert.equal(getTrubnyyWetLineShot(world, m, drySideTarget), undefined);
  assert.equal(getTrubnyyWetLineShot(world, m, farTarget), undefined);
});

test('trubnyy wet-line shot charges visibly and locks out during recovery', () => {
  const world = carveWetLineWorld();
  const m = monster();
  const target = player(20.5, 20.5);
  const entities = [m, target];
  const msgs: Msg[] = [];
  const nextId = { v: 3 };

  assert.equal(updateTrubnyyWetLineShot(world, entities, m, target, DEF, 0.1, 1, msgs, target.id, nextId), true);
  assert.ok((m.ai?.windupTimer ?? 0) > 0, 'first valid line starts a charge');

  const beforeShot = entities.length;
  assert.equal(updateTrubnyyWetLineShot(world, entities, m, target, DEF, TRUBNYY_WET_LINE_WINDUP_SEC + 0.01, 2, msgs, target.id, nextId), true);
  assert.equal(entities.length, beforeShot + 1, 'charge completion emits one projectile');
  assert.equal(m.attackCd, TRUBNYY_WET_LINE_RECOVERY_SEC);

  assert.equal(updateTrubnyyWetLineShot(world, entities, m, target, DEF, 0.5, 3, msgs, target.id, nextId), true);
  assert.equal(entities.length, beforeShot + 1, 'recovery should not fire another projectile');
  assert.equal((m.attackCd ?? 0) < TRUBNYY_WET_LINE_RECOVERY_SEC, true);
});
