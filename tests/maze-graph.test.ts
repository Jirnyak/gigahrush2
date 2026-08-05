import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { xorshift32 } from '../src/core/rand';
import {
  generateGrowingTreeMaze,
  generateWilsonMaze,
  validateMazeGraph,
  type MazeGraph,
} from '../src/gen/maze_graph';

function edgeSignatures(graph: MazeGraph): string[] {
  return graph.edges.map(edge => `${Math.min(edge.a, edge.b)}:${Math.max(edge.a, edge.b)}:${edge.tag}`).sort();
}

test('growing tree maze emits connected toroidal intent graph with seams and landmarks', () => {
  const graph = generateGrowingTreeMaze({
    width: 10,
    height: 8,
    originX: 32,
    originY: 48,
    cellSize: 16,
    startGx: 0,
    startGy: 0,
    endGx: 5,
    endGy: 4,
    braidChance: 1,
    extraChordCount: 64,
    lockedChordChance: 0.35,
    rewardLeafChance: 1,
    landmarkCount: 7,
    selectionWeights: { newest: 1, oldest: 0, random: 0 },
    rand: xorshift32(6606),
  });

  const validation = validateMazeGraph(graph);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.connected, true);
  assert.equal(validation.liftBackboneUngated, true);
  assert.equal(validation.optionalLocksValid, true);
  assert.equal(validation.seamMetadataValid, true);
  assert.equal(graph.nodes.length, 80);
  assert.equal(graph.landmarkIds.length, 7);
  assert.equal(graph.landmarkSpacing, validation.landmarkSpacing);
  assert.equal(graph.loopCount > 0, true);
  assert.equal(graph.protectedSeams.length > 0, true);
  assert.equal(graph.protectedSeams.length, graph.edges.filter(edge => edge.seamAxis !== undefined).length);
});

test('growing tree selection weights affect deterministic graph shape', () => {
  const newest = generateGrowingTreeMaze({
    width: 9,
    height: 9,
    originX: 0,
    originY: 0,
    cellSize: 12,
    braidChance: 0,
    extraChordCount: 0,
    lockedChordChance: 0,
    rewardLeafChance: 0,
    selectionWeights: { newest: 1, oldest: 0, random: 0 },
    rand: xorshift32(17),
  });
  const oldest = generateGrowingTreeMaze({
    width: 9,
    height: 9,
    originX: 0,
    originY: 0,
    cellSize: 12,
    braidChance: 0,
    extraChordCount: 0,
    lockedChordChance: 0,
    rewardLeafChance: 0,
    selectionWeights: { newest: 0, oldest: 1, random: 0 },
    rand: xorshift32(17),
  });

  assert.notDeepEqual(edgeSignatures(newest), edgeSignatures(oldest));
});

test('maze validation rejects optional locks on required bridge corridors', () => {
  const graph = generateGrowingTreeMaze({
    width: 7,
    height: 7,
    originX: 0,
    originY: 0,
    cellSize: 10,
    braidChance: 0,
    extraChordCount: 0,
    lockedChordChance: 0,
    rewardLeafChance: 0,
    rand: xorshift32(31),
  });
  const bridgeIndex = graph.edges.findIndex(edge => graph.nodes[edge.a].degree > 1 && graph.nodes[edge.b].degree > 1);
  assert.notEqual(bridgeIndex, -1);

  const invalid: MazeGraph = {
    ...graph,
    edges: graph.edges.map((edge, index) => index === bridgeIndex ? { ...edge, tag: 'locked_optional' } : { ...edge }),
  };
  const validation = validateMazeGraph(invalid);
  assert.equal(validation.connected, true);
  assert.equal(validation.optionalLocksValid, false);
  assert.equal(validation.errors.some(error => error.includes('optional lock')), true);
});

test('wilson maze emits a uniform spanning tree when braiding is disabled', () => {
  const graph = generateWilsonMaze({
    width: 8,
    height: 8,
    originX: 4,
    originY: 4,
    cellSize: 20,
    startGx: 1,
    startGy: 1,
    braidChance: 0,
    extraChordCount: 0,
    lockedChordChance: 0,
    rewardLeafChance: 0,
    landmarkCount: 5,
    rand: xorshift32(99),
  });
  const validation = validateMazeGraph(graph);

  assert.deepEqual(validation.errors, []);
  assert.equal(graph.edges.length, graph.nodes.length - 1);
  assert.equal(graph.loopCount, 0);
  assert.equal(graph.landmarkIds.length, 5);
  assert.equal(validation.connected, true);
});
