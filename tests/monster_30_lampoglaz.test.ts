import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AIGoal, Cell, EntityType, Feature, FloorLevel, MonsterKind, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { RUMORS } from '../src/data/rumors';
import { DEF, generateSprite } from '../src/entities/lampoglaz';
import { MONSTERS, NEW_MONSTERS_BY_FLOOR } from '../src/entities/monster';
import { S } from '../src/render/pixutil';
import { setListenerPos } from '../src/systems/audio';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.features.fill(Feature.NONE);
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

function lampoglaz(x: number, y: number): Entity {
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
    monsterKind: MonsterKind.LAMPOGLAZ,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function prepare(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

function srcFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...srcFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

function srcContains(needle: string): boolean {
  return srcFiles(join(process.cwd(), 'src')).some(path => readFileSync(path, 'utf8').includes(needle));
}

test('Lampoglaz is standalone light-lock monster content', () => {
  const ecology = getMonsterEcology(MonsterKind.LAMPOGLAZ);
  const sprite = generateSprite();
  let opaque = 0;
  for (const px of sprite) if ((px >>> 24) !== 0) opaque++;

  assert.equal(DEF.kind, MonsterKind.LAMPOGLAZ);
  assert.equal(MONSTERS[MonsterKind.LAMPOGLAZ], DEF);
  assert.deepEqual(DEF.aiFlags, ['lightLock']);
  assert.deepEqual(DEF.floors, [FloorLevel.LIVING, FloorLevel.MINISTRY]);
  assert.equal(DEF.isRanged, true);
  assert.equal((DEF.projSpeed ?? 0) > 10, true, 'Lampoglaz shot should be fast enough to punish lit lanes');
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.LIVING]?.includes(MonsterKind.LAMPOGLAZ), true);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.MINISTRY]?.includes(MonsterKind.LAMPOGLAZ), true);
  assert.deepEqual(ecology?.rumorIds, ['monster_lampoglaz_hum', 'ecology_lampoglaz_light_lock']);
  assert.equal(sprite.length, S * S);
  assert.equal(opaque > 900, true, 'Lampoglaz sprite should read as a halo eye fixture');
});

test('Lampoglaz replaces the old lamp variant ids with rumors', () => {
  const oldVariantId = ['lamp', 'eye'].join('_');
  const oldRumorId = ['variant', 'lamp', 'eye'].join('_');
  assert.equal(srcContains(oldVariantId), false);
  assert.equal(RUMORS.some(r => r.id === oldRumorId), false);
  assert.equal(RUMORS.some(r => r.id === 'monster_lampoglaz_hum'), true);
  assert.equal(RUMORS.some(r => r.id === 'ecology_lampoglaz_light_lock'), true);
});

test('Lampoglaz winds up on lit targets and drops lock in darkness', () => {
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(14.5, 10.5);
  const threat = lampoglaz(6.5, 10.5);
  const entities = [target, threat];
  const msgs: Msg[] = [];
  const nextId = { v: 3 };

  world.features[world.idx(14, 10)] = Feature.LAMP;
  prepare(entities);
  updateMonster(world, entities, threat, 0.1, 1, msgs, target.id, nextId);

  assert.equal((threat.ai?.windupTimer ?? 0) > 0, true, 'lit target should trigger a light-lock windup');
  assert.equal(threat.ai?.windupTargetId, target.id);

  world.features[world.idx(14, 10)] = Feature.NONE;
  updateMonster(world, entities, threat, 0.1, 1.1, msgs, target.id, nextId);

  assert.equal(threat.ai?.windupTimer, undefined);
  assert.equal(threat.ai?.windupTargetId, undefined);
  assert.equal(msgs.some(m => m.text.includes('потерял световой захват')), true);
});
