import test from 'node:test';
import assert from 'node:assert/strict';

import { Cell, RoomType, ZoneFaction } from '../src/core/types';
import { World } from '../src/core/world';
import { placeDecisionTriangle } from '../src/gen/decision_triangles';
import { addTestRoom } from './helpers';

function floorCell(world: World, x: number, y: number): number {
  const cell = world.idx(x, y);
  world.cells[cell] = Cell.FLOOR;
  return cell;
}

test('decision triangle places separated risk reward and escape cells around a POI', () => {
  const world = new World();
  addTestRoom(world, {
    id: 0,
    x: 40,
    y: 40,
    w: 70,
    h: 70,
    type: RoomType.STORAGE,
    zoneFaction: ZoneFaction.CITIZEN,
  });

  const reward = floorCell(world, 50, 59);
  const risk = floorCell(world, 65, 50);
  const escape = floorCell(world, 88, 50);
  const protectedReward = floorCell(world, 50, 58);
  const exit = world.idx(90, 50);
  world.cells[exit] = Cell.LIFT;

  const protectedMask = new Set<number>([protectedReward]);
  const result = placeDecisionTriangle(world, {
    candidates: [
      protectedReward,
      floorCell(world, 51, 50),
      reward,
      risk,
      escape,
      floorCell(world, 73, 73),
      floorCell(world, 92, 55),
    ],
    poi: { x: 50, y: 50 },
    seed: 7,
    protectedMask,
    exitTargets: [exit],
    roles: {
      risk: { distanceBand: { min: 12, max: 18, ideal: 15, score: 12, outsidePenalty: 12 } },
      reward: { distanceBand: { min: 7, max: 11, ideal: 9, score: 12, outsidePenalty: 12 } },
      escape: {
        distanceBand: { min: 35, max: 42, ideal: 38, score: 8, outsidePenalty: 8 },
        exitTargetBand: { min: 0, max: 6, ideal: 2, score: 12, outsidePenalty: 12 },
      },
    },
  });

  assert.ok(result);
  assert.equal(result.risk.cell, risk);
  assert.equal(result.reward.cell, reward);
  assert.equal(result.escape.cell, escape);
  assert.equal(result.points.some(point => point.cell === protectedReward), false);
  assert.equal(new Set(result.points.map(point => point.cell)).size, 3);
});

test('decision triangle uses escape reachability masks for shelter or lift validation', () => {
  const world = new World();
  const risk = floorCell(world, 25, 10);
  const reward = floorCell(world, 10, 19);
  const unreachableEscape = floorCell(world, 45, 10);
  const reachableEscape = floorCell(world, 10, 45);
  const escapeReachable = new Set<number>([reachableEscape]);

  const result = placeDecisionTriangle(world, {
    candidates: [risk, reward, unreachableEscape, reachableEscape, floorCell(world, 31, 31)],
    poi: { x: 10, y: 10 },
    seed: 11,
    escapeReachable,
    minSeparation: 4,
    roles: {
      risk: { distanceBand: { min: 12, max: 18, ideal: 15, score: 8, outsidePenalty: 8 } },
      reward: { distanceBand: { min: 7, max: 11, ideal: 9, score: 8, outsidePenalty: 8 } },
      escape: { distanceBand: { min: 30, max: 40, ideal: 35, score: 8, outsidePenalty: 8 } },
    },
  });

  assert.ok(result);
  assert.equal(result.escape.cell, reachableEscape);
  assert.notEqual(result.escape.cell, unreachableEscape);
});

test('decision triangle candidate sampling is bounded to the documented range', () => {
  const world = new World();
  const candidates: number[] = [];
  for (let x = 100; x < 700; x++) candidates.push(floorCell(world, x, 300));

  const result = placeDecisionTriangle(world, {
    candidates,
    poi: { x: 300, y: 300 },
    seed: 19,
    sampleCount: 999,
    maxSamplesPerBucket: 300,
    minSeparation: 2,
    roles: {
      risk: { distanceBand: { min: 0, max: 512, ideal: 32, score: 1, outsidePenalty: 1 } },
      reward: { distanceBand: { min: 0, max: 512, ideal: 64, score: 1, outsidePenalty: 1 } },
      escape: { distanceBand: { min: 0, max: 512, ideal: 96, score: 1, outsidePenalty: 1 } },
    },
  });

  assert.ok(result);
  assert.equal(result.sampled, 300);
});
