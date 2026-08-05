import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, FloorLevel, MonsterKind, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { MONSTERS } from '../src/entities/monster';
import { DEF as KHOROVAYA_MATKA_DEF } from '../src/entities/khorovaya_matka';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import {
  KHOROVAYA_MATKA_CHILD_CAP,
  KHOROVAYA_MATKA_COUNTDOWN_SEC,
  KHOROVAYA_MATKA_VULNERABLE_SEC,
} from '../src/systems/ai/khorovaya_matka';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { setListenerPos } from '../src/systems/audio';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  return world;
}

function player(): Entity {
  return {
    id: 1,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: 20,
    y: 18,
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

function khorovayaMatka(): Entity {
  const def = MONSTERS[MonsterKind.KHOROVAYA_MATKA];
  return {
    id: 2,
    type: EntityType.MONSTER,
    x: 18,
    y: 18,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: def.speed,
    sprite: def.sprite,
    hp: def.hp,
    maxHp: def.hp,
    monsterKind: MonsterKind.KHOROVAYA_MATKA,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.WANDER, tx: 18, ty: 18, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function prepare(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

function liveChildren(entities: readonly Entity[]): Entity[] {
  return entities.filter(e => e.alive && e.type === EntityType.MONSTER && e.name === 'Приплод Хоровой Матки');
}

test('Khorovaya Matka is a standalone monster, not the old choir variant', () => {
  assert.equal(KHOROVAYA_MATKA_DEF.kind, MonsterKind.KHOROVAYA_MATKA);
  assert.equal(MONSTERS[MonsterKind.KHOROVAYA_MATKA].name, 'Хоровая Матка');

  const ecology = getMonsterEcology(MonsterKind.KHOROVAYA_MATKA);
  assert.ok(ecology);
  assert.deepEqual(ecology.floors, [FloorLevel.HELL]);
  assert.match(ecology.counterplay, /припев|детей|окна/);
});

test('Khorovaya Matka choir countdown spawns capped children', () => {
  const world = openWorld();
  setListenerPos(20, 18, world.dist2.bind(world));
  const source = khorovayaMatka();
  const entities = [player(), source];
  const msgs: Msg[] = [];
  const nextId = { v: 10 };

  for (let i = 0; i < 5; i++) {
    source.ai!.choirCountdown = 0.01;
    prepare(entities);
    updateMonster(world, entities, source, 0.02, 10 + i, msgs, 1, nextId);
  }

  assert.equal(liveChildren(entities).length, KHOROVAYA_MATKA_CHILD_CAP);
  assert.equal(source.ai?.choirChildIds?.length, KHOROVAYA_MATKA_CHILD_CAP);
  assert.ok(msgs.some(line => line.text.includes('Хоровая Матка вывела приплод')));
});

test('clearing Khorovaya Matka children opens a vulnerability window and changes damage gating', () => {
  const world = openWorld();
  setListenerPos(20, 18, world.dist2.bind(world));
  const source = khorovayaMatka();
  const entities = [player(), source];
  const nextId = { v: 10 };

  source.ai!.choirCountdown = 0.01;
  prepare(entities);
  updateMonster(world, entities, source, 0.02, 20, [], 1, nextId);
  for (const child of liveChildren(entities)) child.alive = false;

  const msgs: Msg[] = [];
  source.ai!.choirCountdown = KHOROVAYA_MATKA_COUNTDOWN_SEC;
  prepare(entities);
  updateMonster(world, entities, source, 0.1, 21, msgs, 1, nextId);

  assert.equal(source.ai!.choirVulnerableTimer! > KHOROVAYA_MATKA_VULNERABLE_SEC - 0.2, true);
  assert.ok(msgs.some(line => line.text.includes('Хор сорван')));

  source.ai!.choirVulnerableTimer = 0;
  source.ai!.choirLastHp = source.hp;
  source.hp = (source.hp ?? 0) - 60;
  const armoredHp = source.hp;
  source.ai!.choirCountdown = KHOROVAYA_MATKA_COUNTDOWN_SEC;
  prepare(entities);
  updateMonster(world, entities, source, 0.1, 22, [], 1, nextId);
  assert.equal((source.hp ?? 0) > armoredHp, true, 'closed membrane should repair most non-window damage');

  source.ai!.choirVulnerableTimer = 3;
  source.ai!.choirLastHp = source.hp;
  source.hp = (source.hp ?? 0) - 40;
  const vulnerableHp = source.hp;
  source.ai!.choirCountdown = KHOROVAYA_MATKA_COUNTDOWN_SEC;
  prepare(entities);
  updateMonster(world, entities, source, 0.1, 23, [], 1, nextId);
  assert.equal(source.hp, vulnerableHp, 'vulnerability window should not repair incoming damage');
});
