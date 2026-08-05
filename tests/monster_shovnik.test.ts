import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  AIGoal,
  Cell,
  EntityType,
  Faction,
  FloorLevel,
  MonsterKind,
  type Entity,
  type Msg,
} from '../src/core/types';
import { World } from '../src/core/world';
import { RUMORS } from '../src/data/rumors';
import { getMonsterEcology, MONSTER_ECOLOGY } from '../src/data/monster_ecology';
import { DEF, generateSprite } from '../src/entities/shovnik';
import { monsterSpr } from '../src/render/sprite_index';
import { S } from '../src/render/pixutil';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import { makeGameState, makeTestPlayer } from './helpers';
import { createWorldEventState } from '../src/systems/events';

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
    level: 2,
    hqRoomId: -1,
  };
  return world;
}

function shovnik(id: number, x: number, y: number): Entity {
  return {
    id,
    type: EntityType.MONSTER,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: DEF.speed,
    sprite: monsterSpr(MonsterKind.SHOVNIK),
    hp: DEF.hp,
    maxHp: DEF.hp,
    monsterKind: MonsterKind.SHOVNIK,
    attackCd: 0,
    currentMag: 1,
    faction: Faction.WILD,
    ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function prime(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

test('shovnik definition, ecology, rumors, and sprite check out', () => {
  const ecology = getMonsterEcology(MonsterKind.SHOVNIK);
  const rumorIds = new Set(RUMORS.map(rumor => rumor.id));
  const sprite = generateSprite();
  let opaque = 0;
  for (const px of sprite) {
    if ((px >>> 24) > 0) opaque++;
  }

  assert.equal(DEF.kind, MonsterKind.SHOVNIK);
  assert.deepEqual(DEF.aiFlags, ['wallBias']);
  assert.equal(DEF.floors?.includes(FloorLevel.LIVING), true);
  assert.equal(ecology !== undefined, true, 'Shovnik ecology should be defined');
  assert.match(DEF.counterplay ?? '', /шва/);
  assert.equal(rumorIds.has('ecology_shovnik_seams'), true);
  assert.equal(sprite.length, S * S);
  assert.equal(opaque > 100, true, 'sprite should have readable pixels');
});

test('shovnik reacts to wall proximity', () => {
  const world = openWorld();
  world.cells[world.idx(10, 9)] = Cell.WALL;

  const player = makeTestPlayer({ id: 1, x: 10.5, y: 15.5, weapon: 'knife', hp: 80, maxHp: 80 });
  const s = shovnik(2, 10.5, 10.5); // near wall
  const entities = [player, s];
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });

  prime(entities);
  const msgs: Msg[] = [];
  updateMonster(world, entities, s, 0.1, 1, msgs, player.id, { v: 3 }, state);

  // Checking wallBias flag application
  assert.equal(s.ai?.wallBiasWasActive, true, 'Shovnik should activate wall bias near walls');

  // Check open space logic
  s.x = 20.5;
  s.y = 20.5; // away from walls
  prime(entities);
  updateMonster(world, entities, s, 0.1, 2, msgs, player.id, { v: 3 }, state);

  assert.equal(s.ai?.wallBiasWasActive, false, 'Shovnik should deactivate wall bias in open space');
});
