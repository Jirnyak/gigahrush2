import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { auditReachability } from '../src/core/world';
import { Cell, EntityType, Faction, RoomType, W, ZoneFaction, type TerritoryOwner } from '../src/core/types';
import { factionToTerritoryOwner } from '../src/data/factions';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import {
  UNDERHELL_FLAGS,
  generateUnderhellDesignFloor,
  scoreUnderhellThresholdChain,
  snapshotUnderhellFlags,
} from '../src/gen/design_floors/underhell';
import {
  countTerritoryCells,
  territoryHqAnchors,
  territoryOwnerAt,
  territoryRoomOwner,
} from '../src/systems/territory';

const UNDERHELL_TARGET_SHARES: readonly [TerritoryOwner, number][] = [
  [ZoneFaction.CITIZEN, 0.07],
  [ZoneFaction.LIQUIDATOR, 0.10],
  [ZoneFaction.CULTIST, 0.38],
  [ZoneFaction.SCIENTIST, 0.05],
  [ZoneFaction.WILD, 0.28],
  [ZoneFaction.SAMOSBOR, 0.12],
];

function passableCellCount(world: ReturnType<typeof generateDesignFloor>['world']): number {
  let count = 0;
  for (let i = 0; i < W * W; i++) {
    const cell = world.cells[i];
    if (cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.LIFT || cell === Cell.WATER) count++;
  }
  return count;
}

test('underhell scores a complete threshold chain with retreat and reward branches', () => {
  const gen = generateUnderhellDesignFloor();
  const score = scoreUnderhellThresholdChain(gen.world, gen.ritualState);

  assert.equal(gen.thresholdChain.score, score.score);
  assert.equal(score.score >= score.minScore, true, `underhell threshold score ${score.score}/${score.minScore}`);
  assert.deepEqual(score.nodes.map(node => node.role), ['entry', 'threat', 'fallback', 'reward', 'exit']);
  assert.equal(score.nodes.every(node => node.reachable), true);
  assert.equal(score.hasRetreat, true);
  assert.equal(score.hasWitnessBranch, true);
  assert.equal(score.hasDebtReward, true);
  assert.equal(score.hasVoidExit, true);
  assert.equal(score.capillaryCells >= 72, true, `capillary cells ${score.capillaryCells}`);
  assert.equal(score.tributeFrontCells >= 24, true, `tribute front cells ${score.tributeFrontCells}`);
  assert.equal(score.shelterCells >= 18, true, `shelter cells ${score.shelterCells}`);
});

test('underhell forced-open debug path keeps the void cut deterministic', () => {
  const gen = generateUnderhellDesignFloor({ forceOpenVoidGate: true });
  const snapshot = snapshotUnderhellFlags(gen.ritualState.flags);

  assert.equal(snapshot.thresholdPaid, true);
  assert.equal(snapshot.thresholdCost, 'holy_water');
  assert.equal(snapshot.voidGateState, 'open');
  assert.equal((gen.ritualState.flags & UNDERHELL_FLAGS.VOID_GATE_OPEN) !== 0, true);
  assert.equal(gen.thresholdChain.hasVoidExit, true);
});

test('underhell full route expansion has macro, mid and micro scale', () => {
  const gen = generateDesignFloor('underhell', 61061);
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  const reachable = Array.from(audit.reachable).reduce((sum, value) => sum + value, 0);

  assert.equal(gen.world.rooms.length >= 320, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 250, true, `doors ${gen.world.doors.size}`);
  assert.equal(passableCellCount(gen.world) >= 260_000, true, `passable ${passableCellCount(gen.world)}`);
  assert.equal(reachable >= 260_000, true, `reachable ${reachable}`);
});

test('underhell full route territory matches the authored control brief', () => {
  const gen = generateDesignFloor('underhell', 61061);
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const total = W * W;
  const cultistCells = counts.get(ZoneFaction.CULTIST) ?? 0;

  for (const [owner, target] of UNDERHELL_TARGET_SHARES) {
    const share = (counts.get(owner) ?? 0) / total;
    assert.equal(Math.abs(share - target) <= 0.025, true, `owner ${owner} share ${share}`);
    if (owner !== ZoneFaction.CULTIST) assert.equal(cultistCells > (counts.get(owner) ?? 0), true, `cultist dominant over ${owner}`);
  }

  const anchors = territoryHqAnchors(gen.world);
  for (const owner of [ZoneFaction.CITIZEN, ZoneFaction.LIQUIDATOR, ZoneFaction.CULTIST, ZoneFaction.SCIENTIST, ZoneFaction.WILD] as const) {
    assert.equal(anchors.some(anchor => anchor.owner === owner), true, `missing HQ anchor ${owner}`);
  }

  const hqRoomsByOwner = new Map<TerritoryOwner, number>();
  for (const room of gen.world.rooms) {
    if (room.type !== RoomType.HQ) continue;
    const owner = territoryRoomOwner(gen.world, room.id);
    hqRoomsByOwner.set(owner, (hqRoomsByOwner.get(owner) ?? 0) + 1);
  }
  assert.equal((hqRoomsByOwner.get(ZoneFaction.CULTIST) ?? 0) >= 2, true, 'cultists should keep multiple HQ cores');
});

test('underhell ambient NPC templates align to their own cell territory', () => {
  const gen = generateDesignFloor('underhell', 61061);
  const expectedAmbientFactions = new Set<Faction>([Faction.LIQUIDATOR, Faction.CULTIST]);
  const ambient = gen.entities.filter(entity => (
    entity.type === EntityType.NPC &&
    entity.alive &&
    entity.plotNpcId === undefined &&
    entity.persistentNpcId === undefined &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    entity.faction !== undefined
  ));
  const factions = new Set<Faction>();

  for (const entity of ambient) {
    if (entity.faction === undefined) throw new Error(`ambient NPC without faction: ${entity.name}`);
    factions.add(entity.faction);
    assert.equal(expectedAmbientFactions.has(entity.faction), true, `unexpected ambient faction ${entity.faction}`);
    assert.equal(territoryOwnerAt(gen.world, entity.x, entity.y), factionToTerritoryOwner(entity.faction));
  }

  for (const faction of expectedAmbientFactions) {
    assert.equal(factions.has(faction), true, `missing ambient faction ${faction}`);
  }
});
