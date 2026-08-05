import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ceilingPatternSeam,
  checkerPatternTone,
  effectiveFloorPatternForTex,
  effectiveTrimForTex,
  effectiveWallBandForTex,
  floorPatternSeam,
  materialPatternHash01,
  tileSeamFactor,
  wallBandFactor,
  wallBandThreshold,
  type MaterialPatternCell,
} from '../src/render/material_patterns';
import { Tex } from '../src/core/types';
import type {
  VisualSurfaceCeilingPattern,
  VisualSurfaceFloorPattern,
  VisualSurfaceTrim,
  VisualSurfaceWallBand,
} from '../src/data/visual_surface_profiles';

const CELL: MaterialPatternCell = { cellX: 17, cellY: 33, tx: 16, ty: 31 };

test('checker and hash material helpers are deterministic', () => {
  assert.equal(checkerPatternTone({ cellX: 0, cellY: 0, tx: 0, ty: 0 }), -1);
  assert.equal(checkerPatternTone({ cellX: 1, cellY: 0, tx: 0, ty: 0 }), 1);
  assert.equal(checkerPatternTone({ cellX: 1, cellY: 1, tx: 12, ty: 48 }), -1);

  const a = materialPatternHash01(12, 44, 99);
  const b = materialPatternHash01(12, 44, 99);
  const c = materialPatternHash01(12, 44, 100);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.ok(a >= 0 && a <= 1);
  assert.ok(c >= 0 && c <= 1);
});

test('tile seam helper is bounded and stronger on tile boundaries', () => {
  const edge = tileSeamFactor(0, 8, 16, 1);
  const center = tileSeamFactor(8, 8, 16, 1);
  const wrapped = tileSeamFactor(-16, -1, 16, 1);
  assert.ok(edge > center, 'tile edge should have stronger seam than center');
  for (const value of [edge, center, wrapped]) assert.ok(value >= 0 && value <= 1);
});

test('all floor and ceiling pattern helpers return bounded finite seams', () => {
  for (const pattern of ['plain', 'checker', 'smallTile', 'lino', 'wetConcrete', 'metalGrid'] as const satisfies readonly VisualSurfaceFloorPattern[]) {
    const value = floorPatternSeam(pattern, CELL);
    assert.equal(Number.isFinite(value), true, `${pattern} floor seam must be finite`);
    assert.ok(value >= 0 && value <= 1, `${pattern} floor seam must stay normalized`);
  }

  for (const pattern of ['plain', 'panelGrid', 'servicePanels', 'lowConcrete', 'organicRibs'] as const satisfies readonly VisualSurfaceCeilingPattern[]) {
    const value = ceilingPatternSeam(pattern, CELL);
    assert.equal(Number.isFinite(value), true, `${pattern} ceiling seam must be finite`);
    assert.ok(value >= 0 && value <= 1, `${pattern} ceiling seam must stay normalized`);
  }
});

test('wall band factors and thresholds are bounded', () => {
  for (const band of ['none', 'tileWainscot', 'panelLower', 'concreteBlocks', 'serviceStrip'] as const satisfies readonly VisualSurfaceWallBand[]) {
    const threshold = wallBandThreshold(band);
    assert.equal(Number.isFinite(threshold), true, `${band} threshold must be finite`);
    assert.ok(threshold >= 0 && threshold <= 64, `${band} threshold must stay in texture range`);
    for (const y of [0, 24, 38, 48, 63]) {
      const value = wallBandFactor(band, y);
      assert.equal(Number.isFinite(value), true, `${band}:${y} factor must be finite`);
      assert.ok(value >= 0 && value <= 1, `${band}:${y} factor must be normalized`);
    }
  }

  assert.equal(wallBandFactor('none', 63), 0);
  assert.equal(wallBandFactor('concreteBlocks', 4), 1);
  assert.ok(wallBandFactor('tileWainscot', 48) > wallBandFactor('tileWainscot', 24));
});

test('texture ids override surface patterns without room-name hardcoding', () => {
  const floorCases: readonly [Tex, VisualSurfaceFloorPattern][] = [
    [Tex.F_TILE, 'smallTile'],
    [Tex.F_MARBLE_TILE, 'smallTile'],
    [Tex.F_LINO, 'lino'],
    [Tex.F_PARQUET, 'lino'],
    [Tex.F_WATER, 'wetConcrete'],
    [Tex.PIPE, 'metalGrid'],
  ];
  for (const [tex, expected] of floorCases) {
    assert.equal(effectiveFloorPatternForTex('checker', tex), expected);
  }
  assert.equal(effectiveFloorPatternForTex('checker', Tex.F_CONCRETE), 'checker');

  const wallCases: readonly [Tex, VisualSurfaceWallBand][] = [
    [Tex.TILE_W, 'tileWainscot'],
    [Tex.MARBLE, 'tileWainscot'],
    [Tex.PIPE, 'serviceStrip'],
    [Tex.METAL, 'serviceStrip'],
    [Tex.MEAT, 'none'],
    [Tex.VOID_WALL, 'none'],
  ];
  for (const [tex, expected] of wallCases) {
    assert.equal(effectiveWallBandForTex('panelLower', tex), expected);
  }
  assert.equal(effectiveWallBandForTex('none', Tex.CONCRETE), 'concreteBlocks');
  assert.equal(effectiveWallBandForTex('panelLower', Tex.CONCRETE), 'panelLower');

  const trimCases: readonly [Tex, VisualSurfaceTrim][] = [
    [Tex.PIPE, 'metalRail'],
    [Tex.METAL, 'metalRail'],
    [Tex.GUT, 'none'],
    [Tex.F_VOID, 'none'],
  ];
  for (const [tex, expected] of trimCases) {
    assert.equal(effectiveTrimForTex('baseboard', tex), expected);
  }
  assert.equal(effectiveTrimForTex('baseboard', Tex.TILE_W), 'baseboard');
});
