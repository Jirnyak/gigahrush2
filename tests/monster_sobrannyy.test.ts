import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, FloorLevel, MonsterKind, RoomType, Tex, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { DEF, generateSprite } from '../src/entities/sobrannyy';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { updateMonster, setEntityMap } from '../src/systems/ai/monster';
import { createWorldEventState, getRecentEvents, publishEvent } from '../src/systems/events';
import { registerCellHazardSite } from '../src/systems/cell_hazards';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { setListenerPos } from '../src/systems/audio';
import { makeGameState } from './helpers';
import { S } from '../src/render/pixutil';

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

function roomWorld(): World {
  const world = openWorld();
  world.rooms[0] = {
    id: 0,
    type: RoomType.PRODUCTION,
    x: 8,
    y: 8,
    w: 20,
    h: 8,
    doors: [],
    sealed: false,
    name: 'Запечатанный цех',
    apartmentId: -1,
    wallTex: Tex.CONCRETE,
    floorTex: Tex.F_CONCRETE,
  };
  for (let y = 8; y < 16; y++) {
    for (let x = 8; x < 28; x++) {
      world.roomMap[world.idx(x, y)] = 0;
    }
  }
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

function sobrannyy(x: number, y: number): Entity {
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
    monsterKind: MonsterKind.SOBRANNYY,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

test('sobrannyy definition, ecology, and sprite describe a rare composite brute', () => {
  const ecology = getMonsterEcology(MonsterKind.SOBRANNYY);
  const sprite = generateSprite();
  let opaque = 0;
  for (const px of sprite) if ((px >>> 24) !== 0) opaque++;

  assert.equal(DEF.kind, MonsterKind.SOBRANNYY);
  assert.deepEqual(DEF.aiFlags, ['meatGrowth']);
  assert.deepEqual(DEF.floors, [FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL]);
  assert.equal(ecology?.rare, true);
  assert.equal((ecology?.spawnWeight ?? 1) < 0.65, true, 'should be rarer than Betonnik in generic ecology');
  assert.match(DEF.counterplay ?? '', /слиз|гермодвер|дроб|огн/);
  assert.equal(sprite.length, S * S);
  assert.equal(opaque > 600, true, 'composite sprite should read as a large body');
});

test('sobrannyy growth is capped after repeated damage', () => {
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(22, 10);
  const threat = sobrannyy(10, 10);
  const entities = [target, threat];
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  for (let i = 0; i < 12; i++) {
    threat.hp = (threat.hp ?? DEF.hp) - 10;
    const time = i + 1;
    state.time = time;
    rebuildEntityIndex(entities);
    setEntityMap(new Map(entities.map(e => [e.id, e])));
    updateMonster(world, entities, threat, 0.1, time, msgs, target.id, { v: 10 }, state);
  }

  assert.equal(threat.monsterDmgMult, 1.6);
  assert.equal((threat.spriteScale ?? 1) <= 1.3, true);
  const growthEvents = getRecentEvents(state, { type: 'composite_growth', tags: ['sobrannyy'], limit: 8 });
  assert.equal(growthEvents.length, 3);
});

test('sobrannyy drops pursuit when target reaches active slime hazard', () => {
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(13, 10);
  const threat = sobrannyy(10, 10);
  const entities = [target, threat];
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  registerCellHazardSite(world, {
    id: 'test_slime',
    kind: 'toxic_slime',
    displayName: 'Тестовая слизь',
    cells: [world.idx(13, 10)],
    tags: ['slime', 'toxic'],
  });

  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
  updateMonster(world, entities, threat, 0.1, 1, msgs, target.id, { v: 10 }, state);

  assert.equal(threat.ai?.combatTargetId, undefined);
  assert.equal(threat.ai?.goal, AIGoal.IDLE);
  const isolated = getRecentEvents(state, { type: 'composite_isolated', tags: ['sobrannyy'], limit: 1 })[0];
  assert.ok(isolated);
  assert.equal(isolated.data?.reason, 'slime');
});

test('sobrannyy wakes when a container is opened in its room', () => {
  const world = roomWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(19, 10);
  const threat = sobrannyy(10, 10);
  const entities = [target, threat];
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  state.time = 1;
  publishEvent(state, {
    type: 'container_opened',
    zoneId: 0,
    roomId: 0,
    x: 18,
    y: 10,
    actorId: target.id,
    actorName: target.name,
    severity: 3,
    privacy: 'local',
    tags: ['container', 'shelter'],
    containerId: 77,
  });

  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
  updateMonster(world, entities, threat, 0.1, 1.1, msgs, target.id, { v: 10 }, state);

  assert.equal(threat.ai?.combatTargetId, target.id);
  const woke = getRecentEvents(state, { type: 'composite_woke', tags: ['sobrannyy'], limit: 1 })[0];
  assert.ok(woke);
  assert.equal(woke.data?.reason, 'container');
});
