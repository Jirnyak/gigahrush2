import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, FloorLevel, MonsterKind, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { DEF, generateSprite } from '../src/entities/dikiy_mertvyak';
import { MONSTERS } from '../src/entities/monster';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { updateMonster, setEntityMap } from '../src/systems/ai/monster';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { setListenerPos } from '../src/systems/audio';
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
    level: 1,
    hqRoomId: -1,
  };
  return world;
}

function dikiy(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 2,
    type: EntityType.MONSTER,
    x: 10,
    y: 10,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: DEF.speed,
    sprite: DEF.sprite,
    hp: DEF.hp,
    maxHp: DEF.hp,
    monsterKind: MonsterKind.DIKIY_MERTVYAK,
    attackCd: 1.2,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    ...overrides,
  };
}

function crowdNpc(id: number, x: number, y: number): Entity {
  return makeTestNpc({
    id,
    x,
    y,
    hp: 40,
    maxHp: 40,
    faction: Faction.CITIZEN,
    ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  });
}

test('dikiy mertvyak is a standalone fragile crowd-runner, not the old zombie variant', () => {
  const ecology = getMonsterEcology(MonsterKind.DIKIY_MERTVYAK);
  const sprite = generateSprite();
  let opaque = 0;
  let translucent = 0;
  let brightKnuckles = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = sprite[y * S + x];
      const alpha = px >>> 24;
      if (alpha !== 0) opaque++;
      if (alpha > 0 && alpha < 255) translucent++;
      if (x >= 41 && y >= 36 && alpha !== 0 && (px & 0xff) > 200) brightKnuckles++;
    }
  }

  assert.equal(DEF.kind, MonsterKind.DIKIY_MERTVYAK);
  assert.equal(MONSTERS[MonsterKind.DIKIY_MERTVYAK], DEF);
  assert.equal(DEF.hp < MONSTERS[MonsterKind.ZOMBIE].hp, true);
  assert.equal(DEF.speed > MONSTERS[MonsterKind.ZOMBIE].speed, true);
  assert.deepEqual(DEF.aiFlags, ['crowdShove']);
  assert.deepEqual(DEF.floors, [FloorLevel.KVARTIRY, FloorLevel.LIVING]);
  assert.equal(ecology?.floors.includes(FloorLevel.KVARTIRY), true);
  assert.equal(ecology?.floors.includes(FloorLevel.LIVING), true);
  assert.match(ecology?.counterplay ?? '', /разгона|открытый/);
  assert.equal(opaque > 450, true, 'sprite should be readable as a full sprinting body');
  assert.equal(translucent > 3, true, 'sprite should include leg motion blur');
  assert.equal(brightKnuckles > 0, true, 'sprite should show pale forward knuckles');
});

test('dikiy mertvyak shoves a crowded doorway panic cluster', () => {
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const player = makeTestPlayer({ id: 1, x: 10.45, y: 10, hp: 100, maxHp: 100 });
  const threat = dikiy();
  const crowd = [
    crowdNpc(3, 10.8, 10.45),
    crowdNpc(4, 10.6, 9.45),
    crowdNpc(5, 10.95, 9.9),
    crowdNpc(6, 10.9, 10.25),
  ];
  const entities = [player, threat, ...crowd];
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
  updateMonster(world, entities, threat, 0.9, 1, msgs, player.id, { v: 10 }, state);

  const shoved = crowd.filter(e => e.ai?.goal === AIGoal.FLEE && (e.ai?.staggerTimer ?? 0) > 0);
  assert.equal(shoved.length >= 2, true, 'crowd shove should stagger multiple nearby bodies');
  assert.equal(msgs.some(m => m.text.includes('Открытый пол')), true);
  const shoveEvent = getRecentEvents(state, { type: 'monster_sighted', tags: ['dikiy_mertvyak', 'crowd_shove'], limit: 1 })[0];
  assert.ok(shoveEvent);
  assert.equal(shoveEvent.monsterKind, MonsterKind.DIKIY_MERTVYAK);
  assert.equal(shoveEvent.data?.counterplay, 'open_floor_or_early_damage_before_crowd_contact');
});

test('dikiy mertvyak crowd shove can target NPCs and remains locally capped', () => {
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const player = makeTestPlayer({ id: 1, x: 80, y: 80, hp: 100, maxHp: 100 });
  const target = crowdNpc(3, 10.65, 10);
  const threat = dikiy();
  const entities = [player, target, threat];
  for (let i = 0; i < 24; i++) {
    const body = crowdNpc(10 + i, 11.05 + (i % 6) * 0.18, 9.55 + ((i / 6) | 0) * 0.22);
    body.faction = Faction.CULTIST;
    entities.push(body);
  }
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
  updateMonster(world, entities, threat, 0.9, 1, msgs, player.id, { v: 10 }, state);

  assert.equal(threat.ai?.combatTargetId, target.id);
  assert.equal(target.ai?.goal, AIGoal.FLEE);
  const shoveEvent = getRecentEvents(state, { type: 'monster_sighted', tags: ['dikiy_mertvyak', 'crowd_shove'], limit: 1 })[0];
  assert.ok(shoveEvent);
  assert.equal(shoveEvent.targetId, target.id);
  assert.equal(Number(shoveEvent.data?.crowd) <= 12, true, 'shove event crowd should reflect the capped local query');
});

test('early damage cancels dikiy mertvyak shove momentum', () => {
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const player = makeTestPlayer({ id: 1, x: 11.5, y: 10, hp: 100, maxHp: 100 });
  const threat = dikiy({ hp: DEF.hp - 3 });
  const npcA = crowdNpc(3, 10.8, 10.45);
  const npcB = crowdNpc(4, 10.6, 9.45);
  const entities = [player, threat, npcA, npcB];
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
  updateMonster(world, entities, threat, 0.9, 1, msgs, player.id, { v: 10 }, state);

  assert.notEqual(npcA.ai?.goal, AIGoal.FLEE);
  assert.notEqual(npcB.ai?.goal, AIGoal.FLEE);
  assert.equal(npcA.ai?.staggerTimer, undefined);
  assert.equal(npcB.ai?.staggerTimer, undefined);
  assert.equal(threat.ai?.shoveCharge, 0);
  assert.equal(msgs.some(m => m.text.includes('продавил толпу')), false);
  assert.equal(getRecentEvents(state, { type: 'monster_sighted', tags: ['dikiy_mertvyak', 'crowd_shove'], limit: 1 }).length, 0);
});
