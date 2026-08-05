import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, FloorLevel, MonsterKind, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { RUMORS, type RumorReveal } from '../src/data/rumors';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { DEF, generateSprite } from '../src/entities/panelnik';
import { MONSTERS } from '../src/entities/monster';
import { applyMonsterArmorHit } from '../src/systems/monster_armor';
import {
  PANELNIK_OPEN_SLOW_SEC,
  PANELNIK_WALL_BRACE_DAMAGE_MULT,
  panelnikOpenFloor,
  panelnikWallBraceActive,
} from '../src/systems/monster_traits';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import { setListenerPos } from '../src/systems/audio';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { getRecentEvents } from '../src/systems/events';
import { CLEAR, S } from '../src/render/pixutil';
import { makeGameState } from './helpers';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
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

function panelnik(x: number, y: number): Entity {
  return {
    id: 24,
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
    monsterKind: MonsterKind.PANELNIK,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.HUNT, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function prepareEntities(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

function revealList(reveals: RumorReveal | readonly RumorReveal[] | undefined): readonly RumorReveal[] {
  if (!reveals) return [];
  return Array.isArray(reveals) ? reveals : [reveals];
}

test('panelnik is standalone wall-brace monster data, not old panel variant data', () => {
  const ecology = getMonsterEcology(MonsterKind.PANELNIK);
  const oldVariantId = ['panel', 'tvar'].join('_');
  const oldRumorId = ['variant', oldVariantId].join('_');

  assert.equal(DEF.kind, MonsterKind.PANELNIK);
  assert.deepEqual(DEF.floors, [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE]);
  assert.deepEqual(DEF.aiFlags, ['wallBrace']);
  assert.equal(ecology?.rumorIds.includes('ecology_panelnik_wall'), true);
  const rumor = RUMORS.find(r => r.id === 'ecology_panelnik_wall');
  assert.equal(revealList(rumor?.reveals).some(reveal => reveal.kind === 'monster' && reveal.monsterKind === MonsterKind.PANELNIK), true);
  assert.equal(RUMORS.some(rumor => rumor.id === oldRumorId), false);
});

test('panelnik sprite reads as broad concrete slab with bright brace side', () => {
  const sprite = generateSprite();
  let opaque = 0;
  let leftDust = 0;
  let redSeam = 0;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = sprite[y * S + x];
      if (px === CLEAR || (px >>> 24) === 0) continue;
      opaque++;
      const r = px & 0xff;
      const g = (px >>> 8) & 0xff;
      const b = (px >>> 16) & 0xff;
      if (x < S / 2 && r > 170 && g > 160 && b > 125) leftDust++;
      if (r > 120 && g < 60 && b < 60) redSeam++;
    }
  }

  assert.ok(opaque > 620, 'broad slab bruiser should not read thin');
  assert.ok(leftDust > 18, 'wall-side dusty arm cue should be visible');
  assert.ok(redSeam > 6, 'raw mouth seam should stay readable');
});

test('wall brace uses toroidal wall adjacency and bounded open-floor scan', () => {
  const world = openWorld();
  const threat = panelnik(0.5, 10.5);
  world.cells[world.idx(1023, 10)] = Cell.WALL;

  assert.equal(panelnikWallBraceActive(world, threat), true, 'left edge wall should brace through toroidal wrap');
  assert.equal(panelnikOpenFloor(world, threat), false);

  world.cells[world.idx(1023, 10)] = Cell.FLOOR;
  threat.x = 20.5;
  threat.y = 20.5;
  assert.equal(panelnikWallBraceActive(world, threat), false);
  assert.equal(panelnikOpenFloor(world, threat), true, 'no wall inside the two-cell cap means open floor');
});

test('wall brace reduces incoming damage and publishes a visible cue', () => {
  const world = openWorld();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const actor = player(12.5, 10.5);
  const threat = panelnik(10.5, 10.5);
  world.cells[world.idx(9, 10)] = Cell.WALL;

  const braced = applyMonsterArmorHit(world, state, threat, {
    damage: 20,
    attacker: actor,
    weaponId: 'makarov',
  });

  assert.equal(braced.armorActive, true);
  assert.equal(braced.damage, Math.round(20 * PANELNIK_WALL_BRACE_DAMAGE_MULT));
  assert.equal(state.msgs.some(entry => /Панельник.*стену|Панельник.*броня/.test(entry.text)), true);
  assert.equal(getRecentEvents(state, { type: 'monster_sighted' }).some(event => event.tags.includes('panelnik') && event.tags.includes('wall_brace')), true);

  world.cells[world.idx(9, 10)] = Cell.FLOOR;
  threat.x = 20.5;
  threat.y = 20.5;
  const open = applyMonsterArmorHit(world, state, threat, { damage: 20, attacker: actor, weaponId: 'makarov' });
  assert.equal(open.armorActive, false);
  assert.equal(open.damage, 20);
});

test('braced panelnik reaches farther, then slows when pulled into open floor', () => {
  const world = openWorld();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(12.05, 10.5);
  const threat = panelnik(10.5, 10.5);
  const entities = [target, threat];
  world.cells[world.idx(9, 10)] = Cell.WALL;
  prepareEntities(entities);

  updateMonster(world, entities, threat, 0, 0, state.msgs, target.id, { v: 100 }, state);

  assert.ok((target.hp ?? 100) < 100, 'brace reach should punish melee trades near the wall');
  assert.equal(threat.ai?.wallBraceWasActive, true);

  target.hp = 100;
  state.time = 1;
  world.cells[world.idx(9, 10)] = Cell.FLOOR;
  threat.x = 20.5;
  threat.y = 20.5;
  target.x = 23.5;
  target.y = 20.5;
  prepareEntities(entities);

  updateMonster(world, entities, threat, 0.1, state.time, state.msgs, target.id, { v: 100 }, state);

  assert.ok((threat.ai?.wallBraceSlowTimer ?? 0) > PANELNIK_OPEN_SLOW_SEC - 0.2);
  assert.equal(getRecentEvents(state, { type: 'monster_windup_interrupted' }).some(event => event.tags.includes('panelnik') && event.tags.includes('open_floor')), true);
  assert.equal(state.msgs.some(entry => /потерял стену|броня пропала/.test(entry.text)), true);
  assert.equal((target.hp ?? 100) === 100, true, 'open-floor Panelnik should not keep wall-brace reach');
  assert.equal(MONSTERS[MonsterKind.PANELNIK].aiFlags?.includes('wallBrace'), true);
});
