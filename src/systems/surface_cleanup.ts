import type { World } from '../core/world';

export interface SurfaceCleanupOptions {
  shouldCleanCell?: (idx: number) => boolean;
}

export function cleanSurfaceArea(
  world: World,
  cx: number,
  cy: number,
  radiusCells: number,
  options: SurfaceCleanupOptions = {},
): number {
  const minX = Math.floor(cx - radiusCells) - 1;
  const maxX = Math.floor(cx + radiusCells) + 1;
  const minY = Math.floor(cy - radiusCells) - 1;
  const maxY = Math.floor(cy + radiusCells) + 1;
  const changedCells: number[] = [];
  let removed = 0;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const wx = world.wrap(x);
      const wy = world.wrap(y);
      const ci = world.idx(wx, wy);
      if (options.shouldCleanCell && !options.shouldCleanCell(ci)) continue;
      
      // Clean danger/blood field
      if (world.dangerField[ci] > 0) {
        world.dangerField[ci] = Math.max(0, world.dangerField[ci] - 50);
      }

      const cell = world.surfaceMap.get(ci);
      if (!cell) continue;

      for (let py = 0; py < 16; py++) {
        for (let px = 0; px < 16; px++) {
          const wxf = wx + (px + 0.5) / 16;
          const wyf = wy + (py + 0.5) / 16;
          if (world.dist(wxf, wyf, cx, cy) > radiusCells) continue;
          const ai = ((py * 16 + px) << 2) + 3;
          const a = cell[ai];
          if (a <= 0) continue;
          const dec = Math.max(24, Math.floor(a * 0.45));
          const na = Math.max(0, a - dec);
          removed += a - na;
          cell[ai] = na;
          if (!changedCells.includes(ci)) changedCells.push(ci);
        }
      }
    }
  }

  if (changedCells.length > 0) world.markSurfaceCellsDirty(changedCells);
  return removed;
}
