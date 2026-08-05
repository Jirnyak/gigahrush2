import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, EntityType, FloorLevel, MonsterKind, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { MONSTER_ECOLOGY } from '../src/data/monster_ecology';
import { DEF, generateSprite } from '../src/entities/zakalennaya_armatura';
import { generateProceduralMonsterSprite } from '../src/entities/procedural_visuals';
import { applyMonsterArmorHit, ZAKALENNAYA_ARMATURA_ARMOR_STACKS } from '../src/systems/monster_armor';
import { getRecentEvents } from '../src/systems/events';
import { S } from '../src/render/pixutil';
import { makeGameState } from './helpers';

function monster(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 31,
    type: EntityType.MONSTER,
    x: 20,
    y: 20,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: DEF.speed,
    sprite: DEF.sprite,
    hp: DEF.hp,
    maxHp: DEF.hp,
    monsterKind: MonsterKind.ZAKALENNAYA_ARMATURA,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.HUNT, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    ...overrides,
  };
}

function player(): Entity {
  return {
    id: 1,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: 18,
    y: 20,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    name: 'Вы',
  };
}

function spriteHash(sprite: Uint32Array): number {
  let h = 2166136261;
  for (const px of sprite) {
    h ^= px;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

test('zakalennaya armatura is standalone maintenance and hell armor content', () => {
  const ecology = MONSTER_ECOLOGY.find(def => def.kind === MonsterKind.ZAKALENNAYA_ARMATURA);

  assert.ok(ecology, 'ecology must exist');
  assert.equal(DEF.kind, MonsterKind.ZAKALENNAYA_ARMATURA);
  assert.deepEqual(DEF.floors, [FloorLevel.MAINTENANCE, FloorLevel.HELL]);
  assert.deepEqual(ecology?.floors, [FloorLevel.MAINTENANCE, FloorLevel.HELL]);
  assert.equal(ecology?.rare, true);
  assert.equal(ecology?.rooms.includes(RoomType.PRODUCTION), true);
  assert.ok(DEF.hp > 240);
  assert.ok(DEF.speed < 0.7);
  assert.ok(DEF.counterplay?.includes('дроб'));
});

test('armor state resists weak hits and strips on heavy hits', () => {
  const world = new World();
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE });
  const target = monster();
  const actor = player();

  const weak = applyMonsterArmorHit(world, state, target, {
    damage: 16,
    attacker: actor,
    weaponId: 'makarov',
  });

  assert.equal(weak.armorActive, true);
  assert.equal(weak.stripped, false);
  assert.equal(weak.armorStacks, ZAKALENNAYA_ARMATURA_ARMOR_STACKS);
  assert.ok(weak.damage < 8, 'panic pistol damage should be heavily resisted');

  state.time = 1;
  const heavy = applyMonsterArmorHit(world, state, target, {
    damage: 63,
    attacker: actor,
    weaponId: 'shotgun',
  });

  assert.equal(heavy.stripped, true);
  assert.equal(heavy.armorStacks, ZAKALENNAYA_ARMATURA_ARMOR_STACKS - 1);
  assert.ok((target.ai?.staggerTimer ?? 0) > 0.5, 'heavy strip should stagger visibly');
  assert.equal(getRecentEvents(state, { type: 'monster_armor_cut' }).some(e => e.tags.includes('armor_strip')), true);

  state.time = 2;
  applyMonsterArmorHit(world, state, target, { damage: 90, attacker: actor, weaponId: 'grenade', aoe: true });
  state.time = 3;
  const final = applyMonsterArmorHit(world, state, target, { damage: 52, attacker: actor, weaponId: 'sledgehammer' });
  assert.equal(final.armorStacks, 0);

  state.time = 4;
  const exposed = applyMonsterArmorHit(world, state, target, { damage: 16, attacker: actor, weaponId: 'makarov' });
  assert.equal(exposed.armorActive, false);
  assert.equal(exposed.damage, 16, 'stripped armor should become a normal slow target');
});

test('sprite keeps dark steel silhouette, heat cracks, and chipped armor state', () => {
  const sprite = generateSprite();
  let opaque = 0;
  let heat = 0;
  let steel = 0;

  for (const pixel of sprite) {
    if ((pixel >>> 24) === 0) continue;
    opaque++;
    const r = pixel & 0xff;
    const g = (pixel >>> 8) & 0xff;
    const b = (pixel >>> 16) & 0xff;
    if (r > 170 && g > 40 && g < 120 && b < 60) heat++;
    if (r < 95 && g < 100 && b < 110) steel++;
  }

  assert.equal(sprite.length, S * S);
  assert.ok(opaque > 650, 'armored elite should not read as a thin rod');
  assert.ok(heat > 12, 'orange heat scars should be visible only as cracks');
  assert.ok(steel > 280, 'dark tempered steel should dominate the silhouette');

  const full = generateProceduralMonsterSprite(MonsterKind.ZAKALENNAYA_ARMATURA, 31031, 0, 3);
  const chipped = generateProceduralMonsterSprite(MonsterKind.ZAKALENNAYA_ARMATURA, 31031, 0, 1);
  assert.notEqual(spriteHash(full), spriteHash(chipped), 'armor strip state should change the procedural sprite');
});
