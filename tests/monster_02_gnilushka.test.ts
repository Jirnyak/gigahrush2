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
import { getMonsterEcology } from '../src/data/monster_ecology';
import { DEF, generateSprite } from '../src/entities/gnilushka';
import { generateGnilushkaLostCell } from '../src/gen/living/gnilushka_lost_cell';
import { monsterSpr } from '../src/render/sprite_index';
import { S } from '../src/render/pixutil';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { isHostile } from '../src/systems/factions';
import { activateInteraction, findInteractionTarget } from '../src/systems/interactions';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import { makeGameState, makeTestPlayer } from './helpers';

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

function gnilushka(id: number, x: number, y: number): Entity {
  return {
    id,
    type: EntityType.MONSTER,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: DEF.speed,
    sprite: monsterSpr(MonsterKind.GNILUSHKA),
    hp: DEF.hp,
    maxHp: DEF.hp,
    monsterKind: MonsterKind.GNILUSHKA,
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

test('gnilushka definition, ecology, rumors, and sprite read as a rare defensive neutral', () => {
  const ecology = getMonsterEcology(MonsterKind.GNILUSHKA);
  const rumorIds = new Set(RUMORS.map(rumor => rumor.id));
  const sprite = generateSprite();
  let opaque = 0;
  let pale = 0;
  for (const px of sprite) {
    if ((px >>> 24) === 0) continue;
    opaque++;
    const r = px & 0xff;
    const g = (px >>> 8) & 0xff;
    const b = (px >>> 16) & 0xff;
    if (r > 145 && g > 145 && b > 120) pale++;
  }

  assert.equal(DEF.kind, MonsterKind.GNILUSHKA);
  assert.deepEqual(DEF.aiFlags, ['defensiveNeutral']);
  assert.deepEqual(DEF.floors, [FloorLevel.LIVING, FloorLevel.KVARTIRY]);
  assert.equal(ecology?.rare, true);
  assert.equal((ecology?.spawnWeight ?? 1) < 0.25, true);
  assert.match(DEF.counterplay ?? '', /Не загоняйте|тара НИИ|рани/);
  assert.match(ecology?.counterplay ?? '', /воду|лекарство|углу/);
  assert.equal(rumorIds.has('ecology_gnilushka_restraint'), true);
  assert.equal(rumorIds.has('lead_living_lost_gnilushka_cell'), true);
  assert.equal(sprite.length, S * S);
  assert.equal(opaque > 450, true, 'sprite should have a readable humanoid body');
  assert.equal(pale > 12, true, 'gray hair and antler highlights should be visible');
});

test('gnilushka interaction supports help and noncombat NII handoff', () => {
  const world = openWorld();
  const player = makeTestPlayer({
    id: 1,
    x: 10.5,
    y: 10.5,
    angle: 0,
    inventory: [{ defId: 'filtered_water', count: 1 }],
  });
  const target = gnilushka(2, 12.0, 10.5);
  const entities = [player, target];
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });
  const nextEntityId = { v: 3 };

  prime(entities);
  const prompt = findInteractionTarget({ world, state, player, entities, nextEntityId, lookX: 12, lookY: 10 });
  assert.equal(prompt?.defId, 'gnilushka');
  assert.equal(activateInteraction({ world, state, player, entities, nextEntityId, lookX: 12, lookY: 10 }).handled, true);

  const spared = getRecentEvents(state, { type: 'gnilushka_spared', tags: ['helped'], limit: 1 })[0];
  assert.ok(spared);
  assert.equal(spared.monsterKind, MonsterKind.GNILUSHKA);
  assert.equal(player.inventory?.some(item => item.defId === 'filtered_water'), false);
  assert.ok(entities.some(entity => entity.type === EntityType.ITEM_DROP && entity.inventory?.[0]?.defId === 'note'));

  player.inventory = [{ defId: 'nii_sample_container', count: 1 }];
  prime(entities);
  assert.equal(activateInteraction({ world, state, player, entities, nextEntityId, lookX: 12, lookY: 10 }).handled, true);
  assert.equal(target.alive, false);
  assert.equal(player.inventory.length, 0);
  assert.ok(entities.some(entity => entity.type === EntityType.ITEM_DROP && entity.inventory?.[0]?.defId === 'slime_sample_brown'));
  const delivered = getRecentEvents(state, { type: 'gnilushka_delivered', tags: ['delivered'], limit: 1 })[0];
  assert.ok(delivered);
});

test('gnilushka flees while calm and only turns dangerous after being hurt and cornered', () => {
  const world = openWorld();
  const player = makeTestPlayer({ id: 1, x: 10.5, y: 10.5, weapon: 'knife', hp: 80, maxHp: 80 });
  const calm = gnilushka(2, 12.2, 10.5);
  const entities = [player, calm];
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  assert.equal(isHostile(player, calm), false);
  prime(entities);
  updateMonster(world, entities, calm, 0.1, 1, msgs, player.id, { v: 3 }, state);
  assert.equal(calm.ai?.goal, AIGoal.FLEE);
  assert.equal(calm.ai?.combatTargetId, undefined);
  assert.equal(player.hp, 80);

  const cornerWorld = openWorld();
  cornerWorld.cells[cornerWorld.idx(20, 19)] = Cell.WALL;
  cornerWorld.cells[cornerWorld.idx(20, 21)] = Cell.WALL;
  const cornerPlayer = makeTestPlayer({ id: 10, x: 21.25, y: 20.5, hp: 80, maxHp: 80 });
  const hurt = gnilushka(11, 20.5, 20.5);
  hurt.hp = (hurt.maxHp ?? DEF.hp) - 5;
  const cornerEntities = [cornerPlayer, hurt];
  const cornerState = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });
  prime(cornerEntities);
  updateMonster(cornerWorld, cornerEntities, hurt, 0.2, 2, [], cornerPlayer.id, { v: 12 }, cornerState);

  assert.equal(hurt.monsterStage, 1);
  assert.equal(isHostile(cornerPlayer, hurt), true);
  assert.equal((cornerPlayer.hp ?? 0) < 80, true, 'cornered hurt gnilushka should slash defensively');
  const hurtEvent = getRecentEvents(cornerState, { type: 'gnilushka_hurt', tags: ['defensive'], limit: 1 })[0];
  assert.ok(hurtEvent);
});

test('living lost cell spawns reachable gnilushka content and handoff supplies', () => {
  const world = new World();
  world.zoneMap.fill(0);
  world.zones[0] = {
    id: 0,
    cx: 50,
    cy: 50,
    faction: 0,
    hasLift: false,
    fogged: false,
    level: 2,
    hqRoomId: -1,
  };
  world.cells[world.idx(90, 55)] = Cell.FLOOR;
  const entities: Entity[] = [];
  const nextId = { v: 1 };
  const oldRandom = Math.random;
  Math.random = () => 0;
  try {
    const result = generateGnilushkaLostCell(world, 0, entities, nextId, 50, 50);
    assert.equal(result.nextRoomId > 0, true);
  } finally {
    Math.random = oldRandom;
  }

  const room = world.rooms.find(candidate => candidate?.name === 'Потерянная ячейка Гнилушки');
  assert.ok(room);
  assert.ok(entities.some(entity => entity.type === EntityType.MONSTER && entity.monsterKind === MonsterKind.GNILUSHKA));
  assert.ok(world.containers.some(container => container.roomId === room.id && container.inventory.some(item => item.defId === 'nii_sample_container')));
  assert.ok(world.containers.some(container => container.roomId === room.id && container.inventory.some(item => item.defId === 'water')));

  let connected = false;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.cells[idx] === Cell.FLOOR || world.cells[idx] === Cell.DOOR) connected = true;
    }
  }
  assert.equal(connected, true, 'lost cell should connect back to the maze');
});
