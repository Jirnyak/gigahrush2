import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Feature, FloorLevel, MonsterKind, Tex, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { MONSTERS } from '../src/entities/monster';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import { setListenerPos } from '../src/systems/audio';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { applyMonsterIncomingDamage, lotochnikDrainArmorActive } from '../src/systems/monster_traits';
import { drainLineCell, getBoundedWetConnection, wetTerrainCell } from '../src/systems/monster_terrain';
import { publishNoise, resetNoiseRecords } from '../src/systems/noise';
import { makeGameState, makeTestPlayer } from './helpers';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  return world;
}

function monster(kind: MonsterKind, x: number, y: number, hp?: number): Entity {
  const def = MONSTERS[kind];
  return {
    id: 2,
    type: EntityType.MONSTER,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: def.speed,
    sprite: def.sprite,
    hp: hp ?? def.hp,
    maxHp: def.hp,
    monsterKind: kind,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.HUNT, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function prepare(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

function runMonsterHit(kind: MonsterKind, setup?: (world: World) => void): number {
  const world = openWorld();
  setup?.(world);
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = makeTestPlayer({ id: 1, x: 11.1, y: 10.5, hp: 100, maxHp: 100 });
  const threat = monster(kind, 10.5, 10.5);
  const entities = [target, threat];
  prepare(entities);

  updateMonster(world, entities, threat, 0.2, 10, [], target.id, { v: 100 });
  return target.hp ?? 0;
}

test('shared wet terrain helper covers fixtures, water texture, drain edges and bounded connection', () => {
  const world = openWorld();
  world.floorTex[world.idx(5, 5)] = Tex.F_WATER;
  world.features[world.idx(6, 6)] = Feature.SINK;
  world.features[world.idx(7, 7)] = Feature.TOILET;
  world.cells[world.idx(9, 8)] = Cell.WATER;

  assert.equal(wetTerrainCell(world, 5, 5), true);
  assert.equal(wetTerrainCell(world, 6, 6), true);
  assert.equal(wetTerrainCell(world, 7, 7), true);
  assert.equal(drainLineCell(world, 8, 8), true, 'adjacent water should mark a drain firing line');
  assert.equal(wetTerrainCell(world, 8, 8), false, 'adjacent water is a line hint, not a wet actor cell');

  for (let x = 20; x <= 40; x++) world.floorTex[world.idx(x, 20)] = Tex.F_WATER;
  const start = monster(MonsterKind.VODYANOY_KOSHMAR, 20.5, 20.5);
  const target = makeTestPlayer({ id: 1, x: 34.5, y: 20.5 });

  assert.equal(getBoundedWetConnection(world, start, target, 8, 30), undefined, 'wet connection must obey maxCells');
  const connected = getBoundedWetConnection(world, start, target, 32, 30);
  assert.ok(connected);
  assert.equal(connected.cells <= 32, true);
  assert.equal(connected.waterCells > 0, true);
});

test('tube eel waterStrider damage is stronger in wet terrain and weaker on dry edge', () => {
  const dryHp = runMonsterHit(MonsterKind.TUBE_EEL);
  const wetHp = runMonsterHit(MonsterKind.TUBE_EEL, world => {
    world.cells[world.idx(10, 10)] = Cell.WATER;
  });

  assert.equal(wetHp < dryHp, true, 'water should increase tube eel contact damage');
});

test('lotochnik drain armor and regeneration use local wet terrain only', () => {
  const world = openWorld();
  const threat = monster(MonsterKind.LOTOCHNIK, 10.5, 10.5, 40);
  const player = makeTestPlayer({ id: 1, x: 80.5, y: 80.5, hp: 100, maxHp: 100 });
  const entities = [player, threat];
  const msgs: Msg[] = [];

  world.features[world.idx(10, 10)] = Feature.SINK;
  assert.equal(lotochnikDrainArmorActive(world, threat), true);
  assert.equal(applyMonsterIncomingDamage(world, threat, 100) < 100, true);
  prepare(entities);
  updateMonster(world, entities, threat, 2, 1, msgs, player.id, { v: 100 });
  assert.equal((threat.hp ?? 0) > 40, true, 'wet drain should regenerate Lotochnik up to its max HP');

  threat.hp = 40;
  world.features[world.idx(10, 10)] = Feature.NONE;
  assert.equal(lotochnikDrainArmorActive(world, threat), false);
  assert.equal(applyMonsterIncomingDamage(world, threat, 100), 100);
  updateMonster(world, entities, threat, 2, 3, msgs, player.id, { v: 100 });
  assert.equal(threat.hp, 40, 'dry concrete should disable Lotochnik regeneration');
});

test('noise probe reveals Chernosliz without a full water scan', () => {
  resetNoiseRecords();
  const world = openWorld();
  const target = makeTestPlayer({ id: 1, x: 20.5, y: 10.5, hp: 100, maxHp: 100 });
  const threat = monster(MonsterKind.CHERNOSLIZ, 10.5, 10.5);
  const entities = [target, threat];
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, worldEvents: createWorldEventState(), time: 1 });
  const msgs: Msg[] = [];

  world.cells[world.idx(10, 10)] = Cell.WATER;
  prepare(entities);
  publishNoise(state, {
    x: 11.5,
    y: 10.5,
    radius: 12,
    ttl: 3,
    source: 'decoy',
    severity: 3,
    actorId: target.id,
    itemId: 'noise_can',
    tags: ['counterplay', 'probe'],
  });

  updateMonster(world, entities, threat, 0.2, 1, msgs, target.id, { v: 100 }, state);

  assert.equal(threat.monsterStage, 1);
  assert.equal(msgs.some(m => m.text.includes('Шум вскрыл черную воду')), true);
  const revealed = getRecentEvents(state, { type: 'monster_sighted', tags: ['noise_reveal'], limit: 1 })[0];
  assert.ok(revealed);
  assert.equal(revealed.monsterKind, MonsterKind.CHERNOSLIZ);
  assert.equal(revealed.data.noiseSource, 'decoy');
});
