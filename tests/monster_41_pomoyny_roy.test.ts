import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, FloorLevel, MonsterKind, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { DEF, generateSprite } from '../src/entities/pomoynyy_roy';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { updateMonster, setEntityMap } from '../src/systems/ai/monster';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { placeMonsterBait, resetMonsterBaits } from '../src/systems/monster_bait';
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
    cx: 16,
    cy: 16,
    faction: 0,
    hasLift: false,
    fogged: false,
    level: 1,
    hqRoomId: -1,
  };
  return world;
}

function player(x: number, y: number, inventory: Entity['inventory'] = []): Entity {
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
    inventory,
  };
}

function swarm(id: number, x: number, y: number): Entity {
  return {
    id,
    type: EntityType.MONSTER,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: DEF.speed,
    sprite: monsterSpr(MonsterKind.POMOYNY_ROY),
    hp: DEF.hp,
    maxHp: DEF.hp,
    monsterKind: MonsterKind.POMOYNY_ROY,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function prime(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

test('pomoyny roy is standalone food-swarm data with a readable trash sprite', () => {
  const ecology = getMonsterEcology(MonsterKind.POMOYNY_ROY);
  const sprite = generateSprite();
  let opaque = 0;
  let yellow = 0;
  let black = 0;
  for (const px of sprite) {
    if ((px >>> 24) === 0) continue;
    opaque++;
    const r = px & 0xff;
    const g = (px >>> 8) & 0xff;
    const b = (px >>> 16) & 0xff;
    if (r > 170 && g > 120 && b < 90) yellow++;
    if (r < 35 && g < 35 && b < 35) black++;
  }

  assert.equal(DEF.kind, MonsterKind.POMOYNY_ROY);
  assert.equal(DEF.name, 'Помойный Рой');
  assert.deepEqual(DEF.aiFlags, ['foodBait', 'garbageSurround']);
  assert.deepEqual(DEF.floors, [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE]);
  assert.equal('variants' in (ecology ?? {}), false);
  assert.match(ecology?.rule ?? '', /фланг|приман|ед/);
  assert.equal(sprite.length, S * S);
  assert.equal(opaque > 360, true, 'swarm sprite should have a readable aggregate body');
  assert.equal(yellow >= 8, true, 'food-yellow pixels should mark the leading edge');
  assert.equal(black >= 24, true, 'thin black legs should distinguish it from slime');
});

test('pomoyny roy detects exposed food farther away and chooses a flank slot', () => {
  resetMonsterBaits();
  const world = openWorld();
  const target = player(10, 10, [{ defId: 'rawmeat', count: 1 }]);
  const threat = swarm(2, 32, 10);
  const entities = [target, threat];
  const state = makeGameState({ worldEvents: createWorldEventState(), currentFloor: FloorLevel.LIVING });
  const msgs: Msg[] = [];

  prime(entities);
  updateMonster(world, entities, threat, 0.1, 1, msgs, target.id, { v: 10 }, state);

  assert.equal(threat.ai?.combatTargetId, target.id);
  assert.notDeepEqual([threat.ai?.tx, threat.ai?.ty], [Math.floor(target.x), Math.floor(target.y)], 'swarm should path to a flank slot instead of stacking forward');
  assert.ok(msgs.some(line => /Помойный рой/.test(line.text)));
  const sighted = getRecentEvents(state, { type: 'monster_sighted', tags: ['pomoyny_roy', 'food_scent'], limit: 1 })[0];
  assert.ok(sighted);
  assert.equal(sighted.monsterKind, MonsterKind.POMOYNY_ROY);
});

test('pomoyny roy follows dropped bait even while close to the player', () => {
  resetMonsterBaits();
  const world = openWorld();
  const target = player(10, 10);
  const threat = swarm(2, 12, 10);
  const entities = [target, threat];
  const state = makeGameState({ worldEvents: createWorldEventState(), currentFloor: FloorLevel.LIVING, time: 1 });
  const msgs: Msg[] = [];

  assert.equal(placeMonsterBait(state, world, target, 20, 15, 'rawmeat', 1, 'drop'), true);
  prime(entities);
  updateMonster(world, entities, threat, 0.1, 1.1, msgs, target.id, { v: 10 }, state);

  assert.equal(threat.ai?.combatTargetId, undefined);
  assert.deepEqual([threat.ai?.tx, threat.ai?.ty], [20.5, 15.5]);
  const baited = getRecentEvents(state, { type: 'monster_bait_attracted', limit: 1 })[0];
  assert.ok(baited);
  assert.equal(baited.monsterKind, MonsterKind.POMOYNY_ROY);
  assert.equal((baited.data?.ecologyTags as string[] | undefined)?.includes('monster_pomoyny_roy'), true);
  resetMonsterBaits();
});
