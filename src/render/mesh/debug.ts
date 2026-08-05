import type { MeshPassStats } from './types';

export function formatMeshPassStats(stats: MeshPassStats): string {
  const state = stats.enabled ? 'on' : `off:${stats.skippedReason || 'disabled'}`;
  return [
    `mesh=${state}`,
    `chunks=${stats.chunksBuilt}/${stats.chunksConsidered}`,
    `instances=${stats.visibleInstances}`,
    `triangles=${stats.submittedTriangles}`,
    `draws=${stats.drawCalls}`,
    `cpu=${stats.cpuUpdateMs.toFixed(2)}ms`,
  ].join(' ');
}
