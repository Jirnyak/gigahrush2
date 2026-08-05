import { W } from '../../core/types';
import type { World } from '../../core/world';
import {
  capMeshInstances,
  collectMeshChunk,
  collectStaticEntityMeshes,
  resolveMeshSceneProfile,
  visualSlotVersionForWorld,
  type MeshInstance,
  type MeshPassContext,
  type ResolvedMeshSceneProfile,
} from './scene_collect';

export const CHUNK_SIZE = 8;
export const MAX_CHUNKS_PER_FRAME = 8;

export interface MeshChunkCacheStats {
  enabled: boolean;
  chunksConsidered: number;
  chunksBuilt: number;
  chunksReused: number;
  instances: number;
}

interface MeshWorldVersions {
  cellVersion: number;
  surfaceVersion: number;
  featureVersion: number;
  visualSlotVersion: number;
}

interface MeshChunkCacheEntry {
  key: string;
  chunkX: number;
  chunkY: number;
  world: World;
  floorKey: string;
  seed: number;
  profileKey: string;
  versions: MeshWorldVersions;
  instances: MeshInstance[];
}

interface ChunkCandidate {
  chunkX: number;
  chunkY: number;
  d2: number;
}

function chunkKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function profileKey(profile: ResolvedMeshSceneProfile, mode: string | undefined): string {
  return [
    mode ?? 'medium',
    profile.radius,
    profile.proceduralFieldRadius,
    profile.instanceCap,
    profile.proceduralFieldInstanceCap,
    profile.includeVisualSlots ? 1 : 0,
    profile.includeFeatures ? 1 : 0,
    profile.includeContainers ? 1 : 0,
    profile.chunkSize,
  ].join('|');
}

function worldVersions(world: World): MeshWorldVersions {
  return {
    cellVersion: world.cellVersion,
    surfaceVersion: world.surfaceVersion,
    featureVersion: world.featureVersion,
    visualSlotVersion: visualSlotVersionForWorld(world),
  };
}

function versionsEqual(a: MeshWorldVersions, b: MeshWorldVersions): boolean {
  return a.cellVersion === b.cellVersion &&
    a.surfaceVersion === b.surfaceVersion &&
    a.featureVersion === b.featureVersion &&
    a.visualSlotVersion === b.visualSlotVersion;
}

function wrappedDelta(from: number, to: number): number {
  let d = to - from;
  if (d > W / 2) d -= W;
  if (d < -W / 2) d += W;
  return d;
}

function chunkCandidates(context: MeshPassContext, profile: ResolvedMeshSceneProfile): ChunkCandidate[] {
  const size = profile.chunkSize;
  const chunksPerAxis = W / size;
  const cameraChunkX = ((Math.floor(context.camera.x) / size) | 0) & (chunksPerAxis - 1);
  const cameraChunkY = ((Math.floor(context.camera.y) / size) | 0) & (chunksPerAxis - 1);
  const chunkRadius = Math.ceil(profile.radius / size) + 1;
  const out: ChunkCandidate[] = [];
  const maxD = profile.radius + size;
  const maxD2 = maxD * maxD;
  for (let oy = -chunkRadius; oy <= chunkRadius; oy++) {
    const cy = (cameraChunkY + oy + chunksPerAxis) & (chunksPerAxis - 1);
    for (let ox = -chunkRadius; ox <= chunkRadius; ox++) {
      const cx = (cameraChunkX + ox + chunksPerAxis) & (chunksPerAxis - 1);
      const centerX = cx * size + size * 0.5;
      const centerY = cy * size + size * 0.5;
      const dx = wrappedDelta(context.camera.x, centerX);
      const dy = wrappedDelta(context.camera.y, centerY);
      const d2 = dx * dx + dy * dy;
      if (d2 > maxD2) continue;
      out.push({ chunkX: cx, chunkY: cy, d2 });
    }
  }
  out.sort((a, b) => a.d2 - b.d2 || a.chunkY - b.chunkY || a.chunkX - b.chunkX);
  return out;
}

export class MeshChunkCache {
  private readonly entries = new Map<string, MeshChunkCacheEntry>();
  private lastWorld: World | null = null;
  private lastFloorKey = '';
  private lastSeed = 0;
  private lastProfileKey = '';

  clear(): void {
    this.entries.clear();
    this.lastWorld = null;
    this.lastFloorKey = '';
    this.lastSeed = 0;
    this.lastProfileKey = '';
  }

  update(context: MeshPassContext, out: MeshInstance[] = []): MeshChunkCacheStats {
    out.length = 0;
    const profile = resolveMeshSceneProfile({
      ...context,
      profile: {
        ...(context.profile ?? {}),
        chunkSize: context.profile?.chunkSize ?? CHUNK_SIZE,
        maxChunksPerFrame: context.profile?.maxChunksPerFrame ?? MAX_CHUNKS_PER_FRAME,
      },
    });
    if (!profile.enabled) {
      this.clear();
      return { enabled: false, chunksConsidered: 0, chunksBuilt: 0, chunksReused: 0, instances: 0 };
    }

    const pKey = profileKey(profile, context.mode);
    if (
      this.lastWorld !== context.world ||
      this.lastFloorKey !== context.floorKey ||
      this.lastSeed !== context.seed ||
      this.lastProfileKey !== pKey
    ) {
      this.entries.clear();
      this.lastWorld = context.world;
      this.lastFloorKey = context.floorKey;
      this.lastSeed = context.seed;
      this.lastProfileKey = pKey;
    }

    const versions = worldVersions(context.world);
    const raw: MeshInstance[] = [];
    let chunksBuilt = 0;
    let chunksReused = 0;
    const candidates = chunkCandidates(context, profile);
    for (const candidate of candidates) {
      const key = chunkKey(candidate.chunkX, candidate.chunkY);
      let entry = this.entries.get(key);
      const stale = !entry ||
        entry.world !== context.world ||
        entry.floorKey !== context.floorKey ||
        entry.seed !== context.seed ||
        entry.profileKey !== pKey ||
        !versionsEqual(entry.versions, versions);
      if (stale && chunksBuilt < profile.maxChunksPerFrame) {
        const instances: MeshInstance[] = [];
        collectMeshChunk({ ...context, profile }, candidate.chunkX, candidate.chunkY, instances);
        entry = {
          key,
          chunkX: candidate.chunkX,
          chunkY: candidate.chunkY,
          world: context.world,
          floorKey: context.floorKey,
          seed: context.seed,
          profileKey: pKey,
          versions,
          instances,
        };
        this.entries.set(key, entry);
        chunksBuilt++;
      } else if (entry && !stale) {
        chunksReused++;
      }
      if (entry) raw.push(...entry.instances);
    }
    collectStaticEntityMeshes({ ...context, profile }, raw);
    capMeshInstances({ ...context, profile }, raw, out, profile);
    return {
      enabled: true,
      chunksConsidered: candidates.length,
      chunksBuilt,
      chunksReused,
      instances: out.length,
    };
  }
}

export function createMeshChunkCache(): MeshChunkCache {
  return new MeshChunkCache();
}
