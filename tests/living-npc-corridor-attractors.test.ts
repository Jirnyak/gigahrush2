import test from 'node:test';
import assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, FloorLevel, type Entity, type GameClock, type Msg } from '../src/core/types';
import { withSeededRandom } from '../src/core/rand';
import { generateFloor } from '../src/gen/floor_manifest';
import { updateAI } from '../src/systems/ai';
import { rebuildEntityIndexForSimulation } from '../src/systems/entity_index';
import { initFactionRelations } from '../src/data/relations';
import { setCurrentPlayerEntity } from '../src/systems/player_actor';
import { makeGameState, makeTestPlayer } from './helpers';

const LIVING_ATTRACTOR_SEED = 61_061;
const LIVING_ATTRACTOR_TICKS = 600;
const LIVING_ATTRACTOR_DT = 0.2;

interface ReversalHistory {
  previous?: number;
  current?: number;
  corridorReversals: number;
}

function resetAi(e: Entity): void {
  if (!e.ai) return;
  e.ai.goal = AIGoal.IDLE;
  e.ai.tx = 0;
  e.ai.ty = 0;
  e.ai.path = [];
  e.ai.pi = 0;
  e.ai.stuck = 0;
  e.ai.timer = 0;
  e.ai.combatTargetId = undefined;
  e.ai.combatScanCd = 10;
  e.ai.attackCd = 10;
}

function normalizeNonCombatRoutine(entities: Entity[]): void {
  for (const e of entities) {
    if (e.type !== EntityType.NPC || e.persistentNpcId === 'player') continue;
    e.faction = Faction.CITIZEN;
    e.weapon = undefined;
    e.inventory = [];
    e.needs = { food: 100, water: 100, sleep: 100, pee: 0, poo: 0 };
    e.hp = e.maxHp ?? 100;
    resetAi(e);
  }
}

function makePlayer(id: number, x: number, y: number): Entity {
  return makeTestPlayer({
    id,
    x,
    y,
    speed: 1,
    hp: 100,
    maxHp: 100,
    alive: true,
  });
}

interface CorridorMetrics {
  residents: number;
  residentCorridor: number;
  residentCorridorRatio: number;
  residentActiveStuck: number;
  residentLongChunked: number;
  residentCorridorCellMax: number;
  residentCorridorReversalMax: number;
  residentCorridorReversers: number;
}

function isRoutineResident(e: Entity): boolean {
  return e.type === EntityType.NPC &&
    e.alive &&
    e.persistentNpcId !== 'player' &&
    e.isTraveler !== true;
}

function livingCorridorMetrics(
  entities: readonly Entity[],
  world: ReturnType<typeof generateFloor>['world'],
  reversalHistory: ReadonlyMap<number, ReversalHistory> = new Map(),
): CorridorMetrics {
  let residents = 0;
  let residentCorridor = 0;
  let residentActiveStuck = 0;
  let residentLongChunked = 0;
  let residentCorridorReversalMax = 0;
  let residentCorridorReversers = 0;
  const corridorCells = new Map<number, number>();

  for (const e of entities) {
    if (!isRoutineResident(e)) continue;
    residents++;
    const x = Math.floor(e.x);
    const y = Math.floor(e.y);
    const idx = world.idx(x, y);
    if (world.cells[idx] === Cell.FLOOR && world.roomMap[idx] < 0) {
      residentCorridor++;
      corridorCells.set(idx, (corridorCells.get(idx) ?? 0) + 1);
    }
    const ai = e.ai;
    if (ai && ai.stuck > 1 && ai.path.length > 0 && ai.pi < ai.path.length) {
      residentActiveStuck++;
      if (ai.path.length >= 1024 && ai.pi === 0) residentLongChunked++;
    }
    const history = reversalHistory.get(e.id);
    if (history && history.corridorReversals > 0) {
      residentCorridorReversers++;
      residentCorridorReversalMax = Math.max(residentCorridorReversalMax, history.corridorReversals);
    }
  }

  let residentCorridorCellMax = 0;
  for (const count of corridorCells.values()) residentCorridorCellMax = Math.max(residentCorridorCellMax, count);

  return {
    residents,
    residentCorridor,
    residentCorridorRatio: residents > 0 ? residentCorridor / residents : 0,
    residentActiveStuck,
    residentLongChunked,
    residentCorridorCellMax,
    residentCorridorReversalMax,
    residentCorridorReversers,
  };
}

function recordLivingCorridorReversals(
  entities: readonly Entity[],
  world: ReturnType<typeof generateFloor>['world'],
  historyByEntity: Map<number, ReversalHistory>,
): void {
  for (const e of entities) {
    if (!isRoutineResident(e)) continue;
    const current = world.idx(Math.floor(e.x), Math.floor(e.y));
    let history = historyByEntity.get(e.id);
    if (!history) {
      history = { corridorReversals: 0 };
      historyByEntity.set(e.id, history);
    }
    if (
      history.previous !== undefined &&
      history.current !== undefined &&
      current === history.previous &&
      current !== history.current &&
      world.cells[current] === Cell.FLOOR &&
      world.roomMap[current] < 0 &&
      world.cells[history.current] === Cell.FLOOR &&
      world.roomMap[history.current] < 0
    ) {
      history.corridorReversals++;
    }
    history.previous = history.current;
    history.current = current;
  }
}

function tickLivingRoutine(
  world: ReturnType<typeof generateFloor>['world'],
  entities: Entity[],
  dt: number,
  time: number,
  clock: GameClock,
  msgs: Msg[],
): void {
  rebuildEntityIndexForSimulation(entities, Math.floor(time * 1000));
  updateAI(world, entities, dt, time, msgs, 1, clock, false, { v: 50_000 }, FloorLevel.LIVING, makeGameState({
    currentFloor: FloorLevel.LIVING,
    time,
    clock,
  }));
}

test('living routine residents do not collapse into corridor attractors', () => {
  initFactionRelations();
  const gen = generateFloor(FloorLevel.LIVING, LIVING_ATTRACTOR_SEED);
  const player = makePlayer(49_999, gen.spawnX + 0.5, gen.spawnY + 0.5);
  const entities = [player, ...gen.entities];
  normalizeNonCombatRoutine(entities);
  const clock = { hour: 8, minute: 0, totalMinutes: 480 };
  const msgs: Msg[] = [];
  const initial = livingCorridorMetrics(entities, gen.world);
  const reversalHistory = new Map<number, ReversalHistory>();

  setCurrentPlayerEntity(player);
  try {
    withSeededRandom(0x11fef00d, () => {
      for (let i = 0; i < LIVING_ATTRACTOR_TICKS; i++) {
        const time = i * LIVING_ATTRACTOR_DT;
        tickLivingRoutine(gen.world, entities, LIVING_ATTRACTOR_DT, time, clock, msgs);
        recordLivingCorridorReversals(entities, gen.world, reversalHistory);
      }
    });
  } finally {
    setCurrentPlayerEntity(undefined);
  }

  const after = livingCorridorMetrics(entities, gen.world, reversalHistory);

  assert.ok(initial.residents > 900, `expected generated Living residents, got ${initial.residents}`);
  assert.ok(initial.residentCorridorRatio < 0.08, `unexpected initial corridor load ${initial.residentCorridor}/${initial.residents}`);
  assert.ok(after.residentCorridorRatio < 0.30, `resident corridor attractor load ${after.residentCorridor}/${after.residents}`);
  assert.ok(after.residentCorridorCellMax <= 6, `resident corridor cell pile-up max ${after.residentCorridorCellMax}`);
  assert.ok(after.residentActiveStuck < 110, `too many active stuck residents: ${after.residentActiveStuck}/${after.residents}`);
  assert.ok(after.residentLongChunked < 30, `too many residents stuck on 1024-cell routine chunks: ${after.residentLongChunked}`);
  assert.ok(after.residentCorridorReversalMax < 800, `resident corridor A-B-A reversal trap max ${after.residentCorridorReversalMax}`);
  assert.ok(after.residentCorridorReversers < 500, `too many residents reversed in corridor traps: ${after.residentCorridorReversers}`);
});
