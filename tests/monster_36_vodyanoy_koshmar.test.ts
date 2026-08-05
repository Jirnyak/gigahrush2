import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, FloorLevel, MonsterKind, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { DEF, generateSprite } from '../src/entities/vodyanoy_koshmar';
import { generateVodyanoyKoshmarLine } from '../src/gen/maintenance/vodyanoy_koshmar_line';
import { S } from '../src/render/pixutil';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import {
  VODYANOY_WET_LINE_MAX_CELLS,
  getVodyanoyWaterPressureLine,
  updateVodyanoyWaterPressureLine,
} from '../src/systems/ai/monster';
import { makeGameState } from './helpers';

function carveWaterPressureWorld(): World {
  const world = new World();
  const y = 20;
  for (let x = 8; x <= 34; x++) {
    world.cells[world.idx(x, y - 1)] = Cell.FLOOR;
    world.cells[world.idx(x, y + 1)] = Cell.FLOOR;
  }
  for (let x = 10; x <= 24; x++) world.cells[world.idx(x, y)] = Cell.WATER;
  for (let x = 26; x <= 31; x++) world.cells[world.idx(x, y)] = Cell.WATER;
  return world;
}

function monster(): Entity {
  return {
    id: 1,
    type: EntityType.MONSTER,
    x: 11.5,
    y: 20.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: DEF.speed,
    sprite: DEF.sprite,
    hp: DEF.hp,
    maxHp: DEF.hp,
    monsterKind: MonsterKind.VODYANOY_KOSHMAR,
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
    rpg: { level: 1, xp: 0, attrPoints: 0, str: 0, agi: 0, int: 0, psi: 12, maxPsi: 12 },
  };
}

test('vodyanoy koshmar is standalone maintenance water-line pressure content', () => {
  const ecology = getMonsterEcology(MonsterKind.VODYANOY_KOSHMAR);
  const sprite = generateSprite();
  let opaque = 0;
  for (const px of sprite) if ((px >>> 24) !== 0) opaque++;

  assert.equal(DEF.kind, MonsterKind.VODYANOY_KOSHMAR);
  assert.deepEqual(DEF.aiFlags, ['waterPressureLine']);
  assert.deepEqual(DEF.floors, [FloorLevel.MAINTENANCE]);
  assert.match(DEF.counterplay ?? '', /Сух|мокр|burst/);
  assert.equal(ecology?.rare, false);
  assert.match(ecology?.counterplay ?? '', /мокр|сух|давлен/);
  assert.equal(sprite.length, S * S);
  assert.ok(opaque > 420, 'sprite should read as a reflected humanoid');
});

test('vodyanoy water-pressure line is bounded and broken by dry concrete', () => {
  const world = carveWaterPressureWorld();
  const threat = monster();
  const wetTarget = player(18.5, 20.5);
  const dryTarget = player(18.5, 21.5);
  const disconnectedWetTarget = player(28.5, 20.5);

  const line = getVodyanoyWaterPressureLine(world, threat, wetTarget);
  assert.ok(line, 'same wet run should connect pressure');
  assert.equal(line.cells <= VODYANOY_WET_LINE_MAX_CELLS, true);
  assert.equal(line.waterCells > 0, true);
  assert.equal(getVodyanoyWaterPressureLine(world, threat, dryTarget), undefined);
  assert.equal(getVodyanoyWaterPressureLine(world, threat, disconnectedWetTarget), undefined);
});

test('vodyanoy pressure ramps, drains PSI, and publishes dry-break cue', () => {
  const world = carveWaterPressureWorld();
  const threat = monster();
  const target = player(18.5, 20.5);
  const msgs = [];
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, worldEvents: createWorldEventState() });

  updateVodyanoyWaterPressureLine(world, threat, target, 0.4, 1, msgs, target.id, state);
  assert.ok((threat.ai?.waterPressure ?? 0) > 0, 'connected wet line should ramp pressure');
  assert.ok((target.hp ?? 100) < 100, 'pressure pulse should damage the player');
  assert.ok((target.rpg?.psi ?? 12) < 12, 'pressure pulse should drain PSI');
  assert.ok(getRecentEvents(state, { type: 'monster_sighted', tags: ['vodyanoy_koshmar'], limit: 1 })[0]);

  target.y = 21.5;
  updateVodyanoyWaterPressureLine(world, threat, target, 0.4, 2, msgs, target.id, state);
  assert.equal(getVodyanoyWaterPressureLine(world, threat, target), undefined);
  assert.ok((threat.ai?.waterPressure ?? 0) < 0.4, 'dry concrete should collapse pressure quickly');
  assert.ok(getRecentEvents(state, { type: 'monster_windup_interrupted', tags: ['dry_break'], limit: 1 })[0]);
});

test('vodyanoy pump room spawns reachable connected and disconnected wet paths', () => {
  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 1 };

  generateVodyanoyKoshmarLine({ world, entities, nextId, spawnX: 512, spawnY: 512 });

  const threat = entities.find(entity => entity.type === EntityType.MONSTER && entity.monsterKind === MonsterKind.VODYANOY_KOSHMAR);
  assert.ok(threat, 'POI should spawn Vodyanoy Koshmar');

  const room = world.rooms.find(candidate => candidate.name === 'Насосная с отражением под полом');
  assert.ok(room, 'POI room should be authored and discoverable');
  const midY = room.y + Math.floor(room.h / 2);
  assert.ok(getVodyanoyWaterPressureLine(world, threat, player(room.x + 12.5, midY + 0.5)));
  assert.equal(getVodyanoyWaterPressureLine(world, threat, player(room.x + 12.5, midY + 6.5)), undefined);
});
