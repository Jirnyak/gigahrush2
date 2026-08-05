import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { AIGoal, Cell, DoorState, EntityType, MonsterKind } from './src/core/types.ts';
import { World } from './src/core/world.ts';
import { DEF } from './src/entities/bezekhiy.ts';
import { updateMonster, setEntityMap } from './src/systems/ai/monster.ts';
import { makeGameState } from './tests/helpers.ts';
import { setListenerPos } from './src/systems/audio.ts';
import { rebuildEntityIndex } from './src/systems/entity_index.ts';
import { createWorldEventState } from './src/systems/events.ts';

function openDoorWorld() {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.zoneMap.fill(0);
  world.zones[0] = { id: 0, cx: 10, cy: 10, faction: 0, hasLift: false, fogged: false, level: 1, hqRoomId: -1 };
  const doorIdx = world.idx(10, 10);
  world.cells[doorIdx] = Cell.DOOR;
  world.doors.set(doorIdx, { idx: doorIdx, state: DoorState.OPEN, roomA: -1, roomB: -1, keyId: '', timer: 0 });
  return world;
}

function bezekhiy(x, y) {
  return {
    id: 2, type: EntityType.MONSTER, x, y, angle: 0, pitch: 0, alive: true,
    speed: DEF.speed, sprite: DEF.sprite, hp: DEF.hp, maxHp: DEF.hp,
    monsterKind: MonsterKind.BEZEKHIY, attackCd: 0, currentMag: 1,
    ai: { goal: AIGoal.WANDER, tx: Math.floor(x), ty: Math.floor(y), path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

const world = openDoorWorld();
setListenerPos(512, 512, world.dist2.bind(world));
const target = { id: 1, type: EntityType.NPC, persistentNpcId: 'player', x: 9.2, y: 10.5, angle: 0, pitch: 0, hp: 100, maxHp: 100, alive: true, speed: 3 };
const threat = bezekhiy(10.5, 13.5);
const entities = [target, threat];
const state = makeGameState({ worldEvents: createWorldEventState() });

function sync(entities) {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

const s = performance.now();
sync(entities);
updateMonster(world, entities, threat, 0, 1, [], target.id, {v: 3}, state);
console.log("Time 1:", performance.now() - s);

target.x = 11.8;
target.y = 10.5;
target.angle = 0;
sync(entities);
updateMonster(world, entities, threat, 0.1, 1.1, [], target.id, {v: 3}, state);
console.log("Time 2:", performance.now() - s);
