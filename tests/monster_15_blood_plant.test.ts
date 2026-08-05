import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, ContainerKind, DoorState, EntityType, FloorLevel, MonsterKind, ProjType, RoomType, Tex, ZoneFaction, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { DEF, generateSprite } from '../src/entities/blood_plant';
import { generateBloodPlantDen } from '../src/gen/living/blood_plant_den';
import { S } from '../src/render/pixutil';
import { Spr } from '../src/render/sprite_index';
import { MONSTER_SPRITES } from '../src/entities/monster';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import {
  BLOOD_PLANT_HEAL_PER_SOURCE,
  BLOOD_PLANT_TENDRIL_MAX_CELLS,
  healBloodPlantFromRedMold,
  neutralizeRedMoldSourceNear,
  registerBloodPlantRootSite,
  traceBloodPlantTendrilCells,
} from '../src/systems/blood_plant';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import {
  adjustMonsterProjectileDamage,
  recordMonsterMeleeDeath,
  recordMonsterProjectileDeath,
} from '../src/systems/monster_counterplay';
import { makeGameState, makeTestContainer, makeTestPlayer } from './helpers';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.roomMap.fill(0);
  world.zoneMap.fill(0);
  world.rooms[0] = {
    id: 0,
    type: RoomType.COMMON,
    x: 0,
    y: 0,
    w: 32,
    h: 32,
    doors: [],
    sealed: false,
    name: 'Тестовая зона',
    apartmentId: -1,
    wallTex: Tex.CONCRETE,
    floorTex: Tex.F_CONCRETE,
  };
  world.zones[0] = {
    id: 0,
    cx: 10,
    cy: 10,
    faction: ZoneFaction.CITIZEN,
    hasLift: false,
    fogged: false,
    level: 3,
    hqRoomId: -1,
  };
  return world;
}

function bloodPlant(id: number, x: number, y: number, hp = DEF.hp): Entity {
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
    hp,
    maxHp: DEF.hp,
    monsterKind: MonsterKind.BLOOD_PLANT,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

test('blood plant definition, ecology, and sprite describe a rooted red-mold hive', () => {
  const ecology = getMonsterEcology(MonsterKind.BLOOD_PLANT);
  const sprite = generateSprite();
  let opaque = 0;
  for (const px of sprite) if ((px >>> 24) !== 0) opaque++;

  assert.equal(DEF.kind, MonsterKind.BLOOD_PLANT);
  assert.deepEqual(DEF.aiFlags, ['rootHive']);
  assert.deepEqual(DEF.floors, [FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL]);
  assert.match(DEF.counterplay ?? '', /соли|огня|режущего/);
  assert.equal(ecology?.rare, true);
  assert.match(ecology?.counterplay ?? '', /плес|огн|соль|реж/);
  assert.equal(sprite.length, S * S);
  assert.ok(opaque > 450, 'sprite should contain a readable root-column silhouette');
});

test('rootHive stays rooted and tendril strikes through a capped short floor line', () => {
  const world = openWorld();
  const player = makeTestPlayer({ id: 1, x: 18.5, y: 10.5, hp: 100, maxHp: 100 });
  const plant = bloodPlant(2, 10.5, 10.5);
  const entities = [player, plant];
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });

  const cells = traceBloodPlantTendrilCells(world, plant.x, plant.y, player.x, player.y);
  assert.ok(cells.length <= BLOOD_PLANT_TENDRIL_MAX_CELLS);
  assert.ok(cells.includes(world.idx(Math.floor(player.x), Math.floor(player.y))));

  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
  updateMonster(world, entities, plant, 1.2, 1.2, state.msgs, player.id, { v: 10 }, state);

  assert.equal(plant.x, 10.5);
  assert.equal(plant.y, 10.5);
  assert.equal(plant.ai?.path.length, 0);
  assert.ok((player.hp ?? 100) < 100, 'tendril should hit a target inside the traced floor line');
});

test('red mold containers heal the source until salt removes the nearby source', () => {
  const world = openWorld();
  const plant = bloodPlant(2, 10.5, 10.5, 40);
  const actor = makeTestPlayer({ id: 1, x: 12.5, y: 10.5, inventory: [{ defId: 'rock_salt', count: 1 }] });
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });
  world.addContainer(makeTestContainer({
    id: 77,
    x: 12,
    y: 10,
    floor: FloorLevel.LIVING,
    roomId: 0,
    zoneId: 0,
    kind: ContainerKind.SECRET_STASH,
    name: 'Тестовая красная плесень',
    inventory: [{ defId: 'red_mold_sample', count: 1 }],
    capacitySlots: 3,
    tags: ['blood_plant', 'red_mold'],
  }));

  const healed = healBloodPlantFromRedMold(world, plant);
  assert.equal(healed.healed, BLOOD_PLANT_HEAL_PER_SOURCE);
  assert.equal(plant.hp, 40 + BLOOD_PLANT_HEAL_PER_SOURCE);

  assert.equal(neutralizeRedMoldSourceNear(world, state, actor), true);
  plant.hp = 40;
  const afterSalt = healBloodPlantFromRedMold(world, plant);
  assert.equal(afterSalt.healed, 0);
  assert.equal(plant.hp, 40);
  const event = getRecentEvents(state, { type: 'red_mold_exposed', tags: ['salt', 'neutralized'], limit: 1 })[0];
  assert.ok(event);
});

test('fire and cutting counterplay publish blood plant route events and open root cells', () => {
  const world = openWorld();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });
  const player = makeTestPlayer({ id: 1, x: 9.5, y: 10.5, weapon: 'knife' });
  const plant = bloodPlant(2, 10.5, 10.5);
  const rootCell = world.idx(11, 10);
  world.cells[rootCell] = Cell.DOOR;
  world.wallTex[rootCell] = Tex.DOOR_WOOD;
  world.rooms[0].doors = [rootCell];
  world.doors.set(rootCell, {
    idx: rootCell,
    state: DoorState.CLOSED,
    roomA: 0,
    roomB: -1,
    keyId: '',
    timer: 0,
  });
  registerBloodPlantRootSite(world, {
    id: 'test_blood_roots_cut',
    plantIds: [plant.id],
    rootCells: [rootCell],
    roomId: 0,
    zoneId: 0,
  });

  recordMonsterMeleeDeath(world, state, plant, 'knife', player);
  assert.equal(world.cells[rootCell], Cell.FLOOR);
  assert.equal(world.doors.has(rootCell), false);
  assert.deepEqual(world.rooms[0].doors, []);
  assert.equal(world.wallTex[rootCell], Tex.CONCRETE);
  assert.ok(getRecentEvents(state, { type: 'blood_plant_root_cut', tags: ['tool'], limit: 1 })[0]);

  const fireWorld = openWorld();
  const fireState = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });
  const firePlant = bloodPlant(3, 10.5, 10.5);
  const fireRoot = fireWorld.idx(12, 10);
  fireWorld.cells[fireRoot] = Cell.WALL;
  registerBloodPlantRootSite(fireWorld, {
    id: 'test_blood_roots_fire',
    plantIds: [firePlant.id],
    rootCells: [fireRoot],
    roomId: 0,
    zoneId: 0,
  });
  const flame: Entity = {
    id: 4,
    type: EntityType.PROJECTILE,
    x: 9.5,
    y: 10.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 7,
    sprite: Spr.FLAME_BOLT,
    projType: ProjType.FLAME,
    ownerId: player.id,
  };

  assert.ok(adjustMonsterProjectileDamage(firePlant, flame, 4) >= Math.ceil(DEF.hp * 0.38));
  recordMonsterProjectileDeath(fireWorld, fireState, firePlant, flame, player);
  assert.equal(fireWorld.cells[fireRoot], Cell.FLOOR);
  assert.ok(getRecentEvents(fireState, { type: 'blood_plant_burned', tags: ['fire'], limit: 1 })[0]);
});

test('living blood plant den spawns a reachable source, red mold choice, witnesses, and root path', () => {
  const world = openWorld();
  const entities: Entity[] = [];
  const nextId = { v: 1 };

  const result = generateBloodPlantDen(world, 1, entities, nextId, 80, 80);
  const room = world.rooms.find(candidate => candidate?.name === 'Красный притон плесени');
  assert.ok(room);
  assert.equal(result.nextRoomId, (room?.id ?? 0) + 1);

  const plants = entities.filter(entity => entity.type === EntityType.MONSTER && entity.monsterKind === MonsterKind.BLOOD_PLANT);
  assert.equal(plants.length, 1);
  assert.ok(entities.some(entity => entity.type === EntityType.NPC && entity.faction !== undefined), 'den should include bounded infected distributors/witnesses');
  assert.ok(world.containers.some(container => container.tags.includes('heal_source') && container.inventory.some(item => item.defId === 'red_mold_sample')));
  assert.ok(world.containers.some(container => container.tags.includes('counterplay') && container.inventory.some(item => item.defId === 'rock_salt')));

  const rootCell = world.idx(room!.x + 12, room!.y + 6);
  assert.equal(world.cells[rootCell], Cell.WALL);
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });
  const player = makeTestPlayer({ id: 99, x: plants[0].x - 1, y: plants[0].y, weapon: 'axe' });
  recordMonsterMeleeDeath(world, state, plants[0], 'axe', player);
  assert.equal(world.cells[rootCell], Cell.FLOOR);
});

test('blood plant sprite generation is registered in MONSTER_SPRITES', () => {
  assert.equal(MONSTER_SPRITES[MonsterKind.BLOOD_PLANT], generateSprite);
});

test('blood plant sprite visual characteristics describe a rooted mass with red tendrils', () => {
  const sprite = generateSprite();
  let rootPillars = 0;
  let redTendrils = 0;
  let brightDots = 0;

  for (const px of sprite) {
    if ((px >>> 24) === 0) continue;
    const r = px & 0xff;
    const g = (px >>> 8) & 0xff;
    const b = (px >>> 16) & 0xff;

    // Grey/dark low root lines
    if (r < 120 && g < 120 && b < 120) rootPillars++;
    // Red veins
    if (r > 100 && g < 30 && b < 40) redTendrils++;
    // Bright seed dots (high R and somewhat high G/B like 226,190,168 or 255,116,124)
    if (r > 200 && g > 100 && b > 100) brightDots++;
    if (r === 255 && g === 116 && b === 124) brightDots++;
    if (r === 226 && g === 190 && b === 168) brightDots++;
  }

  assert.equal(sprite.length, S * S);
  assert.ok(rootPillars > 100, 'sprite should have dark root foundation pixels');
  assert.ok(redTendrils > 30, 'sprite should have vivid red walks');
  assert.ok(brightDots > 5, 'sprite should contain bright flower/seed dots near the crown');
});
