import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, DoorState, EntityType, FloorLevel, MonsterKind, ZoneFaction, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { RUMORS } from '../src/data/rumors';
import { SAMOSBOR_AFTERMATH_BEATS } from '../src/data/samosbor_variants';
import { DEF, generateBlackLiquidatorSprite } from '../src/entities/black_liquidator';
import { MONSTERS, NEW_MONSTERS_BY_FLOOR } from '../src/entities/monster';
import { S } from '../src/render/pixutil';
import { setListenerPos } from '../src/systems/audio';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { makeGameState } from './helpers';

function spriteHash(sprite: Uint32Array): number {
  let h = 2166136261;
  for (const px of sprite) {
    h ^= px;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function openWorldWithDoor(): { world: World; doorIdx: number } {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.zoneMap.fill(0);
  world.zones[0] = {
    id: 0,
    cx: 12,
    cy: 10,
    faction: ZoneFaction.CITIZEN,
    hasLift: false,
    fogged: false,
    level: 1,
    hqRoomId: -1,
  };
  const doorIdx = world.idx(12, 10);
  world.cells[doorIdx] = Cell.DOOR;
  world.doors.set(doorIdx, { idx: doorIdx, state: DoorState.CLOSED, roomA: -1, roomB: -1, keyId: '', timer: 0 });
  return { world, doorIdx };
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
    inventory: [],
  };
}

function blackLiquidator(x: number, y: number): Entity {
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
    monsterKind: MonsterKind.BLACK_LIQUIDATOR,
    attackCd: DEF.attackRate,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function prime(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

test('black liquidator is standalone aftermath monster content with capped patrol beat', () => {
  const ecology = getMonsterEcology(MonsterKind.BLACK_LIQUIDATOR);
  const beat = SAMOSBOR_AFTERMATH_BEATS.find(def => def.id === 'aftermath_black_liquidator_patrol');
  const spriteA = generateBlackLiquidatorSprite(0);
  const spriteB = generateBlackLiquidatorSprite(8);
  let opaque = 0;
  let red = 0;
  let chalk = 0;
  for (const px of spriteA) {
    if ((px >>> 24) === 0) continue;
    opaque++;
    const r = px & 0xff;
    const g = (px >>> 8) & 0xff;
    const b = (px >>> 16) & 0xff;
    if (r > 110 && g < 70 && b < 70) red++;
    if (r > 185 && g > 175 && b > 150) chalk++;
  }

  assert.equal(DEF.kind, MonsterKind.BLACK_LIQUIDATOR);
  assert.equal(MONSTERS[MonsterKind.BLACK_LIQUIDATOR], DEF);
  assert.deepEqual(DEF.aiFlags, ['falsePatrol']);
  assert.deepEqual(DEF.floors, [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING]);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.LIVING].includes(MonsterKind.BLACK_LIQUIDATOR), true);
  assert.equal((ecology?.spawnWeight ?? 0) > 0 && (ecology?.spawnWeight ?? 1) < 0.2, true);
  assert.equal(ecology?.minSamosborCount, 3);
  assert.equal(ecology?.rare, true);
  assert.deepEqual(ecology?.rumorIds, ['monster_black_liquidator_wrong_count', 'ecology_black_liquidator_masks', 'samosbor_false_cleanup_patrol']);
  assert.ok(beat);
  assert.equal(beat.monsterKind, MonsterKind.BLACK_LIQUIDATOR);
  assert.equal(beat.minSamosborCount, 3);
  assert.equal(beat.monsterCount, 3);
  assert.equal((beat.monsterCount ?? 99) <= 4, true, 'black liquidator aftermath must stay a small fixed group');
  assert.equal(RUMORS.some(r => r.id === 'monster_black_liquidator_wrong_count'), true);
  assert.equal(spriteA.length, S * S);
  assert.equal(opaque > 520, true, 'sprite should read as a full human patrol silhouette');
  assert.equal(red > 0, true, 'red lens glints should distinguish the mask');
  assert.equal(chalk >= 5, true, 'chalk mask numbers should be visible');
  assert.notEqual(spriteHash(spriteA), spriteHash(spriteB), 'seeded silhouettes should vary within a patrol');
});

test('black liquidator knocks while neutral and reveals on forbidden samples', () => {
  const { world, doorIdx } = openWorldWithDoor();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(30, 10);
  const threat = blackLiquidator(10.5, 10.5);
  threat.ai!.falsePatrolDoorIdx = doorIdx;
  const entities = [target, threat];
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  prime(entities);
  updateMonster(world, entities, threat, 0.2, 1, msgs, target.id, { v: 10 }, state);

  assert.equal(threat.ai?.combatTargetId, undefined);
  assert.equal(threat.ai?.falsePatrolRevealed, undefined);
  assert.ok(getRecentEvents(state, { type: 'false_liquidator_knock', tags: ['black_liquidator'], limit: 1 })[0]);

  target.x = 18;
  target.inventory = [{ defId: 'nii_sample_container', count: 1 }];
  prime(entities);
  updateMonster(world, entities, threat, 0.2, 2, msgs, target.id, { v: 10 }, state);

  assert.equal(threat.ai?.falsePatrolRevealed, undefined);
  assert.equal(threat.monsterStage, undefined);

  target.inventory = [{ defId: 'govnyak_sample', count: 1 }];
  prime(entities);
  updateMonster(world, entities, threat, 0.2, 3, msgs, target.id, { v: 10 }, state);

  assert.equal(threat.ai?.falsePatrolRevealed, true);
  assert.equal(threat.monsterStage, 1);
  const revealed = getRecentEvents(state, { type: 'false_liquidator_revealed', tags: ['black_liquidator'], limit: 1 })[0];
  assert.ok(revealed);
  assert.equal(revealed.data?.reason, 'forbidden_sample');
});
