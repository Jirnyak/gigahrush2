import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AIGoal,
  EntityType,
  Faction,
  FloorLevel,
  Occupation,
  type Entity,
  type GameState,
} from '../src/core/types';
import {
  ALIFE_POPULATION_BASELINE,
  ALIFE_POPULATION_CAPACITY,
  alifePopulationTotalForSeed,
} from '../src/data/alife_population_plan';
import {
  alifeForSave,
  assignPersistentAlifeNpcFromEntity,
  defaultAlifePopulation,
  ensureAlifeState,
  setAlifeState,
} from '../src/systems/alife';
import { setFloorRunState } from '../src/systems/procedural_floors';

function restoreGlobalProperty(name: 'navigator' | 'performance' | 'window', descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete (globalThis as Record<string, unknown>)[name];
}

function minimalState(): GameState {
  const state = { currentFloor: FloorLevel.LIVING } as GameState;
  setFloorRunState(state, { runSeed: 1 }, FloorLevel.LIVING);
  return state;
}

test('A-Life baseline population is independent from runtime memory and mobile hints', () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const performanceDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        maxTouchPoints: 0,
        deviceMemory: 64,
      },
    });
    Object.defineProperty(globalThis, 'performance', {
      configurable: true,
      value: { memory: { jsHeapSizeLimit: 64 * 1024 * 1024 * 1024 } },
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { innerWidth: 3840, innerHeight: 2160 },
    });

    assert.equal(defaultAlifePopulation(), ALIFE_POPULATION_BASELINE);

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36',
        maxTouchPoints: 5,
        deviceMemory: 1,
      },
    });
    Object.defineProperty(globalThis, 'performance', {
      configurable: true,
      value: { memory: { jsHeapSizeLimit: 256 * 1024 * 1024 } },
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { innerWidth: 844, innerHeight: 390 },
    });

    assert.equal(defaultAlifePopulation(), ALIFE_POPULATION_BASELINE);
  } finally {
    restoreGlobalProperty('navigator', navigatorDescriptor);
    restoreGlobalProperty('performance', performanceDescriptor);
    restoreGlobalProperty('window', windowDescriptor);
  }
});

test('A-Life new run population uses seed-sized total below technical capacity', () => {
  const state = minimalState();
  const alife = ensureAlifeState(state) as { total: number; npcs: unknown[] };
  const expected = alifePopulationTotalForSeed(1);

  assert.equal(alife.total, expected);
  assert.equal(alife.npcs.length, expected);
  assert.ok(alife.total < ALIFE_POPULATION_CAPACITY);
});

test('A-Life clamps oversized saved totals to the technical population capacity', () => {
  const alife = setAlifeState(minimalState(), { seed: 12345, total: 1_000_000 }) as {
    total: number;
    npcs: unknown[];
  };

  assert.equal(alife.total, ALIFE_POPULATION_CAPACITY);
  assert.equal(alife.npcs.length, ALIFE_POPULATION_CAPACITY);
});

test('A-Life rejects implausibly undersized saved totals back to the run-sized total', () => {
  const state = minimalState();
  const alife = setAlifeState(state, { seed: 12345, total: 999 }) as {
    total: number;
    npcs: unknown[];
  };
  const expected = alifePopulationTotalForSeed(1);

  assert.equal(alife.total, expected);
  assert.equal(alife.npcs.length, expected);
  assert.equal(alifeForSave(state).total, expected);
});

test('A-Life event arrivals reserve fixed-pool identities without growing the pool', () => {
  const state = minimalState();
  const alife = setAlifeState(state, { seed: 12345, total: 1_000_000 }) as {
    total: number;
    npcs: unknown[];
  };
  const npc: Entity = {
    id: 1,
    type: EntityType.NPC,
    x: 10.5,
    y: 10.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1.2,
    sprite: Occupation.TRAVELER,
    name: 'Прибытие из события',
    hp: 30,
    maxHp: 30,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    faction: Faction.CITIZEN,
    occupation: Occupation.TRAVELER,
    questId: -1,
  };

  assert.equal(assignPersistentAlifeNpcFromEntity(state, npc, []), true);
  assert.equal(alife.total, ALIFE_POPULATION_CAPACITY);
  assert.equal(alife.npcs.length, ALIFE_POPULATION_CAPACITY);
  assert.equal(typeof npc.alifeId, 'number');
  assert.equal(npc.persistentNpcId, `alife:${npc.alifeId}`);
});
