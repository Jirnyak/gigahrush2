import test from 'node:test';
import assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, MonsterKind, Occupation, QuestType, type Entity, type Quest } from '../src/core/types';
import { World } from '../src/core/world';
import { PLOT_CHAIN } from '../src/data/plot';
import { updateKillQuestPressure } from '../src/systems/quests';
import { makeGameState } from './helpers';

function pressureStepIndex(): number {
  const index = PLOT_CHAIN.findIndex(step => step.killPressure?.anchor.plotNpcId === 'major_grom');
  assert.ok(index >= 0, 'Grom defense step should define kill pressure');
  return index;
}

function floorWorld(): World {
  const world = new World();
  for (let y = 10; y <= 30; y++) {
    for (let x = 10; x <= 30; x++) {
      world.cells[world.idx(x, y)] = Cell.FLOOR;
    }
  }
  return world;
}

function major(): Entity {
  return {
    id: 10,
    type: EntityType.NPC,
    x: 20.5,
    y: 20.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1.2,
    sprite: Occupation.HUNTER,
    name: 'Майор Громный',
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    hp: 100,
    maxHp: 100,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    plotNpcId: 'major_grom',
  };
}

test('authored kill pressure waits for its interval and spawns from plot data', () => {
  const state = makeGameState({ time: 100 });
  const quest: Quest = {
    id: 77,
    type: QuestType.KILL,
    giverId: 10,
    giverName: 'Майор Громный',
    desc: 'держать форпост',
    plotStepIndex: pressureStepIndex(),
    killNeeded: 10,
    done: false,
  };
  state.quests = [quest];
  const world = floorWorld();
  const entities: Entity[] = [major()];
  const nextId = { v: 1000 };

  assert.equal(updateKillQuestPressure(world, entities, state, state.msgs, nextId), false);
  assert.equal(entities.some(entity => entity.type === EntityType.MONSTER), false);

  state.time += (PLOT_CHAIN[quest.plotStepIndex!].killPressure?.intervalSeconds ?? 3);
  assert.equal(updateKillQuestPressure(world, entities, state, state.msgs, nextId), true);
  const spawned = entities.filter(entity => entity.type === EntityType.MONSTER);
  assert.ok(spawned.length >= 2 && spawned.length <= 3);
  assert.equal(spawned.every(entity => (PLOT_CHAIN[quest.plotStepIndex!].killPressure?.monsterKinds ?? []).includes(entity.monsterKind ?? MonsterKind.TVAR)), true);
});
