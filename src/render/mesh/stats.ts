import { emptyMeshPassStats, type MeshPassStats } from './types';

export const EMPTY_MESH_PASS_STATS: MeshPassStats = Object.freeze(emptyMeshPassStats('not_initialized'));

export function meshNowMs(): number {
  return globalThis.performance?.now() ?? Date.now();
}

export function meshElapsedMs(startMs: number): number {
  return Math.max(0, meshNowMs() - startMs);
}

export function clampMeshStatCount(value: number, cap = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.trunc(value), Math.max(0, Math.trunc(cap)));
}

export function createMeshPassStats(overrides: Partial<MeshPassStats> = {}): MeshPassStats {
  const instances = clampMeshStatCount(overrides.visibleInstances ?? overrides.instances ?? EMPTY_MESH_PASS_STATS.visibleInstances);
  const triangles = clampMeshStatCount(overrides.submittedTriangles ?? overrides.triangles ?? EMPTY_MESH_PASS_STATS.submittedTriangles);
  const cpuMs = Math.max(0, overrides.cpuUpdateMs ?? overrides.cpuMs ?? EMPTY_MESH_PASS_STATS.cpuUpdateMs);
  return {
    enabled: overrides.enabled ?? EMPTY_MESH_PASS_STATS.enabled,
    skippedReason: overrides.skippedReason ?? EMPTY_MESH_PASS_STATS.skippedReason,
    instances,
    triangles,
    cpuMs,
    visibleInstances: instances,
    submittedTriangles: triangles,
    drawCalls: clampMeshStatCount(overrides.drawCalls ?? EMPTY_MESH_PASS_STATS.drawCalls),
    chunksConsidered: clampMeshStatCount(overrides.chunksConsidered ?? EMPTY_MESH_PASS_STATS.chunksConsidered),
    chunksBuilt: clampMeshStatCount(overrides.chunksBuilt ?? EMPTY_MESH_PASS_STATS.chunksBuilt),
    visualSlotBytesScanned: clampMeshStatCount(overrides.visualSlotBytesScanned ?? EMPTY_MESH_PASS_STATS.visualSlotBytesScanned),
    visualSlotMergeOutputs: clampMeshStatCount(overrides.visualSlotMergeOutputs ?? EMPTY_MESH_PASS_STATS.visualSlotMergeOutputs),
    unknownVisualSlotCodes: clampMeshStatCount(overrides.unknownVisualSlotCodes ?? EMPTY_MESH_PASS_STATS.unknownVisualSlotCodes),
    cpuUpdateMs: cpuMs,
    cpuBufferMs: Math.max(0, overrides.cpuBufferMs ?? EMPTY_MESH_PASS_STATS.cpuBufferMs),
    cpuUploadMs: Math.max(0, overrides.cpuUploadMs ?? EMPTY_MESH_PASS_STATS.cpuUploadMs),
  };
}

export function copyMeshPassStats(stats: MeshPassStats): MeshPassStats {
  return createMeshPassStats(stats);
}

export function skippedMeshPassStats(skippedReason: string, cpuUpdateMs = 0): MeshPassStats {
  return createMeshPassStats({ skippedReason, cpuUpdateMs });
}
