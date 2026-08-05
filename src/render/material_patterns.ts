import type {
  VisualSurfaceCeilingPattern,
  VisualSurfaceFloorPattern,
  VisualSurfaceTrim,
  VisualSurfaceWallBand,
} from '../data/visual_surface_profiles';
import { Tex } from '../core/types';

export interface MaterialPatternCell {
  cellX: number;
  cellY: number;
  tx: number;
  ty: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function materialPatternHash01(x: number, y: number, seed: number): number {
  let n = (Math.trunc(x) * 374761393 + Math.trunc(y) * 668265263 + Math.trunc(seed) * 1274126177) | 0;
  n = Math.imul(n ^ (n >> 13), 1103515245);
  n = n ^ (n >> 16);
  return (n & 0x7fff) / 32767;
}

export function checkerPatternTone(cell: MaterialPatternCell): number {
  return ((Math.trunc(cell.cellX) + Math.trunc(cell.cellY)) & 1) === 0 ? -1 : 1;
}

export function tileSeamFactor(tx: number, ty: number, tileSize: number, width = 1): number {
  const size = Math.max(2, Math.trunc(tileSize));
  const line = Math.max(0, width);
  const lx = ((Math.trunc(tx) % size) + size) % size;
  const ly = ((Math.trunc(ty) % size) + size) % size;
  const nearX = Math.min(lx, size - 1 - lx);
  const nearY = Math.min(ly, size - 1 - ly);
  return clamp01((line + 0.5 - Math.min(nearX, nearY)) / Math.max(0.5, line + 0.5));
}

export function floorPatternSeam(pattern: VisualSurfaceFloorPattern, cell: MaterialPatternCell): number {
  switch (pattern) {
    case 'checker':
      return Math.max(tileSeamFactor(cell.tx, cell.ty, 32, 1), tileSeamFactor(cell.cellX, cell.cellY, 1, 0));
    case 'smallTile':
      return tileSeamFactor(cell.tx, cell.ty, 16, 1);
    case 'lino':
      return tileSeamFactor(cell.tx, cell.ty, 32, 0.65);
    case 'metalGrid':
      return Math.max(tileSeamFactor(cell.tx, cell.ty, 16, 1), tileSeamFactor(cell.tx + cell.ty, cell.ty, 8, 0.5) * 0.6);
    case 'wetConcrete':
    case 'plain':
    default:
      return tileSeamFactor(cell.tx, cell.ty, 64, 0.75);
  }
}

export function effectiveFloorPatternForTex(
  pattern: VisualSurfaceFloorPattern,
  tex: Tex,
): VisualSurfaceFloorPattern {
  switch (tex) {
    case Tex.F_TILE:
    case Tex.F_MARBLE_TILE:
      return 'smallTile';
    case Tex.F_LINO:
    case Tex.F_PARQUET:
      return 'lino';
    case Tex.F_WATER:
      return 'wetConcrete';
    case Tex.METAL:
    case Tex.PIPE:
      return 'metalGrid';
    default:
      return pattern;
  }
}

export function wallBandFactor(band: VisualSurfaceWallBand, texY: number): number {
  if (band === 'none') return 0;
  const y = Math.max(0, Math.min(63, texY));
  switch (band) {
    case 'serviceStrip':
      return y >= 24 && y <= 39 ? 1 : 0;
    case 'concreteBlocks':
      return 1;
    case 'tileWainscot':
    case 'panelLower':
    default:
      return clamp01((y - 34) / 6);
  }
}

export function effectiveWallBandForTex(
  band: VisualSurfaceWallBand,
  tex: Tex,
): VisualSurfaceWallBand {
  switch (tex) {
    case Tex.MEAT:
    case Tex.GUT:
    case Tex.LARVA_BODY:
    case Tex.F_MEAT:
    case Tex.F_GUT:
    case Tex.VOID_WALL:
    case Tex.F_VOID:
    case Tex.F_ABYSS:
    case Tex.DARK:
      return 'none';
    case Tex.TILE_W:
    case Tex.MARBLE:
      return 'tileWainscot';
    case Tex.PIPE:
    case Tex.METAL:
      return 'serviceStrip';
    case Tex.BRICK:
    case Tex.CONCRETE:
    case Tex.HERMO_WALL:
      return band === 'none' ? 'concreteBlocks' : band;
    default:
      return band;
  }
}

export function effectiveTrimForTex(trim: VisualSurfaceTrim, tex: Tex): VisualSurfaceTrim {
  switch (tex) {
    case Tex.MEAT:
    case Tex.GUT:
    case Tex.LARVA_BODY:
    case Tex.F_MEAT:
    case Tex.F_GUT:
    case Tex.VOID_WALL:
    case Tex.F_VOID:
    case Tex.F_ABYSS:
    case Tex.DARK:
      return 'none';
    case Tex.PIPE:
    case Tex.METAL:
      return 'metalRail';
    default:
      return trim;
  }
}

export function wallBandThreshold(band: VisualSurfaceWallBand): number {
  switch (band) {
    case 'tileWainscot': return 38;
    case 'panelLower': return 40;
    case 'serviceStrip': return 24;
    case 'concreteBlocks': return 0;
    case 'none':
    default: return 64;
  }
}

export function ceilingPatternSeam(pattern: VisualSurfaceCeilingPattern, cell: MaterialPatternCell): number {
  switch (pattern) {
    case 'panelGrid':
      return tileSeamFactor(cell.tx, cell.ty, 32, 1);
    case 'servicePanels':
      return Math.max(tileSeamFactor(cell.tx, cell.ty, 32, 1), tileSeamFactor(cell.tx, cell.ty, 16, 0.5) * 0.55);
    case 'lowConcrete':
      return tileSeamFactor(cell.tx, cell.ty, 64, 0.75);
    case 'organicRibs':
      return clamp01((Math.sin((cell.tx + cell.cellX * 7) * 0.35) + 1) * 0.5);
    case 'plain':
    default:
      return 0;
  }
}
