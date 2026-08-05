import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, FloorLevel, MonsterKind, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { MONSTER_ECOLOGY } from '../src/data/monster_ecology';
import { DEF, generateSprite } from '../src/entities/pechateed';
import { S } from '../src/render/pixutil';
import { setEntityMap, updateMonster } from '../src/systems/ai/monster';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { makeGameState, makeTestNpc, makeTestPlayer } from './helpers';

function sortedFloors(floors: readonly FloorLevel[] | undefined): FloorLevel[] {
  return [...(floors ?? [])].sort((a, b) => a - b);
}

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  return world;
}

function pechateed(x: number, y: number): Entity {
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
    monsterKind: MonsterKind.PECHATEED,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function prime(entities: Entity[]): void {
  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(entity => [entity.id, entity])));
}

test('pechateed local definition stays a kiteable document hunter', () => {
  const ecology = MONSTER_ECOLOGY.find(def => def.kind === MonsterKind.PECHATEED);

  assert.ok(ecology, 'PECHATEED ecology must exist');
  assert.equal(DEF.kind, MonsterKind.PECHATEED);
  assert.deepEqual(DEF.aiFlags, ['documentHunter']);
  assert.deepEqual(sortedFloors(DEF.floors), sortedFloors(ecology.floors));
  assert.ok(DEF.speed < 1.8, 'PECHATEED should remain kiteable');
  assert.ok(DEF.dmg >= 10, 'PECHATEED should punish a caught paper carrier');
  assert.match(DEF.counterplay ?? '', /Сбросьте.*бумаг/);
  assert.match(DEF.counterplay ?? '', /дистанц/);
  assert.match(DEF.lootHint ?? '', /бланк|чернил/);
});

test('pechateed sprite has a readable paper-and-stamp silhouette', () => {
  const sprite = generateSprite();
  let opaque = 0;
  let stampPixels = 0;
  let inkPixels = 0;

  for (const pixel of sprite) {
    if ((pixel >>> 24) === 0) continue;
    opaque++;
    const r = pixel & 0xff;
    const g = (pixel >>> 8) & 0xff;
    const b = (pixel >>> 16) & 0xff;
    if (r > 95 && g < 55 && b < 65) stampPixels++;
    if (r < 55 && g < 45 && b < 50) inkPixels++;
  }

  assert.equal(sprite.length, S * S);
  assert.ok(opaque > 450, 'sprite should not be visually thin or blank');
  assert.ok(stampPixels > 20, 'red stamp/mouth pixels should cue document identity');
  assert.ok(inkPixels > 20, 'dark ink/text pixels should cue document identity');
});

test('pechateed document scent targets NPC carriers, not only the player', () => {
  const world = openWorld();
  const player = makeTestPlayer({ id: 1, x: 13, y: 10.5, hp: 100, maxHp: 100, inventory: [] });
  const courier = makeTestNpc({
    id: 3,
    x: 19.5,
    y: 10.5,
    faction: Faction.CITIZEN,
    inventory: [{ defId: 'blank_form', count: 2 }],
  });
  const threat = pechateed(10.5, 10.5);
  const entities = [player, threat, courier];

  prime(entities);
  updateMonster(world, entities, threat, 0.2, 6, [], player.id, { v: 100 }, makeGameState({ currentFloor: FloorLevel.MINISTRY }));

  assert.equal(threat.ai?.combatTargetId, courier.id);
});
