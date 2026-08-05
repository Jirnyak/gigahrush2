import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, DoorState, EntityType, FloorLevel, MonsterKind, RoomType, Tex, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { DEF, generateSprite } from '../src/entities/borshchevik';
import { generateBorshchevikBlockade } from '../src/gen/maintenance/borshchevik_blockade';
import { S } from '../src/render/pixutil';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import {
  BORSHCHEVIK_SMOKE_BURST_CELL_CAP,
  damageBorshchevikRootSite,
  registerBorshchevikRootSite,
  releaseBorshchevikSeedPuff,
} from '../src/systems/borshchevik';
import { getCellHazardMoveMultiplier } from '../src/systems/cell_hazards';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
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
    level: 3,
    hqRoomId: -1,
  };
  return world;
}

function borshchevik(id: number, x: number, y: number): Entity {
  return {
    id,
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
    monsterKind: MonsterKind.BORSHCHEVIK,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

test('borshchevik definition, ecology, and sprite read as a tall route plant', () => {
  const ecology = getMonsterEcology(MonsterKind.BORSHCHEVIK);
  const sprite = generateSprite();
  let opaque = 0;
  for (const px of sprite) if ((px >>> 24) !== 0) opaque++;

  assert.equal(DEF.kind, MonsterKind.BORSHCHEVIK);
  assert.deepEqual(DEF.aiFlags, ['rootedPlant']);
  assert.deepEqual(DEF.floors, [FloorLevel.LIVING, FloorLevel.MAINTENANCE]);
  assert.equal(ecology?.rare, false);
  assert.match(ecology?.counterplay ?? '', /реж|огонь|обход|семен/);
  assert.equal(sprite.length, S * S);
  assert.ok(opaque > 360, 'sprite should contain a readable tall plant silhouette');
});

test('borshchevik stays rooted and uses bounded seed/root effects', () => {
  const world = openWorld();
  const player = makeTestPlayer({ id: 1, x: 13.5, y: 10.5, hp: 100, maxHp: 100 });
  const plant = borshchevik(2, 10.5, 10.5);
  const entities = [player, plant];
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, worldEvents: createWorldEventState() });

  const weakCell = world.idx(11, 11);
  world.cells[weakCell] = Cell.WALL;
  registerBorshchevikRootSite(world, {
    id: 'test_roots',
    plantIds: [plant.id],
    weakCells: [weakCell],
    centerX: 11.5,
    centerY: 11.5,
  });

  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
  updateMonster(world, entities, plant, 1.6, 1.6, state.msgs, player.id, { v: 10 }, state);

  assert.equal(plant.x, 10.5);
  assert.equal(plant.y, 10.5);
  assert.equal(plant.ai?.path.length, 0);
  assert.equal(world.cells[weakCell], Cell.FLOOR, 'authored sparse roots should damage only registered weak cells');
  assert.ok(getRecentEvents(state, { type: 'borshchevik_seed_puff', tags: ['borshchevik'], limit: 1 })[0]);
  assert.ok(getRecentEvents(state, { type: 'collateral_damage', tags: ['borshchevik'], limit: 1 })[0]);
});

test('burning borshchevik smoke burst respects the cell cap', () => {
  const world = openWorld();
  const player = makeTestPlayer({ id: 1, x: 11.5, y: 10.5, inventory: [] });
  const plant = borshchevik(2, 10.5, 10.5);
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, worldEvents: createWorldEventState() });

  const fogCells = releaseBorshchevikSeedPuff(world, state, plant, player, 'fire');

  assert.ok(fogCells <= BORSHCHEVIK_SMOKE_BURST_CELL_CAP);
  const event = getRecentEvents(state, { type: 'borshchevik_seed_puff', tags: ['smoke'], limit: 1 })[0];
  assert.ok(event);
  assert.equal(event.data?.cap, BORSHCHEVIK_SMOKE_BURST_CELL_CAP);
});

test('borshchevik root damage removes door records from opened door cells', () => {
  const world = openWorld();
  const plant = borshchevik(2, 10.5, 10.5);
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, worldEvents: createWorldEventState() });
  const doorIdx = world.idx(12, 10);

  world.cells[doorIdx] = Cell.DOOR;
  world.wallTex[doorIdx] = Tex.DOOR_WOOD;
  world.rooms[0] = {
    id: 0,
    type: RoomType.COMMON,
    x: 8,
    y: 8,
    w: 8,
    h: 8,
    doors: [doorIdx],
    sealed: false,
    name: 'root door test',
    apartmentId: -1,
    wallTex: Tex.CONCRETE,
    floorTex: Tex.F_CONCRETE,
  };
  world.doors.set(doorIdx, {
    idx: doorIdx,
    state: DoorState.CLOSED,
    roomA: 0,
    roomB: -1,
    keyId: '',
    timer: 0,
  });
  registerBorshchevikRootSite(world, {
    id: 'door_roots',
    plantIds: [plant.id],
    weakCells: [doorIdx],
  });

  assert.equal(damageBorshchevikRootSite(world, state, plant), true);
  assert.equal(world.cells[doorIdx], Cell.FLOOR);
  assert.equal(world.doors.has(doorIdx), false);
  assert.deepEqual(world.rooms[0].doors, []);
  assert.equal(world.wallTex[doorIdx], Tex.CONCRETE);
});

test('maintenance borshchevik blockade spawns plants, sap hazard, bypass tools, and root site', () => {
  const world = openWorld();
  const entities: Entity[] = [];
  const nextId = { v: 1 };

  generateBorshchevikBlockade({ world, entities, nextId, spawnX: 512, spawnY: 512 });

  const plants = entities.filter(entity => entity.type === EntityType.MONSTER && entity.monsterKind === MonsterKind.BORSHCHEVIK);
  assert.ok(plants.length >= 3, 'POI should spawn a readable plant blockade');

  const hazardCell = world.rooms
    .find(room => room?.name === 'Борщевик: сервисный коридор с зонтиками');
  assert.ok(hazardCell);
  let slowed = false;
  for (let y = hazardCell.y; y < hazardCell.y + hazardCell.h; y++) {
    for (let x = hazardCell.x; x < hazardCell.x + hazardCell.w; x++) {
      const probe = makeTestPlayer({ id: 90, x: x + 0.5, y: y + 0.5 });
      if (getCellHazardMoveMultiplier(world, probe) < 1) slowed = true;
    }
  }
  assert.equal(slowed, true, 'sap cells should register as local route hazard');

  const items = entities.flatMap(entity => entity.inventory?.map(item => item.defId) ?? []);
  assert.ok(items.includes('fire_hook'));
  assert.ok(items.includes('flamethrower'));
  assert.ok(items.includes('gasmask_filter'));

  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, worldEvents: createWorldEventState() });
  assert.equal(damageBorshchevikRootSite(world, state, plants[0]), true, 'registered root site should be reachable from the spawned plant id');
});
