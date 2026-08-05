import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, FloorLevel, MonsterKind, W, type Entity, type WorldContainer } from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { DEF, generateSprite } from '../src/entities/slime_woman';
import { generateSlimeWomanSump } from '../src/gen/maintenance/slime_woman_sump';
import { S } from '../src/render/pixutil';
import { getCellHazardMoveMultiplier } from '../src/systems/cell_hazards';
import { takeFromContainer } from '../src/systems/containers';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { useUvSpotlight } from '../src/systems/uv_spotlight';
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
    level: 5,
    hqRoomId: -1,
  };
  return world;
}

function slimeWoman(id: number, x: number, y: number): Entity {
  return {
    id,
    type: EntityType.MONSTER,
    x,
    y,
    angle: Math.PI,
    pitch: 0,
    alive: true,
    speed: DEF.speed,
    sprite: DEF.sprite,
    hp: DEF.hp,
    maxHp: DEF.hp,
    monsterKind: MonsterKind.SLIME_WOMAN,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.HUNT, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

test('slime woman definition, ecology, and sprite read as a rare toxic humanoid', () => {
  const ecology = getMonsterEcology(MonsterKind.SLIME_WOMAN);
  const sprite = generateSprite();
  let opaque = 0;
  for (const px of sprite) if ((px >>> 24) !== 0) opaque++;

  assert.equal(DEF.kind, MonsterKind.SLIME_WOMAN);
  assert.deepEqual(DEF.aiFlags, ['slimeStrider']);
  assert.deepEqual(DEF.floors, [FloorLevel.MAINTENANCE, FloorLevel.LIVING]);
  assert.equal(ecology?.rare, true);
  assert.match(DEF.counterplay ?? '', /сух|УФ|огонь|чистящ/);
  assert.match(ecology?.counterplay ?? '', /вод|сух|УФ|тар/);
  assert.equal(sprite.length, S * S);
  assert.ok(opaque > 520, 'sprite should have a tall readable humanoid mass');
});

test('uv spotlight dries and staggers slime woman', () => {
  const world = openWorld();
  const player = makeTestPlayer({
    id: 1,
    x: 10.5,
    y: 10.5,
    angle: 0,
    tool: 'uv_spotlight',
    inventory: [{ defId: 'uv_spotlight', count: 1, data: { dur: 4 } }],
  });
  const threat = slimeWoman(2, 14.5, 10.5);
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, worldEvents: createWorldEventState() });

  const hpBefore = threat.hp ?? 0;
  const result = useUvSpotlight(world, [player, threat], player, state);

  assert.equal(result?.affected, 1);
  assert.ok((threat.hp ?? 0) < hpBefore, 'UV should create a damage window against slime woman');
  assert.ok((threat.attackCd ?? 0) >= 2, 'UV should delay the next grab');
  const dried = getRecentEvents(state, { type: 'slime_humanoid_dried', tags: ['slime_woman'], limit: 1 })[0];
  assert.ok(dried);
  assert.equal(dried.monsterKind, MonsterKind.SLIME_WOMAN);
});

test('slime woman sump is reachable content with sample and dry counterplay kit', () => {
  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 1 };

  generateSlimeWomanSump({ world, entities, nextId, spawnX: 512, spawnY: 512 });

  const threat = entities.find(entity => entity.type === EntityType.MONSTER && entity.monsterKind === MonsterKind.SLIME_WOMAN);
  assert.ok(threat, 'POI should spawn slime woman');

  const sampleContainer = world.containers.find(container => container.tags.includes('slime_woman_sample')) as WorldContainer | undefined;
  assert.ok(sampleContainer, 'POI should expose a sample container');
  assert.ok(sampleContainer.inventory.some(item => item.defId === 'slime_sample_green'));

  const kitItems = world.containers.flatMap(container => container.inventory.map(item => item.defId));
  assert.ok(kitItems.includes('uv_spotlight'));
  assert.ok(kitItems.includes('cleaning_kit'));
  assert.ok(kitItems.includes('nii_sample_container'));

  const sampleRoomId = sampleContainer.roomId;
  const wet = world.rooms[sampleRoomId]?.id;
  let hazardCell = -1;
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.WATER) continue;
    if (wet !== undefined && world.roomMap[i] !== wet) continue;
    const player = makeTestPlayer({ id: 99, x: (i % W) + 0.5, y: ((i / W) | 0) + 0.5 });
    if (getCellHazardMoveMultiplier(world, player) < 1) {
      hazardCell = i;
      break;
    }
  }
  assert.notEqual(hazardCell, -1, 'sump water should register as a local toxic route hazard');

  const player = makeTestPlayer({ id: 7, x: sampleContainer.x + 0.5, y: sampleContainer.y + 0.5 });
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, worldEvents: createWorldEventState() });
  assert.equal(takeFromContainer(sampleContainer, player, 0, 1, state), true);
  const sampled = getRecentEvents(state, { type: 'slime_humanoid_sampled', tags: ['slime_woman'], limit: 1 })[0];
  assert.ok(sampled, 'taking the sample should publish the humanoid slime sample event');
});
