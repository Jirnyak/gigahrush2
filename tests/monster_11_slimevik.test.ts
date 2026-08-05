import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, FloorLevel, MonsterKind, RoomType, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { CONTRACTS } from '../src/data/contracts';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { RUMORS } from '../src/data/rumors';
import { DEF, generateSprite } from '../src/entities/slimevik';
import { MONSTERS, NEW_MONSTERS_BY_FLOOR } from '../src/entities/monster';
import { S } from '../src/render/pixutil';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { getRecentEvents, publishEvent } from '../src/systems/events';
import { tryUseSlimevikInteraction, updateSlimevikMonster } from '../src/systems/slimevik';
import { addTestRoom, makeGameState, makeTestNpc, makeTestPlayer } from './helpers';

function openSlimeRoom(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  addTestRoom(world, {
    id: 0,
    x: 8,
    y: 8,
    w: 8,
    h: 8,
    type: RoomType.PRODUCTION,
    name: 'Кормовая ванна слизневика',
    zoneLevel: 2,
  });
  return world;
}

function slimevik(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 2,
    type: EntityType.MONSTER,
    x: 11.5,
    y: 10.5,
    angle: Math.PI,
    pitch: 0,
    alive: true,
    speed: DEF.speed,
    sprite: DEF.sprite,
    hp: DEF.hp,
    maxHp: DEF.hp,
    monsterKind: MonsterKind.SLIMEVIK,
    attackCd: DEF.attackRate,
    ai: { goal: AIGoal.WANDER, tx: 11, ty: 10, path: [], pi: 0, stuck: 0, timer: 0 },
    ...overrides,
  };
}

test('Slimevik is standalone neutral scavenger content with route leads', () => {
  const ecology = getMonsterEcology(MonsterKind.SLIMEVIK);
  const sprite = generateSprite();
  let opaque = 0;
  for (const px of sprite) if ((px >>> 24) !== 0) opaque++;

  assert.equal(DEF.kind, MonsterKind.SLIMEVIK);
  assert.equal(MONSTERS[MonsterKind.SLIMEVIK], DEF);
  assert.deepEqual(DEF.aiFlags, ['slimeScavenger']);
  assert.deepEqual(DEF.floors, [FloorLevel.LIVING, FloorLevel.MAINTENANCE]);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.MAINTENANCE]?.includes(MonsterKind.SLIMEVIK), true);
  assert.deepEqual(ecology?.rumorIds, ['monster_slimevik_bargain', 'lead_maintenance_safe_slimevik']);
  assert.equal(RUMORS.some(r => r.id === 'lead_maintenance_safe_slimevik'), true);
  assert.equal(CONTRACTS.some(c => c.id === 'exp_maint_safe_slimevik_bargain'), true);
  assert.equal(sprite.length, S * S);
  assert.equal(opaque > 700, true, 'Slimevik sprite should read as a full symbiote scavenger');
});

test('Slimevik stays neutral but close contact drains bounded water and PSI', () => {
  const world = openSlimeRoom();
  const state = makeGameState({ time: 12, currentFloor: FloorLevel.MAINTENANCE });
  const player = makeTestPlayer({
    id: 1,
    x: 10.8,
    y: 10.5,
    angle: 0,
    hp: 100,
    maxHp: 100,
    needs: { food: 80, water: 50, sleep: 80, pee: 0, poo: 0 },
    rpg: { level: 1, xp: 0, attrPoints: 0, str: 1, agi: 1, int: 1, psi: 4, maxPsi: 4 },
  });
  const threat = slimevik();
  const msgs: Msg[] = [];

  updateSlimevikMonster(world, [player, threat], threat, 2.3, state.time, msgs, player, state);

  assert.equal(player.hp, 100, 'neutral contact should not be a normal melee attack');
  assert.equal(player.needs?.water, 48);
  assert.equal(player.rpg?.psi, 3);
  assert.equal(threat.ai?.goal, AIGoal.WANDER);
  assert.equal(msgs.some(m => m.text.includes('Держи дистанцию или фильтр')), true);
  assert.equal(getRecentEvents(state, { type: 'player_status_bad_reaction', limit: 1 })[0]?.monsterKind, MonsterKind.SLIMEVIK);
});

test('Slimevik barter consumes food or medicine and marks a sample', () => {
  const world = openSlimeRoom();
  const state = makeGameState({ time: 18, currentFloor: FloorLevel.MAINTENANCE });
  const player = makeTestPlayer({
    id: 1,
    x: 10.5,
    y: 10.5,
    angle: 0,
    inventory: [{ defId: 'bread', count: 1 }, { defId: 'pills', count: 1 }],
  });
  const target = slimevik();
  const entities = [player, target];
  const nextId = { v: 3 };

  rebuildEntityIndex(entities);
  assert.equal(tryUseSlimevikInteraction(world, player, state, entities, nextId), true);

  assert.equal(player.inventory?.some(item => item.defId === 'pills'), false);
  assert.equal(player.inventory?.some(item => item.defId === 'bread'), true);
  assert.equal(entities.some(e => e.type === EntityType.ITEM_DROP && e.inventory?.[0]?.defId === 'slime_sample_brown'), true);
  assert.equal(getRecentEvents(state, { type: 'slimevik_bargain', limit: 1 })[0]?.itemId, 'pills');
  assert.equal(getRecentEvents(state, { type: 'slimevik_harvested', limit: 1 })[0]?.itemId, 'slime_sample_brown');
});

test('Hurt Slimevik flees from nearby actors through bounded broadphase', () => {
  const world = openSlimeRoom();
  const state = makeGameState({ time: 21, currentFloor: FloorLevel.MAINTENANCE });
  const player = makeTestPlayer({ id: 1, x: 80, y: 80 });
  const neighbor = makeTestNpc({ id: 3, x: 12.8, y: 10.5, faction: Faction.CITIZEN });
  const threat = slimevik({ id: 2, hp: DEF.hp - 4 });
  const entities = [player, neighbor, threat];
  const msgs: Msg[] = [];

  rebuildEntityIndex(entities);
  assert.equal(updateSlimevikMonster(world, entities, threat, 0.2, state.time, msgs, player, state), true);

  assert.equal(threat.ai?.goal, AIGoal.FLEE);
  assert.equal(threat.ai?.combatTargetId, neighbor.id);
  assert.equal(neighbor.hp, undefined, 'hurt slimevik should flee before attacking in open floor');
});

test('Slimevik kill events publish the standalone slimevik_killed fact', () => {
  const state = makeGameState({ time: 24, currentFloor: FloorLevel.MAINTENANCE });

  publishEvent(state, {
    type: 'player_kill_monster',
    x: 12,
    y: 10,
    actorId: 1,
    actorName: 'Вы',
    actorFaction: Faction.PLAYER,
    targetId: 2,
    targetName: 'Слизневик',
    monsterKind: MonsterKind.SLIMEVIK,
    severity: 3,
    privacy: 'local',
    tags: ['combat', 'kill', 'monster'],
  });

  const killed = getRecentEvents(state, { type: 'slimevik_killed', limit: 1 })[0];
  assert.equal(killed?.monsterKind, MonsterKind.SLIMEVIK);
  assert.equal(killed?.targetId, 2);
  assert.ok(killed?.tags.includes('slimevik'));
});
