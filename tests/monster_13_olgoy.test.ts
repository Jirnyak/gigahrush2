import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, FloorLevel, MonsterKind, Tex, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { MONSTERS } from '../src/entities/monster';
import { DEF, generateSprite } from '../src/entities/olgoy';
import { generateOlgoyMeatCache } from '../src/gen/maintenance/olgoy_meat_cache';
import {
  olgoyAmbushCell,
  olgoyNearAmbushTerrain,
  olgoyTerrainDmgMult,
  olgoyTerrainMoveMult,
  setEntityMap,
  updateMonster,
} from '../src/systems/ai/monster';
import { setListenerPos } from '../src/systems/audio';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import {
  getActiveMonsterBaits,
  placeMonsterBait,
  resetMonsterBaits,
} from '../src/systems/monster_bait';
import { S } from '../src/render/pixutil';
import { makeGameState, makeTestNpc, makeTestPlayer } from './helpers';

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
    level: 3,
    hqRoomId: -1,
  };
  return world;
}

function olgoy(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 2,
    type: EntityType.MONSTER,
    x: 10.5,
    y: 10.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: DEF.speed,
    sprite: DEF.sprite,
    hp: DEF.hp,
    maxHp: DEF.hp,
    monsterKind: MonsterKind.OLGOY,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    ...overrides,
  };
}

function runOneTick(world: World, entities: Entity[], threat: Entity, playerId: number, state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, worldEvents: createWorldEventState() })): Msg[] {
  setListenerPos(512, 512, world.dist2.bind(world));
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
  const msgs: Msg[] = [];
  updateMonster(world, entities, threat, 0.25, state.time, msgs, playerId, { v: 100 }, state);
  return msgs;
}

test('olgoy is a standalone collector meat worm with readable sprite and ecology', () => {
  const ecology = getMonsterEcology(MonsterKind.OLGOY);
  const sprite = generateSprite();
  let opaque = 0;
  let darkMouth = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = sprite[y * S + x];
      if ((px >>> 24) === 0) continue;
      opaque++;
      if (x >= 20 && x <= 44 && y >= 14 && y <= 32 && (px & 0xff) < 70) darkMouth++;
    }
  }

  assert.equal(DEF.kind, MonsterKind.OLGOY);
  assert.equal(MONSTERS[MonsterKind.OLGOY], DEF);
  assert.deepEqual(DEF.aiFlags, ['foodBait', 'meatWorm']);
  assert.deepEqual(DEF.floors, [FloorLevel.MAINTENANCE, FloorLevel.HELL]);
  assert.equal(DEF.speed < MONSTERS[MonsterKind.TUBE_EEL].speed, true, 'Olgoy should be slower than the tube eel');
  assert.equal(DEF.hp > MONSTERS[MonsterKind.TUBE_EEL].hp, true, 'Olgoy should be a heavier worm than the tube eel');
  assert.equal(ecology?.rare, true);
  assert.deepEqual(ecology?.rumorIds, ['monster_olgoy_meat', 'ecology_olgoy_collector']);
  assert.match(ecology?.counterplay ?? '', /мясо|сух/);
  assert.equal(opaque > 650, true, 'sprite should read as a thick pale worm');
  assert.equal(darkMouth > 90, true, 'sprite should show a large dark mouth ring');
});

test('olgoy terrain logic slows dry floor and powers local water or pipe ambushes', () => {
  const world = openWorld();
  const threat = olgoy();

  assert.equal(olgoyAmbushCell(world, 10, 10), false);
  assert.equal(olgoyNearAmbushTerrain(world, threat), false);
  assert.equal(olgoyTerrainMoveMult(world, threat) < 1, true);
  assert.equal(olgoyTerrainDmgMult(world, threat) < 1, true);

  world.cells[world.idx(10, 10)] = Cell.WATER;
  assert.equal(olgoyAmbushCell(world, 10, 10), true);
  assert.equal(olgoyNearAmbushTerrain(world, threat), true);
  assert.equal(olgoyTerrainMoveMult(world, threat) > 1, true);
  assert.equal(olgoyTerrainDmgMult(world, threat) > 1.3, true);

  world.cells[world.idx(10, 10)] = Cell.FLOOR;
  world.wallTex[world.idx(12, 10)] = Tex.PIPE;
  assert.equal(olgoyNearAmbushTerrain(world, threat), true, 'nearby pipe texture should count as local ambush terrain');
});

test('raw meat bait takes priority over a non-contact target and emits olgoy fed event', () => {
  resetMonsterBaits();
  const world = openWorld();
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, time: 12, worldEvents: createWorldEventState() });
  const player = makeTestPlayer({ id: 1, x: 16, y: 10.5, hp: 100, maxHp: 100, inventory: [{ defId: 'rawmeat', count: 1 }] });
  const threat = olgoy();
  const entities = [player, threat];

  assert.equal(placeMonsterBait(state, world, player, threat.x, threat.y, 'rawmeat', 1, 'drop'), true);
  runOneTick(world, entities, threat, player.id, state);

  assert.equal(player.hp, 100);
  assert.equal(getActiveMonsterBaits().length, 0);
  const fed = getRecentEvents(state, { type: 'olgoy_fed', limit: 1 })[0];
  assert.equal(fed?.monsterKind, MonsterKind.OLGOY);
  assert.equal(fed?.data?.source, 'bait');
  assert.equal(fed?.data?.itemId, 'rawmeat');
  assert.ok(getRecentEvents(state, { type: 'monster_bait_consumed', limit: 1 })[0]);
});

test('olgoy eats nearby corpses when not locked in contact combat', () => {
  resetMonsterBaits();
  const world = openWorld();
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, time: 15, worldEvents: createWorldEventState() });
  const threat = olgoy();
  const corpse = makeTestNpc({ id: 3, x: 11.1, y: 10.5, alive: false, hp: 0, maxHp: 40 });
  const entities = [threat, corpse];

  runOneTick(world, entities, threat, 1, state);

  const fed = getRecentEvents(state, { type: 'olgoy_fed', limit: 1 })[0];
  assert.equal(fed?.targetId, corpse.id);
  assert.equal(fed?.data?.source, 'corpse');
});

test('water ambush bite drags the player toward the pipe mouth', () => {
  resetMonsterBaits();
  const world = openWorld();
  world.cells[world.idx(10, 10)] = Cell.WATER;
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, time: 18, worldEvents: createWorldEventState() });
  const player = makeTestPlayer({ id: 1, x: 11.3, y: 10.5, hp: 100, maxHp: 100 });
  const threat = olgoy({ x: 10.4, y: 10.5, attackCd: 0 });
  const entities = [player, threat];
  const beforeX = player.x;

  const msgs = runOneTick(world, entities, threat, player.id, state);

  assert.equal((player.hp ?? 100) < 100, true);
  assert.equal(player.x < beforeX, true, 'drag should pull the target toward the worm');
  assert.ok(msgs.some(m => m.text.includes('Олгой-Хорхой поднялся')));
  assert.equal(getRecentEvents(state, { type: 'olgoy_burrowed', limit: 1 })[0]?.monsterKind, MonsterKind.OLGOY);
  assert.equal(getRecentEvents(state, { type: 'olgoy_dragged_target', limit: 1 })[0]?.targetId, player.id);
});

test('maintenance olgoy meat cache gives a reachable authored spawn and bait counterplay', () => {
  const world = openWorld();
  const entities: Entity[] = [];
  generateOlgoyMeatCache({ world, entities, nextId: { v: 1 }, spawnX: 512, spawnY: 512 });

  const room = world.rooms.find(r => r.name === 'Мясной сборник коллектора');
  assert.ok(room, 'missing olgoy meat cache room');
  const threat = entities.find(e => e.type === EntityType.MONSTER && e.monsterKind === MonsterKind.OLGOY);
  assert.ok(threat, 'meat cache should spawn Olgoy-Khorkhoy');
  assert.equal(olgoyNearAmbushTerrain(world, threat), true, 'authored spawn should start on local water/pipe terrain');
  assert.ok(entities.some(e => e.type === EntityType.ITEM_DROP && e.inventory?.some(item => item.defId === 'rawmeat')), 'room should expose raw meat bait');
  assert.ok(entities.some(e => e.type === EntityType.ITEM_DROP && e.inventory?.some(item => item.defId === 'harpoon_gun' || item.defId === 'ammo_harpoon')), 'room should expose ranged counterplay');
});
